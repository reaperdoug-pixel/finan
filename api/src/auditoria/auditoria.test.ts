import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { criarPrimeiroAdmin } from "../admin/primeiro-admin.js";
import { buildApp } from "../app.js";
import { MAX_FALHAS_POR_EMAIL } from "../auth/limite.js";
import { createDb, createPool } from "../db/client.js";
import { loadEnv, requireEnv } from "../env.js";
import { ACOES_LOG, TODAS_AS_ACOES } from "../log-acoes.js";

loadEnv();

const SEGREDO = "segredo-de-teste-com-mais-de-trinta-e-dois-caracteres";
const ORIGEM = "http://localhost:5173";
const SENHAS = {
  admin: "senha-do-admin-123",
  titular: "senha-do-titular-123",
  vinculado: "senha-do-vinculado-123",
  redefinida: "senha-redefinida-123",
  errada: "senha-errada-1234",
};
const COOKIE = "finan_sid";

let appPool: pg.Pool;
let owner: pg.Pool;
let app: FastifyInstance;
let inicio: Date;
let seqIp = 0;
const novoIp = () => `10.60.${Math.floor(++seqIp / 250)}.${(seqIp % 250) + 1}`;
const novoEmail = () => `aud-${randomUUID()}@teste.com`;

interface Sessao {
  cookie: string;
  csrf: string;
  ip: string;
}

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

  // O primeiro admin só pode ser criado quando não há nenhum: parte de um banco sem admin.
  await owner.query(
    `DELETE FROM sessao WHERE usuario_id IN (SELECT id FROM usuario WHERE papel = 'admin')`,
  );
  await owner.query(`DELETE FROM usuario WHERE papel = 'admin'`);

  inicio = (await owner.query(`SELECT clock_timestamp() AS t`)).rows[0].t as Date;
  await percorrerOSistema();
});

afterAll(async () => {
  await app.close();
  await appPool.end();
  await owner.end();
});

function login(email: string, senha: string, ip = novoIp()) {
  return app.inject({
    method: "POST",
    url: "/auth/login",
    payload: { email, senha },
    remoteAddress: ip,
  });
}

async function logar(email: string, senha: string): Promise<Sessao> {
  const ip = novoIp();
  const res = await login(email, senha, ip);
  expect(res.statusCode).toBe(200);
  return {
    cookie: res.cookies.find((c) => c.name === COOKIE)!.value,
    csrf: res.json().csrfToken as string,
    ip,
  };
}

function chamar(s: Sessao, metodo: "POST" | "PUT" | "PATCH", url: string, payload: unknown) {
  return app.inject({
    method: metodo,
    url,
    payload: payload as object,
    remoteAddress: s.ip,
    headers: { cookie: `${COOKIE}=${s.cookie}`, "x-csrf-token": s.csrf },
  });
}

const tokenDoLink = (res: { json: () => { link: string } }) => res.json().link.split("/convite/")[1]!;

async function aceitar(token: string, senha: string) {
  const res = await app.inject({
    method: "POST",
    url: `/convites/${token}/aceitar`,
    payload: { senha },
    remoteAddress: novoIp(),
  });
  expect(res.statusCode).toBe(201);
}

