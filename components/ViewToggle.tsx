"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";

export type View = "grid" | "list";

export function ViewToggle({ current }: { current: View }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function setView(v: View) {
    const next = new URLSearchParams(params);
    if (v === "list") next.set("view", "list");
    else next.delete("view");
    const url = `${pathname}${next.toString() ? `?${next}` : ""}`;
    router.replace(url, { scroll: false });
  }

  return (
    <div className="inline-flex border border-border rounded-md overflow-hidden">
      <button
        onClick={() => setView("grid")}
        className={`px-3 py-1.5 text-sm ${current === "grid" ? "bg-primary text-primary-foreground" : ""}`}
      >
        Grid
      </button>
      <button
        onClick={() => setView("list")}
        className={`px-3 py-1.5 text-sm border-l border-border ${current === "list" ? "bg-primary text-primary-foreground" : ""}`}
      >
        List
      </button>
    </div>
  );
}
