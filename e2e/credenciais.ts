/** Só o Playwright lê isto. Não entra no bundle do Vite. */
export const E2E_EMAIL = process.env.E2E_EMAIL ?? "e2e-titular@finan.test";
export const E2E_SENHA = process.env.E2E_SENHA ?? "e2e-senha-correta-123";
/** E-mail só do caso de bloqueio (429), para não interferir nos outros testes. */
export const E2E_EMAIL_BLOQUEIO = process.env.E2E_EMAIL_BLOQUEIO ?? "e2e-bloqueio@finan.test";
