import { createDb, createPool } from "../db/client.js";
import { loadEnv, requireEnv } from "../env.js";
import { lerRetencaoDias, limparDadosAntigos } from "../manutencao/limpeza.js";

/**
 * Manutenção diária (finan-limpeza.timer): apaga sessões encerradas e tentativas de login
 * antigas. Conecta com o papel dono (MIGRATE_DATABASE_URL), o único com DELETE.
 */
async function main(): Promise<void> {
  loadEnv();
  const retencao = lerRetencaoDias(process.env.LIMPEZA_RETENCAO_DIAS);
  const pool = createPool(requireEnv("MIGRATE_DATABASE_URL"));
  try {
    const r = await limparDadosAntigos(createDb(pool), retencao);
    console.log(
      `Limpeza concluída (retenção ${retencao} dias): ${r.sessoes} sessões e ${r.tentativas} tentativas apagadas.`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error("Falha na limpeza:", err instanceof Error ? err.message : err);
  process.exit(1);
});
