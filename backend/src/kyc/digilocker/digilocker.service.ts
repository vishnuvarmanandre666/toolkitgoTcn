import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  AadhaarAddressStatus,
  ActorType,
  AddressSource,
  KycStatus,
  VerificationMethod,
  VerificationStatus,
} from '@prisma/client';
import { createHash, randomBytes } from 'crypto';
import Redis from 'ioredis';
import { AuditService } from '../../audit/audit.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { isIndividualPan, maskPan, nameMatchScore, sameDate } from '../../common/utils/identity';
import { APP_CONFIG, AppConfig } from '../../config/app-config';
import { PrismaService } from '../../prisma/prisma.service';
import { REDIS } from '../../redis/redis.module';
import { isEditable } from '../kyc-rules';
import { KycService } from '../kyc.service';
import { DIGILOCKER_CLIENT, DigilockerClient, DigilockerError, DlToken } from './digilocker.client';
import { panFromUri, parseEaadhaar, parseIndianDate, parsePanXml } from './digilocker-xml';

interface PendingState {
  technicianId: string;
  verifier: string;
  consentVersion: string;
  ip?: string;
  createdAt: number;
}

export type DigilockerOutcome = {
  result: 'success' | 'partial' | 'failed' | 'cancelled' | 'expired' | 'error';
  aadhaar?: 'VERIFIED' | 'FAILED' | 'NOT_AVAILABLE';
  pan?: 'VERIFIED' | 'FAILED' | 'NOT_AVAILABLE';
  message?: string;
};

const b64url = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/**
 * DigiLocker KYC: the technician consents and signs in on DigiLocker; we fetch
 * their e-Aadhaar and PAN (issued by UIDAI / Income Tax Dept), check integrity,
 * match name + DOB with their registration, and record verified results.
 * ToolkitGo never sees the Aadhaar OTP or the full Aadhaar number.
 */
