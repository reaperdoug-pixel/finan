import { describe, expect, it } from "vitest";
import { conferirSenha, gerarHash, validarSenha } from "./senha.js";

describe("validarSenha", () => {
  it("exige pelo menos 10 caracteres", () => {
    expect(validarSenha("123456789")).not.toBeNull();
    expect(validarSenha("1234567890")).toBeNull();
  });

  it("recusa senhas gigantes (evita abuso de CPU)", () => {
    expect(validarSenha("a".repeat(129))).not.toBeNull();
    expect(validarSenha("a".repeat(128))).toBeNull();
  });
});

describe("hash de senha", () => {
  it("usa argon2id e confere a senha certa e a errada", async () => {
    const h = await gerarHash("uma-senha-bem-longa");
    expect(h.startsWith("$argon2id$")).toBe(true);
    expect(await conferirSenha(h, "uma-senha-bem-longa")).toBe(true);
    expect(await conferirSenha(h, "outra-senha-qualquer")).toBe(false);
  });

  it("gera hashes diferentes para a mesma senha (salt)", async () => {
    const [a, b] = await Promise.all([gerarHash("mesma-senha-123"), gerarHash("mesma-senha-123")]);
    expect(a).not.toBe(b);
  });

  it("hash malformado vira falso em vez de erro", async () => {
    expect(await conferirSenha("isto-nao-e-um-hash", "qualquer-coisa")).toBe(false);
  });
});
