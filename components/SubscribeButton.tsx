"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";

// Kicks off Stripe Checkout for the annual plan and redirects to Stripe.
// (Lifetime is no longer purchasable — granted manually via SQL.)
export function SubscribeButton({ label = "Subscribe" }: { label?: string }) {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function go() {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ plan: "annual" }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setErr(body.error ?? `Something went wrong (${res.status})`);
        return;
      }
      const body = (await res.json()) as { url: string };
      window.location.href = body.url;
    } catch {
      setErr("Network error — please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-1">
      <Button className="w-full" onClick={go} disabled={loading}>
        {loading ? "Loading…" : label}
      </Button>
      {err && <p className="text-xs text-destructive">{err}</p>}
    </div>
  );
}
