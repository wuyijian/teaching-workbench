import { useState, useCallback, useEffect, useRef } from 'react';
import type { Task, Settings } from '../types';
import { getPlatformXfCredentials } from '../config/platformApi';
import type { TranscriptSegment } from '../types';
import { normalizeStudentKey, formatStudentNames } from '../utils/student';

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

/**
 * 修正从持久化存储（localStorage 或 Supabase）读取时可能残留的中间状态。
 * 以 segments 为事实依据：有内容 → done；无内容 → error（无法恢复上传）。
 */
function sanitizeHydratedTask(task: Task): Task {
  const stuck = task.status === 'uploading' || task.status === 'transcribing' || task.status === 'queued';
  if (!stuck) return task;
  if (task.segments && task.segments.length > 0) {
    return { ...task, status: 'done', progress: 100, error: null };
  }
  return { ...task, status: 'error', error: task.error ?? '页面刷新后转写中断，请重新上传' };
}

function saveTasks(tasks: Task[]) {
  try {
    const serializable: SerializedTask[] = tasks.map(({ audioFile: _f, ...rest }) => {
      const { examFileDataUrl: _d, ...withoutExamDataUrl } = rest;
      // 进行中（含排队中）的任务页面关闭后无法恢复，重置为错误状态
      const stuckInProgress =
        withoutExamDataUrl.status === 'uploading' ||
        withoutExamDataUrl.status === 'transcribing' ||
        withoutExamDataUrl.status === 'queued';
      return {
        ...withoutExamDataUrl,
        status: stuckInProgress ? 'error' : withoutExamDataUrl.status,
        error: stuckInProgress
          ? '页面刷新后转写中断，请重新上传'
          : withoutExamDataUrl.error,
        // Kimi 上传中途页面关闭 → 重置为 error，提示用户重新上传
        examKimiUploadStatus: withoutExamDataUrl.examKimiUploadStatus === 'uploading' ? 'error' : withoutExamDataUrl.examKimiUploadStatus,
      };
    });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(serializable));
  } catch { /* quota exceeded 等异常静默忽略 */ }
}

