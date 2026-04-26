import type { TranscriptSegment } from '../types';
import { FileUploadPanel } from './FileUploadPanel';
import type { XfyunStatus } from '../hooks/useXfyunTranscription';
import { FileAudio } from 'lucide-react';

interface Props {
  xfStatus: XfyunStatus;
  xfProgress: number;
  xfSegments: TranscriptSegment[];
  xfError: string | null;
  xfFileName: string | null;
  xfEstimateMs: number | null;
  onXfTranscribe: (file: File) => void;
  onXfReset: () => void;
  hasXfCredentials: boolean;
  language: string;
  onLanguageChange: (lang: string) => void;
}

const LANGUAGES = [
  { value: 'zh-CN', label: '普通话' },
  { value: 'zh-TW', label: '繁体中文' },
  { value: 'en-US', label: 'English' },
  { value: 'ja-JP', label: '日本語' },
];

export function RecordingPanel({
  xfStatus, xfProgress, xfSegments, xfError, xfFileName, xfEstimateMs,
  onXfTranscribe, onXfReset, hasXfCredentials,
  language, onLanguageChange,
}: Props) {
  return (
    <div className="flex flex-col h-full bg-[#141820] rounded-xl border border-slate-700/50">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700/50">
        <div className="flex items-center gap-2">
          <FileAudio size={15} className="text-slate-400" />
          <span className="text-sm font-semibold text-slate-200">音频转写</span>
        </div>
        <select
          value={language}
          onChange={e => onLanguageChange(e.target.value)}
          className="text-xs bg-slate-800 border border-slate-600 rounded-md px-2 py-1 text-slate-300 cursor-pointer"
        >
          {LANGUAGES.map(l => (
            <option key={l.value} value={l.value}>{l.label}</option>
          ))}
        </select>
      </div>

      <div className="flex-1 min-h-0 flex flex-col">
        <FileUploadPanel
          xfStatus={xfStatus}
          xfProgress={xfProgress}
          xfSegments={xfSegments}
          xfError={xfError}
          xfFileName={xfFileName}
          xfEstimateMs={xfEstimateMs}
          onXfTranscribe={onXfTranscribe}
          onXfReset={onXfReset}
          language={language}
          hasXfCredentials={hasXfCredentials}
        />
      </div>
    </div>
  );
}
