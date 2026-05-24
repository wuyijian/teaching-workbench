import { useState, useRef, useEffect, useCallback } from 'react';
import { X, FileText, RotateCcw, Bot, Plus, Trash2, Pencil, Check, QrCode, RefreshCw, KeyRound, ChevronDown, ChevronRight, Bell, Link2 } from 'lucide-react';
import { FEEDBACK_PROMPT } from './TaskPanel';
import type { Settings } from '../types';
import { getAllParentContacts, setParentContact, deleteParentContact } from '../utils/wechat';
import type { ParentContact } from '../utils/wechat';
import { wechatAgentBase } from '../config/urls';
import { fetchWithTimeout } from '../utils/fetchWithTimeout';
import { useAuth } from '../context/AuthContext';

interface Props {
  settings: Settings;
  onSave: (s: Settings) => void;
  onClose: () => void;
  /** If true, auto-scroll to WeChat config section on open */
  openAtWechat?: boolean;
}

type SelfBindStatus = 'idle' | 'checking' | 'bound' | 'unbound' | 'err';
type BindCodeState = 'idle' | 'generating' | 'ready' | 'verifying' | 'bound' | 'err';
type WeclawStatus = 'idle' | 'checking' | 'online_loggedin' | 'online_loggedout' | 'session_expired' | 'stopped' | 'err';

type WeclawQr =
  | { type: 'url'; data: string }
  | { type: 'image'; data: string }
  | { type: 'manual'; data: string };

