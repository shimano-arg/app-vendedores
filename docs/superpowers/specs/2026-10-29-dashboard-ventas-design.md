# Dashboard de Ventas — diseño (2026-10-29)

Estado: **borrador para revisión de Mariano**. Nada implementado todavía.

## 1. Objetivo

Pantalla nueva "Dashboard de Ventas" dentro de la app para analizar ventas
pesca y la evolución del back order con 6 filtros combinables. No reemplaza
el Dashboard actual (`src/domains/dashboard.js`), que queda intacto.

### Decisiones tomadas (brainstorming 2026-10-29)

| # | Tema | Decisión |
|---|------|----------|
| 1 | Historia del back order | **C**: reconstrucción estimada de meses pasados + foto diaria real desde el deploy |
| 2 | Alcance por rol | **A**: admin/gerente ven todo; vendedor ve solo sus clientes, filtro Vendedor fijo |
| 3 | Qué es "pedido" | **C**: facturas del mes (sin contar notas de crédito) |
| 4 | Universo | **A**: solo Pesca, vendedores de la app (`assigned_vendor`) |
| 5 | IVA | **A**: todo sin IVA, neto de descuento y de notas de crédito |
| — | Arquitectura | Cloud Function que consulta BigQuery en el momento |

## 2. Contenido de la pantalla

### Filtros (todos combinables, multiselección con búsqueda)

| Filtro | Fuente | Columna |
|--------|--------|---------|
| Mes | selector AAAA-MM | `anio_contable`/`mes_contable` de `v_ventas_lineas` |
| Vendedor | lista de vendedores pesca | `assigned_vendor` |
| Cliente | clientes con ventas en 24 meses | `card_code` (+ nombre) |
| Provincia | provincias con ventas | `provincia_cliente` |
| Categoría | familias pesca (REEL, CAÑAS, LINEAS, FG, COMBO, MONOFILAMENTO…) | `familia` |
| SKU | SKUs con ventas | `item_code` (+ descripción) |

El **Mes** define el período de las tarjetas y de los Top 20 (default: mes
en curso). Los gráficos de evolución muestran siempre los **últimos 12
meses** hasta el mes elegido, con el resto de filtros aplicados.

### Tarjetas

| Tarjeta | Cálculo (mes elegido + filtros) |
|---------|------|
| Facturado mensual | `SUM(importe_linea_ars)` (sin IVA, neto descuento, NC restan) |
| Valorización backorder | back order valorizado a hoy: foto real del día más reciente, `SUM(pendiente × precio_unitario)` |
| Cant. de pedidos del mes (= facturas) | `COUNT(DISTINCT doc_entry)` con `doc_kind='INVOICE'` |
| Cant. pedidos únicos (= tiendas que compraron) | `COUNT(DISTINCT card_code)` con `doc_kind='INVOICE'` |

Nota: las tarjetas 3 y 4 respetan los filtros por línea (Categoría/SKU):
cuentan facturas/clientes que tienen al menos una línea que matchea.

Leyenda fija en la pantalla: "Montos sin IVA, con descuento aplicado y
notas de crédito restadas."

### Rankings

- **Top 20 SKU – Unidades** y **Top 20 SKU – Dinero**, barras horizontales.
- Botón "Ver más" abre la lista completa (tabla con búsqueda, ordenada).
- SKUs con neto ≤ 0 (más devuelto que facturado) aparecen al final, no en el Top.

### Gráficos de líneas (12 meses)

1. Evolución de ventas: facturado por mes.
2. Evolución del back order – unidades: unidades pendientes a fin de mes.
3. Evolución del back order – dinero: pendiente valorizado a fin de mes.

En 2 y 3: meses reconstruidos en **línea punteada** con etiqueta
"estimado"; meses con foto real en **línea llena**. El mes en curso usa la
foto del último día disponible.

## 3. Datos del back order

### 3.1 Foto diaria real (nueva tabla)

Tabla BQ `backorder_daily_snapshot`, una fila por (fecha, SKU, cliente):
`snapshot_date, item_code, card_code, assigned_vendor, provincia, familia,
pendiente_uds, precio_unitario, pendiente_ars`.

- Se carga desde `v_backorder_lineas` (back order SAP vigente, ya
  deduplicado por v474) en el sync `sync_sap_to_bigquery.py`, **una vez por
  día** (la primera corrida después de las 23:00 ART). Si ya hay fila del
  día, se reemplaza (idempotente).
