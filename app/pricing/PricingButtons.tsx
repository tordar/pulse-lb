"use client";

import { useState } from "react";

export function PricingButtons({ plan }: { plan: "annual" | "lifetime" }) {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function go() {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setErr(body.error ?? `error ${res.status}`);
        return;
      }
      const body = (await res.json()) as { url: string };
      window.location.href = body.url;
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button
        onClick={go}
        disabled={loading}
        className="w-full px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-60"
      >
        {loading ? "Loading…" : "Subscribe"}
      </button>
      {err && <p className="text-xs text-destructive">{err}</p>}
    </>
  );
}
