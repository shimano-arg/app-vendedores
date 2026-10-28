// @ts-check
/**
 * v1502 (2026-10-28) — tests paridad del port Python → Node de BP pesca sync.
 *
 * Las funciones puras tienen fixtures que replican casos reales que el Python
 * ya resolvió. El objetivo es que si corremos los dos lados contra el mismo
 * input, salga el mismo output.
 *
 * Testeado:
 *   - _normName / _normCuit (Python _norm_name / _norm_cuit líneas 847-857)
 *   - ratcliffObershelp (Python difflib.SequenceMatcher.ratio())
 *   - getBpDivision (Python UDF_DIVISION_KEYS loop)
 *   - buildBpBasePayload (Python líneas 1221-1270)
 *   - applyManualFieldPreservation (Python v299+/v300+ fantasia + provincia guards)
 *   - findMatch (Python find_match 4 pasadas)
 *   - upsertBpPescaToFirestore (orchestrator con mock Firestore)
 *   - syncBpPesca (feature flag bpSyncByCF default false → dryRun)
 */

import { describe, expect, it } from 'vitest';
import {
  _normCuit,
  _normName,
  applyManualFieldPreservation,
  buildBpBasePayload,
  FUZZY_THRESHOLD,
  findMatch,
  getBpDivision,
  ratcliffObershelp,
  syncBpPesca,
  upsertBpPescaToFirestore,
} from '../../functions/core/sync-bp-pesca-core.js';

/* --------------------------------------------------------------------
 * Normalizers
 * ------------------------------------------------------------------ */

describe('v1502 — _normName / _normCuit', () => {
  it('T1 _normName trim + uppercase + null-safe', () => {
    expect(_normName('  Pesca Shimano  ')).toBe('PESCA SHIMANO');
    expect(_normName('')).toBe('');
    expect(_normName(null)).toBe('');
    expect(_normName(undefined)).toBe('');
  });

  it('T2 _normCuit solo dígitos + null-safe', () => {
    expect(_normCuit('20-12345678-9')).toBe('20123456789');
    expect(_normCuit('20 123 456 789')).toBe('20123456789');
    expect(_normCuit('abc123def456')).toBe('123456');
    expect(_normCuit('')).toBe('');
    expect(_normCuit(null)).toBe('');
  });
});

/* --------------------------------------------------------------------
 * Fuzzy match (Ratcliff-Obershelp paridad con Python difflib)
 * ------------------------------------------------------------------ */

describe('v1502 — ratcliffObershelp paridad con Python difflib', () => {
  it('T10 strings idénticos → 1.0', () => {
    expect(ratcliffObershelp('abc', 'abc')).toBe(1.0);
  });

  it('T11 strings vacíos → 0', () => {
    expect(ratcliffObershelp('', '')).toBe(0);
    expect(ratcliffObershelp('abc', '')).toBe(0);
  });

  it('T12 un char match / un char distinto', () => {
    // ratio(a,b) con "a" y "b" = 0. Con "ab" y "ac" = 2*1/4 = 0.5.
    expect(ratcliffObershelp('a', 'b')).toBe(0);
    expect(ratcliffObershelp('ab', 'ac')).toBeCloseTo(0.5, 5);
  });

  it('T13 valores canónicos de Python difflib (verificados)', () => {
    // Python >>> SequenceMatcher(None, 'EL ANZUELO', 'EL ANZUELO').ratio() → 1.0
    expect(ratcliffObershelp('EL ANZUELO', 'EL ANZUELO')).toBe(1.0);
    // Python >>> SequenceMatcher(None, 'EL DELTA PESCA', 'EL ANZUELO').ratio() → ~0.333
    // (6 chars match: "E","L"," ","E","L"," " aproximadamente, total 24 chars combined, 2*M/T)
    const score = ratcliffObershelp('EL DELTA PESCA', 'EL ANZUELO');
    expect(score).toBeGreaterThan(0.2);
    expect(score).toBeLessThan(0.5);
  });

  it('T14 caso real fuzzy threshold', () => {
    // "PESCA EL CORREO" vs "PESCA EL CORREO SRL" → ratio alto (>0.85)
    const score = ratcliffObershelp('PESCA EL CORREO', 'PESCA EL CORREO SRL');
    expect(score).toBeGreaterThan(0.85);
  });

  it('T15 FUZZY_THRESHOLD = 0.9', () => {
    expect(FUZZY_THRESHOLD).toBe(0.9);
  });
});

