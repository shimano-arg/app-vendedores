// AS v1521 (2026-10-29) — Asignaciones huérfanas (ASIG sin respaldo real).
//
// Disparador: CPST de REBORN SRL (C30710852762) 29/10 09:08 rechazado con
// "CLC66H2PY (pedido 8lGQkjUJfZwqsfnNw4iw): linea con qtyOpen=0, state=ASIG".
//
// Detecta 4 tipos de inconsistencia (read-only por default):
//   Z  ASIG zombie: línea state='ASIG' con qtyOpen<=0 en pedido abierto.
//      Productor conocido: revertSobreAsignadas (§40.11) con entregable 0
//      deja qty=0/qtyOpen=0 y state='ASIG' (fix en PR aparte).
//   W  Waitlist abierta cuyo asigRef/pedidosOrigenes apunta a una línea que ya
//      no es ASIG o tiene qtyOpen < qtyAsignada. Fantasma = diferencia.
//   R  Asignación registrada en ingresos_reparto.assignments[] sin línea con
//      asigFromReparto=<ingresoId> en el pedido (update perdido). Fantasma = qty.
//      También marca cliente+SKU asignado en 2+ ingresos (doble aplicación).
//   S  stock_snapshot/{SKU}.asignadas.byClient con cardCodes/qty que no se
//      corresponden con los pedidos (claves viejas que merge:true no borra).
//
// Uso:
//   node scripts/audit/AS_asig_huerfanas.cjs                  # dry-run, todo
//   node scripts/audit/AS_asig_huerfanas.cjs --sku=TRX301B    # foco 1 SKU (dump)
//   node scripts/audit/AS_asig_huerfanas.cjs --pedido=8lGQkjUJfZwqsfnNw4iw
//   node scripts/audit/AS_asig_huerfanas.cjs --apply          # SOLO con OK Mariano
//
// --apply ejecuta únicamente las acciones Z (cerrar zombie) y W (corregir o
// liberar ref). R y S quedan como acción manual. Cada write guarda snapshot
// _backfill.AS_asig_huerfanas_2026-10-29_v1521 (CLAUDE.md §55) y re-verifica
// el estado dentro de una transacción antes de escribir.

const PROJECT = 'app-vendedores-shimano';
const SLUG = 'AS_asig_huerfanas_2026-10-29_v1521';

/** @param {any} v */
function toMs(v) {
  if (!v) return null;
  if (typeof v === 'string') {
    const t = Date.parse(v);
    return Number.isNaN(t) ? null : t;
  }
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (typeof v.seconds === 'number') return v.seconds * 1000;
  return null;
}

const up = (s) => String(s || '').toUpperCase().trim();
const num = (n) => Number(n) || 0;

/**
 * Análisis puro (testeable sin Firestore).
 * @param {{pedidos:any[], waitlists:any[], ingresos:any[], perSkuSnap:Record<string, any>,
 *          nowMs:number, lineReservesStock:(l:any, now:number, p:any)=>boolean, skuFiltro?:string}} input
 */
