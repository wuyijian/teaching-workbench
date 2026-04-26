import { useState, useEffect, useRef } from 'react';
import { Lightbulb, X, Send, Copy, Check, AlertCircle, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';

const FEEDBACK_BUCKET = 'feedback';

type Category = 'bug' | 'feature' | 'other';

const CATEGORY_OPTIONS: { value: Category; label: string }[] = [
  { value: 'feature', label: '功能建议' },
  { value: 'bug',     label: '问题反馈 / Bug' },
  { value: 'other',   label: '其他' },
];

function shortId(): string {
  return Math.random().toString(36).slice(2, 8);
}

/** 收集系统/版本上下文，便于研发定位 */
function collectMeta(): Record<string, string> {
  const meta: Record<string, string> = {};
  try {
    meta.timestamp = new Date().toISOString();
    meta.url = window.location.href;
    meta.userAgent = navigator.userAgent;
    meta.platform = (import.meta.env.VITE_ELECTRON === '1') || /Electron/i.test(navigator.userAgent)
      ? 'electron-desktop'
      : 'web';
    meta.locale = navigator.language;
  } catch { /* ignore */ }
  return meta;
}

export function FeedbackButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="提交建议 / 反馈"
        className="flex items-center justify-center p-1.5 rounded-lg transition-all"
        style={{ color: 'var(--text-3)', border: '1px solid var(--border)', background: 'transparent' }}
        onMouseEnter={e => {
          (e.currentTarget as HTMLElement).style.color = '#facc15';
          (e.currentTarget as HTMLElement).style.borderColor = '#facc1560';
        }}
        onMouseLeave={e => {
          (e.currentTarget as HTMLElement).style.color = 'var(--text-3)';
          (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)';
        }}
      >
        <Lightbulb size={13} />
      </button>
      {open && <FeedbackModal onClose={() => setOpen(false)} />}
    </>
  );
}

