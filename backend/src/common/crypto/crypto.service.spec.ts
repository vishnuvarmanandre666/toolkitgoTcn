import { randomBytes } from 'crypto';
import { AppConfig } from '../../config/app-config';
import { CryptoService } from './crypto.service';

const config = { crypto: { dataKey: randomBytes(32), blindIndexSecret: 'x'.repeat(40) } } as AppConfig;

describe('CryptoService', () => {
  const svc = new CryptoService(config);

  it('round-trips with random IVs', () => {
    const a = svc.encrypt('ABCPE1234F');
    const b = svc.encrypt('ABCPE1234F');
    expect(a).not.toBe(b);
    expect(a).not.toContain('ABCPE1234F');
    expect(svc.decrypt(a)).toBe('ABCPE1234F');
  });

  it('detects tampering', () => {
    const [v, iv, tag, data] = svc.encrypt('secret').split(':');
    const flipped = Buffer.from(data, 'base64');
    flipped[0] ^= 1;
    expect(() => svc.decrypt([v, iv, tag, flipped.toString('base64')].join(':'))).toThrow();
  });

  it('produces namespaced deterministic blind indexes', () => {
    expect(svc.blindIndex('pan', 'X')).toBe(svc.blindIndex('pan', 'X'));
    expect(svc.blindIndex('pan', 'X')).not.toBe(svc.blindIndex('bank', 'X'));
  });
});
