import { useState, useEffect } from 'react';
import {
  Mic, FileAudio, Sparkles, Download, Check, X,
  ChevronRight, Zap, BookOpen, MessageSquare,
  Shield, Copy, CheckCheck,
} from 'lucide-react';

// ─── 商业配置（修改此处即可）────────────────────────────────────────────────
const BIZ = {
  wechatId: 'wuyijian',            // 你的微信号
  wechatQR: '',                    // 替换为收款码图片路径，如 '/wechat-pay-qr.png'
  githubReleases: 'https://github.com/wuyijian/teaching-workbench/releases/latest',
};

// ─── 定价方案 ────────────────────────────────────────────────────────────────
const PLANS = [
  {
    name: '免费版',
    price: '¥0',
    period: '',
    desc: '立即体验核心功能',
    features: [
      '每月 5 次音频转写',
      '每月 10 次 AI 反馈',
      'Web 端使用',
      '基础 Markdown 导出',
    ],
    cta: '免费使用',
    action: 'app' as const,
  },
  {
    name: '教师专业版',
    price: '¥29',
    period: '/月',
    desc: '适合个人教师日常使用',
    features: [
      '无限次音频转写',
      '无限次 AI 反馈生成',
      'macOS & Windows 桌面端',
      '2 小时以上长音频支持',
      '现场麦克风录音',
      '补充信息辅助生成',
    ],
    cta: '立即购买',
    action: 'pay' as const,
    highlight: true,
    badge: '最受欢迎',
  },
  {
    name: '学校机构版',
    price: '¥99',
    period: '/月',
    desc: '适合学校、教培机构',
    features: [
      '最多 20 位教师账号',
      '管理员控制台',
      '包含专业版全部功能',
      '合规报告 & 正规发票',
      '专属技术支持',
    ],
    cta: '联系购买',
    action: 'pay' as const,
  },
];

// ─── 功能亮点 ─────────────────────────────────────────────────────────────────
const FEATURES = [
  {
    icon: Mic,
    title: '灵活音频输入',
    points: ['现场麦克风录音', '上传文件（拖拽 / 点击 / 粘贴）', 'MP3 · WAV · M4A · FLAC 全支持', '长达 2 小时课堂音频自动切片'],
  },
  {
    icon: Zap,
    title: '高精度转写',
    points: ['讯飞大模型（课堂用语优化）', 'OpenAI Whisper（多语言）', '多任务队列，互不干扰', '转写结果带时间戳'],
  },
  {
    icon: Sparkles,
    title: 'AI 课堂反馈',
    points: ['约 200 字标准格式反馈', '支持课前检测等补充信息', '追问修改，灵活调整', '一键复制 / 导出 Markdown'],
  },
];

const STEPS = [
  { n: '01', title: '上传或录制音频', desc: '课后将录音文件拖入工作台，或直接在应用内录制课堂音频。' },
  { n: '02', title: 'AI 精准转写', desc: '讯飞 / Whisper 自动将音频转写为带时间戳的文字，长音频自动切片处理。' },
  { n: '03', title: '生成课堂反馈', desc: '选中学生任务，一键调用 AI 生成标准格式家长反馈，支持追问修改。' },
  { n: '04', title: '发送给家长', desc: '直接复制文本发送家校群，或导出为 Markdown 文件存档。' },
];

// ─── 样式辅助 ─────────────────────────────────────────────────────────────────
const C = {
  bg: '#09090f',
  bgCard: '#0f131e',
  bgCard2: '#131924',
  border: '#1c2333',
  borderBright: '#243048',
  accent: '#4d7fff',
  accentDim: '#1a2a4f',
  accentBorder: '#2a3f6f',
  text1: '#e8edf5',
  text2: '#8a9bb5',
  text3: '#4a5568',
  green: '#22c55e',
  greenDim: '#14532d40',
};

