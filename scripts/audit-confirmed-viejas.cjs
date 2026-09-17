/**
 * audit-confirmed-viejas.cjs
 *
 * Escanea pedidos abiertos con lineas state='confirmed' + qtyOpen>0. Agrupa
 * por antiguedad desde confirmedAt y por cliTipo del cliente. Muestra:
 *   - Cuantas lineas hay en cada bucket de edad
 *   - Monto ARS bloqueado (qtyOpen * precio)
 *   - Distribucion por cliTipo
 *   - Top 10 clientes con mas u bloqueadas
 *   - Top 10 pedidos individuales mas viejos
 *
 * Uso: node scripts/audit-confirmed-viejas.cjs
 */

const path = require('path');
const os = require('os');
const admin = require('../functions/node_modules/firebase-admin');

const SA_KEY = path.join(os.homedir(), 'Downloads', 'app-vendedores-shimano-firebase-adminsdk-fbsvc-71fc15072e.json');
admin.initializeApp({ credential: admin.credential.cert(require(SA_KEY)) });
const db = admin.firestore();

const DAY_MS = 24 * 60 * 60 * 1000;

function computeClientLocId(prov, locName, tienda) {
  const norm = (s) =>
    String(s || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '');
  return norm(prov) + '__' + norm(locName) + '__' + norm(tienda);
}

