import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  chamar,
  criarAmbiente,
  entrar,
  inserirUsuario,
  SENHA,
  type Ambiente,
  type Logado,
} from "../../test/ajudantes.js";
import { criarConta } from "./servico.js";
import { createDb } from "../db/client.js";

let env: Ambiente;

beforeAll(async () => {
  env = await criarAmbiente(75);
});
afterAll(async () => {
  await env.fechar();
});

const un = async (sql: string, params: unknown[] = []) =>
  (await env.owner.query(sql, params)).rows as Record<string, unknown>[];

const nomeUnico = (p = "Conta") => `${p} ${randomUUID().slice(0, 8)}`;

interface Conta {
  id: string;
  nome: string;
  tipo: "carteira" | "banco" | "cartao";
  saldoInicial: number;
  saldo: number;
  ativo: boolean;
}

const post = (q: Logado, corpo: object) => chamar(env, q, "POST", "/contas", corpo);

async function criar(q: Logado, corpo: object): Promise<Conta> {
  const res = await post(q, corpo);
  expect(res.statusCode, res.body).toBe(201);
  return res.json() as Conta;
}

const carteira = (q: Logado, extra: object = {}) =>
  criar(q, { nome: nomeUnico("Carteira"), tipo: "carteira", ...extra });

const inativar = (q: Logado, id: string, senha: string | undefined = SENHA) =>
  chamar(env, q, "POST", `/contas/${id}/inativar`, senha === undefined ? {} : { senha });
const reativar = (q: Logado, id: string, senha: string | undefined = SENHA) =>
  chamar(env, q, "POST", `/contas/${id}/reativar`, senha === undefined ? {} : { senha });

const estado = async (id: string) =>
  (await un(
    `SELECT ativo, nome, tipo, saldo_inicial, inativado_em, inativado_por FROM conta WHERE id = $1`,
    [id],
  ))[0]!;

const listar = (q: Logado, qs = "") => chamar(env, q, "GET", `/contas${qs}`);

/** Insere um lançamento mínimo direto no banco (a tarefa 11 traz as rotas). */
async function lancamento(
  titularId: string,
  contaId: string,
  o: {
    valor: number;
    tipo?: "receita" | "despesa";
    status?: "previsto" | "realizado";
    ativo?: boolean;
  },
) {
  const cat = await env.owner.query(
    `INSERT INTO categoria (titular_id, nome, tipo, natureza, nivel)
     VALUES ($1, $2, 'despesa', 'variavel', 1) RETURNING id`,
    [titularId, `Cat ${randomUUID().slice(0, 8)}`],
  );
  const ativo = o.ativo ?? true;
  await env.owner.query(
    `INSERT INTO lancamento
       (titular_id, categoria_id, conta_id, valor, tipo, status, data, descricao, natureza, origem, ativo, inativado_em)
     VALUES ($1, $2, $3, $4, $5, $6, '2026-01-15', 'saldo', 'variavel', 'manual', $7,
             CASE WHEN $7 THEN NULL ELSE now() END)`,
    [
      titularId,
      cat.rows[0].id,
      contaId,
      o.valor,
      o.tipo ?? "despesa",
      o.status ?? "realizado",
      ativo,
    ],
  );
}