export function LandingPage() {
  const [scrolled, setScrolled] = useState(false);
  const [payModal, setPayModal] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 24);
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
    <div style={{ fontFamily: 'system-ui, -apple-system, "PingFang SC", sans-serif', background: C.bg, color: C.text1, minHeight: '100vh', lineHeight: 1.6 }}>

      {/* ── Navbar ─────────────────────────────────────────────────────────── */}
      <nav style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 200,
        height: 58, padding: '0 32px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: scrolled ? 'rgba(9,9,15,0.88)' : 'transparent',
        backdropFilter: scrolled ? 'blur(16px)' : 'none',
        borderBottom: scrolled ? `1px solid ${C.border}` : '1px solid transparent',
        transition: 'all 0.25s',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 28, height: 28, borderRadius: 8, background: C.accentDim, border: `1px solid ${C.accentBorder}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <BookOpen size={14} style={{ color: C.accent }} />
          </div>
          <span style={{ fontWeight: 700, fontSize: 15, letterSpacing: -0.3 }}>语文教学工作台</span>
          <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 10, background: C.accentDim, color: C.accent, border: `1px solid ${C.accentBorder}`, fontWeight: 700 }}>Beta</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {[['#features', '功能'], ['#pricing', '定价'], ['#download', '下载']].map(([href, label]) => (
            <a key={href} href={href} style={{ fontSize: 13, color: C.text2, textDecoration: 'none', padding: '6px 10px', borderRadius: 6 }}>{label}</a>
          ))}
          <button onClick={goToApp} style={{
            fontSize: 13, padding: '7px 16px', borderRadius: 8, fontWeight: 600, cursor: 'pointer',
            background: C.accent, color: '#fff', border: 'none', marginLeft: 8,
          }}>进入工作台</button>
        </div>
      </nav>

      {/* ── Hero ────────────────────────────────────────────────────────────── */}
      <section style={{ padding: '130px 32px 90px', textAlign: 'center', maxWidth: 760, margin: '0 auto' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '4px 14px', borderRadius: 20, background: C.accentDim, border: `1px solid ${C.accentBorder}`, color: '#7ba7ff', marginBottom: 28, fontWeight: 500 }}>
          <Sparkles size={10} /> 专为中学语文教师设计
        </div>

        <h1 style={{ fontSize: 56, fontWeight: 800, lineHeight: 1.15, marginBottom: 22, letterSpacing: -2 }}>
          课后 5 分钟<br />
          <span style={{ color: C.accent }}>完成全班课堂反馈</span>
        </h1>

        <p style={{ fontSize: 18, color: C.text2, lineHeight: 1.75, marginBottom: 44, maxWidth: 520, margin: '0 auto 44px' }}>
          上传课堂录音，AI 自动转写 + 生成标准格式家长反馈。<br />告别手写，每位学生 2 分钟搞定。
        </p>

        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
          <button onClick={goToApp} style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            fontSize: 15, padding: '13px 30px', borderRadius: 10, fontWeight: 700, cursor: 'pointer',
            background: C.accent, color: '#fff', border: 'none',
          }}>
            免费开始使用 <ChevronRight size={15} />
          </button>
          <a href="#download" style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            fontSize: 15, padding: '13px 30px', borderRadius: 10, fontWeight: 600,
            background: 'transparent', color: C.text1, border: `1px solid ${C.borderBright}`, textDecoration: 'none',
          }}>
            <Download size={14} /> 下载桌面端
          </a>
        </div>

        {/* App preview */}
        <div style={{ marginTop: 60, borderRadius: 18, border: `1px solid ${C.border}`, background: C.bgCard, padding: 16, maxWidth: 720, margin: '60px auto 0' }}>
          <div style={{ borderRadius: 12, background: '#0c1018', padding: '24px 20px', display: 'flex', gap: 16, flexWrap: 'wrap', justifyContent: 'center' }}>
            {[
              { icon: FileAudio, label: '上传 · 录音', sub: '拖拽 / 点击 / 粘贴', color: C.accent },
              { icon: Zap, label: '自动转写', sub: '讯飞 + Whisper', color: '#f59e0b' },
              { icon: Sparkles, label: 'AI 反馈', sub: '一键生成 · 可追问', color: '#10b981' },
              { icon: MessageSquare, label: '发送家长', sub: '复制 · 导出', color: '#a855f7' },
            ].map(({ icon: Icon, label, sub, color }) => (
              <div key={label} style={{ width: 148, padding: '18px 12px', borderRadius: 12, background: C.bgCard2, border: `1px solid ${C.border}`, textAlign: 'center' }}>
                <div style={{ width: 40, height: 40, borderRadius: 10, background: `${color}18`, border: `1px solid ${color}30`, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 10px' }}>
                  <Icon size={20} style={{ color }} />
                </div>
                <p style={{ fontSize: 13, fontWeight: 700, marginBottom: 3, color: C.text1 }}>{label}</p>
                <p style={{ fontSize: 11, color: C.text3 }}>{sub}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Features ────────────────────────────────────────────────────────── */}
      <section id="features" style={{ padding: '80px 32px', maxWidth: 960, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 52 }}>
          <h2 style={{ fontSize: 38, fontWeight: 800, letterSpacing: -1, marginBottom: 12 }}>一站式教学工作流</h2>
          <p style={{ fontSize: 16, color: C.text2 }}>从录音到发送家长，全流程无缝衔接</p>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
          {FEATURES.map(({ icon: Icon, title, points }) => (
            <div key={title} style={{ padding: '28px 24px', borderRadius: 16, background: C.bgCard, border: `1px solid ${C.border}` }}>
              <div style={{ width: 44, height: 44, borderRadius: 12, background: C.accentDim, border: `1px solid ${C.accentBorder}`, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
                <Icon size={22} style={{ color: C.accent }} />
              </div>
              <h3 style={{ fontSize: 17, fontWeight: 700, marginBottom: 14 }}>{title}</h3>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {points.map(p => (
                  <li key={p} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 14, color: C.text2 }}>
                    <Check size={13} style={{ color: C.green, marginTop: 3, flexShrink: 0 }} /> {p}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* ── Steps ────────────────────────────────────────────────────────────── */}
      <section style={{ padding: '80px 32px', background: '#0b0f18' }}>
        <div style={{ maxWidth: 880, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 52 }}>
            <h2 style={{ fontSize: 38, fontWeight: 800, letterSpacing: -1, marginBottom: 12 }}>4 步完成一份反馈</h2>
            <p style={{ fontSize: 16, color: C.text2 }}>最快 5 分钟，专业格式，家长一目了然</p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 32 }}>
            {STEPS.map(({ n, title, desc }) => (
              <div key={n}>
                <div style={{ fontSize: 36, fontWeight: 900, color: C.accentDim, letterSpacing: -2, marginBottom: 12, fontVariantNumeric: 'tabular-nums' }}>{n}</div>
                <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>{title}</h3>
                <p style={{ fontSize: 13, color: C.text3, lineHeight: 1.65 }}>{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Pricing ─────────────────────────────────────────────────────────── */}
      <section id="pricing" style={{ padding: '80px 32px', maxWidth: 980, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 52 }}>
          <h2 style={{ fontSize: 38, fontWeight: 800, letterSpacing: -1, marginBottom: 12 }}>透明定价</h2>
          <p style={{ fontSize: 16, color: C.text2 }}>按月订阅，随时取消，免费版永久可用</p>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(270px, 1fr))', gap: 16 }}>
          {PLANS.map(plan => (
            <div key={plan.name} style={{
              padding: '32px 26px', borderRadius: 18, position: 'relative',
              background: plan.highlight ? C.accentDim : C.bgCard,
              border: `${plan.highlight ? 2 : 1}px solid ${plan.highlight ? C.accent : C.border}`,
            }}>
              {plan.badge && (
                <div style={{ position: 'absolute', top: -13, left: '50%', transform: 'translateX(-50%)', fontSize: 11, padding: '3px 14px', borderRadius: 20, fontWeight: 700, background: C.accent, color: '#fff', whiteSpace: 'nowrap' }}>
                  {plan.badge}
                </div>
              )}
              <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 4, color: C.text1 }}>{plan.name}</h3>
              <p style={{ fontSize: 12, color: C.text3, marginBottom: 16 }}>{plan.desc}</p>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 3, marginBottom: 24 }}>
                <span style={{ fontSize: 40, fontWeight: 900, color: plan.highlight ? '#7eb8ff' : C.text1, letterSpacing: -2 }}>{plan.price}</span>
                <span style={{ fontSize: 14, color: C.text3 }}>{plan.period}</span>
              </div>
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
                  width: '100%', padding: '11px 0', borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: 'pointer',
                  background: plan.highlight ? C.accent : 'transparent',
                  color: plan.highlight ? '#fff' : C.text2,
                  border: plan.highlight ? 'none' : `1px solid ${C.borderBright}`,
                  transition: 'opacity 0.15s',
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.opacity = '0.85'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.opacity = '1'; }}
              >{plan.cta}</button>
            </div>
          ))}
        </div>
        <p style={{ textAlign: 'center', fontSize: 13, color: C.text3, marginTop: 28 }}>
          <Shield size={12} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 5 }} />
          所有数据仅保存在本地设备，不上传服务器，保护学生隐私
        </p>
      </section>

      {/* ── Download ─────────────────────────────────────────────────────────── */}
      <section id="download" style={{ padding: '80px 32px', background: '#0b0f18' }}>
        <div style={{ maxWidth: 640, margin: '0 auto', textAlign: 'center' }}>
          <h2 style={{ fontSize: 38, fontWeight: 800, letterSpacing: -1, marginBottom: 12 }}>下载桌面端</h2>
          <p style={{ fontSize: 16, color: C.text2, marginBottom: 40 }}>
            桌面端直连 API、原生文件对话框、麦克风录音，体验更稳定
          </p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap', marginBottom: 16 }}>
            {[
              { label: 'macOS（Apple Silicon）', hint: 'M1/M2/M3/M4' },
              { label: 'macOS（Intel）', hint: 'x86_64' },
              { label: 'Windows 64 位', hint: 'x64' },
            ].map(({ label, hint }) => (
              <a key={label} href={BIZ.githubReleases} target="_blank" rel="noopener noreferrer" style={{
                display: 'inline-flex', alignItems: 'center', gap: 8,
                fontSize: 14, padding: '11px 20px', borderRadius: 10, fontWeight: 500,
                background: C.bgCard, border: `1px solid ${C.border}`, color: C.text1, textDecoration: 'none',
              }}>
                <Download size={13} style={{ color: C.accent }} />
                <span>{label}</span>
                <span style={{ fontSize: 11, color: C.text3 }}>{hint}</span>
              </a>
            ))}
          </div>
          <p style={{ fontSize: 13, color: C.text3 }}>
            前往 <a href={BIZ.githubReleases} target="_blank" rel="noopener noreferrer" style={{ color: C.accent, textDecoration: 'none' }}>GitHub Releases</a> 下载最新版本
          </p>
        </div>
      </section>

      {/* ── Footer ──────────────────────────────────────────────────────────── */}
      <footer style={{ padding: '36px 32px', borderTop: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <BookOpen size={14} style={{ color: C.accent }} />
          <span style={{ fontSize: 13, color: C.text3 }}>语文教学工作台 © 2026 · 保护学生数据隐私</span>
        </div>
        <div style={{ display: 'flex', gap: 20 }}>
          <button onClick={goToApp} style={{ fontSize: 13, color: C.text3, background: 'none', border: 'none', cursor: 'pointer' }}>进入工作台</button>
          <a href={BIZ.githubReleases} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, color: C.text3, textDecoration: 'none' }}>GitHub</a>
        </div>
      </footer>

      {/* ── Payment Modal ────────────────────────────────────────────────────── */}
      {payModal && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
          onClick={() => setPayModal(null)}
        >
          <div
            style={{ background: C.bgCard, border: `1px solid ${C.borderBright}`, borderRadius: 20, padding: '32px 28px', maxWidth: 360, width: '100%', boxSizing: 'border-box' }}
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
              <div>
                <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>购买{payModal}</h3>
                <p style={{ fontSize: 13, color: C.text3 }}>扫码付款，工作日 24h 内发送激活码</p>
              </div>
              <button onClick={() => setPayModal(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.text3, padding: 4 }}>
                <X size={18} />
              </button>
            </div>

            {/* QR Code */}
            <div style={{ width: '100%', aspectRatio: '1', borderRadius: 14, background: '#fff', marginBottom: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
              {BIZ.wechatQR ? (
                <img src={BIZ.wechatQR} alt="微信收款码" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
              ) : (
                /* ── 占位提示 ── 请将收款码图片路径填入 BIZ.wechatQR ── */
                <div style={{ textAlign: 'center', padding: 24 }}>
                  <div style={{ width: 100, height: 100, border: '2px dashed #ccc', borderRadius: 8, margin: '0 auto 12px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <span style={{ fontSize: 28 }}>💳</span>
                  </div>
                  <p style={{ fontSize: 13, color: '#999', lineHeight: 1.5 }}>
                    请将 <code style={{ fontSize: 12, background: '#f3f4f6', padding: '1px 5px', borderRadius: 4 }}>wechat-pay-qr.png</code><br />
                    放入 <code style={{ fontSize: 12, background: '#f3f4f6', padding: '1px 5px', borderRadius: 4 }}>public/</code> 目录，<br />
                    并更新 <code style={{ fontSize: 12, background: '#f3f4f6', padding: '1px 5px', borderRadius: 4 }}>BIZ.wechatQR</code>
                  </p>
                </div>
              )}
            </div>

            {/* Instructions */}
            <div style={{ background: C.bgCard2, borderRadius: 10, padding: '12px 16px', marginBottom: 18, border: `1px solid ${C.border}` }}>
              <p style={{ fontSize: 13, color: C.text2, lineHeight: 1.75, margin: 0 }}>
                付款后请添加微信 <strong style={{ color: C.text1 }}>{BIZ.wechatId}</strong>，备注「{payModal}」，工作日内 24 小时发送激活码。
              </p>
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => setPayModal(null)}
                style={{ flex: 1, padding: '10px 0', borderRadius: 9, fontSize: 14, fontWeight: 600, cursor: 'pointer', background: 'transparent', color: C.text2, border: `1px solid ${C.borderBright}` }}
              >取消</button>
              <button
                onClick={copyWechat}
                style={{ flex: 1, padding: '10px 0', borderRadius: 9, fontSize: 14, fontWeight: 600, cursor: 'pointer', background: C.green, color: '#fff', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
              >
                {copied ? <><CheckCheck size={14} /> 已复制</> : <><Copy size={14} /> 复制微信号</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
