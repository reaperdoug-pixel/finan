import { describe, expect, it } from "vitest";
import {
  deslocarMes,
  formatarData,
  formatarDiaGrupo,
  formatarMes,
  primeiroDiaDoMes,
  rotuloTipo,
  ultimoDiaDoMes,
} from "./formato";

describe("formato", () => {
  it("mostra data em pt-BR", () => {
    expect(formatarData("2026-11-13")).toBe("13/11/2026");
  });
  it("agrupa o dia por extenso", () => {
    expect(formatarDiaGrupo("2026-11-13")).toBe("sexta-feira, 13 de novembro");
  });
  it("nomeia o mês e anda um mês", () => {
    expect(formatarMes("2026-11")).toBe("Novembro de 2026");
    expect(deslocarMes("2026-01", -1)).toBe("2025-12");
    expect(deslocarMes("2026-12", 1)).toBe("2027-01");
  });
  it("fecha o mês sem Date local", () => {
    expect(primeiroDiaDoMes("2026-02-10")).toBe("2026-02-01");
    expect(ultimoDiaDoMes("2026-02-01")).toBe("2026-02-28");
  });
  it("rotula tipos conhecidos", () => {
    expect(rotuloTipo("despesa")).toBe("Despesa");
    expect(rotuloTipo("cartao")).toBe("Cartão");
  });
});
