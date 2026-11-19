'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { getSupabase, SUPABASE_OTP_EXPIRY_SECONDS, SUPABASE_RESEND_SECONDS, supabaseEnabled } from '@/lib/supabase';
import { digitsOnly, isMobile } from '@/lib/validators';
import { Alert, Button, Field, useCountdown, useToast } from '@/components/ui';
import BrandLogo from '@/components/BrandLogo';

/** Turns a Supabase Auth error into the same shape as our API errors. */
function supabaseError(error, phase) {
  const raw = error?.message || '';
  const wait = Number(raw.match(/after (\d+) seconds?/)?.[1]);
  const status = error?.status === 429 || wait ? 429 : error?.status || 400;
  let message = raw || 'Something went wrong.';
  if (phase === 'verify' && /expired|invalid/i.test(raw)) message = 'Incorrect or expired OTP.';
  else if (phase === 'send' && (error?.code === 'sms_send_failed' || /provider/i.test(raw))) {
    console.error('Supabase SMS send failed:', raw);
    message = 'We could not send the OTP SMS right now. Please try again later.';
  } else if (phase === 'send' && /invalid.*phone|phone.*invalid/i.test(raw)) message = 'Enter a valid 10-digit Indian mobile number.';
  return new ApiError(status, { message, details: wait ? { retryAfterSeconds: wait } : undefined });
}

/**
 * OTP transport. With Supabase configured, Supabase Auth sends and verifies the
 * SMS and the resulting session is exchanged for a ToolkitGo session cookie.
 * Otherwise ToolkitGo's own OTP API (Redis + MSG91) is used.
 */
const otpTransport = supabaseEnabled
  ? {
      async send(tenDigit) {
        const { error } = await getSupabase().auth.signInWithOtp({ phone: `+91${tenDigit}` });
        if (error) throw supabaseError(error, 'send');
        return { expiresInSeconds: SUPABASE_OTP_EXPIRY_SECONDS, resendCooldownSeconds: SUPABASE_RESEND_SECONDS, resendsRemaining: null };
      },
      resend(tenDigit) {
        return this.send(tenDigit);
      },
      async verify(tenDigit, otp) {
        const sb = getSupabase();
        const { data, error } = await sb.auth.verifyOtp({ phone: `+91${tenDigit}`, token: otp, type: 'sms' });
        if (error || !data?.session) throw supabaseError(error, 'verify');
        try {
          return await api('/auth/supabase/session', { method: 'POST', body: { accessToken: data.session.access_token } });
        } finally {
          // ToolkitGo session is now in an httpOnly cookie; drop the Supabase session.
          sb.auth.signOut().catch(() => {});
        }
      },
    }
  : {
      send: (tenDigit) => api('/otp/send', { method: 'POST', body: { phone: tenDigit } }),
      resend: (tenDigit) => api('/otp/resend', { method: 'POST', body: { phone: tenDigit } }),
      verify: (tenDigit, otp) => api('/otp/verify', { method: 'POST', body: { phone: tenDigit, otp } }),
    };

