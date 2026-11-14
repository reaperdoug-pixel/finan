import { and, count, desc, eq, gte, lte, type SQL } from "drizzle-orm";
import { camposInativacao, camposReativacao } from "../ciclo-de-vida.js";
import type { Db } from "../db/client.js";
import { categoria, conta, lancamento } from "../db/schema.js";
import { registrarLog } from "../log.js";

export type TipoLancamento = "receita" | "despesa";
export type StatusLancamento = "previsto" | "realizado";
export type Natureza = "fixa" | "variavel";

export type CodigoErroLancamento =
  | "nao_encontrado"
  | "nao_e_folha"
  | "categoria_inativa"
  | "conta_inativa"
  | "tipo_diferente"
  | "ja_inativo"
  | "ja_ativo"
  | "inativo";

export class ErroLancamento extends Error {
  constructor(
    readonly codigo: CodigoErroLancamento,
    mensagem: string,
    readonly detalhes?: Record<string, unknown>,
  ) {
    super(mensagem);
  }
}

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export interface Contexto {
  titularId: string;
  usuarioId: string;
  ip: string;
}

export interface LancamentoPublico {
  id: string;
  data: string;
  descricao: string;
  observacao: string | null;
  valor: number;
  tipo: TipoLancamento;
  natureza: Natureza;
  status: StatusLancamento;
  origem: "manual";
  categoriaId: string;
  contaId: string;
  valorPrevistoOriginal: number | null;
  ativo: boolean;
}

function paraPublico(l: typeof lancamento.$inferSelect): LancamentoPublico {
  return {
    id: l.id,
    data: l.data,
    descricao: l.descricao,
    observacao: l.observacao,
    valor: l.valor,
    tipo: l.tipo,
    natureza: l.natureza,
    status: l.status,
    origem: l.origem,
    categoriaId: l.categoriaId,
    contaId: l.contaId,
    valorPrevistoOriginal: l.valorPrevistoOriginal,
    ativo: l.ativo,
  };
}

async function travarLancamento(tx: Tx, titularId: string, id: string) {
  const [l] = await tx
    .select()
    .from(lancamento)
    .where(and(eq(lancamento.id, id), eq(lancamento.titularId, titularId)))
    .for("update");
  return l;
}

async function travarCategoria(tx: Tx, titularId: string, id: string) {
  const [c] = await tx
    .select()
    .from(categoria)
    .where(and(eq(categoria.id, id), eq(categoria.titularId, titularId)))
    .for("update");
  return c;
}

async function travarConta(tx: Tx, titularId: string, id: string) {
  const [c] = await tx
    .select()
    .from(conta)
    .where(and(eq(conta.id, id), eq(conta.titularId, titularId)))
    .for("update");
  return c;
}

async function contarFilhasAtivas(tx: Tx, titularId: string, id: string): Promise<number> {
  const [r] = await tx
    .select({ n: count() })
    .from(categoria)
    .where(
      and(eq(categoria.titularId, titularId), eq(categoria.paiId, id), eq(categoria.ativo, true)),
    );
  return r?.n ?? 0;
}

async function exigirFolhaAtiva(
  tx: Tx,
  titularId: string,
  categoriaId: string,
  tipoInformado?: TipoLancamento,
) {
  const cat = await travarCategoria(tx, titularId, categoriaId);
  if (!cat) throw new ErroLancamento("nao_encontrado", "Categoria não encontrada");
  if (!cat.ativo) {
    throw new ErroLancamento("categoria_inativa", "A categoria está inativa. Reative-a primeiro");
  }
  if ((await contarFilhasAtivas(tx, titularId, cat.id)) > 0) {
    throw new ErroLancamento(
      "nao_e_folha",
      "Só é possível lançar em categorias folha (sem subcategorias ativas)",
    );
  }
  if (tipoInformado && tipoInformado !== cat.tipo) {
    throw new ErroLancamento(
      "tipo_diferente",
      "O tipo do lançamento tem de ser o mesmo da categoria",
    );
  }
  return cat;
}

async function exigirContaAtiva(tx: Tx, titularId: string, contaId: string) {
  const c = await travarConta(tx, titularId, contaId);
  if (!c) throw new ErroLancamento("nao_encontrado", "Conta não encontrada");
  if (!c.ativo) {
    throw new ErroLancamento("conta_inativa", "A conta está inativa. Reative-a primeiro");
  }
  return c;
}