async function main() {
  const now = Date.now();
  const pedidosSnap = await db.collection('pedidos').where('closedAt', '==', null).get();
  console.log(`===== AUDIT confirmed viejas =====\n`);
  console.log(`Pedidos abiertos: ${pedidosSnap.size}\n`);

  const buckets = {
    lt15: { count: 0, u: 0, ars: 0 },
    d15_30: { count: 0, u: 0, ars: 0 },
    d30_60: { count: 0, u: 0, ars: 0 },
    gt60: { count: 0, u: 0, ars: 0 },
  };
  const byTipo = { P: 0, A: 0, B: 0, C: 0, unknown: 0 };
  const byClient = {}; // clientName -> u bloqueadas
  const oldest = []; // { pedidoId, clientName, sku, u, ageDays, ars, cliTipo }
  let totalLines = 0;
  let totalUnits = 0;
  let totalArs = 0;

  const cliTipoCache = new Map();
  async function getCliTipo(prov, loc, name) {
    const docId = computeClientLocId(prov, loc, name);
    if (cliTipoCache.has(docId)) return cliTipoCache.get(docId);
    try {
      const snap = await db.collection('client_master').doc(docId).get();
      const raw = snap.exists ? (snap.data() || {}).cliTipo : null;
      const s = String(raw || '').trim().toUpperCase();
      const tipo = ['P', 'A', 'B', 'C'].includes(s) ? s : null;
      cliTipoCache.set(docId, tipo);
      return tipo;
    } catch {
      cliTipoCache.set(docId, null);
      return null;
    }
  }

  for (const doc of pedidosSnap.docs) {
    const data = doc.data() || {};
    const lines = Array.isArray(data.lines) ? data.lines : [];
    let cliTipo = null;
    let cliTipoResolved = false;
    for (const l of lines) {
      if (!l || l.state !== 'confirmed') continue;
      const qtyOpen = Number(l.qtyOpen) || 0;
      if (qtyOpen <= 0) continue;
      totalLines++;
      totalUnits += qtyOpen;
      const precio = Number(l.priceAtCreation || l.precio || 0);
      const ars = qtyOpen * precio;
      totalArs += ars;

      // Edad desde confirmedAt (fallback createdAt)
      let ts = 0;
      const ref = data.confirmedAt || data.createdAt;
      if (ref) {
        if (typeof ref.toMillis === 'function') ts = ref.toMillis();
        else if (typeof ref === 'string') ts = new Date(ref).getTime() || 0;
      }
      const ageDays = ts ? Math.floor((now - ts) / DAY_MS) : 999;

      let b;
      if (ageDays < 15) b = 'lt15';
      else if (ageDays < 30) b = 'd15_30';
      else if (ageDays < 60) b = 'd30_60';
      else b = 'gt60';
      buckets[b].count++;
      buckets[b].u += qtyOpen;
      buckets[b].ars += ars;

      // cliTipo (una vez por pedido)
      if (!cliTipoResolved) {
        cliTipo = await getCliTipo(
          data.province || data.clientProvince || '',
          data.locName || data.clientLocality || '',
          data.clientName || ''
        );
        cliTipoResolved = true;
      }
      const tipoKey = cliTipo || 'unknown';
      byTipo[tipoKey] = (byTipo[tipoKey] || 0) + qtyOpen;

      const name = data.clientName || '(sin cliente)';
      byClient[name] = (byClient[name] || 0) + qtyOpen;

      // Guardar los mas viejos
      if (ageDays >= 15) {
        oldest.push({
          pedidoId: doc.id,
          clientName: name,
          sku: l.code,
          u: qtyOpen,
          ageDays,
          ars,
          cliTipo,
          orderNumber: data.orderNumber || null,
          confirmedAt: ref ? new Date(ts).toISOString().slice(0, 10) : '?',
          sapDocNum: (data.transferidoSAP && data.transferidoSAP.docNum) || null,
        });
      }
    }
  }

  const fmt = (n) => Math.round(n).toLocaleString('es-AR');

  console.log(`Total lineas confirmed abiertas: ${totalLines}`);
  console.log(`Total unidades bloqueadas:       ${totalUnits}`);
  console.log(`Total ARS bloqueado:             $${fmt(totalArs)}\n`);

  console.log('=== Distribucion por edad ===');
  console.log(`  < 15 dias:   ${buckets.lt15.count} lineas · ${buckets.lt15.u} u · $${fmt(buckets.lt15.ars)}`);
  console.log(`  15-30 dias:  ${buckets.d15_30.count} lineas · ${buckets.d15_30.u} u · $${fmt(buckets.d15_30.ars)}  ← candidatas a expirar`);
  console.log(`  30-60 dias:  ${buckets.d30_60.count} lineas · ${buckets.d30_60.u} u · $${fmt(buckets.d30_60.ars)}  ← claramente para revisar`);
  console.log(`  > 60 dias:   ${buckets.gt60.count} lineas · ${buckets.gt60.u} u · $${fmt(buckets.gt60.ars)}  ← problematicas / probablemente cancelar`);

  const expirable = buckets.d15_30.u + buckets.d30_60.u + buckets.gt60.u;
  const expirableArs = buckets.d15_30.ars + buckets.d30_60.ars + buckets.gt60.ars;
  console.log(`\n>>> Si aplicaramos regla 15d: ${expirable} u ($${fmt(expirableArs)}) dejarian de reservar stock.\n`);

  console.log('=== Distribucion por cliTipo ===');
  const totalTipo = Object.values(byTipo).reduce((s, n) => s + n, 0);
  for (const t of ['P', 'A', 'B', 'C', 'unknown']) {
    const u = byTipo[t] || 0;
    const pct = totalTipo > 0 ? Math.round((u * 100) / totalTipo) : 0;
    console.log(`  ${t.padEnd(8)}: ${u} u (${pct}%)`);
  }
  console.log();

  console.log('=== Top 10 clientes con mas u bloqueadas ===');
  const topClients = Object.entries(byClient).sort((a, b) => b[1] - a[1]).slice(0, 10);
  for (const [name, u] of topClients) {
    console.log(`  ${u.toString().padStart(4)} u  -  ${name}`);
  }
  console.log();

  console.log('=== Top 10 lineas confirmed mas viejas (>15d) ===');
  oldest.sort((a, b) => b.ageDays - a.ageDays);
  for (const o of oldest.slice(0, 10)) {
    const tipoLbl = o.cliTipo ? `[${o.cliTipo}]` : '[?]';
    const ordenLbl = o.orderNumber ? `ORDEN ${o.orderNumber}` : '(sin orden)';
    console.log(`  ${o.ageDays.toString().padStart(3)}d  ${tipoLbl}  ${o.sku.padEnd(20)} ${o.u.toString().padStart(3)}u  $${fmt(o.ars).padStart(10)}  ${ordenLbl}  ${o.clientName}${o.sapDocNum ? ` · SAP ${o.sapDocNum}` : ''}`);
  }
  console.log();
}

main().catch((e) => { console.error('ERROR:', e); process.exit(1); });
