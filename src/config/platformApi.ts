/**
 * 服务端 / 构建时统一注入的 API 配置（Vite 环境变量）。
 * 用户不在设置中填写 Key，仅语言、反馈 Prompt 等偏好存 localStorage。
 */
import type { Settings } from '../types';
import { defaultOpenAiCompatibleBase, isElectronTarget } from './app';

// re-export for App.tsx usage
export { defaultOpenAiCompatibleBase };

function trim(s: string | undefined): string {
  return (s ?? '').trim();
}

/** OpenAI 兼容对话 / 反馈 / Agent */
export function getPlatformLlmApiKey(): string {
  return trim(import.meta.env.VITE_LLM_API_KEY);
}

export function getPlatformLlmBaseUrl(): string {
  const v = trim(import.meta.env.VITE_LLM_BASE_URL);
  if (v) return v;
  // Electron 直连公网；Web 走同域反代
  return defaultOpenAiCompatibleBase;
}

export function getPlatformLlmModel(): string {
  return trim(import.meta.env.VITE_LLM_MODEL) || 'kimi-k2.5';
}

/** 讯飞录音文件转写 */
export function getPlatformXfCredentials() {
  return {
    xfAppId: trim(import.meta.env.VITE_XF_APP_ID),
    xfAccessKeyId: trim(import.meta.env.VITE_XF_ACCESS_KEY_ID),
    xfAccessKeySecret: trim(import.meta.env.VITE_XF_ACCESS_KEY_SECRET),
  };
}

export function hasPlatformLlm(): boolean {
  return !!getPlatformLlmApiKey();
}

export function hasPlatformXf(): boolean {
  const x = getPlatformXfCredentials();
  return !!(x.xfAppId && x.xfAccessKeyId && x.xfAccessKeySecret);
}

/**
 * 合并用户偏好（语言、自定义 Prompt）与平台 API 配置。
 * userOverrides 在 env var 为空时作为 fallback（Electron 桌面端用户自填 key 的场景）。
 */
export function mergePlatformApiSettings(
  prefs: { language: string; feedbackPrompt?: string },
  userOverrides?: { apiKey?: string; apiBaseUrl?: string; model?: string },
): Settings {
  const xf = getPlatformXfCredentials();
  // env var 有值时优先；否则 fallback 到用户手动填写的（Electron 桌面端自填 key 的场景）
  const envKey   = getPlatformLlmApiKey();
  const envBase  = trim(import.meta.env.VITE_LLM_BASE_URL);   // 原始 env，未经 defaultUrl 处理
  const envModel = trim(import.meta.env.VITE_LLM_MODEL);
  const userKey   = trim(userOverrides?.apiKey);
  const userBase  = trim(userOverrides?.apiBaseUrl);
  const userModel = trim(userOverrides?.model);
  return {
    language: prefs.language,
    feedbackPrompt: prefs.feedbackPrompt,
    apiKey:    envKey   || userKey,
    apiBaseUrl: envBase  || userBase  || defaultOpenAiCompatibleBase,
    model:     envModel || userModel || 'kimi-k2.5',
    xfAppId: xf.xfAppId,
    xfAccessKeyId: xf.xfAccessKeyId,
    xfAccessKeySecret: xf.xfAccessKeySecret,
  };
}
