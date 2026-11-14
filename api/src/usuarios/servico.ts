import { and, asc, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import {
  carregarPermissoes,
  gravarPermissoes,
  permissoesNulas,
  type Permissoes,
} from "../auth/permissoes.js";
import type { Db } from "../db/client.js";
import { convite, permissao, usuario } from "../db/schema.js";
import { registrarLog } from "../log.js";

/** Usuários vinculados de um titular (ativos e inativos), cada um com suas permissões. */
export async function listarVinculados(db: Db, titularId: string) {
  const us = await db
    .select({
      id: usuario.id,
      email: usuario.email,
      ativo: usuario.ativo,
      criadoEm: usuario.criadoEm,
    })
    .from(usuario)
    .where(and(eq(usuario.titularId, titularId), eq(usuario.papel, "vinculado")))
    .orderBy(asc(usuario.email));

  const linhas = us.length
    ? await db
        .select()
        .from(permissao)
        .where(
          inArray(
            permissao.usuarioId,
            us.map((u) => u.id),
          ),
        )
    : [];

  return us.map((u) => {
    const p = permissoesNulas();
    for (const l of linhas.filter((x) => x.usuarioId === u.id)) {
      p[l.modulo] = { ver: l.ver, cadastrar: l.cadastrar, alterar: l.alterar, excluir: l.excluir };
    }
    return { ...u, permissoes: p };
  });
}

/** Convites de vinculado ainda não usados nem expirados. Nunca devolve o token. */
export async function convitesPendentes(db: Db, titularId: string) {
  return db
    .select({
      id: convite.id,
      email: convite.email,
      expiraEm: convite.expiraEm,
      criadoEm: convite.criadoEm,
      permissoes: convite.permissoes,
    })
    .from(convite)
    .where(
      and(
        eq(convite.titularId, titularId),
        isNull(convite.usadoEm),
        isNull(convite.revogadoEm),
        gt(convite.expiraEm, sql`now()`),
      ),
    )
    .orderBy(desc(convite.criadoEm));
}

export interface AlteracaoPermissoes {
  alvoId: string;
  titularId: string;
  permissoes: Permissoes;
  /** Quem alterou e confirmou com a senha. */
  porUsuarioId: string;
  ip: string;
}

/** Troca as permissões de um vinculado e registra no log o antes e o depois. */
export async function definirPermissoes(db: Db, a: AlteracaoPermissoes): Promise<void> {
  await db.transaction(async (tx) => {
    const antes = await carregarPermissoes(tx, a.alvoId);
    await gravarPermissoes(tx, a.alvoId, a.permissoes);
    await registrarLog(tx, {
      acao: "permissao.alterada",
      usuarioId: a.porUsuarioId,
      titularId: a.titularId,
      entidade: "usuario",
      entidadeId: a.alvoId,
      ip: a.ip,
      confirmadoPor: a.porUsuarioId,
      antes,
      depois: a.permissoes,
    });
  });
}