@Injectable()
export class DigilockerService {
  private readonly logger = new Logger('DigiLocker');

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly kyc: KycService,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(DIGILOCKER_CLIENT) private readonly client: DigilockerClient | null,
  ) {}

  get enabled() {
    return !!this.client;
  }

  /** Step 1: create PKCE + state bound to the technician, return DigiLocker consent URL. */
  async start(technicianId: string, ip?: string) {
    if (!this.client) throw new NotFoundException('DigiLocker verification is not enabled.');
    const t = await this.prisma.technician.findUnique({ where: { id: technicianId } });
    if (!t) throw new NotFoundException('Technician not found.');
    if (!isEditable(t.kycStatus)) throw new ConflictException('Your application is locked while it is being reviewed.');
    if (!t.fullName || !t.dateOfBirth) throw new ConflictException('Please complete your personal information first.');

    const state = b64url(randomBytes(32));
    const verifier = b64url(randomBytes(48)); // 64 chars, within the 43–128 PKCE range
    const challenge = b64url(createHash('sha256').update(verifier).digest());
    const pending: PendingState = { technicianId, verifier, consentVersion: this.config.kycPolicy.aadhaarConsentVersion, ip, createdAt: Date.now() };
    await this.redis.set(`dl:state:${state}`, JSON.stringify(pending), 'EX', this.config.digilocker.stateTtlSeconds);

    await this.audit.log({
      actorType: ActorType.TECHNICIAN,
      actorId: t.id,
      technicianId: t.id,
      action: 'DIGILOCKER_CONSENT_STARTED',
      metadata: { mode: this.client.mode, consentVersion: pending.consentVersion },
      ip,
    });
    return { authorizeUrl: this.client.authorizeUrl({ state, codeChallenge: challenge }) };
  }

  /**
   * Step 2: DigiLocker redirects back with ?code&state (or ?error). The state
   * is single-use and identifies the technician (the session cookie is
   * SameSite=Strict, so it is not sent on this cross-site redirect).
   */
  async handleCallback(q: { code?: string; state?: string; error?: string; error_description?: string }): Promise<DigilockerOutcome> {
    if (!this.client) return { result: 'error', message: 'DigiLocker verification is not enabled.' };
    if (!q.state) return { result: 'error', message: 'Invalid DigiLocker response.' };

    const raw = await this.redis.getdel(`dl:state:${q.state}`);
    if (!raw) return { result: 'expired', message: 'This DigiLocker session expired. Please try again.' };
    const pending = JSON.parse(raw) as PendingState;
    const tid = pending.technicianId;
    const log = (action: string, metadata: Record<string, unknown>) =>
      this.audit.log({ actorType: ActorType.TECHNICIAN, actorId: tid, technicianId: tid, action, metadata: metadata as never, ip: pending.ip });

    if (q.error || !q.code) {
      await log('DIGILOCKER_CONSENT_DENIED', { error: q.error ?? 'no_code' });
      return { result: 'cancelled', message: 'DigiLocker consent was not given.' };
    }

    let token: DlToken;
    try {
      token = await this.client.exchangeCode(q.code, pending.verifier);
    } catch (e) {
      await log('DIGILOCKER_TOKEN_FAILED', { error: (e as DigilockerError).code ?? 'error' });
      return { result: 'error', message: (e as Error).message };
    }

    const t = await this.prisma.technician.findUnique({ where: { id: tid } });
    if (!t || !isEditable(t.kycStatus)) return { result: 'error', message: 'Your application can no longer be changed.' };

    const outcome: DigilockerOutcome = { result: 'success' };
    const threshold = this.config.kycPolicy.nameMatchThreshold;

    // ---------------------------------------------------------- Aadhaar --
    try {
      if (!token.eaadhaar) throw new DigilockerError('aadhaar_not_linked', 'Aadhaar is not linked to your DigiLocker account.');
      const e = parseEaadhaar(await this.client.getEaadhaarXml(token));
      const name = e.name ?? token.name ?? '';
      const dob = e.dob ?? parseIndianDate(token.dob);
      const score = nameMatchScore(name, t.fullName!);
      const nameOk = score >= threshold;
      const dobOk = dob ? sameDate(dob, t.dateOfBirth) : null;
      const verified = nameOk && dobOk !== false && !!e.last4;

      // One DigiLocker account (= one Aadhaar) may back only one technician.
      const hash = this.crypto.blindIndex('aadhaar-digilocker', token.digilockerId);
      const dup = await this.prisma.aadhaarDetail.findFirst({ where: { aadhaarHash: hash, technicianId: { not: tid } }, select: { id: true } });
      if (dup) throw new DigilockerError('duplicate', 'These Aadhaar details are linked to another ToolkitGo account.');

      const now = new Date();
      const data = {
        aadhaarLast4: e.last4,
        aadhaarHash: hash,
        aadhaarEncrypted: null,
        nameOnAadhaar: name.slice(0, 150) || null,
        dobOnAadhaar: dob,
        consentGiven: true,
        consentVersion: pending.consentVersion,
        consentAt: new Date(pending.createdAt),
        consentIp: pending.ip ?? null,
        verificationStatus: verified ? VerificationStatus.VERIFIED : VerificationStatus.FAILED,
        verificationMethod: VerificationMethod.DIGILOCKER,
        providerName: this.client.mode === 'live' ? 'digilocker' : 'digilocker-sandbox',
        providerRefId: `DL-${createHash('sha256').update(token.digilockerId).digest('hex').slice(0, 16)}`,
        verifiedAt: verified ? now : null,
        nameMatchScore: score,
        nameMatched: nameOk,
        dobMatched: dobOk,
        failureReason: verified
          ? null
          : !nameOk
            ? 'The name on your Aadhaar (DigiLocker) does not match your registered name.'
            : 'The date of birth on your Aadhaar (DigiLocker) does not match your registered date of birth.',
      };
      await this.prisma.$transaction(async (tx) => {
        await tx.aadhaarDetail.upsert({ where: { technicianId: tid }, create: { technicianId: tid, ...data }, update: data });
        if (t.kycStatus === KycStatus.NOT_STARTED) await tx.technician.update({ where: { id: tid }, data: { kycStatus: KycStatus.IN_PROGRESS } });
        if (verified && e.address) await this.kyc.applyVerifiedAadhaarAddress(tx, tid, e.address);
        if (!verified) {
          // Never leave an address marked verified from an earlier, different verification.
          await tx.aadhaarAddress.updateMany({
            where: { technicianId: tid, source: AddressSource.VERIFICATION_PROVIDER },
            data: { source: AddressSource.SELF_DECLARED, verificationStatus: AadhaarAddressStatus.UNVERIFIED, verifiedAt: null },
          });
        }
      });
      outcome.aadhaar = verified ? 'VERIFIED' : 'FAILED';
      await log('DIGILOCKER_AADHAAR_RESULT', { status: outcome.aadhaar, last4: e.last4, nameMatchScore: score, dobMatched: dobOk, addressPopulated: verified && !!e.address });
    } catch (err) {
      const code = (err as DigilockerError).code ?? 'error';
      outcome.aadhaar = code === 'aadhaar_not_linked' || code === 'aadhaar_not_available' ? 'NOT_AVAILABLE' : 'FAILED';
      outcome.message = (err as Error).message;
      await log('DIGILOCKER_AADHAAR_RESULT', { status: outcome.aadhaar, error: code });
      if (code !== 'aadhaar_not_linked' && code !== 'aadhaar_not_available' && code !== 'duplicate') this.logger.error(`e-Aadhaar fetch failed: ${code}`);
    }

    // -------------------------------------------------------------- PAN --
    try {
      const item = (await this.client.listIssued(token)).find((i) => i.doctype?.toUpperCase() === 'PANCR');
      if (!item) throw new DigilockerError('pan_not_found', 'No PAN card was found in your DigiLocker.');
      const xml = parsePanXml(await this.client.getIssuedXml(token, item.uri));
      const pan = xml.pan ?? panFromUri(item.uri);
      if (!pan) throw new DigilockerError('pan_unreadable', 'Could not read the PAN from DigiLocker.');
      if (!isIndividualPan(pan)) throw new DigilockerError('pan_not_individual', 'The PAN in DigiLocker is not an individual PAN.');

      const hash = this.crypto.blindIndex('pan', pan);
      const dup = await this.prisma.panDetail.findFirst({ where: { panHash: hash, technicianId: { not: tid } }, select: { id: true } });
      if (dup) throw new DigilockerError('duplicate', 'This PAN is linked to another ToolkitGo account.');

      const holderName = (xml.name ?? token.name ?? '').slice(0, 150);
      const score = nameMatchScore(holderName, t.fullName!);
      const verified = score >= threshold;
      const data = {
        panEncrypted: this.crypto.encrypt(pan),
        panHash: hash,
        panMasked: maskPan(pan),
        holderName: holderName || null,
        verificationStatus: verified ? VerificationStatus.VERIFIED : VerificationStatus.FAILED,
        verificationMethod: VerificationMethod.DIGILOCKER,
        providerName: this.client.mode === 'live' ? 'digilocker' : 'digilocker-sandbox',
        providerRefId: item.uri.replace(/-PANCR-.*/i, '-PANCR-') + maskPan(pan),
        verifiedAt: verified ? new Date() : null,
        nameMatchScore: score,
        nameMatched: verified,
        failureReason: verified ? null : 'The name on your PAN (DigiLocker) does not match your registered name.',
      };
      await this.prisma.panDetail.upsert({ where: { technicianId: tid }, create: { technicianId: tid, ...data }, update: data });
      outcome.pan = verified ? 'VERIFIED' : 'FAILED';
      await log('DIGILOCKER_PAN_RESULT', { status: outcome.pan, pan: maskPan(pan), nameMatchScore: score });
    } catch (err) {
      const code = (err as DigilockerError).code ?? 'error';
      outcome.pan = code === 'pan_not_found' ? 'NOT_AVAILABLE' : 'FAILED';
      outcome.message = outcome.message ?? (err as Error).message;
      await log('DIGILOCKER_PAN_RESULT', { status: outcome.pan, error: code });
    }

    const both = [outcome.aadhaar, outcome.pan];
    outcome.result = both.every((s) => s === 'VERIFIED') ? 'success' : both.some((s) => s === 'VERIFIED') ? 'partial' : 'failed';
    if (outcome.result === 'success') outcome.message = undefined;
    return outcome;
  }

  /** Renders the sandbox consent page (mock mode only). */
  mockConsentPage(state: string) {
    if (this.client?.mode !== 'mock') throw new NotFoundException();
    if (!/^[A-Za-z0-9_-]{20,100}$/.test(state)) throw new BadRequestException('Invalid state');
    const cb = `/api/kyc/digilocker/callback`;
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>DigiLocker (Sandbox)</title>
<style>body{margin:0;font-family:system-ui,Segoe UI,Roboto,sans-serif;background:#f1f5f9;color:#0f172a}
.wrap{max-width:420px;margin:0 auto;padding:32px 16px}.card{background:#fff;border-radius:16px;padding:24px;box-shadow:0 4px 16px rgba(15,23,42,.08)}
.badge{display:inline-block;background:#fef3c7;color:#92400e;font-size:12px;font-weight:700;padding:3px 8px;border-radius:999px}
h1{font-size:20px;margin:12px 0 4px}p{color:#475569;font-size:14px;line-height:1.5}ul{padding-left:18px;color:#334155;font-size:14px}
a.btn{display:block;text-align:center;text-decoration:none;font-weight:700;padding:12px;border-radius:10px;margin-top:10px}
.allow{background:#1d4ed8;color:#fff}.deny{background:#fff;color:#334155;border:1px solid #cbd5e1}</style></head>
<body><div class="wrap"><div class="card"><span class="badge">SANDBOX — not the real DigiLocker</span>
<h1>ToolkitGo is requesting access</h1><p>ToolkitGo wants to access the following documents from your DigiLocker for <b>KYC</b>:</p>
<ul><li>Aadhaar (e-Aadhaar)</li><li>PAN Verification Record</li></ul>
<p>In live mode this page is DigiLocker's own sign-in and consent screen.</p>
<a class="btn allow" href="${cb}?code=${encodeURIComponent(`mock.__TID__.${randomBytes(6).toString('hex')}`)}&state=${encodeURIComponent(state)}">Allow</a>
<a class="btn deny" href="${cb}?error=access_denied&state=${encodeURIComponent(state)}">Deny</a></div></div></body></html>`;
  }

  /** The sandbox needs the technician id in the mock code; look it up from the pending state. */
  async mockPage(state: string) {
    const html = this.mockConsentPage(state);
    const raw = await this.redis.get(`dl:state:${state}`);
    if (!raw) throw new NotFoundException('This DigiLocker session expired. Please try again.');
    return html.replace('__TID__', (JSON.parse(raw) as PendingState).technicianId);
  }
}
