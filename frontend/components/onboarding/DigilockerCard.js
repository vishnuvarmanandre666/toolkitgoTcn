'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { Alert, Button } from '@/components/ui';

/** DigiLocker wordmark-style badge (text only; not the official logo). */
function DigilockerMark() {
  return (
    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#1d4ed8] text-white" aria-hidden="true">
      <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="4" y="10" width="16" height="11" rx="2" />
        <path d="M8 10V7a4 4 0 0 1 8 0v3" />
        <circle cx="12" cy="15.5" r="1.5" />
      </svg>
    </span>
  );
}

/**
 * "Verify with DigiLocker": captures consent, then sends the technician to
 * DigiLocker to sign in and approve sharing e-Aadhaar + PAN. Results come back
 * to /onboarding?digilocker=… (handled on the dashboard).
 */
export default function DigilockerCard({ kyc, focus = 'aadhaar' }) {
  const [consent, setConsent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const aadhaarDone = kyc.aadhaar?.verificationStatus === 'VERIFIED';
  const panDone = kyc.pan?.verificationStatus === 'VERIFIED';
  if (!kyc.policy?.digilockerEnabled || !kyc.editable) return null;
  if (aadhaarDone && panDone) return null;
  if (!kyc.personal.fullName || !kyc.personal.dateOfBirth) return null;

  async function start() {
    setError('');
    if (!consent) return setError('Please give your consent to continue.');
    setLoading(true);
    try {
      const { authorizeUrl } = await api('/technician/kyc/digilocker/start', { method: 'POST' });
      window.location.assign(authorizeUrl);
    } catch (e) {
      setError(e.message);
      setLoading(false);
    }
  }

  const fetches = [!aadhaarDone && 'Aadhaar (with address)', !panDone && 'PAN'].filter(Boolean).join(' and ');

  return (
    <div className="rounded-2xl border-2 border-[#1d4ed8]/25 bg-gradient-to-br from-blue-50 to-white p-5">
      <div className="flex items-start gap-3">
        <DigilockerMark />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold text-ink-900">Verify instantly with DigiLocker</p>
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-emerald-700">Recommended</span>
          </div>
          <p className="mt-1 text-sm text-ink-600">
            Fetch your {fetches} directly from the Government of India&apos;s DigiLocker. No document photos needed{focus === 'pan' ? ' for verified documents' : ''}.
          </p>
        </div>
      </div>

      <ul className="mt-4 space-y-1.5 text-sm text-ink-700">
        <li className="flex gap-2"><span className="text-emerald-600" aria-hidden="true">✓</span> You sign in on DigiLocker&apos;s own website — ToolkitGo never sees your Aadhaar OTP or password.</li>
        <li className="flex gap-2"><span className="text-emerald-600" aria-hidden="true">✓</span> Documents come straight from UIDAI and the Income Tax Department, so they&apos;re verified immediately.</li>
        <li className="flex gap-2"><span className="text-emerald-600" aria-hidden="true">✓</span> Your Aadhaar number stays masked; only the last 4 digits are kept.</li>
      </ul>

      <label className="mt-4 flex gap-3 rounded-xl border border-ink-200 bg-white p-3 text-sm text-ink-700">
        <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-[#1d4ed8]" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        <span>
          I consent to ToolkitGo fetching my e-Aadhaar and PAN from DigiLocker to verify my identity and address for technician onboarding. They will not be used for any
          other purpose. (Consent version {kyc.policy.aadhaarConsentVersion})
        </span>
      </label>

      {error && (
        <Alert tone="error" className="mt-3">
          {error}
        </Alert>
      )}

      <Button className="mt-4 w-full !bg-[#1d4ed8] hover:!bg-[#1e40af] sm:w-auto" loading={loading} onClick={start}>
        Continue to DigiLocker →
      </Button>
      <p className="mt-2 text-xs text-ink-500">Don&apos;t have DigiLocker? You can create a free account on the next screen using your Aadhaar.</p>
    </div>
  );
}
