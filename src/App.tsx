import { useState, useCallback, useEffect, useMemo } from 'react';
import { Settings as SettingsIcon, BookOpen, LogOut, User, Zap, Home, Clock, ChevronLeft } from 'lucide-react';
import { useAuth } from './context/AuthContext';
import { useSubscription, PLAN_CONFIG } from './context/SubscriptionContext';
import { TaskPanel } from './components/TaskPanel';
import { RightPanel } from './components/RightPanel';
import { SettingsModal } from './components/SettingsModal';
import { StudentArchive } from './components/StudentArchive';
import { AgentChat } from './components/AgentChat';
import { FeedbackButton } from './components/FeedbackButton';
import { BottomNav } from './components/BottomNav';
import { useTaskManager } from './hooks/useTaskManager';
import { useIsMobile } from './hooks/useIsMobile';
import { isElectronTarget, isRunningInElectron } from './config/app';
import { mergePlatformApiSettings, hasPlatformLlm, hasPlatformXf } from './config/platformApi';
import type { Settings, AppMode } from './types';
import { useOnboarding } from './hooks/useOnboarding';
import { OnboardingGuide } from './components/OnboardingGuide';
import { DEMO_LESSON } from './data/demoLesson';

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
  const { user, authEnabled, signOut, openAuthModal } = useAuth();
  const subscription = useSubscription();

  // 工作台模式：body 锁高禁滚；卸载时恢复（落地页需要滚动）
  useEffect(() => {
    document.body.classList.add('app-mode');
    return () => document.body.classList.remove('app-mode');
  }, []);

  const isMobile = useIsMobile();
  const [mode, setMode] = useState<AppMode>('workbench');
  // 手机端：'list' = 任务列表，'detail' = 反馈详情
  const [mobilePanel, setMobilePanel] = useState<'list' | 'detail'>('list');
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [showSettings, setShowSettings] = useState(false);
  const [language, setLanguage] = useState(settings.language || 'zh-CN');
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  // 把订阅守门 + 扣量注入任务管理器
  const taskManager = useTaskManager(settings, language, {
    requireTranscribe: (estMin: number) => subscription.requireAccess('transcribe', estMin).ok,
    recordUsage: (mins: number) => subscription.recordUsage(mins),
  });

  const needsConfig = !hasPlatformLlm() || !hasPlatformXf();

  const pendingFeedbackCount = useMemo(
    () => taskManager.tasks.filter(t => t.status === 'done' && !t.aiSummary && t.segments.length > 0).length,
    [taskManager.tasks],
  );

  // ── 新手引导 ──────────────────────────────────────────────────────────────
  const onboarding = useOnboarding();

  // 监听 OnboardingGuide 内部事件，推进步骤
  useEffect(() => {
    const onTranscript = (e: Event) => {
      const id = (e as CustomEvent<{ id: string }>).detail.id;
      setSelectedTaskId(id);
      onboarding.advance('transcript');
    };
    const onFeedback = () => onboarding.advance('feedback');
    window.addEventListener('onboarding:transcript', onTranscript);
    window.addEventListener('onboarding:feedback', onFeedback);
    return () => {
      window.removeEventListener('onboarding:transcript', onTranscript);
      window.removeEventListener('onboarding:feedback', onFeedback);
    };
  }, [onboarding]);

  // Demo 注入函数（由 OnboardingGuide 调用）
  const handleInjectDemo = useCallback(() => {
    const prompt = settings.feedbackPrompt ?? '';
    return taskManager.injectDoneTask(
      DEMO_LESSON.studentName,
      DEMO_LESSON.topic,
      prompt,
      DEMO_LESSON.audioFileName,
      DEMO_LESSON.segments,
    );
  }, [taskManager, settings.feedbackPrompt]);

  // 当前选中任务是否已有 AI 反馈（供引导检测）
  const selectedTaskHasFeedback = useMemo(() => {
    if (!selectedTaskId) return false;
    const t = taskManager.tasks.find(t => t.id === selectedTaskId);
    return !!(t?.aiSummary);
  }, [selectedTaskId, taskManager.tasks]);

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
    names: string[], topic: string, prompt: string, file: File,
  ) => {
    taskManager.createTask(names, topic, prompt, file);
  }, [taskManager]);

  const handleSaveToTask = useCallback((taskId: string, summary: string) => {
    taskManager.saveAISummary(taskId, summary);
  }, [taskManager]);

  const handleSaveNotes = useCallback((taskId: string, notes: string) => {
    taskManager.saveNotes(taskId, notes);
  }, [taskManager]);

  // 手机端选中任务时自动跳到详情页
  const handleSelectTask = useCallback((id: string | null) => {
    setSelectedTaskId(id);
    if (id && isMobile) setMobilePanel('detail');
  }, [isMobile]);

  // 从档案页跳回工作台并选中对应任务
  const handleGotoTask = useCallback((taskId: string) => {
    setSelectedTaskId(taskId);
    setMode('workbench');
    if (isMobile) setMobilePanel('detail');
  }, [isMobile]);

  // ── 手机端返回标题逻辑 ─────────────────────────────────────────────────────
  const mobileBackTitle = (() => {
    if (!isMobile) return null;
    if (mode === 'workbench' && mobilePanel === 'detail') {
      const t = taskManager.tasks.find(t => t.id === selectedTaskId);
      return t ? `${t.studentName} · ${t.topic || '反馈'}` : '反馈详情';
    }
    return null;
  })();

  const handleModeChange = (m: AppMode) => {
    setMode(m);
    if (m === 'workbench') setMobilePanel('list');
  };

  return (
    <div className="flex flex-col h-screen" style={{ background: 'var(--bg-base)' }}>
      {/* ── Header ── */}
      <header
        className="flex items-center justify-between shrink-0 drag-region"
        style={{
          borderBottom: '1px solid var(--border)',
          background: 'var(--bg-s2)',
          padding: '0 16px',
          height: isMobile ? 48 : 52,
          paddingLeft: isRunningInElectron() ? 84 : 16,
        }}
      >
        {/* 左侧：logo / 返回按钮 */}
        <div className="flex items-center gap-2 no-drag">
          {mobileBackTitle ? (
            /* 手机端详情页：返回按钮 */
            <button
              onClick={() => setMobilePanel('list')}
              className="flex items-center gap-1.5 -ml-1 px-2 py-1.5 rounded-lg"
              style={{ color: 'var(--accent)', background: 'transparent', border: 'none', cursor: 'pointer' }}
            >
              <ChevronLeft size={18} strokeWidth={2.5} />
              <span className="text-sm font-medium" style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {mobileBackTitle}
              </span>
            </button>
          ) : (
            /* 默认：logo + 标题 */
            <div className="flex items-center gap-2">
              <div className="flex items-center justify-center w-7 h-7 rounded-lg"
                style={{ background: 'linear-gradient(135deg, #4493f8 0%, #7c4af8 100%)' }}>
                <BookOpen size={14} className="text-white" />
              </div>
              <span className="font-semibold text-sm" style={{ color: 'var(--text-1)' }}>
                {isMobile ? '教学工作台' : '语文教学工作台'}
              </span>
              {!isMobile && (
                <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                  style={{ background: 'var(--bg-s3)', color: 'var(--text-3)', border: '1px solid var(--border)' }}>
                  Beta
                </span>
              )}
            </div>
          )}

          {/* 桌面端：模式切换 Tab */}
          {!isMobile && (
            <div className="flex items-center gap-0.5 ml-4 p-0.5 rounded-lg" style={{ background: 'var(--bg-s1)', border: '1px solid var(--border)' }}>
              {([
                { key: 'workbench' as AppMode, label: '工作台' },
                { key: 'archive'   as AppMode, label: '学生档案' },
                { key: 'agent'     as AppMode, label: 'AI 助手' },
              ]).map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setMode(key)}
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md font-medium transition-all"
                  style={mode === key ? {
                    background: key === 'agent' ? 'linear-gradient(135deg,#4493f820,#7c4af820)' : 'var(--bg-s2)',
                    color: key === 'agent' ? 'var(--accent)' : 'var(--text-1)',
                    border: `1px solid ${key === 'agent' ? '#4493f840' : 'var(--border)'}`,
                    boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                  } : {
                    background: 'transparent', color: 'var(--text-3)', border: '1px solid transparent',
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 右侧操作区 */}
        <div className="flex items-center gap-2 no-drag">

          {/* 配额进度条（桌面 + Web 模式 + 有限配额） */}
          {!isMobile && !isElectronTarget && isFinite(subscription.quotaMinutes) && !subscription.loading && (
            <QuotaBar
              plan={subscription.plan}
              usedMinutes={subscription.usedMinutes}
              quotaMinutes={subscription.quotaMinutes}
            />
          )}

          {/* 升级方案（手机端简化为 Zap 图标按钮） */}
          {!isElectronTarget && (
            <button
              onClick={() => subscription.openUpgradeModal()}
              className="flex items-center gap-1.5 rounded-lg font-semibold transition-all"
              style={{
                ...(subscription.plan === 'free' || subscription.remainingMinutes < 30
                  ? { background: 'linear-gradient(to right,#7c2d12,#1a1a40)', border: '1px solid #c2410c80', color: '#fb923c' }
                  : { background: 'linear-gradient(to right, #1a2a4f, #1a1a40)', border: '1px solid #2a3f6f', color: '#7ba7ff' }),
                fontSize: 12,
                padding: isMobile ? '6px 8px' : '6px 10px',
                cursor: 'pointer',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = '0.85'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = '1'; }}
            >
              <Zap size={12} />
              {!isMobile && <span style={{ marginLeft: 4 }}>升级</span>}
            </button>
          )}

          {/* 返回首页（桌面） */}
          {!isMobile && !isElectronTarget && (
            <a
              href="/"
              title="返回首页"
              className="flex items-center justify-center p-1.5 rounded-lg transition-all"
              style={{ color: 'var(--text-3)', border: '1px solid var(--border)', background: 'transparent', textDecoration: 'none' }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'var(--text-1)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--text-3)'; }}
            >
              <Home size={13} />
            </a>
          )}

          {/* 用户头像 */}
          {authEnabled && user && (
            <div className="flex items-center gap-1.5">
              {!isMobile && (
                <div className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg"
                  style={{ background: 'var(--bg-s3)', border: '1px solid var(--border)', color: 'var(--text-2)' }}>
                  <User size={11} style={{ color: 'var(--accent)' }} />
                  <span style={{ maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {(user.user_metadata?.nickname as string | undefined) ||
                     (user.email?.startsWith('wx_') ? '微信用户' : (user.email?.split('@')[0] ?? user.email))}
                  </span>
                </div>
              )}
              {isMobile ? (
                /* 手机端：头像圆形按钮，长按退出 */
                <button
                  onClick={signOut}
                  title="退出登录"
                  className="flex items-center justify-center w-8 h-8 rounded-full"
                  style={{ background: 'var(--accent)', color: '#fff', border: 'none', cursor: 'pointer', flexShrink: 0 }}
                >
                  <span style={{ fontSize: 13, fontWeight: 700 }}>
                    {((user.user_metadata?.nickname as string | undefined) || user.email || '?')
                      .slice(0, 1).toUpperCase()}
                  </span>
                </button>
              ) : (
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
              )}
            </div>
          )}

          {/* 未登录注册入口 */}
          {!isElectronTarget && authEnabled && !user && (
            <button
              onClick={() => openAuthModal('register')}
              className="flex items-center gap-1.5 rounded-lg font-medium transition-all"
              style={{ background: 'var(--accent)', color: '#fff', border: 'none', cursor: 'pointer',
                       fontSize: 12, padding: isMobile ? '6px 10px' : '6px 12px' }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = '0.85'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = '1'; }}
            >
              <User size={11} />
              {!isMobile && <span style={{ marginLeft: 4 }}>注册登录</span>}
            </button>
          )}

          {/* 反馈建议（桌面） */}
          {!isMobile && <FeedbackButton />}

          {/* 设置 */}
          <button
            onClick={() => setShowSettings(true)}
            className="flex items-center gap-1.5 rounded-lg transition-all"
            style={{
              ...(needsConfig
                ? { color: 'var(--amber)', background: 'var(--amber-dim)', border: '1px solid #5a3d0a' }
                : { color: 'var(--text-2)', background: 'transparent', border: '1px solid var(--border)' }),
              fontSize: 12,
              padding: isMobile ? '6px 8px' : '6px 10px',
              cursor: 'pointer',
            }}
            onMouseEnter={e => {
              if (!needsConfig) (e.currentTarget as HTMLElement).style.background = 'var(--bg-s3)';
            }}
            onMouseLeave={e => {
              if (!needsConfig) (e.currentTarget as HTMLElement).style.background = 'transparent';
            }}
          >
            <SettingsIcon size={13} />
            {!isMobile && <span style={{ marginLeft: 4 }}>{needsConfig ? '环境未就绪' : '设置'}</span>}
          </button>
        </div>
      </header>

      {/* ── Main ──
          三个 mode 都常驻挂载（用 hidden 切显隐）保持反馈生成不中断 */}
      <main className="flex-1 min-h-0 relative">

        {/* 工作台 */}
        <div
          className={`absolute inset-0 ${mode === 'workbench' ? '' : 'hidden'}`}
          style={{ padding: isMobile ? '8px' : '12px' }}
        >
          {isMobile ? (
            /* ── 手机端：单列切换 ── */
            <>
              {/* 任务列表视图 */}
              <div className={`absolute inset-0 ${mobilePanel === 'list' ? '' : 'hidden'}`}
                style={{ padding: '8px' }}>
                <TaskPanel
                  tasks={taskManager.tasks}
                  hasXfCredentials={hasPlatformXf()}
                  selectedTaskId={selectedTaskId}
                  onSelectTask={handleSelectTask}
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
              {/* 反馈详情视图 */}
              <div className={`absolute inset-0 ${mobilePanel === 'detail' ? '' : 'hidden'}`}
                style={{ padding: '8px' }}>
                <RightPanel
                  tasks={taskManager.tasks}
                  settings={settings}
                  selectedTaskId={selectedTaskId}
                  onSaveToTask={handleSaveToTask}
                  onSaveNotes={handleSaveNotes}
                />
              </div>
            </>
          ) : (
            /* ── 桌面端：左右两列 ── */
            <div className="flex h-full" style={{ gap: '10px' }}>
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
        </div>

        {/* 学生档案 */}
        <div
          className={`absolute inset-0 ${mode === 'archive' ? '' : 'hidden'}`}
          style={{ padding: isMobile ? '8px' : '12px' }}
        >
          <StudentArchive
            tasks={taskManager.tasks}
            onGotoTask={handleGotoTask}
          />
        </div>

        {/* AI 助手 */}
        <div
          className={`absolute inset-0 ${mode === 'agent' ? '' : 'hidden'}`}
          style={{ padding: isMobile ? '8px' : '12px' }}
        >
          <AgentChat
            tasks={taskManager.tasks}
            settings={settings}
            onSaveFeedback={handleSaveToTask}
          />
        </div>
      </main>

      {/* ── 手机端底部导航 ── */}
      {isMobile && (
        <BottomNav
          mode={mode}
          onChange={handleModeChange}
          agentBadge={pendingFeedbackCount}
        />
      )}

      {showSettings && (
        <SettingsModal
          settings={settings}
          onSave={handleSaveSettings}
          onClose={() => setShowSettings(false)}
        />
      )}

      {/* 新手引导 */}
      {onboarding.step !== 'idle' && (
        <OnboardingGuide
          step={onboarding.step}
          onStart={() => onboarding.advance('creating')}
          onSkip={onboarding.skip}
          onComplete={onboarding.complete}
          onInjectDemo={handleInjectDemo}
          onSelectTask={(id) => { handleSelectTask(id); }}
          selectedTaskHasFeedback={selectedTaskHasFeedback}
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
