import { describe, expect, it, vi } from 'vitest';
import {
  handleResolvePedidoCardCode,
  normName,
  resolveCardCode,
} from '../../functions/core/resolve-pedido-cardcode-core.js';

describe('normName', () => {
  it('UPPER + TRIM', () => {
    expect(normName('  REBORN SRL  ')).toBe('REBORN');
    expect(normName('reborn s.r.l.')).toBe('REBORN');
  });
  it('remueve sufijos legales iterativos', () => {
    expect(normName('REBORN SRL')).toBe('REBORN');
    expect(normName('REBORN S.R.L.')).toBe('REBORN');
    expect(normName('REBORN S.A.')).toBe('REBORN');
    expect(normName('REBORN SA')).toBe('REBORN');
    expect(normName('REBORN SAIC')).toBe('REBORN');
  });
  it('remueve puntuacion', () => {
    expect(normName('O.R.T. S.A.')).toBe('ORT');
    expect(normName("D'ANGELO")).toBe('DANGELO');
    expect(normName('"PATAGONIA"')).toBe('PATAGONIA');
  });
  it('colapsa whitespace multiple', () => {
    expect(normName('MUNDO  ESTURION   SRL')).toBe('MUNDO ESTURION');
  });
  it('empty/null → empty', () => {
    expect(normName('')).toBe('');
    expect(normName(/** @type {any} */ (null))).toBe('');
    expect(normName(/** @type {any} */ (undefined))).toBe('');
  });
});

describe('resolveCardCode', () => {
  const makeMap = (entries) => {
    const m = new Map();
    for (const [name, data] of entries) m.set(normName(name), data);
    return m;
  };

  it('resuelve desde fuente 1', () => {
    const maps = [
      makeMap([
        ['REBORN SRL', { cardCode: 'C1234', source: 'sap_clients', nameRaw: 'REBORN SRL' }],
      ]),
    ];
    const hit = resolveCardCode('REBORN SRL', maps);
    expect(hit?.cardCode).toBe('C1234');
    expect(hit?.source).toBe('sap_clients');
  });

  it('resuelve con variacion de sufijo legal', () => {
    const maps = [
      makeMap([['REBORN', { cardCode: 'C1234', source: 'sap_clients', nameRaw: 'REBORN' }]]),
    ];
    expect(resolveCardCode('REBORN SRL', maps)?.cardCode).toBe('C1234');
    expect(resolveCardCode('REBORN S.R.L.', maps)?.cardCode).toBe('C1234');
    expect(resolveCardCode('REBORN SA', maps)?.cardCode).toBe('C1234');
  });

  it('prioridad: fuente 1 gana sobre fuente 2', () => {
    const m1 = makeMap([['FOO', { cardCode: 'FROM_1', source: 'sap_clients', nameRaw: 'FOO' }]]);
    const m2 = makeMap([
      ['FOO', { cardCode: 'FROM_2', source: 'client_applications', nameRaw: 'FOO' }],
    ]);
    expect(resolveCardCode('FOO', [m1, m2])?.cardCode).toBe('FROM_1');
  });

  it('fallback a fuente 2 si fuente 1 no matchea', () => {
    const m1 = makeMap([['BAR', { cardCode: 'BAR_1', source: 'sap_clients', nameRaw: 'BAR' }]]);
    const m2 = makeMap([
      ['FOO', { cardCode: 'FOO_2', source: 'client_applications', nameRaw: 'FOO' }],
    ]);
    expect(resolveCardCode('FOO', [m1, m2])?.cardCode).toBe('FOO_2');
  });

  it('no matchea → null', () => {
    const m = makeMap([['FOO', { cardCode: 'C1', source: 'sap_clients', nameRaw: 'FOO' }]]);
    expect(resolveCardCode('BAR', [m])).toBeNull();
  });

  it('empty name → null', () => {
    const m = makeMap([['FOO', { cardCode: 'C1', source: 'sap_clients', nameRaw: 'FOO' }]]);
    expect(resolveCardCode('', [m])).toBeNull();
  });
});

// Fake Firestore minimo para handleResolvePedidoCardCode.
function makeFakeDb(collections) {
  const commits = [];
  const makeDocRef = (docPath, data) => ({
    _path: docPath,
    _data: data,
  });
  const makeCollection = (name) => ({
    _name: name,
    where(_field, _op, _value) {
      return this; // ignoramos filtro, devuelve todo (los tests setean solo pedidos abiertos)
    },
    async get() {
      const docs = (collections[name] || []).map((entry) => ({
        id: entry.id,
        ref: makeDocRef(`${name}/${entry.id}`, entry.data),
        data: () => entry.data,
      }));
      return {
        forEach(cb) {
          for (const d of docs) cb(d);
        },
      };
    },
    async stream() {
      // Sync iterable para los loads de maps.
      return this.get();
    },
  });
  return {
    _commits: commits,
    collection: makeCollection,
    batch() {
      const ops = [];
      return {
        update(ref, data) {
          ops.push({ path: ref._path, data });
        },
        async commit() {
          commits.push(ops);
        },
      };
    },
    // Firestore.stream devuelve async iterable. Simplified: devolver array sync.
  };
}

