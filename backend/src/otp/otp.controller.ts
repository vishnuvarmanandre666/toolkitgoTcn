import { BadRequestException, Body, Controller, Get, HttpCode, Post, Query, Req, Res } from '@nestjs/common';
import { ActorType, VerificationStatus } from '@prisma/client';
import { IsString, Length, Matches } from 'class-validator';
import { Request, Response } from 'express';
import { AuditService } from '../audit/audit.service';
import { SessionService, TECH_COOKIE } from '../auth/session.service';
import { maskPhone, normalizeIndianMobile, toStoredPhone } from '../common/utils/identity';
import { clientIp } from '../common/utils/request';
import { PrismaService } from '../prisma/prisma.service';
import { OtpService } from './otp.service';
import { TechnicianLoginService } from '../auth/technician-login.service';

class PhoneDto {
  @IsString()
  @Length(10, 16)
  phone: string;
}

class VerifyOtpDto extends PhoneDto {
  @IsString()
  @Matches(/^\d{6}$/, { message: 'OTP must be 6 digits' })
  otp: string;
}

function parsePhone(raw: string): string {
  const p = normalizeIndianMobile(raw);
  if (!p) throw new BadRequestException('Enter a valid 10-digit Indian mobile number.');
  return p;
}

@Controller('otp')
export class OtpController {
  constructor(
    private readonly otp: OtpService,
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    private readonly login: TechnicianLoginService,
  ) {}

  @Post('send')
  @HttpCode(200)
  async send(@Body() dto: PhoneDto, @Req() req: Request) {
    const phone = parsePhone(dto.phone);
    const result = await this.otp.send(phone, clientIp(req), false);
    await this.audit.log({ actorType: ActorType.SYSTEM, action: 'OTP_SENT', metadata: { phone: maskPhone(phone) }, ip: clientIp(req) });
    return { message: 'If the number is valid, an OTP has been sent.', ...result };
  }

  @Post('resend')
  @HttpCode(200)
  async resend(@Body() dto: PhoneDto, @Req() req: Request) {
    const phone = parsePhone(dto.phone);
    const result = await this.otp.send(phone, clientIp(req), true);
    await this.audit.log({ actorType: ActorType.SYSTEM, action: 'OTP_RESENT', metadata: { phone: maskPhone(phone) }, ip: clientIp(req) });
    return { message: 'A new OTP has been sent.', ...result };
  }

  /**
   * Verifies the OTP, persists mobile verification on the technician account
   * (creating it on first registration) and starts a technician session.
   */
  @Post('verify')
  @HttpCode(200)
  async verify(@Body() dto: VerifyOtpDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const phone = parsePhone(dto.phone);
    await this.otp.verify(phone, dto.otp);

    return this.login.completeLogin(phone, res, clientIp(req), 'internal_otp');
  }

  /**
   * OTP state for a number. Mobile verification status is only disclosed to the
   * technician who owns the number (prevents account enumeration).
   */
  @Get('status')
  async status(@Query('phone') rawPhone: string, @Req() req: Request) {
    const phone = parsePhone(rawPhone ?? '');
    const state = await this.otp.status(phone);
    let mobileVerified: boolean | null = null;
    const claims = this.sessions.verifyTechnician(req.cookies?.[TECH_COOKIE]);
    if (claims && claims.phone === toStoredPhone(phone)) {
      const t = await this.prisma.technician.findUnique({ where: { id: claims.sub }, select: { mobileVerification: true } });
      mobileVerified = t?.mobileVerification === VerificationStatus.VERIFIED;
    }
    return { phone: maskPhone(phone), mobileVerified, ...state };
  }
}
