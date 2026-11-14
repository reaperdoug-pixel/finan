import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { gerarHash } from "../auth/senha.js";
import { hashDoToken } from "../auth/sessao.js";
import { createDb, createPool } from "../db/client.js";
import { loadEnv, requireEnv } from "../env.js";

loadEnv();

const SEGREDO = "segredo-de-teste-com-mais-de-trinta-e-dois-caracteres";
const ORIGEM = "http://localhost:5173";
const SENHA = "senha-correta-123";
const SENHA_NOVA = "senha-do-convidado-123";
const COOKIE = "finan_sid";

let appPool: pg.Pool;
let owner: pg.Pool;
let app: FastifyInstance;
let hashDaSenha: string;
let seqIp = 0;
const novoIp = () => `10.30.${Math.floor(++seqIp / 250)}.${(seqIp % 250) + 1}`;
const novoEmail = () => `conv-${randomUUID()}@teste.com`;

interface Sessao {
  cookie: string;
  csrf: string;
  ip: string;
}
type UsuarioLogado = Sessao & { email: string; id: string };
let admin: UsuarioLogado;

beforeAll(async () => {
  appPool = createPool(requireEnv("TEST_DATABASE_URL"));
  owner = new pg.Pool({ connectionString: requireEnv("TEST_MIGRATE_DATABASE_URL") });
  app = buildApp({
    db: createDb(appPool),
    segredoSessao: SEGREDO,
    origemApp: ORIGEM,
    producao: false,
  });
  await app.ready();
  hashDaSenha = await gerarHash(SENHA);
  admin = await criarUsuarioELogar("admin");
});

afterAll(async () => {
  await app.close();
  await appPool.end();
  await owner.end();
});

/** Cria titular + usuário direto no banco (com o papel dado) e faz login de verdade. */
async function criarUsuarioELogar(papel: "admin" | "titular"): Promise<UsuarioLogado> {
  const email = novoEmail();
  const t = await owner.query(`INSERT INTO titular (nome) VALUES ('Base de teste') RETURNING id`);
  const u = await owner.query(
    `INSERT INTO usuario (titular_id, email, senha_hash, papel) VALUES ($1, $2, $3, $4) RETURNING id`,
    [t.rows[0].id, email, hashDaSenha, papel],
  );
  const ip = novoIp();
  const res = await app.inject({
    method: "POST",
    url: "/auth/login",
    payload: { email, senha: SENHA },
    remoteAddress: ip,
  });
  expect(res.statusCode).toBe(200);
  const cookie = res.cookies.find((c) => c.name === COOKIE)!.value;
  return { cookie, csrf: res.json().csrfToken as string, ip, email, id: u.rows[0].id as string };
}

function comoUsuario(
  s: Sessao,
  metodo: "POST" | "GET",
  url: string,
  payload?: unknown,
  semCsrf = false,
) {
  return app.inject({
    method: metodo,
    url,
    payload: payload as object | undefined,
    remoteAddress: s.ip,
    headers: {
      cookie: `${COOKIE}=${s.cookie}`,
      ...(semCsrf ? {} : { "x-csrf-token": s.csrf }),
    },
  });
}

/** Cria um convite como admin e devolve o token extraído do link. */
async function convidar(email = novoEmail(), nomeTitular = `Casa ${randomUUID()}`) {
  const res = await comoUsuario(admin, "POST", "/admin/convites", { email, nomeTitular });
  expect(res.statusCode).toBe(201);
  const corpo = res.json();
  const token = (corpo.link as string).split("/convite/")[1]!;
  return { email, nomeTitular, token, id: corpo.id as string, corpo };
}

function aceitar(token: string, senha: string, headers: Record<string, string> = {}) {
  return app.inject({
    method: "POST",
    url: `/convites/${token}/aceitar`,
    payload: { senha },
    remoteAddress: novoIp(),
    headers,
  });
}

