import { describe, expect, it } from "vitest";
import { destinoAposLogin, sessaoExpirou } from "./destino";

describe("destinoAposLogin", () => {
  it("volta para a rota interna guardada, com a busca", () => {
    expect(destinoAposLogin({ de: "/lancamentos?mes=2026-11" }, "/painel")).toBe("/lancamentos?mes=2026-11");
  });
  it("sem destino, ou destino inválido, usa o padrão", () => {
    for (const estado of [undefined, null, {}, { de: 42 }, { de: "lancamentos" }]) {
      expect(destinoAposLogin(estado, "/painel")).toBe("/painel");
    }
  });
  it("nunca volta para outro site nem para o próprio login (sem loop)", () => {
    for (const de of ["//evil.com", "https://evil.com", "/login", "/login?x=1", "/"]) {
      expect(destinoAposLogin({ de }, "/painel"), de).toBe("/painel");
    }
  });
});

describe("sessaoExpirou", () => {
  it("só é true quando o estado diz que expirou", () => {
    expect(sessaoExpirou({ expirou: true })).toBe(true);
    expect(sessaoExpirou({ expirou: false })).toBe(false);
    expect(sessaoExpirou(undefined)).toBe(false);
  });
});
