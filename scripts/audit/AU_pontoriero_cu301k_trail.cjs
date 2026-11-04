// AU — DIAGNÓSTICO READ-ONLY: reconstrucción del recorrido de una reserva de
// Stock Asignado (ASIG) vs el pedido derivado y los documentos SAP, para
// confirmar o descartar H1 ("ASIG huérfana no cancelada").
//
// Caso disparador: Alberto Pontoriero / SKU CU301K / pedido visible 633 (oct-2026).
// El modal "Stock Asignado" muestra SOLO líneas state='ASIG' (src/pure/
// backorder-sku-map.js). Una ASIG viva solo se limpia por cancelación explícita
// (bloque v1280/§35 al confirmar un pedido CPST), NO por conversión SQ→SO ni por
// factura. H1 = la ASIG original quedó huérfana (cancelación no corrió / falló /
// el pedido no nació de CPST).
//
// ESTE SCRIPT **SOLO LEE**. No escribe Firestore. En SAP solo hace GET de
// datos; Login/Logout de Service Layer son operaciones de SESIÓN (POST
// /b1s/v1/Login y POST /b1s/v1/Logout), NO modifican documentos ni estados
// comerciales. No cancela nada, no reconcilia, no deploya. No imprime secretos.
//
// ADVERTENCIA METODOLÓGICA: la coincidencia cliente + SKU + cantidad NO prueba
// por sí sola que se trate de las mismas unidades reservadas. La trazabilidad
// real exige referencias del CRM (asigRefs/pedidosOrigenes) y/o el lineage SAP
// SQ→SO→Factura. Sin eso, una relación queda "no demostrada".
//
// Uso (lo corre el responsable autorizado, con ADC del proyecto):
//   # Firestore únicamente (confirma H1 sin tocar SAP):
//   node scripts/audit/AU_pontoriero_cu301k_trail.cjs --sku=CU301K --order=633 --cliente=PONTORIERO
//   # opcional, agregar lado SAP (requiere SAP_SL_PASSWORD en el entorno):
//   SAP_SL_PASSWORD=*** node scripts/audit/AU_pontoriero_cu301k_trail.cjs --sku=CU301K --order=633 --cliente=PONTORIERO --sap
//   # si ya se conoce el cardCode, acota el scan:
//   node scripts/audit/AU_pontoriero_cu301k_trail.cjs --cardCode=C20175569635 --sku=CU301K
//
// Autorización: investigación funcional Stock Asignado (read-only). NO corregir.

const PROJECT = 'app-vendedores-shimano';

// ── Parse args ───────────────────────────────────────────────────────────────
function arg(name, def) {
  const hit = process.argv.find((a) => a.startsWith('--' + name + '='));
  if (hit) return hit.slice(('--' + name + '=').length);
  if (process.argv.includes('--' + name)) return true; // flag booleano
  return def;
}
const SKU = String(arg('sku', 'CU301K')).toUpperCase();
const ORDER = String(arg('order', '633'));
const CLIENTE = String(arg('cliente', 'PONTORIERO')).toUpperCase();
const CARD_CODE = arg('cardCode', '') ? String(arg('cardCode', '')).trim() : '';
const WITH_SAP = arg('sap', false) === true;
// Ventana para el scan de operations_log. 0 = auto (createdAt más viejo − 7d).
const OL_DAYS = Number(arg('olDays', '0')) || 0;

// ── Helpers ───────────────────────────────────────────────────────────────────
function parseDateFlexible(v) {
  // Tolerante: string ISO | Timestamp(toMillis) | {seconds} | Date | number.
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? new Date(v) : null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === 'object') {
    if (typeof v.toMillis === 'function') {
      try { return new Date(v.toMillis()); } catch { return null; }
    }
    if (typeof v.seconds === 'number') return new Date(v.seconds * 1000);
    return null;
  }
  if (typeof v === 'string') {
    const t = Date.parse(v);
    return Number.isNaN(t) ? null : new Date(t);
  }
  return null;
}
function iso(v) {
  const d = parseDateFlexible(v);
  return d ? d.toISOString() : (v == null ? '—' : '(no-fecha: ' + JSON.stringify(v) + ')');
}
function tsapVal(p, k) {
  const t = (p && p.transferidoSAP) || {};
  return t[k] == null ? '—' : t[k];
}

