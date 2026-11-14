import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { createDb, createPool } from "../db/client.js";
import { loadEnv, requireEnv } from "../env.js";
import { ARVORE_PADRAO } from "../categorias/padrao.js";
import { ErroAdmin, TRAVA_PRIMEIRO_ADMIN, criarPrimeiroAdmin } from "./primeiro-admin.js";

loadEnv();

const SENHA = "senha-do-admin-123";
let appPool: pg.Pool;
let owner: pg.Pool;

const novoEmail = () => `admin-${randomUUID()}@teste.com`;

beforeAll(() => {
  appPool = createPool(requireEnv("TEST_DATABASE_URL"));
  owner = new pg.Pool({ connectionString: requireEnv("TEST_MIGRATE_DATABASE_URL") });
});

afterAll(async () => {
  await appPool.end();
  await owner.end();
});

// Estes testes precisam partir de um banco sem admin. Só o dono do banco de teste consegue limpar.
beforeEach(async () => {
  await owner.query(
    `DELETE FROM sessao WHERE usuario_id IN (SELECT id FROM usuario WHERE papel = 'admin')`,
  );
  await owner.query(`DELETE FROM usuario WHERE papel = 'admin'`);
});

async function contarAdmins(): Promise<number> {
  const r = await owner.query(`SELECT count(*)::int AS n FROM usuario WHERE papel = 'admin'`);
  return r.rows[0].n as number;
}

