# FINAN — regras para agentes

Sistema web de finanças pessoais, multiusuário. Fonte da verdade: `docs/ESPECIFICACAO.md`. Decisões: `docs/DECISOES.md`. Permissões: `docs/PERMISSOES.md`. Convenções: `docs/CONVENCOES.md`. Plano atual: `docs/PLANO-FASE-1.md`.

Se algo pedido contradiz a especificação, pare e pergunte. Não reabra decisões registradas em `DECISOES.md`.

## Regras inegociáveis

1. **Front-end sem nada sensível.** Nenhum usuário, senha, token, seed ou dado de teste no bundle. Nenhum segredo em `VITE_*`. Nada em `localStorage`/`sessionStorage`. Sessão só em cookie `httpOnly`, `Secure`, `SameSite`.
2. **Toda validação e autorização na API.** O front só exibe. Nunca confie em dado vindo do cliente.
3. **Isolamento por titular.** Toda consulta e escrita filtra por `titular_id` no servidor. Sem exceção, sem atalho "só para teste".
4. **Nada se apaga.** Proibido `DELETE` físico em dados de negócio. "Excluir" = inativar (`ativo`, `inativado_em`, `inativado_por`).
5. **Inativar e reativar exigem reautenticação com senha** e geram log com quem confirmou. Use `confirmarSenha` (`api/src/auth/reautenticacao.ts`) e `camposInativacao`/`camposReativacao` (`api/src/ciclo-de-vida.ts`); toda rota nova que pede senha entra na bateria de `auth/reautenticacao.test.ts`.
6. **Ordem de inativação:** lançamentos → subcategorias → categoria. A API recusa e explica o motivo.
7. **Log de auditoria só de inclusão.** O usuário de banco da API só tem `INSERT`/`SELECT` na tabela de log. Toda escrita relevante gera log (quem, quando, IP, antes/depois, titular). A ação precisa estar no catálogo `api/src/log-acoes.ts` (escrita nova = ação nova, com teste que a exercita). Nunca grave senha, hash ou token no log.
8. **Dinheiro em centavos (inteiro).** Nunca `float`. Moeda BRL, interface pt-BR, fuso `America/Sao_Paulo`.
9. **Segredos só em variáveis de ambiente no servidor**, nunca no repositório. Testes automatizados usam só o banco `*_test`; uso manual fica no `finan_dev`. Nunca produção.
10. **Primeiro admin criado por CLI**, nunca em código ou seed de produção.

## Como trabalhar

- Siga o plano da fase atual; não antecipe funcionalidades de fases futuras.
- Teste primeiro nas áreas de segurança: isolamento entre titulares, permissões, regra de inativação, reautenticação e imutabilidade do log. Mudança nelas sem teste não é aceita.
- Mudanças de esquema só por migração versionada.
- Não adicione dependência sem justificar no PR/commit.
- Ao terminar uma tarefa, rode lint, tipos e testes e informe o resultado real.