function analizar(input) {
  const { pedidos, waitlists, ingresos, perSkuSnap, nowMs, lineReservesStock } = input;
  const skuFiltro = input.skuFiltro ? up(input.skuFiltro) : '';
  const byId = new Map(pedidos.map((p) => [p._fsId, p]));
  const okSku = (s) => !skuFiltro || up(s) === skuFiltro;

  /** @type {any[]} */ const Z = [];
  /** @type {any[]} */ const W = [];
  /** @type {any[]} */ const R = [];
  /** @type {any[]} */ const S = [];

  // Refs de waitlists abiertas (para saber si una zombie está referenciada).
  /** @type {Map<string, any[]>} key pedidoId|lineIndex */
  const refsByLine = new Map();
  for (const w of waitlists) {
    if (!w || w.closedAt || w.stage === 'consumed') continue;
    /** @type {Map<string, any>} */
    const refs = new Map();
    for (const o of Array.isArray(w.pedidosOrigenes) ? w.pedidosOrigenes : []) {
      if (o && o.pedidoId) refs.set(o.pedidoId + '|' + o.lineIndex, { ...o, fuente: 'pedidosOrigenes' });
    }
    (Array.isArray(w.items) ? w.items : []).forEach((it, itemIndex) => {
      for (const a of Array.isArray(it && it.asigRefs) ? it.asigRefs : []) {
        if (!a || !a.pedidoId) continue;
        const k = a.pedidoId + '|' + a.lineIndex;
        const prev = refs.get(k);
        refs.set(k, {
          ...a,
          sku: a.sku || (it && it.code),
          qtyAsignada: Math.max(num(a.qtyAsignada), num(prev && prev.qtyAsignada)),
          itemIndex,
          fuente: prev ? 'ambas' : 'asigRefs',
        });
      }
    });
    for (const [k, ref] of refs) {
      if (!okSku(ref.sku)) continue;
      const entry = { waitlistId: w._id, orderNumber: w.orderNumber || null, clientName: w.clientName || '', cardCode: w.clientCardCode || '', ...ref };
      if (!refsByLine.has(k)) refsByLine.set(k, []);
      refsByLine.get(k).push(entry);
      const p = byId.get(ref.pedidoId);
      const line = p && Array.isArray(p.lines) ? p.lines[ref.lineIndex] : undefined;
      const liveQo = line && line.state === 'ASIG' && up(line.code) === up(ref.sku) ? num(line.qtyOpen) : 0;
      const fantasma = Math.max(0, num(ref.qtyAsignada) - liveQo);
      if (fantasma > 0) {
        W.push({
          ...entry,
          lineState: line ? line.state : null,
          lineQtyOpen: line ? num(line.qtyOpen) : null,
          pedidoExiste: !!p,
          fantasma,
        });
      }
    }
  }

  // Z: zombies.
  for (const p of pedidos) {
    (Array.isArray(p.lines) ? p.lines : []).forEach((l, i) => {
      if (!l || l.state !== 'ASIG' || num(l.qtyOpen) > 0 || !okSku(l.code)) return;
      const refs = refsByLine.get(p._fsId + '|' + i) || [];
      Z.push({
        pedidoId: p._fsId,
        lineIndex: i,
        sku: l.code,
        cardCode: p.clientCardCode || '',
        clientName: p.clientName || '',
        qty: num(l.qty),
        qtyOpen: num(l.qtyOpen),
        qtyInvoiced: num(l.qtyInvoiced),
        asigAt: l.asigAt || null,
        asigFromReparto: l.asigFromReparto || null,
        revertida: p.lines.some((x) => x && x.splitFromLineIndex === i && x.asigRevertidaReason),
        refsWaitlist: refs.map((r) => r.waitlistId),
        // Unidades que alguien cree que están acá (waitlists).
        fantasma: refs.reduce((s, r) => s + num(r.qtyAsignada), 0),
      });
    });
  }

  // R: asignaciones de reparto sin línea que las respalde + dobles.
  /** @type {Map<string, string[]>} cardCode|sku → ingresoIds */
  const asigPorClienteSku = new Map();
  for (const ing of ingresos) {
    if (!okSku(ing.sku)) continue;
    for (const a of Array.isArray(ing.assignments) ? ing.assignments : []) {
      if (!a || !a.pedidoId) continue;
      const p = byId.get(a.pedidoId);
      if (!p) continue; // pedido cerrado/facturado: fuera de alcance
      const lines = Array.isArray(p.lines) ? p.lines : [];
      const match = lines.filter((l) => l && l.asigFromReparto === ing._id);
      const k = up(p.clientCardCode || p.clientName) + '|' + up(ing.sku);
      if (!asigPorClienteSku.has(k)) asigPorClienteSku.set(k, []);
      asigPorClienteSku.get(k).push(ing._id);
      if (match.length === 0) {
        R.push({
          tipo: 'asignacion_sin_linea',
          ingresoId: ing._id,
          sku: ing.sku,
          pedidoId: a.pedidoId,
          lineIndex: a.lineIndex,
          cardCode: p.clientCardCode || '',
          clientName: p.clientName || '',
          appliedAt: ing.appliedAt || null,
          appliedBy: ing.appliedBy || null,
          fantasma: num(a.qtyAsignada),
        });
      }
    }
  }
  for (const [k, ids] of asigPorClienteSku) {
    const uniq = [...new Set(ids)];
    if (uniq.length >= 2) R.push({ tipo: 'doble_aplicacion', clave: k, ingresoIds: uniq, fantasma: 0 });
  }

  // S: snapshot por SKU vs recomputado (misma regla que aggregate: qtyOpen ASIG con lineReservesStock).
  /** @type {Map<string, Map<string, number>>} */
  const real = new Map();
  for (const p of pedidos) {
    for (const l of Array.isArray(p.lines) ? p.lines : []) {
      if (!l || l.state !== 'ASIG' || num(l.qtyOpen) <= 0) continue;
      if (!lineReservesStock(l, nowMs, p)) continue;
      const sku = up(l.code);
      if (!okSku(sku)) continue;
      if (!real.has(sku)) real.set(sku, new Map());
      const cc = p.clientCardCode || '';
      real.get(sku).set(cc, (real.get(sku).get(cc) || 0) + num(l.qtyOpen));
    }
  }
  for (const [skuRaw, d] of Object.entries(perSkuSnap || {})) {
    const sku = up(skuRaw);
    if (!okSku(sku)) continue;
    const byClient = (d && d.asignadas && d.asignadas.byClient) || {};
    const r = real.get(sku) || new Map();
    const claves = new Set([...Object.keys(byClient), ...r.keys()]);
    for (const cc of claves) {
      const snapQ = num(byClient[cc]);
      const realQ = r.get(cc) || 0;
      if (snapQ !== realQ) S.push({ sku, cardCode: cc, snapshot: snapQ, real: realQ, fantasma: Math.max(0, snapQ - realQ) });
    }
  }

  const total = (arr) => arr.reduce((s, x) => s + num(x.fantasma), 0);
  return {
    Z, W, R, S,
    totales: { Z: total(Z), W: total(W), R: total(R), S: total(S) },
  };
}

