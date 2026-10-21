// @ts-check
/**
 * E7 anti-divergencia TTL (fix D2 2026-10-20).
 *
 * Lee RESERVA_TTL_DAYS desde src/pure/stock-realmente-disponible.js y
 * functions/core/pedido-snapshot-core.js y verifica que coincidan.
 *
 * Si alguien vuelve a cambiar uno sin tocar el otro, este test falla.
 * Precedente: v1198 (2026-10-08) bajó src/pure 15→7 pero functions/core
 * quedó en 15 → drift sistémico "modal cliente libera a los 7d, CF
 * server lo mantiene reservado hasta los 15d".
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../../..');

/** Extrae `const RESERVA_TTL_DAYS = N;` de un archivo .js. */
function readReservaTtl(relPath) {
  const content = readFileSync(resolve(REPO_ROOT, relPath), 'utf8');
  const match = content.match(/const\s+RESERVA_TTL_DAYS\s*=\s*(\d+)\s*;/);
  if (!match) throw new Error(`No se encontró RESERVA_TTL_DAYS en ${relPath}`);
  return Number(match[1]);
}

describe('TTL anti-divergencia (D2 fix 2026-10-20)', () => {
  it('RESERVA_TTL_DAYS en src/pure y functions/core coinciden', () => {
    const purePure = readReservaTtl('src/pure/stock-realmente-disponible.js');
    const funcCore = readReservaTtl('functions/core/pedido-snapshot-core.js');
    expect(funcCore).toBe(purePure);
  });

  it('ambos valen 7 (decisión Mariano 2026-10-20 Opción A fix D2)', () => {
    expect(readReservaTtl('src/pure/stock-realmente-disponible.js')).toBe(7);
    expect(readReservaTtl('functions/core/pedido-snapshot-core.js')).toBe(7);
  });
});
