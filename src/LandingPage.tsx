import { useState, useEffect } from 'react';
import {
  Mic, FileAudio, Sparkles, Download, Check, X,
  ChevronRight, Zap, BookOpen, MessageSquare,
  Shield, Copy, CheckCheck, LogIn, UserPlus, LogOut, User,
  Clock, Users,
} from 'lucide-react';
import { useAuth } from './context/AuthContext';
import { AuthModal } from './components/AuthModal';

type AuthModalMode = 'login' | 'register' | null;

// ─── 商业配置 ────────────────────────────────────────────────────────────────
const BIZ = {
  wechatId:       'wuyijian',
  wechatQR:       '',
  githubReleases: 'https://github.com/wuyijian/teaching-workbench/releases/latest',
};

const PLANS = [
  {
    name: '免费版', price: '¥0', period: '', desc: '立即体验核心功能',
    features: ['每月 5 次音频转写', '每月 10 次 AI 反馈', 'Web 端使用', '基础 Markdown 导出'],
    cta: '免费使用', action: 'app' as const,
  },
  {
    name: '教师专业版', price: '¥29', period: '/月', desc: '适合个人教师日常使用',
    features: ['无限次音频转写', '无限次 AI 反馈生成', 'macOS & Windows 桌面端', '2 小时以上长音频', '现场麦克风录音', '补充信息辅助生成'],
    cta: '立即购买', action: 'pay' as const, highlight: true, badge: '最受欢迎',
  },
  {
    name: '学校机构版', price: '¥99', period: '/月', desc: '适合学校、教培机构',
    features: ['最多 20 位教师账号', '管理员控制台', '包含专业版全部功能', '合规报告 & 正规发票', '专属技术支持'],
    cta: '联系购买', action: 'pay' as const,
  },
];

const FEATURES = [
  {
    icon: Mic, color: '#4d7fff', bg: '#1a2a4f',
    title: '灵活音频输入',
    points: ['现场麦克风录音', '上传文件（拖拽 / 点击 / 粘贴）', 'MP3 · WAV · M4A · FLAC 全支持', '最长 5 小时音频'],
  },
  {
    icon: Zap, color: '#f59e0b', bg: '#3d2c0a',
    title: '高精度转写',
    points: ['讯飞大模型教育领域优化', '支持 202 种方言', '多任务队列，互不干扰', '转写结果带时间戳'],
  },
  {
    icon: Sparkles, color: '#10b981', bg: '#0d2e1e',
    title: 'AI 课堂反馈',
    points: ['约 200 字标准格式反馈', '支持课前检测等补充信息', '追问修改，灵活调整', '一键复制 / 导出 Markdown'],
  },
];

const STEPS = [
  { n: '01', title: '上传或录制音频', desc: '课后将录音文件拖入工作台，或直接在应用内录制课堂音频。', icon: FileAudio },
  { n: '02', title: 'AI 精准转写', desc: '讯飞大模型自动转为带时间戳文字，支持 202 种方言，教育领域深度优化。', icon: Zap },
  { n: '03', title: '生成课堂反馈', desc: '选中学生任务，一键生成标准格式家长反馈，支持追问修改。', icon: Sparkles },
  { n: '04', title: '发送给家长', desc: '直接复制文本发送家校群，或导出为 Markdown 文件存档留证。', icon: MessageSquare },
];

