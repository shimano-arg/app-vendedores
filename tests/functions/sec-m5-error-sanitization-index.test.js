// @ts-check
/**
 * SEC-M5 (HARDENING5 B2, 2026-11-19) — anti-regresión sanitización en
 * functions/index.js del worktree batch-2.
 *
 * Verifica que cada uno de los catches INFRASTRUCTURE identificados en
 * `functions/index.js` tiene el patrón correcto post-fix:
 *   1. `console.error('[<fnName>:<ctxLabel>]', e)` server-side para
 *      logging (Cloud Logging).
 *   2. `throw new HttpsError('internal', '<mensaje genérico>')` SIN e.message,
 *      o re-throw whitelist de codes canónicos.
 *
 * Diferencia con R01 Fase 2B (worktree principal):
 *  - batch-2 NO tiene `deletePedidoCF` ni `revertPedidoToPendingCF` (son de
 *    Fase 2A/B del worktree principal, NO mergeados a main todavía).
 *  - batch-2 agrega los 6 gaps: geminiOcrProxy + updateAsigLineStateCF +
 *    resendPlannerEmail (B7 sin `detail`) + triggerRendicionesEmailManual +
 *    triggerPlannerSync (×4 steps del summary).
 *
 * Total catches sanitizados en batch-2: 16 (9 HIGH patron 1 + 2 HIGH patron 2 +
 * 1 HIGH patron 3 + 4 HIGH patron 5). Tests: 8 markers con mensaje + 7 markers
 * extras (gaps) + N anti-regresión patrones viejos.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const INDEX_SOURCE = readFileSync(resolve(__dirname, '../../functions/index.js'), 'utf8');

describe('SEC-M5 anti-regresión: functions/index.js post-fix (batch-2)', () => {
  // Cada entry tiene un fragmento ÚNICO que identifica el catch sanitizado.
  // Buscamos la presencia del fragmento post-sanitización.
  const SANITIZED_WRAPPERS = [
    // --- 10 catches HIGH patron 1 (string concat e?.message) ---
    {
      name: 'applyRepartoManualCF:roleLookup',
      marker: '[applyRepartoManualCF:roleLookup]',
      genericMessage: "throw new HttpsError('internal', 'no se pudo validar rol')",
    },
    {
      name: 'applyRepartoManualCF:general',
      marker: '[applyRepartoManualCF:general]',
      genericMessage:
        "throw new HttpsError('internal', 'reparto fallo, reintenta en unos segundos')",
    },
    {
      name: 'releaseAsigCF:general',
      marker: '[releaseAsigCF:general]',
      genericMessage:
        "throw new HttpsError('internal', 'release asig fallo, reintenta en unos segundos')",
    },
    {
      name: 'movePedidoToWaitlistCF:general',
      marker: '[movePedidoToWaitlistCF:general]',
      genericMessage:
        "throw new HttpsError('internal', 'operacion fallo, reintenta en unos segundos')",
    },
    {
      name: 'unifyWaitlistsCF:general',
      marker: '[unifyWaitlistsCF:general]',
      genericMessage: "throw new HttpsError('internal', 'unify fallo, reintenta en unos segundos')",
    },
    {
      name: 'setupGetMovimientos:general',
      marker: '[setupGetMovimientos:general]',
      genericMessage: "throw new HttpsError('internal', 'error al procesar movimientos')",
    },
    {
      name: 'commitPedidoCF:general',
      marker: '[commitPedidoCF:general]',
      genericMessage:
        "throw new HttpsError('internal', 'error inesperado, reintenta en unos segundos')",
    },
    {
      name: 'updatePedidoLinesCF:general',
      marker: '[updatePedidoLinesCF:general]',
      genericMessage: "throw new HttpsError('internal', 'error inesperado al guardar lineas')",
    },
    // --- 2 catches HIGH patron 2 (throw err.code, err.message sin whitelist) ---
    {
      name: 'updateAsigLineStateCF:general',
      marker: '[updateAsigLineStateCF:general]',
      genericMessage: "throw new HttpsError('internal', 'error interno al actualizar estado')",
    },
    {
      name: 'geminiOcrProxy:general',
      marker: '[geminiOcrProxy:general]',
      // No tiene mensaje fijo sino parte de la whitelist + errorCode in details.
      // Verificar presencia del comentario SEC-M5 y errorCode.
    },
    // --- 1 catch HIGH patron 3 (details: err?.message) ---
    {
      name: 'resendPlannerEmail:general',
      marker: '[resendPlannerEmail:general]',
      genericMessage:
        "throw new HttpsError('internal', 'reenvio fallo, reintenta en unos segundos')",
    },
    // --- H9 triggerRendicionesEmailManual (reemplaza "err.code || internal") ---
    {
      name: 'triggerRendicionesEmailManual:general',
      marker: '[triggerRendicionesEmailManual:general]',
      genericMessage:
        "throw new HttpsError(\n        'internal',\n        'error al disparar el envio de rendiciones, avisale a Mariano'\n      )",
    },
    // --- H10 ×4 triggerPlannerSync 4 steps del summary ---
    {
      name: 'triggerPlannerSync:invoices',
      marker: '[triggerPlannerSync:invoices]',
    },
    {
      name: 'triggerPlannerSync:orders',
      marker: '[triggerPlannerSync:orders]',
    },
    {
      name: 'triggerPlannerSync:payments',
      marker: '[triggerPlannerSync:payments]',
    },
    {
      name: 'triggerPlannerSync:closures',
      marker: '[triggerPlannerSync:closures]',
    },
  ];

  for (const wrapper of SANITIZED_WRAPPERS) {
    it(`${wrapper.name}: contiene marker sanitizado "${wrapper.marker}"`, () => {
      expect(INDEX_SOURCE.includes(wrapper.marker)).toBe(true);
    });

    if (wrapper.genericMessage) {
      it(`${wrapper.name}: contiene mensaje genérico esperado`, () => {
        expect(INDEX_SOURCE.includes(wrapper.genericMessage)).toBe(true);
      });
    }
  }

  // Verificación negativa: los patrones VIEJOS (pre-fix) NO deben aparecer.
  const PROHIBITED_OLD_PATTERNS = [
    "throw new HttpsError('internal', 'no se pudo validar rol: ' + (e?.message || String(e)))",
    "throw new HttpsError('internal', 'reparto fallo: ' + (e?.message || String(e)))",
    "throw new HttpsError('internal', 'release asig fallo: ' + (e?.message || String(e)))",
    "throw new HttpsError('internal', 'move fallo: ' + (e?.message || String(e)))",
    "throw new HttpsError('internal', 'unify fallo: ' + (e?.message || String(e)))",
    "throw new HttpsError('internal', String(e && e.message ? e.message : e))",
    "throw new HttpsError('internal', 'error inesperado: ' + (e?.message || String(e)))",
    "throw new HttpsError('internal', 'Resend failed', { detail: err?.message })",
    "throw new HttpsError(err.code || 'internal', err.message || String(err))",
  ];

  for (const pattern of PROHIBITED_OLD_PATTERNS) {
    it(`anti-regresión: NO contiene patrón viejo "${pattern.slice(0, 80)}..."`, () => {
      expect(INDEX_SOURCE.includes(pattern)).toBe(false);
    });
  }

  // Verificación específica M4: geminiOcrProxy no propaga err.message crudo.
  it('geminiOcrProxy: whitelist de codes canónicos + errorCode GEMINI_OCR_FAILED', () => {
    expect(INDEX_SOURCE.includes("errorCode: 'GEMINI_OCR_FAILED'")).toBe(true);
    // Mensaje genérico de OCR al cliente.
    expect(INDEX_SOURCE.includes("'OCR fallo, reintenta en unos segundos'")).toBe(true);
  });

  // Verificación específica H10: triggerPlannerSync NO propaga e.message al cliente.
  it('triggerPlannerSync: summary.errors push usa mensajes genericos no e.message', () => {
    // 4 steps con mensaje fijo (sin e.message).
    expect(INDEX_SOURCE.includes("message: 'error al sincronizar facturas'")).toBe(true);
    expect(INDEX_SOURCE.includes("message: 'error al sincronizar ordenes de venta'")).toBe(true);
    expect(INDEX_SOURCE.includes("message: 'error al sincronizar cobranzas'")).toBe(true);
    expect(INDEX_SOURCE.includes("message: 'error al sincronizar cierres de cotizacion'")).toBe(
      true
    );
  });

  // Verificación específica B7 resendPlannerEmail: zero `details: err?.message`.
  it('resendPlannerEmail: zero `detail: err?.message` en el HttpsError', () => {
    expect(INDEX_SOURCE.includes('detail: err?.message')).toBe(false);
    expect(INDEX_SOURCE.includes('detail: err.message')).toBe(false);
  });
});
