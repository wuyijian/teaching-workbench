/**
 * 微信发消息工具
 *
 * Web 端：复制到剪贴板 + weixin:// 唤起微信（浏览器沙箱不能自动化桌面）
 * Electron 端（Windows）：IPC → 主进程 PowerShell 自动控制微信客户端
 * Electron 端（Mac）：IPC → 主进程 Notification 原生系统通知
 */

import { wechatAgentBase } from '../config/urls';

// ─── 家长微信信息存储（localStorage） ────────────────────────────────────────

const PREFIX = 'parent-wechat:';

export interface ParentContact {
  studentName: string;
  wechatName: string; // 微信里显示的备注名 / 搜索关键词
  updatedAt: number;
}

export function getParentContact(studentName: string): ParentContact | null {
  try {
    const raw = localStorage.getItem(PREFIX + studentName);
    return raw ? (JSON.parse(raw) as ParentContact) : null;
  } catch {
    return null;
  }
}

export function setParentContact(studentName: string, wechatName: string) {
  const rec: ParentContact = { studentName, wechatName: wechatName.trim(), updatedAt: Date.now() };
  localStorage.setItem(PREFIX + studentName, JSON.stringify(rec));
}

export function deleteParentContact(studentName: string) {
  localStorage.removeItem(PREFIX + studentName);
}

export function getAllParentContacts(): ParentContact[] {
  const contacts: ParentContact[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(PREFIX)) {
        const raw = localStorage.getItem(key);
        if (raw) {
          try { contacts.push(JSON.parse(raw) as ParentContact); } catch { /* skip */ }
        }
      }
    }
  } catch { /* */ }
  return contacts.sort((a, b) => a.studentName.localeCompare(b.studentName, 'zh'));
}

// ─── 家长消息格式化 ───────────────────────────────────────────────────────────

export function formatParentMessage(params: {
  studentName: string;
  topic?: string;
  feedback: string;
  date?: Date;
}): string {
  const { studentName, topic, feedback, date = new Date() } = params;
  const m = date.getMonth() + 1;
  const d = date.getDate();
  const dateStr = `${m}月${d}日`;

  const topicLine = topic ? `本节课主题：${topic}\n` : '';
  return [
    `您好，这是 ${studentName} ${dateStr}语文课的课堂情况反馈：`,
    '',
    topicLine + feedback.trim(),
    '',
    '如有疑问，欢迎随时沟通！',
  ].join('\n');
}

// ─── 发送入口 ─────────────────────────────────────────────────────────────────

export type SendResult =
  | { ok: true }
  | { ok: false; reason: 'no_wechat_running' | 'not_windows' | 'copy_only' | 'error'; message?: string };

/** Web 端：将消息写入剪贴板，然后尝试用 weixin:// 唤起微信 */
export async function webSendViaClipboard(message: string): Promise<SendResult> {
  try {
    await navigator.clipboard.writeText(message);
  } catch {
    // 不支持 Clipboard API（如 http 环境），忽略
  }
  // weixin:// 只能打开微信，无法指定联系人或预填内容
  window.open('weixin://', '_blank');
  return { ok: false, reason: 'copy_only' };
}

/**
 * Electron 端（Windows）：通过 IPC 让主进程运行 PowerShell 脚本，
 * 自动把消息发送给指定微信联系人。
 *
 * 要求：微信 PC 版已登录并在后台运行。
 */
export async function electronSendViaWechat(
  contactName: string,
  message: string,
): Promise<SendResult> {
  const api = (window as Window & typeof globalThis).electronAPI;
  if (!api?.sendWechat) return { ok: false, reason: 'not_windows', message: '当前版本不支持自动发送（仅 Windows Electron 端）' };
  return api.sendWechat(contactName, message);
}

/** 统一入口：Electron 走自动发送，Web 走剪贴板 */
export async function sendFeedbackToParent(
  contactName: string,
  message: string,
): Promise<SendResult> {
  const isElectron = !!(window as Window & typeof globalThis).electronAPI;
  if (isElectron) return electronSendViaWechat(contactName, message);
  return webSendViaClipboard(message);
}

// ─── 自动通知（fire-and-forget） ──────────────────────────────────────────────

const MAX_AUTO_MSG_LENGTH = 500;

/** 在 Electron 环境下触发原生系统通知（fire-and-forget） */
function fireNativeNotification(body: string): void {
  const api = (window as Window & typeof globalThis).electronAPI;
  api?.showNotification?.({ title: '教学工作台', body: body.slice(0, 100) });
}

/**
 * 向老师自己的微信发送通知（fire-and-forget）。
 * - 调用 /wechat-agent/send-self；若服务端未绑定对应 userId，静默跳过。
 * - Electron 环境下额外触发系统原生通知。
 * - 失败时仅 console.warn，不抛异常，不阻塞主流程。
 * @param message 通知内容
 * @param userId  Supabase user ID（多用户模式必传，单用户兜底时可省略）
 */
export function notifySelf(message: string, userId?: string | null): void {
  const truncated = message.length > MAX_AUTO_MSG_LENGTH
    ? message.slice(0, MAX_AUTO_MSG_LENGTH) + '…'
    : message;

  fireNativeNotification(truncated);

  const body: Record<string, string> = { message: truncated };
  if (userId) body.userId = userId;

  fetch(`${wechatAgentBase}/send-self`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
    .then(async resp => {
      if (!resp.ok) {
        console.warn(`[notifySelf] HTTP ${resp.status}`);
        return;
      }
      const json = await resp.json() as { ok: boolean; error?: string };
      if (!json.ok) console.warn(`[notifySelf] ${json.error ?? '发送失败'}`);
    })
    .catch(err => console.warn('[notifySelf]', err));
}

/**
 * 向指定学生的家长发送微信通知（fire-and-forget）。
 * - 若未绑定家长联系人，静默跳过。
 * - Electron 环境下额外触发系统原生通知。
 * - 失败时仅 console.warn，不抛异常，不阻塞主流程。
 */
export function notifyParent(studentName: string, message: string): void {
  const contact = getParentContact(studentName);
  if (!contact?.wechatName) return;

  const truncated = message.length > MAX_AUTO_MSG_LENGTH
    ? message.slice(0, MAX_AUTO_MSG_LENGTH) + '…'
    : message;

  fireNativeNotification(`${studentName}：${truncated}`);

  fetch(`${wechatAgentBase}/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ to: contact.wechatName, message: truncated }),
  })
    .then(async resp => {
      if (!resp.ok) {
        console.warn(`[notifyParent] ${studentName}: HTTP ${resp.status}`);
        return;
      }
      const json = await resp.json() as { ok: boolean; error?: string };
      if (!json.ok) console.warn(`[notifyParent] ${studentName}: ${json.error ?? '发送失败'}`);
    })
    .catch(err => console.warn(`[notifyParent] ${studentName}:`, err));
}
