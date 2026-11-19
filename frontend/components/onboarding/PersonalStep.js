'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { ageFrom, isEmail, isMobile, isName } from '@/lib/validators';
import { Alert, Button, Field } from '@/components/ui';
import DocumentSlot from './DocumentSlot';
import { useSave } from './useSave';

export default function PersonalStep({ kyc, onUpdate, refresh, onNext }) {
  const p = kyc.personal;
  const [form, setForm] = useState({
    fullName: p.fullName || '',
    dateOfBirth: p.dateOfBirth || '',
    gender: p.gender || '',
    email: p.email || '',
    emergencyContact: p.emergencyContact || '',
  });
  const [errors, setErrors] = useState({});
  const { saving, serverError, run } = useSave(onUpdate);
  const ro = !kyc.editable;
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const photo = kyc.documents.find((d) => d.category === 'PROFILE_PHOTO');

  function validate() {
    const e = {};
    if (!isName(form.fullName)) e.fullName = 'Enter your full legal name (letters only).';
    const age = ageFrom(form.dateOfBirth);
    if (!form.dateOfBirth || age === null) e.dateOfBirth = 'Enter your date of birth.';
    else if (age < 18) e.dateOfBirth = 'You must be at least 18 years old.';
    if (form.email && !isEmail(form.email)) e.email = 'Enter a valid email address.';
    if (!isMobile(form.emergencyContact)) e.emergencyContact = 'Enter a valid 10-digit mobile number.';
    setErrors(e);
    return !Object.keys(e).length;
  }

  async function save(e) {
    e.preventDefault();
    if (!validate()) return;
    const body = { ...form, gender: form.gender || null, email: form.email.trim() || null };
    const next = await run(() => api('/technician/kyc/personal', { method: 'PUT', body }), 'Personal information saved');
    if (next && photo?.currentVersion) onNext?.();
  }

  return (
    <form onSubmit={save} noValidate className="space-y-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Full legal name" required error={errors.fullName} hint="As printed on your Aadhaar / PAN" className="sm:col-span-2">
          {(f) => <input {...f} autoComplete="name" value={form.fullName} onChange={set('fullName')} disabled={ro} />}
        </Field>
        <Field label="Date of birth" required error={errors.dateOfBirth}>
          {(f) => <input {...f} type="date" max={new Date().toISOString().slice(0, 10)} value={form.dateOfBirth} onChange={set('dateOfBirth')} disabled={ro} />}
        </Field>
        <Field label="Gender" error={errors.gender}>
          {(f) => (
            <select {...f} value={form.gender} onChange={set('gender')} disabled={ro}>
              <option value="">Select…</option>
              <option value="MALE">Male</option>
              <option value="FEMALE">Female</option>
              <option value="OTHER">Other</option>
              <option value="PREFER_NOT_TO_SAY">Prefer not to say</option>
            </select>
          )}
        </Field>
        <Field label="Email address" error={errors.email}>
          {(f) => <input {...f} type="email" autoComplete="email" value={form.email} onChange={set('email')} disabled={ro} />}
        </Field>
        <Field label="Emergency contact number" required error={errors.emergencyContact} hint="A family member or friend we can reach in an emergency">
          {(f) => <input {...f} inputMode="numeric" maxLength={13} value={form.emergencyContact} onChange={set('emergencyContact')} disabled={ro} />}
        </Field>
      </div>

      <div>
        <p className="label">
          Profile photograph <span className="text-red-500">*</span>
        </p>
        <DocumentSlot
          category="PROFILE_PHOTO"
          document={photo}
          description="A clear, recent photo of your face. Customers will see this photo."
          editable={kyc.editable}
          onChanged={refresh}
        />
      </div>

      {serverError && <Alert tone="error">{serverError}</Alert>}
      {!ro && (
        <div className="flex justify-end">
          <Button type="submit" loading={saving}>
            Save & continue
          </Button>
        </div>
      )}
    </form>
  );
}
