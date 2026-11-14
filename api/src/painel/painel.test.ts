import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  chamar,
  criarAmbiente,
  entrar,
  inserirUsuario,
  logar,
  SENHA,
  type Ambiente,
  type Logado,
} from "../../test/ajudantes.js";
import { deslocarMes, type Painel } from "./servico.js";

let env: Ambiente;

beforeAll(async () => {
  env = await criarAmbiente(79);
});
afterAll(async () => {
  await env.fechar();
});

const nomeUnico = (p: string) => `${p} ${randomUUID().slice(0, 8)}`;
const painel = (q: Logado, qs = "") => chamar(env, q, "GET", `/painel${qs}`);

async function categoria(
  t: Logado,
  tipo: "receita" | "despesa",
  paiId?: string,
  natureza: "fixa" | "variavel" = "variavel",
) {
  const r = await chamar(env, t, "POST", "/categorias", {
    nome: nomeUnico("Cat"),
    tipo: paiId ? undefined : tipo,
    natureza,
    ...(paiId ? { paiId } : {}),
  });
  expect(r.statusCode, r.body).toBe(201);
  return r.json() as { id: string; nome: string };
}

async function conta(t: Logado, saldoInicial = 0) {
  const r = await chamar(env, t, "POST", "/contas", {
    nome: nomeUnico("Conta"),
    tipo: "banco",
    saldoInicial,
  });
  expect(r.statusCode, r.body).toBe(201);
  return r.json() as { id: string };
}

async function lancar(
  t: Logado,
  o: {
    categoriaId: string;
    contaId: string;
    valor: number;
    data: string;
    status?: "previsto" | "realizado";
  },
) {
  const r = await chamar(env, t, "POST", "/lancamentos", {
    descricao: nomeUnico("L"),
    status: "realizado",
    ...o,
  });
  expect(r.statusCode, r.body).toBe(201);
  return r.json() as { id: string };
}

describe("painel: acesso", () => {
  it("sem login: 401", async () => {
    const r = await env.app.inject({ method: "GET", url: "/painel" });
    expect(r.statusCode).toBe(401);
  });

  it("sem ver em lançamentos: 403 e nenhum dado", async () => {
    const t = await entrar(env, { papel: "titular" });
    const v = await inserirUsuario(env, {
      papel: "vinculado",
      titularId: t.titularId,
      permissoes: { categorias: { ver: true }, contas: { ver: true } },
    });
    const sessao = { ...(await logar(env, v.email)), id: v.id, titularId: t.titularId };
    const r = await painel(sessao);
    expect(r.statusCode).toBe(403);
    expect(r.json()).toEqual({ erro: "Sem permissão" });
  });

  it("mês inválido: 400", async () => {
    const t = await entrar(env, { papel: "titular" });
    for (const mes of ["2026-13", "2026-1", "abc", "2026-00", "2026-01-01"]) {
      expect((await painel(t, `?mes=${mes}`)).statusCode, mes).toBe(400);
    }
  });

  it("vinculado só com lançamentos: categorias e contas vêm nulas, sem vazar dados", async () => {
    const t = await entrar(env, { papel: "titular" });
    const cat = await categoria(t, "despesa");
    const c = await conta(t, 5000);
    await lancar(t, { categoriaId: cat.id, contaId: c.id, valor: 1000, data: "2026-03-10" });

    const v = await inserirUsuario(env, {
      papel: "vinculado",
      titularId: t.titularId,
      permissoes: { lancamentos: { ver: true } },
    });
    const sessao = { ...(await logar(env, v.email)), id: v.id, titularId: t.titularId };
    const r = await painel(sessao, "?mes=2026-03");
    expect(r.statusCode, r.body).toBe(200);
    const p = r.json() as Painel;
    expect(p.atual.despesas).toBe(1000);
    expect(p.despesasPorCategoria).toBeNull();
    expect(p.receitasPorCategoria).toBeNull();
    expect(p.contas).toBeNull();
    expect(p.movimentoPorConta).toBeNull();
    expect(r.body).not.toContain(cat.nome);
  });
});

describe("painel: isolamento entre titulares", () => {
  it("o painel de um titular nunca soma dados de outro", async () => {
    const a = await entrar(env, { papel: "titular" });
    const b = await entrar(env, { papel: "titular" });
    const catA = await categoria(a, "despesa");
    const contaA = await conta(a, 99900);
    await lancar(a, { categoriaId: catA.id, contaId: contaA.id, valor: 7777, data: "2026-04-05" });
    await lancar(a, {
      categoriaId: catA.id,
      contaId: contaA.id,
      valor: 3333,
      data: "2026-01-05",
      status: "previsto",
    });

    const r = await painel(b, "?mes=2026-04");
    expect(r.statusCode, r.body).toBe(200);
    const p = r.json() as Painel;
    expect(p.atual).toEqual({ mes: "2026-04", receitas: 0, despesas: 0 });
    expect(p.serie.every((m) => m.receitas === 0 && m.despesas === 0)).toBe(true);
    expect(p.atrasados.quantidade).toBe(0);
    expect(p.despesasPorCategoria).toEqual([]);
    expect(p.receitasPorCategoria).toEqual([]);
    expect(p.movimentoPorConta).toEqual([]);
    expect(p.contas?.itens).toEqual([]);
    expect(p.contas?.total).toBe(0);
    expect(r.body).not.toContain(catA.nome);
  });
});

