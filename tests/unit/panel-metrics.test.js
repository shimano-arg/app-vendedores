import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  canViewPanel,
  computeAgeMinutes,
  computeBackorderTotals,
  computeHealthStatus,
  computePedidosBreakdown,
  computeStrictOverlap,
  filterOpsLogRecent,
  formatAgeLabel,
  summarizeGhActionsStatus,
  summarizeSentryStatus,
} from '../../src/pure/panel-metrics.js';

describe('canViewPanel — gate estricto', () => {
  it.each([
    ['mariano.erbino@shimano.com.ar', 'admin', true],
    ['erbinomariano@gmail.com', 'admin', true],
    ['MARIANO.erbino@SHIMANO.com.ar', 'admin', true], // case insensitive
    ['mariano.erbino@shimano.com.ar', 'vendedor', false], // role gate
    ['mariano.erbino@shimano.com.ar', 'gerente', false],
    ['santi@shimano.com.ar', 'admin', false], // email gate
    ['', 'admin', false],
    [null, 'admin', false],
  ])('email=%s role=%s → %s', (email, role, expected) => {
    const user = email != null ? { email } : null;
    expect(canViewPanel(user, role)).toBe(expected);
  });

  it('user null retorna false', () => {
    expect(canViewPanel(null, 'admin')).toBe(false);
    expect(canViewPanel(undefined, 'admin')).toBe(false);
  });
});

describe('computeAgeMinutes + formatAgeLabel', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-24T20:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('null/undefined → null', () => {
    expect(computeAgeMinutes(null)).toBeNull();
    expect(computeAgeMinutes(undefined)).toBeNull();
    expect(computeAgeMinutes('')).toBeNull();
  });

  it('invalido → null', () => {
    expect(computeAgeMinutes('not-a-date')).toBeNull();
  });

  it('5 min atras → 5', () => {
    expect(computeAgeMinutes('2026-08-24T19:55:00Z')).toBe(5);
  });

  it('date object funciona igual', () => {
    expect(computeAgeMinutes(new Date('2026-08-24T19:55:00Z'))).toBe(5);
  });

  it('futuro (clock skew) → 0 minimo', () => {
    expect(computeAgeMinutes('2026-08-24T20:05:00Z')).toBe(0);
  });

  it('formatAgeLabel: variantes', () => {
    expect(formatAgeLabel(null)).toBe('sin datos');
    expect(formatAgeLabel('2026-08-24T19:59:30Z')).toBe('hace <1 min');
    expect(formatAgeLabel('2026-08-24T19:55:00Z')).toBe('hace 5 min');
    expect(formatAgeLabel('2026-08-24T18:00:00Z')).toBe('hace 2.0h');
    expect(formatAgeLabel('2026-08-23T20:00:00Z')).toBe('hace 1.0d');
  });
});

describe('computeHealthStatus — semaforo', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-24T20:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  const th = { greenMaxMinutes: 30, yellowMaxMinutes: 120 };

  it('sin timestamp → unknown', () => {
    expect(computeHealthStatus(null, th)).toBe('unknown');
    expect(computeHealthStatus('', th)).toBe('unknown');
  });

  it('reciente (5 min) → green', () => {
    expect(computeHealthStatus('2026-08-24T19:55:00Z', th)).toBe('green');
  });

  it('borderline green (30 min exact) → green', () => {
    expect(computeHealthStatus('2026-08-24T19:30:00Z', th)).toBe('green');
  });

  it('un poco viejo (45 min) → yellow', () => {
    expect(computeHealthStatus('2026-08-24T19:15:00Z', th)).toBe('yellow');
  });

  it('borderline yellow (120 min exact) → yellow', () => {
    expect(computeHealthStatus('2026-08-24T18:00:00Z', th)).toBe('yellow');
  });

  it('viejo (3h) → red', () => {
    expect(computeHealthStatus('2026-08-24T17:00:00Z', th)).toBe('red');
  });
});

describe('computePedidosBreakdown', () => {
  it('array vacio → todo cero', () => {
    expect(computePedidosBreakdown([])).toEqual({
      total: 0,
      borrador: 0,
      pending: 0,
      confirmed: 0,
      withTransferSap: 0,
      viaAppOnly: 0,
      closed: 0,
    });
  });

  it('cuenta por stage + closedAt + via app_only', () => {
    const pedidos = [
      { stage: 'pending' },
      { stage: 'pending', transferidoSAP: { docNum: 100 } },
      { stage: 'confirmed', transferidoSAP: { via: 'service_layer_auto', docNum: 200 } },
      { stage: 'confirmed', transferidoSAP: { via: 'app_only' } },
      { stage: 'confirmed', closedAt: '2026-08-24T10:00:00Z' },
      { stage: 'crear' },
    ];
    expect(computePedidosBreakdown(pedidos)).toEqual({
      total: 6,
      borrador: 1,
      pending: 2,
      confirmed: 2, // el closedAt no cuenta como confirmed activo
      withTransferSap: 3,
      viaAppOnly: 1,
      closed: 1,
    });
  });

  it('input no-array → todo cero', () => {
    expect(computePedidosBreakdown(null)).toMatchObject({ total: 0 });
    expect(computePedidosBreakdown(undefined)).toMatchObject({ total: 0 });
  });
});

