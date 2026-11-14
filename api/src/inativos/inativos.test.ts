import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  chamar,
  criarAmbiente,
  entrar,
  SENHA,
  type Ambiente,
} from "../../test/ajudantes.js";

let env: Ambiente;

beforeAll(async () => {
  env = await criarAmbiente(77);
});
afterAll(async () => {
  await env.fechar();
});

const un = async (sql: string, params: unknown[] = []) =>
  (await env.owner.query(sql, params)).rows as Record<string, unknown>[];

async function categoria(titularId: string, ativa = true): Promise<string> {
  const r = await env.owner.query(
    `INSERT INTO categoria (titular_id, nome, tipo, natureza, nivel, ativo, inativado_em)
     VALUES ($1, $2, 'despesa', 'variavel', 1, $3, CASE WHEN $3 THEN NULL ELSE now() END)
     RETURNING id`,
    [titularId, `Cat ${randomUUID().slice(0, 8)}`, ativa],
  );
  return r.rows[0].id as string;
}

async function conta(titularId: string, ativa = true): Promise<string> {
  const r = await env.owner.query(
    `INSERT INTO conta (titular_id, nome, tipo, ativo, inativado_em)
     VALUES ($1, $2, 'carteira', $3, CASE WHEN $3 THEN NULL ELSE now() END) RETURNING id`,
    [titularId, `Conta ${randomUUID().slice(0, 8)}`, ativa],
  );
  return r.rows[0].id as string;
}

async function lancamento(
  titularId: string,
  o: { categoriaId: string; contaId: string; ativo?: boolean },
): Promise<string> {
  const ativo = o.ativo ?? true;
  const r = await env.owner.query(
    `INSERT INTO lancamento
       (titular_id, categoria_id, conta_id, valor, tipo, status, data, descricao, natureza, origem, ativo, inativado_em)
     VALUES ($1, $2, $3, 100, 'despesa', 'realizado', '2026-11-13', $4, 'variavel', 'manual', $5,
             CASE WHEN $5 THEN NULL ELSE now() END)
     RETURNING id`,
    [titularId, o.categoriaId, o.contaId, `L ${randomUUID().slice(0, 8)}`, ativo],
  );
  return r.rows[0].id as string;
}

function ids(lista: { id: string }[]): string[] {
  return lista.map((x) => x.id);
}

