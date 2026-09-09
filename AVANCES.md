# AVANCES.md — bitácora de sprints

Log resumido de trabajo grande no-trivial en el proyecto. Formato: 1 sección por sprint. Complementa a `CHANGELOG-ARCHIVE-*.md` (que es changelog por versión) y a `README.md §41` (changelog vivo).

---

## 2026-09-09 — Anti-duplicados de rendiciones (Fases 1-4)

### Motivo

Audit agosto/septiembre 2026 detectó pagos duplicados por la misma boleta. Casos confirmados:

- Ticket `00011-00001442` mauricio.gil `$6.600` aprobado 20/08 y de nuevo 31/08.
- Ticket `00017-00006675` mauricio.gil `$22.000` aprobado 21/08 (CORPORATIVA) y 31/08 (RECARGABLE).

**Total pagado de más: $28.600 en un solo mes**. Sin validación de duplicados, la única barrera era el ojo del aprobador.

Backfill dry-run sobre 199 rendiciones históricas detectó **2 duplicados fuertes adicionales** no reportados en el audit: Federico ticket `00000431` $21.000, Martin ticket `00028-00049276` $11.000.

### Diseño

3 tipos de clave canónica:

- **(a) FUERTE**: `cuit_proveedor + ticket_normalizado`
- **(b) FUERTE**: `ticket_normalizado + importe`
- **(c) DÉBIL**: `cuit_proveedor + importe + fecha_ticket`

Fuertes bloquean. Débil solo advierte (los peajes de $2.800 del mismo día con tickets distintos son legítimos).

Normalización:
- Ticket: trim + upper + separadores (`\s/\\`) → `-` + quitar 0s por segmento. `"0015-00000115"` = `"00015-00000115"` = `"15-115"`.
- CUIT: regex flexible `CUIT[^:]*:\s*(\d{2}-?\d{7,8}-?\d)` en observaciones. Retorna 11 dígitos sin separadores.
- Importe: `Math.round(N)` para evitar ruido decimal OCR.
- Fecha: `YYYY-MM-DD` del comprobante (no de carga).

Ventana lookback: **90 días**.

### Componentes implementados

| Fase | Archivo | Contenido |
|---|---|---|
| 1 | `src/pure/rendicion-duplicate.js` | `normalizarTicket`, `parseCuitDeObservaciones`, `clavesDeDuplicado`, `chequearMatchDuplicado` |
| 1 | `tests/unit/rendicion-duplicate.test.js` | 30 tests con los 7 casos reales del audit como fixtures |
| 2 | `functions/core/rendicion-duplicate-pure.js` | Copia sincronizada de `src/pure/*` (bundle CF solo empaqueta `functions/`) |
| 2 | `functions/core/rendicion-duplicate-core.js` | `checkNewRendicionDuplicate` con deps inyectables |
| 2 | `functions/index.js` | Trigger `onRendicionCreatedCheckDuplicate` en `rendiciones/{docId}` onCreate |
| 2 | `tests/functions/rendicion-duplicate.test.js` | 11 tests core con Firestore fake in-memory |
| 2 | `firestore.rules` | Impide `duplicado_detectado` → `approved` |
| 2 | `firestore.indexes.json` | Nuevo `(ownerUid, ticketNormalizado, createdAt DESC)` |
| 2 | `scripts/backfill_ticket_normalizado.py` | Dry-run + `--apply` + `--populate-only` |
| 3 | `src/domains/rendiciones.js` | Pre-check cliente al submit + populate `ticketNormalizado` + banner rojo en cards del aprobador |

### Feature flag

`app_config/rendiciones_config.antiDuplicadoEnabled` (default `true` si el doc no existe). Cuando `false`, el trigger solo popula `ticketNormalizado` pero NO chequea/bloquea. Editable desde Firebase Console sin redeploy.

### Comportamiento

**Submit cliente (Fase 3)**:
1. Pre-check consulta Firestore `(ownerUid, ticketNormalizado)` — indexado.
2. Match FUERTE contra approved/pending → **alert bloqueante** con detalle de la existente.
3. Match DÉBIL → `confirm()` explícito + flag `duplicateWarningAcknowledged`.
4. Sin match → submit normal + `ticketNormalizado` populado.

**Trigger server (Fase 2)**:
1. `onCreate` en cada `rendiciones/{docId}` nueva.
2. Query últimos 90d del mismo owner, compara claves fuertes en memoria.
3. Match fuerte contra approved/pending → marca doc como `status='duplicado_detectado'` + `duplicateOf` + `duplicateStrength='strong'` + `duplicateReason` + `duplicateDetectedAt` + `duplicateDetectedBy`.
4. Es la línea de defensa **no bypasseable** (cliente puede saltearse).

**UI aprobador (Fase 3)**:
- Banner rojo `⚠️ DUPLICADO` en cards con `status='duplicado_detectado'`.
- Link a la rendición original (`duplicateOf`).
- Motivo del match (clave completa) para diagnóstico.
- Firestore Rules: no puede pasar de `duplicado_detectado` → `approved` (admin puede pasarlo a `rejected` o volver a `pending_approval` si es falso positivo).

### Deployado

- CF `onRendicionCreatedCheckDuplicate` (southamerica-east1) — v1 activa.
- Firestore Rules (2026-09-09).
- Firestore Index `rendiciones(ownerUid, ticketNormalizado, createdAt DESC)`.

### Pendiente (Fase 5)

- [ ] Correr `python scripts/backfill_ticket_normalizado.py --apply` para poblar `ticketNormalizado` en las 199 rendiciones históricas + marcar los 4 duplicados fuertes encontrados en dry-run.
- [ ] (Opcional) Test CF con emulador — hoy tenemos mocks in-memory que cubren la lógica pero no Rules real ni el trigger onCreate real. Costo bajo, valor alto para regresiones.

### PRs

- #532 — Fase 1 (pure fn + tests)
- #533 — Fase 2 (CF + rules + indexes + backfill script)
- #534 — Fase 3 (cliente pre-check + banner aprobador)

### Métricas de tests

- Antes: 337 tests (unit + smoke + rules).
- Ahora: 378 tests (30 unit nuevos + 11 CF nuevos).
- Todos verdes.
