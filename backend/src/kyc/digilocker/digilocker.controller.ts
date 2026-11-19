import { Controller, Get, HttpCode, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { Request, Response } from 'express';
import { AuthedTechnician, CurrentTechnician, TechnicianAuthGuard } from '../../auth/guards';
import { clientIp } from '../../common/utils/request';
import { DigilockerService } from './digilocker.service';

@Controller('technician/kyc/digilocker')
@UseGuards(TechnicianAuthGuard)
export class DigilockerStartController {
  constructor(private readonly dl: DigilockerService) {}

  /** Returns the DigiLocker consent URL; the browser navigates there. */
  @Post('start')
  @HttpCode(200)
  start(@CurrentTechnician() t: AuthedTechnician, @Req() req: Request) {
    return this.dl.start(t.id, clientIp(req));
  }
}

/** Public endpoints hit by the browser redirect from DigiLocker (authenticated by the single-use state). */
@Controller('kyc/digilocker')
export class DigilockerCallbackController {
  constructor(private readonly dl: DigilockerService) {}

  @Get('callback')
  async callback(@Query() q: Record<string, string>, @Res() res: Response) {
    const out = await this.dl.handleCallback({ code: q.code, state: q.state, error: q.error, error_description: q.error_description });
    const params = new URLSearchParams({ digilocker: out.result });
    if (out.aadhaar) params.set('aadhaar', out.aadhaar);
    if (out.pan) params.set('pan', out.pan);
    if (out.message) params.set('msg', out.message.slice(0, 160));
    res.setHeader('Cache-Control', 'no-store');
    res.redirect(302, `/onboarding?${params}`);
  }

  /** Sandbox consent screen (DIGILOCKER_MODE=mock only). */
  @Get('mock/authorize')
  async mockAuthorize(@Query('state') state: string, @Res() res: Response) {
    const html = await this.dl.mockPage(state ?? '');
    // Relax helmet's CSP for this one static page (inline styles only, no scripts).
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'");
    res.type('html').send(html);
  }
}
