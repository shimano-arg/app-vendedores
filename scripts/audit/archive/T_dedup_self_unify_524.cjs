// T — Deduplicación de líneas duplicadas por self-unify §42.2 en el pedido
// A7Ee40f1RAnLP5b9o2da (ALBERTO PONTORIERO, ORDEN 524, SAP 2000425).
//
// Causa: v1416 §42.2 self-unify mergeaba la waitlist propia al orders[] que
// YA tenía las líneas. Fix v1418 §42.2.1 (hotfix) excluyó la waitlist origen.
// Este script repara el pedido afectado post-hotfix.
//
// Hallazgo (fetch 2026-10-22 ~18:15 UTC):
//   - 70 líneas en Firestore.
//   - 31 SKUs únicos.
//   - Patrón: cada firma `(code, state, qty)` aparece exactamente 2× (self-unify
//     duplicó 1 vez). SKUs con split v1189 (confirmed+BO del mismo SKU por
//     stock parcial) tienen 2 firmas distintas, cada una duplicada → 4 líneas.
//   - Waitlist origen `KvE9Dol8pGTWXIMJzUGi` ya no existe en Firestore (fue
//     borrada por `onPedidoCreatedCleanupWaitlist` al confirmar). Reconstruimos
//     el estado objetivo desde las propias líneas del pedido (primera ocurrencia
//     de cada firma = "canónica"; segundas = duplicadas por self-unify).
//
// Algoritmo:
//   1. Agrupar `pedido.lines[]` por firma `(code, state, qty)`.
//   2. Para cada firma con n>1 ocurrencias:
//      - Conservar la PRIMERA ocurrencia INTACTA (origen, asigRefs, qtyOpen, etc).
//      - Marcar las ocurrencias 2..n como:
//        state='cancelled', qtyOpen=0, qtyCancelled += prevQtyOpen,
//        closedReason='dup_self_unify_v1416', cancelledAt=nowIso,
//        cancelledBy='scripts/audit/T_dedup_self_unify_524.cjs', asigReserva=false.
//   3. Preserva el array lines[] por índice (ninguna línea se borra; sólo mutan
//      state + flags en las duplicadas).
//
// Default dry-run. `--apply` para persistir el update al doc.

const PROJECT = 'app-vendedores-shimano';
const PEDIDO_ID = 'A7Ee40f1RAnLP5b9o2da';
const EXPECTED_BRUTO_CONFIRMED = 2_879_000;

const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');

