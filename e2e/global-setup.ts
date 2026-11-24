import { hash } from "@node-rs/argon2";
import { E2E_EMAIL, E2E_EMAIL_BLOQUEIO, E2E_SENHA } from "./credenciais";
import { carregarEnvE2e, comDonoTeste } from "./banco";

async function garantirUsuario(
  db: import("pg").Client,
  email: string,
  senhaHash: string,
  nomeTitular: string,
): Promise<void> {
  const existente = await db.query<{ id: string; titular_id: string }>(
    `SELECT id, titular_id FROM usuario WHERE lower(email) = lower($1)`,
    [email],
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
    return;
  }
  const t = await db.query<{ id: string }>(
    `INSERT INTO titular (nome) VALUES ($1) RETURNING id`,
    [nomeTitular],
  );
  await db.query(
    `INSERT INTO usuario (titular_id, email, senha_hash, papel)
     VALUES ($1, $2, $3, 'titular')`,
    [t.rows[0]!.id, email, senhaHash],
  );
}

export default async function globalSetup(): Promise<void> {
  carregarEnvE2e();
  const senhaHash = await hash(E2E_SENHA);
  await comDonoTeste(async (db) => {
    const esquema = await db.query<{ t: string | null }>(
      `SELECT to_regclass('public.categoria') AS t`,
    );
    if (!esquema.rows[0]?.t) {
      throw new Error("Banco de teste sem migrações. Rode: npm run db:migrate:test -w api");
    }
    await garantirUsuario(db, E2E_EMAIL, senhaHash, "E2E Playwright");
    await garantirUsuario(db, E2E_EMAIL_BLOQUEIO, senhaHash, "E2E Playwright bloqueio");
    // Limpa tentativas recentes para o limite por IP/e-mail não vazar de uma suíte para a outra.
    await db.query(`DELETE FROM tentativa_login`);
  });
}
