// @ts-check
/**
 * v1481 §81 (2026-10-27) — PACHI iter 3: pure fn fuente única del
 * sidebar-left panel + guards de open*Modal.
 *
 * Mariano reportó v1478 (#1242) ocultó botones del header pero los PROXIES
 * del panel izquierdo del mapa (`#sidebar-left-buttons`) seguían visibles.
 * Causa: `syncVisibility` del proxy mira `orig.style.display` (inline);
 * los CSS gates `body.is-pachi-restricted #X{display:none !important}`
 * no setean inline → el proxy no se oculta.
 *
 * Fix: lista única en `src/pure/pachi-restrictions.js`:
 *   - `PACHI_HIDDEN_SIDEBAR_LEFT_BTN_IDS` (6 IDs).
 *   - `PACHI_BLOCKED_OPEN_FNS` (7 funciones globales).
 *   - `isSidebarLeftBtnHiddenForPachi(id)` helper.
 * El renderer `_moveButtonsToSidebarLeft` consulta la lista + skip-create.
 * El login installer envuelve las open*Modal con `pachiGuard`.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  isPachiRestricted,
  isSidebarLeftBtnHiddenForPachi,
  PACHI_BLOCKED_OPEN_FNS,
  PACHI_HIDDEN_SIDEBAR_LEFT_BTN_IDS,
  PACHI_UIDS,
} from '../../../src/pure/pachi-restrictions.js';

const INDEX_HTML = readFileSync('index.html', 'utf8');
const MAIN_JS = readFileSync('src/main.js', 'utf8');

describe('v1481 §81 — pure fn PACHI_HIDDEN_SIDEBAR_LEFT_BTN_IDS', () => {
  it('T1 lista contiene exactamente los 6 IDs del reporte Mariano', () => {
    expect(PACHI_HIDDEN_SIDEBAR_LEFT_BTN_IDS).toBeDefined();
    expect(Array.isArray(PACHI_HIDDEN_SIDEBAR_LEFT_BTN_IDS)).toBe(true);
    expect(PACHI_HIDDEN_SIDEBAR_LEFT_BTN_IDS.length).toBe(6);
    const expected = [
      'seguimiento-btn',
      'backorders-btn',
      'asignacion-backorder-btn',
      'forecast-btn',
      'revision-btn',
      'waitlist-btn',
    ];
    for (const id of expected) {
      expect(
        PACHI_HIDDEN_SIDEBAR_LEFT_BTN_IDS.includes(id),
        `${id} debe estar en la lista oculta`
      ).toBe(true);
    }
  });

  it('T2 lista está frozen (inmutable)', () => {
    expect(Object.isFrozen(PACHI_HIDDEN_SIDEBAR_LEFT_BTN_IDS)).toBe(true);
  });

  it('T3 Campañas, Dashboard y Exportar NO están en la lista oculta', () => {
    const notHidden = ['mis-camps-btn', 'dashboard-btn', 'export-btn-inferred', 'btn-export'];
    for (const id of notHidden) {
      expect(PACHI_HIDDEN_SIDEBAR_LEFT_BTN_IDS.includes(id)).toBe(false);
    }
  });

  it('T4 helper isSidebarLeftBtnHiddenForPachi retorna true para los 6 IDs', () => {
    for (const id of PACHI_HIDDEN_SIDEBAR_LEFT_BTN_IDS) {
      expect(isSidebarLeftBtnHiddenForPachi(id)).toBe(true);
    }
    expect(isSidebarLeftBtnHiddenForPachi('mis-camps-btn')).toBe(false);
    expect(isSidebarLeftBtnHiddenForPachi('dashboard-btn')).toBe(false);
    expect(isSidebarLeftBtnHiddenForPachi(null)).toBe(false);
    expect(isSidebarLeftBtnHiddenForPachi(undefined)).toBe(false);
    expect(isSidebarLeftBtnHiddenForPachi('')).toBe(false);
  });
});

describe('v1481 §81 — pure fn PACHI_BLOCKED_OPEN_FNS (defense-in-depth)', () => {
  it('T10 lista contiene las 7 funciones globales que PACHI no puede abrir', () => {
    expect(PACHI_BLOCKED_OPEN_FNS).toBeDefined();
    expect(Array.isArray(PACHI_BLOCKED_OPEN_FNS)).toBe(true);
    expect(PACHI_BLOCKED_OPEN_FNS.length).toBe(7);
    const expected = [
      'openBackordersModal',
      'openAsignacionBackorderModal',
      'openForecastModal',
      'openRepartoModal',
      'openDepositoModal',
      'openCarteraModal',
      'openSeguimientoModal',
    ];
    for (const fn of expected) {
      expect(PACHI_BLOCKED_OPEN_FNS.includes(fn), `${fn} debe estar bloqueado`).toBe(true);
    }
  });

  it('T11 lista está frozen', () => {
    expect(Object.isFrozen(PACHI_BLOCKED_OPEN_FNS)).toBe(true);
  });

  it('T12 ningún helper (open*Modal) permitido por error en la lista bloqueada', () => {
    const permitted = ['openMisCampsModal', 'openDashboard', 'openExportDialog'];
    for (const fn of permitted) {
      expect(PACHI_BLOCKED_OPEN_FNS.includes(fn)).toBe(false);
    }
  });
});

describe('v1481 §81 — PACHI_UIDS incluye user real + user de prueba', () => {
  it('T20 incluye UID real + test', () => {
    expect(PACHI_UIDS).toContain('LaBFi1xkSLObzLEdRoP8fonZ06r2'); // real
    expect(PACHI_UIDS).toContain('tUJHiLDyLHWvbkpWgCQXWJcucfV2'); // test
    expect(PACHI_UIDS.length).toBe(2);
  });

  it('T21 isPachiRestricted matchea ambos UIDs', () => {
    expect(isPachiRestricted('LaBFi1xkSLObzLEdRoP8fonZ06r2')).toBe(true);
    expect(isPachiRestricted('tUJHiLDyLHWvbkpWgCQXWJcucfV2')).toBe(true);
    expect(isPachiRestricted('otro-uid')).toBe(false);
    expect(isPachiRestricted(null)).toBe(false);
  });
});

describe('v1481 §81 — contrato index.html consulta la lista del pure', () => {
  it('T30 _moveButtonsToSidebarLeft usa PACHI_HIDDEN_SIDEBAR_LEFT_BTN_IDS + skip', () => {
    const idx = INDEX_HTML.indexOf('function _moveButtonsToSidebarLeft()');
    expect(idx).toBeGreaterThan(0);
    const slice = INDEX_HTML.slice(idx, idx + 3000);
    expect(slice).toMatch(/PACHI_HIDDEN_SIDEBAR_LEFT_BTN_IDS/);
    expect(slice).toMatch(/isPachiRestricted/);
    expect(slice).toMatch(/_pachiHiddenBtnIds1481\.indexOf\(id\) >= 0/);
  });

  it('T31 installer de wrappers open*Modal vive en el bloque login', () => {
    // El installer se corre dentro del toggle body.is-pachi-restricted.
    const idx = INDEX_HTML.indexOf(
      "document.body.classList.toggle('is-pachi-restricted', _isPachiByUid)"
    );
    expect(idx).toBeGreaterThan(0);
    const slice = INDEX_HTML.slice(idx, idx + 2500);
    expect(slice).toMatch(/PACHI_BLOCKED_OPEN_FNS/);
    expect(slice).toMatch(/__pachiWrapped1481/);
    expect(slice).toMatch(/pachiGuard\(_uid, \{ feature: _featureLabel \}\)/);
  });

  it('T32 _isVendor984 ya NO afecta a PACHI (excepción Dashboard)', () => {
    const idx = INDEX_HTML.indexOf('v984 (2026-09-17)');
    expect(idx).toBeGreaterThan(0);
    const slice = INDEX_HTML.slice(idx, idx + 2000);
    expect(slice).toMatch(/_isPachi984/);
    expect(slice).toMatch(/dashboard-btn/);
    // dashboard-btn se oculta sólo si vendedor && !PACHI.
    expect(slice).toMatch(/_isVendor984 && !_isPachi984/);
  });

  it('T33 main.js expone PACHI_HIDDEN_SIDEBAR_LEFT_BTN_IDS + PACHI_BLOCKED_OPEN_FNS', () => {
    expect(MAIN_JS).toMatch(/PACHI_HIDDEN_SIDEBAR_LEFT_BTN_IDS/);
    expect(MAIN_JS).toMatch(/PACHI_BLOCKED_OPEN_FNS/);
    expect(MAIN_JS).toMatch(/isSidebarLeftBtnHiddenForPachi/);
  });
});

describe('v1481 §81 — simulación renderer: PACHI SOLO Campañas + Dashboard + Exportar', () => {
  it('T40 filtra la lista `orden` del renderer eliminando los 6 IDs ocultos', () => {
    // Replica el array `orden` de _moveButtonsToSidebarLeft (v1481) y aplica
    // el filtro §81. El resultado debe ser exactamente Campañas + Dashboard + Exportar.
    const orden = [
      { id: 'mis-camps-btn', label: 'Campañas' },
      { id: 'dashboard-btn', label: 'Dashboard' },
      { id: 'seguimiento-btn', label: 'Seguimiento' },
      { id: 'export-btn-inferred', label: 'Exportar' },
      { id: 'backorders-btn', label: 'Backorder' },
      { id: 'asignacion-backorder-btn', label: 'Stock Asig.' },
      { id: 'forecast-btn', label: 'Forecast' },
      { id: 'revision-btn', label: 'Reparto' },
      { id: 'waitlist-btn', label: 'Depósito' },
    ];
    const filtered = orden.filter((b) => !PACHI_HIDDEN_SIDEBAR_LEFT_BTN_IDS.includes(b.id));
    const labels = filtered.map((b) => b.label);
    expect(labels).toEqual(['Campañas', 'Dashboard', 'Exportar']);
  });
});

describe('v1481 — bump de versión', () => {
  it('T50 APP_VERSION >= v1481 y en sync con SW', () => {
    const m = INDEX_HTML.match(/const APP_VERSION = 'v(\d+)'/);
    expect(m, 'APP_VERSION no encontrada').not.toBeNull();
    expect(Number(m[1])).toBeGreaterThanOrEqual(1481);
    const sw = readFileSync('sw.js', 'utf8').match(/const CACHE_VERSION = 'v(\d+)'/);
    expect(sw[1]).toBe(m[1]);
  });
});