export function SettingsModal({ settings, onSave, onClose, openAtWechat }: Props) {
  const { user } = useAuth();

  const [feedbackPrompt, setFeedbackPrompt] = useState(
    () => settings.feedbackPrompt ?? FEEDBACK_PROMPT,
  );
  const [enableKnowledgeBase, setEnableKnowledgeBase] = useState(
    () => settings.enableKnowledgeBase ?? true,
  );

  const isMacElectron =
    typeof window !== 'undefined' &&
    window.electronAPI?.platform === 'darwin';

  const handleTestNotification = useCallback(() => {
    window.electronAPI?.showNotification?.({
      title: '教学工作台',
      body: '这是一条测试系统通知，转写和反馈完成时将弹出此类提醒 ✅',
    });
  }, []);

  // ── WeChat state ──────────────────────────────────────────────────────────
  const [selfBindStatus, setSelfBindStatus] = useState<SelfBindStatus>('idle');
  const [selfBindNickname, setSelfBindNickname] = useState<string | null>(null);

  // ── Bind code state ───────────────────────────────────────────────────────
  const [bindCodeState, setBindCodeState] = useState<BindCodeState>('idle');
  const [bindCode, setBindCode] = useState<string | null>(null);
  const [bindCodeExpiresAt, setBindCodeExpiresAt] = useState<number | null>(null);
  const [bindCodeSecondsLeft, setBindCodeSecondsLeft] = useState<number>(0);
  const bindCodeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [contacts, setContacts] = useState<ParentContact[]>(() => getAllParentContacts());
  const [newStudent, setNewStudent] = useState('');
  const [newWechat, setNewWechat] = useState('');
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editWechat, setEditWechat] = useState('');
  const [parentPanelOpen, setParentPanelOpen] = useState(false);

  // ── weclaw login state ────────────────────────────────────────────────────
  const [weclawStatus, setWeclawStatus] = useState<WeclawStatus>('idle');
  const [weclawNickname, setWeclawNickname] = useState<string | null>(null);
  const [weclawQr, setWeclawQr] = useState<WeclawQr | null>(null);
  const [weclawRestarting, setWeclawRestarting] = useState(false);
  const [weclawToken, setWeclawToken] = useState(
    () => localStorage.getItem('weclaw_control_token') ?? '',
  );
  const [showWeclawToken, setShowWeclawToken] = useState(false);
  const weclawPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

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


  // ── Bind code helpers ─────────────────────────────────────────────────────
  const stopBindCodeTimer = useCallback(() => {
    if (bindCodeTimerRef.current !== null) {
      clearInterval(bindCodeTimerRef.current);
      bindCodeTimerRef.current = null;
    }
  }, []);

  const handleGenerateBindCode = useCallback(async () => {
    if (!user?.id) return;
    setBindCodeState('generating');
    setBindCode(null);
    setBindCodeExpiresAt(null);
    stopBindCodeTimer();
    try {
      const resp = await fetchWithTimeout(
        `${wechatAgentBase}/generate-bind-code?userId=${encodeURIComponent(user.id)}`,
        {},
        5000,
      );
      if (!resp.ok) { setBindCodeState('err'); return; }
      const data = await resp.json() as { ok: boolean; code: string; expiresAt: number };
      if (!data.ok) { setBindCodeState('err'); return; }
      setBindCode(data.code);
      setBindCodeExpiresAt(data.expiresAt);
      const remaining = Math.max(0, Math.round((data.expiresAt - Date.now()) / 1000));
      setBindCodeSecondsLeft(remaining);
      setBindCodeState('ready');
      bindCodeTimerRef.current = setInterval(() => {
        setBindCodeSecondsLeft(s => {
          if (s <= 1) {
            stopBindCodeTimer();
            setBindCodeState(prev => prev === 'ready' ? 'idle' : prev);
            return 0;
          }
          return s - 1;
        });
      }, 1000);
    } catch {
      setBindCodeState('err');
    }
  }, [user?.id, stopBindCodeTimer]);

  const handleVerifyBinding = useCallback(async () => {
    if (!user?.id) return;
    setBindCodeState('verifying');
    try {
      const resp = await fetchWithTimeout(
        `${wechatAgentBase}/bind-status?userId=${encodeURIComponent(user.id)}`,
        {},
        5000,
      );
      if (!resp.ok) { setBindCodeState('err'); return; }
      const data = await resp.json() as { bound: boolean; wechatName?: string };
      if (data.bound) {
        stopBindCodeTimer();
        setBindCodeState('bound');
        setSelfBindNickname(data.wechatName ?? null);
        setSelfBindStatus('bound');
      } else {
        setBindCodeState('ready');
      }
    } catch {
      setBindCodeState('err');
    }
  }, [user?.id, stopBindCodeTimer]);

  useEffect(() => () => stopBindCodeTimer(), [stopBindCodeTimer]);

  // ── weclaw polling helpers ────────────────────────────────────────────────
  const stopWeclawPoll = useCallback(() => {
    if (weclawPollRef.current !== null) {
      clearInterval(weclawPollRef.current);
      weclawPollRef.current = null;
    }
  }, []);

  const fetchWeclawStatus = useCallback(async () => {
    try {
      const headers: Record<string, string> = {};
      if (weclawToken) headers['Authorization'] = `Bearer ${weclawToken}`;
      const resp = await fetchWithTimeout(`${wechatAgentBase}/weclaw-status`, { headers }, 6000);
      if (!resp.ok) { setWeclawStatus('err'); return; }
      const data = await resp.json() as {
        running: boolean;
        loggedIn: boolean;
        nickname: string | null;
        sessionExpired?: boolean;
        lastChecked?: string | null;
        autoRestartCount?: number;
      };
      if (!data.running) {
        setWeclawStatus('stopped');
      } else if (data.sessionExpired) {
        setWeclawStatus('session_expired');
        setWeclawNickname(data.nickname);
      } else if (data.loggedIn) {
        setWeclawStatus('online_loggedin');
        setWeclawNickname(data.nickname);
        stopWeclawPoll();
      } else {
        setWeclawStatus('online_loggedout');
      }
    } catch {
      setWeclawStatus('err');
    }
  }, [weclawToken, stopWeclawPoll]);

  const handleCheckWeclawStatus = useCallback(async () => {
    setWeclawStatus('checking');
    await fetchWeclawStatus();
  }, [fetchWeclawStatus]);

  const handleRestartWeclaw = useCallback(async () => {
    stopWeclawPoll();
    setWeclawRestarting(true);
    setWeclawQr(null);
    setWeclawStatus('checking');
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (weclawToken) headers['Authorization'] = `Bearer ${weclawToken}`;
      const resp = await fetchWithTimeout(`${wechatAgentBase}/weclaw-restart`, {
        method: 'POST',
        headers,
      }, 20000);
      const data = await resp.json() as {
        ok: boolean; type: string; qr?: string; message?: string;
      };
      if (data.ok && data.qr) {
        setWeclawQr({ type: data.type as 'url' | 'image', data: data.qr });
        setWeclawStatus('online_loggedout');
      } else if (data.type === 'manual') {
        setWeclawQr({ type: 'manual', data: data.message ?? '请在服务器上手动运行 weclaw login' });
        setWeclawStatus('stopped');
      }
      weclawPollRef.current = setInterval(fetchWeclawStatus, 3000);
    } catch (e) {
      setWeclawQr({
        type: 'manual',
        data: e instanceof Error ? `操作失败：${e.message}` : '操作失败，请在服务器上手动运行 weclaw login',
      });
      setWeclawStatus('err');
    } finally {
      setWeclawRestarting(false);
    }
  }, [weclawToken, stopWeclawPoll, fetchWeclawStatus]);

  useEffect(() => () => stopWeclawPoll(), [stopWeclawPoll]);

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

  const weclawConnected    = weclawStatus === 'online_loggedin';
  const weclawNeedsRescan  = weclawStatus === 'session_expired';

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

          {/* ── WeChat Config Section (temporarily hidden) ───────────────── */}
          {(false as boolean) && <div ref={wechatRef} className="rounded-xl border border-slate-700 overflow-hidden">
            {/* Section header */}
            <div className="flex items-center gap-2 px-3 py-2.5 bg-slate-800/60 border-b border-slate-700">
              <Bot size={13} className="text-[#07C160]" />
              <span className="text-xs font-semibold text-slate-200">微信配置</span>
            </div>

            <div className="divide-y divide-slate-700/50">

              {/* ── Step 1: Connect weclaw ─────────────────────────────── */}
              <div className="px-3 py-3 space-y-2">
                {/* Step label */}
                <div className="flex items-center gap-2">
                  <StepBadge
                    n="①"
                    done={weclawConnected}
                    active={!weclawConnected}
                  />
                  <span className="text-xs font-medium text-slate-200">连接微信</span>
                  <span className="ml-auto text-[11px]">
                    {weclawStatus === 'online_loggedin' && (
                      <span className="text-emerald-400">✅ 已连接{weclawNickname ? `：${weclawNickname}` : ''}</span>
                    )}
                    {weclawStatus === 'session_expired' && (
                      <span className="text-orange-400">🔄 Session 已过期</span>
                    )}
                    {weclawStatus === 'online_loggedout' && (
                      <span className="text-amber-400">⚠️ 等待扫码</span>
                    )}
                    {weclawStatus === 'stopped' && (
                      <span className="text-slate-500">⭕ 未运行</span>
                    )}
                    {weclawStatus === 'err' && (
                      <span className="text-red-400">❌ 连接失败</span>
                    )}
                    {weclawStatus === 'checking' && (
                      <span className="text-slate-400 animate-pulse">检测中…</span>
                    )}
                  </span>
                </div>

                {/* Status card */}
                <div className={`rounded-lg border px-3 py-2.5 space-y-2.5 ${
                  weclawConnected
                    ? 'border-emerald-700/40 bg-emerald-950/20'
                    : weclawStatus === 'session_expired'
                    ? 'border-orange-600/40 bg-orange-950/20'
                    : 'border-amber-700/30 bg-amber-950/15'
                }`}>
                  <p className="text-[11px] text-slate-400">
                    扫码后 weclaw 将连接到老师微信，自动接收并中转消息
                  </p>

                  {/* Session expired warning */}
                  {weclawStatus === 'session_expired' && (
                    <div className="flex items-start gap-2 rounded-lg border border-orange-600/40 bg-orange-950/30 px-3 py-2">
                      <span className="text-orange-400 text-xs shrink-0">⚠️</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-[11px] text-orange-300 font-medium">微信 Session 已过期</p>
                        <p className="text-[11px] text-orange-400/80 mt-0.5">
                          消息将无法转发。请重新扫码登录以恢复连接。
                        </p>
                      </div>
                    </div>
                  )}

                  {/* QR code display */}
                  {weclawQr && (
                    <div className="rounded-lg border border-slate-700 bg-slate-900/60 p-3 flex flex-col items-center gap-2">
                      {(weclawQr.type === 'url' || weclawQr.type === 'image') && (
                        <>
                          <img
                            src={
                              weclawQr.type === 'url'
                                ? `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(weclawQr.data)}`
                                : weclawQr.data
                            }
                            alt="微信登录二维码"
                            className="w-44 h-44 rounded-lg"
                          />
                          <p className="text-[11px] text-slate-400 text-center">
                            请用微信扫码，完成后自动检测连接状态
                          </p>
                        </>
                      )}
                      {weclawQr.type === 'manual' && (
                        <p className="text-[11px] text-amber-400 text-center leading-relaxed">
                          {weclawQr.data}
                        </p>
                      )}
                      {weclawStatus === 'online_loggedout' && (
                        <p className="text-[11px] text-slate-500 animate-pulse">
                          轮询检测登录状态中…
                        </p>
                      )}
                    </div>
                  )}

                  {/* Action buttons */}
                  <div className="flex items-center gap-2">
                    {weclawConnected && !weclawNeedsRescan ? (
                      <>
                        <button
                          type="button"
                          onClick={handleCheckWeclawStatus}
                          className="px-2.5 py-1 text-[11px] rounded-md border border-slate-600 text-slate-400 hover:border-slate-500 hover:text-slate-200 transition-colors"
                        >
                          检查状态
                        </button>
                        <button
                          type="button"
                          onClick={handleRestartWeclaw}
                          disabled={weclawRestarting}
                          className="flex items-center gap-1 px-2.5 py-1 text-[11px] rounded-md border border-slate-600 text-slate-400 hover:border-slate-500 hover:text-slate-200 transition-colors disabled:opacity-50"
                        >
                          {weclawRestarting && <RefreshCw size={10} className="animate-spin" />}
                          重新连接
                        </button>
                      </>
                    ) : weclawNeedsRescan ? (
                      /* Session expired — 突出显示"重新扫码"按钮 */
                      <button
                        type="button"
                        onClick={handleRestartWeclaw}
                        disabled={weclawRestarting}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] rounded-md bg-orange-500/10 border border-orange-500/40 text-orange-300 hover:bg-orange-500/20 transition-colors disabled:opacity-50 w-full justify-center font-medium"
                      >
                        {weclawRestarting
                          ? <><RefreshCw size={11} className="animate-spin" /> 正在获取二维码…</>
                          : <><QrCode size={11} /> 重新扫码登录</>}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={handleRestartWeclaw}
                        disabled={weclawRestarting}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] rounded-md bg-[#07C160]/10 border border-[#07C160]/30 text-[#07C160] hover:bg-[#07C160]/20 transition-colors disabled:opacity-50 w-full justify-center"
                      >
                        {weclawRestarting
                          ? <><RefreshCw size={11} className="animate-spin" /> 正在获取二维码…</>
                          : <><QrCode size={11} /> 扫码连接微信</>}
                      </button>
                    )}
                  </div>

                  {/* API Token (optional) */}
                  <div className="flex items-center gap-1.5">
                    <KeyRound size={10} className="text-slate-500 shrink-0" />
                    <input
                      type={showWeclawToken ? 'text' : 'password'}
                      value={weclawToken}
                      onChange={e => {
                        setWeclawToken(e.target.value);
                        localStorage.setItem('weclaw_control_token', e.target.value);
                      }}
                      placeholder="API Token（服务器设置了 WECLAW_API_TOKEN 时填写）"
                      className="flex-1 bg-slate-800 border border-slate-600 focus:border-emerald-500 rounded px-2 py-1 text-[11px] text-slate-300 placeholder-slate-600 outline-none transition-colors font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => setShowWeclawToken(v => !v)}
                      className="text-[10px] text-slate-500 hover:text-slate-300 transition-colors shrink-0 px-1"
                    >
                      {showWeclawToken ? '隐藏' : '显示'}
                    </button>
                  </div>
                </div>
              </div>

              {/* ── Step 2: Teacher binding (bind-code flow) ────────────── */}
              <div className={`px-3 py-3 space-y-2 transition-opacity duration-200 ${weclawConnected ? '' : 'opacity-40 pointer-events-none'}`}>
                <div className="flex items-center gap-2">
                  <StepBadge
                    n="②"
                    done={bindCodeState === 'bound' || selfBindStatus === 'bound'}
                    active={weclawConnected && bindCodeState !== 'bound' && selfBindStatus !== 'bound'}
                    locked={!weclawConnected}
                  />
                  <span className="text-xs font-medium text-slate-200">绑定老师身份</span>
                  <span className="text-[10px] text-slate-500">（接收反馈通知）</span>
                  <span className="ml-auto text-[11px]">
                    {(bindCodeState === 'bound' || selfBindStatus === 'bound') && (
                      <span className="text-emerald-400">✅ 已绑定{selfBindNickname ? `：${selfBindNickname}` : ''}</span>
                    )}
                    {bindCodeState === 'err' && (
                      <span className="text-red-400">❌ 操作失败</span>
                    )}
                  </span>
                </div>

                <div className="rounded-lg border border-slate-700 bg-slate-800/40 px-3 py-2.5 space-y-2.5">
                  {/* Bound state */}
                  {(bindCodeState === 'bound' || selfBindStatus === 'bound') ? (
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-emerald-400 flex-1">
                        ✅ 您的微信已与工作台账号关联，反馈通知将自动发送到微信。
                      </span>
                      <button
                        type="button"
                        onClick={handleGenerateBindCode}
                        className="shrink-0 px-2.5 py-1 text-[11px] rounded-md border border-slate-600 text-slate-400 hover:border-slate-500 hover:text-slate-200 transition-colors"
                      >
                        重新绑定
                      </button>
                    </div>
                  ) : (
                    <>
                      <p className="text-[11px] text-slate-400 leading-relaxed">
                        点击获取绑定码，然后在微信向{' '}
                        <span className="text-slate-200 font-medium">ClawBot</span>
                        {' '}发送{' '}
                        <span className="text-slate-200 font-medium">「绑定 &lt;绑定码&gt;」</span>
                        {' '}完成关联。
                      </p>

                      {/* Bind code display */}
                      {bindCode && bindCodeState === 'ready' && (
                        <div className="rounded-lg border border-indigo-700/40 bg-indigo-950/20 px-3 py-2.5 space-y-1.5">
                          <p className="text-[10px] text-slate-500">请在微信向 ClawBot 发送：</p>
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-lg font-bold text-indigo-300 tracking-[0.25em]">
                              绑定 {bindCode}
                            </span>
                            <span className={`ml-auto text-[11px] tabular-nums ${bindCodeSecondsLeft <= 60 ? 'text-orange-400' : 'text-slate-500'}`}>
                              {Math.floor(bindCodeSecondsLeft / 60)}:{String(bindCodeSecondsLeft % 60).padStart(2, '0')}
                            </span>
                          </div>
                          <p className="text-[10px] text-slate-600">10分钟内有效，过期后重新获取</p>
                        </div>
                      )}

                      {/* Expired */}
                      {bindCodeState === 'idle' && bindCodeExpiresAt !== null && (
                        <p className="text-[11px] text-amber-500">绑定码已过期，请重新获取。</p>
                      )}

                      {/* Error */}
                      {bindCodeState === 'err' && (
                        <p className="text-[11px] text-red-400">操作失败，请确认 ClawBot 服务运行中。</p>
                      )}

                      {/* Action buttons */}
                      <div className="flex items-center gap-2">
                        {!user?.id ? (
                          <p className="text-[11px] text-amber-400 flex-1">请先登录账号才能绑定微信</p>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={handleGenerateBindCode}
                              disabled={bindCodeState === 'generating'}
                              className="flex items-center gap-1 px-2.5 py-1 text-[11px] rounded-md bg-indigo-600/10 border border-indigo-500/30 text-indigo-300 hover:bg-indigo-600/20 transition-colors disabled:opacity-50"
                            >
                              {bindCodeState === 'generating'
                                ? <><RefreshCw size={10} className="animate-spin" /> 生成中…</>
                                : <><Link2 size={10} /> {bindCode ? '重新获取' : '获取绑定码'}</>}
                            </button>
                            {(bindCodeState === 'ready' || bindCodeState === 'verifying') && (
                              <button
                                type="button"
                                onClick={handleVerifyBinding}
                                disabled={bindCodeState === 'verifying'}
                                className="flex items-center gap-1 px-2.5 py-1 text-[11px] rounded-md border border-slate-600 text-slate-300 hover:border-slate-500 hover:text-slate-100 transition-colors disabled:opacity-50"
                              >
                                {bindCodeState === 'verifying'
                                  ? <><RefreshCw size={10} className="animate-spin" /> 验证中…</>
                                  : '验证绑定'}
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* ── Step 3: Parent contacts (collapsible) ──────────────── */}
              <div>
                <button
                  type="button"
                  onClick={() => setParentPanelOpen(v => !v)}
                  className="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-slate-800/40 transition-colors text-left"
                >
                  <StepBadge n="③" locked />
                  <span className="text-xs font-medium text-slate-300">家长通知配置</span>
                  <span className="text-[10px] text-slate-500 ml-0.5">（可选）</span>
                  {contacts.length > 0 && (
                    <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded-full bg-slate-700 text-slate-400">
                      {contacts.length}
                    </span>
                  )}
                  {parentPanelOpen
                    ? <ChevronDown size={12} className="ml-auto text-slate-500" />
                    : <ChevronRight size={12} className="ml-auto text-slate-500" />}
                </button>

                {parentPanelOpen && (
                  <div className="px-3 pb-3 space-y-2 border-t border-slate-700/50">
                    <p className="text-[11px] text-slate-500 pt-2">
                      填入该学生在 ClawBot 微信通讯录中显示的
                      <span className="text-slate-400 font-medium">备注名或昵称</span>
                      （发送时将匹配此名称）
                    </p>

                    {contacts.length === 0 && (
                      <div className="rounded-lg px-3 py-2 bg-amber-950/20 border border-amber-800/20">
                        <p className="text-[11px] text-amber-500 font-medium">尚未添加任何家长联系人</p>
                        <p className="text-[11px] text-amber-600/80 mt-0.5">
                          添加绑定后，点击「同步微信」才能自动将反馈发送给对应家长。
                        </p>
                      </div>
                    )}

                    {contacts.length > 0 && (
                      <div className="rounded-lg border border-slate-700 overflow-hidden">
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

                    {/* Add new contact */}
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
                        placeholder="微信备注名/昵称"
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
                )}
              </div>

            </div>

            {/* ── Mac native notification hint ───────────────────────── */}
            {isMacElectron && (
              <div className="px-3 py-3 border-t border-slate-700/50">
                <div className="flex items-start gap-2 rounded-lg border border-sky-700/30 bg-sky-950/20 px-3 py-2.5">
                  <Bell size={12} className="text-sky-400 mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0 space-y-1.5">
                    <p className="text-[11px] text-sky-300 font-medium">Mac 客户端已支持系统通知</p>
                    <p className="text-[11px] text-sky-400/80 leading-relaxed">
                      转写完成和反馈发送时将弹出系统提醒，即使应用在后台也能收到通知。
                    </p>
                    <button
                      type="button"
                      onClick={handleTestNotification}
                      className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] rounded-md border border-sky-600/40 text-sky-300 hover:bg-sky-900/30 transition-colors"
                    >
                      <Bell size={10} /> 发送测试通知
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>}

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

// ── Helper: step number badge ─────────────────────────────────────────────────
function StepBadge({
  n,
  done = false,
  active = false,
  locked = false,
}: {
  n: string;
  done?: boolean;
  active?: boolean;
  locked?: boolean;
}) {
  const cls = done
    ? 'bg-emerald-500/20 text-emerald-300 ring-emerald-500/50'
    : active
    ? 'bg-amber-500/15 text-amber-400 ring-amber-500/40'
    : locked
    ? 'bg-slate-700 text-slate-500 ring-slate-600'
    : 'bg-slate-700 text-slate-400 ring-slate-600';

  return (
    <span
      className={`w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center shrink-0 ring-1 ${cls}`}
    >
      {n}
    </span>
  );
}