// Scan paginado de operations_log por timestamp desc (índice de CAMPO ÚNICO —
// NO requiere índice compuesto) + filtro type='client_write_failed' en memoria.
// Cubre la ventana [windowStartMs, now]. Reporta completitud explícita:
//   complete=true  → se alcanzó el inicio de la ventana o se agotó la colección.
//   capHit=true    → se llegó al tope de páginas ANTES de cubrir la ventana → PARCIAL.
// Devuelve además hits relacionados (por documentId o clientCardCode).
async function scanOperationsLog(db, idsRel, cardCodes, windowStartMs) {
  const PAGE = 500;
  const MAX_PAGES = 60; // ~30k docs de tope de seguridad
  const hits = [];
  let cursor = null;
  let pages = 0;
  let scanned = 0;
  let complete = false;
  try {
    while (pages < MAX_PAGES) {
      let q = db.collection('operations_log').orderBy('timestamp', 'desc').limit(PAGE);
      if (cursor) q = q.startAfter(cursor);
      const s = await q.get();
      pages++;
      if (s.empty) { complete = true; break; } // sin más docs → cobertura total
      let last = null;
      let crossedWindow = false;
      for (const d of s.docs) {
        last = d;
        scanned++;
        const o = d.data() || {};
        const dd = parseDateFlexible(o.timestamp);
        const tsMs = dd ? dd.getTime() : null;
        if (tsMs !== null && tsMs < windowStartMs) { crossedWindow = true; break; }
        if (o.type !== 'client_write_failed') continue;
        if (
          (o.documentId && idsRel.has(o.documentId)) ||
          (o.clientCardCode && cardCodes.has(String(o.clientCardCode).trim()))
        ) {
          hits.push(o);
        }
      }
      if (crossedWindow) { complete = true; break; } // llegamos al inicio de la ventana
      if (s.size < PAGE) { complete = true; break; } // última página
      cursor = last;
    }
    return { hits, scanned, pages, complete, capHit: !complete, error: null };
  } catch (e) {
    return { hits, scanned, pages, complete: false, capHit: false, error: (e && e.message) ? e.message : String(e) };
  }
}

