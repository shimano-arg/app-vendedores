# ADR-0012: Gobernanza de cron workflows

- **Status**: Accepted (2026-11-25).
- **Decididores**: Mariano (owner técnico).
- **Supersede**: ninguno (nueva gobernanza).
- **Relacionado**: CLAUDE.md §60 (precedente de migración selectiva a Cloud Scheduler).

## Contexto

El repo tiene **40 workflows GHA** (verificado 2026-11-25 con `ls .github/workflows/*.yml`), de los cuales **22 tienen `schedule:` definido**.

Problemas conocidos (ver STACK_00 §2.6):

1. **Sin dueños**: nadie sabe quién arregla los workflows rojos. Hay 5 workflows reportados en rojo 100%:
   - `audit-waitlist-integrity.yml`
   - `bo-daily-audit.yml`
   - `sync-sap-ortt-daily.yml`
   - `snapshot-avgprice-sl.yml`
   - `reclamos-keepalive.yml`
2. **Sin SLA de fix**: pueden quedar rojos indefinidamente.
3. **Sin alerta de criticality**: `operations_log` no recibe eventos de cron fallidos.
4. **Workflows `probe-*`** (6) abandonados (dispatch-only, sin schedule). Ruido en la UI.

Precedente positivo (CLAUDE.md §60, v1456 2026-10-25): el cron del workflow `sync-sap-catalog-stock.yml` fue **removido** en favor de Cloud Scheduler (más confiable que GHA cron, que saltea runs bajo saturación). Queda como `workflow_dispatch` con step `Notify failure` por email.

## Decisión

### Header obligatorio en todo workflow con `schedule:`

Cada workflow con `schedule:` debe incluir en el header un bloque de comentarios con el siguiente shape:

```yaml
name: <Nombre descriptivo>

# Owner: erbinomariano@gmail.com (o rol/email del responsable)
# SLA: cada N min / cada X horas / diario
# Criticality: low | medium | high
# Si falla 3 corridas seguidas: alerta a owner via <email | WhatsApp bot | Panel Control>.
# Migrar a Cloud Scheduler si criticality=high (ver §60).

on:
  schedule:
    - cron: ...
```

**Campos**:

| Campo | Valores aceptados | Significado |
|---|---|---|
| `Owner` | email o rol | Quién recibe la alerta cuando falla. |
| `SLA` | `cada N min`, `cada N horas`, `diario`, `semanal` | Cadencia esperada. |
| `Criticality` | `low` / `medium` / `high` | Dicta qué pasa si falla. |

**Comportamiento por criticality**:

- `low` → review mensual, sin alerta automática.
- `medium` → alerta email al owner tras 3 fallos consecutivos.
- `high` → alerta inmediata + candidato a migrar a Cloud Scheduler (§60).

### Migración selectiva a Cloud Scheduler (CF)

Workflows candidatos para migrar (criticality=high + cadencia estricta requerida):

- `sync-sap-catalog-stock.yml` — **YA migrado** a `syncSapCatalogStockCF` (§60).
- `reconcile-repartos-faltantes` — candidato futuro (patrón similar).
- `sync-sap-to-bigquery.yml` — candidato futuro (depende de fiabilidad BQ).

Workflows no-críticos pueden quedarse en GHA (low o medium).

### Workflows `probe-*`

Los 6 workflows `probe-*` (dispatch-only, sin schedule) quedan documentados como "diagnósticos manuales" en el audit. Candidato a archivar en PR separado.

### No se tocan workflows en este PR

Este ADR **solo documenta y crea el audit script**. La aplicación del header en cada workflow es tarea separada por workflow (requiere revisar cadencia real + criticality + owner caso por caso).

## Consecuencias

### Positivas

- Audit script detecta workflows sin header → visibilidad del gap actual.
- Patrón claro para nuevos workflows: template con el header obligatorio.
- Base para extender con alertas automáticas (ADR-006).

### Negativas

- Depende de disciplina humana para mantener los headers actualizados.
- Los 22 workflows actuales con `schedule:` NO tienen el header hoy — el audit va a listarlos todos como "pendiente".

### Trade-offs aceptados

- No forzamos migración masiva a Cloud Scheduler (opción 3 de STACK_10 §ADR-012). Overkill para 22 workflows; migración selectiva caso por caso.
- No automatizamos la alerta todavía — eso vive en ADR-006 observabilidad.

## Verificación

Un artefacto:

**Script audit (read-only)**: `scripts/audit/cron_governance_audit.cjs` — parsea todos los workflows en `.github/workflows/*.yml`, identifica los que tienen `schedule:`, verifica si tienen el bloque header `Owner/SLA/Criticality`, reporta los que NO cumplen.

Output esperado:

```
Workflows con schedule: N
Workflows con Owner/SLA/Criticality header: M
Workflows SIN header completo: K (listados)
```

El script es read-only. NO modifica workflows. Correrlo manualmente o incorporarlo en CI (ADR separado si hace falta).

## Decisiones abiertas

- **Alertas automáticas**: pattern (email vs WhatsApp bot vs Panel Control) depende de ADR-006.
- **Archivo de workflows `probe-*`**: tarea separada post-ADR-012.
- **Umbral de fallos para alerta** (hoy: 3 consecutivos): revisable si genera ruido.

## Referencias

- CLAUDE.md §60 — precedente Cloud Scheduler (sync-sap-catalog-stock).
- STACK_00 §2.6 — 5 workflows rojos reportados.
- STACK_11 — 6 workflows `probe-*` abandonados.
- STACK_10 §ADR-012 — propuesta original + opciones consideradas.
