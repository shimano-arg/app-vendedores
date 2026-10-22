// @ts-check
/**
 * v1408 (2026-10-22) §46 — resolver el vendedor de un pedido/waitlist usando
 * la MISMA cadena que el resto de la app:
 *   cliente → zona asignada (POINT + overrides shop/loc/prov) → vendedor de la zona.
 *
 * Firma del VDE buscada en `users` cache unificado (VDE + VDI + admin + gerente)
 * para que el filtro Planner por UID funcione para los 4 roles. "sin vendedor"
 * se diferencia por motivo (cliente sin zona vs zona sin vendedor).
 *
 * Precedente v1406: solo miraba `vdiPartnerUsers` que contiene únicamente
 * `role='interno'`. Los VDEs (Mauricio Gil, Pachi, Gonzalo, Federico) nunca
 * matcheaban → `vendorUid=""` → filtro Planner VDE ciego para ellos.
 */

/**
 * @typedef {Object} ClientVendorResolution
 * @property {string} vendorKey - vendorKey canónico (ej. "MAURICIO GIL"). "" si no hay.
 * @property {string} vendorUid - UID Firestore del user del vendedor. "" si no hay.
 * @property {string} vendorEmail - email del vendedor. "" si no hay.
 * @property {boolean} resolved - true si vendorKey quedó populated.
 * @property {'ok'|'cliente_no_en_master'|'cliente_sin_zona'|'zona_sin_vendedor'|'vendor_sin_uid'|'input_vacio'} reason
 */

const EMPTY = /** @type {ClientVendorResolution} */ ({
  vendorKey: '',
  vendorUid: '',
  vendorEmail: '',
  resolved: false,
  reason: 'input_vacio',
});

/**
 * Normaliza cardCode SAP: trim + uppercase.
 * @param {any} cc
 * @returns {string}
 */
function normCardCode(cc) {
  return String(cc || '')
    .trim()
    .toUpperCase();
}

/**
 * Resuelve el vendedor de un cliente usando la cadena cliente → zona → vendedor.
 *
 * Steps:
 *   1. Normalizar cardCode y buscar POINT por cardCode (`sapGetClienteCode`).
 *   2. Fallback: buscar POINT por clientName exacto (case-insensitive).
 *   3. Resolver vendorKey via `getEffectiveVendorForClient(point, name)` que
 *      aplica overrides shop > loc > prov > `point.vendor`.
 *   4. Lookup UID + email en `users` (unión VDE + VDI + admin + gerente).
 *
 * Reasons:
 *   - `ok`: vendorKey + vendorUid resueltos.
 *   - `vendor_sin_uid`: vendorKey OK pero sin match en users (user no cargado
 *     en cache; vendorKey queda igual pero sin UID → el filtro Planner no
 *     funciona hasta backfill).
 *   - `zona_sin_vendedor`: point existe pero `getEffectiveVendorForClient`
 *     devolvió vacío (zona sin asignar).
 *   - `cliente_no_en_master`: no se encontró POINT para cardCode ni clientName.
 *   - `cliente_sin_zona`: alias de `cliente_no_en_master` (cliente SAP sin
 *     POINT local = sin zona registrada).
 *   - `input_vacio`: args sin cardCode ni clientName.
 *
 * @param {Object} args
 * @param {string} [args.cardCode] - CardCode SAP (preferido).
 * @param {string} [args.clientName] - Nombre del cliente (fallback).
 * @param {Array<any>} [args.points] - Catálogo de POINTS.
 * @param {Array<{uid:string, email?:string, vendorKey:string}>} [args.users] - Union de VDE+VDI+admin+gerente.
 * @param {Array<{uid:string, email?:string, vendorKey:string}>} [args.vdiPartnerUsers] - DEPRECATED (compat v1406). Se mergea con users.
 * @param {(p:any, name:string) => string} [args.getEffectiveVendorForClient]
 * @param {(name:string) => string} [args.sapGetClienteCode]
 * @returns {ClientVendorResolution}
 */
