import {
  createContext, useContext, useState, useEffect, useCallback,
  useRef, type ReactNode,
} from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './AuthContext';
import { UpgradeModal } from '../components/UpgradeModal';

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

export type GateAction = 'transcribe' | 'feedback' | 'agent' | 'archive';
export type GateReason = 'no-auth' | 'no-quota';

export interface SubscriptionContextValue extends SubscriptionState {
  /** 录写完成后调用，扣减配额。durationMinutes 可为小数。 */
  recordUsage:  (durationMinutes: number) => Promise<void>;
  /** 当前档位是否还有剩余配额（或 neededMinutes 以内） */
  hasQuota:     (neededMinutes?: number) => boolean;
  refresh:      () => Promise<void>;
  /** 兑换激活码：成功 → 自动刷新订阅；失败返回 error 文案 */
  redeemCode:   (code: string) => Promise<{ ok: boolean; plan?: string; expiresAt?: string; error?: string }>;
  /** 打开 / 关闭升级弹窗 */
  openUpgradeModal:  () => void;
  closeUpgradeModal: () => void;
  /**
   * 守门：检查当前用户能否执行某动作。
   * - 未登录 → 弹注册 modal，return { ok: false, reason: 'no-auth' }
   * - 转写额度不足 → 弹升级 modal，return { ok: false, reason: 'no-quota' }
   * - 通过 → { ok: true }
   * 上层可根据 reason 做兜底处理（提示文案）。
   */
  requireAccess: (action: GateAction, neededMinutes?: number) => { ok: boolean; reason?: GateReason };
}

// ─── 本地配额 key（未登录时使用 localStorage） ────────────────────────────────

const LOCAL_KEY = 'tw-free-quota';

interface LocalQuota { usedMinutes: number; periodStart: string }

function getLocalQuota(): LocalQuota {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return freshLocal();
    const q: LocalQuota = JSON.parse(raw);
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
  redeemCode: async () => ({ ok: false, error: 'Subscription provider not mounted' }),
  openUpgradeModal: () => {},
  closeUpgradeModal: () => {},
  requireAccess: () => ({ ok: true }),
});

// ─── Provider ─────────────────────────────────────────────────────────────────

