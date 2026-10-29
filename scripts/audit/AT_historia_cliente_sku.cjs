// AT (2026-10-29) — Historia de un SKU para un cliente (solo lectura).
//
// Disparador: BENGOCHEA (C20293164852) SKU 597151. La ORDEN 653 se confirmó
// a las 03:34 con 4 u y a las 15:36 apareció la ORDEN 722 (STOCK ASIGNADO, 3 u).
// Pregunta: ¿las 3 u son un resto de la 653 o una asignación nueva?
//
// Imprime, ordenado por fecha:
//   - cada línea del SKU en pedidos del cliente (abiertos y cerrados),
//   - órdenes en lista de espera del cliente que tienen el SKU,
//   - ingresos de reparto del SKU y lo que se le asignó al cliente.
//
// Uso:
//   node scripts/audit/AT_historia_cliente_sku.cjs --card=C20293164852 --sku=597151
//   node scripts/audit/AT_historia_cliente_sku.cjs --card=C20293164852 --sku=597151 --dias=30

const PROJECT = 'app-vendedores-shimano';

/** @param {any} v */
function toIso(v) {
  if (!v) return '';
  if (typeof v === 'string') return v;
  if (typeof v.toDate === 'function') return v.toDate().toISOString();
  if (typeof v.seconds === 'number') return new Date(v.seconds * 1000).toISOString();
  return String(v);
}

async function main() {
  const args = Object.fromEntries(
    process.argv.slice(2).map((a) => {
      const [k, v] = a.replace(/^--/, '').split('=');
      return [k, v === undefined ? true : v];
    })
  );
  const card = String(args.card || '').trim();
  const sku = String(args.sku || '')
    .trim()
    .toUpperCase();
  const dias = Number(args.dias) || 15;
  if (!card || !sku) {
    console.error('Uso: --card=<CardCode> --sku=<SKU> [--dias=15]');
    process.exit(1);
  }
  const desdeIso = new Date(Date.now() - dias * 86400000).toISOString();
  const admin = require('../../functions/node_modules/firebase-admin');
  if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT });
  const db = admin.firestore();

  /** @type {Array<{at: string, txt: string}>} */
  const ev = [];
  const esSku = (/** @type {any} */ c) =>
    String(c || '')
      .trim()
      .toUpperCase() === sku;

  // 1) Pedidos del cliente.
  const ped = await db.collection('pedidos').where('clientCardCode', '==', card).get();
  for (const d of ped.docs) {
    const p = d.data() || {};
    const lines = Array.isArray(p.lines) ? p.lines : [];
    lines.forEach((l, i) => {
      if (!l || !esSku(l.code)) return;
      const at = toIso(l.asigAt || l.cancelledAt || p.confirmedAt || p.createdAt);
      if (at && at < desdeIso) return;
      ev.push({
        at,
        txt:
          `PEDIDO ${d.id} ORDEN ${p.orderNumber || '-'} linea[${i}] state=${l.state} ` +
          `qty=${l.qty} qtyOpen=${l.qtyOpen}` +
          (l.asigFromReparto ? ` asigFromReparto=${l.asigFromReparto}` : '') +
          (l.asigAt ? ` asigAt=${toIso(l.asigAt)}` : '') +
          (l.closedReason ? ` closedReason=${l.closedReason}` : '') +
          (l.cancelledIntoPedidoId ? ` cancelledInto=${l.cancelledIntoPedidoId}` : '') +
          (l.asigRevertidaReason ? ` revertida=${l.asigRevertidaReason}` : '') +
          (l.splitFromLineIndex != null ? ` splitFrom=${l.splitFromLineIndex}` : '') +
          ` | pedido stage=${p.stage || '-'} creado=${toIso(p.createdAt)} confirmado=${toIso(p.confirmedAt)}` +
          ` cerrado=${toIso(p.closedAt) || 'no'} SAP=${(p.transferidoSAP && p.transferidoSAP.docNum) || '-'}`,
      });
    });
  }

  // 2) Lista de espera del cliente.
  const wl = await db.collection('revision_waitlist').where('clientCardCode', '==', card).get();
  for (const d of wl.docs) {
    const w = d.data() || {};
    const items = Array.isArray(w.items) ? w.items : [];
    items.forEach((it, i) => {
      if (!it || !esSku(it.code)) return;
      const refs = (Array.isArray(it.asigRefs) ? it.asigRefs : [])
        .map((r) => `${r.pedidoId}[${r.lineIndex}]x${r.qtyAsignada}`)
        .join(',');
      ev.push({
        at: toIso(w.createdAt),
        txt:
          `ESPERA ${d.id} ORDEN ${w.orderNumber || '-'} item[${i}] qty=${it.qty} origen=${it.origen || '-'}` +
          ` asigRefs=${refs || '-'} | stage=${w.stage || '-'} cerrada=${toIso(w.closedAt) || 'no'}` +
          ` cargadoPor=${w.cargadoPorEmail || w.ownerEmail || '-'}`,
      });
    });
  }

  // 3) Ingresos de reparto del SKU.
  const ing = await db.collection('ingresos_reparto').where('sku', '==', sku).get();
  for (const d of ing.docs) {
    const g = d.data() || {};
    const det = toIso(g.detectedAt || g.createdAt);
    if (det && det < desdeIso) continue;
    const enCola = (Array.isArray(g.clientesBO) ? g.clientesBO : []).filter(
      (c) => c && c.cardCode === card
    );
    const asig = (Array.isArray(g.assignments) ? g.assignments : []).filter((a) =>
      ped.docs.some((p) => p.id === a.pedidoId)
    );
    ev.push({
      at: det,
      txt:
        `REPARTO ${d.id} ingresaron=${g.qtyIngresada} status=${g.status} aplicado=${toIso(g.appliedAt) || '-'}` +
        ` por=${g.appliedBy || '-'} | cliente en cola: ${enCola.map((c) => c.qtyBackorder).join('+') || 'no'}` +
        ` | asignado al cliente: ${asig.map((a) => `${a.pedidoId}[${a.lineIndex}]x${a.qtyAsignada}`).join(',') || 'nada'}`,
    });
  }

  ev.sort((a, b) => String(a.at).localeCompare(String(b.at)));
  console.log(`Historia ${sku} para ${card} (últimos ${dias} días)\n`);
  for (const e of ev) console.log(`${e.at}  ${e.txt}`);
  if (ev.length === 0) console.log('Sin movimientos.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
