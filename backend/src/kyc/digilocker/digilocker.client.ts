import { createHmac, timingSafeEqual } from 'crypto';
import { AppConfig } from '../../config/app-config';

/**
 * DigiLocker Requester API client (MeitY), per "Requester API Specification
 * v1.12": OAuth 2.0 authorization-code flow with PKCE (S256).
 *
 *   GET  {auth}/public/oauth2/1/authorize         consent page (browser)
 *   POST {auth}/public/oauth2/1/token             code → access token (+ name/dob/gender/eaadhaar)
 *   GET  {api}/public/oauth2/3/xml/eaadhaar       e-Aadhaar XML           (hmac header)
 *   GET  {api}/public/oauth2/2/files/issued       issued documents list
 *   GET  {api}/public/oauth2/1/xml/{uri}          issued doc data as XML  (hmac header)
 *
 * Document responses carry an `hmac` header: Base64(HMAC-SHA256(body, client_secret)).
 * We reject any document whose HMAC does not match.
 */

export interface DlToken {
  accessToken: string;
  scope: string;
  digilockerId: string;
  name?: string;
  dob?: string; // DDMMYYYY
  gender?: string; // M | F | T
  eaadhaar: boolean;
}

export interface DlIssuedItem {
  name: string;
  uri: string;
  doctype: string;
  issuerid?: string;
  issuer?: string;
  mime?: unknown;
}

export class DigilockerError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface DigilockerClient {
  readonly mode: 'live' | 'mock';
  authorizeUrl(p: { state: string; codeChallenge: string }): string;
  exchangeCode(code: string, codeVerifier: string): Promise<DlToken>;
  getEaadhaarXml(token: DlToken): Promise<string>;
  listIssued(token: DlToken): Promise<DlIssuedItem[]>;
  getIssuedXml(token: DlToken, uri: string): Promise<string>;
}

export const DIGILOCKER_CLIENT = Symbol('DIGILOCKER_CLIENT');

export function verifyHmac(body: Buffer, headerValue: string | null, secret: string): boolean {
  if (!headerValue) return false;
  const expected = createHmac('sha256', secret).update(body).digest();
  const given = Buffer.from(headerValue.trim(), 'base64');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export class LiveDigilockerClient implements DigilockerClient {
  readonly mode = 'live' as const;
  constructor(private readonly cfg: AppConfig['digilocker']) {}

  authorizeUrl({ state, codeChallenge }: { state: string; codeChallenge: string }) {
    const q = new URLSearchParams({
      response_type: 'code',
      client_id: this.cfg.clientId,
      redirect_uri: this.cfg.redirectUri,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      req_doctype: 'PANCR', // show PAN on the consent screen
      purpose: 'kyc',
    });
    return `${this.cfg.authBaseUrl}/public/oauth2/1/authorize?${q}`;
  }

  private async call(url: string, init: RequestInit, timeoutMs = 15000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } catch {
      throw new DigilockerError('unreachable', 'DigiLocker is not reachable right now.');
    } finally {
      clearTimeout(timer);
    }
  }

  async exchangeCode(code: string, codeVerifier: string): Promise<DlToken> {
    const body = new URLSearchParams({
      code,
      grant_type: 'authorization_code',
      client_id: this.cfg.clientId,
      client_secret: this.cfg.clientSecret,
      redirect_uri: this.cfg.redirectUri,
      code_verifier: codeVerifier,
    });
    const r = await this.call(`${this.cfg.authBaseUrl}/public/oauth2/1/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body,
    });
    const j = (await r.json().catch(() => ({}))) as Record<string, string>;
    if (!r.ok || !j.access_token) throw new DigilockerError(j.error || 'token_failed', j.error_description || 'DigiLocker sign-in could not be completed.');
    return {
      accessToken: j.access_token,
      scope: j.scope ?? '',
      digilockerId: j.digilockerid,
      name: j.name,
      dob: j.dob,
      gender: j.gender,
      eaadhaar: j.eaadhaar === 'Y',
    };
  }

  private async getDocument(token: DlToken, url: string): Promise<string> {
    const r = await this.call(url, { headers: { authorization: `Bearer ${token.accessToken}` } });
    const buf = Buffer.from(await r.arrayBuffer());
    if (!r.ok) {
      let j: Record<string, string> = {};
      try {
        j = JSON.parse(buf.toString('utf8'));
      } catch {
        /* non-JSON */
      }
      throw new DigilockerError(j.error || `http_${r.status}`, j.error_description || 'Could not fetch the document from DigiLocker.');
    }
    if (!verifyHmac(buf, r.headers.get('hmac'), this.cfg.clientSecret)) {
      throw new DigilockerError('hmac_mismatch', 'Document integrity check failed.');
    }
    return buf.toString('utf8');
  }

  getEaadhaarXml(token: DlToken) {
    return this.getDocument(token, `${this.cfg.apiBaseUrl}/public/oauth2/3/xml/eaadhaar`);
  }

  async listIssued(token: DlToken): Promise<DlIssuedItem[]> {
    const r = await this.call(`${this.cfg.apiBaseUrl}/public/oauth2/2/files/issued`, { headers: { authorization: `Bearer ${token.accessToken}` } });
    const j = (await r.json().catch(() => ({}))) as { items?: DlIssuedItem[]; error?: string; error_description?: string };
    if (!r.ok) throw new DigilockerError(j.error || `http_${r.status}`, j.error_description || 'Could not list DigiLocker documents.');
    return (j.items ?? []).map((i) => ({ ...i, uri: String(i.uri ?? '').trim(), doctype: String(i.doctype ?? '').trim() }));
  }

  getIssuedXml(token: DlToken, uri: string) {
    return this.getDocument(token, `${this.cfg.apiBaseUrl}/public/oauth2/1/xml/${encodeURIComponent(uri)}`);
  }
}
