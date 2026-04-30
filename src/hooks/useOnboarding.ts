/**
 * 新手引导状态管理
 * - 注册成功后 AuthContext 写入 'tw-onboarding: needed'
 * - App.tsx 挂载时检测，若需要则开启引导流程
 */
import { useState, useCallback } from 'react';

export type OnboardingStep =
  | 'idle'         // 引导未激活
  | 'welcome'      // 欢迎弹窗
  | 'creating'     // 正在"加载"示例课堂（2s 动画）
  | 'transcript'   // 转写完成，引导用户点击「生成AI反馈」
  | 'feedback'     // AI反馈已展示，引导复制/完成
  | 'done';        // 引导结束（过渡到 idle）

export const ONBOARDING_KEY = 'tw-onboarding';

function needsOnboarding(): boolean {
  try {
    return localStorage.getItem(ONBOARDING_KEY) === 'needed';
  } catch {
    return false;
  }
}

export function markOnboardingNeeded() {
  try { localStorage.setItem(ONBOARDING_KEY, 'needed'); } catch { /* */ }
}

export function clearOnboarding() {
  try { localStorage.removeItem(ONBOARDING_KEY); } catch { /* */ }
}

export function useOnboarding() {
  const [step, setStep] = useState<OnboardingStep>(() =>
    needsOnboarding() ? 'welcome' : 'idle'
  );

  const advance = useCallback((next: OnboardingStep) => setStep(next), []);

  const skip = useCallback(() => {
    clearOnboarding();
    setStep('idle');
  }, []);

  const complete = useCallback(() => {
    clearOnboarding();
    setStep('done');
    // 短暂显示完成态，再过渡到 idle
    setTimeout(() => setStep('idle'), 2500);
  }, []);

  return { step, advance, skip, complete };
}
