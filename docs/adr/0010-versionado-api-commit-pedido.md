# ADR-0010: Versionado semver de la API `commitPedidoCF` (y pares cliente↔servidor)

- **Status**: Proposed (2026-11-26) — requiere decisión Mariano.
- **Decididores**: Mariano (owner técnico). Impacto negocio: ventana de soporte para VDE con app desactualizada.
- **Supersede**: ninguno. Formaliza el pattern ad-hoc actual (APP_VERSION numérico monotónico `v1xxx`).
- **Relacionado**: ADR-008 (migración no-downtime), ADR-009 (feature flags), CLAUDE.md §74 (gate `VENDOR_UID_MISSING`), §108 (gate `INTERNO_CLIENTE_FUERA_DE_PAREJA`).

## Contexto

La app cliente y el Cloud Function `commitPedidoCF` hablan un payload estructurado en cada confirmación. Hoy el versionado es un entero monotónico (`APP_VERSION='v1587'`) que el cliente manda en cada callable. El servidor rechaza con `VERSION_OLD` si está debajo del piso configurado en `app_config/version_minima` (v1572 activado el 2026-11-26 10:59 ART).

**No hay reglas escritas** de qué tipo de cambio es breaking vs backward-compatible. Precedentes del impacto:

1. **v1577 `INTERNO_CLIENTE_FUERA_DE_PAREJA`** (gate nuevo server-side): rejects silenciosos de internos hasta S-7 #1447 (6 días). Un interno con app en `v1576` no veía nada raro — el gate corría igual en el server. El rollback vino al mergearse el fix.
2. **v1475 `SKU_NOT_IN_SAP_CATALOG`** (ADR §77, v1480): fuente de datos vacía → 100% rebotes por 15h. El cliente mostraba el mensaje "SKU inexistente" con el `errorCode` crudo en pantalla (pre-§68).
3. **v1486 shape `createdAt` Timestamp → ISO** (§85, §103): clientes con bundle viejo (pre-v1486) no rompían porque la query del Planner era del server. Pero scripts Python que leían directo rompieron con `AttributeError: 'str' object has no attribute 'isoformat'` por 37 horas.

**El problema concreto que viene**: ADR-001 (modelo nuevo `pedido_lines` + `stock_reservations`) va a requerir un bump que invalide clientes con app vieja. Hoy la convención ad-hoc es "bumpear `version_minima` cuando algo rompe". Sin reglas escritas, la decisión es ad-hoc + el VDE con 3G débil y app cacheada 2 días atrás queda bloqueado sin preaviso.

## Decisión propuesta

### Tres opciones evaluadas

**Opción A — Status quo (numérico monotónico + `version_minima` bump manual).** Cero esfuerzo hoy. Caro mañana: cada cambio decide ad-hoc si se bumpea el piso. Sin regla escrita de MAJOR vs MINOR. Precedente recurrente de rebotes silenciosos para VDE con app stale (§100 `clearPersistence` ayuda pero no cubre el gap en apps muy viejas).

**Opción B — Semver (MAJOR.MINOR), reglas documentadas, piso declarativo (RECOMENDADA).** Numeración `v<N>.<M>.<K>`:
- `MAJOR` = cambio **breaking**: nuevo campo requerido en payload, gate server que rechaza payloads viejos, shape de doc que el cliente no sabe leer. **Cliente debe actualizarse**.
- `MINOR` = agregado backward-compatible: campo nuevo opcional en payload, errorCode nuevo con fallback humano en bundle stale (§68 pattern), gate nuevo que FAIL-OPENS si falta data cliente (§77).
- `PATCH` = fix de bugs o tweaks internos sin cambio de contrato.

Cada PR declara en el commit msg o PR body: `release: MAJOR | MINOR | PATCH`. El `app_config/version_minima` se escribe como `{minMajor: N, minMinor: 0}` (patch no cuenta). Server rechaza si `clientVersion < {minMajor, minMinor}` por comparación semver.

Costo: 2–3 semanas-persona.
- Migrar `APP_VERSION='v1587'` → `APP_VERSION='v1.0.0'`.
- Migrar `app_config/version_minima` de scalar `v1572` → `{minMajor:1, minMinor:0}` + compat durante 30 días con el shape viejo.
- Escribir reglas en `docs/commit-pedido-api.md` describiendo cada campo + en qué version se agregó + cuál version marca su deprecación.
- Agregar test de contrato en `tests/unit/audit/semver-pattern.test.js` que valide que cada errorCode nuevo tenga fallback humano (§68) y cada gate nuevo tenga fail-open (§77).

**Opción C — Negociación activa en cada request.** Cliente manda `{supports: ['1.0', '1.1', '1.2']}` y server elige la mejor. Pattern Netflix/Google para APIs expuestas a terceros. **Overkill** para 15 VDEs + 2k writes/día. 5–7 semanas-persona.

