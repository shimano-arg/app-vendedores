#!/usr/bin/env bash
# scripts/install-hooks.sh — instala los git hooks locales.
# Correr una vez por clone del repo. Idempotente.
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOOK="$ROOT/.git/hooks/pre-push"

cat > "$HOOK" <<'EOF'
#!/usr/bin/env bash
# AUTO-GENERADO por scripts/install-hooks.sh. Delega al script versionado.
exec bash "$(git rev-parse --show-toplevel)/scripts/pre-push.sh" "$@"
EOF

chmod +x "$HOOK"
echo "[install-hooks] .git/hooks/pre-push instalado OK → delega a scripts/pre-push.sh"
echo "[install-hooks] Para saltar en un push puntual: SKIP_PREPUSH=1 git push ..."
