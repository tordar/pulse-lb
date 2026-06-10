"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, ChevronDown, ExternalLink, Sparkles, Terminal } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { CopyButton } from "@/components/CopyButton";
import { SubscribeButton } from "@/components/SubscribeButton";

const REPO = "https://github.com/tordar/pulse-lb";
const AGENT_PROMPT = `Set up pulse-lb end-to-end on my machine and walk me through getting my listening history in. Do each step; for the steps only I can do, give me the exact link and wait for me.

PART A — Run the app locally (Docker):
1. git clone ${REPO} && cd pulse-lb
2. cp .env.example .env
3. Help me register a MusicBrainz OAuth application at https://musicbrainz.org/account/applications — set the callback URL to http://localhost:3000/auth/callback — then put the client ID + secret into .env as METABRAINZ_CLIENT_ID and METABRAINZ_CLIENT_SECRET.
4. Generate a JWT_SECRET with: openssl rand -base64 48 — add it to .env. Keep SELF_HOST=true and leave the STRIPE_* vars blank.
5. Run: docker compose up --build  (this applies the database migrations on boot, then serves http://localhost:3000)

PART B — Get my listening history into ListenBrainz (pulse reads from ListenBrainz, so my data has to live there first):
6. If I don't have one, help me create a ListenBrainz account at https://listenbrainz.org/login/ (it uses a MusicBrainz login).
7. Request my full Spotify history: open https://www.spotify.com/account/privacy/ and request "Extended Streaming History". Spotify takes 5–30 days to email the ZIP — remind me this is the slow part and that I'll resume once it arrives. For ongoing plays, also connect Spotify at https://listenbrainz.org/settings/music-services/details/ so new listens scrobble automatically.
8. When the ZIP arrives, unzip it and import the JSON files at https://listenbrainz.org/settings/import/. ListenBrainz enriches each listen with MusicBrainz IDs and cover art — that's what pulse displays.

PART C — Use pulse:
9. Open http://localhost:3000, sign in with my ListenBrainz / MusicBrainz account, and click "Sync now" to mirror my listens into pulse (first sync takes a few minutes on a large library).
10. Confirm the dashboard renders my stats, and tell me how to re-sync later to pull in new listens.

Pause and ask me whenever you need input (OAuth credentials, the Spotify ZIP, etc.).`;

const HOSTED = [
  "We run it — nothing to set up",
  "Sync your ListenBrainz data",
  "Your dashboard + public URL",
  "7-day free trial · cancel any time",
];
const SELF_HOST = [
  "Run it yourself with Docker",
  "Bring your own Postgres",
  "AGPL-3.0 · no subscription",
  "No limits",
];

export function PricingCards({ live, signedIn }: { live: boolean; signedIn: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <section id="pricing" className="w-full max-w-6xl mx-auto px-6 py-20">
      <div className="space-y-2 mb-10 text-center max-w-2xl mx-auto">
        <p className="text-xs uppercase tracking-widest text-primary font-medium">Add your own listens</p>
        <h2 className="text-3xl md:text-4xl font-bold tracking-tight">
          Let us host it, or host it yourself
        </h2>
        <p className="text-muted-foreground">
          Browsing public profiles is always free. To sync your own data, pick a lane.
        </p>
      </div>
      <div className="grid md:grid-cols-2 gap-4 max-w-3xl mx-auto items-start">
        {/* Hosted (paid) */}
        <div className="relative rounded-lg border border-primary bg-primary/[0.03] p-6 space-y-4">
          <span className="absolute -top-3 left-6 text-[10px] uppercase tracking-widest font-bold px-2 py-1 rounded-full bg-primary text-primary-foreground">
            Hosted for you
          </span>
          <div className="space-y-1">
            <h3 className="text-lg font-semibold">Hosted</h3>
            <p className="text-3xl font-bold font-mono">
              $10<span className="text-base font-normal text-muted-foreground"> /year</span>
            </p>
          </div>
          <ul className="space-y-2 text-sm">
            {HOSTED.map((f) => (
              <li key={f} className="flex items-start gap-2">
                <Check size={16} className="text-primary mt-0.5 shrink-0" />
                <span>{f}</span>
              </li>
            ))}
          </ul>
          {!live ? (
            <Button className="w-full" disabled>
              Coming soon
            </Button>
          ) : signedIn ? (
            <SubscribeButton />
          ) : (
            <Link href="/auth/login?return=/">
              <Button className="w-full">Sign in to subscribe</Button>
            </Link>
          )}
        </div>
        {/* Self-host (free, open source) */}
        <div className="rounded-lg border border-card-border bg-card p-6 space-y-4">
          <div className="space-y-1">
            <p className="text-[10px] uppercase tracking-widest font-bold text-primary">Open source</p>
            <h3 className="text-lg font-semibold">Self-host</h3>
            <p className="text-3xl font-bold font-mono">
              $0<span className="text-base font-normal text-muted-foreground"> forever</span>
            </p>
          </div>
          <ul className="space-y-2 text-sm">
            {SELF_HOST.map((f) => (
              <li key={f} className="flex items-start gap-2">
                <Check size={16} className="text-primary mt-0.5 shrink-0" />
                <span>{f}</span>
              </li>
            ))}
          </ul>
          <Button
            variant="outline"
            className="w-full"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-controls="self-host-setup"
          >
            {open ? "Hide setup" : "See setup"}
            <ChevronDown size={16} className={`transition-transform ${open ? "rotate-180" : ""}`} />
          </Button>
        </div>
      </div>

      {open && (
        <div
          id="self-host-setup"
          className="grid md:grid-cols-2 gap-4 max-w-3xl mx-auto items-start mt-4"
        >
          {/* manual */}
          <Card padding="lg" className="space-y-4">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Terminal size={16} className="text-primary" /> Manual setup
            </div>
            <pre className="rounded-md border border-card-border bg-black/30 p-4 text-xs sm:text-sm font-mono leading-relaxed text-foreground/90 whitespace-pre-wrap break-words">
              <code>{`git clone ${REPO}
cp .env.example .env
docker compose up --build`}</code>
            </pre>
            <div className="flex flex-wrap gap-3">
              <a href={`${REPO}#self-hosting`} target="_blank" rel="noreferrer">
                <Button>
                  Self-host guide <ArrowRight size={16} />
                </Button>
              </a>
              <a href={REPO} target="_blank" rel="noreferrer">
                <Button variant="outline">
                  GitHub <ExternalLink size={16} />
                </Button>
              </a>
            </div>
          </Card>
          {/* AI agent */}
          <Card padding="lg" className="space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Sparkles size={16} className="text-primary" /> Set it up with AI
              </div>
              <CopyButton text={AGENT_PROMPT} label="Copy prompt" />
            </div>
            <p className="text-sm text-muted-foreground">
              Paste this into Claude (or any coding agent) and it&apos;ll clone, configure, and run
              it for you.
            </p>
            <pre className="rounded-md border border-card-border bg-black/30 p-4 text-xs font-mono leading-relaxed text-foreground/80 whitespace-pre-wrap break-words max-h-72 overflow-y-auto">
              <code>{AGENT_PROMPT}</code>
            </pre>
          </Card>
        </div>
      )}

      <p className="text-xs text-muted-foreground text-center mt-6">
        Subscription cancellation keeps your data for 30 days, then deletes it. GDPR deletion on request.
      </p>
    </section>
  );
}
