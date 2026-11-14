#!/usr/bin/env bash
# Restaura (ou só confere) um backup do FINAN. Precisa da CHAVE PRIVADA no chaveiro do gpg.
#
#   restaurar.sh --verificar ARQUIVO.dump.gpg
#       Restaura num banco temporário, confere as tabelas principais e apaga o temporário.
#       É o "restauração testada" da tarefa 16: rode depois de montar o backup e a cada trimestre.
#
#   restaurar.sh --para NOME_DO_BANCO ARQUIVO.dump.gpg
#       Restaura num banco NOVO (precisa não existir). Nunca sobrescreve um banco existente.
#
# Conexão: PGHOST, PGPORT, PGUSER, PGPASSWORD (ou PGPASSFILE). O papel precisa poder criar bancos.
set -euo pipefail
umask 077

modo="${1:-}"; alvo=""; arquivo=""
case "$modo" in
  --verificar) arquivo="${2:-}"; alvo="finan_verificacao_$(date +%s)_$$" ;;
  --para) alvo="${2:-}"; arquivo="${3:-}" ;;
  *) echo "uso: restaurar.sh --verificar ARQUIVO | --para NOME_DO_BANCO ARQUIVO" >&2; exit 2 ;;
esac
[[ -n "$arquivo" && -f "$arquivo" ]] || { echo "arquivo de backup não encontrado" >&2; exit 2; }
[[ "$alvo" =~ ^[a-z_][a-z0-9_]{0,62}$ ]] || { echo "nome de banco inválido (use minúsculas, números e _)" >&2; exit 2; }

existe="$(psql --dbname=postgres --tuples-only --no-align --command "SELECT 1 FROM pg_database WHERE datname = '$alvo'")"
[[ -z "$existe" ]] || { echo "o banco '$alvo' já existe; escolha outro nome (este script não sobrescreve)" >&2; exit 1; }

createdb "$alvo"
limpar() { [[ "$modo" == "--verificar" ]] && dropdb --if-exists "$alvo" >/dev/null 2>&1 || true; }
trap limpar EXIT

gpg --batch --decrypt "$arquivo" | pg_restore --no-owner --no-privileges --exit-on-error --dbname="$alvo"

q() { psql --dbname="$alvo" --tuples-only --no-align --command "$1"; }
for tabela in titular usuario categoria conta lancamento log; do
  n="$(q "SELECT count(*) FROM $tabela")"
  printf '%-12s %s linhas\n' "$tabela" "$n"
done
[[ "$(q "SELECT count(*) FROM titular")" -ge 1 ]] || { echo "restauração sem titulares: algo está errado" >&2; exit 1; }

if [[ "$modo" == "--verificar" ]]; then
  echo "OK: backup restaurado e conferido (banco temporário removido)."
else
  echo "OK: restaurado em '$alvo'. Aponte DATABASE_URL para ele para usar."
fi
