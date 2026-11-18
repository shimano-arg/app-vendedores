# E4.3 reparto-dep12 — Export Pablo con columna "En tránsito" (Opción 1 safe)

**Fecha**: 2026-11-18
**Versión**: v1565
**Scope**: UI (feature reparto-dep12, §107 CLAUDE.md)

## Antes

El Excel editable del reparto (`window.exportRepartoManualExcel`) tenía 9 columnas:

1. Código
2. Cliente
3. Backorder
4. Stock disponible
5. Asignado (editable)
6. Vuelve a backorder (fórmula `=C{row}-E{row}-G{row}`)
7. Eliminar (editable)
8. Reparto ID (protegida)
9. CardCode (protegida)

No había visibilidad de las unidades que viajan en tránsito (dep 12 → dep 11)
para el cliente. Pablo repartía solo contra físico actual, sin saber qué
unidades van a aterrizar en los próximos ~7 días.

## Problema

Cuando el feature reparto-dep12 (CLAUDE.md §107) se active, las líneas ASIG
con `enTransito=true` reservan stock del bucket tránsito pero no participan
en el flujo normal de reparto manual. Pablo necesita verlas para decidir si
asignar físico HOY o esperar al tránsito.

Decisión arquitectónica (Mariano, 2026-11-18): **Opción 1 — columna al
FINAL**. Rationale: no toca las fórmulas por posición existentes
(`=C{row}-E{row}-G{row}`). Es safe por construcción. Alternativa descartada:
columna al medio (ej. después de Backorder) — rompería las fórmulas que
Pablo tiene en sus plantillas Excel.

## Cambio

Nueva **columna 10 "En tránsito"** al final del Excel, informativa,
protegida (locked), con estilo visual diferenciado (header azul, celdas
fondo celeste `#dbeafe` + texto azul `#1e40af`).

**Archivos tocados**:

- `src/pure/reparto-excel-export-rows.js`
  - Extiende typedef `RepartoExcelRow` con `EnTransito: number | null`.
  - Agrega 3er dep opcional `getQtyTransitoParaCliente(cardCode, sku) => number`.
  - Loop row push: `EnTransito: transitoFn ? safeNum(transitoFn(cardCode, sku)) : 0`.
  - Fila aviso (`_notice=true`): `EnTransito: null` (no participa).
  - Compat 100%: sin la fn, todas las rows muestran 0.

- `src/domains/exports-reparto.js`
  - `ws.columns[]`: nueva entrada al final `{ header: 'En tránsito', key: 'EnTransito', width: 14 }`.
  - `headerRow.getCell(10).fill` con `#1E40AF` azul.
  - Cada `addRow`: `EnTransito: Number(r.EnTransito) || 0`.
  - `row.getCell(10)` fill celeste + font azul bold + `protection.locked=true`.
  - `ws.autoFilter` ahora llega hasta `column: 10`.
  - Dep `getQtyTransitoParaCliente` inyectada: itera `globalPedidos`,
    filtra líneas `state='ASIG' + enTransito=true + match sku+cardCode`,
    suma `qtyOpen`. Try/catch → 0 si globalPedidos no está.

## Por qué

- **Safe por construcción**: la fórmula `VueleABackorder` sigue siendo
  `=C{row}-E{row}-G{row}` (columnas 3, 5, 7). La nueva columna va al índice
  10 — fuera del alcance.
- **Compat con flag OFF (estado actual)**: sin líneas `enTransito=true` en
  prod, la columna muestra 0 para todas las filas. No requiere activación
  coordinada con el feature flag.
- **Preparada para flag ON**: cuando Mariano prenda `dep12_reparto_enabled`
  via Panel Control, los valores aparecen automáticamente sin re-deploy.

## Verificación

- `npm run test:unit` → 3077 PASS / 0 FAIL (5 nuevos en
  `tests/unit/audit/reparto-export-transito-column.test.js`):
  - T1: shape del pure incluye `EnTransito` (sin fn → 0).
  - T2: con `getQtyTransitoParaCliente` → valores correctos por fila.
  - T3: sin fn (flag OFF/compat) → 0 en todas.
  - T4: `ws.columns[]` tiene "En tránsito" como ÚLTIMO (índice 9 → column 10).
  - T5: fórmula `VueleABackorder` sigue `=C{row}-E{row}-G{row}` sin tocar.
- `npx biome check` → clean.
- `node build.js` → bundle rebuilt + chunks commitados.

## Rollback

Revertir el commit v1565. Como el feature flag `dep12_reparto_enabled` sigue
OFF, no hay data residual que limpiar — la columna dejaba de aparecer y punto.
Las plantillas Excel que Pablo haya guardado localmente con la columna 10
siguen funcionando (Excel ignora columnas extra).

## Precedente

- CLAUDE.md §107 (feature reparto-dep12 completo).
- PR #1365 (E4.3 N/A documentado — diferido para brainstorm). Este PR
  reemplaza al #1365 con la implementación real + decisión Opción 1.
- Fork anterior (2026-11-18) analizó el export y documentó que las fórmulas
  por posición hacían imposible insertar columna al medio sin recálculo.
