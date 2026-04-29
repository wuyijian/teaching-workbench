import { useState } from 'react';
import { X, FileText, RotateCcw, Key, ChevronDown, ChevronUp, AlertTriangle } from 'lucide-react';
import { FEEDBACK_PROMPT } from './TaskPanel';
import type { Settings } from '../types';
import { hasPlatformLlm, getPlatformLlmApiKey, getPlatformLlmBaseUrl, getPlatformLlmModel } from '../config/platformApi';

interface Props {
  settings: Settings;
  onSave: (s: Settings & { userApiKey?: string; userApiBaseUrl?: string; userModel?: string }) => void;
  onClose: () => void;
}

const KIMI_BASE = 'https://api.moonshot.cn/v1';
const KIMI_MODEL = 'kimi-k2.5';

/** 从 localStorage 读取用户手填的 LLM 配置 */
function loadUserLlmPrefs() {
  try {
    const raw = localStorage.getItem('tw-settings');
    if (!raw) return { userApiKey: '', userApiBaseUrl: '', userModel: '' };
    const p = JSON.parse(raw) as { userApiKey?: string; userApiBaseUrl?: string; userModel?: string };
    return {
      userApiKey:     p.userApiKey     ?? '',
      userApiBaseUrl: p.userApiBaseUrl ?? '',
      userModel:      p.userModel      ?? '',
    };
  } catch {
    return { userApiKey: '', userApiBaseUrl: '', userModel: '' };
  }
}

export function SettingsModal({ settings, onSave, onClose }: Props) {
  const [feedbackPrompt, setFeedbackPrompt] = useState(
    () => settings.feedbackPrompt ?? FEEDBACK_PROMPT,
  );

  // LLM 用户自填（env var 为空时才实际生效）
  const userLlm = loadUserLlmPrefs();
  const [userApiKey,     setUserApiKey]     = useState(userLlm.userApiKey);
  const [userApiBaseUrl, setUserApiBaseUrl] = useState(userLlm.userApiBaseUrl || KIMI_BASE);
  const [userModel,      setUserModel]      = useState(userLlm.userModel      || KIMI_MODEL);
  const [llmExpanded,    setLlmExpanded]    = useState(!hasPlatformLlm()); // 未配置时默认展开

  const envHasKey = !!getPlatformLlmApiKey();

  const handleSave = () => {
    const prompt = feedbackPrompt === FEEDBACK_PROMPT ? undefined : feedbackPrompt;
    onSave({
      ...settings,
      feedbackPrompt: prompt,
      userApiKey:     userApiKey.trim(),
      userApiBaseUrl: userApiBaseUrl.trim(),
      userModel:      userModel.trim(),
    });
    onClose();
  };

  const inputCls = 'w-full bg-slate-800 border border-slate-600 focus:border-indigo-500 rounded-lg px-3 py-2 text-xs text-slate-200 outline-none transition-colors font-mono';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-[#1a2030] border border-slate-700 rounded-2xl w-full mx-4 shadow-2xl flex flex-col"
        style={{ maxWidth: 560, maxHeight: '90vh' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700 shrink-0">
          <h2 className="font-semibold text-slate-200">设置</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200 transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-5 overflow-y-auto">

          {/* ── LLM API 配置 ── */}
          <div className="border border-slate-700 rounded-xl overflow-hidden">
            {/* 折叠标题 */}
            <button
              type="button"
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-800/50 transition-colors"
              onClick={() => setLlmExpanded(v => !v)}
            >
              <div className="flex items-center gap-2">
                <Key size={13} className={envHasKey ? 'text-emerald-400' : 'text-amber-400'} />
                <span className="text-sm font-medium text-slate-200">大模型 API 配置</span>
                {envHasKey ? (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                    服务端已配置
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">
                    <AlertTriangle size={9} /> 未配置
                  </span>
                )}
              </div>
              {llmExpanded ? <ChevronUp size={14} className="text-slate-500" /> : <ChevronDown size={14} className="text-slate-500" />}
            </button>

            {llmExpanded && (
              <div className="px-4 pb-4 space-y-3 border-t border-slate-700/50">
                {envHasKey ? (
                  <p className="text-xs text-slate-500 pt-3 leading-relaxed">
                    服务端已通过环境变量注入 API Key（
                    <span className="font-mono text-slate-400">{getPlatformLlmBaseUrl()}</span>
                    ），下方填写将被忽略。如需调试，可在此临时覆盖。
                  </p>
                ) : (
                  <p className="text-xs text-amber-400/70 pt-3 leading-relaxed">
                    服务端未配置大模型 Key，请在此填写你自己的 API Key，仅保存在本地。
                  </p>
                )}

                <div>
                  <label className="block text-xs text-slate-400 mb-1">API Key</label>
                  <input
                    type="password"
                    value={userApiKey}
                    onChange={e => setUserApiKey(e.target.value)}
                    placeholder="sk-..."
                    className={inputCls}
                  />
                </div>

                <div>
                  <label className="block text-xs text-slate-400 mb-1">Base URL</label>
                  <input
                    type="text"
                    value={userApiBaseUrl}
                    onChange={e => setUserApiBaseUrl(e.target.value)}
                    placeholder={KIMI_BASE}
                    className={inputCls}
                  />
                  <p className="text-[10px] text-slate-600 mt-1">
                    Kimi: {KIMI_BASE} · OpenAI: https://api.openai.com/v1
                  </p>
                </div>

                <div>
                  <label className="block text-xs text-slate-400 mb-1">模型</label>
                  <input
                    type="text"
                    value={userModel}
                    onChange={e => setUserModel(e.target.value)}
                    placeholder={KIMI_MODEL}
                    className={inputCls}
                  />
                  <p className="text-[10px] text-slate-600 mt-1">
                    Kimi: kimi-k2.5 · OpenAI: gpt-4o
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* ── 课堂反馈 Prompt ── */}
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
              rows={10}
              className="w-full bg-slate-800 border border-slate-600 focus:border-emerald-500 rounded-lg px-3 py-2.5 text-xs text-slate-200 outline-none transition-colors resize-none leading-relaxed font-mono"
              spellCheck={false}
            />
            <p className="text-xs text-slate-500 mt-1">
              {feedbackPrompt.length} 字符 · 课堂转写内容将自动追加在此 Prompt 之后
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 px-5 py-4 border-t border-slate-700 shrink-0">
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
