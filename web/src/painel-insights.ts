import { maiorAltaDeCategoria, mesPorExtenso } from "./painel-alertas";
import type { Painel } from "./tipos";

export interface Folego {
  /** Quantos dias o saldo aguenta no ritmo de gastos do mês. */
  dias: number;
  saldo: number;
  /** Gasto médio por dia (centavos, inteiro). */
  ritmoDiario: number;
}

/**
 * Fôlego do saldo: saldo total das contas dividido pelo gasto médio diário do mês.
 * Só lê o que a API já devolveu. Mês corrente: média sobre os dias decorridos; mês passado:
 * média sobre o mês inteiro. Sem permissão para ver contas, ou sem despesa no mês, não há
 * como estimar e devolve `null`.
 */
export function calcularFolego(p: Painel): Folego | null {
  if (!p.contas || p.atual.despesas <= 0) return null;
  const [ano, mes] = p.mes.split("-").map(Number) as [number, number];
  const diasDoMes = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  const decorridos = p.hoje.slice(0, 7) === p.mes ? Number(p.hoje.slice(8, 10)) : diasDoMes;
  const ritmo = p.atual.despesas / Math.max(1, decorridos);
  const saldo = p.contas.total;
  return {
    dias: saldo <= 0 ? 0 : Math.floor(saldo / ritmo),
    saldo,
    ritmoDiario: Math.round(ritmo),
  };
}

/** Frase de leitura das despesas por categoria. `null` quando não há o que comparar. */
export function destaqueDeCategorias(p: Painel): string | null {
  const lista = (p.despesasPorCategoria ?? []).filter((c) => c.valor > 0);
  const total = lista.reduce((s, c) => s + c.valor, 0);
  if (lista.length < 2 || total === 0) return null;
  const [a, b] = lista as [(typeof lista)[number], (typeof lista)[number]];
  const pct = Math.round(((a.valor + b.valor) / total) * 100);
  let texto = `${a.nome} e ${b.nome} juntos são ${pct}% das despesas de ${mesPorExtenso(p.mes)}.`;
  const alta = maiorAltaDeCategoria(p);
  if (alta) texto += ` ${alta.c.nome} foi a maior alta em relação a ${mesPorExtenso(p.mesAnterior)}.`;
  return texto;
}
