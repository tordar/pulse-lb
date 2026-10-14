// app/_landing/listen.ts
import type { ListenAt } from "@/lib/landing/query";

const cache = new Map<number, Promise<ListenAt | null>>();

export function fetchListen(ts: number): Promise<ListenAt | null> {
  let p = cache.get(ts);
  if (!p) {
    p = fetch(`/api/landing/listen?ts=${ts}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    cache.set(ts, p);
  }
  return p;
}
