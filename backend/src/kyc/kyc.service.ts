import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  AadhaarAddressStatus,
  ActorType,
  AddressSource,
  CurrentAddressStatus,
  DocumentCategory,
  DocumentStatus,
  KycStatus,
  Prisma,
  VerificationMethod,
  VerificationStatus,
} from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { CryptoService } from '../common/crypto/crypto.service';
import {
  ageOn,
  isIndividualPan,
  maskPan,
  nameMatchScore,
  normalizeAadhaar,
  normalizeIndianMobile,
  normalizePan,
  sameDate,
} from '../common/utils/identity';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { PrismaService } from '../prisma/prisma.service';
import { AadhaarDto, AddressesDto, AddressFieldsDto, BankDto, PanDto, PersonalInfoDto } from './kyc.dto';
import { isEditable, submissionBlockers, TECHNICIAN_KYC_INCLUDE, TechnicianKyc } from './kyc-rules';
import { serializeForTechnician } from './kyc-serializer';
import {
  AADHAAR_PROVIDER,
  AadhaarAddressResult,
  AadhaarVerificationProvider,
  PAN_PROVIDER,
  PanVerificationProvider,
} from './providers/identity-providers';

type Tx = Prisma.TransactionClient;

const ADDRESS_KEYS = ['houseNumber', 'buildingName', 'street', 'locality', 'villageCity', 'mandalTaluka', 'district', 'state', 'pinCode', 'country'] as const;

/** Trims strings, turns blanks into null, and defaults country to India. */
function cleanAddress(a: AddressFieldsDto | AadhaarAddressResult) {
  const out: Record<string, string | null> = {};
  for (const k of ADDRESS_KEYS) {
    const v = (a as unknown as Record<string, unknown>)[k];
    out[k] = typeof v === 'string' && v.trim() ? v.trim() : null;
  }
  out.country = out.country ?? 'India';
  return out as {
    houseNumber: string | null; buildingName: string | null; street: string | null; locality: string | null;
    villageCity: string; mandalTaluka: string | null; district: string; state: string; pinCode: string; country: string;
  };
}

const addressEquals = (a: Record<string, unknown> | null | undefined, b: Record<string, unknown>) =>
  !!a && ADDRESS_KEYS.every((k) => (a[k] ?? null) === (b[k] ?? null));

export interface ActionContext {
  ip?: string;
}

