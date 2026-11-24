import { and, isNotNull, lt, or } from "drizzle-orm";
import { DURACAO_MAXIMA_MS } from "../auth/sessao.js";
import { JANELA_MS } from "../auth/limite.js";
import type { Db } from "../db/client.js";
import { sessao, tentativaLogin } from "../db/schema.js";

/** Quanto tempo guardar sessões encerradas e tentativas de login (para investigar incidentes). */
export const RETENCAO_PADRAO_DIAS = 30;

const DIA_MS = 24 * 60 * 60 * 1000;

export interface ResultadoLimpeza {
  sessoes: number;
  tentativas: number;
}

/** Valida a retenção: nunca menor que 1 dia (bem acima da janela de 15 min do limite). */
export function lerRetencaoDias(valor: string | undefined): number {
  if (valor === undefined || valor.trim() === "") return RETENCAO_PADRAO_DIAS;
  const n = Number(valor);
  if (!Number.isInteger(n) || n < 1 || n > 3650) {
    throw new Error(`LIMPEZA_RETENCAO_DIAS inválido: ${valor} (use um inteiro de 1 a 3650)`);
  }
  return n;
}

/**
 * Apaga sessões e tentativas de login antigas. Precisa do papel dono (finan_owner):
 * o papel da API não tem DELETE em nenhuma tabela.
 *  - Sessão: revogada há mais que a retenção, ou criada antes de (retenção + duração máxima),
 *    o que garante que já expirou mesmo sem ter sido revogada.
 *  - Tentativa: ocorrida há mais que a retenção (muito além da janela do limite).
 */
export async function limparDadosAntigos(
  db: Db,
  retencaoDias = RETENCAO_PADRAO_DIAS,
  agora = new Date(),
): Promise<ResultadoLimpeza> {
  const retencaoMs = retencaoDias * DIA_MS;
  if (retencaoMs <= JANELA_MS) throw new Error("Retenção menor que a janela do limite de tentativas");

  const corte = new Date(agora.getTime() - retencaoMs);
  const corteCriacao = new Date(corte.getTime() - DURACAO_MAXIMA_MS);

  return db.transaction(async (tx) => {
    const sessoes = await tx
      .delete(sessao)
      .where(
        or(
          and(isNotNull(sessao.revogadaEm), lt(sessao.revogadaEm, corte)),
          lt(sessao.criadaEm, corteCriacao),
        ),
      )
      .returning({ id: sessao.id });
    const tentativas = await tx
      .delete(tentativaLogin)
      .where(lt(tentativaLogin.ocorridoEm, corte))
      .returning({ id: tentativaLogin.id });
    return { sessoes: sessoes.length, tentativas: tentativas.length };
  });
}
