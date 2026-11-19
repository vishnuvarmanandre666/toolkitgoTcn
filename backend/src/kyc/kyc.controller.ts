import { Body, Controller, Get, HttpCode, Post, Put, Req, Res, UseGuards } from '@nestjs/common';
import { ActorType } from '@prisma/client';
import { Request, Response } from 'express';
import { AuditService } from '../audit/audit.service';
import { AuthedTechnician, CurrentTechnician, TechnicianAuthGuard } from '../auth/guards';
import { SessionService, TECH_COOKIE } from '../auth/session.service';
import { clientIp } from '../common/utils/request';
import { AadhaarDto, AddressesDto, BankDto, PanDto, PersonalInfoDto } from './kyc.dto';
import { KycService } from './kyc.service';

@Controller('technician')
@UseGuards(TechnicianAuthGuard)
export class TechnicianKycController {
  constructor(
    private readonly kyc: KycService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
  ) {}

  /** Full onboarding state for the dashboard (masked). */
  @Get('kyc')
  state(@CurrentTechnician() t: AuthedTechnician) {
    return this.kyc.getState(t.id);
  }

  @Put('kyc/personal')
  personal(@CurrentTechnician() t: AuthedTechnician, @Body() dto: PersonalInfoDto, @Req() req: Request) {
    return this.kyc.updatePersonal(t.id, dto, { ip: clientIp(req) });
  }

  /** Captures consent + Aadhaar details and runs verification in the same request. */
  @Post('kyc/aadhaar')
  @HttpCode(200)
  aadhaar(@CurrentTechnician() t: AuthedTechnician, @Body() dto: AadhaarDto, @Req() req: Request) {
    return this.kyc.submitAadhaar(t.id, dto, { ip: clientIp(req) });
  }

  @Post('kyc/aadhaar/manual-review')
  @HttpCode(200)
  aadhaarManual(@CurrentTechnician() t: AuthedTechnician, @Req() req: Request) {
    return this.kyc.requestManualReview(t.id, 'aadhaar', { ip: clientIp(req) });
  }

  @Post('kyc/pan')
  @HttpCode(200)
  pan(@CurrentTechnician() t: AuthedTechnician, @Body() dto: PanDto, @Req() req: Request) {
    return this.kyc.submitPan(t.id, dto, { ip: clientIp(req) });
  }

  @Post('kyc/pan/manual-review')
  @HttpCode(200)
  panManual(@CurrentTechnician() t: AuthedTechnician, @Req() req: Request) {
    return this.kyc.requestManualReview(t.id, 'pan', { ip: clientIp(req) });
  }

  @Put('kyc/addresses')
  addresses(@CurrentTechnician() t: AuthedTechnician, @Body() dto: AddressesDto, @Req() req: Request) {
    return this.kyc.updateAddresses(t.id, dto, { ip: clientIp(req) });
  }

  @Put('kyc/bank')
  bank(@CurrentTechnician() t: AuthedTechnician, @Body() dto: BankDto, @Req() req: Request) {
    return this.kyc.updateBank(t.id, dto, { ip: clientIp(req) });
  }

  @Post('kyc/submit')
  @HttpCode(200)
  submit(@CurrentTechnician() t: AuthedTechnician, @Req() req: Request) {
    return this.kyc.submit(t.id, { ip: clientIp(req) });
  }

  @Post('logout')
  @HttpCode(200)
  async logout(@CurrentTechnician() t: AuthedTechnician, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    this.sessions.clear(res, TECH_COOKIE);
    await this.audit.log({ actorType: ActorType.TECHNICIAN, actorId: t.id, technicianId: t.id, action: 'TECHNICIAN_LOGOUT', ip: clientIp(req) });
    return { loggedOut: true };
  }
}
