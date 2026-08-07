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
    el.innerHTML = '<div style="position:absolute;inset:1vh 1vw;background:#fff;border-radius:10px;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 20px 50px rgba(0,0,0,.35)"><div style="padding:12px 18px;background:#0f172a;color:#fff;display:flex;align-items:center;gap:12px"><div style="flex:1"><div style="font-size:16px;font-weight:800;letter-spacing:.5px">FORECAST</div><div id="forecast-subtitle" style="font-size:11px;opacity:.8;margin-top:2px">Cargar Sales Plan para ver la proyeccion vs politica de inventario (3 meses)</div></div><button id="forecast-export-btn" onclick="exportForecastExcel()" disabled style="padding:8px 14px;background:#166534;color:#fff;border:none;border-radius:6px;font-weight:700;cursor:pointer;opacity:.5">Exportar Excel</button><button onclick="closeForecastModal()" style="background:transparent;color:#fff;border:1px solid rgba(255,255,255,.4);border-radius:6px;padding:6px 10px;cursor:pointer;font-weight:700">Cerrar</button></div><div style="padding:12px 18px;background:#f8fafc;border-bottom:1px solid #e2e8f0;display:flex;flex-wrap:wrap;gap:14px;align-items:center"><label style="display:inline-flex;align-items:center;gap:8px;padding:8px 12px;background:#0d9488;color:#fff;border-radius:6px;font-weight:700;font-size:12px;cursor:pointer"><span>Cargar Sales Plan (.xlsx)</span><input type="file" accept=".xlsx,.xls" style="display:none" onchange="onForecastSalesPlanFile(event)"/></label><div id="forecast-hint" style="font-size:11px;color:#64748b;max-width:520px">Excel esperado: primera columna <b>SKU</b>, luego 6 columnas con las unidades pedidas mes a mes para los proximos 6 meses. Los headers de los meses pueden ser cualquier nombre (Mes1..Mes6, ago-26..ene-27, etc).</div><div id="forecast-stats" style="margin-left:auto;font-size:11px;color:#475569;font-weight:600"></div></div><div id="forecast-body" style="flex:1;overflow:auto;padding:0"><div style="padding:60px 20px;text-align:center;color:#94a3b8;font-size:14px">Esperando archivo Sales Plan...</div></div></div>';
    document.body.appendChild(el);
    return el;
  }
  function _renderTable(rows) {
    const body = document.getElementById("forecast-body");
    if (!body) return;
    if (!rows || !rows.length) {
      body.innerHTML = '<div style="padding:60px 20px;text-align:center;color:#94a3b8">Sales Plan vacio o sin filas validas.</div>';
      return;
    }
    const fmt = (n) => n === 0 || !Number.isFinite(n) ? "0" : Number(n).toLocaleString("es-AR", { maximumFractionDigits: 1 });
    const colorForTotal = (t) => {
      if (t > 0) return "#166534";
      if (t < 0) return "#c2410c";
      return "#475569";
    };
    const rowsHtml = rows.map(
      (r) => "<tr" + (r.hasHistoria ? "" : ' style="background:#fef3c7"') + '><td style="padding:6px 10px;font-family:monospace;font-size:11px;white-space:nowrap">' + escapeHtmlSafe(r.sku) + '</td><td style="padding:6px 10px;font-size:11px">' + escapeHtmlSafe(r.familia) + '</td><td style="padding:6px 10px;font-size:11px">' + escapeHtmlSafe(r.subfamilia) + '</td><td style="padding:6px 10px;text-align:right;font-variant-numeric:tabular-nums">' + fmt(r.ventas12m) + '</td><td style="padding:6px 10px;text-align:right;font-variant-numeric:tabular-nums;font-weight:600">' + fmt(r.pedido6m) + '</td><td style="padding:6px 10px;text-align:right;font-variant-numeric:tabular-nums;color:#64748b">' + fmt(r.promedio) + '</td><td style="padding:6px 10px;text-align:right;font-variant-numeric:tabular-nums">' + fmt(r.politica) + '</td><td style="padding:6px 10px;text-align:right;font-variant-numeric:tabular-nums;font-weight:700;color:' + colorForTotal(r.total) + '">' + fmt(r.total) + "</td></tr>"
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL2RvbWFpbnMvZm9yZWNhc3QuanMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbIi8vIEB0cy1ub2NoZWNrXG4vLyBHbG9iYWxzIGxlaWRvcyBkZWwgZW50b3JubyAoZGVjbGFyYWRvcyBlbiBpbmRleC5odG1sIGlubGluZSBvIGJ1bmRsZSBwcmV2aW8pOlxuLy8gZmJEYiwgY3VycmVudFVzZXIsIFhMU1ggKGNkbiksIGVzY2FwZUh0bWwuIE1pc21vIHBhdHJvbiBxdWUgb3Ryb3MgZG9taW5pb3MuXG4vL1xuLy8gRk9SRUNBU1QgLSBtb2RhbCBhZG1pbi1vbmx5IChNYXJpYW5vKSBxdWUgY29tcGFyYSB2ZW50YXMgaGlzdG9yaWNhc1xuLy8gKEZpcmVzdG9yZSBza3VfdmVudGFzX3NuYXBzaG90LCBhbGltZW50YWRvIHBvciBzeW5jIEJRIHZfdmVudGFzX2xpbmVhc1xuLy8gdmVudGFuYSAxM20pIHZzIFNhbGVzIFBsYW4gY2FyZ2FkbyBwb3IgZWwgdXNlciB2aWEgRXhjZWwgKyBwb2xpdGljYSBkZVxuLy8gaW52ZW50YXJpbyAocHJvbWVkaW8gWVREIHggMyBtZXNlcykuXG4vL1xuLy8gQ2h1bmsgbGF6eTogc2UgY2FyZ2Egc29sbyBhbCBwcmltZXIgY2xpY2sgZGVsIGJvdG9uIEZPUkVDQVNUIGRlbCBoZWFkZXIuXG4vLyBSZWdpc3RyYWRvIGVuIGJ1aWxkLmpzIExBWllfQ0hVTktTICsgc3JjL21haW4uanMgaW5zdGFsbENodW5rU3R1YnMgKyBzdy5qc1xuLy8gU1RBVElDX0FTU0VUUy4gVmVyIENMQVVERS5tZCAjMTggKDMgbHVnYXJlcyBzaW5jcm9uaXphZG9zKS5cbi8vXG4vLyBDb250cmF0byBkZWwgRXhjZWwgU2FsZXMgUGxhbiBxdWUgc3ViZSBlbCB1c2VyOlxuLy8gICBDb2x1bW5hczogU0tVIHwgTWVzMSB8IE1lczIgfCBNZXMzIHwgTWVzNCB8IE1lczUgfCBNZXM2XG4vLyAgIChub21icmVzIGV4YWN0b3MgZGUgaGVhZGVycyBjYXNlLWluc2Vuc2l0aXZlOyBNZXMxLi42IHNvbiBsb3MgcHJveGltb3Ncbi8vICAgNiBtZXNlcyBkZXNkZSBlbCBtZXMgYWN0dWFsKS4gVW5hIGZpbGEgcG9yIFNLVS5cbi8vXG4vLyBGdWVudGUgZGUgZGF0b3MgaGlzdG9yaWNhczpcbi8vICAgRmlyZXN0b3JlIC9za3VfdmVudGFzX3NuYXBzaG90L3tTS1VfPHNrdV9zYW5lYWRvPn1cbi8vICAge1xuLy8gICAgIHNrdSwgaXRlbU5hbWUsIGZhbWlsaWEsIHN1YmZhbWlsaWEsXG4vLyAgICAgbWVzZXM6IHsgJzIwMjUtMDgnOiB7cXR5LCBhcnN9LCAuLi4sICcyMDI2LTA4Jzoge3F0eSwgYXJzfSB9XG4vLyAgIH1cbi8vICAgUnVsZXM6IHJlYWQgYWRtaW4tb25seSAoY29tcGV0aXRpdmVseSBzZW5zaXRpdmUpLiBFc2NyaXRvIHBvciBjcm9uXG4vLyAgIHN5bmNfc2FwX3RvX2JpZ3F1ZXJ5LnB5IGNhZGEgMzAgbWluLlxuXG4vLyBFc3RhZG8gZGVsIG1vZGFsIChpbnRyYS1jaHVuaywgbm8gY3Jvc3Mtc2NvcGUpLlxubGV0IF9mb3JlY2FzdFNuYXBzaG90ID0gbnVsbDsgLy8geyBTS1U6IHtmYW1pbGlhLCBzdWJmYW1pbGlhLCBpdGVtTmFtZSwgbWVzZXN9IH1cbmxldCBfZm9yZWNhc3RTYWxlc1BsYW4gPSBudWxsOyAvLyBbeyBza3UsIHBlZGlkb1RvdGFsLCBtZXNlc0FycjogW24xLi5uNl0gfV1cbmxldCBfZm9yZWNhc3RSb3dzID0gbnVsbDsgLy8gZmlsYXMgZmluYWxlcyBjYWxjdWxhZGFzIHBhcmEgcHJldmlldyArIGV4cG9ydFxubGV0IF9mb3JlY2FzdExvYWRpbmcgPSBmYWxzZTtcblxuLy8gV2hpdGVsaXN0IGRlIGVtYWlscyBjb24gYWNjZXNvIGFsIG1vZGFsIEZPUkVDQVNULiBSZXBsaWNhIGVsIHBhdHJvbiBkZVxuLy8gXCJBbmFsaXNpc1wiIChpbmRleC5odG1sOjEyNjI1KS4gU29sbyBNYXJpYW5vOyBzaSBvdHJvIGFkbWluIGxvIG5lY2VzaXRhXG4vLyBzZSBhZ3JlZ2EgYWNhIGV4cGxpY2l0by5cbmNvbnN0IEZPUkVDQVNUX0FMTE9XRURfRU1BSUxTID0gWydtYXJpYW5vLmVyYmlub0BzaGltYW5vLmNvbS5hcicsICdlcmJpbm9tYXJpYW5vQGdtYWlsLmNvbSddO1xuXG5mdW5jdGlvbiBfY2FuRm9yZWNhc3QoKSB7XG4gIHRyeSB7XG4gICAgY29uc3QgZW1haWwgPSAoKHdpbmRvdy5jdXJyZW50VXNlciAmJiB3aW5kb3cuY3VycmVudFVzZXIuZW1haWwpIHx8ICcnKS50b0xvd2VyQ2FzZSgpO1xuICAgIGlmICghZW1haWwpIHJldHVybiBmYWxzZTtcbiAgICByZXR1cm4gRk9SRUNBU1RfQUxMT1dFRF9FTUFJTFMuaW5kZXhPZihlbWFpbCkgPj0gMDtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG59XG5cbi8vIEhlbHBlcnMgZGUgbWVzIGNhbGVuZGFyLlxuZnVuY3Rpb24gX21vbnRoS2V5KHllYXIsIG1vbnRoT25lQmFzZWQpIHtcbiAgcmV0dXJuIFN0cmluZyh5ZWFyKS5wYWRTdGFydCg0LCAnMCcpICsgJy0nICsgU3RyaW5nKG1vbnRoT25lQmFzZWQpLnBhZFN0YXJ0KDIsICcwJyk7XG59XG5mdW5jdGlvbiBfbW9udGhMYWJlbChrZXkpIHtcbiAgLy8gJzIwMjYtMDgnIC0+ICdhZ28tMjYnXG4gIGNvbnN0IFt5LCBtXSA9IGtleS5zcGxpdCgnLScpLm1hcChOdW1iZXIpO1xuICBjb25zdCBuYW1lcyA9IFtcbiAgICAnZW5lJyxcbiAgICAnZmViJyxcbiAgICAnbWFyJyxcbiAgICAnYWJyJyxcbiAgICAnbWF5JyxcbiAgICAnanVuJyxcbiAgICAnanVsJyxcbiAgICAnYWdvJyxcbiAgICAnc2VwJyxcbiAgICAnb2N0JyxcbiAgICAnbm92JyxcbiAgICAnZGljJyxcbiAgXTtcbiAgcmV0dXJuIG5hbWVzW20gLSAxXSArICctJyArIFN0cmluZyh5KS5zbGljZSgtMik7XG59XG5mdW5jdGlvbiBfYWRkTW9udGhzKHllYXIsIG1vbnRoT25lQmFzZWQsIGRlbHRhKSB7XG4gIGNvbnN0IHRvdGFsTW9udGhzID0geWVhciAqIDEyICsgKG1vbnRoT25lQmFzZWQgLSAxKSArIGRlbHRhO1xuICBjb25zdCB5ID0gTWF0aC5mbG9vcih0b3RhbE1vbnRocyAvIDEyKTtcbiAgY29uc3QgbSA9ICh0b3RhbE1vbnRocyAlIDEyKSArIDE7XG4gIHJldHVybiB7IHksIG0gfTtcbn1cblxuLy8gU3VtYSBxdHkgZGVsIFNLVSBlbiBsb3MgdWx0aW1vcyAxMiBNRVNFUyBDT01QTEVUT1MgKGV4Y2x1eWUgZWwgbWVzIGFjdHVhbFxuLy8gcGFyY2lhbCAtIGxhIHZlbnRhbmEgbW92aWwgXCIxMiBtZXNlcyBjZXJyYWRvc1wiIHF1ZSBlbCB1c2VyIHBpZW5zYSBjb21vXG4vLyBcImVsIGFcdTAwRjFvIHF1ZSB5YSBwYXNvXCIpLiBFamVtcGxvIGVuIGFnb3N0byAyMDI2OiBzdW1hciBhZ28tMjUgYSBqdWwtMjYuXG5mdW5jdGlvbiBfc3VtVmVudGFzMTJtQ29tcGxldG9zKG1lc2VzTWFwLCBob3kpIHtcbiAgaWYgKCFtZXNlc01hcCkgcmV0dXJuIDA7XG4gIGxldCBzdW0gPSAwO1xuICBjb25zdCBzdGFydE1vbnRoID0gX2FkZE1vbnRocyhob3kuZ2V0RnVsbFllYXIoKSwgaG95LmdldE1vbnRoKCkgKyAxLCAtMTIpO1xuICBjb25zdCBlbmRNb250aCA9IF9hZGRNb250aHMoaG95LmdldEZ1bGxZZWFyKCksIGhveS5nZXRNb250aCgpICsgMSwgLTEpO1xuICBjb25zdCBzdGFydEtleSA9IF9tb250aEtleShzdGFydE1vbnRoLnksIHN0YXJ0TW9udGgubSk7XG4gIGNvbnN0IGVuZEtleSA9IF9tb250aEtleShlbmRNb250aC55LCBlbmRNb250aC5tKTtcbiAgZm9yIChjb25zdCBrIG9mIE9iamVjdC5rZXlzKG1lc2VzTWFwKSkge1xuICAgIGlmIChrID49IHN0YXJ0S2V5ICYmIGsgPD0gZW5kS2V5KSB7XG4gICAgICBzdW0gKz0gTnVtYmVyKChtZXNlc01hcFtrXSAmJiBtZXNlc01hcFtrXS5xdHkpIHx8IDApO1xuICAgIH1cbiAgfVxuICByZXR1cm4gc3VtO1xufVxuXG4vLyBTdW1hIHF0eSBkZWwgU0tVIFlURCAoZW5lcm8gZGVsIGFcdTAwRjFvIGFjdHVhbCBoYXN0YSBtZXMgYWN0dWFsIElOQ0xVU0lWTyxcbi8vIGF1bnF1ZSBlbCBtZXMgYWN0dWFsIHNlYSBwYXJjaWFsKS4gUmV0b3JuYSB7IHRvdGFsWXRkLCBtZXNlc1RyYW5zY3Vycmlkb3MgfS5cbi8vIEVqZW1wbG8gYWdvc3RvIDIwMjYgY29uIHZlbnRhcyBqdWw9MTAgKyBhZ289MjAgLT4gezMwLCA4fSwgcHJvbWVkaW89MzAvOD0zLjc1LlxuLy8gKFNpIGVsIHVzdWFyaW8gZXNwZXJhYmEgZGl2aWRpciBwb3IgMiBlbiB2ZXogZGUgOCwgcmV2aXNhciBzcGVjLiBFbCBwZWRpZG9cbi8vIGRpY2UgXCJjYW50aWRhZCBkZSBtZXNlcyBxdWUgdHJhbnNjdXJyaW1vc1wiID0gbWVzZXMgZGVsIGFcdTAwRjFvIHBhc2Fkb3MgaGFzdGEgaG95LilcbmZ1bmN0aW9uIF9zdW1WZW50YXNZVEQobWVzZXNNYXAsIGhveSkge1xuICBjb25zdCB5ZWFyID0gaG95LmdldEZ1bGxZZWFyKCk7XG4gIGNvbnN0IG1lc0FjdHVhbCA9IGhveS5nZXRNb250aCgpICsgMTtcbiAgbGV0IHRvdGFsID0gMDtcbiAgaWYgKG1lc2VzTWFwKSB7XG4gICAgZm9yIChsZXQgbSA9IDE7IG0gPD0gbWVzQWN0dWFsOyBtKyspIHtcbiAgICAgIGNvbnN0IGsgPSBfbW9udGhLZXkoeWVhciwgbSk7XG4gICAgICB0b3RhbCArPSBOdW1iZXIoKG1lc2VzTWFwW2tdICYmIG1lc2VzTWFwW2tdLnF0eSkgfHwgMCk7XG4gICAgfVxuICB9XG4gIHJldHVybiB7IHRvdGFsWXRkOiB0b3RhbCwgbWVzZXNUcmFuc2N1cnJpZG9zOiBtZXNBY3R1YWwgfTtcbn1cblxuLy8gQ2FyZ2Egc2t1X3ZlbnRhc19zbmFwc2hvdCBjb21wbGV0byAodW5hIHZleiBwb3Igc2VzaW9uIGRlbCBtb2RhbCkuXG5hc3luYyBmdW5jdGlvbiBfbG9hZFNuYXBzaG90KCkge1xuICBpZiAoX2ZvcmVjYXN0U25hcHNob3QpIHJldHVybiBfZm9yZWNhc3RTbmFwc2hvdDtcbiAgaWYgKCF3aW5kb3cuZmJEYikgdGhyb3cgbmV3IEVycm9yKCdGaXJlc3RvcmUgbm8gaW5pY2lhbGl6YWRvJyk7XG4gIGNvbnN0IHNuYXAgPSBhd2FpdCB3aW5kb3cuZmJEYi5jb2xsZWN0aW9uKCdza3VfdmVudGFzX3NuYXBzaG90JykuZ2V0KCk7XG4gIGNvbnN0IGJ5T3JpZ2luYWxTa3UgPSB7fTtcbiAgY29uc3QgYnlVcHBlclNrdSA9IHt9O1xuICBzbmFwLmZvckVhY2goKGRvYykgPT4ge1xuICAgIGNvbnN0IGQgPSBkb2MuZGF0YSgpO1xuICAgIGlmICghZCB8fCAhZC5za3UpIHJldHVybjtcbiAgICBjb25zdCBza3VVcHBlciA9IFN0cmluZyhkLnNrdSkudHJpbSgpLnRvVXBwZXJDYXNlKCk7XG4gICAgY29uc3QgcmVjb3JkID0ge1xuICAgICAgc2t1OiBkLnNrdSxcbiAgICAgIGl0ZW1OYW1lOiBkLml0ZW1OYW1lIHx8ICcnLFxuICAgICAgZmFtaWxpYTogZC5mYW1pbGlhIHx8ICcnLFxuICAgICAgc3ViZmFtaWxpYTogZC5zdWJmYW1pbGlhIHx8ICcnLFxuICAgICAgbWVzZXM6IGQubWVzZXMgfHwge30sXG4gICAgfTtcbiAgICBieU9yaWdpbmFsU2t1W2Quc2t1XSA9IHJlY29yZDtcbiAgICBieVVwcGVyU2t1W3NrdVVwcGVyXSA9IHJlY29yZDtcbiAgfSk7XG4gIF9mb3JlY2FzdFNuYXBzaG90ID0geyBieU9yaWdpbmFsU2t1LCBieVVwcGVyU2t1LCBjb3VudDogc25hcC5zaXplIH07XG4gIHJldHVybiBfZm9yZWNhc3RTbmFwc2hvdDtcbn1cblxuLy8gUGFyc2VhIGVsIEV4Y2VsIFNhbGVzIFBsYW4uIEVzcGVyYSBjb2x1bW5hcyBTS1UgKyA2IGNvbHVtbmFzIG51bWVyaWNhc1xuLy8gKG5vbWJyZXMgZmxleGlibGVzOiBNZXMxLi5NZXM2LCBtZXNfMS4ubWVzXzYsIG8gY3VhbHF1aWVyIGhlYWRlciBjdXN0b21cbi8vIG1pZW50cmFzIGxhIHByaW1lcmEgc2VhIFNLVSB5IGhheWEgYWwgbWVub3MgNiBjb2x1bW5hcyBudW1lcmljYXMgbWFzKS5cbmZ1bmN0aW9uIF9wYXJzZVNhbGVzUGxhblJvd3Mocm93c1Jhdykge1xuICBpZiAoIXJvd3NSYXcgfHwgIXJvd3NSYXcubGVuZ3RoKSByZXR1cm4gW107XG4gIGNvbnN0IGhlYWRlclJvdyA9IHJvd3NSYXdbMF07XG4gIC8vIERldGVjdGFyIGluZGljZSBkZSBjb2x1bW5hIFNLVVxuICBsZXQgc2t1Q29sSWR4ID0gLTE7XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgaGVhZGVyUm93Lmxlbmd0aDsgaSsrKSB7XG4gICAgY29uc3QgaCA9IFN0cmluZyhoZWFkZXJSb3dbaV0gfHwgJycpXG4gICAgICAudHJpbSgpXG4gICAgICAudG9VcHBlckNhc2UoKTtcbiAgICBpZiAoaCA9PT0gJ1NLVScgfHwgaCA9PT0gJ0lURU1DT0RFJyB8fCBoID09PSAnSVRFTScgfHwgaCA9PT0gJ0lURU0gQ09ERScgfHwgaCA9PT0gJ0NPRElHTycpIHtcbiAgICAgIHNrdUNvbElkeCA9IGk7XG4gICAgICBicmVhaztcbiAgICB9XG4gIH1cbiAgaWYgKHNrdUNvbElkeCA8IDApXG4gICAgdGhyb3cgbmV3IEVycm9yKCdFbCBFeGNlbCBkZWJlIHRlbmVyIHVuYSBjb2x1bW5hIGxsYW1hZGEgXCJTS1VcIiAobyBDb2RpZ28gLyBJdGVtQ29kZSAvIEl0ZW0pJyk7XG4gIC8vIExhcyA2IGNvbHVtbmFzIGRlIG1lc2VzOiBsYXMgcHJpbWVyYXMgNiBjb2x1bW5hcyBxdWUgc2VhbiAhPSBza3VDb2xJZHguXG4gIGNvbnN0IG1vbnRoQ29scyA9IFtdO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IGhlYWRlclJvdy5sZW5ndGggJiYgbW9udGhDb2xzLmxlbmd0aCA8IDY7IGkrKykge1xuICAgIGlmIChpICE9PSBza3VDb2xJZHgpIG1vbnRoQ29scy5wdXNoKGkpO1xuICB9XG4gIGlmIChtb250aENvbHMubGVuZ3RoIDwgNilcbiAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAnRWwgRXhjZWwgZGViZSB0ZW5lciBhbCBtZW5vcyA2IGNvbHVtbmFzIGRlIG1lc2VzIGFkZW1hcyBkZSBTS1UgKGVuY29udHJhZGFzOiAnICtcbiAgICAgICAgbW9udGhDb2xzLmxlbmd0aCArXG4gICAgICAgICcpJ1xuICAgICk7XG4gIGNvbnN0IG91dCA9IFtdO1xuICBmb3IgKGxldCByID0gMTsgciA8IHJvd3NSYXcubGVuZ3RoOyByKyspIHtcbiAgICBjb25zdCByb3cgPSByb3dzUmF3W3JdO1xuICAgIGlmICghcm93IHx8ICFyb3cubGVuZ3RoKSBjb250aW51ZTtcbiAgICBjb25zdCBza3VSYXcgPSByb3dbc2t1Q29sSWR4XTtcbiAgICBpZiAoc2t1UmF3ID09PSB1bmRlZmluZWQgfHwgc2t1UmF3ID09PSBudWxsIHx8IFN0cmluZyhza3VSYXcpLnRyaW0oKSA9PT0gJycpIGNvbnRpbnVlO1xuICAgIGNvbnN0IHNrdSA9IFN0cmluZyhza3VSYXcpLnRyaW0oKTtcbiAgICBjb25zdCBtZXNlc0FyciA9IG1vbnRoQ29scy5tYXAoKGkpID0+IHtcbiAgICAgIGNvbnN0IHYgPSByb3dbaV07XG4gICAgICBjb25zdCBuID0gTnVtYmVyKHYpO1xuICAgICAgcmV0dXJuIE51bWJlci5pc0Zpbml0ZShuKSA/IG4gOiAwO1xuICAgIH0pO1xuICAgIGNvbnN0IHBlZGlkb1RvdGFsID0gbWVzZXNBcnIucmVkdWNlKChhLCBiKSA9PiBhICsgYiwgMCk7XG4gICAgb3V0LnB1c2goeyBza3UsIG1lc2VzQXJyLCBwZWRpZG9Ub3RhbCB9KTtcbiAgfVxuICByZXR1cm4gb3V0O1xufVxuXG4vLyBDYWxjdWxhIGxhcyBmaWxhcyBmaW5hbGVzIGNydXphbmRvIHNuYXBzaG90ICsgc2FsZXMgcGxhbi5cbmZ1bmN0aW9uIF9jb21wdXRlRm9yZWNhc3RSb3dzKHNuYXBzaG90LCBzYWxlc1BsYW4sIGhveSkge1xuICBjb25zdCByb3dzID0gW107XG4gIGZvciAoY29uc3Qgc3Agb2Ygc2FsZXNQbGFuKSB7XG4gICAgY29uc3Qgc2t1VXBwZXIgPSBzcC5za3UudG9VcHBlckNhc2UoKTtcbiAgICBjb25zdCBoaXN0ID0gc25hcHNob3QuYnlVcHBlclNrdVtza3VVcHBlcl0gfHwgbnVsbDtcbiAgICBjb25zdCB2ZW50YXMxMm0gPSBoaXN0ID8gX3N1bVZlbnRhczEybUNvbXBsZXRvcyhoaXN0Lm1lc2VzLCBob3kpIDogMDtcbiAgICBjb25zdCB5dGQgPSBoaXN0XG4gICAgICA/IF9zdW1WZW50YXNZVEQoaGlzdC5tZXNlcywgaG95KVxuICAgICAgOiB7IHRvdGFsWXRkOiAwLCBtZXNlc1RyYW5zY3Vycmlkb3M6IGhveS5nZXRNb250aCgpICsgMSB9O1xuICAgIGNvbnN0IHByb21lZGlvID0geXRkLm1lc2VzVHJhbnNjdXJyaWRvcyA+IDAgPyB5dGQudG90YWxZdGQgLyB5dGQubWVzZXNUcmFuc2N1cnJpZG9zIDogMDtcbiAgICBjb25zdCBwb2xpdGljYSA9IHByb21lZGlvICogMztcbiAgICBjb25zdCB0b3RhbCA9IHNwLnBlZGlkb1RvdGFsIC0gcG9saXRpY2E7XG4gICAgcm93cy5wdXNoKHtcbiAgICAgIHNrdTogc3Auc2t1LFxuICAgICAgaXRlbU5hbWU6IGhpc3QgPyBoaXN0Lml0ZW1OYW1lIDogJycsXG4gICAgICBmYW1pbGlhOiBoaXN0ID8gaGlzdC5mYW1pbGlhIDogJyhzaW4gbWF0Y2gpJyxcbiAgICAgIHN1YmZhbWlsaWE6IGhpc3QgPyBoaXN0LnN1YmZhbWlsaWEgOiAnKHNpbiBtYXRjaCknLFxuICAgICAgdmVudGFzMTJtOiB2ZW50YXMxMm0sXG4gICAgICBwZWRpZG82bTogc3AucGVkaWRvVG90YWwsXG4gICAgICBwcm9tZWRpbzogcHJvbWVkaW8sXG4gICAgICBwb2xpdGljYTogcG9saXRpY2EsXG4gICAgICB0b3RhbDogdG90YWwsXG4gICAgICBoYXNIaXN0b3JpYTogISFoaXN0LFxuICAgIH0pO1xuICB9XG4gIHJldHVybiByb3dzO1xufVxuXG5mdW5jdGlvbiBfcmVuZGVyTW9kYWxTaGVsbCgpIHtcbiAgY29uc3QgZXhpc3RpbmcgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZm9yZWNhc3QtbW9kYWwnKTtcbiAgaWYgKGV4aXN0aW5nKSByZXR1cm4gZXhpc3Rpbmc7XG4gIGNvbnN0IGVsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2Jyk7XG4gIGVsLmlkID0gJ2ZvcmVjYXN0LW1vZGFsJztcbiAgZWwuY2xhc3NOYW1lID0gJ21vZGFsLW92ZXJsYXknO1xuICBlbC5zdHlsZS5jc3NUZXh0ID1cbiAgICAnZGlzcGxheTpub25lO3Bvc2l0aW9uOmZpeGVkO2luc2V0OjA7YmFja2dyb3VuZDpyZ2JhKDE1LDIzLDQyLC42KTt6LWluZGV4OjIwNTA7JztcbiAgZWwub25jbGljayA9IGZ1bmN0aW9uIChldikge1xuICAgIGlmIChldi50YXJnZXQgPT09IGVsKSB3aW5kb3cuY2xvc2VGb3JlY2FzdE1vZGFsKCk7XG4gIH07XG4gIGVsLmlubmVySFRNTCA9XG4gICAgJycgK1xuICAgICc8ZGl2IHN0eWxlPVwicG9zaXRpb246YWJzb2x1dGU7aW5zZXQ6MXZoIDF2dztiYWNrZ3JvdW5kOiNmZmY7Ym9yZGVyLXJhZGl1czoxMHB4O2Rpc3BsYXk6ZmxleDtmbGV4LWRpcmVjdGlvbjpjb2x1bW47b3ZlcmZsb3c6aGlkZGVuO2JveC1zaGFkb3c6MCAyMHB4IDUwcHggcmdiYSgwLDAsMCwuMzUpXCI+JyArXG4gICAgJzxkaXYgc3R5bGU9XCJwYWRkaW5nOjEycHggMThweDtiYWNrZ3JvdW5kOiMwZjE3MmE7Y29sb3I6I2ZmZjtkaXNwbGF5OmZsZXg7YWxpZ24taXRlbXM6Y2VudGVyO2dhcDoxMnB4XCI+JyArXG4gICAgJzxkaXYgc3R5bGU9XCJmbGV4OjFcIj4nICtcbiAgICAnPGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxNnB4O2ZvbnQtd2VpZ2h0OjgwMDtsZXR0ZXItc3BhY2luZzouNXB4XCI+Rk9SRUNBU1Q8L2Rpdj4nICtcbiAgICAnPGRpdiBpZD1cImZvcmVjYXN0LXN1YnRpdGxlXCIgc3R5bGU9XCJmb250LXNpemU6MTFweDtvcGFjaXR5Oi44O21hcmdpbi10b3A6MnB4XCI+Q2FyZ2FyIFNhbGVzIFBsYW4gcGFyYSB2ZXIgbGEgcHJveWVjY2lvbiB2cyBwb2xpdGljYSBkZSBpbnZlbnRhcmlvICgzIG1lc2VzKTwvZGl2PicgK1xuICAgICc8L2Rpdj4nICtcbiAgICAnPGJ1dHRvbiBpZD1cImZvcmVjYXN0LWV4cG9ydC1idG5cIiBvbmNsaWNrPVwiZXhwb3J0Rm9yZWNhc3RFeGNlbCgpXCIgZGlzYWJsZWQgc3R5bGU9XCJwYWRkaW5nOjhweCAxNHB4O2JhY2tncm91bmQ6IzE2NjUzNDtjb2xvcjojZmZmO2JvcmRlcjpub25lO2JvcmRlci1yYWRpdXM6NnB4O2ZvbnQtd2VpZ2h0OjcwMDtjdXJzb3I6cG9pbnRlcjtvcGFjaXR5Oi41XCI+RXhwb3J0YXIgRXhjZWw8L2J1dHRvbj4nICtcbiAgICAnPGJ1dHRvbiBvbmNsaWNrPVwiY2xvc2VGb3JlY2FzdE1vZGFsKClcIiBzdHlsZT1cImJhY2tncm91bmQ6dHJhbnNwYXJlbnQ7Y29sb3I6I2ZmZjtib3JkZXI6MXB4IHNvbGlkIHJnYmEoMjU1LDI1NSwyNTUsLjQpO2JvcmRlci1yYWRpdXM6NnB4O3BhZGRpbmc6NnB4IDEwcHg7Y3Vyc29yOnBvaW50ZXI7Zm9udC13ZWlnaHQ6NzAwXCI+Q2VycmFyPC9idXR0b24+JyArXG4gICAgJzwvZGl2PicgK1xuICAgICc8ZGl2IHN0eWxlPVwicGFkZGluZzoxMnB4IDE4cHg7YmFja2dyb3VuZDojZjhmYWZjO2JvcmRlci1ib3R0b206MXB4IHNvbGlkICNlMmU4ZjA7ZGlzcGxheTpmbGV4O2ZsZXgtd3JhcDp3cmFwO2dhcDoxNHB4O2FsaWduLWl0ZW1zOmNlbnRlclwiPicgK1xuICAgICc8bGFiZWwgc3R5bGU9XCJkaXNwbGF5OmlubGluZS1mbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtnYXA6OHB4O3BhZGRpbmc6OHB4IDEycHg7YmFja2dyb3VuZDojMGQ5NDg4O2NvbG9yOiNmZmY7Ym9yZGVyLXJhZGl1czo2cHg7Zm9udC13ZWlnaHQ6NzAwO2ZvbnQtc2l6ZToxMnB4O2N1cnNvcjpwb2ludGVyXCI+JyArXG4gICAgJzxzcGFuPkNhcmdhciBTYWxlcyBQbGFuICgueGxzeCk8L3NwYW4+JyArXG4gICAgJzxpbnB1dCB0eXBlPVwiZmlsZVwiIGFjY2VwdD1cIi54bHN4LC54bHNcIiBzdHlsZT1cImRpc3BsYXk6bm9uZVwiIG9uY2hhbmdlPVwib25Gb3JlY2FzdFNhbGVzUGxhbkZpbGUoZXZlbnQpXCIvPicgK1xuICAgICc8L2xhYmVsPicgK1xuICAgICc8ZGl2IGlkPVwiZm9yZWNhc3QtaGludFwiIHN0eWxlPVwiZm9udC1zaXplOjExcHg7Y29sb3I6IzY0NzQ4YjttYXgtd2lkdGg6NTIwcHhcIj5FeGNlbCBlc3BlcmFkbzogcHJpbWVyYSBjb2x1bW5hIDxiPlNLVTwvYj4sIGx1ZWdvIDYgY29sdW1uYXMgY29uIGxhcyB1bmlkYWRlcyBwZWRpZGFzIG1lcyBhIG1lcyBwYXJhIGxvcyBwcm94aW1vcyA2IG1lc2VzLiBMb3MgaGVhZGVycyBkZSBsb3MgbWVzZXMgcHVlZGVuIHNlciBjdWFscXVpZXIgbm9tYnJlIChNZXMxLi5NZXM2LCBhZ28tMjYuLmVuZS0yNywgZXRjKS48L2Rpdj4nICtcbiAgICAnPGRpdiBpZD1cImZvcmVjYXN0LXN0YXRzXCIgc3R5bGU9XCJtYXJnaW4tbGVmdDphdXRvO2ZvbnQtc2l6ZToxMXB4O2NvbG9yOiM0NzU1Njk7Zm9udC13ZWlnaHQ6NjAwXCI+PC9kaXY+JyArXG4gICAgJzwvZGl2PicgK1xuICAgICc8ZGl2IGlkPVwiZm9yZWNhc3QtYm9keVwiIHN0eWxlPVwiZmxleDoxO292ZXJmbG93OmF1dG87cGFkZGluZzowXCI+JyArXG4gICAgJzxkaXYgc3R5bGU9XCJwYWRkaW5nOjYwcHggMjBweDt0ZXh0LWFsaWduOmNlbnRlcjtjb2xvcjojOTRhM2I4O2ZvbnQtc2l6ZToxNHB4XCI+RXNwZXJhbmRvIGFyY2hpdm8gU2FsZXMgUGxhbi4uLjwvZGl2PicgK1xuICAgICc8L2Rpdj4nICtcbiAgICAnPC9kaXY+JztcbiAgZG9jdW1lbnQuYm9keS5hcHBlbmRDaGlsZChlbCk7XG4gIHJldHVybiBlbDtcbn1cblxuZnVuY3Rpb24gX3JlbmRlclRhYmxlKHJvd3MpIHtcbiAgY29uc3QgYm9keSA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdmb3JlY2FzdC1ib2R5Jyk7XG4gIGlmICghYm9keSkgcmV0dXJuO1xuICBpZiAoIXJvd3MgfHwgIXJvd3MubGVuZ3RoKSB7XG4gICAgYm9keS5pbm5lckhUTUwgPVxuICAgICAgJzxkaXYgc3R5bGU9XCJwYWRkaW5nOjYwcHggMjBweDt0ZXh0LWFsaWduOmNlbnRlcjtjb2xvcjojOTRhM2I4XCI+U2FsZXMgUGxhbiB2YWNpbyBvIHNpbiBmaWxhcyB2YWxpZGFzLjwvZGl2Pic7XG4gICAgcmV0dXJuO1xuICB9XG4gIGNvbnN0IGZtdCA9IChuKSA9PlxuICAgIG4gPT09IDAgfHwgIU51bWJlci5pc0Zpbml0ZShuKVxuICAgICAgPyAnMCdcbiAgICAgIDogTnVtYmVyKG4pLnRvTG9jYWxlU3RyaW5nKCdlcy1BUicsIHsgbWF4aW11bUZyYWN0aW9uRGlnaXRzOiAxIH0pO1xuICBjb25zdCBjb2xvckZvclRvdGFsID0gKHQpID0+IHtcbiAgICBpZiAodCA+IDApIHJldHVybiAnIzE2NjUzNCc7IC8vIHNvYnJhIChwZWRpc3RlIG1hcyBxdWUgbGEgcG9saXRpY2EpIC0gdmVyZGVcbiAgICBpZiAodCA8IDApIHJldHVybiAnI2MyNDEwYyc7IC8vIGZhbHRhIChwZWRpc3RlIG1lbm9zIHF1ZSBsYSBwb2xpdGljYSkgLSBuYXJhbmphIHVyZ2VudGVcbiAgICByZXR1cm4gJyM0NzU1NjknO1xuICB9O1xuICBjb25zdCByb3dzSHRtbCA9IHJvd3NcbiAgICAubWFwKFxuICAgICAgKHIpID0+XG4gICAgICAgICcnICtcbiAgICAgICAgJzx0cicgK1xuICAgICAgICAoci5oYXNIaXN0b3JpYSA/ICcnIDogJyBzdHlsZT1cImJhY2tncm91bmQ6I2ZlZjNjN1wiJykgK1xuICAgICAgICAnPicgK1xuICAgICAgICAnPHRkIHN0eWxlPVwicGFkZGluZzo2cHggMTBweDtmb250LWZhbWlseTptb25vc3BhY2U7Zm9udC1zaXplOjExcHg7d2hpdGUtc3BhY2U6bm93cmFwXCI+JyArXG4gICAgICAgIGVzY2FwZUh0bWxTYWZlKHIuc2t1KSArXG4gICAgICAgICc8L3RkPicgK1xuICAgICAgICAnPHRkIHN0eWxlPVwicGFkZGluZzo2cHggMTBweDtmb250LXNpemU6MTFweFwiPicgK1xuICAgICAgICBlc2NhcGVIdG1sU2FmZShyLmZhbWlsaWEpICtcbiAgICAgICAgJzwvdGQ+JyArXG4gICAgICAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjZweCAxMHB4O2ZvbnQtc2l6ZToxMXB4XCI+JyArXG4gICAgICAgIGVzY2FwZUh0bWxTYWZlKHIuc3ViZmFtaWxpYSkgK1xuICAgICAgICAnPC90ZD4nICtcbiAgICAgICAgJzx0ZCBzdHlsZT1cInBhZGRpbmc6NnB4IDEwcHg7dGV4dC1hbGlnbjpyaWdodDtmb250LXZhcmlhbnQtbnVtZXJpYzp0YWJ1bGFyLW51bXNcIj4nICtcbiAgICAgICAgZm10KHIudmVudGFzMTJtKSArXG4gICAgICAgICc8L3RkPicgK1xuICAgICAgICAnPHRkIHN0eWxlPVwicGFkZGluZzo2cHggMTBweDt0ZXh0LWFsaWduOnJpZ2h0O2ZvbnQtdmFyaWFudC1udW1lcmljOnRhYnVsYXItbnVtcztmb250LXdlaWdodDo2MDBcIj4nICtcbiAgICAgICAgZm10KHIucGVkaWRvNm0pICtcbiAgICAgICAgJzwvdGQ+JyArXG4gICAgICAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjZweCAxMHB4O3RleHQtYWxpZ246cmlnaHQ7Zm9udC12YXJpYW50LW51bWVyaWM6dGFidWxhci1udW1zO2NvbG9yOiM2NDc0OGJcIj4nICtcbiAgICAgICAgZm10KHIucHJvbWVkaW8pICtcbiAgICAgICAgJzwvdGQ+JyArXG4gICAgICAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjZweCAxMHB4O3RleHQtYWxpZ246cmlnaHQ7Zm9udC12YXJpYW50LW51bWVyaWM6dGFidWxhci1udW1zXCI+JyArXG4gICAgICAgIGZtdChyLnBvbGl0aWNhKSArXG4gICAgICAgICc8L3RkPicgK1xuICAgICAgICAnPHRkIHN0eWxlPVwicGFkZGluZzo2cHggMTBweDt0ZXh0LWFsaWduOnJpZ2h0O2ZvbnQtdmFyaWFudC1udW1lcmljOnRhYnVsYXItbnVtcztmb250LXdlaWdodDo3MDA7Y29sb3I6JyArXG4gICAgICAgIGNvbG9yRm9yVG90YWwoci50b3RhbCkgK1xuICAgICAgICAnXCI+JyArXG4gICAgICAgIGZtdChyLnRvdGFsKSArXG4gICAgICAgICc8L3RkPicgK1xuICAgICAgICAnPC90cj4nXG4gICAgKVxuICAgIC5qb2luKCcnKTtcbiAgY29uc3QgaGVhZGVyID1cbiAgICAnJyArXG4gICAgJzx0aGVhZCBzdHlsZT1cInBvc2l0aW9uOnN0aWNreTt0b3A6MDtiYWNrZ3JvdW5kOiMwZjE3MmE7Y29sb3I6I2ZmZjt6LWluZGV4OjFcIj4nICtcbiAgICAnPHRyPicgK1xuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjhweCAxMHB4O3RleHQtYWxpZ246bGVmdDtmb250LXNpemU6MTFweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7bGV0dGVyLXNwYWNpbmc6LjRweFwiPlNLVTwvdGg+JyArXG4gICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6OHB4IDEwcHg7dGV4dC1hbGlnbjpsZWZ0O2ZvbnQtc2l6ZToxMXB4O3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtsZXR0ZXItc3BhY2luZzouNHB4XCI+RmFtaWxpYTwvdGg+JyArXG4gICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6OHB4IDEwcHg7dGV4dC1hbGlnbjpsZWZ0O2ZvbnQtc2l6ZToxMXB4O3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtsZXR0ZXItc3BhY2luZzouNHB4XCI+U3ViZmFtaWxpYTwvdGg+JyArXG4gICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6OHB4IDEwcHg7dGV4dC1hbGlnbjpyaWdodDtmb250LXNpemU6MTFweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7bGV0dGVyLXNwYWNpbmc6LjRweFwiIHRpdGxlPVwiU3VtYSBkZSBxdHkgZmFjdHVyYWRhIGVuIGxvcyB1bHRpbW9zIDEyIG1lc2VzIGNvbXBsZXRvc1wiPlZlbnRhcyAxMm08L3RoPicgK1xuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjhweCAxMHB4O3RleHQtYWxpZ246cmlnaHQ7Zm9udC1zaXplOjExcHg7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO2xldHRlci1zcGFjaW5nOi40cHhcIiB0aXRsZT1cIlN1bWEgZGUgbGFzIDYgY29sdW1uYXMgZGVsIEV4Y2VsIFNhbGVzIFBsYW5cIj5QZWRpZG8gNm08L3RoPicgK1xuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjhweCAxMHB4O3RleHQtYWxpZ246cmlnaHQ7Zm9udC1zaXplOjExcHg7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO2xldHRlci1zcGFjaW5nOi40cHhcIiB0aXRsZT1cIlZlbnRhcyBZVEQgLyBtZXNlcyB0cmFuc2N1cnJpZG9zIGRlbCBhXHUwMEYxb1wiPlByb20gLyBNZXM8L3RoPicgK1xuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjhweCAxMHB4O3RleHQtYWxpZ246cmlnaHQ7Zm9udC1zaXplOjExcHg7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO2xldHRlci1zcGFjaW5nOi40cHhcIiB0aXRsZT1cIlByb21lZGlvIHggMyBtZXNlcyAocG9saXRpY2EgZGUgaW52ZW50YXJpbylcIj5Qb2xpdGljYTwvdGg+JyArXG4gICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6OHB4IDEwcHg7dGV4dC1hbGlnbjpyaWdodDtmb250LXNpemU6MTFweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7bGV0dGVyLXNwYWNpbmc6LjRweFwiIHRpdGxlPVwiUGVkaWRvIDZtIC0gUG9saXRpY2EuIE5lZ2F0aXZvID0gdGUgZmFsdGEgcGVkaXI7IFBvc2l0aXZvID0gc29icmVwZWRpZG9cIj5Ub3RhbDwvdGg+JyArXG4gICAgJzwvdHI+JyArXG4gICAgJzwvdGhlYWQ+JztcbiAgYm9keS5pbm5lckhUTUwgPVxuICAgICc8dGFibGUgc3R5bGU9XCJ3aWR0aDoxMDAlO2JvcmRlci1jb2xsYXBzZTpjb2xsYXBzZTtmb250LXNpemU6MTJweFwiPicgK1xuICAgIGhlYWRlciArXG4gICAgJzx0Ym9keT4nICtcbiAgICByb3dzSHRtbCArXG4gICAgJzwvdGJvZHk+PC90YWJsZT4nO1xufVxuXG5mdW5jdGlvbiBlc2NhcGVIdG1sU2FmZShzKSB7XG4gIGlmICh0eXBlb2Ygd2luZG93LmVzY2FwZUh0bWwgPT09ICdmdW5jdGlvbicpIHJldHVybiB3aW5kb3cuZXNjYXBlSHRtbChzKTtcbiAgcmV0dXJuIFN0cmluZyhzID09IG51bGwgPyAnJyA6IHMpLnJlcGxhY2UoXG4gICAgL1smPD5cIiddL2csXG4gICAgKGNoKSA9PiAoeyAnJic6ICcmYW1wOycsICc8JzogJyZsdDsnLCAnPic6ICcmZ3Q7JywgJ1wiJzogJyZxdW90OycsIFwiJ1wiOiAnJiMzOTsnIH0pW2NoXVxuICApO1xufVxuXG53aW5kb3cub3BlbkZvcmVjYXN0TW9kYWwgPSBhc3luYyBmdW5jdGlvbiAoKSB7XG4gIGlmICghX2NhbkZvcmVjYXN0KCkpIHtcbiAgICBhbGVydCgnRk9SRUNBU1QgZXMgc29sbyBwYXJhIE1hcmlhbm8gKGFkbWluKS4nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgY29uc3QgZWwgPSBfcmVuZGVyTW9kYWxTaGVsbCgpO1xuICBlbC5zdHlsZS5kaXNwbGF5ID0gJ2Jsb2NrJztcbiAgaWYgKF9mb3JlY2FzdExvYWRpbmcpIHJldHVybjtcbiAgaWYgKCFfZm9yZWNhc3RTbmFwc2hvdCkge1xuICAgIF9mb3JlY2FzdExvYWRpbmcgPSB0cnVlO1xuICAgIGNvbnN0IHN0YXRzID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2ZvcmVjYXN0LXN0YXRzJyk7XG4gICAgaWYgKHN0YXRzKSBzdGF0cy50ZXh0Q29udGVudCA9ICdDYXJnYW5kbyBzbmFwc2hvdCBkZSB2ZW50YXMuLi4nO1xuICAgIHRyeSB7XG4gICAgICBhd2FpdCBfbG9hZFNuYXBzaG90KCk7XG4gICAgICBpZiAoc3RhdHMpIHN0YXRzLnRleHRDb250ZW50ID0gX2ZvcmVjYXN0U25hcHNob3QuY291bnQgKyAnIFNLVXMgZW4gc25hcHNob3QgaGlzdG9yaWNvJztcbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICBpZiAoc3RhdHMpIHN0YXRzLnRleHRDb250ZW50ID0gJ0Vycm9yIGNhcmdhbmRvIHNuYXBzaG90OiAnICsgKChlICYmIGUubWVzc2FnZSkgfHwgZSk7XG4gICAgICBhbGVydChcbiAgICAgICAgJ05vIHNlIHB1ZG8gY2FyZ2FyIHNrdV92ZW50YXNfc25hcHNob3QuIENoZXF1ZWEgcXVlIGVsIGJvb3RzdHJhcCBQeXRob24geWEgaGF5YSBjb3JyaWRvIChzY3JpcHRzL2FwcGx5X3NrdV92ZW50YXNfc25hcHNob3QucHkpIHkgcXVlIHRlbmdhcyByb2wgYWRtaW4uJ1xuICAgICAgKTtcbiAgICB9IGZpbmFsbHkge1xuICAgICAgX2ZvcmVjYXN0TG9hZGluZyA9IGZhbHNlO1xuICAgIH1cbiAgfSBlbHNlIHtcbiAgICBjb25zdCBzdGF0cyA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdmb3JlY2FzdC1zdGF0cycpO1xuICAgIGlmIChzdGF0cykgc3RhdHMudGV4dENvbnRlbnQgPSBfZm9yZWNhc3RTbmFwc2hvdC5jb3VudCArICcgU0tVcyBlbiBzbmFwc2hvdCBoaXN0b3JpY28nO1xuICB9XG59O1xuXG53aW5kb3cuY2xvc2VGb3JlY2FzdE1vZGFsID0gZnVuY3Rpb24gKCkge1xuICBjb25zdCBlbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdmb3JlY2FzdC1tb2RhbCcpO1xuICBpZiAoZWwpIGVsLnN0eWxlLmRpc3BsYXkgPSAnbm9uZSc7XG59O1xuXG53aW5kb3cub25Gb3JlY2FzdFNhbGVzUGxhbkZpbGUgPSBhc3luYyBmdW5jdGlvbiAoZXZlbnQpIHtcbiAgY29uc3QgZmlsZSA9IGV2ZW50ICYmIGV2ZW50LnRhcmdldCAmJiBldmVudC50YXJnZXQuZmlsZXMgJiYgZXZlbnQudGFyZ2V0LmZpbGVzWzBdO1xuICBpZiAoIWZpbGUpIHJldHVybjtcbiAgdHJ5IHtcbiAgICBpZiAoIV9mb3JlY2FzdFNuYXBzaG90KSBhd2FpdCBfbG9hZFNuYXBzaG90KCk7XG4gICAgY29uc3QgYnVmID0gYXdhaXQgZmlsZS5hcnJheUJ1ZmZlcigpO1xuICAgIGlmICh0eXBlb2YgWExTWCA9PT0gJ3VuZGVmaW5lZCcpIHtcbiAgICAgIGFsZXJ0KCdYTFNYIG5vIGNhcmdhZG8nKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgY29uc3Qgd2IgPSBYTFNYLnJlYWQoYnVmLCB7IHR5cGU6ICdhcnJheScgfSk7XG4gICAgY29uc3Qgc2hlZXQgPSB3Yi5TaGVldHNbd2IuU2hlZXROYW1lc1swXV07XG4gICAgY29uc3Qgcm93cyA9IFhMU1gudXRpbHMuc2hlZXRfdG9fanNvbihzaGVldCwgeyBoZWFkZXI6IDEsIGRlZnZhbDogbnVsbCwgcmF3OiB0cnVlIH0pO1xuICAgIGNvbnN0IHBhcnNlZCA9IF9wYXJzZVNhbGVzUGxhblJvd3Mocm93cyk7XG4gICAgaWYgKCFwYXJzZWQubGVuZ3RoKSB7XG4gICAgICBhbGVydCgnRWwgRXhjZWwgZXN0YSB2YWNpbyBvIG5vIHRpZW5lIGZpbGFzIHZhbGlkYXMuJyk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIF9mb3JlY2FzdFNhbGVzUGxhbiA9IHBhcnNlZDtcbiAgICBjb25zdCBob3kgPSBuZXcgRGF0ZSgpO1xuICAgIF9mb3JlY2FzdFJvd3MgPSBfY29tcHV0ZUZvcmVjYXN0Um93cyhfZm9yZWNhc3RTbmFwc2hvdCwgcGFyc2VkLCBob3kpO1xuICAgIF9yZW5kZXJUYWJsZShfZm9yZWNhc3RSb3dzKTtcbiAgICBjb25zdCBzaW5NYXRjaCA9IF9mb3JlY2FzdFJvd3MuZmlsdGVyKChyKSA9PiAhci5oYXNIaXN0b3JpYSkubGVuZ3RoO1xuICAgIGNvbnN0IHN0YXRzID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2ZvcmVjYXN0LXN0YXRzJyk7XG4gICAgaWYgKHN0YXRzKSB7XG4gICAgICBzdGF0cy50ZXh0Q29udGVudCA9XG4gICAgICAgIHBhcnNlZC5sZW5ndGggK1xuICAgICAgICAnIFNLVXMgZW4gU2FsZXMgUGxhbiBcdTAwQjcgJyArXG4gICAgICAgIChwYXJzZWQubGVuZ3RoIC0gc2luTWF0Y2gpICtcbiAgICAgICAgJyBjb24gaGlzdG9yaWEgXHUwMEI3ICcgK1xuICAgICAgICBzaW5NYXRjaCArXG4gICAgICAgICcgc2luIG1hdGNoIChmb25kbyBhbWFyaWxsbyknO1xuICAgIH1cbiAgICBjb25zdCBidG4gPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZm9yZWNhc3QtZXhwb3J0LWJ0bicpO1xuICAgIGlmIChidG4pIHtcbiAgICAgIGJ0bi5kaXNhYmxlZCA9IGZhbHNlO1xuICAgICAgYnRuLnN0eWxlLm9wYWNpdHkgPSAnMSc7XG4gICAgfVxuICB9IGNhdGNoIChlKSB7XG4gICAgY29uc29sZS5lcnJvcignW0ZPUkVDQVNUXSBwYXJzZSBlcnJvcjonLCBlKTtcbiAgICBhbGVydCgnRXJyb3IgcHJvY2VzYW5kbyBlbCBFeGNlbDpcXG4nICsgKChlICYmIGUubWVzc2FnZSkgfHwgZSkpO1xuICB9IGZpbmFsbHkge1xuICAgIC8vIFJlc2V0IGlucHV0IHBhcmEgcXVlIGVsIG1pc21vIGFyY2hpdm8gc2UgcHVlZGEgcmUtc3ViaXJcbiAgICBpZiAoZXZlbnQgJiYgZXZlbnQudGFyZ2V0KSBldmVudC50YXJnZXQudmFsdWUgPSAnJztcbiAgfVxufTtcblxud2luZG93LmV4cG9ydEZvcmVjYXN0RXhjZWwgPSBmdW5jdGlvbiAoKSB7XG4gIGlmICghX2ZvcmVjYXN0Um93cyB8fCAhX2ZvcmVjYXN0Um93cy5sZW5ndGgpIHtcbiAgICBhbGVydCgnTm8gaGF5IGRhdG9zIHBhcmEgZXhwb3J0YXIuIENhcmdhIHByaW1lcm8gZWwgU2FsZXMgUGxhbi4nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgaWYgKHR5cGVvZiBYTFNYID09PSAndW5kZWZpbmVkJykge1xuICAgIGFsZXJ0KCdYTFNYIG5vIGNhcmdhZG8nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgY29uc3Qgcm91bmQxID0gKG4pID0+IE1hdGgucm91bmQoTnVtYmVyKG4gfHwgMCkgKiAxMCkgLyAxMDtcbiAgY29uc3QgYW9hID0gW1xuICAgIFtcbiAgICAgICdTS1UnLFxuICAgICAgJ0ZBTUlMSUEnLFxuICAgICAgJ1NVQkZBTUlMSUEnLFxuICAgICAgJ1ZFTlRBUyAoMTJtKScsXG4gICAgICAnUEVESURPLVNBTEVTIFBMQU5TICg2bSknLFxuICAgICAgJ1BST01FRElPIERFIElOVkVOVEFSSU8nLFxuICAgICAgJ1BPTElUSUNBIERFIElOVkVOVEFSSU8gKDNtKScsXG4gICAgICAnVE9UQUwnLFxuICAgIF0sXG4gIF07XG4gIGZvciAoY29uc3QgciBvZiBfZm9yZWNhc3RSb3dzKSB7XG4gICAgYW9hLnB1c2goW1xuICAgICAgci5za3UsXG4gICAgICByLmZhbWlsaWEsXG4gICAgICByLnN1YmZhbWlsaWEsXG4gICAgICByb3VuZDEoci52ZW50YXMxMm0pLFxuICAgICAgcm91bmQxKHIucGVkaWRvNm0pLFxuICAgICAgcm91bmQxKHIucHJvbWVkaW8pLFxuICAgICAgcm91bmQxKHIucG9saXRpY2EpLFxuICAgICAgcm91bmQxKHIudG90YWwpLFxuICAgIF0pO1xuICB9XG4gIGNvbnN0IHdzID0gWExTWC51dGlscy5hb2FfdG9fc2hlZXQoYW9hKTtcbiAgLy8gQW5jaG9zIGRlIGNvbHVtbmFcbiAgd3NbJyFjb2xzJ10gPSBbXG4gICAgeyB3Y2g6IDE4IH0sXG4gICAgeyB3Y2g6IDI0IH0sXG4gICAgeyB3Y2g6IDI0IH0sXG4gICAgeyB3Y2g6IDE0IH0sXG4gICAgeyB3Y2g6IDIwIH0sXG4gICAgeyB3Y2g6IDIwIH0sXG4gICAgeyB3Y2g6IDIyIH0sXG4gICAgeyB3Y2g6IDEyIH0sXG4gIF07XG4gIGNvbnN0IHdiID0gWExTWC51dGlscy5ib29rX25ldygpO1xuICBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KHdiLCB3cywgJ0ZPUkVDQVNUJyk7XG4gIGNvbnN0IGhveSA9IG5ldyBEYXRlKCk7XG4gIGNvbnN0IHN0YW1wID1cbiAgICBob3kuZ2V0RnVsbFllYXIoKSArXG4gICAgJy0nICtcbiAgICBTdHJpbmcoaG95LmdldE1vbnRoKCkgKyAxKS5wYWRTdGFydCgyLCAnMCcpICtcbiAgICAnLScgK1xuICAgIFN0cmluZyhob3kuZ2V0RGF0ZSgpKS5wYWRTdGFydCgyLCAnMCcpO1xuICBYTFNYLndyaXRlRmlsZSh3YiwgJ0ZvcmVjYXN0X1NoaW1hbm9fJyArIHN0YW1wICsgJy54bHN4Jyk7XG59O1xuXG4vLyBSZWZyZXNoIHB1YmxpY28gKHBvciBzaSBlbCB1c2VyIG5lY2VzaXRhIHJlLWZldGNoZWFyIGVsIHNuYXBzaG90IHNpbiBjZXJyYXJcbi8vIGVsIG1vZGFsLCBlajogcGFzYXJvbiAzMCBtaW4geSBlbCBjcm9uIEJRIGFjdHVhbGl6byBsYSBjb2xlY2Npb24pLlxud2luZG93LnJlbG9hZEZvcmVjYXN0U25hcHNob3QgPSBhc3luYyBmdW5jdGlvbiAoKSB7XG4gIF9mb3JlY2FzdFNuYXBzaG90ID0gbnVsbDtcbiAgYXdhaXQgX2xvYWRTbmFwc2hvdCgpO1xuICBpZiAoX2ZvcmVjYXN0U2FsZXNQbGFuKSB7XG4gICAgY29uc3QgaG95ID0gbmV3IERhdGUoKTtcbiAgICBfZm9yZWNhc3RSb3dzID0gX2NvbXB1dGVGb3JlY2FzdFJvd3MoX2ZvcmVjYXN0U25hcHNob3QsIF9mb3JlY2FzdFNhbGVzUGxhbiwgaG95KTtc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
