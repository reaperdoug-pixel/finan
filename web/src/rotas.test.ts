import { describe, expect, it } from "vitest";
import { podeLancar, rotaInicial } from "./rotas";
import type { Modulo, Permissoes } from "./tipos";

function semNada(sobre: Partial<Record<Modulo, Partial<Permissoes[Modulo]>>> = {}): Permissoes {
  const base = {} as Permissoes;
  for (const m of [
    "lancamentos",
    "categorias",
    "contas",
    "contatos",
    "orcamentos",
    "anexos",
    "log",
  ] as Modulo[]) {
    base[m] = { ver: false, cadastrar: false, alterar: false, excluir: false, ...sobre[m] };
  }
  return base;
}

describe("rotaInicial", () => {
  it("vai para /painel quando pode ver lançamentos", () => {
    expect(rotaInicial(semNada({ lancamentos: { ver: true } }), "vinculado")).toBe("/painel");
  });

  it("cai para contatos, categorias, contas, pessoas, log ou inativos conforme o que pode ver", () => {
    expect(rotaInicial(semNada({ contatos: { ver: true } }), "vinculado")).toBe("/contatos");
    expect(rotaInicial(semNada({ categorias: { ver: true } }), "vinculado")).toBe("/categorias");
    expect(rotaInicial(semNada({ contas: { ver: true } }), "vinculado")).toBe("/contas");
    expect(rotaInicial(semNada(), "titular")).toBe("/pessoas");
    expect(rotaInicial(semNada({ log: { ver: true } }), "vinculado")).toBe("/log");
    expect(rotaInicial(semNada(), "vinculado")).toBe("/inativos");
  });
});

describe("podeLancar", () => {
  it("exige cadastrar em lançamentos e ver em categorias e contas", () => {
    expect(
      podeLancar(
        semNada({
          lancamentos: { ver: true, cadastrar: true },
          categorias: { ver: true },
          contas: { ver: true },
        }),
      ),
    ).toBe(true);
    expect(
      podeLancar(semNada({ lancamentos: { ver: true, cadastrar: true }, categorias: { ver: true } })),
    ).toBe(false);
    expect(
      podeLancar(semNada({ lancamentos: { ver: true, cadastrar: true }, contas: { ver: true } })),
    ).toBe(false);
  });
});
