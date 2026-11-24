import { MAX_CENTAVOS, MIN_CENTAVOS } from "@finan/shared";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { exigirPermissao } from "../auth/permissoes.js";
import { confirmarSenha } from "../auth/reautenticacao.js";
import type { AuthConfig } from "../auth/routes.js";
import {
  alterarConta,
  criarConta,
  ErroConta,
  inativarConta,
  listarContas,
  reativarConta,
  type CodigoErroConta,
} from "./servico.js";

const nome = z.string().trim().min(1, "Informe o nome").max(80, "O nome pode ter até 80 caracteres");
const tipo = z.enum(["carteira", "banco", "cartao"]);
const centavos = z
  .number()
  .int("O valor deve ser em centavos (número inteiro)")
  .min(MIN_CENTAVOS, "O valor excede o limite suportado")
  .max(MAX_CENTAVOS, "O valor excede o limite suportado");

const corpoCriar = z.object({
  nome,
  tipo,
  saldoInicial: centavos.optional(),
});

/** `.strict()`: campos que não existem (ex.: limite de cartão) são recusados, nunca ignorados. */
const corpoAlterar = z
  .object({
    nome: nome.optional(),
    tipo: tipo.optional(),
    saldoInicial: centavos.optional(),
  })
  .strict();

const params = z.object({ id: z.uuid() });
const consultaLista = z.object({ incluirInativas: z.enum(["true", "false"]).optional() });

const STATUS: Record<CodigoErroConta, number> = {
  nao_encontrada: 404,
  nome_duplicado: 409,
  impedimentos: 409,
  ja_inativa: 409,
  ja_ativa: 409,
  inativa: 409,
};

function responderErro(reply: FastifyReply, e: ErroConta) {
  return reply.code(STATUS[e.codigo]).send({ erro: e.message, codigo: e.codigo, ...e.detalhes });
}

/**
 * Contas do titular (carteira, banco, cartão). Permissão do módulo `contas`:
 * ver (listar), cadastrar (criar), alterar (editar) e excluir (inativar e reativar).
 * Inativar e reativar também pedem a senha de quem opera. Tudo age só no titular da sessão.
 */
export function rotasContas(app: FastifyInstance, cfg: AuthConfig): void {
  const { db } = cfg;

  app.get("/contas", async (req, reply) => {
    if (!exigirPermissao(req, reply, "contas", "ver")) return;
    const q = consultaLista.safeParse(req.query);
    if (!q.success) return reply.code(400).send({ erro: "Parâmetros inválidos" });
    const contas = await listarContas(db, req.sessao.usuario.titularId, q.data.incluirInativas === "true");
    return { contas };
  });

  app.post("/contas", async (req, reply) => {
    if (!exigirPermissao(req, reply, "contas", "cadastrar")) return;
    const corpo = corpoCriar.safeParse(req.body);
    if (!corpo.success) {
      return reply.code(400).send({ erro: corpo.error.issues[0]?.message ?? "Dados inválidos" });
    }
    try {
      const criada = await criarConta(
        db,
        { titularId: req.sessao.usuario.titularId, usuarioId: req.sessao.usuario.id, ip: req.ip },
        corpo.data,
      );
      return reply.code(201).send(criada);
    } catch (e) {
      if (e instanceof ErroConta) return responderErro(reply, e);
      throw e;
    }
  });

  app.patch("/contas/:id", async (req, reply) => {
    if (!exigirPermissao(req, reply, "contas", "alterar")) return;
    const p = params.safeParse(req.params);
    if (!p.success) return reply.code(404).send({ erro: "Conta não encontrada" });
    const corpo = corpoAlterar.safeParse(req.body);
    if (!corpo.success || Object.keys(corpo.data).length === 0) {
      const msg = corpo.success ? "Informe o que alterar" : (corpo.error.issues[0]?.message ?? "Dados inválidos");
      return reply.code(400).send({ erro: msg });
    }
    try {
      const nova = await alterarConta(
        db,
        { titularId: req.sessao.usuario.titularId, usuarioId: req.sessao.usuario.id, ip: req.ip },
        p.data.id,
        corpo.data,
      );
      return nova;
    } catch (e) {
      if (e instanceof ErroConta) return responderErro(reply, e);
      throw e;
    }
  });

  for (const acao of ["inativar", "reativar"] as const) {
    app.post(`/contas/:id/${acao}`, async (req, reply) => {
      if (!exigirPermissao(req, reply, "contas", "excluir")) return;
      const p = params.safeParse(req.params);
      if (!p.success) return reply.code(404).send({ erro: "Conta não encontrada" });
      const senha = (req.body as { senha?: unknown } | null)?.senha;
      if (!(await confirmarSenha(db, req, reply, senha))) return;

      const ctx = {
        titularId: req.sessao.usuario.titularId,
        usuarioId: req.sessao.usuario.id,
        ip: req.ip,
      };
      try {
        if (acao === "inativar") await inativarConta(db, ctx, p.data.id);
        else await reativarConta(db, ctx, p.data.id);
        return { ativo: acao === "reativar" };
      } catch (e) {
        if (e instanceof ErroConta) return responderErro(reply, e);
        throw e;
      }
    });
  }
}
