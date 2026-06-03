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

const POLL_MS = 2500;
const CHAIN_GRACE_MS = 8000;

export function SyncButton({ username }: { username: string }) {
  const [running, setRunning] = useState(false);
  const [dbCount, setDbCount] = useState<number>(0);
  const [target, setTarget] = useState<number | null>(null);
  const [pages, setPages] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState<RecentInsert[]>([]);
  const router = useRouter();
  const pollIdRef = useRef<number>(0);

  // Auto-detect a sync already in flight on mount and resume polling.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const snap: SyncSnapshot = await fetch(`/api/sync/${username}`).then((r) => r.json());
      if (cancelled) return;
      setDbCount(snap.dbCount ?? 0);
      setTarget(snap.target ?? null);
      setRecent(snap.recent ?? []);
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
        setRecent(snap.recent ?? []);
        router.refresh();

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

      {running && recent.length > 0 && (
        <div className="rounded-md border border-card-border bg-card p-3 space-y-1.5 overflow-hidden">
          <div className="text-[10px] uppercase tracking-wide text-subtle-foreground flex items-center gap-1.5">
            <span className="relative w-1.5 h-1.5 inline-block">
              <span className="absolute inset-0 rounded-full bg-primary animate-ping opacity-60" />
              <span className="absolute inset-0 rounded-full bg-primary" />
            </span>
            streaming in
          </div>
          <ul className="space-y-1">
            {recent.map((r) => (
              <li
                key={`${r.listened_at}-${r.track_name}`}
                className="fade-in flex items-center gap-2 text-xs"
              >
                <span className="text-subtle-foreground tabular-nums shrink-0 w-[68px]">
                  {fmtTime(r.listened_at)}
                </span>
                <span className="truncate font-medium">{r.track_name}</span>
                <span className="truncate text-muted-foreground">· {r.artist_name}</span>
                {r.release_name && (
                  <span className="truncate text-subtle-foreground hidden md:inline">
                    · {r.release_name}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function fmtTime(iso: string): string {
  // The listened_at is ISO with timezone offset; show MM-DD HH:MM
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
  const da = String(d.getUTCDate()).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${mo}-${da} ${hh}:${mm}`;
}
