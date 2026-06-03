"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/Button";

type JobStatus = {
  id?: string;
  status: "never" | "queued" | "running" | "done" | "error";
  added?: number;
  pagesFetched?: number;
  errorMessage?: string | null;
};

const POLL_MS = 3000;
// How long to keep polling after the latest job goes "done", in case a
// self-continuation chained job hasn't appeared yet.
const CHAIN_GRACE_MS = 8000;

export function SyncButton({ username }: { username: string }) {
  const [running, setRunning] = useState(false);
  const [totalAdded, setTotalAdded] = useState(0);
  const [pages, setPages] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function trigger() {
    setRunning(true);
    setError(null);
    setTotalAdded(0);
    setPages(0);

    await fetch(`/api/sync/${username}`, { method: "POST" });

    // We accumulate across the chain: each job in the chain reports its own
    // `added` count; the total displayed is the sum across all jobs seen.
    let lastJobId: string | undefined;
    let lastJobAdded = 0;
    let runningTotal = 0;
    let runningPages = 0;
    let doneSeenAt: number | null = null;

    while (true) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      const job: JobStatus = await fetch(`/api/sync/${username}`).then((r) => r.json());

      if (job.id && job.id !== lastJobId) {
        // New job appeared — roll the previous job's final count into our total
        runningTotal += lastJobAdded;
        lastJobId = job.id;
        lastJobAdded = 0;
        doneSeenAt = null;
      }
      lastJobAdded = job.added ?? 0;
      runningPages += 0; // pages per job displayed incrementally below

      setTotalAdded(runningTotal + lastJobAdded);
      setPages(job.pagesFetched ?? 0);
      router.refresh();

      if (job.status === "error") {
        setError(job.errorMessage ?? "unknown error");
        setRunning(false);
        return;
      }

      if (job.status === "done") {
        // Wait briefly for a self-continuation to appear before declaring done
        if (doneSeenAt === null) doneSeenAt = Date.now();
        if (Date.now() - doneSeenAt >= CHAIN_GRACE_MS) {
          runningTotal += lastJobAdded;
          setTotalAdded(runningTotal);
          setRunning(false);
          return;
        }
        // else: keep polling — the chain may continue
      }
    }
  }

  return (
    <div className="flex items-center gap-3">
      {running && (
        <span className="text-sm text-muted-foreground tabular-nums">
          {totalAdded.toLocaleString()} listens · {pages} pages
        </span>
      )}
      {!running && totalAdded > 0 && (
        <span className="text-sm text-primary">+{totalAdded.toLocaleString()}</span>
      )}
      {error && <span className="text-sm text-destructive">{error}</span>}
      <Button onClick={trigger} disabled={running} size="sm">
        <RefreshCw size={14} className={running ? "animate-spin" : ""} />
        {running ? "Syncing…" : "Sync now"}
      </Button>
    </div>
  );
}
