"use client";
import { useLiveRecent } from "@/lib/sync/liveDelta";
import { splitDateTime } from "@/lib/format";

// Listens the poller has seen that the server-rendered list doesn't include
// yet. Same row markup as RecentListens; disappears as refreshes catch up.
export function LiveRecent({ newestServer }: { newestServer: string | null }) {
  const rows = useLiveRecent().filter((r) => !newestServer || r.listened_at > newestServer);
  return (
    <>
      {rows.map((r) => {
        const { date, time } = splitDateTime(r.listened_at);
        return (
          <li key={`${r.listened_at}|${r.track_name}`} className="flex gap-3 py-2 items-baseline">
            <span className="text-subtle-foreground tabular-nums shrink-0 text-xs leading-tight whitespace-nowrap">
              <span className="block">{date}</span>
              <span className="block">{time}</span>
            </span>
            <span className="min-w-0 flex-1 truncate">
              <span className="text-foreground">{r.track_name}</span>
              <span className="text-subtle-foreground"> · {r.artist_name}</span>
              {r.release_name && <span className="text-subtle-foreground"> · {r.release_name}</span>}
            </span>
          </li>
        );
      })}
    </>
  );
}