async function main() {
  const admin = require('../../functions/node_modules/firebase-admin');
  if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT });
  const db = admin.firestore();
  const nowIso = new Date().toISOString();

  console.log('================================================================');
  console.log('T — Dedup self-unify §42.2 pedido ' + PEDIDO_ID);
  console.log('================================================================');
  console.log('Modo:', APPLY ? '--apply' : 'DRY-RUN');
  console.log();

  const docRef = db.collection('pedidos').doc(PEDIDO_ID);
  const snap = await docRef.get();
  if (!snap.exists) {
    console.error('Pedido no encontrado:', PEDIDO_ID);
    process.exit(1);
  }
  const data = snap.data() || {};
  const lines = Array.isArray(data.lines) ? data.lines : [];
  console.log('Cliente:', data.clientName, '· ORDEN:', data.orderNumber);
  console.log('SAP DocNum:', data.transferidoSAP && data.transferidoSAP.docNum);
  console.log('SAP DocEntry:', data.transferidoSAP && data.transferidoSAP.docEntry);
  console.log('discountPct:', data.discountPct);
  console.log('Líneas actuales:', lines.length);
  console.log();

  // Hallazgo (fetch 2026-10-22 18:15 UTC): las líneas duplicadas por el self-unify
  // tienen `precio=0` (el `mergeWaitlistIntoOrderLines` del guard §42.2 push items
  // del waitlist sin precio real — los waitlist items no persisten precio). Las
  // originales (vía _waitlistPasarAPendientesContinuar → splitPedidoLine) tienen
  // precio real.
  //
  // Algoritmo robusto:
  //   PASO 1: cancelar todas las líneas con `precio=0` que están activas
  //           (state in {confirmed, BO, ASIG} y qtyOpen>0). Son el duplicado
  //           puro del self-unify.
  //   PASO 2: sobre las líneas restantes, dedupear por firma (code, state, qty):
  //           si una firma tiene n>1, conservar primera + cancelar resto.
  //
  // Agrupar por firma (code|state|qty). Guardamos los índices originales para
  // mutar el array por posición al final.
  /** @type {Map<string, Array<{idx:number, line:any}>>} */
  const bySignature = new Map();
  /** @type {Array<{idx:number, sig:string, prevState:string, prevQty:number, prevQtyOpen:number}>} */
  const toCancel = [];
  // PASO 1: detectar duplicadas por precio=0.
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!l || !l.code) continue;
    const precio = Number(l.precio) || Number(l.priceAtCreation) || 0;
    const activeStates = ['confirmed', 'BO', 'ASIG'];
    if (precio === 0 && activeStates.includes(String(l.state || '')) && Number(l.qtyOpen) > 0) {
      // Dup por self-unify: precio=0 + activa.
      toCancel.push({
        idx: i,
        sig:
          String(l.code).toUpperCase() +
          '|' +
          String(l.state || '') +
          '|' +
          String(l.qty || 0) +
          '|PRECIO_CERO',
        prevState: String(l.state || ''),
        prevQty: Number(l.qty) || 0,
        prevQtyOpen: Number(l.qtyOpen) || 0,
      });
    }
  }
  const cancelledByCero = new Set(toCancel.map((c) => c.idx));
  // PASO 2: sobre las no-canceladas, agrupar por firma y dedupear por occ.
  for (let i = 0; i < lines.length; i++) {
    if (cancelledByCero.has(i)) continue;
    const l = lines[i];
    if (!l || !l.code) continue;
    const sig =
      String(l.code).toUpperCase() + '|' + String(l.state || '') + '|' + String(l.qty || 0);
    if (!bySignature.has(sig)) bySignature.set(sig, []);
    bySignature.get(sig).push({ idx: i, line: l });
  }

  // Para cada firma con n>1, conservar occ[0], marcar occ[1..n-1] como cancelled.
  /** @type {Map<string, {occBefore:number, occAfter:number, qty:number, state:string, code:string, precio:number}>} */
  const perSig = new Map();
  for (const [sig, occList] of bySignature.entries()) {
    const first = occList[0].line;
    perSig.set(sig, {
      occBefore: occList.length,
      occAfter: occList.length > 1 ? 1 : occList.length,
      qty: Number(first.qty) || 0,
      state: String(first.state || ''),
      code: String(first.code).toUpperCase(),
      precio: Number(first.precio) || Number(first.priceAtCreation) || 0,
    });
    if (occList.length <= 1) continue;
    for (let i = 1; i < occList.length; i++) {
      const o = occList[i];
      toCancel.push({
        idx: o.idx,
        sig,
        prevState: String(o.line.state || ''),
        prevQty: Number(o.line.qty) || 0,
        prevQtyOpen: Number(o.line.qtyOpen) || 0,
      });
    }
  }
  // Métrica: cuántas se cancelan por precio=0 (self-unify) vs por firma duplicada.
  const cancelByCeroCount = toCancel.filter((c) => c.sig.endsWith('|PRECIO_CERO')).length;
  const cancelBySigCount = toCancel.length - cancelByCeroCount;
  console.log('A cancelar: ' + toCancel.length + ' total');
  console.log('  · por precio=0 (dup self-unify puro):   ' + cancelByCeroCount);
  console.log('  · por firma (code,state,qty) duplicada: ' + cancelBySigCount);
  console.log();

  console.log('Firmas únicas:', bySignature.size);
  console.log('Líneas a cancelar:', toCancel.length);
  console.log('Líneas target (post-dedup):', lines.length - toCancel.length);
  console.log();

  // Tabla por SKU: antes/después
  console.log('===== Preview por SKU (agrupado) =====');
  console.log();
  console.log(
    'SKU'.padEnd(16) +
      '| state     | qty | occ_before | occ_after | precio       | subtotal_target'
  );
  console.log('-'.repeat(100));
  /** @type {Map<string, {occBefore:number, occAfter:number, qties:Array<{state:string,qty:number,precio:number}>}>} */
  const bySku = new Map();
  for (const [_sig, info] of perSig) {
    if (!bySku.has(info.code))
      bySku.set(info.code, { occBefore: 0, occAfter: 0, qties: [] });
    const b = bySku.get(info.code);
    b.occBefore += info.occBefore;
    b.occAfter += info.occAfter;
    b.qties.push({ state: info.state, qty: info.qty, precio: info.precio });
  }
  let totalBrutoTarget = 0;
  let totalConfirmedTarget = 0;
  let totalBoTarget = 0;
  for (const [_sig, info] of perSig) {
    const subtotal = info.qty * info.precio;
    if (info.state === 'confirmed') totalConfirmedTarget += subtotal;
    if (info.state === 'BO') totalBoTarget += subtotal;
    totalBrutoTarget += subtotal;
    console.log(
      info.code.padEnd(16) +
        '| ' +
        info.state.padEnd(10) +
        '| ' +
        String(info.qty).padStart(3) +
        ' | ' +
        String(info.occBefore).padStart(10) +
        ' | ' +
        String(info.occAfter).padStart(9) +
        ' | ' +
        String(info.precio).padStart(12) +
        ' | $' +
        subtotal.toLocaleString('es-AR').padStart(13)
    );
  }
  console.log();
  console.log('Total bruto target (confirmed + BO):   $' + totalBrutoTarget.toLocaleString('es-AR'));
  console.log('Total CONFIRMED bruto (va a SAP sin descuento): $' + totalConfirmedTarget.toLocaleString('es-AR'));
  console.log('Total BO bruto (no va a SAP):          $' + totalBoTarget.toLocaleString('es-AR'));
  console.log();
  console.log('Target esperado (reportado por Mariano): $' + EXPECTED_BRUTO_CONFIRMED.toLocaleString('es-AR'));
  if (totalConfirmedTarget === EXPECTED_BRUTO_CONFIRMED) {
    console.log('✅ COINCIDE con el target de la Lista de Espera 524 + 526 absorbida.');
  } else {
    const diff = Math.abs(totalConfirmedTarget - EXPECTED_BRUTO_CONFIRMED);
    console.log(
      '⚠️  DIFF: $' +
        diff.toLocaleString('es-AR') +
        ' — revisar antes de aplicar. Mariano debe autorizar explícitamente.'
    );
  }
  console.log();
  console.log('Con discountPct=' + (data.discountPct || 0) + '%:');
  const neto = Math.round(
    totalConfirmedTarget * (1 - (Number(data.discountPct) || 0) / 100)
  );
  console.log('Total CONFIRMED neto (va a SAP con descuento): $' + neto.toLocaleString('es-AR'));
  console.log();

  // Mostrar las primeras 10 líneas a cancelar para auditoría.
  console.log('===== Primeras líneas a cancelar =====');
  console.log('idx | code              | state      | qty | qtyOpen | firma');
  console.log('-'.repeat(90));
  for (const c of toCancel.slice(0, 10)) {
    const l = lines[c.idx];
    console.log(
      String(c.idx).padStart(3) +
        ' | ' +
        String(l.code).padEnd(16) +
        ' | ' +
        String(l.state || '').padEnd(10) +
        ' | ' +
        String(c.prevQty).padStart(3) +
        ' | ' +
        String(c.prevQtyOpen).padStart(7) +
        ' | ' +
        c.sig
    );
  }
  if (toCancel.length > 10) {
    console.log('... (' + (toCancel.length - 10) + ' más)');
  }
  console.log();

  if (!APPLY) {
    console.log('DRY-RUN: nada se escribió. Correr de nuevo con --apply para persistir.');
    console.log();
    console.log('Si Mariano autoriza, el apply:');
    console.log('  1. Muta ' + toCancel.length + ' líneas a state=cancelled.');
    console.log('  2. Setea closedReason=dup_self_unify_v1416, cancelledAt=' + nowIso + '.');
    console.log('  3. qtyOpen=0, qtyCancelled += prevQtyOpen, asigReserva=false.');
    console.log('  4. Preserva índices (el array lines mantiene longitud ' + lines.length + ').');
    console.log('  5. Setea pedido._dedupSelfUnifyV1416={at:nowIso, scriptPath, cancelledCount, affectedSkus}.');
    return;
  }

  // Apply.
  console.log('APPLY — mutando ' + toCancel.length + ' líneas...');
  const newLines = lines.map((l, _i) => (l ? Object.assign({}, l) : l));
  for (const c of toCancel) {
    const l = newLines[c.idx];
    if (!l) continue;
    l.state = 'cancelled';
    l.qtyOpen = 0;
    l.qtyCancelled = (Number(l.qtyCancelled) || 0) + c.prevQtyOpen;
    l.closedReason = 'dup_self_unify_v1416';
    l.cancelledAt = nowIso;
    l.cancelledBy = 'scripts/audit/T_dedup_self_unify_524.cjs';
    l.asigReserva = false;
    l.dedupedFromSignature = c.sig;
  }
  const affectedSkus = [...new Set(toCancel.map((c) => c.sig.split('|')[0]))];
  await docRef.update({
    lines: newLines,
    updatedAt: nowIso,
    _dedupSelfUnifyV1416: {
      at: nowIso,
      scriptPath: 'scripts/audit/T_dedup_self_unify_524.cjs',
      cancelledCount: toCancel.length,
      beforeLines: lines.length,
      afterLines: lines.length,
      afterActive: lines.length - toCancel.length,
      affectedSkus,
      reportedBy: 'Mariano Erbino 2026-10-22 post-SAP 2000425',
      targetBruto: totalConfirmedTarget,
      expectedBruto: EXPECTED_BRUTO_CONFIRMED,
    },
  });
  console.log('OK — pedido actualizado.');
  console.log(
    'Confirmed activas post-apply: ' +
      (lines.length - toCancel.length) +
      ' líneas · total bruto $' +
      totalConfirmedTarget.toLocaleString('es-AR')
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
