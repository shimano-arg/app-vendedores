// @ts-check
/**
 * v1485 §84 (2026-10-27) — bug fix Masterfile export:
 *
 * Síntoma Mariano: Fidelidad, Preferencia de contacto, Tamaño, Especialización
 * y Tipo de local salen "-" para TODOS los clientes aunque la Ficha Cliente
 * tenga esos campos cargados. Tipo de cliente SÍ sale bien.
 *
 * Caso MAXERA (C20110561068): Ficha completa con "B / BAJA / PRESENCIAL /
 * CHICA / AGUA_DULCE / FISICO / 5000000" pero el Excel saca "-" para los 5.
 *
 * Causa raíz confirmada contra prod:
 *   - MAXERA en POINTS: province="CAPITAL FEDERAL", name="Palermo (C14)".
 *   - clientLocId genera slug `capital_federal__palermo_c14__alberto_maxera`.
 *   - Pero la Ficha persiste con localidad="COLEGIALES" en el doc
 *     `capital_federal__colegiales__alberto_maxera` (que SÍ tiene todos los
 *     6 campos cargados).
 *   - Hay DOS docs client_master de MAXERA: el importado SAP (sin Ficha) y
 *     el de la Ficha (con los campos).
 *   - El export v1482 hacía `clientMasterCache.get(clientLocId(point.province,
 *     point.name, name))` = slug mismatch → cmData sin campos → "-".
 *
 * Fix v1485: nueva pure fn findCmDataByCardCode(cardCode, cache) que scanea
 * client_master por sapCardCode OR cardCodeSap. Reemplaza el lookup por slug
 * en el export para ambos paths (POINTS y altas).
 *
 * Por qué los tests v1482 no agarraron el bug:
 *   - Los tests pasaban cmData YA RESUELTO al pure fn fichaClienteClasifRow,
 *     verificando el mapping código → label. Ese mapping ES correcto.
 *   - El bug estaba en el PATH anterior: cómo el export obtiene cmData.
 *     Ese path (`clientMasterCache.get(clientLocId(...))`) no estaba
 *     cubierto por tests de integración.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  fichaClienteClasifRow,
  findCmDataByCardCode,
} from '../../../src/pure/ficha-cliente-labels.js';

describe('v1485 §84 — findCmDataByCardCode (pure fn fuente única)', () => {
  it('T1 scan por sapCardCode → retorna doc correcto', () => {
    const cache = new Map();
    cache.set('otro_slug', { sapCardCode: 'C9999', clientName: 'OTRO' });
    cache.set('capital_federal__colegiales__alberto_maxera', {
      sapCardCode: 'C20110561068',
      clientName: 'ALBERTO MAXERA',
      cliTipo: 'B',
      fidelidad: 'BAJA',
      prefContacto: 'PRESENCIAL',
      tamano: 'CHICA',
      especializacion: 'AGUA_DULCE',
      tipoLocal: 'FISICO',
      creditoCheque: 5000000,
    });
    const found = findCmDataByCardCode('C20110561068', cache);
    expect(found).not.toBeNull();
    expect(found.clientName).toBe('ALBERTO MAXERA');
    expect(found.cliTipo).toBe('B');
    expect(found.fidelidad).toBe('BAJA');
  });

  it('T2 scan por cardCodeSap alias (otros docs usan ese nombre)', () => {
    const cache = new Map([
      ['X', { cardCodeSap: 'C20110561068', clientName: 'MAXERA', fidelidad: 'ALTA' }],
    ]);
    const found = findCmDataByCardCode('C20110561068', cache);
    expect(found).not.toBeNull();
    expect(found.fidelidad).toBe('ALTA');
  });

  it('T3 cardCode no existe → null', () => {
    const cache = new Map([['X', { sapCardCode: 'C9999' }]]);
    expect(findCmDataByCardCode('C_INEXISTENTE', cache)).toBeNull();
  });

  it('T4 cardCode vacío → null (sin crash)', () => {
    expect(findCmDataByCardCode('', new Map())).toBeNull();
    expect(findCmDataByCardCode(null, new Map())).toBeNull();
    expect(findCmDataByCardCode(undefined, new Map())).toBeNull();
  });

  it('T5 cache null → null', () => {
    expect(findCmDataByCardCode('C001', null)).toBeNull();
    expect(findCmDataByCardCode('C001', undefined)).toBeNull();
  });

  it('T6 cache sin forEach (objeto plano) → null (defensa)', () => {
    expect(findCmDataByCardCode('C001', /** @type {any} */ ({}))).toBeNull();
  });

  it('T7 trim cardCode antes de comparar', () => {
    const cache = new Map([['X', { sapCardCode: 'C001', fidelidad: 'MEDIA' }]]);
    const found = findCmDataByCardCode('  C001  ', cache);
    expect(found).not.toBeNull();
    expect(found.fidelidad).toBe('MEDIA');
  });
});

