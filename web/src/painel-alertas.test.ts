import { describe, expect, it } from "vitest";
import { gerarAlertas, variacao } from "./painel-alertas";
import type { Painel } from "./tipos";

function base(sobre: Partial<Painel> = {}): Painel {
  return {
    mes: "2026-11",
    mesAnterior: "2026-10",
    hoje: "2026-11-13",
    atual: { mes: "2026-11", receitas: 500000, despesas: 200000 },
    anterior: { mes: "2026-10", receitas: 500000, despesas: 210000 },
    serie: [],
    previstosDoMes: { quantidade: 0, receitas: 0, despesas: 0 },
    atrasados: { quantidade: 0, receitas: 0, despesas: 0 },
    despesasPorCategoria: [],
    receitasPorCategoria: [],
    despesasPorNatureza: { fixa: 0, variavel: 0, fixaAnterior: 0, variavelAnterior: 0 },
    movimentoPorConta: [],
    contas: { total: 300000, itens: [{ id: "a", nome: "Conta", tipo: "banco", saldo: 300000 }] },
    ...sobre,
  };
}

describe("variacao", () => {
  it("calcula diferença e percentual arredondado", () => {
    expect(variacao(15000, 10000)).toEqual({ abs: 5000, pct: 50 });
    expect(variacao(8000, 10000)).toEqual({ abs: -2000, pct: -20 });
  });
  it("sem valor anterior não inventa percentual", () => {
    expect(variacao(5000, 0)).toEqual({ abs: 5000, pct: null });
  });
});

describe("gerarAlertas", () => {
  it("mês saudável não gera aviso", () => {
    expect(gerarAlertas(base())).toEqual([]);
  });

  it("conta no negativo é crítico e leva para Contas", () => {
    const a = gerarAlertas(
      base({
        contas: {
          total: -3500,
          itens: [{ id: "c", nome: "Carteira", tipo: "carteira", saldo: -3500 }],
        },
      }),
    );
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({
      nivel: "critico",
      titulo: "Carteira está no negativo",
      para: "/contas",
    });
  });

  it("saldo que não cobre os previstos é crítico", () => {
    const a = gerarAlertas(
      base({
        contas: { total: 10000, itens: [{ id: "a", nome: "Conta", tipo: "banco", saldo: 10000 }] },
        previstosDoMes: { quantidade: 2, receitas: 0, despesas: 60000 },
      }),
    );
    expect(a.map((x) => x.id)).toContain("saldo-nao-cobre-previstos");
    expect(a[0]!.detalhe).toContain("500,00");
  });

  it("receita prevista abate o que falta cobrir", () => {
    const a = gerarAlertas(
      base({
        contas: { total: 10000, itens: [{ id: "a", nome: "Conta", tipo: "banco", saldo: 10000 }] },
        previstosDoMes: { quantidade: 2, receitas: 60000, despesas: 60000 },
      }),
    );
    expect(a).toEqual([]);
  });

  it("despesa acima da receita: crítico com receita, atenção sem receita ainda", () => {
    const comReceita = gerarAlertas(
      base({ atual: { mes: "2026-11", receitas: 100000, despesas: 150000 } }),
    );
    expect(comReceita[0]).toMatchObject({ id: "despesas-acima-das-receitas", nivel: "critico" });
    const semReceita = gerarAlertas(
      base({ atual: { mes: "2026-11", receitas: 0, despesas: 150000 } }),
    );
    expect(semReceita[0]).toMatchObject({ id: "despesas-acima-das-receitas", nivel: "atencao" });
  });

  it("previstos atrasados pedem atenção, no singular e no plural", () => {
    const um = gerarAlertas(base({ atrasados: { quantidade: 1, receitas: 0, despesas: 100 } }));
    expect(um[0]!.titulo).toBe("1 lançamento previsto atrasou");
    expect(um[0]!.para).toBe("/lancamentos?status=previsto&periodo=todos");
    const tres = gerarAlertas(base({ atrasados: { quantidade: 3, receitas: 0, despesas: 100 } }));
    expect(tres[0]!.titulo).toBe("3 lançamentos previstos atrasaram");
  });

  it("só avisa de categoria que subiu pelo menos 20% e R$ 50", () => {
    const quase = gerarAlertas(
      base({
        despesasPorCategoria: [
          { id: "1", nome: "Pequena", valor: 1500, anterior: 1000 }, // +50%, mas só R$ 5
          { id: "2", nome: "Grande", valor: 110000, anterior: 100000 }, // +R$ 100, mas só 10%
        ],
      }),
    );
    expect(quase).toEqual([]);
    const sobe = gerarAlertas(
      base({
        despesasPorCategoria: [
          { id: "3", nome: "Mercado", valor: 142000, anterior: 100000 },
          { id: "4", nome: "Lazer", valor: 30000, anterior: 20000 },
        ],
      }),
    );
    expect(sobe).toHaveLength(1);
    expect(sobe[0]).toMatchObject({ nivel: "atencao", titulo: "Mercado subiu 42%" });
  });

  it("categoria nova (sem mês anterior) não vira aviso de subida", () => {
    const a = gerarAlertas(
      base({ despesasPorCategoria: [{ id: "5", nome: "Nova", valor: 90000, anterior: 0 }] }),
    );
    expect(a).toEqual([]);
  });

  it("sem permissão para ver contas ou categorias, não avisa o que não pode ver", () => {
    const a = gerarAlertas(base({ contas: null, despesasPorCategoria: null }));
    expect(a).toEqual([]);
  });

  it("ordena do mais grave para o menos grave", () => {
    const a = gerarAlertas(
      base({
        atrasados: { quantidade: 2, receitas: 0, despesas: 100 },
        contas: {
          total: -100,
          itens: [{ id: "c", nome: "Carteira", tipo: "carteira", saldo: -100 }],
        },
      }),
    );
    expect(a.map((x) => x.nivel)).toEqual(["critico", "atencao"]);
  });
});
