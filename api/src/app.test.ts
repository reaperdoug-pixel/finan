import { describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { createDb, createPool } from "./db/client.js";

describe("GET /health", () => {
  it("responde ok", async () => {
    // O pool só conecta quando há consulta; /health não consulta o banco.
    const pool = createPool("postgres://ninguem@127.0.0.1:1/inexistente");
    const app = buildApp({
      db: createDb(pool),
      segredoSessao: "segredo-de-teste-com-mais-de-trinta-e-dois-caracteres",
      origemApp: "http://localhost:5173",
      producao: false,
    });
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-frame-options"]).toBe("DENY");
    expect(res.headers["referrer-policy"]).toBe("no-referrer");
    await app.close();
    await pool.end();
  });

  it("nenhuma rota de dados vai para cache", async () => {
    const pool = createPool("postgres://ninguem@127.0.0.1:1/inexistente");
    const app = buildApp({
      db: createDb(pool),
      segredoSessao: "segredo-de-teste-com-mais-de-trinta-e-dois-caracteres",
      origemApp: "http://localhost:5173",
      producao: false,
    });
    // Sem login a resposta é 401, mas os cabeçalhos valem para qualquer resposta.
    for (const url of ["/painel", "/lancamentos", "/contas", "/inativos", "/categorias", "/log"]) {
      const res = await app.inject({ method: "GET", url });
      expect(res.headers["cache-control"], url).toBe("no-store");
    }
    await app.close();
    await pool.end();
  });
});
