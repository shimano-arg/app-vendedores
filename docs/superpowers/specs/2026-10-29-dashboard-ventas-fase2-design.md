# Dashboard de Ventas — fase 2 (2026-10-29)

Estado: **aprobado en chat por Mariano 2026-10-29; spec para revisión.**
Base: Dashboard de Ventas v1529/v1530 (`docs/superpowers/specs/2026-10-29-dashboard-ventas-design.md`).
Nada implementado todavía.

## 1. Objetivo

Sumar al Dashboard de Ventas tarjetas de gestión (target, cumplimiento,
rendiciones, base activa, ticket, actividad), una tabla de interacciones,
una tabla de productos, la cobertura de cartera, la facturación por cliente
y las campañas activas. Además, estilo Apple, etiquetas de dato en barras y
evolución desde junio 2026.

### Decisiones (Mariano, 2026-10-29)

| # | Tema | Decisión |
|---|------|----------|
| 1 | Cobertura de cartera | compraron desde 1/6/2026 hasta el mes elegido ÷ clientes dados de alta en SAP del vendedor. Ej.: 36 de 66 = **54,55%** (Mariano había escrito 45,45%, que es la parte que NO compró) |
| 2 | Base activa | clientes con factura en los 90 días previos al fin del mes elegido (hasta hoy si es el mes en curso) |
| 3 | Ticket promedio | facturado ÷ N° de facturas del mes |
| 4 | Tabla de productos | CATEGORÍA = familia (REEL, CAÑAS…), FAMILIA = subfamilia |
| 5 | "Desde junio 2026" | solo los gráficos de evolución (ventas y back order); el resto sigue el filtro Mes |
| 6 | Facturación por clientes | Top 20 + "Ver más" |
| 7 | Arquitectura | misma callable `dashboardVentasCF`, consultas extra en paralelo, misma caché 10 min |
| 8 | Estilo | Apple, mismo patrón que `#campaigns-modal` en `styles/apple-design.css` |
| 9 | Entregas | A → B → C (sección 7), cada una usable sola |

## 2. Contenido nuevo

Todo respeta los 6 filtros y el alcance por rol de v1529 (vendedor: solo
sus clientes, filtro Vendedor fijo, lo fuerza el servidor).

### 2.1 Tarjetas (mes elegido + filtros)

| Tarjeta | Fuente | Cálculo |
|---------|--------|---------|
| Target | `v_targets` | `SUM(target_ars)` del año/mes para los vendedores filtrados (sin filtro: todos) |
| % cumplimiento | — | Facturado mensual ÷ Target. Sin target → "Sin target" |
| Rendiciones – monto | `v_rendiciones` | `SUM(importe_ars)` con `fecha_gasto` en el mes, por `vendor` |
| Base activa | `v_ventas_lineas` | `COUNT(DISTINCT card_code)` con `doc_kind='INVOICE'` y `doc_date` en (fin − 90 d, fin] |
| Ticket promedio | — | Facturado ÷ Cant. de pedidos del mes (tarjeta existente) |
| N° visitas | `v_visitas` | filas con `es_contacto = FALSE` y `fecha_visita` en el mes |
| N° contactados | `v_visitas` | filas con `es_contacto = TRUE` en el mes |
| N° interacciones | — | visitas + contactados |

Target, rendiciones y actividad no tienen cliente/SKU/categoría: si esos
filtros están activos, la tarjeta muestra el valor por vendedor y mes con la
nota "no se filtra por cliente/producto". Visitas y contactos sí respetan el
filtro Cliente (por `card_code`).

Vendedor en estas fuentes: se compara con `UPPER(TRIM())` igual que en
v1529. PACHI no tiene target (removido de `v_targets` 2026-09-11): su
tarjeta dice "Sin target".

### 2.2 Tabla de interacciones

Columnas Cliente, Fecha, Vendedor. Visitas y contactos del mes con filtros,
orden fecha descendente, columna extra chica "Tipo" (visita/contacto),
buscador y scroll interno (§49). Tope 500 filas desde el servidor; si hay
más, aviso "mostrando 500 de N".

### 2.3 Tabla de productos

| Columna | Origen |
|---------|--------|
| CATEGORÍA, FAMILIA, SKU | BigQuery (`familia`, `subfamilia`, `item_code`) |
| Unidades vendidas, Facturado | BigQuery, mes elegido + filtros |
| Unidades back order | BigQuery, `backorder_dashboard_actual` |
| Unidades reservadas, Libre para la venta, En stock | **navegador**: `getStockBreakdown(sku)` (§39), mismo cálculo que el popup "Stock del SKU" |

Filas: SKUs con venta en el mes o con back order vigente. Orden: facturado
descendente. Buscador + scroll interno. Si el stock de la app todavía no
cargó, esas tres columnas muestran "…" y se completan solas.

### 2.4 Cobertura de cartera

Barras horizontales, una por vendedor: `compraron / dados de alta` con
etiqueta "36 de 66 · 54,55%".
- Dados de alta: `v_cartera_vendor` (clientes con `card_code` SAP, por `vendor_key`).
- Compraron: de esos, los que tienen factura desde 2026-06-01 hasta el fin del mes elegido.
- El vendedor ve solo su barra.

