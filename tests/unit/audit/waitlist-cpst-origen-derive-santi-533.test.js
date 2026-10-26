// @ts-check
/**
 * Reproduce bug reportado Santi Esteban 2026-10-26 ~16:46 ART (ORDEN 533
 * MARISA LUJAN IANUNZIO C27184733760, waitlist Uvh1A4bhWfriBW5KZlO5).
 *
 * Fixture datos REALES extraídos de prod via script read-only (operations_log
 * commit_pedido_rejected + revision_waitlist/Uvh1A4bhWfriBW5KZlO5).
 *
 * Pre-fix: `items[].origen=None` + `items[].asigRefs=None` →
 * `enrichItemWithCpstOrigen` NO existía → payload CF llegaba sin origenLinea
 * → core aplicaba fórmula global (CLAUDE.md §33/§35) → libre=0 (todas 20u
 * en ASIG) → qtyBO=qty → STOCK_CHANGED loop.
 *
 * Post-fix: `buildOrigenesBySkuFromWaitlist(w)` extrae map SKU→refs desde
 * `w.pedidosOrigenes` + `enrichItemWithCpstOrigen(item, map)` deriva
 * `origen='stock-asignado'` + `asigRefs` para los SKUs que matchean. Payload
 * CF llega con origenLinea → core aplica `utilizablePara(cardCode)` → qty
 * confirmed correctamente, NO dispara STOCK_CHANGED espúreo.
 */
import { describe, expect, it } from 'vitest';
import {
  buildOrigenesBySkuFromWaitlist,
  enrichItemWithCpstOrigen,
} from '../../../src/pure/waitlist-cpst-origen.js';

/** Fixture extraído con `python read revision_waitlist/Uvh1A4bhWfriBW5KZlO5` */
const WAITLIST_SANTI_533 = {
  _id: 'Uvh1A4bhWfriBW5KZlO5',
  clientCardCode: 'C27184733760',
  clientName: 'MARISA VIVIANA LUJAN IANUNZIO',
  orderNumber: 533,
  source: 'stock-asignado-batch',
  stage: null,
  closedAt: null,
  ownerUid: 'z77q0iWYM1OpWLAWmafLQp4TFJ42',
  ownerEmail: 'mauricio.gil@shimano.com.ar',
  cargadoPorEmail: 'mauricio.gil@shimano.com.ar',
  unifiedFrom: [
    {
      source: 'creacion_cpst',
      by: 'mariano.erbino@shimano.com.ar',
      timestamp: '2026-10-23T00:59:39.668Z',
      orderNumber: 536,
    },
  ],
  pedidosOrigenes: [
    { qtyAsignada: 2, lineIndex: 10, sku: 'LDM54TE1516015G', pedidoId: '1EAWK48bxRGikz0L1rus' },
    { qtyAsignada: 2, lineIndex: 14, sku: 'LDM54TE4028015S', pedidoId: '1EAWK48bxRGikz0L1rus' },
    { qtyAsignada: 2, lineIndex: 17, sku: 'LDM64TE2020030G', pedidoId: '1EAWK48bxRGikz0L1rus' },
    { qtyAsignada: 2, lineIndex: 18, sku: 'LDM64TE4028030G', pedidoId: '1EAWK48bxRGikz0L1rus' },
    { qtyAsignada: 2, lineIndex: 20, sku: 'LDM64TE5031530G', pedidoId: '1EAWK48bxRGikz0L1rus' },
  ],
  items: [
    // El SKU que gatilló STOCK_CHANGED en el log (16:46:27 UTC).
    { code: 'LDM54TE4028015S', qty: 2, origen: null, asigRefs: null },
    // SKUs manuales (NO están en pedidosOrigenes).
    { code: 'CUDC151MGA', qty: 1, origen: null, asigRefs: null },
    { code: 'CUDC151HGA', qty: 1, origen: null, asigRefs: null },
    { code: 'CIS150HGC', qty: 1, origen: null, asigRefs: null },
    { code: 'CIS151HGC', qty: 1, origen: null, asigRefs: null },
    { code: 'CU201HGM', qty: 1, origen: null, asigRefs: null },
    { code: 'LUGC15', qty: 1, origen: null, asigRefs: null },
    { code: 'LUGC17', qty: 1, origen: null, asigRefs: null },
    // Otros SKUs CPST que SÍ matchean con pedidosOrigenes.
    { code: 'LDM54TE1516015G', qty: 2, origen: null, asigRefs: null },
    { code: 'LDM64TE2020030G', qty: 2, origen: null, asigRefs: null },
    { code: 'LDM64TE4028030G', qty: 2, origen: null, asigRefs: null },
    { code: 'LDM64TE5031530G', qty: 2, origen: null, asigRefs: null },
  ],
};

