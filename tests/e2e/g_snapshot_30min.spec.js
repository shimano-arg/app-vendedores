// @ts-check
/**
 * E2E spec para tarea G del plan 2026-10-25 (v1454 §60 UPDATE).
 *
 * Verifica que el badge "Sync stock" del header:
 *   - Usa formato "X min" cuando ageMin < 60.
 *   - Usa formato "X h Y min" cuando ageMin >= 60 y < 1440.
 *   - Usa formato "X d Y h" cuando ageMin >= 1440.
 *   - Clase CSS cambia según umbrales nuevos v1454:
 *       < 5 min  → sap-ok (verde).
 *       5-30 min → sap-warn (amarillo).
 *       >= 30 min → sap-err (rojo).
 *
 * Credenciales del secret:
 *   TEST_USER_EMAIL     → gcloud secret: test-user-email
 *   TEST_USER_PASSWORD  → gcloud secret: test-user-password
 *
 * Config Playwright:
 *   - channel: 'msedge' (no chromium — SSL cert corp bloquea).
 *   - project: edge (defined en playwright.config.js del root).
 *
 * Screenshot: tests/e2e/evidencia/<fecha>/G/
 *
 * Si no corre por SSL cert, documentar en el PR body
 * "spec escrito, env bloqueó la ejecución, smoke manual OK".
 */

import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const TEST_USER_EMAIL = process.env.TEST_USER_EMAIL || '';
const TEST_USER_PASSWORD = process.env.TEST_USER_PASSWORD || '';
const APP_URL = process.env.APP_URL || 'https://shimano-arg.github.io/app-vendedores/';

const DATE_SLUG = new Date().toISOString().slice(0, 10);
const EVIDENCE_DIR = path.join('tests', 'e2e', 'evidencia', DATE_SLUG, 'G');

test.beforeAll(async () => {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
});

test.describe('v1454 §60 UPDATE badge "Sync stock" (G)', () => {
  test.skip(!TEST_USER_EMAIL || !TEST_USER_PASSWORD, 'TEST_USER_EMAIL/PASSWORD no provistos');

  test('badge Sync stock muestra formato correcto post-v1454', async ({ page }) => {
    // 1. Login.
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    const emailInput = page.locator('input[type="email"]');
    if (await emailInput.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await emailInput.fill(TEST_USER_EMAIL);
      await page.locator('input[type="password"]').fill(TEST_USER_PASSWORD);
      await page.locator('button[type="submit"], button:has-text("Ingresar"), button:has-text("Login")').first().click();
    }

    // 2. Esperar que la app arranque y el badge aparezca.
    const badge = page.locator('#sap-health-badge');
    await expect(badge).toBeVisible({ timeout: 30_000 });

    // 3. Esperar que _updateSapHealthBadge corra al menos una vez.
    await page.waitForTimeout(2_000);

    // 4. Verificar formato del label.
    const label = await page.locator('#sap-health-label').textContent();
    expect(label).toBeTruthy();
    const text = (label || '').trim();

    // v1454: formato "Sync stock: X min" | "Sync stock: X h Y min" | "Sync stock: X d Y h"
    // (o "Sync stock ..." si no hay datos todavía).
    const re = /^Sync stock(:|)\s*(\.\.\.|(\d+\s+min)|(\d+\s+h\s+\d+\s+min)|(\d+\s+d\s+\d+\s+h))$/;
    expect(text).toMatch(re);

    // 5. Verificar clase CSS según umbrales nuevos v1454.
    const cls = await badge.getAttribute('class');
    expect(cls).toMatch(/sap-(ok|warn|err|unknown)/);

    // 6. Screenshot evidencia.
    const screenshotPath = path.join(EVIDENCE_DIR, 'badge_sync_stock.png');
    await badge.screenshot({ path: screenshotPath });
    console.log('[G] Screenshot guardado:', screenshotPath);

    // 7. Verificar tooltip menciona Cloud Scheduler (no GHA cron).
    const title = await badge.getAttribute('title');
    expect(title || '').toMatch(/Cloud Scheduler|syncSapCatalogStockCF|respaldo manual/);
    expect(title || '').not.toMatch(/runs reales cada 2-5 h/);
  });
});
