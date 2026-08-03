// @ts-check
/**
 * Test de integracion del pipeline completo exportDatasetZip:
 * seed in-memory -> row builders -> buildCsv -> manifest con nullRates ->
 * parse con papaparse -> validar joins + casos A-E.
 *
 * Elegido test in-memory (no emulator Firestore) porque los row builders
 * son puros y el fetch de fbDb ya se cubre con el smoke E4 manual. Este
 * test cubre los riesgos criticos del plan sin overhead de Java+emulator:
 *   - rowCounts consistentes (manifest vs CSVs reales)
 *   - joins entre tablas por ID no dejan huerfanos silenciosos
 *   - casos A-E de useCaseMatrix tienen requiredFields presentes con
 *     nullRates coherentes
 *   - CSVs parseables con papaparse (independiente del serializer)
 *   - escape correcto de casos borde (comas, quotes, saltos, acentos)
 */

import Papa from 'papaparse';
import { describe, expect, it } from 'vitest';
import {
  buildCsv,
  buildProductoRowsFromStockJson,
  computeNullRates,
  DATASET_SCHEMAS,
  DATASET_USE_CASE_MATRIX,
  ROW_BUILDERS,
} from '../../src/pure/csv-serializer.js';

// ============================================================
// Seed data — representativa de escenarios reales de la app
// ============================================================

const UID_GONZALO = 'uid-gonzalo';
const UID_FEDE = 'uid-fede';

