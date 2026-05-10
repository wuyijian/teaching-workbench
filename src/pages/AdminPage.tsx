/**
 * 管理员大盘 —— 渲染路径：/admin
 *
 * 业务指标：从 Supabase get_admin_stats() RPC 获取
 * 流量指标：链接到同域自托管的 Umami（/umami/）
 *
 * 访问控制：仅 user.email === VITE_ADMIN_EMAIL 的用户可见
 */

import { useState, useEffect, useCallback } from 'react';
import {
  RefreshCw, Users, TrendingUp, Clock,
  BarChart2, ExternalLink, Shield, Home,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';

// ─── Types ───────────────────────────────────────────────────────────────────

interface AdminStats {
  total_users: number;
  users_today: number;
  users_week: number;
  users_month: number;
  plan_free: number;
  plan_pro: number;
  plan_elite: number;
  total_used_minutes: number;
  active_users_month: number;
  generated_at: string;
}

// ─── Access control ───────────────────────────────────────────────────────────

const ADMIN_EMAIL = import.meta.env.VITE_ADMIN_EMAIL as string | undefined;

// ─── Main component ───────────────────────────────────────────────────────────

export function AdminPage() {
  const { user } = useAuth();
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isAdmin = Boolean(ADMIN_EMAIL && user?.email === ADMIN_EMAIL);

  const fetchStats = useCallback(async () => {
    if (!supabase) { setError('Supabase 未配置'); return; }
    setLoading(true);
    setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc('get_admin_stats');
      if (rpcError) throw rpcError;
      setStats(data as AdminStats);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAdmin) fetchStats();
  }, [isAdmin, fetchStats]);

  // ── Guard ─────────────────────────────────────────────────────────────────

  if (!user || !isAdmin) {
    return (
      <div style={styles.guard}>
        <Shield size={28} color="#334155" />
        <p style={{ color: '#64748b', margin: '8px 0 0', fontSize: 14 }}>
          {!user ? '请先登录' : '无权访问此页面'}
        </p>
        <a href="/" style={{ marginTop: 12, fontSize: 13, color: '#4d7fff', textDecoration: 'none' }}>
          ← 返回首页
        </a>
      </div>
    );
  }

  // ── Derived numbers ───────────────────────────────────────────────────────

  const totalSubs = (stats?.plan_free ?? 0) + (stats?.plan_pro ?? 0) + (stats?.plan_elite ?? 0);
  const totalPaid = (stats?.plan_pro ?? 0) + (stats?.plan_elite ?? 0);
  const convRate  = totalSubs > 0 ? ((totalPaid / totalSubs) * 100).toFixed(1) : '0';

  return (
    <div style={styles.root}>
      {/* ── Header ── */}
      <div style={styles.header}>
        <div>
          <div style={styles.breadcrumb}>
            <a href="/" style={{ color: '#475569', display: 'flex' }}><Home size={13} /></a>
            <span style={{ color: '#334155' }}>/</span>
            <span style={{ color: '#94a3b8', fontSize: 13 }}>管理大盘</span>
          </div>
          <p style={{ margin: 0, fontSize: 12, color: '#475569', marginTop: 4 }}>
            {stats
              ? `${new Date(stats.generated_at).toLocaleString('zh-CN')} 更新`
              : loading ? '加载中…' : '—'}
          </p>
        </div>
        <button onClick={fetchStats} disabled={loading} style={styles.refreshBtn}>
          <RefreshCw size={13} style={{ animation: loading ? 'spin 0.7s linear infinite' : 'none' }} />
          刷新
        </button>
      </div>

      {/* ── Error ── */}
      {error && (
        <div style={styles.errorBox}>{error}</div>
      )}

      {/* ── Section: 用户注册 ── */}
      <SectionHeader icon={<Users size={13} />} title="用户注册" />
      <div style={{ ...styles.grid4, marginBottom: 36 }}>
        <StatCard value={stats?.total_users} label="累计注册" accent />
        <StatCard value={stats?.users_month} label="本月新增" />
        <StatCard value={stats?.users_week}  label="本周新增" />
        <StatCard value={stats?.users_today} label="今日新增" />
      </div>

      {/* ── Section: 计划分布 ── */}
      <SectionHeader icon={<TrendingUp size={13} />} title="计划分布" />
      <PlanBar
        free={stats?.plan_free ?? 0}
        pro={stats?.plan_pro ?? 0}
        elite={stats?.plan_elite ?? 0}
        total={totalSubs}
      />
      <div style={{ display: 'flex', gap: 20, marginTop: 12 }}>
        <PlanBadge label="探索版" count={stats?.plan_free ?? 0}  total={totalSubs} color="#334155" />
        <PlanBadge label="专业版" count={stats?.plan_pro ?? 0}   total={totalSubs} color="#4d7fff" />
        <PlanBadge label="机构版" count={stats?.plan_elite ?? 0} total={totalSubs} color="#a78bfa" />
      </div>
      <p style={{ margin: '10px 0 36px', fontSize: 12, color: '#475569' }}>
        付费用户 <strong style={{ color: '#94a3b8' }}>{totalPaid}</strong> 人
        {' · 付费转化率 '}
        <strong style={{ color: '#94a3b8' }}>{convRate}%</strong>
      </p>

      {/* ── Section: 转写用量 ── */}
      <SectionHeader icon={<Clock size={13} />} title="转写用量" />
      <div style={{ ...styles.grid2, marginBottom: 36 }}>
        <StatCard
          value={stats?.total_used_minutes != null
            ? stats.total_used_minutes.toLocaleString()
            : undefined}
          label="累计转写（分钟）"
          sub={stats ? `≈ ${(stats.total_used_minutes / 60).toFixed(1)} 小时` : undefined}
        />
        <StatCard value={stats?.active_users_month} label="有转写记录的用户" />
      </div>

      {/* ── Section: 流量大盘 ── */}
      <SectionHeader icon={<BarChart2 size={13} />} title="流量大盘" />
      <div style={styles.umamiCard}>
        <p style={{ margin: '0 0 14px', fontSize: 13, color: '#64748b', lineHeight: 1.6 }}>
          Umami Cloud：实时在线人数 · PV · UV · 来源渠道 · 设备分布
        </p>
        <a href="https://cloud.umami.is" target="_blank" rel="noopener noreferrer" style={styles.umamiLink}>
          <ExternalLink size={12} />
          打开 Umami Cloud 控制台
        </a>
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        * { box-sizing: border-box; }
      `}</style>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionHeader({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12,
      fontSize: 11, fontWeight: 600, letterSpacing: '0.06em',
      textTransform: 'uppercase', color: '#64748b',
    }}>
      {icon}
      {title}
    </div>
  );
}

function StatCard({
  value, label, sub, accent,
}: {
  value?: number | string | null;
  label: string;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div style={{
      padding: '16px 18px', borderRadius: 10,
      border: '1px solid #1e293b', background: '#0d1117',
    }}>
      <div style={{
        fontSize: 26, fontWeight: 700, marginBottom: 2, letterSpacing: '-0.02em',
        fontVariantNumeric: 'tabular-nums',
        color: accent ? '#4d7fff' : '#f1f5f9',
      }}>
        {value == null ? '—' : typeof value === 'number' ? value.toLocaleString() : value}
      </div>
      <div style={{ fontSize: 12, color: '#64748b' }}>{label}</div>
      {sub && <div style={{ fontSize: 11, color: '#475569', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function PlanBar({ free, pro, elite, total }: {
  free: number; pro: number; elite: number; total: number;
}) {
  if (total === 0) {
    return <div style={{ height: 6, borderRadius: 3, background: '#1e293b' }} />;
  }
  const pct = (n: number) => `${(n / total) * 100}%`;
  return (
    <div style={{ display: 'flex', height: 6, borderRadius: 3, overflow: 'hidden', background: '#1e293b' }}>
      {free  > 0 && <div style={{ width: pct(free),  background: '#334155', transition: 'width 0.5s ease' }} />}
      {pro   > 0 && <div style={{ width: pct(pro),   background: '#4d7fff', transition: 'width 0.5s ease' }} />}
      {elite > 0 && <div style={{ width: pct(elite), background: '#a78bfa', transition: 'width 0.5s ease' }} />}
    </div>
  );
}

function PlanBadge({ label, count, total, color }: {
  label: string; count: number; total: number; color: string;
}) {
  const pct = total > 0 ? `${((count / total) * 100).toFixed(0)}%` : '0%';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
      <div style={{ width: 8, height: 8, borderRadius: 2, background: color, flexShrink: 0 }} />
      <span style={{ color: '#64748b' }}>{label}</span>
      <span style={{ color: '#e2e8f0', fontWeight: 500 }}>{count}</span>
      <span style={{ color: '#475569', fontSize: 11 }}>({pct})</span>
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = {
  root: {
    minHeight: '100vh',
    background: '#07080f',
    color: '#e2e8f0',
    padding: '32px 24px',
    maxWidth: 860,
    margin: '0 auto',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  } satisfies React.CSSProperties,
  guard: {
    minHeight: '100vh',
    background: '#07080f',
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 0,
  } satisfies React.CSSProperties,
  header: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 36,
  } satisfies React.CSSProperties,
  breadcrumb: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  } satisfies React.CSSProperties,
  refreshBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '7px 14px',
    borderRadius: 8,
    border: '1px solid #1e293b',
    background: 'transparent',
    color: '#64748b',
    fontSize: 13,
    cursor: 'pointer',
  } satisfies React.CSSProperties,
  errorBox: {
    padding: '12px 16px',
    borderRadius: 8,
    background: '#1c0a0a',
    border: '1px solid #450a0a',
    color: '#fca5a5',
    fontSize: 13,
    marginBottom: 28,
  } satisfies React.CSSProperties,
  grid4: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: 12,
  } satisfies React.CSSProperties,
  grid2: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 12,
  } satisfies React.CSSProperties,
  umamiCard: {
    padding: '20px',
    borderRadius: 10,
    border: '1px solid #1e293b',
    background: '#0d1117',
    marginBottom: 36,
  } satisfies React.CSSProperties,
  umamiLink: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '8px 14px',
    borderRadius: 8,
    border: '1px solid #1e293b',
    background: '#0f172a',
    color: '#94a3b8',
    fontSize: 13,
    textDecoration: 'none',
  } satisfies React.CSSProperties,
};
