"use client";
import Link from "next/link";
import { useLiveRecent } from "@/lib/sync/liveDelta";
import { songHref, splitDateTime } from "@/lib/format";

// Listens the poller has seen that the server-rendered list doesn't include
// yet. Same row markup as RecentListens; disappears as refreshes catch up.
export function LiveRecent({ username, newestServer }: { username: string; newestServer: string | null }) {
  const rows = useLiveRecent().filter((r) => !newestServer || r.listened_at > newestServer);
  return (
    <>
      {rows.map((r) => {
        const { date, time } = splitDateTime(r.listened_at);
        const href = songHref(username, r);
        const row = (
          <>
            <span className="text-subtle-foreground tabular-nums shrink-0 text-xs leading-tight whitespace-nowrap">
              <span className="block">{date}</span>
              <span className="block">{time}</span>
            </span>
            <span className="min-w-0 flex-1 truncate">
              <span className="text-foreground">{r.track_name}</span>
              <span className="text-subtle-foreground"> · {r.artist_name}</span>
              {r.release_name && <span className="text-subtle-foreground"> · {r.release_name}</span>}
            </span>
          </>
        );
        return (
          <li key={`${r.listened_at}|${r.track_name}`}>
            {href ? (
              <Link href={href} className="flex gap-3 py-2 items-baseline hover:bg-muted active:bg-muted transition-colors -mx-2 px-2 rounded">
                {row}
              </Link>
            ) : (
              <div className="flex gap-3 py-2 items-baseline">{row}</div>
            )}
          </li>
        );
      })}
    </>
  );
}
