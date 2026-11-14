import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  chamar,
  criarAmbiente,
  entrar,
  inserirConvite,
  inserirUsuario,
  logar,
  SENHA,
  type Ambiente,
  type Logado,
} from "../../test/ajudantes.js";

/**
 * Critério da tarefa 14: "teste tenta acessar dado de outro titular em todos os endpoints e falha".
 * O catálogo tem de bater com as rotas vivas: rota nova sem caso aqui quebra este arquivo.
 */

let env: Ambiente;

beforeAll(async () => {
  env = await criarAmbiente(78);
});
afterAll(async () => {
  await env.fechar();
});

/** Toda rota HTTP da API. HEAD (espelho de GET) fica de fora. */
const CATALOGO = [
  "GET /health",
  "POST /auth/login",
  "GET /auth/me",
  "POST /auth/logout",
  "POST /auth/senha",
  "POST /admin/convites",
  "GET /admin/convites",
  "GET /convites/:token",
  "POST /convites/:token/aceitar",
  "POST /usuarios/convites",
  "GET /usuarios",
  "PUT /usuarios/:id/permissoes",
  "GET /log",
  "POST /usuarios/:id/inativar",
  "POST /usuarios/:id/reativar",
  "POST /usuarios/convites/:id/revogar",
  "GET /admin/titulares",
  "POST /admin/titulares/:id/inativar",
  "POST /admin/titulares/:id/reativar",
  "POST /admin/convites/:id/revogar",
  "POST /admin/usuarios/:id/redefinicao",
  "GET /redefinicao/:token",
  "POST /redefinicao/:token",
  "GET /categorias",
  "POST /categorias",
  "PATCH /categorias/:id",
  "POST /categorias/:id/inativar",
  "POST /categorias/:id/reativar",
  "GET /contas",
  "POST /contas",
  "PATCH /contas/:id",
  "POST /contas/:id/inativar",
  "POST /contas/:id/reativar",
  "GET /lancamentos",
  "POST /lancamentos",
  "PATCH /lancamentos/:id",
  "POST /lancamentos/:id/inativar",
  "POST /lancamentos/:id/reativar",
  "GET /painel",
  "GET /inativos",
  "GET /admin/inativos",
  "POST /admin/lancamentos/:id/reativar",
  "POST /admin/categorias/:id/reativar",
  "POST /admin/contas/:id/reativar",
] as const;

const PUBLICAS = new Set<string>([
  "GET /health",
  "POST /auth/login",
  "GET /convites/:token",
  "POST /convites/:token/aceitar",
  "GET /redefinicao/:token",
  "POST /redefinicao/:token",
]);

function rotasVivas(app: FastifyInstance): string[] {
  const texto = app.printRoutes({ commonPrefix: false });
  const saida = new Set<string>();
  const pilha: { recuo: number; caminho: string }[] = [{ recuo: -1, caminho: "" }];
  for (const linha of texto.split("\n")) {
    const inicio = linha.search(/\//);
    if (inicio < 0) continue;
    const recuo = inicio;
    const resto = linha.slice(inicio);
    const m = resto.match(/^(\/\S*?)(?:\s+\(([^)]+)\))?$/);
    if (!m) continue;
    while (pilha[pilha.length - 1]!.recuo >= recuo) pilha.pop();
    const pai = pilha[pilha.length - 1]!.caminho;
    const caminho = `${pai}${m[1]}`.replace(/\/{2,}/g, "/");
    pilha.push({ recuo, caminho });
    if (!m[2]) continue;
    for (const metodo of m[2].split(",").map((s) => s.trim().toUpperCase())) {
      if (metodo === "HEAD") continue;
      saida.add(`${metodo} ${caminho}`);
    }
  }
  return [...saida];
}

interface Casa {
  titular: Logado;
  vinculado: Logado;
  conviteId: string;
  categoriaId: string;
  categoriaInativaId: string;
  contaId: string;
  contaInativaId: string;
  lancamentoId: string;
  lancamentoInativoId: string;
}

const TUDO = {
  lancamentos: { ver: true, cadastrar: true, alterar: true, excluir: true },
  categorias: { ver: true, cadastrar: true, alterar: true, excluir: true },
  contas: { ver: true, cadastrar: true, alterar: true, excluir: true },
  log: { ver: true },
};

async function novaCategoria(titularId: string, ativa: boolean): Promise<string> {
  const r = await env.owner.query(
    `INSERT INTO categoria (titular_id, nome, tipo, natureza, nivel, ativo, inativado_em)
     VALUES ($1, $2, 'despesa', 'variavel', 1, $3, CASE WHEN $3 THEN NULL ELSE now() END) RETURNING id`,
    [titularId, `Cat ${randomUUID()}`, ativa],
  );
  return r.rows[0].id as string;
}

