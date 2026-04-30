import { useState, useRef, useEffect, useCallback } from 'react';
import {
  Sparkles, FileText, Copy, Check, Download, BookmarkCheck,
  RefreshCw, Send, Square, ChevronDown, Bot, User,
  AlertCircle, Loader2, ClipboardList, ChevronUp, MessageCircle, Wand2,
} from 'lucide-react';
import type { Task, Settings } from '../types';
import { MarkdownRenderer } from './MarkdownRenderer';
import { FEEDBACK_PROMPT, PROMPT_PRESETS } from './TaskPanel';
import { resolveApiBase } from '../config/urls';
import { hasPlatformLlm } from '../config/platformApi';
import { useSubscription } from '../context/SubscriptionContext';
import { WechatSendModal } from './WechatSendModal';
import { formatParentMessage } from '../utils/wechat';
import { useIsMobile } from '../hooks/useIsMobile';

// Resolve the effective prompt: settings override → built-in default
export function effectiveFeedbackPrompt(settings: { feedbackPrompt?: string }): string {
  const p = settings.feedbackPrompt?.trim();
  return p && p.length > 0 ? p : FEEDBACK_PROMPT;
}

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
/** 解析一行 SSE 数据，返回 content chunk 或 null */
function parseSseLine(line: string): string | null {
  if (!line.startsWith('data: ')) return null;
  const data = line.slice(6).trim();
  if (data === '[DONE]') return null;
  try {
    const d = JSON.parse(data);
    return d.choices?.[0]?.delta?.content ?? null;
  } catch {
    return null;
  }
}

async function streamAI(
  messages: { role: string; content: string }[],
  settings: Settings,
  signal: AbortSignal,
  onChunk: (c: string) => void,
) {
  if (!hasPlatformLlm()) {
    await new Promise(r => setTimeout(r, 600));
    onChunk('（演示模式）服务端未配置大模型 API（VITE_LLM_API_KEY），无法调用真实生成。');
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
    throw new Error(`网络请求失败（${url}）：${msg}。请检查 VITE_LLM_BASE_URL 反代与网络。`);
  }
  if (!resp.ok) throw new Error(`API 错误 ${resp.status}: ${await resp.text()}`);

  // Safari 14 兼容：resp.body 可能为 null（Safari 14.0），或不支持 TextDecoder { stream: true }
  // 降级方案：读取完整响应文本后按行解析 SSE
  if (!resp.body) {
    const text = await resp.text();
    for (const line of text.split('\n')) {
      const chunk = parseSseLine(line);
      if (chunk) onChunk(chunk);
    }
    return;
  }

  // 标准流式读取（Chrome / Firefox / Safari 14.1+）
  const reader = resp.body.getReader();
  // TextDecoder { stream: true } 在 Safari 14.0 不支持，改为手动拼接跨 chunk 行
  const dec = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    // decode 不加 { stream: true }，对多字节边界用 buf 拼接处理
    buf += dec.decode(value);
    const lines = buf.split('\n');
    // 最后一段可能不完整，留到下一次拼接
    buf = lines.pop() ?? '';
    for (const line of lines) {
      const chunk = parseSseLine(line);
      if (chunk) onChunk(chunk);
    }
  }
  // 处理 buf 里残余的最后一行
  if (buf) {
    const chunk = parseSseLine(buf);
    if (chunk) onChunk(chunk);
  }
}

