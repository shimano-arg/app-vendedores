// @ts-check
/**
 * Sync incremental de facturas y notas de crédito SAP → BigQuery.
 *
 * Por qué existe: el workflow GHA `sync-sap-to-bigquery.yml` recarga TODO
 * (12 meses de 15+ entidades) y tarda ~60 min por corrida. Con el cron de
 * GitHub que saltea corridas, en la práctica la facturación llegaba a
 * BigQuery cada 6-10 h (medido 20-26/11/2026). Esta CF corre con Cloud
 * Scheduler (confiable, mismo patrón que syncSapCatalogStockCF §60/§65) y
 * trae solo los documentos que SAP tocó desde ayer.
 *
 * Qué hace por corrida:
 *   1. Lee de SL /Invoices y /CreditNotes con
 *      `UpdateDate ge <ayer ART> and DocDate ge <ventana del full sync>`.
 *   2. Aplana cada doc con `flattenSapDoc` (espejo de `flatten_doc` de
 *      scripts/sync_sap_to_bigquery.py — mismas columnas).
 *   3. Carga las filas a una tabla staging (WRITE_TRUNCATE, schema = el de
 *      la tabla destino) y en una transacción BigQuery borra esos doc_entry
 *      del destino e inserta las filas nuevas.
 *
 * Por qué DELETE+INSERT y no MERGE: un MERGE con UPDATE SET de todas las
 * columnas factura la lectura de la tabla entera (~420 MB por corrida, sobre
 * todo lines_json). El DELETE solo lee doc_entry y el INSERT solo la staging.
 *
 * Convivencia con el full sync: el Python sigue haciendo WRITE_TRUNCATE de
 * las mismas tablas. Si pisa una fila que esta CF acababa de traer, la
 * próxima corrida (ventana desde ayer) la vuelve a traer. Se autocorrige.
 * Si el truncate choca con la transacción, la corrida falla y la siguiente
 * reintenta.
 *
 * No borra nunca documentos que no vinieron en el delta. Las anulaciones en
 * SAP B1 actualizan UpdateDate del documento anulado, así que entran solas.
 */

/** Tamaño de página SL (igual que SL_PAGE_SIZE del script Python). */
export const SL_PAGE_SIZE = 500;
/** Ventana del full sync: DEFAULT_HISTORY_MONTHS (12) × 31 días, igual que Python. */
export const HISTORY_DAYS = 12 * 31;
/** Tope de seguridad de documentos por entidad en una corrida incremental. */
export const SAFETY_MAX_DOCS = 5000;

/** Mismo $select que `doc_select_invoices` del script Python. */
export const DOC_SELECT_INVOICES = [
  'DocEntry',
  'DocNum',
  'DocDate',
  'DocDueDate',
  'DocumentStatus',
  'Cancelled',
  'CardCode',
  'CardName',
  'DocCurrency',
  'DocTotal',
  'DocTotalFc',
  'DocRate',
  'PaidToDate',
  'DiscountPercent',
  'TotalDiscount',
  'SalesPersonCode',
  'Comments',
  'JournalMemo',
  'PaymentGroupCode',
  'Series',
  'CreationDate',
  'UpdateDate',
  'FolioNumberFrom',
  'FolioNumberTo',
  'FolioPrefixString',
  'DocumentLines',
];

/** Entidades que cubre esta CF. Las tablas son las mismas que usa Python. */
export const ENTITIES = [
  {
    name: 'INVOICES',
    path: '/b1s/v1/Invoices',
    docType: 'INVOICE',
    table: 'sap_invoices_raw',
    stagingTable: 'sap_invoices_delta_stage',
  },
  {
    name: 'CREDIT_NOTES',
    path: '/b1s/v1/CreditNotes',
    docType: 'CREDIT_NOTE',
    table: 'sap_credit_notes_raw',
    stagingTable: 'sap_credit_notes_delta_stage',
  },
];

/**
 * Espejo de `flatten_doc` (scripts/sync_sap_to_bigquery.py). Mantener las
 * mismas claves: el test de paridad compara contra el source Python.
 * @param {any} doc
 * @param {string} docType
 * @param {string} syncTs ISO
 */
