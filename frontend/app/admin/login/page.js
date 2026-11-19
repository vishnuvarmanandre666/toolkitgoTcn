'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { api } from '@/lib/api';
import { Alert, Button, Field, Logo } from '@/components/ui';

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await api('/admin/auth/login', { method: 'POST', body: { email, password } });
      const next = params.get('next');
      router.replace(next && next.startsWith('/admin') && !next.startsWith('//') ? next : '/admin');
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="card mt-8 w-full max-w-sm space-y-5 p-6 sm:p-8">
      <div>
        <h1 className="text-xl font-bold text-ink-900">Staff sign in</h1>
        <p className="mt-1 text-sm text-ink-500">For ToolkitGo admins and office staff.</p>
      </div>
      <Field label="Email" required>
        {(f) => <input {...f} type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />}
      </Field>
      <Field label="Password" required>
        {(f) => <input {...f} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />}
      </Field>
      {error && <Alert tone="error">{error}</Alert>}
      <Button type="submit" className="w-full" loading={loading}>
        Sign in
      </Button>
    </form>
  );
}

export default function AdminLoginPage() {
  return (
    <main className="flex min-h-screen flex-col items-center bg-ink-100 px-4 py-12">
      <Logo suffix="KYC Console" />
      <Suspense>
        <LoginForm />
      </Suspense>
    </main>
  );
}
