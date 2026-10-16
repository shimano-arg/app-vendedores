# Productos sugeridos para SKUs sin stock — Diseño v1

**Fecha**: 2026-10-16
**Autor**: Mariano Shimano + Claude Code
**Rama destino**: `dev-v1346`
**Versión app destino**: v1346
**Estado**: Diseño aprobado, en implementación.

---

## 1. Objetivo

Cuando un vendedor arma un pedido y hay SKUs sin stock libre suficiente (quedarían en Backorder), ofrecer un botón **"Sugerencias"** que proponga alternativas disponibles con filtros estrictos de similitud (tipo, tramos, libraje para cañas; modelo + precio para resto). El vendedor puede **Agregar** la alternativa al pedido o **Reemplazar** el SKU original, sin salir del modal "Pedido en espera".

### Problema que resuelve

Hoy, cuando un cliente pide X SKUs y Y de ellos no tienen stock, el vendedor debe:
1. Memorizar o buscar manualmente qué alternativas con stock pueden interesar al cliente.
2. Convencer al cliente de aceptar un reemplazo o esperar backorder.

El motor de sugerencias elimina el paso 1 y acelera el paso 2 al mostrarle al cliente alternativas defendibles en tiempo real.

---

## 2. Alcance v1

### Incluido
- Botón en modal **"Pedido en espera"** únicamente (no en Alta inicial ni Revisión Excel).
- Cobertura: **todas las categorías** del catálogo (665 SKUs: cañas, reels, líneas, FG, combos).
  - **Cañas** (389 SKUs): matcher con HARD filters tipo+tramos+libraje + SOFT rank.
  - **No-cañas** (276 SKUs): fallback simple (mismo `sub`/modelo + precio ±30%, luego mismo `fam`).
- Visible para todos los roles que ya ven el modal.
- Dos acciones por sugerencia: **Agregar** (qty = faltante) y **Reemplazar** (qty = original).
- Aflojado progresivo: niveles 1→2→3 con badges graduales ⚠️/⚠️⚠️/⚠️⚠️⚠️, visible al tocar "Ver aproximadas".
- Backfill offline Python → `items_attrs/{sku}` en Firestore.
- Telemetría en `sugerencias_log/{logId}`.

### Excluido (fuera de v1)
- Reglas específicas para reels/líneas/FG (quedan en fallback simple).
- Botón en modal Alta inicial o Revisión Excel.
- Panel por línea (todo global por pedido).
- Dashboard analítico sobre `sugerencias_log` (data queda guardada, dashboard es v2).
- Ícono `✨` en el carrito del modal padre marcando líneas que vinieron de sugerencia (datos persistidos, UI es v2).
- Admin UI para editar `items_attrs` desde Panel de Control.

---

## 3. Arquitectura

Tres piezas independientes:

```
┌──────────────────────────────┐     ┌──────────────────────────────┐
│  P1: Backfill Python         │     │  P2: Motor matching JS puro  │
│  scripts/backfill_...py      │────▶│  src/pure/                   │
│                              │     │   product-suggestions.js     │
│  Extrae PRODUCTS → parsea    │     │                              │
│  → items_attrs/{sku} FS      │     │  passHard() sortSoft()       │
└──────────────────────────────┘     │  suggestForSku()             │
                                     │  + tests vitest              │
                                     └──────────┬───────────────────┘
                                                │
                                                ▼
                                     ┌──────────────────────────────┐
                                     │  P3: UI modal apilado        │
                                     │  index.html                  │
                                     │                              │
                                     │  openSugerenciasModal()      │
                                     │  render bandas por SKU       │
                                     │  Agregar/Reemplazar handlers │
                                     │  writes sugerencias_log      │
                                     └──────────────────────────────┘
```

---

## 4. Pieza 1 — Backfill Python

### Script
`scripts/backfill_product_attrs.py`

