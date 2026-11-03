// @ts-nocheck
/**
 * Pedidos del mes (v1540, 2026-11-02, APP-06) — chunk lazy.
 *
 * Facturación efectivamente emitida por cliente y SKU en un mes. Los datos
 * vienen SOLO del callable `pedidosDelMesCF` (BigQuery v_ventas_lineas:
 * facturas y notas de crédito de SAP). No lee pedidos, lista de espera,
 * backorder ni stock asignado: nada que no esté facturado puede aparecer.
 *
 * El alcance lo decide el servidor: el vendedor recibe solo sus clientes;
 * admin/gerente, todo el país. El filtro de vendedor de esta pantalla es
 * solo para admin/gerente (filtra sobre datos que ya tiene permiso de ver).
 *
 * Interacción: mismo patrón que Stock Asignado (fila con ▶, clic despliega
 * debajo la tabla de SKU; varias abiertas a la vez).
 *
 * Informe: docs/auditoria/49_PEDIDOS_DEL_MES.md.
 */

import { filtrarClientes, fmtArs, fmtUds, totalesDe } from '../pure/pedidos-del-mes-view.js';

const REGION = 'southamerica-east1';
const MAX_CLIENTES_RENDER = 300;
const MESES = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
];
const ANIO_MIN = 2026; // primer año con facturación sincronizada en BigQuery

/** @type {{ anio: number, mes: number, q: string, vendedor: string, data: any, loading: boolean,
 *   error: string, reqSeq: number, abiertos: Set<string>, uid: string|null }} */
const state = {
  anio: 0,
  mes: 0,
  q: '',
  vendedor: '',
  data: null,
  loading: false,
  error: '',
  reqSeq: 0,
  abiertos: new Set(),
  uid: null,
};

/** @param {any} s */
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function _role() {
  try {
    return (typeof userRole !== 'undefined' ? userRole : window.userRole) || null;
  } catch (_e) {
    return /** @type {any} */ (window).userRole || null;
  }
}

function _uid() {
  try {
    const u = typeof currentUser !== 'undefined' ? currentUser : window.currentUser;
    return (u && u.uid) || null;
  } catch (_e) {
    return null;
  }
}

/** Mes actual en hora Argentina. */
function _mesActual() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date());
  return {
    anio: Number(parts.find((p) => p.type === 'year')?.value || 2026),
    mes: Number(parts.find((p) => p.type === 'month')?.value || 1),
  };
}

/** @param {string} iso YYYY-MM-DD */
function fmtFecha(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  return m ? m[3] + '/' + m[2] + '/' + m[1] : String(iso || '');
}

