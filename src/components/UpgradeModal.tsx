import { useState } from 'react';
import {
  X, Check, Copy, CheckCheck, UserPlus, Sparkles, Crown, Building2,
  KeyRound, Loader2, AlertCircle, PartyPopper,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useSubscription } from '../context/SubscriptionContext';

interface Props {
  onClose: () => void;
}

const BIZ = {
  wechatId: 'wuyijian013390',
};

const PLANS = [
  {
    key: 'free' as const,
    icon: Sparkles,
    name: '探索版',
    price: '¥0',
    period: '永久免费',
    desc: '试用与轻度使用',
    accent: '#7e90b0',
    features: [
      '每月 3 小时转写配额',
      '基础 AI 反馈生成',
      '基础 Agent 对话',
    ],
  },
  {
    key: 'pro' as const,
    icon: Crown,
    name: '专业版',
    price: '¥199',
    period: '/月',
    subPrice: '¥1,788/年（省 ¥600）',
    desc: '个人教师高频使用',
    accent: '#4d7fff',
    highlight: true,
    badge: '最受欢迎',
    features: [
      '每月 50 小时转写配额',
      '无限 AI 反馈',
      '无限学生档案',
      '完整 Agent 模式',
      '自定义反馈 Prompt',
      '邮件优先支持',
    ],
  },
  {
    key: 'elite' as const,
    icon: Building2,
    name: '机构版',
    price: '¥599',
    period: '/月',
    subPrice: '¥5,388/年（省 ¥1,200）',
    desc: '学校 / 培训机构',
    accent: '#a371f7',
    features: [
      '每月 60 小时转写配额',
      '1-5 个教师账号',
      '团队管理后台',
      '专业版全部功能',
      '专属客服 + 电话支持',
    ],
  },
];

