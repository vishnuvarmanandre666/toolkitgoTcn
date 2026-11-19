# ToolkitGo — Technician Registration & KYC

Technicians register with mobile OTP, complete personal / Aadhaar / PAN / address / document / bank steps, and submit for review. Staff review each item, request changes, approve, and activate.

| Part | Stack |
|---|---|
| `backend/` | NestJS 11 (TypeScript), Prisma 6 + MySQL 8, Redis (ioredis), S3-compatible private storage |
| `frontend/` | Next.js 15 App Router (JavaScript), Tailwind CSS |
| `docker-compose.yml` | MySQL, Redis, SeaweedFS (S3-compatible, dev only) |

The backend is TypeScript: NestJS is decorator-based, and plain JavaScript would need a fragile Babel toolchain. The frontend is plain JavaScript, as specified.

## Quick start

```bash
docker compose up -d                       # MySQL :3307, Redis :6380, S3 :8333

cd backend
cp .env.example .env                       # then set DATA_ENCRYPTION_KEY, OTP_SECRET, JWT_SECRET, BLIND_INDEX_SECRET
npm install
npx prisma migrate deploy
npm run seed                               # creates SUPER_ADMIN from SEED_ADMIN_* vars
npm run start:dev                          # http://localhost:4000/api

cd ../frontend
cp .env.example .env.local
npm install
npm run dev                                # http://localhost:3000
```

- Technician flow: http://localhost:3000/register. With `SMS_DRIVER=console`, the OTP is printed in the API log.
- Staff console: http://localhost:3000/admin/login.
- To try automatic verification locally, set `AADHAAR_PROVIDER=mock` and `PAN_PROVIDER=mock`. Names containing "mismatch" or "unavailable" simulate those outcomes.

Generate the encryption key with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

## Tests

```bash
cd backend
npm test            # unit: identifiers/Verhoeff/PAN/IFSC, name matching, AES-GCM, file sniffing, OTP service (Redis mock)
npm run test:e2e    # full lifecycle against real MySQL/Redis/S3 (needs docker compose up + seeded admin)
```

## Workflow & statuses

```
NOT_STARTED → IN_PROGRESS → SUBMITTED → UNDER_REVIEW → APPROVED → (activate)
                                 ↘            ↘ ACTION_REQUIRED → SUBMITTED (re-submit)
                                  REJECTED ←──┘
```

- Each verification has its own status: mobile, Aadhaar, Aadhaar address, PAN, current address, bank. Documents and document versions also have their own statuses.
- Approval is blocked until every required item is individually verified (`approvalBlockers` in `kyc-rules.ts`). Approval is separate from activation.
- The technician can only edit in `NOT_STARTED`, `IN_PROGRESS` or `ACTION_REQUIRED`. Documents flagged for re-upload can always be replaced.

## API overview (prefix `/api`)

| Area | Endpoints |
|---|---|
| OTP | `POST /otp/send`, `POST /otp/verify` (creates the account and session), `POST /otp/resend`, `GET /otp/status?phone=` |
| Technician | `GET /technician/kyc`, `PUT /technician/kyc/personal`, `POST /technician/kyc/aadhaar`, `POST /technician/kyc/aadhaar/manual-review`, `POST /technician/kyc/pan`, `POST /technician/kyc/pan/manual-review`, `PUT /technician/kyc/addresses`, `PUT /technician/kyc/bank`, `POST /technician/kyc/submit`, `POST /technician/logout` |
| Documents | `POST /technician/documents` (multipart: `category`, `file`, optional `documentId`/`label`), `DELETE /technician/documents/:id`, `GET /technician/documents/:id/url` |
| Admin auth | `POST /admin/auth/login`, `POST /admin/auth/logout`, `GET /admin/auth/me` |
| Admin review | `GET /admin/stats`, `GET /admin/applications`, `GET /admin/applications/:id`, `POST …/:id/start-review`, `PATCH …/:id/verifications/:section` (`aadhaar`, `pan`, `bank`, `aadhaarAddress`, `currentAddress`), `POST …/:id/request-action`, `POST …/:id/approve`\*, `POST …/:id/reject`\*, `POST …/:id/activate`\*, `POST …/:id/deactivate`\*, `POST …/:id/reveal`\*, `GET …/:id/audit` |
| Admin documents | `PATCH /admin/documents/:id/review`, `GET /admin/documents/:id/versions`, `GET /admin/documents/:id/url?versionId=` |
| Staff | `GET/POST /admin/staff`, `PATCH /admin/staff/:id` (SUPER_ADMIN) |

