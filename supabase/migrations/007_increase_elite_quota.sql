-- ─────────────────────────────────────────────────────────────────────────────
-- 007_increase_elite_quota.sql
-- 把机构版（elite）月度配额从 3600 分钟（60 小时）提到 30000 分钟（500 小时）
--
-- 影响范围：
-- 1) 已订阅 elite 的存量用户：当月起即享 500 小时配额
-- 2) 已生成但未兑换的 elite 激活码：兑换时直接拿到 500 小时
-- 3) 不动 free（3 小时）和 pro（50 小时，见 006）
-- ─────────────────────────────────────────────────────────────────────────────

-- 1) 提升所有现有 elite 订阅的配额
--    用 < 30000 防止误覆盖某些促销码可能写入的更高额度（防御性约束）
UPDATE public.user_subscriptions
   SET quota_minutes = 30000,
       updated_at    = NOW()
 WHERE plan = 'elite'
   AND quota_minutes < 30000;

-- 2) 提升所有未兑换的 elite 激活码的额度
UPDATE public.redeem_codes
   SET quota_minutes = 30000
 WHERE plan = 'elite'
   AND redeemed_at IS NULL
   AND quota_minutes < 30000;

-- 验证：
-- SELECT plan, COUNT(*) AS users, AVG(quota_minutes)::INT AS avg_quota_min
--   FROM public.user_subscriptions GROUP BY plan;
-- SELECT plan, COUNT(*) AS unredeemed, AVG(quota_minutes)::INT AS avg_quota_min
--   FROM public.redeem_codes WHERE redeemed_at IS NULL GROUP BY plan;
