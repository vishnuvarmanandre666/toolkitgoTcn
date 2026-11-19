import { Request } from 'express';

/** Client IP (trust proxy is configured in main.ts so req.ip honours X-Forwarded-For from trusted hops). */
export const clientIp = (req: Request): string => (req.ip || req.socket?.remoteAddress || 'unknown').replace(/^::ffff:/, '');
