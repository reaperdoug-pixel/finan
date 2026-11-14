import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  chamar,
  criarAmbiente,
  entrar,
  inserirUsuario,
  logar,
  ORIGEM,
  SEGREDO,
  SENHA,
  type Ambiente,
} from "../../test/ajudantes.js";
import { MAX_FALHAS_POR_EMAIL } from "../auth/limite.js";
import { hashDoToken } from "../auth/sessao.js";

let env: Ambiente;

const SENHA_NOVA = "senha-nova-do-usuario-123";

beforeAll(async () => {
  env = await criarAmbiente(73);
});
afterAll(async () => {
  await env.fechar();
});

const un = async (sql: string, params: unknown[] = []) =>
  (await env.owner.query(sql, params)).rows as Record<string, unknown>[];

const loginDireto = (email: string, senha: string) =>
  env.app.inject({
    method: "POST",
    url: "/auth/login",
    payload: { email, senha },
    remoteAddress: env.novoIp(),
  });

/** O admin gera o link para o usuário; devolve o token extraído do link. */
async function gerarLink(admin: Awaited<ReturnType<typeof entrar>>, usuarioId: string) {
  const res = await chamar(env, admin, "POST", `/admin/usuarios/${usuarioId}/redefinicao`, {
    senha: SENHA,
  });
  expect(res.statusCode).toBe(201);
  const corpo = res.json() as { link: string; email: string; expiraEm: string };
  return { ...corpo, token: corpo.link.split("/redefinicao/")[1]! };
}

const consultar = (token: string) =>
  env.app.inject({ method: "GET", url: `/redefinicao/${token}` });
const concluir = (token: string, senha: string, headers: Record<string, string> = {}) =>
  env.app.inject({
    method: "POST",
    url: `/redefinicao/${token}`,
    payload: { senha },
    remoteAddress: env.novoIp(),
    headers,
  });

describe("gerar o link (admin)", () => {
  it("devolve o link uma vez, guarda só o hash do token, vale 24 horas e vai para o log sem o token", async () => {
    const admin = await entrar(env, { papel: "admin" });
    const alvo = await inserirUsuario(env, { papel: "titular" });
    const r = await gerarLink(admin, alvo.id);

    expect(r.link).toBe(`${ORIGEM}/redefinicao/${r.token}`);
    expect(r.email).toBe(alvo.email);

    const [linha] = await un(
      `SELECT token_hash, extract(epoch FROM expira_em - criado_em) AS seg, criado_por FROM redefinicao_senha WHERE usuario_id = $1`,
      [alvo.id],
    );
    expect(linha!.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(linha!.token_hash).not.toBe(r.token);
    expect(linha!.token_hash).toBe(hashDoToken(r.token, SEGREDO));
    expect(Math.abs(Number(linha!.seg) - 24 * 3600)).toBeLessThan(60);
    expect(linha!.criado_por).toBe(admin.id);

    const [l] = await un(`SELECT * FROM log WHERE acao = 'redefinicao.criada' AND entidade_id = $1`, [
      alvo.id,
    ]);
    expect(l!.usuario_id).toBe(admin.id);
    expect(l!.titular_id).toBe(alvo.titularId);
    expect(l!.confirmado_por).toBe(admin.id);
    expect(l!.ip).toBe(admin.ip);
    expect(JSON.stringify(l)).not.toContain(r.token);
  });

  it("usuário inexistente: 404. Usuário ou titular inativo: 409", async () => {
    const admin = await entrar(env, { papel: "admin" });
    const corpo = { senha: SENHA };
    const post = (id: string) =>
      chamar(env, admin, "POST", `/admin/usuarios/${id}/redefinicao`, corpo);
    expect((await post(randomUUID())).statusCode).toBe(404);
    expect((await post("nao-e-uuid")).statusCode).toBe(404);
    const inativo = await inserirUsuario(env, { papel: "titular", ativo: false });
    expect((await post(inativo.id)).statusCode).toBe(409);
    const titularInativo = await inserirUsuario(env, { papel: "titular", titularAtivo: false });
    expect((await post(titularInativo.id)).statusCode).toBe(409);
  });

  it("um link novo invalida o anterior", async () => {
    const admin = await entrar(env, { papel: "admin" });
    const alvo = await inserirUsuario(env, { papel: "titular" });
    const primeiro = await gerarLink(admin, alvo.id);
    expect((await consultar(primeiro.token)).statusCode).toBe(200);
    const segundo = await gerarLink(admin, alvo.id);
    expect((await consultar(primeiro.token)).statusCode).toBe(404);
    expect((await consultar(segundo.token)).statusCode).toBe(200);
    expect((await concluir(primeiro.token, SENHA_NOVA)).statusCode).toBe(404);
  });
});

describe("validar o link", () => {
  it("link válido devolve só o e-mail", async () => {
    const admin = await entrar(env, { papel: "admin" });
    const alvo = await inserirUsuario(env, { papel: "titular" });
    const r = await gerarLink(admin, alvo.id);
    const res = await consultar(r.token);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ email: alvo.email });
  });

  it("inexistente, expirado, usado e revogado dão exatamente a mesma resposta 404", async () => {
    const admin = await entrar(env, { papel: "admin" });
    const inexistente = await consultar("x".repeat(43));

    const a = await inserirUsuario(env, { papel: "titular" });
    const expirado = await gerarLink(admin, a.id);
    await env.owner.query(
      `UPDATE redefinicao_senha SET expira_em = now() - interval '1 second' WHERE usuario_id = $1`,
      [a.id],
    );

    const b = await inserirUsuario(env, { papel: "titular" });
    const usado = await gerarLink(admin, b.id);
    expect((await concluir(usado.token, SENHA_NOVA)).statusCode).toBe(200);

    const c = await inserirUsuario(env, { papel: "titular" });
    const revogado = await gerarLink(admin, c.id);
    await gerarLink(admin, c.id); // o segundo link revoga o primeiro

    const respostas = [
      inexistente,
      await consultar(expirado.token),
      await consultar(usado.token),
      await consultar(revogado.token),
    ];
    for (const r of respostas) expect(r.statusCode).toBe(404);
    for (const r of respostas) expect(r.json()).toEqual(inexistente.json());
  });

  it("token curto demais é recusado", async () => {
    expect((await consultar("abc")).statusCode).toBe(404);
  });
});

