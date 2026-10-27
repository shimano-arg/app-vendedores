// @ts-check
/**
 * Spec Playwright E2E v1490 §88 (2026-10-27) — visibilidad VDE.
 *
 * Verifica que un vendedor VDE (PACHI vía secrets gcloud) logueado en la app
 * ve pedidos cargados por admin desde "Crear Pedido Desde Stock Asignado"
 * para sus clientes.
 *
 * Antes v1490: los listeners `pedidos_own` + `pedidos_all` filtraban por
 * ownerUid → VDE perdía pedidos CPST (admin cargó). Post-fix: filtran por
 * assignedVendorUid (vendedor del cliente master, §44).
 *
 * Si los secrets `test-pachi-email` / `test-pachi-password` son placeholder,
 * el test se SKIPea con mensaje.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';

function fetchSecret(name) {
  const r = spawnSync(
    'gcloud',
    [
      'secrets',
      'versions',
      'access',
      'latest',
      `--secret=${name}`,
      '--project=app-vendedores-shimano',
    ],
    { encoding: 'utf8', shell: true }
  );
  if (r.status !== 0) return null;
  return (r.stdout || '').replace(/\r?\n$/, '');
}

function loadCreds() {
  const email = process.env.TEST_PACHI_EMAIL || fetchSecret('test-pachi-email') || '';
  const password = process.env.TEST_PACHI_PASSWORD || fetchSecret('test-pachi-password') || '';
  if (!email || !password || /placeholder/i.test(password)) {
    return { email: null, password: null };
  }
  return { email, password };
}

const CREDS = loadCreds();
const FECHA = new Date().toISOString().slice(0, 10);
const EVIDENCIA_DIR = `tests/e2e/evidencia/${FECHA}/visibility_vde_v1490`;

test.beforeAll(() => fs.mkdirSync(EVIDENCIA_DIR, { recursive: true }));

async function screen(page, name) {
  const p = path.join(EVIDENCIA_DIR, `${name}.png`);
  await page.screenshot({ path: p, fullPage: true });
  return p;
}

test('v1490 §88 — VDE ve pedidos CPST cargados por admin (assignedVendorUid)', async ({ page }) => {
  test.skip(
    !CREDS.email,
    'secrets test-pachi-* placeholder; set up gcloud secrets o env TEST_PACHI_*'
  );

  // 1. Login.
  await page.goto('');
  await page.locator('#login-email').first().fill(CREDS.email);
  await page.locator('#login-pass').first().fill(CREDS.password);
  await page.locator('button:has-text("Entrar")').first().click();
  await page.waitForFunction(
    () => typeof window.currentUser !== 'undefined' && window.currentUser && window.currentUser.uid,
    null,
    { timeout: 30000 }
  );

  // 2. Esperar que los listeners carguen globalPedidos.
  await page.waitForFunction(() => window._pedidosSnapshotLoaded === true, null, {
    timeout: 20000,
  });

  // 3. Inspeccionar el filtro que usa el listener.
  const diagnostico = await page.evaluate(() => {
    const uid = window.currentUser.uid;
    const role = window.userRole;
    const pedidos = Array.isArray(window.globalPedidos) ? window.globalPedidos : [];
    // Verificar que al menos UN pedido no fue cargado por el user mismo
    // (indica que el filtro NO es ownerUid-only post-§88).
    const nonOwnPedidos = pedidos.filter((p) => p && p.ownerUid && p.ownerUid !== uid);
    return {
      uid,
      role,
      totalPedidos: pedidos.length,
      nonOwnCount: nonOwnPedidos.length,
      sampleNonOwn: nonOwnPedidos.slice(0, 3).map((p) => ({
        orderNumber: p.orderNumber || null,
        clientName: p.clientName || null,
        ownerUid: p.ownerUid,
        assignedVendorUid: p.assignedVendorUid || null,
      })),
    };
  });

  await screen(page, '01_post_login_globalPedidos');

  console.log('[v1490 §88] diagnóstico VDE:', JSON.stringify(diagnostico, null, 2));

  expect(diagnostico.role).toBe('vendedor');
  // El VDE debe ver al menos UN pedido (si no, el listener está roto).
  expect(diagnostico.totalPedidos).toBeGreaterThan(0);
  // Al menos UN pedido no cargado por él mismo (CPST o unificado por admin).
  // Si falla este expect, significa que el fix v1490 no está desplegado
  // o que PACHI no tiene pedidos cargados por otros users (edge raro).
  expect(diagnostico.nonOwnCount).toBeGreaterThan(0);
  // El pedido debe tener assignedVendorUid === uid del VDE (confirma §44).
  for (const sample of diagnostico.sampleNonOwn) {
    expect(sample.assignedVendorUid).toBe(diagnostico.uid);
  }
});
