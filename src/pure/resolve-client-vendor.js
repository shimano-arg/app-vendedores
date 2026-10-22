// @ts-check
/**
 * v1406 (2026-10-22) §44 — resolver el vendedor del cliente desde el master
 * SIEMPRE que se cree o unifique un pedido / waitlist. El Planner filtra por
 * ese vendedor; el "Cargado por" queda como dato secundario.
 *
 * Esta función es pure (deps-injected) para testear sin DOM. El wrapper DOM
 * `window._resolveClientVendorFromMaster` en index.html inyecta `POINTS`,
 * `vdiPartnerUsers`, `getEffectiveVendorForClient`, `sapGetClienteCode`.
 */

/**
 * @typedef {Object} ClientVendorResolution
 * @property {string} vendorKey - vendorKey canónico del VDE (ej. "FEDERICO"). "" si no hay.
 * @property {string} vendorUid - UID Firestore del VDE. "" si no hay.
 * @property {string} vendorEmail - email del VDE. "" si no hay.
 * @property {boolean} resolved - true si vendorKey quedó populated.
 */

/**
 * Resuelve el vendedor de un cliente desde el master OCRD/POINTS.
 *
 * Lookup strategy:
 *   1. Buscar POINT por `cardCode` (recorriendo `p.clients` + sapGetClienteCode).
 *   2. Si no hay match por cardCode, buscar por `clientName` exacto (case-insensitive).
 *   3. Resolver vendorKey via `getEffectiveVendorForClient(point, clientName)`.
 *   4. Buscar UID + email en `vdiPartnerUsers` por `vendorKey`.
 *
 * @param {Object} args
 * @param {string} [args.cardCode] - CardCode SAP del cliente (preferido).
 * @param {string} [args.clientName] - Nombre del cliente (fallback).
 * @param {Array<any>} [args.points] - Catálogo de POINTS.
 * @param {Array<{uid:string, email:string, vendorKey:string, displayName?:string}>} [args.vdiPartnerUsers] - Users cache.
 * @param {(p:any, name:string) => string} [args.getEffectiveVendorForClient]
 * @param {(name:string) => string} [args.sapGetClienteCode]
 * @returns {ClientVendorResolution}
 */
export function resolveClientVendorFromMaster(args) {
  const EMPTY = { vendorKey: '', vendorUid: '', vendorEmail: '', resolved: false };
  if (!args) return EMPTY;
  const cardCode = String(args.cardCode || '').trim();
  const clientName = String(args.clientName || '').trim();
  const points = Array.isArray(args.points) ? args.points : [];
  const vdiPartnerUsers = Array.isArray(args.vdiPartnerUsers) ? args.vdiPartnerUsers : [];
  const getVendor =
    typeof args.getEffectiveVendorForClient === 'function'
      ? args.getEffectiveVendorForClient
      : null;
  const getCardCode = typeof args.sapGetClienteCode === 'function' ? args.sapGetClienteCode : null;
  if (!cardCode && !clientName) return EMPTY;
  if (points.length === 0) return EMPTY;

  /** @type {any} */
  let point = null;
  let matchName = clientName;

  // 1. Buscar por cardCode.
  if (cardCode && getCardCode) {
    for (const p of points) {
      const clients = Array.isArray(p.clients) ? p.clients : [];
      for (const n of clients) {
        try {
          if (getCardCode(n) === cardCode) {
            point = p;
            matchName = n;
            break;
          }
        } catch (_e) {
          /* ignore */
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

  if (!point) return EMPTY;

  // 3. vendorKey canónico.
  let vendorKey = '';
  if (getVendor) {
    try {
      vendorKey = String(getVendor(point, matchName) || '').trim();
    } catch (_e) {
      /* ignore */
    }
  }
  if (!vendorKey) vendorKey = String(point.vendor || '').trim();
  if (!vendorKey) return EMPTY;

  // 4. UID + email del VDE.
  const match = vdiPartnerUsers.find((u) => String((u && u.vendorKey) || '').trim() === vendorKey);
  const vendorUid = match ? String(match.uid || '') : '';
  const vendorEmail = match ? String(match.email || '') : '';

  return {
    vendorKey,
    vendorUid,
    vendorEmail,
    resolved: true,
  };
}

/**
 * Enriquece un payload de pedido / waitlist con los campos del vendedor del
 * cliente. Idempotente: si ya tiene `assignedVendorUid` set (unificación),
 * NO lo pisa; solo rellena si falta. Para unificación el target conserva su
 * vendor original.
 *
 * Campos agregados / normalizados en el payload:
 *   - `vendorAssigned`: vendorKey del VDE del cliente master (o '').
 *   - `assignedVendorUid`: UID del VDE del master (o '').
 *   - `assignedVendorEmail`: email del VDE (o '').
 *   - `ownerVendor`: alineado con `vendorAssigned` (reemplaza el valor viejo
 *      que leía `assignedVendor` del user logueado).
 *   - `cargadoPorUid`: alias de `ownerUid` (para claridad; `ownerUid` sigue
 *      siendo quien cargó por restricción de rules revision_waitlist).
 *   - `cargadoPorEmail`: alias de `ownerEmail`.
 *
 * @param {any} payload - Payload mutable con shape dinámico (pedido o waitlist).
 * @param {ClientVendorResolution} resolution
 * @param {{ cargadoPorUid?: string, cargadoPorEmail?: string }} [cargadoPor]
 * @returns {any} el mismo payload (mutado).
 */
export function enrichPayloadWithClientVendor(payload, resolution, cargadoPor) {
  if (!payload || typeof payload !== 'object') return payload;
  const res = resolution || { vendorKey: '', vendorUid: '', vendorEmail: '', resolved: false };
  // Si target ya tiene assignedVendorUid NO vacío (unificación con un target
  // existente que ya se resolvió una vez), preservar.
  const alreadyAssigned =
    payload.assignedVendorUid && String(payload.assignedVendorUid).trim() !== '';
  if (!alreadyAssigned) {
    payload.vendorAssigned = res.vendorKey || '';
    payload.assignedVendorUid = res.vendorUid || '';
    payload.assignedVendorEmail = res.vendorEmail || '';
    payload.ownerVendor = res.vendorKey || '';
  }
  // cargadoPor siempre set (idempotente: si ya viene, respetar; si no, inyectar).
  if (cargadoPor && typeof cargadoPor === 'object') {
    if (cargadoPor.cargadoPorUid && !payload.cargadoPorUid) {
      payload.cargadoPorUid = String(cargadoPor.cargadoPorUid);
    }
    if (cargadoPor.cargadoPorEmail && !payload.cargadoPorEmail) {
      payload.cargadoPorEmail = String(cargadoPor.cargadoPorEmail);
    }
  }
  // Backfill desde ownerUid/ownerEmail si cargadoPor no provisto.
  if (!payload.cargadoPorUid && payload.ownerUid) {
    payload.cargadoPorUid = String(payload.ownerUid);
  }
  if (!payload.cargadoPorEmail && payload.ownerEmail) {
    payload.cargadoPorEmail = String(payload.ownerEmail);
  }
  return payload;
}
