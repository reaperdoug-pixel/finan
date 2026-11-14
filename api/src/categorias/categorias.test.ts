import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  chamar,
  criarAmbiente,
  entrar,
  inserirConvite,
  inserirUsuario,
  SENHA,
  type Ambiente,
  type Logado,
} from "../../test/ajudantes.js";
import { ARVORE_PADRAO } from "./padrao.js";
import { criarCategoria, ErroCategoria } from "./servico.js";
import { createDb } from "../db/client.js";

let env: Ambiente;

beforeAll(async () => {
  env = await criarAmbiente(74);
});
afterAll(async () => {
  await env.fechar();
});

const un = async (sql: string, params: unknown[] = []) =>
  (await env.owner.query(sql, params)).rows as Record<string, unknown>[];

const nomeUnico = (p = "Cat") => `${p} ${randomUUID().slice(0, 8)}`;

interface Cat {
  id: string;
  nome: string;
  tipo: string;
  natureza: string;
  nivel: number;
  paiId: string | null;
  ativo: boolean;
  preverPelaMedia: boolean;
}

const post = (q: Logado, corpo: object) => chamar(env, q, "POST", "/categorias", corpo);

/** Cria pela API e devolve a categoria criada (falha o teste se a criação não der certo). */
async function criar(q: Logado, corpo: object): Promise<Cat> {
  const res = await post(q, corpo);
  expect(res.statusCode, res.body).toBe(201);
  return res.json() as Cat;
}

const raiz = (q: Logado, tipo: "receita" | "despesa" = "despesa", extra: object = {}) =>
  criar(q, { nome: nomeUnico("Raiz"), tipo, ...extra });
const filha = (q: Logado, pai: Cat, extra: object = {}) =>
  criar(q, { nome: nomeUnico("Filha"), paiId: pai.id, ...extra });

const inativar = (q: Logado, id: string, senha: string | undefined = SENHA) =>
  chamar(env, q, "POST", `/categorias/${id}/inativar`, senha === undefined ? {} : { senha });
const reativar = (q: Logado, id: string, senha: string | undefined = SENHA) =>
  chamar(env, q, "POST", `/categorias/${id}/reativar`, senha === undefined ? {} : { senha });

/** Insere um lançamento direto no banco (sem passar pelas rotas). */
async function lancamento(c: Cat, titularId: string, ativo = true) {
  const conta = await env.owner.query(
    `INSERT INTO conta (titular_id, nome, tipo) VALUES ($1, $2, 'carteira') RETURNING id`,
    [titularId, `C ${randomUUID().slice(0, 8)}`],
  );
  await env.owner.query(
    `INSERT INTO lancamento
       (titular_id, categoria_id, conta_id, valor, tipo, status, data, descricao, natureza, origem, ativo, inativado_em)
     VALUES ($1, $2, $3, 100, $4, 'realizado', '2026-01-15', 'teste', 'variavel', 'manual', $5,
             CASE WHEN $5 THEN NULL ELSE now() END)`,
    [titularId, c.id, conta.rows[0].id, c.tipo, ativo],
  );
}

const estado = async (id: string) =>
  (await un(`SELECT ativo, nome, natureza, inativado_em, inativado_por FROM categoria WHERE id = $1`, [id]))[0]!;

