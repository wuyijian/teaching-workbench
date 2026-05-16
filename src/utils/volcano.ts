/**
 * 火山引擎「豆包语音大模型 - 录音文件识别（标准版）」转写工具
 *
 * 资源 ID：volc.bigasr.auc
 * API：异步 submit + poll
 *   POST /api/v3/auc/bigmodel/submit
 *   POST /api/v3/auc/bigmodel/query
 * 限制：≤ 2h / 100MB
 *
 * 鉴权（新控制台）：Header X-Api-Key
 * 鉴权（旧控制台）：Header X-Api-App-Key + X-Api-Access-Key
 */

import type { TranscriptSegment } from '../types';

// ─── Auth headers ─────────────────────────────────────────────────────────────

export interface VolcanoCredentials {
  /** 新控制台：apiKey 即可 */
  apiKey?: string;
  /** 旧控制台 AppID */
  appId?: string;
  /** 旧控制台 Access Token */
  accessKey?: string;
}

export function buildVolcanoHeaders(
  creds: VolcanoCredentials,
  requestId: string,
): Record<string, string> {
  const base: Record<string, string> = {
    'Content-Type':      'application/json',
    'X-Api-Resource-Id': 'volc.bigasr.auc',
    'X-Api-Request-Id':  requestId,
    'X-Api-Sequence':    '-1',
  };

  if (creds.apiKey) {
    // 新控制台只需 X-Api-Key
    base['X-Api-Key'] = creds.apiKey;
  } else {
    // 旧控制台 AppID + Access Token
    if (creds.appId)    base['X-Api-App-Key']    = creds.appId;
    if (creds.accessKey) base['X-Api-Access-Key'] = creds.accessKey;
  }

  return base;
}

// ─── Request body ──────────────────────────────────────────────────────────────

export interface VolcanoRequestBody {
  user: { uid: string };
  audio: { data?: string; url?: string };
  request: {
    model_name: 'bigmodel';
    enable_itn?: boolean;
    enable_punc?: boolean;
    enable_ddc?: boolean;
    /** 说话人分离（多人场景） */
    enable_speaker_info?: boolean;
    /** 必须开启才会返回分句的 utterances 列表 */
    show_utterances?: boolean;
    language?: string;
  };
  /** 异步版：回调 URL（可选，不填则纯轮询） */
  callback?: string;
}

export function buildVolcanoBody(
  audioBase64OrUrl: { data: string } | { url: string },
  uid: string,
  language: string,
  enableSpeakerInfo = false,
): VolcanoRequestBody {
  return {
    user: { uid },
    audio: audioBase64OrUrl,
    request: {
      model_name: 'bigmodel',
      enable_itn: true,
      enable_punc: true,
      enable_ddc: true,
      enable_speaker_info: enableSpeakerInfo,
      show_utterances: true,
      language: language.startsWith('zh') ? 'zh-CN' : language,
    },
  };
}

/**
 * File → Base64 string（浏览器环境，分块读取避免 Safari OOM）
 *
 * readAsDataURL 会将整个文件一次性读入内存（100MB 文件 → ~133MB base64 字符串
 * + 内部 ArrayBuffer），在 Safari 上容易触发 OOM。
 * 改为每次读取 1.5 MB 切片（3 的倍数，保证 base64 块边界对齐），
 * 每块编码后即可被 GC，峰值内存从 ~467MB 降至 ~270MB（100MB 文件）。
 */
export function fileToBase64(file: File): Promise<string> {
  // 1.5 MB per chunk – must be a multiple of 3 for correct base64 alignment
  const CHUNK = 3 * 512 * 1024;
  return new Promise((resolve, reject) => {
    const parts: string[] = [];
    let offset = 0;

    function readNext() {
      if (offset >= file.size) {
        resolve(parts.join(''));
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const u8 = new Uint8Array(reader.result as ArrayBuffer);
        // Build binary string in 64KB sub-chunks to avoid call-stack limits
        let bin = '';
        for (let i = 0; i < u8.length; i += 65536) {
          bin += String.fromCharCode(...u8.subarray(i, i + 65536));
        }
        parts.push(btoa(bin));
        offset += CHUNK;
        // Schedule next chunk asynchronously to let the GC breathe
        setTimeout(readNext, 0);
      };
      reader.onerror = () => reject(new Error('文件读取失败'));
      reader.readAsArrayBuffer(file.slice(offset, offset + CHUNK));
    }

    readNext();
  });
}

// ─── Response parsing ──────────────────────────────────────────────────────────

interface VolcanoUtterance {
  start_time: number; // ms
  end_time: number;   // ms
  text: string;
}

interface VolcanoFlashResponse {
  result?: {
    text?: string;
    utterances?: VolcanoUtterance[];
  };
  audio_info?: { duration?: number };
}

interface VolcanoAsyncResponse {
  audio_info?: { duration?: number };
  result?: {
    text?: string;
    utterances?: VolcanoUtterance[];
  };
}

export function parseVolcanoFlashResult(body: VolcanoFlashResponse): TranscriptSegment[] {
  const utterances = body.result?.utterances;
  if (!utterances || utterances.length === 0) {
    // 降级：整段文本作为单条 segment
    const text = body.result?.text?.trim();
    if (!text) return [];
    return [{ id: 'vlc-0', text, timestamp: 0, isFinal: true }];
  }

  return utterances
    .map((u, idx) => ({
      id: `vlc-${idx}`,
      text: u.text.trim(),
      timestamp: Math.round(u.start_time / 1000), // ms → s
      isFinal: true,
    }))
    .filter(s => s.text.length > 0);
}

export function parseVolcanoAsyncResult(body: VolcanoAsyncResponse): TranscriptSegment[] {
  const utterances = body.result?.utterances;
  if (!utterances || utterances.length === 0) {
    const text = body.result?.text?.trim();
    if (!text) return [];
    return [{ id: 'vlc-0', text, timestamp: 0, isFinal: true }];
  }

  return utterances
    .map((u, idx) => ({
      id: `vlc-${idx}`,
      text: u.text.trim(),
      timestamp: Math.round(u.start_time / 1000),
      isFinal: true,
    }))
    .filter(s => s.text.length > 0);
}

// ─── Status codes ──────────────────────────────────────────────────────────────

export function isVolcanoSuccess(statusCode: string): boolean {
  return statusCode === '20000000';
}

/** 静音/空音频，不算错误，当作空结果处理 */
export function isVolcanoSilent(statusCode: string): boolean {
  return statusCode === '20000003' || statusCode === '45000002';
}

/** 异步任务是否仍在处理中 */
export function isVolcanoPending(statusCode: string): boolean {
  return statusCode === '20000001' || statusCode === '20000002';
}
