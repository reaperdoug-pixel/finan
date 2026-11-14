import { createHmac, randomBytes } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { sessao, titular, usuario } from "../db/schema.js";
import { carregarPermissoes, permissoesTotais, type Permissoes } from "./permissoes.js";

export const INATIVIDADE_MS = 30 * 60 * 1000;
export const DURACAO_MAXIMA_MS = 12 * 60 * 60 * 1000;
/** Evita escrever no banco a cada requisição: só renova o "último acesso" se passou 1 min. */
const RENOVAR_A_CADA_MS = 60 * 1000;

export interface SessaoAtual {
  sessaoId: string;
  csrfToken: string;
  /** Titular e admin: tudo. Vinculado: o que o titular liberou. Recarregada a cada requisição. */
  permissoes: Permissoes;
  usuario: {
    id: string;
    email: string;
    papel: "admin" | "titular" | "vinculado";
    titularId: string;
  };
}

/** O banco guarda só o HMAC do token: vazar o banco não permite usar as sessões. */
export function hashDoToken(token: string, segredo: string): string {
  return createHmac("sha256", segredo).update(token).digest("hex");
}

export async function criarSessao(
  db: Db,
  segredo: string,
  dados: { usuarioId: string; ip: string; userAgent: string | undefined },
): Promise<{ token: string; csrfToken: string; sessaoId: string }> {
  const token = randomBytes(32).toString("base64url");
  const csrfToken = randomBytes(32).toString("base64url");
  const [linha] = await db
    .insert(sessao)
    .values({
      usuarioId: dados.usuarioId,
      tokenHash: hashDoToken(token, segredo),
      csrfToken,
      ip: dados.ip,
      userAgent: dados.userAgent?.slice(0, 300) ?? null,
    })
    .returning({ id: sessao.id });
  if (!linha) throw new Error("Falha ao criar sessão");
  return { token, csrfToken, sessaoId: linha.id };
}

export async function revogarSessao(db: Db, sessaoId: string): Promise<void> {
  await db
    .update(sessao)
    .set({ revogadaEm: new Date() })
    .where(and(eq(sessao.id, sessaoId), isNull(sessao.revogadaEm)));
}

/** Encerra todas as sessões abertas de um usuário (ex.: ao inativá-lo ou trocar a senha). */
export async function revogarSessoesDoUsuario(
  db: Pick<Db, "update">,
  usuarioId: string,
): Promise<void> {
  await db
    .update(sessao)
    .set({ revogadaEm: new Date() })
    .where(and(eq(sessao.usuarioId, usuarioId), isNull(sessao.revogadaEm)));
}

/** Encerra todas as sessões abertas de todos os usuários de um titular (ex.: ao inativar o titular). */
export async function revogarSessoesDoTitular(
  db: Pick<Db, "update">,
  titularId: string,
): Promise<void> {
  await db
    .update(sessao)
    .set({ revogadaEm: new Date() })
    .where(
      and(
        isNull(sessao.revogadaEm),
        sql`${sessao.usuarioId} in (select ${usuario.id} from ${usuario} where ${usuario.titularId} = ${titularId})`,
      ),
    );
}

/**
 * Valida o token do cookie. Devolve null se a sessão não existe, foi revogada,
 * expirou (30 min de inatividade ou 12 h no total) ou se o usuário/titular foi inativado.
 */
export async function buscarSessao(
  db: Db,
  segredo: string,
  token: string,
): Promise<SessaoAtual | null> {
  if (token.length < 20 || token.length > 200) return null;

  const [linha] = await db
    .select({
      sessaoId: sessao.id,
      csrfToken: sessao.csrfToken,
      criadaEm: sessao.criadaEm,
      ultimoAcesso: sessao.ultimoAcesso,
      usuarioId: usuario.id,
      email: usuario.email,
      papel: usuario.papel,
      titularId: usuario.titularId,
      usuarioAtivo: usuario.ativo,
      titularAtivo: titular.ativo,
    })
    .from(sessao)
    .innerJoin(usuario, eq(usuario.id, sessao.usuarioId))
    .innerJoin(titular, eq(titular.id, usuario.titularId))
    .where(and(eq(sessao.tokenHash, hashDoToken(token, segredo)), isNull(sessao.revogadaEm)))
    .limit(1);
  if (!linha) return null;

  const agora = Date.now();
  const expirou =
    agora - linha.ultimoAcesso.getTime() > INATIVIDADE_MS ||
    agora - linha.criadaEm.getTime() > DURACAO_MAXIMA_MS;
  if (expirou || !linha.usuarioAtivo || !linha.titularAtivo) {
    await revogarSessao(db, linha.sessaoId);
    return null;
  }

  if (agora - linha.ultimoAcesso.getTime() > RENOVAR_A_CADA_MS) {
    await db.update(sessao).set({ ultimoAcesso: new Date() }).where(eq(sessao.id, linha.sessaoId));
  }

  // Lidas do banco a cada requisição: mudar as permissões vale na hora, sem novo login.
  const permissoes =
    linha.papel === "vinculado"
      ? await carregarPermissoes(db, linha.usuarioId)
      : permissoesTotais();

  return {
    sessaoId: linha.sessaoId,
    csrfToken: linha.csrfToken,
    permissoes,
    usuario: {
      id: linha.usuarioId,
      email: linha.email,
      papel: linha.papel,
      titularId: linha.titularId,
    },
  };
}
