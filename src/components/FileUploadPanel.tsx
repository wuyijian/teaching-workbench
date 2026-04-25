import { useRef, useState, useCallback } from 'react';
import { Upload, FileAudio, X, Copy, Check, Trash2, Loader2, CheckCircle, AlertCircle, Zap, Cpu } from 'lucide-react';
import type { TranscriptSegment, TranscribeEngine } from '../types';
import type { TranscribeStatus } from '../hooks/useFileTranscription';
import type { XfyunStatus } from '../hooks/useXfyunTranscription';

interface Props {
  // Whisper
  whisperStatus: TranscribeStatus;
  whisperProgress: number;
  whisperSegments: TranscriptSegment[];
  whisperError: string | null;
  whisperFileName: string | null;
  onWhisperTranscribe: (file: File) => void;
  onWhisperReset: () => void;
  // iFlytek
  xfStatus: XfyunStatus;
  xfProgress: number;
  xfSegments: TranscriptSegment[];
  xfError: string | null;
  xfFileName: string | null;
  xfEstimateMs: number | null;
  onXfTranscribe: (file: File) => void;
  onXfReset: () => void;
  // shared
  language: string;
  hasXfCredentials: boolean;
}

const ACCEPTED = '.mp3,.mp4,.wav,.m4a,.ogg,.webm,.flac,.aac,.mpeg,.mpga';
const MAX_MB = 25;

function formatTimestamp(seconds: number) {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = (seconds % 60).toString().padStart(2, '0');
  return `[${m}:${s}]`;
}