describe('v1466 §64 hotfix Santi 2026-10-26 — waitlist CPST origen fallback', () => {
  it('T1 buildOrigenesBySkuFromWaitlist extrae map de 5 SKUs desde pedidosOrigenes', () => {
    const map = buildOrigenesBySkuFromWaitlist(WAITLIST_SANTI_533);
    expect(map).not.toBeNull();
    expect(Object.keys(map).sort()).toEqual([
      'LDM54TE1516015G',
      'LDM54TE4028015S',
      'LDM64TE2020030G',
      'LDM64TE4028030G',
      'LDM64TE5031530G',
    ]);
    // SKU reportado por Santi.
    expect(map['LDM54TE4028015S']).toEqual([
      {
        pedidoId: '1EAWK48bxRGikz0L1rus',
        lineIndex: 14,
        sku: 'LDM54TE4028015S',
        qtyAsignada: 2,
      },
    ]);
  });

  it('T2 enrichItemWithCpstOrigen deriva origen+asigRefs para LDM54TE4028015S (bug Santi)', () => {
    const map = buildOrigenesBySkuFromWaitlist(WAITLIST_SANTI_533);
    const item = WAITLIST_SANTI_533.items.find((it) => it.code === 'LDM54TE4028015S');
    const r = enrichItemWithCpstOrigen(item, map);
    expect(r.origen).toBe('stock-asignado');
    expect(r.asigRefs).toHaveLength(1);
    expect(r.asigRefs[0]).toEqual({
      pedidoId: '1EAWK48bxRGikz0L1rus',
      lineIndex: 14,
      sku: 'LDM54TE4028015S',
      qtyAsignada: 2,
    });
  });

  it('T3 SKUs manuales (CUDC151MGA, LUGC15, etc.) quedan SIN origen (fórmula global correcta)', () => {
    const map = buildOrigenesBySkuFromWaitlist(WAITLIST_SANTI_533);
    for (const sku of [
      'CUDC151MGA',
      'CUDC151HGA',
      'CIS150HGC',
      'CIS151HGC',
      'CU201HGM',
      'LUGC15',
      'LUGC17',
    ]) {
      const item = WAITLIST_SANTI_533.items.find((it) => it.code === sku);
      const r = enrichItemWithCpstOrigen(item, map);
      expect(r.origen, `${sku} debe quedar sin origen (manual)`).toBeUndefined();
      expect(r.asigRefs, `${sku} debe quedar sin asigRefs (manual)`).toBeUndefined();
    }
  });

  it('T4 todos los 5 SKUs CPST reciben origen+asigRefs post-fix', () => {
    const map = buildOrigenesBySkuFromWaitlist(WAITLIST_SANTI_533);
    const skusCpst = [
      'LDM54TE1516015G',
      'LDM54TE4028015S',
      'LDM64TE2020030G',
      'LDM64TE4028030G',
      'LDM64TE5031530G',
    ];
    for (const sku of skusCpst) {
      const item = WAITLIST_SANTI_533.items.find((it) => it.code === sku);
      const r = enrichItemWithCpstOrigen(item, map);
      expect(r.origen, `${sku} debe tener origen=stock-asignado`).toBe('stock-asignado');
      expect(r.asigRefs, `${sku} debe tener asigRefs`).toBeDefined();
      expect(r.asigRefs.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('T5 idempotencia: item con origen EXPLICITO (v1382+) se preserva sin tocar', () => {
    const map = buildOrigenesBySkuFromWaitlist(WAITLIST_SANTI_533);
    const itemV1382 = {
      code: 'LDM54TE4028015S',
      qty: 2,
      origen: 'stock-asignado',
      asigRefs: [{ pedidoId: 'otroPedido', lineIndex: 99, sku: 'LDM54TE4028015S', qtyAsignada: 5 }],
    };
    const r = enrichItemWithCpstOrigen(itemV1382, map);
    expect(r.origen).toBe('stock-asignado');
    expect(r.asigRefs).toEqual([
      { pedidoId: 'otroPedido', lineIndex: 99, sku: 'LDM54TE4028015S', qtyAsignada: 5 },
    ]);
  });

  it('T6 waitlist NO CPST (source=null) devuelve map null', () => {
    const w = { ...WAITLIST_SANTI_533, source: null };
    expect(buildOrigenesBySkuFromWaitlist(w)).toBeNull();
  });

  it('T7 waitlist CPST SIN pedidosOrigenes devuelve map null', () => {
    const w = { ...WAITLIST_SANTI_533, pedidosOrigenes: [] };
    expect(buildOrigenesBySkuFromWaitlist(w)).toBeNull();
  });

  it('T8 matching case-insensitive (SKU en item puede venir lowercase)', () => {
    const map = buildOrigenesBySkuFromWaitlist(WAITLIST_SANTI_533);
    const item = { code: 'ldm54te4028015s', qty: 2 };
    const r = enrichItemWithCpstOrigen(item, map);
    expect(r.origen).toBe('stock-asignado');
    expect(r.asigRefs).toHaveLength(1);
  });

  it('T9 waitlist CPST con items SIN items (null/undefined) devuelve objeto vacio sin error', () => {
    const map = buildOrigenesBySkuFromWaitlist(WAITLIST_SANTI_533);
    expect(enrichItemWithCpstOrigen(null, map)).toEqual({});
    expect(enrichItemWithCpstOrigen(undefined, map)).toEqual({});
    expect(enrichItemWithCpstOrigen({ code: 'X-sin-match', qty: 1 }, map)).toEqual({});
  });

  it('T10 CONTRATO con index.html: _waitlistPasarAPendientesContinuar usa el helper', async () => {
    const { readFileSync } = await import('node:fs');
    const html = readFileSync('index.html', 'utf8');
    const idx = html.indexOf('_waitlistPasarAPendientesContinuar = function(w)');
    expect(idx).toBeGreaterThan(0);
    const slice = html.slice(idx, idx + 8000);
    expect(slice).toMatch(/waitlistCpstOrigen/);
    expect(slice).toMatch(/buildOrigenesBySkuFromWaitlist/);
    expect(slice).toMatch(/enrichItemWithCpstOrigen/);
    // Fix outLines: preserva origen+asigRefs.
    expect(slice).toMatch(/l\.origen \? \{ origen: l\.origen \}/);
    expect(slice).toMatch(/l\.asigRefs/);
  });
});
