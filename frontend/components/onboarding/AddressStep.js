'use client';

import { useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { SOURCE_LABEL } from '@/lib/status';
import { INDIAN_STATES, isPin } from '@/lib/validators';
import { Alert, Button, Field, StatusBadge } from '@/components/ui';
import DocumentSlot from './DocumentSlot';
import { useSave } from './useSave';

const FIELDS = [
  ['houseNumber', 'House / Flat number', false],
  ['buildingName', 'Building name', false],
  ['street', 'Street', false],
  ['locality', 'Locality / Area', false],
  ['villageCity', 'Village / City', true],
  ['mandalTaluka', 'Mandal / Taluka', false],
  ['district', 'District', true],
  ['state', 'State', true],
  ['pinCode', 'PIN code', true],
  ['country', 'Country', false],
];
const KEYS = FIELDS.map(([k]) => k);
const empty = () => Object.fromEntries(KEYS.map((k) => [k, k === 'country' ? 'India' : '']));
const fromServer = (a) => (a ? Object.fromEntries(KEYS.map((k) => [k, a[k] ?? (k === 'country' ? 'India' : '')])) : empty());

function validateAddress(a) {
  const e = {};
  for (const [k, label, req] of FIELDS) if (req && !String(a[k] || '').trim()) e[k] = `${label} is required.`;
  if (a.pinCode && !isPin(a.pinCode)) e.pinCode = 'PIN code must be 6 digits.';
  return e;
}

function AddressFields({ value, onChange, errors = {}, disabled, idPrefix }) {
  const set = (k) => (e) => onChange({ ...value, [k]: k === 'pinCode' ? e.target.value.replace(/\D/g, '').slice(0, 6) : e.target.value });
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {FIELDS.map(([k, label, req]) => (
        <Field key={`${idPrefix}-${k}`} label={label} required={req} error={errors[k]}>
          {(f) =>
            k === 'state' ? (
              <select {...f} value={value[k]} onChange={set(k)} disabled={disabled}>
                <option value="">Select state…</option>
                {INDIAN_STATES.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            ) : (
              <input {...f} value={value[k]} onChange={set(k)} disabled={disabled || k === 'country'} inputMode={k === 'pinCode' ? 'numeric' : undefined} />
            )
          }
        </Field>
      ))}
    </div>
  );
}

export default function AddressStep({ kyc, onUpdate, refresh }) {
  const ro = !kyc.editable;
  const aadhaarLocked = kyc.aadhaarAddress?.source === 'VERIFICATION_PROVIDER' && kyc.aadhaarAddress?.verificationStatus === 'VERIFIED';
  const [aadhaar, setAadhaar] = useState(fromServer(kyc.aadhaarAddress));
  const [same, setSame] = useState(kyc.addressesSame);
  const independentSaved = kyc.currentAddress && kyc.currentAddress.source !== 'COPIED_FROM_AADHAAR' ? kyc.currentAddress : null;
  const [current, setCurrent] = useState(fromServer(independentSaved));
  const [landmark, setLandmark] = useState(kyc.currentAddress?.landmark || '');
  const [errors, setErrors] = useState({ aadhaar: {}, current: {} });
  const { saving, serverError, run } = useSave(onUpdate);

  // While "same address" is ticked, the current address mirrors the Aadhaar address live.
  const shownCurrent = useMemo(() => (same ? aadhaar : current), [same, aadhaar, current]);
  const addressProofDoc = kyc.documents.find((d) => d.category === 'ADDRESS_PROOF');
  const proofNeeded = kyc.requiredDocuments.some((d) => d.category === 'ADDRESS_PROOF');

  function toggleSame(checked) {
    setSame(checked);
    // Unticking never assumes the addresses match: start from the saved independent address (or blank).
    if (!checked) setCurrent(fromServer(independentSaved));
  }

  async function save(e) {
    e.preventDefault();
    const errA = aadhaarLocked ? {} : validateAddress(aadhaar);
    const errC = same ? {} : validateAddress(current);
    setErrors({ aadhaar: errA, current: errC });
    if (Object.keys(errA).length || Object.keys(errC).length) return;
    const body = {
      addressesSame: same,
      ...(aadhaarLocked ? {} : { aadhaarAddress: aadhaar }),
      ...(same ? { landmark: landmark || undefined } : { currentAddress: { ...current, landmark: landmark || undefined } }),
    };
    await run(() => api('/technician/kyc/addresses', { method: 'PUT', body }), 'Addresses saved');
  }

  return (
    <form onSubmit={save} noValidate className="space-y-6">
      <fieldset className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <legend className="text-base font-semibold text-ink-900">A. Aadhaar address</legend>
          {kyc.aadhaarAddress && (
            <div className="flex items-center gap-2 text-xs text-ink-500">
              {SOURCE_LABEL[kyc.aadhaarAddress.source]} <StatusBadge status={kyc.aadhaarAddress.verificationStatus} />
            </div>
          )}
        </div>
        {aadhaarLocked ? (
          <Alert tone="success">This address was filled from your Aadhaar verification and cannot be edited.</Alert>
        ) : (
          <p className="text-sm text-ink-500">Enter the address exactly as printed on your Aadhaar. It stays marked as unverified until our team checks it.</p>
        )}
        <AddressFields idPrefix="aadhaar" value={aadhaar} onChange={setAadhaar} errors={errors.aadhaar} disabled={ro || aadhaarLocked} />
      </fieldset>

      <fieldset className="space-y-4 border-t border-ink-100 pt-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <legend className="text-base font-semibold text-ink-900">B. Current residential address</legend>
          {kyc.currentAddress && (
            <div className="flex items-center gap-2 text-xs text-ink-500">
              {SOURCE_LABEL[kyc.currentAddress.source]} <StatusBadge status={kyc.currentAddress.verificationStatus} />
            </div>
          )}
        </div>
        <label className="flex items-start gap-3 rounded-xl border border-ink-200 bg-ink-50 p-4 text-sm font-medium text-ink-800">
          <input type="checkbox" className="mt-0.5 h-5 w-5 accent-brand-600" checked={same} onChange={(e) => toggleSame(e.target.checked)} disabled={ro} />
          My current residential address is the same as my Aadhaar address.
        </label>
        <AddressFields idPrefix="current" value={shownCurrent} onChange={setCurrent} errors={errors.current} disabled={ro || same} />
        {same && !ro && <p className="text-xs text-ink-500">Untick the box above to enter a different current address.</p>}
        <Field label="Landmark">
          {(f) => <input {...f} value={landmark} onChange={(e) => setLandmark(e.target.value)} disabled={ro} placeholder="e.g. Opposite bus stand" />}
        </Field>
      </fieldset>

      {(proofNeeded || addressProofDoc) && (
        <div className="space-y-2 border-t border-ink-100 pt-6">
          {kyc.addressProofRequested && <Alert tone="warn">Our team has requested proof of your current address.</Alert>}
          <DocumentSlot
            category="ADDRESS_PROOF"
            document={addressProofDoc}
            description="Utility bill, rental agreement or bank statement showing your current address (issued within the last 3 months)."
            editable={kyc.editable}
            onChanged={refresh}
          />
        </div>
      )}

      {serverError && <Alert tone="error">{serverError}</Alert>}
      {!ro && (
        <div className="flex justify-end">
          <Button type="submit" loading={saving}>
            Save addresses
          </Button>
        </div>
      )}
    </form>
  );
}
