import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  buildDeltaFilter,
  buildUpsertSql,
  ENTITIES,
  fetchDeltaDocs,
  flattenSapDoc,
  nextLinkToPath,
  syncInvoicesBqIncrementalCore,
} from '../../functions/core/sync-invoices-bq-incremental-core.js';

// 2026-11-26 15:30 ART = 18:30 UTC
const NOW = Date.parse('2026-11-26T18:30:00Z');

function sapDoc(entry, extra = {}) {
  return {
    DocEntry: entry,
    DocNum: 1000 + entry,
    DocDate: '2026-11-26',
    DocDueDate: '2026-12-26',
    DocumentStatus: 'bost_Open',
    Cancelled: 'tNO',
    CardCode: 'C001',
    CardName: 'CLIENTE PRUEBA',
    DocCurrency: '$',
    DocTotal: 1210,
    UpdateDate: '2026-11-26',
    CreationDate: '2026-11-26',
    FolioPrefixString: '3',
    DocumentLines: [{ ItemCode: 'SKU1', Quantity: 1, Price: 1000, BaseType: 17 }],
    ...extra,
  };
}

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

const TARGET_SCHEMA = [
  'doc_type',
  'doc_entry',
  'doc_num',
  'doc_date',
  'doc_due_date',
  'document_status',
  'cancelled',
  'card_code',
  'card_name',
  'doc_currency',
  'doc_total',
  'doc_total_fc',
  'doc_rate',
  'discount_percent',
  'total_discount',
  'paid_to_date',
  'sales_person_code',
  'comments',
  'jrnl_memo',
  'payment_group_code',
  'series',
  'create_date',
  'update_date',
  'fol_num_from',
  'fol_num_to',
  'folio_pref',
  'lines_count',
  'lines_json',
  '_sync_timestamp',
].map((name) => ({ name, type: 'STRING' }));

function makeBq(schema = TARGET_SCHEMA) {
  return {
    getSchema: vi.fn(async () => schema),
    loadTruncate: vi.fn(async () => {}),
    query: vi.fn(async () => {}),
  };
}

function makeDeps({ responses, bq = makeBq(), dryRun = false }) {
  const fetch = vi.fn(async (url) => {
    for (const [match, resp] of responses)
      if (url.includes(match)) return typeof resp === 'function' ? resp(url) : resp;
    return jsonResponse({ value: [] });
  });
  return {
    fetch,
    bq,
    released: [],
    deps: {
      sapConfig: { url: 'https://sl.test', companyDB: 'DB', userName: 'u', password: 'p', fetch },
      acquireSession: vi.fn(async () => ({ cookie: 'abc' })),
      releaseSession: vi.fn(),
      bq,
      now: () => NOW,
      dryRun,
    },
  };
}

describe('flattenSapDoc — paridad con flatten_doc de Python', () => {
  it('genera exactamente las mismas columnas que scripts/sync_sap_to_bigquery.py', () => {
    const src = readFileSync('scripts/sync_sap_to_bigquery.py', 'utf8');
    const start = src.indexOf('def flatten_doc(');
    const end = src.indexOf('\ndef ', start + 10);
    const body = src.slice(start, end);
    const pyKeys = [...body.matchAll(/^\s+'([a-z_]+)':/gm)].map((m) => m[1]);
    expect(pyKeys.length).toBeGreaterThan(20);
    const jsKeys = Object.keys(flattenSapDoc(sapDoc(1), 'INVOICE', 'ts'));
    expect(jsKeys.sort()).toEqual([...new Set(pyKeys)].sort());
  });

  it('usa el mismo $select que doc_select_invoices de Python', async () => {
    const src = readFileSync('scripts/sync_sap_to_bigquery.py', 'utf8');
    const start = src.indexOf('doc_select_invoices = [');
    const block = src.slice(start, src.indexOf(']', start));
    const pyFields = [...block.matchAll(/'([A-Za-z]+)'/g)].map((m) => m[1]);
    const mod = await import('../../functions/core/sync-invoices-bq-incremental-core.js');
    expect([...mod.DOC_SELECT_INVOICES].sort()).toEqual(pyFields.sort());
  });

  it('campos faltantes quedan null, lines vacías → lines_json null', () => {
    const r = flattenSapDoc({ DocEntry: 5 }, 'CREDIT_NOTE', 'ts');
    expect(r.doc_type).toBe('CREDIT_NOTE');
    expect(r.doc_entry).toBe(5);
    expect(r.paid_to_date).toBeNull();
    expect(r.lines_count).toBe(0);
    expect(r.lines_json).toBeNull();
  });

  it('lines_json es JSON parseable con las líneas', () => {
    const r = flattenSapDoc(sapDoc(1), 'INVOICE', 'ts');
    expect(JSON.parse(r.lines_json)[0].ItemCode).toBe('SKU1');
    expect(r.lines_count).toBe(1);
  });
});