describe("criar conta", () => {
  it("guarda no titular de quem criou, saldo inicial 0 por padrão, e vai para o log", async () => {
    const t = await entrar(env, { papel: "titular" });
    const nome = nomeUnico();
    const c = await criar(t, { nome: `  ${nome}  `, tipo: "banco" });
    expect(c).toMatchObject({
      nome,
      tipo: "banco",
      saldoInicial: 0,
      saldo: 0,
      ativo: true,
    });
    const [linha] = await un(`SELECT titular_id, criado_por, saldo_inicial FROM conta WHERE id = $1`, [
      c.id,
    ]);
    expect(linha).toEqual({ titular_id: t.titularId, criado_por: t.id, saldo_inicial: 0 });
    const [l] = await un(`SELECT * FROM log WHERE acao = 'conta.criada' AND entidade_id = $1`, [c.id]);
    expect(l).toMatchObject({
      usuario_id: t.id,
      titular_id: t.titularId,
      entidade: "conta",
    });
    expect(l!.depois).toMatchObject({ nome, tipo: "banco", saldoInicial: 0 });
  });

  it.each(["carteira", "banco", "cartao"] as const)("aceita o tipo %s", async (tipo) => {
    const t = await entrar(env, { papel: "titular" });
    const c = await criar(t, { nome: nomeUnico(tipo), tipo });
    expect(c.tipo).toBe(tipo);
  });

  it("aceita saldo inicial positivo ou negativo (em centavos)", async () => {
    const t = await entrar(env, { papel: "titular" });
    const positiva = await criar(t, { nome: nomeUnico(), tipo: "carteira", saldoInicial: 15050 });
    const negativa = await criar(t, { nome: nomeUnico(), tipo: "banco", saldoInicial: -2000 });
    expect(positiva).toMatchObject({ saldoInicial: 15050, saldo: 15050 });
    expect(negativa).toMatchObject({ saldoInicial: -2000, saldo: -2000 });
  });

  it("sem nome, tipo inválido, saldo não inteiro ou fora do limite: 400 e nada é criado", async () => {
    const t = await entrar(env, { papel: "titular" });
    expect((await post(t, { tipo: "carteira" })).statusCode).toBe(400);
    expect((await post(t, { nome: nomeUnico(), tipo: "poupanca" })).statusCode).toBe(400);
    expect((await post(t, { nome: nomeUnico(), tipo: "carteira", saldoInicial: 10.5 })).statusCode).toBe(
      400,
    );
    expect(
      (await post(t, { nome: nomeUnico(), tipo: "carteira", saldoInicial: 2_147_483_648 })).statusCode,
    ).toBe(400);
    expect(
      (await post(t, { nome: nomeUnico(), tipo: "carteira", saldoInicial: -2_147_483_649 })).statusCode,
    ).toBe(400);
    expect((await un(`SELECT 1 FROM conta WHERE titular_id = $1`, [t.titularId])).length).toBe(0);
  });

  it("nome repetido entre contas ativas do titular: 409 (sem diferenciar maiúsculas nem espaços)", async () => {
    const t = await entrar(env, { papel: "titular" });
    await criar(t, { nome: "Nubank", tipo: "banco" });
    const res = await post(t, { nome: "  nubank  ", tipo: "carteira" });
    expect(res.statusCode).toBe(409);
    expect(res.json().codigo).toBe("nome_duplicado");
  });

  it("o mesmo nome pode existir em outro titular, e depois de inativar a primeira", async () => {
    const a = await entrar(env, { papel: "titular" });
    const b = await entrar(env, { papel: "titular" });
    const c = await criar(a, { nome: "Itaú", tipo: "banco" });
    expect((await post(b, { nome: "Itaú", tipo: "banco" })).statusCode).toBe(201);
    await inativar(a, c.id);
    expect((await post(a, { nome: "Itaú", tipo: "banco" })).statusCode).toBe(201);
  });
});

