// scripts/release-smoke.mjs
// 发版前一键 smoke：依次跑 TypeScript 编译、讯飞鉴权、LLM 鉴权（流式 + 非流式）、
// 可选的 Supabase 连通性，任何一项失败立即退出非 0。
//
// 用法：node scripts/release-smoke.mjs
// 或   npm run smoke

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const RESET = '\x1b[0m';
const BOLD  = '\x1b[1m';
const DIM   = '\x1b[2m';
const RED   = '\x1b[31m';
const GREEN = '\x1b[32m';
const CYAN  = '\x1b[36m';
const YEL   = '\x1b[33m';

function header(title) {
  console.log('\n' + CYAN + '━'.repeat(60) + RESET);
  console.log(`${BOLD}${CYAN}▶ ${title}${RESET}`);
  console.log(CYAN + '━'.repeat(60) + RESET);
}

function run(label, cmd, args, opts = {}) {
  header(label);
  const t0 = Date.now();
  const r = spawnSync(cmd, args, {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    ...opts,
  });
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  if (r.status === 0) {
    console.log(`\n${GREEN}✓ ${label} 通过${RESET} ${DIM}(${elapsed}s)${RESET}`);
    return true;
  }
  console.log(`\n${RED}✗ ${label} 失败${RESET} ${DIM}(${elapsed}s, exit=${r.status})${RESET}`);
  return false;
}

function loadEnv(file) {
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i < 0) continue;
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

const env = loadEnv(path.join(root, '.env'));
const results = [];

// ── 1) TypeScript 编译 ──
results.push({ name: 'TypeScript 编译', ok: run('TypeScript 编译 (tsc --noEmit)', 'npx', ['tsc', '--noEmit']) });

// ── 2) 讯飞转写鉴权 ──
results.push({ name: '讯飞转写鉴权', ok: run('讯飞转写鉴权 (xfyun-smoke)', 'node', ['scripts/xfyun-smoke.mjs']) });

// ── 3) 大模型鉴权 + 流式 ──
results.push({ name: '大模型 LLM 鉴权 + 流式', ok: run('大模型 LLM 鉴权 + 流式 (llm-smoke)', 'node', ['scripts/llm-smoke.mjs']) });

// ── 4) Supabase 连通性（可选） ──
if (env.VITE_SUPABASE_URL && env.VITE_SUPABASE_ANON_KEY) {
  header('Supabase 连通性');
  try {
    const url = `${env.VITE_SUPABASE_URL.replace(/\/$/, '')}/auth/v1/health`;
    const t0 = Date.now();
    const resp = await fetch(url, { headers: { apikey: env.VITE_SUPABASE_ANON_KEY } });
    const elapsed = Date.now() - t0;
    const ok = resp.ok;
    console.log(`HTTP ${resp.status} (${elapsed}ms) → ${url}`);
    if (ok) {
      console.log(`${GREEN}✓ Supabase auth 服务可达${RESET}`);
    } else {
      console.log(`${RED}✗ Supabase auth 服务返回非 2xx${RESET}`);
    }
    results.push({ name: 'Supabase 连通性', ok });
  } catch (e) {
    console.error(`${RED}✗ Supabase 连通性失败${RESET}：`, e.message);
    results.push({ name: 'Supabase 连通性', ok: false });
  }
} else {
  header('Supabase 连通性');
  console.log(`${YEL}⚠️  跳过：未配置 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY${RESET}`);
  results.push({ name: 'Supabase 连通性', ok: true, skipped: true });
}

// ── 汇总 ──
console.log('\n' + CYAN + '━'.repeat(60) + RESET);
console.log(`${BOLD}${CYAN}发版前 smoke 总览${RESET}`);
console.log(CYAN + '━'.repeat(60) + RESET);
let allOk = true;
for (const r of results) {
  const tag = r.skipped ? `${YEL}⊘ 跳过${RESET}` : r.ok ? `${GREEN}✓ 通过${RESET}` : `${RED}✗ 失败${RESET}`;
  console.log(`  ${tag}  ${r.name}`);
  if (!r.ok) allOk = false;
}
console.log(CYAN + '━'.repeat(60) + RESET);
if (allOk) {
  console.log(`${GREEN}${BOLD}✅ 全部通过 —— 可以打包发版了${RESET}`);
  console.log(`${DIM}  下一步：手动跑一遍 RELEASE_CHECKLIST.md 中的 UI 端到端验证${RESET}\n`);
  process.exit(0);
} else {
  console.log(`${RED}${BOLD}❌ 有项失败 —— 修完再发版${RESET}\n`);
  process.exit(1);
}
