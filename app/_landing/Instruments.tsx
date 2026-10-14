// app/_landing/Instruments.tsx
"use client";
import { useMemo } from "react";
import { dayStr, punchCard, topArtists, WEEKDAYS, yearCounts, yearOf, yearStartDay, type Filter, type Prepared } from "@/lib/landing/derive";
import type { Totals } from "./LandingClient";
import s from "./landing.module.css";

const n = (x: number) => x.toLocaleString("en-US");
const same = (a: Filter | null, b: Filter) => JSON.stringify(a) === JSON.stringify(b);

export function Instruments({ data, totals, filter, onFilter }: {
  data: Prepared; totals: Totals; filter: Filter | null; onFilter: (f: Filter | null) => void;
}) {
  const pc = useMemo(() => punchCard(data), [data]);
  const pMax = useMemo(() => Math.max(1, ...pc.flat()), [pc]);
  const years = useMemo(() => {
    const c = yearCounts(data), y0 = yearOf(data.baseMs, 0), y1 = yearOf(data.baseMs, data.maxDay);
    return Array.from({ length: y1 - y0 + 1 }, (_, k) => ({ year: y0 + k, count: c.get(y0 + k) ?? 0 }));
  }, [data]);
  const yMax = Math.max(1, ...years.map((y) => y.count));
  const top = useMemo(() => topArtists(data, 10), [data]);
  const toggle = (f: Filter) => onFilter(same(filter, f) ? null : f);
  const yearsSpan = (data.maxDay / 365.25).toFixed(1);

  return (
    <section className={s.section}>
      <header className={s.sectionHead}><span>{"// 01 — INSTRUMENTS"}</span><span>TAP TO LIGHT UP THE FIELD</span></header>
      <div className={s.grid}>
        <div className={s.gauge}>
          <h4>Weekday × hour</h4>
          <div className={s.punch}>
            <span />
            {Array.from({ length: 24 }, (_, h) => <span key={h} className={s.lab} style={{ textAlign: "center" }}>{h % 6 === 0 ? String(h).padStart(2, "0") : ""}</span>)}
            {WEEKDAYS.map((d, wd) => [
              <span key={d} className={s.lab}>{d}</span>,
              ...pc[wd].map((c, h) => {
                const f: Filter = { kind: "slot", weekday: wd, hour: h }, size = Math.max(8, Math.sqrt(c / pMax) * 100);
                return (
                  <button key={`${d}${h}`} type="button" className={`${s.cell} ${same(filter, f) ? s.sel : ""}`}
                    title={`${d} ${String(h).padStart(2, "0")}:00 · ${n(c)}`} onClick={() => toggle(f)}>
                    <i style={{ width: `${size}%`, height: `${size}%` }} />
                  </button>
                );
              }),
            ])}
          </div>
        </div>
        <div className={s.gauge}>
          <h4>Totals</h4>
          <div className={s.totals}>
            {[["Listens", n(totals.listens)], ["Artists", n(totals.artists)], ["Songs", n(totals.songs)], ["Since", dayStr(data.baseMs, 0)],
              ["Years", yearsSpan], ["Per day", (totals.listens / Math.max(1, data.maxDay)).toFixed(1)]].map(([k, v]) => (
              <div key={k}><div className={s.dim}>{k}</div><div className={s.v}>{v}</div></div>
            ))}
          </div>
        </div>
        <div className={s.gauge}>
          <h4>Listens per year</h4>
          <div className={s.bars}>
            {years.map(({ year, count }) => {
              const f: Filter = { kind: "year", year, from: yearStartDay(data.baseMs, year), to: yearStartDay(data.baseMs, year + 1) };
              return <button key={year} type="button" className={`${s.bar} ${same(filter, f) ? s.sel : ""}`}
                style={{ height: `${(count / yMax) * 100}%` }} title={`${year} · ${n(count)}`} onClick={() => toggle(f)} />;
            })}
          </div>
          <div className={s.barlabs}><span>{years[0]?.year}</span><span>{years[years.length - 1]?.year}</span></div>
        </div>
        <div className={s.gauge}>
          <h4>Top artists</h4>
          {top.map((a, k) => {
            const f: Filter = { kind: "artist", rank: a.rank };
            return (
              <button key={a.rank} type="button" className={`${s.row} ${same(filter, f) ? s.sel : ""}`} onClick={() => toggle(f)}>
                <span className={s.dim}>{String(k + 1).padStart(2, "0")}</span>
                <span className={s.name}>{a.name}<s style={{ width: `${(a.count / top[0].count) * 100}%` }} /></span>
                <span className={s.ct}>{n(a.count)}</span>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
