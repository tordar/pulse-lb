"use server";

import { eq } from "drizzle-orm";
import { revalidateTag } from "next/cache";
import { db, schema } from "@/lib/db/client";
import { withRetry } from "@/lib/db/retry";
import { getSession } from "@/lib/auth/session";

export async function setShowListenSource(value: boolean): Promise<void> {
  const session = await getSession();
  if (!session) throw new Error("unauthorized");
  await withRetry(() =>
    db
      .update(schema.users)
      .set({ showListenSource: value })
      .where(eq(schema.users.mbAccountId, session.mbAccountId)),
  );
  // getShowListenSource is cached under this tag; without this the dots keep
  // rendering the old value until the next sync happens to invalidate.
  revalidateTag(`user:${session.lbUsername}`, "default");
}
