# Continuidade — revisão de layout e painel (13/11/2026)

Registro do que foi feito na sessão de revisão visual e do painel, para retomar depois sem reconstruir o contexto. Deploy (tarefas 15 e 16) **não** foi trabalhado.

## 1. Estado em uma olhada

| Item | Estado |
|------|--------|
| Novo visual (grafite frio, acento cobalto, Geist) | Feito em todas as telas autenticadas e no login |
| Modo escuro automático (tema do sistema) | Feito; sem alternância manual |
| Painel (`/painel`) como página inicial | Feito (API + tela + testes) |
| Lint, tipos, testes, build | Passando (ver seção 8) |
| Playwright (e2e) | Passando, 2 de 2 |
| Commits no git | **Nenhum.** O repositório ainda não tem commit; tudo está como arquivo novo |
| Telas públicas (convite, redefinição) | Herdam o visual do login; **não foram vistas no navegador** |

## 2. Decisões de produto tomadas (e registradas)

Estas saíram do escopo original e foram autorizadas pelo produto. Estão em `DECISOES.md` (27 e 28):

1. **Painel antecipado da Fase 2**, só com dados da Fase 1. Orçamento, previsão e relatório fixo × variável continuam na Fase 2.
2. **Modo escuro automático antecipado da Fase 4.** A escolha manual do tema continua na Fase 4.

Regra que motivou a pergunta: o `CLAUDE.md` manda parar e perguntar quando algo contradiz a especificação ou antecipa fase futura.

## 3. Direção visual

Definida nesta revisão (a decisão antiga dizia "definir no início da Fase 2"; ficou registrada em `DECISOES.md`, seção Pendentes, para revisar com a cliente).

- **Ponto de partida:** o front era a metáfora "caderneta" (papel verde-acinzentado, linhas de caderno, grão, serifa Source Serif). Foi trocada por algo tecnológico e minimalista.
- **Cor:** grafite frio. Claro: fundo `#f3f4f6`, superfície `#ffffff`, tinta `#0d1117`, acento `#2b59ff`. Escuro: fundo `#0a0c10`, superfície `#10131a`, acento `#7b97ff`. Verde (`--receita`) e vermelho (`--despesa`) aparecem **só em valores**. Os tokens estão no topo de `web/src/estilo.css`.
- **Tipografia:** Geist (interface) e Geist Mono (valores, datas, marca, identificadores do log). Mono só onde o alinhamento de números importa.
- **Forma:** raios 10px (superfícies) e 6px (controles); sem sombras e sem gradientes. Única textura: grade de pontos discreta no login.
- **Movimento:** só transições de 0,12s em hover e foco. Respeita `prefers-reduced-motion`.
- **Peça de destaque:** o resultado do mês no painel. O resto é quieto de propósito.
- **Ações destrutivas discretas:** "Inativar" nas listas fica apagado e só fica vermelho no hover. O botão `btn-perigo` fora das listas mantém o vermelho.
- **Navegação:** desktop (≥800px) tem sidebar de altura total com marca e usuário dentro; a barra superior só aparece no celular. No celular a barra inferior fica fixa (`position: sticky`) e mostra **5 itens**.

## 4. Mapa de arquivos

### Criados

| Arquivo | Para quê |
|---------|----------|
| `api/src/painel/servico.ts` | Cálculo do painel (consultas agregadas por titular) |
| `api/src/painel/routes.ts` | `GET /painel` |
| `api/src/painel/painel.test.ts` | 10 testes: acesso, isolamento, somas, categoria-raiz, atrasados, `deslocarMes` |
| `web/src/telas/Painel.tsx` | Tela do painel (componente `PainelGeral`) |
| `web/src/painel-alertas.ts` | Regras dos avisos ("o que pede decisão"); função pura |
| `web/src/painel-alertas.test.ts` | 12 testes das regras dos avisos |
| `docs/CONTINUIDADE-LAYOUT.md` | Este documento |

### Alterados

