import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import pg from "pg";
import { buildApp } from "../src/app.js";
import { MODULOS, type Acao } from "../src/auth/permissoes.js";
import { gerarHash } from "../src/auth/senha.js";
import { hashDoToken } from "../src/auth/sessao.js";
import { createDb, createPool } from "../src/db/client.js";
import { loadEnv, requireEnv } from "../src/env.js";

/** Apoio comum aos testes de integração: app real, banco de teste real, nenhum mock. */

export const SEGREDO = "segredo-de-teste-com-mais-de-trinta-e-dois-caracteres";
export const ORIGEM = "http://localhost:5173";
export const SENHA = "senha-correta-123";
export const COOKIE = "finan_sid";

export interface Sessao {
  cookie: string;
  csrf: string;
  ip: string;
}
export interface Logado extends Sessao {
  email: string;
  id: string;
  titularId: string;
}

export interface Ambiente {
  app: FastifyInstance;
  appPool: pg.Pool;
  owner: pg.Pool;
  hashDaSenha: string;
  novoIp(): string;
  novoEmail(): string;
  fechar(): Promise<void>;
}

/** `blocoIp` separa os IPs de cada arquivo de teste, para o limite por IP de um não afetar o outro. */
export async function criarAmbiente(blocoIp: number): Promise<Ambiente> {
  loadEnv();
  const appPool = createPool(requireEnv("TEST_DATABASE_URL"));
  const owner = new pg.Pool({ connectionString: requireEnv("TEST_MIGRATE_DATABASE_URL") });
  const app = buildApp({
    db: createDb(appPool),
    segredoSessao: SEGREDO,
    origemApp: ORIGEM,
    producao: false,
  });
  await app.ready();
  let seq = 0;
  return {
    app,
    appPool,
    owner,
    hashDaSenha: await gerarHash(SENHA),
    novoIp: () => `10.${blocoIp}.${Math.floor(++seq / 250)}.${(seq % 250) + 1}`,
    novoEmail: () => `t-${randomUUID()}@teste.com`,
    async fechar() {
      await app.close();
      await appPool.end();
      await owner.end();
    },
  };
}

type PermissoesParciais = Record<string, Partial<Record<Acao, boolean>>>;

/** Cria titular (se não informado) e usuário direto no banco. Não faz login. */
export async function inserirUsuario(
  env: Ambiente,
  o: {
    papel: "admin" | "titular" | "vinculado";
    titularId?: string;
    ativo?: boolean;
    titularAtivo?: boolean;
    permissoes?: PermissoesParciais;
  },
): Promise<{ id: string; email: string; titularId: string }> {
  const titularId =
    o.titularId ??
    ((
      await env.owner.query(
        `INSERT INTO titular (nome, ativo, inativado_em) VALUES ($1, $2, CASE WHEN $2 THEN NULL ELSE now() END) RETURNING id`,
        [`Titular ${randomUUID()}`, o.titularAtivo !== false],
      )
    ).rows[0].id as string);
  const email = env.novoEmail();
  const ativo = o.ativo !== false;
  const u = await env.owner.query(
    `INSERT INTO usuario (titular_id, email, senha_hash, papel, ativo, inativado_em)
     VALUES ($1, $2, $3, $4, $5, CASE WHEN $5 THEN NULL ELSE now() END) RETURNING id`,
    [titularId, email, env.hashDaSenha, o.papel, ativo],
  );
  const id = u.rows[0].id as string;
  if (o.papel === "vinculado") {
    for (const m of MODULOS) {
      const p = o.permissoes?.[m] ?? {};
      await env.owner.query(
        `INSERT INTO permissao (usuario_id, modulo, ver, cadastrar, alterar, excluir) VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, m, p.ver === true, p.cadastrar === true, p.alterar === true, p.excluir === true],
      );
    }
  }
  return { id, email, titularId };
}

export async function logar(
  env: Ambiente,
  email: string,
  senha = SENHA,
): Promise<Sessao & { email: string }> {
  const ip = env.novoIp();
  const res = await env.app.inject({
    method: "POST",
    url: "/auth/login",
    payload: { email, senha },
    remoteAddress: ip,
  });
  if (res.statusCode !== 200) throw new Error(`login falhou (${res.statusCode}) para ${email}`);
  return {
    cookie: res.cookies.find((c) => c.name === COOKIE)!.value,
    csrf: res.json().csrfToken as string,
    ip,
    email,
  };
}

/** Cria um usuário ativo e já faz login de verdade. */
export async function entrar(
  env: Ambiente,
  o: Parameters<typeof inserirUsuario>[1],
): Promise<Logado> {
  const u = await inserirUsuario(env, o);
  return { ...(await logar(env, u.email)), id: u.id, titularId: u.titularId };
}

export function chamar(
  env: Ambiente,
  quem: Sessao,
  metodo: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  url: string,
  payload?: unknown,
  semCsrf = false,
) {
  return env.app.inject({
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

/** Insere um convite direto no banco e devolve o token (o banco guarda só o hash dele). */
export async function inserirConvite(
  env: Ambiente,
  o: {
    criadoPor: string;
    papel?: "titular" | "vinculado";
    titularId?: string;
    email?: string;
    expiraEmMs?: number;
  },
): Promise<{ id: string; token: string; email: string }> {
  const token = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "").slice(0, 12);
  const email = o.email ?? env.novoEmail();
  const papel = o.papel ?? "titular";
  const r = await env.owner.query(
    `INSERT INTO convite (email, papel, nome_titular, titular_id, permissoes, token_hash, expira_em, criado_por)
     VALUES ($1, $2, 'Casa', $3, $4, $5, now() + ($6 || ' milliseconds')::interval, $7) RETURNING id`,
    [
      email,
      papel,
      papel === "vinculado" ? o.titularId : null,
      papel === "vinculado" ? JSON.stringify({}) : null,
      hashDoToken(token, SEGREDO),
      String(o.expiraEmMs ?? 3_600_000),
      o.criadoPor,
    ],
  );
  return { id: r.rows[0].id as string, token, email };
}

export async function contar(env: Ambiente, sql: string, params: unknown[] = []): Promise<number> {
  return (await env.owner.query(sql, params)).rowCount ?? 0;
}
