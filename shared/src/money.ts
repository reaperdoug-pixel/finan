/** Dinheiro é sempre inteiro em centavos. Nunca use float para valores. */

export function formatBRL(cents: number): string {
  if (!Number.isInteger(cents)) {
    throw new Error("Valor em centavos deve ser inteiro");
  }
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
}

/** Converte texto como "1.234,56" em centavos (123456). Retorna null se inválido. */
export function parseBRLToCents(input: string): number | null {
  const normalized = input.trim().replace(/\./g, "").replace(",", ".");
  if (!/^-?\d+(\.\d{1,2})?$/.test(normalized)) return null;
  const negative = normalized.startsWith("-");
  const [intPart = "0", decPart = ""] = normalized.replace("-", "").split(".");
  const cents = Number(intPart) * 100 + Number(decPart.padEnd(2, "0"));
  return negative ? -cents : cents;
}