describe("listar e saldo", () => {
  it("saldo = saldo inicial + receitas realizadas − despesas realizadas", async () => {
    const t = await entrar(env, { papel: "titular" });
    const c = await criar(t, { nome: nomeUnico(), tipo: "carteira", saldoInicial: 10_000 });
    await lancamento(t.titularId, c.id, { valor: 5_000, tipo: "receita", status: "realizado" });
    await lancamento(t.titularId, c.id, { valor: 1_500, tipo: "despesa", status: "realizado" });
    const lista = (await listar(t)).json().contas as Conta[];
    expect(lista).toHaveLength(1);
    expect(lista[0]).toMatchObject({ id: c.id, saldoInicial: 10_000, saldo: 13_500 });
  });

  it("previstos e lançamentos inativos não entram no saldo", async () => {
    const t = await entrar(env, { papel: "titular" });
    const c = await criar(t, { nome: nomeUnico(), tipo: "banco", saldoInicial: 1_000 });
    await lancamento(t.titularId, c.id, { valor: 9_000, tipo: "receita", status: "previsto" });
    await lancamento(t.titularId, c.id, {
      valor: 4_000,
      tipo: "despesa",
      status: "realizado",
      ativo: false,
    });
    expect(((await listar(t)).json().contas as Conta[])[0]!.saldo).toBe(1_000);
  });

  it("lançamento de outra conta do mesmo titular não altera este saldo", async () => {
    const t = await entrar(env, { papel: "titular" });
    const a = await carteira(t, { saldoInicial: 100 });
    const b = await carteira(t, { saldoInicial: 0 });
    await lancamento(t.titularId, b.id, { valor: 50, tipo: "receita" });
    const lista = (await listar(t)).json().contas as Conta[];
    expect(lista.find((x) => x.id === a.id)!.saldo).toBe(100);
    expect(lista.find((x) => x.id === b.id)!.saldo).toBe(50);
  });

  it("esconde inativas por padrão e as mostra se pedido; ordena por nome", async () => {
    const t = await entrar(env, { papel: "titular" });
    const zebra = await criar(t, { nome: "Zebra", tipo: "carteira" });
    await criar(t, { nome: "Abc", tipo: "banco" });
    await inativar(t, zebra.id);
    const ativas = (await listar(t)).json().contas as Conta[];
    expect(ativas.map((c) => c.nome)).toEqual(["Abc"]);
    const todas = (await listar(t, "?incluirInativas=true")).json().contas as Conta[];
    expect(todas.map((c) => c.nome)).toEqual(["Abc", "Zebra"]);
    expect(todas.find((c) => c.id === zebra.id)!.ativo).toBe(false);
  });

  it("cada titular vê só as suas", async () => {
    const a = await entrar(env, { papel: "titular" });
    const b = await entrar(env, { papel: "titular" });
    const ca = await carteira(a);
    await carteira(b);
    const ids = ((await listar(a)).json().contas as Conta[]).map((c) => c.id);
    expect(ids).toEqual([ca.id]);
  });

  it("parâmetro inválido: 400. Sem login: 401", async () => {
    const t = await entrar(env, { papel: "titular" });
    expect((await listar(t, "?incluirInativas=talvez")).statusCode).toBe(400);
    expect((await env.app.inject({ method: "GET", url: "/contas" })).statusCode).toBe(401);
  });
});

describe("alterar conta", () => {
  it("renomeia, muda tipo e saldo inicial; o log guarda só o que mudou", async () => {
    const t = await entrar(env, { papel: "titular" });
    const c = await criar(t, { nome: nomeUnico(), tipo: "carteira", saldoInicial: 0 });
    const novoNome = nomeUnico("Outro");
    const res = await chamar(env, t, "PATCH", `/contas/${c.id}`, {
      nome: novoNome,
      tipo: "banco",
      saldoInicial: 500,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ nome: novoNome, tipo: "banco", saldoInicial: 500, saldo: 500 });
    const [l] = await un(`SELECT antes, depois FROM log WHERE acao = 'conta.alterada' AND entidade_id = $1`, [
      c.id,
    ]);
    expect(l!.antes).toEqual({ nome: c.nome, tipo: "carteira", saldoInicial: 0 });
    expect(l!.depois).toEqual({ nome: novoNome, tipo: "banco", saldoInicial: 500 });
  });

  it("sem mudança real: 200 e nada é registrado", async () => {
    const t = await entrar(env, { papel: "titular" });
    const c = await carteira(t);
    const antes = (await un(`SELECT count(*)::int AS n FROM log WHERE entidade_id = $1`, [c.id]))[0]!.n;
    const res = await chamar(env, t, "PATCH", `/contas/${c.id}`, { nome: c.nome });
    expect(res.statusCode).toBe(200);
    const depois = (await un(`SELECT count(*)::int AS n FROM log WHERE entidade_id = $1`, [c.id]))[0]!.n;
    expect(depois).toBe(antes);
  });

  it("corpo vazio, campo desconhecido ou saldo não inteiro: 400 e nada muda", async () => {
    const t = await entrar(env, { papel: "titular" });
    const c = await carteira(t);
    expect((await chamar(env, t, "PATCH", `/contas/${c.id}`, {})).statusCode).toBe(400);
    expect((await chamar(env, t, "PATCH", `/contas/${c.id}`, { limite: 1 })).statusCode).toBe(400);
    expect((await chamar(env, t, "PATCH", `/contas/${c.id}`, { saldoInicial: 1.1 })).statusCode).toBe(400);
    expect((await estado(c.id)).nome).toBe(c.nome);
  });

  it("nome já usado por outra conta ativa: 409", async () => {
    const t = await entrar(env, { papel: "titular" });
    await criar(t, { nome: "Principal", tipo: "banco" });
    const c = await carteira(t);
    const res = await chamar(env, t, "PATCH", `/contas/${c.id}`, { nome: "principal" });
    expect(res.statusCode).toBe(409);
    expect(res.json().codigo).toBe("nome_duplicado");
  });

  it("conta inativa: 409. Inexistente, de outro titular ou id inválido: 404", async () => {
    const t = await entrar(env, { papel: "titular" });
    const outro = await entrar(env, { papel: "titular" });
    const c = await carteira(t);
    await inativar(t, c.id);
    expect((await chamar(env, t, "PATCH", `/contas/${c.id}`, { nome: "X" })).statusCode).toBe(409);
    expect((await chamar(env, outro, "PATCH", `/contas/${c.id}`, { nome: "X" })).statusCode).toBe(404);
    expect((await chamar(env, t, "PATCH", `/contas/${randomUUID()}`, { nome: "X" })).statusCode).toBe(
      404,
    );
    expect((await chamar(env, t, "PATCH", "/contas/nao-e-uuid", { nome: "X" })).statusCode).toBe(404);
  });
});