function seed() {
  const now = new Date('2026-08-01T10:00:00Z');
  return {
    pedidos: [
      {
        _id: 'p1',
        ownerUid: UID_GONZALO,
        ownerEmail: 'gonza@shimano.com.ar',
        key: 'C|CABA|Palermo|Pesca, Total SA',
        stage: 'confirmed',
        tipo: 'C',
        province: 'CABA',
        locName: 'Palermo',
        clientName: 'Pesca, Total SA',
        month: 'Julio 2026',
        monthIdx: 6,
        year: 2026,
        confirmedAt: '2026-07-15T10:00:00Z',
        condicionPago: 'CTA CTE',
        discountPct: 5,
        subtotalArs: 100000,
        netAmountArs: 95000,
        lines: [
          {
            code: 'SN2000FG',
            desc: 'Reel Sienna 2000',
            qty: 5,
            precio: 12500,
            cat: 'REEL',
            fam: 'SPINNING',
            sub: '2000',
          },
          {
            code: 'SN2500FG',
            desc: 'Reel Sienna 2500',
            qty: 3,
            precio: 15000,
            cat: 'REEL',
            fam: 'SPINNING',
            sub: '2500',
          },
        ],
        createdAt: now,
      },
      {
        _id: 'p2',
        ownerUid: UID_FEDE,
        ownerEmail: 'fede@shimano.com.ar',
        key: 'C|BUENOS AIRES|Quilmes|EL DELTA',
        stage: 'confirmed',
        tipo: 'C',
        province: 'BUENOS AIRES',
        locName: 'Quilmes',
        clientName: 'EL DELTA',
        month: 'Julio 2026',
        monthIdx: 6,
        year: 2026,
        confirmedAt: '2026-07-22T15:00:00Z',
        condicionPago: 'CONTADO',
        discountPct: 0,
        subtotalArs: 50000,
        netAmountArs: 50000,
        lines: [{ code: 'PPMC15150Y', desc: 'PowerPro "Maxcuatro" 15lb', qty: 10, precio: 5000 }],
        transferidoSAP: { via: 'service_layer', docNum: 2000001, docEntry: 12345, at: now },
        createdAt: now,
      },
    ],
    visits: [
      {
        _id: 'v1',
        ownerUid: UID_GONZALO,
        fecha: '2026-07-14',
        vendor: 'GONZALO DE LA ROSA',
        provincia: 'CABA',
        localidad: 'Palermo',
        tienda: 'Pesca, Total SA',
        tipo: 'C',
        fidelidad: 'Alta',
        interactionType: 'visita',
        relevancia: 4,
      },
      {
        _id: 'v2',
        ownerUid: UID_FEDE,
        fecha: '2026-07-20',
        vendor: 'FEDERICO CASTELANELLI',
        provincia: 'BUENOS AIRES',
        localidad: 'Quilmes',
        tienda: 'EL DELTA',
        tipo: 'C',
        fidelidad: 'Media',
        interactionType: 'visita',
      },
      // Contacto (post v365) con resultado
      {
        _id: 'v3',
        ownerUid: UID_GONZALO,
        fecha: '2026-07-25',
        vendor: 'GONZALO DE LA ROSA',
        provincia: 'CORDOBA',
        localidad: 'Villa Carlos Paz',
        tienda: 'Rio Pesca',
        interactionType: 'contacto',
        formaContacto: 'MENSAJE DE WHATSAPP',
        contactoResultado: 'respondio',
      },
      // Contacto sin marcar (undefined) — para probar nullRate
      {
        _id: 'v4',
        ownerUid: UID_FEDE,
        fecha: '2026-07-28',
        vendor: 'FEDERICO CASTELANELLI',
        provincia: 'BUENOS AIRES',
        localidad: 'La Plata',
        tienda: 'La Marea',
        interactionType: 'contacto',
        formaContacto: 'LLAMADA TELEFONICA',
      },
    ],
    client_applications: [
      {
        _id: 'c1',
        comercio: 'Pesca, Total SA',
        fantasia: 'Pesca Total',
        cuit: '30123456789',
        provincia: 'CABA',
        localidad: 'Palermo',
        cardCodeSap: 'C00001',
        assignedVendor: 'GONZALO DE LA ROSA',
        status: 'approved',
        manualSapPending: false,
        lat: -34.58,
        lng: -58.43,
        calle: 'Av. Corrientes 1234',
        createdAt: '2026-01-15T00:00:00Z',
        approvedAt: '2026-01-20T00:00:00Z',
      },
      {
        _id: 'c2',
        comercio: 'EL DELTA',
        assignedVendor: 'FEDERICO CASTELANELLI',
        cardCodeSap: 'C00002',
        status: 'approved',
        provincia: 'BUENOS AIRES',
        localidad: 'Quilmes',
        lat: -34.72,
        lng: -58.25,
        calle: 'Rivadavia 500',
        createdAt: '2026-02-10T00:00:00Z',
      },
      // Provisorio (alta rapida) sin cardCode
      {
        _id: 'c3',
        comercio: 'Provisorio Test',
        assignedVendor: 'GONZALO DE LA ROSA',
        cardCodeSap: null,
        status: 'approved',
        manualSapPending: true,
        provincia: 'CABA',
        localidad: 'Belgrano',
        lat: null,
        lng: null,
        createdAt: '2026-07-30T00:00:00Z',
      },
    ],
    client_master: [
      {
        _id: 'cm1',
        clientName: 'Pesca, Total SA',
        provincia: 'CABA',
        localidad: 'Palermo',
        vendor: 'GONZALO DE LA ROSA',
        address: 'Av. Corrientes 1234',
        sapCardCode: 'C00001',
      },
    ],
    rendiciones: [
      {
        _id: 'r1',
        ownerUid: UID_GONZALO,
        vendor: 'GONZALO DE LA ROSA',
        tipo: 'gasto',
        tipoGasto: 'PEAJES',
        importeArs: 3500,
        fechaGasto: '2026-07-14',
        status: 'approved',
        fotoTicketUrl: 'https://firebasestorage.googleapis.com/v0/b/x/o/y',
        createdAt: '2026-07-14T20:00:00Z',
      },
      {
        _id: 'r2',
        ownerUid: UID_FEDE,
        vendor: 'FEDERICO CASTELANELLI',
        tipo: 'gasto',
        tipoGasto: 'FACTURA A',
        importeArs: 12000,
        fechaGasto: '2026-07-22',
        status: 'pending_approval',
      },
      // Rendicion legacy pre-v308 con fotoTicket base64: NO debe exportarse
      {
        _id: 'r3',
        ownerUid: UID_GONZALO,
        tipo: 'gasto',
        importeArs: 800,
        fechaGasto: '2026-05-01',
        status: 'approved',
        fotoTicket: 'data:image/jpeg;base64,ABC...LARGO_BASE64_QUE_NO_QUEREMOS_EXPORTAR',
      },
    ],
    campaigns: [
      {
        _id: 'camp1',
        name: 'POWER PRO',
        familia: 'POWER PRO',
        subfamilia: 'Maxcuatro',
        skus: ['PPMC15150Y', 'PPMC20150Y', 'PPMC25150Y'],
        filterType: 'sku',
        filterValues: ['PPMC15150Y', 'PPMC20150Y', 'PPMC25150Y'],
        targetType: 'money',
        targetAmount: 100000,
        startDate: '2026-07-31',
        endDate: '2026-09-29',
        scope: 'all',
        createdBy: 'uid-pablo',
        createdByEmail: 'pablo@shimano.uy',
        createdAt: '2026-07-31T18:00:00Z',
      },
    ],
    targets: [
      { _id: 't1', sellerId: 'GONZALO DE LA ROSA', year: 2026, month: 6, targetArs: 57000000 },
      // Target con desglose por familia (v311+)
      {
        _id: 't2',
        sellerId: 'FEDERICO CASTELANELLI',
        year: 2026,
        month: 6,
        targetArs: 68000000,
        targetByFamily: { REEL: 25000000, CANAS: 20000000, LINEAS: 23000000 },
      },
    ],
    vendor_overrides: [
      {
        _id: 'vo1',
        scope: 'shop',
        province: 'CORDOBA',
        localityName: 'Rio Cuarto',
        clientName: 'Test Store',
        originalVendor: 'MARTIN BOIERO',
        newVendor: 'MAURICIO GIL',
        newType: 'VDE',
        updatedByEmail: 'admin@shimano.com',
      },
    ],
    custom_routes: [
      {
        _id: 'cr1',
        ownerUid: UID_GONZALO,
        name: 'Ruta CABA norte',
        plannedDate: '2026-08-05',
        notes: 'Cargar Sienna en Pesca Total',
        stops: [
          { order: 0, key: 'C|CABA|Palermo|Pesca Total', clientName: 'Pesca Total' },
          { order: 1, key: 'C|CABA|Belgrano|Rio Store', clientName: 'Rio Store' },
        ],
      },
    ],
    seguimiento_notes: [
      {
        _id: 'sn1',
        vendorExt: 'GONZALO DE LA ROSA',
        clientKey: 'C|CABA|Palermo|Pesca Total',
        clientName: 'Pesca Total',
        text: 'Pidio catalogo, llamar en 2 semanas',
        authorRole: 'gerente',
        authorEmail: 'pablo@shimano.uy',
        createdAt: '2026-07-25T14:00:00Z',
      },
    ],
  };
}

