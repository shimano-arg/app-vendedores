# scripts/audit/archive/

**Fecha de archivado**: 2026-11-25 (Stack CRM Sesión S-7, STACK_25 P2-B).
**Autorizado por**: Mariano (plan STACK_11 §P2-B).

## Propósito

Scripts de auditoría one-shot cuya tarea ya concluyó. Movidos acá en vez de
borrarse para preservar historia + código reutilizable como referencia.

## Criterios de archivado

Un script es candidato cuando cumple TODOS:
1. **0 referencias** fuera del propio archivo en builds, workflows, CLAUDE.md,
   README.md, tests, docs ni otros scripts (verificado por grep recursivo).
2. **No está en `.github/workflows/*.yml`** como paso a ejecutar.
3. **Antigüedad >= 3 semanas** (commit más reciente anterior a 2026-11-01).
4. **Scope one-shot**: backfill puntual, investigación cerrada, dry-run auditado.

## Scripts preservados en `scripts/audit/`

Los siguientes NO se archivan (healthcheck / referenciados en CI):
- `BE_detect_sobreasig_daily.cjs` (cron `audit-sobreasig-daily.yml`).
- `A_pachi_zona_z4_master_desalineado.cjs` (cron `audit-zona-vendor-master.yml`).
- `BA_sap_tls_smoke.cjs` (health check SAP TLS).
- `live_sl_counts.cjs` (healthcheck SL).
- `query_e2e_altas.cjs` (fixture E2E).
- `dump_sqs_fixture.cjs` (fixture).
- Scripts con commit >= 2026-11-01 (sesiones activas).

## Restauración

Si un script archivado vuelve a ser útil:
```bash
git mv scripts/audit/archive/NOMBRE.cjs scripts/audit/NOMBRE.cjs
```

## Catálogo

Ver subdirectorios por fecha de origen (lote de archivado). Todos los scripts
mantuvieron su historial git (`git log --follow`).