/** Step 1: mobile number registration with OTP (send / verify / resend / change number). */
export default function RegisterPage() {
  const router = useRouter();
  const toast = useToast();
  const [phase, setPhase] = useState('phone'); // phone | otp
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [expiresIn, setExpiresIn] = useCountdown(0);
  const [cooldown, setCooldown] = useCountdown(0);
  const [resendsRemaining, setResendsRemaining] = useState(3);
  const otpRef = useRef(null);

  // Already signed in? Continue where they left off.
  useEffect(() => {
    api('/technician/kyc')
      .then(() => router.replace('/onboarding'))
      .catch(() => {});
  }, [router]);

  useEffect(() => {
    if (phase === 'otp') otpRef.current?.focus();
  }, [phase]);

  const tenDigit = digitsOnly(phone).slice(-10);

  function applySendResult(res) {
    setExpiresIn(res.expiresInSeconds);
    setCooldown(res.resendCooldownSeconds);
    setResendsRemaining(res.resendsRemaining);
  }

  function handleError(e) {
    const retry = e.details?.retryAfterSeconds;
    if (e.status === 429 && retry) {
      setCooldown(retry);
      setError(`${e.message} (${Math.ceil(retry / 60) > 1 ? `${Math.ceil(retry / 60)} min` : `${retry}s`})`);
    } else setError(e.message);
  }

  async function sendOtp(e) {
    e?.preventDefault();
    setError('');
    if (!isMobile(phone)) return setError('Enter a valid 10-digit Indian mobile number.');
    setLoading(true);
    try {
      applySendResult(await otpTransport.send(tenDigit));
      setPhase('otp');
      setOtp('');
      toast.push(`OTP sent to +91 ${tenDigit}`);
    } catch (err) {
      handleError(err);
    } finally {
      setLoading(false);
    }
  }

  async function resend() {
    setError('');
    setLoading(true);
    try {
      applySendResult(await otpTransport.resend(tenDigit));
      setOtp('');
      toast.push('A new OTP has been sent');
    } catch (err) {
      handleError(err);
    } finally {
      setLoading(false);
    }
  }

  async function verify(e) {
    e.preventDefault();
    setError('');
    if (!/^\d{6}$/.test(otp)) return setError('Enter the 6-digit OTP.');
    setLoading(true);
    try {
      const res = await otpTransport.verify(tenDigit, otp);
      toast.push(res.isNewRegistration ? 'Mobile verified. Welcome to ToolkitGo!' : 'Welcome back!');
      router.replace('/onboarding');
    } catch (err) {
      const remaining = err.details?.attemptsRemaining;
      setError(remaining !== undefined ? `${err.message} ${remaining} attempt${remaining === 1 ? '' : 's'} left.` : err.message);
      if (err.status === 429) setOtp('');
      setLoading(false);
    }
  }

  const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  return (
    <main className="flex min-h-screen flex-col items-center px-4 py-8">
      <Link href="/" aria-label="ToolkitGo home" className="pl-6">
        <BrandLogo size="md" tagline />
      </Link>
      <div key={phase} className="card tg-enter mt-8 w-full max-w-md p-6 sm:p-8">
        {phase === 'phone' ? (
          <form onSubmit={sendOtp} noValidate>
            <h1 className="text-xl font-bold text-ink-900">Register or sign in</h1>
            <p className="mt-1 text-sm text-ink-500">We&apos;ll send a 6-digit OTP to verify your mobile number.</p>
            <div className="mt-6">
              <span className="label">
                Mobile number <span className="text-red-500">*</span>
              </span>
              <div className="flex gap-2">
                <label className="sr-only" htmlFor="cc">
                  Country code
                </label>
                <select id="cc" className="input w-24" value="+91" disabled>
                  <option>+91</option>
                </select>
                <label className="sr-only" htmlFor="phone">
                  Mobile number
                </label>
                <input
                  id="phone"
                  className="input"
                  inputMode="numeric"
                  autoComplete="tel-national"
                  placeholder="98765 43210"
                  maxLength={14}
                  value={phone}
                  onChange={(e) => setPhone(e.target.value.replace(/[^\d\s]/g, ''))}
                  aria-invalid={!!error || undefined}
                />
              </div>
            </div>
            {error && <Alert tone="error" className="mt-4">{error}</Alert>}
            <Button type="submit" className="mt-6 w-full" loading={loading}>
              Send OTP
            </Button>
          </form>
        ) : (
          <form onSubmit={verify} noValidate>
            <h1 className="text-xl font-bold text-ink-900">Enter OTP</h1>
            <p className="mt-1 text-sm text-ink-500">
              Sent to <span className="font-semibold text-ink-800">+91 {tenDigit}</span>{' '}
              <button
                type="button"
                className="font-semibold text-brand-700 underline-offset-2 hover:underline"
                onClick={() => {
                  setPhase('phone');
                  setError('');
                  setOtp('');
                }}
              >
                Change number
              </button>
            </p>
            <Field label="One-time password" required hint={expiresIn > 0 ? `Expires in ${mmss(expiresIn)}` : 'OTP expired — request a new one.'} className="mt-6">
              {(p) => (
                <input
                  {...p}
                  ref={otpRef}
                  className={`${p.className} text-center text-2xl font-semibold tracking-[0.5em]`}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                />
              )}
            </Field>
            {error && <Alert tone="error" className="mt-4">{error}</Alert>}
            <Button type="submit" className="mt-6 w-full" loading={loading} disabled={otp.length !== 6}>
              Verify & continue
            </Button>
            <div className="mt-4 text-center text-sm text-ink-500">
              {cooldown > 0 ? (
                <span>Resend OTP in {cooldown}s</span>
              ) : resendsRemaining === null || resendsRemaining > 0 ? (
                <button type="button" onClick={resend} disabled={loading} className="font-semibold text-brand-700 hover:underline">
                  Resend OTP{resendsRemaining !== null && ` (${resendsRemaining} left)`}
                </button>
              ) : (
                <span>Resend limit reached. Please try again later.</span>
              )}
            </div>
          </form>
        )}
      </div>
      <p className="mt-6 max-w-md text-center text-xs text-ink-400">
        By continuing you agree to ToolkitGo&apos;s terms and privacy policy. We never ask for your Aadhaar OTP.
      </p>
    </main>
  );
}