export interface FiltroLancamentos {
  incluirInativos: boolean;
  categoriaId?: string;
  contaId?: string;
  tipo?: TipoLancamento;
  status?: StatusLancamento;
  dataDesde?: string;
  dataAte?: string;
  limite: number;
  pagina: number;
}

export async function listarLancamentos(
  db: Db,
  titularId: string,
  f: FiltroLancamentos,
): Promise<{ lancamentos: LancamentoPublico[]; total: number; pagina: number; limite: number }> {
  const condicoes: SQL[] = [eq(lancamento.titularId, titularId)];
  if (!f.incluirInativos) condicoes.push(eq(lancamento.ativo, true));
  if (f.categoriaId) condicoes.push(eq(lancamento.categoriaId, f.categoriaId));
  if (f.contaId) condicoes.push(eq(lancamento.contaId, f.contaId));
  if (f.tipo) condicoes.push(eq(lancamento.tipo, f.tipo));
  if (f.status) condicoes.push(eq(lancamento.status, f.status));
  if (f.dataDesde) condicoes.push(gte(lancamento.data, f.dataDesde));
  if (f.dataAte) condicoes.push(lte(lancamento.data, f.dataAte));
  const where = and(...condicoes);

  const [tot] = await db.select({ n: count() }).from(lancamento).where(where);
  const linhas = await db
    .select()
    .from(lancamento)
    .where(where)
    .orderBy(desc(lancamento.data), desc(lancamento.id))
    .limit(f.limite)
    .offset((f.pagina - 1) * f.limite);

  return {
    lancamentos: linhas.map(paraPublico),
    total: Number(tot?.n ?? 0),
    pagina: f.pagina,
    limite: f.limite,
  };
}

export interface NovoLancamento {
  categoriaId: string;
  contaId: string;
  valor: number;
  data: string;
  descricao: string;
  observacao?: string | null;
  tipo?: TipoLancamento;
  natureza?: Natureza;
  status?: StatusLancamento;
}

export async function criarLancamento(
  db: Db,
  ctx: Contexto,
  dados: NovoLancamento,
): Promise<LancamentoPublico> {
  return db.transaction(async (tx) => {
    const cat = await exigirFolhaAtiva(tx, ctx.titularId, dados.categoriaId, dados.tipo);
    await exigirContaAtiva(tx, ctx.titularId, dados.contaId);

    const [criado] = await tx
      .insert(lancamento)
      .values({
        titularId: ctx.titularId,
        categoriaId: cat.id,
        contaId: dados.contaId,
        valor: dados.valor,
        tipo: cat.tipo,
        natureza: dados.natureza ?? cat.natureza,
        status: dados.status ?? "realizado",
        data: dados.data,
        descricao: dados.descricao,
        observacao: dados.observacao ?? null,
        origem: "manual",
        criadoPor: ctx.usuarioId,
      })
      .returning();
    if (!criado) throw new Error("Falha ao criar o lançamento");

    await registrarLog(tx, {
      acao: "lancamento.criado",
      usuarioId: ctx.usuarioId,
      titularId: ctx.titularId,
      entidade: "lancamento",
      entidadeId: criado.id,
      ip: ctx.ip,
      depois: {
        valor: criado.valor,
        data: criado.data,
        descricao: criado.descricao,
        tipo: criado.tipo,
        status: criado.status,
        categoriaId: criado.categoriaId,
        contaId: criado.contaId,
      },
    });
    return paraPublico(criado);
  });
}

export interface AlteracaoLancamento {
  categoriaId?: string;
  contaId?: string;
  valor?: number;
  data?: string;
  descricao?: string;
  observacao?: string | null;
  natureza?: Natureza;
  status?: StatusLancamento;
}

