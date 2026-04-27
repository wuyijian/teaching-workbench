import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { AuthModal } from '../components/AuthModal';

// ─── Types ───────────────────────────────────────────────────────────────────

export type AuthModalMode = 'login' | 'register';

export interface AuthContextValue {
  user: User | null;
  loading: boolean;
  /** Supabase 未配置时为 false（Electron 桌面端） */
  authEnabled: boolean;
  signIn: (email: string, password: string) => Promise<string | null>;
  /** 返回 null 表示成功；返回 { needsConfirm: true } 表示需验证邮件 */
  signUp: (email: string, password: string) => Promise<string | { needsConfirm: true } | null>;
  signOut: () => Promise<void>;
  /** 全局打开登录/注册弹窗。authEnabled=false 时自动 no-op */
  openAuthModal: (mode?: AuthModalMode) => void;
  closeAuthModal: () => void;
}

// ─── Context ─────────────────────────────────────────────────────────────────

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: false,
  authEnabled: false,
  signIn: async () => null,
  signUp: async () => null,
  signOut: async () => {},
  openAuthModal: () => {},
  closeAuthModal: () => {},
});

// ─── Provider ────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser]       = useState<User | null>(null);
  const [loading, setLoading] = useState(!!supabase);
  const [authModalMode, setAuthModalMode] = useState<AuthModalMode | null>(null);

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

  const signUp = useCallback(async (email: string, password: string): Promise<string | { needsConfirm: true } | null> => {
    if (!supabase) return null;
    // 邮件确认后用户回跳的目的页：当前域 + /app（直接进工作台，跳过营销页）
    // 不传这个会回落到 Supabase Dashboard 里 Site URL，dev/prod 之间易踩坑
    const emailRedirectTo =
      typeof window !== 'undefined' ? `${window.location.origin}/app` : undefined;
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo },
    });
    if (error) return localizeError(error.message);
    const needsConfirm = !data.session && (data.user?.identities?.length ?? 0) > 0;
    return needsConfirm ? { needsConfirm: true } : null;
  }, []);

  const signOut = useCallback(async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
    // 登出后强制回到落地页：避免 main.tsx 的登录守卫立刻又弹一次登录框
    if (typeof window !== 'undefined' && window.location.pathname.startsWith('/app')) {
      window.location.href = '/';
    }
  }, []);

  const openAuthModal = useCallback((mode: AuthModalMode = 'login') => {
    if (!supabase) return; // Electron / 无 Supabase 时无意义
    setAuthModalMode(mode);
  }, []);

  const closeAuthModal = useCallback(() => setAuthModalMode(null), []);

  return (
    <AuthContext.Provider value={{
      user, loading,
      authEnabled: !!supabase,
      signIn, signUp, signOut,
      openAuthModal, closeAuthModal,
    }}>
      {children}
      {authModalMode && (
        <AuthModal
          initialMode={authModalMode}
          onClose={closeAuthModal}
          onSuccess={() => {
            closeAuthModal();
            // 登录前如果有挂起的 "想去 /app" 意图（被 LoginGate 或落地页 CTA 设置），现在跳过去
            try {
              const redirect = sessionStorage.getItem('post-login-redirect');
              if (redirect) {
                sessionStorage.removeItem('post-login-redirect');
                window.location.href = redirect;
              }
            } catch { /* sessionStorage 被禁用时无害 */ }
          }}
        />
      )}
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