export function resolveClientVendorFromMaster(args) {
  if (!args) return EMPTY;
  const cardCode = normCardCode(args.cardCode);
  const clientName = String(args.clientName || '').trim();
  const points = Array.isArray(args.points) ? args.points : [];
  // v1408 §46: aceptamos ambos nombres (users nuevo + vdiPartnerUsers legacy)
  // y los mergeamos para que el lookup cubra los 4 roles.
  const usersUnion = /** @type {Array<any>} */ ([]);
  if (Array.isArray(args.users)) usersUnion.push(...args.users);
  if (Array.isArray(args.vdiPartnerUsers)) {
    for (const u of args.vdiPartnerUsers) {
      if (!usersUnion.some((x) => x && x.uid === u.uid)) usersUnion.push(u);
    }
  }
  const getVendor =
    typeof args.getEffectiveVendorForClient === 'function'
      ? args.getEffectiveVendorForClient
      : null;
  const getCardCode = typeof args.sapGetClienteCode === 'function' ? args.sapGetClienteCode : null;

  if (!cardCode && !clientName) {
    return { ...EMPTY, reason: 'input_vacio' };
  }
  if (points.length === 0) {
    return { ...EMPTY, reason: 'cliente_no_en_master' };
  }

  /** @type {any} */
  let point = null;
  let matchName = clientName;

  // 1. Buscar por cardCode normalizado.
  if (cardCode && getCardCode) {
    for (const p of points) {
      const clients = Array.isArray(p.clients) ? p.clients : [];
      for (const n of clients) {
        try {
          if (normCardCode(getCardCode(n)) === cardCode) {
            point = p;
            matchName = n;
            break;
          }
        } catch (_e) {
          /* ignore lookup errors por cliente */
        }
      }
      if (point) break;
    }
  }

  // 2. Fallback por clientName.
  if (!point && clientName) {
    const target = clientName.toLowerCase();
    for (const p of points) {
      const clients = Array.isArray(p.clients) ? p.clients : [];
      if (clients.some((/** @type {any} */ n) => String(n).trim().toLowerCase() === target)) {
        point = p;
        matchName = clientName;
        break;
      }
    }
  }

  if (!point) {
    return {
      ...EMPTY,
      reason: 'cliente_no_en_master',
    };
  }

  // 3. vendorKey canónico desde la cadena de overrides.
  let vendorKey = '';
  if (getVendor) {
    try {
      vendorKey = String(getVendor(point, matchName) || '').trim();
    } catch (_e) {
      /* ignore */
    }
  }
  if (!vendorKey) vendorKey = String(point.vendor || '').trim();
  // "__DISTRIBUTOR__" NO es un vendedor real (venta indirecta via distribuidor).
  if (vendorKey === '__DISTRIBUTOR__') vendorKey = '';
  if (!vendorKey) {
    return {
      ...EMPTY,
      reason: 'zona_sin_vendedor',
    };
  }

  // 4. UID + email: lookup en la unión de users.
  const match = usersUnion.find((u) => String((u && u.vendorKey) || '').trim() === vendorKey);
  const vendorUid = match ? String(match.uid || '') : '';
  const vendorEmail = match ? String(match.email || '') : '';

  return {
    vendorKey,
    vendorUid,
    vendorEmail,
    resolved: true,
    reason: vendorUid ? 'ok' : 'vendor_sin_uid',
  };
}

/**
 * Enriquece un payload de pedido / waitlist con los campos del vendedor del
 * cliente. Idempotente: si ya tiene `assignedVendorUid` set (unificación),
 * NO lo pisa; solo rellena si falta.
 *
 * Agrega el `reason` como `assignedVendorReason` para que la UI pueda
 * mostrarlo como mensaje contextual ("sin vendedor: cliente sin zona").
 *
 * @param {any} payload
 * @param {ClientVendorResolution} resolution
 * @param {{ cargadoPorUid?: string, cargadoPorEmail?: string }} [cargadoPor]
 * @returns {any}
 */
export function enrichPayloadWithClientVendor(payload, resolution, cargadoPor) {
  if (!payload || typeof payload !== 'object') return payload;
  const res =
    resolution ||
    /** @type {ClientVendorResolution} */ ({
      vendorKey: '',
      vendorUid: '',
      vendorEmail: '',
      resolved: false,
      reason: 'input_vacio',
    });
  const alreadyAssigned =
    payload.assignedVendorUid && String(payload.assignedVendorUid).trim() !== '';
  if (!alreadyAssigned) {
    payload.vendorAssigned = res.vendorKey || '';
    payload.assignedVendorUid = res.vendorUid || '';
    payload.assignedVendorEmail = res.vendorEmail || '';
    payload.ownerVendor = res.vendorKey || '';
    payload.assignedVendorReason = res.reason || '';
  }
  if (cargadoPor && typeof cargadoPor === 'object') {
    if (cargadoPor.cargadoPorUid && !payload.cargadoPorUid) {
      payload.cargadoPorUid = String(cargadoPor.cargadoPorUid);
    }
    if (cargadoPor.cargadoPorEmail && !payload.cargadoPorEmail) {
      payload.cargadoPorEmail = String(cargadoPor.cargadoPorEmail);
    }
  }
  if (!payload.cargadoPorUid && payload.ownerUid) {
    payload.cargadoPorUid = String(payload.ownerUid);
  }
  if (!payload.cargadoPorEmail && payload.ownerEmail) {
    payload.cargadoPorEmail = String(payload.ownerEmail);
  }
  return payload;
}

/**
 * Human-readable del motivo "sin vendedor" para la UI.
 *
 * @param {string} reason
 * @returns {string}
 */
export function formatAssignedVendorReason(reason) {
  switch (reason) {
    case 'ok':
      return '';
    case 'cliente_no_en_master':
    case 'cliente_sin_zona':
      return 'cliente sin zona';
    case 'zona_sin_vendedor':
      return 'zona sin vendedor';
    case 'vendor_sin_uid':
      return 'vendedor sin usuario';
    case 'input_vacio':
      return 'sin cliente';
    default:
      return reason ? String(reason) : '';
  }
}
