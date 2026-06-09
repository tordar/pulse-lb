import Link from "next/link";

export const metadata = {
  title: "Self-host pulse-lb",
  description:
    "Run your own pulse-lb instance with Docker — your data, your server, no subscription.",
};

const REPO_URL = "https://github.com/tordar/pulse-lb";

export default function SelfHostPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16 space-y-8">
      <div className="space-y-3">
        <p className="text-xs uppercase tracking-widest text-primary font-medium">Open source</p>
        <h1 className="text-4xl font-bold tracking-tight">Self-host pulse-lb</h1>
        <p className="text-muted-foreground leading-relaxed">
          Prefer to run it yourself? pulse-lb is open source (AGPL-3.0) and
          self-hostable with Docker. You bring your own Postgres and a MusicBrainz
          OAuth app — there is no subscription when you self-host.
        </p>
      </div>

      <div className="rounded-lg border border-card-border bg-card p-5 space-y-2">
        <p className="text-xs uppercase tracking-widest text-primary font-medium">Quick start</p>
        <pre className="text-sm text-foreground/90 overflow-x-auto whitespace-pre font-mono leading-relaxed">
          <code>{`git clone ${REPO_URL}
cd pulse-lb
cp .env.example .env   # fill in MusicBrainz OAuth + JWT_SECRET
docker compose up --build`}</code>
        </pre>
      </div>

      <p className="text-foreground/80 leading-relaxed">
        Full instructions are in the{" "}
        <a
          href={`${REPO_URL}#self-hosting`}
          target="_blank"
          rel="noreferrer"
          className="text-primary hover:underline"
        >
          project README
        </a>
        . Or skip the setup and{" "}
        <Link href="/" className="text-primary hover:underline">
          use the hosted version
        </Link>
        .
      </p>
    </main>
  );
}
