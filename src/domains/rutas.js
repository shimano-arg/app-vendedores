// @ts-nocheck
// Globals leídos del entorno (declarados en index.html inline o bundle previo):
// fbDb, firebase, currentUser, userRole, POINTS, VENDORS, MESES, PRODUCTS,
// assignedVendor, currentVendor, visitsCache, visitsCachePartner,
// clientLocsCache, clientMasterCache, escapeHtml, escapeAttr, titleCase, logOp,
// showSyncTag, openVisitaModal, openPedidoModal, myExternalPartners,
// getActingVendorPartner, myInternalPartnerUid, myWhatsappNumber,
// routeOverrides, unsubVisits, _fsRegistry, viewVisit.
// Módulo extraído verbatim (~1,394 LOC): tipado real fuera de scope E2.f.
//
// RUTAS: agrupamiento de tiendas por proximidad (10-15 por ruta).
// Extraído verbatim de index.html (líneas 12049-13442 pre-E2.f) como parte
// de E2.f (e2b-perf 2026-07-28). Preserva 100% comportamiento.
//
// Cross-scope state (via window):
// - window.rutaDetalleId: leído desde ensureRouteOverridesListener y
//   ensureVisitsPartnerListener (líneas ~13644, ~13694 del inline).
// - window.unsubCustomRoutes: listener con cleanup en detachFirebaseListeners.
// Locals al módulo: rutaView, rutaHistMonth, rutaHistYear, window.rutaVendorFilter,
// _lastRouteStats, rutaMode, myCustomRoutes, _rpmTiendas, constantes RUTA_*.
// ============================================================
// RUTAS: agrupamiento de tiendas por proximidad (10-15 por ruta)
// ============================================================
let rutaView = 'mes'; // 'mes' | 'historico'
if (typeof window.rutaDetalleId === 'undefined') window.rutaDetalleId = null; // id de ruta abierta
let rutaHistMonth = null;
let rutaHistYear = null;
// CROSS-SCOPE (E6 fix C4): inline onTiendaAbiertaNoDerivar + confirmReagendar lee.
if (typeof window.rutaVendorFilter === 'undefined') window.rutaVendorFilter = null;
const RUTA_MIN = 10;
const RUTA_TARGET = 12;
const RUTA_MAX = 15;
// Stats de la ultima ejecucion de generarRutasVendor. Lo lee recalcularRutas
// para mostrar al usuario cuantas rutas se consolidaron (fusionadas con su
// vecina mas cercana) - sirve para entender que paso al agregar tiendas.
let _lastRouteStats = { totalRutas: 0, consolidadas: 0, nuevasTiendasAprox: 0 };

