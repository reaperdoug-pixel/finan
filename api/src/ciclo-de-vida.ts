/**
 * Nada se apaga: "excluir" é inativar, e inativar/reativar sempre exige a senha de quem opera
 * (ver `confirmarSenha` em auth/reautenticacao.ts) e gera log com `confirmado_por`.
 *
 * Estes são os campos que toda tabela de negócio grava ao mudar de estado. Reutilize nas rotas
 * de categorias, contas, lançamentos etc., em vez de repetir a lógica.
 */

/** Campos a gravar ao inativar. `inativado_em` e `ativo` nunca podem se contradizer (check no banco). */
export function camposInativacao(porUsuarioId: string) {
  const agora = new Date();
  return {
    ativo: false,
    inativadoEm: agora,
    inativadoPor: porUsuarioId,
    atualizadoEm: agora,
  };
}

/** Campos a gravar ao reativar. Quem inativou antes continua registrado no log. */
export function camposReativacao() {
  return {
    ativo: true,
    inativadoEm: null,
    inativadoPor: null,
    atualizadoEm: new Date(),
  };
}
