import { and, eq, gte, lt, lte, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { categoria, lancamento } from "../db/schema.js";
import { listarContas, type TipoConta } from "../contas/servico.js";

/**
 * Painel: leitura agregada dos lançamentos do titular. Só dados da Fase 1.
 * Conta só lançamento ativo e realizado; previstos aparecem à parte.
 * Tudo filtra por titular_id no servidor. Dinheiro em centavos (inteiro).
 */

const FUSO = "America/Sao_Paulo";
export const MESES_DA_SERIE = 6;

export interface TotaisMes {
  mes: string;
  receitas: number;
  despesas: number;
}

export interface GastoPorCategoria {
  id: string;
  nome: string;
  valor: number;
  anterior: number;
}

export interface ContaDoPainel {
  id: string;
  nome: string;
  tipo: TipoConta;
  saldo: number;
}

export interface MovimentoDaConta {
  id: string;
  nome: string;
  receitas: number;
  despesas: number;
}

export interface DespesasPorNatureza {
  fixa: number;
  variavel: number;
  fixaAnterior: number;
  variavelAnterior: number;
}

export interface Painel {
  mes: string;
  mesAnterior: string;
  hoje: string;
  atual: TotaisMes;
  anterior: TotaisMes;
  serie: TotaisMes[];
  previstosDoMes: { quantidade: number; receitas: number; despesas: number };
  atrasados: { quantidade: number; receitas: number; despesas: number };
  /** `null` quando o usuário não pode ver categorias. */
  despesasPorCategoria: GastoPorCategoria[] | null;
  /** Mesma leitura das despesas, para receitas. `null` quando não pode ver categorias. */
  receitasPorCategoria: GastoPorCategoria[] | null;
  /** Despesas realizadas do mês e do anterior, fixas × variáveis. Sem nomes de categoria. */
  despesasPorNatureza: DespesasPorNatureza;
  /** `null` quando o usuário não pode ver contas. */
  contas: { total: number; itens: ContaDoPainel[] } | null;
  /** Entradas e saídas realizadas no mês, por conta. `null` quando não pode ver contas. */
  movimentoPorConta: MovimentoDaConta[] | null;
}

export function dataDeHoje(agora: Date = new Date()): string {
  // en-CA formata como AAAA-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: FUSO,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(agora);
}

export function deslocarMes(mes: string, passos: number): string {
  const [a, m] = mes.split("-").map(Number) as [number, number];
  const total = a * 12 + (m - 1) + passos;
  const ano = Math.floor(total / 12);
  return `${ano}-${String((total % 12) + 1).padStart(2, "0")}`;
}

export function primeiroDia(mes: string): string {
  return `${mes}-01`;
}

function ultimoDia(mes: string): string {
  const [a, m] = mes.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(a, m, 0)).getUTCDate();
  return `${mes}-${String(d).padStart(2, "0")}`;
}

const num = (v: unknown): number => Number(v ?? 0);

