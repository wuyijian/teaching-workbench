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
}

export type TranscribeEngine = 'whisper' | 'xfyun';

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
  aiSummary?: string;
  aiSavedAt?: number;
}
