import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { explain, getProfile } from './api';
import type { Profile } from './types';

interface AuthState {
  loading: boolean;
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  recovery: boolean;
  signIn(email: string, password: string): Promise<void>;
  signUp(email: string, password: string, displayName: string, username: string): Promise<{ needsConfirmation: boolean }>;
  signOut(): Promise<void>;
  sendReset(email: string): Promise<void>;
  setPassword(password: string): Promise<void>;
  refreshProfile(): Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

// Where Supabase email links should return to: the app root (works under /<repo>/ on Pages).
const appUrl = () => window.location.origin + window.location.pathname;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [recovery, setRecovery] = useState(false);

  useEffect(() => {
    let alive = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!alive) return;
      setSession(data.session);
      if (!data.session) setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === 'PASSWORD_RECOVERY') setRecovery(true);
      if (!s) { setProfile(null); setLoading(false); }
    });
    return () => { alive = false; sub.subscription.unsubscribe(); };
  }, []);

  const uid = session?.user.id;
  useEffect(() => {
    if (!uid) return;
    let alive = true;
    getProfile(uid)
      .then((p) => alive && setProfile(p))
      .catch(() => undefined)
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [uid]);

  const refreshProfile = useCallback(async () => {
    if (uid) setProfile(await getProfile(uid));
  }, [uid]);

  const value = useMemo<AuthState>(() => ({
    loading, session, user: session?.user ?? null, profile, recovery,
    async signIn(email, password) {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw new Error(error.message === 'Invalid login credentials' ? 'Email or password is incorrect.' : explain(error));
    },
    async signUp(email, password, displayName, username) {
      const { data, error } = await supabase.auth.signUp({
        email, password,
        options: { emailRedirectTo: appUrl(), data: { display_name: displayName.trim(), username: username.trim().toLowerCase() } },
      });
      if (error) throw new Error(explain(error));
      return { needsConfirmation: !data.session };
    },
    async signOut() { await supabase.auth.signOut(); },
    async sendReset(email) {
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: appUrl() });
      if (error) throw new Error(explain(error));
    },
    async setPassword(password) {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw new Error(explain(error));
      setRecovery(false);
    },
    refreshProfile,
  }), [loading, session, profile, recovery, refreshProfile]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside AuthProvider');
  return v;
}