export function FileUploadPanel({
  whisperStatus, whisperProgress, whisperSegments, whisperError, whisperFileName,
  onWhisperTranscribe, onWhisperReset,
  xfStatus, xfProgress, xfSegments, xfError, xfFileName, xfEstimateMs,
  onXfTranscribe, onXfReset,
  language, hasXfCredentials,
}: Props) {
  const [engine, setEngine] = useState<TranscribeEngine>(hasXfCredentials ? 'xfyun' : 'whisper');
  const [dragging, setDragging] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const isXf = engine === 'xfyun';
  const status = isXf ? xfStatus : whisperStatus;
  const progress = isXf ? xfProgress : whisperProgress;
  const segments = isXf ? xfSegments : whisperSegments;
  const apiError = isXf ? xfError : whisperError;
  const currentFileName = isXf ? xfFileName : whisperFileName;
  const onTranscribe = isXf ? onXfTranscribe : onWhisperTranscribe;
  const onReset = isXf ? onXfReset : onWhisperReset;

  const isActive = status === 'uploading' || status === 'transcribing';

  const handleFile = useCallback((file: File) => {
    setFileError(null);
    if (!isXf && file.size > MAX_MB * 1024 * 1024) {
      setFileError(`Whisper API 限制最大 ${MAX_MB}MB，请压缩后重试`);
      return;
    }
    onTranscribe(file);
  }, [isXf, onTranscribe]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = '';
  };

  const handleCopy = () => {
    const text = segments.map(s => `${formatTimestamp(s.timestamp)} ${s.text}`).join('\n');
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleEngineChange = (e: TranscribeEngine) => {
    // 切换引擎时重置当前状态
    if (isXf) onXfReset(); else onWhisperReset();
    setFileError(null);
    setEngine(e);
  };

  const statusText = status === 'uploading' ? '上传中…' : status === 'transcribing' ? '转写中，请稍候…' : '';

  return (
    <div className="flex flex-col h-full">
      {/* Engine selector */}
      <div className="mx-1 mt-1 flex items-center gap-2 px-1">
        <span className="text-xs text-slate-500 shrink-0">转写引擎</span>
        <div className="flex gap-1.5 bg-slate-800/60 rounded-lg p-0.5">
          <button
            onClick={() => handleEngineChange('xfyun')}
            disabled={isActive}
            className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md font-medium transition-all disabled:opacity-50 ${
              isXf ? 'bg-sky-500/20 text-sky-300 border border-sky-500/30' : 'text-slate-400 hover:text-slate-300'
            }`}
          >
            <Zap size={11} />
            讯飞大模型
            {!hasXfCredentials && <span className="text-amber-400 text-[10px]">需配置</span>}
          </button>
          <button
            onClick={() => handleEngineChange('whisper')}
            disabled={isActive}
            className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md font-medium transition-all disabled:opacity-50 ${
              !isXf ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30' : 'text-slate-400 hover:text-slate-300'
            }`}
          >
            <Cpu size={11} />
            Whisper
          </button>
        </div>
        <span className="text-[10px] text-slate-600 ml-auto">
          {isXf ? '支持 202 种方言 · 最长 5h' : '最大 25MB · 多语言'}
        </span>
      </div>

      {/* Drop zone / file info */}
      {status === 'idle' || status === 'error' ? (
        <div
          className={`mx-1 mt-2 rounded-xl border-2 border-dashed transition-all cursor-pointer ${
            dragging ? 'border-sky-500 bg-sky-500/10' : 'border-slate-600 hover:border-slate-500 hover:bg-slate-800/30'
          }`}
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
        >
          <div className="flex flex-col items-center justify-center py-6 gap-2 select-none">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center ${dragging ? 'bg-sky-500/20' : 'bg-slate-700/60'}`}>
              <Upload size={20} className={dragging ? 'text-sky-400' : 'text-slate-400'} />
            </div>
            <div className="text-center">
              <p className="text-sm text-slate-300 font-medium">拖拽音频或点击选择</p>
              <p className="text-xs text-slate-500 mt-0.5">
                {isXf ? 'MP3 · WAV · M4A · FLAC 等，最大 500MB' : 'MP3 · WAV · M4A · OGG 等，最大 25MB'}
              </p>
            </div>
          </div>
          <input ref={inputRef} type="file" accept={ACCEPTED} className="hidden" onChange={handleInputChange} />
        </div>
      ) : (
        <div className="mx-1 mt-2 flex items-center gap-3 bg-slate-800/60 rounded-xl px-4 py-3 border border-slate-700/50">
          <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${isXf ? 'bg-sky-500/15' : 'bg-indigo-500/15'}`}>
            <FileAudio size={18} className={isXf ? 'text-sky-400' : 'text-indigo-400'} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm text-slate-200 truncate font-medium">{currentFileName}</p>
            <div className="flex items-center gap-2 mt-0.5">
              {isActive && (
                <>
                  <div className="flex-1 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${isXf ? 'bg-sky-500' : 'bg-indigo-500'}`}
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  <span className="text-xs text-slate-400 shrink-0">{progress}%</span>
                  {isXf && xfEstimateMs && (
                    <span className="text-xs text-slate-500">预计 {Math.ceil(xfEstimateMs / 1000)}s</span>
                  )}
                </>
              )}
              {status === 'done' && (
                <span className="flex items-center gap-1 text-xs text-emerald-400">
                  <CheckCircle size={11} /> 转写完成
                </span>
              )}
            </div>
          </div>
          <button onClick={onReset} className="text-slate-500 hover:text-slate-300 transition-colors">
            <X size={16} />
          </button>
        </div>
      )}

      {/* Errors */}
      {(apiError || fileError) && (
        <div className="mx-1 mt-2 flex items-start gap-2 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
          <AlertCircle size={14} className="text-red-400 mt-0.5 shrink-0" />
          <p className="text-xs text-red-400">{apiError || fileError}</p>
        </div>
      )}

      {/* Loading */}
      {isActive && (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-slate-400">
          <Loader2 size={28} className={`animate-spin ${isXf ? 'text-sky-400' : 'text-indigo-400'}`} />
          <p className="text-sm">{statusText}</p>
          <p className="text-xs text-slate-500">
            {isXf ? `讯飞大模型 · ${language} · 教育领域优化` : `Whisper · ${language}`}
          </p>
        </div>
      )}

      {/* Transcript results */}
      {status === 'done' && segments.length > 0 && (
        <>
          <div className="flex items-center justify-between px-3 pt-3 pb-1">
            <span className="text-xs text-slate-400 font-medium">
              转写结果 · {segments.length} 段 · {segments.reduce((n, s) => n + s.text.length, 0)} 字
            </span>
            <div className="flex gap-1">
              <button onClick={handleCopy} className="p-1.5 rounded-md hover:bg-slate-700 text-slate-400 hover:text-slate-200 transition-colors">
                {copied ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
              </button>
              <button onClick={onReset} className="p-1.5 rounded-md hover:bg-slate-700 text-slate-400 hover:text-red-400 transition-colors">
                <Trash2 size={13} />
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto scrollbar-thin px-3 pb-3 space-y-2 min-h-0">
            {segments.map(seg => (
              <div key={seg.id} className="flex gap-2">
                <span className="text-xs text-slate-500 font-mono shrink-0 pt-0.5">
                  {formatTimestamp(seg.timestamp)}
                </span>
                <p className="text-sm text-slate-200 leading-relaxed">{seg.text}</p>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
        </>
      )}

      {status === 'idle' && (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-xs text-slate-600 text-center px-4">
            {isXf
              ? '讯飞大模型 · 支持 202 种方言 · 教育领域优化\n需在设置中配置讯飞凭证'
              : '调用 Whisper API 转写\n需在设置中配置 API Key'}
          </p>
        </div>
      )}
    </div>
  );
}