describe("painel: números", () => {
  it("soma só realizados ativos; previstos e inativos ficam de fora; compara com o mês anterior", async () => {
    const t = await entrar(env, { papel: "titular" });
    const receita = await categoria(t, "receita");
    const despesa = await categoria(t, "despesa");
    const c = await conta(t, 10000);
    const base = { contaId: c.id };

    await lancar(t, { ...base, categoriaId: receita.id, valor: 500000, data: "2026-05-05" });
    await lancar(t, { ...base, categoriaId: despesa.id, valor: 120000, data: "2026-05-10" });
    await lancar(t, { ...base, categoriaId: despesa.id, valor: 80000, data: "2026-04-10" });
    // Previsto: não entra nos totais, entra em previstosDoMes.
    await lancar(t, {
      ...base,
      categoriaId: despesa.id,
      valor: 45000,
      data: "2026-05-20",
      status: "previsto",
    });
    // Inativo: fora de tudo.
    const inativo = await lancar(t, {
      ...base,
      categoriaId: despesa.id,
      valor: 999000,
      data: "2026-05-11",
    });
    const ina = await chamar(env, t, "POST", `/lancamentos/${inativo.id}/inativar`, {
      senha: SENHA,
    });
    expect(ina.statusCode, ina.body).toBeLessThan(300);

    const r = await painel(t, "?mes=2026-05");
    expect(r.statusCode, r.body).toBe(200);
    const p = r.json() as Painel;
    expect(p.mes).toBe("2026-05");
    expect(p.mesAnterior).toBe("2026-04");
    expect(p.atual).toEqual({ mes: "2026-05", receitas: 500000, despesas: 120000 });
    expect(p.anterior).toEqual({ mes: "2026-04", receitas: 0, despesas: 80000 });
    expect(p.serie).toHaveLength(6);
    expect(p.serie[0]!.mes).toBe(deslocarMes("2026-05", -5));
    expect(p.serie[5]).toEqual(p.atual);
    expect(p.previstosDoMes).toEqual({ quantidade: 1, receitas: 0, despesas: 45000 });
    // Saldo: 10000 + 500000 - 120000 - 80000 (só realizados ativos).
    expect(p.contas?.total).toBe(310000);
    expect(Number.isInteger(p.atual.receitas)).toBe(true);
  });

  it("agrupa despesas na categoria-raiz e traz o mês anterior", async () => {
    const t = await entrar(env, { papel: "titular" });
    const raiz = await categoria(t, "despesa");
    const filha = await categoria(t, "despesa", raiz.id);
    const outra = await categoria(t, "despesa");
    const c = await conta(t);

    await lancar(t, { categoriaId: filha.id, contaId: c.id, valor: 30000, data: "2026-06-03" });
    await lancar(t, { categoriaId: filha.id, contaId: c.id, valor: 20000, data: "2026-05-03" });
    await lancar(t, { categoriaId: outra.id, contaId: c.id, valor: 90000, data: "2026-06-04" });

    const p = (await painel(t, "?mes=2026-06")).json() as Painel;
    expect(p.despesasPorCategoria).toEqual([
      { id: outra.id, nome: outra.nome, valor: 90000, anterior: 0 },
      { id: raiz.id, nome: raiz.nome, valor: 30000, anterior: 20000 },
    ]);
  });

  it("agrupa receitas na categoria-raiz, separado das despesas", async () => {
    const t = await entrar(env, { papel: "titular" });
    const raiz = await categoria(t, "receita");
    const filha = await categoria(t, "receita", raiz.id);
    const gasto = await categoria(t, "despesa");
    const c = await conta(t);

    await lancar(t, { categoriaId: filha.id, contaId: c.id, valor: 400000, data: "2026-06-05" });
    await lancar(t, { categoriaId: filha.id, contaId: c.id, valor: 100000, data: "2026-05-05" });
    await lancar(t, { categoriaId: gasto.id, contaId: c.id, valor: 7000, data: "2026-06-06" });

    const p = (await painel(t, "?mes=2026-06")).json() as Painel;
    expect(p.receitasPorCategoria).toEqual([
      { id: raiz.id, nome: raiz.nome, valor: 400000, anterior: 100000 },
    ]);
    expect(p.despesasPorCategoria).toEqual([
      { id: gasto.id, nome: gasto.nome, valor: 7000, anterior: 0 },
    ]);
  });

  it("movimento por conta: só realizados ativos do mês, só contas com movimento", async () => {
    const t = await entrar(env, { papel: "titular" });
    const rec = await categoria(t, "receita");
    const desp = await categoria(t, "despesa");
    const c1 = await conta(t);
    const c2 = await conta(t);
    const parada = await conta(t);

    await lancar(t, { categoriaId: rec.id, contaId: c1.id, valor: 50000, data: "2026-07-02" });
    await lancar(t, { categoriaId: desp.id, contaId: c1.id, valor: 12000, data: "2026-07-03" });
    await lancar(t, { categoriaId: desp.id, contaId: c2.id, valor: 90000, data: "2026-07-04" });
    // Fora do mês, previsto e inativo: não contam.
    await lancar(t, { categoriaId: desp.id, contaId: c2.id, valor: 1, data: "2026-06-30" });
    await lancar(t, {
      categoriaId: desp.id,
      contaId: c2.id,
      valor: 2,
      data: "2026-07-05",
      status: "previsto",
    });
    const inativo = await lancar(t, {
      categoriaId: desp.id,
      contaId: c2.id,
      valor: 3,
      data: "2026-07-06",
    });
    const ina = await chamar(env, t, "POST", `/lancamentos/${inativo.id}/inativar`, {
      senha: SENHA,
    });
    expect(ina.statusCode, ina.body).toBeLessThan(300);

    const p = (await painel(t, "?mes=2026-07")).json() as Painel;
    const mov = p.movimentoPorConta!;
    expect(mov.map((m) => m.id)).toEqual([c2.id, c1.id]);
    expect(mov.find((m) => m.id === c1.id)).toMatchObject({ receitas: 50000, despesas: 12000 });
    expect(mov.find((m) => m.id === c2.id)).toMatchObject({ receitas: 0, despesas: 90000 });
    expect(mov.some((m) => m.id === parada.id)).toBe(false);
  });

  it("separa despesas fixas e variáveis, mês e anterior; ignora receitas, previstos e outro titular", async () => {
    const t = await entrar(env, { papel: "titular" });
    const outro = await entrar(env, { papel: "titular" });
    const fixa = await categoria(t, "despesa", undefined, "fixa");
    const vari = await categoria(t, "despesa");
    const rec = await categoria(t, "receita");
    const c = await conta(t);
    await lancar(t, { categoriaId: fixa.id, contaId: c.id, valor: 200000, data: "2026-08-05" });
    await lancar(t, { categoriaId: fixa.id, contaId: c.id, valor: 190000, data: "2026-07-05" });
    await lancar(t, { categoriaId: vari.id, contaId: c.id, valor: 30000, data: "2026-08-06" });
    await lancar(t, { categoriaId: vari.id, contaId: c.id, valor: 25000, data: "2026-07-06" });
    await lancar(t, { categoriaId: rec.id, contaId: c.id, valor: 999000, data: "2026-08-07" });
    await lancar(t, {
      categoriaId: fixa.id,
      contaId: c.id,
      valor: 777,
      data: "2026-08-20",
      status: "previsto",
    });
    const p = (await painel(t, "?mes=2026-08")).json() as Painel;
    expect(p.despesasPorNatureza).toEqual({
      fixa: 200000,
      variavel: 30000,
      fixaAnterior: 190000,
      variavelAnterior: 25000,
    });
    const q = (await painel(outro, "?mes=2026-08")).json() as Painel;
    expect(q.despesasPorNatureza).toEqual({
      fixa: 0,
      variavel: 0,
      fixaAnterior: 0,
      variavelAnterior: 0,
    });
  });

  it("previsto com data passada conta como atrasado, em qualquer mês", async () => {
    const t = await entrar(env, { papel: "titular" });
    const cat = await categoria(t, "despesa");
    const c = await conta(t);
    await lancar(t, {
      categoriaId: cat.id,
      contaId: c.id,
      valor: 15000,
      data: "2026-02-01",
      status: "previsto",
    });
    const p = (await painel(t, "?mes=2026-06")).json() as Painel;
    expect(p.atrasados).toEqual({ quantidade: 1, receitas: 0, despesas: 15000 });
    expect(p.previstosDoMes.quantidade).toBe(0);
  });

  it("sem parâmetro usa o mês atual de São Paulo", async () => {
    const t = await entrar(env, { papel: "titular" });
    const p = (await painel(t)).json() as Painel;
    expect(p.mes).toBe(p.hoje.slice(0, 7));
    expect(p.hoje).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("deslocarMes", () => {
  it("atravessa a virada de ano nos dois sentidos", () => {
    expect(deslocarMes("2026-01", -1)).toBe("2025-12");
    expect(deslocarMes("2025-12", 1)).toBe("2026-01");
    expect(deslocarMes("2026-03", -5)).toBe("2025-10");
  });
});
