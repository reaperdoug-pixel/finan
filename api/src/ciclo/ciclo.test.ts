import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  chamar,
  criarAmbiente,
  entrar,
  inserirConvite,
  inserirUsuario,
  logar,
  ORIGEM,
  SENHA,
  type Ambiente,
  type Logado,
} from "../../test/ajudantes.js";

let env: Ambiente;

beforeAll(async () => {
  env = await criarAmbiente(72);
});
afterAll(async () => {
  await env.fechar();
});

const un = async (sql: string, params: unknown[] = []) =>
  (await env.owner.query(sql, params)).rows as Record<string, unknown>[];

const loginDireto = (email: string, senha = SENHA) =>
  env.app.inject({
    method: "POST",
    url: "/auth/login",
    payload: { email, senha },
    remoteAddress: env.novoIp(),
  });

/** Titular logado + um vinculado dele, com sessão aberta. */
async function titularComVinculado() {
  const t = await entrar(env, { papel: "titular" });
  const v = await inserirUsuario(env, {
    papel: "vinculado",
    titularId: t.titularId,
    permissoes: { contas: { ver: true } },
  });
  const sessaoV = await logar(env, v.email);
  return { t, v, sessaoV };
}

describe("inativar usuário", () => {
  it("o titular inativa o vinculado: perde o acesso, sessões caem, nada é apagado, vai para o log", async () => {
    const { t, v, sessaoV } = await titularComVinculado();
    expect((await chamar(env, sessaoV, "GET", "/auth/me")).statusCode).toBe(200);

    const res = await chamar(env, t, "POST", `/usuarios/${v.id}/inativar`, { senha: SENHA });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ativo: false });

    const [u] = await un(`SELECT ativo, inativado_em, inativado_por FROM usuario WHERE id = $1`, [
      v.id,
    ]);
    expect(u!.ativo).toBe(false);
    expect(u!.inativado_em).not.toBeNull();
    expect(u!.inativado_por).toBe(t.id);
    // nada se apaga: a linha e as permissões continuam lá
    expect((await un(`SELECT 1 FROM permissao WHERE usuario_id = $1`, [v.id])).length).toBe(6);

    // As sessões já foram encerradas pela própria operação. Olhar o banco ANTES de qualquer
    // outra chamada: uma requisição com a sessão velha também a revogaria, mascarando a falha.
    const sess = await un(`SELECT revogada_em FROM sessao WHERE usuario_id = $1`, [v.id]);
    expect(sess.length).toBeGreaterThan(0);
    expect(sess.every((s) => s.revogada_em !== null)).toBe(true);

    expect((await chamar(env, sessaoV, "GET", "/auth/me")).statusCode).toBe(401);
    expect((await loginDireto(v.email)).statusCode).toBe(401);

    const [l] = await un(`SELECT * FROM log WHERE acao = 'usuario.inativado' AND entidade_id = $1`, [
      v.id,
    ]);
    expect(l!.usuario_id).toBe(t.id);
    expect(l!.titular_id).toBe(t.titularId);
    expect(l!.confirmado_por).toBe(t.id);
    expect(l!.ip).toBe(t.ip);
    expect(l!.antes).toEqual({ ativo: true });
    expect(l!.depois).toEqual({ ativo: false });
  });

  it("o titular reativa: volta a entrar, mantém as permissões e o inativado_* é limpo", async () => {
    const { t, v } = await titularComVinculado();
    await chamar(env, t, "POST", `/usuarios/${v.id}/inativar`, { senha: SENHA });

    const res = await chamar(env, t, "POST", `/usuarios/${v.id}/reativar`, { senha: SENHA });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ativo: true });

    const [u] = await un(`SELECT ativo, inativado_em, inativado_por FROM usuario WHERE id = $1`, [
      v.id,
    ]);
    expect(u).toEqual({ ativo: true, inativado_em: null, inativado_por: null });

    const novaSessao = await logar(env, v.email);
    const me = await chamar(env, novaSessao, "GET", "/auth/me");
    expect(me.json().permissoes.contas.ver).toBe(true);

    const [l] = await un(`SELECT * FROM log WHERE acao = 'usuario.reativado' AND entidade_id = $1`, [
      v.id,
    ]);
    expect(l!.confirmado_por).toBe(t.id);
    expect(l!.antes).toEqual({ ativo: false });
    expect(l!.depois).toEqual({ ativo: true });
  });

  it("titular não mexe em usuário de OUTRO titular: 404 e nada muda", async () => {
    const a = await entrar(env, { papel: "titular" });
    const { v: deOutro } = await titularComVinculado();
    const res = await chamar(env, a, "POST", `/usuarios/${deOutro.id}/inativar`, { senha: SENHA });
    expect(res.statusCode).toBe(404);
    expect((await un(`SELECT ativo FROM usuario WHERE id = $1`, [deOutro.id]))[0]!.ativo).toBe(true);
  });

  it("admin inativa e reativa usuário de qualquer titular", async () => {
    const admin = await entrar(env, { papel: "admin" });
    const { v } = await titularComVinculado();
    const inativar = await chamar(env, admin, "POST", `/usuarios/${v.id}/inativar`, { senha: SENHA });
    expect(inativar.statusCode).toBe(200);
    const reativar = await chamar(env, admin, "POST", `/usuarios/${v.id}/reativar`, { senha: SENHA });
    expect(reativar.statusCode).toBe(200);
    const [l] = await un(
      `SELECT usuario_id, titular_id FROM log WHERE acao = 'usuario.inativado' AND entidade_id = $1`,
      [v.id],
    );
    expect(l!.usuario_id).toBe(admin.id);
    expect(l!.titular_id).toBe(v.titularId); // o log fica no titular afetado
  });

  it("ninguém inativa a si mesmo (400) e a conta continua ativa", async () => {
    const admin = await entrar(env, { papel: "admin" });
    const t = await entrar(env, { papel: "titular" });
    for (const quem of [admin, t]) {
      const res = await chamar(env, quem, "POST", `/usuarios/${quem.id}/inativar`, { senha: SENHA });
      expect(res.statusCode).toBe(400);
      expect((await un(`SELECT ativo FROM usuario WHERE id = $1`, [quem.id]))[0]!.ativo).toBe(true);
    }
  });

  it("titular não inativa outro usuário de papel titular do mesmo titular (403)", async () => {
    const t = await entrar(env, { papel: "titular" });
    const colega = await inserirUsuario(env, { papel: "titular", titularId: t.titularId });
    const res = await chamar(env, t, "POST", `/usuarios/${colega.id}/inativar`, { senha: SENHA });
    expect(res.statusCode).toBe(403);
    expect((await un(`SELECT ativo FROM usuario WHERE id = $1`, [colega.id]))[0]!.ativo).toBe(true);
  });

  it("já inativo ou já ativo: 409", async () => {
    const { t, v } = await titularComVinculado();
    const corpo = { senha: SENHA };
    expect((await chamar(env, t, "POST", `/usuarios/${v.id}/reativar`, corpo)).statusCode).toBe(409);
    expect((await chamar(env, t, "POST", `/usuarios/${v.id}/inativar`, corpo)).statusCode).toBe(200);
    expect((await chamar(env, t, "POST", `/usuarios/${v.id}/inativar`, corpo)).statusCode).toBe(409);
  });

  it("não reativa usuário dentro de titular inativo (409) até reativar o titular", async () => {
    const admin = await entrar(env, { papel: "admin" });
    const v = await inserirUsuario(env, { papel: "vinculado", ativo: false, titularAtivo: false });
    const corpo = { senha: SENHA };
    expect((await chamar(env, admin, "POST", `/usuarios/${v.id}/reativar`, corpo)).statusCode).toBe(409);
    const titular = await chamar(env, admin, "POST", `/admin/titulares/${v.titularId}/reativar`, corpo);
    expect(titular.statusCode).toBe(200);
    expect((await chamar(env, admin, "POST", `/usuarios/${v.id}/reativar`, corpo)).statusCode).toBe(200);
  });

  it("id inexistente ou inválido: 404", async () => {
    const t = await entrar(env, { papel: "titular" });
    const corpo = { senha: SENHA };
    const inexistente = await chamar(env, t, "POST", `/usuarios/${randomUUID()}/inativar`, corpo);
    expect(inexistente.statusCode).toBe(404);
    const invalido = await chamar(env, t, "POST", `/usuarios/nao-e-uuid/inativar`, corpo);
    expect(invalido.statusCode).toBe(404);
  });
});

