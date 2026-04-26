import { useState, useRef, useEffect, useCallback } from 'react';
import {
  Sparkles, FileText, Copy, Check, Download, BookmarkCheck,
  RefreshCw, Send, Square, ChevronDown, Bot, User,
  AlertCircle, Loader2, ClipboardList, ChevronUp,
} from 'lucide-react';
import type { Task, Settings } from '../types';
import { MarkdownRenderer } from './MarkdownRenderer';
import { FEEDBACK_PROMPT } from './TaskPanel';

// Resolve the effective prompt: settings override → built-in default
export function effectiveFeedbackPrompt(settings: { feedbackPrompt?: string }): string {
  const p = settings.feedbackPrompt?.trim();
  return p && p.length > 0 ? p : FEEDBACK_PROMPT;
}
import { resolveApiBase } from '../config/urls';

interface FeedbackMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface Props {
  tasks: Task[];
  settings: Settings;
  selectedTaskId: string | null;
  onSaveToTask: (taskId: string, summary: string) => void;
  onSaveNotes: (taskId: string, notes: string) => void;
}

// ── 流式调用 AI ───────────────────────────────────────────────────────────────
async function streamAI(
  messages: { role: string; content: string }[],
  settings: Settings,
  signal: AbortSignal,
  onChunk: (c: string) => void,
) {
  if (!settings.apiKey) {
    await new Promise(r => setTimeout(r, 600));
    onChunk('（演示模式）请在右上角「设置」中配置 API Key 以启用真实 AI 生成。');
    return;
  }
  const base = resolveApiBase(settings.apiBaseUrl);
  const url = `${base}/chat/completions`;
  let resp: Response;
  try {
    resp = await fetch(url, {
      method: 'POST', signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.apiKey}` },
      body: JSON.stringify({ model: settings.model, messages, stream: true }),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`网络请求失败（${url}）：${msg}。请检查设置里的 API 地址是否正确，以及网络是否可用。`);
  }
  if (!resp.ok) throw new Error(`API 错误 ${resp.status}: ${await resp.text()}`);
  const reader = resp.body!.getReader();
  const dec = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    for (const line of dec.decode(value, { stream: true }).split('\n')) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') return;
      try { const d = JSON.parse(data); const c = d.choices?.[0]?.delta?.content; if (c) onChunk(c); } catch { /* skip */ }
    }
  }
}

// ── Task selector ─────────────────────────────────────────────────────────────
function TaskSelector({
  tasks, selectedId, onSelect,
}: { tasks: Task[]; selectedId: string | null; onSelect: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const done = tasks.filter(t => t.status === 'done');
  const selected = tasks.find(t => t.id === selectedId);

  useEffect(() => {
    const fn = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', fn);
    return () => document.removeEventListener('mousedown', fn);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-2 text-xs bg-slate-800 border border-slate-600 hover:border-slate-500 rounded-lg px-3 py-1.5 text-slate-300 transition-all max-w-[220px]"
      >
        <FileText size={11} className="text-slate-400 shrink-0" />
        <span className="truncate">
          {selected
            ? `${selected.studentName}${selected.topic ? ` · ${selected.topic}` : ''}`
            : done.length ? '选择任务…' : '暂无已完成任务'}
        </span>
        <ChevronDown size={11} className="text-slate-500 shrink-0" />
      </button>

      {open && done.length > 0 && (
        <div className="absolute left-0 top-full mt-1 w-64 bg-[#1a2030] border border-slate-700 rounded-xl shadow-2xl z-50 overflow-hidden">
          <div className="px-3 py-2 border-b border-slate-700/60">
            <p className="text-xs text-slate-400 font-medium">选择要生成反馈的任务</p>
          </div>
          <div className="max-h-52 overflow-y-auto scrollbar-thin py-1">
            {done.map(task => (
              <button
                key={task.id}
                onClick={() => { onSelect(task.id); setOpen(false); }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 hover:bg-slate-700/50 transition-colors text-left ${selectedId === task.id ? 'bg-indigo-500/10' : ''}`}
              >
                <div className="w-7 h-7 rounded-full bg-slate-700 flex items-center justify-center shrink-0 text-xs text-slate-300 font-medium">
                  {task.studentName.slice(0, 1)}
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-slate-200 font-medium truncate">{task.studentName}</p>
                  {task.topic && <p className="text-[10px] text-slate-500 truncate">{task.topic}</p>}
                  {task.aiSummary && <p className="text-[10px] text-emerald-500">已有保存反馈</p>}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Follow-up bubble ──────────────────────────────────────────────────────────
function FollowUpBubble({ msg }: { msg: FeedbackMessage }) {
  const isUser = msg.role === 'user';
  return (
    <div className={`flex gap-2 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${isUser ? 'bg-indigo-600' : 'bg-emerald-700'}`}>
        {isUser ? <User size={11} /> : <Bot size={11} />}
      </div>
      <div className={`max-w-[85%] rounded-xl px-3 py-2 text-xs leading-relaxed ${
        isUser ? 'bg-indigo-600 text-white rounded-tr-sm' : 'bg-[#1e2433] text-slate-300 border border-slate-700/50 rounded-tl-sm'
      }`}>
        {msg.content
          ? isUser ? msg.content : <MarkdownRenderer content={msg.content} />
          : <span className="opacity-40 animate-pulse">▋</span>
        }
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export function FeedbackPanel({ tasks, settings, selectedTaskId, onSaveToTask, onSaveNotes }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    if (selectedTaskId) return selectedTaskId;
    const done = tasks.filter(t => t.status === 'done');
    return done[0]?.id ?? null;
  });

  useEffect(() => {
    if (selectedTaskId) setSelectedId(selectedTaskId);
  }, [selectedTaskId]);

  const [feedback, setFeedback] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  const [followUps, setFollowUps] = useState<FeedbackMessage[]>([]);
  const [input, setInput] = useState('');
  const [isFollowUp, setIsFollowUp] = useState(false);
  const [notesExpanded, setNotesExpanded] = useState(false);
  const [notes, setNotes] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const saveNotesTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const selectedTask = tasks.find(t => t.id === selectedId) ?? null;

  useEffect(() => {
    setFeedback(selectedTask?.aiSummary ?? '');
    setNotes(selectedTask?.notes ?? '');
    setNotesExpanded(!!(selectedTask?.notes));
    setFollowUps([]);
    setError(null);
    setSaved(false);
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [feedback, followUps.length]);

  // 自动选择最新完成任务
  useEffect(() => {
    if (!selectedId) {
      const done = tasks.filter(t => t.status === 'done');
      if (done[0]) setSelectedId(done[0].id);
    }
  }, [tasks, selectedId]);

  const handleNotesChange = useCallback((val: string) => {
    setNotes(val);
    if (!selectedId) return;
    if (saveNotesTimer.current) clearTimeout(saveNotesTimer.current);
    saveNotesTimer.current = setTimeout(() => onSaveNotes(selectedId, val), 800);
  }, [selectedId, onSaveNotes]);

  const generate = useCallback(async () => {
    if (!selectedTask) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setFeedback('');
    setFollowUps([]);
    setError(null);
    setSaved(false);
    setIsGenerating(true);

    const transcript = selectedTask.segments.map(s => s.text).join('');
    const date = new Date(selectedTask.createdAt);
    const dateStr = `${date.getMonth() + 1}月${date.getDate()}日`;
    const meta = [`日期：${dateStr}`, `学生姓名：${selectedTask.studentName}`, selectedTask.topic ? `课程主题：${selectedTask.topic}` : ''].filter(Boolean).join('\n');
    const notesBlock = notes.trim() ? `\n教师补充信息：\n${notes.trim()}` : '';
    const prompt = effectiveFeedbackPrompt(settings);
    const userContent = `${prompt}\n\n---\n${meta}${notesBlock}\n\n课堂录音转写内容：\n${transcript}`;

    try {
      await streamAI(
        [{ role: 'user', content: userContent }],
        settings,
        ctrl.signal,
        chunk => setFeedback(prev => prev + chunk),
      );
    } catch (e: unknown) {
      if ((e as Error).name === 'AbortError') return;
      setError(e instanceof Error ? e.message : '生成失败');
    } finally {
      setIsGenerating(false);
      abortRef.current = null;
    }
  }, [selectedTask, settings, notes]);

  const cancel = () => { abortRef.current?.abort(); setIsGenerating(false); };

  const handleCopy = () => {
    navigator.clipboard.writeText(feedback);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSave = () => {
    if (!selectedId || !feedback) return;
    onSaveToTask(selectedId, feedback);
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  // 追问
  const handleFollowUp = useCallback(async () => {
    const text = input.trim();
    if (!text || isFollowUp || !feedback) return;
    setInput('');
    setIsFollowUp(true);

    const userMsg: FeedbackMessage = { role: 'user', content: text };
    const assistantMsg: FeedbackMessage = { role: 'assistant', content: '' };
    setFollowUps(prev => [...prev, userMsg, assistantMsg]);

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    const history = [
      { role: 'assistant', content: feedback },
      ...followUps.map(m => ({ role: m.role, content: m.content })),
      { role: 'user', content: text },
    ];

    try {
      await streamAI(history, settings, ctrl.signal, chunk => {
        setFollowUps(prev => {
          const next = [...prev];
          next[next.length - 1] = { ...next[next.length - 1], content: next[next.length - 1].content + chunk };
          return next;
        });
      });
    } catch (e: unknown) {
      if ((e as Error).name !== 'AbortError') {
        setFollowUps(prev => {
          const next = [...prev];
          next[next.length - 1] = { ...next[next.length - 1], content: '❌ 请求失败，请重试' };
          return next;
        });
      }
    } finally {
      setIsFollowUp(false);
    }
  }, [input, isFollowUp, feedback, followUps, settings]);

  const hasFeedback = feedback.length > 0;

  const btnStyle = (active = false) => ({
    display: 'flex', alignItems: 'center', gap: 4,
    fontSize: 11, padding: '5px 10px', borderRadius: 8,
    cursor: 'pointer', transition: 'all 0.15s',
    color: active ? 'var(--green)' : 'var(--text-2)',
    background: active ? 'var(--green-dim)' : 'var(--bg-s2)',
    border: `1px solid ${active ? '#1e4d27' : 'var(--border)'}`,
  });

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
        <div className="flex items-center justify-between" style={{ padding: '8px 12px' }}>
          <TaskSelector tasks={tasks} selectedId={selectedId} onSelect={id => setSelectedId(id)} />
          {selectedTask && (
            isGenerating ? (
              <button onClick={cancel} style={{ ...btnStyle(), color: 'var(--red)', background: 'var(--red-dim)', borderColor: '#5a1e1e' }}>
                <Square size={10} /> 停止
              </button>
            ) : (
              <button onClick={generate} style={{ ...btnStyle(), color: '#fff', background: 'var(--accent)', borderColor: 'transparent' }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.opacity = '0.85'}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.opacity = '1'}>
                {hasFeedback ? <RefreshCw size={10} /> : <Sparkles size={10} />}
                {hasFeedback ? '重新生成' : '生成反馈'}
              </button>
            )
          )}
        </div>

        {/* 补充信息折叠区 */}
        {selectedTask && (
          <div style={{ borderTop: '1px solid var(--border)' }}>
            <button
              onClick={() => setNotesExpanded(v => !v)}
              className="flex items-center gap-1.5 w-full text-left transition-colors"
              style={{ padding: '5px 12px', color: notes.trim() ? 'var(--accent)' : 'var(--text-3)', fontSize: 11 }}
            >
              <ClipboardList size={11} />
              <span className="flex-1">{notes.trim() ? `补充信息：${notes.slice(0, 30)}${notes.length > 30 ? '…' : ''}` : '添加补充信息（课前检测、课堂观察等）'}</span>
              {notesExpanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
            </button>
            {notesExpanded && (
              <div style={{ padding: '0 12px 8px' }}>
                <textarea
                  value={notes}
                  onChange={e => handleNotesChange(e.target.value)}
                  placeholder="例如：课前检测平均分 78 分，有 3 名同学未完成作业；本节课重点难点为倒装句…"
                  rows={3}
                  className="scrollbar-thin w-full resize-none outline-none rounded-lg"
                  style={{
                    background: 'var(--bg-s2)',
                    border: '1px solid var(--border)',
                    color: 'var(--text-1)',
                    fontSize: 12,
                    padding: '8px 10px',
                    lineHeight: 1.6,
                  }}
                  onFocus={e => (e.currentTarget.style.borderColor = 'var(--accent)')}
                  onBlur={e => (e.currentTarget.style.borderColor = 'var(--border)')}
                />
                <p className="text-[10px] mt-1" style={{ color: 'var(--text-3)' }}>
                  此信息将在生成反馈时一并提供给 AI，自动保存
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto scrollbar-thin min-h-0">
        {/* Empty — no task */}
        {!selectedTask && (
          <div className="flex flex-col items-center justify-center h-full gap-4 fade-in">
            <div className="w-11 h-11 rounded-2xl flex items-center justify-center"
              style={{ background: 'var(--bg-s3)', border: '1px solid var(--border)' }}>
              <Sparkles size={20} style={{ color: 'var(--text-3)' }} />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium" style={{ color: 'var(--text-2)' }}>选择一个已完成的任务</p>
              <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>从左侧选择任务后，一键生成课堂反馈</p>
            </div>
          </div>
        )}

        {/* Ready to generate */}
        {selectedTask && !hasFeedback && !isGenerating && !error && (
          <div className="flex flex-col items-center justify-center h-full gap-5 fade-in">
            <div className="text-center px-6">
              <div className="w-12 h-12 rounded-2xl flex items-center justify-center mx-auto mb-4"
                style={{ background: 'var(--accent-dim)', border: '1px solid #2a4a7a' }}>
                <Sparkles size={22} style={{ color: 'var(--accent)' }} />
              </div>
              <p className="font-semibold" style={{ color: 'var(--text-1)' }}>
                {selectedTask.studentName}
                {selectedTask.topic && <span style={{ color: 'var(--text-3)', fontWeight: 400 }}> · {selectedTask.topic}</span>}
              </p>
              <p className="text-xs mt-1.5" style={{ color: 'var(--text-3)' }}>
                {selectedTask.segments.length} 段转写 · 点击生成课堂反馈
              </p>
            </div>
            <button onClick={generate}
              className="flex items-center gap-2 text-sm font-medium rounded-xl transition-all"
              style={{ padding: '9px 22px', background: 'var(--accent)', color: '#fff', border: 'none' }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.opacity = '0.85'}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.opacity = '1'}>
              <Sparkles size={14} /> 生成课堂反馈
            </button>
          </div>
        )}

        {/* Generating */}
        {isGenerating && !hasFeedback && (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <Loader2 size={24} className="animate-spin" style={{ color: 'var(--accent)' }} />
            <p className="text-sm" style={{ color: 'var(--text-2)' }}>正在生成课堂反馈…</p>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="m-4 flex items-start gap-2 rounded-lg px-3 py-2.5"
            style={{ background: 'var(--red-dim)', border: '1px solid #5a1e1e' }}>
            <AlertCircle size={13} style={{ color: 'var(--red)', marginTop: 2, flexShrink: 0 }} />
            <p className="text-xs" style={{ color: 'var(--red)' }}>{error}</p>
          </div>
        )}

        {/* Feedback content */}
        {hasFeedback && (
          <div style={{ padding: '16px 16px 8px' }}>
            {/* Action bar */}
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--accent)' }} />
                <span className="text-xs font-medium" style={{ color: 'var(--text-2)' }}>
                  {selectedTask?.studentName}{selectedTask?.topic && ` · ${selectedTask.topic}`}
                </span>
                {isGenerating && <Loader2 size={10} className="animate-spin" style={{ color: 'var(--accent)' }} />}
              </div>
              <div className="flex gap-1.5">
                <button onClick={handleCopy} style={btnStyle(false)}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'var(--text-1)'}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'var(--text-2)'}>
                  {copied ? <Check size={10} style={{ color: 'var(--green)' }} /> : <Copy size={10} />}
                  {copied ? '已复制' : '复制'}
                </button>
                <button onClick={handleSave} disabled={!hasFeedback || isGenerating}
                  style={btnStyle(saved)}
                  onMouseEnter={e => { if (!saved) (e.currentTarget as HTMLElement).style.color = 'var(--text-1)'; }}
                  onMouseLeave={e => { if (!saved) (e.currentTarget as HTMLElement).style.color = 'var(--text-2)'; }}>
                  {saved ? <BookmarkCheck size={10} /> : <Download size={10} />}
                  {saved ? '已保存' : '保存'}
                </button>
              </div>
            </div>

            {/* Feedback markdown */}
            <div className="rounded-xl" style={{ background: 'var(--bg-s2)', border: '1px solid var(--border)', padding: '16px 18px' }}>
              <MarkdownRenderer content={feedback} />
            </div>

            {/* Follow-ups */}
            {followUps.length > 0 && (
              <div className="mt-4 space-y-3">
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-px" style={{ background: 'var(--border)' }} />
                  <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>追问</span>
                  <div className="flex-1 h-px" style={{ background: 'var(--border)' }} />
                </div>
                {followUps.map((msg, i) => <FollowUpBubble key={i} msg={msg} />)}
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* Follow-up input */}
      {hasFeedback && (
        <div className="shrink-0" style={{ padding: '8px 12px', borderTop: '1px solid var(--border)' }}>
          <div className="flex gap-2 items-end">
            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleFollowUp(); } }}
              placeholder="针对此反馈追问… (Enter 发送)"
              rows={1}
              className="scrollbar-thin flex-1 resize-none outline-none rounded-xl"
              style={{
                background: 'var(--bg-s2)',
                border: '1px solid var(--border)',
                color: 'var(--text-1)',
                fontSize: 13,
                padding: '8px 12px',
              }}
              onFocus={e => (e.currentTarget as HTMLElement).style.borderColor = 'var(--accent)'}
              onBlur={e => (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)'}
            />
            {isFollowUp ? (
              <button onClick={() => abortRef.current?.abort()}
                className="p-2 rounded-xl transition-all"
                style={{ background: 'var(--red-dim)', border: '1px solid #5a1e1e', color: 'var(--red)' }}>
                <Square size={14} />
              </button>
            ) : (
              <button onClick={handleFollowUp} disabled={!input.trim()}
                className="p-2 rounded-xl transition-all"
                style={{ background: 'var(--accent)', color: '#fff', border: 'none', opacity: input.trim() ? 1 : 0.3 }}>
                <Send size={14} />
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