/**
 * Plan de limpieza (dry-run). Solo Z y W son automáticas.
 * @param {ReturnType<typeof analizar>} res
 * @param {any[]} pedidos
 */
function planLimpieza(res, pedidos) {
  const byId = new Map(pedidos.map((p) => [p._fsId, p]));
  /** @type {any[]} */ const acciones = [];
  // Líneas vivas ya referenciadas por alguna waitlist (no reusar).
  const usadas = new Set();
  for (const w of res.W) usadas.add(w.pedidoId + '|' + w.lineIndex);

  for (const w of res.W) {
    const p = byId.get(w.pedidoId);
    const lines = p && Array.isArray(p.lines) ? p.lines : [];
    const alt = lines.findIndex(
      (l, i) => l && l.state === 'ASIG' && up(l.code) === up(w.sku) && num(l.qtyOpen) >= num(w.qtyAsignada) && !usadas.has(w.pedidoId + '|' + i)
    );
    if (alt >= 0) {
      usadas.add(w.pedidoId + '|' + alt);
      acciones.push({ accion: 'corregir_ref', waitlistId: w.waitlistId, pedidoId: w.pedidoId, deLineIndex: w.lineIndex, aLineIndex: alt, sku: w.sku, qty: w.qtyAsignada, porque: 'el pedido tiene otra línea ASIG viva del mismo producto que cubre la cantidad' });
    } else if (w.lineState === 'ASIG' && num(w.lineQtyOpen) > 0) {
      // Respaldo parcial: la línea sigue viva con menos unidades → bajar la ref
      // a lo que existe (no perder las unidades reales).
      acciones.push({ accion: 'ajustar_ref', waitlistId: w.waitlistId, pedidoId: w.pedidoId, lineIndex: w.lineIndex, sku: w.sku, qtyAntes: num(w.qtyAsignada), qtyNueva: num(w.lineQtyOpen), porque: 'la línea ASIG tiene menos unidades abiertas que la reserva; se baja la reserva a lo que existe' });
    } else {
      acciones.push({ accion: 'liberar_ref', waitlistId: w.waitlistId, pedidoId: w.pedidoId, lineIndex: w.lineIndex, sku: w.sku, qty: w.fantasma, porque: 'no hay línea ASIG viva que la respalde; el ítem queda en la orden sin reserva (al confirmar va con stock libre o espera stock)' });
    }
  }
  for (const z of res.Z) {
    if (z.qtyInvoiced > 0) {
      acciones.push({ accion: 'manual', pedidoId: z.pedidoId, lineIndex: z.lineIndex, sku: z.sku, porque: 'zombie con qtyInvoiced>0: revisar contra SAP antes de tocar' });
      continue;
    }
    acciones.push({ accion: 'cerrar_zombie', pedidoId: z.pedidoId, lineIndex: z.lineIndex, sku: z.sku, qty: z.qty, porque: z.revertida ? 'revertSobreAsignadas la dejó en 0 y apendeó la BO' : 'ASIG sin unidades abiertas' });
  }
  for (const r of res.R) {
    if (r.tipo === 'asignacion_sin_linea') acciones.push({ accion: 'manual', ingresoId: r.ingresoId, pedidoId: r.pedidoId, sku: r.sku, qty: r.fantasma, porque: 'reparto registró la asignación pero el pedido no la tiene: re-asignar desde Reparto si corresponde' });
  }
  return acciones;
}

