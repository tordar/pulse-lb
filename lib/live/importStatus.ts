"use client";
import { useSyncExternalStore } from "react";

// Progress of a first-time history import, set by the poller in NowPlaying
// and shown as one line in the stats header. Null when no import is running.
export type ImportStatus = { imported: number; target: number | null } | null;

let status: ImportStatus = null;
const listeners = new Set<() => void>();

export function setImportStatus(s: ImportStatus) {
  status = s;
  for (const fn of listeners) fn();
}

export function useImportStatus(): ImportStatus {
  return useSyncExternalStore(
    (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    () => status,
    () => null,
  );
}
