// src/domains/version-check.js
// S-10 P2.8 (2026-11-26): extraido de index.html (lineas 6364-6575, ~212 LOC
// total / ~139 LOC netos). Totalmente aislado de pedidos/stock/reservas.
//
// Tercera extraccion post PR #1470 (map-tile-layer) + PR #1473 (force-update-app).
//
// Responsabilidades:
//   1. Auto-chequeo cada 3 min contra ./index.html (HEAD con ETag/Last-Modified
//      para evitar GET full si no cambio -- v1586 section 108).
//   2. Si remote APP_VERSION != local -> modal apple-design bloqueante con
//      boton "Refrescar ahora" que hace cache bust + reload.
//   3. Expone window._checkAppVersion para debug manual desde consola.
//
// Contexto historico: v648 (2026-08-26) alerta inicial, v697 (2026-08-27)
// intervalo 3 min + bloqueante, v866 (2026-09-11) restyle apple-design,
// v929 (2026-09-14) quitado iconWrap, v1586 (2026-11-25) HEAD con ETag
// para reducir trafico.
//
// section 13: el bundle IIFE corre antes del inline; APP_VERSION se resuelve
// via window.APP_VERSION (declarado en index.html:~6346 antes del <script>
// inline que define el IIFE original). El primer check real corre a los 5s
// post-load -- para entonces el inline ya ejecuto y window.APP_VERSION esta
// definido. Safe.
//
// Cross-scope exports:
//   - window._checkAppVersion -> funcion _checkRemoteVersion para debug manual.
//
// Cross-scope reads:
//   - window.APP_VERSION (declarado const en el inline, expuesto en window).

/** @type {any} */
const win = window;

