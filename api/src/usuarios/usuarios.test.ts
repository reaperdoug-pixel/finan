import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { MAX_FALHAS_POR_EMAIL } from "../auth/limite.js";
import { MODULOS, permissoesNulas, permissoesTotais, type Permissoes } from "../auth/permissoes.js";
import { gerarHash } from "../auth/senha.js";
import { createDb, createPool } from "../db/client.js";
import { loadEnv, requireEnv } from "../env.js";

loadEnv();

const SEGREDO = "segredo-de-teste-com-mais-de-trinta-e-dois-caracteres";
const ORIGEM = "http://localhost:5173";
const SENHA = "senha-correta-123";
const SENHA_VINCULADO = "senha-do-vinculado-123";
const COOKIE = "finan_sid";

const TUDO = permissoesTotais();
const SO_VER_CONTAS = { contas: { ver: true } };

let appPool: pg.Pool;
let owner: pg.Pool;
let app: FastifyInstance;
let hashDaSenha: string;
let seqIp = 0;
const novoIp = () => `10.40.${Math.floor(++seqIp / 250)}.${(seqIp % 250) + 1}`;
const novoEmail = () => `usr-${randomUUID()}@teste.com`;

interface Logado {
  cookie: string;
  csrf: string;
  ip: string;
  email: string;
  id: string;
  titularId: string;
}
let admin: Logado;

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
  admin = await criarELogar("admin");
});

afterAll(async () => {
  await app.close();
  await appPool.end();
  await owner.end();
});

async function logar(email: string, senha: string): Promise<Omit<Logado, "id" | "titularId">> {
  const ip = novoIp();
  const res = await app.inject({
    method: "POST",
    url: "/auth/login",
    payload: { email, senha },
    remoteAddress: ip,
  });
  expect(res.statusCode).toBe(200);
  const cookie = res.cookies.find((c) => c.name === COOKIE)!.value;
  return { cookie, csrf: res.json().csrfToken as string, ip, email };
}

/** Cria um titular novo (com um usuário titular ou admin) direto no banco e faz login de verdade. */
async function criarELogar(papel: "admin" | "titular"): Promise<Logado> {
  const email = novoEmail();
  const t = await owner.query(`INSERT INTO titular (nome) VALUES ($1) RETURNING id`, [
    `Titular ${randomUUID()}`,
  ]);
  const u = await owner.query(
    `INSERT INTO usuario (titular_id, email, senha_hash, papel) VALUES ($1, $2, $3, $4) RETURNING id`,
    [t.rows[0].id, email, hashDaSenha, papel],
  );
  const l = await logar(email, SENHA);
  return { ...l, id: u.rows[0].id as string, titularId: t.rows[0].id as string };
}

function chamar(
  quem: Pick<Logado, "cookie" | "csrf" | "ip">,
  metodo: "POST" | "GET" | "PUT",
  url: string,
  payload?: unknown,
  semCsrf = false,
) {
  return app.inject({
    method: metodo,
    url,
    payload: payload as object | undefined,
    remoteAddress: quem.ip,
    headers: {
      cookie: `${COOKIE}=${quem.cookie}`,
      ...(semCsrf ? {} : { "x-csrf-token": quem.csrf }),
    },
  });
}

function convidar(
  quem: Pick<Logado, "cookie" | "csrf" | "ip">,
  extra: Record<string, unknown> = {},
  semCsrf = false,
) {
  return chamar(
    quem,
    "POST",
    "/usuarios/convites",
    { email: novoEmail(), permissoes: SO_VER_CONTAS, senha: SENHA, ...extra },
    semCsrf,
  );
}

function tokenDoLink(res: { json: () => { link: string } }): string {
  return res.json().link.split("/convite/")[1]!;
}

