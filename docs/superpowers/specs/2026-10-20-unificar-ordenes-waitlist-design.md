# Spec — Unificar Órdenes en Lista de Espera (v1284)

**Fecha**: 2026-10-20
**Autor**: Mariano + Claude (brainstorming session)
**Status**: Approved, pending implementation plan

## Overview

Botón **"Unificar orden"** en el footer del modal "Pedido en espera" que detecta otras órdenes del mismo cliente en lista de espera y las absorbe dentro de la actual.

### Problema

Hoy un cliente puede tener varias órdenes abiertas simultáneamente:
- ORDEN 332: pedido real del cliente (ej. 6 SKU grandes, $45k)
- ORDEN 335: pedido "Stock Asig" generado desde el flow "Crear Pedido Desde Stock Asignado" (3 SKU chicos, $12k)

Confirmar ambas por separado manda 2 ofertas distintas a SAP, cuando lo lógico es consolidar en una sola.

### Solución

Botón que:
1. Detecta todas las otras órdenes del mismo cliente en lista de espera.
2. Confirma con el user: "¿Unificar las órdenes 332, 335 dentro de la 460?"
3. Al aceptar: absorbe las líneas de todas las viejas dentro de la **más nueva**. Las viejas desaparecen (quedan con audit).
4. Los SKUs importados de órdenes viejas se pintan **amarillo `#d97706`**. Si un SKU se duplica (ya existía en la nueva), ambas filas quedan destacadas: la original en **rojo `#991b1b`**, la importada en **amarillo** — el VDE decide manualmente qué hacer (sumar, dejar, quitar).

### Para quién

Admin / gerente / interno (mismo gate que el modal "Pedido en espera" actual). Mismo permiso.

---

## Decisiones clave (8 confirmadas en brainstorming)

| # | Decisión |
|---|---|
| 1 | **Scope**: solo waitlist ↔ waitlist, match por `cardCode` cliente |
| 2 | **Universo**: unifica TODAS las candidatas en la más nueva, un click |
| 3 | **Visibilidad botón**: oculto si no hay candidatos (query async al abrir modal) |
| 4 | **Orden vieja**: `closedAt + closedReason='unified_into' + unifiedInto=<pedidoId>`. Desaparece de lista espera + Planner. Queda en Firestore para audit |
| 5 | **SKUs duplicados**: AMBAS filas quedan. Original (nueva) fondo **ROJO `#991b1b`**. Importada (vieja) fondo **AMARILLO `#d97706`** |
| 6 | **SKUs no-duplicados importados**: fondo **AMARILLO `#d97706`** |
| 7 | **Persistencia color**: `line.importedFromOrder: 332` en Firestore. El color persiste siempre (incluso tras reload) |
| 8 | **Vendor en unificada**: el de la más nueva (335). Si la vieja tenía vendor distinto, se pierde (queda audit en `unifiedFrom[]`) |

---

## Data model

### Nuevo campo en `pedido.lines[].importedFromOrder`

| Valor | Significado |
|---|---|
| `null` o ausente | Línea original de este pedido (nunca fue importada) |
| `<orderNumber>` (ej. `332`) | Línea importada desde esa orden vieja al unificar |

### Nuevo campo en `pedido.unifiedFrom[]` (en la nueva)

Array de audit trail con las órdenes absorbidas:

```json
"unifiedFrom": [
  {
    "orderNumber": 332,
    "pedidoId": "abc123...",
    "mergedAt": "2026-10-20T18:30:00.000Z",
    "mergedBy": "mariano.erbino@shimano.com.ar",
    "lineCount": 6
  },
  {
    "orderNumber": 335,
    "pedidoId": "def456...",
    "mergedAt": "2026-10-20T18:30:00.000Z",
    "mergedBy": "mariano.erbino@shimano.com.ar",
    "lineCount": 3
  }
]
```

### Nuevos campos en `pedido` viejo (332 / 335)

```json
{
  "closedAt": "2026-10-20T18:30:00.000Z",
  "closedReason": "unified_into",
  "unifiedInto": "<pedidoId de la nueva (460)>",
  "unifiedIntoOrderNumber": 460
}
```

Al setear `closedAt`, el pedido viejo desaparece de:
- Lista de espera (query ya filtra `closedAt == null`)
- Planner Kanban (idem)
- Cualquier otra UI que respete `closedAt`

Pero queda intacto en Firestore. `git log` para pedidos.

---

## Arquitectura

### Flow click

