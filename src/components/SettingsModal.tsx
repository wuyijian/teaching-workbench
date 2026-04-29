import { useState } from 'react';
import { X, FileText, RotateCcw } from 'lucide-react';
import { FEEDBACK_PROMPT } from './TaskPanel';
import type { Settings } from '../types';

interface Props {
  settings: Settings;
  onSave: (s: Settings) => void;
  onClose: () => void;
}

export function SettingsModal({ settings, onSave, onClose }: Props) {
  const [feedbackPrompt, setFeedbackPrompt] = useState(
    () => settings.feedbackPrompt ?? FEEDBACK_PROMPT,
  );

  const handleSave = () => {
    onSave({ ...settings, feedbackPrompt: feedbackPrompt === FEEDBACK_PROMPT ? undefined : feedbackPrompt });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-[#1a2030] border border-slate-700 rounded-2xl w-full mx-4 shadow-2xl flex flex-col"
        style={{ maxWidth: 560, maxHeight: '90vh' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700 shrink-0">
          <h2 className="font-semibold text-slate-200">设置</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200 transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4 overflow-y-auto">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="flex items-center gap-1.5 text-xs text-slate-400 font-medium">
                <FileText size={12} /> 课堂反馈 Prompt
              </label>
              <button
                type="button"
                onClick={() => setFeedbackPrompt(FEEDBACK_PROMPT)}
                className="flex items-center gap-1 text-xs text-slate-500 hover:text-emerald-400 transition-colors"
                title="恢复默认 Prompt"
              >
                <RotateCcw size={10} /> 恢复默认
              </button>
            </div>
            <textarea
              value={feedbackPrompt}
              onChange={e => setFeedbackPrompt(e.target.value)}
              rows={12}
              className="w-full bg-slate-800 border border-slate-600 focus:border-emerald-500 rounded-lg px-3 py-2.5 text-xs text-slate-200 outline-none transition-colors resize-none leading-relaxed font-mono"
              spellCheck={false}
            />
            <p className="text-xs text-slate-500 mt-1">
              {feedbackPrompt.length} 字符 · 课堂转写内容将自动追加在此 Prompt 之后
            </p>
          </div>
        </div>

        <div className="flex justify-end gap-3 px-5 py-4 border-t border-slate-700 shrink-0">
          <button type="button" onClick={onClose}
            className="px-4 py-2 text-sm text-slate-400 hover:text-slate-200 transition-colors">
            取消
          </button>
          <button type="button" onClick={handleSave}
            className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm rounded-lg transition-colors font-medium">
            保存
          </button>
        </div>
      </div>
    </div>
  );
}