describe('buildDeltaFilter', () => {
  it('desde ayer en hora Argentina + ventana de 12×31 días como Python', () => {
    const f = buildDeltaFilter(NOW);
    expect(f.since).toBe('2026-11-25');
    expect(f.docSince).toBe(new Date(NOW - 372 * 86400000).toISOString().slice(0, 10));
    expect(f.filter).toBe(`UpdateDate ge '2026-11-25' and DocDate ge '${f.docSince}'`);
  });

  it('a las 00:30 ART todavía usa el día ART, no el UTC', () => {
    // 2026-11-27 00:30 ART = 03:30 UTC → ayer ART = 26/11
    expect(buildDeltaFilter(Date.parse('2026-11-27T03:30:00Z')).since).toBe('2026-11-26');
    // 2026-11-26 23:30 ART = 27/11 02:30 UTC → ayer ART = 25/11
    expect(buildDeltaFilter(Date.parse('2026-11-27T02:30:00Z')).since).toBe('2026-11-25');
  });
});

describe('fetchDeltaDocs', () => {
  it('pagina por nextLink y manda maxpagesize', async () => {
    let call = 0;
    const fetch = vi.fn(async () => {
      call++;
      return call === 1
        ? jsonResponse({ value: [sapDoc(1)], '@odata.nextLink': 'Invoices?$skip=500' })
        : jsonResponse({ value: [sapDoc(2)] });
    });
    const r = await fetchDeltaDocs(
      { url: 'https://sl.test', fetch },
      'abc',
      '/b1s/v1/Invoices',
      "UpdateDate ge 'x'"
    );
    expect(r.docs.map((d) => d.DocEntry)).toEqual([1, 2]);
    expect(r.pages).toBe(2);
    expect(fetch.mock.calls[1][0]).toBe('https://sl.test/b1s/v1/Invoices?$skip=500');
    expect(fetch.mock.calls[0][1].headers.Prefer).toBe('odata.maxpagesize=500');
    expect(fetch.mock.calls[0][1].headers.Cookie).toBe('B1SESSION=abc');
  });

  it('HTTP error tira con el status', async () => {
    const fetch = vi.fn(async () => jsonResponse({ error: 'x' }, 500));
    await expect(fetchDeltaDocs({ url: 'u', fetch }, 'c', '/b1s/v1/Invoices', 'f')).rejects.toThrow(
      'HTTP 500'
    );
  });

  it('nextLinkToPath normaliza absolutos, relativos y con barra', () => {
    expect(nextLinkToPath('https://h:50000/b1s/v1/Invoices?$skip=5')).toBe(
      '/b1s/v1/Invoices?$skip=5'
    );
    expect(nextLinkToPath('/b1s/v1/X?a')).toBe('/b1s/v1/X?a');
    expect(nextLinkToPath('X?a')).toBe('/b1s/v1/X?a');
  });
});

describe('buildUpsertSql', () => {
  it('DELETE + INSERT dentro de una transacción, sin MERGE', () => {
    const sql = buildUpsertSql('p.d.t', 'p.d.s', ['doc_entry', 'doc_num']);
    expect(sql).toContain('BEGIN TRANSACTION;');
    expect(sql).toContain(
      'DELETE FROM `p.d.t` WHERE doc_entry IN (SELECT doc_entry FROM `p.d.s`);'
    );
    expect(sql).toContain(
      'INSERT INTO `p.d.t` (`doc_entry`, `doc_num`) SELECT `doc_entry`, `doc_num` FROM `p.d.s`;'
    );
    expect(sql).toContain('COMMIT TRANSACTION;');
    expect(sql).not.toMatch(/MERGE/);
  });
});

