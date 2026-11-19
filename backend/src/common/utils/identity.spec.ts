import {
  isIndividualPan,
  maskAadhaar,
  maskPan,
  maskPhone,
  nameMatchScore,
  normalizeAadhaar,
  normalizeIndianMobile,
  normalizePan,
  verhoeffValid,
  IFSC_REGEX,
} from './identity';

/** Builds a Verhoeff-valid 12-digit Aadhaar-format number from an 11-digit prefix. */
export function withVerhoeffCheckDigit(prefix11: string): string {
  for (let d = 0; d <= 9; d++) if (verhoeffValid(prefix11 + d)) return prefix11 + d;
  throw new Error('unreachable');
}

describe('identity utils', () => {
  it('normalises Indian mobile numbers', () => {
    expect(normalizeIndianMobile('9876543210')).toBe('9876543210');
    expect(normalizeIndianMobile('+91 98765-43210')).toBe('9876543210');
    expect(normalizeIndianMobile('919876543210')).toBe('9876543210');
    expect(normalizeIndianMobile('09876543210')).toBe('9876543210');
    expect(normalizeIndianMobile('5876543210')).toBeNull();
    expect(normalizeIndianMobile('98765')).toBeNull();
  });

  it('masks phone numbers', () => {
    expect(maskPhone('919876543210')).toBe('98******10');
  });

  it('validates Aadhaar with Verhoeff checksum', () => {
    const valid = withVerhoeffCheckDigit('23456789012');
    expect(normalizeAadhaar(valid)).toBe(valid);
    expect(normalizeAadhaar(`${valid.slice(0, 4)} ${valid.slice(4, 8)} ${valid.slice(8)}`)).toBe(valid);
    const wrongCheck = valid.slice(0, 11) + ((Number(valid[11]) + 1) % 10);
    expect(normalizeAadhaar(wrongCheck)).toBeNull();
    expect(normalizeAadhaar('123456789012')).toBeNull(); // cannot start with 1
    expect(maskAadhaar('1234')).toBe('XXXX XXXX 1234');
  });

  it('validates and masks PAN', () => {
    expect(normalizePan('abcpe1234f')).toBe('ABCPE1234F');
    expect(normalizePan('ABCDE1234')).toBeNull();
    expect(normalizePan('ABCXE1234F')).toBeNull(); // X is not a valid holder type
    expect(isIndividualPan('ABCPE1234F')).toBe(true);
    expect(isIndividualPan('ABCCE1234F')).toBe(false);
    expect(maskPan('ABCPE1234F')).toBe('ABXXXXX34F');
  });

  it('validates IFSC', () => {
    expect(IFSC_REGEX.test('SBIN0001234')).toBe(true);
    expect(IFSC_REGEX.test('SBIN1001234')).toBe(false);
  });

  it('scores name matches order-insensitively with initials and honorifics', () => {
    expect(nameMatchScore('Ramesh Kumar', 'ramesh kumar')).toBe(1);
    expect(nameMatchScore('Kumar Ramesh', 'Ramesh Kumar')).toBe(1);
    expect(nameMatchScore('Mr. R Kumar', 'Ramesh Kumar')).toBeGreaterThanOrEqual(0.9);
    expect(nameMatchScore('Ramesh Kumar', 'Rames Kumar')).toBeGreaterThan(0.8);
    expect(nameMatchScore('Ramesh Kumar', 'Suresh Reddy')).toBeLessThan(0.5);
    expect(nameMatchScore('Ramesh Kumar Gupta', 'Ramesh Kumar')).toBeLessThan(0.8);
    expect(nameMatchScore('', 'Ramesh')).toBe(0);
  });
});