describe('v1485 §84 — REPRO: bug v1482 con 2 docs de MAXERA', () => {
  // Reproduce la situación exacta de prod: 2 docs del mismo cliente, uno
  // sin Ficha y uno con. El export viejo usaba el slug clientLocId que
  // apuntaba al doc EQUIVOCADO (sin Ficha).
  const CACHE_MAXERA = new Map([
    // Doc importado desde SAP (sin Ficha).
    [
      '(sin provincia)__(sin localidad)__ALBERTO MAXERA',
      {
        sapCardCode: 'C20110561068',
        clientName: 'ALBERTO MAXERA',
        provincia: '(sin provincia)',
        localidad: '(sin localidad)',
        address: 'LACROZE FEDERICO AV. 2819 Piso:PB',
        // cliTipo, fidelidad, etc. UNDEFINED (nunca se cargó Ficha acá).
      },
    ],
    // Doc creado por la Ficha (CON campos).
    [
      'capital_federal__colegiales__alberto_maxera',
      {
        cardCodeSap: 'C20110561068',
        clientName: 'ALBERTO MAXERA',
        provincia: 'CAPITAL FEDERAL',
        localidad: 'COLEGIALES',
        cliTipo: 'B',
        fidelidad: 'BAJA',
        prefContacto: 'PRESENCIAL',
        tamano: 'CHICA',
        especializacion: 'AGUA_DULCE',
        tipoLocal: 'FISICO',
        creditoCheque: 5000000,
      },
    ],
  ]);

  it('T20 lookup v1482 (por slug POINTS) devuelve el doc EQUIVOCADO', () => {
    // El slug POINTS es "palermo_c14" pero el doc Ficha vive en "colegiales".
    const slugFromPoints = 'capital_federal__palermo_c14__alberto_maxera';
    const cmData = CACHE_MAXERA.get(slugFromPoints);
    expect(cmData, 'bug repro: el slug POINTS no matchea ningún doc').toBeUndefined();
    // El export v1482 pasaba este cmData (undefined → {}) al pure fn.
    const row = fichaClienteClasifRow(cmData);
    // Resultado del bug: TODOS los campos salen "-" (correcto para cmData
    // vacío, pero semánticamente mal porque los datos SÍ existen en Firestore).
    expect(row['Tipo de cliente']).toBe('-');
    expect(row.Fidelidad).toBe('-');
    expect(row['Preferencia de contacto']).toBe('-');
    expect(row.Tamaño).toBe('-');
    expect(row.Especialización).toBe('-');
    expect(row['Tipo de local']).toBe('-');
    expect(row['Crédito cheque (ARS)']).toBe('-');
  });

  it('T21 fix v1485 (findCmDataByCardCode) devuelve el doc CORRECTO', () => {
    const cmData = findCmDataByCardCode('C20110561068', CACHE_MAXERA);
    expect(cmData, 'fix: encuentra el doc con la Ficha populated').not.toBeNull();
    const row = fichaClienteClasifRow(cmData);
    expect(row['Tipo de cliente']).toBe('B - sin descuento');
    expect(row.Fidelidad).toBe('Baja');
    expect(row['Preferencia de contacto']).toBe('Presencial');
    expect(row.Tamaño).toBe('Chica');
    expect(row.Especialización).toBe('Agua dulce');
    expect(row['Tipo de local']).toBe('Físico');
    expect(row['Crédito cheque (ARS)']).toBe(5000000);
  });

  it('T22 cuando el único doc es el SAP import (sin Ficha), fallback a "-" OK', () => {
    const cache = new Map([
      [
        'otro_slug',
        {
          sapCardCode: 'C001',
          clientName: 'FULANO',
          // Sin cliTipo/fidelidad/etc.
        },
      ],
    ]);
    const cmData = findCmDataByCardCode('C001', cache);
    expect(cmData).not.toBeNull();
    const row = fichaClienteClasifRow(cmData);
    expect(row['Tipo de cliente']).toBe('-');
    expect(row.Fidelidad).toBe('-');
    // Ningún campo tiene fuente → todo "-" (semánticamente correcto).
  });
});

