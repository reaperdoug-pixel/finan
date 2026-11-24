import { and, asc, count, eq } from "drizzle-orm";
import { camposInativacao, camposReativacao } from "../ciclo-de-vida.js";
import type { Db } from "../db/client.js";
import { categoria, lancamento } from "../db/schema.js";
import { registrarLog } from "../log.js";
import type { LinhaCategoria } from "./arvore.js";

export const NIVEL_MAXIMO = 3;

export type CodigoErroCategoria =
  | "nao_encontrada"
  | "pai_inativo"
  | "nivel_maximo"
  | "tipo_diferente"
  | "tipo_obrigatorio"
  | "nome_duplicado"
  | "pai_com_lancamentos"
  | "impedimentos" // inativar com lançamentos ou subcategorias ainda ativos
  | "ja_inativa"
  | "ja_ativa"
  | "inativa"; // alterar uma categoria inativa

/** Erro com mensagem segura para devolver ao cliente (e detalhes opcionais, como contagens). */
export class ErroCategoria extends Error {
  constructor(
    readonly codigo: CodigoErroCategoria,
    mensagem: string,
    readonly detalhes?: Record<string, unknown>,
  ) {
    super(mensagem);
  }
}

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export interface Contexto {
  titularId: string;
  /** Quem opera (e, nas operações com senha, quem confirmou). */
  usuarioId: string;
  ip: string;
}

function codigoPg(e: unknown): string | undefined {
  return (e as { code?: string }).code ?? (e as { cause?: { code?: string } }).cause?.code;
}

const NOME_DUPLICADO = "Já existe uma categoria ativa com este nome neste nível";

const paraLinha = (c: typeof categoria.$inferSelect): LinhaCategoria => ({
  id: c.id,
  paiId: c.paiId,
  nome: c.nome,
  tipo: c.tipo,
  natureza: c.natureza,
  preverPelaMedia: c.preverPelaMedia,
  nivel: c.nivel,
  ativo: c.ativo,
});

/** Lê e TRAVA a categoria (do titular certo) até o fim da transação. */
async function travar(tx: Tx, titularId: string, id: string) {
  const [c] = await tx
    .select()
    .from(categoria)
    .where(and(eq(categoria.id, id), eq(categoria.titularId, titularId)))
    .for("update");
  return c;
}

async function contarFilhasAtivas(tx: Tx, titularId: string, id: string): Promise<number> {
  const [r] = await tx
    .select({ n: count() })
    .from(categoria)
    .where(
      and(
        eq(categoria.titularId, titularId),
        eq(categoria.paiId, id),
        eq(categoria.ativo, true),
      ),
    );
  return r?.n ?? 0;
}

async function contarLancamentosAtivos(tx: Tx, titularId: string, id: string): Promise<number> {
  const [r] = await tx
    .select({ n: count() })
    .from(lancamento)
    .where(
      and(
        eq(lancamento.titularId, titularId),
        eq(lancamento.categoriaId, id),
        eq(lancamento.ativo, true),
      ),
    );
  return r?.n ?? 0;
}

export async function listarCategorias(
  db: Db,
  titularId: string,
  incluirInativas: boolean,
): Promise<LinhaCategoria[]> {
  const linhas = await db
    .select()
    .from(categoria)
    .where(
      incluirInativas
        ? eq(categoria.titularId, titularId)
        : and(eq(categoria.titularId, titularId), eq(categoria.ativo, true)),
    )
    .orderBy(asc(categoria.nivel), asc(categoria.nome));
  return linhas.map(paraLinha);
}

export interface NovaCategoria {
  nome: string;
  /** Obrigatório na raiz; na filha é sempre o da mãe. */
  tipo?: "receita" | "despesa";
  paiId?: string;
  natureza?: "fixa" | "variavel";
  preverPelaMedia?: boolean;
}

/**
 * Cria uma categoria. Na filha: a mãe precisa existir no titular, estar ativa, ter nível menor
 * que 3 e não ter lançamentos ativos (quem ganha filha deixa de receber lançamento direto).
 */
