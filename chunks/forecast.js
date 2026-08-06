"use strict";
(() => {
  // src/domains/forecast.js
  var _forecastSnapshot = null;
  var _forecastSalesPlan = null;
  var _forecastRows = null;
  var _forecastLoading = false;
  var FORECAST_ALLOWED_EMAILS = [
    "mariano.erbino@shimano.com.ar",
    "erbinomariano@gmail.com"
  ];
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
    if (skuColIdx < 0) throw new Error('El Excel debe tener una columna llamada "SKU" (o Codigo / ItemCode / Item)');
    const monthCols = [];
    for (let i = 0; i < headerRow.length && monthCols.length < 6; i++) {
      if (i !== skuColIdx) monthCols.push(i);
    }
    if (monthCols.length < 6) throw new Error("El Excel debe tener al menos 6 columnas de meses ademas de SKU (encontradas: " + monthCols.length + ")");
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
        return isFinite(n) ? n : 0;
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
    const fmt = (n) => n === 0 || !isFinite(n) ? "0" : Number(n).toLocaleString("es-AR", { maximumFractionDigits: 1 });
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
    return String(s == null ? "" : s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
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
        alert("No se pudo cargar sku_ventas_snapshot. Chequea que el bootstrap Python ya haya corrido (scripts/apply_sku_ventas_snapshot.py) y que tengas rol admin.");
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
    const aoa = [[
      "SKU",
      "FAMILIA",
      "SUBFAMILIA",
      "VENTAS (12m)",
      "PEDIDO-SALES PLANS (6m)",
      "PROMEDIO DE INVENTARIO",
      "POLITICA DE INVENTARIO (3m)",
      "TOTAL"
    ]];
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL2RvbWFpbnMvZm9yZWNhc3QuanMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbIi8vIEZPUkVDQVNUIC0gbW9kYWwgYWRtaW4tb25seSAoTWFyaWFubykgcXVlIGNvbXBhcmEgdmVudGFzIGhpc3RvcmljYXNcbi8vIChGaXJlc3RvcmUgc2t1X3ZlbnRhc19zbmFwc2hvdCwgYWxpbWVudGFkbyBwb3Igc3luYyBCUSB2X3ZlbnRhc19saW5lYXNcbi8vIHZlbnRhbmEgMTNtKSB2cyBTYWxlcyBQbGFuIGNhcmdhZG8gcG9yIGVsIHVzZXIgdmlhIEV4Y2VsICsgcG9saXRpY2EgZGVcbi8vIGludmVudGFyaW8gKHByb21lZGlvIFlURCB4IDMgbWVzZXMpLlxuLy9cbi8vIENodW5rIGxhenk6IHNlIGNhcmdhIHNvbG8gYWwgcHJpbWVyIGNsaWNrIGRlbCBib3RvbiBGT1JFQ0FTVCBkZWwgaGVhZGVyLlxuLy8gUmVnaXN0cmFkbyBlbiBidWlsZC5qcyBMQVpZX0NIVU5LUyArIHNyYy9tYWluLmpzIGluc3RhbGxDaHVua1N0dWJzICsgc3cuanNcbi8vIFNUQVRJQ19BU1NFVFMuIFZlciBDTEFVREUubWQgIzE4ICgzIGx1Z2FyZXMgc2luY3Jvbml6YWRvcykuXG4vL1xuLy8gQ29udHJhdG8gZGVsIEV4Y2VsIFNhbGVzIFBsYW4gcXVlIHN1YmUgZWwgdXNlcjpcbi8vICAgQ29sdW1uYXM6IFNLVSB8IE1lczEgfCBNZXMyIHwgTWVzMyB8IE1lczQgfCBNZXM1IHwgTWVzNlxuLy8gICAobm9tYnJlcyBleGFjdG9zIGRlIGhlYWRlcnMgY2FzZS1pbnNlbnNpdGl2ZTsgTWVzMS4uNiBzb24gbG9zIHByb3hpbW9zXG4vLyAgIDYgbWVzZXMgZGVzZGUgZWwgbWVzIGFjdHVhbCkuIFVuYSBmaWxhIHBvciBTS1UuXG4vL1xuLy8gRnVlbnRlIGRlIGRhdG9zIGhpc3RvcmljYXM6XG4vLyAgIEZpcmVzdG9yZSAvc2t1X3ZlbnRhc19zbmFwc2hvdC97U0tVXzxza3Vfc2FuZWFkbz59XG4vLyAgIHtcbi8vICAgICBza3UsIGl0ZW1OYW1lLCBmYW1pbGlhLCBzdWJmYW1pbGlhLFxuLy8gICAgIG1lc2VzOiB7ICcyMDI1LTA4Jzoge3F0eSwgYXJzfSwgLi4uLCAnMjAyNi0wOCc6IHtxdHksIGFyc30gfVxuLy8gICB9XG4vLyAgIFJ1bGVzOiByZWFkIGFkbWluLW9ubHkgKGNvbXBldGl0aXZlbHkgc2Vuc2l0aXZlKS4gRXNjcml0byBwb3IgY3JvblxuLy8gICBzeW5jX3NhcF90b19iaWdxdWVyeS5weSBjYWRhIDMwIG1pbi5cblxuLy8gRXN0YWRvIGRlbCBtb2RhbCAoaW50cmEtY2h1bmssIG5vIGNyb3NzLXNjb3BlKS5cbmxldCBfZm9yZWNhc3RTbmFwc2hvdCA9IG51bGw7ICAgIC8vIHsgU0tVOiB7ZmFtaWxpYSwgc3ViZmFtaWxpYSwgaXRlbU5hbWUsIG1lc2VzfSB9XG5sZXQgX2ZvcmVjYXN0U2FsZXNQbGFuID0gbnVsbDsgICAvLyBbeyBza3UsIHBlZGlkb1RvdGFsLCBtZXNlc0FycjogW24xLi5uNl0gfV1cbmxldCBfZm9yZWNhc3RSb3dzID0gbnVsbDsgICAgICAgIC8vIGZpbGFzIGZpbmFsZXMgY2FsY3VsYWRhcyBwYXJhIHByZXZpZXcgKyBleHBvcnRcbmxldCBfZm9yZWNhc3RMb2FkaW5nID0gZmFsc2U7XG5cbi8vIFdoaXRlbGlzdCBkZSBlbWFpbHMgY29uIGFjY2VzbyBhbCBtb2RhbCBGT1JFQ0FTVC4gUmVwbGljYSBlbCBwYXRyb24gZGVcbi8vIFwiQW5hbGlzaXNcIiAoaW5kZXguaHRtbDoxMjYyNSkuIFNvbG8gTWFyaWFubzsgc2kgb3RybyBhZG1pbiBsbyBuZWNlc2l0YVxuLy8gc2UgYWdyZWdhIGFjYSBleHBsaWNpdG8uXG5jb25zdCBGT1JFQ0FTVF9BTExPV0VEX0VNQUlMUyA9IFtcbiAgJ21hcmlhbm8uZXJiaW5vQHNoaW1hbm8uY29tLmFyJyxcbiAgJ2VyYmlub21hcmlhbm9AZ21haWwuY29tJyxcbl07XG5cbmZ1bmN0aW9uIF9jYW5Gb3JlY2FzdCgpIHtcbiAgdHJ5IHtcbiAgICBjb25zdCBlbWFpbCA9ICh3aW5kb3cuY3VycmVudFVzZXIgJiYgd2luZG93LmN1cnJlbnRVc2VyLmVtYWlsIHx8ICcnKS50b0xvd2VyQ2FzZSgpO1xuICAgIGlmICghZW1haWwpIHJldHVybiBmYWxzZTtcbiAgICByZXR1cm4gRk9SRUNBU1RfQUxMT1dFRF9FTUFJTFMuaW5kZXhPZihlbWFpbCkgPj0gMDtcbiAgfSBjYXRjaCB7IHJldHVybiBmYWxzZTsgfVxufVxuXG4vLyBIZWxwZXJzIGRlIG1lcyBjYWxlbmRhci5cbmZ1bmN0aW9uIF9tb250aEtleSh5ZWFyLCBtb250aE9uZUJhc2VkKSB7XG4gIHJldHVybiBTdHJpbmcoeWVhcikucGFkU3RhcnQoNCwgJzAnKSArICctJyArIFN0cmluZyhtb250aE9uZUJhc2VkKS5wYWRTdGFydCgyLCAnMCcpO1xufVxuZnVuY3Rpb24gX21vbnRoTGFiZWwoa2V5KSB7XG4gIC8vICcyMDI2LTA4JyAtPiAnYWdvLTI2J1xuICBjb25zdCBbeSwgbV0gPSBrZXkuc3BsaXQoJy0nKS5tYXAoTnVtYmVyKTtcbiAgY29uc3QgbmFtZXMgPSBbJ2VuZScsICdmZWInLCAnbWFyJywgJ2FicicsICdtYXknLCAnanVuJywgJ2p1bCcsICdhZ28nLCAnc2VwJywgJ29jdCcsICdub3YnLCAnZGljJ107XG4gIHJldHVybiBuYW1lc1ttIC0gMV0gKyAnLScgKyBTdHJpbmcoeSkuc2xpY2UoLTIpO1xufVxuZnVuY3Rpb24gX2FkZE1vbnRocyh5ZWFyLCBtb250aE9uZUJhc2VkLCBkZWx0YSkge1xuICBjb25zdCB0b3RhbE1vbnRocyA9ICh5ZWFyICogMTIgKyAobW9udGhPbmVCYXNlZCAtIDEpKSArIGRlbHRhO1xuICBjb25zdCB5ID0gTWF0aC5mbG9vcih0b3RhbE1vbnRocyAvIDEyKTtcbiAgY29uc3QgbSA9ICh0b3RhbE1vbnRocyAlIDEyKSArIDE7XG4gIHJldHVybiB7IHksIG0gfTtcbn1cblxuLy8gU3VtYSBxdHkgZGVsIFNLVSBlbiBsb3MgdWx0aW1vcyAxMiBNRVNFUyBDT01QTEVUT1MgKGV4Y2x1eWUgZWwgbWVzIGFjdHVhbFxuLy8gcGFyY2lhbCAtIGxhIHZlbnRhbmEgbW92aWwgXCIxMiBtZXNlcyBjZXJyYWRvc1wiIHF1ZSBlbCB1c2VyIHBpZW5zYSBjb21vXG4vLyBcImVsIGFcdTAwRjFvIHF1ZSB5YSBwYXNvXCIpLiBFamVtcGxvIGVuIGFnb3N0byAyMDI2OiBzdW1hciBhZ28tMjUgYSBqdWwtMjYuXG5mdW5jdGlvbiBfc3VtVmVudGFzMTJtQ29tcGxldG9zKG1lc2VzTWFwLCBob3kpIHtcbiAgaWYgKCFtZXNlc01hcCkgcmV0dXJuIDA7XG4gIGxldCBzdW0gPSAwO1xuICBjb25zdCBzdGFydE1vbnRoID0gX2FkZE1vbnRocyhob3kuZ2V0RnVsbFllYXIoKSwgaG95LmdldE1vbnRoKCkgKyAxLCAtMTIpO1xuICBjb25zdCBlbmRNb250aCAgID0gX2FkZE1vbnRocyhob3kuZ2V0RnVsbFllYXIoKSwgaG95LmdldE1vbnRoKCkgKyAxLCAtMSk7XG4gIGNvbnN0IHN0YXJ0S2V5ID0gX21vbnRoS2V5KHN0YXJ0TW9udGgueSwgc3RhcnRNb250aC5tKTtcbiAgY29uc3QgZW5kS2V5ICAgPSBfbW9udGhLZXkoZW5kTW9udGgueSwgICBlbmRNb250aC5tKTtcbiAgZm9yIChjb25zdCBrIG9mIE9iamVjdC5rZXlzKG1lc2VzTWFwKSkge1xuICAgIGlmIChrID49IHN0YXJ0S2V5ICYmIGsgPD0gZW5kS2V5KSB7XG4gICAgICBzdW0gKz0gTnVtYmVyKG1lc2VzTWFwW2tdICYmIG1lc2VzTWFwW2tdLnF0eSB8fCAwKTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHN1bTtcbn1cblxuLy8gU3VtYSBxdHkgZGVsIFNLVSBZVEQgKGVuZXJvIGRlbCBhXHUwMEYxbyBhY3R1YWwgaGFzdGEgbWVzIGFjdHVhbCBJTkNMVVNJVk8sXG4vLyBhdW5xdWUgZWwgbWVzIGFjdHVhbCBzZWEgcGFyY2lhbCkuIFJldG9ybmEgeyB0b3RhbFl0ZCwgbWVzZXNUcmFuc2N1cnJpZG9zIH0uXG4vLyBFamVtcGxvIGFnb3N0byAyMDI2IGNvbiB2ZW50YXMganVsPTEwICsgYWdvPTIwIC0+IHszMCwgOH0sIHByb21lZGlvPTMwLzg9My43NS5cbi8vIChTaSBlbCB1c3VhcmlvIGVzcGVyYWJhIGRpdmlkaXIgcG9yIDIgZW4gdmV6IGRlIDgsIHJldmlzYXIgc3BlYy4gRWwgcGVkaWRvXG4vLyBkaWNlIFwiY2FudGlkYWQgZGUgbWVzZXMgcXVlIHRyYW5zY3Vycmltb3NcIiA9IG1lc2VzIGRlbCBhXHUwMEYxbyBwYXNhZG9zIGhhc3RhIGhveS4pXG5mdW5jdGlvbiBfc3VtVmVudGFzWVREKG1lc2VzTWFwLCBob3kpIHtcbiAgY29uc3QgeWVhciA9IGhveS5nZXRGdWxsWWVhcigpO1xuICBjb25zdCBtZXNBY3R1YWwgPSBob3kuZ2V0TW9udGgoKSArIDE7XG4gIGxldCB0b3RhbCA9IDA7XG4gIGlmIChtZXNlc01hcCkge1xuICAgIGZvciAobGV0IG0gPSAxOyBtIDw9IG1lc0FjdHVhbDsgbSsrKSB7XG4gICAgICBjb25zdCBrID0gX21vbnRoS2V5KHllYXIsIG0pO1xuICAgICAgdG90YWwgKz0gTnVtYmVyKG1lc2VzTWFwW2tdICYmIG1lc2VzTWFwW2tdLnF0eSB8fCAwKTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHsgdG90YWxZdGQ6IHRvdGFsLCBtZXNlc1RyYW5zY3Vycmlkb3M6IG1lc0FjdHVhbCB9O1xufVxuXG4vLyBDYXJnYSBza3VfdmVudGFzX3NuYXBzaG90IGNvbXBsZXRvICh1bmEgdmV6IHBvciBzZXNpb24gZGVsIG1vZGFsKS5cbmFzeW5jIGZ1bmN0aW9uIF9sb2FkU25hcHNob3QoKSB7XG4gIGlmIChfZm9yZWNhc3RTbmFwc2hvdCkgcmV0dXJuIF9mb3JlY2FzdFNuYXBzaG90O1xuICBpZiAoIXdpbmRvdy5mYkRiKSB0aHJvdyBuZXcgRXJyb3IoJ0ZpcmVzdG9yZSBubyBpbmljaWFsaXphZG8nKTtcbiAgY29uc3Qgc25hcCA9IGF3YWl0IHdpbmRvdy5mYkRiLmNvbGxlY3Rpb24oJ3NrdV92ZW50YXNfc25hcHNob3QnKS5nZXQoKTtcbiAgY29uc3QgYnlPcmlnaW5hbFNrdSA9IHt9O1xuICBjb25zdCBieVVwcGVyU2t1ID0ge307XG4gIHNuYXAuZm9yRWFjaChkb2MgPT4ge1xuICAgIGNvbnN0IGQgPSBkb2MuZGF0YSgpO1xuICAgIGlmICghZCB8fCAhZC5za3UpIHJldHVybjtcbiAgICBjb25zdCBza3VVcHBlciA9IFN0cmluZyhkLnNrdSkudHJpbSgpLnRvVXBwZXJDYXNlKCk7XG4gICAgY29uc3QgcmVjb3JkID0ge1xuICAgICAgc2t1OiAgICAgICAgZC5za3UsXG4gICAgICBpdGVtTmFtZTogICBkLml0ZW1OYW1lIHx8ICcnLFxuICAgICAgZmFtaWxpYTogICAgZC5mYW1pbGlhIHx8ICcnLFxuICAgICAgc3ViZmFtaWxpYTogZC5zdWJmYW1pbGlhIHx8ICcnLFxuICAgICAgbWVzZXM6ICAgICAgZC5tZXNlcyB8fCB7fSxcbiAgICB9O1xuICAgIGJ5T3JpZ2luYWxTa3VbZC5za3VdID0gcmVjb3JkO1xuICAgIGJ5VXBwZXJTa3Vbc2t1VXBwZXJdID0gcmVjb3JkO1xuICB9KTtcbiAgX2ZvcmVjYXN0U25hcHNob3QgPSB7IGJ5T3JpZ2luYWxTa3UsIGJ5VXBwZXJTa3UsIGNvdW50OiBzbmFwLnNpemUgfTtcbiAgcmV0dXJuIF9mb3JlY2FzdFNuYXBzaG90O1xufVxuXG4vLyBQYXJzZWEgZWwgRXhjZWwgU2FsZXMgUGxhbi4gRXNwZXJhIGNvbHVtbmFzIFNLVSArIDYgY29sdW1uYXMgbnVtZXJpY2FzXG4vLyAobm9tYnJlcyBmbGV4aWJsZXM6IE1lczEuLk1lczYsIG1lc18xLi5tZXNfNiwgbyBjdWFscXVpZXIgaGVhZGVyIGN1c3RvbVxuLy8gbWllbnRyYXMgbGEgcHJpbWVyYSBzZWEgU0tVIHkgaGF5YSBhbCBtZW5vcyA2IGNvbHVtbmFzIG51bWVyaWNhcyBtYXMpLlxuZnVuY3Rpb24gX3BhcnNlU2FsZXNQbGFuUm93cyhyb3dzUmF3KSB7XG4gIGlmICghcm93c1JhdyB8fCAhcm93c1Jhdy5sZW5ndGgpIHJldHVybiBbXTtcbiAgY29uc3QgaGVhZGVyUm93ID0gcm93c1Jhd1swXTtcbiAgLy8gRGV0ZWN0YXIgaW5kaWNlIGRlIGNvbHVtbmEgU0tVXG4gIGxldCBza3VDb2xJZHggPSAtMTtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBoZWFkZXJSb3cubGVuZ3RoOyBpKyspIHtcbiAgICBjb25zdCBoID0gU3RyaW5nKGhlYWRlclJvd1tpXSB8fCAnJykudHJpbSgpLnRvVXBwZXJDYXNlKCk7XG4gICAgaWYgKGggPT09ICdTS1UnIHx8IGggPT09ICdJVEVNQ09ERScgfHwgaCA9PT0gJ0lURU0nIHx8IGggPT09ICdJVEVNIENPREUnIHx8IGggPT09ICdDT0RJR08nKSB7XG4gICAgICBza3VDb2xJZHggPSBpO1xuICAgICAgYnJlYWs7XG4gICAgfVxuICB9XG4gIGlmIChza3VDb2xJZHggPCAwKSB0aHJvdyBuZXcgRXJyb3IoJ0VsIEV4Y2VsIGRlYmUgdGVuZXIgdW5hIGNvbHVtbmEgbGxhbWFkYSBcIlNLVVwiIChvIENvZGlnbyAvIEl0ZW1Db2RlIC8gSXRlbSknKTtcbiAgLy8gTGFzIDYgY29sdW1uYXMgZGUgbWVzZXM6IGxhcyBwcmltZXJhcyA2IGNvbHVtbmFzIHF1ZSBzZWFuICE9IHNrdUNvbElkeC5cbiAgY29uc3QgbW9udGhDb2xzID0gW107XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgaGVhZGVyUm93Lmxlbmd0aCAmJiBtb250aENvbHMubGVuZ3RoIDwgNjsgaSsrKSB7XG4gICAgaWYgKGkgIT09IHNrdUNvbElkeCkgbW9udGhDb2xzLnB1c2goaSk7XG4gIH1cbiAgaWYgKG1vbnRoQ29scy5sZW5ndGggPCA2KSB0aHJvdyBuZXcgRXJyb3IoJ0VsIEV4Y2VsIGRlYmUgdGVuZXIgYWwgbWVub3MgNiBjb2x1bW5hcyBkZSBtZXNlcyBhZGVtYXMgZGUgU0tVIChlbmNvbnRyYWRhczogJyArIG1vbnRoQ29scy5sZW5ndGggKyAnKScpO1xuICBjb25zdCBvdXQgPSBbXTtcbiAgZm9yIChsZXQgciA9IDE7IHIgPCByb3dzUmF3Lmxlbmd0aDsgcisrKSB7XG4gICAgY29uc3Qgcm93ID0gcm93c1Jhd1tyXTtcbiAgICBpZiAoIXJvdyB8fCAhcm93Lmxlbmd0aCkgY29udGludWU7XG4gICAgY29uc3Qgc2t1UmF3ID0gcm93W3NrdUNvbElkeF07XG4gICAgaWYgKHNrdVJhdyA9PT0gdW5kZWZpbmVkIHx8IHNrdVJhdyA9PT0gbnVsbCB8fCBTdHJpbmcoc2t1UmF3KS50cmltKCkgPT09ICcnKSBjb250aW51ZTtcbiAgICBjb25zdCBza3UgPSBTdHJpbmcoc2t1UmF3KS50cmltKCk7XG4gICAgY29uc3QgbWVzZXNBcnIgPSBtb250aENvbHMubWFwKGkgPT4ge1xuICAgICAgY29uc3QgdiA9IHJvd1tpXTtcbiAgICAgIGNvbnN0IG4gPSBOdW1iZXIodik7XG4gICAgICByZXR1cm4gaXNGaW5pdGUobikgPyBuIDogMDtcbiAgICB9KTtcbiAgICBjb25zdCBwZWRpZG9Ub3RhbCA9IG1lc2VzQXJyLnJlZHVjZSgoYSwgYikgPT4gYSArIGIsIDApO1xuICAgIG91dC5wdXNoKHsgc2t1LCBtZXNlc0FyciwgcGVkaWRvVG90YWwgfSk7XG4gIH1cbiAgcmV0dXJuIG91dDtcbn1cblxuLy8gQ2FsY3VsYSBsYXMgZmlsYXMgZmluYWxlcyBjcnV6YW5kbyBzbmFwc2hvdCArIHNhbGVzIHBsYW4uXG5mdW5jdGlvbiBfY29tcHV0ZUZvcmVjYXN0Um93cyhzbmFwc2hvdCwgc2FsZXNQbGFuLCBob3kpIHtcbiAgY29uc3Qgcm93cyA9IFtdO1xuICBmb3IgKGNvbnN0IHNwIG9mIHNhbGVzUGxhbikge1xuICAgIGNvbnN0IHNrdVVwcGVyID0gc3Auc2t1LnRvVXBwZXJDYXNlKCk7XG4gICAgY29uc3QgaGlzdCA9IHNuYXBzaG90LmJ5VXBwZXJTa3Vbc2t1VXBwZXJdIHx8IG51bGw7XG4gICAgY29uc3QgdmVudGFzMTJtID0gaGlzdCA/IF9zdW1WZW50YXMxMm1Db21wbGV0b3MoaGlzdC5tZXNlcywgaG95KSA6IDA7XG4gICAgY29uc3QgeXRkID0gaGlzdCA/IF9zdW1WZW50YXNZVEQoaGlzdC5tZXNlcywgaG95KSA6IHsgdG90YWxZdGQ6IDAsIG1lc2VzVHJhbnNjdXJyaWRvczogaG95LmdldE1vbnRoKCkgKyAxIH07XG4gICAgY29uc3QgcHJvbWVkaW8gPSB5dGQubWVzZXNUcmFuc2N1cnJpZG9zID4gMCA/IHl0ZC50b3RhbFl0ZCAvIHl0ZC5tZXNlc1RyYW5zY3Vycmlkb3MgOiAwO1xuICAgIGNvbnN0IHBvbGl0aWNhID0gcHJvbWVkaW8gKiAzO1xuICAgIGNvbnN0IHRvdGFsID0gc3AucGVkaWRvVG90YWwgLSBwb2xpdGljYTtcbiAgICByb3dzLnB1c2goe1xuICAgICAgc2t1OiAgICAgICAgIHNwLnNrdSxcbiAgICAgIGl0ZW1OYW1lOiAgICBoaXN0ID8gaGlzdC5pdGVtTmFtZSA6ICcnLFxuICAgICAgZmFtaWxpYTogICAgIGhpc3QgPyBoaXN0LmZhbWlsaWEgOiAnKHNpbiBtYXRjaCknLFxuICAgICAgc3ViZmFtaWxpYTogIGhpc3QgPyBoaXN0LnN1YmZhbWlsaWEgOiAnKHNpbiBtYXRjaCknLFxuICAgICAgdmVudGFzMTJtOiAgIHZlbnRhczEybSxcbiAgICAgIHBlZGlkbzZtOiAgICBzcC5wZWRpZG9Ub3RhbCxcbiAgICAgIHByb21lZGlvOiAgICBwcm9tZWRpbyxcbiAgICAgIHBvbGl0aWNhOiAgICBwb2xpdGljYSxcbiAgICAgIHRvdGFsOiAgICAgICB0b3RhbCxcbiAgICAgIGhhc0hpc3RvcmlhOiAhIWhpc3QsXG4gICAgfSk7XG4gIH1cbiAgcmV0dXJuIHJvd3M7XG59XG5cbmZ1bmN0aW9uIF9yZW5kZXJNb2RhbFNoZWxsKCkge1xuICBjb25zdCBleGlzdGluZyA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdmb3JlY2FzdC1tb2RhbCcpO1xuICBpZiAoZXhpc3RpbmcpIHJldHVybiBleGlzdGluZztcbiAgY29uc3QgZWwgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKTtcbiAgZWwuaWQgPSAnZm9yZWNhc3QtbW9kYWwnO1xuICBlbC5jbGFzc05hbWUgPSAnbW9kYWwtb3ZlcmxheSc7XG4gIGVsLnN0eWxlLmNzc1RleHQgPSAnZGlzcGxheTpub25lO3Bvc2l0aW9uOmZpeGVkO2luc2V0OjA7YmFja2dyb3VuZDpyZ2JhKDE1LDIzLDQyLC42KTt6LWluZGV4OjIwNTA7JztcbiAgZWwub25jbGljayA9IGZ1bmN0aW9uIChldikgeyBpZiAoZXYudGFyZ2V0ID09PSBlbCkgd2luZG93LmNsb3NlRm9yZWNhc3RNb2RhbCgpOyB9O1xuICBlbC5pbm5lckhUTUwgPSAnJ1xuICAgICsgJzxkaXYgc3R5bGU9XCJwb3NpdGlvbjphYnNvbHV0ZTtpbnNldDoxdmggMXZ3O2JhY2tncm91bmQ6I2ZmZjtib3JkZXItcmFkaXVzOjEwcHg7ZGlzcGxheTpmbGV4O2ZsZXgtZGlyZWN0aW9uOmNvbHVtbjtvdmVyZmxvdzpoaWRkZW47Ym94LXNoYWRvdzowIDIwcHggNTBweCByZ2JhKDAsMCwwLC4zNSlcIj4nXG4gICAgKyAgICc8ZGl2IHN0eWxlPVwicGFkZGluZzoxMnB4IDE4cHg7YmFja2dyb3VuZDojMGYxNzJhO2NvbG9yOiNmZmY7ZGlzcGxheTpmbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtnYXA6MTJweFwiPidcbiAgICArICAgICAnPGRpdiBzdHlsZT1cImZsZXg6MVwiPidcbiAgICArICAgICAgICc8ZGl2IHN0eWxlPVwiZm9udC1zaXplOjE2cHg7Zm9udC13ZWlnaHQ6ODAwO2xldHRlci1zcGFjaW5nOi41cHhcIj5GT1JFQ0FTVDwvZGl2PidcbiAgICArICAgICAgICc8ZGl2IGlkPVwiZm9yZWNhc3Qtc3VidGl0bGVcIiBzdHlsZT1cImZvbnQtc2l6ZToxMXB4O29wYWNpdHk6Ljg7bWFyZ2luLXRvcDoycHhcIj5DYXJnYXIgU2FsZXMgUGxhbiBwYXJhIHZlciBsYSBwcm95ZWNjaW9uIHZzIHBvbGl0aWNhIGRlIGludmVudGFyaW8gKDMgbWVzZXMpPC9kaXY+J1xuICAgICsgICAgICc8L2Rpdj4nXG4gICAgKyAgICAgJzxidXR0b24gaWQ9XCJmb3JlY2FzdC1leHBvcnQtYnRuXCIgb25jbGljaz1cImV4cG9ydEZvcmVjYXN0RXhjZWwoKVwiIGRpc2FibGVkIHN0eWxlPVwicGFkZGluZzo4cHggMTRweDtiYWNrZ3JvdW5kOiMxNjY1MzQ7Y29sb3I6I2ZmZjtib3JkZXI6bm9uZTtib3JkZXItcmFkaXVzOjZweDtmb250LXdlaWdodDo3MDA7Y3Vyc29yOnBvaW50ZXI7b3BhY2l0eTouNVwiPkV4cG9ydGFyIEV4Y2VsPC9idXR0b24+J1xuICAgICsgICAgICc8YnV0dG9uIG9uY2xpY2s9XCJjbG9zZUZvcmVjYXN0TW9kYWwoKVwiIHN0eWxlPVwiYmFja2dyb3VuZDp0cmFuc3BhcmVudDtjb2xvcjojZmZmO2JvcmRlcjoxcHggc29saWQgcmdiYSgyNTUsMjU1LDI1NSwuNCk7Ym9yZGVyLXJhZGl1czo2cHg7cGFkZGluZzo2cHggMTBweDtjdXJzb3I6cG9pbnRlcjtmb250LXdlaWdodDo3MDBcIj5DZXJyYXI8L2J1dHRvbj4nXG4gICAgKyAgICc8L2Rpdj4nXG4gICAgKyAgICc8ZGl2IHN0eWxlPVwicGFkZGluZzoxMnB4IDE4cHg7YmFja2dyb3VuZDojZjhmYWZjO2JvcmRlci1ib3R0b206MXB4IHNvbGlkICNlMmU4ZjA7ZGlzcGxheTpmbGV4O2ZsZXgtd3JhcDp3cmFwO2dhcDoxNHB4O2FsaWduLWl0ZW1zOmNlbnRlclwiPidcbiAgICArICAgICAnPGxhYmVsIHN0eWxlPVwiZGlzcGxheTppbmxpbmUtZmxleDthbGlnbi1pdGVtczpjZW50ZXI7Z2FwOjhweDtwYWRkaW5nOjhweCAxMnB4O2JhY2tncm91bmQ6IzBkOTQ4ODtjb2xvcjojZmZmO2JvcmRlci1yYWRpdXM6NnB4O2ZvbnQtd2VpZ2h0OjcwMDtmb250LXNpemU6MTJweDtjdXJzb3I6cG9pbnRlclwiPidcbiAgICArICAgICAgICc8c3Bhbj5DYXJnYXIgU2FsZXMgUGxhbiAoLnhsc3gpPC9zcGFuPidcbiAgICArICAgICAgICc8aW5wdXQgdHlwZT1cImZpbGVcIiBhY2NlcHQ9XCIueGxzeCwueGxzXCIgc3R5bGU9XCJkaXNwbGF5Om5vbmVcIiBvbmNoYW5nZT1cIm9uRm9yZWNhc3RTYWxlc1BsYW5GaWxlKGV2ZW50KVwiLz4nXG4gICAgKyAgICAgJzwvbGFiZWw+J1xuICAgICsgICAgICc8ZGl2IGlkPVwiZm9yZWNhc3QtaGludFwiIHN0eWxlPVwiZm9udC1zaXplOjExcHg7Y29sb3I6IzY0NzQ4YjttYXgtd2lkdGg6NTIwcHhcIj5FeGNlbCBlc3BlcmFkbzogcHJpbWVyYSBjb2x1bW5hIDxiPlNLVTwvYj4sIGx1ZWdvIDYgY29sdW1uYXMgY29uIGxhcyB1bmlkYWRlcyBwZWRpZGFzIG1lcyBhIG1lcyBwYXJhIGxvcyBwcm94aW1vcyA2IG1lc2VzLiBMb3MgaGVhZGVycyBkZSBsb3MgbWVzZXMgcHVlZGVuIHNlciBjdWFscXVpZXIgbm9tYnJlIChNZXMxLi5NZXM2LCBhZ28tMjYuLmVuZS0yNywgZXRjKS48L2Rpdj4nXG4gICAgKyAgICAgJzxkaXYgaWQ9XCJmb3JlY2FzdC1zdGF0c1wiIHN0eWxlPVwibWFyZ2luLWxlZnQ6YXV0bztmb250LXNpemU6MTFweDtjb2xvcjojNDc1NTY5O2ZvbnQtd2VpZ2h0OjYwMFwiPjwvZGl2PidcbiAgICArICAgJzwvZGl2PidcbiAgICArICAgJzxkaXYgaWQ9XCJmb3JlY2FzdC1ib2R5XCIgc3R5bGU9XCJmbGV4OjE7b3ZlcmZsb3c6YXV0bztwYWRkaW5nOjBcIj4nXG4gICAgKyAgICAgJzxkaXYgc3R5bGU9XCJwYWRkaW5nOjYwcHggMjBweDt0ZXh0LWFsaWduOmNlbnRlcjtjb2xvcjojOTRhM2I4O2ZvbnQtc2l6ZToxNHB4XCI+RXNwZXJhbmRvIGFyY2hpdm8gU2FsZXMgUGxhbi4uLjwvZGl2PidcbiAgICArICAgJzwvZGl2PidcbiAgICArICc8L2Rpdj4nO1xuICBkb2N1bWVudC5ib2R5LmFwcGVuZENoaWxkKGVsKTtcbiAgcmV0dXJuIGVsO1xufVxuXG5mdW5jdGlvbiBfcmVuZGVyVGFibGUocm93cykge1xuICBjb25zdCBib2R5ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2ZvcmVjYXN0LWJvZHknKTtcbiAgaWYgKCFib2R5KSByZXR1cm47XG4gIGlmICghcm93cyB8fCAhcm93cy5sZW5ndGgpIHtcbiAgICBib2R5LmlubmVySFRNTCA9ICc8ZGl2IHN0eWxlPVwicGFkZGluZzo2MHB4IDIwcHg7dGV4dC1hbGlnbjpjZW50ZXI7Y29sb3I6Izk0YTNiOFwiPlNhbGVzIFBsYW4gdmFjaW8gbyBzaW4gZmlsYXMgdmFsaWRhcy48L2Rpdj4nO1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCBmbXQgPSAobikgPT4gKG4gPT09IDAgfHwgIWlzRmluaXRlKG4pKSA/ICcwJyA6IE51bWJlcihuKS50b0xvY2FsZVN0cmluZygnZXMtQVInLCB7IG1heGltdW1GcmFjdGlvbkRpZ2l0czogMSB9KTtcbiAgY29uc3QgY29sb3JGb3JUb3RhbCA9ICh0KSA9PiB7XG4gICAgaWYgKHQgPiAwKSByZXR1cm4gJyMxNjY1MzQnOyAgIC8vIHNvYnJhIChwZWRpc3RlIG1hcyBxdWUgbGEgcG9saXRpY2EpIC0gdmVyZGVcbiAgICBpZiAodCA8IDApIHJldHVybiAnI2MyNDEwYyc7ICAgLy8gZmFsdGEgKHBlZGlzdGUgbWVub3MgcXVlIGxhIHBvbGl0aWNhKSAtIG5hcmFuamEgdXJnZW50ZVxuICAgIHJldHVybiAnIzQ3NTU2OSc7XG4gIH07XG4gIGNvbnN0IHJvd3NIdG1sID0gcm93cy5tYXAociA9PiAnJ1xuICAgICsgJzx0cicgKyAoci5oYXNIaXN0b3JpYSA/ICcnIDogJyBzdHlsZT1cImJhY2tncm91bmQ6I2ZlZjNjN1wiJykgKyAnPidcbiAgICArICAgJzx0ZCBzdHlsZT1cInBhZGRpbmc6NnB4IDEwcHg7Zm9udC1mYW1pbHk6bW9ub3NwYWNlO2ZvbnQtc2l6ZToxMXB4O3doaXRlLXNwYWNlOm5vd3JhcFwiPicgKyBlc2NhcGVIdG1sU2FmZShyLnNrdSkgKyAnPC90ZD4nXG4gICAgKyAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjZweCAxMHB4O2ZvbnQtc2l6ZToxMXB4XCI+JyArIGVzY2FwZUh0bWxTYWZlKHIuZmFtaWxpYSkgKyAnPC90ZD4nXG4gICAgKyAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjZweCAxMHB4O2ZvbnQtc2l6ZToxMXB4XCI+JyArIGVzY2FwZUh0bWxTYWZlKHIuc3ViZmFtaWxpYSkgKyAnPC90ZD4nXG4gICAgKyAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjZweCAxMHB4O3RleHQtYWxpZ246cmlnaHQ7Zm9udC12YXJpYW50LW51bWVyaWM6dGFidWxhci1udW1zXCI+JyArIGZtdChyLnZlbnRhczEybSkgKyAnPC90ZD4nXG4gICAgKyAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjZweCAxMHB4O3RleHQtYWxpZ246cmlnaHQ7Zm9udC12YXJpYW50LW51bWVyaWM6dGFidWxhci1udW1zO2ZvbnQtd2VpZ2h0OjYwMFwiPicgKyBmbXQoci5wZWRpZG82bSkgKyAnPC90ZD4nXG4gICAgKyAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjZweCAxMHB4O3RleHQtYWxpZ246cmlnaHQ7Zm9udC12YXJpYW50LW51bWVyaWM6dGFidWxhci1udW1zO2NvbG9yOiM2NDc0OGJcIj4nICsgZm10KHIucHJvbWVkaW8pICsgJzwvdGQ+J1xuICAgICsgICAnPHRkIHN0eWxlPVwicGFkZGluZzo2cHggMTBweDt0ZXh0LWFsaWduOnJpZ2h0O2ZvbnQtdmFyaWFudC1udW1lcmljOnRhYnVsYXItbnVtc1wiPicgKyBmbXQoci5wb2xpdGljYSkgKyAnPC90ZD4nXG4gICAgKyAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjZweCAxMHB4O3RleHQtYWxpZ246cmlnaHQ7Zm9udC12YXJpYW50LW51bWVyaWM6dGFidWxhci1udW1zO2ZvbnQtd2VpZ2h0OjcwMDtjb2xvcjonICsgY29sb3JGb3JUb3RhbChyLnRvdGFsKSArICdcIj4nICsgZm10KHIudG90YWwpICsgJzwvdGQ+J1xuICAgICsgJzwvdHI+J1xuICApLmpvaW4oJycpO1xuICBjb25zdCBoZWFkZXIgPSAnJ1xuICAgICsgJzx0aGVhZCBzdHlsZT1cInBvc2l0aW9uOnN0aWNreTt0b3A6MDtiYWNrZ3JvdW5kOiMwZjE3MmE7Y29sb3I6I2ZmZjt6LWluZGV4OjFcIj4nXG4gICAgKyAgICc8dHI+J1xuICAgICsgICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjhweCAxMHB4O3RleHQtYWxpZ246bGVmdDtmb250LXNpemU6MTFweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7bGV0dGVyLXNwYWNpbmc6LjRweFwiPlNLVTwvdGg+J1xuICAgICsgICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjhweCAxMHB4O3RleHQtYWxpZ246bGVmdDtmb250LXNpemU6MTFweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7bGV0dGVyLXNwYWNpbmc6LjRweFwiPkZhbWlsaWE8L3RoPidcbiAgICArICAgICAnPHRoIHN0eWxlPVwicGFkZGluZzo4cHggMTBweDt0ZXh0LWFsaWduOmxlZnQ7Zm9udC1zaXplOjExcHg7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO2xldHRlci1zcGFjaW5nOi40cHhcIj5TdWJmYW1pbGlhPC90aD4nXG4gICAgKyAgICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6OHB4IDEwcHg7dGV4dC1hbGlnbjpyaWdodDtmb250LXNpemU6MTFweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7bGV0dGVyLXNwYWNpbmc6LjRweFwiIHRpdGxlPVwiU3VtYSBkZSBxdHkgZmFjdHVyYWRhIGVuIGxvcyB1bHRpbW9zIDEyIG1lc2VzIGNvbXBsZXRvc1wiPlZlbnRhcyAxMm08L3RoPidcbiAgICArICAgICAnPHRoIHN0eWxlPVwicGFkZGluZzo4cHggMTBweDt0ZXh0LWFsaWduOnJpZ2h0O2ZvbnQtc2l6ZToxMXB4O3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtsZXR0ZXItc3BhY2luZzouNHB4XCIgdGl0bGU9XCJTdW1hIGRlIGxhcyA2IGNvbHVtbmFzIGRlbCBFeGNlbCBTYWxlcyBQbGFuXCI+UGVkaWRvIDZtPC90aD4nXG4gICAgKyAgICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6OHB4IDEwcHg7dGV4dC1hbGlnbjpyaWdodDtmb250LXNpemU6MTFweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7bGV0dGVyLXNwYWNpbmc6LjRweFwiIHRpdGxlPVwiVmVudGFzIFlURCAvIG1lc2VzIHRyYW5zY3Vycmlkb3MgZGVsIGFcdTAwRjFvXCI+UHJvbSAvIE1lczwvdGg+J1xuICAgICsgICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjhweCAxMHB4O3RleHQtYWxpZ246cmlnaHQ7Zm9udC1zaXplOjExcHg7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO2xldHRlci1zcGFjaW5nOi40cHhcIiB0aXRsZT1cIlByb21lZGlvIHggMyBtZXNlcyAocG9saXRpY2EgZGUgaW52ZW50YXJpbylcIj5Qb2xpdGljYTwvdGg+J1xuICAgICsgICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjhweCAxMHB4O3RleHQtYWxpZ246cmlnaHQ7Zm9udC1zaXplOjExcHg7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO2xldHRlci1zcGFjaW5nOi40cHhcIiB0aXRsZT1cIlBlZGlkbyA2bSAtIFBvbGl0aWNhLiBOZWdhdGl2byA9IHRlIGZhbHRhIHBlZGlyOyBQb3NpdGl2byA9IHNvYnJlcGVkaWRvXCI+VG90YWw8L3RoPidcbiAgICArICAgJzwvdHI+J1xuICAgICsgJzwvdGhlYWQ+JztcbiAgYm9keS5pbm5lckhUTUwgPSAnPHRhYmxlIHN0eWxlPVwid2lkdGg6MTAwJTtib3JkZXItY29sbGFwc2U6Y29sbGFwc2U7Zm9udC1zaXplOjEycHhcIj4nICsgaGVhZGVyICsgJzx0Ym9keT4nICsgcm93c0h0bWwgKyAnPC90Ym9keT48L3RhYmxlPic7XG59XG5cbmZ1bmN0aW9uIGVzY2FwZUh0bWxTYWZlKHMpIHtcbiAgaWYgKHR5cGVvZiB3aW5kb3cuZXNjYXBlSHRtbCA9PT0gJ2Z1bmN0aW9uJykgcmV0dXJuIHdpbmRvdy5lc2NhcGVIdG1sKHMpO1xuICByZXR1cm4gU3RyaW5nKHMgPT0gbnVsbCA/ICcnIDogcykucmVwbGFjZSgvWyY8PlwiJ10vZywgY2ggPT4gKHsgJyYnOicmYW1wOycsJzwnOicmbHQ7JywnPic6JyZndDsnLCdcIic6JyZxdW90OycsXCInXCI6JyYjMzk7JyB9W2NoXSkpO1xufVxuXG53aW5kb3cub3BlbkZvcmVjYXN0TW9kYWwgPSBhc3luYyBmdW5jdGlvbiAoKSB7XG4gIGlmICghX2NhbkZvcmVjYXN0KCkpIHtcbiAgICBhbGVydCgnRk9SRUNBU1QgZXMgc29sbyBwYXJhIE1hcmlhbm8gKGFkbWluKS4nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgY29uc3QgZWwgPSBfcmVuZGVyTW9kYWxTaGVsbCgpO1xuICBlbC5zdHlsZS5kaXNwbGF5ID0gJ2Jsb2NrJztcbiAgaWYgKF9mb3JlY2FzdExvYWRpbmcpIHJldHVybjtcbiAgaWYgKCFfZm9yZWNhc3RTbmFwc2hvdCkge1xuICAgIF9mb3JlY2FzdExvYWRpbmcgPSB0cnVlO1xuICAgIGNvbnN0IHN0YXRzID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2ZvcmVjYXN0LXN0YXRzJyk7XG4gICAgaWYgKHN0YXRzKSBzdGF0cy50ZXh0Q29udGVudCA9ICdDYXJnYW5kbyBzbmFwc2hvdCBkZSB2ZW50YXMuLi4nO1xuICAgIHRyeSB7XG4gICAgICBhd2FpdCBfbG9hZFNuYXBzaG90KCk7XG4gICAgICBpZiAoc3RhdHMpIHN0YXRzLnRleHRDb250ZW50ID0gX2ZvcmVjYXN0U25hcHNob3QuY291bnQgKyAnIFNLVXMgZW4gc25hcHNob3QgaGlzdG9yaWNvJztcbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICBpZiAoc3RhdHMpIHN0YXRzLnRleHRDb250ZW50ID0gJ0Vycm9yIGNhcmdhbmRvIHNuYXBzaG90OiAnICsgKGUgJiYgZS5tZXNzYWdlIHx8IGUpO1xuICAgICAgYWxlcnQoJ05vIHNlIHB1ZG8gY2FyZ2FyIHNrdV92ZW50YXNfc25hcHNob3QuIENoZXF1ZWEgcXVlIGVsIGJvb3RzdHJhcCBQeXRob24geWEgaGF5YSBjb3JyaWRvIChzY3JpcHRzL2FwcGx5X3NrdV92ZW50YXNfc25hcHNob3QucHkpIHkgcXVlIHRlbmdhcyByb2wgYWRtaW4uJyk7XG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIF9mb3JlY2FzdExvYWRpbmcgPSBmYWxzZTtcbiAgICB9XG4gIH0gZWxzZSB7XG4gICAgY29uc3Qgc3RhdHMgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZm9yZWNhc3Qtc3RhdHMnKTtcbiAgICBpZiAoc3RhdHMpIHN0YXRzLnRleHRDb250ZW50ID0gX2ZvcmVjYXN0U25hcHNob3QuY291bnQgKyAnIFNLVXMgZW4gc25hcHNob3QgaGlzdG9yaWNvJztcbiAgfVxufTtcblxud2luZG93LmNsb3NlRm9yZWNhc3RNb2RhbCA9IGZ1bmN0aW9uICgpIHtcbiAgY29uc3QgZWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZm9yZWNhc3QtbW9kYWwnKTtcbiAgaWYgKGVsKSBlbC5zdHlsZS5kaXNwbGF5ID0gJ25vbmUnO1xufTtcblxud2luZG93Lm9uRm9yZWNhc3RTYWxlc1BsYW5GaWxlID0gYXN5bmMgZnVuY3Rpb24gKGV2ZW50KSB7XG4gIGNvbnN0IGZpbGUgPSBldmVudCAmJiBldmVudC50YXJnZXQgJiYgZXZlbnQudGFyZ2V0LmZpbGVzICYmIGV2ZW50LnRhcmdldC5maWxlc1swXTtcbiAgaWYgKCFmaWxlKSByZXR1cm47XG4gIHRyeSB7XG4gICAgaWYgKCFfZm9yZWNhc3RTbmFwc2hvdCkgYXdhaXQgX2xvYWRTbmFwc2hvdCgpO1xuICAgIGNvbnN0IGJ1ZiA9IGF3YWl0IGZpbGUuYXJyYXlCdWZmZXIoKTtcbiAgICBpZiAodHlwZW9mIFhMU1ggPT09ICd1bmRlZmluZWQnKSB7IGFsZXJ0KCdYTFNYIG5vIGNhcmdhZG8nKTsgcmV0dXJuOyB9XG4gICAgY29uc3Qgd2IgPSBYTFNYLnJlYWQoYnVmLCB7IHR5cGU6ICdhcnJheScgfSk7XG4gICAgY29uc3Qgc2hlZXQgPSB3Yi5TaGVldHNbd2IuU2hlZXROYW1lc1swXV07XG4gICAgY29uc3Qgcm93cyA9IFhMU1gudXRpbHMuc2hlZXRfdG9fanNvbihzaGVldCwgeyBoZWFkZXI6IDEsIGRlZnZhbDogbnVsbCwgcmF3OiB0cnVlIH0pO1xuICAgIGNvbnN0IHBhcnNlZCA9IF9wYXJzZVNhbGVzUGxhblJvd3Mocm93cyk7XG4gICAgaWYgKCFwYXJzZWQubGVuZ3RoKSB7IGFsZXJ0KCdFbCBFeGNlbCBlc3RhIHZhY2lvIG8gbm8gdGllbmUgZmlsYXMgdmFsaWRhcy4nKTsgcmV0dXJuOyB9XG4gICAgX2ZvcmVjYXN0U2FsZXNQbGFuID0gcGFyc2VkO1xuICAgIGNvbnN0IGhveSA9IG5ldyBEYXRlKCk7XG4gICAgX2ZvcmVjYXN0Um93cyA9IF9jb21wdXRlRm9yZWNhc3RSb3dzKF9mb3JlY2FzdFNuYXBzaG90LCBwYXJzZWQsIGhveSk7XG4gICAgX3JlbmRlclRhYmxlKF9mb3JlY2FzdFJvd3MpO1xuICAgIGNvbnN0IHNpbk1hdGNoID0gX2ZvcmVjYXN0Um93cy5maWx0ZXIociA9PiAhci5oYXNIaXN0b3JpYSkubGVuZ3RoO1xuICAgIGNvbnN0IHN0YXRzID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2ZvcmVjYXN0LXN0YXRzJyk7XG4gICAgaWYgKHN0YXRzKSB7XG4gICAgICBzdGF0cy50ZXh0Q29udGVudCA9IHBhcnNlZC5sZW5ndGggKyAnIFNLVXMgZW4gU2FsZXMgUGxhbiBcdTAwQjcgJ1xuICAgICAgICArIChwYXJzZWQubGVuZ3RoIC0gc2luTWF0Y2gpICsgJyBjb24gaGlzdG9yaWEgXHUwMEI3ICdcbiAgICAgICAgKyBzaW5NYXRjaCArICcgc2luIG1hdGNoIChmb25kbyBhbWFyaWxsbyknO1xuICAgIH1cbiAgICBjb25zdCBidG4gPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZm9yZWNhc3QtZXhwb3J0LWJ0bicpO1xuICAgIGlmIChidG4pIHsgYnRuLmRpc2FibGVkID0gZmFsc2U7IGJ0bi5zdHlsZS5vcGFjaXR5ID0gJzEnOyB9XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBjb25zb2xlLmVycm9yKCdbRk9SRUNBU1RdIHBhcnNlIGVycm9yOicsIGUpO1xuICAgIGFsZXJ0KCdFcnJvciBwcm9jZXNhbmRvIGVsIEV4Y2VsOlxcbicgKyAoZSAmJiBlLm1lc3NhZ2UgfHwgZSkpO1xuICB9IGZpbmFsbHkge1xuICAgIC8vIFJlc2V0IGlucHV0IHBhcmEgcXVlIGVsIG1pc21vIGFyY2hpdm8gc2UgcHVlZGEgcmUtc3ViaXJcbiAgICBpZiAoZXZlbnQgJiYgZXZlbnQudGFyZ2V0KSBldmVudC50YXJnZXQudmFsdWUgPSAnJztcbiAgfVxufTtcblxud2luZG93LmV4cG9ydEZvcmVjYXN0RXhjZWwgPSBmdW5jdGlvbiAoKSB7XG4gIGlmICghX2ZvcmVjYXN0Um93cyB8fCAhX2ZvcmVjYXN0Um93cy5sZW5ndGgpIHsgYWxlcnQoJ05vIGhheSBkYXRvcyBwYXJhIGV4cG9ydGFyLiBDYXJnYSBwcmltZXJvIGVsIFNhbGVzIFBsYW4uJyk7IHJldHVybjsgfVxuICBpZiAodHlwZW9mIFhMU1ggPT09ICd1bmRlZmluZWQnKSB7IGFsZXJ0KCdYTFNYIG5vIGNhcmdhZG8nKTsgcmV0dXJuOyB9XG4gIGNvbnN0IHJvdW5kMSA9IG4gPT4gTWF0aC5yb3VuZChOdW1iZXIobiB8fCAwKSAqIDEwKSAvIDEwO1xuICBjb25zdCBhb2EgPSBbW1xuICAgICdTS1UnLCAnRkFNSUxJQScsICdTVUJGQU1JTElBJyxcbiAgICAnVkVOVEFTICgxMm0pJywgJ1BFRElETy1TQUxFUyBQTEFOUyAoNm0pJyxcbiAgICAnUFJPTUVESU8gREUgSU5WRU5UQVJJTycsICdQT0xJVElDQSBERSBJTlZFTlRBUklPICgzbSknLCAnVE9UQUwnLFxuICBdXTtcbiAgZm9yIChjb25zdCByIG9mIF9mb3JlY2FzdFJvd3MpIHtcbiAgICBhb2EucHVzaChbXG4gICAgICByLnNrdSwgci5mYW1pbGlhLCByLnN1YmZhbWlsaWEsXG4gICAgICByb3VuZDEoci52ZW50YXMxMm0pLCByb3VuZDEoci5wZWRpZG82bSksXG4gICAgICByb3VuZDEoci5wcm9tZWRpbyksIHJvdW5kMShyLnBvbGl0aWNhKSwgcm91bmQxKHIudG90YWwpLFxuICAgIF0pO1xuICB9XG4gIGNvbnN0IHdzID0gWExTWC51dGlscy5hb2FfdG9fc2hlZXQoYW9hKTtcbiAgLy8gQW5jaG9zIGRlIGNvbHVtbmFcbiAgd3NbJyFjb2xzJ10gPSBbXG4gICAgeyB3Y2g6IDE4IH0sIHsgd2NoOiAyNCB9LCB7IHdjaDogMjQgfSxcbiAgICB7IHdjaDogMTQgfSwgeyB3Y2g6IDIwIH0sXG4gICAgeyB3Y2g6IDIwIH0sIHsgd2NoOiAyMiB9LCB7IHdjaDogMTIgfSxcbiAgXTtcbiAgY29uc3Qgd2IgPSBYTFNYLnV0aWxzLmJvb2tfbmV3KCk7XG4gIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQod2IsIHdzLCAnRk9SRUNBU1QnKTtcbiAgY29uc3QgaG95ID0gbmV3IERhdGUoKTtcbiAgY29uc3Qgc3RhbXAgPSBob3kuZ2V0RnVsbFllYXIoKSArICctJyArIFN0cmluZyhob3kuZ2V0TW9udGgoKSArIDEpLnBhZFN0YXJ0KDIsICcwJykgKyAnLScgKyBTdHJpbmcoaG95LmdldERhdGUoKSkucGFkU3RhcnQoMiwgJzAnKTtcbiAgWExTWC53cml0ZUZpbGUod2IsICdGb3JlY2FzdF9TaGltYW5vXycgKyBzdGFtcCArICcueGxzeCcpO1xufTtcblxuLy8gUmVmcmVzaCBwdWJsaWNvIChwb3Igc2kgZWwgdXNlciBuZWNlc2l0YSByZS1mZXRjaGVhciBlbCBzbmFwc2hvdCBzaW4gY2VycmFyXG4vLyBlbCBtb2RhbCwgZWo6IHBhc2Fyb24gMzAgbWluIHkgZWwgY3JvbiBCUSBhY3R1YWxpem8gbGEgY29sZWNjaW9uKS5cbndpbmRvdy5yZWxvYWRGb3JlY2FzdFNuYXBzaG90ID0gYXN5bmMgZnVuY3Rpb24gKCkge1xuICBfZm9yZWNhc3RTbmFwc2hvdCA9IG51bGw7XG4gIGF3YWl0IF9sb2FkU25hcHNob3QoKTtcbiAgaWYgKF9mb3JlY2FzdFNhbGVzUGxhbikge1xuICAgIGNvbnN0IGhveSA9IG5ldyBEYXRlKCk7XG4gICAgX2ZvcmVjYXN0Um93cyA9IF9jb21wdXRlRm9yZWNhc3RSb3dzKF9mb3JlY2FzdFNuYXBzaG90LCBfZm9yZWNhc3RTYWxlc1BsYW4sIGhveSk7XG4gICAgX3JlbmRlclRhYmxlKF9mb3JlY2FzdFJvd3MpO1xuICB9XG59O1xuIl0sCiAgIm1hcHBpbmdzIjogIjs7O0FBd0JBLE1BQUksb0JBQW9CO0FBQ3hCLE1BQUkscUJBQXFCO0FBQ3pCLE1BQUksZ0JBQWdCO0FBQ3BCLE1BQUksbUJBQW1CO0FBS3ZCLE1BQU0sMEJBQTBCO0FBQUEsSUFDOUI7QUFBQSxJQUNBO0FBQUEsRUFDRjtBQUVBLFdBQVMsZUFBZTtBQUN0QixRQUFJO0FBQ0YsWUFBTSxTQUFTLE9BQU8sZUFBZSxPQUFPLFlBQVksU0FBUyxJQUFJLFlBQVk7QUFDakYsVUFBSSxDQUFDLE1BQU8sUUFBTztBQUNuQixhQUFPLHdCQUF3QixRQUFRLEtBQUssS0FBSztBQUFBLElBQ25ELFFBQVE7QUFBRSxhQUFPO0FBQUEsSUFBTztBQUFBLEVBQzFCO0FBR0EsV0FBUyxVQUFVLE1BQU0sZUFBZTtBQUN0QyxXQUFPLE9BQU8sSUFBSSxFQUFFLFNBQVMsR0FBRyxHQUFHLElBQUksTUFBTSxPQUFPLGFBQWEsRUFBRSxTQUFTLEdBQUcsR0FBRztBQUFBLEVBQ3BGO0FBT0EsV0FBUyxXQUFXLE1BQU0sZUFBZSxPQUFPO0FBQzlDLFVBQU0sY0FBZSxPQUFPLE1BQU0sZ0JBQWdCLEtBQU07QUFDeEQsVUFBTSxJQUFJLEtBQUssTUFBTSxjQUFjLEVBQUU7QUFDckMsVUFBTSxJQUFLLGNBQWMsS0FBTTtBQUMvQixXQUFPLEVBQUUsR0FBRyxFQUFFO0FBQUEsRUFDaEI7QUFLQSxXQUFTLHVCQUF1QixVQUFVLEtBQUs7QUFDN0MsUUFBSSxDQUFDLFNBQVUsUUFBTztBQUN0QixRQUFJLE1BQU07QUFDVixVQUFNLGFBQWEsV0FBVyxJQUFJLFlBQVksR0FBRyxJQUFJLFNBQVMsSUFBSSxHQUFHLEdBQUc7QUFDeEUsVUFBTSxXQUFhLFdBQVcsSUFBSSxZQUFZLEdBQUcsSUFBSSxTQUFTLElBQUksR0FBRyxFQUFFO0FBQ3ZFLFVBQU0sV0FBVyxVQUFVLFdBQVcsR0FBRyxXQUFXLENBQUM7QUFDckQsVUFBTSxTQUFXLFVBQVUsU0FBUyxHQUFLLFNBQVMsQ0FBQztBQUNuRCxlQUFXLEtBQUssT0FBTyxLQUFLLFFBQVEsR0FBRztBQUNyQyxVQUFJLEtBQUssWUFBWSxLQUFLLFFBQVE7QUFDaEMsZUFBTyxPQUFPLFNBQVMsQ0FBQyxLQUFLLFNBQVMsQ0FBQyxFQUFFLE9BQU8sQ0FBQztBQUFBLE1BQ25EO0FBQUEsSUFDRjtBQUNBLFdBQU87QUFBQSxFQUNUO0FBT0EsV0FBUyxjQUFjLFVBQVUsS0FBSztBQUNwQyxVQUFNLE9BQU8sSUFBSSxZQUFZO0FBQzdCLFVBQU0sWUFBWSxJQUFJLFNBQVMsSUFBSTtBQUNuQyxRQUFJLFFBQVE7QUFDWixRQUFJLFVBQVU7QUFDWixlQUFTLElBQUksR0FBRyxLQUFLLFdBQVcsS0FBSztBQUNuQyxjQUFNLElBQUksVUFBVSxNQUFNLENBQUM7QUFDM0IsaUJBQVMsT0FBTyxTQUFTLENBQUMsS0FBSyxTQUFTLENBQUMsRUFBRSxPQUFPLENBQUM7QUFBQSxNQUNyRDtBQUFBLElBQ0Y7QUFDQSxXQUFPLEVBQUUsVUFBVSxPQUFPLG9CQUFvQixVQUFVO0FBQUEsRUFDMUQ7QUFHQSxpQkFBZSxnQkFBZ0I7QUFDN0IsUUFBSSxrQkFBbUIsUUFBTztBQUM5QixRQUFJLENBQUMsT0FBTyxLQUFNLE9BQU0sSUFBSSxNQUFNLDJCQUEyQjtBQUM3RCxVQUFNLE9BQU8sTUFBTSxPQUFPLEtBQUssV0FBVyxxQkFBcUIsRUFBRSxJQUFJO0FBQ3JFLFVBQU0sZ0JBQWdCLENBQUM7QUFDdkIsVUFBTSxhQUFhLENBQUM7QUFDcEIsU0FBSyxRQUFRLFNBQU87QUFDbEIsWUFBTSxJQUFJLElBQUksS0FBSztBQUNuQixVQUFJLENBQUMsS0FBSyxDQUFDLEVBQUUsSUFBSztBQUNsQixZQUFNLFdBQVcsT0FBTyxFQUFFLEdBQUcsRUFBRSxLQUFLLEVBQUUsWUFBWTtBQUNsRCxZQUFNLFNBQVM7QUFBQSxRQUNiLEtBQVksRUFBRTtBQUFBLFFBQ2QsVUFBWSxFQUFFLFlBQVk7QUFBQSxRQUMxQixTQUFZLEVBQUUsV0FBVztBQUFBLFFBQ3pCLFlBQVksRUFBRSxjQUFjO0FBQUEsUUFDNUIsT0FBWSxFQUFFLFNBQVMsQ0FBQztBQUFBLE1BQzFCO0FBQ0Esb0JBQWMsRUFBRSxHQUFHLElBQUk7QUFDdkIsaUJBQVcsUUFBUSxJQUFJO0FBQUEsSUFDekIsQ0FBQztBQUNELHdCQUFvQixFQUFFLGVBQWUsWUFBWSxPQUFPLEtBQUssS0FBSztBQUNsRSxXQUFPO0FBQUEsRUFDVDtBQUtBLFdBQVMsb0JBQW9CLFNBQVM7QUFDcEMsUUFBSSxDQUFDLFdBQVcsQ0FBQyxRQUFRLE9BQVEsUUFBTyxDQUFDO0FBQ3pDLFVBQU0sWUFBWSxRQUFRLENBQUM7QUFFM0IsUUFBSSxZQUFZO0FBQ2hCLGFBQVMsSUFBSSxHQUFHLElBQUksVUFBVSxRQUFRLEtBQUs7QUFDekMsWUFBTSxJQUFJLE9BQU8sVUFBVSxDQUFDLEtBQUssRUFBRSxFQUFFLEtBQUssRUFBRSxZQUFZO0FBQ3hELFVBQUksTUFBTSxTQUFTLE1BQU0sY0FBYyxNQUFNLFVBQVUsTUFBTSxlQUFlLE1BQU0sVUFBVTtBQUMxRixvQkFBWTtBQUNaO0FBQUEsTUFDRjtBQUFBLElBQ0Y7QUFDQSxRQUFJLFlBQVksRUFBRyxPQUFNLElBQUksTUFBTSw0RUFBNEU7QUFFL0csVUFBTSxZQUFZLENBQUM7QUFDbkIsYUFBUyxJQUFJLEdBQUcsSUFBSSxVQUFVLFVBQVUsVUFBVSxTQUFTLEdBQUcsS0FBSztBQUNqRSxVQUFJLE1BQU0sVUFBVyxXQUFVLEtBQUssQ0FBQztBQUFBLElBQ3ZDO0FBQ0EsUUFBSSxVQUFVLFNBQVMsRUFBRyxPQUFNLElBQUksTUFBTSxrRkFBa0YsVUFBVSxTQUFTLEdBQUc7QUFDbEosVUFBTSxNQUFNLENBQUM7QUFDYixhQUFTLElBQUksR0FBRyxJQUFJLFFBQVEsUUFBUSxLQUFLO0FBQ3ZDLFlBQU0sTUFBTSxRQUFRLENBQUM7QUFDckIsVUFBSSxDQUFDLE9BQU8sQ0FBQyxJQUFJLE9BQVE7QUFDekIsWUFBTSxTQUFTLElBQUksU0FBUztBQUM1QixVQUFJLFdBQVcsVUFBYSxXQUFXLFFBQVEsT0FBTyxNQUFNLEVBQUUsS0FBSyxNQUFNLEdBQUk7QUFDN0UsWUFBTSxNQUFNLE9BQU8sTUFBTSxFQUFFLEtBQUs7QUFDaEMsWUFBTSxXQUFXLFVBQVUsSUFBSSxPQUFLO0FBQ2xDLGNBQU0sSUFBSSxJQUFJLENBQUM7QUFDZixjQUFNLElBQUksT0FBTyxDQUFDO0FBQ2xCLGVBQU8sU0FBUyxDQUFDLElBQUksSUFBSTtBQUFBLE1BQzNCLENBQUM7QUFDRCxZQUFNLGNBQWMsU0FBUyxPQUFPLENBQUMsR0FBRyxNQUFNLElBQUksR0FBRyxDQUFDO0FBQ3RELFVBQUksS0FBSyxFQUFFLEtBQUssVUFBVSxZQUFZLENBQUM7QUFBQSxJQUN6QztBQUNBLFdBQU87QUFBQSxFQUNUO0FBR0EsV0FBUyxxQkFBcUIsVUFBVSxXQUFXLEtBQUs7QUFDdEQsVUFBTSxPQUFPLENBQUM7QUFDZCxlQUFXLE1BQU0sV0FBVztBQUMxQixZQUFNLFdBQVcsR0FBRyxJQUFJLFlBQVk7QUFDcEMsWUFBTSxPQUFPLFNBQVMsV0FBVyxRQUFRLEtBQUs7QUFDOUMsWUFBTSxZQUFZLE9BQU8sdUJBQXVCLEtBQUssT0FBTyxHQUFHLElBQUk7QUFDbkUsWUFBTSxNQUFNLE9BQU8sY0FBYyxLQUFLLE9BQU8sR0FBRyxJQUFJLEVBQUUsVUFBVSxHQUFHLG9CQUFvQixJQUFJLFNBQVMsSUFBSSxFQUFFO0FBQzFHLFlBQU0sV0FBVyxJQUFJLHFCQUFxQixJQUFJLElBQUksV0FBVyxJQUFJLHFCQUFxQjtBQUN0RixZQUFNLFdBQVcsV0FBVztBQUM1QixZQUFNLFFBQVEsR0FBRyxjQUFjO0FBQy9CLFdBQUssS0FBSztBQUFBLFFBQ1IsS0FBYSxHQUFHO0FBQUEsUUFDaEIsVUFBYSxPQUFPLEtBQUssV0FBVztBQUFBLFFBQ3BDLFNBQWEsT0FBTyxLQUFLLFVBQVU7QUFBQSxRQUNuQyxZQUFhLE9BQU8sS0FBSyxhQUFhO0FBQUEsUUFDdEM7QUFBQSxRQUNBLFVBQWEsR0FBRztBQUFBLFFBQ2hCO0FBQUEsUUFDQTtBQUFBLFFBQ0E7QUFBQSxRQUNBLGFBQWEsQ0FBQyxDQUFDO0FBQUEsTUFDakIsQ0FBQztBQUFBLElBQ0g7QUFDQSxXQUFPO0FBQUEsRUFDVDtBQUVBLFdBQVMsb0JBQW9CO0FBQzNCLFVBQU0sV0FBVyxTQUFTLGVBQWUsZ0JBQWdCO0FBQ3pELFFBQUksU0FBVSxRQUFPO0FBQ3JCLFVBQU0sS0FBSyxTQUFTLGNBQWMsS0FBSztBQUN2QyxPQUFHLEtBQUs7QUFDUixPQUFHLFlBQVk7QUFDZixPQUFHLE1BQU0sVUFBVTtBQUNuQixPQUFHLFVBQVUsU0FBVSxJQUFJO0FBQUUsVUFBSSxHQUFHLFdBQVcsR0FBSSxRQUFPLG1CQUFtQjtBQUFBLElBQUc7QUFDaEYsT0FBRyxZQUFZO0FBc0JmLGFBQVMsS0FBSyxZQUFZLEVBQUU7QUFDNUIsV0FBTztBQUFBLEVBQ1Q7QUFFQSxXQUFTLGFBQWEsTUFBTTtBQUMxQixVQUFNLE9BQU8sU0FBUyxlQUFlLGVBQWU7QUFDcEQsUUFBSSxDQUFDLEtBQU07QUFDWCxRQUFJLENBQUMsUUFBUSxDQUFDLEtBQUssUUFBUTtBQUN6QixXQUFLLFlBQVk7QUFDakI7QUFBQSxJQUNGO0FBQ0EsVUFBTSxNQUFNLENBQUMsTUFBTyxNQUFNLEtBQUssQ0FBQyxTQUFTLENBQUMsSUFBSyxNQUFNLE9BQU8sQ0FBQyxFQUFFLGVBQWUsU0FBUyxFQUFFLHVCQUF1QixFQUFFLENBQUM7QUFDbkgsVUFBTSxnQkFBZ0IsQ0FBQyxNQUFNO0FBQzNCLFVBQUksSUFBSSxFQUFHLFFBQU87QUFDbEIsVUFBSSxJQUFJLEVBQUcsUUFBTztBQUNsQixhQUFPO0FBQUEsSUFDVDtBQUNBLFVBQU0sV0FBVyxLQUFLO0FBQUEsTUFBSSxPQUFLLFNBQ2xCLEVBQUUsY0FBYyxLQUFLLGlDQUFpQywyRkFDNkIsZUFBZSxFQUFFLEdBQUcsSUFBSSxzREFDakUsZUFBZSxFQUFFLE9BQU8sSUFBSSxzREFDNUIsZUFBZSxFQUFFLFVBQVUsSUFBSSwwRkFDSyxJQUFJLEVBQUUsU0FBUyxJQUFJLDBHQUNILElBQUksRUFBRSxRQUFRLElBQUksd0dBQ3BCLElBQUksRUFBRSxRQUFRLElBQUksMEZBQ2hDLElBQUksRUFBRSxRQUFRLElBQUksK0dBQ0csY0FBYyxFQUFFLEtBQUssSUFBSSxPQUFPLElBQUksRUFBRSxLQUFLLElBQUk7QUFBQSxJQUUvSixFQUFFLEtBQUssRUFBRTtBQUNULFVBQU0sU0FBUztBQWFmLFNBQUssWUFBWSx1RUFBdUUsU0FBUyxZQUFZLFdBQVc7QUFBQSxFQUMxSDtBQUVBLFdBQVMsZUFBZSxHQUFHO0FBQ3pCLFFBQUksT0FBTyxPQUFPLGVBQWUsV0FBWSxRQUFPLE9BQU8sV0FBVyxDQUFDO0FBQ3ZFLFdBQU8sT0FBTyxLQUFLLE9BQU8sS0FBSyxDQUFDLEVBQUUsUUFBUSxZQUFZLFNBQU8sRUFBRSxLQUFJLFNBQVEsS0FBSSxRQUFPLEtBQUksUUFBTyxLQUFJLFVBQVMsS0FBSSxRQUFRLEdBQUUsRUFBRSxDQUFFO0FBQUEsRUFDbEk7QUFFQSxTQUFPLG9CQUFvQixpQkFBa0I7QUFDM0MsUUFBSSxDQUFDLGFBQWEsR0FBRztBQUNuQixZQUFNLHdDQUF3QztBQUM5QztBQUFBLElBQ0Y7QUFDQSxVQUFNLEtBQUssa0JBQWtCO0FBQzdCLE9BQUcsTUFBTSxVQUFVO0FBQ25CLFFBQUksaUJBQWtCO0FBQ3RCLFFBQUksQ0FBQyxtQkFBbUI7QUFDdEIseUJBQW1CO0FBQ25CLFlBQU0sUUFBUSxTQUFTLGVBQWUsZ0JBQWdCO0FBQ3RELFVBQUksTUFBTyxPQUFNLGNBQWM7QUFDL0IsVUFBSTtBQUNGLGNBQU0sY0FBYztBQUNwQixZQUFJLE1BQU8sT0FBTSxjQUFjLGtCQUFrQixRQUFRO0FBQUEsTUFDM0QsU0FBUyxHQUFHO0FBQ1YsWUFBSSxNQUFPLE9BQU0sY0FBYywrQkFBK0IsS0FBSyxFQUFFLFdBQVc7QUFDaEYsY0FBTSx1SkFBdUo7QUFBQSxNQUMvSixVQUFFO0FBQ0EsMkJBQW1CO0FBQUEsTUFDckI7QUFBQSxJQUNGLE9BQU87QUFDTCxZQUFNLFFBQVEsU0FBUyxlQUFlLGdCQUFnQjtBQUN0RCxVQUFJLE1BQU8sT0FBTSxjQUFjLGtCQUFrQixRQUFRO0FBQUEsSUFDM0Q7QUFBQSxFQUNGO0FBRUEsU0FBTyxxQkFBcUIsV0FBWTtBQUN0QyxVQUFNLEtBQUssU0FBUyxlQUFlLGdCQUFnQjtBQUNuRCxRQUFJLEdBQUksSUFBRyxNQUFNLFVBQVU7QUFBQSxFQUM3QjtBQUVBLFNBQU8sMEJBQTBCLGVBQWdCLE9BQU87QUFDdEQsVUFBTSxPQUFPLFNBQVMsTUFBTSxVQUFVLE1BQU0sT0FBTyxTQUFTLE1BQU0sT0FBTyxNQUFNLENBQUM7QUFDaEYsUUFBSSxDQUFDLEtBQU07QUFDWCxRQUFJO0FBQ0YsVUFBSSxDQUFDLGtCQUFtQixPQUFNLGNBQWM7QUFDNUMsWUFBTSxNQUFNLE1BQU0sS0FBSyxZQUFZO0FBQ25DLFVBQUksT0FBTyxTQUFTLGFBQWE7QUFBRSxjQUFNLGlCQUFpQjtBQUFHO0FBQUEsTUFBUTtBQUNyRSxZQUFNLEtBQUssS0FBSyxLQUFLLEtBQUssRUFBRSxNQUFNLFFBQVEsQ0FBQztBQUMzQyxZQUFNLFFBQVEsR0FBRyxPQUFPLEdBQUcsV0FBVyxDQUFDLENBQUM7QUFDeEMsWUFBTSxPQUFPLEtBQUssTUFBTSxjQUFjLE9BQU8sRUFBRSxRQUFRLEdBQUcsUUFBUSxNQUFNLEtBQUssS0FBSyxDQUFDO0FBQ25GLFlBQU0sU0FBUyxvQkFBb0IsSUFBSTtBQUN2QyxVQUFJLENBQUMsT0FBTyxRQUFRO0FBQUUsY0FBTSwrQ0FBK0M7QUFBRztBQUFBLE1BQVE7QUFDdEYsMkJBQXFCO0FBQ3JCLFlBQU0sTUFBTSxvQkFBSSxLQUFLO0FBQ3JCLHNCQUFnQixxQkFBcUIsbUJBQW1CLFFBQVEsR0FBRztBQUNuRSxtQkFBYSxhQUFhO0FBQzFCLFlBQU0sV0FBVyxjQUFjLE9BQU8sT0FBSyxDQUFDLEVBQUUsV0FBVyxFQUFFO0FBQzNELFlBQU0sUUFBUSxTQUFTLGVBQWUsZ0JBQWdCO0FBQ3RELFVBQUksT0FBTztBQUNULGNBQU0sY0FBYyxPQUFPLFNBQVMsK0JBQy9CLE9BQU8sU0FBUyxZQUFZLHdCQUM3QixXQUFXO0FBQUEsTUFDakI7QUFDQSxZQUFNLE1BQU0sU0FBUyxlQUFlLHFCQUFxQjtBQUN6RCxVQUFJLEtBQUs7QUFBRSxZQUFJLFdBQVc7QUFBTyxZQUFJLE1BQU0sVUFBVTtBQUFBLE1BQUs7QUFBQSxJQUM1RCxTQUFTLEdBQUc7QUFDVixjQUFRLE1BQU0sMkJBQTJCLENBQUM7QUFDMUMsWUFBTSxrQ0FBa0MsS0FBSyxFQUFFLFdBQVcsRUFBRTtBQUFBLElBQzlELFVBQUU7QUFFQSxVQUFJLFNBQVMsTUFBTSxPQUFRLE9BQU0sT0FBTyxRQUFRO0FBQUEsSUFDbEQ7QUFBQSxFQUNGO0FBRUEsU0FBTyxzQkFBc0IsV0FBWTtBQUN2QyxRQUFJLENBQUMsaUJBQWlCLENBQUMsY0FBYyxRQUFRO0FBQUUsWUFBTSwwREFBMEQ7QUFBRztBQUFBLElBQVE7QUFDMUgsUUFBSSxPQUFPLFNBQVMsYUFBYTtBQUFFLFlBQU0saUJBQWlCO0FBQUc7QUFBQSxJQUFRO0FBQ3JFLFVBQU0sU0FBUyxPQUFLLEtBQUssTUFBTSxPQUFPLEtBQUssQ0FBQyxJQUFJLEVBQUUsSUFBSTtBQUN0RCxVQUFNLE1BQU0sQ0FBQztBQUFBLE1BQ1g7QUFBQSxNQUFPO0FBQUEsTUFBVztBQUFBLE1BQ2xCO0FBQUEsTUFBZ0I7QUFBQSxNQUNoQjtBQUFBLE1BQTBCO0FBQUEsTUFBK0I7QUFBQSxJQUMzRCxDQUFDO0FBQ0QsZUFBVyxLQUFLLGVBQWU7QUFDN0IsVUFBSSxLQUFLO0FBQUEsUUFDUCxFQUFFO0FBQUEsUUFBSyxFQUFFO0FBQUEsUUFBUyxFQUFFO0FBQUEsUUFDcEIsT0FBTyxFQUFFLFNBQVM7QUFBQSxRQUFHLE9BQU8sRUFBRSxRQUFRO0FBQUEsUUFDdEMsT0FBTyxFQUFFLFFBQVE7QUFBQSxRQUFHLE9BQU8sRUFBRSxRQUFRO0FBQUEsUUFBRyxPQUFPLEVBQUUsS0FBSztBQUFBLE1BQ3hELENBQUM7QUFBQSxJQUNIO0FBQ0EsVUFBTSxLQUFLLEtBQUssTUFBTSxhQUFhLEdBQUc7QUFFdEMsT0FBRyxPQUFPLElBQUk7QUFBQSxNQUNaLEVBQUUsS0FBSyxHQUFHO0FBQUEsTUFBRyxFQUFFLEtBQUssR0FBRztBQUFBLE1BQUcsRUFBRSxLQUFLLEdBQUc7QUFBQSxNQUNwQyxFQUFFLEtBQUssR0FBRztBQUFBLE1BQUcsRUFBRSxLQUFLLEdBQUc7QUFBQSxNQUN2QixFQUFFLEtBQUssR0FBRztBQUFBLE1BQUcsRUFBRSxLQUFLLEdBQUc7QUFBQSxNQUFHLEVBQUUsS0FBSyxHQUFHO0FBQUEsSUFDdEM7QUFDQSxVQUFNLEtBQUssS0FBSyxNQUFNLFNBQVM7QUFDL0IsU0FBSyxNQUFNLGtCQUFrQixJQUFJLElBQUksVUFBVTtBQUMvQyxVQUFNLE1BQU0sb0JBQUksS0FBSztBQUNyQixVQUFNLFFBQVEsSUFBSSxZQUFZLElBQUksTUFBTSxPQUFPLElBQUksU0FBUyxJQUFJLENBQUMsRUFBRSxTQUFTLEdBQUcsR0FBRyxJQUFJLE1BQU0sT0FBTyxJQUFJLFFBQVEsQ0FBQyxFQUFFLFNBQVMsR0FBRyxHQUFHO0FBQ2pJLFNBQUssVUFBVSxJQUFJLHNCQUFzQixRQUFRLE9BQU87QUFBQSxFQUMxRDtBQUlBLFNBQU8seUJBQXlCLGlCQUFrQjtBQUNoRCx3QkFBb0I7QUFDcEIsVUFBTSxjQUFjO0FBQ3BCLFFBQUksb0JBQW9CO0FBQ3RCLFlBQU0sTUFBTSxvQkFBSSxLQUFLO0FBQ3JCLHNCQUFnQixxQkFBcUIsbUJBQW1CLG9CQUFvQixHQUFHO0FBQy9FLG1CQUFhLGFBQWE7QUFBQSxJQUM1QjtBQUFBLEVBQ0Y7IiwKICAibmFtZXMiOiBbXQp9Cg==
