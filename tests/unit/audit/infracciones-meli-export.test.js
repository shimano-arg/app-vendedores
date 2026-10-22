// @ts-check
/**
 * v1413 §51 — tests para la opción "Infracciones MELI" del modal
 * Reportes Excel. Mariano-only. Lee doc Firestore
 * `meli_infracciones_resumen/current` publicado por el pipeline MI y genera
 * xlsx client-side con formato exacto (header turquesa oscuro, SI turquesa
 * claro, NO rojo oscuro, moneda $, freeze A2, autofilter).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const INDEX_HTML = readFileSync('index.html', 'utf8');
const EXPORTS_CORE = readFileSync('src/domains/exports-core.js', 'utf8');
const EXPORTS_ADVANCED = readFileSync('src/domains/exports-advanced.js', 'utf8');
const BUILD_JS = readFileSync('build.js', 'utf8');
const MAIN_JS = readFileSync('src/main.js', 'utf8');
const SW_JS = readFileSync('sw.js', 'utf8');
const RULES = readFileSync('firestore.rules', 'utf8');

describe('v1413 §51 — modal entry presente', () => {
  it('index.html tiene la opción INFRACCIONES_MELI en el export-modal', () => {
    expect(INDEX_HTML).toMatch(/data-exp-kind="INFRACCIONES_MELI"/);
    expect(INDEX_HTML).toMatch(/id="exp-opt-infracciones-meli"/);
  });

  it('la opción está display:none por default (gate Mariano-only runtime)', () => {
    const m = INDEX_HTML.match(/id="exp-opt-infracciones-meli"[^>]*style="([^"]*)"/);
    expect(m).toBeTruthy();
    expect(m[1]).toMatch(/display:\s*none/);
  });

  it('onclick llama exportInfraccionesMeli()', () => {
    expect(INDEX_HTML).toMatch(/onclick="closeExportDialog\(\);exportInfraccionesMeli\(\)"/);
  });

  it('icono rojo #dc2626', () => {
    const idx = INDEX_HTML.indexOf('id="exp-opt-infracciones-meli"');
    const chunk = INDEX_HTML.slice(idx, idx + 400);
    expect(chunk).toMatch(/background:\s*#dc2626/);
  });
});

describe('v1413 §51 — exportToExcel gate Mariano-only para INFRACCIONES_MELI', () => {
  it('exports-core.js checkea email === erbinomariano@gmail.com', () => {
    expect(EXPORTS_CORE).toMatch(/INFRACCIONES_MELI/);
    expect(EXPORTS_CORE).toMatch(/erbinomariano@gmail\.com/);
  });

  it('oculta la opción cuando no es Mariano', () => {
    expect(EXPORTS_CORE).toMatch(/kind === 'INFRACCIONES_MELI' && !_isMariano/);
  });
});

describe('v1413 §51 — exportInfraccionesMeli handler', () => {
  it('exports-advanced.js define window.exportInfraccionesMeli', () => {
    expect(EXPORTS_ADVANCED).toMatch(/window\.exportInfraccionesMeli\s*=\s*async\s+function/);
  });

  it('lee doc meli_infracciones_resumen/current', () => {
    expect(EXPORTS_ADVANCED).toMatch(/meli_infracciones_resumen/);
    expect(EXPORTS_ADVANCED).toMatch(/\.doc\(['"]current['"]\)/);
  });

  it('header con fondo theme=8 tint -0.5 (azul petroleum oscuro)', () => {
    expect(EXPORTS_ADVANCED).toMatch(/theme:\s*8,\s*tint:\s*-0\.49/);
  });

  it('fila SI con fondo theme=8 tint +0.6 (azul claro)', () => {
    expect(EXPORTS_ADVANCED).toMatch(/theme:\s*8,\s*tint:\s*0\.59/);
  });

  it('fila NO con fondo theme=5 tint -0.5 (rojo oscuro)', () => {
    expect(EXPORTS_ADVANCED).toMatch(/theme:\s*5,\s*tint:\s*-0\.49/);
  });

  it('header con las 7 columnas exactas incluyendo doble espacio en col 6', () => {
    expect(EXPORTS_ADVANCED).toMatch(/'Cliente'/);
    expect(EXPORTS_ADVANCED).toMatch(/'SKU'/);
    expect(EXPORTS_ADVANCED).toMatch(/'Diferencia %'/);
    expect(EXPORTS_ADVANCED).toMatch(/'Precio publicado'/);
    expect(EXPORTS_ADVANCED).toMatch(/'Precio Sugerido'/);
    expect(EXPORTS_ADVANCED).toMatch(/'Cant\. Historicas {2}de Infracciones'/);
    expect(EXPORTS_ADVANCED).toMatch(/'¿Cliente\?'/);
  });

  it('column widths A=38, B=20, C=15.66, D=18, E=16, F=14.55, G=8.89', () => {
    expect(EXPORTS_ADVANCED).toMatch(
      /widths\s*=\s*\[38,\s*20,\s*15\.66,\s*18,\s*16,\s*14\.55,\s*8\.89\]/
    );
  });

  it('freeze A2 + no gridlines', () => {
    expect(EXPORTS_ADVANCED).toMatch(/ySplit:\s*1/);
    expect(EXPORTS_ADVANCED).toMatch(/showGridLines:\s*false/);
  });

  it('autoFilter row 1 to row N columns 1-7', () => {
    expect(EXPORTS_ADVANCED).toMatch(/autoFilter/);
    expect(EXPORTS_ADVANCED).toMatch(/to:\s*\{\s*row:\s*ws\.rowCount,\s*column:\s*headers\.length/);
  });

  it('header height 28.8', () => {
    expect(EXPORTS_ADVANCED).toMatch(/header\.height\s*=\s*28\.8/);
  });

  it('download como INFRACCIONES-MELI.xlsx', () => {
    expect(EXPORTS_ADVANCED).toMatch(/_downloadBlob\(blob,\s*['"]INFRACCIONES-MELI\.xlsx['"]\)/);
  });
});

describe('v1413 §51 — chunk stubs sincronizados', () => {
  it('build.js incluye exportInfraccionesMeli en exports-advanced', () => {
    expect(BUILD_JS).toMatch(/'exports-advanced':[\s\S]*?'exportInfraccionesMeli'/);
  });

  it('src/main.js incluye exportInfraccionesMeli en installChunkStubs', () => {
    expect(MAIN_JS).toMatch(
      /installChunkStubs\('exports-advanced',[\s\S]*?'exportInfraccionesMeli'/
    );
  });

  it('sw.js STATIC_ASSETS incluye chunks/exports-advanced.js', () => {
    expect(SW_JS).toMatch(/\.\/chunks\/exports-advanced\.js/);
  });
});

describe('v1413 §51 — firestore rules', () => {
  it('rules permiten read Mariano-only sobre meli_infracciones_resumen', () => {
    expect(RULES).toMatch(
      /match \/meli_infracciones_resumen\/\{[^}]*\}\s*\{[\s\S]*?allow read:\s*if\s+isMariano\(\)/
    );
  });

  it('rules bloquean write desde client (publicado por SA Admin SDK)', () => {
    const m = RULES.match(/match \/meli_infracciones_resumen\/\{[^}]*\}\s*\{([\s\S]*?)\}/);
    expect(m).toBeTruthy();
    expect(m[1]).toMatch(/allow write:\s*if\s+false/);
  });
});