// ── Task selector ─────────────────────────────────────────────────────────────
function TaskSelector({
  tasks, selectedId, onSelect, generatingIds,
}: {
  tasks: Task[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  generatingIds: Set<string>;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const done = tasks.filter(t => t.status === 'done');
  const selected = tasks.find(t => t.id === selectedId);
  const selectedGenerating = selected && generatingIds.has(selected.id);

  useEffect(() => {
    const fn = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', fn);
    return () => document.removeEventListener('mousedown', fn);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-2 text-xs bg-slate-800 border border-slate-600 hover:border-slate-500 rounded-lg px-3 py-1.5 text-slate-300 transition-all max-w-[260px]"
      >
        <FileText size={11} className="text-slate-400 shrink-0" />
        <span className="truncate">
          {selected
            ? `${selected.studentName}${selected.topic ? ` · ${selected.topic}` : ''}`
            : done.length ? '选择任务…' : '暂无已完成任务'}
        </span>
        {selectedGenerating && (
          <Loader2 size={10} className="animate-spin shrink-0" style={{ color: 'var(--accent)' }} />
        )}
        <ChevronDown size={11} className="text-slate-500 shrink-0" />
      </button>

      {open && done.length > 0 && (
        <div className="absolute left-0 top-full mt-1 w-64 bg-[#1a2030] border border-slate-700 rounded-xl shadow-2xl z-50 overflow-hidden">
          <div className="px-3 py-2 border-b border-slate-700/60">
            <p className="text-xs text-slate-400 font-medium">选择要生成反馈的任务</p>
          </div>
          <div className="max-h-52 overflow-y-auto scrollbar-thin py-1">
            {done.map(task => {
              const generating = generatingIds.has(task.id);
              return (
                <button
                  key={task.id}
                  onClick={() => { onSelect(task.id); setOpen(false); }}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 hover:bg-slate-700/50 transition-colors text-left ${selectedId === task.id ? 'bg-indigo-500/10' : ''}`}
                >
                  <div className="w-7 h-7 rounded-full bg-slate-700 flex items-center justify-center shrink-0 text-xs text-slate-300 font-medium">
                    {task.studentName.slice(0, 1)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-slate-200 font-medium truncate">{task.studentName}</p>
                    {task.topic && <p className="text-[10px] text-slate-500 truncate">{task.topic}</p>}
                    {task.aiSummary && !generating && <p className="text-[10px] text-emerald-500">已有保存反馈</p>}
                    {generating && (
                      <p className="text-[10px] flex items-center gap-1" style={{ color: 'var(--accent)' }}>
                        <Loader2 size={9} className="animate-spin" /> 生成中…
                      </p>
                    )}
                  </div>
                </button>
              );
            })}
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

// ── 按 taskId 隔离的会话状态 ─────────────────────────────────────────────────
//   切换任务、切换 tab 都不会打断已有任务的生成；切回任务能看到进行中的内容
interface GenSession {
  feedback: string;
  followUps: FeedbackMessage[];
  isGenerating: boolean;
  isFollowUp: boolean;
  error: string | null;
  saved: boolean;
  copied: boolean;
}
const EMPTY_SESSION: GenSession = {
  feedback: '', followUps: [], isGenerating: false, isFollowUp: false,
  error: null, saved: false, copied: false,
};

// ── Main ──────────────────────────────────────────────────────────────────────
export function FeedbackPanel({ tasks, settings, selectedTaskId, onSaveToTask, onSaveNotes }: Props) {
  const subscription = useSubscription();
  const isMobile = useIsMobile();
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    if (selectedTaskId) return selectedTaskId;
    const done = tasks.filter(t => t.status === 'done');
    return done[0]?.id ?? null;
  });

  useEffect(() => {
    if (selectedTaskId) setSelectedId(selectedTaskId);
  }, [selectedTaskId]);

  // 跨任务的会话状态总表
  const [byTask, setByTask] = useState<Record<string, GenSession>>({});
  // 输入框 / 笔记 / 折叠状态在不同任务间复用；保持轻量
  const [input, setInput] = useState('');
  const [notes, setNotes] = useState('');
  const [notesExpanded, setNotesExpanded] = useState(false);
  const [promptExpanded, setPromptExpanded] = useState(false);
  const [promptPresetIdx, setPromptPresetIdx] = useState(0);
  const [customPrompt, setCustomPrompt] = useState('');
  const [wechatOpen, setWechatOpen] = useState(false);

  const isCustomPrompt = promptPresetIdx === PROMPT_PRESETS.length - 1;
  const activePrompt = isCustomPrompt
    ? customPrompt
    : (PROMPT_PRESETS[promptPresetIdx]?.value ?? FEEDBACK_PROMPT);

  // 每个任务有独立的 abort controller，互不影响
  const abortControllers = useRef<Map<string, AbortController>>(new Map());
  const bottomRef = useRef<HTMLDivElement>(null);
  const saveNotesTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const selectedTask = tasks.find(t => t.id === selectedId) ?? null;
  const cur = (selectedId && byTask[selectedId]) || EMPTY_SESSION;
  const { feedback, followUps, isGenerating, isFollowUp, error, saved, copied } = cur;

  /** 局部更新当前任务（或指定任务）的会话状态 */
  const patchSession = useCallback((id: string, patch: Partial<GenSession>) => {
    setByTask(s => ({ ...s, [id]: { ...(s[id] ?? EMPTY_SESSION), ...patch } }));
  }, []);

  // 任务切换：仅同步 notes 显示，不动其它任务的会话；首次进入恢复已保存的 aiSummary
  useEffect(() => {
    if (!selectedId) return;
    const task = tasks.find(t => t.id === selectedId);
    setNotes(task?.notes ?? '');
    setNotesExpanded(!!task?.notes);
    setInput('');
    setByTask(s => {
      // 如果已有 session（生成中 / 已生成 / 出错过），保持现状
      if (s[selectedId]) return s;
      // 否则用任务保存过的 aiSummary 初始化
      return { ...s, [selectedId]: { ...EMPTY_SESSION, feedback: task?.aiSummary ?? '' } };
    });
  }, [selectedId, tasks]);

  // 任务被删除时清理对应的 session 与 controller
  useEffect(() => {
    const validIds = new Set(tasks.map(t => t.id));
    for (const id of Array.from(abortControllers.current.keys())) {
      if (!validIds.has(id)) {
        abortControllers.current.get(id)?.abort();
        abortControllers.current.delete(id);
      }
    }
    setByTask(s => {
      let changed = false;
      const next: Record<string, GenSession> = {};
      for (const [k, v] of Object.entries(s)) {
        if (validIds.has(k)) next[k] = v;
        else changed = true;
      }
      return changed ? next : s;
    });
  }, [tasks]);

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
    if (!subscription.requireAccess('feedback').ok) return; // 未登录 → 弹注册
    const taskId = selectedTask.id;

    // 仅取消该任务自身的旧请求；其他任务的生成不受影响
    abortControllers.current.get(taskId)?.abort();
    const ctrl = new AbortController();
    abortControllers.current.set(taskId, ctrl);

    patchSession(taskId, {
      feedback: '', followUps: [], error: null, saved: false, isGenerating: true,
    });

    const transcript = selectedTask.segments.map(s => s.text).join('');
    const date = new Date(selectedTask.createdAt);
    const dateStr = `${date.getMonth() + 1}月${date.getDate()}日`;
    const meta = [`日期：${dateStr}`, `学生姓名：${selectedTask.studentName}`, selectedTask.topic ? `课程主题：${selectedTask.topic}` : ''].filter(Boolean).join('\n');
    const notesBlock = notes.trim() ? `\n教师补充信息：\n${notes.trim()}` : '';
    // 优先使用工作区选择的 prompt，fallback 到全局设置 / 内置默认
    const prompt = activePrompt.trim() || effectiveFeedbackPrompt(settings);
    const userContent = `${prompt}\n\n---\n${meta}${notesBlock}\n\n课堂录音转写内容：\n${transcript}`;

    try {
      await streamAI(
        [{ role: 'user', content: userContent }],
        settings,
        ctrl.signal,
        chunk => setByTask(s => {
          const prev = s[taskId] ?? EMPTY_SESSION;
          return { ...s, [taskId]: { ...prev, feedback: prev.feedback + chunk } };
        }),
      );
    } catch (e: unknown) {
      if ((e as Error).name === 'AbortError') return;
      patchSession(taskId, { error: e instanceof Error ? e.message : '生成失败' });
    } finally {
      patchSession(taskId, { isGenerating: false });
      if (abortControllers.current.get(taskId) === ctrl) {
        abortControllers.current.delete(taskId);
      }
    }
  }, [selectedTask, settings, notes, activePrompt, subscription, patchSession]);

  const cancel = () => {
    if (!selectedId) return;
    abortControllers.current.get(selectedId)?.abort();
    patchSession(selectedId, { isGenerating: false, isFollowUp: false });
  };

  const handleCopy = () => {
    if (!selectedId) return;
    navigator.clipboard.writeText(feedback);
    patchSession(selectedId, { copied: true });
    setTimeout(() => patchSession(selectedId, { copied: false }), 2000);
  };

  const handleSave = () => {
    if (!selectedId || !feedback) return;
    onSaveToTask(selectedId, feedback);
    patchSession(selectedId, { saved: true });
    setTimeout(() => patchSession(selectedId, { saved: false }), 3000);
  };

  // 追问
  const handleFollowUp = useCallback(async () => {
    const text = input.trim();
    if (!text || !selectedId) return;
    const session = byTask[selectedId] ?? EMPTY_SESSION;
    if (session.isFollowUp || !session.feedback) return;
    if (!subscription.requireAccess('feedback').ok) return;

    const taskId = selectedId;
    setInput('');

    const userMsg: FeedbackMessage = { role: 'user', content: text };
    const assistantMsg: FeedbackMessage = { role: 'assistant', content: '' };
    setByTask(s => {
      const prev = s[taskId] ?? EMPTY_SESSION;
      return { ...s, [taskId]: { ...prev, isFollowUp: true, followUps: [...prev.followUps, userMsg, assistantMsg] } };
    });

    // 追问与主生成共用同一个 task 的 controller —— 同一时刻只允许一种生成在跑
    abortControllers.current.get(taskId)?.abort();
    const ctrl = new AbortController();
    abortControllers.current.set(taskId, ctrl);

    const history = [
      { role: 'assistant', content: session.feedback },
      ...session.followUps.map(m => ({ role: m.role, content: m.content })),
      { role: 'user', content: text },
    ];

    try {
      await streamAI(history, settings, ctrl.signal, chunk => {
        setByTask(s => {
          const prev = s[taskId] ?? EMPTY_SESSION;
          const next = [...prev.followUps];
          const last = next[next.length - 1];
          if (last) next[next.length - 1] = { ...last, content: last.content + chunk };
          return { ...s, [taskId]: { ...prev, followUps: next } };
        });
      });
    } catch (e: unknown) {
      if ((e as Error).name !== 'AbortError') {
        setByTask(s => {
          const prev = s[taskId] ?? EMPTY_SESSION;
          const next = [...prev.followUps];
          if (next.length) next[next.length - 1] = { ...next[next.length - 1], content: '❌ 请求失败，请重试' };
          return { ...s, [taskId]: { ...prev, followUps: next } };
        });
      }
    } finally {
      patchSession(taskId, { isFollowUp: false });
      if (abortControllers.current.get(taskId) === ctrl) {
        abortControllers.current.delete(taskId);
      }
    }
  }, [input, selectedId, byTask, settings, subscription, patchSession]);

  const hasFeedback = feedback.length > 0;
  /** 任务下拉里看到「正在生成」标记 */
  const generatingTaskIds = new Set(
    Object.entries(byTask).filter(([, s]) => s.isGenerating || s.isFollowUp).map(([k]) => k)
  );

  const btnStyle = (active = false) => ({
    display: 'flex', alignItems: 'center', gap: 4,
    fontSize: isMobile ? 12 : 11,
    padding: isMobile ? '8px 14px' : '5px 10px',
    borderRadius: 8,
    cursor: 'pointer', transition: 'all 0.15s',
    minHeight: isMobile ? 36 : undefined,
    color: active ? 'var(--green)' : 'var(--text-2)',
    background: active ? 'var(--green-dim)' : 'var(--bg-s2)',
    border: `1px solid ${active ? '#1e4d27' : 'var(--border)'}`,
  });

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
        <div className="flex items-center justify-between" style={{ padding: isMobile ? '10px 12px' : '8px 12px' }}>
          <TaskSelector
            tasks={tasks}
            selectedId={selectedId}
            onSelect={id => setSelectedId(id)}
            generatingIds={generatingTaskIds}
          />
          {selectedTask && (
            isGenerating ? (
              <button onClick={cancel} style={{ ...btnStyle(), color: 'var(--red)', background: 'var(--red-dim)', borderColor: '#5a1e1e' }}>
                <Square size={isMobile ? 12 : 10} /> 停止
              </button>
            ) : (
              <button onClick={generate}
                style={{ ...btnStyle(), color: '#fff', background: 'var(--accent)', borderColor: 'transparent',
                         fontWeight: isMobile ? 600 : undefined }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.opacity = '0.85'}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.opacity = '1'}>
                {hasFeedback ? <RefreshCw size={isMobile ? 13 : 10} /> : <Sparkles size={isMobile ? 13 : 10} />}
                {hasFeedback ? '重新生成' : '生成反馈'}
              </button>
            )
          )}
        </div>

        {/* Prompt 选择区 */}
        {selectedTask && (
          <div style={{ borderTop: '1px solid var(--border)' }}>
            <button
              onClick={() => setPromptExpanded(v => !v)}
              className="flex items-center gap-1.5 w-full text-left transition-colors"
              style={{ padding: isMobile ? '10px 12px' : '5px 12px', color: 'var(--text-3)', fontSize: 11, minHeight: isMobile ? 40 : undefined }}
            >
              <Wand2 size={11} style={{ color: promptPresetIdx !== 0 || isCustomPrompt ? 'var(--accent)' : undefined }} />
              <span className="flex-1" style={{ color: promptPresetIdx !== 0 || isCustomPrompt ? 'var(--accent)' : undefined }}>
                Prompt：{PROMPT_PRESETS[promptPresetIdx]?.label ?? '课堂反馈'}
              </span>
              {promptExpanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
            </button>
            {promptExpanded && (
              <div style={{ padding: '0 12px 8px' }}>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {PROMPT_PRESETS.map((p, i) => (
                    <button
                      key={p.label}
                      onClick={() => setPromptPresetIdx(i)}
                      className="text-xs px-2.5 py-1 rounded-full border transition-all"
                      style={promptPresetIdx === i ? {
                        background: 'var(--accent-dim)',
                        borderColor: 'var(--accent)',
                        color: 'var(--accent)',
                      } : {
                        background: 'var(--bg-s2)',
                        borderColor: 'var(--border)',
                        color: 'var(--text-3)',
                      }}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
                {isCustomPrompt ? (
                  <textarea
                    value={customPrompt}
                    onChange={e => setCustomPrompt(e.target.value)}
                    placeholder="输入自定义 Prompt…"
                    rows={3}
                    className="scrollbar-thin w-full resize-none outline-none rounded-lg text-xs"
                    style={{
                      background: 'var(--bg-s2)',
                      border: '1px solid var(--border)',
                      color: 'var(--text-2)',
                      padding: '6px 10px',
                      borderRadius: 8,
                    }}
                  />
                ) : (
                  <div className="text-[11px] leading-relaxed line-clamp-3 px-2 py-1.5 rounded-lg"
                    style={{ background: 'var(--bg-s2)', border: '1px solid var(--border)', color: 'var(--text-3)', whiteSpace: 'pre-wrap' }}>
                    {PROMPT_PRESETS[promptPresetIdx]?.value ?? ''}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* 补充信息折叠区 */}
        {selectedTask && (
          <div style={{ borderTop: '1px solid var(--border)' }}>
            <button
              onClick={() => setNotesExpanded(v => !v)}
              className="flex items-center gap-1.5 w-full text-left transition-colors"
              style={{ padding: isMobile ? '10px 12px' : '5px 12px', color: notes.trim() ? 'var(--accent)' : 'var(--text-3)', fontSize: 11, minHeight: isMobile ? 40 : undefined }}
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
              className="flex items-center gap-2 font-semibold rounded-xl transition-all"
              style={{
                padding: isMobile ? '14px 32px' : '9px 22px',
                fontSize: isMobile ? 16 : 14,
                background: 'var(--accent)', color: '#fff', border: 'none',
                minWidth: isMobile ? 200 : undefined,
                justifyContent: 'center',
              }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.opacity = '0.85'}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.opacity = '1'}>
              <Sparkles size={isMobile ? 18 : 14} /> 生成课堂反馈
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
                <button onClick={() => setWechatOpen(true)} disabled={isGenerating}
                  style={{ ...btnStyle(false), color: '#07C160' }}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.opacity = '0.8'}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.opacity = '1'}>
                  <MessageCircle size={10} />
                  发给家长
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
        <div className="shrink-0" style={{ padding: isMobile ? '10px 12px' : '8px 12px', borderTop: '1px solid var(--border)' }}>
          <div className="flex gap-2 items-end">
            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleFollowUp(); } }}
              placeholder={isMobile ? '追问 AI…' : '针对此反馈追问… (Enter 发送)'}
              rows={1}
              className="scrollbar-thin flex-1 resize-none outline-none rounded-xl"
              style={{
                background: 'var(--bg-s2)',
                border: '1px solid var(--border)',
                color: 'var(--text-1)',
                fontSize: isMobile ? 16 : 13,
                padding: isMobile ? '10px 14px' : '8px 12px',
              }}
              onFocus={e => (e.currentTarget as HTMLElement).style.borderColor = 'var(--accent)'}
              onBlur={e => (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)'}
            />
            {isFollowUp ? (
              <button onClick={cancel}
                className="rounded-xl transition-all"
                style={{ padding: isMobile ? '10px 12px' : '8px 8px', background: 'var(--red-dim)', border: '1px solid #5a1e1e', color: 'var(--red)' }}>
                <Square size={isMobile ? 16 : 14} />
              </button>
            ) : (
              <button onClick={handleFollowUp} disabled={!input.trim()}
                className="rounded-xl transition-all"
                style={{ padding: isMobile ? '10px 12px' : '8px 8px', background: 'var(--accent)', color: '#fff', border: 'none', opacity: input.trim() ? 1 : 0.3 }}>
                <Send size={isMobile ? 16 : 14} />
              </button>
            )}
          </div>
        </div>
      )}

      {/* 发给家长弹窗 */}
      {wechatOpen && selectedTask && (
        <WechatSendModal
          studentName={selectedTask.studentName}
          message={formatParentMessage({
            studentName: selectedTask.studentName,
            topic: selectedTask.topic,
            feedback,
          })}
          onClose={() => setWechatOpen(false)}
        />
      )}
    </div>
  );
}
