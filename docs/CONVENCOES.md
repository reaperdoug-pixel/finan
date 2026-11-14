# Convenções

## Estrutura

```
FINAN/
  CLAUDE.md
  docs/
  web/          React + Vite + TypeScript
  api/          Fastify + TypeScript + Drizzle
  shared/       tipos e esquemas de validação compartilhados
```

## Código

- TypeScript estrito (`strict: true`), sem `any` sem justificativa.
- Validação de entrada na API com esquemas (Zod); os mesmos tipos alimentam o front.
- Dinheiro sempre em centavos (inteiro). Datas de lançamento sem hora, fuso `America/Sao_Paulo`.
- Nomes de tabelas e colunas em português, minúsculas com underscore (`lancamento`, `inativado_em`). Nomes de código em inglês técnico quando for termo de programação, em português quando for domínio.
- IDs UUID. Toda tabela de negócio: `ativo`, `inativado_em`, `inativado_por`, `criado_por`, `criado_em`, `atualizado_em`.
- Proibido `DELETE` físico em dados de negócio.

## Banco

- Mudanças só por migração versionada, nunca por alteração manual.
- Usuário de banco da API sem `UPDATE`/`DELETE` na tabela de log.
- Dados de teste só em dev, via script de seed que se recusa a rodar em produção.

## Git