describe('computeBackorderTotals', () => {
  it('vacio → 0/0', () => {
    expect(computeBackorderTotals({}, {})).toEqual({
      sapQtyTotal: 0,
      sapSkuCount: 0,
      appQtyTotal: 0,
      appSkuCount: 0,
    });
  });

  it('suma qty y cuenta SKUs con qty>0 (ignora 0/negativos)', () => {
    const sap = { A: 10, B: 5, C: 0, D: -2 };
    const app = { X: 3, Y: 7 };
    expect(computeBackorderTotals(sap, app)).toEqual({
      sapQtyTotal: 15,
      sapSkuCount: 2,
      appQtyTotal: 10,
      appSkuCount: 2,
    });
  });

  it('null inputs → 0/0', () => {
    expect(computeBackorderTotals(null, null)).toEqual({
      sapQtyTotal: 0,
      sapSkuCount: 0,
      appQtyTotal: 0,
      appSkuCount: 0,
    });
  });
});

describe('computeStrictOverlap — misma logica que _diagBackorderOverlap runtime', () => {
  it('sin pedidos → 0', () => {
    expect(computeStrictOverlap([])).toEqual({
      strictDupsCount: 0,
      strictDupsPedidoIds: [],
    });
  });

  it('pedido sin transferidoSAP no cuenta', () => {
    const pedidos = [
      {
        _fsId: 'P1',
        lines: [
          { code: 'X', state: 'confirmed', qtyOpen: 70 },
          { code: 'X', state: 'BO', qtyOpen: 30 },
        ],
      },
    ];
    expect(computeStrictOverlap(pedidos).strictDupsCount).toBe(0);
  });

  it('pedido con 2 lineas mismo SKU + mix confirmed/BO → 1 dup', () => {
    const pedidos = [
      {
        _fsId: 'P1',
        transferidoSAP: { docNum: 100 },
        lines: [
          { code: 'X', state: 'confirmed', qtyOpen: 70 },
          { code: 'X', state: 'BO', qtyOpen: 30 },
        ],
      },
    ];
    const r = computeStrictOverlap(pedidos);
    expect(r.strictDupsCount).toBe(1);
    expect(r.strictDupsPedidoIds).toEqual(['P1']);
  });

  it('pedido con 2 lineas mismo SKU pero misma clase (2 confirmed) no cuenta', () => {
    const pedidos = [
      {
        _fsId: 'P1',
        transferidoSAP: { docNum: 100 },
        lines: [
          { code: 'X', state: 'confirmed', qtyOpen: 70 },
          { code: 'X', state: 'confirmed', qtyOpen: 30 },
        ],
      },
    ];
    expect(computeStrictOverlap(pedidos).strictDupsCount).toBe(0);
  });

  it('varios pedidos → cuenta cada uno una vez aunque tenga N SKUs duplicados', () => {
    const pedidos = [
      {
        _fsId: 'P1',
        transferidoSAP: { docNum: 100 },
        lines: [
          { code: 'X', state: 'confirmed', qtyOpen: 70 },
          { code: 'X', state: 'BO', qtyOpen: 30 },
          { code: 'Y', state: 'confirmed', qtyOpen: 5 },
          { code: 'Y', state: 'BO', qtyOpen: 5 },
        ],
      },
      {
        _fsId: 'P2',
        transferidoSAP: { docNum: 101 },
        lines: [
          { code: 'Z', state: 'confirmed', qtyOpen: 10 },
          { code: 'Z', state: 'ASIG', qtyOpen: 5 },
        ],
      },
    ];
    const r = computeStrictOverlap(pedidos);
    expect(r.strictDupsCount).toBe(2);
    expect(r.strictDupsPedidoIds.sort()).toEqual(['P1', 'P2']);
  });
});

