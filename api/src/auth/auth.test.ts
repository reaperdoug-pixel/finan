import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { createDb, createPool } from "../db/client.js";
import { titular, usuario } from "../db/schema.js";
import { loadEnv, requireEnv } from "../env.js";
import { MAX_FALHAS_POR_EMAIL, MAX_FALHAS_POR_IP } from "./limite.js";
import { gerarHash } from "./senha.js";

loadEnv();

const SEGREDO = "segredo-de-teste-com-mais-de-trinta-e-dois-caracteres";
const ORIGEM = "http://localhost:5173";
const SENHA = "senha-correta-123";
const COOKIE = "finan_sid";

let appPool: pg.Pool;
let owner: pg.Pool;
let app: FastifyInstance;
let hashDaSenha: string;
let seqIp = 0;

/** Cada teste usa um IP próprio para o limite por IP de um teste não afetar os outros. */
const novoIp = () => `10.20.${Math.floor(++seqIp / 250)}.${(seqIp % 250) + 1}`;

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
});

afterAll(async () => {
  await app.close();
  await appPool.end();
  await owner.end();
});

async function criarUsuario(opcoes: { usuarioAtivo?: boolean; titularAtivo?: boolean } = {}) {
  const db = createDb(appPool);
  const inativo = (ativo: boolean | undefined) =>
    ativo === false ? { ativo: false, inativadoEm: new Date() } : {};
  const [t] = await db
    .insert(titular)
    .values({ nome: "Titular de teste", ...inativo(opcoes.titularAtivo) })
    .returning({ id: titular.id });
  const email = `u-${randomUUID()}@teste.com`;
  const [u] = await db
    .insert(usuario)
    .values({
      titularId: t!.id,
      email,
      senhaHash: hashDaSenha,
      papel: "titular",
      ...inativo(opcoes.usuarioAtivo),
    })
    .returning({ id: usuario.id });
  return { email, usuarioId: u!.id, titularId: t!.id };
}

function login(email: string, senha: string, ip: string, headers: Record<string, string> = {}) {
  return app.inject({
    method: "POST",
    url: "/auth/login",
    payload: { email, senha },
    remoteAddress: ip,
    headers,
  });
}

function cookieDe(res: { cookies: { name: string; value: string }[] }): string {
  const c = res.cookies.find((x) => x.name === COOKIE);
  if (!c) throw new Error("cookie de sessão ausente");
  return c.value;
}

function me(valorCookie: string, ip: string) {
  return app.inject({
    method: "GET",
    url: "/auth/me",
    remoteAddress: ip,
    headers: { cookie: `${COOKIE}=${valorCookie}` },
  });
}

async function logarEPegar(email: string, ip: string) {
  const res = await login(email, SENHA, ip);
  expect(res.statusCode).toBe(200);
  return { cookie: cookieDe(res), csrf: res.json().csrfToken as string };
}

