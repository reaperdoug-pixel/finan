import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { temPermissao } from "../auth/permissoes.js";
import { confirmarSenha } from "../auth/reautenticacao.js";
import { exigirAdmin, exigirLogin, type AuthConfig } from "../auth/routes.js";
import { ErroCategoria, reativarCategoria } from "../categorias/servico.js";
import { ErroConta, reativarConta } from "../contas/servico.js";
import { ErroLancamento, reativarLancamento } from "../lancamentos/servico.js";
import {
  listarInativos,
  titularDoRegistro,
  titularExiste,
  type EntidadeAdmin,
} from "./servico.js";

const params = z.object({ id: z.uuid() });
const consultaAdmin = z.object({ titularId: z.uuid() });

const senhaDoCorpo = (corpo: unknown): unknown => (corpo as { senha?: unknown } | null)?.senha;

function gestor(papel: string): boolean {
  return papel === "admin" || papel === "titular";
}

/**
 * Tela de inativos: o titular (e o vinculado com `ver`) lista os próprios; o admin lista os
 * de qualquer titular e reativa categoria, conta e lançamento de qualquer um, com senha.
 * Reativar usuários e titulares continua nas rotas já existentes.
 */
export function rotasInativos(app: FastifyInstance, cfg: AuthConfig): void {
  const { db } = cfg;

  app.get("/inativos", async (req, reply) => {
    if (!exigirLogin(req, reply)) return;
    const s = req.sessao;
    return listarInativos(db, s.usuario.titularId, {
      lancamentos: temPermissao(s, "lancamentos", "ver"),
      categorias: temPermissao(s, "categorias", "ver"),
      contas: temPermissao(s, "contas", "ver"),
      usuarios: gestor(s.usuario.papel),
    });
  });

  app.get("/admin/inativos", async (req, reply) => {
    if (!exigirAdmin(req, reply)) return;
    const q = consultaAdmin.safeParse(req.query);
    if (!q.success) return reply.code(400).send({ erro: "Parâmetros inválidos" });
    if (!(await titularExiste(db, q.data.titularId))) {
      return reply.code(404).send({ erro: "Titular não encontrado" });
    }
    return listarInativos(db, q.data.titularId, {
      lancamentos: true,
      categorias: true,
      contas: true,
      usuarios: true,
    });
  });

  registrarReativarAdmin(app, cfg, "lancamentos", "lancamento", "Lançamento não encontrado");
  registrarReativarAdmin(app, cfg, "categorias", "categoria", "Categoria não encontrada");
  registrarReativarAdmin(app, cfg, "contas", "conta", "Conta não encontrada");
}

function registrarReativarAdmin(
  app: FastifyInstance,
  cfg: AuthConfig,
  caminho: "lancamentos" | "categorias" | "contas",
  entidade: EntidadeAdmin,
  naoEncontrado: string,
): void {
  const { db } = cfg;

  app.post(`/admin/${caminho}/:id/reativar`, async (req, reply) => {
    if (!exigirAdmin(req, reply)) return;
    const p = params.safeParse(req.params);
    if (!p.success) return reply.code(404).send({ erro: naoEncontrado });

    const titularId = await titularDoRegistro(db, entidade, p.data.id);
    if (!titularId) return reply.code(404).send({ erro: naoEncontrado });
    if (!(await confirmarSenha(db, req, reply, senhaDoCorpo(req.body)))) return;

    const ctx = { titularId, usuarioId: req.sessao.usuario.id, ip: req.ip };
    try {
      switch (entidade) {
        case "lancamento":
          await reativarLancamento(db, ctx, p.data.id);
          break;
        case "categoria":
          await reativarCategoria(db, ctx, p.data.id);
          break;
        case "conta":
          await reativarConta(db, ctx, p.data.id);
          break;
        default: {
          const _exaustivo: never = entidade;
          return _exaustivo;
        }
      }
      return { ativo: true };
    } catch (e) {
      return responderErroReativacao(reply, e, naoEncontrado);
    }
  });
}

function responderErroReativacao(reply: FastifyReply, e: unknown, naoEncontrado: string) {
  if (e instanceof ErroLancamento) {
    const status = e.codigo === "nao_encontrado" ? 404 : 409;
    return reply.code(status).send({
      erro: e.codigo === "nao_encontrado" ? naoEncontrado : e.message,
      codigo: e.codigo,
    });
  }
  if (e instanceof ErroCategoria) {
    const status = e.codigo === "nao_encontrada" ? 404 : 409;
    return reply.code(status).send({
      erro: e.codigo === "nao_encontrada" ? naoEncontrado : e.message,
      codigo: e.codigo,
      ...e.detalhes,
    });
  }
  if (e instanceof ErroConta) {
    const status = e.codigo === "nao_encontrada" ? 404 : 409;
    return reply.code(status).send({
      erro: e.codigo === "nao_encontrada" ? naoEncontrado : e.message,
      codigo: e.codigo,
      ...e.detalhes,
    });
  }
  throw e;
}
