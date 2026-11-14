# Plano — Fase 1 (base, segurança e núcleo)

Objetivo: sistema seguro e utilizável por você, com login, usuários vinculados, categorias, contas, lançamentos, inativação/reativação e log, publicado na VPS com backup.

Cada tarefa só está pronta quando cumprir seu critério e passar lint, tipos e testes.

| # | Tarefa | Critério de pronto |
|---|--------|--------------------|
| 1 | Esqueleto do monorepo (`web/`, `api/`, tipos compartilhados), lint, tipos, Vitest, scripts | `npm run lint`, `typecheck` e `test` rodam limpos |
| 2 | Banco: PostgreSQL local, Drizzle, migrações, tabelas base com campos comuns | Migração sobe e é idempotente (Drizzle não tem descida; em dev usa-se `db:reset`); log com permissão só de inserção/leitura e gatilho que bloqueia UPDATE/DELETE/TRUNCATE até para o dono. **Concluída.** |
| 3 | Autenticação: login, sessão em cookie, argon2, limite de tentativas, expiração, CSRF | Testes de senha errada, bloqueio por tentativas e expiração. **Concluída** (26 testes em `api/src/auth/auth.test.ts`, validados por mutação). |
| 4 | CLI para criar o primeiro admin | Admin criado sem senha em código ou seed de produção. **Concluída** (`npm run admin:criar`; 9 testes em `api/src/admin/`, validados por mutação). |
| 5 | Convites e titulares: admin convida, cadastro por convite (7 dias, uso único) | Convite expirado/usado é recusado. **Concluída** (23 testes em `api/src/convites/`, validados por mutação). Revogar convite antes do prazo fica para a tarefa 8, junto da reautenticação. |
| 6 | Usuários vinculados e permissões por módulo | Matriz de `PERMISSOES.md` coberta por testes. **Concluída** (97 testes em `auth/permissoes.test.ts` e `usuarios/usuarios.test.ts`, 12 mutações validadas). Linhas de inativar/reativar usuário ficam nas tarefas 8 e 12. |
| 7 | Log de auditoria em toda escrita relevante | Teste prova que a API não consegue alterar nem apagar log. **Concluída** (55 testes em `api/src/auditoria/`, 12 mutações validadas). Entregou também o catálogo fechado de ações, o carimbo de hora no banco e a leitura do log (`GET /log`). A tela do log fica na tarefa 13. |
| 8 | Reautenticação para inativar/reativar | Operação sem senha correta é recusada e registrada. **Concluída** (72 testes em `auth/reautenticacao.test.ts`: as 9 operações sensíveis passam pela mesma bateria; mais `ciclo/` e `redefinicao/`; 18 mutações validadas). Entregou também: inativar/reativar usuários e titulares, revogar convites e redefinição de senha pelo admin. Inativar/reativar categorias, contas e lançamentos ficam nas tarefas 9, 11 e 12, usando os mesmos ajudantes (`confirmarSenha`, `ciclo-de-vida.ts`). |
| 9 | Categorias em árvore (3 níveis, natureza, padrão inicial), regra de inativação | Inativar com lançamento/filha ativa é recusado com motivo. **Concluída** (80 testes em `api/src/categorias/`). Entregou árvore de 3 níveis, natureza, conjunto padrão no titular novo, inativar/reativar com senha e a regra de impedimentos. A tela fica na tarefa 13. A tabela `lancamento` nasceu mínima (só o necessário para a regra); a tarefa 11 a completa. |
| 10 | Contas (carteira, banco, cartão) com saldo inicial | Saldo = saldo inicial + realizados. **Concluída** (54 testes em `api/src/contas/`; inativar/reativar na bateria de `reautenticacao.test.ts`). Entregou carteira/banco/cartão, saldo inicial em centavos, saldo calculado (inicial + realizados ativos; previstos e inativos ficam de fora), inativar só sem lançamento ativo. A tela fica na tarefa 13. Rotas de lançamento continuam na tarefa 11. |
| 11 | Lançamentos: criar, editar, inativar, reativar, filtros | Só em folhas; reativar exige categoria e conta ativas. **Concluída** (38 testes em `api/src/lancamentos/`; inativar/reativar na bateria de `reautenticacao.test.ts`). Entregou criar/editar/inativar/reativar, filtros e paginação, saldo da conta (realizados ativos), só folha (API + gatilho), valor previsto original ao realizar. A tela fica na tarefa 13. Transferência, recorrência e parcelas ficam na Fase 3. |
| 12 | Tela de inativos e reativação | Usuário reativa os próprios; admin reativa tudo. **Concluída** (9 testes em `api/src/inativos/`; as 3 rotas admin de reativar entram na bateria de `reautenticacao.test.ts`). Entregou `GET /inativos`, `GET /admin/inativos` e `POST /admin/{lancamentos,categorias,contas}/:id/reativar` (senha; log no titular afetado). Titular/vinculado reativam os próprios pelas rotas das tarefas 9–11. A tela React fica na tarefa 13 (precisa de login e layout). |
| 13 | Front: login, lançamentos, categorias, contas, inativos, usuários/permissões, log (mobile-first) | Fluxos principais passam no Playwright; nada sensível no bundle. **Concluída** (2 testes Playwright em `e2e/fluxos.spec.ts`: login recusado/aceito, conta, lançamento, inativar e reativar; 5 testes Vitest no `web/`, incluindo varredura do bundle). Telas: login, convite, redefinição, lançamentos, categorias, contas, inativos, pessoas, log e titulares. CSRF só em memória; sessão só no cookie. |
| 14 | Isolamento entre titulares | Teste tenta acessar dado de outro titular em todos os endpoints e falha. **Concluída** (34 testes em `api/src/isolamento/isolamento.test.ts`: catálogo fecha as rotas da API; sem sessão 401; titular/vinculado/admin nas rotas comuns não lêem nem alteram a casa alheia; listas e FKs não vazam). |
| 15 | Deploy na VPS (Node, Postgres, Caddy, systemd, HTTPS) | Sistema acessível por domínio com HTTPS |
| 16 | Backup diário, retenção de 14 dias e cópia externa criptografada | Restauração testada com sucesso. **Scripts prontos** em `deploy/` (ver `docs/BACKUP.md`); falta instalar na VPS, definir o destino externo e testar a restauração completa. |

## Fora desta fase

Resumo, gráficos, orçamento (Fase 2); recorrência, previsão, parcelas, cartão e transferências (Fase 3); anexos e modo escuro (Fase 4).

Antecipados por decisão do produto em 13/11/2026 (decisões 27 e 28): o painel com dados da Fase 1 e o modo escuro automático. O histórico, os arquivos e as pendências estão em `docs/CONTINUIDADE-LAYOUT.md`.

## Pendências encontradas no caminho (ainda sem tarefa)

- ~~**Trocar a própria senha** estando logado~~ **Feito** em 14/11/2026: `POST /auth/senha` (senha atual + nova, encerra as outras sessões, ação `senha.alterada` no log) e modal "Alterar senha" na sidebar.
- ~~**Recuperar a senha do próprio admin**~~ **Feito** em 14/11/2026: `npm run admin:redefinir -- --email=...` (4 testes em `api/src/admin/recuperar.test.ts`). Ver `docs/BACKUP.md`.
- **Tela de convites, usuários, titulares, inativos e log** foi entregue na tarefa 13.

## Dependências abertas

Tarefas 15 e 16 dependem dos dados da VPS e do destino do backup externo (ver `DECISOES.md`).
