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

export interface Settings {
  apiKey: string;
  apiBaseUrl: string;
  model: string;
  language: string;
  // 讯飞大模型转写
  xfAppId: string;
  xfAccessKeyId: string;
  xfAccessKeySecret: string;
  // 课堂反馈 Prompt（为空时使用内置默认值）
  feedbackPrompt?: string;
}

export type TranscribeEngine = 'xfyun';

export type TaskStatus = 'queued' | 'uploading' | 'transcribing' | 'done' | 'error';

export interface Task {
  id: string;
  studentName: string;
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
