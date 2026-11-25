// @ts-check
/**
 * Stack S-7 P1-C (v1588 2026-11-25) — tests de contrato del hook pre-confirm
 * de minVersion.
 *
 * Objetivo: garantizar que la pieza cliente-side siga cableada aunque alguien
 * refactorice el `_tryCommitPedidoCF` o el else-chain del `doConfirmPedido`:
 *
 *   T1. `src/pure/min-version-check.js` existe + expone shouldForceReload.
 *   T2. `src/main.js` lo importa + expone en __phase0.pure.minVersionCheck.
 *   T3. `index.html` define `_fetchMinVersionOnce` + lee doc `app_config/version_minima`.
 *   T4. `_preConfirmForceReloadIfStale` llama a shouldForceReload.
 *   T5. `_tryCommitPedidoCF` invoca al hook ANTES de armar el payload.
 *   T6. El modal usa `location.reload()` (NO `location.replace`) + preserva draft.
 *   T7. El handler del VERSION_OLD_CLIENT cierra el modal Confirmar sin alert.
 *   T8. NUNCA borra `localStorage['shimano_zonas_pending_v1']` antes del reload.
 *   T9. Script audit `P1C_version_mix.cjs` existe y es read-only (no firestore writes).
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const INDEX = readFileSync(resolve(ROOT, 'index.html'), 'utf8');
const MAIN_JS = readFileSync(resolve(ROOT, 'src/main.js'), 'utf8');
const PURE_FILE = resolve(ROOT, 'src/pure/min-version-check.js');

describe('T1. Pure fn existe + expone shouldForceReload', () => {
  it('src/pure/min-version-check.js existe', () => {
    expect(existsSync(PURE_FILE)).toBe(true);
  });
  it('exporta shouldForceReload + parseAppVersion + compareAppVersion', () => {
    const content = readFileSync(PURE_FILE, 'utf8');
    expect(content).toMatch(/export function shouldForceReload/);
    expect(content).toMatch(/export function parseAppVersion/);
    expect(content).toMatch(/export function compareAppVersion/);
  });
});

describe('T2. src/main.js importa pure + expone via __phase0.pure.minVersionCheck', () => {
  it('importa desde ./pure/min-version-check.js', () => {
    expect(MAIN_JS).toMatch(/from ['"]\.\/pure\/min-version-check\.js['"]/);
  });
  it('expone __phase0.pure.minVersionCheck con shouldForceReload', () => {
    expect(MAIN_JS).toMatch(/minVersionCheck\s*:\s*\{/);
    // Dentro del bloque, ambos símbolos.
    const slice = MAIN_JS.slice(MAIN_JS.indexOf('minVersionCheck'));
    expect(slice).toMatch(/shouldForceReload/);
    expect(slice).toMatch(/parseAppVersion/);
  });
});

describe('T3. _fetchMinVersionOnce lee app_config/version_minima', () => {
  it('función declarada en index.html', () => {
    expect(INDEX).toMatch(/async function _fetchMinVersionOnce\s*\(/);
  });
  it('lee el doc correcto', () => {
    expect(INDEX).toMatch(/collection\(['"]app_config['"]\)\.doc\(['"]version_minima['"]\)/);
  });
  it('cachea en window._shimanoMinVersionCached (1× por sesión)', () => {
    expect(INDEX).toMatch(/window\._shimanoMinVersionCached/);
  });
});

describe('T4. _preConfirmForceReloadIfStale usa el pure fn', () => {
  it('función declarada', () => {
    expect(INDEX).toMatch(/async function _preConfirmForceReloadIfStale\s*\(/);
  });
  it('invoca shouldForceReload del pure (o tiene fallback inline)', () => {
    // Desde el pure cuando el bundle está cargado:
    expect(INDEX).toMatch(/shouldForceReload/);
    // Fallback inline documentado (SW stale):
    const slice = INDEX.slice(INDEX.indexOf('_preConfirmForceReloadIfStale'));
    expect(slice).toMatch(/Fallback inline/);
  });
  it('llama a _renderPreConfirmReloadModal cuando debe bloquear', () => {
    expect(INDEX).toMatch(/_renderPreConfirmReloadModal/);
  });
});

describe('T5. _tryCommitPedidoCF invoca el hook ANTES del payload', () => {
  it('hook invocado al inicio de _tryCommitPedidoCF', () => {
    // Capturar el bloque de la función para verificar orden.
    const tryBlockStart = INDEX.indexOf('window._tryCommitPedidoCF = async function');
    expect(tryBlockStart).toBeGreaterThan(0);
    const next500 = INDEX.slice(tryBlockStart, tryBlockStart + 2000);
    // Dentro de los primeros ~2kb (prolegómeno), se llama al hook.
    expect(next500).toMatch(/_preConfirmForceReloadIfStale/);
  });
  it('retorna VERSION_OLD_CLIENT con blockedByClient=true', () => {
    const tryBlockStart = INDEX.indexOf('window._tryCommitPedidoCF = async function');
    const block = INDEX.slice(tryBlockStart, tryBlockStart + 3000);
    expect(block).toMatch(/VERSION_OLD_CLIENT/);
    expect(block).toMatch(/blockedByClient/);
  });
});

describe('T6. Modal usa location.reload (no replace) + preserva draft', () => {
  it('_renderPreConfirmReloadModal usa location.reload', () => {
    const start = INDEX.indexOf('function _renderPreConfirmReloadModal');
    expect(start).toBeGreaterThan(0);
    const block = INDEX.slice(start, start + 3500);
    expect(block).toMatch(/location\.reload\(\)/);
    // Explícitamente NO usa location.replace (que sí usa forceUpdateApp pero
    // acá queremos preservar history para que el back del VDE siga funcionando).
    expect(block).not.toMatch(/location\.replace\(/);
  });
});

describe('T7. Handler del VERSION_OLD_CLIENT cierra Confirmar sin alert', () => {
  it('la else-chain del error maneja VERSION_OLD_CLIENT antes del VERSION_OLD genérico', () => {
    const idx = INDEX.indexOf("code === 'VERSION_OLD_CLIENT'");
    expect(idx).toBeGreaterThan(0);
    const genericIdx = INDEX.indexOf("code === 'VERSION_OLD'");
    expect(genericIdx).toBeGreaterThan(0);
    // VERSION_OLD_CLIENT se evalúa ANTES que VERSION_OLD (short-circuit con return).
    expect(idx).toBeLessThan(genericIdx);
  });
  it('cierra el confirm dialog sin mostrar alert duplicado', () => {
    const idx = INDEX.indexOf("code === 'VERSION_OLD_CLIENT'");
    const block = INDEX.slice(idx, idx + 400);
    expect(block).toMatch(/closeConfirmDialog/);
    expect(block).toMatch(/return;/);
  });
});

describe('T8. Draft NUNCA se borra antes del reload', () => {
  it('no hay localStorage.removeItem(shimano_zonas_pending) cerca del hook', () => {
    // El hook ni el modal deben tocar shimano_zonas_pending_v1. El draft
    // sobrevive un location.reload() natural (§101 ya lo garantiza).
    const hookStart = INDEX.indexOf('function _renderPreConfirmReloadModal');
    const block = INDEX.slice(hookStart, hookStart + 3500);
    expect(block).not.toMatch(/removeItem\(['"]shimano_zonas_pending/);
    expect(block).not.toMatch(/localStorage\.clear/);
  });
  it('el hook tampoco limpia localStorage', () => {
    const hookStart = INDEX.indexOf('async function _preConfirmForceReloadIfStale');
    const block = INDEX.slice(hookStart, hookStart + 2000);
    expect(block).not.toMatch(/removeItem\(['"]shimano_zonas_pending/);
    expect(block).not.toMatch(/localStorage\.clear/);
  });
});

describe('T9. Script audit P1C_version_mix.cjs existe y es read-only', () => {
  const SCRIPT = resolve(ROOT, 'scripts/audit/P1C_version_mix.cjs');
  it('existe', () => {
    expect(existsSync(SCRIPT)).toBe(true);
  });
  it('no contiene writes a Firestore (solo .get/.where/.orderBy/.limit)', () => {
    const content = readFileSync(SCRIPT, 'utf8');
    // Patterns de write Firestore: estos NO deben aparecer.
    // (Un `map.set(k,v)` del helper local NO es Firestore — no cuenta.)
    expect(content).not.toMatch(/\bdb\.[\s\S]{0,200}\.set\(/);
    expect(content).not.toMatch(/\bdb\.[\s\S]{0,200}\.add\(/);
    expect(content).not.toMatch(/\bdb\.[\s\S]{0,200}\.update\(/);
    expect(content).not.toMatch(/\bdb\.[\s\S]{0,200}\.delete\(/);
    expect(content).not.toMatch(/runTransaction/);
    expect(content).not.toMatch(/bulkWriter/);
    expect(content).not.toMatch(/writeBatch/);
    expect(content).not.toMatch(/batch\.commit/);
  });
  it('lee operations_log + pedidos (fuentes esperadas)', () => {
    const content = readFileSync(SCRIPT, 'utf8');
    expect(content).toMatch(/operations_log/);
    expect(content).toMatch(/pedidos/);
    expect(content).toMatch(/app_config.*version_minima|version_minima.*app_config/s);
  });
});
