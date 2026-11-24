import { defineConfig, devices } from "@playwright/test";
import { carregarEnvE2e, origemE2e, portaApiE2e, portaWebE2e, urlSaudeApi } from "./e2e/banco";

const { databaseUrl } = carregarEnvE2e();

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL: origemE2e,
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
    trace: "on-first-retry",
  },
  // Chrome já instalado no sistema (Omarchy). Não baixa o Chromium do Playwright.
  projects: [{ name: "mobile", use: { ...devices["Pixel 5"], channel: "chrome" } }],
  webServer: [
    {
      command: "npm run dev:api",
      url: urlSaudeApi,
      // Sempre sobe a API no finan_test; nunca reutiliza um `dev` apontando para finan_dev.
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
        API_PORT: String(portaApiE2e),
        APP_ORIGIN: origemE2e,
      },
    },
    {
      command: "npm run dev:web",
      url: origemE2e,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        ...process.env,
        WEB_PORT: String(portaWebE2e),
        WEB_HOST: "127.0.0.1",
        API_PROXY: `http://127.0.0.1:${portaApiE2e}`,
      },
    },
  ],
});
