import { expect, test } from "@playwright/test";
import { E2E_SENHA } from "./credenciais";
import { entrar } from "./helpers";

test.describe.serial("fluxos principais", () => {
  const sufixo = Date.now().toString(36);
  const categoria = `E2E cat ${sufixo}`;
  const conta = `E2E carteira ${sufixo}`;
  const lancamento = `E2E padaria ${sufixo}`;

  test("recusa senha errada", async ({ page }) => {
    await entrar(page, { senha: "senha-errada-999" });
    await expect(page.getByText("E-mail ou senha incorretos")).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test("entra e registra conta, lançamento, inativa e reativa", async ({ page }) => {
    await entrar(page);
    await expect(page.getByRole("heading", { name: "Painel" })).toBeVisible();

    await page.getByRole("link", { name: "Categorias" }).click();
    await expect(page.getByRole("heading", { name: "Categorias" })).toBeVisible();
    await page.getByRole("button", { name: "Nova categoria raiz" }).click();
    await page.getByLabel("Nome").fill(categoria);
    await page.getByLabel("Tipo").selectOption("despesa");
    await page.getByRole("button", { name: "Salvar" }).click();
    await expect(page.getByText(categoria, { exact: true })).toBeVisible();

    await page.getByRole("link", { name: "Contas" }).click();
    await expect(page.getByRole("heading", { name: "Contas" })).toBeVisible();
    await page.getByRole("button", { name: "Nova conta" }).click();
    await page.getByLabel("Nome").fill(conta);
    await page.getByLabel("Tipo").selectOption("carteira");
    await page.getByLabel("Saldo inicial").fill("100,00");
    await page.getByRole("button", { name: "Salvar" }).click();
    await expect(page.getByText(conta, { exact: true })).toBeVisible();

    await page.getByRole("link", { name: "Lançamentos" }).click();
    await expect(page.getByRole("heading", { name: "Lançamentos" })).toBeVisible();
    await page.getByRole("button", { name: "Novo lançamento" }).click();
    await page.getByLabel("Descrição").fill(lancamento);
    await page.getByLabel("Valor").fill("12,50");
    await page.getByLabel("Categoria").selectOption({ label: `${categoria} (Despesa)` });
    await page.getByLabel("Conta").selectOption({ label: conta });
    await page.getByRole("button", { name: "Salvar" }).click();
    const linha = page.locator("li").filter({ hasText: lancamento });
    await expect(linha).toBeVisible();
    await expect(linha.getByText(/R\$\s*12,50/)).toBeVisible();

    await linha.getByRole("button", { name: "Inativar" }).click();
    await page.getByLabel("Senha").fill(E2E_SENHA);
    await page.getByRole("button", { name: "Confirmar" }).click();
    await expect(linha).toHaveCount(0);

    await page.getByRole("link", { name: "Inativos" }).click();
    await expect(page.getByRole("heading", { name: "Inativos" })).toBeVisible();
    const inativo = page.locator("li").filter({ hasText: lancamento });
    await expect(inativo).toBeVisible();
    await inativo.getByRole("button", { name: "Reativar" }).click();
    await page.getByLabel("Senha").fill(E2E_SENHA);
    await page.getByRole("button", { name: "Confirmar" }).click();
    await expect(inativo).toHaveCount(0);

    await page.getByRole("link", { name: "Lançamentos" }).click();
    await expect(page.getByText(lancamento)).toBeVisible();
  });
});
