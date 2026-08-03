// @ts-check
/**
 * Test unit del serializer CSV + row builders para exportDatasetZip (v371+).
 *
 * Cubre 5 riesgos de falso verde documentados en el plan
 * (cosmic-pondering-stearns.md):
 *   1. CSV con columnas corridas por comas sin escapar
 *   2. (E3 lo cubre) export parcial silencioso
 *   3. campos vacios en datos reales
 *   4. JSZip corrupto (no aplica a esta capa)
 *   5. PII: verificar que no filtramos passwords/emails de roles (rendiciones si tiene email)
 *
 * Estrategia round-trip: serializar con nuestro csvRow, parsear con papaparse
 * (independiente, dep externa), verificar que los valores originales se
 * recuperan exactos (con las conversiones documentadas: null -> '', Date -> ISO).
 */

import Papa from 'papaparse';
import { describe, expect, it } from 'vitest';
import {
  buildCampaniaRows,
  buildClienteRows,
  buildCsv,
  buildCustomRouteRows,
  buildPedidoRows,
  buildProductoRowsFromStockJson,
  buildRendicionRows,
  buildTargetRows,
  buildVisitaRows,
  computeNullRates,
  csvEscape,
  csvRow,
  DATASET_SCHEMAS,
  DATASET_USE_CASE_MATRIX,
  firestoreValueToCsv,
  getPath,
} from '../../src/pure/csv-serializer.js';

// ============================================================
// csvEscape — casos borde
// ============================================================
describe('csvEscape', () => {
  it('null y undefined -> vacio', () => {
    expect(csvEscape(null)).toBe('');
    expect(csvEscape(undefined)).toBe('');
  });
  it('string vacio -> vacio (sin quotes)', () => {
    expect(csvEscape('')).toBe('');
  });
  it('string simple sin comas -> sin cambios', () => {
    expect(csvEscape('hola mundo')).toBe('hola mundo');
    expect(csvEscape('Cordoba')).toBe('Cordoba');
  });
  it('string con coma -> wrappea con quotes', () => {
    expect(csvEscape('Multifilamento, Power Pro')).toBe('"Multifilamento, Power Pro"');
  });
  it('string con quote -> escapa quote y wrappea', () => {
    expect(csvEscape('Cliente "El Pescador"')).toBe('"Cliente ""El Pescador"""');
  });
  it('string con salto de linea -> wrappea', () => {
    expect(csvEscape('linea1\nlinea2')).toBe('"linea1\nlinea2"');
    expect(csvEscape('linea1\r\nlinea2')).toBe('"linea1\r\nlinea2"');
  });
  it('acentos y caracteres UTF-8 no requieren quoting extra', () => {
    expect(csvEscape('Alvarez')).toBe('Alvarez');
    expect(csvEscape('Cania')).toBe('Cania');
    expect(csvEscape('Nino')).toBe('Nino');
  });
  it('numero como string -> tal cual', () => {
    expect(csvEscape('123.45')).toBe('123.45');
  });
});

