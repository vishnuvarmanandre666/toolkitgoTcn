import { createHash, createHmac } from 'crypto';
import http from 'http';
import { AddressInfo } from 'net';
import { LiveDigilockerClient, verifyHmac } from './digilocker.client';
import { panFromUri, parseEaadhaar, parseIndianDate, parsePanXml } from './digilocker-xml';

const EAADHAAR = `<?xml version="1.0" encoding="UTF-8"?>
<Certificate><CertificateData><KycRes ret="Y"><UidData uid="xxxxxxxx4321">
<Poi dob="15-06-1988" gender="M" name="Suresh &amp; Babu"/>
<Poa co="S/O Ramaiah" country="India" dist="Guntur" house="4-5" lm="Opp temple" loc="Brodipet" pc="522002" state="Andhra Pradesh" street="2nd Lane" subdist="Guntur East" vtc="Guntur"/>
</UidData></KycRes></CertificateData></Certificate>`;

describe('DigiLocker XML parsing', () => {
  it('extracts masked uid, identity and address from e-Aadhaar', () => {
    const e = parseEaadhaar(EAADHAAR);
    expect(e.last4).toBe('4321');
    expect(e.name).toBe('Suresh & Babu');
    expect(e.dob?.toISOString().slice(0, 10)).toBe('1988-06-15');
    expect(e.address).toMatchObject({ houseNumber: '4-5', villageCity: 'Guntur', mandalTaluka: 'Guntur East', district: 'Guntur', state: 'Andhra Pradesh', pinCode: '522002' });
  });

  it('returns no address when the Poa is incomplete', () => {
    expect(parseEaadhaar('<UidData uid="xxxxxxxx1111"><Poi name="A B"/><Poa state="X"/></UidData>').address).toBeNull();
  });

  it('ignores DTD/entities beyond the basic XML set (no XXE expansion)', () => {
    const evil = '<!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><UidData uid="xxxxxxxx1234"><Poi name="&e;"/></UidData>';
    expect(parseEaadhaar(evil).name).toBe('&e;');
  });

  it('reads PAN from URI and PAN XML', () => {
    expect(panFromUri('in.gov.pan-PANCR-ABCPE1234F')).toBe('ABCPE1234F');
    expect(panFromUri('in.gov.cbse-HSCER-2014')).toBeNull();
    const x = parsePanXml('<Certificate type="PANCR" number="abcpe1234f"><IssuedTo><Person name="Suresh Babu" dob="15-06-1988"/></IssuedTo></Certificate>');
    expect(x).toMatchObject({ pan: 'ABCPE1234F', name: 'Suresh Babu' });
  });

  it('parses DigiLocker date formats', () => {
    expect(parseIndianDate('31121970')?.toISOString().slice(0, 10)).toBe('1970-12-31');
    expect(parseIndianDate('31-12-1970')?.toISOString().slice(0, 10)).toBe('1970-12-31');
    expect(parseIndianDate('nonsense')).toBeNull();
  });
});

describe('LiveDigilockerClient (against a stub DigiLocker)', () => {
  const secret = 'client-secret-123';
  let server: http.Server;
  let base: string;
  let lastTokenBody: URLSearchParams | null = null;
  let tamper = false;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.method === 'POST' && req.url === '/public/oauth2/1/token') {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          lastTokenBody = new URLSearchParams(body);
          res.writeHead(200, { 'content-type': 'application/json' }).end(
            JSON.stringify({ access_token: 'AT', scope: 'files.issueddocs', digilockerid: 'dl-1', name: 'Suresh Babu', dob: '15061988', gender: 'M', eaadhaar: 'Y' }),
          );
        });
        return;
      }
      if (req.headers.authorization !== 'Bearer AT') return res.writeHead(401).end('{"error":"invalid_token"}');
      if (req.url === '/public/oauth2/3/xml/eaadhaar') {
        const hmac = createHmac('sha256', secret).update(EAADHAAR).digest('base64');
        res.writeHead(200, { 'content-type': 'application/xml', hmac: tamper ? 'AAAA' + hmac.slice(4) : hmac }).end(EAADHAAR);
        return;
      }
      if (req.url === '/public/oauth2/2/files/issued') {
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ items: [{ name: 'PAN', uri: ' in.gov.pan-PANCR-ABCPE1234F', doctype: 'PANCR' }] }));
        return;
      }
      res.writeHead(404).end('{}');
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => server.close());

  const client = () =>
    new LiveDigilockerClient({ mode: 'live', clientId: 'CID', clientSecret: secret, redirectUri: 'https://app.example/cb', authBaseUrl: base, apiBaseUrl: base, stateTtlSeconds: 600 });

  it('builds a PKCE authorize URL with PAN requested', () => {
    const url = new URL(client().authorizeUrl({ state: 'S', codeChallenge: 'C' }));
    expect(url.pathname).toBe('/public/oauth2/1/authorize');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      response_type: 'code', client_id: 'CID', redirect_uri: 'https://app.example/cb', state: 'S', code_challenge: 'C', code_challenge_method: 'S256', req_doctype: 'PANCR',
    });
  });

  it('exchanges the code with verifier + client credentials', async () => {
    const tok = await client().exchangeCode('CODE', 'VERIFIER');
    expect(tok).toMatchObject({ accessToken: 'AT', digilockerId: 'dl-1', eaadhaar: true, name: 'Suresh Babu' });
    expect(Object.fromEntries(lastTokenBody!)).toMatchObject({
      code: 'CODE', grant_type: 'authorization_code', client_id: 'CID', client_secret: secret, redirect_uri: 'https://app.example/cb', code_verifier: 'VERIFIER',
    });
  });

  it('accepts documents with a valid HMAC and rejects tampered ones', async () => {
    const tok = await client().exchangeCode('CODE', 'V');
    tamper = false;
    await expect(client().getEaadhaarXml(tok)).resolves.toContain('UidData');
    tamper = true;
    await expect(client().getEaadhaarXml(tok)).rejects.toMatchObject({ code: 'hmac_mismatch' });
    tamper = false;
  });

  it('lists issued documents (trimming URIs)', async () => {
    const tok = await client().exchangeCode('CODE', 'V');
    expect((await client().listIssued(tok))[0]).toMatchObject({ uri: 'in.gov.pan-PANCR-ABCPE1234F', doctype: 'PANCR' });
  });

  it('verifyHmac is constant-shape and strict', () => {
    const body = Buffer.from('x');
    expect(verifyHmac(body, createHmac('sha256', 's').update(body).digest('base64'), 's')).toBe(true);
    expect(verifyHmac(body, null, 's')).toBe(false);
    expect(verifyHmac(body, createHash('sha256').update('x').digest('base64'), 's')).toBe(false);
  });
});