/** Percorre o sistema pela API de verdade, passando por todas as operações que escrevem. */
async function percorrerOSistema(): Promise<void> {
  // admin.criado (comando no servidor) + login.sucesso
  const adminEmail = novoEmail();
  await criarPrimeiroAdmin(createDb(appPool), {
    email: adminEmail,
    nomeTitular: "Sistema",
    senha: SENHAS.admin,
  });
  const admin = await logar(adminEmail, SENHAS.admin);

  // login.falha com e-mail desconhecido (sem usuário nem titular)
  await login(novoEmail(), SENHAS.errada);

  // login.bloqueado: falhas demais no mesmo e-mail, depois mais uma tentativa
  const alvoBloqueio = novoEmail();
  const ipBloqueio = novoIp();
  for (let i = 0; i < MAX_FALHAS_POR_EMAIL; i++) await login(alvoBloqueio, SENHAS.errada, ipBloqueio);
  expect((await login(alvoBloqueio, SENHAS.errada, ipBloqueio)).statusCode).toBe(429);

  // convite.criado + convite.aceito (titular A) e reautenticacao.falha/.bloqueada
  const emailA = novoEmail();
  const convA = await chamar(admin, "POST", "/admin/convites", { email: emailA, nomeTitular: "Casa A" });
  expect(convA.statusCode).toBe(201);
  await aceitar(tokenDoLink(convA), SENHAS.titular);
  const a = await logar(emailA, SENHAS.titular);
  for (let i = 0; i < MAX_FALHAS_POR_EMAIL; i++) {
    const r = await chamar(a, "POST", "/usuarios/convites", {
      email: novoEmail(),
      permissoes: {},
      senha: SENHAS.errada,
    });
    expect(r.statusCode).toBe(403);
  }
  const barrado = await chamar(a, "POST", "/usuarios/convites", {
    email: novoEmail(),
    permissoes: {},
    senha: SENHAS.titular,
  });
  expect(barrado.statusCode).toBe(429);

  // titular B: convida um vinculado, o vinculado aceita, B muda as permissões e sai (logout)
  const emailB = novoEmail();
  const convB = await chamar(admin, "POST", "/admin/convites", { email: emailB, nomeTitular: "Casa B" });
  await aceitar(tokenDoLink(convB), SENHAS.titular);
  const b = await logar(emailB, SENHAS.titular);
  const emailV = novoEmail();
  const convV = await chamar(b, "POST", "/usuarios/convites", {
    email: emailV,
    permissoes: { contas: { ver: true } },
    senha: SENHAS.titular,
  });
  expect(convV.statusCode).toBe(201);
  await aceitar(tokenDoLink(convV), SENHAS.vinculado);
  const idV = (await owner.query(`SELECT id FROM usuario WHERE lower(email) = $1`, [emailV])).rows[0].id;
  const alt = await chamar(b, "PUT", `/usuarios/${idV}/permissoes`, {
    permissoes: { contas: { ver: true, cadastrar: true } },
    senha: SENHAS.titular,
  });
  expect(alt.statusCode).toBe(200);
  expect((await chamar(b, "POST", "/auth/logout", {})).statusCode).toBe(204);

  // Ciclo de vida, feito pelo admin (cada operação pede a senha dele): inativar e reativar um
  // usuário e um titular, convidar e revogar o convite, e gerar e concluir uma redefinição de senha.
  const confirma = { senha: SENHAS.admin };
  expect((await chamar(admin, "POST", `/usuarios/${idV}/inativar`, confirma)).statusCode).toBe(200);
  expect((await chamar(admin, "POST", `/usuarios/${idV}/reativar`, confirma)).statusCode).toBe(200);

  const idTitularA = (
    await owner.query(`SELECT titular_id FROM usuario WHERE lower(email) = $1`, [emailA])
  ).rows[0].titular_id as string;
  const inativaA = await chamar(admin, "POST", `/admin/titulares/${idTitularA}/inativar`, confirma);
  expect(inativaA.statusCode).toBe(200);
  const reativaA = await chamar(admin, "POST", `/admin/titulares/${idTitularA}/reativar`, confirma);
  expect(reativaA.statusCode).toBe(200);

  const convX = await chamar(admin, "POST", "/admin/convites", {
    email: novoEmail(),
    nomeTitular: "Casa X",
  });
  expect(convX.statusCode).toBe(201);
  const revoga = await chamar(admin, "POST", `/admin/convites/${convX.json().id}/revogar`, confirma);
  expect(revoga.statusCode).toBe(200);

  const redef = await chamar(admin, "POST", `/admin/usuarios/${idV}/redefinicao`, confirma);
  expect(redef.statusCode).toBe(201);
  const tokenRedefinicao = (redef.json().link as string).split("/redefinicao/")[1]!;
  const concluida = await app.inject({
    method: "POST",
    url: `/redefinicao/${tokenRedefinicao}`,
    payload: { senha: SENHAS.redefinida },
    remoteAddress: novoIp(),
  });
  expect(concluida.statusCode).toBe(200);

  // Categorias (a árvore padrão do admin já nasceu com ele): criar, alterar, inativar e reativar.
  const nova = await chamar(admin, "POST", "/categorias", { nome: "Pets", tipo: "despesa" });
  expect(nova.statusCode).toBe(201);
  const idCategoria = nova.json().id as string;
  const renomeada = await chamar(admin, "PATCH", `/categorias/${idCategoria}`, { nome: "Animais" });
  expect(renomeada.statusCode).toBe(200);
  const inativada = await chamar(admin, "POST", `/categorias/${idCategoria}/inativar`, confirma);
  expect(inativada.statusCode).toBe(200);
  const reativada = await chamar(admin, "POST", `/categorias/${idCategoria}/reativar`, confirma);
  expect(reativada.statusCode).toBe(200);

  const novaConta = await chamar(admin, "POST", "/contas", { nome: "Carteira", tipo: "carteira" });
  expect(novaConta.statusCode).toBe(201);
  const idConta = novaConta.json().id as string;
  const contaRenomeada = await chamar(admin, "PATCH", `/contas/${idConta}`, { nome: "Carteira principal" });
  expect(contaRenomeada.statusCode).toBe(200);
  expect((await chamar(admin, "POST", `/contas/${idConta}/inativar`, confirma)).statusCode).toBe(200);
  expect((await chamar(admin, "POST", `/contas/${idConta}/reativar`, confirma)).statusCode).toBe(200);

  const novoContato = await chamar(admin, "POST", "/contatos", {
    nome: "Energia SA",
    tipo: "pj",
    papel: "fornecedor",
  });
  expect(novoContato.statusCode).toBe(201);
  const idContato = novoContato.json().id as string;
  expect((await chamar(admin, "PATCH", `/contatos/${idContato}`, { nome: "CPFL Energia" })).statusCode).toBe(
    200,
  );
  expect((await chamar(admin, "POST", `/contatos/${idContato}/inativar`, confirma)).statusCode).toBe(200);
  expect((await chamar(admin, "POST", `/contatos/${idContato}/reativar`, confirma)).statusCode).toBe(200);

  const lanc = await chamar(admin, "POST", "/lancamentos", {
    categoriaId: idCategoria,
    contaId: idConta,
    valor: 1500,
    data: "2026-11-13",
    descricao: "Ração",
  });
  expect(lanc.statusCode).toBe(201);
  const idLanc = lanc.json().id as string;
  expect((await chamar(admin, "PATCH", `/lancamentos/${idLanc}`, { valor: 1800 })).statusCode).toBe(
    200,
  );
  expect((await chamar(admin, "POST", `/lancamentos/${idLanc}/inativar`, confirma)).statusCode).toBe(
    200,
  );
  expect((await chamar(admin, "POST", `/lancamentos/${idLanc}/reativar`, confirma)).statusCode).toBe(
    200,
  );

  // Troca da própria senha e volta à anterior (a sessão atual do admin é mantida).
  const senhaNova = "uma-senha-nova-bem-longa-9";
  const troca = await chamar(admin, "POST", "/auth/senha", { senha: SENHAS.admin, novaSenha: senhaNova });
  expect(troca.statusCode).toBe(200);
  const volta = await chamar(admin, "POST", "/auth/senha", { senha: senhaNova, novaSenha: SENHAS.admin });
  expect(volta.statusCode).toBe(200);
}

