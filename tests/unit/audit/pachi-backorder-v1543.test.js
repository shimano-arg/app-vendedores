// @ts-check
/**
 * v1543 (2026-11-02): PACHI puede mirar y exportar Backorder (solo lectura).
 * Tests de contrato grep sobre index.html + exports-core.js.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const HTML = readFileSync('index.html', 'utf8');
const EXPORTS = readFileSync('src/domains/exports-core.js', 'utf8');

describe('v1543 — PACHI ve Backorder en solo lectura', () => {
  it('applyRolePermissions muestra #backorders-btn a admin o PACHI', () => {
    expect(HTML).toMatch(
      /bkBtn\.style\.display = \(userRole === 'admin' \|\| _isPachi1543\) \? '' : 'none'/
    );
    expect(HTML).toMatch(/_isPachi1543 = [\s\S]{0,200}isPachiRestricted\(currentUser\.uid\)/);
  });

  it('Stock Asignado sigue oculto para PACHI', () => {
    expect(HTML).toMatch(
      /body\.is-pachi-restricted #asignacion-backorder-btn\{display:none !important\}/
    );
    expect(HTML).toMatch(/asigBkBtn\.style\.display = \(userRole === 'admin'\) \? '' : 'none'/);
  });

  it('acciones del modal siguen desactivadas; Exportar y Gráficos habilitados', () => {
    expect(HTML).toMatch(
      /body\.is-pachi-restricted #backorders-modal button\.bo-btn:not\(\.bo-btn-cancel\):not\(\.bo-btn-close\):not\(#btn-export-stock-asig\):not\(#btn-backorders-graficos\),\s*\nbody\.is-pachi-restricted #backorders-modal input\[type="checkbox"\]:not\(\.bo-read-only-checkbox\),\s*\nbody\.is-pachi-restricted #btn-crear-pedido-st\{pointer-events:none !important;opacity:0\.5 !important\}/
    );
  });

  it('Reportes Excel: BACKORDER permitido para PACHI', () => {
    expect(HTML).toMatch(/:not\(\[data-exp-kind="BACKORDER"\]\)\{display:none !important\}/);
    expect(HTML).toMatch(/_pachiAllowedKinds = new Set\(\[[^\]]*'BACKORDER'/);
    expect(EXPORTS).toMatch(/allowed = new Set\(\[\.\.\.allowed, 'PRECIOS_STOCK', 'BACKORDER'\]\)/);
  });

  it('el export de Backorder del menú Reportes filtra por alcance del usuario', () => {
    const i = EXPORTS.indexOf('window.exportBackorderAll = async function');
    expect(i).toBeGreaterThan(0);
    expect(EXPORTS.slice(i, i + 800)).toMatch(/_exportScope\(\)\.filterPedidos\(/);
  });

  it('el listener de pedidos del vendedor sigue filtrado por assignedVendorUid', () => {
    expect(HTML).toMatch(
      /'pedidos_all',\s*\n\s*\(\) => \(userRole === 'vendedor'\)\s*\n\s*\? fbDb\.collection\('pedidos'\)\.where\('assignedVendorUid', '==', currentUser\.uid\)/
    );
  });
});
