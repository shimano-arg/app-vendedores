// @ts-check
/**
 * v1422 §56 (2026-10-22) — bug fix _outlinesSignature leía v.vendor pero
 * el schema real de vendor_overrides es v.newVendor → firma degenerada
 * siempre vacía → cache localStorage NUNCA se invalidaba contra el estado
 * actual del Firestore. Pablo + Santiago veían zonas grises que Mariano
 * (admin que agregó los overrides) sí veía.
 *
 * Fix: index.html:_outlinesSignature usa v.newVendor + bump cache key
 * v16→v17 para forzar invalidación cross-browser al deploy.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const INDEX_HTML = readFileSync('index.html', 'utf8');

describe('v1422 §56 — fix _outlinesSignature usa newVendor', () => {
  it('_outlinesSignature lee v.newVendor (no v.vendor)', () => {
    const start = INDEX_HTML.indexOf('function _outlinesSignature()');
    const slice = INDEX_HTML.slice(start, start + 600);
    expect(slice).toMatch(/v\.newVendor/);
    // El código viejo v.vendor NO debe quedar en la función (sin comentario).
    expect(slice).not.toMatch(/\|\|\s*''\s*\)\s*\)\s*;?\s*$[\s\S]*?v\.vendor\s*\|\|/m);
  });

  it('cache key bumpeada v16→v17 para forzar invalidación', () => {
    expect(INDEX_HTML).toMatch(
      /VENDOR_OUTLINES_CACHE_KEY\s*=\s*['"]shimano_vendor_outlines_v17['"]/
    );
    expect(INDEX_HTML).not.toMatch(
      /VENDOR_OUTLINES_CACHE_KEY\s*=\s*['"]shimano_vendor_outlines_v16['"]/
    );
  });

  it('comentario cita precedente Pablo/Santiago 2026-10-22', () => {
    const idx = INDEX_HTML.indexOf('v1422 §56 (2026-10-22)');
    expect(idx).toBeGreaterThan(0);
    const slice = INDEX_HTML.slice(idx, idx + 800);
    expect(slice).toMatch(/Pablo|Santiago/);
    expect(slice).toMatch(/zonas grises/i);
  });
});

describe('v1422 §56 — lógica del helper (simulación)', () => {
  // Replica el helper fijo + verifica que firmas cambien con newVendor distinto.
  function computeSig(vendorOverrides) {
    const parts = [];
    Object.entries(vendorOverrides)
      .sort()
      .forEach(([k, v]) => parts.push('O:' + k + ':' + ((v && v.newVendor) || '')));
    return parts.join('|') || '(empty)';
  }

  it('vendorOverrides vacío → firma "(empty)"', () => {
    expect(computeSig({})).toBe('(empty)');
  });

  it('un override con newVendor → firma incluye el vendor', () => {
    const o = {
      'LOC|BA|Arrecifes': { newVendor: 'MAURICIO GIL' },
    };
    expect(computeSig(o)).toBe('O:LOC|BA|Arrecifes:MAURICIO GIL');
  });

  it('BUG PRE-FIX: si se usaba v.vendor en vez de v.newVendor, firma era degenerada', () => {
    const o = {
      'LOC|BA|Arrecifes': { newVendor: 'MAURICIO GIL' },
      'LOC|BA|Baradero': { newVendor: 'FEDERICO CASTELANELLI' },
    };
    // Firma BUGGY (como estaba antes del fix):
    const parts = [];
    Object.entries(o)
      .sort()
      .forEach(([k, v]) => parts.push('O:' + k + ':' + ((v && v.vendor) || '')));
    const buggy = parts.join('|');
    expect(buggy).toBe('O:LOC|BA|Arrecifes:|O:LOC|BA|Baradero:'); // strings vacíos → degenerada
    // Firma CORRECTA (v1422 fix):
    expect(computeSig(o)).toBe(
      'O:LOC|BA|Arrecifes:MAURICIO GIL|O:LOC|BA|Baradero:FEDERICO CASTELANELLI'
    );
    // Las dos firmas BUGGY serían idénticas para distintos overrides → nunca invalida.
    const oDifferent = {
      'LOC|BA|Arrecifes': { newVendor: 'GONZALO DE LA ROSA' }, // vendor distinto!
      'LOC|BA|Baradero': { newVendor: 'PACHI' },
    };
    const parts2 = [];
    Object.entries(oDifferent)
      .sort()
      .forEach(([k, v]) => parts2.push('O:' + k + ':' + ((v && v.vendor) || '')));
    const buggy2 = parts2.join('|');
    expect(buggy2).toBe(buggy); // IDÉNTICAS pese a vendors distintos → bug
    // Post-fix: firmas distintas.
    expect(computeSig(oDifferent)).not.toBe(computeSig(o));
  });

  it('cambio de newVendor → firma cambia (post-fix detecta drift)', () => {
    const before = { 'LOC|X': { newVendor: 'A' } };
    const after = { 'LOC|X': { newVendor: 'B' } };
    expect(computeSig(before)).not.toBe(computeSig(after));
  });

  it('override con newVendor undefined → cadena vacía (no rompe)', () => {
    const o = { 'LOC|X': { newVendor: null } };
    expect(computeSig(o)).toBe('O:LOC|X:');
  });

  it('override agregado → firma cambia (detecta diff)', () => {
    const before = { 'LOC|X': { newVendor: 'A' } };
    const after = { ...before, 'LOC|Y': { newVendor: 'B' } };
    expect(computeSig(before)).not.toBe(computeSig(after));
  });
});

describe('v1422 §56 — caso real datos prod Mariano 2026-10-22', () => {
  // Shape fetch 2026-10-22: 372 overrides, todos con newVendor + scope + province.
  const samples = {
    'LOC|BUENOS AIRES|Arrecifes': {
      scope: 'loc',
      province: 'BUENOS AIRES',
      localityName: 'Arrecifes',
      newVendor: 'MAURICIO GIL',
      newType: 'VDE',
    },
    'LOC|BUENOS AIRES|Baradero': {
      scope: 'loc',
      province: 'BUENOS AIRES',
      localityName: 'Baradero',
      newVendor: 'MAURICIO GIL',
      newType: 'VDE',
    },
    'LOC|BUENOS AIRES|Gral. Rodríguez': {
      scope: 'loc',
      province: 'BUENOS AIRES',
      localityName: 'Gral. Rodríguez',
      newVendor: 'GONZALO DE LA ROSA',
      newType: 'VDE',
    },
  };
  function computeSig(vendorOverrides) {
    const parts = [];
    Object.entries(vendorOverrides)
      .sort()
      .forEach(([k, v]) => parts.push('O:' + k + ':' + ((v && v.newVendor) || '')));
    return parts.join('|') || '(empty)';
  }

  it('firma captura los newVendor distintos del fixture real', () => {
    const sig = computeSig(samples);
    expect(sig).toContain('MAURICIO GIL');
    expect(sig).toContain('GONZALO DE LA ROSA');
    expect(sig).toContain('Arrecifes');
  });

  it('simulación bug: pre-fix la firma sería degenerada aún con 372 overrides', () => {
    const parts = [];
    Object.entries(samples)
      .sort()
      .forEach(([k, v]) => parts.push('O:' + k + ':' + ((v && v.vendor) || '')));
    const buggy = parts.join('|');
    expect(buggy).not.toContain('MAURICIO GIL');
    expect(buggy).not.toContain('GONZALO DE LA ROSA');
  });
});
