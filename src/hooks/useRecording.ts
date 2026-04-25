import { useState, useRef, useCallback, useEffect } from 'react';
import type { TranscriptSegment } from '../types';

/** 浏览器 Web Speech API（Chrome / Edge 等，TS DOM lib 未含 SpeechRecognition 类型名） */
interface WebSpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onresult: ((this: WebSpeechRecognition, ev: SpeechRecognitionEvent) => void) | null;
  onerror: ((this: WebSpeechRecognition, ev: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

type WebSpeechRecognitionConstructor = new () => WebSpeechRecognition;

declare global {
  interface Window {
    SpeechRecognition: WebSpeechRecognitionConstructor;
    webkitSpeechRecognition: WebSpeechRecognitionConstructor;
  }
}

export function useRecording(language: string = 'zh-CN') {
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [duration, setDuration] = useState(0);
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [interimText, setInterimText] = useState('');
  const [error, setError] = useState<string | null>(null);

  const recognitionRef = useRef<WebSpeechRecognition | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);
  const pausedDurationRef = useRef<number>(0);

  const isSupported = typeof window !== 'undefined' &&
    ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window);

  const createRecognition = useCallback(() => {
    const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;
    const rec = new SpeechRecognitionAPI();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = language;
    rec.maxAlternatives = 1;
    return rec;
  }, [language]);

  const startTimer = useCallback(() => {
    startTimeRef.current = Date.now() - pausedDurationRef.current * 1000;
    timerRef.current = setInterval(() => {
      setDuration(Math.floor((Date.now() - startTimeRef.current) / 1000));
    }, 500);
  }, []);

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const start = useCallback(() => {
    if (!isSupported) {
      setError('浏览器不支持语音识别，请使用 Chrome 或 Edge');
      return;
    }
    setError(null);
    setSegments([]);
    setInterimText('');
    setDuration(0);
    pausedDurationRef.current = 0;

    const rec = createRecognition();

    rec.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          const text = result[0].transcript.trim();
          if (text) {
            setSegments(prev => [...prev, {
              id: `seg-${Date.now()}-${i}`,
              text,
              timestamp: Math.floor((Date.now() - startTimeRef.current) / 1000),
              isFinal: true,
            }]);
          }
        } else {
          interim += result[0].transcript;
        }
      }
      setInterimText(interim);
    };

    rec.onerror = (event) => {
      if (event.error === 'no-speech') return;
      if (event.error === 'aborted') return;
      setError(`识别错误: ${event.error}`);
    };

    rec.onend = () => {
      // Auto-restart if still recording
      if (recognitionRef.current === rec) {
        try { rec.start(); } catch { /* ignore */ }
      }
    };

    rec.start();
    recognitionRef.current = rec;
    setIsRecording(true);
    setIsPaused(false);
    startTimer();
  }, [isSupported, createRecognition, startTimer]);

  const stop = useCallback(() => {
    if (recognitionRef.current) {
      const rec = recognitionRef.current;
      recognitionRef.current = null;
      rec.onend = null;
      rec.stop();
    }
    stopTimer();
    pausedDurationRef.current = 0;
    setIsRecording(false);
    setIsPaused(false);
    setInterimText('');
  }, [stopTimer]);

  const pause = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
    }
    stopTimer();
    pausedDurationRef.current = duration;
    setIsPaused(true);
    setInterimText('');
  }, [stopTimer, duration]);

  const resume = useCallback(() => {
    if (!recognitionRef.current && isRecording) {
      const rec = createRecognition();
      recognitionRef.current = rec;

      rec.onresult = (event) => {
        let interim = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          if (result.isFinal) {
            const text = result[0].transcript.trim();
            if (text) {
              setSegments(prev => [...prev, {
                id: `seg-${Date.now()}-${i}`,
                text,
                timestamp: Math.floor((Date.now() - startTimeRef.current) / 1000),
                isFinal: true,
              }]);
            }
          } else {
            interim += result[0].transcript;
          }
        }
        setInterimText(interim);
      };

      rec.onerror = (event) => {
        if (event.error === 'no-speech') return;
        if (event.error === 'aborted') return;
        setError(`识别错误: ${event.error}`);
      };

      rec.onend = () => {
        if (recognitionRef.current === rec) {
          try { rec.start(); } catch { /* ignore */ }
        }
      };

      rec.start();
    }
    startTimer();
    setIsPaused(false);
  }, [isRecording, createRecognition, startTimer]);

  const clearTranscript = useCallback(() => {
    setSegments([]);
    setInterimText('');
  }, []);

  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        const rec = recognitionRef.current;
        recognitionRef.current = null;
        rec.onend = null;
        rec.stop();
      }
      stopTimer();
    };
  }, [stopTimer]);

  const fullTranscript = segments.map(s => s.text).join('。');

  return {
    isRecording,
    isPaused,
    duration,
    segments,
    interimText,
    error,
    isSupported,
    fullTranscript,
    start,
    stop,
    pause,
    resume,
    clearTranscript,
  };
}
