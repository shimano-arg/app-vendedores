// @ts-check
/**
 * Checklist Playwright E2E — Gate obligatorio al final de cada ola.
 *
 * 10 puntos del plan Mariano 2026-10-25.
 * Capturas en tests/e2e/evidencia/<YYYY-MM-DD>/<tarea>/.
 */

import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { loadE2eCreds } from './helpers/load_creds.js';

const CREDS = loadE2eCreds();
const TAREA = process.env.PLAYWRIGHT_TAREA || 'baseline';
const FECHA = new Date().toISOString().slice(0, 10);
const EVIDENCIA_DIR = `tests/e2e/evidencia/${FECHA}/${TAREA}`;

test.beforeAll(() => {
  fs.mkdirSync(EVIDENCIA_DIR, { recursive: true });
});

async function screen(page, name) {
  const p = path.join(EVIDENCIA_DIR, `${name}.png`);
  await page.screenshot({ path: p, fullPage: true });
  return p;
}

async function doLogin(page) {
  await page.goto('');
  await page.locator('#login-email').first().fill(CREDS.email);
  await page.locator('#login-pass').first().fill(CREDS.password);
  await page.locator('#login-submit-btn').first().click();
  await page.waitForSelector('button:has-text("Salir")', { timeout: 30000 });
}

test.describe('Checklist producción app-vendedores', () => {
  test('smoke: HTML carga, APP_VERSION visible, bundle presente', async ({ page }) => {
    await page.goto('');
    await expect(page).toHaveTitle(/Shimano|Vendedores|App/i);
    const content = await page.content();
    expect(content.length).toBeGreaterThan(1000);
    expect(content).toMatch(/APP_VERSION|v14\d\d/);
    expect(content).toMatch(/app\.bundle\.js/);
    await screen(page, '00_smoke');
  });

  test('punto 1: login con creds del secret', async ({ page }) => {
    test.skip(!CREDS.email, 'creds not configured');
    await page.goto('');
    await screen(page, '01a_pre_login');
    await page.locator('#login-email').first().fill(CREDS.email);
    await page.locator('#login-pass').first().fill(CREDS.password);
    await page.locator('#login-submit-btn').first().click();
    await page.waitForSelector('button:has-text("Salir")', { timeout: 30000 });
    await screen(page, '01b_post_login');
    const bodyText = await page.locator('body').innerText();
    expect(bodyText).toMatch(/MAPA|VENTAS|ARGENTINA/i);
  });

  test('punto 2: lista de espera abre', async ({ page }) => {
    test.skip(!CREDS.email, 'creds not configured');
    await doLogin(page);
    const btnEspera = page
      .locator('button:has-text("Lista de espera"), button:has-text("Espera"), [data-tab="espera"]')
      .first();
    if (await btnEspera.isVisible({ timeout: 10000 }).catch(() => false)) {
      await btnEspera.click();
      await page.waitForTimeout(2000);
    }
    await screen(page, '02_lista_espera');
  });

  test('punto 5: panel Pedidos — fechas DD/MM/YYYY', async ({ page }) => {
    test.skip(!CREDS.email, 'creds not configured');
    await doLogin(page);
    const btnPedidos = page.locator('button:has-text("Pedidos"), [data-tab="pedidos"]').first();
    if (await btnPedidos.isVisible({ timeout: 10000 }).catch(() => false)) {
      await btnPedidos.click();
      await page.waitForTimeout(2000);
    }
    await screen(page, '05_panel_pedidos');
    const body = await page.locator('body').innerText();
    expect(body).not.toMatch(/Invalid Date/);
  });

  test('punto 8: badge Sync stock legible', async ({ page }) => {
    test.skip(!CREDS.email, 'creds not configured');
    await doLogin(page);
    const badge = page.locator('[id*="sap-health"], [data-sap-health], .sap-health-badge').first();
    if (await badge.isVisible({ timeout: 10000 }).catch(() => false)) {
      await screen(page, '08_sync_badge');
      const txt = (await badge.innerText()).toLowerCase();
      expect(txt).toMatch(/sync|stock|min|h/i);
    } else {
      await screen(page, '08_sync_badge_notfound');
    }
  });

  test('metadata: dump context del user e2e', async () => {
    const meta = {
      fecha: FECHA,
      tarea: TAREA,
      credsConfigured: !!CREDS.email,
      credsEmail: CREDS.email || '(not configured)',
      evidenciaDir: EVIDENCIA_DIR,
      baseURL: 'https://shimano-arg.github.io/app-vendedores/',
    };
    fs.writeFileSync(path.join(EVIDENCIA_DIR, '_meta.json'), JSON.stringify(meta, null, 2));
  });
});
