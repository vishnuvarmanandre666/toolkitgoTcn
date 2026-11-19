'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { isIfsc, isName } from '@/lib/validators';
import { Alert, Button, Field, StatusBadge } from '@/components/ui';
import DocumentSlot from './DocumentSlot';
import { useSave } from './useSave';

export default function BankStep({ kyc, onUpdate, refresh }) {
  const b = kyc.bank;
  const [editing, setEditing] = useState(!b);
  const [form, setForm] = useState({
    accountHolderName: b?.accountHolderName || kyc.personal.fullName || '',
    accountNumber: '',
    confirmAccountNumber: '',
    ifsc: b?.ifsc || '',
    bankName: b?.bankName || '',
    branchName: b?.branchName || '',
  });
  const [errors, setErrors] = useState({});
  const { saving, serverError, run } = useSave(onUpdate);
  const set = (k, fn = (v) => v) => (e) => setForm((f) => ({ ...f, [k]: fn(e.target.value) }));
  const proofDoc = kyc.documents.find((d) => d.category === 'BANK_PROOF');
  const proofRequired = kyc.requiredDocuments.some((d) => d.category === 'BANK_PROOF');

  async function submit(e) {
    e.preventDefault();
    const errs = {};
    if (!isName(form.accountHolderName)) errs.accountHolderName = 'Enter the account holder name.';
    if (!/^\d{9,18}$/.test(form.accountNumber)) errs.accountNumber = 'Account number must be 9 to 18 digits.';
    if (form.confirmAccountNumber !== form.accountNumber) errs.confirmAccountNumber = 'Account numbers do not match.';
    if (!isIfsc(form.ifsc)) errs.ifsc = 'IFSC must be 11 characters, e.g. SBIN0001234.';
    if (form.bankName.trim().length < 2) errs.bankName = 'Enter the bank name.';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    const next = await run(() => api('/technician/kyc/bank', { method: 'PUT', body: { ...form, branchName: form.branchName || undefined } }), 'Bank details saved');
    if (next) {
      setForm((f) => ({ ...f, accountNumber: '', confirmAccountNumber: '' }));
      setEditing(false);
    }
  }

  return (
    <div className="space-y-5">
      {!kyc.policy.requireBankDetails && <Alert tone="info">Bank details are optional for now, but needed to receive payouts.</Alert>}

      {b && !editing && (
        <div className="rounded-xl border border-ink-200 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="font-mono text-lg font-semibold tracking-wider text-ink-900">{b.maskedAccountNumber}</p>
              <p className="text-sm text-ink-600">
                {b.accountHolderName} · {b.bankName} · {b.ifsc}
                {b.branchName ? ` · ${b.branchName}` : ''}
              </p>
            </div>
            <StatusBadge status={b.verificationStatus} />
          </div>
          {kyc.editable && (
            <Button size="sm" variant="secondary" className="mt-4" onClick={() => setEditing(true)}>
              Change bank account
            </Button>
          )}
        </div>
      )}

      {editing && kyc.editable && (
        <form onSubmit={submit} noValidate className="space-y-5">
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Account holder name" required error={errors.accountHolderName} className="sm:col-span-2">
              {(f) => <input {...f} value={form.accountHolderName} onChange={set('accountHolderName')} />}
            </Field>
            <Field label="Account number" required error={errors.accountNumber}>
              {(f) => <input {...f} inputMode="numeric" autoComplete="off" value={form.accountNumber} onChange={set('accountNumber', (v) => v.replace(/\D/g, '').slice(0, 18))} />}
            </Field>
            <Field label="Confirm account number" required error={errors.confirmAccountNumber}>
              {(f) => (
                <input
                  {...f}
                  inputMode="numeric"
                  autoComplete="off"
                  onPaste={(e) => e.preventDefault()}
                  value={form.confirmAccountNumber}
                  onChange={set('confirmAccountNumber', (v) => v.replace(/\D/g, '').slice(0, 18))}
                />
              )}
            </Field>
            <Field label="IFSC code" required error={errors.ifsc} hint="Printed on your cheque book / passbook">
              {(f) => <input {...f} maxLength={11} value={form.ifsc} onChange={set('ifsc', (v) => v.toUpperCase().replace(/[^A-Z0-9]/g, ''))} className={`${f.className} font-mono uppercase`} />}
            </Field>
            <Field label="Bank name" required error={errors.bankName}>
              {(f) => <input {...f} value={form.bankName} onChange={set('bankName')} />}
            </Field>
            <Field label="Branch name">{(f) => <input {...f} value={form.branchName} onChange={set('branchName')} />}</Field>
          </div>
          {serverError && <Alert tone="error">{serverError}</Alert>}
          <div className="flex justify-end gap-2">
            {b && (
              <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            )}
            <Button type="submit" loading={saving}>
              Save bank details
            </Button>
          </div>
        </form>
      )}

      {(proofRequired || proofDoc || b) && (
        <div>
          <p className="label">Cancelled cheque or passbook {proofRequired ? <span className="text-red-500">*</span> : <span className="font-normal text-ink-400">(optional)</span>}</p>
          <DocumentSlot category="BANK_PROOF" document={proofDoc} description="Must show the account holder name, account number and IFSC." editable={kyc.editable} onChanged={refresh} />
        </div>
      )}
    </div>
  );
}
