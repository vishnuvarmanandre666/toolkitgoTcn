'use client';

import { useState } from 'react';
import { useToast } from '@/components/ui';

/** Wraps a save call with loading / server-error handling and a success toast. */
export function useSave(onUpdate) {
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState('');

  async function run(fn, successMessage = 'Saved') {
    setSaving(true);
    setServerError('');
    try {
      const next = await fn();
      if (next) onUpdate(next);
      if (successMessage) toast.push(successMessage);
      return next;
    } catch (err) {
      const blockers = err.details?.blockers;
      setServerError(blockers?.length ? `${err.message} ${blockers.join(' · ')}` : err.messages.join(' · '));
      return null;
    } finally {
      setSaving(false);
    }
  }
  return { saving, serverError, setServerError, run };
}
