import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  chamar,
  criarAmbiente,
  entrar,
  SENHA,
  type Ambiente,
  type Logado,
} from "../../test/ajudantes.js";

let env: Ambiente;

beforeAll(async () => {
  env = await criarAmbiente(80);
});
afterAll(async () => {
  await env.fechar();
});

const un = async (sql: string, params: unknown[] = []) =>
  (await env.owner.query(sql, params)).rows as Record<string, unknown>[];

const nomeUnico = (p = "Contato") => `${p} ${randomUUID().slice(0, 8)}`;

interface Contato {
  id: string;
  nome: string;
  tipo: "pf" | "pj";
  papel: "cliente" | "fornecedor" | "ambos";
  documento: string | null;
  observacao: string | null;
  ativo: boolean;
  recebido: number;
  pago: number;
  aReceber: number;
  aPagar: number;
  totalLancamentos: number;
}

const post = (q: Logado, corpo: object) => chamar(env, q, "POST", "/contatos", corpo);
const listar = (q: Logado, qs = "") => chamar(env, q, "GET", `/contatos${qs}`);
const patch = (q: Logado, id: string, corpo: object) =>
  chamar(env, q, "PATCH", `/contatos/${id}`, corpo);
const inativar = (q: Logado, id: string, senha = SENHA) =>
  chamar(env, q, "POST", `/contatos/${id}/inativar`, { senha });
const reativar = (q: Logado, id: string, senha = SENHA) =>
  chamar(env, q, "POST", `/contatos/${id}/reativar`, { senha });

async function criar(q: Logado, corpo: object): Promise<Contato> {
  const res = await post(q, corpo);
  expect(res.statusCode, res.body).toBe(201);
  return res.json() as Contato;
}

async function prepararBase(q: Logado) {
  const catDesp = (
    await chamar(env, q, "POST", "/categorias", { nome: nomeUnico("Desp"), tipo: "despesa" })
  ).json() as { id: string };
  const catRec = (
    await chamar(env, q, "POST", "/categorias", { nome: nomeUnico("Rec"), tipo: "receita" })
  ).json() as { id: string };
  const cta = (
    await chamar(env, q, "POST", "/contas", { nome: nomeUnico("Banco"), tipo: "banco" })
  ).json() as { id: string };
  return { catDespId: catDesp.id, catRecId: catRec.id, contaId: cta.id };
}

