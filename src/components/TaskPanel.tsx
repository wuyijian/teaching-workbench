import { useState, useRef, useCallback, useEffect } from 'react';
import {
  Plus, ChevronLeft, Trash2, RotateCcw, Copy, Check,
  FileAudio, Loader2, CheckCircle2, AlertCircle,
  User, BookOpen, Upload, X, Sparkles,
  Archive, ArchiveRestore, FileDown, ChevronRight,
  Mic, Pause, Play, Square,
} from 'lucide-react';
import type { Task } from '../types';
import { normalizeStudentKey } from '../utils/student';
import { pickAudioFileViaElectron } from '../config/app';
import { usePasteFile } from '../hooks/usePasteFile';
import { useMediaRecorder } from '../hooks/useMediaRecorder';

// ────────────────────────────────────────────────────────────────────────────
// Prompt 模板
// ────────────────────────────────────────────────────────────────────────────
export const FEEDBACK_PROMPT = `Role:
你是一位深耕中学语文教学、深受学生喜爱的年轻教师。你的语言风格专业而不失亲切，能敏锐观察到每个孩子的差异，沟通重点突出，让家长感到既受尊重又能得到干货，亲和力强一些，面对家长，也可适当多一些情绪价值

Task:
请根据我提供的学生表现，生成一份约 200 字的课堂反馈。

Structure (严格遵守):
1. 【课堂反馈】（多个学生也放在一起）
2. 课前检测： 简单客观表达课前检测内容以及结果 （如无可不写）
3. 核心内容： 简述本节课讲了什么（如：文言文虚词、名著阅读、考纲作文）。
4. 课堂表现： 客观描述孩子在课上的参与度、思维活跃度，分学生写
5. 课后检测： 简单客观表达课前检测内容以及结果 （如无可不写）
6. 课后叮嘱： 针对性指出孩子的问题以及要注意或者完成的事项，尽量客观 （如无可不写）

Tone & Principles:
• 客观真实： 不夸大，不敷写，避免空洞的"表现很好"。
• 分点呈现： 使用 Markdown 的加粗和列表，方便家长手机查阅。
• 拒绝幻觉： 只基于我给的信息，不要编造学生没有做过的事情。

请根据以下课堂转写内容，提取学生的亮点与不足，并按上述格式生成课堂反馈。`;

export const PROMPT_PRESETS = [
  { label: '📝 课堂反馈', value: FEEDBACK_PROMPT, isDefault: true },
  { label: '总结课堂内容', value: '请根据以下课堂转写内容，总结本次课的主要知识点和核心结论，条理清晰、重点突出。' },
  { label: '学情分析', value: '请根据以下课堂转写内容，分析该学生的学习状态、理解程度和参与度，并给出针对性建议。' },
  { label: '提取知识点', value: '请从以下课堂转写内容中提取所有知识点，并按重要程度排列，以结构化列表呈现。' },
  { label: '生成课后测验', value: '请根据以下课堂转写内容，生成 5 道课后测验题（含答案），题型多样，难度适中。' },
  { label: '生成学习建议', value: '请根据以下课堂转写内容，为该学生制定具体可行的学习计划和建议，帮助其巩固所学知识。' },
  { label: '自定义…', value: '' },
];