describe("criar categoria", () => {
  it("raiz: guarda no titular de quem criou, com os padrões, e vai para o log", async () => {
    const t = await entrar(env, { papel: "titular" });
    const nome = nomeUnico();
    const c = await criar(t, { nome: `  ${nome}  `, tipo: "receita" });
    expect(c).toMatchObject({
      nome,
      tipo: "receita",
      natureza: "variavel",
      nivel: 1,
      paiId: null,
      ativo: true,
      preverPelaMedia: false,
    });
    const [linha] = await un(`SELECT titular_id, criado_por FROM categoria WHERE id = $1`, [c.id]);
    expect(linha).toEqual({ titular_id: t.titularId, criado_por: t.id });

    const [l] = await un(`SELECT * FROM log WHERE acao = 'categoria.criada' AND entidade_id = $1`, [c.id]);
    expect(l!.usuario_id).toBe(t.id);
    expect(l!.titular_id).toBe(t.titularId);
    expect(l!.ip).toBe(t.ip);
    expect(l!.depois).toMatchObject({ nome, tipo: "receita", nivel: 1, paiId: null });
  });

  it("raiz sem tipo: 400", async () => {
    const t = await entrar(env, { papel: "titular" });
    const res = await post(t, { nome: nomeUnico() });
    expect(res.statusCode).toBe(400);
    expect(res.json().codigo).toBe("tipo_obrigatorio");
  });

  it("filha herda o tipo e a natureza da mãe, e o nível é o da mãe + 1", async () => {
    const t = await entrar(env, { papel: "titular" });
    const mae = await raiz(t, "despesa", { natureza: "fixa" });
    const f = await filha(t, mae);
    expect(f).toMatchObject({ tipo: "despesa", natureza: "fixa", nivel: 2, paiId: mae.id });
    const neta = await filha(t, f, { natureza: "variavel" });
    expect(neta).toMatchObject({ tipo: "despesa", natureza: "variavel", nivel: 3, paiId: f.id });
  });

  it("filha com tipo diferente do da mãe: 400. Com o mesmo tipo: ok", async () => {
    const t = await entrar(env, { papel: "titular" });
    const mae = await raiz(t, "despesa");
    const ruim = await post(t, { nome: nomeUnico(), paiId: mae.id, tipo: "receita" });
    expect(ruim.statusCode).toBe(400);
    expect(ruim.json().codigo).toBe("tipo_diferente");
    expect((await post(t, { nome: nomeUnico(), paiId: mae.id, tipo: "despesa" })).statusCode).toBe(201);
  });

  it("quarto nível: 409 e nada é criado", async () => {
    const t = await entrar(env, { papel: "titular" });
    const n1 = await raiz(t);
    const n2 = await filha(t, n1);
    const n3 = await filha(t, n2);
    const nome = nomeUnico();
    const res = await post(t, { nome, paiId: n3.id });
    expect(res.statusCode).toBe(409);
    expect(res.json().codigo).toBe("nivel_maximo");
    expect((await un(`SELECT 1 FROM categoria WHERE nome = $1`, [nome])).length).toBe(0);
  });

  it("mãe inexistente ou de OUTRO titular: 404 e nada é criado", async () => {
    const a = await entrar(env, { papel: "titular" });
    const b = await entrar(env, { papel: "titular" });
    const deB = await raiz(b);
    for (const paiId of [randomUUID(), deB.id]) {
      const nome = nomeUnico();
      const res = await post(a, { nome, paiId });
      expect(res.statusCode).toBe(404);
      expect((await un(`SELECT 1 FROM categoria WHERE nome = $1`, [nome])).length).toBe(0);
    }
  });

  it("mãe inativa: 409", async () => {
    const t = await entrar(env, { papel: "titular" });
    const mae = await raiz(t);
    expect((await inativar(t, mae.id)).statusCode).toBe(200);
    const res = await post(t, { nome: nomeUnico(), paiId: mae.id });
    expect(res.statusCode).toBe(409);
    expect(res.json().codigo).toBe("pai_inativo");
  });

  it("mãe com lançamentos ATIVOS não ganha filha (409); só com inativos, ganha", async () => {
    const t = await entrar(env, { papel: "titular" });
    const comAtivo = await raiz(t);
    await lancamento(comAtivo, t.titularId, true);
    await lancamento(comAtivo, t.titularId, true);
    const res = await post(t, { nome: nomeUnico(), paiId: comAtivo.id });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ codigo: "pai_com_lancamentos", lancamentosAtivos: 2 });

    const soInativo = await raiz(t);
    await lancamento(soInativo, t.titularId, false);
    expect((await post(t, { nome: nomeUnico(), paiId: soInativo.id })).statusCode).toBe(201);
  });

  it("nome repetido entre irmãs ativas: 409 (sem diferenciar maiúsculas nem espaços)", async () => {
    const t = await entrar(env, { papel: "titular" });
    const mae = await raiz(t);
    await criar(t, { nome: "Mercado", paiId: mae.id });
    for (const nome of ["mercado", "  MERCADO  ", "Mercado"]) {
      const res = await post(t, { nome, paiId: mae.id });
      expect(res.statusCode, nome).toBe(409);
      expect(res.json().codigo).toBe("nome_duplicado");
    }
  });

  it("o mesmo nome pode existir em mães diferentes, na raiz e numa filha, e em outro titular", async () => {
    const t = await entrar(env, { papel: "titular" });
    const outro = await entrar(env, { papel: "titular" });
    const m1 = await raiz(t);
    const m2 = await raiz(t);
    await criar(t, { nome: "Geral", paiId: m1.id });
    expect((await post(t, { nome: "Geral", paiId: m2.id })).statusCode).toBe(201);
    expect((await post(t, { nome: "Geral", tipo: "despesa" })).statusCode).toBe(201);
    expect((await post(outro, { nome: "Geral", tipo: "despesa" })).statusCode).toBe(201);
  });

  it("depois de inativar a primeira, o nome pode ser usado de novo", async () => {
    const t = await entrar(env, { papel: "titular" });
    const primeira = await criar(t, { nome: "Reutilizável", tipo: "despesa" });
    expect((await inativar(t, primeira.id)).statusCode).toBe(200);
    expect((await post(t, { nome: "Reutilizável", tipo: "despesa" })).statusCode).toBe(201);
  });

  it.each([
    ["nome vazio", { nome: "", tipo: "despesa" }],
    ["nome só com espaços", { nome: "    ", tipo: "despesa" }],
    ["nome grande demais", { nome: "x".repeat(81), tipo: "despesa" }],
    ["tipo inválido", { nome: "X", tipo: "outro" }],
    ["natureza inválida", { nome: "X", tipo: "despesa", natureza: "mista" }],
    ["paiId que não é uuid", { nome: "X", paiId: "1" }],
    ["preverPelaMedia que não é booleano", { nome: "X", tipo: "despesa", preverPelaMedia: "sim" }],
  ])("recusa %s com 400", async (_nome, corpo) => {
    const t = await entrar(env, { papel: "titular" });
    expect((await post(t, corpo)).statusCode).toBe(400);
  });
});

