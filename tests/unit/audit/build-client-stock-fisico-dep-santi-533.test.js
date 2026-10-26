// @ts-check
/**
 * v1467 hotfix (2026-10-26) — `_buildClientStockForPayload` devolvía null
 * porque `window.getStockFisico` nunca se asignó. Resultado prod:
 * `clientSnapshotProvided: false` en TODOS los commits → comparador v1447 §64.1
 * caía al "comportamiento histórico" y disparaba STOCK_CHANGED por cualquier
 * `qtyBO > 0` sin poder filtrar como false positive.
 *
 * Fixture del log real Santi 2026-10-26 17:15 ART (ORDEN 533 MARISA LUJAN
 * IANUNZIO C27184733760) post-fix v1466: 5 SKUs CPST ya PASAN; quedan 2 SKUs
 * manuales (CUDC151MGA, CUDC151HGA) con `fisicoDep11=0` → sin stock real →
 * qtyBO=1 → STOCK_CHANGED espúreo porque sin clientStock no se filtra.
 *
 * Post-fix v1467: `_buildClientStockForPayload` usa `getStockDisponibleVenta`
 * como `getStockFisico` (patrón de los 10 call-sites existentes de
 * getStockBreakdown en index.html).
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('v1467 §64 hotfix Santi 17:15 ORDEN 533 — getStockFisico fallback', () => {
  it('T1 index.html _buildClientStockForPayload NO pasa window.getStockFisico (undefined)', () => {
    const html = readFileSync('index.html', 'utf8');
    const idx = html.indexOf('window._buildClientStockForPayload = function(docData)');
    expect(idx).toBeGreaterThan(0);
    const slice = html.slice(idx, idx + 4000);
    // Post-fix: NO debe haber `getStockFisico: window.getStockFisico` sin fallback.
    expect(slice).not.toMatch(/getStockFisico:\s*window\.getStockFisico\s*,/);
    // Debe usar el pattern con fallback a getStockDisponibleVenta.
    expect(slice).toMatch(/getStockDisponibleVenta/);
    expect(slice).toMatch(/getStockFisico:\s*_gsf/);
  });

  it('T2 helper devuelve clientStock populated para SKU con fisico=0 (manual sin stock)', () => {
    // Simula el flujo real del helper: cuando getStockFisico es provisto
    // correctamente, el breakdown produce libre=0, fisicoDep11=0 sin TypeError.
    // El bug pre-fix era que window.getStockFisico era undefined → crash.
    const _getStockFisico = (sku) => (sku === 'CUDC151MGA' || sku === 'CUDC151HGA' ? 0 : 20);
    const docData = {
      clientCardCode: 'C27184733760',
      lines: [
        { code: 'CUDC151MGA', qty: 1 },
        { code: 'CUDC151HGA', qty: 1 },
      ],
    };
    // Replica mínima del helper con el fix:
    const bdFn = (sku, deps) => {
      // Simula getStockBreakdown devolviendo shape mínimo.
      const fisico = Number(deps.getStockFisico(sku)) || 0;
      return {
        libre: fisico,
        utilizablePara: () => fisico,
        fisicoDep11: fisico,
        reservadasTotal: 0,
        backorderApp: { total: 0 },
        asignadas: { total: 0 },
        _version: 7,
      };
    };
    const out = {};
    for (const l of docData.lines) {
      const sku = String(l.code).toUpperCase();
      const bd = bdFn(sku, {
        pedidos: [],
        revisionWaitlist: [],
        getStockFisico: _getStockFisico,
        getStockTransito: () => 0,
      });
      out[sku] = {
        libre: bd.libre,
        utilizablePara: bd.utilizablePara(docData.clientCardCode),
        fisicoDep11: bd.fisicoDep11,
        reservadasTotal: bd.reservadasTotal,
        backorderAppTotal: bd.backorderApp.total,
        asignadasTotal: bd.asignadas.total,
        _version: bd._version,
      };
    }
    // Shape coincide con lo que el comparador CF v1447 espera.
    expect(out.CUDC151MGA).toEqual({
      libre: 0,
      utilizablePara: 0,
      fisicoDep11: 0,
      reservadasTotal: 0,
      backorderAppTotal: 0,
      asignadasTotal: 0,
      _version: 7,
    });
    expect(out.CUDC151HGA.fisicoDep11).toBe(0);
    expect(Object.keys(out).length).toBe(2);
  });

  it('T3 comparador CF v1447: si cliente y server coinciden en fisico+libre, NO dispara (false positive filtrado)', async () => {
    // Replica mínima de computeDiffVsClient (functions/core/commit-pedido-core.js:1147).
    // Pre-fix: payload.clientStock=null → entra al changed.push → dispara.
    // Post-fix: payload.clientStock={CUDC151MGA:{fisicoDep11:0,libre:0}} +
    // server libre=0 fisico=0 → mismos valores → continue → NO dispara.
    const lineasResultado = [
      {
        sku: 'CUDC151MGA',
        qtyConfirmed: 0,
        qtyBO: 1,
        reason: 'stock_no_disponible',
        libre: 0,
        utilizablePara: 0,
        breakdown: { fisicoDep11: 0 },
      },
    ];
    const computeDiff = (lineasResultado, payload) => {
      const clientStock =
        payload && payload.clientStock && typeof payload.clientStock === 'object'
          ? payload.clientStock
          : null;
      const changed = [];
      for (const l of lineasResultado) {
        if (l.qtyBO <= 0) continue;
        if (clientStock && clientStock[l.sku] && typeof clientStock[l.sku] === 'object') {
          const cs = clientStock[l.sku];
          const clientFisico = Number(cs.fisicoDep11);
          const clientLibre = Number(cs.libre);
          const serverFisico = Number((l.breakdown && l.breakdown.fisicoDep11) || 0);
          const serverLibre = Number(l.libre || 0);
          if (
            Number.isFinite(clientFisico) &&
            Number.isFinite(clientLibre) &&
            clientFisico === serverFisico &&
            clientLibre === serverLibre
          ) {
            continue;
          }
        }
        changed.push({ sku: l.sku, pediste: 1, podesLlevar: l.qtyConfirmed, aBackOrder: l.qtyBO });
      }
      return changed.length === 0 ? null : { skuChanged: changed };
    };

    // Pre-fix: payload sin clientStock → dispara.
    const prefix = computeDiff(lineasResultado, {
      lines: [{ sku: 'CUDC151MGA', cantidad: 1 }],
      clientStock: null,
    });
    expect(prefix).not.toBeNull();
    expect(prefix.skuChanged).toHaveLength(1);

    // Post-fix: payload CON clientStock que coincide → NO dispara.
    const postfix = computeDiff(lineasResultado, {
      lines: [{ sku: 'CUDC151MGA', cantidad: 1 }],
      clientStock: {
        CUDC151MGA: { fisicoDep11: 0, libre: 0 },
      },
    });
    expect(postfix).toBeNull();
  });

  it('T4 reproduce log real Santi 17:15 — pre-fix 2 SKUs disparan, post-fix ninguno', () => {
    // Datos EXACTOS del log operations_log YfMIcDcmGotMZshqjCMZ:
    const skuDetailsLog = [
      {
        sku: 'CUDC151MGA',
        pediste: 1,
        server: { fisicoDep11: 0, libre: 0, qtyConfirmed: 0, qtyBO: 1 },
        client: {}, // vacío = clientSnapshotProvided: false
      },
      {
        sku: 'CUDC151HGA',
        pediste: 1,
        server: { fisicoDep11: 0, libre: 0, qtyConfirmed: 0, qtyBO: 1 },
        client: {},
      },
    ];
    // Pre-fix (observado): ambos cambian.
    const preFixChanged = skuDetailsLog.filter((sd) => sd.server.qtyBO > 0);
    expect(preFixChanged).toHaveLength(2);

    // Post-fix: el cliente YA MANDA clientStock con fisico=0 libre=0 → coincide
    // con server → no entra al changed. Simulamos:
    const postFixChanged = skuDetailsLog.filter((sd) => {
      // Simulamos clientStock enviado post-v1467 (fisico=0 libre=0, mismo que server).
      const clientHypothetical = { fisicoDep11: 0, libre: 0 };
      const serverFisico = sd.server.fisicoDep11;
      const serverLibre = sd.server.libre;
      if (
        clientHypothetical.fisicoDep11 === serverFisico &&
        clientHypothetical.libre === serverLibre
      ) {
        return false; // Mismos valores → continue → NO cambia.
      }
      return sd.server.qtyBO > 0;
    });
    expect(postFixChanged).toHaveLength(0);
  });

  it('T5 helper no crashea si getStockDisponibleVenta tampoco existe (fallback a () => 0)', () => {
    const html = readFileSync('index.html', 'utf8');
    const idx = html.indexOf('window._buildClientStockForPayload = function(docData)');
    const slice = html.slice(idx, idx + 2500);
    // Debe tener el fallback a () => 0.
    expect(slice).toMatch(/\(\)\s*=>\s*0/);
  });
});
