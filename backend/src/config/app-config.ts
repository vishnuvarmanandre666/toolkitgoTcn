/**
 * Typed, validated application configuration. Fails fast at boot when a
 * required secret is missing or obviously unsafe.
 */
export interface AppConfig {
  env: string;
  isProduction: boolean;
  port: number;
  corsOrigins: string[];
  cookieSecure: boolean;
  redis: { host: string; port: number; password?: string };
  otp: {
    secret: string;
    expirySeconds: number;
    resendCooldownSeconds: number;
    maxAttempts: number;
    maxResends: number;
    resendWindowSeconds: number;
    lockSeconds: number;
    maxSendsPerIpPerHour: number;
  };
  sms: {
    driver: 'msg91' | 'console';
    msg91: { authKey: string; templateId: string; senderId: string; baseUrl: string; otpVariable: string };
  };
  auth: { jwtSecret: string; technicianSessionHours: number; adminSessionHours: number };
  /** DigiLocker (MeitY) Requester integration for Aadhaar + PAN. mode: off | live | mock (dev sandbox). */
  digilocker: {
    mode: 'off' | 'live' | 'mock';
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    authBaseUrl: string;
    apiBaseUrl: string;
    stateTtlSeconds: number;
  };
  /** Optional: Supabase Auth phone OTP login for technicians. Enabled when url + anonKey are set. */
  supabase: { enabled: boolean; url: string; anonKey: string };
  crypto: { dataKey: Buffer; blindIndexSecret: string };
  kycPolicy: {
    requireBankDetails: boolean;
    requireBankProof: boolean;
    requireAddressProof: boolean;
    requireCertificates: boolean;
    aadhaarStoreEncrypted: boolean;
    aadhaarConsentVersion: string;
    nameMatchThreshold: number;
  };
  providers: { aadhaar: string; pan: string };
  storage: {
    driver: 's3' | 'local';
    s3: { endpoint?: string; region: string; bucket: string; accessKeyId: string; secretAccessKey: string; forcePathStyle: boolean };
    localDir: string;
    apiPublicUrl: string;
    signedUrlTtlSeconds: number;
  };
  uploads: { maxBytes: number; clamavHost?: string; clamavPort: number; retentionDays: number };
}

const bool = (v: string | undefined, d: boolean) => (v === undefined || v === '' ? d : ['1', 'true', 'yes'].includes(v.toLowerCase()));
const int = (v: string | undefined, d: number) => {
  const n = v === undefined || v === '' ? d : Number.parseInt(v, 10);
  if (!Number.isFinite(n)) throw new Error(`Invalid integer config value: ${v}`);
  return n;
};
function required(name: string, minLength = 1): string {
  const v = process.env[name];
  if (!v || v.length < minLength) {
    throw new Error(`Missing or too-short required env var ${name} (min length ${minLength})`);
  }
  return v;
}

