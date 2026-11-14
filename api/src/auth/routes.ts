import { timingSafeEqual } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Db } from "../db/client.js";
import { titular, usuario } from "../db/schema.js";
import { registrarLog } from "../log.js";
import { estaBloqueado, registrarTentativa } from "./limite.js";
import { conferirSenha, hashDescartavel } from "./senha.js";
import {
  buscarSessao,
  criarSessao,
  DURACAO_MAXIMA_MS,
  revogarSessao,
  type SessaoAtual,
} from "./sessao.js";

declare module "fastify" {
  interface FastifyRequest {
    /** Sessão do cookie, ou null. Preenchida em todas as requisições. */
    sessao: SessaoAtual | null;
  }
  interface FastifyContextConfig {
    /** Rota pública que não exige token CSRF mesmo que haja sessão aberta (ex.: login, aceitar convite). */
    semCsrf?: boolean;
  }
}

export interface AuthConfig {
  db: Db;
  /** Segredo do servidor usado para proteger os tokens de sessão (mínimo 32 caracteres). */
  segredoSessao: string;
  /** Origem pública do front-end (ex.: https://app.exemplo.com). Usada na checagem de Origin. */
  origemApp: string;
  producao: boolean;
}

const corpoLogin = z.object({
  email: z.string().trim().min(3).max(254),
  senha: z.string().min(1).max(128),
});

const METODOS_SEGUROS = new Set(["GET", "HEAD", "OPTIONS"]);

