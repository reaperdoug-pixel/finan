import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  chamar,
  contar,
  criarAmbiente,
  entrar,
  inserirConvite,
  inserirUsuario,
  type Ambiente,
  type Logado,
} from "../../test/ajudantes.js";
import { MAX_FALHAS_POR_EMAIL } from "./limite.js";
import { MODULOS } from "./permissoes.js";

/**
 * Critério da tarefa 8: "operação sem senha correta é recusada e registrada".
 * Cada operação sensível passa pela MESMA bateria. Se uma rota nova pedir senha, entra na lista.
 */

let env: Ambiente;

beforeAll(async () => {
  env = await criarAmbiente(71);
});
afterAll(async () => {
  await env.fechar();
});

interface Preparado {
  /** Quem opera (ele digita a própria senha). */
  operador: Logado;
  papelDoOperador: "admin" | "titular";
  metodo: "POST" | "PUT";
  url: string;
  corpo: (senha?: string) => object;
  /** true se nada mudou no banco por causa da operação. */
  intacto: () => Promise<boolean>;
  /** Ação gravada no log quando a operação é feita. */
  acao: string;
  /** Status esperado quando dá certo. */
  statusOk: 200 | 201;
  /**
   * Operação que um vinculado COM a permissão do módulo pode fazer (ex.: inativar categoria).
   * Nesse caso o "intruso" do teste de papel é um vinculado SEM nenhuma permissão.
   */
  intrusoSemPermissao?: boolean;
  /**
   * Operação sobre a própria conta (ex.: trocar a própria senha): qualquer papel logado pode,
   * e o teste de papel verifica isso em vez de esperar 403.
   */
  qualquerPapel?: boolean;
}

const comSenha = (senha: string | undefined, resto: object = {}) =>
  senha === undefined ? resto : { ...resto, senha };

/** Cria um lançamento direto no banco, ativo ou inativo, e devolve o id. */
async function novoLancamento(titularId: string, ativo: boolean): Promise<string> {
  const cat = await novaCategoria(titularId, true);
  const cta = await novaConta(titularId, true);
  const r = await env.owner.query(
    `INSERT INTO lancamento
       (titular_id, categoria_id, conta_id, valor, tipo, status, data, descricao, natureza, origem, ativo, inativado_em)
     VALUES ($1, $2, $3, 100, 'despesa', 'realizado', '2026-11-13', 'x', 'variavel', 'manual', $4,
             CASE WHEN $4 THEN NULL ELSE now() END)
     RETURNING id`,
    [titularId, cat, cta, ativo],
  );
  return r.rows[0].id as string;
}

/** Cria uma conta direto no banco, ativa ou inativa, e devolve o id. */
async function novaConta(titularId: string, ativa: boolean): Promise<string> {
  const r = await env.owner.query(
    `INSERT INTO conta (titular_id, nome, tipo, ativo, inativado_em)
     VALUES ($1, $2, 'carteira', $3, CASE WHEN $3 THEN NULL ELSE now() END) RETURNING id`,
    [titularId, `Conta ${Math.random().toString(36).slice(2)}`, ativa],
  );
  return r.rows[0].id as string;
}

/** Cria uma categoria direto no banco, ativa ou inativa, e devolve o id. */
async function novaCategoria(titularId: string, ativa: boolean): Promise<string> {
  const r = await env.owner.query(
    `INSERT INTO categoria (titular_id, nome, tipo, natureza, nivel, ativo, inativado_em)
     VALUES ($1, $2, 'despesa', 'variavel', 1, $3, CASE WHEN $3 THEN NULL ELSE now() END) RETURNING id`,
    [titularId, `Cat ${Math.random().toString(36).slice(2)}`, ativa],
  );
  return r.rows[0].id as string;
}

