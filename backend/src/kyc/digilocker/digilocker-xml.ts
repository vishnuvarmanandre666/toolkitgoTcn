/**
 * Minimal, dependency-free extraction of the fields we need from DigiLocker
 * XML documents. Only attributes are read; no entity expansion / DTDs are
 * processed (no XXE surface).
 */

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });

/** Attributes of the first element named `tag` (namespace prefix ignored). */
export function elementAttrs(xml: string, tag: string): Record<string, string> | null {
  const m = xml.match(new RegExp(`<(?:[\\w-]+:)?${tag}(\\s[^>]*)?\\/?>`, 'i'));
  if (!m) return null;
  const attrs: Record<string, string> = {};
  for (const a of (m[1] ?? '').matchAll(/([\w:-]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) {
    attrs[a[1]] = decode(a[3] ?? a[4] ?? '').trim();
  }
  return attrs;
}

/** dd-mm-yyyy | dd/mm/yyyy | ddmmyyyy | yyyy-mm-dd → Date (UTC midnight) */
export function parseIndianDate(s?: string | null): Date | null {
  if (!s) return null;
  const v = s.trim();
  let m = v.match(/^(\d{2})[-/]?(\d{2})[-/]?(\d{4})$/);
  if (m) return new Date(`${m[3]}-${m[2]}-${m[1]}T00:00:00.000Z`);
  m = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00.000Z`);
  return null;
}

export interface EaadhaarData {
  last4: string | null;
  name: string | null;
  dob: Date | null;
  gender: string | null;
  address: {
    houseNumber?: string;
    street?: string;
    locality?: string;
    villageCity: string;
    mandalTaluka?: string;
    district: string;
    state: string;
    pinCode: string;
    country: string;
    landmark?: string;
    careOf?: string;
  } | null;
}

/**
 * e-Aadhaar XML (v3): <Certificate><CertificateData><KycRes><UidData uid="xxxxxxxx1234">
 *   <Poi name dob gender/> <Poa co house street lm loc vtc subdist dist state pc country/> ...
 */
export function parseEaadhaar(xml: string): EaadhaarData {
  const uid = elementAttrs(xml, 'UidData')?.uid ?? '';
  const poi = elementAttrs(xml, 'Poi') ?? {};
  const poa = elementAttrs(xml, 'Poa');
  const last4 = uid.replace(/\D/g, '').slice(-4) || null;

  let address: EaadhaarData['address'] = null;
  if (poa && (poa.vtc || poa.dist) && poa.state && /^\d{6}$/.test(poa.pc ?? '')) {
    address = {
      houseNumber: poa.house || undefined,
      street: poa.street || undefined,
      locality: poa.loc || undefined,
      villageCity: poa.vtc || poa.po || poa.dist,
      mandalTaluka: poa.subdist || undefined,
      district: poa.dist || poa.vtc,
      state: poa.state,
      pinCode: poa.pc,
      country: poa.country || 'India',
      landmark: poa.lm || undefined,
      careOf: poa.co || undefined,
    };
  }
  return { last4: last4 && last4.length === 4 ? last4 : null, name: poi.name || null, dob: parseIndianDate(poi.dob), gender: poi.gender || null, address };
}

/** PAN number from an issued-document URI like "in.gov.pan-PANCR-ABCDE1234F". */
export function panFromUri(uri: string): string | null {
  const m = uri.match(/-PANCR-([A-Z]{5}\d{4}[A-Z])$/i);
  return m ? m[1].toUpperCase() : null;
}

/** PAN verification record XML: <Certificate number="…"><IssuedTo><Person name="…" dob="…"/></IssuedTo></Certificate> */
export function parsePanXml(xml: string): { pan: string | null; name: string | null; dob: Date | null } {
  const cert = elementAttrs(xml, 'Certificate') ?? {};
  const person = elementAttrs(xml, 'Person') ?? {};
  const pan = (cert.number || '').toUpperCase();
  return { pan: /^[A-Z]{5}\d{4}[A-Z]$/.test(pan) ? pan : null, name: person.name || null, dob: parseIndianDate(person.dob) };
}
