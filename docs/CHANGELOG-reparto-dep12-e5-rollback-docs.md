# E5 reparto-dep12 — cierre del feature (2026-11-18)

**Scope**: cierre del loop E0-E5 del feature "Reparto desde depósito en tránsito (dep 12)".

**NO toca código de producción**. Solo agrega:

1. Script de audit/rollback `scripts/audit/U_revert_dep12_asigs.cjs`.
2. Guía en README §41 "cómo activar el flag en producción".
3. Nueva sección §107 en CLAUDE.md con las reglas durables del feature.

## Antes

Después de los merges E0..E4.2 el feature está vivo en producción con el flag `dep12_reparto_enabled` **OFF** por default. Faltaba:

- Un script de rollback en caliente por si quedan líneas con `enTransito=true` tras apagar el flag.
- Una entrada en el README que resuma "cómo prender/apagar el feature".
- Una sección canónica en CLAUDE.md (§107) con las reglas durables (shape de dato, TTL, scanners, fallbacks, prohibidos).

## Problema

Sin el script U, un rollback requeriría tocar Firestore a mano por doc. Sin la guía README nadie sabe prender el flag sin bucear en los PRs. Sin §107, un futuro agente que mueva lógica de stock puede romper invariantes del feature.

## Cambio

1. **`scripts/audit/U_revert_dep12_asigs.cjs`** (nuevo, ~210 líneas).
   - Dry-run por default, `--apply` para persistir, `--limit=N` para debug.
   - Query `pedidos where closedAt==null` + filtra líneas `state='ASIG' + enTransito=true + qtyOpen>0`.
   - Decisión por línea:
     - Línea con `asigFromReparto=true + splitFromLineIndex` (creada por reconcile dep 12): revierte a `state='BO'` con `closedReason='dep12_feature_rollback'`.
     - Línea manual con flag: limpia `enTransito/asigAtTransito/enDep11At` y queda ASIG normal.
   - **§104 guard**: si al revertir la línea quedaría ASIG con `qtyOpen<=0`, se cancela directamente (`closedReason='dep12_feature_rollback_zombie'`).
   - **§55 snapshot**: cada doc tocado persiste `_backfill.U_revert_dep12_asigs_2026-11-18_v1564.previousByIdx` con los valores previos — reversible.
   - Audit JSON en `docs/auditoria/U_revert_dep12_<slug>.json` al final.

2. **README §41 entry** (nueva, principio del changelog) — guía "cómo activar / rollback" con texto §68 para Mariano.

3. **CLAUDE.md §107** (nueva, al final) — reglas durables: shape de datos (`enTransito`, `asigAtTransito`, `enDep11At`), TTL `lineReservesStock` (ASIG hard cap 30d / confirmed hard cap 60d), 3 scanners server (`createIngresosRepartoFromDelta` dep12, `scanCancelledTransito`, `scanDep12ToDep11Transitions`), safety-net `scheduledTransitoSafetyNet`, filter SAP auto-send, fail-open §77/§89, prohibido modificar shape de `warehouseBreakdown`, rollback.

4. **Tabla `operations_log.type` del feature** (en §107): `dep12_reconcile_ingresos`, `asig_cruzo_a_fisico`, `transito_cancelado`, `transito_safety_net_run`, `dep12_flag_changed`, `transito_source_missing`.

## Por qué

- §30 docs completo: una regla sin documentación muere en 2 meses.
- §55 snapshot: todo backfill con `--apply` debe ser reversible.
- §68 lenguaje: la guía la lee Mariano para prender el flag, no un dev.
- §104 guard en el script: evita generar líneas zombie durante el rollback.

## Verificación

- `npm run test:unit` + `npm run test:functions` → PASS (no cambia tests, solo agrega docs).
- `npx biome check` → clean (scripts/audit/*.cjs están ignorados por config biome, patrón histórico).
- `node scripts/audit/U_revert_dep12_asigs.cjs` (dry-run contra prod) → output legible + 0 writes.
- Lectura de §107 — cualquier agente futuro que lea CLAUDE.md antes de tocar stock ya tiene las reglas del feature.

## Rollback (del propio PR E5)

- Revertir `scripts/audit/U_revert_dep12_asigs.cjs` (archivo nuevo — simple delete).
- Revertir entry de README §41 (una sección).
- Revertir §107 de CLAUDE.md.

Nada que revertir en producción. Este PR es 100% documentación + un script admin standalone.
