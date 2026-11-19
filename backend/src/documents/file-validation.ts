import { DocumentCategory } from '@prisma/client';

export type AllowedKind = 'jpeg' | 'png' | 'pdf';

export const KIND_INFO: Record<AllowedKind, { mime: string; extensions: string[]; ext: string }> = {
  jpeg: { mime: 'image/jpeg', extensions: ['.jpg', '.jpeg'], ext: '.jpg' },
  png: { mime: 'image/png', extensions: ['.png'], ext: '.png' },
  pdf: { mime: 'application/pdf', extensions: ['.pdf'], ext: '.pdf' },
};

/** Categories that only accept images (e.g. the profile photo must be renderable as an avatar). */
export const IMAGE_ONLY: DocumentCategory[] = [DocumentCategory.PROFILE_PHOTO];

/** Detects the real file type from magic bytes — never trusts the client's MIME type or name. */
export function sniffKind(buf: Buffer): AllowedKind | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length >= 5 && buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  return null;
}

/** PDFs with active content are rejected outright; identity documents never need scripts. */
const PDF_ACTIVE_CONTENT = /\/(JavaScript|JS|Launch|EmbeddedFile|OpenAction\s*<<[^>]*\/JS|RichMedia|XFA)\b/;

export interface ValidationResult {
  ok: boolean;
  kind?: AllowedKind;
  error?: string;
}

export function validateUpload(
  file: { originalname: string; mimetype: string; size: number; buffer: Buffer },
  category: DocumentCategory,
  maxBytes: number,
): ValidationResult {
  if (!file || !file.buffer?.length) return { ok: false, error: 'No file received.' };
  if (file.size > maxBytes) return { ok: false, error: `File is larger than ${Math.round(maxBytes / 1024 / 1024)} MB.` };

  const ext = (file.originalname.match(/\.[^.]+$/)?.[0] ?? '').toLowerCase();
  const kind = sniffKind(file.buffer);
  if (!kind) return { ok: false, error: 'Only JPEG, PNG or PDF files are accepted.' };

  const info = KIND_INFO[kind];
  if (!info.extensions.includes(ext)) return { ok: false, error: `File extension does not match its content (${info.mime}).` };
  if (file.mimetype !== info.mime && !(kind === 'jpeg' && file.mimetype === 'image/jpg')) {
    return { ok: false, error: 'File type does not match its content.' };
  }
  if (IMAGE_ONLY.includes(category) && kind === 'pdf') return { ok: false, error: 'Please upload a JPEG or PNG image.' };

  if (kind === 'pdf') {
    if (PDF_ACTIVE_CONTENT.test(file.buffer.toString('latin1'))) {
      return { ok: false, error: 'PDFs containing scripts, attachments or interactive forms are not accepted.' };
    }
    if (!file.buffer.subarray(-1024).toString('latin1').includes('%%EOF')) {
      return { ok: false, error: 'PDF appears to be incomplete or corrupted.' };
    }
  }
  return { ok: true, kind };
}
