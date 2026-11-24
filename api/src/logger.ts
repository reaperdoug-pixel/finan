import type { FastifyServerOptions } from "fastify";

/** Campos que nunca podem aparecer no log: sessão, credenciais e senhas. */
export const CAMPOS_OCULTOS = [
  "headers.cookie",
  "headers.authorization",
  'headers["x-csrf-token"]',
  "req.headers.cookie",
  "req.headers.authorization",
  'req.headers["x-csrf-token"]',
  'res.headers["set-cookie"]',
  "senha",
  "password",
  "*.senha",
  "*.password",
  "*.senhaAtual",
  "*.novaSenha",
];

export type OpcoesLogger = Exclude<FastifyServerOptions["logger"], boolean | undefined>;

/**
 * Logger da API. Nível vem de LOG_LEVEL; nos testes (Vitest) o padrão é silencioso.
 * `stream` permite aos testes capturar a saída.
 */
export function opcoesLogger(stream?: NodeJS.WritableStream, nivel?: string): OpcoesLogger {
  const padrao = process.env.VITEST ? "silent" : "info";
  return {
    level: nivel ?? process.env.LOG_LEVEL ?? padrao,
    redact: { paths: CAMPOS_OCULTOS, censor: "[oculto]" },
    ...(stream ? { stream } : {}),
  };
}
