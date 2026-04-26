import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { LandingPage } from './LandingPage.tsx'
import { isElectronTarget } from './config/app.ts'

// Electron 桌面端直接进工作台；Web 端根据路径区分落地页与工作台
// / 或 /index.html → 落地页   /app → 工作台
const isAppPath = isElectronTarget || window.location.pathname.startsWith('/app')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isAppPath ? <App /> : <LandingPage />}
  </StrictMode>,
)
