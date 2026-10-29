// @ts-nocheck
/**
 * BUG-REV capa 2, lado navegador (2026-10-29): `sapSL.findQuotationByNumAtCard`
 * (usado por sap-auto-send-listener y el envío manual de sap-admin-panel) no
 * debe devolver una SQ cancelada como "ya existe". Espejo del fix en
 * functions/core/auto-send-sap-core.js. Mock de fetchWithSession; sin SAP real.
 */
import { beforeAll, describe, expect, it } from 'vitest';

let sapSL;
beforeAll(async () => {
  globalThis.window = globalThis.window || globalThis;
  await import('../../../src/domains/sap-service-layer.js');
  sapSL = globalThis.window.sapSL;
});

function withRows(rows) {
  const calls = [];
  const sl = Object.create(sapSL);
  sl.fetchWithSession = async (path) => {
    calls.push(path);
    return { ok: true, status: 200, body: { value: rows } };
  };
  return { sl, calls };
}

describe('findQuotationByNumAtCard ignora SQs canceladas', () => {
  it('F1: solo una SQ cancelada → { ok: false } (el caller crea una nueva)', async () => {
    const { sl } = withRows([{ DocEntry: 900, DocNum: 2000100, Cancelled: 'tYES' }]);
    expect(await sl.findQuotationByNumAtCard('ped-1')).toEqual({ ok: false });
  });
  it('F2: cancelada + abierta → devuelve la abierta', async () => {
    const { sl } = withRows([
      { DocEntry: 900, DocNum: 2000100, Cancelled: 'tYES' },
      { DocEntry: 950, DocNum: 2000200, Cancelled: 'tNO' },
    ]);
    expect(await sl.findQuotationByNumAtCard('ped-1')).toEqual({
      ok: true,
      docNum: 2000200,
      docEntry: 950,
    });
  });
  it('F3: fila sin Cancelled → se trata como abierta (comportamiento previo)', async () => {
    const { sl } = withRows([{ DocEntry: 950, DocNum: 2000200 }]);
    expect(await sl.findQuotationByNumAtCard('ped-1')).toEqual({
      ok: true,
      docNum: 2000200,
      docEntry: 950,
    });
  });
  it('F4: la consulta pide Cancelled y no corta en $top=1', async () => {
    const { sl, calls } = withRows([]);
    await sl.findQuotationByNumAtCard('ped-1');
    expect(calls[0]).toMatch(/\$select=[^&]*Cancelled/);
    expect(calls[0]).not.toMatch(/\$top=1(?!\d)/);
  });
});
