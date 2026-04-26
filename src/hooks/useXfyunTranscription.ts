import { useState, useCallback, useRef } from 'react';
import type { TranscriptSegment } from '../types';
import { buildSignature, getDateTime, randomStr, parseXfyunResult } from '../utils/xfyun';
import { xfyunProxyBase } from '../config/urls';
import { getPlatformXfCredentials } from '../config/platformApi';

export type XfyunStatus = 'idle' | 'uploading' | 'transcribing' | 'done' | 'error';

// 最长等待 3 小时（讯飞支持最长 5 小时音频，转写速度通常快于实时）
const MAX_WAIT_MS = 3 * 60 * 60 * 1000;

/** 根据已等待时长返回下次轮询间隔，避免短时间内频繁请求 */
function nextPollInterval(elapsedMs: number): number {
  if (elapsedMs < 2 * 60_000) return 3_000;   // 前 2 分钟：3s
  if (elapsedMs < 10 * 60_000) return 6_000;  // 2-10 分钟：6s
  return 12_000;                              // 10 分钟以上：12s
}

/** 讯飞 language：autodialect 中文(含方言) / autominor 英文 */
function mapLanguage(lang: string): string {
  return lang.startsWith('en') ? 'autominor' : 'autodialect';
}

/** 获取音频文件时长（秒），用于商业化扣量 */
async function getAudioDurationSec(file: File): Promise<number> {
  return new Promise(resolve => {
    const audio = document.createElement('audio');
    const url = URL.createObjectURL(file);
    const cleanup = () => URL.revokeObjectURL(url);
    audio.addEventListener('loadedmetadata', () => { cleanup(); resolve(audio.duration); });
    audio.addEventListener('error',          () => { cleanup(); resolve(0); });
    audio.src = url;
  });
}

export function useXfyunTranscription() {
  const [status, setStatus] = useState<XfyunStatus>('idle');
  const [progress, setProgress] = useState(0);
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [estimateMs, setEstimateMs] = useState<number | null>(null);
  const [durationMinutes, setDurationMinutes] = useState<number>(0);

  const stopRef = useRef(false);

  // ── 1. 上传音频，获取 orderId ────────────────────────────────────────────
  async function uploadAudio(file: File, language: string): Promise<string> {
    const { xfAppId, xfAccessKeyId, xfAccessKeySecret } = getPlatformXfCredentials();
    const dateTime = getDateTime();
    const signatureRandom = randomStr(16);

    const params: Record<string, string> = {
      appId: xfAppId,
      accessKeyId: xfAccessKeyId,
      dateTime,
      signatureRandom,
      fileSize: String(file.size),
      fileName: file.name,
      language: mapLanguage(language),
      durationCheckDisable: 'true',
      pd: 'edu',
    };

    const signature = await buildSignature(params, xfAccessKeySecret);

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
      throw new Error(`上传失败：${data.descInfo ?? data.code}（HTTP ${resp.status}）`);
    }

    sessionStorage.setItem('xf-sig-random', signatureRandom);
    return data.content.orderId as string;
  }

  // ── 2. 轮询查询结果 ──────────────────────────────────────────────────────
  async function pollResult(orderId: string): Promise<string> {
    const startTime = Date.now();
    let estimateMsLocal: number | null = null;
    const signatureRandom = sessionStorage.getItem('xf-sig-random') ?? randomStr(16);

    while (true) {
      if (stopRef.current) throw new Error('已取消');

      const elapsed = Date.now() - startTime;
      if (elapsed >= MAX_WAIT_MS) {
        throw new Error(`转写超时（已等待 ${Math.round(elapsed / 60000)} 分钟），请检查讯飞控制台或稍后重试`);
      }

      await new Promise(r => setTimeout(r, nextPollInterval(elapsed)));
      if (stopRef.current) throw new Error('已取消');

      const { xfAccessKeyId, xfAccessKeySecret } = getPlatformXfCredentials();
      const dateTime = getDateTime();

      const params: Record<string, string> = {
        accessKeyId: xfAccessKeyId,
        dateTime,
        signatureRandom,
        orderId,
        resultType: 'transfer',
      };

      const signature = await buildSignature(params, xfAccessKeySecret);
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
      if (taskEstimateTime && taskEstimateTime !== estimateMsLocal) {
        estimateMsLocal = taskEstimateTime;
        setEstimateMs(taskEstimateTime);
      }

      // 讯飞订单状态：4 = 完成；-1 = 失败；其它 = 处理中
      if (orderInfo.status === 4) return orderResult as string;
      if (orderInfo.status === -1) {
        throw new Error(`转写失败（failType=${orderInfo.failType}），请检查音频格式或联系讯飞支持`);
      }

      const elapsedNow = Date.now() - startTime;
      const estimate = estimateMsLocal ?? 60_000;
      setProgress(Math.min(95, Math.round((elapsedNow / estimate) * 90) + 5));
    }
  }

  const transcribe = useCallback(async (
    file: File,
    language: string,
    onComplete?: (durationMinutes: number) => void,
  ) => {
    const { xfAppId, xfAccessKeyId, xfAccessKeySecret } = getPlatformXfCredentials();
    if (!xfAppId || !xfAccessKeyId || !xfAccessKeySecret) {
      setError('平台转写服务未配置，请联系管理员');
      setStatus('error');
      return;
    }

    stopRef.current = false;
    setError(null);
    setSegments([]);
    setProgress(0);
    setEstimateMs(null);
    setDurationMinutes(0);
    setFileName(file.name);
    setStatus('uploading');

    const durationSec = await getAudioDurationSec(file);
    const durMins = durationSec / 60;
    setDurationMinutes(durMins);

    try {
      setProgress(10);
      const orderId = await uploadAudio(file, language);
      setProgress(20);
      setStatus('transcribing');

      const orderResult = await pollResult(orderId);
      setProgress(100);
      setSegments(parseXfyunResult(orderResult));
      setStatus('done');

      onComplete?.(durMins);
    } catch (err: unknown) {
      if (stopRef.current) return;
      const msg = err instanceof Error ? err.message : '转写失败';
      setError(msg);
      setStatus('error');
    }
  }, []);

  const reset = useCallback(() => {
    stopRef.current = true;
    setStatus('idle');
    setProgress(0);
    setSegments([]);
    setError(null);
    setFileName(null);
    setEstimateMs(null);
    setDurationMinutes(0);
  }, []);

  return { status, progress, segments, error, fileName, estimateMs, durationMinutes, transcribe, reset };
}
