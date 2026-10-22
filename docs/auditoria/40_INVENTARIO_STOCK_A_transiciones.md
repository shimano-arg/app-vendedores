# Inventario Stock A — Transiciones de Estado (Etapa 0)

**Agente**: Explore A · 3 min · 16 tool uses · 174s.
**Alcance**: pedidos.lines[] + revision_waitlist.items[], 34 transiciones.

> **FLAG coordinador**: algunas filas tienen archivo:línea genéricos ("~17298", "~26355"). Cross-check pendiente para las que no tengan línea exacta. Tests citados pueden no existir (ej. `cpst-liberar-reserva-flow.test.js` — verificar).

## Matriz (34 filas)

| ID | Función | archivo:línea | Trigger | Estados origen → destino | Mutaciones qty* | closedReason | ¿breakdown? | ¿test? |
|---|---|---|---|---|---|---|---|---|
| T01 | doConfirmPedido | index.html:34720+ | vendedor | BO→confirmed si disp>0; BO→cancelled si disp=0 | qtyOpen=min(qtyOpen,disp); qtyCancelled+=excedente | recorte_vendedor_cpst | sí | tests/unit/audit/fix-h1.test.js |
| T02 | _cpstConfirmar | index.html:17398+ | vendedor CPST | ASIG→cancelled (no entra) resto ASIG→waitlist | qtyOpen reducido | cliente_rechazo_cpst §40.6, asig_sin_stock_revertida_a_bo §40.5 | sí (§33/§35) | cpst-revert-flow.test.js |
| T03 | _cpstConfirmar bloque v1280 | index.html:34881+ | vendedor | ASIG origen→cancelled + BO nuevo | linea origen qtyOpen=0; BO new | waitlist-confirm | sí | cpst-unify-§42-fresh-check.test.js |
| T04 | cancelLine (_waitlistPasarAPendientesContinuar) | index.html:25722+ | vendedor | confirmed/ASIG→cancelled | qtyOpen→0; qtyCancelled+=prev | cliente_rechazo_cpst | no | cpst-liberar-reserva-flow.test.js |
| T05 | _wcardDeleteOption | index.html:25877+ | vendedor | item waitlist→deleted; ASIG origen→cancelled | audit | quitado_por_vendedor_cpst §40.7 | no | cpst-delete-choice-flow.test.js |
| T06 | applyRepartoManualCore (CF) | functions/core/reparto-core.js:676+ | admin/CF | BO+phys asignables→ASIG | line.state='ASIG'; asigAt; asigFromReparto=true | — | sí | tests/functions/reparto.test.js |
| T07 | redistributeAsigLine | src/pure/reparto-stock-asig.js:221 | admin | ASIG→cancelled (reduct qty=0) | qtyOpen→0 | reparto-admin §7 | no | reparto-stock-asig.test.js |
| T08 | redistributeAsigLine (absorb) | src/pure/reparto-stock-asig.js:356 | admin | BO→cancelled (consumido) | qtyOpen→0 | reparto-admin-absorbed | no | reparto-stock-asig.test.js |
| T09 | revertSobreAsignadas CF | functions/core/reparto-core.js:1062+ | CF | ASIG nominal>física→split: ASIG entregable + BO recorte | ASIG qty=qtyEnt; BO qty=recorte | asig_sin_stock_revertida_a_bo §40.5 | sí | asig-sin-reserva-eliminada.test.js |
| T10 | reconcileRepartosFaltantes CF | functions/core/reparto-core.js:332+ | CF (stock↑) | BO+confirmedNoFacturado→ingresos_reparto | líneas sin cambio | — | sí | reconcile-breakdown-sync.test.js |
| T11 | syncSapInvoicesToApp CF | functions/core/invoice-sync-core.js:340 | CF | confirmed→invoiced (facturada total) | qtyInvoiced+=qty_fact | all_invoiced | no | tests/functions/invoice-sync.test.js |
| T12 | syncSapOrdersToApp CF | functions/core/sync-sap-orders-core.js | CF | pending→confirmed (SQ en SAP) | hereda orderDocEntry | — | no | confirmed-con-order-docentry-no-reserva.test.js |
| T13 | onPedidoConfirmedSendToSap CF | functions/index.js | CF trigger | confirmed→enviado SL (crea SQ) | sendingSapAt, sendingSapError | — | no | tests/functions/auto-send-sap.test.js |
| T14 | splitPedidoLine | src/pure/pedido-split.js:75+ | sistema | qty>disp→split confirmed+BO | base qty reducido; nueva BO=excedente | — | sí | stock-breakdown.test.js |
| T15 | waitlist items[] cancelación | index.html:23351 | vendedor | item waitlist→cancelled | qtyOpen→0; qtyCancelled+=prev | — | no | waitlist-unique-per-client.test.js |
| T16 | waitlist items[] recycle | index.html:23359 | vendedor | item waitlist→recycled | qtyRecycled+=qty | — | no | cpst-liberar-reserva-flow.test.js |
| T17 | _waitlistPasarAPendientesContinuar | index.html:25481+ | vendedor | items[] waitlist→pedido.lines[] | hereda qtyOpen; origen+asigRefs preservados | — | sí | waitlist-unify-flow.test.js |
| T18 | persistPendingEntry | index.html:26963+ | vendedor | pending→waitlist items[] creados | item.qty=qty; qtyOpen=qty | — | sí | cpst-unify-§42-fresh-check.test.js |
| T19 | mergeLinesFromOrders (unificación v1382) | src/pure/unificar-ordenes.js | vendedor | líneas o1+o2→fusionadas en o1 | importedFromOrder preservado | — | no | waitlist-unify-flow.test.js |
| T20 | enviarBorradorAListaEspera | index.html:36457+ | vendedor | borrador→waitlist items[] | crea waitlist nueva | — | sí | waitlist-unify-flow.test.js |
| T21 | revision_waitlist.stage transitions | index.html:17442+ | vendedor CPST | pending→confirmed→consumed | audit setea closedAt+closedReason | unified_at_review §42.2 | sí | review-guard-unify-flow.test.js |
| T22 | _toggleAsigReserva | index.html | admin | ASIG con asigReserva=true→BO + audit v1402 §40.10 | state='BO'; asigRevertidaAt; asigRevertidaBy | asig_destildada_por_admin §40.10 | no | asig-sin-reserva-eliminada.test.js |
| T23 | _gbConfirmar (Generar Backorder) | index.html | vendedor | nuevo pedido→lines state='BO' | qty=entrada; qtyOpen=qty; state='BO' | — | sí (valida cliente master) | gb-undefined-fix.test.js |
| T24 | syncSapQuotationClosures CF | functions/core/sync-sap-quotation-closures-core.js | CF | confirmed→closed (SQ cerrada manual SAP) | closedAt+closedReason | sap_quotation_closed_manual | no | tests/functions/sync-sap-quotation-closures.test.js |
| T25 | onDep11IncreaseCreateReparto CF | functions/core/reparto-core.js | CF trigger | — (crea ingresos_reparto) | — | — | sí | reconcile-breakdown-sync.test.js |
| T26 | close-stale-lines-on-cobrado-core CF | functions/core/close-stale-lines-on-cobrado-core.js | CF | confirmed stale >90d→cancelled | closedAt+closedReason | stale_confirmed_90d_plus | sí (TTL §38) | tests/functions/close-stale-lines.test.js |
| T27 | splitPedidoLine (interior) | src/pure/pedido-split.js:221 | split | qty>disp→confirmed+BO | base qtyOpen=disp; nueva state='BO' | — | sí | cpst-revert-flow.test.js |
| T28 | §40.7 Case 2 recorte en doConfirmPedido | index.html:v1280+ | vendedor | ASIG qty editada<reserva→split confirmed+BO | qty→consume; excedente→BO | recorte_vendedor_cpst §40.7 | sí | cpst-liberar-reserva-flow.test.js |
| T29 | _asigLineChoose | index.html:26355+ | admin | ASIG seleccionada→preseleccionada | — (preselector) | — | no | asignadas-fifo.test.js |
| T30 | applyRepartoManualCore interno | functions/core/reparto-core.js:858 | admin | BO reparto→ASIG | state='ASIG'; asigAt; asigFromReparto=true | — | sí | tests/functions/reparto.test.js |
| T31 | asigRecycleCore | functions/core/asig-recycle-core.js | admin/sistema | ASIG vencida>7d→reciclado BO | qtyRecycled+=qtyOpen | asig_recycled_ttl_expired | sí (TTL §36) | tests/functions/asig-recycle.test.js |
| T32 | doConfirmPedido splitPedidoLine call | index.html:17298+ | vendedor | pendiente+waitlist→split según disp | split confirmed+BO | — | sí | stock-breakdown.test.js |
| T33 | _pendingPedidoOrigenes cancel block v1280 | index.html:34881-34920 | vendedor | ASIG origen CPST→cancelled post-consumo | state='BO' si queda o 'cancelled' si consumido total | waitlist-confirm partial | no | cpst-unify-§42-fresh-check.test.js |
| T34 | asigTransitionsCore | functions/core/asig-transitions-core.js | admin/CF | ASIG↔BO transitions | audit asigAt/asigRevertidaAt | asig_reverted_manual, admin_assigned | sí | asig-sin-reserva-eliminada.test.js |

