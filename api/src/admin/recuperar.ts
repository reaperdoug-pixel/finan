import { and, eq, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { titular, usuario } from "../db/schema.js";
import { criarRedefinicao } from "../redefinicao/servico.js";
import { ErroAdmin } from "./primeiro-admin.js";

/**
 * Recuperação da senha de um ADMIN, para quem tem acesso ao servidor (ninguém mais pode
 * pedir o link a ele). Gera um link de redefinição de uso único, válido por 24 h, e o grava no log
 * (`redefinicao.criada`, `via: "cli"`). Ninguém passa a saber a senha: o admin a define pelo link.
 *
 * Só vale para administradores ativos. Os demais usuários pedem o link ao admin pela tela.
 */
export async function gerarLinkDeRecuperacaoDoAdmin(
  db: Db,
  p: { email: string; segredoSessao: string; origemApp: string },
): Promise<{ link: string; expiraEm: Date; email: string }> {
  const email = p.email.trim().toLowerCase();
  const [admin] = await db
    .select({ id: usuario.id })
    .from(usuario)
    .innerJoin(titular, eq(titular.id, usuario.titularId))
    .where(
      and(
        eq(sql`lower(${usuario.email})`, email),
        eq(usuario.papel, "admin"),
        eq(usuario.ativo, true),
        eq(titular.ativo, true),
      ),
    )
    .limit(1);
  if (!admin) throw new ErroAdmin("Nenhum administrador ativo com esse e-mail");

  const r = await criarRedefinicao(db, p.segredoSessao, {
    usuarioId: admin.id,
    porUsuarioId: admin.id,
    ip: "127.0.0.1",
    via: "cli",
  });
  return { link: `${p.origemApp}/redefinicao/${r.token}`, expiraEm: r.expiraEm, email: r.email };
}
