import { useRef, useState, useCallback } from 'react';
import { usePasteFile } from '../hooks/usePasteFile';
import { Upload, FileAudio, X, Copy, Check, Trash2, Loader2, CheckCircle, AlertCircle } from 'lucide-react';
import type { TranscriptSegment } from '../types';
import type { XfyunStatus } from '../hooks/useXfyunTranscription';
import { pickAudioFileViaElectron } from '../config/app';

interface Props {
  xfStatus: XfyunStatus;
  xfProgress: number;
  xfSegments: TranscriptSegment[];
  xfError: string | null;
  xfFileName: string | null;
  xfEstimateMs: number | null;
  onXfTranscribe: (file: File) => void;
  onXfReset: () => void;
  language: string;
  hasXfCredentials: boolean;
}

const ACCEPTED = '.mp3,.mp4,.wav,.m4a,.ogg,.webm,.flac,.aac,.mpeg,.mpga';

function formatTimestamp(seconds: number) {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = (seconds % 60).toString().padStart(2, '0');
  return `[${m}:${s}]`;
}

export function FileUploadPanel({
  xfStatus, xfProgress, xfSegments, xfError, xfFileName, xfEstimateMs,
  onXfTranscribe, onXfReset,
  language, hasXfCredentials,
}: Props) {
  const [dragging, setDragging] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const isElectron = !!window.electronAPI;
  const isActive = xfStatus === 'uploading' || xfStatus === 'transcribing';

  const handleFile = useCallback((file: File) => {
    setFileError(null);
    onXfTranscribe(file);
  }, [onXfTranscribe]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  usePasteFile(handleFile, !isActive);

  const openFilePicker = useCallback(async () => {
    if (isElectron) {
      const file = await pickAudioFileViaElectron(setFileError);
      if (file) handleFile(file);
    } else {
      inputRef.current?.click();
    }
  }, [isElectron, handleFile]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = '';
  };

  const handleCopy = () => {
    const text = xfSegments.map(s => `${formatTimestamp(s.timestamp)} ${s.text}`).join('\n');
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Drop zone / file info */}
      {xfStatus === 'idle' || xfStatus === 'error' ? (
        <div
          className={`relative mx-1 mt-2 rounded-xl border-2 border-dashed transition-all cursor-pointer ${
            dragging ? 'border-sky-500 bg-sky-500/10' : 'border-slate-600 hover:border-slate-500 hover:bg-slate-800/30'
          }`}
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={openFilePicker}
        >
          <div className="flex flex-col items-center justify-center py-6 gap-2 select-none pointer-events-none">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center ${dragging ? 'bg-sky-500/20' : 'bg-slate-700/60'}`}>
              <Upload size={20} className={dragging ? 'text-sky-400' : 'text-slate-400'} />
            </div>
            <div className="text-center">
              <p className="text-sm text-slate-300 font-medium">拖拽 · 点击 · 或 ⌘V 粘贴</p>
              <p className="text-xs text-slate-500 mt-0.5">MP3 · WAV · M4A · FLAC 等，最大 500MB</p>
            </div>
          </div>
          {!isElectron && (
            <input
              ref={inputRef}
              type="file"
              accept={ACCEPTED}
              onChange={handleInputChange}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            />
          )}
        </div>
      ) : (
        <div className="mx-1 mt-2 flex items-center gap-3 bg-slate-800/60 rounded-xl px-4 py-3 border border-slate-700/50">
          <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 bg-sky-500/15">
            <FileAudio size={18} className="text-sky-400" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm text-slate-200 truncate font-medium">{xfFileName}</p>
            <div className="flex items-center gap-2 mt-0.5">
              {isActive && (
                <>
                  <div className="flex-1 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all duration-500 bg-sky-500" style={{ width: `${xfProgress}%` }} />
                  </div>
                  <span className="text-xs text-slate-400 shrink-0">{xfProgress}%</span>
                  {xfEstimateMs && (
                    <span className="text-xs text-slate-500">预计 {Math.ceil(xfEstimateMs / 1000)}s</span>
                  )}
                </>
              )}
              {xfStatus === 'done' && (
                <span className="flex items-center gap-1 text-xs text-emerald-400">
                  <CheckCircle size={11} /> 转写完成
                </span>
              )}
            </div>
          </div>
          <button onClick={onXfReset} className="text-slate-500 hover:text-slate-300 transition-colors">
            <X size={16} />
          </button>
        </div>
      )}

      {/* Errors */}
      {(xfError || fileError) && (
        <div className="mx-1 mt-2 flex items-start gap-2 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
          <AlertCircle size={14} className="text-red-400 mt-0.5 shrink-0" />
          <p className="text-xs text-red-400">{xfError || fileError}</p>
        </div>
      )}

      {/* Loading */}
      {isActive && (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-slate-400">
          <Loader2 size={28} className="animate-spin text-sky-400" />
          <p className="text-sm">{xfStatus === 'uploading' ? '上传中…' : '转写中，请稍候…'}</p>
          <p className="text-xs text-slate-500">讯飞大模型 · {language} · 教育领域优化</p>
        </div>
      )}

      {/* Transcript results */}
      {xfStatus === 'done' && xfSegments.length > 0 && (
        <>
          <div className="flex items-center justify-between px-3 pt-3 pb-1">
            <span className="text-xs text-slate-400 font-medium">
              转写结果 · {xfSegments.length} 段 · {xfSegments.reduce((n, s) => n + s.text.length, 0)} 字
            </span>
            <div className="flex gap-1">
              <button onClick={handleCopy} className="p-1.5 rounded-md hover:bg-slate-700 text-slate-400 hover:text-slate-200 transition-colors">
                {copied ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
              </button>
              <button onClick={onXfReset} className="p-1.5 rounded-md hover:bg-slate-700 text-slate-400 hover:text-red-400 transition-colors">
                <Trash2 size={13} />
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto scrollbar-thin px-3 pb-3 space-y-2 min-h-0">
            {xfSegments.map(seg => (
              <div key={seg.id} className="flex gap-2">
                <span className="text-xs text-slate-500 font-mono shrink-0 pt-0.5">{formatTimestamp(seg.timestamp)}</span>
                <p className="text-sm text-slate-200 leading-relaxed">{seg.text}</p>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
        </>
      )}

      {xfStatus === 'idle' && (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-xs text-slate-600 text-center px-4">
            {hasXfCredentials
              ? '讯飞大模型 · 支持 202 种方言 · 教育领域优化'
              : '转写服务需由部署方配置 VITE_XF_* 环境变量'}
          </p>
        </div>
      )}
    </div>
  );
}
