import { describe, expect, it } from "vitest";
import { calcularFolego, destaqueDeCategorias } from "./painel-insights";
import type { Painel } from "./tipos";

function base(sobre: Partial<Painel> = {}): Painel {
  return {
    mes: "2026-11",
    mesAnterior: "2026-10",
    hoje: "2026-11-13",
    atual: { mes: "2026-11", receitas: 850000, despesas: 612000 },
    anterior: { mes: "2026-10", receitas: 820000, despesas: 540000 },
    serie: [],
    previstosDoMes: { quantidade: 0, receitas: 0, despesas: 0 },
    atrasados: { quantidade: 0, receitas: 0, despesas: 0 },
    despesasPorCategoria: [],
    receitasPorCategoria: [],
    despesasPorNatureza: { fixa: 0, variavel: 0, fixaAnterior: 0, variavelAnterior: 0 },
    movimentoPorConta: [],
    contas: { total: 1520000, itens: [] },
    ...sobre,
  };
}

describe("calcularFolego", () => {
  it("mês corrente: saldo dividido pelo gasto médio dos dias decorridos", () => {
    // 612000 / 13 dias = 47077/dia; 1520000 / 47077 = 32,3
    expect(calcularFolego(base())).toEqual({ dias: 32, saldo: 1520000, ritmoDiario: 47077 });
  });

  it("mês passado: usa o mês inteiro", () => {
    const f = calcularFolego(
      base({ mes: "2026-09", hoje: "2026-11-13", atual: { mes: "2026-09", receitas: 0, despesas: 300000 } }),
    );
    expect(f).toEqual({ dias: 152, saldo: 1520000, ritmoDiario: 10000 });
  });

  it("sem permissão para ver contas ou sem despesa não estima", () => {
    expect(calcularFolego(base({ contas: null }))).toBeNull();
    expect(
      calcularFolego(base({ atual: { mes: "2026-11", receitas: 1000, despesas: 0 } })),
    ).toBeNull();
  });

  it("saldo zerado ou negativo dá zero dias, nunca negativo", () => {
    expect(calcularFolego(base({ contas: { total: -500, itens: [] } }))?.dias).toBe(0);
    expect(calcularFolego(base({ contas: { total: 0, itens: [] } }))?.dias).toBe(0);
  });

  it("primeiro dia do mês não divide por zero", () => {
    const f = calcularFolego(base({ hoje: "2026-11-01" }));
    expect(f?.ritmoDiario).toBe(612000);
  });
});

describe("destaqueDeCategorias", () => {
  const cat = (id: string, nome: string, valor: number, anterior: number) => ({
    id,
    nome,
    valor,
    anterior,
  });

  it("soma as duas maiores e aponta a maior alta", () => {
    const t = destaqueDeCategorias(
      base({
        despesasPorCategoria: [
          cat("1", "Moradia", 250000, 240000),
          cat("2", "Mercado", 160000, 120000),
          cat("3", "Lazer", 40000, 39000),
        ],
      }),
    );
    // (250000+160000) / 450000 = 91%
    expect(t).toBe(
      "Moradia e Mercado juntos são 91% das despesas de novembro. Mercado foi a maior alta em relação a outubro.",
    );
  });

  it("sem alta relevante, só a primeira frase", () => {
    const t = destaqueDeCategorias(
      base({
        despesasPorCategoria: [cat("1", "A", 100000, 100000), cat("2", "B", 100000, 99000)],
      }),
    );
    expect(t).toBe("A e B juntos são 100% das despesas de novembro.");
  });

  it("menos de duas categorias, ou sem permissão, não gera frase", () => {
    expect(destaqueDeCategorias(base({ despesasPorCategoria: [cat("1", "A", 100, 0)] }))).toBeNull();
    expect(destaqueDeCategorias(base({ despesasPorCategoria: null }))).toBeNull();
  });
});