function seedStockJson() {
  return {
    stock: { SN2000FG: true, SN2500FG: true, PPMC15150Y: true, SIN_STOCK: false },
    quantities: JSON.stringify({ SN2000FG: 180, SN2500FG: 20, PPMC15150Y: 500, SIN_STOCK: 0 }),
    warehouseBreakdown: JSON.stringify({
      SN2000FG: { 12: 180 }, // TODO transito - caso Mariano reportado
      SN2500FG: { 11: 20 }, // TODO disponible venta
      PPMC15150Y: { 11: 300, 12: 200 }, // split
    }),
    updatedAt: '2026-08-01T09:30:00Z',
  };
}

// ============================================================
// Helper: pipeline completo end-to-end (paralelo a exportDatasetZip)
// ============================================================
function runFullPipeline(seedData, stockJson) {
  const csvs = {};
  const rowCounts = {};
  const allRowsByCsv = {};

  // Firestore-source collections
  const collToRowsMap = {
    pedidos: seedData.pedidos,
    visitas: seedData.visits,
    clientes: seedData.client_applications,
    client_master: seedData.client_master,
    rendiciones: seedData.rendiciones,
    campanias: seedData.campaigns,
    targets: seedData.targets,
    vendor_overrides: seedData.vendor_overrides,
    custom_routes: seedData.custom_routes,
    seguimiento_notes: seedData.seguimiento_notes,
  };

  for (const [collName, docs] of Object.entries(collToRowsMap)) {
    const schema = DATASET_SCHEMAS[collName];
    const builder = ROW_BUILDERS[collName];
    const allRows = [];
    for (const doc of docs) {
      const rowsForDoc = builder(doc);
      for (const r of rowsForDoc) allRows.push(r);
    }
    allRowsByCsv[schema.name] = allRows;
    csvs[schema.name] = buildCsv(schema, allRows);
    rowCounts[schema.name] = allRows.length;
  }

  // Productos desde stock.json
  const productosRows = buildProductoRowsFromStockJson(stockJson);
  const productosSchema = DATASET_SCHEMAS.productos;
  allRowsByCsv[productosSchema.name] = productosRows;
  csvs[productosSchema.name] = buildCsv(productosSchema, productosRows);
  rowCounts[productosSchema.name] = productosRows.length;

  return { csvs, rowCounts, allRowsByCsv };
}

