import { useState, useCallback, useEffect, useRef } from 'react';
import type { Task, TranscribeEngine, Settings } from '../types';
import type { TranscriptSegment } from '../types';
import { normalizeStudentKey } from '../utils/student';

const STORAGE_KEY = 'tw-tasks';
const ARCHIVED_STUDENTS_KEY = 'tw-archived-students';

/** studentKey -> 该同学被移入归档区的时间戳 */
export type ArchivedStudentsState = Record<string, number>;

type SerializedTask = Omit<Task, 'audioFile'>;

/** 旧版逐任务归档字段（迁移用） */
type LegacyTaskFields = { archived?: boolean; archivedAt?: number };

function saveTasks(tasks: Task[]) {
  try {
    const serializable: SerializedTask[] = tasks.map(({ audioFile: _f, ...rest }) => ({
      ...rest,
      // 进行中的任务页面关闭后无法恢复，重置为错误状态
      status: (rest.status === 'uploading' || rest.status === 'transcribing')
        ? 'error'
        : rest.status,
      error: (rest.status === 'uploading' || rest.status === 'transcribing')
        ? '页面刷新后转写中断，请重新上传'
        : rest.error,
    }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(serializable));
  } catch { /* quota exceeded 等异常静默忽略 */ }
}

function loadTasks(): Task[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as Task[];
  } catch {
    return [];
  }
}

