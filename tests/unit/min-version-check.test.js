// @ts-check
/**
 * Stack S-7 P1-C (v1588 2026-11-25) — tests del pure helper min-version-check.
 *
 * Caso de uso: enforcement pre-confirm de versión mínima. Chequea que
 * `shouldForceReload` devuelva lo esperado para los 6 casos canónicos del
 * contrato (local >= / local < / local parseable / local null / min null /
 * both equal) + una decena de edge cases.
 */
import { describe, expect, it } from 'vitest';
import {
  compareAppVersion,
  parseAppVersion,
  shouldForceReload,
} from '../../src/pure/min-version-check.js';

describe('parseAppVersion', () => {
  it('parsea "v1234" → 1234', () => {
    expect(parseAppVersion('v1234')).toBe(1234);
  });
  it('parsea "V1234" (mayúscula) → 1234', () => {
    expect(parseAppVersion('V1234')).toBe(1234);
  });
  it('parsea "1234" sin prefijo → 1234', () => {
    expect(parseAppVersion('1234')).toBe(1234);
  });
  it('tolera espacios al borde', () => {
    expect(parseAppVersion('  v1234  ')).toBe(1234);
  });
  it('devuelve null para null / undefined / string vacía', () => {
    expect(parseAppVersion(null)).toBeNull();
    expect(parseAppVersion(undefined)).toBeNull();
    expect(parseAppVersion('')).toBeNull();
    expect(parseAppVersion('   ')).toBeNull();
  });
  it('devuelve null para strings no numéricas', () => {
    expect(parseAppVersion('vALGO')).toBeNull();
    expect(parseAppVersion('abc')).toBeNull();
    expect(parseAppVersion('v1.2.3')).toBeNull();
  });
  it('acepta 0', () => {
    expect(parseAppVersion('v0')).toBe(0);
    expect(parseAppVersion('0')).toBe(0);
  });
  it('tolera números (no strings)', () => {
    expect(parseAppVersion(1234)).toBe(1234);
  });
});

describe('shouldForceReload — contrato de 6 casos canónicos', () => {
  it('local >= min → false (local mayor)', () => {
    expect(shouldForceReload('v1600', 'v1588')).toBe(false);
  });
  it('local >= min → false (igual)', () => {
    expect(shouldForceReload('v1588', 'v1588')).toBe(false);
  });
  it('local < min → true', () => {
    expect(shouldForceReload('v1568', 'v1588')).toBe(true);
  });
  it('local null → false (fail-open)', () => {
    expect(shouldForceReload(null, 'v1588')).toBe(false);
    expect(shouldForceReload(undefined, 'v1588')).toBe(false);
    expect(shouldForceReload('', 'v1588')).toBe(false);
  });
  it('min null → false (gate no configurado)', () => {
    expect(shouldForceReload('v1588', null)).toBe(false);
    expect(shouldForceReload('v1588', undefined)).toBe(false);
    expect(shouldForceReload('v1588', '')).toBe(false);
  });
  it('ambos null → false', () => {
    expect(shouldForceReload(null, null)).toBe(false);
  });
});

describe('shouldForceReload — edge cases', () => {
  it('local parseable pero min garbage → false (fail-open §77)', () => {
    expect(shouldForceReload('v1588', 'vABC')).toBe(false);
    expect(shouldForceReload('v1588', 'v1.2.3')).toBe(false);
  });
  it('local garbage pero min parseable → false (fail-open §77)', () => {
    expect(shouldForceReload('vXYZ', 'v1588')).toBe(false);
  });
  it('local cero + min positivo → true', () => {
    expect(shouldForceReload('v0', 'v1')).toBe(true);
  });
  it('ambos cero → false', () => {
    expect(shouldForceReload('v0', 'v0')).toBe(false);
  });
  it('local > min por 1 → false', () => {
    expect(shouldForceReload('v1588', 'v1588')).toBe(false);
  });
  it('local < min por 1 → true', () => {
    expect(shouldForceReload('v1586', 'v1588')).toBe(true);
  });
});

describe('compareAppVersion', () => {
  it('a < b → -1', () => {
    expect(compareAppVersion('v1500', 'v1600')).toBe(-1);
  });
  it('a > b → 1', () => {
    expect(compareAppVersion('v1600', 'v1500')).toBe(1);
  });
  it('a === b → 0', () => {
    expect(compareAppVersion('v1500', 'v1500')).toBe(0);
  });
  it('cualquiera no parseable → null', () => {
    expect(compareAppVersion(null, 'v1500')).toBeNull();
    expect(compareAppVersion('v1500', null)).toBeNull();
    expect(compareAppVersion('abc', 'v1500')).toBeNull();
  });
});