describe("inativar titular (só admin)", () => {
  async function titularComDoisUsuarios() {
    const u1 = await entrar(env, { papel: "titular" });
    const v = await inserirUsuario(env, { papel: "vinculado", titularId: u1.titularId });
    const sessaoV = await logar(env, v.email);
    return { u1, v, sessaoV };
  }

  it("corta o acesso de todos os usuários do titular, sem apagar nem inativar cada um", async () => {
    const admin = await entrar(env, { papel: "admin" });
    const { u1, v, sessaoV } = await titularComDoisUsuarios();

    const res = await chamar(env, admin, "POST", `/admin/titulares/${u1.titularId}/inativar`, {
      senha: SENHA,
    });
    expect(res.statusCode).toBe(200);

    const [t] = await un(`SELECT ativo, inativado_em, inativado_por FROM titular WHERE id = $1`, [
      u1.titularId,
    ]);
    expect(t!.ativo).toBe(false);
    expect(t!.inativado_em).not.toBeNull();
    expect(t!.inativado_por).toBe(admin.id);
    // os usuários continuam existindo e ativos; o bloqueio vem do titular
    const us = await un(`SELECT ativo FROM usuario WHERE titular_id = $1`, [u1.titularId]);
    expect(us.length).toBe(2);
    expect(us.every((u) => u.ativo === true)).toBe(true);

    // As sessões já foram encerradas pela própria operação. Olhar o banco ANTES de qualquer
    // outra chamada: uma requisição com a sessão velha também a revogaria, mascarando a falha.
    const sessoes = await un(
      `SELECT s.revogada_em FROM sessao s JOIN usuario u ON u.id = s.usuario_id WHERE u.titular_id = $1`,
      [u1.titularId],
    );
    expect(sessoes.length).toBeGreaterThanOrEqual(2);
    expect(sessoes.every((s) => s.revogada_em !== null)).toBe(true);

    expect((await chamar(env, u1, "GET", "/auth/me")).statusCode).toBe(401);
    expect((await chamar(env, sessaoV, "GET", "/auth/me")).statusCode).toBe(401);
    expect((await loginDireto(u1.email)).statusCode).toBe(401);
    expect((await loginDireto(v.email)).statusCode).toBe(401);

    const [l] = await un(`SELECT * FROM log WHERE acao = 'titular.inativado' AND entidade_id = $1`, [
      u1.titularId,
    ]);
    expect(l!.usuario_id).toBe(admin.id);
    expect(l!.titular_id).toBe(u1.titularId);
    expect(l!.confirmado_por).toBe(admin.id);
    expect(l!.antes).toEqual({ ativo: true });
    expect(l!.depois).toEqual({ ativo: false });
  });

  it("reativar o titular devolve o acesso", async () => {
    const admin = await entrar(env, { papel: "admin" });
    const { u1, v } = await titularComDoisUsuarios();
    await chamar(env, admin, "POST", `/admin/titulares/${u1.titularId}/inativar`, { senha: SENHA });

    const res = await chamar(env, admin, "POST", `/admin/titulares/${u1.titularId}/reativar`, {
      senha: SENHA,
    });
    expect(res.statusCode).toBe(200);
    expect((await loginDireto(u1.email)).statusCode).toBe(200);
    expect((await loginDireto(v.email)).statusCode).toBe(200);
    const [t] = await un(`SELECT ativo, inativado_em, inativado_por FROM titular WHERE id = $1`, [
      u1.titularId,
    ]);
    expect(t).toEqual({ ativo: true, inativado_em: null, inativado_por: null });
    const reativou = await un(
      `SELECT 1 FROM log WHERE acao = 'titular.reativado' AND entidade_id = $1`,
      [u1.titularId],
    );
    expect(reativou.length).toBe(1);
  });

  it("o titular do administrador não pode ser inativado (400)", async () => {
    const admin = await entrar(env, { papel: "admin" });
    const res = await chamar(env, admin, "POST", `/admin/titulares/${admin.titularId}/inativar`, {
      senha: SENHA,
    });
    expect(res.statusCode).toBe(400);
    expect((await un(`SELECT ativo FROM titular WHERE id = $1`, [admin.titularId]))[0]!.ativo).toBe(
      true,
    );
    expect((await chamar(env, admin, "GET", "/auth/me")).statusCode).toBe(200);
  });

  it("já inativo ou já ativo: 409. Inexistente ou inválido: 404", async () => {
    const admin = await entrar(env, { papel: "admin" });
    const { u1 } = await titularComDoisUsuarios();
    const corpo = { senha: SENHA };
    const rota = (id: string, acao: string) =>
      chamar(env, admin, "POST", `/admin/titulares/${id}/${acao}`, corpo);
    expect((await rota(u1.titularId, "reativar")).statusCode).toBe(409);
    await rota(u1.titularId, "inativar");
    expect((await rota(u1.titularId, "inativar")).statusCode).toBe(409);
    expect((await rota(randomUUID(), "inativar")).statusCode).toBe(404);
    expect((await rota("xx", "inativar")).statusCode).toBe(404);
  });

  it("a listagem é só do admin e mostra estado e número de usuários", async () => {
    const admin = await entrar(env, { papel: "admin" });
    const { u1 } = await titularComDoisUsuarios();
    const nome = (await un(`SELECT nome FROM titular WHERE id = $1`, [u1.titularId]))[0]!.nome as string;

    // a busca por nome acha o titular mesmo com centenas de outros no banco
    const res = await chamar(env, admin, "GET", `/admin/titulares?busca=${encodeURIComponent(nome)}`);
    expect(res.statusCode).toBe(200);
    const lista = res.json().titulares as { id: string; ativo: boolean; totalUsuarios: number }[];
    expect(lista).toHaveLength(1);
    expect(lista[0]).toMatchObject({ id: u1.titularId, ativo: true, totalUsuarios: 2 });

    expect((await chamar(env, u1, "GET", "/admin/titulares")).statusCode).toBe(403);
    expect((await env.app.inject({ method: "GET", url: "/admin/titulares" })).statusCode).toBe(401);
  });

  it("a listagem pagina: percorre todos sem repetir e sem perder", async () => {
    const admin = await entrar(env, { papel: "admin" });
    await titularComDoisUsuarios();
    const total = (await un(`SELECT count(*)::int AS n FROM titular`))[0]!.n as number;

    const vistos: string[] = [];
    let pagina: number | null = 1;
    while (pagina) {
      const res = await chamar(env, admin, "GET", `/admin/titulares?limite=200&pagina=${pagina}`);
      expect(res.statusCode).toBe(200);
      vistos.push(...(res.json().titulares as { id: string }[]).map((x) => x.id));
      pagina = res.json().proximaPagina as number | null;
      expect(vistos.length).toBeLessThanOrEqual(total + 1);
    }
    expect(vistos.length).toBe(total);
    expect(new Set(vistos).size).toBe(total);
  });

  it("a busca trata % e _ como texto comum, e parâmetros inválidos dão 400", async () => {
    const admin = await entrar(env, { papel: "admin" });
    const curinga = await chamar(env, admin, "GET", "/admin/titulares?busca=%25");
    expect(curinga.json().titulares).toEqual([]); // "%" literal não casa com todos os nomes
    for (const q of ["limite=0", "limite=201", "pagina=0", "limite=abc"]) {
      expect((await chamar(env, admin, "GET", `/admin/titulares?${q}`)).statusCode).toBe(400);
    }
  });
});

