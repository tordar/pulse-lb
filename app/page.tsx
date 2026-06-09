import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  CalendarDays,
  Check,
  Clock,
  Disc3,
  Eye,
  Flame,
  Music2,
  Radio,
  Sparkles,
  Trophy,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { SignInButton } from "@/components/SignInButton";
import { getSession } from "@/lib/auth/session";
import { allTimeStats } from "@/lib/db/queries/stats";
import { paymentsConfigured } from "@/lib/stripe";

const DEMO_USERNAME = "tordar";

export const revalidate = 300;

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; reason?: string; username?: string }>;
}) {
  const sp = await searchParams;
  const session = await getSession();
  const upstreamErr = sp.error === "upstream";
  const authErr = sp.error === "auth";

  const live = paymentsConfigured();
  const demo = await safeAllTime(DEMO_USERNAME);

  return (
    <main className="min-h-screen flex flex-col">
      {(upstreamErr || authErr) && (
        <div className="max-w-3xl mx-auto px-6 w-full pt-6">
          {upstreamErr && (
            <div className="flex gap-3 items-start p-4 rounded-md border border-amber-900/60 bg-amber-950/30 text-amber-100 text-sm">
              <AlertTriangle size={16} className="shrink-0 mt-0.5 text-amber-400" />
              <div className="space-y-1">
                <p className="font-medium">ListenBrainz looks unreachable right now.</p>
                <p className="text-amber-100/80">
                  Try again in a minute. Live status at{" "}
                  <a href="https://status.metabrainz.org/" target="_blank" rel="noreferrer" className="underline">
                    status.metabrainz.org
                  </a>
                  .
                </p>
              </div>
            </div>
          )}
          {authErr && (
            <div className="p-4 rounded-md border border-amber-900/60 bg-amber-950/30 text-amber-100 text-sm">
              Sign-in failed{sp.reason ? ` (${sp.reason})` : ""}. Please try again.
            </div>
          )}
        </div>
      )}

      <Hero session={session} />
      <DemoSection demo={demo} />
      <FeatureGrid />
      <HowItWorks />
      <Pricing live={live} signedIn={!!session} />
      <BrowseForm defaultValue={sp.username ?? ""} />
      <SiteFooter />
    </main>
  );
}

/* ---------------- hero ---------------- */

type DemoStats = Awaited<ReturnType<typeof safeAllTime>>;

