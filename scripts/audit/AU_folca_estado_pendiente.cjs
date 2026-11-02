// AU — READ-ONLY prod: APP-05, por qué FOLCA S.R.L. aparece "Pendiente".
//
// Informe: docs/auditoria/48_FOLCA_ESTADO_PENDIENTE.md.
//
// Este script NO escribe nada (no hay --apply). Solo lee:
//   client_applications, client_master, userData, sap_clients.
//
// Muestra:
//   1. Todos los docs de client_applications de FOLCA (por CardCode o nombre),
//      con los campos que deciden cada "pendiente" de la app.
//   2. Docs de client_master y sap_clients que lo mencionan.
//   3. Si algún usuario lo marcó Habilitado/Cancelado (userData.contacted /
//      canceled) o le cargó datos (clientMeta).
//   4. Comparación por división (sapDivision) de todas las altas SAP:
//      cuántas quedan "pendientes" por cada motivo, y CardCodes duplicados.
//   5. Ejemplos de clientes División 3 de la misma provincia sin ningún
//      motivo de "pendiente".
//
// Uso:
//   node scripts/audit/AU_folca_estado_pendiente.cjs
//   node scripts/audit/AU_folca_estado_pendiente.cjs --cardcode=C30710893981 --nombre=FOLCA

const PROJECT = 'app-vendedores-shimano';

function arg(name, def) {
  const a = process.argv.find((x) => x.startsWith('--' + name + '='));
  return a ? a.slice(name.length + 3) : def;
}
const CARD = String(arg('cardcode', 'C30710893981')).trim().toUpperCase();
const NAME = String(arg('nombre', 'FOLCA')).trim().toUpperCase();

const HEAVY = new Set(['constanciaArca', 'constanciaIIBB', 'fotosLocal']);

function fmt(v) {
  if (v == null) return v;
  if (typeof v.toDate === 'function') {
    try {
      return v.toDate().toISOString();
    } catch (_e) {
      return String(v);
    }
  }
  if (v && typeof v === 'object' && typeof v.seconds === 'number')
    return new Date(v.seconds * 1000).toISOString();
  return v;
}

function cleanDoc(d) {
  const out = {};
  for (const k of Object.keys(d).sort()) {
    if (HEAVY.has(k)) {
      const v = d[k];
      out[k] = Array.isArray(v) ? '[' + v.length + ' item(s)]' : v ? '[presente]' : v;
      continue;
    }
    const v = d[k];
    if (v && typeof v === 'object' && !Array.isArray(v) && typeof v.toDate !== 'function' && typeof v.seconds !== 'number') {
      const o = {};
      for (const kk of Object.keys(v)) o[kk] = fmt(v[kk]);
      out[k] = o;
    } else out[k] = fmt(v);
  }
  return out;
}

/** Motivos por los que la app puede mostrar un alta SAP como "pendiente". */
function pendingReasons(a) {
  const r = [];
  if (a.status === 'pending_approval') r.push('alta_sin_aprobar (status=pending_approval)');
  if (a.status === 'rejected') r.push('alta_rechazada');
  if (!a.cardCodeSap) r.push(a.manualSapPending ? 'provisorio_sin_cardcode' : 'sin_cardcode');
  if (!(a.lat != null && a.lng != null)) r.push('sin_geolocalizar (lat/lng)');
  if (!(a.calle || a.address)) r.push('sin_direccion (calle/address)');
  if (!String(a.assignedVendor || '').trim()) r.push('sin_vendedor (assignedVendor)');
  if (!String(a.provincia || '').trim()) r.push('sin_provincia');
  if (a.sapValid === false) r.push('inactivo_en_sap (sapValid=false)');
  if (a.sapFrozen === true) r.push('bloqueado_en_sap (sapFrozen=true)');
  return r;
}

function isFolca(a, id) {
  const cc = String(a.cardCodeSap || '').toUpperCase();
  if (cc && cc === CARD) return true;
  const hay = [a.comercio, a.fantasia, a.titular].map((x) => String(x || '').toUpperCase()).join(' | ');
  return hay.includes(NAME) || String(id).toUpperCase().includes(NAME);
}

