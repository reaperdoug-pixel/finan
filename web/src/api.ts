/** CSRF só em memória. Cookie de sessão é httpOnly; o front nunca guarda senha nem token. */

let csrf = "";
let aoSessaoExpirada: (() => void) | null = null;

export function definirCsrf(token: string): void {
  csrf = token;
}

/** Registra quem reage a um 401 de sessão expirada ou revogada (o SessaoProvider). */
export function definirAoSessaoExpirada(fn: (() => void) | null): void {
  aoSessaoExpirada = fn;
}

/**
 * Rotas em que 401 não significa "sessão caiu": login (senha errada), a checagem inicial de
 * sessão, o logout e as telas públicas de convite e redefinição, que não usam sessão.
 */
const SEM_TRATAMENTO_GLOBAL = ["/auth/login", "/auth/me", "/auth/logout"];
const PREFIXOS_PUBLICOS = ["/convites/", "/redefinicao/"];

export function indicaSessaoExpirada(caminho: string, status: number): boolean {
  if (status !== 401) return false;
  const rota = caminho.split("?")[0] ?? caminho;
  if (SEM_TRATAMENTO_GLOBAL.includes(rota)) return false;
  return !PREFIXOS_PUBLICOS.some((p) => rota.startsWith(p));
}

export class ApiErro extends Error {
  constructor(
    readonly status: number,
    readonly corpo: { erro?: string; codigo?: string },
  ) {
    super(corpo.erro ?? "Não foi possível concluir");
  }
}

export async function api<T>(
  caminho: string,
  o: { method?: string; body?: unknown } = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  if (csrf) headers["X-CSRF-Token"] = csrf;
  if (o.body !== undefined) headers["Content-Type"] = "application/json";
  const r = await fetch(`/api${caminho}`, {
    method: o.method ?? "GET",
    credentials: "include",
    headers,
    body: o.body === undefined ? undefined : JSON.stringify(o.body),
  });
  if (r.status === 204) return undefined as T;
  const corpo: unknown = await r.json().catch(() => ({ erro: "Resposta inválida" }));
  if (!r.ok) {
    if (indicaSessaoExpirada(caminho, r.status)) {
      csrf = "";
      aoSessaoExpirada?.();
    }
    // O erro continua sendo lançado: quem chamou encerra o próprio fluxo normalmente.
    throw new ApiErro(r.status, (corpo ?? {}) as { erro?: string; codigo?: string });
  }
  return corpo as T;
}