function Hero({ session }: { session: Awaited<ReturnType<typeof getSession>> }) {
  return (
    <section className="relative overflow-hidden">
      <div className="absolute inset-0 -z-10 bg-gradient-to-b from-primary/5 via-transparent to-transparent" />
      <div className="absolute inset-x-0 top-0 -z-10 h-[480px] bg-[radial-gradient(ellipse_at_top,theme(colors.primary/0.18),transparent_60%)]" />
      <div className="max-w-6xl mx-auto px-6 pt-16 pb-20 md:pt-24 md:pb-28">
        <div className="max-w-3xl space-y-6">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-primary/30 bg-primary/10 text-primary text-xs font-medium">
            <Radio size={12} /> Powered by ListenBrainz
          </div>
          <h1 className="text-5xl md:text-6xl font-bold tracking-tight leading-[1.05]">
            Your listening history,{" "}
            <span className="text-primary">finally legible.</span>
          </h1>
          <p className="text-lg md:text-xl text-muted-foreground max-w-2xl">
            Every play you&apos;ve ever logged — Spotify, Apple Music, Tidal, your home server — in one
            place. Drill into any year, day, song, album or artist. Built on the open ListenBrainz
            database.
          </p>
          <div className="flex flex-wrap gap-3 pt-2">
            <Link href={`/u/${DEMO_USERNAME}/stats`}>
              <Button size="lg">
                See the live demo <ArrowRight size={16} />
              </Button>
            </Link>
            {session ? (
              <form action="/auth/logout" method="post">
                <Button size="lg" variant="outline" type="submit">
                  Sign out
                </Button>
              </form>
            ) : (
              <SignInButton label="Sign in with ListenBrainz" />
            )}
          </div>
          {session ? (
            <p className="text-xs text-muted-foreground">
              Signed in as <strong className="text-foreground">@{session.lbUsername}</strong> ·{" "}
              <Link href={`/u/${encodeURIComponent(session.lbUsername)}/stats`} className="text-primary hover:underline">
                your dashboard
              </Link>{" "}
              ·{" "}
              <Link href="/account" className="text-primary hover:underline">
                account settings
              </Link>
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Browsing any public profile is free, forever. Subscribe to add your own listens.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

/* ---------------- demo section ---------------- */

function DemoSection({ demo }: { demo: DemoStats }) {
  const links: { label: string; href: string; desc: string; icon: LucideIcon }[] = [
    {
      label: "All-time dashboard",
      href: `/u/${DEMO_USERNAME}/stats`,
      desc: "Heatmap, per-year charts, hourly distribution, top items by year",
      icon: BarChart3,
    },
    {
      label: "Top songs",
      href: `/u/${DEMO_USERNAME}/songs`,
      desc: "Every track ranked by plays. Filter, search, drill into any song.",
      icon: Music2,
    },
    {
      label: "Top albums",
      href: `/u/${DEMO_USERNAME}/albums`,
      desc: "Cover art grid of everything played. Click any album for its history.",
      icon: Disc3,
    },
    {
      label: "Top artists",
      href: `/u/${DEMO_USERNAME}/artists`,
      desc: "Lifetime artist ranking with per-artist deep-dives.",
      icon: Users,
    },
  ];
  return (
    <section className="border-y border-border/60 bg-card/40">
      <div className="max-w-6xl mx-auto px-6 py-16">
        <div className="flex items-end justify-between gap-4 flex-wrap mb-8">
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-widest text-primary font-medium">Try it out</p>
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight">
              Browse {demo ? nf(demo.total_plays) : ""} real plays — no sign-up
            </h2>
            <p className="text-muted-foreground max-w-2xl">
              Every page below works unauthenticated. Click around. Anything you can do on
              <span className="text-foreground"> @{DEMO_USERNAME}</span>&apos;s profile is what you&apos;ll
              get on yours.
            </p>
          </div>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="group rounded-lg border border-card-border bg-card p-5 hover:border-primary/60 hover:bg-card/80 transition-colors flex flex-col gap-3"
            >
              <l.icon size={20} className="text-primary" />
              <div className="space-y-1">
                <p className="font-semibold">{l.label}</p>
                <p className="text-sm text-muted-foreground">{l.desc}</p>
              </div>
              <div className="text-sm text-primary inline-flex items-center gap-1 mt-auto">
                Explore <ArrowRight size={14} className="group-hover:translate-x-0.5 transition-transform" />
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------------- features ---------------- */

function FeatureGrid() {
  const features: { icon: LucideIcon; title: string; body: string }[] = [
    {
      icon: Flame,
      title: "Heatmap of every day you listened",
      body:
        "GitHub-style year grid. Click any day to see the exact tracks you played, in order, with cover art.",
    },
    {
      icon: Trophy,
      title: "Top songs, albums & artists",
      body:
        "All-time and per-year leaderboards. Pre-aggregated so even huge libraries open instantly.",
    },
    {
      icon: CalendarDays,
      title: "Year-by-year drill-in",
      body:
        "Switch between any year you have data for. Compare what 2018-you was into vs. yesterday-you.",
    },
    {
      icon: Clock,
      title: "When you listen",
      body: "Hourly distribution charts — find out whether you’re a 9pm or a 3am person.",
    },
    {
      icon: Radio,
      title: "Now Playing live",
      body:
        "If you’re scrobbling right now, the pill at the top shows what’s playing — without a refresh.",
    },
    {
      icon: Eye,
      title: "Public by default",
      body:
        "Share your profile URL with anyone. Friends can drill into your data without an account. Private mode coming.",
    },
  ];
  return (
    <section id="features" className="max-w-6xl mx-auto px-6 py-20">
      <div className="space-y-2 mb-10">
        <p className="text-xs uppercase tracking-widest text-primary font-medium">What you get</p>
        <h2 className="text-3xl md:text-4xl font-bold tracking-tight">Built for the music nerd in you</h2>
      </div>
      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
        {features.map((f) => (
          <Card key={f.title} padding="lg" className="space-y-3">
            <f.icon size={20} className="text-primary" />
            <h3 className="font-semibold text-lg">{f.title}</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">{f.body}</p>
          </Card>
        ))}
      </div>
    </section>
  );
}

/* ---------------- how it works ---------------- */

function HowItWorks() {
  const steps: { title: string; body: React.ReactNode }[] = [
    {
      title: "Get your data into ListenBrainz",
      body: (
        <>
          New to LB? Sign up in 30s — it&apos;s free.{" "}
          <a
            href="https://listenbrainz.org/settings/music-services/details/"
            target="_blank"
            rel="noreferrer"
            className="underline"
          >
            Connect Spotify
          </a>{" "}
          to scrobble future plays automatically, or{" "}
          <Link href="/onboarding" className="underline">
            import your historical Spotify export
          </Link>{" "}
          (Spotify takes 5–30 days to prepare it). Already on LB? You&apos;re done — skip to step 2.
        </>
      ),
    },
    {
      title: "Sign in to pulse",
      body: <>One click via your ListenBrainz / MusicBrainz account. No password, no extra signup.</>,
    },
    {
      title: "Sync — we mirror your listens",
      body: (
        <>
          Pulse pulls your full history from LB into our database and enriches it with cover art and
          metadata. First sync takes a few minutes on large libraries; subsequent syncs fill in only
          what&apos;s new.
        </>
      ),
    },
    {
      title: "Explore",
      body: (
        <>
          Open your dashboard. Click a year. Click a day. Click a song. Every drill-down loads
          instantly from local cache. Your profile is shareable — give the link to friends.
        </>
      ),
    },
  ];
  return (
    <section id="how" className="border-y border-border/60 bg-card/40">
      <div className="max-w-6xl mx-auto px-6 py-20">
        <div className="space-y-2 mb-10">
          <p className="text-xs uppercase tracking-widest text-primary font-medium">How it works</p>
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight">Four steps, mostly waiting on Spotify</h2>
          <p className="text-muted-foreground max-w-2xl">
            The slow part is Spotify&apos;s 5–30 day export. We can&apos;t fix that — but everything on
            our end is fast.
          </p>
        </div>
        <ol className="grid md:grid-cols-2 gap-6">
          {steps.map((s, i) => (
            <li key={s.title} className="flex gap-5">
              <div className="shrink-0 w-10 h-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-mono font-bold">
                {i + 1}
              </div>
              <div className="space-y-2 pt-1">
                <h3 className="font-semibold text-lg">{s.title}</h3>
                <p className="text-foreground/80 text-sm leading-relaxed">{s.body}</p>
              </div>
            </li>
          ))}
        </ol>
        <div className="mt-10">
          <Link href="/onboarding" className="text-sm text-primary hover:underline inline-flex items-center gap-1">
            See the full onboarding guide <ArrowRight size={14} />
          </Link>
        </div>
      </div>
    </section>
  );
}

/* ---------------- pricing ---------------- */

function Pricing({ live, signedIn }: { live: boolean; signedIn: boolean }) {
  const plans: {
    title: string;
    price: string;
    sub: string;
    features: string[];
    plan: "annual" | "lifetime";
    highlight?: boolean;
  }[] = [
    {
      title: "Free",
      price: "$0",
      sub: "forever",
      plan: "annual",
      features: [
        "Browse any public profile",
        "Full drill-downs on the demo",
        "Heatmap, year tabs, per-day history",
        "No account needed",
      ],
    },
    {
      title: "Annual",
      price: "$10",
      sub: "/year",
      plan: "annual",
      features: [
        "Sync your own ListenBrainz data",
        "Your own dashboard, public URL",
        "7-day free trial",
        "Cancel any time",
      ],
      highlight: true,
    },
    {
      title: "Lifetime",
      price: "$25",
      sub: "once",
      plan: "lifetime",
      features: [
        "Pay once, sync forever",
        "All future features included",
        "Support a solo project",
        "Best long-run value",
      ],
    },
  ];
  return (
    <section id="pricing" className="max-w-6xl mx-auto px-6 py-20">
      <div className="space-y-2 mb-10 text-center max-w-2xl mx-auto">
        <p className="text-xs uppercase tracking-widest text-primary font-medium">Pricing</p>
        <h2 className="text-3xl md:text-4xl font-bold tracking-tight">
          Free to browse. $10/yr to add your own.
        </h2>
        <p className="text-muted-foreground">
          Visualizations are open. The data-sync layer is what costs to run.
        </p>
      </div>
      {!live ? (
        <Card padding="lg" className="text-center text-muted-foreground max-w-xl mx-auto">
          Payments are not configured yet — coming soon.
        </Card>
      ) : (
        <div className="grid md:grid-cols-3 gap-4">
          {plans.map((p) => (
            <div
              key={p.title}
              className={`relative rounded-lg border p-6 space-y-4 ${
                p.highlight
                  ? "border-primary bg-primary/[0.03]"
                  : "border-card-border bg-card"
              }`}
            >
              {p.highlight && (
                <span className="absolute -top-3 left-6 text-[10px] uppercase tracking-widest font-bold px-2 py-1 rounded-full bg-primary text-primary-foreground">
                  Most popular
                </span>
              )}
              <div className="space-y-1">
                <h3 className="text-lg font-semibold">{p.title}</h3>
                <p className="text-3xl font-bold font-mono">
                  {p.price}
                  <span className="text-base font-normal text-muted-foreground"> {p.sub}</span>
                </p>
              </div>
              <ul className="space-y-2 text-sm">
                {p.features.map((f) => (
                  <li key={f} className="flex items-start gap-2">
                    <Check size={16} className="text-primary mt-0.5 shrink-0" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              {p.title === "Free" ? (
                <Link href={`/u/${DEMO_USERNAME}/stats`}>
                  <Button variant="outline" className="w-full">
                    Browse the demo
                  </Button>
                </Link>
              ) : signedIn ? (
                <Link href="/pricing">
                  <Button className="w-full" variant={p.highlight ? "primary" : "outline"}>
                    Choose {p.title.toLowerCase()}
                  </Button>
                </Link>
              ) : (
                <Link href={`/auth/login?return=${encodeURIComponent("/pricing")}`}>
                  <Button className="w-full" variant={p.highlight ? "primary" : "outline"}>
                    Sign in to subscribe
                  </Button>
                </Link>
              )}
            </div>
          ))}
        </div>
      )}
      <p className="text-xs text-muted-foreground text-center mt-6">
        Subscription cancellation keeps your data for 30 days, then deletes it. GDPR deletion on request.
      </p>
    </section>
  );
}

/* ---------------- browse form ---------------- */

function BrowseForm({ defaultValue }: { defaultValue: string }) {
  return (
    <section id="browse" className="border-t border-border/60 bg-card/40">
      <div className="max-w-3xl mx-auto px-6 py-16">
        <div className="space-y-2 mb-6 text-center">
          <Sparkles size={20} className="text-primary inline" />
          <h2 className="text-2xl md:text-3xl font-bold tracking-tight">Browse any public profile</h2>
          <p className="text-muted-foreground">
            Got a friend on pulse? Drop their ListenBrainz username here.
          </p>
        </div>
        <form action="/u" className="flex gap-2 max-w-lg mx-auto">
          <input
            id="username"
            name="username"
            required
            defaultValue={defaultValue}
            placeholder="e.g. tordar"
            className="flex-1 border border-border bg-input rounded-md px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-primary"
          />
          <Button type="submit" size="lg">
            View
          </Button>
        </form>
      </div>
    </section>
  );
}

/* ---------------- footer ---------------- */

function SiteFooter() {
  return (
    <footer className="border-t border-border/60">
      <div className="max-w-6xl mx-auto px-6 py-10 flex flex-wrap items-center justify-between gap-4 text-sm text-muted-foreground">
        <p>
          pulse — built on{" "}
          <a href="https://listenbrainz.org" target="_blank" rel="noreferrer" className="hover:text-foreground underline">
            ListenBrainz
          </a>{" "}
          and{" "}
          <a href="https://musicbrainz.org" target="_blank" rel="noreferrer" className="hover:text-foreground underline">
            MusicBrainz
          </a>
          .
        </p>
        <div className="flex gap-5">
          <Link href="/onboarding" className="hover:text-foreground">Get started</Link>
          <Link href="/pricing" className="hover:text-foreground">Pricing</Link>
          <Link href={`/u/${DEMO_USERNAME}/stats`} className="hover:text-foreground">Live demo</Link>
          <Link href="/self-host" className="hover:text-foreground">Self-host</Link>
        </div>
      </div>
    </footer>
  );
}

/* ---------------- helpers ---------------- */

function nf(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US").format(Math.round(n));
}

async function safeAllTime(username: string) {
  try {
    const s = await allTimeStats(username);
    if (!s.total_plays) return null;
    return s;
  } catch {
    return null;
  }
}
