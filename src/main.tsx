import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { LandingPage } from './LandingPage.tsx'
import { WechatCallbackPage } from './pages/WechatCallbackPage.tsx'
import { AuthProvider } from './context/AuthContext.tsx'
import { SubscriptionProvider } from './context/SubscriptionContext.tsx'
import { isElectronTarget } from './config/app.ts'

// 路由判断（客户端路由，无需 react-router）
const path = window.location.pathname

function Root() {
  // 微信 OAuth 回调页
  if (path.startsWith('/auth/wechat/callback')) {
    return <WechatCallbackPage />;
  }
  // 工作台（Electron 桌面端始终进工作台）
  if (isElectronTarget || path.startsWith('/app')) {
    return <App />;
  }
  // 落地页（默认）
  return <LandingPage />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <SubscriptionProvider>
        <Root />
      </SubscriptionProvider>
    </AuthProvider>
  </StrictMode>,
)
