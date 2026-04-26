import {
  createContext, useContext, useState, useEffect, useCallback,
  useRef, type ReactNode,
} from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './AuthContext';

// ─── Plan 配置 ────────────────────────────────────────────────────────────────

export type SubscriptionPlan = 'free' | 'pro' | 'elite';

export const PLAN_CONFIG: Record<SubscriptionPlan, { label: string; quotaMinutes: number }> = {
  free:  { label: '探索版', quotaMinutes: 180  },   // 3 小时
  pro:   { label: '专业版', quotaMinutes: 1200 },   // 20 小时
  elite: { label: '机构版', quotaMinutes: 3600 },   // 60 小时
};

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SubscriptionState {
  plan:           SubscriptionPlan;
  quotaMinutes:   number;
  usedMinutes:    number;
  remainingMinutes: number;
  periodStart:    Date;
  expiresAt:      Date | null;
  loading:        boolean;
}

export interface SubscriptionContextValue extends SubscriptionState {
  /** 录写完成后调用，扣减配额。durationMinutes 可为小数。 */
  recordUsage:  (durationMinutes: number) => Promise<void>;
  /** 当前档位是否还有剩余配额（或 neededMinutes 以内） */
  hasQuota:     (neededMinutes?: number) => boolean;
  refresh:      () => Promise<void>;
}

// ─── 本地配额 key（未登录时使用 localStorage） ────────────────────────────────

const LOCAL_KEY = 'tw-free-quota';

interface LocalQuota { usedMinutes: number; periodStart: string }

function getLocalQuota(): LocalQuota {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return freshLocal();
    const q: LocalQuota = JSON.parse(raw);
    // 跨月重置
    const saved = new Date(q.periodStart);
    const now   = new Date();
    if (saved.getFullYear() !== now.getFullYear() || saved.getMonth() !== now.getMonth()) {
      return freshLocal();
    }
    return q;
  } catch { return freshLocal(); }
}

function freshLocal(): LocalQuota {
  const q: LocalQuota = { usedMinutes: 0, periodStart: startOfMonth().toISOString() };
  saveLocal(q);
  return q;
}

function saveLocal(q: LocalQuota) {
  try { localStorage.setItem(LOCAL_KEY, JSON.stringify(q)); } catch { /* */ }
}

function startOfMonth(): Date {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

// ─── Context ──────────────────────────────────────────────────────────────────

const defaultState: SubscriptionState = {
  plan: 'free', quotaMinutes: 180, usedMinutes: 0,
  remainingMinutes: 180, periodStart: startOfMonth(),
  expiresAt: null, loading: false,
};

const SubscriptionContext = createContext<SubscriptionContextValue>({
  ...defaultState,
  recordUsage: async () => {},
  hasQuota: () => true,
  refresh: async () => {},
});

// ─── Provider ─────────────────────────────────────────────────────────────────

export function SubscriptionProvider({ children }: { children: ReactNode }) {
  const { user, authEnabled } = useAuth();
  const [state, setState] = useState<SubscriptionState>({ ...defaultState, loading: authEnabled });
  const stateRef = useRef(state);
  stateRef.current = state;

  // ── 从 Supabase 加载订阅 ──────────────────────────────────────────────────
  const loadFromSupabase = useCallback(async (userId: string) => {
    if (!supabase) return;
    setState(s => ({ ...s, loading: true }));

    const { data, error } = await supabase
      .from('user_subscriptions')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (error || !data) {
      // 行不存在时，尝试插入（首次登录）
      if (error?.code === 'PGRST116') {
        await supabase.from('user_subscriptions').insert({ user_id: userId });
        setState(s => ({ ...s, ...defaultState, loading: false }));
      } else {
        setState(s => ({ ...s, loading: false }));
      }
      return;
    }

    const plan = (data.plan ?? 'free') as SubscriptionPlan;
    const cfg  = PLAN_CONFIG[plan] ?? PLAN_CONFIG.free;

    // 跨月重置（客户端判断，后端触发器亦可处理）
    const periodStart = new Date(data.period_start);
    const now = new Date();
    const isSameMonth =
      periodStart.getFullYear() === now.getFullYear() &&
      periodStart.getMonth()    === now.getMonth();

    let usedMinutes = Number(data.used_minutes ?? 0);
    if (!isSameMonth) {
      usedMinutes = 0;
      await supabase.from('user_subscriptions').update({
        used_minutes: 0,
        period_start: startOfMonth().toISOString(),
      }).eq('user_id', userId);
    }

    const quotaMinutes = cfg.quotaMinutes;
    setState({
      plan,
      quotaMinutes,
      usedMinutes,
      remainingMinutes: Math.max(0, quotaMinutes - usedMinutes),
      periodStart: isSameMonth ? periodStart : startOfMonth(),
      expiresAt: data.expires_at ? new Date(data.expires_at) : null,
      loading: false,
    });
  }, []);

  // ── 从 localStorage 加载（未登录免费用户） ────────────────────────────────
  const loadLocal = useCallback(() => {
    const q = getLocalQuota();
    const quota = PLAN_CONFIG.free.quotaMinutes;
    setState({
      plan: 'free',
      quotaMinutes: quota,
      usedMinutes: q.usedMinutes,
      remainingMinutes: Math.max(0, quota - q.usedMinutes),
      periodStart: new Date(q.periodStart),
      expiresAt: null,
      loading: false,
    });
  }, []);

  const refresh = useCallback(async () => {
    if (user) await loadFromSupabase(user.id);
    else loadLocal();
  }, [user, loadFromSupabase, loadLocal]);

  useEffect(() => {
    if (!authEnabled) {
      // Electron / 无 Supabase：不限配额
      setState({ ...defaultState, quotaMinutes: Infinity, remainingMinutes: Infinity, loading: false });
      return;
    }
    if (user) loadFromSupabase(user.id);
    else loadLocal();
  }, [user, authEnabled, loadFromSupabase, loadLocal]);

  // ── 扣减配额 ──────────────────────────────────────────────────────────────
  const recordUsage = useCallback(async (durationMinutes: number) => {
    const mins = Math.ceil(durationMinutes);
    if (mins <= 0) return;

    if (user && supabase) {
      // 直接 RPC 累加，避免并发覆写
      const { data } = await supabase
        .from('user_subscriptions')
        .select('used_minutes')
        .eq('user_id', user.id)
        .single();
      const newUsed = Number(data?.used_minutes ?? 0) + mins;
      await supabase.from('user_subscriptions')
        .update({ used_minutes: newUsed })
        .eq('user_id', user.id);
      setState(s => {
        const usedMinutes = s.usedMinutes + mins;
        return { ...s, usedMinutes, remainingMinutes: Math.max(0, s.quotaMinutes - usedMinutes) };
      });
    } else {
      // 本地计数
      const q = getLocalQuota();
      q.usedMinutes += mins;
      saveLocal(q);
      setState(s => {
        const usedMinutes = s.usedMinutes + mins;
        return { ...s, usedMinutes, remainingMinutes: Math.max(0, s.quotaMinutes - usedMinutes) };
      });
    }
  }, [user]);

  const hasQuota = useCallback((neededMinutes = 1) => {
    const { remainingMinutes, quotaMinutes } = stateRef.current;
    if (!isFinite(quotaMinutes)) return true; // Electron 无限制
    return remainingMinutes >= neededMinutes;
  }, []);

  return (
    <SubscriptionContext.Provider value={{ ...state, recordUsage, hasQuota, refresh }}>
      {children}
    </SubscriptionContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useSubscription() {
  return useContext(SubscriptionContext);
}
