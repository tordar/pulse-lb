// app/_landing/Pipeline.tsx
"use client";
import { useEffect, useState } from "react";
import type { ListenAt } from "@/lib/landing/query";
import type { Totals } from "./LandingClient";
import s from "./landing.module.css";

const n = (x: number) => x.toLocaleString("en-US");

export function Pipeline({ totals, latest }: { totals: Totals; latest: ListenAt | null }) {
  const stages: [string, string, string, React.ReactNode][] = [
    ["01 SOURCE", "ListenBrainz", `${n(totals.listens)} listens`, <>Every play from Spotify, Navidrome and friends is scrobbled to <code>ListenBrainz</code>, the open listen archive run by MetaBrainz. pulse never talks to the players directly.</>],
    ["02 AUTH", "MB OAuth → JWT", "Session 30d", <>Sign in with your MetaBrainz account. The callback mints a signed <code>HS256</code> session cookie that keeps you signed in for 30 days.</>],
    ["03 INGEST", "Poll + delta", "Live", <>An open tab polls LB for new listens and asks the server to fetch only the delta. History is backfilled once; duplicates are dropped on <code>(user, listened_at, track)</code>.</>],
    ["04 ENRICH", "MusicBrainz", `${n(totals.songs)} songs`, <>Recording, release and release-group MBIDs are resolved against <code>MusicBrainz</code> for real titles and years, with covers from the Cover Art Archive.</>],
    ["05 STORE", "Postgres", `${n(totals.albums)} albums`, <>Everything lands in Postgres through <code>postgres-js</code>: one row per listen, plus the MusicBrainz catalog it points to.</>],
    ["06 AGGREGATE", "agg_* tables", "Incremental", <>Totals, years and top lists live in <code>agg_*</code> tables, updated by each ingest instead of scanning every listen on each page view.</>],
    ["07 SERVE", "Next.js → you", "Cache Components", <><code>Next.js 16</code> on Vercel serves cached shells instantly and streams the rest in. You are here.</>],
  ];
  const [active, setActive] = useState(0);
  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const id = window.setInterval(() => setActive((a) => (a + 1) % 7), reduced ? 2500 : 700);
    return () => window.clearInterval(id);
  }, []);
  const packet = latest ? `▸ ${latest.artist} — ${latest.track}` : "";

  return (
    <section className={s.section}>
      <header className={s.sectionHead}><span>Pipeline</span><span>How a listen gets here</span></header>
      <div className={s.pipe}>
        {stages.map(([num, title, value, spec], k) => (
          <div key={num}>
            {k > 0 && <div className={s.wire} />}
            <div className={s.stage}>
              <div className={`${s.node} ${k === active && packet ? s.active : ""}`}>
                <div className={s.dim}>{num}</div>
                <div>{title}</div>
                <div className={s.v}>{value}</div>
                <div className={s.pkt}>{k === active ? packet : ""}</div>
              </div>
              <div className={s.spec}>{spec}</div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
