import { eq } from "drizzle-orm";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { confirmarSenha } from "../auth/reautenticacao.js";
import { exigirGestor, type AuthConfig } from "../auth/routes.js";
import { revogarConvite } from "../convites/servico.js";
import { titular, usuario } from "../db/schema.js";
import { inativarUsuario, reativarUsuario } from "./ciclo.js";

const paramsId = z.object({ id: z.uuid() });

const senhaDoCorpo = (corpo: unknown): unknown => (corpo as { senha?: unknown } | null)?.senha;

const STATUS_REVOGACAO = {
  nao_encontrado: 404,
  ja_usado: 409,
  ja_revogado: 409,
  expirado: 409,
} as const;
const MENSAGEM_REVOGACAO = {
  nao_encontrado: "Convite não encontrado",
  ja_usado: "Este convite já foi usado",
  ja_revogado: "Este convite já foi revogado",
  expirado: "Este convite já expirou",
} as const;

/**
 * Inativar e reativar usuários, e revogar convites de vinculado. Nada se apaga e toda operação
 * exige a senha de quem opera (`confirmarSenha`) e gera log com `confirmado_por`.
 *  - admin: qualquer usuário (menos ele mesmo);
 *  - titular: só os próprios vinculados;
 *  - vinculado: nada (403).
 */
export function rotasCicloDeUsuarios(app: FastifyInstance, cfg: AuthConfig): void {
  const { db } = cfg;

  async function carregarAlvo(
    req: Parameters<typeof exigirGestor>[0] & { sessao: NonNullable<Parameters<typeof exigirGestor>[0]["sessao"]> },
    reply: FastifyReply,
    id: string,
    acao: "inativar" | "reativar",
  ) {
    const [alvo] = await db
      .select({
        id: usuario.id,
        titularId: usuario.titularId,
        papel: usuario.papel,
        ativo: usuario.ativo,
        titularAtivo: titular.ativo,
      })
      .from(usuario)
      .innerJoin(titular, eq(titular.id, usuario.titularId))
      .where(eq(usuario.id, id))
      .limit(1);

    const eAdmin = req.sessao.usuario.papel === "admin";
    // Usuário de outro titular responde 404 (não 403) para não revelar que ele existe.
    if (!alvo || (!eAdmin && alvo.titularId !== req.sessao.usuario.titularId)) {
      void reply.code(404).send({ erro: "Usuário não encontrado" });
      return null;
    }
    if (acao === "inativar" && alvo.id === req.sessao.usuario.id) {
      void reply.code(400).send({ erro: "Você não pode inativar a si mesmo" });
      return null;
    }
    if (!eAdmin && alvo.papel !== "vinculado") {
      void reply.code(403).send({ erro: "Sem permissão" });
      return null;
    }
    return alvo;
  }

  app.post("/usuarios/:id/inativar", async (req, reply) => {
    if (!exigirGestor(req, reply)) return;
    const p = paramsId.safeParse(req.params);
    if (!p.success) return reply.code(404).send({ erro: "Usuário não encontrado" });

    const alvo = await carregarAlvo(req, reply, p.data.id, "inativar");
    if (!alvo) return;
    if (!alvo.ativo) return reply.code(409).send({ erro: "O usuário já está inativo" });

    if (!(await confirmarSenha(db, req, reply, senhaDoCorpo(req.body)))) return;

    const feito = await inativarUsuario(db, {
      alvo: { id: alvo.id, titularId: alvo.titularId },
      porUsuarioId: req.sessao.usuario.id,
      ip: req.ip,
    });
    if (!feito) return reply.code(409).send({ erro: "O usuário já está inativo" });
    return { ativo: false };
  });

  app.post("/usuarios/:id/reativar", async (req, reply) => {
    if (!exigirGestor(req, reply)) return;
    const p = paramsId.safeParse(req.params);
    if (!p.success) return reply.code(404).send({ erro: "Usuário não encontrado" });

    const alvo = await carregarAlvo(req, reply, p.data.id, "reativar");
    if (!alvo) return;
    if (alvo.ativo) return reply.code(409).send({ erro: "O usuário já está ativo" });
    // Mesma regra dos lançamentos e categorias: não se reativa dentro de algo inativo.
    if (!alvo.titularAtivo) {
      return reply.code(409).send({ erro: "O titular está inativo. Reative o titular primeiro" });
    }

    if (!(await confirmarSenha(db, req, reply, senhaDoCorpo(req.body)))) return;

    const feito = await reativarUsuario(db, {
      alvo: { id: alvo.id, titularId: alvo.titularId },
      porUsuarioId: req.sessao.usuario.id,
      ip: req.ip,
    });
    if (!feito) return reply.code(409).send({ erro: "O usuário já está ativo" });
    return { ativo: true };
  });

  // Titular revoga convites de vinculado do próprio titular; admin revoga qualquer um.
  app.post("/usuarios/convites/:id/revogar", async (req, reply) => {
    if (!exigirGestor(req, reply)) return;
    const p = paramsId.safeParse(req.params);
    if (!p.success) return reply.code(404).send({ erro: MENSAGEM_REVOGACAO.nao_encontrado });

    if (!(await confirmarSenha(db, req, reply, senhaDoCorpo(req.body)))) return;

    const r = await revogarConvite(db, {
      conviteId: p.data.id,
      porUsuarioId: req.sessao.usuario.id,
      titularDoOperador: req.sessao.usuario.titularId,
      ip: req.ip,
      escopoTitularId:
        req.sessao.usuario.papel === "admin" ? undefined : req.sessao.usuario.titularId,
    });
    if (!r.ok) return reply.code(STATUS_REVOGACAO[r.codigo]).send({ erro: MENSAGEM_REVOGACAO[r.codigo] });
    return { status: "revogado" };
  });
}