// ============================================================
// firestoreValueToCsv — casos borde (Timestamps, arrays, objetos)
// ============================================================
describe('firestoreValueToCsv', () => {
  it('null y undefined -> vacio', () => {
    expect(firestoreValueToCsv(null)).toBe('');
    expect(firestoreValueToCsv(undefined)).toBe('');
  });
  it('boolean -> string true/false', () => {
    expect(firestoreValueToCsv(true)).toBe('true');
    expect(firestoreValueToCsv(false)).toBe('false');
  });
  it('numero entero -> string', () => {
    expect(firestoreValueToCsv(0)).toBe('0');
    expect(firestoreValueToCsv(42)).toBe('42');
    expect(firestoreValueToCsv(-15)).toBe('-15');
  });
  it('numero decimal -> string con punto', () => {
    expect(firestoreValueToCsv(0.15)).toBe('0.15');
    expect(firestoreValueToCsv(12271820)).toBe('12271820');
    expect(firestoreValueToCsv(3.14159)).toBe('3.14159');
  });
  it('NaN e Infinity -> vacio (no romper pipelines downstream)', () => {
    expect(firestoreValueToCsv(NaN)).toBe('');
    expect(firestoreValueToCsv(Infinity)).toBe('');
    expect(firestoreValueToCsv(-Infinity)).toBe('');
  });
  it('Date nativo -> ISO 8601 UTC', () => {
    const d = new Date(Date.UTC(2026, 6, 31, 14, 30, 0));
    expect(firestoreValueToCsv(d)).toBe('2026-07-31T14:30:00.000Z');
  });
  it('Date invalido -> vacio', () => {
    expect(firestoreValueToCsv(new Date('invalid'))).toBe('');
  });
  it('Firestore Timestamp mock (con toDate) -> ISO 8601 UTC', () => {
    const ts = { toDate: () => new Date(Date.UTC(2026, 7, 1, 0, 0, 0)), seconds: 1785000000 };
    expect(firestoreValueToCsv(ts)).toBe('2026-08-01T00:00:00.000Z');
  });
  it('Timestamp.toDate() que tira -> vacio (no romper)', () => {
    const ts = {
      toDate: () => {
        throw new Error('bad');
      },
    };
    expect(firestoreValueToCsv(ts)).toBe('');
  });
  it('Array -> JSON stringified', () => {
    expect(firestoreValueToCsv(['SN2000FG', 'SN2000FE'])).toBe('["SN2000FG","SN2000FE"]');
    expect(firestoreValueToCsv([])).toBe('[]');
    expect(firestoreValueToCsv([1, 2, 3])).toBe('[1,2,3]');
  });
  it('Object -> JSON stringified', () => {
    expect(firestoreValueToCsv({ a: 1, b: 'x' })).toBe('{"a":1,"b":"x"}');
    expect(firestoreValueToCsv({})).toBe('{}');
  });
  it('String tal cual', () => {
    expect(firestoreValueToCsv('POWER PRO')).toBe('POWER PRO');
  });
});

// ============================================================
// getPath — navegacion segura por objeto anidado
// ============================================================
describe('getPath', () => {
  it('path simple', () => {
    expect(getPath({ a: 1 }, 'a')).toBe(1);
  });
  it('path anidado', () => {
    expect(getPath({ a: { b: { c: 42 } } }, 'a.b.c')).toBe(42);
  });
  it('null en el medio -> undefined', () => {
    expect(getPath({ a: null }, 'a.b')).toBe(undefined);
  });
  it('objeto vacio -> undefined', () => {
    expect(getPath({}, 'a.b')).toBe(undefined);
  });
  it('null root -> undefined', () => {
    expect(getPath(/** @type {any} */ (null), 'a')).toBe(undefined);
  });
});

