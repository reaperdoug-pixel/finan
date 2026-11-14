import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { exigirPermissao } from "../auth/permissoes.js";
import { confirmarSenha } from "../auth/reautenticacao.js";
import type { AuthConfig } from "../auth/routes.js";
import { montarArvore } from "./arvore.js";
import {
  alterarCategoria,
  criarCategoria,
  ErroCategoria,
  inativarCategoria,
  listarCategorias,
  reativarCategoria,
  type CodigoErroCategoria,
} from "./servico.js";

const nome = z.string().trim().min(1, "Informe o nome").max(80, "O nome pode ter até 80 caracteres");
const tipo = z.enum(["receita", "despesa"]);
const natureza = z.enum(["fixa", "variavel"]);

const corpoCriar = z.object({
  nome,
  tipo: tipo.optional(),
  paiId: z.uuid().optional(),
  natureza: natureza.optional(),
  preverPelaMedia: z.boolean().optional(),
});

/** `.strict()`: tentar mudar o tipo ou a mãe (não suportado) é recusado, nunca ignorado em silêncio. */
const corpoAlterar = z
  .object({
    nome: nome.optional(),
    natureza: natureza.optional(),
    preverPelaMedia: z.boolean().optional(),
  })
  .strict();

const params = z.object({ id: z.uuid() });
const consultaLista = z.object({ incluirInativas: z.enum(["true", "false"]).optional() });

const STATUS: Record<CodigoErroCategoria, number> = {
  nao_encontrada: 404,
  tipo_diferente: 400,
  tipo_obrigatorio: 400,
  nivel_maximo: 409,
  pai_inativo: 409,
  nome_duplicado: 409,
  pai_com_lancamentos: 409,
  impedimentos: 409,
  ja_inativa: 409,
  ja_ativa: 409,
  inativa: 409,
};

function responderErro(reply: FastifyReply, e: ErroCategoria) {
  return reply.code(STATUS[e.codigo]).send({ erro: e.message, codigo: e.codigo, ...e.detalhes });
}

/**
 * Categorias do titular, em árvore de até 3 níveis. A permissão vem do módulo `categorias`:
 * ver (listar), cadastrar (criar), alterar (editar) e excluir (inativar e reativar). Inativar e
 * reativar também pedem a senha de quem opera. Tudo age só no titular da sessão.
 */
export function rotasCategorias(app: FastifyInstance, cfg: AuthConfig): void {
  const { db } = cfg;

  app.get("/categorias", async (req, reply) => {
    if (!exigirPermissao(req, reply, "categorias", "ver")) return;
    const q = consultaLista.safeParse(req.query);
    if (!q.success) return reply.code(400).send({ erro: "Parâmetros inválidos" });
    const linhas = await listarCategorias(
      db,
      req.sessao.usuario.titularId,
      q.data.incluirInativas === "true",
    );
    return { arvore: montarArvore(linhas) };
  });

  app.post("/categorias", async (req, reply) => {
    if (!exigirPermissao(req, reply, "categorias", "cadastrar")) return;
    const corpo = corpoCriar.safeParse(req.body);
    if (!corpo.success) {
      return reply.code(400).send({ erro: corpo.error.issues[0]?.message ?? "Dados inválidos" });
    }
    try {
      const criada = await criarCategoria(
        db,
        { titularId: req.sessao.usuario.titularId, usuarioId: req.sessao.usuario.id, ip: req.ip },
        corpo.data,
      );
      return reply.code(201).send(criada);
    } catch (e) {
      if (e instanceof ErroCategoria) return responderErro(reply, e);
      throw e;
    }
  });

  app.patch("/categorias/:id", async (req, reply) => {
    if (!exigirPermissao(req, reply, "categorias", "alterar")) return;
    const p = params.safeParse(req.params);
    if (!p.success) return reply.code(404).send({ erro: "Categoria não encontrada" });
    const corpo = corpoAlterar.safeParse(req.body);
    if (!corpo.success || Object.keys(corpo.data).length === 0) {
      const msg = corpo.success ? "Informe o que alterar" : (corpo.error.issues[0]?.message ?? "Dados inválidos");
      return reply.code(400).send({ erro: msg });
    }
    try {
      const nova = await alterarCategoria(
        db,
        { titularId: req.sessao.usuario.titularId, usuarioId: req.sessao.usuario.id, ip: req.ip },
        p.data.id,
        corpo.data,
      );
      return nova;
    } catch (e) {
      if (e instanceof ErroCategoria) return responderErro(reply, e);
      throw e;
    }
  });

  // Inativar e reativar: permissão `excluir` do módulo + senha de quem opera.
  for (const acao of ["inativar", "reativar"] as const) {
    app.post(`/categorias/:id/${acao}`, async (req, reply) => {
      if (!exigirPermissao(req, reply, "categorias", "excluir")) return;
      const p = params.safeParse(req.params);
      if (!p.success) return reply.code(404).send({ erro: "Categoria não encontrada" });
      const senha = (req.body as { senha?: unknown } | null)?.senha;
      if (!(await confirmarSenha(db, req, reply, senha))) return;

      const ctx = {
        titularId: req.sessao.usuario.titularId,
        usuarioId: req.sessao.usuario.id,
        ip: req.ip,
      };
      try {
        if (acao === "inativar") await inativarCategoria(db, ctx, p.data.id);
        else await reativarCategoria(db, ctx, p.data.id);
        return { ativo: acao === "reativar" };
      } catch (e) {
        if (e instanceof ErroCategoria) return responderErro(reply, e);
        throw e;
      }
    });
  }
}
