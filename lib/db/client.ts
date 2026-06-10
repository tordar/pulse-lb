import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// postgres-js speaks the standard Postgres wire protocol, so the SAME client
// connects to a self-hoster's local Postgres and to Neon's POOLED endpoint
// (…-pooler…neon.tech). prepare:false keeps us pooler-safe (Neon pooler /
// PgBouncer transaction mode reject named prepared statements). Keep `max`
// small — on Vercel/Fluid each instance holds its own pool.
const client = postgres(process.env.DATABASE_URL!, {
  max: Number(process.env.DATABASE_POOL_MAX ?? 5),
  prepare: false,
  idle_timeout: 20,
  connect_timeout: 10,
});

export const db = drizzle(client, { schema });
export { schema };
// Raw client for the modules that need parameterized dynamic SQL or real
// transactions (aggregate rebuild, cluster queries). Sharing this one pool
// is deliberate: never construct a second postgres() in app code.
export { client as sqlClient };

// drizzle-orm/postgres-js's db.execute() returns a postgres-js `Result`, which
// IS an array of rows (and has no `.rows`). The neon-http driver we migrated
// from returned `{ rows }`, and the raw-SQL read layer is written against that
// shape. Normalize back to `{ rows }` so every `db.execute().rows` call site
// keeps working under postgres-js.
export async function execute<T = Record<string, unknown>>(
  query: Parameters<typeof db.execute>[0],
): Promise<{ rows: T[] }> {
  const res = await db.execute(query);
  const rows = (Array.isArray(res) ? res : (res as { rows?: unknown[] }).rows ?? []) as T[];
  return { rows };
}
