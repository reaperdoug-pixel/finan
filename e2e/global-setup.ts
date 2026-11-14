import { hash } from "@node-rs/argon2";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { E2E_EMAIL, E2E_SENHA } from "./credenciais";

export default async function globalSetup(): Promise<void> {
  try {
    process.loadEnvFile(fileURLToPath(new URL("../.env", import.meta.url)));
  } catch {
    /* variáveis já no ambiente */
  }
  const url = process.env.MIGRATE_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error("E2E precisa de MIGRATE_DATABASE_URL ou DATABASE_URL");

  const senhaHash = await hash(E2E_SENHA);
  const db = new pg.Client({ connectionString: url });
  await db.connect();
  try {
    const esquema = await db.query<{ t: string | null }>(
      `SELECT to_regclass('public.categoria') AS t`,
    );
    if (!esquema.rows[0]?.t) {
      throw new Error("Banco de desenvolvimento sem migrações. Rode: npm run db:migrate -w api");
    }
    const existente = await db.query<{ id: string; titular_id: string }>(
      `SELECT id, titular_id FROM usuario WHERE lower(email) = lower($1)`,
      [E2E_EMAIL],
    );
    if (existente.rows[0]) {
      const u = existente.rows[0];
      await db.query(
        `UPDATE usuario SET senha_hash = $1, ativo = true, inativado_em = NULL, inativado_por = NULL
         WHERE id = $2`,
        [senhaHash, u.id],
      );
      await db.query(
        `UPDATE titular SET ativo = true, inativado_em = NULL, inativado_por = NULL WHERE id = $1`,
        [u.titular_id],
      );
    } else {
      const t = await db.query<{ id: string }>(
        `INSERT INTO titular (nome) VALUES ('E2E Playwright') RETURNING id`,
      );
      await db.query(
        `INSERT INTO usuario (titular_id, email, senha_hash, papel)
         VALUES ($1, $2, $3, 'titular')`,
        [t.rows[0]!.id, E2E_EMAIL, senhaHash],
      );
    }
  } finally {
    await db.end();
  }
}
