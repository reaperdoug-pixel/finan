import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { loadEnv, requireEnv } from "../env.js";
import { createDb, createPool } from "./client.js";
import { applyGrants } from "./grants.js";

const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));

/** Aplica as migrações pendentes e reaplica as permissões. Usa o papel dono. */
export async function runMigrations(ownerUrl: string): Promise<void> {
  const pool = createPool(ownerUrl);
  try {
    await migrate(createDb(pool), { migrationsFolder });
    await applyGrants(pool);
  } finally {
    await pool.end();
  }
}

/**
 * Apaga todo o conteúdo e recria o esquema. Só para bancos de desenvolvimento
 * e teste: recusa qualquer outro nome de banco e qualquer ambiente de produção.
 */
export async function resetDatabase(ownerUrl: string): Promise<void> {
  const dbName = new URL(ownerUrl).pathname.replace("/", "");
  if (process.env.NODE_ENV === "production" || !/_(dev|test)$/.test(dbName)) {
    throw new Error(`Recusado: reset só é permitido em bancos *_dev ou *_test (banco: ${dbName})`);
  }
  const pool = createPool(ownerUrl);
  try {
    await pool.query("DROP SCHEMA IF EXISTS drizzle CASCADE");
    await pool.query("DROP SCHEMA public CASCADE");
    await pool.query("CREATE SCHEMA public");
    await pool.query("GRANT USAGE ON SCHEMA public TO PUBLIC");
  } finally {
    await pool.end();
  }
}

async function main(): Promise<void> {
  loadEnv();
  const args = process.argv.slice(2);
  const useTest = args.includes("--test");
  const url = requireEnv(useTest ? "TEST_MIGRATE_DATABASE_URL" : "MIGRATE_DATABASE_URL");
  if (args.includes("--reset")) {
    await resetDatabase(url);
    console.log("Banco recriado.");
  }
  await runMigrations(url);
  console.log("Migrações aplicadas.");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
