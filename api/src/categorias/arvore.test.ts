import { describe, expect, it } from "vitest";
import { montarArvore, type LinhaCategoria } from "./arvore.js";

let seq = 0;
function linha(p: Partial<LinhaCategoria> & { nome: string }): LinhaCategoria {
  return {
    id: `id-${++seq}`,
    paiId: null,
    tipo: "despesa",
    natureza: "variavel",
    preverPelaMedia: false,
    nivel: 1,
    ativo: true,
    ...p,
  };
}

describe("montarArvore", () => {
  it("aninha as filhas sob a mãe, em até 3 níveis", () => {
    const moradia = linha({ nome: "Moradia" });
    const energia = linha({ nome: "Energia", paiId: moradia.id, nivel: 2 });
    const bandeira = linha({ nome: "Bandeira tarifária", paiId: energia.id, nivel: 3 });
    const arvore = montarArvore([bandeira, energia, moradia]); // ordem de entrada embaralhada

    expect(arvore).toHaveLength(1);
    expect(arvore[0]!.nome).toBe("Moradia");
    expect(arvore[0]!.filhas.map((f) => f.nome)).toEqual(["Energia"]);
    expect(arvore[0]!.filhas[0]!.filhas.map((f) => f.nome)).toEqual(["Bandeira tarifária"]);
    expect(arvore[0]!.filhas[0]!.filhas[0]!.filhas).toEqual([]);
  });

  it("receitas vêm antes das despesas e cada grupo fica em ordem alfabética (pt-BR)", () => {
    const arvore = montarArvore([
      linha({ nome: "Transporte", tipo: "despesa" }),
      linha({ nome: "Salário", tipo: "receita" }),
      linha({ nome: "Água", tipo: "despesa" }),
      linha({ nome: "Alimentação", tipo: "despesa" }),
      linha({ nome: "Rendimentos", tipo: "receita" }),
    ]);
    expect(arvore.map((n) => n.nome)).toEqual([
      "Rendimentos",
      "Salário",
      "Água",
      "Alimentação",
      "Transporte",
    ]);
  });

  it("ordena as filhas por nome, sem diferenciar maiúsculas nem acentos", () => {
    const mae = linha({ nome: "Casa" });
    const filhas = ["zeladoria", "Água", "Condomínio", "energia"].map((nome) =>
      linha({ nome, paiId: mae.id, nivel: 2 }),
    );
    const arvore = montarArvore([mae, ...filhas]);
    expect(arvore[0]!.filhas.map((f) => f.nome)).toEqual([
      "Água",
      "Condomínio",
      "energia",
      "zeladoria",
    ]);
  });

  it("temFilhasAtivas só conta filhas ativas", () => {
    const comAtiva = linha({ nome: "A" });
    const soInativa = linha({ nome: "B" });
    const sozinha = linha({ nome: "C" });
    const arvore = montarArvore([
      comAtiva,
      linha({ nome: "A1", paiId: comAtiva.id, nivel: 2, ativo: true }),
      soInativa,
      linha({ nome: "B1", paiId: soInativa.id, nivel: 2, ativo: false }),
      sozinha,
    ]);
    const por = Object.fromEntries(arvore.map((n) => [n.nome, n]));
    expect(por.A!.temFilhasAtivas).toBe(true);
    expect(por.B!.temFilhasAtivas).toBe(false);
    expect(por.B!.filhas).toHaveLength(1); // a inativa continua na árvore (quando pedida)
    expect(por.C!.temFilhasAtivas).toBe(false);
  });

  it("categoria cuja mãe não está na lista aparece como raiz em vez de sumir", () => {
    const orfa = linha({ nome: "Órfã", paiId: "mae-que-nao-veio", nivel: 2 });
    const arvore = montarArvore([orfa]);
    expect(arvore.map((n) => n.nome)).toEqual(["Órfã"]);
  });

  it("lista vazia dá árvore vazia e não altera a entrada", () => {
    expect(montarArvore([])).toEqual([]);
    const entrada = [linha({ nome: "B" }), linha({ nome: "A" })];
    const copia = entrada.map((l) => ({ ...l }));
    montarArvore(entrada);
    expect(entrada).toEqual(copia);
  });
});
