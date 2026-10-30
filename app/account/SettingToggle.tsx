"use client";

import { useState, useTransition } from "react";

export function SettingToggle({
  initial,
  save,
  label,
  hint,
}: {
  initial: boolean;
  save: (value: boolean) => Promise<void>;
  label: string;
  hint: string;
}) {
  const [on, setOn] = useState(initial);
  const [pending, startTransition] = useTransition();

  function toggle() {
    const next = !on;
    setOn(next);
    startTransition(async () => {
      try {
        await save(next);
      } catch {
        setOn(!next); // revert on failure
      }
    });
  }

  return (
    <label className="flex items-start gap-3 cursor-pointer select-none">
      <button
        type="button"
        role="switch"
        aria-checked={on}
        onClick={toggle}
        disabled={pending}
        className={`relative mt-0.5 w-9 h-5 rounded-full transition shrink-0 ${
          on ? "bg-primary" : "bg-muted"
        } disabled:opacity-60`}
      >
        <span
          className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${
            on ? "left-[18px]" : "left-0.5"
          }`}
        />
      </button>
      <span className="text-sm">
        {label}
        <span className="block text-xs text-muted-foreground mt-0.5">{hint}</span>
      </span>
    </label>
  );
}
