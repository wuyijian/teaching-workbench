import { StrictMode, useEffect, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { LandingPage } from './LandingPage.tsx'
import { WechatCallbackPage } from './pages/WechatCallbackPage.tsx'
import { AuthProvider, useAuth } from './context/AuthContext.tsx'
import { SubscriptionProvider } from './context/SubscriptionContext.tsx'
import { isElectronTarget } from './config/app.ts'
import { AppErrorBoundary } from './components/AppErrorBoundary.tsx'

// 客户端路由（无需 react-router）：
//   /                       → 落地页
//   /app                    → 工作台（未登录会被守卫挡回登录弹窗）
//   /auth/wechat/callback   → 微信 OAuth 回调中转
const path = window.location.pathname

function Root() {
  const { user, loading, authEnabled } = useAuth()

  // 微信 OAuth 回调
  if (path.startsWith('/auth/wechat/callback')) return <WechatCallbackPage />

  // Electron 桌面端：始终进工作台（无云端账号体系）
  if (isElectronTarget) return <App />

  const wantApp = path.startsWith('/app')

  // 未启用 Supabase（自建/无 auth 模式）：按 URL 直接路由
  if (!authEnabled) return wantApp ? <App /> : <LandingPage />

  // 启用了 auth + 想进工作台 → 三态守卫
  if (wantApp) {
    if (loading) return <FullScreenLoader />          // 会话恢复中
    if (!user)   return <LoginGate />                 // 未登录 → 落地页 + 自动弹登录
    return <App />                                     // 已登录 → 工作台
  }

  return <LandingPage />
}

// ─── 子组件：会话恢复中的占位 ────────────────────────────────────────────────
function FullScreenLoader() {
  return (
    <div style={{
      position: 'fixed', inset: 0, display: 'flex',
      alignItems: 'center', justifyContent: 'center',
      background: '#07080f', color: '#7e90b0',
      fontSize: 14, gap: 10,
    }}>
      <div style={{
        width: 14, height: 14, borderRadius: '50%',
        border: '2px solid #4d7fff', borderRightColor: 'transparent',
        animation: 'spin 0.7s linear infinite',
      }} />
      正在恢复会话…
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}

// ─── 子组件：未登录访问 /app 时的拦截 ────────────────────────────────────────
// 行为：把 URL 改回 /，渲染落地页，自动弹登录框；
//      并把 "post-login-redirect=/app" 写入 sessionStorage，
//      AuthContext 的 onSuccess 看到后会自动 location.href='/app'。
function LoginGate() {
  const { openAuthModal } = useAuth()
  const opened = useRef(false)

  useEffect(() => {
    sessionStorage.setItem('post-login-redirect', '/app')
    window.history.replaceState({}, '', '/')
    if (!opened.current) {
      opened.current = true
      openAuthModal('login')
    }
  }, [openAuthModal])

  return <LandingPage />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      <AuthProvider>
        <SubscriptionProvider>
          <Root />
        </SubscriptionProvider>
      </AuthProvider>
    </AppErrorBoundary>
  </StrictMode>,
)
