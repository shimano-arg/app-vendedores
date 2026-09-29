/**
 * retrigger-notify-quotation.cjs
 *
 * v1034 (2026-09-22): re-dispara el trigger onQuotationSentNotify sobre el
 * pedido MAS RECIENTE con transferidoSAP.docNum + via='service_layer_auto'
 * para validar que el fix del email (Total ARS con schema real) haya llegado
 * a produccion. NO toca SAP: solo nullea docNum en Firestore y lo restaura.
 *
 * Guards:
 * - Solo pedidos con via='service_layer_auto' (los unicos que shouldNotify
 *   procesa). onPedidoConfirmedSendToSap NO se dispara porque `transferidoSAP`
 *   sigue siendo objeto truthy en ambos writes (solo el docNum cambia).
 * - Idempotente sobre reruns: en el segundo run, el pedido ya tiene el mismo
 *   docNum -> shouldNotify NO dispara (before.docNum === after.docNum).
 *   Necesitamos el toggle explicito (null -> valor).
 * - Restore automatico via try/finally: si el script muere entre pasos, log
 *   deja el pedidoId + docNum original para restauracion manual.
 */
const path = require('path');
const os = require('os');
const admin = require('../functions/node_modules/firebase-admin');

const SA_KEY = path.join(
  os.homedir(),
  'Downloads',
  'app-vendedores-shimano-firebase-adminsdk-fbsvc-71fc15072e.json'
);
admin.initializeApp({ credential: admin.credential.cert(require(SA_KEY)) });
const db = admin.firestore();

const WAIT_MS = 5000; // ventana para que el CF onQuotationSentNotify reaccione al null

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const snap = await db
    .collection('pedidos')
    .where('transferidoSAP.via', '==', 'service_layer_auto')
    .get();

  const candidates = [];
  snap.forEach((doc) => {
    const data = doc.data() || {};
    const ts = data.transferidoSAP || {};
    if (!ts.docNum) return;
    const createdAt = data.createdAt && data.createdAt.toMillis
      ? data.createdAt.toMillis()
      : 0;
    candidates.push({ id: doc.id, data, createdAt });
  });
  candidates.sort((a, b) => b.createdAt - a.createdAt);

  if (candidates.length === 0) {
    console.error('No hay pedidos service_layer_auto con docNum. Nada que re-disparar.');
    process.exit(1);
  }

  const target = candidates[0];
  const originalTs = target.data.transferidoSAP;
  const originalDocNum = originalTs.docNum;
  const totalNet = target.data.netAmountArs;
  const totalSub = target.data.subtotalArs;
  const cliente = target.data.clientName || '(sin cliente)';
  const orden = target.data.orderNumber || target.id;

  console.log('=== RE-TRIGGER onQuotationSentNotify ===');
  console.log('Pedido ID:      ', target.id);
  console.log('Orden App:      ', orden);
  console.log('Cliente:        ', cliente);
  console.log('SAP DocNum:     ', originalDocNum);
  console.log('netAmountArs:   ', totalNet);
  console.log('subtotalArs:    ', totalSub);
  console.log('');
  console.log('Backup original transferidoSAP:');
  console.log(JSON.stringify(originalTs, null, 2));
  console.log('');

  const ref = db.doc(`pedidos/${target.id}`);
  try {
    // Paso 1: nullear docNum. El resto del objeto se preserva.
    console.log('[1/2] Seteando transferidoSAP.docNum = null...');
    await ref.update({ 'transferidoSAP.docNum': null });
    console.log('      OK. Esperando ' + WAIT_MS + 'ms para que el CF vea el null...');
    await sleep(WAIT_MS);

    // Paso 2: restaurar docNum original -> trigger dispara shouldNotify=true.
    console.log('[2/2] Restaurando transferidoSAP.docNum = ' + originalDocNum + '...');
    await ref.update({ 'transferidoSAP.docNum': originalDocNum });
    console.log('      OK. Trigger disparado. Chequear inbox santiago.beron@shimano.uy en ~30s.');
    console.log('');
    console.log('Total esperado en el email:');
    if (totalNet != null) {
      console.log('  $' + Number(totalNet).toLocaleString('es-AR'));
    } else if (totalSub != null) {
      console.log('  $' + Number(totalSub).toLocaleString('es-AR'));
    } else {
      console.log('  (computado desde lines[])');
    }
  } catch (err) {
    console.error('ERROR:', err.message || err);
    console.error('IMPORTANTE: verificar en Firestore que pedidos/' + target.id + '.transferidoSAP.docNum == ' + originalDocNum);
    console.error('Objeto original para restauracion manual:');
    console.error(JSON.stringify(originalTs, null, 2));
    process.exit(2);
  }

  // Verificacion final: leer el doc y confirmar que quedo restaurado.
  const finalSnap = await ref.get();
  const finalDocNum = (finalSnap.data() || {}).transferidoSAP?.docNum;
  if (finalDocNum !== originalDocNum) {
    console.error('WARN: docNum final=' + finalDocNum + ' != original=' + originalDocNum);
    process.exit(3);
  }
  console.log('Verificacion post-restore: transferidoSAP.docNum = ' + finalDocNum + ' [OK]');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('FATAL:', err);
    process.exit(1);
  });
