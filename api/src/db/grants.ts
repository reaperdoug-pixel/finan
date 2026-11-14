import type pg from "pg";

/**
 * Permissões do papel usado pela API. Roda depois de toda migração (idempotente).
 *  - Nada de DELETE em nenhuma tabela: nada se apaga, só se inativa.
 *  - Log: apenas SELECT e INSERT.
 * Deve ser executado com o papel dono das tabelas (finan_owner).
 */
export async function applyGrants(owner: pg.Pool, appRole = "finan_app"): Promise<void> {
  if (!/^[a-z_][a-z0-9_]*$/.test(appRole)) {
    throw new Error("Nome de papel inválido");
  }
  const role = `"${appRole}"`;
  await owner.query(`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${role}`);
  await owner.query(`GRANT USAGE ON SCHEMA public TO ${role}`);
  await owner.query(`GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO ${role}`);
  // Tabelas só de inclusão para a API.
  await owner.query(`REVOKE UPDATE ON TABLE log FROM ${role}`);
  await owner.query(`REVOKE UPDATE ON TABLE tentativa_login FROM ${role}`);
}
