# Feature flags del dual-write Firestore → PostgreSQL

**Ubicación**: Firestore doc `app_config/feature_flags`.
**Shape canónico**: ADR-009.
**Rules**: `read: authenticated` + `write: isMariano()`.
**Toggle UI**: Panel Control Mariano-only.

## Entradas nuevas en `app_config/feature_flags`

### `dual_write_pedidos_enabled`

```javascript
{
  value: false,                                 // OFF por default. Mariano activa Fase 1 (ADR-008).
  owner: 'mariano@shimano.com',
  expiryDate: '+180d',                          // Según ADR-009 — plazo largo porque ADR-008 corre 6-8 semanas.
  addedAt: '2026-11-26',
  addedBy: 'claude (S-10 base, feat/s10-dual-write-design)',
  description: 'Si true, cada write a pedidos/* se replica a PG via el trigger onPedidoWriteToPg. Default OFF hasta ADR-001 arranque + buy-in explícito Mariano. Ver docs/superpowers/plans/2026-11-26-dual-write-pedidos.md.',
  testsPath: 'tests/functions/on-pedido-write-to-pg.test.js',
}
```

**Qué activa**:
- Trigger `onDocumentWritten('pedidos/{pedidoId}')` en `functions/dual-write/on-pedido-write-to-pg.js` deja de hacer skip y empieza a replicar a PG.
- Scheduled CF `nightlyParityCheck` (si está exportada) deja de hacer skip y audit cada noche.

**Qué NO activa (requiere su propio flag)**:
- Flip de reads a PG — eso lo controla `read_from_pg_pedidos_enabled`.

**Rollback plan**: `dual_write_pedidos_enabled = false` → trigger skip-silencioso en el próximo write. PG data queda como shadow (no se borra).

---

### `read_from_pg_pedidos_enabled`

```javascript
{
  value: false,                                 // OFF default. Flip tras 7d paridad OK (ADR-008 paso 3).
  owner: 'mariano@shimano.com',
  expiryDate: '+180d',
  addedAt: '2026-11-26',
  addedBy: 'claude (S-10 base, feat/s10-dual-write-design)',
  description: 'Si true, lecturas de pedidos (consumidores server-side opt-in) vienen de PG. Flip tras 7d paridad OK en el audit nocturno. Rollback inmediato via toggle Panel Control.',
  testsPath: 'tests/unit/dual-write/read-from-pg-flag.test.js',
}
```

**Qué activa**:
- Nuevos consumidores server-side (ej. exports Excel, reports BQ sync, CF reporting) leen de PG via API REST read-only.
- Consumidores con fallback automático a Firestore si PG falla.

**Qué NO activa**:
- Listeners `onSnapshot` del cliente (siguen leyendo Firestore hasta migración de UI — fuera de scope).

**Rollback plan**: `read_from_pg_pedidos_enabled = false` → próximo tick los consumidores vuelven a Firestore. Tiempo total **< 1 minuto** (toggle UI + propagación onSnapshot Firestore sobre `app_config/feature_flags`).

---

## Setup inicial (al activar Fase 1)

Mariano via Panel Control o directamente en Firestore (admin SDK):

```javascript
// Firestore admin SDK (fuera de app, script one-shot):
await db.doc('app_config/feature_flags').set({
  dual_write_pedidos_enabled: {
    value: false,
    owner: 'mariano@shimano.com',
    expiryDate: '2027-05-25T00:00:00.000Z',
    addedAt: '2026-11-26',
    addedBy: 'mariano',
    description: 'Si true, cada write a pedidos/* se replica a PG.',
    testsPath: 'tests/functions/on-pedido-write-to-pg.test.js',
  },
  read_from_pg_pedidos_enabled: {
    value: false,
    owner: 'mariano@shimano.com',
    expiryDate: '2027-05-25T00:00:00.000Z',
    addedAt: '2026-11-26',
    addedBy: 'mariano',
    description: 'Si true, lecturas server-side de pedidos vienen de PG.',
    testsPath: 'tests/unit/dual-write/read-from-pg-flag.test.js',
  },
}, { merge: true });
```

**IMPORTANTE**: este script NO se ejecuta como parte de este PR. Es referencia para cuando Mariano decida activar. El PR deja los flags shape documentados pero NO escribe en Firestore.

## Audit log (ADR-009)

Toda escritura a `app_config/feature_flags.dual_write_pedidos_enabled` o `app_config/feature_flags.read_from_pg_pedidos_enabled` genera entry en `operations_log` type=`feature_flag_changed` con `flagName`, `oldValue`, `newValue`, `changedBy`, `timestamp`.

Patrón reusado del toggle `dep12_reparto_enabled` (§107).

## Lifecycle (ADR-009)

- **Expiry monitoreado**: panel control resalta flags con `expiryDate < now`.
- **Flag retirado (Fase 4 ADR-008)**: `dual_write_pedidos_enabled` se marca "deprecated" + keep false permanente → eventualmente drop de este doc.
- **Flag retirado si ADR-008 se cancela**: dropear ambas entries + remover código `functions/dual-write/*` + plan docs/superpowers/*.

Ver `docs/superpowers/plans/2026-11-26-dual-write-pedidos.md` para fases completas.
