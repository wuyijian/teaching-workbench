import { useState, useCallback } from 'react';
import { X, Mail, Lock, Eye, EyeOff, Loader2, CheckCircle2, BookOpen } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { WechatLoginModal } from './WechatLoginModal';

type Mode = 'login' | 'register';

interface Props {
  initialMode?: Mode;
  onClose: () => void;
  onSuccess?: () => void;
}

export function AuthModal({ initialMode = 'login', onClose, onSuccess }: Props) {
  const { t } = useTranslation();
  const { signIn, signUp } = useAuth();

  const [mode, setMode]           = useState<Mode>(initialMode);
  const [email, setEmail]         = useState('');
  const [password, setPassword]   = useState('');
  const [showPwd, setShowPwd]     = useState(false);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [success, setSuccess]     = useState(false);
  const [needsConfirm, setNeedsConfirm] = useState(false);
  const [showWxModal, setShowWxModal] = useState(false);

  const wechatEnabled = !!import.meta.env.VITE_WECHAT_APP_ID;

  const switchMode = useCallback((m: Mode) => {
    setMode(m);
    setError(null);
    setSuccess(false);
    setNeedsConfirm(false);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) return;
    setLoading(true);
    setError(null);

    if (mode === 'login') {
      const err = await signIn(email.trim(), password);
      setLoading(false);
      if (err) { setError(err); return; }
      onSuccess?.();
      onClose();
    } else {
      const result = await signUp(email.trim(), password);
      setLoading(false);
      if (typeof result === 'string') { setError(result); return; }
      if (result?.needsConfirm) {
        // Supabase 开启了邮件验证，需要用户去收邮件
        setNeedsConfirm(true);
      } else {
        // 已关闭邮件验证，直接登录成功
        setSuccess(true);
        setTimeout(() => { onSuccess?.(); onClose(); }, 1200);
      }
    }
  };

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 400, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
      onClick={onClose}
    >
      <div
        style={{ width: '100%', maxWidth: 400, background: 'var(--bg-s1)', border: '1px solid var(--border)', borderRadius: 20, overflow: 'hidden' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ padding: '24px 28px 0', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--accent-dim)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <BookOpen size={16} style={{ color: 'var(--accent)' }} />
            </div>
            <div>
              <p style={{ fontSize: 17, fontWeight: 700, color: 'var(--text-1)', lineHeight: 1.3 }}>
                {mode === 'login' ? t('auth.welcomeBack') : t('auth.createAccount')}
              </p>
              <p style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 1 }}>{t('common.appName')}</p>
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)', padding: 4 }}>
            <X size={16} />
          </button>
        </div>

        {/* Mode tabs */}
        <div style={{ padding: '20px 28px 0' }}>
          <div style={{ display: 'flex', gap: 0, background: 'var(--bg-s3)', borderRadius: 10, padding: 3 }}>
            {(['login', 'register'] as Mode[]).map(m => (
              <button
                key={m}
                onClick={() => switchMode(m)}
                style={{
                  flex: 1, padding: '7px 0', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', border: 'none', transition: 'all 0.15s',
                  background: mode === m ? 'var(--bg-s1)' : 'transparent',
                  color: mode === m ? 'var(--text-1)' : 'var(--text-3)',
                  boxShadow: mode === m ? '0 1px 3px rgba(0,0,0,0.2)' : 'none',
                }}
              >
                {m === 'login' ? t('common.login') : t('common.register')}
              </button>
            ))}
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} style={{ padding: '20px 28px 28px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Email */}
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)', display: 'block', marginBottom: 6 }}>{t('auth.email')}</label>
            <div style={{ position: 'relative' }}>
              <Mail size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-3)' }} />
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="name@example.com"
                required
                autoFocus
                style={{
                  width: '100%', boxSizing: 'border-box',
                  padding: '10px 12px 10px 36px', borderRadius: 10, fontSize: 14,
                  background: 'var(--bg-s2)', border: '1px solid var(--border)',
                  color: 'var(--text-1)', outline: 'none',
                }}
                onFocus={e => e.currentTarget.style.borderColor = 'var(--accent)'}
                onBlur={e => e.currentTarget.style.borderColor = 'var(--border)'}
              />
            </div>
          </div>

          {/* Password */}
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)', display: 'block', marginBottom: 6 }}>
              {t('auth.password')}
              {mode === 'register' && <span style={{ color: 'var(--text-3)', fontWeight: 400, marginLeft: 6 }}>{t('auth.minLength')}</span>}
            </label>
            <div style={{ position: 'relative' }}>
              <Lock size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-3)' }} />
              <input
                type={showPwd ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder={mode === 'register' ? t('auth.passwordPlaceholderRegister') : t('auth.passwordPlaceholderLogin')}
                required
                minLength={6}
                style={{
                  width: '100%', boxSizing: 'border-box',
                  padding: '10px 40px 10px 36px', borderRadius: 10, fontSize: 14,
                  background: 'var(--bg-s2)', border: '1px solid var(--border)',
                  color: 'var(--text-1)', outline: 'none',
                }}
                onFocus={e => e.currentTarget.style.borderColor = 'var(--accent)'}
                onBlur={e => e.currentTarget.style.borderColor = 'var(--border)'}
              />
              <button
                type="button"
                onClick={() => setShowPwd(v => !v)}
                style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)', padding: 0 }}
              >
                {showPwd ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>

          {/* Error */}
          {error && (
            <div style={{ fontSize: 13, color: 'var(--red)', background: 'var(--red-dim)', border: '1px solid #5a1e1e', borderRadius: 8, padding: '9px 12px' }}>
              {error}
            </div>
          )}

          {/* 需验证邮件 */}
          {needsConfirm && (
            <div style={{ fontSize: 13, background: '#1a2a1a', border: '1px solid #2a4d2a', borderRadius: 8, padding: '10px 12px', lineHeight: 1.6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--green)', marginBottom: 4 }}>
                <CheckCircle2 size={14} /> {t('auth.registerSuccessVerify')}
              </div>
              <p style={{ color: 'var(--text-3)', margin: 0 }}>
                {t('auth.verifyEmailPrefix')}<strong style={{ color: 'var(--text-2)' }}>{email}</strong>{t('auth.verifyEmailSuffix')}
              </p>
            </div>
          )}

          {/* 直接登录成功 */}
          {success && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--green)', background: 'var(--green-dim)', border: '1px solid #1e4d27', borderRadius: 8, padding: '9px 12px' }}>
              <CheckCircle2 size={14} />
              {t('auth.registerLoginSuccess')}
            </div>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={loading || !email.trim() || !password.trim()}
            style={{
              width: '100%', padding: '11px 0', borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer',
              background: 'var(--accent)', color: '#fff', border: 'none',
              opacity: (loading || !email.trim() || !password.trim()) ? 0.5 : 1,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              transition: 'opacity 0.15s',
            }}
          >
            {loading
              ? <><Loader2 size={14} className="animate-spin" /> {t('auth.processing')}</>
              : mode === 'login' ? t('common.login') : t('common.register')
            }
          </button>

          {/* Switch mode */}
          <p style={{ textAlign: 'center', fontSize: 13, color: 'var(--text-3)' }}>
            {mode === 'login' ? t('auth.noAccount') : t('auth.hasAccount')}
            <button
              type="button"
              onClick={() => switchMode(mode === 'login' ? 'register' : 'login')}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent)', fontSize: 13, fontWeight: 600, padding: '0 4px' }}
            >
              {mode === 'login' ? t('auth.registerNow') : t('auth.loginNow')}
            </button>
          </p>

          {/* WeChat divider */}
          {wechatEnabled && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '4px 0' }}>
                <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                <span style={{ fontSize: 11, color: 'var(--text-3)', whiteSpace: 'nowrap' }}>{t('auth.thirdPartyLogin')}</span>
                <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
              </div>

              {/* WeChat button */}
              <button
                type="button"
                onClick={() => setShowWxModal(true)}
                style={{
                  width: '100%', padding: '10px 0', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer',
                  background: '#07c160', color: '#fff', border: 'none',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                }}
              >
                {/* WeChat icon */}
                <svg width="16" height="16" viewBox="0 0 24 24" fill="white">
                  <path d="M8.5 11a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm7 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zM3.5 8C3.5 4.41 7.36 1.5 12 1.5S20.5 4.41 20.5 8c0 3.59-3.86 6.5-8.5 6.5-.78 0-1.54-.09-2.26-.25L7 16.5l.93-2.57C5.4 12.75 3.5 10.51 3.5 8z"/>
                </svg>
                {t('auth.wechatLogin')}
              </button>
            </>
          )}
        </form>
      </div>

      {/* WeChat QR modal stacked on top */}
      {showWxModal && <WechatLoginModal onClose={() => setShowWxModal(false)} />}
    </div>
  );
}
