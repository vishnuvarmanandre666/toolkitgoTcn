import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { DocumentCategory } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { Request, Response } from 'express';
import { memoryStorage } from 'multer';
import { AuthedTechnician, CurrentTechnician, TechnicianAuthGuard } from '../auth/guards';
import { clientIp } from '../common/utils/request';
import { loadConfig } from '../config/app-config';
import { DocumentsService, UploadedFile as File } from './documents.service';
import { StorageService } from './storage/storage.service';

class UploadDto {
  @IsEnum(DocumentCategory)
  category: DocumentCategory;

  @IsOptional() @IsString() @MaxLength(120)
  label?: string;

  /** Replace a specific document (needed for multi-instance categories). */
  @IsOptional() @IsString() @MaxLength(40)
  documentId?: string;
}

// Multer limit is a hard stop before buffering oversized bodies; validation re-checks precisely.
const uploadLimitBytes = () => {
  try {
    return loadConfig().uploads.maxBytes;
  } catch {
    return 5 * 1024 * 1024;
  }
};

@Controller('technician/documents')
@UseGuards(TechnicianAuthGuard)
export class TechnicianDocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Post()
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: uploadLimitBytes() + 1, files: 1, fields: 5 } }))
  upload(@CurrentTechnician() t: AuthedTechnician, @Body() dto: UploadDto, @UploadedFile() file: File, @Req() req: Request) {
    return this.documents.upload(t.id, dto, file, clientIp(req));
  }

  @Delete(':id')
  remove(@CurrentTechnician() t: AuthedTechnician, @Param('id') id: string, @Req() req: Request) {
    return this.documents.remove(t.id, id, clientIp(req));
  }

  @Get(':id/url')
  url(@CurrentTechnician() t: AuthedTechnician, @Param('id') id: string, @Req() req: Request) {
    return this.documents.signedUrl({ technicianId: t.id }, id, undefined, clientIp(req));
  }
}

/** Serves files for the LOCAL storage driver via HMAC-signed, expiring URLs (dev only). */
@Controller('files')
export class LocalFilesController {
  constructor(@Inject(StorageService) private readonly storage: StorageService) {}

  @Get('local')
  serve(@Query() query: Record<string, string>, @Res() res: Response) {
    const file = this.storage.openLocalSigned(query);
    if (!file) throw new NotFoundException('Link expired or invalid.');
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Content-Disposition', file.disposition);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    file.stream.on('error', () => {
      if (!res.headersSent) res.status(404);
      res.end();
    });
    file.stream.pipe(res);
  }
}