describe("contatos: criar, alterar, listar e resumo financeiro", () => {
  it("cria PF e PJ com documento limpo e registra no log", async () => {
    const t = await entrar(env, { papel: "titular" });
    const pj = await criar(t, {
      nome: "  CPFL Energia  ",
      tipo: "pj",
      papel: "fornecedor",
      documento: "12.345.678/0001-99",
      observacao: "Conta de luz",
    });
    expect(pj).toMatchObject({
      nome: "CPFL Energia",
      tipo: "pj",
      papel: "fornecedor",
      documento: "12345678000199",
      observacao: "Conta de luz",
      ativo: true,
      recebido: 0,
      pago: 0,
      aReceber: 0,
      aPagar: 0,
      totalLancamentos: 0,
    });

    const pf = await criar(t, {
      nome: "Maria Consultoria",
      tipo: "pf",
      papel: "cliente",
      documento: "123.456.789-00",
    });
    expect(pf.documento).toBe("12345678900");

    const [log] = await un(`SELECT * FROM log WHERE acao = 'contato.criado' AND entidade_id = $1`, [
      pj.id,
    ]);
    expect(log).toMatchObject({ usuario_id: t.id, titular_id: t.titularId, entidade: "contato" });
  });

  it("recusa CPF em PJ, CNPJ em PF, nome repetido e campo desconhecido", async () => {
    const t = await entrar(env, { papel: "titular" });
    expect(
      (await post(t, { nome: nomeUnico(), tipo: "pj", papel: "fornecedor", documento: "12345678901" }))
        .statusCode,
    ).toBe(400);
    expect(
      (
        await post(t, {
          nome: nomeUnico(),
          tipo: "pf",
          papel: "cliente",
          documento: "12345678000199",
        })
      ).statusCode,
    ).toBe(400);
    expect((await post(t, { nome: nomeUnico(), tipo: "pf", papel: "cliente", extra: 1 })).statusCode).toBe(
      400,
    );

    const nome = nomeUnico("Duplicado");
    await criar(t, { nome, tipo: "pj", papel: "ambos" });
    const dup = await post(t, { nome: nome.toUpperCase(), tipo: "pf", papel: "cliente" });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().codigo).toBe("nome_duplicado");
  });

  it("calcula recebido, pago, a receber (me deve) e a pagar (eu devo) e filtra lançamentos por contato", async () => {
    const t = await entrar(env, { papel: "titular" });
    const { catDespId, catRecId, contaId } = await prepararBase(t);
    const luz = await criar(t, { nome: "Enel Luz", tipo: "pj", papel: "fornecedor" });
    const cliente = await criar(t, { nome: "Acme Palestras", tipo: "pj", papel: "cliente" });

    // Pago à luz (realizado) + a pagar à luz (previsto)
    await chamar(env, t, "POST", "/lancamentos", {
      categoriaId: catDespId,
      contaId,
      contatoId: luz.id,
      valor: 18000,
      data: "2026-11-05",
      descricao: "Luz out",
      status: "realizado",
    });
    await chamar(env, t, "POST", "/lancamentos", {
      categoriaId: catDespId,
      contaId,
      contatoId: luz.id,
      valor: 21000,
      data: "2026-11-25",
      descricao: "Luz nov",
      status: "previsto",
    });
    // Recebido do cliente + a receber do cliente (me deve)
    await chamar(env, t, "POST", "/lancamentos", {
      categoriaId: catRecId,
      contaId,
      contatoId: cliente.id,
      valor: 150000,
      data: "2026-11-10",
      descricao: "Palestra 1",
      status: "realizado",
    });
    const prev = (
      await chamar(env, t, "POST", "/lancamentos", {
        categoriaId: catRecId,
        contaId,
        contatoId: cliente.id,
        valor: 250000,
        data: "2026-11-28",
        descricao: "Consultoria pendente",
        status: "previsto",
      })
    ).json() as { id: string };
    // Lançamento inativo não entra no resumo
    const inat = (
      await chamar(env, t, "POST", "/lancamentos", {
        categoriaId: catDespId,
        contaId,
        contatoId: luz.id,
        valor: 99999,
        data: "2026-11-01",
        descricao: "Cancelado",
      })
    ).json() as { id: string };
    await chamar(env, t, "POST", `/lancamentos/${inat.id}/inativar`, { senha: SENHA });

    const lista = (await listar(t)).json().contatos as Contato[];
    expect(lista.find((c) => c.id === luz.id)).toMatchObject({
      pago: 18000,
      aPagar: 21000,
      recebido: 0,
      aReceber: 0,
      totalLancamentos: 2,
    });
    expect(lista.find((c) => c.id === cliente.id)).toMatchObject({
      recebido: 150000,
      aReceber: 250000,
      pago: 0,
      aPagar: 0,
      totalLancamentos: 2,
    });

    // Filtro por contatoId em GET /lancamentos
    const daLuz = (await chamar(env, t, "GET", `/lancamentos?contatoId=${luz.id}`)).json()
      .lancamentos as { id: string; contatoId: string }[];
    expect(daLuz).toHaveLength(2);
    expect(daLuz.every((l) => l.contatoId === luz.id)).toBe(true);

    // Desvincular contato via PATCH (contatoId: null)
    const desvinculado = await chamar(env, t, "PATCH", `/lancamentos/${prev.id}`, { contatoId: null });
    expect(desvinculado.statusCode).toBe(200);
    expect(desvinculado.json().contatoId).toBeNull();
    const apos = (await listar(t)).json().contatos as Contato[];
    expect(apos.find((c) => c.id === cliente.id)!.aReceber).toBe(0);
  });

  it("altera contato e registra antes/depois no log", async () => {
    const t = await entrar(env, { papel: "titular" });
    const c = await criar(t, { nome: nomeUnico("Orig"), tipo: "pf", papel: "cliente" });
    const novoNome = nomeUnico("Novo");
    const res = await patch(t, c.id, { nome: novoNome, papel: "ambos" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ nome: novoNome, papel: "ambos" });
    const [log] = await un(`SELECT antes, depois FROM log WHERE acao = 'contato.alterado' AND entidade_id = $1`, [
      c.id,
    ]);
    expect(log!.antes).toEqual({ nome: c.nome, papel: "cliente" });
    expect(log!.depois).toEqual({ nome: novoNome, papel: "ambos" });
  });
});