async function novaConta(titularId: string, ativa: boolean): Promise<string> {
  const r = await env.owner.query(
    `INSERT INTO conta (titular_id, nome, tipo, ativo, inativado_em)
     VALUES ($1, $2, 'carteira', $3, CASE WHEN $3 THEN NULL ELSE now() END) RETURNING id`,
    [titularId, `Conta ${randomUUID()}`, ativa],
  );
  return r.rows[0].id as string;
}

async function novoLancamento(
  titularId: string,
  categoriaId: string,
  contaId: string,
  ativo: boolean,
): Promise<string> {
  const r = await env.owner.query(
    `INSERT INTO lancamento
       (titular_id, categoria_id, conta_id, valor, tipo, status, data, descricao, natureza, origem,
        ativo, inativado_em)
     VALUES ($1, $2, $3, 100, 'despesa', 'realizado', '2026-11-13', 'iso', 'variavel', 'manual', $4,
             CASE WHEN $4 THEN NULL ELSE now() END)
     RETURNING id`,
    [titularId, categoriaId, contaId, ativo],
  );
  return r.rows[0].id as string;
}

async function montarCasa(): Promise<Casa> {
  const titular = await entrar(env, { papel: "titular" });
  const vin = await inserirUsuario(env, {
    papel: "vinculado",
    titularId: titular.titularId,
    permissoes: TUDO,
  });
  const vinculado = { ...(await logar(env, vin.email)), id: vin.id, titularId: vin.titularId };
  const convite = await inserirConvite(env, {
    criadoPor: titular.id,
    papel: "vinculado",
    titularId: titular.titularId,
  });
  const categoriaId = await novaCategoria(titular.titularId, true);
  const categoriaInativaId = await novaCategoria(titular.titularId, false);
  const contaId = await novaConta(titular.titularId, true);
  const contaInativaId = await novaConta(titular.titularId, false);
  const lancamentoId = await novoLancamento(titular.titularId, categoriaId, contaId, true);
  const lancamentoInativoId = await novoLancamento(titular.titularId, categoriaId, contaId, false);
  return {
    titular,
    vinculado,
    conviteId: convite.id,
    categoriaId,
    categoriaInativaId,
    contaId,
    contaInativaId,
    lancamentoId,
    lancamentoInativoId,
  };
}

function idsDaCasa(c: Casa): string[] {
  return [
    c.titular.titularId,
    c.titular.id,
    c.vinculado.id,
    c.conviteId,
    c.categoriaId,
    c.categoriaInativaId,
    c.contaId,
    c.contaInativaId,
    c.lancamentoId,
    c.lancamentoInativoId,
  ];
}

function naoVaza(corpo: string, a: Casa, rotulo: string): void {
  for (const id of idsDaCasa(a)) {
    expect(corpo.includes(id), `${rotulo} vazou ${id}`).toBe(false);
  }
}

async function ativo(tabela: string, id: string): Promise<boolean> {
  const r = await env.owner.query(`SELECT ativo FROM ${tabela} WHERE id = $1`, [id]);
  return r.rows[0]?.ativo === true;
}

interface Caso {
  nome: string;
  metodo: "GET" | "POST" | "PUT" | "PATCH";
  url: (a: Casa) => string;
  corpo?: (a: Casa) => object;
  espera: 403 | 404;
  gestor?: boolean;
  adminRota?: boolean;
  intacto?: (a: Casa) => Promise<void>;
}

