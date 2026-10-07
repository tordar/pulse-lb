"use client";

import { useState } from "react";
import { IntentLink } from "@/components/IntentLink";
import { Play, Clock } from "lucide-react";
import { CoverArt } from "@/components/CoverArt";
import { FlipList } from "@/components/FlipList";
import { fmtHours } from "@/lib/format";
import { getCounters, getGeneration, useLiveVersion } from "@/lib/sync/liveDelta";

export type TopListItem = {
  /** Stable identity across renders — React key and FLIP tracking. */
  key: string;
  /** Bucket this row shares with incoming listens; see lib/sync/liveDelta.ts. */
  matchKey: string;
  title: string;
  subtitle: string;
  plays: number;
  effectiveMs: number;
  caaId: number | null;
  caaReleaseMbid: string | null;
  href: string | null;
};

/**
 * A top-5 list that re-ranks itself as a sync streams listens in.
 *
 * The server sends the standings as of the last aggregate rebuild. Each row adds
 * whatever plays have landed for it since, and the list re-sorts — so a song
 * overtaking another is visible immediately rather than at the next refresh.
 *
 * Only these five rows can move: a track sitting at #9 that earns its way into
 * the top 5 isn't in the payload, so it appears when real data next arrives.
 */
export function TopList({
  items,
  kind,
  artShape = "square",
}: {
  items: TopListItem[];
  kind: "song" | "artist" | "album";
  artShape?: "square" | "circle";
}) {
  if (items.length === 0) {
    return (
      <ol className="space-y-2">
        <li className="text-sm text-subtle-foreground italic">no plays</li>
      </ol>
    );
  }
  return (
    <FlipList className="space-y-2">
      <Ranked items={items} kind={kind} artShape={artShape} />
    </FlipList>
  );
}

function Ranked({
  items,
  kind,
  artShape,
}: {
  items: TopListItem[];
  kind: "song" | "artist" | "album";
  artShape: "square" | "circle";
}) {
  useLiveVersion();
  const counters = getCounters();

  // Where the projection stood when the server figures last changed. Anything
  // already reflected in `items` must not be added a second time, and without
  // this the counts would jump on every refresh and then slide back.
  const signature =
    `${getGeneration()}#` + items.map((it) => `${it.key}:${it.plays}`).join("|");
  const [prevSig, setPrevSig] = useState(signature);
  const [zero, setZero] = useState(() => zeroPoint(items, kind));
  if (signature !== prevSig) {
    setPrevSig(signature);
    setZero(zeroPoint(items, kind));
  }

  const ranked = items.map((item, order) => {
    const now = counters[kind].get(item.matchKey);
    const zeroed = zero.get(item.matchKey);
    // Clamped: resetLive() can drop the projection below an old zero point.
    const addedPlays = Math.max(0, (now?.plays ?? 0) - (zeroed?.plays ?? 0));
    const addedMs = Math.max(0, (now?.ms ?? 0) - (zeroed?.ms ?? 0));
    return {
      item,
      order,
      plays: item.plays + addedPlays,
      effectiveMs: item.effectiveMs + addedMs,
    };
  });
  // Server order breaks ties, so equal counts don't shuffle on every poll.
  ranked.sort((a, b) => b.plays - a.plays || a.order - b.order);

  return (
    <>
      {ranked.map((row, i) => (
        <Row
          key={row.item.key}
          rank={i + 1}
          item={row.item}
          plays={row.plays}
          effectiveMs={row.effectiveMs}
          artShape={artShape}
        />
      ))}
    </>
  );
}

function zeroPoint(items: TopListItem[], kind: "song" | "artist" | "album") {
  const c = getCounters();
  return new Map(
    items.map((it) => {
      const t = c[kind].get(it.matchKey);
      return [it.matchKey, { plays: t?.plays ?? 0, ms: t?.ms ?? 0 }];
    }),
  );
}

function Row({
  rank,
  item,
  plays,
  effectiveMs,
  artShape,
}: {
  rank: number;
  item: TopListItem;
  plays: number;
  effectiveMs: number;
  artShape: "square" | "circle";
}) {
  const hours = effectiveMs / 1000 / 3600;
  const inner = (
    <div className="flex items-start gap-3">
      <span className="shrink-0 w-8 h-8 rounded-md bg-muted text-xs font-medium text-muted-foreground tabular-nums grid place-items-center mt-0.5">
        {rank}
      </span>
      <CoverArt
        art={{ caaId: item.caaId, caaReleaseMbid: item.caaReleaseMbid }}
        size={64}
        alt={item.title}
        className={`mt-0.5 ${artShape === "circle" ? "rounded-full" : "rounded-md"}`}
      />
      <div className="flex-1 min-w-0">
        <p className="font-medium text-sm break-words">{item.title}</p>
        <p className="text-xs text-muted-foreground break-words mb-2">{item.subtitle}</p>
        <div className="flex items-center gap-3 text-xs text-muted-foreground tabular-nums">
          <div className="flex items-center gap-1">
            <Play className="w-3 h-3" />
            <span>{plays.toLocaleString()}</span>
          </div>
          {hours > 0 && (
            <div className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              <span>{fmtHours(hours)}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
  return (
    <li data-flip-key={item.key}>
      {item.href ? (
        <IntentLink
          href={item.href}
          className="block p-2 rounded-md hover:bg-muted/50 active:bg-muted transition-colors"
        >
          {inner}
        </IntentLink>
      ) : (
        <div className="p-2 rounded-md">{inner}</div>
      )}
    </li>
  );
}
