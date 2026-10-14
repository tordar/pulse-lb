// app/_landing/LandingClient.tsx
"use client";
import { useEffect, useMemo, useState } from "react";
import { countMatches, filterLabel, type Filter } from "@/lib/landing/derive";
import type { ListenAt } from "@/lib/landing/query";
import s from "./landing.module.css";
import { Hud } from "./Hud";
import { Instruments } from "./Instruments";
import { fetchListen } from "./listen";
import { Pipeline } from "./Pipeline";
import { Scene } from "./Scene";
import { useLandingData } from "./useLandingData";

export type Totals = { listens: number; artists: number; albums: number; songs: number };

export function LandingClient({ user, totals }: { user: string; totals: Totals }) {
  const { data, error } = useLandingData();
  const [filter, setFilter] = useState<Filter | null>(null);
  const [latest, setLatest] = useState<ListenAt | null>(null);

  useEffect(() => {
    if (data) fetchListen(data.payload.header.lastTs).then(setLatest);
  }, [data]);

  const chip = useMemo(
    () => (filter && data ? `${filterLabel(filter, data)} · ${countMatches(filter, data).toLocaleString("en-US")}` : null),
    [filter, data],
  );

  return (
    <div className={s.root}>
      <Scene data={data} error={error} user={user} filter={filter}>
        <Hud user={user} totals={totals} latest={latest} chip={chip} onClear={() => setFilter(null)} />
      </Scene>
      <main className={s.main}>
        {data && <Instruments data={data} totals={totals} filter={filter} onFilter={setFilter} />}
        <Pipeline totals={totals} latest={latest} />
        <footer className={s.footer}><span>{user}</span><span>pulse</span></footer>
      </main>
    </div>
  );
}