interface Linha {
  id: string;
  ocorrido_em: Date;
  usuario_id: string | null;
  titular_id: string | null;
  acao: string;
  entidade: string | null;
  entidade_id: string | null;
  ip: string | null;
  antes: unknown;
  depois: unknown;
  confirmado_por: string | null;
}

async function linhasDoFluxo(): Promise<Linha[]> {
  const r = await owner.query(`SELECT * FROM log WHERE ocorrido_em >= $1 ORDER BY ocorrido_em`, [
    inicio,
  ]);
  return r.rows as Linha[];
}

describe("cobertura do catálogo de ações", () => {
  it("o fluxo completo gera TODAS as ações do catálogo", async () => {
    const geradas = new Set((await linhasDoFluxo()).map((l) => l.acao));
    const faltando = TODAS_AS_ACOES.filter((a) => !geradas.has(a));
    expect(faltando).toEqual([]);
  });

  it("nenhuma ação fora do catálogo foi gravada", async () => {
    const fora = (await linhasDoFluxo()).filter((l) => !(TODAS_AS_ACOES as readonly string[]).includes(l.acao));
    expect(fora).toEqual([]);
  });

  it("os nomes seguem o padrão 'assunto' ou 'assunto.acao' em minúsculas", () => {
    for (const a of TODAS_AS_ACOES) expect(a).toMatch(/^[a-z]+(\.[a-z]+)?$/);
    expect(new Set(TODAS_AS_ACOES).size).toBe(Object.keys(ACOES_LOG).length);
  });
});