\* requires the ADMIN or SUPER_ADMIN role. REVIEWER (office staff) can review documents and sections and request changes.

## Security & compliance design

- **OTP**: `crypto.randomInt` generates 6 digits. Redis stores only an HMAC-SHA256 digest, bound to the phone number, with a 300 s TTL.
  - Lua scripts make issue, attempt counting and consume atomic. Attempts are counted *before* comparison, so concurrent guesses can't exceed the limit.
  - Digests are compared with `timingSafeEqual`, and compare-and-delete ensures each OTP is used only once.
  - Limits: 30 s cooldown, 3 resends per 15 min, 5 attempts, then a 15 min lock. There is also a per-IP hourly cap.
  - `/otp/status` reveals verification status only to the number's own session.
- **Aadhaar**:
  - Explicit consent is required and recorded (version, time, IP).
  - We never collect Aadhaar OTPs or call UIDAI directly. Verification goes through the provider interface (`kyc/providers/identity-providers.ts`) or manual review.
  - The Verhoeff checksum is checked on input.
  - By default only the last 4 digits and a keyed HMAC (for duplicate detection) are stored. Full ciphertext is stored only if `AADHAAR_STORE_ENCRYPTED=true`.
  - Uploads never produce VERIFIED on their own. Manual VERIFIED requires a verified document plus a reviewer note.
- **PAN and bank**: AES-256-GCM encryption, masked in every response, blind-index duplicate checks. Only an individual PAN (4th character `P`) is accepted. Revealing a full value is ADMIN-only and audited with a reason.
- **Addresses**: Aadhaar address and current address are stored in separate tables, each with its own source and status enums.
  - Addresses from a provider are locked.
  - "Same address" copies the Aadhaar address and keeps it in sync. Unticking never assumes the two match.
  - Differing addresses never cause automatic rejection. Staff can request address proof.
- **Documents**:
  - The real file type is checked from magic bytes, and must match both the extension and the MIME type.
  - PDFs with JS, launch actions or embedded files are rejected. Size limits apply.
  - Optional ClamAV scanning (`CLAMAV_HOST`) fails closed; when no scanner is configured, scans are recorded as SKIPPED.
  - Files go to a private bucket under random object keys. Access is only through signed URLs that expire after 120 s, issued after an ownership check.
  - Every version is kept. Superseded versions are purged after `DOCUMENT_VERSION_RETENTION_DAYS` by a daily cron job, and every access is audited.
- **Sessions**: JWTs live in httpOnly, SameSite=Strict cookies with separate technician and admin audiences. Admin accounts are re-checked on every request. Admin login has rate limiting and timing equalisation.
- **Fail-fast config**: in production, the console SMS driver, mock providers and local storage are refused at boot.

## Supabase phone login (optional)

When `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` (frontend), plus `SUPABASE_URL` and `SUPABASE_ANON_KEY` (backend), are set, technicians log in with Supabase Auth phone OTP:

1. The browser calls `signInWithOtp` and then `verifyOtp` (the phone is sent as `+91…`).
2. The browser POSTs the access token to `/api/auth/supabase/session`.
3. The backend validates the token with Supabase (`GET /auth/v1/user`) and requires a confirmed Indian phone number.
4. The backend links `Technician.supabaseUserId` and issues the normal ToolkitGo httpOnly session. The Supabase session is then discarded.

Supabase applies its own OTP rate limits and expiry, which you configure in its dashboard. If the variables are left empty, the built-in Redis/MSG91 OTP is used.

## Integrating real providers

- **MSG91**: set `SMS_DRIVER=msg91` and the `MSG91_*` variables. The Flow template must contain the variable named in `MSG91_OTP_VARIABLE`. Check the payload in `otp/sms/sms.provider.ts` against current MSG91 Flow docs before going live.
- **Aadhaar / PAN vendors**: implement `AadhaarVerificationProvider` / `PanVerificationProvider` and register them in `kyc/kyc.module.ts`. Only use licensed partners and legally permitted flows (Offline e-KYC, DigiLocker consent). Redirect-based flows return `IN_PROGRESS` with a `redirectUrl`; a callback endpoint for them still needs to be added.
- **Storage**: point the `S3_*` variables at a private AWS S3 bucket with Block Public Access enabled. SSE-AES256 is requested automatically on AWS.
