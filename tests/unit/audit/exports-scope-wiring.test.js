// v1534 (2026-11-02) — contrato: las exportaciones del modal "Reportes Excel"
// pasan por el alcance único de src/pure/export-scope.js (auditoría 46, Etapa 1).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const core = readFileSync(join(ROOT, 'src/domains/exports-core.js'), 'utf8');
const main = readFileSync(join(ROOT, 'src/main.js'), 'utf8');

/**
 * Cuerpo aproximado de una función: desde su declaración hasta la siguiente.
 * @param {string} decl
 */
function bodyOf(decl) {
  const i = core.indexOf(decl);
  expect(i, decl).toBeGreaterThan(-1);
  const rest = core.slice(i + decl.length);
  const next = rest.search(/\n(?:async function |function |window\.\w+ = )/);
  return next === -1 ? rest : rest.slice(0, next);
}

describe('exports-core usa el alcance por rol', () => {
  it('importa buildExportScope del pure', () => {
    expect(core).toMatch(
      /import\s*\{[^}]*buildExportScope[^}]*\}\s*from\s*'\.\.\/pure\/export-scope\.js'/
    );
  });
  it('el uid sale de Firebase Auth (no de userRole)', () => {
    expect(bodyOf('function _exportScope(')).toMatch(/firebase\.auth\(\)\.currentUser/);
  });
  it('_iteratePedidosMes filtra con el alcance (PEDIDOS_MES + variantes por mes)', () => {
    expect(bodyOf('function _iteratePedidosMes(')).toMatch(/filterPedidos\(/);
  });
  it('_iteratePedidosMes aplica el mes ANTES del alcance (menos resoluciones del master)', () => {
    const b = bodyOf('function _iteratePedidosMes(');
    expect(b.indexOf('_pedidoMonthYear')).toBeGreaterThan(-1);
    expect(b.indexOf('_pedidoMonthYear')).toBeLessThan(b.indexOf('filterPedidos('));
  });
  it('el resolver del alcance devuelve vendorKey + reason', () => {
    expect(bodyOf('function _exportScope(')).toMatch(/reason:/);
  });
  it('exportBackorderAll y exportStockAsigAll filtran con el alcance', () => {
    expect(bodyOf('window.exportBackorderAll = ')).toMatch(/filterPedidos\(/);
    expect(bodyOf('window.exportStockAsigAll = ')).toMatch(/filterPedidos\(/);
  });
  it('Pedidos del mes: columna Vendedor sale del master, no de ownerVendor', () => {
    const b = bodyOf('async function exportPedidosMesForMonth(');
    expect(b).toMatch(/Vendedor:\s*scope\.vendorColumnForPedido\(p\)/);
    expect(b).not.toMatch(/Vendedor:\s*p\.ownerVendor/);
  });
  it('Visitas: el vendedor consulta por ownerUid y se filtra por rol', () => {
    const b = bodyOf('async function exportVisitasForMonth(');
    expect(b).toMatch(/where\('ownerUid', '==', /);
    expect(b).toMatch(/filterVisits\(/);
  });
});

describe('main.js expone el pure', () => {
  it('window.__phase0.pure.exportScope', () => {
    expect(main).toMatch(/from '\.\/pure\/export-scope\.js'/);
    expect(main).toMatch(/exportScope:\s*\{/);
  });
});
