import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { MODULOS } from "../auth/permissoes.js";
import { gerarHash } from "../auth/senha.js";
import { createDb, createPool } from "../db/client.js";
import { loadEnv, requireEnv } from "../env.js";

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
const novoIp = () => `10.50.${Math.floor(++seqIp / 250)}.${(seqIp % 250) + 1}`;
const novoEmail = () => `log-${randomUUID()}@teste.com`;

interface Logado {
  cookie: string;
  csrf: string;
  ip: string;
  email: string;
  id: string;
  titularId: string;
}

let admin: Logado;
let t1: Logado;
let t2: Logado;
let v1: Logado; // vinculado de t1, COM permissão de ver o log
let v2: Logado; // vinculado de t1, SEM permissão de ver o log

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

  admin = await criar("admin");
  t1 = await criar("titular");
  t2 = await criar("titular");
  v1 = await criar("vinculado", t1.titularId, { log: { ver: true } });
  v2 = await criar("vinculado", t1.titularId, {});

  // Movimento no log: falha de login conhecida (titular t1), falha de e-mail desconhecido
  // (sem titular) e uma troca de permissões feita pelo ADMIN num vinculado de t1.
  await app.inject({
    method: "POST",
    url: "/auth/login",
    payload: { email: t1.email, senha: "errada-123456" },
    remoteAddress: novoIp(),
  });
  await app.inject({
    method: "POST",
    url: "/auth/login",
    payload: { email: novoEmail(), senha: "errada-123456" },
    remoteAddress: novoIp(),
  });
  const alt = await chamar(admin, "PUT", `/usuarios/${v2.id}/permissoes`, {
    permissoes: { contas: { ver: true } },
    senha: SENHA,
  });
  expect(alt.statusCode).toBe(200);
});

afterAll(async () => {
  await app.close();
  await appPool.end();
  await owner.end();
});

async function logar(email: string): Promise<Pick<Logado, "cookie" | "csrf" | "ip" | "email">> {
  const ip = novoIp();
  const res = await app.inject({
    method: "POST",
    url: "/auth/login",
    payload: { email, senha: SENHA },
    remoteAddress: ip,
  });
  expect(res.statusCode).toBe(200);
  return {
    cookie: res.cookies.find((c) => c.name === COOKIE)!.value,
    csrf: res.json().csrfToken as string,
    ip,
    email,
  };
}

/** Cria usuário direto no banco (com titular novo, se não for informado) e faz login de verdade. */
async function criar(
  papel: "admin" | "titular" | "vinculado",
  titularId?: string,
  permissoes: Record<string, { ver?: boolean }> = {},
): Promise<Logado> {
  const email = novoEmail();
  const tid =
    titularId ??
    ((
      await owner.query(`INSERT INTO titular (nome) VALUES ($1) RETURNING id`, [
        `T ${randomUUID()}`,
      ])
    ).rows[0].id as string);
  const u = await owner.query(
    `INSERT INTO usuario (titular_id, email, senha_hash, papel) VALUES ($1, $2, $3, $4) RETURNING id`,
    [tid, email, hashDaSenha, papel],
  );
  const id = u.rows[0].id as string;
  if (papel === "vinculado") {
    for (const m of MODULOS) {
      await owner.query(`INSERT INTO permissao (usuario_id, modulo, ver) VALUES ($1, $2, $3)`, [
        id,
        m,
        permissoes[m]?.ver === true,
      ]);
    }
  }
  return { ...(await logar(email)), id, titularId: tid };
}

function chamar(
  quem: Pick<Logado, "cookie" | "csrf" | "ip">,
  metodo: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  url: string,
  payload?: unknown,
) {
  return app.inject({
    method: metodo,
    url,
    payload: payload as object | undefined,
    remoteAddress: quem.ip,
    headers: { cookie: `${COOKIE}=${quem.cookie}`, "x-csrf-token": quem.csrf },
  });
}

interface Item {
  id: string;
  ocorridoEm: string;
  usuarioId: string | null;
  usuario: string | null;
  titularId: string | null;
  acao: string;
  ip: string | null;
}
const itens = (res: { json: () => { itens: Item[] } }) => res.json().itens;

const totalNoBanco = async (titularId?: string) =>
  (
    await owner.query(
      titularId
        ? `SELECT count(*)::int AS n FROM log WHERE titular_id = $1`
        : `SELECT count(*)::int AS n FROM log`,
      titularId ? [titularId] : [],
    )
  ).rows[0].n as number;