- Solo SAP. Los pedidos que esperan en la app (lista de espera / BO app)
  no entran; quedan para una fase posterior si se pide.
- Valor de fin de mes = foto del último día del mes.

### 3.2 Reconstrucción estimada (meses pasados)

Vista BQ `v_backorder_reconstruido_mensual`: para cada fin de mes M de los
últimos 12 meses previos al deploy,

```
pendiente(M) = SUM(cantidad cotizada en SQ con doc_date ≤ M, no canceladas)
             − SUM(cantidad facturada con doc_date ≤ M cuya cadena
                   Invoice(BaseType 17) → SO(BaseType 23) → SQ apunta a esas SQ)
```

agrupado por SKU, cliente, vendedor. Valorizado con el precio de la línea
de la SQ. Clamp a 0 por línea.

Limitaciones conocidas (por eso va como "estimado"):
- SQ canceladas/modificadas después de M no se ven como eran en M.
- Líneas cerradas manualmente en SAP sin facturar cuentan como pendientes.
- Facturas sin cadena a SQ (ventas directas) no descuentan de nada.

**Validación obligatoria antes de mostrar**: script
`scripts/audit/BQ_validar_backorder_reconstruido.py` compara la
reconstrucción con un valor real conocido de Mariano (mes + monto o
unidades aproximadas). Si el desvío supera 15%, no se muestran los meses
estimados y se reporta el motivo.

## 4. Arquitectura

```
Pantalla (index.html + src/domains/dashboard-ventas.js, chunk lazy)
  └─ callable dashboardVentasCF (southamerica-east1)
        └─ functions/core/dashboard-ventas-core.js  (lógica pura, deps inyectables)
              └─ BigQuery: v_ventas_lineas, backorder_daily_snapshot,
                           v_backorder_reconstruido_mensual
```

### dashboardVentasCF

- Entrada: `{mes: 'AAAA-MM', vendedores?, clientes?, provincias?,
  categorias?, skus?}` (arrays de strings).
- Auth: dominio permitido + rol desde `roles/{uid}`.
  - admin/gerente: filtros tal cual.
  - vendedor: el servidor **reemplaza** `vendedores` por el suyo
    (`roles.vendor`); ignora lo que mande el cliente.
  - otro rol: `permission-denied`.
- Queries BQ **parametrizadas** (nunca concatenar strings del usuario).
- Salida única con: tarjetas, top completo por unidades y por dinero,
  serie facturado 12m, series back order 12m (con flag `estimado` por mes),
  opciones de filtros (valores disponibles), `dataUpdatedAt`.
- Caché en memoria por (uid, filtros) 10 min.
- Errores: mensajes de `MENSAJES_VENDEDOR` (§68), código técnico al final.
- Core puro en `functions/core/dashboard-ventas-core.js` (§7): arma SQL +
  params desde filtros, aplica el scope por rol, da forma a la respuesta.

### Pantalla

- Botón "Dashboard de Ventas" en el menú, visible para admin, gerente y
  vendedor.
- Módulo lazy `src/domains/dashboard-ventas.js` con los 3 lugares
  sincronizados (§18: `build.js`, `src/main.js`, `sw.js`).
- Chart.js versión fija cargada on-demand desde cdnjs al abrir.
- Modal con lista larga sigue §49 (altura fija + scroll interno).
- Mobile-first: filtros en panel desplegable, tarjetas 2×2, gráficos a
  ancho completo.

## 5. Tests

- Core puro: scope por rol (vendedor no puede ver otro vendedor aunque lo
  pida), armado de params, filtros vacíos = sin restricción, forma de la
  respuesta, top ordenado y "neto ≤ 0 al final".
- Contrato pantalla: chunk registrado en los 3 lugares; textos sin jerga.
- Validación BQ: dry-run de cada query (`--dry_run`) en el plan.
- Prueba manual con rol vendedor (§90) antes de dar por cerrado.

## 6. Fuera de alcance

- Bike y clientes sin vendedor asignado.
- Back order de la app (pedidos esperando stock no enviados a SAP).
- Exportar a Excel desde el dashboard.
- Comparativa contra objetivos (targets) — ya está en el Dashboard actual.

## 7. Riesgos

- Reconstrucción con desvío alto → se oculta, quedan solo los meses reales
  (la curva tarda meses en armarse).
- Costo BQ: estimado bajo (tablas chicas + caché), **no medido**. Se mide
  en la primera semana con `INFORMATION_SCHEMA.JOBS`.
- Latencia 1-3 s por consulta (estimada, no medida).
