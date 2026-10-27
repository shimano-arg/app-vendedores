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

  // v1493 §92 (2026-10-27): PACHI iter 4 — botonera modal pedido carga.
  // Verifica: body.can-revision activo + botón "Enviar a lista de espera"
  // visible + botones de confirmed NO visibles al abrir modal nuevo.
  test('escenario 4 — modal pedido carga: Enviar a lista de espera visible, sin botones residuales', async ({
    page,
  }) => {
    test.skip(!CREDS.email, 'test-pachi-* secrets no configurados');
    await loginPachi(page);

    // 1. body.can-revision debe estar activa (fuente única canRevisionEmailOrUid).
    const hasCanRevision = await page.evaluate(() =>
      document.body.classList.contains('can-revision')
    );
    expect(hasCanRevision, 'v1493 §92: body.can-revision debe estar activa para PACHI').toBe(true);

    // 2. Contrato unit: pure fn expuesta en __phase0.
    const pureCheck = await page.evaluate(() => {
      const fn =
        window.__phase0 &&
        window.__phase0.pure &&
        window.__phase0.pure.pachiRestrictions &&
        window.__phase0.pure.pachiRestrictions.canRevisionEmailOrUid;
      if (typeof fn !== 'function') return { exposed: false };
      return {
        exposed: true,
        realGmail: fn('pachinaba@gmail.com', 'LaBFi1xkSLObzLEdRoP8fonZ06r2'),
        testShimano: fn('pruebas.pachi@shimano.com.ar', 'xxx'),
        random: fn('random@gmail.com', 'xxx'),
      };
    });
    expect(pureCheck.exposed).toBe(true);
    expect(pureCheck.realGmail).toBe(true);
    expect(pureCheck.testShimano).toBe(true);
    expect(pureCheck.random).toBe(false);

    // 3. Simular estado "residual" post-viewPedido confirmed: setear
    //    pm-actions-confirmed.display='flex' manualmente antes de abrir modal.
    await page.evaluate(() => {
      const el = document.getElementById('pm-actions-confirmed');
      if (el) el.style.display = 'flex';
    });

    // 4. Abrir modal de carga nuevo via window.openPedidoModal.
    await page.evaluate(() => {
      // Cliente dummy: no importa el nombre; validamos la botonera resultante.
      window.openPedidoModal('CLIENTE TEST', 'C', 'CORDOBA', 'LOC TEST');
    });
    await page.waitForTimeout(400);

    // 5. Verificar botonera: edit visible, confirmed oculto, pm-back-to-waitlist visible.
    const botonera = await page.evaluate(() => {
      const edit = document.getElementById('pm-actions-edit');
      const pending = document.getElementById('pm-actions-pending');
      const confirmed = document.getElementById('pm-actions-confirmed');
      const back = document.querySelector('#pm-actions-edit .pm-back-to-waitlist');
      return {
        editDisplay: edit && window.getComputedStyle(edit).display,
        pendingDisplay: pending && window.getComputedStyle(pending).display,
        confirmedDisplay: confirmed && window.getComputedStyle(confirmed).display,
        backDisplay: back && window.getComputedStyle(back).display,
      };
    });
    expect(botonera.editDisplay).toBe('flex');
    expect(botonera.pendingDisplay).toBe('none');
    // v1493 fix: pm-actions-confirmed debe estar oculto post-openPedidoModal.
    expect(botonera.confirmedDisplay).toBe('none');
    // v1493 fix: botón "Enviar a lista de espera" visible (pure fn activa can-revision).
    expect(botonera.backDisplay).not.toBe('none');

    await screen(page, 'v1493_modal_carga_botonera');

    // 6. Cerrar modal.
    await page.evaluate(() => {
      if (typeof window.closePedidoModal === 'function') window.closePedidoModal();
    });
  });

  // v1494 §93 (2026-10-27): PACHI iter 5 — handler Enviar a lista de espera
  // no debe tirar alert "Solo Mariano/Ioannis/Santi/Pablo". _revisionCanUse
  // ahora delega a canRevisionEmailOrUid (fuente única).
  test('escenario 5 — PACHI puede enviar borrador a lista de espera sin alert', async ({
    page,
  }) => {
    test.skip(!CREDS.email, 'test-pachi-* secrets no configurados');
    await loginPachi(page);

    // 1. _revisionCanUse() debe devolver true para PACHI test.
    const canUse = await page.evaluate(() => {
      if (typeof window._revisionCanUse !== 'function') return { exposed: false };
      return { exposed: true, result: !!window._revisionCanUse() };
    });
    expect(canUse.exposed).toBe(true);
    expect(canUse.result).toBe(true);

    // 2. Interceptar alerts para verificar que NO salta el mensaje viejo.
    const alerts = [];
    page.on('dialog', async (d) => {
      alerts.push(d.message());
      await d.dismiss().catch(() => {});
    });

    // 3. Abrir modal carga con cliente dummy + agregar 1 línea stub en orders.
    await page.evaluate(() => {
      window.openPedidoModal('CLIENTE TEST VC', 'C', 'SAN LUIS', 'LOC TEST VC');
      // Simular 1 línea cargada.
      const key = window.currentOrderKey;
      if (key && typeof window.orders === 'object') {
        window.orders[key] = [{ code: 'TEST_SKU', desc: 'TEST DESC', qty: 1, price: 100 }];
      }
    });
    await page.waitForTimeout(300);

    // 4. Llamar enviarBorradorAListaEspera. Debe pasar _revisionCanUse SIN
    //    el alert viejo. El confirm nativo lo cerramos con dismiss (test).
    await page.evaluate(() => {
      if (typeof window.enviarBorradorAListaEspera === 'function') {
        // Dispara el flujo; dialog handler captura cualquier alert/confirm.
        try {
          window.enviarBorradorAListaEspera();
        } catch (_e) {}
      }
    });
    await page.waitForTimeout(800);

    // 5. Verificar que NINGÚN alert contiene el mensaje viejo.
    const alertWithOldMsg = alerts.find((a) => a.includes('Solo Mariano, Ioannis, Santi o Pablo'));
    expect(
      alertWithOldMsg,
      `v1494 §93: alert viejo "Solo Mariano..." NO debe aparecer. Alerts vistos: ${JSON.stringify(alerts)}`
    ).toBeUndefined();

    await screen(page, 'v1494_enviar_lista_espera');
  });

  // v1496 §95 (2026-10-27): PACHI iter 6 — botón Eliminar waitlist card.
  // Verifica canDeleteOwnWaitlist: PACHI puede borrar sus propios, no ajenos.
  test('escenario 6 — PACHI puede borrar waitlist propia, no ajena', async ({ page }) => {
    test.skip(!CREDS.email, 'test-pachi-* secrets no configurados');
    await loginPachi(page);

    const uid = await page.evaluate(() => window.currentUser && window.currentUser.uid);
    expect(uid).toBeTruthy();

    // 1. canDeleteOwnWaitlist expuesta y correcta.
    const check = await page.evaluate(() => {
      const fn =
        window.__phase0 &&
        window.__phase0.pure &&
        window.__phase0.pure.pachiRestrictions &&
        window.__phase0.pure.pachiRestrictions.canDeleteOwnWaitlist;
      if (typeof fn !== 'function') return { exposed: false };
      const uid = window.currentUser.uid;
      const email = window.currentUser.email;
      return {
        exposed: true,
        own: fn({ ownerUid: uid }, uid, email),
        ajeno: fn({ ownerUid: 'OTRO_UID' }, uid, email),
        sinOwner: fn({}, uid, email),
      };
    });
    expect(check.exposed).toBe(true);
    expect(check.own).toBe(true);
    expect(check.ajeno).toBe(false);
    expect(check.sinOwner).toBe(false);

    // 2. Simular render de waitlist propia: setear _wcardCurrent + evaluar
    //    si el botón quedaría visible. Como el render completo del modal
    //    requiere data real, usamos el chequeo del gate directamente.
    const gateCheck = await page.evaluate((targetUid) => {
      const fn = window.__phase0.pure.pachiRestrictions.canDeleteOwnWaitlist;
      const email = window.currentUser.email;
      return {
        ownWaitlist: fn({ ownerUid: targetUid }, targetUid, email),
        ajenaWaitlist: fn({ ownerUid: 'XXXX' }, targetUid, email),
      };
    }, uid);
    expect(gateCheck.ownWaitlist).toBe(true);
    expect(gateCheck.ajenaWaitlist).toBe(false);

    await screen(page, 'v1496_delete_gate_pachi');
  });

  // v1496 §95 (2026-10-27): timestamp 24h ART en wcard-subt.
  test('escenario 6b — formatFirestoreDate con timeZone ART + hour12=false', async ({ page }) => {
    test.skip(!CREDS.email, 'test-pachi-* secrets no configurados');
    await loginPachi(page);

    const fmtCheck = await page.evaluate(() => {
      const fn =
        window.__phase0 &&
        window.__phase0.pure &&
        window.__phase0.pure.parseDateFlexible &&
        window.__phase0.pure.parseDateFlexible.formatFirestoreDate;
      if (typeof fn !== 'function') return { exposed: false };
      // 2026-10-27T16:55:15Z = 13:55:15 ART.
      const result = fn('2026-10-27T16:55:15Z', {
        style: 'datetime',
        timeZone: 'America/Argentina/Buenos_Aires',
        hour12: false,
      });
      return { exposed: true, result };
    });
    expect(fmtCheck.exposed).toBe(true);
    expect(fmtCheck.result).toMatch(/13:55:15/);
    expect(fmtCheck.result).not.toMatch(/\bAM\b|\bPM\b/i);
  });
});