/** Fluxo real: o titular convida, o convidado aceita e entra. */
async function criarVinculado(
  titular: Logado,
  permissoes: unknown = SO_VER_CONTAS,
): Promise<Logado> {
  const email = novoEmail();
  const conv = await convidar(titular, { email, permissoes });
  expect(conv.statusCode).toBe(201);
  const aceite = await app.inject({
    method: "POST",
    url: `/convites/${tokenDoLink(conv)}/aceitar`,
    payload: { senha: SENHA_VINCULADO },
    remoteAddress: novoIp(),
  });
  expect(aceite.statusCode).toBe(201);
  const l = await logar(email, SENHA_VINCULADO);
  const u = await owner.query(`SELECT id FROM usuario WHERE lower(email) = $1`, [email]);
  return { ...l, id: u.rows[0].id as string, titularId: titular.titularId };
}

async function permissoesNoBanco(usuarioId: string): Promise<Permissoes> {
  const r = await owner.query(
    `SELECT modulo, ver, cadastrar, alterar, excluir FROM permissao WHERE usuario_id = $1`,
    [usuarioId],
  );
  const p = permissoesNulas();
  for (const l of r.rows) {
    p[l.modulo as keyof Permissoes] = {
      ver: l.ver,
      cadastrar: l.cadastrar,
      alterar: l.alterar,
      excluir: l.excluir,
    };
  }
  return p;
}

const contarConvites = async (email: string) =>
  (await owner.query(`SELECT 1 FROM convite WHERE lower(email) = $1`, [email.toLowerCase()]))
    .rowCount;

