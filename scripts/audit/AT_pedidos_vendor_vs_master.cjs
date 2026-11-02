// AT — READ-ONLY prod: compara el vendedor de cada pedido (assignedVendorUid /
// vendorAssigned) contra el vendedor ACTUAL del master de su cliente.
//
// Auditoría docs/auditoria/46_EXPORTS_SEGMENTACION_VENDEDOR.md, Etapa 0.
// Sirve para medir cuántos pedidos ve hoy cada vendedor que NO son de sus
// clientes (assignedVendorUid desactualizado) y cuántos de sus clientes NO ve.
//
// Este script NO escribe nada (no hay --apply). Solo lee: pedidos, ocrd,
// vendor_overrides, client_applications, roles.
//
// Cadena del master (misma que scripts/audit/Q_vendedor_desalineado.cjs, §46/§50):
//   1. ocrd (CardCode) → SlpName, con vendor_overrides SHOP > LOC > PROV.
//   2. Si no hay: client_applications.assignedVendor (por cardCodeSap, después
//      por comercio/fantasia).
//   3. vendorKey → UID por la colección roles (vendedor > interno > gerente > admin).
//
// Alcance de pedidos: abiertos (closedAt vacío) + cerrados creados desde la
// fecha de corte (por defecto, últimos 90 días; o --desde=YYYY-MM-DD).
//
// Uso:
//   node scripts/audit/AT_pedidos_vendor_vs_master.cjs
//   node scripts/audit/AT_pedidos_vendor_vs_master.cjs --vendor=PACHI
//   node scripts/audit/AT_pedidos_vendor_vs_master.cjs --desde=2026-08-01 --limit=200
//
// Salida:
//   - Tabla por vendedor: pedidos que ve hoy (assignedVendorUid = su usuario),
//     pedidos ajenos que ve (el master dice otro vendedor), pedidos propios
//     que no ve (el master dice él pero el UID es de otro) y pedidos sin master.
//   - Detalle de los pedidos desalineados (máximo --limit, por defecto 50).
//
// Usuarios con el mismo vendorKey que no son el usuario principal de ese
// vendor (ej. cuenta de pruebas) se listan aparte como "VENDOR [uid]".

const PROJECT = 'app-vendedores-shimano';
const DAY_MS = 86400000;

function normCardCode(cc) {
  return String(cc || '')
    .trim()
    .toUpperCase();
}
function normKey(k) {
  return String(k || '')
    .trim()
    .toUpperCase();
}

/** Fecha de Firestore (string ISO, Timestamp, {seconds}, Date, número) → ms o null. */
function parseDateMs(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const t = Date.parse(v);
    return Number.isNaN(t) ? null : t;
  }
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.getTime();
  if (typeof v.toDate === 'function') {
    try {
      const d = v.toDate();
      return d && !Number.isNaN(d.getTime()) ? d.getTime() : null;
    } catch (_e) {
      return null;
    }
  }
  if (typeof v.seconds === 'number') return v.seconds * 1000;
  if (typeof v._seconds === 'number') return v._seconds * 1000;
  return null;
}

/** Abierto, o creado desde el corte. */
function pedidoInScope(p, cutoffMs) {
  if (!p) return false;
  if (!p.closedAt) return true;
  const t = parseDateMs(p.createdAt);
  return t != null && t >= cutoffMs;
}

/**
 * roles docs [{id, role, vendor, email}] → Map vendorKey → {uid, email, role, vendorKey}.
 * Precedencia: vendedor > interno > gerente > admin > otros (igual que Q).
 */
function buildVendorKeyToUser(roleDocs) {
  const rank = { vendedor: 4, interno: 3, gerente: 2, admin: 1 };
  const map = new Map();
  for (const d of roleDocs || []) {
    const vendorKey = String((d && d.vendor) || '').trim();
    if (!vendorKey) continue;
    const role = String(d.role || '').trim();
    const prev = map.get(vendorKey);
    const cur = rank[role] || 0;
    const prevRank = prev ? rank[prev.role] || 0 : -1;
    if (!prev || cur > prevRank) {
      map.set(vendorKey, { uid: d.id, email: d.email || '', role, vendorKey });
    }
  }
  return map;
}

