import type { TranscriptSegment } from '../types';

// ────────────────────────────────────────────────────────────────────────────
// 讯飞企业版「办公录音转写」（office-api-ist-dx.iflyaisol.com）签名
//   字段：appId / accessKeyId / accessKeySecret / dateTime / signatureRandom
//   算法：参数按 key 字典序排序 → 对每个 value 做 URLEncode →
//         "k1=v1&k2=v2..." 拼接 → HMAC-SHA1(签名串, accessKeySecret) → Base64
//   签名以 HTTP Header `signature` 提交，body 为音频原始流
// ────────────────────────────────────────────────────────────────────────────

async function hmacSha1Base64(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

export async function buildSignature(
  params: Record<string, string>,
  secret: string,
): Promise<string> {
  const sorted = Object.entries(params)
    .filter(([, v]) => v !== '' && v !== null && v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));

  const base = sorted.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  return hmacSha1Base64(secret, base);
}

/** ISO 8601 with timezone：yyyy-MM-dd'T'HH:mm:ss±HHmm */
export function getDateTime(): string {
  const now = new Date();
  const p = (n: number) => n.toString().padStart(2, '0');
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

export function randomStr(len = 16): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

// ────────────────────────────────────────────────────────────────────────────
// 结果解析：lattice → TranscriptSegment[]
// ────────────────────────────────────────────────────────────────────────────

interface CW { w: string; wp: string }
interface WS { cw: CW[] }
interface RT { ws: WS[] }
interface ST { bg: string; ed: string; rt: RT[] }
interface Json1best { st: ST }
interface Lattice { json_1best: string }
interface OrderResult { lattice?: Lattice[] }

export function parseXfyunResult(orderResultStr: string): TranscriptSegment[] {
  try {
    const data: OrderResult = JSON.parse(orderResultStr);
    if (!data.lattice) return [];

    return data.lattice.map((item, idx) => {
      const parsed: Json1best = JSON.parse(item.json_1best);
      const st = parsed.st;
      const text = st.rt
        .flatMap(r => r.ws)
        .flatMap(ws => ws.cw)
        .filter(cw => cw.wp !== 'p' && cw.wp !== 'g')
        .map(cw => cw.w)
        .join('');
      const timestamp = Math.round(parseInt(st.bg, 10) / 1000);
      return {
        id: `xf-seg-${idx}`,
        text: text.trim(),
        timestamp,
        isFinal: true,
      };
    }).filter(s => s.text.length > 0);
  } catch {
    return [];
  }
}
