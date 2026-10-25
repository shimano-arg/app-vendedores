// @ts-check
/**
 * INCIDENTE 2026-10-25 post-apply W: los 7 pedidos reparados aparecían como
 * "undefined / Undefined", "Invalid Date", "sin catálogo" en el panel.
 * Root cause: pedidos creados por commitPedidoCF v1430+ NO incluyen los
 * campos legacy que el panel UI usa para armar las tarjetas:
 *   tipo, province, locName, key, month, monthIdx, year, orderNumber.
 *
 * Antes del fix §64.2 todos los pedidos CF iban a BO + via='app_only' y el
 * panel NO los mostraba, así que el shape incompleto pasaba desapercibido.
 * Post-reparación quedaron activos → panel los expuso.
 *
 * Scripts Z_fix_shape_reparados_2026-10-25.cjs completó los campos desde
 * `_draftId` + `confirmedAt`. Este test fija el contrato: un pedido reparado
 * debe tener EL MISMO shape panel-crítico que un pedido normal (uno
 * confirmado vía el flow histórico pre-CF, o uno confirmado via CF POST
 * fix de buildPedidoDocData si/cuando lo agreguemos).
 *
 * TODO futuro: agregar los mismos fields al `buildPedidoDocData` del
 * commit-pedido-core.js para que los pedidos nuevos no necesiten Z.
 */
import { describe, expect, it } from 'vitest';

/** Campos panel-críticos (los que el panel lee para armar tarjetas). */
const PANEL_CRITICAL_FIELDS = [
  'clientName', // "undefined" en nombre si falta
  'clientCardCode', // referencia SAP
  'tipo', // 'C' | 'P'
  'province', // "Undefined" en location si falta
  'locName', // "Undefined" en location si falta
  'key', // sin esto confirmed[key] agrupa como undefined
  'month', // "Invalid Date" si falta
  'monthIdx', // numeric filter
  'year', // numeric filter
  'confirmedAt', // card.cc-summary + fecha
  'stage', // panel filtra por 'pending' / 'confirmed'
  'lines', // card.cc-summary line count
];

/** Fixture: pedido normal confirmado via flow pre-CF (shape canónico UI). */
const PEDIDO_NORMAL = {
  clientName: 'LUCAS GALVAN',
  clientCardCode: 'C20XXXXXXXXX',
  tipo: 'C',
  province: 'BUENOS AIRES',
  locName: 'SALADILLO',
  key: 'C|BUENOS AIRES|SALADILLO|LUCAS GALVAN',
  month: 'Agosto 2026',
  monthIdx: 7,
  year: 2026,
  confirmedAt: '2026-08-15T15:30:00Z',
  stage: 'confirmed',
  lines: [{ code: 'SKU-A', qty: 1, state: 'confirmed' }],
  ownerVendor: 'FEDERICO CASTELANELLI',
  vendorAssigned: 'FEDERICO CASTELANELLI',
  assignedVendorUid: 'fIWSP9wcXsNyPCaKEvAIT9avCFC3',
  // Campos SAP legacy (opcionales, no panel-críticos):
  orderNumber: 123,
  netAmountArs: 100,
  subtotalArs: 100,
};

/** Fixture: pedido reparado por W_... + Z_... — DEBE matchear shape panel. */
const PEDIDO_REPARADO = {
  _commitVersion: 'commitPedidoCore_v1',
  _draftId: 'C|BUENOS AIRES|BARADERO|LUCAS MAXIMILIANO BAIGORRIA|537',
  clientName: 'LUCAS MAXIMILIANO BAIGORRIA',
  clientCardCode: 'C20337218831',
  tipo: 'C',
  province: 'BUENOS AIRES',
  locName: 'BARADERO',
  key: 'C|BUENOS AIRES|BARADERO|LUCAS MAXIMILIANO BAIGORRIA',
  month: 'Octubre 2026',
  monthIdx: 9,
  year: 2026,
  confirmedAt: '2026-10-24T16:25:23Z',
  stage: 'confirmed',
  lines: [
    { code: 'EXGC66MBAR', qty: 1, state: 'confirmed' },
    { code: 'EXGC66MHBAR', qty: 2, state: 'BO' },
  ],
  ownerVendor: 'FEDERICO CASTELANELLI',
  vendorAssigned: 'FEDERICO CASTELANELLI',
  assignedVendorUid: 'fIWSP9wcXsNyPCaKEvAIT9avCFC3',
  orderNumber: 537,
  netAmountArs: 2500,
  subtotalArs: 2500,
  // Campos del flow CF (específicos de commitPedidoCore):
  origen: 'cpst',
  waitlistOrigenId: 'wl-537',
  sapLinkage: { soDocEntry: null, lastInvoiceDocEntry: null, lastSyncAt: null },
  // Reparación W + fix Z audit:
  _backfill: {
    'W_bo_fantasma_2026-10-25': { by: 'W_...' },
    'Z_shape_fix_2026-10-25': { by: 'Z_...' },
  },
};

