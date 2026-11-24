import { describe, expect, it, vi } from 'vitest';
import { checkAndIncrementRateLimit, RATE_LIMITS } from '../../functions/core/rate-limit-core.js';

function makeFakeFbDb() {
  const store = new Map();
  return {
    _store: store,
    doc(path) {
      return {
        _path: path,
        async get() {
          return {
            exists: store.has(path),
            data: () => store.get(path) || null,
          };
        },
      };
    },
    collection(name) {
      return {
        doc: (id) => this.doc(`${name}/${id}`),
      };
    },
    async runTransaction(fn) {
      const tx = {
        async get(refLike) {
          return refLike.get();
        },
        set(refLike, data, options) {
          const existing = store.get(refLike._path) || {};
          if (options && options.merge) {
            store.set(refLike._path, { ...existing, ...data });
          } else {
            store.set(refLike._path, data);
          }
        },
      };
      return await fn(tx);
    },
  };
}

describe('checkAndIncrementRateLimit', () => {
  it('primer request en ventana → allowed=true, count=1', async () => {
    const fbDb = makeFakeFbDb();
    const r = await checkAndIncrementRateLimit(
      { fbDb, now: () => new Date('2026-09-14T20:00:00Z') },
      'u1',
      'sapProxy',
      10,
      60 * 1000
    );
    expect(r.allowed).toBe(true);
    expect(r.count).toBe(1);
    expect(r.threshold).toBe(10);
    expect(fbDb._store.get('rate_limits/u1').sapProxy.count).toBe(1);
  });

  it('incrementa count en cada request dentro de la ventana', async () => {
    const fbDb = makeFakeFbDb();
    const deps = { fbDb, now: () => new Date('2026-09-14T20:00:00Z') };
    for (let i = 1; i <= 5; i++) {
      const r = await checkAndIncrementRateLimit(deps, 'u1', 'sapProxy', 10, 60 * 1000);
      expect(r.allowed).toBe(true);
      expect(r.count).toBe(i);
    }
  });

  it('CRIT: request 11 con threshold=10 → allowed=false + count NO incrementa (evita self-DoS)', async () => {
    const fbDb = makeFakeFbDb();
    const deps = { fbDb, now: () => new Date('2026-09-14T20:00:00Z') };
    // Fill al threshold
    for (let i = 0; i < 10; i++) {
      await checkAndIncrementRateLimit(deps, 'u1', 'sapProxy', 10, 60 * 1000);
    }
    const r = await checkAndIncrementRateLimit(deps, 'u1', 'sapProxy', 10, 60 * 1000);
    expect(r.allowed).toBe(false);
    expect(r.count).toBe(10); // NO incrementa
    expect(r.resetAt).toBeDefined();
  });

  it('reset de contador cuando pasa la ventana', async () => {
    const fbDb = makeFakeFbDb();
    // t0: 5 requests
    for (let i = 0; i < 5; i++) {
      await checkAndIncrementRateLimit(
        { fbDb, now: () => new Date('2026-09-14T20:00:00Z') },
        'u1',
        'sapProxy',
        10,
        60 * 1000
      );
    }
    // t0 + 90s (past window): request 6 debe resetear
    const r = await checkAndIncrementRateLimit(
      { fbDb, now: () => new Date('2026-09-14T20:01:30Z') },
      'u1',
      'sapProxy',
      10,
      60 * 1000
    );
    expect(r.allowed).toBe(true);
    expect(r.count).toBe(1); // reseteado
  });

  it('ops distintas del mismo user son contadores independientes', async () => {
    const fbDb = makeFakeFbDb();
    const deps = { fbDb, now: () => new Date('2026-09-14T20:00:00Z') };
    // Fill sapProxy al threshold
    for (let i = 0; i < 10; i++) {
      await checkAndIncrementRateLimit(deps, 'u1', 'sapProxy', 10, 60 * 1000);
    }
    const r1 = await checkAndIncrementRateLimit(deps, 'u1', 'sapProxy', 10, 60 * 1000);
    expect(r1.allowed).toBe(false);
    // geminiOcr sigue disponible
    const r2 = await checkAndIncrementRateLimit(deps, 'u1', 'geminiOcrProxy', 5, 60 * 1000);
    expect(r2.allowed).toBe(true);
    expect(r2.count).toBe(1);
  });

  it('users distintos son contadores independientes', async () => {
    const fbDb = makeFakeFbDb();
    const deps = { fbDb, now: () => new Date('2026-09-14T20:00:00Z') };
    for (let i = 0; i < 10; i++) {
      await checkAndIncrementRateLimit(deps, 'u1', 'sapProxy', 10, 60 * 1000);
    }
    const r = await checkAndIncrementRateLimit(deps, 'u2', 'sapProxy', 10, 60 * 1000);
    expect(r.allowed).toBe(true);
    expect(r.count).toBe(1);
  });

  it('sin uid → error (invariante API)', async () => {
    const fbDb = makeFakeFbDb();
    await expect(
      checkAndIncrementRateLimit({ fbDb }, '', 'sapProxy', 10, 60 * 1000)
    ).rejects.toThrow(/uid requerido/);
  });

  it('sin opName → error', async () => {
    const fbDb = makeFakeFbDb();
    await expect(checkAndIncrementRateLimit({ fbDb }, 'u1', '', 10, 60 * 1000)).rejects.toThrow(
      /opName requerido/
    );
  });

  it('log callback recibe hit event con detalles', async () => {
    const fbDb = makeFakeFbDb();
    const logs = [];
    const deps = {
      fbDb,
      now: () => new Date('2026-09-14T20:00:00Z'),
      log: (msg, extra) => logs.push({ msg, extra }),
    };
    for (let i = 0; i < 3; i++) {
      await checkAndIncrementRateLimit(deps, 'u1', 'sapProxy', 3, 60 * 1000);
    }
    // request 4 hit
    await checkAndIncrementRateLimit(deps, 'u1', 'sapProxy', 3, 60 * 1000);
    const hit = logs.find((l) => l.msg === 'rate-limit HIT');
    expect(hit).toBeDefined();
    expect(hit.extra.uid).toBe('u1');
    expect(hit.extra.opName).toBe('sapProxy');
  });
});

