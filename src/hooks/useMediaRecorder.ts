import { useState, useRef, useCallback, useEffect } from 'react';

export type RecordState = 'idle' | 'requesting' | 'recording' | 'paused' | 'done';

function buildFileName(mimeType: string): string {
  let ext = 'webm';
  if (mimeType.includes('ogg')) ext = 'ogg';
  // iOS Safari 只支持 audio/mp4，需要用 .m4a 扩展名让 XFYun 正确识别格式
  else if (mimeType.includes('mp4') || mimeType.includes('m4a')) ext = 'm4a';
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `录音_${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}.${ext}`;
}

function preferredMimeType(): string {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/ogg',
    // iOS Safari 14.3+ 只支持 mp4 容器
    'audio/mp4',
  ];
  return candidates.find(t => MediaRecorder.isTypeSupported(t)) ?? '';
}

export function useMediaRecorder() {
  const [state, setState] = useState<RecordState>('idle');
  const [duration, setDuration] = useState(0);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mrRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);
  const pausedDurRef = useRef<number>(0);

  const isSupported =
    typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;

  const stopTimer = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  }, []);

  const startTimer = useCallback(() => {
    startTimeRef.current = Date.now() - pausedDurRef.current * 1000;
    timerRef.current = setInterval(() => {
      setDuration(Math.floor((Date.now() - startTimeRef.current) / 1000));
    }, 200);
  }, []);

  const start = useCallback(async () => {
    if (!isSupported) { setError('当前浏览器不支持录音功能'); return; }
    setError(null);
    setAudioFile(null);
    setDuration(0);
    chunksRef.current = [];
    pausedDurRef.current = 0;
    setState('requesting');

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      const name = e instanceof Error ? (e as DOMException).name : '';
      const msg  = e instanceof Error ? e.message : String(e);
      if (name === 'NotAllowedError' || msg.toLowerCase().includes('ermission')) {
        setError('麦克风权限被拒绝。请在系统「隐私与安全性 → 麦克风」中允许本应用访问。');
      } else if (name === 'NotFoundError' || msg.toLowerCase().includes('not found')) {
        setError('未找到麦克风设备。请确认麦克风已连接，并在系统设置中已授权本应用。');
      } else if (name === 'NotReadableError') {
        setError('麦克风被其他程序占用，请关闭其他录音应用后重试。');
      } else {
        setError(`无法启动录音（${name || 'Error'}）：${msg}`);
      }
      setState('idle');
      return;
    }
    streamRef.current = stream;

    const mimeType = preferredMimeType();
    const mr = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    mrRef.current = mr;

    mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };

    mr.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: mr.mimeType || 'audio/webm' });
      const name = buildFileName(mr.mimeType || '');
      setAudioFile(new File([blob], name, { type: blob.type }));
      setState('done');
      stream.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    };

    mr.start(1000);
    setState('recording');
    startTimer();
  }, [isSupported, startTimer]);

  const stop = useCallback(() => {
    stopTimer();
    if (mrRef.current && mrRef.current.state !== 'inactive') {
      mrRef.current.stop(); // triggers onstop → sets audioFile + state 'done'
    }
  }, [stopTimer]);

  const pause = useCallback(() => {
    if (mrRef.current?.state === 'recording') {
      mrRef.current.pause();
      stopTimer();
      pausedDurRef.current = duration;
      setState('paused');
    }
  }, [stopTimer, duration]);

  const resume = useCallback(() => {
    if (mrRef.current?.state === 'paused') {
      mrRef.current.resume();
      startTimer();
      setState('recording');
    }
  }, [startTimer]);

  const reset = useCallback(() => {
    stopTimer();
    if (mrRef.current) {
      mrRef.current.onstop = null; // prevent file creation on forced stop
      if (mrRef.current.state !== 'inactive') {
        try { mrRef.current.stop(); } catch { /* ignore */ }
      }
      mrRef.current = null;
    }
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    chunksRef.current = [];
    pausedDurRef.current = 0;
    setAudioFile(null);
    setDuration(0);
    setState('idle');
    setError(null);
  }, [stopTimer]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopTimer();
      if (mrRef.current) {
        mrRef.current.onstop = null;
        if (mrRef.current.state !== 'inactive') {
          try { mrRef.current.stop(); } catch { /* ignore */ }
        }
      }
      streamRef.current?.getTracks().forEach(t => t.stop());
    };
  }, [stopTimer]);

  return { state, duration, audioFile, error, isSupported, start, stop, pause, resume, reset };
}