describe("inativar: só sem lançamentos ativos", () => {
  it("sem lançamentos: inativa, nada é apagado e vai para o log com quem confirmou", async () => {
    const t = await entrar(env, { papel: "titular" });
    const c = await carteira(t);
    const res = await inativar(t, c.id);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ativo: false });
    const e = await estado(c.id);
    expect(e.ativo).toBe(false);
    expect(e.inativado_em).not.toBeNull();
    expect(e.inativado_por).toBe(t.id);
    expect((await un(`SELECT 1 FROM conta WHERE id = $1`, [c.id])).length).toBe(1);
    const [l] = await un(`SELECT confirmado_por, antes, depois FROM log WHERE acao = 'conta.inativada' AND entidade_id = $1`, [
      c.id,
    ]);
    expect(l).toMatchObject({
      confirmado_por: t.id,
      antes: { ativo: true, nome: c.nome },
      depois: { ativo: false },
    });
  });

  it("com lançamento ativo: 409, diz o motivo e nada muda", async () => {
    const t = await entrar(env, { papel: "titular" });
    const c = await carteira(t);
    await lancamento(t.titularId, c.id, { valor: 100, tipo: "despesa" });
    const res = await inativar(t, c.id);
    expect(res.statusCode).toBe(409);
    expect(res.json().codigo).toBe("impedimentos");
    expect(res.json().erro).toMatch(/1 lançamento/);
    expect((await estado(c.id)).ativo).toBe(true);
  });

  it("lançamentos já inativos não bloqueiam", async () => {
    const t = await entrar(env, { papel: "titular" });
    const c = await carteira(t);
    await lancamento(t.titularId, c.id, { valor: 100, tipo: "despesa", ativo: false });
    expect((await inativar(t, c.id)).statusCode).toBe(200);
    expect((await estado(c.id)).ativo).toBe(false);
  });

  it("já inativa: 409. Inexistente, de outro titular ou id inválido: 404", async () => {
    const t = await entrar(env, { papel: "titular" });
    const outro = await entrar(env, { papel: "titular" });
    const c = await carteira(t);
    await inativar(t, c.id);
    expect((await inativar(t, c.id)).statusCode).toBe(409);
    expect((await inativar(outro, c.id)).statusCode).toBe(404);
    expect((await inativar(t, randomUUID())).statusCode).toBe(404);
  });
});