describe("listar", () => {
  it("devolve a árvore aninhada (receitas antes), esconde inativas por padrão e as mostra se pedido", async () => {
    const t = await entrar(env, { papel: "titular" });
    const despesa = await raiz(t, "despesa");
    const receita = await raiz(t, "receita");
    const f1 = await filha(t, despesa);
    const f2 = await filha(t, despesa);
    await inativar(t, f2.id);

    const ativas = (await chamar(env, t, "GET", "/categorias")).json().arvore as (Cat & {
      filhas: Cat[];
      temFilhasAtivas: boolean;
    })[];
    expect(ativas.map((n) => n.id)).toEqual([receita.id, despesa.id]);
    expect(ativas[1]!.filhas.map((f) => f.id)).toEqual([f1.id]);
    expect(ativas[1]!.temFilhasAtivas).toBe(true);

    const todas = (await chamar(env, t, "GET", "/categorias?incluirInativas=true")).json()
      .arvore as typeof ativas;
    expect(todas[1]!.filhas.map((f) => f.id).sort()).toEqual([f1.id, f2.id].sort());
    expect(todas[1]!.filhas.find((f) => f.id === f2.id)!.ativo).toBe(false);
  });

  it("cada titular vê só as suas", async () => {
    const a = await entrar(env, { papel: "titular" });
    const b = await entrar(env, { papel: "titular" });
    const deA = await raiz(a);
    const deB = await raiz(b);
    const ids = (r: { json: () => { arvore: { id: string }[] } }) => r.json().arvore.map((n) => n.id);
    expect(ids(await chamar(env, a, "GET", "/categorias"))).toEqual([deA.id]);
    expect(ids(await chamar(env, b, "GET", "/categorias"))).toEqual([deB.id]);
  });

  it("parâmetro inválido: 400. Sem login: 401", async () => {
    const t = await entrar(env, { papel: "titular" });
    expect((await chamar(env, t, "GET", "/categorias?incluirInativas=talvez")).statusCode).toBe(400);
    expect((await env.app.inject({ method: "GET", url: "/categorias" })).statusCode).toBe(401);
  });
});

describe("alterar categoria", () => {
  const patch = (q: Logado, id: string, corpo: object) =>
    chamar(env, q, "PATCH", `/categorias/${id}`, corpo);

  it("renomeia e o log guarda só o que mudou, antes e depois", async () => {
    const t = await entrar(env, { papel: "titular" });
    const c = await raiz(t);
    const novo = nomeUnico("Novo");
    const res = await patch(t, c.id, { nome: `  ${novo} ` });
    expect(res.statusCode).toBe(200);
    expect(res.json().nome).toBe(novo);
    expect((await estado(c.id)).nome).toBe(novo);

    const [l] = await un(`SELECT * FROM log WHERE acao = 'categoria.alterada' AND entidade_id = $1`, [c.id]);
    expect(l!.antes).toEqual({ nome: c.nome });
    expect(l!.depois).toEqual({ nome: novo });
    expect(l!.usuario_id).toBe(t.id);
    expect(l!.ip).toBe(t.ip);
  });

  it("muda natureza e 'prever pela média' juntos", async () => {
    const t = await entrar(env, { papel: "titular" });
    const c = await raiz(t);
    const res = await patch(t, c.id, { natureza: "fixa", preverPelaMedia: true });
    expect(res.json()).toMatchObject({ natureza: "fixa", preverPelaMedia: true });
    const [l] = await un(`SELECT antes, depois FROM log WHERE acao = 'categoria.alterada' AND entidade_id = $1`, [c.id]);
    expect(l!.antes).toEqual({ natureza: "variavel", preverPelaMedia: false });
    expect(l!.depois).toEqual({ natureza: "fixa", preverPelaMedia: true });
  });

  it("sem mudança real: 200 e nada é registrado", async () => {
    const t = await entrar(env, { papel: "titular" });
    const c = await raiz(t);
    expect((await patch(t, c.id, { nome: c.nome, natureza: "variavel" })).statusCode).toBe(200);
    expect((await un(`SELECT 1 FROM log WHERE acao = 'categoria.alterada' AND entidade_id = $1`, [c.id])).length).toBe(0);
  });

  it("corpo vazio, ou tentando mudar tipo / mãe / nível: 400 e nada muda", async () => {
    const t = await entrar(env, { papel: "titular" });
    const mae = await raiz(t, "despesa");
    const outra = await raiz(t, "despesa");
    const c = await filha(t, mae);
    for (const corpo of [{}, { tipo: "receita" }, { paiId: outra.id }, { nivel: 1 }, { ativo: false }]) {
      expect((await patch(t, c.id, corpo)).statusCode, JSON.stringify(corpo)).toBe(400);
    }
    const [linha] = await un(`SELECT tipo, pai_id, nivel, ativo FROM categoria WHERE id = $1`, [c.id]);
    expect(linha).toEqual({ tipo: "despesa", pai_id: mae.id, nivel: 2, ativo: true });
  });

  it("nome já usado por uma irmã ativa: 409", async () => {
    const t = await entrar(env, { papel: "titular" });
    const a = await raiz(t);
    const b = await raiz(t);
    const res = await patch(t, b.id, { nome: a.nome.toUpperCase() });
    expect(res.statusCode).toBe(409);
    expect((await estado(b.id)).nome).toBe(b.nome);
  });

  it("categoria inativa: 409. Inexistente, de outro titular ou id inválido: 404", async () => {
    const t = await entrar(env, { papel: "titular" });
    const outro = await entrar(env, { papel: "titular" });
    const c = await raiz(t);
    const deOutro = await raiz(outro);
    await inativar(t, c.id);
    expect((await patch(t, c.id, { nome: "X" })).statusCode).toBe(409);
    expect((await patch(t, randomUUID(), { nome: "X" })).statusCode).toBe(404);
    expect((await patch(t, deOutro.id, { nome: "X" })).statusCode).toBe(404);
    expect((await patch(t, "nao-e-uuid", { nome: "X" })).statusCode).toBe(404);
    expect((await estado(deOutro.id)).nome).toBe(deOutro.nome);
  });
});