function iguais(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/** Responde 401 e devolve false se não houver sessão. Use nas rotas protegidas. */
export function exigirLogin(req: FastifyRequest, reply: FastifyReply): req is FastifyRequest & {
  sessao: SessaoAtual;
} {
  if (!req.sessao) {
    void reply.code(401).send({ erro: "Não autenticado" });
    return false;
  }
  return true;
}

/** Exige sessão de administrador: 401 sem login, 403 para outros papéis. */
export function exigirAdmin(req: FastifyRequest, reply: FastifyReply): req is FastifyRequest & {
  sessao: SessaoAtual;
} {
  if (!exigirLogin(req, reply)) return false;
  if (req.sessao.usuario.papel !== "admin") {
    void reply.code(403).send({ erro: "Sem permissão" });
    return false;
  }
  return true;
}

/**
 * Só admin e titular gerenciam usuários e convites. Vinculado recebe 403, mesmo com todas as
 * permissões de módulo: gerir pessoas não é uma permissão de módulo.
 */
export function exigirGestor(req: FastifyRequest, reply: FastifyReply): req is FastifyRequest & {
  sessao: SessaoAtual;
} {
  if (!exigirLogin(req, reply)) return false;
  if (req.sessao.usuario.papel === "vinculado") {
    void reply.code(403).send({ erro: "Sem permissão" });
    return false;
  }
  return true;
}

export function rotasAuth(app: FastifyInstance, cfg: AuthConfig): void {
  const { db } = cfg;
  if (cfg.segredoSessao.length < 32) {
    throw new Error("SESSION_SECRET deve ter pelo menos 32 caracteres");
  }
  // Com HTTPS em produção o prefixo __Host- obriga Secure, Path=/ e proíbe Domain.
  const nomeCookie = cfg.producao ? "__Host-finan_sid" : "finan_sid";
  const opcoesCookie = {
    httpOnly: true,
    secure: cfg.producao,
    sameSite: "strict" as const,
    path: "/",
  };

  app.decorateRequest("sessao", null);

  // 1) Carrega a sessão a partir do cookie.
  app.addHook("onRequest", async (req) => {
    const token = req.cookies[nomeCookie];
    req.sessao = token ? await buscarSessao(db, cfg.segredoSessao, token) : null;
  });

  // 2) Proteção CSRF: Origin (se enviada) precisa ser a do app, e requisição que
  //    altera dados com sessão ativa precisa trazer o token CSRF no cabeçalho.
  app.addHook("preHandler", async (req, reply) => {
    if (METODOS_SEGUROS.has(req.method)) return;
    const origem = req.headers.origin;
    if (origem && origem !== cfg.origemApp) {
      return reply.code(403).send({ erro: "Origem não permitida" });
    }
    if (req.sessao && !req.routeOptions.config.semCsrf) {
      const enviado = req.headers["x-csrf-token"];
      if (typeof enviado !== "string" || !iguais(enviado, req.sessao.csrfToken)) {
        return reply.code(403).send({ erro: "Token CSRF inválido" });
      }
    }
  });

  // 3) Respostas de autenticação, convites e administração nunca vão para cache.
  app.addHook("onSend", async (req, reply) => {
    if (/^\/(auth|convites|admin|usuarios|log|redefinicao|categorias)(\/|\?|$)/.test(req.url)) {
      reply.header("Cache-Control", "no-store");
    }
  });

  app.post("/auth/login", { config: { semCsrf: true } }, async (req, reply) => {
    const corpo = corpoLogin.safeParse(req.body);
    if (!corpo.success) return reply.code(400).send({ erro: "Dados inválidos" });

    const email = corpo.data.email.toLowerCase();
    const ip = req.ip;

    if (await estaBloqueado(db, email, ip)) {
      await registrarLog(db, { acao: "login.bloqueado", ip });
      return reply
        .code(429)
        .send({ erro: "Muitas tentativas. Aguarde alguns minutos e tente de novo." });
    }

    const [encontrado] = await db
      .select({
        id: usuario.id,
        email: usuario.email,
        senhaHash: usuario.senhaHash,
        papel: usuario.papel,
        titularId: usuario.titularId,
        usuarioAtivo: usuario.ativo,
        titularAtivo: titular.ativo,
      })
      .from(usuario)
      .innerJoin(titular, eq(titular.id, usuario.titularId))
      .where(eq(sql`lower(${usuario.email})`, email))
      .limit(1);

    // Sempre confere um hash (real ou descartável) para o tempo não revelar se o e-mail existe.
    const senhaOk = await conferirSenha(
      encontrado?.senhaHash ?? (await hashDescartavel()),
      corpo.data.senha,
    );

    if (!encontrado || !senhaOk || !encontrado.usuarioAtivo || !encontrado.titularAtivo) {
      await registrarTentativa(db, email, ip, false);
      await registrarLog(db, {
        acao: "login.falha",
        usuarioId: encontrado?.id ?? null,
        titularId: encontrado?.titularId ?? null,
        ip,
        depois: {
          motivo: !encontrado
            ? "usuario_inexistente"
            : !senhaOk
              ? "senha_incorreta"
              : "conta_inativa",
        },
      });
      return reply.code(401).send({ erro: "E-mail ou senha incorretos" });
    }

    await registrarTentativa(db, email, ip, true);
    const nova = await criarSessao(db, cfg.segredoSessao, {
      usuarioId: encontrado.id,
      ip,
      userAgent: req.headers["user-agent"],
    });
    await registrarLog(db, {
      acao: "login.sucesso",
      usuarioId: encontrado.id,
      titularId: encontrado.titularId,
      ip,
    });

    reply.setCookie(nomeCookie, nova.token, {
      ...opcoesCookie,
      maxAge: Math.floor(DURACAO_MAXIMA_MS / 1000),
    });
    return {
      usuario: {
        id: encontrado.id,
        email: encontrado.email,
        papel: encontrado.papel,
        titularId: encontrado.titularId,
      },
      csrfToken: nova.csrfToken,
    };
  });

  app.get("/auth/me", async (req, reply) => {
    if (!exigirLogin(req, reply)) return;
    return {
      usuario: req.sessao.usuario,
      permissoes: req.sessao.permissoes,
      csrfToken: req.sessao.csrfToken,
    };
  });

  app.post("/auth/logout", async (req, reply) => {
    if (!exigirLogin(req, reply)) return;
    await revogarSessao(db, req.sessao.sessaoId);
    await registrarLog(db, {
      acao: "logout",
      usuarioId: req.sessao.usuario.id,
      titularId: req.sessao.usuario.titularId,
      ip: req.ip,
    });
    reply.clearCookie(nomeCookie, opcoesCookie);
    return reply.code(204).send();
  });
}
