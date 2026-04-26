import { useState, useCallback, useEffect } from 'react';
import { Settings as SettingsIcon, BookOpen, LogOut, User, Zap, Home, Users, Layout, Bot, Clock } from 'lucide-react';
import { useAuth } from './context/AuthContext';
import { useSubscription, PLAN_CONFIG } from './context/SubscriptionContext';
import { TaskPanel } from './components/TaskPanel';
import { RightPanel } from './components/RightPanel';
import { SettingsModal } from './components/SettingsModal';
import { StudentArchive } from './components/StudentArchive';
import { AgentChat } from './components/AgentChat';

type AppMode = 'workbench' | 'archive' | 'agent';
import { useTaskManager } from './hooks/useTaskManager';
import { isElectronTarget, isRunningInElectron } from './config/app';
import { mergePlatformApiSettings, hasPlatformLlm, hasPlatformXf } from './config/platformApi';
import type { Settings } from './types';

function loadUserPrefsFromStorage(): { language: string; feedbackPrompt?: string } {
  try {
    const raw = localStorage.getItem('tw-settings');
    if (!raw) return { language: 'zh-CN' };
    const p = JSON.parse(raw) as { language?: string; feedbackPrompt?: string };
    return { language: p.language || 'zh-CN', feedbackPrompt: p.feedbackPrompt };
  } catch {
    return { language: 'zh-CN' };
  }
}

function loadSettings(): Settings {
  return mergePlatformApiSettings(loadUserPrefsFromStorage());
}