describe("reativar", () => {
  it("reativa: volta à lista, limpa inativado_* e vai para o log", async () => {
    const t = await entrar(env, { papel: "titular" });
    const c = await carteira(t);
    await inativar(t, c.id);
    const res = await reativar(t, c.id);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ativo: true });
    const e = await estado(c.id);
    expect(e).toMatchObject({ ativo: true, inativado_em: null, inativado_por: null });
    const ids = ((await listar(t)).json().contas as Conta[]).map((x) => x.id);
    expect(ids).toContain(c.id);
    const [l] = await un(`SELECT confirmado_por FROM log WHERE acao = 'conta.reativada' AND entidade_id = $1`, [
      c.id,
    ]);
    expect(l!.confirmado_por).toBe(t.id);
  });

  it("nome já ocupado por outra conta ativa: 409 e a inativa continua inativa", async () => {
    const t = await entrar(env, { papel: "titular" });
    const c = await criar(t, { nome: "Poupança", tipo: "banco" });
    await inativar(t, c.id);
    await criar(t, { nome: "Poupança", tipo: "carteira" });
    const res = await reativar(t, c.id);
    expect(res.statusCode).toBe(409);
    expect(res.json().codigo).toBe("nome_duplicado");
    expect((await estado(c.id)).ativo).toBe(false);
  });

  it("já ativa: 409. Inexistente ou de outro titular: 404", async () => {
    const t = await entrar(env, { papel: "titular" });
    const outro = await entrar(env, { papel: "titular" });
    const c = await carteira(t);
    expect((await reativar(t, c.id)).statusCode).toBe(409);
    expect((await reativar(outro, c.id)).statusCode).toBe(404);
  });
});

