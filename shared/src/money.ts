/** Dinheiro é sempre inteiro em centavos. Nunca use float para valores. */

/** Limites de integer (int4) do PostgreSQL em centavos (~R$ 21,47 milhões). */
export const MAX_CENTAVOS = 2_147_483_647;
export const MIN_CENTAVOS = -2_147_483_648;

export function formatBRL(cents: number): string {
  if (!Number.isInteger(cents)) {
    throw new Error("Valor em centavos deve ser inteiro");
  }
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
}

/**
 * Converte texto em formato brasileiro ("1.234,56", "1234,56", "10", "-3,20") em centavos.
 * Rejeita ponto decimal (ex.: "25.90") para evitar interpretar silenciosamente como R$ 2.590,00.
 * Retorna null se inválido ou fora do limite suportado.
 */
export function parseBRLToCents(input: string): number | null {
  const trimmed = input.trim();
  if (!/^-?(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d{1,2})?$/.test(trimmed)) return null;
  const negative = trimmed.startsWith("-");
  const semSinal = negative ? trimmed.slice(1) : trimmed;
  const [intPart = "0", decPart = ""] = semSinal.replace(/\./g, "").split(",");
  const cents = Number(intPart) * 100 + Number(decPart.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents)) return null;
  const resultado = negative ? -cents : cents;
  if (resultado < MIN_CENTAVOS || resultado > MAX_CENTAVOS) return null;
  return resultado;
}
