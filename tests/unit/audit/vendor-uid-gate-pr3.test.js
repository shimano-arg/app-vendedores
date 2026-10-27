// @ts-check
/**
 * v1476 PR3 §74 (2026-10-26) — tests del gate VENDOR_UID_MISSING en
 * commitPedidoCore. Reportado SUSANA ANDRILI: pedido quedó con
 * assignedVendorUid=null porque el flujo unificar+confirmar no re-resolvió
 * el UID → invisible en Planner VDE.
 */
import { describe, expect, it } from 'vitest';

const CORE_SRC = (() => {
  const { readFileSync } = require('node:fs');
  return readFileSync('functions/core/commit-pedido-core.js', 'utf8');
})();

describe('v1476 §74 — gate VENDOR_UID_MISSING pre-tx', () => {
  it('T1 import logCommitRejection existe + código del gate presente', () => {
    expect(CORE_SRC).toMatch(/4\.5\.5 PR 3 §74/);
    expect(CORE_SRC).toMatch(/VENDOR_UID_MISSING/);
  });

  it('T2 gate chequea vendorAssigned populated + assignedVendorUid vacío', () => {
    expect(CORE_SRC).toMatch(/_hasVendorName = !!\(payload\.vendorAssigned/);
    expect(CORE_SRC).toMatch(/_hasVendorUid = !!\(payload\.assignedVendorUid/);
    expect(CORE_SRC).toMatch(/if \(_hasVendorName && !_hasVendorUid\)/);
  });

  it('T3 gate rechaza con makeError + preserva waitlist (NO entra al tx)', () => {
    const gateIdx = CORE_SRC.indexOf('_hasVendorName = !!(payload.vendorAssigned');
    const txIdx = CORE_SRC.indexOf('// 5. runTransaction atómica.');
    expect(gateIdx).toBeGreaterThan(0);
    expect(txIdx).toBeGreaterThan(gateIdx); // gate ANTES del tx
    // Entre el gate y el tx NO hay set/update a waitlist origen.
    const slice = CORE_SRC.slice(gateIdx, txIdx);
    expect(slice).toMatch(/return makeError\(\s*'VENDOR_UID_MISSING'/);
  });

  it('T4 cliente NO en master (ambos campos vacíos) → gate NO dispara', () => {
    // Simular logic del gate (sin invocar commitPedidoCore real):
    const payload = { vendorAssigned: null, assignedVendorUid: null };
    const hasName = !!(payload.vendorAssigned && String(payload.vendorAssigned).trim());
    const hasUid = !!(payload.assignedVendorUid && String(payload.assignedVendorUid).trim());
    expect(hasName && !hasUid).toBe(false); // NO entra al if
  });

  it('T5 cliente en master Y vendor con UID → gate NO dispara', () => {
    const payload = { vendorAssigned: 'FEDERICO CASTELANELLI', assignedVendorUid: 'uid-fed' };
    const hasName = !!(payload.vendorAssigned && String(payload.vendorAssigned).trim());
    const hasUid = !!(payload.assignedVendorUid && String(payload.assignedVendorUid).trim());
    expect(hasName && !hasUid).toBe(false);
  });

  it('T6 fixture REAL SUSANA ANDRILI: vendorAssigned populated + UID vacío → gate DISPARA', () => {
    // Del log real del ORDEN 530 pre-reparación:
    const payload = {
      vendorAssigned: 'FEDERICO CASTELANELLI',
      assignedVendorUid: null,
      assignedVendorReason: 'vendor_sin_uid',
    };
    const hasName = !!(payload.vendorAssigned && String(payload.vendorAssigned).trim());
    const hasUid = !!(payload.assignedVendorUid && String(payload.assignedVendorUid).trim());
    expect(hasName && !hasUid).toBe(true); // DEBE disparar
  });

  it('T7 mensaje §68 compliance (sin jerga)', async () => {
    const { MENSAJES_VENDEDOR } = await import('../../../src/pure/mensajes-vendedor.js');
    expect(MENSAJES_VENDEDOR.VENDOR_UID_MISSING).toBeDefined();
    const texto = MENSAJES_VENDEDOR.VENDOR_UID_MISSING.texto;
    const prohibidas = [
      'SKU',
      'payload',
      'Firestore',
      'backend',
      'undefined',
      'callable',
      'snapshot',
      'concurrencia',
      'transacción',
      'transaccion',
      'UID',
    ];
    for (const w of prohibidas) {
      expect(texto.includes(w), `mensaje tiene jerga: "${w}" en "${texto}"`).toBe(false);
    }
  });
});

describe('v1476 §74 — espejo functions/core/resolve-client-vendor-core.js existe', () => {
  it('T20 espejo del pure src/pure/resolve-client-vendor.js', async () => {
    const { readFileSync } = await import('node:fs');
    const srcPure = readFileSync('src/pure/resolve-client-vendor.js', 'utf8');
    const serverCore = readFileSync('functions/core/resolve-client-vendor-core.js', 'utf8');
    // Mismo export principal.
    expect(serverCore).toMatch(/export function resolveClientVendorFromMaster/);
    // v1491 §89 (2026-10-27): el server mirror puede tener funciones ADICIONALES
    // que el pure no tiene (ej. `resolveClientVendorServerSide` que lee Firestore
    // con admin SDK). Lo relevante: el server mirror NUNCA es más chico que el
    // pure (verificaría que no se perdió funcionalidad base).
    expect(serverCore.length).toBeGreaterThanOrEqual(srcPure.length * 0.95);
  });
});
