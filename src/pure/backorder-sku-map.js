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
 * @typedef {'urgente'|'asignacion'} BackorderMode
 *
 * @typedef {Object} BackorderFilters
 * @property {string} [tiendaQuery] Texto libre (lowercase) que matchea contra sku/producto/cliente.
 * @property {string} [vendorKey] Vendor key canónico (post `canonVendor`) para match exacto.
 * @property {string} [mesYYYYMM] Filtro por prefijo `YYYY-MM` del confirmedAt/createdAt.
 * @property {'urgente'|'parcial'|'todos'} [urgencyFilter] Solo aplica en mode='urgente'.
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
  const tq = String(filters.tiendaQuery || '').toLowerCase();
  const vf = String(filters.vendorKey || '');
  const mesF = String(filters.mesYYYYMM || '');
  const now = typeof deps.now === 'number' ? deps.now : Date.now();
  const getStk = typeof deps.getStockDisponibleVenta === 'function' ? deps.getStockDisponibleVenta : () => 0;
  const canonVendor = typeof deps.canonVendor === 'function' ? deps.canonVendor : /** @param {any} x */ (x) => String(x || '').trim().toUpperCase();
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
  /** @type {Object<string, SkuGroup>} */
  const skuMap = {};

  // Fuente 1: backorderLines legacy (SAP). Típicamente vacío post-v700 pero
  // se preserva por compat.
  const backorderLines = Array.isArray(deps.backorderLines) ? deps.backorderLines : [];
  for (const ln of backorderLines) {
    if (!ln) continue;
    if (!passesFilters({
      sqDocDate: ln.sqDocDate,
      vendorKey: ln.vendorKey,
      sku: ln.sku || '',
      producto: ln.producto || '',
      clienteNombre: ln.clienteNombre || '',
    })) continue;
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
    if (p.stage !== 'confirmed') continue;
    for (const l of p.lines) {
      if (!l || !l.code) continue;
      // v962: confirmed también entra (SQ enviada a SAP, prioridad = ASIG).
      if (l.state !== 'BO' && l.state !== 'ASIG' && l.state !== 'confirmed') continue;
      const qtyOpen = Number(l.qtyOpen || 0);
      if (qtyOpen <= 0) continue;
      // v978/v979: filtro vencidas.
      if (!lineReservesStock(l, now, p)) {
        // v1072: en modo asignacion permitir ASIG sin reserva vigente (asigAt<=15d).
        const isAsigSinReservaVigente =
          isAsig &&
          l.state === 'ASIG' &&
          l.asigReserva === false &&
          (!l.asigAt || ((now - new Date(l.asigAt).getTime()) / DAY_MS) <= RESERVA_TTL_DAYS);
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
        } catch (_e) { /* silent */ }
      }
      if (!passesFilters({
        sqDocDate: p.confirmedAt,
        vendorKey,
        sku,
        producto: String(l.desc || ''),
        clienteNombre: String(p.clientName || ''),
      })) continue;
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
        sqDocDate: String(p.confirmedAt || '').slice(0, 10),
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

  // FASE 2: FIFO cap por SKU. Setea qtyAsignada + qtyBackorder por línea.
  // NO consolida — eso lo hace `computeBackorderSkuMap` a partir de este map.
  Object.values(skuMap).forEach((g) => {
    const dispSap = getStk(g.sku) || 0;
    g.dispSap = dispSap;
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
