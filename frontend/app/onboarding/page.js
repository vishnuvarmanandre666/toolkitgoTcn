'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { formatDate, SECTION_LABEL } from '@/lib/status';
import { Alert, Button, Card, cx, Logo, PageLoader, StatusBadge } from '@/components/ui';
import PersonalStep from '@/components/onboarding/PersonalStep';
import AadhaarStep from '@/components/onboarding/AadhaarStep';
import PanStep from '@/components/onboarding/PanStep';
import AddressStep from '@/components/onboarding/AddressStep';
import DocumentsStep from '@/components/onboarding/DocumentsStep';
import BankStep from '@/components/onboarding/BankStep';
import ReviewStep from '@/components/onboarding/ReviewStep';

const STEP_COMPONENTS = {
  personal: [PersonalStep, 'Your basic details and a profile photo.'],
  aadhaar: [AadhaarStep, 'Verify your identity with Aadhaar.'],
  pan: [PanStep, 'Verify your PAN for tax compliance.'],
  address: [AddressStep, 'Your Aadhaar address and where you live now.'],
  documents: [DocumentsStep, 'Upload and manage all your documents.'],
  bank: [BankStep, 'Where we send your payouts.'],
  submission: [ReviewStep, 'Check everything and submit for review.'],
};

const DL_TEXT = { VERIFIED: 'verified', FAILED: 'could not be verified', NOT_AVAILABLE: 'not found in your DigiLocker' };

/** Result of a DigiLocker round-trip (from the ?digilocker=… redirect). */
function DigilockerResult({ r, onClose }) {
  const tone = r.result === 'success' ? 'success' : r.result === 'partial' ? 'warn' : r.result === 'cancelled' ? 'info' : 'error';
  const title = {
    success: 'Aadhaar and PAN verified with DigiLocker',
    partial: 'DigiLocker verification partly completed',
    failed: 'DigiLocker verification failed',
    cancelled: 'DigiLocker consent was not given',
    expired: 'DigiLocker session expired',
    error: 'DigiLocker verification could not be completed',
  }[r.result] || 'DigiLocker';
  return (
    <div className="relative">
      <Alert tone={tone} title={title}>
        {(r.aadhaar || r.pan) && r.result !== 'success' && (
          <ul className="mt-1 space-y-0.5">
            {r.aadhaar && <li>Aadhaar: {DL_TEXT[r.aadhaar] || r.aadhaar}</li>}
            {r.pan && <li>PAN: {DL_TEXT[r.pan] || r.pan}</li>}
          </ul>
        )}
        {r.msg && <p className="mt-1">{r.msg}</p>}
        {r.result === 'success' ? (
          <p className="mt-1">Your details and Aadhaar address were filled in automatically. No document photos are needed for these.</p>
        ) : (
          <p className="mt-1">You can try DigiLocker again, or enter your details manually and upload the document.</p>
        )}
      </Alert>
      <button type="button" onClick={onClose} className="absolute right-2 top-2 rounded p-1 text-ink-500 hover:bg-black/5" aria-label="Dismiss">
        ✕
      </button>
    </div>
  );
}

function StatusBanner({ kyc }) {
  const open = kyc.feedback.filter((f) => !f.resolved);
  switch (kyc.kycStatus) {
    case 'APPROVED':
      return (
        <Alert tone="success" title={kyc.isActive ? 'You are approved and active on ToolkitGo' : 'Your KYC is approved'}>
          {kyc.isActive ? `Activated on ${formatDate(kyc.activatedAt)}. You can now receive bookings.` : 'Your account will be activated shortly.'}
        </Alert>
      );
    case 'REJECTED':
      return (
        <Alert tone="error" title="Your application was not approved">
          {kyc.rejectionReason || 'Please contact ToolkitGo support for details.'}
        </Alert>
      );
    case 'SUBMITTED':
    case 'UNDER_REVIEW':
      return (
        <Alert tone="info" title={kyc.kycStatus === 'UNDER_REVIEW' ? 'Your application is being reviewed' : 'Application submitted'}>
          Submitted {formatDate(kyc.submittedAt)}. Your details are locked during review. We&apos;ll let you know if anything else is needed.
        </Alert>
      );
    case 'ACTION_REQUIRED':
      return (
        <Alert tone="warn" title="Action required — please update and re-submit">
          {open.length > 0 && (
            <ul className="mt-1 space-y-1">
              {open.map((f) => (
                <li key={f.id}>
                  <span className="font-semibold">{SECTION_LABEL[f.section]}:</span> {f.message}
                </li>
              ))}
            </ul>
          )}
        </Alert>
      );
    default:
      return null;
  }
}

