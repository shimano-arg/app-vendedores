// @ts-check
/**
 * reparto-import-modal-ui.test.js (v1514 §T3, 2026-10-28)
 *
 * Tests para el rework UI del modal #reparto-import-modal + preview Fase B:
 *   - Modal construye los 4 estados (idle / validating / preview-ok / errors).
 *   - Dropzone acepta click + drag.
 *   - Preview-ok muestra 3 cards resumen + tabla 5 cols.
 *   - Consistency rule rechaza fila `Asignado + VueleABO + Elim > backorder`.
 *   - Aplicar button hidden/disabled si hay errores.
 *
 * El dominio real (`src/domains/exports-reparto.js`) usa `window.*` y DOM API.
 * Para testear sin browser:
 *   - vitest provee `globalThis.document` solo si configuramos jsdom.
 *   - Verificamos la estructura via grep del source + validamos la pure
 *     helper `_computeConsistencyErrors` reproducida acá (misma firma).
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(
  join(__dirname, '..', '..', 'src', 'domains', 'exports-reparto.js'),
  'utf8'
);

describe('v1514 §T3 — Modal #reparto-import-modal estructura DOM', () => {
  it('tiene los 4 contenedores de estado por id', () => {
    expect(SRC).toContain('reparto-import-dropzone');
    expect(SRC).toContain('reparto-import-validating');
    expect(SRC).toContain('reparto-import-preview-ok');
    expect(SRC).toContain('reparto-import-errors');
  });

  it('tiene input file nativo oculto', () => {
    expect(SRC).toMatch(/id\s*=\s*['"]reparto-import-file['"]/);
    expect(SRC).toMatch(/fileInput\.type\s*=\s*['"]file['"]/);
    expect(SRC).toMatch(/display:none/);
  });

  it('dropzone acepta click (dispara fileInput.click)', () => {
    expect(SRC).toMatch(/dropzone\.addEventListener\(['"]click['"]/);
    expect(SRC).toMatch(/fileInput\.click\(\)/);
  });

  it('dropzone acepta drag (dragover + dragleave + drop)', () => {
    expect(SRC).toMatch(/addEventListener\(['"]dragover['"]/);
    expect(SRC).toMatch(/addEventListener\(['"]dragleave['"]/);
    expect(SRC).toMatch(/addEventListener\(['"]drop['"]/);
    expect(SRC).toMatch(/e\.preventDefault\(\)|ev\.preventDefault\(\)/);
  });

  it('drop lee dataTransfer.files[0] y llama handleRepartoImportFileChange', () => {
    expect(SRC).toMatch(/dataTransfer/);
    expect(SRC).toMatch(/handleRepartoImportFileChange/);
    // Shape del evento sintético: { target: { files: [file] } }.
    expect(SRC).toMatch(/target:\s*\{\s*files:/);
  });

  it('usa CSS vars dark-mode (var(--bg-primary), --text-primary, etc.)', () => {
    expect(SRC).toContain('var(--bg-primary');
    expect(SRC).toContain('var(--text-primary');
    expect(SRC).toContain('var(--border-color');
    expect(SRC).toContain('var(--color-success');
    expect(SRC).toContain('var(--color-warning');
    expect(SRC).toContain('var(--color-danger');
  });

  it('aplicar button tiene id reparto-import-apply-btn y está hidden/disabled por default', () => {
    expect(SRC).toMatch(/id\s*=\s*['"]reparto-import-apply-btn['"]/);
    expect(SRC).toMatch(/applyBtn\.disabled\s*=\s*true/);
    // Visible solo en preview-ok (via _setImportModalState).
    expect(SRC).toContain("state === 'preview-ok'");
  });

  it('cerrar (×) presente + listener click → closeRepartoImportDialog', () => {
    expect(SRC).toMatch(/closeBtn/);
    expect(SRC).toContain('closeRepartoImportDialog');
    expect(SRC).toMatch(/aria-label['"]\s*,\s*['"]Cerrar/);
  });
});

describe('v1514 §T3 — Estado toggles via _setImportModalState', () => {
  it('toggle alterna display de los 4 contenedores', () => {
    expect(SRC).toContain('_setImportModalState');
    // Función debe mostrar/ocultar según el state actual.
    expect(SRC).toMatch(/display\s*=\s*st\s*===\s*state\s*\?\s*['"]flex['"]\s*:\s*['"]none['"]/);
  });

  it('open setea idle', () => {
    expect(SRC).toMatch(/_setImportModalState\(['"]idle['"]\)/);
  });

  it('handle file change setea validating', () => {
    expect(SRC).toMatch(/_setImportModalState\(['"]validating['"]\)/);
  });

  it('render preview setea preview-ok o errors', () => {
    expect(SRC).toMatch(/_setImportModalState\(['"]preview-ok['"]\)/);
    expect(SRC).toMatch(/_setImportModalState\(['"]errors['"]\)/);
  });
});

describe('v1514 §T3 — Preview-ok con 3 cards + tabla 5 cols', () => {
  it('cards: Asignadas / Vuelve a BO / Eliminadas', () => {
    expect(SRC).toContain('Asignadas');
    expect(SRC).toContain('Vuelve a BO');
    expect(SRC).toContain('Eliminadas');
  });

  it('tabla con 5 headers: SKU, Cliente, Asignado, Vuelve a BO, Eliminado', () => {
    expect(SRC).toMatch(
      /\[['"]SKU['"]\s*,\s*['"]Cliente['"]\s*,\s*['"]Asignado['"]\s*,\s*['"]Vuelve a BO['"]\s*,\s*['"]Eliminado['"]\]/
    );
  });

  it('fórmula de VueleBO per-fila = max(0, bo - asig - elim)', () => {
    expect(SRC).toMatch(/Math\.max\s*\(\s*0\s*,\s*bo\s*-\s*asig\s*-\s*elim\s*\)/);
  });
});

// ============================================================
// Reproducción local de la consistency rule para testearla con casos reales
// (la fn real está en el modulo pero es internal; replicamos la lógica).
// ============================================================
function computeConsistencyErrors(reconocidas) {
  const out = [];
  for (const r of reconocidas || []) {
    if (!r) continue;
    const asig = Number(r.asignadoNuevo) || 0;
    const elim = Number(r.eliminarNuevo) || 0;
    const bo = Number(r.backorderActual) || 0;
    const vuelve = bo - asig - elim;
    if (vuelve < 0) {
      out.push({
        rowIndex: r.rowIndex || 0,
        sku: r.sku || '',
        cliente: r.clientName || '',
        msg: 'inconsistente',
      });
    }
  }
  return out;
}

describe('v1514 §T3 — Consistency rule rechaza fila con suma > backorder', () => {
  it('OK: asig=2, elim=1, bo=5 → vuelve=2, sin error', () => {
    const errs = computeConsistencyErrors([
      {
        rowIndex: 2,
        sku: 'SKU-A',
        clientName: 'ACME',
        backorderActual: 5,
        asignadoNuevo: 2,
        eliminarNuevo: 1,
      },
    ]);
    expect(errs).toHaveLength(0);
  });

  it('OK: asig=5, elim=0, bo=5 → vuelve=0, sin error', () => {
    const errs = computeConsistencyErrors([
      {
        rowIndex: 2,
        sku: 'SKU-A',
        clientName: 'ACME',
        backorderActual: 5,
        asignadoNuevo: 5,
        eliminarNuevo: 0,
      },
    ]);
    expect(errs).toHaveLength(0);
  });

  it('ERROR: asig=3, elim=3, bo=5 → vuelve=-1, 1 error', () => {
    const errs = computeConsistencyErrors([
      {
        rowIndex: 2,
        sku: 'SKU-A',
        clientName: 'ACME',
        backorderActual: 5,
        asignadoNuevo: 3,
        eliminarNuevo: 3,
      },
    ]);
    expect(errs).toHaveLength(1);
    expect(errs[0].rowIndex).toBe(2);
    expect(errs[0].sku).toBe('SKU-A');
    expect(errs[0].cliente).toBe('ACME');
  });

  it('ERROR: asig=10 solo, bo=5 → vuelve=-5, 1 error', () => {
    const errs = computeConsistencyErrors([
      {
        rowIndex: 3,
        sku: 'SKU-B',
        clientName: 'OTRO',
        backorderActual: 5,
        asignadoNuevo: 10,
        eliminarNuevo: 0,
      },
    ]);
    expect(errs).toHaveLength(1);
    expect(errs[0].sku).toBe('SKU-B');
  });

  it('múltiples filas, mezcla OK + error', () => {
    const errs = computeConsistencyErrors([
      {
        rowIndex: 2,
        sku: 'A',
        clientName: 'C1',
        backorderActual: 5,
        asignadoNuevo: 2,
        eliminarNuevo: 1,
      },
      {
        rowIndex: 3,
        sku: 'B',
        clientName: 'C2',
        backorderActual: 5,
        asignadoNuevo: 10,
        eliminarNuevo: 0,
      },
      {
        rowIndex: 4,
        sku: 'C',
        clientName: 'C3',
        backorderActual: 10,
        asignadoNuevo: 5,
        eliminarNuevo: 6,
      },
    ]);
    expect(errs).toHaveLength(2);
    expect(errs[0].rowIndex).toBe(3);
    expect(errs[1].rowIndex).toBe(4);
  });

  it('acepta input null/undefined sin crashear', () => {
    expect(computeConsistencyErrors(null)).toEqual([]);
    expect(computeConsistencyErrors(undefined)).toEqual([]);
    expect(computeConsistencyErrors([])).toEqual([]);
  });

  it('ignora filas sin campos (defensa)', () => {
    const errs = computeConsistencyErrors([null, undefined, {}]);
    // {} tiene bo=0, asig=0, elim=0 → vuelve=0, no error.
    expect(errs).toHaveLength(0);
  });
});

describe('v1514 §T3 — Aplicar bloqueado cuando hay errores', () => {
  it('render chequea canApply = s.conCambios.length > 0 (sin errores)', () => {
    // En preview-ok path solo si !allErrors.length.
    expect(SRC).toMatch(/canApply\s*=\s*s\.conCambios\.length\s*>\s*0/);
  });

  it('errors path setea disabled=true + opacity=0.4', () => {
    expect(SRC).toMatch(/disabled\s*=\s*true/);
    expect(SRC).toMatch(/opacity.*=.*['"]0\.4['"]/);
  });
});

describe('v1514 §T3 — Dark mode / CSS vars', () => {
  it('cards usan var(--color-success-bg), --color-warning-bg, --color-danger-bg', () => {
    expect(SRC).toContain('var(--color-success-bg');
    expect(SRC).toContain('var(--color-warning-bg');
    expect(SRC).toContain('var(--color-danger-bg');
  });

  it('header/footer usa var(--border-color) para separadores', () => {
    expect(SRC).toMatch(/border-bottom:0\.5px solid var\(--border-color/);
    expect(SRC).toMatch(/border-top:0\.5px solid var\(--border-color/);
  });
});