@Injectable()
export class KycService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(AADHAAR_PROVIDER) private readonly aadhaarProvider: AadhaarVerificationProvider,
    @Inject(PAN_PROVIDER) private readonly panProvider: PanVerificationProvider,
  ) {}

  private get policy() {
    return this.config.kycPolicy;
  }

  async load(technicianId: string, tx: Tx = this.prisma): Promise<TechnicianKyc> {
    const t = await tx.technician.findUnique({ where: { id: technicianId }, include: TECHNICIAN_KYC_INCLUDE });
    if (!t) throw new NotFoundException('Technician not found.');
    return t;
  }

  async getState(technicianId: string) {
    return serializeForTechnician(await this.load(technicianId), this.policy, { digilockerEnabled: this.config.digilocker.mode !== 'off' });
  }

  private assertEditable(t: TechnicianKyc) {
    if (!isEditable(t.kycStatus)) {
      throw new ConflictException(
        t.kycStatus === KycStatus.APPROVED
          ? 'Your KYC is approved. Contact support to change verified details.'
          : 'Your application is locked while it is being reviewed.',
      );
    }
  }

  /** First save of any step moves the application from NOT_STARTED to IN_PROGRESS. */
  private async touch(tx: Tx, t: TechnicianKyc) {
    if (t.kycStatus === KycStatus.NOT_STARTED) {
      await tx.technician.update({ where: { id: t.id }, data: { kycStatus: KycStatus.IN_PROGRESS } });
    }
  }

  private log(t: { id: string }, action: string, ctx: ActionContext, metadata?: Prisma.InputJsonValue) {
    return this.audit.log({ actorType: ActorType.TECHNICIAN, actorId: t.id, technicianId: t.id, action, metadata, ip: ctx.ip });
  }

  // ------------------------------------------------------------- personal --

  async updatePersonal(technicianId: string, dto: PersonalInfoDto, ctx: ActionContext) {
    const t = await this.load(technicianId);
    this.assertEditable(t);

    const dob = new Date(`${dto.dateOfBirth}T00:00:00.000Z`);
    if (Number.isNaN(dob.getTime()) || dob > new Date()) throw new BadRequestException('Enter a valid date of birth.');
    if (ageOn(dob) < 18) throw new BadRequestException('Technicians must be at least 18 years old.');
    if (ageOn(dob) > 100) throw new BadRequestException('Enter a valid date of birth.');

    const emergency = normalizeIndianMobile(dto.emergencyContact);
    if (!emergency) throw new BadRequestException('Enter a valid emergency contact number.');
    if (`91${emergency}` === t.phone) throw new BadRequestException('Emergency contact must be different from your own number.');

    const fullName = dto.fullName.trim().replace(/\s+/g, ' ');
    const identityChanged = (t.fullName && t.fullName !== fullName) || (t.dateOfBirth && !sameDate(t.dateOfBirth, dob));

    await this.prisma.$transaction(async (tx) => {
      await tx.technician.update({
        where: { id: t.id },
        data: { fullName, dateOfBirth: dob, gender: dto.gender ?? null, email: dto.email?.trim().toLowerCase() || null, emergencyContact: emergency },
      });
      // Identity details changed after verification: earlier name/DOB matches no longer hold.
      if (identityChanged) {
        const note = 'Name or date of birth changed after verification; requires review.';
        if (t.aadhaar?.verificationStatus === VerificationStatus.VERIFIED) {
          await tx.aadhaarDetail.update({ where: { technicianId: t.id }, data: { verificationStatus: VerificationStatus.MANUAL_REVIEW, failureReason: note } });
        }
        if (t.pan?.verificationStatus === VerificationStatus.VERIFIED) {
          await tx.panDetail.update({ where: { technicianId: t.id }, data: { verificationStatus: VerificationStatus.MANUAL_REVIEW, failureReason: note } });
        }
      }
      await this.touch(tx, t);
    });
    await this.log(t, 'PERSONAL_INFO_UPDATED', ctx, { identityChanged: !!identityChanged });
    return this.getState(t.id);
  }

  // -------------------------------------------------------------- aadhaar --

  async submitAadhaar(technicianId: string, dto: AadhaarDto, ctx: ActionContext) {
    const t = await this.load(technicianId);
    this.assertEditable(t);
    if (!t.fullName || !t.dateOfBirth) throw new ConflictException('Please complete your personal information first.');

    const number = normalizeAadhaar(dto.aadhaarNumber);
    if (!number) throw new BadRequestException('Enter a valid 12-digit Aadhaar number.');
    const hash = this.crypto.blindIndex('aadhaar', number);
    const duplicate = await this.prisma.aadhaarDetail.findFirst({ where: { aadhaarHash: hash, technicianId: { not: t.id } }, select: { id: true } });
    if (duplicate) throw new ConflictException('These Aadhaar details are linked to another account. Please contact support.');

    const dob = dto.dobOnAadhaar ? new Date(`${dto.dobOnAadhaar}T00:00:00.000Z`) : t.dateOfBirth;
    const nameOnAadhaar = dto.nameOnAadhaar.trim().replace(/\s+/g, ' ');
    const now = new Date();

    const baseData = {
      aadhaarLast4: number.slice(-4),
      aadhaarHash: hash,
      aadhaarEncrypted: this.policy.aadhaarStoreEncrypted ? this.crypto.encrypt(number) : null,
      nameOnAadhaar,
      dobOnAadhaar: dob,
      consentGiven: true,
      consentVersion: this.policy.aadhaarConsentVersion,
      consentAt: now,
      consentIp: ctx.ip ?? null,
      verificationStatus: VerificationStatus.IN_PROGRESS,
      verificationMethod: null,
      providerName: this.aadhaarProvider.name,
      providerRefId: null,
      verifiedAt: null,
      nameMatched: null,
      dobMatched: null,
      failureReason: null,
      nameMatchScore: nameMatchScore(nameOnAadhaar, t.fullName),
    };
    await this.prisma.$transaction(async (tx) => {
      await tx.aadhaarDetail.upsert({ where: { technicianId: t.id }, create: { technicianId: t.id, ...baseData }, update: baseData });
      // A different Aadhaar invalidates an address that came from the previous verification.
      if (t.aadhaar?.aadhaarHash !== hash && t.aadhaarAddress?.source === AddressSource.VERIFICATION_PROVIDER) {
        await tx.aadhaarAddress.update({
          where: { technicianId: t.id },
          data: { source: AddressSource.SELF_DECLARED, verificationStatus: AadhaarAddressStatus.UNVERIFIED, verifiedAt: null },
        });
      }
      await this.touch(tx, t);
    });
    await this.log(t, 'AADHAAR_CONSENT_CAPTURED', ctx, { consentVersion: this.policy.aadhaarConsentVersion, last4: number.slice(-4) });

    // The number lives only in memory for this provider call (unless policy permits encrypted storage).
    let result;
    try {
      result = await this.aadhaarProvider.verify({ technicianId: t.id, aadhaarNumber: number, nameOnAadhaar, dob });
    } catch {
      result = { outcome: 'UNAVAILABLE' as const, method: VerificationMethod.MANUAL, providerName: this.aadhaarProvider.name, reason: 'Provider error' };
    }

    const update: Prisma.AadhaarDetailUpdateInput = { providerName: result.providerName, providerRefId: result.referenceId ?? null };
    let addressFromProvider: AadhaarAddressResult | undefined;

    switch (result.outcome) {
      case 'VERIFIED': {
        const score = nameMatchScore(result.name ?? '', t.fullName);
        const nameOk = score >= this.policy.nameMatchThreshold;
        const dobOk = result.dob ? sameDate(result.dob, t.dateOfBirth) : null;
        update.nameMatchScore = score;
        update.nameMatched = nameOk;
        update.dobMatched = dobOk;
        update.verificationMethod = result.method;
        if (nameOk && dobOk !== false) {
          update.verificationStatus = VerificationStatus.VERIFIED;
          update.verifiedAt = new Date();
          addressFromProvider = result.address;
        } else {
          update.verificationStatus = VerificationStatus.FAILED;
          update.failureReason = !nameOk
            ? 'The name on your Aadhaar record does not match your registered name.'
            : 'The date of birth on your Aadhaar record does not match your registered date of birth.';
        }
        break;
      }
      case 'FAILED':
        update.verificationStatus = VerificationStatus.FAILED;
        update.verificationMethod = result.method;
        update.failureReason = result.reason ?? 'Aadhaar verification failed.';
        break;
      case 'IN_PROGRESS':
        update.verificationStatus = VerificationStatus.IN_PROGRESS;
        update.verificationMethod = result.method;
        break;
      case 'MANUAL_REVIEW':
      case 'UNAVAILABLE':
      default:
        // Fallback: authorised staff verify against the uploaded document.
        update.verificationStatus = VerificationStatus.MANUAL_REVIEW;
        update.verificationMethod = VerificationMethod.MANUAL;
        update.failureReason = result.outcome === 'UNAVAILABLE' ? 'Automatic verification unavailable; routed to manual review.' : null;
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.aadhaarDetail.update({ where: { technicianId: t.id }, data: update });
      if (addressFromProvider) await this.applyVerifiedAadhaarAddress(tx, t.id, addressFromProvider);
    });
    await this.log(t, 'AADHAAR_VERIFICATION_RESULT', ctx, {
      provider: result.providerName,
      outcome: result.outcome,
      status: update.verificationStatus as string,
      referenceId: result.referenceId ?? null,
      addressPopulated: !!addressFromProvider,
    });
    return { ...(await this.getState(t.id)), redirectUrl: result.redirectUrl ?? null };
  }

  /** Records an Aadhaar address returned by an authoritative source (provider / DigiLocker) as verified. */
  async applyVerifiedAadhaarAddress(tx: Tx, technicianId: string, a: AadhaarAddressResult) {
    const data = { ...cleanAddress(a), source: AddressSource.VERIFICATION_PROVIDER, verificationStatus: AadhaarAddressStatus.VERIFIED, verifiedAt: new Date() };
    await tx.aadhaarAddress.upsert({ where: { technicianId }, create: { technicianId, ...data }, update: data });
    await this.syncCurrentIfSame(tx, technicianId);
  }

  /** Keeps the current address in sync with the Aadhaar address while "same address" is ticked. */
  private async syncCurrentIfSame(tx: Tx, technicianId: string) {
    const t = await tx.technician.findUnique({ where: { id: technicianId }, include: { aadhaarAddress: true, currentAddress: true } });
    if (!t?.addressesSame || !t.aadhaarAddress) return;
    const fields = cleanAddress(t.aadhaarAddress as unknown as AddressFieldsDto);
    if (addressEquals(t.currentAddress as unknown as Record<string, unknown>, fields)) return;
    const data = { ...fields, source: AddressSource.COPIED_FROM_AADHAAR, verificationStatus: CurrentAddressStatus.SELF_DECLARED, verifiedAt: null };
    await tx.currentAddress.upsert({ where: { technicianId }, create: { technicianId, ...data }, update: data });
  }

  /** Technician opts into manual review after a failed / unavailable automatic verification. */
  async requestManualReview(technicianId: string, kind: 'aadhaar' | 'pan', ctx: ActionContext) {
    const t = await this.load(technicianId);
    this.assertEditable(t);
    const record = kind === 'aadhaar' ? t.aadhaar : t.pan;
    if (!record) throw new BadRequestException(`Submit your ${kind === 'aadhaar' ? 'Aadhaar' : 'PAN'} details first.`);
    const allowed: VerificationStatus[] = [VerificationStatus.FAILED, VerificationStatus.UNAVAILABLE, VerificationStatus.PENDING];
    if (!allowed.includes(record.verificationStatus)) throw new ConflictException('Manual review is not needed for the current status.');

    const category = kind === 'aadhaar' ? DocumentCategory.AADHAAR : DocumentCategory.PAN;
    const hasDoc = t.documents.some((d) => d.category === category && d.currentVersionId && d.status !== DocumentStatus.REJECTED && d.status !== DocumentStatus.REUPLOAD_REQUIRED);
    if (!hasDoc) throw new ConflictException(`Upload your ${kind === 'aadhaar' ? 'Aadhaar' : 'PAN'} card before requesting manual review.`);

    const data = { verificationStatus: VerificationStatus.MANUAL_REVIEW, verificationMethod: VerificationMethod.MANUAL };
    if (kind === 'aadhaar') await this.prisma.aadhaarDetail.update({ where: { technicianId: t.id }, data });
    else await this.prisma.panDetail.update({ where: { technicianId: t.id }, data });
    await this.log(t, `${kind.toUpperCase()}_MANUAL_REVIEW_REQUESTED`, ctx, { previousStatus: record.verificationStatus });
    return this.getState(t.id);
  }

  // ------------------------------------------------------------------ PAN --

  async submitPan(technicianId: string, dto: PanDto, ctx: ActionContext) {
    const t = await this.load(technicianId);
    this.assertEditable(t);
    if (!t.fullName) throw new ConflictException('Please complete your personal information first.');

    const pan = normalizePan(dto.pan);
    if (!pan) throw new BadRequestException('Enter a valid PAN, e.g. ABCPE1234F.');
    if (!isIndividualPan(pan)) throw new BadRequestException("Please provide your individual PAN (the 4th character must be 'P').");

    const hash = this.crypto.blindIndex('pan', pan);
    const duplicate = await this.prisma.panDetail.findFirst({ where: { panHash: hash, technicianId: { not: t.id } }, select: { id: true } });
    if (duplicate) throw new ConflictException('This PAN is linked to another account. Please contact support.');

    const holderName = dto.holderName.trim().replace(/\s+/g, ' ');
    const baseData = {
      panEncrypted: this.crypto.encrypt(pan),
      panHash: hash,
      panMasked: maskPan(pan),
      holderName,
      verificationStatus: VerificationStatus.IN_PROGRESS,
      verificationMethod: null,
      providerName: this.panProvider.name,
      providerRefId: null,
      verifiedAt: null,
      nameMatched: null,
      failureReason: null,
      nameMatchScore: nameMatchScore(holderName, t.fullName),
    };
    await this.prisma.$transaction(async (tx) => {
      await tx.panDetail.upsert({ where: { technicianId: t.id }, create: { technicianId: t.id, ...baseData }, update: baseData });
      await this.touch(tx, t);
    });

    let result;
    try {
      result = await this.panProvider.verify({ technicianId: t.id, pan, holderName, dob: t.dateOfBirth });
    } catch {
      result = { outcome: 'UNAVAILABLE' as const, method: VerificationMethod.MANUAL, providerName: this.panProvider.name, reason: 'Provider error' };
    }

    const update: Prisma.PanDetailUpdateInput = { providerName: result.providerName, providerRefId: result.referenceId ?? null };
    if (result.outcome === 'VERIFIED') {
      const score = nameMatchScore(result.registeredName ?? '', t.fullName);
      const nameOk = score >= this.policy.nameMatchThreshold;
      const statusOk = !result.panStatus || result.panStatus.toUpperCase() === 'VALID';
      update.nameMatchScore = score;
      update.nameMatched = nameOk;
      update.verificationMethod = result.method;
      if (nameOk && statusOk) {
        update.verificationStatus = VerificationStatus.VERIFIED;
        update.verifiedAt = new Date();
      } else {
        update.verificationStatus = VerificationStatus.FAILED;
        update.failureReason = !statusOk ? `PAN is reported as ${result.panStatus}.` : 'The name on your PAN does not match your registered name.';
      }
    } else if (result.outcome === 'FAILED') {
      update.verificationStatus = VerificationStatus.FAILED;
      update.verificationMethod = result.method;
      update.failureReason = result.reason ?? 'PAN verification failed.';
    } else {
      update.verificationStatus = VerificationStatus.MANUAL_REVIEW;
      update.verificationMethod = VerificationMethod.MANUAL;
      update.failureReason = result.outcome === 'UNAVAILABLE' ? 'Automatic verification unavailable; routed to manual review.' : null;
    }
    await this.prisma.panDetail.update({ where: { technicianId: t.id }, data: update });
    await this.log(t, 'PAN_VERIFICATION_RESULT', ctx, {
      provider: result.providerName,
      outcome: result.outcome,
      status: update.verificationStatus as string,
      referenceId: result.referenceId ?? null,
      pan: maskPan(pan),
    });
    return this.getState(t.id);
  }

  // ------------------------------------------------------------ addresses --

  async updateAddresses(technicianId: string, dto: AddressesDto, ctx: ActionContext) {
    const t = await this.load(technicianId);
    this.assertEditable(t);

    const aadhaarLocked =
      t.aadhaarAddress?.source === AddressSource.VERIFICATION_PROVIDER && t.aadhaarAddress.verificationStatus === AadhaarAddressStatus.VERIFIED;

    await this.prisma.$transaction(async (tx) => {
      if (dto.aadhaarAddress) {
        const fields = cleanAddress(dto.aadhaarAddress);
        if (aadhaarLocked) {
          if (!addressEquals(t.aadhaarAddress as unknown as Record<string, unknown>, fields)) {
            throw new ConflictException('Your Aadhaar address was filled from verification and cannot be edited.');
          }
        } else if (!addressEquals(t.aadhaarAddress as unknown as Record<string, unknown>, fields)) {
          // Technician-provided Aadhaar address is clearly marked as unverified.
          const data = { ...fields, source: AddressSource.SELF_DECLARED, verificationStatus: AadhaarAddressStatus.UNVERIFIED, verifiedAt: null };
          await tx.aadhaarAddress.upsert({ where: { technicianId: t.id }, create: { technicianId: t.id, ...data }, update: data });
        }
      }
      const aadhaarAddress = await tx.aadhaarAddress.findUnique({ where: { technicianId: t.id } });

      if (dto.addressesSame) {
        if (!aadhaarAddress) throw new BadRequestException('Add your Aadhaar address before marking the addresses as the same.');
        const fields = cleanAddress(aadhaarAddress as unknown as AddressFieldsDto);
        const landmark = dto.landmark?.trim() || dto.currentAddress?.landmark?.trim() || null;
        const unchanged = addressEquals(t.currentAddress as unknown as Record<string, unknown>, fields) && t.currentAddress?.landmark === landmark;
        if (!unchanged) {
          const data = { ...fields, landmark, source: AddressSource.COPIED_FROM_AADHAAR, verificationStatus: CurrentAddressStatus.SELF_DECLARED, verifiedAt: null };
          await tx.currentAddress.upsert({ where: { technicianId: t.id }, create: { technicianId: t.id, ...data }, update: data });
        }
      } else {
        if (!dto.currentAddress) throw new BadRequestException('Enter your current residential address.');
        const fields = cleanAddress(dto.currentAddress);
        const landmark = dto.currentAddress.landmark?.trim() || null;
        const unchanged =
          addressEquals(t.currentAddress as unknown as Record<string, unknown>, fields) &&
          t.currentAddress?.landmark === landmark &&
          t.currentAddress?.source !== AddressSource.COPIED_FROM_AADHAAR;
        if (!unchanged) {
          const data = { ...fields, landmark, source: AddressSource.SELF_DECLARED, verificationStatus: CurrentAddressStatus.SELF_DECLARED, verifiedAt: null };
          await tx.currentAddress.upsert({ where: { technicianId: t.id }, create: { technicianId: t.id, ...data }, update: data });
        }
      }
      await tx.technician.update({ where: { id: t.id }, data: { addressesSame: dto.addressesSame } });
      await this.touch(tx, t);
    });
    await this.log(t, 'ADDRESSES_UPDATED', ctx, { addressesSame: dto.addressesSame });
    return this.getState(t.id);
  }

  // ----------------------------------------------------------------- bank --

  async updateBank(technicianId: string, dto: BankDto, ctx: ActionContext) {
    const t = await this.load(technicianId);
    this.assertEditable(t);
    if (dto.accountNumber !== dto.confirmAccountNumber) throw new BadRequestException('Account numbers do not match.');

    const ifsc = dto.ifsc.toUpperCase();
    const hash = this.crypto.blindIndex('bank', `${ifsc}:${dto.accountNumber}`);
    const duplicate = await this.prisma.bankDetail.findFirst({ where: { accountHash: hash, technicianId: { not: t.id } }, select: { id: true } });
    if (duplicate) throw new ConflictException('This bank account is linked to another account. Please contact support.');

    const unchanged = t.bank?.accountHash === hash && t.bank.accountHolderName === dto.accountHolderName.trim();
    const data = {
      accountHolderName: dto.accountHolderName.trim().replace(/\s+/g, ' '),
      accountEncrypted: this.crypto.encrypt(dto.accountNumber),
      accountLast4: dto.accountNumber.slice(-4),
      accountHash: hash,
      ifsc,
      bankName: dto.bankName.trim(),
      branchName: dto.branchName?.trim() || null,
      // Any change to the account requires fresh review.
      ...(unchanged ? {} : { verificationStatus: VerificationStatus.PENDING, verificationMethod: null, verifiedAt: null }),
    };
    await this.prisma.$transaction(async (tx) => {
      await tx.bankDetail.upsert({ where: { technicianId: t.id }, create: { technicianId: t.id, ...data }, update: data });
      await this.touch(tx, t);
    });
    await this.log(t, 'BANK_DETAILS_UPDATED', ctx, { last4: data.accountLast4, ifsc });
    return this.getState(t.id);
  }

  // --------------------------------------------------------------- submit --

  async submit(technicianId: string, ctx: ActionContext) {
    const t = await this.load(technicianId);
    const blockers = submissionBlockers(t, this.policy);
    if (blockers.length) throw new BadRequestException({ message: 'Your application is not complete yet.', details: { blockers } });

    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      // Optimistic guard against double submission.
      const res = await tx.technician.updateMany({
        where: { id: t.id, kycStatus: t.kycStatus },
        data: { kycStatus: KycStatus.SUBMITTED, submittedAt: now, submissionCount: { increment: 1 }, rejectionReason: null },
      });
      if (res.count !== 1) throw new ConflictException('Application status changed. Please refresh and try again.');
      await tx.document.updateMany({ where: { technicianId: t.id, status: DocumentStatus.UPLOADED }, data: { status: DocumentStatus.PENDING_VERIFICATION } });
      await tx.kycFeedback.updateMany({ where: { technicianId: t.id, resolved: false }, data: { resolved: true, resolvedAt: now } });
    });
    await this.log(t, t.kycStatus === KycStatus.ACTION_REQUIRED ? 'KYC_RESUBMITTED' : 'KYC_SUBMITTED', ctx, { submission: t.submissionCount + 1 });
    return this.getState(t.id);
  }
}
