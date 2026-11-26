# ADR-0009: Gobernanza de feature flags

- **Status**: Accepted (2026-11-25).
- **Decididores**: Mariano (owner técnico).
- **Supersede**: ninguno (nueva gobernanza; patrón ad-hoc previo documentado en CLAUDE.md §107).
- **Relacionado**: ADR-008 (migración no-downtime) — bloqueado hasta que este lifecycle exista.

## Contexto

El repo usa feature flags hoy:

- `src/pure/feature-flags.js` + `functions/core/feature-flags.js` — pares pure cliente + espejo server (patrón §57).
- `app_config/feature_flags` (doc Firestore) — storage de los valores.
- Rules: `read: authenticated + write: isMariano()` (CLAUDE.md §107).
- Flag activo hoy: `dep12_reparto_enabled` (default false). Controlado via toggle en Panel Control Mariano-only.

Problemas:

1. **Sin lifecycle formal**: no hay doc que diga quién puede agregar/retirar flags, cuándo retirar un flag muerto, cuántos tests requiere cada flag (flag-on + flag-off), expiry por default.
2. **Precedente §77 (v1480, 2026-10-27)**: gate `SKU_NOT_IN_SAP_CATALOG` validaba contra `sap_products/{sku}` que nadie poblaba → **100% de confirmaciones rechazadas 15 horas**. Un lifecycle con "test de flag-on vs flag-off + verificación post-deploy" lo hubiera atrapado.
3. **Sin audit log formal**: el toggle del flag `dep12_reparto_enabled` escribe `dep12FlagChangedAt/By` inline en el doc, pero no hay convención escrita de que todo flag nuevo debe tener ese audit.

## Decisión

### Shape canónico del flag

Cada entrada en `app_config/feature_flags.<flagName>` tiene el siguiente shape:

```
{
  value: boolean,          // valor efectivo del flag
  owner: string,           // email del responsable del flag
  expiryDate: string,      // ISO date. Default +90 días desde addedAt.
  addedAt: string,         // ISO timestamp del alta del flag
  addedBy: string,         // email de quien lo creó
  lastChangedAt: string,   // ISO timestamp del último toggle
  lastChangedBy: string,   // email del último toggler
  description: string,     // qué hace el flag, en lenguaje simple
  testsPath: string        // path al archivo test que lo cubre (flag-on + flag-off)
}
```

Compat: el campo legacy `value: boolean` sigue siendo autoritativo (los consumidores `readFlag(doc, key, default)` ya lo leen). Los campos de gobernanza son metadata adicional.

### Alta de flag nuevo

1. Agregar entrada en `app_config/feature_flags` con el shape completo. `owner`, `expiryDate`, `description`, `testsPath` son **obligatorios**.
2. Escribir el pure helper en `src/pure/feature-flags.js` + espejo en `functions/core/feature-flags.js` (patrón §57).
3. Agregar tests obligatorios:
   - Un test con el flag en `true` que verifica el camino nuevo.
   - Un test con el flag en `false` que verifica el camino histórico.
   - Un test de compat con fuente vacía/malformada (`readFlag(null, key, default) === default`).
4. Documentar en CLAUDE.md una sección nueva (ej. §107 para dep12) con el flow completo.

### Audit log

Cada escritura a `app_config/feature_flags.<flag>` escribe también a `operations_log` con shape:

```
{
  type: 'feature_flag_changed',
  flagName: 'dep12_reparto_enabled',
  oldValue: false,
  newValue: true,
  changedBy: 'erbinomariano@gmail.com',
  reason: 'manual_rollout',  // opcional
  timestamp: ServerTimestamp
}
```

Fire-and-forget. No bloquea el toggle si el log falla.

Patrón ya existente para el toggle `dep12_reparto_enabled` (ver CLAUDE.md §107, type `dep12_flag_changed`). ADR-009 lo generaliza con el type canónico `feature_flag_changed`.

### Rotación por expiry

- Un flag pasa su `expiryDate` → el Panel Control (Mariano-only) muestra una fila "FLAG VENCIDO" con botón "Prolongar 90d" o "Retirar flag".
- Después de 30 días post-expiry sin acción → el flag queda bloqueado con un rollback plan documentado en su `description`.

Implementación detallada queda para ADR-006 (observabilidad) + Panel Control (tarea aparte). ADR-009 solo fija el contrato de datos y el pattern.

### Comportamiento ante fuente vacía (fail-open)

Patrón §77: todo gate que lea un flag `app_config/feature_flags` DEBE implementar fail-open si:
- El doc no existe.
- El flag no está en el doc.
- El read falla por permission/timeout.

El helper `readFlag(doc, key, defaultValue)` ya lo cubre: devuelve `defaultValue` cuando `doc` es `null`, no es object, o el campo no es boolean.

## Consecuencias

### Positivas

- Lifecycle explícito para cada flag — nunca quedan flags huérfanos.
- Audit log de cada toggle → observabilidad post-incidente.
- Alineación con §77/§78/§89/§90 (defensa en profundidad para gates server-side).
- Habilita ADR-008 (migración no-downtime) que necesita el flag con expiry controlado.

### Negativas

- Depende de disciplina humana para el review mensual de expiry.
- Doble write por cada toggle (flag + log) — costo mínimo (~5-10ms).
- Si Mariano se olvida de poblar `owner`/`expiryDate` al crear un flag, el test de gobernanza falla y bloquea el PR.

## Verificación

Tres artefactos:

1. **Test**: `tests/unit/audit/feature-flags-governance.test.js` — verifica que `src/pure/feature-flags.js` sigue exponiendo `readFlag` con fallback defensivo, y documenta el contrato esperado del shape de `app_config/feature_flags`.

2. **Script audit (read-only)**: `scripts/audit/feature_flags_audit.cjs` — lee `app_config/feature_flags` en prod, imprime tabla de flags con `owner`, `expiryDate`, `testsPath`, días restantes hasta expiry. Útil para el workflow mensual de revisión + watchdog Panel Control.

3. **Panel Control** (tarea futura, fuera de este PR): toggle Mariano-only mostrando los flags activos + alerta visual si `expiryDate < now`.

## Decisiones abiertas

- **Review mensual**: ¿lo hace Mariano a mano o se automatiza con un workflow mensual? Candidato para ADR-012 scope.
- **Flag con % de tráfico (bucketing por hash de UID)**: no hay casos hoy. Si surge con ADR-008 (migración), extender ADR-009 con sub-ADR.
- **Rollback plan en la descripción**: no es obligatorio hoy. Se agrega a flags con `criticality='high'` cuando los haya.

## Referencias

- CLAUDE.md §77 — gates nuevos fallan abierto cuando su fuente está vacía.
- CLAUDE.md §89 — datos que un gate del servidor exige los resuelve el servidor.
- CLAUDE.md §107 — reparto desde depósito en tránsito (dep 12) — primer feature detrás del flag.
- `src/pure/feature-flags.js` — pure helper actual.
- `functions/core/feature-flags.js` — espejo server.
