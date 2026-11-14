import { eq, sql } from "drizzle-orm";
import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Db } from "../db/client.js";
import { MODULOS, permissao } from "../db/schema.js";
import type { SessaoAtual } from "./sessao.js";

export { MODULOS };
export type Modulo = (typeof MODULOS)[number];
export const ACOES = ["ver", "cadastrar", "alterar", "excluir"] as const;
export type Acao = (typeof ACOES)[number];
export type PermissoesModulo = Record<Acao, boolean>;
export type Permissoes = Record<Modulo, PermissoesModulo>;

const nenhuma = (): PermissoesModulo => ({
  ver: false,
  cadastrar: false,
  alterar: false,
  excluir: false,
});

export function permissoesNulas(): Permissoes {
  return Object.fromEntries(MODULOS.map((m) => [m, nenhuma()])) as Permissoes;
}

/** Titular e admin: tudo sobre os dados do próprio titular. No log só existe `ver`. */
export function permissoesTotais(): Permissoes {
  const p = permissoesNulas();
  for (const m of MODULOS) {
    p[m] =
      m === "log"
        ? { ver: true, cadastrar: false, alterar: false, excluir: false }
        : { ver: true, cadastrar: true, alterar: true, excluir: true };
  }
  return p;
}

// --- Entrada: o que o cliente pode mandar ---

const esquemaModulo = z
  .object({
    ver: z.boolean().optional(),
    cadastrar: z.boolean().optional(),
    alterar: z.boolean().optional(),
    excluir: z.boolean().optional(),
  })
  .strict();

/** `.strict()`: módulo ou ação desconhecidos são recusados, nunca ignorados em silêncio. */
const esquemaPermissoes = z
  .object(
    Object.fromEntries(MODULOS.map((m) => [m, esquemaModulo.optional()])) as Record<
      Modulo,
      z.ZodOptional<typeof esquemaModulo>
    >,
  )
  .strict();

/** Regras de dependência. Devolve a mensagem do primeiro problema, ou null se está tudo certo. */
export function validarRegras(p: Permissoes): string | null {
  for (const m of MODULOS) {
    const x = p[m];
    if (m === "log" && (x.cadastrar || x.alterar || x.excluir)) {
      return "O módulo log só aceita a permissão de ver";
    }
    if ((x.alterar || x.excluir) && !x.ver) {
      return `Módulo ${m}: alterar e excluir exigem a permissão de ver`;
    }
  }
  return null;
}

/** Valida e completa (ausente = falso) as permissões enviadas pelo cliente. */
export function interpretarPermissoes(
  entrada: unknown,
): { ok: true; permissoes: Permissoes } | { ok: false; erro: string } {
  const parsed = esquemaPermissoes.safeParse(entrada ?? {});
  if (!parsed.success) return { ok: false, erro: "Permissões inválidas" };
  const p = permissoesNulas();
  for (const m of MODULOS) {
    const e = parsed.data[m];
    if (e) for (const a of ACOES) p[m][a] = e[a] === true;
  }
  const erro = validarRegras(p);
  return erro ? { ok: false, erro } : { ok: true, permissoes: p };
}

/** Lê permissões já guardadas (ex.: no convite). Devolve null se estiverem inválidas. */
export function lerPermissoes(json: unknown): Permissoes | null {
  const r = interpretarPermissoes(json);
  return r.ok ? r.permissoes : null;
}

// --- Banco ---

export async function carregarPermissoes(
  db: Pick<Db, "select">,
  usuarioId: string,
): Promise<Permissoes> {
  const linhas = await db.select().from(permissao).where(eq(permissao.usuarioId, usuarioId));
  const p = permissoesNulas();
  for (const l of linhas) {
    p[l.modulo] = { ver: l.ver, cadastrar: l.cadastrar, alterar: l.alterar, excluir: l.excluir };
  }
  return p;
}

/** Grava as 6 linhas (uma por módulo), criando ou atualizando. Nunca apaga. */
export async function gravarPermissoes(
  db: Pick<Db, "insert">,
  usuarioId: string,
  p: Permissoes,
): Promise<void> {
  await db
    .insert(permissao)
    .values(MODULOS.map((modulo) => ({ usuarioId, modulo, ...p[modulo] })))
    .onConflictDoUpdate({
      target: [permissao.usuarioId, permissao.modulo],
      set: {
        ver: sql`excluded.ver`,
        cadastrar: sql`excluded.cadastrar`,
        alterar: sql`excluded.alterar`,
        excluir: sql`excluded.excluir`,
        atualizadoEm: sql`now()`,
      },
    });
}

// --- Checagens (usadas pelos módulos das próximas tarefas) ---

export function temPermissao(
  s: Pick<SessaoAtual, "permissoes">,
  modulo: Modulo,
  acao: Acao,
): boolean {
  return s.permissoes[modulo][acao];
}

/** Lançar exige cadastrar em lançamentos e ver em categorias e contas. */
export function podeLancar(s: Pick<SessaoAtual, "permissoes">): boolean {
  return (
    temPermissao(s, "lancamentos", "cadastrar") &&
    temPermissao(s, "categorias", "ver") &&
    temPermissao(s, "contas", "ver")
  );
}

/** Anexos herdam a visibilidade do lançamento: sem ver lançamentos, sem acesso ao anexo. */
export function podeVerAnexo(s: Pick<SessaoAtual, "permissoes">): boolean {
  return temPermissao(s, "anexos", "ver") && temPermissao(s, "lancamentos", "ver");
}

/** 401 sem login, 403 sem a permissão. Use no início de toda rota de módulo. */
export function exigirPermissao(
  req: FastifyRequest,
  reply: FastifyReply,
  modulo: Modulo,
  acao: Acao,
): req is FastifyRequest & { sessao: SessaoAtual } {
  if (!req.sessao) {
    void reply.code(401).send({ erro: "Não autenticado" });
    return false;
  }
  if (!temPermissao(req.sessao, modulo, acao)) {
    void reply.code(403).send({ erro: "Sem permissão" });
    return false;
  }
  return true;
}
