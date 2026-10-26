// @ts-check
/**
 * v1470 §64 (2026-10-26) — unit tests del sanitizador stripUndefined.
 * Hotfix bug Federico Castelanelli al guardar orden en lista de espera
 * ("Function WriteBatch.update() called with invalid data. Unsupported field
 * value: undefined (found in document revision_waitlist/ZPvU3dOUKtkMeNf1lnq)").
 */
import { describe, expect, it } from 'vitest';
import { isSanitizedPath, stripUndefined } from '../../src/pure/firestore-sanitize.js';

describe('v1470 §64 — stripUndefined', () => {
  it('T1 elimina claves undefined de objetos planos', () => {
    expect(stripUndefined({ a: 1, b: undefined, c: 'x' })).toEqual({ a: 1, c: 'x' });
  });

  it('T2 preserva null (es valor válido Firestore)', () => {
    expect(stripUndefined({ a: null, b: undefined })).toEqual({ a: null });
  });

  it('T3 recursivo en objetos anidados', () => {
    expect(stripUndefined({ a: { b: undefined, c: 1 } })).toEqual({ a: { c: 1 } });
  });

  it('T4 arrays: items undefined se excluyen, items procesados recursivamente', () => {
    expect(stripUndefined({ xs: [1, undefined, 3, { a: undefined, b: 2 }] })).toEqual({
      xs: [1, 3, { b: 2 }],
    });
  });

  it('T5 preserva primitivos', () => {
    expect(stripUndefined(42)).toBe(42);
    expect(stripUndefined('x')).toBe('x');
    expect(stripUndefined(true)).toBe(true);
    expect(stripUndefined(null)).toBe(null);
    expect(stripUndefined(undefined)).toBe(undefined);
  });

  it('T6 preserva Date (Firestore acepta nativo)', () => {
    const d = new Date('2026-10-26T17:00:00Z');
    expect(stripUndefined({ at: d, x: undefined })).toEqual({ at: d });
  });

  it('T7 preserva FieldValue sentinel (serverTimestamp) por _methodName', () => {
    const fakeSentinel = { _methodName: 'FieldValue.serverTimestamp' };
    const result = stripUndefined({ at: fakeSentinel, x: undefined });
    expect(result.at).toBe(fakeSentinel); // misma referencia (no clonado)
    expect(result.x).toBeUndefined();
    expect(Object.hasOwn(result, 'x')).toBe(false);
  });

  it('T8 preserva Timestamp y DocumentReference por constructor.name', () => {
    class Timestamp {
      constructor(seconds, nanoseconds) {
        this.seconds = seconds;
        this.nanoseconds = nanoseconds;
      }
    }
    class DocumentReference {
      constructor(path) {
        this.path = path;
      }
    }
    const ts = new Timestamp(1234567890, 0);
    const ref = new DocumentReference('x/y');
    const result = stripUndefined({ ts, ref, x: undefined });
    expect(result.ts).toBe(ts);
    expect(result.ref).toBe(ref);
  });

  it('T9 fixture real Federico: item CPST con boEntryResolved/origen/asigRefs undefined', () => {
    const item = {
      code: 'CUDC151MGA',
      qty: 1,
      desc: 'Carrete',
      origen: undefined,
      asigRefs: undefined,
      boEntryResolved: undefined,
      boEntryPrevio: undefined,
      importedFromOrder: undefined,
    };
    const sanitized = stripUndefined(item);
    expect(sanitized).toEqual({ code: 'CUDC151MGA', qty: 1, desc: 'Carrete' });
    expect(Object.hasOwn(sanitized, 'origen')).toBe(false);
    expect(Object.hasOwn(sanitized, 'asigRefs')).toBe(false);
    expect(Object.hasOwn(sanitized, 'boEntryResolved')).toBe(false);
    expect(Object.hasOwn(sanitized, 'boEntryPrevio')).toBe(false);
    expect(Object.hasOwn(sanitized, 'importedFromOrder')).toBe(false);
  });

  it('T10 fixture real: items[] mezcla CPST + manual + con BO previo', () => {
    const items = [
      // CPST completo
      {
        code: 'LDM54TE4028015S',
        qty: 2,
        origen: 'stock-asignado',
        asigRefs: [{ pedidoId: 'X', lineIndex: 14, sku: 'LDM54TE4028015S', qtyAsignada: 2 }],
        boEntryResolved: undefined,
        boEntryPrevio: undefined,
      },
      // Manual sin BO previo
      {
        code: 'CUDC151MGA',
        qty: 1,
        origen: undefined,
        asigRefs: undefined,
        boEntryResolved: undefined,
        boEntryPrevio: undefined,
      },
      // Con BO previo resuelto
      {
        code: 'OTRO',
        qty: 3,
        origen: undefined,
        asigRefs: undefined,
        boEntryResolved: 'same',
        boEntryPrevio: 2,
      },
    ];
    const payload = {
      items,
      updatedAt: { _methodName: 'FieldValue.serverTimestamp' },
      source: 'stock-asignado-batch',
      extraCampo: undefined,
    };
    const result = stripUndefined(payload);
    expect(result.items).toHaveLength(3);
    // CPST: origen + asigRefs preservados.
    expect(result.items[0].origen).toBe('stock-asignado');
    expect(result.items[0].asigRefs).toHaveLength(1);
    expect(Object.hasOwn(result.items[0], 'boEntryResolved')).toBe(false);
    // Manual: todos los opcionales fuera.
    expect(result.items[1]).toEqual({ code: 'CUDC151MGA', qty: 1 });
    // Con BO resuelto: boEntryResolved + boEntryPrevio preservados.
    expect(result.items[2].boEntryResolved).toBe('same');
    expect(result.items[2].boEntryPrevio).toBe(2);
    expect(Object.hasOwn(result.items[2], 'origen')).toBe(false);
    expect(result.source).toBe('stock-asignado-batch');
    expect(Object.hasOwn(result, 'extraCampo')).toBe(false);
    // FieldValue sentinel preservado por referencia.
    expect(result.updatedAt._methodName).toBe('FieldValue.serverTimestamp');
  });

  it('T11 no modifica el input original (puro)', () => {
    const input = { a: 1, b: undefined, c: [1, undefined] };
    const original = JSON.parse(JSON.stringify(input, (_, v) => (v === undefined ? 'U' : v)));
    stripUndefined(input);
    const after = JSON.parse(JSON.stringify(input, (_, v) => (v === undefined ? 'U' : v)));
    expect(after).toEqual(original);
  });

  it('T12 edge: objeto vacío devuelve objeto vacío', () => {
    expect(stripUndefined({})).toEqual({});
    expect(stripUndefined([])).toEqual([]);
  });

  it('T13 edge: NaN / Infinity preservados (son numbers, no undefined)', () => {
    expect(stripUndefined({ x: NaN, y: Infinity })).toEqual({ x: NaN, y: Infinity });
  });

  it('T14 edge: valor undefined explícito en nivel raíz devuelve undefined', () => {
    expect(stripUndefined(undefined)).toBeUndefined();
  });

  it('T15 edge: profundidad alta no genera stack overflow', () => {
    let deep = { v: 1 };
    for (let i = 0; i < 100; i++) deep = { nested: deep, skip: undefined };
    const result = stripUndefined(deep);
    let p = result;
    while (p.nested) p = p.nested;
    expect(p.v).toBe(1);
  });
});

