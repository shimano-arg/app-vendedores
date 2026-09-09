"use strict";
(() => {
  // src/domains/forecast.js
  var _forecastSnapshot = null;
  var _forecastSalesPlan = null;
  var _forecastRows = null;
  var _forecastLoading = false;
  var FORECAST_ALLOWED_EMAILS = ["mariano.erbino@shimano.com.ar", "erbinomariano@gmail.com"];
  function _canForecast() {
    try {
      const email = (window.currentUser && window.currentUser.email || "").toLowerCase();
      if (!email) return false;
      return FORECAST_ALLOWED_EMAILS.indexOf(email) >= 0;
    } catch {
      return false;
    }
  }
  function _monthKey(year, monthOneBased) {
    return String(year).padStart(4, "0") + "-" + String(monthOneBased).padStart(2, "0");
  }
  function _addMonths(year, monthOneBased, delta) {
    const totalMonths = year * 12 + (monthOneBased - 1) + delta;
    const y = Math.floor(totalMonths / 12);
    const m = totalMonths % 12 + 1;
    return { y, m };
  }
  function _sumVentas12mCompletos(mesesMap, hoy) {
    if (!mesesMap) return 0;
    let sum = 0;
    const startMonth = _addMonths(hoy.getFullYear(), hoy.getMonth() + 1, -12);
    const endMonth = _addMonths(hoy.getFullYear(), hoy.getMonth() + 1, -1);
    const startKey = _monthKey(startMonth.y, startMonth.m);
    const endKey = _monthKey(endMonth.y, endMonth.m);
    for (const k of Object.keys(mesesMap)) {
      if (k >= startKey && k <= endKey) {
        sum += Number(mesesMap[k] && mesesMap[k].qty || 0);
      }
    }
    return sum;
  }
  function _sumVentasYTD(mesesMap, hoy) {
    const year = hoy.getFullYear();
    const mesActual = hoy.getMonth() + 1;
    let total = 0;
    if (mesesMap) {
      for (let m = 1; m <= mesActual; m++) {
        const k = _monthKey(year, m);
        total += Number(mesesMap[k] && mesesMap[k].qty || 0);
      }
    }
    return { totalYtd: total, mesesTranscurridos: mesActual };
  }
  async function _loadSnapshot() {
    if (_forecastSnapshot) return _forecastSnapshot;
    if (!window.fbDb) throw new Error("Firestore no inicializado");
    const snap = await window.fbDb.collection("sku_ventas_snapshot").get();
    const byOriginalSku = {};
    const byUpperSku = {};
    snap.forEach((doc) => {
      const d = doc.data();
      if (!d || !d.sku) return;
      const skuUpper = String(d.sku).trim().toUpperCase();
      const record = {
        sku: d.sku,
        itemName: d.itemName || "",
        familia: d.familia || "",
        subfamilia: d.subfamilia || "",
        meses: d.meses || {}
      };
      byOriginalSku[d.sku] = record;
      byUpperSku[skuUpper] = record;
    });
    _forecastSnapshot = { byOriginalSku, byUpperSku, count: snap.size };
    return _forecastSnapshot;
  }
  function _parseSalesPlanRows(rowsRaw) {
    if (!rowsRaw || !rowsRaw.length) return [];
    const headerRow = rowsRaw[0];
    let skuColIdx = -1;
    for (let i = 0; i < headerRow.length; i++) {
      const h = String(headerRow[i] || "").trim().toUpperCase();
      if (h === "SKU" || h === "ITEMCODE" || h === "ITEM" || h === "ITEM CODE" || h === "CODIGO") {
        skuColIdx = i;
        break;
      }
    }
    if (skuColIdx < 0)
      throw new Error('El Excel debe tener una columna llamada "SKU" (o Codigo / ItemCode / Item)');
    const monthCols = [];
    for (let i = 0; i < headerRow.length && monthCols.length < 6; i++) {
      if (i !== skuColIdx) monthCols.push(i);
    }
    if (monthCols.length < 6)
      throw new Error(
        "El Excel debe tener al menos 6 columnas de meses ademas de SKU (encontradas: " + monthCols.length + ")"
      );
    const out = [];
    for (let r = 1; r < rowsRaw.length; r++) {
      const row = rowsRaw[r];
      if (!row || !row.length) continue;
      const skuRaw = row[skuColIdx];
      if (skuRaw === void 0 || skuRaw === null || String(skuRaw).trim() === "") continue;
      const sku = String(skuRaw).trim();
      const mesesArr = monthCols.map((i) => {
        const v = row[i];
        const n = Number(v);
        return Number.isFinite(n) ? n : 0;
      });
      const pedidoTotal = mesesArr.reduce((a, b) => a + b, 0);
      out.push({ sku, mesesArr, pedidoTotal });
    }
    return out;
  }
  function _computeForecastRows(snapshot, salesPlan, hoy) {
    const rows = [];
    for (const sp of salesPlan) {
      const skuUpper = sp.sku.toUpperCase();
      const hist = snapshot.byUpperSku[skuUpper] || null;
      const ventas12m = hist ? _sumVentas12mCompletos(hist.meses, hoy) : 0;
      const ytd = hist ? _sumVentasYTD(hist.meses, hoy) : { totalYtd: 0, mesesTranscurridos: hoy.getMonth() + 1 };
      const promedio = ytd.mesesTranscurridos > 0 ? ytd.totalYtd / ytd.mesesTranscurridos : 0;
      const politica = promedio * 3;
      const total = sp.pedidoTotal - politica;
      rows.push({
        sku: sp.sku,
        itemName: hist ? hist.itemName : "",
        familia: hist ? hist.familia : "(sin match)",
        subfamilia: hist ? hist.subfamilia : "(sin match)",
        ventas12m,
        pedido6m: sp.pedidoTotal,
        promedio,
        politica,
        total,
        hasHistoria: !!hist
      });
    }
    return rows;
  }
  function _renderModalShell() {
    const existing = document.getElementById("forecast-modal");
    if (existing) return existing;
    const el = document.createElement("div");
    el.id = "forecast-modal";
    el.className = "modal-overlay";
    el.style.cssText = "display:none;position:fixed;inset:0;background:rgba(15,23,42,.6);z-index:2050;";
    el.onclick = function(ev) {
      if (ev.target === el) window.closeForecastModal();
    };
    el.innerHTML = '<div style="position:absolute;inset:1vh 1vw;background:var(--bg-elevated);border-radius:10px;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 20px 50px rgba(0,0,0,.35)"><div style="padding:12px 18px;background:#0f172a;color:#fff;display:flex;align-items:center;gap:12px"><div style="flex:1"><div style="font-size:16px;font-weight:800;letter-spacing:.5px">FORECAST</div><div id="forecast-subtitle" style="font-size:11px;opacity:.8;margin-top:2px">Cargar Sales Plan para ver la proyeccion vs politica de inventario (3 meses)</div></div><button id="forecast-export-btn" onclick="exportForecastExcel()" disabled style="padding:8px 14px;background:var(--color-success);color:#fff;border:none;border-radius:6px;font-weight:700;cursor:pointer;opacity:.5">Exportar Excel</button><button onclick="closeForecastModal()" style="background:transparent;color:#fff;border:1px solid rgba(255,255,255,.4);border-radius:6px;padding:6px 10px;cursor:pointer;font-weight:700">Cerrar</button></div><div style="padding:12px 18px;background:var(--bg-secondary);border-bottom:1px solid var(--border-subtle);display:flex;flex-wrap:wrap;gap:14px;align-items:center"><label style="display:inline-flex;align-items:center;gap:8px;padding:8px 12px;background:#0d9488;color:#fff;border-radius:6px;font-weight:700;font-size:12px;cursor:pointer"><span>Cargar Sales Plan (.xlsx)</span><input type="file" accept=".xlsx,.xls" style="display:none" onchange="onForecastSalesPlanFile(event)"/></label><div id="forecast-hint" style="font-size:11px;color:var(--text-muted);max-width:520px">Excel esperado: primera columna <b>SKU</b>, luego 6 columnas con las unidades pedidas mes a mes para los proximos 6 meses. Los headers de los meses pueden ser cualquier nombre (Mes1..Mes6, ago-26..ene-27, etc).</div><div id="forecast-stats" style="margin-left:auto;font-size:11px;color:var(--text-secondary);font-weight:600"></div></div><div id="forecast-body" style="flex:1;overflow:auto;padding:0"><div style="padding:60px 20px;text-align:center;color:var(--text-muted);font-size:14px">Esperando archivo Sales Plan...</div></div></div>';
    document.body.appendChild(el);
    return el;
  }
  function _renderTable(rows) {
    const body = document.getElementById("forecast-body");
    if (!body) return;
    if (!rows || !rows.length) {
      body.innerHTML = '<div style="padding:60px 20px;text-align:center;color:var(--text-muted)">Sales Plan vacio o sin filas validas.</div>';
      return;
    }
    const fmt = (n) => n === 0 || !Number.isFinite(n) ? "0" : Number(n).toLocaleString("es-AR", { maximumFractionDigits: 1 });
    const colorForTotal = (t) => {
      if (t > 0) return "#166534";
      if (t < 0) return "#c2410c";
      return "#475569";
    };
    const rowsHtml = rows.map(
      (r) => "<tr" + (r.hasHistoria ? "" : ' style="background:var(--color-warning-bg)"') + '><td style="padding:6px 10px;font-family:monospace;font-size:11px;white-space:nowrap">' + escapeHtmlSafe(r.sku) + '</td><td style="padding:6px 10px;font-size:11px">' + escapeHtmlSafe(r.familia) + '</td><td style="padding:6px 10px;font-size:11px">' + escapeHtmlSafe(r.subfamilia) + '</td><td style="padding:6px 10px;text-align:right;font-variant-numeric:tabular-nums">' + fmt(r.ventas12m) + '</td><td style="padding:6px 10px;text-align:right;font-variant-numeric:tabular-nums;font-weight:600">' + fmt(r.pedido6m) + '</td><td style="padding:6px 10px;text-align:right;font-variant-numeric:tabular-nums;color:var(--text-muted)">' + fmt(r.promedio) + '</td><td style="padding:6px 10px;text-align:right;font-variant-numeric:tabular-nums">' + fmt(r.politica) + '</td><td style="padding:6px 10px;text-align:right;font-variant-numeric:tabular-nums;font-weight:700;color:' + colorForTotal(r.total) + '">' + fmt(r.total) + "</td></tr>"
    ).join("");
    const header = '<thead style="position:sticky;top:0;background:#0f172a;color:#fff;z-index:1"><tr><th style="padding:8px 10px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.4px">SKU</th><th style="padding:8px 10px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.4px">Familia</th><th style="padding:8px 10px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.4px">Subfamilia</th><th style="padding:8px 10px;text-align:right;font-size:11px;text-transform:uppercase;letter-spacing:.4px" title="Suma de qty facturada en los ultimos 12 meses completos">Ventas 12m</th><th style="padding:8px 10px;text-align:right;font-size:11px;text-transform:uppercase;letter-spacing:.4px" title="Suma de las 6 columnas del Excel Sales Plan">Pedido 6m</th><th style="padding:8px 10px;text-align:right;font-size:11px;text-transform:uppercase;letter-spacing:.4px" title="Ventas YTD / meses transcurridos del a\xF1o">Prom / Mes</th><th style="padding:8px 10px;text-align:right;font-size:11px;text-transform:uppercase;letter-spacing:.4px" title="Promedio x 3 meses (politica de inventario)">Politica</th><th style="padding:8px 10px;text-align:right;font-size:11px;text-transform:uppercase;letter-spacing:.4px" title="Pedido 6m - Politica. Negativo = te falta pedir; Positivo = sobrepedido">Total</th></tr></thead>';
    body.innerHTML = '<table style="width:100%;border-collapse:collapse;font-size:12px">' + header + "<tbody>" + rowsHtml + "</tbody></table>";
  }
  function escapeHtmlSafe(s) {
    if (typeof window.escapeHtml === "function") return window.escapeHtml(s);
    return String(s == null ? "" : s).replace(
      /[&<>"']/g,
      (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]
    );
  }
  window.openForecastModal = async function() {
    if (!_canForecast()) {
      alert("FORECAST es solo para Mariano (admin).");
      return;
    }
    const el = _renderModalShell();
    el.style.display = "block";
    if (_forecastLoading) return;
    if (!_forecastSnapshot) {
      _forecastLoading = true;
      const stats = document.getElementById("forecast-stats");
      if (stats) stats.textContent = "Cargando snapshot de ventas...";
      try {
        await _loadSnapshot();
        if (stats) stats.textContent = _forecastSnapshot.count + " SKUs en snapshot historico";
      } catch (e) {
        if (stats) stats.textContent = "Error cargando snapshot: " + (e && e.message || e);
        alert(
          "No se pudo cargar sku_ventas_snapshot. Chequea que el bootstrap Python ya haya corrido (scripts/apply_sku_ventas_snapshot.py) y que tengas rol admin."
        );
      } finally {
        _forecastLoading = false;
      }
    } else {
      const stats = document.getElementById("forecast-stats");
      if (stats) stats.textContent = _forecastSnapshot.count + " SKUs en snapshot historico";
    }
  };
  window.closeForecastModal = function() {
    const el = document.getElementById("forecast-modal");
    if (el) el.style.display = "none";
  };
  window.onForecastSalesPlanFile = async function(event) {
    const file = event && event.target && event.target.files && event.target.files[0];
    if (!file) return;
    try {
      if (!_forecastSnapshot) await _loadSnapshot();
      const buf = await file.arrayBuffer();
      if (typeof XLSX === "undefined") {
        alert("XLSX no cargado");
        return;
      }
      const wb = XLSX.read(buf, { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true });
      const parsed = _parseSalesPlanRows(rows);
      if (!parsed.length) {
        alert("El Excel esta vacio o no tiene filas validas.");
        return;
      }
      _forecastSalesPlan = parsed;
      const hoy = /* @__PURE__ */ new Date();
      _forecastRows = _computeForecastRows(_forecastSnapshot, parsed, hoy);
      _renderTable(_forecastRows);
      const sinMatch = _forecastRows.filter((r) => !r.hasHistoria).length;
      const stats = document.getElementById("forecast-stats");
      if (stats) {
        stats.textContent = parsed.length + " SKUs en Sales Plan \xB7 " + (parsed.length - sinMatch) + " con historia \xB7 " + sinMatch + " sin match (fondo amarillo)";
      }
      const btn = document.getElementById("forecast-export-btn");
      if (btn) {
        btn.disabled = false;
        btn.style.opacity = "1";
      }
    } catch (e) {
      console.error("[FORECAST] parse error:", e);
      alert("Error procesando el Excel:\n" + (e && e.message || e));
    } finally {
      if (event && event.target) event.target.value = "";
    }
  };
  window.exportForecastExcel = function() {
    if (!_forecastRows || !_forecastRows.length) {
      alert("No hay datos para exportar. Carga primero el Sales Plan.");
      return;
    }
    if (typeof XLSX === "undefined") {
      alert("XLSX no cargado");
      return;
    }
    const round1 = (n) => Math.round(Number(n || 0) * 10) / 10;
    const aoa = [
      [
        "SKU",
        "FAMILIA",
        "SUBFAMILIA",
        "VENTAS (12m)",
        "PEDIDO-SALES PLANS (6m)",
        "PROMEDIO DE INVENTARIO",
        "POLITICA DE INVENTARIO (3m)",
        "TOTAL"
      ]
    ];
    for (const r of _forecastRows) {
      aoa.push([
        r.sku,
        r.familia,
        r.subfamilia,
        round1(r.ventas12m),
        round1(r.pedido6m),
        round1(r.promedio),
        round1(r.politica),
        round1(r.total)
      ]);
    }
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = [
      { wch: 18 },
      { wch: 24 },
      { wch: 24 },
      { wch: 14 },
      { wch: 20 },
      { wch: 20 },
      { wch: 22 },
      { wch: 12 }
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "FORECAST");
    const hoy = /* @__PURE__ */ new Date();
    const stamp = hoy.getFullYear() + "-" + String(hoy.getMonth() + 1).padStart(2, "0") + "-" + String(hoy.getDate()).padStart(2, "0");
    XLSX.writeFile(wb, "Forecast_Shimano_" + stamp + ".xlsx");
  };
  window.reloadForecastSnapshot = async function() {
    _forecastSnapshot = null;
    await _loadSnapshot();
    if (_forecastSalesPlan) {
      const hoy = /* @__PURE__ */ new Date();
      _forecastRows = _computeForecastRows(_forecastSnapshot, _forecastSalesPlan, hoy);
      _renderTable(_forecastRows);
    }
  };
})();
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL2RvbWFpbnMvZm9yZWNhc3QuanMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbIi8vIEB0cy1ub2NoZWNrXG4vLyBHbG9iYWxzIGxlaWRvcyBkZWwgZW50b3JubyAoZGVjbGFyYWRvcyBlbiBpbmRleC5odG1sIGlubGluZSBvIGJ1bmRsZSBwcmV2aW8pOlxuLy8gZmJEYiwgY3VycmVudFVzZXIsIFhMU1ggKGNkbiksIGVzY2FwZUh0bWwuIE1pc21vIHBhdHJvbiBxdWUgb3Ryb3MgZG9taW5pb3MuXG4vL1xuLy8gRk9SRUNBU1QgLSBtb2RhbCBhZG1pbi1vbmx5IChNYXJpYW5vKSBxdWUgY29tcGFyYSB2ZW50YXMgaGlzdG9yaWNhc1xuLy8gKEZpcmVzdG9yZSBza3VfdmVudGFzX3NuYXBzaG90LCBhbGltZW50YWRvIHBvciBzeW5jIEJRIHZfdmVudGFzX2xpbmVhc1xuLy8gdmVudGFuYSAxM20pIHZzIFNhbGVzIFBsYW4gY2FyZ2FkbyBwb3IgZWwgdXNlciB2aWEgRXhjZWwgKyBwb2xpdGljYSBkZVxuLy8gaW52ZW50YXJpbyAocHJvbWVkaW8gWVREIHggMyBtZXNlcykuXG4vL1xuLy8gQ2h1bmsgbGF6eTogc2UgY2FyZ2Egc29sbyBhbCBwcmltZXIgY2xpY2sgZGVsIGJvdG9uIEZPUkVDQVNUIGRlbCBoZWFkZXIuXG4vLyBSZWdpc3RyYWRvIGVuIGJ1aWxkLmpzIExBWllfQ0hVTktTICsgc3JjL21haW4uanMgaW5zdGFsbENodW5rU3R1YnMgKyBzdy5qc1xuLy8gU1RBVElDX0FTU0VUUy4gVmVyIENMQVVERS5tZCAjMTggKDMgbHVnYXJlcyBzaW5jcm9uaXphZG9zKS5cbi8vXG4vLyBDb250cmF0byBkZWwgRXhjZWwgU2FsZXMgUGxhbiBxdWUgc3ViZSBlbCB1c2VyOlxuLy8gICBDb2x1bW5hczogU0tVIHwgTWVzMSB8IE1lczIgfCBNZXMzIHwgTWVzNCB8IE1lczUgfCBNZXM2XG4vLyAgIChub21icmVzIGV4YWN0b3MgZGUgaGVhZGVycyBjYXNlLWluc2Vuc2l0aXZlOyBNZXMxLi42IHNvbiBsb3MgcHJveGltb3Ncbi8vICAgNiBtZXNlcyBkZXNkZSBlbCBtZXMgYWN0dWFsKS4gVW5hIGZpbGEgcG9yIFNLVS5cbi8vXG4vLyBGdWVudGUgZGUgZGF0b3MgaGlzdG9yaWNhczpcbi8vICAgRmlyZXN0b3JlIC9za3VfdmVudGFzX3NuYXBzaG90L3tTS1VfPHNrdV9zYW5lYWRvPn1cbi8vICAge1xuLy8gICAgIHNrdSwgaXRlbU5hbWUsIGZhbWlsaWEsIHN1YmZhbWlsaWEsXG4vLyAgICAgbWVzZXM6IHsgJzIwMjUtMDgnOiB7cXR5LCBhcnN9LCAuLi4sICcyMDI2LTA4Jzoge3F0eSwgYXJzfSB9XG4vLyAgIH1cbi8vICAgUnVsZXM6IHJlYWQgYWRtaW4tb25seSAoY29tcGV0aXRpdmVseSBzZW5zaXRpdmUpLiBFc2NyaXRvIHBvciBjcm9uXG4vLyAgIHN5bmNfc2FwX3RvX2JpZ3F1ZXJ5LnB5IGNhZGEgMzAgbWluLlxuXG4vLyBFc3RhZG8gZGVsIG1vZGFsIChpbnRyYS1jaHVuaywgbm8gY3Jvc3Mtc2NvcGUpLlxubGV0IF9mb3JlY2FzdFNuYXBzaG90ID0gbnVsbDsgLy8geyBTS1U6IHtmYW1pbGlhLCBzdWJmYW1pbGlhLCBpdGVtTmFtZSwgbWVzZXN9IH1cbmxldCBfZm9yZWNhc3RTYWxlc1BsYW4gPSBudWxsOyAvLyBbeyBza3UsIHBlZGlkb1RvdGFsLCBtZXNlc0FycjogW24xLi5uNl0gfV1cbmxldCBfZm9yZWNhc3RSb3dzID0gbnVsbDsgLy8gZmlsYXMgZmluYWxlcyBjYWxjdWxhZGFzIHBhcmEgcHJldmlldyArIGV4cG9ydFxubGV0IF9mb3JlY2FzdExvYWRpbmcgPSBmYWxzZTtcblxuLy8gV2hpdGVsaXN0IGRlIGVtYWlscyBjb24gYWNjZXNvIGFsIG1vZGFsIEZPUkVDQVNULiBSZXBsaWNhIGVsIHBhdHJvbiBkZVxuLy8gXCJBbmFsaXNpc1wiIChpbmRleC5odG1sOjEyNjI1KS4gU29sbyBNYXJpYW5vOyBzaSBvdHJvIGFkbWluIGxvIG5lY2VzaXRhXG4vLyBzZSBhZ3JlZ2EgYWNhIGV4cGxpY2l0by5cbmNvbnN0IEZPUkVDQVNUX0FMTE9XRURfRU1BSUxTID0gWydtYXJpYW5vLmVyYmlub0BzaGltYW5vLmNvbS5hcicsICdlcmJpbm9tYXJpYW5vQGdtYWlsLmNvbSddO1xuXG5mdW5jdGlvbiBfY2FuRm9yZWNhc3QoKSB7XG4gIHRyeSB7XG4gICAgY29uc3QgZW1haWwgPSAoKHdpbmRvdy5jdXJyZW50VXNlciAmJiB3aW5kb3cuY3VycmVudFVzZXIuZW1haWwpIHx8ICcnKS50b0xvd2VyQ2FzZSgpO1xuICAgIGlmICghZW1haWwpIHJldHVybiBmYWxzZTtcbiAgICByZXR1cm4gRk9SRUNBU1RfQUxMT1dFRF9FTUFJTFMuaW5kZXhPZihlbWFpbCkgPj0gMDtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG59XG5cbi8vIEhlbHBlcnMgZGUgbWVzIGNhbGVuZGFyLlxuZnVuY3Rpb24gX21vbnRoS2V5KHllYXIsIG1vbnRoT25lQmFzZWQpIHtcbiAgcmV0dXJuIFN0cmluZyh5ZWFyKS5wYWRTdGFydCg0LCAnMCcpICsgJy0nICsgU3RyaW5nKG1vbnRoT25lQmFzZWQpLnBhZFN0YXJ0KDIsICcwJyk7XG59XG5mdW5jdGlvbiBfbW9udGhMYWJlbChrZXkpIHtcbiAgLy8gJzIwMjYtMDgnIC0+ICdhZ28tMjYnXG4gIGNvbnN0IFt5LCBtXSA9IGtleS5zcGxpdCgnLScpLm1hcChOdW1iZXIpO1xuICBjb25zdCBuYW1lcyA9IFtcbiAgICAnZW5lJyxcbiAgICAnZmViJyxcbiAgICAnbWFyJyxcbiAgICAnYWJyJyxcbiAgICAnbWF5JyxcbiAgICAnanVuJyxcbiAgICAnanVsJyxcbiAgICAnYWdvJyxcbiAgICAnc2VwJyxcbiAgICAnb2N0JyxcbiAgICAnbm92JyxcbiAgICAnZGljJyxcbiAgXTtcbiAgcmV0dXJuIG5hbWVzW20gLSAxXSArICctJyArIFN0cmluZyh5KS5zbGljZSgtMik7XG59XG5mdW5jdGlvbiBfYWRkTW9udGhzKHllYXIsIG1vbnRoT25lQmFzZWQsIGRlbHRhKSB7XG4gIGNvbnN0IHRvdGFsTW9udGhzID0geWVhciAqIDEyICsgKG1vbnRoT25lQmFzZWQgLSAxKSArIGRlbHRhO1xuICBjb25zdCB5ID0gTWF0aC5mbG9vcih0b3RhbE1vbnRocyAvIDEyKTtcbiAgY29uc3QgbSA9ICh0b3RhbE1vbnRocyAlIDEyKSArIDE7XG4gIHJldHVybiB7IHksIG0gfTtcbn1cblxuLy8gU3VtYSBxdHkgZGVsIFNLVSBlbiBsb3MgdWx0aW1vcyAxMiBNRVNFUyBDT01QTEVUT1MgKGV4Y2x1eWUgZWwgbWVzIGFjdHVhbFxuLy8gcGFyY2lhbCAtIGxhIHZlbnRhbmEgbW92aWwgXCIxMiBtZXNlcyBjZXJyYWRvc1wiIHF1ZSBlbCB1c2VyIHBpZW5zYSBjb21vXG4vLyBcImVsIGFcdTAwRjFvIHF1ZSB5YSBwYXNvXCIpLiBFamVtcGxvIGVuIGFnb3N0byAyMDI2OiBzdW1hciBhZ28tMjUgYSBqdWwtMjYuXG5mdW5jdGlvbiBfc3VtVmVudGFzMTJtQ29tcGxldG9zKG1lc2VzTWFwLCBob3kpIHtcbiAgaWYgKCFtZXNlc01hcCkgcmV0dXJuIDA7XG4gIGxldCBzdW0gPSAwO1xuICBjb25zdCBzdGFydE1vbnRoID0gX2FkZE1vbnRocyhob3kuZ2V0RnVsbFllYXIoKSwgaG95LmdldE1vbnRoKCkgKyAxLCAtMTIpO1xuICBjb25zdCBlbmRNb250aCA9IF9hZGRNb250aHMoaG95LmdldEZ1bGxZZWFyKCksIGhveS5nZXRNb250aCgpICsgMSwgLTEpO1xuICBjb25zdCBzdGFydEtleSA9IF9tb250aEtleShzdGFydE1vbnRoLnksIHN0YXJ0TW9udGgubSk7XG4gIGNvbnN0IGVuZEtleSA9IF9tb250aEtleShlbmRNb250aC55LCBlbmRNb250aC5tKTtcbiAgZm9yIChjb25zdCBrIG9mIE9iamVjdC5rZXlzKG1lc2VzTWFwKSkge1xuICAgIGlmIChrID49IHN0YXJ0S2V5ICYmIGsgPD0gZW5kS2V5KSB7XG4gICAgICBzdW0gKz0gTnVtYmVyKChtZXNlc01hcFtrXSAmJiBtZXNlc01hcFtrXS5xdHkpIHx8IDApO1xuICAgIH1cbiAgfVxuICByZXR1cm4gc3VtO1xufVxuXG4vLyBTdW1hIHF0eSBkZWwgU0tVIFlURCAoZW5lcm8gZGVsIGFcdTAwRjFvIGFjdHVhbCBoYXN0YSBtZXMgYWN0dWFsIElOQ0xVU0lWTyxcbi8vIGF1bnF1ZSBlbCBtZXMgYWN0dWFsIHNlYSBwYXJjaWFsKS4gUmV0b3JuYSB7IHRvdGFsWXRkLCBtZXNlc1RyYW5zY3Vycmlkb3MgfS5cbi8vIEVqZW1wbG8gYWdvc3RvIDIwMjYgY29uIHZlbnRhcyBqdWw9MTAgKyBhZ289MjAgLT4gezMwLCA4fSwgcHJvbWVkaW89MzAvOD0zLjc1LlxuLy8gKFNpIGVsIHVzdWFyaW8gZXNwZXJhYmEgZGl2aWRpciBwb3IgMiBlbiB2ZXogZGUgOCwgcmV2aXNhciBzcGVjLiBFbCBwZWRpZG9cbi8vIGRpY2UgXCJjYW50aWRhZCBkZSBtZXNlcyBxdWUgdHJhbnNjdXJyaW1vc1wiID0gbWVzZXMgZGVsIGFcdTAwRjFvIHBhc2Fkb3MgaGFzdGEgaG95LilcbmZ1bmN0aW9uIF9zdW1WZW50YXNZVEQobWVzZXNNYXAsIGhveSkge1xuICBjb25zdCB5ZWFyID0gaG95LmdldEZ1bGxZZWFyKCk7XG4gIGNvbnN0IG1lc0FjdHVhbCA9IGhveS5nZXRNb250aCgpICsgMTtcbiAgbGV0IHRvdGFsID0gMDtcbiAgaWYgKG1lc2VzTWFwKSB7XG4gICAgZm9yIChsZXQgbSA9IDE7IG0gPD0gbWVzQWN0dWFsOyBtKyspIHtcbiAgICAgIGNvbnN0IGsgPSBfbW9udGhLZXkoeWVhciwgbSk7XG4gICAgICB0b3RhbCArPSBOdW1iZXIoKG1lc2VzTWFwW2tdICYmIG1lc2VzTWFwW2tdLnF0eSkgfHwgMCk7XG4gICAgfVxuICB9XG4gIHJldHVybiB7IHRvdGFsWXRkOiB0b3RhbCwgbWVzZXNUcmFuc2N1cnJpZG9zOiBtZXNBY3R1YWwgfTtcbn1cblxuLy8gQ2FyZ2Egc2t1X3ZlbnRhc19zbmFwc2hvdCBjb21wbGV0byAodW5hIHZleiBwb3Igc2VzaW9uIGRlbCBtb2RhbCkuXG5hc3luYyBmdW5jdGlvbiBfbG9hZFNuYXBzaG90KCkge1xuICBpZiAoX2ZvcmVjYXN0U25hcHNob3QpIHJldHVybiBfZm9yZWNhc3RTbmFwc2hvdDtcbiAgaWYgKCF3aW5kb3cuZmJEYikgdGhyb3cgbmV3IEVycm9yKCdGaXJlc3RvcmUgbm8gaW5pY2lhbGl6YWRvJyk7XG4gIGNvbnN0IHNuYXAgPSBhd2FpdCB3aW5kb3cuZmJEYi5jb2xsZWN0aW9uKCdza3VfdmVudGFzX3NuYXBzaG90JykuZ2V0KCk7XG4gIGNvbnN0IGJ5T3JpZ2luYWxTa3UgPSB7fTtcbiAgY29uc3QgYnlVcHBlclNrdSA9IHt9O1xuICBzbmFwLmZvckVhY2goKGRvYykgPT4ge1xuICAgIGNvbnN0IGQgPSBkb2MuZGF0YSgpO1xuICAgIGlmICghZCB8fCAhZC5za3UpIHJldHVybjtcbiAgICBjb25zdCBza3VVcHBlciA9IFN0cmluZyhkLnNrdSkudHJpbSgpLnRvVXBwZXJDYXNlKCk7XG4gICAgY29uc3QgcmVjb3JkID0ge1xuICAgICAgc2t1OiBkLnNrdSxcbiAgICAgIGl0ZW1OYW1lOiBkLml0ZW1OYW1lIHx8ICcnLFxuICAgICAgZmFtaWxpYTogZC5mYW1pbGlhIHx8ICcnLFxuICAgICAgc3ViZmFtaWxpYTogZC5zdWJmYW1pbGlhIHx8ICcnLFxuICAgICAgbWVzZXM6IGQubWVzZXMgfHwge30sXG4gICAgfTtcbiAgICBieU9yaWdpbmFsU2t1W2Quc2t1XSA9IHJlY29yZDtcbiAgICBieVVwcGVyU2t1W3NrdVVwcGVyXSA9IHJlY29yZDtcbiAgfSk7XG4gIF9mb3JlY2FzdFNuYXBzaG90ID0geyBieU9yaWdpbmFsU2t1LCBieVVwcGVyU2t1LCBjb3VudDogc25hcC5zaXplIH07XG4gIHJldHVybiBfZm9yZWNhc3RTbmFwc2hvdDtcbn1cblxuLy8gUGFyc2VhIGVsIEV4Y2VsIFNhbGVzIFBsYW4uIEVzcGVyYSBjb2x1bW5hcyBTS1UgKyA2IGNvbHVtbmFzIG51bWVyaWNhc1xuLy8gKG5vbWJyZXMgZmxleGlibGVzOiBNZXMxLi5NZXM2LCBtZXNfMS4ubWVzXzYsIG8gY3VhbHF1aWVyIGhlYWRlciBjdXN0b21cbi8vIG1pZW50cmFzIGxhIHByaW1lcmEgc2VhIFNLVSB5IGhheWEgYWwgbWVub3MgNiBjb2x1bW5hcyBudW1lcmljYXMgbWFzKS5cbmZ1bmN0aW9uIF9wYXJzZVNhbGVzUGxhblJvd3Mocm93c1Jhdykge1xuICBpZiAoIXJvd3NSYXcgfHwgIXJvd3NSYXcubGVuZ3RoKSByZXR1cm4gW107XG4gIGNvbnN0IGhlYWRlclJvdyA9IHJvd3NSYXdbMF07XG4gIC8vIERldGVjdGFyIGluZGljZSBkZSBjb2x1bW5hIFNLVVxuICBsZXQgc2t1Q29sSWR4ID0gLTE7XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgaGVhZGVyUm93Lmxlbmd0aDsgaSsrKSB7XG4gICAgY29uc3QgaCA9IFN0cmluZyhoZWFkZXJSb3dbaV0gfHwgJycpXG4gICAgICAudHJpbSgpXG4gICAgICAudG9VcHBlckNhc2UoKTtcbiAgICBpZiAoaCA9PT0gJ1NLVScgfHwgaCA9PT0gJ0lURU1DT0RFJyB8fCBoID09PSAnSVRFTScgfHwgaCA9PT0gJ0lURU0gQ09ERScgfHwgaCA9PT0gJ0NPRElHTycpIHtcbiAgICAgIHNrdUNvbElkeCA9IGk7XG4gICAgICBicmVhaztcbiAgICB9XG4gIH1cbiAgaWYgKHNrdUNvbElkeCA8IDApXG4gICAgdGhyb3cgbmV3IEVycm9yKCdFbCBFeGNlbCBkZWJlIHRlbmVyIHVuYSBjb2x1bW5hIGxsYW1hZGEgXCJTS1VcIiAobyBDb2RpZ28gLyBJdGVtQ29kZSAvIEl0ZW0pJyk7XG4gIC8vIExhcyA2IGNvbHVtbmFzIGRlIG1lc2VzOiBsYXMgcHJpbWVyYXMgNiBjb2x1bW5hcyBxdWUgc2VhbiAhPSBza3VDb2xJZHguXG4gIGNvbnN0IG1vbnRoQ29scyA9IFtdO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IGhlYWRlclJvdy5sZW5ndGggJiYgbW9udGhDb2xzLmxlbmd0aCA8IDY7IGkrKykge1xuICAgIGlmIChpICE9PSBza3VDb2xJZHgpIG1vbnRoQ29scy5wdXNoKGkpO1xuICB9XG4gIGlmIChtb250aENvbHMubGVuZ3RoIDwgNilcbiAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAnRWwgRXhjZWwgZGViZSB0ZW5lciBhbCBtZW5vcyA2IGNvbHVtbmFzIGRlIG1lc2VzIGFkZW1hcyBkZSBTS1UgKGVuY29udHJhZGFzOiAnICtcbiAgICAgICAgbW9udGhDb2xzLmxlbmd0aCArXG4gICAgICAgICcpJ1xuICAgICk7XG4gIGNvbnN0IG91dCA9IFtdO1xuICBmb3IgKGxldCByID0gMTsgciA8IHJvd3NSYXcubGVuZ3RoOyByKyspIHtcbiAgICBjb25zdCByb3cgPSByb3dzUmF3W3JdO1xuICAgIGlmICghcm93IHx8ICFyb3cubGVuZ3RoKSBjb250aW51ZTtcbiAgICBjb25zdCBza3VSYXcgPSByb3dbc2t1Q29sSWR4XTtcbiAgICBpZiAoc2t1UmF3ID09PSB1bmRlZmluZWQgfHwgc2t1UmF3ID09PSBudWxsIHx8IFN0cmluZyhza3VSYXcpLnRyaW0oKSA9PT0gJycpIGNvbnRpbnVlO1xuICAgIGNvbnN0IHNrdSA9IFN0cmluZyhza3VSYXcpLnRyaW0oKTtcbiAgICBjb25zdCBtZXNlc0FyciA9IG1vbnRoQ29scy5tYXAoKGkpID0+IHtcbiAgICAgIGNvbnN0IHYgPSByb3dbaV07XG4gICAgICBjb25zdCBuID0gTnVtYmVyKHYpO1xuICAgICAgcmV0dXJuIE51bWJlci5pc0Zpbml0ZShuKSA/IG4gOiAwO1xuICAgIH0pO1xuICAgIGNvbnN0IHBlZGlkb1RvdGFsID0gbWVzZXNBcnIucmVkdWNlKChhLCBiKSA9PiBhICsgYiwgMCk7XG4gICAgb3V0LnB1c2goeyBza3UsIG1lc2VzQXJyLCBwZWRpZG9Ub3RhbCB9KTtcbiAgfVxuICByZXR1cm4gb3V0O1xufVxuXG4vLyBDYWxjdWxhIGxhcyBmaWxhcyBmaW5hbGVzIGNydXphbmRvIHNuYXBzaG90ICsgc2FsZXMgcGxhbi5cbmZ1bmN0aW9uIF9jb21wdXRlRm9yZWNhc3RSb3dzKHNuYXBzaG90LCBzYWxlc1BsYW4sIGhveSkge1xuICBjb25zdCByb3dzID0gW107XG4gIGZvciAoY29uc3Qgc3Agb2Ygc2FsZXNQbGFuKSB7XG4gICAgY29uc3Qgc2t1VXBwZXIgPSBzcC5za3UudG9VcHBlckNhc2UoKTtcbiAgICBjb25zdCBoaXN0ID0gc25hcHNob3QuYnlVcHBlclNrdVtza3VVcHBlcl0gfHwgbnVsbDtcbiAgICBjb25zdCB2ZW50YXMxMm0gPSBoaXN0ID8gX3N1bVZlbnRhczEybUNvbXBsZXRvcyhoaXN0Lm1lc2VzLCBob3kpIDogMDtcbiAgICBjb25zdCB5dGQgPSBoaXN0XG4gICAgICA/IF9zdW1WZW50YXNZVEQoaGlzdC5tZXNlcywgaG95KVxuICAgICAgOiB7IHRvdGFsWXRkOiAwLCBtZXNlc1RyYW5zY3Vycmlkb3M6IGhveS5nZXRNb250aCgpICsgMSB9O1xuICAgIGNvbnN0IHByb21lZGlvID0geXRkLm1lc2VzVHJhbnNjdXJyaWRvcyA+IDAgPyB5dGQudG90YWxZdGQgLyB5dGQubWVzZXNUcmFuc2N1cnJpZG9zIDogMDtcbiAgICBjb25zdCBwb2xpdGljYSA9IHByb21lZGlvICogMztcbiAgICBjb25zdCB0b3RhbCA9IHNwLnBlZGlkb1RvdGFsIC0gcG9saXRpY2E7XG4gICAgcm93cy5wdXNoKHtcbiAgICAgIHNrdTogc3Auc2t1LFxuICAgICAgaXRlbU5hbWU6IGhpc3QgPyBoaXN0Lml0ZW1OYW1lIDogJycsXG4gICAgICBmYW1pbGlhOiBoaXN0ID8gaGlzdC5mYW1pbGlhIDogJyhzaW4gbWF0Y2gpJyxcbiAgICAgIHN1YmZhbWlsaWE6IGhpc3QgPyBoaXN0LnN1YmZhbWlsaWEgOiAnKHNpbiBtYXRjaCknLFxuICAgICAgdmVudGFzMTJtOiB2ZW50YXMxMm0sXG4gICAgICBwZWRpZG82bTogc3AucGVkaWRvVG90YWwsXG4gICAgICBwcm9tZWRpbzogcHJvbWVkaW8sXG4gICAgICBwb2xpdGljYTogcG9saXRpY2EsXG4gICAgICB0b3RhbDogdG90YWwsXG4gICAgICBoYXNIaXN0b3JpYTogISFoaXN0LFxuICAgIH0pO1xuICB9XG4gIHJldHVybiByb3dzO1xufVxuXG5mdW5jdGlvbiBfcmVuZGVyTW9kYWxTaGVsbCgpIHtcbiAgY29uc3QgZXhpc3RpbmcgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZm9yZWNhc3QtbW9kYWwnKTtcbiAgaWYgKGV4aXN0aW5nKSByZXR1cm4gZXhpc3Rpbmc7XG4gIGNvbnN0IGVsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2Jyk7XG4gIGVsLmlkID0gJ2ZvcmVjYXN0LW1vZGFsJztcbiAgZWwuY2xhc3NOYW1lID0gJ21vZGFsLW92ZXJsYXknO1xuICBlbC5zdHlsZS5jc3NUZXh0ID1cbiAgICAnZGlzcGxheTpub25lO3Bvc2l0aW9uOmZpeGVkO2luc2V0OjA7YmFja2dyb3VuZDpyZ2JhKDE1LDIzLDQyLC42KTt6LWluZGV4OjIwNTA7JztcbiAgZWwub25jbGljayA9IGZ1bmN0aW9uIChldikge1xuICAgIGlmIChldi50YXJnZXQgPT09IGVsKSB3aW5kb3cuY2xvc2VGb3JlY2FzdE1vZGFsKCk7XG4gIH07XG4gIGVsLmlubmVySFRNTCA9XG4gICAgJycgK1xuICAgICc8ZGl2IHN0eWxlPVwicG9zaXRpb246YWJzb2x1dGU7aW5zZXQ6MXZoIDF2dztiYWNrZ3JvdW5kOnZhcigtLWJnLWVsZXZhdGVkKTtib3JkZXItcmFkaXVzOjEwcHg7ZGlzcGxheTpmbGV4O2ZsZXgtZGlyZWN0aW9uOmNvbHVtbjtvdmVyZmxvdzpoaWRkZW47Ym94LXNoYWRvdzowIDIwcHggNTBweCByZ2JhKDAsMCwwLC4zNSlcIj4nICtcbiAgICAnPGRpdiBzdHlsZT1cInBhZGRpbmc6MTJweCAxOHB4O2JhY2tncm91bmQ6IzBmMTcyYTtjb2xvcjojZmZmO2Rpc3BsYXk6ZmxleDthbGlnbi1pdGVtczpjZW50ZXI7Z2FwOjEycHhcIj4nICtcbiAgICAnPGRpdiBzdHlsZT1cImZsZXg6MVwiPicgK1xuICAgICc8ZGl2IHN0eWxlPVwiZm9udC1zaXplOjE2cHg7Zm9udC13ZWlnaHQ6ODAwO2xldHRlci1zcGFjaW5nOi41cHhcIj5GT1JFQ0FTVDwvZGl2PicgK1xuICAgICc8ZGl2IGlkPVwiZm9yZWNhc3Qtc3VidGl0bGVcIiBzdHlsZT1cImZvbnQtc2l6ZToxMXB4O29wYWNpdHk6Ljg7bWFyZ2luLXRvcDoycHhcIj5DYXJnYXIgU2FsZXMgUGxhbiBwYXJhIHZlciBsYSBwcm95ZWNjaW9uIHZzIHBvbGl0aWNhIGRlIGludmVudGFyaW8gKDMgbWVzZXMpPC9kaXY+JyArXG4gICAgJzwvZGl2PicgK1xuICAgICc8YnV0dG9uIGlkPVwiZm9yZWNhc3QtZXhwb3J0LWJ0blwiIG9uY2xpY2s9XCJleHBvcnRGb3JlY2FzdEV4Y2VsKClcIiBkaXNhYmxlZCBzdHlsZT1cInBhZGRpbmc6OHB4IDE0cHg7YmFja2dyb3VuZDp2YXIoLS1jb2xvci1zdWNjZXNzKTtjb2xvcjojZmZmO2JvcmRlcjpub25lO2JvcmRlci1yYWRpdXM6NnB4O2ZvbnQtd2VpZ2h0OjcwMDtjdXJzb3I6cG9pbnRlcjtvcGFjaXR5Oi41XCI+RXhwb3J0YXIgRXhjZWw8L2J1dHRvbj4nICtcbiAgICAnPGJ1dHRvbiBvbmNsaWNrPVwiY2xvc2VGb3JlY2FzdE1vZGFsKClcIiBzdHlsZT1cImJhY2tncm91bmQ6dHJhbnNwYXJlbnQ7Y29sb3I6I2ZmZjtib3JkZXI6MXB4IHNvbGlkIHJnYmEoMjU1LDI1NSwyNTUsLjQpO2JvcmRlci1yYWRpdXM6NnB4O3BhZGRpbmc6NnB4IDEwcHg7Y3Vyc29yOnBvaW50ZXI7Zm9udC13ZWlnaHQ6NzAwXCI+Q2VycmFyPC9idXR0b24+JyArXG4gICAgJzwvZGl2PicgK1xuICAgICc8ZGl2IHN0eWxlPVwicGFkZGluZzoxMnB4IDE4cHg7YmFja2dyb3VuZDp2YXIoLS1iZy1zZWNvbmRhcnkpO2JvcmRlci1ib3R0b206MXB4IHNvbGlkIHZhcigtLWJvcmRlci1zdWJ0bGUpO2Rpc3BsYXk6ZmxleDtmbGV4LXdyYXA6d3JhcDtnYXA6MTRweDthbGlnbi1pdGVtczpjZW50ZXJcIj4nICtcbiAgICAnPGxhYmVsIHN0eWxlPVwiZGlzcGxheTppbmxpbmUtZmxleDthbGlnbi1pdGVtczpjZW50ZXI7Z2FwOjhweDtwYWRkaW5nOjhweCAxMnB4O2JhY2tncm91bmQ6IzBkOTQ4ODtjb2xvcjojZmZmO2JvcmRlci1yYWRpdXM6NnB4O2ZvbnQtd2VpZ2h0OjcwMDtmb250LXNpemU6MTJweDtjdXJzb3I6cG9pbnRlclwiPicgK1xuICAgICc8c3Bhbj5DYXJnYXIgU2FsZXMgUGxhbiAoLnhsc3gpPC9zcGFuPicgK1xuICAgICc8aW5wdXQgdHlwZT1cImZpbGVcIiBhY2NlcHQ9XCIueGxzeCwueGxzXCIgc3R5bGU9XCJkaXNwbGF5Om5vbmVcIiBvbmNoYW5nZT1cIm9uRm9yZWNhc3RTYWxlc1BsYW5GaWxlKGV2ZW50KVwiLz4nICtcbiAgICAnPC9sYWJlbD4nICtcbiAgICAnPGRpdiBpZD1cImZvcmVjYXN0LWhpbnRcIiBzdHlsZT1cImZvbnQtc2l6ZToxMXB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO21heC13aWR0aDo1MjBweFwiPkV4Y2VsIGVzcGVyYWRvOiBwcmltZXJhIGNvbHVtbmEgPGI+U0tVPC9iPiwgbHVlZ28gNiBjb2x1bW5hcyBjb24gbGFzIHVuaWRhZGVzIHBlZGlkYXMgbWVzIGEgbWVzIHBhcmEgbG9zIHByb3hpbW9zIDYgbWVzZXMuIExvcyBoZWFkZXJzIGRlIGxvcyBtZXNlcyBwdWVkZW4gc2VyIGN1YWxxdWllciBub21icmUgKE1lczEuLk1lczYsIGFnby0yNi4uZW5lLTI3LCBldGMpLjwvZGl2PicgK1xuICAgICc8ZGl2IGlkPVwiZm9yZWNhc3Qtc3RhdHNcIiBzdHlsZT1cIm1hcmdpbi1sZWZ0OmF1dG87Zm9udC1zaXplOjExcHg7Y29sb3I6dmFyKC0tdGV4dC1zZWNvbmRhcnkpO2ZvbnQtd2VpZ2h0OjYwMFwiPjwvZGl2PicgK1xuICAgICc8L2Rpdj4nICtcbiAgICAnPGRpdiBpZD1cImZvcmVjYXN0LWJvZHlcIiBzdHlsZT1cImZsZXg6MTtvdmVyZmxvdzphdXRvO3BhZGRpbmc6MFwiPicgK1xuICAgICc8ZGl2IHN0eWxlPVwicGFkZGluZzo2MHB4IDIwcHg7dGV4dC1hbGlnbjpjZW50ZXI7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7Zm9udC1zaXplOjE0cHhcIj5Fc3BlcmFuZG8gYXJjaGl2byBTYWxlcyBQbGFuLi4uPC9kaXY+JyArXG4gICAgJzwvZGl2PicgK1xuICAgICc8L2Rpdj4nO1xuICBkb2N1bWVudC5ib2R5LmFwcGVuZENoaWxkKGVsKTtcbiAgcmV0dXJuIGVsO1xufVxuXG5mdW5jdGlvbiBfcmVuZGVyVGFibGUocm93cykge1xuICBjb25zdCBib2R5ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2ZvcmVjYXN0LWJvZHknKTtcbiAgaWYgKCFib2R5KSByZXR1cm47XG4gIGlmICghcm93cyB8fCAhcm93cy5sZW5ndGgpIHtcbiAgICBib2R5LmlubmVySFRNTCA9XG4gICAgICAnPGRpdiBzdHlsZT1cInBhZGRpbmc6NjBweCAyMHB4O3RleHQtYWxpZ246Y2VudGVyO2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpXCI+U2FsZXMgUGxhbiB2YWNpbyBvIHNpbiBmaWxhcyB2YWxpZGFzLjwvZGl2Pic7XG4gICAgcmV0dXJuO1xuICB9XG4gIGNvbnN0IGZtdCA9IChuKSA9PlxuICAgIG4gPT09IDAgfHwgIU51bWJlci5pc0Zpbml0ZShuKVxuICAgICAgPyAnMCdcbiAgICAgIDogTnVtYmVyKG4pLnRvTG9jYWxlU3RyaW5nKCdlcy1BUicsIHsgbWF4aW11bUZyYWN0aW9uRGlnaXRzOiAxIH0pO1xuICBjb25zdCBjb2xvckZvclRvdGFsID0gKHQpID0+IHtcbiAgICBpZiAodCA+IDApIHJldHVybiAnIzE2NjUzNCc7IC8vIHNvYnJhIChwZWRpc3RlIG1hcyBxdWUgbGEgcG9saXRpY2EpIC0gdmVyZGVcbiAgICBpZiAodCA8IDApIHJldHVybiAnI2MyNDEwYyc7IC8vIGZhbHRhIChwZWRpc3RlIG1lbm9zIHF1ZSBsYSBwb2xpdGljYSkgLSBuYXJhbmphIHVyZ2VudGVcbiAgICByZXR1cm4gJyM0NzU1NjknO1xuICB9O1xuICBjb25zdCByb3dzSHRtbCA9IHJvd3NcbiAgICAubWFwKFxuICAgICAgKHIpID0+XG4gICAgICAgICcnICtcbiAgICAgICAgJzx0cicgK1xuICAgICAgICAoci5oYXNIaXN0b3JpYSA/ICcnIDogJyBzdHlsZT1cImJhY2tncm91bmQ6dmFyKC0tY29sb3Itd2FybmluZy1iZylcIicpICtcbiAgICAgICAgJz4nICtcbiAgICAgICAgJzx0ZCBzdHlsZT1cInBhZGRpbmc6NnB4IDEwcHg7Zm9udC1mYW1pbHk6bW9ub3NwYWNlO2ZvbnQtc2l6ZToxMXB4O3doaXRlLXNwYWNlOm5vd3JhcFwiPicgK1xuICAgICAgICBlc2NhcGVIdG1sU2FmZShyLnNrdSkgK1xuICAgICAgICAnPC90ZD4nICtcbiAgICAgICAgJzx0ZCBzdHlsZT1cInBhZGRpbmc6NnB4IDEwcHg7Zm9udC1zaXplOjExcHhcIj4nICtcbiAgICAgICAgZXNjYXBlSHRtbFNhZmUoci5mYW1pbGlhKSArXG4gICAgICAgICc8L3RkPicgK1xuICAgICAgICAnPHRkIHN0eWxlPVwicGFkZGluZzo2cHggMTBweDtmb250LXNpemU6MTFweFwiPicgK1xuICAgICAgICBlc2NhcGVIdG1sU2FmZShyLnN1YmZhbWlsaWEpICtcbiAgICAgICAgJzwvdGQ+JyArXG4gICAgICAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjZweCAxMHB4O3RleHQtYWxpZ246cmlnaHQ7Zm9udC12YXJpYW50LW51bWVyaWM6dGFidWxhci1udW1zXCI+JyArXG4gICAgICAgIGZtdChyLnZlbnRhczEybSkgK1xuICAgICAgICAnPC90ZD4nICtcbiAgICAgICAgJzx0ZCBzdHlsZT1cInBhZGRpbmc6NnB4IDEwcHg7dGV4dC1hbGlnbjpyaWdodDtmb250LXZhcmlhbnQtbnVtZXJpYzp0YWJ1bGFyLW51bXM7Zm9udC13ZWlnaHQ6NjAwXCI+JyArXG4gICAgICAgIGZtdChyLnBlZGlkbzZtKSArXG4gICAgICAgICc8L3RkPicgK1xuICAgICAgICAnPHRkIHN0eWxlPVwicGFkZGluZzo2cHggMTBweDt0ZXh0LWFsaWduOnJpZ2h0O2ZvbnQtdmFyaWFudC1udW1lcmljOnRhYnVsYXItbnVtcztjb2xvcjp2YXIoLS10ZXh0LW11dGVkKVwiPicgK1xuICAgICAgICBmbXQoci5wcm9tZWRpbykgK1xuICAgICAgICAnPC90ZD4nICtcbiAgICAgICAgJzx0ZCBzdHlsZT1cInBhZGRpbmc6NnB4IDEwcHg7dGV4dC1hbGlnbjpyaWdodDtmb250LXZhcmlhbnQtbnVtZXJpYzp0YWJ1bGFyLW51bXNcIj4nICtcbiAgICAgICAgZm10KHIucG9saXRpY2EpICtcbiAgICAgICAgJzwvdGQ+JyArXG4gICAgICAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjZweCAxMHB4O3RleHQtYWxpZ246cmlnaHQ7Zm9udC12YXJpYW50LW51bWVyaWM6dGFidWxhci1udW1zO2ZvbnQtd2VpZ2h0OjcwMDtjb2xvcjonICtcbiAgICAgICAgY29sb3JGb3JUb3RhbChyLnRvdGFsKSArXG4gICAgICAgICdcIj4nICtcbiAgICAgICAgZm10KHIudG90YWwpICtcbiAgICAgICAgJzwvdGQ+JyArXG4gICAgICAgICc8L3RyPidcbiAgICApXG4gICAgLmpvaW4oJycpO1xuICBjb25zdCBoZWFkZXIgPVxuICAgICcnICtcbiAgICAnPHRoZWFkIHN0eWxlPVwicG9zaXRpb246c3RpY2t5O3RvcDowO2JhY2tncm91bmQ6IzBmMTcyYTtjb2xvcjojZmZmO3otaW5kZXg6MVwiPicgK1xuICAgICc8dHI+JyArXG4gICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6OHB4IDEwcHg7dGV4dC1hbGlnbjpsZWZ0O2ZvbnQtc2l6ZToxMXB4O3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtsZXR0ZXItc3BhY2luZzouNHB4XCI+U0tVPC90aD4nICtcbiAgICAnPHRoIHN0eWxlPVwicGFkZGluZzo4cHggMTBweDt0ZXh0LWFsaWduOmxlZnQ7Zm9udC1zaXplOjExcHg7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO2xldHRlci1zcGFjaW5nOi40cHhcIj5GYW1pbGlhPC90aD4nICtcbiAgICAnPHRoIHN0eWxlPVwicGFkZGluZzo4cHggMTBweDt0ZXh0LWFsaWduOmxlZnQ7Zm9udC1zaXplOjExcHg7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO2xldHRlci1zcGFjaW5nOi40cHhcIj5TdWJmYW1pbGlhPC90aD4nICtcbiAgICAnPHRoIHN0eWxlPVwicGFkZGluZzo4cHggMTBweDt0ZXh0LWFsaWduOnJpZ2h0O2ZvbnQtc2l6ZToxMXB4O3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtsZXR0ZXItc3BhY2luZzouNHB4XCIgdGl0bGU9XCJTdW1hIGRlIHF0eSBmYWN0dXJhZGEgZW4gbG9zIHVsdGltb3MgMTIgbWVzZXMgY29tcGxldG9zXCI+VmVudGFzIDEybTwvdGg+JyArXG4gICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6OHB4IDEwcHg7dGV4dC1hbGlnbjpyaWdodDtmb250LXNpemU6MTFweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7bGV0dGVyLXNwYWNpbmc6LjRweFwiIHRpdGxlPVwiU3VtYSBkZSBsYXMgNiBjb2x1bW5hcyBkZWwgRXhjZWwgU2FsZXMgUGxhblwiPlBlZGlkbyA2bTwvdGg+JyArXG4gICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6OHB4IDEwcHg7dGV4dC1hbGlnbjpyaWdodDtmb250LXNpemU6MTFweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7bGV0dGVyLXNwYWNpbmc6LjRweFwiIHRpdGxlPVwiVmVudGFzIFlURCAvIG1lc2VzIHRyYW5zY3Vycmlkb3MgZGVsIGFcdTAwRjFvXCI+UHJvbSAvIE1lczwvdGg+JyArXG4gICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6OHB4IDEwcHg7dGV4dC1hbGlnbjpyaWdodDtmb250LXNpemU6MTFweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7bGV0dGVyLXNwYWNpbmc6LjRweFwiIHRpdGxlPVwiUHJvbWVkaW8geCAzIG1lc2VzIChwb2xpdGljYSBkZSBpbnZlbnRhcmlvKVwiPlBvbGl0aWNhPC90aD4nICtcbiAgICAnPHRoIHN0eWxlPVwicGFkZGluZzo4cHggMTBweDt0ZXh0LWFsaWduOnJpZ2h0O2ZvbnQtc2l6ZToxMXB4O3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtsZXR0ZXItc3BhY2luZzouNHB4XCIgdGl0bGU9XCJQZWRpZG8gNm0gLSBQb2xpdGljYS4gTmVnYXRpdm8gPSB0ZSBmYWx0YSBwZWRpcjsgUG9zaXRpdm8gPSBzb2JyZXBlZGlkb1wiPlRvdGFsPC90aD4nICtcbiAgICAnPC90cj4nICtcbiAgICAnPC90aGVhZD4nO1xuICBib2R5LmlubmVySFRNTCA9XG4gICAgJzx0YWJsZSBzdHlsZT1cIndpZHRoOjEwMCU7Ym9yZGVyLWNvbGxhcHNlOmNvbGxhcHNlO2ZvbnQtc2l6ZToxMnB4XCI+JyArXG4gICAgaGVhZGVyICtcbiAgICAnPHRib2R5PicgK1xuICAgIHJvd3NIdG1sICtcbiAgICAnPC90Ym9keT48L3RhYmxlPic7XG59XG5cbmZ1bmN0aW9uIGVzY2FwZUh0bWxTYWZlKHMpIHtcbiAgaWYgKHR5cGVvZiB3aW5kb3cuZXNjYXBlSHRtbCA9PT0gJ2Z1bmN0aW9uJykgcmV0dXJuIHdpbmRvdy5lc2NhcGVIdG1sKHMpO1xuICByZXR1cm4gU3RyaW5nKHMgPT0gbnVsbCA/ICcnIDogcykucmVwbGFjZShcbiAgICAvWyY8PlwiJ10vZyxcbiAgICAoY2gpID0+ICh7ICcmJzogJyZhbXA7JywgJzwnOiAnJmx0OycsICc+JzogJyZndDsnLCAnXCInOiAnJnF1b3Q7JywgXCInXCI6ICcmIzM5OycgfSlbY2hdXG4gICk7XG59XG5cbndpbmRvdy5vcGVuRm9yZWNhc3RNb2RhbCA9IGFzeW5jIGZ1bmN0aW9uICgpIHtcbiAgaWYgKCFfY2FuRm9yZWNhc3QoKSkge1xuICAgIGFsZXJ0KCdGT1JFQ0FTVCBlcyBzb2xvIHBhcmEgTWFyaWFubyAoYWRtaW4pLicpO1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCBlbCA9IF9yZW5kZXJNb2RhbFNoZWxsKCk7XG4gIGVsLnN0eWxlLmRpc3BsYXkgPSAnYmxvY2snO1xuICBpZiAoX2ZvcmVjYXN0TG9hZGluZykgcmV0dXJuO1xuICBpZiAoIV9mb3JlY2FzdFNuYXBzaG90KSB7XG4gICAgX2ZvcmVjYXN0TG9hZGluZyA9IHRydWU7XG4gICAgY29uc3Qgc3RhdHMgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZm9yZWNhc3Qtc3RhdHMnKTtcbiAgICBpZiAoc3RhdHMpIHN0YXRzLnRleHRDb250ZW50ID0gJ0NhcmdhbmRvIHNuYXBzaG90IGRlIHZlbnRhcy4uLic7XG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IF9sb2FkU25hcHNob3QoKTtcbiAgICAgIGlmIChzdGF0cykgc3RhdHMudGV4dENvbnRlbnQgPSBfZm9yZWNhc3RTbmFwc2hvdC5jb3VudCArICcgU0tVcyBlbiBzbmFwc2hvdCBoaXN0b3JpY28nO1xuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgIGlmIChzdGF0cykgc3RhdHMudGV4dENvbnRlbnQgPSAnRXJyb3IgY2FyZ2FuZG8gc25hcHNob3Q6ICcgKyAoKGUgJiYgZS5tZXNzYWdlKSB8fCBlKTtcbiAgICAgIGFsZXJ0KFxuICAgICAgICAnTm8gc2UgcHVkbyBjYXJnYXIgc2t1X3ZlbnRhc19zbmFwc2hvdC4gQ2hlcXVlYSBxdWUgZWwgYm9vdHN0cmFwIFB5dGhvbiB5YSBoYXlhIGNvcnJpZG8gKHNjcmlwdHMvYXBwbHlfc2t1X3ZlbnRhc19zbmFwc2hvdC5weSkgeSBxdWUgdGVuZ2FzIHJvbCBhZG1pbi4nXG4gICAgICApO1xuICAgIH0gZmluYWxseSB7XG4gICAgICBfZm9yZWNhc3RMb2FkaW5nID0gZmFsc2U7XG4gICAgfVxuICB9IGVsc2Uge1xuICAgIGNvbnN0IHN0YXRzID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2ZvcmVjYXN0LXN0YXRzJyk7XG4gICAgaWYgKHN0YXRzKSBzdGF0cy50ZXh0Q29udGVudCA9IF9mb3JlY2FzdFNuYXBzaG90LmNvdW50ICsgJyBTS1VzIGVuIHNuYXBzaG90IGhpc3Rvcmljbyc7XG4gIH1cbn07XG5cbndpbmRvdy5jbG9zZUZvcmVjYXN0TW9kYWwgPSBmdW5jdGlvbiAoKSB7XG4gIGNvbnN0IGVsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2ZvcmVjYXN0LW1vZGFsJyk7XG4gIGlmIChlbCkgZWwuc3R5bGUuZGlzcGxheSA9ICdub25lJztcbn07XG5cbndpbmRvdy5vbkZvcmVjYXN0U2FsZXNQbGFuRmlsZSA9IGFzeW5jIGZ1bmN0aW9uIChldmVudCkge1xuICBjb25zdCBmaWxlID0gZXZlbnQgJiYgZXZlbnQudGFyZ2V0ICYmIGV2ZW50LnRhcmdldC5maWxlcyAmJiBldmVudC50YXJnZXQuZmlsZXNbMF07XG4gIGlmICghZmlsZSkgcmV0dXJuO1xuICB0cnkge1xuICAgIGlmICghX2ZvcmVjYXN0U25hcHNob3QpIGF3YWl0IF9sb2FkU25hcHNob3QoKTtcbiAgICBjb25zdCBidWYgPSBhd2FpdCBmaWxlLmFycmF5QnVmZmVyKCk7XG4gICAgaWYgKHR5cGVvZiBYTFNYID09PSAndW5kZWZpbmVkJykge1xuICAgICAgYWxlcnQoJ1hMU1ggbm8gY2FyZ2FkbycpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBjb25zdCB3YiA9IFhMU1gucmVhZChidWYsIHsgdHlwZTogJ2FycmF5JyB9KTtcbiAgICBjb25zdCBzaGVldCA9IHdiLlNoZWV0c1t3Yi5TaGVldE5hbWVzWzBdXTtcbiAgICBjb25zdCByb3dzID0gWExTWC51dGlscy5zaGVldF90b19qc29uKHNoZWV0LCB7IGhlYWRlcjogMSwgZGVmdmFsOiBudWxsLCByYXc6IHRydWUgfSk7XG4gICAgY29uc3QgcGFyc2VkID0gX3BhcnNlU2FsZXNQbGFuUm93cyhyb3dzKTtcbiAgICBpZiAoIXBhcnNlZC5sZW5ndGgpIHtcbiAgICAgIGFsZXJ0KCdFbCBFeGNlbCBlc3RhIHZhY2lvIG8gbm8gdGllbmUgZmlsYXMgdmFsaWRhcy4nKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgX2ZvcmVjYXN0U2FsZXNQbGFuID0gcGFyc2VkO1xuICAgIGNvbnN0IGhveSA9IG5ldyBEYXRlKCk7XG4gICAgX2ZvcmVjYXN0Um93cyA9IF9jb21wdXRlRm9yZWNhc3RSb3dzKF9mb3JlY2FzdFNuYXBzaG90LCBwYXJzZWQsIGhveSk7XG4gICAgX3JlbmRlclRhYmxlKF9mb3JlY2FzdFJvd3MpO1xuICAgIGNvbnN0IHNpbk1hdGNoID0gX2ZvcmVjYXN0Um93cy5maWx0ZXIoKHIpID0+ICFyLmhhc0hpc3RvcmlhKS5sZW5ndGg7XG4gICAgY29uc3Qgc3RhdHMgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZm9yZWNhc3Qtc3RhdHMnKTtcbiAgICBpZiAoc3RhdHMpIHtcbiAgICAgIHN0YXRzLnRleHRDb250ZW50ID1cbiAgICAgICAgcGFyc2VkLmxlbmd0aCArXG4gICAgICAgICcgU0tVcyBlbiBTYWxlcyBQbGFuIFx1MDBCNyAnICtcbiAgICAgICAgKHBhcnNlZC5sZW5ndGggLSBzaW5NYXRjaCkgK1xuICAgICAgICAnIGNvbiBoaXN0b3JpYSBcdTAwQjcgJyArXG4gICAgICAgIHNpbk1hdGNoICtcbiAgICAgICAgJyBzaW4gbWF0Y2ggKGZvbmRvIGFtYXJpbGxvKSc7XG4gICAgfVxuICAgIGNvbnN0IGJ0biA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdmb3JlY2FzdC1leHBvcnQtYnRuJyk7XG4gICAgaWYgKGJ0bikge1xuICAgICAgYnRuLmRpc2FibGVkID0gZmFsc2U7XG4gICAgICBidG4uc3R5bGUub3BhY2l0eSA9ICcxJztcbiAgICB9XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBjb25zb2xlLmVycm9yKCdbRk9SRUNBU1RdIHBhcnNlIGVycm9yOicsIGUpO1xuICAgIGFsZXJ0KCdFcnJvciBwcm9jZXNhbmRvIGVsIEV4Y2VsOlxcbicgKyAoKGUgJiYgZS5tZXNzYWdlKSB8fCBlKSk7XG4gIH0gZmluYWxseSB7XG4gICAgLy8gUmVzZXQgaW5wdXQgcGFyYSBxdWUgZWwgbWlzbW8gYXJjaGl2byBzZSBwdWVkYSByZS1zdWJpclxuICAgIGlmIChldmVudCAmJiBldmVudC50YXJnZXQpIGV2ZW50LnRhcmdldC52YWx1ZSA9ICcnO1xuICB9XG59O1xuXG53aW5kb3cuZXhwb3J0Rm9yZWNhc3RFeGNlbCA9IGZ1bmN0aW9uICgpIHtcbiAgaWYgKCFfZm9yZWNhc3RSb3dzIHx8ICFfZm9yZWNhc3RSb3dzLmxlbmd0aCkge1xuICAgIGFsZXJ0KCdObyBoYXkgZGF0b3MgcGFyYSBleHBvcnRhci4gQ2FyZ2EgcHJpbWVybyBlbCBTYWxlcyBQbGFuLicpO1xuICAgIHJldHVybjtcbiAgfVxuICBpZiAodHlwZW9mIFhMU1ggPT09ICd1bmRlZmluZWQnKSB7XG4gICAgYWxlcnQoJ1hMU1ggbm8gY2FyZ2FkbycpO1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCByb3VuZDEgPSAobikgPT4gTWF0aC5yb3VuZChOdW1iZXIobiB8fCAwKSAqIDEwKSAvIDEwO1xuICBjb25zdCBhb2EgPSBbXG4gICAgW1xuICAgICAgJ1NLVScsXG4gICAgICAnRkFNSUxJQScsXG4gICAgICAnU1VCRkFNSUxJQScsXG4gICAgICAnVkVOVEFTICgxMm0pJyxcbiAgICAgICdQRURJRE8tU0FMRVMgUExBTlMgKDZtKScsXG4gICAgICAnUFJPTUVESU8gREUgSU5WRU5UQVJJTycsXG4gICAgICAnUE9MSVRJQ0EgREUgSU5WRU5UQVJJTyAoM20pJyxcbiAgICAgICdUT1RBTCcsXG4gICAgXSxcbiAgXTtcbiAgZm9yIChjb25zdCByIG9mIF9mb3JlY2FzdFJvd3MpIHtcbiAgICBhb2EucHVzaChbXG4gICAgICByLnNrdSxcbiAgICAgIHIuZmFtaWxpYSxcbiAgICAgIHIuc3ViZmFtaWxpYSxcbiAgICAgIHJvdW5kMShyLnZlbnRhczEybSksXG4gICAgICByb3VuZDEoci5wZWRpZG82bSksXG4gICAgICByb3VuZDEoci5wcm9tZWRpbyksXG4gICAgICByb3VuZDEoci5wb2xpdGljYSksXG4gICAgICByb3VuZDEoci50b3RhbCksXG4gICAgXSk7XG4gIH1cbiAgY29uc3Qgd3MgPSBYTFNYLnV0aWxzLmFvYV90b19zaGVldChhb2EpO1xuICAvLyBBbmNob3MgZGUgY29sdW1uYVxuICB3c1snIWNvbHMnXSA9IFtcbiAgICB7IHdjaDogMTggfSxcbiAgICB7IHdjaDogMjQgfSxcbiAgICB7IHdjaDogMjQgfSxcbiAgICB7IHdjaDogMTQgfSxcbiAgICB7IHdjaDogMjAgfSxcbiAgICB7IHdjaDogMjAgfSxcbiAgICB7IHdjaDogMjIgfSxcbiAgICB7IHdjaDogMTIgfSxcbiAgXTtcbiAgY29uc3Qgd2IgPSBYTFNYLnV0aWxzLmJvb2tfbmV3KCk7XG4gIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQod2IsIHdzLCAnRk9SRUNBU1QnKTtcbiAgY29uc3QgaG95ID0gbmV3IERhdGUoKTtcbiAgY29uc3Qgc3RhbXAgPVxuICAgIGhveS5nZXRGdWxsWWVhcigpICtcbiAgICAnLScgK1xuICAgIFN0cmluZyhob3kuZ2V0TW9udGgoKSArIDEpLnBhZFN0YXJ0KDIsICcwJykgK1xuICAgICctJyArXG4gICAgU3RyaW5nKGhveS5nZXREYXRlKCkpLnBhZFN0YXJ0KDIsICcwJyk7XG4gIFhMU1gud3JpdGVGaWxlKHdiLCAnRm9yZWNhc3RfU2hpbWFub18nICsgc3RhbXAgKyAnLnhsc3gnKTtcbn07XG5cbi8vIFJlZnJlc2ggcHVibGljbyAocG9yIHNpIGVsIHVzZXIgbmVjZXNpdGEgcmUtZmV0Y2hlYXIgZWwgc25hcHNob3Qgc2luIGNlcnJhclxuLy8gZWwgbW9kYWwsIGVqOiBwYXNhcm9uIDMwIG1pbiB5IGVsIGNyb24gQlEgYWN0dWFsaXpvIGxhIGNvbGVjY2lvbikuXG53aW5kb3cucmVsb2FkRm9yZWNhc3RTbmFwc2hvdCA9IGFzeW5jIGZ1bmN0aW9uICgpIHtcbiAgX2ZvcmVjYXN0U25hcHNob3QgPSBudWxsO1xuICBhd2FpdCBfbG9hZFNuYXBzaG90KCk7XG4gIGlmIChfZm9yZWNhc3RTYWxlc1BsYW4pIHtcbiAgICBjb25zdCBob3kgPSBuZXcgRGF0ZSgpO1xuICAgIF9mb3JlY2FzdFJvd3MgPSBfY29tcHV0ZUZvcmVjYXN0Um93cyhfZm9yZWNhc3RTbmFwc2hvdCwgX2ZvcmVjYXN0U2FsZXNQbGFuLCBob3kpO1xuICAgIF9yZW5kZXJUYWJsZShfZm9yZWNhc3RSb3dzKTtcbiAgfVxufTtcbiJdLAogICJtYXBwaW5ncyI6ICI7OztBQTRCQSxNQUFJLG9CQUFvQjtBQUN4QixNQUFJLHFCQUFxQjtBQUN6QixNQUFJLGdCQUFnQjtBQUNwQixNQUFJLG1CQUFtQjtBQUt2QixNQUFNLDBCQUEwQixDQUFDLGlDQUFpQyx5QkFBeUI7QUFFM0YsV0FBUyxlQUFlO0FBQ3RCLFFBQUk7QUFDRixZQUFNLFNBQVUsT0FBTyxlQUFlLE9BQU8sWUFBWSxTQUFVLElBQUksWUFBWTtBQUNuRixVQUFJLENBQUMsTUFBTyxRQUFPO0FBQ25CLGFBQU8sd0JBQXdCLFFBQVEsS0FBSyxLQUFLO0FBQUEsSUFDbkQsUUFBUTtBQUNOLGFBQU87QUFBQSxJQUNUO0FBQUEsRUFDRjtBQUdBLFdBQVMsVUFBVSxNQUFNLGVBQWU7QUFDdEMsV0FBTyxPQUFPLElBQUksRUFBRSxTQUFTLEdBQUcsR0FBRyxJQUFJLE1BQU0sT0FBTyxhQUFhLEVBQUUsU0FBUyxHQUFHLEdBQUc7QUFBQSxFQUNwRjtBQW9CQSxXQUFTLFdBQVcsTUFBTSxlQUFlLE9BQU87QUFDOUMsVUFBTSxjQUFjLE9BQU8sTUFBTSxnQkFBZ0IsS0FBSztBQUN0RCxVQUFNLElBQUksS0FBSyxNQUFNLGNBQWMsRUFBRTtBQUNyQyxVQUFNLElBQUssY0FBYyxLQUFNO0FBQy9CLFdBQU8sRUFBRSxHQUFHLEVBQUU7QUFBQSxFQUNoQjtBQUtBLFdBQVMsdUJBQXVCLFVBQVUsS0FBSztBQUM3QyxRQUFJLENBQUMsU0FBVSxRQUFPO0FBQ3RCLFFBQUksTUFBTTtBQUNWLFVBQU0sYUFBYSxXQUFXLElBQUksWUFBWSxHQUFHLElBQUksU0FBUyxJQUFJLEdBQUcsR0FBRztBQUN4RSxVQUFNLFdBQVcsV0FBVyxJQUFJLFlBQVksR0FBRyxJQUFJLFNBQVMsSUFBSSxHQUFHLEVBQUU7QUFDckUsVUFBTSxXQUFXLFVBQVUsV0FBVyxHQUFHLFdBQVcsQ0FBQztBQUNyRCxVQUFNLFNBQVMsVUFBVSxTQUFTLEdBQUcsU0FBUyxDQUFDO0FBQy9DLGVBQVcsS0FBSyxPQUFPLEtBQUssUUFBUSxHQUFHO0FBQ3JDLFVBQUksS0FBSyxZQUFZLEtBQUssUUFBUTtBQUNoQyxlQUFPLE9BQVEsU0FBUyxDQUFDLEtBQUssU0FBUyxDQUFDLEVBQUUsT0FBUSxDQUFDO0FBQUEsTUFDckQ7QUFBQSxJQUNGO0FBQ0EsV0FBTztBQUFBLEVBQ1Q7QUFPQSxXQUFTLGNBQWMsVUFBVSxLQUFLO0FBQ3BDLFVBQU0sT0FBTyxJQUFJLFlBQVk7QUFDN0IsVUFBTSxZQUFZLElBQUksU0FBUyxJQUFJO0FBQ25DLFFBQUksUUFBUTtBQUNaLFFBQUksVUFBVTtBQUNaLGVBQVMsSUFBSSxHQUFHLEtBQUssV0FBVyxLQUFLO0FBQ25DLGNBQU0sSUFBSSxVQUFVLE1BQU0sQ0FBQztBQUMzQixpQkFBUyxPQUFRLFNBQVMsQ0FBQyxLQUFLLFNBQVMsQ0FBQyxFQUFFLE9BQVEsQ0FBQztBQUFBLE1BQ3ZEO0FBQUEsSUFDRjtBQUNBLFdBQU8sRUFBRSxVQUFVLE9BQU8sb0JBQW9CLFVBQVU7QUFBQSxFQUMxRDtBQUdBLGlCQUFlLGdCQUFnQjtBQUM3QixRQUFJLGtCQUFtQixRQUFPO0FBQzlCLFFBQUksQ0FBQyxPQUFPLEtBQU0sT0FBTSxJQUFJLE1BQU0sMkJBQTJCO0FBQzdELFVBQU0sT0FBTyxNQUFNLE9BQU8sS0FBSyxXQUFXLHFCQUFxQixFQUFFLElBQUk7QUFDckUsVUFBTSxnQkFBZ0IsQ0FBQztBQUN2QixVQUFNLGFBQWEsQ0FBQztBQUNwQixTQUFLLFFBQVEsQ0FBQyxRQUFRO0FBQ3BCLFlBQU0sSUFBSSxJQUFJLEtBQUs7QUFDbkIsVUFBSSxDQUFDLEtBQUssQ0FBQyxFQUFFLElBQUs7QUFDbEIsWUFBTSxXQUFXLE9BQU8sRUFBRSxHQUFHLEVBQUUsS0FBSyxFQUFFLFlBQVk7QUFDbEQsWUFBTSxTQUFTO0FBQUEsUUFDYixLQUFLLEVBQUU7QUFBQSxRQUNQLFVBQVUsRUFBRSxZQUFZO0FBQUEsUUFDeEIsU0FBUyxFQUFFLFdBQVc7QUFBQSxRQUN0QixZQUFZLEVBQUUsY0FBYztBQUFBLFFBQzVCLE9BQU8sRUFBRSxTQUFTLENBQUM7QUFBQSxNQUNyQjtBQUNBLG9CQUFjLEVBQUUsR0FBRyxJQUFJO0FBQ3ZCLGlCQUFXLFFBQVEsSUFBSTtBQUFBLElBQ3pCLENBQUM7QUFDRCx3QkFBb0IsRUFBRSxlQUFlLFlBQVksT0FBTyxLQUFLLEtBQUs7QUFDbEUsV0FBTztBQUFBLEVBQ1Q7QUFLQSxXQUFTLG9CQUFvQixTQUFTO0FBQ3BDLFFBQUksQ0FBQyxXQUFXLENBQUMsUUFBUSxPQUFRLFFBQU8sQ0FBQztBQUN6QyxVQUFNLFlBQVksUUFBUSxDQUFDO0FBRTNCLFFBQUksWUFBWTtBQUNoQixhQUFTLElBQUksR0FBRyxJQUFJLFVBQVUsUUFBUSxLQUFLO0FBQ3pDLFlBQU0sSUFBSSxPQUFPLFVBQVUsQ0FBQyxLQUFLLEVBQUUsRUFDaEMsS0FBSyxFQUNMLFlBQVk7QUFDZixVQUFJLE1BQU0sU0FBUyxNQUFNLGNBQWMsTUFBTSxVQUFVLE1BQU0sZUFBZSxNQUFNLFVBQVU7QUFDMUYsb0JBQVk7QUFDWjtBQUFBLE1BQ0Y7QUFBQSxJQUNGO0FBQ0EsUUFBSSxZQUFZO0FBQ2QsWUFBTSxJQUFJLE1BQU0sNEVBQTRFO0FBRTlGLFVBQU0sWUFBWSxDQUFDO0FBQ25CLGFBQVMsSUFBSSxHQUFHLElBQUksVUFBVSxVQUFVLFVBQVUsU0FBUyxHQUFHLEtBQUs7QUFDakUsVUFBSSxNQUFNLFVBQVcsV0FBVSxLQUFLLENBQUM7QUFBQSxJQUN2QztBQUNBLFFBQUksVUFBVSxTQUFTO0FBQ3JCLFlBQU0sSUFBSTtBQUFBLFFBQ1Isa0ZBQ0UsVUFBVSxTQUNWO0FBQUEsTUFDSjtBQUNGLFVBQU0sTUFBTSxDQUFDO0FBQ2IsYUFBUyxJQUFJLEdBQUcsSUFBSSxRQUFRLFFBQVEsS0FBSztBQUN2QyxZQUFNLE1BQU0sUUFBUSxDQUFDO0FBQ3JCLFVBQUksQ0FBQyxPQUFPLENBQUMsSUFBSSxPQUFRO0FBQ3pCLFlBQU0sU0FBUyxJQUFJLFNBQVM7QUFDNUIsVUFBSSxXQUFXLFVBQWEsV0FBVyxRQUFRLE9BQU8sTUFBTSxFQUFFLEtBQUssTUFBTSxHQUFJO0FBQzdFLFlBQU0sTUFBTSxPQUFPLE1BQU0sRUFBRSxLQUFLO0FBQ2hDLFlBQU0sV0FBVyxVQUFVLElBQUksQ0FBQyxNQUFNO0FBQ3BDLGNBQU0sSUFBSSxJQUFJLENBQUM7QUFDZixjQUFNLElBQUksT0FBTyxDQUFDO0FBQ2xCLGVBQU8sT0FBTyxTQUFTLENBQUMsSUFBSSxJQUFJO0FBQUEsTUFDbEMsQ0FBQztBQUNELFlBQU0sY0FBYyxTQUFTLE9BQU8sQ0FBQyxHQUFHLE1BQU0sSUFBSSxHQUFHLENBQUM7QUFDdEQsVUFBSSxLQUFLLEVBQUUsS0FBSyxVQUFVLFlBQVksQ0FBQztBQUFBLElBQ3pDO0FBQ0EsV0FBTztBQUFBLEVBQ1Q7QUFHQSxXQUFTLHFCQUFxQixVQUFVLFdBQVcsS0FBSztBQUN0RCxVQUFNLE9BQU8sQ0FBQztBQUNkLGVBQVcsTUFBTSxXQUFXO0FBQzFCLFlBQU0sV0FBVyxHQUFHLElBQUksWUFBWTtBQUNwQyxZQUFNLE9BQU8sU0FBUyxXQUFXLFFBQVEsS0FBSztBQUM5QyxZQUFNLFlBQVksT0FBTyx1QkFBdUIsS0FBSyxPQUFPLEdBQUcsSUFBSTtBQUNuRSxZQUFNLE1BQU0sT0FDUixjQUFjLEtBQUssT0FBTyxHQUFHLElBQzdCLEVBQUUsVUFBVSxHQUFHLG9CQUFvQixJQUFJLFNBQVMsSUFBSSxFQUFFO0FBQzFELFlBQU0sV0FBVyxJQUFJLHFCQUFxQixJQUFJLElBQUksV0FBVyxJQUFJLHFCQUFxQjtBQUN0RixZQUFNLFdBQVcsV0FBVztBQUM1QixZQUFNLFFBQVEsR0FBRyxjQUFjO0FBQy9CLFdBQUssS0FBSztBQUFBLFFBQ1IsS0FBSyxHQUFHO0FBQUEsUUFDUixVQUFVLE9BQU8sS0FBSyxXQUFXO0FBQUEsUUFDakMsU0FBUyxPQUFPLEtBQUssVUFBVTtBQUFBLFFBQy9CLFlBQVksT0FBTyxLQUFLLGFBQWE7QUFBQSxRQUNyQztBQUFBLFFBQ0EsVUFBVSxHQUFHO0FBQUEsUUFDYjtBQUFBLFFBQ0E7QUFBQSxRQUNBO0FBQUEsUUFDQSxhQUFhLENBQUMsQ0FBQztBQUFBLE1BQ2pCLENBQUM7QUFBQSxJQUNIO0FBQ0EsV0FBTztBQUFBLEVBQ1Q7QUFFQSxXQUFTLG9CQUFvQjtBQUMzQixVQUFNLFdBQVcsU0FBUyxlQUFlLGdCQUFnQjtBQUN6RCxRQUFJLFNBQVUsUUFBTztBQUNyQixVQUFNLEtBQUssU0FBUyxjQUFjLEtBQUs7QUFDdkMsT0FBRyxLQUFLO0FBQ1IsT0FBRyxZQUFZO0FBQ2YsT0FBRyxNQUFNLFVBQ1A7QUFDRixPQUFHLFVBQVUsU0FBVSxJQUFJO0FBQ3pCLFVBQUksR0FBRyxXQUFXLEdBQUksUUFBTyxtQkFBbUI7QUFBQSxJQUNsRDtBQUNBLE9BQUcsWUFDRDtBQXNCRixhQUFTLEtBQUssWUFBWSxFQUFFO0FBQzVCLFdBQU87QUFBQSxFQUNUO0FBRUEsV0FBUyxhQUFhLE1BQU07QUFDMUIsVUFBTSxPQUFPLFNBQVMsZUFBZSxlQUFlO0FBQ3BELFFBQUksQ0FBQyxLQUFNO0FBQ1gsUUFBSSxDQUFDLFFBQVEsQ0FBQyxLQUFLLFFBQVE7QUFDekIsV0FBSyxZQUNIO0FBQ0Y7QUFBQSxJQUNGO0FBQ0EsVUFBTSxNQUFNLENBQUMsTUFDWCxNQUFNLEtBQUssQ0FBQyxPQUFPLFNBQVMsQ0FBQyxJQUN6QixNQUNBLE9BQU8sQ0FBQyxFQUFFLGVBQWUsU0FBUyxFQUFFLHVCQUF1QixFQUFFLENBQUM7QUFDcEUsVUFBTSxnQkFBZ0IsQ0FBQyxNQUFNO0FBQzNCLFVBQUksSUFBSSxFQUFHLFFBQU87QUFDbEIsVUFBSSxJQUFJLEVBQUcsUUFBTztBQUNsQixhQUFPO0FBQUEsSUFDVDtBQUNBLFVBQU0sV0FBVyxLQUNkO0FBQUEsTUFDQyxDQUFDLE1BQ0MsU0FFQyxFQUFFLGNBQWMsS0FBSyxpREFDdEIsMkZBRUEsZUFBZSxFQUFFLEdBQUcsSUFDcEIsc0RBRUEsZUFBZSxFQUFFLE9BQU8sSUFDeEIsc0RBRUEsZUFBZSxFQUFFLFVBQVUsSUFDM0IsMEZBRUEsSUFBSSxFQUFFLFNBQVMsSUFDZiwwR0FFQSxJQUFJLEVBQUUsUUFBUSxJQUNkLGtIQUVBLElBQUksRUFBRSxRQUFRLElBQ2QsMEZBRUEsSUFBSSxFQUFFLFFBQVEsSUFDZCwrR0FFQSxjQUFjLEVBQUUsS0FBSyxJQUNyQixPQUNBLElBQUksRUFBRSxLQUFLLElBQ1g7QUFBQSxJQUVKLEVBQ0MsS0FBSyxFQUFFO0FBQ1YsVUFBTSxTQUNKO0FBYUYsU0FBSyxZQUNILHVFQUNBLFNBQ0EsWUFDQSxXQUNBO0FBQUEsRUFDSjtBQUVBLFdBQVMsZUFBZSxHQUFHO0FBQ3pCLFFBQUksT0FBTyxPQUFPLGVBQWUsV0FBWSxRQUFPLE9BQU8sV0FBVyxDQUFDO0FBQ3ZFLFdBQU8sT0FBTyxLQUFLLE9BQU8sS0FBSyxDQUFDLEVBQUU7QUFBQSxNQUNoQztBQUFBLE1BQ0EsQ0FBQyxRQUFRLEVBQUUsS0FBSyxTQUFTLEtBQUssUUFBUSxLQUFLLFFBQVEsS0FBSyxVQUFVLEtBQUssUUFBUSxHQUFHLEVBQUU7QUFBQSxJQUN0RjtBQUFBLEVBQ0Y7QUFFQSxTQUFPLG9CQUFvQixpQkFBa0I7QUFDM0MsUUFBSSxDQUFDLGFBQWEsR0FBRztBQUNuQixZQUFNLHdDQUF3QztBQUM5QztBQUFBLElBQ0Y7QUFDQSxVQUFNLEtBQUssa0JBQWtCO0FBQzdCLE9BQUcsTUFBTSxVQUFVO0FBQ25CLFFBQUksaUJBQWtCO0FBQ3RCLFFBQUksQ0FBQyxtQkFBbUI7QUFDdEIseUJBQW1CO0FBQ25CLFlBQU0sUUFBUSxTQUFTLGVBQWUsZ0JBQWdCO0FBQ3RELFVBQUksTUFBTyxPQUFNLGNBQWM7QUFDL0IsVUFBSTtBQUNGLGNBQU0sY0FBYztBQUNwQixZQUFJLE1BQU8sT0FBTSxjQUFjLGtCQUFrQixRQUFRO0FBQUEsTUFDM0QsU0FBUyxHQUFHO0FBQ1YsWUFBSSxNQUFPLE9BQU0sY0FBYywrQkFBZ0MsS0FBSyxFQUFFLFdBQVk7QUFDbEY7QUFBQSxVQUNFO0FBQUEsUUFDRjtBQUFBLE1BQ0YsVUFBRTtBQUNBLDJCQUFtQjtBQUFBLE1BQ3JCO0FBQUEsSUFDRixPQUFPO0FBQ0wsWUFBTSxRQUFRLFNBQVMsZUFBZSxnQkFBZ0I7QUFDdEQsVUFBSSxNQUFPLE9BQU0sY0FBYyxrQkFBa0IsUUFBUTtBQUFBLElBQzNEO0FBQUEsRUFDRjtBQUVBLFNBQU8scUJBQXFCLFdBQVk7QUFDdEMsVUFBTSxLQUFLLFNBQVMsZUFBZSxnQkFBZ0I7QUFDbkQsUUFBSSxHQUFJLElBQUcsTUFBTSxVQUFVO0FBQUEsRUFDN0I7QUFFQSxTQUFPLDBCQUEwQixlQUFnQixPQUFPO0FBQ3RELFVBQU0sT0FBTyxTQUFTLE1BQU0sVUFBVSxNQUFNLE9BQU8sU0FBUyxNQUFNLE9BQU8sTUFBTSxDQUFDO0FBQ2hGLFFBQUksQ0FBQyxLQUFNO0FBQ1gsUUFBSTtBQUNGLFVBQUksQ0FBQyxrQkFBbUIsT0FBTSxjQUFjO0FBQzVDLFlBQU0sTUFBTSxNQUFNLEtBQUssWUFBWTtBQUNuQyxVQUFJLE9BQU8sU0FBUyxhQUFhO0FBQy9CLGNBQU0saUJBQWlCO0FBQ3ZCO0FBQUEsTUFDRjtBQUNBLFlBQU0sS0FBSyxLQUFLLEtBQUssS0FBSyxFQUFFLE1BQU0sUUFBUSxDQUFDO0FBQzNDLFlBQU0sUUFBUSxHQUFHLE9BQU8sR0FBRyxXQUFXLENBQUMsQ0FBQztBQUN4QyxZQUFNLE9BQU8sS0FBSyxNQUFNLGNBQWMsT0FBTyxFQUFFLFFBQVEsR0FBRyxRQUFRLE1BQU0sS0FBSyxLQUFLLENBQUM7QUFDbkYsWUFBTSxTQUFTLG9CQUFvQixJQUFJO0FBQ3ZDLFVBQUksQ0FBQyxPQUFPLFFBQVE7QUFDbEIsY0FBTSwrQ0FBK0M7QUFDckQ7QUFBQSxNQUNGO0FBQ0EsMkJBQXFCO0FBQ3JCLFlBQU0sTUFBTSxvQkFBSSxLQUFLO0FBQ3JCLHNCQUFnQixxQkFBcUIsbUJBQW1CLFFBQVEsR0FBRztBQUNuRSxtQkFBYSxhQUFhO0FBQzFCLFlBQU0sV0FBVyxjQUFjLE9BQU8sQ0FBQyxNQUFNLENBQUMsRUFBRSxXQUFXLEVBQUU7QUFDN0QsWUFBTSxRQUFRLFNBQVMsZUFBZSxnQkFBZ0I7QUFDdEQsVUFBSSxPQUFPO0FBQ1QsY0FBTSxjQUNKLE9BQU8sU0FDUCwrQkFDQyxPQUFPLFNBQVMsWUFDakIsd0JBQ0EsV0FDQTtBQUFBLE1BQ0o7QUFDQSxZQUFNLE1BQU0sU0FBUyxlQUFlLHFCQUFxQjtBQUN6RCxVQUFJLEtBQUs7QUFDUCxZQUFJLFdBQVc7QUFDZixZQUFJLE1BQU0sVUFBVTtBQUFBLE1BQ3RCO0FBQUEsSUFDRixTQUFTLEdBQUc7QUFDVixjQUFRLE1BQU0sMkJBQTJCLENBQUM7QUFDMUMsWUFBTSxrQ0FBbUMsS0FBSyxFQUFFLFdBQVksRUFBRTtBQUFBLElBQ2hFLFVBQUU7QUFFQSxVQUFJLFNBQVMsTUFBTSxPQUFRLE9BQU0sT0FBTyxRQUFRO0FBQUEsSUFDbEQ7QUFBQSxFQUNGO0FBRUEsU0FBTyxzQkFBc0IsV0FBWTtBQUN2QyxRQUFJLENBQUMsaUJBQWlCLENBQUMsY0FBYyxRQUFRO0FBQzNDLFlBQU0sMERBQTBEO0FBQ2hFO0FBQUEsSUFDRjtBQUNBLFFBQUksT0FBTyxTQUFTLGFBQWE7QUFDL0IsWUFBTSxpQkFBaUI7QUFDdkI7QUFBQSxJQUNGO0FBQ0EsVUFBTSxTQUFTLENBQUMsTUFBTSxLQUFLLE1BQU0sT0FBTyxLQUFLLENBQUMsSUFBSSxFQUFFLElBQUk7QUFDeEQsVUFBTSxNQUFNO0FBQUEsTUFDVjtBQUFBLFFBQ0U7QUFBQSxRQUNBO0FBQUEsUUFDQTtBQUFBLFFBQ0E7QUFBQSxRQUNBO0FBQUEsUUFDQTtBQUFBLFFBQ0E7QUFBQSxRQUNBO0FBQUEsTUFDRjtBQUFBLElBQ0Y7QUFDQSxlQUFXLEtBQUssZUFBZTtBQUM3QixVQUFJLEtBQUs7QUFBQSxRQUNQLEVBQUU7QUFBQSxRQUNGLEVBQUU7QUFBQSxRQUNGLEVBQUU7QUFBQSxRQUNGLE9BQU8sRUFBRSxTQUFTO0FBQUEsUUFDbEIsT0FBTyxFQUFFLFFBQVE7QUFBQSxRQUNqQixPQUFPLEVBQUUsUUFBUTtBQUFBLFFBQ2pCLE9BQU8sRUFBRSxRQUFRO0FBQUEsUUFDakIsT0FBTyxFQUFFLEtBQUs7QUFBQSxNQUNoQixDQUFDO0FBQUEsSUFDSDtBQUNBLFVBQU0sS0FBSyxLQUFLLE1BQU0sYUFBYSxHQUFHO0FBRXRDLE9BQUcsT0FBTyxJQUFJO0FBQUEsTUFDWixFQUFFLEtBQUssR0FBRztBQUFBLE1BQ1YsRUFBRSxLQUFLLEdBQUc7QUFBQSxNQUNWLEVBQUUsS0FBSyxHQUFHO0FBQUEsTUFDVixFQUFFLEtBQUssR0FBRztBQUFBLE1BQ1YsRUFBRSxLQUFLLEdBQUc7QUFBQSxNQUNWLEVBQUUsS0FBSyxHQUFHO0FBQUEsTUFDVixFQUFFLEtBQUssR0FBRztBQUFBLE1BQ1YsRUFBRSxLQUFLLEdBQUc7QUFBQSxJQUNaO0FBQ0EsVUFBTSxLQUFLLEtBQUssTUFBTSxTQUFTO0FBQy9CLFNBQUssTUFBTSxrQkFBa0IsSUFBSSxJQUFJLFVBQVU7QUFDL0MsVUFBTSxNQUFNLG9CQUFJLEtBQUs7QUFDckIsVUFBTSxRQUNKLElBQUksWUFBWSxJQUNoQixNQUNBLE9BQU8sSUFBSSxTQUFTLElBQUksQ0FBQyxFQUFFLFNBQVMsR0FBRyxHQUFHLElBQzFDLE1BQ0EsT0FBTyxJQUFJLFFBQVEsQ0FBQyxFQUFFLFNBQVMsR0FBRyxHQUFHO0FBQ3ZDLFNBQUssVUFBVSxJQUFJLHNCQUFzQixRQUFRLE9BQU87QUFBQSxFQUMxRDtBQUlBLFNBQU8seUJBQXlCLGlCQUFrQjtBQUNoRCx3QkFBb0I7QUFDcEIsVUFBTSxjQUFjO0FBQ3BCLFFBQUksb0JBQW9CO0FBQ3RCLFlBQU0sTUFBTSxvQkFBSSxLQUFLO0FBQ3JCLHNCQUFnQixxQkFBcUIsbUJBQW1CLG9CQUFvQixHQUFHO0FBQy9FLG1CQUFhLGFBQWE7QUFBQSxJQUM1QjtBQUFBLEVBQ0Y7IiwKICAibmFtZXMiOiBbXQp9Cg==
