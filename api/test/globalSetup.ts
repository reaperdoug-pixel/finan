import { resetDatabase, runMigrations } from "../src/db/migrate.js";
import { loadEnv, requireEnv } from "../src/env.js";

/** Recria o banco de teste do zero e aplica as migrações. Recusa qualquer banco que não seja *_test. */
export default async function setup(): Promise<void> {
  loadEnv();
  const url = requireEnv("TEST_MIGRATE_DATABASE_URL");
  await resetDatabase(url);
  await runMigrations(url);
}
