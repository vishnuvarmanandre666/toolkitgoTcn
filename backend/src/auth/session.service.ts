import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { CookieOptions, Response } from 'express';
import { APP_CONFIG, AppConfig } from '../config/app-config';

export const TECH_COOKIE = 'tg_tech_session';
export const ADMIN_COOKIE = 'tg_admin_session';

export interface TechnicianClaims {
  sub: string;
  typ: 'technician';
  phone: string;
}
export interface AdminClaims {
  sub: string;
  typ: 'admin';
  role: string;
}

/**
 * Sessions are short-lived signed JWTs in httpOnly, SameSite=Strict cookies,
 * so they are not readable by page scripts and not sent on cross-site requests.
 * Technician and admin sessions use different cookies and audiences.
 */
@Injectable()
export class SessionService {
  constructor(
    private readonly jwt: JwtService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  private cookieOptions(maxAgeMs: number): CookieOptions {
    return { httpOnly: true, secure: this.config.cookieSecure, sameSite: 'strict', path: '/', maxAge: maxAgeMs };
  }

  issueTechnician(res: Response, technicianId: string, phone: string) {
    const hours = this.config.auth.technicianSessionHours;
    const token = this.jwt.sign({ sub: technicianId, typ: 'technician', phone } satisfies TechnicianClaims, {
      expiresIn: `${hours}h`,
      audience: 'technician',
    });
    res.cookie(TECH_COOKIE, token, this.cookieOptions(hours * 3600_000));
  }

  issueAdmin(res: Response, adminId: string, role: string) {
    const hours = this.config.auth.adminSessionHours;
    const token = this.jwt.sign({ sub: adminId, typ: 'admin', role } satisfies AdminClaims, {
      expiresIn: `${hours}h`,
      audience: 'admin',
    });
    res.cookie(ADMIN_COOKIE, token, this.cookieOptions(hours * 3600_000));
  }

  clear(res: Response, cookie: string) {
    res.clearCookie(cookie, { httpOnly: true, secure: this.config.cookieSecure, sameSite: 'strict', path: '/' });
  }

  verifyTechnician(token: string): TechnicianClaims | null {
    try {
      const c = this.jwt.verify<TechnicianClaims>(token, { audience: 'technician' });
      return c.typ === 'technician' ? c : null;
    } catch {
      return null;
    }
  }

  verifyAdmin(token: string): AdminClaims | null {
    try {
      const c = this.jwt.verify<AdminClaims>(token, { audience: 'admin' });
      return c.typ === 'admin' ? c : null;
    } catch {
      return null;
    }
  }
}
