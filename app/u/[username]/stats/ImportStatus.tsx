"use client";
import { useImportStatus } from "@/lib/live/importStatus";

export function ImportStatus() {
  const s = useImportStatus();
  if (!s) return null;
  return (
    <p className="text-sm text-muted-foreground tabular-nums">
      Importing history… {s.imported.toLocaleString()}
      {s.target != null && <> of {s.target.toLocaleString()}</>}
    </p>
  );
}