const casos: Caso[] = [
  {
    nome: "GET /usuarios?titularId=A",
    metodo: "GET",
    url: (a) => `/usuarios?titularId=${a.titular.titularId}`,
    espera: 403,
    gestor: true,
  },
  {
    nome: "GET /log?titularId=A",
    metodo: "GET",
    url: (a) => `/log?titularId=${a.titular.titularId}`,
    espera: 403,
  },
  {
    nome: "GET /admin/titulares",
    metodo: "GET",
    url: () => "/admin/titulares",
    espera: 403,
    adminRota: true,
  },
  {
    nome: "GET /admin/convites",
    metodo: "GET",
    url: () => "/admin/convites",
    espera: 403,
    adminRota: true,
  },
  {
    nome: "GET /admin/inativos?titularId=A",
    metodo: "GET",
    url: (a) => `/admin/inativos?titularId=${a.titular.titularId}`,
    espera: 403,
    adminRota: true,
  },
  {
    nome: "POST /admin/convites",
    metodo: "POST",
    url: () => "/admin/convites",
    corpo: () => ({ email: "x@y.com", nomeTitular: "Invadido" }),
    espera: 403,
    adminRota: true,
  },
  {
    nome: "POST /usuarios/convites no titular A",
    metodo: "POST",
    url: () => "/usuarios/convites",
    corpo: (a) => ({
      email: env.novoEmail(),
      senha: SENHA,
      permissoes: {},
      titularId: a.titular.titularId,
    }),
    espera: 403,
    gestor: true,
  },
  {
    nome: "PUT permissões do vinculado de A",
    metodo: "PUT",
    url: (a) => `/usuarios/${a.vinculado.id}/permissoes`,
    corpo: () => ({ permissoes: { contas: { ver: true } }, senha: SENHA }),
    espera: 404,
    gestor: true,
    intacto: async (a) => {
      const r = await env.owner.query(
        `SELECT ver FROM permissao WHERE usuario_id = $1 AND modulo = 'lancamentos'`,
        [a.vinculado.id],
      );
      expect(r.rows[0]?.ver).toBe(true);
    },
  },
  {
    nome: "POST inativar usuário de A",
    metodo: "POST",
    url: (a) => `/usuarios/${a.vinculado.id}/inativar`,
    corpo: () => ({ senha: SENHA }),
    espera: 404,
    gestor: true,
    intacto: async (a) => expect(await ativo("usuario", a.vinculado.id)).toBe(true),
  },
  {
    nome: "POST reativar usuário de A",
    metodo: "POST",
    url: (a) => `/usuarios/${a.vinculado.id}/reativar`,
    corpo: () => ({ senha: SENHA }),
    espera: 404,
    gestor: true,
  },
  {
    nome: "POST revogar convite de A",
    metodo: "POST",
    url: (a) => `/usuarios/convites/${a.conviteId}/revogar`,
    corpo: () => ({ senha: SENHA }),
    espera: 404,
    gestor: true,
    intacto: async (a) => {
      const r = await env.owner.query(`SELECT revogado_em FROM convite WHERE id = $1`, [a.conviteId]);
      expect(r.rows[0]?.revogado_em).toBeNull();
    },
  },
  {
    nome: "POST admin inativar titular A",
    metodo: "POST",
    url: (a) => `/admin/titulares/${a.titular.titularId}/inativar`,
    corpo: () => ({ senha: SENHA }),
    espera: 403,
    adminRota: true,
    intacto: async (a) => expect(await ativo("titular", a.titular.titularId)).toBe(true),
  },
  {
    nome: "POST admin reativar titular A",
    metodo: "POST",
    url: (a) => `/admin/titulares/${a.titular.titularId}/reativar`,
    corpo: () => ({ senha: SENHA }),
    espera: 403,
    adminRota: true,
  },
  {
    nome: "POST admin revogar convite de A",
    metodo: "POST",
    url: (a) => `/admin/convites/${a.conviteId}/revogar`,
    corpo: () => ({ senha: SENHA }),
    espera: 403,
    adminRota: true,
  },
  {
    nome: "POST admin redefinição do usuário de A",
    metodo: "POST",
    url: (a) => `/admin/usuarios/${a.titular.id}/redefinicao`,
    corpo: () => ({ senha: SENHA }),
    espera: 403,
    adminRota: true,
  },
  {
    nome: "PATCH categoria de A",
    metodo: "PATCH",
    url: (a) => `/categorias/${a.categoriaId}`,
    corpo: () => ({ nome: "Invadida" }),
    espera: 404,
    intacto: async (a) => {
      const r = await env.owner.query(`SELECT nome FROM categoria WHERE id = $1`, [a.categoriaId]);
      expect(r.rows[0]?.nome).not.toBe("Invadida");
    },
  },
  {
    nome: "POST inativar categoria de A",
    metodo: "POST",
    url: (a) => `/categorias/${a.categoriaId}/inativar`,
    corpo: () => ({ senha: SENHA }),
    espera: 404,
    intacto: async (a) => expect(await ativo("categoria", a.categoriaId)).toBe(true),
  },
  {
    nome: "POST reativar categoria de A",
    metodo: "POST",
    url: (a) => `/categorias/${a.categoriaInativaId}/reativar`,
    corpo: () => ({ senha: SENHA }),
    espera: 404,
    intacto: async (a) => expect(await ativo("categoria", a.categoriaInativaId)).toBe(false),
  },
  {
    nome: "POST categoria filha da de A",
    metodo: "POST",
    url: () => "/categorias",
    corpo: (a) => ({ nome: `Filha ${randomUUID()}`, paiId: a.categoriaId }),
    espera: 404,
  },
  {
    nome: "PATCH conta de A",
    metodo: "PATCH",
    url: (a) => `/contas/${a.contaId}`,
    corpo: () => ({ nome: "Invadida" }),
    espera: 404,
    intacto: async (a) => {
      const r = await env.owner.query(`SELECT nome FROM conta WHERE id = $1`, [a.contaId]);
      expect(r.rows[0]?.nome).not.toBe("Invadida");
    },
  },
  {
    nome: "POST inativar conta de A",
    metodo: "POST",
    url: (a) => `/contas/${a.contaId}/inativar`,
    corpo: () => ({ senha: SENHA }),
    espera: 404,
    intacto: async (a) => expect(await ativo("conta", a.contaId)).toBe(true),
  },
  {
    nome: "POST reativar conta de A",
    metodo: "POST",
    url: (a) => `/contas/${a.contaInativaId}/reativar`,
    corpo: () => ({ senha: SENHA }),
    espera: 404,
    intacto: async (a) => expect(await ativo("conta", a.contaInativaId)).toBe(false),
  },
  {
    nome: "PATCH lançamento de A",
    metodo: "PATCH",
    url: (a) => `/lancamentos/${a.lancamentoId}`,
    corpo: () => ({ descricao: "Invadido" }),
    espera: 404,
    intacto: async (a) => {
      const r = await env.owner.query(`SELECT descricao FROM lancamento WHERE id = $1`, [
        a.lancamentoId,
      ]);
      expect(r.rows[0]?.descricao).toBe("iso");
    },
  },
  {
    nome: "POST inativar lançamento de A",
    metodo: "POST",
    url: (a) => `/lancamentos/${a.lancamentoId}/inativar`,
    corpo: () => ({ senha: SENHA }),
    espera: 404,
    intacto: async (a) => expect(await ativo("lancamento", a.lancamentoId)).toBe(true),
  },
  {
    nome: "POST reativar lançamento de A",
    metodo: "POST",
    url: (a) => `/lancamentos/${a.lancamentoInativoId}/reativar`,
    corpo: () => ({ senha: SENHA }),
    espera: 404,
    intacto: async (a) => expect(await ativo("lancamento", a.lancamentoInativoId)).toBe(false),
  },
  {
    nome: "POST admin reativar lançamento de A",
    metodo: "POST",
    url: (a) => `/admin/lancamentos/${a.lancamentoInativoId}/reativar`,
    corpo: () => ({ senha: SENHA }),
    espera: 403,
    adminRota: true,
    intacto: async (a) => expect(await ativo("lancamento", a.lancamentoInativoId)).toBe(false),
  },
  {
    nome: "POST admin reativar categoria de A",
    metodo: "POST",
    url: (a) => `/admin/categorias/${a.categoriaInativaId}/reativar`,
    corpo: () => ({ senha: SENHA }),
    espera: 403,
    adminRota: true,
    intacto: async (a) => expect(await ativo("categoria", a.categoriaInativaId)).toBe(false),
  },
  {
    nome: "POST admin reativar conta de A",
    metodo: "POST",
    url: (a) => `/admin/contas/${a.contaInativaId}/reativar`,
    corpo: () => ({ senha: SENHA }),
    espera: 403,
    adminRota: true,
    intacto: async (a) => expect(await ativo("conta", a.contaInativaId)).toBe(false),
  },
];

