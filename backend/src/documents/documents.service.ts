import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ActorType, DocumentCategory, DocumentStatus, KycStatus, ScanStatus } from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import { AuditService } from '../audit/audit.service';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { isEditable, MULTI_DOCUMENT_CATEGORIES } from '../kyc/kyc-rules';
import { PrismaService } from '../prisma/prisma.service';
import { KIND_INFO, validateUpload } from './file-validation';
import { MalwareScannerService } from './malware-scanner.service';
import { StorageService } from './storage/storage.service';

export interface UploadedFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

/** Statuses from which a technician may replace a document while their application is locked. */
const REPLACEABLE_WHEN_LOCKED: DocumentStatus[] = [DocumentStatus.REJECTED, DocumentStatus.REUPLOAD_REQUIRED];

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger('Documents');

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly scanner: MalwareScannerService,
    private readonly audit: AuditService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async upload(
    technicianId: string,
    input: { category: DocumentCategory; label?: string; documentId?: string },
    file: UploadedFile | undefined,
    ip?: string,
  ) {
    if (!file) throw new BadRequestException('Please choose a file to upload.');
    const tech = await this.prisma.technician.findUnique({ where: { id: technicianId }, select: { id: true, kycStatus: true } });
    if (!tech) throw new NotFoundException('Technician not found.');

    // Locate (or create) the logical document this upload belongs to.
    let doc = input.documentId
      ? await this.prisma.document.findFirst({ where: { id: input.documentId, technicianId } })
      : MULTI_DOCUMENT_CATEGORIES.includes(input.category)
        ? null
        : await this.prisma.document.findFirst({ where: { technicianId, category: input.category } });
    if (input.documentId && !doc) throw new NotFoundException('Document not found.');
    if (doc && doc.category !== input.category) throw new BadRequestException('Document category mismatch.');

    if (!isEditable(tech.kycStatus) && !(doc && REPLACEABLE_WHEN_LOCKED.includes(doc.status))) {
      throw new ConflictException('Documents cannot be changed while your application is under review.');
    }
    if (tech.kycStatus === KycStatus.APPROVED || tech.kycStatus === KycStatus.REJECTED) {
      throw new ConflictException('Documents cannot be changed for a closed application. Contact support.');
    }

    const check = validateUpload(file, input.category, this.config.uploads.maxBytes);
    if (!check.ok) throw new UnprocessableEntityException(check.error);
    const kind = KIND_INFO[check.kind!];

    const scan = await this.scanner.scan(file.buffer);
    if (scan.status === ScanStatus.INFECTED) {
      await this.audit.log({ actorType: ActorType.TECHNICIAN, actorId: technicianId, technicianId, action: 'DOCUMENT_MALWARE_BLOCKED', metadata: { category: input.category, signature: scan.detail ?? null }, ip });
      throw new UnprocessableEntityException('This file failed our security scan and was not uploaded.');
    }
    if (scan.status === ScanStatus.ERROR) throw new ServiceUnavailableException('Security scan is unavailable. Please try again shortly.');

    const now = new Date();
    // Opaque random key: reveals nothing about the technician or document type.
    const objectKey = `kyc/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${randomUUID()}${kind.ext}`;
    await this.storage.put(objectKey, file.buffer, kind.mime);

    const safeName = file.originalname.replace(/[^\w.\- ]/g, '_').slice(-120);
    const label = input.label?.trim().slice(0, 120) || null;
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        if (!doc) {
          doc = await tx.document.create({ data: { technicianId, category: input.category, label } });
        }
        const last = await tx.documentVersion.findFirst({ where: { documentId: doc.id }, orderBy: { version: 'desc' }, select: { version: true } });
        const version = await tx.documentVersion.create({
          data: {
            documentId: doc.id,
            version: (last?.version ?? 0) + 1,
            objectKey,
            originalName: safeName,
            mimeType: kind.mime,
            sizeBytes: file.size,
            sha256: createHash('sha256').update(file.buffer).digest('hex'),
            scanStatus: scan.status,
            scanDetail: scan.detail ?? null,
            status: DocumentStatus.UPLOADED,
          },
        });
        if (doc.currentVersionId) {
          await tx.documentVersion.update({ where: { id: doc.currentVersionId }, data: { supersededAt: now } });
        }
        const wasReuploadRequest = REPLACEABLE_WHEN_LOCKED.includes(doc.status);
        const updated = await tx.document.update({
          where: { id: doc.id },
          data: {
            currentVersionId: version.id,
            // While the application is already submitted, new uploads go straight to the review queue.
            status: isEditable(tech.kycStatus) ? DocumentStatus.UPLOADED : DocumentStatus.PENDING_VERIFICATION,
            label: label ?? doc.label,
            rejectionReason: null,
            reviewedAt: null,
            reviewedById: null,
          },
        });
        if (wasReuploadRequest) {
          await tx.kycFeedback.updateMany({ where: { technicianId, documentId: doc.id, resolved: false }, data: { resolved: true, resolvedAt: now } });
        }
        return { document: updated, version };
      });

      await this.audit.log({
        actorType: ActorType.TECHNICIAN,
        actorId: technicianId,
        technicianId,
        action: result.version.version > 1 ? 'DOCUMENT_REPLACED' : 'DOCUMENT_UPLOADED',
        entityType: 'Document',
        entityId: result.document.id,
        metadata: { category: input.category, version: result.version.version, sizeBytes: file.size, mimeType: kind.mime, scanStatus: scan.status },
        ip,
      });
      return {
        id: result.document.id,
        category: result.document.category,
        status: result.document.status,
        version: result.version.version,
        scanStatus: result.version.scanStatus,
      };
    } catch (err) {
      // Don't leave orphaned objects in storage if the DB write failed.
      await this.storage.delete(objectKey).catch(() => undefined);
      throw err;
    }
  }

  /** Optional documents (certificates / other) may be removed while the application is editable. */
  async remove(technicianId: string, documentId: string, ip?: string) {
    const doc = await this.prisma.document.findFirst({ where: { id: documentId, technicianId }, include: { technician: { select: { kycStatus: true } } } });
    if (!doc) throw new NotFoundException('Document not found.');
    if (!MULTI_DOCUMENT_CATEGORIES.includes(doc.category)) throw new BadRequestException('Required documents can be replaced but not removed.');
    if (!isEditable(doc.technician.kycStatus)) throw new ConflictException('Documents cannot be removed while your application is under review.');
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.document.update({ where: { id: doc.id }, data: { currentVersionId: null, status: DocumentStatus.NOT_UPLOADED } }),
      this.prisma.documentVersion.updateMany({ where: { documentId: doc.id, supersededAt: null }, data: { supersededAt: now } }),
    ]);
    await this.audit.log({ actorType: ActorType.TECHNICIAN, actorId: technicianId, technicianId, action: 'DOCUMENT_REMOVED', entityType: 'Document', entityId: doc.id, ip });
    return { removed: true };
  }

  async listVersions(documentId: string, technicianId?: string) {
    const doc = await this.prisma.document.findFirst({
      where: { id: documentId, ...(technicianId ? { technicianId } : {}) },
      include: { versions: { orderBy: { version: 'desc' } } },
    });
    if (!doc) throw new NotFoundException('Document not found.');
    return doc.versions.map((v) => ({
      id: v.id,
      version: v.version,
      originalName: v.originalName,
      mimeType: v.mimeType,
      sizeBytes: v.sizeBytes,
      scanStatus: v.scanStatus,
      status: v.status,
      reviewNote: v.reviewNote,
      uploadedAt: v.uploadedAt,
      supersededAt: v.supersededAt,
      purged: !!v.purgedAt,
      isCurrent: v.id === doc.currentVersionId,
    }));
  }

  /**
   * Issues a short-lived signed URL after an access check.
   * @param scope technician: may only access own documents. admin: any document.
   */
  async signedUrl(scope: { technicianId?: string; adminId?: string }, documentId: string, versionId?: string, ip?: string) {
    const doc = await this.prisma.document.findUnique({ where: { id: documentId } });
    if (!doc) throw new NotFoundException('Document not found.');
    if (scope.technicianId && doc.technicianId !== scope.technicianId) throw new ForbiddenException('Access denied.');
    if (!scope.technicianId && !scope.adminId) throw new ForbiddenException('Access denied.');

    const vid = versionId ?? doc.currentVersionId;
    if (!vid) throw new NotFoundException('No file uploaded for this document.');
    const version = await this.prisma.documentVersion.findFirst({ where: { id: vid, documentId: doc.id } });
    if (!version) throw new NotFoundException('Version not found.');
    if (version.purgedAt) throw new NotFoundException('This version was deleted under the retention policy.');
    // Technicians can only see their current file; history is staff-only.
    if (scope.technicianId && version.id !== doc.currentVersionId) throw new ForbiddenException('Access denied.');

    const signed = await this.storage.signedUrl(version.objectKey, {
      filename: version.originalName,
      contentType: version.mimeType,
      inline: true,
    });
    await this.audit.log({
      actorType: scope.adminId ? ActorType.ADMIN : ActorType.TECHNICIAN,
      actorId: scope.adminId ?? scope.technicianId,
      technicianId: doc.technicianId,
      action: 'DOCUMENT_ACCESSED',
      entityType: 'DocumentVersion',
      entityId: version.id,
      metadata: { category: doc.category, version: version.version },
      ip,
    });
    return { ...signed, mimeType: version.mimeType, fileName: version.originalName };
  }

  /**
   * Retention: superseded versions (replaced or removed files) are deleted from
   * storage after DOCUMENT_VERSION_RETENTION_DAYS. Metadata rows are kept for
   * the audit trail with `purgedAt` set.
   */
  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async purgeExpiredVersions(): Promise<number> {
    const cutoff = new Date(Date.now() - this.config.uploads.retentionDays * 86_400_000);
    const expired = await this.prisma.documentVersion.findMany({
      where: { supersededAt: { lt: cutoff }, purgedAt: null },
      take: 500,
      include: { document: { select: { technicianId: true } } },
    });
    let purged = 0;
    for (const v of expired) {
      try {
        await this.storage.delete(v.objectKey);
        await this.prisma.documentVersion.update({ where: { id: v.id }, data: { purgedAt: new Date() } });
        await this.audit.log({ actorType: ActorType.SYSTEM, technicianId: v.document.technicianId, action: 'DOCUMENT_VERSION_PURGED', entityType: 'DocumentVersion', entityId: v.id });
        purged++;
      } catch (err) {
        this.logger.error(`Failed to purge version ${v.id}: ${(err as Error).message}`);
      }
    }
    if (purged) this.logger.log(`Retention purge removed ${purged} superseded document version(s)`);
    return purged;
  }
}
