import { useState, useRef, useEffect } from 'react';
import {
  Send, Square, Trash2, Bot, User, ChevronDown, ChevronRight,
  Loader2, CheckCircle2, AlertCircle, Sparkles, Wrench, Brain, X,
} from 'lucide-react';
import { useAgent, type AgentMessage, type ToolCallDisplay } from '../agent/useAgent';
import type { StudentFile } from '../agent/tools';
import type { Task, Settings } from '../types';
import { hasPlatformLlm } from '../config/platformApi';

// ─── Quick Actions ─────────────────────────────────────────────────────────────

const QUICK_ACTIONS = [
  { label: '生成所有待反馈的课堂反馈', prompt: '请帮我查看还有哪些学生未生成反馈，然后逐一读取转写内容、生成反馈并保存。' },
  { label: '全班概况', prompt: '给我看一下全班整体情况，包括学生人数、总课次、哪些同学还有待处理的反馈。' },
  { label: '分析课堂薄弱点', prompt: '搜索所有转写内容中关于"错误"、"不理解"、"再讲"的片段，总结出本阶段学生的共性薄弱知识点。' },
  { label: '查看今天的任务', prompt: '列出今天所有已完成转写的任务，说明哪些已有反馈、哪些还没有。' },
];

// ─── Tool Call Card ────────────────────────────────────────────────────────────

