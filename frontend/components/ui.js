'use client';

import { createContext, useCallback, useContext, useEffect, useId, useState } from 'react';
import { statusMeta } from '@/lib/status';
import BrandLogo from '@/components/BrandLogo';

const cx = (...c) => c.filter(Boolean).join(' ');

export function Spinner({ className = 'h-4 w-4' }) {
  return (
    <svg className={cx('animate-spin', className)} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity=".25" strokeWidth="4" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}

const variants = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700 disabled:bg-brand-300',
  secondary: 'bg-white text-ink-800 ring-1 ring-inset ring-ink-300 hover:bg-ink-50 disabled:text-ink-400',
  danger: 'bg-red-600 text-white hover:bg-red-700 disabled:bg-red-300',
  success: 'bg-emerald-600 text-white hover:bg-emerald-700 disabled:bg-emerald-300',
  ghost: 'text-ink-700 hover:bg-ink-100 disabled:text-ink-400',
};

export function Button({ variant = 'primary', loading = false, className, children, disabled, size = 'md', type = 'button', ...props }) {
  // Default type="button": buttons inside forms (e.g. photo upload) must never submit the form by accident.
  return (
    <button
      type={type}
      {...props}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition-all duration-200 ease-out hover:-translate-y-px active:translate-y-0 active:scale-[0.98] disabled:cursor-not-allowed disabled:hover:translate-y-0',
        size === 'sm' ? 'px-3 py-1.5 text-sm' : 'px-4 py-2.5 text-[15px]',
        variants[variant],
        className,
      )}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
}

/** Label + control + hint/error wiring with proper aria attributes. */
export function Field({ label, required, hint, error, children, className }) {
  const id = useId();
  const describedBy = error ? `${id}-err` : hint ? `${id}-hint` : undefined;
  return (
    <div className={className}>
      {label && (
        <label htmlFor={id} className="label">
          {label} {required ? <span className="text-red-500" aria-hidden="true">*</span> : <span className="font-normal text-ink-400">(optional)</span>}
        </label>
      )}
      {children({ id, 'aria-invalid': !!error || undefined, 'aria-describedby': describedBy, className: cx('input', error && 'input-error') })}
      {error ? (
        <p id={`${id}-err`} className="mt-1.5 text-sm text-red-600" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="mt-1.5 text-xs text-ink-500">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function StatusBadge({ status, className }) {
  const m = statusMeta(status);
  return <span className={cx('inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset', m.className, className)}>{m.label}</span>;
}

const alertTone = {
  info: 'bg-sky-50 text-sky-800 ring-sky-200',
  warn: 'bg-amber-50 text-amber-900 ring-amber-200',
  error: 'bg-red-50 text-red-800 ring-red-200',
  success: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
};
export function Alert({ tone = 'info', title, children, className }) {
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={cx('rounded-xl px-4 py-3 text-sm ring-1 ring-inset', alertTone[tone], className)}>
      {title && <p className="font-semibold">{title}</p>}
      {children && <div className={title ? 'mt-1' : ''}>{children}</div>}
    </div>
  );
}

export function Card({ title, subtitle, actions, children, className }) {
  return (
    <section className={cx('card tg-enter', className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-ink-100 px-5 py-4 sm:px-6">
          <div>
            {title && <h2 className="text-base font-semibold text-ink-900">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-sm text-ink-500">{subtitle}</p>}
          </div>
          {actions}
        </header>
      )}
      <div className="px-5 py-5 sm:px-6">{children}</div>
    </section>
  );
}

export function EmptyState({ title, children }) {
  return (
    <div className="rounded-xl border border-dashed border-ink-300 px-6 py-10 text-center">
      <p className="font-medium text-ink-700">{title}</p>
      {children && <p className="mt-1 text-sm text-ink-500">{children}</p>}
    </div>
  );
}

export function PageLoader({ label = 'Loading…' }) {
  return (
    <div className="flex min-h-[40vh] items-center justify-center gap-3 text-ink-500" role="status">
      <Spinner className="h-5 w-5" /> {label}
    </div>
  );
}

/** Header logo: official wordmark plus an optional product label (e.g. "Partner"). */
export function Logo({ suffix, tone = 'light', tagline = false }) {
  return (
    <span className="inline-flex items-end gap-2 pl-[0.7rem]">
      <BrandLogo tone={tone} size="sm" tagline={tagline} />
      {suffix && (
        <span className={cx('mb-0.5 hidden rounded px-1.5 py-0.5 text-[11px] sm:inline font-semibold uppercase tracking-wide', tone === 'dark' ? 'bg-white/10 text-ink-200' : 'bg-ink-100 text-ink-600')}>
          {suffix}
        </span>
      )}
    </span>
  );
}

// ------------------------------------------------------------- toasts ----
const ToastCtx = createContext({ push: () => {} });
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((message, tone = 'success') => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);
  return (
    <ToastCtx.Provider value={{ push }}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cx(
              'tg-toast pointer-events-auto w-full max-w-sm rounded-xl px-4 py-3 text-sm font-medium shadow-lg',
              t.tone === 'error' ? 'bg-red-600 text-white' : 'bg-ink-900 text-white',
            )}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/** Counts down from `seconds`; returns remaining seconds. */
export function useCountdown(seconds) {
  const [left, setLeft] = useState(seconds);
  useEffect(() => setLeft(seconds), [seconds]);
  useEffect(() => {
    if (left <= 0) return undefined;
    const t = setTimeout(() => setLeft((l) => l - 1), 1000);
    return () => clearTimeout(t);
  }, [left]);
  return [left, setLeft];
}

export { cx };
