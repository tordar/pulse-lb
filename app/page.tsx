import { Suspense } from "react";
import { AlertTriangle } from "lucide-react";
import { Landing } from "./_landing/Landing";
import { SignInOnly } from "./_landing/SignInOnly";

type SP = Promise<{ error?: string; reason?: string }>;

// Signed-in visitors never see this page: proxy.ts sends them to their own
// dashboard. Everyone else gets the showcase landscape and a way to sign in.
export default function Home({ searchParams }: { searchParams: SP }) {
  return (
    <>
      <Suspense fallback={null}>
        <ErrorBanners searchParams={searchParams} />
      </Suspense>
      <Suspense fallback={<SignInOnly />}>
        <Landing />
      </Suspense>
    </>
  );
}

async function ErrorBanners({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const upstreamErr = sp.error === "upstream";
  const authErr = sp.error === "auth";
  if (!upstreamErr && !authErr) return null;
  return (
  <div className="fixed top-4 inset-x-4 z-20 mx-auto max-w-md">
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
  );
}
