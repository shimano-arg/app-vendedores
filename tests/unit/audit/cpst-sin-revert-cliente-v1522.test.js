// v1522 (2026-10-29) — "Crear Pedido Desde Stock Asignado" no revierte
// reservas desde el navegador. Lo hace el servidor (revertSobreAsignadas,
// transaccional, cada ~5 min). Evita dos procesos escribiendo los mismos
// pedidos. Antes (v1397 §40.5) el bloque cliente era no-op (entries sin
// qtyAsignada) y el mensaje decía "vuelven a back order" sin que pasara.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const html = readFileSync(new URL('../../../index.html', import.meta.url), 'utf8');
const ini = html.indexOf('window._cpstConfirmar = async function(){');
const fin = html.indexOf('\n};', ini);
const fn = html.slice(ini, fin);

describe('v1522 _cpstConfirmar sin revert cliente', () => {
  it('la función existe', () => {
    expect(ini).toBeGreaterThan(-1);
    expect(fn.length).toBeGreaterThan(1000);
  });

  it('no usa el plan de reversión ni escribe pedidos origen', () => {
    expect(fn).not.toContain('computeCpstRevertPlan');
    expect(fn).not.toContain("logOp('cpst_revert_asig_to_bo'");
    expect(fn).not.toMatch(/batch\.update\(fbDb\.collection\('pedidos'\)/);
  });

  it('el texto ya no promete una reversión que no ocurre en ese momento', () => {
    expect(fn).not.toContain('vuelven a back order');
    expect(fn).not.toContain('volvieron a back order');
    expect(fn).toContain('el sistema las devuelve a la cola de espera en los próximos minutos');
  });

  it('sin unidades entregables: corta antes de reservar número de orden', () => {
    const corte = fn.indexOf('if (totalAjustado <= 0) {');
    const reserva = fn.indexOf('reserveNextOrderNumber()');
    expect(corte).toBeGreaterThan(-1);
    expect(reserva).toBeGreaterThan(corte);
  });

  it('el texto nuevo no tiene jerga (§68)', () => {
    const m = fn.match(/const _textoSinStock = [\s\S]*?;\n/);
    expect(m).toBeTruthy();
    for (const w of ['SKU', 'ASIG', 'back order', 'BO ']) expect(m[0]).not.toContain(w);
  });
});