export async function alterarLancamento(
  db: Db,
  ctx: Contexto,
  id: string,
  campos: AlteracaoLancamento,
): Promise<LancamentoPublico> {
  return db.transaction(async (tx) => {
    const atual = await travarLancamento(tx, ctx.titularId, id);
    if (!atual) throw new ErroLancamento("nao_encontrado", "Lançamento não encontrado");
    if (!atual.ativo) {
      throw new ErroLancamento("inativo", "O lançamento está inativo. Reative-o para alterar");
    }

    let categoriaId = atual.categoriaId;
    let tipo = atual.tipo;
    let natureza = atual.natureza;
    if (campos.categoriaId) {
      const cat = await exigirFolhaAtiva(tx, ctx.titularId, campos.categoriaId);
      categoriaId = cat.id;
      tipo = cat.tipo;
      if (campos.natureza === undefined && campos.categoriaId !== atual.categoriaId) {
        natureza = cat.natureza;
      }
    }
    if (campos.contaId) await exigirContaAtiva(tx, ctx.titularId, campos.contaId);
    if (campos.natureza !== undefined) natureza = campos.natureza;

    const realizou = atual.status === "previsto" && campos.status === "realizado";
    const valorPrevistoOriginal = realizou
      ? (atual.valorPrevistoOriginal ?? atual.valor)
      : atual.valorPrevistoOriginal;

    const proximo = {
      categoriaId,
      contaId: campos.contaId ?? atual.contaId,
      valor: campos.valor ?? atual.valor,
      data: campos.data ?? atual.data,
      descricao: campos.descricao ?? atual.descricao,
      observacao: campos.observacao === undefined ? atual.observacao : campos.observacao,
      natureza,
      tipo,
      status: campos.status ?? atual.status,
      valorPrevistoOriginal,
    };

    const antes: Record<string, unknown> = {};
    const depois: Record<string, unknown> = {};
    const chaves = [
      "categoriaId",
      "contaId",
      "valor",
      "data",
      "descricao",
      "observacao",
      "natureza",
      "tipo",
      "status",
      "valorPrevistoOriginal",
    ] as const;
    for (const chave of chaves) {
      if (proximo[chave] !== atual[chave]) {
        antes[chave] = atual[chave];
        depois[chave] = proximo[chave];
      }
    }
    if (Object.keys(depois).length === 0) return paraPublico(atual);

    const [nova] = await tx
      .update(lancamento)
      .set({ ...proximo, atualizadoEm: new Date() })
      .where(eq(lancamento.id, atual.id))
      .returning();
    if (!nova) throw new Error("Falha ao alterar o lançamento");

    await registrarLog(tx, {
      acao: "lancamento.alterado",
      usuarioId: ctx.usuarioId,
      titularId: ctx.titularId,
      entidade: "lancamento",
      entidadeId: atual.id,
      ip: ctx.ip,
      antes,
      depois,
    });
    return paraPublico(nova);
  });
}

export async function inativarLancamento(db: Db, ctx: Contexto, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    const l = await travarLancamento(tx, ctx.titularId, id);
    if (!l) throw new ErroLancamento("nao_encontrado", "Lançamento não encontrado");
    if (!l.ativo) throw new ErroLancamento("ja_inativo", "O lançamento já está inativo");

    await tx.update(lancamento).set(camposInativacao(ctx.usuarioId)).where(eq(lancamento.id, l.id));
    await registrarLog(tx, {
      acao: "lancamento.inativado",
      usuarioId: ctx.usuarioId,
      titularId: ctx.titularId,
      entidade: "lancamento",
      entidadeId: l.id,
      ip: ctx.ip,
      confirmadoPor: ctx.usuarioId,
      antes: { ativo: true, descricao: l.descricao, valor: l.valor },
      depois: { ativo: false },
    });
  });
}

export async function reativarLancamento(db: Db, ctx: Contexto, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    const l = await travarLancamento(tx, ctx.titularId, id);
    if (!l) throw new ErroLancamento("nao_encontrado", "Lançamento não encontrado");
    if (l.ativo) throw new ErroLancamento("ja_ativo", "O lançamento já está ativo");

    const cat = await travarCategoria(tx, ctx.titularId, l.categoriaId);
    if (!cat?.ativo) {
      throw new ErroLancamento(
        "categoria_inativa",
        "A categoria deste lançamento está inativa. Reative a categoria primeiro",
      );
    }
    const c = await travarConta(tx, ctx.titularId, l.contaId);
    if (!c?.ativo) {
      throw new ErroLancamento(
        "conta_inativa",
        "A conta deste lançamento está inativa. Reative a conta primeiro",
      );
    }

    await tx.update(lancamento).set(camposReativacao()).where(eq(lancamento.id, l.id));
    await registrarLog(tx, {
      acao: "lancamento.reativado",
      usuarioId: ctx.usuarioId,
      titularId: ctx.titularId,
      entidade: "lancamento",
      entidadeId: l.id,
      ip: ctx.ip,
      confirmadoPor: ctx.usuarioId,
      antes: { ativo: false, descricao: l.descricao },
      depois: { ativo: true },
    });
  });
}