describe("quem pode ler o log", () => {
  it("sem login: 401", async () => {
    expect((await app.inject({ method: "GET", url: "/log" })).statusCode).toBe(401);
  });

  it("vinculado SEM a permissão de ver o log: 403", async () => {
    expect((await chamar(v2, "GET", "/log")).statusCode).toBe(403);
  });

  it("vinculado COM a permissão: vê o log do titular dele, e só dele", async () => {
    const res = await chamar(v1, "GET", "/log?limite=100");
    expect(res.statusCode).toBe(200);
    const lista = itens(res);
    expect(lista.length).toBeGreaterThan(0);
    for (const i of lista) expect(i.titularId).toBe(t1.titularId);
  });

  it("titular vê o próprio titular, incluindo o que os vinculados fizeram", async () => {
    const lista = itens(await chamar(t1, "GET", "/log?limite=100"));
    expect(lista.length).toBeGreaterThan(0);
    for (const i of lista) expect(i.titularId).toBe(t1.titularId);
    const usuarios = new Set(lista.map((i) => i.usuarioId));
    expect(usuarios.has(t1.id)).toBe(true);
    expect(usuarios.has(v1.id)).toBe(true);
    expect(usuarios.has(v2.id)).toBe(true);
  });

  it("titular NÃO vê nada de outro titular", async () => {
    const lista = itens(await chamar(t1, "GET", "/log?limite=100"));
    expect(lista.some((i) => i.usuarioId === t2.id)).toBe(false);
    expect(lista.some((i) => i.titularId === t2.titularId)).toBe(false);
    expect(lista.some((i) => i.titularId === null)).toBe(false);
  });

  it("titular pedindo o titularId de outro: 403. Pedindo o próprio: ok", async () => {
    expect((await chamar(t1, "GET", `/log?titularId=${t2.titularId}`)).statusCode).toBe(403);
    expect((await chamar(t1, "GET", `/log?titularId=${t1.titularId}`)).statusCode).toBe(200);
  });

  it("admin vê o sistema todo, inclusive eventos sem titular", async () => {
    const lista = itens(await chamar(admin, "GET", "/log?limite=100"));
    const titulares = new Set(lista.map((i) => i.titularId));
    expect(titulares.has(t1.titularId)).toBe(true);
    expect(titulares.has(t2.titularId)).toBe(true);
    expect(titulares.has(null)).toBe(true); // ex.: falha de login de e-mail desconhecido
  });

  it("admin pode restringir a um titular", async () => {
    const lista = itens(await chamar(admin, "GET", `/log?titularId=${t2.titularId}&limite=100`));
    expect(lista.length).toBeGreaterThan(0);
    for (const i of lista) expect(i.titularId).toBe(t2.titularId);
  });
});

describe("o administrador não é identificado para quem não é admin", () => {
  it("troca de permissões feita pelo admin aparece como 'Administrador do sistema' para o titular", async () => {
    const paraTitular = itens(
      await chamar(t1, "GET", "/log?acao=permissao.alterada&limite=100"),
    );
    const linha = paraTitular.find((i) => i.usuarioId === admin.id);
    expect(linha?.usuario).toBe("Administrador do sistema");
    expect(JSON.stringify(paraTitular)).not.toContain(admin.email);
  });

  it("o próprio admin vê o e-mail real", async () => {
    const paraAdmin = itens(
      await chamar(admin, "GET", "/log?acao=permissao.alterada&limite=100"),
    );
    expect(paraAdmin.find((i) => i.usuarioId === admin.id)?.usuario).toBe(admin.email);
  });
});

describe("filtros", () => {
  it("por ação", async () => {
    const lista = itens(await chamar(t1, "GET", "/log?acao=login.falha&limite=100"));
    expect(lista.length).toBeGreaterThan(0);
    for (const i of lista) expect(i.acao).toBe("login.falha");
  });

  it("por usuário", async () => {
    const lista = itens(await chamar(t1, "GET", `/log?usuarioId=${v1.id}&limite=100`));
    expect(lista.length).toBeGreaterThan(0);
    for (const i of lista) expect(i.usuarioId).toBe(v1.id);
  });

  it("por período", async () => {
    const futuro = encodeURIComponent(new Date(Date.now() + 3600_000).toISOString());
    expect(itens(await chamar(t1, "GET", `/log?desde=${futuro}`))).toEqual([]);
    const passado = encodeURIComponent(new Date(Date.now() - 3600_000).toISOString());
    expect(itens(await chamar(t1, "GET", `/log?ate=${passado}`))).toEqual([]);
    expect(itens(await chamar(t1, "GET", `/log?ate=${futuro}`)).length).toBeGreaterThan(0);
  });

  it.each([
    ["limite zero", "limite=0"],
    ["limite acima do máximo", "limite=101"],
    ["limite que não é número", "limite=abc"],
    ["cursor inválido", "cursor=lixo"],
    [
      "cursor com conteúdo errado",
      `cursor=${Buffer.from('{"t":"x","i":"y"}').toString("base64url")}`,
    ],
    ["titularId que não é uuid", "titularId=1"],
    ["usuarioId que não é uuid", "usuarioId=1"],
    ["data inválida", "desde=ontem"],
  ])("recusa %s com 400", async (_nome, consulta) => {
    expect((await chamar(admin, "GET", `/log?${consulta}`)).statusCode).toBe(400);
  });
});

