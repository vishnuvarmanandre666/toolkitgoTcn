'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/status';
import { isIndividualPan, isName, isPan } from '@/lib/validators';
import { Alert, Button, Field, StatusBadge } from '@/components/ui';
import DocumentSlot from './DocumentSlot';
import DigilockerCard from './DigilockerCard';
import { useSave } from './useSave';

export default function PanStep({ kyc, onUpdate, refresh }) {
  const p = kyc.pan;
  const dlAvailable = !!kyc.policy?.digilockerEnabled && kyc.editable;
  const [editing, setEditing] = useState(!p && !dlAvailable);
  const panDocRequired = kyc.requiredDocuments.some((d) => d.category === 'PAN');
  const [form, setForm] = useState({ pan: '', holderName: p?.holderName || kyc.personal.fullName || '' });
  const [errors, setErrors] = useState({});
  const { saving, serverError, run } = useSave(onUpdate);
  const doc = kyc.documents.find((d) => d.category === 'PAN');

  async function submit(e) {
    e.preventDefault();
    const errs = {};
    if (!isPan(form.pan)) errs.pan = 'Enter a valid PAN, e.g. ABCPE1234F.';
    else if (!isIndividualPan(form.pan)) errs.pan = "Enter your individual PAN (4th character is 'P').";
    if (!isName(form.holderName)) errs.holderName = 'Enter the name exactly as on your PAN card.';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    const next = await run(() => api('/technician/kyc/pan', { method: 'POST', body: { pan: form.pan.toUpperCase(), holderName: form.holderName } }), null);
    if (next) {
      setForm((f) => ({ ...f, pan: '' }));
      setEditing(false);
    }
  }

  if (!kyc.personal.fullName) return <Alert tone="info">Please complete your personal information first.</Alert>;

  return (
    <div className="space-y-5">
      {p?.verificationStatus !== 'VERIFIED' && <DigilockerCard kyc={kyc} focus="pan" />}

      {!p && !editing && kyc.editable && (
        <div className="text-center">
          <button type="button" className="text-sm font-semibold text-ink-600 underline-offset-2 hover:text-ink-900 hover:underline" onClick={() => setEditing(true)}>
            Or enter your PAN details manually instead
          </button>
        </div>
      )}

      {p && !editing && (
        <div className="rounded-xl border border-ink-200 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="font-mono text-lg font-semibold tracking-wider text-ink-900">{p.maskedPan}</p>
              <p className="text-sm text-ink-600">{p.holderName}</p>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {p.verificationMethod === 'DIGILOCKER' && <span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-semibold text-blue-700 ring-1 ring-inset ring-blue-200">via DigiLocker</span>}
              <StatusBadge status={p.verificationStatus} />
            </div>
          </div>
          {p.verifiedAt && <p className="mt-2 text-sm text-ink-500">Verified {formatDate(p.verifiedAt)}</p>}
          {p.verificationStatus === 'MANUAL_REVIEW' && <p className="mt-2 text-sm text-ink-600">Our team will verify your PAN using the card you upload below.</p>}
          {p.verificationStatus === 'FAILED' && (
            <Alert tone="error" className="mt-3" title="Verification failed">
              {p.failureReason} Correct your details, or request a manual review after uploading your PAN card.
            </Alert>
          )}
          {kyc.editable && (
            <div className="mt-4 flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
                Update PAN details
              </Button>
              {p.verificationStatus === 'FAILED' && (
                <Button size="sm" loading={saving} disabled={!doc?.currentVersion} onClick={() => run(() => api('/technician/kyc/pan/manual-review', { method: 'POST' }), 'Sent for manual review')}>
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
            <Field label="PAN number" required error={errors.pan} hint="10 characters, e.g. ABCPE1234F">
              {(f) => (
                <input
                  {...f}
                  autoComplete="off"
                  maxLength={10}
                  value={form.pan}
                  onChange={(e) => setForm({ ...form, pan: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') })}
                  className={`${f.className} font-mono uppercase tracking-wider`}
                />
              )}
            </Field>
            <Field label="Name on PAN card" required error={errors.holderName}>
              {(f) => <input {...f} value={form.holderName} onChange={(e) => setForm({ ...form, holderName: e.target.value })} />}
            </Field>
          </div>
          {serverError && <Alert tone="error">{serverError}</Alert>}
          <div className="flex justify-end gap-2">
            {p && (
              <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            )}
            <Button type="submit" loading={saving}>
              Verify PAN
            </Button>
          </div>
        </form>
      )}
      {!editing && serverError && <Alert tone="error">{serverError}</Alert>}

      {(panDocRequired || doc) && (
      <div>
        <p className="label">
          PAN card copy {panDocRequired && <span className="text-red-500">*</span>}
        </p>
        <DocumentSlot category="PAN" document={doc} description="A clear photo or scan of the front of your PAN card." editable={kyc.editable} onChanged={refresh} />
      </div>
      )}
    </div>
  );
}