// ============================================================
// csvRow + buildCsv + round-trip papaparse (crítico)
// ============================================================
describe('csvRow + round-trip con papaparse', () => {
  it('array simple -> string CSV', () => {
    expect(csvRow(['a', 'b', 'c'])).toBe('a,b,c');
  });
  it('array con null y numero -> escapea correcto', () => {
    expect(csvRow(['SKU-123', null, 15, true])).toBe('SKU-123,,15,true');
  });
  it('array con coma en string -> wrappea', () => {
    const line = csvRow(['SN2000FG', 'Multifilamento, Power Pro, 4 hebras', 180]);
    expect(line).toBe('SN2000FG,"Multifilamento, Power Pro, 4 hebras",180');
    // Round-trip: papaparse debe leer 3 campos
    const parsed = Papa.parse(line, { header: false });
    expect(parsed.data[0]).toEqual(['SN2000FG', 'Multifilamento, Power Pro, 4 hebras', '180']);
  });
  it('CRITICO: coma sin escapar rompe columnas — verificamos que NUESTRO output escapea', () => {
    const badRow = 'SN2000FG,Multifilamento, Power Pro,180'; // simulacion buggy
    const parsedBad = Papa.parse(badRow, { header: false });
    // Sin escaping, papaparse ve 4 columnas (por la coma extra) — bug clasico
    expect(parsedBad.data[0]).toHaveLength(4);
    // Con NUESTRO csvRow, escapamos y son 3
    const goodRow = csvRow(['SN2000FG', 'Multifilamento, Power Pro', 180]);
    const parsedGood = Papa.parse(goodRow, { header: false });
    expect(parsedGood.data[0]).toHaveLength(3);
  });
  it('array con quotes internos -> round-trip preserva quotes', () => {
    const line = csvRow(['nota', 'Cliente dijo "no me interesa"', 'seguimiento']);
    const parsed = Papa.parse(line, { header: false });
    expect(parsed.data[0][1]).toBe('Cliente dijo "no me interesa"');
  });
  it('array con salto de linea -> round-trip preserva', () => {
    const line = csvRow(['nota', 'linea1\nlinea2', 'x']);
    const parsed = Papa.parse(line, { header: false });
    expect(parsed.data[0][1]).toBe('linea1\nlinea2');
  });
  it('buildCsv genera header + rows con \\r\\n', () => {
    const schema = {
      columns: [
        { col: 'a', type: 's', desc: '' },
        { col: 'b', type: 's', desc: '' },
      ],
    };
    const csv = buildCsv(schema, [
      ['1', '2'],
      ['3', '4'],
    ]);
    expect(csv).toBe('a,b\r\n1,2\r\n3,4\r\n');
    // Round-trip
    const parsed = Papa.parse(csv.trim(), { header: true });
    expect(parsed.data).toEqual([
      { a: '1', b: '2' },
      { a: '3', b: '4' },
    ]);
  });
  it('buildCsv con array vacio -> solo header', () => {
    const schema = {
      columns: [
        { col: 'a', type: 's', desc: '' },
        { col: 'b', type: 's', desc: '' },
      ],
    };
    expect(buildCsv(schema, [])).toBe('a,b\r\n');
  });
});

// ============================================================
// computeNullRates — precisión de la matriz useCaseMatrix
// ============================================================
describe('computeNullRates', () => {
  const schema = {
    columns: [
      { col: 'fecha', type: 'iso8601', desc: '' },
      { col: 'owner_uid', type: 'string', desc: '' },
      { col: 'tienda', type: 'string', desc: '' },
    ],
  };
  it('sin rows -> null rate 1.0 para todos los required', () => {
    const rates = computeNullRates(schema, [], ['fecha', 'owner_uid']);
    expect(rates).toEqual({ fecha: 1, owner_uid: 1 });
  });
  it('todos los rows con valor -> null rate 0', () => {
    const rows = [
      ['2026-08-01', 'uid1', 'Tienda A'],
      ['2026-08-02', 'uid2', 'Tienda B'],
    ];
    const rates = computeNullRates(schema, rows, ['fecha', 'owner_uid']);
    expect(rates).toEqual({ fecha: 0, owner_uid: 0 });
  });
  it('mixto -> null rate proporcional', () => {
    const rows = [
      ['2026-08-01', 'uid1', 'A'],
      [null, 'uid2', 'B'],
      ['2026-08-03', null, 'C'],
      [undefined, undefined, 'D'],
    ];
    const rates = computeNullRates(schema, rows, ['fecha', 'owner_uid']);
    expect(rates.fecha).toBe(0.5); // 2/4
    expect(rates.owner_uid).toBe(0.5); // 2/4
  });
  it('columna requerida que no existe en schema -> null rate 1', () => {
    const rates = computeNullRates(schema, [['x', 'y', 'z']], ['inexistente']);
    expect(rates.inexistente).toBe(1);
  });
});

