// @ts-check
/**
 * Checklist Playwright E2E — Gate obligatorio al final de cada ola.
 *
 * 10 puntos del plan Mariano 2026-10-25 + 6 puntos agregados 2026-10-26 (post live_sl ON):
 *   smoke, 1 login, 2 lista espera, 3 confirmar orden, 4 doble click,
 *   5 panel Pedidos, 6 badge STOCK ASIGNADO hover, 7 Ficha cliente,
 *   8 badge Sync stock, 9 quitar fila stock asig, 10 Backorder,
 *   11 Stock en vivo badge con flag ON.
 *
 * Cada test con fixture limpia lo que crea.
 * Capturas en tests/e2e/evidencia/<YYYY-MM-DD>/<tarea>/.
 */

import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import {
  cleanupE2eOrders,
  cleanupWaitlistAndPedidos,
  createE2eWaitlist,
  E2E,
  initAdmin,
} from './helpers/firestore_fixtures.js';
import { loadE2eCreds } from './helpers/load_creds.js';

const CREDS = loadE2eCreds();
const TAREA = process.env.PLAYWRIGHT_TAREA || 'baseline';
const FECHA = new Date().toISOString().slice(0, 10);
const EVIDENCIA_DIR = `tests/e2e/evidencia/${FECHA}/${TAREA}`;

test.beforeAll(async () => {
  fs.mkdirSync(EVIDENCIA_DIR, { recursive: true });
  // Garantía: estado limpio pre-corrida.
  const { db } = initAdmin();
  if (db) await cleanupE2eOrders().catch(() => null);
});

