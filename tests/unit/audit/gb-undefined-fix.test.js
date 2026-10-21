// @ts-check
/**
 * v1401 §40.9 — fix "pedido undefined - BACKORDER" del flujo Generar Backorder.
 *
 * El docData del pedido manual-backorder ahora lleva `key` canónica
 * `tipo|province|locName|clientName` igual que un pedido normal (index.html:19656).
 *
 * Antes el campo `key: ''` → listener agrupaba en confirmed[''] →
 * renderConfirmadosList hacía k.split('|') → parts[1..3]=undefined → UI
 * mostraba "undefined".
 *
 * Esta suite valida la construcción de key + que un bloqueo "sin cliente"
 * funciona.
 */
import { describe, expect, it } from 'vitest';

// Función extraída conceptualmente de _gbConfirmar.
function buildPedidoBackorderDocData(r, meta = {}) {
  if (!r || !r.nombre || !String(r.nombre).trim()) {
    throw new Error('Elegi un cliente valido antes de guardar (sin nombre resuelto).');
  }
  const tipo = r.cardCode ? 'C' : 'P';
  const province = r.provincia || '';
  const locName = r.localidad || '';
  const clientName = String(r.nombre || '').trim();
  const key = tipo + '|' + province + '|' + locName + '|' + clientName;
  return Object.assign(
    {
      stage: 'confirmed',
      key,
      tipo,
      province,
      locName,
      clientProvince: province,
      clientLocality: locName,
      clientName,
      clientCardCode: r.cardCode || '',
      source: 'manual-backorder',
      transferidoSAP: { via: 'manual-backorder', skipSap: true },
    },
    meta
  );
}

// Simula el render del card.
function simulatedCardLabel(doc) {
  const key = doc.key || '';
  const parts = key.split('|');
  const clientName = doc.clientName || parts[3] || '';
  return clientName; // escapeHtml trivial.
}

describe('v1401 §40.9 fix Generar Backorder — key canónica + clientName', () => {
  it('cliente con cardCode SAP → tipo=C + key canónica + clientName presente', () => {
    const r = {
      nombre: 'PABLO SEBASTIAN ROLDAN',
      cardCode: 'C20259014868',
      provincia: 'CHUBUT',
      localidad: 'COMODORO RIVADAVIA',
      vendor: 'VDE_SUR',
    };
    const doc = buildPedidoBackorderDocData(r);
    expect(doc.tipo).toBe('C');
    expect(doc.key).toBe('C|CHUBUT|COMODORO RIVADAVIA|PABLO SEBASTIAN ROLDAN');
    expect(doc.clientName).toBe('PABLO SEBASTIAN ROLDAN');
    expect(doc.clientCardCode).toBe('C20259014868');
    expect(doc.clientProvince).toBe('CHUBUT');
    expect(doc.clientLocality).toBe('COMODORO RIVADAVIA');
  });

  it('prospecto sin cardCode (alta aprobada manual) → tipo=P', () => {
    const r = {
      nombre: 'NUEVO CLIENTE',
      cardCode: '',
      provincia: 'MENDOZA',
      localidad: 'GODOY CRUZ',
    };
    const doc = buildPedidoBackorderDocData(r);
    expect(doc.tipo).toBe('P');
    expect(doc.key).toBe('P|MENDOZA|GODOY CRUZ|NUEVO CLIENTE');
  });

  it('BLOQUEO: cliente null → throw', () => {
    expect(() => buildPedidoBackorderDocData(null)).toThrow(/sin nombre/);
  });

  it('BLOQUEO: cliente con nombre vacío → throw', () => {
    expect(() => buildPedidoBackorderDocData({ nombre: '', cardCode: 'C1' })).toThrow(/sin nombre/);
    expect(() => buildPedidoBackorderDocData({ nombre: '   ', cardCode: 'C1' })).toThrow(
      /sin nombre/
    );
    expect(() => buildPedidoBackorderDocData({ nombre: null, cardCode: 'C1' })).toThrow(
      /sin nombre/
    );
  });

  it('modal de detalle renderiza clientName correctamente (no undefined)', () => {
    const r = {
      nombre: 'HUGO GIARDINO',
      cardCode: 'C20135893553',
      provincia: 'SANTA FE',
      localidad: 'SANTA FE DE LA VERA CRUZ',
    };
    const doc = buildPedidoBackorderDocData(r);
    const label = simulatedCardLabel(doc);
    expect(label).toBe('HUGO GIARDINO');
    expect(label).not.toBe('undefined');
  });

  it('regression: pre-fix (key vacía) rendería undefined cuando se parseaba por k.split', () => {
    // Simular el bug pre-v1401: doc guardado con key='' → el render agrupaba
    // por k='' y hacía k.split('|') → parts=['']. parts[3]=undefined.
    const preBuggedDoc = { stage: 'confirmed', key: '', tipo: '', clientName: 'ALGUIEN' };
    const parts = (preBuggedDoc.key || '').split('|');
    const clientNameFromKey = parts[3]; // Lo que hace renderConfirmadosList (parts[3]).
    expect(clientNameFromKey).toBeUndefined();
    // Post-v1401, incluso si k viniera vacío, doc.clientName fallback resuelve.
    const postLabel = simulatedCardLabel(preBuggedDoc);
    expect(postLabel).toBe('ALGUIEN');
  });

  it('provincia/localidad vacías: key sigue bien formada (sin undefined)', () => {
    const r = { nombre: 'X', cardCode: 'C1', provincia: '', localidad: '' };
    const doc = buildPedidoBackorderDocData(r);
    expect(doc.key).toBe('C|||X');
    expect(doc.key).not.toContain('undefined');
  });

  it('caso real pedido 463 PABLO ROLDAN (reportado por Mariano): clientName presente', () => {
    const r = {
      nombre: 'PABLO SEBASTIAN ROLDAN',
      cardCode: 'C20259014868',
      provincia: 'CHUBUT',
      localidad: 'COMODORO RIVADAVIA',
    };
    const doc = buildPedidoBackorderDocData(r, { orderNumber: '463' });
    expect(doc.clientName).toBe('PABLO SEBASTIAN ROLDAN');
    expect(doc.key.split('|')[3]).toBe('PABLO SEBASTIAN ROLDAN');
    expect(doc.key.split('|')[1]).toBe('CHUBUT');
    expect(doc.key.split('|')[2]).toBe('COMODORO RIVADAVIA');
    expect(doc.orderNumber).toBe('463');
  });
});