// ============================================================
// DATASET_SCHEMAS — sanidad estructural
// ============================================================
describe('DATASET_SCHEMAS', () => {
  it('tiene las 11 colecciones esperadas', () => {
    const expected = [
      'pedidos',
      'visitas',
      'clientes',
      'client_master',
      'rendiciones',
      'campanias',
      'targets',
      'productos',
      'vendor_overrides',
      'custom_routes',
      'seguimiento_notes',
    ];
    expect(Object.keys(DATASET_SCHEMAS).sort()).toEqual(expected.sort());
  });
  it('cada schema tiene name, source, rowMode, columns', () => {
    for (const [k, s] of Object.entries(DATASET_SCHEMAS)) {
      expect(s.name, `${k}.name`).toMatch(/\.csv$/);
      expect(['firestore', 'stock_json']).toContain(s.source);
      expect(s.rowMode).toBeTruthy();
      expect(Array.isArray(s.columns), `${k}.columns is array`).toBe(true);
      expect(s.columns.length, `${k} has columns`).toBeGreaterThan(0);
    }
  });
  it('cada columna tiene col, type, desc (col es unica en el schema)', () => {
    for (const [k, s] of Object.entries(DATASET_SCHEMAS)) {
      const cols = new Set();
      for (const c of s.columns) {
        expect(c.col, `${k} col`).toBeTruthy();
        expect(c.type, `${k} type`).toBeTruthy();
        expect(cols.has(c.col), `${k}.${c.col} duplicated`).toBe(false);
        cols.add(c.col);
      }
    }
  });
  it('firestore schemas tienen collection', () => {
    for (const [k, s] of Object.entries(DATASET_SCHEMAS)) {
      if (s.source === 'firestore') {
        expect(s.collection, `${k}.collection`).toBeTruthy();
      }
    }
  });
});

// ============================================================
// DATASET_USE_CASE_MATRIX — sanidad estructural
// ============================================================
describe('DATASET_USE_CASE_MATRIX', () => {
  it('tiene los 5 casos A-E', () => {
    const keys = Object.keys(DATASET_USE_CASE_MATRIX);
    expect(keys).toContain('A_conversion_visita_pedido');
    expect(keys).toContain('B_churn_clientes');
    expect(keys).toContain('C_forecast_sku');
    expect(keys).toContain('D_anomalias_rendiciones');
    expect(keys).toContain('E_estacionalidad_zona_categoria');
  });
  it('cada caso referencia CSVs que existen en DATASET_SCHEMAS', () => {
    const csvNames = new Set(Object.values(DATASET_SCHEMAS).map((s) => s.name));
    for (const [k, uc] of Object.entries(DATASET_USE_CASE_MATRIX)) {
      for (const csvName of Object.keys(uc.requiredFields)) {
        expect(csvNames.has(csvName), `${k} references CSV ${csvName}`).toBe(true);
      }
    }
  });
  it('cada campo requerido existe en el schema del CSV correspondiente', () => {
    const csvToSchema = /** @type {Record<string, any>} */ ({});
    for (const s of Object.values(DATASET_SCHEMAS)) csvToSchema[s.name] = s;
    for (const [k, uc] of Object.entries(DATASET_USE_CASE_MATRIX)) {
      for (const [csvName, fields] of Object.entries(uc.requiredFields)) {
        const cols = new Set(csvToSchema[csvName].columns.map((/** @type {any} */ c) => c.col));
        for (const f of fields) {
          expect(cols.has(f), `${k}: ${csvName}.${f} debe existir en schema`).toBe(true);
        }
      }
    }
  });
});

