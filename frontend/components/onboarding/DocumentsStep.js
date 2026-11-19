'use client';

import { useState } from 'react';
import { CATEGORY_LABEL } from '@/lib/status';
import { Alert, Button, Field } from '@/components/ui';
import DocumentSlot from './DocumentSlot';

const HINTS = {
  PROFILE_PHOTO: 'A clear, recent photo of your face.',
  AADHAAR: 'Front and back, or a masked Aadhaar.',
  PAN: 'Front of your PAN card.',
  ADDRESS_PROOF: 'Utility bill, rental agreement or bank statement.',
  BANK_PROOF: 'Cancelled cheque or first page of passbook.',
  CERTIFICATE: 'ITI / trade / professional certificate.',
};

/** All required documents in one place, plus optional certificates / other documents. */
export default function DocumentsStep({ kyc, refresh }) {
  const required = kyc.requiredDocuments.map((r) => r.category);
  const multi = kyc.documents.filter((d) => ['CERTIFICATE', 'OTHER'].includes(d.category) && d.currentVersion);
  const [newLabel, setNewLabel] = useState('');
  const [newCategory, setNewCategory] = useState('CERTIFICATE');
  const [adding, setAdding] = useState(false);

  return (
    <div className="space-y-6">
      <section>
        <h3 className="text-sm font-semibold uppercase tracking-wide text-ink-500">Required documents</h3>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {required
            .filter((c) => c !== 'CERTIFICATE')
            .map((c) => (
              <DocumentSlot key={c} category={c} document={kyc.documents.find((d) => d.category === c)} description={HINTS[c]} editable={kyc.editable} onChanged={refresh} />
            ))}
        </div>
        {required.includes('CERTIFICATE') && !multi.some((d) => d.category === 'CERTIFICATE') && (
          <Alert tone="warn" className="mt-3">
            At least one professional certificate is required.
          </Alert>
        )}
      </section>

      <section>
        <h3 className="text-sm font-semibold uppercase tracking-wide text-ink-500">Certificates & other documents</h3>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {multi.map((d) => (
            <DocumentSlot key={d.id} category={d.category} document={d} editable={kyc.editable} onChanged={refresh} allowRemove />
          ))}
        </div>
        {kyc.editable &&
          (adding ? (
            <div className="mt-3 space-y-3 rounded-xl border border-dashed border-ink-300 p-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Type" required>
                  {(f) => (
                    <select {...f} value={newCategory} onChange={(e) => setNewCategory(e.target.value)}>
                      <option value="CERTIFICATE">{CATEGORY_LABEL.CERTIFICATE}</option>
                      <option value="OTHER">{CATEGORY_LABEL.OTHER}</option>
                    </select>
                  )}
                </Field>
                <Field label="Document name" required>
                  {(f) => <input {...f} value={newLabel} maxLength={120} onChange={(e) => setNewLabel(e.target.value)} placeholder="e.g. ITI Electrician certificate" />}
                </Field>
              </div>
              {newLabel.trim().length >= 3 ? (
                <DocumentSlot
                  category={newCategory}
                  label={newLabel.trim()}
                  editable
                  onChanged={async () => {
                    setAdding(false);
                    setNewLabel('');
                    await refresh();
                  }}
                />
              ) : (
                <p className="text-xs text-ink-500">Enter a document name to choose a file.</p>
              )}
              <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>
                Cancel
              </Button>
            </div>
          ) : (
            <Button size="sm" variant="secondary" className="mt-3" onClick={() => setAdding(true)}>
              + Add certificate or document
            </Button>
          ))}
      </section>
    </div>
  );
}
