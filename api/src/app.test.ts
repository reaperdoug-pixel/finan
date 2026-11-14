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
    await app.close();
    await pool.end();
  });
});