- Branch principal protegida; trabalho em branches curtas (`fase1/auth`, `fase1/categorias`).
- Commits no padrão Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`, `chore:`).
- Nenhum segredo no repositório; `.env` fora do controle de versão, com `.env.example` sem valores reais.

## Testes

- Vitest para regras de negócio e API; Playwright para fluxos críticos no navegador.
- Mudança nas regras de segurança (isolamento, permissões, inativação, reautenticação, log) exige teste junto.
- Pronto significa: lint, tipos e testes passando.

## Rodar o projeto

Requer Node 22+ (testado com Node 26) e npm 11.

```bash
npm install            # instala todos os pacotes (workspaces)
npm run lint           # ESLint em todo o repositório
npm run typecheck      # tsc em shared, api e web
npm run test           # Vitest em todos os pacotes
npm run test:e2e       # Playwright (sobe API+front se não estiverem no ar)
npm run build          # build de produção do front
npm run dev:api        # API em http://127.0.0.1:3000 (variável API_PORT)
npm run dev:web        # front em http://localhost:5173 (proxy /api -> API)
```

Na primeira vez: `npx playwright install chromium`. O setup do e2e cria `e2e-titular@finan.test` no banco de desenvolvimento (fora do bundle).

### Front (web/)

- React 18 + Vite; em dev o proxy manda `/api` para a API. Sessão só no cookie `httpOnly`; o CSRF fica em memória (`web/src/api.ts`). Nada de `localStorage`/`sessionStorage`/`VITE_`.
- Telas: login, convite, redefinição de senha, painel (página inicial), lançamentos, categorias, contas, inativos, pessoas (vinculados), log e titulares (admin). Mobile-first: navegação embaixo no telefone, ao lado a partir de 800px.
- Visual (decisão 30): tokens no topo de `web/src/estilo.css` (claro e escuro). Fundo em camadas com `radial-gradient` no `body` (barato, sem imagem). Cartões de vidro no fim do arquivo, com `backdrop-filter` só dentro de `@supports`; sem suporte, voltam à cor sólida. O bloco `.pn-hero` redefine as variáveis de cor localmente (`--hero-*`): o que está dentro dele usa os mesmos nomes de variável. Marca em `componentes/MarcaFinan.tsx`; ícones de traço 1,75 px em `componentes/Icones.tsx`.
- Playwright em `e2e/` (fora de `web/`). Credenciais de teste só no setup Node.

### Painel (api/src/painel)

- `GET /painel?mes=AAAA-MM` (padrão: mês atual em São Paulo). Somente leitura: não grava nada e não gera log. Exige `ver` em lançamentos.
- Conta só lançamento **ativo e realizado**. Previstos aparecem à parte (`previstosDoMes`, `atrasados`: previsto com data anterior a hoje). Tudo filtra por `titular_id` e vem em centavos.
- Devolve o mês e o anterior, a série dos últimos 6 meses, despesas e receitas por categoria-raiz (mês e anterior), despesas fixas × variáveis (`despesasPorNatureza`, sem nomes de categoria), saldo por conta e movimento do mês por conta (`movimentoPorConta`).
- `despesasPorCategoria`, `receitasPorCategoria`, `contas` e `movimentoPorConta` vêm `null` se o usuário não tem `ver` em categorias/contas; nunca vêm com dados parciais.
- Os avisos ("o que pede decisão") são derivados no front, em `web/src/painel-alertas.ts` (com teste), só comparando o que a API devolveu: conta no negativo, saldo que não cobre os previstos, despesas acima das receitas, previstos atrasados e categoria que subiu 20% e R$ 50 ou mais. O painel mostra os 4 mais graves.
- Leituras derivadas no front, em `web/src/painel-insights.ts` (com teste): fôlego do saldo (saldo ÷ gasto médio diário; mês corrente usa os dias decorridos) e a frase de destaque das categorias.
- A rota está no catálogo de `isolamento/isolamento.test.ts`; testes próprios em `painel/painel.test.ts`.

### Autenticação (api/src/auth)

- Login em `POST /auth/login`; `GET /auth/me`; `POST /auth/logout`. Respostas de `/auth/*` saem com `Cache-Control: no-store`.
- Sessão em cookie `httpOnly`, `SameSite=Strict` (`Secure` e prefixo `__Host-` em produção). O banco guarda só o HMAC do token (usa `SESSION_SECRET`).
- Expira em 30 min de inatividade ou 12 h no total; inativar usuário ou titular derruba a sessão.
- Limite: 5 falhas por e-mail e 20 por IP em 15 min (bloqueio devolve 429). Login certo zera a contagem do e-mail.
- CSRF: requisição que altera dados com sessão precisa do cabeçalho `X-CSRF-Token` (valor devolvido no login e em `/auth/me`, guardado só em memória no front). Se vier `Origin`, precisa ser `APP_ORIGIN`.
- Rotas protegidas usam `exigirLogin(req, reply)` de `auth/routes.ts`. Todo login, falha, bloqueio e logout vai para o log.

### Convites (api/src/convites)

- **Admin** cria convite de titular: `POST /admin/convites` `{ email, nomeTitular }` devolve o `link` (`{APP_ORIGIN}/convite/{token}`) **uma única vez**. Lista em `GET /admin/convites` (status pendente, usado ou expirado; nunca mostra token). Entrega do link é manual.
- O banco guarda só o HMAC do token. Validade de 7 dias, uso único.
- **Quem recebeu o link** (sem conta): `GET /convites/:token` confere e mostra e-mail e nome; `POST /convites/:token/aceitar` `{ senha }` cria titular e usuário. Depois faz login normalmente (o cadastro não abre sessão sozinho).
- Convite inexistente, expirado e já usado dão a **mesma** resposta 404, para não revelar qual é o caso.
- A linha do convite fica travada (`FOR UPDATE`) durante o cadastro: dois cadastros com o mesmo link nunca passam os dois.
- Senha fraca (400) ou e-mail já cadastrado (409) não consomem o convite; nada fica pela metade (transação).
- Rotas públicas usam `config: { semCsrf: true }`; todas as demais rotas com sessão exigem o token CSRF.
- Tentativas com convite inválido não vão para o log (não há usuário identificado e qualquer um poderia encher a tabela, que não aceita apagar).
- A tabela já comporta convite de usuário vinculado (`papel`, `titular_id`) para a tarefa 6.

### Inativar, reativar e redefinir (nada se apaga; tudo com a senha de quem opera)

- **Senha de confirmação:** toda operação sensível chama `confirmarSenha(db, req, reply, senha)` (`auth/reautenticacao.ts`): 400 sem senha, 403 senha errada, 429 muitas tentativas (mesmo limite do login). Falhas viram `reautenticacao.falha` / `.bloqueada` no log; o sucesso grava `confirmado_por`. **Rota nova que pede senha entra na lista de `auth/reautenticacao.test.ts`**, que aplica a mesma bateria a todas.
- **Campos de estado:** `camposInativacao(usuarioId)` e `camposReativacao()` (`ciclo-de-vida.ts`) são o jeito padrão de inativar e reativar qualquer tabela de negócio. Nunca `DELETE`.
- **Usuários:** `POST /usuarios/:id/inativar` e `/reativar` `{ senha }`. Admin: qualquer usuário (menos ele mesmo). Titular: só os próprios vinculados. Vinculado: 403. Inativar derruba as sessões. Não se reativa usuário de titular inativo (409). Usuário de outro titular responde 404.
- **Titulares (só admin):** `GET /admin/titulares?busca=&limite=&pagina=`, `POST /admin/titulares/:id/inativar` e `/reativar`. Inativar o titular corta o acesso de todos os usuários dele (sessões encerradas, login recusado) sem inativar cada um. O titular do administrador não pode ser inativado.
- **Convites:** `POST /usuarios/convites/:id/revogar` (titular: só os próprios convites de vinculado; admin: qualquer) e `POST /admin/convites/:id/revogar`. Convite revogado vale como inexistente. Só se revoga convite pendente (usado, revogado ou expirado dão 409).
- **Redefinição de senha (sem e-mail na v1):** o admin gera o link com `POST /admin/usuarios/:id/redefinicao` `{ senha }` (24 h, uso único, um link novo invalida o anterior). O usuário abre `GET /redefinicao/:token` e define a senha em `POST /redefinicao/:token` `{ senha }`. Ninguém, nem o admin, passa a saber a senha. Concluir derruba todas as sessões do usuário e libera o bloqueio por tentativas de login. Link inexistente, expirado, usado ou revogado dão a mesma resposta 404.
- **Ainda não existe:** o usuário trocar a própria senha estando logado, e recuperar a senha do **próprio admin** (ele não tem a quem pedir o link). Ver a lista de pendências no plano.

### Log de auditoria (api/src/log.ts, log-acoes.ts, auditoria/)

- **Gravar:** `registrarLog(db, { acao, usuarioId, titularId, entidade, entidadeId, ip, antes, depois, confirmadoPor })`. Dentro de uma transação, passe o `tx`, para o log entrar junto com a operação. Nunca coloque senha, hash ou token em `antes`/`depois`.
- **Catálogo fechado:** a `acao` só pode ser um valor de `ACOES_LOG` (`api/src/log-acoes.ts`). **Toda escrita nova precisa de uma ação nova ali**; o teste `auditoria.test.ts` exige que cada ação do catálogo seja gerada por um fluxo real e que nenhuma ação fora dele seja gravada.
- **Todo registro** tem IP (`cli` quando vem do comando no servidor), e os de ação de usuário têm quem fez e de qual titular. Operações que pedem senha guardam `confirmado_por`.
- **Imutável e confiável:** a API só tem `INSERT`/`SELECT`; gatilhos no banco bloqueiam alterar, apagar e esvaziar, até para o dono; outro gatilho **carimba a hora no banco** (a API não consegue gravar data falsa). A API também não consegue desligar os gatilhos, nem alterar ou apagar a tabela. Limite conhecido: quem tem acesso de superusuário ao PostgreSQL ainda pode mexer; por isso o acesso ao servidor e ao banco deve ser restrito e o backup guardado fora da VPS.
- **Ler:** `GET /log?limite=&cursor=&acao=&usuarioId=&desde=&ate=&titularId=` (só `GET`; não existe rota de escrita). Admin vê tudo (ou um titular); titular vê o próprio titular, incluindo o que os vinculados fizeram; vinculado só com a permissão `ver` do módulo `log`. Quem não é admin vê o administrador como "Administrador do sistema". Paginação por cursor, do mais recente ao mais antigo.
- Ler o log não grava no log.

### Categorias (api/src/categorias)

Árvore de até 3 níveis (raiz = nível 1). Só as folhas recebem lançamento. A filha herda o tipo da mãe (receita/despesa) e, se não informado, a natureza. Nome único entre irmãs **ativas**, sem diferenciar maiúsculas.

- `GET /categorias?incluirInativas=true|false`: árvore aninhada (receitas antes); inativas ocultas por padrão.
- `POST /categorias` `{ nome, tipo?, paiId?, natureza?, preverPelaMedia? }`: `tipo` obrigatório na raiz. Mãe inativa, no 3º nível ou com lançamentos ativos não ganha filha.
- `PATCH /categorias/:id` `{ nome?, natureza?, preverPelaMedia? }` (`.strict()`: tentar mudar tipo ou mãe é 400). Sem mudança real, 200 e nada no log.
- `POST /categorias/:id/inativar` e `/reativar` `{ senha }`: permissão `excluir` + senha. Inativar só sem lançamentos ativos e sem subcategorias ativas; a API recusa e lista o que falta. Reativar filha exige a mãe ativa.
- Permissões do módulo `categorias`. Outro titular: 404. Titular novo (convite aceito ou primeiro admin) nasce com a árvore padrão (`padrao.ts`).

### Contas (api/src/contas)

Carteira, banco ou cartão. Cartão nesta fase é só o tipo (sem limite, fechamento, vencimento ou juros). Dinheiro em centavos (inteiro). O saldo **não é gravado**: `saldo = saldo_inicial + receitas realizadas ativas − despesas realizadas ativas`. Previstos e inativos não entram.

- `GET /contas?incluirInativas=true|false`: lista ordenada por nome; inativas ocultas por padrão. Cada item traz `saldoInicial` e `saldo`.
- `POST /contas` `{ nome, tipo, saldoInicial? }`: `tipo` é `carteira` | `banco` | `cartao`. `saldoInicial` padrão 0, pode ser negativo. Nome único entre contas **ativas** do titular, sem diferenciar maiúsculas.
- `PATCH /contas/:id` `{ nome?, tipo?, saldoInicial? }` (`.strict()`: campo desconhecido, ex. limite, é 400). Sem mudança real, 200 e nada no log. Conta inativa não se altera.
- `POST /contas/:id/inativar` e `/reativar` `{ senha }`: permissão `excluir` + senha. Inativar só sem lançamentos ativos; a API recusa e diz quantos restam.
- Permissões do módulo `contas`. Outro titular: 404.

### Lançamentos (api/src/lancamentos)

Receita ou despesa, só em categoria folha (sem subcategorias ativas; a API recusa e o banco também, via gatilho). Dinheiro em centavos (inteiro). Data no calendário (`AAAA-MM-DD`, sem hora). Transferência, recorrência, parcelas e previsão pela média ficam para a Fase 3.

- `GET /lancamentos`: inativos ocultos por padrão (`incluirInativos=true`). Filtros: `categoriaId`, `contaId`, `tipo`, `status`, `dataDesde`, `dataAte`. Paginação `limite` (1–100, padrão 50) e `pagina`. Ordem: data mais recente primeiro.
- `POST /lancamentos` `{ categoriaId, contaId, valor, data, descricao, observacao?, tipo?, natureza?, status? }`: herda tipo e natureza da categoria; `status` padrão `realizado`. `tipo` informado tem de bater com o da categoria. Criar exige `cadastrar` em lançamentos **e** `ver` em categorias e contas (`podeLancar`). Categoria ou conta inativa: 409.
- `PATCH /lancamentos/:id` `{ categoriaId?, contaId?, valor?, data?, descricao?, observacao?, natureza?, status? }` (`.strict()`). Sem mudança real, 200 e nada no log. Inativo não se altera. Editar realizado de mês passado é permitido (e vai para o log). Ao passar de `previsto` para `realizado`, o valor previsto original fica no registro (`valor_previsto_original`) e no log.
- `POST /lancamentos/:id/inativar` e `/reativar` `{ senha }`: permissão `excluir` + senha. Reativar exige categoria e conta ativas; senão 409 com o motivo.
- Permissões do módulo `lancamentos`. Outro titular: 404. Origem nesta fase: só `manual`.

### Inativos (api/src/inativos)

Lista unificada do que está inativo, para a tela de reativação. Reativar o próprio continua nas rotas de cada módulo (`POST /categorias/:id/reativar`, o equivalente em contas e lançamentos, e `POST /usuarios/:id/reativar`). O admin reativa registro de **qualquer** titular pelas rotas `/admin/.../reativar`. Cada item traz `impedimento` (`codigo` + `mensagem`) quando a reativação ainda não é possível (categoria/conta/pai/titular inativos).

- `GET /inativos`: titular da sessão. Vinculado só vê o módulo em que tem `ver`. Usuários inativos só para titular e admin. Ativos não entram.
- `GET /admin/inativos?titularId=`: só admin. Sem `titularId`: 400. Titular inexistente: 404.
- `POST /admin/lancamentos/:id/reativar`, `/admin/categorias/:id/reativar`, `/admin/contas/:id/reativar` `{ senha }`: só admin. O log grava o `titular_id` **do registro**, não o do admin. Titular e vinculado: 403 (eles usam as rotas do próprio módulo). Inexistente: 404.
- A tela React está em `web/src/telas/Inativos.tsx` (reativar o próprio; admin usa as rotas `/admin/...` na API, a lista do titular é `GET /inativos`).

### Isolamento entre titulares (api/src/isolamento)

Toda consulta e escrita de negócio filtra por `titular_id` da sessão. Recurso de outro titular: **404** (não 403), para não revelar que existe. Rotas `/admin/...` e `?titularId=` de outro espaço: titular e vinculado recebem **403**; o admin age por essas rotas, com log. Nas rotas comuns (`GET /lancamentos`, etc.) o admin também só vê o próprio titular.

A bateria `isolamento.test.ts` compara as rotas vivas da API com um catálogo fechado: rota nova sem caso ali quebra o teste. Cada caso tenta ler ou alterar a casa A a partir da casa B e confere que nada mudou.

### Usuários vinculados e permissões (api/src/usuarios, api/src/auth/permissoes.ts)

- `POST /usuarios/convites` `{ email, permissoes, senha, titularId? }`: convida um vinculado (link devolvido uma vez; quem recebe define a própria senha pelo mesmo fluxo de `/convites/:token`). `titularId` só vale para o admin.
- `GET /usuarios`: vinculados do titular (com permissões) e convites pendentes. `PUT /usuarios/:id/permissoes` `{ permissoes, senha }`: troca as permissões.
- Quem opera confirma com a **própria senha** (`reautenticar`, mesmo limite de tentativas do login). Falha vai para o log (`reautenticacao.falha`); o log das operações guarda `confirmado_por`.
- `/auth/me` devolve `permissoes` para o front esconder o que não cabe. **O servidor é quem decide**: toda rota de módulo deve começar com `exigirPermissao(req, reply, modulo, acao)`.
- Detalhes e a matriz completa em `docs/PERMISSOES.md`.

### Primeiro administrador

```bash
npm run admin:criar
```

Pergunta e-mail e nome do titular e pede a senha duas vezes, **sem mostrar o que é digitado**. A senha nunca é aceita como argumento de linha de comando (ficaria no histórico do shell e na lista de processos). Para automação existe a variável `ADMIN_SENHA` (e `ADMIN_EMAIL`, `ADMIN_TITULAR`), mas prefira o terminal interativo. Se usar a variável, não a escreva inline no comando.

- Só funciona uma vez: se já existe um admin, recusa. Os demais usuários entram por convite.
- Usa o papel `finan_app` (`DATABASE_URL`), nunca o dono do banco.
- Cria o titular, o admin e o registro no log numa única transação; duas execuções simultâneas não criam dois admins.
- Nenhuma migração nem seed insere dados (um teste garante isso).

### Banco de dados (PostgreSQL 16)

Dois papéis: `finan_owner` (dono, roda migrações) e `finan_app` (usado pela API; sem `DELETE` em nada e só `SELECT`/`INSERT` no log). Bancos: `finan_dev` e `finan_test`. As variáveis estão em `.env.example`; copie para `.env` e preencha só localmente (o `.env` fica fora do git).

```bash
npm run db:generate -w api   # gera migração a partir de api/src/db/schema.ts
npm run db:migrate -w api    # aplica migrações pendentes e reaplica permissões (finan_dev)
npm run db:reset -w api      # recria finan_dev do zero (recusa bancos que não terminem em _dev/_test)
npm run db:migrate:test -w api
```

O Drizzle não tem migração de descida. Em desenvolvimento, "voltar" é `db:reset`. Em produção, correções são feitas por uma nova migração para frente.

Mudou o esquema? Gere a migração, confira o SQL gerado e rode os testes, que recriam o banco `finan_test` do zero.