describe("permissões do módulo contas (por ação)", () => {
  type Acao = "ver" | "cadastrar" | "alterar" | "excluir";
  const ACOES: Acao[] = ["ver", "cadastrar", "alterar", "excluir"];

  interface Operacao {
    nome: string;
    acao: Acao;
    preparar: (t: Logado) => Promise<{
      metodo: "GET" | "POST" | "PATCH";
      url: string;
      corpo?: object;
      intacto: () => Promise<boolean>;
      statusOk: number;
    }>;
  }

  const operacoes: Operacao[] = [
    {
      nome: "listar",
      acao: "ver",
      preparar: async () => ({
        metodo: "GET",
        url: "/contas",
        intacto: async () => true,
        statusOk: 200,
      }),
    },
    {
      nome: "criar",
      acao: "cadastrar",
      preparar: async () => {
        const nome = nomeUnico();
        return {
          metodo: "POST",
          url: "/contas",
          corpo: { nome, tipo: "carteira" },
          intacto: async () => (await un(`SELECT 1 FROM conta WHERE nome = $1`, [nome])).length === 0,
          statusOk: 201,
        };
      },
    },
    {
      nome: "alterar",
      acao: "alterar",
      preparar: async (t) => {
        const c = await carteira(t);
        return {
          metodo: "PATCH",
          url: `/contas/${c.id}`,
          corpo: { nome: nomeUnico("Outro") },
          intacto: async () => (await estado(c.id)).nome === c.nome,
          statusOk: 200,
        };
      },
    },
    {
      nome: "inativar",
      acao: "excluir",
      preparar: async (t) => {
        const c = await carteira(t);
        return {
          metodo: "POST",
          url: `/contas/${c.id}/inativar`,
          corpo: { senha: SENHA },
          intacto: async () => (await estado(c.id)).ativo === true,
          statusOk: 200,
        };
      },
    },
    {
      nome: "reativar",
      acao: "excluir",
      preparar: async (t) => {
        const c = await carteira(t);
        await inativar(t, c.id);
        return {
          metodo: "POST",
          url: `/contas/${c.id}/reativar`,
          corpo: { senha: SENHA },
          intacto: async () => (await estado(c.id)).ativo === false,
          statusOk: 200,
        };
      },
    },
  ];

  const com = (acoes: Acao[]) => {
    const p: Record<string, boolean> = {};
    for (const a of acoes) p[a] = true;
    if ((p.alterar || p.excluir) && !p.ver) p.ver = true;
    return p;
  };

  describe.each(operacoes)("$nome (exige $acao)", (op) => {
    const vinculadoCom = async (t: Logado, perms: Record<string, Record<string, boolean>>) =>
      entrar(env, { papel: "vinculado", titularId: t.titularId, permissoes: perms });

    it("vinculado sem nenhuma permissão: 403 e nada muda", async () => {
      const t = await entrar(env, { papel: "titular" });
      const alvo = await op.preparar(t);
      const v = await vinculadoCom(t, {});
      const res = await chamar(env, v, alvo.metodo, alvo.url, alvo.corpo);
      expect(res.statusCode).toBe(403);
      expect(await alvo.intacto()).toBe(true);
    });

    it("só com a permissão exata: funciona", async () => {
      const t = await entrar(env, { papel: "titular" });
      const alvo = await op.preparar(t);
      const v = await vinculadoCom(t, { contas: com([op.acao]) });
      const res = await chamar(env, v, alvo.metodo, alvo.url, alvo.corpo);
      expect(res.statusCode, res.body).toBe(alvo.statusOk);
    });

    it("com todas as outras ações, menos esta: 403 e nada muda", async () => {
      const t = await entrar(env, { papel: "titular" });
      const alvo = await op.preparar(t);
      const outras = ACOES.filter((a) => a !== op.acao);
      const v = await vinculadoCom(t, {
        contas: com(op.acao === "ver" ? outras.filter((a) => a === "cadastrar") : outras),
      });
      const res = await chamar(env, v, alvo.metodo, alvo.url, alvo.corpo);
      expect(res.statusCode).toBe(403);
      expect(await alvo.intacto()).toBe(true);
    });

    it("a mesma ação em OUTRO módulo não vale: 403 e nada muda", async () => {
      const t = await entrar(env, { papel: "titular" });
      const alvo = await op.preparar(t);
      const v = await vinculadoCom(t, {
        categorias: com([op.acao]),
        lancamentos: com([op.acao]),
        orcamentos: com([op.acao]),
      });
      const res = await chamar(env, v, alvo.metodo, alvo.url, alvo.corpo);
      expect(res.statusCode).toBe(403);
      expect(await alvo.intacto()).toBe(true);
    });
  });

  it("o vinculado age no titular do titular, e o log mostra quem foi", async () => {
    const t = await entrar(env, { papel: "titular" });
    const v = await entrar(env, {
      papel: "vinculado",
      titularId: t.titularId,
      permissoes: { contas: com(["ver", "cadastrar"]) },
    });
    const c = await criar(v, { nome: nomeUnico(), tipo: "carteira" });
    const [linha] = await un(`SELECT titular_id, criado_por FROM conta WHERE id = $1`, [c.id]);
    expect(linha).toEqual({ titular_id: t.titularId, criado_por: v.id });
    const [l] = await un(
      `SELECT usuario_id, titular_id FROM log WHERE acao = 'conta.criada' AND entidade_id = $1`,
      [c.id],
    );
    expect(l).toEqual({ usuario_id: v.id, titular_id: t.titularId });
    const ids = ((await listar(t)).json().contas as Conta[]).map((x) => x.id);
    expect(ids).toContain(c.id);
  });
});

describe("isolamento entre titulares", () => {
  it("outro titular, e até o admin de outro titular, não vê nem mexe: 404 e nada muda", async () => {
    const a = await entrar(env, { papel: "titular" });
    const intrusos = [await entrar(env, { papel: "titular" }), await entrar(env, { papel: "admin" })];
    const c = await carteira(a);
    for (const x of intrusos) {
      expect((await chamar(env, x, "PATCH", `/contas/${c.id}`, { nome: "Invadida" })).statusCode).toBe(
        404,
      );
      expect((await inativar(x, c.id)).statusCode).toBe(404);
      expect((await reativar(x, c.id)).statusCode).toBe(404);
      const ids = ((await listar(x, "?incluirInativas=true")).json().contas as Conta[]).map((n) => n.id);
      expect(ids).not.toContain(c.id);
    }
    expect((await estado(c.id)).nome).toBe(c.nome);
    expect((await estado(c.id)).ativo).toBe(true);
  });
});

