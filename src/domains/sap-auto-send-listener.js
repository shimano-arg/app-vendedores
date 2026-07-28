// @ts-nocheck
// SAP-AUTO-SEND-LISTENER: listener Firestore de pedidos confirmed → auto-envío
// via Cloud Function sapProxy como Sales Quotation. Idempotente (transferidoSAP).
// Solo activo con userRole admin/gerente + sapSL.isEnabled() + sapConfigCache.autoSendSL.
// Extraído verbatim de index.html (líneas 16015-16109 pre-E2.m.4) como parte
// de E2.m.4 (e2b-perf 2026-07-28). TERCER fragmento del dominio sap-integrations
// (regla #14). Falta solo E2.m.2 (sap-admin-panel, el más grande ~1,373 LOC).
//
// Cross-scope state:
// - window._unsubAutoSendPedidos: cleanup en detachFirebaseListeners inline (L15440).
// - _autoSendInflight (Set local): pedido fsIds en-vuelo, previene doble envío.
//
// Deps del inline / otros bundles: fbDb, firebase, currentUser, userRole,
// sapSL (bundle sap-service-layer), sapConfigCache (inline sap-admin-panel
// pendiente E2.m.2), sapGetClienteCode + sapGetProductCode (inline pendiente),
// getVendorForKey (bundle dashboard).
// =========================================================================
// AUTO-ENVIO A SAP VIA SERVICE LAYER (v220)
// =========================================================================
// Listener que corre SOLO en sesion admin/gerente con SL habilitado +
// toggle autoSendSL ON. Detecta pedidos confirmed sin transferidoSAP y los
// manda automaticamente como Sales Quotation. Idempotente: si dos admin
// estan online, el primero gana porque la segunda invocacion ve
// transferidoSAP ya seteado y skip.
let _autoSendInflight = new Set();   // pedido fsIds que estan siendo enviados ahora
if (typeof window._unsubAutoSendPedidos === "undefined") window._unsubAutoSendPedidos = null;

function ensureSapAutoSendListener(){
  // Cleanup si las condiciones ya no aplican.
  const eligible = (userRole === 'admin' || userRole === 'gerente')
                    && typeof sapSL !== 'undefined'
                    && typeof sapSL.isEnabled === 'function'
                    && sapSL.isEnabled()
                    && !!(sapConfigCache && sapConfigCache.autoSendSL);
  if (!eligible) {
    if (window._unsubAutoSendPedidos) { window._unsubAutoSendPedidos(); window._unsubAutoSendPedidos = null; console.log('[SAP auto] listener apagado'); }
    return;
  }
  if (window._unsubAutoSendPedidos) return; // ya esta corriendo
  if (!fbDb) return;
  console.log('[SAP auto] listener iniciado - watching pedidos confirmed');
  // onSnapshot sobre pedidos confirmed. Cuando entra uno nuevo o cambia uno
  // existente, evaluamos si esta sin transferir y lo mandamos.
  window._unsubAutoSendPedidos = fbDb.collection('pedidos').where('stage', '==', 'confirmed')
    .onSnapshot(qs => {
      qs.docChanges().forEach(change => {
        // Solo nos interesan los added (recien confirmados) o modified (volvieron a confirmed despues de revert).
        if (change.type !== 'added' && change.type !== 'modified') return;
        const fsId = change.doc.id;
        const p = change.doc.data() || {};
        // Idempotencia 1: ya transferido a SAP -> skip.
        if (p.transferidoSAP) return;
        // Idempotencia 2: ya esta en cola para envio en esta sesion -> skip.
        if (_autoSendInflight.has(fsId)) return;
        // Resolver CardCode. Si no hay, queda Bloqueado en Pendientes (manual).
        const cliSap = (typeof sapGetClienteCode === 'function') ? sapGetClienteCode(p.clientName) : '';
        if (!cliSap) {
          console.log('[SAP auto] skip', fsId, p.clientName, '- bloqueado por alta de cliente');
          return;
        }
        // Disparar envio async. No await para no bloquear el listener si
        // muchas confirmaciones llegan juntas.
        _autoSendInflight.add(fsId);
        (async () => {
          try {
            // Adjuntar el _fsId al objeto antes de armar payload (lo necesita
            // buildQuotationPayload via p._fsId).
            const pedidoConFsId = Object.assign({_fsId: fsId}, p);
            const payload = sapSL.buildQuotationPayload(pedidoConFsId);
            const r = await sapSL.createQuotation(payload);
            if (r.ok) {
              await fbDb.collection('pedidos').doc(fsId).update({
                // No tocamos stage - se queda como 'confirmed' para que el
                // pedido siga visible en Pedidos > Confirmados. SAP > Ya
                // Transferidos lo detecta via transferidoSAP.transferredAt.
                transferidoSAP: {
                  via: 'service_layer_auto',
                  docEntry: r.body.DocEntry || null,
                  docNum: r.body.DocNum || null,
                  transferredAt: new Date().toISOString(),
                  transferredBy: 'auto/' + (currentUser && currentUser.email || ''),
                  sapDocRange: String(r.body.DocNum || ''),
                  batchId: 'SL-AUTO-' + Date.now(),
                },
              });
              console.log('[SAP auto] OK', fsId, p.clientName, '-> DocNum', r.body.DocNum);
              if (typeof showSyncTag === 'function') showSyncTag('Auto-enviado: ' + p.clientName + ' (#' + (r.body.DocNum || '?') + ')');
            } else {
              console.warn('[SAP auto] FAILED', fsId, p.clientName, '-', r.error);
              // No hacemos retry automatico. El admin lo ve en Pendientes y
              // puede mandarlo manual o ver el error.
              if (typeof showSyncTag === 'function') showSyncTag('Auto-envio FALLO: ' + p.clientName + ' - ver consola');
            }
          } catch(e) {
            console.error('[SAP auto] exception', fsId, e);
          } finally {
            _autoSendInflight.delete(fsId);
          }
        })();
      });
    }, err => console.error('[SAP auto] listener error', err));
}

// Reevaluar el listener cuando cambien condiciones:
//  - login / logout
//  - sapConfigCache cambia (autoSendSL toggle, o appSeriesId)
//  - SL config cambia (URL, password, etc.)
// El listener de app_config ya re-corre renderSapConfig; aprovechamos para
// llamar ensureSapAutoSendListener tambien. Y al login lo llamamos despues
// de loadSapConfig.
const _origListenSapConfig = (typeof listenSapMaps === 'function') ? null : null;

// === Exports a window ===
// ensureSapAutoSendListener: llamada desde L12221 (renderSapConfig del inline)
// para reevaluar el listener cuando cambia autoSendSL.
window.ensureSapAutoSendListener = ensureSapAutoSendListener;
