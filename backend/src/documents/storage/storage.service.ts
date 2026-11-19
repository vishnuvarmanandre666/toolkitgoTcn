import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createHmac, timingSafeEqual } from 'crypto';
import { createReadStream, promises as fs } from 'fs';
import * as path from 'path';
import { Readable } from 'stream';
import { APP_CONFIG, AppConfig } from '../../config/app-config';

export interface SignedUrlOptions {
  filename: string;
  contentType: string;
  inline: boolean;
}

/**
 * Private object storage. Objects are never publicly readable; clients only
 * receive short-lived signed URLs after an access-control check.
 */
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger('Storage');
  private s3?: S3Client;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    if (config.storage.driver === 's3') {
      const s = config.storage.s3;
      this.s3 = new S3Client({
        region: s.region,
        endpoint: s.endpoint,
        forcePathStyle: s.forcePathStyle,
        // S3-compatible servers often reject the SDK's default flexible-checksum
        // parameters (breaking presigned GETs); only send checksums when required.
        ...(s.endpoint ? { requestChecksumCalculation: 'WHEN_REQUIRED' as const, responseChecksumValidation: 'WHEN_REQUIRED' as const } : {}),
        credentials: s.accessKeyId ? { accessKeyId: s.accessKeyId, secretAccessKey: s.secretAccessKey } : undefined,
      });
    }
  }

  async onModuleInit() {
    if (this.s3) {
      const Bucket = this.config.storage.s3.bucket;
      try {
        await this.s3.send(new HeadBucketCommand({ Bucket }));
      } catch {
        if (this.config.isProduction) {
          this.logger.error(`Bucket ${Bucket} not reachable. Provision it (private, no public ACL) before starting.`);
          return;
        }
        // Dev convenience only: buckets are created private by default (no ACL / policy granted).
        try {
          await this.s3.send(new CreateBucketCommand({ Bucket }));
          this.logger.log(`Created private dev bucket ${Bucket}`);
        } catch (err) {
          this.logger.error(`Could not create bucket ${Bucket}: ${(err as Error).message}`);
        }
      }
    } else {
      await fs.mkdir(path.resolve(this.config.storage.localDir), { recursive: true });
      this.logger.warn('Using LOCAL storage driver (development only)');
    }
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    if (this.s3) {
      await this.s3.send(
        new PutObjectCommand({
          Bucket: this.config.storage.s3.bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
          ServerSideEncryption: this.config.storage.s3.endpoint ? undefined : 'AES256',
        }),
      );
      return;
    }
    const file = this.localPath(key);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, body, { mode: 0o600 });
  }

  async delete(key: string): Promise<void> {
    if (this.s3) {
      await this.s3.send(new DeleteObjectCommand({ Bucket: this.config.storage.s3.bucket, Key: key }));
      return;
    }
    await fs.rm(this.localPath(key), { force: true });
  }

  async signedUrl(key: string, opts: SignedUrlOptions): Promise<{ url: string; expiresAt: string }> {
    const ttl = this.config.storage.signedUrlTtlSeconds;
    const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();
    const disposition = `${opts.inline ? 'inline' : 'attachment'}; filename="${opts.filename.replace(/[^\w.\-]/g, '_')}"`;

    if (this.s3) {
      const url = await getSignedUrl(
        this.s3,
        new GetObjectCommand({
          Bucket: this.config.storage.s3.bucket,
          Key: key,
          ResponseContentDisposition: disposition,
          ResponseContentType: opts.contentType,
        }),
        { expiresIn: ttl },
      );
      return { url, expiresAt };
    }

    const exp = Math.floor(Date.now() / 1000) + ttl;
    const params = new URLSearchParams({ key, exp: String(exp), ct: opts.contentType, cd: disposition });
    params.set('sig', this.localSignature(params));
    // Relative URL: served through the frontend's /api proxy (same origin).
    return { url: `/api/files/local?${params.toString()}`, expiresAt };
  }

  /** Validates a local-driver signed URL and returns a stream, or null if invalid/expired. */
  openLocalSigned(query: Record<string, string>): { stream: Readable; contentType: string; disposition: string } | null {
    if (this.s3) return null;
    const { key, exp, ct, cd, sig } = query;
    if (!key || !exp || !ct || !cd || !sig) return null;
    if (Number(exp) < Math.floor(Date.now() / 1000)) return null;
    const expected = Buffer.from(this.localSignature(new URLSearchParams({ key, exp, ct, cd })), 'hex');
    const given = Buffer.from(sig, 'hex');
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
    return { stream: createReadStream(this.localPath(key)), contentType: ct, disposition: cd };
  }

  private localSignature(params: URLSearchParams): string {
    const payload = ['key', 'exp', 'ct', 'cd'].map((k) => `${k}=${params.get(k)}`).join('&');
    return createHmac('sha256', this.config.auth.jwtSecret).update(`local-file:${payload}`).digest('hex');
  }

  /** Resolves a key inside the storage root, refusing path traversal. */
  private localPath(key: string): string {
    const root = path.resolve(this.config.storage.localDir);
    const full = path.resolve(root, key);
    if (!full.startsWith(root + path.sep)) throw new Error('Invalid storage key');
    return full;
  }
}