describe("criarPrimeiroAdmin", () => {
  it("cria titular e admin, com a senha guardada só como hash argon2id", async () => {
    const email = novoEmail();
    const r = await criarPrimeiroAdmin(createDb(appPool), {
      email: email.toUpperCase(),
      nomeTitular: "  Minha Casa  ",
      senha: SENHA,
    });
    expect(r.email).toBe(email); // normalizado em minúsculas

    const u = await owner.query(
      `SELECT u.papel, u.ativo, u.senha_hash, t.nome FROM usuario u JOIN titular t ON t.id = u.titular_id WHERE u.id = $1`,
      [r.usuarioId],
    );
    expect(u.rows[0].papel).toBe("admin");
    expect(u.rows[0].ativo).toBe(true);
    expect(u.rows[0].nome).toBe("Minha Casa");
    expect(u.rows[0].senha_hash.startsWith("$argon2id$")).toBe(true);
    expect(u.rows[0].senha_hash).not.toContain(SENHA);
  });

  it("o admin criado consegue entrar pelo login", async () => {
    const email = novoEmail();
    await criarPrimeiroAdmin(createDb(appPool), { email, nomeTitular: "Casa", senha: SENHA });
    const app = buildApp({
      db: createDb(appPool),
      segredoSessao: "segredo-de-teste-com-mais-de-trinta-e-dois-caracteres",
      origemApp: "http://localhost:5173",
      producao: false,
    });
    const res = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email, senha: SENHA },
      remoteAddress: "10.99.0.1",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().usuario.papel).toBe("admin");
    await app.close();
  });

  it("registra no log, sem a senha nem o hash", async () => {
    const r = await criarPrimeiroAdmin(createDb(appPool), {
      email: novoEmail(),
      nomeTitular: "Casa",
      senha: SENHA,
    });
    const l = await owner.query(`SELECT * FROM log WHERE usuario_id = $1`, [r.usuarioId]);
    expect(l.rows.map((x) => x.acao)).toContain("admin.criado");
    const texto = JSON.stringify(l.rows);
    expect(texto).not.toContain(SENHA);
    expect(texto).not.toContain("argon2");
  });

  it("o titular do admin nasce com a árvore padrão de categorias, registrada no log", async () => {
    const r = await criarPrimeiroAdmin(createDb(appPool), {
      email: novoEmail(),
      nomeTitular: "Casa",
      senha: SENHA,
    });
    const esperado =
      ARVORE_PADRAO.length + ARVORE_PADRAO.reduce((s, x) => s + (x.filhas?.length ?? 0), 0);
    const cats = await owner.query(`SELECT 1 FROM categoria WHERE titular_id = $1`, [r.titularId]);
    expect(cats.rowCount).toBe(esperado);
    const l = await owner.query(
      `SELECT ip, usuario_id FROM log WHERE acao = 'categoria.padraocriada' AND titular_id = $1`,
      [r.titularId],
    );
    expect(l.rows).toEqual([{ ip: "cli", usuario_id: r.usuarioId }]);
  });

  it("recusa um segundo administrador, mesmo com outro e-mail", async () => {
    const db = createDb(appPool);
    await criarPrimeiroAdmin(db, { email: novoEmail(), nomeTitular: "Casa", senha: SENHA });
    await expect(
      criarPrimeiroAdmin(db, { email: novoEmail(), nomeTitular: "Outra", senha: SENHA }),
    ).rejects.toThrow(ErroAdmin);
    expect(await contarAdmins()).toBe(1);
  });

  it("duas execuções simultâneas criam um único admin", async () => {
    const db = createDb(appPool);
    const resultados = await Promise.allSettled([
      criarPrimeiroAdmin(db, { email: novoEmail(), nomeTitular: "A", senha: SENHA }),
      criarPrimeiroAdmin(db, { email: novoEmail(), nomeTitular: "B", senha: SENHA }),
    ]);
    expect(resultados.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(resultados.filter((r) => r.status === "rejected")).toHaveLength(1);
    expect(await contarAdmins()).toBe(1);
  });

  it("espera enquanto outra execução segura a trava (exclusão mútua garantida)", async () => {
    // Uma conexão separada segura a mesma trava. Se o código não usar a trava,
    // a criação termina na hora e este teste falha, sem depender de sorte de timing.
    const outra = await owner.connect();
    try {
      await outra.query(`SELECT pg_advisory_lock($1)`, [TRAVA_PRIMEIRO_ADMIN]);
      let terminou = false;
      const execucao = criarPrimeiroAdmin(createDb(appPool), {
        email: novoEmail(),
        nomeTitular: "Casa",
        senha: SENHA,
      }).then(() => {
        terminou = true;
      });

      await new Promise((resolve) => setTimeout(resolve, 700));
      expect(terminou).toBe(false);
      expect(await contarAdmins()).toBe(0);

      await outra.query(`SELECT pg_advisory_unlock($1)`, [TRAVA_PRIMEIRO_ADMIN]);
      await execucao;
      expect(terminou).toBe(true);
      expect(await contarAdmins()).toBe(1);
    } finally {
      outra.release();
    }
  });

  it("recusa e-mail inválido, nome vazio e senha curta, sem criar nada", async () => {
    const db = createDb(appPool);
    await expect(
      criarPrimeiroAdmin(db, { email: "isto-nao-e-email", nomeTitular: "Casa", senha: SENHA }),
    ).rejects.toThrow(ErroAdmin);
    await expect(
      criarPrimeiroAdmin(db, { email: novoEmail(), nomeTitular: "   ", senha: SENHA }),
    ).rejects.toThrow(ErroAdmin);
    await expect(
      criarPrimeiroAdmin(db, { email: novoEmail(), nomeTitular: "Casa", senha: "curta" }),
    ).rejects.toThrow(ErroAdmin);
    expect(await contarAdmins()).toBe(0);
  });

  it("e-mail já cadastrado: recusa e desfaz tudo (nenhum titular órfão)", async () => {
    const email = novoEmail();
    const nome = `Titular-${randomUUID()}`;
    const [t] = (
      await owner.query(`INSERT INTO titular (nome) VALUES ('Existente') RETURNING id`)
    ).rows;
    await owner.query(
      `INSERT INTO usuario (titular_id, email, senha_hash, papel) VALUES ($1, $2, 'h', 'titular')`,
      [t.id, email],
    );
    await expect(
      criarPrimeiroAdmin(createDb(appPool), { email, nomeTitular: nome, senha: SENHA }),
    ).rejects.toThrow(/já está cadastrado/);
    const orfaos = await owner.query(`SELECT 1 FROM titular WHERE nome = $1`, [nome]);
    expect(orfaos.rowCount).toBe(0);
    expect(await contarAdmins()).toBe(0);
  });
});

describe("nenhuma credencial embutida", () => {
  it("as migrações não inserem dados (nada de seed com usuário ou senha)", () => {
    const pasta = fileURLToPath(new URL("../../drizzle", import.meta.url));
    const arquivos = readdirSync(pasta).filter((f) => f.endsWith(".sql"));
    expect(arquivos.length).toBeGreaterThan(0);
    for (const f of arquivos) {
      expect(readFileSync(`${pasta}/${f}`, "utf8"), f).not.toMatch(/insert\s+into/i);
    }
  });
});
