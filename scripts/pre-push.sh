#!/usr/bin/env bash
# scripts/pre-push.sh — gate local pre-push para app-vendedores.
#
# Corre antes de cada `git push`:
#   1. biome check  (SOLO archivos modificados en commits que se van a pushear)
#   2. tsc --noEmit (typecheck JSDoc, todo el repo)
#   3. npm run test:unit (699 tests)
#
# Si cualquiera falla → aborta el push.
# Para saltar (NO recomendado): SKIP_PREPUSH=1 git push ...
#
# Setup (una sola vez por clone): bash scripts/install-hooks.sh

set -eo pipefail

if [ "${SKIP_PREPUSH:-}" = "1" ]; then
  echo "[pre-push] SKIP_PREPUSH=1 — saltando gate (NO recomendado)"
  exit 0
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "[pre-push] Gate pre-push (biome diff + typecheck + tests)..."
START=$(date +%s)

# 1) Biome check SOLO archivos modificados en commits que se pushean.
# Compare contra origin/main. Si no hay origin/main, cae a HEAD~1.
BASE="origin/main"
if ! git rev-parse --verify "$BASE" >/dev/null 2>&1; then
  BASE="HEAD~1"
fi
CHANGED_FILES=$(git diff --name-only "$BASE..HEAD" -- '*.js' '*.ts' '*.jsx' '*.tsx' '*.cjs' '*.mjs' 2>/dev/null || true)

if [ -z "$CHANGED_FILES" ]; then
  echo "[pre-push] (1/3) biome check: 0 archivos JS/TS modificados → skip"
else
  N=$(echo "$CHANGED_FILES" | wc -l)
  echo "[pre-push] (1/3) biome check sobre $N archivo(s) modificado(s)..."
  # xargs: ejecuta biome con la lista de archivos.
  if ! echo "$CHANGED_FILES" | xargs npx biome check --no-errors-on-unmatched 2>&1 | tail -30; then
    echo ""
    echo "[pre-push] ❌ biome FAILED. Fixear con:"
    echo "            echo \"\$(git diff --name-only $BASE..HEAD)\" | xargs npx biome check --write"
    echo "[pre-push] Para saltar (NO recomendado): SKIP_PREPUSH=1 git push"
    exit 1
  fi
fi

# 2) Typecheck JSDoc (todo el repo — rapido).
echo "[pre-push] (2/3) tsc --noEmit..."
if ! npx tsc --noEmit --project tsconfig.json 2>&1 | tail -20; then
  echo ""
  echo "[pre-push] ❌ tsc --noEmit FAILED. Fixear los errores TS."
  echo "[pre-push] Para saltar (NO recomendado): SKIP_PREPUSH=1 git push"
  exit 1
fi

# 3) Unit tests.
echo "[pre-push] (3/3) npm run test:unit..."
if ! npm run test:unit 2>&1 | tail -10; then
  echo ""
  echo "[pre-push] ❌ tests FAILED."
  echo "[pre-push] Para saltar (NO recomendado): SKIP_PREPUSH=1 git push"
  exit 1
fi

END=$(date +%s)
ELAPSED=$((END - START))
echo ""
echo "[pre-push] OK — Todos los gates PASS en ${ELAPSED}s. Push autorizado."
