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
 *   - `cliente_no_en_master`: no se encontró POINT ni approvedAlta para
 *     cardCode ni clientName.
 *   - `cliente_sin_zona`: alias de `cliente_no_en_master` (cliente SAP sin
 *     POINT local = sin zona registrada).
 *   - `input_vacio`: args sin cardCode ni clientName.
 *
 * v1412 §50 (2026-10-22) — EXTIENDE §46: agrega `approvedAltas` como SEGUNDA
 * fuente del master. Las altas SAP huérfanas (clientes sync-SAP sin POINT
 * histórico) viven en `approvedAltasList` con `assignedVendor` directo. El
 * Master Clientes las muestra desde ahí; el helper previo las descartaba.
 * Reporte Mariano: BURELLA (C20203196122) y COLLI (C20116066670) con zona
 * Z5 Mauricio en Master Clientes pero sin vendedor en Planner.
 *
 * Lookup strategy post-v1412:
 *   1. POINTS por cardCode → `getEffectiveVendorForClient(point, name)`.
 *   2. POINTS por clientName → `getEffectiveVendorForClient(point, name)`.
 *   3. **NUEVO**: `approvedAltas` por `cardCodeSap === cardCode` → `a.assignedVendor`.
 *   4. **NUEVO**: `approvedAltas` por `comercio|fantasia === clientName` → `a.assignedVendor`.
 *
 * Además: normalización vendorKey ante guardados históricos como label
 * ("Z5 - Mauricio Gil") en lugar de key canónica.
 *
 * @param {Object} args
 * @param {string} [args.cardCode] - CardCode SAP (preferido).
 * @param {string} [args.clientName] - Nombre del cliente (fallback).
 * @param {Array<any>} [args.points] - Catálogo de POINTS.
 * @param {Array<any>} [args.approvedAltas] - approvedAltasList (altas SAP huérfanas).
 * @param {Array<{uid:string, email?:string, vendorKey:string}>} [args.users] - Union VDE+VDI+admin+gerente.
 * @param {Array<{uid:string, email?:string, vendorKey:string}>} [args.vdiPartnerUsers] - DEPRECATED (compat v1406).
 * @param {(p:any, name:string) => string} [args.getEffectiveVendorForClient]
 * @param {(name:string) => string} [args.sapGetClienteCode]
 * @returns {ClientVendorResolution}
 */
