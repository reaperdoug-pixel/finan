import cookie from "@fastify/cookie";
import Fastify, { LogController, type FastifyInstance } from "fastify";
import { rotasAuditoria } from "./auditoria/routes.js";
import { rotasAuth, type AuthConfig } from "./auth/routes.js";
import { rotasTrocarSenha } from "./auth/trocar-senha.js";
import { rotasConvites } from "./convites/routes.js";
import { rotasAdmin } from "./admin/routes.js";
import { rotasCategorias } from "./categorias/routes.js";
import { rotasContas } from "./contas/routes.js";
import { rotasContatos } from "./contatos/routes.js";
import { rotasLancamentos } from "./lancamentos/routes.js";
import { rotasInativos } from "./inativos/routes.js";
import { rotasPainel } from "./painel/routes.js";
import { rotasRedefinicao } from "./redefinicao/routes.js";
import { rotasCicloDeUsuarios } from "./usuarios/ciclo-routes.js";
import { rotasUsuarios } from "./usuarios/routes.js";
import { tratarErro } from "./erros.js";
import { opcoesLogger } from "./logger.js";
import { PROXIES_PADRAO } from "./proxy.js";

export interface AppConfig extends AuthConfig {
  /** Só para testes: destino do log (padrão: stdout) e nível. */
  log?: { stream?: NodeJS.WritableStream; nivel?: string };
  /** IPs/CIDRs dos proxies cujo X-Forwarded-For é aceito. Padrão: só loopback (Caddy local). */
  proxiesConfiaveis?: readonly string[];
}

export function buildApp(cfg: AppConfig): FastifyInstance {
  // trustProxy: só o proxy local (Caddy) informa o IP real via X-Forwarded-For.
  // De qualquer outro endereço o cabeçalho é ignorado, e o limite por IP usa o IP da conexão.
  const app = Fastify({
    logger: opcoesLogger(cfg.log?.stream, cfg.log?.nivel),
    // Sem uma linha de log por requisição (mesmo comportamento do antigo disableRequestLogging).
    logController: new LogController({ disableRequestLogging: true }),
    trustProxy: [...(cfg.proxiesConfiaveis ?? PROXIES_PADRAO)],
  });

  app.setErrorHandler(tratarErro);

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
    rotasContatos(instancia, cfg);
    rotasLancamentos(instancia, cfg);
    rotasInativos(instancia, cfg);
    rotasPainel(instancia, cfg);
  });

  app.get("/health", async () => ({ status: "ok" }));

  return app;
}