describe("inativar: lançamentos, depois subcategorias, depois a categoria", () => {
  it("folha sem nada: inativa, nada é apagado e vai para o log com quem confirmou", async () => {
    const t = await entrar(env, { papel: "titular" });
    const c = await raiz(t);
    const res = await inativar(t, c.id);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ativo: false });

    const e = await estado(c.id);
    expect(e.ativo).toBe(false);
    expect(e.inativado_em).not.toBeNull();
    expect(e.inativado_por).toBe(t.id);

    const [l] = await un(`SELECT * FROM log WHERE acao = 'categoria.inativada' AND entidade_id = $1`, [c.id]);
    expect(l!.usuario_id).toBe(t.id);
    expect(l!.confirmado_por).toBe(t.id);
    expect(l!.antes).toEqual({ ativo: true, nome: c.nome });
    expect(l!.depois).toEqual({ ativo: false });

    const ativas = (await chamar(env, t, "GET", "/categorias")).json().arvore as unknown[];
    expect(ativas).toHaveLength(0);
  });

  it("com subcategoria ativa: 409, diz o motivo e nada muda", async () => {
    const t = await entrar(env, { papel: "titular" });
    const mae = await raiz(t);
    await filha(t, mae);
    const res = await inativar(t, mae.id);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({
      codigo: "impedimentos",
      subcategoriasAtivas: 1,
      lancamentosAtivos: 0,
    });
    expect(res.json().erro).toMatch(/subcategoria/);
    expect((await estado(mae.id)).ativo).toBe(true);
  });

  it("com lançamento ativo: 409, diz o motivo e nada muda", async () => {
    const t = await entrar(env, { papel: "titular" });
    const c = await raiz(t);
    await lancamento(c, t.titularId);
    await lancamento(c, t.titularId);
    const res = await inativar(t, c.id);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ codigo: "impedimentos", lancamentosAtivos: 2, subcategoriasAtivas: 0 });
    expect(res.json().erro).toMatch(/lançamento/);
    expect((await estado(c.id)).ativo).toBe(true);
  });

  it("com os dois impedimentos, lista os dois", async () => {
    const t = await entrar(env, { papel: "titular" });
    const mae = await raiz(t);
    await lancamento(mae, t.titularId);
    // Cenário "legado": a API não deixa criar filha em mãe com lançamento ativo, e o banco
    // não deixa lançar em mãe com filha. A filha entra direto no banco para exercitar os dois.
    await env.owner.query(
      `INSERT INTO categoria (titular_id, nome, tipo, natureza, nivel, pai_id)
       VALUES ($1, $2, 'despesa', 'variavel', 2, $3)`,
      [t.titularId, nomeUnico("Filha"), mae.id],
    );
    const res = await inativar(t, mae.id);
    expect(res.json()).toMatchObject({ lancamentosAtivos: 1, subcategoriasAtivas: 1 });
    expect(res.json().erro).toMatch(/lançamento.*subcategoria/);
  });

  it("na ordem certa funciona: lançamentos, depois subcategorias, depois a mãe", async () => {
    const t = await entrar(env, { papel: "titular" });
    const mae = await raiz(t);
    const f = await filha(t, mae);
    await lancamento(f, t.titularId);

    expect((await inativar(t, mae.id)).statusCode).toBe(409); // ainda há filha
    expect((await inativar(t, f.id)).statusCode).toBe(409); // ainda há lançamento

    await env.owner.query(
      `UPDATE lancamento SET ativo = false, inativado_em = now() WHERE categoria_id = $1`,
      [f.id],
    );
    expect((await inativar(t, f.id)).statusCode).toBe(200);
    expect((await inativar(t, mae.id)).statusCode).toBe(200);
    expect((await estado(mae.id)).ativo).toBe(false);
  });

  it("itens já inativos não bloqueiam", async () => {
    const t = await entrar(env, { papel: "titular" });
    const mae = await raiz(t);
    await lancamento(mae, t.titularId, false);
    const f = await filha(t, mae);
    expect((await inativar(t, f.id)).statusCode).toBe(200);
    expect((await inativar(t, mae.id)).statusCode).toBe(200);
  });

  it("já inativa: 409. Inexistente, de outro titular ou id inválido: 404", async () => {
    const t = await entrar(env, { papel: "titular" });
    const outro = await entrar(env, { papel: "titular" });
    const c = await raiz(t);
    const deOutro = await raiz(outro);
    expect((await inativar(t, c.id)).statusCode).toBe(200);
    expect((await inativar(t, c.id)).statusCode).toBe(409);
    expect((await inativar(t, randomUUID())).statusCode).toBe(404);
    expect((await inativar(t, deOutro.id)).statusCode).toBe(404);
    expect((await inativar(t, "nao-e-uuid")).statusCode).toBe(404);
    expect((await estado(deOutro.id)).ativo).toBe(true);
  });

  it("exclusão mútua: não nasce filha numa mãe que está sendo inativada ao mesmo tempo", async () => {
    // Uma conexão separada segura a linha da mãe (FOR UPDATE) e a inativa. A criação da filha
    // precisa esperar e, quando a mãe termina inativa, ser recusada. Sem a trava no código, a
    // filha nasceria sob uma mãe inativa e este teste falharia.
    const t = await entrar(env, { papel: "titular" });
    const mae = await raiz(t);
    const outra = await env.owner.connect();
    try {
      await outra.query("BEGIN");
      await outra.query(`SELECT id FROM categoria WHERE id = $1 FOR UPDATE`, [mae.id]);

      let terminou = false;
      const nome = nomeUnico("Concorrente");
      const criacao = post(t, { nome, paiId: mae.id }).then((r) => {
        terminou = true;
        return r;
      });
      await new Promise((resolve) => setTimeout(resolve, 700));
      expect(terminou).toBe(false);

      await outra.query(
        `UPDATE categoria SET ativo = false, inativado_em = now() WHERE id = $1`,
        [mae.id],
      );
      await outra.query("COMMIT");

      const res = await criacao;
      expect(res.statusCode).toBe(409);
      expect(res.json().codigo).toBe("pai_inativo");
      expect((await un(`SELECT 1 FROM categoria WHERE nome = $1`, [nome])).length).toBe(0);
    } finally {
      outra.release();
    }
  });
});

