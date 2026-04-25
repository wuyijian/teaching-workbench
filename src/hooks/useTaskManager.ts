import { useState, useCallback, useEffect } from 'react';
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

const POLL_MS = 3000;

// ── Whisper ──────────────────────────────────────────────────────────────────
async function transcribeWhisper(
  file: File,
  settings: Settings,
  language: string,
  onProgress: (p: number) => void,
): Promise<TranscriptSegment[]> {
  if (!settings.apiKey) throw new Error('请先配置 Whisper API Key');
  const base = resolveApiBase(settings.apiBaseUrl);
  const form = new FormData();
  form.append('file', file);
  form.append('model', 'whisper-1');
  form.append('response_format', 'verbose_json');
  form.append('timestamp_granularities[]', 'segment');
  const lc = language.split('-')[0];
  if (lc) form.append('language', lc);

  onProgress(30);
  const resp = await fetch(`${base}/audio/transcriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${settings.apiKey}` },
    body: form,
  });
  onProgress(80);
  if (!resp.ok) throw new Error(`Whisper 错误 ${resp.status}: ${await resp.text()}`);
  const data = await resp.json();
  onProgress(100);

  if (data.segments?.length) {
    return data.segments.map((s: { text: string; start: number }, i: number) => ({
      id: `ws-${i}`, text: s.text.trim(), timestamp: Math.round(s.start), isFinal: true,
    })).filter((s: TranscriptSegment) => s.text);
  }
  if (data.text) return [{ id: 'ws-0', text: data.text.trim(), timestamp: 0, isFinal: true }];
  return [];
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

  // 2. 轮询
  onProgress(20);
  for (let i = 0; i < 200; i++) {
    if (shouldStop()) throw new Error('已取消');
    await new Promise(r => setTimeout(r, POLL_MS));
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
    if (taskEstimateTime) {
      const elapsed = (i + 1) * POLL_MS;
      onProgress(Math.min(95, Math.round((elapsed / taskEstimateTime) * 75) + 20));
    }
    if (orderInfo.status === 4) { onProgress(100); return parseXfyunResult(orderResult); }
    if (orderInfo.status === -1) throw new Error(`讯飞转写失败，failType=${orderInfo.failType}`);
  }
  throw new Error('转写超时，请稍后重试');
}

// ── Hook ─────────────────────────────────────────────────────────────────────
export function useTaskManager(settings: Settings, language: string) {
  const [tasks, setTasks] = useState<Task[]>(() => INITIAL_DATA.tasks);
  const [archivedStudents, setArchivedStudents] = useState<ArchivedStudentsState>(() => INITIAL_DATA.mergedArchived);
  const stopFlags = new Map<string, boolean>();

  // 每次 tasks 变化时持久化到 localStorage
  useEffect(() => {
    saveTasks(tasks);
  }, [tasks]);

  useEffect(() => {
    saveArchivedStudents(archivedStudents);
  }, [archivedStudents]);

  const patch = useCallback((id: string, changes: Partial<Task>) => {
    setTasks(prev => prev.map(t => t.id === id ? { ...t, ...changes } : t));
  }, []);

  const createTask = useCallback(async (
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
      status: 'uploading',
      progress: 0,
      segments: [],
      error: null,
      createdAt: Date.now(),
    };
    setTasks(prev => [newTask, ...prev]);
    stopFlags.set(id, false);

    const onProgress = (p: number) => patch(id, { progress: p });

    try {
      patch(id, { status: 'uploading', progress: 5 });
      let segments: TranscriptSegment[];

      if (engine === 'xfyun') {
        patch(id, { status: 'uploading' });
        segments = await transcribeXfyun(
          file, settings, language, onProgress,
          () => stopFlags.get(id) === true,
        );
      } else {
        patch(id, { status: 'transcribing' });
        segments = await transcribeWhisper(file, settings, language, onProgress);
      }

      patch(id, { status: 'done', progress: 100, segments, audioFile: undefined });
    } catch (err: unknown) {
      if (stopFlags.get(id)) return;
      patch(id, { status: 'error', error: err instanceof Error ? err.message : '转写失败' });
    } finally {
      stopFlags.delete(id);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings, language, patch]);

  const cancelTask = useCallback((id: string) => {
    stopFlags.set(id, true);
    patch(id, { status: 'error', error: '已取消' });
  }, [patch]);  // eslint-disable-line react-hooks/exhaustive-deps

  const deleteTask = useCallback((id: string) => {
    stopFlags.set(id, true);
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