export async function criarCategoria(
  db: Db,
  ctx: Contexto,
  dados: NovaCategoria,
): Promise<LinhaCategoria> {
  return db.transaction(async (tx) => {
    let tipo: "receita" | "despesa";
    let natureza: "fixa" | "variavel";
    let nivel = 1;
    let paiId: string | null = null;

    if (dados.paiId) {
      const pai = await travar(tx, ctx.titularId, dados.paiId);
      if (!pai) throw new ErroCategoria("nao_encontrada", "Categoria pai não encontrada");
      if (!pai.ativo) {
        throw new ErroCategoria("pai_inativo", "A categoria pai está inativa. Reative-a primeiro");
      }
      if (pai.nivel >= NIVEL_MAXIMO) {
        throw new ErroCategoria("nivel_maximo", `O máximo é ${NIVEL_MAXIMO} níveis de categorias`);
      }
      if (dados.tipo && dados.tipo !== pai.tipo) {
        throw new ErroCategoria("tipo_diferente", "A subcategoria tem sempre o mesmo tipo da mãe");
      }
      const comLancamentos = await contarLancamentosAtivos(tx, ctx.titularId, pai.id);
      if (comLancamentos > 0) {
        throw new ErroCategoria(
          "pai_com_lancamentos",
          "Esta categoria já tem lançamentos ativos e não pode ganhar subcategorias. " +
            "Inative os lançamentos antes",
          { lancamentosAtivos: comLancamentos },
        );
      }
      tipo = pai.tipo;
      natureza = dados.natureza ?? pai.natureza;
      nivel = pai.nivel + 1;
      paiId = pai.id;
    } else {
      if (!dados.tipo) {
        throw new ErroCategoria("tipo_obrigatorio", "Informe se a categoria é receita ou despesa");
      }
      tipo = dados.tipo;
      natureza = dados.natureza ?? "variavel";
    }

    let criada: typeof categoria.$inferSelect | undefined;
    try {
      [criada] = await tx
        .insert(categoria)
        .values({
          titularId: ctx.titularId,
          paiId,
          nome: dados.nome,
          tipo,
          natureza,
          preverPelaMedia: dados.preverPelaMedia ?? false,
          nivel,
          criadoPor: ctx.usuarioId,
        })
        .returning();
    } catch (e) {
      if (codigoPg(e) === "23505") throw new ErroCategoria("nome_duplicado", NOME_DUPLICADO);
      throw e;
    }
    if (!criada) throw new Error("Falha ao criar a categoria");

    await registrarLog(tx, {
      acao: "categoria.criada",
      usuarioId: ctx.usuarioId,
      titularId: ctx.titularId,
      entidade: "categoria",
      entidadeId: criada.id,
      ip: ctx.ip,
      depois: {
        nome: criada.nome,
        tipo: criada.tipo,
        natureza: criada.natureza,
        nivel: criada.nivel,
        paiId: criada.paiId,
        preverPelaMedia: criada.preverPelaMedia,
      },
    });
    return paraLinha(criada);
  });
}

export interface AlteracaoCategoria {
  nome?: string;
  natureza?: "fixa" | "variavel";
  preverPelaMedia?: boolean;
}

/**
 * Altera nome, natureza ou "prever pela média". Não muda tipo nem mãe (mover categoria fica
 * para uma versão futura). A natureza nova vale para os próximos lançamentos; os antigos
 * guardam a natureza que tinham. Sem mudança real, não grava nada nem registra no log.
 */
export async function alterarCategoria(
  db: Db,
  ctx: Contexto,
  id: string,
  campos: AlteracaoCategoria,
): Promise<LinhaCategoria> {
  return db.transaction(async (tx) => {
    const atual = await travar(tx, ctx.titularId, id);
    if (!atual) throw new ErroCategoria("nao_encontrada", "Categoria não encontrada");
    if (!atual.ativo) {
      throw new ErroCategoria("inativa", "A categoria está inativa. Reative-a para alterar");
    }

    const antes: Record<string, unknown> = {};
    const depois: Record<string, unknown> = {};
    const mudancas: AlteracaoCategoria = {};
    for (const chave of ["nome", "natureza", "preverPelaMedia"] as const) {
      const novo = campos[chave];
      if (novo !== undefined && novo !== atual[chave]) {
        antes[chave] = atual[chave];
        depois[chave] = novo;
        (mudancas as Record<string, unknown>)[chave] = novo;
      }
    }
    if (Object.keys(mudancas).length === 0) return paraLinha(atual);

    let nova: typeof categoria.$inferSelect | undefined;
    try {
      [nova] = await tx
        .update(categoria)
        .set({ ...mudancas, atualizadoEm: new Date() })
        .where(eq(categoria.id, atual.id))
        .returning();
    } catch (e) {
      if (codigoPg(e) === "23505") throw new ErroCategoria("nome_duplicado", NOME_DUPLICADO);
      throw e;
    }
    if (!nova) throw new Error("Falha ao alterar a categoria");

    await registrarLog(tx, {
      acao: "categoria.alterada",
      usuarioId: ctx.usuarioId,
      titularId: ctx.titularId,
      entidade: "categoria",
      entidadeId: atual.id,
      ip: ctx.ip,
      antes,
      depois,
    });
    return paraLinha(nova);
  });
}

