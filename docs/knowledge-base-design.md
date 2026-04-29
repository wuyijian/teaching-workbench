# 知识库设计文档

> 状态：设计完成，暂未开发  
> 设计日期：2026-04-29  
> 设计者：AI 助手

---

## 一、背景与目标

为教学工作台搭建 Karpathy 风格的语义知识库，用于：
- 存储并检索学生历史档案、课堂记录
- 存储老师上传的语文教学知识（古诗解析、作文技巧、考点梳理等）
- RAG 增强 AI 反馈生成：生成前自动检索相关历史和知识，注入 system prompt

---

## 二、架构图

```
┌─────────────────────────────────────────────────────┐
│                    前端（React）                      │
│  FeedbackPanel → [生成时自动 RAG 检索注入 context]   │
│  KnowledgeBase 页 → [上传/管理教学资料]              │
└────────────┬──────────────────┬──────────────────────┘
             │ 写入              │ 检索
             ▼                  ▼
┌─────────────────────────────────────────────────────┐
│                  Supabase                            │
│  kb_documents  (原始文档)                            │
│  kb_chunks     (切片 + embedding vector(1536))       │
│  kb_search()   (pgvector 余弦相似度函数)             │
└────────────────────────┬────────────────────────────┘
                         │ embed 时调用
                         ▼
              DashScope text-embedding-v3
              api.dashscope.aliyuncs.com
              （OpenAI 兼容，中文优化）
```

---

## 三、技术选型

| 组件 | 选型 | 说明 |
|---|---|---|
| 向量存储 | Supabase pgvector | 已有 Supabase，零新增服务 |
| Embedding 模型 | 阿里云 DashScope `text-embedding-v3` | 中文效果佳，阿里云同账号申请，OpenAI 兼容，3 元/百万 token |
| 切片策略 | 段落切分，约 400 字 + 50 字重叠 | 语文内容多段落，按自然段切效果好 |
| 检索方式 | pgvector 余弦相似度 | 支持按 doc_type / student_name 过滤 |
| LLM | Kimi k2.5（现有） | Kimi 官方不提供 /embeddings，故 embedding 单独用 DashScope |

> **注意**：Kimi (api.moonshot.cn) 不支持 `/v1/embeddings` 端点，必须使用独立 embedding 服务。

---

## 四、知识来源（4 类文档）

| doc_type | 说明 | 写入时机 |
|---|---|---|
| `student_profile` | 每个学生的综合画像（学习风格、薄弱点、历史表现） | 老师保存学生档案时自动写入/覆盖 |
| `lesson_record` | 每节课的转写 + AI 反馈全文 | 保存 AI 反馈时自动写入（task_id 去重） |
| `teaching_material` | 老师上传的语文资料（古诗解析、作文技巧等） | 老师手动上传 .txt/.md 或粘贴文本 |
| `feedback_example` | 优质反馈示范，供生成参考 | 老师把某条反馈标记"收藏为范例"时 |

---

## 五、数据库 Schema

