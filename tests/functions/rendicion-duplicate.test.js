// @ts-check
/**
 * Tests del CF core anti-duplicados de rendiciones.
 * Mocks in-memory de Firestore — no requiere emulador.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  checkNewRendicionDuplicate,
  LOOKBACK_DAYS,
  RELEVANT_STATUSES,
} from '../../functions/core/rendicion-duplicate-core.js';

/**
 * Firestore fake — soporta:
 *   collection('rendiciones').doc(id).update(data)
 *   collection('rendiciones').where(...).where(...).get()
 */
function makeFakeDb(rendicionesArray) {
  const store = { rendiciones: [...rendicionesArray] };
  const writes = [];
  const collection = (name) => {
    if (name !== 'rendiciones') throw new Error(`unexpected collection: ${name}`);
    const filters = [];
    const chain = {
      where(field, op, value) {
        filters.push({ field, op, value });
        return chain;
      },
      async get() {
        const filtered = store.rendiciones.filter((r) =>
          filters.every((f) => {
            const v = r.data[f.field];
            if (f.op === '==') return v === f.value;
            if (f.op === '>=') return v && v >= f.value;
            if (f.op === '<=') return v && v <= f.value;
            return true;
          })
        );
        return {
          forEach(cb) {
            for (const r of filtered) cb({ id: r.id, data: () => r.data });
          },
        };
      },
      doc(id) {
        return {
          async update(patch) {
            const r = store.rendiciones.find((x) => x.id === id);
            if (r) r.data = { ...r.data, ...patch };
            writes.push({ type: 'update', id, patch });
          },
        };
      },
    };
    return chain;
  };
  return { _writes: writes, _store: store, collection };
}

function makeDeps({ enabled = true, now = new Date('2026-09-09T12:00:00Z'), db }) {
  return {
    db,
    FieldValue: { serverTimestamp: () => 'MOCK_TS' },
    log: vi.fn(),
    now: () => now,
    isEnabled: async () => enabled,
  };
}

