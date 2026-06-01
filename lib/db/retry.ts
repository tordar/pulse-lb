const MAX_ATTEMPTS = 6;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (e: unknown) {
      lastErr = e;
      if (!isRetryable(e) || attempt === MAX_ATTEMPTS) throw e;
      // 250ms, 500ms, 1s, 2s, 4s
      await sleep(Math.min(4000, 250 * 2 ** (attempt - 1)));
    }
  }
  throw lastErr;
}

function isRetryable(e: unknown): boolean {
  if (typeof e !== "object" || e === null) return false;
  // Drizzle wraps Neon errors as { message: "Failed query: ...", cause: NeonDbError }.
  // Walk the cause chain and collect every message we see.
  const messages: string[] = [];
  let cur: unknown = e;
  for (let depth = 0; depth < 5 && cur && typeof cur === "object"; depth++) {
    const m = (cur as { message?: unknown }).message;
    if (typeof m === "string") messages.push(m);
    cur = (cur as { cause?: unknown }).cause;
  }
  const blob = messages.join(" | ");
  if (/"neon:retryable"\s*:\s*true/.test(blob)) return true;
  if (/Control plane request failed|Too many database connection|ECONN|ETIMEDOUT|fetch failed|socket hang up/i.test(blob)) return true;
  return false;
}