describe("catálogo fecha todas as rotas", () => {
  it("a API só tem as rotas listadas neste arquivo", () => {
    const vivas = rotasVivas(env.app).sort();
    const catalogo = [...CATALOGO].sort();
    expect(vivas, vivas.join("\n")).toEqual(catalogo);
    for (const rota of CATALOGO) {
      const [method, url] = rota.split(" ") as ["GET" | "POST" | "PUT" | "PATCH", string];
      expect(env.app.hasRoute({ method, url }), rota).toBe(true);
    }
  });
});

describe("sem sessão", () => {
  it("toda rota autenticada responde 401", async () => {
    for (const rota of CATALOGO) {
      if (PUBLICAS.has(rota)) continue;
      const [metodo, caminho] = rota.split(" ") as ["GET" | "POST" | "PUT" | "PATCH", string];
      const url = caminho.replaceAll(":id", randomUUID()).replaceAll(":token", "x".repeat(40));
      const res = await env.app.inject({ method: metodo, url, payload: {} });
      expect(res.statusCode, rota).toBe(401);
    }
  });
});

describe("isolamento entre titulares", () => {
  let a: Casa;
  let b: Casa;
  let admin: Logado;

  beforeAll(async () => {
    a = await montarCasa();
    b = await montarCasa();
    admin = await entrar(env, { papel: "admin" });
  });

  it.each(casos)("$nome", async (caso) => {
    const url = caso.url(a);
    const corpo = caso.corpo?.(a);

    const titular = await chamar(env, b.titular, caso.metodo, url, corpo);
    expect(titular.statusCode, `${caso.nome} titular ${titular.body}`).toBe(caso.espera);
    naoVaza(titular.body, a, `${caso.nome} titular`);

    const esperaVinculado = caso.gestor || caso.adminRota ? 403 : caso.espera;
    const vinculado = await chamar(env, b.vinculado, caso.metodo, url, corpo);
    expect(vinculado.statusCode, `${caso.nome} vinculado ${vinculado.body}`).toBe(esperaVinculado);
    naoVaza(vinculado.body, a, `${caso.nome} vinculado`);

    if (!caso.adminRota && !caso.gestor && caso.espera === 404) {
      const comoAdmin = await chamar(env, admin, caso.metodo, url, corpo);
      expect(comoAdmin.statusCode, `${caso.nome} admin comum ${comoAdmin.body}`).toBe(404);
      naoVaza(comoAdmin.body, a, `${caso.nome} admin comum`);
    }

    if (caso.intacto) await caso.intacto(a);
  });

  it("listas do titular B, do vinculado e do admin (rotas comuns) não incluem a casa A", async () => {
    const caminhos = [
      "/categorias?incluirInativas=true",
      "/contas?incluirInativas=true",
      "/lancamentos?incluirInativos=true&limite=100",
      `/lancamentos?categoriaId=${a.categoriaId}&limite=100`,
      `/lancamentos?contaId=${a.contaId}&limite=100`,
      "/painel",
      `/painel?mes=${new Date().toISOString().slice(0, 7)}`,
      "/inativos",
      "/usuarios",
      "/log?limite=100",
      `/log?usuarioId=${a.titular.id}&limite=100`,
      "/auth/me",
    ];
    for (const quem of [b.titular, b.vinculado, admin]) {
      for (const caminho of caminhos) {
        if (caminho === "/usuarios" && quem === b.vinculado) {
          expect((await chamar(env, quem, "GET", caminho)).statusCode).toBe(403);
          continue;
        }
        const res = await chamar(env, quem, "GET", caminho);
        expect(res.statusCode, `${quem.email} ${caminho} ${res.body}`).toBe(200);
        const logDoAdmin = quem === admin && caminho.startsWith("/log");
        if (!logDoAdmin) naoVaza(res.body, a, `${quem.email} ${caminho}`);
      }
    }
  });

  it("criar lançamento com categoria ou conta de A é 404 e nada nasce", async () => {
    const misturas = [
      { categoriaId: a.categoriaId, contaId: b.contaId },
      { categoriaId: b.categoriaId, contaId: a.contaId },
      { categoriaId: a.categoriaId, contaId: a.contaId },
    ];
    const antes = (
      await env.owner.query(`SELECT count(*)::int AS n FROM lancamento WHERE titular_id = $1`, [
        a.titular.titularId,
      ])
    ).rows[0].n as number;
    for (const m of misturas) {
      const res = await chamar(env, b.titular, "POST", "/lancamentos", {
        ...m,
        valor: 100,
        data: "2026-11-13",
        descricao: "invasão",
      });
      expect(res.statusCode, res.body).toBe(404);
    }
    const depois = (
      await env.owner.query(`SELECT count(*)::int AS n FROM lancamento WHERE titular_id = $1`, [
        a.titular.titularId,
      ])
    ).rows[0].n as number;
    expect(depois).toBe(antes);
  });

  it("editar o próprio lançamento apontando categoria de A é 404 e nada muda", async () => {
    const res = await chamar(env, b.titular, "PATCH", `/lancamentos/${b.lancamentoId}`, {
      categoriaId: a.categoriaId,
    });
    expect(res.statusCode).toBe(404);
    const r = await env.owner.query(`SELECT categoria_id FROM lancamento WHERE id = $1`, [
      b.lancamentoId,
    ]);
    expect(r.rows[0]?.categoria_id).toBe(b.categoriaId);
  });

  it("sair da sessão de B não derruba a de A", async () => {
    expect((await chamar(env, b.titular, "POST", "/auth/logout", {})).statusCode).toBe(204);
    expect((await chamar(env, a.titular, "GET", "/auth/me")).json().usuario.id).toBe(a.titular.id);
  });
});
