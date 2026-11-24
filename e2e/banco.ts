/** Acesso ao banco de teste do e2e. Nunca aponta para finan_dev. */
import { fileURLToPath } from "node:url";
import pg from "pg";

const PORTA_API = 3001;
const PORTA_WEB = 5174;

export const origemE2e = `http://127.0.0.1:${PORTA_WEB}`;
export const urlSaudeApi = `http://127.0.0.1:${PORTA_API}/health`;
export const portaApiE2e = PORTA_API;
export const portaWebE2e = PORTA_WEB;

function nomeDoBanco(url: string): string {
  return new URL(url).pathname.replace(/^\//, "").replace(/\/+$/, "");
}

/** Recusa qualquer banco que não termine em _test, sem expor a URL (tem senha). */
export function exigirBancoDeTeste(url: string, variavel: string): void {
  let nome: string;
  try {
    nome = nomeDoBanco(url);
  } catch {
    throw new Error(`${variavel} não é uma URL válida`);
  }
  if (nome.endsWith("_dev")) {
    throw new Error(`${variavel} aponta para um banco de desenvolvimento; o e2e só usa *_test`);
  }
  if (!nome.endsWith("_test")) {
    throw new Error(`${variavel} deve apontar para um banco cujo nome termina em _test`);
  }
}

export function carregarEnvE2e(): { databaseUrl: string; migrateUrl: string } {
  try {
    process.loadEnvFile(fileURLToPath(new URL("../.env", import.meta.url)));
  } catch {
    /* variáveis já no ambiente */
  }
  const databaseUrl = process.env.TEST_DATABASE_URL;
  const migrateUrl = process.env.TEST_MIGRATE_DATABASE_URL;
  if (!databaseUrl) throw new Error("E2E precisa de TEST_DATABASE_URL no ambiente ou no .env");
  if (!migrateUrl) throw new Error("E2E precisa de TEST_MIGRATE_DATABASE_URL no ambiente ou no .env");
  exigirBancoDeTeste(databaseUrl, "TEST_DATABASE_URL");
  exigirBancoDeTeste(migrateUrl, "TEST_MIGRATE_DATABASE_URL");
  return { databaseUrl, migrateUrl };
}

export async function comDonoTeste<T>(fn: (db: pg.Client) => Promise<T>): Promise<T> {
  const { migrateUrl } = carregarEnvE2e();
  const db = new pg.Client({ connectionString: migrateUrl });
  await db.connect();
  try {
    return await fn(db);
  } finally {
    await db.end();
  }
}

/** Revoga as sessões ativas do e-mail. Devolve quantas linhas foram afetadas. */
export async function revogarSessoesDoEmail(email: string): Promise<number> {
  return comDonoTeste(async (db) => {
    const r = await db.query(
      `UPDATE sessao SET revogada_em = now()
       WHERE revogada_em IS NULL
         AND usuario_id IN (SELECT id FROM usuario WHERE lower(email) = lower($1))`,
      [email],
    );
    return r.rowCount ?? 0;
  });
}
