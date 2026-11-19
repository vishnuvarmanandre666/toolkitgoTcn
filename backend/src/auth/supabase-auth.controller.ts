import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Inject,
  Logger,
  NotFoundException,
  Post,
  Req,
  Res,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { IsJWT, MaxLength } from 'class-validator';
import { Request, Response } from 'express';
import { normalizeIndianMobile } from '../common/utils/identity';
import { clientIp } from '../common/utils/request';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { TechnicianLoginService } from './technician-login.service';

class SupabaseSessionDto {
  @IsJWT()
  @MaxLength(4096)
  accessToken: string;
}

interface SupabaseUser {
  id: string;
  phone?: string;
  phone_confirmed_at?: string | null;
}

/**
 * Exchanges a Supabase Auth session (obtained by the browser via phone OTP)
 * for a ToolkitGo technician session.
 *
 * The token is never trusted locally: it is validated by Supabase itself
 * (GET /auth/v1/user), which also confirms the phone was verified.
 */
@Controller('auth/supabase')
export class SupabaseAuthController {
  private readonly logger = new Logger('SupabaseAuth');

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly login: TechnicianLoginService,
  ) {}

  @Post('session')
  @HttpCode(200)
  async session(@Body() dto: SupabaseSessionDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const sb = this.config.supabase;
    if (!sb.enabled) throw new NotFoundException('Supabase login is not enabled.');

    const user = await this.fetchUser(dto.accessToken);
    if (!user.phone || !user.phone_confirmed_at) throw new UnauthorizedException('Mobile number is not verified.');

    const phone = normalizeIndianMobile(user.phone);
    if (!phone) throw new BadRequestException('Only Indian mobile numbers (+91) can register as technicians.');

    return this.login.completeLogin(phone, res, clientIp(req), 'supabase_otp', user.id);
  }

  private async fetchUser(accessToken: string): Promise<SupabaseUser> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const r = await fetch(`${this.config.supabase.url}/auth/v1/user`, {
        headers: { apikey: this.config.supabase.anonKey, authorization: `Bearer ${accessToken}` },
        signal: controller.signal,
      });
      if (r.status === 401 || r.status === 403) throw new UnauthorizedException('Login session is invalid or expired. Please verify again.');
      if (!r.ok) {
        this.logger.error(`Supabase /auth/v1/user returned HTTP ${r.status}`);
        throw new ServiceUnavailableException('Login service is unavailable. Please try again.');
      }
      return (await r.json()) as SupabaseUser;
    } catch (err) {
      if (err instanceof UnauthorizedException || err instanceof ServiceUnavailableException) throw err;
      this.logger.error(`Supabase user lookup failed: ${(err as Error).message}`);
      throw new ServiceUnavailableException('Login service is unavailable. Please try again.');
    } finally {
      clearTimeout(timer);
    }
  }
}