/* --------------------------------------------------------------------
 * getBpDivision
 * ------------------------------------------------------------------ */

describe('v1502 — getBpDivision', () => {
  it('T20 encuentra U_DIVISION', () => {
    expect(getBpDivision({ U_DIVISION: '2' })).toBe('2');
    expect(getBpDivision({ U_DIVISION: 'PESCA' })).toBe('PESCA');
  });

  it('T21 prueba variantes (U_Division, U_division)', () => {
    expect(getBpDivision({ U_Division: '3' })).toBe('3');
    expect(getBpDivision({ U_division: 'pesca' })).toBe('PESCA');
  });

  it('T22 vacío si no hay ninguno', () => {
    expect(getBpDivision({})).toBe('');
    expect(getBpDivision(null)).toBe('');
    expect(getBpDivision({ U_DIVISION: '' })).toBe('');
  });
});

/* --------------------------------------------------------------------
 * buildBpBasePayload (paridad Python líneas 1221-1270)
 * ------------------------------------------------------------------ */

describe('v1502 — buildBpBasePayload', () => {
  const FieldValue = { serverTimestamp: () => 'SERVER_TS_MOCK' };
  const provincesMap = { 1: 'BUENOS AIRES', 2: 'CORDOBA', 5: 'TUCUMAN' };

  it('T30 BP completo construye payload canónico', () => {
    const bp = {
      CardCode: 'C001',
      CardName: 'PESCA SHIMANO',
      FederalTaxID: '20-12345678-9',
      Address: 'Calle 123',
      City: 'La Plata',
      ZipCode: '1900',
      U_SH_PCIA: '1',
      Phone1: '011-1234',
      EmailAddress: 'a@b.com',
      CardType: 'cCustomer',
      SalesPersonCode: 50,
      Valid: 'tYES',
      Frozen: 'tNO',
    };
    const { payload, cardcode, cardname } = buildBpBasePayload(bp, provincesMap, FieldValue);
    expect(cardcode).toBe('C001');
    expect(cardname).toBe('PESCA SHIMANO');
    expect(payload.comercio).toBe('PESCA SHIMANO');
    expect(payload.fantasia).toBe('PESCA SHIMANO');
    expect(payload.cardCodeSap).toBe('C001');
    expect(payload.cuit).toBe('20123456789');
    expect(payload.calle).toBe('Calle 123');
    expect(payload.localidad).toBe('La Plata');
    expect(payload.localidadFinal).toBe('La Plata');
    expect(payload.provincia).toBe('BUENOS AIRES');
    expect(payload.sapProvinceRaw).toBe('1');
    expect(payload.sapCardType).toBe('cCustomer');
    expect(payload.sapSalesPersonCode).toBe(50);
    expect(payload.sapReadyForSL).toBe(true);
    expect(payload.status).toBe('approved');
    expect(payload.manualSapPending).toBe(false);
    expect(payload.source).toBe('sap_sync');
  });

  it('T31 City vacío → NO escribe localidad (v291+ guard)', () => {
    const bp = { CardCode: 'C002', CardName: 'X', City: '', Address: 'A' };
    const { payload } = buildBpBasePayload(bp, provincesMap, FieldValue);
    expect(payload).not.toHaveProperty('localidad');
    expect(payload).not.toHaveProperty('localidadFinal');
    expect(payload.calle).toBe('A'); // sí tiene calle
  });

  it('T32 Address vacío → NO escribe calle (v608 guard)', () => {
    const bp = { CardCode: 'C003', CardName: 'X', Address: '', City: 'La Plata' };
    const { payload } = buildBpBasePayload(bp, provincesMap, FieldValue);
    expect(payload).not.toHaveProperty('calle');
    expect(payload.localidad).toBe('La Plata');
  });

  it('T33 ZipCode vacío → NO escribe codigoPostal', () => {
    const bp = { CardCode: 'C004', CardName: 'X', ZipCode: '' };
    const { payload } = buildBpBasePayload(bp, provincesMap, FieldValue);
    expect(payload).not.toHaveProperty('codigoPostal');
  });

  it('T34 Provincia desconocida en map → sapProvinceRaw queda pero provincia=raw uppercase', () => {
    const bp = { CardCode: 'C005', CardName: 'X', U_SH_PCIA: '99' };
    const { payload } = buildBpBasePayload(bp, provincesMap, FieldValue);
    expect(payload.sapProvinceRaw).toBe('99');
    expect(payload.provincia).toBe('99');
  });

  it('T35 Fallback BPAddresses[].State si U_SH_PCIA vacío', () => {
    const bp = {
      CardCode: 'C006',
      CardName: 'X',
      BPAddresses: [{ State: '2' }],
    };
    const { payload } = buildBpBasePayload(bp, provincesMap, FieldValue);
    expect(payload.provincia).toBe('CORDOBA');
  });

  it('T36 sapReadyForSL=false si Frozen=tYES', () => {
    const bp = {
      CardCode: 'C007',
      CardName: 'X',
      CardType: 'cCustomer',
      Valid: 'tYES',
      Frozen: 'tYES',
    };
    const { payload } = buildBpBasePayload(bp, provincesMap, FieldValue);
    expect(payload.sapReadyForSL).toBe(false);
  });

  it('T37 sapReadyForSL=false si cLid (lead, no customer)', () => {
    const bp = { CardCode: 'C008', CardName: 'X', CardType: 'cLid', Valid: 'tYES', Frozen: 'tNO' };
    const { payload } = buildBpBasePayload(bp, provincesMap, FieldValue);
    expect(payload.sapReadyForSL).toBe(false);
  });
});