export function flattenSapDoc(doc, docType, syncTs) {
  const lines = (doc && doc.DocumentLines) || [];
  const g = (/** @type {string} */ k) => (doc && doc[k] !== undefined ? doc[k] : null);
  return {
    doc_type: docType,
    doc_entry: g('DocEntry'),
    doc_num: g('DocNum'),
    doc_date: g('DocDate'),
    doc_due_date: g('DocDueDate'),
    document_status: g('DocumentStatus'),
    cancelled: g('Cancelled'),
    card_code: g('CardCode'),
    card_name: g('CardName'),
    doc_currency: g('DocCurrency'),
    doc_total: g('DocTotal'),
    doc_total_fc: g('DocTotalFc'),
    doc_rate: g('DocRate'),
    discount_percent: g('DiscountPercent'),
    total_discount: g('TotalDiscount'),
    paid_to_date: g('PaidToDate'),
    sales_person_code: g('SalesPersonCode'),
    comments: g('Comments'),
    jrnl_memo: g('JournalMemo'),
    payment_group_code: g('PaymentGroupCode'),
    series: g('Series'),
    create_date: g('CreationDate'),
    update_date: g('UpdateDate'),
    fol_num_from: g('FolioNumberFrom'),
    fol_num_to: g('FolioNumberTo'),
    folio_pref: g('FolioPrefixString'),
    lines_count: lines.length,
    lines_json: lines.length ? JSON.stringify(lines) : null,
    _sync_timestamp: syncTs,
  };
}

/**
 * Fecha YYYY-MM-DD en hora Argentina (UTC-3, sin horario de verano).
 * @param {number} ms
 */
export function artDateString(ms) {
  return new Date(ms - 3 * 3600 * 1000).toISOString().slice(0, 10);
}

/**
 * Filtro OData del delta: tocados desde ayer (ART) y dentro de la ventana
 * del full sync (para no meter documentos que el full sync no tiene).
 * @param {number} nowMs
 */
export function buildDeltaFilter(nowMs) {
  const since = artDateString(nowMs - 24 * 3600 * 1000);
  // Python: datetime.now(utc) - timedelta(days=12*31), formato %Y-%m-%d (UTC).
  const docSince = new Date(nowMs - HISTORY_DAYS * 24 * 3600 * 1000).toISOString().slice(0, 10);
  return { since, docSince, filter: `UpdateDate ge '${since}' and DocDate ge '${docSince}'` };
}

/**
 * Normaliza un @odata.nextLink a path /b1s/v1/... (mismo criterio que
 * sync-sap-catalog-stock-core).
 * @param {string} nextLink
 */
export function nextLinkToPath(nextLink) {
  if (nextLink.startsWith('http')) {
    const idx = nextLink.indexOf('/b1s/v1/');
    return idx >= 0 ? nextLink.slice(idx) : nextLink;
  }
  if (nextLink.startsWith('/')) return nextLink;
  return `/b1s/v1/${nextLink}`;
}

/**
 * Trae todos los documentos del delta paginando por nextLink.
 * @param {{url: string, fetch?: typeof fetch}} cfg
 * @param {string} cookie valor de B1SESSION
 * @param {string} entityPath
 * @param {string} filter
 */
export async function fetchDeltaDocs(cfg, cookie, entityPath, filter) {
  const fetchFn = cfg.fetch || globalThis.fetch;
  let path =
    `${entityPath}?$filter=${encodeURIComponent(filter)}` +
    `&$select=${DOC_SELECT_INVOICES.join(',')}`;
  /** @type {any[]} */
  const docs = [];
  let pages = 0;
  while (path) {
    const r = await fetchFn(`${cfg.url}${path}`, {
      headers: { Cookie: `B1SESSION=${cookie}`, Prefer: `odata.maxpagesize=${SL_PAGE_SIZE}` },
    });
    if (!r.ok) {
      const text = await r.text().catch(() => '');
      throw new Error(`${entityPath} pagina ${pages} HTTP ${r.status}: ${text.slice(0, 200)}`);
    }
    const data = await r.json();
    docs.push(...((data && data.value) || []));
    pages++;
    const nextLink = data['@odata.nextLink'] || data['odata.nextLink'] || null;
    if (!nextLink) break;
    if (docs.length > SAFETY_MAX_DOCS) {
      throw new Error(
        `${entityPath}: mas de ${SAFETY_MAX_DOCS} docs en el delta, corto (revisar filtro)`
      );
    }
    path = nextLinkToPath(nextLink);
  }
  return { docs, pages };
}

/**
 * Deja una fila por doc_entry (la última gana) y descarta filas sin doc_entry.
 * @param {Array<Record<string, any>>} rows
 */
export function dedupeByDocEntry(rows) {
  const map = new Map();
  for (const r of rows) {
    if (r && r.doc_entry !== null && r.doc_entry !== undefined) map.set(r.doc_entry, r);
  }
  return [...map.values()];
}

