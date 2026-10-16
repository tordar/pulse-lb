// app/_landing/LandingClient.tsx
"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { countMatches, filterLabel, type Filter } from "@/lib/landing/derive";
import type { ListenAt } from "@/lib/landing/query";
import s from "./landing.module.css";
import { Hud } from "./Hud";
import { Instruments } from "./Instruments";
import { fetchListen } from "./listen";
import { Pipeline } from "./Pipeline";
import { Scene, type Arrival } from "./Scene";
import { useLandingData } from "./useLandingData";
import { useLiveListens } from "./useLiveListens";

export type Totals = { listens: number; artists: number; albums: number; songs: number };

export function LandingClient({ user, totals }: { user: string; totals: Totals }) {
  const { data, error } = useLandingData();
  const [filter, setFilter] = useState<Filter | null>(null);
  const [latest, setLatest] = useState<ListenAt | null>(null);
  const [arrivals, setArrivals] = useState<Arrival[]>([]);
  const [extra, setExtra] = useState(0);
  const [fresh, setFresh] = useState(false);
  const freshTimer = useRef(0);

  useEffect(() => {
    // A live listen may already have taken the LATEST line by the time this resolves.
    if (data) fetchListen(data.payload.header.lastTs).then((l) => setLatest((cur) => cur ?? l));
  }, [data]);

  useLiveListens(user, data?.payload.header.lastTs ?? null, (listens, quiet) => setArrivals((cur) => [
    ...cur,
    ...listens.map((l) => ({
      ts: l.listened_at, track: l.track_metadata.track_name, artist: l.track_metadata.artist_name, quiet,
      recordingMbid: l.track_metadata.mbid_mapping?.recording_mbid ?? l.track_metadata.additional_info?.recording_mbid ?? null,
    })),
  ]));

  // Scene calls this when a listen goes on screen: as its flight leaves, or straight away if it doesn't fly.
  const onShow = useCallback((a: Arrival, flying: boolean) => {
    setLatest({ track: a.track, artist: a.artist, recordingMbid: a.recordingMbid, artistMbid: null, listenedAt: new Date(a.ts * 1000).toISOString() });
    setExtra((x) => x + 1);
    if (!flying) return;
    setFresh(true);
    window.clearTimeout(freshTimer.current);
    freshTimer.current = window.setTimeout(() => setFresh(false), 2500);
  }, []);
  const liveTotals = useMemo(() => ({ ...totals, listens: totals.listens + extra }), [totals, extra]);

  const chip = useMemo(
    () => (filter && data ? `${filterLabel(filter, data)} · ${countMatches(filter, data).toLocaleString("en-US")}` : null),
    [filter, data],
  );

  return (
    <div className={s.root}>
      <Scene data={data} error={error} user={user} filter={filter} arrivals={arrivals} onShow={onShow}>
        <Hud user={user} totals={liveTotals} latest={latest} fresh={fresh} chip={chip} onClear={() => setFilter(null)} />
      </Scene>
      <main className={s.main}>
        {data && <Instruments data={data} totals={liveTotals} filter={filter} onFilter={setFilter} />}
        <Pipeline totals={liveTotals} latest={latest} />
        <footer className={s.footer}><span>{user}</span><span>pulse</span></footer>
      </main>
    </div>
  );
}
