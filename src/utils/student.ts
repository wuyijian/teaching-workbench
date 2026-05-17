import type { Task } from '../types';

/** 同学唯一键：与任务里填写的「学生姓名」经 trim 后一致即视为同一人 */
export function normalizeStudentKey(name: string): string {
  return name.trim();
}

/**
 * 从任务中获取学生名字列表。
 * 新建任务写入 studentNames；旧数据只有 studentName，兼容降级处理。
 */
export function getStudentNames(task: Task): string[] {
  if (task.studentNames && task.studentNames.length > 0) return task.studentNames;
  return task.studentName ? [task.studentName] : [];
}

/** 将学生列表格式化为展示字符串，如 "张小明、李小华" */
export function formatStudentNames(names: string[]): string {
  return names.join('、');
}

/** 以学生为粒度聚合的档案数据 */
export interface StudentProfile {
  /** 归一化后的唯一键（trim 后的学生姓名） */
  key: string;
  /** 用于展示的姓名（取最新任务中该学生的写法） */
  displayName: string;
  /** 属于该学生的所有任务，按 createdAt 倒序 */
  tasks: Task[];
  /** 最近一次任务的时间戳 */
  lastAt: number;
  /** 课堂转写任务数（taskType === 'transcribe' 或 undefined） */
  classCnt: number;
  /** 试卷分析任务数（taskType === 'exam'） */
  examCnt: number;
  /** 累计转写时长（分钟，取各课堂任务最大 segment.timestamp 之和，估算值） */
  transcribeMins: number;
}

/**
 * 从任务列表中构建学生档案列表。
 * - 展平 studentNames[]（兼容旧 studentName 字段）
 * - 同一学生出现在多任务中时合并
 * - 结果按最近活跃时间倒序
 */
export function buildStudentProfiles(tasks: Task[]): StudentProfile[] {
  const map = new Map<string, { displayName: string; tasks: Task[] }>();

  for (const task of tasks) {
    const names = getStudentNames(task);
    for (const name of names) {
      const key = normalizeStudentKey(name);
      if (!key) continue;
      if (!map.has(key)) map.set(key, { displayName: name, tasks: [] });
      map.get(key)!.tasks.push(task);
    }
  }

  return Array.from(map.entries())
    .map(([key, { tasks: ts }]) => {
      const sorted = [...ts].sort((a, b) => b.createdAt - a.createdAt);
      const classCnt = sorted.filter(t => !t.taskType || t.taskType === 'transcribe').length;
      const examCnt  = sorted.filter(t => t.taskType === 'exam').length;
      // 估算转写时长：对每个课堂任务取最大 segment.timestamp（秒），累计后转分钟
      const transcribeSecs = sorted
        .filter(t => !t.taskType || t.taskType === 'transcribe')
        .reduce((acc, t) => {
          const maxTs = t.segments.length > 0
            ? Math.max(...t.segments.map(s => s.timestamp))
            : 0;
          return acc + maxTs;
        }, 0);
      return {
        key,
        displayName: sorted[0].studentName || sorted[0].studentNames?.[0] || key,
        tasks: sorted,
        lastAt: sorted[0].createdAt,
        classCnt,
        examCnt,
        transcribeMins: Math.round(transcribeSecs / 60),
      };
    })
    .sort((a, b) => b.lastAt - a.lastAt);
}
