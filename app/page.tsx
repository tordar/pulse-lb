import Link from "next/link";

export default function Home() {
  return (
    <main className="p-8 max-w-2xl mx-auto space-y-6">
      <h1 className="text-4xl font-bold">pulse-lb</h1>
      <p className="text-gray-600">
        A ListenBrainz-backed visualizer. Type a public LB username to view their listening data.
      </p>
      <form action="/u" className="flex gap-2">
        <input
          name="username"
          placeholder="listenbrainz username"
          className="flex-1 border border-gray-300 rounded px-3 py-2"
        />
        <button className="px-4 py-2 bg-black text-white rounded">View</button>
      </form>
      <p className="text-sm text-gray-500">
        Try <Link className="underline" href="/u/tordar">tordar</Link>.
      </p>
    </main>
  );
}
