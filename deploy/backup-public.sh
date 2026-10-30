#!/usr/bin/env bash
set -euo pipefail
umask 077

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
env_file="${SQUABBLE_ENV_FILE:-$repo_root/.env.production}"
backup_dir="${SQUABBLE_BACKUP_DIR:-$repo_root/backups}"
compose_args=(--env-file "$env_file" -f "$repo_root/deploy/compose.public.yml")
if [[ -n "${SQUABBLE_COMPOSE_PROJECT:-}" ]]; then
  compose_args+=(-p "$SQUABBLE_COMPOSE_PROJECT")
fi

if [[ ! -f "$env_file" ]]; then
  echo "Missing deployment environment file: $env_file" >&2
  exit 1
fi

mkdir -p "$backup_dir"
backup_file="$backup_dir/squabble-$(date -u +%Y%m%dT%H%M%SZ).dump"
if ! docker compose "${compose_args[@]}" \
  exec -T db pg_dump -U postgres -d portfolio -Fc > "$backup_file"; then
  rm -f -- "$backup_file"
  exit 1
fi
if [[ ! -s "$backup_file" ]]; then
  rm -f -- "$backup_file"
  echo "Backup is empty" >&2
  exit 1
fi
echo "Created: $backup_file"
