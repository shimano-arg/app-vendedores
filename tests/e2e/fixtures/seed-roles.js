/**
 * Fixture de seed para tests E2E (P2-A.a, S-7, 2026-11-25).
 *
 * Siembra 6 roles canónicos en el emulador Firestore:
 *   - admin: acceso total
 *   - gerente: confirmar pedidos, ver todo
 *   - interno Ioannis: interno sin pareja asignada (para T3: espera post P0-B)
 *   - interno Pachi: interno sin pareja (para verificar REBOTA)
 *   - VDE Gonzalo: vendedor con internalPartnerUid = test-interno-ioannis
 *   - VDE Pachi: vendedor con internalPartnerUid = test-interno-pachi
 *   - VDE sin pareja: vendedor sin internalPartnerUid
 *   - sin rol: cuenta existente pero sin rol asignado
 *
 * También siembra un cliente de prueba en /client_master para operaciones.
 */

import { seedDoc, seedRole, UID } from '../lib/setup-emulator.js';

export const CARD_CODE_GONZALO = 'TEST-C-GONZALO-001';
export const CARD_CODE_PACHI = 'TEST-C-PACHI-001';
export const TEST_SKU = 'TEST-SKU-9691';

/** Siembra todos los roles canónicos del escenario P2-A.a. */
export async function seedAllRoles() {
  await seedRole(UID.admin, 'admin');
  await seedRole(UID.gerente, 'gerente');

  // Interno Ioannis: pareja = VDE Gonzalo
  await seedRole(UID.internoIoannis, 'interno');

  // Interno Pachi: pareja = VDE Pachi
  await seedRole(UID.internoPachi, 'interno');

  // VDE Gonzalo con pareja Ioannis
  await seedRole(UID.vdeGonzalo, 'vendedor', {
    vendor: 'TEST-VDE-GONZALO',
    internalPartnerUid: UID.internoIoannis,
  });

  // VDE Pachi con pareja internoPachi
  await seedRole(UID.vdePachi, 'vendedor', {
    vendor: 'TEST-VDE-PACHI',
    internalPartnerUid: UID.internoPachi,
  });

  // VDE sin pareja: sin internalPartnerUid
  await seedRole(UID.vdeSinPareja, 'vendedor', {
    vendor: 'TEST-VDE-SIN-PAREJA',
  });

  // Cuenta sin rol (existe en /roles pero con role='unassigned')
  await seedRole(UID.sinRol, 'unassigned');
}

/** Siembra datos de clientes de prueba para los pedidos. */
export async function seedClientes() {
  await seedDoc(`client_master/${CARD_CODE_GONZALO}`, {
    cardCode: CARD_CODE_GONZALO,
    cardName: 'TEST CLIENTE GONZALO',
    assignedVendor: 'TEST-VDE-GONZALO',
    state: 'enabled',
  });
  await seedDoc(`client_master/${CARD_CODE_PACHI}`, {
    cardCode: CARD_CODE_PACHI,
    cardName: 'TEST CLIENTE PACHI',
    assignedVendor: 'TEST-VDE-PACHI',
    state: 'enabled',
  });
}

/** Siembra un stock snapshot mínimo para permitir confirmar pedidos. */
export async function seedStockSnapshot() {
  await seedDoc('app_config/stock_snapshot', {
    updatedAt: new Date().toISOString(),
    _syncRun: new Date().toISOString(),
    warehouseBreakdown: JSON.stringify({ [TEST_SKU]: { 11: 100 } }),
  });
}