describe('v1485 §84 — contrato exports-core.js usa findCmDataByCardCode', () => {
  const EXPORTS = readFileSync('src/domains/exports-core.js', 'utf8');

  it('T30 export define _findByCard que usa el pure fn', () => {
    expect(EXPORTS).toMatch(/_findByCard/);
    expect(EXPORTS).toMatch(/findCmDataByCardCode/);
  });

  it('T31 POINTS path usa _findByCard antes del _clasifRow', () => {
    const idx = EXPORTS.indexOf('_cmDataForFicha = _findByCard');
    expect(idx).toBeGreaterThan(0);
    const slice = EXPORTS.slice(idx, idx + 2000);
    expect(slice).toMatch(/_findByCard\(cardCode, clientMasterCache\)/);
    expect(slice).toMatch(/_clasifRow\(_cmDataForFicha\)/);
  });

  it('T32 ALTAS path usa _findByCard antes del _clasifRow', () => {
    const idx = EXPORTS.indexOf('_altaCmData = ');
    expect(idx).toBeGreaterThan(0);
    const slice = EXPORTS.slice(idx, idx + 2000);
    expect(slice).toMatch(/_findByCard\(a\.cardCodeSap, clientMasterCache\)/);
    expect(slice).toMatch(/_clasifRow\(_altaCmData\)/);
  });

  it('T33 columnas estructurales protegidas (nunca se omiten)', () => {
    expect(EXPORTS).toMatch(/STRUCTURAL_PROTECTED/);
    const idx = EXPORTS.indexOf('STRUCTURAL_PROTECTED');
    const slice = EXPORTS.slice(idx, idx + 1000);
    for (const col of [
      'CardCode SAP',
      'Nombre tienda',
      'Zona',
      'Vendedor externo',
      'Direccion',
      'Lat (geocode)',
    ]) {
      expect(slice).toContain(col);
    }
  });

  it('T34 ambos sets (STRUCTURAL + FICHA) chequeados antes de omitir', () => {
    expect(EXPORTS).toMatch(/if \(STRUCTURAL_PROTECTED\.has\(k\)\) return false;/);
    expect(EXPORTS).toMatch(/if \(FICHA_PROTECTED\.has\(k\)\) return false;/);
  });
});

describe('v1485 §84 — fixture 3 clientes para los 3 roles (admin / VDE / PACHI)', () => {
  // Clientes con distintos assignedVendor + perfiles de Ficha.
  const CMASTER = new Map([
    [
      'slug1',
      {
        sapCardCode: 'C001',
        clientName: 'CLIENTE COMPLETO',
        cliTipo: 'A',
        fidelidad: 'ALTA',
        prefContacto: 'AMBOS',
        tamano: 'GRANDE',
        especializacion: 'PESCA_DE_MAR',
        tipoLocal: 'FISICO',
        creditoCheque: 10000000,
      },
    ],
    [
      'slug2',
      {
        sapCardCode: 'C002',
        clientName: 'CLIENTE PARCIAL',
        cliTipo: 'B',
        fidelidad: 'MEDIA',
        // Sin prefContacto / tamano / especializacion / tipoLocal / credito.
      },
    ],
    // Cliente 3 sin ficha ni doc en master.
  ]);

  it('T40 cliente con Ficha completa: todos los labels poblados (ningún "-")', () => {
    const cmData = findCmDataByCardCode('C001', CMASTER);
    const row = fichaClienteClasifRow(cmData);
    expect(row['Tipo de cliente']).toBe('A - fijo 3% / anticipado 3%');
    expect(row.Fidelidad).toBe('Alta');
    expect(row['Preferencia de contacto']).toBe('Ambos');
    expect(row.Tamaño).toBe('Grande');
    expect(row.Especialización).toBe('Pesca de mar');
    expect(row['Tipo de local']).toBe('Físico');
    expect(row['Crédito cheque (ARS)']).toBe(10000000);
    for (const v of Object.values(row)) {
      expect(v, 'cliente completo: ninguna celda "-"').not.toBe('-');
    }
  });

  it('T41 cliente con Ficha parcial: algunos labels, otros "-"', () => {
    const cmData = findCmDataByCardCode('C002', CMASTER);
    const row = fichaClienteClasifRow(cmData);
    expect(row['Tipo de cliente']).toBe('B - sin descuento');
    expect(row.Fidelidad).toBe('Media');
    expect(row['Preferencia de contacto']).toBe('-');
    expect(row.Tamaño).toBe('-');
    expect(row.Especialización).toBe('-');
    expect(row['Tipo de local']).toBe('-');
    expect(row['Crédito cheque (ARS)']).toBe('-');
  });

  it('T42 cliente sin Ficha ni doc master: todos "-" (comportamiento correcto)', () => {
    const cmData = findCmDataByCardCode('C_INEXISTENTE', CMASTER);
    expect(cmData).toBeNull();
    const row = fichaClienteClasifRow(cmData);
    for (const v of Object.values(row)) {
      expect(v).toBe('-');
    }
  });
});

describe('v1485 — bump versión', () => {
  it('T50 APP_VERSION ≥ v1485 + sync SW', () => {
    const html = readFileSync('index.html', 'utf8');
    const sw = readFileSync('sw.js', 'utf8');
    const appMatch = html.match(/const APP_VERSION = 'v(\d+)'/);
    const swMatch = sw.match(/const CACHE_VERSION = 'v(\d+)'/);
    expect(appMatch).not.toBeNull();
    expect(swMatch).not.toBeNull();
    expect(Number(appMatch[1])).toBeGreaterThanOrEqual(1485);
    expect(appMatch[1]).toBe(swMatch[1]);
  });
});
