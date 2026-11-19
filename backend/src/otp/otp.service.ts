import { BadRequestException, HttpException, HttpStatus, Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import Redis from 'ioredis';
import { createHmac, randomInt, timingSafeEqual } from 'crypto';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { REDIS } from '../redis/redis.module';
import { SMS_PROVIDER, SmsProvider } from './sms/sms.provider';
import { maskPhone } from '../common/utils/identity';

/**
 * Atomically issues a new OTP.
 * KEYS: 1=code hash, 2=cooldown, 3=resend counter
 * ARGV: 1=digest, 2=expirySec, 3=cooldownSec, 4=maxResends, 5=windowSec, 6=isResend('1'|'0')
 * Returns {status, ttlMs, resendsUsed}: 1=issued, -1=cooldown active, -2=resend limit reached
 */
const ISSUE_SCRIPT = `
local cd = redis.call('PTTL', KEYS[2])
if cd > 0 then return {-1, cd, 0} end
local active = redis.call('EXISTS', KEYS[1])
local used = tonumber(redis.call('GET', KEYS[3]) or '0')
if ARGV[6] == '1' or active == 1 then
  if used >= tonumber(ARGV[4]) then return {-2, redis.call('PTTL', KEYS[3]), used} end
  used = redis.call('INCR', KEYS[3])
  if used == 1 then redis.call('EXPIRE', KEYS[3], tonumber(ARGV[5])) end
end
redis.call('DEL', KEYS[1])
redis.call('HSET', KEYS[1], 'd', ARGV[1], 'a', 0)
redis.call('EXPIRE', KEYS[1], tonumber(ARGV[2]))
redis.call('SET', KEYS[2], '1', 'EX', tonumber(ARGV[3]))
return {1, 0, used}
`;

/**
 * Atomically records a verification attempt BEFORE comparison, so concurrent
 * guesses can never exceed the attempt budget.
 * KEYS: 1=code hash. ARGV: 1=maxAttempts
 * Returns {0} not found/expired, {-1} budget exhausted, {attempt, digest} otherwise.
 */
const ATTEMPT_SCRIPT = `
if redis.call('EXISTS', KEYS[1]) == 0 then return {0} end
local a = redis.call('HINCRBY', KEYS[1], 'a', 1)
if a > tonumber(ARGV[1]) then return {-1} end
return {a, redis.call('HGET', KEYS[1], 'd')}
`;

/** Compare-and-delete: only one concurrent correct request can consume the OTP. */
const CONSUME_SCRIPT = `
if redis.call('HGET', KEYS[1], 'd') == ARGV[1] then
  redis.call('DEL', KEYS[1], KEYS[2])
  return 1
end
return 0
`;

export interface OtpSendResult {
  sent: true;
  expiresInSeconds: number;
  resendCooldownSeconds: number;
  resendsRemaining: number;
}

export interface OtpStatus {
  otpActive: boolean;
  otpExpiresInSeconds: number;
  resendCooldownSeconds: number;
  resendsRemaining: number;
  locked: boolean;
  lockExpiresInSeconds: number;
}

const tooMany = (message: string, retryAfterSeconds: number) =>
  new HttpException({ message, retryAfterSeconds }, HttpStatus.TOO_MANY_REQUESTS);

@Injectable()
export class OtpService {
  private readonly logger = new Logger('OTP');

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
  ) {}

  private keys(phone: string) {
    return {
      code: `otp:code:${phone}`,
      cooldown: `otp:cooldown:${phone}`,
      resends: `otp:resends:${phone}`,
      lock: `otp:lock:${phone}`,
    };
  }

  /** HMAC-SHA256 bound to the phone number so a digest is useless for any other number. */
  digest(phone: string, otp: string): string {
    return createHmac('sha256', this.config.otp.secret).update(`${phone}:${otp}`).digest('hex');
  }

  generateOtp(): string {
    return randomInt(0, 1_000_000).toString().padStart(6, '0');
  }

  private async assertNotLocked(phone: string) {
    const ttl = await this.redis.ttl(this.keys(phone).lock);
    if (ttl > 0) throw tooMany('Too many incorrect attempts. Please try again later.', ttl);
  }

  private async assertIpBudget(ip: string) {
    const key = `otp:ip:${ip}`;
    const n = await this.redis.incr(key);
    if (n === 1) await this.redis.expire(key, 3600);
    if (n > this.config.otp.maxSendsPerIpPerHour) {
      const ttl = await this.redis.ttl(key);
      throw tooMany('Too many OTP requests from this network. Please try again later.', Math.max(ttl, 1));
    }
  }

  /** @param isResend explicit resend; a /send while an OTP is active is also treated as a resend. */
  async send(phone: string, ip: string, isResend: boolean): Promise<OtpSendResult> {
    const o = this.config.otp;
    await this.assertNotLocked(phone);
    await this.assertIpBudget(ip);

    const k = this.keys(phone);
    const otp = this.generateOtp();
    const [status, ttlMs, used] = (await this.redis.eval(
      ISSUE_SCRIPT, 3, k.code, k.cooldown, k.resends,
      this.digest(phone, otp), o.expirySeconds, o.resendCooldownSeconds, o.maxResends, o.resendWindowSeconds, isResend ? '1' : '0',
    )) as [number, number, number];

    if (status === -1) throw tooMany('Please wait before requesting another OTP.', Math.ceil(ttlMs / 1000));
    if (status === -2) throw tooMany('Maximum OTP resends reached. Please try again later.', Math.ceil(ttlMs / 1000));

    try {
      await this.sms.sendOtp(phone, otp);
    } catch (err) {
      // Roll back so the user can retry immediately and no undeliverable OTP lingers.
      await this.redis.del(k.code, k.cooldown);
      this.logger.error(`OTP delivery failed for ${maskPhone(phone)}: ${(err as Error).message}`);
      throw new ServiceUnavailableException('Unable to send OTP right now. Please try again shortly.');
    }

    return {
      sent: true,
      expiresInSeconds: o.expirySeconds,
      resendCooldownSeconds: o.resendCooldownSeconds,
      resendsRemaining: Math.max(o.maxResends - used, 0),
    };
  }

  /** Resolves on success; throws a descriptive HttpException otherwise. Never reveals the OTP or digest. */
  async verify(phone: string, otp: string): Promise<void> {
    if (!/^\d{6}$/.test(otp ?? '')) throw new BadRequestException('OTP must be 6 digits.');
    await this.assertNotLocked(phone);

    const o = this.config.otp;
    const k = this.keys(phone);
    const res = (await this.redis.eval(ATTEMPT_SCRIPT, 1, k.code, o.maxAttempts)) as [number, string?];

    if (res[0] === 0) throw new BadRequestException('OTP has expired or was not requested. Please request a new OTP.');
    if (res[0] === -1) {
      await this.lock(phone);
      throw tooMany('Too many incorrect attempts. Please try again later.', o.lockSeconds);
    }

    const attempt = res[0];
    const stored = Buffer.from(res[1] ?? '', 'hex');
    const candidateHex = this.digest(phone, otp);
    const candidate = Buffer.from(candidateHex, 'hex');
    const match = stored.length === candidate.length && timingSafeEqual(stored, candidate);

    if (match) {
      const consumed = await this.redis.eval(CONSUME_SCRIPT, 2, k.code, k.cooldown, candidateHex);
      if (consumed !== 1) throw new BadRequestException('OTP has already been used. Please request a new OTP.');
      await this.redis.del(k.resends);
      return;
    }

    const remaining = o.maxAttempts - attempt;
    if (remaining <= 0) {
      await this.lock(phone);
      throw tooMany('Too many incorrect attempts. Please try again later.', o.lockSeconds);
    }
    throw new BadRequestException({ message: 'Incorrect OTP.', details: { attemptsRemaining: remaining } });
  }

  private async lock(phone: string) {
    const k = this.keys(phone);
    await this.redis.multi().del(k.code).set(k.lock, '1', 'EX', this.config.otp.lockSeconds).exec();
    this.logger.warn(`OTP verification locked for ${maskPhone(phone)}`);
  }

  async status(phone: string): Promise<OtpStatus> {
    const k = this.keys(phone);
    const [codeTtl, cooldownTtl, used, lockTtl] = await Promise.all([
      this.redis.ttl(k.code),
      this.redis.ttl(k.cooldown),
      this.redis.get(k.resends),
      this.redis.ttl(k.lock),
    ]);
    return {
      otpActive: codeTtl > 0,
      otpExpiresInSeconds: Math.max(codeTtl, 0),
      resendCooldownSeconds: Math.max(cooldownTtl, 0),
      resendsRemaining: Math.max(this.config.otp.maxResends - Number(used ?? 0), 0),
      locked: lockTtl > 0,
      lockExpiresInSeconds: Math.max(lockTtl, 0),
    };
  }
}