1. **Usuario abre modal** "Pedido en espera" del pedido 460 (nueva, actual).
2. **Al abrir el modal**, async query:
   ```js
   firestore.collection('pedidos')
     .where('clientCardCode', '==', pedido.clientCardCode)
     .where('stage', '==', 'waitlist')
     .where('closedAt', '==', null)
     .get()
     .then(snap => snap.docs.filter(d => d.id !== pedido.id))
   ```
3. Si hay candidatos → mostrar botón "Unificar orden" en footer (al lado de Cerrar).
4. **Usuario click botón** → modal confirm:
   > ¿Querés unificar las órdenes **332** (6 SKU · $45k) y **335** (3 SKU · $12k) dentro de la orden **460**?
   >
   > Las órdenes viejas van a cerrarse (quedan en audit). Los SKUs importados aparecen en amarillo.
   >
   > [Cancelar] [✅ Unificar]
5. **Usuario acepta** → `writeBatch`:
   ```js
   const batch = firestore.batch();
   // Nueva: lines mergeadas + unifiedFrom[]
   batch.update(pedidoNuevaRef, {
     lines: mergedLines,
     unifiedFrom: unifiedFromArray,
     updatedAt: nowIso,
   });
   // Cada vieja: cerrar
   for (const vieja of candidatas) {
     batch.update(viejaRef, {
       closedAt: nowIso,
       closedReason: 'unified_into',
       unifiedInto: pedidoNuevaRef.id,
       unifiedIntoOrderNumber: pedidoNueva.orderNumber,
     });
   }
   await batch.commit();
   ```
6. **Modal re-renderiza** con las líneas nuevas pintadas.

### Query performance

La query es simple (3 filtros + 1 índice compuesto `clientCardCode + stage + closedAt`). Firestore ya tiene índices parecidos para flows existentes. Si falla, se agrega al deploy de rules/indexes.

Si el usuario tiene 1000 clientes pero este cliente tiene solo 3 órdenes abiertas, la query devuelve 2-3 docs. Fast.

### Helper puro

**File**: `src/pure/unificar-ordenes.js`

```js
/**
 * Merge lines de órdenes viejas dentro de las de la nueva.
 *
 * @param {Array<Line>} baseLines - lines del pedido nueva (sin tocar)
 * @param {Array<{orderNumber: number, lines: Array<Line>}>} otherOrders - ordenadas por orderNumber ASC
 * @returns {{
 *   mergedLines: Array<Line>,
 *   duplicatesByCode: Map<string, {originalCount: number, importedCount: number}>
 * }}
 */
export function mergeLinesFromOrders(baseLines, otherOrders) {
  const mergedLines = baseLines.slice(); // copia, no muta
  for (const { orderNumber, lines } of otherOrders) {
    for (const line of lines) {
      mergedLines.push({
        ...line,
        importedFromOrder: orderNumber,
      });
    }
  }
  const duplicatesByCode = computeDuplicates(mergedLines);
  return { mergedLines, duplicatesByCode };
}

/**
 * Devuelve clase CSS del row según su rol en el merge.
 *
 * @param {Line} line
 * @param {Map} duplicatesByCode
 * @returns {'imported' | 'duplicate-original' | 'duplicate-imported' | null}
 */
export function getRowColorClass(line, duplicatesByCode) {
  const isImported = line.importedFromOrder != null;
  const isDuplicate = duplicatesByCode.has(line.code);
  if (!isImported && !isDuplicate) return null;
  if (!isImported && isDuplicate) return 'duplicate-original';
  if (isImported && isDuplicate) return 'duplicate-imported';
  return 'imported';
}
```

### UI

**Botón**: en el footer del modal "Pedido en espera", a la izquierda de "Cerrar". Fondo violeta (`#7c3aed`), label `🔗 Unificar orden`. Oculto por default; se muestra cuando el fetch async de candidatos devuelve ≥1.

**Modal confirm**: pattern del repo (overlay + box + head + body con lista de candidatas + footer con Cancelar / Unificar).

**Colores de fila**:
- `duplicate-original` → background `#991b1b` + text white
- `duplicate-imported` → background `#d97706` + text white
- `imported` (sin duplicado) → background `#d97706` + text white
- normal → sin estilo adicional

Cada estilo se aplica como clase CSS (`.cartera-row-imported`, etc.) en el `<tr>`. El código del modal reconstruye el `<tr>` por línea leyendo `line.importedFromOrder` y la lista de duplicados.

### Permisos

`canOpenPedidoEnEspera()` (función existente del modal) ya autoriza admin/gerente/interno. No cambio nada — el botón hereda ese gate.