| Arquivo | O que mudou |
|---------|-------------|
| `web/src/estilo.css` | Reescrito: tokens novos, tema escuro, razão, painel (`.pn*`), login, sidebar |
| `web/index.html` | Fontes: Atkinson e Source Serif saíram; entraram Geist e Geist Mono (Google Fonts) |
| `web/src/componentes/Layout.tsx` | Marca e usuário na sidebar; item "Painel"; barra inferior com 5 itens |
| `web/src/componentes/Icones.tsx` | Ícone `painel` |
| `web/src/App.tsx` | Rota `/painel`; `/` redireciona para `/painel` |
| `web/src/telas/Login.tsx` | Depois do login vai para `/painel` |
| `web/src/telas/Lancamentos.tsx` | Sem mudança funcional (a faixa `Resumo` provisória foi criada e depois removida) |
| `web/src/telas/Log.tsx` | Ação em mono (classe `log`); data, usuário e entidade em itens separados |
| `web/src/tipos.ts` | Tipos `TotaisMes`, `GastoPorCategoria`, `Painel` |
| `api/src/app.ts` | Registra `rotasPainel` |
| `api/src/isolamento/isolamento.test.ts` | `GET /painel` no catálogo fechado e nas leituras de vazamento |
| `e2e/fluxos.spec.ts` | Após o login espera o título "Painel" |
| `docs/DECISOES.md` | Decisões 27 e 28; pendente de direção visual atualizado |
| `docs/CONVENCOES.md` | Seção "Painel (api/src/painel)"; painel na lista de telas |
| `docs/PLANO-FASE-1.md` | Nota em "Fora desta fase" sobre a antecipação |

## 5. O painel

### API: `GET /painel?mes=AAAA-MM`

- Padrão: mês atual em `America/Sao_Paulo`. Mês inválido devolve 400. A API aceita mês futuro; a tela é que bloqueia o botão "próximo" além do mês atual.
- Exige `ver` em lançamentos (401 sem login, 403 sem permissão). **Somente leitura:** não grava nada e não gera log.
- Conta só lançamento **ativo e realizado**. Tudo filtra por `titular_id`; valores em centavos inteiros.
- Resposta: `mes`, `mesAnterior`, `hoje`, `atual`, `anterior`, `serie` (6 meses), `previstosDoMes`, `atrasados` (previsto com data anterior a hoje, em qualquer mês), `despesasPorCategoria`, `contas`.
- `despesasPorCategoria` é `null` sem `ver` em categorias; `contas` é `null` sem `ver` em contas. Nunca vêm com dados parciais.
- Despesas são agrupadas na **categoria-raiz** (sobe a árvore a partir da folha).
- O saldo por conta reaproveita `listarContas` (`api/src/contas/servico.ts`).

### Tela: `/painel`

Ordem (celular, de cima para baixo; no desktop ≥1100px vira grade de duas colunas com áreas nomeadas):

1. **Resultado do mês:** valor grande, comparação com o mês anterior, barra de proporção receitas × despesas, receitas e despesas com variação %, e "ainda a pagar/receber" quando há previstos.
2. **O que pede decisão:** até 4 avisos; se houver mais, mostra "Mais N avisos menos graves".
3. **Últimos 6 meses:** barras de receita e despesa; mês atual em destaque. Há uma tabela oculta (`.so-leitor`) para leitores de tela.
4. **Para onde foi o dinheiro:** top 6 categorias-raiz, participação, variação; o resto em "Outras categorias".
5. **Saldo nas contas:** total e lista; contas negativas com fundo avermelhado.

### Regras dos avisos (`web/src/painel-alertas.ts`)

Ordem de gravidade: críticos primeiro.

| Aviso | Nível | Quando |
|-------|-------|--------|
| Conta no negativo | crítico | saldo da conta < 0 |
| Saldo não cobre o previsto | crítico | saldo total < (previstos a pagar − previstos a receber) do mês |
| Saiu mais do que entrou | crítico (atenção se ainda não há receita) | despesas > receitas no mês |
| Previstos atrasados | atenção | existe previsto com data já passada |
| Categoria subiu | atenção | variação ≥ 20% **e** ≥ R$ 50,00 sobre o mês anterior (só a maior) |

As constantes `SUBIDA_MINIMA_PCT`, `SUBIDA_MINIMA_CENTAVOS` (no mesmo arquivo) e `MAX_AVISOS` (em `Painel.tsx`) são **escolhas minhas**, ainda não validadas com a cliente.

## 6. Como ver as telas sem credenciais

Não use usuário real nem coloque dado de teste no bundle. A técnica usada na sessão:

1. `npm run dev:web` (e, se quiser, `npm run dev:api`).
2. No navegador, antes de logar, substitua `window.fetch` por um simulado que responde `/auth/login`, `/auth/me`, `/api/painel`, `/api/lancamentos`, `/api/categorias`, `/api/contas` etc. com dados **fictícios**, e envie o formulário de login com texto qualquer.
3. Isso altera só a página aberta, nunca o projeto.

Para testar o layout em tamanho de celular, use o viewport de 375px; em desktop, 1280px. Teste também `prefers-color-scheme: light` e `dark`.

Para o e2e: `npx playwright install chromium` (uma vez) e depois `npm run test:e2e`. O setup cria `e2e-titular@finan.test` no banco de **desenvolvimento** (documentado em `CONVENCOES.md`).

## 7. Armadilhas aprendidas

