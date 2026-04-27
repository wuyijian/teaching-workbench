#!/usr/bin/env node
/**
 * 批量生成激活码 / 兑换码（管理员脚本）
 *
 * 用法：
 *   node scripts/gen-redeem-codes.mjs --plan pro --count 10 --days 30
 *   node scripts/gen-redeem-codes.mjs --plan elite --count 3 --days 365 --note "2026-04 小红书渠道"
 *
 * 必需环境变量：
 *   SUPABASE_URL                Supabase 项目 URL（不带 /rest/v1）
 *   SUPABASE_SERVICE_ROLE_KEY   service_role 密钥（保密！）
 *
 * 注意：service_role 拥有最高权限，仅在本机或 CI 安全环境运行，绝不上传到前端。
 */

import { createClient } from '@supabase/supabase-js';
import process from 'node:process';
import crypto from 'node:crypto';

const PLAN_DEFAULTS = {
  pro:   { quota: 3000 }, // 50h
  elite: { quota: 3600 }, // 60h
};

function arg(name, fallback) {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1) return fallback;
  return process.argv[idx + 1];
}

const url  = process.env.SUPABASE_URL;
const key  = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env');
  process.exit(1);
}

const plan          = arg('plan', 'pro');
const count         = Number(arg('count', '1'));
const days          = Number(arg('days', '30'));
const note          = arg('note', '');
const customQuota   = arg('quota');

if (!PLAN_DEFAULTS[plan]) {
  console.error(`Invalid plan: ${plan}. Must be one of: ${Object.keys(PLAN_DEFAULTS).join(', ')}`);
  process.exit(1);
}
if (count <= 0 || count > 1000) {
  console.error('count must be 1..1000');
  process.exit(1);
}

const quotaMinutes = customQuota ? Number(customQuota) : PLAN_DEFAULTS[plan].quota;

const sb = createClient(url, key, { auth: { persistSession: false } });

// 12 位大写 base32：避免易混的 0/O/1/I
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function genCode(len = 12) {
  const bytes = crypto.randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += ALPHA[bytes[i] % ALPHA.length];
  // 4-4-4 分段：XXXX-XXXX-XXXX 更易输入
  return `${out.slice(0, 4)}-${out.slice(4, 8)}-${out.slice(8, 12)}`;
}

const rows = [];
for (let i = 0; i < count; i++) {
  rows.push({
    code:           genCode(),
    plan,
    duration_days:  days,
    quota_minutes:  quotaMinutes,
    note:           note || null,
  });
}

const { data, error } = await sb.from('redeem_codes').insert(rows).select('code');
if (error) {
  console.error('Insert failed:', error.message);
  process.exit(1);
}

console.log(`✓ Generated ${data.length} ${plan} codes (${days} days, ${quotaMinutes} min/month):\n`);
for (const r of data) console.log('  ' + r.code);
console.log(`\nKeep them safe. Send to buyers along with payment confirmation.`);