describe("convidar vinculado: quem pode", () => {
  it("titular, com a senha certa", async () => {
    const t = await criarELogar("titular");
    const email = novoEmail();
    const res = await convidar(t, { email, permissoes: { contas: { ver: true, alterar: true } } });
    expect(res.statusCode).toBe(201);
    expect(res.json().link).toContain(`${ORIGEM}/convite/`);

    const c = await owner.query(
      `SELECT papel, titular_id, permissoes, token_hash FROM convite WHERE lower(email) = $1`,
      [email],
    );
    expect(c.rows[0].papel).toBe("vinculado");
    expect(c.rows[0].titular_id).toBe(t.titularId);
    expect(c.rows[0].permissoes.contas).toEqual({
      ver: true,
      cadastrar: false,
      alterar: true,
      excluir: false,
    });
    expect(c.rows[0].token_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("admin, no próprio titular", async () => {
    expect((await convidar(admin)).statusCode).toBe(201);
  });

  it("vinculado NÃO pode, mesmo com todas as permissões de módulo", async () => {
    const t = await criarELogar("titular");
    const v = await criarVinculado(t, TUDO);
    const email = novoEmail();
    const res = await convidar(v, { email });
    expect(res.statusCode).toBe(403);
    expect(await contarConvites(email)).toBe(0);
  });

  it("sem login: 401. Sem token CSRF: 403", async () => {
    const semLogin = await app.inject({
      method: "POST",
      url: "/usuarios/convites",
      payload: { email: novoEmail(), permissoes: {}, senha: SENHA },
    });
    expect(semLogin.statusCode).toBe(401);
    const t = await criarELogar("titular");
    expect((await convidar(t, {}, true)).statusCode).toBe(403);
  });

  it("titular não convida para o titular de outra pessoa; informar o próprio vale", async () => {
    const a = await criarELogar("titular");
    const b = await criarELogar("titular");
    const email = novoEmail();
    expect((await convidar(a, { email, titularId: b.titularId })).statusCode).toBe(403);
    expect(await contarConvites(email)).toBe(0);
    expect((await convidar(a, { titularId: a.titularId })).statusCode).toBe(201);
  });

  it("admin convida para outro titular (convite fica no titular de destino)", async () => {
    const t = await criarELogar("titular");
    const email = novoEmail();
    const res = await convidar(admin, { email, titularId: t.titularId });
    expect(res.statusCode).toBe(201);
    const c = await owner.query(`SELECT titular_id FROM convite WHERE lower(email) = $1`, [email]);
    expect(c.rows[0].titular_id).toBe(t.titularId);
  });

  it("titular inexistente ou inativo: 404", async () => {
    expect((await convidar(admin, { titularId: randomUUID() })).statusCode).toBe(404);
    const t = await criarELogar("titular");
    await owner.query(`UPDATE titular SET ativo = false, inativado_em = now() WHERE id = $1`, [
      t.titularId,
    ]);
    expect((await convidar(admin, { titularId: t.titularId })).statusCode).toBe(404);
  });
});

describe("convidar vinculado: senha de confirmação", () => {
  it("sem senha no corpo: 400", async () => {
    const t = await criarELogar("titular");
    const res = await chamar(t, "POST", "/usuarios/convites", {
      email: novoEmail(),
      permissoes: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("senha errada: 403, nada criado e a falha vai para o log", async () => {
    const t = await criarELogar("titular");
    const email = novoEmail();
    const res = await convidar(t, { email, senha: "senha-errada-123" });
    expect(res.statusCode).toBe(403);
    expect(await contarConvites(email)).toBe(0);
    const l = await owner.query(
      `SELECT 1 FROM log WHERE acao = 'reautenticacao.falha' AND usuario_id = $1`,
      [t.id],
    );
    expect(l.rowCount).toBe(1);
  });

  it("depois de muitas senhas erradas, até a certa é bloqueada (429)", async () => {
    const t = await criarELogar("titular");
    for (let i = 0; i < MAX_FALHAS_POR_EMAIL; i++) {
      expect((await convidar(t, { senha: "senha-errada-123" })).statusCode).toBe(403);
    }
    expect((await convidar(t, { senha: SENHA })).statusCode).toBe(429);
  });

  it("registra no log quem confirmou, as permissões e nunca o token nem a senha", async () => {
    const t = await criarELogar("titular");
    const res = await convidar(t, { permissoes: { contas: { ver: true } } });
    const id = res.json().id as string;
    const l = await owner.query(`SELECT * FROM log WHERE entidade = 'convite' AND entidade_id = $1`, [
      id,
    ]);
    expect(l.rowCount).toBe(1);
    expect(l.rows[0].acao).toBe("convite.criado");
    expect(l.rows[0].usuario_id).toBe(t.id);
    expect(l.rows[0].confirmado_por).toBe(t.id);
    expect(l.rows[0].titular_id).toBe(t.titularId);
    expect(l.rows[0].depois.permissoes.contas.ver).toBe(true);
    const texto = JSON.stringify(l.rows);
    expect(texto).not.toContain(tokenDoLink(res));
    expect(texto).not.toContain(SENHA);
  });
});

describe("convidar vinculado: permissões inválidas", () => {
  it.each([
    ["alterar sem ver", { contas: { alterar: true } }],
    ["excluir sem ver", { categorias: { excluir: true } }],
    ["log com cadastrar", { log: { ver: true, cadastrar: true } }],
    ["módulo desconhecido", { relatorios: { ver: true } }],
    ["ação desconhecida", { contas: { ver: true, apagar: true } }],
    ["valor que não é booleano", { contas: { ver: "sim" } }],
  ])("%s: 400 e nada criado", async (_nome, permissoes) => {
    const t = await criarELogar("titular");
    const email = novoEmail();
    expect((await convidar(t, { email, permissoes })).statusCode).toBe(400);
    expect(await contarConvites(email)).toBe(0);
  });

  it("permissões omitidas: convite válido, tudo falso", async () => {
    const t = await criarELogar("titular");
    const res = await chamar(t, "POST", "/usuarios/convites", { email: novoEmail(), senha: SENHA });
    expect(res.statusCode).toBe(201);
    expect(res.json().permissoes).toEqual(permissoesNulas());
  });

  it("e-mail já cadastrado ou já convidado: 409", async () => {
    const t = await criarELogar("titular");
    const outro = await criarELogar("titular");
    expect((await convidar(t, { email: outro.email.toUpperCase() })).statusCode).toBe(409);
    const email = novoEmail();
    expect((await convidar(t, { email })).statusCode).toBe(201);
    expect((await convidar(t, { email })).statusCode).toBe(409);
  });
});

describe("aceitar convite de vinculado", () => {
  it("cria o vinculado no titular certo, com as permissões do convite, e ele entra", async () => {
    const t = await criarELogar("titular");
    const permissoes = {
      lancamentos: { ver: true, cadastrar: true },
      contas: { ver: true, alterar: true },
      log: { ver: true },
    };
    const antes = await owner.query(`SELECT count(*)::int AS n FROM titular`);
    const v = await criarVinculado(t, permissoes);
    const depois = await owner.query(`SELECT count(*)::int AS n FROM titular`);
    expect(depois.rows[0].n).toBe(antes.rows[0].n); // não cria titular novo

    const u = await owner.query(`SELECT papel, titular_id, ativo FROM usuario WHERE id = $1`, [v.id]);
    expect(u.rows[0]).toEqual({ papel: "vinculado", titular_id: t.titularId, ativo: true });

    const noBanco = await permissoesNoBanco(v.id);
    expect(noBanco.lancamentos).toEqual({
      ver: true,
      cadastrar: true,
      alterar: false,
      excluir: false,
    });
    expect(noBanco.contas).toEqual({ ver: true, cadastrar: false, alterar: true, excluir: false });
    expect(noBanco.log.ver).toBe(true);
    expect(noBanco.categorias.ver).toBe(false);
    const linhas = await owner.query(`SELECT 1 FROM permissao WHERE usuario_id = $1`, [v.id]);
    expect(linhas.rowCount).toBe(MODULOS.length); // uma por módulo, sempre

    const me = await chamar(v, "GET", "/auth/me");
    expect(me.statusCode).toBe(200);
    expect(me.json().usuario.papel).toBe("vinculado");
    expect(me.json().usuario.titularId).toBe(t.titularId);
    expect(me.json().permissoes).toEqual(noBanco);
  });

  it("se o titular foi inativado antes do aceite: 404 e nada é criado", async () => {
    const t = await criarELogar("titular");
    const email = novoEmail();
    const conv = await convidar(t, { email });
    await owner.query(`UPDATE titular SET ativo = false, inativado_em = now() WHERE id = $1`, [
      t.titularId,
    ]);
    const res = await app.inject({
      method: "POST",
      url: `/convites/${tokenDoLink(conv)}/aceitar`,
      payload: { senha: SENHA_VINCULADO },
      remoteAddress: novoIp(),
    });
    expect(res.statusCode).toBe(404);
    expect(
      (await owner.query(`SELECT 1 FROM usuario WHERE lower(email) = $1`, [email])).rowCount,
    ).toBe(0);
  });

  it("titular e admin enxergam permissões totais em /auth/me", async () => {
    const t = await criarELogar("titular");
    for (const quem of [t, admin]) {
      const me = await chamar(quem, "GET", "/auth/me");
      expect(me.json().permissoes).toEqual(TUDO);
    }
  });
});

describe("listar usuários", () => {
  it("titular vê só os seus vinculados e convites pendentes, com permissões", async () => {
    const a = await criarELogar("titular");
    const b = await criarELogar("titular");
    const va = await criarVinculado(a, { contas: { ver: true } });
    const vb = await criarVinculado(b);
    const pendenteEmail = novoEmail();
    await convidar(a, { email: pendenteEmail });

    const res = await chamar(a, "GET", "/usuarios");
    expect(res.statusCode).toBe(200);
    const corpo = res.json();
    const ids = corpo.usuarios.map((u: { id: string }) => u.id);
    expect(ids).toContain(va.id);
    expect(ids).not.toContain(vb.id);
    expect(
      corpo.usuarios.find((u: { id: string }) => u.id === va.id).permissoes.contas.ver,
    ).toBe(true);
    expect(corpo.convitesPendentes.map((c: { email: string }) => c.email)).toContain(pendenteEmail);
    expect(res.body).not.toMatch(/senha|hash|token/i);
  });

  it("vinculado: 403. Sem login: 401", async () => {
    const t = await criarELogar("titular");
    const v = await criarVinculado(t, TUDO);
    expect((await chamar(v, "GET", "/usuarios")).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/usuarios" })).statusCode).toBe(401);
  });

  it("admin vê os de outro titular informando o titularId; titular não", async () => {
    const a = await criarELogar("titular");
    const b = await criarELogar("titular");
    const vb = await criarVinculado(b);
    const doAdmin = await chamar(admin, "GET", `/usuarios?titularId=${b.titularId}`);
    expect(doAdmin.json().usuarios.map((u: { id: string }) => u.id)).toContain(vb.id);
    expect((await chamar(a, "GET", `/usuarios?titularId=${b.titularId}`)).statusCode).toBe(403);
  });

  it("titularId malformado: 400", async () => {
    expect((await chamar(admin, "GET", "/usuarios?titularId=nao-e-uuid")).statusCode).toBe(400);
  });
});

describe("alterar permissões", () => {
  const NOVAS = { contas: { ver: true, cadastrar: true }, categorias: { ver: true } };

  it("titular, com a senha: vale na hora para o vinculado já logado e vai para o log", async () => {
    const t = await criarELogar("titular");
    const v = await criarVinculado(t, { contas: { ver: true } });
    const antes = await chamar(v, "GET", "/auth/me");
    expect(antes.json().permissoes.contas.cadastrar).toBe(false);

    const res = await chamar(t, "PUT", `/usuarios/${v.id}/permissoes`, {
      permissoes: NOVAS,
      senha: SENHA,
    });
    expect(res.statusCode).toBe(200);

    const depois = await chamar(v, "GET", "/auth/me");
    expect(depois.json().permissoes.contas.cadastrar).toBe(true);
    expect(depois.json().permissoes.categorias.ver).toBe(true);

    const l = await owner.query(
      `SELECT * FROM log WHERE acao = 'permissao.alterada' AND entidade_id = $1`,
      [v.id],
    );
    expect(l.rowCount).toBe(1);
    expect(l.rows[0].usuario_id).toBe(t.id);
    expect(l.rows[0].confirmado_por).toBe(t.id);
    expect(l.rows[0].titular_id).toBe(t.titularId);
    expect(l.rows[0].antes.contas.cadastrar).toBe(false);
    expect(l.rows[0].depois.contas.cadastrar).toBe(true);
    expect(JSON.stringify(l.rows)).not.toContain(SENHA);
  });

  it("tirar permissões também vale na hora", async () => {
    const t = await criarELogar("titular");
    const v = await criarVinculado(t, { contas: { ver: true } });
    await chamar(t, "PUT", `/usuarios/${v.id}/permissoes`, { permissoes: {}, senha: SENHA });
    expect((await chamar(v, "GET", "/auth/me")).json().permissoes).toEqual(permissoesNulas());
    expect(await permissoesNoBanco(v.id)).toEqual(permissoesNulas());
  });

  it("senha errada: 403 e as permissões não mudam", async () => {
    const t = await criarELogar("titular");
    const v = await criarVinculado(t, { contas: { ver: true } });
    const res = await chamar(t, "PUT", `/usuarios/${v.id}/permissoes`, {
      permissoes: NOVAS,
      senha: "errada-123456",
    });
    expect(res.statusCode).toBe(403);
    expect((await permissoesNoBanco(v.id)).contas.cadastrar).toBe(false);
  });

  it("sem senha: 400. Sem token CSRF: 403. Sem login: 401", async () => {
    const t = await criarELogar("titular");
    const v = await criarVinculado(t);
    const url = `/usuarios/${v.id}/permissoes`;
    expect((await chamar(t, "PUT", url, { permissoes: NOVAS })).statusCode).toBe(400);
    expect(
      (await chamar(t, "PUT", url, { permissoes: NOVAS, senha: SENHA }, true)).statusCode,
    ).toBe(403);
    const semLogin = await app.inject({
      method: "PUT",
      url,
      payload: { permissoes: NOVAS, senha: SENHA },
    });
    expect(semLogin.statusCode).toBe(401);
  });

  it("titular não mexe em vinculado de OUTRO titular: 404 e nada muda", async () => {
    const a = await criarELogar("titular");
    const b = await criarELogar("titular");
    const vb = await criarVinculado(b, { contas: { ver: true } });
    const res = await chamar(a, "PUT", `/usuarios/${vb.id}/permissoes`, {
      permissoes: TUDO,
      senha: SENHA,
    });
    expect(res.statusCode).toBe(404);
    expect((await permissoesNoBanco(vb.id)).contas.cadastrar).toBe(false);
  });

  it("admin altera vinculado de qualquer titular", async () => {
    const t = await criarELogar("titular");
    const v = await criarVinculado(t, { contas: { ver: true } });
    const res = await chamar(admin, "PUT", `/usuarios/${v.id}/permissoes`, {
      permissoes: NOVAS,
      senha: SENHA,
    });
    expect(res.statusCode).toBe(200);
    expect((await permissoesNoBanco(v.id)).contas.cadastrar).toBe(true);
    const l = await owner.query(
      `SELECT usuario_id, titular_id FROM log WHERE acao = 'permissao.alterada' AND entidade_id = $1`,
      [v.id],
    );
    expect(l.rows[0].usuario_id).toBe(admin.id);
    expect(l.rows[0].titular_id).toBe(t.titularId); // o log fica no titular afetado
  });

  it("vinculado NÃO altera permissões (nem as próprias, nem as de outro), mesmo com todas", async () => {
    const t = await criarELogar("titular");
    const v1 = await criarVinculado(t, TUDO);
    const v2 = await criarVinculado(t, { contas: { ver: true } });
    const propria = await chamar(v1, "PUT", `/usuarios/${v1.id}/permissoes`, {
      permissoes: TUDO,
      senha: SENHA_VINCULADO,
    });
    const alheia = await chamar(v1, "PUT", `/usuarios/${v2.id}/permissoes`, {
      permissoes: TUDO,
      senha: SENHA_VINCULADO,
    });
    expect(propria.statusCode).toBe(403);
    expect(alheia.statusCode).toBe(403);
    expect((await permissoesNoBanco(v2.id)).categorias.ver).toBe(false);
  });

  it("alvo que não é vinculado: 400. Inexistente ou id inválido: 404", async () => {
    const t = await criarELogar("titular");
    const corpo = { permissoes: {}, senha: SENHA };
    expect((await chamar(t, "PUT", `/usuarios/${t.id}/permissoes`, corpo)).statusCode).toBe(400);
    expect(
      (await chamar(t, "PUT", `/usuarios/${randomUUID()}/permissoes`, corpo)).statusCode,
    ).toBe(404);
    expect((await chamar(t, "PUT", `/usuarios/nao-e-uuid/permissoes`, corpo)).statusCode).toBe(404);
  });

  it.each([
    ["alterar sem ver", { contas: { alterar: true } }],
    ["log com excluir", { log: { ver: true, excluir: true } }],
    ["módulo desconhecido", { relatorios: { ver: true } }],
  ])("permissões inválidas (%s): 400 e nada muda", async (_nome, permissoes) => {
    const t = await criarELogar("titular");
    const v = await criarVinculado(t, { contas: { ver: true } });
    const res = await chamar(t, "PUT", `/usuarios/${v.id}/permissoes`, {
      permissoes,
      senha: SENHA,
    });
    expect(res.statusCode).toBe(400);
    expect((await permissoesNoBanco(v.id)).contas.ver).toBe(true);
  });
});

describe("garantias do banco", () => {
  async function codigo(pool: pg.Pool, sql: string, params: unknown[] = []) {
    try {
      await pool.query(sql, params);
      return null;
    } catch (e) {
      return (e as { code?: string }).code ?? "desconhecido";
    }
  }

  it("o banco recusa permissão inválida mesmo se a API errar", async () => {
    const t = await criarELogar("titular");
    const v = await criarVinculado(t);
    const ins = `INSERT INTO permissao (usuario_id, modulo, ver, alterar) VALUES ($1, 'orcamentos', false, true)`;
    expect(await codigo(owner, ins, [v.id])).toBe("23514");
    const log = `INSERT INTO permissao (usuario_id, modulo, ver, excluir) VALUES ($1, 'log', true, true)`;
    expect(await codigo(owner, log, [v.id])).toBe("23514");
  });

  it("uma linha por usuário e módulo", async () => {
    const t = await criarELogar("titular");
    const v = await criarVinculado(t);
    expect(
      await codigo(owner, `INSERT INTO permissao (usuario_id, modulo) VALUES ($1, 'contas')`, [v.id]),
    ).toBe("23505");
  });

  it("o papel da API não apaga permissões", async () => {
    expect(await codigo(appPool, `DELETE FROM permissao`)).toBe("42501");
  });
});
