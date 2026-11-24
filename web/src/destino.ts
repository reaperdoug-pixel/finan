/** Estado levado para /login quando uma rota protegida exige sessão. */
export interface EstadoLogin {
  de?: string;
  expirou?: boolean;
}

/**
 * Para onde voltar depois do login. Só aceita caminho interno ("/x"), nunca outro site
 * ("//x", "http:") nem a própria tela de login, para não haver loop nem redirecionamento aberto.
 */
export function destinoAposLogin(estado: unknown, padrao: string): string {
  const de = (estado as EstadoLogin | null | undefined)?.de;
  if (typeof de !== "string" || !de.startsWith("/") || de.startsWith("//")) return padrao;
  const rota = de.split(/[?#]/)[0];
  if (rota === "/login" || rota === "/") return padrao;
  return de;
}

export function sessaoExpirou(estado: unknown): boolean {
  return (estado as EstadoLogin | null | undefined)?.expirou === true;
}
