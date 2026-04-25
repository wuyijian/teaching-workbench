import { useState, useRef, useEffect } from 'react';
import {
  Send, Square, Trash2, Bot, User, Sparkles, FileText,
  Copy, Check, Download, BookmarkCheck, ChevronDown,
} from 'lucide-react';
import type { ChatMessage, Task } from '../types';
import { MarkdownRenderer } from './MarkdownRenderer';

interface Props {
  messages: ChatMessage[];
  isLoading: boolean;
  error: string | null;
  onSend: (text: string) => void;
  onCancel: () => void;
  onClear: () => void;
  currentTask: Task | null;
  tasks: Task[];
  onSaveToTask: (taskId: string, summary: string) => void;
}

const QUICK_PROMPTS = [
  '总结本节课的主要知识点',
  '列出本课的重点和难点',
  '帮我生成课堂小测验（5题）',
  '用简洁语言解释刚才讲的概念',
];

// ── 单条消息气泡 ──────────────────────────────────────────────────────────────
function MessageBubble({ message }: { message: ChatMessage }) {
  const [copied, setCopied] = useState(false);
  const isUser = message.role === 'user';

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className={`group flex gap-2.5 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
        isUser ? 'bg-indigo-600' : 'bg-emerald-700'
      }`}>
        {isUser ? <User size={13} /> : <Bot size={13} />}
      </div>

      <div className={`flex flex-col max-w-[85%] ${isUser ? 'items-end' : 'items-start'}`}>
        <div className={`rounded-2xl px-4 py-2.5 ${
          isUser
            ? 'bg-indigo-600 text-white rounded-tr-sm'
            : 'bg-[#1e2433] border border-slate-700/50 rounded-tl-sm'
        }`}>
          {!message.content
            ? <span className="opacity-40 animate-pulse text-slate-300 text-sm">▋</span>
            : isUser
              ? <p className="text-sm leading-relaxed whitespace-pre-wrap">{message.content}</p>
              : <MarkdownRenderer content={message.content} />
          }
        </div>

        {message.content && (
          <button
            onClick={handleCopy}
            className="mt-1 flex items-center gap-1 text-[10px] opacity-0 group-hover:opacity-100 transition-opacity text-slate-500 hover:text-slate-300"
          >
            {copied
              ? <><Check size={10} className="text-emerald-400" /><span className="text-emerald-400">已复制</span></>
              : <><Copy size={10} />复制</>
            }
          </button>
        )}
      </div>
    </div>
  );
}

