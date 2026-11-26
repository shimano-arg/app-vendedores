# ADR-0013: Piloto solo lectura — consulta de stock + pedidos en React

- **Status**: Accepted (2026-11-26).
- **Decididor**: Mariano (owner técnico).
- **Fecha decisión**: 2026-11-26 11:24 ART.
- **Supersede**: ninguno.
- **Relacionado**: ADR-004 (frontend React+TS Vite), ADR-008 (migración no-downtime), ADR-014 (backend TS modular), ADR-015 (mobile first + CWV).

## Contexto

Mariano autorizó Fases 6+7 del plan de modernización (piloto + migración) con doble escritura + interruptor de lectura (ADR-008 opción B). La migración real de datos (pedidos → PG) empieza cuando el piloto demuestre que:

1. El stack nuevo (React + backend TS + Cloud SQL — ADR-004/014) corre en producción sin incidentes.
2. CWV móvil del piloto son iguales o mejores que la pantalla actual (ADR-015).
3. El equipo operativo acepta la UX nueva.

El piloto es la primera pantalla React en producción. Si falla, no hay riesgo de dato perdido — es solo lectura.

## Decisión

El piloto consiste en **dos pantallas React mobile-first** que leen las **mismas fuentes que la app actual** (Firestore `app_config/stock_snapshot` + `pedidos` collection), via una **operación de backend explícita** (no lectura directa cliente→Firestore).

### Pantallas

1. **Consulta de stock por SKU**: busca SKU, muestra el breakdown (§39 `getStockBreakdown`) usando el pure helper existente `src/pure/stock-breakdown.js` compartido entre la app actual y el piloto. Formato de la salida idéntico al popup existente (§103 — líneas explícitas + fórmula).
2. **Consulta de pedidos del cliente**: busca cliente (cardCode o nombre), muestra sus pedidos abiertos + últimos 30 días cerrados. Usa el filtro por `assignedVendorUid` (§59) para VDE o blanket para admin/gerente.

### No se escribe nada

- Zero escrituras a Firestore desde el piloto.
- Zero mutaciones de estado operacional (sin confirm, sin edit, sin cancel).
- El backend TS actúa como **proxy de lectura**: llama al Firestore Admin SDK con los filtros de rol (resolución server-side §89) y devuelve data tipada al cliente React.

### Rutas y acceso

- `/app2/stock` — pantalla de stock.
- `/app2/pedidos` — pantalla de pedidos.
- Ambas protegidas por auth Firebase (misma sesión que la app actual, no cross-auth).
- Permisos server-side: admin/gerente ve todo, VDE ve sólo lo suyo (`assignedVendorUid` del cliente, §44), interno ve lo de su pareja (§108).

### Fuentes y cache

- Backend TS → Firestore Admin SDK para los reads.
- Cache: React Query v5 con `staleTime: 30s` para stock, `staleTime: 60s` para pedidos.
- Sin IndexedDB persistence del lado React — todas las lecturas pasan por el backend.
- Si el backend está caído → mensaje humano (§68 pattern) sin exponer código técnico.

### Mediciones obligatorias (criterio de aceptación)

Comparación piloto vs pantalla actual, sobre dispositivo "Moto G Power" / Chrome mobile / 4G throttling:

| Métrica | Pantalla actual | Piloto | Criterio |
|---|---|---|---|
| LCP | medir | medir | ≤ 2.5 s |
| INP | medir | medir | ≤ 200 ms |
| CLS | medir | medir | ≤ 0.1 |
| Carga completa | medir | medir | ≤ 3 s |
| Datos móviles por carga | medir | medir | ≤ 100 KB |

Valores "pantalla actual" se obtienen del CWV report (ADR-015 gate) tras los primeros 7 días de tráfico post-instrumentación.

## Consecuencias

### Bueno

- Sin riesgo de pérdida de datos: solo lectura.
- Prueba end-to-end del stack nuevo (React + backend TS + proxies a Firestore) antes de tocar operaciones críticas.
- Baseline CWV concreta de la UX mobile first (nunca tuvimos antes).
- Si falla, se desactiva una ruta — no afecta el flow operativo normal.

### Malo

- Dos pantallas no cubren todos los casos de uso → el equipo opera con dos UIs mezcladas durante la transición (igual pasa con cualquier migración gradual).
- Backend nuevo requiere setup de Cloud SQL + Secret Manager + SA (ver PENDIENTE_HUMANO S-10 TOP). Sin staging, el piloto no corre.
- Carga adicional sobre Firebase Hosting (deploy de dos sets de assets).

### Lo que NO cambia

- Firestore rules.
- Cloud Functions.
- App actual.
- Flujo de confirmación / commit / reservas.

## Alternativas evaluadas

1. **Piloto con escritura** (ej. editar vendor del cliente). Rechazado — regla Mariano: el piloto no toca datos comerciales. Primero valida performance + UX, después se abren flujos de escritura con doble write (ADR-008).
2. **Cliente lee Firestore directo** (sin backend proxy). Rechazado — rompería ADR-008 pattern (backend TS es la capa donde vive la doble lectura en el futuro). Mejor consistent desde el día 1.
3. **Pantalla única "dashboard todo-en-uno"**. Rechazado — cada pantalla mide CWV independiente (ADR-015). Menos moving parts.

## Verification

- Script `scripts/perf/measure-piloto-vitals.js` corre contra `/app2/stock` + `/app2/pedidos` en Chrome headless mobile + emula 4G. Output PR body.
- Test unit del backend proxy: que un VDE no pueda leer pedidos de otro VDE (gate §59 enforced server-side).
- Test e2e Playwright: VDE abre `/app2/stock`, busca SKU, ve breakdown correcto (fixture mock Firestore).

## Rollback

Si el piloto introduce incidentes: desactivar la ruta en Pages (remover `/app2/*` del deploy) o devolver 503 desde el backend proxy (toggle de feature flag `piloto_react_enabled` en `app_config/feature_flags` — mismo pattern ADR-009).

## Qué destraba

Una vez el piloto corre en producción con CWV OK durante 1 semana:

- ADR-008 arranca la doble escritura para pedidos (etapa siguiente).
- Nuevas pantallas React van migrando una por una (planner, waitlist, master de productos, admin usuarios).
- La app actual empieza a reducir superficie.
