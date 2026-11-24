# FINAN

Sistema web de finanças pessoais, multiusuário, em pt-BR e BRL. Monorepo com `web/` (React + Vite), `api/` (Fastify + Drizzle + PostgreSQL) e `shared/`.

- Especificação: `docs/ESPECIFICACAO.md`
- Decisões: `docs/DECISOES.md`
- Como rodar, autenticação e banco: `docs/CONVENCOES.md`
- Backup e faxina de sessões: `docs/BACKUP.md`
- Permissões: `docs/PERMISSOES.md`

## Subir o ambiente

Requer Node 22+ e PostgreSQL. Copie `.env.example` para `.env` e preencha localmente (o `.env` não entra no git; não coloque valores reais no exemplo).

```bash
npm install
npm run db:migrate -w api
npm run dev:api    # http://127.0.0.1:3000
npm run dev:web    # http://localhost:5173 (o proxy manda /api para a API)
```

## Primeiro administrador

```bash
npm run admin:criar
```

Pergunta e-mail, nome do titular e a senha (duas vezes, sem eco). Só funciona uma vez; se já existe um admin, recusa. Os demais usuários entram por convite. Detalhes e variáveis de automação (`ADMIN_EMAIL`, `ADMIN_TITULAR`, `ADMIN_SENHA`) estão em `docs/CONVENCOES.md`. A senha não deve ir como argumento na linha de comando.

## Sessão e login

- A sessão é um cookie opaco `httpOnly`, `SameSite=Strict` (`Secure` e prefixo `__Host-` em produção). O banco guarda só o HMAC do token (`SESSION_SECRET`), nunca o valor em claro.
- Expira após 30 min de inatividade ou 12 h no total. Logout, troca de senha e inativação revogam na hora.
- CSRF: se vier `Origin`, precisa ser `APP_ORIGIN`; pedidos que alteram dados com sessão ativa levam o `X-CSRF-Token`, guardado só em memória no front.
- Limite de tentativas: 5 falhas por e-mail e 20 por IP em 15 min (HTTP 429). A conferência é atômica (trava de transação no e-mail e depois no IP), para uma rajada concorrente não passar do teto. Um login certo zera a contagem daquele e-mail.
- `TRUST_PROXY` lista os proxies cujo `X-Forwarded-For` é aceito. Vazio = só loopback (o Caddy na mesma máquina). Nunca use `true` nem `*`.
- Se a sessão expira ou é revogada no meio do uso, o próximo 401 no front limpa a sessão e o CSRF, leva a `/login` guardando a rota de destino e mostra “Sua sessão expirou. Entre de novo para continuar.” O 401 do próprio `POST /auth/login` (senha errada) e das telas públicas não disparam esse fluxo.
- A faxina de sessões e tentativas antigas (retenção padrão 30 dias, `LIMPEZA_RETENCAO_DIAS`) está em `docs/BACKUP.md`. O log de auditoria não é limpo.

## Variáveis de ambiente

O modelo, sem valores reais, está em `.env.example`. As de uso mais direto:

| Variável | Uso |
|----------|-----|
| `SESSION_SECRET` | Protege o HMAC da sessão (mínimo 32 caracteres aleatórios) |
| `APP_ORIGIN` | Origem do front, usada no CSRF |
| `TRUST_PROXY` | Proxies confiáveis; vazio = loopback |
| `DATABASE_URL` | Papel `finan_app` (dev/produção) |
| `MIGRATE_DATABASE_URL` | Papel `finan_owner` (migrações e faxina) |
| `TEST_DATABASE_URL` / `TEST_MIGRATE_DATABASE_URL` | Só o banco `*_test` |
| `LIMPEZA_RETENCAO_DIAS` | Retenção da faxina (padrão 30) |
| `LOG_LEVEL` | Opcional; padrão `info` (nos testes Vitest, `silent`) |
| `API_PORT` | Padrão 3000 no `dev` |

## Testes

```bash
npm run typecheck
npm run lint
npm test -w shared
npm test -w web
npm test -w api      # Vitest só no finan_test (recria o banco do zero)
npm run test:e2e     # Playwright só no finan_test
```

O E2E não reutiliza o servidor de desenvolvimento (que aponta para `finan_dev`). Sobe a API em `127.0.0.1:3001` e o front em `127.0.0.1:5174`, recusa qualquer banco que não termine em `_test` e usa o Google Chrome já instalado no sistema. Os usuários de fixture são criados no setup. Detalhes em `docs/CONVENCOES.md`.

## Fase futura

A matriz de permissões por papel e módulo já existe no código (`docs/PERMISSOES.md`). A revisão fina dessa matriz fica para uma fase futura.
