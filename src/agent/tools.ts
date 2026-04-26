import type { Task } from '../types';
import { normalizeStudentKey } from '../utils/student';

// ─── Student Memory Files (Markdown) ─────────────────────────────────────────
//
// Each student has one Markdown file stored as a plain string in localStorage.
// The agent reads and rewrites the entire file, just like editing a real .md file.
// Format example:
//
//   # 张三
//
//   ## 性格特点
//   - 内向，课堂发言需要主动鼓励（2026-04-26）
//
//   ## 学习状态
//   - 文言文词汇薄弱，现代文理解能力强（2026-04-26）
//
//   ## 待跟进
//   - 《背影》仿写作业未交，下次确认（2026-04-26）

const STUDENT_MEM_KEY = 'tw-student-memories';

export interface StudentFile {
  studentName: string;
  markdown: string;
  updatedAt: number;
}

type StudentStore = Record<string, StudentFile>; // key = normalizeStudentKey(name)

export function loadStudentStore(): StudentStore {
  try { return JSON.parse(localStorage.getItem(STUDENT_MEM_KEY) || '{}') as StudentStore; }
  catch { return {}; }
}

export function saveStudentStore(store: StudentStore): void {
  localStorage.setItem(STUDENT_MEM_KEY, JSON.stringify(store));
}

export function loadStudentFile(name: string): StudentFile | null {
  return loadStudentStore()[normalizeStudentKey(name)] ?? null;
}

