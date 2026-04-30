import { useState, useCallback, useEffect, useRef } from 'react';
import type { Task, Settings } from '../types';
import { getPlatformXfCredentials } from '../config/platformApi';
import type { TranscriptSegment } from '../types';
import { normalizeStudentKey } from '../utils/student';

/** 守门 / 配额回调，由调用方（App）从 SubscriptionContext 注入 */
export interface QuotaApi {
  /** 任务执行前调用：未登录或额度不足时返回 false（同时已弹 AuthModal/UpgradeModal） */
  requireTranscribe: (estimatedMinutes: number) => boolean;
  /** 任务完成后扣量 */
  recordUsage:       (durationMinutes: number) => void | Promise<void>;
}

/** 用 <audio> metadata 估算时长（秒） */
function estimateDurationSec(file: File): Promise<number> {
  return new Promise<number>(resolve => {
    try {
      const audio = document.createElement('audio');
      audio.preload = 'metadata';
      const url = URL.createObjectURL(file);
      const cleanup = () => { URL.revokeObjectURL(url); };
      audio.src = url;
      const timeout = setTimeout(() => { cleanup(); resolve(0); }, 8000);
      audio.addEventListener('loadedmetadata', () => {
        clearTimeout(timeout);
        const d = isFinite(audio.duration) ? audio.duration : 0;
        cleanup();
        resolve(d);
      });
      audio.addEventListener('error', () => {
        clearTimeout(timeout);
        cleanup();
        resolve(0);
      });
    } catch { resolve(0); }
  });
}

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

let INITIAL_DATA: ReturnType<typeof migrateTasksAndArchived>;
try {
  INITIAL_DATA = migrateTasksAndArchived(loadTasks());
} catch {
  // localStorage 数据损坏时安全降级：清除并从空状态启动
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* */ }
  INITIAL_DATA = { tasks: [], mergedArchived: {} };
}
import { buildSignature, getDateTime, randomStr, parseXfyunResult } from '../utils/xfyun';
import { xfyunProxyBase } from '../config/urls';