describe('summarizeGhActionsStatus — iter 2', () => {
  it('doc null/vacio → unknown', () => {
    expect(summarizeGhActionsStatus(null).healthColor).toBe('unknown');
    expect(summarizeGhActionsStatus({}).healthColor).toBe('unknown');
    expect(summarizeGhActionsStatus({ workflows: {} }).healthColor).toBe('green'); // sin críticos = green por defecto
  });

  it('todos criticos success → green', () => {
    const doc = {
      workflows: {
        A: { isCritical: true, lastRunConclusion: 'success', lastRunStatus: 'completed' },
        B: { isCritical: true, lastRunConclusion: 'success', lastRunStatus: 'completed' },
        C: { isCritical: false, lastRunConclusion: 'failure' }, // no critico, no cuenta
      },
    };
    const s = summarizeGhActionsStatus(doc);
    expect(s.healthColor).toBe('green');
    expect(s.criticalFailingCount).toBe(0);
    expect(s.totalWorkflows).toBe(3);
    expect(s.criticalWorkflows).toHaveLength(2);
  });

  it('1 de 5 criticos failing → yellow (ratio 20%)', () => {
    const doc = {
      workflows: {
        A: { isCritical: true, lastRunConclusion: 'success' },
        B: { isCritical: true, lastRunConclusion: 'success' },
        C: { isCritical: true, lastRunConclusion: 'success' },
        D: { isCritical: true, lastRunConclusion: 'success' },
        E: { isCritical: true, lastRunConclusion: 'failure' },
      },
    };
    const s = summarizeGhActionsStatus(doc);
    expect(s.healthColor).toBe('yellow');
    expect(s.criticalFailingCount).toBe(1);
  });

  it('2 de 3 criticos failing → red (ratio 67%)', () => {
    const doc = {
      workflows: {
        A: { isCritical: true, lastRunConclusion: 'failure' },
        B: { isCritical: true, lastRunConclusion: 'failure' },
        C: { isCritical: true, lastRunConclusion: 'success' },
      },
    };
    const s = summarizeGhActionsStatus(doc);
    expect(s.healthColor).toBe('red');
    expect(s.criticalFailingCount).toBe(2);
  });

  it('failing workflows aparecen primero en criticalWorkflows[]', () => {
    const doc = {
      workflows: {
        A: { isCritical: true, lastRunConclusion: 'success' },
        Z: { isCritical: true, lastRunConclusion: 'failure' },
      },
    };
    const s = summarizeGhActionsStatus(doc);
    expect(s.criticalWorkflows[0].name).toBe('Z'); // failing primero
    expect(s.criticalWorkflows[1].name).toBe('A');
  });
});

describe('summarizeSentryStatus — iter 3', () => {
  it('doc null → unknown', () => {
    const s = summarizeSentryStatus(null);
    expect(s.status).toBe('unknown');
    expect(s.healthColor).toBe('unknown');
    expect(s.totalUnresolved).toBe(0);
  });

  it('status=not_configured → unknown color + retorna errorMessage', () => {
    const s = summarizeSentryStatus({
      status: 'not_configured',
      errorMessage: 'SENTRY_AUTH_TOKEN no seteado',
      totalUnresolved: 0,
      byLevel: {},
      recentIssues: [],
      syncedAt: '2026-08-24T20:00:00Z',
    });
    expect(s.status).toBe('not_configured');
    expect(s.healthColor).toBe('unknown');
    expect(s.errorMessage).toContain('SENTRY_AUTH_TOKEN');
  });

  it('status=error → yellow (sync fallo, app OK)', () => {
    const s = summarizeSentryStatus({
      status: 'error',
      errorMessage: 'Sentry auth failed (403)',
    });
    expect(s.healthColor).toBe('yellow');
  });

  it('sin errores → green', () => {
    const s = summarizeSentryStatus({
      status: 'ok',
      byLevel: {},
      totalUnresolved: 0,
      recentIssues: [],
      syncedAt: '2026-08-24T20:00:00Z',
    });
    expect(s.healthColor).toBe('green');
  });

  it('1-5 errores o >10 warnings → yellow', () => {
    expect(
      summarizeSentryStatus({
        status: 'ok',
        byLevel: { error: 3, warning: 2 },
      }).healthColor
    ).toBe('yellow');
    expect(
      summarizeSentryStatus({
        status: 'ok',
        byLevel: { warning: 15 },
      }).healthColor
    ).toBe('yellow');
  });

  it('>5 errores → red', () => {
    const s = summarizeSentryStatus({
      status: 'ok',
      byLevel: { error: 10, warning: 20 },
      totalUnresolved: 30,
      recentIssues: [],
    });
    expect(s.healthColor).toBe('red');
    expect(s.errorCount).toBe(10);
    expect(s.warningCount).toBe(20);
  });

  it('recentIssues preservado', () => {
    const issues = [
      { id: '1', title: 'Test error', level: 'error', count: 5 },
      { id: '2', title: 'Test warn', level: 'warning', count: 2 },
    ];
    const s = summarizeSentryStatus({
      status: 'ok',
      byLevel: { error: 1, warning: 1 },
      totalUnresolved: 2,
      recentIssues: issues,
    });
    expect(s.recentIssues).toEqual(issues);
  });
});

describe('filterOpsLogRecent', () => {
  it('vacio → []', () => {
    expect(filterOpsLogRecent([])).toEqual([]);
    expect(filterOpsLogRecent(null)).toEqual([]);
  });

  it('respeta limit', () => {
    const arr = Array.from({ length: 50 }, (_, i) => ({ id: i }));
    expect(filterOpsLogRecent(arr, 20)).toHaveLength(20);
    expect(filterOpsLogRecent(arr, 5)).toHaveLength(5);
    expect(filterOpsLogRecent(arr)).toHaveLength(20); // default 20
  });
});
