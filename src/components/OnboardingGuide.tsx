/**
 * 新手引导 + Demo 体验课
 *
 * 流程：
 *  welcome  → [开始体验] → creating（2s 动画加载示例课堂）
 *           → transcript（自动选中任务，引导点击「生成AI反馈」）
 *           → feedback（引导复制/完成）
 *           → done（庆祝 banner 2.5s 后消失）
 *
 * 设计原则：
 *  - 不遮挡主 UI，用底部浮动卡片 + 高亮脉冲点引导
 *  - 每步最多显示一条核心指令，30 秒内完成全程体验
 *  - 可随时跳过
 */
import { useEffect, useRef, useState } from 'react';
import { BookOpen, Sparkles, Copy, CheckCircle2, ArrowRight, X, ChevronRight } from 'lucide-react';
import type { OnboardingStep } from '../hooks/useOnboarding';

interface Props {
  step: OnboardingStep;
  onStart:    () => void;   // welcome → creating
  onSkip:     () => void;   // 任意步骤 → idle
  onComplete: () => void;   // feedback → done
  /** 由父组件传入，供 creating 阶段调用 */
  onInjectDemo: () => string; // 注入 demo 任务，返回任务 id
  /** 父组件选中任务 */
  onSelectTask: (id: string) => void;
  /** 当前已选任务是否有 aiSummary（用于自动推进到 feedback 步骤） */
  selectedTaskHasFeedback: boolean;
}

// ── 各步骤文案 ────────────────────────────────────────────────────────────────
const STEP_CONFIG: Record<string, {
  icon: React.ElementType;
  color: string;
  title: string;
  desc: string;
  badge?: string;
}> = {
  creating: {
    icon: BookOpen,
    color: '#4493f8',
    title: '正在加载示例课堂…',
    desc: '为你准备一节真实的8分钟语文课录音转写结果',
    badge: '约 2 秒',
  },
  transcript: {
    icon: ArrowRight,
    color: '#22c55e',
    title: '转写完成 ✅',
    desc: '右侧已显示完整转写文本，点击「生成AI反馈」按钮查看智能评价',
    badge: '下一步',
  },
  feedback: {
    icon: Copy,
    color: '#a855f7',
    title: '🎉 AI反馈已生成',
    desc: '点击「复制」或「发给家长」，把今天的课堂反馈分享出去',
    badge: '最后一步',
  },
};

