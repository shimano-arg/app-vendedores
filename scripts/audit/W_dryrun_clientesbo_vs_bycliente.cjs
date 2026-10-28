#!/usr/bin/env node
// @ts-check
/**
 * PR2 DRY-RUN (READ-ONLY) — Compara `clientesBO` (shape viejo del doc
 * `ingresos_reparto`) contra `backorderApp.byClient` (shape nuevo que vive hoy
 * en `app_config/stock_snapshot.backorderBySkuDetail`) para TODOS los SKUs
 * que aparezcan en algún reparto activo (`status in ['pending','in_progress']`).
 *
 * Objetivo: antes de migrar el shape de los reparto docs al equivalente
 * `byClient`, cuantificar cuántas diferencias existirían (por cliente faltante,
 * cliente de más, qty distinta).
 *
 * NO escribe nada. Falla temprano si no hay credenciales ADC configuradas.
 *
 * Uso:
 *   # 1. Setear service account (una sola vez por terminal):
 *   # PS> $env:GOOGLE_APPLICATION_CREDENTIALS = 'C:\path\to\sa.json'
 *   # 2. Correr:
 *   node scripts/audit/W_dryrun_clientesbo_vs_bycliente.cjs
 *
 * Output: C:\Users\shimano.sandbox\Desktop\DRYRUN_PR2_CLIENTESBO.md
 */

const fs = require('fs');
const path = require('path');

const PROJECT_ID = 'app-vendedores-shimano';
const OUTPUT_PATH = 'C:\\Users\\shimano.sandbox\\Desktop\\DRYRUN_PR2_CLIENTESBO.md';
const EXAMPLE_SKU = 'CUDC201XG';

const admin = require('../../functions/node_modules/firebase-admin');

function normCardCode(v) {
  return String(v || '').trim().toUpperCase();
}
function normSku(v) {
  return String(v || '').trim().toUpperCase();
}

function parseJsonSafe(v) {
  if (v == null) return null;
  if (typeof v === 'object') return v;
  if (typeof v === 'string') {
    try {
      return JSON.parse(v);
    } catch (_e) {
      return null;
    }
  }
  return null;
}

function fmtNum(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return String(n);
  return String(x);
}

function escapeMd(v) {
  return String(v == null ? '' : v).replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

async function abortWithoutCreds(reason) {
  const now = new Date().toISOString();
  const md = [
    '# DRY-RUN PR2 — clientesBO vs backorderApp.byClient',
    'Fecha: ' + now,
    '',
    '## No se ejecutó contra prod',
    '',
    reason,
    '',
    'Para correr contra prod:',
    '',
    '```powershell',
    '$env:GOOGLE_APPLICATION_CREDENTIALS = \'C:\\path\\to\\service-account.json\'',
    'node scripts/audit/W_dryrun_clientesbo_vs_bycliente.cjs',
    '```',
    '',
  ].join('\n');
  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, md, 'utf8');
  console.log('[PR2 dryrun] ABORT — sin credenciales. Output escrito a:', OUTPUT_PATH);
  process.exit(2);
}

