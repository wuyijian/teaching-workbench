-- 用户扩展信息表
-- 关联 auth.users，支持微信等第三方登录
-- 在 Supabase Dashboard → SQL Editor 中执行此脚本

CREATE TABLE IF NOT EXISTS public.user_profiles (
  id           UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  wechat_openid TEXT       UNIQUE,
  nickname     TEXT,
  avatar_url   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Row Level Security
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

-- 用户只能读写自己的资料
CREATE POLICY "select_own_profile"
  ON public.user_profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "update_own_profile"
  ON public.user_profiles FOR UPDATE
  USING (auth.uid() = id);

-- Service role 可以写入（Edge Function 使用）
CREATE POLICY "service_role_all"
  ON public.user_profiles FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- 自动更新 updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER user_profiles_updated_at
  BEFORE UPDATE ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