export function resolveClientVendorFromMaster(args) {
  if (!args) return EMPTY;
  const cardCode = normCardCode(args.cardCode);
  const clientName = String(args.clientName || '').trim();
  const points = Array.isArray(args.points) ? args.points : [];
  const approvedAltas = Array.isArray(args.approvedAltas) ? args.approvedAltas : [];
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

  /** @type {any} */
  let point = null;
  let matchName = clientName;

  // 1. Buscar POINT por cardCode normalizado.
  if (cardCode && getCardCode && points.length > 0) {
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

  // 2. Fallback POINT por clientName.
  if (!point && clientName && points.length > 0) {
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

  let vendorKey = '';
  let sourceLabel = '';
  /** @type {any} */
  let alta = null;

  if (point) {
    // 3. vendorKey canónico desde la cadena de overrides POINTS.
    if (getVendor) {
      try {
        vendorKey = String(getVendor(point, matchName) || '').trim();
      } catch (_e) {
        /* ignore */
      }
    }
    if (!vendorKey) vendorKey = String(point.vendor || '').trim();
    sourceLabel = 'point';
  } else if (approvedAltas.length > 0) {
    // v1412 §50 NEW: buscar en approvedAltasList (altas SAP huérfanas).
    // 4. Buscar alta por cardCodeSap normalizado.
    if (cardCode) {
      alta = approvedAltas.find(
        (/** @type {any} */ a) => a && normCardCode(a.cardCodeSap) === cardCode
      );
    }
    // 5. Fallback alta por nombre (comercio o fantasia).
    if (!alta && clientName) {
      const target = clientName.toLowerCase();
      alta = approvedAltas.find(
        (/** @type {any} */ a) =>
          a &&
          (String(a.comercio || '')
            .trim()
            .toLowerCase() === target ||
            String(a.fantasia || '')
              .trim()
              .toLowerCase() === target)
      );
    }
    if (alta) {
      vendorKey = String(alta.assignedVendor || '').trim();
      sourceLabel = 'approvedAlta';
    }
  }

  // Si no se encontró ni POINT ni alta → cliente no está en el master.
  if (!point && !alta) {
    return {
      ...EMPTY,
      reason: 'cliente_no_en_master',
    };
  }

  // Normalizar vendorKey: si vino como label "Z<N> - Nombre" (histórico mal
  // formateado), extraer el nombre y uppercase. Idempotente para keys canónicas.
  const labelMatch = vendorKey.match(/^Z\d+\s*[-–—]\s*(.+)$/i);
  if (labelMatch) {
    vendorKey = labelMatch[1].trim().toUpperCase();
  }
  // "__DISTRIBUTOR__" NO es un vendedor real (venta indirecta via distribuidor).
  if (vendorKey === '__DISTRIBUTOR__') vendorKey = '';
  if (!vendorKey) {
    return {
      ...EMPTY,
      reason: 'zona_sin_vendedor',
    };
  }

  // UID + email: lookup en la unión de users.
  // v1412 §50: fallback case-insensitive + primer nombre si no hay match exacto.
  let match = usersUnion.find(
    (/** @type {any} */ u) => String((u && u.vendorKey) || '').trim() === vendorKey
  );
  if (!match) {
    const vkLc = vendorKey.toLowerCase();
    match = usersUnion.find(
      (/** @type {any} */ u) =>
        String((u && u.vendorKey) || '')
          .trim()
          .toLowerCase() === vkLc
    );
  }
  if (!match) {
    const vkFirst = vendorKey.split(/\s+/)[0].toUpperCase();
    if (vkFirst && vkFirst.length >= 3) {
      match = usersUnion.find((/** @type {any} */ u) => {
        const key = String((u && u.vendorKey) || '')
          .trim()
          .toUpperCase();
        return key === vkFirst || key.startsWith(vkFirst + ' ');
      });
    }
  }
  const vendorUid = match ? String(match.uid || '') : '';
  const vendorEmail = match ? String(match.email || '') : '';

  const result = /** @type {any} */ ({
    vendorKey,
    vendorUid,
    vendorEmail,
    resolved: true,
    reason: vendorUid ? 'ok' : 'vendor_sin_uid',
    source: sourceLabel,
  });
  return result;
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
/** Roles cuyos usuarios pueden tener cartera, en orden de precedencia (§46). */
const ROLES_CON_CARTERA = ['vendedor', 'interno', 'gerente', 'admin'];

/** VDIs con zona histórica: la pantalla deduce su vendorKey del displayName. */
const VDI_VENDOR_KEYS = ['IOANNIS PALKOUDAKIS', 'SANTIAGO ESTEBAN'];

/**
 * vendorKey de un doc de `roles`, con la misma regla que la pantalla
 * (`loadVdiPartnerUsers` en index.html): `vendor` si está cargado; para un
 * VDI (rol interno) sin `vendor`, el vendor histórico cuyo primer nombre
 * aparece en displayName/email. ORDEN 653 BENGOCHEA (29/10): el usuario de
 * Ioannis no tiene `vendor` y el servidor lo descartaba → VENDOR_UID_MISSING.
 *
 * @param {string} role
 * @param {any} data
 * @returns {string}
 */
export function vendorKeyFromRoleDoc(role, data) {
  const v = String((data && data.vendor) || '').trim();
  if (v) return v;
  if (role !== 'interno') return '';
  const dn = String((data && (data.displayName || data.email)) || '').toUpperCase();
  for (const known of VDI_VENDOR_KEYS) {
    if (dn.includes(known.split(' ')[0])) return known;
  }
  return '';
}

/**
 * v1491 §89 HOTFIX (2026-10-27) — resolución SERVER-SIDE del vendedor del cliente.
 *
 * Fetchea el master (approvedAltas) + users (roles) desde Firestore con admin
 * SDK (bypassa rules que bloquean a VDE la lectura de `roles` cross-user) y
 * delega al pure `resolveClientVendorFromMaster`.
 *
 * Usado por `commit-pedido-core.js` ANTES del gate `VENDOR_UID_MISSING` para
 * resolver UID server-side cuando el cliente no lo pudo pre-resolver (típico
 * VDE: `roles` rule bloquea → `vdeUsers=[]` client-side → `vendor_sin_uid`).
 *
 * Fallback adicional post-pure: si `vendorKeyHint` llega populated y el pure
 * no encontró match, intenta un lookup directo en `roles.where('role','==','vendedor')`
 * por `vendorKey` normalizado. Esto cubre el caso donde el cliente sí resolvió
 * el nombre del vendedor pero no el UID (vendor_sin_uid).
 *
 * @param {Object} args
 * @param {any} args.fbDb - Firestore admin instance.
 * @param {string} [args.cardCode]
 * @param {string} [args.clientName]
 * @param {string} [args.vendorKeyHint] - vendorAssigned del payload (si viene del cliente).
 * @returns {Promise<ClientVendorResolution>}
 */
export async function resolveClientVendorServerSide(args) {
  if (!args || !args.fbDb) return EMPTY;
  const { fbDb, cardCode, clientName, vendorKeyHint } = args;

  // 1. roles → users union, en los 4 roles que usa la pantalla (§46), con la
  //    misma precedencia: vendedor > interno > gerente > admin (el primero
  //    gana en los .find de abajo). hotfix 2026-10-29: antes solo role='vendedor' → los
  //    clientes de un VDI (interno, ej. IOANNIS PALKOUDAKIS) o de un gerente
  //    daban VENDOR_UID_MISSING al confirmarlos un vendedor.
  /** @type {Array<{uid:string, email:string, vendorKey:string}>} */
  const users = [];
  for (const role of ROLES_CON_CARTERA) {
    try {
      const rolesSnap = await fbDb.collection('roles').where('role', '==', role).get();
      rolesSnap.forEach((/** @type {any} */ d) => {
        const data = d.data() || {};
        const vendorKey = vendorKeyFromRoleDoc(role, data);
        if (vendorKey && !users.some((u) => u.uid === d.id)) {
          users.push({
            uid: d.id,
            email: data.email || '',
            vendorKey,
          });
        }
      });
    } catch (_e) {
      /* non-fatal: seguir con los otros roles; fallback por hint abajo */
    }
  }

  // 2. approvedAltas → master.
  /** @type {Array<any>} */
  const approvedAltas = [];
  try {
    const altaSnap = await fbDb
      .collection('client_applications')
      .where('status', '==', 'approved')
      .get();
    altaSnap.forEach((/** @type {any} */ d) => approvedAltas.push(d.data() || {}));
  } catch (_e) {
    /* non-fatal */
  }

  // 3. Pure: resolver via cadena cliente → zona → vendedor.
  // Note: POINTS NO está en Firestore (vive inline en index.html + cfg).
  // En server, approvedAltas cubre el 90%+ de los clientes nuevos. Si el
  // cliente SOLO está en POINTS inline (no en altas), caerá al fallback.
  const resolution = resolveClientVendorFromMaster({
    cardCode,
    clientName,
    points: [],
    approvedAltas,
    users,
  });

  if (resolution.resolved && resolution.vendorUid) return resolution;

  // 4. Fallback: si llegó vendorKeyHint del cliente + encontramos user con
  //    ese vendor en roles, usar directo. Esto cubre el caso típico:
  //    cliente resolvió vendorAssigned='MAURICIO GIL' pero no el UID porque
  //    rules bloquean read de roles para VDE. Server (admin SDK) sí puede.
  if (vendorKeyHint && users.length > 0) {
    const vk = String(vendorKeyHint).trim();
    // Normalizar label "Z<N> - Nombre" → "NOMBRE".
    const labelMatch = vk.match(/^Z\d+\s*[-–—]\s*(.+)$/i);
    const vkNorm = labelMatch ? labelMatch[1].trim().toUpperCase() : vk.toUpperCase();
    // Match exacto → case-insensitive → primer nombre.
    let match = users.find((u) => u.vendorKey.toUpperCase() === vkNorm);
    if (!match) {
      const vkFirst = vkNorm.split(/\s+/)[0];
      if (vkFirst && vkFirst.length >= 3) {
        match = users.find((u) => {
          const key = u.vendorKey.toUpperCase();
          return key === vkFirst || key.startsWith(vkFirst + ' ');
        });
      }
    }
    if (match) {
      return /** @type {any} */ ({
        vendorKey: match.vendorKey,
        vendorUid: match.uid,
        vendorEmail: match.email,
        resolved: true,
        reason: 'ok',
        source: 'server_fallback_vendorKey',
      });
    }
  }

  return resolution; // retornar la mejor que tuvimos (puede ser vendor_sin_uid)
}

/**
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