async function main() {
  // Gate: GOOGLE_APPLICATION_CREDENTIALS debe estar seteado y apuntar a un
  // archivo existente. Admin SDK silenciosamente falla a undefined si no hay
  // creds (no tira error hasta el primer .get()); preferimos avisar antes.
  const gac = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!gac) {
    await abortWithoutCreds(
      '`GOOGLE_APPLICATION_CREDENTIALS` no está definido en el environment. ' +
        'Se requiere runtime real con service account JSON para leer Firestore.'
    );
    return;
  }
  if (!fs.existsSync(gac)) {
    await abortWithoutCreds(
      '`GOOGLE_APPLICATION_CREDENTIALS` apunta a `' + gac + '` pero el archivo no existe.'
    );
    return;
  }

  if (admin.apps.length === 0) {
    admin.initializeApp({ projectId: PROJECT_ID });
  }
  const db = admin.firestore();

  console.log('[PR2 dryrun] Leyendo stock_snapshot...');
  const snapDoc = await db.doc('app_config/stock_snapshot').get();
  if (!snapDoc.exists) {
    console.error('ERR app_config/stock_snapshot no existe.');
    process.exit(1);
  }
  const snap = snapDoc.data() || {};

  // Estructura real del snapshot (CLAUDE.md §65):
  //   backorderBySkuDetail: JSON string { [sku]: {total, porCliente: {[cardCode]: qty}} }
  //   backorderBySku:       JSON string { [sku]: int }    (shape viejo compat UI)
  const detailMap = parseJsonSafe(snap.backorderBySkuDetail) || {};
  const flatMap = parseJsonSafe(snap.backorderBySku) || {};

  const snapshotHasByClient =
    detailMap && typeof detailMap === 'object' && Object.keys(detailMap).length > 0;

  console.log(
    '[PR2 dryrun] stock_snapshot._backorderSource=' +
      (snap._backorderSource || 'null') +
      ' | detailMap.keys=' +
      Object.keys(detailMap).length +
      ' | flatMap.keys=' +
      Object.keys(flatMap).length +
      ' | updatedAt=' +
      (snap.updatedAt ? snap.updatedAt.toDate ? snap.updatedAt.toDate().toISOString() : String(snap.updatedAt) : 'null')
  );

  console.log('[PR2 dryrun] Leyendo ingresos_reparto activos (pending + in_progress)...');
  const [pendingSnap, inProgSnap] = await Promise.all([
    db.collection('ingresos_reparto').where('status', '==', 'pending').get(),
    db.collection('ingresos_reparto').where('status', '==', 'in_progress').get(),
  ]);
  const repartoDocs = [];
  pendingSnap.forEach((d) => repartoDocs.push({ _id: d.id, ...d.data() }));
  inProgSnap.forEach((d) => repartoDocs.push({ _id: d.id, ...d.data() }));
  console.log('[PR2 dryrun] repartos activos:', repartoDocs.length);

  // Agrupar clientesBO por SKU normalizado para comparar vs snapshot. Un SKU
  // puede aparecer en más de un reparto (dedupe v1283 lo intenta evitar pero no
  // está garantizado). Si aparece en varios, concatenamos.
  /** @type {Map<string, {entries: Array<{repartoId: string, cardCode: string, clientName: string, qty: number}>, repartoIds: Set<string>}>} */
  const skuToRepartoClientes = new Map();
  for (const r of repartoDocs) {
    const sku = normSku(r.sku);
    if (!sku) continue;
    const entries = Array.isArray(r.clientesBO) ? r.clientesBO : [];
    let bucket = skuToRepartoClientes.get(sku);
    if (!bucket) {
      bucket = { entries: [], repartoIds: new Set() };
      skuToRepartoClientes.set(sku, bucket);
    }
    bucket.repartoIds.add(r._id);
    for (const c of entries) {
      bucket.entries.push({
        repartoId: r._id,
        cardCode: normCardCode(c && c.clientCardCode),
        clientName: String((c && c.clientName) || ''),
        qty: Number((c && c.qtyBackorder) || 0),
      });
    }
  }

  console.log('[PR2 dryrun] SKUs únicos en repartos activos:', skuToRepartoClientes.size);

  // Para cada SKU: comparar clientes/qty del reparto vs backorderApp.byClient.
  /** @type {Array<{sku: string, cliente: string, cardCode: string, qty_reparto: number, qty_snapshot: number, delta: number, explicacion: string, repartoIds: string[]}>} */
  const differences = [];
  let qtyDifferent = 0;
  let onlyInReparto = 0;
  let onlyInSnapshot = 0;

  const sortedSkus = Array.from(skuToRepartoClientes.keys()).sort();

  for (const sku of sortedSkus) {
    const bucket = skuToRepartoClientes.get(sku);
    const repartoIds = Array.from(bucket.repartoIds);

    // reparto side: agregar por cardCode (sumar si un cliente apareció en >1 reparto).
    /** @type {Map<string, {qty: number, name: string}>} */
    const repartoByClient = new Map();
    for (const e of bucket.entries) {
      const prev = repartoByClient.get(e.cardCode);
      if (prev) {
        prev.qty += e.qty;
      } else {
        repartoByClient.set(e.cardCode, { qty: e.qty, name: e.clientName });
      }
    }

    // snapshot side.
    const detail = detailMap[sku] || null;
    /** @type {Record<string, number>} */
    const snapshotByClient = (detail && typeof detail === 'object' && detail.porCliente) || {};

    const allCards = new Set([
      ...Array.from(repartoByClient.keys()),
      ...Object.keys(snapshotByClient),
    ]);

    for (const card of allCards) {
      const inReparto = repartoByClient.get(card);
      const qtyR = inReparto ? Number(inReparto.qty) || 0 : 0;
      const qtyS = Number(snapshotByClient[card]) || 0;
      if (qtyR === qtyS) continue;

      let explicacion;
      if (qtyR > 0 && qtyS === 0) {
        explicacion = 'Cliente solo en reparto';
        onlyInReparto++;
      } else if (qtyR === 0 && qtyS > 0) {
        explicacion = 'Cliente solo en snapshot';
        onlyInSnapshot++;
      } else {
        explicacion = 'Qty diferente';
        qtyDifferent++;
      }

      differences.push({
        sku,
        cliente: (inReparto && inReparto.name) || card,
        cardCode: card,
        qty_reparto: qtyR,
        qty_snapshot: qtyS,
        delta: qtyR - qtyS,
        explicacion,
        repartoIds,
      });
    }
  }

  // Sort differences by |delta| desc, luego sku, luego cardCode.
  differences.sort((a, b) => {
    const da = Math.abs(a.delta);
    const dbb = Math.abs(b.delta);
    if (da !== dbb) return dbb - da;
    if (a.sku !== b.sku) return a.sku < b.sku ? -1 : 1;
    return a.cardCode < b.cardCode ? -1 : 1;
  });

  // Caso ejemplo CUDC201XG (si no está, mostrar un sustituto top-1).
  const exampleSku = EXAMPLE_SKU;
  const exampleBucket = skuToRepartoClientes.get(exampleSku);
  const exampleDetail = detailMap[exampleSku] || null;
  const exampleDiffs = differences.filter((d) => d.sku === exampleSku);
  let fallbackSku = null;
  if (!exampleBucket && differences.length > 0) {
    fallbackSku = differences[0].sku;
  }

  // Construir markdown.
  const now = new Date().toISOString();
  const lines = [];
  lines.push('# DRY-RUN PR2 — clientesBO vs backorderApp.byClient');
  lines.push('Fecha: ' + now);
  lines.push('Project: ' + PROJECT_ID);
  lines.push('');
  lines.push('## Contexto');
  lines.push('');
  lines.push(
    'Compara el campo `clientesBO[]` de los docs de `ingresos_reparto` ' +
      '(shape viejo del PR2) contra `backorderApp.byClient` del shape nuevo que ' +
      'vive hoy en `app_config/stock_snapshot.backorderBySkuDetail` ' +
      '(JSON string `{[sku]: {total, porCliente: {[cardCode]: qty}}}`).'
  );
  lines.push('');
  lines.push('Snapshot leído:');
  lines.push('');
  lines.push('- `_backorderSource`: ' + (snap._backorderSource || 'null'));
  lines.push(
    '- `_backorderUpdatedAt`: ' +
      (snap._backorderUpdatedAt && snap._backorderUpdatedAt.toDate
        ? snap._backorderUpdatedAt.toDate().toISOString()
        : String(snap._backorderUpdatedAt || 'null'))
  );
  lines.push('- `backorderBySkuDetail` keys: ' + Object.keys(detailMap).length);
  lines.push('- `backorderBySku` keys (flat): ' + Object.keys(flatMap).length);
  lines.push('- `backorderBySkuDetail` tiene `porCliente`: ' + (snapshotHasByClient ? 'sí' : 'no'));
  lines.push('');
  lines.push('Repartos activos: ' + repartoDocs.length);
  lines.push('SKUs únicos en repartos activos: ' + skuToRepartoClientes.size);
  lines.push('Diferencias detectadas: ' + differences.length);
  lines.push('');
  lines.push('## Resumen por tipo de diferencia');
  lines.push('');
  lines.push('- Qty diferente: ' + qtyDifferent + ' casos.');
  lines.push('- Cliente solo en reparto: ' + onlyInReparto + ' casos.');
  lines.push('- Cliente solo en snapshot: ' + onlyInSnapshot + ' casos.');
  lines.push('');
  lines.push('## Tabla detallada (top 50)');
  lines.push('');
  if (differences.length === 0) {
    lines.push('_Sin diferencias detectadas._');
  } else {
    lines.push(
      '| SKU | Cliente | CardCode | qty_reparto | qty_snapshot | delta | explicación | reparto_id |'
    );
    lines.push(
      '|---|---|---|---:|---:|---:|---|---|'
    );
    for (const d of differences.slice(0, 50)) {
      lines.push(
        '| ' +
          [
            escapeMd(d.sku),
            escapeMd(d.cliente),
            escapeMd(d.cardCode),
            fmtNum(d.qty_reparto),
            fmtNum(d.qty_snapshot),
            fmtNum(d.delta),
            escapeMd(d.explicacion),
            escapeMd(d.repartoIds.join(', ')),
          ].join(' | ') +
          ' |'
      );
    }
    if (differences.length > 50) {
      lines.push('');
      lines.push('_Mostradas 50 / ' + differences.length + '. Las restantes siguen el mismo patrón._');
    }
  }

  lines.push('');
  lines.push('## Caso ejemplo ' + exampleSku);
  lines.push('');
  if (exampleBucket) {
    lines.push('**Reparto side** (' + exampleBucket.repartoIds.size + ' reparto(s) activo(s) con este SKU):');
    lines.push('');
    const grouped = new Map();
    for (const e of exampleBucket.entries) {
      const prev = grouped.get(e.cardCode);
      if (prev) prev.qty += e.qty;
      else grouped.set(e.cardCode, { qty: e.qty, name: e.clientName });
    }
    const totR = Array.from(grouped.values()).reduce((s, v) => s + v.qty, 0);
    lines.push('| CardCode | Cliente | qty_reparto |');
    lines.push('|---|---|---:|');
    for (const [card, v] of grouped) {
      lines.push('| ' + escapeMd(card) + ' | ' + escapeMd(v.name) + ' | ' + fmtNum(v.qty) + ' |');
    }
    lines.push('| **TOTAL** | | **' + fmtNum(totR) + '** |');
    lines.push('');
  } else {
    lines.push(
      '`' + exampleSku + '` no tiene reparto activo en este momento.'
    );
    if (fallbackSku) {
      lines.push('');
      lines.push('Sustituto para ilustrar (SKU con la mayor diferencia): `' + fallbackSku + '`.');
    }
    lines.push('');
  }

  lines.push('**Snapshot side** (`backorderApp.byClient` para `' + exampleSku + '`):');
  lines.push('');
  if (exampleDetail && exampleDetail.porCliente) {
    const perClient = exampleDetail.porCliente;
    const entries = Object.entries(perClient);
    if (entries.length === 0) {
      lines.push('_Sin entradas en `porCliente`._');
    } else {
      lines.push('| CardCode | qty_snapshot |');
      lines.push('|---|---:|');
      for (const [card, qty] of entries) {
        lines.push('| ' + escapeMd(card) + ' | ' + fmtNum(qty) + ' |');
      }
      lines.push(
        '| **TOTAL (snapshot.total)** | **' + fmtNum(exampleDetail.total || 0) + '** |'
      );
    }
  } else {
    lines.push('_No existe `backorderBySkuDetail["' + exampleSku + '"].porCliente` en el snapshot._');
  }
  lines.push('');

  if (exampleDiffs.length > 0) {
    lines.push('**Diferencias para ' + exampleSku + '**:');
    lines.push('');
    lines.push('| CardCode | Cliente | qty_reparto | qty_snapshot | delta | explicación |');
    lines.push('|---|---|---:|---:|---:|---|');
    for (const d of exampleDiffs) {
      lines.push(
        '| ' +
          [
            escapeMd(d.cardCode),
            escapeMd(d.cliente),
            fmtNum(d.qty_reparto),
            fmtNum(d.qty_snapshot),
            fmtNum(d.delta),
            escapeMd(d.explicacion),
          ].join(' | ') +
          ' |'
      );
    }
  } else if (exampleBucket) {
    lines.push('_Sin diferencias para ' + exampleSku + ' (reparto y snapshot cuadran por cliente)._');
  }
  lines.push('');

  // Final.
  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, lines.join('\n'), 'utf8');
  console.log('[PR2 dryrun] OK. Output:', OUTPUT_PATH);
  console.log('  repartos_activos=' + repartoDocs.length);
  console.log('  skus_en_repartos=' + skuToRepartoClientes.size);
  console.log('  differences_total=' + differences.length);
  console.log('    qty_different=' + qtyDifferent);
  console.log('    only_in_reparto=' + onlyInReparto);
  console.log('    only_in_snapshot=' + onlyInSnapshot);
}

main().catch((e) => {
  console.error('[PR2 dryrun] ERR', e && e.stack ? e.stack : e);
  process.exit(1);
});
