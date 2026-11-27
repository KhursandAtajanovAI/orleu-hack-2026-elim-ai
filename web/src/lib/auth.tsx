'use client';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import type { Me, Role } from '@kaida/contracts';
import { configured, supabase } from './supabase';

interface AuthState {
  session: Session | null;
  me: Me | null;
  loading: boolean;
  hasRole: (r: Role) => boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}
const Ctx = createContext<AuthState>({ session: null, me: null, loading: true, hasRole: () => false, refresh: async () => {}, signOut: async () => {} });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  const loadMe = useCallback(async (s: Session | null) => {
    if (!s || !configured) { setMe(null); return; }
    const { data } = await supabase().rpc('me');
    setMe((data as Me) ?? null);
  }, []);

  useEffect(() => {
    if (!configured) { setLoading(false); return; }
    const sb = supabase();
    sb.auth.getSession().then(async ({ data }) => { setSession(data.session); await loadMe(data.session); setLoading(false); });
    const { data: sub } = sb.auth.onAuthStateChange((_e, s) => { setSession(s); loadMe(s); });
    return () => sub.subscription.unsubscribe();
  }, [loadMe]);

  const value: AuthState = {
    session, me, loading,
    hasRole: (r) => Boolean(me?.roles?.includes(r) || me?.roles?.includes('admin')),
    refresh: () => loadMe(session),
    signOut: async () => { await supabase().auth.signOut(); setMe(null); },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export const useAuth = () => useContext(Ctx);
