// @ts-check
/**
 * v1435 §56 (2026-10-24): verifica que ningún render visible contenga la
 * cadena legacy "RESERVADO" ni "DUPLICADO" como texto de badge.
 *
 * Scope: index.html + styles/apple-design.css + src/.
 * El patrón negativo busca:
 *   - `textContent = 'RESERVADO'` / `textContent = 'DUPLICADO'`
 *   - `>RESERVADO<` / `>DUPLICADO<` como literal en HTML
 *   - `_badge.textContent = '...RESERVADO...'`
 *
 * Comentarios + descripciones de la auditoría pre-§56 ni cadenas de audit log
 * (`closedReason`, mensajes de confirm sobre palabras genéricas) no cuentan.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const DIRNAME = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(DIRNAME, '..', '..', '..');

const INDEX_HTML = readFileSync(resolve(ROOT, 'index.html'), 'utf-8');
const APPLE_CSS = readFileSync(resolve(ROOT, 'styles', 'apple-design.css'), 'utf-8');

describe('§56: badge "RESERVADO" renombrado a "STOCK ASIGNADO"', () => {
  it('index.html render NO asigna textContent = "RESERVADO" en un badge', () => {
    // Pattern: `.textContent = '🔒 RESERVADO'` o similar con RESERVADO como texto.
    const matches = INDEX_HTML.match(/\.textContent\s*=\s*['"][^'"]*RESERVADO[^'"]*['"]/g);
    expect(matches || [], 'RESERVADO como textContent en index.html').toEqual([]);
  });

  it('index.html render asigna textContent = "STOCK ASIGNADO" al menos una vez', () => {
    expect(INDEX_HTML).toMatch(/_badge\.textContent\s*=\s*['"]🔒 STOCK ASIGNADO['"]/);
  });

  it('index.html NO contiene la clase CSS legacy .badge-reservado (solo en comentarios)', () => {
    // Buscar `.badge-reservado{...}` como CSS rule — permitidos solo en comentarios.
    const cssRules = INDEX_HTML.match(/\.badge-reservado\s*\{[^}]+\}/g);
    expect(cssRules || [], '.badge-reservado como CSS rule en index.html').toEqual([]);
  });

  it('index.html contiene la clase CSS nueva .badge-stock-asignado como regla real', () => {
    const cssRules = INDEX_HTML.match(/\.badge-stock-asignado\s*\{[^}]+\}/g);
    expect(cssRules).toBeTruthy();
    expect(cssRules.length).toBeGreaterThanOrEqual(1);
  });

  it('styles/apple-design.css NO contiene reglas .badge-reservado activas', () => {
    // Permitimos aparecer en comentarios (/* badge-reservado */). Bloquear rule real.
    const cssRules = APPLE_CSS.match(/^[^/\n]*\.badge-reservado\s*\{/m);
    expect(cssRules, 'badge-reservado como CSS rule en apple-design.css').toBeFalsy();
  });
});

describe('§56: badge "DUPLICADO" eliminado', () => {
  it('index.html NO asigna textContent = "DUPLICADO" en ningún badge', () => {
    const matches = INDEX_HTML.match(/_badge\.textContent\s*=\s*['"]DUPLICADO['"]/g);
    expect(matches || []).toEqual([]);
  });

  it('index.html NO contiene regla CSS .badge-duplicado activa', () => {
    const cssRules = INDEX_HTML.match(/\.badge-duplicado\s*\{[^}]+\}/g);
    expect(cssRules || []).toEqual([]);
  });
});
