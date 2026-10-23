// @ts-check
/**
 * v1418 §42.2.1 (2026-10-22) HOTFIX — guard §42.2 NO debe unificar la waitlist
 * que originó el pedido actual consigo misma.
 *
 * Reporte Mariano 2026-10-22 15:30: cotización SAP 2000425 ALBERTO PONTORIERO
 * ORDEN 524 confirmada 14:47 con TODAS las qty duplicadas respecto de la
 * lista de espera (EXGTVS90M4CH 1→2, EXGTVC66M4AR 2→4, EXGTVS70MH4AR 3→6,
 * CLC70HAR 4→8, CLC66HAR 2→4). Total SAP $4.876.000 vs app $2.879.000.
 *
 * Causa: validateReviewAndPasarAPendientes.§42.2 hacía fresh query sin excluir
 * la waitlist origen → la encontraba, ofrecía "unificar", mergeaba sus líneas
 * al ord[] que YA las tenía desde _waitlistPasarAPendientesContinuar.
 *
 * Fix: pedidos-modal.js:validateReviewAndPasarAPendientes filtra por
 * `d.id !== window._pendingPedidoWaitlistId` tanto en fresh query como en
 * fallback cache.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const PEDIDOS_MODAL = readFileSync('src/domains/pedidos-modal.js', 'utf8');

describe('v1418 §42.2.1 — guard no self-unifica la waitlist propia', () => {
  it('declara _excludeWlId = window._pendingPedidoWaitlistId', () => {
    expect(PEDIDOS_MODAL).toMatch(/_excludeWlId\s*=[\s\S]{0,80}window\._pendingPedidoWaitlistId/);
  });

  it('§57 (2026-10-23): delega al pure helper openWaitlists.findOpenWaitlistsForClient', () => {
    // v1418 §42.2.1 inline filter (d.id === _excludeWlId) fue refactoreado a
    // la pura `src/pure/open-waitlists.js:findOpenWaitlistsForClient` que
    // acepta cardCode + excludeId + docs. El filter inline se mantiene como
    // fallback cuando el bundle no cargó (SW stale).
    const guardSlice = PEDIDOS_MODAL.slice(
      PEDIDOS_MODAL.indexOf('v1418 §42.2.1 HOTFIX'),
      PEDIDOS_MODAL.indexOf('Forma de pago obligatoria')
    );
    expect(guardSlice.length).toBeGreaterThan(500);
    // Debe invocar el helper puro con cardCode + excludeId + docs.
    expect(guardSlice).toMatch(/_findOpenPure\s*\(\s*cliCardCode\s*,\s*_excludeWlId\s*,\s*docs\s*\)/);
    // Debe acceder al helper por `window.__phase0.pure.openWaitlists.findOpenWaitlistsForClient`.
    expect(guardSlice).toMatch(/openWaitlists[\s\S]{0,80}findOpenWaitlistsForClient/);
  });

  it('fallback inline mantiene la exclusión por _excludeWlId para SW stale', () => {
    // Si el bundle no cargó el helper puro (SW stale sirviendo versión vieja),
    // el guard tiene un fallback inline que replica la lógica. Debe también
    // excluir la waitlist propia.
    const guardSlice = PEDIDOS_MODAL.slice(
      PEDIDOS_MODAL.indexOf('v1418 §42.2.1 HOTFIX'),
      PEDIDOS_MODAL.indexOf('Forma de pago obligatoria')
    );
    expect(guardSlice).toMatch(
      /_excludeWlId[\s\S]{0,150}String\(w\._id[\s\S]{0,20}\)\s*===\s*_excludeWlId/
    );
  });

  it('_excludeWlId se coerciona a String para evitar comparación number vs string', () => {
    expect(PEDIDOS_MODAL).toMatch(
      /_excludeWlId\s*=[\s\S]{0,150}String\(window\._pendingPedidoWaitlistId\)/
    );
  });

  it('comentario del hotfix cita el precedente SAP 2000425 PONTORIERO', () => {
    expect(PEDIDOS_MODAL).toMatch(/2000425[\s\S]{0,200}PONTORIERO[\s\S]{0,80}ORDEN 524/);
  });
});

describe('v1418 §42.2.1 — simulación del flow', () => {
  it('fresh query devuelve 1 waitlist propia + 0 ajenas → openList queda vacía', () => {
    // Simulamos la lógica del guard.
    const docs = [
      {
        id: 'wl-524-propia',
        data: () => ({
          clientCardCode: 'C20175569635',
          closedAt: null,
          stage: null,
          items: Array(29).fill({ code: 'X', qty: 1 }),
        }),
      },
    ];
    const excludeId = 'wl-524-propia';
    const openList = [];
    docs.forEach((d) => {
      if (excludeId && d.id === excludeId) return;
      const data = d.data();
      if (data.closedAt) return;
      if (data.stage === 'consumed') return;
      openList.push({ _id: d.id, ...data });
    });
    expect(openList).toHaveLength(0);
  });

  it('fresh query devuelve propia + 1 ajena → openList sólo tiene la ajena', () => {
    const docs = [
      {
        id: 'wl-524-propia',
        data: () => ({
          clientCardCode: 'C20175569635',
          closedAt: null,
          stage: null,
          items: [{ code: 'X', qty: 1 }],
        }),
      },
      {
        id: 'wl-526-ajena',
        data: () => ({
          clientCardCode: 'C20175569635',
          closedAt: null,
          stage: null,
          orderNumber: 526,
          items: [{ code: 'Y', qty: 2 }],
        }),
      },
    ];
    const excludeId = 'wl-524-propia';
    const openList = [];
    docs.forEach((d) => {
      if (excludeId && d.id === excludeId) return;
      const data = d.data();
      if (data.closedAt) return;
      if (data.stage === 'consumed') return;
      openList.push({ _id: d.id, ...data });
    });
    expect(openList).toHaveLength(1);
    expect(openList[0]._id).toBe('wl-526-ajena');
    expect(openList[0].orderNumber).toBe(526);
  });

  it('fresh query sin _pendingPedidoWaitlistId (pedido directo sin waitlist) devuelve todas las abiertas', () => {
    const docs = [
      {
        id: 'wl-524-abierta',
        data: () => ({
          clientCardCode: 'C20175569635',
          closedAt: null,
          stage: null,
          orderNumber: 524,
          items: [{ code: 'X', qty: 1 }],
        }),
      },
    ];
    const excludeId = null;
    const openList = [];
    docs.forEach((d) => {
      if (excludeId && d.id === excludeId) return;
      const data = d.data();
      if (data.closedAt) return;
      if (data.stage === 'consumed') return;
      openList.push({ _id: d.id, ...data });
    });
    expect(openList).toHaveLength(1);
    expect(openList[0].orderNumber).toBe(524);
  });

  it('ignora stage=consumed y closedAt no-null', () => {
    const docs = [
      { id: 'wl-X', data: () => ({ clientCardCode: 'C', stage: 'consumed' }) },
      { id: 'wl-Y', data: () => ({ clientCardCode: 'C', closedAt: '2026-10-22T00:00Z' }) },
      {
        id: 'wl-OK',
        data: () => ({ clientCardCode: 'C', closedAt: null, stage: null, orderNumber: 999 }),
      },
    ];
    const openList = [];
    docs.forEach((d) => {
      const data = d.data();
      if (data.closedAt) return;
      if (data.stage === 'consumed') return;
      openList.push({ _id: d.id, ...data });
    });
    expect(openList).toHaveLength(1);
    expect(openList[0].orderNumber).toBe(999);
  });
});

describe('v1418 §42.2.1 — caso real PONTORIERO 524 reproduce bug pre-fix', () => {
  it('PRE-fix: sin excludeId → openList tiene la 524 → merge duplicaría líneas', () => {
    const docs = [
      {
        id: 'wl-524-pontoriero',
        data: () => ({
          clientCardCode: 'C20175569635',
          clientName: 'ALBERTO PONTORIERO',
          closedAt: null,
          stage: null,
          orderNumber: 524,
          items: [
            { code: 'EXGTVS90M4CH', qty: 1 },
            { code: 'EXGTVC66M4AR', qty: 2 },
            { code: 'EXGTVS70MH4AR', qty: 3 },
            { code: 'CLC70HAR', qty: 4 },
            { code: 'CLC66HAR', qty: 2 },
          ],
        }),
      },
    ];
    const excludeId = null; // simular bug pre-v1418
    const openList = [];
    docs.forEach((d) => {
      if (excludeId && d.id === excludeId) return;
      const data = d.data();
      if (data.closedAt) return;
      if (data.stage === 'consumed') return;
      openList.push({ _id: d.id, ...data });
    });
    expect(openList).toHaveLength(1);
    const target = openList[0];
    // El ord[] YA tiene estas líneas (via _waitlistPasarAPendientesContinuar).
    const ord = target.items.map((it) => ({ ...it }));
    // Simular merge BUG (sumar los items del target al ord → qty duplicadas).
    for (const it of target.items) {
      ord.push({ ...it });
    }
    // Post-merge BUG: cada SKU tiene 2 líneas con misma qty → al enviar SAP, qty doble.
    expect(ord.length).toBe(target.items.length * 2);
    const sumQty = ord.reduce((s, l) => s + l.qty, 0);
    const sumOriginal = target.items.reduce((s, l) => s + l.qty, 0);
    expect(sumQty).toBe(sumOriginal * 2); // 2× = bug reproducido
  });

  it('POST-fix: con excludeId → openList vacío → NO se dispara el guard', () => {
    const docs = [
      {
        id: 'wl-524-pontoriero',
        data: () => ({
          clientCardCode: 'C20175569635',
          closedAt: null,
          stage: null,
          orderNumber: 524,
          items: [
            { code: 'EXGTVS90M4CH', qty: 1 },
            { code: 'EXGTVC66M4AR', qty: 2 },
          ],
        }),
      },
    ];
    const excludeId = 'wl-524-pontoriero'; // v1418 fix
    const openList = [];
    docs.forEach((d) => {
      if (excludeId && d.id === excludeId) return;
      const data = d.data();
      if (data.closedAt) return;
      if (data.stage === 'consumed') return;
      openList.push({ _id: d.id, ...data });
    });
    expect(openList).toHaveLength(0);
    // Guard NO dispara → no hay merge → ord[] permanece intacto.
  });
});
