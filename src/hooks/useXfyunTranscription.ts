import { useState, useCallback, useRef } from 'react';
import type { TranscriptSegment, Settings } from '../types';
import { buildSignature, getDateTime, randomStr, parseXfyunResult } from '../utils/xfyun';
import { xfyunProxyBase } from '../config/urls';

export type XfyunStatus = 'idle' | 'uploading' | 'transcribing' | 'done' | 'error';
const POLL_INTERVAL_MS = 3000;
const MAX_POLLS = 200;

// language 映射
function mapLanguage(lang: string): string {
  if (lang.startsWith('en')) return 'autominor';
  return 'autodialect';
}

export function useXfyunTranscription(settings: Settings) {
  const [status, setStatus] = useState<XfyunStatus>('idle');
  const [progress, setProgress] = useState(0);
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [estimateMs, setEstimateMs] = useState<number | null>(null);

  const stopRef = useRef(false);

  // ── 1. 上传音频，获取 orderId ──
  async function uploadAudio(file: File, language: string): Promise<string> {
    const dateTime = getDateTime();
    const signatureRandom = randomStr(16);

    const params: Record<string, string> = {
      appId: settings.xfAppId,
      accessKeyId: settings.xfAccessKeyId,
      dateTime,
      signatureRandom,
      fileSize: String(file.size),
      fileName: file.name,
      language: mapLanguage(language),
      durationCheckDisable: 'true',
      pd: 'edu',
    };

    const signature = await buildSignature(params, settings.xfAccessKeySecret);

    // 构造 URL query string（值需 URL 编码）
    const query = Object.entries(params)
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join('&');

    const resp = await fetch(`${xfyunProxyBase}/v2/upload?${query}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        signature,
      },
      body: file,
    });

    const data = await resp.json();
    if (data.code !== '000000') {
      throw new Error(`上传失败：${data.descInfo ?? data.code}`);
    }

    // 保存 signatureRandom 供轮询时复用
    sessionStorage.setItem('xf-sig-random', signatureRandom);
    return data.content.orderId as string;
  }

  // ── 2. 轮询查询结果 ──
  async function pollResult(orderId: string): Promise<string> {
    const signatureRandom = sessionStorage.getItem('xf-sig-random') ?? randomStr(16);

    for (let i = 0; i < MAX_POLLS; i++) {
      if (stopRef.current) throw new Error('已取消');

      await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
      if (stopRef.current) throw new Error('已取消');

      const dateTime = getDateTime();
      const params: Record<string, string> = {
        accessKeyId: settings.xfAccessKeyId,
        dateTime,
        signatureRandom,
        orderId,
        resultType: 'transfer',
      };

      const signature = await buildSignature(params, settings.xfAccessKeySecret);
      const query = Object.entries(params)
        .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
        .join('&');

      const resp = await fetch(`${xfyunProxyBase}/v2/getResult?${query}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          signature,
        },
        body: '{}',
      });

      const data = await resp.json();
      if (data.code !== '000000') {
        throw new Error(`查询失败：${data.descInfo ?? data.code}`);
      }

      const { orderInfo, orderResult, taskEstimateTime } = data.content;
      if (taskEstimateTime) setEstimateMs(taskEstimateTime);

      if (orderInfo.status === 4) {
        return orderResult as string;
      }
      if (orderInfo.status === -1) {
        throw new Error(`转写失败，failType=${orderInfo.failType}`);
      }

      // 根据预估时间动态计算进度
      const elapsed = (i + 1) * POLL_INTERVAL_MS;
      const estimate = taskEstimateTime ?? 30000;
      setProgress(Math.min(95, Math.round((elapsed / estimate) * 90) + 5));
    }

    throw new Error('转写超时，请稍后重试');
  }

  const transcribe = useCallback(async (file: File, language: string) => {
    if (!settings.xfAppId || !settings.xfAccessKeyId || !settings.xfAccessKeySecret) {
      setError('请先在设置中填写讯飞 AppID、AccessKeyID 和 AccessKeySecret');
      setStatus('error');
      return;
    }

    stopRef.current = false;
    setError(null);
    setSegments([]);
    setProgress(0);
    setEstimateMs(null);
    setFileName(file.name);
    setStatus('uploading');

    try {
      setProgress(10);
      const orderId = await uploadAudio(file, language);
      setProgress(20);
      setStatus('transcribing');

      const orderResult = await pollResult(orderId);
      setProgress(100);
      setSegments(parseXfyunResult(orderResult));
      setStatus('done');
    } catch (err: unknown) {
      if (stopRef.current) return;
      const msg = err instanceof Error ? err.message : '转写失败';
      setError(msg);
      setStatus('error');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings]);

  const reset = useCallback(() => {
    stopRef.current = true;
    setStatus('idle');
    setProgress(0);
    setSegments([]);
    setError(null);
    setFileName(null);
    setEstimateMs(null);
  }, []);

  return { status, progress, segments, error, fileName, estimateMs, transcribe, reset };
}
