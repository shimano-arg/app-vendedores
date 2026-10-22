// @ts-check
/**
 * v1416 §42.2 (2026-10-22) — tests de flow + grep del guard en pedidos-modal.js.
 *
 * Validan que el nuevo guard reemplazó al bloque v1370 "resolve each ASIG line
 * first" por una oferta de unificación §42.2.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const PEDIDOS_MODAL = readFileSync('src/domains/pedidos-modal.js', 'utf8');
const MAIN_JS = readFileSync('src/main.js', 'utf8');
const PURE_GUARD = readFileSync('src/pure/review-guard-unify.js', 'utf8');

describe('v1416 §42.2 — grep de contrato del guard', () => {
  it('validateReviewAndPasarAPendientes es async (necesita await fresh query)', () => {
    expect(PEDIDOS_MODAL).toMatch(
      /window\.validateReviewAndPasarAPendientes\s*=\s*async\s+function/
    );
  });

  it('el guard viejo "STOCK ASIGNADO sin resolver" fue removido', () => {
    expect(PEDIDOS_MODAL).not.toMatch(/linea\(s\) con STOCK ASIGNADO sin resolver en/);
    expect(PEDIDOS_MODAL).not.toMatch(/asigCubiertasPorCpst/);
  });

  it('el nuevo guard hace fresh query a revision_waitlist por clientCardCode', () => {
    expect(PEDIDOS_MODAL).toMatch(
      /fbDb[\s\S]{0,80}\.collection\(['"]revision_waitlist['"]\)[\s\S]{0,120}\.where\(['"]clientCardCode['"]/
    );
  });

  it('el fallback a cache local está presente si la fresh query falla (§42.1 pattern)', () => {
    expect(PEDIDOS_MODAL).toMatch(/\[§42\.2 review guard\][\s\S]{0,200}fresh query fallo/);
    expect(PEDIDOS_MODAL).toMatch(/window\.revisionWaitlist/);
  });

  it('loggea telemetría cuando el guard dispara (para detectar fallas §42)', () => {
    expect(PEDIDOS_MODAL).toMatch(
      /\[§42\.2 review guard\][\s\S]{0,250}orden\(es\) abierta\(s\) en Lista de Espera/
    );
  });

  it('ofrece confirm nativo con texto "¿Unificar?" + handle Cancel = volver a editar', () => {
    expect(PEDIDOS_MODAL).toMatch(/window\.confirm/);
    expect(PEDIDOS_MODAL).toMatch(/VDE cancelo unificacion/);
  });

  it('mergea items via mergeWaitlistIntoOrderLines + fallback inline si el bundle no cargó', () => {
    expect(PEDIDOS_MODAL).toMatch(/mergeWaitlistIntoOrderLines/);
    // Fallback inline por seguridad (SW cache stale).
    expect(PEDIDOS_MODAL).toMatch(/importedFromOrder/);
    expect(PEDIDOS_MODAL).toMatch(/_unifiedFromWaitlistId/);
  });

  it('marca waitlist consumed con closedReason unified_at_review', () => {
    expect(PEDIDOS_MODAL).toMatch(/stage:\s*['"]consumed['"]/);
    expect(PEDIDOS_MODAL).toMatch(/closedReason:\s*['"]unified_at_review['"]/);
    expect(PEDIDOS_MODAL).toMatch(/unifiedIntoCurrentOrder/);
  });

  it('re-abre modal review post-unificación (closeReviewDialog + openReviewDialog)', () => {
    // El flow correcto: cerrar+reabrir para que renderReviewLines re-pinte con las
    // líneas unificadas; el VDE presiona Confirmar de nuevo + ya no dispara §42.2
    // porque el waitlist quedó consumed.
    const guardSlice = PEDIDOS_MODAL.slice(
      PEDIDOS_MODAL.indexOf('§42.2 review guard'),
      PEDIDOS_MODAL.indexOf('Forma de pago obligatoria')
    );
    expect(guardSlice).toMatch(/closeReviewDialog\(\)/);
    expect(guardSlice).toMatch(/openReviewDialog\(['"]crear['"]/);
  });

  it('alert al VDE con cantidad de líneas agregadas y total u', () => {
    expect(PEDIDOS_MODAL).toMatch(/unificada:[\s\S]{0,120}linea\(s\) agregada\(s\)/);
  });
});

describe('v1416 §42.2 — main.js expone reviewGuardUnify helpers', () => {
  it('main.js importa el helper puro', () => {
    expect(MAIN_JS).toMatch(/from\s+['"]\.\/pure\/review-guard-unify\.js['"]/);
    expect(MAIN_JS).toMatch(/mergeWaitlistIntoOrderLines/);
    expect(MAIN_JS).toMatch(/buildUnifiedAtReviewUpdate/);
    expect(MAIN_JS).toMatch(/formatUnifyConfirmMessage/);
  });

  it('expuesto en window.__phase0.pure.reviewGuardUnify.*', () => {
    expect(MAIN_JS).toMatch(/reviewGuardUnify:\s*\{/);
  });
});

describe('v1416 §42.2 — contrato del pure review-guard-unify', () => {
  it('exporta las 3 funciones públicas', () => {
    expect(PURE_GUARD).toMatch(/export function mergeWaitlistIntoOrderLines/);
    expect(PURE_GUARD).toMatch(/export function buildUnifiedAtReviewUpdate/);
    expect(PURE_GUARD).toMatch(/export function formatUnifyConfirmMessage/);
  });

  it('comment-header menciona §42.2 + reporte PONTORIERO', () => {
    expect(PURE_GUARD).toMatch(/§42\.2/);
    expect(PURE_GUARD).toMatch(/PONTORIERO|unificación/i);
  });
});
