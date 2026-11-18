// @ts-check
/**
 * R01 Fase 1 — Validación adversarial §56 UPDATE v1457: recorrido COMPLETO
 * desde el merge server-side (espejo pure §57) hasta la decisión del
 * vendedor en el modal review (bo_entry_logic).
 *
 * Demuestra que Fase 1 NO cierra §56 por sí misma: el merge server-side
 * SUMA qty por diseño del pure y persiste mergedFrom/precioAnterior1/2 /
 * precioOrigen. La regla "MÁS NUEVA + piso ASIG" la aplica el modal
 * review downstream via `computeBoEntryRows` + `setBoEntryRowResolution`.
 *
 * Este test conecta ambos comportamientos:
 *
 *   1. Servidor (Fase 1):
 *      - Dos órdenes con cantidades diferentes.
 *      - `mergeLinesFromOrders` suma qty.
 *      - Persiste mergedFrom[] (audit).
 *      - Persiste precioAnterior1/2 + precioOrigen='lista_actual' si precios difieren.
 *
 *   2. Cliente downstream (modal review, Fase 3 — no Fase 1):
 *      - `computeBoEntryRows` detecta colisión con boVigente del cliente.
 *      - Fila roja: `resolved=null` + `resolvedQty=cantidadNueva`.
 *      - Piso ASIG preservado (§40).
 *      - Vendedor resuelve 'same' → `resolvedQty = max(nueva, piso)`.
 *      - Vendedor resuelve 'additional' → `resolvedQty = max(nueva+previa, piso)`.
 */

import { describe, expect, it } from 'vitest';
import {
  computeBoEntryRows,
  setBoEntryRowResolution,
  unresolvedBoEntryRows,
} from '../../../src/pure/bo_entry_logic.js';
import { mergeLinesFromOrders } from '../../../src/pure/unificar-ordenes.js';

