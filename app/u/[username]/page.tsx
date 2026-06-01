import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { SyncButton } from "./SyncButton";

type TopArtist = { artist_name: string; plays: number };

export default async function UserPage({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;

  const [state, topArtistsRes] = await Promise.all([
    db.query.syncState.findFirst({ where: eq(schema.syncState.userName, username) }),
    db.execute<TopArtist>(sql`
      SELECT artist_name, COUNT(*)::int AS plays
      FROM ${schema.listens}
      WHERE user_name = ${username} AND artist_name IS NOT NULL
      GROUP BY artist_name
      ORDER BY plays DESC
      LIMIT 10
    `),
  ]);

  const topArtists = (topArtistsRes as { rows: TopArtist[] }).rows ?? (topArtistsRes as unknown as TopArtist[]);

  return (
    <main className="p-8 max-w-3xl mx-auto space-y-8">
      <header>
        <h1 className="text-3xl font-bold">{username}</h1>
        {state ? (
          <p className="text-sm text-gray-500 mt-1">
            {state.totalListens.toLocaleString()} listens
            {state.lastSyncedAt && ` · last synced ${formatRelative(state.lastSyncedAt)}`}
          </p>
        ) : (
          <p className="text-sm text-gray-500 mt-1">No data yet. Click sync to backfill.</p>
        )}
      </header>

      <SyncButton username={username} />

      {topArtists.length > 0 ? (
        <section>
          <h2 className="text-xl font-semibold mb-3">Top 10 artists</h2>
          <ol className="space-y-1 font-mono text-sm">
            {topArtists.map((r, i) => (
              <li key={r.artist_name} className="flex justify-between">
                <span>
                  {String(i + 1).padStart(2, " ")}. {r.artist_name}
                </span>
                <span className="text-gray-500">{r.plays.toLocaleString()}</span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </main>
  );
}

function formatRelative(d: Date): string {
  const secs = Math.floor((Date.now() - d.getTime()) / 1000);
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return d.toISOString().slice(0, 10);
}