export default function App() {
  const { user, authEnabled, signOut } = useAuth();
  const subscription = useSubscription();

  // 工作台模式：body 锁高禁滚；卸载时恢复（落地页需要滚动）
  useEffect(() => {
    document.body.classList.add('app-mode');
    return () => document.body.classList.remove('app-mode');
  }, []);

  const [mode, setMode] = useState<AppMode>('workbench');
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [showSettings, setShowSettings] = useState(false);
  const [language, setLanguage] = useState(settings.language || 'zh-CN');
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  const taskManager = useTaskManager(settings, language);

  const needsConfig = !hasPlatformLlm() || !hasPlatformXf();

  const handleSaveSettings = useCallback((s: Settings) => {
    const next = mergePlatformApiSettings({
      language: s.language,
      feedbackPrompt: s.feedbackPrompt,
    });
    setSettings(next);
    try {
      localStorage.setItem('tw-settings', JSON.stringify({
        language: next.language,
        feedbackPrompt: next.feedbackPrompt,
      }));
    } catch { /* */ }
  }, []);

  const handleLanguageChange = useCallback((lang: string) => {
    setLanguage(lang);
    handleSaveSettings({ ...settings, language: lang });
  }, [settings, handleSaveSettings]);

  const handleCreateTask = useCallback((
    name: string, topic: string, prompt: string, file: File,
  ) => {
    taskManager.createTask(name, topic, prompt, file);
  }, [taskManager]);

  const handleSaveToTask = useCallback((taskId: string, summary: string) => {
    taskManager.saveAISummary(taskId, summary);
  }, [taskManager]);

  const handleSaveNotes = useCallback((taskId: string, notes: string) => {
    taskManager.saveNotes(taskId, notes);
  }, [taskManager]);

  // 从档案页跳回工作台并选中对应任务
  const handleGotoTask = useCallback((taskId: string) => {
    setSelectedTaskId(taskId);
    setMode('workbench');
  }, []);

  return (
    <div className="flex flex-col h-screen" style={{ background: 'var(--bg-base)' }}>
      {/* ── Header ── */}
      <header
        className="flex items-center justify-between shrink-0 drag-region"
        style={{
          borderBottom: '1px solid var(--border)',
          padding: '0 20px',
          height: 52,
          paddingLeft: isRunningInElectron() ? 84 : 20,
        }}
      >
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-7 h-7 rounded-lg"
            style={{ background: 'linear-gradient(135deg, #4493f8 0%, #7c4af8 100%)' }}>
            <BookOpen size={14} className="text-white" />
          </div>
          <div className="flex items-center gap-2">
            <span className="font-semibold text-sm" style={{ color: 'var(--text-1)' }}>
              语文教学工作台
            </span>
            <span className="text-xs px-2 py-0.5 rounded-full font-medium"
              style={{ background: 'var(--bg-s3)', color: 'var(--text-3)', border: '1px solid var(--border)' }}>
              Beta
            </span>
          </div>

          {/* 模式切换标签 */}
          <div className="flex items-center gap-0.5 ml-4 p-0.5 rounded-lg" style={{ background: 'var(--bg-s2)', border: '1px solid var(--border)' }}>
            {([
              { key: 'workbench', icon: Layout,  label: '工作台' },
              { key: 'archive',   icon: Users,   label: '学生档案' },
              { key: 'agent',     icon: Bot,     label: 'AI 助手' },
            ] as { key: AppMode; icon: typeof Layout; label: string }[]).map(({ key, icon: Icon, label }) => (
              <button
                key={key}
                onClick={() => setMode(key)}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md font-medium transition-all"
                style={mode === key ? {
                  background: key === 'agent' ? 'linear-gradient(135deg,#4493f820,#7c4af820)' : 'var(--bg-s1)',
                  color: key === 'agent' ? 'var(--accent)' : 'var(--text-1)',
                  border: `1px solid ${key === 'agent' ? '#4493f840' : 'var(--border)'}`,
                  boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                } : {
                  background: 'transparent', color: 'var(--text-3)', border: '1px solid transparent',
                }}
              >
                <Icon size={11} /> {label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2 no-drag">

          {/* 配额进度条（Web 模式 + 有限配额） */}
          {!isElectronTarget && isFinite(subscription.quotaMinutes) && !subscription.loading && (
            <QuotaBar
              plan={subscription.plan}
              usedMinutes={subscription.usedMinutes}
              quotaMinutes={subscription.quotaMinutes}
            />
          )}

          {/* Web 模式：升级入口（免费版或接近超额时高亮） */}
          {!isElectronTarget && (
            <a
              href="/#pricing"
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-semibold transition-all"
              style={
                subscription.plan === 'free' || subscription.remainingMinutes < 30
                  ? { background: 'linear-gradient(to right,#7c2d12,#1a1a40)', border: '1px solid #c2410c80', color: '#fb923c', textDecoration: 'none' }
                  : { background: 'linear-gradient(to right, #1a2a4f, #1a1a40)', border: '1px solid #2a3f6f', color: '#7ba7ff', textDecoration: 'none' }
              }
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = '0.85'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = '1'; }}
            >
              <Zap size={11} /> 升级方案
            </a>
          )}

          {/* Web 模式：返回落地页 */}
          {!isElectronTarget && (
            <a
              href="/"
              title="返回首页"
              className="flex items-center justify-center p-1.5 rounded-lg transition-all"
              style={{ color: 'var(--text-3)', border: '1px solid var(--border)', background: 'transparent', textDecoration: 'none' }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'var(--text-1)'; (e.currentTarget as HTMLElement).style.borderColor = 'var(--border-light)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--text-3)'; (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)'; }}
            >
              <Home size={13} />
            </a>
          )}

          {/* 用户状态（Web 模式 + 已配置 Supabase） */}
          {authEnabled && user && (
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg"
                style={{ background: 'var(--bg-s2)', border: '1px solid var(--border)', color: 'var(--text-2)' }}>
                <User size={11} style={{ color: 'var(--accent)' }} />
                <span style={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {/* 微信用户优先显示 nickname，邮箱用户显示邮箱前缀 */}
                  {(user.user_metadata?.nickname as string | undefined) ||
                   (user.email?.startsWith('wx_') ? '微信用户' : (user.email?.split('@')[0] ?? user.email))}
                </span>
              </div>
              <button
                onClick={signOut}
                title="退出登录"
                className="flex items-center justify-center p-1.5 rounded-lg transition-all"
                style={{ color: 'var(--text-3)', border: '1px solid var(--border)', background: 'transparent' }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'var(--red)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--text-3)'; }}
              >
                <LogOut size={12} />
              </button>
            </div>
          )}

          {/* Web 模式 + 未登录：注册入口 */}
          {!isElectronTarget && authEnabled && !user && (
            <a
              href="/?register=1"
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-medium transition-all"
              style={{ background: 'var(--accent)', color: '#fff', border: 'none', textDecoration: 'none' }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = '0.85'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = '1'; }}
            >
              <User size={11} /> 注册登录
            </a>
          )}

        <button
          onClick={() => setShowSettings(true)}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg transition-all"
          style={needsConfig ? {
            color: 'var(--amber)',
            background: 'var(--amber-dim)',
            border: '1px solid #5a3d0a',
          } : {
            color: 'var(--text-2)',
            background: 'transparent',
            border: '1px solid var(--border)',
          }}
          onMouseEnter={e => {
            if (!needsConfig) {
              (e.currentTarget as HTMLElement).style.color = 'var(--text-1)';
              (e.currentTarget as HTMLElement).style.background = 'var(--bg-s3)';
            }
          }}
          onMouseLeave={e => {
            if (!needsConfig) {
              (e.currentTarget as HTMLElement).style.color = 'var(--text-2)';
              (e.currentTarget as HTMLElement).style.background = 'transparent';
            }
          }}
        >
          <SettingsIcon size={13} />
          {needsConfig ? '环境未就绪' : '设置'}
        </button>
        </div>
      </header>

      {/* ── Main ── */}
      <main className="flex-1 min-h-0" style={{ padding: '12px' }}>
        {mode === 'workbench' && (
          <div className="flex h-full" style={{ gap: '10px' }}>
            {/* Left sidebar */}
            <div className="shrink-0" style={{ width: 300 }}>
              <TaskPanel
                tasks={taskManager.tasks}
                hasXfCredentials={hasPlatformXf()}
                selectedTaskId={selectedTaskId}
                onSelectTask={setSelectedTaskId}
                onCreateTask={handleCreateTask}
                onDeleteTask={taskManager.deleteTask}
                onCancelTask={taskManager.cancelTask}
                onRetryTask={taskManager.retryTask}
                isStudentArchived={taskManager.isStudentArchived}
                onArchiveStudent={taskManager.archiveStudent}
                onUnarchiveStudent={taskManager.unarchiveStudent}
                language={language}
                onLanguageChange={handleLanguageChange}
              />
            </div>
            {/* Right panel */}
            <div className="flex-1 min-w-0">
              <RightPanel
                tasks={taskManager.tasks}
                settings={settings}
                selectedTaskId={selectedTaskId}
                onSaveToTask={handleSaveToTask}
                onSaveNotes={handleSaveNotes}
              />
            </div>
          </div>
        )}
        {mode === 'archive' && (
          <StudentArchive
            tasks={taskManager.tasks}
            onGotoTask={handleGotoTask}
          />
        )}
        {mode === 'agent' && (
          <AgentChat
            tasks={taskManager.tasks}
            settings={settings}
            onSaveFeedback={handleSaveToTask}
          />
        )}
      </main>

      {showSettings && (
        <SettingsModal
          settings={settings}
          onSave={handleSaveSettings}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}

// ─── QuotaBar ──────────────────────────────────────────────────────────────────

function QuotaBar({ plan, usedMinutes, quotaMinutes }: {
  plan: string; usedMinutes: number; quotaMinutes: number;
}) {
  const usedH = (usedMinutes / 60).toFixed(1);
  const totalH = (quotaMinutes / 60).toFixed(0);
  const pct = Math.min(100, Math.round((usedMinutes / quotaMinutes) * 100));
  const isWarning = pct >= 80;
  const isFull    = pct >= 100;

  const barColor = isFull ? '#ef4444' : isWarning ? '#f59e0b' : '#4493f8';
  const label    = PLAN_CONFIG[plan as keyof typeof PLAN_CONFIG]?.label ?? plan;

  return (
    <div
      className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg"
      style={{ background: 'var(--bg-s2)', border: '1px solid var(--border)', minWidth: 140 }}
      title={`${label}：已用 ${usedH}h / ${totalH}h`}
    >
      <Clock size={10} style={{ color: barColor, flexShrink: 0 }} />
      <div className="flex flex-col gap-0.5" style={{ flex: 1 }}>
        <div className="flex items-center justify-between">
          <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>{label}</span>
          <span className="text-[10px] font-medium" style={{ color: isFull ? '#ef4444' : 'var(--text-2)' }}>
            {isFull ? '已用尽' : `${usedH}/${totalH}h`}
          </span>
        </div>
        <div className="rounded-full overflow-hidden" style={{ height: 3, background: 'var(--bg-s3)' }}>
          <div style={{ width: `${pct}%`, height: '100%', background: barColor, borderRadius: 999, transition: 'width 0.3s' }} />
        </div>
      </div>
    </div>
  );
}