describe("contatos: inativar, reativar e impedimentos", () => {
  it("recusa inativar com lançamento ativo; permite após inativar o lançamento e impede reativar lançamento com contato inativo", async () => {
    const t = await entrar(env, { papel: "titular" });
    const { catDespId, contaId } = await prepararBase(t);
    const c = await criar(t, { nome: nomeUnico("Fornecedor"), tipo: "pj", papel: "fornecedor" });
    const lanc = (
      await chamar(env, t, "POST", "/lancamentos", {
        categoriaId: catDespId,
        contaId,
        contatoId: c.id,
        valor: 5000,
        data: "2026-11-13",
        descricao: "Serviço",
      })
    ).json() as { id: string };

    const bloqueado = await inativar(t, c.id);
    expect(bloqueado.statusCode).toBe(409);
    expect(bloqueado.json()).toMatchObject({ codigo: "impedimentos", lancamentosAtivos: 1 });

    await chamar(env, t, "POST", `/lancamentos/${lanc.id}/inativar`, { senha: SENHA });
    expect((await inativar(t, c.id)).statusCode).toBe(200);

    // Em GET /inativos o contato aparece e o lançamento aponta impedimento contato_inativo
    const inativos = (await chamar(env, t, "GET", "/inativos")).json() as {
      contatos: { id: string }[];
      lancamentos: { id: string; impedimento: { codigo: string } | null }[];
    };
    expect(inativos.contatos.map((x) => x.id)).toContain(c.id);
    expect(inativos.lancamentos.find((x) => x.id === lanc.id)?.impedimento?.codigo).toBe("contato_inativo");

    // Reativar lançamento com contato inativo é recusado
    const reatLanc = await chamar(env, t, "POST", `/lancamentos/${lanc.id}/reativar`, { senha: SENHA });
    expect(reatLanc.statusCode).toBe(409);
    expect(reatLanc.json().codigo).toBe("contato_inativo");

    // Depois de reativar o contato, o lançamento pode voltar
    expect((await reativar(t, c.id)).statusCode).toBe(200);
    expect((await chamar(env, t, "POST", `/lancamentos/${lanc.id}/reativar`, { senha: SENHA })).statusCode).toBe(
      200,
    );
  });
});

describe("contatos: permissões de vinculado", () => {
  it("respeita ver, cadastrar, alterar e excluir separadamente e exige contatos.ver para vincular no lançamento", async () => {
    const t = await entrar(env, { papel: "titular" });
    const { catDespId, contaId } = await prepararBase(t);
    const c = await criar(t, { nome: nomeUnico("Perm"), tipo: "pf", papel: "cliente" });

    const sem = await entrar(env, { papel: "vinculado", titularId: t.titularId });
    expect((await listar(sem)).statusCode).toBe(403);
    expect((await post(sem, { nome: nomeUnico(), tipo: "pf", papel: "cliente" })).statusCode).toBe(403);
    expect((await patch(sem, c.id, { nome: "X" })).statusCode).toBe(403);
    expect((await inativar(sem, c.id)).statusCode).toBe(403);

    // Vinculado pode lançar sem contato, mas NÃO pode vincular contatoId sem contatos.ver
    const lancadorSemContato = await entrar(env, {
      papel: "vinculado",
      titularId: t.titularId,
      permissoes: {
        lancamentos: { ver: true, cadastrar: true },
        categorias: { ver: true },
        contas: { ver: true },
      },
    });
    expect(
      (
        await chamar(env, lancadorSemContato, "POST", "/lancamentos", {
          categoriaId: catDespId,
          contaId,
          contatoId: c.id,
          valor: 100,
          data: "2026-11-13",
          descricao: "Sem perm contato",
        })
      ).statusCode,
    ).toBe(403);

    const comVer = await entrar(env, {
      papel: "vinculado",
      titularId: t.titularId,
      permissoes: { contatos: { ver: true } },
    });
    expect((await listar(comVer)).statusCode).toBe(200);
    expect((await post(comVer, { nome: nomeUnico(), tipo: "pf", papel: "cliente" })).statusCode).toBe(403);
  });
});
