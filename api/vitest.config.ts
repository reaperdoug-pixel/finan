import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Recria o banco de teste uma única vez antes de tudo.
    globalSetup: ["./test/globalSetup.ts"],
    // Todos os arquivos de teste de banco usam o mesmo banco: rodam um por vez.
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
