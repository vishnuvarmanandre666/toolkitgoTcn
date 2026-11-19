import { Global, Inject, Injectable, Module } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'crypto';
import { APP_CONFIG, AppConfig } from '../../config/app-config';

/**
 * Field-level encryption for sensitive identifiers (AES-256-GCM) and keyed
 * blind indexes (HMAC-SHA256) for equality lookups without storing plaintext.
 *
 * Ciphertext format: "v1:<iv b64>:<tag b64>:<data b64>" — the version prefix
 * allows key rotation later.
 */
@Injectable()
export class CryptoService {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  encrypt(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.config.crypto.dataKey, iv);
    const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return ['v1', iv.toString('base64'), tag.toString('base64'), data.toString('base64')].join(':');
  }

  decrypt(payload: string): string {
    const [version, ivB64, tagB64, dataB64] = payload.split(':');
    if (version !== 'v1' || !ivB64 || !tagB64 || dataB64 === undefined) throw new Error('Unsupported ciphertext');
    const decipher = createDecipheriv('aes-256-gcm', this.config.crypto.dataKey, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
  }

  /** Deterministic keyed hash, namespaced so the same value in different fields hashes differently. */
  blindIndex(namespace: string, value: string): string {
    return createHmac('sha256', this.config.crypto.blindIndexSecret).update(`${namespace}:${value}`).digest('hex');
  }
}

@Global()
@Module({ providers: [CryptoService], exports: [CryptoService] })
export class CryptoModule {}
