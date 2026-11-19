import Link from 'next/link';
import { Logo } from '@/components/ui';

const steps = [
  ['Verify your mobile', 'Quick OTP verification on your Indian mobile number.'],
  ['Share your details', 'Personal info, Aadhaar, PAN and both your addresses.'],
  ['Upload documents', 'Clear photos or PDFs, stored privately and encrypted.'],
  ['Get approved', 'Our team reviews your application and activates your account.'],
];

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col px-4 py-6 sm:px-6">
      <header className="flex items-center justify-between">
        <Logo />
        <Link href="/admin/login" className="text-sm font-medium text-ink-500 hover:text-ink-800">
          Staff login
        </Link>
      </header>

      <section className="mt-12 grid flex-1 items-center gap-10 tg-enter md:mt-0 md:grid-cols-2">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-brand-600">For technicians</p>
          <h1 className="mt-2 text-3xl font-bold leading-tight text-ink-900 sm:text-4xl">Join ToolkitGo and start getting service bookings.</h1>
          <p className="mt-4 text-ink-600">Register in a few minutes. You can save your progress and come back any time to finish your KYC.</p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link href="/register" className="inline-flex items-center justify-center rounded-lg bg-brand-600 px-5 py-3 font-semibold text-white hover:bg-brand-700">
              Register / Continue
            </Link>
          </div>
        </div>
        <ol className="card tg-stagger divide-y divide-ink-100">
          {steps.map(([title, text], i) => (
            <li key={title} className="flex gap-4 px-5 py-4">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-50 text-sm font-bold text-brand-700">{i + 1}</span>
              <div>
                <p className="font-semibold text-ink-900">{title}</p>
                <p className="text-sm text-ink-500">{text}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