describe("invariantes de cada registro", () => {
  it("todo registro tem IP", async () => {
    for (const l of await linhasDoFluxo()) {
      expect(l.ip, `${l.acao} sem IP`).not.toBeNull();
      expect(l.ip).toMatch(/^([0-9a-f.:]+|cli)$/);
    }
  });

  it("todo registro de ação de usuário tem quem fez e de qual titular", async () => {
    for (const l of await linhasDoFluxo()) {
      const semAtor =
        l.acao === ACOES_LOG.loginBloqueado ||
        (l.acao === ACOES_LOG.loginFalha &&
          (l.depois as { motivo?: string } | null)?.motivo === "usuario_inexistente");
      if (semAtor) continue;
      expect(l.usuario_id, `${l.acao} sem usuário`).not.toBeNull();
      expect(l.titular_id, `${l.acao} sem titular`).not.toBeNull();
    }
  });

  it("o horário vem do banco e está dentro da janela do teste", async () => {
    const fim = Date.now() + 2000;
    for (const l of await linhasDoFluxo()) {
      expect(l.ocorrido_em.getTime()).toBeGreaterThanOrEqual(inicio.getTime());
      expect(l.ocorrido_em.getTime()).toBeLessThanOrEqual(fim);
    }
  });

  it("escritas de negócio dizem qual entidade mudou", async () => {
    const escritas: string[] = [
      ACOES_LOG.adminCriado,
      ACOES_LOG.conviteCriado,
      ACOES_LOG.conviteAceito,
      ACOES_LOG.permissaoAlterada,
    ];
    for (const l of (await linhasDoFluxo()).filter((x) => escritas.includes(x.acao))) {
      expect(l.entidade, `${l.acao} sem entidade`).not.toBeNull();
      expect(l.entidade_id, `${l.acao} sem entidade_id`).not.toBeNull();
    }
  });

  it("troca de permissões guarda antes, depois e quem confirmou com a senha", async () => {
    const l = (await linhasDoFluxo()).find((x) => x.acao === ACOES_LOG.permissaoAlterada)!;
    expect(l.antes).not.toBeNull();
    expect(l.depois).not.toBeNull();
    expect(l.confirmado_por).toBe(l.usuario_id);
  });

  it("convite de vinculado (que exige senha) guarda quem confirmou", async () => {
    const convites = (await linhasDoFluxo()).filter(
      (x) => x.acao === ACOES_LOG.conviteCriado && (x.depois as { papel?: string }).papel === "vinculado",
    );
    expect(convites.length).toBeGreaterThan(0);
    for (const l of convites) expect(l.confirmado_por).toBe(l.usuario_id);
  });

  it("nenhum segredo vai para o log (senhas, hashes, tokens)", async () => {
    const achados: string[] = [];
    const varrer = (v: unknown, caminho: string) => {
      if (typeof v === "string") {
        if (Object.values(SENHAS).some((s) => v.includes(s))) achados.push(`${caminho}: senha`);
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
    for (const l of await linhasDoFluxo()) {
      varrer(l.antes, `${l.acao}.antes`);
      varrer(l.depois, `${l.acao}.depois`);
      expect(l.entidade_id ?? "").not.toMatch(/^[A-Za-z0-9_-]{43}$/);
    }
    expect(achados).toEqual([]);
  });
});

describe("carimbo de hora no banco (ninguém grava data falsa)", () => {
  const dentroDeAgora = (d: Date) => Math.abs(d.getTime() - Date.now()) < 10_000;

  it.each([
    ["retroativa", "2001-01-01T00:00:00Z"],
    ["futura", "2999-01-01T00:00:00Z"],
  ])("a API tenta gravar data %s e o banco usa a hora real", async (_nome, data) => {
    const r = await appPool.query(
      `INSERT INTO log (acao, ip, ocorrido_em) VALUES ('teste.carimbo', '127.0.0.1', $1) RETURNING ocorrido_em`,
      [data],
    );
    expect(dentroDeAgora(r.rows[0].ocorrido_em)).toBe(true);
  });

  it("nem o dono do banco consegue gravar com data falsa", async () => {
    const r = await owner.query(
      `INSERT INTO log (acao, ip, ocorrido_em) VALUES ('teste.carimbo', '127.0.0.1', '2001-01-01') RETURNING ocorrido_em`,
    );
    expect(dentroDeAgora(r.rows[0].ocorrido_em)).toBe(true);
  });
});

describe("a tabela de log não pode ser contornada pelo papel da API", () => {
  async function codigo(pool: pg.Pool, sql: string) {
    try {
      await pool.query(sql);
      return null;
    } catch (e) {
      return (e as { code?: string }).code ?? "desconhecido";
    }
  }

  it.each([
    ["alterar linhas", `UPDATE log SET acao = 'x'`],
    ["apagar linhas", `DELETE FROM log`],
    ["esvaziar a tabela", `TRUNCATE log`],
    ["desligar os gatilhos", `ALTER TABLE log DISABLE TRIGGER ALL`],
    ["remover o gatilho de imutabilidade", `DROP TRIGGER log_sem_alterar_ou_apagar ON log`],
    ["remover o gatilho do carimbo", `DROP TRIGGER log_carimbo_hora ON log`],
    ["trocar a função de imutabilidade", `CREATE OR REPLACE FUNCTION log_imutavel() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$`],
    ["apagar a tabela", `DROP TABLE log`],
    ["alterar a tabela", `ALTER TABLE log ADD COLUMN x int`],
  ])("a API não consegue %s", async (_nome, sql) => {
    expect(await codigo(appPool, sql)).toBe("42501");
  });

  it("a API não consegue dar permissão a si mesma (o GRANT não tem efeito)", async () => {
    // O PostgreSQL só emite um aviso quando quem não é dono tenta conceder; o que importa
    // é que nada foi concedido de fato.
    await codigo(appPool, `GRANT ALL ON log TO finan_app`);
    expect(await codigo(appPool, `UPDATE log SET acao = acao`)).toBe("42501");
    expect(await codigo(appPool, `DELETE FROM log`)).toBe("42501");
    const privilegios = await owner.query(
      `SELECT privilege_type FROM information_schema.role_table_grants
        WHERE table_name = 'log' AND grantee = 'finan_app' ORDER BY 1`,
    );
    expect(privilegios.rows.map((r) => r.privilege_type)).toEqual(["INSERT", "SELECT"]);
  });

  it("ninguém desliga os gatilhos pela via 'replication role'", async () => {
    expect(await codigo(appPool, `SET session_replication_role = replica`)).toBe("42501");
    expect(await codigo(owner, `SET session_replication_role = replica`)).toBe("42501");
  });

  it("todas as linhas continuam intactas depois das tentativas", async () => {
    expect((await linhasDoFluxo()).length).toBeGreaterThan(0);
    for (const acao of ["login.sucesso", "convite.criado", "permissao.alterada"]) {
      const r = await owner.query(`SELECT 1 FROM log WHERE acao = $1`, [acao]);
      expect(r.rowCount, acao).toBeGreaterThan(0);
    }
  });
});