- **Barra inferior do celular:** ela fatia a lista de itens. Ao inserir um item novo na frente, o último deixa de aparecer. Foi assim que o Inativos sumiu e o e2e acusou; hoje a barra mostra 5 itens. Se entrar mais um item, reavalie.
- **Catálogo de rotas:** `api/src/isolamento/isolamento.test.ts` falha se uma rota nova não estiver listada. Toda rota nova entra lá (e, se pedir senha, na bateria de `auth/reautenticacao.test.ts`).
- **Bloco de IP dos testes:** cada arquivo de teste da API usa um bloco próprio em `criarAmbiente(N)` (71 a 79 em uso; o painel usa 79). Dois arquivos com o mesmo bloco disputam o limite de tentativas por IP.
- **Grade do painel:** `grid-area` só deve valer dentro do `@media (min-width: 1100px)`. Fora dele, nomes de área sem `grid-template-areas` bagunçam o posicionamento automático.
- **Grade esticada:** sem limite de avisos e sem as áreas nomeadas, a linha cresce até o card mais alto e deixa espaço vazio. Foi o que motivou o limite de 4.

## 8. Verificação ao fim da sessão

| Verificação | Resultado |
|-------------|-----------|
| `npm run lint` | sem erros |
| `npm run typecheck` | sem erros |
| `npm run test` | shared 4, API 638, front 19, todos passando |
| `npm run test:e2e` | 2 de 2 |
| `npm run build` | ok |

Conferido no navegador: login, painel, lançamentos, categorias, contas, inativos, pessoas, log, titulares e diálogo de senha, em claro, escuro, desktop e celular, com API simulada (dados fictícios).

## 9. Pendências e próximos passos

**Decisões de produto**
- **Cartão no painel:** o saldo de contas do tipo cartão entra no "Saldo nas contas" e pode gerar o aviso "está no negativo". O cartão simples é da Fase 3 (decisão 18); decidir se cartão deve ficar fora do total e dos avisos.
- Validar com a cliente os limites dos avisos (20%, R$ 50, 4 avisos) e a lista de avisos.
- Revisar a direção visual com a cliente no início da Fase 2 (como diz `DECISOES.md`).

**Fase 2 (o que continua pendente)**
- Orçamento, relatório fixo × variável e previstos como tela própria. O painel já lê `previstosDoMes` e `atrasados`, mas não há tela para marcar previsto como realizado além da edição do lançamento.

**Front**
- Ver no navegador as telas públicas (`/convite/:token`, `/redefinicao/:token`); elas usam as mesmas classes do login.
- Pessoas, Log e Titulares não aparecem na navegação do celular (já era assim antes). Avaliar um menu "Mais".
- Quem não tem `ver` em lançamentos cai em `/painel` e vê o erro de permissão. Avaliar uma página inicial por permissão.
- As fontes são hospedadas localmente (`@fontsource/plus-jakarta-sans` e `@fontsource/jetbrains-mono`), sem Google Fonts.
- Modo escuro com alternância manual: Fase 4.

**Fora desta sessão (continuam do plano)**
- Tarefas 15 e 16 (deploy e backup).
- Pendências antigas: trocar a própria senha logado; recuperar a senha do próprio admin.
- **Fazer o primeiro commit.** Nada está versionado ainda.


## 10. Atualização: nova direção visual aplicada (13/11/2026, tarde)

- **Fonte do desenho:** arquivo Figma "FINAN — Design" (equipe Big_boss), páginas Painel (desktop e celular, claro e escuro) e Fundamentos (marca, paleta, tipos, ícones). Comparação antes × depois em `docs/design/`.
- **Decisões novas:** 30 (direção visual) e 31 (fôlego do saldo) em `DECISOES.md`. A 29 (fixo × variável) já estava registrada.
- **Código:** `web/src/estilo.css` (tokens, fundo, vidro, hero, rosca), `web/src/telas/Painel.tsx`, `web/src/painel-insights.ts` (+ teste), `web/src/componentes/MarcaFinan.tsx`, `Icones.tsx`, `Layout.tsx`, `Login.tsx`, `Publicas.tsx`, `web/index.html` (Bricolage Grotesque). API: `receitasPorCategoria`, `movimentoPorConta` e `despesasPorNatureza` no `GET /painel`.
- **Não aplicado do desenho:** botão "Novo lançamento" no cabeçalho do painel (hoje o botão fica na tela de Lançamentos); ícone de carteira por conta no saldo.
- **Pendências:** conferir telas públicas (convite, redefinição) com o vidro; contraste do texto sobre o vidro em aparelhos fracos; hospedar fontes localmente; o 1 teste de API do rate limit (`reautenticacao.test.ts`, 5 senhas erradas) falhou uma vez e passou na repetição: observar se é instável.