describe('R01 Fase 1 — §56 UPDATE v1457 recorrido completo', () => {
  it('Paso 1: dos órdenes con cantidades diferentes → merge pure SUMA qty', () => {
    const base = [{ code: 'SKU-A', qty: 2, precio: 100 }];
    const other = [
      {
        orderNumber: 500,
        pedidoId: 'ped-500',
        lines: [{ code: 'SKU-A', qty: 3, precio: 100 }],
      },
    ];
    const result = mergeLinesFromOrders(base, other);
    expect(result.mergedLines.length).toBe(1);
    const line = result.mergedLines[0];
    expect(line.code).toBe('SKU-A');
    // El pure suma por diseño. La regla "MÁS NUEVA" vive en bo_entry_logic
    // downstream; aquí sólo demostramos que el server-side es consistente
    // con su contrato.
    expect(line.qty).toBe(5);
  });

  it('Paso 2: mergedFrom[] poblado con 1 aporte cuando hay precio diferente', () => {
    const base = [{ code: 'SKU-A', qty: 2, precio: 100 }];
    const other = [
      {
        orderNumber: 600,
        pedidoId: 'ped-600',
        lines: [{ code: 'SKU-A', qty: 3, precio: 150 }], // precio distinto
      },
    ];
    const result = mergeLinesFromOrders(base, other);
    const line = result.mergedLines[0];
    expect(Array.isArray(line.mergedFrom)).toBe(true);
    expect(line.mergedFrom.length).toBeGreaterThanOrEqual(1);
    // Algún aporte contiene el precio del incoming.
    const hasAporte = line.mergedFrom.some((m) => Number(m.qty) === 3 && Number(m.precio) === 150);
    expect(hasAporte).toBe(true);
  });

  it('Paso 3: precios distintos → precioAnterior1/2 + precioOrigen=lista_actual', () => {
    const base = [{ code: 'SKU-A', qty: 2, precio: 100 }];
    const other = [
      {
        orderNumber: 600,
        pedidoId: 'ped-600',
        lines: [{ code: 'SKU-A', qty: 3, precio: 150 }],
      },
    ];
    const result = mergeLinesFromOrders(base, other);
    const line = result.mergedLines[0];
    expect(line.precioOrigen).toBe('lista_actual');
    // Al menos uno de los precios previos queda registrado.
    const precios = [line.precioAnterior1, line.precioAnterior2].filter(
      (p) => typeof p === 'number'
    );
    expect(precios.length).toBeGreaterThanOrEqual(1);
    expect(precios.includes(100) || precios.includes(150)).toBe(true);
  });

  it('Paso 4: fila roja aparece cuando cliente tiene BO vigente del SKU', () => {
    // Items que el vendedor cargó (post-merge o directo): código y cantidad.
    const items = [{ code: 'SKU-A', qty: 5 }];
    // BO vigente del cliente para ese SKU (resultado de la consulta de BO).
    const boVigente = [{ sku: 'SKU-A', cantidad: 3, fechaIso: '2026-11-01T00:00:00Z' }];
    const rows = computeBoEntryRows({ items, boVigente });
    expect(rows.length).toBe(1);
    const row = rows[0];
    expect(row.sku).toBe('sku-a');
    expect(row.cantidadNueva).toBe(5);
    expect(row.cantidadBoPrevia).toBe(3);
    expect(row.resolved).toBeNull();
    expect(row.resolvedQty).toBe(5);
    expect(row.piso).toBe(0);
  });

  it('Paso 5: antes de la decisión → unresolvedBoEntryRows devuelve la fila', () => {
    const items = [{ code: 'SKU-A', qty: 5 }];
    const boVigente = [{ sku: 'SKU-A', cantidad: 3 }];
    const rows = computeBoEntryRows({ items, boVigente });
    const unres = unresolvedBoEntryRows(rows);
    expect(unres.length).toBe(1);
    expect(unres[0].resolved).toBeNull();
  });

  it('Paso 6: resolución "same" → resolvedQty = cantidadNueva (sin piso ASIG)', () => {
    const items = [{ code: 'SKU-A', qty: 7 }];
    const boVigente = [{ sku: 'SKU-A', cantidad: 4 }];
    const rows = computeBoEntryRows({ items, boVigente });
    const resolved = setBoEntryRowResolution(rows[0], 'same');
    expect(resolved.resolved).toBe('same');
    // "MÁS NUEVA" reemplaza al BO previo: resolvedQty = max(7, 0) = 7.
    expect(resolved.resolvedQty).toBe(7);
  });

  it('Paso 7: resolución "additional" → resolvedQty = nueva + previa', () => {
    const items = [{ code: 'SKU-A', qty: 7 }];
    const boVigente = [{ sku: 'SKU-A', cantidad: 4 }];
    const rows = computeBoEntryRows({ items, boVigente });
    const resolved = setBoEntryRowResolution(rows[0], 'additional');
    expect(resolved.resolved).toBe('additional');
    // 7 + 4 = 11, piso 0 → 11.
    expect(resolved.resolvedQty).toBe(11);
  });

  it('Paso 8: piso ASIG preservado — "same" nunca baja de piso (§40)', () => {
    const items = [{ code: 'SKU-A', qty: 1, qtyAsignadaPrevia: 6, origen: 'stock-asignado' }];
    const boVigente = [{ sku: 'SKU-A', cantidad: 2 }];
    const rows = computeBoEntryRows({ items, boVigente });
    expect(rows[0].piso).toBe(6);
    const resolved = setBoEntryRowResolution(rows[0], 'same');
    // max(nueva=1, piso=6) = 6 → nunca baja de la reserva ASIG viva.
    expect(resolved.resolvedQty).toBe(6);
  });

  it('Paso 9: piso ASIG preservado — "additional" también cumple piso', () => {
    const items = [{ code: 'SKU-A', qty: 1, qtyAsignadaPrevia: 10, origen: 'stock-asignado' }];
    const boVigente = [{ sku: 'SKU-A', cantidad: 2 }];
    const rows = computeBoEntryRows({ items, boVigente });
    const resolved = setBoEntryRowResolution(rows[0], 'additional');
    // max(1+2=3, piso=10) = 10.
    expect(resolved.resolvedQty).toBe(10);
  });

  it('Paso 10 (end-to-end): merge server + decisión cliente → qty final correcta', () => {
    // 1. Merge server-side de 2 órdenes del mismo cliente para SKU-A.
    const base = [{ code: 'SKU-A', qty: 2, precio: 100 }];
    const other = [
      {
        orderNumber: 700,
        pedidoId: 'ped-700',
        lines: [{ code: 'SKU-A', qty: 3, precio: 150 }],
      },
    ];
    const merged = mergeLinesFromOrders(base, other);
    const mergedLine = merged.mergedLines[0];
    // El servidor suma: 5 unidades totales + mergedFrom audit.
    expect(mergedLine.qty).toBe(5);
    expect(Array.isArray(mergedLine.mergedFrom)).toBe(true);

    // 2. Downstream: el vendedor abre el modal review. El cliente ya tenía
    //    BO vigente de 4 unidades del mismo SKU (de otra orden anterior).
    const boVigente = [{ sku: 'SKU-A', cantidad: 4, fechaIso: '2026-10-15T00:00:00Z' }];
    const rows = computeBoEntryRows({
      items: [{ code: mergedLine.code, qty: mergedLine.qty }],
      boVigente,
    });
    expect(rows.length).toBe(1);
    expect(rows[0].cantidadNueva).toBe(5); // la suma del merge.
    expect(rows[0].cantidadBoPrevia).toBe(4); // BO previo del cliente.

    // 3. Vendedor elige "same" → qty final = 5 (reemplaza BO previo).
    const same = setBoEntryRowResolution(rows[0], 'same');
    expect(same.resolvedQty).toBe(5);

    // 4. Alternativa: vendedor elige "additional" → qty final = 9.
    const additional = setBoEntryRowResolution(rows[0], 'additional');
    expect(additional.resolvedQty).toBe(9);
  });

  it('Paso 11: boEntryResolved null en rows iniciales → Fase 3 CF rechaza con UNRESOLVED_BO_ENTRY_ROWS', () => {
    // Replica el gate server del cf commitPedidoCore §56: si al enviar lines
    // llegan rows con boEntryResolved=null, rechaza.
    //
    // Fase 1 (server-side merge) NO decide; persiste mergedFrom. Es el
    // cliente quien levanta la fila roja y debe resolverla antes de confirmar.
    const items = [{ code: 'SKU-A', qty: 5 }];
    const boVigente = [{ sku: 'SKU-A', cantidad: 3 }];
    const rows = computeBoEntryRows({ items, boVigente });
    // Simular que el cliente envía sin resolver.
    const payloadLines = rows.map((r) => ({
      sku: r.sku,
      cantidad: r.cantidadNueva,
      boAnterior: r.cantidadBoPrevia,
      boEntryResolved: null,
    }));
    const unresolved = payloadLines.filter((l) => l.boEntryResolved === null);
    expect(unresolved.length).toBeGreaterThan(0);
    // En el gate real (commitPedidoCore) esto dispararía UNRESOLVED_BO_ENTRY_ROWS;
    // aquí demostramos que el shape de las filas lleva información suficiente
    // para que el CF detecte la condición sin ambigüedad.
    expect(unresolved[0].sku).toBe('sku-a');
    expect(unresolved[0].cantidad).toBe(5);
    expect(unresolved[0].boAnterior).toBe(3);
  });

  it('Paso 12: mergedFrom preservado tras merge aun cuando precios coinciden', () => {
    // Si ambos tienen el mismo precio, precioAnterior* puede quedar undefined
    // pero mergedFrom[] igual debe poblarse para audit.
    const base = [{ code: 'SKU-X', qty: 1, precio: 100 }];
    const other = [
      {
        orderNumber: 800,
        pedidoId: 'ped-800',
        lines: [{ code: 'SKU-X', qty: 2, precio: 100 }],
      },
    ];
    const r = mergeLinesFromOrders(base, other);
    const line = r.mergedLines[0];
    expect(line.qty).toBe(3);
    expect(Array.isArray(line.mergedFrom)).toBe(true);
    expect(line.mergedFrom.length).toBeGreaterThanOrEqual(1);
  });
});
