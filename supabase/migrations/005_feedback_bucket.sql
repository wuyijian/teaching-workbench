-- ─────────────────────────────────────────────────────────────────────────────
-- 005_feedback_bucket.sql
-- 用户「提交建议」入口：所有反馈以 JSON 文件形式落到 Storage 的 feedback bucket。
--   - 路径规范：YYYY-MM-DD/<timestamp>-<shortid>.json
--   - 任何人（含未登录）都可 INSERT；不可 SELECT / UPDATE / DELETE
--   - 管理员通过 Supabase Dashboard → Storage → feedback 查看，
--     或用 service_role key 写脚本拉取
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. 创建 bucket（private）。Supabase 的 storage.buckets 表里没有的话才插。
INSERT INTO storage.buckets (id, name, public)
VALUES ('feedback', 'feedback', false)
ON CONFLICT (id) DO NOTHING;

-- 2. RLS 策略 ── 仅允许 INSERT
DROP POLICY IF EXISTS "feedback_insert_anyone" ON storage.objects;
CREATE POLICY "feedback_insert_anyone"
  ON storage.objects
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (bucket_id = 'feedback');

-- 3. 显式撤销 anon / authenticated 在 storage.objects 上对该 bucket 的 SELECT/UPDATE/DELETE
--    （storage.objects 默认开启 RLS，没有 policy 就是禁止；这里加一道保险）
DROP POLICY IF EXISTS "feedback_select_anyone"   ON storage.objects;
DROP POLICY IF EXISTS "feedback_update_anyone"   ON storage.objects;
DROP POLICY IF EXISTS "feedback_delete_anyone"   ON storage.objects;