describe("reativar", () => {
  it("reativa: volta à árvore, limpa inativado_* e vai para o log", async () => {
    const t = await entrar(env, { papel: "titular" });
    const c = await raiz(t);
    await inativar(t, c.id);
    const res = await reativar(t, c.id);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ativo: true });

    const e = await estado(c.id);
    expect(e.ativo).toBe(true);
    expect(e.inativado_em).toBeNull();
    expect(e.inativado_por).toBeNull();
    expect(((await chamar(env, t, "GET", "/categorias")).json().arvore as unknown[]).length).toBe(1);

    const [l] = await un(`SELECT * FROM log WHERE acao = 'categoria.reativada' AND entidade_id = $1`, [c.id]);
    expect(l!.confirmado_por).toBe(t.id);
    expect(l!.antes).toEqual({ ativo: false, nome: c.nome });
    expect(l!.depois).toEqual({ ativo: true });
  });

  it("filha de mãe inativa: 409 até reativar a mãe", async () => {
    const t = await entrar(env, { papel: "titular" });
    const mae = await raiz(t);
    const f = await filha(t, mae);
    await inativar(t, f.id);
    await inativar(t, mae.id);
    const res = await reativar(t, f.id);
    expect(res.statusCode).toBe(409);
    expect(res.json().codigo).toBe("pai_inativo");
    expect((await estado(f.id)).ativo).toBe(false);

    expect((await reativar(t, mae.id)).statusCode).toBe(200);
    expect((await reativar(t, f.id)).statusCode).toBe(200);
  });

  it("nome já ocupado por outra categoria ativa: 409 e a inativa continua inativa", async () => {
    const t = await entrar(env, { papel: "titular" });
    const antiga = await criar(t, { nome: "Disputada", tipo: "despesa" });
    await inativar(t, antiga.id);
    await criar(t, { nome: "Disputada", tipo: "despesa" });
    const res = await reativar(t, antiga.id);
    expect(res.statusCode).toBe(409);
    expect(res.json().codigo).toBe("nome_duplicado");
    expect((await estado(antiga.id)).ativo).toBe(false);
  });

  it("já ativa: 409. Inexistente ou de outro titular: 404", async () => {
    const t = await entrar(env, { papel: "titular" });
    const outro = await entrar(env, { papel: "titular" });
    const c = await raiz(t);
    const deOutro = await raiz(outro);
    await inativar(outro, deOutro.id);
    expect((await reativar(t, c.id)).statusCode).toBe(409);
    expect((await reativar(t, randomUUID())).statusCode).toBe(404);
    expect((await reativar(t, deOutro.id)).statusCode).toBe(404);
    expect((await estado(deOutro.id)).ativo).toBe(false);
  });
});

