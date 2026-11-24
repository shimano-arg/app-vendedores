// @ts-check
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * §91 (Fix D12-CRITICAL-01 2026-11-20) — tests de contrato grep.
 *
 * Previene regresion silenciosa del hardcode `discountPct: 0` y del payload
 * que omite discountPct/discountSnapshot.
 */

const ROOT = resolve(__dirname, '../../..');
const coreTxt = readFileSync(resolve(ROOT, 'functions/core/commit-pedido-core.js'), 'utf8');
const indexTxt = readFileSync(resolve(ROOT, 'index.html'), 'utf8');
const mainTxt = readFileSync(resolve(ROOT, 'src/main.js'), 'utf8');

describe('§91 D12 — contrato commit-pedido-core.js', () => {
  it('importa resolveDiscountForPersist del validator', () => {
    expect(coreTxt).toMatch(/from\s+['"]\.\/discount-validator(\.js)?['"]/);
    expect(coreTxt).toContain('resolveDiscountForPersist');
  });

  it('no deja hardcode `discountPct: 0,` en buildPedidoDocData', () => {
    // Match exacto que pre-fix persistia 0 siempre.
    const hardcodeRegex = /discountPct:\s*0\s*,/;
    expect(hardcodeRegex.test(coreTxt)).toBe(false);
  });

  it('usa el spread del helper en lugar del hardcode', () => {
    expect(coreTxt).toContain('...resolveDiscountForPersist(payload)');
  });
});

describe('§91 D12 — contrato index.html _tryCommitPedidoCF', () => {
  it('payload include discountPct desde docData', () => {
    expect(indexTxt).toMatch(/discountPct:\s*Number\(docData\.discountPct\)/);
  });

  it('payload include discountSnapshot desde docData', () => {
    expect(indexTxt).toMatch(/discountSnapshot:\s*\(docData\.discountSnapshot/);
  });
});

describe('§91 D12 — contrato src/main.js exposure', () => {
  it('importa resolveAndValidateDiscount/sanitizeDiscountSnapshot/resolveDiscountForPersist', () => {
    expect(mainTxt).toContain('resolveAndValidateDiscount');
    expect(mainTxt).toContain('sanitizeDiscountSnapshot');
    expect(mainTxt).toContain('resolveDiscountForPersist');
    expect(mainTxt).toMatch(/from\s+['"]\.\/pure\/discount-validator(\.js)?['"]/);
  });

  it('expone window.__phase0.pure.discountValidator', () => {
    expect(mainTxt).toContain('discountValidator:');
  });
});
