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
