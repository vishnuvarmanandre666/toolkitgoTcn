/**
 * Full technician KYC lifecycle against real MySQL, Redis and S3-compatible
 * storage (docker compose up). Identity providers run in mock mode and SMS is
 * captured in-process.
 */
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import http from 'http';

try {
  process.loadEnvFile('.env');
} catch {
  /* CI provides env */
}
process.env.AADHAAR_PROVIDER = 'mock';
process.env.PAN_PROVIDER = 'mock';
process.env.SMS_DRIVER = 'console';
process.env.OTP_MAX_SENDS_PER_IP_PER_HOUR = '10000';
process.env.SUPABASE_URL = 'http://127.0.0.1:54329';
process.env.DIGILOCKER_MODE = 'mock';
process.env.SUPABASE_ANON_KEY = 'test-anon-key';

import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';
import { SMS_PROVIDER } from '../src/otp/sms/sms.provider';
import { verhoeffValid } from '../src/common/utils/identity';
import { PrismaService } from '../src/prisma/prisma.service';

const sent: Record<string, string> = {};
const captureSms = { sendOtp: async (phone: string, otp: string) => void (sent[phone] = otp) };

const rand = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join('');
const randomPhone = () => `9${rand(9)}`;
function randomAadhaar() {
  const prefix = `${2 + Math.floor(Math.random() * 8)}${rand(10)}`;
  for (let d = 0; d <= 9; d++) if (verhoeffValid(prefix + d)) return prefix + d;
  throw new Error('unreachable');
}
function randomPan() {
  const L = () => String.fromCharCode(65 + Math.floor(Math.random() * 26));
  return `${L()}${L()}${L()}P${L()}${rand(4)}${L()}`;
}

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(128, 7)]);
const PDF = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << >>\n%%EOF\n', 'latin1');

// Minimal stand-in for Supabase Auth's GET /auth/v1/user.
const fakeJwt = (sub: string) => `${Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub })).toString('base64url')}.c2ln`;
const supabaseUsers = new Map<string, { id: string; phone?: string; phone_confirmed_at?: string | null }>();
const supabaseStub = http.createServer((req, res) => {
  const token = (req.headers.authorization ?? '').replace(/^Bearer /, '');
  const user = supabaseUsers.get(token);
  if (req.url !== '/auth/v1/user' || req.headers.apikey !== 'test-anon-key' || !user) {
    res.writeHead(401, { 'content-type': 'application/json' }).end('{"message":"invalid JWT"}');
    return;
  }
  res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(user));
});

