'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/status';
import { digitsOnly, formatAadhaarInput, isAadhaar, isName } from '@/lib/validators';
import { Alert, Button, Field, StatusBadge } from '@/components/ui';
import DocumentSlot from './DocumentSlot';
import DigilockerCard from './DigilockerCard';
import { useSave } from './useSave';

export default function AadhaarStep({ kyc, onUpdate, refresh }) {
  const a = kyc.aadhaar;
  const dlAvailable = !!kyc.policy?.digilockerEnabled && kyc.editable;
  // With DigiLocker available, manual entry is the secondary option.
  const [editing, setEditing] = useState(!a && !dlAvailable);
  const [form, setForm] = useState({ aadhaarNumber: '', nameOnAadhaar: a?.nameOnAadhaar || kyc.personal.fullName || '', dobOnAadhaar: a?.dobOnAadhaar || kyc.personal.dateOfBirth || '' });
  const [consent, setConsent] = useState(false);
  const [errors, setErrors] = useState({});
  const { saving, serverError, run } = useSave(onUpdate);
  const doc = kyc.documents.find((d) => d.category === 'AADHAAR');
  const docRequired = kyc.requiredDocuments.some((d) => d.category === 'AADHAAR');
  const personalDone = kyc.personal.fullName && kyc.personal.dateOfBirth;

  async function submit(e) {
    e.preventDefault();
    const errs = {};
    if (!isAadhaar(form.aadhaarNumber)) errs.aadhaarNumber = 'Enter a valid 12-digit Aadhaar number.';
    if (!isName(form.nameOnAadhaar)) errs.nameOnAadhaar = 'Enter the name exactly as on your Aadhaar.';
    if (!consent) errs.consent = 'Your consent is required to continue.';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    const next = await run(
      () =>
        api('/technician/kyc/aadhaar', {
          method: 'POST',
          body: { aadhaarNumber: digitsOnly(form.aadhaarNumber), nameOnAadhaar: form.nameOnAadhaar, dobOnAadhaar: form.dobOnAadhaar || undefined, consent: true },
        }),
      null,
    );
    if (next) {
      setForm((f) => ({ ...f, aadhaarNumber: '' }));
      setConsent(false);
      setEditing(false);
      if (next.redirectUrl) window.location.href = next.redirectUrl;
    }
  }

  const requestManual = () => run(() => api('/technician/kyc/aadhaar/manual-review', { method: 'POST' }), 'Sent for manual review');

  if (!personalDone) return <Alert tone="info">Please complete your personal information first. We match your Aadhaar details against it.</Alert>;

  return (
    <div className="space-y-5">
      {a?.verificationStatus !== 'VERIFIED' && <DigilockerCard kyc={kyc} focus="aadhaar" />}

      {!a && !editing && kyc.editable && (
        <div className="text-center">
          <button type="button" className="text-sm font-semibold text-ink-600 underline-offset-2 hover:text-ink-900 hover:underline" onClick={() => setEditing(true)}>
            Or enter your Aadhaar details manually instead
          </button>
        </div>
      )}

      {(editing || !dlAvailable) && (
        <Alert tone="info" title="Your Aadhaar is protected">
          We never ask for your Aadhaar OTP. Your number is masked everywhere and is not stored in full. Tip: you can upload a <em>masked Aadhaar</em> (only last 4 digits visible), downloadable from the UIDAI website.
        </Alert>
      )}

      {a && !editing && (
        <div className="rounded-xl border border-ink-200 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="font-mono text-lg font-semibold tracking-wider text-ink-900">{a.maskedNumber}</p>
              <p className="text-sm text-ink-600">{a.nameOnAadhaar}</p>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {a.verificationMethod === 'DIGILOCKER' && <span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-semibold text-blue-700 ring-1 ring-inset ring-blue-200">via DigiLocker</span>}
              <StatusBadge status={a.verificationStatus} />
            </div>
          </div>
          <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm text-ink-600 sm:grid-cols-2">
            {a.referenceId && (
              <div>
                <dt className="inline text-ink-400">Reference: </dt>
                <dd className="inline font-mono">{a.referenceId}</dd>
              </div>
            )}
            {a.verifiedAt && (
              <div>
                <dt className="inline text-ink-400">Verified: </dt>
                <dd className="inline">{formatDate(a.verifiedAt)}</dd>
              </div>
            )}
            <div>
              <dt className="inline text-ink-400">Consent given: </dt>
              <dd className="inline">{formatDate(a.consentAt)}</dd>
            </div>
          </dl>
          {a.verificationStatus === 'MANUAL_REVIEW' && <p className="mt-3 text-sm text-ink-600">Our team will verify your Aadhaar using the document you upload below.</p>}
          {a.failureReason && a.verificationStatus === 'FAILED' && (
            <Alert tone="error" className="mt-3" title="Verification failed">
              {a.failureReason} Correct your details, or upload your Aadhaar card and request a manual review.
            </Alert>
          )}
          {kyc.editable && (
            <div className="mt-4 flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
                Update Aadhaar details
              </Button>
              {a.verificationStatus === 'FAILED' && (
                <Button size="sm" onClick={requestManual} loading={saving} disabled={!doc?.currentVersion}>
                  Request manual review
                </Button>
              )}
            </div>
          )}
        </div>
      )}

      {editing && kyc.editable && (
        <form onSubmit={submit} noValidate className="space-y-5">
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Aadhaar number" required error={errors.aadhaarNumber} className="sm:col-span-2">
              {(f) => (
                <input
                  {...f}
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="XXXX XXXX XXXX"
                  value={form.aadhaarNumber}
                  onChange={(e) => setForm({ ...form, aadhaarNumber: formatAadhaarInput(e.target.value) })}
                  className={`${f.className} font-mono tracking-wider`}
                />
              )}
            </Field>
            <Field label="Name as on Aadhaar" required error={errors.nameOnAadhaar}>
              {(f) => <input {...f} value={form.nameOnAadhaar} onChange={(e) => setForm({ ...form, nameOnAadhaar: e.target.value })} />}
            </Field>
            <Field label="Date of birth as on Aadhaar">
              {(f) => <input {...f} type="date" value={form.dobOnAadhaar} onChange={(e) => setForm({ ...form, dobOnAadhaar: e.target.value })} />}
            </Field>
          </div>
          <div className={`rounded-xl border p-4 ${errors.consent ? 'border-red-300 bg-red-50/50' : 'border-ink-200 bg-ink-50'}`}>
            <label className="flex gap-3 text-sm text-ink-700">
              <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-brand-600" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
              <span>
                I voluntarily consent to ToolkitGo using my Aadhaar details to verify my identity and address for technician onboarding, through an authorised verification
                partner or manual review by authorised staff. My Aadhaar number will be masked and will not be shared or used for any other purpose. (Consent version{' '}
                {kyc.policy.aadhaarConsentVersion})
              </span>
            </label>
            {errors.consent && (
              <p className="mt-2 text-sm text-red-600" role="alert">
                {errors.consent}
              </p>
            )}
          </div>
          {serverError && <Alert tone="error">{serverError}</Alert>}
          <div className="flex justify-end gap-2">
            {a && (
              <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            )}
            <Button type="submit" loading={saving}>
              Verify Aadhaar
            </Button>
          </div>
        </form>
      )}
      {!editing && serverError && <Alert tone="error">{serverError}</Alert>}

      {(docRequired || doc) && (
        <div>
          <p className="label">Aadhaar card copy {docRequired && <span className="text-red-500">*</span>}</p>
          <DocumentSlot category="AADHAAR" document={doc} description="Front and back in one PDF, or a masked Aadhaar. Needed for manual verification." editable={kyc.editable} onChanged={refresh} />
        </div>
      )}
    </div>
  );
}
