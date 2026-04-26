import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AuthContextValue {
  user: User | null;
  loading: boolean;
  /** Supabase 未配置时为 false（Electron 桌面端） */
  authEnabled: boolean;
  signIn: (email: string, password: string) => Promise<string | null>;
  signUp: (email: string, password: string) => Promise<string | null>;
  signOut: () => Promise<void>;
}

// ─── Context ─────────────────────────────────────────────────────────────────

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: false,
  authEnabled: false,
  signIn: async () => null,
  signUp: async () => null,
  signOut: async () => {},
});

// ─── Provider ────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser]       = useState<User | null>(null);
  const [loading, setLoading] = useState(!!supabase);

  useEffect(() => {
    if (!supabase) return;

    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signIn = useCallback(async (email: string, password: string): Promise<string | null> => {
    if (!supabase) return null;
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return error ? localizeError(error.message) : null;
  }, []);

  const signUp = useCallback(async (email: string, password: string): Promise<string | null> => {
    if (!supabase) return null;
    const { error } = await supabase.auth.signUp({ email, password });
    return error ? localizeError(error.message) : null;
  }, []);

  const signOut = useCallback(async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, authEnabled: !!supabase, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useAuth() {
  return useContext(AuthContext);
}

// ─── Error localization ───────────────────────────────────────────────────────

function localizeError(msg: string): string {
  if (msg.includes('Invalid login credentials') || msg.includes('invalid_credentials'))
    return '邮箱或密码错误';
  if (msg.includes('Email not confirmed'))
    return '邮箱未验证，请查收注册邮件并点击确认链接';
  if (msg.includes('User already registered'))
    return '该邮箱已注册，请直接登录';
  if (msg.includes('Password should be at least'))
    return '密码至少 6 位';
  if (msg.includes('Unable to validate email'))
    return '邮箱格式不正确';
  if (msg.includes('rate limit') || msg.includes('too many'))
    return '请求过于频繁，请稍后再试';
  return msg;
}