describe('v1470 §64 — isSanitizedPath', () => {
  it('T20 revision_waitlist/* → true', () => {
    expect(isSanitizedPath('revision_waitlist/abc')).toBe(true);
    expect(isSanitizedPath('revision_waitlist/ZPvU3dOUKtkMeNf1lnq')).toBe(true);
  });

  it('T21 pedidos/* → true', () => {
    expect(isSanitizedPath('pedidos/xyz')).toBe(true);
    expect(isSanitizedPath('pedidos/du8K5zhHQcrXAfSh94Ji')).toBe(true);
  });

  it('T22 otras colecciones → false', () => {
    expect(isSanitizedPath('client_master/x')).toBe(false);
    expect(isSanitizedPath('stock_snapshot/y')).toBe(false);
    expect(isSanitizedPath('operations_log/z')).toBe(false);
    expect(isSanitizedPath('pedido_draft_locks/x')).toBe(false);
  });

  it('T23 input inválido → false', () => {
    expect(isSanitizedPath('')).toBe(false);
    expect(isSanitizedPath(null)).toBe(false);
    expect(isSanitizedPath(undefined)).toBe(false);
    expect(isSanitizedPath(123)).toBe(false);
  });
});

describe('v1470 §64 — monkey-patch instalado en index.html', () => {
  it('T30 index.html instala el monkey-patch luego de inicializar fbDb', async () => {
    const { readFileSync } = await import('node:fs');
    const html = readFileSync('index.html', 'utf8');
    const idxFbDb = html.indexOf('const fbDb = firebase.firestore()');
    const idxPatch = html.indexOf('_installFirestoreSanitizePatch');
    expect(idxFbDb).toBeGreaterThan(0);
    expect(idxPatch).toBeGreaterThan(idxFbDb);
    // Verifica que el patch cubre DocumentReference y WriteBatch.
    // v1472: amplio slice porque el patch agregó tap de error + commit intercept.
    const slice = html.slice(idxPatch, idxPatch + 6000);
    expect(slice).toMatch(/_DocProto/);
    expect(slice).toMatch(/_BatchProto/);
    expect(slice).toMatch(/_patchedUpdate/);
    expect(slice).toMatch(/_patchedSet/);
    expect(slice).toMatch(/_patchedBatchUpdate/);
    expect(slice).toMatch(/_patchedBatchSet/);
    expect(slice).toMatch(/isSanitizedPath/);
    // Marca de debug.
    expect(slice).toMatch(/__v1470_sanitizePatchInstalled/);
  });
});
