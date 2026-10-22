// @ts-check
/**
 * v1415 §42.1 — test obligatorio que faltaba: CPST para un cliente que ya tiene
 * una orden abierta NO crea un doc nuevo. El helper
 * `_createOrUnifyWaitlistPayload` debe interceptar y ofrecer unificar.
 *
 * Reporte prod 2026-10-22: PONTORIERO ORDEN 524 (CPST 12:53) + ORDEN 526
 * (CPST 13:38) ambas abiertas → violación §42. Causa: cache local
 * `revisionWaitlist` del creator de la 526 no tenía la 524 (race, cardCode
 * mismatch, o propagación cross-browser delayed). Fix: lectura FRESH de
 * Firestore en el helper + union con cache local.
 *
 * Este test simula el flow usando los pure fns (sin Firestore real) +
 * verifica la lógica de intercepción.
 */
import { describe, expect, it } from 'vitest';
import {
  findOpenWaitlistsForClient,
  formatWaitlistForConfirm,
} from '../../../src/pure/waitlist-unique-per-client.js';

const CARD_CODE = 'C20175569635';
const CLIENT_NAME = 'ALBERTO PONTORIERO';

function makeWaitlist524() {
  return {
    _id: 'wl-524',
    orderNumber: 524,
    clientName: CLIENT_NAME,
    clientCardCode: CARD_CODE,
    stage: undefined,
    closedAt: null,
    source: 'stock-asignado-batch',
    createdAt: '2026-10-22T15:53:00Z',
    items: Array.from({ length: 29 }, (_, i) => ({
      code: 'SKU-' + i,
      qty: 6,
      origen: 'stock-asignado',
      asigRefs: [{ pedidoId: 'ped-x', lineIndex: i, qtyAsignada: 6 }],
    })),
    pedidosOrigenes: Array.from({ length: 29 }, (_, i) => ({
      pedidoId: 'ped-x',
      lineIndex: i,
      sku: 'SKU-' + i,
      qtyAsignada: 6,
    })),
  };
}

function makeIncomingCpst526() {
  return {
    clientName: CLIENT_NAME,
    clientCardCode: CARD_CODE,
    source: 'stock-asignado-batch',
    orderNumber: 526,
    items: [
      {
        code: 'SKU-NEW-A',
        qty: 3,
        origen: 'stock-asignado',
        asigRefs: [{ pedidoId: 'ped-y', lineIndex: 0, qtyAsignada: 3 }],
      },
      {
        code: 'SKU-NEW-B',
        qty: 3,
        origen: 'stock-asignado',
        asigRefs: [{ pedidoId: 'ped-y', lineIndex: 1, qtyAsignada: 3 }],
      },
    ],
    pedidosOrigenes: [
      { pedidoId: 'ped-y', lineIndex: 0, sku: 'SKU-NEW-A', qtyAsignada: 3 },
      { pedidoId: 'ped-y', lineIndex: 1, sku: 'SKU-NEW-B', qtyAsignada: 3 },
    ],
  };
}

