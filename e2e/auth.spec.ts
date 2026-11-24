import { expect, test } from "@playwright/test";
import { revogarSessoesDoEmail } from "./banco";
import { E2E_EMAIL, E2E_EMAIL_BLOQUEIO } from "./credenciais";
import { entrar } from "./helpers";

test.describe("autenticação", () => {
  test("login com sucesso leva ao app", async ({ page }) => {
    await entrar(page);
    await expect(page.getByRole("heading", { name: "Painel" })).toBeVisible();
    await expect(page).not.toHaveURL(/\/login/);
  });

  test("senha errada mostra o erro e permanece no login", async ({ page }) => {
    await entrar(page, { senha: "senha-errada-999" });
    await expect(page.getByText("E-mail ou senha incorretos")).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test("logout volta ao login", async ({ page }) => {
    await entrar(page);
    await expect(page.getByRole("heading", { name: "Painel" })).toBeVisible();
    await page.getByRole("banner").getByRole("button", { name: "Sair" }).click();
    await expect(page).toHaveURL(/\/login/);
    await page.goto("/lancamentos");
    await expect(page).toHaveURL(/\/login/);
  });

  test("rota protegida sem sessão vai ao login e volta depois de entrar", async ({ page }) => {
    await page.goto("/lancamentos");
    await expect(page).toHaveURL(/\/login/);
    // Não navega de novo para /login: isso apagaria o destino guardado no state.
    await entrar(page, { irAoLogin: false });
    await expect(page).toHaveURL(/\/lancamentos/);
    await expect(page.getByRole("heading", { name: "Lançamentos" })).toBeVisible();
  });

  test("sessão revogada mostra o aviso e redireciona ao login", async ({ page }) => {
    await entrar(page);
    await expect(page.getByRole("heading", { name: "Painel" })).toBeVisible();
    const n = await revogarSessoesDoEmail(E2E_EMAIL);
    expect(n).toBeGreaterThan(0);
    await page.getByRole("link", { name: "Lançamentos" }).click();
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByText("Sua sessão expirou. Entre de novo para continuar.")).toBeVisible();
  });

  test("bloqueia com 429 após 5 senhas erradas", async ({ page }) => {
    for (let i = 0; i < 5; i++) {
      await entrar(page, { email: E2E_EMAIL_BLOQUEIO, senha: "senha-errada-999" });
      await expect(page.getByText("E-mail ou senha incorretos")).toBeVisible();
    }
    await entrar(page, { email: E2E_EMAIL_BLOQUEIO, senha: "senha-errada-999" });
    await expect(page.getByText("Muitas tentativas. Aguarde alguns minutos e tente de novo.")).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });
});
