import Link from "next/link";
import { Play, Clock } from "lucide-react";
import { CoverArt } from "@/components/CoverArt";
import type { CoverArtRef } from "@/lib/listenbrainz/coverArt";
import { fmtListeningTime } from "@/lib/format";

export function TopItemCard({
  rank,
  art,
  artShape = "square",
  title,
  subtitle,
  plays,
  effectiveMs,
  href,
}: {
  rank: number;
  art: CoverArtRef;
  artShape?: "square" | "circle";
  title: string;
  subtitle?: string | null;
  plays: number;
  effectiveMs: number;
  href: string | null;
}) {
  const inner = (
    <div className="space-y-3 p-3 rounded-lg border border-card-border bg-card hover:bg-muted/40 transition-colors">
      <CoverArt
        art={art}
        size={240}
        alt={title}
        className={`w-full h-auto aspect-square ${artShape === "circle" ? "rounded-full" : "rounded-md"}`}
      />
      <div className="space-y-1.5">
        <div className="inline-flex items-center gap-2 px-2 py-0.5 rounded-md bg-muted text-xs font-medium tabular-nums">
          #{rank}
        </div>
        <p className="font-semibold text-sm break-words leading-snug">{title}</p>
        {subtitle && (
          <p className="text-xs text-muted-foreground break-words">{subtitle}</p>
        )}
        <div className="flex items-center gap-3 text-xs text-muted-foreground tabular-nums pt-0.5">
          <span className="inline-flex items-center gap-1">
            <Play size={12} /> {plays.toLocaleString()}
          </span>
          {effectiveMs > 0 && (
            <span className="inline-flex items-center gap-1">
              <Clock size={12} /> {fmtListeningTime(effectiveMs)}
            </span>
          )}
        </div>
      </div>
    </div>
  );

  return href ? (
    <Link href={href} className="block">
      {inner}
    </Link>
  ) : (
    inner
  );
}
