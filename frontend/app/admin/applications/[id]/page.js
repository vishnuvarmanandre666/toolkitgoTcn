'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { formatDate, SECTION_LABEL } from '@/lib/status';
import AdminShell, { canDecide, useAdmin } from '@/components/admin/AdminShell';
import { AddressBlock, DocumentReviewCard, Modal, Row, VerificationControl } from '@/components/admin/ReviewWidgets';
import { Alert, Button, Card, PageLoader, StatusBadge, useToast } from '@/components/ui';

const IDENTITY_OPTIONS = ['MANUAL_REVIEW', 'VERIFIED', 'FAILED'];
const AADHAAR_ADDRESS_OPTIONS = ['PENDING', 'VERIFIED', 'UNVERIFIED', 'REJECTED', 'UNAVAILABLE'];
const CURRENT_ADDRESS_OPTIONS = ['SELF_DECLARED', 'DOCUMENT_SUPPORTED', 'MANUALLY_VERIFIED', 'REJECTED'];
const SECTIONS = ['PERSONAL', 'AADHAAR', 'PAN', 'ADDRESS', 'DOCUMENTS', 'BANK', 'GENERAL'];

function RequestActionModal({ app, onClose, onDone }) {
  const [items, setItems] = useState([{ section: app.addressesDiffer ? 'ADDRESS' : 'DOCUMENTS', message: '' }]);
  const [requestAddressProof, setRequestAddressProof] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const update = (i, patch) => setItems((xs) => xs.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  async function submit() {
    const clean = items.filter((i) => i.message.trim().length >= 3).map((i) => ({ ...i, message: i.message.trim(), documentId: i.documentId || undefined }));
    if (!clean.length) return setError('Add at least one instruction for the technician.');
    setBusy(true);
    try {
      await onDone({ items: clean, requestAddressProof });
      onClose();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  return (
    <Modal title="Request changes from technician" onClose={onClose}>
      <div className="space-y-4">
        {items.map((it, i) => (
          <div key={i} className="space-y-2 rounded-lg border border-ink-200 p-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <select className="input" aria-label="Section" value={it.section} onChange={(e) => update(i, { section: e.target.value })}>
                {SECTIONS.map((s) => (
                  <option key={s} value={s}>
                    {SECTION_LABEL[s]}
                  </option>
                ))}
              </select>
              <select className="input" aria-label="Document to re-upload" value={it.documentId || ''} onChange={(e) => update(i, { documentId: e.target.value })}>
                <option value="">No specific document</option>
                {app.documents
                  .filter((d) => d.currentVersion)
                  .map((d) => (
                    <option key={d.id} value={d.id}>
                      Re-upload: {d.categoryLabel}
                      {d.label ? ` (${d.label})` : ''}
                    </option>
                  ))}
              </select>
            </div>
            <textarea className="input" rows={2} placeholder="What should the technician do?" aria-label="Instruction" value={it.message} onChange={(e) => update(i, { message: e.target.value })} />
          </div>
        ))}
        <Button size="sm" variant="ghost" onClick={() => setItems((xs) => [...xs, { section: 'GENERAL', message: '' }])}>
          + Add another item
        </Button>
        <label className="flex items-start gap-3 text-sm text-ink-700">
          <input type="checkbox" className="mt-0.5 h-4 w-4 accent-brand-600" checked={requestAddressProof} onChange={(e) => setRequestAddressProof(e.target.checked)} />
          Require proof of current residential address{app.addressesDiffer ? ' (addresses differ)' : ''}
        </label>
        {error && <Alert tone="error">{error}</Alert>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy}>
            Send to technician
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function ReasonModal({ title, label, confirmLabel, variant = 'danger', onClose, onConfirm, minLength = 3 }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <Modal title={title} onClose={onClose}>
      <label htmlFor="reason" className="label">
        {label}
      </label>
      <textarea id="reason" rows={3} className="input" value={reason} onChange={(e) => setReason(e.target.value)} />
      {error && <Alert tone="error" className="mt-3">{error}</Alert>}
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant={variant}
          loading={busy}
          disabled={reason.trim().length < minLength}
          onClick={async () => {
            setBusy(true);
            try {
              await onConfirm(reason.trim());
              onClose();
            } catch (e) {
              setError(e.message);
              setBusy(false);
            }
          }}
        >
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}

function ApplicationDetail() {
  const { id } = useParams();
  const admin = useAdmin();
  const toast = useToast();
  const [app, setApp] = useState(null);
  const [error, setError] = useState('');
  const [modal, setModal] = useState(null);
  const [audit, setAudit] = useState(null);
  const [revealed, setRevealed] = useState({});
  const [busy, setBusy] = useState('');

  const load = useCallback(() => api(`/admin/applications/${id}`).then(setApp).catch((e) => setError(e.message)), [id]);
  useEffect(() => {
    load();
  }, [load]);

  async function act(label, fn, success) {
    setBusy(label);
    try {
      const next = await fn();
      if (next?.id) setApp(next);
      if (success) toast.push(success);
      setAudit(null);
      return next;
    } catch (e) {
      const blockers = e.details?.blockers;
      toast.push(blockers?.length ? `${e.message} ${blockers.join(' · ')}` : e.message, 'error');
      throw e;
    } finally {
      setBusy('');
    }
  }

  const post = (path, body) => api(`/admin/applications/${id}${path}`, { method: 'POST', body: body ?? {} });
  const setVerification = (section, status, note) =>
    act('verify', () => api(`/admin/applications/${id}/verifications/${section}`, { method: 'PATCH', body: { status, note: note || undefined } }), 'Verification updated');
  const reviewDoc = (docId, status, reason) => act('doc', () => api(`/admin/documents/${docId}/review`, { method: 'PATCH', body: { status, reason } }), `Document marked ${status.toLowerCase().replace('_', ' ')}`);

  if (error) return <Alert tone="error" title="Could not load application">{error}</Alert>;
  if (!app) return <PageLoader />;

  const reviewable = ['SUBMITTED', 'UNDER_REVIEW'].includes(app.kycStatus);
  const decider = canDecide(admin);
  const p = app.personal;

  return (
    <div className="space-y-6">
      <Link href="/admin" className="text-sm font-medium text-ink-500 hover:text-ink-800">
        ← All applications
      </Link>

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold text-ink-900">{p.fullName || 'Unnamed technician'}</h1>
            <StatusBadge status={app.kycStatus} />
            {app.isActive && <span className="rounded-full bg-emerald-600 px-2.5 py-0.5 text-xs font-semibold text-white">Active</span>}
          </div>
          <p className="mt-1 text-sm text-ink-500">
            +91 {app.phone} · Submitted {formatDate(app.submittedAt)} · Submission #{app.submissionCount}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {app.kycStatus === 'SUBMITTED' && (
            <Button loading={busy === 'start'} onClick={() => act('start', () => post('/start-review'), 'Review started')}>
              Start review
            </Button>
          )}
          {['SUBMITTED', 'UNDER_REVIEW', 'APPROVED'].includes(app.kycStatus) && (
            <Button variant="secondary" onClick={() => setModal('action')}>
              Request changes
            </Button>
          )}
          {decider && app.kycStatus === 'UNDER_REVIEW' && (
            <Button variant="success" loading={busy === 'approve'} disabled={app.approvalBlockers.length > 0} onClick={() => act('approve', () => post('/approve'), 'Application approved')}>
              Approve KYC
            </Button>
          )}
          {decider && reviewable && (
            <Button variant="danger" onClick={() => setModal('reject')}>
              Reject
            </Button>
          )}
          {decider && app.kycStatus === 'APPROVED' && !app.isActive && (
            <Button variant="success" loading={busy === 'activate'} onClick={() => act('activate', () => post('/activate'), 'Technician activated')}>
              Activate technician
            </Button>
          )}
          {decider && app.isActive && (
            <Button variant="secondary" onClick={() => setModal('deactivate')}>
              Deactivate
            </Button>
          )}
        </div>
      </div>

      {app.kycStatus === 'UNDER_REVIEW' && app.approvalBlockers.length > 0 && (
        <Alert tone="warn" title="Before this application can be approved">
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {app.approvalBlockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </Alert>
      )}
      {app.kycStatus === 'UNDER_REVIEW' && app.approvalBlockers.length === 0 && <Alert tone="success">All checks are complete. {decider ? 'You can approve this application.' : 'An admin can now approve it.'}</Alert>}
      {app.kycStatus === 'SUBMITTED' && <Alert tone="info">Start the review (or review any item) to move this application to Under review.</Alert>}
      {app.rejectionReason && <Alert tone="error" title="Rejection reason">{app.rejectionReason}</Alert>}

      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="Personal information">
          <dl>
            <Row label="Full name">{p.fullName}</Row>
            <Row label="Date of birth">{p.dateOfBirth}</Row>
            <Row label="Gender">{p.gender?.replace(/_/g, ' ').toLowerCase()}</Row>
            <Row label="Email">{p.email}</Row>
            <Row label="Emergency contact">{p.emergencyContact}</Row>
            <Row label="Mobile">
              +91 {app.phone} <StatusBadge status={app.verifications.mobile} className="ml-1" />
            </Row>
          </dl>
        </Card>

        <Card title="Aadhaar" actions={<StatusBadge status={app.verifications.aadhaar} />}>
          {app.aadhaar ? (
            <>
              <dl>
                <Row label="Aadhaar">
                  <span className="font-mono">{app.aadhaar.maskedNumber}</span>
                </Row>
                <Row label="Name on Aadhaar">{app.aadhaar.nameOnAadhaar}</Row>
                <Row label="DOB on Aadhaar">{app.aadhaar.dobOnAadhaar}</Row>
                <Row label="Method">{app.aadhaar.verificationMethod}</Row>
                <Row label="Provider / ref">
                  {app.aadhaarReview?.providerName} {app.aadhaar.referenceId && <span className="font-mono">· {app.aadhaar.referenceId}</span>}
                </Row>
                <Row label="Name match">
                  {app.aadhaarReview?.nameMatchScore != null ? `${Math.round(app.aadhaarReview.nameMatchScore * 100)}%` : '—'}
                  {app.aadhaar.nameMatched === false && <span className="ml-2 font-semibold text-red-600">Mismatch</span>}
                </Row>
                <Row label="DOB match">{app.aadhaar.dobMatched == null ? '—' : app.aadhaar.dobMatched ? 'Yes' : 'No'}</Row>
                <Row label="Consent">
                  {formatDate(app.aadhaar.consentAt)} (v{app.aadhaarReview?.consentVersion})
                </Row>
                {app.aadhaar.failureReason && <Row label="Note">{app.aadhaar.failureReason}</Row>}
                {app.aadhaarReview?.reviewNote && <Row label="Reviewer note">{app.aadhaarReview.reviewNote}</Row>}
              </dl>
              <VerificationControl
                section="aadhaar"
                status={app.aadhaar.verificationStatus}
                options={IDENTITY_OPTIONS}
                disabled={!reviewable}
                onSave={setVerification}
                hint="Manual verification requires the Aadhaar document to be verified first and a note describing what was checked."
              />
            </>
          ) : (
            <p className="text-sm text-ink-500">Not submitted.</p>
          )}
        </Card>

        <Card title="PAN" actions={<StatusBadge status={app.verifications.pan} />}>
          {app.pan ? (
            <>
              <dl>
                <Row label="PAN">
                  <span className="font-mono">{revealed.pan || app.pan.maskedPan}</span>
                  {decider && !revealed.pan && (
                    <button type="button" className="ml-2 text-xs font-semibold text-brand-700 hover:underline" onClick={() => setModal('reveal-pan')}>
                      Reveal
                    </button>
                  )}
                </Row>
                <Row label="Name on PAN">{app.pan.holderName}</Row>
                <Row label="Method">{app.pan.verificationMethod}</Row>
                <Row label="Provider / ref">
                  {app.panReview?.providerName} {app.pan.referenceId && <span className="font-mono">· {app.pan.referenceId}</span>}
                </Row>
                <Row label="Name match">
                  {app.panReview?.nameMatchScore != null ? `${Math.round(app.panReview.nameMatchScore * 100)}%` : '—'}
                  {app.pan.nameMatched === false && <span className="ml-2 font-semibold text-red-600">Mismatch</span>}
                </Row>
                {app.pan.failureReason && <Row label="Note">{app.pan.failureReason}</Row>}
                {app.panReview?.reviewNote && <Row label="Reviewer note">{app.panReview.reviewNote}</Row>}
              </dl>
              <VerificationControl section="pan" status={app.pan.verificationStatus} options={IDENTITY_OPTIONS} disabled={!reviewable} onSave={setVerification} hint="Manual verification requires the PAN document to be verified first." />
            </>
          ) : (
            <p className="text-sm text-ink-500">Not submitted.</p>
          )}
        </Card>

        <Card title="Bank details" actions={app.bank ? <StatusBadge status={app.bank.verificationStatus} /> : null}>
          {app.bank ? (
            <>
              <dl>
                <Row label="Account">
                  <span className="font-mono">{revealed.bankAccount || app.bank.maskedAccountNumber}</span>
                  {decider && !revealed.bankAccount && (
                    <button type="button" className="ml-2 text-xs font-semibold text-brand-700 hover:underline" onClick={() => setModal('reveal-bankAccount')}>
                      Reveal
                    </button>
                  )}
                </Row>
                <Row label="Holder">{app.bank.accountHolderName}</Row>
                <Row label="IFSC">{app.bank.ifsc}</Row>
                <Row label="Bank / branch">
                  {app.bank.bankName}
                  {app.bank.branchName ? ` · ${app.bank.branchName}` : ''}
                </Row>
                {app.bankReview?.reviewNote && <Row label="Reviewer note">{app.bankReview.reviewNote}</Row>}
              </dl>
              <VerificationControl section="bank" status={app.bank.verificationStatus} options={['PENDING', 'MANUAL_REVIEW', 'VERIFIED', 'FAILED']} disabled={!reviewable} onSave={setVerification} hint="Bank verification is independent of identity verification. Record how the account was checked (e.g. penny-drop, cheque)." />
            </>
          ) : (
            <p className="text-sm text-ink-500">Not provided.</p>
          )}
        </Card>
      </div>

      <Card
        title="Addresses"
        subtitle={app.addressesSame ? 'Technician declared both addresses are the same.' : 'Technician declared a different current address.'}
        actions={app.addressesDiffer ? <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800">Addresses differ</span> : null}
      >
        {app.addressesDiffer && (
          <Alert tone="info" className="mb-4">
            Different addresses are not a reason to reject. If needed, use “Request changes” to ask for current address proof.
          </Alert>
        )}
        <div className="grid gap-6 md:grid-cols-2">
          <div>
            <AddressBlock title="A. Aadhaar address" address={app.aadhaarAddress} />
            {app.aadhaarAddress && (
              <VerificationControl section="aadhaarAddress" status={app.aadhaarAddress.verificationStatus} options={AADHAAR_ADDRESS_OPTIONS} disabled={!reviewable} onSave={setVerification} />
            )}
          </div>
          <div>
            <AddressBlock title="B. Current residential address" address={app.currentAddress} />
            {app.currentAddress && (
              <VerificationControl
                section="currentAddress"
                status={app.currentAddress.verificationStatus}
                options={CURRENT_ADDRESS_OPTIONS}
                disabled={!reviewable}
                onSave={setVerification}
                hint={app.addressProofRequested ? 'Address proof was requested from this technician.' : undefined}
              />
            )}
          </div>
        </div>
      </Card>

      <Card title="Documents" subtitle={`Required: ${app.requiredDocuments.map((d) => d.label).join(', ')}`}>
        {app.documents.length ? (
          <div className="grid gap-3 lg:grid-cols-2">
            {app.documents.map((d) => (
              <DocumentReviewCard key={d.id} doc={d} canReview={reviewable} onReview={reviewDoc} />
            ))}
          </div>
        ) : (
          <p className="text-sm text-ink-500">No documents uploaded.</p>
        )}
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="Feedback sent to technician">
          {app.feedback.length ? (
            <ul className="space-y-3">
              {app.feedback.map((f) => (
                <li key={f.id} className="text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-ink-800">{SECTION_LABEL[f.section]}</span>
                    <span className="text-xs text-ink-400">{formatDate(f.createdAt)}</span>
                    {f.resolved ? <span className="text-xs font-semibold text-emerald-600">Resolved</span> : <span className="text-xs font-semibold text-amber-600">Open</span>}
                  </div>
                  <p className="text-ink-600">{f.message}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-500">No feedback yet.</p>
          )}
        </Card>

        <Card
          title="Audit trail"
          actions={
            !audit && (
              <Button size="sm" variant="secondary" onClick={() => api(`/admin/applications/${id}/audit`).then(setAudit).catch((e) => toast.push(e.message, 'error'))}>
                Load
              </Button>
            )
          }
        >
          {audit ? (
            <ol className="max-h-96 space-y-2 overflow-auto text-sm">
              {audit.map((a) => (
                <li key={a.id} className="flex flex-wrap justify-between gap-x-3 border-b border-ink-50 pb-2">
                  <span>
                    <span className="font-mono text-xs font-semibold text-ink-800">{a.action}</span>
                    <span className="ml-2 text-xs text-ink-500">{a.actorType.toLowerCase()}</span>
                  </span>
                  <span className="text-xs text-ink-400">{formatDate(a.createdAt)}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-ink-500">Every action on this application is logged, including document views.</p>
          )}
        </Card>
      </div>

      {modal === 'action' && <RequestActionModal app={app} onClose={() => setModal(null)} onDone={(body) => act('action', () => post('/request-action', body), 'Changes requested from technician')} />}
      {modal === 'reject' && (
        <ReasonModal title="Reject application" label="Reason (shown to the technician)" confirmLabel="Reject application" onClose={() => setModal(null)} onConfirm={(reason) => act('reject', () => post('/reject', { reason }), 'Application rejected')} />
      )}
      {modal === 'deactivate' && (
        <ReasonModal title="Deactivate technician" label="Reason for deactivation" confirmLabel="Deactivate" onClose={() => setModal(null)} onConfirm={(reason) => act('deactivate', () => post('/deactivate', { reason }), 'Technician deactivated')} />
      )}
      {modal?.startsWith('reveal-') && (
        <ReasonModal
          title="Reveal sensitive value"
          label="Why do you need the full value? (recorded in the audit log)"
          confirmLabel="Reveal"
          variant="primary"
          minLength={5}
          onClose={() => setModal(null)}
          onConfirm={async (reason) => {
            const field = modal.replace('reveal-', '');
            const res = await post('/reveal', { field, reason });
            setRevealed((r) => ({ ...r, [field]: res.value }));
            setAudit(null);
          }}
        />
      )}
    </div>
  );
}

export default function ApplicationPage() {
  return (
    <AdminShell>
      <ApplicationDetail />
    </AdminShell>
  );
}
