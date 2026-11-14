import { randomBytes } from "node:crypto";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { hashDoToken } from "../auth/sessao.js";
import { gerarHash, validarSenha } from "../auth/senha.js";
import type { Db } from "../db/client.js";
import { gravarPermissoes, lerPermissoes, type Permissoes } from "../auth/permissoes.js";
import { criarCategoriasPadrao } from "../categorias/padrao.js";
import { convite, titular, usuario } from "../db/schema.js";
import { registrarLog } from "../log.js";

export const VALIDADE_CONVITE_MS = 7 * 24 * 60 * 60 * 1000;

export type CodigoErroConvite =
  | "invalido" // não existe, expirou ou já foi usado (propositalmente indistinguíveis)
  | "email_cadastrado"
  | "pendente_existente"
  | "senha_invalida";

/** Erro com mensagem segura para devolver ao cliente. */
export class ErroConvite extends Error {
  constructor(
    readonly codigo: CodigoErroConvite,
    mensagem: string,
  ) {
    super(mensagem);
  }
}

const MSG_INVALIDO = "Convite inválido ou expirado";

function codigoPg(e: unknown): string | undefined {
  return (e as { code?: string }).code ?? (e as { cause?: { code?: string } }).cause?.code;
}

export interface NovoConvite {
  email: string;
  /** Nome do titular (no convite de titular, o nome que ele terá; no de vinculado, o do titular de destino). */
  nomeTitular: string;
  criadoPor: string;
  /** Titular de quem está criando o convite (para o log). */
  titularDoAdmin: string;
  ip: string;
  /** Convite de usuário vinculado: titular de destino e permissões iniciais. Sem isto, é convite de titular. */
  vinculado?: { titularId: string; permissoes: Permissoes };
  /** Quem confirmou a operação com a senha, quando exigido. */
  confirmadoPor?: string;
}

/** Cria um convite de titular. O token só existe na resposta: o banco guarda apenas o HMAC. */
export async function criarConvite(
  db: Db,
  segredo: string,
  dados: NovoConvite,
): Promise<{ id: string; token: string; expiraEm: Date }> {
  const email = dados.email.trim().toLowerCase();

  return db.transaction(async (tx) => {
    const [jaCadastrado] = await tx
      .select({ id: usuario.id })
      .from(usuario)
      .where(eq(sql`lower(${usuario.email})`, email))
      .limit(1);
    if (jaCadastrado) {
      throw new ErroConvite("email_cadastrado", "Este e-mail já está cadastrado");
    }

    const [pendente] = await tx
      .select({ id: convite.id })
      .from(convite)
      .where(
        and(
          eq(sql`lower(${convite.email})`, email),
          isNull(convite.usadoEm),
          isNull(convite.revogadoEm),
          gt(convite.expiraEm, sql`now()`),
        ),
      )
      .limit(1);
    if (pendente) {
      throw new ErroConvite("pendente_existente", "Já existe um convite pendente para este e-mail");
    }

    const token = randomBytes(32).toString("base64url");
    const expiraEm = new Date(Date.now() + VALIDADE_CONVITE_MS);
    const [linha] = await tx
      .insert(convite)
      .values({
        email,
        papel: dados.vinculado ? "vinculado" : "titular",
        nomeTitular: dados.nomeTitular,
        titularId: dados.vinculado?.titularId ?? null,
        permissoes: dados.vinculado?.permissoes ?? null,
        tokenHash: hashDoToken(token, segredo),
        expiraEm,
        criadoPor: dados.criadoPor,
      })
      .returning({ id: convite.id });
    if (!linha) throw new Error("Falha ao criar o convite");

    await registrarLog(tx, {
      acao: "convite.criado",
      usuarioId: dados.criadoPor,
      titularId: dados.vinculado?.titularId ?? dados.titularDoAdmin,
      entidade: "convite",
      entidadeId: linha.id,
      ip: dados.ip,
      confirmadoPor: dados.confirmadoPor ?? null,
      depois: {
        email,
        papel: dados.vinculado ? "vinculado" : "titular",
        nomeTitular: dados.nomeTitular,
        expiraEm,
        ...(dados.vinculado ? { permissoes: dados.vinculado.permissoes } : {}),
      },
    });

    return { id: linha.id, token, expiraEm };
  });
}

/** Convite que ainda pode ser usado: existe, não foi usado e não expirou. */
export async function buscarConviteValido(
  db: Db,
  segredo: string,
  token: string,
): Promise<{ email: string; nomeTitular: string } | null> {
  if (token.length < 20 || token.length > 200) return null;
  const [c] = await db
    .select({ email: convite.email, nomeTitular: convite.nomeTitular })
    .from(convite)
    .where(
      and(
        eq(convite.tokenHash, hashDoToken(token, segredo)),
        isNull(convite.usadoEm),
          isNull(convite.revogadoEm),
        gt(convite.expiraEm, sql`now()`),
      ),
    )
    .limit(1);
  return c ?? null;
}

export async function listarConvites(db: Db) {
  const linhas = await db
    .select({
      id: convite.id,
      email: convite.email,
      papel: convite.papel,
      nomeTitular: convite.nomeTitular,
      criadoEm: convite.criadoEm,
      expiraEm: convite.expiraEm,
      usadoEm: convite.usadoEm,
      revogadoEm: convite.revogadoEm,
    })
    .from(convite)
    .orderBy(desc(convite.criadoEm))
    .limit(200);
  const agora = Date.now();
  return linhas.map((l) => ({
    ...l,
    status: l.usadoEm
      ? "usado"
      : l.revogadoEm
        ? "revogado"
        : l.expiraEm.getTime() <= agora
          ? "expirado"
          : "pendente",
  }));
}