describe("login", () => {
  it("entra com a senha certa e devolve só dados públicos", async () => {
    const u = await criarUsuario();
    const res = await login(u.email, SENHA, novoIp());
    expect(res.statusCode).toBe(200);
    const corpo = res.json();
    expect(corpo.usuario.email).toBe(u.email);
    expect(corpo.usuario.papel).toBe("titular");
    expect(JSON.stringify(corpo)).not.toMatch(/senha|hash/i);
    expect(typeof corpo.csrfToken).toBe("string");
  });

  it("o cookie é httpOnly, SameSite=Strict e não contém o token CSRF", async () => {
    const u = await criarUsuario();
    const res = await login(u.email, SENHA, novoIp());
    const setCookie = String(res.headers["set-cookie"]);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Strict/i);
    expect(setCookie).toMatch(/Path=\//);
    expect(setCookie).not.toContain(res.json().csrfToken);
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("o banco guarda só o hash do token, nunca o token", async () => {
    const u = await criarUsuario();
    const res = await login(u.email, SENHA, novoIp());
    const token = cookieDe(res);
    const r = await owner.query(`SELECT token_hash FROM sessao WHERE usuario_id = $1`, [u.usuarioId]);
    expect(r.rows[0].token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(r.rows[0].token_hash).not.toBe(token);
  });

  it("e-mail é aceito sem diferenciar maiúsculas", async () => {
    const u = await criarUsuario();
    const res = await login(u.email.toUpperCase(), SENHA, novoIp());
    expect(res.statusCode).toBe(200);
  });

  it("senha errada: 401, sem cookie, e fica registrado no log", async () => {
    const u = await criarUsuario();
    const res = await login(u.email, "senha-errada-123", novoIp());
    expect(res.statusCode).toBe(401);
    expect(res.cookies.length).toBe(0);
    const l = await owner.query(
      `SELECT depois FROM log WHERE acao = 'login.falha' AND usuario_id = $1`,
      [u.usuarioId],
    );
    expect(l.rowCount).toBe(1);
    expect(l.rows[0].depois.motivo).toBe("senha_incorreta");
  });

  it("e-mail inexistente e senha errada dão a mesma resposta (não revela quem existe)", async () => {
    const u = await criarUsuario();
    const a = await login(u.email, "senha-errada-123", novoIp());
    const b = await login(`nao-existe-${randomUUID()}@teste.com`, "senha-errada-123", novoIp());
    expect(a.statusCode).toBe(b.statusCode);
    expect(a.json()).toEqual(b.json());
  });

  it("corpo inválido responde 400", async () => {
    const res = await app.inject({ method: "POST", url: "/auth/login", payload: {} });
    expect(res.statusCode).toBe(400);
  });

  it("usuário inativo não entra, mesmo com a senha certa", async () => {
    const u = await criarUsuario({ usuarioAtivo: false });
    const res = await login(u.email, SENHA, novoIp());
    expect(res.statusCode).toBe(401);
    const l = await owner.query(
      `SELECT depois FROM log WHERE acao = 'login.falha' AND usuario_id = $1`,
      [u.usuarioId],
    );
    expect(l.rows[0].depois.motivo).toBe("conta_inativa");
  });

  it("usuário de titular inativo não entra", async () => {
    const u = await criarUsuario({ titularAtivo: false });
    const res = await login(u.email, SENHA, novoIp());
    expect(res.statusCode).toBe(401);
  });

  it("login bem-sucedido é registrado no log, sem senha nem token", async () => {
    const u = await criarUsuario();
    const { cookie } = await logarEPegar(u.email, novoIp());
    const l = await owner.query(`SELECT * FROM log WHERE usuario_id = $1`, [u.usuarioId]);
    expect(l.rows.map((r) => r.acao)).toContain("login.sucesso");
    const texto = JSON.stringify(l.rows);
    expect(texto).not.toContain(SENHA);
    expect(texto).not.toContain(cookie);
  });
});

describe("bloqueio por tentativas", () => {
  it(`bloqueia o e-mail após ${MAX_FALHAS_POR_EMAIL} falhas, até com a senha certa`, async () => {
    const u = await criarUsuario();
    const ip = novoIp();
    for (let i = 0; i < MAX_FALHAS_POR_EMAIL; i++) {
      expect((await login(u.email, "senha-errada-123", ip)).statusCode).toBe(401);
    }
    expect((await login(u.email, SENHA, ip)).statusCode).toBe(429);
    // de outro IP também: o bloqueio é do e-mail
    expect((await login(u.email, SENHA, novoIp())).statusCode).toBe(429);
    const l = await owner.query(`SELECT 1 FROM log WHERE acao = 'login.bloqueado' AND ip = $1`, [ip]);
    expect(l.rowCount).toBeGreaterThan(0);
  });

  it("o bloqueio de um e-mail não afeta outro usuário", async () => {
    const a = await criarUsuario();
    const b = await criarUsuario();
    const ip = novoIp();
    for (let i = 0; i < MAX_FALHAS_POR_EMAIL; i++) await login(a.email, "senha-errada-123", ip);
    expect((await login(b.email, SENHA, ip)).statusCode).toBe(200);
  });

  it(`bloqueia o IP após ${MAX_FALHAS_POR_IP} falhas, mesmo variando o e-mail`, async () => {
    const u = await criarUsuario();
    const ip = novoIp();
    for (let i = 0; i < MAX_FALHAS_POR_IP; i++) {
      await login(`ninguem-${randomUUID()}@teste.com`, "senha-errada-123", ip);
    }
    expect((await login(u.email, SENHA, ip)).statusCode).toBe(429);
    // outro IP continua livre
    expect((await login(u.email, SENHA, novoIp())).statusCode).toBe(200);
  });

  it("um login certo zera a contagem de falhas do e-mail", async () => {
    const u = await criarUsuario();
    const ip = novoIp();
    for (let i = 0; i < MAX_FALHAS_POR_EMAIL - 1; i++) await login(u.email, "errada-123456", ip);
    expect((await login(u.email, SENHA, ip)).statusCode).toBe(200);
    for (let i = 0; i < MAX_FALHAS_POR_EMAIL - 1; i++) {
      expect((await login(u.email, "errada-123456", ip)).statusCode).toBe(401);
    }
  });
});

describe("sessão", () => {
  it("/auth/me sem cookie responde 401", async () => {
    const res = await app.inject({ method: "GET", url: "/auth/me" });
    expect(res.statusCode).toBe(401);
  });

  it("/auth/me com sessão válida devolve o usuário", async () => {
    const u = await criarUsuario();
    const ip = novoIp();
    const { cookie } = await logarEPegar(u.email, ip);
    const res = await me(cookie, ip);
    expect(res.statusCode).toBe(200);
    expect(res.json().usuario.id).toBe(u.usuarioId);
  });

  it("cookie adulterado ou inventado é recusado", async () => {
    expect((await me("x".repeat(43), novoIp())).statusCode).toBe(401);
    expect((await me("curto", novoIp())).statusCode).toBe(401);
  });

  it("expira após 30 minutos de inatividade e fica revogada", async () => {
    const u = await criarUsuario();
    const ip = novoIp();
    const { cookie } = await logarEPegar(u.email, ip);
    await owner.query(
      `UPDATE sessao SET ultimo_acesso = now() - interval '31 minutes' WHERE usuario_id = $1`,
      [u.usuarioId],
    );
    expect((await me(cookie, ip)).statusCode).toBe(401);
    const r = await owner.query(`SELECT revogada_em FROM sessao WHERE usuario_id = $1`, [u.usuarioId]);
    expect(r.rows[0].revogada_em).not.toBeNull();
    // e não volta a valer
    expect((await me(cookie, ip)).statusCode).toBe(401);
  });

  it("expira após 12 horas no total, mesmo com uso recente", async () => {
    const u = await criarUsuario();
    const ip = novoIp();
    const { cookie } = await logarEPegar(u.email, ip);
    await owner.query(
      `UPDATE sessao SET criada_em = now() - interval '13 hours', ultimo_acesso = now() WHERE usuario_id = $1`,
      [u.usuarioId],
    );
    expect((await me(cookie, ip)).statusCode).toBe(401);
  });

  it("o uso renova o prazo de inatividade", async () => {
    const u = await criarUsuario();
    const ip = novoIp();
    const { cookie } = await logarEPegar(u.email, ip);
    await owner.query(
      `UPDATE sessao SET ultimo_acesso = now() - interval '20 minutes' WHERE usuario_id = $1`,
      [u.usuarioId],
    );
    expect((await me(cookie, ip)).statusCode).toBe(200);
    const r = await owner.query(
      `SELECT extract(epoch FROM now() - ultimo_acesso) AS seg FROM sessao WHERE usuario_id = $1`,
      [u.usuarioId],
    );
    expect(Number(r.rows[0].seg)).toBeLessThan(30);
  });

  it("inativar o usuário derruba a sessão que já estava aberta", async () => {
    const u = await criarUsuario();
    const ip = novoIp();
    const { cookie } = await logarEPegar(u.email, ip);
    await owner.query(`UPDATE usuario SET ativo = false, inativado_em = now() WHERE id = $1`, [
      u.usuarioId,
    ]);
    expect((await me(cookie, ip)).statusCode).toBe(401);
  });
});

describe("logout e CSRF", () => {
  it("logout sem token CSRF é recusado e a sessão continua válida", async () => {
    const u = await criarUsuario();
    const ip = novoIp();
    const { cookie } = await logarEPegar(u.email, ip);
    const sem = await app.inject({
      method: "POST",
      url: "/auth/logout",
      remoteAddress: ip,
      headers: { cookie: `${COOKIE}=${cookie}` },
    });
    expect(sem.statusCode).toBe(403);
    const errado = await app.inject({
      method: "POST",
      url: "/auth/logout",
      remoteAddress: ip,
      headers: { cookie: `${COOKIE}=${cookie}`, "x-csrf-token": "token-errado" },
    });
    expect(errado.statusCode).toBe(403);
    expect((await me(cookie, ip)).statusCode).toBe(200);
  });

  it("logout com token CSRF correto encerra a sessão e registra no log", async () => {
    const u = await criarUsuario();
    const ip = novoIp();
    const { cookie, csrf } = await logarEPegar(u.email, ip);
    const res = await app.inject({
      method: "POST",
      url: "/auth/logout",
      remoteAddress: ip,
      headers: { cookie: `${COOKIE}=${cookie}`, "x-csrf-token": csrf },
    });
    expect(res.statusCode).toBe(204);
    expect((await me(cookie, ip)).statusCode).toBe(401);
    const r = await owner.query(`SELECT revogada_em FROM sessao WHERE usuario_id = $1`, [u.usuarioId]);
    expect(r.rows[0].revogada_em).not.toBeNull();
    const l = await owner.query(`SELECT 1 FROM log WHERE acao = 'logout' AND usuario_id = $1`, [
      u.usuarioId,
    ]);
    expect(l.rowCount).toBe(1);
  });

  it("logout sem sessão responde 401", async () => {
    const res = await app.inject({ method: "POST", url: "/auth/logout" });
    expect(res.statusCode).toBe(401);
  });

  it("Origin de outro site é recusada, e a do app é aceita", async () => {
    const u = await criarUsuario();
    const ruim = await login(u.email, SENHA, novoIp(), { origin: "https://site-malicioso.example" });
    expect(ruim.statusCode).toBe(403);
    const boa = await login(u.email, SENHA, novoIp(), { origin: ORIGEM });
    expect(boa.statusCode).toBe(200);
  });
});

describe("tabela tentativa_login", () => {
  it("o papel da API não consegue alterar nem apagar tentativas", async () => {
    const codigo = async (sql: string) => {
      try {
        await appPool.query(sql);
        return null;
      } catch (e) {
        return (e as { code?: string }).code;
      }
    };
    expect(await codigo(`UPDATE tentativa_login SET sucesso = true`)).toBe("42501");
    expect(await codigo(`DELETE FROM tentativa_login`)).toBe("42501");
  });
});
