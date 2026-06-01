"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

export function SearchBox({ placeholder = "Search…" }: { placeholder?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const id = setTimeout(() => {
      const next = new URLSearchParams(params);
      const trimmed = q.trim();
      if (trimmed) next.set("q", trimmed);
      else next.delete("q");
      next.delete("page");
      const url = `${pathname}${next.toString() ? `?${next}` : ""}`;
      startTransition(() => router.replace(url, { scroll: false }));
    }, 250);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  return (
    <div className="relative">
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={placeholder}
        className="w-full md:w-80 border border-border bg-card rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
      />
      {pending && (
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-subtle-foreground">…</span>
      )}
    </div>
  );
}
