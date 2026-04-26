import { useState } from 'react';
import { X, Key, Globe, Cpu, Eye, EyeOff, Zap, FileText, RotateCcw } from 'lucide-react';
import { isElectronTarget, defaultOpenAiCompatibleBase } from '../config/app';
import { FEEDBACK_PROMPT } from './TaskPanel';
import type { Settings } from '../types';

interface Props {
  settings: Settings;
  onSave: (s: Settings) => void;
  onClose: () => void;
}

const MODELS = [
  'kimi-k2.6',
  'kimi-k2.5',
  'gpt-4o',
  'gpt-4o-mini',
  'gpt-4-turbo',
  'gpt-3.5-turbo',
  'deepseek-chat',
  'deepseek-reasoner',
  'qwen-plus',
  'qwen-turbo',
  'glm-4',
];

const PRESETS = [
  { label: 'Kimi', url: 'https://api.moonshot.cn/v1' },
  { label: 'OpenAI', url: isElectronTarget ? 'https://api.openai.com/v1' : defaultOpenAiCompatibleBase },
  { label: 'DeepSeek', url: 'https://api.deepseek.com/v1' },
  { label: '阿里百炼', url: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
  { label: '智谱 AI', url: 'https://open.bigmodel.cn/api/paas/v4' },
];

type Tab = 'ai' | 'xfyun' | 'prompt';

// 平台已托管讯飞 Key 时，不再需要用户填写
const platformXfReady = !!(
  import.meta.env.VITE_XF_APP_ID &&
  import.meta.env.VITE_XF_ACCESS_KEY_ID &&
  import.meta.env.VITE_XF_ACCESS_KEY_SECRET
);

export function SettingsModal({ settings, onSave, onClose }: Props) {
  const [form, setForm] = useState<Settings>(settings);
  const [showKey, setShowKey] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  const [tab, setTab] = useState<Tab>('ai');

  const update = (k: keyof Settings, v: string) => setForm(f => ({ ...f, [k]: v }));

  const handleSave = () => {
    onSave(form);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-[#1a2030] border border-slate-700 rounded-2xl w-full mx-4 shadow-2xl"
        style={{ maxWidth: tab === 'prompt' ? 560 : 448 }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700">
          <h2 className="font-semibold text-slate-200">设置</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200 transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Tab bar */}
        <div className="flex gap-1 px-5 pt-3">
          <button
            onClick={() => setTab('ai')}
            className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-medium transition-all ${
              tab === 'ai' ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Cpu size={11} /> AI 助手
          </button>
          {!platformXfReady && (
            <button
              onClick={() => setTab('xfyun')}
              className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-medium transition-all ${
                tab === 'xfyun' ? 'bg-sky-500/20 text-sky-300 border border-sky-500/30' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Zap size={11} /> 讯飞转写
            </button>
          )}
          <button
            onClick={() => setTab('prompt')}
            className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-medium transition-all ${
              tab === 'prompt' ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <FileText size={11} /> 反馈 Prompt
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {tab === 'ai' ? (
            <>
              {/* API Base URL */}
              <div>
                <label className="flex items-center gap-2 text-xs text-slate-400 mb-1.5 font-medium">
                  <Globe size={12} /> API 地址
                </label>
                {!isElectronTarget && (
                  <p className="text-xs text-amber-200/80 bg-amber-500/10 border border-amber-500/25 rounded-lg px-2.5 py-2 leading-relaxed">
                    网页里直连第三方会触发跨域，表现为 <span className="font-mono">Failed to fetch</span>。OpenAI/兼容接口请用同域反代
                    路径 <span className="font-mono">/openai-api/v1</span>；讯飞需反代
                    <span className="font-mono"> /xfyun-api</span>。其他厂商需你在网关自行配反代或自建 BFF。
                  </p>
                )}
                <div className="flex gap-2 flex-wrap mb-2">
                  {PRESETS.map(p => (
                    <button
                      key={p.label}
                      onClick={() => update('apiBaseUrl', p.url)}
                      className={`text-xs px-2.5 py-1 rounded-full border transition-all ${
                        form.apiBaseUrl === p.url
                          ? 'bg-indigo-500/20 border-indigo-500/50 text-indigo-300'
                          : 'bg-slate-800 border-slate-600 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
                <input
                  type="text"
                  value={form.apiBaseUrl}
                  onChange={e => update('apiBaseUrl', e.target.value)}
                  placeholder={defaultOpenAiCompatibleBase}
                  className="w-full bg-slate-800 border border-slate-600 focus:border-indigo-500 rounded-lg px-3 py-2 text-sm text-slate-200 outline-none transition-colors"
                />
              </div>

              {/* API Key */}
              <div>
                <label className="flex items-center gap-2 text-xs text-slate-400 mb-1.5 font-medium">
                  <Key size={12} /> API Key
                </label>
                <div className="relative">
                  <input
                    type={showKey ? 'text' : 'password'}
                    value={form.apiKey}
                    onChange={e => update('apiKey', e.target.value)}
                    placeholder="sk-..."
                    className="w-full bg-slate-800 border border-slate-600 focus:border-indigo-500 rounded-lg px-3 py-2 pr-10 text-sm text-slate-200 outline-none transition-colors"
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200"
                  >
                    {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>

              {/* Model */}
              <div>
                <label className="flex items-center gap-2 text-xs text-slate-400 mb-1.5 font-medium">
                  <Cpu size={12} /> 模型
                </label>
                <div className="flex gap-2 items-center">
                  <select
                    value={form.model}
                    onChange={e => update('model', e.target.value)}
                    className="flex-1 bg-slate-800 border border-slate-600 focus:border-indigo-500 rounded-lg px-3 py-2 text-sm text-slate-200 outline-none transition-colors cursor-pointer"
                  >
                    {MODELS.map(m => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                  <input
                    type="text"
                    value={form.model}
                    onChange={e => update('model', e.target.value)}
                    placeholder="自定义模型名"
                    className="flex-1 bg-slate-800 border border-slate-600 focus:border-indigo-500 rounded-lg px-3 py-2 text-sm text-slate-200 outline-none transition-colors"
                  />
                </div>
              </div>
            </>
          ) : tab === 'xfyun' ? (
            <>
              {/* iFlytek settings */}
              <div className="bg-sky-500/5 border border-sky-500/20 rounded-lg px-3 py-2.5 text-xs text-sky-300 space-y-0.5">
                <p className="font-medium">讯飞大模型录音文件转写</p>
                <p className="text-sky-400/70">
                  在 <a href="https://console.xfyun.cn/" target="_blank" rel="noreferrer" className="underline hover:text-sky-300">讯飞开放平台控制台</a> 创建应用后获取以下凭证。
                  支持 202 种方言，最长 5 小时音频。
                </p>
              </div>

              <div>
                <label className="text-xs text-slate-400 mb-1.5 font-medium block">AppID</label>
                <input
                  type="text"
                  value={form.xfAppId}
                  onChange={e => update('xfAppId', e.target.value)}
                  placeholder="如：37f3f2b5"
                  className="w-full bg-slate-800 border border-slate-600 focus:border-sky-500 rounded-lg px-3 py-2 text-sm text-slate-200 outline-none transition-colors font-mono"
                />
              </div>

              <div>
                <label className="text-xs text-slate-400 mb-1.5 font-medium block">AccessKeyID</label>
                <input
                  type="text"
                  value={form.xfAccessKeyId}
                  onChange={e => update('xfAccessKeyId', e.target.value)}
                  placeholder="32 位字符串"
                  className="w-full bg-slate-800 border border-slate-600 focus:border-sky-500 rounded-lg px-3 py-2 text-sm text-slate-200 outline-none transition-colors font-mono"
                />
              </div>

              <div>
                <label className="text-xs text-slate-400 mb-1.5 font-medium block">AccessKeySecret</label>
                <div className="relative">
                  <input
                    type={showSecret ? 'text' : 'password'}
                    value={form.xfAccessKeySecret}
                    onChange={e => update('xfAccessKeySecret', e.target.value)}
                    placeholder="32 位字符串"
                    className="w-full bg-slate-800 border border-slate-600 focus:border-sky-500 rounded-lg px-3 py-2 pr-10 text-sm text-slate-200 outline-none transition-colors font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowSecret(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200"
                  >
                    {showSecret ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>

              <p className="text-xs text-slate-500">
                凭证仅保存在本地浏览器中，不会上传到任何服务器。
              </p>
            </>
          ) : tab === 'prompt' ? (
            <>
              <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-lg px-3 py-2.5 text-xs text-emerald-300 space-y-1">
                <p className="font-medium">自定义课堂反馈 Prompt</p>
                <p className="text-emerald-400/70 leading-relaxed">
                  此 Prompt 将发送给 AI，控制反馈的格式、风格和重点。支持所有任务（工作台单次生成 + AI 助手批量生成）。
                </p>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs text-slate-400 font-medium">Prompt 内容</label>
                  <button
                    onClick={() => update('feedbackPrompt', FEEDBACK_PROMPT)}
                    className="flex items-center gap-1 text-xs text-slate-500 hover:text-emerald-400 transition-colors"
                    title="恢复默认 Prompt"
                  >
                    <RotateCcw size={10} /> 恢复默认
                  </button>
                </div>
                <textarea
                  value={form.feedbackPrompt ?? FEEDBACK_PROMPT}
                  onChange={e => update('feedbackPrompt', e.target.value)}
                  rows={12}
                  className="w-full bg-slate-800 border border-slate-600 focus:border-emerald-500 rounded-lg px-3 py-2.5 text-xs text-slate-200 outline-none transition-colors resize-none leading-relaxed font-mono"
                  spellCheck={false}
                />
                <p className="text-xs text-slate-500 mt-1">
                  {(form.feedbackPrompt ?? FEEDBACK_PROMPT).length} 字符 · 课堂转写内容将自动追加在此 Prompt 之后
                </p>
              </div>
            </>
          ) : null}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 px-5 py-4 border-t border-slate-700">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-slate-400 hover:text-slate-200 transition-colors"
          >
            取消
          </button>
          <button
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
