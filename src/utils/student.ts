/** 同学唯一键：与任务里填写的「学生姓名」经 trim 后一致即视为同一人 */
export function normalizeStudentKey(name: string): string {
  return name.trim();
}
