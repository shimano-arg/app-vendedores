// @ts-check
/**
 * v1100 (2026-09-30): Compute puro del skuMap del modal Backorder / Stock
 * Asignado + reusable por los exports "Exportar reporte".
 *
 * Antes esta lógica vivía inline en renderBackordersTab (index.html:13914),
 * y los exports del diálogo Reportes (exportBackorderAll / exportStockAsigAll
 * y sus variantes por mes) tenían su propia lógica más simple —
 * divergencias entre modal y reporte reportadas por Mariano.
 *
 * Este módulo devuelve la MISMA estructura que consumía renderBackordersTab
 * (skus post-FIFO + totales), para que:
 *   - renderBackordersTab siga comportándose idéntico.
 *   - exportBackordersToExcel (botón "Exportar todo" del modal) siga idéntico.
 *   - exportBackorderAll / exportStockAsigAll (diálogo Reportes) pasen a
 *     coincidir con el modal — FIFO cap + filtro vencidas (lineReservesStock)
 *     + estados equivalentes al modo.
 *
 * NO incluye render HTML ni Excel — solo compute. Los consumidores arman su
 * output propio a partir de {skus, totalUnidades, totalClientes}.
 */

import { lineReservesStock } from './stock-realmente-disponible.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const RESERVA_TTL_DAYS = 15;

/**
 * Normaliza un valor a timestamp ms. Local copy del helper de
 * src/pure/stock-realmente-disponible.js (no se exporta desde alla; inline
 * para evitar un modulo compartido nuevo). MANTENER SINCRONIZADO.
 *
 * Bug reportado por auditor (2026-10-02): `new Date(firestoreTimestamp).getTime()`
 * devuelve NaN cuando el input es un Firestore Timestamp — el check
 * `isAsigSinReservaVigente` nunca disparaba correctamente, y
 * `String(p.confirmedAt||'').slice(0,10)` producia "[object O" rompiendo el
 * sort por fecha.
 *
 * @param {any} value
 * @returns {number|null}
 */
