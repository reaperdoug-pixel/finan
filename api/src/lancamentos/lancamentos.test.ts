import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  chamar,
  criarAmbiente,
  entrar,
  SENHA,
  type Ambiente,
  type Logado,
} from "../../test/ajudantes.js";
import { criarLancamento } from "./servico.js";
import { createDb } from "../db/client.js";

let env: Ambiente;

beforeAll(async () => {
  env = await criarAmbiente(76);
});
afterAll(async () => {
  await env.fechar();
});

const un = async (sql: string, params: unknown[] = []) =>
  (await env.owner.query(sql, params)).rows as Record<string, unknown>[];

const nomeUnico = (p = "X") => `${p} ${randomUUID().slice(0, 8)}`;

interface Cat {
  id: string;
  tipo: "receita" | "despesa";
  natureza: "fixa" | "variavel";
}
interface Conta {
  id: string;
}
interface Lanc {
  id: string;
  data: string;
  descricao: string;
  observacao: string | null;
  valor: number;
  tipo: "receita" | "despesa";
  natureza: "fixa" | "variavel";
  status: "previsto" | "realizado";
  origem: "manual";
  categoriaId: string;
  contaId: string;
  valorPrevistoOriginal: number | null;
  ativo: boolean;
}

const post = (q: Logado, corpo: object) => chamar(env, q, "POST", "/lancamentos", corpo);
const listar = (q: Logado, qs = "") => chamar(env, q, "GET", `/lancamentos${qs}`);
const inativar = (q: Logado, id: string, senha: string | undefined = SENHA) =>
  chamar(env, q, "POST", `/lancamentos/${id}/inativar`, senha === undefined ? {} : { senha });
const reativar = (q: Logado, id: string, senha: string | undefined = SENHA) =>
  chamar(env, q, "POST", `/lancamentos/${id}/reativar`, senha === undefined ? {} : { senha });

async function folhaEConta(
  t: Logado,
  tipo: "receita" | "despesa" = "despesa",
): Promise<{ cat: Cat; conta: Conta }> {
  const catRes = await chamar(env, t, "POST", "/categorias", {
    nome: nomeUnico("Cat"),
    tipo,
    natureza: tipo === "receita" ? "fixa" : "variavel",
  });
  expect(catRes.statusCode, catRes.body).toBe(201);
  const contaRes = await chamar(env, t, "POST", "/contas", {
    nome: nomeUnico("Conta"),
    tipo: "carteira",
  });
  expect(contaRes.statusCode, contaRes.body).toBe(201);
  return { cat: catRes.json() as Cat, conta: contaRes.json() as Conta };
}

async function criar(q: Logado, corpo: object): Promise<Lanc> {
  const res = await post(q, corpo);
  expect(res.statusCode, res.body).toBe(201);
  return res.json() as Lanc;
}

async function lancar(
  t: Logado,
  extra: object = {},
  tipo: "receita" | "despesa" = "despesa",
): Promise<{ lanc: Lanc; cat: Cat; conta: Conta }> {
  const fx = await folhaEConta(t, tipo);
  const lanc = await criar(t, {
    categoriaId: fx.cat.id,
    contaId: fx.conta.id,
    valor: 1000,
    data: "2026-11-13",
    descricao: "Teste",
    ...extra,
  });
  return { lanc, ...fx };
}

const estado = async (id: string) =>
  (await un(
    `SELECT ativo, valor, status, categoria_id, conta_id, inativado_em, inativado_por, valor_previsto_original
     FROM lancamento WHERE id = $1`,
    [id],
  ))[0]!;