function haversineKm(lat1, lon1, lat2, lon2) {
  if (lat1 == null || lat2 == null || lon1 == null || lon2 == null) return Infinity;
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getHabilesDelMes(monthIdx, year) {
  // Devuelve los dias del mes que son habiles (lunes a viernes), en formato YYYYMMDD
  const out = [];
  const last = new Date(year, monthIdx + 1, 0).getDate();
  for (let d = 1; d <= last; d++) {
    const dt = new Date(year, monthIdx, d);
    const dow = dt.getDay();
    if (dow !== 0 && dow !== 6) {
      out.push(year + String(monthIdx + 1).padStart(2, '0') + String(d).padStart(2, '0'));
    }
  }
  return out;
}

function asignarFechaPorIndice(rutaIdx, totalRutas, monthIdx, year) {
  const habiles = getHabilesDelMes(monthIdx, year);
  if (!habiles.length || totalRutas <= 0) return null;
  if (totalRutas === 1) return habiles[Math.floor(habiles.length / 2)];
  // Distribuye equitativamente los indices entre los habiles
  const idx = Math.min(
    habiles.length - 1,
    Math.round((rutaIdx * (habiles.length - 1)) / Math.max(1, totalRutas - 1))
  );
  return habiles[idx];
}

function getOverridesForContext(vendor, monthIdx, year) {
  return (routeOverrides || []).filter(
    (o) =>
      o.vendor === vendor && o.monthIdx === monthIdx && parseInt(o.anio, 10) === parseInt(year, 10)
  );
}

function fmtFechaCorta(yyyymmdd) {
  if (!yyyymmdd || yyyymmdd.length !== 8) return '';
  const dd = yyyymmdd.slice(6, 8),
    mm = yyyymmdd.slice(4, 6);
  const monthNames = [
    'ene',
    'feb',
    'mar',
    'abr',
    'may',
    'jun',
    'jul',
    'ago',
    'sep',
    'oct',
    'nov',
    'dic',
  ];
  const m = parseInt(mm, 10) - 1;
  return dd + ' ' + (monthNames[m] || mm);
}

function generarRutasVendor(vendor, monthIdx, year) {
  // monthIdx/year son OPCIONALES (para mantener compat con llamadas viejas).
  // Si no se pasan, usa "actual" para asignar fechas.
  if (monthIdx == null || year == null) {
    const cm = getCurrentMonthYear();
    monthIdx = cm.monthIdx;
    year = cm.year;
  }
  // 1. Recolectar localidades del vendedor con tiendas HABILITADAS (= en SAP
  // con cardCodeSap y direccion cargada). El resto queda fuera de la ruta
  // - aparecen en el mapa como pin azul pero no se rutean hasta que SAP
  // tenga la direccion. Pulsar "Recalcular rutas" trae a los nuevos.
  const isSapOk =
    typeof isSapConfirmed === 'function'
      ? (prov, loc, nombre) => isSapConfirmed(prov, loc, nombre)
      : () => true;
  const localidades = [];
  POINTS.forEach((p) => {
    if (!vendor || p.vendor !== vendor) return;
    const allTiendas = [...(p.clients || []), ...(p.prospects || [])];
    if (!allTiendas.length) return;
    const tiendasOk = allTiendas.filter((name) => isSapOk(p.province, p.name, name));
    if (!tiendasOk.length) return;
    localidades.push({
      name: p.name,
      province: p.province,
      lat: p.lat,
      lon: p.lon,
      tiendas: tiendasOk.map((nombre) => ({
        nombre: nombre,
        localidad: p.name,
        provincia: p.province,
        lat: p.lat,
        lon: p.lon,
      })),
    });
  });
  // 1.b Sumar las altas SAP huerfanas (cardCodeSap + calle, asignadas a
  // este vendedor, que NO matchean con ningun POINT por nombre+provincia).
  // Las agrupamos por localidad - centroide aproximado si no hay lat/lng.
  const ptNameSet = new Set();
  localidades.forEach((L) =>
    L.tiendas.forEach((t) =>
      ptNameSet.add((t.provincia || '').toUpperCase() + '|' + (t.nombre || '').toLowerCase())
    )
  );
  const altasOk = (typeof approvedAltasList !== 'undefined' ? approvedAltasList : []).filter(
    (a) => {
      if (!a) return false;
      if (!a.cardCodeSap && !a.manualSapPending) return false;
      // ANTES: exigiamos calle/address para rutear. Excluia a las provisorias
      // del "Alta rapida" que muchas veces se crean sin direccion exacta
      // (el vendedor solo tiene nombre + localidad hasta que va a visitarlas).
      // AHORA: exigimos direccion SOLO si tiene cardCodeSap (BPs oficiales de
      // SAP - deberian tener direccion). Las provisorias con manualSapPending
      // pueden rutearse sin direccion, usando el centroide de la localidad
      // (mismo comportamiento que altas SAP sin geo, ya soportado abajo).
      if (a.cardCodeSap && !(a.calle || a.address)) return false;
      if (a.assignedVendor && a.assignedVendor !== vendor) return false;
      const prov = (a.provincia || '').toUpperCase().trim();
      if (!prov) return false;
      const nombre = a.comercio || a.fantasia || 'SAP ' + (a.cardCodeSap || '').slice(0, 8);
      return !ptNameSet.has(prov + '|' + nombre.toLowerCase());
    }
  );
  // Agrupar las huerfanas por (provincia, localidad) y armar una localidad
  // virtual con su lat/lng promedio (o centroide de provincia).
  const altasByLoc = new Map();
  altasOk.forEach((a) => {
    const prov = (a.provincia || '').toUpperCase().trim();
    const loc = (a.localidadFinal || a.localidad || '').trim() || '(sin localidad)';
    const key = prov + '|' + loc;
    if (!altasByLoc.has(key)) altasByLoc.set(key, []);
    altasByLoc.get(key).push(a);
  });
  altasByLoc.forEach((altas, key) => {
    const parts = key.split('|');
    const prov = parts[0],
      loc = parts[1];
    const lats = altas.filter((x) => x.lat != null).map((x) => parseFloat(x.lat));
    const lngs = altas.filter((x) => x.lng != null).map((x) => parseFloat(x.lng));
    let lat = lats.length ? lats.reduce((s, v) => s + v, 0) / lats.length : null;
    let lon = lngs.length ? lngs.reduce((s, v) => s + v, 0) / lngs.length : null;
    if (lat == null && typeof getProvinceCentroid === 'function') {
      const c = getProvinceCentroid(prov);
      if (c) {
        lat = c[0];
        lon = c[1];
      }
    }
    if (lat == null) return;
    localidades.push({
      name: loc,
      province: prov,
      lat: lat,
      lon: lon,
      tiendas: altas.map((a) => ({
        nombre: a.comercio || a.fantasia || 'SAP ' + (a.cardCodeSap || '').slice(0, 8),
        localidad: loc,
        provincia: prov,
        lat: a.lat != null ? parseFloat(a.lat) : lat,
        lon: a.lng != null ? parseFloat(a.lng) : lon,
        sapAltaFsId: a._fsId,
        cardCodeSap: a.cardCodeSap,
      })),
    });
  });
  if (!localidades.length) return [];

  // 2. Orden inicial: Norte -> Sur (lat descendente)
  localidades.sort((a, b) => (b.lat || 0) - (a.lat || 0) || (a.lon || 0) - (b.lon || 0));

  const rutas = [];
  const restantes = localidades.slice();

  while (restantes.length > 0) {
    const seed = restantes.shift();
    let tiendasAcum = seed.tiendas.slice();
    const localidadesUsadas = [seed.name];
    const provs = new Set([seed.province]);
    let centroidLat = seed.lat;
    let centroidLon = seed.lon;

    // Si la semilla sola excede MAX, dividir en chunks
    if (tiendasAcum.length > RUTA_MAX) {
      const chunks = [];
      for (let i = 0; i < tiendasAcum.length; i += RUTA_TARGET) {
        chunks.push(tiendasAcum.slice(i, Math.min(i + RUTA_TARGET, tiendasAcum.length)));
      }
      // Si el ultimo chunk es muy chico, fusionar con el anterior
      if (chunks.length > 1 && chunks[chunks.length - 1].length < RUTA_MIN) {
        const last = chunks.pop();
        chunks[chunks.length - 1] = chunks[chunks.length - 1].concat(last);
      }
      chunks.forEach((c, idx) =>
        rutas.push({
          tiendas: c,
          localidades: [
            seed.name + (chunks.length > 1 ? ' (' + (idx + 1) + '/' + chunks.length + ')' : ''),
          ],
          provincia: seed.province,
          lat: seed.lat,
          lon: seed.lon,
        })
      );
      continue;
    }

    // Greedy: sumar la localidad mas cercana al centroide actual
    while (tiendasAcum.length < RUTA_MIN && restantes.length > 0) {
      let bestIdx = -1,
        bestDist = Infinity;
      restantes.forEach((loc, idx) => {
        const d = haversineKm(centroidLat, centroidLon, loc.lat, loc.lon);
        if (d < bestDist) {
          bestDist = d;
          bestIdx = idx;
        }
      });
      if (bestIdx === -1) break;
      const next = restantes[bestIdx];
      const newTotal = tiendasAcum.length + next.tiendas.length;
      // Si excede MAX por mucho, romper. Si por poco y estamos debajo de MIN, agregar.
      if (newTotal > RUTA_MAX + 2) {
        if (tiendasAcum.length >= RUTA_MIN - 2) break;
        if (newTotal > RUTA_MAX + 5) break;
      }
      tiendasAcum = tiendasAcum.concat(next.tiendas);
      localidadesUsadas.push(next.name);
      provs.add(next.province);
      // Actualizar centroide ponderado
      const prevCount = tiendasAcum.length - next.tiendas.length;
      centroidLat = (centroidLat * prevCount + next.lat * next.tiendas.length) / tiendasAcum.length;
      centroidLon = (centroidLon * prevCount + next.lon * next.tiendas.length) / tiendasAcum.length;
      restantes.splice(bestIdx, 1);
    }

    // Cerrar ruta
    if (tiendasAcum.length > 0) {
      rutas.push({
        tiendas: tiendasAcum,
        localidades: localidadesUsadas,
        provincia: [...provs].join(', '),
        lat: centroidLat,
        lon: centroidLon,
      });
    }
  }

  // 2.5. PASADA DE CONSOLIDACION: fusionar rutas chicas (< RUTA_MIN) con
  // la ruta mas cercana donde quepan (sin pasar RUTA_MAX + 2). Esto evita
  // que al dar de alta una tienda nueva quede como ruta solitaria de 1-2.
  // Iteramos: en cada vuelta agarramos la mas chica y la mergeamos con la
  // mas cercana viable. Si no hay donde mergear (todas estan llenas o lejos),
  // la dejamos como esta y rompemos.
  let consolidadasCount = 0;
  while (true) {
    let smallestIdx = -1,
      smallestLen = Infinity;
    rutas.forEach((r, i) => {
      if (r.tiendas.length < RUTA_MIN && r.tiendas.length < smallestLen) {
        smallestLen = r.tiendas.length;
        smallestIdx = i;
      }
    });
    if (smallestIdx === -1) break;
    const tiny = rutas[smallestIdx];
    // Buscar la ruta mas cercana (cualquiera, tiny o no) donde quepa.
    let bestIdx = -1,
      bestDist = Infinity;
    rutas.forEach((r, i) => {
      if (i === smallestIdx) return;
      if (r.tiendas.length + tiny.tiendas.length > RUTA_MAX + 2) return;
      const d = haversineKm(tiny.lat, tiny.lon, r.lat, r.lon);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    });
    if (bestIdx === -1) break;
    // Merge: tiny -> best. Centroide ponderado por cantidad de tiendas.
    const best = rutas[bestIdx];
    const wPrev = best.tiendas.length;
    const wTiny = tiny.tiendas.length;
    best.lat = (best.lat * wPrev + tiny.lat * wTiny) / (wPrev + wTiny);
    best.lon = (best.lon * wPrev + tiny.lon * wTiny) / (wPrev + wTiny);
    best.tiendas = best.tiendas.concat(tiny.tiendas);
    tiny.localidades.forEach((l) => {
      if (best.localidades.indexOf(l) < 0) best.localidades.push(l);
    });
    // Mergear provincias unicas separadas por coma.
    const tinyProvs = (tiny.provincia || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const bestProvs = (best.provincia || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    tinyProvs.forEach((p) => {
      if (bestProvs.indexOf(p) < 0) bestProvs.push(p);
    });
    best.provincia = bestProvs.join(', ');
    rutas.splice(smallestIdx, 1);
    consolidadasCount++;
    console.log(
      '[rutas] Consolidada ruta chica (' +
        wTiny +
        ' tiendas) con ruta mas cercana a ' +
        bestDist.toFixed(1) +
        ' km. Total ahora: ' +
        best.tiendas.length
    );
  }
  _lastRouteStats = {
    totalRutas: rutas.length,
    consolidadas: consolidadasCount,
    nuevasTiendasAprox: 0,
  };

  // IDs y nombres iniciales
  rutas.forEach((r, idx) => {
    r.id = 'r' + (idx + 1);
    r.numero = idx + 1;
    const locsShort =
      r.localidades.slice(0, 2).join(', ') +
      (r.localidades.length > 2 ? ' (+' + (r.localidades.length - 2) + ' loc)' : '');
    r.titulo = locsShort;
  });

  // 3. Asignar fecha a cada ruta distribuyendo en dias habiles del mes
  const totalRutas = rutas.length;
  rutas.forEach((r, idx) => {
    r.fecha = asignarFechaPorIndice(idx, totalRutas, monthIdx, year);
    r.especial = false;
  });

  // 4. Aplicar route_overrides: derivadas se quitan, reagendadas se mueven a la ruta de su fecha
  const overrides = getOverridesForContext(vendor, monthIdx, year);
  // Map de tiendas -> override mas reciente (para evitar duplicados de mover/derivar)
  const overrideByTienda = {};
  overrides.forEach((o) => {
    if (!o.tienda) return;
    const prev = overrideByTienda[o.tienda];
    const ta = o.createdAt ? (o.createdAt.toMillis ? o.createdAt.toMillis() : 0) : 0;
    const tb =
      prev && prev.createdAt ? (prev.createdAt.toMillis ? prev.createdAt.toMillis() : 0) : 0;
    if (!prev || ta > tb) overrideByTienda[o.tienda] = o;
  });

  // Funcion para sacar la tienda de las rutas y devolverla
  function popTienda(nombre) {
    for (const r of rutas) {
      const idx = r.tiendas.findIndex((t) => t.nombre === nombre);
      if (idx >= 0) return r.tiendas.splice(idx, 1)[0];
    }
    return null;
  }

  // Indice de rutas por fecha (para reagendamientos)
  const rutasByFecha = {};
  rutas.forEach((r) => {
    if (r.fecha) rutasByFecha[r.fecha] = r;
  });

  Object.values(overrideByTienda).forEach((o) => {
    if (o.action === 'derivada') {
      // No remover la tienda: queda en la ruta marcada como derivada (amarillo)
      // hasta que el VDI cierre el ticket cargando la visita.
      for (const r of rutas) {
        const t = r.tiendas.find((x) => x.nombre === o.tienda);
        if (t) {
          t.derivada = true;
          t.derivadaA = o.derivedToEmail || '';
          t.derivadaAt =
            o.createdAt && o.createdAt.toDate
              ? o.createdAt.toDate().toISOString().slice(0, 10)
              : '';
          break;
        }
      }
    } else if (o.action === 'reagendada' && o.targetDate) {
      const t = popTienda(o.tienda);
      if (!t) return; // ya estaba derivada o no esta
      t.reagendadaDe = null; // info opcional
      t.reagendadaPara = o.targetDate;
      if (rutasByFecha[o.targetDate]) {
        rutasByFecha[o.targetDate].tiendas.push(t);
      } else {
        // Crear ruta "Reagendados" para esa fecha
        const nuevaRuta = {
          id: 'r-rg-' + o.targetDate,
          numero: 'R',
          fecha: o.targetDate,
          tiendas: [t],
          localidades: ['Reagendados ' + fmtFechaCorta(o.targetDate)],
          provincia: t.provincia,
          titulo: 'Reagendados ' + fmtFechaCorta(o.targetDate),
          especial: true,
        };
        rutas.push(nuevaRuta);
        rutasByFecha[o.targetDate] = nuevaRuta;
      }
    }
  });

  // 5. Quitar rutas que quedaron sin tiendas
  const rutasFinal = rutas.filter((r) => r.tiendas.length > 0);

  // 6. Re-ordenar y re-numerar por fecha asc
  rutasFinal.sort((a, b) => {
    if (a.fecha && b.fecha) return a.fecha.localeCompare(b.fecha);
    if (a.fecha) return -1;
    if (b.fecha) return 1;
    return 0;
  });
  let numeroNormal = 0;
  rutasFinal.forEach((r, _idx) => {
    if (!r.especial) {
      numeroNormal++;
      r.numero = numeroNormal;
      r.id = 'r' + numeroNormal;
    }
  });

  return rutasFinal;
}

function getTiendasVisitadasMes(vendor, monthIdx, year) {
  const monthLabel = (MESES[monthIdx] || '').toUpperCase();
  const set = new Set();
  (visitsCache || []).forEach((v) => {
    if (v.vendor !== vendor) return;
    if ((v.mes || '').toUpperCase() !== monthLabel) return;
    if (parseInt(v.anio, 10) !== parseInt(year, 10)) return;
    set.add(v.tienda);
  });
  return set;
}

// Devuelve la visita registrada para esa tienda en ese mes, sin importar quien la haya cargado.
// Util para detectar cuando el VDI cierra el ticket de una tienda que el externo le derivo.
function findVisitForStoreAnyVendor(tienda, provincia, localidad, monthIdx, year) {
  const monthLabel = (MESES[monthIdx] || '').toUpperCase();
  const match = (v) =>
    v.tienda === tienda &&
    (!provincia || v.provincia === provincia) &&
    (!localidad || v.localidad === localidad) &&
    (v.mes || '').toUpperCase() === monthLabel &&
    parseInt(v.anio, 10) === parseInt(year, 10);
  return (
    (visitsCache || []).find(match) ||
    (typeof visitsCachePartner !== 'undefined' ? visitsCachePartner.find(match) : null)
  );
}

function getCurrentMonthYear() {
  const now = new Date();
  return { monthIdx: now.getMonth(), year: now.getFullYear() };
}

function getRutaTargetMonth() {
  if (rutaView === 'historico' && rutaHistMonth !== null && rutaHistYear !== null) {
    return { monthIdx: rutaHistMonth, year: rutaHistYear };
  }
  return getCurrentMonthYear();
}

function getActiveRutaVendor() {
  if (userRole === 'vendedor') return assignedVendor;
  if (!window.rutaVendorFilter && VENDORS.length) return VENDORS[0].key;
  return window.rutaVendorFilter;
}

function ensureVisitsListener() {
  // Suscribe al listener de visits para que las rutas se actualicen en tiempo real
  if (unsubVisits || !currentUser || !fbDb) return;
  let q;
  // v298 (2026-07-14): gerente sumado al bucket admin/viewer (pedido de Pablo
  // para ver comentarios de visitas de todos los vendedores). Firestore Rules
  // ya lo permitia (reads=todos), este era el unico filtro que le quedaba.
  if (userRole === 'admin' || userRole === 'viewer' || userRole === 'gerente')
    q = fbDb.collection('visits');
  else q = fbDb.collection('visits').where('ownerUid', '==', currentUser.uid);
  window.unsubVisits = q.onSnapshot(
    (qs) => {
      window.visitsCache = [];
      qs.forEach((d) => visitsCache.push(Object.assign({ id: d.id }, d.data())));
      // Si la tab de rutas esta visible, re-render
      const pane = document.getElementById('pane-rutas');
      if (pane && pane.style.display !== 'none') {
        if (rutaDetalleId) renderRutaDetalle();
        else renderRutasTab();
      }
      // Si tambien esta la lista de mis visitas
      const visListPane = document.getElementById('visita-pane-list');
      if (visListPane && visListPane.style.display !== 'none') renderVisitasList();
    },
    (err) => console.error('visits listener', err)
  );
}

// Recalcula las rutas: aplica overrides recientes de Zonas, refresca el
// cache de visitas y route_overrides, y re-renderiza la pestana. Es util
// despues de hacer una reasignacion en el modal Zonas o despues de que
// otros vendedores actualizan sus visitas - garantiza que las rutas
// reflejen el estado actual sin tener que cerrar y abrir la app.
window.recalcularRutas = async function () {
  const btn = document.querySelector('.rt-recalc-btn');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '⟳ Recalculando...';
  }
  showSyncTag('Recalculando rutas...');
  // Snapshot pre-recalculo: cuantas tiendas habia en POINTS para detectar
  // si aparecieron tiendas nuevas (altas aprobadas que entraron al map).
  let prevTotalTiendas = 0;
  try {
    POINTS.forEach((p) => {
      prevTotalTiendas += (p.clients || []).length + (p.prospects || []).length;
    });
  } catch (_e) {}
  try {
    // Re-aplicar overrides a POINTS por si el listener todavia no proceso
    // (ej. acabamos de cambiar una zona y queremos ver el efecto ya).
    if (typeof applyVendorOverridesToPoints === 'function') {
      try {
        applyVendorOverridesToPoints();
      } catch (_e) {}
    }
    // Refrescar listeners (vuelven a leer Firestore si estan suspendidos)
    if (typeof ensureVisitsListener === 'function') ensureVisitsListener();
    if (typeof ensureRouteOverridesListener === 'function') ensureRouteOverridesListener();
    if (typeof ensureApprovedAltasListener === 'function') ensureApprovedAltasListener();
    // Resetear vista a "ruta detalle" cerrado para volver al listado
    window.rutaDetalleId = null;
    renderRutasTab();
    // Refrescar contador del tab tambien
    try {
      if (typeof updateRutasTabCount === 'function') updateRutasTabCount();
    } catch (_e) {}
    // Reporte al usuario: total de rutas + cuantas se consolidaron + si hay
    // nuevas tiendas. _lastRouteStats lo setea generarRutasVendor.
    let nuevasTiendas = 0;
    try {
      let postTotalTiendas = 0;
      POINTS.forEach((p) => {
        postTotalTiendas += (p.clients || []).length + (p.prospects || []).length;
      });
      nuevasTiendas = Math.max(0, postTotalTiendas - prevTotalTiendas);
    } catch (_e) {}
    const stats = _lastRouteStats || {};
    let msg = 'Rutas recalculadas';
    const parts = [];
    if (stats.totalRutas) parts.push(stats.totalRutas + ' rutas');
    if (stats.consolidadas) parts.push(stats.consolidadas + ' consolidada(s)');
    if (nuevasTiendas > 0) parts.push(nuevasTiendas + ' tienda(s) nueva(s) agregada(s)');
    if (parts.length) msg += ': ' + parts.join(' · ');
    showSyncTag(msg, 3500);
  } catch (e) {
    console.error('recalcularRutas', e);
    showSyncTag('Error recalculando rutas');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '&#128260; Recalcular Rutas';
    }
  }
};

// Modo de la pestaña Rutas: 'recomendada' (autogeneradas) o 'personalizada'
// (cada vendedor arma a mano).
let rutaMode = 'recomendada';
window.setRutaMode = function (m) {
  rutaMode = m;
  window.rutaDetalleId = null;
  document.getElementById('rmode-reco').classList.toggle('active', m === 'recomendada');
  document.getElementById('rmode-pers').classList.toggle('active', m === 'personalizada');
  document.getElementById('ruta-reco-controls').style.display =
    m === 'recomendada' ? 'flex' : 'none';
  document.getElementById('ruta-pers-controls').style.display =
    m === 'personalizada' ? 'flex' : 'none';
  if (m === 'personalizada') ensureCustomRoutesListener();
  renderRutasTab();
};

// Rutas personalizadas: cache local + listener.
let myCustomRoutes = [];
if (typeof window.unsubCustomRoutes === 'undefined') window.unsubCustomRoutes = null;
function ensureCustomRoutesListener() {
  if (unsubCustomRoutes || !currentUser || !fbDb) return;
  window.unsubCustomRoutes = fbDb
    .collection('custom_routes')
    .where('ownerUid', '==', currentUser.uid)
    .onSnapshot(
      (qs) => {
        myCustomRoutes = [];
        qs.forEach((d) => myCustomRoutes.push(Object.assign({ _fsId: d.id }, d.data())));
        if (rutaMode === 'personalizada') renderRutasTab();
      },
      (err) => console.warn('custom_routes listener', err)
    );
}

window.setRutaView = function (v) {
  rutaView = v;
  window.rutaDetalleId = null;
  if (v === 'historico' && rutaHistMonth === null) {
    const now = new Date();
    now.setMonth(now.getMonth() - 1);
    rutaHistMonth = now.getMonth();
    rutaHistYear = now.getFullYear();
  }
  document.getElementById('rt-mes').classList.toggle('active', v === 'mes');
  document.getElementById('rt-hist').classList.toggle('active', v === 'historico');
  renderRutasTab();
};

function renderRutasTab() {
  if (rutaMode === 'personalizada') return renderRutasPersonalizadas();
  if (rutaDetalleId) return renderRutaDetalle();
  const vendor = getActiveRutaVendor();
  const { monthIdx, year } = getRutaTargetMonth();
  const monthLabel = MESES[monthIdx];

  // Filtros
  let filtersHtml = '<div class="ruta-filter-row">';
  if (userRole === 'admin' || userRole === 'viewer') {
    filtersHtml += '<select onchange="onChangeRutaVendor(this.value)">';
    VENDORS.forEach((v) => {
      const sel = vendor === v.key ? ' selected' : '';
      filtersHtml +=
        '<option value="' + v.key + '"' + sel + '>' + escapeHtml(v.label) + '</option>';
    });
    filtersHtml += '</select>';
  }
  if (rutaView === 'historico') {
    filtersHtml += '<select onchange="onChangeRutaMes(this.value)">';
    MESES.forEach((m, idx) => {
      const sel = monthIdx === idx ? ' selected' : '';
      filtersHtml += '<option value="' + idx + '"' + sel + '>' + m + '</option>';
    });
    filtersHtml += '</select>';
    filtersHtml += '<select onchange="onChangeRutaAnio(this.value)">';
    const now = new Date();
    for (let y = now.getFullYear() - 2; y <= now.getFullYear(); y++) {
      const sel = year === y ? ' selected' : '';
      filtersHtml += '<option value="' + y + '"' + sel + '>' + y + '</option>';
    }
    filtersHtml += '</select>';
  }
  filtersHtml += '</div>';
  document.getElementById('rutas-filters').innerHTML = filtersHtml;

  const rutas = vendor ? generarRutasVendor(vendor, monthIdx, year) : [];
  const visitadas = vendor ? getTiendasVisitadasMes(vendor, monthIdx, year) : new Set();

  rutas.forEach((r) => {
    r.visitadas = r.tiendas.filter((t) => visitadas.has(t.nombre)).length;
    r.progreso = r.tiendas.length > 0 ? r.visitadas / r.tiendas.length : 0;
  });

  const totalT = rutas.reduce((s, r) => s + r.tiendas.length, 0);
  const totalV = rutas.reduce((s, r) => s + r.visitadas, 0);
  const pctGlobal = totalT > 0 ? Math.round((totalV / totalT) * 100) : 0;

  let html = '';
  html +=
    '<div class="ruta-summary"><b>' +
    monthLabel +
    ' ' +
    year +
    '</b> &middot; ' +
    rutas.length +
    ' ruta' +
    (rutas.length === 1 ? '' : 's') +
    ' &middot; ' +
    totalT +
    ' tienda' +
    (totalT === 1 ? '' : 's') +
    ' &middot; <b>' +
    totalV +
    ' visitada' +
    (totalV === 1 ? '' : 's') +
    '</b> (' +
    pctGlobal +
    '%)</div>';

  if (!vendor) {
    html += '<div class="no-data">Seleccion&aacute; un vendedor para ver sus rutas.</div>';
  } else if (!rutas.length) {
    html += '<div class="no-data">No hay clientes asignados a este vendedor todav&iacute;a.</div>';
  } else {
    rutas.forEach((r) => {
      const pct = Math.round(r.progreso * 100);
      let cls = 'ruta-card';
      if (r.especial) cls += ' reagendados';
      else if (r.progreso >= 1) cls += ' completa';
      else if (r.progreso > 0) cls += ' progress';
      // Fecha badge
      let fechaBadge = '';
      if (r.fecha) {
        const todayStr = (() => {
          const d = new Date();
          return (
            d.getFullYear() +
            String(d.getMonth() + 1).padStart(2, '0') +
            String(d.getDate()).padStart(2, '0')
          );
        })();
        let fechaCls = 'futura';
        if (r.especial) fechaCls = 'reagendados';
        else if (r.fecha === todayStr) fechaCls = 'hoy';
        else if (r.fecha < todayStr) fechaCls = 'atrasada';
        const labelFecha = (() => {
          const yyyy = parseInt(r.fecha.slice(0, 4), 10);
          const mm = parseInt(r.fecha.slice(4, 6), 10) - 1;
          const dd = parseInt(r.fecha.slice(6, 8), 10);
          const dt = new Date(yyyy, mm, dd);
          const dowName = ['Dom', 'Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab'][dt.getDay()];
          return dowName + ' ' + dd + '/' + String(mm + 1).padStart(2, '0');
        })();
        fechaBadge =
          '<span class="ruta-fecha-badge ' +
          fechaCls +
          '">' +
          labelFecha +
          (fechaCls === 'hoy' ? ' &middot; HOY' : '') +
          '</span>';
      }
      const numLabel = r.especial ? 'Reagendados' : 'Ruta ' + r.numero;
      html += '<div class="' + cls + '" onclick="abrirRutaDetalle(\'' + r.id + '\')">';
      html +=
        '<div class="ruta-card-head"><div class="ruta-num">' +
        numLabel +
        '</div><div class="ruta-status">' +
        r.visitadas +
        '/' +
        r.tiendas.length +
        '</div></div>';
      html += '<div class="ruta-title">' + escapeHtml(r.titulo) + '</div>';
      html +=
        '<div class="ruta-meta">' +
        r.tiendas.length +
        ' tienda' +
        (r.tiendas.length === 1 ? '' : 's') +
        ' &middot; ' +
        escapeHtml(r.provincia || '') +
        '</div>';
      if (fechaBadge) html += '<div>' + fechaBadge + '</div>';
      html +=
        '<div class="ruta-progress-bar"><div class="ruta-progress-fill" style="width:' +
        pct +
        '%"></div></div>';
      html += '<div class="ruta-progress-label">' + pct + '% completa</div>';
      html += '</div>';
    });
  }

  document.getElementById('rutas-content').innerHTML = html;
  const tabBadge = document.getElementById('tab-rutas-count');
  if (tabBadge) tabBadge.textContent = rutas.length;
}

// ============================================================
// RUTAS PERSONALIZADAS (vendedor las arma a mano)
// ============================================================
function renderRutasPersonalizadas() {
  document.getElementById('rutas-filters').innerHTML = '';
  const cont = document.getElementById('rutas-content');
  if (!myCustomRoutes.length) {
    cont.innerHTML =
      '<div class="no-data">Todav&iacute;a no creaste ninguna ruta personalizada. Toc&aacute; <b>+ Nueva ruta</b> para empezar.</div>';
    return;
  }
  // Ordenar por fecha desc, las sin fecha al final
  const sorted = myCustomRoutes.slice().sort((a, b) => {
    if (!a.fecha && !b.fecha)
      return (
        (b.createdAt && b.createdAt.toMillis ? b.createdAt.toMillis() : 0) -
        (a.createdAt && a.createdAt.toMillis ? a.createdAt.toMillis() : 0)
      );
    if (!a.fecha) return 1;
    if (!b.fecha) return -1;
    return b.fecha.localeCompare(a.fecha);
  });
  let html = '';
  const todayStr = new Date().toISOString().slice(0, 10);
  sorted.forEach((r) => {
    const tiendas = r.tiendas || [];
    const safeId = escapeAttr(r._fsId || '');
    let fechaCls = 'futura';
    if (r.fecha === todayStr) fechaCls = 'hoy';
    else if (r.fecha && r.fecha < todayStr) fechaCls = 'atrasada';
    const fechaBadge = r.fecha
      ? '<span class="ruta-fecha-badge ' +
        fechaCls +
        '">' +
        r.fecha +
        (fechaCls === 'hoy' ? ' &middot; HOY' : '') +
        '</span>'
      : '';
    html += '<div class="ruta-card" style="border-left:4px solid #7c3aed">';
    html +=
      '<div class="ruta-card-head"><div class="ruta-num" style="background:#7c3aed">Personalizada</div><div class="ruta-status">' +
      tiendas.length +
      ' tiendas</div></div>';
    html += '<div class="ruta-title">' + escapeHtml(r.name || '(sin nombre)') + '</div>';
    if (r.notes)
      html += '<div class="ruta-meta" style="font-style:italic">' + escapeHtml(r.notes) + '</div>';
    if (fechaBadge) html += '<div>' + fechaBadge + '</div>';
    html += '<div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap">';
    html +=
      '<button onclick="editRutaPersonalizada(\'' +
      safeId +
      '\')" style="background:#7c3aed;color:#fff;border:none;border-radius:5px;padding:6px 12px;font-size:11px;font-weight:700;cursor:pointer">Ver / Editar</button>';
    html +=
      '<button onclick="deleteRutaPersonalizada(\'' +
      safeId +
      '\')" style="background:#fee2e2;color:#991b1b;border:1.5px solid #fca5a5;border-radius:5px;padding:6px 12px;font-size:11px;font-weight:700;cursor:pointer">&#128465; Eliminar</button>';
    html += '</div>';
    html += '</div>';
  });
  cont.innerHTML = html;
}

// Estado in-memory del modal de edicion (tiendas seleccionadas).
let _rpmTiendas = [];

window.openNuevaRutaPersonalizadaModal = function () {
  if (!currentUser) {
    alert('No hay sesion activa.');
    return;
  }
  document.getElementById('rpm-title').textContent = 'Nueva ruta personalizada';
  document.getElementById('rpm-id').value = '';
  document.getElementById('rpm-name').value = '';
  document.getElementById('rpm-fecha').value = '';
  document.getElementById('rpm-notes').value = '';
  _rpmTiendas = [];
  refreshRpmTiendasList();
  document.getElementById('ruta-personalizada-modal').classList.add('open');
};

window.editRutaPersonalizada = function (fsId) {
  const r = (myCustomRoutes || []).find((x) => x._fsId === fsId);
  if (!r) {
    alert('Ruta no encontrada. Recarga la pagina.');
    return;
  }
  document.getElementById('rpm-title').textContent = 'Editar ruta personalizada';
  document.getElementById('rpm-id').value = fsId;
  document.getElementById('rpm-name').value = r.name || '';
  document.getElementById('rpm-fecha').value = r.fecha || '';
  document.getElementById('rpm-notes').value = r.notes || '';
  _rpmTiendas = (r.tiendas || []).slice();
  refreshRpmTiendasList();
  document.getElementById('ruta-personalizada-modal').classList.add('open');
};

window.closeRutaPersonalizadaModal = function () {
  document.getElementById('ruta-personalizada-modal').classList.remove('open');
};

function refreshRpmTiendasList() {
  const cont = document.getElementById('rpm-tiendas-list');
  const cnt = document.getElementById('rpm-tiendas-count');
  if (cnt) cnt.textContent = _rpmTiendas.length;
  if (!_rpmTiendas.length) {
    cont.innerHTML =
      '<div style="font-size:11px;color:#94a3b8;padding:8px;background:#f1f5f9;border-radius:5px;text-align:center">Toc&aacute; <b>+ Agregar tienda</b> para sumar las primeras.</div>';
    return;
  }
  let html = '';
  _rpmTiendas.forEach((t, idx) => {
    html +=
      '<div style="display:flex;align-items:center;gap:6px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:5px;padding:6px 8px">';
    html +=
      '<div style="background:#7c3aed;color:#fff;border-radius:50%;width:22px;height:22px;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:800;flex-shrink:0">' +
      (idx + 1) +
      '</div>';
    html += '<div style="flex:1;min-width:0">';
    html +=
      '<div style="font-size:12px;font-weight:700;color:#0f172a">' +
      escapeHtml(t.clientName || '') +
      '</div>';
    html +=
      '<div style="font-size:10px;color:#64748b">' +
      escapeHtml(t.locName || '') +
      ' / ' +
      escapeHtml(titleCase(t.prov || '')) +
      '</div>';
    html += '</div>';
    if (idx > 0)
      html +=
        '<button onclick="moveRpmTienda(' +
        idx +
        ',-1)" style="background:none;border:none;color:#64748b;cursor:pointer;font-size:14px" title="Subir">&uarr;</button>';
    if (idx < _rpmTiendas.length - 1)
      html +=
        '<button onclick="moveRpmTienda(' +
        idx +
        ',1)" style="background:none;border:none;color:#64748b;cursor:pointer;font-size:14px" title="Bajar">&darr;</button>';
    html +=
      '<button onclick="removeRpmTienda(' +
      idx +
      ')" style="background:none;border:none;color:#dc2626;cursor:pointer;font-size:16px" title="Quitar">&times;</button>';
    html += '</div>';
  });
  cont.innerHTML = html;
}

window.moveRpmTienda = function (idx, dir) {
  const j = idx + dir;
  if (j < 0 || j >= _rpmTiendas.length) return;
  const t = _rpmTiendas[idx];
  _rpmTiendas[idx] = _rpmTiendas[j];
  _rpmTiendas[j] = t;
  refreshRpmTiendasList();
};

window.removeRpmTienda = function (idx) {
  _rpmTiendas.splice(idx, 1);
  refreshRpmTiendasList();
};

window.openRpmPickerModal = function () {
  document.getElementById('rpm-picker-search').value = '';
  renderRpmPickerList();
  document.getElementById('rpm-picker-modal').classList.add('open');
};

window.closeRpmPickerModal = function () {
  document.getElementById('rpm-picker-modal').classList.remove('open');
};

window.renderRpmPickerList = function () {
  const q = (document.getElementById('rpm-picker-search').value || '').toLowerCase().trim();
  const myVendor = userRole === 'vendedor' ? assignedVendor : null;
  // Items: POINTS clients confirmados en SAP + altas SAP (incl. provisorias).
  const items = [];
  const seen = new Set();
  POINTS.forEach((p) => {
    if (myVendor && p.vendor !== myVendor) return;
    (p.clients || []).forEach((c) => {
      if (typeof isSapConfirmed === 'function' && !isSapConfirmed(p.province, p.name, c)) return;
      const k = p.province + '|' + p.name + '|' + c;
      if (seen.has(k)) return;
      seen.add(k);
      items.push({ prov: p.province, locName: p.name, clientName: c, tipo: 'C' });
    });
  });
  if (typeof approvedAltasList !== 'undefined') {
    approvedAltasList.forEach((a) => {
      if (!a) return;
      if (!(a.cardCodeSap || a.manualSapPending)) return;
      const aProv = (a.provincia || '').toUpperCase().trim();
      const aLoc = (a.localidadFinal || a.localidad || '').trim();
      if (!aProv || !aLoc) return;
      if (myVendor && a.assignedVendor && a.assignedVendor !== myVendor) return;
      const nombre = a.comercio || a.fantasia;
      if (!nombre) return;
      const k = aProv + '|' + aLoc + '|' + nombre;
      if (seen.has(k)) return;
      seen.add(k);
      items.push({
        prov: aProv,
        locName: aLoc,
        clientName: nombre,
        tipo: 'C',
        isProvisorio: !!(a.manualSapPending && !a.cardCodeSap),
      });
    });
  }
  // Filtrar las que ya estan en la ruta.
  const already = new Set(
    _rpmTiendas.map((t) => (t.prov || '') + '|' + (t.locName || '') + '|' + (t.clientName || ''))
  );
  let filtered = items.filter(
    (it) => !already.has(it.prov + '|' + it.locName + '|' + it.clientName)
  );
  if (q) {
    filtered = filtered.filter(
      (it) => it.clientName.toLowerCase().includes(q) || it.locName.toLowerCase().includes(q)
    );
  }
  filtered.sort((a, b) => a.clientName.localeCompare(b.clientName));
  const cont = document.getElementById('rpm-picker-list');
  if (!filtered.length) {
    cont.innerHTML =
      '<div style="padding:18px;color:#94a3b8;text-align:center;font-size:12px">No hay tiendas que coincidan.</div>';
    return;
  }
  let html = '';
  filtered.slice(0, 200).forEach((it) => {
    const safeProv = escapeAttr(it.prov);
    const safeLoc = escapeAttr(it.locName);
    const safeName = escapeAttr(it.clientName);
    const provBadge = it.isProvisorio
      ? ' <span style="background:#f59e0b;color:#fff;font-size:9px;font-weight:800;padding:1px 5px;border-radius:3px;margin-left:4px">PROVISORIO</span>'
      : '';
    html +=
      '<div onclick="addRpmTienda(\'' +
      safeProv +
      "','" +
      safeLoc +
      "','" +
      safeName +
      "','" +
      (it.isProvisorio ? '1' : '0') +
      '\')" style="padding:9px 11px;border-bottom:1px solid #f1f5f9;cursor:pointer;font-size:12px" onmouseover="this.style.background=\'#ecfdf5\'" onmouseout="this.style.background=\'\'">';
    html +=
      '<div style="font-weight:700;color:#0f172a">' +
      escapeHtml(it.clientName) +
      provBadge +
      '</div>';
    html +=
      '<div style="font-size:10px;color:#64748b">' +
      escapeHtml(it.locName) +
      ' / ' +
      escapeHtml(titleCase(it.prov)) +
      '</div>';
    html += '</div>';
  });
  if (filtered.length > 200)
    html +=
      '<div style="padding:8px;font-size:10px;color:#94a3b8;text-align:center">Mostrando los primeros 200. Refin&aacute; la b&uacute;squeda.</div>';
  cont.innerHTML = html;
};

window.addRpmTienda = function (prov, locName, clientName, isProvisorio) {
  _rpmTiendas.push({ prov, locName, clientName, tipo: 'C', isProvisorio: isProvisorio === '1' });
  refreshRpmTiendasList();
  // Re-render picker para sacar la que ya agregaste.
  renderRpmPickerList();
};

window.saveRutaPersonalizada = async function () {
  if (!currentUser) {
    alert('No hay sesion activa.');
    return;
  }
  const name = (document.getElementById('rpm-name').value || '').trim();
  if (!name) {
    alert('Ponle un nombre a la ruta.');
    return;
  }
  if (!_rpmTiendas.length) {
    alert('Agreg&aacute; al menos 1 tienda.');
    return;
  }
  const fecha = (document.getElementById('rpm-fecha').value || '').trim();
  const notes = (document.getElementById('rpm-notes').value || '').trim();
  const id = (document.getElementById('rpm-id').value || '').trim();
  const data = {
    name: name,
    fecha: fecha || null,
    notes: notes || null,
    tiendas: _rpmTiendas,
    ownerUid: currentUser.uid,
    ownerEmail: currentUser.email || '',
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
  };
  try {
    if (id) {
      await fbDb.collection('custom_routes').doc(id).update(data);
    } else {
      data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
      await fbDb.collection('custom_routes').add(data);
    }
    showSyncTag(id ? 'Ruta actualizada' : 'Ruta creada');
    closeRutaPersonalizadaModal();
  } catch (e) {
    console.error('saveRutaPersonalizada', e);
    alert('Error guardando la ruta: ' + (e.message || e));
  }
};

window.deleteRutaPersonalizada = async function (fsId) {
  const r = (myCustomRoutes || []).find((x) => x._fsId === fsId);
  if (!r) return;
  if (
    !confirm('Eliminar la ruta personalizada "' + (r.name || '-') + '"?\n\nNo se puede deshacer.')
  )
    return;
  try {
    await fbDb.collection('custom_routes').doc(fsId).delete();
    showSyncTag('Ruta eliminada');
  } catch (e) {
    console.error('deleteRutaPersonalizada', e);
    alert('Error eliminando: ' + (e.message || e));
  }
};

window.abrirRutaDetalle = function (rutaId) {
  window.rutaDetalleId = rutaId;
  renderRutaDetalle();
};
window.cerrarRutaDetalle = function () {
  window.rutaDetalleId = null;
  // Quitar el focus en el mapa: vuelve a mostrar la zona/provincia/localidad normales.
  if (routeFocusLocalitySet) {
    routeFocusLocalitySet = null;
    if (typeof restyleZoneLayers === 'function') restyleZoneLayers();
    if (typeof drawMarkers === 'function') drawMarkers();
    if (typeof recenter === 'function') recenter();
  }
  renderRutasTab();
};

function applyRouteMapFocus(ruta) {
  // Setea el filtro del mapa con las localidades unicas de la ruta y hace fitBounds.
  if (!ruta || !ruta.tiendas || !ruta.tiendas.length) return;
  const set = new Set();
  ruta.tiendas.forEach((t) => {
    if (t.provincia && t.localidad) set.add(t.provincia + '|' + t.localidad);
  });
  routeFocusLocalitySet = set;
  restyleZoneLayers();
  drawMarkers();
  // Calcular bounds de las localidades involucradas (usa lat/lon de POINTS).
  const pts = POINTS.filter((p) => set.has(p.province + '|' + p.name));
  if (pts.length && typeof map !== 'undefined') {
    if (pts.length === 1) {
      map.setView([pts[0].lat, pts[0].lon], 11, { animate: true });
    } else {
      const bounds = L.latLngBounds(pts.map((p) => [p.lat, p.lon]));
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 11, animate: true });
    }
  }
}
window.onChangeRutaVendor = function (v) {
  window.rutaVendorFilter = v;
  window.rutaDetalleId = null;
  renderRutasTab();
};
window.onChangeRutaMes = function (v) {
  rutaHistMonth = parseInt(v, 10);
  window.rutaDetalleId = null;
  renderRutasTab();
};
window.onChangeRutaAnio = function (v) {
  rutaHistYear = parseInt(v, 10);
  window.rutaDetalleId = null;
  renderRutasTab();
};

