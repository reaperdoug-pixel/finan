import { and, eq } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { interpretarPermissoes } from "../auth/permissoes.js";
import { reautenticar } from "../auth/reautenticacao.js";
import { exigirGestor, type AuthConfig } from "../auth/routes.js";
import type { SessaoAtual } from "../auth/sessao.js";
import { criarConvite, ErroConvite } from "../convites/servico.js";
import { titular, usuario } from "../db/schema.js";
import { convitesPendentes, definirPermissoes, listarVinculados } from "./servico.js";

type ReqComSessao = FastifyRequest & { sessao: SessaoAtual };

const STATUS_POR_CODIGO = {
  invalido: 404,
  email_cadastrado: 409,
  pendente_existente: 409,
  senha_invalida: 400,
} as const;

const corpoConvidar = z.object({
  email: z.email({ error: "E-mail inválido" }).max(254),
  permissoes: z.unknown().optional(),
  senha: z.string().min(1).max(128),
  titularId: z.uuid().optional(),
});

const corpoPermissoes = z.object({
  permissoes: z.unknown(),
  senha: z.string().min(1).max(128),
});

const paramsId = z.object({ id: z.uuid() });
const consultaLista = z.object({ titularId: z.uuid().optional() });

export function rotasUsuarios(app: FastifyInstance, cfg: AuthConfig): void {
  const { db, segredoSessao } = cfg;

  /**
   * Decide em qual titular a operação age. Titular só age no próprio. Admin age no próprio
   * ou, informando `titularId`, em outro titular ativo. Já responde 403/404 e devolve null.
   */
  async function resolverTitular(
    req: ReqComSessao,
    reply: FastifyReply,
    informado: string | undefined,
  ): Promise<{ id: string; nome: string } | null> {
    const proprio = req.sessao.usuario.titularId;
    const alvoId = informado ?? proprio;
    if (alvoId !== proprio && req.sessao.usuario.papel !== "admin") {
      void reply.code(403).send({ erro: "Sem permissão" });
      return null;
    }
    const [t] = await db
      .select({ id: titular.id, nome: titular.nome })
      .from(titular)
      .where(and(eq(titular.id, alvoId), eq(titular.ativo, true)))
      .limit(1);
    if (!t) {
      void reply.code(404).send({ erro: "Titular não encontrado" });
      return null;
    }
    return t;
  }

  // Convida um usuário vinculado, já com as permissões iniciais. Exige a senha de quem convida.
  app.post("/usuarios/convites", async (req, reply) => {
    if (!exigirGestor(req, reply)) return;
    const corpo = corpoConvidar.safeParse(req.body);
    if (!corpo.success) {
      return reply.code(400).send({ erro: corpo.error.issues[0]?.message ?? "Dados inválidos" });
    }
    const perm = interpretarPermissoes(corpo.data.permissoes);
    if (!perm.ok) return reply.code(400).send({ erro: perm.erro });

    const alvo = await resolverTitular(req, reply, corpo.data.titularId);
    if (!alvo) return;

    const confirmacao = await reautenticar(db, req.sessao, corpo.data.senha, req.ip);
    if (!confirmacao.ok) return reply.code(confirmacao.status).send({ erro: confirmacao.erro });

    try {
      const novo = await criarConvite(db, segredoSessao, {
        email: corpo.data.email,
        nomeTitular: alvo.nome,
        criadoPor: req.sessao.usuario.id,
        titularDoAdmin: req.sessao.usuario.titularId,
        ip: req.ip,
        vinculado: { titularId: alvo.id, permissoes: perm.permissoes },
        confirmadoPor: req.sessao.usuario.id,
      });
      // O link aparece só agora; o token não fica guardado em lugar nenhum.
      return reply.code(201).send({
        id: novo.id,
        email: corpo.data.email.toLowerCase(),
        permissoes: perm.permissoes,
        expiraEm: novo.expiraEm,
        link: `${cfg.origemApp}/convite/${novo.token}`,
      });
    } catch (e) {
      if (e instanceof ErroConvite) {
        return reply.code(STATUS_POR_CODIGO[e.codigo]).send({ erro: e.message });
      }
      throw e;
    }
  });

  // Vinculados do titular (com permissões) e convites pendentes.
  app.get("/usuarios", async (req, reply) => {
    if (!exigirGestor(req, reply)) return;
    const consulta = consultaLista.safeParse(req.query);
    if (!consulta.success) return reply.code(400).send({ erro: "Dados inválidos" });
    const alvo = await resolverTitular(req, reply, consulta.data.titularId);
    if (!alvo) return;
    return {
      usuarios: await listarVinculados(db, alvo.id),
      convitesPendentes: await convitesPendentes(db, alvo.id),
    };
  });

  // Troca as permissões de um vinculado. Exige a senha de quem altera.
  app.put("/usuarios/:id/permissoes", async (req, reply) => {
    if (!exigirGestor(req, reply)) return;
    const params = paramsId.safeParse(req.params);
    if (!params.success) return reply.code(404).send({ erro: "Usuário não encontrado" });

    const [alvo] = await db
      .select({ id: usuario.id, titularId: usuario.titularId, papel: usuario.papel })
      .from(usuario)
      .where(eq(usuario.id, params.data.id))
      .limit(1);
    // Usuário de outro titular responde 404 (e não 403) para não revelar que ele existe.
    if (!alvo || (req.sessao.usuario.papel !== "admin" && alvo.titularId !== req.sessao.usuario.titularId)) {
      return reply.code(404).send({ erro: "Usuário não encontrado" });
    }
    if (alvo.papel !== "vinculado") {
      return reply.code(400).send({ erro: "Só usuários vinculados têm permissões configuráveis" });
    }

    const corpo = corpoPermissoes.safeParse(req.body);
    if (!corpo.success) return reply.code(400).send({ erro: "Dados inválidos" });
    const perm = interpretarPermissoes(corpo.data.permissoes);
    if (!perm.ok) return reply.code(400).send({ erro: perm.erro });

    const confirmacao = await reautenticar(db, req.sessao, corpo.data.senha, req.ip);
    if (!confirmacao.ok) return reply.code(confirmacao.status).send({ erro: confirmacao.erro });

    await definirPermissoes(db, {
      alvoId: alvo.id,
      titularId: alvo.titularId,
      permissoes: perm.permissoes,
      porUsuarioId: req.sessao.usuario.id,
      ip: req.ip,
    });
    return { permissoes: perm.permissoes };
  });
}
