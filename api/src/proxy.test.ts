import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { MAX_FALHAS_POR_IP } from "./auth/limite.js";
import { createDb, createPool } from "./db/client.js";
import { lerProxiesConfiaveis, PROXIES_PADRAO } from "./proxy.js";
import { criarAmbiente, type Ambiente } from "../test/ajudantes.js";

describe("lerProxiesConfiaveis", () => {
  it("usa só loopback quando vazio", () => {
    expect(lerProxiesConfiaveis(undefined)).toEqual(PROXIES_PADRAO);
    expect(lerProxiesConfiaveis(" ")).toEqual(PROXIES_PADRAO);
  });
  it("aceita lista de IPs e CIDRs", () => {
    expect(lerProxiesConfiaveis("127.0.0.1, 10.0.0.0/8")).toEqual(["127.0.0.1", "10.0.0.0/8"]);
  });
  it("recusa confiar em qualquer origem", () => {
    for (const v of ["true", "*", "0.0.0.0/0", "::/0"]) {
      expect(() => lerProxiesConfiaveis(v)).toThrow(/TRUST_PROXY/);
    }
  });
});

describe("request.ip com X-Forwarded-For", () => {
  // O pool só conecta quando há consulta; esta rota não consulta o banco.
  const pool = createPool("postgres://ninguem@127.0.0.1:1/inexistente");
  const app = buildApp({
    db: createDb(pool),
    segredoSessao: "segredo-de-teste-com-mais-de-trinta-e-dois-caracteres",
    origemApp: "http://localhost:5173",
    producao: false,
  });
  app.get("/teste/ip", async (req) => ({ ip: req.ip }));

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it("vindo do proxy confiável, usa o IP do cabeçalho", async () => {
    for (const proxy of ["127.0.0.1", "::1"]) {
      const res = await app.inject({
        method: "GET",
        url: "/teste/ip",
        remoteAddress: proxy,
        headers: { "x-forwarded-for": "203.0.113.7" },
      });
      expect(res.json()).toEqual({ ip: "203.0.113.7" });
    }
  });

  it("vindo de IP não confiável, ignora o cabeçalho forjado", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/teste/ip",
      remoteAddress: "198.51.100.9",
      headers: { "x-forwarded-for": "203.0.113.7" },
    });
    expect(res.json()).toEqual({ ip: "198.51.100.9" });
  });
});

describe("limite por IP não é burlado com X-Forwarded-For forjado", () => {
  let env: Ambiente;
  beforeAll(async () => {
    env = await criarAmbiente(96);
  });
  afterAll(async () => {
    await env.fechar();
  });

  it("falhas contam no IP da conexão e bloqueiam mesmo trocando o cabeçalho", async () => {
    const atacante = env.novoIp();
    const tentar = (i: number) =>
      env.app.inject({
        method: "POST",
        url: "/auth/login",
        remoteAddress: atacante,
        headers: { "x-forwarded-for": `203.0.113.${(i % 250) + 1}` },
        // E-mails diferentes: o limite por e-mail não entra em jogo, só o por IP.
        payload: { email: env.novoEmail(), senha: "senha-errada-123" },
      });

    for (let i = 0; i < MAX_FALHAS_POR_IP; i++) {
      expect((await tentar(i)).statusCode).toBe(401);
    }
    expect((await tentar(MAX_FALHAS_POR_IP)).statusCode).toBe(429);

    const { rows } = await env.owner.query<{ ip: string; n: string }>(
      `SELECT ip, count(*) AS n FROM tentativa_login WHERE ip = $1 OR ip LIKE '203.0.113.%' GROUP BY ip`,
      [atacante],
    );
    expect(rows).toEqual([{ ip: atacante, n: String(MAX_FALHAS_POR_IP) }]);
  });
});
