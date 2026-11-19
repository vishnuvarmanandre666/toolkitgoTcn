import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  AadhaarAddressStatus,
  ActorType,
  AdminRole,
  CurrentAddressStatus,
  DocumentCategory,
  DocumentStatus,
  KycSection,
  KycStatus,
  Prisma,
  VerificationMethod,
  VerificationStatus,
} from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import Redis from 'ioredis';
import { AuditService } from '../audit/audit.service';
import { AuthedAdmin } from '../auth/guards';
import { CryptoService } from '../common/crypto/crypto.service';
import { maskAccount, maskPhone } from '../common/utils/identity';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { DocumentsService } from '../documents/documents.service';
import { approvalBlockers, canTransition, categoryLabel, TECHNICIAN_KYC_INCLUDE, TechnicianKyc } from '../kyc/kyc-rules';
import { serializeForAdmin } from '../kyc/kyc-serializer';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS } from '../redis/redis.module';
import {
  CreateStaffDto,
  ListApplicationsQuery,
  RequestActionDto,
  ReviewDocumentDto,
  SetVerificationDto,
  UpdateStaffDto,
  VerificationSection,
} from './admin.dto';

/** Compared against when the email is unknown, so timing doesn't reveal account existence. */
const DUMMY_HASH = bcrypt.hashSync('toolkitgo-timing-equaliser', 12);

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly crypto: CryptoService,
    private readonly documents: DocumentsService,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  private get policy() {
    return this.config.kycPolicy;
  }

  private log(admin: AuthedAdmin, technicianId: string | null, action: string, ip?: string, metadata?: Prisma.InputJsonValue, entity?: { type: string; id: string }) {
    return this.audit.log({ actorType: ActorType.ADMIN, actorId: admin.id, technicianId, action, metadata, ip, entityType: entity?.type, entityId: entity?.id });
  }

  // ---------------------------------------------------------------- auth --

  async login(email: string, password: string, ip: string) {
    const key = `admin:login:${email.toLowerCase()}`;
    const attempts = Number((await this.redis.get(key)) ?? 0);
    if (attempts >= 5) {
      const ttl = await this.redis.ttl(key);
      throw new HttpException({ message: 'Too many failed logins. Try again later.', retryAfterSeconds: ttl }, HttpStatus.TOO_MANY_REQUESTS);
    }
    const admin = await this.prisma.adminUser.findUnique({ where: { email: email.toLowerCase() } });
    // Always run bcrypt so response time doesn't reveal whether the email exists.
    const ok = await bcrypt.compare(password, admin?.passwordHash ?? DUMMY_HASH);
    if (!admin || !ok || !admin.isActive) {
      await this.redis.multi().incr(key).expire(key, 900).exec();
      await this.audit.log({ actorType: ActorType.ADMIN, actorId: admin?.id ?? null, action: 'ADMIN_LOGIN_FAILED', ip, metadata: { email: email.toLowerCase() } });
      throw new UnauthorizedException('Invalid email or password.');
    }
    await this.redis.del(key);
    await this.prisma.adminUser.update({ where: { id: admin.id }, data: { lastLoginAt: new Date() } });
    await this.audit.log({ actorType: ActorType.ADMIN, actorId: admin.id, action: 'ADMIN_LOGIN', ip });
    return { id: admin.id, email: admin.email, name: admin.name, role: admin.role };
  }

  // -------------------------------------------------------- applications --

  async stats() {
    const [byStatus, active, pendingDocs] = await Promise.all([
      this.prisma.technician.groupBy({ by: ['kycStatus'], _count: { _all: true } }),
      this.prisma.technician.count({ where: { isActive: true } }),
      this.prisma.document.count({ where: { status: DocumentStatus.PENDING_VERIFICATION } }),
    ]);
    const counts = Object.fromEntries(Object.values(KycStatus).map((s) => [s, 0])) as Record<KycStatus, number>;
    for (const row of byStatus) counts[row.kycStatus] = row._count._all;
    return { byStatus: counts, activeTechnicians: active, documentsAwaitingReview: pendingDocs };
  }

  async list(q: ListApplicationsQuery) {
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 20;
    const where: Prisma.TechnicianWhereInput = {};
    if (q.status) where.kycStatus = q.status;
    if (q.active) where.isActive = q.active === 'true';
    const search = q.q?.trim();
    if (search) {
      const digits = search.replace(/\D/g, '');
      where.OR = [{ fullName: { contains: search } }, ...(digits.length >= 4 ? [{ phone: { contains: digits } }] : [])];
    }
    const [total, rows] = await Promise.all([
      this.prisma.technician.count({ where }),
      this.prisma.technician.findMany({
        where,
        orderBy: [{ submittedAt: { sort: 'asc', nulls: 'last' } }, { updatedAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          aadhaar: { select: { verificationStatus: true } },
          pan: { select: { verificationStatus: true } },
          bank: { select: { verificationStatus: true } },
          aadhaarAddress: { select: { verificationStatus: true } },
          currentAddress: { select: { verificationStatus: true } },
          _count: { select: { documents: { where: { status: DocumentStatus.PENDING_VERIFICATION } } } },
        },
      }),
    ]);
    return {
      page,
      pageSize,
      total,
      items: rows.map((t) => ({
        id: t.id,
        fullName: t.fullName,
        phone: maskPhone(t.phone),
        kycStatus: t.kycStatus,
        isActive: t.isActive,
        submittedAt: t.submittedAt,
        updatedAt: t.updatedAt,
        addressesDiffer: !t.addressesSame,
        verifications: {
          mobile: t.mobileVerification,
          aadhaar: t.aadhaar?.verificationStatus ?? 'PENDING',
          pan: t.pan?.verificationStatus ?? 'PENDING',
          aadhaarAddress: t.aadhaarAddress?.verificationStatus ?? null,
          currentAddress: t.currentAddress?.verificationStatus ?? null,
          bank: t.bank?.verificationStatus ?? null,
        },
        documentsAwaitingReview: t._count.documents,
      })),
    };
  }

  private async load(id: string): Promise<TechnicianKyc> {
    const t = await this.prisma.technician.findUnique({ where: { id }, include: TECHNICIAN_KYC_INCLUDE });
    if (!t) throw new NotFoundException('Application not found.');
    return t;
  }

  async detail(id: string) {
    return serializeForAdmin(await this.load(id), this.policy);
  }

  /** Reviewing is only possible on submitted applications; first action moves SUBMITTED → UNDER_REVIEW. */
  private async ensureUnderReview(t: TechnicianKyc, admin: AuthedAdmin, ip?: string) {
    if (t.kycStatus === KycStatus.UNDER_REVIEW) return;
    if (t.kycStatus !== KycStatus.SUBMITTED) {
      throw new ConflictException(`Application is ${t.kycStatus}; it must be submitted before it can be reviewed.`);
    }
    await this.prisma.$transaction([
      this.prisma.technician.update({ where: { id: t.id }, data: { kycStatus: KycStatus.UNDER_REVIEW, reviewStartedAt: new Date(), reviewedById: admin.id } }),
      this.prisma.document.updateMany({ where: { technicianId: t.id, status: DocumentStatus.UPLOADED }, data: { status: DocumentStatus.PENDING_VERIFICATION } }),
    ]);
    t.kycStatus = KycStatus.UNDER_REVIEW;
    await this.log(admin, t.id, 'KYC_REVIEW_STARTED', ip);
  }

  async startReview(id: string, admin: AuthedAdmin, ip?: string) {
    await this.ensureUnderReview(await this.load(id), admin, ip);
    return this.detail(id);
  }

  // ----------------------------------------------------------- documents --

  async reviewDocument(documentId: string, dto: ReviewDocumentDto, admin: AuthedAdmin, ip?: string) {
    const doc = await this.prisma.document.findUnique({ where: { id: documentId }, include: { currentVersion: true } });
    if (!doc || !doc.currentVersion) throw new NotFoundException('Document not found or has no file.');
    if (dto.status !== 'VERIFIED' && !dto.reason?.trim()) throw new BadRequestException('A reason is required when rejecting a document.');

    const t = await this.load(doc.technicianId);
    await this.ensureUnderReview(t, admin, ip);

    const status = DocumentStatus[dto.status];
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.document.update({
        where: { id: doc.id },
        data: { status, rejectionReason: dto.status === 'VERIFIED' ? null : dto.reason!.trim(), reviewedAt: now, reviewedById: admin.id },
      });
      await tx.documentVersion.update({ where: { id: doc.currentVersion!.id }, data: { status, reviewNote: dto.reason?.trim() || null } });

      if (dto.status !== 'VERIFIED') {
        await tx.kycFeedback.create({
          data: {
            technicianId: t.id,
            section: doc.category === DocumentCategory.PROFILE_PHOTO ? KycSection.PERSONAL : KycSection.DOCUMENTS,
            documentId: doc.id,
            message: `${categoryLabel(doc.category)}: ${dto.reason!.trim()}`,
            createdById: admin.id,
          },
        });
      }
      // A verified address proof upgrades a self-declared current address.
      if (doc.category === DocumentCategory.ADDRESS_PROOF && dto.status === 'VERIFIED' && t.currentAddress?.verificationStatus === CurrentAddressStatus.SELF_DECLARED) {
        await tx.currentAddress.update({ where: { technicianId: t.id }, data: { verificationStatus: CurrentAddressStatus.DOCUMENT_SUPPORTED, reviewedById: admin.id, verifiedAt: now } });
      }
    });
    await this.log(admin, t.id, `DOCUMENT_${dto.status}`, ip, { category: doc.category, version: doc.currentVersion.version, reason: dto.reason ?? null }, { type: 'Document', id: doc.id });
    return this.detail(t.id);
  }

  versions(documentId: string) {
    return this.documents.listVersions(documentId);
  }

  documentUrl(documentId: string, versionId: string | undefined, admin: AuthedAdmin, ip?: string) {
    return this.documents.signedUrl({ adminId: admin.id }, documentId, versionId, ip);
  }

  // -------------------------------------------------------- verifications --

  private hasVerifiedDoc(t: TechnicianKyc, category: DocumentCategory) {
    return t.documents.some((d) => d.category === category && d.status === DocumentStatus.VERIFIED);
  }

  /**
   * Sets an individual verification status. Manual VERIFIED decisions must
   * carry a review note and (for identity) be backed by a verified document,
   * creating a documented, auditable manual review.
   */
  async setVerification(id: string, section: VerificationSection, dto: SetVerificationDto, admin: AuthedAdmin, ip?: string) {
    const t = await this.load(id);
    await this.ensureUnderReview(t, admin, ip);
    const note = dto.note?.trim() || null;
    const now = new Date();
    let feedback: { section: KycSection; message: string } | null = null;

    const requireNote = (why: string) => {
      if (!note) throw new BadRequestException(`A review note is required ${why}.`);
    };

    switch (section) {
      case 'aadhaar':
      case 'pan': {
        const record = section === 'aadhaar' ? t.aadhaar : t.pan;
        if (!record) throw new BadRequestException('The technician has not submitted these details.');
        const allowed: VerificationStatus[] = [VerificationStatus.VERIFIED, VerificationStatus.FAILED, VerificationStatus.MANUAL_REVIEW];
        const status = dto.status as VerificationStatus;
        if (!allowed.includes(status)) throw new BadRequestException(`Status must be one of ${allowed.join(', ')}.`);
        const category = section === 'aadhaar' ? DocumentCategory.AADHAAR : DocumentCategory.PAN;
        const data: Prisma.AadhaarDetailUpdateInput & Prisma.PanDetailUpdateInput = { reviewNote: note, reviewedById: admin.id, verificationStatus: status };

        if (status === VerificationStatus.VERIFIED) {
          const alreadyProviderVerified = record.verificationStatus === VerificationStatus.VERIFIED && record.verificationMethod !== VerificationMethod.MANUAL;
          if (!alreadyProviderVerified) {
            requireNote('for manual verification');
            if (!this.hasVerifiedDoc(t, category)) throw new ConflictException(`Verify the ${categoryLabel(category)} document before manually verifying.`);
            data.verificationMethod = VerificationMethod.MANUAL;
            data.verifiedAt = now;
            data.failureReason = null;
          }
        } else if (status === VerificationStatus.FAILED) {
          requireNote('when failing a verification');
          data.failureReason = note;
          data.verifiedAt = null;
          feedback = { section: section === 'aadhaar' ? KycSection.AADHAAR : KycSection.PAN, message: note! };
        }
        if (section === 'aadhaar') await this.prisma.aadhaarDetail.update({ where: { technicianId: t.id }, data });
        else await this.prisma.panDetail.update({ where: { technicianId: t.id }, data });
        break;
      }
      case 'bank': {
        if (!t.bank) throw new BadRequestException('The technician has not submitted bank details.');
        const allowed: VerificationStatus[] = [VerificationStatus.VERIFIED, VerificationStatus.FAILED, VerificationStatus.MANUAL_REVIEW];
        const status = dto.status as VerificationStatus;
        if (!allowed.includes(status)) throw new BadRequestException(`Status must be one of ${allowed.join(', ')}.`);
        if (status === VerificationStatus.VERIFIED) {
          requireNote('for manual bank verification');
          if (this.policy.requireBankProof && !this.hasVerifiedDoc(t, DocumentCategory.BANK_PROOF)) {
            throw new ConflictException('Verify the bank proof document first.');
          }
        }
        if (status === VerificationStatus.FAILED) {
          requireNote('when failing a verification');
          feedback = { section: KycSection.BANK, message: note! };
        }
        await this.prisma.bankDetail.update({
          where: { technicianId: t.id },
          data: {
            verificationStatus: status,
            verificationMethod: status === VerificationStatus.VERIFIED ? VerificationMethod.MANUAL : t.bank.verificationMethod,
            verifiedAt: status === VerificationStatus.VERIFIED ? now : null,
            reviewNote: note,
            reviewedById: admin.id,
          },
        });
        break;
      }
      case 'aadhaarAddress': {
        if (!t.aadhaarAddress) throw new BadRequestException('No Aadhaar address submitted.');
        const status = dto.status as AadhaarAddressStatus;
        if (!Object.values(AadhaarAddressStatus).includes(status)) throw new BadRequestException('Invalid Aadhaar address status.');
        if (status === AadhaarAddressStatus.VERIFIED && t.aadhaarAddress.verificationStatus !== AadhaarAddressStatus.VERIFIED) {
          requireNote('for manual address verification');
          if (!this.hasVerifiedDoc(t, DocumentCategory.AADHAAR)) throw new ConflictException('Verify the Aadhaar document before verifying its address.');
        }
        if (status === AadhaarAddressStatus.REJECTED) {
          requireNote('when rejecting an address');
          feedback = { section: KycSection.ADDRESS, message: `Aadhaar address: ${note}` };
        }
        await this.prisma.aadhaarAddress.update({
          where: { technicianId: t.id },
          data: { verificationStatus: status, reviewNote: note, reviewedById: admin.id, verifiedAt: status === AadhaarAddressStatus.VERIFIED ? now : null },
        });
        break;
      }
      case 'currentAddress': {
        if (!t.currentAddress) throw new BadRequestException('No current address submitted.');
        const status = dto.status as CurrentAddressStatus;
        if (!Object.values(CurrentAddressStatus).includes(status)) throw new BadRequestException('Invalid current address status.');
        if (status === CurrentAddressStatus.DOCUMENT_SUPPORTED && !this.hasVerifiedDoc(t, DocumentCategory.ADDRESS_PROOF)) {
          throw new ConflictException('A verified address proof document is required for DOCUMENT_SUPPORTED.');
        }
        if (status === CurrentAddressStatus.MANUALLY_VERIFIED) requireNote('for manual address verification');
        if (status === CurrentAddressStatus.REJECTED) {
          requireNote('when rejecting an address');
          feedback = { section: KycSection.ADDRESS, message: `Current address: ${note}` };
        }
        await this.prisma.currentAddress.update({
          where: { technicianId: t.id },
          data: { verificationStatus: status, reviewNote: note, reviewedById: admin.id, verifiedAt: status === CurrentAddressStatus.SELF_DECLARED || status === CurrentAddressStatus.REJECTED ? null : now },
        });
        break;
      }
      default:
        throw new BadRequestException('Unknown verification section.');
    }

    if (feedback) {
      await this.prisma.kycFeedback.create({ data: { technicianId: t.id, ...feedback, createdById: admin.id } });
    }
    await this.log(admin, t.id, 'VERIFICATION_STATUS_SET', ip, { section, status: dto.status, note });
    return this.detail(t.id);
  }

  // ------------------------------------------------------------- decisions --

  async requestAction(id: string, dto: RequestActionDto, admin: AuthedAdmin, ip?: string) {
    const t = await this.load(id);
    if (!canTransition(t.kycStatus, KycStatus.ACTION_REQUIRED)) throw new ConflictException(`Cannot request changes on a ${t.kycStatus} application.`);

    const docIds = dto.items.map((i) => i.documentId).filter((x): x is string => !!x);
    if (docIds.length) {
      const owned = await this.prisma.document.count({ where: { id: { in: docIds }, technicianId: t.id } });
      if (owned !== new Set(docIds).size) throw new BadRequestException('Document does not belong to this application.');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.technician.update({
        where: { id: t.id },
        data: {
          kycStatus: KycStatus.ACTION_REQUIRED,
          isActive: t.kycStatus === KycStatus.APPROVED ? false : t.isActive,
          reviewedAt: new Date(),
          reviewedById: admin.id,
          ...(dto.requestAddressProof ? { addressProofRequested: true } : {}),
        },
      });
      for (const item of dto.items) {
        await tx.kycFeedback.create({ data: { technicianId: t.id, section: item.section, documentId: item.documentId ?? null, message: item.message.trim(), createdById: admin.id } });
        if (item.documentId) {
          await tx.document.update({ where: { id: item.documentId }, data: { status: DocumentStatus.REUPLOAD_REQUIRED, rejectionReason: item.message.trim() } });
        }
      }
    });
    await this.log(admin, t.id, 'KYC_ACTION_REQUIRED', ip, { items: dto.items.length, requestAddressProof: !!dto.requestAddressProof });
    return this.detail(t.id);
  }

  async approve(id: string, note: string | undefined, admin: AuthedAdmin, ip?: string) {
    const t = await this.load(id);
    const blockers = approvalBlockers(t, this.policy);
    if (blockers.length) throw new ConflictException({ message: 'Application cannot be approved yet.', details: { blockers } });
    const res = await this.prisma.technician.updateMany({
      where: { id: t.id, kycStatus: KycStatus.UNDER_REVIEW },
      data: { kycStatus: KycStatus.APPROVED, reviewedAt: new Date(), reviewedById: admin.id, rejectionReason: null },
    });
    if (res.count !== 1) throw new ConflictException('Application status changed. Refresh and try again.');
    await this.log(admin, t.id, 'KYC_APPROVED', ip, { note: note ?? null });
    return this.detail(t.id);
  }

  async reject(id: string, reason: string, admin: AuthedAdmin, ip?: string) {
    const t = await this.load(id);
    if (!canTransition(t.kycStatus, KycStatus.REJECTED)) throw new ConflictException(`Cannot reject a ${t.kycStatus} application.`);
    await this.prisma.technician.update({
      where: { id: t.id },
      data: { kycStatus: KycStatus.REJECTED, rejectionReason: reason.trim(), isActive: false, reviewedAt: new Date(), reviewedById: admin.id },
    });
    await this.log(admin, t.id, 'KYC_REJECTED', ip, { reason });
    return this.detail(t.id);
  }

  async setActive(id: string, active: boolean, reason: string | undefined, admin: AuthedAdmin, ip?: string) {
    const t = await this.load(id);
    if (active && t.kycStatus !== KycStatus.APPROVED) throw new ConflictException('Only technicians with approved KYC can be activated.');
    if (!active && !reason?.trim()) throw new BadRequestException('A reason is required to deactivate a technician.');
    await this.prisma.technician.update({ where: { id: t.id }, data: { isActive: active, activatedAt: active ? new Date() : t.activatedAt } });
    await this.log(admin, t.id, active ? 'TECHNICIAN_ACTIVATED' : 'TECHNICIAN_DEACTIVATED', ip, { reason: reason ?? null });
    return this.detail(t.id);
  }

  /** Break-glass access to a decrypted identifier; always audited with a reason. */
  async reveal(id: string, field: 'pan' | 'bankAccount', reason: string, admin: AuthedAdmin, ip?: string) {
    const t = await this.load(id);
    let value: string | null = null;
    if (field === 'pan' && t.pan?.panEncrypted) value = this.crypto.decrypt(t.pan.panEncrypted);
    if (field === 'bankAccount' && t.bank?.accountEncrypted) value = this.crypto.decrypt(t.bank.accountEncrypted);
    if (!value) throw new NotFoundException('No value stored for this field.');
    await this.log(admin, t.id, 'SENSITIVE_FIELD_REVEALED', ip, {
      field,
      reason,
      masked: field === 'bankAccount' ? maskAccount(value.slice(-4)) : t.pan?.panMasked ?? null,
    });
    return { field, value };
  }

  async auditTrail(id: string) {
    await this.load(id);
    return this.audit.list(id);
  }

  // ---------------------------------------------------------------- staff --

  listStaff() {
    return this.prisma.adminUser.findMany({
      orderBy: { createdAt: 'asc' },
      select: { id: true, email: true, name: true, role: true, isActive: true, lastLoginAt: true, createdAt: true },
    });
  }

  async createStaff(dto: CreateStaffDto, admin: AuthedAdmin, ip?: string) {
    const created = await this.prisma.adminUser.create({
      data: { email: dto.email.toLowerCase(), name: dto.name.trim(), role: dto.role, passwordHash: await bcrypt.hash(dto.password, 12) },
      select: { id: true, email: true, name: true, role: true, isActive: true },
    });
    await this.log(admin, null, 'STAFF_CREATED', ip, { staffId: created.id, role: created.role });
    return created;
  }

  async updateStaff(staffId: string, dto: UpdateStaffDto, admin: AuthedAdmin, ip?: string) {
    if (staffId === admin.id && (dto.isActive === false || (dto.role && dto.role !== AdminRole.SUPER_ADMIN))) {
      throw new BadRequestException('You cannot demote or deactivate your own account.');
    }
    const updated = await this.prisma.adminUser.update({
      where: { id: staffId },
      data: dto,
      select: { id: true, email: true, name: true, role: true, isActive: true },
    });
    await this.log(admin, null, 'STAFF_UPDATED', ip, { staffId, ...dto });
    return updated;
  }
}
