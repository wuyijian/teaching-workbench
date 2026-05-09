-- 管理员数据大盘 RPC
-- SECURITY DEFINER：允许函数以 postgres 身份访问 auth.users（绕过 RLS）
-- 客户端另有 VITE_ADMIN_EMAIL 守门，防止普通用户调用此函数拿到聚合统计

CREATE OR REPLACE FUNCTION public.get_admin_stats()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result JSON;
BEGIN
  SELECT json_build_object(
    -- 用户注册
    'total_users',
      (SELECT COUNT(*) FROM auth.users),
    'users_today',
      (SELECT COUNT(*) FROM auth.users
       WHERE (created_at AT TIME ZONE 'Asia/Shanghai')::date
             = (NOW() AT TIME ZONE 'Asia/Shanghai')::date),
    'users_week',
      (SELECT COUNT(*) FROM auth.users
       WHERE created_at >= (date_trunc('week', NOW() AT TIME ZONE 'Asia/Shanghai')
                            AT TIME ZONE 'Asia/Shanghai')),
    'users_month',
      (SELECT COUNT(*) FROM auth.users
       WHERE created_at >= (date_trunc('month', NOW() AT TIME ZONE 'Asia/Shanghai')
                            AT TIME ZONE 'Asia/Shanghai')),

    -- 计划分布
    'plan_free',
      (SELECT COUNT(*) FROM public.user_subscriptions WHERE plan = 'free'),
    'plan_pro',
      (SELECT COUNT(*) FROM public.user_subscriptions WHERE plan = 'pro'),
    'plan_elite',
      (SELECT COUNT(*) FROM public.user_subscriptions WHERE plan = 'elite'),

    -- 转写用量
    'total_used_minutes',
      (SELECT COALESCE(SUM(used_minutes), 0)::BIGINT FROM public.user_subscriptions),
    'active_users_month',
      (SELECT COUNT(*) FROM public.user_subscriptions WHERE used_minutes > 0),

    'generated_at', NOW()
  ) INTO result;

  RETURN result;
END;
$$;

-- 允许所有已认证用户调用（访问控制在客户端由 VITE_ADMIN_EMAIL 保障）
GRANT EXECUTE ON FUNCTION public.get_admin_stats() TO authenticated;
