import { randomBytes } from "node:crypto";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { gerarHash, validarSenha } from "../auth/senha.js";
import { hashDoToken, revogarSessoesDoUsuario } from "../auth/sessao.js";
import type { Db } from "../db/client.js";
import { redefinicaoSenha, tentativaLogin, titular, usuario } from "../db/schema.js";
import { registrarLog } from "../log.js";

export const VALIDADE_REDEFINICAO_MS = 24 * 60 * 60 * 1000;

export type CodigoErroRedefinicao =
  | "invalido" // não existe, expirou, já foi usado ou foi revogado (indistinguíveis)
  | "nao_encontrado"
  | "usuario_inativo"
  | "senha_invalida";

/** Erro com mensagem segura para devolver ao cliente. */
export class ErroRedefinicao extends Error {
  constructor(
    readonly codigo: CodigoErroRedefinicao,
    mensagem: string,
  ) {
    super(mensagem);
  }
}

const MSG_INVALIDO = "Link inválido ou expirado";

const aindaValida = (tokenHash: string) =>
  and(
    eq(redefinicaoSenha.tokenHash, tokenHash),
    isNull(redefinicaoSenha.usadoEm),
    isNull(redefinicaoSenha.revogadaEm),
    gt(redefinicaoSenha.expiraEm, sql`now()`),
  );

/**
 * O admin gera um link de redefinição para um usuário. Ninguém, nem o admin, passa a saber a
 * senha: o próprio usuário a define pelo link. Links pendentes anteriores deixam de valer.
 */
export async function criarRedefinicao(
  db: Db,
  segredo: string,
  p: { usuarioId: string; porUsuarioId: string; ip: string },
): Promise<{ token: string; expiraEm: Date; email: string }> {
  return db.transaction(async (tx) => {
    const [u] = await tx
      .select({
        id: usuario.id,
        email: usuario.email,
        titularId: usuario.titularId,
        ativo: usuario.ativo,
        titularAtivo: titular.ativo,
      })
      .from(usuario)
      .innerJoin(titular, eq(titular.id, usuario.titularId))
      .where(eq(usuario.id, p.usuarioId))
      .limit(1);
    if (!u) throw new ErroRedefinicao("nao_encontrado", "Usuário não encontrado");
    if (!u.ativo || !u.titularAtivo) {
      throw new ErroRedefinicao("usuario_inativo", "O usuário está inativo");
    }

    await tx
      .update(redefinicaoSenha)
      .set({ revogadaEm: new Date() })
      .where(
        and(
          eq(redefinicaoSenha.usuarioId, u.id),
          isNull(redefinicaoSenha.usadoEm),
          isNull(redefinicaoSenha.revogadaEm),
        ),
      );

    const token = randomBytes(32).toString("base64url");
    const expiraEm = new Date(Date.now() + VALIDADE_REDEFINICAO_MS);
    await tx.insert(redefinicaoSenha).values({
      usuarioId: u.id,
      tokenHash: hashDoToken(token, segredo),
      expiraEm,
      criadoPor: p.porUsuarioId,
    });

    await registrarLog(tx, {
      acao: "redefinicao.criada",
      usuarioId: p.porUsuarioId,
      titularId: u.titularId,
      entidade: "usuario",
      entidadeId: u.id,
      ip: p.ip,
      confirmadoPor: p.porUsuarioId,
      depois: { expiraEm },
    });

    return { token, expiraEm, email: u.email };
  });
}

/** Link ainda utilizável: existe, não foi usado nem revogado, não expirou e o usuário segue ativo. */
export async function buscarRedefinicaoValida(
  db: Db,
  segredo: string,
  token: string,
): Promise<{ email: string } | null> {
  if (token.length < 20 || token.length > 200) return null;
  const [r] = await db
    .select({ email: usuario.email })
    .from(redefinicaoSenha)
    .innerJoin(usuario, eq(usuario.id, redefinicaoSenha.usuarioId))
    .innerJoin(titular, eq(titular.id, usuario.titularId))
    .where(
      and(aindaValida(hashDoToken(token, segredo)), eq(usuario.ativo, true), eq(titular.ativo, true)),
    )
    .limit(1);
  return r ?? null;
}

/**
 * O usuário define a nova senha pelo link. Encerra todas as sessões dele (quem estivesse logado
 * com a senha antiga perde o acesso) e libera um eventual bloqueio por tentativas de login.
 */
export async function concluirRedefinicao(
  db: Db,
  segredo: string,
  token: string,
  senha: string,
  ip: string,
): Promise<void> {
  // Checagens baratas antes do hash (que custa CPU).
  if (!(await buscarRedefinicaoValida(db, segredo, token))) {
    throw new ErroRedefinicao("invalido", MSG_INVALIDO);
  }
  const erroSenha = validarSenha(senha);
  if (erroSenha) throw new ErroRedefinicao("senha_invalida", erroSenha);
  const senhaHash = await gerarHash(senha);

  await db.transaction(async (tx) => {
    // A linha fica travada: dois usos simultâneos do mesmo link nunca passam os dois.
    const [r] = await tx
      .select()
      .from(redefinicaoSenha)
      .where(aindaValida(hashDoToken(token, segredo)))
      .for("update");
    if (!r) throw new ErroRedefinicao("invalido", MSG_INVALIDO);

    const [u] = await tx
      .select({
        id: usuario.id,
        email: usuario.email,
        titularId: usuario.titularId,
        ativo: usuario.ativo,
        titularAtivo: titular.ativo,
      })
      .from(usuario)
      .innerJoin(titular, eq(titular.id, usuario.titularId))
      .where(eq(usuario.id, r.usuarioId))
      .limit(1);
    if (!u || !u.ativo || !u.titularAtivo) throw new ErroRedefinicao("invalido", MSG_INVALIDO);

    await tx
      .update(usuario)
      .set({ senhaHash, atualizadoEm: new Date() })
      .where(eq(usuario.id, u.id));
    await tx.update(redefinicaoSenha).set({ usadoEm: new Date() }).where(eq(redefinicaoSenha.id, r.id));
    await revogarSessoesDoUsuario(tx, u.id);
    // A tabela de tentativas só aceita inclusão: um "sucesso" marca o recomeço da contagem de falhas.
    await tx
      .insert(tentativaLogin)
      .values({ emailMinusculo: u.email.toLowerCase(), ip, sucesso: true });

    await registrarLog(tx, {
      acao: "redefinicao.concluida",
      usuarioId: u.id,
      titularId: u.titularId,
      entidade: "usuario",
      entidadeId: u.id,
      ip,
    });
  });
}
