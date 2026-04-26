import { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Square, Trash2, MessageSquare, Lightbulb } from 'lucide-react';
import type { Task, Settings } from '../types';
import { MarkdownRenderer } from './MarkdownRenderer';
import { resolveApiBase } from '../config/urls';
import { hasPlatformLlm } from '../config/platformApi';

interface Message { id: string; role: 'user' | 'assistant'; content: string; }
interface Props { task: Task | null; settings: Settings; }

const QUICK_QUESTIONS = [
  '这节课讲了哪些主要内容？',
  '学生在哪些地方表现较好？',
  '学生存在哪些薄弱点？',
  '有哪些值得记录的亮点或问题？',
  '帮我提炼本节课的重点知识',
  '学生对哪个知识点理解有偏差？',
];

async function streamChat(
  messages: { role: string; content: string }[],
  settings: Settings,
  signal: AbortSignal,
  onChunk: (c: string) => void,
) {
  if (!hasPlatformLlm()) {
    await new Promise(r => setTimeout(r, 400));
    onChunk('（演示模式）服务端未配置大模型 API（VITE_LLM_API_KEY），无法启用真实问答。');
    return;
  }
  const url = `${resolveApiBase(settings.apiBaseUrl)}/chat/completions`;
  let resp: Response;
  try {
    resp = await fetch(url, {
      method: 'POST', signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.apiKey}` },
      body: JSON.stringify({ model: settings.model, messages, stream: true }),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`网络请求失败（${url}）：${msg}。请检查 VITE_LLM_BASE_URL 与网络。`);
  }
  if (!resp.ok) throw new Error(`API 错误 ${resp.status}`);
  const reader = resp.body!.getReader();
  const dec = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    for (const line of dec.decode(value, { stream: true }).split('\n')) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') return;
      try { const d = JSON.parse(data); const c = d.choices?.[0]?.delta?.content; if (c) onChunk(c); } catch { /* */ }
    }
  }
}

function uid() { return `m-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`; }

function Bubble({ msg }: { msg: Message }) {
  const isUser = msg.role === 'user';
  return (
    <div className={`flex gap-2 ${isUser ? 'flex-row-reverse' : ''}`}>
      <div className="w-6 h-6 rounded-lg flex items-center justify-center text-[10px] font-semibold shrink-0 mt-0.5"
        style={isUser
          ? { background: 'var(--accent-dim)', color: 'var(--accent)', border: '1px solid #2a4a7a' }
          : { background: 'var(--bg-s3)', color: 'var(--text-2)', border: '1px solid var(--border)' }
        }>
        {isUser ? 'Q' : 'AI'}
      </div>
      <div className="max-w-[86%] rounded-xl"
        style={isUser ? {
          padding: '8px 12px',
          background: 'var(--accent-dim)',
          border: '1px solid #2a4a7a',
          color: 'var(--text-1)',
          borderTopRightRadius: 4,
          fontSize: 13,
        } : {
          padding: '8px 12px',
          background: 'var(--bg-s2)',
          border: '1px solid var(--border)',
          borderTopLeftRadius: 4,
          fontSize: 13,
        }}>
        {!msg.content
          ? <span className="animate-pulse" style={{ color: 'var(--text-3)' }}>▋</span>
          : isUser
            ? <p className="whitespace-pre-wrap" style={{ color: 'var(--text-1)', lineHeight: 1.6 }}>{msg.content}</p>
            : <MarkdownRenderer content={msg.content} />
        }
      </div>
    </div>
  );
}

export function TranscriptChat({ task, settings }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMessages([]); setInput(''); setLoading(false);
    abortRef.current?.abort();
  }, [task?.id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, messages[messages.length - 1]?.content]);

  const send = useCallback(async (text: string) => {
    if (!text.trim() || loading || !task) return;
    setInput('');
    const userMsg: Message = { id: uid(), role: 'user', content: text.trim() };
    const asstId = uid();
    setMessages(prev => [...prev, userMsg, { id: asstId, role: 'assistant', content: '' }]);
    setLoading(true);

    const transcript = task.segments.map(s => s.text).join('');
    const date = new Date(task.createdAt);
    const system = `你是一位教学助手，帮助教师分析课堂录音转写。请基于以下内容客观作答，不得编造信息。

学生：${task.studentName}${task.topic ? `\n主题：${task.topic}` : ''}
日期：${date.getMonth() + 1}月${date.getDate()}日

转写内容：
${transcript || '（暂无）'}`;

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      await streamChat(
        [{ role: 'system', content: system }, ...messages.filter(m => m.content).map(m => ({ role: m.role, content: m.content })), { role: 'user', content: text.trim() }],
        settings, ctrl.signal,
        chunk => setMessages(prev => prev.map(m => m.id === asstId ? { ...m, content: m.content + chunk } : m)),
      );
    } catch (e: unknown) {
      if ((e as Error).name === 'AbortError') return;
      setMessages(prev => prev.map(m => m.id === asstId ? { ...m, content: `❌ ${(e as Error).message}` } : m));
    } finally { setLoading(false); }
  }, [loading, task, messages, settings]);

  if (!task) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 fade-in">
        <div className="w-11 h-11 rounded-2xl flex items-center justify-center"
          style={{ background: 'var(--bg-s3)', border: '1px solid var(--border)' }}>
          <MessageSquare size={20} style={{ color: 'var(--text-3)' }} />
        </div>
        <div className="text-center">
          <p className="text-sm font-medium" style={{ color: 'var(--text-2)' }}>内容问答</p>
          <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>从左侧选择任务后，可针对转写内容提问</p>
        </div>
      </div>
    );
  }

  const hasMessages = messages.length > 0;

  return (
    <div className="flex flex-col h-full">
      {/* Task badge */}
      <div className="flex items-center gap-2 shrink-0" style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)' }}>
        <div className="w-5 h-5 rounded-md flex items-center justify-center text-[10px] font-semibold"
          style={{ background: 'var(--teal-dim)', color: 'var(--teal)', border: '1px solid #1a4040' }}>
          {task.studentName.slice(0, 1)}
        </div>
        <span className="text-xs font-medium" style={{ color: 'var(--text-2)' }}>
          {task.studentName}{task.topic && ` · ${task.topic}`}
        </span>
        <span className="ml-auto text-[11px]" style={{ color: 'var(--text-3)' }}>
          {task.segments.length} 段转写
        </span>
        {hasMessages && (
          <button onClick={() => setMessages([])}
            className="p-1 rounded transition-all"
            style={{ color: 'var(--text-3)' }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'var(--red)'}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'var(--text-3)'}
            title="清空">
            <Trash2 size={12} />
          </button>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto scrollbar-thin min-h-0" style={{ padding: '12px' }}>
        {!hasMessages && (
          <div className="fade-in">
            <div className="flex items-center gap-1.5 mb-3">
              <Lightbulb size={11} style={{ color: 'var(--amber)' }} />
              <span className="text-[11px]" style={{ color: 'var(--text-3)' }}>快速提问</span>
            </div>
            <div className="space-y-1.5">
              {QUICK_QUESTIONS.map(q => (
                <button key={q} onClick={() => send(q)} disabled={loading}
                  className="w-full text-left text-xs rounded-lg transition-all"
                  style={{ padding: '7px 10px', color: 'var(--text-2)', background: 'var(--bg-s2)', border: '1px solid var(--border)' }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'var(--text-1)'; (e.currentTarget as HTMLElement).style.borderColor = 'var(--teal)'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--text-2)'; (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)'; }}>
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-4">
          {messages.map(msg => <Bubble key={msg.id} msg={msg} />)}
        </div>
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="shrink-0" style={{ padding: '8px 12px', borderTop: '1px solid var(--border)' }}>
        <div className="flex gap-2 items-end">
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); } }}
            placeholder="针对转写内容提问… (Enter 发送)"
            rows={2}
            className="flex-1 resize-none outline-none rounded-xl scrollbar-thin"
            style={{
              background: 'var(--bg-s2)',
              border: '1px solid var(--border)',
              color: 'var(--text-1)',
              fontSize: 13,
              padding: '8px 12px',
            }}
            onFocus={e => (e.currentTarget as HTMLElement).style.borderColor = 'var(--teal)'}
            onBlur={e => (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)'}
          />
          {loading ? (
            <button onClick={() => abortRef.current?.abort()}
              className="p-2.5 rounded-xl"
              style={{ background: 'var(--red-dim)', border: '1px solid #5a1e1e', color: 'var(--red)' }}>
              <Square size={14} />
            </button>
          ) : (
            <button onClick={() => send(input)} disabled={!input.trim() || !task}
              className="p-2.5 rounded-xl transition-all"
              style={{ background: 'var(--teal)', color: '#fff', border: 'none', opacity: input.trim() ? 1 : 0.3 }}>
              <Send size={14} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
