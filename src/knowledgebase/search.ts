import { HANGZHOU_CHINESE_TEACHING_ENTRIES } from './entries';
import type { KnowledgeBaseEntry, KnowledgeSearchOptions } from './schema';

const DEFAULT_QUERY = '杭州 初中语文 中考 阅读 写作 命题 教研';

function tokenize(text: string): string[] {
  const matches = text
    .toLowerCase()
    .match(/[\u4e00-\u9fa5]{2,}|[a-z0-9]{2,}/g);
  if (!matches) return [];
  return Array.from(new Set(matches));
}

function includesAny(haystack: string, terms: string[]): boolean {
  return terms.some((term) => haystack.includes(term));
}

function scoreEntry(entry: KnowledgeBaseEntry, tokens: string[]): number {
  const title = entry.title.toLowerCase();
  const tags = entry.tags.join(' ').toLowerCase();
  const summary = entry.summary.toLowerCase();
  let score = 0;

  for (const token of tokens) {
    if (/^\d{4}$/.test(token) && Number(token) === entry.publishedYear) score += 3;
    if (title.includes(token)) score += 5;
    if (tags.includes(token)) score += 3;
    if (summary.includes(token)) score += 1;
  }

  return score;
}

export function searchKnowledgeBase(options: KnowledgeSearchOptions = {}): KnowledgeBaseEntry[] {
  const { query = '', tags = [], year, topN = 5 } = options;
  const queryTokens = tokenize(query);
  const normalizedTags = tags.map((tag) => tag.toLowerCase());

  let candidates = HANGZHOU_CHINESE_TEACHING_ENTRIES.filter((entry) => {
    if (year && entry.publishedYear !== year) return false;
    if (normalizedTags.length === 0) return true;
    const joined = entry.tags.join(' ').toLowerCase();
    return includesAny(joined, normalizedTags);
  });

  if (queryTokens.length === 0) {
    candidates = candidates
      .slice()
      .sort((a, b) => b.publishedYear - a.publishedYear);
    return candidates.slice(0, topN);
  }

  return candidates
    .map((entry) => ({ entry, score: scoreEntry(entry, queryTokens) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.entry.publishedYear - a.entry.publishedYear;
    })
    .slice(0, topN)
    .map((item) => item.entry);
}

export function getKnowledgeReferences(query: string, topN = 5): KnowledgeBaseEntry[] {
  const primary = searchKnowledgeBase({ query, topN });
  if (primary.length >= Math.min(topN, 3)) return primary;

  const fallback = searchKnowledgeBase({
    query: `${query} ${DEFAULT_QUERY}`.trim(),
    topN: topN + 3,
  });
  const merged = [...primary];
  for (const entry of fallback) {
    if (!merged.some((item) => item.id === entry.id)) merged.push(entry);
    if (merged.length >= topN) break;
  }
  return merged;
}

export function formatKnowledgeReferencesBlock(entries: KnowledgeBaseEntry[]): string {
  if (entries.length === 0) return '';
  const lines = entries.map((entry, index) => {
    const dateOrYear = entry.publishedAt ?? String(entry.publishedYear);
    return `${index + 1}. 《${entry.title}》｜${dateOrYear}｜标签：${entry.tags.join('、')}\n   摘要：${entry.summary}\n   来源：${entry.sourceUrl}`;
  });
  return `\n参考资料（杭州中学语文教学公开资料）：\n${lines.join('\n')}`;
}