// ============================================================
// Tests
// ============================================================

describe('exportDatasetZip pipeline: end-to-end con seed representativa', () => {
  const s = seed();
  const sj = seedStockJson();
  const { csvs, rowCounts, allRowsByCsv } = runFullPipeline(s, sj);

  it('genera los 11 CSVs esperados', () => {
    const expected = [
      'pedidos.csv',
      'visitas.csv',
      'clientes.csv',
      'client_master.csv',
      'rendiciones.csv',
      'campanias.csv',
      'targets.csv',
      'productos.csv',
      'vendor_overrides.csv',
      'custom_routes.csv',
      'seguimiento_notes.csv',
    ];
    expect(Object.keys(csvs).sort()).toEqual(expected.sort());
  });

  it('rowCounts consistentes con las lineas del CSV', () => {
    for (const [csvName, expectedCount] of Object.entries(rowCounts)) {
      const parsed = Papa.parse(csvs[csvName].trim(), { header: true, skipEmptyLines: true });
      expect(parsed.errors, `${csvName} parse errors`).toEqual([]);
      expect(parsed.data.length, `${csvName} row count`).toBe(expectedCount);
    }
  });

  it('pedidos.csv desnormaliza correctamente lineas (2 pedidos con 2+1 lineas = 3 filas)', () => {
    expect(rowCounts['pedidos.csv']).toBe(3);
    const parsed = Papa.parse(csvs['pedidos.csv'].trim(), { header: true });
    // Pedido p1 con 2 lineas
    const p1Rows = parsed.data.filter((r) => r.pedido_id === 'p1');
    expect(p1Rows).toHaveLength(2);
    expect(p1Rows[0].line_code).toBe('SN2000FG');
    expect(p1Rows[1].line_code).toBe('SN2500FG');
    // Cliente con coma en el nombre — el CSV NO rompio columnas
    expect(p1Rows[0].client_name).toBe('Pesca, Total SA');
    // Pedido p2 con 1 linea
    const p2Rows = parsed.data.filter((r) => r.pedido_id === 'p2');
    expect(p2Rows).toHaveLength(1);
    expect(p2Rows[0].line_code).toBe('PPMC15150Y');
  });

  it('visitas.csv incluye visitas + contactos con interactionType correcto', () => {
    const parsed = Papa.parse(csvs['visitas.csv'].trim(), { header: true });
    expect(parsed.data).toHaveLength(4);
    const visitas = parsed.data.filter((r) => r.interaction_type === 'visita');
    const contactos = parsed.data.filter((r) => r.interaction_type === 'contacto');
    expect(visitas).toHaveLength(2);
    expect(contactos).toHaveLength(2);
    // Contacto marcado con "respondio"
    const v3 = parsed.data.find((r) => r.visit_id === 'v3');
    expect(v3.contacto_resultado).toBe('respondio');
    expect(v3.forma_contacto).toBe('MENSAJE DE WHATSAPP');
    // Contacto sin marcar -> vacio, NO 'undefined' ni 'null'
    const v4 = parsed.data.find((r) => r.visit_id === 'v4');
    expect(v4.contacto_resultado).toBe('');
  });

  it('rendiciones.csv NO exporta fotoTicket base64 legacy', () => {
    const parsed = Papa.parse(csvs['rendiciones.csv'].trim(), { header: true });
    const r3 = parsed.data.find((r) => r.rendicion_id === 'r3');
    expect(r3).toBeTruthy();
    // La rendicion tenia fotoTicket base64 pero fotoTicketUrl null -> exportado vacio
    expect(r3.foto_ticket_url).toBe('');
    // No aparece el base64 en ningun otro campo
    const allCsvText = csvs['rendiciones.csv'];
    expect(allCsvText).not.toContain('base64');
    expect(allCsvText).not.toContain('LARGO_BASE64');
  });

  it('campanias.csv preserva skus como JSON string', () => {
    const parsed = Papa.parse(csvs['campanias.csv'].trim(), { header: true });
    const camp = parsed.data.find((r) => r.name === 'POWER PRO');
    expect(camp).toBeTruthy();
    expect(camp.skus_count).toBe('3'); // papaparse devuelve strings
    // skus_json es un JSON string parseable
    expect(() => JSON.parse(camp.skus_json)).not.toThrow();
    expect(JSON.parse(camp.skus_json)).toEqual(['PPMC15150Y', 'PPMC20150Y', 'PPMC25150Y']);
  });

  it('targets.csv preserva targetByFamily (v311+) cuando existe', () => {
    const parsed = Papa.parse(csvs['targets.csv'].trim(), { header: true });
    const t1 = parsed.data.find((r) => r.target_id === 't1');
    expect(t1.target_reel_ars).toBe(''); // pre-v311 sin desglose
    const t2 = parsed.data.find((r) => r.target_id === 't2');
    expect(t2.target_reel_ars).toBe('25000000');
    expect(t2.target_canas_ars).toBe('20000000');
    expect(t2.target_lineas_ars).toBe('23000000');
  });

  it('productos.csv separa whs11 vs whs12 (v369+)', () => {
    const parsed = Papa.parse(csvs['productos.csv'].trim(), { header: true });
    const sn2000 = parsed.data.find((r) => r.sku === 'SN2000FG');
    // Caso Mariano: 0 disponible venta, 180 transito
    expect(sn2000.disponible_venta_whs11).toBe('0');
    expect(sn2000.transito_whs12).toBe('180');
    const ppmc = parsed.data.find((r) => r.sku === 'PPMC15150Y');
    expect(ppmc.disponible_venta_whs11).toBe('300');
    expect(ppmc.transito_whs12).toBe('200');
  });

  it('custom_routes.csv desnormaliza stops (1 ruta con 2 stops = 2 filas)', () => {
    const parsed = Papa.parse(csvs['custom_routes.csv'].trim(), { header: true });
    expect(parsed.data).toHaveLength(2);
    expect(parsed.data[0].stop_order).toBe('0');
    expect(parsed.data[1].stop_order).toBe('1');
  });
});

