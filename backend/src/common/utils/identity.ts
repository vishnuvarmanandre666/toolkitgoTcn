/**
 * Pure validation / normalisation / masking helpers for Indian identifiers.
 * Kept dependency-free so they can be unit-tested and mirrored on the frontend.
 */

/** Indian mobile: 10 digits starting 6-9. Accepts optional +91 / 91 / 0 prefix and separators. */
export function normalizeIndianMobile(input: string): string | null {
  if (typeof input !== 'string') return null;
  let digits = input.replace(/[\s\-()]/g, '');
  if (digits.startsWith('+91')) digits = digits.slice(3);
  else if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  return /^[6-9]\d{9}$/.test(digits) ? digits : null;
}

/** E.164-style storage key without '+': 91XXXXXXXXXX */
export const toStoredPhone = (tenDigit: string) => `91${tenDigit}`;

export function maskPhone(phone: string): string {
  const d = phone.replace(/\D/g, '').slice(-10);
  return d.length === 10 ? `${d.slice(0, 2)}******${d.slice(-2)}` : '**********';
}

// --- Aadhaar (Verhoeff checksum) -------------------------------------------
const VERHOEFF_D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 2, 3, 4, 0, 6, 7, 8, 9, 5], [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7], [4, 0, 1, 2, 3, 9, 5, 6, 7, 8], [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2], [7, 6, 5, 9, 8, 2, 1, 0, 4, 3], [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const VERHOEFF_P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 5, 7, 6, 2, 8, 3, 0, 9, 4], [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7], [9, 4, 5, 3, 1, 2, 6, 8, 7, 0], [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5], [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

export function verhoeffValid(num: string): boolean {
  let c = 0;
  const digits = num.split('').reverse().map(Number);
  for (let i = 0; i < digits.length; i++) c = VERHOEFF_D[c][VERHOEFF_P[i % 8][digits[i]]];
  return c === 0;
}

/** 12 digits, not starting with 0 or 1, valid Verhoeff checksum. */
export function normalizeAadhaar(input: string): string | null {
  const d = (input ?? '').replace(/[\s-]/g, '');
  if (!/^[2-9]\d{11}$/.test(d)) return null;
  return verhoeffValid(d) ? d : null;
}

export const maskAadhaar = (last4: string | null | undefined) => (last4 ? `XXXX XXXX ${last4}` : null);

// --- PAN --------------------------------------------------------------------
/** AAAAA9999A; 4th char is holder type — technicians must hold an individual ('P') PAN. */
export const PAN_REGEX = /^[A-Z]{3}[ABCFGHLJPT][A-Z]\d{4}[A-Z]$/;
export function normalizePan(input: string): string | null {
  const p = (input ?? '').trim().toUpperCase();
  return PAN_REGEX.test(p) ? p : null;
}
export const isIndividualPan = (pan: string) => pan.charAt(3) === 'P';
export const maskPan = (pan: string) => `${pan.slice(0, 2)}XXXXX${pan.slice(7)}`;

// --- Banking ----------------------------------------------------------------
export const IFSC_REGEX = /^[A-Z]{4}0[A-Z0-9]{6}$/;
export const BANK_ACCOUNT_REGEX = /^\d{9,18}$/;
export const maskAccount = (last4: string) => `XXXXXXXX${last4}`;

export const PIN_CODE_REGEX = /^[1-9]\d{5}$/;

// --- Name matching ----------------------------------------------------------
const HONORIFICS = new Set(['mr', 'mrs', 'ms', 'miss', 'dr', 'shri', 'smt', 'kumari', 'sri', 'km']);

export function normalizeName(name: string): string[] {
  return (name ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t && !HONORIFICS.has(t));
}

function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

/**
 * Order-insensitive similarity in [0,1]. Tokens are matched greedily; an
 * initial ("R") matches a full token starting with that letter
 * ("Ramesh"). Score is weighted by the longer name so missing tokens count.
 */
export function nameMatchScore(a: string, b: string): number {
  const ta = normalizeName(a);
  const tb = normalizeName(b);
  if (!ta.length || !tb.length) return 0;
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  const used = new Set<number>();
  let total = 0;
  for (const t of short) {
    let best = 0;
    let bestIdx = -1;
    long.forEach((u, idx) => {
      if (used.has(idx)) return;
      let s: number;
      if (t.length === 1 || u.length === 1) s = t[0] === u[0] ? 0.9 : 0;
      else s = 1 - levenshtein(t, u) / Math.max(t.length, u.length);
      if (s > best) {
        best = s;
        bestIdx = idx;
      }
    });
    if (bestIdx >= 0) used.add(bestIdx);
    total += best;
  }
  return Math.round((total / long.length) * 1000) / 1000;
}

/** Computes age in whole years at `at`. */
export function ageOn(dob: Date, at = new Date()): number {
  let age = at.getUTCFullYear() - dob.getUTCFullYear();
  const m = at.getUTCMonth() - dob.getUTCMonth();
  if (m < 0 || (m === 0 && at.getUTCDate() < dob.getUTCDate())) age--;
  return age;
}

export const sameDate = (a?: Date | null, b?: Date | null) =>
  !!a && !!b && a.toISOString().slice(0, 10) === b.toISOString().slice(0, 10);