async function main() {
  // ── Guard de seguridad: nunca contra emulador ni sin proyecto ───────────────
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    console.error('ABORT: FIRESTORE_EMULATOR_HOST está seteado. Este diagnóstico es contra PROD.');
    process.exit(2);
  }

  const admin = require('../../functions/node_modules/firebase-admin');
  if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT });
  const db = admin.firestore();

  const nowIso = new Date().toISOString();
  console.log('================================================================');
  console.log('AU — Trail Stock Asignado · SKU=' + SKU + ' order=' + ORDER + ' cliente~' + CLIENTE);
  console.log('Proyecto: ' + PROJECT + ' · @ ' + nowIso + ' · MODO: SOLO LECTURA');
  console.log('================================================================');

  // ── 1) Scan read-only de pedidos (una sola lectura de la colección) ─────────
  const snap = await db.collection('pedidos').get();
  const all = [];
  snap.forEach((d) => all.push(Object.assign({ _fsId: d.id }, d.data())));
  console.log('Pedidos leídos (total colección): ' + all.length);

  const lineHasSku = (p) =>
    (Array.isArray(p.lines) ? p.lines : []).some(
      (l) => l && String(l.code || '').toUpperCase() === SKU
    );
  const nameMatch = (p) => String(p.clientName || '').toUpperCase().includes(CLIENTE);
  const orderMatch = (p) => String(p.orderNumber || '') === ORDER;
  const cardMatch = (p) => CARD_CODE && String(p.clientCardCode || '').trim() === CARD_CODE;

  // Semilla: pedidos que matchean cliente/orden/cardCode.
  let seed = all.filter((p) => cardMatch(p) || nameMatch(p) || orderMatch(p));
  // Derivar cardCodes del cliente a partir de la semilla (para traer TODO lo suyo).
  const cardCodes = new Set(seed.map((p) => String(p.clientCardCode || '').trim()).filter(Boolean));
  if (CARD_CODE) cardCodes.add(CARD_CODE);
  // Universo relacionado: todo lo del/los cardCode(s) del cliente + cualquier
  // pedido con el SKU en una línea (por si el derivado quedó con otro cliente).
  const rel = all.filter(
    (p) =>
      cardCodes.has(String(p.clientCardCode || '').trim()) ||
      (seed.includes(p)) ||
      (lineHasSku(p) && (nameMatch(p) || cardCodes.has(String(p.clientCardCode || '').trim())))
  );
  // Dedup.
  const relById = new Map(rel.map((p) => [p._fsId, p]));
  const pedidos = Array.from(relById.values());

  console.log(
    'cardCode(s) del cliente detectados: ' + (cardCodes.size ? Array.from(cardCodes).join(', ') : '(ninguno — ajustar --cliente/--cardCode)')
  );
  console.log('Pedidos relacionados: ' + pedidos.length);
  if (pedidos.length === 0) {
    console.log('\nSin pedidos relacionados. Verificar --cliente / --cardCode / --order.');
    return;
  }

  // ── 2) Detalle por pedido (todos los campos pedidos en la tarea §2) ─────────
  pedidos.sort((a, b) => {
    const da = parseDateFlexible(a.createdAt), dbb = parseDateFlexible(b.createdAt);
    return (da ? da.getTime() : 0) - (dbb ? dbb.getTime() : 0);
  });

  console.log('\n──────────────── DETALLE POR PEDIDO ────────────────');
  for (const p of pedidos) {
    console.log('\n● pedidoId=' + p._fsId + '  orderNumber=' + (p.orderNumber || '—'));
    console.log('  cliente=' + (p.clientName || '—') + '  cardCode=' + (p.clientCardCode || '—'));
    console.log('  createdAt=' + iso(p.createdAt) + '  confirmedAt=' + iso(p.confirmedAt));
    console.log('  stage=' + (p.stage || '—') + '  closedAt=' + iso(p.closedAt) +
      '  closedReason=' + (p.closedReason || '—'));
    console.log('  source=' + (p.source || '—') + '  via=' + tsapVal(p, 'via') +
      '  paidStatus=' + (p.paidStatus || '—'));
    console.log('  transferidoSAP: docEntry=' + tsapVal(p, 'docEntry') + ' docNum=' + tsapVal(p, 'docNum') +
      ' orderDocEntry=' + tsapVal(p, 'orderDocEntry') + ' orderDocNum=' + tsapVal(p, 'orderDocNum') +
      ' closedManuallyInSap=' + tsapVal(p, 'closedManuallyInSap'));
    // pedidosOrigenes / asigRefs a nivel doc y línea
    if (Array.isArray(p.pedidosOrigenes) && p.pedidosOrigenes.length) {
      console.log('  pedidosOrigenes: ' + JSON.stringify(p.pedidosOrigenes));
    }
    const lines = Array.isArray(p.lines) ? p.lines : [];
    const skuLines = lines
      .map((l, i) => ({ l, i }))
      .filter(({ l }) => l && String(l.code || '').toUpperCase() === SKU);
    console.log('  líneas total=' + lines.length + '  líneas ' + SKU + '=' + skuLines.length);
    for (const { l, i } of skuLines) {
      console.log(
        '    [' + i + '] state=' + l.state +
        ' qtyOpen=' + (l.qtyOpen != null ? l.qtyOpen : '—') +
        ' qty=' + (l.qty != null ? l.qty : '—') +
        ' qtyInvoiced=' + (l.qtyInvoiced != null ? l.qtyInvoiced : '—') +
        ' asigAt=' + iso(l.asigAt) +
        ' asigReserva=' + (l.asigReserva === undefined ? '—' : l.asigReserva) +
        ' asigFromReparto=' + (l.asigFromReparto === undefined ? '—' : l.asigFromReparto)
      );
      if (l.cancelledFrom || l.cancelledIntoPedidoId || l.closedReason) {
        console.log(
          '        cancelledFrom=' + (l.cancelledFrom || '—') +
          ' cancelledIntoPedidoId=' + (l.cancelledIntoPedidoId || '—') +
          ' closedReason=' + (l.closedReason || '—')
        );
      }
      if (Array.isArray(l.asigRefs) && l.asigRefs.length) {
        console.log('        asigRefs=' + JSON.stringify(l.asigRefs));
      }
    }
  }

  // ── 3) Puente CPST: clasificación H1 por cada ASIG viva del SKU ─────────────
  console.log('\n──────────────── PUENTE CPST / VEREDICTO H1 ────────────────');
  const asigVivas = [];
  for (const p of pedidos) {
    if (p.closedAt) continue;
    const lines = Array.isArray(p.lines) ? p.lines : [];
    lines.forEach((l, i) => {
      if (!l || String(l.code || '').toUpperCase() !== SKU) return;
      if (l.state !== 'ASIG') return;
      if ((Number(l.qtyOpen) || 0) <= 0) return;
      asigVivas.push({ pedidoId: p._fsId, orderNumber: p.orderNumber, lineIndex: i, line: l, pedido: p });
    });
  }
  console.log('ASIG vivas de ' + SKU + ' en el universo: ' + asigVivas.length);

  // ¿Existe un pedido derivado que referencia esta ASIG? (asigRefs / pedidosOrigenes)
  const referencesPedido = (candidate, parentId) => {
    const inDocOrig = Array.isArray(candidate.pedidosOrigenes) &&
      candidate.pedidosOrigenes.some((o) => o && o.pedidoId === parentId);
    const inLineRefs = (Array.isArray(candidate.lines) ? candidate.lines : []).some(
      (l) => Array.isArray(l && l.asigRefs) && l.asigRefs.some((r) => r && r.pedidoId === parentId)
    );
    return inDocOrig || inLineRefs;
  };

  for (const a of asigVivas) {
    const derivados = pedidos.filter((c) => c._fsId !== a.pedidoId && referencesPedido(c, a.pedidoId));
    // También buscar en TODA la colección (por si el derivado quedó con otro cliente).
    const derivadosGlobal = all.filter((c) => c._fsId !== a.pedidoId && referencesPedido(c, a.pedidoId));
    const esReparto = a.line.asigFromReparto === true;
    const tieneCancelEvidence = !!(a.line.cancelledFrom || a.line.cancelledIntoPedidoId);

    let veredicto;
    if (tieneCancelEvidence) {
      // La línea dice cancelada pero sigue state='ASIG' y qtyOpen>0 → inconsistencia.
      veredicto = 'INCONSISTENTE: línea con evidencia de cancelación pero state=ASIG vivo (revisar).';
    } else if (derivadosGlobal.length > 0) {
      // Hay pedido derivado que la referencia, pero la ASIG sigue viva →
      // CANCELACIÓN FALLIDA (CPST corrió, el bloque v1280 no cerró la ASIG).
      veredicto = 'H1(a) CANCELACIÓN FALLIDA: existe pedido derivado (' +
        derivadosGlobal.map((d) => d._fsId + '/' + (d.orderNumber || '?')).join(', ') +
        ') que referencia esta ASIG, pero la ASIG sigue viva.';
    } else {
      // Sin pedido derivado que referencie esta ASIG. NO se puede afirmar que
      // la cancelación "no se ejecutó": puede ser una reserva ASIG LEGÍTIMA
      // (Pablo asignó y todavía no hay pedido) o un pedido no-CPST. Queda como
      // RELACIÓN NO DEMOSTRADA hasta hallar evidencia adicional en SAP (SO/
      // factura que cubra las unidades) o en referencias del CRM. NO es H1.
      const facturadoMismoCS = all.some(
        (c) =>
          String(c.clientCardCode || '').trim() === String(a.pedido.clientCardCode || '').trim() &&
          (Array.isArray(c.lines) ? c.lines : []).some(
            (l) =>
              l && String(l.code || '').toUpperCase() === SKU &&
              (Number(l.qtyInvoiced) || 0) > 0
          )
      );
      veredicto =
        'RELACIÓN NO DEMOSTRADA / reserva posiblemente legítima: no hay pedido ' +
        'derivado que referencie esta ASIG. NO constituye evidencia de H1 por sí sola. ' +
        (facturadoMismoCS
          ? 'SEÑAL A VERIFICAR (no concluyente): el mismo cliente+SKU tiene unidades ' +
            'facturadas en otro pedido, PERO coincidencia cliente+SKU+cantidad NO prueba ' +
            'que sean las mismas unidades reservadas. Confirmar con --sap si esa factura ' +
            'deriva de una SO que consumió ESTA reserva (lineage SQ→SO→Factura).'
          : 'No se halló factura del mismo cliente+SKU en el universo leído; sin más ' +
            'evidencia, tratar como reserva ASIG pendiente legítima.');
    }

    console.log(
      '\n  ASIG pedido=' + a.pedidoId + '/' + (a.orderNumber || '?') +
      ' línea[' + a.lineIndex + '] qtyOpen=' + a.line.qtyOpen +
      ' asigAt=' + iso(a.line.asigAt) + ' asigReserva=' + a.line.asigReserva +
      ' creadaPorReparto=' + esReparto
    );
    console.log('    derivados-en-universo=' + derivados.length + ' derivados-global=' + derivadosGlobal.length);
    // Info operativa de cada derivado (incluye los de OTRO cliente, para poder
    // investigarlos). Datos de negocio (nombre comercial + cardCode), sin PII extra.
    for (const d of derivadosGlobal) {
      const dCard = String(d.clientCardCode || '').trim();
      const sameClient = dCard === String(a.pedido.clientCardCode || '').trim();
      console.log(
        '      derivado=' + d._fsId + ' orderNumber=' + (d.orderNumber || '—') +
        ' cliente=' + (d.clientName || '—') + ' cardCode=' + (dCard || '—') +
        ' createdAt=' + iso(d.createdAt) +
        (sameClient ? '' : '  ⚠ CLIENTE DISTINTO → re-correr con --cardCode=' + dCard + ' para su detalle')
      );
    }
    console.log('    VEREDICTO: ' + veredicto);
  }

  // ── 3b) Errores registrados de cancelación (operations_log) ─────────────────
  // Paginado por timestamp desc hasta cubrir la ventana relevante (sin índice
  // compuesto). Completitud explícita: COMPLETA vs ⚠ PARCIAL.
  console.log('\n──────────────── operations_log (errores de escritura relacionados) ────────────────');
  {
    const idsRel = new Set(pedidos.map((p) => p._fsId));
    // Ventana: auto = createdAt más viejo del universo − 7d; o --olDays desde hoy.
    let windowStartMs;
    if (OL_DAYS > 0) {
      windowStartMs = Date.now() - OL_DAYS * 24 * 60 * 60 * 1000;
    } else {
      const createds = pedidos
        .map((p) => parseDateFlexible(p.createdAt))
        .filter(Boolean)
        .map((d) => d.getTime());
      const earliest = createds.length
        ? Math.min(...createds)
        : Date.now() - 180 * 24 * 60 * 60 * 1000;
      windowStartMs = earliest - 7 * 24 * 60 * 60 * 1000;
    }
    console.log('  Ventana desde: ' + new Date(windowStartMs).toISOString());
    const ol = await scanOperationsLog(db, idsRel, cardCodes, windowStartMs);
    if (ol.error) {
      console.log('  (no se pudo leer operations_log: ' + ol.error + ')');
      console.log('  ⚠ COBERTURA NO GARANTIZADA — revisar manualmente.');
    } else {
      for (const o of ol.hits) {
        console.log(
          '  [' + iso(o.timestamp) + '] col=' + (o.collection || '—') +
          ' doc=' + (o.documentId || '—') + ' op=' + (o.op || '—') +
          ' handler=' + (o.handler || '—') + ' err=' + String(o.errMessage || '').slice(0, 160)
        );
      }
      if (!ol.hits.length) console.log('  Sin entradas client_write_failed relacionadas en la ventana.');
      console.log(
        '  Cobertura: docs=' + ol.scanned + ' páginas=' + ol.pages +
        (ol.complete
          ? '  COMPLETA (cubre la ventana).'
          : '  ⚠ PARCIAL (tope de páginas alcanzado; NO cubre toda la ventana — acotar con --olDays).')
      );
    }
    console.log('  Nota: la cancelación v1280 loguea sobre todo en consola del cliente; no siempre llega a operations_log → ausencia de hits ≠ no hubo error.');
  }

  // ── 4) Lado SAP (opcional, SOLO GET) ────────────────────────────────────────
  if (WITH_SAP) {
    console.log('\n──────────────── SAP (Service Layer · SOLO GET) ────────────────');
    const pass = process.env.SAP_SL_PASSWORD || '';
    if (!pass) {
      console.log('  SKIP SAP: falta SAP_SL_PASSWORD en el entorno. Correr con la var para habilitar.');
    } else {
      try {
        const cfgDoc = await db.doc('app_config/sap_integration').get();
        const sl = (cfgDoc.data() || {}).serviceLayer || {};
        const sapConfig = {
          url: sl.url || '',
          companyDB: sl.companyDB || '',
          userName: sl.username || sl.userName || '', // §24: lowercase primero
          password: pass, // NUNCA se imprime
        };
        if (!sapConfig.url || !sapConfig.companyDB || !sapConfig.userName) {
          console.log('  SKIP SAP: sap_integration.serviceLayer incompleto (url/companyDB/userName).');
        } else {
          const { sapLogin, sapGet, sapLogout } = await import('../../functions/core/sap-sl-client.js');
          const deps = { fetch: globalThis.fetch, sapConfig };
          const session = await sapLogin(deps);
          try {
            // Por cada pedido con docEntry (SQ), pedir SQ/SO/Invoice por NumAtCard=pedidoId.
            for (const p of pedidos) {
              const t = p.transferidoSAP || {};
              if (!t.docEntry && !t.docNum) continue;
              console.log('\n  pedido=' + p._fsId + ' (orderNumber=' + (p.orderNumber || '?') + ')');
              const esc = String(p._fsId).replace(/'/g, "''");
              // SO por NumAtCard
              const soR = await sapGet(
                session,
                '/b1s/v1/Orders?$filter=' + encodeURIComponent("NumAtCard eq '" + esc + "'") +
                  '&$select=' + encodeURIComponent('DocEntry,DocNum,DocumentStatus'),
                deps
              );
              const soRows = (soR.body && soR.body.value) || [];
              console.log('    Orders (SO) por NumAtCard: ' + JSON.stringify(soRows));
              // SQ por docEntry
              if (t.docEntry) {
                const sqR = await sapGet(
                  session,
                  '/b1s/v1/Quotations(' + Number(t.docEntry) + ')?$select=' +
                    encodeURIComponent('DocEntry,DocNum,DocumentStatus,Cancelled'),
                  deps
                );
                console.log('    Quotation(' + t.docEntry + '): ' +
                  (sqR.status === 200 ? JSON.stringify(sqR.body) : 'status=' + sqR.status));
              }
              // Invoices por NumAtCard (cantidades facturadas del SKU)
              const invR = await sapGet(
                session,
                '/b1s/v1/Invoices?$filter=' + encodeURIComponent("NumAtCard eq '" + esc + "'") +
                  '&$select=' + encodeURIComponent('DocEntry,DocNum,DocumentStatus'),
                deps
              );
              const invRows = (invR.body && invR.body.value) || [];
              console.log('    Invoices por NumAtCard: ' + JSON.stringify(invRows));
            }
          } finally {
            try { await sapLogout(session, deps); } catch { /* noop */ }
          }
        }
      } catch (e) {
        console.log('  SAP error (solo lectura, no afecta datos): ' + (e && e.message ? e.message : e));
      }
    }
  } else {
    console.log('\n(SAP omitido — correr con --sap y SAP_SL_PASSWORD para reconstruir SQ/SO/Factura.)');
  }

  // ── 5) Resumen A–G ──────────────────────────────────────────────────────────
  console.log('\n================================================================');
  console.log('RESUMEN (completar con lo de arriba):');
  console.log('A. Cronología: ver DETALLE POR PEDIDO (orden por createdAt).');
  console.log('B. Correspondencia reserva↔pedido↔SQ↔SO↔factura: cruzar transferidoSAP + sección SAP.');
  console.log('C. Cantidades por SKU/etapa: qtyOpen (ASIG) vs qtyInvoiced (factura) por línea.');
  console.log('D. H1: solo se confirma con H1(a) (derivado que REFERENCIA la ASIG + ASIG viva).');
  console.log('   "RELACIÓN NO DEMOSTRADA" NO es H1 — requiere evidencia SAP/CRM adicional.');
  console.log('E. Puente CPST: derivados-global + cancelledFrom/IntoPedidoId por ASIG.');
  console.log('   ⚠ coincidencia cliente+SKU+cantidad NO prueba que sean las mismas unidades.');
  console.log('F. Causa raíz / faltante: si no hubo acceso SAP, falta reconstruir SQ→SO.');
  console.log('G. Corrección: NO implementar; definir tras confirmar el veredicto.');
  console.log('================================================================');
  console.log('MODO SOLO LECTURA — no se escribió Firestore ni SAP.');
}

main().catch((e) => {
  console.error('FATAL (read-only, sin efectos): ' + (e && e.stack ? e.stack : e));
  process.exit(1);
});