describe("GET /inativos", () => {
  it("sem login: 401", async () => {
    expect((await env.app.inject({ method: "GET", url: "/inativos" })).statusCode).toBe(401);
  });

  it("titular vê só os próprios registros inativos, com impedimento quando a reativação está bloqueada", async () => {
    const t = await entrar(env, { papel: "titular" });
    const outro = await entrar(env, { papel: "titular" });

    const catAtiva = await categoria(t.titularId, true);
    const catInativa = await categoria(t.titularId, false);
    const contaAtiva = await conta(t.titularId, true);
    const contaInativa = await conta(t.titularId, false);
    const lancOk = await lancamento(t.titularId, {
      categoriaId: catAtiva,
      contaId: contaAtiva,
      ativo: false,
    });
    const lancBloqueado = await lancamento(t.titularId, {
      categoriaId: catInativa,
      contaId: contaAtiva,
      ativo: false,
    });
    await lancamento(t.titularId, { categoriaId: catAtiva, contaId: contaAtiva, ativo: true });
    await lancamento(outro.titularId, {
      categoriaId: await categoria(outro.titularId, true),
      contaId: await conta(outro.titularId, true),
      ativo: false,
    });
    await categoria(outro.titularId, false);
    await conta(outro.titularId, false);

    const res = await chamar(env, t, "GET", "/inativos");
    expect(res.statusCode).toBe(200);
    const corpo = res.json() as {
      lancamentos: { id: string; impedimento: { codigo: string } | null }[];
      categorias: { id: string }[];
      contas: { id: string }[];
      usuarios: { id: string }[];
    };
    expect(ids(corpo.lancamentos).sort()).toEqual([lancBloqueado, lancOk].sort());
    expect(ids(corpo.categorias)).toEqual([catInativa]);
    expect(ids(corpo.contas)).toEqual([contaInativa]);
    expect(corpo.lancamentos.find((l) => l.id === lancOk)!.impedimento).toBeNull();
    expect(corpo.lancamentos.find((l) => l.id === lancBloqueado)!.impedimento).toMatchObject({
      codigo: "categoria_inativa",
    });
    expect(corpo.usuarios).toEqual([]);
  });

  it("vinculado só vê o módulo em que tem permissão de ver", async () => {
    const t = await entrar(env, { papel: "titular" });
    const cat = await categoria(t.titularId, false);
    const cta = await conta(t.titularId, false);
    const lanc = await lancamento(t.titularId, {
      categoriaId: await categoria(t.titularId, true),
      contaId: await conta(t.titularId, true),
      ativo: false,
    });
    const v = await entrar(env, {
      papel: "vinculado",
      titularId: t.titularId,
      permissoes: { lancamentos: { ver: true } },
    });
    const corpo = (await chamar(env, v, "GET", "/inativos")).json() as {
      lancamentos: { id: string }[];
      categorias: { id: string }[];
      contas: { id: string }[];
    };
    expect(ids(corpo.lancamentos)).toEqual([lanc]);
    expect(corpo.categorias).toEqual([]);
    expect(corpo.contas).toEqual([]);
    expect(ids(corpo.categorias)).not.toContain(cat);
    expect(ids(corpo.contas)).not.toContain(cta);
  });

  it("titular vê vinculados inativos; depois de reativar, o item some da lista", async () => {
    const t = await entrar(env, { papel: "titular" });
    const v = await entrar(env, { papel: "vinculado", titularId: t.titularId });
    expect((await chamar(env, t, "POST", `/usuarios/${v.id}/inativar`, { senha: SENHA })).statusCode).toBe(
      200,
    );
    const antes = (await chamar(env, t, "GET", "/inativos")).json() as { usuarios: { id: string }[] };
    expect(ids(antes.usuarios)).toEqual([v.id]);
    expect((await chamar(env, t, "POST", `/usuarios/${v.id}/reativar`, { senha: SENHA })).statusCode).toBe(
      200,
    );
    const depois = (await chamar(env, t, "GET", "/inativos")).json() as { usuarios: { id: string }[] };
    expect(depois.usuarios).toEqual([]);
  });
});

describe("GET /admin/inativos", () => {
  it("só o admin vê inativos de outro titular; titular e vinculado recebem 403", async () => {
    const alvo = await entrar(env, { papel: "titular" });
    const cat = await categoria(alvo.titularId, false);
    const admin = await entrar(env, { papel: "admin" });
    const titular = await entrar(env, { papel: "titular" });
    const vinculado = await entrar(env, { papel: "vinculado", titularId: alvo.titularId });

    const ok = await chamar(env, admin, "GET", `/admin/inativos?titularId=${alvo.titularId}`);
    expect(ok.statusCode).toBe(200);
    expect(ids(ok.json().categorias as { id: string }[])).toEqual([cat]);

    expect(
      (await chamar(env, titular, "GET", `/admin/inativos?titularId=${alvo.titularId}`)).statusCode,
    ).toBe(403);
    expect(
      (await chamar(env, vinculado, "GET", `/admin/inativos?titularId=${alvo.titularId}`)).statusCode,
    ).toBe(403);
    expect(
      (await env.app.inject({ method: "GET", url: `/admin/inativos?titularId=${alvo.titularId}` }))
        .statusCode,
    ).toBe(401);
  });

  it("sem titularId: 400. Titular inexistente: 404", async () => {
    const admin = await entrar(env, { papel: "admin" });
    expect((await chamar(env, admin, "GET", "/admin/inativos")).statusCode).toBe(400);
    expect(
      (await chamar(env, admin, "GET", `/admin/inativos?titularId=${randomUUID()}`)).statusCode,
    ).toBe(404);
  });
});