### Firestore rules

Ya existe write rule para `pedidos/{id}` que permite update por admin/gerente/interno. No se agrega regla nueva — la unificación es solo updates.

---

## Edge cases

| Caso | Comportamiento |
|---|---|
| Cliente sin otras órdenes | Botón oculto. No pasa nada. |
| Vendor distinto entre órdenes | Queda el vendor de la más nueva. Vendor viejo queda en `unifiedFrom[].mergedBy` para audit indirecto. |
| SKU duplicado con precio distinto | Ambas filas quedan con su precio original (duplicate-original / duplicate-imported). El VDE decide. |
| Unificación de 3+ órdenes | `writeBatch` escribe N+1 docs (1 nueva + N viejas cerradas). Firestore batch limit = 500 ops, cómodo. |
| Click doble en Unificar | Botón se deshabilita durante el commit. Al retornar, se re-renderiza (puede quedar sin candidatos → oculto). |
| Firestore rules fail | Catch → alert "Error unificando: {msg}". Nada queda inconsistente (batch atómico). |
| Usuario cierra modal mid-commit | El batch sigue (es asíncrono). Al reabrir ya está unificado. |
| Order vieja estaba being edited por otro user | Last-write-wins. No hay lock. Edge raro: ambos van a sobrescribir. Para versiones futuras se puede agregar `updatedAt` compare. |

---

## Testing

### Unit (`tests/unit/unificar-ordenes.test.js`) — TDD

| Test | Qué cubre |
|---|---|
| `mergeLinesFromOrders: 2 orders sin duplicados` | Lines concatenadas, cada importada con flag |
| `mergeLinesFromOrders: 2 orders con 1 SKU duplicado` | Ambas filas presentes, duplicate map correcto |
| `mergeLinesFromOrders: 3 orders en cascada` | Todas las lines importadas, duplicates desde orders distintas detectados |
| `mergeLinesFromOrders: no muta baseLines` | Pureza |
| `mergeLinesFromOrders: 0 other orders` | Devuelve baseLines idéntico |
| `getRowColorClass: línea normal` | null |
| `getRowColorClass: línea importada sin duplicado` | 'imported' |
| `getRowColorClass: original con duplicado importado` | 'duplicate-original' |
| `getRowColorClass: importada con duplicado original` | 'duplicate-imported' |

### Smoke manual post-merge

1. Abrir pedido 460 en el modal. Si no hay otras órdenes del cliente → botón oculto.
2. Simular: crear 2 pedidos waitlist del mismo cliente con SKUs mixtos (1 duplicado).
3. Abrir el pedido más nuevo. Verificar que aparece botón "Unificar orden".
4. Click → confirm modal lista las 2 viejas con qty + subtotal.
5. Aceptar → modal re-renderiza con filas pintadas (3 colores: normal, imported amarillo, duplicate original rojo + imported amarillo).
6. Cerrar y reabrir → las filas siguen pintadas (persistencia OK).
7. Ir a lista de espera → las viejas desaparecieron.
8. Firestore console: viejas tienen `closedReason='unified_into'`.

---

## Deploy

**Branch**: `dev-v1284-unificar-ordenes`
**Target CFs**: ninguna (todo client-side)
**Target rules**: ninguna (sin cambios)
**Target hosting**: GitHub Pages auto-deploy post-merge
**Rebuild bundle**: `node build.js` + commit chunks

---

## Rollback

1. `git revert <commit>` → el botón desaparece. Las unificaciones que ya se hicieron antes del revert quedan en Firestore (viejas con `closedAt`, nueva con `unifiedFrom[]`). No se auto-reversan.
2. Para "deshacer" una unificación específica: script one-off que:
   - Lee `unifiedFrom[]` de la nueva.
   - Para cada entry: `firestore.doc(pedidoId).update({closedAt: null, closedReason: null, unifiedInto: null, unifiedIntoOrderNumber: null})`.
   - Luego borra líneas con `importedFromOrder in <orderNumbers>` de la nueva + unset `unifiedFrom`.
   Es una operación específica — se escribe cuando haga falta, no se incluye por default en el PR.

---

## Status checklist

- [x] 8 decisiones de product
- [x] Schema definido (line.importedFromOrder + unifiedFrom[] + closedReason)
- [x] Helper puro pseudocódigo + tests TDD
- [x] UI layout + colores
- [x] Permisos cross-check
- [x] Edge cases documentados
- [ ] Spec review por Mariano (bypass por autonomía autorizada)
- [ ] Implementation plan
