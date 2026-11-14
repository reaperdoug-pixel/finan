import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadEnv, requireEnv } from "../env.js";
import { runMigrations } from "./migrate.js";

loadEnv();
// Falha alto de propósito: estes testes de segurança não podem ser ignorados em silêncio.
const ownerUrl = requireEnv("TEST_MIGRATE_DATABASE_URL");
const appUrl = requireEnv("TEST_DATABASE_URL");

let owner: pg.Pool;
let app: pg.Pool;

/** Executa a consulta e devolve o código SQLSTATE do erro (ou null se deu certo). */
async function codigoDoErro(pool: pg.Pool, text: string, params: unknown[] = []) {
  try {
    await pool.query(text, params);
    return null;
  } catch (e) {
    return (e as { code?: string }).code ?? "desconhecido";
  }
}

const PERMISSAO_NEGADA = "42501";
const RESTRICAO_VIOLADA = "23001"; // restrict_violation, levantado pelo gatilho do log
const UNICIDADE = "23505";
const CHECK = "23514";
const ENUM_INVALIDO = "22P02";

// O banco de teste é recriado uma vez por test/globalSetup.ts.
beforeAll(async () => {
  owner =new pg.Pool({ connectionString: ownerUrl });
  app = new pg.Pool({ connectionString: appUrl });
});

afterAll(async () => {
  await owner.end();
  await app.end();
});

describe("migrações", () => {
  it("são idempotentes (rodar de novo não quebra)", async () => {
    await expect(runMigrations(ownerUrl)).resolves.toBeUndefined();
  });
});

describe("log de auditoria: só de inclusão", () => {
  it("o papel da API consegue inserir e ler", async () => {
    await app.query(`INSERT INTO log (acao, ip) VALUES ('teste.insercao', '127.0.0.1')`);
    const r = await app.query(`SELECT acao FROM log WHERE acao = 'teste.insercao'`);
    expect(r.rowCount).toBe(1);
  });

  it("o papel da API NÃO consegue alterar", async () => {
    expect(await codigoDoErro(app, `UPDATE log SET acao = 'x'`)).toBe(PERMISSAO_NEGADA);
  });

  it("o papel da API NÃO consegue apagar", async () => {
    expect(await codigoDoErro(app, `DELETE FROM log`)).toBe(PERMISSAO_NEGADA);
  });

  it("o papel da API NÃO consegue esvaziar a tabela", async () => {
    expect(await codigoDoErro(app, `TRUNCATE log`)).toBe(PERMISSAO_NEGADA);
  });

  it("nem o dono altera ou apaga linhas (gatilho no banco)", async () => {
    expect(await codigoDoErro(owner, `UPDATE log SET acao = 'x'`)).toBe(RESTRICAO_VIOLADA);
    expect(await codigoDoErro(owner, `DELETE FROM log`)).toBe(RESTRICAO_VIOLADA);
    expect(await codigoDoErro(owner, `TRUNCATE log`)).toBe(RESTRICAO_VIOLADA);
  });

  it("as linhas continuam intactas depois das tentativas", async () => {
    const r = await app.query(`SELECT count(*)::int AS n FROM log WHERE acao = 'teste.insercao'`);
    expect(r.rows[0].n).toBe(1);
  });
});

describe("nada se apaga", () => {
  it("o papel da API não tem DELETE em nenhuma tabela de negócio", async () => {
    expect(await codigoDoErro(app, `DELETE FROM usuario`)).toBe(PERMISSAO_NEGADA);
    expect(await codigoDoErro(app, `DELETE FROM titular`)).toBe(PERMISSAO_NEGADA);
  });
});

describe("titular e usuário", () => {
  async function novoTitular(nome: string): Promise<string> {
    const r = await app.query(`INSERT INTO titular (nome) VALUES ($1) RETURNING id`, [nome]);
    return r.rows[0].id as string;
  }

  it("e-mail é único sem diferenciar maiúsculas", async () => {
    const t = await novoTitular("T1");
    const ins = `INSERT INTO usuario (titular_id, email, senha_hash, papel) VALUES ($1, $2, 'h', 'titular')`;
    await app.query(ins, [t, "Ana@Exemplo.com"]);
    expect(await codigoDoErro(app, ins, [t, "ana@exemplo.com"])).toBe(UNICIDADE);
  });

  it("papel inválido é recusado", async () => {
    const t = await novoTitular("T2");
    const code = await codigoDoErro(
      app,
      `INSERT INTO usuario (titular_id, email, senha_hash, papel) VALUES ($1, 'b@x.com', 'h', 'root')`,
      [t],
    );
    expect(code).toBe(ENUM_INVALIDO);
  });

  it("ativo e inativado_em não podem se contradizer", async () => {
    const code = await codigoDoErro(app, `INSERT INTO titular (nome, ativo) VALUES ('T3', false)`);
    expect(code).toBe(CHECK);
    const ok = await codigoDoErro(
      app,
      `INSERT INTO titular (nome, ativo, inativado_em) VALUES ('T4', false, now())`,
    );
    expect(ok).toBeNull();
  });

  it("usuário exige titular existente", async () => {
    const code = await codigoDoErro(
      app,
      `INSERT INTO usuario (titular_id, email, senha_hash, papel)
       VALUES (gen_random_uuid(), 'c@x.com', 'h', 'titular')`,
    );
    expect(code).toBe("23503");
  });
});