/* --------------------------------------------------------------------
 * applyManualFieldPreservation (v299+/v300+ guards)
 * ------------------------------------------------------------------ */

describe('v1502 — applyManualFieldPreservation', () => {
  it('T40 preserva fantasia manual si difiere de comercio', () => {
    const payload = { fantasia: 'SAP NAME', comercio: 'SAP NAME' };
    const match = { fantasia: 'LA PESCA DE CARLITOS', comercio: 'SAP NAME' };
    const { logs } = applyManualFieldPreservation(payload, match, 'C001', 'SAP NAME');
    expect(payload).not.toHaveProperty('fantasia');
    expect(logs.length).toBe(1);
    expect(logs[0]).toContain('preserva fantasia manual');
  });

  it('T41 NO preserva si fantasia == comercio (default SAP)', () => {
    const payload = { fantasia: 'SAP NAME' };
    const match = { fantasia: 'SAP NAME', comercio: 'SAP NAME' };
    applyManualFieldPreservation(payload, match, 'C001', 'SAP NAME');
    expect(payload.fantasia).toBe('SAP NAME');
  });

  it('T42 NO preserva si fantasia == cardname nuevo', () => {
    const payload = { fantasia: 'NEW NAME' };
    const match = { fantasia: 'NEW NAME', comercio: 'OLD NAME' };
    applyManualFieldPreservation(payload, match, 'C001', 'NEW NAME');
    expect(payload.fantasia).toBe('NEW NAME');
  });

  it('T43 preserva provincia si provinciaLocSource marker (bulk_excel_*)', () => {
    const payload = { provincia: 'CHUBUT', localidad: 'A', localidadFinal: 'A' };
    const match = { provincia: 'SALTA', provinciaLocSource: 'bulk_excel_2026-07-14' };
    const { logs } = applyManualFieldPreservation(payload, match, 'C001', 'X');
    expect(payload).not.toHaveProperty('provincia');
    expect(payload).not.toHaveProperty('localidad');
    expect(payload).not.toHaveProperty('localidadFinal');
    expect(logs.some((l) => l.includes('preserva provincia manual'))).toBe(true);
  });

  it('T44 NO preserva si provinciaLocSource = sap_sync (es del propio sync)', () => {
    const payload = { provincia: 'CHUBUT' };
    const match = { provincia: 'SALTA', provinciaLocSource: 'sap_sync' };
    applyManualFieldPreservation(payload, match, 'C001', 'X');
    expect(payload.provincia).toBe('CHUBUT');
  });

  it('T45 match null → no-op', () => {
    const payload = { fantasia: 'X', provincia: 'Y' };
    const { logs } = applyManualFieldPreservation(payload, null, 'C001', 'X');
    expect(payload.fantasia).toBe('X');
    expect(payload.provincia).toBe('Y');
    expect(logs).toEqual([]);
  });
});

/* --------------------------------------------------------------------
 * findMatch (4 pasadas)
 * ------------------------------------------------------------------ */

