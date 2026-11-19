import {
  AadhaarAddressStatus,
  CurrentAddressStatus,
  DocumentCategory,
  DocumentStatus,
  KycStatus,
  Prisma,
  VerificationMethod,
  VerificationStatus,
} from '@prisma/client';
import { AppConfig } from '../config/app-config';

/**
 * Pure KYC business rules: required documents, step completion, submission
 * and approval gates, and the allowed status transitions. No I/O here.
 */

export const TECHNICIAN_KYC_INCLUDE = {
  aadhaar: true,
  pan: true,
  aadhaarAddress: true,
  currentAddress: true,
  bank: true,
  documents: { include: { currentVersion: true }, orderBy: { createdAt: 'asc' } },
  feedback: { orderBy: { createdAt: 'desc' } },
} satisfies Prisma.TechnicianInclude;

export type TechnicianKyc = Prisma.TechnicianGetPayload<{ include: typeof TECHNICIAN_KYC_INCLUDE }>;
export type KycPolicy = AppConfig['kycPolicy'];

/** The technician may edit their application only in these states. */
export const EDITABLE_STATUSES: KycStatus[] = [KycStatus.NOT_STARTED, KycStatus.IN_PROGRESS, KycStatus.ACTION_REQUIRED];
export const isEditable = (s: KycStatus) => EDITABLE_STATUSES.includes(s);

/** Allowed application-level transitions. */
export const TRANSITIONS: Record<KycStatus, KycStatus[]> = {
  NOT_STARTED: [KycStatus.IN_PROGRESS],
  IN_PROGRESS: [KycStatus.SUBMITTED],
  SUBMITTED: [KycStatus.UNDER_REVIEW, KycStatus.ACTION_REQUIRED, KycStatus.REJECTED],
  UNDER_REVIEW: [KycStatus.ACTION_REQUIRED, KycStatus.APPROVED, KycStatus.REJECTED],
  ACTION_REQUIRED: [KycStatus.SUBMITTED],
  APPROVED: [KycStatus.ACTION_REQUIRED], // e.g. periodic re-KYC / document expiry
  REJECTED: [],
};
export const canTransition = (from: KycStatus, to: KycStatus) => TRANSITIONS[from].includes(to);

/** Documents that can exist more than once per technician. */
export const MULTI_DOCUMENT_CATEGORIES: DocumentCategory[] = [DocumentCategory.CERTIFICATE, DocumentCategory.OTHER];

const PROVIDER_METHODS: (VerificationMethod | null | undefined)[] = [VerificationMethod.PROVIDER, VerificationMethod.OFFLINE_EKYC, VerificationMethod.DIGILOCKER];

/** PAN fetched from DigiLocker (issued by the Income Tax Dept) needs no uploaded copy. */
const panFromDigilocker = (t: TechnicianKyc) =>
  t.pan?.verificationStatus === VerificationStatus.VERIFIED && t.pan.verificationMethod === VerificationMethod.DIGILOCKER;

/** A document's current version is "usable" unless it has been rejected. */
const hasUsableDocument = (t: TechnicianKyc, category: DocumentCategory) =>
  t.documents.some(
    (d) =>
      d.category === category &&
      d.currentVersionId &&
      d.status !== DocumentStatus.REJECTED &&
      d.status !== DocumentStatus.REUPLOAD_REQUIRED,
  );

export function requiredDocumentCategories(t: TechnicianKyc, policy: KycPolicy): DocumentCategory[] {
  const req: DocumentCategory[] = [DocumentCategory.PROFILE_PHOTO];
  if (!panFromDigilocker(t)) req.push(DocumentCategory.PAN);
  // Aadhaar copy is needed for the manual-review fallback; a provider/offline e-KYC
  // verification makes it unnecessary (data minimisation).
  const aadhaarProviderVerified =
    t.aadhaar?.verificationStatus === VerificationStatus.VERIFIED && PROVIDER_METHODS.includes(t.aadhaar.verificationMethod);
  if (!aadhaarProviderVerified) req.push(DocumentCategory.AADHAAR);
  if (policy.requireAddressProof || t.addressProofRequested) req.push(DocumentCategory.ADDRESS_PROOF);
  if (policy.requireBankDetails && policy.requireBankProof) req.push(DocumentCategory.BANK_PROOF);
  if (policy.requireCertificates) req.push(DocumentCategory.CERTIFICATE);
  return req;
}

