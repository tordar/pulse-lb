import Link from "next/link";
import { ChevronLeft, ExternalLink } from "lucide-react";

type Step = {
  title: string;
  body: React.ReactNode;
  link?: { href: string; label: string };
};

const STEPS: Step[] = [
  {
    title: "Request your Spotify data",
    body: (
      <>
        Spotify keeps your full listening history but you have to request it explicitly. Go to your
        privacy settings and ask for <strong>Extended Streaming History</strong>. Spotify takes{" "}
        <strong>5–30 days</strong> to prepare the export and emails you a ZIP when it&apos;s ready.
        <br />
        <br />
        <span className="text-muted-foreground text-sm">
          (If you only want your last ~50 plays you can skip this — but most people want the full history,
          and the export is the only way to get it.)
        </span>
      </>
    ),
    link: { href: "https://www.spotify.com/account/privacy/", label: "Spotify privacy settings" },
  },
  {
    title: "Create a ListenBrainz account",
    body: (
      <>
        ListenBrainz is the open-source listening database that powers pulse. It&apos;s free, no credit
        card, takes ~30 seconds. Signup uses a MusicBrainz account — if you have one of those, you&apos;re
        already half done.
      </>
    ),
    link: { href: "https://listenbrainz.org/login/", label: "Sign up for ListenBrainz" },
  },
  {
    title: "Import your Spotify history into ListenBrainz",
    body: (
      <>
        Once Spotify emails you the ZIP, unzip it and upload the JSON files via ListenBrainz&apos;s
        importer. LB then enriches every listen with MusicBrainz IDs and cover art — that&apos;s the
        layer pulse reads from.
        <br />
        <br />
        <span className="text-muted-foreground text-sm">
          LB also has a &quot;connect Spotify&quot; option that scrobbles future plays automatically — worth
          enabling so your data stays current.
        </span>
      </>
    ),
    link: { href: "https://listenbrainz.org/settings/import/", label: "ListenBrainz importer" },
  },
  {
    title: "Sign in with ListenBrainz",
    body: (
      <>
        Sign in to pulse using your ListenBrainz account. We&apos;ll mirror your listens
        from LB into our database and show you the dashboard. First sync takes a few
        minutes for a large library; subsequent visits are instant.
      </>
    ),
    link: { href: "/auth/login", label: "Sign in with ListenBrainz" },
  },
];

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; username?: string }>;
}) {
  const { error, username } = await searchParams;

  const errorBanner =
    error === "notfound" ? (
      <div className="mb-8 p-4 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 text-amber-900 dark:text-amber-100 text-sm">
        We couldn&apos;t find{" "}
        <strong className="font-mono">{username}</strong> on ListenBrainz. If you haven&apos;t created an
        account yet, the steps below will get you set up.
      </div>
    ) : error === "invalid" ? (
      <div className="mb-8 p-4 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 text-amber-900 dark:text-amber-100 text-sm">
        <strong className="font-mono">{username}</strong> doesn&apos;t look like a valid ListenBrainz
        username. Usernames are letters, numbers, dots, dashes, and underscores.
      </div>
    ) : null;

  return (
    <main className="min-h-screen p-6 md:p-10 max-w-3xl mx-auto">
      <div className="mb-10 space-y-3">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft size={14} /> pulse
        </Link>
        <h1 className="text-4xl font-bold tracking-tight">Set up pulse</h1>
        <p className="text-muted-foreground">
          Four steps. The first one (Spotify&apos;s export) is the only slow part — 5–30 days while you
          wait for their email. The rest takes minutes.
        </p>
      </div>

      {errorBanner}

      <ol className="space-y-8">
        {STEPS.map((s, i) => (
          <li key={i} className="flex gap-5">
            <div className="shrink-0 w-9 h-9 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-semibold text-sm">
              {i + 1}
            </div>
            <div className="space-y-2 pt-1">
              <h2 className="text-xl font-semibold">{s.title}</h2>
              <p className="text-foreground/80 leading-relaxed">{s.body}</p>
              {s.link && (
                <a
                  href={s.link.href}
                  target={s.link.href.startsWith("http") ? "_blank" : undefined}
                  rel={s.link.href.startsWith("http") ? "noreferrer" : undefined}
                  className="inline-flex items-center gap-1.5 mt-2 text-sm font-medium text-primary hover:underline underline-offset-4"
                >
                  {s.link.label}
                  {s.link.href.startsWith("http") ? <ExternalLink size={12} /> : <span aria-hidden>→</span>}
                </a>
              )}
            </div>
          </li>
        ))}
      </ol>

      <div className="mt-16 pt-8 border-t border-border text-sm text-muted-foreground space-y-2">
        <p>
          Already have a ListenBrainz account?{" "}
          <Link href="/auth/login" className="underline">
            Sign in
          </Link>
          .
        </p>
        <p>
          Want a preview first?{" "}
          <Link href="/u/tordar/stats" className="underline">
            See tordar&apos;s profile
          </Link>
          .
        </p>
      </div>
    </main>
  );
}
