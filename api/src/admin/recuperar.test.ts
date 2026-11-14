import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, createPool } from "../db/client.js";
import { loadEnv, requireEnv } from "../env.js";
import { buscarRedefinicaoValida, concluirRedefinicao } from "../redefinicao/servico.js";
import { conferirSenha, gerarHash } from "../auth/senha.js";
import { ErroAdmin } from "./primeiro-admin.js";
import { gerarLinkDeRecuperacaoDoAdmin } from "./recuperar.js";

loadEnv();

const SEGREDO = "segredo-de-teste-com-mais-de-trinta-e-dois-caracteres";
const ORIGEM = "http://localhost:5173";
const NOVA = "senha-nova-do-admin-456";

let appPool: pg.Pool;
let owner: pg.Pool;
let hash: string;

beforeAll(async () => {
  appPool = createPool(requireEnv("TEST_DATABASE_URL"));
  owner = new pg.Pool({ connectionString: requireEnv("TEST_MIGRATE_DATABASE_URL") });
  hash = await gerarHash("senha-antiga-do-admin-1");
});
afterAll(async () => {
  await appPool.end();
  await owner.end();
});

async function criar(papel: "admin" | "titular", o: { ativo?: boolean; titularAtivo?: boolean } = {}) {
  const t = await owner.query(
    `INSERT INTO titular (nome, ativo, inativado_em) VALUES ($1, $2, CASE WHEN $2 THEN NULL ELSE now() END) RETURNING id`,
    [`Titular ${randomUUID()}`, o.titularAtivo !== false],
  );
  const email = `rec-${randomUUID()}@teste.com`;
  const u = await owner.query(
    `INSERT INTO usuario (titular_id, email, senha_hash, papel, ativo, inativado_em)
     VALUES ($1, $2, $3, $4, $5, CASE WHEN $5 THEN NULL ELSE now() END) RETURNING id`,
    [t.rows[0].id, email, hash, papel, o.ativo !== false],
  );
  return { id: u.rows[0].id as string, email };
}

const gerar = (email: string) =>
  gerarLinkDeRecuperacaoDoAdmin(createDb(appPool), { email, segredoSessao: SEGREDO, origemApp: ORIGEM });
const tokenDe = (link: string) => link.split("/redefinicao/")[1]!;

describe("recuperação da senha do admin pelo servidor", () => {
  it("gera um link que redefine a senha, encerra as sessões e deixa a antiga inválida", async () => {
    const admin = await criar("admin");
    await owner.query(
      `INSERT INTO sessao (usuario_id, token_hash, csrf_token, ip) VALUES ($1, $2, 'c', '10.0.0.1')`,
      [admin.id, randomUUID()],
    );

    const r = await gerar(admin.email.toUpperCase());
    expect(r.link.startsWith(`${ORIGEM}/redefinicao/`)).toBe(true);
    expect(await buscarRedefinicaoValida(createDb(appPool), SEGREDO, tokenDe(r.link))).toEqual({
      email: admin.email,
    });

    await concluirRedefinicao(createDb(appPool), SEGREDO, tokenDe(r.link), NOVA, "127.0.0.1");

    const u = await owner.query(`SELECT senha_hash FROM usuario WHERE id = $1`, [admin.id]);
    expect(await conferirSenha(u.rows[0].senha_hash, NOVA)).toBe(true);
    expect(await conferirSenha(u.rows[0].senha_hash, "senha-antiga-do-admin-1")).toBe(false);
    const abertas = await owner.query(
      `SELECT 1 FROM sessao WHERE usuario_id = $1 AND revogada_em IS NULL`,
      [admin.id],
    );
    expect(abertas.rowCount).toBe(0);
  });

  it("o link vale uma vez só, e um novo link invalida o anterior", async () => {
    const admin = await criar("admin");
    const primeiro = await gerar(admin.email);
    const segundo = await gerar(admin.email);
    expect(await buscarRedefinicaoValida(createDb(appPool), SEGREDO, tokenDe(primeiro.link))).toBeNull();
    await concluirRedefinicao(createDb(appPool), SEGREDO, tokenDe(segundo.link), NOVA, "127.0.0.1");
    expect(await buscarRedefinicaoValida(createDb(appPool), SEGREDO, tokenDe(segundo.link))).toBeNull();
  });

  it("registra no log que foi feito pelo servidor, sem gravar o link nem o token", async () => {
    const admin = await criar("admin");
    const r = await gerar(admin.email);
    const l = await owner.query(
      `SELECT usuario_id, confirmado_por, depois FROM log WHERE acao = 'redefinicao.criada' AND entidade_id = $1`,
      [admin.id],
    );
    expect(l.rows).toHaveLength(1);
    expect(l.rows[0].confirmado_por).toBe(admin.id);
    expect(l.rows[0].depois.via).toBe("cli");
    expect(JSON.stringify(l.rows[0])).not.toContain(tokenDe(r.link));
  });

  it("recusa quem não é admin, admin inativo, titular inativo e e-mail inexistente", async () => {
    const titular = await criar("titular");
    const inativo = await criar("admin", { ativo: false });
    const titularInativo = await criar("admin", { titularAtivo: false });
    for (const email of [titular.email, inativo.email, titularInativo.email, "ninguem@teste.com"]) {
      await expect(gerar(email)).rejects.toBeInstanceOf(ErroAdmin);
    }
    const criados = await owner.query(
      `SELECT 1 FROM redefinicao_senha WHERE usuario_id = ANY($1)`,
      [[titular.id, inativo.id, titularInativo.id]],
    );
    expect(criados.rowCount).toBe(0);
  });
});
