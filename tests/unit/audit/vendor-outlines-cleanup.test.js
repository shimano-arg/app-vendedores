// @ts-check
/**
 * E3 §auditgrises G5.15 — vendor_outlines cleanup extensión v13-v16.
 *
 * v1499 §101 (2026-10-27) UPDATE: `forceUpdateApp` ya no borra claves por
 * nombre. Ahora limpia TODO localStorage excepto las claves preservadas
 * (`CLEAN_RELOAD_PRESERVE_KEYS` = borradores + preferencia theme). Esto
 * cubre `shimano_vendor_outlines_v4..v16` + cualquier otra legacy sin
 * necesidad de enumerarlas.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// S-9 c2 (2026-11-26): forceUpdateApp extraido a src/domains/force-update-app.js.
// El handler vive en el bundle; el inline ya no tiene el pipeline.
const INDEX_HTML = readFileSync('index.html', 'utf8');
const BUNDLE_SRC = readFileSync('src/domains/force-update-app.js', 'utf8');

describe('G5.15 — vendor_outlines cleanup cobertura completa (v1499 §101)', () => {
  it('forceUpdateApp borra TODO localStorage excepto preserved keys (bundle)', () => {
    expect(BUNDLE_SRC).toMatch(/CLEAN_RELOAD_PRESERVE_KEYS/);
    expect(BUNDLE_SRC).toMatch(/const preserve = new Set\(CLEAN_RELOAD_PRESERVE_KEYS\)/);
    expect(BUNDLE_SRC).toMatch(/for \(const k of toRemove\) localStorage\.removeItem\(k\)/);
  });

  it('preserva borradores pedidos no enviados (bundle)', () => {
    expect(BUNDLE_SRC).toContain("'shimano_zonas_pending_v1'");
  });

  // v1580 (2026-11-25): preferencia theme eliminada junto con dark mode.
  it('NO preserva shimano_theme (dark mode removido en v1580)', () => {
    expect(BUNDLE_SRC).not.toContain("'shimano_theme'");
  });

  it('NO lista claves vendor_outlines por nombre (ya no necesario post-v1499)', () => {
    // Las claves `shimano_vendor_outlines_vX` NO deben enumerarse en el
    // handler; la limpieza wholesale las cubre.
    expect(BUNDLE_SRC).not.toMatch(/shimano_vendor_outlines_v\d+/);
  });

  it('S-9 c2: index.html NO declara el handler inline', () => {
    expect(INDEX_HTML).not.toMatch(/async\s+function\s+forceUpdateApp/);
  });
});
