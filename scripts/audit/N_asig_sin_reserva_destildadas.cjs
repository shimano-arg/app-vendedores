// N — read-only prod: líneas state='ASIG' o 'confirmed' con asigReserva=false
// seteado manualmente desde el modal Stock Asignado (toggle v1268). Marcador:
// `asigReservaChangedAt` presente.
//
// Caso emblemático: MARCELO DANIEL BOSCHETTO LDM64TE2020030G 2u.
//
// Autorizado por Mariano 2026-10-21.

const PROJECT = 'app-vendedores-shimano';

async function main() {
  const admin = require('../../functions/node_modules/firebase-admin');
  if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT });
  const db = admin.firestore();

  const nowIso = new Date().toISOString();
  console.log('================================================================');
  console.log('N — ASIG destildadas en Stock Asignado @ ' + nowIso);
  console.log('================================================================');

  const pedidosSnap = await db.collection('pedidos').where('closedAt', '==', null).get();
  console.log('Pedidos abiertos: ' + pedidosSnap.size);

  const rows = [];
  pedidosSnap.forEach((d) => {
    const p = d.data() || {};
    const lines = Array.isArray(p.lines) ? p.lines : [];
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (!l) continue;
      if (l.state !== 'ASIG' && l.state !== 'confirmed') continue;
      // asigReserva=false explícito (acepta 0 también).
      const isDestildada = l.asigReserva === false || l.asigReserva === 0;
      if (!isDestildada) continue;
      // Marcador de toggle manual (asigReservaChangedAt). Sin él, puede ser
      // default del FIFO server-side viejo — lo listamos aparte.
      const hasChangedMarker = !!l.asigReservaChangedAt;
      const qo = Number(l.qtyOpen) || 0;
      if (qo <= 0) continue;
      rows.push({
        pedidoId: d.id,
        orderNumber: p.orderNumber || '',
        clientName: p.clientName || '',
        clientCardCode: p.clientCardCode || '',
        province: p.province || '',
        locName: p.locName || '',
        lineIndex: i,
        sku: String(l.code || l.sku || '').toUpperCase(),
        state: l.state,
        qty: Number(l.qty) || 0,
        qtyOpen: qo,
        asigReservaChangedAt: l.asigReservaChangedAt || '(sin marcador)',
        asigReservaChangedBy: l.asigReservaChangedBy || '(sin usuario)',
        hasChangedMarker,
      });
    }
  });

  const totalLineas = rows.length;
  const totalUnidades = rows.reduce((s, r) => s + r.qtyOpen, 0);
  const porSku = new Map();
  for (const r of rows) {
    const key = r.sku;
    const prev = porSku.get(key) || { sku: key, lineas: 0, unidades: 0 };
    prev.lineas += 1;
    prev.unidades += r.qtyOpen;
    porSku.set(key, prev);
  }
  const skuArr = Array.from(porSku.values()).sort((a, b) => b.unidades - a.unidades);

  console.log();
  console.log('===== HALLAZGO =====');
  console.log('Líneas ASIG/confirmed destildadas: ' + totalLineas);
  console.log('Unidades afectadas: ' + totalUnidades);
  console.log('SKUs únicos: ' + skuArr.length);
  console.log('Con marcador de toggle manual (asigReservaChangedAt): ' + rows.filter((r) => r.hasChangedMarker).length);
  console.log();

  console.log('===== TOP 20 SKUs POR UNIDADES =====');
  console.log('| SKU | Lineas | Unidades |');
  console.log('|---|---:|---:|');
  for (const s of skuArr.slice(0, 20)) {
    console.log('| ' + s.sku + ' | ' + s.lineas + ' | ' + s.unidades + ' |');
  }

  console.log();
  console.log('===== DETALLE (ordenado por changedAt desc) =====');
  rows.sort((a, b) => String(b.asigReservaChangedAt).localeCompare(String(a.asigReservaChangedAt)));
  console.log('| OrderNumber | Cliente | SKU | state | qtyOpen | ChangedAt | ChangedBy |');
  console.log('|---|---|---|---|---:|---|---|');
  for (const r of rows) {
    console.log('| ' + r.orderNumber + ' | ' + r.clientName + ' | ' + r.sku + ' | ' + r.state + ' | ' + r.qtyOpen + ' | ' + String(r.asigReservaChangedAt).slice(0, 19) + ' | ' + r.asigReservaChangedBy + ' |');
  }

  // Caso BOSCHETTO LDM64TE2020030G.
  const bos = rows.filter((r) => r.sku === 'LDM64TE2020030G' && (r.clientName || '').toUpperCase().includes('BOSCHETTO'));
  console.log();
  console.log('===== CASO BOSCHETTO LDM64TE2020030G =====');
  if (bos.length === 0) {
    console.log('No se encontró línea destildada para BOSCHETTO + LDM64TE2020030G.');
  } else {
    for (const r of bos) {
      console.log('pedidoId=' + r.pedidoId);
      console.log('  ORDEN=' + r.orderNumber + ' clientName=' + r.clientName + ' cardCode=' + r.clientCardCode);
      console.log('  SKU=' + r.sku + ' state=' + r.state + ' qty=' + r.qty + ' qtyOpen=' + r.qtyOpen);
      console.log('  asigReserva=false asigReservaChangedAt=' + r.asigReservaChangedAt);
      console.log('  asigReservaChangedBy=' + r.asigReservaChangedBy);
    }
  }

  const fs = require('fs');
  const path = require('path');
  const outDir = path.join(__dirname, '..', '..', 'docs', 'auditoria');
  const outPath = path.join(outDir, '33_ASIG_DESTILDADAS.md');
  const md = [
    '# N — ASIG destildadas (asigReserva=false) @ ' + nowIso,
    '',
    'Líneas `state=ASIG` o `confirmed` con `asigReserva=false` + `asigReservaChangedAt` presente (toggle manual del modal Stock Asignado v1268).',
    '',
    '## Totales',
    '',
    '- Líneas: **' + totalLineas + '**',
    '- Unidades: **' + totalUnidades + '**',
    '- SKUs únicos: **' + skuArr.length + '**',
    '',
    '## Top SKUs',
    '',
    '| SKU | Líneas | Unidades |',
    '|---|---:|---:|',
    ...skuArr.slice(0, 20).map((s) => '| ' + s.sku + ' | ' + s.lineas + ' | ' + s.unidades + ' |'),
    '',
    '## Detalle',
    '',
    '| OrderNumber | Cliente | SKU | state | qtyOpen | ChangedAt | ChangedBy |',
    '|---|---|---|---|---:|---|---|',
    ...rows.map((r) => '| ' + r.orderNumber + ' | ' + r.clientName + ' | ' + r.sku + ' | ' + r.state + ' | ' + r.qtyOpen + ' | ' + String(r.asigReservaChangedAt).slice(0, 19) + ' | ' + r.asigReservaChangedBy + ' |'),
    '',
    'Script: `scripts/audit/N_asig_sin_reserva_destildadas.cjs`.',
    '',
  ].join('\n');
  try {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(outPath, md, 'utf8');
    console.log();
    console.log('Markdown escrito en ' + outPath);
  } catch (e) {
    console.error('No se pudo escribir markdown: ' + (e && e.message ? e.message : String(e)));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
