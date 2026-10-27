// @ts-check
/**
 * v1478 §PACHI iter 2 (2026-10-27) — tests de contrato grep.
 *
 * Mariano pidió 3 cosas para el usuario PACHI:
 *   1. Ocultar 8 botones del header (6 nuevos + 2 heredados).
 *   2. En modal Reportes Excel dejar solo "Pedidos del mes" + "Masterfile Clientes".
 *   3. En Campañas: ver TODAS las campañas activas (cross-zona), sin métricas
 *      de progreso ("cómo van").
 *
 * Estos tests son grep del contrato: validan que las reglas CSS y los guards
 * JS están presentes. No simulan runtime; eso lo cubren los e2e en
 * tests/e2e/pachi.spec.js.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const INDEX_HTML = readFileSync('index.html', 'utf8');

describe('v1478 §PACHI iter 2 — CSS gates nuevos', () => {
  it('oculta #backorders-btn entero (reemplaza pointer-events v1460)', () => {
    expect(INDEX_HTML).toMatch(
      /body\.is-pachi-restricted #backorders-btn[\s\S]*?display:none !important/
    );
  });

  it('oculta #deposito-home-btn', () => {
    expect(INDEX_HTML).toMatch(/body\.is-pachi-restricted[^{]*#deposito-home-btn/);
  });

  it('oculta #revision-btn (botón Reparto)', () => {
    expect(INDEX_HTML).toMatch(/body\.is-pachi-restricted[^{]*#revision-btn/);
  });

  it('oculta #forecast-btn (defensa; ya oculto por whitelist admin)', () => {
    expect(INDEX_HTML).toMatch(/body\.is-pachi-restricted[^{]*#forecast-btn/);
  });

  it('oculta #rendiciones-top-btn + tab Rendiciones del sidebar', () => {
    expect(INDEX_HTML).toMatch(/body\.is-pachi-restricted[^{]*#rendiciones-top-btn/);
    expect(INDEX_HTML).toMatch(/body\.is-pachi-restricted \.tab-btn\[data-tab="rendiciones"\]/);
  });

  it('oculta #seguimiento-btn (botón Cartera; defensa)', () => {
    expect(INDEX_HTML).toMatch(/body\.is-pachi-restricted[^{]*#seguimiento-btn/);
  });
});

describe('v1478 §PACHI iter 2 — modal Reportes Excel', () => {
  it('oculta todas las .exp-opt del modal excepto PEDIDOS_MES y MASTER', () => {
    expect(INDEX_HTML).toMatch(
      /body\.is-pachi-restricted #export-modal \.exp-opt:not\(\[data-exp-kind="PEDIDOS_MES"\]\):not\(\[data-exp-kind="MASTER"\]\)\{display:none !important\}/
    );
  });

  it('las 2 opciones permitidas siguen en el DOM del modal', () => {
    expect(INDEX_HTML).toMatch(/data-exp-kind="PEDIDOS_MES"/);
    expect(INDEX_HTML).toMatch(/data-exp-kind="MASTER"/);
  });
});

describe('v1478 §PACHI iter 2 — campañas', () => {
  it('oculta #mc-graficos-btn (métricas de progreso)', () => {
    expect(INDEX_HTML).toMatch(
      /body\.is-pachi-restricted #mc-graficos-btn\{display:none !important\}/
    );
  });

  it('renderMisCamps saltea el filtro por zona (isVend) para PACHI', () => {
    // El filtro `if (isVend) activeList.filter(isCampaignApplicableToVendor)`
    // se desactiva porque isVend ahora incluye `&& !_isPachi1478`.
    const idx = INDEX_HTML.indexOf('function renderMisCamps()');
    expect(idx).toBeGreaterThan(0);
    const slice = INDEX_HTML.slice(idx, idx + 2500);
    expect(slice).toMatch(/_isPachi1478/);
    expect(slice).toMatch(
      /const isVend = \(userRole === 'vendedor' && assignedVendor && !_isPachi1478\)/
    );
  });

  it('_misCampsGraficosData también saltea el filtro para PACHI (defensa)', () => {
    const idx = INDEX_HTML.indexOf('function _misCampsGraficosData()');
    expect(idx).toBeGreaterThan(0);
    const slice = INDEX_HTML.slice(idx, idx + 1500);
    expect(slice).toMatch(/_isPachi1478g/);
    expect(slice).toMatch(
      /const isVend = \(userRole === 'vendedor' && assignedVendor && !_isPachi1478g\)/
    );
  });
});

describe('v1478 §PACHI iter 2 — restricciones heredadas de v1460 se preservan', () => {
  it('v1460 #asignacion-backorder-btn + #sap-btn + #visita-choice-clasica siguen ocultos', () => {
    expect(INDEX_HTML).toMatch(
      /body\.is-pachi-restricted #asignacion-backorder-btn\{display:none !important\}/
    );
    expect(INDEX_HTML).toMatch(/body\.is-pachi-restricted #sap-btn\{display:none !important\}/);
    expect(INDEX_HTML).toMatch(
      /body\.is-pachi-restricted #visita-choice-clasica\{display:none !important\}/
    );
  });

  it('v1460 tab Notificaciones oculto se preserva', () => {
    expect(INDEX_HTML).toMatch(/body\.is-pachi-restricted #tab-notif/);
    expect(INDEX_HTML).toMatch(/body\.is-pachi-restricted #pane-notif/);
  });

  it('v1460 toggle body.is-pachi-restricted al login sigue intacto', () => {
    expect(INDEX_HTML).toMatch(
      /document\.body\.classList\.toggle\('is-pachi-restricted', _isPachiByUid\)/
    );
  });
});

describe('v1478 — bump de versión', () => {
  it('APP_VERSION es v1478', () => {
    expect(INDEX_HTML).toMatch(/const APP_VERSION = 'v1478'/);
  });

  it('CACHE_VERSION del SW es v1478', () => {
    const sw = readFileSync('sw.js', 'utf8');
    expect(sw).toMatch(/const CACHE_VERSION = 'v1478'/);
  });
});