### Flujo
1. Lee `index.html`, extrae array `PRODUCTS` con regex.
2. Filtra cañas: `cat === 'CAÑAS'` o `fam` contiene `casting|spinning|baitcasting|surfcasting|jigging|multi purpose|shoresurf|telescopic|inshore|boat|travel`.
3. Por cada caña:
   - Parsea `desc` con regex pulidos (ver §4.2).
   - Si queda algún campo HARD sin parsear, intenta heurísticas (ver §4.3).
   - Construye documento `items_attrs/{sku}` (schema §4.4).
   - Agrega `warnings[]` si algún campo quedó sin determinar.
4. Imprime reporte: total, % con 3 HARD completos, lista de SKUs sin cada campo.
5. Si `--dry-run`: no escribe, solo imprime. Si no, escribe batch a Firestore.
6. Agrega doc `items_attrs/__meta__` con `{totalProcessed, warnings, timestamp, source: 'regex_v1'}`.

### 4.2 Regex pulidos

| Campo | Regex principal | Fallbacks |
|---|---|---|
| **Tramos** | `/(\d+)\s*tramos?/i` | `/(\d+)\s*partes?/i` → tramos; `/(\d+)\s*tips?/i` → tramos+1; `/1\+1\s*\(grip joint\)/i` → `tramos: 'variable'` ; sin match + "Blank Sólido" → tramos=1 |
| **Libraje** | `/(\d+)\s*-\s*(\d+)\s*lb/i` | `/\b(\d+)\s*lb\b/` → min=0, max=N; `/Potencia\s+\w+(?:\s+\w+)?\s*(?:\(\w+\))?\s*(\d+)\s*-\s*(\d+)/i` sin "lb" explícito; si falta → infer desde potencia (§4.3) |
| **Largo cm** | `/(\d+(?:\.\d+)?)\s*m\b/i` → `*100` | `/(\d+)[´'`]\s*(\d+)[´"'`]{1,2}/` → `ft*30.48 + in*2.54` |
| **Acción** | `/acci[oó]n\s+(extra\s+r[aá]pida\|moderada\s+r[aá]pida\|r[aá]pida\|moderada\|lenta)/i` | normaliza a `extra_rapida/moderada_rapida/rapida/moderada/lenta`; `/\bfast\b/i` → `rapida` |
| **Potencia** | `/potencia\s+(ultra\s*light\|extra\s*heavy\|medium\s*heavy\|medium\s*light\|heavy\|medium\|light)/i` | normaliza a `UL/XH/MH/ML/H/M/L`; también matchea `\((UL\|L\|ML\|M\|MH\|H\|XH)\)` |
| **Tipo** | De `fam` directo | `casting`→Casting; `spinning`→Spinning; `baitcasting`→Baitcasting; `surfcasting\|shoresurf`→Surfcasting; `jigging`→Jigging; `multi purpose`→Multipurpose |

### 4.3 Heurística libraje desde potencia (fallback)

Si no se pudo parsear libraje numérico, inferir desde `potencia`:

| Potencia | libraje_min | libraje_max |
|---|---|---|
| UL (Ultra Light) | 0 | 5 |
| L (Light) | 4 | 8 |
| ML (Medium Light) | 6 | 14 |
| M (Medium) | 8 | 17 |
| MH (Medium Heavy) | 10 | 20 |
| H (Heavy) | 14 | 30 |
| XH (Extra Heavy) | 20 | 40 |

Agrega `warnings: ['libraje_inferido_desde_potencia']` para auditar.

### 4.4 Schema `items_attrs/{sku}`

```json
{
  "sku": "CLC70H2PY",
  "familia_motor": "canas",
  "tipo": "Casting",
  "tramos": 2,
  "libraje_min": 12,
  "libraje_max": 25,
  "largo_cm": 213,
  "accion": "rapida",
  "potencia": "MH",
  "backfillAt": "2026-10-16T...",
  "source": "regex_v1",
  "warnings": []
}
```

Para no-cañas: no se escribe nada en `items_attrs` — el fallback usa `fam/sub/precio` directo de PRODUCTS.

### 4.5 Gate de verificación

**Required**: ≥95% de cañas con los 3 HARD campos (tipo+tramos+libraje) completos. Si <95%, iterar regex y volver a correr.

---

## 5. Pieza 2 — Motor matching JS

### Archivo
`src/pure/product-suggestions.js`

### API

```js
export function suggestForSku(originalSku, context) {
  // context = { catalog, attrsBySku, stockBySku, cartSkus, priceBySku, qtyFaltante }
  // returns:
  // {
  //   strict: Array<{ sku, score, badge: 'ok' }>,
  //   approx: Array<{ sku, score, badge: 'warn1' | 'warn2' | 'warn3' }>,
  //   mode: 'canas' | 'fallback_sub' | 'fallback_fam',
  //   error?: 'SKU_NOT_IN_CATALOG' | 'NO_ATTRS'
  // }
}
```

### 5.1 HARD filters (cañas)

Un candidato pasa el nivel `N` si cumple:

| Nivel | Tipo | Tramos | Libraje | Badge |
|---|---|---|---|---|
| 0 | igual | igual | overlap ≥ 50% rango menor | `ok` |
| 1 | igual | igual | overlap > 0 | `warn1` |
| 2 | igual | igual | sin filtro | `warn2` |
| 3 | igual | sin filtro | sin filtro | `warn3` |

El **tipo nunca se afloja**.

### 5.2 Cálculo overlap libraje

```js
function overlapRatio(a_min, a_max, b_min, b_max) {
  const overlap = Math.max(0, Math.min(a_max, b_max) - Math.max(a_min, b_min));
  const minRange = Math.min(a_max - a_min, b_max - b_min);
  if (minRange === 0) return a_min === b_min ? 1 : 0;  // single-value rods
  return overlap / minRange;
}
```

### 5.3 SOFT rank

Score dentro de cada nivel:

```
score = 0
if candidato.sub === original.sub: score += 100
if |candidato.largo_cm - original.largo_cm| <= 15: score += 50
if candidato.accion === original.accion: score += 30
score += (50 - |delta_precio_pct|)  // -50 a +50
```

Mayor score arriba. Desempate: mayor `stockLibre` → menor `precio`.

### 5.4 Fallback no-cañas

```js
if (attrsBySku[originalSku]?.familia_motor !== 'canas') {
  const sameSub = candidates.filter(c =>
    c.sub === original.sub &&
    withinPct(priceBySku[c.code], priceBySku[originalSku], 0.30)
  );
  if (sameSub.length > 0) return { strict: sortByPrice(sameSub), mode: 'fallback_sub' };
  const sameFam = candidates.filter(c => c.fam === original.fam);
  return { approx: sortByPrice(sameFam), mode: 'fallback_fam' };
}
```

### 5.5 Exclusiones (siempre)

- SKUs ya en `cartSkus`
- SKUs con `stockBySku[c.code] < qtyFaltante`
- El propio `originalSku`
- SKUs no presentes en `catalog`

### 5.6 Testing

`tests/pure/product-suggestions.test.js` — vitest, ≥20 casos cubriendo:
- Match exacto único / múltiple
- Sin match estricto, hay aproximados
- Sin match ningún nivel
- SKU no en catálogo → error
- Exclusiones (carrito, stock insuficiente)
- Fallback mismo `sub` / mismo `fam` / vacío
- Soft rank: desempate stock / precio
- Overlap edge cases (0%, exactamente 50%, 100%)

Fixtures: `tests/fixtures/catalog-sample.js` con 30 cañas sintéticas + 10 no-cañas que ejercen los 4 niveles + fallback.

Target: branch coverage ≥95%.

---

## 6. Pieza 3 — UI modal

### Botón en toolbar

Ubicación: entre banner de alertas y buscador de productos (como marcó Mariano en screenshot). Width 100% o centered.

Estados:

| Condición | Visual |
|---|---|
| ≥1 SKUs faltantes | `✨ Sugerencias (3)` azul primario |
| 0 faltantes | oculto (no renderiza) |
| Pedido en SAP | deshabilitado + tooltip |

### Modal apilado (z-index 5100)

Header: `Sugerencias — ORDEN NNN — CLIENTE · Pedido: X prod · Y u · $Z`

Body: una banda por SKU faltante:
```
▌ CLC70H2PY — [descripción corta]
▌ Faltan: N u · $X c/u

┌─ Sugerencias estrictas ─┐
│ ✅ sku1  [chips]        │
│    stock: X · $Y (+/-%)│
│    [+ Agregar N] [⇄ Reempl N]│
│ ✅ sku2  ...             │
└──────────────────────────┘

[ Ver alternativas aproximadas ▽ ]
```

Al expandir aproximadas, agrupadas por nivel con separadores:
```
──── Aproximadas (libraje distinto) ⚠️  ────
──── Muy aproximadas (sin libraje)  ⚠️⚠️ ────
──── Último recurso (solo mismo tipo) ⚠️⚠️⚠️ ────
```

Chips: `[Casting] [2 tramos] [12-25 lb] [7'0''] [Rápida]` — con `⚠` sobre el chip individual si NO coincide con el original.

### 6.1 Handlers

**Agregar**:
1. Llama API existente del modal padre para `pedidos/{id}/lines.add({sku, qty, source: 'sugerencia', originSku})`.
2. Fila se vuelve verde con `✓ Agregado · [Deshacer]` por 5s.
3. Append a `sugerencias_log.skusFaltantes[i].acciones`.

**Reemplazar**:
1. Confirmación inline: *"¿Reemplazar X por Y? El original se elimina."*
2. Al confirmar: `removeLine(originalSku)` + `addLine({sku, qty: originalQty, source: 'reemplazo', originSku})`.
3. Banda del SKU original desaparece.
4. Si era el último faltante, cierra modal con mensaje de éxito.

**Ver aproximadas**:
Expand/collapse de los niveles 1+2+3 agrupados.

### 6.2 Estados especiales
- **Loading** `attrsBySku`: spinner "Cargando sugerencias…"
- **Error red**: cartel + Reintentar + Sentry log
- **Todos faltantes sin attrs**: cartel "Ningún SKU faltante tiene datos técnicos cargados. Avisá a admin."

### 6.3 Mobile
- Fila vertical, chips wrappean, botones full-width apilados.
- Modal full-screen en viewports <768px.

---

## 7. Datos & telemetría

### 7.1 Collection `items_attrs/{sku}`
Backfilled por Python. Schema §4.4.

**Rules**:
```js
match /items_attrs/{sku} {
  allow read: if isAuthed();
  allow write: if isAdmin();
}
```

### 7.2 Collection `sugerencias_log/{logId}`

```json
{
  "logId": "<auto>",
  "pedidoId": "407",
  "orderNumber": 407,
  "clienteName": "GUSTAVO DESIATA",
  "vendedor": { "email": "...", "displayName": "...", "vendorKey": "..." },
  "openedAt": "<ts>",
  "closedAt": "<ts>",
  "closedReason": "manual|all_resolved|cancel",
  "appVersion": "v1346",
  "skusFaltantes": [
    {
      "sku": "CLC70H2PY",
      "qtyPedida": 3,
      "qtyFaltante": 3,
      "esCana": true,
      "sugerenciasStrict": [ { "sku": "...", "stockLibre": N, "precioDelta": N } ],
      "sugerenciasApprox": [],
      "acciones": [
        { "ts": "...", "type": "agregar|reemplazar|ver_aproximadas", "sku": "...", "qty": N }
      ]
    }
  ]
}
```

**Rules**:
```js
match /sugerencias_log/{logId} {
  allow create: if isAuthed() && request.resource.data.vendedor.email == request.auth.token.email;
  allow read: if isAdmin() || isGerente();
  allow update: if isAuthed() && resource.data.vendedor.email == request.auth.token.email;
  allow delete: if false;
}
```

### 7.3 Campos nuevos en `pedidos/{id}/lines/{lineId}`

| Campo | Tipo | Default | Descripción |
|---|---|---|---|
| `source` | string | undefined | `'sugerencia'` o `'reemplazo'` si vino del modal; undefined si manual |
| `originSku` | string | undefined | SKU que originó la sugerencia (solo si source != undefined) |

Actualizar `firestore.rules` para incluir estos campos en el whitelist `hasOnly` de `pedidos/.../lines` (feedback v776/v859).

---

## 8. Edge cases

| Caso | Comportamiento |
|---|---|
| SKU faltante no en PRODUCTS | Banda con cartel "Sin datos técnicos" + log Sentry |
| Sugerencia con stock < faltante | Excluida |
| Sugerencia ya en carrito | Excluida |
| Pedido pasa a SAP mientras modal abierto | onSnapshot cierra el modal con cartel |
| Vendedor agrega misma sugerencia 2× | Permitido (2 líneas separadas) |
| Dos vendedores abren mismo pedido | Cada uno su propio modal + log; sincronización via onSnapshot del pedido padre |
| Backfill `items_attrs` incompleto | Fallback simple o cartel "sin datos" para ese SKU puntual |

---

## 9. Plan de implementación

| Fase | Trabajo | Tiempo | Depende |
|---|---|---|---|
| F0 | Design doc + rama | 0.5h | — |
| F1 | Backfill Python + verificar ≥95% | 4h | F0 |
| F2 | Motor JS + tests vitest | 3h | F1 |
| F3 | UI modal + handlers + log | 5h | F2 |
| F4 | firestore.rules + deploy | 1h | F3 |
| F5 | Review paralela + PR + merge | 2h | F4 |
| F6 | Post-deploy sanity | 0.5h | F5 |

**Total**: ~16h. Repartidas en 2-3 sesiones.

### Gates de verificación

- F1: `backfill_product_attrs.py --dry-run` reporta ≥95% HARD completo
- F2: `npx vitest run tests/pure/product-suggestions.test.js` todo verde + coverage ≥95%
- F3: Build `node build.js` OK + lint `biome check` sin regresiones + smoke manual con screenshot
- F4: `firebase deploy --only firestore:rules --dry-run` OK + simulator rules passes
- F5: 3 subagentes review sin flags críticos + PR aprobado

### Skills a usar

- `superpowers:verification-before-completion` — gate por fase
- `tdd-workflows:tdd-cycle` — F2 (tests antes de código)
- `apple-design` — F3 (look & feel)
- `webapp-testing` — F3 (smoke manual)
- `pr-review-toolkit:code-reviewer` + `silent-failure-hunter` + `comment-analyzer` — F5 paralelos
- `superpowers:finishing-a-development-branch` — F5

---

## 10. Riesgos declarados

| Riesgo | Mitigación |
|---|---|
| Regex no alcanza 95% HARD completo | Iterar regex con reporte --dry-run; en último recurso completar los <5% a mano antes de push |
| Sugerencias "aproximadas" mal etiquetadas → vendedor cree que son match exacto | Badges graduales ⚠️/⚠️⚠️/⚠️⚠️⚠️ + separadores explícitos con texto |
| Motor sugiere SKUs mal valorados → cliente rechaza | Telemetría `sugerencias_log` permite detectar patrones y ajustar en v2 |
| Modal pesado en mobile (bandas largas) | Diseño responsive con fila vertical + modal full-screen <768px |
| Backfill desactualizado cuando entra SKU nuevo | Script idempotente; se puede re-correr. V2 agrega hook al pipeline de sync SAP |
| Writes a `sugerencias_log` fallan por rules strict | Create usa `isAuthed()` + email match; test con simulator antes de deploy |
| Rules `pedidos/lines.hasOnly` olvida nuevos campos → líneas se rechazan silenciosamente | Feedback explícito v776/v859: actualizar whitelist en el mismo PR |

---

## 11. v2 — fuera de scope

- Dashboard analítico sobre `sugerencias_log` en Panel de Control.
- Reglas específicas para reels (tamaño del carretel, relación), líneas (diámetro, resistencia), FG.
- Botón en modal Alta inicial.
- Ícono `✨` en líneas del carrito que vinieron de sugerencia.
- Admin UI para editar `items_attrs` desde Panel.
- Hook al pipeline SAP sync para auto-backfillear SKUs nuevos.
- Score ML entrenado con `sugerencias_log` para ranking personalizado por cliente.
