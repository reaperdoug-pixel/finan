/** Padrão seguro: só o Caddy local (loopback IPv4 e IPv6) pode informar o IP real do cliente. */
export const PROXIES_PADRAO: readonly string[] = ["127.0.0.1", "::1"];

const VALORES_PROIBIDOS = new Set(["true", "*", "0.0.0.0/0", "::/0"]);

/**
 * Lê TRUST_PROXY (lista separada por vírgula de IPs ou CIDRs). Vazio usa o padrão.
 * Recusa "confiar em todos": isso deixaria qualquer cliente forjar X-Forwarded-For
 * e burlar o limite de tentativas por IP.
 */
export function lerProxiesConfiaveis(valor: string | undefined): string[] {
  const itens = (valor ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (itens.length === 0) return [...PROXIES_PADRAO];
  const proibido = itens.find((s) => VALORES_PROIBIDOS.has(s.toLowerCase()));
  if (proibido) {
    throw new Error(`TRUST_PROXY não pode confiar em qualquer origem (valor: ${proibido})`);
  }
  return itens;
}
