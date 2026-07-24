import { describe, it, expect } from 'vitest';
import { matchesAllTokens } from '../../src/pure/search.js';

describe('matchesAllTokens', () => {
  it('happy: todos los tokens presentes → true', () => {
    expect(matchesAllTokens('El Pez Gordo — Quilmes Oeste', 'pez quilmes')).toBe(true);
    expect(matchesAllTokens('Pescamagic — Buenos Aires', 'pesca aires')).toBe(true);
  });
  it('happy: orden no importa', () => {
    expect(matchesAllTokens('foo bar baz', 'baz foo')).toBe(true);
  });
  it('un token no matchea → false', () => {
    expect(matchesAllTokens('El Pez Gordo', 'pez rojo')).toBe(false);
  });
  it('edge: query vacía o whitespace → true (no filtra)', () => {
    expect(matchesAllTokens('foo', '')).toBe(true);
    expect(matchesAllTokens('foo', '   ')).toBe(true);
    expect(matchesAllTokens('foo', null)).toBe(true);
    expect(matchesAllTokens('foo', undefined)).toBe(true);
  });
  it('regresión v313: matchea con acentos normalizados', () => {
    expect(matchesAllTokens('Pescamágico Ñandú', 'pescamagico nandu')).toBe(true);
    expect(matchesAllTokens('José López', 'jose lopez')).toBe(true);
  });
});
