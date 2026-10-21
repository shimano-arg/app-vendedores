# E1 — Compat check: órdenes ya unificadas con CPST absorbida (pre-v1382)

**Script:** `scripts/audit/E_contar_unificadas_con_cpst.cjs --prod`
**Fecha:** 2026-10-20 22:42 UTC-3.
**Modo:** `--prod` (read-only, autorización A1 heredada).

## Resultado

```
[prod] Scanning revision_waitlist con unifiedFrom populated...
[prod] docs leidos: 42
[prod] con unifiedFrom populated: 1

===== RESULTADO Query E =====
Total ordenes unificadas con CPST absorbida: 0
```

**Total órdenes unificadas con CPST absorbida: 0.**

## Interpretación

El feature "Unificar orden" (v1284) está en prod desde 2026-10-20. Al momento del scan hay:
- **42 docs totales** en `revision_waitlist`.
- **1 orden ya unificada** (con `unifiedFrom` populated).
- **0 de esas unificaciones absorbieron un CPST** (`source='stock-asignado-batch'` con `pedidosOrigenes[]`).

La única orden unificada en prod absorbió waitlists normales → **no está afectada por los bugs P2/P3** que esta tarea arregla.

## Conclusión

- **Sin acción manual necesaria** por Mariano para órdenes pre-v1382.
- Post-deploy v1382, cualquier nueva unificación que absorba un CPST aplicará automáticamente el fix (identidad por línea).
- El script E queda en el repo para futuros audits/debugging.
