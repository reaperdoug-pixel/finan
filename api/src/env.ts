import { fileURLToPath } from "node:url";

/**
 * Em desenvolvimento lê o .env da raiz do projeto. Em produção as variáveis
 * vêm do ambiente (systemd). Variáveis já definidas nunca são sobrescritas.
 */
export function loadEnv(): void {
  try {
    process.loadEnvFile(fileURLToPath(new URL("../../.env", import.meta.url)));
  } catch {
    // sem .env: segue só com o ambiente do processo
  }
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Variável de ambiente obrigatória ausente: ${name}`);
  }
  return value;
}