describe("permissões do módulo categorias (por ação)", () => {
  type Acao = "ver" | "cadastrar" | "alterar" | "excluir";
  const ACOES: Acao[] = ["ver", "cadastrar", "alterar", "excluir"];

  interface Operacao {
    nome: string;
    acao: Acao;
    /** Prepara o alvo (feito pelo titular) e devolve a chamada e a conferência de estado. */
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
        url: "/categorias",
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
          url: "/categorias",
          corpo: { nome, tipo: "despesa" },
          intacto: async () => (await un(`SELECT 1 FROM categoria WHERE nome = $1`, [nome])).length === 0,
          statusOk: 201,
        };
      },
    },
    {
      nome: "alterar",
      acao: "alterar",
      preparar: async (t) => {
        const c = await raiz(t);
        return {
          metodo: "PATCH",
          url: `/categorias/${c.id}`,
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
        const c = await raiz(t);
        return {
          metodo: "POST",
          url: `/categorias/${c.id}/inativar`,
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
        const c = await raiz(t);
        await inativar(t, c.id);
        return {
          metodo: "POST",
          url: `/categorias/${c.id}/reativar`,
          corpo: { senha: SENHA },
          intacto: async () => (await estado(c.id)).ativo === false,
          statusOk: 200,
        };
      },
    },
  ];

  /** Permissões que incluem só as ações dadas (e `ver` quando alterar/excluir exigem). */
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
      const v = await vinculadoCom(t, { categorias: com([op.acao]) });
      const res = await chamar(env, v, alvo.metodo, alvo.url, alvo.corpo);
      expect(res.statusCode, res.body).toBe(alvo.statusOk);
    });

    it("com todas as outras ações, menos esta: 403 e nada muda", async () => {
      const t = await entrar(env, { papel: "titular" });
      const alvo = await op.preparar(t);
      const outras = ACOES.filter((a) => a !== op.acao);
      const v = await vinculadoCom(t, { categorias: com(op.acao === "ver" ? outras.filter((a) => a === "cadastrar") : outras) });
      const res = await chamar(env, v, alvo.metodo, alvo.url, alvo.corpo);
      expect(res.statusCode).toBe(403);
      expect(await alvo.intacto()).toBe(true);
    });

    it("a mesma ação em OUTRO módulo não vale: 403 e nada muda", async () => {
      const t = await entrar(env, { papel: "titular" });
      const alvo = await op.preparar(t);
      const v = await vinculadoCom(t, {
        contas: com([op.acao]),
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
      permissoes: { categorias: com(["ver", "cadastrar"]) },
    });
    const c = await criar(v, { nome: nomeUnico(), tipo: "despesa" });
    const [linha] = await un(`SELECT titular_id, criado_por FROM categoria WHERE id = $1`, [c.id]);
    expect(linha).toEqual({ titular_id: t.titularId, criado_por: v.id });
    const [l] = await un(`SELECT usuario_id, titular_id FROM log WHERE acao = 'categoria.criada' AND entidade_id = $1`, [c.id]);
    expect(l).toEqual({ usuario_id: v.id, titular_id: t.titularId });
    // e o titular enxerga a categoria que o vinculado criou
    const ids = ((await chamar(env, t, "GET", "/categorias")).json().arvore as { id: string }[]).map((n) => n.id);
    expect(ids).toContain(c.id);
  });
});

describe("isolamento entre titulares", () => {
  it("outro titular, e até o admin de outro titular, não vê nem mexe: 404 e nada muda", async () => {
    const a = await entrar(env, { papel: "titular" });
    const intrusos = [await entrar(env, { papel: "titular" }), await entrar(env, { papel: "admin" })];
    const mae = await raiz(a);
    const f = await filha(a, mae);
    for (const x of intrusos) {
      expect((await chamar(env, x, "PATCH", `/categorias/${f.id}`, { nome: "Invadida" })).statusCode).toBe(404);
      expect((await inativar(x, f.id)).statusCode).toBe(404);
      expect((await reativar(x, f.id)).statusCode).toBe(404);
      expect((await post(x, { nome: nomeUnico(), paiId: mae.id })).statusCode).toBe(404);
      const ids = ((await chamar(env, x, "GET", "/categorias?incluirInativas=true")).json().arvore as { id: string }[]).map((n) => n.id);
      expect(ids).not.toContain(mae.id);
    }
    expect((await estado(f.id)).nome).toBe(f.nome);
    expect((await estado(f.id)).ativo).toBe(true);
  });
});

