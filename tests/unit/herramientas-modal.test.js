import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const HTML = readFileSync(join(process.cwd(), 'index.html'), 'utf8');

describe('Botón Herramientas consolidado', () => {
  it('existe .btn-herramientas con onclick openHerramientasModal', () => {
    expect(HTML).toMatch(/<button[^>]*class="btn-herramientas"[^>]*onclick="openHerramientasModal\(\)"/);
  });

  it('modal #herramientas-modal existe', () => {
    expect(HTML).toContain('id="herramientas-modal"');
  });

  it('modal tiene 3 tarjetas con data-herr-action', () => {
    const actions = ['camps', 'export', 'rendiciones'];
    for (const a of actions) {
      expect(HTML).toMatch(new RegExp(`data-herr-action="${a}"`));
    }
  });

  it('handlers del inline JS existen', () => {
    expect(HTML).toContain('function openHerramientasModal');
    expect(HTML).toContain('function closeHerramientasModal');
  });

  it('botón #mis-camps-btn viejo fue eliminado', () => {
    expect(HTML).not.toContain('id="mis-camps-btn"');
  });

  it('botón Exportar a Excel viejo fue eliminado del top toolbar', () => {
    expect(HTML).not.toMatch(/<button[^>]*class="btn-export"[^>]*onclick="_safeOpenExportFormatModal\(\)"/);
  });

  it('tab Rendiciones fue removida del top toolbar', () => {
    expect(HTML).not.toMatch(/<button[^>]*data-tab="rendiciones"[^>]*onclick="setTab\('rendiciones'\)"/);
  });

  it('applyRolePermissions gate la card Campañas Activas', () => {
    const applyFnMatch = HTML.match(/function applyRolePermissions[\s\S]{0,6000}/);
    expect(applyFnMatch).toBeTruthy();
    expect(applyFnMatch[0]).toMatch(/data-herr-action="camps"|herr-card-camps/);
  });

  it('MutationObserver wire para dot está presente', () => {
    expect(HTML).toContain('rd-sub-count-mias');
    expect(HTML).toMatch(/MutationObserver[\s\S]{0,400}syncFromSource|_wireHerramientasDot/);
  });
});
