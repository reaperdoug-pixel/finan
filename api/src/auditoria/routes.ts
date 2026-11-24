import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import { z } from "zod";
import { exigirPermissao } from "../auth/permissoes.js";
import type { AuthConfig } from "../auth/routes.js";
import { consultarLog, type CursorLog } from "./consulta.js";

const ROTULO_ADMIN = "Administrador do sistema";

const consulta = z.object({
  titularId: z.uuid().optional(),
  acao: z.string().min(1).max(80).optional(),
  usuarioId: z.uuid().optional(),
  desde: z.iso.datetime({ offset: true }).optional(),
  ate: z.iso.datetime({ offset: true }).optional(),
  limite: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).max(200).optional(),
});

const esquemaCursor = z.object({
  t: z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?[+-]\d{2}(:?\d{2})?$/),
  i: z.uuid(),
});

/** Cursor inválido é entrada do cliente (400), não falha do servidor: registra em nível debug. */
function lerCursor(texto: string, log: FastifyBaseLogger): CursorLog | null {
  try {
    const bruto: unknown = JSON.parse(Buffer.from(texto, "base64url").toString("utf8"));
    const r = esquemaCursor.safeParse(bruto);
    return r.success ? r.data : null;
  } catch (err) {
    log.debug({ err }, "cursor do log ilegível");
    return null;
  }
}

/**
 * Leitura do log de auditoria. Só existe `GET`: nenhuma rota escreve, altera ou apaga o log
 * (e o banco também não deixaria). Quem vê o quê:
 *  - admin: o log do sistema todo (opcionalmente filtrado por titular);
 *  - titular: o log do próprio titular, incluindo o que os vinculados fizeram;
 *  - vinculado: o mesmo, mas só com a permissão `ver` do módulo `log`.
 */
export function rotasAuditoria(app: FastifyInstance, cfg: AuthConfig): void {
  const { db } = cfg;

  app.get("/log", async (req, reply) => {
    if (!exigirPermissao(req, reply, "log", "ver")) return;
    const q = consulta.safeParse(req.query);
    if (!q.success) return reply.code(400).send({ erro: "Parâmetros inválidos" });

    const eAdmin = req.sessao.usuario.papel === "admin";
    const proprio = req.sessao.usuario.titularId;
    if (!eAdmin && q.data.titularId && q.data.titularId !== proprio) {
      return reply.code(403).send({ erro: "Sem permissão" });
    }

    let cursor: CursorLog | undefined;
    if (q.data.cursor) {
      cursor = lerCursor(q.data.cursor, req.log) ?? undefined;
      if (!cursor) return reply.code(400).send({ erro: "Cursor inválido" });
    }

    const { linhas, temMais } = await consultarLog(db, {
      // Admin vê tudo (ou o titular que pedir). Os demais nunca saem do próprio titular.
      titularId: eAdmin ? q.data.titularId : proprio,
      acao: q.data.acao,
      usuarioId: q.data.usuarioId,
      desde: q.data.desde ? new Date(q.data.desde) : undefined,
      ate: q.data.ate ? new Date(q.data.ate) : undefined,
      cursor,
      limite: q.data.limite,
    });

    const ultima = linhas[linhas.length - 1];
    return {
      itens: linhas.map((l) => ({
        id: l.id,
        ocorridoEm: l.ocorridoEm,
        usuarioId: l.usuarioId,
        // Quem não é admin não vê o e-mail do administrador do sistema.
        usuario: !l.usuarioEmail
          ? null
          : l.usuarioPapel === "admin" && !eAdmin
            ? ROTULO_ADMIN
            : l.usuarioEmail,
        titularId: l.titularId,
        acao: l.acao,
        entidade: l.entidade,
        entidadeId: l.entidadeId,
        ip: l.ip,
        antes: l.antes,
        depois: l.depois,
        confirmadoPor: l.confirmadoPor,
      })),
      proximo:
        temMais && ultima
          ? Buffer.from(JSON.stringify({ t: ultima.cursorTexto, i: ultima.id })).toString("base64url")
          : null,
    };
  });
}