function loadArchivedStudents(): ArchivedStudentsState {
  try {
    const raw = localStorage.getItem(ARCHIVED_STUDENTS_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as ArchivedStudentsState;
  } catch {
    return {};
  }
}

function saveArchivedStudents(state: ArchivedStudentsState) {
  try {
    localStorage.setItem(ARCHIVED_STUDENTS_KEY, JSON.stringify(state));
  } catch { /* */ }
}

/** 去掉旧版 per-task archived，并把已归档任务合并进「已归档同学」集合 */
function migrateTasksAndArchived(rawTasks: Task[]): { tasks: Task[]; mergedArchived: ArchivedStudentsState } {
  const merged: ArchivedStudentsState = { ...loadArchivedStudents() };
  const tasks: Task[] = rawTasks.map(t => {
    const ext = t as Task & LegacyTaskFields;
    if (ext.archived) {
      const k = normalizeStudentKey(t.studentName);
      if (k && merged[k] === undefined) merged[k] = ext.archivedAt ?? Date.now();
    }
    const { archived: _a, archivedAt: _at, ...rest } = ext;
    return rest as Task;
  });
  return { tasks, mergedArchived: merged };
}

const INITIAL_DATA = migrateTasksAndArchived(loadTasks());
import { buildSignature, getDateTime, randomStr, parseXfyunResult } from '../utils/xfyun';
import { xfyunProxyBase, resolveApiBase } from '../config/urls';

function uid() {
  return `task-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function mapLanguage(lang: string) {
  return lang.startsWith('en') ? 'autominor' : 'autodialect';
}

// ── Whisper 音频切片工具 ──────────────────────────────────────────────────────
const WHISPER_MAX_BYTES = 24 * 1024 * 1024; // 24MB，低于 API 25MB 限制
const CHUNK_SECONDS = 10 * 60;              // 每片 10 分钟
const TARGET_SR = 16_000;                   // 降采样目标：16kHz 单声道

function toMono16k(buf: AudioBuffer, startSec: number, endSec: number): Float32Array {
  const sr = buf.sampleRate;
  const s0 = Math.round(startSec * sr);
  const s1 = Math.min(Math.round(endSec * sr), buf.length);
  const len = s1 - s0;
  const mono = new Float32Array(len);
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) mono[i] += d[s0 + i] / buf.numberOfChannels;
  }
  if (sr === TARGET_SR) return mono;
  const ratio = sr / TARGET_SR;
  const out = new Float32Array(Math.round(len / ratio));
  for (let i = 0; i < out.length; i++) {
    const pos = i * ratio;
    const idx = Math.floor(pos);
    const frac = pos - idx;
    out[i] = idx + 1 < mono.length ? mono[idx] * (1 - frac) + mono[idx + 1] * frac : mono[idx];
  }
  return out;
}

function encodeWAV(samples: Float32Array, sampleRate: number): Blob {
  const nb = samples.length * 2;
  const buf = new ArrayBuffer(44 + nb);
  const v = new DataView(buf);
  const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + nb, true);
  w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, 'data'); v.setUint32(40, nb, true);
  let off = 44;
  for (let i = 0; i < samples.length; i++, off += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}

async function callWhisperAPI(
  blob: Blob, name: string, settings: Settings, language: string,
): Promise<{ text?: string; segments?: { text: string; start: number }[] }> {
  const base = resolveApiBase(settings.apiBaseUrl);
  const form = new FormData();
  form.append('file', new File([blob], name, { type: 'audio/wav' }));
  form.append('model', 'whisper-1');
  form.append('response_format', 'verbose_json');
  form.append('timestamp_granularities[]', 'segment');
  const lc = language.split('-')[0];
  if (lc) form.append('language', lc);
  const resp = await fetch(`${base}/audio/transcriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${settings.apiKey}` },
    body: form,
  });
  if (!resp.ok) throw new Error(`Whisper 错误 ${resp.status}: ${await resp.text()}`);
  return resp.json();
}

function parseWhisperResult(
  data: { text?: string; segments?: { text: string; start: number }[] },
  offsetSec: number,
  idOffset: number,
): TranscriptSegment[] {
  if (data.segments?.length) {
    return data.segments
      .map((s, i) => ({ id: `ws-${idOffset + i}`, text: s.text.trim(), timestamp: Math.round(s.start + offsetSec), isFinal: true }))
      .filter(s => s.text);
  }
  if (data.text?.trim()) return [{ id: `ws-${idOffset}`, text: data.text.trim(), timestamp: Math.round(offsetSec), isFinal: true }];
  return [];
}

// ── Whisper 转写（自动切片支持长音频）────────────────────────────────────────
async function transcribeWhisper(
  file: File,
  settings: Settings,
  language: string,
  onProgress: (p: number) => void,
  shouldStop: () => boolean,
): Promise<TranscriptSegment[]> {
  if (!settings.apiKey) throw new Error('请先配置 Whisper API Key');

  // 文件 ≤24MB：直接发送
  if (file.size <= WHISPER_MAX_BYTES) {
    onProgress(20);
    const data = await callWhisperAPI(file, file.name, settings, language);
    onProgress(90);
    return parseWhisperResult(data, 0, 0);
  }

  // 文件 >24MB：解码 → 切片 → 逐片转写 → 合并
  onProgress(5);
  const arrayBuf = await file.arrayBuffer();
  if (shouldStop()) throw new Error('已取消');
  const ctx = new OfflineAudioContext(1, 1, TARGET_SR);
  const audioBuf = await ctx.decodeAudioData(arrayBuf);
  if (shouldStop()) throw new Error('已取消');

  const totalSec = audioBuf.duration;
  const numChunks = Math.ceil(totalSec / CHUNK_SECONDS);
  const baseName = file.name.replace(/\.[^.]+$/, '');
  const segments: TranscriptSegment[] = [];
  let idOffset = 0;

  for (let i = 0; i < numChunks; i++) {
    if (shouldStop()) throw new Error('已取消');
    const startSec = i * CHUNK_SECONDS;
    const endSec = Math.min((i + 1) * CHUNK_SECONDS, totalSec);
    const pcm = toMono16k(audioBuf, startSec, endSec);
    const wav = encodeWAV(pcm, TARGET_SR);
    const chunkSegs = parseWhisperResult(
      await callWhisperAPI(wav, `${baseName}_part${i + 1}.wav`, settings, language),
      startSec, idOffset,
    );
    segments.push(...chunkSegs);
    idOffset += chunkSegs.length;
    onProgress(Math.round(10 + ((i + 1) / numChunks) * 85));
  }
  return segments;
}

// ── iFlytek ──────────────────────────────────────────────────────────────────
async function transcribeXfyun(
  file: File,
  settings: Settings,
  language: string,
  onProgress: (p: number) => void,
  shouldStop: () => boolean,
): Promise<TranscriptSegment[]> {
  if (!settings.xfAppId || !settings.xfAccessKeyId || !settings.xfAccessKeySecret) {
    throw new Error('请先配置讯飞 AppID / AccessKeyID / AccessKeySecret');
  }

  // 1. 上传
  const signatureRandom = randomStr(16);
  const uploadParams: Record<string, string> = {
    appId: settings.xfAppId,
    accessKeyId: settings.xfAccessKeyId,
    dateTime: getDateTime(),
    signatureRandom,
    fileSize: String(file.size),
    fileName: file.name,
    language: mapLanguage(language),
    durationCheckDisable: 'true',
    pd: 'edu',
  };
  const uploadSig = await buildSignature(uploadParams, settings.xfAccessKeySecret);
  const query = Object.entries(uploadParams).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');

  onProgress(10);
  const upResp = await fetch(`${xfyunProxyBase}/v2/upload?${query}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream', signature: uploadSig },
    body: file,
  });
  const upData = await upResp.json();
  if (upData.code !== '000000') throw new Error(`讯飞上传失败：${upData.descInfo ?? upData.code}`);
  const orderId = upData.content.orderId as string;

  // 2. 轮询（最长等待 3 小时，间隔自适应）
  onProgress(20);
  const pollStart = Date.now();
  const MAX_WAIT_MS = 3 * 60 * 60 * 1000;
  let estimateMs: number | null = null;

  while (true) {
    if (shouldStop()) throw new Error('已取消');
    const elapsed = Date.now() - pollStart;
    if (elapsed >= MAX_WAIT_MS) throw new Error(`转写超时（已等待 ${Math.round(elapsed / 60000)} 分钟），请在讯飞控制台检查任务状态`);

    const interval = elapsed < 2 * 60_000 ? 3_000 : elapsed < 10 * 60_000 ? 6_000 : 12_000;
    await new Promise(r => setTimeout(r, interval));
    if (shouldStop()) throw new Error('已取消');

    const pollParams: Record<string, string> = {
      accessKeyId: settings.xfAccessKeyId,
      dateTime: getDateTime(),
      signatureRandom,
      orderId,
      resultType: 'transfer',
    };
    const pollSig = await buildSignature(pollParams, settings.xfAccessKeySecret);
    const pq = Object.entries(pollParams).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
    const pResp = await fetch(`${xfyunProxyBase}/v2/getResult?${pq}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', signature: pollSig },
      body: '{}',
    });
    const pData = await pResp.json();
    if (pData.code !== '000000') throw new Error(`讯飞查询失败：${pData.descInfo ?? pData.code}`);
    const { orderInfo, orderResult, taskEstimateTime } = pData.content;
    if (taskEstimateTime) estimateMs = taskEstimateTime;
    const elapsedNow = Date.now() - pollStart;
    const est = estimateMs ?? 60_000;
    onProgress(Math.min(95, Math.round((elapsedNow / est) * 75) + 20));
    if (orderInfo.status === 4) { onProgress(100); return parseXfyunResult(orderResult); }
    if (orderInfo.status === -1) throw new Error(`讯飞转写失败（failType=${orderInfo.failType}），请检查音频格式`);
  }
}

// ── Hook ─────────────────────────────────────────────────────────────────────
export function useTaskManager(settings: Settings, language: string) {
  const [tasks, setTasks] = useState<Task[]>(() => INITIAL_DATA.tasks);
  const [archivedStudents, setArchivedStudents] = useState<ArchivedStudentsState>(() => INITIAL_DATA.mergedArchived);

  // 队列相关 ref（不触发 re-render，避免竞态）
  const stopFlags  = useRef(new Map<string, boolean>());
  const queueRef   = useRef<string[]>([]);          // FIFO 待执行 ID 列表
  const runningRef = useRef(false);                 // 当前是否有任务在执行
  const pendingRef = useRef(new Map<string, { engine: TranscribeEngine; file: File }>());

  // 让 drain 始终拿到最新 settings / language，避免闭包旧值
  const settingsRef = useRef(settings);
  const languageRef = useRef(language);
  useEffect(() => { settingsRef.current = settings; }, [settings]);
  useEffect(() => { languageRef.current = language; }, [language]);

  useEffect(() => { saveTasks(tasks); }, [tasks]);
  useEffect(() => { saveArchivedStudents(archivedStudents); }, [archivedStudents]);

  const patch = useCallback((id: string, changes: Partial<Task>) => {
    setTasks(prev => prev.map(t => t.id === id ? { ...t, ...changes } : t));
  }, []);

  /** 从队列头取下一个任务并执行；执行完后递归调用自身处理下一个 */
  const drain = useCallback(async () => {
    if (runningRef.current) return;

    // 跳过已被取消的任务
    while (queueRef.current.length > 0) {
      const head = queueRef.current[0];
      if (stopFlags.current.get(head) !== true && pendingRef.current.has(head)) break;
      queueRef.current.shift();
    }
    if (!queueRef.current.length) return;

    const id = queueRef.current.shift()!;
    const { engine, file } = pendingRef.current.get(id)!;
    runningRef.current = true;

    const s = settingsRef.current;
    const l = languageRef.current;
    const onProgress = (p: number) => patch(id, { progress: p });
    const shouldStop  = () => stopFlags.current.get(id) === true;

    patch(id, { status: engine === 'xfyun' ? 'uploading' : 'transcribing', progress: 5 });

    try {
      const segments = engine === 'xfyun'
        ? await transcribeXfyun(file, s, l, onProgress, shouldStop)
        : await transcribeWhisper(file, s, l, onProgress, shouldStop);
      if (!stopFlags.current.get(id)) {
        patch(id, { status: 'done', progress: 100, segments, audioFile: undefined });
      }
    } catch (err: unknown) {
      if (!stopFlags.current.get(id)) {
        patch(id, { status: 'error', error: err instanceof Error ? err.message : '转写失败' });
      }
    } finally {
      pendingRef.current.delete(id);
      stopFlags.current.delete(id);
      runningRef.current = false;
      drain(); // 处理下一个
    }
  }, [patch]);

  const createTask = useCallback((
    studentName: string,
    topic: string,
    prompt: string,
    engine: TranscribeEngine,
    file: File,
  ) => {
    const id = uid();
    const newTask: Task = {
      id, studentName, topic, prompt, engine,
      audioFileName: file.name,
      audioFile: file,
      status: 'queued',
      progress: 0,
      segments: [],
      error: null,
      createdAt: Date.now(),
    };
    setTasks(prev => [newTask, ...prev]);
    stopFlags.current.set(id, false);
    pendingRef.current.set(id, { engine, file });
    queueRef.current.push(id);
    drain();
  }, [drain]);

  const cancelTask = useCallback((id: string) => {
    stopFlags.current.set(id, true);
    patch(id, { status: 'error', error: '已取消' });
  }, [patch]);

  const deleteTask = useCallback((id: string) => {
    stopFlags.current.set(id, true);
    setTasks(prev => {
      const removed = prev.find(t => t.id === id);
      const next = prev.filter(t => t.id !== id);
      if (removed) {
        const k = normalizeStudentKey(removed.studentName);
        if (k && !next.some(t => normalizeStudentKey(t.studentName) === k)) {
          setArchivedStudents(ars => {
            if (ars[k] === undefined) return ars;
            const { [k]: _, ...rest } = ars;
            return rest;
          });
        }
      }
      return next;
    });
  }, []);

  const retryTask = useCallback((task: Task) => {
    if (!task.audioFile) return;
    deleteTask(task.id);
    createTask(task.studentName, task.topic, task.prompt, task.engine, task.audioFile);
  }, [deleteTask, createTask]);

  const saveAISummary = useCallback((id: string, summary: string) => {
    patch(id, { aiSummary: summary, aiSavedAt: Date.now() });
  }, [patch]);

  const isStudentArchived = useCallback((studentName: string) => {
    const k = normalizeStudentKey(studentName);
    return k !== '' && archivedStudents[k] !== undefined;
  }, [archivedStudents]);

  const archiveStudent = useCallback((studentName: string) => {
    const k = normalizeStudentKey(studentName);
    if (!k) return;
    setArchivedStudents(prev => (prev[k] !== undefined ? prev : { ...prev, [k]: Date.now() }));
  }, []);

  const unarchiveStudent = useCallback((studentName: string) => {
    const k = normalizeStudentKey(studentName);
    if (!k) return;
    setArchivedStudents(prev => {
      if (prev[k] === undefined) return prev;
      const { [k]: _, ...rest } = prev;
      return rest;
    });
  }, []);

  return {
    tasks,
    archivedStudents,
    createTask,
    cancelTask,
    deleteTask,
    retryTask,
    saveAISummary,
    isStudentArchived,
    archiveStudent,
    unarchiveStudent,
  };
}
