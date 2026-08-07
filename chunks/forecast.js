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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL2RvbWFpbnMvZm9yZWNhc3QuanMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbIi8vIEB0cy1ub2NoZWNrXHJcbi8vIEdsb2JhbHMgbGVpZG9zIGRlbCBlbnRvcm5vIChkZWNsYXJhZG9zIGVuIGluZGV4Lmh0bWwgaW5saW5lIG8gYnVuZGxlIHByZXZpbyk6XHJcbi8vIGZiRGIsIGN1cnJlbnRVc2VyLCBYTFNYIChjZG4pLCBlc2NhcGVIdG1sLiBNaXNtbyBwYXRyb24gcXVlIG90cm9zIGRvbWluaW9zLlxyXG4vL1xyXG4vLyBGT1JFQ0FTVCAtIG1vZGFsIGFkbWluLW9ubHkgKE1hcmlhbm8pIHF1ZSBjb21wYXJhIHZlbnRhcyBoaXN0b3JpY2FzXHJcbi8vIChGaXJlc3RvcmUgc2t1X3ZlbnRhc19zbmFwc2hvdCwgYWxpbWVudGFkbyBwb3Igc3luYyBCUSB2X3ZlbnRhc19saW5lYXNcclxuLy8gdmVudGFuYSAxM20pIHZzIFNhbGVzIFBsYW4gY2FyZ2FkbyBwb3IgZWwgdXNlciB2aWEgRXhjZWwgKyBwb2xpdGljYSBkZVxyXG4vLyBpbnZlbnRhcmlvIChwcm9tZWRpbyBZVEQgeCAzIG1lc2VzKS5cclxuLy9cclxuLy8gQ2h1bmsgbGF6eTogc2UgY2FyZ2Egc29sbyBhbCBwcmltZXIgY2xpY2sgZGVsIGJvdG9uIEZPUkVDQVNUIGRlbCBoZWFkZXIuXHJcbi8vIFJlZ2lzdHJhZG8gZW4gYnVpbGQuanMgTEFaWV9DSFVOS1MgKyBzcmMvbWFpbi5qcyBpbnN0YWxsQ2h1bmtTdHVicyArIHN3LmpzXHJcbi8vIFNUQVRJQ19BU1NFVFMuIFZlciBDTEFVREUubWQgIzE4ICgzIGx1Z2FyZXMgc2luY3Jvbml6YWRvcykuXHJcbi8vXHJcbi8vIENvbnRyYXRvIGRlbCBFeGNlbCBTYWxlcyBQbGFuIHF1ZSBzdWJlIGVsIHVzZXI6XHJcbi8vICAgQ29sdW1uYXM6IFNLVSB8IE1lczEgfCBNZXMyIHwgTWVzMyB8IE1lczQgfCBNZXM1IHwgTWVzNlxyXG4vLyAgIChub21icmVzIGV4YWN0b3MgZGUgaGVhZGVycyBjYXNlLWluc2Vuc2l0aXZlOyBNZXMxLi42IHNvbiBsb3MgcHJveGltb3NcclxuLy8gICA2IG1lc2VzIGRlc2RlIGVsIG1lcyBhY3R1YWwpLiBVbmEgZmlsYSBwb3IgU0tVLlxyXG4vL1xyXG4vLyBGdWVudGUgZGUgZGF0b3MgaGlzdG9yaWNhczpcclxuLy8gICBGaXJlc3RvcmUgL3NrdV92ZW50YXNfc25hcHNob3Qve1NLVV88c2t1X3NhbmVhZG8+fVxyXG4vLyAgIHtcclxuLy8gICAgIHNrdSwgaXRlbU5hbWUsIGZhbWlsaWEsIHN1YmZhbWlsaWEsXHJcbi8vICAgICBtZXNlczogeyAnMjAyNS0wOCc6IHtxdHksIGFyc30sIC4uLiwgJzIwMjYtMDgnOiB7cXR5LCBhcnN9IH1cclxuLy8gICB9XHJcbi8vICAgUnVsZXM6IHJlYWQgYWRtaW4tb25seSAoY29tcGV0aXRpdmVseSBzZW5zaXRpdmUpLiBFc2NyaXRvIHBvciBjcm9uXHJcbi8vICAgc3luY19zYXBfdG9fYmlncXVlcnkucHkgY2FkYSAzMCBtaW4uXHJcblxyXG4vLyBFc3RhZG8gZGVsIG1vZGFsIChpbnRyYS1jaHVuaywgbm8gY3Jvc3Mtc2NvcGUpLlxyXG5sZXQgX2ZvcmVjYXN0U25hcHNob3QgPSBudWxsOyAvLyB7IFNLVToge2ZhbWlsaWEsIHN1YmZhbWlsaWEsIGl0ZW1OYW1lLCBtZXNlc30gfVxyXG5sZXQgX2ZvcmVjYXN0U2FsZXNQbGFuID0gbnVsbDsgLy8gW3sgc2t1LCBwZWRpZG9Ub3RhbCwgbWVzZXNBcnI6IFtuMS4ubjZdIH1dXHJcbmxldCBfZm9yZWNhc3RSb3dzID0gbnVsbDsgLy8gZmlsYXMgZmluYWxlcyBjYWxjdWxhZGFzIHBhcmEgcHJldmlldyArIGV4cG9ydFxyXG5sZXQgX2ZvcmVjYXN0TG9hZGluZyA9IGZhbHNlO1xyXG5cclxuLy8gV2hpdGVsaXN0IGRlIGVtYWlscyBjb24gYWNjZXNvIGFsIG1vZGFsIEZPUkVDQVNULiBSZXBsaWNhIGVsIHBhdHJvbiBkZVxyXG4vLyBcIkFuYWxpc2lzXCIgKGluZGV4Lmh0bWw6MTI2MjUpLiBTb2xvIE1hcmlhbm87IHNpIG90cm8gYWRtaW4gbG8gbmVjZXNpdGFcclxuLy8gc2UgYWdyZWdhIGFjYSBleHBsaWNpdG8uXHJcbmNvbnN0IEZPUkVDQVNUX0FMTE9XRURfRU1BSUxTID0gWydtYXJpYW5vLmVyYmlub0BzaGltYW5vLmNvbS5hcicsICdlcmJpbm9tYXJpYW5vQGdtYWlsLmNvbSddO1xyXG5cclxuZnVuY3Rpb24gX2NhbkZvcmVjYXN0KCkge1xyXG4gIHRyeSB7XHJcbiAgICBjb25zdCBlbWFpbCA9ICgod2luZG93LmN1cnJlbnRVc2VyICYmIHdpbmRvdy5jdXJyZW50VXNlci5lbWFpbCkgfHwgJycpLnRvTG93ZXJDYXNlKCk7XHJcbiAgICBpZiAoIWVtYWlsKSByZXR1cm4gZmFsc2U7XHJcbiAgICByZXR1cm4gRk9SRUNBU1RfQUxMT1dFRF9FTUFJTFMuaW5kZXhPZihlbWFpbCkgPj0gMDtcclxuICB9IGNhdGNoIHtcclxuICAgIHJldHVybiBmYWxzZTtcclxuICB9XHJcbn1cclxuXHJcbi8vIEhlbHBlcnMgZGUgbWVzIGNhbGVuZGFyLlxyXG5mdW5jdGlvbiBfbW9udGhLZXkoeWVhciwgbW9udGhPbmVCYXNlZCkge1xyXG4gIHJldHVybiBTdHJpbmcoeWVhcikucGFkU3RhcnQoNCwgJzAnKSArICctJyArIFN0cmluZyhtb250aE9uZUJhc2VkKS5wYWRTdGFydCgyLCAnMCcpO1xyXG59XHJcbmZ1bmN0aW9uIF9tb250aExhYmVsKGtleSkge1xyXG4gIC8vICcyMDI2LTA4JyAtPiAnYWdvLTI2J1xyXG4gIGNvbnN0IFt5LCBtXSA9IGtleS5zcGxpdCgnLScpLm1hcChOdW1iZXIpO1xyXG4gIGNvbnN0IG5hbWVzID0gW1xyXG4gICAgJ2VuZScsXHJcbiAgICAnZmViJyxcclxuICAgICdtYXInLFxyXG4gICAgJ2FicicsXHJcbiAgICAnbWF5JyxcclxuICAgICdqdW4nLFxyXG4gICAgJ2p1bCcsXHJcbiAgICAnYWdvJyxcclxuICAgICdzZXAnLFxyXG4gICAgJ29jdCcsXHJcbiAgICAnbm92JyxcclxuICAgICdkaWMnLFxyXG4gIF07XHJcbiAgcmV0dXJuIG5hbWVzW20gLSAxXSArICctJyArIFN0cmluZyh5KS5zbGljZSgtMik7XHJcbn1cclxuZnVuY3Rpb24gX2FkZE1vbnRocyh5ZWFyLCBtb250aE9uZUJhc2VkLCBkZWx0YSkge1xyXG4gIGNvbnN0IHRvdGFsTW9udGhzID0geWVhciAqIDEyICsgKG1vbnRoT25lQmFzZWQgLSAxKSArIGRlbHRhO1xyXG4gIGNvbnN0IHkgPSBNYXRoLmZsb29yKHRvdGFsTW9udGhzIC8gMTIpO1xyXG4gIGNvbnN0IG0gPSAodG90YWxNb250aHMgJSAxMikgKyAxO1xyXG4gIHJldHVybiB7IHksIG0gfTtcclxufVxyXG5cclxuLy8gU3VtYSBxdHkgZGVsIFNLVSBlbiBsb3MgdWx0aW1vcyAxMiBNRVNFUyBDT01QTEVUT1MgKGV4Y2x1eWUgZWwgbWVzIGFjdHVhbFxyXG4vLyBwYXJjaWFsIC0gbGEgdmVudGFuYSBtb3ZpbCBcIjEyIG1lc2VzIGNlcnJhZG9zXCIgcXVlIGVsIHVzZXIgcGllbnNhIGNvbW9cclxuLy8gXCJlbCBhXHUwMEYxbyBxdWUgeWEgcGFzb1wiKS4gRWplbXBsbyBlbiBhZ29zdG8gMjAyNjogc3VtYXIgYWdvLTI1IGEganVsLTI2LlxyXG5mdW5jdGlvbiBfc3VtVmVudGFzMTJtQ29tcGxldG9zKG1lc2VzTWFwLCBob3kpIHtcclxuICBpZiAoIW1lc2VzTWFwKSByZXR1cm4gMDtcclxuICBsZXQgc3VtID0gMDtcclxuICBjb25zdCBzdGFydE1vbnRoID0gX2FkZE1vbnRocyhob3kuZ2V0RnVsbFllYXIoKSwgaG95LmdldE1vbnRoKCkgKyAxLCAtMTIpO1xyXG4gIGNvbnN0IGVuZE1vbnRoID0gX2FkZE1vbnRocyhob3kuZ2V0RnVsbFllYXIoKSwgaG95LmdldE1vbnRoKCkgKyAxLCAtMSk7XHJcbiAgY29uc3Qgc3RhcnRLZXkgPSBfbW9udGhLZXkoc3RhcnRNb250aC55LCBzdGFydE1vbnRoLm0pO1xyXG4gIGNvbnN0IGVuZEtleSA9IF9tb250aEtleShlbmRNb250aC55LCBlbmRNb250aC5tKTtcclxuICBmb3IgKGNvbnN0IGsgb2YgT2JqZWN0LmtleXMobWVzZXNNYXApKSB7XHJcbiAgICBpZiAoayA+PSBzdGFydEtleSAmJiBrIDw9IGVuZEtleSkge1xyXG4gICAgICBzdW0gKz0gTnVtYmVyKChtZXNlc01hcFtrXSAmJiBtZXNlc01hcFtrXS5xdHkpIHx8IDApO1xyXG4gICAgfVxyXG4gIH1cclxuICByZXR1cm4gc3VtO1xyXG59XHJcblxyXG4vLyBTdW1hIHF0eSBkZWwgU0tVIFlURCAoZW5lcm8gZGVsIGFcdTAwRjFvIGFjdHVhbCBoYXN0YSBtZXMgYWN0dWFsIElOQ0xVU0lWTyxcclxuLy8gYXVucXVlIGVsIG1lcyBhY3R1YWwgc2VhIHBhcmNpYWwpLiBSZXRvcm5hIHsgdG90YWxZdGQsIG1lc2VzVHJhbnNjdXJyaWRvcyB9LlxyXG4vLyBFamVtcGxvIGFnb3N0byAyMDI2IGNvbiB2ZW50YXMganVsPTEwICsgYWdvPTIwIC0+IHszMCwgOH0sIHByb21lZGlvPTMwLzg9My43NS5cclxuLy8gKFNpIGVsIHVzdWFyaW8gZXNwZXJhYmEgZGl2aWRpciBwb3IgMiBlbiB2ZXogZGUgOCwgcmV2aXNhciBzcGVjLiBFbCBwZWRpZG9cclxuLy8gZGljZSBcImNhbnRpZGFkIGRlIG1lc2VzIHF1ZSB0cmFuc2N1cnJpbW9zXCIgPSBtZXNlcyBkZWwgYVx1MDBGMW8gcGFzYWRvcyBoYXN0YSBob3kuKVxyXG5mdW5jdGlvbiBfc3VtVmVudGFzWVREKG1lc2VzTWFwLCBob3kpIHtcclxuICBjb25zdCB5ZWFyID0gaG95LmdldEZ1bGxZZWFyKCk7XHJcbiAgY29uc3QgbWVzQWN0dWFsID0gaG95LmdldE1vbnRoKCkgKyAxO1xyXG4gIGxldCB0b3RhbCA9IDA7XHJcbiAgaWYgKG1lc2VzTWFwKSB7XHJcbiAgICBmb3IgKGxldCBtID0gMTsgbSA8PSBtZXNBY3R1YWw7IG0rKykge1xyXG4gICAgICBjb25zdCBrID0gX21vbnRoS2V5KHllYXIsIG0pO1xyXG4gICAgICB0b3RhbCArPSBOdW1iZXIoKG1lc2VzTWFwW2tdICYmIG1lc2VzTWFwW2tdLnF0eSkgfHwgMCk7XHJcbiAgICB9XHJcbiAgfVxyXG4gIHJldHVybiB7IHRvdGFsWXRkOiB0b3RhbCwgbWVzZXNUcmFuc2N1cnJpZG9zOiBtZXNBY3R1YWwgfTtcclxufVxyXG5cclxuLy8gQ2FyZ2Egc2t1X3ZlbnRhc19zbmFwc2hvdCBjb21wbGV0byAodW5hIHZleiBwb3Igc2VzaW9uIGRlbCBtb2RhbCkuXHJcbmFzeW5jIGZ1bmN0aW9uIF9sb2FkU25hcHNob3QoKSB7XHJcbiAgaWYgKF9mb3JlY2FzdFNuYXBzaG90KSByZXR1cm4gX2ZvcmVjYXN0U25hcHNob3Q7XHJcbiAgaWYgKCF3aW5kb3cuZmJEYikgdGhyb3cgbmV3IEVycm9yKCdGaXJlc3RvcmUgbm8gaW5pY2lhbGl6YWRvJyk7XHJcbiAgY29uc3Qgc25hcCA9IGF3YWl0IHdpbmRvdy5mYkRiLmNvbGxlY3Rpb24oJ3NrdV92ZW50YXNfc25hcHNob3QnKS5nZXQoKTtcclxuICBjb25zdCBieU9yaWdpbmFsU2t1ID0ge307XHJcbiAgY29uc3QgYnlVcHBlclNrdSA9IHt9O1xyXG4gIHNuYXAuZm9yRWFjaCgoZG9jKSA9PiB7XHJcbiAgICBjb25zdCBkID0gZG9jLmRhdGEoKTtcclxuICAgIGlmICghZCB8fCAhZC5za3UpIHJldHVybjtcclxuICAgIGNvbnN0IHNrdVVwcGVyID0gU3RyaW5nKGQuc2t1KS50cmltKCkudG9VcHBlckNhc2UoKTtcclxuICAgIGNvbnN0IHJlY29yZCA9IHtcclxuICAgICAgc2t1OiBkLnNrdSxcclxuICAgICAgaXRlbU5hbWU6IGQuaXRlbU5hbWUgfHwgJycsXHJcbiAgICAgIGZhbWlsaWE6IGQuZmFtaWxpYSB8fCAnJyxcclxuICAgICAgc3ViZmFtaWxpYTogZC5zdWJmYW1pbGlhIHx8ICcnLFxyXG4gICAgICBtZXNlczogZC5tZXNlcyB8fCB7fSxcclxuICAgIH07XHJcbiAgICBieU9yaWdpbmFsU2t1W2Quc2t1XSA9IHJlY29yZDtcclxuICAgIGJ5VXBwZXJTa3Vbc2t1VXBwZXJdID0gcmVjb3JkO1xyXG4gIH0pO1xyXG4gIF9mb3JlY2FzdFNuYXBzaG90ID0geyBieU9yaWdpbmFsU2t1LCBieVVwcGVyU2t1LCBjb3VudDogc25hcC5zaXplIH07XHJcbiAgcmV0dXJuIF9mb3JlY2FzdFNuYXBzaG90O1xyXG59XHJcblxyXG4vLyBQYXJzZWEgZWwgRXhjZWwgU2FsZXMgUGxhbi4gRXNwZXJhIGNvbHVtbmFzIFNLVSArIDYgY29sdW1uYXMgbnVtZXJpY2FzXHJcbi8vIChub21icmVzIGZsZXhpYmxlczogTWVzMS4uTWVzNiwgbWVzXzEuLm1lc182LCBvIGN1YWxxdWllciBoZWFkZXIgY3VzdG9tXHJcbi8vIG1pZW50cmFzIGxhIHByaW1lcmEgc2VhIFNLVSB5IGhheWEgYWwgbWVub3MgNiBjb2x1bW5hcyBudW1lcmljYXMgbWFzKS5cclxuZnVuY3Rpb24gX3BhcnNlU2FsZXNQbGFuUm93cyhyb3dzUmF3KSB7XHJcbiAgaWYgKCFyb3dzUmF3IHx8ICFyb3dzUmF3Lmxlbmd0aCkgcmV0dXJuIFtdO1xyXG4gIGNvbnN0IGhlYWRlclJvdyA9IHJvd3NSYXdbMF07XHJcbiAgLy8gRGV0ZWN0YXIgaW5kaWNlIGRlIGNvbHVtbmEgU0tVXHJcbiAgbGV0IHNrdUNvbElkeCA9IC0xO1xyXG4gIGZvciAobGV0IGkgPSAwOyBpIDwgaGVhZGVyUm93Lmxlbmd0aDsgaSsrKSB7XHJcbiAgICBjb25zdCBoID0gU3RyaW5nKGhlYWRlclJvd1tpXSB8fCAnJylcclxuICAgICAgLnRyaW0oKVxyXG4gICAgICAudG9VcHBlckNhc2UoKTtcclxuICAgIGlmIChoID09PSAnU0tVJyB8fCBoID09PSAnSVRFTUNPREUnIHx8IGggPT09ICdJVEVNJyB8fCBoID09PSAnSVRFTSBDT0RFJyB8fCBoID09PSAnQ09ESUdPJykge1xyXG4gICAgICBza3VDb2xJZHggPSBpO1xyXG4gICAgICBicmVhaztcclxuICAgIH1cclxuICB9XHJcbiAgaWYgKHNrdUNvbElkeCA8IDApXHJcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ0VsIEV4Y2VsIGRlYmUgdGVuZXIgdW5hIGNvbHVtbmEgbGxhbWFkYSBcIlNLVVwiIChvIENvZGlnbyAvIEl0ZW1Db2RlIC8gSXRlbSknKTtcclxuICAvLyBMYXMgNiBjb2x1bW5hcyBkZSBtZXNlczogbGFzIHByaW1lcmFzIDYgY29sdW1uYXMgcXVlIHNlYW4gIT0gc2t1Q29sSWR4LlxyXG4gIGNvbnN0IG1vbnRoQ29scyA9IFtdO1xyXG4gIGZvciAobGV0IGkgPSAwOyBpIDwgaGVhZGVyUm93Lmxlbmd0aCAmJiBtb250aENvbHMubGVuZ3RoIDwgNjsgaSsrKSB7XHJcbiAgICBpZiAoaSAhPT0gc2t1Q29sSWR4KSBtb250aENvbHMucHVzaChpKTtcclxuICB9XHJcbiAgaWYgKG1vbnRoQ29scy5sZW5ndGggPCA2KVxyXG4gICAgdGhyb3cgbmV3IEVycm9yKFxyXG4gICAgICAnRWwgRXhjZWwgZGViZSB0ZW5lciBhbCBtZW5vcyA2IGNvbHVtbmFzIGRlIG1lc2VzIGFkZW1hcyBkZSBTS1UgKGVuY29udHJhZGFzOiAnICtcclxuICAgICAgICBtb250aENvbHMubGVuZ3RoICtcclxuICAgICAgICAnKSdcclxuICAgICk7XHJcbiAgY29uc3Qgb3V0ID0gW107XHJcbiAgZm9yIChsZXQgciA9IDE7IHIgPCByb3dzUmF3Lmxlbmd0aDsgcisrKSB7XHJcbiAgICBjb25zdCByb3cgPSByb3dzUmF3W3JdO1xyXG4gICAgaWYgKCFyb3cgfHwgIXJvdy5sZW5ndGgpIGNvbnRpbnVlO1xyXG4gICAgY29uc3Qgc2t1UmF3ID0gcm93W3NrdUNvbElkeF07XHJcbiAgICBpZiAoc2t1UmF3ID09PSB1bmRlZmluZWQgfHwgc2t1UmF3ID09PSBudWxsIHx8IFN0cmluZyhza3VSYXcpLnRyaW0oKSA9PT0gJycpIGNvbnRpbnVlO1xyXG4gICAgY29uc3Qgc2t1ID0gU3RyaW5nKHNrdVJhdykudHJpbSgpO1xyXG4gICAgY29uc3QgbWVzZXNBcnIgPSBtb250aENvbHMubWFwKChpKSA9PiB7XHJcbiAgICAgIGNvbnN0IHYgPSByb3dbaV07XHJcbiAgICAgIGNvbnN0IG4gPSBOdW1iZXIodik7XHJcbiAgICAgIHJldHVybiBOdW1iZXIuaXNGaW5pdGUobikgPyBuIDogMDtcclxuICAgIH0pO1xyXG4gICAgY29uc3QgcGVkaWRvVG90YWwgPSBtZXNlc0Fyci5yZWR1Y2UoKGEsIGIpID0+IGEgKyBiLCAwKTtcclxuICAgIG91dC5wdXNoKHsgc2t1LCBtZXNlc0FyciwgcGVkaWRvVG90YWwgfSk7XHJcbiAgfVxyXG4gIHJldHVybiBvdXQ7XHJcbn1cclxuXHJcbi8vIENhbGN1bGEgbGFzIGZpbGFzIGZpbmFsZXMgY3J1emFuZG8gc25hcHNob3QgKyBzYWxlcyBwbGFuLlxyXG5mdW5jdGlvbiBfY29tcHV0ZUZvcmVjYXN0Um93cyhzbmFwc2hvdCwgc2FsZXNQbGFuLCBob3kpIHtcclxuICBjb25zdCByb3dzID0gW107XHJcbiAgZm9yIChjb25zdCBzcCBvZiBzYWxlc1BsYW4pIHtcclxuICAgIGNvbnN0IHNrdVVwcGVyID0gc3Auc2t1LnRvVXBwZXJDYXNlKCk7XHJcbiAgICBjb25zdCBoaXN0ID0gc25hcHNob3QuYnlVcHBlclNrdVtza3VVcHBlcl0gfHwgbnVsbDtcclxuICAgIGNvbnN0IHZlbnRhczEybSA9IGhpc3QgPyBfc3VtVmVudGFzMTJtQ29tcGxldG9zKGhpc3QubWVzZXMsIGhveSkgOiAwO1xyXG4gICAgY29uc3QgeXRkID0gaGlzdFxyXG4gICAgICA/IF9zdW1WZW50YXNZVEQoaGlzdC5tZXNlcywgaG95KVxyXG4gICAgICA6IHsgdG90YWxZdGQ6IDAsIG1lc2VzVHJhbnNjdXJyaWRvczogaG95LmdldE1vbnRoKCkgKyAxIH07XHJcbiAgICBjb25zdCBwcm9tZWRpbyA9IHl0ZC5tZXNlc1RyYW5zY3Vycmlkb3MgPiAwID8geXRkLnRvdGFsWXRkIC8geXRkLm1lc2VzVHJhbnNjdXJyaWRvcyA6IDA7XHJcbiAgICBjb25zdCBwb2xpdGljYSA9IHByb21lZGlvICogMztcclxuICAgIGNvbnN0IHRvdGFsID0gc3AucGVkaWRvVG90YWwgLSBwb2xpdGljYTtcclxuICAgIHJvd3MucHVzaCh7XHJcbiAgICAgIHNrdTogc3Auc2t1LFxyXG4gICAgICBpdGVtTmFtZTogaGlzdCA/IGhpc3QuaXRlbU5hbWUgOiAnJyxcclxuICAgICAgZmFtaWxpYTogaGlzdCA/IGhpc3QuZmFtaWxpYSA6ICcoc2luIG1hdGNoKScsXHJcbiAgICAgIHN1YmZhbWlsaWE6IGhpc3QgPyBoaXN0LnN1YmZhbWlsaWEgOiAnKHNpbiBtYXRjaCknLFxyXG4gICAgICB2ZW50YXMxMm06IHZlbnRhczEybSxcclxuICAgICAgcGVkaWRvNm06IHNwLnBlZGlkb1RvdGFsLFxyXG4gICAgICBwcm9tZWRpbzogcHJvbWVkaW8sXHJcbiAgICAgIHBvbGl0aWNhOiBwb2xpdGljYSxcclxuICAgICAgdG90YWw6IHRvdGFsLFxyXG4gICAgICBoYXNIaXN0b3JpYTogISFoaXN0LFxyXG4gICAgfSk7XHJcbiAgfVxyXG4gIHJldHVybiByb3dzO1xyXG59XHJcblxyXG5mdW5jdGlvbiBfcmVuZGVyTW9kYWxTaGVsbCgpIHtcclxuICBjb25zdCBleGlzdGluZyA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdmb3JlY2FzdC1tb2RhbCcpO1xyXG4gIGlmIChleGlzdGluZykgcmV0dXJuIGV4aXN0aW5nO1xyXG4gIGNvbnN0IGVsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2Jyk7XHJcbiAgZWwuaWQgPSAnZm9yZWNhc3QtbW9kYWwnO1xyXG4gIGVsLmNsYXNzTmFtZSA9ICdtb2RhbC1vdmVybGF5JztcclxuICBlbC5zdHlsZS5jc3NUZXh0ID1cclxuICAgICdkaXNwbGF5Om5vbmU7cG9zaXRpb246Zml4ZWQ7aW5zZXQ6MDtiYWNrZ3JvdW5kOnJnYmEoMTUsMjMsNDIsLjYpO3otaW5kZXg6MjA1MDsnO1xyXG4gIGVsLm9uY2xpY2sgPSBmdW5jdGlvbiAoZXYpIHtcclxuICAgIGlmIChldi50YXJnZXQgPT09IGVsKSB3aW5kb3cuY2xvc2VGb3JlY2FzdE1vZGFsKCk7XHJcbiAgfTtcclxuICBlbC5pbm5lckhUTUwgPVxyXG4gICAgJycgK1xyXG4gICAgJzxkaXYgc3R5bGU9XCJwb3NpdGlvbjphYnNvbHV0ZTtpbnNldDoxdmggMXZ3O2JhY2tncm91bmQ6I2ZmZjtib3JkZXItcmFkaXVzOjEwcHg7ZGlzcGxheTpmbGV4O2ZsZXgtZGlyZWN0aW9uOmNvbHVtbjtvdmVyZmxvdzpoaWRkZW47Ym94LXNoYWRvdzowIDIwcHggNTBweCByZ2JhKDAsMCwwLC4zNSlcIj4nICtcclxuICAgICc8ZGl2IHN0eWxlPVwicGFkZGluZzoxMnB4IDE4cHg7YmFja2dyb3VuZDojMGYxNzJhO2NvbG9yOiNmZmY7ZGlzcGxheTpmbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtnYXA6MTJweFwiPicgK1xyXG4gICAgJzxkaXYgc3R5bGU9XCJmbGV4OjFcIj4nICtcclxuICAgICc8ZGl2IHN0eWxlPVwiZm9udC1zaXplOjE2cHg7Zm9udC13ZWlnaHQ6ODAwO2xldHRlci1zcGFjaW5nOi41cHhcIj5GT1JFQ0FTVDwvZGl2PicgK1xyXG4gICAgJzxkaXYgaWQ9XCJmb3JlY2FzdC1zdWJ0aXRsZVwiIHN0eWxlPVwiZm9udC1zaXplOjExcHg7b3BhY2l0eTouODttYXJnaW4tdG9wOjJweFwiPkNhcmdhciBTYWxlcyBQbGFuIHBhcmEgdmVyIGxhIHByb3llY2Npb24gdnMgcG9saXRpY2EgZGUgaW52ZW50YXJpbyAoMyBtZXNlcyk8L2Rpdj4nICtcclxuICAgICc8L2Rpdj4nICtcclxuICAgICc8YnV0dG9uIGlkPVwiZm9yZWNhc3QtZXhwb3J0LWJ0blwiIG9uY2xpY2s9XCJleHBvcnRGb3JlY2FzdEV4Y2VsKClcIiBkaXNhYmxlZCBzdHlsZT1cInBhZGRpbmc6OHB4IDE0cHg7YmFja2dyb3VuZDojMTY2NTM0O2NvbG9yOiNmZmY7Ym9yZGVyOm5vbmU7Ym9yZGVyLXJhZGl1czo2cHg7Zm9udC13ZWlnaHQ6NzAwO2N1cnNvcjpwb2ludGVyO29wYWNpdHk6LjVcIj5FeHBvcnRhciBFeGNlbDwvYnV0dG9uPicgK1xyXG4gICAgJzxidXR0b24gb25jbGljaz1cImNsb3NlRm9yZWNhc3RNb2RhbCgpXCIgc3R5bGU9XCJiYWNrZ3JvdW5kOnRyYW5zcGFyZW50O2NvbG9yOiNmZmY7Ym9yZGVyOjFweCBzb2xpZCByZ2JhKDI1NSwyNTUsMjU1LC40KTtib3JkZXItcmFkaXVzOjZweDtwYWRkaW5nOjZweCAxMHB4O2N1cnNvcjpwb2ludGVyO2ZvbnQtd2VpZ2h0OjcwMFwiPkNlcnJhcjwvYnV0dG9uPicgK1xyXG4gICAgJzwvZGl2PicgK1xyXG4gICAgJzxkaXYgc3R5bGU9XCJwYWRkaW5nOjEycHggMThweDtiYWNrZ3JvdW5kOiNmOGZhZmM7Ym9yZGVyLWJvdHRvbToxcHggc29saWQgI2UyZThmMDtkaXNwbGF5OmZsZXg7ZmxleC13cmFwOndyYXA7Z2FwOjE0cHg7YWxpZ24taXRlbXM6Y2VudGVyXCI+JyArXHJcbiAgICAnPGxhYmVsIHN0eWxlPVwiZGlzcGxheTppbmxpbmUtZmxleDthbGlnbi1pdGVtczpjZW50ZXI7Z2FwOjhweDtwYWRkaW5nOjhweCAxMnB4O2JhY2tncm91bmQ6IzBkOTQ4ODtjb2xvcjojZmZmO2JvcmRlci1yYWRpdXM6NnB4O2ZvbnQtd2VpZ2h0OjcwMDtmb250LXNpemU6MTJweDtjdXJzb3I6cG9pbnRlclwiPicgK1xyXG4gICAgJzxzcGFuPkNhcmdhciBTYWxlcyBQbGFuICgueGxzeCk8L3NwYW4+JyArXHJcbiAgICAnPGlucHV0IHR5cGU9XCJmaWxlXCIgYWNjZXB0PVwiLnhsc3gsLnhsc1wiIHN0eWxlPVwiZGlzcGxheTpub25lXCIgb25jaGFuZ2U9XCJvbkZvcmVjYXN0U2FsZXNQbGFuRmlsZShldmVudClcIi8+JyArXHJcbiAgICAnPC9sYWJlbD4nICtcclxuICAgICc8ZGl2IGlkPVwiZm9yZWNhc3QtaGludFwiIHN0eWxlPVwiZm9udC1zaXplOjExcHg7Y29sb3I6IzY0NzQ4YjttYXgtd2lkdGg6NTIwcHhcIj5FeGNlbCBlc3BlcmFkbzogcHJpbWVyYSBjb2x1bW5hIDxiPlNLVTwvYj4sIGx1ZWdvIDYgY29sdW1uYXMgY29uIGxhcyB1bmlkYWRlcyBwZWRpZGFzIG1lcyBhIG1lcyBwYXJhIGxvcyBwcm94aW1vcyA2IG1lc2VzLiBMb3MgaGVhZGVycyBkZSBsb3MgbWVzZXMgcHVlZGVuIHNlciBjdWFscXVpZXIgbm9tYnJlIChNZXMxLi5NZXM2LCBhZ28tMjYuLmVuZS0yNywgZXRjKS48L2Rpdj4nICtcclxuICAgICc8ZGl2IGlkPVwiZm9yZWNhc3Qtc3RhdHNcIiBzdHlsZT1cIm1hcmdpbi1sZWZ0OmF1dG87Zm9udC1zaXplOjExcHg7Y29sb3I6IzQ3NTU2OTtmb250LXdlaWdodDo2MDBcIj48L2Rpdj4nICtcclxuICAgICc8L2Rpdj4nICtcclxuICAgICc8ZGl2IGlkPVwiZm9yZWNhc3QtYm9keVwiIHN0eWxlPVwiZmxleDoxO292ZXJmbG93OmF1dG87cGFkZGluZzowXCI+JyArXHJcbiAgICAnPGRpdiBzdHlsZT1cInBhZGRpbmc6NjBweCAyMHB4O3RleHQtYWxpZ246Y2VudGVyO2NvbG9yOiM5NGEzYjg7Zm9udC1zaXplOjE0cHhcIj5Fc3BlcmFuZG8gYXJjaGl2byBTYWxlcyBQbGFuLi4uPC9kaXY+JyArXHJcbiAgICAnPC9kaXY+JyArXHJcbiAgICAnPC9kaXY+JztcclxuICBkb2N1bWVudC5ib2R5LmFwcGVuZENoaWxkKGVsKTtcclxuICByZXR1cm4gZWw7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIF9yZW5kZXJUYWJsZShyb3dzKSB7XHJcbiAgY29uc3QgYm9keSA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdmb3JlY2FzdC1ib2R5Jyk7XHJcbiAgaWYgKCFib2R5KSByZXR1cm47XHJcbiAgaWYgKCFyb3dzIHx8ICFyb3dzLmxlbmd0aCkge1xyXG4gICAgYm9keS5pbm5lckhUTUwgPVxyXG4gICAgICAnPGRpdiBzdHlsZT1cInBhZGRpbmc6NjBweCAyMHB4O3RleHQtYWxpZ246Y2VudGVyO2NvbG9yOiM5NGEzYjhcIj5TYWxlcyBQbGFuIHZhY2lvIG8gc2luIGZpbGFzIHZhbGlkYXMuPC9kaXY+JztcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgY29uc3QgZm10ID0gKG4pID0+XHJcbiAgICBuID09PSAwIHx8ICFOdW1iZXIuaXNGaW5pdGUobilcclxuICAgICAgPyAnMCdcclxuICAgICAgOiBOdW1iZXIobikudG9Mb2NhbGVTdHJpbmcoJ2VzLUFSJywgeyBtYXhpbXVtRnJhY3Rpb25EaWdpdHM6IDEgfSk7XHJcbiAgY29uc3QgY29sb3JGb3JUb3RhbCA9ICh0KSA9PiB7XHJcbiAgICBpZiAodCA+IDApIHJldHVybiAnIzE2NjUzNCc7IC8vIHNvYnJhIChwZWRpc3RlIG1hcyBxdWUgbGEgcG9saXRpY2EpIC0gdmVyZGVcclxuICAgIGlmICh0IDwgMCkgcmV0dXJuICcjYzI0MTBjJzsgLy8gZmFsdGEgKHBlZGlzdGUgbWVub3MgcXVlIGxhIHBvbGl0aWNhKSAtIG5hcmFuamEgdXJnZW50ZVxyXG4gICAgcmV0dXJuICcjNDc1NTY5JztcclxuICB9O1xyXG4gIGNvbnN0IHJvd3NIdG1sID0gcm93c1xyXG4gICAgLm1hcChcclxuICAgICAgKHIpID0+XHJcbiAgICAgICAgJycgK1xyXG4gICAgICAgICc8dHInICtcclxuICAgICAgICAoci5oYXNIaXN0b3JpYSA/ICcnIDogJyBzdHlsZT1cImJhY2tncm91bmQ6I2ZlZjNjN1wiJykgK1xyXG4gICAgICAgICc+JyArXHJcbiAgICAgICAgJzx0ZCBzdHlsZT1cInBhZGRpbmc6NnB4IDEwcHg7Zm9udC1mYW1pbHk6bW9ub3NwYWNlO2ZvbnQtc2l6ZToxMXB4O3doaXRlLXNwYWNlOm5vd3JhcFwiPicgK1xyXG4gICAgICAgIGVzY2FwZUh0bWxTYWZlKHIuc2t1KSArXHJcbiAgICAgICAgJzwvdGQ+JyArXHJcbiAgICAgICAgJzx0ZCBzdHlsZT1cInBhZGRpbmc6NnB4IDEwcHg7Zm9udC1zaXplOjExcHhcIj4nICtcclxuICAgICAgICBlc2NhcGVIdG1sU2FmZShyLmZhbWlsaWEpICtcclxuICAgICAgICAnPC90ZD4nICtcclxuICAgICAgICAnPHRkIHN0eWxlPVwicGFkZGluZzo2cHggMTBweDtmb250LXNpemU6MTFweFwiPicgK1xyXG4gICAgICAgIGVzY2FwZUh0bWxTYWZlKHIuc3ViZmFtaWxpYSkgK1xyXG4gICAgICAgICc8L3RkPicgK1xyXG4gICAgICAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjZweCAxMHB4O3RleHQtYWxpZ246cmlnaHQ7Zm9udC12YXJpYW50LW51bWVyaWM6dGFidWxhci1udW1zXCI+JyArXHJcbiAgICAgICAgZm10KHIudmVudGFzMTJtKSArXHJcbiAgICAgICAgJzwvdGQ+JyArXHJcbiAgICAgICAgJzx0ZCBzdHlsZT1cInBhZGRpbmc6NnB4IDEwcHg7dGV4dC1hbGlnbjpyaWdodDtmb250LXZhcmlhbnQtbnVtZXJpYzp0YWJ1bGFyLW51bXM7Zm9udC13ZWlnaHQ6NjAwXCI+JyArXHJcbiAgICAgICAgZm10KHIucGVkaWRvNm0pICtcclxuICAgICAgICAnPC90ZD4nICtcclxuICAgICAgICAnPHRkIHN0eWxlPVwicGFkZGluZzo2cHggMTBweDt0ZXh0LWFsaWduOnJpZ2h0O2ZvbnQtdmFyaWFudC1udW1lcmljOnRhYnVsYXItbnVtcztjb2xvcjojNjQ3NDhiXCI+JyArXHJcbiAgICAgICAgZm10KHIucHJvbWVkaW8pICtcclxuICAgICAgICAnPC90ZD4nICtcclxuICAgICAgICAnPHRkIHN0eWxlPVwicGFkZGluZzo2cHggMTBweDt0ZXh0LWFsaWduOnJpZ2h0O2ZvbnQtdmFyaWFudC1udW1lcmljOnRhYnVsYXItbnVtc1wiPicgK1xyXG4gICAgICAgIGZtdChyLnBvbGl0aWNhKSArXHJcbiAgICAgICAgJzwvdGQ+JyArXHJcbiAgICAgICAgJzx0ZCBzdHlsZT1cInBhZGRpbmc6NnB4IDEwcHg7dGV4dC1hbGlnbjpyaWdodDtmb250LXZhcmlhbnQtbnVtZXJpYzp0YWJ1bGFyLW51bXM7Zm9udC13ZWlnaHQ6NzAwO2NvbG9yOicgK1xyXG4gICAgICAgIGNvbG9yRm9yVG90YWwoci50b3RhbCkgK1xyXG4gICAgICAgICdcIj4nICtcclxuICAgICAgICBmbXQoci50b3RhbCkgK1xyXG4gICAgICAgICc8L3RkPicgK1xyXG4gICAgICAgICc8L3RyPidcclxuICAgIClcclxuICAgIC5qb2luKCcnKTtcclxuICBjb25zdCBoZWFkZXIgPVxyXG4gICAgJycgK1xyXG4gICAgJzx0aGVhZCBzdHlsZT1cInBvc2l0aW9uOnN0aWNreTt0b3A6MDtiYWNrZ3JvdW5kOiMwZjE3MmE7Y29sb3I6I2ZmZjt6LWluZGV4OjFcIj4nICtcclxuICAgICc8dHI+JyArXHJcbiAgICAnPHRoIHN0eWxlPVwicGFkZGluZzo4cHggMTBweDt0ZXh0LWFsaWduOmxlZnQ7Zm9udC1zaXplOjExcHg7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO2xldHRlci1zcGFjaW5nOi40cHhcIj5TS1U8L3RoPicgK1xyXG4gICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6OHB4IDEwcHg7dGV4dC1hbGlnbjpsZWZ0O2ZvbnQtc2l6ZToxMXB4O3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtsZXR0ZXItc3BhY2luZzouNHB4XCI+RmFtaWxpYTwvdGg+JyArXHJcbiAgICAnPHRoIHN0eWxlPVwicGFkZGluZzo4cHggMTBweDt0ZXh0LWFsaWduOmxlZnQ7Zm9udC1zaXplOjExcHg7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO2xldHRlci1zcGFjaW5nOi40cHhcIj5TdWJmYW1pbGlhPC90aD4nICtcclxuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjhweCAxMHB4O3RleHQtYWxpZ246cmlnaHQ7Zm9udC1zaXplOjExcHg7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO2xldHRlci1zcGFjaW5nOi40cHhcIiB0aXRsZT1cIlN1bWEgZGUgcXR5IGZhY3R1cmFkYSBlbiBsb3MgdWx0aW1vcyAxMiBtZXNlcyBjb21wbGV0b3NcIj5WZW50YXMgMTJtPC90aD4nICtcclxuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjhweCAxMHB4O3RleHQtYWxpZ246cmlnaHQ7Zm9udC1zaXplOjExcHg7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO2xldHRlci1zcGFjaW5nOi40cHhcIiB0aXRsZT1cIlN1bWEgZGUgbGFzIDYgY29sdW1uYXMgZGVsIEV4Y2VsIFNhbGVzIFBsYW5cIj5QZWRpZG8gNm08L3RoPicgK1xyXG4gICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6OHB4IDEwcHg7dGV4dC1hbGlnbjpyaWdodDtmb250LXNpemU6MTFweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7bGV0dGVyLXNwYWNpbmc6LjRweFwiIHRpdGxlPVwiVmVudGFzIFlURCAvIG1lc2VzIHRyYW5zY3Vycmlkb3MgZGVsIGFcdTAwRjFvXCI+UHJvbSAvIE1lczwvdGg+JyArXHJcbiAgICAnPHRoIHN0eWxlPVwicGFkZGluZzo4cHggMTBweDt0ZXh0LWFsaWduOnJpZ2h0O2ZvbnQtc2l6ZToxMXB4O3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtsZXR0ZXItc3BhY2luZzouNHB4XCIgdGl0bGU9XCJQcm9tZWRpbyB4IDMgbWVzZXMgKHBvbGl0aWNhIGRlIGludmVudGFyaW8pXCI+UG9saXRpY2E8L3RoPicgK1xyXG4gICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6OHB4IDEwcHg7dGV4dC1hbGlnbjpyaWdodDtmb250LXNpemU6MTFweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7bGV0dGVyLXNwYWNpbmc6LjRweFwiIHRpdGxlPVwiUGVkaWRvIDZtIC0gUG9saXRpY2EuIE5lZ2F0aXZvID0gdGUgZmFsdGEgcGVkaXI7IFBvc2l0aXZvID0gc29icmVwZWRpZG9cIj5Ub3RhbDwvdGg+JyArXHJcbiAgICAnPC90cj4nICtcclxuICAgICc8L3RoZWFkPic7XHJcbiAgYm9keS5pbm5lckhUTUwgPVxyXG4gICAgJzx0YWJsZSBzdHlsZT1cIndpZHRoOjEwMCU7Ym9yZGVyLWNvbGxhcHNlOmNvbGxhcHNlO2ZvbnQtc2l6ZToxMnB4XCI+JyArXHJcbiAgICBoZWFkZXIgK1xyXG4gICAgJzx0Ym9keT4nICtcclxuICAgIHJvd3NIdG1sICtcclxuICAgICc8L3Rib2R5PjwvdGFibGU+JztcclxufVxyXG5cclxuZnVuY3Rpb24gZXNjYXBlSHRtbFNhZmUocykge1xyXG4gIGlmICh0eXBlb2Ygd2luZG93LmVzY2FwZUh0bWwgPT09ICdmdW5jdGlvbicpIHJldHVybiB3aW5kb3cuZXNjYXBlSHRtbChzKTtcclxuICByZXR1cm4gU3RyaW5nKHMgPT0gbnVsbCA/ICcnIDogcykucmVwbGFjZShcclxuICAgIC9bJjw+XCInXS9nLFxyXG4gICAgKGNoKSA9PiAoeyAnJic6ICcmYW1wOycsICc8JzogJyZsdDsnLCAnPic6ICcmZ3Q7JywgJ1wiJzogJyZxdW90OycsIFwiJ1wiOiAnJiMzOTsnIH0pW2NoXVxyXG4gICk7XHJcbn1cclxuXHJcbndpbmRvdy5vcGVuRm9yZWNhc3RNb2RhbCA9IGFzeW5jIGZ1bmN0aW9uICgpIHtcclxuICBpZiAoIV9jYW5Gb3JlY2FzdCgpKSB7XHJcbiAgICBhbGVydCgnRk9SRUNBU1QgZXMgc29sbyBwYXJhIE1hcmlhbm8gKGFkbWluKS4nKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgY29uc3QgZWwgPSBfcmVuZGVyTW9kYWxTaGVsbCgpO1xyXG4gIGVsLnN0eWxlLmRpc3BsYXkgPSAnYmxvY2snO1xyXG4gIGlmIChfZm9yZWNhc3RMb2FkaW5nKSByZXR1cm47XHJcbiAgaWYgKCFfZm9yZWNhc3RTbmFwc2hvdCkge1xyXG4gICAgX2ZvcmVjYXN0TG9hZGluZyA9IHRydWU7XHJcbiAgICBjb25zdCBzdGF0cyA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdmb3JlY2FzdC1zdGF0cycpO1xyXG4gICAgaWYgKHN0YXRzKSBzdGF0cy50ZXh0Q29udGVudCA9ICdDYXJnYW5kbyBzbmFwc2hvdCBkZSB2ZW50YXMuLi4nO1xyXG4gICAgdHJ5IHtcclxuICAgICAgYXdhaXQgX2xvYWRTbmFwc2hvdCgpO1xyXG4gICAgICBpZiAoc3RhdHMpIHN0YXRzLnRleHRDb250ZW50ID0gX2ZvcmVjYXN0U25hcHNob3QuY291bnQgKyAnIFNLVXMgZW4gc25hcHNob3QgaGlzdG9yaWNvJztcclxuICAgIH0gY2F0Y2ggKGUpIHtcclxuICAgICAgaWYgKHN0YXRzKSBzdGF0cy50ZXh0Q29udGVudCA9ICdFcnJvciBjYXJnYW5kbyBzbmFwc2hvdDogJyArICgoZSAmJiBlLm1lc3NhZ2UpIHx8IGUpO1xyXG4gICAgICBhbGVydChcclxuICAgICAgICAnTm8gc2UgcHVkbyBjYXJnYXIgc2t1X3ZlbnRhc19zbmFwc2hvdC4gQ2hlcXVlYSBxdWUgZWwgYm9vdHN0cmFwIFB5dGhvbiB5YSBoYXlhIGNvcnJpZG8gKHNjcmlwdHMvYXBwbHlfc2t1X3ZlbnRhc19zbmFwc2hvdC5weSkgeSBxdWUgdGVuZ2FzIHJvbCBhZG1pbi4nXHJcbiAgICAgICk7XHJcbiAgICB9IGZpbmFsbHkge1xyXG4gICAgICBfZm9yZWNhc3RMb2FkaW5nID0gZmFsc2U7XHJcbiAgICB9XHJcbiAgfSBlbHNlIHtcclxuICAgIGNvbnN0IHN0YXRzID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2ZvcmVjYXN0LXN0YXRzJyk7XHJcbiAgICBpZiAoc3RhdHMpIHN0YXRzLnRleHRDb250ZW50ID0gX2ZvcmVjYXN0U25hcHNob3QuY291bnQgKyAnIFNLVXMgZW4gc25hcHNob3QgaGlzdG9yaWNvJztcclxuICB9XHJcbn07XHJcblxyXG53aW5kb3cuY2xvc2VGb3JlY2FzdE1vZGFsID0gZnVuY3Rpb24gKCkge1xyXG4gIGNvbnN0IGVsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2ZvcmVjYXN0LW1vZGFsJyk7XHJcbiAgaWYgKGVsKSBlbC5zdHlsZS5kaXNwbGF5ID0gJ25vbmUnO1xyXG59O1xyXG5cclxud2luZG93Lm9uRm9yZWNhc3RTYWxlc1BsYW5GaWxlID0gYXN5bmMgZnVuY3Rpb24gKGV2ZW50KSB7XHJcbiAgY29uc3QgZmlsZSA9IGV2ZW50ICYmIGV2ZW50LnRhcmdldCAmJiBldmVudC50YXJnZXQuZmlsZXMgJiYgZXZlbnQudGFyZ2V0LmZpbGVzWzBdO1xyXG4gIGlmICghZmlsZSkgcmV0dXJuO1xyXG4gIHRyeSB7XHJcbiAgICBpZiAoIV9mb3JlY2FzdFNuYXBzaG90KSBhd2FpdCBfbG9hZFNuYXBzaG90KCk7XHJcbiAgICBjb25zdCBidWYgPSBhd2FpdCBmaWxlLmFycmF5QnVmZmVyKCk7XHJcbiAgICBpZiAodHlwZW9mIFhMU1ggPT09ICd1bmRlZmluZWQnKSB7XHJcbiAgICAgIGFsZXJ0KCdYTFNYIG5vIGNhcmdhZG8nKTtcclxuICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG4gICAgY29uc3Qgd2IgPSBYTFNYLnJlYWQoYnVmLCB7IHR5cGU6ICdhcnJheScgfSk7XHJcbiAgICBjb25zdCBzaGVldCA9IHdiLlNoZWV0c1t3Yi5TaGVldE5hbWVzWzBdXTtcclxuICAgIGNvbnN0IHJvd3MgPSBYTFNYLnV0aWxzLnNoZWV0X3RvX2pzb24oc2hlZXQsIHsgaGVhZGVyOiAxLCBkZWZ2YWw6IG51bGwsIHJhdzogdHJ1ZSB9KTtcclxuICAgIGNvbnN0IHBhcnNlZCA9IF9wYXJzZVNhbGVzUGxhblJvd3Mocm93cyk7XHJcbiAgICBpZiAoIXBhcnNlZC5sZW5ndGgpIHtcclxuICAgICAgYWxlcnQoJ0VsIEV4Y2VsIGVzdGEgdmFjaW8gbyBubyB0aWVuZSBmaWxhcyB2YWxpZGFzLicpO1xyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcbiAgICBfZm9yZWNhc3RTYWxlc1BsYW4gPSBwYXJzZWQ7XHJcbiAgICBjb25zdCBob3kgPSBuZXcgRGF0ZSgpO1xyXG4gICAgX2ZvcmVjYXN0Um93cyA9IF9jb21wdXRlRm9yZWNhc3RSb3dzKF9mb3JlY2FzdFNuYXBzaG90LCBwYXJzZWQsIGhveSk7XHJcbiAgICBfcmVuZGVyVGFibGUoX2ZvcmVjYXN0Um93cyk7XHJcbiAgICBjb25zdCBzaW5NYXRjaCA9IF9mb3JlY2FzdFJvd3MuZmlsdGVyKChyKSA9PiAhci5oYXNIaXN0b3JpYSkubGVuZ3RoO1xyXG4gICAgY29uc3Qgc3RhdHMgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZm9yZWNhc3Qtc3RhdHMnKTtcclxuICAgIGlmIChzdGF0cykge1xyXG4gICAgICBzdGF0cy50ZXh0Q29udGVudCA9XHJcbiAgICAgICAgcGFyc2VkLmxlbmd0aCArXHJcbiAgICAgICAgJyBTS1VzIGVuIFNhbGVzIFBsYW4gXHUwMEI3ICcgK1xyXG4gICAgICAgIChwYXJzZWQubGVuZ3RoIC0gc2luTWF0Y2gpICtcclxuICAgICAgICAnIGNvbiBoaXN0b3JpYSBcdTAwQjcgJyArXHJcbiAgICAgICAgc2luTWF0Y2ggK1xyXG4gICAgICAgICcgc2luIG1hdGNoIChmb25kbyBhbWFyaWxsbyknO1xyXG4gICAgfVxyXG4gICAgY29uc3QgYnRuID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2ZvcmVjYXN0LWV4cG9ydC1idG4nKTtcclxuICAgIGlmIChidG4pIHtcclxuICAgICAgYnRuLmRpc2FibGVkID0gZmFsc2U7XHJcbiAgICAgIGJ0bi5zdHlsZS5vcGFjaXR5ID0gJzEnO1xyXG4gICAgfVxyXG4gIH0gY2F0Y2ggKGUpIHtcclxuICAgIGNvbnNvbGUuZXJyb3IoJ1tGT1JFQ0FTVF0gcGFyc2UgZXJyb3I6JywgZSk7XHJcbiAgICBhbGVydCgnRXJyb3IgcHJvY2VzYW5kbyBlbCBFeGNlbDpcXG4nICsgKChlICYmIGUubWVzc2FnZSkgfHwgZSkpO1xyXG4gIH0gZmluYWxseSB7XHJcbiAgICAvLyBSZXNldCBpbnB1dCBwYXJhIHF1ZSBlbCBtaXNtbyBhcmNoaXZvIHNlIHB1ZWRhIHJlLXN1YmlyXHJcbiAgICBpZiAoZXZlbnQgJiYgZXZlbnQudGFyZ2V0KSBldmVudC50YXJnZXQudmFsdWUgPSAnJztcclxuICB9XHJcbn07XHJcblxyXG53aW5kb3cuZXhwb3J0Rm9yZWNhc3RFeGNlbCA9IGZ1bmN0aW9uICgpIHtcclxuICBpZiAoIV9mb3JlY2FzdFJvd3MgfHwgIV9mb3JlY2FzdFJvd3MubGVuZ3RoKSB7XHJcbiAgICBhbGVydCgnTm8gaGF5IGRhdG9zIHBhcmEgZXhwb3J0YXIuIENhcmdhIHByaW1lcm8gZWwgU2FsZXMgUGxhbi4nKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgaWYgKHR5cGVvZiBYTFNYID09PSAndW5kZWZpbmVkJykge1xyXG4gICAgYWxlcnQoJ1hMU1ggbm8gY2FyZ2FkbycpO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuICBjb25zdCByb3VuZDEgPSAobikgPT4gTWF0aC5yb3VuZChOdW1iZXIobiB8fCAwKSAqIDEwKSAvIDEwO1xyXG4gIGNvbnN0IGFvYSA9IFtcclxuICAgIFtcclxuICAgICAgJ1NLVScsXHJcbiAgICAgICdGQU1JTElBJyxcclxuICAgICAgJ1NVQkZBTUlMSUEnLFxyXG4gICAgICAnVkVOVEFTICgxMm0pJyxcclxuICAgICAgJ1BFRElETy1TQUxFUyBQTEFOUyAoNm0pJyxcclxuICAgICAgJ1BST01FRElPIERFIElOVkVOVEFSSU8nLFxyXG4gICAgICAnUE9MSVRJQ0EgREUgSU5WRU5UQVJJTyAoM20pJyxcclxuICAgICAgJ1RPVEFMJyxcclxuICAgIF0sXHJcbiAgXTtcclxuICBmb3IgKGNvbnN0IHIgb2YgX2ZvcmVjYXN0Um93cykge1xyXG4gICAgYW9hLnB1c2goW1xyXG4gICAgICByLnNrdSxcclxuICAgICAgci5mYW1pbGlhLFxyXG4gICAgICByLnN1YmZhbWlsaWEsXHJcbiAgICAgIHJvdW5kMShyLnZlbnRhczEybSksXHJcbiAgICAgIHJvdW5kMShyLnBlZGlkbzZtKSxcclxuICAgICAgcm91bmQxKHIucHJvbWVkaW8pLFxyXG4gICAgICByb3VuZDEoci5wb2xpdGljYSksXHJcbiAgICAgIHJvdW5kMShyLnRvdGFsKSxcclxuICAgIF0pO1xyXG4gIH1cclxuICBjb25zdCB3cyA9IFhMU1gudXRpbHMuYW9hX3RvX3NoZWV0KGFvYSk7XHJcbiAgLy8gQW5jaG9zIGRlIGNvbHVtbmFcclxuICB3c1snIWNvbHMnXSA9IFtcclxuICAgIHsgd2NoOiAxOCB9LFxyXG4gICAgeyB3Y2g6IDI0IH0sXHJcbiAgICB7IHdjaDogMjQgfSxcclxuICAgIHsgd2NoOiAxNCB9LFxyXG4gICAgeyB3Y2g6IDIwIH0sXHJcbiAgICB7IHdjaDogMjAgfSxcclxuICAgIHsgd2NoOiAyMiB9LFxyXG4gICAgeyB3Y2g6IDEyIH0sXHJcbiAgXTtcclxuICBjb25zdCB3YiA9IFhMU1gudXRpbHMuYm9va19uZXcoKTtcclxuICBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KHdiLCB3cywgJ0ZPUkVDQVNUJyk7XHJcbiAgY29uc3QgaG95ID0gbmV3IERhdGUoKTtcclxuICBjb25zdCBzdGFtcCA9XHJcbiAgICBob3kuZ2V0RnVsbFllYXIoKSArXHJcbiAgICAnLScgK1xyXG4gICAgU3RyaW5nKGhveS5nZXRNb250aCgpICsgMSkucGFkU3RhcnQoMiwgJzAnKSArXHJcbiAgICAnLScgK1xyXG4gICAgU3RyaW5nKGhveS5nZXREYXRlKCkpLnBhZFN0YXJ0KDIsICcwJyk7XHJcbiAgWExTWC53cml0ZUZpbGUod2IsICdGb3JlY2FzdF9TaGltYW5vXycgKyBzdGFtcCArICcueGxzeCcpO1xyXG59O1xyXG5cclxuLy8gUmVmcmVzaCBwdWJsaWNvIChwb3Igc2kgZWwgdXNlciBuZWNlc2l0YSByZS1mZXRjaGVhciBlbCBzbmFwc2hvdCBzaW4gY2VycmFyXHJcbi8vIGVsIG1vZGFsLCBlajogcGFzYXJvbiAzMCBtaW4geSBlbCBjcm9uIEJRIGFjdHVhbGl6byBsYSBjb2xlY2Npb24pLlxyXG53aW5kb3cucmVsb2FkRm9yZWNhc3RTbmFwc2hvdCA9IGFzeW5jIGZ1bmN0aW9uICgpIHtcclxuICBfZm9yZWNhc3RTbmFwc2hvdCA9IG51bGw7XHJcbiAgYXdhaXQgX2xvYWRTbmFwc2hvdCgpO1xyXG4gIGlmIChfZm9yZWNhc3RTYWxlc1BsYW4pIHtcclxuICAgIGNvbnN0IGhveSA9IG5ldyBEYXRlKCk7XHJcbiAgICBfZm9yZWNhc3RSb3dzID0gX2NvbXB1dGVGb3JlY2FzdFJvd3MoX2ZvcmVjYXN0U25hcHNob3QsIF9mb3JlY2FzdFNhbGVzUGxhbiwgaG95KTtcclxuICAgIF9yZW5kZXJUYWJsZShfZm9yZWNhc3RSb3dzKTtcclxuICB9XHJcbn07XHJcbiJdLAogICJtYXBwaW5ncyI6ICI7OztBQTRCQSxNQUFJLG9CQUFvQjtBQUN4QixNQUFJLHFCQUFxQjtBQUN6QixNQUFJLGdCQUFnQjtBQUNwQixNQUFJLG1CQUFtQjtBQUt2QixNQUFNLDBCQUEwQixDQUFDLGlDQUFpQyx5QkFBeUI7QUFFM0YsV0FBUyxlQUFlO0FBQ3RCLFFBQUk7QUFDRixZQUFNLFNBQVUsT0FBTyxlQUFlLE9BQU8sWUFBWSxTQUFVLElBQUksWUFBWTtBQUNuRixVQUFJLENBQUMsTUFBTyxRQUFPO0FBQ25CLGFBQU8sd0JBQXdCLFFBQVEsS0FBSyxLQUFLO0FBQUEsSUFDbkQsUUFBUTtBQUNOLGFBQU87QUFBQSxJQUNUO0FBQUEsRUFDRjtBQUdBLFdBQVMsVUFBVSxNQUFNLGVBQWU7QUFDdEMsV0FBTyxPQUFPLElBQUksRUFBRSxTQUFTLEdBQUcsR0FBRyxJQUFJLE1BQU0sT0FBTyxhQUFhLEVBQUUsU0FBUyxHQUFHLEdBQUc7QUFBQSxFQUNwRjtBQW9CQSxXQUFTLFdBQVcsTUFBTSxlQUFlLE9BQU87QUFDOUMsVUFBTSxjQUFjLE9BQU8sTUFBTSxnQkFBZ0IsS0FBSztBQUN0RCxVQUFNLElBQUksS0FBSyxNQUFNLGNBQWMsRUFBRTtBQUNyQyxVQUFNLElBQUssY0FBYyxLQUFNO0FBQy9CLFdBQU8sRUFBRSxHQUFHLEVBQUU7QUFBQSxFQUNoQjtBQUtBLFdBQVMsdUJBQXVCLFVBQVUsS0FBSztBQUM3QyxRQUFJLENBQUMsU0FBVSxRQUFPO0FBQ3RCLFFBQUksTUFBTTtBQUNWLFVBQU0sYUFBYSxXQUFXLElBQUksWUFBWSxHQUFHLElBQUksU0FBUyxJQUFJLEdBQUcsR0FBRztBQUN4RSxVQUFNLFdBQVcsV0FBVyxJQUFJLFlBQVksR0FBRyxJQUFJLFNBQVMsSUFBSSxHQUFH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
