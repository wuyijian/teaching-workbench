-- ─────────────────────────────────────────────────────────────────────────────
-- 004_secure_subscriptions.sql
-- 收紧订阅表的写入权限：用户不能再直接 UPDATE plan / quota_minutes / expires_at，
-- 所有写入必须走 SECURITY DEFINER RPC（redeem_code 已存在；新增 consume_quota）。
-- 防止恶意用户通过 PostgREST 直连篡改自己的订阅档位绕过付费。
-- ─────────────────────────────────────────────────────────────────────────────

-- 1) 撤销原 UPDATE 策略（之前允许用户更新整行任意列）
DROP POLICY IF EXISTS "update_own_subscription" ON public.user_subscriptions;

-- 2) 新增扣量 RPC：客户端转写完成后调用，原子地累加 used_minutes
--    其它列由 redeem_code RPC 维护；用户无法通过此函数改 plan / quota
CREATE OR REPLACE FUNCTION public.consume_quota(p_minutes INTEGER)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id      UUID := auth.uid();
  v_used         NUMERIC;
  v_quota        INTEGER;
  v_period_start TIMESTAMPTZ;
  v_now          TIMESTAMPTZ := NOW();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'NOT_LOGGED_IN' USING HINT = '请先登录';
  END IF;
  IF p_minutes IS NULL OR p_minutes <= 0 THEN
    RAISE EXCEPTION 'INVALID_MINUTES' USING HINT = '扣量参数必须为正整数';
  END IF;
  IF p_minutes > 600 THEN
    -- 防御：单次扣量 > 10h 视为异常请求
    RAISE EXCEPTION 'EXCESSIVE_MINUTES' USING HINT = '单次扣量过大';
  END IF;

  SELECT used_minutes, quota_minutes, period_start
    INTO v_used, v_quota, v_period_start
    FROM public.user_subscriptions
   WHERE user_id = v_user_id
   FOR UPDATE;

  -- 没有订阅行就建一行（兜底；正常情况下 trigger on_auth_user_created_subscription 已建）
  IF NOT FOUND THEN
    INSERT INTO public.user_subscriptions (user_id) VALUES (v_user_id);
    v_used := 0;
    v_quota := 180;
    v_period_start := date_trunc('month', v_now AT TIME ZONE 'Asia/Shanghai');
  END IF;

  -- 跨月自动重置
  IF date_trunc('month', v_period_start AT TIME ZONE 'Asia/Shanghai')
       <> date_trunc('month', v_now AT TIME ZONE 'Asia/Shanghai') THEN
    v_used := 0;
    UPDATE public.user_subscriptions
       SET used_minutes = 0,
           period_start = date_trunc('month', v_now AT TIME ZONE 'Asia/Shanghai'),
           updated_at = v_now
     WHERE user_id = v_user_id;
  END IF;

  UPDATE public.user_subscriptions
     SET used_minutes = used_minutes + p_minutes,
         updated_at   = v_now
   WHERE user_id = v_user_id;

  RETURN json_build_object(
    'used_minutes',  v_used + p_minutes,
    'quota_minutes', v_quota
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.consume_quota(INTEGER) TO authenticated;

-- 3) 显式禁止 anon / authenticated 直接对表 UPDATE/INSERT/DELETE
--    （RLS 已默认 deny，但补充 REVOKE 以双保险，避免任何 GRANT 漏配）
REVOKE INSERT, UPDATE, DELETE ON public.user_subscriptions FROM anon, authenticated;

-- 4) 让 PostgREST 重新加载 schema cache
NOTIFY pgrst, 'reload schema';