// ============================================================
// Row builders — casos con datos reales simulados
// ============================================================
describe('buildPedidoRows', () => {
  it('pedido con 2 lineas -> 2 filas', () => {
    const doc = {
      _id: 'pedido-abc',
      ownerUid: 'uid-vendedor',
      ownerEmail: 'vendedor@shimano.com.ar',
      createdByUid: 'uid-vdi',
      onBehalfOf: true,
      key: 'C|BUENOS AIRES|Quilmes|JUAN PESCA',
      stage: 'confirmed',
      tipo: 'C',
      province: 'BUENOS AIRES',
      locName: 'Quilmes',
      clientName: 'JUAN PESCA',
      month: 'Julio 2026',
      monthIdx: 6,
      year: 2026,
      confirmedAt: '2026-07-30T14:00:00.000Z',
      condicionPago: 'CTA CTE',
      formaEntrega: {
        tipo: 'TRANSPORTISTA',
        transpNombre: 'Cruz del Sur',
        transpDireccion: 'Av. Corrientes 1234',
        clienteDireccion: 'Av. Belgrano 4567',
      },
      discountPct: 5,
      subtotalArs: 100000,
      netAmountArs: 95000,
      transferidoSAP: {
        via: 'service_layer',
        docNum: 2000001,
        docEntry: 12345,
        at: '2026-07-30T15:00:00Z',
      },
      createdAt: '2026-07-30T13:00:00Z',
      lines: [
        {
          code: 'CAC58MH2UR',
          desc: 'Cania spinning',
          qty: 2,
          precio: 12500,
          cat: 'CANIA',
          fam: 'SPINNING',
          sub: '58MH',
        },
        {
          code: 'CAC66MH2UR',
          desc: 'Cania, potente',
          qty: 2,
          precio: 12500,
          cat: 'CANIA',
          fam: 'SPINNING',
          sub: '66MH',
        },
      ],
    };
    const rows = buildPedidoRows(doc);
    expect(rows).toHaveLength(2);
    // Header replicado en ambas
    expect(rows[0][0]).toBe('pedido-abc');
    expect(rows[1][0]).toBe('pedido-abc');
    // Formas de entrega flattenizadas (schema: 16=tipo, 17=transpNombre, 18=transpDir, 19=cliDir, 20=sucDir)
    expect(rows[0][16]).toBe('TRANSPORTISTA');
    expect(rows[0][17]).toBe('Cruz del Sur');
    // transferidoSAP flatten (schema: 24=via, 25=doc_num, 26=doc_entry, 27=at)
    expect(rows[0][24]).toBe('service_layer');
    expect(rows[0][25]).toBe(2000001);
    // lines
    expect(rows[0][29]).toBe(0); // line_index
    expect(rows[0][30]).toBe('CAC58MH2UR');
    expect(rows[1][29]).toBe(1);
    expect(rows[1][30]).toBe('CAC66MH2UR');
    expect(rows[1][32]).toBe(2); // qty
    // La coma en desc "Cania, potente" NO rompe el CSV
    const csv = csvRow(rows[1]);
    const parsed = Papa.parse(csv, { header: false });
    expect(parsed.data[0]).toHaveLength(DATASET_SCHEMAS.pedidos.columns.length);
  });
  it('pedido sin lineas -> 1 fila con line_* vacios', () => {
    const doc = { _id: 'p1', lines: [] };
    const rows = buildPedidoRows(doc);
    expect(rows).toHaveLength(1);
    expect(rows[0][29]).toBeNull(); // line_index
  });
  it('pedido con formaEntrega undefined no rompe', () => {
    const doc = { _id: 'p2', lines: [{ code: 'X', qty: 1, precio: 10 }] };
    const rows = buildPedidoRows(doc);
    expect(rows[0][16]).toBeNull(); // forma_entrega_tipo
  });
});

describe('buildVisitaRows', () => {
  it('visita presencial - 32 columnas', () => {
    const doc = {
      _id: 'v1',
      ownerUid: 'u1',
      fecha: '2026-08-01',
      vendor: 'MAURICIO GIL',
      provincia: 'BUENOS AIRES',
      tienda: 'Test',
      interactionType: 'visita',
      contactoResultado: null,
    };
    const rows = buildVisitaRows(doc);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveLength(DATASET_SCHEMAS.visitas.columns.length);
    expect(rows[0][0]).toBe('v1');
    expect(rows[0][27]).toBe('visita'); // interaction_type
  });
  it('contacto no presencial - contacto_resultado se preserva', () => {
    const doc = {
      _id: 'v2',
      interactionType: 'contacto',
      formaContacto: 'MENSAJE DE WHATSAPP',
      contactoResultado: 'respondio',
      contactoResultadoBy: 'uid-admin',
    };
    const rows = buildVisitaRows(doc);
    expect(rows[0][27]).toBe('contacto');
    expect(rows[0][28]).toBe('MENSAJE DE WHATSAPP');
    expect(rows[0][29]).toBe('respondio');
  });
});