export type StepKey = 'mobile' | 'personal' | 'aadhaar' | 'pan' | 'address' | 'documents' | 'bank' | 'submission';
export interface StepState {
  key: StepKey;
  label: string;
  complete: boolean;
  optional?: boolean;
  /** Short human-readable hint about what is missing. */
  hint?: string;
}

const STARTED_VERIFICATION: VerificationStatus[] = [
  VerificationStatus.VERIFIED,
  VerificationStatus.MANUAL_REVIEW,
  VerificationStatus.IN_PROGRESS,
];

export function computeSteps(t: TechnicianKyc, policy: KycPolicy): StepState[] {
  const steps: StepState[] = [];

  steps.push({ key: 'mobile', label: 'Mobile verification', complete: t.mobileVerification === VerificationStatus.VERIFIED });

  const personalMissing: string[] = [];
  if (!t.fullName) personalMissing.push('full name');
  if (!t.dateOfBirth) personalMissing.push('date of birth');
  if (!t.emergencyContact) personalMissing.push('emergency contact');
  if (!hasUsableDocument(t, DocumentCategory.PROFILE_PHOTO)) personalMissing.push('profile photo');
  steps.push({
    key: 'personal',
    label: 'Personal information',
    complete: personalMissing.length === 0,
    hint: personalMissing.length ? `Add ${personalMissing.join(', ')}` : undefined,
  });

  const a = t.aadhaar;
  const needsAadhaarDoc = requiredDocumentCategories(t, policy).includes(DocumentCategory.AADHAAR);
  const aadhaarComplete =
    !!a && a.consentGiven && !!a.aadhaarLast4 && !!a.nameOnAadhaar && STARTED_VERIFICATION.includes(a.verificationStatus) &&
    (!needsAadhaarDoc || hasUsableDocument(t, DocumentCategory.AADHAAR));
  steps.push({
    key: 'aadhaar',
    label: 'Aadhaar details',
    complete: aadhaarComplete,
    hint: !a?.consentGiven
      ? 'Provide consent and Aadhaar details'
      : a.verificationStatus === VerificationStatus.FAILED
        ? 'Verification failed — correct details or request manual review'
        : needsAadhaarDoc && !hasUsableDocument(t, DocumentCategory.AADHAAR)
          ? 'Upload your Aadhaar card'
          : !aadhaarComplete
            ? 'Start Aadhaar verification'
            : undefined,
  });

  const p = t.pan;
  const needsPanDoc = !panFromDigilocker(t);
  const panComplete =
    !!p && !!p.panMasked && !!p.holderName && STARTED_VERIFICATION.includes(p.verificationStatus) && (!needsPanDoc || hasUsableDocument(t, DocumentCategory.PAN));
  steps.push({
    key: 'pan',
    label: 'PAN details',
    complete: panComplete,
    hint: !p
      ? 'Enter PAN details'
      : p.verificationStatus === VerificationStatus.FAILED
        ? 'Verification failed — correct details or request manual review'
        : needsPanDoc && !hasUsableDocument(t, DocumentCategory.PAN)
          ? 'Upload your PAN card'
          : !panComplete
            ? 'Start PAN verification'
            : undefined,
  });

  const addressComplete = !!t.aadhaarAddress && !!t.currentAddress;
  steps.push({
    key: 'address',
    label: 'Address information',
    complete: addressComplete,
    hint: !t.aadhaarAddress ? 'Add Aadhaar address' : !t.currentAddress ? 'Add current residential address' : undefined,
  });

  const missingDocs = requiredDocumentCategories(t, policy).filter((c) => !hasUsableDocument(t, c));
  steps.push({
    key: 'documents',
    label: 'Document uploads',
    complete: missingDocs.length === 0,
    hint: missingDocs.length ? `Missing: ${missingDocs.map(categoryLabel).join(', ')}` : undefined,
  });

  steps.push({
    key: 'bank',
    label: 'Bank details',
    complete: !policy.requireBankDetails || !!t.bank,
    optional: !policy.requireBankDetails,
    hint: policy.requireBankDetails && !t.bank ? 'Add payout bank account' : undefined,
  });

  const submittedStates: KycStatus[] = [KycStatus.SUBMITTED, KycStatus.UNDER_REVIEW, KycStatus.APPROVED];
  steps.push({ key: 'submission', label: 'Final submission', complete: submittedStates.includes(t.kycStatus) });
  return steps;
}