/**
 * Arma el resolver del master. Docs: ocrd [{id, CardCode, CardName, SlpName,
 * Provincia|State, Localidad|City}], overrides [{id, newVendor|vendor}],
 * altas [{cardCodeSap, comercio, fantasia, assignedVendor}].
 * Devuelve (cardCode, clientName) → {vendorKey, uid, email, reason, source}.
 */
function buildMasterResolver({ ocrd, overrides, altas, vendorKeyToUser }) {
  const ocrdMap = new Map();
  for (const d of ocrd || []) {
    const cardCode = normCardCode(d.CardCode || d.id);
    if (!cardCode) continue;
    ocrdMap.set(cardCode, {
      cardName: String(d.CardName || '').trim(),
      slpName: String(d.SlpName || '').trim(),
      provincia: String(d.Provincia || d.State || d.State1 || '').trim(),
      localidad: String(d.Localidad || d.City || '').trim(),
    });
  }
  const ov = new Map();
  for (const d of overrides || []) {
    const v = String(d.newVendor || d.vendor || '').trim();
    if (v && d.id) ov.set(d.id, v);
  }
  const altasByCc = new Map();
  const altasList = [];
  for (const a of altas || []) {
    const cc = normCardCode(a.cardCodeSap);
    const item = {
      cardCodeSap: cc,
      comercio: String(a.comercio || '').trim(),
      fantasia: String(a.fantasia || '').trim(),
      assignedVendor: String(a.assignedVendor || '').trim(),
    };
    if (cc) altasByCc.set(cc, item);
    if (item.comercio || item.fantasia) altasList.push(item);
  }
  const users = vendorKeyToUser || new Map();

  function findUser(vendorKey) {
    let u = users.get(vendorKey);
    if (u) return u;
    for (const [k, x] of users) if (k.toLowerCase() === vendorKey.toLowerCase()) return x;
    const first = vendorKey.split(/\s+/)[0].toUpperCase();
    if (first && first.length >= 3) {
      for (const [k, x] of users) {
        const ku = k.toUpperCase();
        if (ku === first || ku.startsWith(first + ' ')) return x;
      }
    }
    return null;
  }

  return function resolve(cardCode, clientName) {
    const cc = normCardCode(cardCode);
    const name = String(clientName || '').trim();
    const empty = { vendorKey: '', uid: '', email: '', source: '' };
    if (!cc && !name) return { ...empty, reason: 'input_vacio' };
    const m = cc ? ocrdMap.get(cc) : null;
    let vendorKey = '';
    let source = '';
    if (m) {
      const nameUp = (m.cardName || name || '').trim();
      const shopKey = 'SHOP|' + m.provincia + '|' + m.localidad + '|' + nameUp;
      const locKey = 'LOC|' + m.provincia + '|' + m.localidad;
      const provKey = 'PROV|' + m.provincia;
      if (ov.has(shopKey)) vendorKey = ov.get(shopKey);
      else if (ov.has(locKey)) vendorKey = ov.get(locKey);
      else if (ov.has(provKey)) vendorKey = ov.get(provKey);
      else vendorKey = m.slpName;
      source = vendorKey ? 'ocrd' : '';
    }
    if (!vendorKey && cc && altasByCc.has(cc) && altasByCc.get(cc).assignedVendor) {
      vendorKey = altasByCc.get(cc).assignedVendor;
      source = 'approvedAlta';
    }
    if (!vendorKey && name) {
      const t = name.toLowerCase();
      const a = altasList.find(
        (x) => x.comercio.toLowerCase() === t || x.fantasia.toLowerCase() === t
      );
      if (a && a.assignedVendor) {
        vendorKey = a.assignedVendor;
        source = 'approvedAlta';
      }
    }
    if (vendorKey) {
      const lm = vendorKey.match(/^Z\d+\s*[-–—]\s*(.+)$/i);
      if (lm) vendorKey = lm[1].trim().toUpperCase();
    }
    if (vendorKey === '__DISTRIBUTOR__') vendorKey = '';
    if (!m && !source) return { ...empty, reason: 'cliente_no_en_master' };
    if (!vendorKey) return { ...empty, source, reason: 'zona_sin_vendedor' };
    const u = findUser(vendorKey);
    if (!u) return { vendorKey, uid: '', email: '', source, reason: 'vendor_sin_uid' };
    return { vendorKey, uid: u.uid, email: u.email, source, reason: 'ok' };
  };
}

