"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/Button";

export function CopyButton({
  text,
  label = "Copy",
  className,
}: {
  text: string;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={className}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          // Clipboard API unavailable (e.g. non-HTTPS context) — no-op.
        }
      }}
    >
      {copied ? (
        <>
          <Check size={14} /> Copied
        </>
      ) : (
        <>
          <Copy size={14} /> {label}
        </>
      )}
    </Button>
  );
}
