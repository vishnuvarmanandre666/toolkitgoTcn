import { DocumentCategory } from '@prisma/client';
import { sniffKind, validateUpload } from './file-validation';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)]);
const PDF = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << >>\n%%EOF\n', 'latin1');
const MAX = 5 * 1024 * 1024;

const file = (buffer: Buffer, originalname: string, mimetype: string) => ({ buffer, originalname, mimetype, size: buffer.length });

describe('file validation', () => {
  it('sniffs real content types', () => {
    expect(sniffKind(PNG)).toBe('png');
    expect(sniffKind(JPEG)).toBe('jpeg');
    expect(sniffKind(PDF)).toBe('pdf');
    expect(sniffKind(Buffer.from('MZ\x90\x00 executable'))).toBeNull();
  });

  it('accepts matching files', () => {
    expect(validateUpload(file(PNG, 'a.png', 'image/png'), DocumentCategory.PAN, MAX).ok).toBe(true);
    expect(validateUpload(file(JPEG, 'a.JPG', 'image/jpeg'), DocumentCategory.PAN, MAX).ok).toBe(true);
    expect(validateUpload(file(PDF, 'a.pdf', 'application/pdf'), DocumentCategory.PAN, MAX).ok).toBe(true);
  });

  it('rejects spoofed extension or MIME type', () => {
    expect(validateUpload(file(PNG, 'a.pdf', 'application/pdf'), DocumentCategory.PAN, MAX).ok).toBe(false);
    expect(validateUpload(file(PNG, 'a.png', 'application/pdf'), DocumentCategory.PAN, MAX).ok).toBe(false);
    expect(validateUpload(file(Buffer.from('<script>alert(1)</script>'), 'a.png', 'image/png'), DocumentCategory.PAN, MAX).ok).toBe(false);
  });

  it('rejects oversized files', () => {
    const r = validateUpload(file(PNG, 'a.png', 'image/png'), DocumentCategory.PAN, 10);
    expect(r.ok).toBe(false);
  });

  it('rejects PDFs for image-only categories', () => {
    expect(validateUpload(file(PDF, 'a.pdf', 'application/pdf'), DocumentCategory.PROFILE_PHOTO, MAX).ok).toBe(false);
  });

  it('rejects PDFs with active content or truncation', () => {
    const js = Buffer.from('%PDF-1.4\n<< /OpenAction << /S /JavaScript /JS (app.alert(1)) >> >>\n%%EOF', 'latin1');
    expect(validateUpload(file(js, 'a.pdf', 'application/pdf'), DocumentCategory.PAN, MAX).ok).toBe(false);
    const truncated = Buffer.from('%PDF-1.4\n1 0 obj', 'latin1');
    expect(validateUpload(file(truncated, 'a.pdf', 'application/pdf'), DocumentCategory.PAN, MAX).ok).toBe(false);
  });
});