```sql
-- supabase/migrations/008_knowledge_base.sql

-- 启用向量扩展
CREATE EXTENSION IF NOT EXISTS vector;

-- 文档表（原始内容）
CREATE TABLE public.kb_documents (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid REFERENCES auth.users ON DELETE CASCADE,
  doc_type     text NOT NULL CHECK (doc_type IN (
                 'student_profile',
                 'lesson_record',
                 'teaching_material',
                 'feedback_example'
               )),
  title        text NOT NULL,
  student_name text,
  content      text NOT NULL,
  metadata     jsonb DEFAULT '{}',   -- task_id, tags, source 等
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now()
);

-- 切片表（带向量）
CREATE TABLE public.kb_chunks (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_id       uuid REFERENCES public.kb_documents ON DELETE CASCADE,
  chunk_index  int NOT NULL,
  content      text NOT NULL,
  embedding    vector(1536),         -- DashScope text-embedding-v3
  created_at   timestamptz DEFAULT now()
);

-- 向量搜索函数
CREATE FUNCTION public.kb_search(
  query_embedding vector(1536),
  match_count     int DEFAULT 5,
  filter_doc_type text DEFAULT NULL,
  filter_student  text DEFAULT NULL,
  filter_user     uuid DEFAULT NULL
) RETURNS TABLE (
  chunk_id     uuid,
  doc_id       uuid,
  doc_type     text,
  title        text,
  student_name text,
  content      text,
  similarity   float
) LANGUAGE sql AS $$
  SELECT c.id, d.id, d.doc_type, d.title, d.student_name, c.content,
         1 - (c.embedding <=> query_embedding) AS similarity
  FROM public.kb_chunks c
  JOIN public.kb_documents d ON d.id = c.doc_id
  WHERE (filter_doc_type IS NULL OR d.doc_type = filter_doc_type)
    AND (filter_student  IS NULL OR d.student_name = filter_student)
    AND (filter_user     IS NULL OR d.user_id = filter_user)
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count;
$$;

-- RLS
ALTER TABLE public.kb_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kb_chunks    ENABLE ROW LEVEL SECURITY;

CREATE POLICY "用户只能访问自己的文档"
  ON public.kb_documents FOR ALL
  USING (auth.uid() = user_id);

CREATE POLICY "用户只能访问自己文档的切片"
  ON public.kb_chunks FOR ALL
  USING (doc_id IN (SELECT id FROM public.kb_documents WHERE user_id = auth.uid()));
```

---

## 六、新增环境变量

```env
# 阿里云 DashScope，用于知识库 embedding（Kimi 不支持 /embeddings）
VITE_DASHSCOPE_API_KEY=sk-xxxx
```

- Base URL：`https://dashscope.aliyuncs.com/compatible-mode/v1`
- 模型：`text-embedding-v3`
- 申请地址：https://dashscope.aliyuncs.com（阿里云同账号）

---

## 七、前端模块规划

```
src/
  utils/
    kb.ts              ← embedding 调用、切片、写入、检索核心逻辑
  components/
    KnowledgeBase/
      index.tsx        ← 知识库管理主页
      UploadPanel.tsx  ← 上传/粘贴教学资料
      DocList.tsx      ← 文档列表管理
  context/
    KbContext.tsx      ← 提供 search() / ingest() 给全局使用
```

---

## 八、RAG 增强反馈（核心逻辑）

在 `FeedbackPanel` 生成反馈前，静默调用检索，把结果拼入 system prompt：

```typescript
// src/utils/kb.ts 核心检索逻辑（待实现）
const [history, knowledge] = await Promise.all([
  kbSearch(taskContext, { student: studentName, topK: 3 }),
  kbSearch(taskContext, { docType: 'teaching_material', topK: 2 }),
])

systemPrompt += history.length
  ? `\n\n【${studentName}历史表现】\n${history.map(c => c.content).join('\n---\n')}`
  : ''
systemPrompt += knowledge.length
  ? `\n\n【相关教学知识】\n${knowledge.map(c => c.content).join('\n---\n')}`
  : ''
```

---

## 九、实现阶段

| 阶段 | 内容 | 涉及文件 | 预估工作量 |
|---|---|---|---|
| **P0** | Supabase 建表 + 课堂记录/学生档案自动写入 | 008 migration + kb.ts | 小 |
| **P1** | Embedding + 向量检索 + 注入 AI 反馈 system prompt | kb.ts + FeedbackPanel | 中 |
| **P2** | 教学资料上传 UI + 文档管理 | KnowledgeBase 组件 | 中 |
| **P3** | 反馈页"知识库来源"badge + 收藏为范例 | FeedbackPanel + StudentArchive | 小 |

---

## 十、开发前 Checklist

- [ ] 申请阿里云 DashScope API Key（同账号，https://dashscope.aliyuncs.com）
- [ ] 在 Supabase 控制台启用 pgvector 扩展（Database → Extensions → vector）
- [ ] 将 `VITE_DASHSCOPE_API_KEY` 加入 GitHub Actions Secrets 和本地 `.env.production`
- [ ] 在 Supabase SQL Editor 执行 `008_knowledge_base.sql`
- [ ] 确认 Nginx 反代配置需否增加 DashScope 的代理路径（`/dashscope-api/`）
