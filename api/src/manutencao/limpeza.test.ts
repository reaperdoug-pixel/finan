import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb } from "../db/client.js";
import { criarAmbiente, inserirUsuario, type Ambiente } from "../../test/ajudantes.js";
import { lerRetencaoDias, limparDadosAntigos, RETENCAO_PADRAO_DIAS } from "./limpeza.js";

const DIA = 24 * 60 * 60 * 1000;
const HORA = 60 * 60 * 1000;

describe("lerRetencaoDias", () => {
  it("padrão de 30 dias e valores válidos", () => {
    expect(lerRetencaoDias(undefined)).toBe(RETENCAO_PADRAO_DIAS);
    expect(lerRetencaoDias("")).toBe(RETENCAO_PADRAO_DIAS);
    expect(lerRetencaoDias("7")).toBe(7);
  });
  it("recusa valores inválidos", () => {
    for (const v of ["0", "-1", "1.5", "abc", "99999"]) expect(() => lerRetencaoDias(v)).toThrow();
  });
});

describe("limparDadosAntigos", () => {
  let env: Ambiente;
  beforeAll(async () => {
    env = await criarAmbiente(98);
  });
  afterAll(async () => {
    await env.fechar();
  });

  const agora = new Date();
  const antes = (ms: number) => new Date(agora.getTime() - ms);

  async function sessao(usuarioId: string, criada: Date, ultimo: Date, revogada: Date | null) {
    const r = await env.owner.query<{ id: string }>(
      `INSERT INTO sessao (usuario_id, token_hash, csrf_token, criada_em, ultimo_acesso, revogada_em)
       VALUES ($1, $2, 'csrf', $3, $4, $5) RETURNING id`,
      [usuarioId, randomUUID(), criada, ultimo, revogada],
    );
    return r.rows[0]!.id;
  }
  async function tentativa(quando: Date) {
    const r = await env.owner.query<{ id: string }>(
      `INSERT INTO tentativa_login (email_minusculo, ip, sucesso, ocorrido_em) VALUES ($1, '10.98.0.1', false, $2) RETURNING id`,
      [env.novoEmail(), quando],
    );
    return r.rows[0]!.id;
  }
  const existe = async (tabela: "sessao" | "tentativa_login", id: string) =>
    (await env.owner.query(`SELECT 1 FROM ${tabela} WHERE id = $1`, [id])).rowCount === 1;

  it("apaga só o que é velho e preserva sessões válidas e tentativas recentes", async () => {
    const u = await inserirUsuario(env, { papel: "titular" });

    const valida = await sessao(u.id, antes(10 * 60 * 1000), antes(60 * 1000), null);
    const revogadaRecente = await sessao(u.id, antes(2 * DIA), antes(2 * DIA), antes(DIA));
    const expiradaRecente = await sessao(u.id, antes(5 * DIA), antes(5 * DIA), null);
    const revogadaVelha = await sessao(u.id, antes(40 * DIA), antes(40 * DIA), antes(31 * DIA));
    const expiradaVelha = await sessao(u.id, antes(31 * DIA), antes(31 * DIA), null);

    const tentativaNaJanela = await tentativa(antes(5 * 60 * 1000));
    const tentativaRecente = await tentativa(antes(29 * DIA));
    const tentativaVelha = await tentativa(antes(31 * DIA));

    const r = await limparDadosAntigos(createDb(env.owner), 30, agora);
    expect(r.sessoes).toBeGreaterThanOrEqual(2);
    expect(r.tentativas).toBeGreaterThanOrEqual(1);

    for (const id of [valida, revogadaRecente, expiradaRecente]) expect(await existe("sessao", id)).toBe(true);
    for (const id of [revogadaVelha, expiradaVelha]) expect(await existe("sessao", id)).toBe(false);
    for (const id of [tentativaNaJanela, tentativaRecente]) expect(await existe("tentativa_login", id)).toBe(true);
    expect(await existe("tentativa_login", tentativaVelha)).toBe(false);
  });

  it("sessão criada há 30 dias e poucas horas, ainda dentro da duração máxima somada, é mantida", async () => {
    const u = await inserirUsuario(env, { papel: "titular" });
    const noLimite = await sessao(u.id, antes(30 * DIA + 6 * HORA), antes(30 * DIA), null);
    await limparDadosAntigos(createDb(env.owner), 30, agora);
    expect(await existe("sessao", noLimite)).toBe(true);
  });

  it("o papel da API não consegue apagar (só o dono limpa)", async () => {
    await expect(limparDadosAntigos(createDb(env.appPool), 30, agora)).rejects.toThrow();
  });
});