const casos: [string, () => Promise<Preparado>][] = [
  [
    "trocar a própria senha",
    async () => {
      const operador = await entrar(env, { papel: "titular" });
      const hashAntes = (
        await env.owner.query(`SELECT senha_hash FROM usuario WHERE id = $1`, [operador.id])
      ).rows[0].senha_hash as string;
      return {
        operador,
        papelDoOperador: "titular",
        metodo: "POST",
        url: "/auth/senha",
        corpo: (s) => comSenha(s, { novaSenha: "outra-senha-longa-456" }),
        intacto: async () =>
          (
            await env.owner.query(`SELECT senha_hash FROM usuario WHERE id = $1`, [operador.id])
          ).rows[0].senha_hash === hashAntes,
        acao: "senha.alterada",
        statusOk: 200,
        qualquerPapel: true,
      };
    },
  ],
  [
    "convidar usuário vinculado",
    async () => {
      const operador = await entrar(env, { papel: "titular" });
      const email = env.novoEmail();
      return {
        operador,
        papelDoOperador: "titular",
        metodo: "POST",
        url: "/usuarios/convites",
        corpo: (s) => comSenha(s, { email, permissoes: {} }),
        intacto: async () =>
          (await contar(env, `SELECT 1 FROM convite WHERE lower(email) = $1`, [email])) === 0,
        acao: "convite.criado",
        statusOk: 201,
      };
    },
  ],
  [
    "alterar permissões de um vinculado",
    async () => {
      const operador = await entrar(env, { papel: "titular" });
      const v = await inserirUsuario(env, { papel: "vinculado", titularId: operador.titularId });
      return {
        operador,
        papelDoOperador: "titular",
        metodo: "PUT",
        url: `/usuarios/${v.id}/permissoes`,
        corpo: (s) => comSenha(s, { permissoes: { contas: { ver: true } } }),
        intacto: async () =>
          (await contar(
            env,
            `SELECT 1 FROM permissao WHERE usuario_id = $1 AND modulo = 'contas' AND ver`,
            [v.id],
          )) === 0,
        acao: "permissao.alterada",
        statusOk: 200,
      };
    },
  ],
  [
    "inativar usuário",
    async () => {
      const operador = await entrar(env, { papel: "titular" });
      const v = await inserirUsuario(env, { papel: "vinculado", titularId: operador.titularId });
      return {
        operador,
        papelDoOperador: "titular",
        metodo: "POST",
        url: `/usuarios/${v.id}/inativar`,
        corpo: (s) => comSenha(s),
        intacto: async () =>
          (await contar(env, `SELECT 1 FROM usuario WHERE id = $1 AND ativo`, [v.id])) === 1,
        acao: "usuario.inativado",
        statusOk: 200,
      };
    },
  ],
  [
    "reativar usuário",
    async () => {
      const operador = await entrar(env, { papel: "titular" });
      const v = await inserirUsuario(env, {
        papel: "vinculado",
        titularId: operador.titularId,
        ativo: false,
      });
      return {
        operador,
        papelDoOperador: "titular",
        metodo: "POST",
        url: `/usuarios/${v.id}/reativar`,
        corpo: (s) => comSenha(s),
        intacto: async () =>
          (await contar(env, `SELECT 1 FROM usuario WHERE id = $1 AND NOT ativo`, [v.id])) === 1,
        acao: "usuario.reativado",
        statusOk: 200,
      };
    },
  ],
  [
    "revogar convite de vinculado",
    async () => {
      const operador = await entrar(env, { papel: "titular" });
      const c = await inserirConvite(env, {
        criadoPor: operador.id,
        papel: "vinculado",
        titularId: operador.titularId,
      });
      return {
        operador,
        papelDoOperador: "titular",
        metodo: "POST",
        url: `/usuarios/convites/${c.id}/revogar`,
        corpo: (s) => comSenha(s),
        intacto: async () =>
          (await contar(env, `SELECT 1 FROM convite WHERE id = $1 AND revogado_em IS NULL`, [
            c.id,
          ])) === 1,
        acao: "convite.revogado",
        statusOk: 200,
      };
    },
  ],
  [
    "inativar titular",
    async () => {
      const operador = await entrar(env, { papel: "admin" });
      const alvo = await inserirUsuario(env, { papel: "titular" });
      return {
        operador,
        papelDoOperador: "admin",
        metodo: "POST",
        url: `/admin/titulares/${alvo.titularId}/inativar`,
        corpo: (s) => comSenha(s),
        intacto: async () =>
          (await contar(env, `SELECT 1 FROM titular WHERE id = $1 AND ativo`, [alvo.titularId])) ===
          1,
        acao: "titular.inativado",
        statusOk: 200,
      };
    },
  ],
  [
    "reativar titular",
    async () => {
      const operador = await entrar(env, { papel: "admin" });
      const alvo = await inserirUsuario(env, { papel: "titular", titularAtivo: false });
      return {
        operador,
        papelDoOperador: "admin",
        metodo: "POST",
        url: `/admin/titulares/${alvo.titularId}/reativar`,
        corpo: (s) => comSenha(s),
        intacto: async () =>
          (await contar(env, `SELECT 1 FROM titular WHERE id = $1 AND NOT ativo`, [
            alvo.titularId,
          ])) === 1,
        acao: "titular.reativado",
        statusOk: 200,
      };
    },
  ],
  [
    "revogar convite (admin)",
    async () => {
      const operador = await entrar(env, { papel: "admin" });
      const c = await inserirConvite(env, { criadoPor: operador.id });
      return {
        operador,
        papelDoOperador: "admin",
        metodo: "POST",
        url: `/admin/convites/${c.id}/revogar`,
        corpo: (s) => comSenha(s),
        intacto: async () =>
          (await contar(env, `SELECT 1 FROM convite WHERE id = $1 AND revogado_em IS NULL`, [
            c.id,
          ])) === 1,
        acao: "convite.revogado",
        statusOk: 200,
      };
    },
  ],
  [
    "inativar categoria",
    async () => {
      const operador = await entrar(env, { papel: "titular" });
      const id = await novaCategoria(operador.titularId, true);
      return {
        operador,
        papelDoOperador: "titular",
        metodo: "POST",
        url: `/categorias/${id}/inativar`,
        corpo: (s) => comSenha(s),
        intacto: async () =>
          (await contar(env, `SELECT 1 FROM categoria WHERE id = $1 AND ativo`, [id])) === 1,
        acao: "categoria.inativada",
        statusOk: 200,
        intrusoSemPermissao: true,
      };
    },
  ],
  [
    "reativar categoria",
    async () => {
      const operador = await entrar(env, { papel: "titular" });
      const id = await novaCategoria(operador.titularId, false);
      return {
        operador,
        papelDoOperador: "titular",
        metodo: "POST",
        url: `/categorias/${id}/reativar`,
        corpo: (s) => comSenha(s),
        intacto: async () =>
          (await contar(env, `SELECT 1 FROM categoria WHERE id = $1 AND NOT ativo`, [id])) === 1,
        acao: "categoria.reativada",
        statusOk: 200,
        intrusoSemPermissao: true,
      };
    },
  ],
  [
    "inativar conta",
    async () => {
      const operador = await entrar(env, { papel: "titular" });
      const id = await novaConta(operador.titularId, true);
      return {
        operador,
        papelDoOperador: "titular",
        metodo: "POST",
        url: `/contas/${id}/inativar`,
        corpo: (s) => comSenha(s),
        intacto: async () =>
          (await contar(env, `SELECT 1 FROM conta WHERE id = $1 AND ativo`, [id])) === 1,
        acao: "conta.inativada",
        statusOk: 200,
        intrusoSemPermissao: true,
      };
    },
  ],
  [
    "reativar conta",
    async () => {
      const operador = await entrar(env, { papel: "titular" });
      const id = await novaConta(operador.titularId, false);
      return {
        operador,
        papelDoOperador: "titular",
        metodo: "POST",
        url: `/contas/${id}/reativar`,
        corpo: (s) => comSenha(s),
        intacto: async () =>
          (await contar(env, `SELECT 1 FROM conta WHERE id = $1 AND NOT ativo`, [id])) === 1,
        acao: "conta.reativada",
        statusOk: 200,
        intrusoSemPermissao: true,
      };
    },
  ],
  [
    "inativar lançamento",
    async () => {
      const operador = await entrar(env, { papel: "titular" });
      const id = await novoLancamento(operador.titularId, true);
      return {
        operador,
        papelDoOperador: "titular",
        metodo: "POST",
        url: `/lancamentos/${id}/inativar`,
        corpo: (s) => comSenha(s),
        intacto: async () =>
          (await contar(env, `SELECT 1 FROM lancamento WHERE id = $1 AND ativo`, [id])) === 1,
        acao: "lancamento.inativado",
        statusOk: 200,
        intrusoSemPermissao: true,
      };
    },
  ],
  [
    "reativar lançamento",
    async () => {
      const operador = await entrar(env, { papel: "titular" });
      const id = await novoLancamento(operador.titularId, false);
      return {
        operador,
        papelDoOperador: "titular",
        metodo: "POST",
        url: `/lancamentos/${id}/reativar`,
        corpo: (s) => comSenha(s),
        intacto: async () =>
          (await contar(env, `SELECT 1 FROM lancamento WHERE id = $1 AND NOT ativo`, [id])) === 1,
        acao: "lancamento.reativado",
        statusOk: 200,
        intrusoSemPermissao: true,
      };
    },
  ],
  [
    "admin reativar lançamento de outro titular",
    async () => {
      const alvo = await entrar(env, { papel: "titular" });
      const id = await novoLancamento(alvo.titularId, false);
      const operador = await entrar(env, { papel: "admin" });
      return {
        operador,
        papelDoOperador: "admin",
        metodo: "POST",
        url: `/admin/lancamentos/${id}/reativar`,
        corpo: (s) => comSenha(s),
        intacto: async () =>
          (await contar(env, `SELECT 1 FROM lancamento WHERE id = $1 AND NOT ativo`, [id])) === 1,
        acao: "lancamento.reativado",
        statusOk: 200,
      };
    },
  ],
  [
    "admin reativar categoria de outro titular",
    async () => {
      const alvo = await entrar(env, { papel: "titular" });
      const id = await novaCategoria(alvo.titularId, false);
      const operador = await entrar(env, { papel: "admin" });
      return {
        operador,
        papelDoOperador: "admin",
        metodo: "POST",
        url: `/admin/categorias/${id}/reativar`,
        corpo: (s) => comSenha(s),
        intacto: async () =>
          (await contar(env, `SELECT 1 FROM categoria WHERE id = $1 AND NOT ativo`, [id])) === 1,
        acao: "categoria.reativada",
        statusOk: 200,
      };
    },
  ],
  [
    "admin reativar conta de outro titular",
    async () => {
      const alvo = await entrar(env, { papel: "titular" });
      const id = await novaConta(alvo.titularId, false);
      const operador = await entrar(env, { papel: "admin" });
      return {
        operador,
        papelDoOperador: "admin",
        metodo: "POST",
        url: `/admin/contas/${id}/reativar`,
        corpo: (s) => comSenha(s),
        intacto: async () =>
          (await contar(env, `SELECT 1 FROM conta WHERE id = $1 AND NOT ativo`, [id])) === 1,
        acao: "conta.reativada",
        statusOk: 200,
      };
    },
  ],
  [
    "gerar link de redefinição de senha",
    async () => {
      const operador = await entrar(env, { papel: "admin" });
      const alvo = await inserirUsuario(env, { papel: "titular" });
      return {
        operador,
        papelDoOperador: "admin",
        metodo: "POST",
        url: `/admin/usuarios/${alvo.id}/redefinicao`,
        corpo: (s) => comSenha(s),
        intacto: async () =>
          (await contar(env, `SELECT 1 FROM redefinicao_senha WHERE usuario_id = $1`, [alvo.id])) ===
          0,
        acao: "redefinicao.criada",
        statusOk: 201,
      };
    },
  ],
];

