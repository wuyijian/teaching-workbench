/**
 * 服务端 / 构建时统一注入的 API 配置（Vite 环境变量）。
 * 用户不在设置中填写 Key，仅语言、反馈 Prompt 等偏好存 localStorage。
 */
import type { Settings } from '../types';
import { defaultOpenAiCompatibleBase, isElectronTarget } from './app';

function trim(s: string | undefined): string {
  return (s ?? '').trim();
}

/** OpenAI 兼容对话 / 反馈 / Agent */
export function getPlatformLlmApiKey(): string {
  return trim(import.meta.env.VITE_LLM_API_KEY);
}

export function getPlatformLlmBaseUrl(): string {
  const v = trim(import.meta.env.VITE_LLM_BASE_URL);
  let base = v || defaultOpenAiCompatibleBase;
  if (!isElectronTarget && base === 'https://api.openai.com/v1') {
    base = defaultOpenAiCompatibleBase;
  }
  if (isElectronTarget && base.startsWith('/')) {
    base = 'https://api.openai.com/v1';
  }
  return base;
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
 */
export function mergePlatformApiSettings(prefs: {
  language: string;
  feedbackPrompt?: string;
}): Settings {
  const xf = getPlatformXfCredentials();
  return {
    language: prefs.language,
    feedbackPrompt: prefs.feedbackPrompt,
    apiKey: getPlatformLlmApiKey(),
    apiBaseUrl: getPlatformLlmBaseUrl(),
    model: getPlatformLlmModel(),
    xfAppId: xf.xfAppId,
    xfAccessKeyId: xf.xfAccessKeyId,
    xfAccessKeySecret: xf.xfAccessKeySecret,
  };
}