export function OnboardingGuide({
  step,
  onStart,
  onSkip,
  onComplete,
  onInjectDemo,
  onSelectTask,
  selectedTaskHasFeedback,
}: Props) {
  const injectedRef = useRef(false);
  const [dots, setDots] = useState('');

  // creating 阶段：注入 demo 任务 + 等待 2s 后推进到 transcript
  useEffect(() => {
    if (step !== 'creating') { injectedRef.current = false; return; }
    if (injectedRef.current) return;
    injectedRef.current = true;

    const id = onInjectDemo();
    const timer = setTimeout(() => {
      onSelectTask(id);
      // 通知父组件推进步骤（由父组件调用 advance('transcript')）
      // 这里用自定义事件解耦
      window.dispatchEvent(new CustomEvent('onboarding:transcript', { detail: { id } }));
    }, 2000);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // 加载点动画
  useEffect(() => {
    if (step !== 'creating') return;
    const t = setInterval(() => setDots(d => d.length >= 3 ? '' : d + '.'), 400);
    return () => clearInterval(t);
  }, [step]);

  // transcript 阶段：检测 aiSummary 写入后自动推进
  useEffect(() => {
    if (step === 'transcript' && selectedTaskHasFeedback) {
      window.dispatchEvent(new CustomEvent('onboarding:feedback'));
    }
  }, [step, selectedTaskHasFeedback]);

  // ── 欢迎弹窗 ──────────────────────────────────────────────────────────────
  if (step === 'welcome') {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center"
        style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }}
      >
        <div
          className="relative flex flex-col items-center text-center rounded-2xl shadow-2xl"
          style={{
            background: 'var(--bg-s1)',
            border: '1px solid var(--border)',
            padding: '40px 48px',
            maxWidth: 440,
            width: '90%',
          }}
        >
          {/* 跳过 */}
          <button
            onClick={onSkip}
            className="absolute top-4 right-4 p-1.5 rounded-lg transition-colors"
            style={{ color: 'var(--text-3)' }}
            title="跳过引导"
          >
            <X size={16} />
          </button>

          {/* 图标 */}
          <div
            className="flex items-center justify-center w-16 h-16 rounded-2xl mb-5"
            style={{ background: 'linear-gradient(135deg, #4493f8 0%, #7c4af8 100%)' }}
          >
            <BookOpen size={28} className="text-white" />
          </div>

          <h2 className="text-xl font-bold mb-2" style={{ color: 'var(--text-1)' }}>
            欢迎使用语文教学工作台！
          </h2>
          <p className="text-sm mb-1" style={{ color: 'var(--text-2)' }}>
            花 <strong style={{ color: '#4493f8' }}>30 秒</strong> 体验核心功能：
          </p>

          {/* 步骤预览 */}
          <div className="flex items-center gap-2 mt-4 mb-6 text-xs" style={{ color: 'var(--text-3)' }}>
            {[
              { icon: BookOpen, label: '加载示例课堂' },
              { icon: Sparkles, label: '查看转写结果' },
              { icon: Copy,     label: '体验AI智能反馈' },
            ].map(({ icon: Icon, label }, i) => (
              <span key={i} className="flex items-center gap-1">
                {i > 0 && <ChevronRight size={12} style={{ color: 'var(--border)' }} />}
                <span
                  className="flex items-center gap-1 px-2 py-1 rounded-lg"
                  style={{ background: 'var(--bg-s2)', border: '1px solid var(--border)' }}
                >
                  <Icon size={11} /> {label}
                </span>
              </span>
            ))}
          </div>

          <button
            onClick={onStart}
            className="flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-semibold transition-all hover:opacity-90 active:scale-95"
            style={{
              background: 'linear-gradient(135deg, #4493f8 0%, #7c4af8 100%)',
              color: '#fff',
              boxShadow: '0 4px 16px #4493f840',
            }}
          >
            <Sparkles size={15} /> 开始 30 秒体验
          </button>
          <button
            onClick={onSkip}
            className="mt-3 text-xs"
            style={{ color: 'var(--text-3)' }}
          >
            跳过，直接使用
          </button>
        </div>
      </div>
    );
  }

  // ── 完成庆祝 ──────────────────────────────────────────────────────────────
  if (step === 'done') {
    return (
      <div
        className="fixed inset-0 z-50 flex items-end justify-center pb-8 pointer-events-none"
      >
        <div
          className="flex items-center gap-3 px-5 py-3.5 rounded-2xl shadow-xl pointer-events-auto"
          style={{
            background: 'linear-gradient(135deg,#22c55e10,#4493f810)',
            border: '1px solid #22c55e40',
            backdropFilter: 'blur(12px)',
          }}
        >
          <CheckCircle2 size={20} style={{ color: '#22c55e' }} />
          <div>
            <p className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>
              🎉 引导完成！
            </p>
            <p className="text-xs" style={{ color: 'var(--text-3)' }}>
              现在上传你自己的课堂录音，开始真正的教学工作
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ── 进行中的引导浮动卡片（creating / transcript / feedback） ──────────────
  const activeStep = step as 'creating' | 'transcript' | 'feedback';
  const cfg = STEP_CONFIG[activeStep];
  if (!cfg) return null;

  const Icon = cfg.icon;
  const stepNum = activeStep === 'creating' ? 1 : activeStep === 'transcript' ? 2 : 3;

  return (
    <div
      className="fixed bottom-5 left-1/2 z-40 -translate-x-1/2"
      style={{ pointerEvents: 'auto', minWidth: 340, maxWidth: 480 }}
    >
      <div
        className="flex items-start gap-3 rounded-2xl shadow-xl px-4 py-3.5"
        style={{
          background: 'var(--bg-s1)',
          border: `1px solid ${cfg.color}40`,
          backdropFilter: 'blur(16px)',
          boxShadow: `0 8px 32px ${cfg.color}20`,
        }}
      >
        {/* 左侧图标 + 步骤 */}
        <div className="flex flex-col items-center gap-1 shrink-0 pt-0.5">
          <div
            className="flex items-center justify-center w-8 h-8 rounded-xl"
            style={{ background: `${cfg.color}18`, border: `1px solid ${cfg.color}30` }}
          >
            <Icon size={15} style={{ color: cfg.color }} />
          </div>
          <span className="text-xs font-mono" style={{ color: 'var(--text-4)' }}>
            {stepNum}/3
          </span>
        </div>

        {/* 文案区 */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>
            {cfg.title}{activeStep === 'creating' ? dots : ''}
          </p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>
            {cfg.desc}
          </p>
        </div>

        {/* 右侧操作 */}
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          {/* 徽章 */}
          <span
            className="text-xs px-2 py-0.5 rounded-full font-medium"
            style={{
              background: `${cfg.color}18`,
              color: cfg.color,
              border: `1px solid ${cfg.color}30`,
            }}
          >
            {cfg.badge}
          </span>

          {/* feedback 步骤才显示「完成引导」按钮 */}
          {activeStep === 'feedback' && (
            <button
              onClick={onComplete}
              className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg font-medium transition-all hover:opacity-90"
              style={{ background: '#22c55e20', color: '#22c55e', border: '1px solid #22c55e40' }}
            >
              <CheckCircle2 size={11} /> 完成引导
            </button>
          )}

          {/* 任意步骤可跳过 */}
          <button
            onClick={onSkip}
            className="text-xs"
            style={{ color: 'var(--text-4)' }}
          >
            跳过
          </button>
        </div>
      </div>

      {/* 进度条 */}
      <div
        className="mx-4 mt-1.5 h-0.5 rounded-full overflow-hidden"
        style={{ background: 'var(--border)' }}
      >
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${(stepNum / 3) * 100}%`,
            background: `linear-gradient(90deg, ${cfg.color}, ${cfg.color}aa)`,
          }}
        />
      </div>
    </div>
  );
}