### 2.5 Facturación por clientes

Top 20 clientes por facturado del mes (barras horizontales, etiqueta con el
monto) + "Ver más" con la lista completa, igual que Top 20 SKU.

### 2.6 Campañas activas

`v_campanias_progreso` con `activa = TRUE`. Por campaña: nombre, fechas,
vendido en unidades y en dinero, objetivo y %. Con filtro Vendedor (o rol
vendedor): solo campañas cuyo alcance incluye a ese vendedor (`scope='all'`,
`scope='vendor'` con el vendedor, `scope='province'` con clientes del
vendedor), y lo vendido calculado solo sobre sus clientes
(`v_campanias_ventas_detalle`, que trae `assigned_vendor` y `card_code` por línea).

## 3. Cambios a lo existente

- Evolución de ventas y de back order: eje desde jun-26 hasta el mes elegido (antes 12 meses).
- Todos los gráficos de barras muestran la etiqueta del dato sobre/al final de cada barra ("191", "$1.234.000"). Plugin Chart.js propio de ~30 líneas, sin librería nueva.
- Estilo Apple (sección 5).

## 4. Arquitectura

```
Pantalla (src/domains/dashboard-ventas.js, chunk lazy)
  └─ dashboardVentasCF  (misma callable)
        └─ dashboard-ventas-core.js  → arma respuesta, rol, caché
              └─ dashboard-ventas-queries.js → +8 queries parametrizadas
                    v_targets, v_rendiciones, v_visitas, v_cartera_vendor,
                    v_campanias_progreso, v_campanias_ventas_detalle,
                    v_ventas_lineas, backorder_dashboard_actual
```

- Todas las queries en `Promise.all`. Cada sección nueva falla sola: si su
  query tira error, la respuesta trae `secciones.<x> = {error: true}` y la
  pantalla muestra "No disponible" en esa visual. Las 5 queries de v1529
  siguen siendo obligatorias (si fallan, falla todo, como hoy).
- Parámetros: fechas como STRING + `DATE()` en SQL (lección hotfix #1300);
  test que pasa cada parámetro por `BigQuery.valueToQueryParameter_`.
- Tamaño: la respuesta crece con interacciones (≤ 500) y productos
  (estimado < 1.500 filas). Estimado < 300 KB; no medido.
- Costo BQ: estimado bajo (vistas chicas + caché 10 min); se mide la
  primera semana con `INFORMATION_SCHEMA.JOBS`.

## 5. Estilo Apple

Mismo patrón que `#campaigns-modal` (`styles/apple-design.css`, v650-v653),
scoped a `#dashboard-ventas-modal` para no tocar otros modales:
- Overlay con `backdrop-filter: blur(20px) saturate(180%)`, apertura con la curva del piloto.
- Tipografía system (`-apple-system, SF Pro…`), tracking negativo en números grandes de tarjetas.
- Fondo `#f5f5f7`, tarjetas blancas con radio 14-18 px y sombra suave, sin bordes duros.
- Acento Apple blue `#49A2DA` (botones pill, filtros activos); verde/rojo solo para semáforos (% cumplimiento, back order).
- Gráficos con la misma paleta, grillas tenues, sin bordes de ejes.
- `prefers-reduced-motion` respetado (§21 punto 10).
- Sin interacciones gestuales nuevas (drag/swipe): no aplica el checklist gestual de §21 más allá de 1 (feedback al tocar), 7 y 14.

## 6. Tests

- Core: alcance por rol en cada sección nueva (vendedor no ve datos de otro aunque los pida).
- Queries: ningún parámetro vacío; cobertura (36/66 → 54,55%), base activa (ventana 90 d), ticket (sin facturas → 0, sin dividir por cero).
- Falla parcial: una query nueva que tira error deja `secciones.x.error` y el resto intacto.
- Pantalla: contrato del chunk, textos, tabla de productos toma reservadas/libre/stock de `getStockBreakdown`, etiqueta de dato en barras.
- Manual (§90): admin y PACHI antes de cerrar cada entrega.

## 7. Entregas

| Entrega | Contenido |
|---------|-----------|
| A | Tarjetas 2.1 + tabla de interacciones 2.2 + estilo Apple |
| B | Tabla de productos 2.3 + cobertura 2.4 + facturación por clientes 2.5 |
| C | Campañas activas 2.6 + etiquetas en barras + evolución desde jun-26 |

Cada entrega: PR propio, deploy de `dashboardVentasCF` + publicación del front.

## 8. Fuera de alcance

- Exportar a Excel desde el dashboard.
- Target por categoría (REEL/CAÑAS/LINEAS) aunque `v_targets` lo tiene.
- Back order de la app (sigue solo SAP).

## 9. Riesgos

- `v_cartera_vendor` arrastra conflictos de vendedor entre altas y master (gana altas); la cobertura hereda esa data sucia.
- Visitas sin `card_code` (leads) no tienen cliente SAP: en la tabla salen con el nombre del lead y no filtran por Cliente.
