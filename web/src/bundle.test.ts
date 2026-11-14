import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function arquivos(dir: string): string[] {
  const out: string[] = [];
  for (const nome of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, nome.name);
    if (nome.isDirectory()) out.push(...arquivos(p));
    else if (/\.(ts|tsx|css)$/.test(nome.name) && !nome.name.includes(".test.")) out.push(p);
  }
  return out;
}

describe("nada sensível no front", () => {
  const src = arquivos(dirname(fileURLToPath(import.meta.url)));
  const textos = src.map((p) => ({ p, t: readFileSync(p, "utf8") }));

  it("não usa localStorage nem sessionStorage", () => {
    for (const { p, t } of textos) {
      expect(t, p).not.toMatch(/\blocalStorage\b/);
      expect(t, p).not.toMatch(/\bsessionStorage\b/);
    }
  });

  it("não lê VITE_ nem coloca senha de teste no bundle", () => {
    for (const { p, t } of textos) {
      expect(t, p).not.toMatch(/VITE_/);
      expect(t, p).not.toMatch(/senha-correta-123/);
      expect(t, p).not.toMatch(/SESSION_SECRET/);
    }
  });
});
