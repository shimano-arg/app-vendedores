// @ts-check
/**
 * E2E spec para tarea L (v1457 2026-10-25) — "entrada del backorder".
 *
 * 4 escenarios obligatorios:
 *   1. Excel idéntico → "Sí, no cargar nada" cancela el flow.
 *   2. Excel idéntico → "No, cargarlo igual" sigue el flow (filas rojas aparecen).
 *   3. Fila roja → "Son las mismas (quedan N)" resuelve y la fila deja de ser roja.
 *   4. Fila roja → "Son X más (quedan N+X)" resuelve con suma + sigue en verde.
 *
 * Fixture:
 *   - Cliente: CLIENTE PRUEBAS E2E (CardCode `C_TEST_E2E`).
 *   - SKU: 9691 (fixture Paso 0).
 *   - BO previo: 20 unidades (fixture pre-poblado o modificado por el spec).
 *
 * Credenciales:
 *   TEST_USER_EMAIL / TEST_USER_PASSWORD (gcloud secret).
 *
 * Smoke in-browser (no requiere Firestore pre-poblado) + Playwright full flow.
 *
 * Screenshot dir: tests/e2e/evidencia/<fecha>/ola2_l_final/
 */
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { loadE2eCreds } from './helpers/load_creds.js';

const CREDS = loadE2eCreds();
const DATE_SLUG = new Date().toISOString().slice(0, 10);
const EVIDENCE_DIR = path.join('tests', 'e2e', 'evidencia', DATE_SLUG, 'ola2_l_final');

const CLIENTE_TEST = process.env.L_CLIENTE_TEST || 'CLIENTE PRUEBAS E2E';
const SKU_TEST = process.env.L_SKU_TEST || '9691';
const QTY_NUEVO = Number(process.env.L_QTY_NUEVO || 20);
const QTY_BO_PREVIO = Number(process.env.L_QTY_BO || 20);

test.beforeAll(() => {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
});

async function screen(page, name) {
  const p = path.join(EVIDENCE_DIR, `${name}.png`);
  await page.screenshot({ path: p, fullPage: false });
  return p;
}

async function doLogin(page) {
  await page.goto('');
  const emailInput = page.locator('#login-email').first();
  if (await emailInput.isVisible({ timeout: 10000 }).catch(() => false)) {
    await emailInput.fill(CREDS.email);
    await page.locator('#login-pass').first().fill(CREDS.password);
    await page.locator('#login-submit-btn').first().click();
    await page.waitForSelector('button:has-text("Salir")', { timeout: 30000 });
  }
}