export async function montarPainel(
  db: Db,
  titularId: string,
  mes: string,
  opcoes: { verCategorias: boolean; verContas: boolean; agora?: Date },
): Promise<Painel> {
  const hoje = dataDeHoje(opcoes.agora);
  const mesAnterior = deslocarMes(mes, -1);
  const inicioSerie = deslocarMes(mes, -(MESES_DA_SERIE - 1));
  const mesDoLancamento = sql<string>`to_char(${lancamento.data}, 'YYYY-MM')`;
  const total = sql<string>`coalesce(sum(${lancamento.valor}), 0)`;

  const realizadosAtivos = and(
    eq(lancamento.titularId, titularId),
    eq(lancamento.ativo, true),
    eq(lancamento.status, "realizado"),
  );

  // Série dos últimos meses: receitas e despesas realizadas por mês.
  const linhasSerie = await db
    .select({ mes: mesDoLancamento, tipo: lancamento.tipo, total })
    .from(lancamento)
    .where(
      and(
        realizadosAtivos,
        gte(lancamento.data, primeiroDia(inicioSerie)),
        lte(lancamento.data, ultimoDia(mes)),
      ),
    )
    .groupBy(mesDoLancamento, lancamento.tipo);

  const serie: TotaisMes[] = [];
  for (let i = MESES_DA_SERIE - 1; i >= 0; i--) {
    const m = deslocarMes(mes, -i);
    const doMes = linhasSerie.filter((l) => l.mes === m);
    serie.push({
      mes: m,
      receitas: num(doMes.find((l) => l.tipo === "receita")?.total),
      despesas: num(doMes.find((l) => l.tipo === "despesa")?.total),
    });
  }
  const atual = serie[serie.length - 1]!;
  const anterior = serie[serie.length - 2]!;

  // Previstos do mês e atrasados (previsto com data anterior a hoje, em qualquer mês).
  const previstoAtivo = and(
    eq(lancamento.titularId, titularId),
    eq(lancamento.ativo, true),
    eq(lancamento.status, "previsto"),
  );
  const agregarPrevistos = async (filtro: ReturnType<typeof and>) => {
    const linhas = await db
      .select({
        tipo: lancamento.tipo,
        n: sql<string>`count(*)`,
        total,
      })
      .from(lancamento)
      .where(filtro)
      .groupBy(lancamento.tipo);
    const r = linhas.find((l) => l.tipo === "receita");
    const d = linhas.find((l) => l.tipo === "despesa");
    return {
      quantidade: num(r?.n) + num(d?.n),
      receitas: num(r?.total),
      despesas: num(d?.total),
    };
  };
  const previstosDoMes = await agregarPrevistos(
    and(
      previstoAtivo,
      gte(lancamento.data, primeiroDia(mes)),
      lte(lancamento.data, ultimoDia(mes)),
    ),
  );
  const atrasados = await agregarPrevistos(and(previstoAtivo, lt(lancamento.data, hoje)));

  // Receitas e despesas por categoria-raiz, mês escolhido e anterior.
  let despesasPorCategoria: GastoPorCategoria[] | null = null;
  let receitasPorCategoria: GastoPorCategoria[] | null = null;
  if (opcoes.verCategorias) {
    const [cats, somas] = await Promise.all([
      db
        .select({ id: categoria.id, paiId: categoria.paiId, nome: categoria.nome })
        .from(categoria)
        .where(eq(categoria.titularId, titularId)),
      db
        .select({
          categoriaId: lancamento.categoriaId,
          tipo: lancamento.tipo,
          mes: mesDoLancamento,
          total,
        })
        .from(lancamento)
        .where(
          and(
            realizadosAtivos,
            gte(lancamento.data, primeiroDia(mesAnterior)),
            lte(lancamento.data, ultimoDia(mes)),
          ),
        )
        .groupBy(lancamento.categoriaId, lancamento.tipo, mesDoLancamento),
    ]);
    const porId = new Map(cats.map((c) => [c.id, c]));
    const raizDe = (id: string) => {
      let c = porId.get(id);
      for (let guarda = 0; c?.paiId && guarda < 5; guarda++) c = porId.get(c.paiId);
      return c;
    };
    const agrupar = (tipo: "receita" | "despesa"): GastoPorCategoria[] => {
      const grupos = new Map<string, GastoPorCategoria>();
      for (const s of somas) {
        if (s.tipo !== tipo) continue;
        const raiz = raizDe(s.categoriaId);
        if (!raiz) continue;
        const g = grupos.get(raiz.id) ?? { id: raiz.id, nome: raiz.nome, valor: 0, anterior: 0 };
        if (s.mes === mes) g.valor += num(s.total);
        else if (s.mes === mesAnterior) g.anterior += num(s.total);
        grupos.set(raiz.id, g);
      }
      return [...grupos.values()]
        .filter((g) => g.valor > 0 || g.anterior > 0)
        .sort((a, b) => b.valor - a.valor || b.anterior - a.anterior);
    };
    despesasPorCategoria = agrupar("despesa");
    receitasPorCategoria = agrupar("receita");
  }

  const porNatureza = await db
    .select({ natureza: lancamento.natureza, mes: mesDoLancamento, total })
    .from(lancamento)
    .where(
      and(
        realizadosAtivos,
        eq(lancamento.tipo, "despesa"),
        gte(lancamento.data, primeiroDia(mesAnterior)),
        lte(lancamento.data, ultimoDia(mes)),
      ),
    )
    .groupBy(lancamento.natureza, mesDoLancamento);
  const somaNat = (natureza: "fixa" | "variavel", m: string) =>
    num(porNatureza.find((l) => l.natureza === natureza && l.mes === m)?.total);
  const despesasPorNatureza: DespesasPorNatureza = {
    fixa: somaNat("fixa", mes),
    variavel: somaNat("variavel", mes),
    fixaAnterior: somaNat("fixa", mesAnterior),
    variavelAnterior: somaNat("variavel", mesAnterior),
  };

  let contas: Painel["contas"] = null;
  let movimentoPorConta: MovimentoDaConta[] | null = null;
  if (opcoes.verContas) {
    const [lista, movimentos] = await Promise.all([
      listarContas(db, titularId, false),
      db
        .select({ contaId: lancamento.contaId, tipo: lancamento.tipo, total })
        .from(lancamento)
        .where(
          and(
            realizadosAtivos,
            gte(lancamento.data, primeiroDia(mes)),
            lte(lancamento.data, ultimoDia(mes)),
          ),
        )
        .groupBy(lancamento.contaId, lancamento.tipo),
    ]);
    const itens = lista.map((c) => ({ id: c.id, nome: c.nome, tipo: c.tipo, saldo: c.saldo }));
    contas = { total: itens.reduce((s, c) => s + c.saldo, 0), itens };
    movimentoPorConta = lista
      .map((c) => ({
        id: c.id,
        nome: c.nome,
        receitas: num(movimentos.find((m) => m.contaId === c.id && m.tipo === "receita")?.total),
        despesas: num(movimentos.find((m) => m.contaId === c.id && m.tipo === "despesa")?.total),
      }))
      .filter((c) => c.receitas > 0 || c.despesas > 0)
      .sort((a, b) => b.despesas + b.receitas - (a.despesas + a.receitas));
  }

  return {
    mes,
    mesAnterior,
    hoje,
    atual,
    anterior,
    serie,
    previstosDoMes,
    atrasados,
    despesasPorCategoria,
    receitasPorCategoria,
    despesasPorNatureza,
    contas,
    movimentoPorConta,
  };
}