describe('buildClienteRows', () => {
  it('cliente provisorio (manualSapPending) - flags has_geo/has_address se derivan', () => {
    const doc = {
      _id: 'c1',
      comercio: 'PESCA TOTAL',
      manualSapPending: true,
      lat: null,
      lng: null,
      calle: '',
    };
    const rows = buildClienteRows(doc);
    expect(rows[0][17]).toBe(true); // manual_sap_pending
    expect(rows[0][23]).toBe(false); // has_geo (lat/lng null)
    expect(rows[0][24]).toBe(false); // has_address
  });
  it('cliente aprobado con lat/lng - flags positivos', () => {
    const doc = { _id: 'c2', lat: -34.5, lng: -58.4, calle: 'Av. Test 123' };
    const rows = buildClienteRows(doc);
    expect(rows[0][23]).toBe(true);
    expect(rows[0][24]).toBe(true);
  });
});

describe('buildRendicionRows - NO exporta fotoTicket base64', () => {
  it('rendicion post-v308 con fotoTicketUrl -> URL exportado', () => {
    const doc = {
      _id: 'r1',
      tipo: 'gasto',
      importeArs: 5000,
      fotoTicketUrl: 'https://storage.googleapis.com/...',
    };
    const rows = buildRendicionRows(doc);
    expect(rows[0][9]).toBe('https://storage.googleapis.com/...');
  });
  it('rendicion legacy pre-v308 con fotoTicket base64 -> NO exporta base64', () => {
    const doc = {
      _id: 'r2',
      tipo: 'gasto',
      importeArs: 5000,
      fotoTicket: 'data:image/jpeg;base64,ABCDEF...',
    };
    const rows = buildRendicionRows(doc);
    // fotoTicketUrl no existe -> retorna null (no filtramos el base64)
    expect(rows[0][9]).toBeNull();
  });
});

describe('buildCampaniaRows', () => {
  it('campana POWER PRO real', () => {
    const doc = {
      _id: '6w4JqjWXQ2SBOCyob',
      name: 'POWER PRO',
      familia: 'POWER PRO',
      subfamilia: 'Maxcuatro',
      skus: ['33400300150Y', '33400400150Y'],
      targetType: 'money',
      targetAmount: 100000,
      startDate: '2026-07-31',
      endDate: '2026-09-29',
      scope: 'all',
    };
    const rows = buildCampaniaRows(doc);
    expect(rows).toHaveLength(1);
    expect(rows[0][1]).toBe('POWER PRO');
    expect(rows[0][7]).toBe(2); // skus_count
    // skus_json en el CSV debe ser JSON string
    const csvValue = firestoreValueToCsv(rows[0][6]);
    expect(csvValue).toBe('["33400300150Y","33400400150Y"]');
  });
});

describe('buildTargetRows con targetByFamily v311+', () => {
  it('doc pre-v311 sin targetByFamily -> familias null', () => {
    const doc = {
      _id: 't1',
      sellerId: 'GONZALO DE LA ROSA',
      year: 2026,
      month: 6,
      targetArs: 57000000,
    };
    const rows = buildTargetRows(doc);
    expect(rows[0][4]).toBe(57000000);
    expect(rows[0][5]).toBeNull(); // reel
    expect(rows[0][6]).toBeNull(); // canas
    expect(rows[0][7]).toBeNull(); // lineas
  });
  it('doc post-v311 con targetByFamily', () => {
    const doc = {
      _id: 't2',
      targetArs: 60000000,
      targetByFamily: { REEL: 20000000, CANAS: 15000000, LINEAS: 25000000 },
    };
    const rows = buildTargetRows(doc);
    expect(rows[0][5]).toBe(20000000);
    expect(rows[0][6]).toBe(15000000);
    expect(rows[0][7]).toBe(25000000);
  });
});

