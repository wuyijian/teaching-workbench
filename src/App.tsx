import { useState, useCallback } from 'react';
import { Settings as SettingsIcon, BookOpen } from 'lucide-react';
import { TaskPanel } from './components/TaskPanel';
import { RightPanel } from './components/RightPanel';
import { SettingsModal } from './components/SettingsModal';
import { useTaskManager } from './hooks/useTaskManager';
import { defaultOpenAiCompatibleBase, isElectronTarget, isRunningInElectron } from './config/app';
import type { Settings, TranscribeEngine } from './types';

const DEFAULT_SETTINGS: Settings = {
  apiKey: '',
  apiBaseUrl: defaultOpenAiCompatibleBase,
  model: 'gpt-4o-mini',
  language: 'zh-CN',
  xfAppId: '',
  xfAccessKeyId: '',
  xfAccessKeySecret: '',
};

function loadSettings(): Settings {
  const web = !isElectronTarget;
  try {
    const s = localStorage.getItem('tw-settings');
    const next: Settings = s ? { ...DEFAULT_SETTINGS, ...JSON.parse(s) } : { ...DEFAULT_SETTINGS };

    if (web && next.apiBaseUrl === 'https://api.openai.com/v1') {
      // 网页版：直连 OpenAI 会被 CORS 拦截，改走同域反代
      next.apiBaseUrl = defaultOpenAiCompatibleBase;
    }

    if (!web && next.apiBaseUrl.startsWith('/')) {
      // Electron：file:// 无法解析相对路径，还原为直连地址
      next.apiBaseUrl = 'https://api.openai.com/v1';
    }

    return next;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export default function App() {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [showSettings, setShowSettings] = useState(false);
  const [language, setLanguage] = useState(settings.language || 'zh-CN');
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  const taskManager = useTaskManager(settings, language);

  const hasXfCredentials = !!(settings.xfAppId && settings.xfAccessKeyId && settings.xfAccessKeySecret);
  const needsConfig = !settings.apiKey && !hasXfCredentials;

  const handleSaveSettings = useCallback((s: Settings) => {
    setSettings(s);
    localStorage.setItem('tw-settings', JSON.stringify(s));
  }, []);

  const handleLanguageChange = useCallback((lang: string) => {
    setLanguage(lang);
    handleSaveSettings({ ...settings, language: lang });
  }, [settings, handleSaveSettings]);

  const handleCreateTask = useCallback((
    name: string, topic: string, prompt: string, engine: TranscribeEngine, file: File,
  ) => {
    taskManager.createTask(name, topic, prompt, engine, file);
  }, [taskManager]);

  const handleSaveToTask = useCallback((taskId: string, summary: string) => {
    taskManager.saveAISummary(taskId, summary);
  }, [taskManager]);

  return (
    <div className="flex flex-col h-screen" style={{ background: 'var(--bg-base)' }}>
      {/* ── Header ── */}
      <header
        className="flex items-center justify-between shrink-0"
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
        </div>

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
          {needsConfig ? '配置服务' : '设置'}
        </button>
      </header>

      {/* ── Main ── */}
      <main className="flex-1 flex min-h-0" style={{ padding: '12px', gap: '10px' }}>
        {/* Left sidebar */}
        <div className="shrink-0" style={{ width: 300 }}>
          <TaskPanel
            tasks={taskManager.tasks}
            hasXfCredentials={hasXfCredentials}
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
          />
        </div>
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
