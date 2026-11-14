import { and, desc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Db } from "../db/client.js";
import { categoria, conta, lancamento, titular, usuario } from "../db/schema.js";

export type CodigoImpedimento =
  | "categoria_inativa"
  | "conta_inativa"
  | "pai_inativo"
  | "titular_inativo";

export interface Impedimento {
  codigo: CodigoImpedimento;
  mensagem: string;
}

export interface InativoBase {
  id: string;
  inativadoEm: Date | null;
  impedimento: Impedimento | null;
}

export interface LancamentoInativo extends InativoBase {
  descricao: string;
  valor: number;
  data: string;
  tipo: "receita" | "despesa";
  categoriaId: string;
  contaId: string;
}

export interface CategoriaInativa extends InativoBase {
  nome: string;
  tipo: "receita" | "despesa";
  natureza: "fixa" | "variavel";
  nivel: number;
  paiId: string | null;
}

export interface ContaInativa extends InativoBase {
  nome: string;
  tipo: "carteira" | "banco" | "cartao";
}

export interface UsuarioInativo extends InativoBase {
  email: string;
}

export interface ListaInativos {
  lancamentos: LancamentoInativo[];
  categorias: CategoriaInativa[];
  contas: ContaInativa[];
  usuarios: UsuarioInativo[];
}

export interface QuaisInativos {
  lancamentos: boolean;
  categorias: boolean;
  contas: boolean;
  usuarios: boolean;
}

const pai = alias(categoria, "categoria_pai");

function impedimentoLancamento(
  categoriaAtiva: boolean,
  contaAtiva: boolean,
): Impedimento | null {
  if (!categoriaAtiva) {
    return {
      codigo: "categoria_inativa",
      mensagem: "A categoria deste lançamento está inativa. Reative a categoria primeiro",
    };
  }
  if (!contaAtiva) {
    return {
      codigo: "conta_inativa",
      mensagem: "A conta deste lançamento está inativa. Reative a conta primeiro",
    };
  }
  return null;
}

async function listarLancamentos(db: Db, titularId: string): Promise<LancamentoInativo[]> {
  const linhas = await db
    .select({
      id: lancamento.id,
      descricao: lancamento.descricao,
      valor: lancamento.valor,
      data: lancamento.data,
      tipo: lancamento.tipo,
      categoriaId: lancamento.categoriaId,
      contaId: lancamento.contaId,
      inativadoEm: lancamento.inativadoEm,
      categoriaAtiva: categoria.ativo,
      contaAtiva: conta.ativo,
    })
    .from(lancamento)
    .innerJoin(categoria, eq(categoria.id, lancamento.categoriaId))
    .innerJoin(conta, eq(conta.id, lancamento.contaId))
    .where(and(eq(lancamento.titularId, titularId), eq(lancamento.ativo, false)))
    .orderBy(desc(lancamento.inativadoEm), desc(lancamento.id));

  return linhas.map((l) => ({
    id: l.id,
    descricao: l.descricao,
    valor: l.valor,
    data: l.data,
    tipo: l.tipo,
    categoriaId: l.categoriaId,
    contaId: l.contaId,
    inativadoEm: l.inativadoEm,
    impedimento: impedimentoLancamento(l.categoriaAtiva, l.contaAtiva),
  }));
}

async function listarCategorias(db: Db, titularId: string): Promise<CategoriaInativa[]> {
  const linhas = await db
    .select({
      id: categoria.id,
      nome: categoria.nome,
      tipo: categoria.tipo,
      natureza: categoria.natureza,
      nivel: categoria.nivel,
      paiId: categoria.paiId,
      inativadoEm: categoria.inativadoEm,
      paiAtivo: pai.ativo,
    })
    .from(categoria)
    .leftJoin(pai, eq(pai.id, categoria.paiId))
    .where(and(eq(categoria.titularId, titularId), eq(categoria.ativo, false)))
    .orderBy(desc(categoria.inativadoEm), desc(categoria.id));

  return linhas.map((c) => ({
    id: c.id,
    nome: c.nome,
    tipo: c.tipo,
    natureza: c.natureza,
    nivel: c.nivel,
    paiId: c.paiId,
    inativadoEm: c.inativadoEm,
    impedimento:
      c.paiId && !c.paiAtivo
        ? {
            codigo: "pai_inativo" as const,
            mensagem: "A categoria pai está inativa. Reative a categoria pai primeiro",
          }
        : null,
  }));
}

async function listarContas(db: Db, titularId: string): Promise<ContaInativa[]> {
  const linhas = await db
    .select({
      id: conta.id,
      nome: conta.nome,
      tipo: conta.tipo,
      inativadoEm: conta.inativadoEm,
    })
    .from(conta)
    .where(and(eq(conta.titularId, titularId), eq(conta.ativo, false)))
    .orderBy(desc(conta.inativadoEm), desc(conta.id));

  return linhas.map((c) => ({ ...c, impedimento: null }));
}

async function listarUsuarios(db: Db, titularId: string): Promise<UsuarioInativo[]> {
  const linhas = await db
    .select({
      id: usuario.id,
      email: usuario.email,
      inativadoEm: usuario.inativadoEm,
      titularAtivo: titular.ativo,
    })
    .from(usuario)
    .innerJoin(titular, eq(titular.id, usuario.titularId))
    .where(
      and(
        eq(usuario.titularId, titularId),
        eq(usuario.papel, "vinculado"),
        eq(usuario.ativo, false),
      ),
    )
    .orderBy(desc(usuario.inativadoEm), desc(usuario.id));

  return linhas.map((u) => ({
    id: u.id,
    email: u.email,
    inativadoEm: u.inativadoEm,
    impedimento: u.titularAtivo
      ? null
      : {
          codigo: "titular_inativo" as const,
          mensagem: "O titular está inativo. Reative o titular primeiro",
        },
  }));
}

export async function titularExiste(db: Db, id: string): Promise<boolean> {
  const [t] = await db.select({ id: titular.id }).from(titular).where(eq(titular.id, id)).limit(1);
  return Boolean(t);
}

export async function listarInativos(
  db: Db,
  titularId: string,
  quais: QuaisInativos,
): Promise<ListaInativos> {
  return {
    lancamentos: quais.lancamentos ? await listarLancamentos(db, titularId) : [],
    categorias: quais.categorias ? await listarCategorias(db, titularId) : [],
    contas: quais.contas ? await listarContas(db, titularId) : [],
    usuarios: quais.usuarios ? await listarUsuarios(db, titularId) : [],
  };
}

export type EntidadeAdmin = "lancamento" | "categoria" | "conta";

/** Titular dono do registro, sem filtrar pelo titular da sessão (só o admin usa). */
export async function titularDoRegistro(
  db: Db,
  entidade: EntidadeAdmin,
  id: string,
): Promise<string | null> {
  switch (entidade) {
    case "lancamento": {
      const [r] = await db
        .select({ titularId: lancamento.titularId })
        .from(lancamento)
        .where(eq(lancamento.id, id))
        .limit(1);
      return r?.titularId ?? null;
    }
    case "categoria": {
      const [r] = await db
        .select({ titularId: categoria.titularId })
        .from(categoria)
        .where(eq(categoria.id, id))
        .limit(1);
      return r?.titularId ?? null;
    }
    case "conta": {
      const [r] = await db
        .select({ titularId: conta.titularId })
        .from(conta)
        .where(eq(conta.id, id))
        .limit(1);
      return r?.titularId ?? null;
    }
    default: {
      const _exaustivo: never = entidade;
      return _exaustivo;
    }
  }
}
