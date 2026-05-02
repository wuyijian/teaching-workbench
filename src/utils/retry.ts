/**
 * 通用 API 重试工具
 *
 * 可重试：网络故障（TypeError）、HTTP 429 / 5xx
 * 不重试：AbortError、HTTP 4xx（除 429）、业务层错误（讯飞 code 非 000000 等）
 */

export interface RetryOptions {
  /** 最大尝试次数（含首次），默认 3 */
  maxAttempts?: number;
  /** 第一次重试的基础延迟 ms，后续指数退避，默认 1000 */
  baseDelayMs?: number;
  /** 返回 false 时立即放弃重试；默认对网络错误和 5xx/429 重试 */
  shouldRetry?: (err: Error, attempt: number) => boolean;
  /** 每次重试前回调（用于日志 / 更新进度提示） */
  onRetry?: (err: Error, attempt: number, delayMs: number) => void;
}

/** 判断一个 Error 是否属于可重试的瞬时错误 */
export function isTransient(err: Error): boolean {
  if (err.name === 'AbortError') return false;
  // 网络故障
  if (err instanceof TypeError) return true;
  // 我们在 fetch 之后 throw new Error(`API 错误 ${status}: ...`) 时写入状态码
  const m = err.message.match(/\b(429|5\d{2})\b/);
  if (m) return true;
  return false;
}

/**
 * 带指数退避的重试包装器。
 *
 * ```ts
 * const data = await withRetry(() => fetch(...).then(r => r.json()), {
 *   maxAttempts: 3,
 *   onRetry: (err, n) => console.warn(`第 ${n} 次重试`, err.message),
 * });
 * ```
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const {
    maxAttempts = 3,
    baseDelayMs = 1000,
    shouldRetry = isTransient,
    onRetry,
  } = opts;

  let lastErr!: Error;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));

      // 最后一次 or 不可重试 → 直接抛出
      if (attempt >= maxAttempts || !shouldRetry(lastErr, attempt)) {
        throw lastErr;
      }

      // 指数退避 + ±25% 随机抖动
      const jitter = 0.75 + Math.random() * 0.5;
      const delayMs = Math.round(baseDelayMs * Math.pow(2, attempt - 1) * jitter);
      onRetry?.(lastErr, attempt, delayMs);
      await new Promise(r => setTimeout(r, delayMs));
    }
  }

  throw lastErr;
}
