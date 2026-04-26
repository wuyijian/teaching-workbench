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
  list_tasks:           '查询任务列表',
  get_transcript:       '读取转写内容',
  get_student_history:  '查看学生历史',
  save_feedback:        '保存课堂反馈',
  get_class_overview:   '获取全班概况',
  search_tasks:         '搜索任务',
  get_student_file:     '读取学生档案',
  update_student_file:  '更新学生档案',
  list_student_files:   '查看所有学生档案',
  get_global_memory:    '读取全局记忆',
  update_global_memory: '更新全局记忆',
};

const MAX_ITERATIONS = 12;

// ─── System Prompt ────────────────────────────────────────────────────────────

function buildSystemPrompt(globalMemory: string, feedbackPrompt: string): string {
  const memSection = globalMemory.trim()
    ? `\n\n---\n\n${globalMemory.trim()}`
    : '';

  return `你是语文教学工作台的 AI 助手，帮助语文教师分析课堂录音转写文本并生成家长反馈。

你拥有以下工具：

**教学数据**
- list_tasks：列出任务（pending_feedback / done / all）
- get_transcript：获取转写全文（生成反馈前必须调用）
- get_student_history：查看学生历史课节（含以往反馈）
- save_feedback：保存课堂反馈到任务（生成后立即调用）
- get_class_overview：全班概况
- search_tasks：关键词搜索转写内容

**学生专属档案**（Markdown 文件，跨对话持久化）
- get_student_file：读取某学生的 Markdown 档案（处理该学生任务前建议先调用）
- update_student_file：保存更新后的学生档案（先读取 → 追加新内容 → 保存完整文件）
- list_student_files：查看哪些学生已有档案

**全局记忆**（Markdown 文件）
- get_global_memory：读取全局记忆文件
- update_global_memory：保存更新后的全局记忆

工作原则：
1. 处理某学生任务前，先调用 get_student_file 读取其档案，将档案中的了解融入反馈
2. 每次处理完成后，调用 update_student_file 追加本次新发现的学生特点或跟进事项
3. 反馈生成后立即调用 save_feedback，无需等待用户确认
4. 批量处理时逐个循环：get_student_file → get_transcript → 生成反馈 → save_feedback → update_student_file
5. 档案文件格式为 Markdown，# 开头是学生姓名，## 开头是分类（性格特点/学习状态/待跟进/家庭背景等）
6. 所有回复使用简体中文，语气专业亲切

生成反馈时，使用以下 Prompt 模板（教师自定义）：

---
${feedbackPrompt}
---
${memSection}`;
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
  const [running, setRunning] = useState(false);
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
        content: buildSystemPrompt(loadGlobalMemory(), effectiveFeedbackPrompt(settingsRef.current)),
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

          const resp = await fetch(`${base}/chat/completions`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${s.apiKey}`,
            },
            body: JSON.stringify({
              model: s.model,
              messages: history,
              tools: TOOL_DEFINITIONS,
              tool_choice: 'auto',
            }),
            signal: ctrl.signal,
          });

          if (!resp.ok) {
            const text = await resp.text();
            throw new Error(`API 错误 ${resp.status}: ${text}`);
          }

          interface LLMMessage {
            role: string;
            content: string | null;
            tool_calls?: ToolCall[];
            reasoning_content?: string;
            thinking?: unknown;
          }
          interface LLMResponse {
            choices: Array<{ message: LLMMessage; finish_reason: string }>;
          }

          const data = (await resp.json()) as LLMResponse;
          const raw  = data.choices[0].message;

          // Preserve all raw fields so reasoning models echo correctly
          const assistantMsg: AgentMessage = {
            role: 'assistant',
            content: raw.content,
            tool_calls: raw.tool_calls,
            ...(raw.reasoning_content !== undefined && { reasoning_content: raw.reasoning_content }),
            ...(raw.thinking          !== undefined && { thinking: raw.thinking }),
          };
          history = [...history, assistantMsg];

          // No tool calls → final answer
          if (!raw.tool_calls || raw.tool_calls.length === 0) {
            setMessages(prev => [...prev, assistantMsg]);
            break;
          }

          setMessages(prev => [...prev, assistantMsg]);

          // Execute tool calls
          const toolResults: AgentMessage[] = [];
          for (const tc of raw.tool_calls) {
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
        abortRef.current = null;
      }
    },
    [running, messages, refreshMemories], // eslint-disable-line react-hooks/exhaustive-deps
  );

  return { messages, toolLog, globalMemory, studentFiles, running, send, stop, clear, deleteStudentFile };
}
