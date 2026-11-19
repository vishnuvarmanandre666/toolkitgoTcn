/** Display metadata for every status used across the KYC system. */
const tone = {
  neutral: 'bg-ink-100 text-ink-700 ring-ink-200',
  info: 'bg-sky-50 text-sky-700 ring-sky-200',
  warn: 'bg-amber-50 text-amber-800 ring-amber-200',
  success: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  danger: 'bg-red-50 text-red-700 ring-red-200',
  brand: 'bg-brand-50 text-brand-700 ring-brand-200',
};

const STATUS = {
  // Application
  NOT_STARTED: ['Not started', 'neutral'],
  IN_PROGRESS: ['In progress', 'info'],
  SUBMITTED: ['Submitted', 'brand'],
  UNDER_REVIEW: ['Under review', 'brand'],
  ACTION_REQUIRED: ['Action required', 'warn'],
  APPROVED: ['Approved', 'success'],
  REJECTED: ['Rejected', 'danger'],
  // Documents
  NOT_UPLOADED: ['Not uploaded', 'neutral'],
  UPLOADED: ['Uploaded', 'info'],
  PENDING_VERIFICATION: ['Pending verification', 'brand'],
  VERIFIED: ['Verified', 'success'],
  REUPLOAD_REQUIRED: ['Re-upload required', 'warn'],
  // Verification
  PENDING: ['Pending', 'neutral'],
  FAILED: ['Failed', 'danger'],
  MANUAL_REVIEW: ['Manual review', 'brand'],
  UNAVAILABLE: ['Unavailable', 'neutral'],
  // Address
  UNVERIFIED: ['Unverified', 'warn'],
  SELF_DECLARED: ['Self-declared', 'neutral'],
  DOCUMENT_SUPPORTED: ['Document-supported', 'success'],
  MANUALLY_VERIFIED: ['Manually verified', 'success'],
  // Scan
  CLEAN: ['Scan clean', 'success'],
  SKIPPED: ['Scan skipped', 'neutral'],
  INFECTED: ['Infected', 'danger'],
};

export function statusMeta(status) {
  const [label, t] = STATUS[status] || [status ? String(status).replace(/_/g, ' ').toLowerCase() : '—', 'neutral'];
  return { label, className: tone[t] };
}

export const SOURCE_LABEL = {
  VERIFICATION_PROVIDER: 'From verification',
  SELF_DECLARED: 'Entered by technician',
  COPIED_FROM_AADHAAR: 'Same as Aadhaar address',
};

export const CATEGORY_LABEL = {
  AADHAAR: 'Aadhaar card',
  PAN: 'PAN card',
  PROFILE_PHOTO: 'Profile photo',
  ADDRESS_PROOF: 'Address proof',
  BANK_PROOF: 'Bank proof (cancelled cheque / passbook)',
  CERTIFICATE: 'Professional certificate',
  OTHER: 'Other document',
};

export const SECTION_LABEL = {
  MOBILE: 'Mobile',
  PERSONAL: 'Personal information',
  AADHAAR: 'Aadhaar',
  PAN: 'PAN',
  ADDRESS: 'Address',
  DOCUMENTS: 'Documents',
  BANK: 'Bank details',
  GENERAL: 'General',
};

export const formatDate = (d) =>
  d ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

export const formatBytes = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`);