describe("POST /admin/:recurso/:id/reativar", () => {
  it("admin reativa lançamento, categoria e conta de outro titular; o log guarda o titular afetado", async () => {
    const alvo = await entrar(env, { papel: "titular" });
    const admin = await entrar(env, { papel: "admin" });
    const cat = await categoria(alvo.titularId, false);
    const cta = await conta(alvo.titularId, false);
    const catAtiva = await categoria(alvo.titularId, true);
    const ctaAtiva = await conta(alvo.titularId, true);
    const lanc = await lancamento(alvo.titularId, {
      categoriaId: catAtiva,
      contaId: ctaAtiva,
      ativo: false,
    });

    for (const [url, acao, id] of [
      [`/admin/lancamentos/${lanc}/reativar`, "lancamento.reativado", lanc],
      [`/admin/categorias/${cat}/reativar`, "categoria.reativada", cat],
      [`/admin/contas/${cta}/reativar`, "conta.reativada", cta],
    ] as const) {
      const res = await chamar(env, admin, "POST", url, { senha: SENHA });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json()).toEqual({ ativo: true });
      const [log] = await un(
        `SELECT titular_id, usuario_id, confirmado_por FROM log WHERE acao = $1 AND entidade_id = $2`,
        [acao, id],
      );
      expect(log).toMatchObject({
        titular_id: alvo.titularId,
        usuario_id: admin.id,
        confirmado_por: admin.id,
      });
    }
  });

  it("não reativa lançamento se a categoria ou a conta estiver inativa", async () => {
    const alvo = await entrar(env, { papel: "titular" });
    const admin = await entrar(env, { papel: "admin" });
    const catInativa = await categoria(alvo.titularId, false);
    const contaAtiva = await conta(alvo.titularId, true);
    const lancCat = await lancamento(alvo.titularId, {
      categoriaId: catInativa,
      contaId: contaAtiva,
      ativo: false,
    });
    const catAtiva = await categoria(alvo.titularId, true);
    const contaInativa = await conta(alvo.titularId, false);
    const lancConta = await lancamento(alvo.titularId, {
      categoriaId: catAtiva,
      contaId: contaInativa,
      ativo: false,
    });

    const a = await chamar(env, admin, "POST", `/admin/lancamentos/${lancCat}/reativar`, {
      senha: SENHA,
    });
    expect(a.statusCode).toBe(409);
    expect(a.json().codigo).toBe("categoria_inativa");
    const b = await chamar(env, admin, "POST", `/admin/lancamentos/${lancConta}/reativar`, {
      senha: SENHA,
    });
    expect(b.statusCode).toBe(409);
    expect(b.json().codigo).toBe("conta_inativa");
  });

  it("titular dono do registro, outro titular e vinculado: 403. Inexistente: 404", async () => {
    const dono = await entrar(env, { papel: "titular" });
    const outro = await entrar(env, { papel: "titular" });
    const admin = await entrar(env, { papel: "admin" });
    const cat = await categoria(dono.titularId, false);
    const v = await entrar(env, { papel: "vinculado", titularId: dono.titularId });
    expect(
      (await chamar(env, dono, "POST", `/admin/categorias/${cat}/reativar`, { senha: SENHA }))
        .statusCode,
    ).toBe(403);
    expect(
      (await chamar(env, outro, "POST", `/admin/categorias/${cat}/reativar`, { senha: SENHA }))
        .statusCode,
    ).toBe(403);
    expect(
      (await chamar(env, v, "POST", `/admin/categorias/${cat}/reativar`, { senha: SENHA })).statusCode,
    ).toBe(403);
    expect(
      (
        await chamar(env, admin, "POST", `/admin/categorias/${randomUUID()}/reativar`, {
          senha: SENHA,
        })
      ).statusCode,
    ).toBe(404);
  });
});
