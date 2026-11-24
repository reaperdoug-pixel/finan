# Registro de decisões

Cada item: decisão e motivo. Para mudar uma, edite aqui explicando o porquê.

| # | Decisão | Motivo |
|---|---------|--------|
| 1 | Finanças pessoais, web mobile-first, pt-BR, BRL | Foco do produto; app nativo/PWA depois |
| 2 | Multiusuário hospedado numa VPS (Hostinger) | Amigos usam desde a Fase 2; abre ao público depois |
| 3 | PostgreSQL em dev e produção, Drizzle ORM | Vários acessos simultâneos; evita diferenças SQLite × Postgres |
| 4 | Monorepo `web/` (React+Vite+TS) e `api/` (Fastify+TS) | API separada facilita app mobile futuro |
| 5 | Deploy direto na VPS, sem Docker (Node, Postgres, Caddy, systemd) | Simplicidade para a VPS única |
| 6 | Entrada 100% manual | Evita credenciais bancárias e custo de integração |
| 7 | Cadastro só por convite | Controle sobre quem entra no começo |
| 8 | Sem recuperação de senha por e-mail e sem 2FA na v1 | Sem serviço de e-mail ainda; admin redefine manualmente |
| 9 | Nada de sensível no front-end | Segurança: tudo no back-end |
| 10 | Papéis: admin, titular, vinculado; permissões por módulo (ver, cadastrar, alterar, excluir) | Titular dá acesso a outras pessoas com controle fino |
| 11 | Um titular por usuário; vários espaços por pessoa ficam para depois | Simplifica o MVP |
| 12 | Nada se apaga: tudo inativa; reativar exige senha | Controle e rastreabilidade |
| 13 | Inativação só com lançamentos e subcategorias já inativos | Integridade da hierarquia |
| 14 | Log total, só de inclusão, desde a Fase 1 | Segurança e responsabilização |
| 15 | Categorias em árvore de 3 níveis; lançamento só em folhas | Detalhe suficiente sem complexidade |
| 16 | Categoria tem natureza fixa/variável; lançamento herda e pode ajustar | Relatório de onde pesa mais |
| 17 | Contas (carteira, banco, cartão) em BRL entram na v1 | Necessárias para cartão e transferência |
| 18 | Cartão simples: sem fechamento, vencimento, limite ou juros | Entender a necessidade real antes de complicar |
| 19 | Recorrência, parcelas, previsão pela média e transferências na v1 | Previsão e custos fixos desde o início |
| 20 | Status previsto × realizado; previstos não entram nos saldos | Previsão sem distorcer o realizado |
| 21 | Previsão pela média dos últimos 12 meses realizados | Simples e ajustável |
| 22 | Anexos (PDF/imagem, 5 MB, disco privado) e modo escuro na v1 | Pedido do produto; entram na Fase 4 |
| 23 | Exportação CSV fora da v1 | Adiada por decisão do produto |
| 24 | Entrega em 4 fases; amigos entram na Fase 2 | Valor cedo com risco controlado |
| 25 | Backup diário `pg_dump`, 14 dias + cópia externa criptografada | Obrigatório antes dos amigos |
| 26 | Testes com Vitest e Playwright; segurança sempre testada | Evita regressões em regras críticas |
| 27 | Painel antecipado da Fase 2, só com dados da Fase 1 (`GET /painel`): resultado do mês, avisos de decisão, últimos 6 meses, despesas por categoria-raiz, saldo por conta. Orçamento, previsão e fixo × variável continuam na Fase 2 | Pedido da cliente: bater o olho e decidir. Não cria dado novo, só lê; autorizado pelo produto em 13/11/2026 |
| 28 | Modo escuro automático (tema do sistema) antecipado da Fase 4; sem alternância manual | Faz parte da nova direção visual. A escolha manual do tema segue na Fase 4 |
| 29 | Gráfico fixo × variável das despesas antecipado no painel (só leitura, a partir de `natureza` do lançamento). Relatório fixo × variável completo e orçamento seguem na Fase 2 | Autorizado pelo produto em 13/11/2026 |
| 30 | Nova direção visual (aprovada em 13/11/2026, desenho no Figma "FINAN — Design"): fundo sálvia fria com brilhos em camadas, cartões de vidro (translúcidos, desfoque, fio de 1 px, sombra suave), resultado do mês como único bloco escuro, ultramarino só em ação, verde/vermelho só em valores. Bricolage Grotesque em títulos e números grandes, Geist na interface, Geist Mono em valores de lista. Nome **finan** em minúsculas com marca de três degraus. Substitui "grafite frio, cobalto, sem sombra e sem degradê" | Painel parecia HTML simples; referências de apps de finanças (Copilot Money, Monarch, Nubank) e tendências 2026 |
| 31 | "Fôlego do saldo" no painel: dias que o saldo total aguenta no ritmo de gasto do mês (`web/src/painel-insights.ts`, com teste). Só lê o que a API devolve. Mais uma frase de leitura das categorias | Ajuda a decidir sem abrir outra tela. O saldo inclui contas do tipo cartão (ver pendência do cartão no painel) |
| 32 | Cadastro de **Contatos** (pessoas físicas e jurídicas: clientes, fornecedores ou ambos; CPF/CNPJ e observação opcionais), vínculo opcional no lançamento, filtro por contato em Lançamentos e resumo por contato (recebido, pago, a receber e a pagar, usando lançamentos realizados × previstos) | Pedido do produto em 18/11/2026: controlar quanto foi pago/recebido por fornecedor ou cliente e acompanhar quem está devendo e a quem se deve. Módulo próprio `contatos` na matriz de permissões; nada se apaga (inativar só sem lançamentos ativos, com senha e log) |
| 33 | Sessão opaca em cookie `httpOnly` + HMAC no banco, não JWT | Revoga na hora (logout, troca de senha, inativação); o token não fica acessível ao JS; o app é same-origin atrás do Caddy, então não há ganho em token stateless. Registrado em 24/11/2026 |
| 34 | `TRUST_PROXY` aceita só IPs/CIDRs explícitos; vazio = loopback (Caddy na mesma máquina). Recusa `true`, `*` e equivalentes | Um `X-Forwarded-For` forjado não pode burlar o limite por IP. Registrado em 24/11/2026 |
| 35 | Limite de tentativas atômico (`pg_advisory_xact_lock` no e-mail e depois no IP): 5 falhas por e-mail e 20 por IP em 15 min, HTTP 429 | Uma rajada concorrente não passa do teto. Registrado em 24/11/2026 |
| 36 | Faxina periódica de sessões e tentativas de login antigas (retenção 30 dias, `LIMPEZA_RETENCAO_DIAS`). O log de auditoria não é limpo | Essas tabelas cresciam sem fim; o papel da API não tem `DELETE`. Operação e timer em `docs/BACKUP.md`. Registrado em 24/11/2026 |
| 37 | 401 no meio do uso no web: limpa sessão e CSRF, leva a `/login` com a rota de origem e o aviso de expiração. O 401 do `POST /auth/login` (senha errada) e das rotas públicas não disparam esse fluxo | Sem isso, a sessão caída deixava a pessoa presa na tela com "Não autenticado". Registrado em 24/11/2026 |

## Pendentes

- Dados da VPS (sistema operacional, RAM, domínio) e destino do backup externo: definir quando o MCP da Hostinger estiver ativo.
- Direção visual: nova direção aprovada em 13/11/2026 (decisão 30). Revisar com a cliente no início da Fase 2. Fontes agora hospedadas localmente (`@fontsource`, licença OFL), sem chamadas ao Google; CSP restritiva em `deploy/Caddyfile.exemplo`.