/**
 * Compara un pedido contra el master.
 * ctx: { uidToVendorKey: Map uid → vendorKey, vendorKeyToUser: Map }.
 * estado:
 *   - alineado: el UID del pedido es el del vendedor del master.
 *   - ajeno_visible: el UID del pedido es de un vendedor distinto al del master
 *     (ese vendedor lo ve y no es su cliente; el del master no lo ve).
 *   - uid_distinto: mismo vendorKey pero otro usuario (ej. cuenta de pruebas).
 *   - sin_master: el master no resuelve vendedor para el cliente.
 */
function classifyPedido(p, resolve, ctx) {
  const uidToVendorKey = (ctx && ctx.uidToVendorKey) || new Map();
  const users = (ctx && ctx.vendorKeyToUser) || new Map();
  const cardCode = normCardCode(p.clientCardCode || p.cardCode || '');
  const clientName = String(p.clientName || '').trim();
  const r = resolve(cardCode, clientName);
  const assignedVendorUid = String(p.assignedVendorUid || '').trim();
  const assignedKey = normKey(
    (assignedVendorUid && uidToVendorKey.get(assignedVendorUid)) || p.vendorAssigned || ''
  );
  // Etiqueta del "usuario que lo ve": vendorKey si es el usuario principal de
  // ese vendor; si no, "VENDOR [uid]".
  let assignedLabel = assignedKey || (assignedVendorUid ? '[' + assignedVendorUid + ']' : '');
  if (assignedKey && assignedVendorUid) {
    let principal = null;
    for (const [k, u] of users) if (normKey(k) === assignedKey) principal = u;
    if (principal && principal.uid !== assignedVendorUid) {
      assignedLabel = assignedKey + ' [' + assignedVendorUid + ']';
    }
  }
  const masterKey = normKey(r.vendorKey);
  let estado;
  if (!masterKey) estado = 'sin_master';
  else if (r.uid && assignedVendorUid === r.uid) estado = 'alineado';
  else if (!r.uid && assignedKey === masterKey) estado = 'alineado';
  else if (assignedKey === masterKey) estado = 'uid_distinto';
  else estado = 'ajeno_visible';
  return {
    pedidoId: p._id || p._fsId || p.id || '',
    orderNumber: p.orderNumber != null ? p.orderNumber : '',
    cardCode,
    clientName,
    closed: !!p.closedAt,
    createdAt: p.createdAt || '',
    assignedVendorUid,
    assignedKey,
    assignedLabel,
    vendorAssigned: String(p.vendorAssigned || '').trim(),
    ownerVendor: String(p.ownerVendor || '').trim(),
    masterKey,
    masterUid: r.uid || '',
    masterReason: r.reason,
    masterSource: r.source || '',
    estado,
  };
}

/** Totales por vendedor. */
function aggregateByVendor(rows) {
  const out = {};
  const get = (k) => {
    if (!out[k]) out[k] = { veHoy: 0, ajenosQueVe: 0, propiosQueNoVe: 0, sinMaster: 0 };
    return out[k];
  };
  for (const r of rows) {
    if (r.assignedLabel) {
      const a = get(r.assignedLabel);
      a.veHoy++;
      if (r.estado === 'sin_master') a.sinMaster++;
      if (r.estado === 'ajeno_visible') a.ajenosQueVe++;
    }
    if (r.masterKey && (r.estado === 'ajeno_visible' || r.estado === 'uid_distinto')) {
      get(r.masterKey).propiosQueNoVe++;
    }
  }
  return out;
}

/** Filas donde el vendedor es el asignado o el del master. */
function filterRowsByVendor(rows, vendor) {
  const v = normKey(vendor);
  if (!v) return rows;
  return rows.filter((r) => r.assignedKey === v || r.masterKey === v);
}

