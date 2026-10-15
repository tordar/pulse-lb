// app/_landing/Landing.tsx
import { allTimeStats } from "@/lib/db/queries/stats";
import { showcaseUser } from "@/lib/landing/showcase";
import { LandingClient } from "./LandingClient";
import { SignInOnly } from "./SignInOnly";
import s from "./landing.module.css";

export async function Landing() {
  const user = showcaseUser();
  let t;
  try { t = await allTimeStats(user); } catch { return <SignInOnly />; }
  if (!t.total_plays) return <SignInOnly />;
  return (
    <LandingClient
      user={user}
      totals={{ listens: t.total_plays, artists: t.distinct_artists, albums: t.distinct_albums, songs: t.distinct_songs }}
    />
  );
}

/** What the landing looks like while the server is still counting listens (a cold database can take seconds). */
export function LandingLoading() {
  return (
    <div className={s.root}>
      <div className={s.hero}>
        <div className={`${s.hud} ${s.tl}`}><div className={s.brand}>PULSE</div></div>
        <p className={`${s.msg} ${s.loading}`}>Loading listens</p>
        <div className={`${s.hud} ${s.br}`}>
          <a className={`${s.btn} ${s.solid}`} href="/auth/login">Sign in with ListenBrainz</a>
        </div>
      </div>
    </div>
  );
}
