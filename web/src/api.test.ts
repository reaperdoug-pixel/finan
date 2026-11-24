import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiErro, definirAoSessaoExpirada, definirCsrf, indicaSessaoExpirada } from "./api";

function resposta(status: number, corpo: unknown = {}): Response {
  return new Response(status === 204 ? null : JSON.stringify(corpo), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("indicaSessaoExpirada", () => {
  it("401 em rota protegida indica sessão expirada", () => {
    expect(indicaSessaoExpirada("/lancamentos", 401)).toBe(true);
    expect(indicaSessaoExpirada("/painel?mes=2026-11", 401)).toBe(true);
    expect(indicaSessaoExpirada("/admin/convites", 401)).toBe(true);
  });
  it("login, checagem de sessão, logout e telas públicas não contam", () => {
    for (const c of ["/auth/login", "/auth/me", "/auth/logout", "/convites/abc", "/redefinicao/xyz"]) {
      expect(indicaSessaoExpirada(c, 401), c).toBe(false);
    }
  });
  it("outros status não contam", () => {
    for (const s of [400, 403, 404, 429, 500]) expect(indicaSessaoExpirada("/lancamentos", s)).toBe(false);
  });
});

describe("api() e o tratamento global de 401", () => {
  const fetchFalso = vi.fn<typeof fetch>();
  const aoExpirar = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchFalso);
    definirAoSessaoExpirada(aoExpirar);
    definirCsrf("csrf-123");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    fetchFalso.mockReset();
    aoExpirar.mockReset();
    definirAoSessaoExpirada(null);
    definirCsrf("");
  });

  it("401 em chamada comum avisa a sessão, limpa o CSRF e ainda lança ApiErro", async () => {
    fetchFalso.mockResolvedValueOnce(resposta(401, { erro: "Não autenticado" }));
    await expect(api("/lancamentos")).rejects.toMatchObject({ status: 401, message: "Não autenticado" });
    expect(aoExpirar).toHaveBeenCalledTimes(1);

    // O CSRF antigo não vai mais em nenhuma requisição.
    fetchFalso.mockResolvedValueOnce(resposta(200, { ok: true }));
    await api("/auth/me");
    const headers = fetchFalso.mock.calls[1]?.[1]?.headers as Record<string, string>;
    expect(headers["X-CSRF-Token"]).toBeUndefined();
  });

  it("401 do login (senha errada) não redireciona e mantém a mensagem", async () => {
    fetchFalso.mockResolvedValueOnce(resposta(401, { erro: "E-mail ou senha incorretos" }));
    const erro = await api("/auth/login", { method: "POST", body: { email: "a@b.c", senha: "x" } }).catch(
      (e: unknown) => e,
    );
    expect(erro).toBeInstanceOf(ApiErro);
    expect((erro as ApiErro).message).toBe("E-mail ou senha incorretos");
    expect(aoExpirar).not.toHaveBeenCalled();
  });

  it("outros erros seguem o fluxo atual, sem mexer na sessão", async () => {
    for (const status of [400, 403, 404, 429, 500]) {
      fetchFalso.mockResolvedValueOnce(resposta(status, { erro: `erro ${status}` }));
      await expect(api("/lancamentos")).rejects.toMatchObject({ status, message: `erro ${status}` });
    }
    expect(aoExpirar).not.toHaveBeenCalled();
  });

  it("envia o CSRF nas requisições enquanto a sessão vale", async () => {
    fetchFalso.mockResolvedValueOnce(resposta(204));
    await api("/lancamentos/1", { method: "POST", body: {} });
    const init = fetchFalso.mock.calls[0]?.[1];
    expect((init?.headers as Record<string, string>)["X-CSRF-Token"]).toBe("csrf-123");
    expect(init?.credentials).toBe("include");
  });
});
