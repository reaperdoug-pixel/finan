import { and, asc, count, eq, isNotNull, sql } from "drizzle-orm";
import { camposInativacao, camposReativacao } from "../ciclo-de-vida.js";
import type { Db } from "../db/client.js";
import { contato, lancamento } from "../db/schema.js";
import { registrarLog } from "../log.js";

export type TipoContato = "pf" | "pj";
export type PapelContato = "cliente" | "fornecedor" | "ambos";

export type CodigoErroContato =
  | "nao_encontrado"
  | "nome_duplicado"
  | "documento_invalido"
  | "impedimentos"
  | "ja_inativo"
  | "ja_ativo"
  | "inativo";

export class ErroContato extends Error {
  constructor(
    readonly codigo: CodigoErroContato,
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

export interface ContatoPublico {
  id: string;
  nome: string;
  tipo: TipoContato;
  papel: PapelContato;
  documento: string | null;
  observacao: string | null;
  ativo: boolean;
  /** Receitas realizadas ativas vinculadas a este contato (centavos). */
  recebido: number;
  /** Despesas realizadas ativas vinculadas a este contato (centavos). */
  pago: number;
  /** Receitas previstas ativas: quanto este contato ainda está devendo (centavos). */
  aReceber: number;
  /** Despesas previstas ativas: quanto ainda se deve pagar a este contato (centavos). */
  aPagar: number;
  /** Quantidade de lançamentos ativos vinculados. */
  totalLancamentos: number;
}

const NOME_DUPLICADO = "Já existe um contato ativo com este nome";

function codigoPg(e: unknown): string | undefined {
  return (e as { code?: string }).code ?? (e as { cause?: { code?: string } }).cause?.code;
}

function validarDocumentoPorTipo(tipo: TipoContato, documento: string | null): void {
  if (!documento) return;
  if (tipo === "pf" && documento.length !== 11) {
    throw new ErroContato("documento_invalido", "CPF deve ter 11 dígitos");
  }
  if (tipo === "pj" && documento.length !== 14) {
    throw new ErroContato("documento_invalido", "CNPJ deve ter 14 dígitos");
  }
}

async function travar(tx: Tx, titularId: string, id: string) {
  const [c] = await tx
    .select()
    .from(contato)
    .where(and(eq(contato.id, id), eq(contato.titularId, titularId)))
    .for("update");
  return c;
}

async function contarLancamentosAtivos(tx: Tx, titularId: string, contatoId: string): Promise<number> {
  const [r] = await tx
    .select({ n: count() })
    .from(lancamento)
    .where(
      and(
        eq(lancamento.titularId, titularId),
        eq(lancamento.contatoId, contatoId),
        eq(lancamento.ativo, true),
      ),
    );
  return r?.n ?? 0;
}

interface TotaisContato {
  recebido: number;
  pago: number;
  aReceber: number;
  aPagar: number;
  totalLancamentos: number;
}

const ZERADO: TotaisContato = {
  recebido: 0,
  pago: 0,
  aReceber: 0,
  aPagar: 0,
  totalLancamentos: 0,
};

function montarPublico(
  c: typeof contato.$inferSelect,
  totais: TotaisContato = ZERADO,
): ContatoPublico {
  return {
    id: c.id,
    nome: c.nome,
    tipo: c.tipo,
    papel: c.papel,
    documento: c.documento,
    observacao: c.observacao,
    ativo: c.ativo,
    ...totais,
  };
}

/**
 * Lista os contatos do titular com os totais calculados a partir dos lançamentos ativos:
 * realizados → recebido/pago; previstos → aReceber (me deve) / aPagar (eu devo).
 */
export async function listarContatos(
  db: Db,
  titularId: string,
  incluirInativos: boolean,
): Promise<ContatoPublico[]> {
  const [linhas, movimentos] = await Promise.all([
    db
      .select()
      .from(contato)
      .where(
        incluirInativos
          ? eq(contato.titularId, titularId)
          : and(eq(contato.titularId, titularId), eq(contato.ativo, true)),
      )
      .orderBy(asc(sql`lower(${contato.nome})`), asc(contato.id)),
    db
      .select({
        contatoId: lancamento.contatoId,
        tipo: lancamento.tipo,
        status: lancamento.status,
        soma: sql<string>`coalesce(sum(${lancamento.valor}), 0)`,
        qtd: sql<string>`count(*)`,
      })
      .from(lancamento)
      .where(
        and(
          eq(lancamento.titularId, titularId),
          eq(lancamento.ativo, true),
          isNotNull(lancamento.contatoId),
        ),
      )
      .groupBy(lancamento.contatoId, lancamento.tipo, lancamento.status),
  ]);

  const porContato = new Map<string, TotaisContato>();
  for (const m of movimentos) {
    if (!m.contatoId) continue;
    const t = porContato.get(m.contatoId) ?? { ...ZERADO };
    const valor = Number(m.soma);
    const qtd = Number(m.qtd);
    t.totalLancamentos += qtd;
    if (m.status === "realizado") {
      if (m.tipo === "receita") t.recebido += valor;
      else t.pago += valor;
    } else {
      if (m.tipo === "receita") t.aReceber += valor;
      else t.aPagar += valor;
    }
    porContato.set(m.contatoId, t);
  }

  return linhas.map((c) => montarPublico(c, porContato.get(c.id)));
}

export interface NovoContato {
  nome: string;
  tipo: TipoContato;
  papel: PapelContato;
  documento?: string | null;
  observacao?: string | null;
}

export async function criarContato(
  db: Db,
  ctx: Contexto,
  dados: NovoContato,
): Promise<ContatoPublico> {
  const documento = dados.documento ?? null;
  validarDocumentoPorTipo(dados.tipo, documento);

  return db.transaction(async (tx) => {
    let criado: typeof contato.$inferSelect | undefined;
    try {
      [criado] = await tx
        .insert(contato)
        .values({
          titularId: ctx.titularId,
          nome: dados.nome,
          tipo: dados.tipo,
          papel: dados.papel,
          documento,
          observacao: dados.observacao ?? null,
          criadoPor: ctx.usuarioId,
        })
        .returning();
    } catch (e) {
      if (codigoPg(e) === "23505") throw new ErroContato("nome_duplicado", NOME_DUPLICADO);
      throw e;
    }
    if (!criado) throw new Error("Falha ao criar o contato");

    await registrarLog(tx, {
      acao: "contato.criado",
      usuarioId: ctx.usuarioId,
      titularId: ctx.titularId,
      entidade: "contato",
      entidadeId: criado.id,
      ip: ctx.ip,
      depois: {
        nome: criado.nome,
        tipo: criado.tipo,
        papel: criado.papel,
        documento: criado.documento,
        observacao: criado.observacao,
      },
    });
    return montarPublico(criado);
  });
}

export interface AlteracaoContato {
  nome?: string;
  tipo?: TipoContato;
  papel?: PapelContato;
  documento?: string | null;
  observacao?: string | null;
}

export async function alterarContato(
  db: Db,
  ctx: Contexto,
  id: string,
  campos: AlteracaoContato,
): Promise<ContatoPublico> {
  return db.transaction(async (tx) => {
    const atual = await travar(tx, ctx.titularId, id);
    if (!atual) throw new ErroContato("nao_encontrado", "Contato não encontrado");
    if (!atual.ativo) {
      throw new ErroContato("inativo", "O contato está inativo. Reative-o para alterar");
    }

    const proximoTipo = campos.tipo ?? atual.tipo;
    const proximoDocumento = campos.documento === undefined ? atual.documento : campos.documento;
    validarDocumentoPorTipo(proximoTipo, proximoDocumento);

    const antes: Record<string, unknown> = {};
    const depois: Record<string, unknown> = {};
    const mudancas: AlteracaoContato = {};
    for (const chave of ["nome", "tipo", "papel", "documento", "observacao"] as const) {
      const novo = campos[chave];
      if (novo !== undefined && novo !== atual[chave]) {
        antes[chave] = atual[chave];
        depois[chave] = novo;
        (mudancas as Record<string, unknown>)[chave] = novo;
      }
    }

    const totais = await calcularTotaisDoContato(tx, ctx.titularId, atual.id);
    if (Object.keys(mudancas).length === 0) return montarPublico(atual, totais);

    let novoRegistro: typeof contato.$inferSelect | undefined;
    try {
      [novoRegistro] = await tx
        .update(contato)
        .set({ ...mudancas, atualizadoEm: new Date() })
        .where(eq(contato.id, atual.id))
        .returning();
    } catch (e) {
      if (codigoPg(e) === "23505") throw new ErroContato("nome_duplicado", NOME_DUPLICADO);
      throw e;
    }
    if (!novoRegistro) throw new Error("Falha ao alterar o contato");

    await registrarLog(tx, {
      acao: "contato.alterado",
      usuarioId: ctx.usuarioId,
      titularId: ctx.titularId,
      entidade: "contato",
      entidadeId: atual.id,
      ip: ctx.ip,
      antes,
      depois,
    });
    return montarPublico(novoRegistro, totais);
  });
}

async function calcularTotaisDoContato(
  tx: Tx,
  titularId: string,
  contatoId: string,
): Promise<TotaisContato> {
  const linhas = await tx
    .select({
      tipo: lancamento.tipo,
      status: lancamento.status,
      soma: sql<string>`coalesce(sum(${lancamento.valor}), 0)`,
      qtd: sql<string>`count(*)`,
    })
    .from(lancamento)
    .where(
      and(
        eq(lancamento.titularId, titularId),
        eq(lancamento.contatoId, contatoId),
        eq(lancamento.ativo, true),
      ),
    )
    .groupBy(lancamento.tipo, lancamento.status);

  const t: TotaisContato = { ...ZERADO };
  for (const m of linhas) {
    const valor = Number(m.soma);
    t.totalLancamentos += Number(m.qtd);
    if (m.status === "realizado") {
      if (m.tipo === "receita") t.recebido += valor;
      else t.pago += valor;
    } else {
      if (m.tipo === "receita") t.aReceber += valor;
      else t.aPagar += valor;
    }
  }
  return t;
}

export async function inativarContato(db: Db, ctx: Contexto, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    const c = await travar(tx, ctx.titularId, id);
    if (!c) throw new ErroContato("nao_encontrado", "Contato não encontrado");
    if (!c.ativo) throw new ErroContato("ja_inativo", "O contato já está inativo");

    const lancamentosAtivos = await contarLancamentosAtivos(tx, ctx.titularId, c.id);
    if (lancamentosAtivos > 0) {
      throw new ErroContato(
        "impedimentos",
        `Não é possível inativar: ainda há ${lancamentosAtivos} lançamento(s) ativo(s) neste contato. ` +
          "Inative ou desvincule os lançamentos antes",
        { lancamentosAtivos },
      );
    }

    await tx.update(contato).set(camposInativacao(ctx.usuarioId)).where(eq(contato.id, c.id));
    await registrarLog(tx, {
      acao: "contato.inativado",
      usuarioId: ctx.usuarioId,
      titularId: ctx.titularId,
      entidade: "contato",
      entidadeId: c.id,
      ip: ctx.ip,
      confirmadoPor: ctx.usuarioId,
      antes: { ativo: true, nome: c.nome },
      depois: { ativo: false },
    });
  });
}

export async function reativarContato(db: Db, ctx: Contexto, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    const c = await travar(tx, ctx.titularId, id);
    if (!c) throw new ErroContato("nao_encontrado", "Contato não encontrado");
    if (c.ativo) throw new ErroContato("ja_ativo", "O contato já está ativo");

    try {
      await tx.update(contato).set(camposReativacao()).where(eq(contato.id, c.id));
    } catch (e) {
      if (codigoPg(e) === "23505") throw new ErroContato("nome_duplicado", NOME_DUPLICADO);
      throw e;
    }
    await registrarLog(tx, {
      acao: "contato.reativado",
      usuarioId: ctx.usuarioId,
      titularId: ctx.titularId,
      entidade: "contato",
      entidadeId: c.id,
      ip: ctx.ip,
      confirmadoPor: ctx.usuarioId,
      antes: { ativo: false, nome: c.nome },
      depois: { ativo: true },
    });
  });
}
