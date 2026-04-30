import { useState, useCallback, useRef, useEffect } from 'react';
import type { Task, Settings } from '../types';
import {
  TOOL_DEFINITIONS, executeTool,
  loadStudentStore, saveStudentStore, loadGlobalMemory,
  type ToolContext, type StudentFile,
} from './tools';
import { effectiveFeedbackPrompt } from '../components/FeedbackPanel';
import { resolveApiBase } from '../config/urls';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface AgentMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
  // reasoning models (e.g. Claude extended thinking) return this field;
  // must be echoed back verbatim in subsequent turns
  reasoning_content?: string;
  thinking?: unknown;
}

export interface ToolCallDisplay {
  id: string;
  name: string;
  label: string;
  args: unknown;
  result?: unknown;
  status: 'running' | 'done' | 'error';
}

// ─── Persistence Keys ─────────────────────────────────────────────────────────

const MSG_KEY  = 'tw-agent-messages';
const LOG_KEY  = 'tw-agent-toollog';
const MAX_PERSISTED_MESSAGES = 60; // keep recent N messages to avoid bloat

// ─── Tool Label Map ───────────────────────────────────────────────────────────

const TOOL_LABELS: Record<string, string> = {
  list_tasks:                '查询任务列表',
  get_transcript:            '读取转写内容',
  get_student_history:       '查看学生历史',
  save_feedback:             '保存课堂反馈',
  get_class_overview:        '获取全班概况',
  search_tasks:              '搜索任务',
  get_student_file:          '读取学生档案',
  update_student_file:       '更新学生档案',
  list_student_files:        '查看所有学生档案',
  get_global_memory:         '读取全局记忆',
  update_global_memory:      '更新全局记忆',
  analyze_student_progress:  '分析学生进步轨迹',
  get_recent_tasks:          '筛选近期任务',
};

const MAX_ITERATIONS = 12;

// ─── System Prompt ────────────────────────────────────────────────────────────

function buildSystemPrompt(
  globalMemory: string,
  feedbackPrompt: string,
  contextHint: string,
): string {
  const memSection = globalMemory.trim()
    ? `\n\n---\n\n## 全局记忆\n${globalMemory.trim()}`
    : '';

  return `你是语文教学工作台的 AI 助手，帮助语文教师分析课堂录音转写文本并生成家长反馈。

${contextHint}

你拥有以下工具：

**教学数据查询**
- list_tasks：列出任务（pending_feedback / done / all）
- get_transcript：获取转写全文（生成反馈前必须先调用）
- get_student_history：查看学生全部历史课节（含以往反馈摘要）
- save_feedback：保存课堂反馈到指定任务（生成后立即调用，无需确认）
- get_class_overview：获取全班概况（人数/课次/待处理统计）
- search_tasks：全文搜索转写内容关键词
- get_recent_tasks：按天数筛选近期任务（days=1 今天，days=7 本周）

**学生成长分析**
- analyze_student_progress：纵向分析某学生跨多节课的进步轨迹与关键词趋势
- get_student_file：读取某学生的专属档案（处理任务前建议先调用）
- update_student_file：保存/更新学生档案（先读取 → 追加 → 保存完整文件）
- list_student_files：查看所有已有档案的学生

**全局记忆**
- get_global_memory：读取全局记忆（班级情况、教学规律、提醒事项）
- update_global_memory：更新全局记忆

工作原则：
1. **先读档案再处理**：处理某学生任务前，先调用 get_student_file，将档案中的已知信息融入反馈
2. **处理后更新档案**：每次处理完成后，调用 update_student_file 追加本次新发现的特点
3. **立即保存反馈**：反馈生成后立即调用 save_feedback，不需要等用户确认
4. **批量处理顺序**：get_student_file → get_transcript → 生成反馈 → save_feedback → update_student_file
5. **档案格式**：Markdown，# 学生姓名，## 分类（性格特点/学习状态/待跟进/家庭背景等）
6. **语气**：专业亲切，简体中文，回复尽量结构化（用 Markdown 表格/列表）

生成反馈时，使用以下 Prompt 模板（教师自定义）：

---
${feedbackPrompt}
---
${memSection}`;
}

// ─── 为系统提示构建当前上下文摘要 ────────────────────────────────────────────