describe('RATE_LIMITS defaults', () => {
  it('sapProxy: 5000/hr (v940 hotfix — bump desde 300 por service_layer_auto batching)', () => {
    expect(RATE_LIMITS.sapProxy.threshold).toBe(5000);
    expect(RATE_LIMITS.sapProxy.windowMs).toBe(60 * 60 * 1000);
  });
  it('geminiOcrProxy: 100/hr (mas conservador — cada req consume tokens Gemini pagos)', () => {
    expect(RATE_LIMITS.geminiOcrProxy.threshold).toBe(100);
    expect(RATE_LIMITS.geminiOcrProxy.windowMs).toBe(60 * 60 * 1000);
  });

  // SEC-M11/M12/M13 (2026-11-19) — presets BQ + SL + reporte Excel.
  it('SEC-M11 dashboardVentasCF: 60/hr (BQ lectura dashboard)', () => {
    expect(RATE_LIMITS.dashboardVentasCF.threshold).toBe(60);
    expect(RATE_LIMITS.dashboardVentasCF.windowMs).toBe(60 * 60 * 1000);
  });
  it('SEC-M11 pedidosDelMesCF: 120/hr (BQ lectura pedidos mes, uso mas frecuente)', () => {
    expect(RATE_LIMITS.pedidosDelMesCF.threshold).toBe(120);
    expect(RATE_LIMITS.pedidosDelMesCF.windowMs).toBe(60 * 60 * 1000);
  });
  it('SEC-M12 generateVentasReportCF: 10/day (1GiB memoria + BQ scan completo)', () => {
    expect(RATE_LIMITS.generateVentasReportCF.threshold).toBe(10);
    expect(RATE_LIMITS.generateVentasReportCF.windowMs).toBe(24 * 60 * 60 * 1000);
  });
  it('SEC-M13 closeSqsManuallyCF: 20/hr (SAP SL login/logout, pooled sessions)', () => {
    expect(RATE_LIMITS.closeSqsManuallyCF.threshold).toBe(20);
    expect(RATE_LIMITS.closeSqsManuallyCF.windowMs).toBe(60 * 60 * 1000);
  });
});

describe('SEC-M11/M12/M13 wrapper integration (grep contract)', () => {
  it('functions/index.js invoca checkAndIncrementRateLimit para las 4 CFs', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('functions/index.js', 'utf8');
    for (const cf of [
      'dashboardVentasCF',
      'pedidosDelMesCF',
      'closeSqsManuallyCF',
      'generateVentasReportCF',
    ]) {
      // Buscar el string `RATE_LIMITS.<cf>` que indica integración del preset.
      const re = new RegExp(`RATE_LIMITS\\.${cf}\\.threshold`);
      expect(src, `${cf} debe usar RATE_LIMITS.${cf}`).toMatch(re);
    }
  });

  it('las 4 CFs lanzan HttpsError resource-exhausted cuando el limit se alcanza', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('functions/index.js', 'utf8');
    // Contar ocurrencias de HttpsError resource-exhausted + Rate limit alcanzado.
    const matches =
      src.match(/HttpsError\(\s*'resource-exhausted'[^)]*Rate limit alcanzado/g) || [];
    expect(matches.length).toBeGreaterThanOrEqual(4);
  });
});
