"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";

type JobStatus = {
  status: "never" | "queued" | "running" | "done" | "error";
  added?: number;
  pagesFetched?: number;
  errorMessage?: string | null;
};

const POLL_MS = 3000;

export function SyncButton({ username }: { username: string }) {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ added: number; pages: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function trigger() {
    setRunning(true);
    setError(null);
    setProgress({ added: 0, pages: 0 });

    await fetch(`/api/sync/${username}`, { method: "POST" });

    while (true) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      const job: JobStatus = await fetch(`/api/sync/${username}`).then((r) => r.json());

      setProgress({ added: job.added ?? 0, pages: job.pagesFetched ?? 0 });
      router.refresh();

      if (job.status === "done") {
        setRunning(false);
        return;
      }
      if (job.status === "error") {
        setError(job.errorMessage ?? "unknown error");
        setRunning(false);
        return;
      }
    }
  }

  return (
    <div className="flex items-center gap-3">
      {running && progress && (
        <span className="text-sm text-muted-foreground tabular-nums">
          {progress.added.toLocaleString()} listens · {progress.pages} pages
        </span>
      )}
      {!running && progress && progress.added > 0 && (
        <span className="text-sm text-primary">
          +{progress.added.toLocaleString()}
        </span>
      )}
      {error && <span className="text-sm text-destructive">{error}</span>}
      <Button onClick={trigger} disabled={running} size="sm">
        {running ? "Syncing…" : "Sync now"}
      </Button>
    </div>
  );
}
