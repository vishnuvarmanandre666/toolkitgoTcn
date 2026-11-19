'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/status';
import AdminShell, { ROLE_LABEL, useAdmin } from '@/components/admin/AdminShell';
import { Alert, Button, Card, Field, useToast } from '@/components/ui';

function Staff() {
  const me = useAdmin();
  const toast = useToast();
  const [staff, setStaff] = useState(null);
  const [form, setForm] = useState({ name: '', email: '', role: 'REVIEWER', password: '' });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const load = () => api('/admin/staff').then(setStaff).catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);

  if (me.role !== 'SUPER_ADMIN') return <Alert tone="error">Only super admins can manage staff.</Alert>;

  async function create(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api('/admin/staff', { method: 'POST', body: form });
      toast.push('Staff account created');
      setForm({ name: '', email: '', role: 'REVIEWER', password: '' });
      load();
    } catch (err) {
      setError(err.messages.join(' · '));
    } finally {
      setSaving(false);
    }
  }

  async function update(id, body) {
    try {
      await api(`/admin/staff/${id}`, { method: 'PATCH', body });
      toast.push('Updated');
      load();
    } catch (err) {
      toast.push(err.message, 'error');
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-ink-900">Staff & permissions</h1>
      <Alert tone="info">
        <b>Reviewers</b> verify documents and request changes. <b>Admins</b> can also approve, reject, activate and reveal masked values. <b>Super admins</b> manage staff.
      </Alert>
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <Card title="Team">
          {error && <Alert tone="error" className="mb-3">{error}</Alert>}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="py-2 font-semibold">Name</th>
                  <th className="py-2 font-semibold">Role</th>
                  <th className="py-2 font-semibold">Last login</th>
                  <th className="py-2 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {staff?.map((s) => (
                  <tr key={s.id}>
                    <td className="py-3">
                      <p className="font-medium text-ink-900">{s.name}</p>
                      <p className="text-xs text-ink-500">{s.email}</p>
                    </td>
                    <td className="py-3">
                      <select className="input w-36 py-1.5 text-sm" aria-label={`Role for ${s.name}`} value={s.role} disabled={s.id === me.id} onChange={(e) => update(s.id, { role: e.target.value })}>
                        {Object.entries(ROLE_LABEL).map(([k, v]) => (
                          <option key={k} value={k}>
                            {v}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-3 text-ink-600">{formatDate(s.lastLoginAt)}</td>
                    <td className="py-3">
                      {s.id === me.id ? (
                        <span className="text-xs text-ink-400">You</span>
                      ) : (
                        <Button size="sm" variant={s.isActive ? 'ghost' : 'secondary'} onClick={() => update(s.id, { isActive: !s.isActive })}>
                          {s.isActive ? 'Deactivate' : 'Reactivate'}
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <Card title="Add staff member">
          <form onSubmit={create} className="space-y-4">
            <Field label="Name" required>
              {(f) => <input {...f} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />}
            </Field>
            <Field label="Email" required>
              {(f) => <input {...f} type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />}
            </Field>
            <Field label="Role" required>
              {(f) => (
                <select {...f} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                  {Object.entries(ROLE_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="Temporary password" required hint="At least 10 characters. Share it securely.">
              {(f) => <input {...f} type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />}
            </Field>
            <Button type="submit" className="w-full" loading={saving}>
              Create account
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}

export default function StaffPage() {
  return (
    <AdminShell>
      <Staff />
    </AdminShell>
  );
}
