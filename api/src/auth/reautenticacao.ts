import { eq } from "drizzle-orm";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Db } from "../db/client.js";
import { usuario } from "../db/schema.js";
import { registrarLog } from "../log.js";
import { conferirComLimite } from "./limite.js";
import { conferirSenha } from "./senha.js";
import type { SessaoAtual } from "./sessao.js";

/**
 * Para as rotas: lê a senha informada, confere e já responde quando não passa
 * (400 sem senha, 403 senha errada, 429 muitas tentativas). Devolve true só se a senha está certa.
 * Toda operação sensível (inativar, reativar, revogar, redefinir, mudar permissões) usa isto.
 */
export async function confirmarSenha(
  db: Db,
  req: FastifyRequest & { sessao: SessaoAtual },
  reply: FastifyReply,
  senha: unknown,
): Promise<boolean> {
  if (typeof senha !== "string" || senha.length < 1 || senha.length > 128) {
    void reply.code(400).send({ erro: "Informe a sua senha para confirmar" });
    return false;
  }
  const r = await reautenticar(db, req.sessao, senha, req.ip);
  if (!r.ok) {
    void reply.code(r.status).send({ erro: r.erro });
    return false;
  }
  return true;
}

export type ResultadoReautenticacao =
  | { ok: true }
  | { ok: false; status: 403 | 429; erro: string };

/**
 * Confere a senha de quem está logado antes de uma operação sensível (criar vinculado,
 * mudar permissões, inativar, reativar). Usa o mesmo limite de tentativas do login:
 * quem roubou uma sessão não consegue adivinhar a senha por aqui. Falhas vão para o log.
 */
export async function reautenticar(
  db: Db,
  sessao: SessaoAtual,
  senha: string,
  ip: string,
): Promise<ResultadoReautenticacao> {
  const email = sessao.usuario.email.toLowerCase();

  const resultado = await conferirComLimite(
    db,
    // Reautenticar com sucesso não grava tentativa (comportamento anterior): só as falhas contam.
    { email, ip, registrarSucesso: false },
    async (tx) => {
      const [u] = await tx
        .select({ senhaHash: usuario.senhaHash })
        .from(usuario)
        .where(eq(usuario.id, sessao.usuario.id))
        .limit(1);
      const sucesso = !!u && (await conferirSenha(u.senhaHash, senha));
      return { sucesso, valor: null };
    },
  );

  if (resultado.bloqueado) {
    await registrarLog(db, {
      acao: "reautenticacao.bloqueada",
      usuarioId: sessao.usuario.id,
      titularId: sessao.usuario.titularId,
      ip,
    });
    return {
      ok: false,
      status: 429,
      erro: "Muitas tentativas. Aguarde alguns minutos e tente de novo.",
    };
  }

  if (!resultado.sucesso) {
    await registrarLog(db, {
      acao: "reautenticacao.falha",
      usuarioId: sessao.usuario.id,
      titularId: sessao.usuario.titularId,
      ip,
    });
    return { ok: false, status: 403, erro: "Senha incorreta" };
  }
  return { ok: true };
}
