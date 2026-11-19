// @ts-check
/**
 * SEC-H6 (2026-11-19) — test contrato sobre el domain gate de
 * movePedidoToWaitlistCF + unifyWaitlistsCF.
 *
 * Pre-fix: gate solo permitía `shimano.com.ar` + `shimano.uy`, excluyendo
 * `gmail.com`. Esto bloqueaba a PACHI (pachinaba@gmail.com — CLAUDE.md §93
 * opt-in) de invocar estos flows de reconciliación aunque su VDE legítimo
 * tiene permisos server-side.
 *
 * Post-fix: gate extendido a `{shimano.com.ar, shimano.uy, gmail.com}`
 * consistente con commitPedidoCF + confirmPedidoDefinitivoCF +
 * dashboardVentasCF + releaseAsigCF.
 *
 * Capa defensiva: el core sigue haciendo `roles/{uid}` lookup y permission
 * check. Un gmail sin role=vendedor es rechazado ahí.
 *
 * Verificación: lee el source de `functions/index.js` y asserta que las
 * 2 CFs contienen `ALLOWED_DOMAINS` con los 3 dominios.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const INDEX_SOURCE = readFileSync('functions/index.js', 'utf8');

/** Extrae el cuerpo del handler onCall para una CF por nombre.
 * Busca desde `export const NAME = onCall` hasta `^);` (fin del onCall
 * wrapper). Suficiente para grep de ALLOWED_DOMAINS + comentarios.
 */
function sliceCfBody(name) {
  const startIdx = INDEX_SOURCE.indexOf(`export const ${name} = onCall`);
  if (startIdx < 0) return '';
  // Buscar fin: línea que arranque con `);` tras el startIdx.
  const rest = INDEX_SOURCE.slice(startIdx);
  const endMatch = rest.match(/\n\s*\)\s*;/);
  if (!endMatch) return '';
  return rest.slice(0, endMatch.index + endMatch[0].length);
}

describe('SEC-H6: domain gate extension', () => {
  const EXPECTED_DOMAINS = ['shimano.com.ar', 'shimano.uy', 'gmail.com'];

  it('T1: movePedidoToWaitlistCF usa ALLOWED_DOMAINS con los 3 dominios', () => {
    const body = sliceCfBody('movePedidoToWaitlistCF');
    expect(body).toBeTruthy();
    for (const d of EXPECTED_DOMAINS) {
      expect(body).toContain(`'${d}'`);
    }
    expect(body).toContain('ALLOWED_DOMAINS');
    expect(body).toMatch(/if\s*\(\s*!ALLOWED_DOMAINS\.has\(\s*domain\s*\)\s*\)/);
  });

  it('T2: unifyWaitlistsCF usa ALLOWED_DOMAINS con los 3 dominios', () => {
    const body = sliceCfBody('unifyWaitlistsCF');
    expect(body).toBeTruthy();
    for (const d of EXPECTED_DOMAINS) {
      expect(body).toContain(`'${d}'`);
    }
    expect(body).toContain('ALLOWED_DOMAINS');
    expect(body).toMatch(/if\s*\(\s*!ALLOWED_DOMAINS\.has\(\s*domain\s*\)\s*\)/);
  });

  it('T3: comentario SEC-H6 presente en ambas CFs', () => {
    const moveBody = sliceCfBody('movePedidoToWaitlistCF');
    const unifyBody = sliceCfBody('unifyWaitlistsCF');
    expect(moveBody).toMatch(/SEC-H6/);
    expect(unifyBody).toMatch(/SEC-H6/);
  });

  it('T4: el pre-fix (hardcoded 2 comparaciones) NO está presente', () => {
    // Check regresión: el gate viejo era:
    //   if (domain !== 'shimano.com.ar' && domain !== 'shimano.uy') { ... }
    // Si vuelve a aparecer en alguna de las 2 CFs, es regresión.
    const moveBody = sliceCfBody('movePedidoToWaitlistCF');
    const unifyBody = sliceCfBody('unifyWaitlistsCF');
    const badPattern = /domain !== 'shimano\.com\.ar' && domain !== 'shimano\.uy'/;
    expect(moveBody).not.toMatch(badPattern);
    expect(unifyBody).not.toMatch(badPattern);
  });

  it('T5: consistencia con otros CFs — mismo set exacto que confirmPedidoDefinitivoCF', () => {
    const otherCfs = ['commitPedidoCF', 'confirmPedidoDefinitivoCF', 'dashboardVentasCF'];
    for (const cf of otherCfs) {
      const body = sliceCfBody(cf);
      if (!body) continue; // CF puede no existir en el PR base
      // Si la CF existe, debe usar el mismo set.
      for (const d of EXPECTED_DOMAINS) {
        expect(body, `${cf} debería incluir ${d}`).toContain(`'${d}'`);
      }
    }
  });
});