/**
 * Inativa a categoria (nada se apaga). Só é possível sem lançamentos ativos e sem subcategorias
 * ativas; do contrário recusa e diz o que falta, na ordem: lançamentos, subcategorias, categoria.
 */
export async function inativarCategoria(db: Db, ctx: Contexto, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    const c = await travar(tx, ctx.titularId, id);
    if (!c) throw new ErroCategoria("nao_encontrada", "Categoria não encontrada");
    if (!c.ativo) throw new ErroCategoria("ja_inativa", "A categoria já está inativa");

    const lancamentosAtivos = await contarLancamentosAtivos(tx, ctx.titularId, c.id);
    const subcategoriasAtivas = await contarFilhasAtivas(tx, ctx.titularId, c.id);
    if (lancamentosAtivos > 0 || subcategoriasAtivas > 0) {
      const faltam: string[] = [];
      if (lancamentosAtivos > 0) faltam.push(`${lancamentosAtivos} lançamento(s) ativo(s)`);
      if (subcategoriasAtivas > 0) faltam.push(`${subcategoriasAtivas} subcategoria(s) ativa(s)`);
      throw new ErroCategoria(
        "impedimentos",
        `Não é possível inativar: ainda há ${faltam.join(" e ")}. ` +
          "Inative primeiro os lançamentos, depois as subcategorias",
        { lancamentosAtivos, subcategoriasAtivas },
      );
    }

    await tx.update(categoria).set(camposInativacao(ctx.usuarioId)).where(eq(categoria.id, c.id));
    await registrarLog(tx, {
      acao: "categoria.inativada",
      usuarioId: ctx.usuarioId,
      titularId: ctx.titularId,
      entidade: "categoria",
      entidadeId: c.id,
      ip: ctx.ip,
      confirmadoPor: ctx.usuarioId,
      antes: { ativo: true, nome: c.nome },
      depois: { ativo: false },
    });
  });
}

/** Reativa a categoria. A mãe precisa estar ativa e o nome não pode colidir com uma irmã ativa. */
export async function reativarCategoria(db: Db, ctx: Contexto, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    const c = await travar(tx, ctx.titularId, id);
    if (!c) throw new ErroCategoria("nao_encontrada", "Categoria não encontrada");
    if (c.ativo) throw new ErroCategoria("ja_ativa", "A categoria já está ativa");

    if (c.paiId) {
      const pai = await travar(tx, ctx.titularId, c.paiId);
      if (!pai?.ativo) {
        throw new ErroCategoria(
          "pai_inativo",
          "A categoria pai está inativa. Reative a categoria pai primeiro",
        );
      }
      const comLancamentos = await contarLancamentosAtivos(tx, ctx.titularId, pai.id);
      if (comLancamentos > 0) {
        throw new ErroCategoria(
          "pai_com_lancamentos",
          "A categoria pai já tem lançamentos ativos e não pode ter subcategorias. " +
            "Inative os lançamentos antes",
          { lancamentosAtivos: comLancamentos },
        );
      }
    }

    try {
      await tx.update(categoria).set(camposReativacao()).where(eq(categoria.id, c.id));
    } catch (e) {
      if (codigoPg(e) === "23505") throw new ErroCategoria("nome_duplicado", NOME_DUPLICADO);
      throw e;
    }
    await registrarLog(tx, {
      acao: "categoria.reativada",
      usuarioId: ctx.usuarioId,
      titularId: ctx.titularId,
      entidade: "categoria",
      entidadeId: c.id,
      ip: ctx.ip,
      confirmadoPor: ctx.usuarioId,
      antes: { ativo: false, nome: c.nome },
      depois: { ativo: true },
    });
  });
}
