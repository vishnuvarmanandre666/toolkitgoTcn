import { ConflictException, Injectable } from '@nestjs/common';
import { ActorType, VerificationStatus } from '@prisma/client';
import { Response } from 'express';
import { AuditService } from '../audit/audit.service';
import { maskPhone, toStoredPhone } from '../common/utils/identity';
import { PrismaService } from '../prisma/prisma.service';
import { SessionService } from './session.service';

export type LoginMethod = 'internal_otp' | 'supabase_otp';

/**
 * Shared final step of every technician login: the phone number has been
 * proven (our own OTP or Supabase Auth). Creates the technician on first
 * login, records mobile verification and issues the ToolkitGo session cookie.
 */
@Injectable()
export class TechnicianLoginService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
  ) {}

  async completeLogin(tenDigitPhone: string, res: Response, ip: string, method: LoginMethod, supabaseUserId?: string) {
    const stored = toStoredPhone(tenDigitPhone);
    const now = new Date();
    const existing = await this.prisma.technician.findUnique({ where: { phone: stored }, select: { id: true, supabaseUserId: true } });

    // A phone number already linked to a different Supabase user must not be taken over.
    if (supabaseUserId && existing?.supabaseUserId && existing.supabaseUserId !== supabaseUserId) {
      throw new ConflictException('This mobile number is linked to a different login. Please contact support.');
    }

    const verified = { mobileVerification: VerificationStatus.VERIFIED, phoneVerifiedAt: now, ...(supabaseUserId ? { supabaseUserId } : {}) };
    const tech = await this.prisma.technician.upsert({
      where: { phone: stored },
      create: { phone: stored, ...verified },
      update: verified,
      select: { id: true, phone: true, kycStatus: true },
    });
    const isNew = !existing;

    await this.audit.log({
      actorType: ActorType.TECHNICIAN,
      actorId: tech.id,
      technicianId: tech.id,
      action: isNew ? 'TECHNICIAN_REGISTERED' : 'TECHNICIAN_LOGIN',
      metadata: { phone: maskPhone(tenDigitPhone), method },
      ip,
    });
    this.sessions.issueTechnician(res, tech.id, tech.phone);
    return { verified: true, technicianId: tech.id, kycStatus: tech.kycStatus, isNewRegistration: isNew };
  }
}
