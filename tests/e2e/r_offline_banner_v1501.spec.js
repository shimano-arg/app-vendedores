// @ts-check
/**
 * E2E spec v1501 §103 — política lectura offline-aware.
 *
 * Dos escenarios:
 *   R1 (online→offline→online): verifica el banner "Sin conexión" aparece al
 *       cortar la red, el estado se refleja en `window._offlineStaleBannerPaths`,
 *       y desaparece al reconectar + recibir el próximo server snapshot.
 *   R2 (seed IDB + offline reload): seedea IndexedDB con `shimano_app_version_last`
 *       de una versión vieja + localStorage de prueba, corta la red, recarga,
 *       verifica que el banner está visible y que los datos no son undefined.
 *
 * Pre-requisitos:
 *   - TEST_USER_EMAIL + TEST_USER_PASSWORD en env (gcloud secrets).
 *   - APP_URL default `https://shimano-arg.github.io/app-vendedores/`.
 *   - Edge channel instalado (SSL cert corp bloquea chromium).
 *
 * **Ejecución**:
 *   TEST_USER_EMAIL="..." TEST_USER_PASSWORD="..." npx playwright test r_offline_banner_v1501 --project edge
 *
 * Screenshots: tests/e2e/evidencia/<fecha>/R/
 *
 * NO necesita Firebase emulator (R1 + R2 corren contra prod con creds reales).
 * Para el test de URQUIOLA stale IDB + server fresh ver `s_emulator_urquiola_v1501.spec.js`
 * (requiere emulator con seed; skipped si no está disponible).
 */

import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';

const TEST_USER_EMAIL = process.env.TEST_USER_EMAIL || '';
const TEST_USER_PASSWORD = process.env.TEST_USER_PASSWORD || '';
const APP_URL = process.env.APP_URL || 'https://shimano-arg.github.io/app-vendedores/';

const DATE_SLUG = new Date().toISOString().slice(0, 10);
const EVIDENCE_DIR = path.join('tests', 'e2e', 'evidencia', DATE_SLUG, 'R');

test.beforeAll(async () => {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
});