export default function OnboardingPage() {
  const router = useRouter();
  const [kyc, setKyc] = useState(null);
  const [error, setError] = useState('');
  const [active, setActive] = useState(null);
  const [dlResult, setDlResult] = useState(null);

  const refresh = useCallback(async () => {
    try {
      const state = await api('/technician/kyc');
      setKyc(state);
      return state;
    } catch (e) {
      if (e.status === 401) router.replace('/register');
      else setError(e.message);
      return null;
    }
  }, [router]);

  useEffect(() => {
    // Returning from DigiLocker? Read the outcome once, then clean the URL.
    let dl = null;
    try {
      const qs = new URLSearchParams(window.location.search);
      if (qs.get('digilocker')) {
        dl = { result: qs.get('digilocker'), aadhaar: qs.get('aadhaar'), pan: qs.get('pan'), msg: qs.get('msg') };
        window.history.replaceState(null, '', '/onboarding');
      }
    } catch {
      /* ignore */
    }
    refresh().then((state) => {
      if (!state) return;
      if (dl) {
        setDlResult(dl);
        const next = state.aadhaar?.verificationStatus !== 'VERIFIED' ? 'aadhaar' : state.pan?.verificationStatus !== 'VERIFIED' ? 'pan' : 'address';
        setActive(next);
        return;
      }
      let saved = null;
      try {
        saved = sessionStorage.getItem('tg-onboarding-step');
      } catch {
        /* storage unavailable */
      }
      const firstIncomplete = state.progress.steps.find((s) => !s.complete && s.key !== 'mobile');
      setActive(saved && STEP_COMPONENTS[saved] ? saved : firstIncomplete?.key || 'submission');
    });
  }, [refresh]);

  const goTo = (key) => {
    setActive(key);
    try {
      sessionStorage.setItem('tg-onboarding-step', key);
    } catch {
      /* ignore */
    }
    if (typeof window !== 'undefined' && window.innerWidth < 1024) document.getElementById('step-panel')?.scrollIntoView({ behavior: 'smooth' });
  };

  async function logout() {
    await api('/technician/logout', { method: 'POST' }).catch(() => {});
    router.replace('/');
  }

  if (error) {
    return (
      <main className="mx-auto max-w-lg px-4 py-16">
        <Alert tone="error" title="Could not load your application">
          {error}
        </Alert>
        <Button className="mt-4" onClick={() => location.reload()}>
          Retry
        </Button>
      </main>
    );
  }
  if (!kyc || !active) return <PageLoader label="Loading your application…" />;

  const steps = kyc.progress.steps;
  const activeStep = steps.find((s) => s.key === active);
  const [StepComponent, description] = STEP_COMPONENTS[active];
  const nextKey = () => {
    const idx = steps.findIndex((s) => s.key === active);
    const next = steps.slice(idx + 1).find((s) => !s.complete) || steps[steps.length - 1];
    goTo(next.key);
  };
  const openFeedbackSections = new Set(kyc.feedback.filter((f) => !f.resolved).map((f) => f.section));
  const sectionForStep = { personal: 'PERSONAL', aadhaar: 'AADHAAR', pan: 'PAN', address: 'ADDRESS', documents: 'DOCUMENTS', bank: 'BANK' };

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-ink-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <Logo suffix="Partner" />
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-ink-500 sm:inline">+91 {kyc.phone}</span>
            <StatusBadge status={kyc.kycStatus} />
            <Button size="sm" variant="ghost" onClick={logout}>
              Log out
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6">
        <div>
          <h1 className="text-2xl font-bold text-ink-900">{kyc.personal.fullName ? `Hi ${kyc.personal.fullName.split(' ')[0]},` : 'Complete your registration'}</h1>
          <p className="text-ink-500">{kyc.editable ? 'Your progress is saved automatically after each step — you can leave and continue later.' : 'Here is the status of your application.'}</p>
        </div>

        <StatusBanner kyc={kyc} />
        {dlResult && <DigilockerResult r={dlResult} onClose={() => setDlResult(null)} />}

        <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
          <nav aria-label="Registration steps" className="card h-fit p-5 lg:sticky lg:top-20">
            <div className="flex items-baseline justify-between">
              <p className="text-sm font-semibold text-ink-700">Registration progress</p>
              <p className="text-sm font-bold text-brand-700">{kyc.progress.percent}%</p>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-ink-100" role="progressbar" aria-valuenow={kyc.progress.percent} aria-valuemin={0} aria-valuemax={100} aria-label="Registration progress">
              <div className="h-full rounded-full bg-brand-500 transition-all" style={{ width: `${kyc.progress.percent}%` }} />
            </div>
            <ol className="mt-5 space-y-1">
              {steps.map((s, i) => {
                const clickable = s.key !== 'mobile';
                const flagged = openFeedbackSections.has(sectionForStep[s.key]);
                return (
                  <li key={s.key}>
                    <button
                      type="button"
                      disabled={!clickable}
                      onClick={() => goTo(s.key)}
                      aria-current={active === s.key ? 'step' : undefined}
                      className={cx(
                        'flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left text-sm transition-colors',
                        active === s.key ? 'bg-brand-50 font-semibold text-brand-800' : 'text-ink-700 hover:bg-ink-50',
                        !clickable && 'cursor-default hover:bg-transparent',
                      )}
                    >
                      <span
                        className={cx(
                          'grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-bold',
                          flagged ? 'bg-amber-500 text-white' : s.complete ? 'bg-emerald-500 text-white' : 'bg-ink-100 text-ink-500',
                        )}
                        aria-hidden="true"
                      >
                        {flagged ? '!' : s.complete ? '✓' : i + 1}
                      </span>
                      <span className="flex-1">
                        {s.label}
                        {s.optional && <span className="ml-1 text-xs font-normal text-ink-400">(optional)</span>}
                      </span>
                      <span className="sr-only">{flagged ? 'needs attention' : s.complete ? 'complete' : 'pending'}</span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </nav>

          <div id="step-panel" key={active} className="scroll-mt-20 tg-enter">
            <Card
              title={activeStep.label}
              subtitle={description}
              actions={
                activeStep.complete ? (
                  <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200">Step complete</span>
                ) : activeStep.hint ? (
                  <span className="text-xs text-ink-500">{activeStep.hint}</span>
                ) : null
              }
            >
              <StepComponent kyc={kyc} onUpdate={setKyc} refresh={refresh} onNext={nextKey} goTo={goTo} />
            </Card>
            {active !== 'submission' && (
              <div className="mt-4 flex justify-end">
                <Button variant="ghost" onClick={nextKey}>
                  Next step →
                </Button>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