function parseArgs(argv) {
  const get = (name) => {
    const a = argv.find((x) => x.startsWith('--' + name + '='));
    return a ? a.slice(name.length + 3) : '';
  };
  const limitRaw = parseInt(get('limit'), 10);
  return {
    desde: get('desde'),
    vendor: get('vendor'),
    limit: Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 50,
  };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (process.argv.includes('--apply')) {
    console.error('Este script es solo lectura: no existe --apply.');
    process.exit(2);
  }
  let cutoffMs = Date.now() - 90 * DAY_MS;
  if (opts.desde) {
    const t = Date.parse(opts.desde + 'T00:00:00-03:00');
    if (Number.isNaN(t)) {
      console.error('Fecha --desde inválida (formato YYYY-MM-DD):', opts.desde);
      process.exit(2);
    }
    cutoffMs = t;
  }

  const admin = require('../../functions/node_modules/firebase-admin');
  if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT });
  const db = admin.firestore();

  console.log('================================================================');
  console.log('AT — pedidos vs vendedor del master @ ' + new Date().toISOString());
  console.log('Solo lectura. Corte cerrados:', new Date(cutoffMs).toISOString());
  if (opts.vendor) console.log('Filtro vendedor:', opts.vendor);
  console.log('================================================================');

  const toDocs = (snap) => {
    const arr = [];
    snap.forEach((d) => arr.push(Object.assign({ id: d.id }, d.data() || {})));
    return arr;
  };
  const [ocrdS, ovS, altasS, rolesS, pedS] = await Promise.all([
    db.collection('ocrd').get(),
    db.collection('vendor_overrides').get(),
    db.collection('client_applications').get(),
    db.collection('roles').get(),
    db.collection('pedidos').get(),
  ]);
  const roleDocs = toDocs(rolesS);
  const vendorKeyToUser = buildVendorKeyToUser(roleDocs);
  const uidToVendorKey = new Map(
    roleDocs.filter((d) => d.vendor).map((d) => [d.id, String(d.vendor).trim()])
  );
  const resolve = buildMasterResolver({
    ocrd: toDocs(ocrdS),
    overrides: toDocs(ovS),
    altas: toDocs(altasS),
    vendorKeyToUser,
  });

  const pedidos = toDocs(pedS)
    .map((p) => Object.assign(p, { _id: p.id }))
    .filter((p) => pedidoInScope(p, cutoffMs));
  let rows = pedidos.map((p) => classifyPedido(p, resolve, { uidToVendorKey, vendorKeyToUser }));
  rows = filterRowsByVendor(rows, opts.vendor);

  console.log('Pedidos en alcance:', rows.length);
  const agg = aggregateByVendor(rows);
  console.log();
  console.log('Por vendedor:');
  console.table(
    Object.keys(agg)
      .sort()
      .map((k) => ({
        vendedor: k,
        've hoy': agg[k].veHoy,
        'ajenos que ve': agg[k].ajenosQueVe,
        'propios que no ve': agg[k].propiosQueNoVe,
        'sin master': agg[k].sinMaster,
      }))
  );

  const desal = rows.filter((r) => r.estado !== 'alineado');
  const porEstado = {};
  for (const r of rows) porEstado[r.estado] = (porEstado[r.estado] || 0) + 1;
  console.log('Por estado:', porEstado);
  console.log();
  console.log('Detalle desalineados (' + Math.min(desal.length, opts.limit) + ' de ' + desal.length + '):');
  console.table(
    desal.slice(0, opts.limit).map((r) => ({
      pedido: r.pedidoId,
      orden: r.orderNumber,
      cardCode: r.cardCode,
      cliente: r.clientName.slice(0, 30),
      cerrado: r.closed ? 'SI' : 'NO',
      'lo ve': r.assignedLabel,
      master: r.masterKey || '(' + r.masterReason + ')',
      estado: r.estado,
    }))
  );
}

module.exports = {
  parseDateMs,
  pedidoInScope,
  buildVendorKeyToUser,
  buildMasterResolver,
  classifyPedido,
  aggregateByVendor,
  filterRowsByVendor,
  parseArgs,
};

if (require.main === module) {
  main().catch((e) => {
    console.error('FAIL', e && e.stack ? e.stack : e);
    process.exit(1);
  });
}
