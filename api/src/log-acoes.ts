/**
 * Catálogo fechado das ações registradas no log de auditoria.
 *
 * Toda ação nova precisa ser adicionada aqui: `registrarLog` só aceita estes valores, então
 * errar o nome (ou inventar um sem documentar) não compila. O teste de auditoria também
 * exige que cada ação do catálogo seja realmente gerada por algum fluxo.
 */
export const ACOES_LOG = {
  adminCriado: "admin.criado",
  loginSucesso: "login.sucesso",
  loginFalha: "login.falha",
  loginBloqueado: "login.bloqueado",
  logout: "logout",
  reautenticacaoFalha: "reautenticacao.falha",
  reautenticacaoBloqueada: "reautenticacao.bloqueada",
  conviteCriado: "convite.criado",
  conviteAceito: "convite.aceito",
  permissaoAlterada: "permissao.alterada",
  usuarioInativado: "usuario.inativado",
  usuarioReativado: "usuario.reativado",
  titularInativado: "titular.inativado",
  titularReativado: "titular.reativado",
  conviteRevogado: "convite.revogado",
  redefinicaoCriada: "redefinicao.criada",
  redefinicaoConcluida: "redefinicao.concluida",
  categoriaCriada: "categoria.criada",
  categoriaAlterada: "categoria.alterada",
  categoriaInativada: "categoria.inativada",
  categoriaReativada: "categoria.reativada",
  categoriasPadraoCriadas: "categoria.padraocriada",
  contaCriada: "conta.criada",
  contaAlterada: "conta.alterada",
  contaInativada: "conta.inativada",
  contaReativada: "conta.reativada",
  lancamentoCriado: "lancamento.criado",
  lancamentoAlterado: "lancamento.alterado",
  lancamentoInativado: "lancamento.inativado",
  lancamentoReativado: "lancamento.reativado",
} as const;

export type AcaoLog = (typeof ACOES_LOG)[keyof typeof ACOES_LOG];

export const TODAS_AS_ACOES: readonly AcaoLog[] = Object.values(ACOES_LOG);
