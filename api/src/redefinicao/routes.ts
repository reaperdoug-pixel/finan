import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { confirmarSenha } from "../auth/reautenticacao.js";
import { exigirAdmin, type AuthConfig } from "../auth/routes.js";
import { usuario } from "../db/schema.js";
import {
  buscarRedefinicaoValida,
  concluirRedefinicao,
  criarRedefinicao,
  ErroRedefinicao,
} from "./servico.js";

const paramsId = z.object({ id: z.uuid() });
const paramsToken = z.object({ token: z.string().min(1).max(200) });
const corpoConcluir = z.object({ senha: z.string().min(1).max(128) });
const senhaDoCorpo = (corpo: unknown): unknown => (corpo as { senha?: unknown } | null)?.senha;

const STATUS = {
  invalido: 404,
  nao_encontrado: 404,
  usuario_inativo: 409,
  senha_invalida: 400,
} as const;

/**
 * Redefinição de senha por link (sem e-mail na v1): o admin gera o link, confirmando com a própria
 * senha, e o usuário define a nova senha por ele. O token só existe na resposta.
 */
export function rotasRedefinicao(app: FastifyInstance, cfg: AuthConfig): void {
  const { db, segredoSessao } = cfg;

  app.post("/admin/usuarios/:id/redefinicao", async (req, reply) => {
    if (!exigirAdmin(req, reply)) return;
    const p = paramsId.safeParse(req.params);
    if (!p.success) return reply.code(404).send({ erro: "Usuário não encontrado" });

    const [alvo] = await db
      .select({ id: usuario.id })
      .from(usuario)
      .where(eq(usuario.id, p.data.id))
      .limit(1);
    if (!alvo) return reply.code(404).send({ erro: "Usuário não encontrado" });

    if (!(await confirmarSenha(db, req, reply, senhaDoCorpo(req.body)))) return;

    try {
      const nova = await criarRedefinicao(db, segredoSessao, {
        usuarioId: alvo.id,
        porUsuarioId: req.sessao.usuario.id,
        ip: req.ip,
      });
      return reply.code(201).send({
        email: nova.email,
        expiraEm: nova.expiraEm,
        link: `${cfg.origemApp}/redefinicao/${nova.token}`,
      });
    } catch (e) {
      if (e instanceof ErroRedefinicao) return reply.code(STATUS[e.codigo]).send({ erro: e.message });
      throw e;
    }
  });

  // --- Públicas: quem recebeu o link ainda não consegue entrar ---

  app.get("/redefinicao/:token", async (req, reply) => {
    const p = paramsToken.safeParse(req.params);
    const r = p.success ? await buscarRedefinicaoValida(db, segredoSessao, p.data.token) : null;
    if (!r) return reply.code(404).send({ erro: "Link inválido ou expirado" });
    return r;
  });

  app.post("/redefinicao/:token", { config: { semCsrf: true } }, async (req, reply) => {
    const p = paramsToken.safeParse(req.params);
    const corpo = corpoConcluir.safeParse(req.body);
    if (!p.success || !corpo.success) return reply.code(400).send({ erro: "Dados inválidos" });
    try {
      await concluirRedefinicao(db, segredoSessao, p.data.token, corpo.data.senha, req.ip);
      return { ok: true };
    } catch (e) {
      if (e instanceof ErroRedefinicao) return reply.code(STATUS[e.codigo]).send({ erro: e.message });
      throw e;
    }
  });
}