describe("árvore padrão de um titular novo", () => {
  /** Fluxo real: o admin convida e o convidado aceita (o titular nasce aí). */
  async function titularNovoPorConvite() {
    const admin = await entrar(env, { papel: "admin" });
    const c = await inserirConvite(env, { criadoPor: admin.id });
    const aceite = await env.app.inject({
      method: "POST",
      url: `/convites/${c.token}/aceitar`,
      payload: { senha: "senha-do-convidado-123" },
      remoteAddress: env.novoIp(),
    });
    expect(aceite.statusCode).toBe(201);
    const u = (await un(`SELECT id, titular_id FROM usuario WHERE lower(email) = $1`, [c.email]))[0]!;
    return { usuarioId: u.id as string, titularId: u.titular_id as string };
  }

  const totalEsperado = ARVORE_PADRAO.length + ARVORE_PADRAO.reduce((s, r) => s + (r.filhas?.length ?? 0), 0);

  it("nasce com a árvore padrão completa, coerente e registrada no log", async () => {
    const { usuarioId, titularId } = await titularNovoPorConvite();
    const linhas = await un(`SELECT nome, tipo, natureza, nivel, pai_id, ativo, criado_por FROM categoria WHERE titular_id = $1`, [titularId]);
    expect(linhas).toHaveLength(totalEsperado);
    expect(linhas.every((l) => l.ativo === true && l.criado_por === usuarioId)).toBe(true);
    expect(linhas.every((l) => (l.nivel as number) >= 1 && (l.nivel as number) <= 3)).toBe(true);
    expect(linhas.every((l) => ["fixa", "variavel"].includes(l.natureza as string))).toBe(true);

    const nomes = linhas.map((l) => l.nome);
    for (const esperado of ["Moradia", "Energia elétrica", "Salário", "Mercado", "Plano de saúde"]) {
      expect(nomes).toContain(esperado);
    }
    // há receitas e despesas, e quem tem mãe tem o mesmo tipo dela (garantido também pelo banco)
    expect(new Set(linhas.map((l) => l.tipo))).toEqual(new Set(["receita", "despesa"]));

    const [l] = await un(`SELECT * FROM log WHERE acao = 'categoria.padraocriada' AND titular_id = $1`, [titularId]);
    expect(l!.usuario_id).toBe(usuarioId);
    expect(l!.ip).not.toBeNull();
    expect(l!.depois).toEqual({ total: totalEsperado });
  });

  it("o titular edita a própria árvore sem afetar a de outros titulares", async () => {
    const a = await titularNovoPorConvite();
    const b = await titularNovoPorConvite();
    await env.owner.query(`UPDATE categoria SET nome = 'Casa do A' WHERE titular_id = $1 AND nome = 'Moradia'`, [a.titularId]);
    const nomesB = (await un(`SELECT nome FROM categoria WHERE titular_id = $1`, [b.titularId])).map((l) => l.nome);
    expect(nomesB).toContain("Moradia");
    expect(nomesB).not.toContain("Casa do A");
  });

  it("não tem nome repetido entre irmãs e só as folhas são 'lançáveis' (mães têm filhas)", async () => {
    const { titularId } = await titularNovoPorConvite();
    const dup = await un(
      `SELECT lower(nome), pai_id, count(*) FROM categoria WHERE titular_id = $1 GROUP BY 1, 2 HAVING count(*) > 1`,
      [titularId],
    );
    expect(dup).toEqual([]);
    const maes = await un(
      `SELECT c.nome FROM categoria c WHERE c.titular_id = $1 AND EXISTS (SELECT 1 FROM categoria f WHERE f.pai_id = c.id)`,
      [titularId],
    );
    expect(maes.map((m) => m.nome)).toEqual(expect.arrayContaining(["Moradia", "Alimentação", "Transporte"]));
  });

  it("convite de VINCULADO não cria árvore nova (o titular já tem a dele)", async () => {
    const t = await entrar(env, { papel: "titular" });
    const antes = (await un(`SELECT 1 FROM categoria WHERE titular_id = $1`, [t.titularId])).length;
    const v = await inserirUsuario(env, { papel: "vinculado", titularId: t.titularId });
    expect(v.id).toBeTruthy();
    expect((await un(`SELECT 1 FROM categoria WHERE titular_id = $1`, [t.titularId])).length).toBe(antes);
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

  const inserir = (
    titularId: string,
    o: { nome?: string; tipo?: string; nivel?: number; paiId?: string | null; ativo?: boolean } = {},
  ) =>
    env.owner.query(
      `INSERT INTO categoria (titular_id, pai_id, nome, tipo, natureza, nivel, ativo, inativado_em)
       VALUES ($1, $2, $3, $4, 'variavel', $5, $6, CASE WHEN $6 THEN NULL ELSE now() END) RETURNING id`,
      [titularId, o.paiId ?? null, o.nome ?? nomeUnico(), o.tipo ?? "despesa", o.nivel ?? 1, o.ativo ?? true],
    );

  async function titularNovo() {
    return (await inserirUsuario(env, { papel: "titular" })).titularId;
  }

  it("nível fora de 1 a 3, ou raiz que não é nível 1: recusado", async () => {
    const t = await titularNovo();
    const raizId = (await inserir(t)).rows[0].id as string;
    expect(await codigo(env.owner, `INSERT INTO categoria (titular_id, pai_id, nome, tipo, natureza, nivel) VALUES ($1, $2, 'x', 'despesa', 'fixa', 4)`, [t, raizId])).toBe("23514");
    expect(await codigo(env.owner, `INSERT INTO categoria (titular_id, nome, tipo, natureza, nivel) VALUES ($1, 'y', 'despesa', 'fixa', 2)`, [t])).toBe("23514");
    expect(await codigo(env.owner, `INSERT INTO categoria (titular_id, nome, tipo, natureza, nivel) VALUES ($1, 'z', 'despesa', 'fixa', 0)`, [t])).toBe("23514");
  });

  it("o nível da filha tem de ser o da mãe + 1 (gatilho)", async () => {
    const t = await titularNovo();
    const raizId = (await inserir(t)).rows[0].id as string;
    const mae2 = (await inserir(t, { paiId: raizId, nivel: 2 })).rows[0].id as string;
    // pai nível 1 com filha declarando nível 3 (pularia um nível)
    expect(await codigo(env.owner, `INSERT INTO categoria (titular_id, pai_id, nome, tipo, natureza, nivel) VALUES ($1, $2, 'p', 'despesa', 'fixa', 3)`, [t, raizId])).toBe("23514");
    // pai nível 2 com filha declarando nível 2 (mesmo nível)
    expect(await codigo(env.owner, `INSERT INTO categoria (titular_id, pai_id, nome, tipo, natureza, nivel) VALUES ($1, $2, 'q', 'despesa', 'fixa', 2)`, [t, mae2])).toBe("23514");
    // o correto passa
    expect(await codigo(env.owner, `INSERT INTO categoria (titular_id, pai_id, nome, tipo, natureza, nivel) VALUES ($1, $2, 'ok', 'despesa', 'fixa', 3)`, [t, mae2])).toBeNull();
  });

  it("filha com tipo diferente da mãe, ou de outro titular: recusado", async () => {
    const t = await titularNovo();
    const outro = await titularNovo();
    const mae = (await inserir(t, { tipo: "despesa" })).rows[0].id as string;
    expect(await codigo(env.owner, `INSERT INTO categoria (titular_id, pai_id, nome, tipo, natureza, nivel) VALUES ($1, $2, 'a', 'receita', 'fixa', 2)`, [t, mae])).toBe("23503");
    expect(await codigo(env.owner, `INSERT INTO categoria (titular_id, pai_id, nome, tipo, natureza, nivel) VALUES ($1, $2, 'b', 'despesa', 'fixa', 2)`, [outro, mae])).toBe("23503");
  });

  it("não se muda o tipo de uma mãe que já tem filhas", async () => {
    const t = await titularNovo();
    const mae = (await inserir(t, { tipo: "despesa" })).rows[0].id as string;
    await inserir(t, { paiId: mae, nivel: 2, tipo: "despesa" });
    expect(await codigo(env.owner, `UPDATE categoria SET tipo = 'receita' WHERE id = $1`, [mae])).toBe("23503");
  });

  it("nome único entre irmãs ativas, mas livre se a outra estiver inativa", async () => {
    const t = await titularNovo();
    await inserir(t, { nome: "Unica" });
    expect(await codigo(env.owner, `INSERT INTO categoria (titular_id, nome, tipo, natureza, nivel) VALUES ($1, 'UNICA', 'despesa', 'fixa', 1)`, [t])).toBe("23505");
    await inserir(t, { nome: "Reserva", ativo: false });
    expect(await codigo(env.owner, `INSERT INTO categoria (titular_id, nome, tipo, natureza, nivel) VALUES ($1, 'reserva', 'despesa', 'fixa', 1)`, [t])).toBeNull();
  });

  it("ativo e inativado_em não podem se contradizer", async () => {
    const t = await titularNovo();
    expect(await codigo(env.owner, `INSERT INTO categoria (titular_id, nome, tipo, natureza, nivel, ativo) VALUES ($1, 'w', 'despesa', 'fixa', 1, false)`, [t])).toBe("23514");
  });

  it("lançamento só aceita categoria do mesmo titular", async () => {
    const a = await titularNovo();
    const b = await titularNovo();
    const catB = (await inserir(b)).rows[0].id as string;
    const contaA = (
      await env.owner.query(
        `INSERT INTO conta (titular_id, nome, tipo) VALUES ($1, 'ca', 'carteira') RETURNING id`,
        [a],
      )
    ).rows[0].id as string;
    const contaB = (
      await env.owner.query(
        `INSERT INTO conta (titular_id, nome, tipo) VALUES ($1, 'cb', 'carteira') RETURNING id`,
        [b],
      )
    ).rows[0].id as string;
    const ins = `INSERT INTO lancamento
      (titular_id, categoria_id, conta_id, valor, tipo, status, data, descricao, natureza, origem)
      VALUES ($1, $2, $3, 1, 'despesa', 'realizado', '2026-01-15', 'x', 'variavel', 'manual')`;
    expect(await codigo(env.owner, ins, [a, catB, contaA])).toBe("23503");
    expect(await codigo(env.owner, ins, [b, catB, contaB])).toBeNull();
  });

  it("o papel da API não apaga categorias nem lançamentos (nada se apaga)", async () => {
    expect(await codigo(env.appPool, `DELETE FROM categoria`)).toBe("42501");
    expect(await codigo(env.appPool, `DELETE FROM lancamento`)).toBe("42501");
  });
});

describe("serviço chamado direto (sem a camada HTTP)", () => {
  it("recusa nome duplicado com o erro certo", async () => {
    const t = await entrar(env, { papel: "titular" });
    const db = createDb(env.appPool);
    const ctx = { titularId: t.titularId, usuarioId: t.id, ip: "127.0.0.1" };
    await criarCategoria(db, ctx, { nome: "Direta", tipo: "despesa" });
    await expect(criarCategoria(db, ctx, { nome: "direta", tipo: "despesa" })).rejects.toMatchObject({
      codigo: "nome_duplicado",
    });
    await expect(criarCategoria(db, ctx, { nome: "x", tipo: "despesa", paiId: randomUUID() })).rejects.toBeInstanceOf(ErroCategoria);
  });
});
