import { HttpException } from '@nestjs/common';
import RedisMock from 'ioredis-mock';
import type Redis from 'ioredis';
import { AppConfig } from '../config/app-config';
import { OtpService } from './otp.service';

const config = {
  otp: {
    secret: 's'.repeat(40),
    expirySeconds: 300,
    resendCooldownSeconds: 30,
    maxAttempts: 5,
    maxResends: 3,
    resendWindowSeconds: 900,
    lockSeconds: 900,
    maxSendsPerIpPerHour: 100,
  },
} as AppConfig;

class CaptureSms {
  last: { phone: string; otp: string } | null = null;
  fail = false;
  async sendOtp(phone: string, otp: string) {
    if (this.fail) throw new Error('down');
    this.last = { phone, otp };
  }
}

const statusOf = async (p: Promise<unknown>) => {
  try {
    await p;
    return 200;
  } catch (e) {
    return (e as HttpException).getStatus();
  }
};

describe('OtpService', () => {
  let redis: Redis;
  let sms: CaptureSms;
  let svc: OtpService;
  const phone = '9876543210';

  beforeEach(async () => {
    redis = new RedisMock() as unknown as Redis;
    await redis.flushall();
    sms = new CaptureSms();
    svc = new OtpService(redis, config, sms);
  });

  it('generates 6-digit OTPs', () => {
    for (let i = 0; i < 50; i++) expect(svc.generateOtp()).toMatch(/^\d{6}$/);
  });

  it('stores only an HMAC digest with a 300s TTL', async () => {
    const res = await svc.send(phone, '1.1.1.1', false);
    expect(res.expiresInSeconds).toBe(300);
    const stored = await redis.hgetall(`otp:code:${phone}`);
    expect(stored.d).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(stored)).not.toContain(sms.last!.otp);
    expect(await redis.ttl(`otp:code:${phone}`)).toBeGreaterThan(290);
  });

  it('verifies the correct OTP once and deletes it', async () => {
    await svc.send(phone, '1.1.1.1', false);
    await expect(svc.verify(phone, sms.last!.otp)).resolves.toBeUndefined();
    expect(await redis.exists(`otp:code:${phone}`)).toBe(0);
    expect(await statusOf(svc.verify(phone, sms.last!.otp))).toBe(400);
  });

  it('enforces the resend cooldown', async () => {
    await svc.send(phone, '1.1.1.1', false);
    expect(await statusOf(svc.send(phone, '1.1.1.1', true))).toBe(429);
  });

  it('allows at most 3 resends per window and invalidates the previous OTP', async () => {
    await svc.send(phone, '1.1.1.1', false);
    let previous = sms.last!.otp;
    for (let i = 0; i < 3; i++) {
      await redis.del(`otp:cooldown:${phone}`); // simulate cooldown elapsing
      const r = await svc.send(phone, '1.1.1.1', true);
      expect(r.resendsRemaining).toBe(2 - i);
      if (sms.last!.otp !== previous) expect(await statusOf(svc.verify(phone, previous))).toBe(400);
      previous = sms.last!.otp;
    }
    await redis.del(`otp:cooldown:${phone}`);
    expect(await statusOf(svc.send(phone, '1.1.1.1', true))).toBe(429);
  });

  it('locks after 5 failed attempts', async () => {
    await svc.send(phone, '1.1.1.1', false);
    const wrong = sms.last!.otp === '000000' ? '111111' : '000000';
    for (let i = 0; i < 4; i++) expect(await statusOf(svc.verify(phone, wrong))).toBe(400);
    expect(await statusOf(svc.verify(phone, wrong))).toBe(429);
    // Even the right code is refused once locked.
    expect(await statusOf(svc.verify(phone, sms.last!.otp))).toBe(429);
    expect((await svc.status(phone)).locked).toBe(true);
  });

  it('rolls back when SMS delivery fails', async () => {
    sms.fail = true;
    expect(await statusOf(svc.send(phone, '1.1.1.1', false))).toBe(503);
    expect(await redis.exists(`otp:code:${phone}`)).toBe(0);
    expect(await redis.exists(`otp:cooldown:${phone}`)).toBe(0);
  });

  it('reports status without exposing the OTP', async () => {
    await svc.send(phone, '1.1.1.1', false);
    const s = await svc.status(phone);
    expect(s.otpActive).toBe(true);
    expect(s.resendCooldownSeconds).toBeGreaterThan(0);
    expect(JSON.stringify(s)).not.toContain(sms.last!.otp);
  });

  it('binds the digest to the phone number', () => {
    expect(svc.digest('9876543210', '123456')).not.toBe(svc.digest('9876543211', '123456'));
  });
});
