// sec 2026-11-24 — saneo de src/href de imágenes y adjuntos (C-01/C-02) y
// escape de atributos (C-03). Tests de la lógica pura + contrato de que los
// puntos de render la usan.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { safeDownloadHref, safeImgSrc } from '../../../src/pure/html-safe.js';

const ROOT = resolve(__dirname, '../../..');
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');

const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const JPG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBD';
const STORAGE =
  'https://firebasestorage.googleapis.com/v0/b/x.appspot.com/o/a%2Fb.jpg?alt=media&token=abc';

describe('safeImgSrc', () => {
  it('acepta data:image base64 de tipos comunes', () => {
    expect(safeImgSrc(PNG)).toBe(PNG);
    expect(safeImgSrc(JPG)).toBe(JPG);
    expect(safeImgSrc('data:image/webp;base64,AAAA')).toBe('data:image/webp;base64,AAAA');
  });
  it('acepta https y escapa & para el atributo', () => {
    expect(safeImgSrc(STORAGE)).toBe(STORAGE.replace(/&/g, '&amp;'));
  });
  it('descarta valores que cierran el atributo', () => {
    expect(safeImgSrc('x" onerror="alert(1)')).toBe('');
    expect(safeImgSrc(`${PNG}" onerror="x`)).toBe('');
    expect(safeImgSrc("x' onerror='1")).toBe('');
  });
  it('descarta esquemas no permitidos', () => {
    expect(safeImgSrc('javascript:alert(1)')).toBe('');
    expect(safeImgSrc('http://example.com/a.png')).toBe('');
    expect(safeImgSrc('data:text/html;base64,PHNjcmlwdD4=')).toBe('');
    expect(safeImgSrc('data:image/svg+xml;base64,PHN2Zz4=')).toBe('');
    expect(safeImgSrc('data:image/png,<svg>')).toBe('');
    expect(safeImgSrc('//example.com/a.png')).toBe('');
  });
  it('https con comillas queda escapado (no rompe el atributo)', () => {
    const out = safeImgSrc('https://example.com/a.png?x="><b>');
    expect(out).not.toContain('"');
    expect(out).not.toContain('<');
  });
  it('no-string / vacío → ""', () => {
    for (const v of [null, undefined, 0, {}, [], '', '   ']) expect(safeImgSrc(v)).toBe('');
  });
});

describe('safeDownloadHref', () => {
  it('acepta pdf, planillas e imágenes en data: base64', () => {
    for (const mime of [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'text/csv',
      'image/png',
      'application/octet-stream',
    ]) {
      const v = `data:${mime};base64,QUJD`;
      expect(safeDownloadHref(v)).toBe(v);
    }
  });
  it('descarta data: sin MIME explícito', () => {
    // Antes se aceptaba `data:;base64,…` (grupo de MIME opcional), contra lo
    // que decía el helper. FileReader usa application/octet-stream cuando el
    // archivo no tiene tipo, así que exigir MIME no rompe adjuntos reales.
    expect(safeDownloadHref('data:;base64,QUJD')).toBe('');
    expect(safeDownloadHref('data:base64,QUJD')).toBe('');
  });
  it('descarta javascript:, html y valores que cierran el atributo', () => {
    expect(safeDownloadHref('javascript:alert(1)')).toBe('');
    expect(safeDownloadHref('JaVaScRiPt:alert(1)')).toBe('');
    expect(safeDownloadHref('data:text/html;base64,PHNjcmlwdD4=')).toBe('');
    expect(safeDownloadHref('data:application/pdf;base64,QUJD" onclick="x')).toBe('');
  });
  it('acepta https', () => {
    expect(safeDownloadHref('https://example.com/f.pdf')).toBe('https://example.com/f.pdf');
  });
});

describe('contrato: los puntos de render usan los helpers', () => {
  const notif = read('src/domains/notificaciones.js');
  const rend = read('src/domains/rendiciones.js');

  it('notificaciones.js importa safeImgSrc y no concatena campos crudos en <img src>', () => {
    expect(notif).toMatch(/import \{ [^}]*\bsafeImgSrc\b[^}]*\} from '\.\.\/pure\/html-safe\.js'/);
    expect(notif).not.toMatch(/<img src="' \+\s*a\.constancia/);
    expect(notif).not.toMatch(/img\.replace\(\/'\/g, '&#39;'\)/);
    expect(notif).toMatch(/safeImgSrc\(a\.constanciaArca\)/);
    expect(notif).toMatch(/safeImgSrc\(a\.constanciaIIBB\)/);
    expect(notif).toMatch(/const f = safeImgSrc\(f0\)/);
  });
  it('rendiciones.js sanea ticket y adjunto', () => {
    expect(rend).toMatch(
      /import \{ safeDownloadHref, safeImgSrc \} from '\.\.\/pure\/html-safe\.js'/
    );
    expect(rend).toMatch(/safeImgSrc\(r\.fotoTicketUrl \|\| r\.fotoTicket/);
    expect(rend).not.toMatch(/'<img src="' \+\s*r\.adjunto\.data/);
    expect(rend).not.toMatch(/'<a href="' \+\s*r\.adjunto\.data/);
  });
});
