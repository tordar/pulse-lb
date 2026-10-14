// app/_landing/Landing.tsx
import { allTimeStats } from "@/lib/db/queries/stats";
import { showcaseUser } from "@/lib/landing/showcase";
import { LandingClient } from "./LandingClient";
import { SignInOnly } from "./SignInOnly";

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