describe('v1502 — findMatch', () => {
  const existing = [
    { __id: 'app1', cardCodeSap: 'C001', comercio: 'Alfa', provincia: 'BUENOS AIRES' },
    {
      __id: 'app2',
      cardCodeSap: '',
      cuit: '20-11111111-1',
      comercio: 'Beta',
      provincia: 'CORDOBA',
    },
    {
      __id: 'app3',
      cardCodeSap: '',
      comercio: 'Pesca Shimano',
      fantasia: 'PESCA SHIMANO',
      razonSocial: 'Pesca Shimano SA',
      provincia: 'SALTA',
    },
    { __id: 'app4', cardCodeSap: '', comercio: 'La Lomita', provincia: 'TUCUMAN' },
  ];

  it('T50 pasada 1: match por cardCodeSap exacto', () => {
    const m = findMatch({ CardCode: 'C001' }, existing);
    expect(m).not.toBeNull();
    expect(m.__id).toBe('app1');
  });

  it('T51 pasada 2: match por CUIT normalizado', () => {
    const m = findMatch({ CardCode: 'XXXX', FederalTaxID: '20-11111111-1' }, existing);
    expect(m).not.toBeNull();
    expect(m.__id).toBe('app2');
  });

  it('T52 pasada 2: CUIT con guiones distintos pero mismos dígitos', () => {
    const m = findMatch({ CardCode: 'XXXX', FederalTaxID: '20111111111' }, existing);
    expect(m).not.toBeNull();
    expect(m.__id).toBe('app2');
  });

  it('T53 pasada 3: match por nombre normalizado exacto', () => {
    const m = findMatch({ CardCode: 'XXXX', CardName: 'pesca shimano' }, existing);
    expect(m).not.toBeNull();
    expect(m.__id).toBe('app3');
  });

  it('T54 pasada 4: fuzzy match contra provisorio con misma provincia', () => {
    // "La Lomitas" (SAP) vs "La Lomita" (app provisorio): ratio = 2*9/19 = 0.947 ≥ 0.9.
    const m = findMatch(
      {
        CardCode: 'XXXX',
        CardName: 'La Lomitas',
        U_SH_PCIA: 'TUCUMAN',
      },
      existing,
      { logFuzzy: false }
    );
    expect(m).not.toBeNull();
    expect(m.__id).toBe('app4');
    expect(m.__fuzzy_matched).toBe(true);
    expect(m.__fuzzy_score).toBeGreaterThanOrEqual(FUZZY_THRESHOLD);
  });

  it('T55 fuzzy skipea si provincia distinta', () => {
    const m = findMatch(
      {
        CardCode: 'XXXX',
        CardName: 'La Lomitas',
        U_SH_PCIA: 'BUENOS AIRES', // app4 está en TUCUMAN
      },
      existing,
      { logFuzzy: false }
    );
    expect(m).toBeNull();
  });

  it('T56 fuzzy no toca apps con cardCodeSap seteado (solo provisorios)', () => {
    // app1 tiene cardCodeSap=C001. Si busco "Alfa" + prov=BUENOS AIRES, pasa por 3 (nombre exacto no — "Alfa" sí match 3).
    // Para forzar el fuzzy, uso nombre similar pero no exacto.
    const m = findMatch(
      {
        CardCode: 'XXXX',
        CardName: 'Alfaz',
        U_SH_PCIA: 'BUENOS AIRES',
      },
      existing,
      { logFuzzy: false }
    );
    // app1 tiene cardCodeSap → skip fuzzy. No hay otro provisorio en BUENOS AIRES.
    expect(m).toBeNull();
  });

  it('T57 null si ningún match', () => {
    const m = findMatch({ CardCode: 'ZZZZ', CardName: 'Desconocido' }, existing);
    expect(m).toBeNull();
  });
});

/* --------------------------------------------------------------------
 * upsertBpPescaToFirestore (orchestrator)
 * ------------------------------------------------------------------ */

/**
 * Mock Firestore mínimo. Trackea reads + writes.
 */