/** Reasons the technician cannot submit yet (empty = ready). */
export function submissionBlockers(t: TechnicianKyc, policy: KycPolicy): string[] {
  const blockers = computeSteps(t, policy)
    .filter((s) => s.key !== 'submission' && !s.complete && !s.optional)
    .map((s) => `${s.label}: ${s.hint ?? 'incomplete'}`);
  if (!isEditable(t.kycStatus)) blockers.push(`Application is ${t.kycStatus.replace('_', ' ').toLowerCase()} and cannot be submitted.`);
  return blockers;
}

/**
 * Reasons an admin cannot approve yet. Approval requires every individual
 * verification to be complete — one verified document never approves the whole file.
 */
export function approvalBlockers(t: TechnicianKyc, policy: KycPolicy): string[] {
  const b: string[] = [];
  if (t.kycStatus !== KycStatus.UNDER_REVIEW) b.push('Application must be under review.');
  if (t.mobileVerification !== VerificationStatus.VERIFIED) b.push('Mobile number not verified.');
  if (!t.fullName || !t.dateOfBirth) b.push('Personal information incomplete.');
  if (t.aadhaar?.verificationStatus !== VerificationStatus.VERIFIED) b.push('Aadhaar not verified.');
  if (t.pan?.verificationStatus !== VerificationStatus.VERIFIED) b.push('PAN not verified.');

  const aa = t.aadhaarAddress?.verificationStatus;
  if (!aa) b.push('Aadhaar address missing.');
  else if (aa === AadhaarAddressStatus.REJECTED || aa === AadhaarAddressStatus.PENDING) b.push('Aadhaar address needs review.');

  const ca = t.currentAddress?.verificationStatus;
  if (!ca) b.push('Current address missing.');
  else if (ca === CurrentAddressStatus.REJECTED) b.push('Current address was rejected.');
  else if (t.addressProofRequested && ca === CurrentAddressStatus.SELF_DECLARED) b.push('Requested address proof not yet verified.');

  for (const cat of requiredDocumentCategories(t, policy)) {
    const docs = t.documents.filter((d) => d.category === cat);
    if (!docs.length) b.push(`${categoryLabel(cat)} not uploaded.`);
    else if (!docs.some((d) => d.status === DocumentStatus.VERIFIED)) b.push(`${categoryLabel(cat)} not verified.`);
  }
  const otherDocs = t.documents.filter((d) => d.currentVersionId && d.status !== DocumentStatus.VERIFIED && !requiredDocumentCategories(t, policy).includes(d.category));
  for (const d of otherDocs) {
    if (d.status === DocumentStatus.PENDING_VERIFICATION || d.status === DocumentStatus.UPLOADED) {
      b.push(`${categoryLabel(d.category)}${d.label ? ` (${d.label})` : ''} awaiting review.`);
    }
  }

  if (policy.requireBankDetails && t.bank?.verificationStatus !== VerificationStatus.VERIFIED) b.push('Bank details not verified.');
  return b;
}

export function categoryLabel(c: DocumentCategory): string {
  return {
    AADHAAR: 'Aadhaar card',
    PAN: 'PAN card',
    PROFILE_PHOTO: 'Profile photo',
    ADDRESS_PROOF: 'Address proof',
    BANK_PROOF: 'Bank proof (cancelled cheque / passbook)',
    CERTIFICATE: 'Professional certificate',
    OTHER: 'Other document',
  }[c];
}

export function progressPercent(steps: StepState[]): number {
  const counted = steps.filter((s) => !s.optional);
  return Math.round((counted.filter((s) => s.complete).length / counted.length) * 100);
}
