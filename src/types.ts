export type AppMode = 'workbench' | 'archive' | 'agent';

export interface TranscriptSegment {
  id: string;
  text: string;
  timestamp: number;
  isFinal: boolean;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export interface RecordingState {
  isRecording: boolean;
  isPaused: boolean;
  duration: number;
}

/**
 * 运行时由 mergePlatformApiSettings 组装：大模型 + 讯飞从 VITE_* 注入；
 * 仅 language / feedbackPrompt / enableKnowledgeBase 由用户经设置持久化到 localStorage。
 */
export interface Settings {
  apiKey: string;
  apiBaseUrl: string;
  model: string;
  language: string;
  xfAppId: string;
  xfAccessKeyId: string;
  xfAccessKeySecret: string;
  feedbackPrompt?: string;
  enableKnowledgeBase?: boolean;
}

export type TranscribeEngine = 'xfyun' | 'volcano';

export type TaskStatus = 'queued' | 'uploading' | 'transcribing' | 'done' | 'error';

export interface Task {
  id: string;
  /** 兼容字段：单学生时等于学生姓名，多学生时为顿号拼接（仅用于旧数据展示） */
  studentName: string;
  /** 实际学生列表，新建任务时写入；旧数据缺省则取 [studentName] */
  studentNames?: string[];
  topic: string;
  prompt: string;
  engine: TranscribeEngine;
  audioFileName: string;
  audioFile?: File;
  status: TaskStatus;
  progress: number;
  segments: TranscriptSegment[];
  error: string | null;
  createdAt: number;
  estimateMs?: number;
  notes?: string;       // 教师补充信息（课前检测、课堂观察等）
  examAnalysis?: string; // 试卷分析（得分点/失分点/错题类型等）
  /** 试卷文件元信息（不含文件内容本身） */
  examFile?: { name: string; size: number; type: string };
  /** 兼容旧数据字段：历史版本可能写入 base64 DataURL；新版本不再持久化该字段 */
  examFileDataUrl?: string;
  /** 任务类型，默认兼容为 'transcribe'；新建试卷分析任务时为 'exam' */
  taskType?: 'transcribe' | 'exam';
  /** Kimi 文件解析 file_id，上传成功后写入；用于 AI 分析时直接引用试卷内容 */
  examKimiFileId?: string;
  /** Kimi 文件上传状态；undefined 表示无文件或旧任务（兼容） */
  examKimiUploadStatus?: 'uploading' | 'ready' | 'error';
  aiSummary?: string;
  aiSavedAt?: number;
}
