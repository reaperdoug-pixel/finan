import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";

export const MENSAGEM_ERRO_INTERNO = "Erro interno";

/**
 * Tratador central. Erros com status 4xx (ex.: JSON malformado, corpo grande demais)
 * seguem o formato padrão do Fastify. Qualquer outro vira 500 genérico: a mensagem
 * original (que pode vir do Postgres) e o stack ficam só no log do servidor, com o reqId.
 */
export function tratarErro(erro: FastifyError, req: FastifyRequest, reply: FastifyReply): void {
  const status = erro.statusCode ?? 500;
  if (status >= 400 && status < 500) {
    void reply.send(erro);
    return;
  }
  req.log.error(
    { err: erro, reqId: req.id, metodo: req.method, url: req.url, headers: req.headers },
    "erro inesperado",
  );
  void reply.code(500).send({ erro: MENSAGEM_ERRO_INTERNO });
}
