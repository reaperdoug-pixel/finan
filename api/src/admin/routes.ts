import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { confirmarSenha } from "../auth/reautenticacao.js";
import { exigirAdmin, type AuthConfig } from "../auth/routes.js";
import { revogarConvite } from "../convites/servico.js";
import { titular } from "../db/schema.js";
import { inativarTitular, listarTitulares, reativarTitular, titularTemAdmin } from "./titulares.js";

const paramsId = z.object({ id: z.uuid() });
const consultaTitulares = z.object({
  busca: z.string().trim().min(1).max(80).optional(),
  limite: z.coerce.number().int().min(1).max(200).default(100),
  pagina: z.coerce.number().int().min(1).max(100_000).default(1),
});
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

/** Administração do sistema (só admin). Toda operação que muda estado pede a senha de quem opera. */
export function rotasAdmin(app: FastifyInstance, cfg: AuthConfig): void {
  const { db } = cfg;

  app.get("/admin/titulares", async (req, reply) => {
    if (!exigirAdmin(req, reply)) return;
    const q = consultaTitulares.safeParse(req.query);
    if (!q.success) return reply.code(400).send({ erro: "Parâmetros inválidos" });
    return listarTitulares(db, q.data);
  });

  app.post("/admin/titulares/:id/inativar", async (req, reply) => {
    if (!exigirAdmin(req, reply)) return;
    const p = paramsId.safeParse(req.params);
    if (!p.success) return reply.code(404).send({ erro: "Titular não encontrado" });

    const [alvo] = await db
      .select({ id: titular.id, ativo: titular.ativo })
      .from(titular)
      .where(eq(titular.id, p.data.id))
      .limit(1);
    if (!alvo) return reply.code(404).send({ erro: "Titular não encontrado" });
    if (await titularTemAdmin(db, alvo.id)) {
      return reply
        .code(400)
        .send({ erro: "O titular do administrador não pode ser inativado" });
    }
    if (!alvo.ativo) return reply.code(409).send({ erro: "O titular já está inativo" });

    if (!(await confirmarSenha(db, req, reply, senhaDoCorpo(req.body)))) return;

    const feito = await inativarTitular(db, {
      titularId: alvo.id,
      porUsuarioId: req.sessao.usuario.id,
      ip: req.ip,
    });
    if (!feito) return reply.code(409).send({ erro: "O titular já está inativo" });
    return { ativo: false };
  });

  app.post("/admin/titulares/:id/reativar", async (req, reply) => {
    if (!exigirAdmin(req, reply)) return;
    const p = paramsId.safeParse(req.params);
    if (!p.success) return reply.code(404).send({ erro: "Titular não encontrado" });

    const [alvo] = await db
      .select({ id: titular.id, ativo: titular.ativo })
      .from(titular)
      .where(eq(titular.id, p.data.id))
      .limit(1);
    if (!alvo) return reply.code(404).send({ erro: "Titular não encontrado" });
    if (alvo.ativo) return reply.code(409).send({ erro: "O titular já está ativo" });

    if (!(await confirmarSenha(db, req, reply, senhaDoCorpo(req.body)))) return;

    const feito = await reativarTitular(db, {
      titularId: alvo.id,
      porUsuarioId: req.sessao.usuario.id,
      ip: req.ip,
    });
    if (!feito) return reply.code(409).send({ erro: "O titular já está ativo" });
    return { ativo: true };
  });

  // Convites de titular (e de qualquer vinculado) que ainda não foram usados.
  app.post("/admin/convites/:id/revogar", async (req, reply) => {
    if (!exigirAdmin(req, reply)) return;
    const p = paramsId.safeParse(req.params);
    if (!p.success) return reply.code(404).send({ erro: MENSAGEM_REVOGACAO.nao_encontrado });

    if (!(await confirmarSenha(db, req, reply, senhaDoCorpo(req.body)))) return;

    const r = await revogarConvite(db, {
      conviteId: p.data.id,
      porUsuarioId: req.sessao.usuario.id,
      titularDoOperador: req.sessao.usuario.titularId,
      ip: req.ip,
    });
    if (!r.ok) {
      return reply.code(STATUS_REVOGACAO[r.codigo]).send({ erro: MENSAGEM_REVOGACAO[r.codigo] });
    }
    return { status: "revogado" };
  });
}
