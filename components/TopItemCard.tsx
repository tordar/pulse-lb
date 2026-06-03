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
    <div className="h-full flex flex-col gap-3 p-3 rounded-lg border border-card-border bg-card hover:bg-muted/40 transition-colors">
      <CoverArt
        art={art}
        size={240}
        alt={title}
        className={`w-full aspect-square ${artShape === "circle" ? "rounded-full" : "rounded-md"}`}
      />
      <div className="flex flex-col gap-1.5 flex-1">
        <div className="inline-flex w-fit items-center px-2 py-0.5 rounded-md bg-muted text-xs font-medium tabular-nums">
          #{rank}
        </div>
        <p
          className="font-semibold text-sm leading-snug line-clamp-2 break-words"
          title={title}
        >
          {title}
        </p>
        {subtitle && (
          <p
            className="text-xs text-muted-foreground line-clamp-1 break-words"
            title={subtitle}
          >
            {subtitle}
          </p>
        )}
        <div className="flex items-center gap-3 text-xs text-muted-foreground tabular-nums pt-0.5 mt-auto">
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
    <Link href={href} className="block h-full">
      {inner}
    </Link>
  ) : (
    inner
  );
}
