import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { exigirPermissao, podeLancar } from "../auth/permissoes.js";
import { confirmarSenha } from "../auth/reautenticacao.js";
import type { AuthConfig } from "../auth/routes.js";
import {
  alterarLancamento,
  criarLancamento,
  ErroLancamento,
  inativarLancamento,
  listarLancamentos,
  reativarLancamento,
  type CodigoErroLancamento,
} from "./servico.js";

const descricao = z
  .string()
  .trim()
  .min(1, "Informe a descrição")
  .max(120, "A descrição pode ter até 120 caracteres");
const observacao = z
  .string()
  .trim()
  .max(500, "A observação pode ter até 500 caracteres")
  .transform((s) => (s.length === 0 ? null : s));
const valor = z
  .number()
  .int("O valor deve ser em centavos (número inteiro)")
  .positive("O valor deve ser maior que zero");
const tipo = z.enum(["receita", "despesa"]);
const natureza = z.enum(["fixa", "variavel"]);
const status = z.enum(["previsto", "realizado"]);

function dataCalendario(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

const data = z.string().refine(dataCalendario, "Informe a data no formato AAAA-MM-DD");

const corpoCriar = z.object({
  categoriaId: z.uuid(),
  contaId: z.uuid(),
  valor,
  data,
  descricao,
  observacao: observacao.optional(),
  tipo: tipo.optional(),
  natureza: natureza.optional(),
  status: status.optional(),
});

const corpoAlterar = z
  .object({
    categoriaId: z.uuid().optional(),
    contaId: z.uuid().optional(),
    valor: valor.optional(),
    data: data.optional(),
    descricao: descricao.optional(),
    observacao: observacao.optional(),
    natureza: natureza.optional(),
    status: status.optional(),
  })
  .strict();

const params = z.object({ id: z.uuid() });
const consultaLista = z.object({
  incluirInativos: z.enum(["true", "false"]).optional(),
  categoriaId: z.uuid().optional(),
  contaId: z.uuid().optional(),
  tipo: tipo.optional(),
  status: status.optional(),
  dataDesde: data.optional(),
  dataAte: data.optional(),
  limite: z.coerce.number().int().min(1).max(100).default(50),
  pagina: z.coerce.number().int().min(1).default(1),
});

const STATUS: Record<CodigoErroLancamento, number> = {
  nao_encontrado: 404,
  nao_e_folha: 409,
  categoria_inativa: 409,
  conta_inativa: 409,
  tipo_diferente: 400,
  ja_inativo: 409,
  ja_ativo: 409,
  inativo: 409,
};

function responderErro(reply: FastifyReply, e: ErroLancamento) {
  return reply.code(STATUS[e.codigo]).send({ erro: e.message, codigo: e.codigo, ...e.detalhes });
}

/**
 * Lançamentos do titular. Só em categoria folha. Permissão do módulo `lancamentos`;
 * criar também exige `ver` em categorias e contas (`podeLancar`). Inativar e reativar
 * pedem a senha de quem opera. Reativar exige categoria e conta ativas.
 */
export function rotasLancamentos(app: FastifyInstance, cfg: AuthConfig): void {
  const { db } = cfg;

  app.get("/lancamentos", async (req, reply) => {
    if (!exigirPermissao(req, reply, "lancamentos", "ver")) return;
    const q = consultaLista.safeParse(req.query);
    if (!q.success) return reply.code(400).send({ erro: "Parâmetros inválidos" });
    return listarLancamentos(db, req.sessao.usuario.titularId, {
      incluirInativos: q.data.incluirInativos === "true",
      categoriaId: q.data.categoriaId,
      contaId: q.data.contaId,
      tipo: q.data.tipo,
      status: q.data.status,
      dataDesde: q.data.dataDesde,
      dataAte: q.data.dataAte,
      limite: q.data.limite,
      pagina: q.data.pagina,
    });
  });

  app.post("/lancamentos", async (req, reply) => {
    if (!exigirPermissao(req, reply, "lancamentos", "cadastrar")) return;
    if (!podeLancar(req.sessao)) return reply.code(403).send({ erro: "Sem permissão" });
    const corpo = corpoCriar.safeParse(req.body);
    if (!corpo.success) {
      return reply.code(400).send({ erro: corpo.error.issues[0]?.message ?? "Dados inválidos" });
    }
    try {
      const criado = await criarLancamento(
        db,
        { titularId: req.sessao.usuario.titularId, usuarioId: req.sessao.usuario.id, ip: req.ip },
        corpo.data,
      );
      return reply.code(201).send(criado);
    } catch (e) {
      if (e instanceof ErroLancamento) return responderErro(reply, e);
      throw e;
    }
  });

  app.patch("/lancamentos/:id", async (req, reply) => {
    if (!exigirPermissao(req, reply, "lancamentos", "alterar")) return;
    const p = params.safeParse(req.params);
    if (!p.success) return reply.code(404).send({ erro: "Lançamento não encontrado" });
    const corpo = corpoAlterar.safeParse(req.body);
    if (!corpo.success || Object.keys(corpo.data).length === 0) {
      const msg = corpo.success
        ? "Informe o que alterar"
        : (corpo.error.issues[0]?.message ?? "Dados inválidos");
      return reply.code(400).send({ erro: msg });
    }
    try {
      return await alterarLancamento(
        db,
        { titularId: req.sessao.usuario.titularId, usuarioId: req.sessao.usuario.id, ip: req.ip },
        p.data.id,
        corpo.data,
      );
    } catch (e) {
      if (e instanceof ErroLancamento) return responderErro(reply, e);
      throw e;
    }
  });

  for (const acao of ["inativar", "reativar"] as const) {
    app.post(`/lancamentos/:id/${acao}`, async (req, reply) => {
      if (!exigirPermissao(req, reply, "lancamentos", "excluir")) return;
      const p = params.safeParse(req.params);
      if (!p.success) return reply.code(404).send({ erro: "Lançamento não encontrado" });
      const senha = (req.body as { senha?: unknown } | null)?.senha;
      if (!(await confirmarSenha(db, req, reply, senha))) return;

      const ctx = {
        titularId: req.sessao.usuario.titularId,
        usuarioId: req.sessao.usuario.id,
        ip: req.ip,
      };
      try {
        if (acao === "inativar") await inativarLancamento(db, ctx, p.data.id);
        else await reativarLancamento(db, ctx, p.data.id);
        return { ativo: acao === "reativar" };
      } catch (e) {
        if (e instanceof ErroLancamento) return responderErro(reply, e);
        throw e;
      }
    });
  }
}
