-- 任务数据云端存储：转写任务 + 分段文本
-- 关联 auth.users，支持多设备同步
-- 在 Supabase Dashboard → SQL Editor 中执行此脚本

-- ─────────────────────────────────────────
-- 主表：tasks
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tasks (
  id                      TEXT          PRIMARY KEY,
  user_id                 UUID          NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  student_names           TEXT[]        NOT NULL DEFAULT '{}',
  topic                   TEXT          NOT NULL DEFAULT '',
  task_type               TEXT          NOT NULL DEFAULT 'transcribe',
  engine                  TEXT          NOT NULL DEFAULT 'volcano',
  audio_file_name         TEXT          NOT NULL DEFAULT '',
  status                  TEXT          NOT NULL DEFAULT 'queued',
  progress                INTEGER       NOT NULL DEFAULT 0,
  language                TEXT          NOT NULL DEFAULT 'zh-CN',
  duration_sec            NUMERIC,
  notes                   TEXT,
  exam_analysis           TEXT,
  exam_file               JSONB,
  exam_kimi_file_id       TEXT,
  exam_kimi_upload_status TEXT,
  ai_summary              TEXT,
  ai_saved_at             BIGINT,
  feedback_prompt         TEXT,
  error_message           TEXT,
  created_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────
-- 分段表：task_segments
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.task_segments (
  id            UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id       TEXT    NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  user_id       UUID    NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  idx           INTEGER NOT NULL,
  timestamp_sec NUMERIC NOT NULL DEFAULT 0,
  text          TEXT    NOT NULL DEFAULT '',
  speaker       TEXT,
  is_final      BOOLEAN NOT NULL DEFAULT TRUE
);

-- ─────────────────────────────────────────
-- Row Level Security
-- ─────────────────────────────────────────
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_segments ENABLE ROW LEVEL SECURITY;

-- tasks：用户只能读写自己的
CREATE POLICY "tasks_select_own"
  ON public.tasks FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "tasks_insert_own"
  ON public.tasks FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "tasks_update_own"
  ON public.tasks FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "tasks_delete_own"
  ON public.tasks FOR DELETE
  USING (auth.uid() = user_id);

-- task_segments：用户只能读写自己的
CREATE POLICY "task_segments_select_own"
  ON public.task_segments FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "task_segments_insert_own"
  ON public.task_segments FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "task_segments_update_own"
  ON public.task_segments FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "task_segments_delete_own"
  ON public.task_segments FOR DELETE
  USING (auth.uid() = user_id);

-- ─────────────────────────────────────────
-- 触发器：updated_at 自动更新（复用 001 中已创建的函数）
-- ─────────────────────────────────────────
CREATE TRIGGER tasks_updated_at
  BEFORE UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─────────────────────────────────────────
-- 索引
-- ─────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_tasks_user_created
  ON public.tasks (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_task_segments_task_idx
  ON public.task_segments (task_id, idx);
