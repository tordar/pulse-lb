import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen flex items-center justify-center p-6 bg-gradient-to-br from-zinc-50 to-zinc-100 dark:from-zinc-950 dark:to-black">
      <div className="w-full max-w-xl space-y-10">
        <div className="space-y-3">
          <h1 className="text-5xl font-bold tracking-tight">pulse</h1>
          <p className="text-lg text-gray-600 dark:text-gray-400">
            Your listening history, visualized. Powered by{" "}
            <a href="https://listenbrainz.org" className="underline" target="_blank" rel="noreferrer">
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
              className="flex-1 border border-gray-300 dark:border-gray-700 bg-white dark:bg-zinc-900 rounded-md px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-black dark:focus:ring-white"
            />
            <button
              type="submit"
              className="px-6 py-3 bg-black text-white dark:bg-white dark:text-black rounded-md font-medium hover:opacity-90 transition-opacity"
            >
              View
            </button>
          </div>
        </form>

        <div className="space-y-2 text-sm">
          <p className="text-gray-600 dark:text-gray-400">
            First time? You&apos;ll need a ListenBrainz account with your listening history imported.
          </p>
          <Link href="/onboarding" className="inline-block font-medium underline underline-offset-4">
            Show me how to set it up →
          </Link>
        </div>

        <div className="pt-8 border-t border-gray-200 dark:border-gray-800 space-y-1 text-sm text-gray-500">
          <p>
            Curious what it looks like?{" "}
            <Link href="/u/tordar/stats" className="underline">
              See tordar&apos;s profile
            </Link>
            .
          </p>
        </div>
      </div>
    </main>
  );
}
