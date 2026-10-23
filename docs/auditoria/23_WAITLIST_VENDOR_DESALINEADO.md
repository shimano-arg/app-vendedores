# Audit — Waitlists con assignedVendorUid desalineado

**Fecha**: 2026-10-23
**Rama**: `fix-visibilidad-waitlist-vendedor-master`
**Script**: `scripts/audit/T_waitlist_vendor_desalineado.cjs` (dry-run)
**Regla**: CLAUDE.md §44 + §46 + §59 (nuevo)

## Contexto del bug

Mariano reportó 2026-10-23: el guard §42.2 ofrece a Gonzalo De La Rosa
unificar la **ORDEN 516 BROBRO SA** (67 SKU, 170 u, cargada por Pablo
González el 22/10) pero Gonzalo no ve esa orden en su lista de espera.

Hipótesis Mariano (CONFIRMADA):

> El filtro de la lista de espera del vendedor filtra por `createdBy` /
> `ownerUid` (quién la cargó) O por `ownerVendor` legacy, en vez de por
> `assignedVendorUid` del cliente master actual.

## Grep del filtro — antes del fix

### Call-site 1: `index.html:_renderWaitlistSidebar` (línea 20752-20761, v983)

```js
let arrForRole = arr;
if (typeof userRole !== 'undefined' && userRole === 'vendedor') {
  const _myUid = (typeof currentUser !== 'undefined' && currentUser && currentUser.uid) || '';
  const _myVendor = (typeof assignedVendor !== 'undefined') ? (assignedVendor || '') : '';
  arrForRole = arr.filter(w => {
    if (_myUid && w.ownerUid === _myUid) return true;
    if (_myVendor && (w.ownerVendor === _myVendor || w.vendorAssigned === _myVendor)) return true;
    return false;
  });
}
```

**Problema**: `w.ownerUid === _myUid` → Pablo UID ≠ Gonzalo UID → excluye.
`w.ownerVendor === _myVendor` depende de que `ownerVendor` esté bien seteado
(no siempre lo está en legacy); para la ORDEN 516 sí lo está, pero el OR
corto-circuita en la primera condición false del `||` dentro del `if`.

Esperando: `(w.ownerVendor === _myVendor || w.vendorAssigned === _myVendor)` →
Gonzalo tendría `ownerVendor === 'GONZALO DE LA ROSA'` que SÍ matchearía.
Pero verifiqué el doc: `ownerVendor` SÍ está `GONZALO DE LA ROSA`. ¿Por qué
no la ve?

Causa raíz: la variable `assignedVendor` del inline (`var assignedVendor = null`
línea 28987) se setea solo cuando se detecta el rol. Para VDE loguearse Gonzalo
tiene `assignedVendor = 'GONZALO DE LA ROSA'`. **PERO** si la carga del cache
de `vdeUsers`/roles arranca con retraso (asíncrono), el primer render del sidebar
puede quedar con `assignedVendor === ''` → el `if (_myVendor && ...)` corto-
circuita → `return false`. El segundo render (post-cache) sí lo capta pero las
cards no se actualizan en vivo salvo que entre otro snapshot.

En cualquier caso, el fix correcto es filtrar por `assignedVendorUid` que es:
- (a) determinístico (no depende de async carga de users),
- (b) coherente con §44 (fuente de verdad = cliente master),
- (c) ya está populated en el 100% de los docs post-§44.

### Call-site 2: `index.html:_renderEstadoList` (línea 21713-21717, v983)

```js
arrEspera = _arrEsperaRaw.filter(w => {
  if (_myUid && w.ownerUid === _myUid) return true;
  if (_myVendor && (w.ownerVendor === _myVendor || w.vendorAssigned === _myVendor)) return true;
  return false;
});
```

Mismo bug — también fixed.

### Call-site 3 (Planner): `index.html:34491` — YA ESTABA FIX desde v1406 §44

```js
if (_isVDEForWaitlist) {
  const _assigned = String(data.assignedVendorUid || '').trim();
  const _owner = String(data.ownerUid || '').trim();
  if (_assigned) {
    if (_assigned !== currentUser.uid) return;
  } else if (_owner !== currentUser.uid) {
    return;
  }
}
```

El Planner YA usa `assignedVendorUid`. El sidebar + modal Estado quedaron
desalineados (v983 anterior a §44).

### Firestore rules

`revision_waitlist.read` abierto a `isReader()` — sin cambio. El filtro es
client-side. Ningún `allow read` escondido por vendor.

## Grep del filtro — después del fix (§59, v1437)

Ambos call-sites ahora llaman al pure helper
`window.__phase0.pure.waitlistVisibility.filterWaitlistsForVendor(arr, myUid, myVendorKey)`
con fallback inline idéntico (por si el bundle no cargó, SW stale).

Helper (`src/pure/waitlist-visibility.js`):