function _esStaff() {
  const r = _role();
  return r === 'admin' || r === 'gerente';
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

function _renderFiltros() {
  const box = document.getElementById('pdm-filtros');
  if (!box) return;
  const actual = _mesActual();
  let mesOpts = '';
  for (let m = 1; m <= 12; m++) {
    const futuro = state.anio === actual.anio && m > actual.mes;
    if (futuro) continue;
    mesOpts +=
      '<option value="' +
      m +
      '"' +
      (m === state.mes ? ' selected' : '') +
      '>' +
      MESES[m - 1] +
      '</option>';
  }
  let anioOpts = '';
  for (let a = actual.anio; a >= ANIO_MIN; a--) {
    anioOpts +=
      '<option value="' + a + '"' + (a === state.anio ? ' selected' : '') + '>' + a + '</option>';
  }
  let vendSel = '';
  if (_esStaff()) {
    const vends = new Set();
    for (const c of (state.data && state.data.clientes) || [])
      if (c.vendedor) vends.add(c.vendedor);
    let opts = '<option value="">Todos los vendedores</option>';
    for (const v of [...vends].sort())
      opts +=
        '<option value="' +
        esc(v) +
        '"' +
        (v === state.vendedor ? ' selected' : '') +
        '>' +
        esc(v) +
        '</option>';
    vendSel =
      '<select id="pdm-vendedor" class="pdm-input" aria-label="Vendedor">' + opts + '</select>';
  }
  box.innerHTML =
    '<select id="pdm-mes" class="pdm-input" aria-label="Mes">' +
    mesOpts +
    '</select>' +
    '<select id="pdm-anio" class="pdm-input" aria-label="Año">' +
    anioOpts +
    '</select>' +
    '<input id="pdm-q" class="pdm-input pdm-q" type="search" placeholder="Buscar cliente, código o localidad" value="' +
    esc(state.q) +
    '" aria-label="Buscar cliente" />' +
    vendSel;
}

function _renderKpis(lista) {
  const k = document.getElementById('pdm-kpis');
  if (!k) return;
  if (!state.data) {
    k.innerHTML = '';
    return;
  }
  const t = totalesDe(lista);
  const alc = state.data.alcance || {};
  k.innerHTML =
    '<span class="pdm-kpi"><b>' +
    t.clientes +
    '</b> cliente' +
    (t.clientes === 1 ? '' : 's') +
    ' con facturación</span>' +
    '<span class="pdm-kpi"><b>' +
    t.skus +
    '</b> SKU facturados</span>' +
    '<span class="pdm-kpi pdm-kpi-ars"><b>' +
    esc(fmtArs(t.ars)) +
    '</b> facturado</span>' +
    '<span class="pdm-kpi pdm-kpi-scope">' +
    (alc.nacional
      ? 'Vista nacional'
      : Array.isArray(alc.vendedores) && alc.vendedores.length > 1
        ? 'Tu zona y tus parejas'
        : 'Tus clientes') +
    '</span>';
}

/** @param {any} c */
function _detalleHtml(c) {
  let h = '<table class="pdm-det">';
  h +=
    '<thead><tr><th>SKU</th><th>Producto</th><th class="num">Cantidad</th><th class="num">Precio unitario</th><th class="num">Subtotal</th><th>Facturas</th></tr></thead><tbody>';
  for (const s of c.skus || []) {
    const docs = (s.facturas || [])
      .map((f) => {
        const nc = f.tipo === 'NOTA_CREDITO';
        return (
          '<span class="pdm-doc' +
          (nc ? ' nc' : '') +
          '" title="' +
          esc(
            (nc ? 'Nota de crédito ' : 'Factura ') +
              f.numero +
              ' · ' +
              fmtFecha(f.fecha) +
              ' · ' +
              fmtUds(f.uds) +
              ' u · ' +
              fmtArs(f.ars)
          ) +
          '">' +
          (nc ? 'NC ' : 'F ') +
          esc(f.numero) +
          '</span>'
        );
      })
      .join(' ');
    h +=
      '<tr><td class="mono">' +
      esc(s.sku) +
      '</td><td>' +
      esc(s.desc || '(sin descripción)') +
      '</td><td class="num">' +
      esc(fmtUds(s.uds)) +
      '</td><td class="num">' +
      (s.precio == null ? '-' : esc(fmtArs(s.precio))) +
      '</td><td class="num">' +
      esc(fmtArs(s.ars)) +
      '</td><td>' +
      docs +
      '</td></tr>';
  }
  h +=
    '</tbody><tfoot><tr><td colspan="2">Total: ' +
    c.skuCount +
    ' SKU · ' +
    c.facturasCount +
    ' factura' +
    (c.facturasCount === 1 ? '' : 's');
  if (c.notasCreditoCount)
    h +=
      ' · ' +
      c.notasCreditoCount +
      ' nota' +
      (c.notasCreditoCount === 1 ? '' : 's') +
      ' de crédito';
  h +=
    '</td><td class="num">' +
    esc(fmtUds(c.totalUds)) +
    '</td><td></td><td class="num">' +
    esc(fmtArs(c.totalArs)) +
    '</td><td></td></tr></tfoot></table>';
  return h;
}

function _renderLista() {
  const body = document.getElementById('pdm-list');
  if (!body) return;
  if (state.loading) {
    body.innerHTML = '<div class="pdm-msg">Cargando facturación…</div>';
    _renderKpis([]);
    return;
  }
  if (state.error) {
    body.innerHTML = '<div class="pdm-msg pdm-err">' + esc(state.error) + '</div>';
    _renderKpis([]);
    return;
  }
  if (!state.data) {
    body.innerHTML = '';
    return;
  }
  const lista = filtrarClientes(state.data.clientes, state.q, state.vendedor);
  _renderKpis(lista);
  if (!lista.length) {
    body.innerHTML =
      '<div class="pdm-msg">' +
      ((state.data.clientes || []).length
        ? 'Ningún cliente coincide con la búsqueda.'
        : 'No hay facturación en ' + MESES[state.mes - 1] + ' ' + state.anio + '.') +
      '</div>';
    return;
  }
  let h =
    '<table class="pdm-table"><thead><tr><th>Cliente</th><th>Localidad</th><th>Provincia</th><th>Vendedor</th><th class="num">SKU</th><th class="num">Facturado</th></tr></thead><tbody>';
  for (const c of lista.slice(0, MAX_CLIENTES_RENDER)) {
    const abierto = state.abiertos.has(c.cardCode);
    h +=
      '<tr class="pdm-row' +
      (abierto ? ' open' : '') +
      '" data-cc="' +
      esc(c.cardCode) +
      '" tabindex="0" role="button" aria-expanded="' +
      abierto +
      '"><td><div class="pdm-cli"><span class="pdm-caret">' +
      (abierto ? '▼' : '▶') +
      '</span><div><div class="pdm-nombre">' +
      esc(c.nombre) +
      '</div><div class="pdm-code">' +
      esc(c.cardCode) +
      '</div></div></div></td><td>' +
      esc(c.localidad || '-') +
      '</td><td>' +
      esc(c.provincia || '-') +
      '</td><td>' +
      esc(c.vendedor || '-') +
      '</td><td class="num">' +
      c.skuCount +
      '</td><td class="num pdm-ars">' +
      esc(fmtArs(c.totalArs)) +
      '</td></tr>';
    h +=
      '<tr class="pdm-det-row" data-for="' +
      esc(c.cardCode) +
      '"' +
      (abierto ? '' : ' style="display:none"') +
      '><td colspan="6">' +
      (abierto ? _detalleHtml(c) : '') +
      '</td></tr>';
  }
  h += '</tbody></table>';
  if (lista.length > MAX_CLIENTES_RENDER)
    h +=
      '<div class="pdm-msg">Mostrando ' +
      MAX_CLIENTES_RENDER +
      ' de ' +
      lista.length +
      ' clientes. Usá el buscador para encontrar el resto.</div>';
  body.innerHTML = h;
}

function render() {
  _renderFiltros();
  _renderLista();
}

/** @param {string} cc */
function _toggle(cc) {
  const body = document.getElementById('pdm-list');
  if (!body || !state.data) return;
  const row = /** @type {HTMLElement|null} */ (
    Array.from(body.querySelectorAll('tr.pdm-row')).find(
      (r) => /** @type {HTMLElement} */ (r).dataset.cc === cc
    ) || null
  );
  const det = row ? /** @type {HTMLElement|null} */ (row.nextElementSibling) : null;
  if (!row || !det) return;
  const abrir = !state.abiertos.has(cc);
  if (abrir) {
    state.abiertos.add(cc);
    const c = (state.data.clientes || []).find((x) => x.cardCode === cc);
    const td = det.querySelector('td');
    if (td && c) td.innerHTML = _detalleHtml(c);
    det.style.display = '';
  } else {
    state.abiertos.delete(cc);
    det.style.display = 'none';
  }
  row.classList.toggle('open', abrir);
  row.setAttribute('aria-expanded', String(abrir));
  const caret = row.querySelector('.pdm-caret');
  if (caret) caret.textContent = abrir ? '▼' : '▶';
}

// ---------------------------------------------------------------------------
// Datos
// ---------------------------------------------------------------------------

/** @param {any} e */
function _errorMsg(e) {
  const code = String((e && e.code) || '');
  if (code.includes('permission-denied'))
    return 'Tu usuario no tiene acceso a Pedidos del mes. Si lo necesitás, avisale a Mariano.';
  if (code.includes('invalid-argument')) return 'El período elegido no es válido.';
  return 'No pudimos traer la facturación. Volvé a intentar en un minuto; si sigue, avisale a Mariano.';
}

async function cargar() {
  const seq = ++state.reqSeq;
  state.loading = true;
  state.error = '';
  state.data = null;
  state.abiertos = new Set();
  render();
  try {
    if (typeof firebase === 'undefined' || !firebase.app) throw new Error('firebase no disponible');
    const callable = firebase.app().functions(REGION).httpsCallable('pedidosDelMesCF');
    const res = await callable({ anio: state.anio, mes: state.mes });
    if (seq !== state.reqSeq) return;
    state.data = (res && res.data) || null;
    // Si el vendedor elegido no tiene facturación en el nuevo período, se limpia.
    if (
      state.vendedor &&
      !((state.data && state.data.clientes) || []).some((c) => c.vendedor === state.vendedor)
    )
      state.vendedor = '';
  } catch (e) {
    if (seq !== state.reqSeq) return;
    console.error('[pedidos-del-mes] pedidosDelMesCF fallo:', e);
    state.error = _errorMsg(e);
  } finally {
    if (seq === state.reqSeq) {
      state.loading = false;
      render();
    }
  }
}

// ---------------------------------------------------------------------------
// Eventos (delegados sobre el modal; se enganchan una sola vez)
// ---------------------------------------------------------------------------

function _wire() {
  const modal = document.getElementById('pedidos-mes-modal');
  if (!modal || modal.dataset.pdmWired === '1') return;
  modal.dataset.pdmWired = '1';
  modal.addEventListener('change', (ev) => {
    const t = /** @type {HTMLInputElement} */ (ev.target);
    if (!t || !t.id) return;
    if (t.id === 'pdm-mes' || t.id === 'pdm-anio') {
      const actual = _mesActual();
      state.mes =
        Number(/** @type {HTMLSelectElement} */ (document.getElementById('pdm-mes')).value) ||
        state.mes;
      state.anio =
        Number(/** @type {HTMLSelectElement} */ (document.getElementById('pdm-anio')).value) ||
        state.anio;
      // Año actual con un mes futuro elegido antes: se lleva al mes actual.
      if (state.anio === actual.anio && state.mes > actual.mes) state.mes = actual.mes;
      cargar();
    } else if (t.id === 'pdm-vendedor') {
      state.vendedor = t.value || '';
      _renderLista();
    }
  });
  let deb = 0;
  modal.addEventListener('input', (ev) => {
    const t = /** @type {HTMLInputElement} */ (ev.target);
    if (!t || t.id !== 'pdm-q') return;
    clearTimeout(deb);
    deb = /** @type {any} */ (
      setTimeout(() => {
        state.q = t.value || '';
        _renderLista();
      }, 200)
    );
  });
  const onRow = (/** @type {Event} */ ev) => {
    const tgt = /** @type {HTMLElement} */ (ev.target);
    const row =
      tgt && tgt.closest ? /** @type {HTMLElement|null} */ (tgt.closest('tr.pdm-row')) : null;
    if (!row) return;
    if (ev.type === 'keydown') {
      const k = /** @type {KeyboardEvent} */ (ev).key;
      if (k !== 'Enter' && k !== ' ') return;
      ev.preventDefault();
    }
    _toggle(row.dataset.cc || '');
  };
  const list = document.getElementById('pdm-list');
  if (list) {
    list.addEventListener('click', onRow);
    list.addEventListener('keydown', onRow);
  }
}

// ---------------------------------------------------------------------------
// API pública (stubs en src/main.js + build.js LAZY_CHUNKS)
// ---------------------------------------------------------------------------

window.openPedidosDelMes = function () {
  const modal = document.getElementById('pedidos-mes-modal');
  if (!modal) return;
  const role = _role();
  // v1552 fix: el gate del botón (index.html _pdmOk) y el backend (resolveAlcance)
  // ya habilitan `interno` (VDI: Santiago, Ioannis) — su zona + parejas. Este gate
  // de apertura del modal había quedado sin actualizar y bloqueaba a los VDI antes
  // de llegar al servidor. El alcance real lo sigue acotando pedidosDelMesCF.
  if (role !== 'admin' && role !== 'gerente' && role !== 'vendedor' && role !== 'interno') {
    alert('Tu usuario no tiene acceso a Pedidos del mes. Si lo necesitás, avisale a Mariano.');
    return;
  }
  const uid = _uid();
  if (uid !== state.uid) {
    state.uid = uid;
    state.q = '';
    state.vendedor = '';
    state.anio = 0;
  }
  if (!state.anio) {
    const a = _mesActual();
    state.anio = a.anio;
    state.mes = a.mes;
  }
  modal.classList.add('open');
  _wire();
  cargar();
};

window.closePedidosDelMes = function () {
  const modal = document.getElementById('pedidos-mes-modal');
  if (modal) modal.classList.remove('open');
  state.data = null;
  state.loading = false;
  state.reqSeq++;
};