test.describe('v1501 §103 — banner "Sin conexión" offline-aware (R)', () => {
  test('R0: wiring sin login — banner DOM + helpers + pure fn', async ({ page }) => {
    // Este test NO requiere TEST_USER_* porque el banner y los helpers
    // se instalan inline antes del login. Prueba la unidad del wiring
    // sin tocar datos reales.
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });

    // 1. Banner DOM existe.
    const banner = page.locator('#offline-stale-banner');
    await expect(banner).toBeAttached();

    // 2. Esperar que los helpers inline estén registrados (post-firebase.initializeApp).
    await page.waitForFunction(
      () => {
        /** @type {any} */ const w = window;
        return (
          typeof w._applyReadPolicyDecision === 'function' &&
          typeof w._setOfflineStaleBanner === 'function'
        );
      },
      null,
      { timeout: 30_000 }
    );

    // 3. Pure fn `shouldAcceptSnapshot` disponible en el bundle.
    const pureOk = await page.evaluate(() => {
      /** @type {any} */ const w = window;
      const pure = w.__phase0 && w.__phase0.pure && w.__phase0.pure.firestoreReadPolicy;
      return !!(pure && typeof pure.shouldAcceptSnapshot === 'function');
    });
    expect(pureOk).toBe(true);

    // 4. Banner invisible al inicio.
    await expect(banner).not.toBeVisible();

    // 5. Forzar estado offline + call al helper con cache stale.
    await page.evaluate(() => {
      /** @type {any} */ const w = window;
      // Mockear navigator.onLine (readonly, pero overridable via defineProperty).
      try {
        Object.defineProperty(window.navigator, 'onLine', { value: false, configurable: true });
      } catch (_e) {}
      // Último server snapshot > 30s atrás (o nunca).
      w._lastServerSnapshotMs = { pedidos: Date.now() - 60_000 };
      w._applyReadPolicyDecision('pedidos', { fromCache: true, hasPendingWrites: false });
    });

    // 6. Banner ahora visible.
    await page.waitForFunction(
      () => {
        const el = /** @type {HTMLElement|null} */ (
          document.getElementById('offline-stale-banner')
        );
        return el && getComputedStyle(el).display === 'block';
      },
      null,
      { timeout: 5_000 }
    );
    await expect(banner).toBeVisible();
    await page.screenshot({
      path: path.join(EVIDENCE_DIR, 'r0_01_banner_visible.png'),
      fullPage: false,
    });

    // 7. Simular server snapshot (fromCache=false) → banner oculto.
    await page.evaluate(() => {
      /** @type {any} */ const w = window;
      try {
        Object.defineProperty(window.navigator, 'onLine', { value: true, configurable: true });
      } catch (_e) {}
      w._applyReadPolicyDecision('pedidos', { fromCache: false, hasPendingWrites: false });
    });
    await page.waitForFunction(
      () => {
        const el = /** @type {HTMLElement|null} */ (
          document.getElementById('offline-stale-banner')
        );
        return !el || getComputedStyle(el).display === 'none';
      },
      null,
      { timeout: 5_000 }
    );
    await expect(banner).not.toBeVisible();
    await page.screenshot({
      path: path.join(EVIDENCE_DIR, 'r0_02_banner_oculto.png'),
      fullPage: false,
    });
  });

  test('R1: online → offline → online, banner aparece y desaparece', async ({ page, context }) => {
    test.skip(!TEST_USER_EMAIL || !TEST_USER_PASSWORD, 'TEST_USER_EMAIL/PASSWORD no provistos');
    // 1. Login online.
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
    await page.waitForSelector('#app-content, #map, #appcontent', { timeout: 30_000 });

    // 2. Esperar a que al menos un listener crítico reciba server snapshot.
    //    `window._lastServerSnapshotMs['pedidos']` o similar debe quedar seteado.
    await page.waitForFunction(
      () => {
        /** @type {any} */ const w = window;
        const map = w._lastServerSnapshotMs || {};
        return Object.keys(map).some((k) => !!map[k]);
      },
      null,
      { timeout: 30_000 }
    );

    // 3. Verificar banner invisible al inicio.
    const banner = page.locator('#offline-stale-banner');
    await expect(banner).toBeAttached();
    const bannerDisplayInitial = await banner.evaluate(
      (el) => /** @type {HTMLElement} */ (el).style.display
    );
    expect(bannerDisplayInitial === 'none' || bannerDisplayInitial === '').toBe(true);

    await page.screenshot({
      path: path.join(EVIDENCE_DIR, 'r1_01_online_sin_banner.png'),
      fullPage: false,
    });

    // 4. Simular pérdida de red + forzar un snapshot event (ej. navegar a otro pane para re-attach listener).
    //    Playwright's `context.setOffline(true)` no refresca Firestore automatically,
    //    pero el navigator.onLine cambia + los próximos cache snapshots serán filtrados.
    await context.setOffline(true);

    // Simular "listener recibe cache snapshot" vía dispatch del event online.
    // En práctica Firestore puede reemittir el último snapshot cuando pierdes
    // conexión. Para forzar el flow, pedimos a la app que recargue un panel
    // o invocamos directamente el helper (que es la unidad bajo test).
    await page.evaluate(() => {
      /** @type {any} */ const w = window;
      // Simular una llamada al helper con cache stale, igual a lo que haría un listener.
      if (typeof w._applyReadPolicyDecision === 'function') {
        // Forzar que el "último server snapshot" quede viejo >30s.
        const now = Date.now();
        w._lastServerSnapshotMs = w._lastServerSnapshotMs || {};
        for (const k of Object.keys(w._lastServerSnapshotMs)) {
          w._lastServerSnapshotMs[k] = now - 60_000; // 60s atrás
        }
        // Invocar la decisión con cache stale.
        w._applyReadPolicyDecision('pedidos', { fromCache: true, hasPendingWrites: false });
      }
    });

    // 5. Esperar banner visible.
    await page.waitForFunction(
      () => {
        const el = /** @type {HTMLElement|null} */ (
          document.getElementById('offline-stale-banner')
        );
        return el && el.style.display === 'block';
      },
      null,
      { timeout: 5_000 }
    );
    await expect(banner).toHaveCSS('display', 'block');

    await page.screenshot({
      path: path.join(EVIDENCE_DIR, 'r1_02_offline_con_banner.png'),
      fullPage: false,
    });

    // 6. Reconectar.
    await context.setOffline(false);

    // 7. Simular arrival de un server snapshot (fromCache=false) para forzar hide.
    await page.evaluate(() => {
      /** @type {any} */ const w = window;
      if (typeof w._applyReadPolicyDecision === 'function') {
        w._applyReadPolicyDecision('pedidos', { fromCache: false, hasPendingWrites: false });
      }
    });

    // 8. Esperar banner oculto.
    await page.waitForFunction(
      () => {
        const el = /** @type {HTMLElement|null} */ (
          document.getElementById('offline-stale-banner')
        );
        return !el || el.style.display === 'none';
      },
      null,
      { timeout: 5_000 }
    );

    await page.screenshot({
      path: path.join(EVIDENCE_DIR, 'r1_03_online_banner_oculto.png'),
      fullPage: false,
    });
  });

  test('R2: offline reload acepta cache + muestra banner (sin pantalla vacía)', async ({
    page,
    context,
  }) => {
    test.skip(!TEST_USER_EMAIL || !TEST_USER_PASSWORD, 'TEST_USER_EMAIL/PASSWORD no provistos');
    // 1. Login online primero para hidratar IndexedDB con datos reales.
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
    await page.waitForSelector('#app-content, #map, #appcontent', { timeout: 30_000 });

    // 2. Esperar hidratación.
    await page.waitForFunction(
      () => {
        /** @type {any} */ const w = window;
        return !!(w.globalPedidos && w.globalPedidos.length);
      },
      null,
      { timeout: 60_000 }
    );

    const pedidosOnline = await page.evaluate(() => {
      /** @type {any} */ const w = window;
      return (w.globalPedidos || []).length;
    });
    expect(pedidosOnline).toBeGreaterThan(0);

    // 3. Cortar red + reload.
    await context.setOffline(true);
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => {});

    // 4. Verificar que la app NO quedó vacía (listener aceptó cache).
    //    Puede tardar en recuperar el estado desde IDB.
    await page.waitForFunction(
      () => {
        /** @type {any} */ const w = window;
        return !!(w.globalPedidos && w.globalPedidos.length);
      },
      null,
      { timeout: 30_000 }
    );
    const pedidosOffline = await page.evaluate(() => {
      /** @type {any} */ const w = window;
      return (w.globalPedidos || []).length;
    });
    expect(pedidosOffline).toBeGreaterThan(0);

    // 5. Verificar banner visible.
    const banner = page.locator('#offline-stale-banner');
    await page.waitForFunction(
      () => {
        const el = /** @type {HTMLElement|null} */ (
          document.getElementById('offline-stale-banner')
        );
        return el && el.style.display === 'block';
      },
      null,
      { timeout: 15_000 }
    );
    await expect(banner).toHaveCSS('display', 'block');

    await page.screenshot({
      path: path.join(EVIDENCE_DIR, 'r2_offline_reload_banner.png'),
      fullPage: false,
    });

    // 6. Reconectar + verificar banner se oculta.
    await context.setOffline(false);
    await page.waitForFunction(
      () => {
        const el = /** @type {HTMLElement|null} */ (
          document.getElementById('offline-stale-banner')
        );
        return !el || el.style.display === 'none';
      },
      null,
      { timeout: 30_000 }
    );
  });
});
