#!/usr/bin/env bash
# Backup diário do banco do FINAN (tarefa 16).
#
#   pg_dump (formato custom) -> criptografa com a CHAVE PÚBLICA (gpg) -> grava em BACKUP_DIR
#   -> confere o arquivo -> copia para o destino externo -> apaga o que passou da retenção.
#
# A chave privada NÃO fica no servidor: quem invadir a VPS não consegue ler os backups.
# Guarde a chave privada (e uma cópia dela) fora da VPS, com a senha num gerenciador.
#
# Conexão: variáveis padrão do PostgreSQL (PGHOST, PGPORT, PGUSER, PGDATABASE e PGPASSWORD ou
# PGPASSFILE). Nunca passe a senha na linha de comando: ela apareceria na lista de processos.
# Use um papel com SELECT em tudo (o dono, finan_owner, serve).
#
# Configuração (ex.: /etc/finan/backup.env, modo 600, carregada pelo systemd):
#   BACKUP_GPG_RECIPIENT   obrigatório: e-mail ou impressão digital da chave pública
#   BACKUP_DIR             padrão /var/backups/finan
#   BACKUP_RETENCAO_DIAS   padrão 14
#   BACKUP_DESTINO_EXTERNO opcional: destino do rsync sobre ssh (usuario@host:/caminho/)
set -euo pipefail
umask 077

DIR="${BACKUP_DIR:-/var/backups/finan}"
RETENCAO="${BACKUP_RETENCAO_DIAS:-14}"
: "${BACKUP_GPG_RECIPIENT:?Defina BACKUP_GPG_RECIPIENT (chave pública que criptografa o backup)}"
: "${PGDATABASE:?Defina PGDATABASE (e PGHOST/PGUSER/PGPASSWORD ou PGPASSFILE)}"
[[ "$RETENCAO" =~ ^[0-9]+$ && "$RETENCAO" -ge 1 ]] || { echo "BACKUP_RETENCAO_DIAS inválido" >&2; exit 2; }

mkdir -p "$DIR"
carimbo="$(date +%Y%m%d-%H%M%S)"
final="$DIR/finan-$carimbo.dump.gpg"
parcial="$final.parcial"
trap 'rm -f "$parcial"' EXIT

echo "[$(date -Is)] backup de $PGDATABASE iniciado"
# pipefail garante que falha do pg_dump ou do gpg aborta o script.
pg_dump --format=custom --no-owner --no-privileges \
  | gpg --batch --yes --trust-model always --encrypt --recipient "$BACKUP_GPG_RECIPIENT" --output "$parcial"

# Conferência: arquivo não vazio e legível como pacote gpg.
[[ -s "$parcial" ]] || { echo "backup vazio" >&2; exit 1; }
gpg --batch --list-packets "$parcial" >/dev/null 2>&1 || { echo "arquivo gpg inválido" >&2; exit 1; }
mv "$parcial" "$final"
trap - EXIT
echo "[$(date -Is)] gravado: $final ($(du -h "$final" | cut -f1))"

# Cópia externa (se configurada). Falhar aqui falha o backup: cópia só local não basta.
if [[ -n "${BACKUP_DESTINO_EXTERNO:-}" ]]; then
  rsync --archive --partial -e "ssh -o BatchMode=yes" "$final" "$BACKUP_DESTINO_EXTERNO"
  echo "[$(date -Is)] copiado para o destino externo"
else
  echo "AVISO: BACKUP_DESTINO_EXTERNO não definido; só existe cópia local." >&2
fi

# Retenção: só arquivos deste script, com mais de N dias.
find "$DIR" -maxdepth 1 -type f -name 'finan-*.dump.gpg' -mtime "+$RETENCAO" -print -delete \
  | sed 's/^/removido (retenção): /'
echo "[$(date -Is)] backup concluído"
