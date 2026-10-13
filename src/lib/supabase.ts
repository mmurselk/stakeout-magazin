import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** True when the key is a privileged one that must never ship in a browser bundle. */
export function isPrivilegedKey(k: string): boolean {
  if (k.startsWith('sb_secret_')) return true;
  const parts = k.split('.');
  if (parts.length !== 3) return false;
  try {
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    return payload?.role === 'service_role';
  } catch {
    return false;
  }
}

export const isConfigured = Boolean(url && key && !url.includes('YOUR-PROJECT') && !key.startsWith('YOUR-'));
export const keyIsUnsafe = Boolean(key && isPrivilegedKey(key));

// If someone pastes the service-role key by mistake, refuse to use it at all.
export const supabase = createClient(
  isConfigured && !keyIsUnsafe ? url! : 'http://localhost:54321',
  isConfigured && !keyIsUnsafe ? key! : 'public-anon-key-not-configured',
  {
    auth: {
      flowType: 'pkce', // email links return ?code=… (query string), compatible with hash routing
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  },
);

export const PHOTO_BUCKET = 'review-photos';
