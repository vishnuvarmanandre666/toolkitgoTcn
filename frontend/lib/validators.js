/**
 * Client-side validation mirrors the backend rules for instant feedback.
 * The backend remains the source of truth.
 */
const D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 2, 3, 4, 0, 6, 7, 8, 9, 5], [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7], [4, 0, 1, 2, 3, 9, 5, 6, 7, 8], [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2], [7, 6, 5, 9, 8, 2, 1, 0, 4, 3], [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 5, 7, 6, 2, 8, 3, 0, 9, 4], [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7], [9, 4, 5, 3, 1, 2, 6, 8, 7, 0], [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5], [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];
const verhoeff = (n) => n.split('').reverse().map(Number).reduce((c, d, i) => D[c][P[i % 8][d]], 0) === 0;

export const digitsOnly = (v) => (v || '').replace(/\D/g, '');

export const isMobile = (v) => /^[6-9]\d{9}$/.test(digitsOnly(v).replace(/^91(?=\d{10}$)/, ''));
export const isAadhaar = (v) => {
  const d = digitsOnly(v);
  return /^[2-9]\d{11}$/.test(d) && verhoeff(d);
};
export const isPan = (v) => /^[A-Z]{3}[ABCFGHLJPT][A-Z]\d{4}[A-Z]$/.test((v || '').toUpperCase());
export const isIndividualPan = (v) => (v || '').toUpperCase().charAt(3) === 'P';
export const isIfsc = (v) => /^[A-Z]{4}0[A-Z0-9]{6}$/.test((v || '').toUpperCase());
export const isPin = (v) => /^[1-9]\d{5}$/.test(v || '');
export const isName = (v) => /^[A-Za-z][A-Za-z .'-]{1,148}$/.test((v || '').trim());
export const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v || '');

export function ageFrom(dob) {
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age;
}

export const formatAadhaarInput = (v) =>
  digitsOnly(v)
    .slice(0, 12)
    .replace(/(\d{4})(?=\d)/g, '$1 ');

export const INDIAN_STATES = [
  'Andaman and Nicobar Islands', 'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chandigarh', 'Chhattisgarh',
  'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jammu and Kashmir',
  'Jharkhand', 'Karnataka', 'Kerala', 'Ladakh', 'Lakshadweep', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya',
  'Mizoram', 'Nagaland', 'Odisha', 'Puducherry', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura',
  'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
];
