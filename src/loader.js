// @ts-nocheck
// E3 (e2b-perf): lazy chunk loader.
// El shell instala stubs proxy para los exports window.foo de cada chunk lazy.
// El primer llamado a window.foo dispara loadChunk(name), inyecta el <script>
// del chunk (que sobreescribe window.foo con la implementación real), y
// re-invoca window.foo con los args originales.
//
// Dedup: llamadas simultáneas a loadChunk('x') comparten la misma Promise.
//
// Uso desde shell:
//   installChunkStubs('visitas', ['openVisitaModal', 'closeVisitaModal', ...]);
//
// Uso desde inline / onclick HTML:
//   <button onclick="openVisitaModal()">  // funciona igual, el stub hace el lazy
//   await window.loadChunk('visitas'); window.openVisitaModal();  // pattern manual

const _loaded = Object.create(null); // {chunkName: true} — chunk ya inyectado
const _pending = Object.create(null); // {chunkName: Promise} — chunk en vuelo

/**
 * Carga el chunk `chunks/<name>.js` una sola vez. Idempotente + dedup.
 * @param {string} name
 * @returns {Promise<void>}
 */
export function loadChunk(name) {
  if (_loaded[name]) return Promise.resolve();
  if (_pending[name]) return _pending[name];
  const p = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = './chunks/' + name + '.js';
    s.async = false; // preservar orden de ejecución si se cargan varios en paralelo
    s.onload = () => {
      _loaded[name] = true;
      resolve();
    };
    s.onerror = () => {
      delete _pending[name];
      reject(new Error('loadChunk: failed to load chunks/' + name + '.js'));
    };
    document.head.appendChild(s);
  });
  _pending[name] = p;
  return p;
}

/**
 * Instala stubs `window.<funcName>` que hacen lazy loadChunk + re-invoke.
 * El chunk cuando carga sobreescribe `window.<funcName>` con la implementación real.
 *
 * Comportamiento del stub:
 *  - Retorna una Promise que resuelve al valor de retorno de la función real.
 *  - Los `onclick="foo()"` del HTML ignoran el retorno → funciona idéntico.
 *  - Callers programáticos que necesiten esperar deben `await` o `.then()`.
 *
 * @param {string} chunkName
 * @param {string[]} exportNames
 */
export function installChunkStubs(chunkName, exportNames) {
  for (const name of exportNames) {
    // No sobreescribir si el chunk ya está cargado (defensivo).
    if (_loaded[chunkName]) continue;
    // @ts-expect-error — window augmentation runtime-only
    window[name] = function () {
      const args = arguments;
      return loadChunk(chunkName).then(() => {
        const fn = window[name];
        // Sanity check: post-load, window[name] debe ser la implementación real,
        // NO el mismo stub. Si el chunk no lo redefinió, hay un bug en el chunk.
        if (fn === window[name] && fn.name === '' && fn.length === 0) {
          console.warn('[loader] chunk', chunkName, 'no redefinió window.' + name);
        }
        return fn.apply(this, args);
      });
    };
  }
}

// Expose to inline for manual usage.
if (typeof window !== 'undefined') {
  // @ts-expect-error
  window.loadChunk = loadChunk;
  // @ts-expect-error
  window.__chunksLoaded = _loaded;
}