## Estados conocidos del sistema

**line.state**: `'BO'` (TTL 90d §37, no reserva §40), `'ASIG'` (TTL 7d §36, reserva), `'confirmed'` (TTL soft 7d + hard 60d §38, reserva salvo §40.8), `'invoiced'` (no reserva), `'cancelled'` (closedReason discrimina), `'recycled'` (solo waitlist items).

**qty\***: `qty` (nominal inmutable), `qtyOpen` (pendiente), `qtyInvoiced` (sync SAP), `qtyCancelled` (acumula parciales), `qtyRecycled` (waitlist recombina).

**closedReason** (14 valores literales conocidos): recorte_vendedor_cpst §40.7, cliente_rechazo_cpst §40.6, quitado_por_vendedor_cpst §40.7, waitlist-confirm §40.5, asig_sin_stock_revertida_a_bo §40.5+§40.3, asig_destildada_por_admin §40.10, asig_recycled_ttl_expired §36, reparto-admin §7, reparto-admin-absorbed, sap_quotation_closed_manual §24, stale_confirmed_90d_plus §26, all_invoiced §11, cliente_no_quiere (legacy pre-§40.6), unified_at_review §42.2.

**Audit fields**: `asigReserva` (v1402: siempre revertir a BO si false), `asigAt`, `asigFromReparto`, `asigRevertidaAt+By`, `cancelledAt+By`, `confirmedAt`, `redistributedBy+At`.

**waitlist items[]**: mismo shape (state, qty\*) + `origen` ('stock-asignado' §35), `asigRefs[]` (§35), `importedFromOrder` (§42).

## Hallazgos agente A

1. **§40 v1392+ BO no reserva**: solo ASIG+confirmed+CPST. 37 SKUs/289u liberadas en prod al merge.
2. **§40.8 v1400 confirmed con orderDocEntry no reserva**: SAP autoridad; app evita doble conteo.
3. **§40.10 v1402 asigReserva=false eliminado**: toggle admin revierte a BO con audit.
4. **§35 fórmula por línea (line.origen)**: `getStockUtilizableParaClienteExAsig` solo si `origen='stock-asignado'`.
5. **§42 una orden abierta por cliente**: `revision_waitlist` scope único.
6. **TTLs**: BO 90d, ASIG 7d, confirmed 7d soft + 60d hard.