describe("criar lançamento", () => {
  it("folha: herda tipo e natureza, status realizado por padrão, vai para o log", async () => {
    const t = await entrar(env, { papel: "titular" });
    const { cat, conta } = await folhaEConta(t);
    const l = await criar(t, {
      categoriaId: cat.id,
      contaId: conta.id,
      valor: 2590,
      data: "2026-11-13",
      descricao: "  Padaria  ",
    });
    expect(l).toMatchObject({
      descricao: "Padaria",
      observacao: null,
      valor: 2590,
      tipo: "despesa",
      natureza: cat.natureza,
      status: "realizado",
      origem: "manual",
      categoriaId: cat.id,
      contaId: conta.id,
      valorPrevistoOriginal: null,
      ativo: true,
      data: "2026-11-13",
    });
    const [linha] = await un(`SELECT titular_id, criado_por FROM lancamento WHERE id = $1`, [l.id]);
    expect(linha).toEqual({ titular_id: t.titularId, criado_por: t.id });
    const [log] = await un(`SELECT acao, depois FROM log WHERE acao = 'lancamento.criado' AND entidade_id = $1`, [
      l.id,
    ]);
    expect(log!.depois).toMatchObject({ valor: 2590, descricao: "Padaria", status: "realizado" });
  });

  it("natureza e status informados valem; previsto não muda o saldo da conta", async () => {
    const t = await entrar(env, { papel: "titular" });
    const { cat, conta } = await folhaEConta(t);
    await criar(t, {
      categoriaId: cat.id,
      contaId: conta.id,
      valor: 5000,
      data: "2026-11-01",
      descricao: "Aluguel",
      natureza: "fixa",
      status: "previsto",
    });
    const contas = (await chamar(env, t, "GET", "/contas")).json().contas as { id: string; saldo: number }[];
    expect(contas.find((c) => c.id === conta.id)!.saldo).toBe(0);
  });

  it("receita realizada entra no saldo da conta", async () => {
    const t = await entrar(env, { papel: "titular" });
    const { cat, conta } = await folhaEConta(t, "receita");
    await criar(t, {
      categoriaId: cat.id,
      contaId: conta.id,
      valor: 10_000,
      data: "2026-11-05",
      descricao: "Salário",
    });
    const contas = (await chamar(env, t, "GET", "/contas")).json().contas as { id: string; saldo: number }[];
    expect(contas.find((c) => c.id === conta.id)!.saldo).toBe(10_000);
  });

  it("mãe com filha ativa não aceita lançamento (409); a folha aceita", async () => {
    const t = await entrar(env, { papel: "titular" });
    const maeRes = await chamar(env, t, "POST", "/categorias", { nome: nomeUnico("Mae"), tipo: "despesa" });
    const mae = maeRes.json() as Cat;
    await chamar(env, t, "POST", "/categorias", { nome: nomeUnico("Filha"), paiId: mae.id });
    const { conta } = await folhaEConta(t);
    const naMae = await post(t, {
      categoriaId: mae.id,
      contaId: conta.id,
      valor: 100,
      data: "2026-11-13",
      descricao: "X",
    });
    expect(naMae.statusCode).toBe(409);
    expect(naMae.json().codigo).toBe("nao_e_folha");
    const filha = (
      await chamar(env, t, "POST", "/categorias", { nome: nomeUnico("Folha"), paiId: mae.id })
    ).json() as Cat;
    expect(
      (
        await post(t, {
          categoriaId: filha.id,
          contaId: conta.id,
          valor: 100,
          data: "2026-11-13",
          descricao: "Ok",
        })
      ).statusCode,
    ).toBe(201);
  });

  it("tipo diferente da categoria, valor não inteiro ou data inválida: 400", async () => {
    const t = await entrar(env, { papel: "titular" });
    const { cat, conta } = await folhaEConta(t);
    const base = { categoriaId: cat.id, contaId: conta.id, valor: 100, data: "2026-11-13", descricao: "X" };
    expect((await post(t, { ...base, tipo: "receita" })).statusCode).toBe(400);
    expect((await post(t, { ...base, valor: 10.5 })).statusCode).toBe(400);
    expect((await post(t, { ...base, valor: 0 })).statusCode).toBe(400);
    expect((await post(t, { ...base, data: "13/11/2026" })).statusCode).toBe(400);
    expect((await post(t, { ...base, data: "2026-02-30" })).statusCode).toBe(400);
  });

  it("categoria ou conta inativa, ou de outro titular: 409/404 e nada é criado", async () => {
    const t = await entrar(env, { papel: "titular" });
    const outro = await entrar(env, { papel: "titular" });
    const { cat, conta } = await folhaEConta(t);
    const fxOutro = await folhaEConta(outro);
    await chamar(env, t, "POST", `/categorias/${cat.id}/inativar`, { senha: SENHA });
    const catInativa = await post(t, {
      categoriaId: cat.id,
      contaId: conta.id,
      valor: 100,
      data: "2026-11-13",
      descricao: "X",
    });
    expect(catInativa.statusCode).toBe(409);
    expect(catInativa.json().codigo).toBe("categoria_inativa");

    const { cat: cat2, conta: conta2 } = await folhaEConta(t);
    await chamar(env, t, "POST", `/contas/${conta2.id}/inativar`, { senha: SENHA });
    expect(
      (
        await post(t, {
          categoriaId: cat2.id,
          contaId: conta2.id,
          valor: 100,
          data: "2026-11-13",
          descricao: "X",
        })
      ).json().codigo,
    ).toBe("conta_inativa");

    expect(
      (
        await post(t, {
          categoriaId: fxOutro.cat.id,
          contaId: conta.id,
          valor: 100,
          data: "2026-11-13",
          descricao: "X",
        })
      ).statusCode,
    ).toBe(404);
  });
});