const registros = async (acao: string, usuarioId: string) =>
  (
    await env.owner.query(`SELECT confirmado_por FROM log WHERE acao = $1 AND usuario_id = $2`, [
      acao,
      usuarioId,
    ])
  ).rows as { confirmado_por: string | null }[];

describe.each(casos)("%s", (_nome, preparar) => {
  const disparar = (p: Preparado, senha?: string, semCsrf = false) =>
    chamar(env, p.operador, p.metodo, p.url, p.corpo(senha), semCsrf);

  it("sem senha: 400, nada muda e nada é feito", async () => {
    const p = await preparar();
    expect((await disparar(p)).statusCode).toBe(400);
    expect(await p.intacto()).toBe(true);
    expect(await registros(p.acao, p.operador.id)).toHaveLength(0);
  });

  it("senha vazia ou gigante: 400", async () => {
    const p = await preparar();
    expect((await disparar(p, "")).statusCode).toBe(400);
    expect((await disparar(p, "x".repeat(129))).statusCode).toBe(400);
    expect(await p.intacto()).toBe(true);
  });

  it("senha errada: 403, nada muda e a falha é registrada no log", async () => {
    const p = await preparar();
    expect((await disparar(p, "senha-errada-1234")).statusCode).toBe(403);
    expect(await p.intacto()).toBe(true);
    expect(await registros(p.acao, p.operador.id)).toHaveLength(0);
    const falhas = await registros("reautenticacao.falha", p.operador.id);
    expect(falhas).toHaveLength(1);
  });

  it(`depois de ${MAX_FALHAS_POR_EMAIL} senhas erradas, até a certa é barrada (429) e registrada`, async () => {
    const p = await preparar();
    for (let i = 0; i < MAX_FALHAS_POR_EMAIL; i++) {
      expect((await disparar(p, "senha-errada-1234")).statusCode).toBe(403);
    }
    expect((await disparar(p, "senha-correta-123")).statusCode).toBe(429);
    expect(await p.intacto()).toBe(true);
    expect((await registros("reautenticacao.bloqueada", p.operador.id)).length).toBeGreaterThan(0);
  });

  it("com a senha certa: funciona e o log guarda quem confirmou", async () => {
    const p = await preparar();
    const res = await disparar(p, "senha-correta-123");
    expect(res.statusCode).toBe(p.statusOk);
    expect(await p.intacto()).toBe(false);
    const feitos = await registros(p.acao, p.operador.id);
    expect(feitos).toHaveLength(1);
    expect(feitos[0]!.confirmado_por).toBe(p.operador.id);
  });

  it("sem token CSRF: 403 e nada muda (mesmo com a senha certa)", async () => {
    const p = await preparar();
    expect((await disparar(p, "senha-correta-123", true)).statusCode).toBe(403);
    expect(await p.intacto()).toBe(true);
  });

  it("sem login: 401 e nada muda", async () => {
    const p = await preparar();
    const res = await env.app.inject({
      method: p.metodo,
      url: p.url,
      payload: p.corpo("senha-correta-123"),
      remoteAddress: env.novoIp(),
    });
    expect(res.statusCode).toBe(401);
    expect(await p.intacto()).toBe(true);
  });

  it("quem não tem o papel exigido recebe 403, mesmo com a senha certa e todas as permissões", async () => {
    const p = await preparar();
    // "Todas": o módulo log só tem a ação ver (o banco recusa qualquer outra).
    const todas = Object.fromEntries(
      MODULOS.map((m) => [
        m,
        m === "log"
          ? { ver: true }
          : { ver: true, cadastrar: true, alterar: true, excluir: true },
      ]),
    );
    // Operação de titular: tenta um vinculado do mesmo titular. Operação de admin: tenta um titular.
    const intruso =
      p.papelDoOperador === "titular"
        ? await entrar(env, {
            papel: "vinculado",
            titularId: p.operador.titularId,
            permissoes: p.intrusoSemPermissao ? {} : todas,
          })
        : await entrar(env, { papel: "titular" });
    const res = await chamar(env, intruso, p.metodo, p.url, p.corpo("senha-correta-123"));
    if (p.qualquerPapel) {
      // Mexe só na conta de quem chama: o vinculado consegue, e a conta do operador fica intacta.
      expect(res.statusCode).toBe(p.statusOk);
    } else {
      expect(res.statusCode).toBe(403);
    }
    expect(await p.intacto()).toBe(true);
  });
});
