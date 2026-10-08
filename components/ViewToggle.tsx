"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";

export type View = "grid" | "list";

// `null` means no choice in the URL: list on phones, grid from md up.
export function ViewToggle({ current }: { current: View | null }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function setView(v: View) {
    const next = new URLSearchParams(params);
    next.set("view", v);
    const url = `${pathname}${next.toString() ? `?${next}` : ""}`;
    router.replace(url, { scroll: false });
  }

  return (
    <div className="inline-flex bg-card border border-border rounded-md overflow-hidden">
      <button
        onClick={() => setView("grid")}
        className={`px-3 py-1.5 text-sm font-medium transition-colors ${
          current === "grid"
            ? "bg-primary text-primary-foreground"
            : current === null
              ? "text-foreground/80 hover:bg-muted active:bg-muted md:bg-primary md:text-primary-foreground"
              : "text-foreground/80 hover:bg-muted active:bg-muted"
        }`}
      >
        Grid
      </button>
      <button
        onClick={() => setView("list")}
        className={`px-3 py-1.5 text-sm font-medium border-l border-border transition-colors ${
          current === "list"
            ? "bg-primary text-primary-foreground"
            : current === null
              ? "bg-primary text-primary-foreground md:bg-transparent md:text-foreground/80 md:hover:bg-muted"
              : "text-foreground/80 hover:bg-muted active:bg-muted"
        }`}
      >
        List
      </button>
    </div>
  );
}
