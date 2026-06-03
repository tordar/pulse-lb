"use client";

import { useState } from "react";

export function AccountActions({ hasCustomer }: { hasCustomer: boolean }) {
  const [loading, setLoading] = useState<"" | "portal" | "logout">("");

  async function openPortal() {
    setLoading("portal");
    try {
      const res = await fetch("/api/stripe/portal", { method: "POST" });
      if (!res.ok) return;
      const body = (await res.json()) as { url: string };
      window.location.href = body.url;
    } finally {
      setLoading("");
    }
  }

  async function logout() {
    setLoading("logout");
    const form = document.createElement("form");
    form.method = "POST";
    form.action = "/auth/logout";
    document.body.appendChild(form);
    form.submit();
  }

  return (
    <div className="flex flex-wrap gap-3">
      {hasCustomer && (
        <button
          onClick={openPortal}
          disabled={loading !== ""}
          className="px-3 py-1.5 rounded-md border border-card-border text-sm hover:bg-muted disabled:opacity-60"
        >
          {loading === "portal" ? "Opening…" : "Manage billing"}
        </button>
      )}
      <button
        onClick={logout}
        disabled={loading !== ""}
        className="px-3 py-1.5 rounded-md border border-card-border text-sm hover:bg-muted disabled:opacity-60"
      >
        Sign out
      </button>
    </div>
  );
}
