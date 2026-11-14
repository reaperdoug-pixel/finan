import { and, asc, eq, ilike, sql } from "drizzle-orm";
import { revogarSessoesDoTitular } from "../auth/sessao.js";
import { camposInativacao, camposReativacao } from "../ciclo-de-vida.js";
import type { Db } from "../db/client.js";
import { titular, usuario } from "../db/schema.js";
import { registrarLog } from "../log.js";

/** Escapa os curingas do LIKE para a busca por nome ser literal. */
const escaparLike = (t: string) => t.replace(/[\\%_]/g, "\\$&");

/**
 * Lista os titulares por ordem de nome, com busca por parte do nome e paginação.
 * Devolve uma linha a mais que o limite só para saber se existe próxima página.
 */
export async function listarTitulares(
  db: Db,
  o: { busca?: string; limite: number; pagina: number },
) {
  const linhas = await db
    .select({
      id: titular.id,
      nome: titular.nome,
      ativo: titular.ativo,
      criadoEm: titular.criadoEm,
      inativadoEm: titular.inativadoEm,
      // `"titular"."id"` escrito por extenso de propósito: com uma só tabela no FROM o Drizzle
      // omitiria o nome da tabela e, dentro da subconsulta, `id` passaria a ser o do usuário.
      totalUsuarios: sql<number>`(select count(*)::int from usuario u where u.titular_id = "titular"."id")`,
    })
    .from(titular)
    .where(o.busca ? ilike(titular.nome, `%${escaparLike(o.busca)}%`) : undefined)
    .orderBy(asc(titular.nome), asc(titular.id))
    .limit(o.limite + 1)
    .offset((o.pagina - 1) * o.limite);
  const temMais = linhas.length > o.limite;
  return { titulares: temMais ? linhas.slice(0, o.limite) : linhas, proximaPagina: temMais ? o.pagina + 1 : null };
}

/** O titular do administrador nunca pode ser inativado: o admin ficaria sem acesso ao sistema. */
export async function titularTemAdmin(db: Db, titularId: string): Promise<boolean> {
  const [a] = await db
    .select({ id: usuario.id })
    .from(usuario)
    .where(and(eq(usuario.titularId, titularId), eq(usuario.papel, "admin")))
    .limit(1);
  return Boolean(a);
}

interface Mudanca {
  titularId: string;
  /** Quem operou e confirmou com a senha. */
  porUsuarioId: string;
  ip: string;
}

/**
 * Inativa o titular. Os usuários dele ficam sem acesso (login e sessões deixam de valer) e as
 * sessões abertas são encerradas. Nada é apagado. Devolve false se já estava inativo.
 */
export async function inativarTitular(db: Db, m: Mudanca): Promise<boolean> {
  return db.transaction(async (tx) => {
    const feito = await tx
      .update(titular)
      .set(camposInativacao(m.porUsuarioId))
      .where(and(eq(titular.id, m.titularId), eq(titular.ativo, true)))
      .returning({ id: titular.id });
    if (feito.length === 0) return false;

    await revogarSessoesDoTitular(tx, m.titularId);
    await registrarLog(tx, {
      acao: "titular.inativado",
      usuarioId: m.porUsuarioId,
      titularId: m.titularId,
      entidade: "titular",
      entidadeId: m.titularId,
      ip: m.ip,
      confirmadoPor: m.porUsuarioId,
      antes: { ativo: true },
      depois: { ativo: false },
    });
    return true;
  });
}

/** Reativa o titular (e, com ele, o acesso dos usuários que continuam ativos). */
export async function reativarTitular(db: Db, m: Mudanca): Promise<boolean> {
  return db.transaction(async (tx) => {
    const feito = await tx
      .update(titular)
      .set(camposReativacao())
      .where(and(eq(titular.id, m.titularId), eq(titular.ativo, false)))
      .returning({ id: titular.id });
    if (feito.length === 0) return false;

    await registrarLog(tx, {
      acao: "titular.reativado",
      usuarioId: m.porUsuarioId,
      titularId: m.titularId,
      entidade: "titular",
      entidadeId: m.titularId,
      ip: m.ip,
      confirmadoPor: m.porUsuarioId,
      antes: { ativo: false },
      depois: { ativo: true },
    });
    return true;
  });
}