// ============================================================
// checkNewRendicionDuplicate
// ============================================================
describe('checkNewRendicionDuplicate', () => {
  it('MATCH FUERTE contra approved → marca duplicado_detectado', async () => {
    const existing = {
      id: 'rend-1',
      data: {
        ownerUid: 'uid-mauricio',
        numeroTicket: '00011-00001442',
        importe: 6600,
        observaciones: 'CUIT: 30-71234567-8',
        status: 'approved',
        createdAt: new Date('2026-08-20T10:00:00Z'),
      },
    };
    const db = makeFakeDb([existing]);
    const newData = {
      ownerUid: 'uid-mauricio',
      numeroTicket: '00011-00001442', // mismo canonico
      importe: 6600,
      observaciones: 'CUIT: 30-71234567-8',
      status: 'pending_approval',
      createdAt: new Date('2026-08-31T10:00:00Z'),
    };
    const deps = makeDeps({ db });
    // El doc nuevo esta en el store (para simular que ya fue creado por el trigger).
    db._store.rendiciones.push({ id: 'rend-2', data: newData });

    const result = await checkNewRendicionDuplicate('rend-2', newData, deps);

    expect(result.action).toBe('duplicate-detected');
    expect(result.matchedDocId).toBe('rend-1');
    expect(result.matchedReason).toMatch(/^strong:/);
    // Verificar el update en el doc nuevo.
    const updates = db._writes.filter((w) => w.id === 'rend-2');
    expect(updates).toHaveLength(1);
    expect(updates[0].patch).toMatchObject({
      status: 'duplicado_detectado',
      duplicateOf: 'rend-1',
      duplicateStrength: 'strong',
      ticketNormalizado: '11-1442',
    });
    expect(updates[0].patch.duplicateReason).toMatch(/^strong:/);
  });

  it('MATCH FUERTE contra pending_approval → tambien bloquea', async () => {
    const existing = {
      id: 'rend-1',
      data: {
        ownerUid: 'uid-mauricio',
        numeroTicket: '00017-00006675',
        importe: 22000,
        modoPago: 'CORPORATIVA',
        observaciones: 'CUIT: 30-71234567-8',
        status: 'pending_approval',
        createdAt: new Date('2026-08-21T10:00:00Z'),
      },
    };
    const db = makeFakeDb([existing]);
    const newData = {
      ownerUid: 'uid-mauricio',
      numeroTicket: '00017-00006675',
      importe: 22000,
      modoPago: 'RECARGABLE', // distinto modo pago, NO importa
      observaciones: 'CUIT: 30-71234567-8',
      status: 'pending_approval',
      createdAt: new Date('2026-08-31T10:00:00Z'),
    };
    const deps = makeDeps({ db });
    db._store.rendiciones.push({ id: 'rend-2', data: newData });

    const result = await checkNewRendicionDuplicate('rend-2', newData, deps);
    expect(result.action).toBe('duplicate-detected');
    expect(result.matchedDocId).toBe('rend-1');
  });

  it('MATCH FUERTE contra rejected → NO bloquea', async () => {
    const rejected = {
      id: 'rend-1',
      data: {
        ownerUid: 'uid-mauricio',
        numeroTicket: '00011-00001442',
        importe: 6600,
        observaciones: 'CUIT: 30-71234567-8',
        status: 'rejected',
        createdAt: new Date('2026-08-20T10:00:00Z'),
      },
    };
    const db = makeFakeDb([rejected]);
    const newData = {
      ownerUid: 'uid-mauricio',
      numeroTicket: '00011-00001442',
      importe: 6600,
      observaciones: 'CUIT: 30-71234567-8',
      status: 'pending_approval',
      createdAt: new Date('2026-08-31T10:00:00Z'),
    };
    const deps = makeDeps({ db });
    db._store.rendiciones.push({ id: 'rend-2', data: newData });

    const result = await checkNewRendicionDuplicate('rend-2', newData, deps);
    // Sin match relevante — solo populate ticketNormalizado.
    expect(result.action).toBe('populate-only');
    expect(result.ticketNormalizado).toBe('11-1442');
  });

  it('MATCH FUERTE contra duplicado_detectado previo → NO cuenta como origen', async () => {
    // Un doc previo ya marcado como duplicado no debe usarse como "original".
    const previoMarcado = {
      id: 'rend-1',
      data: {
        ownerUid: 'uid-mauricio',
        numeroTicket: '00011-00001442',
        importe: 6600,
        observaciones: 'CUIT: 30-71234567-8',
        status: 'duplicado_detectado',
        createdAt: new Date('2026-08-25T10:00:00Z'),
      },
    };
    const db = makeFakeDb([previoMarcado]);
    const newData = {
      ownerUid: 'uid-mauricio',
      numeroTicket: '00011-00001442',
      importe: 6600,
      observaciones: 'CUIT: 30-71234567-8',
      status: 'pending_approval',
      createdAt: new Date('2026-08-31T10:00:00Z'),
    };
    const deps = makeDeps({ db });
    db._store.rendiciones.push({ id: 'rend-2', data: newData });

    const result = await checkNewRendicionDuplicate('rend-2', newData, deps);
    expect(result.action).toBe('populate-only'); // no bloquea
  });

  it('4 peajes $2.800 mismo dia con tickets distintos → NO bloquea', async () => {
    const peaje1 = {
      id: 'rend-1',
      data: {
        ownerUid: 'uid-mauricio',
        numeroTicket: '00001-00000001',
        importe: 2800,
        observaciones: 'Peaje. CUIT: 30-70000001-1',
        fechaTicket: '2026-08-15',
        status: 'approved',
        createdAt: new Date('2026-08-15T09:00:00Z'),
      },
    };
    const db = makeFakeDb([peaje1]);
    const peaje2Data = {
      ownerUid: 'uid-mauricio',
      numeroTicket: '00001-00000002', // ticket distinto
      importe: 2800,
      observaciones: 'Peaje. CUIT: 30-70000001-1',
      fechaTicket: '2026-08-15',
      status: 'pending_approval',
      createdAt: new Date('2026-08-15T09:30:00Z'),
    };
    const deps = makeDeps({ db });
    db._store.rendiciones.push({ id: 'rend-2', data: peaje2Data });

    const result = await checkNewRendicionDuplicate('rend-2', peaje2Data, deps);
    // Sin match FUERTE → solo populate. La clave debil no bloquea desde CF.
    expect(result.action).toBe('populate-only');
    expect(result.ticketNormalizado).toBe('1-2');
  });

  it('feature flag OFF → solo popula ticketNormalizado', async () => {
    const existing = {
      id: 'rend-1',
      data: {
        ownerUid: 'uid-mauricio',
        numeroTicket: '00011-00001442',
        importe: 6600,
        observaciones: 'CUIT: 30-71234567-8',
        status: 'approved',
        createdAt: new Date('2026-08-20T10:00:00Z'),
      },
    };
    const db = makeFakeDb([existing]);
    const newData = {
      ownerUid: 'uid-mauricio',
      numeroTicket: '00011-00001442',
      importe: 6600,
      observaciones: 'CUIT: 30-71234567-8',
      status: 'pending_approval',
      createdAt: new Date('2026-08-31T10:00:00Z'),
    };
    const deps = makeDeps({ db, enabled: false });
    db._store.rendiciones.push({ id: 'rend-2', data: newData });

    const result = await checkNewRendicionDuplicate('rend-2', newData, deps);
    expect(result.action).toBe('populate-only');
    expect(result.reason).toBe('feature-flag-off');
    // NO se marca como duplicado (feature flag off).
    const updates = db._writes.filter((w) => w.id === 'rend-2');
    expect(updates[0].patch).not.toHaveProperty('status');
    expect(updates[0].patch.ticketNormalizado).toBe('11-1442');
  });

  it('sin ownerUid → skip inmediato', async () => {
    const db = makeFakeDb([]);
    const deps = makeDeps({ db });
    const result = await checkNewRendicionDuplicate('rend-x', {}, deps);
    expect(result.action).toBe('skipped');
    expect(result.reason).toBe('no-owner');
  });

  it('doc ya con status=duplicado_detectado → skip (defensivo re-trigger)', async () => {
    const db = makeFakeDb([]);
    const newData = {
      ownerUid: 'uid-x',
      status: 'duplicado_detectado',
      numeroTicket: '00011-1442',
    };
    const deps = makeDeps({ db });
    const result = await checkNewRendicionDuplicate('rend-x', newData, deps);
    expect(result.action).toBe('skipped');
    expect(result.reason).toBe('already-flagged');
  });

  it('sin numeroTicket ni CUIT → noop (sin claves fuertes)', async () => {
    const db = makeFakeDb([]);
    const newData = {
      ownerUid: 'uid-x',
      importe: 5000,
      observaciones: '',
      status: 'pending_approval',
      createdAt: new Date('2026-09-09T09:00:00Z'),
    };
    const deps = makeDeps({ db });
    const result = await checkNewRendicionDuplicate('rend-x', newData, deps);
    expect(result.action).toBe('noop');
    expect(result.reason).toBe('no-strong-keys');
  });

  it('ventana lookback: docs mas viejos que 90d no cuentan', async () => {
    const now = new Date('2026-12-01T00:00:00Z');
    // Doc de 2026-05-01 = ~7 meses atras, fuera de ventana 90d.
    const viejo = {
      id: 'rend-viejo',
      data: {
        ownerUid: 'uid-x',
        numeroTicket: '00011-1442',
        importe: 6600,
        observaciones: 'CUIT: 30-71234567-8',
        status: 'approved',
        createdAt: new Date('2026-05-01T10:00:00Z'),
      },
    };
    const db = makeFakeDb([viejo]);
    const newData = {
      ownerUid: 'uid-x',
      numeroTicket: '00011-1442',
      importe: 6600,
      observaciones: 'CUIT: 30-71234567-8',
      status: 'pending_approval',
      createdAt: now,
    };
    const deps = makeDeps({ db, now });
    db._store.rendiciones.push({ id: 'rend-nuevo', data: newData });

    const result = await checkNewRendicionDuplicate('rend-nuevo', newData, deps);
    // El viejo esta fuera de ventana → no cuenta.
    expect(result.action).toBe('populate-only');
  });

  it('constantes exportadas son las esperadas', () => {
    expect(LOOKBACK_DAYS).toBe(90);
    expect(RELEVANT_STATUSES).toEqual(['approved', 'pending_approval']);
  });
});