function uid() {
  return `task-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

/** 讯飞企业版（office-api-ist-dx）language：autodialect / autominor */
function mapLanguage(lang: string) {
  return lang.startsWith('en') ? 'autominor' : 'autodialect';
}

// ── 讯飞企业版「办公录音转写」office-api-ist-dx.iflyaisol.com/v2 ──────────────
//   鉴权：accessKeyId + dateTime + signatureRandom +
//        signature = HMAC-SHA1(参数排序串, accessKeySecret) → Base64，放 Header
async function transcribeXfyun(
  file: File,
  _settings: Settings,
  language: string,
  onProgress: (p: number) => void,
  shouldStop: () => boolean,
): Promise<TranscriptSegment[]> {
  const { xfAppId, xfAccessKeyId, xfAccessKeySecret } = getPlatformXfCredentials();
  if (!xfAppId || !xfAccessKeyId || !xfAccessKeySecret) {
    throw new Error('转写服务未在服务端配置，请联系管理员');
  }

  // ── 1. 上传 ──
  const dateTimeUp = getDateTime();
  const signatureRandom = randomStr(16);
  const uploadParams: Record<string, string> = {
    appId: xfAppId,
    accessKeyId: xfAccessKeyId,
    dateTime: dateTimeUp,
    signatureRandom,
    fileSize: String(file.size),
    fileName: file.name,
    language: mapLanguage(language),
    durationCheckDisable: 'true',
    pd: 'edu',
  };
  const signatureUp = await buildSignature(uploadParams, xfAccessKeySecret);
  const query = Object.entries(uploadParams)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');

  onProgress(10);
  const upResp = await fetch(`${xfyunProxyBase}/v2/upload?${query}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      signature: signatureUp,
    },
    body: file,
  });
  const upData = await upResp.json();
  if (upData.code !== '000000') throw new Error(`讯飞上传失败：${upData.descInfo ?? upData.code}`);
  const orderId = upData.content.orderId as string;

  // ── 2. 轮询（最长 3 小时，间隔自适应）──
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

    const dateTimePoll = getDateTime();
    const pollParams: Record<string, string> = {
      accessKeyId: xfAccessKeyId,
      dateTime: dateTimePoll,
      signatureRandom,
      orderId,
      resultType: 'transfer',
    };
    const signaturePoll = await buildSignature(pollParams, xfAccessKeySecret);
    const pq = Object.entries(pollParams)
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join('&');
    const pResp = await fetch(`${xfyunProxyBase}/v2/getResult?${pq}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        signature: signaturePoll,
      },
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
export function useTaskManager(settings: Settings, language: string, quotaApi?: QuotaApi) {
  const [tasks, setTasks] = useState<Task[]>(() => INITIAL_DATA.tasks);
  const [archivedStudents, setArchivedStudents] = useState<ArchivedStudentsState>(() => INITIAL_DATA.mergedArchived);

  // 队列相关 ref（不触发 re-render，避免竞态）
  const stopFlags        = useRef(new Map<string, boolean>());
  const queueRef         = useRef<string[]>([]);          // FIFO 待执行 ID 列表
  const runningRef       = useRef(false);                 // 当前是否有任务在执行
  const runningTaskIdRef = useRef<string | null>(null);   // 当前执行的任务 ID
  const pendingRef       = useRef(new Map<string, File>());

  // 让 drain 始终拿到最新 settings / language / quotaApi，避免闭包旧值
  const settingsRef = useRef(settings);
  const languageRef = useRef(language);
  const quotaApiRef = useRef(quotaApi);
  useEffect(() => { settingsRef.current = settings; }, [settings]);
  useEffect(() => { languageRef.current = language; }, [language]);
  useEffect(() => { quotaApiRef.current = quotaApi; }, [quotaApi]);

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
    const file = pendingRef.current.get(id)!;
    runningRef.current = true;
    runningTaskIdRef.current = id;

    const s = settingsRef.current;
    const l = languageRef.current;
    const onProgress = (p: number) => patch(id, { progress: p });
    const shouldStop  = () => stopFlags.current.get(id) === true;

    // ── 配额守门：估算时长，未登录 / 额度不足直接终止 ──────────────────────
    const qApi = quotaApiRef.current;
    const estSec = await estimateDurationSec(file);
    const estMin = Math.max(1, Math.ceil(estSec / 60));
    if (qApi && !qApi.requireTranscribe(estMin)) {
      patch(id, { status: 'error', error: '配额不足或未登录，请先登录或升级方案' });
      pendingRef.current.delete(id);
      stopFlags.current.delete(id);
      runningRef.current = false;
      drain();
      return;
    }

    patch(id, { status: 'uploading', progress: 5 });

    try {
      const segments = await transcribeXfyun(file, s, l, onProgress, shouldStop);
      if (!stopFlags.current.get(id)) {
        patch(id, { status: 'done', progress: 100, segments, audioFile: undefined });
        // 扣量：使用估算时长（来自音频元数据，已是真实总长）
        if (qApi) await qApi.recordUsage(estMin);
      }
    } catch (err: unknown) {
      if (!stopFlags.current.get(id)) {
        patch(id, { status: 'error', error: err instanceof Error ? err.message : '转写失败' });
      }
    } finally {
      pendingRef.current.delete(id);
      stopFlags.current.delete(id);
      // deleteTask 删除正在运行的任务时会提前重置 runningRef（runningTaskIdRef 同步清空）。
      // 此处只有仍是"当前任务"时才重置，防止 deleteTask 已触发 drain 后再次触发导致并发执行。
      if (runningTaskIdRef.current === id) {
        runningRef.current = false;
        runningTaskIdRef.current = null;
        drain(); // 处理下一个
      }
    }
  }, [patch]);

  const createTask = useCallback((
    studentName: string,
    topic: string,
    prompt: string,
    file: File,
  ) => {
    const id = uid();
    const newTask: Task = {
      id, studentName, topic, prompt, engine: 'xfyun',
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
    pendingRef.current.set(id, file);
    queueRef.current.push(id);
    drain();
  }, [drain]);

  const cancelTask = useCallback((id: string) => {
    stopFlags.current.set(id, true);
    patch(id, { status: 'error', error: '已取消' });
  }, [patch]);

  const deleteTask = useCallback((id: string) => {
    stopFlags.current.set(id, true);
    // 立即从内部队列和 pending 文件 map 里清除，保持内部状态与 tasks state 一致
    queueRef.current = queueRef.current.filter(qid => qid !== id);
    pendingRef.current.delete(id);
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
    // 关键修复：删除的是正在执行的任务时，立即重置运行状态
    // （不等轮询间隔过期才检测到 shouldStop，最长可能等 12 秒）
    // runningTaskIdRef 同步清空，防止该任务的 finally 块再次调用 drain 造成并发
    if (runningTaskIdRef.current === id) {
      runningRef.current = false;
      runningTaskIdRef.current = null;
    }
    // 现在无论原来是否有任务在跑，都能正确触发 drain
    if (!runningRef.current) drain();
  }, [drain]);

  /**
   * 新手引导专用：直接注入一条已完成的任务（跳过API转写，不扣配额）
   * 返回新任务 id，供引导流程自动选中。
   */
  const injectDoneTask = useCallback((
    studentName: string,
    topic: string,
    prompt: string,
    audioFileName: string,
    segments: Task['segments'],
  ): string => {
    const id = uid();
    const newTask: Task = {
      id, studentName, topic, prompt, engine: 'xfyun',
      audioFileName,
      status: 'done',
      progress: 100,
      segments,
      error: null,
      createdAt: Date.now(),
    };
    setTasks(prev => [newTask, ...prev]);
    return id;
  }, []);

  const retryTask = useCallback((task: Task) => {
    if (!task.audioFile) return;
    deleteTask(task.id);
    createTask(task.studentName, task.topic, task.prompt, task.audioFile);
  }, [deleteTask, createTask]);

  const saveAISummary = useCallback((id: string, summary: string) => {
    patch(id, { aiSummary: summary, aiSavedAt: Date.now() });
  }, [patch]);

  const saveNotes = useCallback((id: string, notes: string) => {
    patch(id, { notes });
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
    injectDoneTask,
    cancelTask,
    deleteTask,
    retryTask,
    saveAISummary,
    saveNotes,
    isStudentArchived,
    archiveStudent,
    unarchiveStudent,
  };
}
