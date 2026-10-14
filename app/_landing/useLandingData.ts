// app/_landing/useLandingData.ts
"use client";
import { useEffect, useState } from "react";
import { decodePayload } from "@/lib/landing/payload";
import { prepare, type Prepared } from "@/lib/landing/derive";

export function useLandingData(): { data: Prepared | null; error: boolean } {
  const [state, setState] = useState<{ data: Prepared | null; error: boolean }>({ data: null, error: false });
  useEffect(() => {
    let live = true;
    fetch("/api/landing/points")
      .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.arrayBuffer(); })
      .then((buf) => { if (live) setState({ data: prepare(decodePayload(buf)), error: false }); })
      .catch(() => { if (live) setState({ data: null, error: true }); });
    return () => { live = false; };
  }, []);
  return state;
}