describe("paginação", () => {
  it("percorre tudo, sem repetir e sem perder, do mais recente ao mais antigo", async () => {
    const total = await totalNoBanco(t1.titularId);
    expect(total).toBeGreaterThanOrEqual(5);

    const vistos: Item[] = [];
    let cursor: string | null = null;
    let paginas = 0;
    do {
      const url: string = `/log?limite=2${cursor ? `&cursor=${cursor}` : ""}`;
      const res = await chamar(t1, "GET", url);
      expect(res.statusCode).toBe(200);
      vistos.push(...itens(res));
      cursor = res.json().proximo as string | null;
      paginas++;
      expect(paginas).toBeLessThan(200);
    } while (cursor);

    expect(vistos.length).toBe(total);
    expect(new Set(vistos.map((i) => i.id)).size).toBe(total);
    for (let k = 1; k < vistos.length; k++) {
      expect(new Date(vistos[k - 1]!.ocorridoEm).getTime()).toBeGreaterThanOrEqual(
        new Date(vistos[k]!.ocorridoEm).getTime(),
      );
    }
  });

  it("registro novo entre duas páginas não causa repetição", async () => {
    const primeira = await chamar(t1, "GET", "/log?limite=2");
    const cursor = primeira.json().proximo as string;
    // entra um registro novo (falha de login do t1) depois de a primeira página ser lida
    await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: t1.email, senha: "errada-123456" },
      remoteAddress: novoIp(),
    });
    const segunda = await chamar(t1, "GET", `/log?limite=100&cursor=${cursor}`);
    const ids = new Set([...itens(primeira), ...itens(segunda)].map((i) => i.id));
    expect(ids.size).toBe(itens(primeira).length + itens(segunda).length);
  });

  it("última página não devolve cursor", async () => {
    const res = await chamar(t1, "GET", "/log?limite=100");
    expect(res.json().proximo).toBeNull();
  });
});

describe("o log é somente leitura", () => {
  it("ler o log não grava nada no log", async () => {
    const antes = await totalNoBanco();
    await chamar(admin, "GET", "/log?limite=100");
    await chamar(t1, "GET", "/log?limite=100");
    expect(await totalNoBanco()).toBe(antes);
  });

  it.each(["POST", "PUT", "PATCH", "DELETE"] as const)(
    "não existe rota %s no log (404) e nada muda",
    async (metodo) => {
      const antes = await totalNoBanco();
      const res = await chamar(admin, metodo, "/log", { acao: "falsa" });
      expect(res.statusCode).toBe(404);
      const res2 = await chamar(admin, metodo, `/log/${randomUUID()}`, { acao: "falsa" });
      expect(res2.statusCode).toBe(404);
      expect(await totalNoBanco()).toBe(antes);
    },
  );

  it("a resposta não é guardada em cache e não traz segredos", async () => {
    const res = await chamar(admin, "GET", "/log?limite=100");
    expect(res.headers["cache-control"]).toBe("no-store");

    // Procura chaves sensíveis e valores que parecem hash ou token. (O valor "senha_incorreta"
    // é só o motivo de uma falha de login e não é um segredo.)
    const achados: string[] = [];
    const varrer = (v: unknown, caminho: string) => {
      if (typeof v === "string") {
        if (/argon2/i.test(v)) achados.push(`${caminho}: hash`);
        if (/^[A-Za-z0-9_-]{43}$/.test(v)) achados.push(`${caminho}: parece token`);
      } else if (Array.isArray(v)) {
        v.forEach((x, i) => varrer(x, `${caminho}[${i}]`));
      } else if (v && typeof v === "object") {
        for (const [k, x] of Object.entries(v)) {
          if (/senha|hash|token|csrf|secret/i.test(k)) achados.push(`${caminho}.${k}: chave sensível`);
          varrer(x, `${caminho}.${k}`);
        }
      }
    };
    varrer(res.json(), "resposta");
    expect(achados).toEqual([]);
  });
});