const STATS = [
  { icon: Users, value: '500+', label: '在用教师' },
  { icon: FileAudio, value: '10,000+', label: '已处理课时' },
  { icon: Clock, value: '5 分钟', label: '平均完成一份反馈' },
  { icon: Zap, value: '98%', label: '转写准确率' },
];

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
  const { user, authEnabled, signOut } = useAuth();

  const [scrolled, setScrolled]   = useState(false);
  const [payModal, setPayModal]   = useState<string | null>(null);
  const [authModal, setAuthModal] = useState<AuthModalMode>(null);
  const [copied, setCopied]       = useState(false);

  useEffect(() => {
    const fn = () => { setScrolled(window.scrollY > 40); };
    window.addEventListener('scroll', fn, { passive: true });
    return () => window.removeEventListener('scroll', fn);
  }, []);

  const goToApp = () => { window.location.href = '/app'; };
  const copyWechat = () => {
    navigator.clipboard.writeText(BIZ.wechatId).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    });
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
          <span style={{ fontWeight: 700, fontSize: 15, letterSpacing: -0.3, whiteSpace: 'nowrap' }}>语文教学工作台</span>
          <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 10, background: C.accentDim, color: C.accent, border: `1px solid ${C.accentBorder}`, fontWeight: 700, flexShrink: 0 }}>Beta</span>
        </div>

        {/* Desktop nav links */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {[['#features', '功能'], ['#steps', '流程'], ['#pricing', '定价'], ['#download', '下载']].map(([href, label]) => (
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
                  进入工作台
                </button>
                <button onClick={signOut} title="退出" style={{ padding: '7px 8px', borderRadius: 8, cursor: 'pointer', background: 'transparent', color: C.text3, border: `1px solid ${C.border}` }}>
                  <LogOut size={13} />
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <button onClick={() => setAuthModal('login')} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 13, padding: '7px 14px', borderRadius: 8, fontWeight: 500, cursor: 'pointer', background: 'transparent', color: C.text1, border: `1px solid ${C.border}`, whiteSpace: 'nowrap' }}>
                  <LogIn size={13} /> 登录
                </button>
                <button onClick={() => setAuthModal('register')} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 13, padding: '7px 14px', borderRadius: 8, fontWeight: 600, cursor: 'pointer', background: C.accent, color: '#fff', border: 'none', whiteSpace: 'nowrap' }}>
                  <UserPlus size={13} /> 注册
                </button>
              </div>
            )
          ) : (
            <button onClick={goToApp} style={{ fontSize: 13, padding: '7px 16px', borderRadius: 8, fontWeight: 600, cursor: 'pointer', background: C.accent, color: '#fff', border: 'none', whiteSpace: 'nowrap' }}>
              进入工作台 →
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
            <Sparkles size={11} /> 专为中学语文教师打造
          </div>

          <h1 style={{ fontSize: 'clamp(38px, 6vw, 64px)', fontWeight: 900, lineHeight: 1.1, marginBottom: 24, letterSpacing: -2, color: C.text1 }}>
            课后 5 分钟<br />
            <span style={{ background: 'linear-gradient(120deg, #4d7fff, #a371f7)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>完成全班课堂反馈</span>
          </h1>

          <p style={{ fontSize: 'clamp(15px, 2vw, 18px)', color: C.text2, lineHeight: 1.8, marginBottom: 44, maxWidth: 520, margin: '0 auto 44px' }}>
            上传课堂录音，AI 自动转写并生成标准格式家长反馈。<br />告别手写，每位学生 2 分钟搞定。
          </p>

          {/* CTA buttons */}
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap', marginBottom: 56 }}>
            {authEnabled && !user ? (
              <>
                <button onClick={() => setAuthModal('register')} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 15, padding: '13px 32px', borderRadius: 12, fontWeight: 700, cursor: 'pointer', background: C.accent, color: '#fff', border: 'none', boxShadow: `0 0 24px ${C.accent}40` }}>
                  <UserPlus size={16} /> 免费注册
                </button>
                <button onClick={() => setAuthModal('login')} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 15, padding: '13px 32px', borderRadius: 12, fontWeight: 600, cursor: 'pointer', background: 'transparent', color: C.text1, border: `1px solid ${C.borderBright}` }}>
                  <LogIn size={15} /> 登录
                </button>
              </>
            ) : (
              <button onClick={goToApp} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 15, padding: '13px 32px', borderRadius: 12, fontWeight: 700, cursor: 'pointer', background: C.accent, color: '#fff', border: 'none', boxShadow: `0 0 24px ${C.accent}40` }}>
                {user ? '进入工作台' : '免费开始使用'} <ChevronRight size={16} />
              </button>
            )}
            <a href="#download" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 15, padding: '13px 32px', borderRadius: 12, fontWeight: 600, background: 'transparent', color: C.text1, border: `1px solid ${C.borderBright}`, textDecoration: 'none' }}>
              <Download size={15} /> 下载桌面端
            </a>
          </div>

          {/* Stats */}
          <div style={{ display: 'flex', gap: 0, justifyContent: 'center', flexWrap: 'wrap', borderRadius: 14, background: C.bgCard, border: `1px solid ${C.border}`, overflow: 'hidden', maxWidth: 680, margin: '0 auto' }}>
            {STATS.map(({ icon: Icon, value, label }, i) => (
              <div key={label} style={{ flex: '1 1 140px', padding: '18px 12px', textAlign: 'center', borderRight: i < STATS.length - 1 ? `1px solid ${C.border}` : 'none' }}>
                <Icon size={15} style={{ color: C.accent, marginBottom: 6, display: 'block', margin: '0 auto 6px' }} />
                <div style={{ fontSize: 22, fontWeight: 800, color: C.text1, letterSpacing: -0.5 }}>{value}</div>
                <div style={{ fontSize: 11, color: C.text3, marginTop: 2 }}>{label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Features ────────────────────────────────────────────────────────── */}
      <section id="features" style={{ padding: 'clamp(60px, 8vw, 96px) clamp(20px, 5vw, 48px)', background: C.bgSection }}>
        <div style={{ maxWidth: 1080, margin: '0 auto' }}>
          <SectionHeading tag="核心功能" title="一站式教学工作流" sub="从录音到发送家长，全流程无缝衔接" />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(290px, 1fr))', gap: 18 }}>
            {FEATURES.map(({ icon: Icon, color, bg, title, points }) => (
              <div key={title} style={{ padding: '28px 26px', borderRadius: 18, background: C.bgCard, border: `1px solid ${C.border}`, transition: 'border-color 0.2s, transform 0.2s' }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = color + '40'; (e.currentTarget as HTMLElement).style.transform = 'translateY(-2px)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = C.border; (e.currentTarget as HTMLElement).style.transform = ''; }}>
                <div style={{ width: 46, height: 46, borderRadius: 12, background: bg, border: `1px solid ${color}30`, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 18 }}>
                  <Icon size={22} style={{ color }} />
                </div>
                <h3 style={{ fontSize: 17, fontWeight: 700, marginBottom: 14, color: C.text1 }}>{title}</h3>
                <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 9 }}>
                  {points.map(p => (
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
          <SectionHeading tag="使用流程" title="4 步完成一份反馈" sub="最快 5 分钟，专业格式，家长一目了然" />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 24 }}>
            {STEPS.map(({ n, title, desc, icon: Icon }, idx) => (
              <div key={n} style={{ position: 'relative' }}>
                {idx < STEPS.length - 1 && (
                  <div style={{ position: 'absolute', top: 22, left: 'calc(100% - 12px)', width: 24, height: 1, background: `linear-gradient(to right, ${C.accentBorder}, transparent)`, display: 'none' }} className="step-connector" />
                )}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
                  <div style={{ width: 44, height: 44, borderRadius: 12, background: C.accentDim, border: `1px solid ${C.accentBorder}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <Icon size={20} style={{ color: C.accent }} />
                  </div>
                  <span style={{ fontSize: 28, fontWeight: 900, color: C.border, letterSpacing: -1 }}>{n}</span>
                </div>
                <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 8, color: C.text1 }}>{title}</h3>
                <p style={{ fontSize: 13, color: C.text3, lineHeight: 1.7, margin: 0 }}>{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Pricing ─────────────────────────────────────────────────────────── */}
      <section id="pricing" style={{ padding: 'clamp(60px, 8vw, 96px) clamp(20px, 5vw, 48px)', background: C.bgSection }}>
        <div style={{ maxWidth: 1080, margin: '0 auto' }}>
          <SectionHeading tag="透明定价" title="按需选择，按月订阅" sub="免费版永久可用 · 随时取消 · 无隐藏费用" />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(270px, 1fr))', gap: 18, alignItems: 'start' }}>
            {PLANS.map(plan => (
              <div key={plan.name} style={{
                padding: '32px 28px', borderRadius: 20, position: 'relative',
                background: plan.highlight ? `linear-gradient(160deg, #1a2a4f, #0e1a38)` : C.bgCard,
                border: `${plan.highlight ? 2 : 1}px solid ${plan.highlight ? C.accent : C.border}`,
                boxShadow: plan.highlight ? `0 0 40px ${C.accent}18` : 'none',
              }}>
                {plan.badge && (
                  <div style={{ position: 'absolute', top: -12, left: '50%', transform: 'translateX(-50%)', fontSize: 11, padding: '3px 14px', borderRadius: 20, fontWeight: 700, background: `linear-gradient(to right, ${C.accent}, #7c4af8)`, color: '#fff', whiteSpace: 'nowrap', boxShadow: `0 2px 8px ${C.accent}40` }}>
                    {plan.badge}
                  </div>
                )}
                <div style={{ marginBottom: 6 }}>
                  <h3 style={{ fontSize: 16, fontWeight: 700, color: C.text1, marginBottom: 4 }}>{plan.name}</h3>
                  <p style={{ fontSize: 12, color: C.text3, margin: 0 }}>{plan.desc}</p>
                </div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 3, margin: '20px 0 24px' }}>
                  <span style={{ fontSize: 44, fontWeight: 900, letterSpacing: -2, color: plan.highlight ? '#a8c8ff' : C.text1 }}>{plan.price}</span>
                  <span style={{ fontSize: 14, color: C.text3 }}>{plan.period}</span>
                </div>
                <div style={{ height: 1, background: plan.highlight ? '#243360' : C.border, marginBottom: 20 }} />
                <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 28px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {plan.features.map(f => (
                    <li key={f} style={{ display: 'flex', alignItems: 'flex-start', gap: 9, fontSize: 14, color: plan.highlight ? '#a8c8ff' : C.text2 }}>
                      <Check size={13} style={{ color: C.green, marginTop: 3, flexShrink: 0 }} /> {f}
                    </li>
                  ))}
                </ul>
                <button
                  onClick={() => plan.action === 'app' ? goToApp() : setPayModal(plan.name)}
                  style={{
                    width: '100%', padding: '12px 0', borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: 'pointer',
                    background: plan.highlight ? C.accent : 'transparent',
                    color: plan.highlight ? '#fff' : C.text2,
                    border: plan.highlight ? 'none' : `1px solid ${C.borderBright}`,
                    transition: 'opacity 0.15s, transform 0.15s',
                    boxShadow: plan.highlight ? `0 4px 16px ${C.accent}30` : 'none',
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.opacity = '0.88'; (e.currentTarget as HTMLButtonElement).style.transform = 'scale(0.99)'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.opacity = '1'; (e.currentTarget as HTMLButtonElement).style.transform = ''; }}
                >{plan.cta}</button>
              </div>
            ))}
          </div>
          <p style={{ textAlign: 'center', fontSize: 13, color: C.text3, marginTop: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            <Shield size={13} style={{ color: C.text3 }} />
            所有数据仅保存在本地设备，不上传服务器，保护学生隐私
          </p>
        </div>
      </section>

      {/* ── Download ─────────────────────────────────────────────────────────── */}
      <section id="download" style={{ padding: 'clamp(60px, 8vw, 96px) clamp(20px, 5vw, 48px)', background: C.bg }}>
        <div style={{ maxWidth: 720, margin: '0 auto', textAlign: 'center' }}>
          <SectionHeading tag="桌面端下载" title="更稳定的本地体验" sub="直连 API · 原生文件对话框 · 麦克风录音 · 无跨域限制" />
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap', marginBottom: 18 }}>
            {[
              { label: 'macOS Apple Silicon', hint: 'M1 · M2 · M3 · M4' },
              { label: 'macOS Intel', hint: 'x86_64' },
              { label: 'Windows 64 位', hint: 'x64' },
            ].map(({ label, hint }) => (
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
            前往{' '}
            <a href={BIZ.githubReleases} target="_blank" rel="noopener noreferrer" style={{ color: C.accent, textDecoration: 'none' }}>GitHub Releases</a>
            {' '}下载最新版本
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
            <span style={{ fontSize: 13, color: C.text3 }}>语文教学工作台 © 2026</span>
            <span style={{ fontSize: 13, color: C.text3, display: 'flex', alignItems: 'center', gap: 4 }}>
              <Shield size={11} /> 保护学生数据隐私
            </span>
          </div>
          <div style={{ display: 'flex', gap: 20, alignItems: 'center' }}>
            <button onClick={goToApp} style={{ fontSize: 13, color: C.text3, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>进入工作台</button>
            <a href={BIZ.githubReleases} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, color: C.text3, textDecoration: 'none' }}>GitHub</a>
            {authEnabled && !user && (
              <button onClick={() => setAuthModal('register')} style={{ fontSize: 13, color: C.accent, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>注册账号</button>
            )}
          </div>
        </div>
      </footer>

      {/* ── Modals ──────────────────────────────────────────────────────────── */}
      {payModal && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(0,0,0,0.82)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
          onClick={() => setPayModal(null)}>
          <div style={{ background: C.bgCard, border: `1px solid ${C.borderBright}`, borderRadius: 22, padding: '32px 28px', maxWidth: 360, width: '100%', boxSizing: 'border-box' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
              <div>
                <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4, color: C.text1 }}>购买 {payModal}</h3>
                <p style={{ fontSize: 13, color: C.text3, margin: 0 }}>扫码付款，工作日 24h 内发送激活码</p>
              </div>
              <button onClick={() => setPayModal(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.text3, padding: 4 }}>
                <X size={18} />
              </button>
            </div>
            <div style={{ width: '100%', aspectRatio: '1', borderRadius: 14, background: '#fff', marginBottom: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
              {BIZ.wechatQR ? (
                <img src={BIZ.wechatQR} alt="微信收款码" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
              ) : (
                <div style={{ textAlign: 'center', padding: 24 }}>
                  <div style={{ width: 100, height: 100, border: '2px dashed #ccc', borderRadius: 8, margin: '0 auto 12px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <span style={{ fontSize: 28 }}>💳</span>
                  </div>
                  <p style={{ fontSize: 12, color: '#888', lineHeight: 1.6, margin: 0 }}>
                    请将收款码图片放入 <code>public/</code><br />
                    并更新 <code>BIZ.wechatQR</code>
                  </p>
                </div>
              )}
            </div>
            <div style={{ background: C.bgCard2, borderRadius: 10, padding: '12px 16px', marginBottom: 18, border: `1px solid ${C.border}` }}>
              <p style={{ fontSize: 13, color: C.text2, lineHeight: 1.75, margin: 0 }}>
                付款后请添加微信 <strong style={{ color: C.text1 }}>{BIZ.wechatId}</strong>，备注「{payModal}」，工作日内 24 小时发送激活码。
              </p>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setPayModal(null)} style={{ flex: 1, padding: '10px 0', borderRadius: 9, fontSize: 14, fontWeight: 600, cursor: 'pointer', background: 'transparent', color: C.text2, border: `1px solid ${C.borderBright}` }}>取消</button>
              <button onClick={copyWechat} style={{ flex: 1, padding: '10px 0', borderRadius: 9, fontSize: 14, fontWeight: 600, cursor: 'pointer', background: C.green, color: '#fff', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                {copied ? <><CheckCheck size={14} /> 已复制</> : <><Copy size={14} /> 复制微信号</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {authModal && (
        <AuthModal initialMode={authModal} onClose={() => setAuthModal(null)} onSuccess={goToApp} />
      )}
    </div>
  );
}