describe("listar e filtros", () => {
  it("esconde inativos por padrão; filtra por data, categoria, conta, tipo e status", async () => {
    const t = await entrar(env, { papel: "titular" });
    const desp = await folhaEConta(t, "despesa");
    const rec = await folhaEConta(t, "receita");
    const a = await criar(t, {
      categoriaId: desp.cat.id,
      contaId: desp.conta.id,
      valor: 100,
      data: "2026-11-01",
      descricao: "A",
      status: "realizado",
    });
    await criar(t, {
      categoriaId: rec.cat.id,
      contaId: rec.conta.id,
      valor: 200,
      data: "2026-11-15",
      descricao: "B",
      status: "previsto",
    });
    const c = await criar(t, {
      categoriaId: desp.cat.id,
      contaId: desp.conta.id,
      valor: 300,
      data: "2026-10-20",
      descricao: "C",
    });
    await inativar(t, c.id);

    const todos = (await listar(t)).json().lancamentos as Lanc[];
    expect(todos.map((x) => x.descricao).sort()).toEqual(["A", "B"]);

    const comInativos = (await listar(t, "?incluirInativos=true")).json().lancamentos as Lanc[];
    expect(comInativos.map((x) => x.id)).toContain(c.id);

    const porData = (await listar(t, "?dataDesde=2026-11-01&dataAte=2026-11-10")).json()
      .lancamentos as Lanc[];
    expect(porData.map((x) => x.id)).toEqual([a.id]);

    const porCat = (await listar(t, `?categoriaId=${rec.cat.id}`)).json().lancamentos as Lanc[];
    expect(porCat).toHaveLength(1);
    expect(porCat[0]!.descricao).toBe("B");

    const previstos = (await listar(t, "?status=previsto")).json().lancamentos as Lanc[];
    expect(previstos.every((x) => x.status === "previsto")).toBe(true);

    const receitas = (await listar(t, "?tipo=receita")).json().lancamentos as Lanc[];
    expect(receitas.every((x) => x.tipo === "receita")).toBe(true);
  });

  it("cada titular vê só os seus; parâmetro inválido 400; sem login 401", async () => {
    const a = await entrar(env, { papel: "titular" });
    const b = await entrar(env, { papel: "titular" });
    const la = await lancar(a);
    await lancar(b);
    const ids = ((await listar(a)).json().lancamentos as Lanc[]).map((x) => x.id);
    expect(ids).toEqual([la.lanc.id]);
    expect((await listar(a, "?status=pago")).statusCode).toBe(400);
    expect((await env.app.inject({ method: "GET", url: "/lancamentos" })).statusCode).toBe(401);
  });

  it("ordena do mais recente para o mais antigo e pagina", async () => {
    const t = await entrar(env, { papel: "titular" });
    const { cat, conta } = await folhaEConta(t);
    await criar(t, {
      categoriaId: cat.id,
      contaId: conta.id,
      valor: 1,
      data: "2026-01-01",
      descricao: "velho",
    });
    await criar(t, {
      categoriaId: cat.id,
      contaId: conta.id,
      valor: 1,
      data: "2026-03-01",
      descricao: "novo",
    });
    const p1 = (await listar(t, "?limite=1&pagina=1")).json();
    expect((p1.lancamentos as Lanc[])[0]!.descricao).toBe("novo");
    expect(p1.total).toBe(2);
    const p2 = (await listar(t, "?limite=1&pagina=2")).json().lancamentos as Lanc[];
    expect(p2[0]!.descricao).toBe("velho");
  });
});

