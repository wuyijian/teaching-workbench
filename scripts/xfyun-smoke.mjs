// scripts/xfyun-smoke.mjs
// 直连讯飞企业版「办公录音转写」API，验证 .env 里凭据是否能签名通过
//
// 接口：https://office-api-ist-dx.iflyaisol.com/v2/upload
//   字段：appId / accessKeyId / accessKeySecret / dateTime / signatureRandom
//   签名：HMAC-SHA1( "k1=URLEncode(v1)&k2=URLEncode(v2)..."（按 key 排序）, accessKeySecret ) → Base64
//   签名以 HTTP Header `signature` 提交
//
// 用法：node scripts/xfyun-smoke.mjs
import crypto from 'node:crypto';
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

const env = loadEnv(path.join(root, '.env'));
const appId        = env.VITE_XF_APP_ID;
const accessKeyId  = env.VITE_XF_ACCESS_KEY_ID;
const accessKeySec = env.VITE_XF_ACCESS_KEY_SECRET;

console.log('── 配置检查 ─────────────────────────────────');
console.log('VITE_XF_APP_ID            :', appId, `(len=${appId?.length ?? 0})`);
console.log('VITE_XF_ACCESS_KEY_ID     :', mask(accessKeyId), `(len=${accessKeyId?.length ?? 0})`);
console.log('VITE_XF_ACCESS_KEY_SECRET :', mask(accessKeySec), `(len=${accessKeySec?.length ?? 0})`);
console.log('');

if (!appId || !accessKeyId || !accessKeySec) {
  console.error('❌ 必填项缺失，先在 .env 中填入 VITE_XF_APP_ID / VITE_XF_ACCESS_KEY_ID / VITE_XF_ACCESS_KEY_SECRET 并保存');
  process.exit(1);
}

// ── 时间格式：yyyy-MM-dd'T'HH:mm:ss±HHmm ──
function getDateTime() {
  const now = new Date();
  const p = n => String(n).padStart(2, '0');
  const y = now.getFullYear();
  const mo = p(now.getMonth() + 1);
  const d = p(now.getDate());
  const h = p(now.getHours());
  const mi = p(now.getMinutes());
  const s = p(now.getSeconds());
  const off = -now.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const oh = p(Math.floor(Math.abs(off) / 60));
  const om = p(Math.abs(off) % 60);
  return `${y}-${mo}-${d}T${h}:${mi}:${s}${sign}${oh}${om}`;
}

function randomStr(len = 16) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function buildSignature(params, secret) {
  const sorted = Object.entries(params)
    .filter(([, v]) => v !== '' && v != null)
    .sort(([a], [b]) => a.localeCompare(b));
  const base = sorted.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  return crypto.createHmac('sha1', secret).update(base).digest('base64');
}

const dateTime        = getDateTime();
const signatureRandom = randomStr(16);

// 探测：1 byte 文件，验证鉴权
const probe = Buffer.from([0]);
const params = {
  appId,
  accessKeyId,
  dateTime,
  signatureRandom,
  fileSize: String(probe.length),
  fileName: 'probe.mp3',
  language: 'autodialect',
  durationCheckDisable: 'true',
  pd: 'edu',
};
const signature = buildSignature(params, accessKeySec);
const query = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
const url = `https://office-api-ist-dx.iflyaisol.com/v2/upload?${query}`;

console.log('── 调讯飞企业版 /v2/upload（探测请求）────────');
console.log('host     : office-api-ist-dx.iflyaisol.com');
console.log('dateTime :', dateTime);
console.log('sigRandom:', signatureRandom);
console.log('signature:', mask(signature));

try {
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      signature,
    },
    body: probe,
  });
  const txt = await resp.text();
  let json; try { json = JSON.parse(txt); } catch { json = txt; }
  console.log('HTTP :', resp.status);
  console.log('返回 :', JSON.stringify(json, null, 2));

  const code = typeof json === 'object' ? json.code : null;
  const desc = typeof json === 'object' ? (json.descInfo || json.message || '') : '';

  console.log('\n── 诊断 ─────────────────────────────────');
  if (code === '000000') {
    console.log('✅ 鉴权 + 探测请求都通过 —— accessKeyId/accessKeySecret 有效');
  } else if (/accessKeyId is not exist|forbidden/i.test(desc)) {
    console.log('❌ accessKeyId 不存在或已禁用');
    console.log('   ↳ 当前填的 accessKeyId 不是企业版后台下发的，请去企业版控制台拿');
    console.log('   ↳ 这套接口需要企业版的 accessKeyId / accessKeySecret，');
    console.log('     与 console.xfyun.cn（开放平台）的 APIKey/APISecret 不是同一套');
  } else if (/sign|签名/i.test(desc)) {
    console.log('❌ 签名错误：accessKeySecret 不正确，或前后有空格');
  } else if (/quota|余额|限额|balance/i.test(desc)) {
    console.log('❌ 套餐额度不足');
  } else if (code === '26600' || /size/i.test(desc)) {
    console.log('✅ 鉴权通过（探测文件太小被拒，但签名有效）');
  } else {
    console.log('⚠️  其它错误，参考 desc 自行排查');
  }
} catch (e) {
  console.error('网络错误：', e.message);
}
