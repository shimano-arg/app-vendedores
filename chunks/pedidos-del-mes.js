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
    k.innerHTML = '<span class="pdm-kpi"><b>' + t.clientes + "</b> cliente" + (t.clientes === 1 ? "" : "s") + ' con facturaci\xF3n</span><span class="pdm-kpi"><b>' + t.skus + '</b> SKU facturados</span><span class="pdm-kpi pdm-kpi-ars"><b>' + esc(fmtArs(t.ars)) + '</b> facturado</span><span class="pdm-kpi pdm-kpi-scope">' + (alc.nacional ? "Vista nacional" : Array.isArray(alc.vendedores) && alc.vendedores.length > 1 ? "Tu zona y tus parejas" : "Tus clientes") + "</span>";
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL3B1cmUvcGVkaWRvcy1kZWwtbWVzLXZpZXcuanMiLCAiLi4vc3JjL2RvbWFpbnMvcGVkaWRvcy1kZWwtbWVzLmpzIl0sCiAgInNvdXJjZXNDb250ZW50IjogWyIvLyBAdHMtY2hlY2tcbi8qKlxuICogcGVkaWRvcy1kZWwtbWVzLXZpZXcuanMgKHYxNTQwLCAyMDI2LTExLTAyLCBBUFAtMDYpIFx1MjAxNCBoZWxwZXJzIHB1cm9zIGRlIGxhXG4gKiBwYW50YWxsYSBQZWRpZG9zIGRlbCBtZXMgKHNyYy9kb21haW5zL3BlZGlkb3MtZGVsLW1lcy5qcykuIFNpbiBET00gbmlcbiAqIEZpcmViYXNlOiBmb3JtYXRvIGRlIG5cdTAwRkFtZXJvcyB5IGZpbHRyb3Mgc29icmUgbGEgcmVzcHVlc3RhIGRlXG4gKiBwZWRpZG9zRGVsTWVzQ0YuXG4gKi9cblxuLyoqIEBwYXJhbSB7bnVtYmVyfSBuICovXG5leHBvcnQgZnVuY3Rpb24gZm10QXJzKG4pIHtcbiAgY29uc3QgeCA9IE51bWJlcihuKTtcbiAgaWYgKCFOdW1iZXIuaXNGaW5pdGUoeCkpIHJldHVybiAnLSc7XG4gIGNvbnN0IHMgPSBNYXRoLnJvdW5kKE1hdGguYWJzKHgpKVxuICAgIC50b1N0cmluZygpXG4gICAgLnJlcGxhY2UoL1xcQig/PShcXGR7M30pKyg/IVxcZCkpL2csICcuJyk7XG4gIHJldHVybiAoeCA8IDAgPyAnLSQgJyA6ICckICcpICsgcztcbn1cblxuLyoqIEBwYXJhbSB7bnVtYmVyfSBuICovXG5leHBvcnQgZnVuY3Rpb24gZm10VWRzKG4pIHtcbiAgY29uc3QgeCA9IE51bWJlcihuKTtcbiAgaWYgKCFOdW1iZXIuaXNGaW5pdGUoeCkpIHJldHVybiAnLSc7XG4gIHJldHVybiBOdW1iZXIuaXNJbnRlZ2VyKHgpID8gU3RyaW5nKHgpIDogeC50b0ZpeGVkKDIpLnJlcGxhY2UoJy4nLCAnLCcpO1xufVxuXG4vKipcbiAqIEZpbHRyYSBjbGllbnRlcyBwb3IgYlx1MDBGQXNxdWVkYSAobm9tYnJlLCBjXHUwMEYzZGlnbywgbG9jYWxpZGFkKSB5IHZlbmRlZG9yLiBQdXJvLlxuICogQHBhcmFtIHthbnlbXX0gY2xpZW50ZXNcbiAqIEBwYXJhbSB7c3RyaW5nfSBxXG4gKiBAcGFyYW0ge3N0cmluZ30gdmVuZGVkb3JcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGZpbHRyYXJDbGllbnRlcyhjbGllbnRlcywgcSwgdmVuZGVkb3IpIHtcbiAgY29uc3QgcXEgPSBTdHJpbmcocSB8fCAnJylcbiAgICAudHJpbSgpXG4gICAgLnRvVXBwZXJDYXNlKCk7XG4gIGNvbnN0IHYgPSBTdHJpbmcodmVuZGVkb3IgfHwgJycpXG4gICAgLnRyaW0oKVxuICAgIC50b1VwcGVyQ2FzZSgpO1xuICByZXR1cm4gKGNsaWVudGVzIHx8IFtdKS5maWx0ZXIoKGMpID0+IHtcbiAgICBpZiAodiAmJiBTdHJpbmcoYy52ZW5kZWRvciB8fCAnJykudG9VcHBlckNhc2UoKSAhPT0gdikgcmV0dXJuIGZhbHNlO1xuICAgIGlmICghcXEpIHJldHVybiB0cnVlO1xuICAgIGNvbnN0IGhheSA9IFtjLm5vbWJyZSwgYy5jYXJkQ29kZSwgYy5sb2NhbGlkYWQsIGMucHJvdmluY2lhXS5qb2luKCcgJykudG9VcHBlckNhc2UoKTtcbiAgICByZXR1cm4gcXEuc3BsaXQoL1xccysvKS5ldmVyeSgodCkgPT4gaGF5LmluY2x1ZGVzKHQpKTtcbiAgfSk7XG59XG5cbi8qKlxuICogVG90YWxlcyBkZSBsYSBsaXN0YSBmaWx0cmFkYSAobG9zIEtQSSBkZWwgZW5jYWJlemFkbyBzaWd1ZW4gYWwgZmlsdHJvKS5cbiAqIEBwYXJhbSB7YW55W119IGNsaWVudGVzXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiB0b3RhbGVzRGUoY2xpZW50ZXMpIHtcbiAgY29uc3Qgc2t1cyA9IG5ldyBTZXQoKTtcbiAgbGV0IGFycyA9IDA7XG4gIGZvciAoY29uc3QgYyBvZiBjbGllbnRlcykge1xuICAgIGFycyArPSBOdW1iZXIoYy50b3RhbEFycykgfHwgMDtcbiAgICBmb3IgKGNvbnN0IHMgb2YgYy5za3VzIHx8IFtdKSBza3VzLmFkZChzLnNrdSk7XG4gIH1cbiAgcmV0dXJuIHsgY2xpZW50ZXM6IGNsaWVudGVzLmxlbmd0aCwgc2t1czogc2t1cy5zaXplLCBhcnM6IE1hdGgucm91bmQoYXJzICogMTAwKSAvIDEwMCB9O1xufVxuIiwgIi8vIEB0cy1ub2NoZWNrXG4vKipcbiAqIFBlZGlkb3MgZGVsIG1lcyAodjE1NDAsIDIwMjYtMTEtMDIsIEFQUC0wNikgXHUyMDE0IGNodW5rIGxhenkuXG4gKlxuICogRmFjdHVyYWNpXHUwMEYzbiBlZmVjdGl2YW1lbnRlIGVtaXRpZGEgcG9yIGNsaWVudGUgeSBTS1UgZW4gdW4gbWVzLiBMb3MgZGF0b3NcbiAqIHZpZW5lbiBTT0xPIGRlbCBjYWxsYWJsZSBgcGVkaWRvc0RlbE1lc0NGYCAoQmlnUXVlcnkgdl92ZW50YXNfbGluZWFzOlxuICogZmFjdHVyYXMgeSBub3RhcyBkZSBjclx1MDBFOWRpdG8gZGUgU0FQKS4gTm8gbGVlIHBlZGlkb3MsIGxpc3RhIGRlIGVzcGVyYSxcbiAqIGJhY2tvcmRlciBuaSBzdG9jayBhc2lnbmFkbzogbmFkYSBxdWUgbm8gZXN0XHUwMEU5IGZhY3R1cmFkbyBwdWVkZSBhcGFyZWNlci5cbiAqXG4gKiBFbCBhbGNhbmNlIGxvIGRlY2lkZSBlbCBzZXJ2aWRvcjogZWwgdmVuZGVkb3IgcmVjaWJlIHNvbG8gc3VzIGNsaWVudGVzO1xuICogYWRtaW4vZ2VyZW50ZSwgdG9kbyBlbCBwYVx1MDBFRHMuIEVsIGZpbHRybyBkZSB2ZW5kZWRvciBkZSBlc3RhIHBhbnRhbGxhIGVzXG4gKiBzb2xvIHBhcmEgYWRtaW4vZ2VyZW50ZSAoZmlsdHJhIHNvYnJlIGRhdG9zIHF1ZSB5YSB0aWVuZSBwZXJtaXNvIGRlIHZlcikuXG4gKlxuICogSW50ZXJhY2NpXHUwMEYzbjogbWlzbW8gcGF0clx1MDBGM24gcXVlIFN0b2NrIEFzaWduYWRvIChmaWxhIGNvbiBcdTI1QjYsIGNsaWMgZGVzcGxpZWdhXG4gKiBkZWJham8gbGEgdGFibGEgZGUgU0tVOyB2YXJpYXMgYWJpZXJ0YXMgYSBsYSB2ZXopLlxuICpcbiAqIEluZm9ybWU6IGRvY3MvYXVkaXRvcmlhLzQ5X1BFRElET1NfREVMX01FUy5tZC5cbiAqL1xuXG5pbXBvcnQgeyBmaWx0cmFyQ2xpZW50ZXMsIGZtdEFycywgZm10VWRzLCB0b3RhbGVzRGUgfSBmcm9tICcuLi9wdXJlL3BlZGlkb3MtZGVsLW1lcy12aWV3LmpzJztcblxuY29uc3QgUkVHSU9OID0gJ3NvdXRoYW1lcmljYS1lYXN0MSc7XG5jb25zdCBNQVhfQ0xJRU5URVNfUkVOREVSID0gMzAwO1xuY29uc3QgTUVTRVMgPSBbXG4gICdFbmVybycsXG4gICdGZWJyZXJvJyxcbiAgJ01hcnpvJyxcbiAgJ0FicmlsJyxcbiAgJ01heW8nLFxuICAnSnVuaW8nLFxuICAnSnVsaW8nLFxuICAnQWdvc3RvJyxcbiAgJ1NlcHRpZW1icmUnLFxuICAnT2N0dWJyZScsXG4gICdOb3ZpZW1icmUnLFxuICAnRGljaWVtYnJlJyxcbl07XG5jb25zdCBBTklPX01JTiA9IDIwMjY7IC8vIHByaW1lciBhXHUwMEYxbyBjb24gZmFjdHVyYWNpXHUwMEYzbiBzaW5jcm9uaXphZGEgZW4gQmlnUXVlcnlcblxuLyoqIEB0eXBlIHt7IGFuaW86IG51bWJlciwgbWVzOiBudW1iZXIsIHE6IHN0cmluZywgdmVuZGVkb3I6IHN0cmluZywgZGF0YTogYW55LCBsb2FkaW5nOiBib29sZWFuLFxuICogICBlcnJvcjogc3RyaW5nLCByZXFTZXE6IG51bWJlciwgYWJpZXJ0b3M6IFNldDxzdHJpbmc+LCB1aWQ6IHN0cmluZ3xudWxsIH19ICovXG5jb25zdCBzdGF0ZSA9IHtcbiAgYW5pbzogMCxcbiAgbWVzOiAwLFxuICBxOiAnJyxcbiAgdmVuZGVkb3I6ICcnLFxuICBkYXRhOiBudWxsLFxuICBsb2FkaW5nOiBmYWxzZSxcbiAgZXJyb3I6ICcnLFxuICByZXFTZXE6IDAsXG4gIGFiaWVydG9zOiBuZXcgU2V0KCksXG4gIHVpZDogbnVsbCxcbn07XG5cbi8qKiBAcGFyYW0ge2FueX0gcyAqL1xuZnVuY3Rpb24gZXNjKHMpIHtcbiAgcmV0dXJuIFN0cmluZyhzID09IG51bGwgPyAnJyA6IHMpXG4gICAgLnJlcGxhY2UoLyYvZywgJyZhbXA7JylcbiAgICAucmVwbGFjZSgvPC9nLCAnJmx0OycpXG4gICAgLnJlcGxhY2UoLz4vZywgJyZndDsnKVxuICAgIC5yZXBsYWNlKC9cIi9nLCAnJnF1b3Q7JylcbiAgICAucmVwbGFjZSgvJy9nLCAnJiMzOTsnKTtcbn1cblxuZnVuY3Rpb24gX3JvbGUoKSB7XG4gIHRyeSB7XG4gICAgcmV0dXJuICh0eXBlb2YgdXNlclJvbGUgIT09ICd1bmRlZmluZWQnID8gdXNlclJvbGUgOiB3aW5kb3cudXNlclJvbGUpIHx8IG51bGw7XG4gIH0gY2F0Y2ggKF9lKSB7XG4gICAgcmV0dXJuIC8qKiBAdHlwZSB7YW55fSAqLyAod2luZG93KS51c2VyUm9sZSB8fCBudWxsO1xuICB9XG59XG5cbmZ1bmN0aW9uIF91aWQoKSB7XG4gIHRyeSB7XG4gICAgY29uc3QgdSA9IHR5cGVvZiBjdXJyZW50VXNlciAhPT0gJ3VuZGVmaW5lZCcgPyBjdXJyZW50VXNlciA6IHdpbmRvdy5jdXJyZW50VXNlcjtcbiAgICByZXR1cm4gKHUgJiYgdS51aWQpIHx8IG51bGw7XG4gIH0gY2F0Y2ggKF9lKSB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cbn1cblxuLyoqIE1lcyBhY3R1YWwgZW4gaG9yYSBBcmdlbnRpbmEuICovXG5mdW5jdGlvbiBfbWVzQWN0dWFsKCkge1xuICBjb25zdCBwYXJ0cyA9IG5ldyBJbnRsLkRhdGVUaW1lRm9ybWF0KCdlbi1DQScsIHtcbiAgICB0aW1lWm9uZTogJ0FtZXJpY2EvQXJnZW50aW5hL0J1ZW5vc19BaXJlcycsXG4gICAgeWVhcjogJ251bWVyaWMnLFxuICAgIG1vbnRoOiAnMi1kaWdpdCcsXG4gIH0pLmZvcm1hdFRvUGFydHMobmV3IERhdGUoKSk7XG4gIHJldHVybiB7XG4gICAgYW5pbzogTnVtYmVyKHBhcnRzLmZpbmQoKHApID0+IHAudHlwZSA9PT0gJ3llYXInKT8udmFsdWUgfHwgMjAyNiksXG4gICAgbWVzOiBOdW1iZXIocGFydHMuZmluZCgocCkgPT4gcC50eXBlID09PSAnbW9udGgnKT8udmFsdWUgfHwgMSksXG4gIH07XG59XG5cbi8qKiBAcGFyYW0ge3N0cmluZ30gaXNvIFlZWVktTU0tREQgKi9cbmZ1bmN0aW9uIGZtdEZlY2hhKGlzbykge1xuICBjb25zdCBtID0gL14oXFxkezR9KS0oXFxkezJ9KS0oXFxkezJ9KS8uZXhlYyhTdHJpbmcoaXNvIHx8ICcnKSk7XG4gIHJldHVybiBtID8gbVszXSArICcvJyArIG1bMl0gKyAnLycgKyBtWzFdIDogU3RyaW5nKGlzbyB8fCAnJyk7XG59XG5cbmZ1bmN0aW9uIF9lc1N0YWZmKCkge1xuICBjb25zdCByID0gX3JvbGUoKTtcbiAgcmV0dXJuIHIgPT09ICdhZG1pbicgfHwgciA9PT0gJ2dlcmVudGUnO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFJlbmRlclxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmZ1bmN0aW9uIF9yZW5kZXJGaWx0cm9zKCkge1xuICBjb25zdCBib3ggPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgncGRtLWZpbHRyb3MnKTtcbiAgaWYgKCFib3gpIHJldHVybjtcbiAgY29uc3QgYWN0dWFsID0gX21lc0FjdHVhbCgpO1xuICBsZXQgbWVzT3B0cyA9ICcnO1xuICBmb3IgKGxldCBtID0gMTsgbSA8PSAxMjsgbSsrKSB7XG4gICAgY29uc3QgZnV0dXJvID0gc3RhdGUuYW5pbyA9PT0gYWN0dWFsLmFuaW8gJiYgbSA+IGFjdHVhbC5tZXM7XG4gICAgaWYgKGZ1dHVybykgY29udGludWU7XG4gICAgbWVzT3B0cyArPVxuICAgICAgJzxvcHRpb24gdmFsdWU9XCInICtcbiAgICAgIG0gK1xuICAgICAgJ1wiJyArXG4gICAgICAobSA9PT0gc3RhdGUubWVzID8gJyBzZWxlY3RlZCcgOiAnJykgK1xuICAgICAgJz4nICtcbiAgICAgIE1FU0VTW20gLSAxXSArXG4gICAgICAnPC9vcHRpb24+JztcbiAgfVxuICBsZXQgYW5pb09wdHMgPSAnJztcbiAgZm9yIChsZXQgYSA9IGFjdHVhbC5hbmlvOyBhID49IEFOSU9fTUlOOyBhLS0pIHtcbiAgICBhbmlvT3B0cyArPVxuICAgICAgJzxvcHRpb24gdmFsdWU9XCInICsgYSArICdcIicgKyAoYSA9PT0gc3RhdGUuYW5pbyA/ICcgc2VsZWN0ZWQnIDogJycpICsgJz4nICsgYSArICc8L29wdGlvbj4nO1xuICB9XG4gIGxldCB2ZW5kU2VsID0gJyc7XG4gIGlmIChfZXNTdGFmZigpKSB7XG4gICAgY29uc3QgdmVuZHMgPSBuZXcgU2V0KCk7XG4gICAgZm9yIChjb25zdCBjIG9mIChzdGF0ZS5kYXRhICYmIHN0YXRlLmRhdGEuY2xpZW50ZXMpIHx8IFtdKVxuICAgICAgaWYgKGMudmVuZGVkb3IpIHZlbmRzLmFkZChjLnZlbmRlZG9yKTtcbiAgICBsZXQgb3B0cyA9ICc8b3B0aW9uIHZhbHVlPVwiXCI+VG9kb3MgbG9zIHZlbmRlZG9yZXM8L29wdGlvbj4nO1xuICAgIGZvciAoY29uc3QgdiBvZiBbLi4udmVuZHNdLnNvcnQoKSlcbiAgICAgIG9wdHMgKz1cbiAgICAgICAgJzxvcHRpb24gdmFsdWU9XCInICtcbiAgICAgICAgZXNjKHYpICtcbiAgICAgICAgJ1wiJyArXG4gICAgICAgICh2ID09PSBzdGF0ZS52ZW5kZWRvciA/ICcgc2VsZWN0ZWQnIDogJycpICtcbiAgICAgICAgJz4nICtcbiAgICAgICAgZXNjKHYpICtcbiAgICAgICAgJzwvb3B0aW9uPic7XG4gICAgdmVuZFNlbCA9XG4gICAgICAnPHNlbGVjdCBpZD1cInBkbS12ZW5kZWRvclwiIGNsYXNzPVwicGRtLWlucHV0XCIgYXJpYS1sYWJlbD1cIlZlbmRlZG9yXCI+JyArIG9wdHMgKyAnPC9zZWxlY3Q+JztcbiAgfVxuICBib3guaW5uZXJIVE1MID1cbiAgICAnPHNlbGVjdCBpZD1cInBkbS1tZXNcIiBjbGFzcz1cInBkbS1pbnB1dFwiIGFyaWEtbGFiZWw9XCJNZXNcIj4nICtcbiAgICBtZXNPcHRzICtcbiAgICAnPC9zZWxlY3Q+JyArXG4gICAgJzxzZWxlY3QgaWQ9XCJwZG0tYW5pb1wiIGNsYXNzPVwicGRtLWlucHV0XCIgYXJpYS1sYWJlbD1cIkFcdTAwRjFvXCI+JyArXG4gICAgYW5pb09wdHMgK1xuICAgICc8L3NlbGVjdD4nICtcbiAgICAnPGlucHV0IGlkPVwicGRtLXFcIiBjbGFzcz1cInBkbS1pbnB1dCBwZG0tcVwiIHR5cGU9XCJzZWFyY2hcIiBwbGFjZWhvbGRlcj1cIkJ1c2NhciBjbGllbnRlLCBjXHUwMEYzZGlnbyBvIGxvY2FsaWRhZFwiIHZhbHVlPVwiJyArXG4gICAgZXNjKHN0YXRlLnEpICtcbiAgICAnXCIgYXJpYS1sYWJlbD1cIkJ1c2NhciBjbGllbnRlXCIgLz4nICtcbiAgICB2ZW5kU2VsO1xufVxuXG5mdW5jdGlvbiBfcmVuZGVyS3BpcyhsaXN0YSkge1xuICBjb25zdCBrID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3BkbS1rcGlzJyk7XG4gIGlmICghaykgcmV0dXJuO1xuICBpZiAoIXN0YXRlLmRhdGEpIHtcbiAgICBrLmlubmVySFRNTCA9ICcnO1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCB0ID0gdG90YWxlc0RlKGxpc3RhKTtcbiAgY29uc3QgYWxjID0gc3RhdGUuZGF0YS5hbGNhbmNlIHx8IHt9O1xuICBrLmlubmVySFRNTCA9XG4gICAgJzxzcGFuIGNsYXNzPVwicGRtLWtwaVwiPjxiPicgK1xuICAgIHQuY2xpZW50ZXMgK1xuICAgICc8L2I+IGNsaWVudGUnICtcbiAgICAodC5jbGllbnRlcyA9PT0gMSA/ICcnIDogJ3MnKSArXG4gICAgJyBjb24gZmFjdHVyYWNpXHUwMEYzbjwvc3Bhbj4nICtcbiAgICAnPHNwYW4gY2xhc3M9XCJwZG0ta3BpXCI+PGI+JyArXG4gICAgdC5za3VzICtcbiAgICAnPC9iPiBTS1UgZmFjdHVyYWRvczwvc3Bhbj4nICtcbiAgICAnPHNwYW4gY2xhc3M9XCJwZG0ta3BpIHBkbS1rcGktYXJzXCI+PGI+JyArXG4gICAgZXNjKGZtdEFycyh0LmFycykpICtcbiAgICAnPC9iPiBmYWN0dXJhZG88L3NwYW4+JyArXG4gICAgJzxzcGFuIGNsYXNzPVwicGRtLWtwaSBwZG0ta3BpLXNjb3BlXCI+JyArXG4gICAgKGFsYy5uYWNpb25hbFxuICAgICAgPyAnVmlzdGEgbmFjaW9uYWwnXG4gICAgICA6IEFycmF5LmlzQXJyYXkoYWxjLnZlbmRlZG9yZXMpICYmIGFsYy52ZW5kZWRvcmVzLmxlbmd0aCA+IDFcbiAgICAgICAgPyAnVHUgem9uYSB5IHR1cyBwYXJlamFzJ1xuICAgICAgICA6ICdUdXMgY2xpZW50ZXMnKSArXG4gICAgJzwvc3Bhbj4nO1xufVxuXG4vKiogQHBhcmFtIHthbnl9IGMgKi9cbmZ1bmN0aW9uIF9kZXRhbGxlSHRtbChjKSB7XG4gIGxldCBoID0gJzx0YWJsZSBjbGFzcz1cInBkbS1kZXRcIj4nO1xuICBoICs9XG4gICAgJzx0aGVhZD48dHI+PHRoPlNLVTwvdGg+PHRoPlByb2R1Y3RvPC90aD48dGggY2xhc3M9XCJudW1cIj5DYW50aWRhZDwvdGg+PHRoIGNsYXNzPVwibnVtXCI+UHJlY2lvIHVuaXRhcmlvPC90aD48dGggY2xhc3M9XCJudW1cIj5TdWJ0b3RhbDwvdGg+PHRoPkZhY3R1cmFzPC90aD48L3RyPjwvdGhlYWQ+PHRib2R5Pic7XG4gIGZvciAoY29uc3QgcyBvZiBjLnNrdXMgfHwgW10pIHtcbiAgICBjb25zdCBkb2NzID0gKHMuZmFjdHVyYXMgfHwgW10pXG4gICAgICAubWFwKChmKSA9PiB7XG4gICAgICAgIGNvbnN0IG5jID0gZi50aXBvID09PSAnTk9UQV9DUkVESVRPJztcbiAgICAgICAgcmV0dXJuIChcbiAgICAgICAgICAnPHNwYW4gY2xhc3M9XCJwZG0tZG9jJyArXG4gICAgICAgICAgKG5jID8gJyBuYycgOiAnJykgK1xuICAgICAgICAgICdcIiB0aXRsZT1cIicgK1xuICAgICAgICAgIGVzYyhcbiAgICAgICAgICAgIChuYyA/ICdOb3RhIGRlIGNyXHUwMEU5ZGl0byAnIDogJ0ZhY3R1cmEgJykgK1xuICAgICAgICAgICAgICBmLm51bWVybyArXG4gICAgICAgICAgICAgICcgXHUwMEI3ICcgK1xuICAgICAgICAgICAgICBmbXRGZWNoYShmLmZlY2hhKSArXG4gICAgICAgICAgICAgICcgXHUwMEI3ICcgK1xuICAgICAgICAgICAgICBmbXRVZHMoZi51ZHMpICtcbiAgICAgICAgICAgICAgJyB1IFx1MDBCNyAnICtcbiAgICAgICAgICAgICAgZm10QXJzKGYuYXJzKVxuICAgICAgICAgICkgK1xuICAgICAgICAgICdcIj4nICtcbiAgICAgICAgICAobmMgPyAnTkMgJyA6ICdGICcpICtcbiAgICAgICAgICBlc2MoZi5udW1lcm8pICtcbiAgICAgICAgICAnPC9zcGFuPidcbiAgICAgICAgKTtcbiAgICAgIH0pXG4gICAgICAuam9pbignICcpO1xuICAgIGggKz1cbiAgICAgICc8dHI+PHRkIGNsYXNzPVwibW9ub1wiPicgK1xuICAgICAgZXNjKHMuc2t1KSArXG4gICAgICAnPC90ZD48dGQ+JyArXG4gICAgICBlc2Mocy5kZXNjIHx8ICcoc2luIGRlc2NyaXBjaVx1MDBGM24pJykgK1xuICAgICAgJzwvdGQ+PHRkIGNsYXNzPVwibnVtXCI+JyArXG4gICAgICBlc2MoZm10VWRzKHMudWRzKSkgK1xuICAgICAgJzwvdGQ+PHRkIGNsYXNzPVwibnVtXCI+JyArXG4gICAgICAocy5wcmVjaW8gPT0gbnVsbCA/ICctJyA6IGVzYyhmbXRBcnMocy5wcmVjaW8pKSkgK1xuICAgICAgJzwvdGQ+PHRkIGNsYXNzPVwibnVtXCI+JyArXG4gICAgICBlc2MoZm10QXJzKHMuYXJzKSkgK1xuICAgICAgJzwvdGQ+PHRkPicgK1xuICAgICAgZG9jcyArXG4gICAgICAnPC90ZD48L3RyPic7XG4gIH1cbiAgaCArPVxuICAgICc8L3Rib2R5Pjx0Zm9vdD48dHI+PHRkIGNvbHNwYW49XCIyXCI+VG90YWw6ICcgK1xuICAgIGMuc2t1Q291bnQgK1xuICAgICcgU0tVIFx1MDBCNyAnICtcbiAgICBjLmZhY3R1cmFzQ291bnQgK1xuICAgICcgZmFjdHVyYScgK1xuICAgIChjLmZhY3R1cmFzQ291bnQgPT09IDEgPyAnJyA6ICdzJyk7XG4gIGlmIChjLm5vdGFzQ3JlZGl0b0NvdW50KVxuICAgIGggKz1cbiAgICAgICcgXHUwMEI3ICcgK1xuICAgICAgYy5ub3Rhc0NyZWRpdG9Db3VudCArXG4gICAgICAnIG5vdGEnICtcbiAgICAgIChjLm5vdGFzQ3JlZGl0b0NvdW50ID09PSAxID8gJycgOiAncycpICtcbiAgICAgICcgZGUgY3JcdTAwRTlkaXRvJztcbiAgaCArPVxuICAgICc8L3RkPjx0ZCBjbGFzcz1cIm51bVwiPicgK1xuICAgIGVzYyhmbXRVZHMoYy50b3RhbFVkcykpICtcbiAgICAnPC90ZD48dGQ+PC90ZD48dGQgY2xhc3M9XCJudW1cIj4nICtcbiAgICBlc2MoZm10QXJzKGMudG90YWxBcnMpKSArXG4gICAgJzwvdGQ+PHRkPjwvdGQ+PC90cj48L3Rmb290PjwvdGFibGU+JztcbiAgcmV0dXJuIGg7XG59XG5cbmZ1bmN0aW9uIF9yZW5kZXJMaXN0YSgpIHtcbiAgY29uc3QgYm9keSA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdwZG0tbGlzdCcpO1xuICBpZiAoIWJvZHkpIHJldHVybjtcbiAgaWYgKHN0YXRlLmxvYWRpbmcpIHtcbiAgICBib2R5LmlubmVySFRNTCA9ICc8ZGl2IGNsYXNzPVwicGRtLW1zZ1wiPkNhcmdhbmRvIGZhY3R1cmFjaVx1MDBGM25cdTIwMjY8L2Rpdj4nO1xuICAgIF9yZW5kZXJLcGlzKFtdKTtcbiAgICByZXR1cm47XG4gIH1cbiAgaWYgKHN0YXRlLmVycm9yKSB7XG4gICAgYm9keS5pbm5lckhUTUwgPSAnPGRpdiBjbGFzcz1cInBkbS1tc2cgcGRtLWVyclwiPicgKyBlc2Moc3RhdGUuZXJyb3IpICsgJzwvZGl2Pic7XG4gICAgX3JlbmRlcktwaXMoW10pO1xuICAgIHJldHVybjtcbiAgfVxuICBpZiAoIXN0YXRlLmRhdGEpIHtcbiAgICBib2R5LmlubmVySFRNTCA9ICcnO1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCBsaXN0YSA9IGZpbHRyYXJDbGllbnRlcyhzdGF0ZS5kYXRhLmNsaWVudGVzLCBzdGF0ZS5xLCBzdGF0ZS52ZW5kZWRvcik7XG4gIF9yZW5kZXJLcGlzKGxpc3RhKTtcbiAgaWYgKCFsaXN0YS5sZW5ndGgpIHtcbiAgICBib2R5LmlubmVySFRNTCA9XG4gICAgICAnPGRpdiBjbGFzcz1cInBkbS1tc2dcIj4nICtcbiAgICAgICgoc3RhdGUuZGF0YS5jbGllbnRlcyB8fCBbXSkubGVuZ3RoXG4gICAgICAgID8gJ05pbmdcdTAwRkFuIGNsaWVudGUgY29pbmNpZGUgY29uIGxhIGJcdTAwRkFzcXVlZGEuJ1xuICAgICAgICA6ICdObyBoYXkgZmFjdHVyYWNpXHUwMEYzbiBlbiAnICsgTUVTRVNbc3RhdGUubWVzIC0gMV0gKyAnICcgKyBzdGF0ZS5hbmlvICsgJy4nKSArXG4gICAgICAnPC9kaXY+JztcbiAgICByZXR1cm47XG4gIH1cbiAgbGV0IGggPVxuICAgICc8dGFibGUgY2xhc3M9XCJwZG0tdGFibGVcIj48dGhlYWQ+PHRyPjx0aD5DbGllbnRlPC90aD48dGg+TG9jYWxpZGFkPC90aD48dGg+UHJvdmluY2lhPC90aD48dGg+VmVuZGVkb3I8L3RoPjx0aCBjbGFzcz1cIm51bVwiPlNLVTwvdGg+PHRoIGNsYXNzPVwibnVtXCI+RmFjdHVyYWRvPC90aD48L3RyPjwvdGhlYWQ+PHRib2R5Pic7XG4gIGZvciAoY29uc3QgYyBvZiBsaXN0YS5zbGljZSgwLCBNQVhfQ0xJRU5URVNfUkVOREVSKSkge1xuICAgIGNvbnN0IGFiaWVydG8gPSBzdGF0ZS5hYmllcnRvcy5oYXMoYy5jYXJkQ29kZSk7XG4gICAgaCArPVxuICAgICAgJzx0ciBjbGFzcz1cInBkbS1yb3cnICtcbiAgICAgIChhYmllcnRvID8gJyBvcGVuJyA6ICcnKSArXG4gICAgICAnXCIgZGF0YS1jYz1cIicgK1xuICAgICAgZXNjKGMuY2FyZENvZGUpICtcbiAgICAgICdcIiB0YWJpbmRleD1cIjBcIiByb2xlPVwiYnV0dG9uXCIgYXJpYS1leHBhbmRlZD1cIicgK1xuICAgICAgYWJpZXJ0byArXG4gICAgICAnXCI+PHRkPjxkaXYgY2xhc3M9XCJwZG0tY2xpXCI+PHNwYW4gY2xhc3M9XCJwZG0tY2FyZXRcIj4nICtcbiAgICAgIChhYmllcnRvID8gJ1x1MjVCQycgOiAnXHUyNUI2JykgK1xuICAgICAgJzwvc3Bhbj48ZGl2PjxkaXYgY2xhc3M9XCJwZG0tbm9tYnJlXCI+JyArXG4gICAgICBlc2MoYy5ub21icmUpICtcbiAgICAgICc8L2Rpdj48ZGl2IGNsYXNzPVwicGRtLWNvZGVcIj4nICtcbiAgICAgIGVzYyhjLmNhcmRDb2RlKSArXG4gICAgICAnPC9kaXY+PC9kaXY+PC9kaXY+PC90ZD48dGQ+JyArXG4gICAgICBlc2MoYy5sb2NhbGlkYWQgfHwgJy0nKSArXG4gICAgICAnPC90ZD48dGQ+JyArXG4gICAgICBlc2MoYy5wcm92aW5jaWEgfHwgJy0nKSArXG4gICAgICAnPC90ZD48dGQ+JyArXG4gICAgICBlc2MoYy52ZW5kZWRvciB8fCAnLScpICtcbiAgICAgICc8L3RkPjx0ZCBjbGFzcz1cIm51bVwiPicgK1xuICAgICAgYy5za3VDb3VudCArXG4gICAgICAnPC90ZD48dGQgY2xhc3M9XCJudW0gcGRtLWFyc1wiPicgK1xuICAgICAgZXNjKGZtdEFycyhjLnRvdGFsQXJzKSkgK1xuICAgICAgJzwvdGQ+PC90cj4nO1xuICAgIGggKz1cbiAgICAgICc8dHIgY2xhc3M9XCJwZG0tZGV0LXJvd1wiIGRhdGEtZm9yPVwiJyArXG4gICAgICBlc2MoYy5jYXJkQ29kZSkgK1xuICAgICAgJ1wiJyArXG4gICAgICAoYWJpZXJ0byA/ICcnIDogJyBzdHlsZT1cImRpc3BsYXk6bm9uZVwiJykgK1xuICAgICAgJz48dGQgY29sc3Bhbj1cIjZcIj4nICtcbiAgICAgIChhYmllcnRvID8gX2RldGFsbGVIdG1sKGMpIDogJycpICtcbiAgICAgICc8L3RkPjwvdHI+JztcbiAgfVxuICBoICs9ICc8L3Rib2R5PjwvdGFibGU+JztcbiAgaWYgKGxpc3RhLmxlbmd0aCA+IE1BWF9DTElFTlRFU19SRU5ERVIpXG4gICAgaCArPVxuICAgICAgJzxkaXYgY2xhc3M9XCJwZG0tbXNnXCI+TW9zdHJhbmRvICcgK1xuICAgICAgTUFYX0NMSUVOVEVTX1JFTkRFUiArXG4gICAgICAnIGRlICcgK1xuICAgICAgbGlzdGEubGVuZ3RoICtcbiAgICAgICcgY2xpZW50ZXMuIFVzXHUwMEUxIGVsIGJ1c2NhZG9yIHBhcmEgZW5jb250cmFyIGVsIHJlc3RvLjwvZGl2Pic7XG4gIGJvZHkuaW5uZXJIVE1MID0gaDtcbn1cblxuZnVuY3Rpb24gcmVuZGVyKCkge1xuICBfcmVuZGVyRmlsdHJvcygpO1xuICBfcmVuZGVyTGlzdGEoKTtcbn1cblxuLyoqIEBwYXJhbSB7c3RyaW5nfSBjYyAqL1xuZnVuY3Rpb24gX3RvZ2dsZShjYykge1xuICBjb25zdCBib2R5ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3BkbS1saXN0Jyk7XG4gIGlmICghYm9keSB8fCAhc3RhdGUuZGF0YSkgcmV0dXJuO1xuICBjb25zdCByb3cgPSAvKiogQHR5cGUge0hUTUxFbGVtZW50fG51bGx9ICovIChcbiAgICBBcnJheS5mcm9tKGJvZHkucXVlcnlTZWxlY3RvckFsbCgndHIucGRtLXJvdycpKS5maW5kKFxuICAgICAgKHIpID0+IC8qKiBAdHlwZSB7SFRNTEVsZW1lbnR9ICovIChyKS5kYXRhc2V0LmNjID09PSBjY1xuICAgICkgfHwgbnVsbFxuICApO1xuICBjb25zdCBkZXQgPSByb3cgPyAvKiogQHR5cGUge0hUTUxFbGVtZW50fG51bGx9ICovIChyb3cubmV4dEVsZW1lbnRTaWJsaW5nKSA6IG51bGw7XG4gIGlmICghcm93IHx8ICFkZXQpIHJldHVybjtcbiAgY29uc3QgYWJyaXIgPSAhc3RhdGUuYWJpZXJ0b3MuaGFzKGNjKTtcbiAgaWYgKGFicmlyKSB7XG4gICAgc3RhdGUuYWJpZXJ0b3MuYWRkKGNjKTtcbiAgICBjb25zdCBjID0gKHN0YXRlLmRhdGEuY2xpZW50ZXMgfHwgW10pLmZpbmQoKHgpID0+IHguY2FyZENvZGUgPT09IGNjKTtcbiAgICBjb25zdCB0ZCA9IGRldC5xdWVyeVNlbGVjdG9yKCd0ZCcpO1xuICAgIGlmICh0ZCAmJiBjKSB0ZC5pbm5lckhUTUwgPSBfZGV0YWxsZUh0bWwoYyk7XG4gICAgZGV0LnN0eWxlLmRpc3BsYXkgPSAnJztcbiAgfSBlbHNlIHtcbiAgICBzdGF0ZS5hYmllcnRvcy5kZWxldGUoY2MpO1xuICAgIGRldC5zdHlsZS5kaXNwbGF5ID0gJ25vbmUnO1xuICB9XG4gIHJvdy5jbGFzc0xpc3QudG9nZ2xlKCdvcGVuJywgYWJyaXIpO1xuICByb3cuc2V0QXR0cmlidXRlKCdhcmlhLWV4cGFuZGVkJywgU3RyaW5nKGFicmlyKSk7XG4gIGNvbnN0IGNhcmV0ID0gcm93LnF1ZXJ5U2VsZWN0b3IoJy5wZG0tY2FyZXQnKTtcbiAgaWYgKGNhcmV0KSBjYXJldC50ZXh0Q29udGVudCA9IGFicmlyID8gJ1x1MjVCQycgOiAnXHUyNUI2Jztcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBEYXRvc1xuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKiBAcGFyYW0ge2FueX0gZSAqL1xuZnVuY3Rpb24gX2Vycm9yTXNnKGUpIHtcbiAgY29uc3QgY29kZSA9IFN0cmluZygoZSAmJiBlLmNvZGUpIHx8ICcnKTtcbiAgaWYgKGNvZGUuaW5jbHVkZXMoJ3Blcm1pc3Npb24tZGVuaWVkJykpXG4gICAgcmV0dXJuICdUdSB1c3VhcmlvIG5vIHRpZW5lIGFjY2VzbyBhIFBlZGlkb3MgZGVsIG1lcy4gU2kgbG8gbmVjZXNpdFx1MDBFMXMsIGF2aXNhbGUgYSBNYXJpYW5vLic7XG4gIGlmIChjb2RlLmluY2x1ZGVzKCdpbnZhbGlkLWFyZ3VtZW50JykpIHJldHVybiAnRWwgcGVyXHUwMEVEb2RvIGVsZWdpZG8gbm8gZXMgdlx1MDBFMWxpZG8uJztcbiAgcmV0dXJuICdObyBwdWRpbW9zIHRyYWVyIGxhIGZhY3R1cmFjaVx1MDBGM24uIFZvbHZcdTAwRTkgYSBpbnRlbnRhciBlbiB1biBtaW51dG87IHNpIHNpZ3VlLCBhdmlzYWxlIGEgTWFyaWFuby4nO1xufVxuXG5hc3luYyBmdW5jdGlvbiBjYXJnYXIoKSB7XG4gIGNvbnN0IHNlcSA9ICsrc3RhdGUucmVxU2VxO1xuICBzdGF0ZS5sb2FkaW5nID0gdHJ1ZTtcbiAgc3RhdGUuZXJyb3IgPSAnJztcbiAgc3RhdGUuZGF0YSA9IG51bGw7XG4gIHN0YXRlLmFiaWVydG9zID0gbmV3IFNldCgpO1xuICByZW5kZXIoKTtcbiAgdHJ5IHtcbiAgICBpZiAodHlwZW9mIGZpcmViYXNlID09PSAndW5kZWZpbmVkJyB8fCAhZmlyZWJhc2UuYXBwKSB0aHJvdyBuZXcgRXJyb3IoJ2ZpcmViYXNlIG5vIGRpc3BvbmlibGUnKTtcbiAgICBjb25zdCBjYWxsYWJsZSA9IGZpcmViYXNlLmFwcCgpLmZ1bmN0aW9ucyhSRUdJT04pLmh0dHBzQ2FsbGFibGUoJ3BlZGlkb3NEZWxNZXNDRicpO1xuICAgIGNvbnN0IHJlcyA9IGF3YWl0IGNhbGxhYmxlKHsgYW5pbzogc3RhdGUuYW5pbywgbWVzOiBzdGF0ZS5tZXMgfSk7XG4gICAgaWYgKHNlcSAhPT0gc3RhdGUucmVxU2VxKSByZXR1cm47XG4gICAgc3RhdGUuZGF0YSA9IChyZXMgJiYgcmVzLmRhdGEpIHx8IG51bGw7XG4gICAgLy8gU2kgZWwgdmVuZGVkb3IgZWxlZ2lkbyBubyB0aWVuZSBmYWN0dXJhY2lcdTAwRjNuIGVuIGVsIG51ZXZvIHBlclx1MDBFRG9kbywgc2UgbGltcGlhLlxuICAgIGlmIChcbiAgICAgIHN0YXRlLnZlbmRlZG9yICYmXG4gICAgICAhKChzdGF0ZS5kYXRhICYmIHN0YXRlLmRhdGEuY2xpZW50ZXMpIHx8IFtdKS5zb21lKChjKSA9PiBjLnZlbmRlZG9yID09PSBzdGF0ZS52ZW5kZWRvcilcbiAgICApXG4gICAgICBzdGF0ZS52ZW5kZWRvciA9ICcnO1xuICB9IGNhdGNoIChlKSB7XG4gICAgaWYgKHNlcSAhPT0gc3RhdGUucmVxU2VxKSByZXR1cm47XG4gICAgY29uc29sZS5lcnJvcignW3BlZGlkb3MtZGVsLW1lc10gcGVkaWRvc0RlbE1lc0NGIGZhbGxvOicsIGUpO1xuICAgIHN0YXRlLmVycm9yID0gX2Vycm9yTXNnKGUpO1xuICB9IGZpbmFsbHkge1xuICAgIGlmIChzZXEgPT09IHN0YXRlLnJlcVNlcSkge1xuICAgICAgc3RhdGUubG9hZGluZyA9IGZhbHNlO1xuICAgICAgcmVuZGVyKCk7XG4gICAgfVxuICB9XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gRXZlbnRvcyAoZGVsZWdhZG9zIHNvYnJlIGVsIG1vZGFsOyBzZSBlbmdhbmNoYW4gdW5hIHNvbGEgdmV6KVxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmZ1bmN0aW9uIF93aXJlKCkge1xuICBjb25zdCBtb2RhbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdwZWRpZG9zLW1lcy1tb2RhbCcpO1xuICBpZiAoIW1vZGFsIHx8IG1vZGFsLmRhdGFzZXQucGRtV2lyZWQgPT09ICcxJykgcmV0dXJuO1xuICBtb2RhbC5kYXRhc2V0LnBkbVdpcmVkID0gJzEnO1xuICBtb2RhbC5hZGRFdmVudExpc3RlbmVyKCdjaGFuZ2UnLCAoZXYpID0+IHtcbiAgICBjb25zdCB0ID0gLyoqIEB0eXBlIHtIVE1MSW5wdXRFbGVtZW50fSAqLyAoZXYudGFyZ2V0KTtcbiAgICBpZiAoIXQgfHwgIXQuaWQpIHJldHVybjtcbiAgICBpZiAodC5pZCA9PT0gJ3BkbS1tZXMnIHx8IHQuaWQgPT09ICdwZG0tYW5pbycpIHtcbiAgICAgIGNvbnN0IGFjdHVhbCA9IF9tZXNBY3R1YWwoKTtcbiAgICAgIHN0YXRlLm1lcyA9XG4gICAgICAgIE51bWJlcigvKiogQHR5cGUge0hUTUxTZWxlY3RFbGVtZW50fSAqLyAoZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3BkbS1tZXMnKSkudmFsdWUpIHx8XG4gICAgICAgIHN0YXRlLm1lcztcbiAgICAgIHN0YXRlLmFuaW8gPVxuICAgICAgICBOdW1iZXIoLyoqIEB0eXBlIHtIVE1MU2VsZWN0RWxlbWVudH0gKi8gKGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdwZG0tYW5pbycpKS52YWx1ZSkgfHxcbiAgICAgICAgc3RhdGUuYW5pbztcbiAgICAgIC8vIEFcdTAwRjFvIGFjdHVhbCBjb24gdW4gbWVzIGZ1dHVybyBlbGVnaWRvIGFudGVzOiBzZSBsbGV2YSBhbCBtZXMgYWN0dWFsLlxuICAgICAgaWYgKHN0YXRlLmFuaW8gPT09IGFjdHVhbC5hbmlvICYmIHN0YXRlLm1lcyA+IGFjdHVhbC5tZXMpIHN0YXRlLm1lcyA9IGFjdHVhbC5tZXM7XG4gICAgICBjYXJnYXIoKTtcbiAgICB9IGVsc2UgaWYgKHQuaWQgPT09ICdwZG0tdmVuZGVkb3InKSB7XG4gICAgICBzdGF0ZS52ZW5kZWRvciA9IHQudmFsdWUgfHwgJyc7XG4gICAgICBfcmVuZGVyTGlzdGEoKTtcbiAgICB9XG4gIH0pO1xuICBsZXQgZGViID0gMDtcbiAgbW9kYWwuYWRkRXZlbnRMaXN0ZW5lcignaW5wdXQnLCAoZXYpID0+IHtcbiAgICBjb25zdCB0ID0gLyoqIEB0eXBlIHtIVE1MSW5wdXRFbGVtZW50fSAqLyAoZXYudGFyZ2V0KTtcbiAgICBpZiAoIXQgfHwgdC5pZCAhPT0gJ3BkbS1xJykgcmV0dXJuO1xuICAgIGNsZWFyVGltZW91dChkZWIpO1xuICAgIGRlYiA9IC8qKiBAdHlwZSB7YW55fSAqLyAoXG4gICAgICBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgICAgc3RhdGUucSA9IHQudmFsdWUgfHwgJyc7XG4gICAgICAgIF9yZW5kZXJMaXN0YSgpO1xuICAgICAgfSwgMjAwKVxuICAgICk7XG4gIH0pO1xuICBjb25zdCBvblJvdyA9ICgvKiogQHR5cGUge0V2ZW50fSAqLyBldikgPT4ge1xuICAgIGNvbnN0IHRndCA9IC8qKiBAdHlwZSB7SFRNTEVsZW1lbnR9ICovIChldi50YXJnZXQpO1xuICAgIGNvbnN0IHJvdyA9XG4gICAgICB0Z3QgJiYgdGd0LmNsb3Nlc3QgPyAvKiogQHR5cGUge0hUTUxFbGVtZW50fG51bGx9ICovICh0Z3QuY2xvc2VzdCgndHIucGRtLXJvdycpKSA6IG51bGw7XG4gICAgaWYgKCFyb3cpIHJldHVybjtcbiAgICBpZiAoZXYudHlwZSA9PT0gJ2tleWRvd24nKSB7XG4gICAgICBjb25zdCBrID0gLyoqIEB0eXBlIHtLZXlib2FyZEV2ZW50fSAqLyAoZXYpLmtleTtcbiAgICAgIGlmIChrICE9PSAnRW50ZXInICYmIGsgIT09ICcgJykgcmV0dXJuO1xuICAgICAgZXYucHJldmVudERlZmF1bHQoKTtcbiAgICB9XG4gICAgX3RvZ2dsZShyb3cuZGF0YXNldC5jYyB8fCAnJyk7XG4gIH07XG4gIGNvbnN0IGxpc3QgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgncGRtLWxpc3QnKTtcbiAgaWYgKGxpc3QpIHtcbiAgICBsaXN0LmFkZEV2ZW50TGlzdGVuZXIoJ2NsaWNrJywgb25Sb3cpO1xuICAgIGxpc3QuYWRkRXZlbnRMaXN0ZW5lcigna2V5ZG93bicsIG9uUm93KTtcbiAgfVxufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIEFQSSBwXHUwMEZBYmxpY2EgKHN0dWJzIGVuIHNyYy9tYWluLmpzICsgYnVpbGQuanMgTEFaWV9DSFVOS1MpXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxud2luZG93Lm9wZW5QZWRpZG9zRGVsTWVzID0gZnVuY3Rpb24gKCkge1xuICBjb25zdCBtb2RhbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdwZWRpZG9zLW1lcy1tb2RhbCcpO1xuICBpZiAoIW1vZGFsKSByZXR1cm47XG4gIGNvbnN0IHJvbGUgPSBfcm9sZSgpO1xuICBpZiAocm9sZSAhPT0gJ2FkbWluJyAmJiByb2xlICE9PSAnZ2VyZW50ZScgJiYgcm9sZSAhPT0gJ3ZlbmRlZG9yJykge1xuICAgIGFsZXJ0KCdUdSB1c3VhcmlvIG5vIHRpZW5lIGFjY2VzbyBhIFBlZGlkb3MgZGVsIG1lcy4gU2kgbG8gbmVjZXNpdFx1MDBFMXMsIGF2aXNhbGUgYSBNYXJpYW5vLicpO1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCB1aWQgPSBfdWlkKCk7XG4gIGlmICh1aWQgIT09IHN0YXRlLnVpZCkge1xuICAgIHN0YXRlLnVpZCA9IHVpZDtcbiAgICBzdGF0ZS5xID0gJyc7XG4gICAgc3RhdGUudmVuZGVkb3IgPSAnJztcbiAgICBzdGF0ZS5hbmlvID0gMDtcbiAgfVxuICBpZiAoIXN0YXRlLmFuaW8pIHtcbiAgICBjb25zdCBhID0gX21lc0FjdHVhbCgpO1xuICAgIHN0YXRlLmFuaW8gPSBhLmFuaW87XG4gICAgc3RhdGUubWVzID0gYS5tZXM7XG4gIH1cbiAgbW9kYWwuY2xhc3NMaXN0LmFkZCgnb3BlbicpO1xuICBfd2lyZSgpO1xuICBjYXJnYXIoKTtcbn07XG5cbndpbmRvdy5jbG9zZVBlZGlkb3NEZWxNZXMgPSBmdW5jdGlvbiAoKSB7XG4gIGNvbnN0IG1vZGFsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3BlZGlkb3MtbWVzLW1vZGFsJyk7XG4gIGlmIChtb2RhbCkgbW9kYWwuY2xhc3NMaXN0LnJlbW92ZSgnb3BlbicpO1xuICBzdGF0ZS5kYXRhID0gbnVsbDtcbiAgc3RhdGUubG9hZGluZyA9IGZhbHNlO1xuICBzdGF0ZS5yZXFTZXErKztcbn07XG4iXSwKICAibWFwcGluZ3MiOiAiOzs7QUFTTyxXQUFTLE9BQU8sR0FBRztBQUN4QixVQUFNLElBQUksT0FBTyxDQUFDO0FBQ2xCLFFBQUksQ0FBQyxPQUFPLFNBQVMsQ0FBQyxFQUFHLFFBQU87QUFDaEMsVUFBTSxJQUFJLEtBQUssTUFBTSxLQUFLLElBQUksQ0FBQyxDQUFDLEVBQzdCLFNBQVMsRUFDVCxRQUFRLHlCQUF5QixHQUFHO0FBQ3ZDLFlBQVEsSUFBSSxJQUFJLFFBQVEsUUFBUTtBQUFBLEVBQ2xDO0FBR08sV0FBUyxPQUFPLEdBQUc7QUFDeEIsVUFBTSxJQUFJLE9BQU8sQ0FBQztBQUNsQixRQUFJLENBQUMsT0FBTyxTQUFTLENBQUMsRUFBRyxRQUFPO0FBQ2hDLFdBQU8sT0FBTyxVQUFVLENBQUMsSUFBSSxPQUFPLENBQUMsSUFBSSxFQUFFLFFBQVEsQ0FBQyxFQUFFLFFBQVEsS0FBSyxHQUFHO0FBQUEsRUFDeEU7QUFRTyxXQUFTLGdCQUFnQixVQUFVLEdBQUcsVUFBVTtBQUNyRCxVQUFNLEtBQUssT0FBTyxLQUFLLEVBQUUsRUFDdEIsS0FBSyxFQUNMLFlBQVk7QUFDZixVQUFNLElBQUksT0FBTyxZQUFZLEVBQUUsRUFDNUIsS0FBSyxFQUNMLFlBQVk7QUFDZixZQUFRLFlBQVksQ0FBQyxHQUFHLE9BQU8sQ0FBQyxNQUFNO0FBQ3BDLFVBQUksS0FBSyxPQUFPLEVBQUUsWUFBWSxFQUFFLEVBQUUsWUFBWSxNQUFNLEVBQUcsUUFBTztBQUM5RCxVQUFJLENBQUMsR0FBSSxRQUFPO0FBQ2hCLFlBQU0sTUFBTSxD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
