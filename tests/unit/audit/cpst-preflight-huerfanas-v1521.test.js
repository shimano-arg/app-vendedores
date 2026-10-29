// v1521 (2026-10-29) — contrato del pre-flight de _cpstConfirmar.
// Repro REBORN SRL CLC66H2PY: una ASIG huérfana no puede bloquear el pedido.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const html = readFileSync(new URL('../../../index.html', import.meta.url), 'utf8');
const main = readFileSync(new URL('../../../src/main.js', import.meta.url), 'utf8');

function bodyOf(marker, len = 14000) {
  const i = html.indexOf(marker);
  expect(i).toBeGreaterThan(-1);
  return html.slice(i, i + len);
}

describe('v1521 pre-flight CPST tolerante a ASIG huérfanas', () => {
  it('_cpstBuildCache guarda lineIndex en cada entry', () => {
    const b = bodyOf('function _cpstBuildCache(){', 9000);
    expect(b).toMatch(/entries\.push\(\{\s*pedidoId: pedidoId,\s*lineIndex: idx,/);
  });

  it('_cpstConfirmar delega en planCpstOrigenes y ya no re-busca la línea por SKU', () => {
    const b = bodyOf('const pedidosCache = new Map();', 9000);
    expect(b).toContain('_cpstPlanMod.planCpstOrigenes(c.skus, pedidosCache)');
    expect(b).not.toContain('linea con qtyOpen=0, state=');
    expect(b).not.toContain('u para cubrir qtyAjustada');
  });

  it('loguea asig_huerfana en operations_log con userUid (rules §70)', () => {
    const b = bodyOf('const pedidosCache = new Map();', 9000);
    expect(b).toContain("type: 'asig_huerfana'");
    expect(b).toContain('userUid: _uid');
  });

  it('el aviso al vendedor se suma al mensaje final', () => {
    const b = bodyOf("msg = 'Pedido ORDEN ' + ordenNum + ' creado en LISTA DE ESPERA.", 1200);
    expect(b).toContain('_avisoHuerfanas');
  });

  it('el catch final no muestra jerga (§68)', () => {
    expect(html).not.toContain('Error creando el pedido (nada se escribio en Firestore)');
  });

  it('main.js expone cpstOrigenesPlan', () => {
    expect(main).toContain("from './pure/cpst-origenes-plan.js'");
    expect(main).toMatch(/cpstOrigenesPlan:\s*\{\s*planCpstOrigenes,\s*formatAsigHuerfanaAviso,/);
  });
});