// v648 (2026-08-26): alerta popup "version desactualizada". Pedido Mariano:
// vendedores no se dan cuenta que hay version nueva y siguen usando cache
// vieja. Cada 15 min (+ al startup) fetcheamos index.html sin cache y
// extraemos APP_VERSION del HTML remoto. Si difiere del local, popup
// con boton "REFRESCAR AHORA" que fuerza reload con cache bust.
//
// Dismiss: boton "Despues" oculta popup por 1 hora (localStorage timestamp).
// Al proximo check si sigue mismatch -> popup vuelve.
(function initVersionCheck() {
  // v697 (2026-08-27): pedido de Mariano - "si o si a TODOS". Cambios:
  // - Intervalo 15 min -> 3 min (deteccion mas rapida post-deploy)
  // - Check inmediato al startup (era despues de 30s)
  // - Sin boton "Despues" (no dismiss): el modal es bloqueante hasta refrescar.
  const CHECK_INTERVAL_MS = 3 * 60 * 1000; // 3 min

  /** @param {string} remoteVer */
  function _showVersionAlert(remoteVer) {
    // Si ya esta el modal abierto (double-trigger), skip.
    if (document.getElementById('version-alert-modal')) return;

    // v866 (2026-09-11): restyle apple-design (skill CLAUDE.md #21).
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const overlay = document.createElement('div');
    overlay.id = 'version-alert-modal';
    overlay.style.cssText =
      'position:fixed;inset:0;z-index:100000;' +
      'display:flex;align-items:center;justify-content:center;padding:24px;' +
      'background:rgba(0,0,0,0.35);' +
      '-webkit-backdrop-filter:blur(20px) saturate(1.6);' +
      'backdrop-filter:blur(20px) saturate(1.6);' +
      'opacity:0;transition:opacity ' +
      (reduceMotion ? '0ms' : '250ms') +
      ' cubic-bezier(0.16,1,0.3,1)';

    const box = document.createElement('div');
    box.style.cssText =
      'background:var(--bg-elevated);border-radius:20px;max-width:380px;width:100%;' +
      'padding:32px 28px 24px;' +
      'box-shadow:0 24px 60px -12px rgba(0,0,0,0.35),0 8px 24px -8px rgba(0,0,0,0.15);' +
      'text-align:center;font-family:inherit;' +
      'border:0.5px solid rgba(255,255,255,0.08);' +
      (reduceMotion
        ? ''
        : 'transform:scale(0.94);opacity:0;transition:transform 350ms cubic-bezier(0.16,1,0.3,1),opacity 250ms cubic-bezier(0.16,1,0.3,1);');

    // v929 (2026-09-14): quitado el cuadrado azul (iconWrap) -- Mariano lo
    // pidio; sin contenido dentro era ruido visual.

    const title = document.createElement('div');
    title.style.cssText =
      'font-size:20px;font-weight:700;color:var(--text-primary);' +
      'letter-spacing:-0.022em;line-height:1.2;margin-bottom:10px';
    title.textContent = 'Nueva version disponible';

    const msg = document.createElement('div');
    msg.style.cssText =
      'font-size:14px;color:var(--text-secondary);' +
      'line-height:1.5;margin-bottom:24px;font-weight:400;letter-spacing:-0.006em';
    // Verbatim del inline original. APP_VERSION es const local trusted;
    // remoteVer viene del regex match del HTML remoto (mismo origen).
    // Audit CLAUDE.md section 31 lo marca como "no modificar en esta tarea".
    msg.innerHTML =
      'Estas usando <b style="color:var(--text-primary);font-weight:600">' +
      win.APP_VERSION +
      '</b> ' +
      'pero la ultima es <b style="color:var(--text-primary);font-weight:600">' +
      remoteVer +
      '</b>.<br><br>' +
      'Actualiza ahora para no perder los ultimos cambios ni arrastrar bugs de la version vieja.';

    const btnRefresh = document.createElement('button');
    btnRefresh.type = 'button';
    btnRefresh.style.cssText =
      'background:linear-gradient(180deg,#0ea5e9,#0284a0);color:#fff;' +
      'border:none;border-radius:14px;padding:14px 28px;' +
      'font-size:15px;font-weight:600;letter-spacing:-0.01em;' +
      'cursor:pointer;font-family:inherit;' +
      'box-shadow:0 4px 12px -2px rgba(2,132,160,0.4),inset 0 1px 0 rgba(255,255,255,0.2);' +
      'transition:transform 100ms ease-out,box-shadow 100ms ease-out;' +
      'min-width:180px;' +
      '-webkit-tap-highlight-color:transparent;user-select:none';
    btnRefresh.textContent = '↻ Refrescar ahora';

    btnRefresh.addEventListener('pointerdown', function () {
      btnRefresh.style.transform = 'scale(0.97)';
      btnRefresh.style.boxShadow =
        '0 2px 6px -1px rgba(2,132,160,0.4),inset 0 1px 0 rgba(255,255,255,0.2)';
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (ev) {
      btnRefresh.addEventListener(ev, function () {
        btnRefresh.style.transform = '';
        btnRefresh.style.boxShadow =
          '0 4px 12px -2px rgba(2,132,160,0.4),inset 0 1px 0 rgba(255,255,255,0.2)';
      });
    });

    btnRefresh.onclick = function () {
      try {
        if ('serviceWorker' in navigator) {
          navigator.serviceWorker.getRegistrations().then((regs) => {
            Promise.all(regs.map((r) => r.unregister())).finally(() => {
              if ('caches' in window) {
                caches
                  .keys()
                  .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
                  .finally(() => {
                    location.reload();
                  });
              } else {
                location.reload();
              }
            });
          });
        } else {
          location.reload();
        }
      } catch (_e) {
        location.reload();
      }
    };

    // v697: sin boton "Despues". Mariano pidio bloqueante para forzar
    // actualizacion en todos los users. El unico camino es refrescar.
    box.appendChild(title);
    box.appendChild(msg);
    box.appendChild(btnRefresh);
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    // section 7 spatial consistency: animar entrada spring desde scale 0.94.
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        overlay.style.opacity = '1';
        box.style.transform = '';
        box.style.opacity = '1';
      });
    });
  }

  // v1586 section 108 (2026-11-25): fix 2-fase para evitar descargar index.html
  // entero (~700KB) cada 3 min. Discovery Stack midio ~14 MB/h de trafico
  // innecesario por VDE que no se dio cuenta del hit.
  /** @type {{etag: string|null, lastModified: string|null} | null} */
  let _lastValidator = null;
  async function _checkRemoteVersion() {
    try {
      let shouldFullFetch = _lastValidator === null;
      if (_lastValidator) {
        try {
          const headResp = await fetch('./index.html', {
            method: 'HEAD',
            cache: 'no-cache',
          });
          if (headResp.ok) {
            const newEtag = headResp.headers.get('etag');
            const newLM = headResp.headers.get('last-modified');
            const sameEtag = newEtag && _lastValidator.etag && newEtag === _lastValidator.etag;
            const sameLM =
              newLM && _lastValidator.lastModified && newLM === _lastValidator.lastModified;
            if (sameEtag || sameLM) {
              return;
            }
            shouldFullFetch = true;
          } else if (headResp.status === 405) {
            shouldFullFetch = true;
          }
        } catch (_eHead) {
          shouldFullFetch = true;
        }
      }
      if (!shouldFullFetch) return;

      const resp = await fetch('./index.html?_v=' + Date.now(), { cache: 'no-store' });
      if (!resp.ok) return;
      _lastValidator = {
        etag: resp.headers.get('etag'),
        lastModified: resp.headers.get('last-modified'),
      };
      const html = await resp.text();
      const m = html.match(/const APP_VERSION\s*=\s*['"]([^'"]+)['"]/);
      if (!m) return;
      const remoteVer = m[1];
      if (remoteVer && remoteVer !== win.APP_VERSION) {
        console.log('[version-check] mismatch local=' + win.APP_VERSION + ' remote=' + remoteVer);
        _showVersionAlert(remoteVer);
      }
    } catch (_e) {
      // Sin red o error - silent.
    }
  }

  // v697: check inmediato al startup (era despues de 30s). Luego cada 3 min.
  setTimeout(_checkRemoteVersion, 5 * 1000);
  setInterval(_checkRemoteVersion, CHECK_INTERVAL_MS);
  // Expose para debug manual desde consola.
  win._checkAppVersion = _checkRemoteVersion;
})();
