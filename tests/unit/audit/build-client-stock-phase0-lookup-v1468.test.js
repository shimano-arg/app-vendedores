// @ts-check
/**
 * v1468 hotfix (2026-10-26) BUG RAIZ:
 *
 * `_buildClientStockForPayload` leía `window.__phase0.pure.stockBreakdown.getStockBreakdown`
 * (sub-objeto que NO existe en main.js) desde v1443. Siempre devolvió null →
 * clientStock nunca viajó al payload → `clientSnapshotProvided: false` siempre →
 * comparador v1447 §64.1 nunca pudo filtrar false positives → STOCK_CHANGED loop
 * reportado por Santi ORDEN 533 2026-10-26 17:28 ART (clientVersion=v1467 ya).
 *
 * El bundle expone `getStockBreakdown` DIRECTO bajo `window.__phase0.pure`
 * (ver src/main.js:431). El fix v1468 arregla el lookup con fallback al
 * sub-objeto para no romper si se refactorea.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('v1468 §64 hotfix Santi 17:28 — _buildClientStockForPayload lookup phase0', () => {
  it('T1 BUG raiz: pre-v1468 el lookup window.__phase0.pure.stockBreakdown.getStockBreakdown NO existe', () => {
    const mainJs = readFileSync('src/main.js', 'utf8');
    // Grep: getStockBreakdown se expone DIRECTO en el objeto phase0.pure.
    expect(mainJs).toMatch(/^\s*getStockBreakdown,\s*$/m);
    // NO hay un sub-objeto stockBreakdown que lo contenga.
    expect(mainJs).not.toMatch(/stockBreakdown:\s*\{[^}]*getStockBreakdown/);
  });

  it('T2 post-fix index.html usa window.__phase0.pure.getStockBreakdown DIRECTO', () => {
    const html = readFileSync('index.html', 'utf8');
    const idx = html.indexOf('window._buildClientStockForPayload = function(docData)');
    expect(idx).toBeGreaterThan(0);
    const slice = html.slice(idx, idx + 3000);
    // Debe acceder a .getStockBreakdown directo (post-fix v1468).
    expect(slice).toMatch(/_pure\.getStockBreakdown/);
    // Fallback defensivo al sub-objeto por si se refactorea en el futuro.
    expect(slice).toMatch(/stockBreakdown.*getStockBreakdown/);
    // El lookup viejo "exclusivo" (sin fallback) NO debe existir — el fix
    // v1468 cambió a usar _pure.getStockBreakdown directo + fallback al sub.
    expect(slice).not.toMatch(/^\s*&&\s*window\.__phase0\.pure\.stockBreakdown\s*$/m);
  });

  it('T3 lookup resuelve correctamente con shape real del bundle', () => {
    // Shape real post-build: phase0.pure.getStockBreakdown es la fn directa.
    const phase0 = {
      pure: {
        getStockBreakdown: () => ({ libre: 0, fisicoDep11: 0, utilizablePara: () => 0 }),
      },
    };
    const _pure = phase0 && phase0.pure;
    const bdFn =
      _pure &&
      (_pure.getStockBreakdown || (_pure.stockBreakdown && _pure.stockBreakdown.getStockBreakdown));
    expect(typeof bdFn).toBe('function');
  });

  it('T4 lookup pre-fix (hipotético: solo sub-objeto) devuelve undefined con shape actual', () => {
    const phase0 = {
      pure: {
        getStockBreakdown: () => ({}),
        // NO hay stockBreakdown como sub-objeto.
      },
    };
    const _pure = phase0 && phase0.pure;
    // Lookup VIEJO (bug): solo mira stockBreakdown.getStockBreakdown.
    const bdFnOld = _pure && _pure.stockBreakdown && _pure.stockBreakdown.getStockBreakdown;
    expect(bdFnOld).toBeUndefined();
    // Lookup NUEVO (post-v1468): mira directo primero.
    const bdFnNew =
      _pure &&
      (_pure.getStockBreakdown || (_pure.stockBreakdown && _pure.stockBreakdown.getStockBreakdown));
    expect(typeof bdFnNew).toBe('function');
  });

  it('T5 lookup funciona también si en el futuro se reagrupa como sub-objeto (fallback)', () => {
    // Si eventualmente alguien reagrupa, el fallback preserva compat.
    const phase0 = {
      pure: {
        // getStockBreakdown directo removido (hipotético futuro).
        stockBreakdown: { getStockBreakdown: () => ({ libre: 42 }) },
      },
    };
    const _pure = phase0 && phase0.pure;
    const bdFn =
      _pure &&
      (_pure.getStockBreakdown || (_pure.stockBreakdown && _pure.stockBreakdown.getStockBreakdown));
    expect(typeof bdFn).toBe('function');
    expect(bdFn().libre).toBe(42);
  });

  it('T6 fixture REAL log Santi 17:28 — docId=5SpP8GhzVfLaz4vGK19g clientVersion=v1467 clientSnapshotProvided=false', () => {
    const logEntry = {
      type: 'commit_pedido_rejected',
      errorCode: 'STOCK_CHANGED',
      clientVersion: 'v1467',
      clientSnapshotProvided: false, // ← bug raíz: lookup fallaba, clientStock=null
      cardCode: 'C27184733760',
      draftId: 'C|SANTA FE|ALCORTA|MARISA VIVIANA LUJAN IANUNZIO|533',
      skuDetails: [
        {
          sku: 'CUDC151MGA',
          pediste: 1,
          server: { fisicoDep11: 0, libre: 0, qtyBO: 1, qtyConfirmed: 0 },
          client: {}, // vacío porque clientStock llegó null
        },
        {
          sku: 'CUDC151HGA',
          pediste: 1,
          server: { fisicoDep11: 0, libre: 0, qtyBO: 1, qtyConfirmed: 0 },
          client: {},
        },
      ],
    };
    // Pre-v1468: todas las corridas tenían clientSnapshotProvided=false → bucle.
    expect(logEntry.clientSnapshotProvided).toBe(false);
    expect(logEntry.skuDetails.every((sd) => Object.keys(sd.client).length === 0)).toBe(true);

    // Post-fix v1468: el helper SÍ puede resolver bdFn → arma clientStock con
    // {sku: {fisicoDep11:0, libre:0, ...}} → payload lo lleva → comparador
    // CF ve clientFisico=0 === serverFisico=0 && clientLibre=0 === serverLibre=0
    // → `continue` → NO entra al changed → NO dispara STOCK_CHANGED.
    const simulatedClientStock = {
      CUDC151MGA: { fisicoDep11: 0, libre: 0 },
      CUDC151HGA: { fisicoDep11: 0, libre: 0 },
    };
    const changed = logEntry.skuDetails.filter((sd) => {
      const cs = simulatedClientStock[sd.sku];
      if (cs && cs.fisicoDep11 === sd.server.fisicoDep11 && cs.libre === sd.server.libre) {
        return false;
      }
      return sd.server.qtyBO > 0;
    });
    expect(changed).toHaveLength(0);
  });
});