describe("alterar lançamento", () => {
  it("edita valor, data e descrição mesmo de mês passado; o log guarda só o que mudou", async () => {
    const t = await entrar(env, { papel: "titular" });
    const { lanc } = await lancar(t, { data: "2026-01-15", valor: 100, descricao: "Antigo" });
    const res = await chamar(env, t, "PATCH", `/lancamentos/${lanc.id}`, {
      valor: 180,
      descricao: "Corrigido",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ valor: 180, descricao: "Corrigido", data: "2026-01-15" });
    const [l] = await un(
      `SELECT antes, depois FROM log WHERE acao = 'lancamento.alterado' AND entidade_id = $1`,
      [lanc.id],
    );
    expect(l!.antes).toEqual({ valor: 100, descricao: "Antigo" });
    expect(l!.depois).toEqual({ valor: 180, descricao: "Corrigido" });
  });

  it("ao realizar um previsto, guarda o valor previsto original no registro e no log", async () => {
    const t = await entrar(env, { papel: "titular" });
    const { lanc } = await lancar(t, { valor: 15000, status: "previsto", descricao: "Luz" });
    const res = await chamar(env, t, "PATCH", `/lancamentos/${lanc.id}`, {
      status: "realizado",
      valor: 17800,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      status: "realizado",
      valor: 17800,
      valorPrevistoOriginal: 15000,
    });
    const [l] = await un(
      `SELECT depois FROM log WHERE acao = 'lancamento.alterado' AND entidade_id = $1`,
      [lanc.id],
    );
    expect(l!.depois).toMatchObject({
      status: "realizado",
      valor: 17800,
      valorPrevistoOriginal: 15000,
    });
  });

  it("sem mudança real: 200 e nada no log. Corpo vazio ou campo desconhecido: 400", async () => {
    const t = await entrar(env, { papel: "titular" });
    const { lanc } = await lancar(t);
    const antes = (await un(`SELECT count(*)::int AS n FROM log WHERE entidade_id = $1`, [lanc.id]))[0]!.n;
    expect((await chamar(env, t, "PATCH", `/lancamentos/${lanc.id}`, { descricao: "Teste" })).statusCode).toBe(
      200,
    );
    const depois = (await un(`SELECT count(*)::int AS n FROM log WHERE entidade_id = $1`, [lanc.id]))[0]!.n;
    expect(depois).toBe(antes);
    expect((await chamar(env, t, "PATCH", `/lancamentos/${lanc.id}`, {})).statusCode).toBe(400);
    expect((await chamar(env, t, "PATCH", `/lancamentos/${lanc.id}`, { origem: "media" })).statusCode).toBe(
      400,
    );
  });

  it("inativo, inexistente ou de outro titular: 409/404", async () => {
    const t = await entrar(env, { papel: "titular" });
    const outro = await entrar(env, { papel: "titular" });
    const { lanc } = await lancar(t);
    await inativar(t, lanc.id);
    expect((await chamar(env, t, "PATCH", `/lancamentos/${lanc.id}`, { descricao: "X" })).statusCode).toBe(
      409,
    );
    expect((await chamar(env, outro, "PATCH", `/lancamentos/${lanc.id}`, { descricao: "X" })).statusCode).toBe(
      404,
    );
  });
});