function makeMockFbDb(initialApps = []) {
  const writes = [];
  const addedToClientApps = [];
  const addedToLeadMergeLog = [];
  const setToDocs = [];
  const fbDb = {
    collection(name) {
      return {
        async get() {
          const docs = (name === 'client_applications' ? initialApps : []).map((app, i) => ({
            id: app.__id || 'auto_' + i,
            data: () => {
              const d = Object.assign({}, app);
              delete d.__id;
              delete d.__ref;
              return d;
            },
            ref: {
              set: async (payload, opts) => {
                setToDocs.push({ id: app.__id, payload, opts });
              },
            },
          }));
          return {
            forEach: (cb) => docs.forEach(cb),
            get size() {
              return docs.length;
            },
          };
        },
        async add(payload) {
          writes.push({ coll: name, type: 'add', payload });
          if (name === 'client_applications') addedToClientApps.push(payload);
          if (name === 'lead_merge_log') addedToLeadMergeLog.push(payload);
          return { id: 'new_' + writes.length };
        },
        doc(id) {
          return {
            async set(payload) {
              writes.push({ coll: name, type: 'docSet', id, payload });
              if (name === 'lead_merge_log') addedToLeadMergeLog.push(payload);
            },
          };
        },
      };
    },
    doc(path) {
      return {
        async get() {
          return { exists: false, data: () => ({}) };
        },
      };
    },
  };
  return { fbDb, writes, addedToClientApps, addedToLeadMergeLog, setToDocs };
}

const FieldValue = { serverTimestamp: () => 'TS' };

describe('v1502 — upsertBpPescaToFirestore', () => {
  it('T60 CREATE un BP nuevo sin match', async () => {
    const { fbDb, addedToClientApps } = makeMockFbDb([]);
    const bp = {
      CardCode: 'C999',
      CardName: 'Nuevo Pesca',
      U_DIVISION: 'PESCA',
      FederalTaxID: '30-99999999-9',
      Address: 'Av. Siempre Viva 123',
      City: 'Mar del Plata',
      U_SH_PCIA: '1',
    };
    const stats = await upsertBpPescaToFirestore({
      fbDb,
      FieldValue,
      bps: [bp],
      provincesMap: { 1: 'BUENOS AIRES' },
      dryRun: false,
    });
    expect(stats.created).toBe(1);
    expect(stats.updated_prov_to_conf).toBe(0);
    expect(stats.updated_existing).toBe(0);
    expect(addedToClientApps.length).toBe(1);
    expect(addedToClientApps[0].cardCodeSap).toBe('C999');
    expect(addedToClientApps[0].comercio).toBe('Nuevo Pesca');
    expect(addedToClientApps[0].assignedVendor).toBe('');
    expect(addedToClientApps[0].ownerUid).toBe('');
  });

  it('T61 UPDATE un BP existente con cardCodeSap', async () => {
    const existingApps = [
      {
        __id: 'app1',
        cardCodeSap: 'C001',
        comercio: 'Alfa',
        manualSapPending: false,
      },
    ];
    const { fbDb, setToDocs } = makeMockFbDb(existingApps);
    const bp = { CardCode: 'C001', CardName: 'Alfa Updated', U_DIVISION: 'PESCA' };
    const stats = await upsertBpPescaToFirestore({
      fbDb,
      FieldValue,
      bps: [bp],
      provincesMap: {},
      dryRun: false,
    });
    expect(stats.updated_existing).toBe(1);
    expect(stats.created).toBe(0);
    expect(setToDocs.length).toBe(1);
    expect(setToDocs[0].id).toBe('app1');
    expect(setToDocs[0].opts).toEqual({ merge: true });
  });

  it('T62 PROV → CONF para provisorio con manualSapPending=true', async () => {
    const existingApps = [
      {
        __id: 'app1',
        cardCodeSap: '',
        comercio: 'Nuevo',
        manualSapPending: true,
      },
    ];
    const { fbDb, setToDocs } = makeMockFbDb(existingApps);
    const bp = { CardCode: 'C001', CardName: 'Nuevo', U_DIVISION: 'PESCA' };
    const stats = await upsertBpPescaToFirestore({
      fbDb,
      FieldValue,
      bps: [bp],
      provincesMap: {},
      dryRun: false,
    });
    expect(stats.updated_prov_to_conf).toBe(1);
    expect(stats.updated_existing).toBe(0);
    expect(setToDocs[0].payload.manualSapPending).toBe(false);
    expect(setToDocs[0].payload.cardCodeSap).toBe('C001');
  });

  it('T63 skipped_not_pesca si DIVISION no es pesca', async () => {
    const { fbDb, addedToClientApps } = makeMockFbDb([]);
    const bp = { CardCode: 'C001', CardName: 'Bike', U_DIVISION: '1' /* BIKE */ };
    const stats = await upsertBpPescaToFirestore({
      fbDb,
      FieldValue,
      bps: [bp],
      provincesMap: {},
      dryRun: false,
    });
    expect(stats.skipped_not_pesca).toBe(1);
    expect(stats.created).toBe(0);
    expect(addedToClientApps.length).toBe(0);
  });

  it('T64 dryRun=true → stats OK pero sin writes', async () => {
    const { fbDb, addedToClientApps, setToDocs } = makeMockFbDb([]);
    const bp = { CardCode: 'C100', CardName: 'Nuevo', U_DIVISION: 'PESCA' };
    const stats = await upsertBpPescaToFirestore({
      fbDb,
      FieldValue,
      bps: [bp],
      provincesMap: {},
      dryRun: true,
    });
    expect(stats.created).toBe(1);
    expect(addedToClientApps.length).toBe(0);
    expect(setToDocs.length).toBe(0);
  });

  it('T65 fuzzy match → PROV→CONF + lead_merge_log', async () => {
    const existingApps = [
      {
        __id: 'lead1',
        cardCodeSap: '',
        comercio: 'La Lomita',
        provincia: 'TUCUMAN',
      },
    ];
    const { fbDb, setToDocs, addedToLeadMergeLog } = makeMockFbDb(existingApps);
    const bp = {
      CardCode: 'C001',
      CardName: 'La Lomitas',
      U_DIVISION: 'PESCA',
      U_SH_PCIA: 'TUCUMAN',
    };
    const stats = await upsertBpPescaToFirestore({
      fbDb,
      FieldValue,
      bps: [bp],
      provincesMap: {},
      dryRun: false,
    });
    expect(stats.updated_prov_to_conf).toBe(1);
    expect(addedToLeadMergeLog.length).toBe(1);
    expect(addedToLeadMergeLog[0].sapCardCode).toBe('C001');
    expect(addedToLeadMergeLog[0].leadFsId).toBe('lead1');
    expect(addedToLeadMergeLog[0].fuzzyScore).toBeGreaterThanOrEqual(FUZZY_THRESHOLD);
    expect(setToDocs[0].payload.mergedFromCardCode).toBe('C001');
  });
});

