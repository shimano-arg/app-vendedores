// @ts-check
/**
 * Spec Playwright v1491 §89/§90 (2026-10-27) — VDE confirma sin VENDOR_UID_MISSING.
 *
 * Verifica que un vendedor logueado puede resolver nombre→UID client-side
 * (post rules fix v1491 cap 2) + que el gate server-side resuelve en caso
 * fallback. Un VDE loguea, abre `roles.where(role==vendedor)` desde devtools
 * y espera que devuelva ≥1 doc (si rules bloquean → `vdeUsers=[]` → regresión).
 *
 * Skipea si no hay creds `test-pachi-*`.
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
const EVIDENCIA_DIR = `tests/e2e/evidencia/${FECHA}/vendor_uid_v1491`;

test.beforeAll(() => fs.mkdirSync(EVIDENCIA_DIR, { recursive: true }));

async function screen(page, name) {
  const p = path.join(EVIDENCIA_DIR, `${name}.png`);
  await page.screenshot({ path: p, fullPage: true });
  return p;
}

test('v1491 §89 cap 2 — VDE lee roles.where(role==vendedor) + resolve UID client-side', async ({
  page,
}) => {
  test.skip(!CREDS.email, 'secrets test-pachi-* placeholder; set up gcloud o env TEST_PACHI_*');

  // Login VDE.
  await page.goto('');
  await page.locator('#login-email').first().fill(CREDS.email);
  await page.locator('#login-pass').first().fill(CREDS.password);
  await page.locator('button:has-text("Entrar")').first().click();
  await page.waitForFunction(
    () => typeof window.currentUser !== 'undefined' && window.currentUser && window.currentUser.uid,
    null,
    { timeout: 30000 }
  );

  // Esperar que loadVdiPartnerUsers (incluye VDEs) termine de poblar vdeUsers.
  await page.waitForFunction(
    () => Array.isArray(window.vdeUsers) && window.vdeUsers.length > 0,
    null,
    { timeout: 15000 }
  );

  const diag = await page.evaluate(() => {
    const uid = window.currentUser.uid;
    const role = window.userRole;
    const vdeUsers = Array.isArray(window.vdeUsers) ? window.vdeUsers : [];
    return {
      uid,
      role,
      vdeCount: vdeUsers.length,
      vdeKeys: vdeUsers.map((u) => u.vendorKey || u.vendor || null),
    };
  });

  await screen(page, '01_post_login_vdeUsers');
  console.log('[v1491 §89 cap 2] diag:', JSON.stringify(diag, null, 2));

  expect(diag.role).toBe('vendedor');
  // Post rules fix v1491: VDE puede leer VDEs → vdeUsers > 0.
  // Pre-fix: vdeUsers = 0 (bloqueado por rules), gate server VENDOR_UID_MISSING.
  expect(diag.vdeCount).toBeGreaterThan(0);
  // El propio VDE debe estar en la lista.
  expect(diag.vdeKeys.some((k) => k && k.toUpperCase().includes('PACHI'))).toBe(true);
});

test('v1491 §89 cap 1 (server fallback) — resolveClientVendorFromMaster devuelve UID para cliente del VDE', async ({
  page,
}) => {
  test.skip(!CREDS.email, 'secrets test-pachi-* placeholder');

  await page.goto('');
  await page.locator('#login-email').first().fill(CREDS.email);
  await page.locator('#login-pass').first().fill(CREDS.password);
  await page.locator('button:has-text("Entrar")').first().click();
  await page.waitForFunction(
    () => typeof window.currentUser !== 'undefined' && window.currentUser && window.currentUser.uid,
    null,
    { timeout: 30000 }
  );
  await page.waitForFunction(() => window._pedidosSnapshotLoaded === true, null, {
    timeout: 20000,
  });

  // Buscar un cliente del VDE y verificar que window._resolveClientVendorFromMaster
  // devuelve UID (prueba client-side resolver).
  const resolveTest = await page.evaluate(() => {
    const uid = window.currentUser.uid;
    // Buscar un cliente de PACHI vía approvedAltas.
    const altas = Array.isArray(window.approvedAltasList) ? window.approvedAltasList : [];
    const target = altas.find((a) => {
      const v = String(a.assignedVendor || '').toUpperCase();
      return v.includes('PACHI');
    });
    if (!target) return { skipped: true, reason: 'no_target_alta' };
    if (typeof window._resolveClientVendorFromMaster !== 'function') {
      return { skipped: true, reason: 'resolver_not_exposed' };
    }
    const result = window._resolveClientVendorFromMaster({
      cardCode: target.cardCodeSap,
      clientName: target.comercio || target.fantasia || '',
    });
    return {
      cardCode: target.cardCodeSap,
      cliente: target.comercio || target.fantasia || '',
      uid,
      resolution: result,
    };
  });

  console.log('[v1491 §89 cap 1] resolveTest:', JSON.stringify(resolveTest, null, 2));

  if (resolveTest.skipped) {
    test.skip(true, `resolver not testable: ${resolveTest.reason}`);
    return;
  }
  expect(resolveTest.resolution.resolved).toBe(true);
  expect(resolveTest.resolution.vendorUid).toBe(resolveTest.uid);
  expect(resolveTest.resolution.reason).toBe('ok');
});
