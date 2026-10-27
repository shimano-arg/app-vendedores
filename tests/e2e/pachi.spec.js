// @ts-check
/**
 * Spec Playwright E2E: perfil operativo PACHI (v1460, 2026-10-26).
 *
 * Lee creds del secret gcloud `test-pachi-email` + `test-pachi-password`
 * (via helpers/load_pachi_creds.js). Si placeholder, SKIP el escenario con mensaje.
 *
 * Escenarios:
 *   1. flujo comercial — login + stock + clientes + visita rápida + contacto rápido + planner.
 *   2. restricciones — 8 checks de que PACHI NO puede ni UI ni acceso directo.
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

function loadPachiCreds() {
  const email = process.env.TEST_PACHI_EMAIL || fetchSecret('test-pachi-email') || '';
  const password = process.env.TEST_PACHI_PASSWORD || fetchSecret('test-pachi-password') || '';
  if (!email || !password || /placeholder/i.test(password)) {
    return { email: null, password: null };
  }
  return { email, password };
}

const CREDS = loadPachiCreds();
const TAREA = process.env.PLAYWRIGHT_TAREA || 'pachi';
const FECHA = new Date().toISOString().slice(0, 10);
const EVIDENCIA_DIR = `tests/e2e/evidencia/${FECHA}/${TAREA}`;

test.beforeAll(() => fs.mkdirSync(EVIDENCIA_DIR, { recursive: true }));

async function screen(page, name) {
  const p = path.join(EVIDENCIA_DIR, `${name}.png`);
  await page.screenshot({ path: p, fullPage: true });
  return p;
}

async function loginPachi(page) {
  await page.goto('');
  await page.locator('#login-email').first().fill(CREDS.email);
  await page.locator('#login-pass').first().fill(CREDS.password);
  await page.locator('#login-submit-btn').first().click();
  await page.waitForSelector('button:has-text("Salir")', { timeout: 30000 });
  await page.evaluate(() => {
    const el = document.getElementById('dark-mode-announcement-modal');
    if (el) {
      el.classList.remove('open');
      el.style.display = 'none';
    }
  });
}

test.describe('PACHI perfil operativo', () => {
  test('escenario 1 — flujo comercial completo', async ({ page }) => {
    test.skip(!CREDS.email, 'test-pachi-* secrets no configurados (placeholder)');
    await loginPachi(page);
    await screen(page, '01_login_ok');

    const body = await page.locator('body').getAttribute('class');
    expect(body).toContain('is-pachi-restricted');

    // Stock (header): buscar botón Productos/Stock.
    const btnProd = page.locator('button:has-text("Productos"), [data-tab="locs"]').first();
    if (await btnProd.isVisible({ timeout: 5000 }).catch(() => false)) {
      await btnProd.click();
      await page.waitForTimeout(1000);
    }
    await screen(page, '02_stock_productos');
    // Cerrar modal product-master si quedó abierto.
    await page.evaluate(() => {
      const m = document.getElementById('product-master-modal');
      if (m) m.classList.remove('open');
    });

    // Clientes.
    const btnClientes = page.locator('[data-tab="clients"]').first();
    if (await btnClientes.isVisible({ timeout: 5000 }).catch(() => false)) {
      await btnClientes.click();
      await page.waitForTimeout(1000);
    }
    await screen(page, '03_clientes');

    // Pedidos.
    const btnPedidos = page.locator('[data-tab="pedidos"]').first();
    if (await btnPedidos.isVisible({ timeout: 5000 }).catch(() => false)) {
      await btnPedidos.click();
      await page.waitForTimeout(1000);
    }
    await screen(page, '04_pedidos');

    // Visita rápida: con PACHI, openVisitaModal() redirect a openQuickVisitaModal.
    // Verifica que la función no explote (puede abrir el modal o no según contexto).
    const quickOk = await page.evaluate(() => {
      try {
        if (typeof window.openVisitaModal !== 'function') return 'fn-missing';
        window.openVisitaModal();
        return 'called';
      } catch (e) {
        return 'threw:' + ((e && e.message) || e);
      }
    });
    await page.waitForTimeout(1500);
    await screen(page, '05_visita_rapida');
    expect(quickOk, 'openVisitaModal debe estar disponible y no explotar').toBe('called');
    // Cerrar modal con la función oficial (Escape no funciona en todos los modales).
    await page.evaluate(() => {
      const ids = ['quick-visita-modal', 'visita-modal', 'visita-choice-modal'];
      for (const id of ids) {
        const el = document.getElementById(id);
        if (el) {
          el.classList.remove('open');
          el.style.display = 'none';
        }
      }
    });
    await page.waitForTimeout(500);

    // Planner.
    const plannerBtn = page.locator('#planner-header-btn').first();
    if (await plannerBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await plannerBtn.click();
      await page.waitForTimeout(1500);
      await screen(page, '06_planner');
      await page.keyboard.press('Escape');
    }
  });

  test('escenario 2 — las 8 restricciones aplican', async ({ page }) => {
    test.skip(!CREDS.email, 'test-pachi-* secrets no configurados');
    await loginPachi(page);

    // A. Backorder solo lectura: botones acción deshabilitados dentro del modal.
    const backorderBtn = page.locator('#backorders-btn').first();
    if (await backorderBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await backorderBtn.click();
      await page.waitForTimeout(1500);
      const actionBtns = page.locator(
        '#backorders-modal button.bo-btn:not(.bo-btn-cancel):not(.bo-btn-close)'
      );
      const nActions = await actionBtns.count();
      if (nActions > 0) {
        const pointerEvents = await actionBtns
          .first()
          .evaluate((el) => window.getComputedStyle(el).pointerEvents);
        expect(pointerEvents).toBe('none');
      }
      await screen(page, 'A_backorder_readonly');
      await page.keyboard.press('Escape');
    }

    // B. Stock asignado sin acceso: botón oculto + guard JS.
    const stockAsigBtn = page.locator('#asignacion-backorder-btn').first();
    const stockVisible = await stockAsigBtn.isVisible({ timeout: 2000 }).catch(() => false);
    expect(stockVisible, 'B: #asignacion-backorder-btn debe estar oculto').toBe(false);
    // Guard JS: openAsignacionBackorderModal no abre.
    const stockGuard = await page.evaluate(() => {
      try {
        window.openAsignacionBackorderModal && window.openAsignacionBackorderModal();
      } catch (_e) {}
      const m = document.getElementById('backorders-modal');
      return m ? m.classList.contains('open') : false;
    });
    page.on('dialog', (d) => d.accept().catch(() => null));
    await page.waitForTimeout(500);
    expect(stockGuard, 'B: openAsignacionBackorderModal no debe abrir para PACHI').toBe(false);

    // C+D. Visitas/Contactos Clásica: botón oculto en choice modal.
    await page.evaluate(() => {
      const el = document.getElementById('visita-choice-modal');
      if (el) el.classList.add('open');
    });
    const clasicaVisible = await page
      .locator('#visita-choice-clasica')
      .first()
      .isVisible()
      .catch(() => false);
    expect(clasicaVisible, 'C: #visita-choice-clasica debe estar oculto').toBe(false);
    await page.evaluate(() => {
      const el = document.getElementById('visita-choice-modal');
      if (el) el.classList.remove('open');
    });

    // E. Rutas tab oculta.
    const rutasVisible = await page
      .locator('.tab-btn[data-tab="rutas"]')
      .first()
      .isVisible()
      .catch(() => false);
    expect(rutasVisible, 'E: tab Rutas debe estar oculto').toBe(false);
    // Guard setTab('rutas').
    await page.evaluate(() => {
      if (typeof window.setTab === 'function') window.setTab('rutas');
    });
    const paneRutasVisible = await page
      .locator('#pane-rutas')
      .first()
      .isVisible()
      .catch(() => false);
    expect(paneRutasVisible, 'E: pane-rutas no debe mostrarse').toBe(false);

    // F+G. SAP oculto.
    const sapBtnVisible = await page
      .locator('#sap-btn')
      .first()
      .isVisible()
      .catch(() => false);
    expect(sapBtnVisible, 'F: #sap-btn debe estar oculto').toBe(false);
    const sapGuardOk = await page.evaluate(() => {
      try {
        window.openSapPanel && window.openSapPanel();
      } catch (_e) {}
      const m = document.getElementById('sap-modal');
      return m ? !m.classList.contains('open') : true;
    });
    expect(sapGuardOk, 'F: openSapPanel no debe abrir para PACHI').toBe(true);

    // H. Alertas y tareas oculto, sin dejar espacio.
    const notifTabVisible = await page
      .locator('#tab-notif')
      .first()
      .isVisible()
      .catch(() => false);
    expect(notifTabVisible, 'H: #tab-notif debe estar oculto').toBe(false);
    const paneNotifVisible = await page
      .locator('#pane-notif')
      .first()
      .isVisible()
      .catch(() => false);
    expect(paneNotifVisible, 'H: #pane-notif debe estar oculto').toBe(false);

    await screen(page, 'restricciones_todas');
  });

  // v1481 §81 (2026-10-27): PACHI iter 3 — sidebar-left panel.
  // El panel izquierdo del mapa (#sidebar-left-buttons) debe mostrar
  // SOLO 3 botones: Campañas, Dashboard, Exportar. Los otros 6 NO deben
  // existir en el DOM (proxies no creados por el renderer).
  test('escenario 3 — sidebar-left panel SOLO Campañas + Dashboard + Exportar', async ({
    page,
  }) => {
    test.skip(!CREDS.email, 'test-pachi-* secrets no configurados');
    await loginPachi(page);
    // Asegurarse que el renderer ya corrió (se llama al init post-login).
    await page.waitForTimeout(1500);

    // Contrato dura: NO existen los 6 proxies de botones ocultos.
    const hiddenIds = [
      'seguimiento-btn',
      'backorders-btn',
      'asignacion-backorder-btn',
      'forecast-btn',
      'revision-btn',
      'waitlist-btn',
    ];
    for (const id of hiddenIds) {
      const proxyCount = await page
        .locator(`#sidebar-left-buttons [data-proxy-for="${id}"]`)
        .count();
      expect(
        proxyCount,
        `v1481 §81: proxy #sidebar-left-buttons [data-proxy-for="${id}"] NO debe existir para PACHI`
      ).toBe(0);
    }

    // Contrato positivo: SÍ existen Campañas, Dashboard y Exportar.
    const visibleProxies = ['mis-camps-btn', 'dashboard-btn'];
    for (const id of visibleProxies) {
      const proxyCount = await page
        .locator(`#sidebar-left-buttons [data-proxy-for="${id}"]`)
        .count();
      expect(proxyCount, `v1481 §81: proxy ${id} debe existir para PACHI`).toBeGreaterThanOrEqual(
        1
      );
    }
    // Exportar: el id del proxy es dinámico (btn-export o inferido). Verifico
    // por texto label.
    const exportProxy = await page
      .locator('#sidebar-left-buttons button:has-text("Exportar")')
      .count();
    expect(exportProxy, 'v1481 §81: proxy Exportar debe existir para PACHI').toBeGreaterThanOrEqual(
      1
    );

    // Totales: 3 proxies visibles (Campañas, Dashboard, Exportar).
    const totalBtns = await page.locator('#sidebar-left-buttons button').count();
    expect(totalBtns, 'v1481 §81: sidebar-left debe tener exactamente 3 botones para PACHI').toBe(
      3
    );

    await screen(page, 'v1481_sidebar_left_3_botones');

    // Defense in depth: las open*Modal fns están envueltas con pachiGuard.
    // Verificar que invocar window.openBackordersModal() no abre el modal.
    page.on('dialog', (d) => d.accept().catch(() => null));
    const guardResult = await page.evaluate(() => {
      const fnNames = [
        'openBackordersModal',
        'openAsignacionBackorderModal',
        'openForecastModal',
        'openRepartoModal',
        'openDepositoModal',
      ];
      const results = {};
      for (const fn of fnNames) {
        try {
          if (typeof window[fn] === 'function') {
            // Debe ser un wrapper __pachiWrapped1481 que no abre nada.
            results[fn] = {
              wrapped: !!window[fn].__pachiWrapped1481,
              callReturned: window[fn](),
            };
          } else {
            results[fn] = { wrapped: null, callReturned: 'fn-missing' };
          }
        } catch (e) {
          results[fn] = { wrapped: null, callReturned: 'threw:' + (e && e.message) };
        }
      }
      return results;
    });
    await page.waitForTimeout(500);
    for (const [fn, info] of Object.entries(guardResult)) {
      if (info.wrapped !== null) {
        expect(
          info.wrapped,
          `v1481 §81: ${fn} debe estar wrapped con __pachiWrapped1481 para PACHI`
        ).toBe(true);
      }
    }

    // Confirmar que ningún modal protegido quedó open después del attack.
    const openModalIds = await page.evaluate(() => {
      const ids = [
        'backorders-modal',
        'forecast-modal',
        'reparto-modal',
        'deposito-modal',
        'cartera-modal',
        'seguimiento-modal',
      ];
      return ids.filter((id) => {
        const el = document.getElementById(id);
        return el && el.classList.contains('open');
      });
    });
    expect(
      openModalIds,
      `v1481 §81: ningún modal protegido debe estar open después de intento alt-path. Abiertos: ${openModalIds.join(', ')}`
    ).toEqual([]);

    await screen(page, 'v1481_guards_bloquean_alt_path');
  });
});
