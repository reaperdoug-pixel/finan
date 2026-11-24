# Matriz de permissões

Regra geral: toda checagem acontece na API. Todo acesso é limitado ao `titular_id` do usuário. "Excluir" significa inativar.

## Papéis

- **Admin**: gerencia o sistema; também é titular dos próprios dados.
- **Titular**: dono do espaço. Todas as permissões em todos os módulos, sempre.
- **Vinculado**: pertence a um único titular; recebe permissões por módulo.

## Módulos e ações

Módulos: `lancamentos`, `categorias`, `contas`, `contatos`, `orcamentos`, `anexos`.
Ações por módulo: `ver`, `cadastrar`, `alterar`, `excluir`.

| Ação | Admin | Titular | Vinculado |
|------|:----:|:------:|:---------:|
| Ver/cadastrar/alterar/inativar dados do próprio titular | sim | sim | conforme permissão do módulo |
| Ver dados de outro titular | não* | não | não |
| Criar usuário vinculado e definir permissões | sim | sim | não |
| Alterar permissões de um vinculado | sim | sim | não |
| Convidar novo titular | sim | não | não |
| Inativar/reativar usuário | sim | só os próprios vinculados | não |
| Reativar lançamento ou categoria próprios | sim | sim | com permissão `excluir` do módulo |
| Reativar qualquer registro de qualquer titular, inclusive contas e usuários | sim | não | não |
| Ver log | todo o sistema | do próprio titular | só com permissão específica de log |
| Redefinir senha de usuário | sim | não | não |

\* O admin age sobre contas e registros por meio das telas de administração, sempre com log. Ele não navega nos lançamentos de outros titulares no uso normal.

## Regras de reautenticação

- Inativar e reativar qualquer registro exigem a senha de quem está logado.
- Alterar permissões e criar vinculados também exigem senha.
- Senha errada: operação recusada e tentativa registrada no log.

## Regras de dependência

- Permissão `alterar`/`excluir` não vale sem `ver` no mesmo módulo.
- Lançar exige `cadastrar` em `lancamentos` e `ver` em `categorias` e `contas`.
- Reativar lançamento exige que categoria e conta dele estejam ativas.
- Anexos herdam a visibilidade do lançamento: sem `ver` em lançamentos, sem acesso ao anexo.

## Como está implementado (tarefa 6)

- Módulos: `lancamentos`, `categorias`, `contas`, `orcamentos`, `anexos` e `log` (este só tem `ver`). A tabela `permissao` guarda uma linha por usuário vinculado e módulo; titular e admin não usam a tabela (tudo, sempre, nos próprios dados).
- As regras de dependência valem em três camadas: validação da API, `validarRegras` e *check constraints* no banco.
- A sessão carrega as permissões **a cada requisição**: mudar as permissões vale na hora, sem novo login.
- Toda rota de módulo usa `exigirPermissao(req, reply, modulo, acao)` (401 sem login, 403 sem permissão). `podeLancar` e `podeVerAnexo` expressam as regras de dependência entre módulos.
- Criar vinculado é **por convite** (o próprio convidado define a senha; o titular nunca a conhece). Rotas: `POST /usuarios/convites`, `GET /usuarios`, `PUT /usuarios/:id/permissoes`. Todas exigem titular ou admin; as que alteram exigem a senha de quem opera.
- Usuário de outro titular responde **404** (não 403), para não revelar que existe.

### Onde cada linha da matriz é testada

| Linha | Tarefa / arquivo de teste |
|-------|---------------------------|
| Ver/cadastrar/alterar/inativar dados do próprio titular, por módulo | tarefa 6: matriz em `auth/permissoes.test.ts`; as rotas de cada módulo aplicam `exigirPermissao` nas tarefas 9 a 12 |
| Ver dados de outro titular | tarefa 14: `api/src/isolamento/isolamento.test.ts` (catálogo fecha as rotas; titular/vinculado recebem 404 ou 403 e nada muda; listas não vazam id). Usuários também em `usuarios.test.ts` |
| Criar usuário vinculado e definir permissões | tarefa 6 |
| Alterar permissões de um vinculado | tarefa 6 |
| Convidar novo titular | tarefa 5 |
| Inativar/reativar usuário | tarefa 8 (`ciclo/ciclo.test.ts`, `auth/reautenticacao.test.ts`) |
| Reativar lançamento ou categoria | tarefas 9, 11 e 12 (`GET /inativos`; reativar próprio nas rotas do módulo) |
| Reativar qualquer registro de qualquer titular | usuários e titulares: tarefa 8; categorias, contas e lançamentos: tarefa 12 (`POST /admin/.../reativar`) |
| Ver log | API na tarefa 7 (`GET /log`); tela na tarefa 13 |
| Redefinir senha de usuário | tarefa 8 (`redefinicao/redefinicao.test.ts`) |

## Testes obrigatórios

Para cada módulo e ação, um teste com vinculado sem permissão (recusa) e com permissão (aceita), e um teste de acesso entre titulares diferentes (recusa).
