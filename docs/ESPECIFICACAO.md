# FINAN — Especificação v1

Sistema web de finanças pessoais, multiusuário, em pt-BR e BRL.
Status: **rascunho para revisão**. Nenhum código foi escrito.

## 1. Visão

- Controle de receitas, despesas, contas, orçamento e previsão.
- Entrada 100% manual (sem integração bancária, sem importação de extrato).
- Começa com poucos amigos, só por convite. Abertura ao público é fase futura (exige LGPD, termos, recuperação de senha, 2FA).
- Web mobile-first primeiro; app nativo/PWA depois.

## 2. Stack e arquitetura

- Monorepo: `web/` (React + Vite + TypeScript) e `api/` (Node + Fastify + TypeScript). Tipos compartilhados.
- PostgreSQL + Drizzle ORM, migrações versionadas. PostgreSQL em dev e produção.
- Deploy direto na VPS Hostinger, sem Docker: Node, PostgreSQL, Caddy (HTTPS automático), API sob `systemd`.
- Testes: Vitest (regras de negócio) e Playwright (fluxos críticos).

## 3. Segurança (regras inegociáveis)

1. **O front-end não guarda nada sensível.** Nenhum usuário, senha, token, seed ou dado de teste no bundle. Nenhum segredo em variáveis `VITE_*`. Nada em `localStorage`/`sessionStorage`.
2. Sessão apenas em cookie `httpOnly`, `Secure`, `SameSite`. Proteção CSRF.
3. Toda validação e autorização acontece na API. O front só exibe.
4. Isolamento total entre titulares: toda consulta filtra por `titular_id` no servidor.
5. Senha: mínimo 10 caracteres, hash argon2, limite de tentativas por IP e por usuário. Sessão expira em 30 min de inatividade e 12 h no máximo.
6. Primeiro admin criado por CLI/variável de ambiente na VPS, nunca em código.
7. Dados de teste só no banco de desenvolvimento, nunca em produção.
8. Anexos fora da pasta pública, servidos só pela API após checar permissão.

## 4. Papéis e permissões

- **Admin do sistema**: convida titulares, ativa/inativa contas, reativa qualquer registro, vê todo o log. Também é titular dos próprios dados.
- **Titular**: dono do espaço de dados. Tem todas as permissões. Cria **usuários vinculados**.
- **Usuário vinculado**: pertence a um único titular, trabalha nos dados dele e só faz o que as permissões permitirem.
- Permissões por módulo (**lançamentos, categorias, contas, contatos, orçamentos, anexos**): `ver`, `cadastrar`, `alterar`, `excluir` (= inativar).
- Log: titular vê o log do próprio espaço; vinculado só com permissão específica; admin vê tudo.
- Nomenclatura: **Titular** = espaço de dados; **Conta** = conta financeira (carteira, banco, cartão). Vários espaços por pessoa ficam para depois.

## 5. Regra de "nada se apaga"

- Não existe exclusão física. "Excluir" = inativar (`ativo=false`, `inativado_em`, `inativado_por`).
- Reativar e inativar exigem **reautenticação com senha** do usuário logado; o log registra quem confirmou.
- Usuário reativa os próprios lançamentos e categorias; admin reativa qualquer coisa, inclusive contas e usuários.
- Ordem obrigatória de inativação: **lançamentos → subcategorias → categoria**. A API recusa e informa o motivo se houver lançamentos ativos ou subcategorias ativas.
- Reativar lançamento só é permitido se a categoria (e a conta) dele estiver ativa.
- Registros inativos ficam fora de saldos, resumos, gráficos e orçamentos; aparecem na tela de inativos.

## 6. Log de auditoria

- Tabela só de inclusão; usuário de banco da API tem apenas `INSERT` e `SELECT` nela (sem `UPDATE`/`DELETE`).
- Registra: login, falha de login, criação, edição, inativação, reativação, mudança de permissão, convites. Cada linha: quem, quando, IP, entidade, valor antes e depois, titular afetado, quem confirmou (quando houver reautenticação).
- Leituras comuns não são registradas. Retenção sem limite na v1.
- Ao realizar um lançamento previsto, o valor previsto original fica no log.

## 7. Modelo de dados

Todas as tabelas: `id` UUID, `ativo`, `inativado_em`, `inativado_por`, `criado_por`, `criado_em`, `atualizado_em`. Dinheiro em centavos (inteiro).

