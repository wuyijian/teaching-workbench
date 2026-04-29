/**
 * 微信发消息工具
 *
 * Web 端：复制到剪贴板 + weixin:// 唤起微信（浏览器沙箱不能自动化桌面）
 * Electron 端（Windows）：IPC → 主进程 PowerShell 自动控制微信客户端
 */

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
  const api = (window as Window & { electronAPI?: { sendWechat?: (c: string, m: string) => Promise<SendResult> } }).electronAPI;
  if (!api?.sendWechat) return { ok: false, reason: 'not_windows', message: '当前版本不支持自动发送（仅 Windows Electron 端）' };
  return api.sendWechat(contactName, message);
}

/** 统一入口：Electron 走自动发送，Web 走剪贴板 */
export async function sendFeedbackToParent(
  contactName: string,
  message: string,
): Promise<SendResult> {
  const isElectron = !!(window as Window & { electronAPI?: unknown }).electronAPI;
  if (isElectron) return electronSendViaWechat(contactName, message);
  return webSendViaClipboard(message);
}
