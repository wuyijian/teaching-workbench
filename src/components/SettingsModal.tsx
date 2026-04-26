import { useState } from 'react';
import { X, FileText, RotateCcw } from 'lucide-react';
import { FEEDBACK_PROMPT } from './TaskPanel';
import type { Settings } from '../types';

interface Props {
  settings: Settings;
  onSave: (s: Settings) => void;
  onClose: () => void;
}

/**
 * 仅用户可改项：课堂反馈 Prompt。
 * LLM、讯飞 等由部署环境 VITE_LLM_* / VITE_XF_* 统一配置，不在此暴露。
 */
export function SettingsModal({ settings, onSave, onClose }: Props) {
  const [feedbackPrompt, setFeedbackPrompt] = useState(
    () => settings.feedbackPrompt ?? FEEDBACK_PROMPT,
  );

  const handleSave = () => {
    onSave(mergeWithPrefs(settings, feedbackPrompt));
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-[#1a2030] border border-slate-700 rounded-2xl w-full mx-4 shadow-2xl"
        style={{ maxWidth: 560 }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700">
          <h2 className="font-semibold text-slate-200">设置</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200 transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-lg px-3 py-2.5 text-xs text-emerald-300 space-y-1">
            <p className="font-medium">自定义课堂反馈 Prompt</p>
            <p className="text-emerald-400/70 leading-relaxed">
              大模型与讯飞转写由服务端配置，无需在此填写 Key。本页仅可调整反馈文案模板。
            </p>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="flex items-center gap-1.5 text-xs text-slate-400 font-medium">
                <FileText size={12} /> Prompt 内容
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

        <div className="flex justify-end gap-3 px-5 py-4 border-t border-slate-700">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm text-slate-400 hover:text-slate-200 transition-colors"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm rounded-lg transition-colors font-medium"
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
}

function mergeWithPrefs(s: Settings, feedbackPrompt: string): Settings {
  return { ...s, feedbackPrompt: feedbackPrompt === FEEDBACK_PROMPT ? undefined : feedbackPrompt };
}