describe("inativar e reativar", () => {
  it("inativa com senha, nada é apagado, some do saldo e vai para o log", async () => {
    const t = await entrar(env, { papel: "titular" });
    const { lanc, conta } = await lancar(t, { valor: 5000 }, "receita");
    const antes = (
      (await chamar(env, t, "GET", "/contas")).json().contas as { id: string; saldo: number }[]
    ).find((c) => c.id === conta.id)!.saldo;
    expect(antes).toBe(5000);
    const res = await inativar(t, lanc.id);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ativo: false });
    expect((await estado(lanc.id)).ativo).toBe(false);
    expect((await un(`SELECT 1 FROM lancamento WHERE id = $1`, [lanc.id])).length).toBe(1);
    const depois = (
      (await chamar(env, t, "GET", "/contas")).json().contas as { id: string; saldo: number }[]
    ).find((c) => c.id === conta.id)!.saldo;
    expect(depois).toBe(0);
    const [l] = await un(
      `SELECT confirmado_por FROM log WHERE acao = 'lancamento.inativado' AND entidade_id = $1`,
      [lanc.id],
    );
    expect(l!.confirmado_por).toBe(t.id);
  });

  it("reativa se categoria e conta estiverem ativas", async () => {
    const t = await entrar(env, { papel: "titular" });
    const { lanc } = await lancar(t);
    await inativar(t, lanc.id);
    const res = await reativar(t, lanc.id);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ativo: true });
    expect((await estado(lanc.id)).ativo).toBe(true);
  });

  it("não reativa se a categoria ou a conta estiver inativa", async () => {
    const t = await entrar(env, { papel: "titular" });
    const a = await lancar(t);
    await inativar(t, a.lanc.id);
    await chamar(env, t, "POST", `/categorias/${a.cat.id}/inativar`, { senha: SENHA });
    const catInativa = await reativar(t, a.lanc.id);
    expect(catInativa.statusCode).toBe(409);
    expect(catInativa.json().codigo).toBe("categoria_inativa");

    const b = await lancar(t);
    await inativar(t, b.lanc.id);
    await chamar(env, t, "POST", `/contas/${b.conta.id}/inativar`, { senha: SENHA });
    const contaInativa = await reativar(t, b.lanc.id);
    expect(contaInativa.statusCode).toBe(409);
    expect(contaInativa.json().codigo).toBe("conta_inativa");
  });

  it("já inativo/já ativo: 409. Outro titular: 404", async () => {
    const t = await entrar(env, { papel: "titular" });
    const outro = await entrar(env, { papel: "titular" });
    const { lanc } = await lancar(t);
    expect((await reativar(t, lanc.id)).statusCode).toBe(409);
    await inativar(t, lanc.id);
    expect((await inativar(t, lanc.id)).statusCode).toBe(409);
    expect((await inativar(outro, lanc.id)).statusCode).toBe(404);
  });
});