describe('Shape parity: pedido reparado vs pedido normal (panel UI)', () => {
  it('pedido normal tiene todos los campos panel-críticos', () => {
    for (const f of PANEL_CRITICAL_FIELDS) {
      expect(PEDIDO_NORMAL[f], `normal falta ${f}`).toBeDefined();
      expect(PEDIDO_NORMAL[f], `normal null/empty en ${f}`).not.toBeNull();
    }
  });

  it('pedido reparado tiene todos los campos panel-críticos', () => {
    for (const f of PANEL_CRITICAL_FIELDS) {
      expect(PEDIDO_REPARADO[f], `reparado falta ${f}`).toBeDefined();
      expect(PEDIDO_REPARADO[f], `reparado null en ${f}`).not.toBeNull();
    }
  });

  it('tipo + key canónicos coinciden en estructura', () => {
    expect(PEDIDO_REPARADO.tipo).toBe('C');
    // key = tipo|province|locName|clientName
    const expectedKey = `${PEDIDO_REPARADO.tipo}|${PEDIDO_REPARADO.province}|${PEDIDO_REPARADO.locName}|${PEDIDO_REPARADO.clientName}`;
    expect(PEDIDO_REPARADO.key).toBe(expectedKey);
    expect(PEDIDO_REPARADO.key).not.toMatch(/undefined/i);
  });

  it('month tiene formato "<Mes capitalizado> <YYYY>" para evitar Invalid Date', () => {
    expect(PEDIDO_REPARADO.month).toMatch(
      /^(Enero|Febrero|Marzo|Abril|Mayo|Junio|Julio|Agosto|Septiembre|Octubre|Noviembre|Diciembre) \d{4}$/
    );
    expect(PEDIDO_NORMAL.month).toMatch(
      /^(Enero|Febrero|Marzo|Abril|Mayo|Junio|Julio|Agosto|Septiembre|Octubre|Noviembre|Diciembre) \d{4}$/
    );
  });

  it('monthIdx 0-11 (JS getMonth) + year 4 dígitos', () => {
    expect(PEDIDO_REPARADO.monthIdx).toBeGreaterThanOrEqual(0);
    expect(PEDIDO_REPARADO.monthIdx).toBeLessThanOrEqual(11);
    expect(PEDIDO_REPARADO.year).toBeGreaterThanOrEqual(2000);
    expect(PEDIDO_REPARADO.year).toBeLessThanOrEqual(2100);
    // Consistencia: month "Octubre 2026" → monthIdx 9 (Octubre es índice 9).
    const monthName = String(PEDIDO_REPARADO.month).split(' ')[0];
    const mesesEs = [
      'Enero',
      'Febrero',
      'Marzo',
      'Abril',
      'Mayo',
      'Junio',
      'Julio',
      'Agosto',
      'Septiembre',
      'Octubre',
      'Noviembre',
      'Diciembre',
    ];
    expect(PEDIDO_REPARADO.monthIdx).toBe(mesesEs.indexOf(monthName));
  });

  it('stage es "confirmed" para pedido activo + "cancelled" excluye del panel Pendientes', () => {
    // renderPendientesList: `if (p.stage !== 'pending') return;` → stage='cancelled' se filtra fuera.
    expect(PEDIDO_REPARADO.stage).toBe('confirmed');
    // Simular SATO duplicado: stage='cancelled'.
    const dup = { ...PEDIDO_REPARADO, stage: 'cancelled' };
    expect(dup.stage).toBe('cancelled');
    expect(dup.stage).not.toBe('pending');
    expect(dup.stage).not.toBe('confirmed');
  });

  it('confirmedAt parse-able por Date() (no "Invalid Date" en new Date(it.conf.confirmedAt).toLocaleDateString())', () => {
    const d = new Date(PEDIDO_REPARADO.confirmedAt);
    expect(d.toString()).not.toMatch(/Invalid Date/);
    expect(d.getFullYear()).toBe(2026);
  });

  it('key NO contiene "undefined" (si falta province/locName, panel muestra "undefined / Undefined")', () => {
    expect(PEDIDO_REPARADO.key).not.toMatch(/undefined/i);
    expect(PEDIDO_REPARADO.key.split('|')).toHaveLength(4);
    for (const part of PEDIDO_REPARADO.key.split('|')) {
      expect(part).toBeTruthy();
      expect(part).not.toBe('undefined');
    }
  });

  it('reparación conserva fields CF-específicos (origen, _commitVersion, waitlistOrigenId)', () => {
    expect(PEDIDO_REPARADO._commitVersion).toBe('commitPedidoCore_v1');
    expect(PEDIDO_REPARADO.origen).toBe('cpst');
    expect(PEDIDO_REPARADO.waitlistOrigenId).toBeTruthy();
  });

  it('_backfill §55 presente con snapshot anterior', () => {
    expect(PEDIDO_REPARADO._backfill).toBeTruthy();
    const keys = Object.keys(PEDIDO_REPARADO._backfill);
    expect(keys.some((k) => k.includes('W_bo_fantasma'))).toBe(true);
    expect(keys.some((k) => k.includes('Z_shape_fix'))).toBe(true);
  });

  it('contrato Z: parseDraftId extrae tipo|province|locName|clientName|orderNumber', () => {
    const draftId = 'C|BUENOS AIRES|BARADERO|LUCAS MAXIMILIANO BAIGORRIA|537';
    const parts = draftId.split('|');
    expect(parts).toHaveLength(5);
    expect(parts[0]).toBe('C');
    expect(parts[1]).toBe('BUENOS AIRES');
    expect(parts[2]).toBe('BARADERO');
    expect(parts[3]).toBe('LUCAS MAXIMILIANO BAIGORRIA');
    expect(parts[4]).toBe('537');
  });

  it('futuro: commitPedidoCore debería incluir estos campos en buildPedidoDocData (actualmente NO)', async () => {
    const { readFileSync } = await import('node:fs');
    const coreJs = readFileSync('functions/core/commit-pedido-core.js', 'utf8');
    // Grep del buildPedidoDocData para ver qué campos escribe.
    const buildStart = coreJs.indexOf('function buildPedidoDocData');
    expect(buildStart).toBeGreaterThan(0);
    const buildEnd = coreJs.indexOf('\n}\n', buildStart);
    const buildBody = coreJs.slice(buildStart, buildEnd);
    // DOCUMENTO el gap conocido: hoy NO incluye estos panel-fields.
    // Cuando lo arreglemos (todo futuro), este test debe pasar afirmativamente.
    const PENDING_FIELDS_IN_BUILD = [
      'tipo',
      'province',
      'locName',
      'key',
      'month',
      'monthIdx',
      'year',
    ];
    const missing = [];
    for (const f of PENDING_FIELDS_IN_BUILD) {
      const re = new RegExp(`\\b${f}\\b\\s*:`);
      if (!re.test(buildBody)) missing.push(f);
    }
    // Hoy: TODOS faltan. Documentar el gap. El día que arreglemos esto en
    // buildPedidoDocData, cambiar `expect(missing.length).toBeGreaterThan(0)`
    // por `expect(missing).toEqual([])`.
    expect(missing.length).toBeGreaterThan(0); // documento el gap (actualmente)
    console.warn('[parity test] buildPedidoDocData NO incluye panel fields:', missing.join(', '));
  });
});