export function loadConfig(): AppConfig {
  const e = process.env;
  const env = e.NODE_ENV ?? 'development';
  const isProduction = env === 'production';

  const dataKey = Buffer.from(required('DATA_ENCRYPTION_KEY'), 'base64');
  if (dataKey.length !== 32) throw new Error('DATA_ENCRYPTION_KEY must be 32 bytes, base64 encoded');

  const smsDriver = (e.SMS_DRIVER ?? 'msg91') as 'msg91' | 'console';
  if (isProduction && smsDriver === 'console') throw new Error('SMS_DRIVER=console is not allowed in production');

  const aadhaarProvider = e.AADHAAR_PROVIDER ?? 'manual';
  const panProvider = e.PAN_PROVIDER ?? 'manual';
  if (isProduction && (aadhaarProvider === 'mock' || panProvider === 'mock')) {
    throw new Error('Mock identity providers are not allowed in production');
  }

  const dlMode = (e.DIGILOCKER_MODE || (e.DIGILOCKER_CLIENT_ID ? 'live' : 'off')) as 'off' | 'live' | 'mock';
  if (!['off', 'live', 'mock'].includes(dlMode)) throw new Error('DIGILOCKER_MODE must be off, live or mock');
  if (isProduction && dlMode === 'mock') throw new Error('DIGILOCKER_MODE=mock is not allowed in production');
  if (dlMode === 'live' && (!e.DIGILOCKER_CLIENT_ID || !e.DIGILOCKER_CLIENT_SECRET || !e.DIGILOCKER_REDIRECT_URI)) {
    throw new Error('DIGILOCKER_MODE=live requires DIGILOCKER_CLIENT_ID, DIGILOCKER_CLIENT_SECRET and DIGILOCKER_REDIRECT_URI');
  }

  const storageDriver = (e.STORAGE_DRIVER ?? 's3') as 's3' | 'local';
  if (isProduction && storageDriver === 'local') throw new Error('STORAGE_DRIVER=local is not allowed in production');

  return {
    env,
    isProduction,
    port: int(e.PORT, 4000),
    corsOrigins: (e.CORS_ORIGINS ?? 'http://localhost:3000').split(',').map((s) => s.trim()).filter(Boolean),
    cookieSecure: bool(e.COOKIE_SECURE, isProduction),
    redis: { host: e.REDIS_HOST ?? 'localhost', port: int(e.REDIS_PORT, 6379), password: e.REDIS_PASSWORD || undefined },
    otp: {
      secret: required('OTP_SECRET', 32),
      expirySeconds: int(e.OTP_EXPIRY_SECONDS, 300),
      resendCooldownSeconds: int(e.OTP_RESEND_COOLDOWN_SECONDS, 30),
      maxAttempts: int(e.OTP_MAX_ATTEMPTS, 5),
      maxResends: int(e.OTP_MAX_RESENDS, 3),
      resendWindowSeconds: int(e.OTP_RESEND_WINDOW_SECONDS, 900),
      lockSeconds: int(e.OTP_LOCK_SECONDS, 900),
      maxSendsPerIpPerHour: int(e.OTP_MAX_SENDS_PER_IP_PER_HOUR, 20),
    },
    sms: {
      driver: smsDriver,
      msg91: {
        authKey: e.MSG91_AUTH_KEY ?? '',
        templateId: e.MSG91_TEMPLATE_ID ?? '',
        senderId: e.MSG91_SENDER_ID ?? '',
        baseUrl: (e.MSG91_BASE_URL || 'https://control.msg91.com/api/v5').replace(/\/$/, ''),
        otpVariable: e.MSG91_OTP_VARIABLE || 'otp',
      },
    },
    auth: {
      jwtSecret: required('JWT_SECRET', 32),
      technicianSessionHours: int(e.TECHNICIAN_SESSION_HOURS, 72),
      adminSessionHours: int(e.ADMIN_SESSION_HOURS, 12),
    },
    digilocker: {
      mode: dlMode,
      clientId: e.DIGILOCKER_CLIENT_ID ?? '',
      clientSecret: e.DIGILOCKER_CLIENT_SECRET ?? '',
      redirectUri: e.DIGILOCKER_REDIRECT_URI || 'http://localhost:3000/api/kyc/digilocker/callback',
      authBaseUrl: (e.DIGILOCKER_AUTH_BASE_URL || 'https://api.digitallocker.gov.in').replace(/\/$/, ''),
      apiBaseUrl: (e.DIGILOCKER_API_BASE_URL || e.DIGILOCKER_AUTH_BASE_URL || 'https://api.digitallocker.gov.in').replace(/\/$/, ''),
      stateTtlSeconds: int(e.DIGILOCKER_STATE_TTL_SECONDS, 600),
    },
    supabase: {
      enabled: !!(e.SUPABASE_URL && e.SUPABASE_ANON_KEY),
      url: (e.SUPABASE_URL ?? '').replace(/\/$/, ''),
      anonKey: e.SUPABASE_ANON_KEY ?? '',
    },
    crypto: { dataKey, blindIndexSecret: required('BLIND_INDEX_SECRET', 32) },
    kycPolicy: {
      requireBankDetails: bool(e.REQUIRE_BANK_DETAILS, true),
      requireBankProof: bool(e.REQUIRE_BANK_PROOF, false),
      requireAddressProof: bool(e.REQUIRE_ADDRESS_PROOF, false),
      requireCertificates: bool(e.REQUIRE_CERTIFICATES, false),
      aadhaarStoreEncrypted: bool(e.AADHAAR_STORE_ENCRYPTED, false),
      aadhaarConsentVersion: e.AADHAAR_CONSENT_VERSION || '2026-11-v1',
      nameMatchThreshold: Number(e.NAME_MATCH_THRESHOLD ?? 0.8),
    },
    providers: { aadhaar: aadhaarProvider, pan: panProvider },
    storage: {
      driver: storageDriver,
      s3: {
        endpoint: e.S3_ENDPOINT || undefined,
        region: e.S3_REGION || 'ap-south-1',
        bucket: e.S3_BUCKET || 'toolkitgo-kyc',
        accessKeyId: e.S3_ACCESS_KEY_ID ?? '',
        secretAccessKey: e.S3_SECRET_ACCESS_KEY ?? '',
        forcePathStyle: bool(e.S3_FORCE_PATH_STYLE, false),
      },
      localDir: e.LOCAL_STORAGE_DIR || './storage',
      apiPublicUrl: (e.API_PUBLIC_URL || 'http://localhost:4000').replace(/\/$/, ''),
      signedUrlTtlSeconds: int(e.SIGNED_URL_TTL_SECONDS, 120),
    },
    uploads: {
      maxBytes: int(e.MAX_UPLOAD_MB, 5) * 1024 * 1024,
      clamavHost: e.CLAMAV_HOST || undefined,
      clamavPort: int(e.CLAMAV_PORT, 3310),
      retentionDays: int(e.DOCUMENT_VERSION_RETENTION_DAYS, 180),
    },
  };
}

export const APP_CONFIG = Symbol('APP_CONFIG');
