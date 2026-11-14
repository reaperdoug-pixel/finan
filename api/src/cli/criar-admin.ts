import { createInterface } from "node:readline/promises";
import { ErroAdmin, criarPrimeiroAdmin } from "../admin/primeiro-admin.js";
import { createDb, createPool } from "../db/client.js";
import { loadEnv, requireEnv } from "../env.js";

/** Lê uma linha sem mostrar o que é digitado. Só funciona em terminal interativo. */
function lerSenhaOculta(pergunta: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    if (!stdin.isTTY) {
      reject(new Error("Sem terminal interativo. Rode num terminal ou defina ADMIN_SENHA."));
      return;
    }
    process.stdout.write(pergunta);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let senha = "";

    const terminar = () => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off("data", aoReceber);
      process.stdout.write("\n");
    };
    const aoReceber = (trecho: string) => {
      for (const c of trecho) {
        if (c === "\r" || c === "\n") {
          terminar();
          resolve(senha);
          return;
        }
        if (c === "\u0003") {
          terminar();
          reject(new Error("Cancelado."));
          return;
        }
        if (c === "\u007f" || c === "\b") senha = senha.slice(0, -1);
        else if (c >= " ") senha += c;
      }
    };
    stdin.on("data", aoReceber);
  });
}

function argumento(nome: string): string | undefined {
  const prefixo = `--${nome}=`;
  return process.argv.find((a) => a.startsWith(prefixo))?.slice(prefixo.length);
}

async function perguntar(texto: string, padrao?: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const resposta = (await rl.question(padrao ? `${texto} [${padrao}]: ` : `${texto}: `)).trim();
    return resposta || padrao || "";
  } finally {
    rl.close();
  }
}

async function main(): Promise<void> {
  loadEnv();

  const email =
    argumento("email") ?? process.env.ADMIN_EMAIL ?? (await perguntar("E-mail do administrador"));
  const nomeTitular =
    argumento("titular") ??
    process.env.ADMIN_TITULAR ??
    (await perguntar("Nome do titular", "Administração"));

  // A senha NUNCA vem como argumento de linha de comando (ficaria no histórico e na lista de processos).
  let senha = process.env.ADMIN_SENHA;
  if (!senha) {
    senha = await lerSenhaOculta("Senha (mínimo 10 caracteres): ");
    const confirmacao = await lerSenhaOculta("Repita a senha: ");
    if (senha !== confirmacao) throw new ErroAdmin("As senhas não conferem");
  }

  const pool = createPool(requireEnv("DATABASE_URL"));
  try {
    const criado = await criarPrimeiroAdmin(createDb(pool), { email, nomeTitular, senha });
    console.log(`Administrador criado: ${criado.email}`);
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? `Erro: ${err.message}` : "Erro desconhecido");
  process.exit(1);
});
