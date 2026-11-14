import cookie from "@fastify/cookie";
import Fastify, { type FastifyInstance } from "fastify";
import { rotasAuditoria } from "./auditoria/routes.js";
import { rotasAuth, type AuthConfig } from "./auth/routes.js";
import { rotasTrocarSenha } from "./auth/trocar-senha.js";
import { rotasConvites } from "./convites/routes.js";
import { rotasAdmin } from "./admin/routes.js";
import { rotasCategorias } from "./categorias/routes.js";
import { rotasContas } from "./contas/routes.js";
import { rotasLancamentos } from "./lancamentos/routes.js";
import { rotasInativos } from "./inativos/routes.js";
import { rotasPainel } from "./painel/routes.js";
import { rotasRedefinicao } from "./redefinicao/routes.js";
import { rotasCicloDeUsuarios } from "./usuarios/ciclo-routes.js";
import { rotasUsuarios } from "./usuarios/routes.js";

export type AppConfig = AuthConfig;

export function buildApp(cfg: AppConfig): FastifyInstance {
  // trustProxy: a API só escuta em 127.0.0.1, então o único cliente direto é o
  // proxy (Caddy), que informa o IP real. Necessário para o limite de tentativas por IP.
  const app = Fastify({ logger: false, trustProxy: true });

  // Toda resposta da API leva cabeçalhos de segurança. Dado financeiro nunca vai para cache.
  // CSP e HSTS da página ficam no Caddy (ver deploy/Caddyfile.exemplo).
  app.addHook("onSend", async (req, reply) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Frame-Options", "DENY");
    reply.header("Referrer-Policy", "no-referrer");
    reply.header("Cross-Origin-Resource-Policy", "same-origin");
    reply.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    if (req.url !== "/health") reply.header("Cache-Control", "no-store");
  });

  void app.register(cookie);
  // O plugin do cookie precisa estar carregado antes de rotasAuth usar req.cookies.
  app.register(async (instancia) => {
    rotasAuth(instancia, cfg);
    rotasTrocarSenha(instancia, cfg);
    // Mesmo plugin: assim os hooks de sessão e CSRF também valem para as rotas de convite.
    rotasConvites(instancia, cfg);
    rotasUsuarios(instancia, cfg);
    rotasAuditoria(instancia, cfg);
    rotasCicloDeUsuarios(instancia, cfg);
    rotasAdmin(instancia, cfg);
    rotasRedefinicao(instancia, cfg);
    rotasCategorias(instancia, cfg);
    rotasContas(instancia, cfg);
    rotasLancamentos(instancia, cfg);
    rotasInativos(instancia, cfg);
    rotasPainel(instancia, cfg);
  });

  app.get("/health", async () => ({ status: "ok" }));

  return app;
}
