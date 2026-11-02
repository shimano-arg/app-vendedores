// v1539 APP-04: ficha desplegable del Master de Clientes. Contratos de
// solo lectura y de enganche con la tabla.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const MC = readFileSync('src/domains/master-clientes.js', 'utf8');
const INDEX = readFileSync('index.html', 'utf8');
const BLOCK = MC.slice(
  MC.indexOf('// v1539 APP-04 (2026-11-02): ficha desplegable del cliente en el Master.')
);

describe('v1539 APP-04 — solo lectura', () => {
  it('el bloque de la ficha existe', () => {
    expect(BLOCK.length).toBeGreaterThan(500);
  });
  it('no escribe en Firestore (sin update / doc().set|delete / collection().add / batch)', () => {
    // .set/.add/.delete sobre Map/Set/classList son locales y están permitidos;
    // lo prohibido es escribir documentos.
    expect(BLOCK).not.toMatch(/\.update\(/);
    expect(BLOCK).not.toMatch(/\.doc\([^)]*\)\s*\.(set|delete)\(/);
    expect(BLOCK).not.toMatch(/\.collection\([^)]*\)\s*\.add\(/);
    expect(BLOCK).not.toMatch(/batch\(|runTransaction|FieldValue/);
  });
  it('fbDb se usa en un solo lugar (la lectura puntual)', () => {
    expect(BLOCK.match(/fbDb/g)?.length).toBe(1);
  });
  it('solo lee las 3 colecciones previstas con .get()', () => {
    const cols = [...BLOCK.matchAll(/_mcFichaGet\('([a-z_]+)'/g)].map((m) => m[1]).sort();
    expect(cols).toEqual(['cartera_vendor', 'client_buyer_stats', 'client_locations']);
    expect(BLOCK).toMatch(/\.doc\(docId\)\s*\.get\(\)/);
  });
  it('cachea lecturas y evita duplicadas en curso', () => {
    expect(BLOCK).toMatch(/_mcFichaReadCache\.has\(k\)/);
    expect(BLOCK).toMatch(/_mcFichaInflight\.has\(k\)/);
  });
});

describe('v1539 APP-04 — enganche con la tabla', () => {
  it('el nombre de las filas del padrón es el toggle', () => {
    expect(MC).toMatch(/<div class="mc-name mc-ficha-toggle" role="button" tabindex="0"/);
  });
  it('las filas provisorias (nombre editable) tienen botón Ficha', () => {
    expect(MC).toMatch(/class="mc-ficha-toggle mc-ficha-btn"/);
  });
  it('después del render se engancha el click y se reabren las fichas abiertas', () => {
    expect(MC).toMatch(
      /cont\.innerHTML = html;\s*\/\/ v1539 APP-04[^\n]*\n\s*_mcFichaBind\(cont\);\s*_mcFichaReopen\(cont\);/
    );
  });
  it('el listener se engancha una sola vez', () => {
    expect(BLOCK).toMatch(/cont\.dataset\.mcFichaBound === '1'/);
  });
  it('la fila de la ficha se inserta debajo de la fila del cliente', () => {
    expect(BLOCK).toMatch(/tr\.parentNode\.insertBefore\(fr, tr\.nextSibling\)/);
  });
  it('CSS de la ficha presente y sin content-visibility en la fila desplegada', () => {
    expect(INDEX).toMatch(/\.mc-table tbody tr\.mc-ficha-row\{content-visibility:visible\}/);
    expect(INDEX).toMatch(/\.mc-ficha\{display:grid/);
  });
});
