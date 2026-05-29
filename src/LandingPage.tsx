import { useState, useEffect } from 'react';
import {
  Mic, FileAudio, Sparkles, Download, Check,
  ChevronRight, Zap, BookOpen, MessageSquare,
  Shield, LogIn, UserPlus, LogOut, User,
  Clock, Users,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from './context/AuthContext';
import { useSubscription } from './context/SubscriptionContext';

// ─── 商业配置 ────────────────────────────────────────────────────────────────
const BIZ = {
  githubReleases: 'https://github.com/wuyijian/teaching-workbench/releases/latest',
};

// 文案统一从 i18n 取，这里仅保留与图标 / 样式 / 行为相关的元数据
const PLAN_META = [
  { price: '¥0', period: '', action: 'app' as const },
  { price: '¥199', period: 'month' as const, action: 'pay' as const, highlight: true },
  { price: '¥599', period: 'month' as const, action: 'pay' as const },
];

const FEATURE_META = [
  { icon: Mic, color: '#4d7fff', bg: '#1a2a4f' },
  { icon: Zap, color: '#f59e0b', bg: '#3d2c0a' },
  { icon: Sparkles, color: '#10b981', bg: '#0d2e1e' },
];

const STEP_META = [
  { n: '01', icon: FileAudio },
  { n: '02', icon: Zap },
  { n: '03', icon: Sparkles },
  { n: '04', icon: MessageSquare },
];

const STAT_META = [
  { icon: Users },
  { icon: FileAudio },
  { icon: Clock },
  { icon: Zap },
];

interface LandingFeature { title: string; points: string[] }
interface LandingStep { title: string; desc: string }
interface LandingStat { value: string; label: string }
interface LandingDownloadOption { label: string; hint: string }
interface LandingPlan { name: string; desc: string; subPrice?: string; features: string[]; cta: string; badge?: string }

// ─── 样式辅助 ─────────────────────────────────────────────────────────────────
const C = {
  bg:           '#07080f',
  bgSection:    '#0b0d17',
  bgCard:       '#0e1220',
  bgCard2:      '#111520',
  border:       '#1c2236',
  borderBright: '#243048',
  accent:       '#4d7fff',
  accentDim:    '#162040',
  accentBorder: '#243360',
  text1:        '#eaf0fb',
  text2:        '#7e90b0',
  text3:        '#40506a',
  green:        '#22c55e',
  greenDim:     '#0f2e1a',
};

// ─── 共用 Section 标题 ───────────────────────────────────────────────────────
function SectionHeading({ tag, title, sub }: { tag?: string; title: string; sub?: string }) {
  return (
    <div style={{ textAlign: 'center', marginBottom: 56 }}>
      {tag && (
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700, letterSpacing: 1.2, textTransform: 'uppercase', color: C.accent, marginBottom: 14, padding: '4px 14px', borderRadius: 20, background: C.accentDim, border: `1px solid ${C.accentBorder}` }}>
          {tag}
        </div>
      )}
      <h2 style={{ fontSize: 'clamp(28px, 4vw, 40px)', fontWeight: 800, letterSpacing: -1, margin: '0 0 14px', color: C.text1 }}>{title}</h2>
      {sub && <p style={{ fontSize: 16, color: C.text2, margin: 0 }}>{sub}</p>}
    </div>
  );
}

