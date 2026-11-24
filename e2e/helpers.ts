import { type Page } from "@playwright/test";
import { E2E_EMAIL, E2E_SENHA } from "./credenciais";

/** Preenche o formulário de login. Por padrão navega até /login; no redirecionamento, não. */
export async function entrar(
  page: Page,
  o: { email?: string; senha?: string; irAoLogin?: boolean } = {},
): Promise<void> {
  if (o.irAoLogin !== false) await page.goto("/login");
  await page.getByLabel("E-mail").fill(o.email ?? E2E_EMAIL);
  await page.getByLabel("Senha").fill(o.senha ?? E2E_SENHA);
  await page.getByRole("button", { name: "Entrar" }).click();
}
