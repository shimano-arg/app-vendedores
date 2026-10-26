// @ts-check
/**
 * E2E spec para tarea I del plan 2026-10-25 (v1454 §67).
 *
 * Verifica que `_gbConfirmar` (Generar Backorder manual) pasa por
 * commitPedidoCF y el pedido final tiene `_commitVersion='commitPedidoCore_v1'`.
 *
 * Prerequisitos:
 *   - CLIENTE PRUEBAS E2E existe en Firestore (o se adapta a otro cliente real).
 *   - test user tiene rol admin o gerente (puede abrir modal Generar Backorder).
 *   - SKU test accesible via PRODUCTS cache (ej. 'TEST001' o un SKU real).
 *
 * Credenciales del secret:
 *   TEST_USER_EMAIL     → gcloud secret: test-user-email
 *   TEST_USER_PASSWORD  → gcloud secret: test-user-password
 *   TEST_CLIENT_NAME    → opcional (default 'CLIENTE PRUEBAS E2E').
 *   TEST_SKU            → opcional (default primer SKU disponible).
 *
 * Config Playwright: channel 'msedge' (no chromium — cert corp).
 *
 * Screenshot: tests/e2e/evidencia/<fecha>/I/
 *
 * Si no corre (env sin Playwright instalado, SSL cert, cliente E2E no creado),
 * documentar en el PR body: "spec escrito, env bloqueó la ejecución".
 */

import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';

const TEST_USER_EMAIL = process.env.TEST_USER_EMAIL || '';
const TEST_USER_PASSWORD = process.env.TEST_USER_PASSWORD || '';
const APP_URL = process.env.APP_URL || 'https://shimano-arg.github.io/app-vendedores/';
const TEST_CLIENT_NAME = process.env.TEST_CLIENT_NAME || 'CLIENTE PRUEBAS E2E';
const TEST_SKU = process.env.TEST_SKU || '';

const DATE_SLUG = new Date().toISOString().slice(0, 10);
const EVIDENCE_DIR = path.join('tests', 'e2e', 'evidencia', DATE_SLUG, 'I');

test.beforeAll(async () => {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
});