export type ResultadoRevogacao =
  | { ok: true }
  | { ok: false; codigo: "nao_encontrado" | "ja_usado" | "ja_revogado" | "expirado" };

/**
 * Cancela um convite que ainda não foi usado (nada se apaga: fica marcado como revogado).
 * `escopoTitularId`: quando informado, só convites daquele titular são encontrados.
 * A confirmação com a senha de quem opera é feita antes, na rota.
 */
export async function revogarConvite(
  db: Db,
  p: {
    conviteId: string;
    porUsuarioId: string;
    titularDoOperador: string;
    ip: string;
    escopoTitularId?: string;
  },
): Promise<ResultadoRevogacao> {
  return db.transaction(async (tx) => {
    const [c] = await tx.select().from(convite).where(eq(convite.id, p.conviteId)).for("update");
    // Convite de outro titular responde "não encontrado", para não revelar que existe.
    if (!c || (p.escopoTitularId && c.titularId !== p.escopoTitularId)) {
      return { ok: false, codigo: "nao_encontrado" } as const;
    }
    if (c.usadoEm) return { ok: false, codigo: "ja_usado" } as const;
    if (c.revogadoEm) return { ok: false, codigo: "ja_revogado" } as const;
    if (c.expiraEm.getTime() <= Date.now()) return { ok: false, codigo: "expirado" } as const;

    await tx
      .update(convite)
      .set({ revogadoEm: new Date(), revogadoPor: p.porUsuarioId })
      .where(eq(convite.id, c.id));

    await registrarLog(tx, {
      acao: "convite.revogado",
      usuarioId: p.porUsuarioId,
      titularId: c.titularId ?? p.titularDoOperador,
      entidade: "convite",
      entidadeId: c.id,
      ip: p.ip,
      confirmadoPor: p.porUsuarioId,
      antes: { status: "pendente" },
      depois: { status: "revogado", email: c.email, papel: c.papel },
    });
    return { ok: true } as const;
  });
}

/**
 * Consome o convite e cria titular + usuário. A linha do convite fica travada
 * (FOR UPDATE) até o fim da transação, então dois cadastros simultâneos com o
 * mesmo link nunca passam os dois.
 */
export async function aceitarConvite(
  db: Db,
  segredo: string,
  token: string,
  senha: string,
  ip: string,
): Promise<{ email: string }> {
  // Checagem barata antes do hash (que custa CPU): token inexistente não gasta nada.
  if (!(await buscarConviteValido(db, segredo, token))) {
    throw new ErroConvite("invalido", MSG_INVALIDO);
  }
  const erroSenha = validarSenha(senha);
  if (erroSenha) throw new ErroConvite("senha_invalida", erroSenha);
  const senhaHash = await gerarHash(senha);

  try {
    return await db.transaction(async (tx) => {
      const [c] = await tx
        .select()
        .from(convite)
        .where(
          and(
            eq(convite.tokenHash, hashDoToken(token, segredo)),
            isNull(convite.usadoEm),
          isNull(convite.revogadoEm),
            gt(convite.expiraEm, sql`now()`),
          ),
        )
        .for("update");
      if (!c) throw new ErroConvite("invalido", MSG_INVALIDO);

      let t: { id: string };
      let permissoes: Permissoes | null = null;
      if (c.papel === "titular") {
        const [novo] = await tx
          .insert(titular)
          .values({ nome: c.nomeTitular, criadoPor: c.criadoPor })
          .returning({ id: titular.id });
        if (!novo) throw new Error("Falha ao criar o titular");
        t = novo;
      } else if (c.papel === "vinculado" && c.titularId) {
        // O titular de destino precisa continuar ativo e as permissões guardadas, válidas.
        permissoes = lerPermissoes(c.permissoes);
        const [destino] = await tx
          .select({ id: titular.id, ativo: titular.ativo })
          .from(titular)
          .where(eq(titular.id, c.titularId));
        if (!permissoes || !destino || !destino.ativo) {
          throw new ErroConvite("invalido", MSG_INVALIDO);
        }
        t = { id: destino.id };
      } else {
        throw new ErroConvite("invalido", MSG_INVALIDO);
      }

      const [u] = await tx
        .insert(usuario)
        .values({
          titularId: t.id,
          email: c.email,
          senhaHash,
          papel: c.papel,
          criadoPor: c.criadoPor,
        })
        .returning({ id: usuario.id });
      if (!u) throw new Error("Falha ao criar o usuário");
      if (permissoes) await gravarPermissoes(tx, u.id, permissoes);
      // Titular novo já nasce com a árvore padrão de categorias (na mesma transação).
      if (c.papel === "titular") {
        await criarCategoriasPadrao(tx, { titularId: t.id, usuarioId: u.id, ip });
      }

      await tx
        .update(convite)
        .set({ usadoEm: new Date(), usadoPor: u.id })
        .where(eq(convite.id, c.id));

      await registrarLog(tx, {
        acao: "convite.aceito",
        usuarioId: u.id,
        titularId: t.id,
        entidade: "convite",
        entidadeId: c.id,
        ip,
        depois: { email: c.email, papel: c.papel },
      });

      return { email: c.email };
    });
  } catch (e) {
    if (codigoPg(e) === "23505") {
      throw new ErroConvite("email_cadastrado", "Este e-mail já está cadastrado");
    }
    throw e;
  }
}
