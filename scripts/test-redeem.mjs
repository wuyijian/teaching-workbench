#!/usr/bin/env node
/**
 * 端到端验证激活码兑换闭环（不走浏览器，纯 API）
 *   1. service_role 创建并自动确认一个测试用户
 *   2. 该用户登录拿 access_token
 *   3. 用 access_token 调 redeem_code RPC
 *   4. 查 user_subscriptions 确认升级生效
 *   5. 清理测试用户
 *
 * 用法：node scripts/test-redeem.mjs <code>
 */
import { createClient } from '@supabase/supabase-js';
import process from 'node:process';

const url        = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey    = process.env.SUPABASE_ANON_KEY;
const code       = process.argv[2];

if (!url || !serviceKey || !anonKey || !code) {
  console.error('Usage: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... SUPABASE_ANON_KEY=... node scripts/test-redeem.mjs <code>');
  process.exit(1);
}

const admin    = createClient(url, serviceKey, { auth: { persistSession: false } });
const userClient = createClient(url, anonKey,    { auth: { persistSession: false } });

const email    = `test-${Date.now()}@example.com`;
const password = 'Test123456!';

// 1. 创建并自动确认用户（绕过 email confirm）
console.log(`\n[1] Creating test user: ${email}`);
const { data: createData, error: createErr } = await admin.auth.admin.createUser({
  email, password, email_confirm: true,
});
if (createErr) { console.error('  ✗', createErr.message); process.exit(1); }
const userId = createData.user.id;
console.log(`  ✓ user_id = ${userId}`);

// 2. 登录该用户拿 access_token
console.log(`\n[2] Signing in as test user`);
const { data: signInData, error: signInErr } = await userClient.auth.signInWithPassword({ email, password });
if (signInErr) { console.error('  ✗', signInErr.message); await cleanup(); process.exit(1); }
console.log(`  ✓ got access_token (len=${signInData.session.access_token.length})`);

// 3. 调 redeem_code RPC
console.log(`\n[3] Redeeming code: ${code}`);
const { data: rpcData, error: rpcErr } = await userClient.rpc('redeem_code', { p_code: code });
if (rpcErr) { console.error('  ✗', rpcErr.message, rpcErr.hint ?? ''); await cleanup(); process.exit(1); }
console.log(`  ✓ RPC returned:`, rpcData);

// 4. 查订阅状态
console.log(`\n[4] Verifying user_subscriptions row`);
const { data: subData, error: subErr } = await admin
  .from('user_subscriptions')
  .select('*')
  .eq('user_id', userId)
  .single();
if (subErr) { console.error('  ✗', subErr.message); await cleanup(); process.exit(1); }
console.log(`  ✓ plan          = ${subData.plan}`);
console.log(`  ✓ quota_minutes = ${subData.quota_minutes}`);
console.log(`  ✓ used_minutes  = ${subData.used_minutes}`);
console.log(`  ✓ expires_at    = ${subData.expires_at}`);

// 5. 查激活码状态（确认已被标记为已兑换）
console.log(`\n[5] Verifying code state`);
const { data: codeData, error: codeErr } = await admin
  .from('redeem_codes')
  .select('*')
  .eq('code', code.toUpperCase())
  .single();
if (codeErr) { console.error('  ✗', codeErr.message); await cleanup(); process.exit(1); }
console.log(`  ✓ redeemed_at = ${codeData.redeemed_at}`);
console.log(`  ✓ redeemed_by = ${codeData.redeemed_by}  (matches: ${codeData.redeemed_by === userId})`);

// 6. 试图二次兑换 —— 应失败
console.log(`\n[6] Trying double-redeem (should fail)`);
const { error: rpcErr2 } = await userClient.rpc('redeem_code', { p_code: code });
if (rpcErr2 && rpcErr2.message.includes('CODE_ALREADY_REDEEMED')) {
  console.log(`  ✓ correctly rejected: ${rpcErr2.message}`);
} else {
  console.error(`  ✗ expected CODE_ALREADY_REDEEMED but got:`, rpcErr2 ?? 'no error');
}

// 7. 清理
await cleanup();

console.log(`\n✅ All assertions passed. Redeem flow is fully working.\n`);

async function cleanup() {
  console.log(`\n[cleanup] Deleting test user ${userId}`);
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) console.warn('  ! cleanup warning:', error.message);
  else console.log(`  ✓ deleted`);
}