describe("o usuário define a nova senha", () => {
  it("troca a senha, derruba as sessões antigas, libera o bloqueio e vai para o log sem segredos", async () => {
    const admin = await entrar(env, { papel: "admin" });
    const alvo = await inserirUsuario(env, { papel: "titular" });
    const sessaoAntiga = await logar(env, alvo.email);
    expect((await chamar(env, sessaoAntiga, "GET", "/auth/me")).statusCode).toBe(200);

    // o usuário "esqueceu a senha" e ficou bloqueado por tentativas
    for (let i = 0; i < MAX_FALHAS_POR_EMAIL; i++) {
      expect((await loginDireto(alvo.email, "chute-errado-123")).statusCode).toBe(401);
    }
    expect((await loginDireto(alvo.email, SENHA)).statusCode).toBe(429);

    const r = await gerarLink(admin, alvo.id);
    const [antes] = await un(`SELECT senha_hash FROM usuario WHERE id = $1`, [alvo.id]);
    const res = await concluir(r.token, SENHA_NOVA);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });

    const [depois] = await un(`SELECT senha_hash FROM usuario WHERE id = $1`, [alvo.id]);
    expect(depois!.senha_hash).not.toBe(antes!.senha_hash);
    expect(String(depois!.senha_hash).startsWith("$argon2id$")).toBe(true);

    // senha nova funciona (e o bloqueio por tentativas foi liberado); a antiga não
    expect((await loginDireto(alvo.email, SENHA_NOVA)).statusCode).toBe(200);
    expect((await loginDireto(alvo.email, SENHA)).statusCode).toBe(401);
    // a sessão aberta com a senha antiga caiu
    expect((await chamar(env, sessaoAntiga, "GET", "/auth/me")).statusCode).toBe(401);

    const [uso] = await un(`SELECT usado_em FROM redefinicao_senha WHERE usuario_id = $1`, [
      alvo.id,
    ]);
    expect(uso!.usado_em).not.toBeNull();

    const [l] = await un(
      `SELECT * FROM log WHERE acao = 'redefinicao.concluida' AND entidade_id = $1`,
      [alvo.id],
    );
    expect(l!.usuario_id).toBe(alvo.id);
    expect(l!.titular_id).toBe(alvo.titularId);
    expect(l!.ip).not.toBeNull();
    const texto = JSON.stringify(l);
    expect(texto).not.toContain(SENHA_NOVA);
    expect(texto).not.toContain(r.token);
  });

  it("uso único: o mesmo link não serve duas vezes e a segunda tentativa não muda a senha", async () => {
    const admin = await entrar(env, { papel: "admin" });
    const alvo = await inserirUsuario(env, { papel: "titular" });
    const r = await gerarLink(admin, alvo.id);
    expect((await concluir(r.token, SENHA_NOVA)).statusCode).toBe(200);
    expect((await concluir(r.token, "outra-senha-muito-boa-1")).statusCode).toBe(404);
    expect((await loginDireto(alvo.email, SENHA_NOVA)).statusCode).toBe(200);
    expect((await loginDireto(alvo.email, "outra-senha-muito-boa-1")).statusCode).toBe(401);
  });

  it("senha fraca: 400 e o link continua válido", async () => {
    const admin = await entrar(env, { papel: "admin" });
    const alvo = await inserirUsuario(env, { papel: "titular" });
    const r = await gerarLink(admin, alvo.id);
    expect((await concluir(r.token, "curta")).statusCode).toBe(400);
    expect((await loginDireto(alvo.email, SENHA)).statusCode).toBe(200); // senha antiga intacta
    expect((await consultar(r.token)).statusCode).toBe(200);
    expect((await concluir(r.token, SENHA_NOVA)).statusCode).toBe(200);
  });

  it("corpo sem senha: 400", async () => {
    const admin = await entrar(env, { papel: "admin" });
    const alvo = await inserirUsuario(env, { papel: "titular" });
    const r = await gerarLink(admin, alvo.id);
    const res = await env.app.inject({
      method: "POST",
      url: `/redefinicao/${r.token}`,
      payload: {},
      remoteAddress: env.novoIp(),
    });
    expect(res.statusCode).toBe(400);
  });

  it("link expirado: 404 e a senha antiga continua valendo", async () => {
    const admin = await entrar(env, { papel: "admin" });
    const alvo = await inserirUsuario(env, { papel: "titular" });
    const r = await gerarLink(admin, alvo.id);
    await env.owner.query(
      `UPDATE redefinicao_senha SET expira_em = now() - interval '1 second' WHERE usuario_id = $1`,
      [alvo.id],
    );
    expect((await concluir(r.token, SENHA_NOVA)).statusCode).toBe(404);
    expect((await loginDireto(alvo.email, SENHA)).statusCode).toBe(200);
  });

  it("usuário ou titular inativado depois de gerado o link: o link deixa de valer", async () => {
    const admin = await entrar(env, { papel: "admin" });
    const a = await inserirUsuario(env, { papel: "vinculado" });
    const ra = await gerarLink(admin, a.id);
    await env.owner.query(`UPDATE usuario SET ativo = false, inativado_em = now() WHERE id = $1`, [
      a.id,
    ]);
    expect((await consultar(ra.token)).statusCode).toBe(404);
    expect((await concluir(ra.token, SENHA_NOVA)).statusCode).toBe(404);

    const b = await inserirUsuario(env, { papel: "titular" });
    const rb = await gerarLink(admin, b.id);
    await env.owner.query(`UPDATE titular SET ativo = false, inativado_em = now() WHERE id = $1`, [
      b.titularId,
    ]);
    expect((await concluir(rb.token, SENHA_NOVA)).statusCode).toBe(404);
  });

  it("é rota pública: funciona mesmo com outra sessão aberta, sem token CSRF", async () => {
    const admin = await entrar(env, { papel: "admin" });
    const alvo = await inserirUsuario(env, { papel: "titular" });
    const r = await gerarLink(admin, alvo.id);
    const res = await concluir(r.token, SENHA_NOVA, { cookie: `finan_sid=${admin.cookie}` });
    expect(res.statusCode).toBe(200);
  });

  it("exclusão mútua: se outro uso consome o link durante o nosso, o nosso perde", async () => {
    // Uma conexão separada segura a linha do link (FOR UPDATE), como se outro uso estivesse em
    // andamento. Quando ela marca o link como usado e termina, o nosso precisa ser recusado.
    // Sem FOR UPDATE no código, a senha seria trocada e este teste falharia.
    const admin = await entrar(env, { papel: "admin" });
    const alvo = await inserirUsuario(env, { papel: "titular" });
    const r = await gerarLink(admin, alvo.id);
    const outra = await env.owner.connect();
    try {
      await outra.query("BEGIN");
      await outra.query(`SELECT id FROM redefinicao_senha WHERE token_hash = $1 FOR UPDATE`, [
        hashDoToken(r.token, SEGREDO),
      ]);

      let terminou = false;
      const tentativa = concluir(r.token, SENHA_NOVA).then((x) => {
        terminou = true;
        return x;
      });
      await new Promise((resolve) => setTimeout(resolve, 700));
      expect(terminou).toBe(false);

      await outra.query(`UPDATE redefinicao_senha SET usado_em = now() WHERE token_hash = $1`, [
        hashDoToken(r.token, SEGREDO),
      ]);
      await outra.query("COMMIT");

      expect((await tentativa).statusCode).toBe(404);
      expect((await loginDireto(alvo.email, SENHA)).statusCode).toBe(200);
      expect((await loginDireto(alvo.email, SENHA_NOVA)).statusCode).toBe(401);
    } finally {
      outra.release();
    }
  });
});
