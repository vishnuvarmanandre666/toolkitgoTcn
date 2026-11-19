import { Global, Injectable, Logger, Module } from '@nestjs/common';
import { ActorType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditEntry {
  actorType: ActorType;
  actorId?: string | null;
  technicianId?: string | null;
  action: string;
  entityType?: string;
  entityId?: string;
  /** Must never contain raw identifiers, OTPs or document contents. */
  metadata?: Prisma.InputJsonValue;
  ip?: string | null;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger('Audit');
  constructor(private readonly prisma: PrismaService) {}

  /** Audit writes never break the main request flow. */
  async log(entry: AuditEntry, tx?: Prisma.TransactionClient): Promise<void> {
    try {
      await (tx ?? this.prisma).auditLog.create({ data: { ...entry } });
    } catch (err) {
      this.logger.error(`Failed to write audit log ${entry.action}: ${(err as Error).message}`);
    }
  }

  list(technicianId: string, take = 200) {
    return this.prisma.auditLog.findMany({ where: { technicianId }, orderBy: { createdAt: 'desc' }, take });
  }
}

@Global()
@Module({ providers: [AuditService], exports: [AuditService] })
export class AuditModule {}