function loadTasks(): Task[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Task[];
    // 二次校验：saveTasks 已做转换，但防止旧版本写入的脏数据残留
    return parsed.map(sanitizeHydratedTask);
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
import { notifyParent } from '../utils/wechat';
import { buildSignature, getDateTime, randomStr, parseXfyunResult } from '../utils/xfyun';
import {
  buildVolcanoHeaders, buildVolcanoBody, fileToBase64,
  parseVolcanoAsyncResult,
  isVolcanoSuccess, isVolcanoSilent, isVolcanoPending,
} from '../utils/volcano';
import { xfyunProxyBase, volcanoProxyBase } from '../config/urls';
import { getPlatformVolcanoCredentials, getPlatformLlmApiKey, getPlatformLlmBaseUrl } from '../config/platformApi';
import { withRetry, isTransient } from '../utils/retry';
import { uploadFileToKimi, deleteKimiFile } from '../utils/kimiFile';
import { useAuth } from '../context/AuthContext';
import {
  upsertTask,
  syncLocalTasksToCloud,
  fetchUserTasks,
  deleteTaskFromCloud,
  updateTaskSummary,
} from '../lib/taskStorage';

function uid() {
  return `task-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

/** 讯飞企业版（office-api-ist-dx）language：autodialect / autominor */
function mapLanguage(lang: string) {
  return lang.startsWith('en') ? 'en_us' : 'zh_cn';
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

  // 文件大小基础校验：XFYun 要求 >= 600 字节
  if (file.size < 600) {
    throw new Error(`文件太小（${file.size} 字节），请上传有效的音频文件`);
  }

  onProgress(10);

  // ── 1. 上传（网络抖动 / 5xx 时最多重试 3 次）──
  const upData = await withRetry(
    async () => {
      const upResp = await fetch(`${xfyunProxyBase}/v2/upload?${query}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          signature: signatureUp,
        },
        body: file,
      });
      // Nginx 的 413/408/502 等错误页是 HTML，不能直接 .json()
      if (!upResp.ok) {
        const msg = upResp.status === 413 ? '：文件超过服务器限制（500MB）'
          : upResp.status === 408 ? '：上传超时，请在 WiFi 环境下重试'
          : '';
        throw new Error(`上传请求失败（HTTP ${upResp.status}）${msg}`);
      }
      const data = await upResp.json() as { code: string; descInfo?: string; content: { orderId: string } };
      if (data.code !== '000000') throw new Error(`讯飞上传失败：${data.descInfo ?? data.code}`);
      return data;
    },
    {
      maxAttempts: 3,
      baseDelayMs: 2000,
      shouldRetry: (err) => {
        if (shouldStop()) return false;
        // 业务层报错（讯飞 code 非 000000）不重试；网络 / 5xx 重试
        if (err.message.startsWith('讯飞上传失败')) return false;
        return isTransient(err);
      },
      onRetry: (err, n, delay) =>
        console.warn(`[xfyun] 上传第 ${n} 次重试（${delay}ms）:`, err.message),
    },
  );
  const orderId = upData.content.orderId;

  // ── 2. 轮询（最长 3 小时，间隔自适应；单次 fetch 网络失败最多容忍 3 次）──
  onProgress(20);
  const pollStart = Date.now();
  const MAX_WAIT_MS = 3 * 60 * 60 * 1000;
  let estimateMs: number | null = null;
  let pollFailCount = 0;
  const MAX_POLL_FAIL = 3;

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

    let pData: { code: string; descInfo?: string; content: { orderInfo: { status: number; failType?: number }; orderResult: unknown; taskEstimateTime?: number } };
    try {
      const pResp = await fetch(`${xfyunProxyBase}/v2/getResult?${pq}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', signature: signaturePoll },
        body: '{}',
      });
      if (!pResp.ok) throw new Error(`讯飞轮询 HTTP ${pResp.status}`);
      pData = await pResp.json() as typeof pData;
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      if (isTransient(e) && ++pollFailCount <= MAX_POLL_FAIL) {
        console.warn(`[xfyun] 轮询第 ${pollFailCount} 次失败，继续等待:`, e.message);
        continue; // 下一次循环自然重试
      }
      throw e;
    }
    pollFailCount = 0; // 成功后重置

    if (pData.code !== '000000') throw new Error(`讯飞查询失败：${pData.descInfo ?? pData.code}`);
    const { orderInfo, orderResult, taskEstimateTime } = pData.content;
    if (taskEstimateTime) estimateMs = taskEstimateTime;
    const elapsedNow = Date.now() - pollStart;
    const est = estimateMs ?? 60_000;
    onProgress(Math.min(95, Math.round((elapsedNow / est) * 75) + 20));
    if (orderInfo.status === 4) { onProgress(100); return parseXfyunResult(orderResult as string); }
    if (orderInfo.status === -1) throw new Error(`讯飞转写失败（failType=${orderInfo.failType}），请检查音频格式`);
  }
}

// ── 火山引擎「豆包大模型 - 录音文件识别（标准版）」 ──────────────────────────
//   资源 ID：volc.bigasr.auc
//   流程：submit + poll，支持 ≤100MB / ≤2h 音频
async function transcribeVolcano(
  file: File,
  language: string,
  onProgress: (p: number) => void,
  shouldStop: () => boolean,
): Promise<TranscriptSegment[]> {
  const creds = getPlatformVolcanoCredentials();
  if (!creds.apiKey && !(creds.appId && creds.accessKey)) {
    throw new Error('火山引擎转写服务未在服务端配置，请联系管理员');
  }
  if (file.size < 600) {
    throw new Error(`文件太小（${file.size} 字节），请上传有效的音频文件`);
  }

  const uid = creds.apiKey || creds.appId || 'tw-user';

  // ── 1. 上传音频 → base64 ──
  onProgress(10);
  const base64 = await fileToBase64(file);
  if (shouldStop()) throw new Error('已取消');

  // ── 2. submit ──
  onProgress(20);
  const taskId = crypto.randomUUID();
  const submitHeaders = buildVolcanoHeaders(creds, taskId);
  const submitBody = buildVolcanoBody({ data: base64 }, uid, language, false);

  await withRetry(
    async () => {
      const resp = await fetch(`${volcanoProxyBase}/api/v3/auc/bigmodel/submit`, {
        method: 'POST',
        headers: submitHeaders,
        body: JSON.stringify(submitBody),
      });
      if (!resp.ok) throw new Error(`火山提交 HTTP ${resp.status}`);
      const code = resp.headers.get('X-Api-Status-Code') ?? '';
      if (!isVolcanoSuccess(code) && !isVolcanoPending(code)) {
        throw new Error(`火山提交失败（${code}）：${resp.headers.get('X-Api-Message') ?? ''}`);
      }
    },
    {
      maxAttempts: 3,
      baseDelayMs: 2000,
      shouldRetry: (err) => {
        if (shouldStop()) return false;
        if (err.message.startsWith('火山提交失败')) return false;
        return isTransient(err);
      },
      onRetry: (err, n, delay) => console.warn(`[volcano] submit 第${n}次重试(${delay}ms):`, err.message),
    },
  );

  // ── 3. 轮询 ──
  const pollStart = Date.now();
  const MAX_WAIT_MS = 3 * 60 * 60 * 1000;
  let pollFails = 0;
  const MAX_POLL_FAIL = 3;

  while (true) {
    if (shouldStop()) throw new Error('已取消');
    const elapsed = Date.now() - pollStart;
    if (elapsed >= MAX_WAIT_MS) throw new Error(`火山转写超时（已等待 ${Math.round(elapsed / 60000)} 分钟）`);

    const interval = elapsed < 2 * 60_000 ? 3_000 : elapsed < 10 * 60_000 ? 6_000 : 12_000;
    await new Promise(r => setTimeout(r, interval));
    if (shouldStop()) throw new Error('已取消');

    const queryHeaders = buildVolcanoHeaders(creds, taskId);
    try {
      // 火山 query 接口约定：body 必须是空对象 {}，taskId 通过 X-Api-Request-Id header 传递
      const qResp = await fetch(`${volcanoProxyBase}/api/v3/auc/bigmodel/query`, {
        method: 'POST',
        headers: queryHeaders,
        body: '{}',
      });
      if (!qResp.ok) throw new Error(`火山查询 HTTP ${qResp.status}`);
      const code = qResp.headers.get('X-Api-Status-Code') ?? '';

      if (isVolcanoPending(code)) {
        const pct = Math.min(95, Math.round((elapsed / (5 * 60_000)) * 75) + 20);
        onProgress(pct);
        pollFails = 0;
        continue;
      }
      if (isVolcanoSilent(code)) { onProgress(100); return []; }
      if (!isVolcanoSuccess(code)) {
        throw new Error(`火山查询失败（${code}）：${qResp.headers.get('X-Api-Message') ?? ''}`);
      }

      const qData = await qResp.json() as Parameters<typeof parseVolcanoAsyncResult>[0];
      onProgress(100);
      return parseVolcanoAsyncResult(qData);

    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      if (isTransient(e) && ++pollFails <= MAX_POLL_FAIL) {
        console.warn(`[volcano] 轮询第${pollFails}次失败，继续:`, e.message);
        continue;
      }
      throw e;
    }
  }
}

const MAX_CONCURRENT = 5;

// ── Hook ─────────────────────────────────────────────────────────────────────
export function useTaskManager(settings: Settings, language: string, quotaApi?: QuotaApi) {
  const { user } = useAuth();
  const [tasks, setTasks] = useState<Task[]>(() => INITIAL_DATA.tasks);
  const [archivedStudents, setArchivedStudents] = useState<ArchivedStudentsState>(() => INITIAL_DATA.mergedArchived);

  // 队列相关 ref（不触发 re-render，避免竞态）
  const stopFlags           = useRef(new Map<string, boolean>());
  const queueRef            = useRef<string[]>([]);                  // FIFO 待执行 ID 列表
  const runningCountRef     = useRef(0);                             // 当前并发数
  const runningTaskIdsRef   = useRef(new Set<string>());             // 正在执行的任务 ID 集合
  const pendingRef          = useRef(new Map<string, File>());
  const engineRef        = useRef(new Map<string, Task['engine']>()); // 每个任务的转写引擎
  // taskId -> Kimi file_id，用于 deleteTask 时清理远端文件（含从 localStorage 恢复的旧任务）
  const kimiFileIdsRef   = useRef(new Map<string, string>(
    INITIAL_DATA.tasks
      .filter(t => t.examKimiFileId)
      .map(t => [t.id, t.examKimiFileId!]),
  ));

  // 让 drain 始终拿到最新 settings / language / quotaApi / user，避免闭包旧值
  const settingsRef = useRef(settings);
  const languageRef = useRef(language);
  const quotaApiRef = useRef(quotaApi);
  const userRef = useRef(user);
  // tasksRef 与 tasks state 保持同步，供云端同步函数安全读取最新任务列表
  const tasksRef = useRef<Task[]>(INITIAL_DATA.tasks);
  useEffect(() => { settingsRef.current = settings; }, [settings]);
  useEffect(() => { languageRef.current = language; }, [language]);
  useEffect(() => { quotaApiRef.current = quotaApi; }, [quotaApi]);
  useEffect(() => { userRef.current = user; }, [user]);

  useEffect(() => { saveTasks(tasks); }, [tasks]);
  useEffect(() => { saveArchivedStudents(archivedStudents); }, [archivedStudents]);

  // ── 云端初始化：user 变化（登录/登出）时触发 ──────────────────────────────
  useEffect(() => {
    if (!user) return;
    const userId = user.id;

    const init = async () => {
      // 首次登录：将本地已有任务批量上传到云端（仅执行一次，用 key 标记）
      const syncKey = `tw-cloud-synced-${userId}`;
      if (!localStorage.getItem(syncKey)) {
        const localTasks = tasksRef.current;
        try {
          if (localTasks.length > 0) await syncLocalTasksToCloud(localTasks, userId);
          localStorage.setItem(syncKey, '1');
        } catch (e) {
          console.warn('[cloud] initial sync error:', (e as Error).message);
        }
      }

      // 从云端拉取并合并（云端为准，补充本地缺失；同 id 以云端覆盖本地）
      try {
        const cloudTasks = await fetchUserTasks(userId);
        if (cloudTasks.length > 0) {
          setTasks(prev => {
            const merged = new Map(prev.map(t => [t.id, t]));
            for (const t of cloudTasks) merged.set(t.id, t);
            const next = Array.from(merged.values()).sort((a, b) => b.createdAt - a.createdAt);
            tasksRef.current = next;
            return next;
          });
        }
      } catch (e) {
        console.warn('[cloud] fetchUserTasks error:', (e as Error).message);
      }
    };

    init();
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const patch = useCallback((
    id: string,
    changes: Partial<Task>,
    { cloudSync = false }: { cloudSync?: boolean } = {},
  ) => {
    setTasks(prev => {
      const next = prev.map(t => t.id === id ? { ...t, ...changes } : t);
      tasksRef.current = next;
      return next;
    });
    if (cloudSync && userRef.current) {
      const updated = tasksRef.current.find(t => t.id === id);
      if (updated) {
        upsertTask(updated, userRef.current.id).catch(
          e => console.warn('[cloud] patch sync:', (e as Error).message),
        );
      }
    }
  }, []);

  /** 循环启动队列任务，直到并发槽占满（MAX_CONCURRENT）或队列为空 */
  const drain = useCallback(() => {
    while (runningCountRef.current < MAX_CONCURRENT) {
      // 跳过已被取消的任务
      while (queueRef.current.length > 0) {
        const head = queueRef.current[0];
        if (stopFlags.current.get(head) !== true && pendingRef.current.has(head)) break;
        queueRef.current.shift();
      }
      if (!queueRef.current.length) return;

      const id = queueRef.current.shift()!;
      const file = pendingRef.current.get(id)!;
      runningCountRef.current++;
      runningTaskIdsRef.current.add(id);

      const s = settingsRef.current;
      const l = languageRef.current;
      const onProgress = (p: number) => patch(id, { progress: p });
      const shouldStop  = () => stopFlags.current.get(id) === true;

      // 以 void 启动，不阻塞循环，让 while 继续填满并发槽
      void (async () => {
        // 提前捕获学生姓名列表，供转写完成后通知用
        const taskRef = tasksRef.current.find(t => t.id === id);
        const taskStudentNames = taskRef?.studentNames?.length
          ? taskRef.studentNames
          : taskRef?.studentName ? [taskRef.studentName] : [];

        // ── 配额守门：估算时长，未登录 / 额度不足直接终止 ──────────────────
        const qApi = quotaApiRef.current;
        const estSec = await estimateDurationSec(file);
        const estMin = Math.max(1, Math.ceil(estSec / 60));
        if (qApi && !qApi.requireTranscribe(estMin)) {
          patch(id, { status: 'error', error: '配额不足或未登录，请先登录或升级方案' });
          pendingRef.current.delete(id);
          stopFlags.current.delete(id);
          runningCountRef.current--;
          runningTaskIdsRef.current.delete(id);
          drain();
          return;
        }

        patch(id, { status: 'uploading', progress: 5 });

        try {
          const engine = engineRef.current.get(id) ?? 'volcano';
          const segments = engine === 'volcano'
            ? await transcribeVolcano(file, l, onProgress, shouldStop)
            : await transcribeXfyun(file, s, l, onProgress, shouldStop);
          if (!stopFlags.current.get(id)) {
            patch(id, { status: 'done', progress: 100, segments, audioFile: undefined }, { cloudSync: true });
            // 扣量：使用估算时长（来自音频元数据，已是真实总长）
            if (qApi) await qApi.recordUsage(estMin);
            // 转写完成自动通知家长（fire-and-forget，未绑定联系人时静默跳过）
            const durationLabel = estMin > 0 ? `共 ${estMin} 分钟，` : '';
            for (const name of taskStudentNames) {
              notifyParent(name, `「${name}」的课堂录音已转写完成，${durationLabel}可以查看转写内容了。`);
            }
          }
        } catch (err: unknown) {
          if (!stopFlags.current.get(id)) {
            patch(id, { status: 'error', error: err instanceof Error ? err.message : '转写失败' }, { cloudSync: true });
          }
        } finally {
          pendingRef.current.delete(id);
          stopFlags.current.delete(id);
          engineRef.current.delete(id);
          // deleteTask 删除正在运行的任务时会提前递减计数并从集合移除。
          // 此处只有仍在集合中时才递减，防止重复递减导致计数错误。
          if (runningTaskIdsRef.current.has(id)) {
            runningCountRef.current--;
            runningTaskIdsRef.current.delete(id);
            drain(); // 补位：尝试启动下一个任务
          }
        }
      })();
    }
  }, [patch]);

  const createTask = useCallback((
    studentNames: string[],
    topic: string,
    prompt: string,
    file: File | null,
    engine: Task['engine'] = 'volcano',
    examAnalysis?: string,
    examFile?: Task['examFile'],
    _examFileDataUrl?: string,
    examFileRaw?: File,
  ) => {
    const id = uid();
    const names = studentNames.filter(n => n.trim());
    // exam tasks have no audio file; transcribe tasks always have one
    const taskType: Task['taskType'] = file ? 'transcribe' : 'exam';
    const hasExamFile = taskType === 'exam' && !!examFileRaw;
    const newTask: Task = {
      id,
      studentName: formatStudentNames(names),
      studentNames: names,
      topic, prompt, engine,
      examAnalysis,
      examFile,
      taskType,
      audioFileName: file?.name ?? '',
      audioFile: file ?? undefined,
      // exam tasks skip transcription and go directly to done
      status: file ? 'queued' : 'done',
      progress: file ? 0 : 100,
      segments: [],
      error: null,
      createdAt: Date.now(),
      // 有文件时立即标记 uploading，等上传完毕再更新
      examKimiUploadStatus: hasExamFile ? 'uploading' : undefined,
    };
    setTasks(prev => {
      const next = [newTask, ...prev];
      tasksRef.current = next;
      return next;
    });
    // 云端同步（fire-and-forget）
    if (userRef.current) {
      upsertTask(newTask, userRef.current.id).catch(
        e => console.warn('[cloud] createTask:', (e as Error).message),
      );
    }
    if (file) {
      stopFlags.current.set(id, false);
      pendingRef.current.set(id, file);
      engineRef.current.set(id, engine);
      queueRef.current.push(id);
      drain();
    }

    // 异步上传试卷到 Kimi（不阻塞任务创建）
    if (hasExamFile) {
      const apiKey = getPlatformLlmApiKey();
      const baseUrl = getPlatformLlmBaseUrl();
      if (apiKey && baseUrl) {
        uploadFileToKimi(examFileRaw!, apiKey, baseUrl)
          .then(fileId => {
            kimiFileIdsRef.current.set(id, fileId);
            patch(id, { examKimiFileId: fileId, examKimiUploadStatus: 'ready' });
          })
          .catch(err => {
            console.error('[kimiFile] 上传失败:', err);
            patch(id, { examKimiUploadStatus: 'error' });
          });
      } else {
        // 未配置 LLM key，直接标记失败
        patch(id, { examKimiUploadStatus: 'error' });
      }
    }
  }, [drain, patch]);

  const cancelTask = useCallback((id: string) => {
    stopFlags.current.set(id, true);
    patch(id, { status: 'error', error: '已取消' });
  }, [patch]);

  const deleteTask = useCallback((id: string) => {
    stopFlags.current.set(id, true);
    // 立即从内部队列和 pending 文件 map 里清除，保持内部状态与 tasks state 一致
    queueRef.current = queueRef.current.filter(qid => qid !== id);
    pendingRef.current.delete(id);
    engineRef.current.delete(id);

    // 云端删除（fire-and-forget）
    if (userRef.current) {
      deleteTaskFromCloud(id).catch(
        e => console.warn('[cloud] deleteTask:', (e as Error).message),
      );
    }

    // Fire-and-forget：清理 Kimi 上的试卷文件（失败不报错）
    const kimiFileId = kimiFileIdsRef.current.get(id);
    if (kimiFileId) {
      kimiFileIdsRef.current.delete(id);
      const apiKey = getPlatformLlmApiKey();
      const baseUrl = getPlatformLlmBaseUrl();
      if (apiKey && baseUrl) {
        deleteKimiFile(kimiFileId, apiKey, baseUrl).catch(() => {});
      }
    }

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
    // 关键修复：删除的是正在执行的任务时，立即递减并发计数并从集合移除，
    // 防止该任务的 finally 块检测到 id 仍在集合中而重复递减。
    if (runningTaskIdsRef.current.has(id)) {
      runningCountRef.current--;
      runningTaskIdsRef.current.delete(id);
    }
    // 无论是否有任务在跑，都触发 drain 以利用空出的并发槽
    drain();
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
    const names = task.studentNames && task.studentNames.length > 0
      ? task.studentNames
      : [task.studentName];
    createTask(names, task.topic, task.prompt, task.audioFile, task.engine ?? 'volcano', task.examAnalysis, task.examFile);
  }, [deleteTask, createTask]);

  const saveAISummary = useCallback((id: string, summary: string) => {
    patch(id, { aiSummary: summary, aiSavedAt: Date.now() });
    if (userRef.current) {
      updateTaskSummary(id, summary).catch(
        e => console.warn('[cloud] saveAISummary:', (e as Error).message),
      );
    }
  }, [patch]);

  const saveNotes = useCallback((id: string, notes: string) => {
    patch(id, { notes }, { cloudSync: true });
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
