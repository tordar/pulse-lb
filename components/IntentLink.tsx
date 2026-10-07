"use client";

import Link from "next/link";
import { useState } from "react";

/**
 * <Link> that prefetches the shared App Shell up front and the destination's
 * cached content only once the user shows intent (pointer over it, or a finger
 * down on it). Lists render 50+ rows; full-prefetching every one would be a
 * server call — and possibly a Neon wake-up — per row nobody opens.
 */
export function IntentLink({ onMouseEnter, onTouchStart, ...props }: React.ComponentProps<typeof Link>) {
  const [intent, setIntent] = useState(false);
  return (
    <Link
      {...props}
      prefetch={intent ? true : "auto"}
      onMouseEnter={(e) => { setIntent(true); onMouseEnter?.(e); }}
      onTouchStart={(e) => { setIntent(true); onTouchStart?.(e); }}
    />
  );
}
