import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { exigirPermissao } from "../auth/permissoes.js";
import { confirmarSenha } from "../auth/reautenticacao.js";
import type { AuthConfig } from "../auth/routes.js";
import {
  alterarContato,
  criarContato,
  ErroContato,
  inativarContato,
  listarContatos,
  reativarContato,
  type CodigoErroContato,
} from "./servico.js";

const nome = z.string().trim().min(1, "Informe o nome").max(120, "O nome pode ter até 120 caracteres");
const tipo = z.enum(["pf", "pj"]);
const papel = z.enum(["cliente", "fornecedor", "ambos"]);
const documento = z
  .union([z.string(), z.null()])
  .transform((v) => {
    if (v === null) return null;
    const limpo = v.replace(/[\s./-]/g, "");
    return limpo.length === 0 ? null : limpo;
  })
  .refine((v) => v === null || /^\d{11}$|^\d{14}$/.test(v), "Informe um CPF (11 dígitos) ou CNPJ (14 dígitos)");
const observacao = z
  .union([z.string(), z.null()])
  .transform((v) => {
    if (v === null) return null;
    const t = v.trim();
    return t.length === 0 ? null : t;
  })
  .refine((v) => v === null || v.length <= 500, "A observação pode ter até 500 caracteres");

const corpoCriar = z
  .object({
    nome,
    tipo,
    papel,
    documento: documento.optional(),
    observacao: observacao.optional(),
  })
  .strict();

const corpoAlterar = z
  .object({
    nome: nome.optional(),
    tipo: tipo.optional(),
    papel: papel.optional(),
    documento: documento.optional(),
    observacao: observacao.optional(),
  })
  .strict();

const params = z.object({ id: z.uuid() });
const consultaLista = z.object({ incluirInativos: z.enum(["true", "false"]).optional() });

const STATUS: Record<CodigoErroContato, number> = {
  nao_encontrado: 404,
  nome_duplicado: 409,
  documento_invalido: 400,
  impedimentos: 409,
  ja_inativo: 409,
  ja_ativo: 409,
  inativo: 409,
};

function responderErro(reply: FastifyReply, e: ErroContato) {
  return reply.code(STATUS[e.codigo]).send({ erro: e.message, codigo: e.codigo, ...e.detalhes });
}

/**
 * Contatos do titular (clientes, fornecedores ou ambos; PF ou PJ).
 * Permissão do módulo `contatos`. Inativar e reativar pedem senha. Tudo filtra por titular_id.
 */
export function rotasContatos(app: FastifyInstance, cfg: AuthConfig): void {
  const { db } = cfg;

  app.get("/contatos", async (req, reply) => {
    if (!exigirPermissao(req, reply, "contatos", "ver")) return;
    const q = consultaLista.safeParse(req.query);
    if (!q.success) return reply.code(400).send({ erro: "Parâmetros inválidos" });
    const contatos = await listarContatos(
      db,
      req.sessao.usuario.titularId,
      q.data.incluirInativos === "true",
    );
    return { contatos };
  });

  app.post("/contatos", async (req, reply) => {
    if (!exigirPermissao(req, reply, "contatos", "cadastrar")) return;
    const corpo = corpoCriar.safeParse(req.body);
    if (!corpo.success) {
      return reply.code(400).send({ erro: corpo.error.issues[0]?.message ?? "Dados inválidos" });
    }
    try {
      const criado = await criarContato(
        db,
        { titularId: req.sessao.usuario.titularId, usuarioId: req.sessao.usuario.id, ip: req.ip },
        corpo.data,
      );
      return reply.code(201).send(criado);
    } catch (e) {
      if (e instanceof ErroContato) return responderErro(reply, e);
      throw e;
    }
  });

  app.patch("/contatos/:id", async (req, reply) => {
    if (!exigirPermissao(req, reply, "contatos", "alterar")) return;
    const p = params.safeParse(req.params);
    if (!p.success) return reply.code(404).send({ erro: "Contato não encontrado" });
    const corpo = corpoAlterar.safeParse(req.body);
    if (!corpo.success || Object.keys(corpo.data).length === 0) {
      const msg = corpo.success
        ? "Informe o que alterar"
        : (corpo.error.issues[0]?.message ?? "Dados inválidos");
      return reply.code(400).send({ erro: msg });
    }
    try {
      return await alterarContato(
        db,
        { titularId: req.sessao.usuario.titularId, usuarioId: req.sessao.usuario.id, ip: req.ip },
        p.data.id,
        corpo.data,
      );
    } catch (e) {
      if (e instanceof ErroContato) return responderErro(reply, e);
      throw e;
    }
  });

  for (const acao of ["inativar", "reativar"] as const) {
    app.post(`/contatos/:id/${acao}`, async (req, reply) => {
      if (!exigirPermissao(req, reply, "contatos", "excluir")) return;
      const p = params.safeParse(req.params);
      if (!p.success) return reply.code(404).send({ erro: "Contato não encontrado" });
      const senha = (req.body as { senha?: unknown } | null)?.senha;
      if (!(await confirmarSenha(db, req, reply, senha))) return;

      const ctx = {
        titularId: req.sessao.usuario.titularId,
        usuarioId: req.sessao.usuario.id,
        ip: req.ip,
      };
      try {
        if (acao === "inativar") await inativarContato(db, ctx, p.data.id);
        else await reativarContato(db, ctx, p.data.id);
        return { ativo: acao === "reativar" };
      } catch (e) {
        if (e instanceof ErroContato) return responderErro(reply, e);
        throw e;
      }
    });
  }
}
