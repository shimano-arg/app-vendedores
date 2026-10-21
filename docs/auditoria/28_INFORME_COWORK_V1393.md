# 28 — Informe Cowork v1393 §40.1 — waitlistCpst NO reserva + UI sin subtexto

**Fecha**: 2026-10-21
**Rama**: `fix-waitlist-cpst-doble-conteo` → `main`
**SHA merge**: `c1386de`
**PR**: [#1128](https://github.com/shimano-arg/people-arg/app-vendedores/pull/1128)
**Deploy**: GitHub Pages auto + `firebase deploy --only functions:applyRepartoManualCF,functions:onDep11IncreaseCreateReparto` (16:07 UTC)

---

## 1. Caso emblemático: BENGOCHEA 597151

**Reporte Mariano**: físico 2, Stock Asignado muestra 2u Bengochea, pero Lista de espera dice reservadas 6.

**Dump prod**:
- Pedido `EFw2AM0lhfp8VRB52KmG` ORDEN 467 (`manual-backorder`): `state=ASIG qty=6 qtyOpen=6 asigAt=2026-10-20T17:37` (vigente, 1d).
- Waitlist `GYQRCgyXyOJttrQyNsru` (`source=stock-asignado-batch`): `items[0].qty=6` para BENGOCHEA.
- Mismo cliente (C20293164852), mismo SKU → **doble conteo**.

Antes de §40.1: breakdown contaba `asignadas.total=6 + waitlistCpst.total=10 (incluye otros clientes) = 16 u reservadas` con físico 2. VDE veía "reservadas 16" en la columna del modal Pedido en espera.

---

## 2. Explicación script vs modal (6 vs 2)

Mariano preguntó por qué el script dice asig 6 y el modal Stock Asignado dice 2 Bengochea. **No es bug** — son conceptos distintos:

- **Script dump** (`_dump_597151_bengochea.cjs`): cuenta la ASIG nominal del pedido → `qtyOpen = 6`. Representa cuántas unidades BENGOCHEA tiene "prometidas" en la ASIG.
- **Modal Stock Asignado** (`computeBackorderSkuMap` modo `asignacion`, `aggregationMode='fifo'`): aplica FIFO cap por físico → `qtyAsignada = min(ASIG, fisicoDisponible) = min(6, 2) = 2`. Representa cuántas unidades se pueden **efectivamente entregar HOY**.

Las 4 restantes de la ASIG quedan nominalmente reservadas pero sin backing físico. Esto es un patrón normal cuando hay sobre-reserva (promesa > físico).

Documentado en `src/pure/backorder-sku-map.js:408-472` (modo FIFO paso 1 prioritarios).

**No requiere corrección**. El breakdown v3 muestra `asignadas.total=6` + `utilizablePara(BENGOCHEA)=2` — ambos valores correctos, representan la nominal y la backable respectivamente.

---

## 3. Fix §40.1 implementado

### 3.1 `src/pure/stock-breakdown.js` + mirror `functions/core/pedido-snapshot-core.js`

```js
// v1393 §40.1: reservadasTotal = ASIG + confirmed (SIN waitlistCpst).
const reservadasTotal = confirmadasSinFacturar.total + asignadas.total;

// utilizablePara: waitlist propia NO cuenta como reserva propia.
for (const map of [buckets.confirmed, buckets.ASIG]) { ... }

_version: 3  // bump v2 → v3
```

- `waitlistCpst` sigue en el shape como bucket informativo (visible para tooltips/debug).
- `_version: 3` detecta drift v2 code paths.
- Test de sincronía src/pure vs functions/core actualizado.

### 3.2 UI — sin subtexto en Reservadas/Libre

En Modal Pedido en espera (index.html:24322-24405):

**Antes**:
- Celda Reservadas: número + sub-línea "N en reparto pendiente (no reserva)" o "N clientes en back order".
- Celda Libre: número + sub-línea "N tuyas".

**Después**:
- Ambas celdas: SOLO el número.
- Desglose completo en el tooltip (hover). Incluye: Confirmed + ASIG = Reservadas, waitlistCpst (si > 0, informativo, no reserva), BO (no reserva), reparto abierto (si > 0, no reserva), reservas propias vs otros.

Modal Revisión Excel ya solo tenía número (sin cambios requeridos).

---

## 4. Tests

- **Nuevos** (`tests/unit/audit/waitlist-cpst-no-reserva.test.js`, 6 PASS):
  - Caso real BENGOCHEA: ASIG 6 + waitlist 6 → reservadas 6 (no 12).
  - Fixture Mariano: orden CPST 6 con ASIG 2 y físico 2 → reservadas 2, libre 0, utilizable 2.
  - Waitlist huérfano (sin ASIG) tampoco reserva.
  - utilizablePara: BO + waitlist del cliente NO cuentan como reserva propia.
  - `_version = 3`.
  - Sync: espejo functions/core idéntico.

- **Legacy ajustados** (semántica invertida):
  - `tests/unit/audit/getStockDesglose-breakdown.test.js`: WAITLIST_CPST en breakdown pero no en comprometido.
  - `tests/unit/audit/_fixtures.smoke.test.js`: waitlist CPST NO reserva.
  - `tests/unit/audit/stock-breakdown-sync.test.js`: `_version=3`.
  - `tests/unit/stock-breakdown.test.js`: `_version=3`.

**Suite completa: 1512 PASS + 1 FAIL** (pre-existente `reparto.test.js`).

---

## 5. Efecto en prod verificado post-deploy

Script `scripts/audit/K_efecto_waitlist_no_reserva.cjs` (pre-merge, read-only):

| Métrica | Valor |
|---|---|
| SKUs cuyo libre SUBE | **31** |
| Total unidades que pasan a libre | **139 u** |

**Verificación post-deploy BENGOCHEA 597151**:
```
fisicoDep11: 2
asignadas.total: 6
waitlistCpst.total: 10 (informativo, no reserva)
reservadasTotal: 6              ← antes era 16 (16 - 10 waitlist = 6)
libre: 0                        ← clamp max(0, 2-6)
utilizablePara(BENGOCHEA): 2    ← min(2, 0+6) = 2 ✓
_version: 3
```

Lista de Espera modal del VDE: ahora celda Reservadas de 597151 muestra **6** (no 16). Doble conteo eliminado.

### Top 10 SKUs con mayor delta

| SKU | fisico | asig | conf | wlCpst | librePre | librePost | delta |
|---|---|---|---|---|---|---|---|
| LDM54TE3023015S | 18 | 0 | 0 | 15 | 3 | 18 | +15 |
| LDM54TE5031515H | 40 | 12 | 0 | 12 | 16 | 28 | +12 |
| LDM54TE4028015S | 20 | 0 | 0 | 10 | 10 | 20 | +10 |
| EXGC66MBAR | 63 | 6 | 0 | 10 | 47 | 57 | +10 |
| EXGTVS70MH4AR | 24 | 15 | 0 | 22 | 0 | 9 | +9 |
| FX2000FC | 61 | 28 | 1 | 8 | 24 | 32 | +8 |
| EXGS70HB2AR | 57 | 7 | 0 | 7 | 43 | 50 | +7 |
| CRZAXFGB2502 | 30 | 7 | 0 | 7 | 16 | 23 | +7 |
| LDM54TE1516015G | 23 | 15 | 0 | 6 | 2 | 8 | +6 |
| CLT01047 | 14 | 0 | 0 | 5 | 9 | 14 | +5 |

Lista completa en `docs/auditoria/27_EFECTO_WAITLIST_NO_RESERVA.md`.

---

## 6. CLAUDE.md

§40.1 agregada como extensión de §40:

> waitlistCpst es draft VDE. NO reserva por sí mismo. La ASIG original ya reserva su stock. Si el VDE sube la cantidad al confirmar, el excedente va a BO (que no reserva por §40).

---

## 7. Deploy

- **Rama**: `fix-waitlist-cpst-doble-conteo`.
- **PR**: #1128 (merged `--squash --admin`).
- **SHA en main**: `c1386de`.
- **GitHub Pages**: auto-deploy v1393 live.
- **Firebase Functions**: `applyRepartoManualCF` + `onDep11IncreaseCreateReparto` ambas ACTIVE 2026-10-21T16:07 UTC.

---

## 8. Follow-ups

1. **Popup "Stock del SKU" del Master** sigue usando `computeBackorderSkuMap` legacy (follow-up v1392 pendiente).
2. **D3** (SQ → Order SAP): respuesta pendiente.
3. **demandaSapSinCubrir** del breakdown queda como `null` (DEPRECATED v1392). Eliminar del shape en v1394.
4. **BENGOCHEA 597151 ORDEN 467**: la ASIG 6 con físico 2 queda nominalmente sobre-reservada (4 u sin backing). Es normal post-§40; Pablo decide via reparto si cambia.

---

## 9. Qué le toca a Mariano

1. **Smoke manual post-v1393**: abrir Lista de Espera para 597151 → verificar que la columna Reservadas muestra 6 (no 16), SIN subtexto.
2. **Verificar celdas Reservadas / Libre** en modal Pedido en espera: solo número, tooltip con desglose al hover.

---

## 10. Entregables shipped

- `src/pure/stock-breakdown.js` v3 (waitlist no suma).
- `functions/core/pedido-snapshot-core.js` mirror.
- `index.html` Modal Pedido en espera sin subtexto.
- Tests: `waitlist-cpst-no-reserva.test.js` nuevo + 4 legacy ajustados.
- Scripts audit: `_dump_597151_bengochea.cjs` + `K_efecto_waitlist_no_reserva.cjs`.
- Docs: `26_WAITLIST_CPST_DOBLE_CONTEO.md`, `27_EFECTO_WAITLIST_NO_RESERVA.md`, `28_INFORME_COWORK_V1393.md` (este).
- CLAUDE.md §40.1 nueva.
- APP_VERSION/CACHE_VERSION v1392 → v1393.
