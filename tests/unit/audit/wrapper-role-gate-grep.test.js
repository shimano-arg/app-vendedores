// @ts-check
/**
 * §SEC-AUTH-001 + §SEC-CF-003 (PR #1 v1507) — grep tests que verifican que
 * los wrappers de commitPedidoCF + updatePedidoLinesCF:
 * (a) invocan assertCallerRole del helper puro;
 * (b) removieron ALLOWED_DOMAINS + el comentario "igual que applyRepartoManualCF";
 * (c) importan desde ./core/caller-role.js.
 *
 * Grep tests en vez de unit tests del handler HTTP para evitar mockear
 * HttpsError + req. El helper puro se testea en caller-role.test.js.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const functionsIndexPath = join(__dirname, '../../../functions/index.js');
const functionsIndex = readFileSync(functionsIndexPath, 'utf-8');

describe('wrappers CF — role gate via assertCallerRole', () => {
  it('T1: functions/index.js importa assertCallerRole desde ./core/caller-role.js', () => {
    const importNeedle = `from './core/caller-role.js';`;
    expect(functionsIndex.includes(importNeedle)).toBe(true);
    expect(functionsIndex.includes('assertCallerRole')).toBe(true);
  });

  it('T2: assertCallerRole invocada 2 veces (commitPedidoCF + updatePedidoLinesCF)', () => {
    const matches = functionsIndex.split('assertCallerRole(').length - 1;
    expect(matches).toBeGreaterThanOrEqual(2);
  });

  it('T3: ALLOWED_DOMAINS removido del uso efectivo (declaración + check)', () => {
    // Match sólo la declaración (`const ALLOWED_DOMAINS = new Set(`) + el check
    // (`ALLOWED_DOMAINS.has(domain)`). NO match comentarios como "Reemplaza
    // ALLOWED_DOMAINS" que mencionan el nombre pero no lo usan.
    expect(functionsIndex.includes('const ALLOWED_DOMAINS = new Set(')).toBe(false);
    expect(functionsIndex.includes('ALLOWED_DOMAINS.has(')).toBe(false);
  });

  it('T4: comentario "igual que applyRepartoManualCF" removido', () => {
    expect(functionsIndex.includes('igual que applyRepartoManualCF')).toBe(false);
  });

  it('T5: rechazo en updatePedidoLinesCF loguea con type update_pedido_lines_rejected', () => {
    // Match ajuste punto 5 Mariano 2026-10-28: el log del wrapper
    // updatePedidoLinesCF usa su propio type, no commit_pedido_rejected.
    expect(functionsIndex.includes(`type: 'update_pedido_lines_rejected'`)).toBe(true);
  });

  it('T6 (§Q6 v1521): fallo del operations_log en ROLE_REQUIRED NO se traga en silencio (commitPedidoCF)', () => {
    // Ajuste Mariano Q6 (2026-10-29): el catch del write a operations_log debe
    // dejar console.error con el detalle. Antes era `/* non-fatal */` silente.
    expect(functionsIndex).toMatch(
      /console\.error\(\s*'commitPedidoCF operations_log write failed on ROLE_REQUIRED'/
    );
  });

  it('T7 (§Q6 v1521): fallo del operations_log en ROLE_REQUIRED NO se traga en silencio (updatePedidoLinesCF)', () => {
    expect(functionsIndex).toMatch(
      /console\.error\(\s*'updatePedidoLinesCF operations_log write failed on ROLE_REQUIRED'/
    );
  });

  it('T8 (§Q6 v1521): el comentario legacy "/* non-fatal */" ya NO está en los catch del role gate', () => {
    // Scope: solo los dos bloques del role gate (ROLE_REQUIRED). Otros catch
    // non-fatal del archivo (p.ej. side-effects posteriores al commit) siguen OK.
    const roleGateRegion = functionsIndex.split('ROLE_REQUIRED').slice(1).join('ROLE_REQUIRED');
    // Buscamos el patrón específico "} catch (_logErr) {\n...non-fatal..." dentro
    // de los primeros ~500 chars posteriores a cada ROLE_REQUIRED.
    const snippet = roleGateRegion.slice(0, 2000);
    expect(snippet).not.toMatch(/\/\*\s*non-fatal\s*\*\//);
  });
});