/**
 * Arma el script SQL transaccional DELETE + INSERT.
 * @param {string} target `proyecto.dataset.tabla`
 * @param {string} staging `proyecto.dataset.tabla_stage`
 * @param {string[]} columns columnas del schema destino
 */
export function buildUpsertSql(target, staging, columns) {
  const cols = columns.map((c) => `\`${c}\``).join(', ');
  return [
    'BEGIN TRANSACTION;',
    `DELETE FROM \`${target}\` WHERE doc_entry IN (SELECT doc_entry FROM \`${staging}\`);`,
    `INSERT INTO \`${target}\` (${cols}) SELECT ${cols} FROM \`${staging}\`;`,
    'COMMIT TRANSACTION;',
  ].join('\n');
}

/**
 * @typedef {Object} BqAdapter
 * @property {(table: string) => Promise<Array<{name: string, type: string, mode?: string}>>} getSchema
 * @property {(table: string, schema: any[], rows: any[]) => Promise<void>} loadTruncate
 * @property {(sql: string) => Promise<void>} query
 *
 * @typedef {Object} SyncInvoicesDeps
 * @property {{url: string, companyDB: string, userName: string, password: string, fetch?: typeof fetch}} sapConfig
 * @property {(cfg: any) => Promise<{cookie: string}>} acquireSession
 * @property {(session: any, ok?: boolean) => void} releaseSession
 * @property {BqAdapter} bq
 * @property {string} [bqProject]
 * @property {string} [bqDataset]
 * @property {() => number} [now]
 * @property {(msg: string, extra?: Record<string, unknown>) => void} [log]
 * @property {boolean} [dryRun]
 */

/**
 * @param {SyncInvoicesDeps} deps
 */
export async function syncInvoicesBqIncrementalCore(deps) {
  const log = deps.log || (() => {});
  const nowMs = deps.now ? deps.now() : Date.now();
  const project = deps.bqProject || 'app-vendedores-shimano';
  const dataset = deps.bqDataset || 'shimano_app';
  const syncTs = new Date(nowMs).toISOString();
  const { since, docSince, filter } = buildDeltaFilter(nowMs);
  const startedAt = Date.now();
  /** @type {Record<string, any>} */
  const perEntity = {};
  /** @type {string[]} */
  const errors = [];

  const session = await deps.acquireSession(deps.sapConfig);
  let sessionOk = true;
  try {
    for (const ent of ENTITIES) {
      try {
        const { docs, pages } = await fetchDeltaDocs(
          deps.sapConfig,
          session.cookie,
          ent.path,
          filter
        );
        const rows = dedupeByDocEntry(docs.map((d) => flattenSapDoc(d, ent.docType, syncTs)));
        perEntity[ent.name] = { fetched: docs.length, rows: rows.length, pages, merged: 0 };
        if (rows.length === 0) continue;
        if (deps.dryRun) {
          log(`[${ent.name}] dry-run: ${rows.length} filas NO escritas`);
          continue;
        }
        const target = `${project}.${dataset}.${ent.table}`;
        const staging = `${project}.${dataset}.${ent.stagingTable}`;
        const schema = await deps.bq.getSchema(ent.table);
        const columns = schema.map((f) => f.name);
        const known = new Set(columns);
        const unknown = Object.keys(rows[0]).filter((k) => !known.has(k));
        if (unknown.length) {
          // Columna nueva que el destino todavía no tiene (la agrega el full
          // sync con autodetect). No la escribimos; avisamos.
          log(`[${ent.name}] columnas sin destino, se omiten: ${unknown.join(', ')}`);
        }
        const cleanRows = rows.map((r) => {
          /** @type {Record<string, any>} */
          const o = {};
          for (const c of columns) o[c] = r[c] === undefined ? null : r[c];
          return o;
        });
        await deps.bq.loadTruncate(ent.stagingTable, schema, cleanRows);
        await deps.bq.query(buildUpsertSql(target, staging, columns));
        perEntity[ent.name].merged = cleanRows.length;
        log(`[${ent.name}] ${cleanRows.length} filas actualizadas en ${ent.table}`);
      } catch (e) {
        const msg = `${ent.name}: ${(e && /** @type {any} */ (e).message) || e}`;
        errors.push(msg);
        log(`[${ent.name}] error`, { error: msg });
        if (/HTTP 401/.test(msg)) sessionOk = false;
      }
    }
  } finally {
    deps.releaseSession(session, sessionOk);
  }

  return {
    ok: errors.length === 0,
    since,
    docSince,
    perEntity,
    errors,
    durationMs: Date.now() - startedAt,
    dryRun: !!deps.dryRun,
  };
}
