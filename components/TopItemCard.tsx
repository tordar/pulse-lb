import { IntentLink } from "@/components/IntentLink";
import { Play, Clock, ArrowUp } from "lucide-react";
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
  badge,
  rankMove,
  recentPlays,
}: {
  rank: number;
  art: CoverArtRef;
  artShape?: "square" | "circle";
  title: string;
  subtitle?: string | null;
  plays: number;
  effectiveMs: number;
  href: string | null;
  badge?: string | null;
  // 30-day movement, when the owner turned it on: "+3" / "new", plays gained.
  rankMove?: number | "new" | null;
  recentPlays?: number;
}) {
  const inner = (
    <div className="h-full flex flex-col gap-3 p-3 rounded-lg border border-card-border bg-card hover:bg-muted/40 active:bg-muted/60 active:scale-[0.98] transition">
      <CoverArt
        art={art}
        size={240}
        alt={title}
        className={`w-full aspect-square ${artShape === "circle" ? "rounded-full" : "rounded-md"}`}
      />
      <div className="flex flex-col gap-1.5 flex-1">
        <div className="flex flex-wrap gap-1.5">
          <div className="inline-flex w-fit items-center px-2 py-0.5 rounded-md bg-muted text-xs font-medium tabular-nums">
            #{rank}
            {rankMove && <RankMove move={rankMove} className="ml-1" />}
          </div>
          {badge && (
            <div className="inline-flex w-fit items-center px-2 py-0.5 rounded-md bg-primary/10 text-primary text-xs font-medium">
              {badge}
            </div>
          )}
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
            {!!recentPlays && <span className="text-primary">+{recentPlays.toLocaleString()}</span>}
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
    <IntentLink href={href} className="block h-full">
      {inner}
    </IntentLink>
  ) : (
    inner
  );
}

/** Places climbed, as a green up arrow and count, or "new". */
export function RankMove({ move, className = "" }: { move: number | "new"; className?: string }) {
  return (
    <span className={`inline-flex items-center text-primary tabular-nums ${className}`}>
      {move === "new" ? "new" : <><ArrowUp size="1em" strokeWidth={2.5} />{move}</>}
    </span>
  );
}
