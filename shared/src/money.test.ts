import { describe, expect, it } from "vitest";
import { formatBRL, parseBRLToCents } from "./money.js";

describe("parseBRLToCents", () => {
  it("converte valores válidos", () => {
    expect(parseBRLToCents("1.234,56")).toBe(123456);
    expect(parseBRLToCents("1234,56")).toBe(123456);
    expect(parseBRLToCents("1.000")).toBe(100000);
    expect(parseBRLToCents("10")).toBe(1000);
    expect(parseBRLToCents("0,5")).toBe(50);
    expect(parseBRLToCents("-3,20")).toBe(-320);
  });

  it("rejeita valores inválidos, ponto decimal e overflow", () => {
    expect(parseBRLToCents("abc")).toBeNull();
    expect(parseBRLToCents("1,234")).toBeNull();
    expect(parseBRLToCents("25.90")).toBeNull();
    expect(parseBRLToCents("10.5")).toBeNull();
    expect(parseBRLToCents("1..234,56")).toBeNull();
    expect(parseBRLToCents("1.2,34")).toBeNull();
    expect(parseBRLToCents("99.999.999,99")).toBeNull();
    expect(parseBRLToCents("")).toBeNull();
  });
});

describe("formatBRL", () => {
  it("formata centavos em reais", () => {
    expect(formatBRL(123456).replace(/\s/g, " ")).toBe("R$ 1.234,56");
  });

  it("recusa valor não inteiro", () => {
    expect(() => formatBRL(10.5)).toThrow();
  });
});
