import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { SignInButton } from "@/components/SignInButton";
import { getSession } from "@/lib/auth/session";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; reason?: string; username?: string }>;
}) {
  const sp = await searchParams;
  const session = await getSession();
  const upstreamErr = sp.error === "upstream";
  const authErr = sp.error === "auth";

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
                Try again in a minute. Live status at{" "}
                <a href="https://status.metabrainz.org/" target="_blank" rel="noreferrer" className="underline">
                  status.metabrainz.org
                </a>.
              </p>
            </div>
          </div>
        )}

        {authErr && (
          <div className="p-4 rounded-md border border-amber-900/60 bg-amber-950/30 text-amber-100 text-sm">
            Sign-in failed{sp.reason ? ` (${sp.reason})` : ""}. Please try again.
          </div>
        )}

        {session ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Signed in as <strong className="text-foreground">@{session.lbUsername}</strong>.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link href={`/u/${encodeURIComponent(session.lbUsername)}/stats`}>
                <Button size="lg">Your dashboard</Button>
              </Link>
              <Link href="/account">
                <Button size="lg" variant="outline">Account</Button>
              </Link>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <SignInButton />
            <p className="text-sm text-muted-foreground">
              No ListenBrainz account?{" "}
              <Link href="/onboarding" className="text-primary hover:underline">
                See how to set up
              </Link>{" "}
              — takes ~30 seconds once you have your Spotify export.
            </p>
          </div>
        )}

        <form action="/u" className="space-y-3 pt-6 border-t border-border">
          <label className="block text-sm font-medium" htmlFor="username">
            Browse any public profile
          </label>
          <div className="flex gap-2">
            <input
              id="username"
              name="username"
              required
              defaultValue={sp.username ?? ""}
              placeholder="e.g. tordar"
              className="flex-1 border border-border bg-card rounded-md px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <Button type="submit" size="lg" variant="outline">View</Button>
          </div>
        </form>
      </div>
    </main>
  );
}
