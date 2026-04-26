/**
 * 微信 OAuth 回调页 —— 渲染路径：/auth/wechat/callback
 *
 * 流程：
 *  1. 从 URL 参数中提取 code + state
 *  2. 校验 state（防 CSRF）
 *  3. 调用 Supabase Edge Function wechat-callback，传入 code
 *  4. 用返回的 token_hash 调用 supabase.auth.verifyOtp 建立会话
 *  5. 跳转到 /app
 */

import { useEffect, useState } from 'react';
import { Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';

type Phase = 'verifying' | 'success' | 'error';

export function WechatCallbackPage() {
  const [phase, setPhase]   = useState<Phase>('verifying');
  const [message, setMessage] = useState('正在验证微信身份…');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code   = params.get('code');
    const state  = params.get('state');

    if (!code) {
      setPhase('error');
      setMessage('微信未返回授权码，请重试');
      return;
    }

    // CSRF 防护：state 必须存在且与本地保存的一致
    const savedState = sessionStorage.getItem('wx_oauth_state');
    sessionStorage.removeItem('wx_oauth_state');
    if (!savedState || !state || state !== savedState) {
      setPhase('error');
      setMessage('安全校验失败（state 不匹配），请重新扫码登录');
      return;
    }

    if (!supabase) {
      setPhase('error');
      setMessage('Supabase 未配置，无法完成登录');
      return;
    }

    (async () => {
      try {
        // 调用 Edge Function 换取 token_hash
        setMessage('正在获取用户信息…');
        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
        const resp = await fetch(`${supabaseUrl}/functions/v1/wechat-callback`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ code }),
        });

        const data = await resp.json() as {
          ok?: boolean;
          token_hash?: string;
          email?: string;
          nickname?: string;
          error?: string;
        };

        if (!resp.ok || data.error || !data.token_hash) {
          setPhase('error');
          setMessage(data.error ?? '登录失败，请重试');
          return;
        }

        // 用 magic-link token 建立 Supabase 会话
        setMessage(`欢迎，${data.nickname || '微信用户'}！正在进入工作台…`);
        const { error: otpErr } = await supabase.auth.verifyOtp({
          token_hash: data.token_hash,
          type:       'email',
        });

        if (otpErr) {
          setPhase('error');
          setMessage(`会话建立失败: ${otpErr.message}`);
          return;
        }

        setPhase('success');
        // 短暂停顿后跳转
        setTimeout(() => { window.location.href = '/app'; }, 1000);
      } catch (err) {
        setPhase('error');
        setMessage(`网络错误: ${String(err)}`);
      }
    })();
  }, []);

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      background: 'var(--bg-base)', gap: 16, padding: 24,
    }}>
      <div style={{
        background: 'var(--bg-s1)', border: '1px solid var(--border)',
        borderRadius: 20, padding: '40px 48px', maxWidth: 360, width: '100%',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, textAlign: 'center',
      }}>
        {phase === 'verifying' && (
          <>
            <div style={{ width: 52, height: 52, borderRadius: 14, background: '#07c16015', border: '1px solid #07c16040', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Loader2 size={24} className="animate-spin" style={{ color: '#07c160' }} />
            </div>
            <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-1)' }}>微信登录验证中</p>
            <p style={{ fontSize: 13, color: 'var(--text-3)' }}>{message}</p>
          </>
        )}

        {phase === 'success' && (
          <>
            <div style={{ width: 52, height: 52, borderRadius: 14, background: 'var(--green-dim)', border: '1px solid #1e4d27', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <CheckCircle2 size={24} style={{ color: 'var(--green)' }} />
            </div>
            <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-1)' }}>登录成功</p>
            <p style={{ fontSize: 13, color: 'var(--text-3)' }}>{message}</p>
          </>
        )}

        {phase === 'error' && (
          <>
            <div style={{ width: 52, height: 52, borderRadius: 14, background: '#3a0f0f', border: '1px solid #5a1e1e', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <AlertCircle size={24} style={{ color: 'var(--red)' }} />
            </div>
            <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-1)' }}>登录失败</p>
            <p style={{ fontSize: 13, color: 'var(--text-3)' }}>{message}</p>
            <button
              onClick={() => { window.location.href = '/'; }}
              style={{ marginTop: 4, padding: '9px 24px', borderRadius: 9, fontSize: 13, fontWeight: 600, cursor: 'pointer', background: 'var(--accent)', color: '#fff', border: 'none' }}
            >
              返回首页重试
            </button>
          </>
        )}
      </div>
    </div>
  );
}
