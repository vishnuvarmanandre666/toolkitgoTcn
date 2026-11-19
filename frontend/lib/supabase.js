import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/** True when technician phone login should go through Supabase Auth. */
export const supabaseEnabled = !!(url && anonKey);

/** OTP validity shown in the UI — keep equal to "SMS OTP Expiry" in the Supabase dashboard. */
export const SUPABASE_OTP_EXPIRY_SECONDS = Number(process.env.NEXT_PUBLIC_SUPABASE_OTP_EXPIRY_SECONDS || 300);
/** Supabase's minimum interval between OTP sends to the same number. */
export const SUPABASE_RESEND_SECONDS = Number(process.env.NEXT_PUBLIC_SUPABASE_RESEND_SECONDS || 60);

let client = null;
/**
 * Supabase is used only to prove phone ownership. The session is exchanged
 * for ToolkitGo's own httpOnly cookie and never persisted in the browser.
 */
export function getSupabase() {
  if (!supabaseEnabled) return null;
  if (!client) {
    client = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  }
  return client;
}
