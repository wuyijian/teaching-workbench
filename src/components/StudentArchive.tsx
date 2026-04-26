/**
 * 学生档案 —— 以学生为单位，展示全部历史课节、转写与 AI 反馈
 */
import { useState, useMemo } from 'react';
import {
  User, FileAudio, Sparkles, BookOpen, Clock,
  ChevronRight, ChevronDown, CheckCircle2,
  MessageSquare, Calendar, Copy, Check,
  TrendingUp, Layers,
} from 'lucide-react';
import type { Task } from '../types';
import { normalizeStudentKey } from '../utils/student';

// ─── Types ───────────────────────────────────────────────────────────────────

interface StudentSummary {
  key:         string;
  displayName: string;
  tasks:       Task[];
  lastAt:      number;
  feedbackCnt: number;
  segmentCnt:  number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtDate(ts: number) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fmtTime(ts: number) {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function fmtSeg(sec: number) {
  const m = String(Math.floor(sec / 60)).padStart(2, '0');
  const s = String(sec % 60).padStart(2, '0');
  return `[${m}:${s}]`;
}

function groupByStudent(tasks: Task[]): StudentSummary[] {
  const map = new Map<string, Task[]>();
  for (const t of tasks) {
    const k = normalizeStudentKey(t.studentName);
    if (!k) continue;
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(t);
  }
  return Array.from(map.entries())
    .map(([key, ts]) => {
      const sorted = [...ts].sort((a, b) => b.createdAt - a.createdAt);
      return {
        key,
        displayName: sorted[0].studentName,
        tasks: sorted,
        lastAt:      sorted[0].createdAt,
        feedbackCnt: sorted.filter(t => !!t.aiSummary).length,
        segmentCnt:  sorted.reduce((n, t) => n + t.segments.length, 0),
      };
    })
    .sort((a, b) => b.lastAt - a.lastAt);
}

// ─── StudentList ─────────────────────────────────────────────────────────────

function StudentList({
  students, selected, onSelect,
}: {
  students: StudentSummary[];
  selected: string | null;
  onSelect: (key: string) => void;
}) {
  if (students.length === 0) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, color: 'var(--text-3)', padding: 24 }}>
        <BookOpen size={32} style={{ opacity: 0.3 }} />
        <p style={{ fontSize: 13, textAlign: 'center', lineHeight: 1.6 }}>暂无学生档案<br />创建转写任务后自动归档</p>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '8px 6px' }} className="scrollbar-thin">
      {students.map(s => {
        const isSelected = s.key === selected;
        return (
          <button
            key={s.key}
            onClick={() => onSelect(s.key)}
            style={{
              width: '100%', padding: '12px 14px', borderRadius: 10, marginBottom: 4,
              background: isSelected ? 'var(--accent-dim)' : 'transparent',
              border: `1px solid ${isSelected ? 'var(--accent)' : 'transparent'}`,
              cursor: 'pointer', textAlign: 'left', transition: 'all 0.15s',
            }}
            onMouseEnter={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = 'var(--bg-s2)'; }}
            onMouseLeave={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {/* Avatar */}
              <div style={{ width: 34, height: 34, borderRadius: 9, background: isSelected ? 'var(--accent)' : 'var(--bg-s3)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: isSelected ? '#fff' : 'var(--text-2)' }}>
                  {s.displayName.slice(0, 1)}
                </span>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 13, fontWeight: 600, color: isSelected ? 'var(--text-1)' : 'var(--text-1)', margin: 0, marginBottom: 3 }}>
                  {s.displayName}
                </p>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{s.tasks.length} 节课</span>
                  {s.feedbackCnt > 0 && (
                    <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 10, background: 'var(--green-dim)', color: 'var(--green)', border: '1px solid #1e4d27' }}>
                      {s.feedbackCnt} 份反馈
                    </span>
                  )}
                </div>
              </div>
              <span style={{ fontSize: 10, color: 'var(--text-3)', flexShrink: 0 }}>{fmtDate(s.lastAt)}</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}

// ─── TaskEntry ────────────────────────────────────────────────────────────────

function TaskEntry({ task, onGotoTask }: { task: Task; onGotoTask: (id: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const hasFeedback = !!task.aiSummary;
  const hasTranscript = task.segments.length > 0;
  const isDone = task.status === 'done';

  const copyFeedback = () => {
    if (!task.aiSummary) return;
    navigator.clipboard.writeText(task.aiSummary);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div style={{ borderRadius: 12, border: '1px solid var(--border)', background: 'var(--bg-s1)', overflow: 'hidden', marginBottom: 10 }}>
      {/* Header */}
      <div
        style={{ padding: '14px 16px', display: 'flex', alignItems: 'flex-start', gap: 12, cursor: 'pointer' }}
        onClick={() => setExpanded(v => !v)}
      >
        {/* Status dot */}
        <div style={{ marginTop: 2 }}>
          {isDone
            ? <CheckCircle2 size={15} style={{ color: 'var(--green)' }} />
            : <div style={{ width: 15, height: 15, borderRadius: '50%', border: '2px solid var(--border)' }} />
          }
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-1)' }}>
              {task.topic || '课堂转写'}
            </span>
            {hasFeedback && (
              <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 10, background: 'var(--green-dim)', color: 'var(--green)', border: '1px solid #1e4d27', fontWeight: 600 }}>
                已反馈
              </span>
            )}
            {task.notes && (
              <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 10, background: 'var(--accent-dim)', color: 'var(--accent)', border: '1px solid var(--accent-dim)' }}>
                有补充信息
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: 12, marginTop: 4, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, color: 'var(--text-3)', display: 'flex', alignItems: 'center', gap: 3 }}>
              <Calendar size={10} /> {fmtDate(task.createdAt)} {fmtTime(task.createdAt)}
            </span>
            <span style={{ fontSize: 11, color: 'var(--text-3)', display: 'flex', alignItems: 'center', gap: 3 }}>
              <FileAudio size={10} /> {task.audioFileName}
            </span>
            {hasTranscript && (
              <span style={{ fontSize: 11, color: 'var(--text-3)', display: 'flex', alignItems: 'center', gap: 3 }}>
                <MessageSquare size={10} /> {task.segments.length} 段 · {task.segments.reduce((n, s) => n + s.text.length, 0)} 字
              </span>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          <button
            onClick={e => { e.stopPropagation(); onGotoTask(task.id); }}
            style={{ fontSize: 11, padding: '4px 10px', borderRadius: 7, cursor: 'pointer', background: 'var(--bg-s3)', color: 'var(--text-2)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 4 }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'var(--text-1)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--text-2)'; }}
          >
            工作台 <ChevronRight size={10} />
          </button>
          {expanded
            ? <ChevronDown size={14} style={{ color: 'var(--text-3)' }} />
            : <ChevronRight size={14} style={{ color: 'var(--text-3)' }} />
          }
        </div>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div style={{ borderTop: '1px solid var(--border)' }}>
          {/* Notes */}
          {task.notes && (
            <div style={{ padding: '12px 16px', background: 'var(--bg-s2)', borderBottom: '1px solid var(--border)' }}>
              <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-3)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>补充信息</p>
              <p style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.65, margin: 0, whiteSpace: 'pre-wrap' }}>{task.notes}</p>
            </div>
          )}

          {/* AI Feedback */}
          {hasFeedback && (
            <div style={{ padding: '14px 16px', borderBottom: hasTranscript ? '1px solid var(--border)' : 'none' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Sparkles size={13} style={{ color: 'var(--accent)' }} />
                  <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: 0.5 }}>AI 课堂反馈</span>
                </div>
                <button
                  onClick={copyFeedback}
                  style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, padding: '3px 9px', borderRadius: 6, cursor: 'pointer', background: 'var(--bg-s3)', color: 'var(--text-3)', border: '1px solid var(--border)' }}
                >
                  {copied ? <><Check size={10} style={{ color: 'var(--green)' }} /> 已复制</> : <><Copy size={10} /> 复制</>}
                </button>
              </div>
              <div style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.75, whiteSpace: 'pre-wrap', padding: '12px 14px', borderRadius: 8, background: 'var(--bg-s2)', border: '1px solid var(--border)' }}>
                {task.aiSummary}
              </div>
            </div>
          )}

          {/* Transcript preview */}
          {hasTranscript && (
            <div style={{ padding: '14px 16px' }}>
              <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                转写记录 · {task.segments.length} 段
              </p>
              <div style={{ maxHeight: 200, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }} className="scrollbar-thin">
                {task.segments.map(seg => (
                  <div key={seg.id} style={{ display: 'flex', gap: 8 }}>
                    <span style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'monospace', flexShrink: 0, paddingTop: 1 }}>
                      {fmtSeg(seg.timestamp)}
                    </span>
                    <p style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.6, margin: 0 }}>{seg.text}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {!hasFeedback && !hasTranscript && (
            <div style={{ padding: '16px', textAlign: 'center', color: 'var(--text-3)', fontSize: 13 }}>
              暂无转写记录或 AI 反馈
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── StudentDetail ────────────────────────────────────────────────────────────

function StudentDetail({ student, onGotoTask }: { student: StudentSummary; onGotoTask: (id: string) => void }) {
  const doneTasks = student.tasks.filter(t => t.status === 'done');
  const feedbackTasks = student.tasks.filter(t => !!t.aiSummary);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Student header */}
      <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16 }}>
          <div style={{ width: 52, height: 52, borderRadius: 14, background: 'linear-gradient(135deg, var(--accent), #7c4af8)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <span style={{ fontSize: 22, fontWeight: 800, color: '#fff' }}>{student.displayName.slice(0, 1)}</span>
          </div>
          <div>
            <h2 style={{ fontSize: 20, fontWeight: 800, color: 'var(--text-1)', margin: 0, marginBottom: 4 }}>{student.displayName}</h2>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11, color: 'var(--text-3)', display: 'flex', alignItems: 'center', gap: 3 }}>
                <Clock size={10} /> 最近上课 {fmtDate(student.lastAt)}
              </span>
            </div>
          </div>
        </div>

        {/* Stats row */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
          {[
            { icon: Layers, label: '总课节', value: student.tasks.length },
            { icon: CheckCircle2, label: '已完成', value: doneTasks.length },
            { icon: Sparkles, label: 'AI 反馈', value: feedbackTasks.length },
            { icon: MessageSquare, label: '转写片段', value: student.segmentCnt },
          ].map(({ icon: Icon, label, value }) => (
            <div key={label} style={{ padding: '10px 12px', borderRadius: 10, background: 'var(--bg-s2)', border: '1px solid var(--border)', textAlign: 'center' }}>
              <Icon size={13} style={{ color: 'var(--accent)', marginBottom: 4 }} />
              <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-1)', lineHeight: 1 }}>{value}</div>
              <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 3 }}>{label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Task timeline */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }} className="scrollbar-thin">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
          <TrendingUp size={14} style={{ color: 'var(--text-3)' }} />
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: 0.5 }}>课节记录（共 {student.tasks.length} 节）</span>
        </div>
        {student.tasks.map(task => (
          <TaskEntry key={task.id} task={task} onGotoTask={onGotoTask} />
        ))}
      </div>
    </div>
  );
}