function renderRutaDetalle() {
  const vendor = getActiveRutaVendor();
  const { monthIdx, year } = getRutaTargetMonth();
  const monthLabel = MESES[monthIdx];
  const monthLabelUp = monthLabel.toUpperCase();
  if (!vendor) {
    cerrarRutaDetalle();
    return;
  }

  const rutas = generarRutasVendor(vendor, monthIdx, year);
  const ruta = rutas.find((r) => r.id === rutaDetalleId);
  if (!ruta) {
    cerrarRutaDetalle();
    return;
  }

  const visitadas = getTiendasVisitadasMes(vendor, monthIdx, year);
  function getVisitaTienda(nombre) {
    return (visitsCache || []).find(
      (v) =>
        v.vendor === vendor &&
        (v.mes || '').toUpperCase() === monthLabelUp &&
        parseInt(v.anio, 10) === parseInt(year, 10) &&
        v.tienda === nombre
    );
  }

  const visitedCount = ruta.tiendas.filter((t) => visitadas.has(t.nombre)).length;
  const pendingCount = ruta.tiendas.length - visitedCount;

  // Permitir cargar visita / marcar contactado dentro de cada tienda de la
  // ruta. Roles habilitados (siempre que sea el mes en curso):
  //  - admin / gerente: cualquier ruta.
  //  - vendedor (VDE): solo su zona asignada.
  //  - interno (VDI): solo las zonas de sus VDEs pareja
  //    (myExternalPartners, cargado por loadMyExternalPartners desde
  //    /roles donde internalPartnerUid==uid).
  const isCurrentMonth = rutaView === 'mes';
  const allowEdit =
    isCurrentMonth &&
    (userRole === 'admin' ||
      userRole === 'gerente' ||
      (userRole === 'vendedor' && vendor === assignedVendor) ||
      (userRole === 'interno' && (myExternalPartners || []).some((p) => p.vendor === vendor)));

  let html = '';
  html +=
    '<button class="ruta-back-btn" onclick="cerrarRutaDetalle()">&larr; Volver a rutas</button>';
  html += '<div class="ruta-detalle-head">';
  html += '<div class="rdh-num">Ruta ' + ruta.numero + '</div>';
  html += '<div class="rdh-title">' + escapeHtml(ruta.titulo) + '</div>';
  html +=
    '<div class="rdh-meta">' +
    monthLabel +
    ' ' +
    year +
    ' &middot; ' +
    ruta.tiendas.length +
    ' tiendas &middot; ' +
    visitedCount +
    ' visitadas &middot; ' +
    pendingCount +
    ' pendientes</div>';
  html +=
    '<button class="ruta-wa-btn" onclick="sendRouteByWhatsApp(\'' +
    escapeAttr(ruta.id) +
    '\')" title="Enviar la ruta por WhatsApp con un link de Google Maps de las tiendas">&#128241; Enviar ruta por WhatsApp</button>';
  html += '</div>';

  ruta.tiendas.forEach((t, idx) => {
    // Visita propia del vendedor de la ruta
    const visitOwn = getVisitaTienda(t.nombre);
    // Si fue derivada, tambien cuenta una visita registrada por el VDI (cualquier vendor)
    const visitAny = t.derivada
      ? findVisitForStoreAnyVendor(t.nombre, t.provincia, t.localidad, monthIdx, year)
      : null;
    const visit = visitOwn || visitAny;
    const visited = !!visit;
    // Determinar estado y clase para el color (verde > amarillo > gris)
    let cls = 'ruta-tienda pending';
    let tagCls = 'pending';
    let tagTxt = 'Pendiente';
    if (visited) {
      cls = 'ruta-tienda visited';
      tagCls = 'visited';
      tagTxt = '&#10003; Visitada';
    } else if (t.derivada) {
      cls = 'ruta-tienda derivada';
      tagCls = 'derivada';
      tagTxt = '&#9889; Derivada VDI';
    } else if (t.reagendadaPara) {
      cls = 'ruta-tienda reagendada';
      tagCls = 'reagendada';
      tagTxt = '&#128197; Reagendada';
    }
    html += '<div class="' + cls + '">';
    if (!visited && t.derivada) {
      html +=
        '<div class="ruta-tienda-reagenda-meta" style="color:#92400e">&#9889; Esperando contacto del VDI' +
        (t.derivadaA ? ' (' + escapeHtml(t.derivadaA) + ')' : '') +
        (t.derivadaAt ? ' &middot; derivada el ' + escapeHtml(t.derivadaAt) : '') +
        '</div>';
    }
    if (!visited && t.reagendadaPara)
      html +=
        '<div class="ruta-tienda-reagenda-meta">&#128197; Reagendada para ' +
        fmtFechaCorta(t.reagendadaPara) +
        '</div>';
    html += '<div class="ruta-tienda-head"><div>';
    html += '<div class="ruta-tienda-num">#' + (idx + 1) + '</div>';
    html += '<div class="ruta-tienda-name">' + escapeHtml(t.nombre) + '</div>';
    html +=
      '<div class="ruta-tienda-loc">' +
      escapeHtml(t.localidad) +
      ' &middot; ' +
      escapeHtml(t.provincia) +
      '</div>';
    html += '</div>';
    html += '<span class="ruta-tienda-tag ' + tagCls + '">' + tagTxt + '</span>';
    html += '</div>';

    if (visited && visit) {
      const fecha = visit.fecha ? new Date(visit.fecha).toLocaleDateString('es-AR') : '';
      const esTelefono = visit.tipoContacto === 'telefono';
      const verbo = esTelefono ? 'Contactada por telefono' : 'Visitada';
      const icon = esTelefono ? '&#128222; ' : '';
      html += '<div class="ruta-tienda-visit-meta">' + icon + verbo + ' el ' + escapeHtml(fecha);
      if (visit.ownerEmail) html += ' por ' + escapeHtml(visit.ownerEmail);
      html += '</div>';
      html +=
        '<button class="ruta-tienda-btn outline" onclick="event.stopPropagation();abrirVisitaExistente(\'' +
        escapeAttr(visit.id) +
        '\')">' +
        (esTelefono ? 'Ver contacto' : 'Ver visita') +
        '</button>';
    } else if (allowEdit) {
      const tNomJson = JSON.stringify(t.nombre).replace(/"/g, '&quot;');
      const tLocJson = JSON.stringify(t.localidad).replace(/"/g, '&quot;');
      const tProvJson = JSON.stringify(t.provincia).replace(/"/g, '&quot;');
      html +=
        '<button class="ruta-tienda-btn primary" onclick="abrirVisitaParaTienda(' +
        tLocJson +
        ', ' +
        tProvJson +
        ', ' +
        tNomJson +
        ')">Cargar visita</button>';
      html +=
        '<button class="ruta-tienda-btn outline" style="margin-top:6px;background:#fff;border:1.5px solid #0f766e;color:#0f766e" onclick="event.stopPropagation();marcarTiendaContactada(' +
        tLocJson +
        ', ' +
        tProvJson +
        ', ' +
        tNomJson +
        ')" title="Para usar cuando contactaste al cliente por telefono / mensaje y no necesitaste hacer la visita presencial. Se registra como Contactado y la tienda queda completada en la ruta.">&#128222; Marcar como contactado</button>';
    }
    html += '</div>';
  });

  document.getElementById('rutas-content').innerHTML = html;

  // Focus el mapa solo en las localidades involucradas en esta ruta.
  applyRouteMapFocus(ruta);
}

window.abrirVisitaParaTienda = function (localidad, provincia, tienda) {
  // Antes de abrir el form, preguntar si la tienda esta abierta
  openTiendaModal(localidad, provincia, tienda);
};

// Marca una tienda de la ruta como "contactada por telefono". A diferencia de
// "Cargar visita" no abre el form largo - solo registra un visit doc minimo
// con tipoContacto='telefono' para que la tienda figure como completada en la
// ruta y cuente para los stats del vendedor.
window.marcarTiendaContactada = async function (localidad, provincia, tienda) {
  if (typeof canWrite === 'function' && !canWrite()) {
    alert('No tenes permiso para registrar contactos.');
    return;
  }
  if (!currentUser) {
    alert('No hay usuario logueado.');
    return;
  }
  // Pregunta corta para confirmar + obtener una breve nota opcional.
  const nota = prompt(
    'Marcar como CONTACTADO por telefono / mensaje:\n\n' +
      tienda +
      '\n' +
      localidad +
      ', ' +
      titleCase(provincia) +
      '\n\n' +
      'Comentario corto (opcional - ej: "encargo Stradic", "no precisa pedido"):',
    ''
  );
  if (nota == null) return; // cancelo
  const now = new Date();
  const mes = MESES[now.getMonth()];
  const anio = now.getFullYear();
  // Vendedor efectivo (mismo que se usa para visitas reales - admin/VDI puede
  // estar actuando en nombre de un VDE).
  const actingPartner =
    typeof getActingVendorPartner === 'function' ? getActingVendorPartner() : null;
  const ownerUid = actingPartner ? actingPartner.uid : currentUser.uid;
  const ownerEmail = actingPartner ? actingPartner.email || '' : currentUser.email || '';
  const ownerName = actingPartner
    ? actingPartner.displayName || actingPartner.email || ''
    : currentUser.displayName || currentUser.email || '';
  // El vendor del visit doc TIENE que coincidir con el de la ruta activa, no
  // con currentVendor (que para admin es 'ALL' y haria que el visit no se
  // detecte y la tienda no se ponga verde). getActiveRutaVendor devuelve el
  // vendor del cual estamos viendo la ruta detallada.
  let vendor = '';
  if (typeof getActiveRutaVendor === 'function') {
    try {
      vendor = getActiveRutaVendor() || '';
    } catch (_e) {}
  }
  if (!vendor) {
    vendor =
      typeof currentVendor !== 'undefined' && currentVendor && currentVendor !== 'ALL'
        ? currentVendor
        : (actingPartner && actingPartner.vendorKey) || '';
  }
  const data = {
    tienda: tienda,
    localidad: localidad,
    provincia: provincia,
    vendor: vendor || '',
    ownerUid: ownerUid,
    ownerEmail: ownerEmail,
    ownerName: ownerName,
    tipoContacto: 'telefono',
    comentario: (nota || '').trim(),
    estado: 'abierta',
    fecha: now.toISOString().slice(0, 10),
    mes: mes,
    anio: anio,
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
  };
  try {
    await fbDb.collection('visits').add(data);
    showSyncTag('Contacto telefonico registrado');
    // Notificar al partner si admin/VDI marcaron en nombre de un VDE.
    if (actingPartner) {
      try {
        await fbDb.collection('notifications').add({
          type: 'partner_action',
          subtype: 'phone_contact_created',
          targetUid: actingPartner.uid,
          fromUid: currentUser.uid,
          fromEmail: currentUser.email || '',
          fromDisplayName: currentUser.displayName || currentUser.email || '',
          title:
            (currentUser.displayName || currentUser.email) +
            ' marco una tienda como contactada en tu nombre',
          body:
            'Tienda: ' +
            tienda +
            ' (' +
            localidad +
            ', ' +
            titleCase(provincia) +
            ').' +
            (nota ? ' Comentario: ' + nota : ''),
          tienda: tienda,
          provincia: provincia,
          localidad: localidad,
          status: 'unread',
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        });
      } catch (e) {
        console.warn('notif partner', e);
      }
    }
    // Refrescar UI: la ruta se redibuja con la tienda como Contactada.
    if (typeof renderRutaDetalle === 'function') {
      try {
        renderRutaDetalle();
      } catch (_e) {}
    }
  } catch (e) {
    console.error('marcarTiendaContactada', e);
    alert('Error registrando contacto: ' + (e.message || e));
  }
};

// ============================================================
// Enviar ruta por WhatsApp con link de Google Maps multi-parada
// ============================================================
// Numero de test pedido por el usuario. Cuando este productivo, hacer este
// numero configurable por vendedor o pasarlo a una collection.
const WHATSAPP_TEST_NUMBER = '5491126762031';
const MAPS_MAX_WAYPOINTS = 9; // limite de Google Maps Directions URL
function buildStopRef(t) {
  // Prioridad: 1) GPS preciso (client_locations) 2) direccion master (client_master) 3) string libre.
  const id = clientLocId(t.provincia, t.localidad, t.nombre);
  if (typeof clientLocsCache !== 'undefined' && clientLocsCache && clientLocsCache.size) {
    const loc = clientLocsCache.get(id);
    if (loc && typeof loc.lat === 'number' && typeof loc.lon === 'number') {
      return { value: loc.lat.toFixed(6) + ',' + loc.lon.toFixed(6), precise: true };
    }
  }
  if (typeof clientMasterCache !== 'undefined' && clientMasterCache && clientMasterCache.size) {
    const m = clientMasterCache.get(id);
    if (m && m.address) {
      const txt = m.address + ', ' + t.localidad + ', ' + t.provincia + ', Argentina';
      return { value: encodeURIComponent(txt), precise: true };
    }
  }
  const txt = t.nombre + ', ' + t.localidad + ', ' + t.provincia + ', Argentina';
  return { value: encodeURIComponent(txt), precise: false };
}
function buildRouteMapsUrl(tiendas, originLatLon) {
  // Asume tiendas.length <= MAPS_MAX_WAYPOINTS + 1 (caller debe partir si excede).
  // originLatLon opcional: {lat, lon} para arrancar la navegacion desde un punto especifico
  // (ej. ubicacion actual del vendedor). Si no se pasa, Maps usa la posicion del que abre el link.
  if (!tiendas || !tiendas.length) return null;
  const stops = tiendas.map(buildStopRef);
  const originParam =
    originLatLon && typeof originLatLon.lat === 'number' && typeof originLatLon.lon === 'number'
      ? '&origin=' + originLatLon.lat.toFixed(6) + ',' + originLatLon.lon.toFixed(6)
      : '';
  if (stops.length === 1) {
    return (
      'https://www.google.com/maps/dir/?api=1' +
      originParam +
      '&destination=' +
      stops[0].value +
      '&travelmode=driving'
    );
  }
  const dest = stops[stops.length - 1];
  const wpts = stops.slice(0, -1);
  return (
    'https://www.google.com/maps/dir/?api=1' +
    originParam +
    '&destination=' +
    dest.value +
    '&waypoints=' +
    wpts.map((s) => s.value).join('|') +
    '&travelmode=driving'
  );
}
// Lat/lon "best effort" para una tienda: usa GPS preciso de client_locations,
// sino lat/lon de la localidad (centro del pueblo) desde POINTS.
function getStoreLatLon(t) {
  if (typeof clientLocsCache !== 'undefined' && clientLocsCache && clientLocsCache.size) {
    const id = clientLocId(t.provincia, t.localidad, t.nombre);
    const loc = clientLocsCache.get(id);
    if (loc && typeof loc.lat === 'number' && typeof loc.lon === 'number') {
      return { lat: loc.lat, lon: loc.lon };
    }
  }
  const p = (typeof POINTS !== 'undefined' ? POINTS : []).find(
    (pp) => pp.province === t.provincia && pp.name === t.localidad
  );
  if (p && typeof p.lat === 'number' && typeof p.lon === 'number') {
    return { lat: p.lat, lon: p.lon };
  }
  return null;
}
// Nearest Neighbor (vecino mas cercano): arma orden secuencial empezando desde (originLat, originLon).
// En cada paso elige la tienda mas cercana a la posicion actual. No es optimo global pero da una
// ruta razonable y, lo mas importante, garantiza que las primeras tiendas son las mas cercanas
// al origen (lo que el vendedor pidio para que el tramo 1 sea el inicial).
function orderTiendasNearestNeighbor(tiendas, originLat, originLon) {
  const remaining = tiendas.slice();
  const ordered = [];
  let curLat = originLat,
    curLon = originLon;
  while (remaining.length) {
    let bestIdx = -1,
      bestD = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const ll = getStoreLatLon(remaining[i]);
      const d = ll ? haversineKm(curLat, curLon, ll.lat, ll.lon) : 1e9;
      if (d < bestD) {
        bestD = d;
        bestIdx = i;
      }
    }
    if (bestIdx < 0) {
      ordered.push(...remaining);
      break;
    }
    const next = remaining.splice(bestIdx, 1)[0];
    ordered.push(next);
    const nextLL = getStoreLatLon(next);
    if (nextLL) {
      curLat = nextLL.lat;
      curLon = nextLL.lon;
    }
  }
  return ordered;
}
// Divide un array de tiendas en N grupos balanceados, manteniendo orden secuencial.
// Cada grupo respeta el limite MAPS_MAX_WAYPOINTS + 1 (10 paradas).
// Ejemplo: 11 -> [6, 5]. 15 -> [8, 7]. 20 -> [10, 10]. 21 -> [7, 7, 7].
function splitTiendasBalanceado(tiendas) {
  const MAX = MAPS_MAX_WAYPOINTS + 1; // 10
  if (!tiendas || tiendas.length === 0) return [];
  if (tiendas.length <= MAX) return [tiendas.slice()];
  const numGrupos = Math.ceil(tiendas.length / MAX);
  const base = Math.floor(tiendas.length / numGrupos);
  const extra = tiendas.length - base * numGrupos; // primeros 'extra' grupos llevan 1 mas
  const grupos = [];
  let cursor = 0;
  for (let g = 0; g < numGrupos; g++) {
    const size = base + (g < extra ? 1 : 0);
    grupos.push(tiendas.slice(cursor, cursor + size));
    cursor += size;
  }
  return grupos;
}
window.sendRouteByWhatsApp = async function (rutaId) {
  const vendor = getActiveRutaVendor();
  const { monthIdx, year } = getRutaTargetMonth();
  if (!vendor) {
    alert('No se pudo determinar el vendedor de la ruta.');
    return;
  }
  const rutas = generarRutasVendor(vendor, monthIdx, year);
  const ruta = rutas.find((r) => r.id === rutaId);
  if (!ruta || !ruta.tiendas || !ruta.tiendas.length) {
    alert('La ruta no tiene tiendas para mapear.');
    return;
  }

  // ABRIMOS UNA TAB PLACEHOLDER YA (dentro del user gesture) - clave para
  // Safari iOS / Chrome PWA: window.open desde async post-await es bloqueado
  // porque el navegador ya no considera la accion como usuario. Abrimos
  // 'about:blank' ahora y despues cambiamos su location con la URL final.
  const isIOS = /iP(ad|hone|od)/i.test(navigator.userAgent);
  const waTab = isIOS ? window.open('about:blank', '_blank') : null;

  // GPS opcional: le damos max 5s con enableHighAccuracy=false. Es suficiente
  // para ubicar la ciudad y ordenar por proximidad. Antes usabamos 12s con
  // high accuracy y en iOS/Android sin GPS del sistema quedaba colgado ->
  // el vendedor veia "Obteniendo tu ubicacion..." indefinidamente y nunca
  // se abria WhatsApp.
  showSyncTag('Obteniendo ubicacion... (max 5s)');
  const gps = await captureGpsPositionFast();
  let orderedTiendas = ruta.tiendas;
  let originLatLon = null;
  let optimized = false;
  if (gps.status === 'ok') {
    originLatLon = { lat: gps.lat, lon: gps.lon };
    orderedTiendas = orderTiendasNearestNeighbor(ruta.tiendas, gps.lat, gps.lon);
    optimized = true;
    showSyncTag('Ubicacion OK, armando ruta...');
  } else {
    // No confirm dialogs - la user gesture ya se rompio con await, un
    // confirm ademas de trabar el flujo evita que window.open funcione.
    // Seguimos con orden por defecto en TODOS los casos (denied/timeout/etc).
    showSyncTag('Sin GPS: usando orden por defecto');
  }

  // Conteo global de precision GPS por tienda
  let fuzzyCount = 0;
  orderedTiendas.forEach((t) => {
    if (!buildStopRef(t).precise) fuzzyCount++;
  });
  // Particion en sub-grupos balanceados (max 10 paradas por link de Google Maps)
  const grupos = splitTiendasBalanceado(orderedTiendas);

  // Armar mensaje
  let msg = '*Ruta ' + (ruta.numero || '') + ' - ' + (ruta.titulo || '') + '*\n';
  if (ruta.fecha) msg += 'Fecha: ' + fmtFechaCorta(ruta.fecha) + '\n';
  msg += 'Vendedor: ' + titleCase(vendor) + '\n';
  msg += orderedTiendas.length + ' tiendas en total';
  if (grupos.length > 1)
    msg += ' (dividido en ' + grupos.length + ' tramos por limite de Google Maps)';
  msg += '\n';
  if (optimized) msg += '_Orden optimizado desde tu ubicacion actual (vecino mas cercano)._\n';
  let counter = 1;
  grupos.forEach((g, gi) => {
    // Solo el TRAMO 1 arranca con el GPS del vendedor como origen. Los tramos siguientes
    // dejan que Maps use "ubicacion actual" al momento de abrirlos (que sera la ultima tienda).
    const url = buildRouteMapsUrl(g, gi === 0 ? originLatLon : null);
    const label =
      grupos.length > 1
        ? 'TRAMO ' + (gi + 1) + '/' + grupos.length + ' (' + g.length + ' tiendas)'
        : 'Tiendas (' + g.length + ')';
    msg += '\n*' + label + '*\n';
    g.forEach((t) => {
      msg += counter + ') ' + t.nombre + ' - ' + t.localidad + '\n';
      counter++;
    });
    msg += 'Maps: ' + url + '\n';
  });
  if (fuzzyCount > 0) {
    msg +=
      '\n_AVISO: ' +
      fuzzyCount +
      ' tienda(s) sin GPS preciso ni direccion cargada. Maps las busca por nombre &mdash; chequea que caigan en el lugar correcto._';
  }
  if (grupos.length > 1) {
    msg +=
      '\n_Cuando termines el TRAMO 1, abri el link del TRAMO 2 (y asi) para continuar desde donde estes._';
  }
  // Numero destino: el que el admin configuro para este usuario en Panel Usuarios.
  // Si no tiene cargado, fallback al numero de test y avisamos.
  const destNumber =
    typeof myWhatsappNumber === 'string' && myWhatsappNumber
      ? myWhatsappNumber
      : WHATSAPP_TEST_NUMBER;
  if (destNumber === WHATSAPP_TEST_NUMBER && myWhatsappNumber !== WHATSAPP_TEST_NUMBER) {
    if (
      !confirm(
        'No tenes un numero de WhatsApp personal configurado. La ruta se va a enviar al numero de TEST (' +
          WHATSAPP_TEST_NUMBER +
          ').\n\nPedile a Mariano que en Panel Usuarios cargue tu numero personal y reintenta. ¿Continuar igual?'
      )
    )
      return;
  }
  const waUrl = 'https://wa.me/' + destNumber + '?text=' + encodeURIComponent(msg);
  // Estrategia doble para maximizar compatibilidad:
  // - En iOS ya abrimos una tab placeholder al inicio (dentro del gesture).
  //   Ahora le cambiamos el location a la URL de WA. Si el placeholder fallo
  //   (popup blocker), waTab es null y caemos al fallback.
  // - En Android/Desktop, window.open post-await funciona la mayoria de veces.
  //   Si no, tenemos fallback a location.href.
  let opened = false;
  if (waTab && !waTab.closed) {
    try {
      waTab.location.href = waUrl;
      opened = true;
    } catch (e) {
      console.warn('waTab.location.href', e);
    }
  }
  if (!opened) {
    const w = window.open(waUrl, '_blank');
    if (w) opened = true;
  }
  if (!opened) {
    // Ultimo fallback: navegar en la misma tab. Saca al vendedor de la app
    // pero al menos abre WhatsApp (que es lo importante). El usuario puede
    // volver con back.
    if (
      confirm(
        'El navegador bloqueo abrir WhatsApp en una nueva pestaña.\n\n¿Abrir WhatsApp en esta misma pantalla? (Vas a salir de la app.)'
      )
    ) {
      window.location.href = waUrl;
    }
  }
};

// Version rapida de captureGpsPosition: max 5s, sin high accuracy. Usada
// por el flujo de Enviar Ruta por WhatsApp donde precision aproximada es
// suficiente y no queremos hacer esperar al vendedor. La captureGpsPosition
// original (con high accuracy) sigue existiendo para el registro de visitas
// donde SI necesitamos precision para el check-in.
function captureGpsPositionFast() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve({ status: 'unavailable' });
      return;
    }
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      resolve(v);
    };
    const safety = setTimeout(() => finish({ status: 'timeout' }), 5500);
    // Checkeo previo del permission API (si esta disponible) para no
    // esperar 5s cuando ya sabemos que esta denegado.
    try {
      if (navigator.permissions && navigator.permissions.query) {
        navigator.permissions
          .query({ name: 'geolocation' })
          .then((res) => {
            if (res.state === 'denied') {
              clearTimeout(safety);
              finish({ status: 'denied' });
            }
          })
          .catch(() => {});
      }
    } catch (_e) {}
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        clearTimeout(safety);
        finish({ status: 'ok', lat: pos.coords.latitude, lon: pos.coords.longitude });
      },
      (err) => {
        clearTimeout(safety);
        const code = err && err.code;
        finish({ status: code === 1 ? 'denied' : code === 3 ? 'timeout' : 'error' });
      },
      { enableHighAccuracy: false, timeout: 5000, maximumAge: 60000 }
    );
  });
}

