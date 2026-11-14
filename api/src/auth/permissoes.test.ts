import type { FastifyReply, FastifyRequest } from "fastify";
import { describe, expect, it } from "vitest";
import {
  ACOES,
  MODULOS,
  exigirPermissao,
  interpretarPermissoes,
  lerPermissoes,
  permissoesNulas,
  permissoesTotais,
  podeLancar,
  podeVerAnexo,
  temPermissao,
  validarRegras,
  type Modulo,
  type Permissoes,
} from "./permissoes.js";

const MODULOS_DE_DADOS = MODULOS.filter((m) => m !== "log");
const comPermissoes = (permissoes: Permissoes) => ({ permissoes });

/** Monta permissões com apenas o que foi pedido ligado. */
function so(parcial: Partial<Record<Modulo, Partial<Record<(typeof ACOES)[number], boolean>>>>) {
  const p = permissoesNulas();
  for (const m of MODULOS) Object.assign(p[m], parcial[m] ?? {});
  return p;
}

describe("matriz: titular e admin (tudo nos próprios dados)", () => {
  const total = comPermissoes(permissoesTotais());

  it.each(MODULOS_DE_DADOS)("módulo %s: ver, cadastrar, alterar e excluir", (m) => {
    for (const a of ACOES) expect(temPermissao(total, m, a)).toBe(true);
  });

  it("log: só ver", () => {
    expect(temPermissao(total, "log", "ver")).toBe(true);
    for (const a of ["cadastrar", "alterar", "excluir"] as const) {
      expect(temPermissao(total, "log", a)).toBe(false);
    }
  });

  it("pode lançar e ver anexos", () => {
    expect(podeLancar(total)).toBe(true);
    expect(podeVerAnexo(total)).toBe(true);
  });
});

describe("matriz: vinculado sem permissão", () => {
  const nada = comPermissoes(permissoesNulas());

  it.each(MODULOS)("módulo %s: nenhuma ação", (m) => {
    for (const a of ACOES) expect(temPermissao(nada, m, a)).toBe(false);
  });

  it("não pode lançar nem ver anexos", () => {
    expect(podeLancar(nada)).toBe(false);
    expect(podeVerAnexo(nada)).toBe(false);
  });
});

describe("matriz: vinculado com permissão (cada módulo e ação, sem vazar para os outros)", () => {
  for (const m of MODULOS) {
    for (const a of ACOES) {
      if (m === "log" && a !== "ver") continue; // o log só tem `ver`
      // Para as ações que exigem `ver`, o conjunto mínimo válido inclui `ver`.
      const concedidas: Record<string, boolean> =
        a === "alterar" || a === "excluir" ? { ver: true, [a]: true } : { [a]: true };
      it(`só ${m}.${a} liberado`, () => {
        const p = so({ [m]: concedidas });
        expect(validarRegras(p)).toBeNull();
        const s = comPermissoes(p);
        expect(temPermissao(s, m, a)).toBe(true);
        for (const outro of MODULOS) {
          if (outro === m) continue;
          for (const acao of ACOES) expect(temPermissao(s, outro, acao)).toBe(false);
        }
        // as demais ações do mesmo módulo só valem se foram concedidas
        for (const acao of ACOES) {
          expect(temPermissao(s, m, acao)).toBe(acao in concedidas);
        }
      });
    }
  }
});