describe('buildCustomRouteRows - flatten stops', () => {
  it('ruta con 3 stops -> 3 filas', () => {
    const doc = {
      _id: 'r1',
      name: 'Ruta MDQ',
      plannedDate: '2026-08-05',
      stops: [
        { order: 0, key: 'C|BA|MDQ|Tienda A', clientName: 'Tienda A' },
        { order: 1, key: 'C|BA|MDQ|Tienda B', clientName: 'Tienda B' },
        { order: 2, key: 'C|BA|MDQ|Tienda C', clientName: 'Tienda C' },
      ],
    };
    const rows = buildCustomRouteRows(doc);
    expect(rows).toHaveLength(3);
    expect(rows[0][8]).toBe(0); // stop_order fila 0
    expect(rows[2][8]).toBe(2);
    expect(rows[1][13]).toBe('Tienda B');
  });
  it('ruta sin stops -> 1 fila con stop_* vacios', () => {
    const doc = { _id: 'r2', name: 'Vacia', stops: [] };
    const rows = buildCustomRouteRows(doc);
    expect(rows).toHaveLength(1);
    expect(rows[0][8]).toBeNull(); // stop_order
  });
});

describe('buildProductoRowsFromStockJson v369+', () => {
  it('parsea stock.json y separa whs11 / whs12 / otros', () => {
    const stockJson = {
      stock: { SN2000FG: true, REEL5000: true, SIN_STOCK_SKU: false },
      quantities: JSON.stringify({ SN2000FG: 180, REEL5000: 25, SIN_STOCK_SKU: 0 }),
      warehouseBreakdown: JSON.stringify({
        SN2000FG: { 12: 180 },
        REEL5000: { 11: 20, 12: 5 },
      }),
      updatedAt: '2026-07-31T14:00:00Z',
    };
    const rows = buildProductoRowsFromStockJson(stockJson);
    expect(rows).toHaveLength(3);
    // SN2000FG: 0 disponible, 180 transito
    const sn = rows.find((r) => r[0] === 'SN2000FG');
    expect(sn[3]).toBe(0); // w11
    expect(sn[4]).toBe(180); // w12
    // REEL5000: 20 disponible, 5 transito
    const reel = rows.find((r) => r[0] === 'REEL5000');
    expect(reel[3]).toBe(20);
    expect(reel[4]).toBe(5);
  });
  it('con warehouse "98" cuarentena -> va a otros_warehouses_json', () => {
    const sj = {
      stock: { X: true },
      quantities: JSON.stringify({ X: 100 }),
      warehouseBreakdown: JSON.stringify({ X: { 11: 20, 98: 80 } }),
    };
    const rows = buildProductoRowsFromStockJson(sj);
    expect(rows[0][3]).toBe(20); // w11
    expect(rows[0][4]).toBe(0); // w12
    expect(rows[0][5]).toEqual({ 98: 80 });
  });
  it('stock.json vacio -> 0 rows', () => {
    expect(buildProductoRowsFromStockJson({})).toEqual([]);
  });
});

// ============================================================
// Integracion buildCsv + row builders end-to-end
// ============================================================
describe('E2E: schema + rows -> CSV parseable con papaparse', () => {
  it('pedidos con 2 docs -> CSV valido round-trip', () => {
    const docs = [
      {
        _id: 'p1',
        clientName: 'Cliente, Con Coma',
        lines: [{ code: 'A', qty: 1, precio: 100 }],
      },
      {
        _id: 'p2',
        clientName: 'Cliente "Especial"',
        lines: [
          { code: 'B', qty: 2, precio: 200 },
          { code: 'C', qty: 3, precio: 300, desc: 'nota\ncon salto' },
        ],
      },
    ];
    const allRows = docs.flatMap(buildPedidoRows);
    expect(allRows).toHaveLength(3); // 1 + 2 lineas
    const csv = buildCsv(DATASET_SCHEMAS.pedidos, allRows);
    const parsed = Papa.parse(csv.trim(), { header: true, skipEmptyLines: true });
    expect(parsed.errors).toEqual([]);
    expect(parsed.data).toHaveLength(3);
    expect(parsed.data[0].client_name).toBe('Cliente, Con Coma');
    expect(parsed.data[1].client_name).toBe('Cliente "Especial"');
    expect(parsed.data[2].line_desc).toBe('nota\ncon salto');
  });
});
