/**
 * 2026-11-03: classifyTransferError (inline index.html) distingue el rechazo por
 * descuento de SAP. Se extrae la función del inline y se evalúa aislada.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const html = readFileSync('index.html', 'utf8');
const start = html.indexOf('function classifyTransferError(msg){');
const end = html.indexOf('\n}\n', start);
const src = html.slice(start, end + 2);
// eslint-disable-next-line no-new-func
const classifyTransferError = new Function(src + '\nreturn classifyTransferError;')();

describe('classifyTransferError — rechazo por descuento', () => {
  it('10000724 y "Discount ... greater than permitted" → Descuento no permitido en SAP', () => {
    expect(
      classifyTransferError('Value in "Discount %" field is greater than permitted').type
    ).toBe('Descuento no permitido en SAP');
    expect(classifyTransferError('SL http 400 (10000724)').type).toBe(
      'Descuento no permitido en SAP'
    );
  });
  it('no pisa las categorías existentes', () => {
    expect(classifyTransferError('stock_degradado_cf_skip: x').type).toBe('Stock cambio');
    expect(classifyTransferError('CardCode not found').type).toBe('Cliente sin CardCode');
    expect(classifyTransferError('SL http 400').type).toBe('Datos invalidos');
    expect(classifyTransferError('timeout').type).toBe('SAP no responde');
    expect(classifyTransferError('algo raro').type).toBe('Error SAP');
  });
  it('el texto para el vendedor no tiene jerga técnica', () => {
    const { hint } = classifyTransferError('10000724');
    for (const w of ['payload', 'Firestore', 'DiscountPercent', 'transferError', 'Service Layer'])
      expect(hint.includes(w)).toBe(false);
  });
});
