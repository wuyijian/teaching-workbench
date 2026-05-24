import type { Settings } from '../types';
import { resolveApiBase } from '../config/urls';
import { hasPlatformLlm } from '../config/platformApi';

export const ABILITY_DIMENSIONS = [
  '朗读流利度',
  '发音准确性',
  '阅读理解',
  '表达逻辑',
  '语言积累',
  '学习态度',
] as const;

export type AbilityDimension = (typeof ABILITY_DIMENSIONS)[number];
export type AbilityScores = Record<AbilityDimension, number>;

/**
 * 调用 LLM 对学生历史反馈的 6 个维度打分（1-10 分）。
 * 要求至少 2 条反馈，否则外层应直接拦截。
 */
export async function analyzeStudentAbilities(
  feedbacks: string[],
  settings: Settings,
): Promise<AbilityScores> {
  const combined = feedbacks.join('\n\n---\n\n');

  const prompt =
    `根据以下学生历史反馈，对该学生在6个维度打分（1-10分），` +
    `只返回纯JSON，格式如下，不要有任何其他文字：\n` +
    `{"朗读流利度":8,"发音准确性":6,"阅读理解":7,"表达逻辑":5,"语言积累":7,"学习态度":9}\n\n` +
    `历史反馈：\n${combined}`;

  if (!hasPlatformLlm()) {
    // 演示模式：返回模拟分数
    const scores = {} as AbilityScores;
    for (const dim of ABILITY_DIMENSIONS) {
      scores[dim] = Math.floor(Math.random() * 4) + 5;
    }
    return scores;
  }

  const base = resolveApiBase(settings.apiBaseUrl);
  const url = `${base}/chat/completions`;

  let resp: Response;
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.apiKey}`,
      },
      body: JSON.stringify({
        model: settings.model,
        messages: [{ role: 'user', content: prompt }],
        stream: false,
      }),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`网络请求失败：${msg}`);
  }

  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`API 错误 ${resp.status}：${body}`);
  }

  const data = await resp.json();
  const content: string = data.choices?.[0]?.message?.content ?? '';

  // 从返回内容中提取 JSON（兼容 markdown 代码块包裹等情况）
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error(`无法解析 AI 返回内容：${content.slice(0, 200)}`);

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    throw new Error(`JSON 解析失败：${jsonMatch[0].slice(0, 200)}`);
  }

  const scores = {} as AbilityScores;
  for (const dim of ABILITY_DIMENSIONS) {
    const val = Number(parsed[dim]);
    scores[dim] = isNaN(val) ? 5 : Math.min(10, Math.max(1, Math.round(val)));
  }
  return scores;
}