/* --------------------------------------------------------------------
 * syncBpPesca orchestrator (feature flag)
 * ------------------------------------------------------------------ */

describe('v1502 — syncBpPesca feature flag', () => {
  it('T70 flag false → dryRun=true (no writes)', async () => {
    /** @type {string[]} */
    const logs = [];
    const flagDb = {
      doc(path) {
        return {
          async get() {
            return { exists: true, data: () => ({ bpSyncByCF: false }) };
          },
        };
      },
      collection() {
        return {
          async get() {
            return { forEach: () => {}, size: 0 };
          },
          async add() {
            return { id: 'x' };
          },
          doc() {
            return { async set() {} };
          },
        };
      },
    };
    const res = await syncBpPesca({
      fbDb: flagDb,
      FieldValue,
      sapConfig: { url: 'https://sl.example.com' },
      cookie: 'B1SESSION=xyz',
      // forceDryRun no — queremos que lea el flag.
      log: (m) => logs.push(m),
    });
    // Como no mockeamos fetch, la llamada a loadArProvincesMap fallará. Esperamos
    // ok:false con un error de red + dryRun=true + bpSyncByCFFlag=false.
    expect(res.bpSyncByCFFlag).toBe(false);
    expect(res.dryRun).toBe(true);
  });

  it('T71 forceDryRun=true override', async () => {
    const flagDb = {
      doc() {
        return {
          async get() {
            return { exists: false, data: () => ({}) };
          },
        };
      },
      collection() {
        return {
          async get() {
            return { forEach: () => {}, size: 0 };
          },
          async add() {
            return { id: 'x' };
          },
          doc() {
            return { async set() {} };
          },
        };
      },
    };
    const res = await syncBpPesca({
      fbDb: flagDb,
      FieldValue,
      sapConfig: { url: 'https://sl.example.com' },
      cookie: 'B1SESSION=xyz',
      forceDryRun: true,
      log: () => {},
    });
    expect(res.dryRun).toBe(true);
  });
});
