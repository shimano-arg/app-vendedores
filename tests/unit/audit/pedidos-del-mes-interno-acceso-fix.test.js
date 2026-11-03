// Fix P0 (2026-11-03): el gate de apertura del modal «Pedidos del mes»
// (openPedidosDelMes en src/domains/pedidos-del-mes.js) había quedado sin
// incluir el rol `interno` (VDI: Santiago, Ioannis), aunque v1552 ya habilitó
// el botón (index.html _pdmOk) y el backend (resolveAlcance) para interno.
// Resultado: el botón aparecía pero el clic rechazaba a los VDI antes de llegar
// al servidor. Este test fija que el gate del modal coincide con el del botón.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const PDM = readFileSync('src/domains/pedidos-del-mes.js', 'utf8');
const HTML = readFileSync('index.html', 'utf8');

describe('Fix P0 — acceso de interno (VDI) a Pedidos del mes', () => {
  it('openPedidosDelMes habilita a interno (el gate ya NO lo excluye)', () => {
    // El gate de rechazo no debe quedar como admin/gerente/vendedor sin interno.
    expect(PDM).not.toMatch(/role !== 'admin' && role !== 'gerente' && role !== 'vendedor'\)\s*\{/);
    // Debe contemplar interno en la condición de rechazo.
    expect(PDM).toMatch(
      /role !== 'admin' && role !== 'gerente' && role !== 'vendedor' && role !== 'interno'/
    );
  });

  it('el gate del modal y el gate del botón coinciden en los 4 roles', () => {
    // Botón (index.html): _pdmOk incluye admin/gerente/vendedor/interno.
    expect(HTML).toMatch(/_pdmOk = [^;]*userRole === 'interno';/);
    // Modal: los mismos 4 roles pasan el gate.
    for (const r of ['admin', 'gerente', 'vendedor', 'interno']) {
      expect(PDM).toContain(`role !== '${r}'`);
    }
  });

  it('un rol no contemplado (p. ej. viewer/unassigned) sigue bloqueado por el gate', () => {
    // El gate sigue siendo una lista blanca de 4 roles: viewer/unassigned no están.
    expect(PDM).not.toContain("role !== 'viewer'");
    expect(PDM).not.toContain("role !== 'unassigned'");
    // y el alert de rechazo sigue existiendo para los que no pasan.
    expect(PDM).toContain('Tu usuario no tiene acceso a Pedidos del mes');
  });
});