describe("permissões do módulo lançamentos", () => {
  type Acao = "ver" | "cadastrar" | "alterar" | "excluir";
  const ACOES: Acao[] = ["ver", "cadastrar", "alterar", "excluir"];
  const com = (acoes: Acao[]) => {
    const p: Record<string, boolean> = {};
    for (const a of acoes) p[a] = true;
    if ((p.alterar || p.excluir) && !p.ver) p.ver = true;
    return p;
  };

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
        url: "/lancamentos",
        intacto: async () => true,
        statusOk: 200,
      }),
    },
    {
      nome: "criar",
      acao: "cadastrar",
      preparar: async (t) => {
        const fx = await folhaEConta(t);
        const descricao = nomeUnico("Lanc");
        return {
          metodo: "POST",
          url: "/lancamentos",
          corpo: {
            categoriaId: fx.cat.id,
            contaId: fx.conta.id,
            valor: 100,
            data: "2026-11-13",
            descricao,
          },
          intacto: async () =>
            (await un(`SELECT 1 FROM lancamento WHERE descricao = $1`, [descricao])).length === 0,
          statusOk: 201,
        };
      },
    },
    {
      nome: "alterar",
      acao: "alterar",
      preparar: async (t) => {
        const { lanc } = await lancar(t);
        return {
          metodo: "PATCH",
          url: `/lancamentos/${lanc.id}`,
          corpo: { descricao: nomeUnico("Outro") },
          intacto: async () => (await estado(lanc.id)).valor === lanc.valor,
          statusOk: 200,
        };
      },
    },
    {
      nome: "inativar",
      acao: "excluir",
      preparar: async (t) => {
        const { lanc } = await lancar(t);
        return {
          metodo: "POST",
          url: `/lancamentos/${lanc.id}/inativar`,
          corpo: { senha: SENHA },
          intacto: async () => (await estado(lanc.id)).ativo === true,
          statusOk: 200,
        };
      },
    },
    {
      nome: "reativar",
      acao: "excluir",
      preparar: async (t) => {
        const { lanc } = await lancar(t);
        await inativar(t, lanc.id);
        return {
          metodo: "POST",
          url: `/lancamentos/${lanc.id}/reativar`,
          corpo: { senha: SENHA },
          intacto: async () => (await estado(lanc.id)).ativo === false,
          statusOk: 200,
        };
      },
    },
  ];

  describe.each(operacoes)("$nome (exige $acao)", (op) => {
    const vinculadoCom = (t: Logado, perms: Record<string, Record<string, boolean>>) =>
      entrar(env, { papel: "vinculado", titularId: t.titularId, permissoes: perms });

    it("vinculado sem nenhuma permissão: 403 e nada muda", async () => {
      const t = await entrar(env, { papel: "titular" });
      const alvo = await op.preparar(t);
      const v = await vinculadoCom(t, {});
      expect((await chamar(env, v, alvo.metodo, alvo.url, alvo.corpo)).statusCode).toBe(403);
      expect(await alvo.intacto()).toBe(true);
    });

    it("só com a permissão exata: funciona", async () => {
      const t = await entrar(env, { papel: "titular" });
      const alvo = await op.preparar(t);
      const extra: Record<string, Record<string, boolean>> =
        op.acao === "cadastrar" ? { categorias: com(["ver"]), contas: com(["ver"]) } : {};
      const v = await vinculadoCom(t, { lancamentos: com([op.acao]), ...extra });
      expect((await chamar(env, v, alvo.metodo, alvo.url, alvo.corpo)).statusCode).toBe(alvo.statusOk);
    });

    it("com todas as outras ações, menos esta: 403 e nada muda", async () => {
      const t = await entrar(env, { papel: "titular" });
      const alvo = await op.preparar(t);
      const outras = ACOES.filter((a) => a !== op.acao);
      const v = await vinculadoCom(t, {
        lancamentos: com(op.acao === "ver" ? outras.filter((a) => a === "cadastrar") : outras),
        categorias: com(["ver"]),
        contas: com(["ver"]),
      });
      expect((await chamar(env, v, alvo.metodo, alvo.url, alvo.corpo)).statusCode).toBe(403);
      expect(await alvo.intacto()).toBe(true);
    });
  });

  it("lançar sem ver categorias e contas: 403 mesmo com cadastrar em lançamentos", async () => {
    const t = await entrar(env, { papel: "titular" });
    const fx = await folhaEConta(t);
    const v = await entrar(env, {
      papel: "vinculado",
      titularId: t.titularId,
      permissoes: { lancamentos: com(["cadastrar"]) },
    });
    const res = await chamar(env, v, "POST", "/lancamentos", {
      categoriaId: fx.cat.id,
      contaId: fx.conta.id,
      valor: 100,
      data: "2026-11-13",
      descricao: "X",
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("isolamento entre titulares", () => {
  it("outro titular não vê nem mexe: 404 e nada muda", async () => {
    const a = await entrar(env, { papel: "titular" });
    const b = await entrar(env, { papel: "titular" });
    const { lanc } = await lancar(a);
    expect(
      (await chamar(env, b, "PATCH", `/lancamentos/${lanc.id}`, { descricao: "Invadido" })).statusCode,
    ).toBe(404);
    expect((await inativar(b, lanc.id)).statusCode).toBe(404);
    const ids = ((await listar(b, "?incluirInativos=true")).json().lancamentos as Lanc[]).map((x) => x.id);
    expect(ids).not.toContain(lanc.id);
    expect((await estado(lanc.id)).ativo).toBe(true);
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

  it("o papel da API não apaga lançamento", async () => {
    expect(await codigo(env.appPool, `DELETE FROM lancamento`)).toBe("42501");
  });

  it("valor zero ou negativo é recusado", async () => {
    const t = await entrar(env, { papel: "titular" });
    const { cat, conta } = await folhaEConta(t);
    const base = `INSERT INTO lancamento
      (titular_id, categoria_id, conta_id, valor, tipo, status, data, descricao, natureza, origem)
      VALUES ($1, $2, $3, $4, 'despesa', 'realizado', '2026-11-13', 'x', 'variavel', 'manual')`;
    expect(await codigo(env.owner, base, [t.titularId, cat.id, conta.id, 0])).toBe("23514");
    expect(await codigo(env.owner, base, [t.titularId, cat.id, conta.id, -1])).toBe("23514");
  });

  it("o banco recusa lançamento em categoria que tem filha ativa", async () => {
    const t = await entrar(env, { papel: "titular" });
    const mae = (await chamar(env, t, "POST", "/categorias", { nome: nomeUnico("Mae"), tipo: "despesa" }))
      .json() as Cat;
    await chamar(env, t, "POST", "/categorias", { nome: nomeUnico("Filha"), paiId: mae.id });
    const { conta } = await folhaEConta(t);
    expect(
      await codigo(
        env.owner,
        `INSERT INTO lancamento
           (titular_id, categoria_id, conta_id, valor, tipo, status, data, descricao, natureza, origem)
         VALUES ($1, $2, $3, 1, 'despesa', 'realizado', '2026-11-13', 'x', 'variavel', 'manual')`,
        [t.titularId, mae.id, conta.id],
      ),
    ).toBe("23514");
  });
});

describe("serviço chamado direto", () => {
  it("recusa categoria que não é folha", async () => {
    const t = await entrar(env, { papel: "titular" });
    const mae = (await chamar(env, t, "POST", "/categorias", { nome: nomeUnico(), tipo: "despesa" })).json() as Cat;
    await chamar(env, t, "POST", "/categorias", { nome: nomeUnico(), paiId: mae.id });
    const conta = (await chamar(env, t, "POST", "/contas", { nome: nomeUnico(), tipo: "carteira" })).json() as Conta;
    const db = createDb(env.appPool);
    await expect(
      criarLancamento(
        db,
        { titularId: t.titularId, usuarioId: t.id, ip: "127.0.0.1" },
        {
          categoriaId: mae.id,
          contaId: conta.id,
          valor: 100,
          data: "2026-11-13",
          descricao: "X",
        },
      ),
    ).rejects.toMatchObject({ codigo: "nao_e_folha" });
  });
});
