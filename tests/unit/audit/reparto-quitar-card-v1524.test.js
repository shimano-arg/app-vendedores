// v1524 (2026-10-29) — al aplicar/cerrar un reparto, la card del SKU se quita
// del modal sin refrescar (antes el render quedaba diferido por inputs con
// valores sugeridos en otras cards).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const html = readFileSync(resolve(__dirname, '../../../index.html'), 'utf8');

function bloque(desde, largo = 2500) {
  const i = html.indexOf(desde);
  expect(i).toBeGreaterThan(0);
  return html.slice(i, i + largo);
}

describe('reparto: quitar card al cerrar', () => {
  it('helper saca el ingreso del array y su card del DOM', () => {
    const b = bloque('function _repartoQuitarIngresoLocal(ingresoId){', 800);
    expect(b).toContain('_repartoIngresos = (_repartoIngresos || []).filter');
    expect(b).toContain('.reparto-apple-card[data-ingreso-id="');
    expect(b).toContain('card.remove()');
  });

  it('aplicar reparto sin errores quita la card', () => {
    const i = html.indexOf("let msg = 'Reparto aplicado: ' + ing.sku;");
    const b = html.slice(i, i + 800);
    expect(b).toContain('_repartoQuitarIngresoLocal(ingresoId)');
    // Con errores NO se quita (el ingreso queda in_progress en el servidor).
    expect(b).toMatch(
      /if \(!\(Array\.isArray\(r\.errors\) && r\.errors\.length > 0\)\) _repartoQuitarIngresoLocal/
    );
  });

  it('cerrar con sobrante y marcar procesado también la quitan', () => {
    expect(bloque('window._repartoCerrarConSobrante = async function', 2000)).toContain(
      '_repartoQuitarIngresoLocal(ingresoId)'
    );
    expect(bloque('window._repartoMarcarProcesado = async function', 1200)).toContain(
      '_repartoQuitarIngresoLocal(ingresoId)'
    );
  });

  it('el guard que difiere el render sigue (no pisa lo que Pablo cargó en otras cards)', () => {
    expect(html).toContain('window._repartoRenderPending = true;');
  });
});
