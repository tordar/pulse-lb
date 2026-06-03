"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
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
  const router = useRouter();
  const pollIdRef = useRef<number>(0);
  const seenRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const snap: SyncSnapshot = await fetch(`/api/sync/${username}`).then((r) => r.json());
      if (cancelled) return;
      setDbCount(snap.dbCount ?? 0);
      setTarget(snap.target ?? null);
      // Seed the stream with whatever's there so users see SOMETHING at mount
      if (snap.recent && snap.recent.length > 0) {
        const seeded = snap.recent.slice(0, VISIBLE_MAX);
        seenRef.current = new Set(seeded.map(keyOf));
        setStream(seeded);
      }
      if (snap.status === "queued" || snap.status === "running") {
        startPolling();
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
            router.refresh();
            return;
          }
        } else {
          doneSeenAt = null;
        }
      }
    })();
  }

  async function trigger() {
    await fetch(`/api/sync/${username}`, { method: "POST" });
    startPolling();
  }

  const pct =
    target && target > 0 ? Math.max(0, Math.min(100, (dbCount / target) * 100)) : null;

  return (
    <div className="w-full space-y-3">
      <div className="flex items-center gap-3 flex-wrap">
        {pct != null && (
          <span className="text-sm text-muted-foreground tabular-nums">
            {dbCount.toLocaleString()} / {target!.toLocaleString()}
            <span className="text-subtle-foreground"> · {pct.toFixed(1)}%</span>
          </span>
        )}
        {pct == null && dbCount > 0 && (
          <span className="text-sm text-muted-foreground tabular-nums">
            {dbCount.toLocaleString()} listens
          </span>
        )}
        {running && pages > 0 && (
          <span className="text-xs text-subtle-foreground tabular-nums">{pages} pages</span>
        )}
        {error && <span className="text-sm text-destructive">{error}</span>}
        <span className="ml-auto" />
        <Button onClick={trigger} disabled={running} size="sm">
          <RefreshCw size={14} className={running ? "animate-spin" : ""} />
          {running ? "Syncing…" : "Sync now"}
        </Button>
      </div>

      {pct != null && (
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
