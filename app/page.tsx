import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/Button";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; username?: string }>;
}) {
  const sp = await searchParams;
  const upstreamErr = sp.error === "upstream";

  return (
    <main className="min-h-screen flex items-center justify-center p-6 bg-background">
      <div className="w-full max-w-xl space-y-10">
        <div className="space-y-3">
          <h1 className="text-5xl font-bold tracking-tight">pulse</h1>
          <p className="text-lg text-muted-foreground">
            Your listening history, visualized. Powered by{" "}
            <a
              href="https://listenbrainz.org"
              className="text-primary hover:underline"
              target="_blank"
              rel="noreferrer"
            >
              ListenBrainz
            </a>
            .
          </p>
        </div>

        {upstreamErr && (
          <div className="flex gap-3 items-start p-4 rounded-md border border-amber-900/60 bg-amber-950/30 text-amber-100 text-sm">
            <AlertTriangle size={16} className="shrink-0 mt-0.5 text-amber-400" />
            <div className="space-y-1">
              <p className="font-medium">ListenBrainz looks unreachable right now.</p>
              <p className="text-amber-100/80">
                Could be a transient hiccup on their side — try again in a minute. You can check{" "}
                <a
                  href="https://status.metabrainz.org/"
                  target="_blank"
                  rel="noreferrer"
                  className="underline"
                >
                  status.metabrainz.org
                </a>{" "}
                for live updates.
              </p>
            </div>
          </div>
        )}

        <form action="/u" className="space-y-3">
          <label className="block text-sm font-medium" htmlFor="username">
            Enter your ListenBrainz username
          </label>
          <div className="flex gap-2">
            <input
              id="username"
              name="username"
              required
              autoFocus
              defaultValue={sp.username ?? ""}
              placeholder="e.g. tordar"
              className="flex-1 border border-border bg-card rounded-md px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <Button type="submit" size="lg">
              View
            </Button>
          </div>
        </form>

        <div className="space-y-2 text-sm">
          <p className="text-muted-foreground">
            First time? You&apos;ll need a ListenBrainz account with your listening history imported.
          </p>
          <Link
            href="/onboarding"
            className="inline-block font-medium text-primary hover:underline underline-offset-4"
          >
            Show me how to set it up →
          </Link>
        </div>

        <div className="pt-8 border-t border-border space-y-1 text-sm text-muted-foreground">
          <p>
            Curious what it looks like?{" "}
            <Link href="/u/tordar/stats" className="text-primary hover:underline">
              See tordar&apos;s profile
            </Link>
            .
          </p>
        </div>
      </div>
    </main>
  );
}
