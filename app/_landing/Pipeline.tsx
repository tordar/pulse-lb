// app/_landing/Pipeline.tsx
"use client";
import { Fragment, useEffect, useRef, useState } from "react";
import type { ListenAt } from "@/lib/landing/query";
import type { Totals } from "./LandingClient";
import s from "./landing.module.css";

const n = (x: number) => x.toLocaleString("en-US");

function ago(iso: string): string {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (m < 60) return `${m}m ago`;
  if (m < 60 * 24) return `${Math.round(m / 60)}h ago`;
  return `${Math.round(m / 60 / 24)}d ago`;
}

// Index of the first "every listen" stage: the latest listen travels from here to the end.
const LIVE = 4;

export function Pipeline({ totals, latest }: { totals: Totals; latest: ListenAt | null }) {
  const stages: [string, string, string, React.ReactNode][] = [
    ["01 EXPORT", "Spotify", "5–30 days", <>Request your extended streaming history from Spotify.</>],
    ["02 IMPORT", "ListenBrainz", `${n(totals.listens)} listens`, <>Upload the files to ListenBrainz, the open listen archive. It ensures all data stays correct, even when streaming services change internal ids.</>],
    ["03 SIGN IN", "ListenBrainz account", "30-day session", <>Sign in with the account behind ListenBrainz, so pulse knows whose listens to fetch.</>],
    ["04 BACKFILL", "pulse server", "1,000 per request", <>The first visit copies the whole history from ListenBrainz, a thousand listens at a time, then builds every total and top list once.</>],
    ["05 SCROBBLE", "Player → ListenBrainz", latest ? `latest ${ago(latest.listenedAt)}` : "Live", <>Spotify and Navidrome send each play to ListenBrainz as it happens. pulse never connects to a player.</>],
    ["06 POLL", "Your browser", "every 15s", <>While a profile page is open, the browser checks ListenBrainz for new listens. No open page, no checking.</>],
    ["07 STORE", "Database", `${n(totals.listens)} rows`, <>The server fetches only what is newer than the last stored listen and saves each one once.</>],
    ["08 AGGREGATE", "Summaries", `${n(totals.artists)} artists`, <>At the same time, only the totals and top lists the new listen touches are updated, so pages never recount every listen.</>],
    ["09 SERVE", "This page", "You are here", <>Pages stay cached until a new listen arrives. The mountain above is one file holding every listen, drawn by your graphics card.</>],
  ];
  const last = stages.length - 1;
  const ref = useRef<HTMLElement>(null);
  const [active, setActive] = useState(-1);

  // The latest listen travels the live stages once when the section comes into view, then rests on SERVE.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let id = 0;
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      io.disconnect();
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setActive(last); return; }
      setActive(LIVE);
      id = window.setInterval(() => setActive((a) => {
        if (a + 1 >= last) window.clearInterval(id);
        return Math.min(a + 1, last);
      }), 700);
    }, { threshold: 0.3 });
    io.observe(el);
    return () => { io.disconnect(); window.clearInterval(id); };
  }, [last]);
  const packet = latest ? `▸ ${latest.artist} — ${latest.track}` : "";

  return (
    <section ref={ref} className={s.section}>
      <header className={s.sectionHead}><span>Pipeline</span><span>How a listen gets here</span></header>
      <div className={s.pipe}>
        {stages.map(([num, title, value, spec], k) => (
          <Fragment key={num}>
            {k === 0 && <div className={s.group}>Once</div>}
            {k === LIVE && <div className={`${s.group} ${s.groupNext}`}>Every listen</div>}
            {k > 0 && k !== LIVE && <div className={s.wire} />}
            <div className={s.stage}>
              <div className={`${s.node} ${k === active && packet ? s.active : ""}`}>
                <div className={s.dim}>{num}</div>
                <div>{title}</div>
                <div className={s.v}>{value}</div>
                <div className={s.pkt}>{k === active ? packet : ""}</div>
              </div>
              <div className={s.spec}>{spec}</div>
            </div>
          </Fragment>
        ))}
      </div>
    </section>
  );
}