function toMillisSafe(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isFinite(t) ? t : null;
  }
  if (typeof value === 'object') {
    if (typeof value.toMillis === 'function') {
      try {
        const t = value.toMillis();
        return typeof t === 'number' && Number.isFinite(t) ? t : null;
      } catch (_e) {
        return null;
      }
    }
    if (typeof value.seconds === 'number') {
      const nanos = typeof value.nanoseconds === 'number' ? value.nanoseconds : 0;
      return value.seconds * 1000 + nanos / 1e6;
    }
    return null;
  }
  if (typeof value === 'string') {
    const t = Date.parse(value);
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

/**
 * Devuelve el string YYYY-MM-DD representando la fecha del valor dado.
 * Soporta ISO string, Firestore Timestamp, Date, number. Fallback a "" si
 * no se puede parsear.
 * @param {any} value
 * @returns {string}
 */
function toDateString(value) {
  const ms = toMillisSafe(value);
  if (ms === null) return '';
  try {
    return new Date(ms).toISOString().slice(0, 10);
  } catch (_e) {
    return '';
  }
}

/**
 * @typedef {'urgente'|'asignacion'} BackorderMode
 *
 * @typedef {'fifo'|'strict'} AggregationMode
 *   - `fifo` (default, v1100+): reparte stock disponible entre líneas por fecha
 *      ascendente; produce casos "parcial" (pendiente=100 con stock=3 → BO=97 + ASIG=3).
 *      Refleja "cuántas unidades reales no se cubren".
 *   - `strict` (v1134+): binario a nivel SKU, alineado con tablero PBI
 *      (`v_backorder_lineas` / `v_stock_asignado`):
 *        - Si `dispSap > 0`: TODAS las líneas (BO/ASIG/confirmed) cuentan como asignadas,
 *          `qtyBackorder=0`.
 *        - Si `dispSap = 0`: solo las líneas `state='BO'` cuentan como backorder
 *          (`qtyBackorder=pendiente`). Las líneas `state='ASIG'` o `'confirmed'` con stock=0
 *          desaparecen del total (ni asignadas ni backorder, igual que PBI).
 *      Refleja "qué SKUs están 100% en falta".
 *
 * @typedef {Object} BackorderFilters
 * @property {string} [tiendaQuery] Texto libre (lowercase) que matchea contra sku/producto/cliente.
 * @property {string} [vendorKey] Vendor key canónico (post `canonVendor`) para match exacto.
 * @property {string} [mesYYYYMM] Filtro por prefijo `YYYY-MM` del confirmedAt/createdAt.
 * @property {'urgente'|'parcial'|'todos'} [urgencyFilter] Solo aplica en mode='urgente'.
 * @property {AggregationMode} [aggregationMode] Default 'fifo'. Ver typedef arriba.
 *
 * @typedef {Object} BackorderDeps
 * @property {(sku: string) => number} getStockDisponibleVenta Stock físico dep 11.
 * @property {(text: string) => string} canonVendor Normaliza texto de vendor a key.
 * @property {Array<any>} [products] Catálogo — cada item con {code, desc?, fam?, sub?}.
 * @property {Array<any>} [backorderLines] Fuente SAP legacy (típicamente vacía post-v700).
 * @property {(name: string) => string} [sapGetClienteCode] Lookup opcional de CardCode por nombre.
 * @property {(pedido: any) => string} [resolveVendorFallback] Fallback de vendorKey
 *   cuando el pedido no trae ownerVendor (v1088). Ej: consulta clientMasterCache por
 *   clientName/province/locName. Se llama SOLO si el mapeo directo devuelve vacío.
 * @property {number} [now] Timestamp inyectable — default Date.now().
 *
 * @typedef {Object} ClienteRow
 * @property {string} nombre
 * @property {string} code
 * @property {string} ciudad
 * @property {string} [provincia] Provincia del pedido (p.province) — solo APP.
 * @property {number} pendiente Original pedido (pre-FIFO).
 * @property {number} precio
 * @property {number|string} sqDocNum `p.transferidoSAP.docNum` cuando existe (APP).
 * @property {string} sqDocDate `YYYY-MM-DD` de confirmedAt.
 * @property {string} vendorKey
 * @property {'sap'|'app'} source
 * @property {'BO'|'ASIG'|'confirmed'|null} state
 * @property {number} qtyAsignada Post-FIFO, cuánto puede recibir con stock actual.
 * @property {number} qtyBackorder Post-FIFO, cuánto queda pendiente sin stock.
 * @property {string} [pedidoId]
 * @property {number|null} [pedidoOrden]
 * @property {boolean} [asigReserva]
 * @property {string} [asigCliTipo]
 * @property {any} [pedidoCreatedAt]
 * @property {Array<{pedidoId: string, state: string|null, qty: number}>} [pedidoIds]
 *
 * @typedef {Object} SkuGroup
 * @property {string} sku
 * @property {string} producto
 * @property {string} familia
 * @property {string} subfamilia
 * @property {number} totalPendiente Suma qtyAsignada (asignacion) o qtyBackorder (urgente) post-FIFO.
 * @property {number} dispSap Stock disponible del SKU (dep 11).
 * @property {'urgente'|'parcial'} [urgency] Solo en modo 'urgente': 'urgente' si dispSap=0, 'parcial' si dispSap>0.
 * @property {Array<ClienteRow>} clientes
 *
 * @typedef {Object} BackorderResult
 * @property {Array<SkuGroup>} skus
 * @property {number} totalUnidades
 * @property {number} totalClientes
 */

/**
 * Interno: construye el skuMap con líneas post-FIFO **sin consolidar por
 * cliente**. Base común de `computeBackorderSkuMap` (que consolida) y
 * `computeBackorderRawLines` (que aplana para reportes crudos).
 *
 * @param {Array<any>} pedidos
 * @param {BackorderMode} mode
 * @param {BackorderFilters} filters
 * @param {BackorderDeps} deps
 * @returns {{skuMap: Object<string, SkuGroup>, isAsig: boolean}}
 */
function _buildSkuMapRaw(pedidos, mode, filters, deps) {
  const isAsig = mode === 'asignacion';
  const strictMode = filters.aggregationMode === 'strict';
  const tq = String(filters.tiendaQuery || '').toLowerCase();
  const vf = String(filters.vendorKey || '');
  const mesF = String(filters.mesYYYYMM || '');
  const now = typeof deps.now === 'number' ? deps.now : Date.now();
  const getStk =
    typeof deps.getStockDisponibleVenta === 'function' ? deps.getStockDisponibleVenta : () => 0;
  const canonVendor =
    typeof deps.canonVendor === 'function'
      ? deps.canonVendor
      : /** @param {any} x */ (x) =>
          String(x || '')
            .trim()
            .toUpperCase();
  const products = Array.isArray(deps.products) ? deps.products : [];
  /** @type {Object<string, any>} */
  const prodByCode = {};
  for (const p of products) {
    if (p && p.code) prodByCode[String(p.code).toUpperCase()] = p;
  }

  /**
   * @param {{sqDocDate?: string, vendorKey?: string, sku: string, producto: string, clienteNombre: string}} obj
   * @returns {boolean}
   */
  const passesFilters = (obj) => {
    if (mesF) {
      const d = String(obj.sqDocDate || '').slice(0, 7);
      if (d !== mesF) return false;
    }
    if (vf) {
      const vk = canonVendor(obj.vendorKey || '');
      if (vk !== vf) return false;
    }
    if (tq) {
      const skuHit = (obj.sku || '').toLowerCase().includes(tq);
      const prodHit = (obj.producto || '').toLowerCase().includes(tq);
      const cliHit = (obj.clienteNombre || '').toLowerCase().includes(tq);
      if (!skuHit && !prodHit && !cliHit) return false;
    }
    return true;
  };

  /** @type {Object<string, SkuGroup>} */
  const skuMap = {};

  // Fuente 1: backorderLines legacy (SAP). Típicamente vacío post-v700 pero
  // se preserva por compat.
  const backorderLines = Array.isArray(deps.backorderLines) ? deps.backorderLines : [];
  for (const ln of backorderLines) {
    if (!ln) continue;
    if (
      !passesFilters({
        sqDocDate: ln.sqDocDate,
        vendorKey: ln.vendorKey,
        sku: ln.sku || '',
        producto: ln.producto || '',
        clienteNombre: ln.clienteNombre || '',
      })
    )
      continue;
    const sku = ln.sku || '';
    if (!skuMap[sku]) {
      skuMap[sku] = {
        sku,
        producto: ln.producto || '',
        familia: ln.familia || '',
        subfamilia: ln.subfamilia || '',
        totalPendiente: 0,
        dispSap: 0,
        clientes: [],
      };
    }
    skuMap[sku].clientes.push({
      nombre: ln.clienteNombre || '',
      code: ln.clienteCode || '',
      ciudad: ln.clienteCiudad || '',
      pendiente: parseFloat(ln.pendiente) || 0,
      precio: parseFloat(ln.precioUnitario) || 0,
      sqDocNum: ln.sqDocNum || 0,
      sqDocDate: ln.sqDocDate || '',
      vendorKey: ln.vendorKey || '',
      source: 'sap',
      state: null,
      qtyAsignada: 0,
      qtyBackorder: 0,
    });
  }

  // Fuente 2: APP (globalPedidos).
  const arr = Array.isArray(pedidos) ? pedidos : [];
  for (const p of arr) {
    if (!p || !Array.isArray(p.lines)) continue;
    // v1100: pedidos cerrados NO se consideran. Consistente con
    // exportBackordersToExcel/exportBackorderAll/exportStockAsigAll. En
    // renderBackordersTab original faltaba explícitamente pero en la práctica
    // el filtro stage='confirmed' descarta la mayoría — cubrimos el edge case.
    if (p.closedAt) continue;
    // v819: solo pedidos stage='confirmed' (envío a SAP en curso).
    // v1137 (2026-10-05): strict mode ALSO acepta pedidos sin stage pero con
    // transferidoSAP (migrados desde SAP el 2026-08-28 via sap_migration_script;
    // ver `project_bo_migration_100_app`). Esto alinea con tablero PBI que lee
    // v_backorder_app sin filtrar por stage. Fuera de strict (fifo default),
    // se preserva el filtro original para no romper otros callers.
    //
    // v1185 (incident 2026-10-07, pedido PESCAR.INFO SHOP SRL ANT101XGB):
    // en strict mode, aceptar TAMBIEN pedidos con cualquier stage (pending/
    // confirmed) si tienen lineas que reservan stock (state in BO/ASIG/
    // confirmed con qtyOpen>0). Antes: pedidos stage='pending' con lineas
    // state='confirmed' NO aparecian en Stock Asignado modal, pero SI eran
    // contados por getStockDesglose como "reservadas" → user veia "0 clientes"
    // en Stock Asignado pero el modal pedido en espera decia "RESERVADAS=1".
    // Fix: strict mode no filtra por stage; el filtro de linea (state+qtyOpen)
    // y lineReservesStock siguen decidiendo que aparece. Backward compat para
    // modo fifo default (otros callers no afectados).
    if (p.stage !== 'confirmed' && !strictMode) continue;
    for (const l of p.lines) {
      if (!l || !l.code) continue;
      // v962: confirmed también entra (SQ enviada a SAP, prioridad = ASIG).
      if (l.state !== 'BO' && l.state !== 'ASIG' && l.state !== 'confirmed') continue;
      const qtyOpen = Number(l.qtyOpen || 0);
      if (qtyOpen <= 0) continue;
      // v978/v979: filtro vencidas.
      // v1137 (2026-10-05): strict mode omite TTL (lineReservesStock) para
      // alinear con tablero PBI que no filtra lineas BO/ASIG por edad.
      if (!strictMode && !lineReservesStock(l, now, p)) {
        // v1072: en modo asignacion permitir ASIG sin reserva vigente (asigAt<=15d).
        // Fix auditor 2026-10-02: usar toMillisSafe para soportar Firestore
        // Timestamp (toMillis/seconds). Antes `new Date(timestampObj).getTime()`
        // devolvia NaN → la expresion aritmetica tambien NaN → NaN<=15 = false
        // → la linea quedaba descartada por error.
        const asigAtMs = toMillisSafe(l.asigAt);
        const isAsigSinReservaVigente =
          isAsig &&
          l.state === 'ASIG' &&
          (l.asigReserva === false || l.asigReserva === 0) &&
          (asigAtMs === null || (now - asigAtMs) / DAY_MS <= RESERVA_TTL_DAYS);
        if (!isAsigSinReservaVigente) continue;
      }
      const sku = String(l.code).toUpperCase();
      let vendorKey = canonVendor(
        p.ownerVendor || p.vendedor || p.vendorAssigned || p.vendor || ''
      );
      // v1088: fallback via clientMasterCache cuando ownerVendor viene vacío.
      if (!vendorKey && typeof deps.resolveVendorFallback === 'function') {
        try {
          const fb = deps.resolveVendorFallback(p);
          if (fb) vendorKey = canonVendor(fb);
        } catch (_e) {
          /* silent */
        }
      }
      // Fix auditor 2026-10-02: sqDocDate normalizado via toDateString ->
      // ISO 'YYYY-MM-DD'. Antes `String(p.confirmedAt).slice(0,10)` producia
      // "[object O" cuando confirmedAt es un Firestore Timestamp, rompiendo
      // el sort cronologico del FIFO y el filtro mesYYYYMM.
      const sqDocDate = toDateString(p.confirmedAt);
      if (
        !passesFilters({
          sqDocDate,
          vendorKey,
          sku,
          producto: String(l.desc || ''),
          clienteNombre: String(p.clientName || ''),
        })
      )
        continue;
      if (!skuMap[sku]) {
        const prod = prodByCode[sku] || {};
        skuMap[sku] = {
          sku,
          producto: prod.desc || l.desc || '',
          familia: prod.fam || '',
          subfamilia: prod.sub || '',
          totalPendiente: 0,
          dispSap: 0,
          clientes: [],
        };
      }
      const cardCode =
        typeof deps.sapGetClienteCode === 'function'
          ? deps.sapGetClienteCode(p.clientName || '') || ''
          : String(p.clientCardCode || '');
      skuMap[sku].clientes.push({
        nombre: p.clientName || '',
        code: cardCode,
        ciudad: p.locName || '',
        provincia: p.province || '',
        pendiente: qtyOpen,
        precio: parseFloat(l.precio || l.priceAtCreation || 0) || 0,
        sqDocNum: (p.transferidoSAP && p.transferidoSAP.docNum) || 0,
        sqDocDate,
        vendorKey,
        source: 'app',
        state: /** @type {'BO'|'ASIG'|'confirmed'} */ (l.state),
        pedidoId: p._fsId || '',
        pedidoOrden: p.orderNumber || null,
        asigReserva: l.asigReserva,
        asigCliTipo: l.asigCliTipo || '',
        pedidoCreatedAt: p.createdAt || null,
        qtyAsignada: 0,
        qtyBackorder: 0,
      });
    }
  }

  // FASE 2: agregación. Dos modos:
  //  - 'fifo' (default): reparte stock disponible entre líneas por fecha asc.
  //    Permite casos "parcial" (ver typedef AggregationMode).
  //  - 'strict' (v1134+): binario a nivel SKU, alineado con tablero PBI.
  const aggregationMode = filters.aggregationMode === 'strict' ? 'strict' : 'fifo';
  Object.values(skuMap).forEach((g) => {
    const dispSap = getStk(g.sku) || 0;
    g.dispSap = dispSap;

    if (aggregationMode === 'strict') {
      // Modo binario a nivel SKU alineado con tablero PBI. Formula DAX:
      //   Asignado = IF(dep11 > 0, SUM(unidades WHERE state='ASIG'), 0)
      //   Backorder = IF(dep11 = 0, SUM(pendiente WHERE state='BO'), 0)
      // El tablero filtra v_stock_asignado por state='ASIG' y v_backorder_lineas
      // por estado='SIN ASIGNAR' (= state='BO'). confirmed NO cuenta.
      // SAP legacy source se trata como 'BO' (v_backorder_lineas_v2 default).
      g.clientes.forEach((c) => {
        const isBoLike = c.state === 'BO' || c.source === 'sap';
        // v1190 (incident 2026-10-08 RINALDI LORUSSO 127082):
        // isAsigLike ahora incluye TODAS las confirmed (con y sin sqDocNum).
        // Precedente v1185 incluyo solo confirmed SIN sqDocNum (huerfanos app).
        // Fix: tambien confirmed CON sqDocNum deben aparecer en Stock Asignado
        // porque UNIDADES RESERVADAS del modal "Pedido en Espera" las cuenta
        // (via getStockDesglose). Sin esto, VDE veia "RESERVADAS=6" en un
        // modal y "0 clientes" en Stock Asignado para el mismo SKU — pedia
        // coherencia.
        // Trade-off: diverge del tablero PBI (v_stock_asignado filtra solo
        // state='ASIG'). Las lineas confirmed+sqDocNum aparecen en el reporte
        // SAP SQs del PBI separadamente. Mariano prefiere coherencia modal↔
        // modal sobre modal↔PBI.
        const isAsigLike = c.state === 'ASIG' || c.state === 'confirmed';
        if (isAsig && isAsigLike && dispSap > 0) {
          c.qtyAsignada = c.pendiente;
          c.qtyBackorder = 0;
        } else if (!isAsig && isBoLike && dispSap === 0) {
          c.qtyAsignada = 0;
          c.qtyBackorder = c.pendiente;
        } else {
          c.qtyAsignada = 0;
          c.qtyBackorder = 0;
        }
      });
      // En strict no hay 'parcial'. Solo 'urgente' cuando dispSap=0 y hay BO.
      if (!isAsig) g.urgency = dispSap === 0 ? 'urgente' : undefined;
    } else {
      // Modo FIFO (comportamiento histórico v1100+).
      let restante = dispSap;
      // Paso 1: prioritarios (ASIG + confirmed) FIFO por fecha ascendente.
      const prioritarios = g.clientes.filter(
        (c) => c.source === 'app' && (c.state === 'ASIG' || c.state === 'confirmed')
      );
      prioritarios.sort((a, b) => (a.sqDocDate || '').localeCompare(b.sqDocDate || ''));
      for (const c of prioritarios) {
        const asignable = Math.min(c.pendiente, Math.max(0, restante));
        c.qtyAsignada = asignable;
        c.qtyBackorder = c.pendiente - asignable;
        restante -= asignable;
      }
      if (restante < 0) restante = 0;
      // Paso 2: competidores (SAP + APP-BO). SAP gana primero (transición SAP→APP),
      // luego fecha ascendente.
      const competidores = g.clientes.filter(
        (c) => !(c.source === 'app' && (c.state === 'ASIG' || c.state === 'confirmed'))
      );
      competidores.sort((a, b) => {
        if (a.source !== b.source) return a.source === 'sap' ? -1 : 1;
        return (a.sqDocDate || '').localeCompare(b.sqDocDate || '');
      });
      for (const c of competidores) {
        const asignable = Math.min(c.pendiente, Math.max(0, restante));
        c.qtyAsignada = asignable;
        c.qtyBackorder = c.pendiente - asignable;
        restante -= asignable;
      }
      // urgency es SKU-level (dispSap-based), inmutable a partir de aquí.
      if (!isAsig) g.urgency = dispSap > 0 ? 'parcial' : 'urgente';
    }
  });

  return { skuMap, isAsig };
}

/**
 * Extrae skuMap del modal Backorder / Stock Asignado siguiendo la misma
 * lógica que renderBackordersTab (v864/v960/v962/v969/v972/v978/v979/v1072).
 * Consolida duplicados por cliente (mismo cardCode en varios pedidos → 1 row).
 *
 * @param {Array<any>} pedidos globalPedidos (o subset filtrado por mes en callers legacy).
 * @param {BackorderMode} mode 'urgente' (Backorder) o 'asignacion' (Stock Asignado).
 * @param {BackorderFilters} filters Filtros del modal — vacíos para reporte crudo.
 * @param {BackorderDeps} deps Dependencias inyectables.
 * @returns {BackorderResult}
 */
export function computeBackorderSkuMap(pedidos, mode, filters, deps) {
  const { skuMap, isAsig } = _buildSkuMapRaw(pedidos, mode, filters, deps);
  const uf = String(filters.urgencyFilter || '');

  Object.values(skuMap).forEach((g) => {
    // Filtro por modo.
    if (isAsig) {
      g.clientes = g.clientes.filter((c) => (c.qtyAsignada || 0) > 0);
    } else {
      g.clientes = g.clientes.filter((c) => (c.qtyBackorder || 0) > 0);
    }
    // Consolidar duplicados por cliente (mismo cardCode/nombre en varios pedidos).
    /** @type {Object<string, ClienteRow>} */
    const byKeyC = {};
    for (const c of g.clientes) {
      const k = String(c.code || c.nombre || '(sin key)').toUpperCase();
      if (!byKeyC[k]) {
        byKeyC[k] = Object.assign({}, c, {
          pendiente: 0,
          qtyAsignada: 0,
          qtyBackorder: 0,
          pedidoIds: [],
        });
      }
      byKeyC[k].pendiente += Number(c.pendiente) || 0;
      byKeyC[k].qtyAsignada += Number(c.qtyAsignada) || 0;
      byKeyC[k].qtyBackorder += Number(c.qtyBackorder) || 0;
      if (c.pedidoId && Array.isArray(byKeyC[k].pedidoIds)) {
        byKeyC[k].pedidoIds.push({
          pedidoId: c.pedidoId,
          state: c.state,
          qty: Number(c.pendiente) || 0,
        });
      }
    }
    g.clientes = Object.values(byKeyC);
    // Total según modo.
    if (isAsig) {
      g.totalPendiente = g.clientes.reduce((s, c) => s + (c.qtyAsignada || 0), 0);
    } else {
      g.totalPendiente = g.clientes.reduce((s, c) => s + (c.qtyBackorder || 0), 0);
    }
  });

  // Filtrar SKUs vacíos post-FIFO.
  let skus = Object.values(skuMap).filter((g) => g.clientes && g.clientes.length > 0);

  // Filtro urgency (solo en modo backorder).
  if (mode !== 'asignacion' && uf && uf !== 'todos') {
    skus = skus.filter((g) => g.urgency === uf);
  }

  skus.sort((a, b) => b.totalPendiente - a.totalPendiente);

  const totalUnidades = skus.reduce((s, x) => s + x.totalPendiente, 0);
  /** @type {Set<string>} */
  const cliSet = new Set();
  skus.forEach((g) =>
    (g.clientes || []).forEach((c) => {
      const k = c.code || c.nombre || '';
      if (k) cliSet.add(k);
    })
  );
  const totalClientes = cliSet.size;

  return { skus, totalUnidades, totalClientes };
}

/**
 * @typedef {Object} RawLine
 * @property {string} sku
 * @property {string} producto
 * @property {string} familia
 * @property {string} subfamilia
 * @property {number} dispSap
 * @property {'urgente'|'parcial'} [urgency] Solo en modo urgente.
 * @property {ClienteRow} cliente
 */

/**
 * Variante para reportes crudos (1 fila por línea de pedido, sin consolidar
 * por cliente). Mismos filtros + FIFO + vencidas que `computeBackorderSkuMap`
 * pero devuelve cada línea individual con su qty post-FIFO. Usada por
 * `exportBackorderAll` / `exportStockAsigAll` para que coincidan con el modal
 * en scope (mismos SKUs/qty/vencidas) manteniendo granularidad por pedido.
 *
 * @param {Array<any>} pedidos
 * @param {BackorderMode} mode
 * @param {BackorderFilters} filters
 * @param {BackorderDeps} deps
 * @returns {Array<RawLine>}
 */
export function computeBackorderRawLines(pedidos, mode, filters, deps) {
  const { skuMap, isAsig } = _buildSkuMapRaw(pedidos, mode, filters, deps);
  /** @type {Array<RawLine>} */
  const out = [];
  Object.values(skuMap).forEach((g) => {
    (g.clientes || []).forEach((c) => {
      const qty = isAsig ? c.qtyAsignada || 0 : c.qtyBackorder || 0;
      if (qty <= 0) return;
      out.push({
        sku: g.sku,
        producto: g.producto,
        familia: g.familia,
        subfamilia: g.subfamilia,
        dispSap: g.dispSap,
        urgency: g.urgency,
        cliente: c,
      });
    });
  });
  return out;
}
