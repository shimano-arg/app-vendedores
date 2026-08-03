import { describe, expect, it } from 'vitest';
import {
  escapeHtml,
  normalizeSearch,
  normClientName,
  normTitle,
  titleCase,
} from '../../src/pure/normalize.js';

describe('normClientName', () => {
  it('happy: strips diacritics + uppercases + trims', () => {
    expect(normClientName('  Café López  ')).toBe('CAFE LOPEZ');
  });
  it('edge: null → ""', () => {
    expect(normClientName(null)).toBe('');
    expect(normClientName(undefined)).toBe('');
  });
  it('edge: acepta cualquier tipo (numeros, objetos con toString)', () => {
    expect(normClientName(123)).toBe('123');
    expect(normClientName({ toString: () => 'hola' })).toBe('HOLA');
  });
  it('regresión: preserva ñ como N (ya sin diacrítico via NFD)', () => {
    // NFD descompone ñ en n + tilde combinante; el regex remueve la tilde.
    expect(normClientName('Peña')).toBe('PENA');
  });
});

describe('titleCase', () => {
  it('happy: cada palabra capitalizada', () => {
    expect(titleCase('hola mundo')).toBe('Hola Mundo');
  });
  it('edge: string vacía', () => {
    expect(titleCase('')).toBe('');
  });
  it('edge: apóstrofo cuenta como word boundary (JS \\b\\w) → "Mc\'Donalds"', () => {
    // JS `\b` reconoce `'` como límite, así que la `d` post-apóstrofo
    // se capitaliza. Es el comportamiento real de la función en prod
    // (verificado extracción directa de index.html:4396). Documentado
    // en tests para congelar la semántica.
    expect(titleCase("mc'donalds - the store")).toBe("Mc'Donalds - The Store");
  });
});

describe('escapeHtml', () => {
  it('happy: escapa los 5 chars', () => {
    expect(escapeHtml(`<script>alert('x' & "y")</script>`)).toBe(
      '&lt;script&gt;alert(&#39;x&#39; &amp; &quot;y&quot;)&lt;/script&gt;'
    );
  });
  it('edge: sin chars especiales pasa transparente', () => {
    expect(escapeHtml('hola mundo 123')).toBe('hola mundo 123');
  });
  it('edge: null → "null"', () => {
    expect(escapeHtml(null)).toBe('null');
  });
});

describe('normTitle (SKU-friendly)', () => {
  it('happy: strip todo lo no-alfanum + upper', () => {
    expect(normTitle('Reel Shimano 4000-FI')).toBe('REELSHIMANO4000FI');
  });
  it('edge: null / undefined → ""', () => {
    expect(normTitle(null)).toBe('');
    expect(normTitle(undefined)).toBe('');
  });
  it('edge: strip diacríticos', () => {
    expect(normTitle('Caña Náutica')).toBe('CANANAUTICA');
  });
});

describe('normalizeSearch', () => {
  it('happy: NFD + lower + preserva espacios', () => {
    expect(normalizeSearch('El Pez Gordo')).toBe('el pez gordo');
  });
  it('edge: strip diacríticos ñ, á, é', () => {
    expect(normalizeSearch('Pescamágico Ñandú')).toBe('pescamagico nandu');
  });
  it('edge: null → ""', () => {
    expect(normalizeSearch(null)).toBe('');
  });
});