export function SubscriptionProvider({ children }: { children: ReactNode }) {
  const { user, authEnabled, openAuthModal } = useAuth();
  const [state, setState] = useState<SubscriptionState>({ ...defaultState, loading: authEnabled });
  const stateRef = useRef(state);
  stateRef.current = state;
  const [upgradeOpen, setUpgradeOpen] = useState(false);

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

    // 如果 expires_at 已过期，回退到 free
    let effectivePlan: SubscriptionPlan = plan;
    let effectiveQuota = cfg.quotaMinutes;
    if (data.expires_at) {
      const exp = new Date(data.expires_at);
      if (exp < now && plan !== 'free') {
        effectivePlan = 'free';
        effectiveQuota = PLAN_CONFIG.free.quotaMinutes;
      }
    }
    // 数据库 quota_minutes 优先（激活码可能定制额度）
    if (data.quota_minutes && Number(data.quota_minutes) > 0 && effectivePlan === plan) {
      effectiveQuota = Number(data.quota_minutes);
    }

    setState({
      plan: effectivePlan,
      quotaMinutes: effectiveQuota,
      usedMinutes,
      remainingMinutes: Math.max(0, effectiveQuota - usedMinutes),
      periodStart: isSameMonth ? periodStart : startOfMonth(),
      expiresAt: data.expires_at ? new Date(data.expires_at) : null,
      loading: false,
    });
  }, []);

  // ── 从 localStorage 加载（未登录） ─────────────────────────────────────────
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
      setState({ ...defaultState, quotaMinutes: Infinity, remainingMinutes: Infinity, loading: false });
      return;
    }
    if (user) loadFromSupabase(user.id);
    else loadLocal();
  }, [user, authEnabled, loadFromSupabase, loadLocal]);

  // ── 扣减配额 ──────────────────────────────────────────────────────────────
  // 已登录用户：走 SECURITY DEFINER RPC consume_quota（用户无法直接 UPDATE 表）
  // 未登录用户：本地 localStorage（仅 free 档体验，无安全要求）
  const recordUsage = useCallback(async (durationMinutes: number) => {
    const mins = Math.ceil(durationMinutes);
    if (mins <= 0) return;

    if (user && supabase) {
      const { data, error } = await supabase.rpc('consume_quota', { p_minutes: mins });
      if (error) {
        console.warn('[SubscriptionContext] consume_quota RPC failed:', error.message);
        return;
      }
      type ConsumeResp = { used_minutes: number; quota_minutes: number };
      const d = data as ConsumeResp | null;
      if (d) {
        setState(s => ({
          ...s,
          usedMinutes:      d.used_minutes,
          quotaMinutes:     d.quota_minutes,
          remainingMinutes: Math.max(0, d.quota_minutes - d.used_minutes),
        }));
      }
    } else {
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
    if (!isFinite(quotaMinutes)) return true;
    return remainingMinutes >= neededMinutes;
  }, []);

  // ── 兑换激活码 ────────────────────────────────────────────────────────────
  const redeemCode = useCallback(async (code: string) => {
    if (!supabase) return { ok: false, error: '激活码功能需要后端支持，未配置' };
    if (!user)     return { ok: false, error: '请先登录或注册' };

    const { data, error } = await supabase.rpc('redeem_code', { p_code: code });

    if (error) {
      const msg = error.message ?? '';
      if (msg.includes('NOT_LOGGED_IN'))         return { ok: false, error: '请先登录或注册' };
      if (msg.includes('CODE_NOT_FOUND'))        return { ok: false, error: '激活码不存在，请检查输入' };
      if (msg.includes('CODE_ALREADY_REDEEMED')) return { ok: false, error: '该激活码已被使用过了' };
      if (msg.includes('CODE_EXPIRED'))          return { ok: false, error: '该激活码已过期，请联系客服' };
      return { ok: false, error: msg || '兑换失败' };
    }

    // 成功 → 刷新订阅状态
    await loadFromSupabase(user.id);
    type RedeemResp = { plan: string; expires_at?: string };
    const d = data as RedeemResp | null;
    return {
      ok: true,
      plan: d?.plan,
      expiresAt: d?.expires_at,
    };
  }, [user, loadFromSupabase]);

  const openUpgradeModal  = useCallback(() => setUpgradeOpen(true), []);
  const closeUpgradeModal = useCallback(() => setUpgradeOpen(false), []);

  // ── 守门 ──────────────────────────────────────────────────────────────────
  const requireAccess = useCallback((action: GateAction, neededMinutes = 1) => {
    // Electron / 无 Auth 时全部放行
    if (!authEnabled) return { ok: true };

    // 未登录 → 弹注册（所有写操作都需要登录）
    if (!user) {
      openAuthModal('register');
      return { ok: false, reason: 'no-auth' as const };
    }

    // 转写动作要校验配额；其它动作（feedback/agent/archive）目前只确保已登录
    if (action === 'transcribe') {
      const { remainingMinutes, quotaMinutes } = stateRef.current;
      if (isFinite(quotaMinutes) && remainingMinutes < neededMinutes) {
        setUpgradeOpen(true);
        return { ok: false, reason: 'no-quota' as const };
      }
    }
    return { ok: true };
  }, [authEnabled, user, openAuthModal]);

  return (
    <SubscriptionContext.Provider value={{
      ...state,
      recordUsage, hasQuota, refresh,
      redeemCode,
      openUpgradeModal, closeUpgradeModal,
      requireAccess,
    }}>
      {children}
      {upgradeOpen && <UpgradeModal onClose={closeUpgradeModal} />}
    </SubscriptionContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useSubscription() {
  return useContext(SubscriptionContext);
}