- **titular**
- **usuario**: e-mail, hash de senha, papel, `titular_id`, ativo.
- **permissao**: `usuario_id`, módulo, ver, cadastrar, alterar, excluir.
- **convite**: token com validade, papel, titular.
- **categoria**: árvore de até 3 níveis (`pai_id`), tipo (receita/despesa), **natureza** (fixa/variável), `prever_pela_media`. Lançamento só em folhas.
- **conta**: tipo (carteira/banco/cartão), nome, saldo inicial. Sem limite, fechamento, vencimento nem juros na v1.
- **contato**: pessoa física ou jurídica (`pf`/`pj`), papel (`cliente`/`fornecedor`/`ambos`), nome, documento (CPF/CNPJ opcional), observação. Vínculo opcional no lançamento; resumo de pago, recebido, a receber e a pagar a partir dos lançamentos ativos (realizados × previstos).
- **lancamento**: tipo (receita/despesa/transferência), status (previsto/realizado), natureza (herda da categoria, ajustável), valor, data, descrição, observação, categoria, conta, contato (opcional), origem (manual/recorrência/média/parcela), `recorrencia_id`, `grupo_parcela_id` e número da parcela, `valor_previsto_original`.
- **transferencia**: par de movimentos (saída e entrada) ligados; não conta como receita nem despesa em resumos e orçamentos.
- **recorrencia**: modelo (valor, categoria, conta, frequência mensal/anual, início, fim).
- **orcamento**: limite mensal por categoria de despesa, com valor padrão repetido e ajuste por mês específico.
- **anexo**: lançamento, caminho em disco, tipo, tamanho.
- **log**: ver seção 6.

## 8. Funcionalidades

- **Categorias**: árvore com criar/editar/inativar. Conjunto padrão inicial (Moradia, Alimentação, Transporte, Salário etc.), editável. Ao ganhar filhas, a categoria deixa de aceitar lançamento direto. Mães somam as filhas.
- **Lançamentos**: criar, editar, inativar, reativar, filtros, listagem.
- **Cartão**: conta do tipo cartão; compras lançadas nela; fatura paga por transferência da conta bancária.
- **Parcelas**: N lançamentos previstos ligados ao mesmo grupo; cada um vira realizado ao confirmar.
- **Recorrência**: mensal e anual; editar só um mês ou o modelo todo.
- **Previsão pela média**: nas categorias marcadas, média mensal dos últimos 12 meses realizados (usa o que houver; sem histórico, valor manual), gera previstos para 12 meses à frente, editáveis. Ao chegar o mês, o usuário ajusta o valor (ex.: previsto 150, real 178) e marca realizado.
- **Resumo e gráfico por categoria**, comparando fixo versus variável e previsto versus realizado.
- **Orçamento**: gasto versus limite com barra de progresso e alerta visual; sem notificação por e-mail.
- **Anexos**: PDF ou imagem, até 5 MB, privados, vinculados ao lançamento.
- **Modo escuro**. **Fora da v1: exportação CSV.**

## 9. Telas

Login, painel (resumo + gráfico), lançamentos, categorias (árvore), contas, orçamento, previstos, inativos (com reativação), usuários e permissões, log, admin do sistema (titulares e convites).

## 10. Entrega em fases

1. **Fase 1**: login, titular, vinculados e permissões, log, categorias em árvore, contas, lançamentos, inativação/reativação com senha, backup, deploy.
2. **Fase 2**: resumo, gráfico por categoria, orçamento, relatório fixo/variável. Amigos entram aqui.
3. **Fase 3**: recorrência, previsão, parcelas, cartão, transferências.
4. **Fase 4**: anexos e modo escuro.

## 11. Backup

`pg_dump` diário, retenção de 14 dias na VPS e cópia criptografada fora dela. Teste de restauração antes de abrir para os amigos. Anexos entram no backup.

## 12. Testes obrigatórios

Isolamento entre titulares, permissões por módulo, regra de inativação, reautenticação, escrita imutável do log, cálculo de média e de parcelas.

## 13. Premissas assumidas (corrija se discordar)

- Fuso horário `America/Sao_Paulo`; datas sem hora nos lançamentos.
- Convite: link gerado pelo admin/titular, válido por 7 dias, uso único, entregue manualmente (sem serviço de e-mail na v1).
- Redefinição de senha: manual pelo admin, por falta de e-mail na v1.
- Média de previsão ignora lançamentos inativos e meses sem lançamento na categoria.
- Orçamento pode ser definido para categorias mães (soma das filhas) ou folhas.
- Transferência entre contas usa o mesmo valor nas duas pontas; sem taxas.
- Limite de usuários vinculados por titular: sem limite na v1.
- Saldo da conta = saldo inicial + realizados (previstos não contam).
- Edição de lançamento realizado de mês passado é permitida (e registrada no log).
- Hospedagem: sistema operacional, RAM, domínio e backup offsite a definir quando o MCP da Hostinger estiver ativo.
