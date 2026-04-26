-- ─────────────────────────────────────────────────────────────────────────────
-- 003_redeem_codes.sql
-- 激活码 / 邀请码（兑换码）：管理员预生成，用户在前端输入码 → 升级订阅
-- 与 user_subscriptions 联动：兑换成功后写 plan / quota_minutes / expires_at
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.redeem_codes (
  code            TEXT        PRIMARY KEY,
  plan            TEXT        NOT NULL CHECK (plan IN ('pro','elite')),
  duration_days   INTEGER     NOT NULL DEFAULT 30,             -- 一张码兑换的时长
  quota_minutes   INTEGER     NOT NULL,                        -- 兑换后用户每月配额
  expires_at      TIMESTAMPTZ,                                 -- 码本身的有效期（null = 永久有效）
  redeemed_at     TIMESTAMPTZ,                                 -- 兑换时间（null = 未兑换）
  redeemed_by     UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  note            TEXT,                                        -- 备注：渠道、订单号等
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 加速「列出未兑换」「按用户查兑换记录」
CREATE INDEX IF NOT EXISTS idx_redeem_codes_redeemed_by ON public.redeem_codes(redeemed_by);
CREATE INDEX IF NOT EXISTS idx_redeem_codes_unredeemed
  ON public.redeem_codes(code) WHERE redeemed_at IS NULL;

-- ── RLS ──────────────────────────────────────────────────────────────────────
-- 普通用户：只能 SELECT 自己已兑换过的记录（用于"我的订单/兑换记录"页面）。
-- 兑换写入走下方 redeem_code RPC（SECURITY DEFINER）；
-- 列出未兑换码 / 批量发码用 service_role 直连（gen-redeem-codes.mjs）。
ALTER TABLE public.redeem_codes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select_own_redeemed_codes"
  ON public.redeem_codes
  FOR SELECT
  USING (auth.uid() = redeemed_by);

-- service_role 完全放行（Edge Function 用）
CREATE POLICY "service_role_all_redeem_codes"
  ON public.redeem_codes
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ─────────────────────────────────────────────────────────────────────────────
-- 兑换 RPC：原子地校验 + 标记 + 升级订阅
-- 设计为 SECURITY DEFINER 以绕过 RLS；Edge Function 与前端均可调用。
-- 失败抛 EXCEPTION，前端 catch 显示 hint 文案。
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.redeem_code(p_code TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id      UUID := auth.uid();
  v_code_row     public.redeem_codes%ROWTYPE;
  v_now          TIMESTAMPTZ := NOW();
  v_new_expires  TIMESTAMPTZ;
  v_current_plan TEXT;
  v_current_exp  TIMESTAMPTZ;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'NOT_LOGGED_IN' USING HINT = '请先登录后再兑换';
  END IF;

  -- 锁行避免并发兑换
  SELECT * INTO v_code_row
    FROM public.redeem_codes
   WHERE UPPER(code) = UPPER(TRIM(p_code))
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CODE_NOT_FOUND' USING HINT = '激活码不存在';
  END IF;

  IF v_code_row.redeemed_at IS NOT NULL THEN
    RAISE EXCEPTION 'CODE_ALREADY_REDEEMED' USING HINT = '该激活码已被使用';
  END IF;

  IF v_code_row.expires_at IS NOT NULL AND v_code_row.expires_at < v_now THEN
    RAISE EXCEPTION 'CODE_EXPIRED' USING HINT = '该激活码已过期';
  END IF;

  -- 当前订阅状态
  SELECT plan, expires_at
    INTO v_current_plan, v_current_exp
    FROM public.user_subscriptions
   WHERE user_id = v_user_id
   FOR UPDATE;

  -- 没有行就建一行
  IF NOT FOUND THEN
    INSERT INTO public.user_subscriptions (user_id) VALUES (v_user_id);
    v_current_plan := 'free';
    v_current_exp  := NULL;
  END IF;

  -- 续期逻辑：若已经是同档付费且未过期，从原 expires_at 累加；否则从今天起算
  IF v_current_plan = v_code_row.plan AND v_current_exp IS NOT NULL AND v_current_exp > v_now THEN
    v_new_expires := v_current_exp + (v_code_row.duration_days || ' days')::INTERVAL;
  ELSE
    v_new_expires := v_now + (v_code_row.duration_days || ' days')::INTERVAL;
  END IF;

  UPDATE public.user_subscriptions
     SET plan          = v_code_row.plan,
         quota_minutes = v_code_row.quota_minutes,
         expires_at    = v_new_expires,
         used_minutes  = CASE
                          -- 升档时重置当月用量；同档续期保留
                          WHEN v_current_plan != v_code_row.plan THEN 0
                          ELSE used_minutes
                         END,
         period_start  = CASE
                          WHEN v_current_plan != v_code_row.plan THEN date_trunc('month', NOW() AT TIME ZONE 'Asia/Shanghai')
                          ELSE period_start
                         END,
         updated_at    = NOW()
   WHERE user_id = v_user_id;

  -- 标记码已用
  UPDATE public.redeem_codes
     SET redeemed_at = v_now,
         redeemed_by = v_user_id
   WHERE code = v_code_row.code;

  RETURN json_build_object(
    'success',       true,
    'plan',          v_code_row.plan,
    'quota_minutes', v_code_row.quota_minutes,
    'expires_at',    v_new_expires
  );
END;
$$;

-- 让 authenticated 角色可以 EXECUTE（SECURITY DEFINER，内部用 auth.uid() 鉴权）
GRANT EXECUTE ON FUNCTION public.redeem_code(TEXT) TO authenticated;