test.describe('v1454 §67 — Generar Backorder manual pasa por commitPedidoCF (I)', () => {
  test.skip(!TEST_USER_EMAIL || !TEST_USER_PASSWORD, 'TEST_USER_EMAIL/PASSWORD no provistos');

  test('crear backorder manual → pedido con _commitVersion=commitPedidoCore_v1', async ({
    page,
  }) => {
    // 1. Login.
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    const emailInput = page.locator('input[type="email"]');
    if (await emailInput.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await emailInput.fill(TEST_USER_EMAIL);
      await page.locator('input[type="password"]').fill(TEST_USER_PASSWORD);
      await page
        .locator('button[type="submit"], button:has-text("Ingresar"), button:has-text("Login")')
        .first()
        .click();
    }
    // Esperar que la app arranque.
    await page.waitForSelector('#sap-health-badge', { timeout: 30_000 });
    await page.screenshot({ path: path.join(EVIDENCE_DIR, '01_app_loaded.png') });

    // 2. Abrir modal Generar Backorder.
    // El botón vive en el modal Backorder (openBackordersTab). Buscamos por texto
    // visible o por id (según el DOM del header).
    const gbTrigger = page
      .locator(
        'button:has-text("Generar Backorder"), button:has-text("Backorder Manual"), #btn-generar-backorder'
      )
      .first();
    if (await gbTrigger.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await gbTrigger.click();
    } else {
      // Fallback: invocar la función global desde el runtime.
      await page.evaluate(() => {
        if (typeof window.openGenerarBackorderModal === 'function') {
          window.openGenerarBackorderModal();
        }
      });
    }
    await page.waitForSelector(
      '#generar-backorder-modal.open, #generar-backorder-modal:not(.closed)',
      {
        timeout: 10_000,
      }
    );
    await page.screenshot({ path: path.join(EVIDENCE_DIR, '02_gb_modal_open.png') });

    // 3. Elegir cliente.
    const cliInput = page.locator('#gb-cliente').first();
    await cliInput.fill(TEST_CLIENT_NAME);
    await page.waitForTimeout(500); // dejar que el resolver corra.
    // Click en el primer resultado del dropdown si aparece.
    const firstMatch = page.locator('#gb-cliente-matches li, #gb-cliente-matches div').first();
    if (await firstMatch.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await firstMatch.click();
    }
    await page.screenshot({ path: path.join(EVIDENCE_DIR, '03_cliente_resolved.png') });

    // 4. Agregar un SKU.
    const skuInput = page.locator('.gb-sku-input, input[name="gb-sku"]').first();
    const skuFinal =
      TEST_SKU ||
      (await page.evaluate(() => {
        // Primer SKU disponible en PRODUCTS.
        const products =
          typeof window.PRODUCTS === 'object' && Array.isArray(window.PRODUCTS)
            ? window.PRODUCTS
            : [];
        const first = products.find((p) => p && p.code);
        return first ? first.code : '';
      }));
    if (!skuFinal) {
      test.skip(true, 'No se pudo determinar SKU test; setear TEST_SKU env.');
      return;
    }
    await skuInput.fill(skuFinal);
    await page.waitForTimeout(200);
    const qtyInput = page.locator('.gb-qty-input, input[name="gb-qty"]').first();
    await qtyInput.fill('1');
    await page.screenshot({ path: path.join(EVIDENCE_DIR, '04_sku_added.png') });

    // 5. Confirmar (dispara _gbConfirmar).
    // Interceptar el confirm() nativo para auto-aceptar.
    page.on('dialog', (d) => d.accept());
    const confirmBtn = page.locator('#gb-confirm-btn').first();
    await confirmBtn.click();

    // 6. Esperar success (alert de "Backorder manual ORDEN N guardado").
    //    El dialog listener ya autoaccepta; esperamos el close del modal.
    await page.waitForSelector('#generar-backorder-modal:not(.open)', { timeout: 20_000 });
    await page.screenshot({ path: path.join(EVIDENCE_DIR, '05_post_confirm.png') });

    // 7. Validar via Firestore (en el browser context) que existe un pedido
    //    reciente con _commitVersion='commitPedidoCore_v1' + source='manual-backorder'
    //    + clientName=TEST_CLIENT_NAME.
    const validatePedido = await page.evaluate(async (clientName) => {
      try {
        if (!window.fbDb || !window.firebase) return { ok: false, reason: 'firebase_missing' };
        const snap = await window.fbDb
          .collection('pedidos')
          .where('clientName', '==', clientName)
          .where('source', '==', 'manual-backorder')
          .orderBy('createdAt', 'desc')
          .limit(1)
          .get();
        if (snap.empty) return { ok: false, reason: 'no_pedido' };
        const doc = snap.docs[0];
        const data = doc.data();
        return {
          ok: true,
          pedidoId: doc.id,
          hasCommitVersion: data._commitVersion === 'commitPedidoCore_v1',
          commitVersion: data._commitVersion,
          source: data.source,
          transferidoSAP: data.transferidoSAP,
        };
      } catch (e) {
        return { ok: false, reason: 'exception', err: String(e && e.message) };
      }
    }, TEST_CLIENT_NAME);

    console.log('[E2E I validate] result:', JSON.stringify(validatePedido));
    expect(validatePedido.ok).toBe(true);
    expect(validatePedido.hasCommitVersion).toBe(true);
    expect(validatePedido.commitVersion).toBe('commitPedidoCore_v1');
    expect(validatePedido.source).toBe('manual-backorder');
    expect(validatePedido.transferidoSAP).toEqual(
      expect.objectContaining({ via: 'manual-backorder', skipSap: true })
    );

    // 8. Screenshot evidencia final.
    await page.screenshot({ path: path.join(EVIDENCE_DIR, '06_validated.png') });
  });
});
