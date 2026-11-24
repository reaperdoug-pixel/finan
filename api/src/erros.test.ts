import { Writable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp, type AppConfig } from "./app.js";
import { createDb, createPool } from "./db/client.js";
import { MENSAGEM_ERRO_INTERNO } from "./erros.js";

const TEXTO_PG = 'duplicate key value violates unique constraint "usuario_email_unico"';

function capturar(): { stream: Writable; linhas: () => Record<string, unknown>[] } {
  const partes: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _enc, cb) {
      partes.push(chunk.toString("utf8"));
      cb();
    },
  });
  const linhas = () =>
    partes
      .join("")
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as Record<string, unknown>);
  return { stream, linhas };
}

// O pool só conecta quando há consulta; estas rotas não consultam o banco.
const pool = createPool("postgres://ninguem@127.0.0.1:1/inexistente");

function montar(log?: AppConfig["log"]) {
  const app = buildApp({
    db: createDb(pool),
    segredoSessao: "segredo-de-teste-com-mais-de-trinta-e-dois-caracteres",
    origemApp: "http://localhost:5173",
    producao: false,
    log,
  });
  app.get("/teste/falha", async () => {
    const erro = new Error(TEXTO_PG) as Error & { code: string };
    erro.code = "23505";
    throw erro;
  });
  return app;
}

describe("tratador central de erros", () => {
  let fechar: (() => Promise<void>) | undefined;
  afterEach(async () => {
    await fechar?.();
  });

  it("erro inesperado vira 500 genérico, sem texto do Postgres nem stack", async () => {
    const app = montar();
    fechar = () => app.close();
    const res = await app.inject({ method: "GET", url: "/teste/falha" });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ erro: MENSAGEM_ERRO_INTERNO });
    expect(res.body).not.toContain("duplicate key");
    expect(res.body).not.toContain("23505");
    expect(res.body).not.toContain("at ");
  });

  it("erros de domínio e de validação mantêm status e mensagem", async () => {
    const app = montar();
    fechar = () => app.close();
    const semLogin = await app.inject({ method: "GET", url: "/lancamentos" });
    expect(semLogin.statusCode).toBe(401);
    expect(semLogin.json()).toEqual({ erro: "Não autenticado" });

    const corpoInvalido = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: 1 },
    });
    expect(corpoInvalido.statusCode).toBe(400);
    expect(corpoInvalido.json()).toEqual({ erro: "Dados inválidos" });

    const jsonQuebrado = await app.inject({
      method: "POST",
      url: "/auth/login",
      headers: { "content-type": "application/json" },
      payload: "{quebrado",
    });
    expect(jsonQuebrado.statusCode).toBe(400);
    expect(jsonQuebrado.body).not.toContain(MENSAGEM_ERRO_INTERNO);
  });

  it("log do erro traz reqId e oculta cookie, authorization e senha", async () => {
    const { stream, linhas } = capturar();
    const app = montar({ stream, nivel: "error" });
    fechar = () => app.close();
    await app.inject({
      method: "GET",
      url: "/teste/falha",
      headers: { cookie: "finan_sid=valor-secreto", authorization: "Bearer token-secreto" },
    });
    app.log.error({ senha: "senha-secreta", corpo: { password: "outra-secreta" } }, "teste");

    const saida = linhas();
    const erro = saida.find((l) => l.msg === "erro inesperado");
    expect(erro?.reqId).toBeTruthy();
    const texto = JSON.stringify(saida);
    expect((erro?.err as { message?: string } | undefined)?.message).toBe(TEXTO_PG); // a causa fica no servidor
    expect((erro?.headers as Record<string, string> | undefined)?.cookie).toBe("[oculto]");
    for (const segredo of ["valor-secreto", "token-secreto", "senha-secreta", "outra-secreta"]) {
      expect(texto).not.toContain(segredo);
    }
  });
});