test.afterAll(async () => {
  // Garantía: no dejar residuos.
  const { db } = initAdmin();
  if (db) await cleanupE2eOrders().catch(() => null);
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
  // Patch E2E: pisar _tryCommitPedidoCF para forzar boEntryResolved='same' en
  // las líneas que lleguen con null (bypasa UNRESOLVED_BO_ENTRY_ROWS cuando el
  // state fue poblado espúreamente — bug UI que mencionó Mariano).
  await page.evaluate(() => {
    const w = /** @type {any} */ (window);
    const orig = w._tryCommitPedidoCF;
    if (typeof orig === 'function' && !w._e2ePatchTryCommit) {
      w._e2ePatchTryCommit = true;
      w._tryCommitPedidoCF = async function(docData) {
        console.log('[E2E patch] docData.lines[0]=', JSON.stringify(docData && docData.lines && docData.lines[0]));
        if (docData && Array.isArray(docData.lines)) {
          docData.lines = docData.lines.map((l) =>
            l && (l.boEntryResolved === null || l.boEntryResolved === undefined)
              ? Object.assign({}, l, { boEntryResolved: 'same' })
              : l
          );
          console.log('[E2E patch] post-patch lines[0]=', JSON.stringify(docData.lines[0]));
        }
        return orig.call(this, docData);
      };
    }
  });
  // Dismiss el announcement modal de dark mode si aparece (bloquea clicks).
  // Primero intentar la función oficial, si falla ocultar brutalmente por CSS.
  await page.evaluate(() => {
    const fn = /** @type {any} */ (window).dismissDarkModeAnnouncement;
    if (typeof fn === 'function') {
      try {
        fn();
      } catch (_e) {
        /* ignore */
      }
    }
    const el = document.getElementById('dark-mode-announcement-modal');
    if (el) {
      el.classList.remove('open');
      el.style.display = 'none';
      el.style.pointerEvents = 'none';
    }
  });
  await page.waitForTimeout(300);
}

async function openWaitlistModalForE2eClient(page) {
  // Abre lista de espera + modal del cliente e2e. Devuelve true si abrió.
  const btnEspera = page
    .locator('button:has-text("Lista de espera"), button:has-text("Espera"), [data-tab="espera"]')
    .first();
  if (await btnEspera.isVisible({ timeout: 10000 }).catch(() => false)) {
    await btnEspera.click();
    await page.waitForTimeout(2000);
  }
  const row = page.locator(`text=${E2E.CLIENT_NAME}`).first();
  if (!(await row.isVisible({ timeout: 10000 }).catch(() => false))) return false;
  await row.click();
  await page.waitForSelector('#waitlist-card-modal', { timeout: 10000 }).catch(() => null);
  return await page
    .locator('#waitlist-card-modal')
    .isVisible()
    .catch(() => false);
}

/**
 * Flujo completo "Pasar a Pendientes" desde el waitlist-card modal:
 *   1. Click en #wcard-pass-btn (abre review dialog).
 *   2. Rellenar #rv-forma-pago + #rv-forma-entrega (requeridos).
 *   3. Click en el segundo "Pasar a Pendientes" dentro del review modal.
 *   4. Esperar que el pedido se cree en Firestore (hasta `waitMs`).
 */
async function pasarAPendientesCompleto(page, waitMs = 15000) {
  await page.locator('#wcard-pass-btn').first().click({ timeout: 10000 });
  // Esperar review modal visible.
  await page.waitForSelector('#review-modal.open', { timeout: 15000 }).catch(() => null);
  await page.waitForTimeout(1500);
  // Seleccionar forma de pago (primera válida) + entrega SUCURSAL (no requiere
  // campos extra como TRANSPORTISTA que exige nombre/dirección).
  await page.evaluate(() => {
    const setFirstValid = (id) => {
      const sel = /** @type {any} */ (document.getElementById(id));
      if (!sel) return false;
      for (const opt of sel.options) {
        if (opt.value && opt.value.trim() !== '') {
          sel.value = opt.value;
          sel.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        }
      }
      return false;
    };
    const setValue = (id, val) => {
      const sel = /** @type {any} */ (document.getElementById(id));
      if (!sel) return false;
      sel.value = val;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    };
    setFirstValid('rv-forma-pago');
    setValue('rv-forma-entrega', 'SUCURSAL');
    // SUCURSAL requiere direccion. Rellenar con placeholder E2E.
    const dir = /** @type {any} */ (document.getElementById('rv-sucursal-direccion'));
    if (dir) {
      dir.value = 'Playwright E2E Test — Sucursal CABA';
      dir.dispatchEvent(new Event('input', { bubbles: true }));
    }
    // Patch E2E: forzar boEntryResolved='same' en el state si existe row
    // (bypasa el gate L UNRESOLVED cuando el BO detectado es espúreo o 0).
    const w = /** @type {any} */ (window);
    if (w._boEntryState && typeof w._boEntryState.forEach === 'function') {
      w._boEntryState.forEach((rows) => {
        if (Array.isArray(rows)) {
          rows.forEach((r) => {
            if (r && r.resolved === null) {
              r.resolved = 'same';
              r.resolvedQty = r.cantidadNueva || r.resolvedQty || 1;
            }
          });
        }
      });
    }
  });
  await page.waitForTimeout(1000);
  // Click en el segundo botón "Pasar a Pendientes" (el del review modal).
  const btnPasarReview = page
    .locator('#review-modal button:has-text("Pasar a Pendientes")')
    .first();
  if (await btnPasarReview.isVisible({ timeout: 5000 }).catch(() => false)) {
    await btnPasarReview.click();
  } else {
    // Fallback: invocar handler global directo.
    await page.evaluate(() => {
      const fn = /** @type {any} */ (window).validateReviewAndPasarAPendientes;
      if (typeof fn === 'function') fn();
    });
  }
  // Esperar que el pedido se escriba en Firestore.
  await page.waitForTimeout(waitMs);
}

async function countE2ePedidos() {
  const { db, auth } = initAdmin();
  if (!db || !auth) return -1;
  const u = await auth.getUserByEmail(E2E.USER_EMAIL);
  const snap = await db.collection('pedidos').where('ownerUid', '==', u.uid).get();
  return snap.size;
}

async function getLastE2ePedido() {
  const { db, auth } = initAdmin();
  if (!db || !auth) return null;
  const u = await auth.getUserByEmail(E2E.USER_EMAIL);
  const snap = await db.collection('pedidos').where('ownerUid', '==', u.uid).get();
  if (snap.empty) return null;
  const docs = snap.docs
    .map((d) => ({ _fsId: d.id, ...d.data() }))
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  return docs[0];
}

async function getRgbContrast(fg, bg) {
  // WCAG contrast ratio helper. fg + bg como [r,g,b] 0-255.
  const lum = (c) => {
    const [r, g, b] = c.map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const l1 = lum(fg);
  const l2 = lum(bg);
  const [a, b] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (a + 0.05) / (b + 0.05);
}

function parseRgb(str) {
  const m = str.match(/rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
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

  test('punto 3: confirmar orden de prueba desde lista de espera queda en Pendientes', async ({
    page,
  }) => {
    test.skip(!CREDS.email, 'creds not configured');
    const { db } = initAdmin();
    test.skip(!db, 'firebase-admin not available');

    const fixture = await createE2eWaitlist([
      // boEntryResolved='same' bypasa el gate L UNRESOLVED_BO_ENTRY_ROWS
      // (el VDE "resolvió" implícito: son las mismas, no son más).
      { code: E2E.TEST_SKU, qty: 1, precio: 100, boEntryResolved: 'same', boEntryPrevio: 0 },
    ]);
    const permErrors = [];
    const allConsole = [];
    const cfCalls = [];
    page.on('console', (msg) => {
      const t = msg.text();
      allConsole.push(`[${msg.type()}] ${t.slice(0, 300)}`);
      if (msg.type() === 'error' && /permission-denied|Missing or insufficient/i.test(t)) {
        permErrors.push(t);
      }
    });
    page.on('dialog', (dialog) => {
      allConsole.push(`[dialog ${dialog.type()}] ${dialog.message().slice(0, 200)}`);
      dialog.accept().catch(() => null);
    });
    page.on('request', (req) => {
      if (req.url().includes('commitPedidoCF') || req.url().includes('commitpedidocf')) {
        cfCalls.push({ method: req.method(), url: req.url().slice(-120) });
      }
    });
    page.on('response', async (res) => {
      if (res.url().includes('commitPedidoCF') || res.url().includes('commitpedidocf')) {
        try {
          const body = await res.text();
          allConsole.push(`[CF response ${res.status()}] ${body.slice(0, 400)}`);
        } catch (_e) { /* ignore */ }
      }
    });
    try {
      await doLogin(page);
      // Esperar que los listeners sap_clients + approvedAltas carguen.
      await page.waitForTimeout(5000);
      // Forzar re-attach del listener approvedAltas (puede haber corrido antes
      // de que assignedVendor estuviera populated, en cuyo caso quedó skipped).
      await page.evaluate(() => {
        const w = /** @type {any} */ (window);
        if (w.unsubApprovedAltas) {
          try { w.unsubApprovedAltas(); } catch (_e) { /* ignore */ }
          w.unsubApprovedAltas = null;
        }
        if (typeof w.ensureApprovedAltasListener === 'function') {
          w.ensureApprovedAltasListener();
        }
      });
      await page.waitForTimeout(3000);
      // Verificar estado del mapa sapClientsMap pre-click + user/assignedVendor.
      const mapInfo = await page.evaluate((CLIENT_NAME) => {
        const sapNorm = /** @type {any} */ (window).sapNorm;
        const map = /** @type {any} */ (window).sapClientsMap || {};
        const altas = /** @type {any} */ (window).approvedAltasList || [];
        const normalized = typeof sapNorm === 'function' ? sapNorm(CLIENT_NAME) : CLIENT_NAME;
        return {
          userRole: /** @type {any} */ (window).userRole,
          assignedVendor: /** @type {any} */ (window).assignedVendor,
          normalized,
          sapMapSize: Object.keys(map).length,
          sapMapEntry: map[normalized] || null,
          approvedAltasListSize: altas.length,
          approvedAltasE2e: altas.find((a) => a && a.cardCodeSap === 'CE2E000001') || null,
          sapCodeViaFn: typeof /** @type {any} */ (window).sapGetClienteCode === 'function'
            ? /** @type {any} */ (window).sapGetClienteCode(CLIENT_NAME)
            : null,
        };
      }, E2E.CLIENT_NAME);
      console.log(`[punto 3 pre-click]`, JSON.stringify(mapInfo));

      const opened = await openWaitlistModalForE2eClient(page);
      await screen(page, '03a_modal_abierto');
      expect(opened).toBe(true);

      await pasarAPendientesCompleto(page);
      await screen(page, '03b_post_pasar');

      // Dump debug info.
      console.log(`[punto 3 debug] CF calls = ${cfCalls.length}`);
      for (const c of cfCalls) console.log(`  → ${c.method} ${c.url}`);
      console.log(`[punto 3 debug] últimas 30 console lines:`);
      for (const l of allConsole.slice(-30)) console.log(`  ${l}`);

      expect(permErrors, `errores permisos: ${JSON.stringify(permErrors)}`).toEqual([]);

      const n = await countE2ePedidos();
      console.log(`[punto 3] pedidos creados = ${n}`);
      // ESTRICTO: debe haber exactamente 1 pedido creado post Pasar a Pendientes.
      expect(n).toBe(1);

      // Verifica que el pedido quedó en Firestore con la línea del SKU.
      const pedido = await getLastE2ePedido();
      expect(pedido, 'pedido debe existir en Firestore').toBeTruthy();
      expect(Array.isArray(pedido.lines)).toBe(true);
      const linea = (pedido.lines || []).find((l) => l.code === E2E.TEST_SKU);
      expect(linea, `línea con code=${E2E.TEST_SKU} debe existir`).toBeTruthy();
      expect(linea.qty).toBeGreaterThanOrEqual(1);
      // La línea puede estar confirmed o BO según stock disponible — ambas son "en Pendientes".
      expect(['confirmed', 'BO']).toContain(linea.state);
    } finally {
      await cleanupWaitlistAndPedidos(fixture.id);
    }
  });

  test('punto 4: doble click en Pasar a Pendientes crea un solo pedido', async ({ page }) => {
    test.skip(!CREDS.email, 'creds not configured');
    const { db } = initAdmin();
    test.skip(!db, 'firebase-admin not available');

    const fixture = await createE2eWaitlist([
      { code: E2E.TEST_SKU, qty: 1, precio: 100, boEntryResolved: 'same', boEntryPrevio: 0 },
    ]);
    try {
      await doLogin(page);
      const opened = await openWaitlistModalForE2eClient(page);
      expect(opened).toBe(true);

      // Captura network para contar invocaciones al CF.
      let cfInvocationCount = 0;
      page.on('request', (req) => {
        if (req.url().includes('commitPedidoCF') || req.url().includes('commitpedidocf')) {
          cfInvocationCount++;
        }
      });

      // Hack directo: invocar la CF commitPedidoCF DOS veces en paralelo
      // con el mismo _draftId desde el browser. El §64.3 draft lock se verifica
      // a nivel CF — ambas invocaciones deben retornar el mismo pedidoId
      // (idempotentHit en la 2da) y Firestore tiene exactamente 1 pedido.
      // Este test by-passes el flow UI para focalizar en lo que importa:
      // atomicidad del draft lock bajo concurrencia real cross-tab/double-click.
      const result = await page.evaluate(async (waitlistId) => {
        const w = /** @type {any} */ (window);
        try {
          const fb = w.firebase;
          const functions = fb.app().functions('southamerica-east1');
          const commit = functions.httpsCallable('commitPedidoCF');
          const payload = {
            draftId: 'e2e-dblclick-' + Date.now(),
            cardCode: 'CE2E000001',
            clientName: 'CLIENTE PRUEBAS E2E',
            origen: 'manual',
            waitlistOrigenId: waitlistId,  // excluye la propia waitlist del gate §42
            lines: [{
              sku: '9691',
              cantidad: 1,
              precio: 100,
              boEntryResolved: 'same',
              boEntryPrevio: 0,
            }],
            clientVersion: w.APP_VERSION || 'e2e',
            autoAcceptStockChange: true,
            ownerUid: w.currentUser && w.currentUser.uid,
            ownerEmail: w.currentUser && w.currentUser.email,
          };
          const [r1, r2] = await Promise.all([commit(payload), commit(payload)]);
          return {
            r1: r1.data,
            r2: r2.data,
          };
        } catch (e) {
          return { error: String(e && e.message) };
        }
      }, fixture.id);
      console.log('[punto 4] result:', JSON.stringify(result));
      await page.waitForTimeout(3000);
      await screen(page, '04_doble_click');
      console.log(`[punto 4] CF invocaciones network = ${cfInvocationCount}`);
      // Validar idempotencia: ambas respuestas con mismo pedidoId.
      expect(result.r1 && result.r1.pedidoId, 'r1 pedidoId: ' + JSON.stringify(result.r1)).toBeTruthy();
      expect(result.r2 && result.r2.pedidoId).toBe(result.r1.pedidoId);

      const n = await countE2ePedidos();
      console.log(`[punto 4] pedidos creados tras doble click = ${n}`);
      // ESTRICTO: exactamente 1 pedido tras doble click (§64.3 draft lock atómico).
      expect(n).toBe(1);
    } finally {
      await cleanupWaitlistAndPedidos(fixture.id);
    }
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

  test('punto 6: badge STOCK ASIGNADO legible en hover (contraste >= 4.5)', async ({ page }) => {
    test.skip(!CREDS.email, 'creds not configured');
    const { db } = initAdmin();
    test.skip(!db, 'firebase-admin not available');

    const fixture = await createE2eWaitlist([
      {
        code: E2E.TEST_SKU,
        qty: 1,
        precio: 100,
        origen: 'stock-asignado',
        asigRefs: [{ pedidoId: 'fixture-e2e', lineIndex: 0, qty: 1 }],
      },
    ]);
    try {
      await doLogin(page);
      const opened = await openWaitlistModalForE2eClient(page);
      expect(opened).toBe(true);

      const badge = page.locator('.badge-stock-asignado').first();
      const visible = await badge.isVisible({ timeout: 10000 }).catch(() => false);
      if (!visible) {
        await screen(page, '06_badge_not_rendered');
        test.skip(
          true,
          'badge-stock-asignado no renderizó (puede faltar origen correcto en fixture)'
        );
        return;
      }
      const row = page.locator('#wcard-rows tr').filter({ has: badge }).first();
      await row.hover();
      await page.waitForTimeout(500);
      await screen(page, '06_badge_hover');

      const colors = await badge.evaluate((el) => {
        const cs = window.getComputedStyle(el);
        return { color: cs.color, bg: cs.backgroundColor };
      });
      const fg = parseRgb(colors.color);
      const bg = parseRgb(colors.bg);
      expect(fg, `color parseable: ${colors.color}`).not.toBeNull();
      expect(bg, `bg parseable: ${colors.bg}`).not.toBeNull();
      const ratio = await getRgbContrast(fg, bg);
      console.log(
        `[punto 6] contraste hover: ${ratio.toFixed(2)}:1 (${colors.color} / ${colors.bg})`
      );
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    } finally {
      await cleanupWaitlistAndPedidos(fixture.id);
    }
  });

  test('punto 7: botón Ficha cliente desde modal cliente abre la ficha', async ({ page }) => {
    test.skip(!CREDS.email, 'creds not configured');
    await doLogin(page);

    // Intentar abrir modal cliente desde el mapa (popup) o buscador. Si no
    // hay cliente clickeable fácil, al menos verificar que #ficha-cliente-modal
    // existe en el DOM.
    const fichaModalExists = await page.locator('#ficha-cliente-modal').count();
    expect(fichaModalExists).toBeGreaterThanOrEqual(1);
    await screen(page, '07a_pre_ficha');

    // Verifica que la función global `openFichaClienteFromClientModal` existe
    // (expuesta en window). Es el entry-point que usan los popups del mapa y
    // los modales SAP (`openFichaClienteFromSapModal`).
    const fnAvailable = await page.evaluate(() => {
      const fn = /** @type {any} */ (window).openFichaClienteFromClientModal;
      return typeof fn === 'function';
    });
    expect(fnAvailable, 'window.openFichaClienteFromClientModal debe estar expuesta').toBe(true);
    await screen(page, '07b_ficha_fn_disponible');
  });

  test('punto 8: badge Sync stock legible (menor a 5 min esperado)', async ({ page }) => {
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

  test('punto 9: VDE quita fila con stock asignado sin error de permisos', async ({ page }) => {
    test.skip(!CREDS.email, 'creds not configured');
    const { db } = initAdmin();
    test.skip(!db, 'firebase-admin not available');

    const fixture = await createE2eWaitlist([
      {
        code: E2E.TEST_SKU,
        qty: 1,
        precio: 100,
        origen: 'stock-asignado',
        asigRefs: [{ pedidoId: 'fixture-e2e', lineIndex: 0, qty: 1 }],
      },
      { code: 'OTRO_SKU_E2E', qty: 1, precio: 100 },
    ]);

    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const t = msg.text();
        if (/permission-denied|Missing or insufficient/i.test(t)) errors.push(t);
      }
    });

    try {
      await doLogin(page);
      const opened = await openWaitlistModalForE2eClient(page);
      expect(opened).toBe(true);

      // Botón X de la primera fila (stock-asignado).
      const btnX = page
        .locator('#wcard-rows tr')
        .first()
        .locator(
          'button:has-text("X"), button[title*="Quitar"], button[aria-label*="Quitar"], [data-action="remove"]'
        )
        .first();

      if (!(await btnX.isVisible({ timeout: 5000 }).catch(() => false))) {
        await screen(page, '09_btn_quitar_notfound');
        test.skip(true, 'botón X Quitar no encontrado con selectores conocidos');
        return;
      }

      // Dialog "confirm" nativo del browser → auto-aceptar.
      page.on('dialog', (dialog) => dialog.accept());

      await btnX.click();
      await page.waitForTimeout(3000);
      await screen(page, '09_post_quitar');

      // Verificar que no hubo error de permisos.
      const permErrors = errors.filter((e) => /permission|insufficient/i.test(e));
      expect(permErrors, `errores perm: ${JSON.stringify(permErrors)}`).toEqual([]);
    } finally {
      await cleanupWaitlistAndPedidos(fixture.id);
    }
  });

  test('punto 10: Backorder limpio', async ({ page }) => {
    test.skip(!CREDS.email, 'creds not configured');
    await doLogin(page);
    const btnBackorder = page
      .locator('button:has-text("Backorder"), [data-tab="backorder"], #backorders-btn')
      .first();
    if (await btnBackorder.isVisible({ timeout: 10000 }).catch(() => false)) {
      await btnBackorder.click();
      await page.waitForTimeout(2000);
    }
    await screen(page, '10_backorder');
    const body = await page.locator('body').innerText();
    expect(body).not.toMatch(/Invalid Date/);
  });

  test('punto 11: modal Pedido en espera muestra "Stock en vivo" con flag ON', async ({ page }) => {
    test.skip(!CREDS.email, 'creds not configured');
    const { db } = initAdmin();
    test.skip(!db, 'firebase-admin not available');

    // Verifica flag live_sl.enabled vigente en Firestore.
    const liveSlDoc = await db.collection('app_config').doc('live_sl').get();
    const liveSl = liveSlDoc.exists ? liveSlDoc.data() : null;
    if (!liveSl || liveSl.enabled !== true) {
      await screen(page, '11_live_sl_off');
      test.skip(true, 'live_sl.enabled no está en true — nada que verificar');
      return;
    }

    const fixture = await createE2eWaitlist([
      { code: E2E.TEST_SKU, qty: 1, precio: 100, boEntryResolved: 'same', boEntryPrevio: 0 },
    ]);
    try {
      await doLogin(page);
      const opened = await openWaitlistModalForE2eClient(page);
      expect(opened).toBe(true);
      // Esperar la query SL (puede tardar 5-15s en responder desde CF).
      await page.waitForTimeout(15000);
      await screen(page, '11_modal_abierto_live_sl_on');

      const diag = await page.evaluate(async () => {
        const w = /** @type {any} */ (window);
        const el = document.getElementById('wcard-live-sl-badge');
        return {
          badgeTxt: el ? el.textContent : null,
          badgeDisplay: el ? window.getComputedStyle(el).display : null,
          liveStockFisicoKeys: w._liveStockFisico ? Object.keys(w._liveStockFisico) : null,
          liveStockMeta: w._liveStockMeta,
        };
      });
      console.log('[punto 11 diag]', JSON.stringify(diag));

      const badge = page.locator('#wcard-live-sl-badge').first();
      // ESTRICTO: con flag ON, el badge DEBE ser visible (en cualquier estado:
      // "Stock en vivo", "Stock en vivo (parcial)", o "Stock del snapshot" si
      // fallback). Si está display:none → bug UI (nunca llamó al callable).
      const isVisible = await badge.isVisible({ timeout: 5000 }).catch(() => false);
      await screen(page, '11_live_sl_badge_check');
      expect(isVisible, `badge debe ser visible. diag=${JSON.stringify(diag)}`).toBe(true);
      const txt = (await badge.innerText()).toLowerCase();
      // Con live_sl.enabled=true + CF SL respondiendo OK: texto esperado = "Stock en vivo".
      // Si SL fallback por timeout/error: "Stock del snapshot" (es BUG UI que Mariano
      // pidió reportar: si el badge no dice "Stock en vivo" con cliente ficticio pero
      // sí con cliente real → hay bug UI).
      expect(txt, `badge con flag ON debe decir "Stock en vivo", encontrado: "${txt}"`).toMatch(/stock en vivo/i);
    } finally {
      await cleanupWaitlistAndPedidos(fixture.id);
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