function ToolCard({ tc }: { tc: ToolCallDisplay }) {
  const [open, setOpen] = useState(false);

  const resultStr = tc.result !== undefined
    ? JSON.stringify(tc.result, null, 2)
    : null;

  const resultPreview = (() => {
    if (!tc.result) return null;
    const r = tc.result as Record<string, unknown>;
    if (Array.isArray(tc.result)) return `${(tc.result as unknown[]).length} 条记录`;
    if (r.success) return `已保存 → ${r.studentName ?? ''}`;
    if (r.error) return String(r.error);
    if (r.totalStudents !== undefined) return `${r.totalStudents} 名学生 · ${r.totalTasks} 课次`;
    if (r.charCount !== undefined) return `${r.charCount} 字`;
    return null;
  })();

  return (
    <div
      className="rounded-lg overflow-hidden text-xs"
      style={{ background: 'var(--bg-s2)', border: '1px solid var(--border)' }}
    >
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left"
        style={{ color: 'var(--text-2)' }}
      >
        {/* status icon */}
        {tc.status === 'running' && (
          <Loader2 size={12} className="animate-spin shrink-0" style={{ color: 'var(--accent)' }} />
        )}
        {tc.status === 'done' && (
          <CheckCircle2 size={12} className="shrink-0" style={{ color: '#22c55e' }} />
        )}
        {tc.status === 'error' && (
          <AlertCircle size={12} className="shrink-0" style={{ color: 'var(--red)' }} />
        )}

        <Wrench size={10} className="shrink-0" style={{ color: 'var(--text-3)' }} />
        <span className="font-medium" style={{ color: 'var(--text-1)' }}>{tc.label}</span>

        {resultPreview && tc.status !== 'running' && (
          <span className="ml-1 truncate flex-1" style={{ color: 'var(--text-3)' }}>
            — {resultPreview}
          </span>
        )}

        <span className="ml-auto shrink-0" style={{ color: 'var(--text-3)' }}>
          {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        </span>
      </button>

      {open && (
        <div style={{ borderTop: '1px solid var(--border)' }}>
          {/* args */}
          <div className="px-3 py-2" style={{ borderBottom: '1px solid var(--border)' }}>
            <div className="mb-1 font-semibold" style={{ color: 'var(--text-3)' }}>参数</div>
            <pre className="whitespace-pre-wrap break-all" style={{ color: 'var(--text-2)', fontFamily: 'monospace', fontSize: 11 }}>
              {JSON.stringify(tc.args, null, 2)}
            </pre>
          </div>
          {/* result */}
          {resultStr && (
            <div className="px-3 py-2">
              <div className="mb-1 font-semibold" style={{ color: 'var(--text-3)' }}>返回值</div>
              <pre
                className="whitespace-pre-wrap break-all overflow-auto"
                style={{ color: 'var(--text-2)', fontFamily: 'monospace', fontSize: 11, maxHeight: 200 }}
              >
                {resultStr.length > 2000 ? resultStr.slice(0, 2000) + '\n…（已截断）' : resultStr}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Message Bubble ────────────────────────────────────────────────────────────

function MessageBubble({
  msg,
  toolLog,
}: {
  msg: AgentMessage;
  toolLog: ToolCallDisplay[];
}) {
  if (msg.role === 'system' || msg.role === 'tool') return null;

  const isUser = msg.role === 'user';
  const hasToolCalls = !!(msg.tool_calls && msg.tool_calls.length > 0);

  // Simple markdown-ish rendering: bold, line-breaks
  const renderContent = (text: string) => {
    const lines = text.split('\n');
    return lines.map((line, i) => {
      const parts = line.split(/(\*\*[^*]+\*\*)/g);
      return (
        <span key={i}>
          {parts.map((p, j) =>
            p.startsWith('**') && p.endsWith('**')
              ? <strong key={j}>{p.slice(2, -2)}</strong>
              : p,
          )}
          {i < lines.length - 1 && <br />}
        </span>
      );
    });
  };

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div
          className="flex items-start gap-2 max-w-[80%]"
          style={{ flexDirection: 'row-reverse' }}
        >
          <div className="flex items-center justify-center w-7 h-7 rounded-full shrink-0"
            style={{ background: 'var(--accent)', marginTop: 2 }}>
            <User size={13} className="text-white" />
          </div>
          <div
            className="rounded-2xl rounded-tr-sm px-4 py-2.5 text-sm leading-relaxed"
            style={{ background: 'var(--accent)', color: '#fff' }}
          >
            {msg.content}
          </div>
        </div>
      </div>
    );
  }

  // assistant
  return (
    <div className="flex items-start gap-2">
      <div className="flex items-center justify-center w-7 h-7 rounded-full shrink-0"
        style={{ background: 'linear-gradient(135deg,#4493f8,#7c4af8)', marginTop: 2 }}>
        <Bot size={13} className="text-white" />
      </div>
      <div className="flex-1 min-w-0 flex flex-col gap-2">
        {/* tool call cards */}
        {hasToolCalls && msg.tool_calls!.map(tc => {
          const display = toolLog.find(t => t.id === tc.id);
          return display ? <ToolCard key={tc.id} tc={display} /> : null;
        })}
        {/* text content */}
        {msg.content && (
          <div
            className="rounded-2xl rounded-tl-sm px-4 py-2.5 text-sm leading-relaxed"
            style={{ background: 'var(--bg-s2)', color: 'var(--text-1)', border: '1px solid var(--border)' }}
          >
            {renderContent(msg.content)}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Thinking Indicator ────────────────────────────────────────────────────────

function ThinkingDot() {
  return (
    <div className="flex items-start gap-2">
      <div className="flex items-center justify-center w-7 h-7 rounded-full shrink-0"
        style={{ background: 'linear-gradient(135deg,#4493f8,#7c4af8)', marginTop: 2 }}>
        <Bot size={13} className="text-white" />
      </div>
      <div className="rounded-2xl rounded-tl-sm px-4 py-3 flex items-center gap-1.5"
        style={{ background: 'var(--bg-s2)', border: '1px solid var(--border)' }}>
        {[0, 1, 2].map(i => (
          <span
            key={i}
            className="inline-block w-1.5 h-1.5 rounded-full"
            style={{
              background: 'var(--accent)',
              animation: `bounce 1.2s ${i * 0.2}s infinite`,
            }}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Markdown Renderer (lightweight, no external dep) ─────────────────────────

function MdLine({ line }: { line: string }) {
  if (line.startsWith('## ')) {
    return (
      <div className="mt-3 mb-1 text-xs font-bold" style={{ color: 'var(--accent)' }}>
        {line.slice(3)}
      </div>
    );
  }
  if (line.startsWith('# ')) {
    return (
      <div className="text-sm font-bold mb-1" style={{ color: 'var(--text-1)' }}>
        {line.slice(2)}
      </div>
    );
  }
  if (line.startsWith('- ')) {
    return (
      <div className="flex items-start gap-1.5 text-xs leading-relaxed" style={{ color: 'var(--text-2)' }}>
        <span className="shrink-0 mt-1.5 w-1 h-1 rounded-full inline-block" style={{ background: 'var(--text-3)' }} />
        <span>{line.slice(2)}</span>
      </div>
    );
  }
  if (line.startsWith('_') && line.endsWith('_')) {
    return <div className="text-xs italic" style={{ color: 'var(--text-3)' }}>{line.slice(1, -1)}</div>;
  }
  if (line === '' || line === '---') return <div className="h-1" />;
  return <div className="text-xs leading-relaxed" style={{ color: 'var(--text-2)' }}>{line}</div>;
}

function MarkdownView({ md }: { md: string }) {
  const lines = md.split('\n');
  return (
    <div className="flex flex-col gap-0.5">
      {lines.map((line, i) => <MdLine key={i} line={line} />)}
    </div>
  );
}

// ─── Student File Card ─────────────────────────────────────────────────────────

function StudentFileCard({
  file,
  onDelete,
}: {
  file: StudentFile;
  onDelete: (studentName: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const lineCount = file.markdown.split('\n').filter(l => l.startsWith('- ')).length;

  return (
    <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--border)', background: 'var(--bg-s2)' }}>
      <button
        className="w-full flex items-center justify-between px-3 py-2.5 text-left"
        onClick={() => setOpen(o => !o)}
      >
        <div className="flex items-center gap-2">
          <div
            className="flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold shrink-0"
            style={{ background: 'linear-gradient(135deg,#4493f830,#7c4af830)', color: 'var(--accent)', border: '1px solid #4493f840' }}
          >
            {file.studentName.slice(-1)}
          </div>
          <span className="text-sm font-medium" style={{ color: 'var(--text-1)' }}>
            {file.studentName}
          </span>
          <span className="text-xs px-1.5 py-0.5 rounded-full" style={{ background: 'var(--bg-s3)', color: 'var(--text-3)' }}>
            {lineCount} 条
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={e => { e.stopPropagation(); onDelete(file.studentName); }}
            className="p-1 rounded opacity-0 hover:opacity-100 transition-opacity"
            style={{ color: 'var(--text-3)' }}
            title="删除档案"
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'var(--red)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--text-3)'; }}
          >
            <Trash2 size={11} />
          </button>
          {open ? <ChevronDown size={12} style={{ color: 'var(--text-3)' }} /> : <ChevronRight size={12} style={{ color: 'var(--text-3)' }} />}
        </div>
      </button>

      {open && (
        <div className="px-3 pb-3 pt-2" style={{ borderTop: '1px solid var(--border)' }}>
          <MarkdownView md={file.markdown} />
          <div className="mt-2 text-xs" style={{ color: 'var(--text-3)' }}>
            更新于 {new Date(file.updatedAt).toLocaleString('zh-CN')}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Memory Panel ─────────────────────────────────────────────────────────────

function MemoryPanel({
  globalMemory,
  studentFiles,
  onDeleteStudentFile,
  onClose,
}: {
  globalMemory: string;
  studentFiles: StudentFile[];
  onDeleteStudentFile: (studentName: string) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<'students' | 'global'>('students');

  return (
    <div
      className="flex flex-col h-full"
      style={{ background: 'var(--bg-s1)', borderLeft: '1px solid var(--border)' }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-3 shrink-0"
        style={{ height: 44, borderBottom: '1px solid var(--border)', background: 'var(--bg-s2)' }}
      >
        <div className="flex items-center gap-2">
          <Brain size={13} style={{ color: 'var(--accent)' }} />
          <span className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>记忆库</span>
        </div>
        <button onClick={onClose} className="p-1 rounded-lg" style={{ color: 'var(--text-3)' }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'var(--text-1)'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--text-3)'; }}
        >
          <X size={13} />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex shrink-0 px-2 pt-2 gap-1">
        {([
          { key: 'students', label: '学生档案', count: studentFiles.length },
          { key: 'global',   label: '全局记忆', count: globalMemory.trim() ? 1 : 0 },
        ] as { key: 'students' | 'global'; label: string; count: number }[]).map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className="flex-1 flex items-center justify-center gap-1.5 text-xs py-1.5 rounded-lg font-medium transition-all"
            style={tab === t.key ? {
              background: 'var(--bg-s2)', color: 'var(--text-1)', border: '1px solid var(--border)',
            } : {
              background: 'transparent', color: 'var(--text-3)', border: '1px solid transparent',
            }}
          >
            {t.label}
            {t.count > 0 && (
              <span className="px-1 rounded-full" style={{ background: 'var(--accent)', color: '#fff', fontSize: 9 }}>
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-y-auto px-2 py-2 flex flex-col gap-2">
        {tab === 'students' ? (
          studentFiles.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-2 text-center py-8">
              <Brain size={28} style={{ color: 'var(--text-3)', opacity: 0.3 }} />
              <div className="text-xs leading-relaxed" style={{ color: 'var(--text-3)' }}>
                还没有学生档案<br />
                Agent 处理任务时会自动<br />创建并更新
              </div>
            </div>
          ) : (
            studentFiles
              .sort((a, b) => b.updatedAt - a.updatedAt)
              .map(f => (
                <StudentFileCard
                  key={f.studentName}
                  file={f}
                  onDelete={onDeleteStudentFile}
                />
              ))
          )
        ) : (
          !globalMemory.trim() ? (
            <div className="flex flex-col items-center justify-center h-full gap-2 text-center py-8">
              <Brain size={28} style={{ color: 'var(--text-3)', opacity: 0.3 }} />
              <div className="text-xs leading-relaxed" style={{ color: 'var(--text-3)' }}>
                还没有全局记忆<br />
                让 Agent 调用<br />「更新全局记忆」工具保存
              </div>
            </div>
          ) : (
            <div className="rounded-xl p-3" style={{ background: 'var(--bg-s2)', border: '1px solid var(--border)' }}>
              <MarkdownView md={globalMemory} />
            </div>
          )
        )}
      </div>
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────

interface Props {
  tasks: Task[];
  settings: Settings;
  onSaveFeedback: (taskId: string, feedback: string) => void;
}

export function AgentChat({ tasks, settings, onSaveFeedback }: Props) {
  const {
    messages, toolLog, globalMemory, studentFiles,
    running, send, stop, clear,
    deleteStudentFile,
  } = useAgent(tasks, onSaveFeedback, settings);

  const [input, setInput] = useState('');
  const [showMemory, setShowMemory] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const isEmpty = messages.length === 0;
  const hasApiKey = hasPlatformLlm();

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, running]);

  const handleSend = () => {
    const text = input.trim();
    if (!text || running) return;
    setInput('');
    send(text);
    setTimeout(() => textareaRef.current?.focus(), 0);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex h-full" style={{ borderRadius: 12, border: '1px solid var(--border)', overflow: 'hidden' }}>

      {/* ── Chat Column ── */}
      <div className="flex flex-col flex-1 min-w-0" style={{ background: 'var(--bg-s1)' }}>

      {/* ── Header ── */}
      <div
        className="flex items-center justify-between shrink-0 px-4"
        style={{ height: 44, borderBottom: '1px solid var(--border)', background: 'var(--bg-s2)' }}
      >
        <div className="flex items-center gap-2">
          <Sparkles size={14} style={{ color: 'var(--accent)' }} />
          <span className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>AI 助手</span>
          <span
            className="text-xs px-2 py-0.5 rounded-full"
            style={{ background: 'var(--bg-s3)', color: 'var(--text-3)', border: '1px solid var(--border)' }}
          >
            Agent 模式
          </span>
        </div>
        <div className="flex items-center gap-2">
          {/* Memory toggle */}
          <button
            onClick={() => setShowMemory(v => !v)}
            title="记忆库"
            className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg transition-all"
            style={{
              color: showMemory ? 'var(--accent)' : 'var(--text-3)',
              border: `1px solid ${showMemory ? '#4493f840' : 'var(--border)'}`,
              background: showMemory ? '#4493f815' : 'transparent',
            }}
            onMouseEnter={e => { if (!showMemory) (e.currentTarget as HTMLElement).style.color = 'var(--text-1)'; }}
            onMouseLeave={e => { if (!showMemory) (e.currentTarget as HTMLElement).style.color = 'var(--text-3)'; }}
          >
            <Brain size={12} />
            记忆
            {(studentFiles.length > 0 || globalMemory.trim()) && (
              <span
                className="inline-flex items-center justify-center w-4 h-4 rounded-full text-xs font-semibold"
                style={{ background: 'var(--accent)', color: '#fff', fontSize: 10 }}
              >
                {studentFiles.length}
              </span>
            )}
          </button>

          {!isEmpty && (
            <button
              onClick={clear}
              title="清空对话"
              className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg transition-all"
              style={{ color: 'var(--text-3)', border: '1px solid transparent' }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'var(--red)'; (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--text-3)'; (e.currentTarget as HTMLElement).style.borderColor = 'transparent'; }}
            >
              <Trash2 size={12} /> 清空
            </button>
          )}
        </div>
      </div>

      {/* ── Messages ── */}
      <div
        ref={scrollRef}
        className="flex-1 min-h-0 overflow-y-auto px-4 py-4 flex flex-col gap-4"
      >
        {isEmpty && !running ? (
          /* Welcome screen */
          <div className="flex flex-col items-center justify-center h-full gap-6 py-8">
            <div className="flex flex-col items-center gap-3 text-center">
              <div
                className="flex items-center justify-center w-14 h-14 rounded-2xl"
                style={{ background: 'linear-gradient(135deg,#4493f820,#7c4af820)', border: '1px solid #4493f840' }}
              >
                <Bot size={28} style={{ color: 'var(--accent)' }} />
              </div>
              <div>
                <div className="text-base font-semibold mb-1" style={{ color: 'var(--text-1)' }}>
                  你好，我是 AI 教学助手
                </div>
                <div className="text-sm leading-relaxed" style={{ color: 'var(--text-3)', maxWidth: 320 }}>
                  我能自动读取课堂转写、生成家长反馈，<br />支持批量处理和跨学生对比分析。
                </div>
              </div>
            </div>

            {!hasApiKey && (
              <div
                className="text-xs px-4 py-3 rounded-xl text-center"
                style={{ background: '#2a1a0a', border: '1px solid #5a3d0a', color: 'var(--amber)', maxWidth: 340 }}
              >
                ⚠️ 服务端未配置大模型 API（VITE_LLM_API_KEY），无法使用 AI 功能
              </div>
            )}

            <div className="flex flex-col gap-2 w-full" style={{ maxWidth: 380 }}>
              <div className="text-xs mb-1" style={{ color: 'var(--text-3)' }}>快速开始</div>
              {QUICK_ACTIONS.map(({ label, prompt }) => (
                <button
                  key={label}
                  onClick={() => { setInput(prompt); textareaRef.current?.focus(); }}
                  disabled={!hasApiKey}
                  className="text-left text-sm px-4 py-2.5 rounded-xl transition-all"
                  style={{
                    background: 'var(--bg-s2)',
                    border: '1px solid var(--border)',
                    color: 'var(--text-2)',
                    cursor: hasApiKey ? 'pointer' : 'not-allowed',
                    opacity: hasApiKey ? 1 : 0.4,
                  }}
                  onMouseEnter={e => {
                    if (hasApiKey) {
                      (e.currentTarget as HTMLElement).style.borderColor = 'var(--accent)';
                      (e.currentTarget as HTMLElement).style.color = 'var(--text-1)';
                    }
                  }}
                  onMouseLeave={e => {
                    (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)';
                    (e.currentTarget as HTMLElement).style.color = 'var(--text-2)';
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {messages.map((msg, i) => (
              <MessageBubble key={i} msg={msg} toolLog={toolLog} />
            ))}
            {running && <ThinkingDot />}
          </>
        )}
      </div>

      {/* ── Input ── */}
      <div
        className="shrink-0 px-4 py-3"
        style={{ borderTop: '1px solid var(--border)', background: 'var(--bg-s2)' }}
      >
        <div
          className="flex items-end gap-2 rounded-xl px-3 py-2"
          style={{ background: 'var(--bg-s1)', border: '1px solid var(--border)' }}
        >
          <textarea
            ref={textareaRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={hasApiKey ? '输入指令，按 Enter 发送，Shift+Enter 换行…' : '请先配置 API Key'}
            disabled={!hasApiKey}
            rows={1}
            className="flex-1 resize-none text-sm leading-relaxed bg-transparent outline-none"
            style={{
              color: 'var(--text-1)',
              maxHeight: 120,
              minHeight: 24,
              fontFamily: 'inherit',
            }}
            onInput={e => {
              const el = e.currentTarget;
              el.style.height = 'auto';
              el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
            }}
          />
          {running ? (
            <button
              onClick={stop}
              title="停止"
              className="flex items-center justify-center w-8 h-8 rounded-lg shrink-0 transition-all"
              style={{ background: 'var(--red)', color: '#fff' }}
            >
              <Square size={13} fill="currentColor" />
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!input.trim() || !hasApiKey}
              title="发送"
              className="flex items-center justify-center w-8 h-8 rounded-lg shrink-0 transition-all"
              style={{
                background: input.trim() && hasApiKey ? 'var(--accent)' : 'var(--bg-s3)',
                color: input.trim() && hasApiKey ? '#fff' : 'var(--text-3)',
              }}
            >
              <Send size={13} />
            </button>
          )}
        </div>
        <div className="mt-1.5 text-center text-xs" style={{ color: 'var(--text-3)' }}>
          Agent 模式 · 自动调用工具 · 最多 {12} 轮推理
        </div>
      </div>

      <style>{`
        @keyframes bounce {
          0%, 80%, 100% { transform: translateY(0); opacity: 0.4; }
          40% { transform: translateY(-5px); opacity: 1; }
        }
      `}</style>

      </div>{/* end chat column */}

      {/* ── Memory Side Panel ── */}
      {showMemory && (
        <div style={{ width: 256, flexShrink: 0 }}>
          <MemoryPanel
            globalMemory={globalMemory}
            studentFiles={studentFiles}
            onDeleteStudentFile={deleteStudentFile}
            onClose={() => setShowMemory(false)}
          />
        </div>
      )}
    </div>
  );
}