// ─── StudentArchive (main export) ─────────────────────────────────────────────

interface Props {
  tasks: Task[];
  onGotoTask: (taskId: string) => void;
}

export function StudentArchive({ tasks, onGotoTask }: Props) {
  const [selected, setSelected] = useState<string | null>(null);

  const students = useMemo(() => groupByStudent(tasks), [tasks]);

  // 自动选中第一个
  const selectedStudent = selected
    ? students.find(s => s.key === selected) ?? students[0] ?? null
    : students[0] ?? null;

  return (
    <div style={{ display: 'flex', height: '100%', gap: 10 }}>
      {/* ── Left: student list ── */}
      <div style={{ width: 240, flexShrink: 0, display: 'flex', flexDirection: 'column', borderRadius: 12, border: '1px solid var(--border)', background: 'var(--bg-s1)', overflow: 'hidden' }}>
        {/* Header */}
        <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <User size={14} style={{ color: 'var(--accent)' }} />
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-1)' }}>学生档案</span>
            <span style={{ marginLeft: 'auto', fontSize: 11, padding: '1px 8px', borderRadius: 10, background: 'var(--bg-s3)', color: 'var(--text-3)', border: '1px solid var(--border)' }}>
              {students.length} 人
            </span>
          </div>
        </div>
        <StudentList
          students={students}
          selected={selectedStudent?.key ?? null}
          onSelect={setSelected}
        />
      </div>

      {/* ── Right: student detail ── */}
      <div style={{ flex: 1, minWidth: 0, borderRadius: 12, border: '1px solid var(--border)', background: 'var(--bg-s1)', overflow: 'hidden' }}>
        {selectedStudent ? (
          <StudentDetail student={selectedStudent} onGotoTask={onGotoTask} />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 12, color: 'var(--text-3)' }}>
            <User size={40} style={{ opacity: 0.2 }} />
            <p style={{ fontSize: 14 }}>选择左侧学生查看档案</p>
          </div>
        )}
      </div>
    </div>
  );
}