describe("revogar convite", () => {
  /** Convite de vinculado criado pela API de verdade (devolve id e token). */
  async function convidar(t: Logado, email = env.novoEmail()) {
    const res = await chamar(env, t, "POST", "/usuarios/convites", {
      email,
      permissoes: {},
      senha: SENHA,
    });
    expect(res.statusCode).toBe(201);
    const { id, link } = res.json() as { id: string; link: string };
    return { id, email, token: link.split("/convite/")[1]! };
  }

  const aceitar = (token: string) =>
    env.app.inject({
      method: "POST",
      url: `/convites/${token}/aceitar`,
      payload: { senha: "senha-do-convidado-123" },
      remoteAddress: env.novoIp(),
    });

  it("o titular revoga: o link deixa de funcionar, some dos pendentes e o e-mail pode ser convidado de novo", async () => {
    const t = await entrar(env, { papel: "titular" });
    const c = await convidar(t);
    const antes = await env.app.inject({ method: "GET", url: `/convites/${c.token}` });
    expect(antes.statusCode).toBe(200);

    const res = await chamar(env, t, "POST", `/usuarios/convites/${c.id}/revogar`, { senha: SENHA });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "revogado" });

    const [linha] = await un(`SELECT revogado_em, revogado_por FROM convite WHERE id = $1`, [c.id]);
    expect(linha!.revogado_em).not.toBeNull();
    expect(linha!.revogado_por).toBe(t.id);

    const depois = await env.app.inject({ method: "GET", url: `/convites/${c.token}` });
    expect(depois.statusCode).toBe(404);
    expect((await aceitar(c.token)).statusCode).toBe(404);
    expect((await un(`SELECT 1 FROM usuario WHERE lower(email) = $1`, [c.email])).length).toBe(0);

    const lista = await chamar(env, t, "GET", "/usuarios");
    const pendentes = lista.json().convitesPendentes as { id: string }[];
    expect(pendentes.some((x) => x.id === c.id)).toBe(false);

    // e-mail liberado para um novo convite
    const novo = await chamar(env, t, "POST", "/usuarios/convites", {
      email: c.email,
      permissoes: {},
      senha: SENHA,
    });
    expect(novo.statusCode).toBe(201);

    const [l] = await un(`SELECT * FROM log WHERE acao = 'convite.revogado' AND entidade_id = $1`, [
      c.id,
    ]);
    expect(l!.usuario_id).toBe(t.id);
    expect(l!.titular_id).toBe(t.titularId);
    expect(l!.confirmado_por).toBe(t.id);
    expect(JSON.stringify(l)).not.toContain(c.token);
  });

  it("o admin revoga convite de titular e a listagem mostra 'revogado'", async () => {
    const admin = await entrar(env, { papel: "admin" });
    const c = await inserirConvite(env, { criadoPor: admin.id });
    const res = await chamar(env, admin, "POST", `/admin/convites/${c.id}/revogar`, {
      senha: SENHA,
    });
    expect(res.statusCode).toBe(200);
    const lista = await chamar(env, admin, "GET", "/admin/convites");
    const convites = lista.json().convites as { id: string; status: string }[];
    expect(convites.find((x) => x.id === c.id)?.status).toBe("revogado");
    expect((await aceitar(c.token)).statusCode).toBe(404);
  });

  it("o titular não revoga convite de OUTRO titular nem convite de titular (404, nada muda)", async () => {
    const a = await entrar(env, { papel: "titular" });
    const b = await entrar(env, { papel: "titular" });
    const doB = await convidar(b);
    const admin = await entrar(env, { papel: "admin" });
    const conviteDeTitular = await inserirConvite(env, { criadoPor: admin.id });
    for (const id of [doB.id, conviteDeTitular.id]) {
      const res = await chamar(env, a, "POST", `/usuarios/convites/${id}/revogar`, {
        senha: SENHA,
      });
      expect(res.statusCode).toBe(404);
      const [c] = await un(`SELECT revogado_em FROM convite WHERE id = $1`, [id]);
      expect(c!.revogado_em).toBeNull();
    }
  });

  it("o admin revoga convite de vinculado de qualquer titular", async () => {
    const admin = await entrar(env, { papel: "admin" });
    const t = await entrar(env, { papel: "titular" });
    const c = await convidar(t);
    const res = await chamar(env, admin, "POST", `/usuarios/convites/${c.id}/revogar`, {
      senha: SENHA,
    });
    expect(res.statusCode).toBe(200);
    const [l] = await un(
      `SELECT usuario_id, titular_id FROM log WHERE acao = 'convite.revogado' AND entidade_id = $1`,
      [c.id],
    );
    expect(l!.usuario_id).toBe(admin.id);
    expect(l!.titular_id).toBe(t.titularId);
  });

  it("já usado, já revogado ou expirado: 409. Inexistente ou inválido: 404", async () => {
    const t = await entrar(env, { papel: "titular" });
    const rev = (id: string) =>
      chamar(env, t, "POST", `/usuarios/convites/${id}/revogar`, { senha: SENHA });

    const usado = await convidar(t);
    await env.owner.query(`UPDATE convite SET usado_em = now() WHERE id = $1`, [usado.id]);
    expect((await rev(usado.id)).statusCode).toBe(409);

    const jaRevogado = await convidar(t);
    expect((await rev(jaRevogado.id)).statusCode).toBe(200);
    expect((await rev(jaRevogado.id)).statusCode).toBe(409);

    const expirado = await convidar(t);
    await env.owner.query(
      `UPDATE convite SET expira_em = now() - interval '1 minute' WHERE id = $1`,
      [expirado.id],
    );
    expect((await rev(expirado.id)).statusCode).toBe(409);

    expect((await rev(randomUUID())).statusCode).toBe(404);
    expect((await rev("nao-e-uuid")).statusCode).toBe(404);
  });

  it("o link do convite não aparece na resposta da revogação", async () => {
    const t = await entrar(env, { papel: "titular" });
    const c = await convidar(t);
    const res = await chamar(env, t, "POST", `/usuarios/convites/${c.id}/revogar`, { senha: SENHA });
    expect(res.body).not.toContain(c.token);
    expect(res.body).not.toContain(ORIGEM);
  });
});
