// @ts-check
/**
 * v1482 §82 (2026-10-27) — Masterfile export + Ficha Cliente labels fuente única.
 *
 * Pedido Mariano:
 *   - Agregar columnas Clasificación (Tipo cliente, Fidelidad, Preferencia
 *     contacto, Tamaño, Especialización, Tipo local, Crédito cheque ARS) +
 *     Buyer (Monto, Facturas, Promedio, Frecuencia, Facturas/mes, Primera y
 *     Última compra, Días desde última).
 *   - Ninguna celda queda vacía: "-" como fallback.
 *   - Labels EXACTOS como se ven en la Ficha: "B - sin descuento", no "B".
 *   - Fuente única: pure fn reusada por Masterfile export + cartera-vendor
 *     columna TIPO.
 *
 * Tests cubren 3 clientes de fixture + grep contrato de los call-sites.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  FICHA_CLASIF_LABELS,
  fichaClienteBuyerRow,
  fichaClienteClasifRow,
  fillDashInEmpty,
  labelForFichaField,
} from '../../../src/pure/ficha-cliente-labels.js';

describe('v1482 §82 — labelForFichaField', () => {
  it('T1 cliTipo B → "B - sin descuento" (label exacto del modal)', () => {
    expect(labelForFichaField('cliTipo', 'B')).toBe('B - sin descuento');
  });

  it('T2 cliTipo P → label Premium con porcentajes', () => {
    expect(labelForFichaField('cliTipo', 'P')).toBe('P (Premium) - fijo 6% / anticipado 5%');
  });

  it('T3 fidelidad BAJA → "Baja"', () => {
    expect(labelForFichaField('fidelidad', 'BAJA')).toBe('Baja');
  });

  it('T4 prefContacto PRESENCIAL → "Presencial"', () => {
    expect(labelForFichaField('prefContacto', 'PRESENCIAL')).toBe('Presencial');
  });

  it('T5 prefContacto AUTOGESTION_B2B → "Autogestión (B2B)" (con tilde)', () => {
    expect(labelForFichaField('prefContacto', 'AUTOGESTION_B2B')).toBe('Autogestión (B2B)');
  });

  it('T6 tamano CHICA → "Chica"', () => {
    expect(labelForFichaField('tamano', 'CHICA')).toBe('Chica');
  });

  it('T7 especializacion AGUA_DULCE → "Agua dulce"', () => {
    expect(labelForFichaField('especializacion', 'AGUA_DULCE')).toBe('Agua dulce');
  });

  it('T8 tipoLocal FISICO → "Físico" (con tilde)', () => {
    expect(labelForFichaField('tipoLocal', 'FISICO')).toBe('Físico');
  });

  it('T9 valor vacío/null/undefined → "-"', () => {
    expect(labelForFichaField('cliTipo', '')).toBe('-');
    expect(labelForFichaField('cliTipo', null)).toBe('-');
    expect(labelForFichaField('cliTipo', undefined)).toBe('-');
  });

  it('T10 campo desconocido → "-"', () => {
    expect(labelForFichaField('fieldInventado', 'X')).toBe('-');
  });

  it('T11 valor no mapeado → "-"', () => {
    expect(labelForFichaField('cliTipo', 'Z')).toBe('-');
  });

  it('T12 valor case-insensitive (uppercase normalization)', () => {
    expect(labelForFichaField('cliTipo', 'b')).toBe('B - sin descuento');
    expect(labelForFichaField('fidelidad', 'baja')).toBe('Baja');
  });
});

describe('v1482 §82 — fichaClienteClasifRow (Clasificación)', () => {
  it('T20 cliente con Ficha completa (ALBERTO MAXERA fixture): todos los labels poblados', () => {
    // Mariano confirmó estos valores para ALBERTO MAXERA (C20110561068):
    // "B sin descuento, Baja, Presencial, Chica, Agua dulce, Fisico, credito 5000000"
    const cmData = {
      cliTipo: 'B',
      fidelidad: 'BAJA',
      prefContacto: 'PRESENCIAL',
      tamano: 'CHICA',
      especializacion: 'AGUA_DULCE',
      tipoLocal: 'FISICO',
      creditoCheque: 5000000,
    };
    const row = fichaClienteClasifRow(cmData);
    expect(row['Tipo de cliente']).toBe('B - sin descuento');
    expect(row.Fidelidad).toBe('Baja');
    expect(row['Preferencia de contacto']).toBe('Presencial');
    expect(row.Tamaño).toBe('Chica');
    expect(row.Especialización).toBe('Agua dulce');
    expect(row['Tipo de local']).toBe('Físico');
    expect(row['Crédito cheque (ARS)']).toBe(5000000);
  });

  it('T21 cliente SIN Ficha (cmData={}): todas las celdas en "-"', () => {
    const row = fichaClienteClasifRow({});
    expect(row['Tipo de cliente']).toBe('-');
    expect(row.Fidelidad).toBe('-');
    expect(row['Preferencia de contacto']).toBe('-');
    expect(row.Tamaño).toBe('-');
    expect(row.Especialización).toBe('-');
    expect(row['Tipo de local']).toBe('-');
    expect(row['Crédito cheque (ARS)']).toBe('-');
    for (const v of Object.values(row)) {
      expect(v, 'ninguna celda vacía').not.toBe('');
      expect(v, 'ninguna celda null/undefined').not.toBeNull();
    }
  });

  it('T22 cliente SIN Ficha (cmData=null): no crash, todas "-"', () => {
    const row = fichaClienteClasifRow(null);
    expect(row['Tipo de cliente']).toBe('-');
    expect(row['Crédito cheque (ARS)']).toBe('-');
  });

  it('T23 Ficha PARCIAL (sólo cliTipo + credito): otros campos "-"', () => {
    const cmData = { cliTipo: 'A', creditoCheque: 100000 };
    const row = fichaClienteClasifRow(cmData);
    expect(row['Tipo de cliente']).toBe('A - fijo 3% / anticipado 3%');
    expect(row['Crédito cheque (ARS)']).toBe(100000);
    expect(row.Fidelidad).toBe('-');
    expect(row['Preferencia de contacto']).toBe('-');
    expect(row.Tamaño).toBe('-');
    expect(row.Especialización).toBe('-');
    expect(row['Tipo de local']).toBe('-');
  });

  it('T24 crédito 0 → "-" (no celda vacía ni número engañoso)', () => {
    const row = fichaClienteClasifRow({ creditoCheque: 0 });
    expect(row['Crédito cheque (ARS)']).toBe('-');
  });

  it('T25 crédito como string numérico → convertido a entero', () => {
    const row = fichaClienteClasifRow({ creditoCheque: '7500000.5' });
    expect(row['Crédito cheque (ARS)']).toBe(7500001); // Math.round
  });
});

describe('v1482 §82 — fichaClienteBuyerRow (Buyer, 12m default)', () => {
  it('T30 buyer stats completos → números enteros + fechas string', () => {
    const bs = {
      stats_12m: {
        montoTotal: 4238567.78,
        facturasCount: 24,
        montoPromedio: 176607,
        frecuenciaDias: 15.3,
        facturasPorMes: 2.1,
        primeraCompra: '2025-04-10',
        ultimaCompra: '2026-10-15',
        diasDesdeUltima: 12,
      },
    };
    const row = fichaClienteBuyerRow(bs);
    expect(row['Monto total (12m)']).toBe(4238568);
    expect(row['Facturas (12m)']).toBe(24);
    expect(row['Promedio por factura (12m)']).toBe(176607);
    expect(row['Frecuencia (días entre compras)']).toBe(15);
    expect(row['Facturas por mes (12m)']).toBe(2.1);
    expect(row['Primera compra']).toBe('2025-04-10');
    expect(row['Última compra']).toBe('2026-10-15');
    expect(row['Días desde última compra']).toBe(12);
  });

  it('T31 buyer stats null → todas las columnas "-"', () => {
    const row = fichaClienteBuyerRow(null);
    for (const v of Object.values(row)) {
      expect(v).toBe('-');
    }
  });

  it('T32 buyer stats sin stats_12m → "-"', () => {
    const row = fichaClienteBuyerRow({});
    for (const v of Object.values(row)) {
      expect(v).toBe('-');
    }
  });

  it('T33 ventana custom "3m"', () => {
    const bs = {
      stats_3m: { montoTotal: 50000, facturasCount: 3, ultimaCompra: '2026-10-20' },
    };
    const row = fichaClienteBuyerRow(bs, '3m');
    expect(row['Monto total (12m)']).toBe(50000);
    expect(row['Facturas (12m)']).toBe(3);
    expect(row['Última compra']).toBe('2026-10-20');
  });
});

describe('v1482 §82 — fillDashInEmpty (regla "ninguna celda vacía")', () => {
  it('T40 reemplaza "", null, undefined, 0 por "-"', () => {
    const out = fillDashInEmpty({ a: '', b: null, c: undefined, d: 0, e: 'ok', f: 1 });
    expect(out.a).toBe('-');
    expect(out.b).toBe('-');
    expect(out.c).toBe('-');
    expect(out.d).toBe('-');
    expect(out.e).toBe('ok');
    expect(out.f).toBe(1);
  });

  it('T41 preserva 0 si está en numericZeroOk', () => {
    const out = fillDashInEmpty(
      { 'Total visitas': 0, 'Monto total (12m)': 0 },
      new Set(['Total visitas'])
    );
    expect(out['Total visitas']).toBe(0);
    expect(out['Monto total (12m)']).toBe('-');
  });

  it('T42 input vacío → objeto vacío (no crash)', () => {
    expect(fillDashInEmpty({})).toEqual({});
    expect(fillDashInEmpty(null)).toEqual({});
  });
});

describe('v1482 §82 — 3 fixtures end-to-end (Mariano test spec)', () => {
  // Fixture 1: Ficha COMPLETA (ALBERTO MAXERA).
  const CMDATA_COMPLETO = {
    cliTipo: 'B',
    fidelidad: 'BAJA',
    prefContacto: 'PRESENCIAL',
    tamano: 'CHICA',
    especializacion: 'AGUA_DULCE',
    tipoLocal: 'FISICO',
    creditoCheque: 5000000,
  };
  const BUYER_COMPLETO = {
    stats_12m: {
      montoTotal: 2500000,
      facturasCount: 10,
      montoPromedio: 250000,
      frecuenciaDias: 36,
      facturasPorMes: 0.83,
      primeraCompra: '2026-01-10',
      ultimaCompra: '2026-10-20',
      diasDesdeUltima: 7,
    },
  };
  // Fixture 2: SIN Ficha ni Buyer.
  const CMDATA_SIN_FICHA = {};
  const BUYER_SIN = null;
  // Fixture 3: Ficha PARCIAL (sólo cliTipo + fidelidad) + Buyer stats_12m incompleto.
  const CMDATA_PARCIAL = { cliTipo: 'A', fidelidad: 'MEDIA' };
  const BUYER_PARCIAL = { stats_12m: { montoTotal: 100000, facturasCount: 2 } };

  it('T50 Fixture completo: TODOS los labels poblados + números enteros', () => {
    const clasif = fichaClienteClasifRow(CMDATA_COMPLETO);
    const buyer = fichaClienteBuyerRow(BUYER_COMPLETO);
    const row = fillDashInEmpty(Object.assign({}, clasif, buyer));
    // Clasif con labels exactos.
    expect(row['Tipo de cliente']).toBe('B - sin descuento');
    expect(row.Fidelidad).toBe('Baja');
    expect(row['Preferencia de contacto']).toBe('Presencial');
    expect(row.Tamaño).toBe('Chica');
    expect(row.Especialización).toBe('Agua dulce');
    expect(row['Tipo de local']).toBe('Físico');
    expect(row['Crédito cheque (ARS)']).toBe(5000000);
    // Buyer.
    expect(row['Monto total (12m)']).toBe(2500000);
    expect(row['Facturas (12m)']).toBe(10);
    expect(row['Primera compra']).toBe('2026-01-10');
    expect(row['Última compra']).toBe('2026-10-20');
    // Ninguna celda vacía.
    for (const v of Object.values(row)) {
      expect(v).not.toBe('');
      expect(v).not.toBeNull();
      expect(v).not.toBeUndefined();
    }
  });

  it('T51 Fixture sin Ficha: TODAS las celdas en "-", ninguna vacía', () => {
    const clasif = fichaClienteClasifRow(CMDATA_SIN_FICHA);
    const buyer = fichaClienteBuyerRow(BUYER_SIN);
    const row = fillDashInEmpty(Object.assign({}, clasif, buyer));
    // Todas en "-".
    for (const v of Object.values(row)) {
      expect(v).toBe('-');
    }
  });

  it('T52 Fixture parcial: algunas con label, otras "-"', () => {
    const clasif = fichaClienteClasifRow(CMDATA_PARCIAL);
    const buyer = fichaClienteBuyerRow(BUYER_PARCIAL);
    const row = fillDashInEmpty(Object.assign({}, clasif, buyer));
    expect(row['Tipo de cliente']).toBe('A - fijo 3% / anticipado 3%');
    expect(row.Fidelidad).toBe('Media');
    expect(row['Preferencia de contacto']).toBe('-');
    expect(row.Tamaño).toBe('-');
    expect(row.Especialización).toBe('-');
    expect(row['Tipo de local']).toBe('-');
    expect(row['Crédito cheque (ARS)']).toBe('-');
    expect(row['Monto total (12m)']).toBe(100000);
    expect(row['Facturas (12m)']).toBe(2);
    // Promedio no viene → "-".
    expect(row['Promedio por factura (12m)']).toBe('-');
    expect(row['Primera compra']).toBe('-');
    expect(row['Última compra']).toBe('-');
    // Ninguna celda vacía.
    for (const v of Object.values(row)) {
      expect(v).not.toBe('');
      expect(v).not.toBeNull();
      expect(v).not.toBeUndefined();
    }
  });
});

describe('v1482 §82 — contrato: exports-core.js y cartera-vendor.js reusan el pure', () => {
  const EXPORTS = readFileSync('src/domains/exports-core.js', 'utf8');
  const CARTERA = readFileSync('src/domains/cartera-vendor.js', 'utf8');
  const MAIN = readFileSync('src/main.js', 'utf8');

  it('T60 exports-core usa fichaClienteClasifRow + fichaClienteBuyerRow + fillDashInEmpty', () => {
    expect(EXPORTS).toMatch(/fichaClienteLabels/);
    // v1485 §84: _clasifRow ahora recibe _cmDataForFicha (POINTS) o
    // _altaCmData (altas) — docs resueltos por findCmDataByCardCode.
    expect(EXPORTS).toMatch(/_clasifRow\(_cmDataForFicha\)/);
    expect(EXPORTS).toMatch(/_clasifRow\(_altaCmData\)/);
    expect(EXPORTS).toMatch(/_buyerRow\(_buyerStats\)/);
    expect(EXPORTS).toMatch(/_buyerRow\(_altaBuyerStats\)/);
    expect(EXPORTS).toMatch(/_fillDash\(out\)/);
  });

  it('T61 exports-core carga client_buyer_stats batch antes del armado', () => {
    expect(EXPORTS).toMatch(/const buyerStatsIdx = new Map\(\)/);
    expect(EXPORTS).toMatch(/fbDb\.collection\('client_buyer_stats'\)\.get\(\)/);
  });

  it('T62 exports-core protege columnas Ficha de ser removidas aun si todas "-"', () => {
    expect(EXPORTS).toMatch(/FICHA_PROTECTED/);
    expect(EXPORTS).toMatch(/'Tipo de cliente',\s*'Fidelidad'/);
  });

  it('T63 Resumen por zona agrega Por Tipo de cliente + Por Fidelidad', () => {
    expect(EXPORTS).toMatch(/'Por Tipo de cliente':/);
    expect(EXPORTS).toMatch(/'Por Fidelidad':/);
  });

  it('T64 cartera-vendor usa labelForFichaField en TIPO (badge DOM + export Excel)', () => {
    expect(CARTERA).toMatch(/import \{\s*labelForFichaField\s*\}\s*from.*ficha-cliente-labels/);
    expect(CARTERA).toMatch(/tipoBadge\.textContent = labelForFichaField\('cliTipo', c\.cliTipo\)/);
    expect(CARTERA).toMatch(
      /row\.getCell\(4\)\.value = labelForFichaField\('cliTipo', c\.cliTipo\)/
    );
  });

  it('T65 main.js expone fichaClienteLabels en window.__phase0.pure', () => {
    expect(MAIN).toMatch(/FICHA_CLASIF_LABELS/);
    expect(MAIN).toMatch(/fichaClienteLabels: \{/);
    expect(MAIN).toMatch(/labelForFichaField,/);
  });
});

describe('v1482 — bump versión', () => {
  it('T70 APP_VERSION ≥ v1482 + sync SW', () => {
    const html = readFileSync('index.html', 'utf8');
    const sw = readFileSync('sw.js', 'utf8');
    const appMatch = html.match(/const APP_VERSION = 'v(\d+)'/);
    const swMatch = sw.match(/const CACHE_VERSION = 'v(\d+)'/);
    expect(appMatch, 'APP_VERSION no encontrada').not.toBeNull();
    expect(swMatch, 'CACHE_VERSION no encontrada').not.toBeNull();
    expect(Number(appMatch[1])).toBeGreaterThanOrEqual(1482);
    expect(appMatch[1]).toBe(swMatch[1]);
  });
});

describe('v1482 §82 — FICHA_CLASIF_LABELS frozen', () => {
  it('T80 labels frozen (inmutables)', () => {
    expect(Object.isFrozen(FICHA_CLASIF_LABELS)).toBe(true);
    expect(Object.isFrozen(FICHA_CLASIF_LABELS.cliTipo)).toBe(true);
    expect(Object.isFrozen(FICHA_CLASIF_LABELS.fidelidad)).toBe(true);
  });
});
