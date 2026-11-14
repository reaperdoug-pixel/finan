import { and, eq, isNull, ne } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sessao, usuario } from "../db/schema.js";
import { registrarLog } from "../log.js";
import { confirmarSenha } from "./reautenticacao.js";
import { exigirLogin, type AuthConfig } from "./routes.js";
import { gerarHash, validarSenha } from "./senha.js";

const corpoTroca = z.object({ novaSenha: z.string().min(1).max(128) });
const senhaDoCorpo = (corpo: unknown): unknown => (corpo as { senha?: unknown } | null)?.senha;

/**
 * Troca da própria senha. Exige a senha atual (mesmo limite de tentativas do login) e encerra
 * todas as outras sessões do usuário: quem tinha a senha antiga, ou uma sessão roubada, perde o acesso.
 */
export function rotasTrocarSenha(app: FastifyInstance, cfg: AuthConfig): void {
  const { db } = cfg;

  app.post("/auth/senha", async (req, reply) => {
    if (!exigirLogin(req, reply)) return;
    const corpo = corpoTroca.safeParse(req.body);
    if (!corpo.success) return reply.code(400).send({ erro: "Informe a nova senha" });

    if (!(await confirmarSenha(db, req, reply, senhaDoCorpo(req.body)))) return;

    const { novaSenha } = corpo.data;
    const erroSenha = validarSenha(novaSenha);
    if (erroSenha) return reply.code(400).send({ erro: erroSenha });
    if (novaSenha === senhaDoCorpo(req.body)) {
      return reply.code(400).send({ erro: "A nova senha precisa ser diferente da atual" });
    }

    const senhaHash = await gerarHash(novaSenha);
    const u = req.sessao.usuario;
    await db.transaction(async (tx) => {
      await tx
        .update(usuario)
        .set({ senhaHash, atualizadoEm: new Date() })
        .where(eq(usuario.id, u.id));
      await tx
        .update(sessao)
        .set({ revogadaEm: new Date() })
        .where(
          and(
            eq(sessao.usuarioId, u.id),
            isNull(sessao.revogadaEm),
            ne(sessao.id, req.sessao.sessaoId),
          ),
        );
      await registrarLog(tx, {
        acao: "senha.alterada",
        usuarioId: u.id,
        titularId: u.titularId,
        entidade: "usuario",
        entidadeId: u.id,
        ip: req.ip,
        confirmadoPor: u.id,
      });
    });
    return { ok: true };
  });
}