function todayStr(): string {
  return new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

function newFileTemplate(studentName: string): string {
  return `# ${studentName}\n\n_创建于 ${todayStr()}_\n`;
}

// ─── Global Memory (Markdown) ─────────────────────────────────────────────────
//
// One shared Markdown file for global teaching notes (not student-specific).
//
//   # 全局记忆
//
//   ## 教学
//   - 本班文言文基础普遍薄弱（2026-04-26）
//
//   ## 提醒
//   - 期中考试 5月15日（2026-04-26）

const GLOBAL_MEM_KEY = 'tw-global-memory';

export function loadGlobalMemory(): string {
  return localStorage.getItem(GLOBAL_MEM_KEY) || '';
}

export function saveGlobalMemory(md: string): void {
  localStorage.setItem(GLOBAL_MEM_KEY, md);
}

// Keep the old Memory type for backwards compatibility during migration
export interface Memory {
  id: string;
  tag: string;
  content: string;
  createdAt: number;
}

// ─── OpenAI Function Calling Schema ───────────────────────────────────────────

export const TOOL_DEFINITIONS = [
  {
    type: 'function' as const,
    function: {
      name: 'list_tasks',
      description: '列出任务列表。status="pending_feedback" 返回已完成转写但尚未生成 AI 反馈的任务；"done" 返回全部已完成；"all" 返回全部任务。',
      parameters: {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            enum: ['pending_feedback', 'done', 'all'],
          },
        },
        required: ['status'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_transcript',
      description: '获取指定任务的完整转写内容（含时间戳片段和全文）。生成反馈前必须调用此工具。',
      parameters: {
        type: 'object',
        properties: {
          task_id: { type: 'string', description: '任务 ID（由 list_tasks 返回）' },
        },
        required: ['task_id'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_student_history',
      description: '获取某学生的全部历史课节记录，含以往反馈摘要，用于纵向对比分析进步情况。',
      parameters: {
        type: 'object',
        properties: {
          student_name: { type: 'string' },
        },
        required: ['student_name'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'save_feedback',
      description: '将生成好的课堂反馈文本保存到指定任务。生成完毕后主动调用，无需等待用户确认。',
      parameters: {
        type: 'object',
        properties: {
          task_id: { type: 'string' },
          feedback: { type: 'string', description: '完整的课堂反馈内容' },
        },
        required: ['task_id', 'feedback'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_class_overview',
      description: '获取全班整体概况：学生人数、总任务数、待处理反馈数、各学生最近上课时间及完成情况。',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'search_tasks',
      description: '在所有任务的转写内容、学生姓名、课题中搜索关键词，返回相关任务列表。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
        },
        required: ['query'],
      },
    },
  },

  // ── 学生专属档案（Markdown 文件） ─────────────────────────────────────────────
  {
    type: 'function' as const,
    function: {
      name: 'get_student_file',
      description: '读取某学生的专属记忆文件（Markdown 格式）。文件记录了该学生的性格特点、学习状态、待跟进事项等。处理该学生任务前建议先调用。',
      parameters: {
        type: 'object',
        properties: {
          student_name: { type: 'string' },
        },
        required: ['student_name'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'update_student_file',
      description: '更新某学生的专属记忆文件。传入完整的新 Markdown 内容（包含原有内容 + 新增内容）。建议先 get_student_file 读取现有内容，追加新内容后再调用本工具保存。',
      parameters: {
        type: 'object',
        properties: {
          student_name: { type: 'string' },
          markdown: {
            type: 'string',
            description: '完整的 Markdown 文件内容，以 # 学生姓名 开头',
          },
        },
        required: ['student_name', 'markdown'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'list_student_files',
      description: '列出所有已有专属记忆文件的学生名单。',
      parameters: { type: 'object', properties: {} },
    },
  },

  // ── 全局记忆（Markdown 文件） ──────────────────────────────────────────────
  {
    type: 'function' as const,
    function: {
      name: 'get_global_memory',
      description: '读取全局记忆文件（Markdown 格式），包含教学规律、班级整体情况、提醒事项等非学生个人信息。',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'update_global_memory',
      description: '更新全局记忆文件。传入完整的新 Markdown 内容。建议先 get_global_memory 读取现有内容，追加后再保存。',
      parameters: {
        type: 'object',
        properties: {
          markdown: {
            type: 'string',
            description: '完整的 Markdown 文件内容',
          },
        },
        required: ['markdown'],
      },
    },
  },
] as const;

export type ToolName = typeof TOOL_DEFINITIONS[number]['function']['name'];

export interface ToolContext {
  tasks: Task[];
  saveFeedback: (taskId: string, feedback: string) => void;
  onMemoryChange?: () => void;
}

// ─── Tool Implementations ─────────────────────────────────────────────────────

export function executeTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
): unknown {
  switch (name as ToolName) {

    case 'list_tasks': {
      const status = args.status as string;
      let result = ctx.tasks;
      if (status === 'pending_feedback') {
        result = ctx.tasks.filter(t => t.status === 'done' && !t.aiSummary && t.segments.length > 0);
      } else if (status === 'done') {
        result = ctx.tasks.filter(t => t.status === 'done');
      }
      return result.map(t => ({
        id: t.id,
        studentName: t.studentName,
        topic: t.topic,
        status: t.status,
        createdAt: new Date(t.createdAt).toLocaleString('zh-CN'),
        hasTranscript: t.segments.length > 0,
        hasFeedback: !!t.aiSummary,
        charCount: t.segments.reduce((n, s) => n + s.text.length, 0),
        notes: t.notes || null,
      }));
    }

    case 'get_transcript': {
      const task = ctx.tasks.find(t => t.id === args.task_id);
      if (!task) return { error: `任务 ${args.task_id} 不存在` };
      const pad2 = (n: number) => String(n).padStart(2, '0');
      return {
        taskId: task.id,
        studentName: task.studentName,
        topic: task.topic,
        notes: task.notes || null,
        charCount: task.segments.reduce((n, s) => n + s.text.length, 0),
        segments: task.segments.map(s => ({
          timestamp: `${pad2(Math.floor(s.timestamp / 60))}:${pad2(s.timestamp % 60)}`,
          text: s.text,
        })),
        fullText: task.segments.map(s => s.text).join(''),
      };
    }

    case 'get_student_history': {
      const key = normalizeStudentKey(args.student_name as string);
      const studentTasks = ctx.tasks
        .filter(t => normalizeStudentKey(t.studentName) === key)
        .sort((a, b) => b.createdAt - a.createdAt);
      if (studentTasks.length === 0) return { error: `未找到学生「${args.student_name}」的任何记录` };
      return {
        studentName: studentTasks[0].studentName,
        totalLessons: studentTasks.length,
        history: studentTasks.map(t => ({
          id: t.id,
          topic: t.topic,
          date: new Date(t.createdAt).toLocaleDateString('zh-CN'),
          status: t.status,
          hasFeedback: !!t.aiSummary,
          feedbackPreview: t.aiSummary
            ? (t.aiSummary.length > 120 ? t.aiSummary.slice(0, 120) + '…' : t.aiSummary)
            : null,
          charCount: t.segments.reduce((n, s) => n + s.text.length, 0),
        })),
      };
    }

    case 'save_feedback': {
      const task = ctx.tasks.find(t => t.id === args.task_id);
      if (!task) return { success: false, error: `任务 ${args.task_id} 不存在` };
      ctx.saveFeedback(args.task_id as string, args.feedback as string);
      return { success: true, taskId: args.task_id, studentName: task.studentName, topic: task.topic };
    }

    case 'get_class_overview': {
      const studentMap = new Map<string, Task[]>();
      for (const t of ctx.tasks) {
        const k = normalizeStudentKey(t.studentName);
        if (!studentMap.has(k)) studentMap.set(k, []);
        studentMap.get(k)!.push(t);
      }
      const store = loadStudentStore();
      const students = Array.from(studentMap.entries())
        .map(([k, ts]) => {
          const sorted = [...ts].sort((a, b) => b.createdAt - a.createdAt);
          return {
            name: sorted[0].studentName,
            totalLessons: ts.length,
            lastLesson: new Date(sorted[0].createdAt).toLocaleDateString('zh-CN'),
            feedbackCount: ts.filter(t => !!t.aiSummary).length,
            pendingFeedback: ts.filter(t => t.status === 'done' && !t.aiSummary && t.segments.length > 0).length,
            hasMemoryFile: !!store[k],
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
      return {
        totalStudents: students.length,
        totalTasks: ctx.tasks.length,
        pendingFeedback: ctx.tasks.filter(t => t.status === 'done' && !t.aiSummary && t.segments.length > 0).length,
        students,
      };
    }

    case 'search_tasks': {
      const query = (args.query as string).toLowerCase();
      return ctx.tasks
        .filter(t =>
          t.topic.toLowerCase().includes(query) ||
          t.studentName.toLowerCase().includes(query) ||
          t.segments.some(s => s.text.toLowerCase().includes(query)),
        )
        .map(t => ({
          id: t.id,
          studentName: t.studentName,
          topic: t.topic,
          date: new Date(t.createdAt).toLocaleDateString('zh-CN'),
          matchCount: t.segments.filter(s => s.text.toLowerCase().includes(query)).length,
          previewSegments: t.segments
            .filter(s => s.text.toLowerCase().includes(query))
            .slice(0, 2)
            .map(s => s.text.slice(0, 80)),
        }));
    }

    // ── 学生专属档案 ─────────────────────────────────────────────────────────────

    case 'get_student_file': {
      const file = loadStudentFile(args.student_name as string);
      if (!file) {
        const template = newFileTemplate(args.student_name as string);
        return {
          studentName: args.student_name,
          exists: false,
          markdown: template,
          hint: '该学生尚无记忆文件，以上为初始模板。如需保存内容请调用 update_student_file。',
        };
      }
      return {
        studentName: file.studentName,
        exists: true,
        updatedAt: new Date(file.updatedAt).toLocaleString('zh-CN'),
        markdown: file.markdown,
      };
    }

    case 'update_student_file': {
      const store = loadStudentStore();
      const key   = normalizeStudentKey(args.student_name as string);
      const md    = args.markdown as string;
      store[key] = {
        studentName: args.student_name as string,
        markdown: md,
        updatedAt: Date.now(),
      };
      saveStudentStore(store);
      ctx.onMemoryChange?.();
      return { success: true, studentName: args.student_name, chars: md.length };
    }

    case 'list_student_files': {
      const store = loadStudentStore();
      return Object.values(store)
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map(f => ({
          studentName: f.studentName,
          updatedAt: new Date(f.updatedAt).toLocaleString('zh-CN'),
          chars: f.markdown.length,
          preview: f.markdown.split('\n').filter(l => l.startsWith('- ')).slice(0, 2).join(' / '),
        }));
    }

    // ── 全局记忆 ──────────────────────────────────────────────────────────────────

    case 'get_global_memory': {
      const md = loadGlobalMemory();
      if (!md) return {
        exists: false,
        markdown: '# 全局记忆\n\n_暂无内容，可用 update_global_memory 创建_\n',
      };
      return { exists: true, markdown: md };
    }

    case 'update_global_memory': {
      const md = args.markdown as string;
      saveGlobalMemory(md);
      ctx.onMemoryChange?.();
      return { success: true, chars: md.length };
    }

    default:
      return { error: `未知工具: ${name}` };
  }
}
