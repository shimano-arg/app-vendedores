// @ts-check

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * R01 Fase 1 — Sync test §57 para el espejo server-side de `unificar-ordenes`.
 *
 * `functions/core/unificar-ordenes.js` debe ser byte-a-byte idéntico a
 * `src/pure/unificar-ordenes.js`. Patrón CLAUDE.md §57: lógica
 * cliente+servidor vive una sola vez en `src/pure/<name>.js` con copia
 * espejo en `functions/core/<name>.js`.
 *
 * Si este test falla, significa que alguien editó uno de los dos sin
 * replicar el cambio en el otro — el merge en server-side (usado por
 * movePedidoToWaitlistCF + unifyWaitlistsCF) y el merge cliente-side
 * tendrán comportamiento divergente.
 *
 * Fix: copiar el archivo editado sobre el otro con `cp`.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..', '..');
const PURE_PATH = resolve(ROOT, 'src', 'pure', 'unificar-ordenes.js');
const MIRROR_PATH = resolve(ROOT, 'functions', 'core', 'unificar-ordenes.js');

describe('unificar-ordenes §57 espejo sync', () => {
  it('src/pure/unificar-ordenes.js === functions/core/unificar-ordenes.js (byte-a-byte)', () => {
    const pureBuf = readFileSync(PURE_PATH);
    const mirrorBuf = readFileSync(MIRROR_PATH);
    expect(mirrorBuf.equals(pureBuf)).toBe(true);
  });

  it('SHA-256 de ambos coincide', () => {
    const pureHash = createHash('sha256').update(readFileSync(PURE_PATH)).digest('hex');
    const mirrorHash = createHash('sha256').update(readFileSync(MIRROR_PATH)).digest('hex');
    expect(mirrorHash).toBe(pureHash);
  });

  it('ambos archivos exportan al menos mergeLinesFromOrders + dedupeLinesByCode + buildAsigRefsForLine', () => {
    const pure = readFileSync(PURE_PATH, 'utf8');
    for (const fn of [
      'mergeLinesFromOrders',
      'dedupeLinesByCode',
      'buildAsigRefsForLine',
      'unionAsigRefsDedup',
      'getRowColorClass',
      'buildUnifiedFromAudit',
    ]) {
      expect(pure).toContain(`export function ${fn}`);
    }
    const mirror = readFileSync(MIRROR_PATH, 'utf8');
    for (const fn of [
      'mergeLinesFromOrders',
      'dedupeLinesByCode',
      'buildAsigRefsForLine',
      'unionAsigRefsDedup',
      'getRowColorClass',
      'buildUnifiedFromAudit',
    ]) {
      expect(mirror).toContain(`export function ${fn}`);
    }
  });
});
