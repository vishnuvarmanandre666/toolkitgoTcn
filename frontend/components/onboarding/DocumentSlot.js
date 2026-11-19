'use client';

import { useRef, useState } from 'react';
import { api, uploadWithProgress } from '@/lib/api';
import { CATEGORY_LABEL, formatBytes, formatDate } from '@/lib/status';
import { Button, StatusBadge, useToast } from '@/components/ui';
import CameraCapture, { cameraSupported } from './CameraCapture';

const MAX_MB = Number(process.env.NEXT_PUBLIC_MAX_UPLOAD_MB || 5);
const IMAGE_ONLY = ['PROFILE_PHOTO'];

/**
 * Upload / replace / view a single document with progress, client-side
 * pre-checks and status display. The server re-validates everything.
 */
export default function DocumentSlot({ category, document, label, description, editable, onChanged, allowRemove = false }) {
  const toast = useToast();
  const inputRef = useRef(null);
  const captureInputRef = useRef(null); // fallback: device camera app via <input capture>
  const [cameraOpen, setCameraOpen] = useState(false);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState('');
  const [opening, setOpening] = useState(false);

  const imageOnly = IMAGE_ONLY.includes(category);
  const accept = imageOnly ? 'image/jpeg,image/png' : 'image/jpeg,image/png,application/pdf';
  const needsReupload = document && ['REJECTED', 'REUPLOAD_REQUIRED'].includes(document.status);
  const canUpload = editable || needsReupload;
  const hasFile = !!document?.currentVersion;

  const isFace = category === 'PROFILE_PHOTO';

  function onFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) uploadFile(file);
  }

  function openCamera() {
    setError('');
    if (cameraSupported()) setCameraOpen(true);
    else captureInputRef.current?.click();
  }

  async function onCaptured(file) {
    setCameraOpen(false);
    await uploadFile(file);
  }

  async function uploadFile(file) {
    setError('');
    const allowed = accept.split(',');
    if (!allowed.includes(file.type)) return setError(imageOnly ? 'Please choose a JPEG or PNG image.' : 'Please choose a JPEG, PNG or PDF file.');
    if (file.size > MAX_MB * 1024 * 1024) return setError(`File is larger than ${MAX_MB} MB.`);

    const fd = new FormData();
    fd.append('category', category);
    if (document?.id) fd.append('documentId', document.id);
    if (label && !document?.id) fd.append('label', label);
    fd.append('file', file);
    setProgress(0);
    try {
      await uploadWithProgress('/technician/documents', fd, setProgress);
      toast.push(`${CATEGORY_LABEL[category]} ${hasFile ? 'replaced' : 'uploaded'}`);
      await onChanged?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setProgress(null);
    }
  }

  async function view() {
    setOpening(true);
    // Open the tab synchronously (popup blockers), then point it at the short-lived signed URL.
    const win = window.open('', '_blank');
    if (win) win.opener = null;
    try {
      const { url } = await api(`/technician/documents/${document.id}/url`);
      if (win) win.location.href = url;
      else window.location.href = url;
    } catch (err) {
      win?.close();
      setError(err.message);
    } finally {
      setOpening(false);
    }
  }

  async function remove() {
    if (!confirm('Remove this document?')) return;
    try {
      await api(`/technician/documents/${document.id}`, { method: 'DELETE' });
      toast.push('Document removed');
      await onChanged?.();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className={`rounded-xl border p-4 ${needsReupload ? 'border-amber-300 bg-amber-50/50' : 'border-ink-200 bg-white'}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium text-ink-900">
            {CATEGORY_LABEL[category]}
            {document?.label && <span className="text-ink-500"> — {document.label}</span>}
          </p>
          {description && <p className="mt-0.5 text-xs text-ink-500">{description}</p>}
        </div>
        <StatusBadge status={hasFile ? document.status : 'NOT_UPLOADED'} />
      </div>

      {hasFile && (
        <p className="mt-2 truncate text-xs text-ink-500">
          {document.currentVersion.originalName} · {formatBytes(document.currentVersion.sizeBytes)} · v{document.currentVersion.version} · {formatDate(document.currentVersion.uploadedAt)}
        </p>
      )}
      {document?.rejectionReason && needsReupload && (
        <p className="mt-2 text-sm text-amber-900">
          <span className="font-semibold">Reviewer note:</span> {document.rejectionReason}
        </p>
      )}

      {progress !== null && (
        <div className="mt-3" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} aria-label="Upload progress">
          <div className="h-2 overflow-hidden rounded-full bg-ink-100">
            <div className="h-full rounded-full bg-brand-500 transition-all" style={{ width: `${progress}%` }} />
          </div>
          <p className="mt-1 text-xs text-ink-500">{progress < 100 ? `Uploading… ${progress}%` : 'Checking file…'}</p>
        </div>
      )}
      {error && (
        <p className="mt-2 text-sm text-red-600" role="alert">
          {error}
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {canUpload && (
          <>
            <input ref={inputRef} type="file" accept={accept} className="sr-only" onChange={onFile} tabIndex={-1} aria-hidden="true" />
            <input
              ref={captureInputRef}
              type="file"
              accept="image/jpeg,image/png"
              capture={isFace ? 'user' : 'environment'}
              className="sr-only"
              onChange={onFile}
              tabIndex={-1}
              aria-hidden="true"
            />
            <Button size="sm" variant={hasFile && !needsReupload ? 'secondary' : 'primary'} onClick={openCamera} disabled={progress !== null}>
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M3 8a2 2 0 0 1 2-2h2l1.5-2h7L17 6h2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                <circle cx="12" cy="13" r="3.5" />
              </svg>
              {hasFile ? 'Retake photo' : 'Take photo'}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => inputRef.current?.click()} loading={progress !== null}>
              {hasFile ? 'Replace file' : 'Upload file'}
            </Button>
          </>
        )}
        {hasFile && (
          <Button size="sm" variant="ghost" onClick={view} loading={opening}>
            View
          </Button>
        )}
        {allowRemove && hasFile && editable && (
          <Button size="sm" variant="ghost" className="text-red-600" onClick={remove}>
            Remove
          </Button>
        )}
      </div>
      {canUpload && <p className="mt-2 text-xs text-ink-400">Take a photo with your camera, or upload {imageOnly ? 'a JPEG or PNG' : 'a JPEG, PNG or PDF'} up to {MAX_MB} MB.</p>}
      {cameraOpen && (
        <CameraCapture
          mode={isFace ? 'face' : 'document'}
          title={isFace ? 'Take your profile photo' : `Photograph your ${CATEGORY_LABEL[category]}`}
          onCapture={onCaptured}
          onClose={() => setCameraOpen(false)}
        />
      )}
    </div>
  );
}