describe("criar convite (admin)", () => {
  it("cria o convite, devolve o link uma vez e guarda só o hash do token", async () => {
    const c = await convidar();
    expect(c.corpo.link).toBe(`${ORIGEM}/convite/${c.token}`);
    const r = await owner.query(`SELECT token_hash FROM convite WHERE id = $1`, [c.id]);
    expect(r.rows[0].token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(r.rows[0].token_hash).not.toBe(c.token);
    expect(r.rows[0].token_hash).toBe(hashDoToken(c.token, SEGREDO));
  });

  it("vale 7 dias", async () => {
    const c = await convidar();
    const r = await owner.query(
      `SELECT extract(epoch FROM expira_em - criado_em) AS seg FROM convite WHERE id = $1`,
      [c.id],
    );
    expect(Math.abs(Number(r.rows[0].seg) - 7 * 24 * 3600)).toBeLessThan(60);
  });

  it("registra no log, com quem criou, e sem o token", async () => {
    const c = await convidar();
    const l = await owner.query(`SELECT * FROM log WHERE entidade = 'convite' AND entidade_id = $1`, [
      c.id,
    ]);
    expect(l.rows.map((x) => x.acao)).toEqual(["convite.criado"]);
    expect(l.rows[0].usuario_id).toBe(admin.id);
    expect(JSON.stringify(l.rows)).not.toContain(c.token);
  });

  it("sem login responde 401", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/admin/convites",
      payload: { email: novoEmail(), nomeTitular: "X" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("usuário que não é admin recebe 403 e nada é criado", async () => {
    const titular = await criarUsuarioELogar("titular");
    const email = novoEmail();
    const res = await comoUsuario(titular, "POST", "/admin/convites", { email, nomeTitular: "X" });
    expect(res.statusCode).toBe(403);
    const r = await owner.query(`SELECT 1 FROM convite WHERE lower(email) = $1`, [email]);
    expect(r.rowCount).toBe(0);
  });

  it("admin sem token CSRF recebe 403", async () => {
    const res = await comoUsuario(
      admin,
      "POST",
      "/admin/convites",
      { email: novoEmail(), nomeTitular: "X" },
      true,
    );
    expect(res.statusCode).toBe(403);
  });

  it("recusa e-mail inválido e nome vazio", async () => {
    const a = await comoUsuario(admin, "POST", "/admin/convites", { email: "x", nomeTitular: "Casa" });
    expect(a.statusCode).toBe(400);
    const b = await comoUsuario(admin, "POST", "/admin/convites", {
      email: novoEmail(),
      nomeTitular: "  ",
    });
    expect(b.statusCode).toBe(400);
  });

  it("recusa e-mail já cadastrado, sem diferenciar maiúsculas", async () => {
    const existente = await criarUsuarioELogar("titular");
    const res = await comoUsuario(admin, "POST", "/admin/convites", {
      email: existente.email.toUpperCase(),
      nomeTitular: "Casa",
    });
    expect(res.statusCode).toBe(409);
  });

  it("recusa segundo convite pendente para o mesmo e-mail, mas aceita depois de expirar", async () => {
    const c = await convidar();
    const dup = await comoUsuario(admin, "POST", "/admin/convites", {
      email: c.email,
      nomeTitular: "Outra",
    });
    expect(dup.statusCode).toBe(409);
    await owner.query(`UPDATE convite SET expira_em = now() - interval '1 minute' WHERE id = $1`, [
      c.id,
    ]);
    const novo = await comoUsuario(admin, "POST", "/admin/convites", {
      email: c.email,
      nomeTitular: "Outra",
    });
    expect(novo.statusCode).toBe(201);
  });

  it("a listagem mostra o status e nunca expõe token nem hash", async () => {
    const pendente = await convidar();
    const expirado = await convidar();
    await owner.query(`UPDATE convite SET expira_em = now() - interval '1 minute' WHERE id = $1`, [
      expirado.id,
    ]);
    const usado = await convidar();
    await aceitar(usado.token, SENHA_NOVA);

    const res = await comoUsuario(admin, "GET", "/admin/convites");
    expect(res.statusCode).toBe(200);
    const lista = res.json().convites as { id: string; status: string }[];
    const status = (id: string) => lista.find((x) => x.id === id)?.status;
    expect(status(pendente.id)).toBe("pendente");
    expect(status(expirado.id)).toBe("expirado");
    expect(status(usado.id)).toBe("usado");
    expect(res.body).not.toMatch(/token/i);
    expect(res.body).not.toContain(pendente.token);
  });

  it("não-admin não vê a listagem", async () => {
    const titular = await criarUsuarioELogar("titular");
    expect((await comoUsuario(titular, "GET", "/admin/convites")).statusCode).toBe(403);
  });
});

describe("validar o link", () => {
  it("convite válido devolve e-mail e nome do titular", async () => {
    const c = await convidar();
    const res = await app.inject({ method: "GET", url: `/convites/${c.token}` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ email: c.email, nomeTitular: c.nomeTitular });
  });

  it("inexistente, expirado e usado dão exatamente a mesma resposta 404", async () => {
    const inexistente = await app.inject({ method: "GET", url: `/convites/${"x".repeat(43)}` });

    const expirado = await convidar();
    await owner.query(`UPDATE convite SET expira_em = now() - interval '1 second' WHERE id = $1`, [
      expirado.id,
    ]);
    const r1 = await app.inject({ method: "GET", url: `/convites/${expirado.token}` });

    const usado = await convidar();
    expect((await aceitar(usado.token, SENHA_NOVA)).statusCode).toBe(201);
    const r2 = await app.inject({ method: "GET", url: `/convites/${usado.token}` });

    for (const r of [inexistente, r1, r2]) expect(r.statusCode).toBe(404);
    expect(r1.json()).toEqual(inexistente.json());
    expect(r2.json()).toEqual(inexistente.json());
  });

  it("token curto demais é recusado", async () => {
    expect((await app.inject({ method: "GET", url: "/convites/abc" })).statusCode).toBe(404);
  });
});

describe("aceitar o convite", () => {
  it("cria titular e usuário, marca o convite como usado e o novo usuário consegue entrar", async () => {
    const c = await convidar();
    const res = await aceitar(c.token, SENHA_NOVA);
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ email: c.email });

    const u = await owner.query(
      `SELECT u.id, u.papel, u.ativo, u.senha_hash, t.nome
         FROM usuario u JOIN titular t ON t.id = u.titular_id WHERE lower(u.email) = $1`,
      [c.email],
    );
    expect(u.rowCount).toBe(1);
    expect(u.rows[0].papel).toBe("titular");
    expect(u.rows[0].ativo).toBe(true);
    expect(u.rows[0].nome).toBe(c.nomeTitular);
    expect(u.rows[0].senha_hash.startsWith("$argon2id$")).toBe(true);

    const cv = await owner.query(`SELECT usado_em, usado_por FROM convite WHERE id = $1`, [c.id]);
    expect(cv.rows[0].usado_em).not.toBeNull();
    expect(cv.rows[0].usado_por).toBe(u.rows[0].id);

    const login = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: c.email, senha: SENHA_NOVA },
      remoteAddress: novoIp(),
    });
    expect(login.statusCode).toBe(200);
    expect(login.json().usuario.papel).toBe("titular");
  });

  it("registra no log, sem senha nem token", async () => {
    const c = await convidar();
    await aceitar(c.token, SENHA_NOVA);
    const l = await owner.query(`SELECT * FROM log WHERE entidade = 'convite' AND entidade_id = $1`, [
      c.id,
    ]);
    expect(l.rows.map((x) => x.acao).sort()).toEqual(["convite.aceito", "convite.criado"]);
    const texto = JSON.stringify(l.rows);
    expect(texto).not.toContain(SENHA_NOVA);
    expect(texto).not.toContain(c.token);
  });

  it("uso único: o segundo cadastro com o mesmo link é recusado e não cria nada", async () => {
    const c = await convidar();
    expect((await aceitar(c.token, SENHA_NOVA)).statusCode).toBe(201);
    expect((await aceitar(c.token, "outra-senha-qualquer-1")).statusCode).toBe(404);
    const r = await owner.query(`SELECT 1 FROM usuario WHERE lower(email) = $1`, [c.email]);
    expect(r.rowCount).toBe(1);
  });

  it("convite expirado é recusado e nada é criado", async () => {
    const c = await convidar();
    await owner.query(`UPDATE convite SET expira_em = now() - interval '1 second' WHERE id = $1`, [
      c.id,
    ]);
    expect((await aceitar(c.token, SENHA_NOVA)).statusCode).toBe(404);
    const r = await owner.query(`SELECT 1 FROM usuario WHERE lower(email) = $1`, [c.email]);
    expect(r.rowCount).toBe(0);
    const t = await owner.query(`SELECT 1 FROM titular WHERE nome = $1`, [c.nomeTitular]);
    expect(t.rowCount).toBe(0);
  });

  it("token inexistente é recusado", async () => {
    expect((await aceitar("y".repeat(43), SENHA_NOVA)).statusCode).toBe(404);
  });

  it("senha fraca é recusada (400) e o convite continua válido", async () => {
    const c = await convidar();
    expect((await aceitar(c.token, "curta")).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: `/convites/${c.token}` })).statusCode).toBe(200);
    expect((await aceitar(c.token, SENHA_NOVA)).statusCode).toBe(201);
  });

  it("se o e-mail virou cadastrado no meio do caminho: 409, nada fica pela metade e o convite segue pendente", async () => {
    const c = await convidar();
    const t = await owner.query(`INSERT INTO titular (nome) VALUES ('Outro') RETURNING id`);
    await owner.query(
      `INSERT INTO usuario (titular_id, email, senha_hash, papel) VALUES ($1, $2, 'h', 'titular')`,
      [t.rows[0].id, c.email],
    );
    expect((await aceitar(c.token, SENHA_NOVA)).statusCode).toBe(409);
    const cv = await owner.query(`SELECT usado_em FROM convite WHERE id = $1`, [c.id]);
    expect(cv.rows[0].usado_em).toBeNull();
    const orfao = await owner.query(`SELECT 1 FROM titular WHERE nome = $1`, [c.nomeTitular]);
    expect(orfao.rowCount).toBe(0);
  });

  it("é rota pública: funciona mesmo com outra sessão aberta, sem token CSRF", async () => {
    const c = await convidar();
    const res = await aceitar(c.token, SENHA_NOVA, { cookie: `${COOKIE}=${admin.cookie}` });
    expect(res.statusCode).toBe(201);
  });

  it("exclusão mútua: se outro cadastro consome o convite durante o nosso, o nosso perde", async () => {
    // Uma conexão separada segura a linha do convite (FOR UPDATE), como se outro
    // cadastro estivesse em andamento. Quando ela marca o convite como usado e
    // termina, o nosso cadastro precisa ser recusado. Sem FOR UPDATE no código, o
    // cadastro criaria o usuário e este teste falharia.
    const c = await convidar();
    const outra = await owner.connect();
    try {
      await outra.query("BEGIN");
      await outra.query(`SELECT id FROM convite WHERE token_hash = $1 FOR UPDATE`, [
        hashDoToken(c.token, SEGREDO),
      ]);

      let terminou = false;
      const tentativa = aceitar(c.token, SENHA_NOVA).then((r) => {
        terminou = true;
        return r;
      });
      await new Promise((resolve) => setTimeout(resolve, 700));
      expect(terminou).toBe(false);

      await outra.query(`UPDATE convite SET usado_em = now() WHERE id = $1`, [c.id]);
      await outra.query("COMMIT");

      const res = await tentativa;
      expect(res.statusCode).toBe(404);
      const r = await owner.query(`SELECT 1 FROM usuario WHERE lower(email) = $1`, [c.email]);
      expect(r.rowCount).toBe(0);
    } finally {
      outra.release();
    }
  });
});
