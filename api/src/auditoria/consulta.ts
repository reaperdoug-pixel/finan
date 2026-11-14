import { and, desc, eq, gte, lte, sql, type SQL } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { log, usuario } from "../db/schema.js";

export interface CursorLog {
  /** `ocorrido_em` em texto, com a precisão total do banco (microssegundos). */
  t: string;
  i: string;
}

export interface FiltroLog {
  /** Sem valor = sem restrição de titular (só o admin chega aqui assim). */
  titularId?: string;
  acao?: string;
  usuarioId?: string;
  desde?: Date;
  ate?: Date;
  cursor?: CursorLog;
  limite: number;
}

/**
 * Lê o log do mais recente para o mais antigo, com paginação por cursor (estável mesmo
 * que entrem registros novos). Só leitura: nada aqui escreve no log.
 */
export async function consultarLog(db: Db, f: FiltroLog) {
  const textoDaHora = sql<string>`${log.ocorridoEm}::text`;
  const condicoes: SQL[] = [];
  if (f.titularId) condicoes.push(eq(log.titularId, f.titularId));
  if (f.acao) condicoes.push(eq(log.acao, f.acao));
  if (f.usuarioId) condicoes.push(eq(log.usuarioId, f.usuarioId));
  if (f.desde) condicoes.push(gte(log.ocorridoEm, f.desde));
  if (f.ate) condicoes.push(lte(log.ocorridoEm, f.ate));
  if (f.cursor) {
    condicoes.push(
      sql`(${log.ocorridoEm}, ${log.id}) < (${f.cursor.t}::timestamptz, ${f.cursor.i}::uuid)`,
    );
  }

  const linhas = await db
    .select({
      id: log.id,
      ocorridoEm: log.ocorridoEm,
      cursorTexto: textoDaHora,
      usuarioId: log.usuarioId,
      usuarioEmail: usuario.email,
      usuarioPapel: usuario.papel,
      titularId: log.titularId,
      acao: log.acao,
      entidade: log.entidade,
      entidadeId: log.entidadeId,
      ip: log.ip,
      antes: log.antes,
      depois: log.depois,
      confirmadoPor: log.confirmadoPor,
    })
    .from(log)
    .leftJoin(usuario, eq(usuario.id, log.usuarioId))
    .where(condicoes.length ? and(...condicoes) : undefined)
    .orderBy(desc(log.ocorridoEm), desc(log.id))
    .limit(f.limite + 1);

  const temMais = linhas.length > f.limite;
  return { linhas: temMais ? linhas.slice(0, f.limite) : linhas, temMais };
}
