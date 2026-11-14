import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { gerarHash, validarSenha } from "../auth/senha.js";
import { criarCategoriasPadrao } from "../categorias/padrao.js";
import type { Db } from "../db/client.js";
import { titular, usuario } from "../db/schema.js";
import { registrarLog } from "../log.js";

/** Erro com mensagem segura para mostrar a quem executou o comando. */
export class ErroAdmin extends Error {}

export interface DadosAdmin {
  email: string;
  nomeTitular: string;
  senha: string;
}

const esquema = z.object({
  email: z.email({ error: "E-mail inválido" }).max(254),
  nomeTitular: z.string().trim().min(1, "Informe o nome do titular").max(120),
});

// Qualquer número fixo serve: só precisa ser o mesmo em todas as execuções deste comando.
export const TRAVA_PRIMEIRO_ADMIN = 7305;

/**
 * Cria o titular e o primeiro administrador do sistema. Só funciona uma vez:
 * se já existe um admin, recusa. A senha chega por parâmetro (digitada em
 * terminal oculto ou vinda do ambiente) e nunca fica em código, seed ou migração.
 */
export async function criarPrimeiroAdmin(
  db: Db,
  dados: DadosAdmin,
): Promise<{ usuarioId: string; titularId: string; email: string }> {
  const parsed = esquema.safeParse({
    email: dados.email.trim(),
    nomeTitular: dados.nomeTitular,
  });
  if (!parsed.success) {
    throw new ErroAdmin(parsed.error.issues[0]?.message ?? "Dados inválidos");
  }
  const erroSenha = validarSenha(dados.senha);
  if (erroSenha) throw new ErroAdmin(erroSenha);

  const email = parsed.data.email.toLowerCase();
  const senhaHash = await gerarHash(dados.senha);

  try {
    return await db.transaction(async (tx) => {
      // Trava por transação: duas execuções simultâneas não criam dois admins.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${TRAVA_PRIMEIRO_ADMIN})`);

      const [jaExiste] = await tx
        .select({ id: usuario.id })
        .from(usuario)
        .where(eq(usuario.papel, "admin"))
        .limit(1);
      if (jaExiste) {
        throw new ErroAdmin(
          "Já existe um administrador. Novos usuários são criados por convite dentro do sistema.",
        );
      }

      const [t] = await tx
        .insert(titular)
        .values({ nome: parsed.data.nomeTitular })
        .returning({ id: titular.id });
      if (!t) throw new Error("Falha ao criar o titular");

      const [u] = await tx
        .insert(usuario)
        .values({ titularId: t.id, email, senhaHash, papel: "admin" })
        .returning({ id: usuario.id });
      if (!u) throw new Error("Falha ao criar o usuário");

      // O titular do admin também nasce com a árvore padrão de categorias.
      await criarCategoriasPadrao(tx, { titularId: t.id, usuarioId: u.id, ip: "cli" });

      await registrarLog(tx, {
        acao: "admin.criado",
        usuarioId: u.id,
        titularId: t.id,
        entidade: "usuario",
        entidadeId: u.id,
        // Criado pelo comando no servidor, não por uma requisição: não há IP de cliente.
        ip: "cli",
        depois: { email, papel: "admin" },
      });

      return { usuarioId: u.id, titularId: t.id, email };
    });
  } catch (e) {
    const codigo =
      (e as { code?: string }).code ?? (e as { cause?: { code?: string } }).cause?.code;
    if (codigo === "23505") throw new ErroAdmin("Este e-mail já está cadastrado");
    throw e;
  }
}
