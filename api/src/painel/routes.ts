import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { exigirPermissao, temPermissao } from "../auth/permissoes.js";
import type { AuthConfig } from "../auth/routes.js";
import { dataDeHoje, montarPainel } from "./servico.js";

const consulta = z.object({
  mes: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Informe o mês no formato AAAA-MM")
    .optional(),
});

/**
 * Painel do titular (somente leitura). Exige `ver` em lançamentos. As seções de categorias
 * e de contas só vêm preenchidas para quem também pode ver esses módulos; sem a permissão
 * chegam como `null`, nunca com dados.
 */
export function rotasPainel(app: FastifyInstance, cfg: AuthConfig): void {
  const { db } = cfg;

  app.get("/painel", async (req, reply) => {
    if (!exigirPermissao(req, reply, "lancamentos", "ver")) return;
    const q = consulta.safeParse(req.query);
    if (!q.success) {
      return reply.code(400).send({ erro: q.error.issues[0]?.message ?? "Parâmetros inválidos" });
    }
    const mes = q.data.mes ?? dataDeHoje().slice(0, 7);
    return montarPainel(db, req.sessao.usuario.titularId, mes, {
      verCategorias: temPermissao(req.sessao, "categorias", "ver"),
      verContas: temPermissao(req.sessao, "contas", "ver"),
    });
  });
}