describe("regras de dependência", () => {
  it("alterar e excluir exigem ver no mesmo módulo", () => {
    expect(validarRegras(so({ contas: { alterar: true } }))).not.toBeNull();
    expect(validarRegras(so({ contas: { excluir: true } }))).not.toBeNull();
    expect(validarRegras(so({ contas: { ver: true, alterar: true, excluir: true } }))).toBeNull();
  });

  it("ver em outro módulo não satisfaz a exigência", () => {
    expect(
      validarRegras(so({ contas: { alterar: true }, categorias: { ver: true } })),
    ).not.toBeNull();
  });

  it("log só aceita ver", () => {
    expect(validarRegras(so({ log: { ver: true } }))).toBeNull();
    expect(validarRegras(so({ log: { ver: true, cadastrar: true } }))).not.toBeNull();
    expect(validarRegras(so({ log: { ver: true, alterar: true } }))).not.toBeNull();
    expect(validarRegras(so({ log: { ver: true, excluir: true } }))).not.toBeNull();
  });

  it.each([
    ["só cadastrar lançamentos", { lancamentos: { cadastrar: true } }, false],
    [
      "cadastrar + ver categorias",
      { lancamentos: { cadastrar: true }, categorias: { ver: true } },
      false,
    ],
    ["cadastrar + ver contas", { lancamentos: { cadastrar: true }, contas: { ver: true } }, false],
    [
      "cadastrar + ver categorias e contas",
      { lancamentos: { cadastrar: true }, categorias: { ver: true }, contas: { ver: true } },
      true,
    ],
    [
      "ver categorias e contas, sem cadastrar",
      { categorias: { ver: true }, contas: { ver: true } },
      false,
    ],
  ])("lançar: %s", (_nome, parcial, esperado) => {
    expect(podeLancar(comPermissoes(so(parcial)))).toBe(esperado);
  });

  it.each([
    ["só anexos", { anexos: { ver: true } }, false],
    ["só lançamentos", { lancamentos: { ver: true } }, false],
    ["anexos e lançamentos", { anexos: { ver: true }, lancamentos: { ver: true } }, true],
    [
      "cadastrar anexos sem ver",
      { anexos: { cadastrar: true }, lancamentos: { ver: true } },
      false,
    ],
  ])("ver anexo: %s", (_nome, parcial, esperado) => {
    expect(podeVerAnexo(comPermissoes(so(parcial)))).toBe(esperado);
  });
});

describe("interpretarPermissoes (o que vem do cliente)", () => {
  it("ausente vira falso e vazio é válido", () => {
    for (const entrada of [{}, undefined, null]) {
      const r = interpretarPermissoes(entrada);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.permissoes).toEqual(permissoesNulas());
    }
  });

  it("completa o que faltou", () => {
    const r = interpretarPermissoes({ contas: { ver: true } });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.permissoes.contas).toEqual({
        ver: true,
        cadastrar: false,
        alterar: false,
        excluir: false,
      });
      expect(r.permissoes.lancamentos.ver).toBe(false);
    }
  });

  it.each([
    ["módulo desconhecido", { relatorios: { ver: true } }],
    ["ação desconhecida", { contas: { ver: true, apagar: true } }],
    ["valor que não é booleano", { contas: { ver: "true" } }],
    ["módulo que não é objeto", { contas: true }],
    ["entrada que não é objeto", "contas"],
    ["alterar sem ver", { contas: { alterar: true } }],
    ["log com cadastrar", { log: { ver: true, cadastrar: true } }],
  ])("recusa: %s", (_nome, entrada) => {
    expect(interpretarPermissoes(entrada).ok).toBe(false);
  });

  it("lerPermissoes: válido volta completo, inválido vira null", () => {
    expect(lerPermissoes({ contas: { ver: true } })?.contas.ver).toBe(true);
    expect(lerPermissoes({ contas: { alterar: true } })).toBeNull();
    expect(lerPermissoes("lixo")).toBeNull();
  });
});

describe("exigirPermissao (guarda das rotas)", () => {
  function resposta() {
    const r: { status?: number } = {};
    const reply = {
      code(c: number) {
        r.status = c;
        return { send: () => undefined };
      },
    } as unknown as FastifyReply;
    return { r, reply };
  }
  const reqComSessao = (p: Permissoes) =>
    ({ sessao: { permissoes: p } }) as unknown as FastifyRequest;

  it("sem sessão: 401", () => {
    const { r, reply } = resposta();
    const req = { sessao: null } as unknown as FastifyRequest;
    expect(exigirPermissao(req, reply, "contas", "ver")).toBe(false);
    expect(r.status).toBe(401);
  });

  it("sem a permissão: 403", () => {
    const { r, reply } = resposta();
    expect(exigirPermissao(reqComSessao(permissoesNulas()), reply, "contas", "ver")).toBe(false);
    expect(r.status).toBe(403);
  });

  it("com a permissão: deixa passar sem responder", () => {
    const { r, reply } = resposta();
    const req = reqComSessao(so({ contas: { ver: true } }));
    expect(exigirPermissao(req, reply, "contas", "ver")).toBe(true);
    expect(r.status).toBeUndefined();
  });

  it("permissão de outro módulo não serve", () => {
    const { r, reply } = resposta();
    const req = reqComSessao(so({ categorias: { ver: true } }));
    expect(exigirPermissao(req, reply, "contas", "ver")).toBe(false);
    expect(r.status).toBe(403);
  });
});
