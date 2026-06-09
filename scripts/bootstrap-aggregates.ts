import "dotenv/config";
import postgres from "postgres";
import { rebuildAll } from "../lib/db/aggregates/rebuild";
import { sqlClient } from "../lib/db/client";

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  const rows = (await sql`
    SELECT DISTINCT user_name FROM listens ORDER BY user_name
  `) as Array<{ user_name: string }>;

  if (rows.length === 0) {
    console.log("No users in listens table. Nothing to bootstrap.");
    await sql.end();
    await sqlClient.end();
    return;
  }

  console.log(`Bootstrapping aggregates for ${rows.length} user(s).`);
  for (const { user_name } of rows) {
    const t0 = Date.now();
    await rebuildAll(user_name);
    await sql`
      INSERT INTO sync_state (user_name, last_aggregated_at)
      VALUES (${user_name}, now())
      ON CONFLICT (user_name) DO UPDATE SET last_aggregated_at = now()
    `;
    console.log(`  ${user_name} — ${Date.now() - t0}ms`);
  }
  await sql.end();
  await sqlClient.end();
  console.log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
