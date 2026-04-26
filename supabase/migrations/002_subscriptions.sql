-- 订阅与配额表
-- 每个用户一行，plan 字段区分档位，每月自动重置 used_minutes

CREATE TABLE IF NOT EXISTS public.user_subscriptions (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  plan          TEXT        NOT NULL DEFAULT 'free'
                              CHECK (plan IN ('free','pro','elite')),
  quota_minutes INTEGER     NOT NULL DEFAULT 180,   -- free: 3h, pro: 1200(20h), elite: 3600(60h)
  used_minutes  NUMERIC     NOT NULL DEFAULT 0,
  period_start  TIMESTAMPTZ NOT NULL DEFAULT date_trunc('month', NOW() AT TIME ZONE 'Asia/Shanghai'),
  expires_at    TIMESTAMPTZ,                         -- 付费到期时间（null = 永久免费）
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS
ALTER TABLE public.user_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select_own_subscription"
  ON public.user_subscriptions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "update_own_subscription"
  ON public.user_subscriptions FOR UPDATE
  USING (auth.uid() = user_id);

-- Service role（后台 / Edge Function 写入、扣量）
CREATE POLICY "service_role_all_subscriptions"
  ON public.user_subscriptions FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- 用户首次登录时自动创建免费订阅行
CREATE OR REPLACE FUNCTION public.create_free_subscription()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.user_subscriptions (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created_subscription
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.create_free_subscription();

-- 自动更新 updated_at（复用已有函数 update_updated_at）
CREATE TRIGGER user_subscriptions_updated_at
  BEFORE UPDATE ON public.user_subscriptions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
