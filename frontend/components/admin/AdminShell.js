'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, useContext, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Button, cx, Logo, PageLoader } from '@/components/ui';

const AdminCtx = createContext(null);
export const useAdmin = () => useContext(AdminCtx);

export const ROLE_LABEL = { SUPER_ADMIN: 'Super admin', ADMIN: 'Admin', REVIEWER: 'Reviewer' };
export const canDecide = (admin) => admin && ['ADMIN', 'SUPER_ADMIN'].includes(admin.role);

/** Loads the signed-in staff member and renders the admin chrome; redirects to login on 401. */
export default function AdminShell({ children }) {
  const router = useRouter();
  const pathname = usePathname();
  const [admin, setAdmin] = useState(null);

  useEffect(() => {
    api('/admin/auth/me')
      .then(setAdmin)
      .catch(() => router.replace(`/admin/login?next=${encodeURIComponent(pathname)}`));
  }, [router, pathname]);

  async function logout() {
    await api('/admin/auth/logout', { method: 'POST' }).catch(() => {});
    router.replace('/admin/login');
  }

  if (!admin) return <PageLoader />;

  const nav = [
    ['/admin', 'Applications'],
    ...(admin.role === 'SUPER_ADMIN' ? [['/admin/staff', 'Staff']] : []),
  ];

  return (
    <AdminCtx.Provider value={admin}>
      <div className="min-h-screen">
        <header className="sticky top-0 z-30 border-b border-white/10 bg-logo-navy text-white">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
            <div className="flex items-center gap-6">
              <Link href="/admin" aria-label="ToolkitGo KYC Console home">
                <Logo suffix="KYC Console" tone="dark" />
              </Link>
              <nav className="flex gap-1" aria-label="Admin">
                {nav.map(([href, label]) => (
                  <Link
                    key={href}
                    href={href}
                    className={cx(
                      'rounded-md px-3 py-1.5 text-sm font-medium',
                      (href === '/admin' ? pathname === '/admin' || pathname.startsWith('/admin/applications') : pathname.startsWith(href)) ? 'bg-white/10 text-white' : 'text-ink-300 hover:text-white',
                    )}
                  >
                    {label}
                  </Link>
                ))}
              </nav>
            </div>
            <div className="flex items-center gap-3 text-sm">
              <span className="hidden text-ink-300 sm:inline">
                {admin.name} · {ROLE_LABEL[admin.role]}
              </span>
              <Button size="sm" variant="ghost" className="!text-ink-200 hover:!bg-white/10" onClick={logout}>
                Log out
              </Button>
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">{children}</main>
      </div>
    </AdminCtx.Provider>
  );
}
