import { getSession } from "@/lib/auth/session";

export const isOwner = (session: { lbUsername: string } | null, username: string) =>
  session?.lbUsername === username;

export async function requireOwner(username: string): Promise<void> {
  if (!isOwner(await getSession(), username)) throw new Error("Not allowed");
}
