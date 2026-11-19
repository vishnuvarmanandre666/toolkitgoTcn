'use client';

import { api } from '@/lib/api';
import { formatDate } from '@/lib/status';
import { Alert, Button, StatusBadge } from '@/components/ui';
import { useSave } from './useSave';

const VERIFICATION_ROWS = [
  ['mobile', 'Mobile number'],
  ['aadhaar', 'Aadhaar'],
  ['pan', 'PAN'],
  ['aadhaarAddress', 'Aadhaar address'],
  ['currentAddress', 'Current address'],
  ['bank', 'Bank account'],
];

export default function ReviewStep({ kyc, onUpdate, goTo }) {
  const { saving, serverError, run } = useSave(onUpdate);
  const submitted = ['SUBMITTED', 'UNDER_REVIEW', 'APPROVED'].includes(kyc.kycStatus);
  const resubmission = kyc.kycStatus === 'ACTION_REQUIRED';

  return (
    <div className="space-y-6">
      <div className="overflow-hidden rounded-xl border border-ink-200">
        <table className="w-full text-sm">
          <caption className="sr-only">Verification status</caption>
          <tbody className="divide-y divide-ink-100">
            {VERIFICATION_ROWS.filter(([k]) => kyc.verifications[k] !== null).map(([k, label]) => (
              <tr key={k}>
                <th scope="row" className="px-4 py-3 text-left font-medium text-ink-700">
                  {label}
                </th>
                <td className="px-4 py-3 text-right">
                  <StatusBadge status={kyc.verifications[k] || 'PENDING'} />
                </td>
              </tr>
            ))}
            <tr>
              <th scope="row" className="px-4 py-3 text-left font-medium text-ink-700">
                Documents
              </th>
              <td className="px-4 py-3 text-right text-ink-600">
                {kyc.documents.filter((d) => d.currentVersion).length} uploaded
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {submitted ? (
        <Alert tone={kyc.kycStatus === 'APPROVED' ? 'success' : 'info'} title={kyc.kycStatus === 'APPROVED' ? 'KYC approved' : 'Application submitted'}>
          {kyc.kycStatus === 'APPROVED' ? 'Your KYC has been approved.' : `Submitted on ${formatDate(kyc.submittedAt)}. We'll notify you once the review is complete.`}
        </Alert>
      ) : kyc.submissionBlockers.length ? (
        <Alert tone="warn" title="Before you can submit">
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {kyc.progress.steps
              .filter((s) => !s.complete && !s.optional && s.key !== 'submission')
              .map((s) => (
                <li key={s.key}>
                  <button type="button" className="font-semibold underline-offset-2 hover:underline" onClick={() => goTo(s.key)}>
                    {s.label}
                  </button>
                  {s.hint && <span>: {s.hint}</span>}
                </li>
              ))}
          </ul>
        </Alert>
      ) : (
        <Alert tone="success" title="Ready to submit">
          Please check your details. Once submitted, your application is locked while our team reviews it.
        </Alert>
      )}

      {serverError && <Alert tone="error">{serverError}</Alert>}

      {kyc.editable && (
        <div className="flex justify-end">
          <Button
            variant="success"
            loading={saving}
            disabled={kyc.submissionBlockers.length > 0}
            onClick={() => run(() => api('/technician/kyc/submit', { method: 'POST' }), resubmission ? 'Application re-submitted for review' : 'Application submitted for review')}
          >
            {resubmission ? 'Re-submit application' : 'Submit application'}
          </Button>
        </div>
      )}
    </div>
  );
}