// ── 保存到任务下拉 ─────────────────────────────────────────────────────────────
function SaveDropdown({
  tasks, content, onSave,
}: {
  tasks: Task[];
  content: string;
  onSave: (id: string, summary: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fn = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', fn);
    return () => document.removeEventListener('mousedown', fn);
  }, []);

  const doneTasks = tasks.filter(t => t.status === 'done');
  if (doneTasks.length === 0) return null;

  const handleSave = (id: string) => {
    onSave(id, content);
    setSavedId(id);
    setOpen(false);
    setTimeout(() => setSavedId(null), 3000);
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(v => !v)}
        className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border transition-all ${
          savedId
            ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400'
            : 'bg-slate-800 border-slate-600 text-slate-400 hover:text-slate-200 hover:border-slate-500'
        }`}
      >
        {savedId ? <BookmarkCheck size={12} /> : <Download size={12} />}
        {savedId ? '已保存' : '保存'}
        {!savedId && <ChevronDown size={10} />}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 w-56 bg-[#1a2030] border border-slate-700 rounded-xl shadow-2xl z-50 overflow-hidden">
          <div className="px-3 py-2 border-b border-slate-700/60">
            <p className="text-xs text-slate-400 font-medium">保存到任务</p>
            <p className="text-[10px] text-slate-600 mt-0.5">将最新 AI 回复保存到对应任务</p>
          </div>
          <div className="max-h-52 overflow-y-auto scrollbar-thin py-1">
            {doneTasks.map(task => (
              <button
                key={task.id}
                onClick={() => handleSave(task.id)}
                className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-slate-700/50 transition-colors text-left"
              >
                <div className="w-6 h-6 rounded-full bg-slate-700 flex items-center justify-center shrink-0 text-[10px] text-slate-300 font-medium">
                  {task.studentName.slice(0, 1)}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-slate-200 truncate">{task.studentName}</p>
                  {task.topic && <p className="text-[10px] text-slate-500 truncate">{task.topic}</p>}
                </div>
                {task.aiSummary && <BookmarkCheck size={11} className="text-emerald-500 shrink-0" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main ───────────────────────────────────────────────────────────────────────
export function ChatPanel({
  messages, isLoading, error,
  onSend, onCancel, onClear,
  currentTask, tasks, onSaveToTask,
}: Props) {
  const [input, setInput] = useState('');
  const [copiedAll, setCopiedAll] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, messages[messages.length - 1]?.content]);

  const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant' && m.content);
  const hasMessages = messages.length > 0;

  const handleSend = () => {
    const text = input.trim();
    if (!text || isLoading) return;
    setInput('');
    onSend(text);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const handleCopyAll = () => {
    const text = messages
      .map(m => `${m.role === 'user' ? '【提问】' : '【回答】'}\n${m.content}`)
      .join('\n\n---\n\n');
    navigator.clipboard.writeText(text);
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(false), 2000);
  };

  return (
    <div className="flex flex-col h-full bg-[#141820] rounded-xl border border-slate-700/50">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700/50 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <Sparkles size={15} className="text-indigo-400 shrink-0" />
          <span className="text-sm font-semibold text-slate-200 shrink-0">AI 助手</span>
          {currentTask && (
            <span className="flex items-center gap-1.5 text-xs text-slate-500 bg-slate-800/80 px-2 py-0.5 rounded-full border border-slate-700/50 truncate max-w-[160px]">
              <FileText size={10} className="shrink-0" />
              <span className="truncate">{currentTask.studentName}{currentTask.topic && ` · ${currentTask.topic}`}</span>
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {hasMessages && lastAssistant && (
            <>
              <button
                onClick={handleCopyAll}
                className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border bg-slate-800 border-slate-600 text-slate-400 hover:text-slate-200 hover:border-slate-500 transition-all"
                title="复制全部对话"
              >
                {copiedAll ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                <span>{copiedAll ? '已复制' : '复制'}</span>
              </button>

              <SaveDropdown
                tasks={tasks}
                content={lastAssistant.content}
                onSave={onSaveToTask}
              />
            </>
          )}
          {hasMessages && (
            <button
              onClick={onClear}
              className="p-1.5 rounded-md hover:bg-slate-700 text-slate-400 hover:text-red-400 transition-colors"
              title="清空对话"
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto scrollbar-thin px-4 py-4 space-y-5 min-h-0">
        {!hasMessages && (
          <div className="flex flex-col items-center justify-center h-full gap-5 py-8">
            <div className="w-14 h-14 rounded-2xl bg-indigo-500/10 flex items-center justify-center">
              <Bot size={28} className="text-indigo-400" />
            </div>
            <div className="text-center">
              <p className="text-slate-300 font-medium mb-1">教学 AI 助手</p>
              <p className="text-slate-500 text-sm">转写完成后点击「发给 AI」，或直接提问</p>
            </div>
            <div className="w-full grid grid-cols-1 gap-2 max-w-xs">
              {QUICK_PROMPTS.map(p => (
                <button
                  key={p}
                  onClick={() => onSend(p)}
                  className="text-left text-xs text-slate-400 border border-slate-700 hover:border-indigo-500/50 hover:text-indigo-300 rounded-lg px-3 py-2 transition-all bg-slate-800/50 hover:bg-indigo-500/5"
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map(msg => <MessageBubble key={msg.id} message={msg} />)}

        {error && (
          <div className="text-red-400 bg-red-400/10 rounded-lg px-3 py-2 text-xs">{error}</div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="px-4 py-3 border-t border-slate-700/50 shrink-0">
        <div className="flex gap-2 items-end">
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入问题… (Enter 发送，Shift+Enter 换行)"
            rows={2}
            className="flex-1 resize-none bg-slate-800 border border-slate-600 focus:border-indigo-500 rounded-xl px-3 py-2.5 text-sm text-slate-200 placeholder:text-slate-500 outline-none transition-colors scrollbar-thin"
          />
          {isLoading ? (
            <button onClick={onCancel} className="p-2.5 rounded-xl bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 text-red-400 transition-all">
              <Square size={16} />
            </button>
          ) : (
            <button onClick={handleSend} disabled={!input.trim()} className="p-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-30 disabled:cursor-not-allowed text-white transition-all">
              <Send size={16} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
