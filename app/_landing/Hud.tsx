// app/_landing/Hud.tsx
import Link from "next/link";
import type { ListenAt } from "@/lib/landing/query";
import type { Totals } from "./LandingClient";
import s from "./landing.module.css";

export function Hud({ user, totals, latest, chip, onClear }: {
  user: string; totals: Totals; latest: ListenAt | null; chip: string | null; onClear: () => void;
}) {
  const n = (x: number) => x.toLocaleString("en-US");
  return (
    <>
      <div className={`${s.hud} ${s.tl}`}>
        <div className={s.brand}>PULSE // {user.toUpperCase()}</div>
        <div><b>{n(totals.listens)}</b> LISTENS · <b>{n(totals.artists)}</b> ARTISTS</div>
        {chip && <div className={s.chip}>FILTER ▸ {chip.toUpperCase()}<button type="button" onClick={onClear} aria-label="Clear filter">×</button></div>}
      </div>
      {latest && (
        <div className={`${s.hud} ${s.bl}`}>
          <div className={s.dim}>LATEST ▸</div>
          <div><b>{latest.artist} — {latest.track}</b></div>
        </div>
      )}
      <div className={`${s.hud} ${s.br}`}>
        <Link className={s.btn} href={`/u/${encodeURIComponent(user)}/stats`}>View {user}&apos;s profile →</Link>
        <br />
        <a className={`${s.btn} ${s.solid}`} href="/auth/login">Sign in with ListenBrainz</a>
      </div>
      <div className={`${s.hud} ${s.bc}`}>SCROLL ↓</div>
    </>
  );
}
