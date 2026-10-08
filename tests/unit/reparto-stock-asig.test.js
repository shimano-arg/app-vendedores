import { describe, expect, it } from 'vitest';
import { redistributeAsigLine } from '../../src/pure/reparto-stock-asig.js';

const AUDIT = { adminEmail: 'pablo@shimano.com', nowIso: '2026-10-08T12:00:00.000Z' };

/** Linea ASIG activa helper. */
const asigLine = (sku, qty, extra = {}) => ({
  sku,
  code: sku,
  qty,
  qtyOpen: qty,
  state: 'ASIG',
  asigReserva: true,
  asigAt: '2026-10-01T10:00:00.000Z',
  asigCliTipo: 'A',
  priceAtCreation: 1000,
  ...extra,
});

/** Linea BO activa helper. */
const boLine = (sku, qty, extra = {}) => ({
  sku,
  code: sku,
  qty,
  qtyOpen: qty,
  state: 'BO',
  asigReserva: false,
  asigAt: null,
  priceAtCreation: 1000,
  ...extra,
});

describe('redistributeAsigLine — validacion inputs', () => {
  it('rechaza newQty negativo', () => {
    const r = redistributeAsigLine({
      pedido: { lines: [asigLine('A', 10)] },
      sku: 'A',
      newQty: -5,
      stockFisicoLibre: 10,
      audit: AUDIT,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/entero >= 0/);
  });

  it('rechaza newQty no entero', () => {
    const r = redistributeAsigLine({
      pedido: { lines: [asigLine('A', 10)] },
      sku: 'A',
      newQty: 5.5,
      stockFisicoLibre: 10,
      audit: AUDIT,
    });
    expect(r.ok).toBe(false);
  });

  it('rechaza pedido invalido', () => {
    const r = redistributeAsigLine({
      pedido: null,
      sku: 'A',
      newQty: 5,
      stockFisicoLibre: 10,
      audit: AUDIT,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/pedido invalido/);
  });

  it('rechaza sku vacio', () => {
    const r = redistributeAsigLine({
      pedido: { lines: [] },
      sku: '',
      newQty: 5,
      stockFisicoLibre: 10,
      audit: AUDIT,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/sku vacio/);
  });

  it('rechaza audit sin adminEmail', () => {
    const r = redistributeAsigLine({
      pedido: { lines: [asigLine('A', 10)] },
      sku: 'A',
      newQty: 5,
      stockFisicoLibre: 10,
      audit: /** @type {any} */ ({ nowIso: '2026-10-08T12:00:00Z' }),
    });
    expect(r.ok).toBe(false);
  });
});

describe('redistributeAsigLine — reducir (newQty < currentAsig)', () => {
  it('20u ASIG → 18u ASIG + 2u BO nueva (sin BO previo)', () => {
    const pedido = { lines: [asigLine('CUDC201HG', 20)] };
    const r = redistributeAsigLine({
      pedido,
      sku: 'CUDC201HG',
      newQty: 18,
      stockFisicoLibre: 0,
      audit: AUDIT,
    });
    expect(r.ok).toBe(true);
    expect(r.delta).toBe(-2);
    expect(r.currentAsig).toBe(20);
    expect(r.currentBO).toBe(0);
    expect(r.newLines).toHaveLength(2);
    const asig = r.newLines.find((l) => l.state === 'ASIG');
    const bo = r.newLines.find((l) => l.state === 'BO');
    expect(asig.qty).toBe(18);
    expect(asig.qtyOpen).toBe(18);
    expect(asig.redistributedBy).toBe('pablo@shimano.com');
    expect(asig.redistributedBefore).toBe(20);
    expect(asig.redistributedAfter).toBe(18);
    expect(bo.qty).toBe(2);
    expect(bo.qtyOpen).toBe(2);
    expect(bo.createdFromRedistribution).toBe(true);
  });

  it('20u ASIG + 5u BO existente → 18u ASIG + 7u BO (incrementa BO)', () => {
    const pedido = { lines: [asigLine('A', 20), boLine('A', 5)] };
    const r = redistributeAsigLine({
      pedido,
      sku: 'A',
      newQty: 18,
      stockFisicoLibre: 0,
      audit: AUDIT,
    });
    expect(r.ok).toBe(true);
    expect(r.newLines).toHaveLength(2);
    const asig = r.newLines.find((l) => l.state === 'ASIG');
    const bo = r.newLines.find((l) => l.state === 'BO');
    expect(asig.qty).toBe(18);
    expect(bo.qty).toBe(7);
    expect(bo.qtyOpen).toBe(7);
    expect(bo.redistributedBefore).toBe(5);
    expect(bo.redistributedAfter).toBe(7);
  });

  it('reducir hasta 0 → ASIG state=cancelled + nueva BO con el total', () => {
    const pedido = { lines: [asigLine('A', 10)] };
    const r = redistributeAsigLine({
      pedido,
      sku: 'A',
      newQty: 0,
      stockFisicoLibre: 0,
      audit: AUDIT,
    });
    expect(r.ok).toBe(true);
    const asig = r.newLines.find((l) => l.state === 'cancelled');
    const bo = r.newLines.find((l) => l.state === 'BO');
    expect(asig.qtyOpen).toBe(0);
    expect(asig.cancelReason).toBe('reparto-admin');
    expect(bo.qty).toBe(10);
  });

  it('no toca lineas de otros SKUs del pedido', () => {
    const pedido = {
      lines: [asigLine('A', 20), asigLine('B', 50), boLine('B', 10)],
    };
    const r = redistributeAsigLine({
      pedido,
      sku: 'A',
      newQty: 15,
      stockFisicoLibre: 0,
      audit: AUDIT,
    });
    expect(r.ok).toBe(true);
    const skuB_asig = r.newLines.find((l) => l.sku === 'B' && l.state === 'ASIG');
    const skuB_bo = r.newLines.find((l) => l.sku === 'B' && l.state === 'BO');
    expect(skuB_asig.qty).toBe(50);
    expect(skuB_bo.qty).toBe(10);
  });
});

describe('redistributeAsigLine — aumentar (newQty > currentAsig)', () => {
  it('18u ASIG + 2u BO → 20u ASIG + 0u BO cancelled (consume BO completo)', () => {
    const pedido = { lines: [asigLine('A', 18), boLine('A', 2)] };
    const r = redistributeAsigLine({
      pedido,
      sku: 'A',
      newQty: 20,
      stockFisicoLibre: 0,
      audit: AUDIT,
    });
    expect(r.ok).toBe(true);
    expect(r.delta).toBe(2);
    expect(r.usedFromBO).toBe(2);
    expect(r.usedFromLibre).toBe(0);
    expect(r.from).toBe('BO');
    const asig = r.newLines.find((l) => l.state === 'ASIG');
    const cancelled = r.newLines.find((l) => l.state === 'cancelled');
    expect(asig.qty).toBe(20);
    expect(cancelled.qty).toBe(0);
    expect(cancelled.cancelReason).toBe('reparto-admin-absorbed');
  });

  it('18u ASIG + 5u BO → 20u ASIG + 3u BO (consume parcial)', () => {
    const pedido = { lines: [asigLine('A', 18), boLine('A', 5)] };
    const r = redistributeAsigLine({
      pedido,
      sku: 'A',
      newQty: 20,
      stockFisicoLibre: 0,
      audit: AUDIT,
    });
    expect(r.ok).toBe(true);
    expect(r.usedFromBO).toBe(2);
    expect(r.from).toBe('BO');
    const bo = r.newLines.find((l) => l.state === 'BO');
    expect(bo.qty).toBe(3);
    expect(bo.qtyOpen).toBe(3);
  });

  it('20u ASIG + 0u BO + stockLibre=5 → 22u ASIG (toma de stock libre)', () => {
    const pedido = { lines: [asigLine('A', 20)] };
    const r = redistributeAsigLine({
      pedido,
      sku: 'A',
      newQty: 22,
      stockFisicoLibre: 5,
      audit: AUDIT,
    });
    expect(r.ok).toBe(true);
    expect(r.usedFromBO).toBe(0);
    expect(r.usedFromLibre).toBe(2);
    expect(r.from).toBe('LIBRE');
    const asig = r.newLines.find((l) => l.state === 'ASIG');
    expect(asig.qty).toBe(22);
  });

  it('18u ASIG + 2u BO + stockLibre=5 → 25u ASIG (consume BO + stockLibre, MIXED)', () => {
    const pedido = { lines: [asigLine('A', 18), boLine('A', 2)] };
    const r = redistributeAsigLine({
      pedido,
      sku: 'A',
      newQty: 25,
      stockFisicoLibre: 5,
      audit: AUDIT,
    });
    expect(r.ok).toBe(true);
    expect(r.usedFromBO).toBe(2);
    expect(r.usedFromLibre).toBe(5);
    expect(r.from).toBe('MIXED');
    const asig = r.newLines.find((l) => l.state === 'ASIG');
    expect(asig.qty).toBe(25);
  });

  it('BLOQUEA: aumentar sin BO ni stock libre', () => {
    const pedido = { lines: [asigLine('A', 20)] };
    const r = redistributeAsigLine({
      pedido,
      sku: 'A',
      newQty: 25,
      stockFisicoLibre: 0,
      audit: AUDIT,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/no hay stock libre suficiente/);
    expect(r.currentAsig).toBe(20);
    expect(r.currentBO).toBe(0);
  });

  it('BLOQUEA: aumentar con stockLibre insuficiente', () => {
    const pedido = { lines: [asigLine('A', 20), boLine('A', 1)] };
    const r = redistributeAsigLine({
      pedido,
      sku: 'A',
      newQty: 25,
      stockFisicoLibre: 2,
      audit: AUDIT,
    });
    expect(r.ok).toBe(false);
    // needed=5, fromBO=1, fromLibre=4, stockLibre=2 → faltan 2.
    expect(r.error).toMatch(/Faltan 2/);
  });

  it('aumentar desde 0 ASIG (solo habia BO) → crea nueva linea ASIG', () => {
    const pedido = { lines: [boLine('A', 10)] };
    const r = redistributeAsigLine({
      pedido,
      sku: 'A',
      newQty: 5,
      stockFisicoLibre: 0,
      audit: AUDIT,
    });
    expect(r.ok).toBe(true);
    expect(r.usedFromBO).toBe(5);
    const asig = r.newLines.find((l) => l.state === 'ASIG');
    expect(asig.qty).toBe(5);
    expect(asig.asigReserva).toBe(true);
    expect(asig.asigCliTipo).toBe('reparto-admin');
    expect(asig.createdFromRedistribution).toBe(true);
    const bo = r.newLines.find((l) => l.state === 'BO');
    expect(bo.qty).toBe(5);
  });
});

describe('redistributeAsigLine — no-op', () => {
  it('newQty === currentAsig → ok:false sin cambios', () => {
    const pedido = { lines: [asigLine('A', 10)] };
    const r = redistributeAsigLine({
      pedido,
      sku: 'A',
      newQty: 10,
      stockFisicoLibre: 100,
      audit: AUDIT,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/sin cambios/);
    expect(r.delta).toBe(0);
  });
});

describe('redistributeAsigLine — SIN RESERVA no cuenta', () => {
  it('ASIG con asigReserva=false NO se cuenta como ASIG activa: currentAsig=0', () => {
    const sinReserva = asigLine('A', 10, { asigReserva: false });
    const pedido = { lines: [sinReserva] };
    const r = redistributeAsigLine({
      pedido,
      sku: 'A',
      newQty: 8,
      stockFisicoLibre: 0,
      audit: AUDIT,
    });
    // currentAsig=0 (SIN RESERVA no cuenta), delta=+8, no hay BO ni stock libre.
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/no hay stock libre suficiente/);
    expect(r.currentAsig).toBe(0);
  });

  it('rechaza reducir cuando no hay ASIG activa (todo SIN RESERVA) y newQty=0', () => {
    const sinReserva = asigLine('A', 10, { asigReserva: false });
    const pedido = { lines: [sinReserva] };
    const r = redistributeAsigLine({
      pedido,
      sku: 'A',
      newQty: 0,
      stockFisicoLibre: 0,
      audit: AUDIT,
    });
    // currentAsig=0, newQty=0 → no-op (sin cambios).
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/sin cambios/);
  });
});

describe('redistributeAsigLine — lineas qtyOpen=0 ignoradas', () => {
  it('linea ASIG con qtyOpen=0 no se cuenta', () => {
    const vacia = asigLine('A', 0);
    const activa = asigLine('A', 10);
    const pedido = { lines: [vacia, activa] };
    const r = redistributeAsigLine({
      pedido,
      sku: 'A',
      newQty: 7,
      stockFisicoLibre: 0,
      audit: AUDIT,
    });
    expect(r.ok).toBe(true);
    expect(r.currentAsig).toBe(10);
    expect(r.delta).toBe(-3);
  });
});

describe('redistributeAsigLine — SKU case normalization', () => {
  it('busca SKU case-insensitive', () => {
    const pedido = { lines: [asigLine('CudC201hG', 20)] };
    const r = redistributeAsigLine({
      pedido,
      sku: 'cudc201hg',
      newQty: 18,
      stockFisicoLibre: 0,
      audit: AUDIT,
    });
    expect(r.ok).toBe(true);
    expect(r.delta).toBe(-2);
  });
});