// ─── Modal ────────────────────────────────────────────────────────────────────
function FeedbackModal({ onClose }: { onClose: () => void }) {
  const { user } = useAuth();
  const [category, setCategory] = useState<Category>('feature');
  const [content, setContent] = useState('');
  const [contact, setContact] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submittedAt, setSubmittedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !submitting) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, submitting]);

  const trimmed = content.trim();
  const canSubmit = trimmed.length > 0 && !submitting && !submittedAt;

  /** 上传到 Supabase Storage 的 feedback bucket */
  const handleSubmit = async () => {
    if (!canSubmit) return;
    setError(null);

    if (!supabase) {
      setError('反馈服务未配置（缺少 VITE_SUPABASE_URL）。请改用「复制内容」并手动联系研发');
      return;
    }

    setSubmitting(true);
    const now = new Date();
    const datePart = now.toISOString().slice(0, 10); // YYYY-MM-DD
    const fileName = `${now.getTime()}-${shortId()}.json`;
    const path = `${datePart}/${fileName}`;

    const payload = {
      category,
      content: trimmed,
      contact: contact.trim() || null,
      user: user
        ? {
            id: user.id,
            email: user.email ?? null,
            nickname: (user.user_metadata?.nickname as string | undefined) ?? null,
          }
        : null,
      meta: collectMeta(),
    };

    try {
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const { error: upErr } = await supabase.storage
        .from(FEEDBACK_BUCKET)
        .upload(path, blob, {
          contentType: 'application/json; charset=utf-8',
          upsert: false,
        });
      if (upErr) throw upErr;

      setSubmittedAt(Date.now());
      setSubmitting(false);
      // 提交成功后 2.5s 自动关闭
      setTimeout(onClose, 2500);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '提交失败';
      // 常见错误的友好转译
      const friendly = /bucket|not found|404/i.test(msg)
        ? '后台尚未创建反馈存储桶（请联系研发执行 005 迁移）'
        : /policy|permission|unauthorized|403/i.test(msg)
        ? '提交权限被拒（RLS 策略不正确，请联系研发）'
        : msg;
      setError(friendly);
      setSubmitting(false);
    }
  };

  const handleCopy = async () => {
    if (!content.trim()) return;
    try {
      const cat = CATEGORY_OPTIONS.find(c => c.value === category)?.label ?? category;
      const text = [
        `【类型】${cat}`,
        `【联系方式】${contact.trim() || '（未填写）'}`,
        '',
        trimmed,
      ].join('\n');
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* ignore */ }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(2px)' }}
      onMouseDown={e => { if (e.target === e.currentTarget && !submitting) onClose(); }}
    >
      <div
        className="w-full max-w-md rounded-2xl flex flex-col"
        style={{ background: 'var(--bg-s1)', border: '1px solid var(--border)', maxHeight: '90vh' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between shrink-0" style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: '#facc1520', border: '1px solid #facc1560' }}>
              <Lightbulb size={13} style={{ color: '#facc15' }} />
            </div>
            <div>
              <p className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>提交建议 / 反馈</p>
              <p className="text-[10px]" style={{ color: 'var(--text-3)' }}>提交后会自动同步到研发后台</p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={submitting}
            className="p-1.5 rounded-md transition-colors"
            style={{ color: 'var(--text-3)', opacity: submitting ? 0.4 : 1, cursor: submitting ? 'not-allowed' : 'pointer' }}
            onMouseEnter={e => { if (!submitting) { (e.currentTarget as HTMLElement).style.background = 'var(--bg-s3)'; (e.currentTarget as HTMLElement).style.color = 'var(--text-1)'; } }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'var(--text-3)'; }}
          >
            <X size={14} />
          </button>
        </div>

        {/* 提交成功视图 */}
        {submittedAt ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3" style={{ padding: '32px 24px' }}>
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ background: 'var(--green-dim)', border: '1px solid #1e4d27' }}>
              <Check size={22} style={{ color: 'var(--green)' }} />
            </div>
            <p className="text-sm font-medium" style={{ color: 'var(--text-1)' }}>提交成功，感谢你的反馈！</p>
            <p className="text-xs text-center" style={{ color: 'var(--text-3)', lineHeight: 1.6 }}>
              我们会第一时间查看，必要时通过你留下的联系方式回复
            </p>
          </div>
        ) : (
          <>
            {/* Body */}
            <div className="flex-1 overflow-y-auto scrollbar-thin" style={{ padding: '14px 18px' }}>
              {/* 类型 */}
              <div>
                <label className="text-[11px] font-medium block mb-1.5" style={{ color: 'var(--text-2)' }}>类型</label>
                <div className="flex gap-1.5">
                  {CATEGORY_OPTIONS.map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => setCategory(opt.value)}
                      disabled={submitting}
                      className="text-xs px-3 py-1.5 rounded-lg font-medium transition-all flex-1"
                      style={category === opt.value ? {
                        background: 'var(--accent)', color: '#fff', border: '1px solid var(--accent)',
                      } : {
                        background: 'var(--bg-s2)', color: 'var(--text-3)', border: '1px solid var(--border)',
                      }}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* 内容 */}
              <div className="mt-3">
                <label className="text-[11px] font-medium block mb-1.5" style={{ color: 'var(--text-2)' }}>
                  建议内容 <span style={{ color: 'var(--red)' }}>*</span>
                </label>
                <textarea
                  ref={textareaRef}
                  value={content}
                  onChange={e => setContent(e.target.value)}
                  disabled={submitting}
                  placeholder="详细描述你的建议、遇到的问题或希望增加的功能…"
                  rows={6}
                  className="scrollbar-thin w-full resize-none outline-none rounded-lg"
                  style={{
                    background: 'var(--bg-s2)',
                    border: '1px solid var(--border)',
                    color: 'var(--text-1)',
                    fontSize: 13,
                    padding: '10px 12px',
                    lineHeight: 1.6,
                  }}
                  onFocus={e => (e.currentTarget.style.borderColor = 'var(--accent)')}
                  onBlur={e => (e.currentTarget.style.borderColor = 'var(--border)')}
                />
                <div className="flex justify-between mt-1">
                  <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>提交时会自动附带浏览器与版本信息，便于定位</span>
                  <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>{content.length} 字</span>
                </div>
              </div>

              {/* 联系方式 */}
              <div className="mt-3">
                <label className="text-[11px] font-medium block mb-1.5" style={{ color: 'var(--text-2)' }}>联系方式（选填）</label>
                <input
                  value={contact}
                  onChange={e => setContact(e.target.value)}
                  disabled={submitting}
                  placeholder="邮箱 / 微信号 / 手机号，用于必要时回复"
                  className="w-full outline-none rounded-lg"
                  style={{
                    background: 'var(--bg-s2)',
                    border: '1px solid var(--border)',
                    color: 'var(--text-1)',
                    fontSize: 13,
                    padding: '8px 12px',
                  }}
                  onFocus={e => (e.currentTarget.style.borderColor = 'var(--accent)')}
                  onBlur={e => (e.currentTarget.style.borderColor = 'var(--border)')}
                />
              </div>

              {/* 错误提示 */}
              {error && (
                <div className="mt-3 rounded-lg flex items-start gap-2" style={{ padding: '8px 10px', background: 'var(--red-dim)', border: '1px solid #5a1e1e' }}>
                  <AlertCircle size={12} style={{ color: 'var(--red)', marginTop: 2, flexShrink: 0 }} />
                  <p className="text-[11px]" style={{ color: 'var(--red)', lineHeight: 1.5 }}>{error}</p>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-2 shrink-0" style={{ padding: '10px 18px', borderTop: '1px solid var(--border)' }}>
              <button
                onClick={handleCopy}
                disabled={!trimmed || submitting}
                title="复制内容到剪贴板（兜底用，提交失败时可用）"
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-medium transition-all"
                style={{
                  color: copied ? 'var(--green)' : 'var(--text-2)',
                  background: copied ? 'var(--green-dim)' : 'var(--bg-s2)',
                  border: `1px solid ${copied ? '#1e4d27' : 'var(--border)'}`,
                  opacity: trimmed && !submitting ? 1 : 0.4,
                  cursor: trimmed && !submitting ? 'pointer' : 'not-allowed',
                }}
              >
                {copied ? <Check size={11} /> : <Copy size={11} />}
                {copied ? '已复制' : '复制内容'}
              </button>
              <button
                onClick={handleSubmit}
                disabled={!canSubmit}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-medium transition-all"
                style={{
                  background: canSubmit ? 'var(--accent)' : 'var(--bg-s2)',
                  color: canSubmit ? '#fff' : 'var(--text-3)',
                  border: '1px solid transparent',
                  opacity: canSubmit ? 1 : 0.4,
                  cursor: canSubmit ? 'pointer' : 'not-allowed',
                  minWidth: 96,
                  justifyContent: 'center',
                }}
                onMouseEnter={e => { if (canSubmit) (e.currentTarget as HTMLElement).style.opacity = '0.85'; }}
                onMouseLeave={e => { if (canSubmit) (e.currentTarget as HTMLElement).style.opacity = '1'; }}
              >
                {submitting ? (
                  <>
                    <Loader2 size={11} className="animate-spin" /> 提交中…
                  </>
                ) : (
                  <>
                    <Send size={11} /> 提交建议
                  </>
                )}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