// ============================================================
// Validacion casos de uso ML A-E — cada caso tiene sus campos + nullRates coherentes
// ============================================================
describe('useCaseMatrix: cada caso A-E tiene sus requiredFields con nullRates coherentes', () => {
  const s = seed();
  const sj = seedStockJson();
  const { allRowsByCsv, rowCounts } = runFullPipeline(s, sj);

  for (const [caseKey, uc] of Object.entries(DATASET_USE_CASE_MATRIX)) {
    describe(`caso ${caseKey}`, () => {
      for (const [csvName, fields] of Object.entries(uc.requiredFields)) {
        it(`${csvName}: campos requeridos ${JSON.stringify(fields)} tienen nullRates definidos`, () => {
          const schema = Object.values(DATASET_SCHEMAS).find((sc) => sc.name === csvName);
          expect(schema, `schema para ${csvName}`).toBeTruthy();
          const rows = allRowsByCsv[csvName] || [];
          const rates = computeNullRates(schema, rows, fields);
          for (const f of fields) {
            expect(rates[f], `${caseKey}/${csvName}.${f}`).toBeGreaterThanOrEqual(0);
            expect(rates[f], `${caseKey}/${csvName}.${f}`).toBeLessThanOrEqual(1);
          }
        });
      }
    });
  }

  it('caso A conversion visita->pedido: fecha + owner_uid + tienda tienen nullRate razonable', () => {
    const rates = computeNullRates(DATASET_SCHEMAS.visitas, allRowsByCsv['visitas.csv'], [
      'fecha',
      'owner_uid',
      'tienda',
    ]);
    // Los 4 seeds tienen fecha + ownerUid + tienda -> nullRate 0
    expect(rates.fecha).toBe(0);
    expect(rates.owner_uid).toBe(0);
    expect(rates.tienda).toBe(0);
  });

  it('caso D anomalias rendiciones: importe_ars nunca null en las que tienen tipo=gasto', () => {
    const parsed = Papa.parse(
      buildCsv(
        DATASET_SCHEMAS.rendiciones,
        allRowsByCsv['rendiciones.csv'].filter((r) => r[4] === 'gasto')
      ).trim(),
      { header: true }
    );
    for (const r of parsed.data) {
      expect(r.importe_ars, `rendicion ${r.rendicion_id} tiene importe`).not.toBe('');
    }
  });
});

