import { and, count, desc, eq, gte, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { tentativaLogin } from "../db/schema.js";

export const JANELA_MS = 15 * 60 * 1000;
export const MAX_FALHAS_POR_EMAIL = 5;
export const MAX_FALHAS_POR_IP = 20;

/** Transação do Drizzle: o mesmo construtor de consultas do Db, preso a uma conexão. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Executor = Pick<Db | Tx, "select" | "insert">;

/** Retorna true se este e-mail ou este IP já estourou o limite de falhas na janela. */
export async function estaBloqueado(db: Executor, emailMinusculo: string, ip: string): Promise<boolean> {
  const desde = new Date(Date.now() - JANELA_MS);

  // Falhas do e-mail contam só depois do último sucesso dele.
  const [ultimoSucesso] = await db
    .select({ quando: tentativaLogin.ocorridoEm })
    .from(tentativaLogin)
    .where(
      and(
        eq(tentativaLogin.emailMinusculo, emailMinusculo),
        eq(tentativaLogin.sucesso, true),
        gte(tentativaLogin.ocorridoEm, desde),
      ),
    )
    .orderBy(desc(tentativaLogin.ocorridoEm))
    .limit(1);
  const inicioEmail = ultimoSucesso?.quando ?? desde;

  const [porEmail] = await db
    .select({ n: count() })
    .from(tentativaLogin)
    .where(
      and(
        eq(tentativaLogin.emailMinusculo, emailMinusculo),
        eq(tentativaLogin.sucesso, false),
        gte(tentativaLogin.ocorridoEm, inicioEmail),
      ),
    );
  if ((porEmail?.n ?? 0) >= MAX_FALHAS_POR_EMAIL) return true;

  const [porIp] = await db
    .select({ n: count() })
    .from(tentativaLogin)
    .where(
      and(
        eq(tentativaLogin.ip, ip),
        eq(tentativaLogin.sucesso, false),
        gte(tentativaLogin.ocorridoEm, desde),
      ),
    );
  return (porIp?.n ?? 0) >= MAX_FALHAS_POR_IP;
}

export async function registrarTentativa(
  db: Executor,
  emailMinusculo: string,
  ip: string,
  sucesso: boolean,
): Promise<void> {
  await db.insert(tentativaLogin).values({ emailMinusculo, ip, sucesso });
}

export type ResultadoLimitado<T> =
  | { bloqueado: true }
  | { bloqueado: false; sucesso: boolean; valor: T };

/**
 * Executa uma conferência de senha sob o limite de tentativas, sem corrida.
 * Numa transação, trava o e-mail e o IP (advisory lock, sempre nessa ordem, para não haver
 * deadlock), checa o bloqueio, roda `conferir` e grava a tentativa antes de soltar as travas.
 * Assim, requisições concorrentes do mesmo e-mail ou IP são contadas uma por vez.
 * `conferir` recebe a transação e deve usá-la: as conexões do pool podem estar todas ocupadas.
 */
export async function conferirComLimite<T>(
  db: Db,
  chave: { email: string; ip: string; registrarSucesso: boolean },
  conferir: (tx: Tx) => Promise<{ sucesso: boolean; valor: T }>,
): Promise<ResultadoLimitado<T>> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${"login:email:" + chave.email}, 0))`);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${"login:ip:" + chave.ip}, 0))`);

    if (await estaBloqueado(tx, chave.email, chave.ip)) return { bloqueado: true };

    const r = await conferir(tx);
    if (!r.sucesso || chave.registrarSucesso) {
      await registrarTentativa(tx, chave.email, chave.ip, r.sucesso);
    }
    return { bloqueado: false, sucesso: r.sucesso, valor: r.valor };
  });
}
