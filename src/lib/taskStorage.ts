/**
 * Supabase 任务数据访问层
 *
 * 所有函数在 supabase 为 null（Electron 离线构建）时静默返回，
 * 不抛错，调用方无需额外判断。
 */

import { supabase } from './supabase';
import type { Task, TranscriptSegment } from '../types';

// ─────────────────────────────────────────
// 内部工具：Task ↔ DB 行转换
// ─────────────────────────────────────────

interface TaskRow {
  id: string;
  user_id: string;
  student_names: string[];
  topic: string;
  task_type: string;
  engine: string;
  audio_file_name: string;
  status: string;
  progress: number;
  language: string;
  duration_sec: number | null;
  notes: string | null;
  exam_analysis: string | null;
  exam_file: { name: string; size: number; type: string } | null;
  exam_kimi_file_id: string | null;
  exam_kimi_upload_status: string | null;
  ai_summary: string | null;
  ai_saved_at: number | null;
  feedback_prompt: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

interface SegmentRow {
  id: string;
  task_id: string;
  user_id: string;
  idx: number;
  timestamp_sec: number;
  text: string;
  speaker: string | null;
  is_final: boolean;
}

function taskToRow(task: Task, userId: string): Omit<TaskRow, 'updated_at'> {
  const studentNames =
    task.studentNames && task.studentNames.length > 0
      ? task.studentNames
      : [task.studentName];

  return {
    id: task.id,
    user_id: userId,
    student_names: studentNames,
    topic: task.topic ?? '',
    task_type: task.taskType ?? 'transcribe',
    engine: task.engine ?? 'volcano',
    audio_file_name: task.audioFileName ?? '',
    status: task.status ?? 'queued',
    progress: task.progress ?? 0,
    language: 'zh-CN',
    duration_sec: task.estimateMs != null ? task.estimateMs / 1000 : null,
    notes: task.notes ?? null,
    exam_analysis: task.examAnalysis ?? null,
    exam_file: task.examFile ?? null,
    exam_kimi_file_id: task.examKimiFileId ?? null,
    exam_kimi_upload_status: task.examKimiUploadStatus ?? null,
    ai_summary: task.aiSummary ?? null,
    ai_saved_at: task.aiSavedAt ?? null,
    feedback_prompt: task.prompt ?? null,
    error_message: task.error ?? null,
    created_at: new Date(task.createdAt).toISOString(),
  };
}

function rowToTask(row: TaskRow, segments: SegmentRow[]): Task {
  const sortedSegments: TranscriptSegment[] = segments
    .sort((a, b) => a.idx - b.idx)
    .map((s) => ({
      id: s.id,
      text: s.text,
      timestamp: s.timestamp_sec,
      isFinal: s.is_final,
    }));

  const studentNames = row.student_names ?? [];
  const studentName =
    studentNames.length > 0 ? studentNames.join('、') : '';

  return {
    id: row.id,
    studentName,
    studentNames,
    topic: row.topic ?? '',
    prompt: row.feedback_prompt ?? '',
    engine: (row.engine ?? 'volcano') as Task['engine'],
    audioFileName: row.audio_file_name ?? '',
    status: (row.status ?? 'queued') as Task['status'],
    progress: row.progress ?? 0,
    segments: sortedSegments,
    error: row.error_message ?? null,
    createdAt: new Date(row.created_at).getTime(),
    estimateMs: row.duration_sec != null ? row.duration_sec * 1000 : undefined,
    notes: row.notes ?? undefined,
    examAnalysis: row.exam_analysis ?? undefined,
    examFile: row.exam_file ?? undefined,
    examKimiFileId: row.exam_kimi_file_id ?? undefined,
    examKimiUploadStatus:
      (row.exam_kimi_upload_status as Task['examKimiUploadStatus']) ?? undefined,
    aiSummary: row.ai_summary ?? undefined,
    aiSavedAt: row.ai_saved_at ?? undefined,
    taskType: (row.task_type ?? 'transcribe') as Task['taskType'],
  };
}

function segmentsToRows(
  segments: TranscriptSegment[],
  taskId: string,
  userId: string,
): Omit<SegmentRow, 'id'>[] {
  return segments.map((seg, idx) => ({
    task_id: taskId,
    user_id: userId,
    idx,
    timestamp_sec: seg.timestamp,
    text: seg.text,
    speaker: null,
    is_final: seg.isFinal,
  }));
}

// ─────────────────────────────────────────
// 公开 API
// ─────────────────────────────────────────

/**
 * 上传单个任务（upsert）。
 * segments 先全量删除再插入，保持简单可靠。
 */
export async function upsertTask(task: Task, userId: string): Promise<void> {
  if (!supabase) return;

  const row = taskToRow(task, userId);

  const { error: upsertErr } = await supabase
    .from('tasks')
    .upsert(row, { onConflict: 'id' });

  if (upsertErr) {
    console.error('[taskStorage] upsertTask error:', upsertErr.message);
    return;
  }

  // 先删旧 segments，再批量插入
  if (task.segments.length > 0) {
    await supabase.from('task_segments').delete().eq('task_id', task.id);

    const segRows = segmentsToRows(task.segments, task.id, userId);
    const { error: segErr } = await supabase
      .from('task_segments')
      .insert(segRows);

    if (segErr) {
      console.error('[taskStorage] upsertTask segments error:', segErr.message);
    }
  } else {
    // 任务无 segments（如试卷任务），清空即可
    await supabase.from('task_segments').delete().eq('task_id', task.id);
  }
}

/**
 * 批量上传本地任务到云端（首次同步）。
 * 逐条 upsert，失败单条不影响其余。
 */
export async function syncLocalTasksToCloud(
  tasks: Task[],
  userId: string,
): Promise<void> {
  if (!supabase) return;

  for (const task of tasks) {
    await upsertTask(task, userId);
  }
}

/**
 * 拉取该用户的所有任务（含 segments），按创建时间倒序。
 */
export async function fetchUserTasks(userId: string): Promise<Task[]> {
  if (!supabase) return [];

  const { data: taskRows, error: taskErr } = await supabase
    .from('tasks')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (taskErr) {
    console.error('[taskStorage] fetchUserTasks error:', taskErr.message);
    return [];
  }

  if (!taskRows || taskRows.length === 0) return [];

  const taskIds = taskRows.map((r: TaskRow) => r.id);

  const { data: segRows, error: segErr } = await supabase
    .from('task_segments')
    .select('*')
    .in('task_id', taskIds)
    .order('idx', { ascending: true });

  if (segErr) {
    console.error('[taskStorage] fetchUserTasks segments error:', segErr.message);
  }

  const segmentsByTask = new Map<string, SegmentRow[]>();
  for (const seg of (segRows ?? []) as SegmentRow[]) {
    const list = segmentsByTask.get(seg.task_id) ?? [];
    list.push(seg);
    segmentsByTask.set(seg.task_id, list);
  }

  return (taskRows as TaskRow[]).map((row) =>
    rowToTask(row, segmentsByTask.get(row.id) ?? []),
  );
}

/**
 * 从云端删除指定任务（segments 通过 CASCADE 自动删除）。
 */
export async function deleteTaskFromCloud(taskId: string): Promise<void> {
  if (!supabase) return;

  const { error } = await supabase.from('tasks').delete().eq('id', taskId);

  if (error) {
    console.error('[taskStorage] deleteTaskFromCloud error:', error.message);
  }
}

/**
 * 更新任务的 AI 摘要字段。
 */
export async function updateTaskSummary(
  taskId: string,
  summary: string,
): Promise<void> {
  if (!supabase) return;

  const { error } = await supabase
    .from('tasks')
    .update({ ai_summary: summary, ai_saved_at: Date.now() })
    .eq('id', taskId);

  if (error) {
    console.error('[taskStorage] updateTaskSummary error:', error.message);
  }
}
