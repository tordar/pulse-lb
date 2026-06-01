import Link from "next/link";
import { Button } from "@/components/ui/Button";

export default function Home() {
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
