/**
 * Safari / older WebKit does not support AbortSignal.timeout().
 * This helper provides the same behaviour using AbortController + setTimeout.
 */
export async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  ms: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
