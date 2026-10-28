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

const INDEX_HTML = readFileSync('index.html', 'utf8');

describe('G5.15 — vendor_outlines cleanup cobertura completa (v1499 §101)', () => {
  it('forceUpdateApp borra TODO localStorage excepto preserved keys', () => {
    expect(INDEX_HTML).toMatch(/CLEAN_RELOAD_PRESERVE_KEYS/);
    expect(INDEX_HTML).toMatch(/const preserve = new Set\(CLEAN_RELOAD_PRESERVE_KEYS\)/);
    expect(INDEX_HTML).toMatch(/for \(const k of toRemove\) localStorage\.removeItem\(k\)/);
  });

  it('preserva borradores pedidos no enviados', () => {
    expect(INDEX_HTML).toContain("'shimano_zonas_pending_v1'");
  });

  it('preserva preferencia theme', () => {
    expect(INDEX_HTML).toContain("'shimano_theme'");
  });

  it('NO lista claves vendor_outlines por nombre (ya no necesario post-v1499)', () => {
    // Las claves `shimano_vendor_outlines_vX` NO deben enumerarse en el
    // handler; la limpieza wholesale las cubre.
    const idx = INDEX_HTML.indexOf('async function forceUpdateApp()');
    const slice = INDEX_HTML.slice(idx, idx + 6000);
    expect(slice).not.toMatch(/shimano_vendor_outlines_v\d+/);
  });
});
