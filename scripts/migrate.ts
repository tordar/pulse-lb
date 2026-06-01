import "dotenv/config";
import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { migrate } from "drizzle-orm/neon-http/migrator";

async function main() {
  const sql = neon(process.env.DATABASE_URL!);
  const db = drizzle(sql);
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("migrated");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
