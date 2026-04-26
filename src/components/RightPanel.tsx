import { useState, useEffect } from 'react';
import { Sparkles, MessageSquare } from 'lucide-react';
import type { Task, Settings } from '../types';
import { FeedbackPanel } from './FeedbackPanel';
import { TranscriptChat } from './TranscriptChat';

type Tab = 'feedback' | 'chat';

interface Props {
  tasks: Task[];
  settings: Settings;
  selectedTaskId: string | null;
  onSaveToTask: (taskId: string, summary: string) => void;
  onSaveNotes: (taskId: string, notes: string) => void;
}

export function RightPanel({ tasks, settings, selectedTaskId, onSaveToTask, onSaveNotes }: Props) {
  const [tab, setTab] = useState<Tab>('feedback');
  const selectedTask = tasks.find(t => t.id === selectedTaskId) ?? null;

  useEffect(() => {
    if (selectedTask?.status === 'done') setTab('feedback');
  }, [selectedTask?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const tabs: { id: Tab; icon: React.ReactNode; label: string }[] = [
    { id: 'feedback', icon: <Sparkles size={13} />, label: '课堂反馈' },
    { id: 'chat',     icon: <MessageSquare size={13} />, label: '内容问答' },
  ];

  return (
    <div className="flex flex-col h-full" style={{
      background: 'var(--bg-s1)',
      border: '1px solid var(--border)',
      borderRadius: 12,
    }}>
      {/* Tab bar */}
      <div className="flex items-center gap-1 px-3 shrink-0"
        style={{ borderBottom: '1px solid var(--border)', height: 44 }}>
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
            style={tab === t.id ? {
              color: 'var(--text-1)',
              background: 'var(--bg-s3)',
              border: '1px solid var(--border)',
            } : {
              color: 'var(--text-3)',
              background: 'transparent',
              border: '1px solid transparent',
            }}
            onMouseEnter={e => {
              if (tab !== t.id) {
                (e.currentTarget as HTMLElement).style.color = 'var(--text-2)';
                (e.currentTarget as HTMLElement).style.background = 'var(--bg-s2)';
              }
            }}
            onMouseLeave={e => {
              if (tab !== t.id) {
                (e.currentTarget as HTMLElement).style.color = 'var(--text-3)';
                (e.currentTarget as HTMLElement).style.background = 'transparent';
              }
            }}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0">
        {tab === 'feedback' ? (
          <FeedbackPanel
            tasks={tasks}
            settings={settings}
            selectedTaskId={selectedTaskId}
            onSaveToTask={onSaveToTask}
            onSaveNotes={onSaveNotes}
          />
        ) : (
          <TranscriptChat task={selectedTask} settings={settings} />
        )}
      </div>
    </div>
  );
}