async function main() {
  const admin = require('../../functions/node_modules/firebase-admin');
  if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT });
  const db = admin.firestore();

  console.log('=== AU — FOLCA (' + CARD + ' / "' + NAME + '") — solo lectura ===\n');

  // 1. client_applications
  const caSnap = await db.collection('client_applications').get();
  const all = [];
  caSnap.forEach((d) => all.push(Object.assign({ _id: d.id }, d.data())));
  const folca = all.filter((a) => isFolca(a, a._id));
  console.log('## 1. client_applications de FOLCA: ' + folca.length + ' doc(s)\n');
  for (const a of folca) {
    console.log('--- doc ' + a._id);
    console.log(JSON.stringify(cleanDoc(a), null, 2));
    console.log('Motivos de "pendiente": ' + (pendingReasons(a).join(', ') || 'ninguno'));
    console.log('');
  }

  // 2. client_master + sap_clients
  const cmSnap = await db.collection('client_master').get();
  const cms = [];
  cmSnap.forEach((d) => {
    const x = d.data() || {};
    const hay = [d.id, x.clientName, x.clientNameOriginal, x.sapCardCode].map((v) => String(v || '').toUpperCase()).join(' | ');
    if (hay.includes(NAME) || hay.includes(CARD)) cms.push(Object.assign({ _id: d.id }, x));
  });
  console.log('## 2a. client_master: ' + cms.length + ' doc(s)');
  for (const c of cms) console.log(JSON.stringify(cleanDoc(c), null, 2));
  const scSnap = await db.collection('sap_clients').get();
  const scs = [];
  scSnap.forEach((d) => {
    const x = d.data() || {};
    const hay = [d.id, x.name, x.sapCode].map((v) => String(v || '').toUpperCase()).join(' | ');
    if (hay.includes(NAME) || hay.includes(CARD)) scs.push(Object.assign({ _id: d.id }, x));
  });
  console.log('\n## 2b. sap_clients (mapeo nombre→código): ' + scs.length + ' doc(s)');
  for (const s of scs) console.log(JSON.stringify(cleanDoc(s)));

  // 3. userData: marcas Habilitado/Cancelado y clientMeta
  const udSnap = await db.collection('userData').get();
  console.log('\n## 3. userData (marcas por usuario)');
  let marks = 0;
  udSnap.forEach((d) => {
    const x = d.data() || {};
    const who = x.email || d.id;
    const hit = (k) => String(k).toUpperCase().includes(NAME) || String(k).toUpperCase().includes(CARD);
    (x.contacted || []).filter(hit).forEach((k) => { marks++; console.log('  HABILITADO por ' + who + ': ' + k); });
    (x.canceled || []).filter(hit).forEach((k) => { marks++; console.log('  CANCELADO por ' + who + ': ' + k); });
    Object.keys(x.clientMeta || {}).filter(hit).forEach((k) => {
      marks++;
      console.log('  clientMeta de ' + who + ' [' + k + ']: ' + JSON.stringify(cleanDoc(x.clientMeta[k])));
    });
  });
  if (!marks) console.log('  (ningún usuario lo marcó ni le cargó datos)');

  // 4. Comparación por división
  const sap = all.filter((a) => a.cardCodeSap || a.manualSapPending);
  const byDiv = new Map();
  for (const a of sap) {
    const div = String(a.sapDivision || '(vacía)').trim() || '(vacía)';
    if (!byDiv.has(div)) byDiv.set(div, { total: 0, sinMotivo: 0, motivos: {} });
    const g = byDiv.get(div);
    g.total++;
    const rs = pendingReasons(a);
    if (!rs.length) g.sinMotivo++;
    for (const r of rs) {
      const key = r.split(' ')[0];
      g.motivos[key] = (g.motivos[key] || 0) + 1;
    }
  }
  console.log('\n## 4. Altas SAP por división (sapDivision) y motivos de "pendiente"');
  for (const [div, g] of [...byDiv.entries()].sort()) {
    console.log('  División ' + div + ': ' + g.total + ' altas, ' + g.sinMotivo + ' sin ningún motivo');
    for (const [m, n] of Object.entries(g.motivos).sort((x, y) => y[1] - x[1]))
      console.log('      ' + m + ': ' + n + ' (' + ((n / g.total) * 100).toFixed(1) + '%)');
  }
  const byCard = new Map();
  for (const a of all) {
    const cc = String(a.cardCodeSap || '').toUpperCase();
    if (!cc) continue;
    if (!byCard.has(cc)) byCard.set(cc, []);
    byCard.get(cc).push(a);
  }
  const dups = [...byCard.entries()].filter(([, l]) => l.length > 1);
  console.log('\n  CardCodes con más de un doc en client_applications: ' + dups.length);
  for (const [cc, l] of dups)
    console.log('    ' + cc + ' → ' + l.map((a) => a._id + ' (' + (a.comercio || a.fantasia || '?') + ', vend=' + (a.assignedVendor || '-') + ', div=' + (a.sapDivision || '-') + ', status=' + (a.status || '-') + ')').join(' | '));

  // 5. Ejemplos sanos de la misma división y provincia
  const ref = folca.find((a) => a.cardCodeSap) || folca[0];
  if (ref) {
    const div = String(ref.sapDivision || '').trim();
    const prov = String(ref.provincia || '').toUpperCase().trim();
    const ok = sap
      .filter((a) => String(a.sapDivision || '').trim() === div && String(a.provincia || '').toUpperCase().trim() === prov && !isFolca(a, a._id) && !pendingReasons(a).length)
      .slice(0, 5);
    console.log('\n## 5. Clientes División ' + (div || '(vacía)') + ' en ' + (prov || '(sin provincia)') + ' sin ningún motivo de "pendiente" (hasta 5)');
    for (const a of ok)
      console.log('  ' + a._id + ' | ' + a.cardCodeSap + ' | ' + (a.comercio || '') + ' | ' + (a.localidadFinal || a.localidad || '') + ' | vend=' + (a.assignedVendor || '-') + ' | status=' + (a.status || '-') + ' | geo=' + (a.lat != null) + ' | dir=' + !!(a.calle || a.address));
    if (!ok.length) console.log('  (ninguno)');
  }
  console.log('\n=== fin (no se escribió nada) ===');
}

main().catch((e) => {
  console.error('ERROR', e);
  process.exit(1);
});