describe("garantias do banco (valem mesmo se a API errar)", () => {
  async function codigo(pool: pg.Pool, sql: string, params: unknown[] = []) {
    try {
      await pool.query(sql, params);
      return null;
    } catch (e) {
      return (e as { code?: string }).code ?? "desconhecido";
    }
  }

  async function titularNovo() {
    return (await inserirUsuario(env, { papel: "titular" })).titularId;
  }

  it("tipo inválido é recusado", async () => {
    const t = await titularNovo();
    expect(
      await codigo(
        env.owner,
        `INSERT INTO conta (titular_id, nome, tipo) VALUES ($1, 'x', 'poupanca')`,
        [t],
      ),
    ).toBe("22P02");
  });

  it("nome único entre contas ativas do titular, mas livre se a outra estiver inativa", async () => {
    const t = await titularNovo();
    await env.owner.query(
      `INSERT INTO conta (titular_id, nome, tipo) VALUES ($1, 'Unica', 'carteira')`,
      [t],
    );
    expect(
      await codigo(env.owner, `INSERT INTO conta (titular_id, nome, tipo) VALUES ($1, 'UNICA', 'banco')`, [
        t,
      ]),
    ).toBe("23505");
    await env.owner.query(
      `INSERT INTO conta (titular_id, nome, tipo, ativo, inativado_em)
       VALUES ($1, 'Reserva', 'carteira', false, now())`,
      [t],
    );
    expect(
      await codigo(
        env.owner,
        `INSERT INTO conta (titular_id, nome, tipo) VALUES ($1, 'reserva', 'banco')`,
        [t],
      ),
    ).toBeNull();
  });

  it("ativo e inativado_em não podem se contradizer", async () => {
    const t = await titularNovo();
    expect(
      await codigo(env.owner, `INSERT INTO conta (titular_id, nome, tipo, ativo) VALUES ($1, 'w', 'carteira', false)`, [
        t,
      ]),
    ).toBe("23514");
  });

  it("lançamento só aceita conta do mesmo titular", async () => {
    const a = await titularNovo();
    const b = await titularNovo();
    const catA = (
      await env.owner.query(
        `INSERT INTO categoria (titular_id, nome, tipo, natureza, nivel) VALUES ($1, 'c', 'despesa', 'variavel', 1) RETURNING id`,
        [a],
      )
    ).rows[0].id as string;
    const contaB = (
      await env.owner.query(
        `INSERT INTO conta (titular_id, nome, tipo) VALUES ($1, 'cb', 'carteira') RETURNING id`,
        [b],
      )
    ).rows[0].id as string;
    expect(
      await codigo(
        env.owner,
        `INSERT INTO lancamento
           (titular_id, categoria_id, conta_id, valor, tipo, status, data, descricao, natureza, origem)
         VALUES ($1, $2, $3, 1, 'despesa', 'realizado', '2026-01-15', 'x', 'variavel', 'manual')`,
        [a, catA, contaB],
      ),
    ).toBe("23503");
  });

  it("o papel da API não apaga contas nem lançamentos (nada se apaga)", async () => {
    expect(await codigo(env.appPool, `DELETE FROM conta`)).toBe("42501");
    expect(await codigo(env.appPool, `DELETE FROM lancamento`)).toBe("42501");
  });
});

describe("serviço chamado direto (sem a camada HTTP)", () => {
  it("recusa nome duplicado com o erro certo", async () => {
    const t = await entrar(env, { papel: "titular" });
    const db = createDb(env.appPool);
    const ctx = { titularId: t.titularId, usuarioId: t.id, ip: "127.0.0.1" };
    await criarConta(db, ctx, { nome: "Direta", tipo: "carteira" });
    await expect(criarConta(db, ctx, { nome: "direta", tipo: "banco" })).rejects.toMatchObject({
      codigo: "nome_duplicado",
    });
  });
});
