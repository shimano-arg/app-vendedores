import { describe, expect, it } from 'vitest';
import {
  archiveTransferError,
  blocksAutoSend,
  buildSapTransferError,
  discountRetrySuccessFields,
  isDeterministicCfRejection as f,
  hasDiscountRejection,
  isSapDiscountRejection,
} from '../../src/pure/sap-transfer-error.js';

describe('isDeterministicCfRejection', () => {
  it('rechazos de la CF que NO se reintentan solos', () => {
    expect(f({ via: 'cf_auto', status: 400 })).toBe(true);
    expect(f({ via: 'cf_auto', status: 404 })).toBe(true);
    expect(f({ via: 'cf_auto', status: 400, discountRejected: true })).toBe(true);
    expect(f({ via: 'cf_auto', discountRejected: true })).toBe(true);
  });
  it('transitorios, ambiguos u otros orígenes => se mantiene el reintento actual', () => {
    expect(f({ via: 'cf_auto', status: 408 })).toBe(false);
    expect(f({ via: 'cf_auto', status: 429 })).toBe(false);
    expect(f({ via: 'cf_auto', status: 502, needsManualVerification: true })).toBe(false);
    expect(f({ via: 'cf_auto', status: null, needsManualVerification: true })).toBe(false);
    expect(f({ via: 'cf_auto', status: 200 })).toBe(false);
    expect(f({ via: 'service_layer_auto', message: 'x' })).toBe(false);
    expect(f({ via: 'service_layer_auto', discountRejected: true })).toBe(false);
    expect(f({ message: 'stock_degradado_auto_skip', needsManualIntervention: true })).toBe(false);
    for (const v of [null, undefined, '', 'cf_auto', 0, []]) expect(f(v)).toBe(false);
  });
});

describe('blocksAutoSend / hasDiscountRejection', () => {
  it('rechazo por descuento de cualquier camino bloquea el auto-envío', () => {
    for (const via of ['cf_auto', 'service_layer_auto', 'service_layer']) {
      expect(hasDiscountRejection({ via, discountRejected: true })).toBe(true);
      expect(blocksAutoSend({ via, discountRejected: true })).toBe(true);
    }
  });
  it('errores del navegador sin descuento no bloquean (comportamiento actual)', () => {
    expect(blocksAutoSend({ via: 'service_layer_auto', status: 400 })).toBe(false);
    expect(blocksAutoSend({ via: 'service_layer', message: 'x' })).toBe(false);
    expect(blocksAutoSend(null)).toBe(false);
  });
});

describe('buildSapTransferError', () => {
  it('lee status, código y mensaje de la respuesta de Service Layer', () => {
    const te = buildSapTransferError({
      status: 400,
      body: {
        error: {
          code: -10000724,
          message: { value: 'Value in "Discount %" field is greater than permitted' },
        },
      },
      error: 'HTTP 400 - Value in "Discount %" field is greater than permitted',
      via: 'service_layer',
      at: '2026-11-03T00:00:00.000Z',
      attemptedBy: 'a@b',
      discountPercentSent: 17,
    });
    expect(te).toEqual({
      message: 'HTTP 400 - Value in "Discount %" field is greater than permitted',
      at: '2026-11-03T00:00:00.000Z',
      via: 'service_layer',
      status: 400,
      sapCode: '-10000724',
      discountRejected: true,
      discountPercentSent: 17,
      attemptedBy: 'a@b',
    });
  });
  it('sin body ni status: campos nulos, nunca undefined, mensaje recortado a 500', () => {
    const te = buildSapTransferError({ error: 'X'.repeat(900), via: 'cf_auto', at: 't' });
    expect(te.message.length).toBe(500);
    expect(te.status).toBeNull();
    expect(te.sapCode).toBeNull();
    expect(te.discountRejected).toBe(false);
    expect(Object.values(te).includes(undefined)).toBe(false);
    expect('attemptedBy' in te).toBe(false);
  });
  it('isSapDiscountRejection acepta el código con signo', () => {
    expect(isSapDiscountRejection(-10000724, '')).toBe(true);
    expect(isSapDiscountRejection(-5002, 'CardCode not found')).toBe(false);
  });
});

describe('archivo del rechazo al reenviar', () => {
  const te = {
    message: 'Value in Discount',
    via: 'cf_auto',
    status: 400,
    discountRejected: true,
    x: undefined,
  };
  it('archiveTransferError copia el error, agrega el desenlace y descarta undefined', () => {
    const a = archiveTransferError(te, {
      by: 'admin',
      at: 't',
      resolution: 'reenvio_manual_fallido',
      pctEnviado: 0,
    });
    expect(a).toEqual({
      message: 'Value in Discount',
      via: 'cf_auto',
      status: 400,
      discountRejected: true,
      resolvedAt: 't',
      resolvedBy: 'admin',
      resolution: 'reenvio_manual_fallido',
      pctEnviadoEnReenvio: 0,
    });
  });
  it('discountRetrySuccessFields: aplicadoEnSap solo si se mandó al menos lo solicitado', () => {
    const au = (x) => ({ u: x });
    const f0 = discountRetrySuccessFields(te, {
      pctSolicitado: 17,
      pctEnviado: 0,
      by: 'a',
      at: 't',
      arrayUnion: au,
    });
    expect(f0.descuentoRechazadoPrevio.aplicadoEnSap).toBe(false);
    expect(f0.transferErrorHistory.u.resolution).toBe('reenvio_manual_confirmado');
    const f17 = discountRetrySuccessFields(te, {
      pctSolicitado: 17,
      pctEnviado: 17,
      by: 'a',
      at: 't',
      arrayUnion: au,
    });
    expect(f17.descuentoRechazadoPrevio.aplicadoEnSap).toBe(true);
    const f10 = discountRetrySuccessFields(te, {
      pctSolicitado: 17,
      pctEnviado: 10,
      by: 'a',
      at: 't',
      arrayUnion: au,
    });
    expect(f10.descuentoRechazadoPrevio.aplicadoEnSap).toBe(false);
  });
});
