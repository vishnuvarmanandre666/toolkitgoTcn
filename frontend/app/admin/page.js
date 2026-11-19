'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { formatDate, statusMeta } from '@/lib/status';
import AdminShell from '@/components/admin/AdminShell';
import { Alert, Button, cx, EmptyState, Spinner, StatusBadge } from '@/components/ui';

const TABS = ['SUBMITTED', 'UNDER_REVIEW', 'ACTION_REQUIRED', 'APPROVED', 'REJECTED', 'IN_PROGRESS', 'NOT_STARTED', ''];
const VERIFICATION_KEYS = [
  ['aadhaar', 'Aadhaar'],
  ['pan', 'PAN'],
  ['currentAddress', 'Address'],
  ['bank', 'Bank'],
];

function Applications() {
  const [stats, setStats] = useState(null);
  const [status, setStatus] = useState('SUBMITTED');
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api('/admin/stats').then(setStats).catch(() => {});
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    setError('');
    const params = new URLSearchParams({ page: String(page), pageSize: '20' });
    if (status) params.set('status', status);
    if (query) params.set('q', query);
    api(`/admin/applications?${params}`, { signal: ctrl.signal })
      .then(setData)
      .catch((e) => e.name !== 'AbortError' && setError(e.message))
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [status, query, page]);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-ink-900">Technician applications</h1>
          <p className="text-ink-500">Review KYC submissions, verify documents and activate technicians.</p>
        </div>
      </div>

      {stats && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            ['Awaiting review', stats.byStatus.SUBMITTED, 'SUBMITTED'],
            ['Under review', stats.byStatus.UNDER_REVIEW, 'UNDER_REVIEW'],
            ['Action required', stats.byStatus.ACTION_REQUIRED, 'ACTION_REQUIRED'],
            ['Active technicians', stats.activeTechnicians, 'APPROVED'],
          ].map(([label, value, s]) => (
            <button
              key={label}
              type="button"
              onClick={() => {
                setStatus(s);
                setPage(1);
              }}
              className="card p-4 text-left transition-shadow hover:shadow-md"
            >
              <p className="text-xs font-medium uppercase tracking-wide text-ink-500">{label}</p>
              <p className="mt-1 text-2xl font-bold text-ink-900">{value}</p>
            </button>
          ))}
        </div>
      )}

      <div className="card tg-enter">
        <div className="flex flex-col gap-3 border-b border-ink-100 p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="-mx-1 flex gap-1 overflow-x-auto pb-1" role="tablist" aria-label="Filter by status">
            {TABS.map((s) => (
              <button
                key={s || 'all'}
                role="tab"
                aria-selected={status === s}
                onClick={() => {
                  setStatus(s);
                  setPage(1);
                }}
                className={cx('whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-medium', status === s ? 'bg-ink-900 text-white' : 'text-ink-600 hover:bg-ink-100')}
              >
                {s ? statusMeta(s).label : 'All'}
                {s && stats ? <span className="ml-1 opacity-60">{stats.byStatus[s]}</span> : null}
              </button>
            ))}
          </div>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              setQuery(q.trim());
              setPage(1);
            }}
          >
            <label htmlFor="search" className="sr-only">
              Search by name or phone
            </label>
            <input id="search" className="input w-full lg:w-64" placeholder="Name or phone digits" value={q} onChange={(e) => setQ(e.target.value)} />
            <Button type="submit" variant="secondary">
              Search
            </Button>
          </form>
        </div>

        {error && <Alert tone="error" className="m-4">{error}</Alert>}
        {loading && !data ? (
          <div className="flex justify-center p-10 text-ink-500">
            <Spinner className="h-5 w-5" />
          </div>
        ) : data?.items.length === 0 ? (
          <div className="p-6">
            <EmptyState title="No applications found">Try a different status filter or search.</EmptyState>
          </div>
        ) : (
          <div className={cx('overflow-x-auto', loading && 'opacity-60')}>
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">Technician</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold">Verifications</th>
                  <th className="px-4 py-3 font-semibold">Docs to review</th>
                  <th className="px-4 py-3 font-semibold">Submitted</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {data?.items.map((t) => (
                  <tr key={t.id} className="hover:bg-ink-50">
                    <td className="px-4 py-3">
                      <Link href={`/admin/applications/${t.id}`} className="font-semibold text-ink-900 hover:text-brand-700">
                        {t.fullName || 'Unnamed technician'}
                      </Link>
                      <p className="text-xs text-ink-500">
                        +91 {t.phone}
                        {t.isActive && <span className="ml-2 font-semibold text-emerald-600">● Active</span>}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={t.kycStatus} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {VERIFICATION_KEYS.filter(([k]) => t.verifications[k]).map(([k, label]) => {
                          const m = statusMeta(t.verifications[k]);
                          return (
                            <span key={k} title={`${label}: ${m.label}`} className={cx('rounded px-1.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset', m.className)}>
                              {label}
                            </span>
                          );
                        })}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-ink-700">{t.documentsAwaitingReview || '—'}</td>
                    <td className="px-4 py-3 text-ink-600">{formatDate(t.submittedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && data.total > data.pageSize && (
          <div className="flex items-center justify-between border-t border-ink-100 px-4 py-3 text-sm text-ink-600">
            <span>
              Page {data.page} of {totalPages} · {data.total} total
            </span>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Previous
              </Button>
              <Button size="sm" variant="secondary" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                Next
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function AdminHome() {
  return (
    <AdminShell>
      <Applications />
    </AdminShell>
  );
}