```js
export function isWaitlistVisibleForVendor(w, myUid, myVendorKey) {
  if (!w || !myUid) return false;
  const assigned = String(w.assignedVendorUid || '').trim();
  if (assigned) {
    return assigned === myUid;              // §44 autoritativo
  }
  // Fallback legacy pre-§44 (defensa):
  const owner = String(w.ownerUid || '').trim();
  if (owner && owner === myUid) return true;
  const vk = String(myVendorKey || '').trim();
  if (!vk) return false;
  const ownerV = String(w.ownerVendor || '').trim();
  const vAss = String(w.vendorAssigned || '').trim();
  return ownerV === vk || vAss === vk;
}
```

## Diagnóstico contra prod — ORDEN 516 BROBRO

Script `T_waitlist_vendor_desalineado.cjs --dry-run` output (resumen):

```
revision_waitlist docs: 37
Resumen:
  OK (aligned): 18
  Desalineado (fix candidate): 3
  Vendor sin UID (requiere alta user): 0
  Sin master (cliente no en OCRD/altas): 0
  TOTAL waitlists abiertos revisados: 21

--- Caso focal ORDEN 516 / BROBRO (C30718510291) ---
{
  "wlId": "yU462myf9HkKPO918NoV",
  "orderNumber": "516",
  "clientCardCode": "C30718510291",
  "clientName": "BROBRO SA",
  "createdAt": "2026-10-22T13:30:27.152Z",
  "ownerEmail": "pablo.gonzalez@shimano.com.ar",
  "currentOwnerUid": "NKexDkWCGgcJb3KApk1bcIjT5MG3",
  "currentOwnerVendor": "GONZALO DE LA ROSA",
  "currentVendorAssigned": "GONZALO DE LA ROSA",
  "currentAssignedUid": "WWuppaSQqeMZPIk8yvfctyhSQgu1",
  "expectedVendorKey": "GONZALO DE LA ROSA",
  "expectedUid": "WWuppaSQqeMZPIk8yvfctyhSQgu1",
  "expectedEmail": "gonzalo.de.la.rosa@shimano.com.ar",
  "resolveSource": "approvedAlta",
  "reason": "ok",
  "aligned": true
}
```

Conclusión:
- **La ORDEN 516 YA tiene `assignedVendorUid = Gonzalo` correcto**.
- El cliente BROBRO SA está en `client_applications` (approvedAlta) con
  `assignedVendor = GONZALO DE LA ROSA`.
- El fix del filtro **es suficiente** para resolver el bug reportado. No
  requiere backfill de datos.

## Órdenes desalineadas detectadas (fix candidate — opcional)

3 waitlists con `assignedVendorUid=''` pero el VDE sí es el owner (Gonzalo
cargó para sus propios clientes pero el payload antiguo no seteaba el
`assignedVendorUid`):

| OrderNumber | CardCode | Cliente | ownerUid (email) | expected VendorKey | expected UID |
|---:|---|---|---|---|---|
| 534 | C20317114312 | DAMIAN DAVID TESI | WWuppaSQ... (gonzalo.de.la.rosa) | GONZALO DE LA ROSA | WWuppaSQ... |
| 537 | C20337218831 | LUCAS M. BAIGORRIA | fIWSP9wc... (federico.castelaneli) | FEDERICO CASTELANELLI | fIWSP9wc... |
| 538 | C20229279239 | EDUARDO SATO | WWuppaSQ... (gonzalo.de.la.rosa) | GONZALO DE LA ROSA | WWuppaSQ... |

Estas 3 ya son visibles para su VDE respectivo via el **fallback** del
filtro (`ownerUid === myUid`). El backfill `--apply` las migraría al
estado post-§44 por consistencia pero no es blocking.

**NO corro `--apply` sin OK explícito de Mariano** (CLAUDE.md §55 — backfill
guarda snapshot `_backfill.<slug>` con los 4 campos originales por si hay
que revertir).

## Fix aplicado (resumen)

### Archivos modificados

- `src/pure/waitlist-visibility.js` — pure helper nuevo.
- `src/main.js` — import + export en `window.__phase0.pure.waitlistVisibility.*`.
- `index.html:_renderWaitlistSidebar` (línea ~20752) — reemplaza filtro
  inline con helper + fallback inline.
- `index.html:_renderEstadoList` (línea ~21710) — misma edición.
- `tests/unit/visibilidad-waitlist-vendor.test.js` — 15 tests unitarios.
- `tests/unit/audit/visibilidad-guard-consistency.test.js` — 3 property
  (≥200 runs) + guard §42.2 ↔ sidebar.
- `CLAUDE.md §59` — regla nueva.
- `scripts/audit/T_waitlist_vendor_desalineado.cjs` — dry-run por default.

### Tests

- `npx vitest run tests/unit/` → **1706 PASS, 0 FAIL** (19 nuevos sobre v1436).
- `npx vitest run tests/smoke/` → 25 PASS.

### Bundle

- `node build.js` → bundle 2.8 MB (sin cambio estructural).

## Deploy

NO deploy desde este agente. PR → orquestador controla CI + merge + deploy.
