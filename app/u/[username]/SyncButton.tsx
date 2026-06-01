"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function SyncButton({ username }: { username: string }) {
  const [status, setStatus] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const router = useRouter();

  async function trigger() {
    setRunning(true);
    setStatus("starting…");
    await fetch(`/api/sync/${username}`, { method: "POST" });

    while (true) {
      await new Promise((r) => setTimeout(r, 2000));
      const s = await fetch(`/api/sync/${username}`).then((r) => r.json());
      if (s.status === "done") {
        setStatus(`done — added ${s.added} listens across ${s.pagesFetched} pages`);
        setRunning(false);
        router.refresh();
        return;
      }
      if (s.status === "error") {
        setStatus(`error: ${s.errorMessage ?? "unknown"}`);
        setRunning(false);
        return;
      }
      setStatus(`${s.status} — ${s.added} added, ${s.pagesFetched} pages`);
    }
  }

  return (
    <div className="space-y-2">
      <button
        onClick={trigger}
        disabled={running}
        className="px-4 py-2 bg-black text-white rounded disabled:opacity-50"
      >
        {running ? "Syncing…" : "Sync now"}
      </button>
      {status && <p className="text-sm text-gray-600">{status}</p>}
    </div>
  );
}
