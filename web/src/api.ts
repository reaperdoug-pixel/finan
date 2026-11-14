/** CSRF só em memória. Cookie de sessão é httpOnly; o front nunca guarda senha nem token. */

let csrf = "";

export function definirCsrf(token: string): void {
  csrf = token;
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
    throw new ApiErro(r.status, (corpo ?? {}) as { erro?: string; codigo?: string });
  }
  return corpo as T;
}
