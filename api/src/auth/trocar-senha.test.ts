import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  chamar,
  criarAmbiente,
  entrar,
  logar,
  SENHA,
  type Ambiente,
} from "../../test/ajudantes.js";

/** Trocar a própria senha: o que a bateria de reautenticação não cobre (regras da senha nova e das sessões). */

let env: Ambiente;
const NOVA = "uma-senha-nova-bem-longa-9";

beforeAll(async () => {
  env = await criarAmbiente(95);
});
afterAll(async () => {
  await env.fechar();
});

describe("POST /auth/senha", () => {
  it("recusa senha nova curta, sem tocar na senha", async () => {
    const u = await entrar(env, { papel: "titular" });
    const res = await chamar(env, u, "POST", "/auth/senha", { senha: SENHA, novaSenha: "curta" });
    expect(res.statusCode).toBe(400);
    await expect(logar(env, u.email, SENHA)).resolves.toBeDefined();
  });

  it("recusa senha nova igual à atual", async () => {
    const u = await entrar(env, { papel: "titular" });
    const res = await chamar(env, u, "POST", "/auth/senha", { senha: SENHA, novaSenha: SENHA });
    expect(res.statusCode).toBe(400);
  });

  it("recusa corpo sem a senha nova", async () => {
    const u = await entrar(env, { papel: "titular" });
    expect((await chamar(env, u, "POST", "/auth/senha", { senha: SENHA })).statusCode).toBe(400);
  });

  it("depois de trocar: a senha nova entra, a antiga não", async () => {
    const u = await entrar(env, { papel: "titular" });
    const res = await chamar(env, u, "POST", "/auth/senha", { senha: SENHA, novaSenha: NOVA });
    expect(res.statusCode).toBe(200);
    await expect(logar(env, u.email, NOVA)).resolves.toBeDefined();
    await expect(logar(env, u.email, SENHA)).rejects.toThrow();
  });

  it("encerra as outras sessões e mantém a atual", async () => {
    const u = await entrar(env, { papel: "titular" });
    const outra = await logar(env, u.email);
    expect((await chamar(env, outra, "GET", "/auth/me")).statusCode).toBe(200);

    const res = await chamar(env, u, "POST", "/auth/senha", { senha: SENHA, novaSenha: NOVA });
    expect(res.statusCode).toBe(200);

    expect((await chamar(env, outra, "GET", "/auth/me")).statusCode).toBe(401);
    expect((await chamar(env, u, "GET", "/auth/me")).statusCode).toBe(200);
  });

  it("não guarda a senha, nem a nova, nem a antiga, no log", async () => {
    const u = await entrar(env, { papel: "titular" });
    await chamar(env, u, "POST", "/auth/senha", { senha: SENHA, novaSenha: NOVA });
    const r = await env.owner.query(`SELECT antes, depois FROM log WHERE acao = 'senha.alterada' AND usuario_id = $1`, [
      u.id,
    ]);
    expect(r.rows).toHaveLength(1);
    const texto = JSON.stringify(r.rows[0]);
    expect(texto).not.toContain(NOVA);
    expect(texto).not.toContain(SENHA);
  });
});