async function aplicar(db, acciones, nowIso) {
  const out = { ok: 0, skip: 0, err: [] };
  for (const a of acciones) {
    try {
      if (a.accion === 'cerrar_zombie') {
        const ref = db.collection('pedidos').doc(a.pedidoId);
        await db.runTransaction(async (tx) => {
          const snap = await tx.get(ref);
          const lines = (snap.data() || {}).lines || [];
          const l = lines[a.lineIndex];
          if (!l || l.state !== 'ASIG' || num(l.qtyOpen) > 0 || up(l.code) !== up(a.sku)) { out.skip++; return; }
          const prev = { ...l };
          lines[a.lineIndex] = { ...l, state: 'cancelled', qtyOpen: 0, asigReserva: false, closedReason: 'asig_huerfana_limpieza', cancelledAt: nowIso, cancelledBy: 'scripts/audit/AS_asig_huerfanas.cjs' };
          tx.update(ref, {
            lines,
            updatedAt: nowIso,
            [`_backfill.${SLUG}_L${a.lineIndex}`]: { previousLine: JSON.parse(JSON.stringify(prev)), by: 'scripts/audit/AS_asig_huerfanas.cjs', at: nowIso },
          });
          out.ok++;
        });
      } else if (a.accion === 'corregir_ref' || a.accion === 'liberar_ref' || a.accion === 'ajustar_ref') {
        const ref = db.collection('revision_waitlist').doc(a.waitlistId);
        await db.runTransaction(async (tx) => {
          const snap = await tx.get(ref);
          if (!snap.exists) { out.skip++; return; }
          const w = snap.data() || {};
          const fromIdx = a.accion === 'corregir_ref' ? a.deLineIndex : a.lineIndex;
          const hit = (o) => o && o.pedidoId === a.pedidoId && Number(o.lineIndex) === Number(fromIdx);
          const fix = (o) =>
            a.accion === 'corregir_ref'
              ? { ...o, lineIndex: a.aLineIndex }
              : a.accion === 'ajustar_ref'
                ? { ...o, qtyAsignada: a.qtyNueva }
                : null;
          const prevOrig = w.pedidosOrigenes || [];
          const prevItems = w.items || [];
          const pedidosOrigenes = prevOrig.map((o) => (hit(o) ? fix(o) : o)).filter(Boolean);
          const items = prevItems.map((it) => {
            if (!Array.isArray(it && it.asigRefs)) return it;
            const asigRefs = it.asigRefs.map((o) => (hit(o) ? fix(o) : o)).filter(Boolean);
            const n = { ...it, asigRefs };
            if (asigRefs.length === 0) { delete n.asigRefs; delete n.origen; }
            return n;
          });
          tx.update(ref, {
            pedidosOrigenes,
            items,
            updatedAt: nowIso,
            [`_backfill.${SLUG}`]: { previousValues: JSON.parse(JSON.stringify({ pedidosOrigenes: prevOrig, items: prevItems })), by: 'scripts/audit/AS_asig_huerfanas.cjs', at: nowIso },
          });
          out.ok++;
        });
      }
    } catch (e) {
      out.err.push(a.accion + ' ' + (a.pedidoId || a.waitlistId) + ': ' + (e && e.message));
    }
  }
  return out;
}

