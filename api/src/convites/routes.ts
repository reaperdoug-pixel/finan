import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { exigirAdmin, type AuthConfig } from "../auth/routes.js";
import {
  aceitarConvite,
  buscarConviteValido,
  criarConvite,
  ErroConvite,
  listarConvites,
} from "./servico.js";

const corpoCriar = z.object({
  email: z.email({ error: "E-mail inválido" }).max(254),
  nomeTitular: z.string().trim().min(1, "Informe o nome do titular").max(120),
});

const corpoAceitar = z.object({ senha: z.string().min(1).max(128) });

const parametros = z.object({ token: z.string().min(1).max(200) });

const STATUS_POR_CODIGO = {
  invalido: 404,
  email_cadastrado: 409,
  pendente_existente: 409,
  senha_invalida: 400,
} as const;

export function rotasConvites(app: FastifyInstance, cfg: AuthConfig): void {
  const { db, segredoSessao } = cfg;

  // --- Administração (só admin) ---

  app.post("/admin/convites", async (req, reply) => {
    if (!exigirAdmin(req, reply)) return;
    const corpo = corpoCriar.safeParse(req.body);
    if (!corpo.success) {
      return reply.code(400).send({ erro: corpo.error.issues[0]?.message ?? "Dados inválidos" });
    }
    try {
      const novo = await criarConvite(db, segredoSessao, {
        email: corpo.data.email,
        nomeTitular: corpo.data.nomeTitular,
        criadoPor: req.sessao.usuario.id,
        titularDoAdmin: req.sessao.usuario.titularId,
        ip: req.ip,
      });
      // O link é mostrado só agora: o token não fica guardado em lugar nenhum.
      return reply.code(201).send({
        id: novo.id,
        email: corpo.data.email.toLowerCase(),
        nomeTitular: corpo.data.nomeTitular,
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

  app.get("/admin/convites", async (req, reply) => {
    if (!exigirAdmin(req, reply)) return;
    return { convites: await listarConvites(db) };
  });

  // --- Públicas (quem recebeu o link ainda não tem conta) ---

  app.get("/convites/:token", async (req, reply) => {
    const p = parametros.safeParse(req.params);
    const convite = p.success ? await buscarConviteValido(db, segredoSessao, p.data.token) : null;
    if (!convite) return reply.code(404).send({ erro: "Convite inválido ou expirado" });
    return convite;
  });

  app.post("/convites/:token/aceitar", { config: { semCsrf: true } }, async (req, reply) => {
    const p = parametros.safeParse(req.params);
    const corpo = corpoAceitar.safeParse(req.body);
    if (!p.success || !corpo.success) return reply.code(400).send({ erro: "Dados inválidos" });
    try {
      const criado = await aceitarConvite(db, segredoSessao, p.data.token, corpo.data.senha, req.ip);
      return reply.code(201).send({ email: criado.email });
    } catch (e) {
      if (e instanceof ErroConvite) {
        return reply.code(STATUS_POR_CODIGO[e.codigo]).send({ erro: e.message });
      }
      throw e;
    }
  });
}
