import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AdminRole } from '@prisma/client';
import { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { ADMIN_COOKIE, SessionService, TECH_COOKIE } from './session.service';

export interface AuthedTechnician {
  id: string;
  phone: string;
}
export interface AuthedAdmin {
  id: string;
  role: AdminRole;
  email: string;
  name: string;
}

type AuthedRequest = Request & { technician?: AuthedTechnician; admin?: AuthedAdmin };

@Injectable()
export class TechnicianAuthGuard implements CanActivate {
  constructor(
    private readonly sessions: SessionService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const claims = this.sessions.verifyTechnician(req.cookies?.[TECH_COOKIE]);
    if (!claims) throw new UnauthorizedException('Please verify your mobile number to continue.');
    const tech = await this.prisma.technician.findUnique({ where: { id: claims.sub }, select: { id: true, phone: true } });
    if (!tech || tech.phone !== claims.phone) throw new UnauthorizedException('Session is no longer valid.');
    req.technician = tech;
    return true;
  }
}

export const ROLES_KEY = 'roles';
/** Restrict an admin route to specific roles. SUPER_ADMIN always passes. */
export const Roles = (...roles: AdminRole[]) => SetMetadata(ROLES_KEY, roles);

@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(
    private readonly sessions: SessionService,
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const claims = this.sessions.verifyAdmin(req.cookies?.[ADMIN_COOKIE]);
    if (!claims) throw new UnauthorizedException('Admin login required.');
    // Re-check on every request so deactivated staff lose access immediately.
    const admin = await this.prisma.adminUser.findUnique({
      where: { id: claims.sub },
      select: { id: true, role: true, email: true, name: true, isActive: true },
    });
    if (!admin || !admin.isActive) throw new UnauthorizedException('Admin account is not active.');

    const roles = this.reflector.getAllAndOverride<AdminRole[] | undefined>(ROLES_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (roles?.length && admin.role !== AdminRole.SUPER_ADMIN && !roles.includes(admin.role)) {
      throw new ForbiddenException('You do not have permission to perform this action.');
    }
    req.admin = { id: admin.id, role: admin.role, email: admin.email, name: admin.name };
    return true;
  }
}

export const CurrentTechnician = createParamDecorator(
  (_: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest<AuthedRequest>().technician!,
);
export const CurrentAdmin = createParamDecorator(
  (_: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest<AuthedRequest>().admin!,
);
