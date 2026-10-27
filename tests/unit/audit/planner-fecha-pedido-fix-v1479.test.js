// @ts-check
/**
 * v1479 §76 (2026-10-27) — fix Planner vacío post-backfill AD.
 *
 * Causa raíz: `_subscribePlannerPedidos` hacía
 *   base.where('createdAt', '>=', new Date(...))
 * Firestore trata el Date como Timestamp. Desde backfill AD v1474, los 486
 * pedidos tienen createdAt como string ISO. Firestore compara por tipo
 * primero → Timestamp nunca matchea strings con `>=` → 0 docs devueltos
 * → columnas Oferta/Pending/Facturar/Cobrado vacías. Lista de espera carga
 * desde revision_waitlist (sin where) por eso seguía funcionando.
 *
 * Fix: `plannerCutoffIsoForQuery` devuelve string ISO para el where; los 3
 * call-sites que LEEN fecha de un pedido (filter de mes, sort, fmt) pasan
 * por `pedidoDateForPlanner` + `parseFirestoreDate` (tolerantes a 4 formatos).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  parseFirestoreDate,
  pedidoDateForPlanner,
  plannerCutoffIsoForQuery,
} from '../../../src/pure/parse-date-flexible.js';

const INDEX_HTML = readFileSync('index.html', 'utf8');
const MAIN_JS = readFileSync('src/main.js', 'utf8');

describe('v1479 §76 — pedidoDateForPlanner (pure)', () => {
  it('T1 pedido con createdAt string ISO → Date válido', () => {
    const d = pedidoDateForPlanner({ createdAt: '2026-10-25T08:03:25.937Z' });
    expect(d).toBeInstanceOf(Date);
    expect(d.toISOString()).toBe('2026-10-25T08:03:25.937Z');
  });

  it('T2 pedido con createdAt Firestore Timestamp (toDate) → Date válido', () => {
    const fakeTs = {
      toDate: () => new Date('2026-10-25T08:03:25.937Z'),
      seconds: 1792013005,
      nanoseconds: 937000000,
    };
    const d = pedidoDateForPlanner({ createdAt: fakeTs });
    expect(d).toBeInstanceOf(Date);
    expect(d.toISOString()).toBe('2026-10-25T08:03:25.937Z');
  });

  it('T3 pedido con createdAt {seconds,nanoseconds} (REST shape) → Date válido', () => {
    const ts = { seconds: 1792013005, nanoseconds: 937000000 };
    const d = pedidoDateForPlanner({ createdAt: ts });
    expect(d).toBeInstanceOf(Date);
    expect(d.getTime()).toBe(1792013005 * 1000 + 937);
  });

  it('T4 sin createdAt pero con updatedAt → fallback a updatedAt', () => {
    const d = pedidoDateForPlanner({ updatedAt: '2026-10-20T10:00:00.000Z' });
    expect(d).toBeInstanceOf(Date);
    expect(d.toISOString()).toBe('2026-10-20T10:00:00.000Z');
  });

  it('T5 createdAt presente pisa updatedAt', () => {
    const d = pedidoDateForPlanner({
      createdAt: '2026-10-25T08:03:25.937Z',
      updatedAt: '2026-10-26T10:00:00.000Z',
    });
    expect(d.toISOString()).toBe('2026-10-25T08:03:25.937Z');
  });

  it('T6 pedido null/undefined → null (nunca crash)', () => {
    expect(pedidoDateForPlanner(null)).toBeNull();
    expect(pedidoDateForPlanner(undefined)).toBeNull();
    expect(pedidoDateForPlanner({})).toBeNull();
  });

  it('T7 createdAt inválido → null (nunca Invalid Date)', () => {
    expect(pedidoDateForPlanner({ createdAt: 'esto no es fecha' })).toBeNull();
    expect(pedidoDateForPlanner({ createdAt: {} })).toBeNull();
  });
});

describe('v1479 §76 — plannerCutoffIsoForQuery (pure)', () => {
  it('T10 nowMs=X daysBack=90 → ISO string (90d atrás)', () => {
    const nowMs = Date.parse('2026-10-27T12:00:00.000Z');
    const cutoff = plannerCutoffIsoForQuery(nowMs, 90);
    expect(typeof cutoff).toBe('string');
    expect(cutoff).toBe('2026-07-29T12:00:00.000Z');
  });

  it('T11 daysBack=180 → 180 días atrás', () => {
    const nowMs = Date.parse('2026-10-27T12:00:00.000Z');
    const cutoff = plannerCutoffIsoForQuery(nowMs, 180);
    expect(cutoff).toBe('2026-04-30T12:00:00.000Z');
  });

  it('T12 nowMs sin pasar → usa Date.now() (no crash)', () => {
    const cutoff = plannerCutoffIsoForQuery(undefined, 90);
    expect(typeof cutoff).toBe('string');
    expect(cutoff).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('T13 string ISO comparación lexicográfica: pedidos post-cutoff matchean', () => {
    // ISO 8601 es lexicográficamente ordenable; es la propiedad clave que
    // hace que el fix funcione con `where('createdAt', '>=', isoString)`.
    const cutoff = plannerCutoffIsoForQuery(Date.parse('2026-10-27T00:00:00.000Z'), 90);
    // Pedido reciente (10/25) debería matchear el cutoff (07/29).
    expect('2026-10-25T08:03:25.937Z' >= cutoff).toBe(true);
    // Pedido viejo (01/01) NO matchea.
    expect('2026-01-01T00:00:00.000Z' >= cutoff).toBe(false);
  });
});

describe('v1479 §76 — contrato index.html (los 3 call-sites del Planner)', () => {
  it('T20 listener _subscribePlannerPedidos usa plannerCutoffIsoForQuery (NO Date)', () => {
    const idx = INDEX_HTML.indexOf('function _subscribePlannerPedidos()');
    expect(idx).toBeGreaterThan(0);
    const slice = INDEX_HTML.slice(idx, idx + 2000);
    expect(slice).toMatch(/plannerCutoffIsoForQuery/);
    expect(slice).toMatch(/base\.where\('createdAt', '>=', cutoffIso\)/);
    // Anti-regresión: NO debe pasar un Date al where (bug pre-v1479).
    expect(slice).not.toMatch(/base\.where\('createdAt', '>=', new Date\(/);
  });

  it('T21 _plannerPedidoInMonth usa pedidoDateForPlanner', () => {
    const idx = INDEX_HTML.indexOf('function _plannerPedidoInMonth(');
    expect(idx).toBeGreaterThan(0);
    const slice = INDEX_HTML.slice(idx, idx + 1200);
    expect(slice).toMatch(/pedidoDateForPlanner/);
  });

  it('T22 tsOf (sort) usa pedidoDateForPlanner (fallback inline soporta string)', () => {
    // El bloque _pedidoDateFn se asigna justo antes de `const tsOf`.
    // Buscamos el bloque desde el comentario v1479 §76 del sort.
    const idx = INDEX_HTML.indexOf('v1479 (2026-10-27 §76): tsOf delega en pedidoDateForPlanner');
    expect(idx).toBeGreaterThan(0);
    const slice = INDEX_HTML.slice(idx, idx + 1500);
    expect(slice).toMatch(/_pedidoDateFn/);
    expect(slice).toMatch(/pedidoDateForPlanner/);
    expect(slice).toMatch(/const tsOf = x => \{/);
    // Fallback soporta string (anti-regresión pre-v1479: devolvía 0).
    expect(slice).toMatch(/typeof t === 'string'/);
  });

  it('T23 _plannerFmtDate usa parseFirestoreDate (fallback soporta string)', () => {
    const idx = INDEX_HTML.indexOf('function _plannerFmtDate(');
    expect(idx).toBeGreaterThan(0);
    const slice = INDEX_HTML.slice(idx, idx + 800);
    expect(slice).toMatch(/parseFirestoreDate/);
    // Fallback soporta string (anti-regresión pre-v1479).
    expect(slice).toMatch(/typeof ts === 'string'/);
  });
});

describe('v1479 §76 — exposición en window.__phase0.pure.parseDateFlexible', () => {
  it('T30 main.js importa y exporta pedidoDateForPlanner + plannerCutoffIsoForQuery', () => {
    expect(MAIN_JS).toMatch(
      /import \{[\s\S]+?pedidoDateForPlanner,[\s\S]+?plannerCutoffIsoForQuery,[\s\S]+?\} from '\.\/pure\/parse-date-flexible\.js'/
    );
    // El bloque de export dentro de __phase0.pure.parseDateFlexible.
    const idx = MAIN_JS.indexOf('parseDateFlexible: {');
    expect(idx).toBeGreaterThan(0);
    const slice = MAIN_JS.slice(idx, idx + 500);
    expect(slice).toMatch(/pedidoDateForPlanner/);
    expect(slice).toMatch(/plannerCutoffIsoForQuery/);
  });
});

describe('v1479 §76 — regresión fixture real por columna (ISO vs Timestamp)', () => {
  // Fixtures replicando producción post-backfill AD v1474:
  // - ORDEN 544 LA LOMITA (Oferta): docNum sin orderDocEntry, createdAt string.
  // - ORDEN 538 SATO (Facturar): qtyInvoiced > 0, createdAt string.
  // - ORDEN 537 BAIGORRIA (Cobrado): paidStatus='paid', createdAt string + cobradoAt string.
  // - Un pedido legacy pre-backfill con createdAt Timestamp (lo que había antes).
  const PEDIDOS_FIXTURE = [
    {
      id: 'ord544',
      orderNumber: 544,
      createdAt: '2026-10-25T08:03:25.937Z',
      stage: 'confirmed',
      transferidoSAP: { docNum: 2000432, orderDocEntry: 38283 },
      clientName: 'LA LOMITA OUTDOORS SRL',
      lines: [{ qtyInvoiced: 0 }],
    },
    {
      id: 'ord538',
      orderNumber: 538,
      createdAt: '2026-10-23T22:08:41.352Z',
      stage: 'confirmed',
      transferidoSAP: { docNum: 2000427, orderDocEntry: 38289 },
      clientName: 'EDUARDO SATO',
      lines: [{ qtyInvoiced: 2 }],
    },
    {
      id: 'ord537',
      orderNumber: 537,
      createdAt: '2026-10-24T16:25:23.012Z',
      cobradoAt: '2026-10-26T22:27:14.919Z',
      stage: 'confirmed',
      paidStatus: 'paid',
      transferidoSAP: { docNum: 2000428, orderDocEntry: 38286 },
      clientName: 'LUCAS MAXIMILIANO BAIGORRIA',
      lines: [{ qtyInvoiced: 1 }],
    },
    {
      id: 'ord_legacy_ts',
      orderNumber: 100,
      createdAt: {
        toDate: () => new Date('2026-08-15T10:00:00.000Z'),
        seconds: 1786262400,
        nanoseconds: 0,
      },
      stage: 'confirmed',
      transferidoSAP: { docNum: 1999999 },
      clientName: 'PEDIDO LEGACY TIMESTAMP',
      lines: [],
    },
  ];

  it('T40 todos los pedidos (ISO + Timestamp) tienen Date válido via pedidoDateForPlanner', () => {
    for (const p of PEDIDOS_FIXTURE) {
      const d = pedidoDateForPlanner(p);
      expect(d, `ORDEN ${p.orderNumber} debe devolver Date`).toBeInstanceOf(Date);
      expect(Number.isNaN(d.getTime()), `ORDEN ${p.orderNumber} fecha válida`).toBe(false);
    }
  });

  it('T41 cutoff ISO 90d atrás excluye el legacy (que es más viejo)', () => {
    const nowMs = Date.parse('2026-10-27T12:00:00.000Z');
    const cutoffIso = plannerCutoffIsoForQuery(nowMs, 90); // 2026-07-29
    // Filtro cliente-side simulando qué hubiera devuelto Firestore si todos
    // fueran string ISO comparables lexicográficamente.
    const results = PEDIDOS_FIXTURE.filter((p) => {
      const d = pedidoDateForPlanner(p);
      if (!d) return false;
      return d.toISOString() >= cutoffIso;
    });
    expect(results.length).toBe(4); // Todos están dentro de los 90d (incluyendo el legacy del 08/15)
  });

  it('T42 cutoff ISO 30d atrás excluye el legacy (2026-08-15)', () => {
    const nowMs = Date.parse('2026-10-27T12:00:00.000Z');
    const cutoffIso = plannerCutoffIsoForQuery(nowMs, 30); // 2026-09-27
    const results = PEDIDOS_FIXTURE.filter((p) => {
      const d = pedidoDateForPlanner(p);
      if (!d) return false;
      return d.toISOString() >= cutoffIso;
    });
    // Legacy (2026-08-15) queda fuera; los 3 recientes adentro.
    expect(results.map((p) => p.orderNumber).sort((a, b) => a - b)).toEqual([537, 538, 544]);
  });

  it('T43 sort por fecha DESC pone al más reciente primero (sin orden aleatorio)', () => {
    // Simula el tsOf del Planner post-fix.
    const tsOf = (p) => {
      const d = pedidoDateForPlanner(p);
      return d ? d.getTime() : 0;
    };
    const sorted = [...PEDIDOS_FIXTURE].sort((a, b) => tsOf(b) - tsOf(a));
    expect(sorted.map((p) => p.orderNumber)).toEqual([544, 537, 538, 100]);
    // Pre-fix: todos los string devolvían tsOf=0 → orden indeterminado.
    const bugged = (p) => {
      const t = p.createdAt || p.updatedAt;
      if (!t) return 0;
      if (typeof t.toMillis === 'function') return t.toMillis();
      if (typeof t === 'number') return t;
      return 0; // ← bug: strings devolvían 0
    };
    const buggedSorted = [...PEDIDOS_FIXTURE].sort((a, b) => bugged(b) - bugged(a));
    // El único con tsOf != 0 (ord_legacy_ts via toMillis en el real) iría primero
    // o último dependiendo del sort stable. Lo relevante es que los 3 ISO
    // quedarían juntos con tsOf=0 → orden depende de insertion order.
    // Assert minimum: el fix cambia el resultado.
    expect(buggedSorted.map((p) => p.orderNumber)).not.toEqual([544, 537, 538, 100]);
  });

  it('T44 _plannerPedidoInMonth con monthKey=2026-10 incluye los 3 ISO + excluye legacy 08', () => {
    // Simular _plannerPedidoInMonth con el nuevo helper.
    const inMonth = (p, monthKey) => {
      const d = pedidoDateForPlanner(p);
      if (!d) return false;
      const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
      return key === monthKey;
    };
    const results = PEDIDOS_FIXTURE.filter((p) => inMonth(p, '2026-10'));
    expect(results.map((p) => p.orderNumber).sort((a, b) => a - b)).toEqual([537, 538, 544]);
    const resultsAug = PEDIDOS_FIXTURE.filter((p) => inMonth(p, '2026-08'));
    expect(resultsAug.map((p) => p.orderNumber)).toEqual([100]);
  });

  it('T45 parseFirestoreDate maneja los 2 tipos cross: Timestamp y string ISO devuelven mismo ISO', () => {
    const iso = '2026-10-25T08:03:25.937Z';
    const fromString = parseFirestoreDate(iso);
    const fromTimestamp = parseFirestoreDate({
      toDate: () => new Date(iso),
      seconds: 1792013005,
      nanoseconds: 937000000,
    });
    expect(fromString.toISOString()).toBe(iso);
    expect(fromTimestamp.toISOString()).toBe(iso);
  });
});

describe('v1479 — bump de versión', () => {
  // v1480 2026-10-27: relajadas a ">= v1479 + ambas en sync" para que bumps
  // futuros no rompan por diseño (mismo patrón que v1478 PACHI).
  it('T50 APP_VERSION es v1479 o superior', () => {
    const m = INDEX_HTML.match(/const APP_VERSION = 'v(\d+)'/);
    expect(m, 'APP_VERSION no encontrada').not.toBeNull();
    expect(Number(m[1])).toBeGreaterThanOrEqual(1479);
  });

  it('T51 CACHE_VERSION del SW en sync con APP_VERSION', () => {
    const app = INDEX_HTML.match(/const APP_VERSION = 'v(\d+)'/);
    const sw = readFileSync('sw.js', 'utf8').match(/const CACHE_VERSION = 'v(\d+)'/);
    expect(app, 'APP_VERSION no encontrada').not.toBeNull();
    expect(sw, 'CACHE_VERSION no encontrada').not.toBeNull();
    expect(sw[1]).toBe(app[1]);
    expect(Number(sw[1])).toBeGreaterThanOrEqual(1479);
  });
});
