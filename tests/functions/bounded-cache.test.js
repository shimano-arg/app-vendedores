// @ts-check
import { describe, expect, it } from 'vitest';
import { createBoundedCache } from '../../functions/core/bounded-cache.js';

describe('createBoundedCache', () => {
  it('desaloja la entrada mas vieja al superar el maximo', () => {
    const c = createBoundedCache(3);
    for (const k of ['a', 'b', 'c', 'd']) c.set(k, k.toUpperCase());
    expect(c.size()).toBe(3);
    expect(c.get('a')).toBeUndefined();
    expect(c.get('d')).toBe('D');
  });
  it('reescribir una clave la vuelve la mas nueva', () => {
    const c = createBoundedCache(2);
    c.set('a', 1);
    c.set('b', 2);
    c.set('a', 3);
    c.set('c', 4);
    expect(c.get('b')).toBeUndefined();
    expect(c.get('a')).toBe(3);
    expect(c.size()).toBe(2);
  });
  it('default 200', () => {
    const c = createBoundedCache();
    for (let i = 0; i < 250; i++) c.set(String(i), i);
    expect(c.size()).toBe(200);
  });
});
