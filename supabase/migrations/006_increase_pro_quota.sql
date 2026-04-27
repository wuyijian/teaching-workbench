-- ─────────────────────────────────────────────────────────────────────────────
-- 006_increase_pro_quota.sql
-- 把专业版（pro）月度配额从 1200 分钟（20 小时）提到 3000 分钟（50 小时）
--
-- 影响范围：
-- 1) 已订阅 pro 的存量用户：当月起即享 50 小时配额
-- 2) 已生成但未兑换的 pro 激活码：兑换时直接拿到 50 小时
-- 3) 不动 elite（60 小时）和 free（3 小时）
--
-- 002 里 user_subscriptions.quota_minutes 的 DEFAULT 是 180（free 默认值），
-- pro 用户的 3000 是激活时由 redeem_code RPC 写入的，所以这里不动 DEFAULT。
-- ─────────────────────────────────────────────────────────────────────────────

-- 1) 提升所有现有 pro 订阅的配额
--    用 < 3000 防止误覆盖某些促销码可能写入的更高额度（防御性约束）
UPDATE public.user_subscriptions
   SET quota_minutes = 3000,
       updated_at    = NOW()
 WHERE plan = 'pro'
   AND quota_minutes < 3000;

-- 2) 提升所有未兑换的 pro 激活码的额度
UPDATE public.redeem_codes
   SET quota_minutes = 3000
 WHERE plan = 'pro'
   AND redeemed_at IS NULL
   AND quota_minutes < 3000;

-- 验证（运行后看一眼数字应当 ≥ 0；负数说明业务逻辑出错）：
-- SELECT plan, COUNT(*) AS users, AVG(quota_minutes)::INT AS avg_quota
--   FROM public.user_subscriptions GROUP BY plan;
-- SELECT plan, COUNT(*) AS unredeemed, AVG(quota_minutes)::INT AS avg_quota
--   FROM public.redeem_codes WHERE redeemed_at IS NULL GROUP BY plan;
