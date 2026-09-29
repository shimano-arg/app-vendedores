// @ts-check
/**
 * denorm-visit-to-client-master-core — denormaliza los últimos atributos
 * comerciales cargados por el vendedor en una visita hacia el doc del cliente
 * en `client_master`, para que la app y PowerBI puedan leer el "estado actual"
 * sin agregar visits en cada query.
 *
 * Motivación (2026-09-24, pedido Mariano):
 *   - Los campos `fidelidad`, `tamanos[]`, `especializaciones[]`, `canalCompra`,
 *     `tipoVenta` (+ ponderaciones) hoy solo viven en cada doc de `visits`. Si
 *     Gonzalo visita a Mariano Pesca 3 veces con fidelidad BAJA/BAJA/ALTA, no
 *     hay ningún lugar donde leer "el actual es ALTA".
 *   - Este core resuelve `docId = clientLocId(provincia, localidad, tienda)` y
 *     escribe un subobjeto `lastVisit` en `client_master.{docId}` con los 5+
 *     atributos + fecha + autor + visitId.
 *   - Guard temporal LWW real: si la visita nueva tiene `fecha` MÁS VIEJA que
 *     el `lastVisit.fecha` actual, skip. Cubre backfill fuera de orden y triggers
 *     que llegan tarde por retry del runtime.
 *
 * Regla CLAUDE.md #7: core puro con deps inyectables (db, log, FieldValue).
 * Wrapper en functions/index.js hace el plumbing Firebase.
 */

/**
 * Normaliza un string para usar como componente de docId. Espeja la función
 * `clientLocId` de src/domains/visitas.js:43 — CUIDADO: no cambiar la lógica
 * sin actualizar ambos lados o los docs quedan desincronizados.
 * @param {string | null | undefined} s
 * @returns {string}
 */
function norm(s) {
  return (s || '')
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

/**
 * @param {string} prov
 * @param {string} locName
 * @param {string} tienda
 */
export function clientLocId(prov, locName, tienda) {
  return norm(prov) + '__' + norm(locName) + '__' + norm(tienda);
}

/**
 * Extrae el subset de campos "lastVisit" desde el doc de la visita.
 * Ignora campos vacíos para no pisar valores anteriores con blanks.
 * @param {Record<string, any>} visit
 * @param {string} visitId
 * @returns {Record<string, any> | null} subobjeto lastVisit o null si no hay data útil
 */
export function extractLastVisitPayload(visit, visitId) {
  const out = {};
  if (visit.fidelidad) out.fidelidad = String(visit.fidelidad);
  if (Array.isArray(visit.tamanos) && visit.tamanos.length) {
    out.tamanos = visit.tamanos.slice();
  } else if (typeof visit.tamano === 'string' && visit.tamano.trim()) {
    // v1057: fallback a campo legacy pre-v498 (2026-08-12). Antes de v498 solo
    // se guardaba `tamano` como STRING join (ej "GRANDE, MULTIRUBRO"). Sin este
    // fallback, ~287 visitas históricas no contribuyen a lastVisit.tamanos.
    out.tamanos = visit.tamano
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  if (Array.isArray(visit.especializaciones) && visit.especializaciones.length) {
    out.especializaciones = visit.especializaciones.slice();
  } else if (typeof visit.especializacion === 'string' && visit.especializacion.trim()) {
    // v1057: fallback legacy idem tamano.
    out.especializaciones = visit.especializacion
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  if (visit.canalCompra) out.canalCompra = String(visit.canalCompra);
  if (visit.tipoVenta) out.tipoVenta = String(visit.tipoVenta);
  if (visit.tipoVenta === 'AMBOS') {
    if (typeof visit.ponderacionMostrado === 'number')
      out.ponderacionMostrado = visit.ponderacionMostrado;
    if (typeof visit.ponderacionEcommerce === 'number')
      out.ponderacionEcommerce = visit.ponderacionEcommerce;
  }
  // Si la visita no trajo NINGÚN atributo comercial (ej. modo 'contacto'
  // telefónico donde el vendedor solo marca formaContacto), no vale la pena
  // escribir nada — no hay señal.
  if (Object.keys(out).length === 0) return null;
  out.fecha = visit.fecha || '';
  out.byUid = visit.createdByUid || '';
  out.byDisplayName = visit.createdByDisplayName || visit.createdByEmail || '';
  out.visitId = visitId;
  return out;
}

/**
 * Compara la fecha de la visita nueva contra el lastVisit ya guardado.
 * @param {string} newFecha ISO date string (YYYY-MM-DD)
 * @param {any} prevLastVisit doc actual o undefined
 * @returns {boolean} true si la nueva es >= prev (o no había prev)
 */
export function isNewerOrEqual(newFecha, prevLastVisit) {
  if (!prevLastVisit || !prevLastVisit.fecha) return true;
  return String(newFecha) >= String(prevLastVisit.fecha);
}

/**
 * Handler principal. Recibe el visit doc + params + deps inyectables.
 * @param {{ visit: Record<string, any>, visitId: string }} input
 * @param {{
 *   db: any,
 *   FieldValue: any,
 *   log?: (msg: string, extra?: any) => void,
 * }} deps
 * @returns {Promise<{ status: 'ok' | 'skipped', reason?: string, docId?: string }>}
 */
export async function denormVisitToClientMaster(input, deps) {
  const { visit, visitId } = input;
  const { db, FieldValue, log = () => {} } = deps;
  const prov = visit.provincia || '';
  const loc = visit.localidad || '';
  const tienda = visit.tienda || '';
  if (!prov || !loc || !tienda) {
    log('[denorm-visit] skip: missing prov/loc/tienda', { visitId });
    return { status: 'skipped', reason: 'missing_prov_loc_tienda' };
  }
  const docId = clientLocId(prov, loc, tienda);
  const payload = extractLastVisitPayload(visit, visitId);
  if (!payload) {
    log('[denorm-visit] skip: no commercial attributes', { visitId, docId });
    return { status: 'skipped', reason: 'no_attributes', docId };
  }
  const ref = db.collection('client_master').doc(docId);
  const snap = await ref.get();
  const prev = snap.exists ? snap.data() : null;
  const prevLast = prev && prev.lastVisit;
  if (!isNewerOrEqual(payload.fecha, prevLast)) {
    log('[denorm-visit] skip: older than existing lastVisit', {
      visitId,
      docId,
      newFecha: payload.fecha,
      prevFecha: prevLast && prevLast.fecha,
    });
    return { status: 'skipped', reason: 'older_than_existing', docId };
  }
  // Preservar el resto de client_master (address, cliTipo, creditoCheque,
  // defaultDelivery, etc.) — merge:true. Solo pisamos `lastVisit` +
  // updatedAt/By. Los metadatos vendor/prov/loc/clientName los populamos SÓLO
  // si el doc no existía (create), no queremos pisar los que el admin cargó
  // manualmente en Master Clientes.
  /** @type {Record<string, any>} */
  const update = {
    lastVisit: payload,
    lastVisitDenormAt: FieldValue.serverTimestamp(),
  };
  if (!snap.exists) {
    update.provincia = prov;
    update.localidad = loc;
    update.clientName = tienda;
    update.vendor = visit.createdByEmail || '';
    update.updatedAt = FieldValue.serverTimestamp();
    update.updatedBy = 'denormVisitToClientMaster';
  }
  await ref.set(update, { merge: true });
  log('[denorm-visit] wrote lastVisit', {
    visitId,
    docId,
    created: !snap.exists,
    fidelidad: payload.fidelidad,
    tamanos: payload.tamanos && payload.tamanos.length,
  });
  return { status: 'ok', docId };
}