function buildContextHint(tasks: Task[]): string {
  const today = new Date().toLocaleDateString('zh-CN', {
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'long',
  });
  const todayCutoff = new Date(); todayCutoff.setHours(0, 0, 0, 0);
  const todayTasks = tasks.filter(t => t.createdAt >= todayCutoff.getTime());
  const pendingFeedback = tasks.filter(t => t.status === 'done' && !t.aiSummary && t.segments.length > 0).length;
  const totalDone = tasks.filter(t => t.status === 'done').length;
  const studentSet = new Set(tasks.map(t => t.studentName.trim()).filter(Boolean));

  const parts = [
    `**当前时间**：${today}`,
    `**任务概况**：共 ${tasks.length} 条任务，${totalDone} 条已完成转写，${studentSet.size} 名学生`,
    pendingFeedback > 0
      ? `**待处理**：⚠️ 有 ${pendingFeedback} 条任务尚未生成 AI 反馈`
      : '**待处理**：全部任务反馈已完成 ✅',
    todayTasks.length > 0
      ? `**今日新增**：${todayTasks.length} 条任务`
      : '',
  ].filter(Boolean).join('\n');

  return parts;
}

// ─── Streaming LLM call ───────────────────────────────────────────────────────

interface StreamResult {
  content: string | null;
  tool_calls: ToolCall[] | undefined;
}

async function callLLMStreaming(
  messages: AgentMessage[],
  tools: typeof TOOL_DEFINITIONS,
  apiBase: string,
  apiKey: string,
  model: string,
  signal: AbortSignal,
  onContentChunk: (chunk: string) => void,
): Promise<StreamResult> {
  const resp = await fetch(`${apiBase}/chat/completions`, {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      tools,
      tool_choice: 'auto',
      stream: true,
    }),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`API 错误 ${resp.status}: ${text}`);
  }

  let content = '';
  // tool_call fragments keyed by index
  const tcMap = new Map<number, { id: string; name: string; args: string }>();

  const processLine = (line: string) => {
    if (!line.startsWith('data: ')) return;
    const data = line.slice(6).trim();
    if (data === '[DONE]') return;
    let parsed: unknown;
    try { parsed = JSON.parse(data); } catch { return; }
    const p = parsed as {
      choices?: Array<{
        delta?: {
          content?: string;
          tool_calls?: Array<{
            index: number; id?: string;
            function?: { name?: string; arguments?: string };
          }>;
        };
      }>;
    };
    const delta = p.choices?.[0]?.delta;
    if (!delta) return;

    if (typeof delta.content === 'string' && delta.content) {
      content += delta.content;
      onContentChunk(delta.content);
    }
    if (delta.tool_calls) {
      for (const tc of delta.tool_calls) {
        const idx = tc.index;
        if (!tcMap.has(idx)) tcMap.set(idx, { id: '', name: '', args: '' });
        const entry = tcMap.get(idx)!;
        if (tc.id)                    entry.id   += tc.id;
        if (tc.function?.name)        entry.name += tc.function.name;
        if (tc.function?.arguments)   entry.args += tc.function.arguments;
      }
    }
  };

  // Safari 14 compat: resp.body may be null → fall back to text()
  if (!resp.body) {
    const text = await resp.text();
    for (const line of text.split('\n')) processLine(line);
  } else {
    const reader = resp.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value);
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) processLine(line);
    }
    if (buf) processLine(buf);
  }

  const tool_calls = tcMap.size > 0
    ? Array.from(tcMap.entries())
        .sort(([a], [b]) => a - b)
        .map(([, tc]) => ({
          id: tc.id || `tc-${Math.random().toString(36).slice(2)}`,
          type: 'function' as const,
          function: { name: tc.name, arguments: tc.args },
        }))
    : undefined;

  return { content: content || null, tool_calls };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function saveMessages(msgs: AgentMessage[]) {
  try {
    const trimmed = msgs.slice(-MAX_PERSISTED_MESSAGES);
    localStorage.setItem(MSG_KEY, JSON.stringify(trimmed));
  } catch { /* storage full – ignore */ }
}

function saveLogs(logs: ToolCallDisplay[]) {
  try {
    localStorage.setItem(LOG_KEY, JSON.stringify(logs.slice(-100)));
  } catch { /* ignore */ }
}

function loadMessages(): AgentMessage[] {
  try {
    return JSON.parse(localStorage.getItem(MSG_KEY) || '[]') as AgentMessage[];
  } catch { return []; }
}

