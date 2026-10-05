"use client";

import { useState, useTransition } from "react";

export function DeleteButton({ onConfirm, label = "Delete" }: { onConfirm: () => Promise<void>; label?: string }) {
  const [armed, setArmed] = useState(false);
  const [pending, start] = useTransition();
  if (!armed)
    return (
      <button type="button" onClick={() => setArmed(true)} className="text-xs text-muted-foreground hover:text-red-600">
        {label}
      </button>
    );
  return (
    <span className="inline-flex gap-2 text-xs">
      <button type="button" disabled={pending} onClick={() => start(onConfirm)} className="font-semibold text-red-600">
        {pending ? "Deleting…" : "Confirm delete"}
      </button>
      <button type="button" onClick={() => setArmed(false)} className="text-muted-foreground">Cancel</button>
    </span>
  );
}
