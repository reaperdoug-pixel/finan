import { and, asc, count, eq } from "drizzle-orm";
import { camposInativacao, camposReativacao } from "../ciclo-de-vida.js";
import type { Db } from "../db/client.js";
import { conta, lancamento } from "../db/schema.js";
import { registrarLog } from "../log.js";

export type TipoConta = "carteira" | "banco" | "cartao";
export type TipoLancamento = "receita" | "despesa";

export type CodigoErroConta =
  | "nao_encontrada"
  | "nome_duplicado"
  | "impedimentos"
  | "ja_inativa"
  | "ja_ativa"
  | "inativa";

export class ErroConta extends Error {
  constructor(
    readonly codigo: CodigoErroConta,
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

export interface ContaPublica {
  id: string;
  nome: string;
  tipo: TipoConta;
  saldoInicial: number;
  saldo: number;
  ativo: boolean;
}

function codigoPg(e: unknown): string | undefined {
  return (e as { code?: string }).code ?? (e as { cause?: { code?: string } }).cause?.code;
}

const NOME_DUPLICADO = "Já existe uma conta ativa com este nome";

/** Receita soma; despesa subtrai. Previstos e inativos não chegam aqui. */
export function movimentoDoLancamento(tipo: TipoLancamento, valor: number): number {
  switch (tipo) {
    case "receita":
      return valor;
    case "despesa":
      return -valor;
    default: {
      const _n: never = tipo;
      throw new Error(String(_n));
    }
  }
}

export function saldoDaConta(
  saldoInicial: number,
  realizados: { tipo: TipoLancamento; valor: number }[],
): number {
  let saldo = saldoInicial;
  for (const l of realizados) saldo += movimentoDoLancamento(l.tipo, l.valor);
  return saldo;
}

function paraConta(c: typeof conta.$inferSelect, saldo: number): ContaPublica {
  return {
    id: c.id,
    nome: c.nome,
    tipo: c.tipo,
    saldoInicial: c.saldoInicial,
    saldo,
    ativo: c.ativo,
  };
}

async function travar(tx: Tx, titularId: string, id: string) {
  const [c] = await tx
    .select()
    .from(conta)
    .where(and(eq(conta.id, id), eq(conta.titularId, titularId)))
    .for("update");
  return c;
}

async function contarLancamentosAtivos(tx: Tx, titularId: string, id: string): Promise<number> {
  const [r] = await tx
    .select({ n: count() })
    .from(lancamento)
    .where(
      and(
        eq(lancamento.titularId, titularId),
        eq(lancamento.contaId, id),
        eq(lancamento.ativo, true),
      ),
    );
  return r?.n ?? 0;
}

async function calcularSaldo(
  db: Pick<Tx, "select">,
  titularId: string,
  contaId: string,
  saldoInicial: number,
): Promise<number> {
  const rows = await db
    .select({ tipo: lancamento.tipo, valor: lancamento.valor })
    .from(lancamento)
    .where(
      and(
        eq(lancamento.titularId, titularId),
        eq(lancamento.contaId, contaId),
        eq(lancamento.ativo, true),
        eq(lancamento.status, "realizado"),
      ),
    );
  const feitos: { tipo: TipoLancamento; valor: number }[] = [];
  for (const r of rows) {
    if ((r.tipo === "receita" || r.tipo === "despesa") && r.valor != null) {
      feitos.push({ tipo: r.tipo, valor: r.valor });
    }
  }
  return saldoDaConta(saldoInicial, feitos);
}

export async function listarContas(
  db: Db,
  titularId: string,
  incluirInativas: boolean,
): Promise<ContaPublica[]> {
  const linhas = await db
    .select()
    .from(conta)
    .where(
      incluirInativas
        ? eq(conta.titularId, titularId)
        : and(eq(conta.titularId, titularId), eq(conta.ativo, true)),
    )
    .orderBy(asc(conta.nome));

  const resultado: ContaPublica[] = [];
  for (const c of linhas) {
    resultado.push(paraConta(c, await calcularSaldo(db, titularId, c.id, c.saldoInicial)));
  }
  return resultado;
}

export interface NovaConta {
  nome: string;
  tipo: TipoConta;
  saldoInicial?: number;
}

export async function criarConta(db: Db, ctx: Contexto, dados: NovaConta): Promise<ContaPublica> {
  return db.transaction(async (tx) => {
    let criada: typeof conta.$inferSelect | undefined;
    const saldoInicial = dados.saldoInicial ?? 0;
    try {
      [criada] = await tx
        .insert(conta)
        .values({
          titularId: ctx.titularId,
          nome: dados.nome,
          tipo: dados.tipo,
          saldoInicial,
          criadoPor: ctx.usuarioId,
        })
        .returning();
    } catch (e) {
      if (codigoPg(e) === "23505") throw new ErroConta("nome_duplicado", NOME_DUPLICADO);
      throw e;
    }
    if (!criada) throw new Error("Falha ao criar a conta");

    await registrarLog(tx, {
      acao: "conta.criada",
      usuarioId: ctx.usuarioId,
      titularId: ctx.titularId,
      entidade: "conta",
      entidadeId: criada.id,
      ip: ctx.ip,
      depois: { nome: criada.nome, tipo: criada.tipo, saldoInicial: criada.saldoInicial },
    });
    return paraConta(criada, saldoInicial);
  });
}

export interface AlteracaoConta {
  nome?: string;
  tipo?: TipoConta;
  saldoInicial?: number;
}

export async function alterarConta(
  db: Db,
  ctx: Contexto,
  id: string,
  campos: AlteracaoConta,
): Promise<ContaPublica> {
  return db.transaction(async (tx) => {
    const atual = await travar(tx, ctx.titularId, id);
    if (!atual) throw new ErroConta("nao_encontrada", "Conta não encontrada");
    if (!atual.ativo) {
      throw new ErroConta("inativa", "A conta está inativa. Reative-a para alterar");
    }

    const antes: Record<string, unknown> = {};
    const depois: Record<string, unknown> = {};
    const mudancas: AlteracaoConta = {};
    for (const chave of ["nome", "tipo", "saldoInicial"] as const) {
      const novo = campos[chave];
      if (novo !== undefined && novo !== atual[chave]) {
        antes[chave] = atual[chave];
        depois[chave] = novo;
        (mudancas as Record<string, unknown>)[chave] = novo;
      }
    }
    if (Object.keys(mudancas).length === 0) {
      return paraConta(atual, await calcularSaldo(tx, ctx.titularId, atual.id, atual.saldoInicial));
    }

    let nova: typeof conta.$inferSelect | undefined;
    try {
      [nova] = await tx
        .update(conta)
        .set({ ...mudancas, atualizadoEm: new Date() })
        .where(eq(conta.id, atual.id))
        .returning();
    } catch (e) {
      if (codigoPg(e) === "23505") throw new ErroConta("nome_duplicado", NOME_DUPLICADO);
      throw e;
    }
    if (!nova) throw new Error("Falha ao alterar a conta");

    await registrarLog(tx, {
      acao: "conta.alterada",
      usuarioId: ctx.usuarioId,
      titularId: ctx.titularId,
      entidade: "conta",
      entidadeId: atual.id,
      ip: ctx.ip,
      antes,
      depois,
    });
    return paraConta(nova, await calcularSaldo(tx, ctx.titularId, nova.id, nova.saldoInicial));
  });
}

export async function inativarConta(db: Db, ctx: Contexto, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    const c = await travar(tx, ctx.titularId, id);
    if (!c) throw new ErroConta("nao_encontrada", "Conta não encontrada");
    if (!c.ativo) throw new ErroConta("ja_inativa", "A conta já está inativa");

    const lancamentosAtivos = await contarLancamentosAtivos(tx, ctx.titularId, c.id);
    if (lancamentosAtivos > 0) {
      throw new ErroConta(
        "impedimentos",
        `Não é possível inativar: ainda há ${lancamentosAtivos} lançamento(s) ativo(s). ` +
          "Inative os lançamentos primeiro",
        { lancamentosAtivos },
      );
    }

    await tx.update(conta).set(camposInativacao(ctx.usuarioId)).where(eq(conta.id, c.id));
    await registrarLog(tx, {
      acao: "conta.inativada",
      usuarioId: ctx.usuarioId,
      titularId: ctx.titularId,
      entidade: "conta",
      entidadeId: c.id,
      ip: ctx.ip,
      confirmadoPor: ctx.usuarioId,
      antes: { ativo: true, nome: c.nome },
      depois: { ativo: false },
    });
  });
}

export async function reativarConta(db: Db, ctx: Contexto, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    const c = await travar(tx, ctx.titularId, id);
    if (!c) throw new ErroConta("nao_encontrada", "Conta não encontrada");
    if (c.ativo) throw new ErroConta("ja_ativa", "A conta já está ativa");

    try {
      await tx.update(conta).set(camposReativacao()).where(eq(conta.id, c.id));
    } catch (e) {
      if (codigoPg(e) === "23505") throw new ErroConta("nome_duplicado", NOME_DUPLICADO);
      throw e;
    }
    await registrarLog(tx, {
      acao: "conta.reativada",
      usuarioId: ctx.usuarioId,
      titularId: ctx.titularId,
      entidade: "conta",
      entidadeId: c.id,
      ip: ctx.ip,
      confirmadoPor: ctx.usuarioId,
      antes: { ativo: false, nome: c.nome },
      depois: { ativo: true },
    });
  });
}