describe('handleResolvePedidoCardCode', () => {
  it('resuelve pedido sin cardCode via sap_clients', async () => {
    const db = makeFakeDb({
      sap_clients: [{ id: 'reborn', data: { sapCode: 'C1234', name: 'REBORN SRL' } }],
      client_applications: [],
      pedidos: [
        {
          id: 'p1',
          data: {
            clientName: 'REBORN SRL',
            clientCardCode: '',
            closedAt: null,
            createdAt: new Date('2026-10-01T10:00:00Z').toISOString(),
          },
        },
      ],
    });
    // Mock stream para sap_clients/client_applications → delegate a get.
    const originalGet = db.collection;
    db.collection = (name) => {
      const col = originalGet(name);
      col.stream = col.get;
      return col;
    };
    const r = await handleResolvePedidoCardCode({
      fbDb: db,
      now: () => new Date('2026-10-07T15:00:00Z'),
      log: () => {},
    });
    expect(r.totalScanned).toBe(1);
    expect(r.missingCardCode).toBe(1);
    expect(r.resolvedSapClients).toBe(1);
    expect(r.resolvedClientApplications).toBe(0);
    expect(r.unresolved).toBe(0);
    expect(r.flaggedForUi).toBe(0);
    expect(db._commits.length).toBe(1);
    expect(db._commits[0][0].data.clientCardCode).toBe('C1234');
    expect(db._commits[0][0].data._backfillCardCode.source).toBe('sap_clients');
  });

  it('resuelve con variacion de sufijo legal (REBORN SRL en pedido, REBORN en mapeo)', async () => {
    const db = makeFakeDb({
      sap_clients: [{ id: 'reborn', data: { sapCode: 'C999', name: 'REBORN' } }],
      client_applications: [],
      pedidos: [
        {
          id: 'p1',
          data: {
            clientName: 'REBORN S.R.L.',
            clientCardCode: '',
            closedAt: null,
            createdAt: new Date('2026-10-01').toISOString(),
          },
        },
      ],
    });
    db.collection = ((orig) => (name) => {
      const col = orig(name);
      col.stream = col.get;
      return col;
    })(db.collection);
    const r = await handleResolvePedidoCardCode({
      fbDb: db,
      now: () => new Date('2026-10-07'),
      log: () => {},
    });
    expect(r.resolvedSapClients).toBe(1);
  });

  it('no_resuelto pedido viejo (>24h) → marca needsCardCodeResolution=true', async () => {
    const db = makeFakeDb({
      sap_clients: [],
      client_applications: [],
      pedidos: [
        {
          id: 'p1',
          data: {
            clientName: 'FOLCA EXOTICA',
            clientCardCode: '',
            closedAt: null,
            createdAt: new Date('2026-10-01').toISOString(), // >24h vs now
          },
        },
      ],
    });
    db.collection = ((orig) => (name) => {
      const col = orig(name);
      col.stream = col.get;
      return col;
    })(db.collection);
    const r = await handleResolvePedidoCardCode({
      fbDb: db,
      now: () => new Date('2026-10-07'),
      log: () => {},
    });
    expect(r.unresolved).toBe(1);
    expect(r.flaggedForUi).toBe(1);
    expect(db._commits[0][0].data.needsCardCodeResolution).toBe(true);
  });

  it('no_resuelto pedido reciente (<24h) → NO marca flag UI (dale tiempo a admin)', async () => {
    const now = new Date('2026-10-07T15:00:00Z');
    const db = makeFakeDb({
      sap_clients: [],
      client_applications: [],
      pedidos: [
        {
          id: 'p1',
          data: {
            clientName: 'FOLCA EXOTICA',
            clientCardCode: '',
            closedAt: null,
            createdAt: new Date('2026-10-07T10:00:00Z').toISOString(), // 5h antes
          },
        },
      ],
    });
    db.collection = ((orig) => (name) => {
      const col = orig(name);
      col.stream = col.get;
      return col;
    })(db.collection);
    const r = await handleResolvePedidoCardCode({
      fbDb: db,
      now: () => now,
      log: () => {},
    });
    expect(r.unresolved).toBe(1);
    expect(r.flaggedForUi).toBe(0); // NO marca flag si pedido es reciente
  });

  it('pedido con cardCode ya seteado → skip (no cuenta en missingCardCode)', async () => {
    const db = makeFakeDb({
      sap_clients: [],
      client_applications: [],
      pedidos: [
        {
          id: 'p1',
          data: {
            clientName: 'REBORN SRL',
            clientCardCode: 'C1234', // ya tiene
            closedAt: null,
            createdAt: new Date('2026-10-01').toISOString(),
          },
        },
      ],
    });
    db.collection = ((orig) => (name) => {
      const col = orig(name);
      col.stream = col.get;
      return col;
    })(db.collection);
    const r = await handleResolvePedidoCardCode({
      fbDb: db,
      now: () => new Date('2026-10-07'),
      log: () => {},
    });
    expect(r.totalScanned).toBe(1);
    expect(r.missingCardCode).toBe(0);
    expect(r.resolvedSapClients).toBe(0);
    expect(r.flaggedForUi).toBe(0);
  });
});