describe('syncInvoicesBqIncrementalCore', () => {
  it('trae facturas y NC, carga staging y hace upsert en cada tabla', async () => {
    const { deps, bq } = makeDeps({
      responses: [
        [
          '/Invoices',
          jsonResponse({ value: [sapDoc(1), sapDoc(2), sapDoc(1, { DocTotal: 999 })] }),
        ],
        ['/CreditNotes', jsonResponse({ value: [sapDoc(7)] })],
      ],
    });
    const r = await syncInvoicesBqIncrementalCore(deps);
    expect(r.ok).toBe(true);
    expect(r.perEntity.INVOICES).toMatchObject({ fetched: 3, rows: 2, merged: 2 });
    expect(r.perEntity.CREDIT_NOTES).toMatchObject({ fetched: 1, rows: 1, merged: 1 });
    // Dedupe: gana la última versión del doc 1.
    const invRows = bq.loadTruncate.mock.calls[0][2];
    expect(invRows.find((x) => x.doc_entry === 1).doc_total).toBe(999);
    expect(bq.loadTruncate.mock.calls.map((c) => c[0])).toEqual([
      'sap_invoices_delta_stage',
      'sap_credit_notes_delta_stage',
    ]);
    expect(bq.query.mock.calls[0][0]).toContain(
      '`app-vendedores-shimano.shimano_app.sap_invoices_raw`'
    );
    expect(bq.query.mock.calls[1][0]).toContain(
      '`app-vendedores-shimano.shimano_app.sap_credit_notes_raw`'
    );
    expect(deps.releaseSession).toHaveBeenCalledWith({ cookie: 'abc' }, true);
  });

  it('el filtro del delta viaja en la URL a SL', async () => {
    const { deps, fetch } = makeDeps({ responses: [] });
    await syncInvoicesBqIncrementalCore(deps);
    const url = decodeURIComponent(fetch.mock.calls[0][0]);
    expect(url).toContain("UpdateDate ge '2026-11-25'");
    expect(url).toContain('$select=DocEntry,');
  });

  it('sin documentos nuevos no toca BigQuery', async () => {
    const { deps, bq } = makeDeps({ responses: [] });
    const r = await syncInvoicesBqIncrementalCore(deps);
    expect(r.ok).toBe(true);
    expect(bq.getSchema).not.toHaveBeenCalled();
    expect(bq.loadTruncate).not.toHaveBeenCalled();
    expect(bq.query).not.toHaveBeenCalled();
  });

  it('dry-run no escribe', async () => {
    const { deps, bq } = makeDeps({
      responses: [['/Invoices', jsonResponse({ value: [sapDoc(1)] })]],
      dryRun: true,
    });
    const r = await syncInvoicesBqIncrementalCore(deps);
    expect(r.dryRun).toBe(true);
    expect(bq.loadTruncate).not.toHaveBeenCalled();
    expect(bq.query).not.toHaveBeenCalled();
  });

  it('solo escribe columnas que existen en el destino, en su orden', async () => {
    const schema = [
      { name: 'doc_entry', type: 'INTEGER' },
      { name: 'doc_total', type: 'FLOAT' },
    ];
    const { deps, bq } = makeDeps({
      responses: [['/Invoices', jsonResponse({ value: [sapDoc(1)] })]],
      bq: makeBq(schema),
    });
    await syncInvoicesBqIncrementalCore(deps);
    expect(bq.loadTruncate.mock.calls[0][1]).toBe(schema);
    expect(bq.loadTruncate.mock.calls[0][2]).toEqual([{ doc_entry: 1, doc_total: 1210 }]);
    expect(bq.query.mock.calls[0][0]).toContain('(`doc_entry`, `doc_total`)');
  });

  it('si falla facturas igual procesa NC y reporta el error', async () => {
    const { deps, bq } = makeDeps({
      responses: [
        ['/Invoices', jsonResponse({ error: 'x' }, 500)],
        ['/CreditNotes', jsonResponse({ value: [sapDoc(7)] })],
      ],
    });
    const r = await syncInvoicesBqIncrementalCore(deps);
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/^INVOICES: .*HTTP 500/);
    expect(r.perEntity.CREDIT_NOTES.merged).toBe(1);
    expect(bq.query).toHaveBeenCalledTimes(1);
    expect(deps.releaseSession).toHaveBeenCalledWith({ cookie: 'abc' }, true);
  });

  it('un 401 de SL descarta la sesión del pool', async () => {
    const { deps } = makeDeps({ responses: [['/Invoices', jsonResponse({ error: 'x' }, 401)]] });
    await syncInvoicesBqIncrementalCore(deps);
    expect(deps.releaseSession).toHaveBeenCalledWith({ cookie: 'abc' }, false);
  });

  it('si BigQuery falla en la transacción, la entidad queda con error y merged 0', async () => {
    const bq = makeBq();
    bq.query.mockRejectedValueOnce(new Error('Transaction is aborted due to concurrent update'));
    const { deps } = makeDeps({
      responses: [['/Invoices', jsonResponse({ value: [sapDoc(1)] })]],
      bq,
    });
    const r = await syncInvoicesBqIncrementalCore(deps);
    expect(r.ok).toBe(false);
    expect(r.perEntity.INVOICES.merged).toBe(0);
    expect(r.errors[0]).toMatch(/concurrent update/);
  });

  it('cubre exactamente facturas y notas de crédito', () => {
    expect(ENTITIES.map((e) => e.table)).toEqual(['sap_invoices_raw', 'sap_credit_notes_raw']);
  });
});

describe('wiring en functions/index.js', () => {
  const src = readFileSync('functions/index.js', 'utf8');
  it('exporta la CF programada cada 5 minutos con el secreto SAP', () => {
    const i = src.indexOf('export const syncInvoicesBqIncrementalCF = onSchedule(');
    expect(i).toBeGreaterThan(0);
    const block = src.slice(i, i + 600);
    expect(block).toContain("schedule: 'every 5 minutes'");
    expect(block).toContain('secrets: [SAP_SL_PASSWORD]');
  });
  it('tiene interruptor y escribe el estado de la corrida', () => {
    expect(src).toContain('invoices_bq_incremental_disabled === true');
    expect(src).toContain("db.doc('app_config/invoices_bq_sync')");
  });
});
