/** Só o Playwright lê isto. Não entra no bundle do Vite. */
export const E2E_EMAIL = process.env.E2E_EMAIL ?? "e2e-titular@finan.test";
export const E2E_SENHA = process.env.E2E_SENHA ?? "e2e-senha-correta-123";
