export type Papel = "admin" | "titular" | "vinculado";
export type Acao = "ver" | "cadastrar" | "alterar" | "excluir";
export type Modulo =
  | "lancamentos"
  | "categorias"
  | "contas"
  | "contatos"
  | "orcamentos"
  | "anexos"
  | "log";
export type Permissoes = Record<Modulo, Record<Acao, boolean>>;

export interface UsuarioSessao {
  id: string;
  email: string;
  papel: Papel;
  titularId: string;
}

export interface Me {
  usuario: UsuarioSessao;
  permissoes: Permissoes;
  csrfToken: string;
}

export interface Lancamento {
  id: string;
  data: string;
  descricao: string;
  observacao: string | null;
  valor: number;
  tipo: "receita" | "despesa";
  natureza: "fixa" | "variavel";
  status: "previsto" | "realizado";
  origem: "manual";
  categoriaId: string;
  contaId: string;
  contatoId: string | null;
  valorPrevistoOriginal: number | null;
  ativo: boolean;
}

export interface Categoria {
  id: string;
  paiId: string | null;
  nome: string;
  tipo: "receita" | "despesa";
  natureza: "fixa" | "variavel";
  preverPelaMedia: boolean;
  nivel: number;
  ativo: boolean;
  temFilhasAtivas: boolean;
  filhas: Categoria[];
}

export interface Conta {
  id: string;
  nome: string;
  tipo: "carteira" | "banco" | "cartao";
  saldoInicial: number;
  saldo: number;
  ativo: boolean;
}

export interface Contato {
  id: string;
  nome: string;
  tipo: "pf" | "pj";
  papel: "cliente" | "fornecedor" | "ambos";
  documento: string | null;
  observacao: string | null;
  ativo: boolean;
  recebido: number;
  pago: number;
  aReceber: number;
  aPagar: number;
  totalLancamentos: number;
}

export interface TotaisMes {
  mes: string;
  receitas: number;
  despesas: number;
}

export interface GastoPorCategoria {
  id: string;
  nome: string;
  valor: number;
  anterior: number;
}

export interface MovimentoDaConta {
  id: string;
  nome: string;
  receitas: number;
  despesas: number;
}

/** Resposta de GET /painel. Tudo em centavos; `null` = sem permissão para ver a seção. */
export interface Painel {
  mes: string;
  mesAnterior: string;
  hoje: string;
  atual: TotaisMes;
  anterior: TotaisMes;
  serie: TotaisMes[];
  previstosDoMes: { quantidade: number; receitas: number; despesas: number };
  atrasados: { quantidade: number; receitas: number; despesas: number };
  despesasPorCategoria: GastoPorCategoria[] | null;
  receitasPorCategoria: GastoPorCategoria[] | null;
  despesasPorNatureza: {
    fixa: number;
    variavel: number;
    fixaAnterior: number;
    variavelAnterior: number;
  };
  movimentoPorConta: MovimentoDaConta[] | null;
  contas: {
    total: number;
    itens: Array<{ id: string; nome: string; tipo: Conta["tipo"]; saldo: number }>;
  } | null;
}

export interface Impedimento {
  codigo: string;
  mensagem: string;
}

export interface InativoBase {
  id: string;
  inativadoEm: string | null;
  impedimento: Impedimento | null;
}

export interface ListaInativos {
  lancamentos: Array<InativoBase & { descricao: string; valor: number; data: string; tipo: string }>;
  categorias: Array<InativoBase & { nome: string }>;
  contas: Array<InativoBase & { nome: string; tipo: string }>;
  contatos: Array<InativoBase & { nome: string; tipo: string; papel: string }>;
  usuarios: Array<InativoBase & { email: string }>;
}

export interface LinhaLog {
  id: string;
  ocorridoEm: string;
  usuario: string | null;
  acao: string;
  entidade: string | null;
  ip: string | null;
  antes: unknown;
  depois: unknown;
}
