// scripts/llm-smoke.mjs
// 验证 .env 里的大模型 API 凭据能跑通 /chat/completions（含流式）
//
// 关键点：
//   - 浏览器/Vite 反代下 base 写成 "/moonshot-api/v1"，
//     在 Node 直连场景里要还原为真实 host
//   - 一次非流式 + 一次流式探测，覆盖反馈生成里走的两条路径
//
// 用法：node scripts/llm-smoke.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

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
const mask = s => !s ? '(empty)' : s.length <= 8 ? s : s.slice(0, 4) + '…' + s.slice(-4);

/** 把 /moonshot-api/v1 这种 vite 反代路径还原为真实 host */
function resolveBase(b) {
  if (!b) return '';
  if (b.startsWith('http://') || b.startsWith('https://')) return b.replace(/\/$/, '');
  if (b.startsWith('/moonshot-api')) return 'https://api.moonshot.cn' + b.slice('/moonshot-api'.length);
  if (b.startsWith('/openai-api'))   return 'https://api.openai.com'   + b.slice('/openai-api'.length);
  return b.replace(/\/$/, '');
}

const env  = loadEnv(path.join(root, '.env'));
const base = resolveBase(env.VITE_LLM_BASE_URL);
const key  = env.VITE_LLM_API_KEY;
const model = env.VITE_LLM_MODEL;

console.log('── 配置检查 ─────────────────────────────────');
console.log('VITE_LLM_BASE_URL :', env.VITE_LLM_BASE_URL, '→', base);
console.log('VITE_LLM_API_KEY  :', mask(key), `(len=${key?.length ?? 0})`);
console.log('VITE_LLM_MODEL    :', model);
console.log('');

if (!base || !key || !model) {
  console.error('❌ 必填项缺失，先在 .env 中填 VITE_LLM_BASE_URL / VITE_LLM_API_KEY / VITE_LLM_MODEL');
  process.exit(1);
}

const url = `${base}/chat/completions`;
const messages = [{ role: 'user', content: '只回复"OK"两个字，验证用。' }];

let exitCode = 0;

// ── 1) 非流式 ──
console.log('── 1) 非流式 /chat/completions ─────────────');
try {
  const t0 = Date.now();
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, messages, stream: false }),
  });
  const elapsed = Date.now() - t0;
  console.log(`HTTP : ${resp.status} (${elapsed}ms)`);
  const txt = await resp.text();
  let json; try { json = JSON.parse(txt); } catch { json = txt; }
  if (resp.ok && typeof json === 'object' && json.choices?.[0]?.message?.content) {
    console.log('✅ 非流式调用通过：', JSON.stringify(json.choices[0].message.content).slice(0, 80));
    if (json.usage) console.log('   tokens:', JSON.stringify(json.usage));
  } else {
    console.error('❌ 非流式调用失败：', JSON.stringify(json).slice(0, 300));
    exitCode = 1;
  }
} catch (e) {
  console.error('❌ 网络错误：', e.message);
  exitCode = 1;
}

console.log('');

// ── 2) 流式 ──
console.log('── 2) 流式 /chat/completions（stream:true）──');
try {
  const t0 = Date.now();
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, messages, stream: true }),
  });
  console.log('HTTP :', resp.status);
  if (!resp.ok) {
    console.error('❌ 流式响应非 2xx：', (await resp.text()).slice(0, 300));
    exitCode = 1;
  } else {
    let chunks = 0;
    let firstChunkAt = null;
    let total = '';
    const dec = new TextDecoder();
    const reader = resp.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const line of dec.decode(value, { stream: true }).split('\n')) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') continue;
        try {
          const d = JSON.parse(data);
          const c = d.choices?.[0]?.delta?.content;
          if (c) {
            chunks++;
            total += c;
            if (firstChunkAt === null) firstChunkAt = Date.now() - t0;
          }
        } catch { /* ignore */ }
      }
    }
    const elapsed = Date.now() - t0;
    if (chunks > 0) {
      console.log(`✅ 流式调用通过：收到 ${chunks} 个 chunk，首字延迟 ${firstChunkAt}ms，共 ${elapsed}ms`);
      console.log('   返回:', JSON.stringify(total).slice(0, 80));
    } else {
      console.error('❌ 流式响应中没有解析到任何 chunk');
      exitCode = 1;
    }
  }
} catch (e) {
  console.error('❌ 网络错误：', e.message);
  exitCode = 1;
}

console.log('');
if (exitCode === 0) {
  console.log('✅ LLM smoke 全部通过 —— 反馈生成所需的大模型链路就绪');
} else {
  console.log('❌ LLM smoke 失败，请按提示排查 .env 与 base url 反代');
}
process.exit(exitCode);
