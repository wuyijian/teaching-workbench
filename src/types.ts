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
 * 仅 language / feedbackPrompt 由用户经设置持久化到 localStorage。
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
}

export type TranscribeEngine = 'xfyun';

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
  aiSummary?: string;
  aiSavedAt?: number;
}
