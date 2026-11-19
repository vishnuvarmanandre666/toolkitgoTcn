import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Request, Response } from 'express';
import { randomUUID } from 'crypto';

/**
 * Centralised error shape: { statusCode, error, message, details?, requestId }.
 * Internal errors are logged with a request id and never leak stack traces or
 * sensitive values to the client.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();
    const requestId = (req.headers['x-request-id'] as string) || randomUUID();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] = 'Something went wrong. Please try again.';
    let details: unknown;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') message = body;
      else {
        const b = body as Record<string, unknown>;
        message = (b.message as string | string[]) ?? exception.message;
        details = b.details;
        if (b.retryAfterSeconds !== undefined) {
          details = { ...(details as object), retryAfterSeconds: b.retryAfterSeconds };
          res.setHeader('Retry-After', String(b.retryAfterSeconds));
        }
      }
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError && exception.code === 'P2002') {
      status = HttpStatus.CONFLICT;
      message = 'A record with these details already exists.';
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError && exception.code === 'P2025') {
      status = HttpStatus.NOT_FOUND;
      message = 'Record not found.';
    } else {
      const err = exception as Error;
      this.logger.error(`[${requestId}] ${req.method} ${req.path}: ${err?.message}`, err?.stack);
    }

    res.status(status).json({
      statusCode: status,
      error: HttpStatus[status] ?? 'ERROR',
      message,
      ...(details !== undefined ? { details } : {}),
      requestId,
    });
  }
}