// ────────────────────────────────────────────────────────────────────────────
// PromptPreview（可展开的 Prompt 预览块）
// ────────────────────────────────────────────────────────────────────────────
function PromptPreview({ prompt }: { prompt: string }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = prompt.length > 80;
  return (
    <>
      <p className={`text-[11px] leading-relaxed whitespace-pre-wrap ${expanded ? '' : 'line-clamp-2'}`}
        style={{ color: 'var(--text-2)' }}>
        {prompt}
      </p>
      {isLong && (
        <button
          onClick={() => setExpanded(v => !v)}
          className="mt-1 text-[10px] transition-colors"
          style={{ color: 'var(--accent)' }}>
          {expanded ? '收起 ▲' : '展开 ▼'}
        </button>
      )}
    </>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────
function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

function formatSeg(seconds: number) {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = (seconds % 60).toString().padStart(2, '0');
  return `[${m}:${s}]`;
}

function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = (seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

const STATUS_META: Record<Task['status'], { label: string; dot: string }> = {
  queued:       { label: '排队中', dot: '#6e7681' },
  uploading:    { label: '上传中', dot: '#d29922' },
  transcribing: { label: '转写中', dot: '#4493f8' },
  done:         { label: '完成',   dot: '#3fb950' },
  error:        { label: '失败',   dot: '#f85149' },
};

// ────────────────────────────────────────────────────────────────────────────
// Props
// ────────────────────────────────────────────────────────────────────────────
interface Props {
  tasks: Task[];
  hasXfCredentials: boolean;
  selectedTaskId: string | null;
  onSelectTask: (id: string) => void;
  onCreateTask: (name: string, topic: string, prompt: string, file: File) => void;
  onDeleteTask: (id: string) => void;
  onCancelTask: (id: string) => void;
  onRetryTask: (task: Task) => void;
  isStudentArchived: (studentName: string) => boolean;
  onArchiveStudent: (studentName: string) => void;
  onUnarchiveStudent: (studentName: string) => void;
  language: string;
  onLanguageChange: (lang: string) => void;
}

const LANGUAGES = [
  { value: 'zh-CN', label: '普通话' },
  { value: 'zh-TW', label: '繁体中文' },
  { value: 'en-US', label: 'English' },
  { value: 'ja-JP', label: '日本語' },
];

// ────────────────────────────────────────────────────────────────────────────
// Task creation form
// ────────────────────────────────────────────────────────────────────────────
function CreateForm({
  onSubmit,
  onCancel,
}: {
  onSubmit: (name: string, topic: string, prompt: string, file: File) => void;
  onCancel: () => void;
}) {
  const [studentName, setStudentName] = useState('');
  const [topic, setTopic] = useState('');
  const [presetIdx, setPresetIdx] = useState(0); // 默认「课堂反馈」
  const [customPrompt, setCustomPrompt] = useState('');
  const [promptExpanded, setPromptExpanded] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [filePickError, setFilePickError] = useState<string | null>(null);
  const [recordMode, setRecordMode] = useState<'upload' | 'record'>('upload');
  const [recordedDuration, setRecordedDuration] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const isElectron = !!window.electronAPI;
  const recorder = useMediaRecorder();

  const isCustom = presetIdx === PROMPT_PRESETS.length - 1;
  const finalPrompt = isCustom ? customPrompt : PROMPT_PRESETS[presetIdx].value;

  const handleFile = useCallback((f: File) => setFile(f), []);

  // When recording finishes, auto-populate the file field
  useEffect(() => {
    if (recorder.audioFile) {
      setRecordedDuration(recorder.duration);
      handleFile(recorder.audioFile);
    }
  }, [recorder.audioFile, recorder.duration, handleFile]);

  const switchToUpload = useCallback(() => {
    recorder.reset();
    setFile(null);
    setRecordMode('upload');
  }, [recorder]);

  const switchToRecord = useCallback(() => {
    recorder.reset();
    setFile(null);
    setRecordMode('record');
  }, [recorder]);

  usePasteFile(handleFile, recordMode === 'upload');

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  };

  const openFilePicker = async () => {
    if (isElectron) {
      const f = await pickAudioFileViaElectron(setFilePickError);
      if (f) handleFile(f);
    } else {
      inputRef.current?.click();
    }
  };

  const canSubmit = studentName.trim() && file && finalPrompt.trim();

  const handleSubmit = () => {
    if (!canSubmit) return;
    onSubmit(studentName.trim(), topic.trim(), finalPrompt, file!);
  };

  return (
    <div className="flex flex-col h-full overflow-y-auto scrollbar-thin">
      <div className="flex items-center gap-2 px-4 pt-4 pb-3 border-b border-slate-700/50">
        <button onClick={onCancel} className="text-slate-400 hover:text-slate-200 transition-colors">
          <ChevronLeft size={18} />
        </button>
        <span className="text-sm font-semibold text-slate-200">新建转写任务</span>
      </div>

      <div className="px-4 py-4 space-y-4">
        {/* Student name */}
        <div>
          <label className="flex items-center gap-1.5 text-xs text-slate-400 font-medium mb-1.5">
            <User size={11} /> 学生姓名 <span className="text-red-400">*</span>
          </label>
          <input
            type="text"
            value={studentName}
            onChange={e => setStudentName(e.target.value)}
            placeholder="输入学生姓名"
            className="w-full bg-slate-800 border border-slate-600 focus:border-indigo-500 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder:text-slate-500 outline-none transition-colors"
          />
        </div>

        {/* Topic */}
        <div>
          <label className="flex items-center gap-1.5 text-xs text-slate-400 font-medium mb-1.5">
            <BookOpen size={11} /> 主题 <span className="text-slate-600 text-[10px] ml-1">可选</span>
          </label>
          <input
            type="text"
            value={topic}
            onChange={e => setTopic(e.target.value)}
            placeholder="如：数学 · 二次函数、英语 · 阅读理解"
            className="w-full bg-slate-800 border border-slate-600 focus:border-indigo-500 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder:text-slate-500 outline-none transition-colors"
          />
        </div>

        {/* Prompt presets */}
        <div>
          <label className="flex items-center gap-1.5 text-xs text-slate-400 font-medium mb-1.5">
            <Sparkles size={11} /> AI 处理 Prompt <span className="text-red-400">*</span>
          </label>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {PROMPT_PRESETS.map((p, i) => (
              <button
                key={p.label}
                onClick={() => setPresetIdx(i)}
                className={`text-xs px-2.5 py-1 rounded-full border transition-all ${
                  presetIdx === i
                    ? 'bg-indigo-500/20 border-indigo-500/50 text-indigo-300'
                    : 'bg-slate-800 border-slate-600 text-slate-400 hover:text-slate-200'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          {isCustom ? (
            <textarea
              value={customPrompt}
              onChange={e => setCustomPrompt(e.target.value)}
              placeholder="输入自定义 Prompt…"
              rows={3}
              className="w-full bg-slate-800 border border-slate-600 focus:border-indigo-500 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder:text-slate-500 outline-none transition-colors resize-none scrollbar-thin"
            />
          ) : (
            <div className="bg-slate-800/50 border border-slate-700 rounded-lg px-3 py-2">
              <p className={`text-xs text-slate-400 leading-relaxed whitespace-pre-wrap ${promptExpanded ? '' : 'line-clamp-3'}`}>
                {PROMPT_PRESETS[presetIdx].value}
              </p>
              {PROMPT_PRESETS[presetIdx].value.length > 120 && (
                <button
                  onClick={() => setPromptExpanded(v => !v)}
                  className="mt-1 text-[10px] text-indigo-400 hover:text-indigo-300 transition-colors"
                >
                  {promptExpanded ? '收起 ▲' : '展开查看完整 Prompt ▼'}
                </button>
              )}
            </div>
          )}
        </div>

        {/* Audio source */}
        <div>
          <label className="text-xs text-slate-400 font-medium mb-1.5 block">
            音频来源 <span className="text-red-400">*</span>
          </label>

          {/* Mode tabs */}
          <div className="flex gap-0.5 p-0.5 rounded-lg mb-3"
            style={{ background: 'var(--bg-s3)', border: '1px solid var(--border)' }}>
            <button
              type="button"
              onClick={switchToUpload}
              className="flex-1 flex items-center justify-center gap-1.5 text-xs py-1.5 rounded-md transition-all"
              style={recordMode === 'upload'
                ? { background: 'var(--bg-s2)', color: 'var(--text-1)', border: '1px solid var(--border)' }
                : { color: 'var(--text-3)', border: '1px solid transparent' }}
            >
              <Upload size={11} /> 上传文件
            </button>
            <button
              type="button"
              onClick={switchToRecord}
              className="flex-1 flex items-center justify-center gap-1.5 text-xs py-1.5 rounded-md transition-all"
              style={recordMode === 'record'
                ? { background: 'var(--bg-s2)', color: 'var(--text-1)', border: '1px solid var(--border)' }
                : { color: 'var(--text-3)', border: '1px solid transparent' }}
            >
              <Mic size={11} /> 现场录音
            </button>
          </div>

          {/* File selected (shared for upload and record modes) */}
          {file ? (
            <div className="flex items-center gap-3 rounded-lg px-3 py-2.5 border"
              style={{ background: 'var(--bg-s2)', borderColor: 'var(--border)' }}>
              {recordMode === 'record'
                ? <Mic size={16} className="text-red-400 shrink-0" />
                : <FileAudio size={16} className="text-indigo-400 shrink-0" />}
              <div className="flex-1 min-w-0">
                <p className="text-sm truncate" style={{ color: 'var(--text-1)' }}>{file.name}</p>
                <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>
                  {recordMode === 'record'
                    ? `${formatDuration(recordedDuration)} · 点击「创建任务」开始转写`
                    : `${(file.size / 1024 / 1024).toFixed(1)} MB`}
                </p>
              </div>
              <button
                type="button"
                onClick={() => { setFile(null); recorder.reset(); }}
                className="transition-colors"
                style={{ color: 'var(--text-3)' }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'var(--text-1)'}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'var(--text-3)'}
              >
                <X size={14} />
              </button>
            </div>

          ) : recordMode === 'upload' ? (
            /* ── 上传文件 ── */
            <>
              <div
                className={`relative rounded-xl border-2 border-dashed transition-all cursor-pointer ${
                  dragging ? 'border-indigo-500 bg-indigo-500/10' : 'border-slate-600 hover:border-slate-500'
                }`}
                onDragOver={e => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={handleDrop}
                onClick={openFilePicker}
              >
                <div className="flex flex-col items-center py-5 gap-2 select-none pointer-events-none">
                  <Upload size={20} className="text-slate-500" />
                  <p className="text-xs text-slate-400">拖拽 · 点击 · 或 ⌘V 粘贴音频文件</p>
                  <p className="text-xs text-slate-600">MP3 · WAV · M4A · FLAC 等</p>
                </div>
                {!isElectron && (
                  <input
                    ref={inputRef}
                    type="file"
                    accept=".mp3,.mp4,.wav,.m4a,.ogg,.webm,.flac,.aac"
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; }}
                  />
                )}
              </div>
              {filePickError && (
                <p className="text-xs text-red-400 mt-1">{filePickError}</p>
              )}
            </>

          ) : (
            /* ── 现场录音 ── */
            <div className="rounded-xl border-2 border-dashed flex flex-col items-center py-5 gap-3 transition-all"
              style={{ borderColor: recorder.state === 'recording' ? 'var(--red)' : 'var(--border)' }}>

              {/* Idle */}
              {recorder.state === 'idle' && (
                <>
                  <button
                    type="button"
                    onClick={recorder.start}
                    className="w-14 h-14 rounded-full flex items-center justify-center transition-all hover:scale-105"
                    style={{ background: 'var(--red-dim)', border: '2px solid var(--red)', color: 'var(--red)' }}
                  >
                    <Mic size={22} />
                  </button>
                  <p className="text-xs" style={{ color: 'var(--text-3)' }}>点击麦克风开始录音</p>
                  {!recorder.isSupported && (
                    <p className="text-xs" style={{ color: 'var(--amber)' }}>当前浏览器不支持录音</p>
                  )}
                  {recorder.error && (
                    <p className="text-xs text-center px-4" style={{ color: 'var(--red)' }}>{recorder.error}</p>
                  )}
                </>
              )}

              {/* Requesting permission */}
              {recorder.state === 'requesting' && (
                <>
                  <Loader2 size={24} className="animate-spin" style={{ color: 'var(--accent)' }} />
                  <p className="text-xs" style={{ color: 'var(--text-3)' }}>请求麦克风权限…</p>
                </>
              )}

              {/* Recording / Paused */}
              {(recorder.state === 'recording' || recorder.state === 'paused') && (
                <>
                  <div className="flex items-center gap-2.5">
                    <span className="w-2.5 h-2.5 rounded-full"
                      style={{
                        background: recorder.state === 'recording' ? 'var(--red)' : 'var(--amber)',
                        boxShadow: recorder.state === 'recording' ? '0 0 8px var(--red)' : undefined,
                        animation: recorder.state === 'recording' ? 'pulse 1.2s ease-in-out infinite' : undefined,
                      }}
                    />
                    <span className="text-xl font-mono font-semibold tabular-nums"
                      style={{ color: 'var(--text-1)' }}>
                      {formatDuration(recorder.duration)}
                    </span>
                    <span className="text-xs"
                      style={{ color: recorder.state === 'paused' ? 'var(--amber)' : 'var(--text-3)' }}>
                      {recorder.state === 'paused' ? '已暂停' : '录音中'}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    {recorder.state === 'recording' ? (
                      <button
                        type="button"
                        onClick={recorder.pause}
                        className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg transition-all"
                        style={{ color: 'var(--text-2)', background: 'var(--bg-s2)', border: '1px solid var(--border)' }}
                      >
                        <Pause size={11} /> 暂停
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={recorder.resume}
                        className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg transition-all"
                        style={{ color: 'var(--amber)', background: 'var(--amber-dim)', border: '1px solid #5a3d0a' }}
                      >
                        <Play size={11} /> 继续
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={recorder.stop}
                      className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg transition-all"
                      style={{ color: 'var(--red)', background: 'var(--red-dim)', border: '1px solid #5a1e1e' }}
                    >
                      <Square size={11} /> 停止
                    </button>
                  </div>
                </>
              )}

              {/* Done — brief state while useEffect propagates file to form */}
              {recorder.state === 'done' && (
                <>
                  <Loader2 size={22} className="animate-spin" style={{ color: 'var(--accent)' }} />
                  <p className="text-xs" style={{ color: 'var(--text-3)' }}>处理录音中…</p>
                </>
              )}
            </div>
          )}
        </div>

        <button
          onClick={handleSubmit}
          disabled={!canSubmit}
          className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-30 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-all"
        >
          创建任务并开始转写
        </button>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Task card
// ────────────────────────────────────────────────────────────────────────────
function TaskCard({
  task, isSelected, isArchived, queuePosition, onSelect, onDelete, onCancel, onRetry,
}: {
  task: Task;
  isSelected?: boolean;
  isArchived?: boolean;
  queuePosition?: number;
  onSelect: () => void;
  onDelete: () => void;
  onCancel: () => void;
  onRetry: () => void;
}) {
  const meta = STATUS_META[task.status];
  const isActive = task.status === 'uploading' || task.status === 'transcribing';
  const isQueued = task.status === 'queued';
  const initial = task.studentName.slice(0, 1);

  return (
    <div
      onClick={onSelect}
      className="group card-hover cursor-pointer rounded-xl"
      style={{
        padding: '10px 12px',
        border: `1px solid ${isSelected ? '#388bfd60' : 'var(--border)'}`,
        background: isSelected ? 'var(--accent-dim)' : isArchived ? 'var(--bg-s1)' : 'var(--bg-s1)',
        boxShadow: isSelected ? '0 0 0 1px #388bfd30' : undefined,
        opacity: isArchived ? 0.7 : 1,
      }}
    >
      <div className="flex items-start gap-2.5">
        {/* Avatar */}
        <div className="w-8 h-8 rounded-lg flex items-center justify-center text-sm font-semibold shrink-0"
          style={{
            background: isSelected ? '#388bfd30' : 'var(--bg-s3)',
            color: isSelected ? 'var(--accent)' : 'var(--text-2)',
            border: `1px solid ${isSelected ? '#388bfd40' : 'var(--border)'}`,
          }}>
          {initial}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-1">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="text-sm font-medium truncate" style={{ color: 'var(--text-1)' }}>
                {task.studentName}
              </span>
              {task.topic && (
                <span className="text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0"
                  style={{ background: 'var(--bg-s3)', color: 'var(--text-3)', border: '1px solid var(--border)' }}>
                  {task.topic}
                </span>
              )}
            </div>
            {/* Hover actions */}
            <div className="flex gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={e => e.stopPropagation()}>
              {(isActive || isQueued) && (
                <button onClick={onCancel} className="p-1 rounded transition-colors"
                  style={{ color: 'var(--text-3)' }}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'var(--amber)'}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'var(--text-3)'}
                  title="取消">
                  <X size={12} />
                </button>
              )}
              {task.status === 'error' && task.audioFile && (
                <button onClick={onRetry} className="p-1 rounded transition-colors"
                  style={{ color: 'var(--text-3)' }}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'var(--accent)'}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'var(--text-3)'}
                  title="重试">
                  <RotateCcw size={12} />
                </button>
              )}
              <button onClick={onDelete} className="p-1 rounded transition-colors"
                style={{ color: 'var(--text-3)' }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'var(--red)'}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'var(--text-3)'}
                title="删除">
                <Trash2 size={12} />
              </button>
            </div>
          </div>

          {/* Meta row */}
          <div className="flex items-center gap-2 mt-1">
            <span className="inline-flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full"
                style={{ background: meta.dot, boxShadow: isActive ? `0 0 4px ${meta.dot}` : undefined }} />
              <span className="text-[11px] font-medium" style={{ color: meta.dot }}>
                {isQueued && queuePosition ? `排队第 ${queuePosition} 位` : meta.label}
              </span>
            </span>
            <span className="text-[11px]" style={{ color: 'var(--text-3)' }}>
              讯飞大模型
            </span>
            <span className="text-[11px]" style={{ color: 'var(--text-3)' }}>
              {formatTime(task.createdAt)}
            </span>
            {task.aiSummary && (
              <span className="text-[10px] px-1.5 py-0.5 rounded"
                style={{ background: 'var(--green-dim)', color: 'var(--green)', border: '1px solid #1e4d27' }}>
                已反馈
              </span>
            )}
          </div>

          {/* Progress */}
          {isActive && (
            <div className="mt-2 h-0.5 rounded-full overflow-hidden" style={{ background: 'var(--bg-s3)' }}>
              <div className="h-full rounded-full transition-all duration-500"
                style={{ width: `${task.progress}%`, background: 'var(--accent)' }} />
            </div>
          )}

          {/* Transcript preview */}
          {task.status === 'done' && task.segments.length > 0 && (
            <p className="mt-1.5 text-[11px] line-clamp-1 leading-relaxed" style={{ color: 'var(--text-3)' }}>
              {task.segments.map(s => s.text).join('').slice(0, 60)}…
            </p>
          )}
          {task.status === 'error' && (
            <p className="mt-1 text-[11px]" style={{ color: 'var(--red)' }}>{task.error}</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Task detail view
// ────────────────────────────────────────────────────────────────────────────
function TaskDetail({
  task, studentArchived, onBack, onDelete, onArchive, onUnarchive, onExport,
}: {
  task: Task;
  studentArchived: boolean;
  onBack: () => void;
  onDelete: () => void;
  onArchive: () => void;
  onUnarchive: () => void;
  onExport: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const fullText = task.segments.map(s => `${formatSeg(s.timestamp)} ${s.text}`).join('\n');

  const handleCopy = () => {
    navigator.clipboard.writeText(fullText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const isActive = task.status === 'uploading' || task.status === 'transcribing';
  const isDone = task.status === 'done';

  const iconBtn = (title: string, children: React.ReactNode, onClick: () => void, hoverColor = 'var(--text-1)') => (
    <button
      onClick={onClick}
      title={title}
      className="p-1.5 rounded-lg transition-all"
      style={{ color: 'var(--text-3)', border: '1px solid transparent' }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLElement).style.color = hoverColor;
        (e.currentTarget as HTMLElement).style.background = 'var(--bg-s3)';
        (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)';
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLElement).style.color = 'var(--text-3)';
        (e.currentTarget as HTMLElement).style.background = 'transparent';
        (e.currentTarget as HTMLElement).style.borderColor = 'transparent';
      }}
    >
      {children}
    </button>
  );

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 pt-3 pb-2.5 shrink-0"
        style={{ borderBottom: '1px solid var(--border)' }}>
        <div className="flex items-center gap-2 min-w-0">
          <button onClick={onBack}
            className="p-1 rounded-lg transition-all"
            style={{ color: 'var(--text-2)' }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'var(--text-1)'; (e.currentTarget as HTMLElement).style.background = 'var(--bg-s3)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--text-2)'; (e.currentTarget as HTMLElement).style.background = 'transparent'; }}>
            <ChevronLeft size={16} />
          </button>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-sm font-semibold truncate" style={{ color: 'var(--text-1)' }}>
                {task.studentName}
              </span>
              {task.topic && (
                <span className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                  style={{ background: 'var(--bg-s3)', color: 'var(--text-3)', border: '1px solid var(--border)' }}>
                  {task.topic}
                </span>
              )}
              {studentArchived && (
                <span className="text-[10px] px-1.5 py-0.5 rounded flex items-center gap-0.5"
                  style={{ background: 'var(--bg-s3)', color: 'var(--text-3)', border: '1px solid var(--border)' }}>
                  <Archive size={9} />该同学已归档
                </span>
              )}
            </div>
            <p className="text-[11px] mt-0.5 truncate" style={{ color: 'var(--text-3)' }}>
              {task.audioFileName}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          {isDone && (
            <>
              {iconBtn('复制转写', copied ? <Check size={13} style={{ color: 'var(--green)' }} /> : <Copy size={13} />, handleCopy)}
              {iconBtn('导出 Markdown', <FileDown size={13} />, onExport, 'var(--accent)')}
              {studentArchived
                ? iconBtn('恢复该同学到列表', <ArchiveRestore size={13} />, onUnarchive, 'var(--green)')
                : iconBtn('将该同学移入归档', <Archive size={13} />, onArchive, 'var(--amber)')
              }
            </>
          )}
          {iconBtn('删除', <Trash2 size={13} />, onDelete, 'var(--red)')}
        </div>
      </div>

      {/* Prompt preview */}
      <div className="mx-3 mt-2.5 px-3 py-2 rounded-lg shrink-0"
        style={{ background: 'var(--bg-s3)', border: '1px solid var(--border)' }}>
        <p className="text-[10px] font-semibold mb-0.5 uppercase tracking-wide" style={{ color: 'var(--accent)' }}>Prompt</p>
        <PromptPreview prompt={task.prompt} />
      </div>

      {/* Transcript */}
      <div className="flex-1 overflow-y-auto scrollbar-thin px-4 py-3 min-h-0">
        {isActive && (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-slate-400">
            <Loader2 size={24} className="animate-spin text-indigo-400" />
            <p className="text-sm">{task.status === 'uploading' ? '上传中…' : '转写中，请稍候…'}</p>
            <div className="w-48 h-1.5 bg-slate-700 rounded-full overflow-hidden">
              <div className="h-full bg-indigo-500 rounded-full transition-all duration-500" style={{ width: `${task.progress}%` }} />
            </div>
            <span className="text-xs text-slate-500">{task.progress}%</span>
          </div>
        )}

        {task.status === 'error' && (
          <div className="flex items-start gap-2 mt-2 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
            <AlertCircle size={14} className="text-red-400 mt-0.5 shrink-0" />
            <p className="text-xs text-red-400">{task.error}</p>
          </div>
        )}

        {task.status === 'done' && (
          <div className="space-y-2">
            <p className="text-xs text-slate-500 mb-3">
              {task.segments.length} 段 · {task.segments.reduce((n, s) => n + s.text.length, 0)} 字
            </p>
            {task.segments.map(seg => (
              <div key={seg.id} className="flex gap-2">
                <span className="text-xs text-slate-500 font-mono shrink-0 pt-0.5">{formatSeg(seg.timestamp)}</span>
                <p className="text-sm text-slate-200 leading-relaxed">{seg.text}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Main TaskPanel
// ────────────────────────────────────────────────────────────────────────────
type View = 'list' | 'create' | 'detail';

// ── 导出单个任务为 Markdown ──────────────────────────────────────────────────
function exportTaskMd(task: Task) {
  const date = new Date(task.createdAt);
  const dateStr = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  const lines = [
    `# ${task.studentName}${task.topic ? ` · ${task.topic}` : ''} — ${dateStr}`,
    '',
    `- **学生**：${task.studentName}`,
    task.topic ? `- **主题**：${task.topic}` : '',
    `- **日期**：${dateStr}`,
    `- **引擎**：讯飞大模型`,
    '',
    '## 课堂转写',
    '',
    ...task.segments.map(s => {
      const m = String(Math.floor(s.timestamp/60)).padStart(2,'0');
      const sec = String(s.timestamp%60).padStart(2,'0');
      return `**[${m}:${sec}]** ${s.text}`;
    }),
    '',
  ];
  if (task.aiSummary) {
    lines.push('## 课堂反馈', '', task.aiSummary, '');
  }
  const blob = new Blob([lines.filter(Boolean).join('\n')], { type: 'text/markdown;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${task.studentName}-${dateStr}.md`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function groupTasksByStudent(taskList: Task[]) {
  const map = new Map<string, Task[]>();
  for (const t of taskList) {
    const k = normalizeStudentKey(t.studentName) || t.id;
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(t);
  }
  for (const list of map.values()) {
    list.sort((a, b) => b.createdAt - a.createdAt);
  }
  return Array.from(map.entries())
    .map(([key, tlist]) => ({
      key,
      displayName: (tlist[0]?.studentName ?? '').trim() || key,
      tasks: tlist,
    }))
    .sort((a, b) => Math.max(...b.tasks.map(t => t.createdAt)) - Math.max(...a.tasks.map(t => t.createdAt)));
}

export function TaskPanel({
  tasks, hasXfCredentials: _hxf, selectedTaskId, onSelectTask,
  onCreateTask, onDeleteTask, onCancelTask, onRetryTask,
  isStudentArchived, onArchiveStudent, onUnarchiveStudent,
  language, onLanguageChange,
}: Props) {
  const [view, setView] = useState<View>('list');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [showArchive, setShowArchive] = useState(false);

  const detailTask = tasks.find(t => t.id === detailId);

  const handleCreate = useCallback((
    name: string, topic: string, prompt: string, file: File,
  ) => {
    onCreateTask(name, topic, prompt, file);
    setView('list');
  }, [onCreateTask]);

  const handleDelete = useCallback((id: string) => {
    onDeleteTask(id);
    if (detailId === id) setView('list');
  }, [onDeleteTask, detailId]);

  const panelStyle = { background: 'var(--bg-s1)', border: '1px solid var(--border)', borderRadius: 12 };
  const archivedTasks = tasks.filter(t => isStudentArchived(t.studentName));
  const normalTasks = tasks.filter(t => !isStudentArchived(t.studentName));
  const archivedByStudent = groupTasksByStudent(archivedTasks);
  const archivedPersonCount = archivedByStudent.length;
  const activeCount = tasks.filter(t => t.status === 'uploading' || t.status === 'transcribing').length;
  const doneCount = normalTasks.filter(t => t.status === 'done').length;

  if (view === 'create') {
    return (
      <div className="flex flex-col h-full" style={panelStyle}>
        <CreateForm onSubmit={handleCreate} onCancel={() => setView('list')} />
      </div>
    );
  }

  if (view === 'detail' && detailTask) {
    return (
      <div className="flex flex-col h-full" style={panelStyle}>
        <TaskDetail
          task={detailTask}
          studentArchived={isStudentArchived(detailTask.studentName)}
          onBack={() => setView('list')}
          onDelete={() => handleDelete(detailTask.id)}
          onArchive={() => onArchiveStudent(detailTask.studentName)}
          onUnarchive={() => onUnarchiveStudent(detailTask.studentName)}
          onExport={() => exportTaskMd(detailTask)}
        />
      </div>
    );
  }

  // List view
  return (
    <div className="flex flex-col h-full" style={panelStyle}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 shrink-0"
        style={{ borderBottom: '1px solid var(--border)' }}>
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>转写任务</span>
          {activeCount > 0 && (
            <span className="flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-full"
              style={{ color: 'var(--amber)', background: 'var(--amber-dim)', border: '1px solid #5a3d0a' }}>
              <Loader2 size={9} className="animate-spin" /> {activeCount}
            </span>
          )}
          {doneCount > 0 && activeCount === 0 && (
            <span className="flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-full"
              style={{ color: 'var(--green)', background: 'var(--green-dim)', border: '1px solid #1e4d27' }}>
              <CheckCircle2 size={9} /> {doneCount}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <select
            value={language}
            onChange={e => onLanguageChange(e.target.value)}
            className="text-[11px] rounded-lg px-2 py-1 cursor-pointer outline-none"
            style={{ background: 'var(--bg-s2)', color: 'var(--text-2)', border: '1px solid var(--border)' }}
          >
            {LANGUAGES.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
          </select>
          <button
            onClick={() => setView('create')}
            className="flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-lg font-medium transition-all"
            style={{ background: 'var(--accent)', color: '#fff' }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.opacity = '0.85'}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.opacity = '1'}
          >
            <Plus size={12} /> 新建
          </button>
        </div>
      </div>

      {/* Task list */}
      <div className="flex-1 overflow-y-auto scrollbar-thin min-h-0" style={{ padding: '10px 10px' }}>
        {normalTasks.length === 0 && archivedTasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-4 fade-in">
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center"
              style={{ background: 'var(--bg-s3)', border: '1px solid var(--border)' }}>
              <FileAudio size={22} style={{ color: 'var(--text-3)' }} />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium" style={{ color: 'var(--text-2)' }}>暂无转写任务</p>
              <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>点击「新建」上传音频文件</p>
            </div>
            <button
              onClick={() => setView('create')}
              className="flex items-center gap-1.5 text-xs px-4 py-2 rounded-lg font-medium transition-all"
              style={{ background: 'var(--accent)', color: '#fff' }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.opacity = '0.85'}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.opacity = '1'}
            >
              <Plus size={13} /> 新建任务
            </button>
          </div>
        ) : (
          <div className="space-y-1.5">
            {(() => {
              // 队列位置：按 createdAt 升序（越早创建越先执行）计算排名
              const queuedIds = normalTasks
                .filter(t => t.status === 'queued')
                .sort((a, b) => a.createdAt - b.createdAt)
                .map(t => t.id);
              return normalTasks.map(task => (
                <TaskCard
                  key={task.id}
                  task={task}
                  isSelected={selectedTaskId === task.id}
                  queuePosition={task.status === 'queued' ? queuedIds.indexOf(task.id) + 1 : undefined}
                onSelect={() => {
                  onSelectTask(task.id);
                  if (task.status === 'done' || task.status === 'error') {
                    setDetailId(task.id);
                    setView('detail');
                  }
                }}
                onDelete={() => handleDelete(task.id)}
                onCancel={() => onCancelTask(task.id)}
                onRetry={() => onRetryTask(task)}
              />
              ));
            })()}

            {archivedTasks.length > 0 && (
              <div className="pt-3">
                <button
                  onClick={() => setShowArchive(v => !v)}
                  className="flex items-center gap-1.5 text-[11px] w-full px-2 py-1.5 rounded-lg transition-all"
                  style={{ color: 'var(--text-3)', background: 'transparent' }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'var(--text-2)'; (e.currentTarget as HTMLElement).style.background = 'var(--bg-s3)'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--text-3)'; (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                >
                  <Archive size={11} />
                  <span className="truncate text-left">
                    已归档同学（{archivedPersonCount} 人 · {archivedTasks.length} 条）
                  </span>
                  <ChevronRight size={11} className={`ml-auto shrink-0 transition-transform duration-200 ${showArchive ? 'rotate-90' : ''}`} />
                </button>
                {showArchive && (
                  <div className="mt-1.5 space-y-3 pl-2" style={{ borderLeft: '1px solid var(--border)' }}>
                    {archivedByStudent.map(group => (
                      <div key={group.key} className="space-y-1.5">
                        <div className="flex items-center gap-2 px-0.5 min-w-0">
                          <User size={12} className="shrink-0" style={{ color: 'var(--text-3)' }} />
                          <span className="text-[11px] font-medium truncate" style={{ color: 'var(--text-2)' }}>
                            {group.displayName}
                          </span>
                          <span className="text-[10px] shrink-0" style={{ color: 'var(--text-3)' }}>
                            {group.tasks.length} 条
                          </span>
                          <button
                            type="button"
                            onClick={e => {
                              e.stopPropagation();
                              onUnarchiveStudent(group.tasks[0]!.studentName);
                            }}
                            className="ml-auto text-[10px] px-2 py-0.5 rounded-md shrink-0 transition-colors"
                            style={{ color: 'var(--green)', background: 'var(--green-dim)', border: '1px solid #1e4d27' }}
                          >
                            恢复同学
                          </button>
                        </div>
                        <div className="space-y-1.5">
                          {group.tasks.map(task => (
                            <TaskCard
                              key={task.id}
                              task={task}
                              isSelected={selectedTaskId === task.id}
                              isArchived
                              onSelect={() => { setDetailId(task.id); setView('detail'); onSelectTask(task.id); }}
                              onDelete={() => handleDelete(task.id)}
                              onCancel={() => onCancelTask(task.id)}
                              onRetry={() => onRetryTask(task)}
                            />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
