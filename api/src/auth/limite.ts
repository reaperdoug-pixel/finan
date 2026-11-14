import { and, count, desc, eq, gte } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { tentativaLogin } from "../db/schema.js";

export const JANELA_MS = 15 * 60 * 1000;
export const MAX_FALHAS_POR_EMAIL = 5;
export const MAX_FALHAS_POR_IP = 20;

/** Retorna true se este e-mail ou este IP já estourou o limite de falhas na janela. */
export async function estaBloqueado(db: Db, emailMinusculo: string, ip: string): Promise<boolean> {
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
  db: Db,
  emailMinusculo: string,
  ip: string,
  sucesso: boolean,
): Promise<void> {
  await db.insert(tentativaLogin).values({ emailMinusculo, ip, sucesso });
}