function loadLogs(): ToolCallDisplay[] {
  try {
    return JSON.parse(localStorage.getItem(LOG_KEY) || '[]') as ToolCallDisplay[];
  } catch { return []; }
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useAgent(
  tasks: Task[],
  onSaveFeedback: (taskId: string, feedback: string) => void,
  settings: Settings,
) {
  const [messages, setMessages]         = useState<AgentMessage[]>(loadMessages);
  const [toolLog, setToolLog]           = useState<ToolCallDisplay[]>(loadLogs);
  const [globalMemory, setGlobalMemory] = useState<string>(loadGlobalMemory);
  const [studentFiles, setStudentFiles] = useState<StudentFile[]>(() =>
    Object.values(loadStudentStore()),
  );
  const [running, setRunning]           = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  // keep refs updated so async closures see latest values
  const tasksRef        = useRef(tasks);
  const saveFeedbackRef = useRef(onSaveFeedback);
  const settingsRef     = useRef(settings);
  tasksRef.current        = tasks;
  saveFeedbackRef.current = onSaveFeedback;
  settingsRef.current     = settings;

  // Persist messages & toolLog whenever they change
  useEffect(() => { saveMessages(messages); }, [messages]);
  useEffect(() => { saveLogs(toolLog); }, [toolLog]);

  const refreshMemories = useCallback(() => {
    setGlobalMemory(loadGlobalMemory());
    setStudentFiles(Object.values(loadStudentStore()));
  }, []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    setStreamingContent('');
  }, []);

  const clear = useCallback(() => {
    setMessages([]);
    setToolLog([]);
    localStorage.removeItem(MSG_KEY);
    localStorage.removeItem(LOG_KEY);
  }, []);

  const deleteStudentFile = useCallback((studentName: string) => {
    const store = loadStudentStore();
    delete store[studentName.trim()];
    saveStudentStore(store);
    setStudentFiles(Object.values(store));
  }, []);

  const send = useCallback(
    async (userContent: string) => {
      if (running) return;

      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setRunning(true);

      const userMsg: AgentMessage = { role: 'user', content: userContent };
      setMessages(prev => [...prev, userMsg]);

      // Build API history: system (with global memory + custom prompt) + prior turns + new message
      const systemMsg: AgentMessage = {
        role: 'system',
        content: buildSystemPrompt(
          loadGlobalMemory(),
          effectiveFeedbackPrompt(settingsRef.current),
          buildContextHint(tasksRef.current),
        ),
      };
      let history: AgentMessage[] = [
        systemMsg,
        ...messages.filter(m => m.role !== 'system'),
        userMsg,
      ];

      const ctx: ToolContext = {
        tasks: tasksRef.current,
        saveFeedback: saveFeedbackRef.current,
        onMemoryChange: refreshMemories,
      };
      const s = settingsRef.current;
      const base = resolveApiBase(s.apiBaseUrl);

      try {
        for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
          if (ctrl.signal.aborted) break;

          // 流式调用：content 块实时推送，tool_calls 完整收集后执行
          let streamedContent = '';
          const { content: rawContent, tool_calls: rawToolCalls } = await callLLMStreaming(
            history,
            TOOL_DEFINITIONS,
            base,
            s.apiKey,
            s.model,
            ctrl.signal,
            chunk => {
              streamedContent += chunk;
              setStreamingContent(streamedContent);
            },
          );

          // 清除流式缓冲
          setStreamingContent('');

          const assistantMsg: AgentMessage = {
            role: 'assistant',
            content: rawContent,
            tool_calls: rawToolCalls,
          };
          history = [...history, assistantMsg];

          // No tool calls → final answer
          if (!rawToolCalls || rawToolCalls.length === 0) {
            setMessages(prev => [...prev, assistantMsg]);
            break;
          }

          setMessages(prev => [...prev, assistantMsg]);

          // Execute tool calls
          const toolResults: AgentMessage[] = [];
          for (const tc of rawToolCalls) {
            const args = (() => {
              try { return JSON.parse(tc.function.arguments || '{}') as Record<string, unknown>; }
              catch { return {} as Record<string, unknown>; }
            })();

            setToolLog(prev => [
              ...prev,
              {
                id:     tc.id,
                name:   tc.function.name,
                label:  TOOL_LABELS[tc.function.name] ?? tc.function.name,
                args,
                status: 'running',
              },
            ]);

            let result: unknown;
            let status: 'done' | 'error' = 'done';
            try {
              result = executeTool(tc.function.name, args, ctx);
            } catch (e) {
              result = { error: String(e) };
              status = 'error';
            }

            setToolLog(prev =>
              prev.map(t => (t.id === tc.id ? { ...t, result, status } : t)),
            );

            toolResults.push({
              role:         'tool',
              tool_call_id: tc.id,
              name:         tc.function.name,
              content:      JSON.stringify(result),
            });
          }

          history = [...history, ...toolResults];
          setMessages(prev => [...prev, ...toolResults]);
        }
      } catch (e: unknown) {
        if ((e as Error).name !== 'AbortError') {
          setMessages(prev => [
            ...prev,
            { role: 'assistant', content: `出错了：${(e as Error).message}` },
          ]);
        }
      } finally {
        setRunning(false);
        setStreamingContent('');
        abortRef.current = null;
      }
    },
    [running, messages, refreshMemories], // eslint-disable-line react-hooks/exhaustive-deps
  );

  return { messages, toolLog, globalMemory, studentFiles, running, streamingContent, send, stop, clear, deleteStudentFile };
}
