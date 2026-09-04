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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL2RvbWFpbnMvZm9yZWNhc3QuanMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbIi8vIEB0cy1ub2NoZWNrXHJcbi8vIEdsb2JhbHMgbGVpZG9zIGRlbCBlbnRvcm5vIChkZWNsYXJhZG9zIGVuIGluZGV4Lmh0bWwgaW5saW5lIG8gYnVuZGxlIHByZXZpbyk6XHJcbi8vIGZiRGIsIGN1cnJlbnRVc2VyLCBYTFNYIChjZG4pLCBlc2NhcGVIdG1sLiBNaXNtbyBwYXRyb24gcXVlIG90cm9zIGRvbWluaW9zLlxyXG4vL1xyXG4vLyBGT1JFQ0FTVCAtIG1vZGFsIGFkbWluLW9ubHkgKE1hcmlhbm8pIHF1ZSBjb21wYXJhIHZlbnRhcyBoaXN0b3JpY2FzXHJcbi8vIChGaXJlc3RvcmUgc2t1X3ZlbnRhc19zbmFwc2hvdCwgYWxpbWVudGFkbyBwb3Igc3luYyBCUSB2X3ZlbnRhc19saW5lYXNcclxuLy8gdmVudGFuYSAxM20pIHZzIFNhbGVzIFBsYW4gY2FyZ2FkbyBwb3IgZWwgdXNlciB2aWEgRXhjZWwgKyBwb2xpdGljYSBkZVxyXG4vLyBpbnZlbnRhcmlvIChwcm9tZWRpbyBZVEQgeCAzIG1lc2VzKS5cclxuLy9cclxuLy8gQ2h1bmsgbGF6eTogc2UgY2FyZ2Egc29sbyBhbCBwcmltZXIgY2xpY2sgZGVsIGJvdG9uIEZPUkVDQVNUIGRlbCBoZWFkZXIuXHJcbi8vIFJlZ2lzdHJhZG8gZW4gYnVpbGQuanMgTEFaWV9DSFVOS1MgKyBzcmMvbWFpbi5qcyBpbnN0YWxsQ2h1bmtTdHVicyArIHN3LmpzXHJcbi8vIFNUQVRJQ19BU1NFVFMuIFZlciBDTEFVREUubWQgIzE4ICgzIGx1Z2FyZXMgc2luY3Jvbml6YWRvcykuXHJcbi8vXHJcbi8vIENvbnRyYXRvIGRlbCBFeGNlbCBTYWxlcyBQbGFuIHF1ZSBzdWJlIGVsIHVzZXI6XHJcbi8vICAgQ29sdW1uYXM6IFNLVSB8IE1lczEgfCBNZXMyIHwgTWVzMyB8IE1lczQgfCBNZXM1IHwgTWVzNlxyXG4vLyAgIChub21icmVzIGV4YWN0b3MgZGUgaGVhZGVycyBjYXNlLWluc2Vuc2l0aXZlOyBNZXMxLi42IHNvbiBsb3MgcHJveGltb3NcclxuLy8gICA2IG1lc2VzIGRlc2RlIGVsIG1lcyBhY3R1YWwpLiBVbmEgZmlsYSBwb3IgU0tVLlxyXG4vL1xyXG4vLyBGdWVudGUgZGUgZGF0b3MgaGlzdG9yaWNhczpcclxuLy8gICBGaXJlc3RvcmUgL3NrdV92ZW50YXNfc25hcHNob3Qve1NLVV88c2t1X3NhbmVhZG8+fVxyXG4vLyAgIHtcclxuLy8gICAgIHNrdSwgaXRlbU5hbWUsIGZhbWlsaWEsIHN1YmZhbWlsaWEsXHJcbi8vICAgICBtZXNlczogeyAnMjAyNS0wOCc6IHtxdHksIGFyc30sIC4uLiwgJzIwMjYtMDgnOiB7cXR5LCBhcnN9IH1cclxuLy8gICB9XHJcbi8vICAgUnVsZXM6IHJlYWQgYWRtaW4tb25seSAoY29tcGV0aXRpdmVseSBzZW5zaXRpdmUpLiBFc2NyaXRvIHBvciBjcm9uXHJcbi8vICAgc3luY19zYXBfdG9fYmlncXVlcnkucHkgY2FkYSAzMCBtaW4uXHJcblxyXG4vLyBFc3RhZG8gZGVsIG1vZGFsIChpbnRyYS1jaHVuaywgbm8gY3Jvc3Mtc2NvcGUpLlxyXG5sZXQgX2ZvcmVjYXN0U25hcHNob3QgPSBudWxsOyAvLyB7IFNLVToge2ZhbWlsaWEsIHN1YmZhbWlsaWEsIGl0ZW1OYW1lLCBtZXNlc30gfVxyXG5sZXQgX2ZvcmVjYXN0U2FsZXNQbGFuID0gbnVsbDsgLy8gW3sgc2t1LCBwZWRpZG9Ub3RhbCwgbWVzZXNBcnI6IFtuMS4ubjZdIH1dXHJcbmxldCBfZm9yZWNhc3RSb3dzID0gbnVsbDsgLy8gZmlsYXMgZmluYWxlcyBjYWxjdWxhZGFzIHBhcmEgcHJldmlldyArIGV4cG9ydFxyXG5sZXQgX2ZvcmVjYXN0TG9hZGluZyA9IGZhbHNlO1xyXG5cclxuLy8gV2hpdGVsaXN0IGRlIGVtYWlscyBjb24gYWNjZXNvIGFsIG1vZGFsIEZPUkVDQVNULiBSZXBsaWNhIGVsIHBhdHJvbiBkZVxyXG4vLyBcIkFuYWxpc2lzXCIgKGluZGV4Lmh0bWw6MTI2MjUpLiBTb2xvIE1hcmlhbm87IHNpIG90cm8gYWRtaW4gbG8gbmVjZXNpdGFcclxuLy8gc2UgYWdyZWdhIGFjYSBleHBsaWNpdG8uXHJcbmNvbnN0IEZPUkVDQVNUX0FMTE9XRURfRU1BSUxTID0gWydtYXJpYW5vLmVyYmlub0BzaGltYW5vLmNvbS5hcicsICdlcmJpbm9tYXJpYW5vQGdtYWlsLmNvbSddO1xyXG5cclxuZnVuY3Rpb24gX2NhbkZvcmVjYXN0KCkge1xyXG4gIHRyeSB7XHJcbiAgICBjb25zdCBlbWFpbCA9ICgod2luZG93LmN1cnJlbnRVc2VyICYmIHdpbmRvdy5jdXJyZW50VXNlci5lbWFpbCkgfHwgJycpLnRvTG93ZXJDYXNlKCk7XHJcbiAgICBpZiAoIWVtYWlsKSByZXR1cm4gZmFsc2U7XHJcbiAgICByZXR1cm4gRk9SRUNBU1RfQUxMT1dFRF9FTUFJTFMuaW5kZXhPZihlbWFpbCkgPj0gMDtcclxuICB9IGNhdGNoIHtcclxuICAgIHJldHVybiBmYWxzZTtcclxuICB9XHJcbn1cclxuXHJcbi8vIEhlbHBlcnMgZGUgbWVzIGNhbGVuZGFyLlxyXG5mdW5jdGlvbiBfbW9udGhLZXkoeWVhciwgbW9udGhPbmVCYXNlZCkge1xyXG4gIHJldHVybiBTdHJpbmcoeWVhcikucGFkU3RhcnQoNCwgJzAnKSArICctJyArIFN0cmluZyhtb250aE9uZUJhc2VkKS5wYWRTdGFydCgyLCAnMCcpO1xyXG59XHJcbmZ1bmN0aW9uIF9tb250aExhYmVsKGtleSkge1xyXG4gIC8vICcyMDI2LTA4JyAtPiAnYWdvLTI2J1xyXG4gIGNvbnN0IFt5LCBtXSA9IGtleS5zcGxpdCgnLScpLm1hcChOdW1iZXIpO1xyXG4gIGNvbnN0IG5hbWVzID0gW1xyXG4gICAgJ2VuZScsXHJcbiAgICAnZmViJyxcclxuICAgICdtYXInLFxyXG4gICAgJ2FicicsXHJcbiAgICAnbWF5JyxcclxuICAgICdqdW4nLFxyXG4gICAgJ2p1bCcsXHJcbiAgICAnYWdvJyxcclxuICAgICdzZXAnLFxyXG4gICAgJ29jdCcsXHJcbiAgICAnbm92JyxcclxuICAgICdkaWMnLFxyXG4gIF07XHJcbiAgcmV0dXJuIG5hbWVzW20gLSAxXSArICctJyArIFN0cmluZyh5KS5zbGljZSgtMik7XHJcbn1cclxuZnVuY3Rpb24gX2FkZE1vbnRocyh5ZWFyLCBtb250aE9uZUJhc2VkLCBkZWx0YSkge1xyXG4gIGNvbnN0IHRvdGFsTW9udGhzID0geWVhciAqIDEyICsgKG1vbnRoT25lQmFzZWQgLSAxKSArIGRlbHRhO1xyXG4gIGNvbnN0IHkgPSBNYXRoLmZsb29yKHRvdGFsTW9udGhzIC8gMTIpO1xyXG4gIGNvbnN0IG0gPSAodG90YWxNb250aHMgJSAxMikgKyAxO1xyXG4gIHJldHVybiB7IHksIG0gfTtcclxufVxyXG5cclxuLy8gU3VtYSBxdHkgZGVsIFNLVSBlbiBsb3MgdWx0aW1vcyAxMiBNRVNFUyBDT01QTEVUT1MgKGV4Y2x1eWUgZWwgbWVzIGFjdHVhbFxyXG4vLyBwYXJjaWFsIC0gbGEgdmVudGFuYSBtb3ZpbCBcIjEyIG1lc2VzIGNlcnJhZG9zXCIgcXVlIGVsIHVzZXIgcGllbnNhIGNvbW9cclxuLy8gXCJlbCBhXHUwMEYxbyBxdWUgeWEgcGFzb1wiKS4gRWplbXBsbyBlbiBhZ29zdG8gMjAyNjogc3VtYXIgYWdvLTI1IGEganVsLTI2LlxyXG5mdW5jdGlvbiBfc3VtVmVudGFzMTJtQ29tcGxldG9zKG1lc2VzTWFwLCBob3kpIHtcclxuICBpZiAoIW1lc2VzTWFwKSByZXR1cm4gMDtcclxuICBsZXQgc3VtID0gMDtcclxuICBjb25zdCBzdGFydE1vbnRoID0gX2FkZE1vbnRocyhob3kuZ2V0RnVsbFllYXIoKSwgaG95LmdldE1vbnRoKCkgKyAxLCAtMTIpO1xyXG4gIGNvbnN0IGVuZE1vbnRoID0gX2FkZE1vbnRocyhob3kuZ2V0RnVsbFllYXIoKSwgaG95LmdldE1vbnRoKCkgKyAxLCAtMSk7XHJcbiAgY29uc3Qgc3RhcnRLZXkgPSBfbW9udGhLZXkoc3RhcnRNb250aC55LCBzdGFydE1vbnRoLm0pO1xyXG4gIGNvbnN0IGVuZEtleSA9IF9tb250aEtleShlbmRNb250aC55LCBlbmRNb250aC5tKTtcclxuICBmb3IgKGNvbnN0IGsgb2YgT2JqZWN0LmtleXMobWVzZXNNYXApKSB7XHJcbiAgICBpZiAoayA+PSBzdGFydEtleSAmJiBrIDw9IGVuZEtleSkge1xyXG4gICAgICBzdW0gKz0gTnVtYmVyKChtZXNlc01hcFtrXSAmJiBtZXNlc01hcFtrXS5xdHkpIHx8IDApO1xyXG4gICAgfVxyXG4gIH1cclxuICByZXR1cm4gc3VtO1xyXG59XHJcblxyXG4vLyBTdW1hIHF0eSBkZWwgU0tVIFlURCAoZW5lcm8gZGVsIGFcdTAwRjFvIGFjdHVhbCBoYXN0YSBtZXMgYWN0dWFsIElOQ0xVU0lWTyxcclxuLy8gYXVucXVlIGVsIG1lcyBhY3R1YWwgc2VhIHBhcmNpYWwpLiBSZXRvcm5hIHsgdG90YWxZdGQsIG1lc2VzVHJhbnNjdXJyaWRvcyB9LlxyXG4vLyBFamVtcGxvIGFnb3N0byAyMDI2IGNvbiB2ZW50YXMganVsPTEwICsgYWdvPTIwIC0+IHszMCwgOH0sIHByb21lZGlvPTMwLzg9My43NS5cclxuLy8gKFNpIGVsIHVzdWFyaW8gZXNwZXJhYmEgZGl2aWRpciBwb3IgMiBlbiB2ZXogZGUgOCwgcmV2aXNhciBzcGVjLiBFbCBwZWRpZG9cclxuLy8gZGljZSBcImNhbnRpZGFkIGRlIG1lc2VzIHF1ZSB0cmFuc2N1cnJpbW9zXCIgPSBtZXNlcyBkZWwgYVx1MDBGMW8gcGFzYWRvcyBoYXN0YSBob3kuKVxyXG5mdW5jdGlvbiBfc3VtVmVudGFzWVREKG1lc2VzTWFwLCBob3kpIHtcclxuICBjb25zdCB5ZWFyID0gaG95LmdldEZ1bGxZZWFyKCk7XHJcbiAgY29uc3QgbWVzQWN0dWFsID0gaG95LmdldE1vbnRoKCkgKyAxO1xyXG4gIGxldCB0b3RhbCA9IDA7XHJcbiAgaWYgKG1lc2VzTWFwKSB7XHJcbiAgICBmb3IgKGxldCBtID0gMTsgbSA8PSBtZXNBY3R1YWw7IG0rKykge1xyXG4gICAgICBjb25zdCBrID0gX21vbnRoS2V5KHllYXIsIG0pO1xyXG4gICAgICB0b3RhbCArPSBOdW1iZXIoKG1lc2VzTWFwW2tdICYmIG1lc2VzTWFwW2tdLnF0eSkgfHwgMCk7XHJcbiAgICB9XHJcbiAgfVxyXG4gIHJldHVybiB7IHRvdGFsWXRkOiB0b3RhbCwgbWVzZXNUcmFuc2N1cnJpZG9zOiBtZXNBY3R1YWwgfTtcclxufVxyXG5cclxuLy8gQ2FyZ2Egc2t1X3ZlbnRhc19zbmFwc2hvdCBjb21wbGV0byAodW5hIHZleiBwb3Igc2VzaW9uIGRlbCBtb2RhbCkuXHJcbmFzeW5jIGZ1bmN0aW9uIF9sb2FkU25hcHNob3QoKSB7XHJcbiAgaWYgKF9mb3JlY2FzdFNuYXBzaG90KSByZXR1cm4gX2ZvcmVjYXN0U25hcHNob3Q7XHJcbiAgaWYgKCF3aW5kb3cuZmJEYikgdGhyb3cgbmV3IEVycm9yKCdGaXJlc3RvcmUgbm8gaW5pY2lhbGl6YWRvJyk7XHJcbiAgY29uc3Qgc25hcCA9IGF3YWl0IHdpbmRvdy5mYkRiLmNvbGxlY3Rpb24oJ3NrdV92ZW50YXNfc25hcHNob3QnKS5nZXQoKTtcclxuICBjb25zdCBieU9yaWdpbmFsU2t1ID0ge307XHJcbiAgY29uc3QgYnlVcHBlclNrdSA9IHt9O1xyXG4gIHNuYXAuZm9yRWFjaCgoZG9jKSA9PiB7XHJcbiAgICBjb25zdCBkID0gZG9jLmRhdGEoKTtcclxuICAgIGlmICghZCB8fCAhZC5za3UpIHJldHVybjtcclxuICAgIGNvbnN0IHNrdVVwcGVyID0gU3RyaW5nKGQuc2t1KS50cmltKCkudG9VcHBlckNhc2UoKTtcclxuICAgIGNvbnN0IHJlY29yZCA9IHtcclxuICAgICAgc2t1OiBkLnNrdSxcclxuICAgICAgaXRlbU5hbWU6IGQuaXRlbU5hbWUgfHwgJycsXHJcbiAgICAgIGZhbWlsaWE6IGQuZmFtaWxpYSB8fCAnJyxcclxuICAgICAgc3ViZmFtaWxpYTogZC5zdWJmYW1pbGlhIHx8ICcnLFxyXG4gICAgICBtZXNlczogZC5tZXNlcyB8fCB7fSxcclxuICAgIH07XHJcbiAgICBieU9yaWdpbmFsU2t1W2Quc2t1XSA9IHJlY29yZDtcclxuICAgIGJ5VXBwZXJTa3Vbc2t1VXBwZXJdID0gcmVjb3JkO1xyXG4gIH0pO1xyXG4gIF9mb3JlY2FzdFNuYXBzaG90ID0geyBieU9yaWdpbmFsU2t1LCBieVVwcGVyU2t1LCBjb3VudDogc25hcC5zaXplIH07XHJcbiAgcmV0dXJuIF9mb3JlY2FzdFNuYXBzaG90O1xyXG59XHJcblxyXG4vLyBQYXJzZWEgZWwgRXhjZWwgU2FsZXMgUGxhbi4gRXNwZXJhIGNvbHVtbmFzIFNLVSArIDYgY29sdW1uYXMgbnVtZXJpY2FzXHJcbi8vIChub21icmVzIGZsZXhpYmxlczogTWVzMS4uTWVzNiwgbWVzXzEuLm1lc182LCBvIGN1YWxxdWllciBoZWFkZXIgY3VzdG9tXHJcbi8vIG1pZW50cmFzIGxhIHByaW1lcmEgc2VhIFNLVSB5IGhheWEgYWwgbWVub3MgNiBjb2x1bW5hcyBudW1lcmljYXMgbWFzKS5cclxuZnVuY3Rpb24gX3BhcnNlU2FsZXNQbGFuUm93cyhyb3dzUmF3KSB7XHJcbiAgaWYgKCFyb3dzUmF3IHx8ICFyb3dzUmF3Lmxlbmd0aCkgcmV0dXJuIFtdO1xyXG4gIGNvbnN0IGhlYWRlclJvdyA9IHJvd3NSYXdbMF07XHJcbiAgLy8gRGV0ZWN0YXIgaW5kaWNlIGRlIGNvbHVtbmEgU0tVXHJcbiAgbGV0IHNrdUNvbElkeCA9IC0xO1xyXG4gIGZvciAobGV0IGkgPSAwOyBpIDwgaGVhZGVyUm93Lmxlbmd0aDsgaSsrKSB7XHJcbiAgICBjb25zdCBoID0gU3RyaW5nKGhlYWRlclJvd1tpXSB8fCAnJylcclxuICAgICAgLnRyaW0oKVxyXG4gICAgICAudG9VcHBlckNhc2UoKTtcclxuICAgIGlmIChoID09PSAnU0tVJyB8fCBoID09PSAnSVRFTUNPREUnIHx8IGggPT09ICdJVEVNJyB8fCBoID09PSAnSVRFTSBDT0RFJyB8fCBoID09PSAnQ09ESUdPJykge1xyXG4gICAgICBza3VDb2xJZHggPSBpO1xyXG4gICAgICBicmVhaztcclxuICAgIH1cclxuICB9XHJcbiAgaWYgKHNrdUNvbElkeCA8IDApXHJcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ0VsIEV4Y2VsIGRlYmUgdGVuZXIgdW5hIGNvbHVtbmEgbGxhbWFkYSBcIlNLVVwiIChvIENvZGlnbyAvIEl0ZW1Db2RlIC8gSXRlbSknKTtcclxuICAvLyBMYXMgNiBjb2x1bW5hcyBkZSBtZXNlczogbGFzIHByaW1lcmFzIDYgY29sdW1uYXMgcXVlIHNlYW4gIT0gc2t1Q29sSWR4LlxyXG4gIGNvbnN0IG1vbnRoQ29scyA9IFtdO1xyXG4gIGZvciAobGV0IGkgPSAwOyBpIDwgaGVhZGVyUm93Lmxlbmd0aCAmJiBtb250aENvbHMubGVuZ3RoIDwgNjsgaSsrKSB7XHJcbiAgICBpZiAoaSAhPT0gc2t1Q29sSWR4KSBtb250aENvbHMucHVzaChpKTtcclxuICB9XHJcbiAgaWYgKG1vbnRoQ29scy5sZW5ndGggPCA2KVxyXG4gICAgdGhyb3cgbmV3IEVycm9yKFxyXG4gICAgICAnRWwgRXhjZWwgZGViZSB0ZW5lciBhbCBtZW5vcyA2IGNvbHVtbmFzIGRlIG1lc2VzIGFkZW1hcyBkZSBTS1UgKGVuY29udHJhZGFzOiAnICtcclxuICAgICAgICBtb250aENvbHMubGVuZ3RoICtcclxuICAgICAgICAnKSdcclxuICAgICk7XHJcbiAgY29uc3Qgb3V0ID0gW107XHJcbiAgZm9yIChsZXQgciA9IDE7IHIgPCByb3dzUmF3Lmxlbmd0aDsgcisrKSB7XHJcbiAgICBjb25zdCByb3cgPSByb3dzUmF3W3JdO1xyXG4gICAgaWYgKCFyb3cgfHwgIXJvdy5sZW5ndGgpIGNvbnRpbnVlO1xyXG4gICAgY29uc3Qgc2t1UmF3ID0gcm93W3NrdUNvbElkeF07XHJcbiAgICBpZiAoc2t1UmF3ID09PSB1bmRlZmluZWQgfHwgc2t1UmF3ID09PSBudWxsIHx8IFN0cmluZyhza3VSYXcpLnRyaW0oKSA9PT0gJycpIGNvbnRpbnVlO1xyXG4gICAgY29uc3Qgc2t1ID0gU3RyaW5nKHNrdVJhdykudHJpbSgpO1xyXG4gICAgY29uc3QgbWVzZXNBcnIgPSBtb250aENvbHMubWFwKChpKSA9PiB7XHJcbiAgICAgIGNvbnN0IHYgPSByb3dbaV07XHJcbiAgICAgIGNvbnN0IG4gPSBOdW1iZXIodik7XHJcbiAgICAgIHJldHVybiBOdW1iZXIuaXNGaW5pdGUobikgPyBuIDogMDtcclxuICAgIH0pO1xyXG4gICAgY29uc3QgcGVkaWRvVG90YWwgPSBtZXNlc0Fyci5yZWR1Y2UoKGEsIGIpID0+IGEgKyBiLCAwKTtcclxuICAgIG91dC5wdXNoKHsgc2t1LCBtZXNlc0FyciwgcGVkaWRvVG90YWwgfSk7XHJcbiAgfVxyXG4gIHJldHVybiBvdXQ7XHJcbn1cclxuXHJcbi8vIENhbGN1bGEgbGFzIGZpbGFzIGZpbmFsZXMgY3J1emFuZG8gc25hcHNob3QgKyBzYWxlcyBwbGFuLlxyXG5mdW5jdGlvbiBfY29tcHV0ZUZvcmVjYXN0Um93cyhzbmFwc2hvdCwgc2FsZXNQbGFuLCBob3kpIHtcclxuICBjb25zdCByb3dzID0gW107XHJcbiAgZm9yIChjb25zdCBzcCBvZiBzYWxlc1BsYW4pIHtcclxuICAgIGNvbnN0IHNrdVVwcGVyID0gc3Auc2t1LnRvVXBwZXJDYXNlKCk7XHJcbiAgICBjb25zdCBoaXN0ID0gc25hcHNob3QuYnlVcHBlclNrdVtza3VVcHBlcl0gfHwgbnVsbDtcclxuICAgIGNvbnN0IHZlbnRhczEybSA9IGhpc3QgPyBfc3VtVmVudGFzMTJtQ29tcGxldG9zKGhpc3QubWVzZXMsIGhveSkgOiAwO1xyXG4gICAgY29uc3QgeXRkID0gaGlzdFxyXG4gICAgICA/IF9zdW1WZW50YXNZVEQoaGlzdC5tZXNlcywgaG95KVxyXG4gICAgICA6IHsgdG90YWxZdGQ6IDAsIG1lc2VzVHJhbnNjdXJyaWRvczogaG95LmdldE1vbnRoKCkgKyAxIH07XHJcbiAgICBjb25zdCBwcm9tZWRpbyA9IHl0ZC5tZXNlc1RyYW5zY3Vycmlkb3MgPiAwID8geXRkLnRvdGFsWXRkIC8geXRkLm1lc2VzVHJhbnNjdXJyaWRvcyA6IDA7XHJcbiAgICBjb25zdCBwb2xpdGljYSA9IHByb21lZGlvICogMztcclxuICAgIGNvbnN0IHRvdGFsID0gc3AucGVkaWRvVG90YWwgLSBwb2xpdGljYTtcclxuICAgIHJvd3MucHVzaCh7XHJcbiAgICAgIHNrdTogc3Auc2t1LFxyXG4gICAgICBpdGVtTmFtZTogaGlzdCA/IGhpc3QuaXRlbU5hbWUgOiAnJyxcclxuICAgICAgZmFtaWxpYTogaGlzdCA/IGhpc3QuZmFtaWxpYSA6ICcoc2luIG1hdGNoKScsXHJcbiAgICAgIHN1YmZhbWlsaWE6IGhpc3QgPyBoaXN0LnN1YmZhbWlsaWEgOiAnKHNpbiBtYXRjaCknLFxyXG4gICAgICB2ZW50YXMxMm06IHZlbnRhczEybSxcclxuICAgICAgcGVkaWRvNm06IHNwLnBlZGlkb1RvdGFsLFxyXG4gICAgICBwcm9tZWRpbzogcHJvbWVkaW8sXHJcbiAgICAgIHBvbGl0aWNhOiBwb2xpdGljYSxcclxuICAgICAgdG90YWw6IHRvdGFsLFxyXG4gICAgICBoYXNIaXN0b3JpYTogISFoaXN0LFxyXG4gICAgfSk7XHJcbiAgfVxyXG4gIHJldHVybiByb3dzO1xyXG59XHJcblxyXG5mdW5jdGlvbiBfcmVuZGVyTW9kYWxTaGVsbCgpIHtcclxuICBjb25zdCBleGlzdGluZyA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdmb3JlY2FzdC1tb2RhbCcpO1xyXG4gIGlmIChleGlzdGluZykgcmV0dXJuIGV4aXN0aW5nO1xyXG4gIGNvbnN0IGVsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2Jyk7XHJcbiAgZWwuaWQgPSAnZm9yZWNhc3QtbW9kYWwnO1xyXG4gIGVsLmNsYXNzTmFtZSA9ICdtb2RhbC1vdmVybGF5JztcclxuICBlbC5zdHlsZS5jc3NUZXh0ID1cclxuICAgICdkaXNwbGF5Om5vbmU7cG9zaXRpb246Zml4ZWQ7aW5zZXQ6MDtiYWNrZ3JvdW5kOnJnYmEoMTUsMjMsNDIsLjYpO3otaW5kZXg6MjA1MDsnO1xyXG4gIGVsLm9uY2xpY2sgPSBmdW5jdGlvbiAoZXYpIHtcclxuICAgIGlmIChldi50YXJnZXQgPT09IGVsKSB3aW5kb3cuY2xvc2VGb3JlY2FzdE1vZGFsKCk7XHJcbiAgfTtcclxuICBlbC5pbm5lckhUTUwgPVxyXG4gICAgJycgK1xyXG4gICAgJzxkaXYgc3R5bGU9XCJwb3NpdGlvbjphYnNvbHV0ZTtpbnNldDoxdmggMXZ3O2JhY2tncm91bmQ6dmFyKC0tYmctZWxldmF0ZWQpO2JvcmRlci1yYWRpdXM6MTBweDtkaXNwbGF5OmZsZXg7ZmxleC1kaXJlY3Rpb246Y29sdW1uO292ZXJmbG93OmhpZGRlbjtib3gtc2hhZG93OjAgMjBweCA1MHB4IHJnYmEoMCwwLDAsLjM1KVwiPicgK1xyXG4gICAgJzxkaXYgc3R5bGU9XCJwYWRkaW5nOjEycHggMThweDtiYWNrZ3JvdW5kOiMwZjE3MmE7Y29sb3I6I2ZmZjtkaXNwbGF5OmZsZXg7YWxpZ24taXRlbXM6Y2VudGVyO2dhcDoxMnB4XCI+JyArXHJcbiAgICAnPGRpdiBzdHlsZT1cImZsZXg6MVwiPicgK1xyXG4gICAgJzxkaXYgc3R5bGU9XCJmb250LXNpemU6MTZweDtmb250LXdlaWdodDo4MDA7bGV0dGVyLXNwYWNpbmc6LjVweFwiPkZPUkVDQVNUPC9kaXY+JyArXHJcbiAgICAnPGRpdiBpZD1cImZvcmVjYXN0LXN1YnRpdGxlXCIgc3R5bGU9XCJmb250LXNpemU6MTFweDtvcGFjaXR5Oi44O21hcmdpbi10b3A6MnB4XCI+Q2FyZ2FyIFNhbGVzIFBsYW4gcGFyYSB2ZXIgbGEgcHJveWVjY2lvbiB2cyBwb2xpdGljYSBkZSBpbnZlbnRhcmlvICgzIG1lc2VzKTwvZGl2PicgK1xyXG4gICAgJzwvZGl2PicgK1xyXG4gICAgJzxidXR0b24gaWQ9XCJmb3JlY2FzdC1leHBvcnQtYnRuXCIgb25jbGljaz1cImV4cG9ydEZvcmVjYXN0RXhjZWwoKVwiIGRpc2FibGVkIHN0eWxlPVwicGFkZGluZzo4cHggMTRweDtiYWNrZ3JvdW5kOnZhcigtLWNvbG9yLXN1Y2Nlc3MpO2NvbG9yOiNmZmY7Ym9yZGVyOm5vbmU7Ym9yZGVyLXJhZGl1czo2cHg7Zm9udC13ZWlnaHQ6NzAwO2N1cnNvcjpwb2ludGVyO29wYWNpdHk6LjVcIj5FeHBvcnRhciBFeGNlbDwvYnV0dG9uPicgK1xyXG4gICAgJzxidXR0b24gb25jbGljaz1cImNsb3NlRm9yZWNhc3RNb2RhbCgpXCIgc3R5bGU9XCJiYWNrZ3JvdW5kOnRyYW5zcGFyZW50O2NvbG9yOiNmZmY7Ym9yZGVyOjFweCBzb2xpZCByZ2JhKDI1NSwyNTUsMjU1LC40KTtib3JkZXItcmFkaXVzOjZweDtwYWRkaW5nOjZweCAxMHB4O2N1cnNvcjpwb2ludGVyO2ZvbnQtd2VpZ2h0OjcwMFwiPkNlcnJhcjwvYnV0dG9uPicgK1xyXG4gICAgJzwvZGl2PicgK1xyXG4gICAgJzxkaXYgc3R5bGU9XCJwYWRkaW5nOjEycHggMThweDtiYWNrZ3JvdW5kOnZhcigtLWJnLXNlY29uZGFyeSk7Ym9yZGVyLWJvdHRvbToxcHggc29saWQgdmFyKC0tYm9yZGVyLXN1YnRsZSk7ZGlzcGxheTpmbGV4O2ZsZXgtd3JhcDp3cmFwO2dhcDoxNHB4O2FsaWduLWl0ZW1zOmNlbnRlclwiPicgK1xyXG4gICAgJzxsYWJlbCBzdHlsZT1cImRpc3BsYXk6aW5saW5lLWZsZXg7YWxpZ24taXRlbXM6Y2VudGVyO2dhcDo4cHg7cGFkZGluZzo4cHggMTJweDtiYWNrZ3JvdW5kOiMwZDk0ODg7Y29sb3I6I2ZmZjtib3JkZXItcmFkaXVzOjZweDtmb250LXdlaWdodDo3MDA7Zm9udC1zaXplOjEycHg7Y3Vyc29yOnBvaW50ZXJcIj4nICtcclxuICAgICc8c3Bhbj5DYXJnYXIgU2FsZXMgUGxhbiAoLnhsc3gpPC9zcGFuPicgK1xyXG4gICAgJzxpbnB1dCB0eXBlPVwiZmlsZVwiIGFjY2VwdD1cIi54bHN4LC54bHNcIiBzdHlsZT1cImRpc3BsYXk6bm9uZVwiIG9uY2hhbmdlPVwib25Gb3JlY2FzdFNhbGVzUGxhbkZpbGUoZXZlbnQpXCIvPicgK1xyXG4gICAgJzwvbGFiZWw+JyArXHJcbiAgICAnPGRpdiBpZD1cImZvcmVjYXN0LWhpbnRcIiBzdHlsZT1cImZvbnQtc2l6ZToxMXB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO21heC13aWR0aDo1MjBweFwiPkV4Y2VsIGVzcGVyYWRvOiBwcmltZXJhIGNvbHVtbmEgPGI+U0tVPC9iPiwgbHVlZ28gNiBjb2x1bW5hcyBjb24gbGFzIHVuaWRhZGVzIHBlZGlkYXMgbWVzIGEgbWVzIHBhcmEgbG9zIHByb3hpbW9zIDYgbWVzZXMuIExvcyBoZWFkZXJzIGRlIGxvcyBtZXNlcyBwdWVkZW4gc2VyIGN1YWxxdWllciBub21icmUgKE1lczEuLk1lczYsIGFnby0yNi4uZW5lLTI3LCBldGMpLjwvZGl2PicgK1xyXG4gICAgJzxkaXYgaWQ9XCJmb3JlY2FzdC1zdGF0c1wiIHN0eWxlPVwibWFyZ2luLWxlZnQ6YXV0bztmb250LXNpemU6MTFweDtjb2xvcjp2YXIoLS10ZXh0LXNlY29uZGFyeSk7Zm9udC13ZWlnaHQ6NjAwXCI+PC9kaXY+JyArXHJcbiAgICAnPC9kaXY+JyArXHJcbiAgICAnPGRpdiBpZD1cImZvcmVjYXN0LWJvZHlcIiBzdHlsZT1cImZsZXg6MTtvdmVyZmxvdzphdXRvO3BhZGRpbmc6MFwiPicgK1xyXG4gICAgJzxkaXYgc3R5bGU9XCJwYWRkaW5nOjYwcHggMjBweDt0ZXh0LWFsaWduOmNlbnRlcjtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTtmb250LXNpemU6MTRweFwiPkVzcGVyYW5kbyBhcmNoaXZvIFNhbGVzIFBsYW4uLi48L2Rpdj4nICtcclxuICAgICc8L2Rpdj4nICtcclxuICAgICc8L2Rpdj4nO1xyXG4gIGRvY3VtZW50LmJvZHkuYXBwZW5kQ2hpbGQoZWwpO1xyXG4gIHJldHVybiBlbDtcclxufVxyXG5cclxuZnVuY3Rpb24gX3JlbmRlclRhYmxlKHJvd3MpIHtcclxuICBjb25zdCBib2R5ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2ZvcmVjYXN0LWJvZHknKTtcclxuICBpZiAoIWJvZHkpIHJldHVybjtcclxuICBpZiAoIXJvd3MgfHwgIXJvd3MubGVuZ3RoKSB7XHJcbiAgICBib2R5LmlubmVySFRNTCA9XHJcbiAgICAgICc8ZGl2IHN0eWxlPVwicGFkZGluZzo2MHB4IDIwcHg7dGV4dC1hbGlnbjpjZW50ZXI7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZClcIj5TYWxlcyBQbGFuIHZhY2lvIG8gc2luIGZpbGFzIHZhbGlkYXMuPC9kaXY+JztcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgY29uc3QgZm10ID0gKG4pID0+XHJcbiAgICBuID09PSAwIHx8ICFOdW1iZXIuaXNGaW5pdGUobilcclxuICAgICAgPyAnMCdcclxuICAgICAgOiBOdW1iZXIobikudG9Mb2NhbGVTdHJpbmcoJ2VzLUFSJywgeyBtYXhpbXVtRnJhY3Rpb25EaWdpdHM6IDEgfSk7XHJcbiAgY29uc3QgY29sb3JGb3JUb3RhbCA9ICh0KSA9PiB7XHJcbiAgICBpZiAodCA+IDApIHJldHVybiAnIzE2NjUzNCc7IC8vIHNvYnJhIChwZWRpc3RlIG1hcyBxdWUgbGEgcG9saXRpY2EpIC0gdmVyZGVcclxuICAgIGlmICh0IDwgMCkgcmV0dXJuICcjYzI0MTBjJzsgLy8gZmFsdGEgKHBlZGlzdGUgbWVub3MgcXVlIGxhIHBvbGl0aWNhKSAtIG5hcmFuamEgdXJnZW50ZVxyXG4gICAgcmV0dXJuICcjNDc1NTY5JztcclxuICB9O1xyXG4gIGNvbnN0IHJvd3NIdG1sID0gcm93c1xyXG4gICAgLm1hcChcclxuICAgICAgKHIpID0+XHJcbiAgICAgICAgJycgK1xyXG4gICAgICAgICc8dHInICtcclxuICAgICAgICAoci5oYXNIaXN0b3JpYSA/ICcnIDogJyBzdHlsZT1cImJhY2tncm91bmQ6dmFyKC0tY29sb3Itd2FybmluZy1iZylcIicpICtcclxuICAgICAgICAnPicgK1xyXG4gICAgICAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjZweCAxMHB4O2ZvbnQtZmFtaWx5Om1vbm9zcGFjZTtmb250LXNpemU6MTFweDt3aGl0ZS1zcGFjZTpub3dyYXBcIj4nICtcclxuICAgICAgICBlc2NhcGVIdG1sU2FmZShyLnNrdSkgK1xyXG4gICAgICAgICc8L3RkPicgK1xyXG4gICAgICAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjZweCAxMHB4O2ZvbnQtc2l6ZToxMXB4XCI+JyArXHJcbiAgICAgICAgZXNjYXBlSHRtbFNhZmUoci5mYW1pbGlhKSArXHJcbiAgICAgICAgJzwvdGQ+JyArXHJcbiAgICAgICAgJzx0ZCBzdHlsZT1cInBhZGRpbmc6NnB4IDEwcHg7Zm9udC1zaXplOjExcHhcIj4nICtcclxuICAgICAgICBlc2NhcGVIdG1sU2FmZShyLnN1YmZhbWlsaWEpICtcclxuICAgICAgICAnPC90ZD4nICtcclxuICAgICAgICAnPHRkIHN0eWxlPVwicGFkZGluZzo2cHggMTBweDt0ZXh0LWFsaWduOnJpZ2h0O2ZvbnQtdmFyaWFudC1udW1lcmljOnRhYnVsYXItbnVtc1wiPicgK1xyXG4gICAgICAgIGZtdChyLnZlbnRhczEybSkgK1xyXG4gICAgICAgICc8L3RkPicgK1xyXG4gICAgICAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjZweCAxMHB4O3RleHQtYWxpZ246cmlnaHQ7Zm9udC12YXJpYW50LW51bWVyaWM6dGFidWxhci1udW1zO2ZvbnQtd2VpZ2h0OjYwMFwiPicgK1xyXG4gICAgICAgIGZtdChyLnBlZGlkbzZtKSArXHJcbiAgICAgICAgJzwvdGQ+JyArXHJcbiAgICAgICAgJzx0ZCBzdHlsZT1cInBhZGRpbmc6NnB4IDEwcHg7dGV4dC1hbGlnbjpyaWdodDtmb250LXZhcmlhbnQtbnVtZXJpYzp0YWJ1bGFyLW51bXM7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZClcIj4nICtcclxuICAgICAgICBmbXQoci5wcm9tZWRpbykgK1xyXG4gICAgICAgICc8L3RkPicgK1xyXG4gICAgICAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjZweCAxMHB4O3RleHQtYWxpZ246cmlnaHQ7Zm9udC12YXJpYW50LW51bWVyaWM6dGFidWxhci1udW1zXCI+JyArXHJcbiAgICAgICAgZm10KHIucG9saXRpY2EpICtcclxuICAgICAgICAnPC90ZD4nICtcclxuICAgICAgICAnPHRkIHN0eWxlPVwicGFkZGluZzo2cHggMTBweDt0ZXh0LWFsaWduOnJpZ2h0O2ZvbnQtdmFyaWFudC1udW1lcmljOnRhYnVsYXItbnVtcztmb250LXdlaWdodDo3MDA7Y29sb3I6JyArXHJcbiAgICAgICAgY29sb3JGb3JUb3RhbChyLnRvdGFsKSArXHJcbiAgICAgICAgJ1wiPicgK1xyXG4gICAgICAgIGZtdChyLnRvdGFsKSArXHJcbiAgICAgICAgJzwvdGQ+JyArXHJcbiAgICAgICAgJzwvdHI+J1xyXG4gICAgKVxyXG4gICAgLmpvaW4oJycpO1xyXG4gIGNvbnN0IGhlYWRlciA9XHJcbiAgICAnJyArXHJcbiAgICAnPHRoZWFkIHN0eWxlPVwicG9zaXRpb246c3RpY2t5O3RvcDowO2JhY2tncm91bmQ6IzBmMTcyYTtjb2xvcjojZmZmO3otaW5kZXg6MVwiPicgK1xyXG4gICAgJzx0cj4nICtcclxuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjhweCAxMHB4O3RleHQtYWxpZ246bGVmdDtmb250LXNpemU6MTFweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7bGV0dGVyLXNwYWNpbmc6LjRweFwiPlNLVTwvdGg+JyArXHJcbiAgICAnPHRoIHN0eWxlPVwicGFkZGluZzo4cHggMTBweDt0ZXh0LWFsaWduOmxlZnQ7Zm9udC1zaXplOjExcHg7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO2xldHRlci1zcGFjaW5nOi40cHhcIj5GYW1pbGlhPC90aD4nICtcclxuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjhweCAxMHB4O3RleHQtYWxpZ246bGVmdDtmb250LXNpemU6MTFweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7bGV0dGVyLXNwYWNpbmc6LjRweFwiPlN1YmZhbWlsaWE8L3RoPicgK1xyXG4gICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6OHB4IDEwcHg7dGV4dC1hbGlnbjpyaWdodDtmb250LXNpemU6MTFweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7bGV0dGVyLXNwYWNpbmc6LjRweFwiIHRpdGxlPVwiU3VtYSBkZSBxdHkgZmFjdHVyYWRhIGVuIGxvcyB1bHRpbW9zIDEyIG1lc2VzIGNvbXBsZXRvc1wiPlZlbnRhcyAxMm08L3RoPicgK1xyXG4gICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6OHB4IDEwcHg7dGV4dC1hbGlnbjpyaWdodDtmb250LXNpemU6MTFweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7bGV0dGVyLXNwYWNpbmc6LjRweFwiIHRpdGxlPVwiU3VtYSBkZSBsYXMgNiBjb2x1bW5hcyBkZWwgRXhjZWwgU2FsZXMgUGxhblwiPlBlZGlkbyA2bTwvdGg+JyArXHJcbiAgICAnPHRoIHN0eWxlPVwicGFkZGluZzo4cHggMTBweDt0ZXh0LWFsaWduOnJpZ2h0O2ZvbnQtc2l6ZToxMXB4O3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtsZXR0ZXItc3BhY2luZzouNHB4XCIgdGl0bGU9XCJWZW50YXMgWVREIC8gbWVzZXMgdHJhbnNjdXJyaWRvcyBkZWwgYVx1MDBGMW9cIj5Qcm9tIC8gTWVzPC90aD4nICtcclxuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjhweCAxMHB4O3RleHQtYWxpZ246cmlnaHQ7Zm9udC1zaXplOjExcHg7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO2xldHRlci1zcGFjaW5nOi40cHhcIiB0aXRsZT1cIlByb21lZGlvIHggMyBtZXNlcyAocG9saXRpY2EgZGUgaW52ZW50YXJpbylcIj5Qb2xpdGljYTwvdGg+JyArXHJcbiAgICAnPHRoIHN0eWxlPVwicGFkZGluZzo4cHggMTBweDt0ZXh0LWFsaWduOnJpZ2h0O2ZvbnQtc2l6ZToxMXB4O3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtsZXR0ZXItc3BhY2luZzouNHB4XCIgdGl0bGU9XCJQZWRpZG8gNm0gLSBQb2xpdGljYS4gTmVnYXRpdm8gPSB0ZSBmYWx0YSBwZWRpcjsgUG9zaXRpdm8gPSBzb2JyZXBlZGlkb1wiPlRvdGFsPC90aD4nICtcclxuICAgICc8L3RyPicgK1xyXG4gICAgJzwvdGhlYWQ+JztcclxuICBib2R5LmlubmVySFRNTCA9XHJcbiAgICAnPHRhYmxlIHN0eWxlPVwid2lkdGg6MTAwJTtib3JkZXItY29sbGFwc2U6Y29sbGFwc2U7Zm9udC1zaXplOjEycHhcIj4nICtcclxuICAgIGhlYWRlciArXHJcbiAgICAnPHRib2R5PicgK1xyXG4gICAgcm93c0h0bWwgK1xyXG4gICAgJzwvdGJvZHk+PC90YWJsZT4nO1xyXG59XHJcblxyXG5mdW5jdGlvbiBlc2NhcGVIdG1sU2FmZShzKSB7XHJcbiAgaWYgKHR5cGVvZiB3aW5kb3cuZXNjYXBlSHRtbCA9PT0gJ2Z1bmN0aW9uJykgcmV0dXJuIHdpbmRvdy5lc2NhcGVIdG1sKHMpO1xyXG4gIHJldHVybiBTdHJpbmcocyA9PSBudWxsID8gJycgOiBzKS5yZXBsYWNlKFxyXG4gICAgL1smPD5cIiddL2csXHJcbiAgICAoY2gpID0+ICh7ICcmJzogJyZhbXA7JywgJzwnOiAnJmx0OycsICc+JzogJyZndDsnLCAnXCInOiAnJnF1b3Q7JywgXCInXCI6ICcmIzM5OycgfSlbY2hdXHJcbiAgKTtcclxufVxyXG5cclxud2luZG93Lm9wZW5Gb3JlY2FzdE1vZGFsID0gYXN5bmMgZnVuY3Rpb24gKCkge1xyXG4gIGlmICghX2NhbkZvcmVjYXN0KCkpIHtcclxuICAgIGFsZXJ0KCdGT1JFQ0FTVCBlcyBzb2xvIHBhcmEgTWFyaWFubyAoYWRtaW4pLicpO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuICBjb25zdCBlbCA9IF9yZW5kZXJNb2RhbFNoZWxsKCk7XHJcbiAgZWwuc3R5bGUuZGlzcGxheSA9ICdibG9jayc7XHJcbiAgaWYgKF9mb3JlY2FzdExvYWRpbmcpIHJldHVybjtcclxuICBpZiAoIV9mb3JlY2FzdFNuYXBzaG90KSB7XHJcbiAgICBfZm9yZWNhc3RMb2FkaW5nID0gdHJ1ZTtcclxuICAgIGNvbnN0IHN0YXRzID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2ZvcmVjYXN0LXN0YXRzJyk7XHJcbiAgICBpZiAoc3RhdHMpIHN0YXRzLnRleHRDb250ZW50ID0gJ0NhcmdhbmRvIHNuYXBzaG90IGRlIHZlbnRhcy4uLic7XHJcbiAgICB0cnkge1xyXG4gICAgICBhd2FpdCBfbG9hZFNuYXBzaG90KCk7XHJcbiAgICAgIGlmIChzdGF0cykgc3RhdHMudGV4dENvbnRlbnQgPSBfZm9yZWNhc3RTbmFwc2hvdC5jb3VudCArICcgU0tVcyBlbiBzbmFwc2hvdCBoaXN0b3JpY28nO1xyXG4gICAgfSBjYXRjaCAoZSkge1xyXG4gICAgICBpZiAoc3RhdHMpIHN0YXRzLnRleHRDb250ZW50ID0gJ0Vycm9yIGNhcmdhbmRvIHNuYXBzaG90OiAnICsgKChlICYmIGUubWVzc2FnZSkgfHwgZSk7XHJcbiAgICAgIGFsZXJ0KFxyXG4gICAgICAgICdObyBzZSBwdWRvIGNhcmdhciBza3VfdmVudGFzX3NuYXBzaG90LiBDaGVxdWVhIHF1ZSBlbCBib290c3RyYXAgUHl0aG9uIHlhIGhheWEgY29ycmlkbyAoc2NyaXB0cy9hcHBseV9za3VfdmVudGFzX3NuYXBzaG90LnB5KSB5IHF1ZSB0ZW5nYXMgcm9sIGFkbWluLidcclxuICAgICAgKTtcclxuICAgIH0gZmluYWxseSB7XHJcbiAgICAgIF9mb3JlY2FzdExvYWRpbmcgPSBmYWxzZTtcclxuICAgIH1cclxuICB9IGVsc2Uge1xyXG4gICAgY29uc3Qgc3RhdHMgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZm9yZWNhc3Qtc3RhdHMnKTtcclxuICAgIGlmIChzdGF0cykgc3RhdHMudGV4dENvbnRlbnQgPSBfZm9yZWNhc3RTbmFwc2hvdC5jb3VudCArICcgU0tVcyBlbiBzbmFwc2hvdCBoaXN0b3JpY28nO1xyXG4gIH1cclxufTtcclxuXHJcbndpbmRvdy5jbG9zZUZvcmVjYXN0TW9kYWwgPSBmdW5jdGlvbiAoKSB7XHJcbiAgY29uc3QgZWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZm9yZWNhc3QtbW9kYWwnKTtcclxuICBpZiAoZWwpIGVsLnN0eWxlLmRpc3BsYXkgPSAnbm9uZSc7XHJcbn07XHJcblxyXG53aW5kb3cub25Gb3JlY2FzdFNhbGVzUGxhbkZpbGUgPSBhc3luYyBmdW5jdGlvbiAoZXZlbnQpIHtcclxuICBjb25zdCBmaWxlID0gZXZlbnQgJiYgZXZlbnQudGFyZ2V0ICYmIGV2ZW50LnRhcmdldC5maWxlcyAmJiBldmVudC50YXJnZXQuZmlsZXNbMF07XHJcbiAgaWYgKCFmaWxlKSByZXR1cm47XHJcbiAgdHJ5IHtcclxuICAgIGlmICghX2ZvcmVjYXN0U25hcHNob3QpIGF3YWl0IF9sb2FkU25hcHNob3QoKTtcclxuICAgIGNvbnN0IGJ1ZiA9IGF3YWl0IGZpbGUuYXJyYXlCdWZmZXIoKTtcclxuICAgIGlmICh0eXBlb2YgWExTWCA9PT0gJ3VuZGVmaW5lZCcpIHtcclxuICAgICAgYWxlcnQoJ1hMU1ggbm8gY2FyZ2FkbycpO1xyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcbiAgICBjb25zdCB3YiA9IFhMU1gucmVhZChidWYsIHsgdHlwZTogJ2FycmF5JyB9KTtcclxuICAgIGNvbnN0IHNoZWV0ID0gd2IuU2hlZXRzW3diLlNoZWV0TmFtZXNbMF1dO1xyXG4gICAgY29uc3Qgcm93cyA9IFhMU1gudXRpbHMuc2hlZXRfdG9fanNvbihzaGVldCwgeyBoZWFkZXI6IDEsIGRlZnZhbDogbnVsbCwgcmF3OiB0cnVlIH0pO1xyXG4gICAgY29uc3QgcGFyc2VkID0gX3BhcnNlU2FsZXNQbGFuUm93cyhyb3dzKTtcclxuICAgIGlmICghcGFyc2VkLmxlbmd0aCkge1xyXG4gICAgICBhbGVydCgnRWwgRXhjZWwgZXN0YSB2YWNpbyBvIG5vIHRpZW5lIGZpbGFzIHZhbGlkYXMuJyk7XHJcbiAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIF9mb3JlY2FzdFNhbGVzUGxhbiA9IHBhcnNlZDtcclxuICAgIGNvbnN0IGhveSA9IG5ldyBEYXRlKCk7XHJcbiAgICBfZm9yZWNhc3RSb3dzID0gX2NvbXB1dGVGb3JlY2FzdFJvd3MoX2ZvcmVjYXN0U25hcHNob3QsIHBhcnNlZCwgaG95KTtcclxuICAgIF9yZW5kZXJUYWJsZShfZm9yZWNhc3RSb3dzKTtcclxuICAgIGNvbnN0IHNpbk1hdGNoID0gX2ZvcmVjYXN0Um93cy5maWx0ZXIoKHIpID0+ICFyLmhhc0hpc3RvcmlhKS5sZW5ndGg7XHJcbiAgICBjb25zdCBzdGF0cyA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdmb3JlY2FzdC1zdGF0cycpO1xyXG4gICAgaWYgKHN0YXRzKSB7XHJcbiAgICAgIHN0YXRzLnRleHRDb250ZW50ID1cclxuICAgICAgICBwYXJzZWQubGVuZ3RoICtcclxuICAgICAgICAnIFNLVXMgZW4gU2FsZXMgUGxhbiBcdTAwQjcgJyArXHJcbiAgICAgICAgKHBhcnNlZC5sZW5ndGggLSBzaW5NYXRjaCkgK1xyXG4gICAgICAgICcgY29uIGhpc3RvcmlhIFx1MDBCNyAnICtcclxuICAgICAgICBzaW5NYXRjaCArXHJcbiAgICAgICAgJyBzaW4gbWF0Y2ggKGZvbmRvIGFtYXJpbGxvKSc7XHJcbiAgICB9XHJcbiAgICBjb25zdCBidG4gPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZm9yZWNhc3QtZXhwb3J0LWJ0bicpO1xyXG4gICAgaWYgKGJ0bikge1xyXG4gICAgICBidG4uZGlzYWJsZWQgPSBmYWxzZTtcclxuICAgICAgYnRuLnN0eWxlLm9wYWNpdHkgPSAnMSc7XHJcbiAgICB9XHJcbiAgfSBjYXRjaCAoZSkge1xyXG4gICAgY29uc29sZS5lcnJvcignW0ZPUkVDQVNUXSBwYXJzZSBlcnJvcjonLCBlKTtcclxuICAgIGFsZXJ0KCdFcnJvciBwcm9jZXNhbmRvIGVsIEV4Y2VsOlxcbicgKyAoKGUgJiYgZS5tZXNzYWdlKSB8fCBlKSk7XHJcbiAgfSBmaW5hbGx5IHtcclxuICAgIC8vIFJlc2V0IGlucHV0IHBhcmEgcXVlIGVsIG1pc21vIGFyY2hpdm8gc2UgcHVlZGEgcmUtc3ViaXJcclxuICAgIGlmIChldmVudCAmJiBldmVudC50YXJnZXQpIGV2ZW50LnRhcmdldC52YWx1ZSA9ICcnO1xyXG4gIH1cclxufTtcclxuXHJcbndpbmRvdy5leHBvcnRGb3JlY2FzdEV4Y2VsID0gZnVuY3Rpb24gKCkge1xyXG4gIGlmICghX2ZvcmVjYXN0Um93cyB8fCAhX2ZvcmVjYXN0Um93cy5sZW5ndGgpIHtcclxuICAgIGFsZXJ0KCdObyBoYXkgZGF0b3MgcGFyYSBleHBvcnRhci4gQ2FyZ2EgcHJpbWVybyBlbCBTYWxlcyBQbGFuLicpO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuICBpZiAodHlwZW9mIFhMU1ggPT09ICd1bmRlZmluZWQnKSB7XHJcbiAgICBhbGVydCgnWExTWCBubyBjYXJnYWRvJyk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIGNvbnN0IHJvdW5kMSA9IChuKSA9PiBNYXRoLnJvdW5kKE51bWJlcihuIHx8IDApICogMTApIC8gMTA7XHJcbiAgY29uc3QgYW9hID0gW1xyXG4gICAgW1xyXG4gICAgICAnU0tVJyxcclxuICAgICAgJ0ZBTUlMSUEnLFxyXG4gICAgICAnU1VCRkFNSUxJQScsXHJcbiAgICAgICdWRU5UQVMgKDEybSknLFxyXG4gICAgICAnUEVESURPLVNBTEVTIFBMQU5TICg2bSknLFxyXG4gICAgICAnUFJPTUVESU8gREUgSU5WRU5UQVJJTycsXHJcbiAgICAgICdQT0xJVElDQSBERSBJTlZFTlRBUklPICgzbSknLFxyXG4gICAgICAnVE9UQUwnLFxyXG4gICAgXSxcclxuICBdO1xyXG4gIGZvciAoY29uc3QgciBvZiBfZm9yZWNhc3RSb3dzKSB7XHJcbiAgICBhb2EucHVzaChbXHJcbiAgICAgIHIuc2t1LFxyXG4gICAgICByLmZhbWlsaWEsXHJcbiAgICAgIHIuc3ViZmFtaWxpYSxcclxuICAgICAgcm91bmQxKHIudmVudGFzMTJtKSxcclxuICAgICAgcm91bmQxKHIucGVkaWRvNm0pLFxyXG4gICAgICByb3VuZDEoci5wcm9tZWRpbyksXHJcbiAgICAgIHJvdW5kMShyLnBvbGl0aWNhKSxcclxuICAgICAgcm91bmQxKHIudG90YWwpLFxyXG4gICAgXSk7XHJcbiAgfVxyXG4gIGNvbnN0IHdzID0gWExTWC51dGlscy5hb2FfdG9fc2hlZXQoYW9hKTtcclxuICAvLyBBbmNob3MgZGUgY29sdW1uYVxyXG4gIHdzWychY29scyddID0gW1xyXG4gICAgeyB3Y2g6IDE4IH0sXHJcbiAgICB7IHdjaDogMjQgfSxcclxuICAgIHsgd2NoOiAyNCB9LFxyXG4gICAgeyB3Y2g6IDE0IH0sXHJcbiAgICB7IHdjaDogMjAgfSxcclxuICAgIHsgd2NoOiAyMCB9LFxyXG4gICAgeyB3Y2g6IDIyIH0sXHJcbiAgICB7IHdjaDogMTIgfSxcclxuICBdO1xyXG4gIGNvbnN0IHdiID0gWExTWC51dGlscy5ib29rX25ldygpO1xyXG4gIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQod2IsIHdzLCAnRk9SRUNBU1QnKTtcclxuICBjb25zdCBob3kgPSBuZXcgRGF0ZSgpO1xyXG4gIGNvbnN0IHN0YW1wID1cclxuICAgIGhveS5nZXRGdWxsWWVhcigpICtcclxuICAgICctJyArXHJcbiAgICBTdHJpbmcoaG95LmdldE1vbnRoKCkgKyAxKS5wYWRTdGFydCgyLCAnMCcpICtcclxuICAgICctJyArXHJcbiAgICBTdHJpbmcoaG95LmdldERhdGUoKSkucGFkU3RhcnQoMiwgJzAnKTtcclxuICBYTFNYLndyaXRlRmlsZSh3YiwgJ0ZvcmVjYXN0X1NoaW1hbm9fJyArIHN0YW1wICsgJy54bHN4Jyk7XHJcbn07XHJcblxyXG4vLyBSZWZyZXNoIHB1YmxpY28gKHBvciBzaSBlbCB1c2VyIG5lY2VzaXRhIHJlLWZldGNoZWFyIGVsIHNuYXBzaG90IHNpbiBjZXJyYXJcclxuLy8gZWwgbW9kYWwsIGVqOiBwYXNhcm9uIDMwIG1pbiB5IGVsIGNyb24gQlEgYWN0dWFsaXpvIGxhIGNvbGVjY2lvbikuXHJcbndpbmRvdy5yZWxvYWRGb3JlY2FzdFNuYXBzaG90ID0gYXN5bmMgZnVuY3Rpb24gKCkge1xyXG4gIF9mb3JlY2FzdFNuYXBzaG90ID0gbnVsbDtcclxuICBhd2FpdCBfbG9hZFNuYXBzaG90KCk7XHJcbiAgaWYgKF9mb3JlY2FzdFNhbGVzUGxhbikge1xyXG4gICAgY29uc3QgaG95ID0gbmV3IERhdGUoKTtcclxuICAgIF9mb3JlY2FzdFJvd3MgPSBfY29tcHV0ZUZvcmVjYXN0Um93cyhfZm9yZWNhc3RTbmFwc2hvdCwgX2ZvcmVjYXN0U2FsZXNQbGFuLCBob3kpO1xyXG4gICAgX3JlbmRlclRhYmxlKF9mb3JlY2FzdFJvd3MpO1xyXG4gIH1cclxufTtcclxuIl0sCiAgIm1hcHBpbmdzIjogIjs7O0FBNEJBLE1BQUksb0JBQW9CO0FBQ3hCLE1BQUkscUJBQXFCO0FBQ3pCLE1BQUksZ0JBQWdCO0FBQ3BCLE1BQUksbUJBQW1CO0FBS3ZCLE1BQU0sMEJBQTBCLENBQUMsaUNBQWlDLHlCQUF5QjtBQUUzRixXQUFTLGVBQWU7QUFDdEIsUUFBSTtBQUNGLFlBQU0sU0FBVSxPQUFPLGVBQWUsT0FBTyxZQUFZLFNBQVUsSUFBSSxZQUFZO0FBQ25GLFVBQUksQ0FBQyxNQUFPLFFBQU87QUFDbkIsYUFBTyx3QkFBd0IsUUFBUSxLQUFLLEtBQUs7QUFBQSxJQUNuRCxRQUFRO0FBQ04sYUFBTztBQUFBLElBQ1Q7QUFBQSxFQUNGO0FBR0EsV0FBUyxVQUFVLE1BQU0sZUFBZTtBQUN0QyxXQUFPLE9BQU8sSUFBSSxFQUFFLFNBQVMsR0FBRyxHQUFHLElBQUksTUFBTSxPQUFPLGFBQWEsRUFBRSxTQUFTLEdBQUcsR0FBRztBQUFBLEVBQ3BGO0FBb0JBLFdBQVMsV0FBVyxNQUFNLGVBQWUsT0FBTztBQUM5QyxVQUFNLGNBQWMsT0FBTyxNQUFNLGdCQUFnQixLQUFLO0FBQ3RELFVBQU0sSUFBSSxLQUFLLE1BQU0sY0FBYyxFQUFFO0FBQ3JDLFVBQU0sSUFBSyxjQUFjLEtBQU07QUFDL0IsV0FBTyxFQUFFLEdBQUcsRUFBRTtBQUFBLEVBQ2hCO0FBS0EsV0FBUyx1QkFBdUIsVUFBVSxLQUFLO0FBQzdDLFFBQUksQ0FBQyxTQUFVLFFBQU87QUFDdEIsUUFB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
