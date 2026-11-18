// @ts-nocheck
/**
 * v1562 reparto-dep12 §E4.1 — Toggle feature flag en Panel de Control.
 *
 * Verifica:
 *  - Visible solo para Mariano (gate _isMarianoEmail).
 *  - Click dispara set(feature_flags, {dep12_reparto_enabled, audit}, merge:true).
 *  - Confirm pre-write en lenguaje §68 (sin jerga).
 *  - CSS pill §106 presente.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, '..', '..', '..');
const PC = readFileSync(join(REPO, 'src/domains/panel-control.js'), 'utf-8');
const CSS = readFileSync(join(REPO, 'styles/apple-design.css'), 'utf-8');

describe('v1562 §E4.1 — toggle Panel Control', () => {
  it('T1: gate Mariano-only antes de renderear la sección', () => {
    // La sección se renderiza SOLO si _isMarianoEmail() es true.
    expect(PC).toMatch(
      /if\s*\(_isMarianoEmail\(\)\)\s*\{\s*html\s*\+=\s*_renderFeaturesExperimentalesSection\(\)/
    );
    // El hydrate también está gateado.
    expect(PC).toMatch(/if\s*\(_isMarianoEmail\(\)\)\s*\{\s*_hydrateDep12FlagToggle\(\)/);
  });

  it('T2: click llama set(feature_flags, {campos+audit}, merge:true)', () => {
    expect(PC).toMatch(
      /fbDb\.doc\('app_config\/feature_flags'\)\.set\(\s*\{[\s\S]*?dep12_reparto_enabled:\s*next[\s\S]*?dep12FlagChangedAt[\s\S]*?dep12FlagChangedBy[\s\S]*?\},\s*\{\s*merge:\s*true\s*\}\s*\)/
    );
  });

  it('T3: confirm pre-write en lenguaje §68 (sin jerga)', () => {
    // El mensaje habla al vendedor, sin "snapshot"/"transacción"/"flag"/"SKU".
    const confirmBlock = PC.match(/const msg\s*=\s*next[\s\S]*?: '[^']*';/);
    expect(confirmBlock).toBeTruthy();
    const txt = confirmBlock[0].toLowerCase();
    const prohibidas = ['snapshot', 'transacci', 'callable', 'payload', 'backend'];
    for (const p of prohibidas) {
      expect(txt).not.toContain(p);
    }
    // Habla de "tránsito"/"back order"/"producción" — ok, son dominio real.
    expect(txt).toMatch(/tránsito|transito/);
  });

  it('T4: CSS pill §106 para #dep12-flag-toggle', () => {
    expect(CSS).toMatch(
      /#dep12-flag-toggle\.btn-zonas\s*\{[\s\S]*?border-radius:\s*999px\s*!important/
    );
    expect(CSS).toMatch(
      /#dep12-flag-toggle\.btn-zonas\s*\{[\s\S]*?text-transform:\s*none\s*!important/
    );
    expect(CSS).toMatch(
      /#dep12-flag-toggle\.btn-zonas:active\s*\{[\s\S]*?transform:\s*scale\(0\.97\)\s*!important/
    );
    expect(CSS).toMatch(
      /#dep12-flag-toggle\.btn-zonas\[data-enabled="false"\]\s*\{[\s\S]*?background:\s*#6b7280\s*!important/
    );
  });

  it('T5: cachea el estado en window._dep12FlagCached para que queryStockLive lo use', () => {
    expect(PC).toContain('window._dep12FlagCached');
    // Se actualiza tanto en hydrate como en toggle exitoso.
    const occurrences = (PC.match(/window\._dep12FlagCached/g) || []).length;
    expect(occurrences).toBeGreaterThanOrEqual(2);
  });
});