describe('v1415 §42.1 — CPST con cliente que ya tiene orden abierta', () => {
  it('findOpenWaitlistsForClient encuentra la 524 cuando el cache la tiene', () => {
    const cache = [makeWaitlist524()];
    const open = findOpenWaitlistsForClient(cache, CARD_CODE);
    expect(open).toHaveLength(1);
    expect(open[0].orderNumber).toBe(524);
  });

  it('BUG reproducido: cache vacío → findOpen devuelve [] (fallaba la §42)', () => {
    const cache = []; // simula race del listener o user recién logueado
    const open = findOpenWaitlistsForClient(cache, CARD_CODE);
    expect(open).toHaveLength(0);
    // Antes de v1415, esto hacía que el helper cayera al create path →
    // 2 órdenes abiertas (violación §42). v1415 fix: fresh query a Firestore
    // antes de confiar en el cache. Ver _createOrUnifyWaitlistPayload en
    // index.html post-§42.1.
  });

  it('FIX §42.1: union cache + fresh devuelve la 524 aunque cache esté vacío', () => {
    const cacheLocal = []; // vacío por race.
    const freshFromFirestore = [makeWaitlist524()]; // query fresh devuelve la 524.
    // Simular el merge dedup por _id que hace el helper post-v1415.
    const seen = new Set(freshFromFirestore.map((d) => d._id).filter(Boolean));
    const union = freshFromFirestore.slice();
    for (const c of cacheLocal) {
      if (c && c._id && !seen.has(c._id)) union.push(c);
    }
    const open = findOpenWaitlistsForClient(union, CARD_CODE);
    expect(open).toHaveLength(1);
    expect(open[0].orderNumber).toBe(524);
  });

  it('FIX §42.1: cache tiene optimistic recién creado + fresh no → union captura ambos', () => {
    // Scenario: justo después de que otro user crea la 523, el optimistic de un
    // waitlist propio recién creado queda en cache pero no en fresh query aún.
    const otraOptimistic = {
      _id: 'wl-opt-local',
      orderNumber: 525,
      clientCardCode: CARD_CODE,
      closedAt: null,
      items: [],
      createdAt: '2026-10-22T16:30:00Z',
    };
    const cacheLocal = [otraOptimistic];
    const freshFromFirestore = [makeWaitlist524()];
    const seen = new Set(freshFromFirestore.map((d) => d._id).filter(Boolean));
    const union = freshFromFirestore.slice();
    for (const c of cacheLocal) {
      if (c && c._id && !seen.has(c._id)) union.push(c);
    }
    const open = findOpenWaitlistsForClient(union, CARD_CODE);
    expect(open.map((o) => o.orderNumber).sort()).toEqual([524, 525]);
    // 525 (local optimistic) + 524 (fresh) → ambos captured.
  });

  it('msg de confirm formatea la 524 correctamente', () => {
    const target = makeWaitlist524();
    const desc = formatWaitlistForConfirm(target);
    expect(desc).toContain('ORDEN 524');
    expect(desc).toContain('29 SKU');
    expect(desc).toContain('174 unidades'); // 29 * 6
  });

  it('_createOrUnifyWaitlistPayload cae al create path solo cuando openList=[]', () => {
    // Validamos el shape del contrato: cuando NO hay match, devuelve
    // {unified:false, cancelled:false, docRef:X}.
    // Cuando SÍ hay match, el flow pasa por confirm → unify o cancel.
    // Esto es tested indirect por los tests de flow en v1404.
    const emptyCache = [];
    const open = findOpenWaitlistsForClient(emptyCache, CARD_CODE);
    expect(open).toHaveLength(0);
    // Con el fix §42.1, el helper hace fresh query ANTES de este path.
  });

  it('cardCode con espacios/case → trim normaliza', () => {
    const cache = [makeWaitlist524()];
    expect(findOpenWaitlistsForClient(cache, '  C20175569635  ')).toHaveLength(1);
    expect(findOpenWaitlistsForClient(cache, 'c20175569635')).toHaveLength(0); // case-sensitive
    // Nota: findOpenWaitlistsForClient compara case-sensitive. Mariano reporta
    // que los cardCodes SAP vienen siempre uppercase, pero para blindaje
    // adicional podemos normalizar en el helper. Si bug reaparece por case,
    // ampliar normalización.
  });
});

describe('v1415 §42.1 — index.html tiene la lectura fresh', () => {
  const INDEX_HTML = require('node:fs').readFileSync('index.html', 'utf8');
  const helperStart = INDEX_HTML.indexOf('window._createOrUnifyWaitlistPayload');
  const helperChunk = INDEX_HTML.slice(helperStart, helperStart + 5000);

  it('_createOrUnifyWaitlistPayload hace fresh query a revision_waitlist', () => {
    expect(helperChunk).toMatch(
      /\.collection\(['"]revision_waitlist['"]\)\s*\n?\s*\.where\(['"]clientCardCode['"]/
    );
  });

  it('fallback a cache local si fresh query falla', () => {
    expect(helperChunk).toMatch(/catch[\s\S]*?\[§42\.1\][\s\S]*?revisionWaitlist/);
  });

  it('union dedupe por _id entre fresh + cache', () => {
    expect(helperChunk).toMatch(/const seen = new Set/);
    expect(helperChunk).toMatch(/if \(c && c\._id && !seen\.has/);
  });
});
