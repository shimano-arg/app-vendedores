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
const _autoSendInflight = new Set(); // pedido fsIds que estan siendo enviados ahora
if (typeof window._unsubAutoSendPedidos === 'undefined') window._unsubAutoSendPedidos = null;

function ensureSapAutoSendListener() {
  // Cleanup si las condiciones ya no aplican.
  const eligible =
    (userRole === 'admin' || userRole === 'gerente') &&
    typeof sapSL !== 'undefined' &&
    typeof sapSL.isEnabled === 'function' &&
    sapSL.isEnabled() &&
    !!(sapConfigCache && sapConfigCache.autoSendSL);
  if (!eligible) {
    if (window._unsubAutoSendPedidos) {
      window._unsubAutoSendPedidos();
      window._unsubAutoSendPedidos = null;
      console.log('[SAP auto] listener apagado');
    }
    return;
  }
  if (window._unsubAutoSendPedidos) return; // ya esta corriendo
  if (!fbDb) return;
  console.log('[SAP auto] listener iniciado - watching pedidos confirmed');
  // onSnapshot sobre pedidos confirmed. Cuando entra uno nuevo o cambia uno
  // existente, evaluamos si esta sin transferir y lo mandamos.
  window._unsubAutoSendPedidos = fbDb
    .collection('pedidos')
    .where('stage', '==', 'confirmed')
    .onSnapshot(
      (qs) => {
        qs.docChanges().forEach((change) => {
          // Solo nos interesan los added (recien confirmados) o modified (volvieron a confirmed despues de revert).
          if (change.type !== 'added' && change.type !== 'modified') return;
          const fsId = change.doc.id;
          const p = change.doc.data() || {};
          // Idempotencia 1: ya transferido a SAP -> skip.
          if (p.transferidoSAP) return;
          // Idempotencia 2: ya esta en cola para envio en esta sesion -> skip.
          if (_autoSendInflight.has(fsId)) return;
          // Resolver CardCode. Si no hay, queda Bloqueado en Pendientes (manual).
          const cliSap =
            typeof sapGetClienteCode === 'function' ? sapGetClienteCode(p.clientName) : '';
          if (!cliSap) {
            console.log('[SAP auto] skip', fsId, p.clientName, '- bloqueado por alta de cliente');
            return;
          }
          // Disparar envio async. No await para no bloquear el listener si
          // muchas confirmaciones llegan juntas.
          _autoSendInflight.add(fsId);
          (async () => {
            const docRef = fbDb.collection('pedidos').doc(fsId);
            // v384 (2026-08-03): usar crypto.randomUUID() en vez de Math.random()
            // para el session ID del lock cross-session. El uso real no es
            // criptográfico (solo differentia sesiones concurrentes), pero
            // CodeQL flag el Math.random en "security context" y crypto.randomUUID
            // es mejor practica + más entropia (128 bits vs ~30 bits).
            const mySessionId =
              ((currentUser && currentUser.uid) || 'anon') +
              '-' +
              Date.now() +
              '-' +
              crypto.randomUUID().slice(0, 8);
            try {
              // v344+ (2026-07-28): FIX DUPLICADOS. Antes _autoSendInflight era LOCAL
              // por sesion -> con 2 tabs abiertos, 2 admins online, o F5 durante envio,
              // se creaba la oferta duplicada en SAP. Fix: transaction Firestore que
              // reserva el envio CROSS-SESSION escribiendo un lock sendingSapLock antes
              // de llamar createQuotation. Solo un session gana la reserva.
              // v577 (2026-08-21): timeout stale lock aumentado a 300s (5 min).
              // Antes 60s. Bug real 2026-08-21: 2 admins concurrentes (Ioannis
              // + Jonatan) crearon 2 Ofertas en SAP (#2000079 con 10 lineas +
              // #2000080 con 24 lineas) para el mismo pedido porque
              // sapSL.createQuotation tardo >60s → segundo admin considero
              // stale al lock y tambien ejecuto. SAP Service Layer puede
              // tardar minutos bajo carga; 5 min es margen razonable.
              await fbDb.runTransaction(async (tx) => {
                const snap = await tx.get(docRef);
                if (!snap.exists) throw new Error('DOC_GONE');
                const data = snap.data() || {};
                if (data.transferidoSAP) throw new Error('ALREADY_SENT');
                if (data.sendingSapLock && data.sendingSapLock.at) {
                  const lockAgeMs = Date.now() - data.sendingSapLock.at;
                  if (lockAgeMs < 300000)
                    throw new Error(
                      'OTHER_SESSION_LOCK:' + (data.sendingSapLock.sessionId || 'unknown')
                    );
                }
                tx.update(docRef, {
                  sendingSapLock: { sessionId: mySessionId, at: Date.now() },
                });
              });
              // Reserva OK - somos el unico que puede enviar. Adjuntar el _fsId
              // al objeto antes de armar payload (lo necesita buildQuotationPayload).
              const pedidoConFsId = Object.assign({ _fsId: fsId }, p);
              const payload = sapSL.buildQuotationPayload(pedidoConFsId);
              // v544 E4C (2026-08-19): si el pedido esta 100% en BO (sin lineas
              // con stock), buildQuotationPayload devuelve DocumentLines=[].
              // NO enviar a SAP - marcar como 'app_only' para que el listener
              // no re-procese y quede visible que existe pero no hay SQ SAP
              // aun. Cuando entre stock (FIFO E4.5) y el cliente recicle en
              // pedido nuevo (E4B), ese nuevo pedido va a SAP con las lineas
              // recicladas ya como state='confirmed'.
              if (!payload.DocumentLines || payload.DocumentLines.length === 0) {
                await docRef.update({
                  transferidoSAP: {
                    via: 'app_only',
                    reason: 'all_lines_bo',
                    docEntry: null,
                    docNum: null,
                    transferredAt: new Date().toISOString(),
                    transferredBy: 'auto/' + ((currentUser && currentUser.email) || ''),
                    sapDocRange: null,
                    batchId: null,
                  },
                  sendingSapLock: firebase.firestore.FieldValue.delete(),
                });
                console.log(
                  '[SAP auto] app_only',
                  fsId,
                  p.clientName,
                  '- 100% lineas BO, sin envio a SAP'
                );
                if (typeof showSyncTag === 'function')
                  showSyncTag('Pedido en BO app-only: ' + p.clientName);
                return;
              }
              const r = await sapSL.createQuotation(payload);
              if (r.ok) {
                // v577 (2026-08-21): DOUBLE-CHECK post-createQuotation. Si
                // otra sesion gano la carrera (escribio transferidoSAP mientras
                // esta sesion estaba en createQuotation), NO overwrite — dejar
                // el docNum del winner y loguear WARNING con el docNum stale
                // para que admin borre la SQ duplicada en SAP manualmente.
                // Ambas sesiones habran creado una SQ; solo una queda registrada.
                const myNewDocNum = r.body.DocNum || null;
                const myNewDocEntry = r.body.DocEntry || null;
                let winnerDocNum = null;
                await fbDb.runTransaction(async (tx) => {
                  const snap = await tx.get(docRef);
                  const data = snap.data() || {};
                  if (data.transferidoSAP && data.transferidoSAP.docNum) {
                    // Otra sesion ya escribio. Guardamos el winner y NO overwrite.
                    winnerDocNum = data.transferidoSAP.docNum;
                    // Liberar solo el lock si aun apunta a esta sesion.
                    if (data.sendingSapLock && data.sendingSapLock.sessionId === mySessionId) {
                      tx.update(docRef, {
                        sendingSapLock: firebase.firestore.FieldValue.delete(),
                      });
                    }
                    return;
                  }
                  // Somos el winner: escribir transferidoSAP + liberar lock.
                  tx.update(docRef, {
                    transferidoSAP: {
                      via: 'service_layer_auto',
                      docEntry: myNewDocEntry,
                      docNum: myNewDocNum,
                      transferredAt: new Date().toISOString(),
                      transferredBy: 'auto/' + ((currentUser && currentUser.email) || ''),
                      sapDocRange: String(myNewDocNum || ''),
                      batchId: 'SL-AUTO-' + Date.now(),
                    },
                    sendingSapLock: firebase.firestore.FieldValue.delete(),
                  });
                });
                if (winnerDocNum && winnerDocNum !== myNewDocNum) {
                  // Race real: 2 SQs creadas para el mismo pedido.
                  console.error(
                    '[SAP auto] DUPLICATE SQ CREATED',
                    fsId,
                    p.clientName,
                    '- app registro #' +
                      winnerDocNum +
                      ' (otra sesion), pero esta sesion tambien creo #' +
                      myNewDocNum +
                      '. BORRAR #' +
                      myNewDocNum +
                      ' MANUALMENTE EN SAP.'
                  );
                  if (typeof showSyncTag === 'function')
                    showSyncTag(
                      'ALERTA: SQ duplicada en SAP para ' +
                        p.clientName +
                        ' - borrar #' +
                        myNewDocNum +
                        ' manual'
                    );
                } else {
                  console.log('[SAP auto] OK', fsId, p.clientName, '-> DocNum', myNewDocNum);
                  if (typeof showSyncTag === 'function')
                    showSyncTag(
                      'Auto-enviado: ' + p.clientName + ' (#' + (myNewDocNum || '?') + ')'
                    );
                }
              } else {
                console.warn('[SAP auto] FAILED', fsId, p.clientName, '-', r.error);
                // Liberar el lock para que se pueda reintentar (manual o auto).
                try {
                  await docRef.update({ sendingSapLock: firebase.firestore.FieldValue.delete() });
                } catch (_) {}
                // No hacemos retry automatico. El admin lo ve en Pendientes y
                // puede mandarlo manual o ver el error.
                if (typeof showSyncTag === 'function')
                  showSyncTag('Auto-envio FALLO: ' + p.clientName + ' - ver consola');
              }
            } catch (e) {
              // Si es ALREADY_SENT o OTHER_SESSION_LOCK, es esperable (otro
              // session ya lo esta procesando). Log sin ruido.
              const msg = (e && e.message) || String(e);
              if (
                msg === 'ALREADY_SENT' ||
                msg.startsWith('OTHER_SESSION_LOCK') ||
                msg === 'DOC_GONE'
              ) {
                console.log('[SAP auto] skip', fsId, p.clientName, '-', msg);
              } else {
                console.error('[SAP auto] exception', fsId, e);
                // Intentar liberar lock por si lo tomamos y despues fallo el createQuotation.
                try {
                  await docRef.update({ sendingSapLock: firebase.firestore.FieldValue.delete() });
                } catch (_) {}
              }
            } finally {
              _autoSendInflight.delete(fsId);
            }
          })();
        });
      },
      (err) => console.error('[SAP auto] listener error', err)
    );
}

// Reevaluar el listener cuando cambien condiciones:
//  - login / logout
//  - sapConfigCache cambia (autoSendSL toggle, o appSeriesId)
//  - SL config cambia (URL, password, etc.)
// El listener de app_config ya re-corre renderSapConfig; aprovechamos para
// llamar ensureSapAutoSendListener tambien. Y al login lo llamamos despues
// de loadSapConfig.
const _origListenSapConfig = typeof listenSapMaps === 'function' ? null : null;

// === Exports a window ===
// ensureSapAutoSendListener: llamada desde L12221 (renderSapConfig del inline)
// para reevaluar el listener cuando cambia autoSendSL.
window.ensureSapAutoSendListener = ensureSapAutoSendListener;
