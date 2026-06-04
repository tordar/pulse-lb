"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/Button";

type RecentInsert = {
  listened_at: string;
  track_name: string;
  artist_name: string;
  release_name: string | null;
  caa_id: number | null;
  caa_release_mbid: string | null;
};

type SyncSnapshot = {
  id?: string;
  status: "never" | "queued" | "running" | "done" | "error";
  added?: number;
  pagesFetched?: number;
  errorMessage?: string | null;
  target?: number | null;
  dbCount?: number;
  lbCount?: number | null;
  aggStale?: boolean;
  recent?: RecentInsert[];
};

// Poll often so the stream feels live. Each poll fetches the latest 40
// inserted rows; new ones get dribbled into the visible list with a
// per-item stagger so the visual flow feels continuous instead of batched.
const POLL_MS = 1000;
const VISIBLE_MAX = 22;
const STAGGER_FLOOR_MS = 30;
const STAGGER_CEIL_MS = 120;
const CHAIN_GRACE_MS = 8000;

function keyOf(r: RecentInsert): string {
  return `${r.listened_at}|${r.track_name}|${r.artist_name}`;
}

export function SyncButton({ username }: { username: string }) {
  const [running, setRunning] = useState(false);
  const [dbCount, setDbCount] = useState<number>(0);
  const [target, setTarget] = useState<number | null>(null);
  const [pages, setPages] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [stream, setStream] = useState<RecentInsert[]>([]);
  const [synced, setSynced] = useState(false);
  const [gate, setGate] = useState<null | "signin" | "paywall" | "forbidden">(null);
  const router = useRouter();
  const pollIdRef = useRef<number>(0);
  const seenRef = useRef<Set<string>>(new Set());
  const autoTriedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const snap: SyncSnapshot = await fetch(`/api/sync/${username}?probe=1`).then((r) =>
        r.json(),
      );
      if (cancelled) return;
      setDbCount(snap.dbCount ?? 0);
      setTarget(snap.target ?? null);
      setSynced(snap.status === "done" && (snap.added ?? 0) === 0 && (snap.dbCount ?? 0) > 0);
      // Seed only when a sync is actually in flight — otherwise we'd replay
      // historical inserts from the backfill tail.
      if (
        snap.recent &&
        snap.recent.length > 0 &&
        (snap.status === "queued" || snap.status === "running")
      ) {
        const seeded = snap.recent.slice(0, VISIBLE_MAX);
        seenRef.current = new Set(seeded.map(keyOf));
        setStream(seeded);
      }
      if (snap.status === "queued" || snap.status === "running") {
        startPolling();
        return;
      }
      // Auto-sync: LB reports more listens than we have stored AND more than
      // the last sync aimed for. The second condition is the loop guard — LB's
      // listen-count can permanently exceed what /listens paginates out
      // (private/deleted plays), so a bare lbCount > dbCount would re-sync on
      // every page load forever. Requiring growth past the last target means
      // we only fire when LB has actually gained listens since the last sync.
      const dbc = snap.dbCount ?? 0;
      if (
        !autoTriedRef.current &&
        dbc > 0 &&
        snap.lbCount != null &&
        snap.lbCount > dbc &&
        snap.lbCount > (snap.target ?? 0)
      ) {
        autoTriedRef.current = true;
        void trigger(true);
      } else if (snap.aggStale) {
        // The stats page schedules an aggregate rebuild when it renders stale;
        // refresh a little later so the tiles pick up the rebuilt numbers.
        setTimeout(() => router.refresh(), 6_000);
        setTimeout(() => router.refresh(), 15_000);
      }
    })();
    return () => {
      cancelled = true;
      pollIdRef.current++;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username]);

  function streamInFresh(items: RecentInsert[]) {
    if (items.length === 0) return;
    // Reverse so we prepend oldest-first → newest ends up at the top.
    const ordered = [...items].reverse();
    const stagger = Math.max(
      STAGGER_FLOOR_MS,
      Math.min(STAGGER_CEIL_MS, Math.floor(POLL_MS / ordered.length)),
    );
    ordered.forEach((item, i) => {
      setTimeout(() => {
        const k = keyOf(item);
        if (seenRef.current.has(k)) return;
        seenRef.current.add(k);
        setStream((prev) => [item, ...prev].slice(0, VISIBLE_MAX));
      }, i * stagger);
    });
  }

  function startPolling() {
    const myId = ++pollIdRef.current;
    setRunning(true);
    setError(null);

    (async () => {
      let lastJobId: string | undefined;
      let doneSeenAt: number | null = null;

      while (pollIdRef.current === myId) {
        await new Promise((r) => setTimeout(r, POLL_MS));
        if (pollIdRef.current !== myId) return;

        let snap: SyncSnapshot;
        try {
          snap = await fetch(`/api/sync/${username}`).then((r) => r.json());
        } catch {
          continue;
        }

        setDbCount(snap.dbCount ?? 0);
        if (snap.target != null) setTarget(snap.target);
        setPages(snap.pagesFetched ?? 0);

        if (snap.recent && snap.recent.length > 0) {
          const fresh = snap.recent.filter((r) => !seenRef.current.has(keyOf(r)));
          if (fresh.length > 0) streamInFresh(fresh);
        }

        // Refresh server components less often than we poll the API so the
        // dashboard charts update but we don't thrash Postgres.
        if (Math.random() < 0.25) router.refresh();

        if (snap.id && snap.id !== lastJobId) {
          lastJobId = snap.id;
          doneSeenAt = null;
        }

        if (snap.status === "error") {
          setError(snap.errorMessage ?? "unknown error");
          setRunning(false);
          return;
        }
        if (snap.status === "done") {
          if (doneSeenAt === null) doneSeenAt = Date.now();
          if (Date.now() - doneSeenAt >= CHAIN_GRACE_MS) {
            setRunning(false);
            setSynced((snap.added ?? 0) === 0 && (snap.dbCount ?? 0) > 0);
            router.refresh();
            return;
          }
        } else {
          doneSeenAt = null;
        }
      }
    })();
  }

  async function trigger(auto = false) {
    seenRef.current = new Set();
    setStream([]);
    setPages(0);
    setError(null);
    setSynced(false);
    setGate(null);
    const res = await fetch(`/api/sync/${username}`, { method: "POST" });
    // Auto-triggered syncs fail silently on auth/paywall — don't spring a
    // sign-in prompt or paywall on someone who didn't click anything.
    if (res.status === 401) {
      if (!auto) setGate("signin");
      return;
    }
    if (res.status === 402) {
      if (!auto) setGate("paywall");
      return;
    }
    if (res.status === 403) {
      if (!auto) setGate("forbidden");
      return;
    }
    startPolling();
  }

  // Floor to 0.1% so we never display "100.0%" while dbCount is still short
  // of target — LB's getListenCount can report more than /listens will
  // paginate to (private/deleted plays), so the exact equality may never hit.
  const pct =
    target && target > 0
      ? dbCount >= target
        ? 100
        : Math.max(0, Math.min(99.9, Math.floor((dbCount / target) * 1000) / 10))
      : null;

  return (
    <div className="w-full space-y-3">
      <div className="flex items-center gap-3 flex-wrap">
        {synced && !running ? (
          <span className="text-sm text-muted-foreground tabular-nums">
            <span className="text-primary">✓ Synced</span>
            <span className="text-subtle-foreground"> · {dbCount.toLocaleString()} listens</span>
          </span>
        ) : pct != null ? (
          <span className="text-sm text-muted-foreground tabular-nums">
            {dbCount.toLocaleString()} / {target!.toLocaleString()}
            <span className="text-subtle-foreground"> · {pct.toFixed(1)}%</span>
          </span>
        ) : dbCount > 0 ? (
          <span className="text-sm text-muted-foreground tabular-nums">
            {dbCount.toLocaleString()} listens
          </span>
        ) : null}
        {running && pages > 0 && (
          <span className="text-xs text-subtle-foreground tabular-nums">{pages} pages</span>
        )}
        {error && <span className="text-sm text-destructive">{error}</span>}
        <span className="ml-auto" />
        {gate === "signin" ? (
          <Link
            href={`/auth/login?return=${encodeURIComponent(`/u/${username}/stats`)}`}
            className="text-sm font-medium text-primary hover:underline"
          >
            Sign in to sync →
          </Link>
        ) : gate === "paywall" ? (
          <Link
            href="/pricing"
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90"
          >
            Subscribe to sync
          </Link>
        ) : gate === "forbidden" ? (
          <span className="text-sm text-muted-foreground">Sign in as @{username} to sync</span>
        ) : (
          <Button onClick={() => trigger()} disabled={running} size="sm">
            <RefreshCw size={14} className={running ? "animate-spin" : ""} />
            {running ? "Syncing…" : "Sync now"}
          </Button>
        )}
      </div>

      {pct != null && !(synced && !running) && (
        <div className="relative w-full h-1.5 bg-muted rounded-full overflow-hidden">
          <div
            className="absolute inset-y-0 left-0 bg-primary transition-all duration-500 ease-out"
            style={{ width: `${pct}%` }}
          />
          {running && (
            <div
              className="absolute inset-y-0 bg-primary/30 animate-pulse"
              style={{ left: `${pct}%`, right: 0 }}
            />
          )}
        </div>
      )}

      {running && stream.length > 0 && (
        <div className="rounded-md border border-card-border bg-card p-3 space-y-1.5 overflow-hidden">
          <div className="text-[10px] uppercase tracking-wide text-subtle-foreground flex items-center gap-1.5">
            <span className="relative w-1.5 h-1.5 inline-block">
              <span className="absolute inset-0 rounded-full bg-primary animate-ping opacity-60" />
              <span className="absolute inset-0 rounded-full bg-primary" />
            </span>
            streaming in
          </div>
          <ul className="space-y-1">
            {stream.map((r) => (
              <li
                key={keyOf(r)}
                className="stream-row flex items-baseline gap-3 text-xs"
              >
                <span className="text-subtle-foreground tabular-nums shrink-0 whitespace-nowrap w-[96px]">
                  {fmtTime(r.listened_at)}
                </span>
                <span className="truncate min-w-0 flex-1">
                  <span className="font-medium">{r.track_name}</span>
                  <span className="text-muted-foreground"> · {r.artist_name}</span>
                  {r.release_name && (
                    <span className="text-subtle-foreground hidden md:inline">
                      {" "}
                      · {r.release_name}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
  const da = String(d.getUTCDate()).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${mo}-${da} ${hh}:${mm}`;
}
