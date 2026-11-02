"use strict";
(() => {
  // src/pure/pedidos-del-mes-view.js
  function fmtArs(n) {
    const x = Number(n);
    if (!Number.isFinite(x)) return "-";
    const s = Math.round(Math.abs(x)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    return (x < 0 ? "-$ " : "$ ") + s;
  }
  function fmtUds(n) {
    const x = Number(n);
    if (!Number.isFinite(x)) return "-";
    return Number.isInteger(x) ? String(x) : x.toFixed(2).replace(".", ",");
  }
  function filtrarClientes(clientes, q, vendedor) {
    const qq = String(q || "").trim().toUpperCase();
    const v = String(vendedor || "").trim().toUpperCase();
    return (clientes || []).filter((c) => {
      if (v && String(c.vendedor || "").toUpperCase() !== v) return false;
      if (!qq) return true;
      const hay = [c.nombre, c.cardCode, c.localidad, c.provincia].join(" ").toUpperCase();
      return qq.split(/\s+/).every((t) => hay.includes(t));
    });
  }
  function totalesDe(clientes) {
    const skus = /* @__PURE__ */ new Set();
    let ars = 0;
    for (const c of clientes) {
      ars += Number(c.totalArs) || 0;
      for (const s of c.skus || []) skus.add(s.sku);
    }
    return { clientes: clientes.length, skus: skus.size, ars: Math.round(ars * 100) / 100 };
  }

  // src/domains/pedidos-del-mes.js
  var REGION = "southamerica-east1";
  var MAX_CLIENTES_RENDER = 300;
  var MESES = [
    "Enero",
    "Febrero",
    "Marzo",
    "Abril",
    "Mayo",
    "Junio",
    "Julio",
    "Agosto",
    "Septiembre",
    "Octubre",
    "Noviembre",
    "Diciembre"
  ];
  var ANIO_MIN = 2026;
  var state = {
    anio: 0,
    mes: 0,
    q: "",
    vendedor: "",
    data: null,
    loading: false,
    error: "",
    reqSeq: 0,
    abiertos: /* @__PURE__ */ new Set(),
    uid: null
  };
  function esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function _role() {
    try {
      return (typeof userRole !== "undefined" ? userRole : window.userRole) || null;
    } catch (_e) {
      return (
        /** @type {any} */
        window.userRole || null
      );
    }
  }
  function _uid() {
    try {
      const u = typeof currentUser !== "undefined" ? currentUser : window.currentUser;
      return u && u.uid || null;
    } catch (_e) {
      return null;
    }
  }
  function _mesActual() {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Argentina/Buenos_Aires",
      year: "numeric",
      month: "2-digit"
    }).formatToParts(/* @__PURE__ */ new Date());
    return {
      anio: Number(parts.find((p) => p.type === "year")?.value || 2026),
      mes: Number(parts.find((p) => p.type === "month")?.value || 1)
    };
  }
  function fmtFecha(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
    return m ? m[3] + "/" + m[2] + "/" + m[1] : String(iso || "");
  }
  function _esStaff() {
    const r = _role();
    return r === "admin" || r === "gerente";
  }
  function _renderFiltros() {
    const box = document.getElementById("pdm-filtros");
    if (!box) return;
    const actual = _mesActual();
    let mesOpts = "";
    for (let m = 1; m <= 12; m++) {
      const futuro = state.anio === actual.anio && m > actual.mes;
      if (futuro) continue;
      mesOpts += '<option value="' + m + '"' + (m === state.mes ? " selected" : "") + ">" + MESES[m - 1] + "</option>";
    }
    let anioOpts = "";
    for (let a = actual.anio; a >= ANIO_MIN; a--) {
      anioOpts += '<option value="' + a + '"' + (a === state.anio ? " selected" : "") + ">" + a + "</option>";
    }
    let vendSel = "";
    if (_esStaff()) {
      const vends = /* @__PURE__ */ new Set();
      for (const c of state.data && state.data.clientes || [])
        if (c.vendedor) vends.add(c.vendedor);
      let opts = '<option value="">Todos los vendedores</option>';
      for (const v of [...vends].sort())
        opts += '<option value="' + esc(v) + '"' + (v === state.vendedor ? " selected" : "") + ">" + esc(v) + "</option>";
      vendSel = '<select id="pdm-vendedor" class="pdm-input" aria-label="Vendedor">' + opts + "</select>";
    }
    box.innerHTML = '<select id="pdm-mes" class="pdm-input" aria-label="Mes">' + mesOpts + '</select><select id="pdm-anio" class="pdm-input" aria-label="A\xF1o">' + anioOpts + '</select><input id="pdm-q" class="pdm-input pdm-q" type="search" placeholder="Buscar cliente, c\xF3digo o localidad" value="' + esc(state.q) + '" aria-label="Buscar cliente" />' + vendSel;
  }
  function _renderKpis(lista) {
    const k = document.getElementById("pdm-kpis");
    if (!k) return;
    if (!state.data) {
      k.innerHTML = "";
      return;
    }
    const t = totalesDe(lista);
    const alc = state.data.alcance || {};
    k.innerHTML = '<span class="pdm-kpi"><b>' + t.clientes + "</b> cliente" + (t.clientes === 1 ? "" : "s") + ' con facturaci\xF3n</span><span class="pdm-kpi"><b>' + t.skus + '</b> SKU facturados</span><span class="pdm-kpi pdm-kpi-ars"><b>' + esc(fmtArs(t.ars)) + '</b> facturado</span><span class="pdm-kpi pdm-kpi-scope">' + (alc.nacional ? "Vista nacional" : "Tus clientes") + "</span>";
  }
  function _detalleHtml(c) {
    let h = '<table class="pdm-det">';
    h += '<thead><tr><th>SKU</th><th>Producto</th><th class="num">Cantidad</th><th class="num">Precio unitario</th><th class="num">Subtotal</th><th>Facturas</th></tr></thead><tbody>';
    for (const s of c.skus || []) {
      const docs = (s.facturas || []).map((f) => {
        const nc = f.tipo === "NOTA_CREDITO";
        return '<span class="pdm-doc' + (nc ? " nc" : "") + '" title="' + esc(
          (nc ? "Nota de cr\xE9dito " : "Factura ") + f.numero + " \xB7 " + fmtFecha(f.fecha) + " \xB7 " + fmtUds(f.uds) + " u \xB7 " + fmtArs(f.ars)
        ) + '">' + (nc ? "NC " : "F ") + esc(f.numero) + "</span>";
      }).join(" ");
      h += '<tr><td class="mono">' + esc(s.sku) + "</td><td>" + esc(s.desc || "(sin descripci\xF3n)") + '</td><td class="num">' + esc(fmtUds(s.uds)) + '</td><td class="num">' + (s.precio == null ? "-" : esc(fmtArs(s.precio))) + '</td><td class="num">' + esc(fmtArs(s.ars)) + "</td><td>" + docs + "</td></tr>";
    }
    h += '</tbody><tfoot><tr><td colspan="2">Total: ' + c.skuCount + " SKU \xB7 " + c.facturasCount + " factura" + (c.facturasCount === 1 ? "" : "s");
    if (c.notasCreditoCount)
      h += " \xB7 " + c.notasCreditoCount + " nota" + (c.notasCreditoCount === 1 ? "" : "s") + " de cr\xE9dito";
    h += '</td><td class="num">' + esc(fmtUds(c.totalUds)) + '</td><td></td><td class="num">' + esc(fmtArs(c.totalArs)) + "</td><td></td></tr></tfoot></table>";
    return h;
  }
  function _renderLista() {
    const body = document.getElementById("pdm-list");
    if (!body) return;
    if (state.loading) {
      body.innerHTML = '<div class="pdm-msg">Cargando facturaci\xF3n\u2026</div>';
      _renderKpis([]);
      return;
    }
    if (state.error) {
      body.innerHTML = '<div class="pdm-msg pdm-err">' + esc(state.error) + "</div>";
      _renderKpis([]);
      return;
    }
    if (!state.data) {
      body.innerHTML = "";
      return;
    }
    const lista = filtrarClientes(state.data.clientes, state.q, state.vendedor);
    _renderKpis(lista);
    if (!lista.length) {
      body.innerHTML = '<div class="pdm-msg">' + ((state.data.clientes || []).length ? "Ning\xFAn cliente coincide con la b\xFAsqueda." : "No hay facturaci\xF3n en " + MESES[state.mes - 1] + " " + state.anio + ".") + "</div>";
      return;
    }
    let h = '<table class="pdm-table"><thead><tr><th>Cliente</th><th>Localidad</th><th>Provincia</th><th>Vendedor</th><th class="num">SKU</th><th class="num">Facturado</th></tr></thead><tbody>';
    for (const c of lista.slice(0, MAX_CLIENTES_RENDER)) {
      const abierto = state.abiertos.has(c.cardCode);
      h += '<tr class="pdm-row' + (abierto ? " open" : "") + '" data-cc="' + esc(c.cardCode) + '" tabindex="0" role="button" aria-expanded="' + abierto + '"><td><div class="pdm-cli"><span class="pdm-caret">' + (abierto ? "\u25BC" : "\u25B6") + '</span><div><div class="pdm-nombre">' + esc(c.nombre) + '</div><div class="pdm-code">' + esc(c.cardCode) + "</div></div></div></td><td>" + esc(c.localidad || "-") + "</td><td>" + esc(c.provincia || "-") + "</td><td>" + esc(c.vendedor || "-") + '</td><td class="num">' + c.skuCount + '</td><td class="num pdm-ars">' + esc(fmtArs(c.totalArs)) + "</td></tr>";
      h += '<tr class="pdm-det-row" data-for="' + esc(c.cardCode) + '"' + (abierto ? "" : ' style="display:none"') + '><td colspan="6">' + (abierto ? _detalleHtml(c) : "") + "</td></tr>";
    }
    h += "</tbody></table>";
    if (lista.length > MAX_CLIENTES_RENDER)
      h += '<div class="pdm-msg">Mostrando ' + MAX_CLIENTES_RENDER + " de " + lista.length + " clientes. Us\xE1 el buscador para encontrar el resto.</div>";
    body.innerHTML = h;
  }
  function render() {
    _renderFiltros();
    _renderLista();
  }
  function _toggle(cc) {
    const body = document.getElementById("pdm-list");
    if (!body || !state.data) return;
    const row = (
      /** @type {HTMLElement|null} */
      Array.from(body.querySelectorAll("tr.pdm-row")).find(
        (r) => (
          /** @type {HTMLElement} */
          r.dataset.cc === cc
        )
      ) || null
    );
    const det = row ? (
      /** @type {HTMLElement|null} */
      row.nextElementSibling
    ) : null;
    if (!row || !det) return;
    const abrir = !state.abiertos.has(cc);
    if (abrir) {
      state.abiertos.add(cc);
      const c = (state.data.clientes || []).find((x) => x.cardCode === cc);
      const td = det.querySelector("td");
      if (td && c) td.innerHTML = _detalleHtml(c);
      det.style.display = "";
    } else {
      state.abiertos.delete(cc);
      det.style.display = "none";
    }
    row.classList.toggle("open", abrir);
    row.setAttribute("aria-expanded", String(abrir));
    const caret = row.querySelector(".pdm-caret");
    if (caret) caret.textContent = abrir ? "\u25BC" : "\u25B6";
  }
  function _errorMsg(e) {
    const code = String(e && e.code || "");
    if (code.includes("permission-denied"))
      return "Tu usuario no tiene acceso a Pedidos del mes. Si lo necesit\xE1s, avisale a Mariano.";
    if (code.includes("invalid-argument")) return "El per\xEDodo elegido no es v\xE1lido.";
    return "No pudimos traer la facturaci\xF3n. Volv\xE9 a intentar en un minuto; si sigue, avisale a Mariano.";
  }
  async function cargar() {
    const seq = ++state.reqSeq;
    state.loading = true;
    state.error = "";
    state.data = null;
    state.abiertos = /* @__PURE__ */ new Set();
    render();
    try {
      if (typeof firebase === "undefined" || !firebase.app) throw new Error("firebase no disponible");
      const callable = firebase.app().functions(REGION).httpsCallable("pedidosDelMesCF");
      const res = await callable({ anio: state.anio, mes: state.mes });
      if (seq !== state.reqSeq) return;
      state.data = res && res.data || null;
      if (state.vendedor && !(state.data && state.data.clientes || []).some((c) => c.vendedor === state.vendedor))
        state.vendedor = "";
    } catch (e) {
      if (seq !== state.reqSeq) return;
      console.error("[pedidos-del-mes] pedidosDelMesCF fallo:", e);
      state.error = _errorMsg(e);
    } finally {
      if (seq === state.reqSeq) {
        state.loading = false;
        render();
      }
    }
  }
  function _wire() {
    const modal = document.getElementById("pedidos-mes-modal");
    if (!modal || modal.dataset.pdmWired === "1") return;
    modal.dataset.pdmWired = "1";
    modal.addEventListener("change", (ev) => {
      const t = (
        /** @type {HTMLInputElement} */
        ev.target
      );
      if (!t || !t.id) return;
      if (t.id === "pdm-mes" || t.id === "pdm-anio") {
        const actual = _mesActual();
        state.mes = Number(
          /** @type {HTMLSelectElement} */
          document.getElementById("pdm-mes").value
        ) || state.mes;
        state.anio = Number(
          /** @type {HTMLSelectElement} */
          document.getElementById("pdm-anio").value
        ) || state.anio;
        if (state.anio === actual.anio && state.mes > actual.mes) state.mes = actual.mes;
        cargar();
      } else if (t.id === "pdm-vendedor") {
        state.vendedor = t.value || "";
        _renderLista();
      }
    });
    let deb = 0;
    modal.addEventListener("input", (ev) => {
      const t = (
        /** @type {HTMLInputElement} */
        ev.target
      );
      if (!t || t.id !== "pdm-q") return;
      clearTimeout(deb);
      deb = /** @type {any} */
      setTimeout(() => {
        state.q = t.value || "";
        _renderLista();
      }, 200);
    });
    const onRow = (ev) => {
      const tgt = (
        /** @type {HTMLElement} */
        ev.target
      );
      const row = tgt && tgt.closest ? (
        /** @type {HTMLElement|null} */
        tgt.closest("tr.pdm-row")
      ) : null;
      if (!row) return;
      if (ev.type === "keydown") {
        const k = (
          /** @type {KeyboardEvent} */
          ev.key
        );
        if (k !== "Enter" && k !== " ") return;
        ev.preventDefault();
      }
      _toggle(row.dataset.cc || "");
    };
    const list = document.getElementById("pdm-list");
    if (list) {
      list.addEventListener("click", onRow);
      list.addEventListener("keydown", onRow);
    }
  }
  window.openPedidosDelMes = function() {
    const modal = document.getElementById("pedidos-mes-modal");
    if (!modal) return;
    const role = _role();
    if (role !== "admin" && role !== "gerente" && role !== "vendedor") {
      alert("Tu usuario no tiene acceso a Pedidos del mes. Si lo necesit\xE1s, avisale a Mariano.");
      return;
    }
    const uid = _uid();
    if (uid !== state.uid) {
      state.uid = uid;
      state.q = "";
      state.vendedor = "";
      state.anio = 0;
    }
    if (!state.anio) {
      const a = _mesActual();
      state.anio = a.anio;
      state.mes = a.mes;
    }
    modal.classList.add("open");
    _wire();
    cargar();
  };
  window.closePedidosDelMes = function() {
    const modal = document.getElementById("pedidos-mes-modal");
    if (modal) modal.classList.remove("open");
    state.data = null;
    state.loading = false;
    state.reqSeq++;
  };
})();
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL3B1cmUvcGVkaWRvcy1kZWwtbWVzLXZpZXcuanMiLCAiLi4vc3JjL2RvbWFpbnMvcGVkaWRvcy1kZWwtbWVzLmpzIl0sCiAgInNvdXJjZXNDb250ZW50IjogWyIvLyBAdHMtY2hlY2tcbi8qKlxuICogcGVkaWRvcy1kZWwtbWVzLXZpZXcuanMgKHYxNTQwLCAyMDI2LTExLTAyLCBBUFAtMDYpIFx1MjAxNCBoZWxwZXJzIHB1cm9zIGRlIGxhXG4gKiBwYW50YWxsYSBQZWRpZG9zIGRlbCBtZXMgKHNyYy9kb21haW5zL3BlZGlkb3MtZGVsLW1lcy5qcykuIFNpbiBET00gbmlcbiAqIEZpcmViYXNlOiBmb3JtYXRvIGRlIG5cdTAwRkFtZXJvcyB5IGZpbHRyb3Mgc29icmUgbGEgcmVzcHVlc3RhIGRlXG4gKiBwZWRpZG9zRGVsTWVzQ0YuXG4gKi9cblxuLyoqIEBwYXJhbSB7bnVtYmVyfSBuICovXG5leHBvcnQgZnVuY3Rpb24gZm10QXJzKG4pIHtcbiAgY29uc3QgeCA9IE51bWJlcihuKTtcbiAgaWYgKCFOdW1iZXIuaXNGaW5pdGUoeCkpIHJldHVybiAnLSc7XG4gIGNvbnN0IHMgPSBNYXRoLnJvdW5kKE1hdGguYWJzKHgpKVxuICAgIC50b1N0cmluZygpXG4gICAgLnJlcGxhY2UoL1xcQig/PShcXGR7M30pKyg/IVxcZCkpL2csICcuJyk7XG4gIHJldHVybiAoeCA8IDAgPyAnLSQgJyA6ICckICcpICsgcztcbn1cblxuLyoqIEBwYXJhbSB7bnVtYmVyfSBuICovXG5leHBvcnQgZnVuY3Rpb24gZm10VWRzKG4pIHtcbiAgY29uc3QgeCA9IE51bWJlcihuKTtcbiAgaWYgKCFOdW1iZXIuaXNGaW5pdGUoeCkpIHJldHVybiAnLSc7XG4gIHJldHVybiBOdW1iZXIuaXNJbnRlZ2VyKHgpID8gU3RyaW5nKHgpIDogeC50b0ZpeGVkKDIpLnJlcGxhY2UoJy4nLCAnLCcpO1xufVxuXG4vKipcbiAqIEZpbHRyYSBjbGllbnRlcyBwb3IgYlx1MDBGQXNxdWVkYSAobm9tYnJlLCBjXHUwMEYzZGlnbywgbG9jYWxpZGFkKSB5IHZlbmRlZG9yLiBQdXJvLlxuICogQHBhcmFtIHthbnlbXX0gY2xpZW50ZXNcbiAqIEBwYXJhbSB7c3RyaW5nfSBxXG4gKiBAcGFyYW0ge3N0cmluZ30gdmVuZGVkb3JcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGZpbHRyYXJDbGllbnRlcyhjbGllbnRlcywgcSwgdmVuZGVkb3IpIHtcbiAgY29uc3QgcXEgPSBTdHJpbmcocSB8fCAnJylcbiAgICAudHJpbSgpXG4gICAgLnRvVXBwZXJDYXNlKCk7XG4gIGNvbnN0IHYgPSBTdHJpbmcodmVuZGVkb3IgfHwgJycpXG4gICAgLnRyaW0oKVxuICAgIC50b1VwcGVyQ2FzZSgpO1xuICByZXR1cm4gKGNsaWVudGVzIHx8IFtdKS5maWx0ZXIoKGMpID0+IHtcbiAgICBpZiAodiAmJiBTdHJpbmcoYy52ZW5kZWRvciB8fCAnJykudG9VcHBlckNhc2UoKSAhPT0gdikgcmV0dXJuIGZhbHNlO1xuICAgIGlmICghcXEpIHJldHVybiB0cnVlO1xuICAgIGNvbnN0IGhheSA9IFtjLm5vbWJyZSwgYy5jYXJkQ29kZSwgYy5sb2NhbGlkYWQsIGMucHJvdmluY2lhXS5qb2luKCcgJykudG9VcHBlckNhc2UoKTtcbiAgICByZXR1cm4gcXEuc3BsaXQoL1xccysvKS5ldmVyeSgodCkgPT4gaGF5LmluY2x1ZGVzKHQpKTtcbiAgfSk7XG59XG5cbi8qKlxuICogVG90YWxlcyBkZSBsYSBsaXN0YSBmaWx0cmFkYSAobG9zIEtQSSBkZWwgZW5jYWJlemFkbyBzaWd1ZW4gYWwgZmlsdHJvKS5cbiAqIEBwYXJhbSB7YW55W119IGNsaWVudGVzXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiB0b3RhbGVzRGUoY2xpZW50ZXMpIHtcbiAgY29uc3Qgc2t1cyA9IG5ldyBTZXQoKTtcbiAgbGV0IGFycyA9IDA7XG4gIGZvciAoY29uc3QgYyBvZiBjbGllbnRlcykge1xuICAgIGFycyArPSBOdW1iZXIoYy50b3RhbEFycykgfHwgMDtcbiAgICBmb3IgKGNvbnN0IHMgb2YgYy5za3VzIHx8IFtdKSBza3VzLmFkZChzLnNrdSk7XG4gIH1cbiAgcmV0dXJuIHsgY2xpZW50ZXM6IGNsaWVudGVzLmxlbmd0aCwgc2t1czogc2t1cy5zaXplLCBhcnM6IE1hdGgucm91bmQoYXJzICogMTAwKSAvIDEwMCB9O1xufVxuIiwgIi8vIEB0cy1ub2NoZWNrXG4vKipcbiAqIFBlZGlkb3MgZGVsIG1lcyAodjE1NDAsIDIwMjYtMTEtMDIsIEFQUC0wNikgXHUyMDE0IGNodW5rIGxhenkuXG4gKlxuICogRmFjdHVyYWNpXHUwMEYzbiBlZmVjdGl2YW1lbnRlIGVtaXRpZGEgcG9yIGNsaWVudGUgeSBTS1UgZW4gdW4gbWVzLiBMb3MgZGF0b3NcbiAqIHZpZW5lbiBTT0xPIGRlbCBjYWxsYWJsZSBgcGVkaWRvc0RlbE1lc0NGYCAoQmlnUXVlcnkgdl92ZW50YXNfbGluZWFzOlxuICogZmFjdHVyYXMgeSBub3RhcyBkZSBjclx1MDBFOWRpdG8gZGUgU0FQKS4gTm8gbGVlIHBlZGlkb3MsIGxpc3RhIGRlIGVzcGVyYSxcbiAqIGJhY2tvcmRlciBuaSBzdG9jayBhc2lnbmFkbzogbmFkYSBxdWUgbm8gZXN0XHUwMEU5IGZhY3R1cmFkbyBwdWVkZSBhcGFyZWNlci5cbiAqXG4gKiBFbCBhbGNhbmNlIGxvIGRlY2lkZSBlbCBzZXJ2aWRvcjogZWwgdmVuZGVkb3IgcmVjaWJlIHNvbG8gc3VzIGNsaWVudGVzO1xuICogYWRtaW4vZ2VyZW50ZSwgdG9kbyBlbCBwYVx1MDBFRHMuIEVsIGZpbHRybyBkZSB2ZW5kZWRvciBkZSBlc3RhIHBhbnRhbGxhIGVzXG4gKiBzb2xvIHBhcmEgYWRtaW4vZ2VyZW50ZSAoZmlsdHJhIHNvYnJlIGRhdG9zIHF1ZSB5YSB0aWVuZSBwZXJtaXNvIGRlIHZlcikuXG4gKlxuICogSW50ZXJhY2NpXHUwMEYzbjogbWlzbW8gcGF0clx1MDBGM24gcXVlIFN0b2NrIEFzaWduYWRvIChmaWxhIGNvbiBcdTI1QjYsIGNsaWMgZGVzcGxpZWdhXG4gKiBkZWJham8gbGEgdGFibGEgZGUgU0tVOyB2YXJpYXMgYWJpZXJ0YXMgYSBsYSB2ZXopLlxuICpcbiAqIEluZm9ybWU6IGRvY3MvYXVkaXRvcmlhLzQ5X1BFRElET1NfREVMX01FUy5tZC5cbiAqL1xuXG5pbXBvcnQgeyBmaWx0cmFyQ2xpZW50ZXMsIGZtdEFycywgZm10VWRzLCB0b3RhbGVzRGUgfSBmcm9tICcuLi9wdXJlL3BlZGlkb3MtZGVsLW1lcy12aWV3LmpzJztcblxuY29uc3QgUkVHSU9OID0gJ3NvdXRoYW1lcmljYS1lYXN0MSc7XG5jb25zdCBNQVhfQ0xJRU5URVNfUkVOREVSID0gMzAwO1xuY29uc3QgTUVTRVMgPSBbXG4gICdFbmVybycsXG4gICdGZWJyZXJvJyxcbiAgJ01hcnpvJyxcbiAgJ0FicmlsJyxcbiAgJ01heW8nLFxuICAnSnVuaW8nLFxuICAnSnVsaW8nLFxuICAnQWdvc3RvJyxcbiAgJ1NlcHRpZW1icmUnLFxuICAnT2N0dWJyZScsXG4gICdOb3ZpZW1icmUnLFxuICAnRGljaWVtYnJlJyxcbl07XG5jb25zdCBBTklPX01JTiA9IDIwMjY7IC8vIHByaW1lciBhXHUwMEYxbyBjb24gZmFjdHVyYWNpXHUwMEYzbiBzaW5jcm9uaXphZGEgZW4gQmlnUXVlcnlcblxuLyoqIEB0eXBlIHt7IGFuaW86IG51bWJlciwgbWVzOiBudW1iZXIsIHE6IHN0cmluZywgdmVuZGVkb3I6IHN0cmluZywgZGF0YTogYW55LCBsb2FkaW5nOiBib29sZWFuLFxuICogICBlcnJvcjogc3RyaW5nLCByZXFTZXE6IG51bWJlciwgYWJpZXJ0b3M6IFNldDxzdHJpbmc+LCB1aWQ6IHN0cmluZ3xudWxsIH19ICovXG5jb25zdCBzdGF0ZSA9IHtcbiAgYW5pbzogMCxcbiAgbWVzOiAwLFxuICBxOiAnJyxcbiAgdmVuZGVkb3I6ICcnLFxuICBkYXRhOiBudWxsLFxuICBsb2FkaW5nOiBmYWxzZSxcbiAgZXJyb3I6ICcnLFxuICByZXFTZXE6IDAsXG4gIGFiaWVydG9zOiBuZXcgU2V0KCksXG4gIHVpZDogbnVsbCxcbn07XG5cbi8qKiBAcGFyYW0ge2FueX0gcyAqL1xuZnVuY3Rpb24gZXNjKHMpIHtcbiAgcmV0dXJuIFN0cmluZyhzID09IG51bGwgPyAnJyA6IHMpXG4gICAgLnJlcGxhY2UoLyYvZywgJyZhbXA7JylcbiAgICAucmVwbGFjZSgvPC9nLCAnJmx0OycpXG4gICAgLnJlcGxhY2UoLz4vZywgJyZndDsnKVxuICAgIC5yZXBsYWNlKC9cIi9nLCAnJnF1b3Q7JylcbiAgICAucmVwbGFjZSgvJy9nLCAnJiMzOTsnKTtcbn1cblxuZnVuY3Rpb24gX3JvbGUoKSB7XG4gIHRyeSB7XG4gICAgcmV0dXJuICh0eXBlb2YgdXNlclJvbGUgIT09ICd1bmRlZmluZWQnID8gdXNlclJvbGUgOiB3aW5kb3cudXNlclJvbGUpIHx8IG51bGw7XG4gIH0gY2F0Y2ggKF9lKSB7XG4gICAgcmV0dXJuIC8qKiBAdHlwZSB7YW55fSAqLyAod2luZG93KS51c2VyUm9sZSB8fCBudWxsO1xuICB9XG59XG5cbmZ1bmN0aW9uIF91aWQoKSB7XG4gIHRyeSB7XG4gICAgY29uc3QgdSA9IHR5cGVvZiBjdXJyZW50VXNlciAhPT0gJ3VuZGVmaW5lZCcgPyBjdXJyZW50VXNlciA6IHdpbmRvdy5jdXJyZW50VXNlcjtcbiAgICByZXR1cm4gKHUgJiYgdS51aWQpIHx8IG51bGw7XG4gIH0gY2F0Y2ggKF9lKSB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cbn1cblxuLyoqIE1lcyBhY3R1YWwgZW4gaG9yYSBBcmdlbnRpbmEuICovXG5mdW5jdGlvbiBfbWVzQWN0dWFsKCkge1xuICBjb25zdCBwYXJ0cyA9IG5ldyBJbnRsLkRhdGVUaW1lRm9ybWF0KCdlbi1DQScsIHtcbiAgICB0aW1lWm9uZTogJ0FtZXJpY2EvQXJnZW50aW5hL0J1ZW5vc19BaXJlcycsXG4gICAgeWVhcjogJ251bWVyaWMnLFxuICAgIG1vbnRoOiAnMi1kaWdpdCcsXG4gIH0pLmZvcm1hdFRvUGFydHMobmV3IERhdGUoKSk7XG4gIHJldHVybiB7XG4gICAgYW5pbzogTnVtYmVyKHBhcnRzLmZpbmQoKHApID0+IHAudHlwZSA9PT0gJ3llYXInKT8udmFsdWUgfHwgMjAyNiksXG4gICAgbWVzOiBOdW1iZXIocGFydHMuZmluZCgocCkgPT4gcC50eXBlID09PSAnbW9udGgnKT8udmFsdWUgfHwgMSksXG4gIH07XG59XG5cbi8qKiBAcGFyYW0ge3N0cmluZ30gaXNvIFlZWVktTU0tREQgKi9cbmZ1bmN0aW9uIGZtdEZlY2hhKGlzbykge1xuICBjb25zdCBtID0gL14oXFxkezR9KS0oXFxkezJ9KS0oXFxkezJ9KS8uZXhlYyhTdHJpbmcoaXNvIHx8ICcnKSk7XG4gIHJldHVybiBtID8gbVszXSArICcvJyArIG1bMl0gKyAnLycgKyBtWzFdIDogU3RyaW5nKGlzbyB8fCAnJyk7XG59XG5cbmZ1bmN0aW9uIF9lc1N0YWZmKCkge1xuICBjb25zdCByID0gX3JvbGUoKTtcbiAgcmV0dXJuIHIgPT09ICdhZG1pbicgfHwgciA9PT0gJ2dlcmVudGUnO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFJlbmRlclxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmZ1bmN0aW9uIF9yZW5kZXJGaWx0cm9zKCkge1xuICBjb25zdCBib3ggPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgncGRtLWZpbHRyb3MnKTtcbiAgaWYgKCFib3gpIHJldHVybjtcbiAgY29uc3QgYWN0dWFsID0gX21lc0FjdHVhbCgpO1xuICBsZXQgbWVzT3B0cyA9ICcnO1xuICBmb3IgKGxldCBtID0gMTsgbSA8PSAxMjsgbSsrKSB7XG4gICAgY29uc3QgZnV0dXJvID0gc3RhdGUuYW5pbyA9PT0gYWN0dWFsLmFuaW8gJiYgbSA+IGFjdHVhbC5tZXM7XG4gICAgaWYgKGZ1dHVybykgY29udGludWU7XG4gICAgbWVzT3B0cyArPVxuICAgICAgJzxvcHRpb24gdmFsdWU9XCInICtcbiAgICAgIG0gK1xuICAgICAgJ1wiJyArXG4gICAgICAobSA9PT0gc3RhdGUubWVzID8gJyBzZWxlY3RlZCcgOiAnJykgK1xuICAgICAgJz4nICtcbiAgICAgIE1FU0VTW20gLSAxXSArXG4gICAgICAnPC9vcHRpb24+JztcbiAgfVxuICBsZXQgYW5pb09wdHMgPSAnJztcbiAgZm9yIChsZXQgYSA9IGFjdHVhbC5hbmlvOyBhID49IEFOSU9fTUlOOyBhLS0pIHtcbiAgICBhbmlvT3B0cyArPVxuICAgICAgJzxvcHRpb24gdmFsdWU9XCInICsgYSArICdcIicgKyAoYSA9PT0gc3RhdGUuYW5pbyA/ICcgc2VsZWN0ZWQnIDogJycpICsgJz4nICsgYSArICc8L29wdGlvbj4nO1xuICB9XG4gIGxldCB2ZW5kU2VsID0gJyc7XG4gIGlmIChfZXNTdGFmZigpKSB7XG4gICAgY29uc3QgdmVuZHMgPSBuZXcgU2V0KCk7XG4gICAgZm9yIChjb25zdCBjIG9mIChzdGF0ZS5kYXRhICYmIHN0YXRlLmRhdGEuY2xpZW50ZXMpIHx8IFtdKVxuICAgICAgaWYgKGMudmVuZGVkb3IpIHZlbmRzLmFkZChjLnZlbmRlZG9yKTtcbiAgICBsZXQgb3B0cyA9ICc8b3B0aW9uIHZhbHVlPVwiXCI+VG9kb3MgbG9zIHZlbmRlZG9yZXM8L29wdGlvbj4nO1xuICAgIGZvciAoY29uc3QgdiBvZiBbLi4udmVuZHNdLnNvcnQoKSlcbiAgICAgIG9wdHMgKz1cbiAgICAgICAgJzxvcHRpb24gdmFsdWU9XCInICtcbiAgICAgICAgZXNjKHYpICtcbiAgICAgICAgJ1wiJyArXG4gICAgICAgICh2ID09PSBzdGF0ZS52ZW5kZWRvciA/ICcgc2VsZWN0ZWQnIDogJycpICtcbiAgICAgICAgJz4nICtcbiAgICAgICAgZXNjKHYpICtcbiAgICAgICAgJzwvb3B0aW9uPic7XG4gICAgdmVuZFNlbCA9XG4gICAgICAnPHNlbGVjdCBpZD1cInBkbS12ZW5kZWRvclwiIGNsYXNzPVwicGRtLWlucHV0XCIgYXJpYS1sYWJlbD1cIlZlbmRlZG9yXCI+JyArIG9wdHMgKyAnPC9zZWxlY3Q+JztcbiAgfVxuICBib3guaW5uZXJIVE1MID1cbiAgICAnPHNlbGVjdCBpZD1cInBkbS1tZXNcIiBjbGFzcz1cInBkbS1pbnB1dFwiIGFyaWEtbGFiZWw9XCJNZXNcIj4nICtcbiAgICBtZXNPcHRzICtcbiAgICAnPC9zZWxlY3Q+JyArXG4gICAgJzxzZWxlY3QgaWQ9XCJwZG0tYW5pb1wiIGNsYXNzPVwicGRtLWlucHV0XCIgYXJpYS1sYWJlbD1cIkFcdTAwRjFvXCI+JyArXG4gICAgYW5pb09wdHMgK1xuICAgICc8L3NlbGVjdD4nICtcbiAgICAnPGlucHV0IGlkPVwicGRtLXFcIiBjbGFzcz1cInBkbS1pbnB1dCBwZG0tcVwiIHR5cGU9XCJzZWFyY2hcIiBwbGFjZWhvbGRlcj1cIkJ1c2NhciBjbGllbnRlLCBjXHUwMEYzZGlnbyBvIGxvY2FsaWRhZFwiIHZhbHVlPVwiJyArXG4gICAgZXNjKHN0YXRlLnEpICtcbiAgICAnXCIgYXJpYS1sYWJlbD1cIkJ1c2NhciBjbGllbnRlXCIgLz4nICtcbiAgICB2ZW5kU2VsO1xufVxuXG5mdW5jdGlvbiBfcmVuZGVyS3BpcyhsaXN0YSkge1xuICBjb25zdCBrID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3BkbS1rcGlzJyk7XG4gIGlmICghaykgcmV0dXJuO1xuICBpZiAoIXN0YXRlLmRhdGEpIHtcbiAgICBrLmlubmVySFRNTCA9ICcnO1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCB0ID0gdG90YWxlc0RlKGxpc3RhKTtcbiAgY29uc3QgYWxjID0gc3RhdGUuZGF0YS5hbGNhbmNlIHx8IHt9O1xuICBrLmlubmVySFRNTCA9XG4gICAgJzxzcGFuIGNsYXNzPVwicGRtLWtwaVwiPjxiPicgK1xuICAgIHQuY2xpZW50ZXMgK1xuICAgICc8L2I+IGNsaWVudGUnICtcbiAgICAodC5jbGllbnRlcyA9PT0gMSA/ICcnIDogJ3MnKSArXG4gICAgJyBjb24gZmFjdHVyYWNpXHUwMEYzbjwvc3Bhbj4nICtcbiAgICAnPHNwYW4gY2xhc3M9XCJwZG0ta3BpXCI+PGI+JyArXG4gICAgdC5za3VzICtcbiAgICAnPC9iPiBTS1UgZmFjdHVyYWRvczwvc3Bhbj4nICtcbiAgICAnPHNwYW4gY2xhc3M9XCJwZG0ta3BpIHBkbS1rcGktYXJzXCI+PGI+JyArXG4gICAgZXNjKGZtdEFycyh0LmFycykpICtcbiAgICAnPC9iPiBmYWN0dXJhZG88L3NwYW4+JyArXG4gICAgJzxzcGFuIGNsYXNzPVwicGRtLWtwaSBwZG0ta3BpLXNjb3BlXCI+JyArXG4gICAgKGFsYy5uYWNpb25hbCA/ICdWaXN0YSBuYWNpb25hbCcgOiAnVHVzIGNsaWVudGVzJykgK1xuICAgICc8L3NwYW4+Jztcbn1cblxuLyoqIEBwYXJhbSB7YW55fSBjICovXG5mdW5jdGlvbiBfZGV0YWxsZUh0bWwoYykge1xuICBsZXQgaCA9ICc8dGFibGUgY2xhc3M9XCJwZG0tZGV0XCI+JztcbiAgaCArPVxuICAgICc8dGhlYWQ+PHRyPjx0aD5TS1U8L3RoPjx0aD5Qcm9kdWN0bzwvdGg+PHRoIGNsYXNzPVwibnVtXCI+Q2FudGlkYWQ8L3RoPjx0aCBjbGFzcz1cIm51bVwiPlByZWNpbyB1bml0YXJpbzwvdGg+PHRoIGNsYXNzPVwibnVtXCI+U3VidG90YWw8L3RoPjx0aD5GYWN0dXJhczwvdGg+PC90cj48L3RoZWFkPjx0Ym9keT4nO1xuICBmb3IgKGNvbnN0IHMgb2YgYy5za3VzIHx8IFtdKSB7XG4gICAgY29uc3QgZG9jcyA9IChzLmZhY3R1cmFzIHx8IFtdKVxuICAgICAgLm1hcCgoZikgPT4ge1xuICAgICAgICBjb25zdCBuYyA9IGYudGlwbyA9PT0gJ05PVEFfQ1JFRElUTyc7XG4gICAgICAgIHJldHVybiAoXG4gICAgICAgICAgJzxzcGFuIGNsYXNzPVwicGRtLWRvYycgK1xuICAgICAgICAgIChuYyA/ICcgbmMnIDogJycpICtcbiAgICAgICAgICAnXCIgdGl0bGU9XCInICtcbiAgICAgICAgICBlc2MoXG4gICAgICAgICAgICAobmMgPyAnTm90YSBkZSBjclx1MDBFOWRpdG8gJyA6ICdGYWN0dXJhICcpICtcbiAgICAgICAgICAgICAgZi5udW1lcm8gK1xuICAgICAgICAgICAgICAnIFx1MDBCNyAnICtcbiAgICAgICAgICAgICAgZm10RmVjaGEoZi5mZWNoYSkgK1xuICAgICAgICAgICAgICAnIFx1MDBCNyAnICtcbiAgICAgICAgICAgICAgZm10VWRzKGYudWRzKSArXG4gICAgICAgICAgICAgICcgdSBcdTAwQjcgJyArXG4gICAgICAgICAgICAgIGZtdEFycyhmLmFycylcbiAgICAgICAgICApICtcbiAgICAgICAgICAnXCI+JyArXG4gICAgICAgICAgKG5jID8gJ05DICcgOiAnRiAnKSArXG4gICAgICAgICAgZXNjKGYubnVtZXJvKSArXG4gICAgICAgICAgJzwvc3Bhbj4nXG4gICAgICAgICk7XG4gICAgICB9KVxuICAgICAgLmpvaW4oJyAnKTtcbiAgICBoICs9XG4gICAgICAnPHRyPjx0ZCBjbGFzcz1cIm1vbm9cIj4nICtcbiAgICAgIGVzYyhzLnNrdSkgK1xuICAgICAgJzwvdGQ+PHRkPicgK1xuICAgICAgZXNjKHMuZGVzYyB8fCAnKHNpbiBkZXNjcmlwY2lcdTAwRjNuKScpICtcbiAgICAgICc8L3RkPjx0ZCBjbGFzcz1cIm51bVwiPicgK1xuICAgICAgZXNjKGZtdFVkcyhzLnVkcykpICtcbiAgICAgICc8L3RkPjx0ZCBjbGFzcz1cIm51bVwiPicgK1xuICAgICAgKHMucHJlY2lvID09IG51bGwgPyAnLScgOiBlc2MoZm10QXJzKHMucHJlY2lvKSkpICtcbiAgICAgICc8L3RkPjx0ZCBjbGFzcz1cIm51bVwiPicgK1xuICAgICAgZXNjKGZtdEFycyhzLmFycykpICtcbiAgICAgICc8L3RkPjx0ZD4nICtcbiAgICAgIGRvY3MgK1xuICAgICAgJzwvdGQ+PC90cj4nO1xuICB9XG4gIGggKz1cbiAgICAnPC90Ym9keT48dGZvb3Q+PHRyPjx0ZCBjb2xzcGFuPVwiMlwiPlRvdGFsOiAnICtcbiAgICBjLnNrdUNvdW50ICtcbiAgICAnIFNLVSBcdTAwQjcgJyArXG4gICAgYy5mYWN0dXJhc0NvdW50ICtcbiAgICAnIGZhY3R1cmEnICtcbiAgICAoYy5mYWN0dXJhc0NvdW50ID09PSAxID8gJycgOiAncycpO1xuICBpZiAoYy5ub3Rhc0NyZWRpdG9Db3VudClcbiAgICBoICs9XG4gICAgICAnIFx1MDBCNyAnICtcbiAgICAgIGMubm90YXNDcmVkaXRvQ291bnQgK1xuICAgICAgJyBub3RhJyArXG4gICAgICAoYy5ub3Rhc0NyZWRpdG9Db3VudCA9PT0gMSA/ICcnIDogJ3MnKSArXG4gICAgICAnIGRlIGNyXHUwMEU5ZGl0byc7XG4gIGggKz1cbiAgICAnPC90ZD48dGQgY2xhc3M9XCJudW1cIj4nICtcbiAgICBlc2MoZm10VWRzKGMudG90YWxVZHMpKSArXG4gICAgJzwvdGQ+PHRkPjwvdGQ+PHRkIGNsYXNzPVwibnVtXCI+JyArXG4gICAgZXNjKGZtdEFycyhjLnRvdGFsQXJzKSkgK1xuICAgICc8L3RkPjx0ZD48L3RkPjwvdHI+PC90Zm9vdD48L3RhYmxlPic7XG4gIHJldHVybiBoO1xufVxuXG5mdW5jdGlvbiBfcmVuZGVyTGlzdGEoKSB7XG4gIGNvbnN0IGJvZHkgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgncGRtLWxpc3QnKTtcbiAgaWYgKCFib2R5KSByZXR1cm47XG4gIGlmIChzdGF0ZS5sb2FkaW5nKSB7XG4gICAgYm9keS5pbm5lckhUTUwgPSAnPGRpdiBjbGFzcz1cInBkbS1tc2dcIj5DYXJnYW5kbyBmYWN0dXJhY2lcdTAwRjNuXHUyMDI2PC9kaXY+JztcbiAgICBfcmVuZGVyS3BpcyhbXSk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGlmIChzdGF0ZS5lcnJvcikge1xuICAgIGJvZHkuaW5uZXJIVE1MID0gJzxkaXYgY2xhc3M9XCJwZG0tbXNnIHBkbS1lcnJcIj4nICsgZXNjKHN0YXRlLmVycm9yKSArICc8L2Rpdj4nO1xuICAgIF9yZW5kZXJLcGlzKFtdKTtcbiAgICByZXR1cm47XG4gIH1cbiAgaWYgKCFzdGF0ZS5kYXRhKSB7XG4gICAgYm9keS5pbm5lckhUTUwgPSAnJztcbiAgICByZXR1cm47XG4gIH1cbiAgY29uc3QgbGlzdGEgPSBmaWx0cmFyQ2xpZW50ZXMoc3RhdGUuZGF0YS5jbGllbnRlcywgc3RhdGUucSwgc3RhdGUudmVuZGVkb3IpO1xuICBfcmVuZGVyS3BpcyhsaXN0YSk7XG4gIGlmICghbGlzdGEubGVuZ3RoKSB7XG4gICAgYm9keS5pbm5lckhUTUwgPVxuICAgICAgJzxkaXYgY2xhc3M9XCJwZG0tbXNnXCI+JyArXG4gICAgICAoKHN0YXRlLmRhdGEuY2xpZW50ZXMgfHwgW10pLmxlbmd0aFxuICAgICAgICA/ICdOaW5nXHUwMEZBbiBjbGllbnRlIGNvaW5jaWRlIGNvbiBsYSBiXHUwMEZBc3F1ZWRhLidcbiAgICAgICAgOiAnTm8gaGF5IGZhY3R1cmFjaVx1MDBGM24gZW4gJyArIE1FU0VTW3N0YXRlLm1lcyAtIDFdICsgJyAnICsgc3RhdGUuYW5pbyArICcuJykgK1xuICAgICAgJzwvZGl2Pic7XG4gICAgcmV0dXJuO1xuICB9XG4gIGxldCBoID1cbiAgICAnPHRhYmxlIGNsYXNzPVwicGRtLXRhYmxlXCI+PHRoZWFkPjx0cj48dGg+Q2xpZW50ZTwvdGg+PHRoPkxvY2FsaWRhZDwvdGg+PHRoPlByb3ZpbmNpYTwvdGg+PHRoPlZlbmRlZG9yPC90aD48dGggY2xhc3M9XCJudW1cIj5TS1U8L3RoPjx0aCBjbGFzcz1cIm51bVwiPkZhY3R1cmFkbzwvdGg+PC90cj48L3RoZWFkPjx0Ym9keT4nO1xuICBmb3IgKGNvbnN0IGMgb2YgbGlzdGEuc2xpY2UoMCwgTUFYX0NMSUVOVEVTX1JFTkRFUikpIHtcbiAgICBjb25zdCBhYmllcnRvID0gc3RhdGUuYWJpZXJ0b3MuaGFzKGMuY2FyZENvZGUpO1xuICAgIGggKz1cbiAgICAgICc8dHIgY2xhc3M9XCJwZG0tcm93JyArXG4gICAgICAoYWJpZXJ0byA/ICcgb3BlbicgOiAnJykgK1xuICAgICAgJ1wiIGRhdGEtY2M9XCInICtcbiAgICAgIGVzYyhjLmNhcmRDb2RlKSArXG4gICAgICAnXCIgdGFiaW5kZXg9XCIwXCIgcm9sZT1cImJ1dHRvblwiIGFyaWEtZXhwYW5kZWQ9XCInICtcbiAgICAgIGFiaWVydG8gK1xuICAgICAgJ1wiPjx0ZD48ZGl2IGNsYXNzPVwicGRtLWNsaVwiPjxzcGFuIGNsYXNzPVwicGRtLWNhcmV0XCI+JyArXG4gICAgICAoYWJpZXJ0byA/ICdcdTI1QkMnIDogJ1x1MjVCNicpICtcbiAgICAgICc8L3NwYW4+PGRpdj48ZGl2IGNsYXNzPVwicGRtLW5vbWJyZVwiPicgK1xuICAgICAgZXNjKGMubm9tYnJlKSArXG4gICAgICAnPC9kaXY+PGRpdiBjbGFzcz1cInBkbS1jb2RlXCI+JyArXG4gICAgICBlc2MoYy5jYXJkQ29kZSkgK1xuICAgICAgJzwvZGl2PjwvZGl2PjwvZGl2PjwvdGQ+PHRkPicgK1xuICAgICAgZXNjKGMubG9jYWxpZGFkIHx8ICctJykgK1xuICAgICAgJzwvdGQ+PHRkPicgK1xuICAgICAgZXNjKGMucHJvdmluY2lhIHx8ICctJykgK1xuICAgICAgJzwvdGQ+PHRkPicgK1xuICAgICAgZXNjKGMudmVuZGVkb3IgfHwgJy0nKSArXG4gICAgICAnPC90ZD48dGQgY2xhc3M9XCJudW1cIj4nICtcbiAgICAgIGMuc2t1Q291bnQgK1xuICAgICAgJzwvdGQ+PHRkIGNsYXNzPVwibnVtIHBkbS1hcnNcIj4nICtcbiAgICAgIGVzYyhmbXRBcnMoYy50b3RhbEFycykpICtcbiAgICAgICc8L3RkPjwvdHI+JztcbiAgICBoICs9XG4gICAgICAnPHRyIGNsYXNzPVwicGRtLWRldC1yb3dcIiBkYXRhLWZvcj1cIicgK1xuICAgICAgZXNjKGMuY2FyZENvZGUpICtcbiAgICAgICdcIicgK1xuICAgICAgKGFiaWVydG8gPyAnJyA6ICcgc3R5bGU9XCJkaXNwbGF5Om5vbmVcIicpICtcbiAgICAgICc+PHRkIGNvbHNwYW49XCI2XCI+JyArXG4gICAgICAoYWJpZXJ0byA/IF9kZXRhbGxlSHRtbChjKSA6ICcnKSArXG4gICAgICAnPC90ZD48L3RyPic7XG4gIH1cbiAgaCArPSAnPC90Ym9keT48L3RhYmxlPic7XG4gIGlmIChsaXN0YS5sZW5ndGggPiBNQVhfQ0xJRU5URVNfUkVOREVSKVxuICAgIGggKz1cbiAgICAgICc8ZGl2IGNsYXNzPVwicGRtLW1zZ1wiPk1vc3RyYW5kbyAnICtcbiAgICAgIE1BWF9DTElFTlRFU19SRU5ERVIgK1xuICAgICAgJyBkZSAnICtcbiAgICAgIGxpc3RhLmxlbmd0aCArXG4gICAgICAnIGNsaWVudGVzLiBVc1x1MDBFMSBlbCBidXNjYWRvciBwYXJhIGVuY29udHJhciBlbCByZXN0by48L2Rpdj4nO1xuICBib2R5LmlubmVySFRNTCA9IGg7XG59XG5cbmZ1bmN0aW9uIHJlbmRlcigpIHtcbiAgX3JlbmRlckZpbHRyb3MoKTtcbiAgX3JlbmRlckxpc3RhKCk7XG59XG5cbi8qKiBAcGFyYW0ge3N0cmluZ30gY2MgKi9cbmZ1bmN0aW9uIF90b2dnbGUoY2MpIHtcbiAgY29uc3QgYm9keSA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdwZG0tbGlzdCcpO1xuICBpZiAoIWJvZHkgfHwgIXN0YXRlLmRhdGEpIHJldHVybjtcbiAgY29uc3Qgcm93ID0gLyoqIEB0eXBlIHtIVE1MRWxlbWVudHxudWxsfSAqLyAoXG4gICAgQXJyYXkuZnJvbShib2R5LnF1ZXJ5U2VsZWN0b3JBbGwoJ3RyLnBkbS1yb3cnKSkuZmluZChcbiAgICAgIChyKSA9PiAvKiogQHR5cGUge0hUTUxFbGVtZW50fSAqLyAocikuZGF0YXNldC5jYyA9PT0gY2NcbiAgICApIHx8IG51bGxcbiAgKTtcbiAgY29uc3QgZGV0ID0gcm93ID8gLyoqIEB0eXBlIHtIVE1MRWxlbWVudHxudWxsfSAqLyAocm93Lm5leHRFbGVtZW50U2libGluZykgOiBudWxsO1xuICBpZiAoIXJvdyB8fCAhZGV0KSByZXR1cm47XG4gIGNvbnN0IGFicmlyID0gIXN0YXRlLmFiaWVydG9zLmhhcyhjYyk7XG4gIGlmIChhYnJpcikge1xuICAgIHN0YXRlLmFiaWVydG9zLmFkZChjYyk7XG4gICAgY29uc3QgYyA9IChzdGF0ZS5kYXRhLmNsaWVudGVzIHx8IFtdKS5maW5kKCh4KSA9PiB4LmNhcmRDb2RlID09PSBjYyk7XG4gICAgY29uc3QgdGQgPSBkZXQucXVlcnlTZWxlY3RvcigndGQnKTtcbiAgICBpZiAodGQgJiYgYykgdGQuaW5uZXJIVE1MID0gX2RldGFsbGVIdG1sKGMpO1xuICAgIGRldC5zdHlsZS5kaXNwbGF5ID0gJyc7XG4gIH0gZWxzZSB7XG4gICAgc3RhdGUuYWJpZXJ0b3MuZGVsZXRlKGNjKTtcbiAgICBkZXQuc3R5bGUuZGlzcGxheSA9ICdub25lJztcbiAgfVxuICByb3cuY2xhc3NMaXN0LnRvZ2dsZSgnb3BlbicsIGFicmlyKTtcbiAgcm93LnNldEF0dHJpYnV0ZSgnYXJpYS1leHBhbmRlZCcsIFN0cmluZyhhYnJpcikpO1xuICBjb25zdCBjYXJldCA9IHJvdy5xdWVyeVNlbGVjdG9yKCcucGRtLWNhcmV0Jyk7XG4gIGlmIChjYXJldCkgY2FyZXQudGV4dENvbnRlbnQgPSBhYnJpciA/ICdcdTI1QkMnIDogJ1x1MjVCNic7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gRGF0b3Ncbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKiogQHBhcmFtIHthbnl9IGUgKi9cbmZ1bmN0aW9uIF9lcnJvck1zZyhlKSB7XG4gIGNvbnN0IGNvZGUgPSBTdHJpbmcoKGUgJiYgZS5jb2RlKSB8fCAnJyk7XG4gIGlmIChjb2RlLmluY2x1ZGVzKCdwZXJtaXNzaW9uLWRlbmllZCcpKVxuICAgIHJldHVybiAnVHUgdXN1YXJpbyBubyB0aWVuZSBhY2Nlc28gYSBQZWRpZG9zIGRlbCBtZXMuIFNpIGxvIG5lY2VzaXRcdTAwRTFzLCBhdmlzYWxlIGEgTWFyaWFuby4nO1xuICBpZiAoY29kZS5pbmNsdWRlcygnaW52YWxpZC1hcmd1bWVudCcpKSByZXR1cm4gJ0VsIHBlclx1MDBFRG9kbyBlbGVnaWRvIG5vIGVzIHZcdTAwRTFsaWRvLic7XG4gIHJldHVybiAnTm8gcHVkaW1vcyB0cmFlciBsYSBmYWN0dXJhY2lcdTAwRjNuLiBWb2x2XHUwMEU5IGEgaW50ZW50YXIgZW4gdW4gbWludXRvOyBzaSBzaWd1ZSwgYXZpc2FsZSBhIE1hcmlhbm8uJztcbn1cblxuYXN5bmMgZnVuY3Rpb24gY2FyZ2FyKCkge1xuICBjb25zdCBzZXEgPSArK3N0YXRlLnJlcVNlcTtcbiAgc3RhdGUubG9hZGluZyA9IHRydWU7XG4gIHN0YXRlLmVycm9yID0gJyc7XG4gIHN0YXRlLmRhdGEgPSBudWxsO1xuICBzdGF0ZS5hYmllcnRvcyA9IG5ldyBTZXQoKTtcbiAgcmVuZGVyKCk7XG4gIHRyeSB7XG4gICAgaWYgKHR5cGVvZiBmaXJlYmFzZSA9PT0gJ3VuZGVmaW5lZCcgfHwgIWZpcmViYXNlLmFwcCkgdGhyb3cgbmV3IEVycm9yKCdmaXJlYmFzZSBubyBkaXNwb25pYmxlJyk7XG4gICAgY29uc3QgY2FsbGFibGUgPSBmaXJlYmFzZS5hcHAoKS5mdW5jdGlvbnMoUkVHSU9OKS5odHRwc0NhbGxhYmxlKCdwZWRpZG9zRGVsTWVzQ0YnKTtcbiAgICBjb25zdCByZXMgPSBhd2FpdCBjYWxsYWJsZSh7IGFuaW86IHN0YXRlLmFuaW8sIG1lczogc3RhdGUubWVzIH0pO1xuICAgIGlmIChzZXEgIT09IHN0YXRlLnJlcVNlcSkgcmV0dXJuO1xuICAgIHN0YXRlLmRhdGEgPSAocmVzICYmIHJlcy5kYXRhKSB8fCBudWxsO1xuICAgIC8vIFNpIGVsIHZlbmRlZG9yIGVsZWdpZG8gbm8gdGllbmUgZmFjdHVyYWNpXHUwMEYzbiBlbiBlbCBudWV2byBwZXJcdTAwRURvZG8sIHNlIGxpbXBpYS5cbiAgICBpZiAoXG4gICAgICBzdGF0ZS52ZW5kZWRvciAmJlxuICAgICAgISgoc3RhdGUuZGF0YSAmJiBzdGF0ZS5kYXRhLmNsaWVudGVzKSB8fCBbXSkuc29tZSgoYykgPT4gYy52ZW5kZWRvciA9PT0gc3RhdGUudmVuZGVkb3IpXG4gICAgKVxuICAgICAgc3RhdGUudmVuZGVkb3IgPSAnJztcbiAgfSBjYXRjaCAoZSkge1xuICAgIGlmIChzZXEgIT09IHN0YXRlLnJlcVNlcSkgcmV0dXJuO1xuICAgIGNvbnNvbGUuZXJyb3IoJ1twZWRpZG9zLWRlbC1tZXNdIHBlZGlkb3NEZWxNZXNDRiBmYWxsbzonLCBlKTtcbiAgICBzdGF0ZS5lcnJvciA9IF9lcnJvck1zZyhlKTtcbiAgfSBmaW5hbGx5IHtcbiAgICBpZiAoc2VxID09PSBzdGF0ZS5yZXFTZXEpIHtcbiAgICAgIHN0YXRlLmxvYWRpbmcgPSBmYWxzZTtcbiAgICAgIHJlbmRlcigpO1xuICAgIH1cbiAgfVxufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIEV2ZW50b3MgKGRlbGVnYWRvcyBzb2JyZSBlbCBtb2RhbDsgc2UgZW5nYW5jaGFuIHVuYSBzb2xhIHZleilcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5mdW5jdGlvbiBfd2lyZSgpIHtcbiAgY29uc3QgbW9kYWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgncGVkaWRvcy1tZXMtbW9kYWwnKTtcbiAgaWYgKCFtb2RhbCB8fCBtb2RhbC5kYXRhc2V0LnBkbVdpcmVkID09PSAnMScpIHJldHVybjtcbiAgbW9kYWwuZGF0YXNldC5wZG1XaXJlZCA9ICcxJztcbiAgbW9kYWwuYWRkRXZlbnRMaXN0ZW5lcignY2hhbmdlJywgKGV2KSA9PiB7XG4gICAgY29uc3QgdCA9IC8qKiBAdHlwZSB7SFRNTElucHV0RWxlbWVudH0gKi8gKGV2LnRhcmdldCk7XG4gICAgaWYgKCF0IHx8ICF0LmlkKSByZXR1cm47XG4gICAgaWYgKHQuaWQgPT09ICdwZG0tbWVzJyB8fCB0LmlkID09PSAncGRtLWFuaW8nKSB7XG4gICAgICBjb25zdCBhY3R1YWwgPSBfbWVzQWN0dWFsKCk7XG4gICAgICBzdGF0ZS5tZXMgPVxuICAgICAgICBOdW1iZXIoLyoqIEB0eXBlIHtIVE1MU2VsZWN0RWxlbWVudH0gKi8gKGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdwZG0tbWVzJykpLnZhbHVlKSB8fFxuICAgICAgICBzdGF0ZS5tZXM7XG4gICAgICBzdGF0ZS5hbmlvID1cbiAgICAgICAgTnVtYmVyKC8qKiBAdHlwZSB7SFRNTFNlbGVjdEVsZW1lbnR9ICovIChkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgncGRtLWFuaW8nKSkudmFsdWUpIHx8XG4gICAgICAgIHN0YXRlLmFuaW87XG4gICAgICAvLyBBXHUwMEYxbyBhY3R1YWwgY29uIHVuIG1lcyBmdXR1cm8gZWxlZ2lkbyBhbnRlczogc2UgbGxldmEgYWwgbWVzIGFjdHVhbC5cbiAgICAgIGlmIChzdGF0ZS5hbmlvID09PSBhY3R1YWwuYW5pbyAmJiBzdGF0ZS5tZXMgPiBhY3R1YWwubWVzKSBzdGF0ZS5tZXMgPSBhY3R1YWwubWVzO1xuICAgICAgY2FyZ2FyKCk7XG4gICAgfSBlbHNlIGlmICh0LmlkID09PSAncGRtLXZlbmRlZG9yJykge1xuICAgICAgc3RhdGUudmVuZGVkb3IgPSB0LnZhbHVlIHx8ICcnO1xuICAgICAgX3JlbmRlckxpc3RhKCk7XG4gICAgfVxuICB9KTtcbiAgbGV0IGRlYiA9IDA7XG4gIG1vZGFsLmFkZEV2ZW50TGlzdGVuZXIoJ2lucHV0JywgKGV2KSA9PiB7XG4gICAgY29uc3QgdCA9IC8qKiBAdHlwZSB7SFRNTElucHV0RWxlbWVudH0gKi8gKGV2LnRhcmdldCk7XG4gICAgaWYgKCF0IHx8IHQuaWQgIT09ICdwZG0tcScpIHJldHVybjtcbiAgICBjbGVhclRpbWVvdXQoZGViKTtcbiAgICBkZWIgPSAvKiogQHR5cGUge2FueX0gKi8gKFxuICAgICAgc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICAgIHN0YXRlLnEgPSB0LnZhbHVlIHx8ICcnO1xuICAgICAgICBfcmVuZGVyTGlzdGEoKTtcbiAgICAgIH0sIDIwMClcbiAgICApO1xuICB9KTtcbiAgY29uc3Qgb25Sb3cgPSAoLyoqIEB0eXBlIHtFdmVudH0gKi8gZXYpID0+IHtcbiAgICBjb25zdCB0Z3QgPSAvKiogQHR5cGUge0hUTUxFbGVtZW50fSAqLyAoZXYudGFyZ2V0KTtcbiAgICBjb25zdCByb3cgPVxuICAgICAgdGd0ICYmIHRndC5jbG9zZXN0ID8gLyoqIEB0eXBlIHtIVE1MRWxlbWVudHxudWxsfSAqLyAodGd0LmNsb3Nlc3QoJ3RyLnBkbS1yb3cnKSkgOiBudWxsO1xuICAgIGlmICghcm93KSByZXR1cm47XG4gICAgaWYgKGV2LnR5cGUgPT09ICdrZXlkb3duJykge1xuICAgICAgY29uc3QgayA9IC8qKiBAdHlwZSB7S2V5Ym9hcmRFdmVudH0gKi8gKGV2KS5rZXk7XG4gICAgICBpZiAoayAhPT0gJ0VudGVyJyAmJiBrICE9PSAnICcpIHJldHVybjtcbiAgICAgIGV2LnByZXZlbnREZWZhdWx0KCk7XG4gICAgfVxuICAgIF90b2dnbGUocm93LmRhdGFzZXQuY2MgfHwgJycpO1xuICB9O1xuICBjb25zdCBsaXN0ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3BkbS1saXN0Jyk7XG4gIGlmIChsaXN0KSB7XG4gICAgbGlzdC5hZGRFdmVudExpc3RlbmVyKCdjbGljaycsIG9uUm93KTtcbiAgICBsaXN0LmFkZEV2ZW50TGlzdGVuZXIoJ2tleWRvd24nLCBvblJvdyk7XG4gIH1cbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBBUEkgcFx1MDBGQWJsaWNhIChzdHVicyBlbiBzcmMvbWFpbi5qcyArIGJ1aWxkLmpzIExBWllfQ0hVTktTKVxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbndpbmRvdy5vcGVuUGVkaWRvc0RlbE1lcyA9IGZ1bmN0aW9uICgpIHtcbiAgY29uc3QgbW9kYWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgncGVkaWRvcy1tZXMtbW9kYWwnKTtcbiAgaWYgKCFtb2RhbCkgcmV0dXJuO1xuICBjb25zdCByb2xlID0gX3JvbGUoKTtcbiAgaWYgKHJvbGUgIT09ICdhZG1pbicgJiYgcm9sZSAhPT0gJ2dlcmVudGUnICYmIHJvbGUgIT09ICd2ZW5kZWRvcicpIHtcbiAgICBhbGVydCgnVHUgdXN1YXJpbyBubyB0aWVuZSBhY2Nlc28gYSBQZWRpZG9zIGRlbCBtZXMuIFNpIGxvIG5lY2VzaXRcdTAwRTFzLCBhdmlzYWxlIGEgTWFyaWFuby4nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgY29uc3QgdWlkID0gX3VpZCgpO1xuICBpZiAodWlkICE9PSBzdGF0ZS51aWQpIHtcbiAgICBzdGF0ZS51aWQgPSB1aWQ7XG4gICAgc3RhdGUucSA9ICcnO1xuICAgIHN0YXRlLnZlbmRlZG9yID0gJyc7XG4gICAgc3RhdGUuYW5pbyA9IDA7XG4gIH1cbiAgaWYgKCFzdGF0ZS5hbmlvKSB7XG4gICAgY29uc3QgYSA9IF9tZXNBY3R1YWwoKTtcbiAgICBzdGF0ZS5hbmlvID0gYS5hbmlvO1xuICAgIHN0YXRlLm1lcyA9IGEubWVzO1xuICB9XG4gIG1vZGFsLmNsYXNzTGlzdC5hZGQoJ29wZW4nKTtcbiAgX3dpcmUoKTtcbiAgY2FyZ2FyKCk7XG59O1xuXG53aW5kb3cuY2xvc2VQZWRpZG9zRGVsTWVzID0gZnVuY3Rpb24gKCkge1xuICBjb25zdCBtb2RhbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdwZWRpZG9zLW1lcy1tb2RhbCcpO1xuICBpZiAobW9kYWwpIG1vZGFsLmNsYXNzTGlzdC5yZW1vdmUoJ29wZW4nKTtcbiAgc3RhdGUuZGF0YSA9IG51bGw7XG4gIHN0YXRlLmxvYWRpbmcgPSBmYWxzZTtcbiAgc3RhdGUucmVxU2VxKys7XG59O1xuIl0sCiAgIm1hcHBpbmdzIjogIjs7O0FBU08sV0FBUyxPQUFPLEdBQUc7QUFDeEIsVUFBTSxJQUFJLE9BQU8sQ0FBQztBQUNsQixRQUFJLENBQUMsT0FBTyxTQUFTLENBQUMsRUFBRyxRQUFPO0FBQ2hDLFVBQU0sSUFBSSxLQUFLLE1BQU0sS0FBSyxJQUFJLENBQUMsQ0FBQyxFQUM3QixTQUFTLEVBQ1QsUUFBUSx5QkFBeUIsR0FBRztBQUN2QyxZQUFRLElBQUksSUFBSSxRQUFRLFFBQVE7QUFBQSxFQUNsQztBQUdPLFdBQVMsT0FBTyxHQUFHO0FBQ3hCLFVBQU0sSUFBSSxPQUFPLENBQUM7QUFDbEIsUUFBSSxDQUFDLE9BQU8sU0FBUyxDQUFDLEVBQUcsUUFBTztBQUNoQyxXQUFPLE9BQU8sVUFBVSxDQUFDLElBQUksT0FBTyxDQUFDLElBQUksRUFBRSxRQUFRLENBQUMsRUFBRSxRQUFRLEtBQUssR0FBRztBQUFBLEVBQ3hFO0FBUU8sV0FBUyxnQkFBZ0IsVUFBVSxHQUFHLFVBQVU7QUFDckQsVUFBTSxLQUFLLE9BQU8sS0FBSyxFQUFFLEVBQ3RCLEtBQUssRUFDTCxZQUFZO0FBQ2YsVUFBTSxJQUFJLE9BQU8sWUFBWSxFQUFFLEVBQzVCLEtBQUssRUFDTCxZQUFZO0FBQ2YsWUFBUSxZQUFZLENBQUMsR0FBRyxPQUFPLENBQUMsTUFBTTtBQUNwQyxVQUFJLEtBQUssT0FBTyxFQUFFLFlBQVksRUFBRSxFQUFFLFlBQVksTUFBTSxFQUFHLFFBQU87QUFDOUQsVUFBSSxDQUFDLEdBQUksUUFBTztBQUNoQixZQUFNLE1BQU0sQ0FBQyxFQUFFLFFBQVEsRUFBRSxVQUFVLEVBQUUsV0FBVyxFQUFFLFNBQVMsRUFBRSxLQUFLLEdBQUcsRUFBRSxZQUFZO0FBQ25GLGFBQU8sR0FBRyxNQUFNLEtBQUssRUFBRSxNQUFNLENBQUMsTUFBTSxJQUFJLFNBQVMsQ0FBQyxDQUFDO0FBQUEsSUFDckQsQ0FBQztBQUFBLEVBQ0g7QUFNTyxXQUFTLFVBQVUsVUFBVTtBQUNsQyxVQUFNLE9BQU8sb0JBQUksSUFBSTtBQUNyQixRQUFJLE1BQU07QUFDVixlQUFXLEtBQUssVUFBVTtBQUN4QixhQUFPLE9BQU8sRUFBRSxRQUFRLEtBQUs7QUFDN0IsaUJBQVcsS0FBSyxFQUFFLFFBQVEsQ0FBQyxFQUFHLE1BQUssSUFBSSxFQUFFLEdBQUc7QUFBQSxJQUM5QztBQUNBLFdBQU8sRUFBRSxVQUFVLFNBQVMsUUFBUSxNQUFNLEtBQUssTUFBTSxLQUFLLEtBQUssTUFBTSxNQUFNLEdBQUcsSUFBSSxJQUFJO0FBQUEsRUFDeEY7OztBQ3JDQSxNQUFNLFNBQVM7QUFDZixNQUFNLHNCQUFzQjtBQUM1QixNQUFNLFFBQVE7QUFBQSxJQUNaO0FBQUEsSUFDQTtBQUFBLElBQ0E7QUFBQSxJQUNBO0FBQUEsSUFDQTtBQUFBLElBQ0E7QUFBQSxJQUNBO0FBQUEsSUFDQTtBQUFBLElBQ0E7QUFBQSxJQUNBO0FBQUEsSUFDQTtBQUFBLElBQ0E7QUFBQSxFQUNGO0FBQ0EsTUFBTSxXQUFXO0FBSWpCLE1BQU0sUUFBUTtBQUFBLElBQ1osTUFBTTtBQUFBLElBQ04sS0FBSztBQUFBLElBQ0wsR0FBRztBQUFBLElBQ0gsVUFBVTtBQUFBLElBQ1YsTUFBTTtBQUFBLElBQ04sU0FBUztBQUFBLElBQ1QsT0FBTztBQUFBLElBQ1AsUUFBUTtBQUFBLElBQ1IsVUFBVSxvQkFBSSxJQUFJO0FBQUEsSUFDbEIsS0FBSztBQUFBLEVBQ1A7QUFHQSxXQUFTLElBQUksR0FBRztBQUNkLFdBQU8sT0FBTyxLQUFLLE9BQU8sS0FBSyxDQUFDLEVBQzdCLFFBQVEsTUFBTSxPQUFPLEVBQ3JCLFFBQVEsTUFBTSxNQUFNLEVBQ3BCLFFBQVEsTUFBTSxNQUFNLEVBQ3BCLFFBQVEsTUFBTSxRQUFRLEVBQ3RCLFFBQVEsTUFBTSxPQUFPO0FBQUEsRUFDMUI7QUFFQSxXQUFTLFFBQVE7QUFDZixRQUFJO0FBQ0YsY0FBUSxPQUFPLGFBQWEsY0FBYyxXQUFXLE9BQU8sYUFBYTtBQUFBLElBQzNFLFNBQVMsSUFBSTtBQUNYO0FBQUE7QUFBQSxRQUEyQixPQUFRLFlBQVk7QUFBQTtBQUFBLElBQ2pEO0FBQUEsRUFDRjtBQUVBLFdBQVMsT0FBTztBQUNkLFFBQUk7QUFDRixZQUFNLElBQUksT0FBTyxnQkFBZ0IsY0FBYyxjQUFjLE9BQU87QUFDcEUsYUFBUSxLQUFLLEVBQUUsT0FBUTtBQUFBLElBQ3pCLFNBQVMsSUFBSTtBQUNYLGFBQU87QUFBQSxJQUNUO0FBQUEsRUFDRjtBQUdBLFdBQVMsYUFBYTtBQUNwQixVQUFNLFFBQVEsSUFBSSxLQUFLLGVBQWUsU0FBUztBQUFBLE1BQzdDLFVBQVU7QUFBQSxNQUNWLE1BQU07QUFBQSxNQUNOLE9BQU87QUFBQSxJQUNULENBQUMsRUFBRSxjQUFjLG9CQUFJLEtBQUssQ0FBQztBQUMzQixXQUFPO0FBQUEsTUFDTCxNQUFNLE9BQU8sTUFBTSxLQUFLLENBQUMsTUFBTSxFQUFFLFNBQVMsTUFBTSxHQUFHLFNBQVMsSUFBSTtBQUFBLE1BQ2hFLEtBQUssT0FBTyxNQUFNLEtBQUssQ0FBQyxNQUFNLEVBQUUsU0FBUyxPQUFPLEdBQUcsU0FBUyxDQUFDO0FBQUEsSUFDL0Q7QUFBQSxFQUNGO0FBR0EsV0FBUyxTQUFTLEtBQUs7QUFDckIsVUFBTSxJQUFJLDJCQUEyQixLQUFLLE9BQU8sT0FBTyxFQUFFLENBQUM7QUFDM0QsV0FBTyxJQUFJLEVBQUUsQ0FBQyxJQUFJLE1BQU0sRUFBRSxDQUFDLElBQUksTUFBTSxFQUFFLENBQUMsSUFBSSxPQUFPLE9BQU8sRUFBRTtBQUFBLEVBQzlEO0FBRUEsV0FBUyxXQUFXO0FBQ2xCLFVBQU0sSUFBSSxNQUFNO0FBQ2hCLFdBQU8sTUFBTSxXQUFXLE1BQU07QUFBQSxFQUNoQztBQU1BLFdBQVMsaUJBQWlCO0FBQ3hCLFVBQU0sTUFBTSxTQUFTLGVBQWUsYUFBYTtBQUNqRCxRQUFJLENBQUMsSUFBSztBQUNWLFVBQU0sU0FBUyxXQUFXO0FBQzFCLFFBQUksVUFBVTtBQUNkLGFBQVMsSUFBSSxHQUFHLEtBQUssSUFBSSxLQUFLO0FBQzVCLFlBQU0sU0FBUyxNQUFNLFNBQVMsT0FBTyxRQUFRLElBQUksT0FBTztBQUN4RCxVQUFJLE9BQVE7QUFDWixpQkFDRSxvQkFDQSxJQUNBLE9BQ0MsTUFBTSxNQUFNLE1BQU0sY0FBYyxNQUNqQyxNQUNBLE1BQU0sSUFBSSxDQUFDLElBQ1g7QUFBQSxJQUNKO0FBQ0EsUUFBSSxXQUFXO0FBQ2YsYUFBUyxJQUFJLE9BQU8sTUFBTSxLQUFLLFVBQVUsS0FBSztBQUM1QyxrQkFDRSxvQkFBb0IsSUFBSSxPQUFPLE1BQU0sTUFBTSxPQUFPLGNBQWMsTUFBTSxNQUFNLElBQUk7QUFBQSxJQUNwRjtBQUNBLFFBQUksVUFBVTtBQUNkLFFBQUksU0FBUyxHQUFHO0FBQ2QsWUFBTSxRQUFRLG9CQUFJLElBQUk7QUFDdEIsaUJBQVcsS0FBTSxNQUFNLFFBQVEsTUFBTSxLQUFLLFlBQWEsQ0FBQztBQUN0RCxZQUFJLEVBQUUsU0FBVSxPQUFNLElBQUksRUFBRSxRQUFRO0FBQ3RDLFVBQUksT0FBTztBQUNYLGlCQUFXLEtBQUssQ0FBQyxHQUFHLEtBQUssRUFBRSxLQUFLO0FBQzlCLGdCQUNFLG9CQUNBLElBQUksQ0FBQyxJQUNMLE9BQ0MsTUFBTSxNQUFNLFdBQVcsY0FBYyxNQUN0QyxNQUNBLElBQUksQ0FBQyxJQUNMO0FBQ0osZ0JBQ0UsdUVBQXVFLE9BQU87QUFBQSxJQUNsRjtBQUNBLFFBQUksWUFDRiw2REFDQSxVQUNBLDBFQUVBLFdBQ0EsaUlBRUEsSUFBSSxNQUFNLENBQUMsSUFDWCxxQ0FDQTtBQUFBLEVBQ0o7QUFFQSxXQUFTLFlBQVksT0FBTztBQUMxQixVQUFNLElBQUksU0FBUyxlQUFlLFVBQVU7QUFDNUMsUUFBSSxDQUFDLEVBQUc7QUFDUixRQUFJLENBQUMsTUFBTSxNQUFNO0FBQ2YsUUFBRSxZQUFZO0FBQ2Q7QUFBQSxJQUNGO0FBQ0EsVUFBTSxJQUFJLFVBQVUsS0FBSztBQUN6QixVQUFNLE1BQU0sTUFBTSxLQUFLLFdBQVcsQ0FBQztBQUNuQyxNQUFFLFlBQ0EsOEJBQ0EsRUFBRSxXQUNGLGtCQUNDLEVBQUUsYUFBYSxJQUFJLEtBQUssT0FDekIsd0RBRUEsRUFBRSxPQUNGLG9FQUVBLElBQUksT0FBTyxFQUFFLEdBQUcsQ0FBQyxJQUNqQiwrREFFQyxJQUFJLFdBQVcsbUJBQW1CLGtCQUNuQztBQUFBLEVBQ0o7QUFHQSxXQUFTLGFBQWEsR0FBRztBQUN2QixRQUFJLElBQUk7QUFDUixTQUNFO0FBQ0YsZUFBVyxLQUFLLEVBQUUsUUFBUSxDQUFDLEdBQUc7QUFDNUIsWUFBTSxRQUFRLEVBQUUsWUFBWSxDQUFDLEdBQzFCLElBQUksQ0FBQyxNQUFNO0FBQ1YsY0FBTSxLQUFLLEVBQUUsU0FBUztBQUN0QixlQUNFLDBCQUNDLEtBQUssUUFBUSxNQUNkLGNBQ0E7QUFBQSxXQUNHLEtBQUssd0JBQXFCLGNBQ3pCLEVBQUUsU0FDRixXQUNBLFNBQVMsRUFBRSxLQUFLLElBQ2hCLFdBQ0EsT0FBTyxFQUFFLEdBQUcsSUFDWixhQUNBLE9BQU8sRUFBRSxHQUFHO0FBQUEsUUFDaEIsSUFDQSxRQUNDLEtBQUssUUFBUSxRQUNkLElBQUksRUFBRSxNQUFNLElBQ1o7QUFBQSxNQUVKLENBQUMsRUFDQSxLQUFLLEdBQUc7QUFDWCxXQUNFLDBCQUNBLElBQUksRUFBRSxHQUFHLElBQ1QsY0FDQSxJQUFJLEVBQUUsUUFBUSxzQkFBbUIsSUFDakMsMEJBQ0EsSUFBSSxPQUFPLEVBQUUsR0FBRyxDQUFDLElBQ2pCLDJCQUNDLEVBQUUsVUFBVSxPQUFPLE1BQU0sSUFBSSxPQUFPLEVBQUUsTUFBTSxDQUFDLEtBQzlDLDBCQUNBLElBQUksT0FBTyxFQUFFLEdBQUcsQ0FBQyxJQUNqQixjQUNBLE9BQ0E7QUFBQSxJQUNKO0FBQ0EsU0FDRSwrQ0FDQSxFQUFFLFdBQ0YsZUFDQSxFQUFFLGdCQUNGLGNBQ0MsRUFBRSxrQkFBa0IsSUFBSSxLQUFLO0FBQ2hDLFFBQUksRUFBRTtBQUNKLFdBQ0UsV0FDQSxFQUFFLG9CQUNGLFdBQ0MsRUFBRSxzQkFBc0IsSUFBSSxLQUFLLE9BQ2xDO0FBQ0osU0FDRSwwQkFDQSxJQUFJLE9BQU8sRUFBRSxRQUFRLENBQUMsSUFDdEIsbUNBQ0EsSUFBSSxPQUFPLEVBQUUsUUFBUSxDQUFDLElBQ3RCO0FBQ0YsV0FBTztBQUFBLEVBQ1Q7QUFFQSxXQUFTLGVBQWU7QUFDdEIsVUFBTSxPQUFPLFNBQVMsZUFBZSxVQUFVO0FBQy9DLFFBQUksQ0FBQyxLQUFNO0FBQ1gsUUFBSSxNQUFNLFNBQVM7QUFDakIsV0FBSyxZQUFZO0FBQ2pCLGtCQUFZLENBQUMsQ0FBQztBQUNkO0FBQUEsSUFDRjtBQUNBLFFBQUksTUFBTSxPQUFPO0FBQ2YsV0FBSyxZQUFZLGtDQUFrQyxJQUFJLE1BQU0sS0FBSyxJQUFJO0FBQ3RFLGtCQUFZLENBQUMsQ0FBQztBQUNkO0FBQUEsSUFDRjtBQUNBLFFBQUksQ0FBQyxNQUFNLE1BQU07QUFDZixXQUFLLFlBQVk7QUFDakI7QUFBQSxJQUNGO0FBQ0EsVUFBTSxRQUFRLGdCQUFnQixNQUFNLEtBQUssVUFBVSxNQUFNLEdBQUcsTUFBTSxRQUFRO0FBQzFFLGdCQUFZLEtBQUs7QUFDakIsUUFBSSxDQUFDLE1BQU0sUUFBUTtBQUNqQixXQUFLLFlBQ0gsNEJBQ0UsTUFBTSxLQUFLLFlBQVksQ0FBQyxHQUFHLFNBQ3pCLG1EQUNBLDhCQUEyQixNQUFNLE1BQU0sTUFBTSxDQUFDLElBQUksTUFBTSxNQUFNLE9BQU8sT0FDekU7QUFDRjtBQUFBLElBQ0Y7QUFDQSxRQUFJLElBQ0Y7QUFDRixlQUFXLEtBQUssTUFBTSxNQUFNLEdBQUcsbUJBQW1CLEdBQUc7QUFDbkQsWUFBTSxVQUFVLE1BQU0sU0FBUyxJQUFJLEVBQUUsUUFBUTtBQUM3QyxXQUNFLHdCQUNDLFVBQVUsVUFBVSxNQUNyQixnQkFDQSxJQUFJLEVBQUUsUUFBUSxJQUNkLGlEQUNBLFVBQ0EseURBQ0MsVUFBVSxXQUFNLFlBQ2pCLHlDQUNBLElBQUksRUFBRSxNQUFNLElBQ1osaUNBQ0EsSUFBSSxFQUFFLFFBQVEsSUFDZCxnQ0FDQSxJQUFJLEVBQUUsYUFBYSxHQUFHLElBQ3RCLGNBQ0EsSUFBSSxFQUFFLGFBQWEsR0FBRyxJQUN0QixjQUNBLElBQUksRUFBRSxZQUFZLEdBQUcsSUFDckIsMEJBQ0EsRUFBRSxXQUNGLGtDQUNBLElBQUksT0FBTyxFQUFFLFFBQVEsQ0FBQyxJQUN0QjtBQUNGLFdBQ0UsdUNBQ0EsSUFBSSxFQUFFLFFBQVEsSUFDZCxPQUNDLFVBQVUsS0FBSywyQkFDaEIsdUJBQ0MsVUFBVSxhQUFhLENBQUMsSUFBSSxNQUM3QjtBQUFBLElBQ0o7QUFDQSxTQUFLO0FBQ0wsUUFBSSxNQUFNLFNBQVM7QUFDakIsV0FDRSxvQ0FDQSxzQkFDQSxTQUNBLE1BQU0sU0FDTjtBQUNKLFNBQUssWUFBWTtBQUFBLEVBQ25CO0FBRUEsV0FBUyxTQUFTO0FBQ2hCLG1CQUFlO0FBQ2YsaUJBQWE7QUFBQSxFQUNmO0FBR0EsV0FBUyxRQUFRLElBQUk7QUFDbkIsVUFBTSxPQUFPLFNBQVMsZUFBZSxVQUFVO0FBQy9DLFFBQUksQ0FBQyxRQUFRLENBQUMsTUFBTSxLQUFNO0FBQzFCLFVBQU07QUFBQTtBQUFBLE1BQ0osTUFBTSxLQUFLLEtBQUssaUJBQWlCLFlBQVksQ0FBQyxFQUFFO0FBQUEsUUFDOUMsQ0FBQztBQUFBO0FBQUEsVUFBa0MsRUFBRyxRQUFRLE9BQU87QUFBQTtBQUFBLE1BQ3ZELEtBQUs7QUFBQTtBQUVQLFVBQU0sTUFBTTtBQUFBO0FBQUEsTUFBdUMsSUFBSTtBQUFBLFFBQXNCO0FBQzdFLFFBQUksQ0FBQyxPQUFPLENBQUMsSUFBSztBQUNsQixVQUFNLFFBQVEsQ0FBQyxNQUFNLFNBQVMsSUFBSSxFQUFFO0FBQ3BDLFFBQUksT0FBTztBQUNULFlBQU0sU0FBUyxJQUFJLEVBQUU7QUFDckIsWUFBTSxLQUFLLE1BQU0sS0FBSyxZQUFZLENBQUMsR0FBRyxLQUFLLENBQUMsTUFBTSxFQUFFLGFBQWEsRUFBRTtBQUNuRSxZQUFNLEtBQUssSUFBSSxjQUFjLElBQUk7QUFDakMsVUFBSSxNQUFNLEVBQUcsSUFBRyxZQUFZLGFBQWEsQ0FBQztBQUMxQyxVQUFJLE1BQU0sVUFBVTtBQUFBLElBQ3RCLE9BQU87QUFDTCxZQUFNLFNBQVMsT0FBTyxFQUFFO0FBQ3hCLFVBQUksTUFBTSxVQUFVO0FBQUEsSUFDdEI7QUFDQSxRQUFJLFVBQVUsT0FBTyxRQUFRLEtBQUs7QUFDbEMsUUFBSSxhQUFhLGlCQUFpQixPQUFPLEtBQUssQ0FBQztBQUMvQyxVQUFNLFFBQVEsSUFBSSxjQUFjLFlBQVk7QUFDNUMsUUFBSSxNQUFPLE9BQU0sY0FBYyxRQUFRLFdBQU07QUFBQSxFQUMvQztBQU9BLFdBQVMsVUFBVSxHQUFHO0FBQ3BCLFVBQU0sT0FBTyxPQUFRLEtBQUssRUFBRSxRQUFTLEVBQUU7QUFDdkMsUUFBSSxLQUFLLFNBQVMsbUJBQW1CO0FBQ25DLGFBQU87QUFDVCxRQUFJLEtBQUssU0FBUyxrQkFBa0IsRUFBRyxRQUFPO0FBQzlDLFdBQU87QUFBQSxFQUNUO0FBRUEsaUJBQWUsU0FBUztBQUN0QixVQUFNLE1BQU0sRUFBRSxNQUFNO0FBQ3BCLFVBQU0sVUFBVTtBQUNoQixVQUFNLFFBQVE7QUFDZCxVQUFNLE9BQU87QUFDYixVQUFNLFdBQVcsb0JBQUksSUFBSTtBQUN6QixXQUFPO0FBQ1AsUUFBSTtBQUNGLFVBQUksT0FBTyxhQUFhLGVBQWUsQ0FBQyxTQUFTLElBQUssT0FBTSxJQUFJLE1BQU0sd0JBQXdCO0FBQzlGLFlBQU0sV0FBVyxTQUFTLElBQUksRUFBRSxVQUFVLE1BQU0sRUFBRSxjQUFjLGlCQUFpQjtBQUNqRixZQUFNLE1BQU0sTUFBTSxTQUFTLEVBQUUsTUFBTSxNQUFNLE1BQU0sS0FBSyxNQUFNLElBQUksQ0FBQztBQUMvRCxVQUFJLFFBQVEsTUFBTSxPQUFRO0FBQzFCLFlBQU0sT0FBUSxPQUFPLElBQUksUUFBUztBQUVsQyxVQUNFLE1BQU0sWUFDTixFQUFHLE1BQU0sUUFBUSxNQUFNLEtBQUssWUFBYSxDQUFDLEdBQUcsS0FBSyxDQUFDLE1BQU0sRUFBRSxhQUFhLE1BQU0sUUFBUTtBQUV0RixjQUFNLFdBQVc7QUFBQSxJQUNyQixTQUFTLEdBQUc7QUFDVixVQUFJLFFBQVEsTUFBTSxPQUFRO0FBQzFCLGNBQVEsTUFBTSw0Q0FBNEMsQ0FBQztBQUMzRCxZQUFNLFFBQVEsVUFBVSxDQUFDO0FBQUEsSUFDM0IsVUFBRTtBQUNBLFVBQUksUUFBUSxNQUFNLFFBQVE7QUFDeEIsY0FBTSxVQUFVO0FBQ2hCLGVBQU87QUFBQSxNQUNUO0FBQUEsSUFDRjtBQUFBLEVBQ0Y7QUFNQSxXQUFTLFFBQVE7QUFDZixVQUFNLFFBQVEsU0FBUyxlQUFlLG1CQUFtQjtBQUN6RCxRQUFJLENBQUMsU0FBUyxNQUFNLFFBQVEsYUFBYSxJQUFLO0FBQzlDLFVBQU0sUUFBUSxXQUFXO0FBQ3pCLFVBQU0saUJBQWlCLFVBQVUsQ0FBQyxPQUFPO0FBQ3ZDLFlBQU07QUFBQTtBQUFBLFFBQXFDLEdBQUc7QUFBQTtBQUM5QyxVQUFJLENBQUMsS0FBSyxDQUFDLEVBQUUsR0FBSTtBQUNqQixVQUFJLEVBQUUsT0FBTyxhQUFhLEVBQUUsT0FBTyxZQUFZO0FBQzdDLGNBQU0sU0FBUyxXQUFXO0FBQzFCLGNBQU0sTUFDSjtBQUFBO0FBQUEsVUFBeUMsU0FBUyxlQUFlLFNBQVMsRUFBRztBQUFBLFFBQUssS0FDbEYsTUFBTTtBQUNSLGNBQU0sT0FDSjtBQUFBO0FBQUEsVUFBeUMsU0FBUyxlQUFlLFVBQVUsRUFBRztBQUFBLFFBQUssS0FDbkYsTUFBTTtBQUVSLFlBQUksTUFBTSxTQUFTLE9BQU8sUUFBUSxNQUFNLE1BQU0sT0FBTyxJQUFLLE9BQU0sTUFBTSxPQUFPO0FBQzdFLGVBQU87QUFBQSxNQUNULFdBQVcsRUFBRSxPQUFPLGdCQUFnQjtBQUNsQyxjQUFNLFdBQVcsRUFBRSxTQUFTO0FBQzVCLHFCQUFhO0FBQUEsTUFDZjtBQUFBLElBQ0YsQ0FBQztBQUNELFFBQUksTUFBTTtBQUNWLFVBQU0saUJBQWlCLFNBQVMsQ0FBQyxPQUFPO0FBQ3RDLFlBQU07QUFBQTtBQUFBLFFBQXFDLEdBQUc7QUFBQTtBQUM5QyxVQUFJLENBQUMsS0FBSyxFQUFFLE9BQU8sUUFBUztBQUM1QixtQkFBYSxHQUFHO0FBQ2hCO0FBQUEsTUFDRSxXQUFXLE1BQU07QUFDZixjQUFNLElBQUksRUFBRSxTQUFTO0FBQ3JCLHFCQUFhO0FBQUEsTUFDZixHQUFHLEdBQUc7QUFBQSxJQUVWLENBQUM7QUFDRCxVQUFNLFFBQVEsQ0FBc0IsT0FBTztBQUN6QyxZQUFNO0FBQUE7QUFBQSxRQUFrQyxHQUFHO0FBQUE7QUFDM0MsWUFBTSxNQUNKLE9BQU8sSUFBSTtBQUFBO0FBQUEsUUFBMkMsSUFBSSxRQUFRLFlBQVk7QUFBQSxVQUFLO0FBQ3JGLFVBQUksQ0FBQyxJQUFLO0FBQ1YsVUFBSSxHQUFHLFNBQVMsV0FBVztBQUN6QixjQUFNO0FBQUE7QUFBQSxVQUFrQyxHQUFJO0FBQUE7QUFDNUMsWUFBSSxNQUFNLFdBQVcsTUFBTSxJQUFLO0FBQ2hDLFdBQUcsZUFBZTtBQUFBLE1BQ3BCO0FBQ0EsY0FBUSxJQUFJLFFBQVEsTUFBTSxFQUFFO0FBQUEsSUFDOUI7QUFDQSxVQUFNLE9BQU8sU0FBUyxlQUFlLFVBQVU7QUFDL0MsUUFBSSxNQUFNO0FBQ1IsV0FBSyxpQkFBaUIsU0FBUyxLQUFLO0FBQ3BDLFdBQUssaUJBQWlCLFdBQVcsS0FBSztBQUFBLElBQ3hDO0FBQUEsRUFDRjtBQU1BLFNBQU8sb0JBQW9CLFdBQVk7QUFDckMsVUFBTSxRQUFRLFNBQVMsZUFBZSxtQkFBbUI7QUFDekQsUUFBSSxDQUFDLE1BQU87QUFDWixVQUFNLE9BQU8sTUFBTTtBQUNuQixRQUFJLFNBQVMsV0FBVyxTQUFTLGFBQWEsU0FBUyxZQUFZO0FBQ2pFLFlBQU0sc0ZBQW1GO0FBQ3pGO0FBQUEsSUFDRjtBQUNBLFVBQU0sTUFBTSxLQUFLO0FBQ2pCLFFBQUksUUFBUSxNQUFNLEtBQUs7QUFDckIsWUFBTSxNQUFNO0FBQ1osWUFBTSxJQUFJO0FBQ1YsWUFBTSxXQUFXO0FBQ2pCLFlBQU0sT0FBTztBQUFBLElBQ2Y7QUFDQSxRQUFJLENBQUMsTUFBTSxNQUFNO0FBQ2YsWUFBTSxJQUFJLFdBQVc7QUFDckIsWUFBTSxPQUFPLEVBQUU7QUFDZixZQUFNLE1BQU0sRUFBRTtBQUFBLElBQ2hCO0FBQ0EsVUFBTSxVQUFVLElBQUksTUFBTTtBQUMxQixVQUFNO0FBQ04sV0FBTztBQUFBLEVBQ1Q7QUFFQSxTQUFPLHFCQUFxQixXQUFZO0FBQ3RDLFVBQU0sUUFBUSxTQUFTLGVBQWUsbUJBQW1CO0FBQ3pELFFBQUksTUFBTyxPQUFNLFVBQVUsT0FBTyxNQUFNO0FBQ3hDLFVBQU0sT0FBTztBQUNiLFVBQU0sVUFBVTtBQUNoQixVQUFNO0FBQUEsRUFDUjsiLAogICJuYW1lcyI6IFtdCn0K
