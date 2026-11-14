import { ErroAdmin } from "../admin/primeiro-admin.js";
import { gerarLinkDeRecuperacaoDoAdmin } from "../admin/recuperar.js";
import { createDb, createPool } from "../db/client.js";
import { loadEnv, requireEnv } from "../env.js";

function argumento(nome: string): string | undefined {
  const prefixo = `--${nome}=`;
  return process.argv.find((a) => a.startsWith(prefixo))?.slice(prefixo.length);
}

async function main(): Promise<void> {
  loadEnv();
  const email = argumento("email") ?? process.env.ADMIN_EMAIL;
  if (!email) throw new ErroAdmin("Informe o e-mail: npm run admin:redefinir -- --email=voce@exemplo.com");

  const pool = createPool(requireEnv("DATABASE_URL"));
  try {
    const r = await gerarLinkDeRecuperacaoDoAdmin(createDb(pool), {
      email,
      segredoSessao: requireEnv("SESSION_SECRET"),
      origemApp: process.env.APP_ORIGIN ?? "http://localhost:5173",
    });
    console.log(`Link de redefinição para ${r.email} (uso único, vale até ${r.expiraEm.toLocaleString("pt-BR")}):`);
    console.log(r.link);
    console.log("Abra o link no navegador e defina a nova senha. Todas as sessões antigas serão encerradas.");
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? `Erro: ${err.message}` : "Erro desconhecido");
  process.exit(1);
});
