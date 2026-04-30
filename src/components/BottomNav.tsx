import { Layout, Users, Bot } from 'lucide-react';
import type { AppMode } from '../types';

interface Props {
  mode: AppMode;
  onChange: (mode: AppMode) => void;
  agentBadge?: number;
}

const TABS: { key: AppMode; icon: typeof Layout; label: string }[] = [
  { key: 'workbench', icon: Layout, label: '工作台' },
  { key: 'archive',   icon: Users,  label: '学生档案' },
  { key: 'agent',     icon: Bot,    label: 'AI 助手' },
];

export function BottomNav({ mode, onChange, agentBadge = 0 }: Props) {
  return (
    <nav
      className="shrink-0 flex items-stretch"
      style={{
        height: 'calc(56px + env(safe-area-inset-bottom))',
        paddingBottom: 'env(safe-area-inset-bottom)',
        background: 'var(--bg-s2)',
        borderTop: '1px solid var(--border)',
      }}
    >
      {TABS.map(({ key, icon: Icon, label }) => {
        const active = mode === key;
        const showBadge = key === 'agent' && agentBadge > 0;
        return (
          <button
            key={key}
            onClick={() => onChange(key)}
            className="flex-1 flex flex-col items-center justify-center gap-1 relative transition-all"
            style={{
              color: active ? 'var(--accent)' : 'var(--text-3)',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            {/* active indicator bar */}
            {active && (
              <span
                className="absolute top-0 left-1/2 rounded-b-full"
                style={{
                  width: 32,
                  height: 3,
                  background: 'var(--accent)',
                  transform: 'translateX(-50%)',
                }}
              />
            )}

            <span className="relative">
              <Icon size={20} strokeWidth={active ? 2.2 : 1.8} />
              {showBadge && (
                <span
                  className="absolute flex items-center justify-center rounded-full font-bold"
                  style={{
                    top: -4, right: -6,
                    minWidth: 16, height: 16,
                    fontSize: 9,
                    background: 'var(--red)',
                    color: '#fff',
                    padding: '0 3px',
                  }}
                >
                  {agentBadge > 99 ? '99+' : agentBadge}
                </span>
              )}
            </span>

            <span
              className="font-medium"
              style={{ fontSize: 10, letterSpacing: '0.01em' }}
            >
              {label}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
