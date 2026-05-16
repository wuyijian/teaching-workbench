export interface KnowledgeBaseEntry {
  id: string;
  title: string;
  sourceUrl: string;
  publishedYear: number;
  publishedAt?: string;
  tags: string[];
  summary: string;
}

export interface KnowledgeSearchOptions {
  query?: string;
  tags?: string[];
  year?: number;
  topN?: number;
}