// ─── Landing Page ─────────────────────────────────────────────────────────────
export function LandingPage() {
  const { t } = useTranslation();
  const { user, authEnabled, signOut, openAuthModal } = useAuth();
  const { openUpgradeModal } = useSubscription();

  const features = t('landing.features', { returnObjects: true }) as LandingFeature[];
  const steps = t('landing.steps', { returnObjects: true }) as LandingStep[];
  const stats = t('landing.stats', { returnObjects: true }) as LandingStat[];
  const downloadOptions = t('landing.downloadOptions', { returnObjects: true }) as LandingDownloadOption[];
  const plans = t('landing.plans', { returnObjects: true }) as LandingPlan[];

  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const fn = () => { setScrolled(window.scrollY > 40); };
    window.addEventListener('scroll', fn, { passive: true });
    return () => window.removeEventListener('scroll', fn);
  }, []);

  // 处理来自工作台的跳转参数（旧链接兼容）：?register=1 直接弹注册框，注册成功后进 /app
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('register') === '1') {
      try { sessionStorage.setItem('post-login-redirect', '/app'); } catch { /* */ }
      openAuthModal('register');
      window.history.replaceState({}, '', window.location.pathname + window.location.hash);
    }
  }, [openAuthModal]);

  // 进入工作台（探索版）：必须先登录
  // 未登录 → 设置回跳标记 + 弹注册框；登录成功后 AuthContext 会自动跳 /app
  // 已登录 → 直接整页跳到 /app
  const goToApp = () => {
    if (authEnabled && !user) {
      try { sessionStorage.setItem('post-login-redirect', '/app'); } catch { /* */ }
      openAuthModal('register');
      return;
    }
    window.location.href = '/app';
  };

  // 落地页内统一弹起登录/注册框：从这里发起的认证都视为"想用产品"，
  // 成功后由 AuthContext 自动跳 /app
  const beginAuth = (mode: 'login' | 'register') => {
    try { sessionStorage.setItem('post-login-redirect', '/app'); } catch { /* */ }
    openAuthModal(mode);
  };

  return (
    <div style={{ fontFamily: 'system-ui, -apple-system, "PingFang SC", "Helvetica Neue", sans-serif', background: C.bg, color: C.text1, lineHeight: 1.6 }}>

      {/* ── Navbar ─────────────────────────────────────────────────────────── */}
      <nav style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 200,
        height: 60, padding: '0 clamp(20px, 5vw, 48px)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: scrolled ? 'rgba(7,8,15,0.92)' : 'transparent',
        backdropFilter: scrolled ? 'blur(20px)' : 'none',
        borderBottom: scrolled ? `1px solid ${C.border}` : '1px solid transparent',
        transition: 'all 0.3s',
      }}>
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <div style={{ width: 30, height: 30, borderRadius: 8, background: 'linear-gradient(135deg, #4d7fff, #7c4af8)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <BookOpen size={14} color="#fff" />
          </div>
          <span style={{ fontWeight: 700, fontSize: 15, letterSpacing: -0.3, whiteSpace: 'nowrap' }}>{t('common.appName')}</span>
          <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 10, background: C.accentDim, color: C.accent, border: `1px solid ${C.accentBorder}`, fontWeight: 700, flexShrink: 0 }}>{t('landing.beta')}</span>
        </div>

        {/* Desktop nav links */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {[['#features', t('landing.navFeatures')], ['#steps', t('landing.navSteps')], ['#pricing', t('landing.navPricing')], ['#download', t('landing.navDownload')]].map(([href, label]) => (
            <a key={href} href={href} style={{ fontSize: 13, color: C.text2, textDecoration: 'none', padding: '6px 11px', borderRadius: 7, transition: 'color 0.15s' }}
              onMouseEnter={e => (e.currentTarget.style.color = C.text1)}
              onMouseLeave={e => (e.currentTarget.style.color = C.text2)}>
              {label}
            </a>
          ))}
          <div style={{ width: 1, height: 18, background: C.border, margin: '0 8px' }} />
          {authEnabled ? (
            user ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: C.text2, padding: '6px 10px', borderRadius: 8, background: C.bgCard, border: `1px solid ${C.border}` }}>
                  <User size={12} style={{ color: C.accent }} />
                  <span style={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.email}</span>
                </div>
                <button onClick={goToApp} style={{ fontSize: 13, padding: '7px 16px', borderRadius: 8, fontWeight: 600, cursor: 'pointer', background: C.accent, color: '#fff', border: 'none' }}>
                  {t('landing.enterWorkbench')}
                </button>
                <button onClick={signOut} title={t('landing.logout')} style={{ padding: '7px 8px', borderRadius: 8, cursor: 'pointer', background: 'transparent', color: C.text3, border: `1px solid ${C.border}` }}>
                  <LogOut size={13} />
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <button onClick={() => beginAuth('login')} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 13, padding: '7px 14px', borderRadius: 8, fontWeight: 500, cursor: 'pointer', background: 'transparent', color: C.text1, border: `1px solid ${C.border}`, whiteSpace: 'nowrap' }}>
                  <LogIn size={13} /> {t('common.login')}
                </button>
                <button onClick={() => beginAuth('register')} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 13, padding: '7px 14px', borderRadius: 8, fontWeight: 600, cursor: 'pointer', background: C.accent, color: '#fff', border: 'none', whiteSpace: 'nowrap' }}>
                  <UserPlus size={13} /> {t('common.register')}
                </button>
              </div>
            )
          ) : (
            <button onClick={goToApp} style={{ fontSize: 13, padding: '7px 16px', borderRadius: 8, fontWeight: 600, cursor: 'pointer', background: C.accent, color: '#fff', border: 'none', whiteSpace: 'nowrap' }}>
              {t('landing.enterWorkbenchArrow')}
            </button>
          )}
        </div>
      </nav>

      {/* ── Hero ────────────────────────────────────────────────────────────── */}
      <section style={{ paddingTop: 'clamp(100px, 14vw, 160px)', paddingBottom: 'clamp(60px, 8vw, 100px)', paddingLeft: 'clamp(20px, 5vw, 48px)', paddingRight: 'clamp(20px, 5vw, 48px)', textAlign: 'center', position: 'relative', overflow: 'hidden' }}>
        {/* Radial glow */}
        <div style={{ position: 'absolute', top: '20%', left: '50%', transform: 'translateX(-50%)', width: 700, height: 400, background: 'radial-gradient(ellipse, #4d7fff18 0%, transparent 70%)', pointerEvents: 'none' }} />

        <div style={{ maxWidth: 780, margin: '0 auto', position: 'relative' }}>
          {/* Badge */}
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '5px 16px', borderRadius: 20, background: C.accentDim, border: `1px solid ${C.accentBorder}`, color: '#7ba7ff', marginBottom: 32, fontWeight: 600 }}>
            <Sparkles size={11} /> {t('landing.heroBadge')}
          </div>

          <h1 style={{ fontSize: 'clamp(38px, 6vw, 64px)', fontWeight: 900, lineHeight: 1.1, marginBottom: 24, letterSpacing: -2, color: C.text1 }}>
            {t('landing.heroTitleLine1')}<br />
            <span style={{ background: 'linear-gradient(120deg, #4d7fff, #a371f7)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>{t('landing.heroTitleLine2')}</span>
          </h1>

          <p style={{ fontSize: 'clamp(15px, 2vw, 18px)', color: C.text2, lineHeight: 1.8, marginBottom: 44, maxWidth: 520, margin: '0 auto 44px' }}>
            {t('landing.heroSubtitleLine1')}<br />{t('landing.heroSubtitleLine2')}
          </p>

          {/* CTA buttons */}
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap', marginBottom: 56 }}>
            {authEnabled && !user ? (
              <>
                <button onClick={() => beginAuth('register')} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 15, padding: '13px 32px', borderRadius: 12, fontWeight: 700, cursor: 'pointer', background: C.accent, color: '#fff', border: 'none', boxShadow: `0 0 24px ${C.accent}40` }}>
                  <UserPlus size={16} /> {t('landing.freeRegister')}
                </button>
                <button onClick={() => beginAuth('login')} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 15, padding: '13px 32px', borderRadius: 12, fontWeight: 600, cursor: 'pointer', background: 'transparent', color: C.text1, border: `1px solid ${C.borderBright}` }}>
                  <LogIn size={15} /> {t('common.login')}
                </button>
              </>
            ) : (
              <button onClick={goToApp} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 15, padding: '13px 32px', borderRadius: 12, fontWeight: 700, cursor: 'pointer', background: C.accent, color: '#fff', border: 'none', boxShadow: `0 0 24px ${C.accent}40` }}>
                {user ? t('landing.enterWorkbench') : t('landing.freeStart')} <ChevronRight size={16} />
              </button>
            )}
            <a href="#download" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 15, padding: '13px 32px', borderRadius: 12, fontWeight: 600, background: 'transparent', color: C.text1, border: `1px solid ${C.borderBright}`, textDecoration: 'none' }}>
              <Download size={15} /> {t('landing.downloadDesktop')}
            </a>
          </div>

          {/* Stats */}
          <div style={{ display: 'flex', gap: 0, justifyContent: 'center', flexWrap: 'wrap', borderRadius: 14, background: C.bgCard, border: `1px solid ${C.border}`, overflow: 'hidden', maxWidth: 680, margin: '0 auto' }}>
            {STAT_META.map(({ icon: Icon }, i) => (
              <div key={i} style={{ flex: '1 1 140px', padding: '18px 12px', textAlign: 'center', borderRight: i < STAT_META.length - 1 ? `1px solid ${C.border}` : 'none' }}>
                <Icon size={15} style={{ color: C.accent, marginBottom: 6, display: 'block', margin: '0 auto 6px' }} />
                <div style={{ fontSize: 22, fontWeight: 800, color: C.text1, letterSpacing: -0.5 }}>{stats[i]?.value}</div>
                <div style={{ fontSize: 11, color: C.text3, marginTop: 2 }}>{stats[i]?.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Features ────────────────────────────────────────────────────────── */}
      <section id="features" style={{ padding: 'clamp(60px, 8vw, 96px) clamp(20px, 5vw, 48px)', background: C.bgSection }}>
        <div style={{ maxWidth: 1080, margin: '0 auto' }}>
          <SectionHeading tag={t('landing.featuresTag')} title={t('landing.featuresTitle')} sub={t('landing.featuresSub')} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(290px, 1fr))', gap: 18 }}>
            {FEATURE_META.map(({ icon: Icon, color, bg }, i) => (
              <div key={i} style={{ padding: '28px 26px', borderRadius: 18, background: C.bgCard, border: `1px solid ${C.border}`, transition: 'border-color 0.2s, transform 0.2s' }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = color + '40'; (e.currentTarget as HTMLElement).style.transform = 'translateY(-2px)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = C.border; (e.currentTarget as HTMLElement).style.transform = ''; }}>
                <div style={{ width: 46, height: 46, borderRadius: 12, background: bg, border: `1px solid ${color}30`, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 18 }}>
                  <Icon size={22} style={{ color }} />
                </div>
                <h3 style={{ fontSize: 17, fontWeight: 700, marginBottom: 14, color: C.text1 }}>{features[i]?.title}</h3>
                <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 9 }}>
                  {(features[i]?.points ?? []).map(p => (
                    <li key={p} style={{ display: 'flex', alignItems: 'flex-start', gap: 9, fontSize: 14, color: C.text2 }}>
                      <Check size={13} style={{ color: C.green, marginTop: 2, flexShrink: 0 }} /> {p}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Steps ────────────────────────────────────────────────────────────── */}
      <section id="steps" style={{ padding: 'clamp(60px, 8vw, 96px) clamp(20px, 5vw, 48px)', background: C.bg }}>
        <div style={{ maxWidth: 1080, margin: '0 auto' }}>
          <SectionHeading tag={t('landing.stepsTag')} title={t('landing.stepsTitle')} sub={t('landing.stepsSub')} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 24 }}>
            {STEP_META.map(({ n, icon: Icon }, idx) => (
              <div key={n} style={{ position: 'relative' }}>
                {idx < STEP_META.length - 1 && (
                  <div style={{ position: 'absolute', top: 22, left: 'calc(100% - 12px)', width: 24, height: 1, background: `linear-gradient(to right, ${C.accentBorder}, transparent)`, display: 'none' }} className="step-connector" />
                )}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
                  <div style={{ width: 44, height: 44, borderRadius: 12, background: C.accentDim, border: `1px solid ${C.accentBorder}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <Icon size={20} style={{ color: C.accent }} />
                  </div>
                  <span style={{ fontSize: 28, fontWeight: 900, color: C.border, letterSpacing: -1 }}>{n}</span>
                </div>
                <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 8, color: C.text1 }}>{steps[idx]?.title}</h3>
                <p style={{ fontSize: 13, color: C.text3, lineHeight: 1.7, margin: 0 }}>{steps[idx]?.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Pricing ─────────────────────────────────────────────────────────── */}
      <section id="pricing" style={{ padding: 'clamp(60px, 8vw, 96px) clamp(20px, 5vw, 48px)', background: C.bgSection }}>
        <div style={{ maxWidth: 1080, margin: '0 auto' }}>
          <SectionHeading tag={t('landing.pricingTag')} title={t('landing.pricingTitle')} sub={t('landing.pricingSub')} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(270px, 1fr))', gap: 18, alignItems: 'start' }}>
            {PLAN_META.map((meta, i) => {
              const plan = plans[i];
              return (
              <div key={i} style={{
                padding: '32px 28px', borderRadius: 20, position: 'relative',
                background: meta.highlight ? `linear-gradient(160deg, #1a2a4f, #0e1a38)` : C.bgCard,
                border: `${meta.highlight ? 2 : 1}px solid ${meta.highlight ? C.accent : C.border}`,
                boxShadow: meta.highlight ? `0 0 40px ${C.accent}18` : 'none',
              }}>
                {plan?.badge && (
                  <div style={{ position: 'absolute', top: -12, left: '50%', transform: 'translateX(-50%)', fontSize: 11, padding: '3px 14px', borderRadius: 20, fontWeight: 700, background: `linear-gradient(to right, ${C.accent}, #7c4af8)`, color: '#fff', whiteSpace: 'nowrap', boxShadow: `0 2px 8px ${C.accent}40` }}>
                    {plan.badge}
                  </div>
                )}
                <div style={{ marginBottom: 6 }}>
                  <h3 style={{ fontSize: 16, fontWeight: 700, color: C.text1, marginBottom: 4 }}>{plan?.name}</h3>
                  <p style={{ fontSize: 12, color: C.text3, margin: 0 }}>{plan?.desc}</p>
                </div>
                <div style={{ margin: '20px 0 24px' }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 3 }}>
                    <span style={{ fontSize: 44, fontWeight: 900, letterSpacing: -2, color: meta.highlight ? '#a8c8ff' : C.text1 }}>{meta.price}</span>
                    <span style={{ fontSize: 14, color: C.text3 }}>{meta.period === 'month' ? t('common.perMonth') : ''}</span>
                  </div>
                  {plan?.subPrice && (
                    <p style={{ fontSize: 11, color: C.text3, margin: '4px 0 0', opacity: 0.8 }}>{plan.subPrice}</p>
                  )}
                </div>
                <div style={{ height: 1, background: meta.highlight ? '#243360' : C.border, marginBottom: 20 }} />
                <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 28px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {(plan?.features ?? []).map(f => (
                    <li key={f} style={{ display: 'flex', alignItems: 'flex-start', gap: 9, fontSize: 14, color: meta.highlight ? '#a8c8ff' : C.text2 }}>
                      <Check size={13} style={{ color: C.green, marginTop: 3, flexShrink: 0 }} /> {f}
                    </li>
                  ))}
                </ul>
                <button
                  onClick={() => meta.action === 'app' ? goToApp() : openUpgradeModal()}
                  style={{
                    width: '100%', padding: '12px 0', borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: 'pointer',
                    background: meta.highlight ? C.accent : 'transparent',
                    color: meta.highlight ? '#fff' : C.text2,
                    border: meta.highlight ? 'none' : `1px solid ${C.borderBright}`,
                    transition: 'opacity 0.15s, transform 0.15s',
                    boxShadow: meta.highlight ? `0 4px 16px ${C.accent}30` : 'none',
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.opacity = '0.88'; (e.currentTarget as HTMLButtonElement).style.transform = 'scale(0.99)'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.opacity = '1'; (e.currentTarget as HTMLButtonElement).style.transform = ''; }}
                >{plan?.cta}</button>
              </div>
              );
            })}
          </div>
          <p style={{ textAlign: 'center', fontSize: 13, color: C.text3, marginTop: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            <Shield size={13} style={{ color: C.text3 }} />
            {t('landing.pricingNote')}
          </p>
        </div>
      </section>

      {/* ── Download ─────────────────────────────────────────────────────────── */}
      <section id="download" style={{ padding: 'clamp(60px, 8vw, 96px) clamp(20px, 5vw, 48px)', background: C.bg }}>
        <div style={{ maxWidth: 720, margin: '0 auto', textAlign: 'center' }}>
          <SectionHeading tag={t('landing.downloadTag')} title={t('landing.downloadTitle')} sub={t('landing.downloadSub')} />
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap', marginBottom: 18 }}>
            {downloadOptions.map(({ label, hint }) => (
              <a key={label} href={BIZ.githubReleases} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 10, fontSize: 14, padding: '12px 22px', borderRadius: 12, fontWeight: 500, background: C.bgCard, border: `1px solid ${C.border}`, color: C.text1, textDecoration: 'none', transition: 'border-color 0.2s' }}
                onMouseEnter={e => (e.currentTarget.style.borderColor = C.accent + '60')}
                onMouseLeave={e => (e.currentTarget.style.borderColor = C.border)}>
                <Download size={14} style={{ color: C.accent }} />
                <div style={{ textAlign: 'left' }}>
                  <div>{label}</div>
                  <div style={{ fontSize: 11, color: C.text3 }}>{hint}</div>
                </div>
              </a>
            ))}
          </div>
          <p style={{ fontSize: 13, color: C.text3 }}>
            {t('landing.downloadCtaPrefix')}
            <a href={BIZ.githubReleases} target="_blank" rel="noopener noreferrer" style={{ color: C.accent, textDecoration: 'none' }}>GitHub Releases</a>
            {t('landing.downloadCtaSuffix')}
          </p>
        </div>
      </section>

      {/* ── Footer ──────────────────────────────────────────────────────────── */}
      <footer style={{ padding: 'clamp(24px, 4vw, 40px) clamp(20px, 5vw, 48px)', borderTop: `1px solid ${C.border}`, background: C.bgSection }}>
        <div style={{ maxWidth: 1080, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 24, height: 24, borderRadius: 6, background: 'linear-gradient(135deg, #4d7fff, #7c4af8)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <BookOpen size={11} color="#fff" />
            </div>
            <span style={{ fontSize: 13, color: C.text3 }}>{t('landing.footerCopyright')}</span>
            <span style={{ fontSize: 13, color: C.text3, display: 'flex', alignItems: 'center', gap: 4 }}>
              <Shield size={11} /> {t('landing.footerLocalFirst')}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 20, alignItems: 'center' }}>
            <button onClick={goToApp} style={{ fontSize: 13, color: C.text3, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>{t('landing.enterWorkbench')}</button>
            <a href={BIZ.githubReleases} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, color: C.text3, textDecoration: 'none' }}>GitHub</a>
            {authEnabled && !user && (
              <button onClick={() => beginAuth('register')} style={{ fontSize: 13, color: C.accent, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>{t('landing.footerRegister')}</button>
            )}
          </div>
        </div>
      </footer>

      {/* AuthModal / UpgradeModal 已挂在 AuthProvider / SubscriptionProvider 内，
          通过 openAuthModal / openUpgradeModal 全局唤起 */}
    </div>
  );
}