// ============================================================
// Joins entre tablas por ID no dejan huerfanos silenciosos
// ============================================================
describe('joins por ID: pedidos.owner_uid existe en clientes.assigned_vendor (indirecto)', () => {
  const s = seed();
  const sj = seedStockJson();
  const { csvs } = runFullPipeline(s, sj);

  it('cada pedido.province + loc_name existe en un cliente por provincia/localidad', () => {
    const pedidos = Papa.parse(csvs['pedidos.csv'].trim(), { header: true }).data;
    const clientes = Papa.parse(csvs['clientes.csv'].trim(), { header: true }).data;
    // Clave compuesta (provincia, localidad) presente en al menos 1 cliente
    const clienteKeys = new Set(clientes.map((c) => `${c.provincia}|${c.localidad}`));
    for (const p of pedidos) {
      const k = `${p.province}|${p.loc_name}`;
      expect(clienteKeys.has(k), `pedido ${p.pedido_id} (${k}) tiene cliente matching`).toBe(true);
    }
  });

  it('cada pedido.owner_uid corresponde a un vendedor real (uid presente en al menos 1 visita)', () => {
    const pedidos = Papa.parse(csvs['pedidos.csv'].trim(), { header: true }).data;
    const visitas = Papa.parse(csvs['visitas.csv'].trim(), { header: true }).data;
    const uidsVisitas = new Set(visitas.map((v) => v.owner_uid));
    for (const p of pedidos) {
      expect(
        uidsVisitas.has(p.owner_uid),
        `pedido ${p.pedido_id} owner ${p.owner_uid} tiene visitas`
      ).toBe(true);
    }
  });
});

// ============================================================
// Escape/quoting funciona con todo el pipeline
// ============================================================
describe('escape end-to-end: doc con coma/quote/salto NO rompe columnas del CSV', () => {
  it('CSV pedidos parsea sin errors aunque haya cliente "Pesca, Total SA"', () => {
    const s = seed();
    const { csvs } = runFullPipeline(s, seedStockJson());
    const parsed = Papa.parse(csvs['pedidos.csv'].trim(), { header: true, skipEmptyLines: true });
    expect(parsed.errors).toEqual([]);
    // La fila con coma en client_name tiene el nombre completo
    const row = parsed.data.find((r) => r.pedido_id === 'p1');
    expect(row.client_name).toBe('Pesca, Total SA');
    // Y la columna line_desc "PowerPro \"Maxcuatro\" 15lb" (con quotes) preserva
    const p2 = parsed.data.find((r) => r.pedido_id === 'p2');
    expect(p2.line_desc).toContain('Maxcuatro');
  });
});