function abrirVisitaParaTienda_real(localidad, provincia, tienda) {
  openVisitaModal();
  setTimeout(() => {
    // v298+: vf-tienda es filter-select con value compuesto
    // "PROV||Loc||Tienda". Seteamos el value y onTiendaChange autocompleta
    // el hidden vf-localidad y muestra el badge de localidad detectada.
    const provU = (provincia || '').toUpperCase();
    const compositeVal = provU + '||' + localidad + '||' + tienda;
    const compositeLabel = tienda + ' — ' + localidad + ', ' + titleCase(provincia);
    // Verificar que la tienda este en el registry poblado por
    // populateVisitaLocalidades (si no, no la puede seleccionar el user tampoco).
    const cfgT = typeof _fsRegistry !== 'undefined' ? _fsRegistry['vf-tienda'] : null;
    if (!cfgT || !(cfgT.options || []).find((o) => o.value === compositeVal)) return;
    fsSetValue('vf-tienda', compositeVal, compositeLabel);
    onTiendaChange(compositeVal);
  }, 120);
}

window.abrirVisitaExistente = function (visitId) {
  if (typeof window.viewVisit === 'function') {
    openVisitaModal();
    setTimeout(() => window.viewVisit(visitId), 80);
  } else {
    openVisitaModal();
  }
};

// === Exports a window para callers cross-scope ===
// Funciones llamadas desde fuera del bloque rutas (líneas 7698, 10819-10828,
// 12032, 13117-18, 13644-45, 13694, 13779, 24827 pre-E2.f):
window.generarRutasVendor = generarRutasVendor;
window.getTiendasVisitadasMes = getTiendasVisitadasMes;
window.renderRutasTab = renderRutasTab;
window.renderRutaDetalle = renderRutaDetalle;
window.ensureVisitsListener = ensureVisitsListener;
window.getActiveRutaVendor = getActiveRutaVendor;
window.getRutaTargetMonth = getRutaTargetMonth;
window.haversineKm = haversineKm;
window.ensureCustomRoutesListener = ensureCustomRoutesListener;
// E6 hotfix 2: abrirVisitaParaTienda_real llamada desde inline L8542 (reagendamiento).
window.abrirVisitaParaTienda_real = abrirVisitaParaTienda_real;
