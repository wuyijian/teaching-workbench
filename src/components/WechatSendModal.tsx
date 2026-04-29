/**
 * 发给家长弹窗
 *
 * 展示格式化好的消息，允许老师编辑内容 / 设置家长微信名，
 * 然后一键复制+唤起微信（Web）或自动发送（Electron Windows）。
 */
import { useState, useEffect } from 'react';
import { X, Send, Copy, Check, MessageCircle, User, AlertCircle, Loader2 } from 'lucide-react';
import { getParentContact, setParentContact, sendFeedbackToParent, webSendViaClipboard } from '../utils/wechat';

interface Props {
  studentName: string;
  message: string;          // 格式化好的初始消息（可编辑）
  onClose: () => void;
}

const isElectron = !!(window as Window & { electronAPI?: unknown }).electronAPI;

export function WechatSendModal({ studentName, message: initMessage, onClose }: Props) {
  const [message, setMessage]         = useState(initMessage);
  const [wechatName, setWechatName]   = useState('');
  const [sending, setSending]         = useState(false);
  const [result, setResult]           = useState<string | null>(null);
  const [copied, setCopied]           = useState(false);

  // 读取上次保存的家长微信名
  useEffect(() => {
    const saved = getParentContact(studentName);
    if (saved?.wechatName) setWechatName(saved.wechatName);
  }, [studentName]);

  async function handleSend() {
    if (!wechatName.trim()) {
      setResult('请先填写家长微信备注名');
      return;
    }
    setSending(true);
    setResult(null);
    try {
      // 保存以便下次自动填入
      setParentContact(studentName, wechatName);
      const res = await sendFeedbackToParent(wechatName.trim(), message);
      if (res.ok) {
        setResult('✓ 已自动发送');
      } else if (res.reason === 'copy_only') {
        setResult('消息已复制，微信已唤起 —— 请在微信中搜索联系人并粘贴发送');
      } else if (res.reason === 'no_wechat_running') {
        setResult('未检测到微信运行，请先打开微信PC版后重试');
      } else {
        setResult(res.message ?? '发送失败，请手动复制消息');
      }
    } finally {
      setSending(false);
    }
  }

  async function handleCopy() {
    try { await navigator.clipboard.writeText(message); } catch { /* ignore */ }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleCopyAndOpen() {
    setParentContact(studentName, wechatName);
    await webSendViaClipboard(message);
    setCopied(true);
    setResult('消息已复制，微信已唤起 —— 请在微信中搜索联系人并粘贴发送');
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(0,0,0,0.65)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24,
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        width: '100%', maxWidth: 540,
        background: 'var(--bg-s1)',
        border: '1px solid var(--border)',
        borderRadius: 16,
        overflow: 'hidden',
        display: 'flex', flexDirection: 'column',
        maxHeight: '90vh',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '16px 20px',
          borderBottom: '1px solid var(--border)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <MessageCircle size={16} style={{ color: '#07C160' }} />
            <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-1)' }}>发给家长</span>
            <span style={{ fontSize: 12, color: 'var(--text-3)' }}>· {studentName}</span>
          </div>
          <button onClick={onClose} style={{ color: 'var(--text-3)', cursor: 'pointer', lineHeight: 1 }}>
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '16px 20px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* 家长微信备注名 */}
          <div>
            <label style={{ fontSize: 12, color: 'var(--text-3)', display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6 }}>
              <User size={11} />
              {isElectron ? '家长微信备注名（用于自动搜索联系人）' : '家长微信备注名（供参考）'}
            </label>
            <input
              type="text"
              value={wechatName}
              onChange={e => setWechatName(e.target.value)}
              placeholder="例如：李明妈妈"
              style={{
                width: '100%', boxSizing: 'border-box',
                background: 'var(--bg-s2)', border: '1px solid var(--border)',
                borderRadius: 8, padding: '8px 12px',
                fontSize: 13, color: 'var(--text-1)',
                outline: 'none',
              }}
            />
          </div>

          {/* 消息编辑区 */}
          <div>
            <label style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 6, display: 'block' }}>
              消息内容（可编辑）
            </label>
            <textarea
              value={message}
              onChange={e => setMessage(e.target.value)}
              rows={10}
              style={{
                width: '100%', boxSizing: 'border-box',
                background: 'var(--bg-s2)', border: '1px solid var(--border)',
                borderRadius: 8, padding: '10px 12px',
                fontSize: 13, color: 'var(--text-1)', lineHeight: 1.7,
                resize: 'vertical', outline: 'none',
                fontFamily: 'inherit',
              }}
            />
          </div>

          {/* 结果提示 */}
          {result && (
            <div style={{
              display: 'flex', alignItems: 'flex-start', gap: 6,
              padding: '9px 12px', borderRadius: 8,
              background: result.startsWith('✓') ? 'rgba(7,193,96,0.1)' : 'var(--bg-s3)',
              border: `1px solid ${result.startsWith('✓') ? 'rgba(7,193,96,0.3)' : 'var(--border)'}`,
            }}>
              <AlertCircle size={13} style={{ color: result.startsWith('✓') ? '#07C160' : 'var(--text-3)', marginTop: 1, flexShrink: 0 }} />
              <span style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.5 }}>{result}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '12px 20px',
          borderTop: '1px solid var(--border)',
          display: 'flex', gap: 8, justifyContent: 'flex-end',
        }}>
          <button
            onClick={handleCopy}
            style={{
              display: 'flex', alignItems: 'center', gap: 5,
              padding: '7px 14px', borderRadius: 8, cursor: 'pointer',
              background: 'var(--bg-s3)', border: '1px solid var(--border)',
              fontSize: 13, color: 'var(--text-2)',
            }}
          >
            {copied ? <Check size={13} style={{ color: '#07C160' }} /> : <Copy size={13} />}
            {copied ? '已复制' : '复制'}
          </button>

          {/* Electron 显示"自动发送"，Web 显示"复制并打开微信" */}
          {isElectron ? (
            <button
              onClick={handleSend}
              disabled={sending}
              style={{
                display: 'flex', alignItems: 'center', gap: 5,
                padding: '7px 16px', borderRadius: 8, cursor: sending ? 'not-allowed' : 'pointer',
                background: '#07C160', border: 'none',
                fontSize: 13, color: '#fff', fontWeight: 600,
                opacity: sending ? 0.7 : 1,
              }}
            >
              {sending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
              {sending ? '发送中…' : '自动发送'}
            </button>
          ) : (
            <button
              onClick={handleCopyAndOpen}
              style={{
                display: 'flex', alignItems: 'center', gap: 5,
                padding: '7px 16px', borderRadius: 8, cursor: 'pointer',
                background: '#07C160', border: 'none',
                fontSize: 13, color: '#fff', fontWeight: 600,
              }}
            >
              <MessageCircle size={13} />
              复制并打开微信
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