export function UpgradeModal({ onClose }: Props) {
  const { user, openAuthModal } = useAuth();
  const { plan: currentPlan, redeemCode } = useSubscription();
  const loggedIn = !!user;

  const [code, setCode]           = useState('');
  const [redeeming, setRedeeming] = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [success, setSuccess]     = useState<{ plan: string; expiresAt?: string } | null>(null);
  const [copied, setCopied]       = useState(false);

  const copyWechat = () => {
    navigator.clipboard.writeText(BIZ.wechatId).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    });
  };

  const handleRedeem = async () => {
    if (!code.trim()) return;
    if (!loggedIn) {
      openAuthModal('register');
      return;
    }
    setRedeeming(true);
    setError(null);
    const result = await redeemCode(code.trim());
    setRedeeming(false);
    if (result.ok) {
      setSuccess({ plan: result.plan!, expiresAt: result.expiresAt });
    } else {
      setError(result.error ?? '兑换失败，请稍后重试');
    }
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 350,
        background: 'rgba(0,0,0,0.78)', backdropFilter: 'blur(8px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: '100%', maxWidth: 880,
          background: 'var(--bg-s1)', border: '1px solid var(--border)',
          borderRadius: 22, overflow: 'hidden', maxHeight: '92vh', display: 'flex', flexDirection: 'column',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          padding: '20px 24px', borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-1)', marginBottom: 3 }}>
              升级方案
            </h2>
            <p style={{ fontSize: 12, color: 'var(--text-3)', margin: 0 }}>
              选择档位 → 加微信付款 → 收到激活码后回来兑换
            </p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)', padding: 6 }}>
            <X size={18} />
          </button>
        </div>

        <div className="scrollbar-thin" style={{ overflowY: 'auto', padding: 24 }}>

          {/* 兑换成功提示 */}
          {success && (
            <div style={{
              padding: '20px 22px', borderRadius: 14, marginBottom: 20,
              background: 'var(--green-dim)', border: '1px solid #1e4d27',
              display: 'flex', alignItems: 'center', gap: 14,
            }}>
              <PartyPopper size={26} style={{ color: 'var(--green)' }} />
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--green)', marginBottom: 3 }}>
                  兑换成功
                </p>
                <p style={{ fontSize: 12, color: 'var(--text-2)', margin: 0 }}>
                  已升级为 <strong>{success.plan === 'pro' ? '专业版' : '机构版'}</strong>
                  {success.expiresAt && ` · 有效期至 ${new Date(success.expiresAt).toLocaleDateString('zh-CN')}`}
                </p>
              </div>
              <button onClick={onClose} style={{
                fontSize: 12, fontWeight: 700, padding: '8px 16px', borderRadius: 9,
                background: 'var(--green)', color: '#fff', border: 'none', cursor: 'pointer',
              }}>开始使用</button>
            </div>
          )}

          {!success && (
            <>
              {/* 未登录提示 */}
              {!loggedIn && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '12px 14px', borderRadius: 12, marginBottom: 18,
                  background: 'var(--accent-dim)', border: '1px solid #2a4a7a',
                }}>
                  <UserPlus size={16} style={{ color: 'var(--accent)', flexShrink: 0 }} />
                  <p style={{ fontSize: 13, color: 'var(--text-2)', margin: 0, flex: 1 }}>
                    兑换激活码前需要先注册账号，订阅会绑定到您的账户。
                  </p>
                  <button
                    onClick={() => openAuthModal('register')}
                    style={{
                      fontSize: 12, fontWeight: 700, padding: '6px 14px', borderRadius: 8,
                      background: 'var(--accent)', color: '#fff', border: 'none', cursor: 'pointer',
                    }}
                  >立即注册</button>
                </div>
              )}

              {/* 三档对照 */}
              <div style={{
                display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                gap: 14, marginBottom: 26,
              }}>
                {PLANS.map(plan => {
                  const Icon = plan.icon;
                  const isCurrent = currentPlan === plan.key;
                  return (
                    <div
                      key={plan.key}
                      style={{
                        position: 'relative', padding: '22px 20px', borderRadius: 16,
                        background: plan.highlight ? 'linear-gradient(160deg,#1a2a4f,#0e1a38)' : 'var(--bg-s2)',
                        border: `${plan.highlight ? 2 : 1}px solid ${plan.highlight ? plan.accent : 'var(--border)'}`,
                        boxShadow: plan.highlight ? `0 0 28px ${plan.accent}30` : 'none',
                      }}
                    >
                      {plan.badge && (
                        <div style={{
                          position: 'absolute', top: -10, left: '50%', transform: 'translateX(-50%)',
                          fontSize: 10, padding: '3px 12px', borderRadius: 12, fontWeight: 700,
                          background: `linear-gradient(to right, ${plan.accent}, #7c4af8)`, color: '#fff',
                        }}>{plan.badge}</div>
                      )}

                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                        <div style={{
                          width: 30, height: 30, borderRadius: 8,
                          background: `${plan.accent}22`, border: `1px solid ${plan.accent}40`,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                          <Icon size={14} style={{ color: plan.accent }} />
                        </div>
                        <h3 style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-1)', margin: 0 }}>
                          {plan.name}
                        </h3>
                        {isCurrent && (
                          <span style={{
                            fontSize: 10, padding: '2px 8px', borderRadius: 10, fontWeight: 700,
                            background: 'var(--green-dim)', color: 'var(--green)', border: '1px solid #1e4d27',
                          }}>当前</span>
                        )}
                      </div>

                      <p style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 12 }}>{plan.desc}</p>

                      <div style={{ marginBottom: 14 }}>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                          <span style={{ fontSize: 30, fontWeight: 900, letterSpacing: -1, color: 'var(--text-1)' }}>
                            {plan.price}
                          </span>
                          <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{plan.period}</span>
                        </div>
                        {'subPrice' in plan && plan.subPrice && (
                          <p style={{ fontSize: 10, color: 'var(--text-3)', margin: '3px 0 0' }}>{plan.subPrice}</p>
                        )}
                      </div>

                      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {plan.features.map(f => (
                          <li key={f} style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: 12, color: 'var(--text-2)' }}>
                            <Check size={12} style={{ color: plan.accent, marginTop: 2, flexShrink: 0 }} /> {f}
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </div>

              {/* 兑换码 + 微信引导 */}
              <div style={{
                display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14,
              }}>
                {/* 1. 输入激活码 */}
                <div style={{
                  padding: '20px 22px', borderRadius: 14,
                  background: 'var(--bg-s2)', border: '1px solid var(--border)',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <KeyRound size={14} style={{ color: 'var(--accent)' }} />
                    <h4 style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-1)', margin: 0 }}>
                      已有激活码？立即兑换
                    </h4>
                  </div>
                  <p style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 12, lineHeight: 1.6 }}>
                    输入 12 位激活码，系统会自动升级订阅档位与有效期。
                  </p>

                  <input
                    type="text"
                    value={code}
                    onChange={e => { setCode(e.target.value.toUpperCase()); setError(null); }}
                    placeholder="XXXX-XXXX-XXXX"
                    spellCheck={false}
                    autoCapitalize="characters"
                    style={{
                      width: '100%', boxSizing: 'border-box',
                      padding: '10px 14px', borderRadius: 10, fontSize: 14, fontFamily: 'monospace',
                      letterSpacing: 1, textAlign: 'center',
                      background: 'var(--bg-s1)', border: '1px solid var(--border)',
                      color: 'var(--text-1)', outline: 'none', marginBottom: 10,
                    }}
                    onFocus={e => e.currentTarget.style.borderColor = 'var(--accent)'}
                    onBlur={e => e.currentTarget.style.borderColor = 'var(--border)'}
                    onKeyDown={e => { if (e.key === 'Enter') handleRedeem(); }}
                  />

                  {error && (
                    <div style={{
                      display: 'flex', alignItems: 'flex-start', gap: 6,
                      fontSize: 12, color: 'var(--red)',
                      background: 'var(--red-dim)', border: '1px solid #5a1e1e',
                      borderRadius: 8, padding: '8px 10px', marginBottom: 10, lineHeight: 1.5,
                    }}>
                      <AlertCircle size={12} style={{ marginTop: 2, flexShrink: 0 }} />
                      <span>{error}</span>
                    </div>
                  )}

                  <button
                    onClick={handleRedeem}
                    disabled={redeeming || !code.trim()}
                    style={{
                      width: '100%', padding: '10px 0', borderRadius: 9,
                      fontSize: 13, fontWeight: 700,
                      cursor: (redeeming || !code.trim()) ? 'not-allowed' : 'pointer',
                      background: 'var(--accent)', color: '#fff', border: 'none',
                      opacity: (redeeming || !code.trim()) ? 0.5 : 1,
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                    }}
                  >
                    {redeeming
                      ? <><Loader2 size={13} className="animate-spin" /> 兑换中…</>
                      : (loggedIn ? '立即兑换' : '注册并兑换')}
                  </button>
                </div>

                {/* 2. 还没激活码？引导加微信 */}
                <div style={{
                  padding: '20px 22px', borderRadius: 14,
                  background: 'var(--bg-s2)', border: '1px solid var(--border)',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="#07c160">
                      <path d="M8.5 11a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm7 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zM3.5 8C3.5 4.41 7.36 1.5 12 1.5S20.5 4.41 20.5 8c0 3.59-3.86 6.5-8.5 6.5-.78 0-1.54-.09-2.26-.25L7 16.5l.93-2.57C5.4 12.75 3.5 10.51 3.5 8z"/>
                    </svg>
                    <h4 style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-1)', margin: 0 }}>
                      还没激活码？加微信购买
                    </h4>
                  </div>
                  <p style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 12, lineHeight: 1.7 }}>
                    1. 添加微信 <strong style={{ color: 'var(--text-2)' }}>{BIZ.wechatId}</strong>
                    <br />
                    2. 备注 <strong style={{ color: 'var(--text-2)' }}>专业版 / 机构版</strong> + 您的注册邮箱
                    <br />
                    3. 完成付款后会收到 12 位激活码
                    <br />
                    4. 回到此弹窗左侧输入激活码完成升级
                  </p>

                  <button
                    onClick={copyWechat}
                    style={{
                      width: '100%', padding: '10px 0', borderRadius: 9, fontSize: 13, fontWeight: 700, cursor: 'pointer',
                      background: '#07c160', color: '#fff', border: 'none',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                    }}
                  >
                    {copied
                      ? <><CheckCheck size={13} /> 已复制微信号</>
                      : <><Copy size={13} /> 复制微信号 {BIZ.wechatId}</>}
                  </button>

                  <p style={{ fontSize: 10, color: 'var(--text-3)', margin: '10px 0 0', textAlign: 'center', lineHeight: 1.6 }}>
                    工作日内 24 小时发码 · 节假日略有延迟
                  </p>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
