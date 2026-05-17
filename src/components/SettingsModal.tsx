import { useState, useRef, useEffect, useCallback } from 'react';
import { X, FileText, RotateCcw, Bot, Wifi, WifiOff, Plus, Trash2, Pencil, Check } from 'lucide-react';
import { FEEDBACK_PROMPT } from './TaskPanel';
import type { Settings } from '../types';
import { getAllParentContacts, setParentContact, deleteParentContact } from '../utils/wechat';
import type { ParentContact } from '../utils/wechat';

interface Props {
  settings: Settings;
  onSave: (s: Settings) => void;
  onClose: () => void;
  /** If true, auto-scroll to WeChat config section on open */
  openAtWechat?: boolean;
}

type BotStatus = 'idle' | 'checking' | 'ok' | 'err';

export function SettingsModal({ settings, onSave, onClose, openAtWechat }: Props) {
  const [feedbackPrompt, setFeedbackPrompt] = useState(
    () => settings.feedbackPrompt ?? FEEDBACK_PROMPT,
  );
  const [enableKnowledgeBase, setEnableKnowledgeBase] = useState(
    () => settings.enableKnowledgeBase ?? true,
  );

  // ── WeChat state ──────────────────────────────────────────────────────────
  const [botStatus, setBotStatus] = useState<BotStatus>('idle');
  const [botErrMsg, setBotErrMsg] = useState('');
  const [contacts, setContacts] = useState<ParentContact[]>(() => getAllParentContacts());
  const [newStudent, setNewStudent] = useState('');
  const [newWechat, setNewWechat] = useState('');
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editWechat, setEditWechat] = useState('');

  const wechatRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (openAtWechat && wechatRef.current && scrollAreaRef.current) {
      const timeout = setTimeout(() => {
        wechatRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 80);
      return () => clearTimeout(timeout);
    }
  }, [openAtWechat]);

  const handleSave = () => {
    onSave({
      ...settings,
      feedbackPrompt: feedbackPrompt === FEEDBACK_PROMPT ? undefined : feedbackPrompt,
      enableKnowledgeBase,
    });
    onClose();
  };

  // ── Bot connection test ───────────────────────────────────────────────────
  const handleTestBot = useCallback(async () => {
    setBotStatus('checking');
    setBotErrMsg('');
    try {
      const resp = await fetch('/wechat-agent/health', { signal: AbortSignal.timeout(5000) });
      if (resp.ok) {
        setBotStatus('ok');
      } else {
        setBotStatus('err');
        setBotErrMsg(`HTTP ${resp.status}`);
      }
    } catch (e: unknown) {
      setBotStatus('err');
      setBotErrMsg(e instanceof Error ? e.message : '连接失败');
    }
  }, []);

  // ── Contact CRUD ──────────────────────────────────────────────────────────
  const handleAddContact = () => {
    const s = newStudent.trim();
    const w = newWechat.trim();
    if (!s || !w) return;
    setParentContact(s, w);
    setContacts(getAllParentContacts());
    setNewStudent('');
    setNewWechat('');
  };

  const handleDeleteContact = (studentName: string) => {
    deleteParentContact(studentName);
    setContacts(getAllParentContacts());
    if (editingKey === studentName) setEditingKey(null);
  };

  const handleStartEdit = (c: ParentContact) => {
    setEditingKey(c.studentName);
    setEditWechat(c.wechatName);
  };

  const handleSaveEdit = (studentName: string) => {
    if (editWechat.trim()) {
      setParentContact(studentName, editWechat.trim());
      setContacts(getAllParentContacts());
    }
    setEditingKey(null);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
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

        {/* Scrollable body */}
        <div ref={scrollAreaRef} className="px-5 py-4 space-y-4 overflow-y-auto">
          {/* Knowledge base toggle */}
          <div>
            <div className="flex items-center justify-between mb-2 rounded-lg border border-slate-700 bg-slate-800/70 px-3 py-2">
              <div>
                <p className="text-xs text-slate-200 font-medium">启用知识库参考</p>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  生成反馈/分析时自动拼入杭州语文教研资料摘要
                </p>
              </div>
              <label className="inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={enableKnowledgeBase}
                  onChange={e => setEnableKnowledgeBase(e.target.checked)}
                  className="sr-only"
                />
                <span
                  className={`w-10 h-5 rounded-full relative transition-colors ${enableKnowledgeBase ? 'bg-emerald-500' : 'bg-slate-600'}`}
                >
                  <span
                    className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${enableKnowledgeBase ? 'translate-x-5' : 'translate-x-0.5'}`}
                  />
                </span>
              </label>
            </div>

            {/* Feedback prompt */}
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

          {/* ── WeChat Config Section ─────────────────────────────────────── */}
          <div ref={wechatRef} className="rounded-xl border border-slate-700 overflow-hidden">
            {/* Section header */}
            <div className="flex items-center gap-2 px-3 py-2.5 bg-slate-800/60 border-b border-slate-700">
              <Bot size={13} className="text-[#07C160]" />
              <span className="text-xs font-semibold text-slate-200">微信配置</span>
            </div>

            <div className="px-3 py-3 space-y-4">
              {/* Bot status row */}
              <div>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-slate-300 font-medium">微信机器人（ClawBot）</p>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      通过 ClawBot 自动发送反馈消息给家长
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {botStatus !== 'idle' && (
                      <span className={`flex items-center gap-1 text-[11px] font-medium ${
                        botStatus === 'ok' ? 'text-emerald-400' :
                        botStatus === 'checking' ? 'text-slate-400' :
                        'text-red-400'
                      }`}>
                        {botStatus === 'ok'
                          ? <><Wifi size={11} /> 已连接</>
                          : botStatus === 'checking'
                          ? <span className="animate-pulse">检测中…</span>
                          : <><WifiOff size={11} /> 未连接</>}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={handleTestBot}
                      disabled={botStatus === 'checking'}
                      className="px-2.5 py-1 text-[11px] rounded-md border border-slate-600 text-slate-300 hover:border-slate-500 hover:text-slate-100 transition-colors disabled:opacity-50"
                    >
                      测试连接
                    </button>
                  </div>
                </div>
                {botStatus === 'err' && (
                  <div className="mt-2 rounded-lg px-3 py-2 bg-red-950/40 border border-red-800/40 text-[11px] text-red-400">
                    {botErrMsg && <span className="font-mono mr-1.5">({botErrMsg})</span>}
                    请确认 ClawBot 已在手机微信中激活，并联系管理员
                  </div>
                )}
              </div>

              {/* Parent contacts */}
              <div>
                <div className="mb-2">
                  <p className="text-xs text-slate-400 font-medium">家长联系人绑定</p>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    填入该学生在 ClawBot 微信通讯录中显示的<span className="text-slate-400 font-medium">备注名或昵称</span>（发送时将匹配此名称）
                  </p>
                </div>

                {contacts.length === 0 && (
                  <div className="rounded-lg px-3 py-2.5 bg-amber-950/30 border border-amber-800/30 mb-2">
                    <p className="text-[11px] text-amber-400 font-medium">尚未添加任何家长联系人</p>
                    <p className="text-[11px] text-amber-500/80 mt-0.5">
                      添加绑定后，点击「同步微信」才能自动将反馈发送给对应家长。
                    </p>
                  </div>
                )}

                {contacts.length > 0 && (
                  <div className="rounded-lg border border-slate-700 overflow-hidden mb-2">
                    {/* Table header */}
                    <div className="grid grid-cols-[1fr_1fr_56px] text-[10px] text-slate-500 bg-slate-800/80 px-3 py-1.5 border-b border-slate-700">
                      <span>学生姓名</span>
                      <span>家长微信备注名 / 昵称</span>
                      <span />
                    </div>
                    {contacts.map((c, idx) => (
                      <div
                        key={c.studentName}
                        className={`grid grid-cols-[1fr_1fr_56px] items-center px-3 py-1.5 text-xs ${
                          idx < contacts.length - 1 ? 'border-b border-slate-700/60' : ''
                        }`}
                      >
                        <span className="text-slate-300 truncate">{c.studentName}</span>
                        {editingKey === c.studentName ? (
                          <input
                            autoFocus
                            value={editWechat}
                            onChange={e => setEditWechat(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') handleSaveEdit(c.studentName);
                              if (e.key === 'Escape') setEditingKey(null);
                            }}
                            className="bg-slate-700 border border-slate-500 focus:border-emerald-500 rounded px-1.5 py-0.5 text-xs text-slate-100 outline-none mr-1"
                          />
                        ) : (
                          <span className="text-slate-400 truncate">{c.wechatName}</span>
                        )}
                        <div className="flex items-center justify-end gap-1">
                          {editingKey === c.studentName ? (
                            <button
                              type="button"
                              onClick={() => handleSaveEdit(c.studentName)}
                              className="p-1 text-emerald-400 hover:text-emerald-300 transition-colors"
                              title="保存"
                            >
                              <Check size={12} />
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleStartEdit(c)}
                              className="p-1 text-slate-500 hover:text-slate-300 transition-colors"
                              title="编辑"
                            >
                              <Pencil size={11} />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => handleDeleteContact(c.studentName)}
                            className="p-1 text-slate-500 hover:text-red-400 transition-colors"
                            title="删除"
                          >
                            <Trash2 size={11} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Add new contact form */}
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newStudent}
                    onChange={e => setNewStudent(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleAddContact(); }}
                    placeholder="学生姓名（如：张三）"
                    className="flex-1 bg-slate-800 border border-slate-600 focus:border-emerald-500 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 placeholder-slate-600 outline-none transition-colors"
                  />
                  <input
                    type="text"
                    value={newWechat}
                    onChange={e => setNewWechat(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleAddContact(); }}
                    placeholder="微信备注名/昵称（须与联系人一致）"
                    className="flex-1 bg-slate-800 border border-slate-600 focus:border-emerald-500 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 placeholder-slate-600 outline-none transition-colors"
                  />
                  <button
                    type="button"
                    onClick={handleAddContact}
                    disabled={!newStudent.trim() || !newWechat.trim()}
                    className="flex items-center gap-1 px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 text-white text-xs rounded-lg transition-colors"
                    title="新增联系人"
                  >
                    <Plus size={12} /> 新增
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* bottom spacing */}
          <div className="h-1" />
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
