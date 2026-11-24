# Backup e recuperação

Decisão 25: backup diário com `pg_dump`, retenção de 14 dias e cópia externa criptografada,
**obrigatório antes de convidar qualquer pessoa**. Scripts em `deploy/`.

## Como funciona

1. `deploy/backup.sh` roda todo dia às 03:30 (`finan-backup.timer`).
2. Faz `pg_dump` em formato custom e **criptografa com a chave pública** (gpg).
   A chave privada **não fica na VPS**: invadir o servidor não dá acesso aos backups.
3. Confere o arquivo, grava em `/var/backups/finan/finan-AAAAMMDD-HHMMSS.dump.gpg` (modo 600).
4. Copia para o destino externo por `rsync` sobre ssh (`BACKUP_DESTINO_EXTERNO`). Se a cópia falha, o backup falha.
5. Apaga arquivos de backup com mais de 14 dias (só os `finan-*.dump.gpg`).

A conexão usa as variáveis padrão do PostgreSQL (`PGHOST`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`),
nunca a senha na linha de comando. Use um papel com leitura em tudo (o dono, `finan_owner`).

## Configurar na VPS (tarefa 15)

```bash
# 1) Gere o par de chaves FORA da VPS (no seu computador) e exporte só a pública:
gpg --quick-generate-key "backup@finan" default default 5y
gpg --export backup@finan > finan-backup.pub     # copie este arquivo para a VPS

# 2) Na VPS, como o usuário finan:
gpg --import finan-backup.pub
# 3) /etc/finan/backup.env (modo 600, dono root):
#    PGHOST=127.0.0.1  PGUSER=finan_owner  PGPASSWORD=...  PGDATABASE=finan
#    BACKUP_GPG_RECIPIENT=backup@finan
#    BACKUP_DESTINO_EXTERNO=usuario@destino:/backups/finan/
# 4) Instale as unidades e ative:
sudo cp deploy/finan-backup.{service,timer} /etc/systemd/system/
sudo systemctl enable --now finan-backup.timer
sudo systemctl start finan-backup.service && journalctl -u finan-backup -n 20
```

Guarde a **chave privada** e a senha dela em dois lugares fora da VPS. Sem ela, não há restauração.

## Testar a restauração (critério da tarefa 16)

No computador que tem a chave privada, com acesso a um PostgreSQL onde se possa criar bancos:

```bash
deploy/restaurar.sh --verificar finan-AAAAMMDD-HHMMSS.dump.gpg
```

Restaura num banco temporário, conta as linhas das tabelas principais e apaga o temporário.
Repita a cada trimestre e depois de qualquer mudança no esquema. Para recuperar de verdade:

```bash
deploy/restaurar.sh --para finan_recuperado finan-AAAAMMDD-HHMMSS.dump.gpg
```

O script nunca sobrescreve um banco existente. Depois aponte `DATABASE_URL` para o novo banco.

## O que já foi verificado (14/11/2026, banco de teste local)

- O backup gera o arquivo criptografado (modo 600), que descriptografa com a chave privada e traz todas as tabelas.
- **Não verificado ainda:** a restauração completa (`restaurar.sh`) e o envio por `rsync`. A restauração
  precisa de um papel que crie bancos, que o ambiente local não tem; o destino externo ainda não existe.

# Recuperar a senha do administrador

O admin não tem a quem pedir o link de redefinição. No servidor:

```bash
cd /opt/finan && npm run admin:redefinir -- --email=admin@exemplo.com
```

Imprime um link de uso único, válido por 24 h. Quem abre o link define a nova senha, e todas as
sessões antigas caem. Vale só para administradores ativos. O pedido entra no log como
`redefinicao.criada` com `via: "cli"`. Para os demais usuários, o admin gera o link pela tela.

## Limpeza de sessões e tentativas de login

`npm run manutencao:limpar -w api` (`api/src/cli/limpar.ts`) roda todo dia às 04:15
(`finan-limpeza.timer`), depois do backup. Usa o papel dono (`MIGRATE_DATABASE_URL`), porque o
papel da API não tem `DELETE`.

Retenção (padrão **30 dias**, ajustável por `LIMPEZA_RETENCAO_DIAS`, de 1 a 3650):

- **Sessões** revogadas há mais de 30 dias, ou criadas há mais de 30 dias + 12 h (já expiradas
  pela duração máxima, mesmo sem revogação). Sessões válidas nunca são tocadas.
- **Tentativas de login** com mais de 30 dias. O limite usa só os últimos 15 min.
- O **log de auditoria não é limpo**: é imutável por gatilho.

```bash
# /etc/finan/limpeza.env (modo 600, dono root):
#    MIGRATE_DATABASE_URL=postgres://finan_owner:...@127.0.0.1:5432/finan
#    LIMPEZA_RETENCAO_DIAS=30
sudo cp deploy/finan-limpeza.{service,timer} /etc/systemd/system/
sudo systemctl enable --now finan-limpeza.timer
sudo systemctl start finan-limpeza.service && journalctl -u finan-limpeza -n 20
```
