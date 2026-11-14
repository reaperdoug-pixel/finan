import { and, eq } from "drizzle-orm";
import { revogarSessoesDoUsuario } from "../auth/sessao.js";
import { camposInativacao, camposReativacao } from "../ciclo-de-vida.js";
import type { Db } from "../db/client.js";
import { usuario } from "../db/schema.js";
import { registrarLog } from "../log.js";

interface Mudanca {
  alvo: { id: string; titularId: string };
  /** Quem operou e confirmou com a senha. */
  porUsuarioId: string;
  ip: string;
}

/**
 * Inativa o usuário (nada se apaga), derruba as sessões dele e registra no log.
 * Devolve false se ele já estava inativo (outra requisição chegou antes).
 */
export async function inativarUsuario(db: Db, m: Mudanca): Promise<boolean> {
  return db.transaction(async (tx) => {
    const feito = await tx
      .update(usuario)
      .set(camposInativacao(m.porUsuarioId))
      .where(and(eq(usuario.id, m.alvo.id), eq(usuario.ativo, true)))
      .returning({ id: usuario.id });
    if (feito.length === 0) return false;

    await revogarSessoesDoUsuario(tx, m.alvo.id);
    await registrarLog(tx, {
      acao: "usuario.inativado",
      usuarioId: m.porUsuarioId,
      titularId: m.alvo.titularId,
      entidade: "usuario",
      entidadeId: m.alvo.id,
      ip: m.ip,
      confirmadoPor: m.porUsuarioId,
      antes: { ativo: true },
      depois: { ativo: false },
    });
    return true;
  });
}

/** Reativa o usuário e registra no log. Devolve false se ele já estava ativo. */
export async function reativarUsuario(db: Db, m: Mudanca): Promise<boolean> {
  return db.transaction(async (tx) => {
    const feito = await tx
      .update(usuario)
      .set(camposReativacao())
      .where(and(eq(usuario.id, m.alvo.id), eq(usuario.ativo, false)))
      .returning({ id: usuario.id });
    if (feito.length === 0) return false;

    await registrarLog(tx, {
      acao: "usuario.reativado",
      usuarioId: m.porUsuarioId,
      titularId: m.alvo.titularId,
      entidade: "usuario",
      entidadeId: m.alvo.id,
      ip: m.ip,
      confirmadoPor: m.porUsuarioId,
      antes: { ativo: false },
      depois: { ativo: true },
    });
    return true;
  });
}