describe('Technician KYC lifecycle (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let http: ReturnType<typeof request.agent>;

  beforeAll(async () => {
    await new Promise<void>((r) => supabaseStub.listen(54329, '127.0.0.1', r));
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(SMS_PROVIDER).useValue(captureSms).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false });
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    http = request.agent(app.getHttpServer());
  });

  afterAll(async () => {
    await app?.close();
    supabaseStub.close();
  });

  async function registerTechnician() {
    const agent = request.agent(app.getHttpServer());
    const phone = randomPhone();
    await agent.post('/api/otp/send').send({ phone }).expect(200);
    const res = await agent.post('/api/otp/verify').send({ phone, otp: sent[phone] }).expect(200);
    expect(res.body.isNewRegistration).toBe(true);
    return { agent, phone };
  }

  it('rejects unauthenticated access to KYC endpoints', async () => {
    await http.get('/api/technician/kyc').expect(401);
    await http.get('/api/admin/applications').expect(401);
  });

  it('enforces OTP rules over HTTP', async () => {
    const phone = randomPhone();
    await http.post('/api/otp/send').send({ phone: '12345' }).expect(400);
    const send = await http.post('/api/otp/send').send({ phone }).expect(200);
    expect(send.body).toMatchObject({ sent: true, expiresInSeconds: 300, resendCooldownSeconds: 30 });
    expect(JSON.stringify(send.body)).not.toContain(sent[phone]);

    const wrong = sent[phone] === '000000' ? '111111' : '000000';
    const bad = await http.post('/api/otp/verify').send({ phone, otp: wrong }).expect(400);
    expect(bad.body.details.attemptsRemaining).toBe(4);

    const cooldown = await http.post('/api/otp/resend').send({ phone }).expect(429);
    expect(cooldown.headers['retry-after']).toBeDefined();

    const status = await http.get(`/api/otp/status?phone=${phone}`).expect(200);
    expect(status.body).toMatchObject({ otpActive: true, mobileVerified: null });
  });

  it('runs the complete onboarding → review → approval → activation flow', async () => {
    const { agent, phone } = await registerTechnician();
    let state = (await agent.get('/api/technician/kyc').expect(200)).body;
    expect(state.kycStatus).toBe('NOT_STARTED');
    expect(state.verifications.mobile).toBe('VERIFIED');
    expect(state.phone).not.toContain(phone.slice(2, 8));

    // Mobile verification is visible to the owner via status endpoint.
    const st = await agent.get(`/api/otp/status?phone=${phone}`).expect(200);
    expect(st.body.mobileVerified).toBe(true);

    // Aadhaar before personal info is refused.
    await agent.post('/api/technician/kyc/aadhaar').send({ aadhaarNumber: randomAadhaar(), nameOnAadhaar: 'Ravi Teja', consent: true }).expect(409);

    // Step 2: personal info + photo
    await agent.put('/api/technician/kyc/personal').send({ fullName: 'Ravi Teja', dateOfBirth: '2015-01-01', emergencyContact: '9123456789' }).expect(400); // under 18
    state = (await agent.put('/api/technician/kyc/personal').send({ fullName: 'Ravi Teja', dateOfBirth: '1992-04-10', gender: 'MALE', emergencyContact: '9123456789' }).expect(200)).body;
    expect(state.kycStatus).toBe('IN_PROGRESS');
    await agent.post('/api/technician/documents').field('category', 'PROFILE_PHOTO').attach('file', PDF, { filename: 'photo.pdf', contentType: 'application/pdf' }).expect(422);
    await agent.post('/api/technician/documents').field('category', 'PROFILE_PHOTO').attach('file', PNG, { filename: 'photo.png', contentType: 'image/png' }).expect(201);

    // Step 3: Aadhaar — consent required, checksum enforced, mock provider verifies & populates address
    await agent.post('/api/technician/kyc/aadhaar').send({ aadhaarNumber: randomAadhaar(), nameOnAadhaar: 'Ravi Teja', consent: false }).expect(400);
    await agent.post('/api/technician/kyc/aadhaar').send({ aadhaarNumber: '234567890123', nameOnAadhaar: 'Ravi Teja', consent: true }).expect((r) => expect([400]).toContain(r.status));
    const aadhaarNumber = randomAadhaar();
    state = (await agent.post('/api/technician/kyc/aadhaar').send({ aadhaarNumber, nameOnAadhaar: 'Ravi Teja', dobOnAadhaar: '1992-04-10', consent: true }).expect(200)).body;
    expect(state.aadhaar.verificationStatus).toBe('VERIFIED');
    expect(state.aadhaar.maskedNumber).toBe(`XXXX XXXX ${aadhaarNumber.slice(-4)}`);
    expect(JSON.stringify(state)).not.toContain(aadhaarNumber);
    expect(state.aadhaarAddress).toMatchObject({ source: 'VERIFICATION_PROVIDER', verificationStatus: 'VERIFIED', pinCode: '500016' });
    const stored = await prisma.aadhaarDetail.findFirst({ where: { aadhaarLast4: aadhaarNumber.slice(-4), technician: { phone: `91${phone}` } } });
    expect(stored?.aadhaarEncrypted).toBeNull(); // default policy: full number not persisted
    expect(stored?.consentAt).toBeTruthy();

    // Step 4: PAN — must be individual; doc upload; mock verification
    await agent.post('/api/technician/kyc/pan').send({ pan: 'ABCCE1234F', holderName: 'Ravi Teja' }).expect(400);
    const pan = randomPan();
    state = (await agent.post('/api/technician/kyc/pan').send({ pan, holderName: 'Ravi Teja' }).expect(200)).body;
    expect(state.pan.verificationStatus).toBe('VERIFIED');
    expect(state.pan.maskedPan).toBe(`${pan.slice(0, 2)}XXXXX${pan.slice(7)}`);
    const panUpload = await agent.post('/api/technician/documents').field('category', 'PAN').attach('file', PDF, { filename: 'pan.pdf', contentType: 'application/pdf' }).expect(201);

    // Step 5: addresses — provider address is locked; "same address" copies it
    await agent.put('/api/technician/kyc/addresses').send({
      addressesSame: false,
      aadhaarAddress: { villageCity: 'Elsewhere', district: 'Mumbai', state: 'Maharashtra', pinCode: '400001' },
      currentAddress: { villageCity: 'Pune', district: 'Pune', state: 'Maharashtra', pinCode: '411001' },
    }).expect(409);
    state = (await agent.put('/api/technician/kyc/addresses').send({ addressesSame: true, landmark: 'Near metro' }).expect(200)).body;
    expect(state.addressesSame).toBe(true);
    expect(state.currentAddress).toMatchObject({ source: 'COPIED_FROM_AADHAAR', pinCode: '500016', landmark: 'Near metro', verificationStatus: 'SELF_DECLARED' });

    // Step 7: bank
    await agent.put('/api/technician/kyc/bank').send({ accountHolderName: 'Ravi Teja', accountNumber: '123456789012', confirmAccountNumber: '123456789013', ifsc: 'SBIN0001234', bankName: 'SBI' }).expect(400);
    const account = rand(12);
    state = (await agent.put('/api/technician/kyc/bank').send({ accountHolderName: 'Ravi Teja', accountNumber: account, confirmAccountNumber: account, ifsc: 'sbin0001234', bankName: 'State Bank of India' }).expect(200)).body;
    expect(state.bank.maskedAccountNumber).toBe(`XXXXXXXX${account.slice(-4)}`);
    expect(JSON.stringify(state)).not.toContain(account);

    // Aadhaar doc not required since provider verified it
    expect(state.requiredDocuments.map((d: { category: string }) => d.category)).not.toContain('AADHAAR');
    expect(state.submissionBlockers).toEqual([]);
    expect(state.progress.percent).toBe(88);

    // Signed URL for own document works and serves the file
    const url = (await agent.get(`/api/technician/documents/${panUpload.body.id}/url`).expect(200)).body.url as string;
    const fileRes = await fetch(url);
    expect(fileRes.status).toBe(200);
    expect(Buffer.from(await fileRes.arrayBuffer()).equals(PDF)).toBe(true);

    // Another technician cannot access it
    const other = await registerTechnician();
    await other.agent.get(`/api/technician/documents/${panUpload.body.id}/url`).expect(403);

    // Step 8: submit
    state = (await agent.post('/api/technician/kyc/submit').expect(200)).body;
    expect(state.kycStatus).toBe('SUBMITTED');
    expect(state.editable).toBe(false);
    await agent.put('/api/technician/kyc/bank').send({ accountHolderName: 'Ravi Teja', accountNumber: account, confirmAccountNumber: account, ifsc: 'SBIN0001234', bankName: 'SBI' }).expect(409);

    // ---- Admin review ----
    const admin = request.agent(app.getHttpServer());
    await admin.post('/api/admin/auth/login').send({ email: process.env.SEED_ADMIN_EMAIL, password: 'wrong-password' }).expect(401);
    await admin.post('/api/admin/auth/login').send({ email: process.env.SEED_ADMIN_EMAIL, password: process.env.SEED_ADMIN_PASSWORD }).expect(200);
    const list = (await admin.get('/api/admin/applications?status=SUBMITTED&pageSize=100').expect(200)).body;
    const id = state.id;
    expect(list.items.some((i: { id: string }) => i.id === id)).toBe(true);

    let detail = (await admin.get(`/api/admin/applications/${id}`).expect(200)).body;
    expect(detail.approvalBlockers.length).toBeGreaterThan(0);
    await admin.post(`/api/admin/applications/${id}/approve`).send({}).expect(409); // not yet under review

    // Reviewer flags the PAN copy for re-upload → ACTION_REQUIRED
    const panDoc = detail.documents.find((d: { category: string }) => d.category === 'PAN');
    detail = (await admin.post(`/api/admin/applications/${id}/request-action`).send({ items: [{ section: 'DOCUMENTS', documentId: panDoc.id, message: 'PAN copy is blurred, please re-upload' }] }).expect(200)).body;
    expect(detail.kycStatus).toBe('ACTION_REQUIRED');

    state = (await agent.get('/api/technician/kyc').expect(200)).body;
    expect(state.feedback[0].message).toContain('blurred');
    expect(state.documents.find((d: { id: string }) => d.id === panDoc.id).status).toBe('REUPLOAD_REQUIRED');
    expect(state.submissionBlockers.length).toBeGreaterThan(0);
    await agent.post('/api/technician/documents').field('category', 'PAN').attach('file', PNG, { filename: 'pan-clear.png', contentType: 'image/png' }).expect(201);
    state = (await agent.post('/api/technician/kyc/submit').expect(200)).body;
    expect(state.kycStatus).toBe('SUBMITTED');
    expect(state.feedback.every((f: { resolved: boolean }) => f.resolved)).toBe(true);

    // Version history kept for staff
    const versions = (await admin.get(`/api/admin/documents/${panDoc.id}/versions`).expect(200)).body;
    expect(versions).toHaveLength(2);
    expect(versions[0]).toMatchObject({ version: 2, isCurrent: true });
    expect(versions[1].supersededAt).toBeTruthy();
    const oldUrl = (await admin.get(`/api/admin/documents/${panDoc.id}/url?versionId=${versions[1].id}`).expect(200)).body.url;
    expect((await fetch(oldUrl)).status).toBe(200);

    // Verify every document + bank; manual bank verification needs a note
    detail = (await admin.post(`/api/admin/applications/${id}/start-review`).expect(200)).body;
    expect(detail.kycStatus).toBe('UNDER_REVIEW');
    for (const d of detail.documents) {
      await admin.patch(`/api/admin/documents/${d.id}/review`).send({ status: 'VERIFIED' }).expect(200);
    }
    await admin.patch(`/api/admin/applications/${id}/verifications/bank`).send({ status: 'VERIFIED' }).expect(400);
    detail = (await admin.patch(`/api/admin/applications/${id}/verifications/bank`).send({ status: 'VERIFIED', note: 'Penny-drop name matched' }).expect(200)).body;
    expect(detail.approvalBlockers).toEqual([]);

    detail = (await admin.post(`/api/admin/applications/${id}/approve`).send({ note: 'All checks passed' }).expect(200)).body;
    expect(detail.kycStatus).toBe('APPROVED');
    expect(detail.isActive).toBe(false); // approval ≠ activation
    detail = (await admin.post(`/api/admin/applications/${id}/activate`).expect(200)).body;
    expect(detail.isActive).toBe(true);

    // Sensitive reveal is audited
    const revealed = (await admin.post(`/api/admin/applications/${id}/reveal`).send({ field: 'pan', reason: 'Cross-check with card image' }).expect(200)).body;
    expect(revealed.value).toBe(pan);
    const audit = (await admin.get(`/api/admin/applications/${id}/audit`).expect(200)).body as { action: string; metadata: unknown }[];
    const actions = audit.map((a) => a.action);
    for (const a of ['TECHNICIAN_REGISTERED', 'AADHAAR_CONSENT_CAPTURED', 'KYC_SUBMITTED', 'KYC_ACTION_REQUIRED', 'KYC_RESUBMITTED', 'KYC_APPROVED', 'TECHNICIAN_ACTIVATED', 'SENSITIVE_FIELD_REVEALED', 'DOCUMENT_ACCESSED']) {
      expect(actions).toContain(a);
    }
    expect(JSON.stringify(audit)).not.toContain(pan);
    expect(JSON.stringify(audit)).not.toContain(aadhaarNumber);

    // Technician sees final state; application is locked
    state = (await agent.get('/api/technician/kyc').expect(200)).body;
    expect(state).toMatchObject({ kycStatus: 'APPROVED', isActive: true, editable: false });
  });

  it('routes failed name matches and unavailable providers correctly', async () => {
    const { agent } = await registerTechnician();
    await agent.put('/api/technician/kyc/personal').send({ fullName: 'Mismatch Kumar', dateOfBirth: '1990-01-01', emergencyContact: '9123456780' }).expect(200);
    let state = (await agent.post('/api/technician/kyc/aadhaar').send({ aadhaarNumber: randomAadhaar(), nameOnAadhaar: 'Mismatch Kumar', consent: true }).expect(200)).body;
    expect(state.aadhaar.verificationStatus).toBe('FAILED');
    expect(state.aadhaar.nameMatched).toBe(false);
    expect(state.aadhaarAddress).toBeNull(); // no address accepted from a failed verification

    // Manual review requires the document first
    await agent.post('/api/technician/kyc/aadhaar/manual-review').expect(409);
    await agent.post('/api/technician/documents').field('category', 'AADHAAR').attach('file', PDF, { filename: 'aadhaar.pdf', contentType: 'application/pdf' }).expect(201);
    state = (await agent.post('/api/technician/kyc/aadhaar/manual-review').expect(200)).body;
    expect(state.aadhaar.verificationStatus).toBe('MANUAL_REVIEW');

    // Unavailable provider falls back to manual review automatically
    await agent.put('/api/technician/kyc/personal').send({ fullName: 'Unavailable Singh', dateOfBirth: '1990-01-01', emergencyContact: '9123456780' }).expect(200);
    state = (await agent.post('/api/technician/kyc/pan').send({ pan: randomPan(), holderName: 'Unavailable Singh' }).expect(200)).body;
    expect(state.pan.verificationStatus).toBe('MANUAL_REVIEW');

    // Self-declared Aadhaar address is marked unverified; independent current address
    state = (await agent.put('/api/technician/kyc/addresses').send({
      addressesSame: false,
      aadhaarAddress: { houseNumber: '4-5', villageCity: 'Guntur', mandalTaluka: 'Tenali', district: 'Guntur', state: 'Andhra Pradesh', pinCode: '522201' },
      currentAddress: { villageCity: 'Bengaluru', district: 'Bengaluru Urban', state: 'Karnataka', pinCode: '560001', landmark: 'Opp. bus stand' },
    }).expect(200)).body;
    expect(state.aadhaarAddress).toMatchObject({ source: 'SELF_DECLARED', verificationStatus: 'UNVERIFIED' });
    expect(state.currentAddress).toMatchObject({ source: 'SELF_DECLARED', verificationStatus: 'SELF_DECLARED', villageCity: 'Bengaluru' });
    expect(state.addressesSame).toBe(false);
  });

  it('blocks duplicate PAN across accounts', async () => {
    const pan = randomPan();
    const a = await registerTechnician();
    await a.agent.put('/api/technician/kyc/personal').send({ fullName: 'Anil Rao', dateOfBirth: '1990-01-01', emergencyContact: '9123456781' }).expect(200);
    await a.agent.post('/api/technician/kyc/pan').send({ pan, holderName: 'Anil Rao' }).expect(200);
    const b = await registerTechnician();
    await b.agent.put('/api/technician/kyc/personal').send({ fullName: 'Anil Rao', dateOfBirth: '1990-01-01', emergencyContact: '9123456781' }).expect(200);
    await b.agent.post('/api/technician/kyc/pan').send({ pan, holderName: 'Anil Rao' }).expect(409);
  });

  it('rejects spoofed and malicious uploads', async () => {
    const { agent } = await registerTechnician();
    await agent.post('/api/technician/documents').field('category', 'PAN').attach('file', Buffer.from('MZ fake exe'), { filename: 'pan.png', contentType: 'image/png' }).expect(422);
    const jsPdf = Buffer.from('%PDF-1.4\n<< /OpenAction << /S /JavaScript /JS (x) >> >>\n%%EOF', 'latin1');
    await agent.post('/api/technician/documents').field('category', 'PAN').attach('file', jsPdf, { filename: 'pan.pdf', contentType: 'application/pdf' }).expect(422);
    await agent.post('/api/technician/documents').field('category', 'NOT_A_CATEGORY').attach('file', PNG, { filename: 'x.png', contentType: 'image/png' }).expect(400);
  });

  it('logs technicians in via a verified Supabase phone session', async () => {
    const phone = randomPhone();
    const good = fakeJwt(`u-${phone}`);
    supabaseUsers.set(good, { id: `u-${phone}`, phone: `91${phone}`, phone_confirmed_at: new Date().toISOString() });
    const unconfirmed = fakeJwt('u-unconfirmed');
    supabaseUsers.set(unconfirmed, { id: 'u-unconfirmed', phone: `91${randomPhone()}`, phone_confirmed_at: null });
    const foreign = fakeJwt('u-foreign');
    supabaseUsers.set(foreign, { id: 'u-foreign', phone: '14155550123', phone_confirmed_at: new Date().toISOString() });

    await http.post('/api/auth/supabase/session').send({ accessToken: 'not-a-jwt' }).expect(400);
    await http.post('/api/auth/supabase/session').send({ accessToken: fakeJwt('unknown') }).expect(401);
    await http.post('/api/auth/supabase/session').send({ accessToken: unconfirmed }).expect(401);
    await http.post('/api/auth/supabase/session').send({ accessToken: foreign }).expect(400);

    const agent = request.agent(app.getHttpServer());
    const first = await agent.post('/api/auth/supabase/session').send({ accessToken: good }).expect(200);
    expect(first.body).toMatchObject({ verified: true, isNewRegistration: true });
    expect(String(first.headers['set-cookie'])).toMatch(/tg_tech_session=.*HttpOnly/i);
    const state = (await agent.get('/api/technician/kyc').expect(200)).body;
    expect(state.verifications.mobile).toBe('VERIFIED');

    // Same number, second login -> same account
    const again = await request(app.getHttpServer()).post('/api/auth/supabase/session').send({ accessToken: good }).expect(200);
    expect(again.body).toMatchObject({ technicianId: first.body.technicianId, isNewRegistration: false });

    // A different Supabase user claiming the same phone is refused
    const hijack = fakeJwt('u-other');
    supabaseUsers.set(hijack, { id: 'u-other', phone: `91${phone}`, phone_confirmed_at: new Date().toISOString() });
    await http.post('/api/auth/supabase/session').send({ accessToken: hijack }).expect(409);
  });

  describe('DigiLocker (sandbox)', () => {
    async function technicianWithProfile(fullName: string) {
      const { agent } = await registerTechnician();
      await agent.put('/api/technician/kyc/personal').send({ fullName, dateOfBirth: '1991-03-12', gender: 'MALE', emergencyContact: '9123456700' }).expect(200);
      return agent;
    }
    /** start → sandbox consent page → follow Allow/Deny link → callback redirect */
    async function runConsent(agent: ReturnType<typeof request.agent>, choice: 'Allow' | 'Deny') {
      const { authorizeUrl } = (await agent.post('/api/technician/kyc/digilocker/start').expect(200)).body;
      expect(authorizeUrl).toMatch(/^\/api\/kyc\/digilocker\/mock\/authorize\?state=/);
      const page = await request(app.getHttpServer()).get(authorizeUrl).expect(200);
      const href = [...page.text.matchAll(/href="([^"]+)">(Allow|Deny)</g)].find((m) => m[2] === choice)![1].replace(/&amp;/g, '&');
      // Callback carries no session cookie (cross-site redirect) — the state alone identifies the technician.
      const cb = await request(app.getHttpServer()).get(href).expect(302);
      return { location: cb.headers.location as string, href };
    }

    it('verifies Aadhaar, Aadhaar address and PAN from DigiLocker', async () => {
      const agent = await technicianWithProfile('Kiran Kumar Reddy');
      const { location, href } = await runConsent(agent, 'Allow');
      expect(location).toBe('/onboarding?digilocker=success&aadhaar=VERIFIED&pan=VERIFIED');

      const s = (await agent.get('/api/technician/kyc').expect(200)).body;
      expect(s.aadhaar).toMatchObject({ verificationStatus: 'VERIFIED', verificationMethod: 'DIGILOCKER', nameMatched: true, dobMatched: true, consentGiven: true });
      expect(s.aadhaar.maskedNumber).toMatch(/^XXXX XXXX \d{4}$/);
      expect(s.aadhaarAddress).toMatchObject({ source: 'VERIFICATION_PROVIDER', verificationStatus: 'VERIFIED', pinCode: '500034', villageCity: 'Hyderabad' });
      expect(s.pan).toMatchObject({ verificationStatus: 'VERIFIED', verificationMethod: 'DIGILOCKER' });
      expect(s.pan.maskedPan).toMatch(/^[A-Z]{2}XXXXX\d{2}[A-Z]$/);
      // No copies needed for DigiLocker-verified documents
      const required = s.requiredDocuments.map((d: { category: string }) => d.category);
      expect(required).not.toContain('AADHAAR');
      expect(required).not.toContain('PAN');
      expect(s.policy.digilockerEnabled).toBe(true);

      // State is single-use: replaying the callback does nothing
      const replay = await request(app.getHttpServer()).get(href).expect(302);
      expect(replay.headers.location).toContain('digilocker=expired');
    });

    it('handles denied consent and name mismatch', async () => {
      const a = await technicianWithProfile('Ravi Shankar');
      expect((await runConsent(a, 'Deny')).location).toContain('digilocker=cancelled');
      expect((await a.get('/api/technician/kyc').expect(200)).body.aadhaar).toBeNull();

      const b = await technicianWithProfile('Mismatch Prasad');
      const { location } = await runConsent(b, 'Allow');
      expect(location).toContain('digilocker=failed');
      const s = (await b.get('/api/technician/kyc').expect(200)).body;
      expect(s.aadhaar).toMatchObject({ verificationStatus: 'FAILED', nameMatched: false });
      expect(s.aadhaarAddress).toBeNull(); // no address accepted from a failed match
      expect(s.pan.verificationStatus).toBe('FAILED');
    });

    it('reports missing PAN as partial and rejects unknown state', async () => {
      const a = await technicianWithProfile('Nopan Varma');
      const { location } = await runConsent(a, 'Allow');
      expect(location).toContain('digilocker=partial');
      expect(location).toContain('aadhaar=VERIFIED');
      expect(location).toContain('pan=NOT_AVAILABLE');
      const bogus = await request(app.getHttpServer()).get('/api/kyc/digilocker/callback?code=mock.x.y&state=does-not-exist').expect(302);
      expect(bogus.headers.location).toContain('digilocker=expired');
    });

    it('requires personal info and a session to start', async () => {
      await http.post('/api/technician/kyc/digilocker/start').expect(401);
      const { agent } = await registerTechnician();
      await agent.post('/api/technician/kyc/digilocker/start').expect(409);
    });
  });
});
