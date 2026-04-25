import { useState, useCallback, useRef } from 'react';
import type { TranscriptSegment, Settings } from '../types';
import { resolveApiBase } from '../config/urls';

export type TranscribeStatus = 'idle' | 'uploading' | 'transcribing' | 'done' | 'error';

// Whisper API 硬限制；留 1MB 余量
const WHISPER_MAX_BYTES = 24 * 1024 * 1024;
// 切片时长（秒），16kHz 单声道 WAV 约 19MB，安全低于限制
const CHUNK_SECONDS = 10 * 60;
// 切片后降采样目标采样率
const TARGET_SR = 16_000;

// ─── 音频处理工具函数 ─────────────────────────────────────────────────────────

/** 解码音频文件为 AudioBuffer */
async function decodeAudio(file: File): Promise<AudioBuffer> {
  const ab = await file.arrayBuffer();
  // OfflineAudioContext 仅用于解码，通道/长度参数只影响渲染，不影响 decodeAudioData
  const ctx = new OfflineAudioContext(1, 1, TARGET_SR);
  return ctx.decodeAudioData(ab);
}

/** 混声道为单声道并线性插值降采样 */
function toMono16k(buf: AudioBuffer, startSec: number, endSec: number): Float32Array {
  const srcSR = buf.sampleRate;
  const startIdx = Math.round(startSec * srcSR);
  const endIdx = Math.min(Math.round(endSec * srcSR), buf.length);
  const len = endIdx - startIdx;

  // 混声道
  const mono = new Float32Array(len);
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const data = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) mono[i] += data[startIdx + i] / buf.numberOfChannels;
  }

  // 降采样（若原始采样率已是 TARGET_SR 则跳过）
  if (srcSR === TARGET_SR) return mono;
  const ratio = srcSR / TARGET_SR;
  const outLen = Math.round(len / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio;
    const idx = Math.floor(pos);
    const frac = pos - idx;
    out[i] = idx + 1 < mono.length
      ? mono[idx] * (1 - frac) + mono[idx + 1] * frac
      : mono[idx];
  }
  return out;
}

/** 将 Float32Array PCM 编码为单声道 WAV Blob */
function encodeWAV(samples: Float32Array, sampleRate: number): Blob {
  const dataBytes = samples.length * 2;
  const buf = new ArrayBuffer(44 + dataBytes);
  const v = new DataView(buf);
  const w = (off: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + dataBytes, true);
  w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true);   // chunk size
  v.setUint16(20, 1, true);    // PCM
  v.setUint16(22, 1, true);    // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);    // block align
  v.setUint16(34, 16, true);   // bits per sample
  w(36, 'data'); v.setUint32(40, dataBytes, true);
  let off = 44;
  for (let i = 0; i < samples.length; i++, off += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}

// ─── Whisper API 调用 ─────────────────────────────────────────────────────────

interface WhisperResult {
  text?: string;
  segments?: { text: string; start: number; end: number }[];
}

async function callWhisper(
  blob: Blob,
  filename: string,
  settings: Settings,
  language: string,
): Promise<WhisperResult> {
  const baseUrl = resolveApiBase(settings.apiBaseUrl);
  const formData = new FormData();
  formData.append('file', new File([blob], filename, { type: 'audio/wav' }));
  formData.append('model', 'whisper-1');
  formData.append('response_format', 'verbose_json');
  formData.append('timestamp_granularities[]', 'segment');
  if (language && language !== 'auto') formData.append('language', language.split('-')[0]);

  const resp = await fetch(`${baseUrl}/audio/transcriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${settings.apiKey}` },
    body: formData,
  });
  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Whisper API 错误 ${resp.status}: ${errText}`);
  }
  return resp.json();
}

/** 直接上传（< 24MB），不切片 */
async function transcribeDirect(
  file: File,
  settings: Settings,
  language: string,
  onProgress: (p: number) => void,
): Promise<TranscriptSegment[]> {
  onProgress(20);
  const result = await callWhisper(file, file.name, settings, language);
  onProgress(90);
  return buildSegments(result, 0);
}

/**
 * 解码 → 切片 → 逐片转写 → 合并。
 * 适用于超过 24MB 的大文件。
 */
async function transcribeChunked(
  file: File,
  settings: Settings,
  language: string,
  onProgress: (p: number) => void,
  stopRef: { current: boolean },
): Promise<TranscriptSegment[]> {
  onProgress(5);
  const audioBuf = await decodeAudio(file);
  const totalSec = audioBuf.duration;
  const numChunks = Math.ceil(totalSec / CHUNK_SECONDS);

  const allSegments: TranscriptSegment[] = [];
  let segId = 0;

  for (let i = 0; i < numChunks; i++) {
    if (stopRef.current) throw new Error('已取消');

    const startSec = i * CHUNK_SECONDS;
    const endSec = Math.min((i + 1) * CHUNK_SECONDS, totalSec);

    const pcm = toMono16k(audioBuf, startSec, endSec);
    const wav = encodeWAV(pcm, TARGET_SR);
    const chunkName = `${file.name.replace(/\.[^.]+$/, '')}_chunk${i + 1}.wav`;

    const result = await callWhisper(wav, chunkName, settings, language);
    const chunkSegs = buildSegments(result, startSec);

    // 重新分配 id，叠加起始偏移
    for (const seg of chunkSegs) {
      allSegments.push({ ...seg, id: `file-seg-${segId++}` });
    }

    onProgress(Math.round(10 + ((i + 1) / numChunks) * 85));
  }

  return allSegments;
}

function buildSegments(data: WhisperResult, offsetSec: number): TranscriptSegment[] {
  if (data.segments && data.segments.length > 0) {
    return data.segments.map((seg, i) => ({
      id: `file-seg-${i}`,
      text: seg.text.trim(),
      timestamp: Math.round(seg.start + offsetSec),
      isFinal: true,
    }));
  }
  if (data.text) {
    return [{ id: 'file-seg-0', text: data.text.trim(), timestamp: Math.round(offsetSec), isFinal: true }];
  }
  return [];
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useFileTranscription(settings: Settings) {
  const [status, setStatus] = useState<TranscribeStatus>('idle');
  const [progress, setProgress] = useState(0);
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [chunked, setChunked] = useState(false);
  const stopRef = useRef(false);

  const transcribe = useCallback(async (file: File, language: string) => {
    setError(null);
    setSegments([]);
    setProgress(0);
    setChunked(false);
    setFileName(file.name);
    setStatus('uploading');
    stopRef.current = false;

    if (!settings.apiKey) {
      setError('请先在设置中配置 API Key，才能使用 Whisper 文件转写功能');
      setStatus('error');
      return;
    }

    setStatus('transcribing');
    setProgress(10);

    try {
      let segs: TranscriptSegment[];
      if (file.size > WHISPER_MAX_BYTES) {
        setChunked(true);
        segs = await transcribeChunked(file, settings, language, setProgress, stopRef);
      } else {
        segs = await transcribeDirect(file, settings, language, setProgress);
      }
      if (stopRef.current) return;
      setSegments(segs);
      setProgress(100);
      setStatus('done');
    } catch (err: unknown) {
      if (stopRef.current) return;
      setError(err instanceof Error ? err.message : '转写失败');
      setStatus('error');
    }
  }, [settings]);

  const reset = useCallback(() => {
    stopRef.current = true;
    setStatus('idle');
    setProgress(0);
    setSegments([]);
    setError(null);
    setFileName(null);
    setChunked(false);
  }, []);

  return { status, progress, segments, error, fileName, chunked, transcribe, reset };
}
