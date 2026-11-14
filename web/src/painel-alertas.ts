import { formatBRL } from "@finan/shared";
import { formatarMes } from "./formato";
import type { Painel } from "./tipos";

export type NivelAlerta = "critico" | "atencao";

export interface Alerta {
  id: string;
  nivel: NivelAlerta;
  titulo: string;
  detalhe: string;
  /** Tela onde a pessoa resolve. */
  para: string;
}

/** Quanto uma categoria precisa subir para virar aviso: pelo menos 20% e R$ 50,00. */
export const SUBIDA_MINIMA_PCT = 20;
export const SUBIDA_MINIMA_CENTAVOS = 5000;

export const mesPorExtenso = (m: string) => formatarMes(m).split(" de ")[0]!.toLowerCase();

/** Variação em relação a um valor anterior. `pct` é null quando não havia valor antes. */
export function variacao(atual: number, anterior: number): { abs: number; pct: number | null } {
  const abs = atual - anterior;
  return { abs, pct: anterior === 0 ? null : Math.round((abs / anterior) * 100) };
}

/** A categoria-raiz que mais subiu sobre o mês anterior, se passar dos limites mínimos. */
export function maiorAltaDeCategoria(p: Painel) {
  return (p.despesasPorCategoria ?? [])
    .map((c) => ({ c, v: variacao(c.valor, c.anterior) }))
    .filter(
      ({ c, v }) =>
        c.anterior > 0 &&
        v.abs >= SUBIDA_MINIMA_CENTAVOS &&
        v.pct !== null &&
        v.pct >= SUBIDA_MINIMA_PCT,
    )
    .sort((a, b) => b.v.abs - a.v.abs)[0];
}

/**
 * O que merece uma decisão agora, do mais grave ao menos grave. Só lê o que a API devolveu:
 * não calcula nada de dinheiro novo, só compara.
 */
export function gerarAlertas(p: Painel): Alerta[] {
  const alertas: Alerta[] = [];

  for (const c of p.contas?.itens ?? []) {
    if (c.saldo < 0) {
      alertas.push({
        id: `conta-negativa-${c.id}`,
        nivel: "critico",
        titulo: `${c.nome} está no negativo`,
        detalhe: `Saldo de ${formatBRL(c.saldo)}`,
        para: "/contas",
      });
    }
  }

  const falta = p.previstosDoMes.despesas - p.previstosDoMes.receitas;
  if (p.contas && falta > 0 && p.contas.total < falta) {
    alertas.push({
      id: "saldo-nao-cobre-previstos",
      nivel: "critico",
      titulo: "O saldo não cobre o que está previsto",
      detalhe: `Faltam ${formatBRL(falta - p.contas.total)} para os previstos de ${mesPorExtenso(p.mes)}`,
      para: "/lancamentos",
    });
  }

  if (p.atual.despesas > p.atual.receitas && p.atual.despesas > 0) {
    alertas.push({
      id: "despesas-acima-das-receitas",
      nivel: p.atual.receitas > 0 ? "critico" : "atencao",
      titulo: "Saiu mais do que entrou",
      detalhe: `${formatBRL(p.atual.despesas - p.atual.receitas)} a mais em ${mesPorExtenso(p.mes)}`,
      para: "/lancamentos",
    });
  }

  if (p.atrasados.quantidade > 0) {
    const n = p.atrasados.quantidade;
    alertas.push({
      id: "previstos-atrasados",
      nivel: "atencao",
      titulo: n === 1 ? "1 lançamento previsto atrasou" : `${n} lançamentos previstos atrasaram`,
      detalhe: "A data já passou e ainda não foram marcados como realizados",
      para: "/lancamentos",
    });
  }

  const subiu = maiorAltaDeCategoria(p);
  if (subiu) {
    alertas.push({
      id: `categoria-subiu-${subiu.c.id}`,
      nivel: "atencao",
      titulo: `${subiu.c.nome} subiu ${subiu.v.pct}%`,
      detalhe: `${formatBRL(subiu.v.abs)} a mais que em ${mesPorExtenso(p.mesAnterior)}`,
      para: "/lancamentos",
    });
  }

  const peso = { critico: 0, atencao: 1 } as const;
  return alertas.sort((a, b) => peso[a.nivel] - peso[b.nivel]);
}
