import { log } from "./db/schema.js";
import type { Db } from "./db/client.js";
import type { AcaoLog } from "./log-acoes.js";

export interface EntradaLog {
  /** Só ações do catálogo (log-acoes.ts). */
  acao: AcaoLog;
  usuarioId?: string | null;
  titularId?: string | null;
  entidade?: string;
  entidadeId?: string;
  ip?: string | null;
  antes?: unknown;
  depois?: unknown;
  confirmadoPor?: string | null;
}

/**
 * Grava no log de auditoria (só de inclusão). Nunca coloque senha, token ou hash em `antes`/`depois`.
 * Aceita o `db` normal ou uma transação, para o log entrar junto com a operação que ele registra.
 */
export async function registrarLog(db: Pick<Db, "insert">, e: EntradaLog): Promise<void> {
  await db.insert(log).values({
    acao: e.acao,
    usuarioId: e.usuarioId ?? null,
    titularId: e.titularId ?? null,
    entidade: e.entidade ?? null,
    entidadeId: e.entidadeId ?? null,
    ip: e.ip ?? null,
    antes: e.antes ?? null,
    depois: e.depois ?? null,
    confirmadoPor: e.confirmadoPor ?? null,
  });
}