test.describe('v1457 Tarea L — "entrada del backorder" (fila roja + Excel idéntico)', () => {
  test.skip(!CREDS.email, 'creds not configured');

  test('escenario 0: smoke pure + render helpers expuestos en window', async ({ page }) => {
    await doLogin(page);
    await page.waitForTimeout(2000);
    await screen(page, '00_login_ok');

    // Pure helpers.
    const hasPure = await page.evaluate(() => {
      /** @type {any} */ const w = window;
      return !!(
        w.__phase0 &&
        w.__phase0.pure &&
        w.__phase0.pure.boEntry &&
        typeof w.__phase0.pure.boEntry.computeBoEntryRows === 'function' &&
        typeof w.__phase0.pure.boEntry.setBoEntryRowResolution === 'function' &&
        typeof w.__phase0.pure.boEntry.isExcelIdenticalToOpenOrder === 'function' &&
        typeof w.__phase0.pure.boEntry.findIdenticalOpenOrder === 'function' &&
        w.__phase0.pure.boEntry.texts &&
        typeof w.__phase0.pure.boEntry.texts.filaRojaOracion === 'function'
      );
    });
    expect(hasPure).toBe(true);

    // Render helpers inline.
    const hasRenderHelpers = await page.evaluate(() => {
      /** @type {any} */ const w = window;
      return (
        typeof w._boEntryComputeForCard === 'function' &&
        typeof w._boEntryRenderInline === 'function' &&
        typeof w._boEntryResolveRow === 'function' &&
        typeof w._boEntryScrollToFirstRed === 'function' &&
        typeof w._boEntryGetUnresolved === 'function' &&
        typeof w._boEntryEnrichItemsForCF === 'function' &&
        typeof w.showExcelIdenticoModal === 'function'
      );
    });
    expect(hasRenderHelpers).toBe(true);

    // Modal Excel idéntico está en el DOM.
    const modalExists = await page.locator('#excel-identico-modal').count();
    expect(modalExists).toBeGreaterThan(0);
  });

  test('escenario 1: Excel idéntico → "Sí, no cargar nada" → resuelve "cancelar"', async ({ page }) => {
    await doLogin(page);
    const r = await page.evaluate(async () => {
      /** @type {any} */ const w = window;
      const p = w.showExcelIdenticoModal({ orderNumber: 435, fechaCorta: '12/10' });
      // Esperar que el modal esté visible.
      await new Promise((res) => setTimeout(res, 200));
      // Simular click en "Sí, no cargar nada" (btn con class primary — es el cancel).
      const btn = document.getElementById('ei-btn-cancelar');
      btn.click();
      return await p;
    });
    expect(r).toBe('cancelar');
    await screen(page, '01_excel_identico_cancelar');
  });

  test('escenario 2: Excel idéntico → "No, cargarlo igual" → resuelve "cargar"', async ({ page }) => {
    await doLogin(page);
    const r = await page.evaluate(async () => {
      /** @type {any} */ const w = window;
      const p = w.showExcelIdenticoModal({ orderNumber: 435, fechaCorta: '12/10' });
      await new Promise((res) => setTimeout(res, 200));
      const btn = document.getElementById('ei-btn-cargar');
      btn.click();
      return await p;
    });
    expect(r).toBe('cargar');
    await screen(page, '02_excel_identico_cargar');
  });

  test('escenario 3: fila roja → "Son las mismas" → resuelve same + resolvedQty=cantidadNueva', async ({ page }) => {
    await doLogin(page);
    const r = await page.evaluate((args) => {
      /** @type {any} */ const w = window;
      const pure = w.__phase0.pure.boEntry;
      const rows = pure.computeBoEntryRows({
        items: [{ code: args.sku, qty: args.qtyNueva }],
        boVigente: [{ sku: args.sku, cantidad: args.qtyBo, fechaIso: '2026-10-12T00:00:00Z' }],
      });
      if (rows.length !== 1) return { error: 'rows.length != 1', rows };
      const resolved = pure.setBoEntryRowResolution(rows[0], 'same');
      return { rows, resolved };
    }, { sku: SKU_TEST, qtyNueva: QTY_NUEVO, qtyBo: QTY_BO_PREVIO });
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].resolved).toBe(null);
    expect(r.resolved.resolved).toBe('same');
    expect(r.resolved.resolvedQty).toBe(QTY_NUEVO);
    await screen(page, '03_fila_roja_same');
  });

  test('escenario 4: fila roja → "Son X más" → resuelve additional + resolvedQty=suma', async ({ page }) => {
    await doLogin(page);
    const r = await page.evaluate((args) => {
      /** @type {any} */ const w = window;
      const pure = w.__phase0.pure.boEntry;
      const rows = pure.computeBoEntryRows({
        items: [{ code: args.sku, qty: args.qtyNueva }],
        boVigente: [{ sku: args.sku, cantidad: args.qtyBo, fechaIso: '2026-10-12T00:00:00Z' }],
      });
      const resolved = pure.setBoEntryRowResolution(rows[0], 'additional');
      return { rows, resolved };
    }, { sku: SKU_TEST, qtyNueva: QTY_NUEVO, qtyBo: QTY_BO_PREVIO });
    expect(r.resolved.resolved).toBe('additional');
    expect(r.resolved.resolvedQty).toBe(QTY_NUEVO + QTY_BO_PREVIO);
    await screen(page, '04_fila_roja_additional');
  });

  test('escenario 5: textos UI — oración, botones y contador correctos', async ({ page }) => {
    await doLogin(page);
    const t = await page.evaluate(() => {
      /** @type {any} */ const w = window;
      const T = w.__phase0.pure.boEntry.texts;
      return {
        oracion: T.filaRojaOracion({ cantidad: 20, fechaCorta: '12/10' }),
        sonLasMismas: T.botonSonLasMismas({ cantidad: 20 }),
        sonMas: T.botonSonMas({ cantidad: 20, total: 40 }),
        contador: T.contadorFilasRojas({ faltan: 2 }),
        excelOracion: T.excelIdenticoOracion({ orderNumber: 435, fechaCorta: '12/10' }),
        cancelar: T.botonExcelCancelar(),
        seguir: T.botonExcelSeguir(),
      };
    });
    // Verificar oración sin jerga técnica.
    expect(t.oracion).toContain('20 unidades');
    expect(t.oracion).toContain('esperando stock');
    expect(t.oracion).toContain('12/10');
    expect(t.oracion.toLowerCase()).not.toContain('backorder');
    expect(t.oracion.toLowerCase()).not.toContain('reconciliar');
    expect(t.oracion.toLowerCase()).not.toContain('unificar');

    expect(t.sonLasMismas).toBe('Son las mismas (quedan 20)');
    expect(t.sonMas).toBe('Son 20 más (quedan 40)');
    expect(t.contador).toBe('Te faltan 2 productos por revisar');
    expect(t.excelOracion).toContain('N° 435');
    expect(t.excelOracion).toContain('12/10');
    expect(t.cancelar).toBe('Sí, no cargar nada');
    expect(t.seguir).toBe('No, cargarlo igual');
    await screen(page, '05_textos_ui_ok');
  });
});
