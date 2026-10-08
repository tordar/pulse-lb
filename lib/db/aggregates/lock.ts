import type { TransactionSql } from "postgres";

// One lock per user for anything that rewrites that user's agg_* rows. The
// song/artist/album tables have no primary key, so two writers interleaving
// DELETE+INSERT would leave duplicate rows. Transaction-scoped: released on
// COMMIT/ROLLBACK.
export async function lockUser(
  tx: TransactionSql,
  username: string,
): Promise<void> {
  await tx`SELECT pg_advisory_xact_lock(hashtext(${"agg:" + username}))`;
}

export async function tryLockUser(
  tx: TransactionSql,
  username: string,
): Promise<boolean> {
  const [r] =
    await tx`SELECT pg_try_advisory_xact_lock(hashtext(${"agg:" + username})) AS ok`;
  return r.ok === true;
}
