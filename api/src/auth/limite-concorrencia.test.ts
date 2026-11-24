import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { criarAmbiente, inserirUsuario, type Ambiente } from "../../test/ajudantes.js";
import { MAX_FALHAS_POR_EMAIL, MAX_FALHAS_POR_IP } from "./limite.js";

/**
 * Prova que o limite de tentativas é atômico: rajadas concorrentes (Promise.all) não
 * conseguem passar mais falhas do que o limite, porque checar e gravar acontecem sob trava.
 */
describe("limite de tentativas sob concorrência", () => {
  let env: Ambiente;
  beforeAll(async () => {
    env = await criarAmbiente(97);
  });
  afterAll(async () => {
    await env.fechar();
  });

  const login = (email: string, ip: string, senha = "senha-errada-123") =>
    env.app.inject({ method: "POST", url: "/auth/login", remoteAddress: ip, payload: { email, senha } });

  const contar = (codigos: number[]) =>
    codigos.reduce<Record<number, number>>((acc, c) => ({ ...acc, [c]: (acc[c] ?? 0) + 1 }), {});

  it("por IP: rajada concorrente gera exatamente o limite de 401 e o resto 429", async () => {
    const ip = env.novoIp();
    const extra = 10;
    const respostas = await Promise.all(
      Array.from({ length: MAX_FALHAS_POR_IP + extra }, () => login(env.novoEmail(), ip)),
    );
    expect(contar(respostas.map((r) => r.statusCode))).toEqual({ 401: MAX_FALHAS_POR_IP, 429: extra });

    const { rows } = await env.owner.query<{ n: string }>(
      "SELECT count(*) AS n FROM tentativa_login WHERE ip = $1 AND NOT sucesso",
      [ip],
    );
    expect(Number(rows[0]?.n)).toBe(MAX_FALHAS_POR_IP);
  });

  it("por e-mail: rajada concorrente de IPs diferentes para no limite do e-mail", async () => {
    const u = await inserirUsuario(env, { papel: "titular" });
    const extra = 7;
    const respostas = await Promise.all(
      Array.from({ length: MAX_FALHAS_POR_EMAIL + extra }, () => login(u.email, env.novoIp())),
    );
    expect(contar(respostas.map((r) => r.statusCode))).toEqual({ 401: MAX_FALHAS_POR_EMAIL, 429: extra });

    // A senha certa também é recusada enquanto o e-mail está bloqueado.
    const certa = await login(u.email, env.novoIp(), "senha-correta-123");
    expect(certa.statusCode).toBe(429);
  });

  it("logins corretos concorrentes do mesmo IP continuam funcionando", async () => {
    const ip = env.novoIp();
    const usuarios = await Promise.all(Array.from({ length: 8 }, () => inserirUsuario(env, { papel: "titular" })));
    const respostas = await Promise.all(usuarios.map((u) => login(u.email, ip, "senha-correta-123")));
    expect(respostas.every((r) => r.statusCode === 200)).toBe(true);
  });
});
