# Brainstorming Anexo — Casos de grises adicionales (Etapa 1)

Casos **no listados en el prompt Mariano original** pero relevantes para las reglas R1-R10 + hallazgos E0. Aplicando lentes de `superpowers:systematic-debugging`.

## Lente temporal

- **B01** — Clock skew entre client (device user) y Firestore server timestamps: `confirmedAt` del cliente vs `createdAt` server; TTL checks usan `Date.now()` cliente mientras pedido tiene timestamp server. Un VDE con reloj adelantado 1h hace que todas sus ASIG venzan 1h antes.
- **B02** — Pedido confirmed sin `confirmedAt` (data corrupta pre-§36): post-v1384 estas líneas no reservan. ¿Cuántas hay en prod? Scan en E2.
- **B03** — `createdAt` del pedido queda en `firestore.FieldValue.serverTimestamp()` **pending** hasta flush; durante el flush, otro listener lee el doc con `createdAt=null` → TTL check `now - null = NaN` → nunca reserva ni vence.
- **B04** — Pedido confirmed con `confirmedAt` futuro (reloj adelantado) → nunca vence por §38 (soft 7d).

## Lente data corrupta

- **B05** — Líneas con `qtyOpen > qty` (imposible pero posible por bug concurrencia): `qtyOpen` cuenta más que `qty` → bucket breakdown rompe la invariante `reservadas = sum(qtyOpen)`.
- **B06** — Líneas con `qty <= 0`: ignoradas en algunos renders pero contadas en otros. Script scan E2.
- **B07** — `precio = 0` + `priceAtCreation = 0` en línea no-cancelada (self-unify precedente v1418 §42.2.1 dup detected pre-fix): invariante R9 "va a SAP = subtotal × desc" se rompe.
- **B08** — `cardCode` vacío en pedido pero `clientName` populated: Generar Backorder manual (fix v1401 §40.9); verificar que todos los flows persistan key canónica (R10).
- **B09** — `asigAt` sin `state='ASIG'` (data corrupta): v1402 §40.10 elimina `asigReserva=false`, pero ¿hay líneas con `asigAt != null` y state distinto a ASIG en prod?
- **B10** — `closedReason != null` sin `state='cancelled'`: inverse corrupción.
- **B11** — `pedido.waitlistOrigenId` apunta a doc que no existe (waitlist borrada): §42.1 fallback a cache local, pero si cache también no tiene → silent-null.
- **B12** — Línea con `origen='stock-asignado'` pero `asigRefs=[]` (shape incompleto): fórmula §35 cae al global.

## Lente boundary

- **B13** — Cliente con 0 pedidos abiertos + crea CPST con 0 items (click accidental): waitlist vacío → unificación §42 con otro waitlist absorbe sin merge real; test caso.
- **B14** — Reparto con `clientesBO=[]` (cola vacía después de cancelaciones): script extracción al modal muestra sin BO; aplicar reparto crea asignaciones a 0 clientes. Debería cancelarse auto.
- **B15** — Qty total pedido = INT_MAX (overflow): `qtyOpen + qtyInvoiced + qtyCancelled` desborda. Teórico pero posible.
- **B16** — Pedido con `lines.length = 0` post-cleanup de todas las líneas: ¿stage queda 'confirmed' sin líneas? ¿sync SAP envía SQ vacía?
- **B17** — Breakdown de SKU con 500+ pedidos abiertos (perf): tiempo de compute + memoria.

## Lente idempotencia

- **B18** — `revertSobreAsignadas` corre 2x en el mismo tick (CF scheduler + manual trigger): post-primera, breakdown devuelve `sobreAsignada=0` → segunda es no-op. Verificar que no haya race intermedio.
- **B19** — `onPedidoConfirmedSendToSap` ejecuta y falla POST a SAP (SL caído) + reintenta: v1006 `NumAtCard` check evita dup. Pero si el error es `transferidoSAP` write-fail post-POST OK → SAP tiene SQ, app no → reintento verá sin `transferidoSAP` → busca `NumAtCard` → encuentra → setea idempotent. OK pero verificar.
- **B20** — Reparto se aplica, falla el update de `reparto.status='applied'`, se re-ejecuta: líneas ya en ASIG + reparto todavía 'pending' → segundo apply crea más ASIG sobre las ya asignadas.

## Lente observer effect

- **B21** — Al leer `getStockBreakdown` para render UI, se filtran por `lineReservesStock(line, now, pedido)` → `now` cambia entre lecturas → líneas en el borde del TTL (6d 23h 59m) flipean entre reservan/no reservan en renders sucesivos.
- **B22** — `window.currentUserFichaEditor` leído al login no se refresca cuando admin cambia el flag mid-session.
- **B23** — SW cache stale: user con v1420 cacheado + reglas v1424+ en Firestore → operaciones cliente usan reglas viejas (ej. `getStockUtilizableParaClienteExAsig` pre-§35) + Firestore valida con reglas nuevas → rechaza silencioso.

---

Total: **23 casos adicionales** (meta >=15 cumplida).
