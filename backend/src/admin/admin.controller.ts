import { BadRequestException, Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { AdminRole } from '@prisma/client';
import { Request, Response } from 'express';
import { AdminAuthGuard, AuthedAdmin, CurrentAdmin, Roles } from '../auth/guards';
import { ADMIN_COOKIE, SessionService } from '../auth/session.service';
import { clientIp } from '../common/utils/request';
import {
  AdminLoginDto,
  CreateStaffDto,
  ListApplicationsQuery,
  OptionalNoteDto,
  ReasonDto,
  RequestActionDto,
  RevealDto,
  ReviewDocumentDto,
  SetVerificationDto,
  UpdateStaffDto,
  VERIFICATION_SECTIONS,
  VerificationSection,
} from './admin.dto';
import { AdminService } from './admin.service';

@Controller('admin/auth')
export class AdminAuthController {
  constructor(
    private readonly admin: AdminService,
    private readonly sessions: SessionService,
  ) {}

  @Post('login')
  @HttpCode(200)
  async login(@Body() dto: AdminLoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const user = await this.admin.login(dto.email, dto.password, clientIp(req));
    this.sessions.issueAdmin(res, user.id, user.role);
    return user;
  }

  @Post('logout')
  @HttpCode(200)
  logout(@Res({ passthrough: true }) res: Response) {
    this.sessions.clear(res, ADMIN_COOKIE);
    return { loggedOut: true };
  }

  @Get('me')
  @UseGuards(AdminAuthGuard)
  me(@CurrentAdmin() admin: AuthedAdmin) {
    return admin;
  }
}

/**
 * Review endpoints. REVIEWER (office staff) can review documents, set
 * verification statuses and request changes. Final approve / reject /
 * activate and sensitive reveals require ADMIN (or SUPER_ADMIN).
 */
@Controller('admin')
@UseGuards(AdminAuthGuard)
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('stats')
  stats() {
    return this.admin.stats();
  }

  @Get('applications')
  list(@Query() q: ListApplicationsQuery) {
    return this.admin.list(q);
  }

  @Get('applications/:id')
  detail(@Param('id') id: string) {
    return this.admin.detail(id);
  }

  @Post('applications/:id/start-review')
  @HttpCode(200)
  startReview(@Param('id') id: string, @CurrentAdmin() a: AuthedAdmin, @Req() req: Request) {
    return this.admin.startReview(id, a, clientIp(req));
  }

  @Patch('applications/:id/verifications/:section')
  setVerification(
    @Param('id') id: string,
    @Param('section') section: string,
    @Body() dto: SetVerificationDto,
    @CurrentAdmin() a: AuthedAdmin,
    @Req() req: Request,
  ) {
    if (!VERIFICATION_SECTIONS.includes(section as VerificationSection)) throw new BadRequestException('Unknown verification section.');
    return this.admin.setVerification(id, section as VerificationSection, dto, a, clientIp(req));
  }

  @Post('applications/:id/request-action')
  @HttpCode(200)
  requestAction(@Param('id') id: string, @Body() dto: RequestActionDto, @CurrentAdmin() a: AuthedAdmin, @Req() req: Request) {
    return this.admin.requestAction(id, dto, a, clientIp(req));
  }

  @Post('applications/:id/approve')
  @HttpCode(200)
  @Roles(AdminRole.ADMIN)
  approve(@Param('id') id: string, @Body() dto: OptionalNoteDto, @CurrentAdmin() a: AuthedAdmin, @Req() req: Request) {
    return this.admin.approve(id, dto.note, a, clientIp(req));
  }

  @Post('applications/:id/reject')
  @HttpCode(200)
  @Roles(AdminRole.ADMIN)
  reject(@Param('id') id: string, @Body() dto: ReasonDto, @CurrentAdmin() a: AuthedAdmin, @Req() req: Request) {
    return this.admin.reject(id, dto.reason, a, clientIp(req));
  }

  @Post('applications/:id/activate')
  @HttpCode(200)
  @Roles(AdminRole.ADMIN)
  activate(@Param('id') id: string, @CurrentAdmin() a: AuthedAdmin, @Req() req: Request) {
    return this.admin.setActive(id, true, undefined, a, clientIp(req));
  }

  @Post('applications/:id/deactivate')
  @HttpCode(200)
  @Roles(AdminRole.ADMIN)
  deactivate(@Param('id') id: string, @Body() dto: ReasonDto, @CurrentAdmin() a: AuthedAdmin, @Req() req: Request) {
    return this.admin.setActive(id, false, dto.reason, a, clientIp(req));
  }

  @Post('applications/:id/reveal')
  @HttpCode(200)
  @Roles(AdminRole.ADMIN)
  reveal(@Param('id') id: string, @Body() dto: RevealDto, @CurrentAdmin() a: AuthedAdmin, @Req() req: Request) {
    return this.admin.reveal(id, dto.field, dto.reason, a, clientIp(req));
  }

  @Get('applications/:id/audit')
  audit(@Param('id') id: string) {
    return this.admin.auditTrail(id);
  }

  @Patch('documents/:docId/review')
  reviewDocument(@Param('docId') docId: string, @Body() dto: ReviewDocumentDto, @CurrentAdmin() a: AuthedAdmin, @Req() req: Request) {
    return this.admin.reviewDocument(docId, dto, a, clientIp(req));
  }

  @Get('documents/:docId/versions')
  versions(@Param('docId') docId: string) {
    return this.admin.versions(docId);
  }

  @Get('documents/:docId/url')
  url(@Param('docId') docId: string, @Query('versionId') versionId: string | undefined, @CurrentAdmin() a: AuthedAdmin, @Req() req: Request) {
    return this.admin.documentUrl(docId, versionId, a, clientIp(req));
  }

  @Get('staff')
  @Roles(AdminRole.SUPER_ADMIN)
  staff() {
    return this.admin.listStaff();
  }

  @Post('staff')
  @Roles(AdminRole.SUPER_ADMIN)
  createStaff(@Body() dto: CreateStaffDto, @CurrentAdmin() a: AuthedAdmin, @Req() req: Request) {
    return this.admin.createStaff(dto, a, clientIp(req));
  }

  @Patch('staff/:id')
  @Roles(AdminRole.SUPER_ADMIN)
  updateStaff(@Param('id') id: string, @Body() dto: UpdateStaffDto, @CurrentAdmin() a: AuthedAdmin, @Req() req: Request) {
    return this.admin.updateStaff(id, dto, a, clientIp(req));
  }
}
