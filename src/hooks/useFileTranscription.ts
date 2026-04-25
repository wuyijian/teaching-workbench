import { useState, useCallback, useRef } from 'react';
import type { TranscriptSegment, Settings } from '../types';
import { resolveApiBase } from '../config/urls';

export type TranscribeStatus = 'idle' | 'uploading' | 'transcribing' | 'done' | 'error';

async function transcribeViaWhisperAPI(
  file: File,
  settings: Settings,
  language: string,
  onProgress: (p: number) => void,
): Promise<string> {
  const baseUrl = resolveApiBase(settings.apiBaseUrl);
  const formData = new FormData();
  formData.append('file', file);
  formData.append('model', 'whisper-1');
  formData.append('response_format', 'verbose_json');
  formData.append('timestamp_granularities[]', 'segment');
  if (language && language !== 'auto') {
    const langCode = language.split('-')[0];
    formData.append('language', langCode);
  }

  onProgress(30);

  const resp = await fetch(`${baseUrl}/audio/transcriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${settings.apiKey}` },
    body: formData,
  });

  onProgress(80);

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Whisper API 错误 ${resp.status}: ${errText}`);
  }

  const data = await resp.json();
  onProgress(100);
  return data;
}

function buildSegments(data: {
  text?: string;
  segments?: { text: string; start: number; end: number }[];
}): TranscriptSegment[] {
  if (data.segments && data.segments.length > 0) {
    return data.segments.map((seg, i) => ({
      id: `file-seg-${i}`,
      text: seg.text.trim(),
      timestamp: Math.round(seg.start),
      isFinal: true,
    }));
  }
  if (data.text) {
    return [{ id: 'file-seg-0', text: data.text.trim(), timestamp: 0, isFinal: true }];
  }
  return [];
}

export function useFileTranscription(settings: Settings) {
  const [status, setStatus] = useState<TranscribeStatus>('idle');
  const [progress, setProgress] = useState(0);
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const transcribe = useCallback(async (file: File, language: string) => {
    setError(null);
    setSegments([]);
    setProgress(0);
    setFileName(file.name);
    setStatus('uploading');

    if (!settings.apiKey) {
      setError('请先在设置中配置 API Key，才能使用文件转写功能');
      setStatus('error');
      return;
    }

    setStatus('transcribing');
    setProgress(10);

    try {
      const data = await transcribeViaWhisperAPI(file, settings, language, setProgress);
      const segs = buildSegments(data as Parameters<typeof buildSegments>[0]);
      setSegments(segs);
      setStatus('done');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '转写失败';
      setError(msg);
      setStatus('error');
    }
  }, [settings]);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setStatus('idle');
    setProgress(0);
    setSegments([]);
    setError(null);
    setFileName(null);
  }, []);

  return { status, progress, segments, error, fileName, transcribe, reset };
}
