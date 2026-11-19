import { AppConfig } from '../config/app-config';
import { maskAadhaar, maskAccount, maskPhone } from '../common/utils/identity';
import {
  approvalBlockers,
  categoryLabel,
  computeSteps,
  isEditable,
  progressPercent,
  requiredDocumentCategories,
  submissionBlockers,
  TechnicianKyc,
} from './kyc-rules';

/**
 * The ONLY place a technician record is turned into an API response.
 * Ciphertext, blind indexes and object keys are never included; identifiers
 * are always masked.
 */
const pickAddress = <T extends Record<string, unknown> | null>(a: T) => {
  if (!a) return null;
  const { id: _id, technicianId: _t, reviewedById: _r, ...rest } = a as Record<string, unknown>;
  return rest;
};

const serializeDocuments = (t: TechnicianKyc) =>
  t.documents.map((d) => ({
    id: d.id,
    category: d.category,
    categoryLabel: categoryLabel(d.category),
    label: d.label,
    status: d.status,
    rejectionReason: d.rejectionReason,
    reviewedAt: d.reviewedAt,
    currentVersion: d.currentVersion
      ? {
          id: d.currentVersion.id,
          version: d.currentVersion.version,
          originalName: d.currentVersion.originalName,
          mimeType: d.currentVersion.mimeType,
          sizeBytes: d.currentVersion.sizeBytes,
          scanStatus: d.currentVersion.scanStatus,
          uploadedAt: d.currentVersion.uploadedAt,
        }
      : null,
  }));

function base(t: TechnicianKyc, policy: AppConfig['kycPolicy']) {
  const steps = computeSteps(t, policy);
  return {
    id: t.id,
    phone: maskPhone(t.phone),
    countryCode: t.countryCode,
    kycStatus: t.kycStatus,
    isActive: t.isActive,
    activatedAt: t.activatedAt,
    submittedAt: t.submittedAt,
    reviewedAt: t.reviewedAt,
    rejectionReason: t.rejectionReason,
    editable: isEditable(t.kycStatus),
    progress: { percent: progressPercent(steps), steps },
    verifications: {
      mobile: t.mobileVerification,
      aadhaar: t.aadhaar?.verificationStatus ?? 'PENDING',
      pan: t.pan?.verificationStatus ?? 'PENDING',
      aadhaarAddress: t.aadhaarAddress?.verificationStatus ?? null,
      currentAddress: t.currentAddress?.verificationStatus ?? null,
      bank: t.bank?.verificationStatus ?? (policy.requireBankDetails ? 'PENDING' : null),
    },
    personal: {
      fullName: t.fullName,
      dateOfBirth: t.dateOfBirth ? t.dateOfBirth.toISOString().slice(0, 10) : null,
      gender: t.gender,
      email: t.email,
      emergencyContact: t.emergencyContact,
    },
    aadhaar: t.aadhaar
      ? {
          maskedNumber: maskAadhaar(t.aadhaar.aadhaarLast4),
          nameOnAadhaar: t.aadhaar.nameOnAadhaar,
          dobOnAadhaar: t.aadhaar.dobOnAadhaar?.toISOString().slice(0, 10) ?? null,
          consentGiven: t.aadhaar.consentGiven,
          consentAt: t.aadhaar.consentAt,
          verificationStatus: t.aadhaar.verificationStatus,
          verificationMethod: t.aadhaar.verificationMethod,
          referenceId: t.aadhaar.providerRefId,
          verifiedAt: t.aadhaar.verifiedAt,
          nameMatched: t.aadhaar.nameMatched,
          dobMatched: t.aadhaar.dobMatched,
          failureReason: t.aadhaar.failureReason,
        }
      : null,
    pan: t.pan
      ? {
          maskedPan: t.pan.panMasked,
          holderName: t.pan.holderName,
          verificationStatus: t.pan.verificationStatus,
          verificationMethod: t.pan.verificationMethod,
          referenceId: t.pan.providerRefId,
          verifiedAt: t.pan.verifiedAt,
          nameMatched: t.pan.nameMatched,
          failureReason: t.pan.failureReason,
        }
      : null,
    addressesSame: t.addressesSame,
    addressProofRequested: t.addressProofRequested,
    aadhaarAddress: pickAddress(t.aadhaarAddress),
    currentAddress: pickAddress(t.currentAddress),
    bank: t.bank
      ? {
          accountHolderName: t.bank.accountHolderName,
          maskedAccountNumber: maskAccount(t.bank.accountLast4),
          ifsc: t.bank.ifsc,
          bankName: t.bank.bankName,
          branchName: t.bank.branchName,
          verificationStatus: t.bank.verificationStatus,
        }
      : null,
    documents: serializeDocuments(t),
    requiredDocuments: requiredDocumentCategories(t, policy).map((c) => ({ category: c, label: categoryLabel(c) })),
    feedback: t.feedback.map((f) => ({
      id: f.id,
      section: f.section,
      documentId: f.documentId,
      message: f.message,
      resolved: f.resolved,
      createdAt: f.createdAt,
    })),
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  };
}

export function serializeForTechnician(t: TechnicianKyc, policy: AppConfig['kycPolicy'], extras: { digilockerEnabled?: boolean } = {}) {
  return {
    ...base(t, policy),
    submissionBlockers: submissionBlockers(t, policy),
    policy: {
      requireBankDetails: policy.requireBankDetails,
      requireBankProof: policy.requireBankProof,
      requireAddressProof: policy.requireAddressProof,
      requireCertificates: policy.requireCertificates,
      aadhaarConsentVersion: policy.aadhaarConsentVersion,
      digilockerEnabled: !!extras.digilockerEnabled,
    },
  };
}

export function serializeForAdmin(t: TechnicianKyc, policy: AppConfig['kycPolicy']) {
  const b = base(t, policy);
  return {
    ...b,
    submissionCount: t.submissionCount,
    reviewStartedAt: t.reviewStartedAt,
    reviewedById: t.reviewedById,
    approvalBlockers: approvalBlockers(t, policy),
    addressesDiffer: !!t.aadhaarAddress && !!t.currentAddress && !t.addressesSame,
    aadhaarReview: t.aadhaar
      ? { providerName: t.aadhaar.providerName, nameMatchScore: t.aadhaar.nameMatchScore, reviewNote: t.aadhaar.reviewNote, consentVersion: t.aadhaar.consentVersion }
      : null,
    panReview: t.pan ? { providerName: t.pan.providerName, nameMatchScore: t.pan.nameMatchScore, reviewNote: t.pan.reviewNote } : null,
    bankReview: t.bank ? { reviewNote: t.bank.reviewNote, verifiedAt: t.bank.verifiedAt } : null,
  };
}
