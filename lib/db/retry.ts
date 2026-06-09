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

// postgres-js connection-layer errors carry a string .code; Postgres server
// errors carry a 5-char SQLSTATE .code. Drizzle wraps these, so walk the
// cause chain collecting every code and message we can see.
const RETRYABLE_CODES = new Set<string>([
  // postgres-js connection layer
  "CONNECTION_ENDED",
  "CONNECTION_CLOSED",
  "CONNECTION_DESTROYED",
  "CONNECT_TIMEOUT",
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EPIPE",
  // transient Postgres SQLSTATEs
  "40001", // serialization_failure
  "40P01", // deadlock_detected
  "57P01", // admin_shutdown
  "08006", // connection_failure
  "08003", // connection_does_not_exist
  "53300", // too_many_connections
]);

function isRetryable(e: unknown): boolean {
  if (typeof e !== "object" || e === null) return false;
  const messages: string[] = [];
  let cur: unknown = e;
  for (let depth = 0; depth < 5 && cur && typeof cur === "object"; depth++) {
    const code = (cur as { code?: unknown }).code;
    if (typeof code === "string" && RETRYABLE_CODES.has(code)) return true;
    const m = (cur as { message?: unknown }).message;
    if (typeof m === "string") messages.push(m);
    cur = (cur as { cause?: unknown }).cause;
  }
  const blob = messages.join(" | ");
  return /ECONN|ETIMEDOUT|fetch failed|socket hang up|Connection terminated|write CONNECTION/i.test(
    blob,
  );
}
