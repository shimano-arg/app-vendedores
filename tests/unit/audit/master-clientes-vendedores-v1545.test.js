// v1545: Master Clientes para vendedor/interno (solo lectura, sus clientes) +
// Backorder habilitado para PACHI en el panel izquierdo. Tests de contrato.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  PACHI_BLOCKED_OPEN_FNS,
  PACHI_HIDDEN_SIDEBAR_LEFT_BTN_IDS,
} from '../../../src/pure/pachi-restrictions.js';

const HTML = readFileSync('index.html', 'utf8');
const MC = readFileSync('src/domains/master-clientes.js', 'utf8');

describe('v1545 — Master Clientes para vendedores', () => {
  it('botón y drawer visibles para admin, gerente, vendedor e interno', () => {
    expect(HTML).toMatch(
      /getElementById\('master-cli-btn'\)\.style\.display =\s*\n\s*\['admin','gerente','vendedor','interno'\]\.indexOf\(userRole\) >= 0/
    );
    expect(HTML).toMatch(
      /_setDrawer\('mastercli', \['admin','gerente','vendedor','interno'\]\.indexOf\(userRole\) >= 0\)/
    );
  });

  it('openMasterClientesPanel usa el alcance y marca solo lectura', () => {
    const i = MC.indexOf('window.openMasterClientesPanel = function');
    const body = MC.slice(i, i + 3000);
    expect(body).toMatch(/_mcScope\(\)/);
    expect(body).toMatch(/if \(!_scope\.canOpen\)/);
    expect(body).toMatch(/classList\.toggle\('mc-solo-lectura', _scope\.readOnly\)/);
    expect(body).toMatch(/vSel\.disabled = true/);
  });

  it('tabla principal y provisorios filtran por el alcance', () => {
    expect(MC).toMatch(
      /let entries = _mcScope\(\)\.filter\(getAllStoreEntries\(\), \(e\) => e\.vendor\)/
    );
    expect(MC).toMatch(/let items = _mcScope\(\)\.filter\(getProvisoriosList\(\)/);
  });

  it('solo lectura: campos deshabilitados y acciones ocultas', () => {
    expect((MC.match(/_mcApplySoloLectura\(cont\);/g) || []).length).toBe(2);
    for (const sel of [
      '#mc-reasignar-zonas-btn',
      '#mc-sync-sap-btn',
      '#mc-body .mc-save-btn',
      '#mc-body button[onclick^="deleteMcEntry"]',
    ]) {
      expect(HTML).toContain('#master-cli-modal.mc-solo-lectura ' + sel);
    }
  });

  it('guardar y eliminar rechazan a vendedor/interno', () => {
    const i = MC.indexOf('window.saveMcAddr = async function');
    expect(MC.slice(i, i + 200)).toMatch(/userRole !== 'admin' && userRole !== 'gerente'/);
    const j = MC.indexOf('window.deleteMcEntry = async function');
    expect(MC.slice(j, j + 600)).toMatch(/if \(_mcScope\(\)\.readOnly\)/);
  });

  it('versión v1545 en sync con el SW', () => {
    expect(HTML).toMatch(/const APP_VERSION = 'v1545'/);
    expect(readFileSync('sw.js', 'utf8')).toMatch(/const CACHE_VERSION = 'v1545'/);
  });
});

describe('v1545 — PACHI entra a Backorder', () => {
  it('Backorder ya no está bloqueado; Stock Asignado sí', () => {
    expect(PACHI_HIDDEN_SIDEBAR_LEFT_BTN_IDS).not.toContain('backorders-btn');
    expect(PACHI_BLOCKED_OPEN_FNS).not.toContain('openBackordersModal');
    expect(PACHI_HIDDEN_SIDEBAR_LEFT_BTN_IDS).toContain('asignacion-backorder-btn');
    expect(PACHI_BLOCKED_OPEN_FNS).toContain('openAsignacionBackorderModal');
  });
});
