// @ts-check
/**
 * §J (v1455 2026-10-25) — Sync test: src/pure/absorb-bo-on-confirm.js
 * y functions/core/absorb-bo-on-confirm.js deben ser byte-exact (§57).
 *
 * Si uno diverge del otro: FAIL. El fix es actualizar ambos lados.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..', '..', '..');

describe('§J absorb-bo-on-confirm — sync pure vs mirror', () => {
  it('src/pure/absorb-bo-on-confirm.js === functions/core/absorb-bo-on-confirm.js (byte-exact)', () => {
    const pureFile = readFileSync(join(ROOT, 'src', 'pure', 'absorb-bo-on-confirm.js'), 'utf8');
    const mirrorFile = readFileSync(
      join(ROOT, 'functions', 'core', 'absorb-bo-on-confirm.js'),
      'utf8'
    );
    // Normalizar line endings (CRLF/LF) para evitar flaky en Windows checkout.
    const normPure = pureFile.replace(/\r\n/g, '\n');
    const normMirror = mirrorFile.replace(/\r\n/g, '\n');
    expect(normPure).toBe(normMirror);
  });

  it('ambos files tienen computeBoAbsorption exportada', () => {
    const pureFile = readFileSync(join(ROOT, 'src', 'pure', 'absorb-bo-on-confirm.js'), 'utf8');
    const mirrorFile = readFileSync(
      join(ROOT, 'functions', 'core', 'absorb-bo-on-confirm.js'),
      'utf8'
    );
    expect(pureFile).toMatch(/export function computeBoAbsorption/);
    expect(mirrorFile).toMatch(/export function computeBoAbsorption/);
  });

  it('ambos files tienen applyAbsorptionsToLines + buildBackfillUpdate', () => {
    const pureFile = readFileSync(join(ROOT, 'src', 'pure', 'absorb-bo-on-confirm.js'), 'utf8');
    const mirrorFile = readFileSync(
      join(ROOT, 'functions', 'core', 'absorb-bo-on-confirm.js'),
      'utf8'
    );
    expect(pureFile).toMatch(/export function applyAbsorptionsToLines/);
    expect(pureFile).toMatch(/export function buildBackfillUpdate/);
    expect(mirrorFile).toMatch(/export function applyAbsorptionsToLines/);
    expect(mirrorFile).toMatch(/export function buildBackfillUpdate/);
  });
});
