// @ts-check
/**
 * Cache Map-like acotada: tope de entradas, desaloja la mas vieja
 * (orden de insercion) al excederlo. Interfaz {get,set}.
 *
 * @param {number} [max]
 * @returns {{ get: (k: string) => any, set: (k: string, v: any) => any, size: () => number }}
 */
export function createBoundedCache(max = 200) {
  /** @type {Map<string, any>} */
  const m = new Map();
  return {
    get: (k) => m.get(k),
    set: (k, v) => {
      // Reinsertar para que la clave actualizada cuente como la mas nueva.
      m.delete(k);
      m.set(k, v);
      while (m.size > max) {
        const oldest = m.keys().next().value;
        m.delete(oldest);
      }
      return v;
    },
    size: () => m.size,
  };
}