### Pattern obligatorio cuando se apruebe Opción B

1. **Semver estricto** en `APP_VERSION` + en el payload del callable.
2. **PR body declara el tipo**: `release: MAJOR | MINOR | PATCH`. Verificable por un check CI (grep del PR body o del commit msg).
3. **MAJOR bump requiere**:
   - Pre-anuncio (slack/mail) **2 semanas antes** del bump efectivo.
   - Script de audit `scripts/audit/pre_major_bump_<version>.cjs` que cuenta cuántos VDE tienen la app actualizada antes del bump. Si <80%, posponer.
   - Mensaje humano en el cliente (§68) cuando el `VERSION_OLD` dispare: "Hay una versión nueva importante. Actualizá tu app antes del DD/MM." (hoy el mensaje existe en v1471, pero sin la fecha).
4. **MINOR bump**:
   - Campo nuevo en payload es siempre opcional (fallback sensato si falta).
   - ErrorCode nuevo tiene entrada en `MENSAJES_VENDEDOR` (§68) + fallback inline en `_SERVER_ERROR_FALLBACK_TEXTS` para bundle stale.
   - Gate nuevo tiene fail-open si la fuente de datos no está poblada (§77).
   - Gate nuevo tiene test con rol VDE de prueba (§90).
5. **Ventana de soporte**: server mantiene las últimas **2 versiones minor** de la major vigente (ej. en `v1.5`, acepta `v1.3+`). Versiones anteriores → `VERSION_OLD` con fecha de EOL.
6. **Compat shape doble escritura durante bump**: por 30 días post-MAJOR, server acepta payload viejo + payload nuevo, con pure helper que normaliza al nuevo.

## Consecuencias

### Bueno

- Reglas escritas de qué es breaking vs compat. Los PRs explicitan el impacto antes del merge.
- Rollback semántico: un MAJOR tiene plan de rollout definido (pre-anuncio + audit + ventana de soporte).
- Alinea con el pattern que ya existe para feature flags (ADR-009) — el versionado es la contraparte del flag para cambios estructurales.
- Si llega auditoría o certificación (ISO, SOC2), el versionado documentado es un requisito.

### Malo

- Costo upfront 2–3 semanas-persona.
- La convención semver obliga a decidir cada PR su tipo. Fricción menor para el dev pero no cero.
- La ventana de soporte N-2 obliga al server a mantener compat con payloads viejos por ~60 días post-MAJOR → código server con rama de compat temporal → más superficie para bugs. Mitigado por tests de contrato.
- Si un error de clasificación mete un breaking como MINOR, el server rebota VDE con app vieja sin preaviso. Mitigación: checklist §90 + el test de contrato.

### Lo que NO cambia

- `commitPedidoCF` sigue siendo un callable único. El versionado no requiere endpoints paralelos.
- Rules Firestore no cambian.
- El flujo de deploy (PR → squash → Pages/Functions) sigue.
- Panel Control del flag `version_minima` queda. El toggle cambia el shape del campo pero no la UX.

## Qué invalidaría la recomendación

- **Modo mantenimiento**: si el proyecto entra en freeze (sin breaking changes planificados por 12+ meses), Opción A alcanza y el costo de B no paga.
- **ADR-004 pass a React/Next**: el stack frontend nuevo tendría otras convenciones. Revisar.
- **Sistema CRM externo lo reemplaza**: toda la deuda queda deprecada.

## Verification

Este ADR no genera scripts ni tests directo hasta que se apruebe. Cuando pase a Accepted, el plan de implementación debe incluir:

- `tests/unit/audit/semver-pattern.test.js` — valida que `APP_VERSION` matchea regex `v\d+\.\d+\.\d+` + que cada PR agrega al menos un test por errorCode nuevo + que el `MENSAJES_VENDEDOR` tiene entry por cada code emitido server.
- `scripts/audit/pre_major_bump_<ver>.cjs` — count de clientes activos por version en los últimos 7 días. Lee `operations_log` por `clientVersion`.
- `docs/commit-pedido-api.md` — doc vivo del contrato: cada campo del payload + cada errorCode + en qué version se agregó/deprecó.
- CLAUDE.md sección nueva (ej. §109) que describe el pattern + los triggers de MAJOR bump.

## Pendiente de Mariano

1. Confirmar si el costo 2–3 semanas-persona es aceptable antes de ADR-001.
2. Elegir ruta de migración `v1587` → `v1.0.0`: limpia (reset a `v1.0.0` el día X) o incremental (`v1.0.<N>` donde `N = 1587`).
3. Confirmar si el pre-anuncio de 2 semanas aplica a todos los MAJOR o solo a los que ADR-008 (migración) involucren.
4. Firmar o rechazar cuando ADR-001 se habilite (porque ese es seguro un MAJOR).
