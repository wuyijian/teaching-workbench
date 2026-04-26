/**
 * 微信扫码登录弹窗
 *
 * 原理：加载官方 WxLogin.js，在指定 div 内渲染二维码 iframe。
 * 用户用微信扫码授权后，微信服务器将浏览器重定向到 redirect_uri?code=xxx&state=yyy。
 * 回调页面 WechatCallbackPage 负责处理 code，完成登录。
 *
 * 前置要求：
 *  1. 微信开放平台已添加「网站应用」并通过审核
 *  2. 在「开发信息」中配置授权回调域（不含 https://，例如 your-app.vercel.app）
 *  3. 环境变量 VITE_WECHAT_APP_ID 已设置
 */

import { useEffect, useRef, useState } from 'react';
import { X, Loader2, RefreshCw } from 'lucide-react';

interface Props {
  onClose: () => void;
}

// WxLogin.js 向 window 注入的全局构造函数
declare global {
  interface Window {
    WxLogin?: new (options: WxLoginOptions) => void;
  }
}
interface WxLoginOptions {
  self_redirect: boolean;
  id:            string;
  appid:         string;
  scope:         string;
  redirect_uri:  string;
  state:         string;
  style?:        string;
  href?:         string;
}

const WXLOGIN_JS = 'https://res.wx.qq.com/connect/zh_CN/htmledition/js/wxLogin.js';
const QR_DIV_ID  = 'wechat-qr-container';

function generateState(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function WechatLoginModal({ onClose }: Props) {
  const [status, setStatus]   = useState<'loading' | 'ready' | 'error'>('loading');
  const [errMsg, setErrMsg]   = useState('');
  const stateRef              = useRef(generateState());
  const scriptRef             = useRef<HTMLScriptElement | null>(null);

  const appId      = import.meta.env.VITE_WECHAT_APP_ID as string | undefined;
  const redirectUri = `${window.location.origin}/auth/wechat/callback`;

  // 持久化 state，供回调页校验
  useEffect(() => {
    sessionStorage.setItem('wx_oauth_state', stateRef.current);
  }, []);

  const initQR = () => {
    if (!window.WxLogin) {
      setStatus('error');
      setErrMsg('WxLogin.js 加载失败，请检查网络');
      return;
    }
    if (!appId) {
      setStatus('error');
      setErrMsg('未配置 VITE_WECHAT_APP_ID，请查阅 .env.example');
      return;
    }
    try {
      new window.WxLogin({
        self_redirect: false,
        id:            QR_DIV_ID,
        appid:         appId,
        scope:         'snsapi_login',
        redirect_uri:  encodeURIComponent(redirectUri),
        state:         stateRef.current,
        style:         'black',
        // 可选：自定义 QR 样式 CSS URL（必须 https + 已备案域名）
        href: '',
      });
      setStatus('ready');
    } catch (e) {
      setStatus('error');
      setErrMsg(`初始化二维码失败: ${String(e)}`);
    }
  };

  // 动态加载 WxLogin.js，避免 CSP 问题
  useEffect(() => {
    if (!appId) {
      setStatus('error');
      setErrMsg('未配置 VITE_WECHAT_APP_ID，请查阅 .env.example');
      return;
    }

    const existing = document.querySelector<HTMLScriptElement>(`script[src="${WXLOGIN_JS}"]`);
    if (existing) {
      if (window.WxLogin) { initQR(); }
      else { existing.addEventListener('load', initQR); }
      return;
    }

    const script = document.createElement('script');
    script.src = WXLOGIN_JS;
    script.async = true;
    script.onload = initQR;
    script.onerror = () => {
      setStatus('error');
      setErrMsg('WxLogin.js 加载失败，请检查网络连接');
    };
    document.body.appendChild(script);
    scriptRef.current = script;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const retry = () => {
    stateRef.current = generateState();
    sessionStorage.setItem('wx_oauth_state', stateRef.current);
    setStatus('loading');
    setErrMsg('');
    const el = document.getElementById(QR_DIV_ID);
    if (el) el.innerHTML = '';
    setTimeout(() => initQR(), 100);
  };

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 500, background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
      onClick={onClose}
    >
      <div
        style={{ background: 'var(--bg-s1)', border: '1px solid var(--border)', borderRadius: 20, overflow: 'hidden', width: 320 }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ padding: '20px 20px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {/* WeChat green icon */}
            <div style={{ width: 28, height: 28, borderRadius: 8, background: '#07c160', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="white">
                <path d="M8.5 11a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm7 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zM3.5 8C3.5 4.41 7.36 1.5 12 1.5S20.5 4.41 20.5 8c0 3.59-3.86 6.5-8.5 6.5-.78 0-1.54-.09-2.26-.25L7 16.5l.93-2.57C5.4 12.75 3.5 10.51 3.5 8z"/>
                <path d="M12 15.5c.78 0 1.54-.09 2.26-.25L17 17.5l-.93-2.57C18.6 13.75 20.5 11.51 20.5 9c0-.17-.01-.34-.02-.5H21C21.28 9.16 21.5 9.57 21.5 10c0 3.59-3.86 6.5-8.5 6.5z" opacity="0.5"/>
              </svg>
            </div>
            <div>
              <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-1)' }}>微信扫码登录</p>
              <p style={{ fontSize: 11, color: 'var(--text-3)' }}>使用微信 APP 扫描下方二维码</p>
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)' }}>
            <X size={15} />
          </button>
        </div>

        {/* QR Area */}
        <div style={{ padding: '24px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, minHeight: 260 }}>
          {status === 'loading' && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, marginTop: 40 }}>
              <Loader2 size={28} className="animate-spin" style={{ color: '#07c160' }} />
              <p style={{ fontSize: 13, color: 'var(--text-3)' }}>二维码加载中…</p>
            </div>
          )}

          {status === 'error' && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, marginTop: 20, textAlign: 'center' }}>
              <p style={{ fontSize: 13, color: 'var(--red)' }}>{errMsg}</p>
              <button
                onClick={retry}
                style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, padding: '8px 16px', borderRadius: 8, cursor: 'pointer', background: '#07c160', color: '#fff', border: 'none', fontWeight: 600 }}
              >
                <RefreshCw size={12} /> 重试
              </button>
            </div>
          )}

          {/* WxLogin.js 渲染的 QR 容器 */}
          <div
            id={QR_DIV_ID}
            style={{ width: 200, height: 200, display: status === 'ready' ? 'block' : 'none' }}
          />

          {status === 'ready' && (
            <p style={{ fontSize: 12, color: 'var(--text-3)', textAlign: 'center' }}>
              二维码有效期 5 分钟 · 过期请{' '}
              <button onClick={retry} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#07c160', fontSize: 12 }}>刷新</button>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
