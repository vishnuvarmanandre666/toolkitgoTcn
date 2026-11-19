'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { formatBytes, formatDate, SOURCE_LABEL } from '@/lib/status';
import { Alert, Button, cx, Spinner, StatusBadge } from '@/components/ui';

export function Modal({ title, onClose, children, wide }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink-900/60 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={title} onClick={onClose}>
      <div className={cx('max-h-[92vh] w-full overflow-auto rounded-t-2xl bg-white shadow-xl sm:rounded-2xl', wide ? 'max-w-4xl' : 'max-w-lg')} onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 flex items-center justify-between border-b border-ink-100 bg-white px-5 py-4">
          <h2 className="font-semibold text-ink-900">{title}</h2>
          <button type="button" onClick={onClose} className="rounded p-1 text-ink-500 hover:bg-ink-100" aria-label="Close">
            ✕
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export function Row({ label, children }) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-2 py-1.5 text-sm">
      <dt className="text-ink-500">{label}</dt>
      <dd className="min-w-0 break-words text-ink-900">{children ?? '—'}</dd>
    </div>
  );
}

/** Status selector + mandatory review note for a single verification section. */
export function VerificationControl({ section, status, options, disabled, onSave, hint }) {
  const [value, setValue] = useState(status || '');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => setValue(status || ''), [status]);

  async function save() {
    setSaving(true);
    setError('');
    try {
      await onSave(section, value, note);
      setNote('');
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  if (disabled) return null;
  return (
    <div className="mt-4 rounded-xl border border-ink-200 bg-ink-50 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">Reviewer decision</p>
      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
        <label className="sr-only" htmlFor={`${section}-status`}>
          Status
        </label>
        <select id={`${section}-status`} className="input sm:w-48" value={value} onChange={(e) => setValue(e.target.value)}>
          {options.map((o) => (
            <option key={o} value={o}>
              {o.replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase())}
            </option>
          ))}
        </select>
        <label className="sr-only" htmlFor={`${section}-note`}>
          Review note
        </label>
        <input id={`${section}-note`} className="input flex-1" placeholder="Review note (required to verify manually or reject)" value={note} onChange={(e) => setNote(e.target.value)} />
        <Button size="sm" onClick={save} loading={saving} disabled={value === status && !note}>
          Save
        </Button>
      </div>
      {hint && <p className="mt-2 text-xs text-ink-500">{hint}</p>}
      {error && (
        <p className="mt-2 text-sm text-red-600" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function AddressBlock({ title, address, extra }) {
  if (!address) return <p className="text-sm text-ink-500">{title}: not provided.</p>;
  const lines = [
    [address.houseNumber, address.buildingName].filter(Boolean).join(', '),
    [address.street, address.locality].filter(Boolean).join(', '),
    [address.villageCity, address.mandalTaluka].filter(Boolean).join(', '),
    `${address.district}, ${address.state} — ${address.pinCode}`,
    address.country,
  ].filter(Boolean);
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-semibold text-ink-900">{title}</p>
        <StatusBadge status={address.verificationStatus} />
      </div>
      <address className="mt-2 text-sm not-italic leading-relaxed text-ink-700">
        {lines.map((l) => (
          <span key={l} className="block">
            {l}
          </span>
        ))}
        {address.landmark && <span className="block text-ink-500">Landmark: {address.landmark}</span>}
      </address>
      <p className="mt-2 text-xs text-ink-500">Source: {SOURCE_LABEL[address.source] || address.source}</p>
      {address.reviewNote && <p className="mt-1 text-xs text-ink-500">Note: {address.reviewNote}</p>}
      {extra}
    </div>
  );
}

/** Loads a signed URL and previews an image / PDF; never caches the URL. */
export function DocumentPreview({ documentId, versionId, mimeType }) {
  const [state, setState] = useState({ loading: true });
  useEffect(() => {
    let alive = true;
    const qs = versionId ? `?versionId=${versionId}` : '';
    api(`/admin/documents/${documentId}/url${qs}`)
      .then((r) => alive && setState({ url: r.url, expiresAt: r.expiresAt }))
      .catch((e) => alive && setState({ error: e.message }));
    return () => {
      alive = false;
    };
  }, [documentId, versionId]);

  if (state.loading) return <div className="flex h-64 items-center justify-center text-ink-500"><Spinner className="h-5 w-5" /></div>;
  if (state.error) return <Alert tone="error">{state.error}</Alert>;
  return (
    <div className="space-y-2">
      {mimeType === 'application/pdf' ? (
        <object data={state.url} type="application/pdf" className="h-[65vh] w-full rounded-lg border border-ink-200" aria-label="PDF preview">
          <p className="p-4 text-sm">PDF preview unavailable in this browser.</p>
        </object>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={state.url} alt="Document preview" className="mx-auto max-h-[65vh] rounded-lg border border-ink-200 object-contain" />
      )}
      <div className="flex items-center justify-between text-xs text-ink-500">
        <span>Secure link expires {formatDate(state.expiresAt)}</span>
        <a href={state.url} target="_blank" rel="noopener noreferrer" className="font-semibold text-brand-700 hover:underline">
          Open in new tab
        </a>
      </div>
    </div>
  );
}

export function DocumentReviewCard({ doc, canReview, onReview }) {
  const [preview, setPreview] = useState(null);
  const [versions, setVersions] = useState(null);
  const [decision, setDecision] = useState(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const v = doc.currentVersion;

  async function submit(status) {
    if (status !== 'VERIFIED' && reason.trim().length < 3) return setError('Please give the technician a clear reason.');
    setBusy(true);
    setError('');
    try {
      await onReview(doc.id, status, reason.trim() || undefined);
      setDecision(null);
      setReason('');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function loadVersions() {
    try {
      setVersions(await api(`/admin/documents/${doc.id}/versions`));
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div className="rounded-xl border border-ink-200 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-medium text-ink-900">
            {doc.categoryLabel}
            {doc.label && <span className="text-ink-500"> — {doc.label}</span>}
          </p>
          {v && (
            <p className="mt-0.5 text-xs text-ink-500">
              v{v.version} · {v.mimeType.split('/')[1].toUpperCase()} · {formatBytes(v.sizeBytes)} · {formatDate(v.uploadedAt)}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-1">
          <StatusBadge status={v ? doc.status : 'NOT_UPLOADED'} />
          {v && <StatusBadge status={v.scanStatus} />}
        </div>
      </div>
      {doc.rejectionReason && <p className="mt-2 text-sm text-amber-800">Reason: {doc.rejectionReason}</p>}
      {error && (
        <p className="mt-2 text-sm text-red-600" role="alert">
          {error}
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {v && (
          <Button size="sm" variant="secondary" onClick={() => setPreview({ versionId: v.id, mimeType: v.mimeType })}>
            Preview
          </Button>
        )}
        {v && v.version > 1 && (
          <Button size="sm" variant="ghost" onClick={loadVersions}>
            History ({v.version})
          </Button>
        )}
        {canReview && v && doc.status !== 'VERIFIED' && (
          <Button size="sm" variant="success" loading={busy && !decision} onClick={() => submit('VERIFIED')}>
            Verify
          </Button>
        )}
        {canReview && v && (
          <>
            <Button size="sm" variant="ghost" className="text-amber-700" onClick={() => setDecision('REUPLOAD_REQUIRED')}>
              Ask re-upload
            </Button>
            <Button size="sm" variant="ghost" className="text-red-600" onClick={() => setDecision('REJECTED')}>
              Reject
            </Button>
          </>
        )}
      </div>

      {decision && (
        <div className="mt-3 space-y-2 rounded-lg bg-ink-50 p-3">
          <label htmlFor={`reason-${doc.id}`} className="label">
            {decision === 'REJECTED' ? 'Rejection reason' : 'What should the technician fix?'} (shown to technician)
          </label>
          <textarea id={`reason-${doc.id}`} rows={2} className="input" value={reason} onChange={(e) => setReason(e.target.value)} />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setDecision(null)}>
              Cancel
            </Button>
            <Button size="sm" variant={decision === 'REJECTED' ? 'danger' : 'primary'} loading={busy} onClick={() => submit(decision)}>
              Confirm
            </Button>
          </div>
        </div>
      )}

      {versions && (
        <ul className="mt-3 divide-y divide-ink-100 rounded-lg border border-ink-100 text-xs">
          {versions.map((ver) => (
            <li key={ver.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <span>
                v{ver.version} · {ver.originalName} · {formatDate(ver.uploadedAt)}
                {ver.isCurrent && <span className="ml-1 font-semibold text-emerald-700">(current)</span>}
              </span>
              <span className="flex items-center gap-2">
                <StatusBadge status={ver.status} />
                {ver.purged ? (
                  <span className="text-ink-400">Purged</span>
                ) : (
                  <button type="button" className="font-semibold text-brand-700 hover:underline" onClick={() => setPreview({ versionId: ver.id, mimeType: ver.mimeType })}>
                    View
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      {preview && (
        <Modal title={`${doc.categoryLabel} preview`} onClose={() => setPreview(null)} wide>
          <DocumentPreview documentId={doc.id} versionId={preview.versionId} mimeType={preview.mimeType} />
        </Modal>
      )}
    </div>
  );
}
