import { createHash } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { DigilockerClient, DigilockerError, DlIssuedItem, DlToken } from './digilocker.client';

/**
 * DEVELOPMENT SANDBOX ONLY (refused in production by config validation).
 * Simulates DigiLocker so the whole consent → fetch → verify flow can be
 * exercised without partner credentials. It "issues" an e-Aadhaar and PAN
 * that mirror the technician's registered details.
 *
 * Test hooks in the technician's full name:
 *   "mismatch"   → DigiLocker returns a different name (verification fails)
 *   "noaadhaar"  → Aadhaar not linked to the DigiLocker account
 *   "nopan"      → no PAN in issued documents
 */
export class MockDigilockerClient implements DigilockerClient {
  readonly mode = 'mock' as const;
  constructor(private readonly prisma: PrismaService) {}

  authorizeUrl({ state }: { state: string; codeChallenge: string }) {
    // Served by our own API through the same-origin /api proxy.
    return `/api/kyc/digilocker/mock/authorize?state=${encodeURIComponent(state)}`;
  }

  async exchangeCode(code: string): Promise<DlToken> {
    const technicianId = code.startsWith('mock.') ? code.split('.')[1] : '';
    const t = await this.prisma.technician.findUnique({ where: { id: technicianId } });
    if (!t) throw new DigilockerError('invalid_grant', 'Invalid authorization code.');
    const n = (t.fullName ?? '').toLowerCase();
    const dob = t.dateOfBirth ?? new Date('1990-01-01');
    return {
      accessToken: `mock-token.${t.id}`,
      scope: 'files.issueddocs partners.PANCR userdetails',
      digilockerId: createHash('sha256').update(`dl:${t.id}`).digest('hex').slice(0, 36),
      name: n.includes('mismatch') ? 'Someone Else Entirely' : (t.fullName ?? 'Test User'),
      dob: `${String(dob.getUTCDate()).padStart(2, '0')}${String(dob.getUTCMonth() + 1).padStart(2, '0')}${dob.getUTCFullYear()}`,
      gender: t.gender === 'FEMALE' ? 'F' : 'M',
      eaadhaar: !n.includes('noaadhaar'),
    };
  }

  private async tech(token: DlToken) {
    const t = await this.prisma.technician.findUnique({ where: { id: token.accessToken.split('.')[1] } });
    if (!t) throw new DigilockerError('invalid_token', 'The access token is invalid');
    return t;
  }

  private static pan(id: string) {
    const h = createHash('sha256').update(`pan:${id}`).digest();
    const L = (i: number) => String.fromCharCode(65 + (h[i] % 26));
    const D = (i: number) => String(h[i] % 10);
    return `${L(0)}${L(1)}${L(2)}P${L(3)}${D(4)}${D(5)}${D(6)}${D(7)}${L(8)}`;
  }

  async getEaadhaarXml(token: DlToken): Promise<string> {
    const t = await this.tech(token);
    if ((t.fullName ?? '').toLowerCase().includes('noaadhaar')) throw new DigilockerError('aadhaar_not_linked', 'Aadhaar is not linked to the account');
    const last4 = String(parseInt(createHash('sha256').update(`uid:${t.id}`).digest('hex').slice(0, 8), 16) % 10000).padStart(4, '0');
    const d = t.dateOfBirth ?? new Date('1990-01-01');
    const dob = `${String(d.getUTCDate()).padStart(2, '0')}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${d.getUTCFullYear()}`;
    return `<?xml version="1.0" encoding="UTF-8"?>
<Certificate><CertificateData><KycRes ret="Y"><UidData uid="xxxxxxxx${last4}">
<Poi dob="${dob}" gender="${t.gender === 'FEMALE' ? 'F' : 'M'}" name="${token.name}"/>
<Poa co="S/O Ramaiah" country="India" dist="Hyderabad" house="8-2-293/A" lm="Near Metro Station" loc="Banjara Hills" pc="500034" state="Telangana" street="Road No. 12" subdist="Khairatabad" vtc="Hyderabad"/>
</UidData></KycRes></CertificateData></Certificate>`;
  }

  async listIssued(token: DlToken): Promise<DlIssuedItem[]> {
    const t = await this.tech(token);
    if ((t.fullName ?? '').toLowerCase().includes('nopan')) return [];
    const pan = MockDigilockerClient.pan(t.id);
    return [{ name: 'PAN Verification Record', uri: `in.gov.pan-PANCR-${pan}`, doctype: 'PANCR', issuerid: 'in.gov.pan', issuer: 'Income Tax Department' }];
  }

  async getIssuedXml(token: DlToken, uri: string): Promise<string> {
    await this.tech(token);
    const pan = uri.split('-PANCR-')[1];
    return `<?xml version="1.0" encoding="UTF-8"?>
<Certificate language="99" name="PAN Verification Record" type="PANCR" number="${pan}" status="A">
<IssuedBy><Organization name="Income Tax Department"/></IssuedBy>
<IssuedTo><Person name="${token.name}" dob="${token.dob?.replace(/^(\d{2})(\d{2})(\d{4})$/, '$1-$2-$3')}"/></IssuedTo></Certificate>`;
  }
}