async function main() {
  const args = Object.fromEntries(
    process.argv.slice(2).map((a) => {
      const [k, v] = a.replace(/^--/, '').split('=');
      return [k, v === undefined ? true : v];
    })
  );
  const admin = require('../../functions/node_modules/firebase-admin');
  if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT });
  const db = admin.firestore();
  const { lineReservesStock } = await import('../../src/pure/stock-realmente-disponible.js');
  const nowMs = Date.now();

  const pedSnap = await db.collection('pedidos').where('closedAt', '==', null).get();
  const pedidos = pedSnap.docs.map((d) => ({ _fsId: d.id, ...d.data() }));
  const wlSnap = await db.collection('revision_waitlist').get();
  const waitlists = wlSnap.docs.map((d) => ({ _id: d.id, ...d.data() }));
  const days = Number(args.days || 14);
  const ingSnap = await db.collection('ingresos_reparto').get();
  const ingresos = ingSnap.docs
    .map((d) => ({ _id: d.id, ...d.data() }))
    .filter((i) => {
      const t = toMs(i.appliedAt) || toMs(i.detectedAt);
      return t === null || nowMs - t <= days * 86400000;
    });
  // SKUs con ASIG en pedidos abiertos (y el filtro) → leer stock_snapshot/{SKU}.
  const skus = new Set();
  for (const p of pedidos) for (const l of p.lines || []) if (l && l.state === 'ASIG' && l.code) skus.add(up(l.code));
  if (args.sku) skus.add(up(args.sku));
  const perSkuSnap = {};
  for (const sku of skus) {
    const s = await db.collection('stock_snapshot').doc(sku).get();
    if (s.exists) perSkuSnap[sku] = s.data();
  }

  if (args.pedido) {
    const s = await db.collection('pedidos').doc(String(args.pedido)).get();
    const p = s.data() || {};
    console.log('=== PEDIDO', args.pedido, '|', p.clientName, p.clientCardCode, '| closedAt', p.closedAt || null, '| updatedAt', p.updatedAt);
    (p.lines || []).forEach((l, i) => console.log(String(i).padStart(3), JSON.stringify({ code: l.code, state: l.state, qty: l.qty, qtyOpen: l.qtyOpen, qtyCancelled: l.qtyCancelled, asigAt: l.asigAt, asigFromReparto: l.asigFromReparto, splitFromLineIndex: l.splitFromLineIndex, asigRevertidaReason: l.asigRevertidaReason, asigRevertidaBy: l.asigRevertidaBy, asigRevertidaAt: l.asigRevertidaAt, closedReason: l.closedReason })));
    const ingIds = new Set((p.lines || []).map((l) => l && l.asigFromReparto).filter(Boolean));
    for (const id of ingIds) {
      const ing = (await db.collection('ingresos_reparto').doc(id).get()).data() || {};
      console.log('--- ingreso', id, ing.sku, 'status', ing.status, 'appliedAt', ing.appliedAt, 'by', ing.appliedBy, 'assignments', JSON.stringify(ing.assignments || []), 'errors', JSON.stringify(ing.assignmentErrors || []));
    }
    const logs = await db.collection('reparto_log').where('pedidoId', '==', String(args.pedido)).get().catch(() => ({ docs: [] }));
    for (const d of logs.docs) console.log('--- reparto_log', d.id, JSON.stringify(d.data()));
    const ops = await db.collection('operations_log').where('type', '==', 'asig_revertida_auto').limit(1).get().catch(() => ({ docs: [] }));
    if (ops.docs.length === 0) console.log('(operations_log no guarda asig_revertida_auto; ver Cloud Logging de onDep11IncreaseCreateReparto)');
  }

  const res = analizar({ pedidos, waitlists, ingresos, perSkuSnap, nowMs, lineReservesStock, skuFiltro: args.sku });
  const acciones = planLimpieza(res, pedidos);

  const print = (t, arr, cols) => {
    console.log('\n=== ' + t + ' (' + arr.length + ' filas, ' + arr.reduce((s, x) => s + num(x.fantasma), 0) + ' u fantasma)');
    for (const x of arr) console.log('  ' + cols.map((c) => c + '=' + JSON.stringify(x[c])).join(' '));
  };
  print('Z — ASIG zombie (qtyOpen<=0)', res.Z, ['clientName', 'cardCode', 'sku', 'pedidoId', 'lineIndex', 'qty', 'asigFromReparto', 'revertida', 'refsWaitlist', 'fantasma']);
  print('W — refs de lista de espera sin respaldo', res.W, ['clientName', 'orderNumber', 'sku', 'pedidoId', 'lineIndex', 'qtyAsignada', 'lineState', 'lineQtyOpen', 'fantasma']);
  print('R — reparto sin línea / doble aplicación', res.R, ['tipo', 'clientName', 'sku', 'ingresoId', 'pedidoId', 'appliedAt', 'ingresoIds', 'fantasma']);
  print('S — stock_snapshot/{SKU}.asignadas.byClient vs pedidos', res.S, ['sku', 'cardCode', 'snapshot', 'real', 'fantasma']);
  console.log('\nTOTALES u fantasma:', JSON.stringify(res.totales), '→', Object.values(res.totales).reduce((a, b) => a + b, 0));
  console.log('\n=== PLAN DE LIMPIEZA (' + (args.apply ? 'APPLY' : 'dry-run') + ')');
  for (const a of acciones) console.log('  ' + JSON.stringify(a));

  if (args.apply) {
    const r = await aplicar(db, acciones.filter((a) => a.accion !== 'manual'), new Date().toISOString());
    console.log('\nAPPLY:', JSON.stringify(r));
  } else {
    console.log('\nDry-run: nada se escribió. Para aplicar Z+W: --apply (con OK de Mariano).');
  }
}

module.exports = { analizar, planLimpieza };

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
