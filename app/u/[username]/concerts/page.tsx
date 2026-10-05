import { Ticket } from "lucide-react";
import { concertsTimeline } from "@/lib/db/queries/concerts";
import { buildTimeline } from "@/lib/concerts/timeline";
import { getSession } from "@/lib/auth/session";
import { Timeline } from "./Timeline";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ConcertsPage({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  const [{ concerts, festivals }, session] = await Promise.all([concertsTimeline(username), getSession()]);
  const isOwner = session?.lbUsername === username;
  const years = buildTimeline(concerts, festivals);

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold inline-flex items-center gap-2">
        <Ticket size={18} className="text-primary" /> Concerts
        <span className="text-sm font-normal text-muted-foreground">({concerts.length})</span>
      </h2>
      {years.length === 0 && !isOwner ? (
        <div className="py-16 flex flex-col items-center text-sm text-muted-foreground gap-3">
          <Ticket size={32} className="text-subtle-foreground" />
          No concerts yet.
        </div>
      ) : (
        <Timeline username={username} years={years} festivals={festivals} isOwner={isOwner} />
      )}
    </div>
  );
}
