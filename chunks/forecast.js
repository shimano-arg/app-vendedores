"use strict";
(() => {
  // src/pure/sales-plan-parser.js
  var MONTH_ALIASES = {
    jan: 1,
    january: 1,
    ene: 1,
    enero: 1,
    feb: 2,
    february: 2,
    febrero: 2,
    mar: 3,
    march: 3,
    marzo: 3,
    apr: 4,
    april: 4,
    abr: 4,
    abril: 4,
    may: 5,
    mayo: 5,
    jun: 6,
    june: 6,
    junio: 6,
    jul: 7,
    july: 7,
    julio: 7,
    aug: 8,
    august: 8,
    ago: 8,
    agosto: 8,
    sep: 9,
    sept: 9,
    september: 9,
    septiembre: 9,
    oct: 10,
    october: 10,
    octubre: 10,
    nov: 11,
    november: 11,
    noviembre: 11,
    dec: 12,
    december: 12,
    dic: 12,
    diciembre: 12
  };
  function normalizeMonthLabel(label) {
    if (label == null) return null;
    const s = String(label).trim().toLowerCase();
    if (!s) return null;
    let m;
    m = s.match(/^([a-záéíóú]{3,10})[\s\-\/._]*(\d{2,4})$/);
    if (m) {
      const mon = MONTH_ALIASES[m[1]] || MONTH_ALIASES[m[1].slice(0, 3)];
      if (mon) {
        let y = parseInt(m[2], 10);
        if (y < 100) y = 2e3 + y;
        return String(y).padStart(4, "0") + "-" + String(mon).padStart(2, "0");
      }
    }
    m = s.match(/^(\d{4})[-/](\d{1,2})$/);
    if (m) {
      const y = parseInt(m[1], 10);
      const mon = parseInt(m[2], 10);
      if (mon >= 1 && mon <= 12) return String(y).padStart(4, "0") + "-" + String(mon).padStart(2, "0");
    }
    m = s.match(/^(\d{1,2})[-/](\d{4})$/);
    if (m) {
      const mon = parseInt(m[1], 10);
      const y = parseInt(m[2], 10);
      if (mon >= 1 && mon <= 12) return String(y).padStart(4, "0") + "-" + String(mon).padStart(2, "0");
    }
    return null;
  }
  function findHeaderRow(rows) {
    const HEADER_MARKERS = [
      "sku code/part no",
      "sku code",
      "sku",
      "part no",
      "part number",
      "itemcode",
      "item code",
      "codigo",
      "c\xF3digo"
    ];
    for (let i = 0; i < Math.min(rows.length, 30); i++) {
      const row = rows[i] || [];
      for (const cell of row) {
        const s = String(cell == null ? "" : cell).trim().toLowerCase();
        if (HEADER_MARKERS.indexOf(s) >= 0) return i;
      }
    }
    return -1;
  }
  function detectColumns(headerRow, hintRowAbove) {
    let skuIdx = -1;
    let descIdx = -1;
    let moqIdx = -1;
    const monthColumns = [];
    const detectedMonthsSet = /* @__PURE__ */ new Set();
    for (let i = 0; i < headerRow.length; i++) {
      const raw = String(headerRow[i] == null ? "" : headerRow[i]).trim();
      const s = raw.toLowerCase();
      if (skuIdx < 0 && (s === "sku code/part no" || s === "sku code" || s === "sku" || s === "part no" || s === "part number" || s === "itemcode" || s === "item code" || s === "codigo" || s === "c\xF3digo")) {
        skuIdx = i;
        continue;
      }
      if (descIdx < 0 && (s === "description" || s === "descripcion" || s === "descripci\xF3n" || s === "item name" || s === "itemname")) {
        descIdx = i;
        continue;
      }
      if (moqIdx < 0 && (s === "moq 12 months" || s === "moq" || s.indexOf("moq") === 0)) {
        moqIdx = i;
        continue;
      }
      let monthKey = normalizeMonthLabel(raw);
      if (!monthKey && hintRowAbove && hintRowAbove[i] != null) {
        const hint = String(hintRowAbove[i]).trim();
        if (hint) {
          monthKey = normalizeMonthLabel(raw + " " + hint) || normalizeMonthLabel(hint + " " + raw);
        }
      }
      if (monthKey) {
        monthColumns.push({ colIdx: i, monthKey });
        detectedMonthsSet.add(monthKey);
      }
    }
    return {
      skuIdx,
      descIdx,
      moqIdx,
      monthColumns,
      detectedMonths: Array.from(detectedMonthsSet).sort()
    };
  }
  function parseSalesPlanSheet(rows) {
    if (!rows || !rows.length) {
      const err = new Error("Excel vacio");
      err.code = "EMPTY_SHEET";
      throw err;
    }
    const headerIdx = findHeaderRow(rows);
    if (headerIdx < 0) {
      const err = new Error('No se encontro fila de headers (buscaba "SKU Code/Part No" o "SKU")');
      err.code = "HEADER_NOT_FOUND";
      throw err;
    }
    const headerRow = rows[headerIdx] || [];
    const rowAbove = headerIdx > 0 ? rows[headerIdx - 1] || [] : null;
    const cols = detectColumns(headerRow, rowAbove);
    if (cols.skuIdx < 0) {
      const err = new Error("No se encontro columna SKU en la fila header");
      err.code = "SKU_COL_MISSING";
      throw err;
    }
    if (!cols.monthColumns.length) {
      const err = new Error('No se detectaron columnas de meses en el header (ej: "Jan 2027", "May 2027")');
      err.code = "MONTHS_NOT_FOUND";
      throw err;
    }
    const parsedRows = [];
    const seenSku = /* @__PURE__ */ new Set();
    for (let r = headerIdx + 1; r < rows.length; r++) {
      const row = rows[r] || [];
      const skuRaw = row[cols.skuIdx];
      if (skuRaw == null || String(skuRaw).trim() === "") continue;
      const sku = String(skuRaw).trim();
      const upper = sku.toUpperCase();
      if (upper === "TOTAL" || upper === "SUM" || upper === "SUBTOTAL" || upper === "TOTALES") continue;
      if (seenSku.has(upper)) continue;
      seenSku.add(upper);
      const description = cols.descIdx >= 0 ? String(row[cols.descIdx] == null ? "" : row[cols.descIdx]).trim() : "";
      const moqRaw = cols.moqIdx >= 0 ? row[cols.moqIdx] : null;
      const moqNum = Number(moqRaw);
      const moq = Number.isFinite(moqNum) && moqNum > 0 ? Math.round(moqNum) : 0;
      const months = {};
      for (const mc of cols.monthColumns) {
        const v = row[mc.colIdx];
        const n = Number(v);
        if (Number.isFinite(n) && n > 0) {
          months[mc.monthKey] = Math.round(n);
        }
      }
      parsedRows.push({ sku, description, moq, months });
    }
    return {
      headerRowIndex: headerIdx,
      detectedMonths: cols.detectedMonths,
      rowsCount: parsedRows.length,
      rows: parsedRows
    };
  }
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { parseSalesPlanSheet, normalizeMonthLabel, findHeaderRow, detectColumns };
  }
  if (typeof window !== "undefined") {
    window.SalesPlanParser = { parseSalesPlanSheet, normalizeMonthLabel, findHeaderRow, detectColumns };
  }

  // src/domains/forecast.js
  var _forecastSnapshot = null;
  var _forecastSalesPlan = null;
  var _forecastRows = null;
  var _forecastLoading = false;
  var SALES_PLAN_FAMILIAS = [
    { key: "rods", label: "Rods (Ca\xF1as)", color: "#0ea5e9" },
    { key: "reels", label: "Reels", color: "#8b5cf6" },
    { key: "fg", label: "FG (resto)", color: "#f59e0b" }
  ];
  var _salesPlanCaches = { rods: null, reels: null, fg: null };
  var _forecastActiveTab = "sales-plans";
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
    const shellHtml = _buildShellHtml();
    el.innerHTML = shellHtml;
    document.body.appendChild(el);
    return el;
  }
  function _buildShellHtml() {
    const modalOuter = '<div style="position:absolute;inset:1vh 1vw;background:var(--bg-elevated);border-radius:10px;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 20px 50px rgba(0,0,0,.35)">';
    const header = '<div style="padding:12px 18px;background:#0f172a;color:#fff;display:flex;align-items:center;gap:12px"><div style="flex:1"><div style="font-size:16px;font-weight:800;letter-spacing:.5px">FORECAST</div><div id="forecast-subtitle" style="font-size:11px;opacity:.8;margin-top:2px">Sales Plans mensuales + politica de inventario</div></div><button onclick="closeForecastModal()" style="background:transparent;color:#fff;border:1px solid rgba(255,255,255,.4);border-radius:6px;padding:6px 10px;cursor:pointer;font-weight:700">Cerrar</button></div>';
    const tabsBar = `<div id="forecast-tabs-bar" style="display:flex;gap:0;background:#1e293b;padding:0 18px;border-bottom:1px solid var(--border-subtle)"><button data-tab="sales-plans" onclick="switchForecastTab('sales-plans')" class="forecast-tab" style="padding:10px 16px;background:transparent;color:#fff;border:none;border-bottom:3px solid #0d9488;cursor:pointer;font-weight:700;font-size:12px;letter-spacing:.4px;text-transform:uppercase">Sales Plans</button><button data-tab="legacy" onclick="switchForecastTab('legacy')" class="forecast-tab" style="padding:10px 16px;background:transparent;color:#94a3b8;border:none;border-bottom:3px solid transparent;cursor:pointer;font-weight:600;font-size:12px;letter-spacing:.4px;text-transform:uppercase">Forecast Legacy (6m)</button></div>`;
    const tabSalesPlans = '<div id="forecast-tab-sales-plans" style="flex:1;overflow:auto"></div>';
    const legacyBar = '<div style="padding:12px 18px;background:var(--bg-secondary);border-bottom:1px solid var(--border-subtle);display:flex;flex-wrap:wrap;gap:14px;align-items:center"><label style="display:inline-flex;align-items:center;gap:8px;padding:8px 12px;background:#0d9488;color:#fff;border-radius:6px;font-weight:700;font-size:12px;cursor:pointer"><span>Cargar Sales Plan (.xlsx)</span><input type="file" accept=".xlsx,.xls" style="display:none" onchange="onForecastSalesPlanFile(event)"/></label><div id="forecast-hint" style="font-size:11px;color:var(--text-muted);max-width:520px">Formato legacy: primera columna <b>SKU</b>, luego 6 columnas con las unidades pedidas mes a mes.</div><button id="forecast-export-btn" onclick="exportForecastExcel()" disabled style="padding:8px 14px;background:var(--color-success);color:#fff;border:none;border-radius:6px;font-weight:700;cursor:pointer;opacity:.5">Exportar Excel</button><div id="forecast-stats" style="margin-left:auto;font-size:11px;color:var(--text-secondary);font-weight:600"></div></div>';
    const legacyBody = '<div id="forecast-body" style="flex:1;overflow:auto;padding:0"><div style="padding:60px 20px;text-align:center;color:var(--text-muted);font-size:14px">Esperando archivo Sales Plan...</div></div>';
    const tabLegacy = '<div id="forecast-tab-legacy" style="flex:1;overflow:hidden;flex-direction:column;display:none">' + legacyBar + legacyBody + "</div>";
    return modalOuter + header + tabsBar + tabSalesPlans + tabLegacy + "</div>";
  }
  window.switchForecastTab = function(tabId) {
    _forecastActiveTab = tabId;
    const sp = document.getElementById("forecast-tab-sales-plans");
    const lg = document.getElementById("forecast-tab-legacy");
    if (sp) sp.style.display = tabId === "sales-plans" ? "block" : "none";
    if (lg) lg.style.display = tabId === "legacy" ? "flex" : "none";
    const btns = document.querySelectorAll("#forecast-tabs-bar .forecast-tab");
    btns.forEach((b) => {
      const active = b.getAttribute("data-tab") === tabId;
      b.style.color = active ? "#fff" : "#94a3b8";
      b.style.borderBottomColor = active ? "#0d9488" : "transparent";
      b.style.fontWeight = active ? "700" : "600";
    });
  };
  function _yearMonthNow() {
    const d = /* @__PURE__ */ new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
  }
  function _fmtSize(bytes) {
    if (!bytes) return "";
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(2) + " MB";
  }
  function _fmtDateShort(iso) {
    if (!iso) return "\u2014";
    try {
      const d = iso.toDate ? iso.toDate() : new Date(iso);
      return d.toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "2-digit" }) + " " + d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
    } catch {
      return String(iso);
    }
  }
  async function _loadSalesPlanCaches() {
    if (!window.fbDb) return;
    await Promise.all(SALES_PLAN_FAMILIAS.map(async (f) => {
      try {
        const doc = await window.fbDb.collection("sales_plan_cache").doc(f.key).get();
        _salesPlanCaches[f.key] = doc.exists ? doc.data() : null;
      } catch (e) {
        console.warn("[FORECAST] load sales_plan_cache/" + f.key + " fail:", e && e.message);
        _salesPlanCaches[f.key] = null;
      }
    }));
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
  function _buildSalesPlanSlotHtml(f) {
    const cache = _salesPlanCaches[f.key];
    const rowsCount = cache && Number.isFinite(cache.rowsCount) ? cache.rowsCount : 0;
    const monthsCount = cache && Array.isArray(cache.detectedMonths) ? cache.detectedMonths.length : 0;
    const parsedAt = cache && cache.parsedAt ? _fmtDateShort(cache.parsedAt) : "";
    const uploadedBy = cache && cache.uploadedBy ? cache.uploadedBy : "";
    const sourceFilename = cache && cache.sourceFilename ? cache.sourceFilename : "";
    const yearMonth = cache && cache.yearMonth ? cache.yearMonth : "";
    const monthsRange = cache && cache.detectedMonths && cache.detectedMonths.length ? cache.detectedMonths[0] + " \u2192 " + cache.detectedMonths[cache.detectedMonths.length - 1] : "\u2014";
    const hasCache = !!cache;
    const badge = hasCache ? '<div style="padding:4px 8px;background:#16a34a;color:#fff;border-radius:12px;font-size:10px;font-weight:700;letter-spacing:.4px">CARGADO</div>' : '<div style="padding:4px 8px;background:#dc2626;color:#fff;border-radius:12px;font-size:10px;font-weight:700;letter-spacing:.4px">FALTA</div>';
    const metaBlock = hasCache ? '<div style="display:grid;grid-template-columns:auto 1fr;gap:6px 12px;font-size:11px;padding:10px 12px;background:var(--bg-secondary);border-radius:6px"><div style="color:var(--text-muted);font-weight:600">Archivo</div><div style="color:var(--text-primary);font-family:monospace;word-break:break-all">' + escapeHtmlSafe(sourceFilename) + '</div><div style="color:var(--text-muted);font-weight:600">Subido</div><div style="color:var(--text-primary)">' + escapeHtmlSafe(parsedAt) + '</div><div style="color:var(--text-muted);font-weight:600">Por</div><div style="color:var(--text-primary)">' + escapeHtmlSafe(uploadedBy) + '</div><div style="color:var(--text-muted);font-weight:600">Snapshot</div><div style="color:var(--text-primary);font-family:monospace">' + escapeHtmlSafe(yearMonth) + '</div><div style="color:var(--text-muted);font-weight:600">SKUs</div><div style="color:var(--text-primary);font-weight:700">' + rowsCount.toLocaleString("es-AR") + '</div><div style="color:var(--text-muted);font-weight:600">Meses</div><div style="color:var(--text-primary);font-weight:700">' + monthsCount + ' <span style="color:var(--text-muted);font-weight:400">(' + escapeHtmlSafe(monthsRange) + ")</span></div></div>" : '<div style="padding:14px;text-align:center;font-size:12px;color:var(--text-muted);background:var(--bg-secondary);border-radius:6px;border:1px dashed var(--border-subtle)">Aun no subiste el Sales Plan de esta familia.</div>';
    const uploadBtn = '<label style="display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:10px 14px;background:' + f.color + ';color:#fff;border-radius:6px;font-weight:700;font-size:12px;cursor:pointer;letter-spacing:.4px"><span>' + (hasCache ? "\u21BB Reemplazar Excel" : "\u2B06 Cargar Excel") + '</span><input type="file" accept=".xlsx,.xls" data-familia="' + f.key + `" style="display:none" onchange="onSalesPlanFileForFamilia(event, '` + f.key + `')"/></label>`;
    const cardHead = '<div style="display:flex;align-items:center;gap:10px"><div style="width:12px;height:32px;background:' + f.color + ';border-radius:3px"></div><div style="flex:1"><div style="font-size:14px;font-weight:800;color:var(--text-primary)">' + escapeHtmlSafe(f.label) + '</div><div style="font-size:11px;color:var(--text-muted);margin-top:2px">Sales Plan mensual \xB7 Hoja SAR</div></div>' + badge + "</div>";
    return '<div style="background:var(--bg-elevated);border:1px solid var(--border-subtle);border-radius:10px;padding:16px;display:flex;flex-direction:column;gap:12px">' + cardHead + metaBlock + uploadBtn + '<div id="sales-plan-status-' + f.key + '" style="font-size:11px;color:var(--text-muted);min-height:14px"></div></div>';
  }
  function _renderSalesPlansTab() {
    const cont = document.getElementById("forecast-tab-sales-plans");
    if (!cont) return;
    const slots = SALES_PLAN_FAMILIAS.map(_buildSalesPlanSlotHtml).join("");
    const intro = '<div style="margin-bottom:16px;padding:12px 14px;background:var(--bg-secondary);border-left:3px solid #0d9488;border-radius:6px;font-size:12px;color:var(--text-secondary);line-height:1.5"><b style="color:var(--text-primary)">Fase 1</b> \u2014 Carg\xE1 los 3 Sales Plans mensuales (Rods / Reels / FG). Se parsea la hoja <b>SAR</b>: SKU, MOQ 12 months, y una columna por mes. El Excel original queda snapshotado en Storage y el parseo queda en Firestore para el c\xE1lculo (pr\xF3xima fase).</div>';
    const grid = '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px">' + slots + "</div>";
    cont.innerHTML = '<div style="padding:18px">' + intro + grid + "</div>";
  }
  window.onSalesPlanFileForFamilia = async function(event, familia) {
    const file = event && event.target && event.target.files && event.target.files[0];
    if (!file) return;
    const statusEl = document.getElementById("sales-plan-status-" + familia);
    const setStatus = (msg, color) => {
      if (!statusEl) return;
      statusEl.textContent = msg;
      statusEl.style.color = color || "var(--text-muted)";
    };
    try {
      if (typeof XLSX === "undefined") {
        alert("SheetJS (XLSX) no cargado \u2014 recarg\xE1 la app.");
        return;
      }
      if (!window.SalesPlanParser || !window.SalesPlanParser.parseSalesPlanSheet) {
        alert("Parser Sales Plan no cargado. Rebuild bundle.");
        return;
      }
      if (!window.firebase || !window.firebase.storage) {
        alert("Firebase Storage no disponible.");
        return;
      }
      setStatus("Leyendo Excel\u2026");
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const sarName = wb.SheetNames.find((n) => String(n || "").trim().toUpperCase() === "SAR");
      if (!sarName) {
        setStatus('\u26A0 El Excel no tiene hoja "SAR". Hojas encontradas: ' + wb.SheetNames.join(", "), "#dc2626");
        return;
      }
      const sheet = wb.Sheets[sarName];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: true });
      setStatus("Parseando " + rows.length + ' filas de hoja "' + sarName + '"\u2026');
      const parsed = window.SalesPlanParser.parseSalesPlanSheet(rows);
      if (!parsed.rows.length) {
        setStatus("\u26A0 Excel parseado pero sin SKUs v\xE1lidos.", "#dc2626");
        return;
      }
      const yearMonth = _yearMonthNow();
      const storagePath = "forecasts_snapshots/" + yearMonth + "/" + familia + ".xlsx";
      setStatus("Subiendo Excel a Storage (" + _fmtSize(file.size) + ")\u2026");
      const storageRef = window.firebase.storage().ref(storagePath);
      await storageRef.put(file, {
        contentType: file.type || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        customMetadata: {
          familia,
          uploadedBy: window.currentUser && window.currentUser.email || "",
          sourceFilename: file.name || ""
        }
      });
      setStatus("Guardando parseo en Firestore (" + parsed.rows.length + " SKUs)\u2026");
      const uploadedBy = window.currentUser && window.currentUser.email || "unknown";
      const payload = {
        familia,
        parsedAt: window.firebase && window.firebase.firestore && window.firebase.firestore.FieldValue ? window.firebase.firestore.FieldValue.serverTimestamp() : (/* @__PURE__ */ new Date()).toISOString(),
        uploadedBy,
        sourceFilename: file.name || "",
        sourceSheet: sarName,
        yearMonth,
        storagePath,
        rowsCount: parsed.rows.length,
        headerRowIndex: parsed.headerRowIndex,
        detectedMonths: parsed.detectedMonths,
        rows: parsed.rows
      };
      await window.fbDb.collection("sales_plan_cache").doc(familia).set(payload);
      _salesPlanCaches[familia] = payload;
      setStatus("\u2713 OK. " + parsed.rows.length + " SKUs \xD7 " + parsed.detectedMonths.length + " meses.", "#16a34a");
      _renderSalesPlansTab();
    } catch (e) {
      console.error("[FORECAST] upload sales plan " + familia + " fail:", e);
      setStatus("\u2717 Error: " + (e && e.message || e), "#dc2626");
      if (e && e.code === "MONTHS_NOT_FOUND") {
        alert('El Excel no tiene columnas de meses reconocibles.\n\nHeaders esperados: "Jan 2027", "May 2027", "Ene 2027", "2027-01", etc.\n\nDetalle: ' + e.message);
      }
    } finally {
      if (event && event.target) event.target.value = "";
    }
  };
  window.openForecastModal = async function() {
    if (!_canForecast()) {
      alert("FORECAST es solo para Mariano (admin).");
      return;
    }
    const el = _renderModalShell();
    el.style.display = "block";
    _renderSalesPlansTab();
    _loadSalesPlanCaches().then(_renderSalesPlansTab).catch(() => {
    });
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
        console.warn("[FORECAST] snapshot load fail (legacy tab)", e);
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL3B1cmUvc2FsZXMtcGxhbi1wYXJzZXIuanMiLCAiLi4vc3JjL2RvbWFpbnMvZm9yZWNhc3QuanMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbIi8vIEB0cy1ub2NoZWNrXG4vLyBQdXJlOiBwYXJzZWEgdW4gc2hlZXQgU2FsZXMgUGxhbiAoZm9ybWF0byBTVVIvU0FSIGRlIFNoaW1hbm8pIGEgZXN0cnVjdHVyYVxuLy8gbm9ybWFsaXphZGEgeyBza3UsIGRlc2NyaXB0aW9uLCBtb3EsIG1vbnRoczogeydZWVlZLU1NJzogTn0gfS5cbi8vIFNpbiBkZXBlbmRlbmNpYXMgXHUyMDE0IHJlY2liZSBlbCBzaGVldCB5YSBkZXNlcmlhbGl6YWRvIHBvciBTaGVldEpTXG4vLyAoWExTWC51dGlscy5zaGVldF90b19qc29uKHNoZWV0LCB7aGVhZGVyOjEsIGRlZnZhbDonJ30pKS5cbi8vIFRlc3RlYWJsZSBlbiB2aXRlc3Qgc2luIGNhcmdhciBYTFNYLlxuLy9cbi8vIENvbnRleHRvOiBsb3MgU2FsZXMgUGxhbnMgZGUgU2hpbWFubyB2aWVuZW4gY29uIGhlYWRlcnMgY29tb1xuLy8gXCJTS1UgQ29kZS9QYXJ0IE5vXCIsIFwiRGVzY3JpcHRpb25cIiwgXCJNT1EgMTIgbW9udGhzXCIgeSBjb2x1bW5hcyBkZSBtZXNlc1xuLy8gdGlwbyBcIkphbiAyMDI3XCIsIFwiTWF5IDIwMjdcIiAoYSB2ZWNlcyBjb24gYVx1MDBGMW8gZW4gdW5hIGZpbGEgYXJyaWJhIHkgZWwgbWVzXG4vLyBlbiBsYSBmaWxhIGhlYWRlcikuIEVzdGEgZm4gdG9sZXJhIGFtYm9zIGxheW91dHMuXG5cbmNvbnN0IE1PTlRIX0FMSUFTRVMgPSB7XG4gIGphbjogMSwgamFudWFyeTogMSwgZW5lOiAxLCBlbmVybzogMSxcbiAgZmViOiAyLCBmZWJydWFyeTogMiwgZmVicmVybzogMixcbiAgbWFyOiAzLCBtYXJjaDogMywgbWFyem86IDMsXG4gIGFwcjogNCwgYXByaWw6IDQsIGFicjogNCwgYWJyaWw6IDQsXG4gIG1heTogNSwgbWF5bzogNSxcbiAganVuOiA2LCBqdW5lOiA2LCBqdW5pbzogNixcbiAganVsOiA3LCBqdWx5OiA3LCBqdWxpbzogNyxcbiAgYXVnOiA4LCBhdWd1c3Q6IDgsIGFnbzogOCwgYWdvc3RvOiA4LFxuICBzZXA6IDksIHNlcHQ6IDksIHNlcHRlbWJlcjogOSwgc2VwdGllbWJyZTogOSxcbiAgb2N0OiAxMCwgb2N0b2JlcjogMTAsIG9jdHVicmU6IDEwLFxuICBub3Y6IDExLCBub3ZlbWJlcjogMTEsIG5vdmllbWJyZTogMTEsXG4gIGRlYzogMTIsIGRlY2VtYmVyOiAxMiwgZGljOiAxMiwgZGljaWVtYnJlOiAxMixcbn07XG5cbi8vIE5vcm1hbGl6YSBsYWJlbHMgZGUgbWVzZXMgYSAnWVlZWS1NTScuIFJldG9ybmEgbnVsbCBzaSBubyBtYXRjaGVhLlxuLy8gRm9ybWF0b3Mgc29wb3J0YWRvczogXCJKYW4gMjAyN1wiLCBcIkVuZS0yN1wiLCBcIkphbi8yMDI3XCIsIFwiTWF5MjdcIixcbi8vIFwiMjAyNy0wMVwiLCBcIjAxLzIwMjdcIiwgXCJKYW4uMjAyN1wiLlxuZnVuY3Rpb24gbm9ybWFsaXplTW9udGhMYWJlbChsYWJlbCkge1xuICBpZiAobGFiZWwgPT0gbnVsbCkgcmV0dXJuIG51bGw7XG4gIGNvbnN0IHMgPSBTdHJpbmcobGFiZWwpLnRyaW0oKS50b0xvd2VyQ2FzZSgpO1xuICBpZiAoIXMpIHJldHVybiBudWxsO1xuICBsZXQgbTtcbiAgLy8gXCJqYW4gMjAyN1wiIHwgXCJqYW4tMjdcIiB8IFwiZW5lLzIwMjdcIiB8IFwibWF5MjdcIiB8IFwibWF5LjIwMjdcIlxuICBtID0gcy5tYXRjaCgvXihbYS16XHUwMEUxXHUwMEU5XHUwMEVEXHUwMEYzXHUwMEZBXXszLDEwfSlbXFxzXFwtXFwvLl9dKihcXGR7Miw0fSkkLyk7XG4gIGlmIChtKSB7XG4gICAgY29uc3QgbW9uID0gTU9OVEhfQUxJQVNFU1ttWzFdXSB8fCBNT05USF9BTElBU0VTW21bMV0uc2xpY2UoMCwgMyldO1xuICAgIGlmIChtb24pIHtcbiAgICAgIGxldCB5ID0gcGFyc2VJbnQobVsyXSwgMTApO1xuICAgICAgaWYgKHkgPCAxMDApIHkgPSAyMDAwICsgeTtcbiAgICAgIHJldHVybiBTdHJpbmcoeSkucGFkU3RhcnQoNCwgJzAnKSArICctJyArIFN0cmluZyhtb24pLnBhZFN0YXJ0KDIsICcwJyk7XG4gICAgfVxuICB9XG4gIC8vIFwiMjAyNy0wMVwiIHwgXCIyMDI3LzAxXCJcbiAgbSA9IHMubWF0Y2goL14oXFxkezR9KVstL10oXFxkezEsMn0pJC8pO1xuICBpZiAobSkge1xuICAgIGNvbnN0IHkgPSBwYXJzZUludChtWzFdLCAxMCk7XG4gICAgY29uc3QgbW9uID0gcGFyc2VJbnQobVsyXSwgMTApO1xuICAgIGlmIChtb24gPj0gMSAmJiBtb24gPD0gMTIpIHJldHVybiBTdHJpbmcoeSkucGFkU3RhcnQoNCwgJzAnKSArICctJyArIFN0cmluZyhtb24pLnBhZFN0YXJ0KDIsICcwJyk7XG4gIH1cbiAgLy8gXCIwMS8yMDI3XCIgfCBcIjAxLTIwMjdcIlxuICBtID0gcy5tYXRjaCgvXihcXGR7MSwyfSlbLS9dKFxcZHs0fSkkLyk7XG4gIGlmIChtKSB7XG4gICAgY29uc3QgbW9uID0gcGFyc2VJbnQobVsxXSwgMTApO1xuICAgIGNvbnN0IHkgPSBwYXJzZUludChtWzJdLCAxMCk7XG4gICAgaWYgKG1vbiA+PSAxICYmIG1vbiA8PSAxMikgcmV0dXJuIFN0cmluZyh5KS5wYWRTdGFydCg0LCAnMCcpICsgJy0nICsgU3RyaW5nKG1vbikucGFkU3RhcnQoMiwgJzAnKTtcbiAgfVxuICByZXR1cm4gbnVsbDtcbn1cblxuLy8gQnVzY2EgbGEgZmlsYSBoZWFkZXIgKDAtYmFzZWQpLiBFc2NhbmVhIGxhcyBwcmltZXJhcyAzMCBmaWxhcy5cbmZ1bmN0aW9uIGZpbmRIZWFkZXJSb3cocm93cykge1xuICBjb25zdCBIRUFERVJfTUFSS0VSUyA9IFtcbiAgICAnc2t1IGNvZGUvcGFydCBubycsICdza3UgY29kZScsICdza3UnLCAncGFydCBubycsICdwYXJ0IG51bWJlcicsXG4gICAgJ2l0ZW1jb2RlJywgJ2l0ZW0gY29kZScsICdjb2RpZ28nLCAnY1x1MDBGM2RpZ28nLFxuICBdO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IE1hdGgubWluKHJvd3MubGVuZ3RoLCAzMCk7IGkrKykge1xuICAgIGNvbnN0IHJvdyA9IHJvd3NbaV0gfHwgW107XG4gICAgZm9yIChjb25zdCBjZWxsIG9mIHJvdykge1xuICAgICAgY29uc3QgcyA9IFN0cmluZyhjZWxsID09IG51bGwgPyAnJyA6IGNlbGwpLnRyaW0oKS50b0xvd2VyQ2FzZSgpO1xuICAgICAgaWYgKEhFQURFUl9NQVJLRVJTLmluZGV4T2YocykgPj0gMCkgcmV0dXJuIGk7XG4gICAgfVxuICB9XG4gIHJldHVybiAtMTtcbn1cblxuLy8gRGV0ZWN0YSBcdTAwRURuZGljZXMgZGUgY29sdW1uYXMgeSBtZXNlcy4gYGhpbnRSb3dBYm92ZWAgcGVybWl0ZSBjb21iaW5hciBhXHUwMEYxby9tZXNcbi8vIGN1YW5kbyBlbCBoZWFkZXIgZXMgbXVsdGktcm93IChhXHUwMEYxbyBhcnJpYmEsIG1lcyBhYmFqbyBvIHZpY2V2ZXJzYSkuXG5mdW5jdGlvbiBkZXRlY3RDb2x1bW5zKGhlYWRlclJvdywgaGludFJvd0Fib3ZlKSB7XG4gIGxldCBza3VJZHggPSAtMTtcbiAgbGV0IGRlc2NJZHggPSAtMTtcbiAgbGV0IG1vcUlkeCA9IC0xO1xuICBjb25zdCBtb250aENvbHVtbnMgPSBbXTtcbiAgY29uc3QgZGV0ZWN0ZWRNb250aHNTZXQgPSBuZXcgU2V0KCk7XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgaGVhZGVyUm93Lmxlbmd0aDsgaSsrKSB7XG4gICAgY29uc3QgcmF3ID0gU3RyaW5nKGhlYWRlclJvd1tpXSA9PSBudWxsID8gJycgOiBoZWFkZXJSb3dbaV0pLnRyaW0oKTtcbiAgICBjb25zdCBzID0gcmF3LnRvTG93ZXJDYXNlKCk7XG4gICAgaWYgKHNrdUlkeCA8IDAgJiYgKFxuICAgICAgcyA9PT0gJ3NrdSBjb2RlL3BhcnQgbm8nIHx8IHMgPT09ICdza3UgY29kZScgfHwgcyA9PT0gJ3NrdScgfHxcbiAgICAgIHMgPT09ICdwYXJ0IG5vJyB8fCBzID09PSAncGFydCBudW1iZXInIHx8IHMgPT09ICdpdGVtY29kZScgfHxcbiAgICAgIHMgPT09ICdpdGVtIGNvZGUnIHx8IHMgPT09ICdjb2RpZ28nIHx8IHMgPT09ICdjXHUwMEYzZGlnbydcbiAgICApKSB7XG4gICAgICBza3VJZHggPSBpO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChkZXNjSWR4IDwgMCAmJiAocyA9PT0gJ2Rlc2NyaXB0aW9uJyB8fCBzID09PSAnZGVzY3JpcGNpb24nIHx8IHMgPT09ICdkZXNjcmlwY2lcdTAwRjNuJyB8fCBzID09PSAnaXRlbSBuYW1lJyB8fCBzID09PSAnaXRlbW5hbWUnKSkge1xuICAgICAgZGVzY0lkeCA9IGk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKG1vcUlkeCA8IDAgJiYgKHMgPT09ICdtb3EgMTIgbW9udGhzJyB8fCBzID09PSAnbW9xJyB8fCBzLmluZGV4T2YoJ21vcScpID09PSAwKSkge1xuICAgICAgbW9xSWR4ID0gaTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICAvLyBUcnkgZGlyZWN0IG1vbnRoIHBhcnNlXG4gICAgbGV0IG1vbnRoS2V5ID0gbm9ybWFsaXplTW9udGhMYWJlbChyYXcpO1xuICAgIGlmICghbW9udGhLZXkgJiYgaGludFJvd0Fib3ZlICYmIGhpbnRSb3dBYm92ZVtpXSAhPSBudWxsKSB7XG4gICAgICBjb25zdCBoaW50ID0gU3RyaW5nKGhpbnRSb3dBYm92ZVtpXSkudHJpbSgpO1xuICAgICAgaWYgKGhpbnQpIHtcbiAgICAgICAgbW9udGhLZXkgPSBub3JtYWxpemVNb250aExhYmVsKHJhdyArICcgJyArIGhpbnQpIHx8IG5vcm1hbGl6ZU1vbnRoTGFiZWwoaGludCArICcgJyArIHJhdyk7XG4gICAgICB9XG4gICAgfVxuICAgIGlmIChtb250aEtleSkge1xuICAgICAgbW9udGhDb2x1bW5zLnB1c2goeyBjb2xJZHg6IGksIG1vbnRoS2V5IH0pO1xuICAgICAgZGV0ZWN0ZWRNb250aHNTZXQuYWRkKG1vbnRoS2V5KTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHtcbiAgICBza3VJZHgsIGRlc2NJZHgsIG1vcUlkeCwgbW9udGhDb2x1bW5zLFxuICAgIGRldGVjdGVkTW9udGhzOiBBcnJheS5mcm9tKGRldGVjdGVkTW9udGhzU2V0KS5zb3J0KCksXG4gIH07XG59XG5cbi8vIFB1YmxpYzogcGFyc2UgZnVsbCBzaGVldC4gVGhyb3dzIG9uIG1pc3NpbmcgU0tVIGNvbHVtbiAvIG1vbnRocy5cbmZ1bmN0aW9uIHBhcnNlU2FsZXNQbGFuU2hlZXQocm93cykge1xuICBpZiAoIXJvd3MgfHwgIXJvd3MubGVuZ3RoKSB7XG4gICAgY29uc3QgZXJyID0gbmV3IEVycm9yKCdFeGNlbCB2YWNpbycpO1xuICAgIGVyci5jb2RlID0gJ0VNUFRZX1NIRUVUJztcbiAgICB0aHJvdyBlcnI7XG4gIH1cbiAgY29uc3QgaGVhZGVySWR4ID0gZmluZEhlYWRlclJvdyhyb3dzKTtcbiAgaWYgKGhlYWRlcklkeCA8IDApIHtcbiAgICBjb25zdCBlcnIgPSBuZXcgRXJyb3IoJ05vIHNlIGVuY29udHJvIGZpbGEgZGUgaGVhZGVycyAoYnVzY2FiYSBcIlNLVSBDb2RlL1BhcnQgTm9cIiBvIFwiU0tVXCIpJyk7XG4gICAgZXJyLmNvZGUgPSAnSEVBREVSX05PVF9GT1VORCc7XG4gICAgdGhyb3cgZXJyO1xuICB9XG4gIGNvbnN0IGhlYWRlclJvdyA9IHJvd3NbaGVhZGVySWR4XSB8fCBbXTtcbiAgY29uc3Qgcm93QWJvdmUgPSBoZWFkZXJJZHggPiAwID8gKHJvd3NbaGVhZGVySWR4IC0gMV0gfHwgW10pIDogbnVsbDtcbiAgY29uc3QgY29scyA9IGRldGVjdENvbHVtbnMoaGVhZGVyUm93LCByb3dBYm92ZSk7XG4gIGlmIChjb2xzLnNrdUlkeCA8IDApIHtcbiAgICBjb25zdCBlcnIgPSBuZXcgRXJyb3IoJ05vIHNlIGVuY29udHJvIGNvbHVtbmEgU0tVIGVuIGxhIGZpbGEgaGVhZGVyJyk7XG4gICAgZXJyLmNvZGUgPSAnU0tVX0NPTF9NSVNTSU5HJztcbiAgICB0aHJvdyBlcnI7XG4gIH1cbiAgaWYgKCFjb2xzLm1vbnRoQ29sdW1ucy5sZW5ndGgpIHtcbiAgICBjb25zdCBlcnIgPSBuZXcgRXJyb3IoJ05vIHNlIGRldGVjdGFyb24gY29sdW1uYXMgZGUgbWVzZXMgZW4gZWwgaGVhZGVyIChlajogXCJKYW4gMjAyN1wiLCBcIk1heSAyMDI3XCIpJyk7XG4gICAgZXJyLmNvZGUgPSAnTU9OVEhTX05PVF9GT1VORCc7XG4gICAgdGhyb3cgZXJyO1xuICB9XG4gIGNvbnN0IHBhcnNlZFJvd3MgPSBbXTtcbiAgY29uc3Qgc2VlblNrdSA9IG5ldyBTZXQoKTtcbiAgZm9yIChsZXQgciA9IGhlYWRlcklkeCArIDE7IHIgPCByb3dzLmxlbmd0aDsgcisrKSB7XG4gICAgY29uc3Qgcm93ID0gcm93c1tyXSB8fCBbXTtcbiAgICBjb25zdCBza3VSYXcgPSByb3dbY29scy5za3VJZHhdO1xuICAgIGlmIChza3VSYXcgPT0gbnVsbCB8fCBTdHJpbmcoc2t1UmF3KS50cmltKCkgPT09ICcnKSBjb250aW51ZTtcbiAgICBjb25zdCBza3UgPSBTdHJpbmcoc2t1UmF3KS50cmltKCk7XG4gICAgY29uc3QgdXBwZXIgPSBza3UudG9VcHBlckNhc2UoKTtcbiAgICAvLyBTa2lwIGZpbGFzIFRPVEFMIC8gU1VNIC8gU1VCVE9UQUxcbiAgICBpZiAodXBwZXIgPT09ICdUT1RBTCcgfHwgdXBwZXIgPT09ICdTVU0nIHx8IHVwcGVyID09PSAnU1VCVE9UQUwnIHx8IHVwcGVyID09PSAnVE9UQUxFUycpIGNvbnRpbnVlO1xuICAgIGlmIChzZWVuU2t1Lmhhcyh1cHBlcikpIGNvbnRpbnVlOyAvLyBkZWR1cGVcbiAgICBzZWVuU2t1LmFkZCh1cHBlcik7XG4gICAgY29uc3QgZGVzY3JpcHRpb24gPSBjb2xzLmRlc2NJZHggPj0gMCA/IFN0cmluZyhyb3dbY29scy5kZXNjSWR4XSA9PSBudWxsID8gJycgOiByb3dbY29scy5kZXNjSWR4XSkudHJpbSgpIDogJyc7XG4gICAgY29uc3QgbW9xUmF3ID0gY29scy5tb3FJZHggPj0gMCA/IHJvd1tjb2xzLm1vcUlkeF0gOiBudWxsO1xuICAgIGNvbnN0IG1vcU51bSA9IE51bWJlcihtb3FSYXcpO1xuICAgIGNvbnN0IG1vcSA9IE51bWJlci5pc0Zpbml0ZShtb3FOdW0pICYmIG1vcU51bSA+IDAgPyBNYXRoLnJvdW5kKG1vcU51bSkgOiAwO1xuICAgIGNvbnN0IG1vbnRocyA9IHt9O1xuICAgIGZvciAoY29uc3QgbWMgb2YgY29scy5tb250aENvbHVtbnMpIHtcbiAgICAgIGNvbnN0IHYgPSByb3dbbWMuY29sSWR4XTtcbiAgICAgIGNvbnN0IG4gPSBOdW1iZXIodik7XG4gICAgICBpZiAoTnVtYmVyLmlzRmluaXRlKG4pICYmIG4gPiAwKSB7XG4gICAgICAgIG1vbnRoc1ttYy5tb250aEtleV0gPSBNYXRoLnJvdW5kKG4pO1xuICAgICAgfVxuICAgIH1cbiAgICBwYXJzZWRSb3dzLnB1c2goeyBza3UsIGRlc2NyaXB0aW9uLCBtb3EsIG1vbnRocyB9KTtcbiAgfVxuICByZXR1cm4ge1xuICAgIGhlYWRlclJvd0luZGV4OiBoZWFkZXJJZHgsXG4gICAgZGV0ZWN0ZWRNb250aHM6IGNvbHMuZGV0ZWN0ZWRNb250aHMsXG4gICAgcm93c0NvdW50OiBwYXJzZWRSb3dzLmxlbmd0aCxcbiAgICByb3dzOiBwYXJzZWRSb3dzLFxuICB9O1xufVxuXG4vLyBVTUQtaXNoIGV4cG9ydDogcGFyYSB2aXRlc3QgKG1vZHVsZS5leHBvcnRzKSB5IHBhcmEgYnVuZGxlIGJyb3dzZXIgKHdpbmRvdyBnbG9iYWwpLlxuaWYgKHR5cGVvZiBtb2R1bGUgIT09ICd1bmRlZmluZWQnICYmIG1vZHVsZS5leHBvcnRzKSB7XG4gIG1vZHVsZS5leHBvcnRzID0geyBwYXJzZVNhbGVzUGxhblNoZWV0LCBub3JtYWxpemVNb250aExhYmVsLCBmaW5kSGVhZGVyUm93LCBkZXRlY3RDb2x1bW5zIH07XG59XG5pZiAodHlwZW9mIHdpbmRvdyAhPT0gJ3VuZGVmaW5lZCcpIHtcbiAgd2luZG93LlNhbGVzUGxhblBhcnNlciA9IHsgcGFyc2VTYWxlc1BsYW5TaGVldCwgbm9ybWFsaXplTW9udGhMYWJlbCwgZmluZEhlYWRlclJvdywgZGV0ZWN0Q29sdW1ucyB9O1xufVxuZXhwb3J0IHsgcGFyc2VTYWxlc1BsYW5TaGVldCwgbm9ybWFsaXplTW9udGhMYWJlbCwgZmluZEhlYWRlclJvdywgZGV0ZWN0Q29sdW1ucyB9O1xuIiwgIi8vIEB0cy1ub2NoZWNrXG4vLyB2MTA5OCsgRmFzZSAxOiBpbXBvcnQgZGVsIHBhcnNlciBwdXJvLiBFbCBtXHUwMEYzZHVsbyBoYWNlIGB3aW5kb3cuU2FsZXNQbGFuUGFyc2VyYFxuLy8gY29tbyBzaWRlLWVmZmVjdCB5IHRhbWJpXHUwMEU5biBleHBvcnRhIGxhcyBmbnMgbm9tYnJhZGFzOyB1c2Ftb3Mgc2lkZS1lZmZlY3Rcbi8vIHBvcnF1ZSBmb3JlY2FzdC5qcyBjb3JyZSBlbiBlbCBjaHVuayBsYXp5IHkgd2luZG93IHlhIGVzdFx1MDBFMSBkaXNwb25pYmxlLlxuaW1wb3J0ICcuLi9wdXJlL3NhbGVzLXBsYW4tcGFyc2VyLmpzJztcblxuLy8gR2xvYmFscyBsZWlkb3MgZGVsIGVudG9ybm8gKGRlY2xhcmFkb3MgZW4gaW5kZXguaHRtbCBpbmxpbmUgbyBidW5kbGUgcHJldmlvKTpcbi8vIGZiRGIsIGN1cnJlbnRVc2VyLCBYTFNYIChjZG4pLCBlc2NhcGVIdG1sLiBNaXNtbyBwYXRyb24gcXVlIG90cm9zIGRvbWluaW9zLlxuLy9cbi8vIEZPUkVDQVNUIC0gbW9kYWwgYWRtaW4tb25seSAoTWFyaWFubykgcXVlIGNvbXBhcmEgdmVudGFzIGhpc3RvcmljYXNcbi8vIChGaXJlc3RvcmUgc2t1X3ZlbnRhc19zbmFwc2hvdCwgYWxpbWVudGFkbyBwb3Igc3luYyBCUSB2X3ZlbnRhc19saW5lYXNcbi8vIHZlbnRhbmEgMTNtKSB2cyBTYWxlcyBQbGFuIGNhcmdhZG8gcG9yIGVsIHVzZXIgdmlhIEV4Y2VsICsgcG9saXRpY2EgZGVcbi8vIGludmVudGFyaW8gKHByb21lZGlvIFlURCB4IDMgbWVzZXMpLlxuLy9cbi8vIENodW5rIGxhenk6IHNlIGNhcmdhIHNvbG8gYWwgcHJpbWVyIGNsaWNrIGRlbCBib3RvbiBGT1JFQ0FTVCBkZWwgaGVhZGVyLlxuLy8gUmVnaXN0cmFkbyBlbiBidWlsZC5qcyBMQVpZX0NIVU5LUyArIHNyYy9tYWluLmpzIGluc3RhbGxDaHVua1N0dWJzICsgc3cuanNcbi8vIFNUQVRJQ19BU1NFVFMuIFZlciBDTEFVREUubWQgIzE4ICgzIGx1Z2FyZXMgc2luY3Jvbml6YWRvcykuXG4vL1xuLy8gQ29udHJhdG8gZGVsIEV4Y2VsIFNhbGVzIFBsYW4gcXVlIHN1YmUgZWwgdXNlcjpcbi8vICAgQ29sdW1uYXM6IFNLVSB8IE1lczEgfCBNZXMyIHwgTWVzMyB8IE1lczQgfCBNZXM1IHwgTWVzNlxuLy8gICAobm9tYnJlcyBleGFjdG9zIGRlIGhlYWRlcnMgY2FzZS1pbnNlbnNpdGl2ZTsgTWVzMS4uNiBzb24gbG9zIHByb3hpbW9zXG4vLyAgIDYgbWVzZXMgZGVzZGUgZWwgbWVzIGFjdHVhbCkuIFVuYSBmaWxhIHBvciBTS1UuXG4vL1xuLy8gRnVlbnRlIGRlIGRhdG9zIGhpc3RvcmljYXM6XG4vLyAgIEZpcmVzdG9yZSAvc2t1X3ZlbnRhc19zbmFwc2hvdC97U0tVXzxza3Vfc2FuZWFkbz59XG4vLyAgIHtcbi8vICAgICBza3UsIGl0ZW1OYW1lLCBmYW1pbGlhLCBzdWJmYW1pbGlhLFxuLy8gICAgIG1lc2VzOiB7ICcyMDI1LTA4Jzoge3F0eSwgYXJzfSwgLi4uLCAnMjAyNi0wOCc6IHtxdHksIGFyc30gfVxuLy8gICB9XG4vLyAgIFJ1bGVzOiByZWFkIGFkbWluLW9ubHkgKGNvbXBldGl0aXZlbHkgc2Vuc2l0aXZlKS4gRXNjcml0byBwb3IgY3JvblxuLy8gICBzeW5jX3NhcF90b19iaWdxdWVyeS5weSBjYWRhIDMwIG1pbi5cblxuLy8gRXN0YWRvIGRlbCBtb2RhbCAoaW50cmEtY2h1bmssIG5vIGNyb3NzLXNjb3BlKS5cbmxldCBfZm9yZWNhc3RTbmFwc2hvdCA9IG51bGw7IC8vIHsgU0tVOiB7ZmFtaWxpYSwgc3ViZmFtaWxpYSwgaXRlbU5hbWUsIG1lc2VzfSB9XG5sZXQgX2ZvcmVjYXN0U2FsZXNQbGFuID0gbnVsbDsgLy8gW3sgc2t1LCBwZWRpZG9Ub3RhbCwgbWVzZXNBcnI6IFtuMS4ubjZdIH1dXG5sZXQgX2ZvcmVjYXN0Um93cyA9IG51bGw7IC8vIGZpbGFzIGZpbmFsZXMgY2FsY3VsYWRhcyBwYXJhIHByZXZpZXcgKyBleHBvcnRcbmxldCBfZm9yZWNhc3RMb2FkaW5nID0gZmFsc2U7XG5cbi8vIHYxMDk4KyAoRmFzZSAxIEZvcmVjYXN0IHYyKTogU2FsZXMgUGxhbnMgbWVuc3VhbGVzIHBvciBmYW1pbGlhIChSb2RzL1JlZWxzL0ZHKS5cbi8vIFNlIGd1YXJkYW4gZW4gRmlyZXN0b3JlIGBzYWxlc19wbGFuX2NhY2hlL3tmYW1pbGlhfWAgKyBzbmFwc2hvdCBFeGNlbCBvcmlnaW5hbFxuLy8gZW4gU3RvcmFnZSBgZm9yZWNhc3RzX3NuYXBzaG90cy97WVlZWS1NTX0ve2ZhbWlsaWF9Lnhsc3hgLlxuLy8gRWwgcGFyc2VyIHB1cm8gdml2ZSBlbiBzcmMvcHVyZS9zYWxlcy1wbGFuLXBhcnNlci5qcyAoYXR0YWNoIGEgd2luZG93LlNhbGVzUGxhblBhcnNlcikuXG5jb25zdCBTQUxFU19QTEFOX0ZBTUlMSUFTID0gW1xuICB7IGtleTogJ3JvZHMnLCBsYWJlbDogJ1JvZHMgKENhXHUwMEYxYXMpJywgY29sb3I6ICcjMGVhNWU5JyB9LFxuICB7IGtleTogJ3JlZWxzJywgbGFiZWw6ICdSZWVscycsIGNvbG9yOiAnIzhiNWNmNicgfSxcbiAgeyBrZXk6ICdmZycsIGxhYmVsOiAnRkcgKHJlc3RvKScsIGNvbG9yOiAnI2Y1OWUwYicgfSxcbl07XG5sZXQgX3NhbGVzUGxhbkNhY2hlcyA9IHsgcm9kczogbnVsbCwgcmVlbHM6IG51bGwsIGZnOiBudWxsIH07IC8vIGxhc3QgbG9hZGVkIGRvY1xubGV0IF9mb3JlY2FzdEFjdGl2ZVRhYiA9ICdzYWxlcy1wbGFucyc7IC8vICdzYWxlcy1wbGFucycgfCAnbGVnYWN5J1xuXG4vLyBXaGl0ZWxpc3QgZGUgZW1haWxzIGNvbiBhY2Nlc28gYWwgbW9kYWwgRk9SRUNBU1QuIFJlcGxpY2EgZWwgcGF0cm9uIGRlXG4vLyBcIkFuYWxpc2lzXCIgKGluZGV4Lmh0bWw6MTI2MjUpLiBTb2xvIE1hcmlhbm87IHNpIG90cm8gYWRtaW4gbG8gbmVjZXNpdGFcbi8vIHNlIGFncmVnYSBhY2EgZXhwbGljaXRvLlxuY29uc3QgRk9SRUNBU1RfQUxMT1dFRF9FTUFJTFMgPSBbJ21hcmlhbm8uZXJiaW5vQHNoaW1hbm8uY29tLmFyJywgJ2VyYmlub21hcmlhbm9AZ21haWwuY29tJ107XG5cbmZ1bmN0aW9uIF9jYW5Gb3JlY2FzdCgpIHtcbiAgdHJ5IHtcbiAgICBjb25zdCBlbWFpbCA9ICgod2luZG93LmN1cnJlbnRVc2VyICYmIHdpbmRvdy5jdXJyZW50VXNlci5lbWFpbCkgfHwgJycpLnRvTG93ZXJDYXNlKCk7XG4gICAgaWYgKCFlbWFpbCkgcmV0dXJuIGZhbHNlO1xuICAgIHJldHVybiBGT1JFQ0FTVF9BTExPV0VEX0VNQUlMUy5pbmRleE9mKGVtYWlsKSA+PSAwO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbn1cblxuLy8gSGVscGVycyBkZSBtZXMgY2FsZW5kYXIuXG5mdW5jdGlvbiBfbW9udGhLZXkoeWVhciwgbW9udGhPbmVCYXNlZCkge1xuICByZXR1cm4gU3RyaW5nKHllYXIpLnBhZFN0YXJ0KDQsICcwJykgKyAnLScgKyBTdHJpbmcobW9udGhPbmVCYXNlZCkucGFkU3RhcnQoMiwgJzAnKTtcbn1cbmZ1bmN0aW9uIF9tb250aExhYmVsKGtleSkge1xuICAvLyAnMjAyNi0wOCcgLT4gJ2Fnby0yNidcbiAgY29uc3QgW3ksIG1dID0ga2V5LnNwbGl0KCctJykubWFwKE51bWJlcik7XG4gIGNvbnN0IG5hbWVzID0gW1xuICAgICdlbmUnLFxuICAgICdmZWInLFxuICAgICdtYXInLFxuICAgICdhYnInLFxuICAgICdtYXknLFxuICAgICdqdW4nLFxuICAgICdqdWwnLFxuICAgICdhZ28nLFxuICAgICdzZXAnLFxuICAgICdvY3QnLFxuICAgICdub3YnLFxuICAgICdkaWMnLFxuICBdO1xuICByZXR1cm4gbmFtZXNbbSAtIDFdICsgJy0nICsgU3RyaW5nKHkpLnNsaWNlKC0yKTtcbn1cbmZ1bmN0aW9uIF9hZGRNb250aHMoeWVhciwgbW9udGhPbmVCYXNlZCwgZGVsdGEpIHtcbiAgY29uc3QgdG90YWxNb250aHMgPSB5ZWFyICogMTIgKyAobW9udGhPbmVCYXNlZCAtIDEpICsgZGVsdGE7XG4gIGNvbnN0IHkgPSBNYXRoLmZsb29yKHRvdGFsTW9udGhzIC8gMTIpO1xuICBjb25zdCBtID0gKHRvdGFsTW9udGhzICUgMTIpICsgMTtcbiAgcmV0dXJuIHsgeSwgbSB9O1xufVxuXG4vLyBTdW1hIHF0eSBkZWwgU0tVIGVuIGxvcyB1bHRpbW9zIDEyIE1FU0VTIENPTVBMRVRPUyAoZXhjbHV5ZSBlbCBtZXMgYWN0dWFsXG4vLyBwYXJjaWFsIC0gbGEgdmVudGFuYSBtb3ZpbCBcIjEyIG1lc2VzIGNlcnJhZG9zXCIgcXVlIGVsIHVzZXIgcGllbnNhIGNvbW9cbi8vIFwiZWwgYVx1MDBGMW8gcXVlIHlhIHBhc29cIikuIEVqZW1wbG8gZW4gYWdvc3RvIDIwMjY6IHN1bWFyIGFnby0yNSBhIGp1bC0yNi5cbmZ1bmN0aW9uIF9zdW1WZW50YXMxMm1Db21wbGV0b3MobWVzZXNNYXAsIGhveSkge1xuICBpZiAoIW1lc2VzTWFwKSByZXR1cm4gMDtcbiAgbGV0IHN1bSA9IDA7XG4gIGNvbnN0IHN0YXJ0TW9udGggPSBfYWRkTW9udGhzKGhveS5nZXRGdWxsWWVhcigpLCBob3kuZ2V0TW9udGgoKSArIDEsIC0xMik7XG4gIGNvbnN0IGVuZE1vbnRoID0gX2FkZE1vbnRocyhob3kuZ2V0RnVsbFllYXIoKSwgaG95LmdldE1vbnRoKCkgKyAxLCAtMSk7XG4gIGNvbnN0IHN0YXJ0S2V5ID0gX21vbnRoS2V5KHN0YXJ0TW9udGgueSwgc3RhcnRNb250aC5tKTtcbiAgY29uc3QgZW5kS2V5ID0gX21vbnRoS2V5KGVuZE1vbnRoLnksIGVuZE1vbnRoLm0pO1xuICBmb3IgKGNvbnN0IGsgb2YgT2JqZWN0LmtleXMobWVzZXNNYXApKSB7XG4gICAgaWYgKGsgPj0gc3RhcnRLZXkgJiYgayA8PSBlbmRLZXkpIHtcbiAgICAgIHN1bSArPSBOdW1iZXIoKG1lc2VzTWFwW2tdICYmIG1lc2VzTWFwW2tdLnF0eSkgfHwgMCk7XG4gICAgfVxuICB9XG4gIHJldHVybiBzdW07XG59XG5cbi8vIFN1bWEgcXR5IGRlbCBTS1UgWVREIChlbmVybyBkZWwgYVx1MDBGMW8gYWN0dWFsIGhhc3RhIG1lcyBhY3R1YWwgSU5DTFVTSVZPLFxuLy8gYXVucXVlIGVsIG1lcyBhY3R1YWwgc2VhIHBhcmNpYWwpLiBSZXRvcm5hIHsgdG90YWxZdGQsIG1lc2VzVHJhbnNjdXJyaWRvcyB9LlxuLy8gRWplbXBsbyBhZ29zdG8gMjAyNiBjb24gdmVudGFzIGp1bD0xMCArIGFnbz0yMCAtPiB7MzAsIDh9LCBwcm9tZWRpbz0zMC84PTMuNzUuXG4vLyAoU2kgZWwgdXN1YXJpbyBlc3BlcmFiYSBkaXZpZGlyIHBvciAyIGVuIHZleiBkZSA4LCByZXZpc2FyIHNwZWMuIEVsIHBlZGlkb1xuLy8gZGljZSBcImNhbnRpZGFkIGRlIG1lc2VzIHF1ZSB0cmFuc2N1cnJpbW9zXCIgPSBtZXNlcyBkZWwgYVx1MDBGMW8gcGFzYWRvcyBoYXN0YSBob3kuKVxuZnVuY3Rpb24gX3N1bVZlbnRhc1lURChtZXNlc01hcCwgaG95KSB7XG4gIGNvbnN0IHllYXIgPSBob3kuZ2V0RnVsbFllYXIoKTtcbiAgY29uc3QgbWVzQWN0dWFsID0gaG95LmdldE1vbnRoKCkgKyAxO1xuICBsZXQgdG90YWwgPSAwO1xuICBpZiAobWVzZXNNYXApIHtcbiAgICBmb3IgKGxldCBtID0gMTsgbSA8PSBtZXNBY3R1YWw7IG0rKykge1xuICAgICAgY29uc3QgayA9IF9tb250aEtleSh5ZWFyLCBtKTtcbiAgICAgIHRvdGFsICs9IE51bWJlcigobWVzZXNNYXBba10gJiYgbWVzZXNNYXBba10ucXR5KSB8fCAwKTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHsgdG90YWxZdGQ6IHRvdGFsLCBtZXNlc1RyYW5zY3Vycmlkb3M6IG1lc0FjdHVhbCB9O1xufVxuXG4vLyBDYXJnYSBza3VfdmVudGFzX3NuYXBzaG90IGNvbXBsZXRvICh1bmEgdmV6IHBvciBzZXNpb24gZGVsIG1vZGFsKS5cbmFzeW5jIGZ1bmN0aW9uIF9sb2FkU25hcHNob3QoKSB7XG4gIGlmIChfZm9yZWNhc3RTbmFwc2hvdCkgcmV0dXJuIF9mb3JlY2FzdFNuYXBzaG90O1xuICBpZiAoIXdpbmRvdy5mYkRiKSB0aHJvdyBuZXcgRXJyb3IoJ0ZpcmVzdG9yZSBubyBpbmljaWFsaXphZG8nKTtcbiAgY29uc3Qgc25hcCA9IGF3YWl0IHdpbmRvdy5mYkRiLmNvbGxlY3Rpb24oJ3NrdV92ZW50YXNfc25hcHNob3QnKS5nZXQoKTtcbiAgY29uc3QgYnlPcmlnaW5hbFNrdSA9IHt9O1xuICBjb25zdCBieVVwcGVyU2t1ID0ge307XG4gIHNuYXAuZm9yRWFjaCgoZG9jKSA9PiB7XG4gICAgY29uc3QgZCA9IGRvYy5kYXRhKCk7XG4gICAgaWYgKCFkIHx8ICFkLnNrdSkgcmV0dXJuO1xuICAgIGNvbnN0IHNrdVVwcGVyID0gU3RyaW5nKGQuc2t1KS50cmltKCkudG9VcHBlckNhc2UoKTtcbiAgICBjb25zdCByZWNvcmQgPSB7XG4gICAgICBza3U6IGQuc2t1LFxuICAgICAgaXRlbU5hbWU6IGQuaXRlbU5hbWUgfHwgJycsXG4gICAgICBmYW1pbGlhOiBkLmZhbWlsaWEgfHwgJycsXG4gICAgICBzdWJmYW1pbGlhOiBkLnN1YmZhbWlsaWEgfHwgJycsXG4gICAgICBtZXNlczogZC5tZXNlcyB8fCB7fSxcbiAgICB9O1xuICAgIGJ5T3JpZ2luYWxTa3VbZC5za3VdID0gcmVjb3JkO1xuICAgIGJ5VXBwZXJTa3Vbc2t1VXBwZXJdID0gcmVjb3JkO1xuICB9KTtcbiAgX2ZvcmVjYXN0U25hcHNob3QgPSB7IGJ5T3JpZ2luYWxTa3UsIGJ5VXBwZXJTa3UsIGNvdW50OiBzbmFwLnNpemUgfTtcbiAgcmV0dXJuIF9mb3JlY2FzdFNuYXBzaG90O1xufVxuXG4vLyBQYXJzZWEgZWwgRXhjZWwgU2FsZXMgUGxhbi4gRXNwZXJhIGNvbHVtbmFzIFNLVSArIDYgY29sdW1uYXMgbnVtZXJpY2FzXG4vLyAobm9tYnJlcyBmbGV4aWJsZXM6IE1lczEuLk1lczYsIG1lc18xLi5tZXNfNiwgbyBjdWFscXVpZXIgaGVhZGVyIGN1c3RvbVxuLy8gbWllbnRyYXMgbGEgcHJpbWVyYSBzZWEgU0tVIHkgaGF5YSBhbCBtZW5vcyA2IGNvbHVtbmFzIG51bWVyaWNhcyBtYXMpLlxuZnVuY3Rpb24gX3BhcnNlU2FsZXNQbGFuUm93cyhyb3dzUmF3KSB7XG4gIGlmICghcm93c1JhdyB8fCAhcm93c1Jhdy5sZW5ndGgpIHJldHVybiBbXTtcbiAgY29uc3QgaGVhZGVyUm93ID0gcm93c1Jhd1swXTtcbiAgLy8gRGV0ZWN0YXIgaW5kaWNlIGRlIGNvbHVtbmEgU0tVXG4gIGxldCBza3VDb2xJZHggPSAtMTtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBoZWFkZXJSb3cubGVuZ3RoOyBpKyspIHtcbiAgICBjb25zdCBoID0gU3RyaW5nKGhlYWRlclJvd1tpXSB8fCAnJylcbiAgICAgIC50cmltKClcbiAgICAgIC50b1VwcGVyQ2FzZSgpO1xuICAgIGlmIChoID09PSAnU0tVJyB8fCBoID09PSAnSVRFTUNPREUnIHx8IGggPT09ICdJVEVNJyB8fCBoID09PSAnSVRFTSBDT0RFJyB8fCBoID09PSAnQ09ESUdPJykge1xuICAgICAgc2t1Q29sSWR4ID0gaTtcbiAgICAgIGJyZWFrO1xuICAgIH1cbiAgfVxuICBpZiAoc2t1Q29sSWR4IDwgMClcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ0VsIEV4Y2VsIGRlYmUgdGVuZXIgdW5hIGNvbHVtbmEgbGxhbWFkYSBcIlNLVVwiIChvIENvZGlnbyAvIEl0ZW1Db2RlIC8gSXRlbSknKTtcbiAgLy8gTGFzIDYgY29sdW1uYXMgZGUgbWVzZXM6IGxhcyBwcmltZXJhcyA2IGNvbHVtbmFzIHF1ZSBzZWFuICE9IHNrdUNvbElkeC5cbiAgY29uc3QgbW9udGhDb2xzID0gW107XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgaGVhZGVyUm93Lmxlbmd0aCAmJiBtb250aENvbHMubGVuZ3RoIDwgNjsgaSsrKSB7XG4gICAgaWYgKGkgIT09IHNrdUNvbElkeCkgbW9udGhDb2xzLnB1c2goaSk7XG4gIH1cbiAgaWYgKG1vbnRoQ29scy5sZW5ndGggPCA2KVxuICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICdFbCBFeGNlbCBkZWJlIHRlbmVyIGFsIG1lbm9zIDYgY29sdW1uYXMgZGUgbWVzZXMgYWRlbWFzIGRlIFNLVSAoZW5jb250cmFkYXM6ICcgK1xuICAgICAgICBtb250aENvbHMubGVuZ3RoICtcbiAgICAgICAgJyknXG4gICAgKTtcbiAgY29uc3Qgb3V0ID0gW107XG4gIGZvciAobGV0IHIgPSAxOyByIDwgcm93c1Jhdy5sZW5ndGg7IHIrKykge1xuICAgIGNvbnN0IHJvdyA9IHJvd3NSYXdbcl07XG4gICAgaWYgKCFyb3cgfHwgIXJvdy5sZW5ndGgpIGNvbnRpbnVlO1xuICAgIGNvbnN0IHNrdVJhdyA9IHJvd1tza3VDb2xJZHhdO1xuICAgIGlmIChza3VSYXcgPT09IHVuZGVmaW5lZCB8fCBza3VSYXcgPT09IG51bGwgfHwgU3RyaW5nKHNrdVJhdykudHJpbSgpID09PSAnJykgY29udGludWU7XG4gICAgY29uc3Qgc2t1ID0gU3RyaW5nKHNrdVJhdykudHJpbSgpO1xuICAgIGNvbnN0IG1lc2VzQXJyID0gbW9udGhDb2xzLm1hcCgoaSkgPT4ge1xuICAgICAgY29uc3QgdiA9IHJvd1tpXTtcbiAgICAgIGNvbnN0IG4gPSBOdW1iZXIodik7XG4gICAgICByZXR1cm4gTnVtYmVyLmlzRmluaXRlKG4pID8gbiA6IDA7XG4gICAgfSk7XG4gICAgY29uc3QgcGVkaWRvVG90YWwgPSBtZXNlc0Fyci5yZWR1Y2UoKGEsIGIpID0+IGEgKyBiLCAwKTtcbiAgICBvdXQucHVzaCh7IHNrdSwgbWVzZXNBcnIsIHBlZGlkb1RvdGFsIH0pO1xuICB9XG4gIHJldHVybiBvdXQ7XG59XG5cbi8vIENhbGN1bGEgbGFzIGZpbGFzIGZpbmFsZXMgY3J1emFuZG8gc25hcHNob3QgKyBzYWxlcyBwbGFuLlxuZnVuY3Rpb24gX2NvbXB1dGVGb3JlY2FzdFJvd3Moc25hcHNob3QsIHNhbGVzUGxhbiwgaG95KSB7XG4gIGNvbnN0IHJvd3MgPSBbXTtcbiAgZm9yIChjb25zdCBzcCBvZiBzYWxlc1BsYW4pIHtcbiAgICBjb25zdCBza3VVcHBlciA9IHNwLnNrdS50b1VwcGVyQ2FzZSgpO1xuICAgIGNvbnN0IGhpc3QgPSBzbmFwc2hvdC5ieVVwcGVyU2t1W3NrdVVwcGVyXSB8fCBudWxsO1xuICAgIGNvbnN0IHZlbnRhczEybSA9IGhpc3QgPyBfc3VtVmVudGFzMTJtQ29tcGxldG9zKGhpc3QubWVzZXMsIGhveSkgOiAwO1xuICAgIGNvbnN0IHl0ZCA9IGhpc3RcbiAgICAgID8gX3N1bVZlbnRhc1lURChoaXN0Lm1lc2VzLCBob3kpXG4gICAgICA6IHsgdG90YWxZdGQ6IDAsIG1lc2VzVHJhbnNjdXJyaWRvczogaG95LmdldE1vbnRoKCkgKyAxIH07XG4gICAgY29uc3QgcHJvbWVkaW8gPSB5dGQubWVzZXNUcmFuc2N1cnJpZG9zID4gMCA/IHl0ZC50b3RhbFl0ZCAvIHl0ZC5tZXNlc1RyYW5zY3Vycmlkb3MgOiAwO1xuICAgIGNvbnN0IHBvbGl0aWNhID0gcHJvbWVkaW8gKiAzO1xuICAgIGNvbnN0IHRvdGFsID0gc3AucGVkaWRvVG90YWwgLSBwb2xpdGljYTtcbiAgICByb3dzLnB1c2goe1xuICAgICAgc2t1OiBzcC5za3UsXG4gICAgICBpdGVtTmFtZTogaGlzdCA/IGhpc3QuaXRlbU5hbWUgOiAnJyxcbiAgICAgIGZhbWlsaWE6IGhpc3QgPyBoaXN0LmZhbWlsaWEgOiAnKHNpbiBtYXRjaCknLFxuICAgICAgc3ViZmFtaWxpYTogaGlzdCA/IGhpc3Quc3ViZmFtaWxpYSA6ICcoc2luIG1hdGNoKScsXG4gICAgICB2ZW50YXMxMm06IHZlbnRhczEybSxcbiAgICAgIHBlZGlkbzZtOiBzcC5wZWRpZG9Ub3RhbCxcbiAgICAgIHByb21lZGlvOiBwcm9tZWRpbyxcbiAgICAgIHBvbGl0aWNhOiBwb2xpdGljYSxcbiAgICAgIHRvdGFsOiB0b3RhbCxcbiAgICAgIGhhc0hpc3RvcmlhOiAhIWhpc3QsXG4gICAgfSk7XG4gIH1cbiAgcmV0dXJuIHJvd3M7XG59XG5cbmZ1bmN0aW9uIF9yZW5kZXJNb2RhbFNoZWxsKCkge1xuICBjb25zdCBleGlzdGluZyA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdmb3JlY2FzdC1tb2RhbCcpO1xuICBpZiAoZXhpc3RpbmcpIHJldHVybiBleGlzdGluZztcbiAgY29uc3QgZWwgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKTtcbiAgZWwuaWQgPSAnZm9yZWNhc3QtbW9kYWwnO1xuICBlbC5jbGFzc05hbWUgPSAnbW9kYWwtb3ZlcmxheSc7XG4gIGVsLnN0eWxlLmNzc1RleHQgPVxuICAgICdkaXNwbGF5Om5vbmU7cG9zaXRpb246Zml4ZWQ7aW5zZXQ6MDtiYWNrZ3JvdW5kOnJnYmEoMTUsMjMsNDIsLjYpO3otaW5kZXg6MjA1MDsnO1xuICBlbC5vbmNsaWNrID0gZnVuY3Rpb24gKGV2KSB7XG4gICAgaWYgKGV2LnRhcmdldCA9PT0gZWwpIHdpbmRvdy5jbG9zZUZvcmVjYXN0TW9kYWwoKTtcbiAgfTtcbiAgLy8gU2hlbGwgKyB0YWJzIGJhciArIDIgY29udGVuZWRvcmVzIGRlIHRhYnMgKFNhbGVzIFBsYW5zIG51ZXZhLCBMZWdhY3kgNm0pLlxuICAvLyBFbCBjb250ZW5pZG8gZGUgY2FkYSB0YWIgc2UgcGludGEgY29uIF9yZW5kZXJTYWxlc1BsYW5zVGFiKCkgeSBlbCBsZWdhY3lcbiAgLy8gdXNhIGVsIGZsdWpvIF9yZW5kZXJUYWJsZSgpIGRlIHNpZW1wcmUuXG4gIGNvbnN0IHNoZWxsSHRtbCA9IF9idWlsZFNoZWxsSHRtbCgpO1xuICBlbC5pbm5lckhUTUwgPSBzaGVsbEh0bWw7XG4gIGRvY3VtZW50LmJvZHkuYXBwZW5kQ2hpbGQoZWwpO1xuICByZXR1cm4gZWw7XG59XG5cbmZ1bmN0aW9uIF9idWlsZFNoZWxsSHRtbCgpIHtcbiAgLy8gQnJva2VuLW91dCBwdXJlIHN0cmluZyBidWlsZGVyIHBhcmEgcGFzYXIgZWwgaG9vayBkZSBpbm5lckhUTUwuXG4gIGNvbnN0IG1vZGFsT3V0ZXIgPSAnPGRpdiBzdHlsZT1cInBvc2l0aW9uOmFic29sdXRlO2luc2V0OjF2aCAxdnc7YmFja2dyb3VuZDp2YXIoLS1iZy1lbGV2YXRlZCk7Ym9yZGVyLXJhZGl1czoxMHB4O2Rpc3BsYXk6ZmxleDtmbGV4LWRpcmVjdGlvbjpjb2x1bW47b3ZlcmZsb3c6aGlkZGVuO2JveC1zaGFkb3c6MCAyMHB4IDUwcHggcmdiYSgwLDAsMCwuMzUpXCI+JztcbiAgY29uc3QgaGVhZGVyID0gJzxkaXYgc3R5bGU9XCJwYWRkaW5nOjEycHggMThweDtiYWNrZ3JvdW5kOiMwZjE3MmE7Y29sb3I6I2ZmZjtkaXNwbGF5OmZsZXg7YWxpZ24taXRlbXM6Y2VudGVyO2dhcDoxMnB4XCI+JyArXG4gICAgJzxkaXYgc3R5bGU9XCJmbGV4OjFcIj48ZGl2IHN0eWxlPVwiZm9udC1zaXplOjE2cHg7Zm9udC13ZWlnaHQ6ODAwO2xldHRlci1zcGFjaW5nOi41cHhcIj5GT1JFQ0FTVDwvZGl2PicgK1xuICAgICc8ZGl2IGlkPVwiZm9yZWNhc3Qtc3VidGl0bGVcIiBzdHlsZT1cImZvbnQtc2l6ZToxMXB4O29wYWNpdHk6Ljg7bWFyZ2luLXRvcDoycHhcIj5TYWxlcyBQbGFucyBtZW5zdWFsZXMgKyBwb2xpdGljYSBkZSBpbnZlbnRhcmlvPC9kaXY+PC9kaXY+JyArXG4gICAgJzxidXR0b24gb25jbGljaz1cImNsb3NlRm9yZWNhc3RNb2RhbCgpXCIgc3R5bGU9XCJiYWNrZ3JvdW5kOnRyYW5zcGFyZW50O2NvbG9yOiNmZmY7Ym9yZGVyOjFweCBzb2xpZCByZ2JhKDI1NSwyNTUsMjU1LC40KTtib3JkZXItcmFkaXVzOjZweDtwYWRkaW5nOjZweCAxMHB4O2N1cnNvcjpwb2ludGVyO2ZvbnQtd2VpZ2h0OjcwMFwiPkNlcnJhcjwvYnV0dG9uPicgK1xuICAgICc8L2Rpdj4nO1xuICBjb25zdCB0YWJzQmFyID0gJzxkaXYgaWQ9XCJmb3JlY2FzdC10YWJzLWJhclwiIHN0eWxlPVwiZGlzcGxheTpmbGV4O2dhcDowO2JhY2tncm91bmQ6IzFlMjkzYjtwYWRkaW5nOjAgMThweDtib3JkZXItYm90dG9tOjFweCBzb2xpZCB2YXIoLS1ib3JkZXItc3VidGxlKVwiPicgK1xuICAgICc8YnV0dG9uIGRhdGEtdGFiPVwic2FsZXMtcGxhbnNcIiBvbmNsaWNrPVwic3dpdGNoRm9yZWNhc3RUYWIoXFwnc2FsZXMtcGxhbnNcXCcpXCIgY2xhc3M9XCJmb3JlY2FzdC10YWJcIiBzdHlsZT1cInBhZGRpbmc6MTBweCAxNnB4O2JhY2tncm91bmQ6dHJhbnNwYXJlbnQ7Y29sb3I6I2ZmZjtib3JkZXI6bm9uZTtib3JkZXItYm90dG9tOjNweCBzb2xpZCAjMGQ5NDg4O2N1cnNvcjpwb2ludGVyO2ZvbnQtd2VpZ2h0OjcwMDtmb250LXNpemU6MTJweDtsZXR0ZXItc3BhY2luZzouNHB4O3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZVwiPlNhbGVzIFBsYW5zPC9idXR0b24+JyArXG4gICAgJzxidXR0b24gZGF0YS10YWI9XCJsZWdhY3lcIiBvbmNsaWNrPVwic3dpdGNoRm9yZWNhc3RUYWIoXFwnbGVnYWN5XFwnKVwiIGNsYXNzPVwiZm9yZWNhc3QtdGFiXCIgc3R5bGU9XCJwYWRkaW5nOjEwcHggMTZweDtiYWNrZ3JvdW5kOnRyYW5zcGFyZW50O2NvbG9yOiM5NGEzYjg7Ym9yZGVyOm5vbmU7Ym9yZGVyLWJvdHRvbTozcHggc29saWQgdHJhbnNwYXJlbnQ7Y3Vyc29yOnBvaW50ZXI7Zm9udC13ZWlnaHQ6NjAwO2ZvbnQtc2l6ZToxMnB4O2xldHRlci1zcGFjaW5nOi40cHg7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlXCI+Rm9yZWNhc3QgTGVnYWN5ICg2bSk8L2J1dHRvbj4nICtcbiAgICAnPC9kaXY+JztcbiAgY29uc3QgdGFiU2FsZXNQbGFucyA9ICc8ZGl2IGlkPVwiZm9yZWNhc3QtdGFiLXNhbGVzLXBsYW5zXCIgc3R5bGU9XCJmbGV4OjE7b3ZlcmZsb3c6YXV0b1wiPjwvZGl2Pic7XG4gIGNvbnN0IGxlZ2FjeUJhciA9ICc8ZGl2IHN0eWxlPVwicGFkZGluZzoxMnB4IDE4cHg7YmFja2dyb3VuZDp2YXIoLS1iZy1zZWNvbmRhcnkpO2JvcmRlci1ib3R0b206MXB4IHNvbGlkIHZhcigtLWJvcmRlci1zdWJ0bGUpO2Rpc3BsYXk6ZmxleDtmbGV4LXdyYXA6d3JhcDtnYXA6MTRweDthbGlnbi1pdGVtczpjZW50ZXJcIj4nICtcbiAgICAnPGxhYmVsIHN0eWxlPVwiZGlzcGxheTppbmxpbmUtZmxleDthbGlnbi1pdGVtczpjZW50ZXI7Z2FwOjhweDtwYWRkaW5nOjhweCAxMnB4O2JhY2tncm91bmQ6IzBkOTQ4ODtjb2xvcjojZmZmO2JvcmRlci1yYWRpdXM6NnB4O2ZvbnQtd2VpZ2h0OjcwMDtmb250LXNpemU6MTJweDtjdXJzb3I6cG9pbnRlclwiPicgK1xuICAgICc8c3Bhbj5DYXJnYXIgU2FsZXMgUGxhbiAoLnhsc3gpPC9zcGFuPicgK1xuICAgICc8aW5wdXQgdHlwZT1cImZpbGVcIiBhY2NlcHQ9XCIueGxzeCwueGxzXCIgc3R5bGU9XCJkaXNwbGF5Om5vbmVcIiBvbmNoYW5nZT1cIm9uRm9yZWNhc3RTYWxlc1BsYW5GaWxlKGV2ZW50KVwiLz48L2xhYmVsPicgK1xuICAgICc8ZGl2IGlkPVwiZm9yZWNhc3QtaGludFwiIHN0eWxlPVwiZm9udC1zaXplOjExcHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7bWF4LXdpZHRoOjUyMHB4XCI+Rm9ybWF0byBsZWdhY3k6IHByaW1lcmEgY29sdW1uYSA8Yj5TS1U8L2I+LCBsdWVnbyA2IGNvbHVtbmFzIGNvbiBsYXMgdW5pZGFkZXMgcGVkaWRhcyBtZXMgYSBtZXMuPC9kaXY+JyArXG4gICAgJzxidXR0b24gaWQ9XCJmb3JlY2FzdC1leHBvcnQtYnRuXCIgb25jbGljaz1cImV4cG9ydEZvcmVjYXN0RXhjZWwoKVwiIGRpc2FibGVkIHN0eWxlPVwicGFkZGluZzo4cHggMTRweDtiYWNrZ3JvdW5kOnZhcigtLWNvbG9yLXN1Y2Nlc3MpO2NvbG9yOiNmZmY7Ym9yZGVyOm5vbmU7Ym9yZGVyLXJhZGl1czo2cHg7Zm9udC13ZWlnaHQ6NzAwO2N1cnNvcjpwb2ludGVyO29wYWNpdHk6LjVcIj5FeHBvcnRhciBFeGNlbDwvYnV0dG9uPicgK1xuICAgICc8ZGl2IGlkPVwiZm9yZWNhc3Qtc3RhdHNcIiBzdHlsZT1cIm1hcmdpbi1sZWZ0OmF1dG87Zm9udC1zaXplOjExcHg7Y29sb3I6dmFyKC0tdGV4dC1zZWNvbmRhcnkpO2ZvbnQtd2VpZ2h0OjYwMFwiPjwvZGl2PicgK1xuICAgICc8L2Rpdj4nO1xuICBjb25zdCBsZWdhY3lCb2R5ID0gJzxkaXYgaWQ9XCJmb3JlY2FzdC1ib2R5XCIgc3R5bGU9XCJmbGV4OjE7b3ZlcmZsb3c6YXV0bztwYWRkaW5nOjBcIj48ZGl2IHN0eWxlPVwicGFkZGluZzo2MHB4IDIwcHg7dGV4dC1hbGlnbjpjZW50ZXI7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7Zm9udC1zaXplOjE0cHhcIj5Fc3BlcmFuZG8gYXJjaGl2byBTYWxlcyBQbGFuLi4uPC9kaXY+PC9kaXY+JztcbiAgY29uc3QgdGFiTGVnYWN5ID0gJzxkaXYgaWQ9XCJmb3JlY2FzdC10YWItbGVnYWN5XCIgc3R5bGU9XCJmbGV4OjE7b3ZlcmZsb3c6aGlkZGVuO2ZsZXgtZGlyZWN0aW9uOmNvbHVtbjtkaXNwbGF5Om5vbmVcIj4nICsgbGVnYWN5QmFyICsgbGVnYWN5Qm9keSArICc8L2Rpdj4nO1xuICByZXR1cm4gbW9kYWxPdXRlciArIGhlYWRlciArIHRhYnNCYXIgKyB0YWJTYWxlc1BsYW5zICsgdGFiTGVnYWN5ICsgJzwvZGl2Pic7XG59XG5cbi8vIHYxMDk4KyBGYXNlIDE6IHN3aXRjaCBlbnRyZSB0YWJzIFNhbGVzIFBsYW5zIDwtPiBMZWdhY3kuXG53aW5kb3cuc3dpdGNoRm9yZWNhc3RUYWIgPSBmdW5jdGlvbiAodGFiSWQpIHtcbiAgX2ZvcmVjYXN0QWN0aXZlVGFiID0gdGFiSWQ7XG4gIGNvbnN0IHNwID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2ZvcmVjYXN0LXRhYi1zYWxlcy1wbGFucycpO1xuICBjb25zdCBsZyA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdmb3JlY2FzdC10YWItbGVnYWN5Jyk7XG4gIGlmIChzcCkgc3Auc3R5bGUuZGlzcGxheSA9IHRhYklkID09PSAnc2FsZXMtcGxhbnMnID8gJ2Jsb2NrJyA6ICdub25lJztcbiAgaWYgKGxnKSBsZy5zdHlsZS5kaXNwbGF5ID0gdGFiSWQgPT09ICdsZWdhY3knID8gJ2ZsZXgnIDogJ25vbmUnO1xuICBjb25zdCBidG5zID0gZG9jdW1lbnQucXVlcnlTZWxlY3RvckFsbCgnI2ZvcmVjYXN0LXRhYnMtYmFyIC5mb3JlY2FzdC10YWInKTtcbiAgYnRucy5mb3JFYWNoKChiKSA9PiB7XG4gICAgY29uc3QgYWN0aXZlID0gYi5nZXRBdHRyaWJ1dGUoJ2RhdGEtdGFiJykgPT09IHRhYklkO1xuICAgIGIuc3R5bGUuY29sb3IgPSBhY3RpdmUgPyAnI2ZmZicgOiAnIzk0YTNiOCc7XG4gICAgYi5zdHlsZS5ib3JkZXJCb3R0b21Db2xvciA9IGFjdGl2ZSA/ICcjMGQ5NDg4JyA6ICd0cmFuc3BhcmVudCc7XG4gICAgYi5zdHlsZS5mb250V2VpZ2h0ID0gYWN0aXZlID8gJzcwMCcgOiAnNjAwJztcbiAgfSk7XG59O1xuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIEZBU0UgMSBcdTIwMTQgU2FsZXMgUGxhbnMgdXBsb2FkIChSb2RzIC8gUmVlbHMgLyBGRylcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5mdW5jdGlvbiBfeWVhck1vbnRoTm93KCkge1xuICBjb25zdCBkID0gbmV3IERhdGUoKTtcbiAgcmV0dXJuIGQuZ2V0RnVsbFllYXIoKSArICctJyArIFN0cmluZyhkLmdldE1vbnRoKCkgKyAxKS5wYWRTdGFydCgyLCAnMCcpO1xufVxuXG5mdW5jdGlvbiBfZm10U2l6ZShieXRlcykge1xuICBpZiAoIWJ5dGVzKSByZXR1cm4gJyc7XG4gIGlmIChieXRlcyA8IDEwMjQpIHJldHVybiBieXRlcyArICcgQic7XG4gIGlmIChieXRlcyA8IDEwMjQgKiAxMDI0KSByZXR1cm4gKGJ5dGVzIC8gMTAyNCkudG9GaXhlZCgxKSArICcgS0InO1xuICByZXR1cm4gKGJ5dGVzIC8gKDEwMjQgKiAxMDI0KSkudG9GaXhlZCgyKSArICcgTUInO1xufVxuXG5mdW5jdGlvbiBfZm10RGF0ZVNob3J0KGlzbykge1xuICBpZiAoIWlzbykgcmV0dXJuICdcdTIwMTQnO1xuICB0cnkge1xuICAgIGNvbnN0IGQgPSBpc28udG9EYXRlID8gaXNvLnRvRGF0ZSgpIDogbmV3IERhdGUoaXNvKTtcbiAgICByZXR1cm4gZC50b0xvY2FsZURhdGVTdHJpbmcoJ2VzLUFSJywgeyBkYXk6ICcyLWRpZ2l0JywgbW9udGg6ICdzaG9ydCcsIHllYXI6ICcyLWRpZ2l0JyB9KVxuICAgICAgKyAnICcgKyBkLnRvTG9jYWxlVGltZVN0cmluZygnZXMtQVInLCB7IGhvdXI6ICcyLWRpZ2l0JywgbWludXRlOiAnMi1kaWdpdCcgfSk7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiBTdHJpbmcoaXNvKTtcbiAgfVxufVxuXG5hc3luYyBmdW5jdGlvbiBfbG9hZFNhbGVzUGxhbkNhY2hlcygpIHtcbiAgaWYgKCF3aW5kb3cuZmJEYikgcmV0dXJuO1xuICBhd2FpdCBQcm9taXNlLmFsbChTQUxFU19QTEFOX0ZBTUlMSUFTLm1hcChhc3luYyAoZikgPT4ge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBkb2MgPSBhd2FpdCB3aW5kb3cuZmJEYi5jb2xsZWN0aW9uKCdzYWxlc19wbGFuX2NhY2hlJykuZG9jKGYua2V5KS5nZXQoKTtcbiAgICAgIF9zYWxlc1BsYW5DYWNoZXNbZi5rZXldID0gZG9jLmV4aXN0cyA/IGRvYy5kYXRhKCkgOiBudWxsO1xuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgIGNvbnNvbGUud2FybignW0ZPUkVDQVNUXSBsb2FkIHNhbGVzX3BsYW5fY2FjaGUvJyArIGYua2V5ICsgJyBmYWlsOicsIGUgJiYgZS5tZXNzYWdlKTtcbiAgICAgIF9zYWxlc1BsYW5DYWNoZXNbZi5rZXldID0gbnVsbDtcbiAgICB9XG4gIH0pKTtcbn1cblxuZnVuY3Rpb24gX3JlbmRlclRhYmxlKHJvd3MpIHtcbiAgY29uc3QgYm9keSA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdmb3JlY2FzdC1ib2R5Jyk7XG4gIGlmICghYm9keSkgcmV0dXJuO1xuICBpZiAoIXJvd3MgfHwgIXJvd3MubGVuZ3RoKSB7XG4gICAgYm9keS5pbm5lckhUTUwgPVxuICAgICAgJzxkaXYgc3R5bGU9XCJwYWRkaW5nOjYwcHggMjBweDt0ZXh0LWFsaWduOmNlbnRlcjtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKVwiPlNhbGVzIFBsYW4gdmFjaW8gbyBzaW4gZmlsYXMgdmFsaWRhcy48L2Rpdj4nO1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCBmbXQgPSAobikgPT5cbiAgICBuID09PSAwIHx8ICFOdW1iZXIuaXNGaW5pdGUobilcbiAgICAgID8gJzAnXG4gICAgICA6IE51bWJlcihuKS50b0xvY2FsZVN0cmluZygnZXMtQVInLCB7IG1heGltdW1GcmFjdGlvbkRpZ2l0czogMSB9KTtcbiAgY29uc3QgY29sb3JGb3JUb3RhbCA9ICh0KSA9PiB7XG4gICAgaWYgKHQgPiAwKSByZXR1cm4gJyMxNjY1MzQnOyAvLyBzb2JyYSAocGVkaXN0ZSBtYXMgcXVlIGxhIHBvbGl0aWNhKSAtIHZlcmRlXG4gICAgaWYgKHQgPCAwKSByZXR1cm4gJyNjMjQxMGMnOyAvLyBmYWx0YSAocGVkaXN0ZSBtZW5vcyBxdWUgbGEgcG9saXRpY2EpIC0gbmFyYW5qYSB1cmdlbnRlXG4gICAgcmV0dXJuICcjNDc1NTY5JztcbiAgfTtcbiAgY29uc3Qgcm93c0h0bWwgPSByb3dzXG4gICAgLm1hcChcbiAgICAgIChyKSA9PlxuICAgICAgICAnJyArXG4gICAgICAgICc8dHInICtcbiAgICAgICAgKHIuaGFzSGlzdG9yaWEgPyAnJyA6ICcgc3R5bGU9XCJiYWNrZ3JvdW5kOnZhcigtLWNvbG9yLXdhcm5pbmctYmcpXCInKSArXG4gICAgICAgICc+JyArXG4gICAgICAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjZweCAxMHB4O2ZvbnQtZmFtaWx5Om1vbm9zcGFjZTtmb250LXNpemU6MTFweDt3aGl0ZS1zcGFjZTpub3dyYXBcIj4nICtcbiAgICAgICAgZXNjYXBlSHRtbFNhZmUoci5za3UpICtcbiAgICAgICAgJzwvdGQ+JyArXG4gICAgICAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjZweCAxMHB4O2ZvbnQtc2l6ZToxMXB4XCI+JyArXG4gICAgICAgIGVzY2FwZUh0bWxTYWZlKHIuZmFtaWxpYSkgK1xuICAgICAgICAnPC90ZD4nICtcbiAgICAgICAgJzx0ZCBzdHlsZT1cInBhZGRpbmc6NnB4IDEwcHg7Zm9udC1zaXplOjExcHhcIj4nICtcbiAgICAgICAgZXNjYXBlSHRtbFNhZmUoci5zdWJmYW1pbGlhKSArXG4gICAgICAgICc8L3RkPicgK1xuICAgICAgICAnPHRkIHN0eWxlPVwicGFkZGluZzo2cHggMTBweDt0ZXh0LWFsaWduOnJpZ2h0O2ZvbnQtdmFyaWFudC1udW1lcmljOnRhYnVsYXItbnVtc1wiPicgK1xuICAgICAgICBmbXQoci52ZW50YXMxMm0pICtcbiAgICAgICAgJzwvdGQ+JyArXG4gICAgICAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjZweCAxMHB4O3RleHQtYWxpZ246cmlnaHQ7Zm9udC12YXJpYW50LW51bWVyaWM6dGFidWxhci1udW1zO2ZvbnQtd2VpZ2h0OjYwMFwiPicgK1xuICAgICAgICBmbXQoci5wZWRpZG82bSkgK1xuICAgICAgICAnPC90ZD4nICtcbiAgICAgICAgJzx0ZCBzdHlsZT1cInBhZGRpbmc6NnB4IDEwcHg7dGV4dC1hbGlnbjpyaWdodDtmb250LXZhcmlhbnQtbnVtZXJpYzp0YWJ1bGFyLW51bXM7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZClcIj4nICtcbiAgICAgICAgZm10KHIucHJvbWVkaW8pICtcbiAgICAgICAgJzwvdGQ+JyArXG4gICAgICAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjZweCAxMHB4O3RleHQtYWxpZ246cmlnaHQ7Zm9udC12YXJpYW50LW51bWVyaWM6dGFidWxhci1udW1zXCI+JyArXG4gICAgICAgIGZtdChyLnBvbGl0aWNhKSArXG4gICAgICAgICc8L3RkPicgK1xuICAgICAgICAnPHRkIHN0eWxlPVwicGFkZGluZzo2cHggMTBweDt0ZXh0LWFsaWduOnJpZ2h0O2ZvbnQtdmFyaWFudC1udW1lcmljOnRhYnVsYXItbnVtcztmb250LXdlaWdodDo3MDA7Y29sb3I6JyArXG4gICAgICAgIGNvbG9yRm9yVG90YWwoci50b3RhbCkgK1xuICAgICAgICAnXCI+JyArXG4gICAgICAgIGZtdChyLnRvdGFsKSArXG4gICAgICAgICc8L3RkPicgK1xuICAgICAgICAnPC90cj4nXG4gICAgKVxuICAgIC5qb2luKCcnKTtcbiAgY29uc3QgaGVhZGVyID1cbiAgICAnJyArXG4gICAgJzx0aGVhZCBzdHlsZT1cInBvc2l0aW9uOnN0aWNreTt0b3A6MDtiYWNrZ3JvdW5kOiMwZjE3MmE7Y29sb3I6I2ZmZjt6LWluZGV4OjFcIj4nICtcbiAgICAnPHRyPicgK1xuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjhweCAxMHB4O3RleHQtYWxpZ246bGVmdDtmb250LXNpemU6MTFweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7bGV0dGVyLXNwYWNpbmc6LjRweFwiPlNLVTwvdGg+JyArXG4gICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6OHB4IDEwcHg7dGV4dC1hbGlnbjpsZWZ0O2ZvbnQtc2l6ZToxMXB4O3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtsZXR0ZXItc3BhY2luZzouNHB4XCI+RmFtaWxpYTwvdGg+JyArXG4gICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6OHB4IDEwcHg7dGV4dC1hbGlnbjpsZWZ0O2ZvbnQtc2l6ZToxMXB4O3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtsZXR0ZXItc3BhY2luZzouNHB4XCI+U3ViZmFtaWxpYTwvdGg+JyArXG4gICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6OHB4IDEwcHg7dGV4dC1hbGlnbjpyaWdodDtmb250LXNpemU6MTFweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7bGV0dGVyLXNwYWNpbmc6LjRweFwiIHRpdGxlPVwiU3VtYSBkZSBxdHkgZmFjdHVyYWRhIGVuIGxvcyB1bHRpbW9zIDEyIG1lc2VzIGNvbXBsZXRvc1wiPlZlbnRhcyAxMm08L3RoPicgK1xuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjhweCAxMHB4O3RleHQtYWxpZ246cmlnaHQ7Zm9udC1zaXplOjExcHg7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO2xldHRlci1zcGFjaW5nOi40cHhcIiB0aXRsZT1cIlN1bWEgZGUgbGFzIDYgY29sdW1uYXMgZGVsIEV4Y2VsIFNhbGVzIFBsYW5cIj5QZWRpZG8gNm08L3RoPicgK1xuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjhweCAxMHB4O3RleHQtYWxpZ246cmlnaHQ7Zm9udC1zaXplOjExcHg7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO2xldHRlci1zcGFjaW5nOi40cHhcIiB0aXRsZT1cIlZlbnRhcyBZVEQgLyBtZXNlcyB0cmFuc2N1cnJpZG9zIGRlbCBhXHUwMEYxb1wiPlByb20gLyBNZXM8L3RoPicgK1xuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjhweCAxMHB4O3RleHQtYWxpZ246cmlnaHQ7Zm9udC1zaXplOjExcHg7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO2xldHRlci1zcGFjaW5nOi40cHhcIiB0aXRsZT1cIlByb21lZGlvIHggMyBtZXNlcyAocG9saXRpY2EgZGUgaW52ZW50YXJpbylcIj5Qb2xpdGljYTwvdGg+JyArXG4gICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6OHB4IDEwcHg7dGV4dC1hbGlnbjpyaWdodDtmb250LXNpemU6MTFweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7bGV0dGVyLXNwYWNpbmc6LjRweFwiIHRpdGxlPVwiUGVkaWRvIDZtIC0gUG9saXRpY2EuIE5lZ2F0aXZvID0gdGUgZmFsdGEgcGVkaXI7IFBvc2l0aXZvID0gc29icmVwZWRpZG9cIj5Ub3RhbDwvdGg+JyArXG4gICAgJzwvdHI+JyArXG4gICAgJzwvdGhlYWQ+JztcbiAgYm9keS5pbm5lckhUTUwgPVxuICAgICc8dGFibGUgc3R5bGU9XCJ3aWR0aDoxMDAlO2JvcmRlci1jb2xsYXBzZTpjb2xsYXBzZTtmb250LXNpemU6MTJweFwiPicgK1xuICAgIGhlYWRlciArXG4gICAgJzx0Ym9keT4nICtcbiAgICByb3dzSHRtbCArXG4gICAgJzwvdGJvZHk+PC90YWJsZT4nO1xufVxuXG5mdW5jdGlvbiBlc2NhcGVIdG1sU2FmZShzKSB7XG4gIGlmICh0eXBlb2Ygd2luZG93LmVzY2FwZUh0bWwgPT09ICdmdW5jdGlvbicpIHJldHVybiB3aW5kb3cuZXNjYXBlSHRtbChzKTtcbiAgcmV0dXJuIFN0cmluZyhzID09IG51bGwgPyAnJyA6IHMpLnJlcGxhY2UoXG4gICAgL1smPD5cIiddL2csXG4gICAgKGNoKSA9PiAoeyAnJic6ICcmYW1wOycsICc8JzogJyZsdDsnLCAnPic6ICcmZ3Q7JywgJ1wiJzogJyZxdW90OycsIFwiJ1wiOiAnJiMzOTsnIH0pW2NoXVxuICApO1xufVxuXG5mdW5jdGlvbiBfYnVpbGRTYWxlc1BsYW5TbG90SHRtbChmKSB7XG4gIGNvbnN0IGNhY2hlID0gX3NhbGVzUGxhbkNhY2hlc1tmLmtleV07XG4gIGNvbnN0IHJvd3NDb3VudCA9IGNhY2hlICYmIE51bWJlci5pc0Zpbml0ZShjYWNoZS5yb3dzQ291bnQpID8gY2FjaGUucm93c0NvdW50IDogMDtcbiAgY29uc3QgbW9udGhzQ291bnQgPSBjYWNoZSAmJiBBcnJheS5pc0FycmF5KGNhY2hlLmRldGVjdGVkTW9udGhzKSA/IGNhY2hlLmRldGVjdGVkTW9udGhzLmxlbmd0aCA6IDA7XG4gIGNvbnN0IHBhcnNlZEF0ID0gY2FjaGUgJiYgY2FjaGUucGFyc2VkQXQgPyBfZm10RGF0ZVNob3J0KGNhY2hlLnBhcnNlZEF0KSA6ICcnO1xuICBjb25zdCB1cGxvYWRlZEJ5ID0gY2FjaGUgJiYgY2FjaGUudXBsb2FkZWRCeSA/IGNhY2hlLnVwbG9hZGVkQnkgOiAnJztcbiAgY29uc3Qgc291cmNlRmlsZW5hbWUgPSBjYWNoZSAmJiBjYWNoZS5zb3VyY2VGaWxlbmFtZSA/IGNhY2hlLnNvdXJjZUZpbGVuYW1lIDogJyc7XG4gIGNvbnN0IHllYXJNb250aCA9IGNhY2hlICYmIGNhY2hlLnllYXJNb250aCA/IGNhY2hlLnllYXJNb250aCA6ICcnO1xuICBjb25zdCBtb250aHNSYW5nZSA9IGNhY2hlICYmIGNhY2hlLmRldGVjdGVkTW9udGhzICYmIGNhY2hlLmRldGVjdGVkTW9udGhzLmxlbmd0aFxuICAgID8gKGNhY2hlLmRldGVjdGVkTW9udGhzWzBdICsgJyBcdTIxOTIgJyArIGNhY2hlLmRldGVjdGVkTW9udGhzW2NhY2hlLmRldGVjdGVkTW9udGhzLmxlbmd0aCAtIDFdKVxuICAgIDogJ1x1MjAxNCc7XG4gIGNvbnN0IGhhc0NhY2hlID0gISFjYWNoZTtcbiAgY29uc3QgYmFkZ2UgPSBoYXNDYWNoZVxuICAgID8gJzxkaXYgc3R5bGU9XCJwYWRkaW5nOjRweCA4cHg7YmFja2dyb3VuZDojMTZhMzRhO2NvbG9yOiNmZmY7Ym9yZGVyLXJhZGl1czoxMnB4O2ZvbnQtc2l6ZToxMHB4O2ZvbnQtd2VpZ2h0OjcwMDtsZXR0ZXItc3BhY2luZzouNHB4XCI+Q0FSR0FETzwvZGl2PidcbiAgICA6ICc8ZGl2IHN0eWxlPVwicGFkZGluZzo0cHggOHB4O2JhY2tncm91bmQ6I2RjMjYyNjtjb2xvcjojZmZmO2JvcmRlci1yYWRpdXM6MTJweDtmb250LXNpemU6MTBweDtmb250LXdlaWdodDo3MDA7bGV0dGVyLXNwYWNpbmc6LjRweFwiPkZBTFRBPC9kaXY+JztcbiAgY29uc3QgbWV0YUJsb2NrID0gaGFzQ2FjaGVcbiAgICA/ICgnPGRpdiBzdHlsZT1cImRpc3BsYXk6Z3JpZDtncmlkLXRlbXBsYXRlLWNvbHVtbnM6YXV0byAxZnI7Z2FwOjZweCAxMnB4O2ZvbnQtc2l6ZToxMXB4O3BhZGRpbmc6MTBweCAxMnB4O2JhY2tncm91bmQ6dmFyKC0tYmctc2Vjb25kYXJ5KTtib3JkZXItcmFkaXVzOjZweFwiPicgK1xuICAgICAgICAnPGRpdiBzdHlsZT1cImNvbG9yOnZhcigtLXRleHQtbXV0ZWQpO2ZvbnQtd2VpZ2h0OjYwMFwiPkFyY2hpdm88L2Rpdj48ZGl2IHN0eWxlPVwiY29sb3I6dmFyKC0tdGV4dC1wcmltYXJ5KTtmb250LWZhbWlseTptb25vc3BhY2U7d29yZC1icmVhazpicmVhay1hbGxcIj4nICsgZXNjYXBlSHRtbFNhZmUoc291cmNlRmlsZW5hbWUpICsgJzwvZGl2PicgK1xuICAgICAgICAnPGRpdiBzdHlsZT1cImNvbG9yOnZhcigtLXRleHQtbXV0ZWQpO2ZvbnQtd2VpZ2h0OjYwMFwiPlN1YmlkbzwvZGl2PjxkaXYgc3R5bGU9XCJjb2xvcjp2YXIoLS10ZXh0LXByaW1hcnkpXCI+JyArIGVzY2FwZUh0bWxTYWZlKHBhcnNlZEF0KSArICc8L2Rpdj4nICtcbiAgICAgICAgJzxkaXYgc3R5bGU9XCJjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTtmb250LXdlaWdodDo2MDBcIj5Qb3I8L2Rpdj48ZGl2IHN0eWxlPVwiY29sb3I6dmFyKC0tdGV4dC1wcmltYXJ5KVwiPicgKyBlc2NhcGVIdG1sU2FmZSh1cGxvYWRlZEJ5KSArICc8L2Rpdj4nICtcbiAgICAgICAgJzxkaXYgc3R5bGU9XCJjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTtmb250LXdlaWdodDo2MDBcIj5TbmFwc2hvdDwvZGl2PjxkaXYgc3R5bGU9XCJjb2xvcjp2YXIoLS10ZXh0LXByaW1hcnkpO2ZvbnQtZmFtaWx5Om1vbm9zcGFjZVwiPicgKyBlc2NhcGVIdG1sU2FmZSh5ZWFyTW9udGgpICsgJzwvZGl2PicgK1xuICAgICAgICAnPGRpdiBzdHlsZT1cImNvbG9yOnZhcigtLXRleHQtbXV0ZWQpO2ZvbnQtd2VpZ2h0OjYwMFwiPlNLVXM8L2Rpdj48ZGl2IHN0eWxlPVwiY29sb3I6dmFyKC0tdGV4dC1wcmltYXJ5KTtmb250LXdlaWdodDo3MDBcIj4nICsgcm93c0NvdW50LnRvTG9jYWxlU3RyaW5nKCdlcy1BUicpICsgJzwvZGl2PicgK1xuICAgICAgICAnPGRpdiBzdHlsZT1cImNvbG9yOnZhcigtLXRleHQtbXV0ZWQpO2ZvbnQtd2VpZ2h0OjYwMFwiPk1lc2VzPC9kaXY+PGRpdiBzdHlsZT1cImNvbG9yOnZhcigtLXRleHQtcHJpbWFyeSk7Zm9udC13ZWlnaHQ6NzAwXCI+JyArIG1vbnRoc0NvdW50ICsgJyA8c3BhbiBzdHlsZT1cImNvbG9yOnZhcigtLXRleHQtbXV0ZWQpO2ZvbnQtd2VpZ2h0OjQwMFwiPignICsgZXNjYXBlSHRtbFNhZmUobW9udGhzUmFuZ2UpICsgJyk8L3NwYW4+PC9kaXY+JyArXG4gICAgICAnPC9kaXY+JylcbiAgICA6ICc8ZGl2IHN0eWxlPVwicGFkZGluZzoxNHB4O3RleHQtYWxpZ246Y2VudGVyO2ZvbnQtc2l6ZToxMnB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO2JhY2tncm91bmQ6dmFyKC0tYmctc2Vjb25kYXJ5KTtib3JkZXItcmFkaXVzOjZweDtib3JkZXI6MXB4IGRhc2hlZCB2YXIoLS1ib3JkZXItc3VidGxlKVwiPkF1biBubyBzdWJpc3RlIGVsIFNhbGVzIFBsYW4gZGUgZXN0YSBmYW1pbGlhLjwvZGl2Pic7XG4gIGNvbnN0IHVwbG9hZEJ0biA9ICc8bGFiZWwgc3R5bGU9XCJkaXNwbGF5OmlubGluZS1mbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtqdXN0aWZ5LWNvbnRlbnQ6Y2VudGVyO2dhcDo4cHg7cGFkZGluZzoxMHB4IDE0cHg7YmFja2dyb3VuZDonICsgZi5jb2xvciArICc7Y29sb3I6I2ZmZjtib3JkZXItcmFkaXVzOjZweDtmb250LXdlaWdodDo3MDA7Zm9udC1zaXplOjEycHg7Y3Vyc29yOnBvaW50ZXI7bGV0dGVyLXNwYWNpbmc6LjRweFwiPicgK1xuICAgICc8c3Bhbj4nICsgKGhhc0NhY2hlID8gJ1x1MjFCQiBSZWVtcGxhemFyIEV4Y2VsJyA6ICdcdTJCMDYgQ2FyZ2FyIEV4Y2VsJykgKyAnPC9zcGFuPicgK1xuICAgICc8aW5wdXQgdHlwZT1cImZpbGVcIiBhY2NlcHQ9XCIueGxzeCwueGxzXCIgZGF0YS1mYW1pbGlhPVwiJyArIGYua2V5ICsgJ1wiIHN0eWxlPVwiZGlzcGxheTpub25lXCIgb25jaGFuZ2U9XCJvblNhbGVzUGxhbkZpbGVGb3JGYW1pbGlhKGV2ZW50LCBcXCcnICsgZi5rZXkgKyAnXFwnKVwiLz4nICtcbiAgICAnPC9sYWJlbD4nO1xuICBjb25zdCBjYXJkSGVhZCA9ICc8ZGl2IHN0eWxlPVwiZGlzcGxheTpmbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtnYXA6MTBweFwiPicgK1xuICAgICc8ZGl2IHN0eWxlPVwid2lkdGg6MTJweDtoZWlnaHQ6MzJweDtiYWNrZ3JvdW5kOicgKyBmLmNvbG9yICsgJztib3JkZXItcmFkaXVzOjNweFwiPjwvZGl2PicgK1xuICAgICc8ZGl2IHN0eWxlPVwiZmxleDoxXCI+PGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxNHB4O2ZvbnQtd2VpZ2h0OjgwMDtjb2xvcjp2YXIoLS10ZXh0LXByaW1hcnkpXCI+JyArIGVzY2FwZUh0bWxTYWZlKGYubGFiZWwpICsgJzwvZGl2PicgK1xuICAgICc8ZGl2IHN0eWxlPVwiZm9udC1zaXplOjExcHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7bWFyZ2luLXRvcDoycHhcIj5TYWxlcyBQbGFuIG1lbnN1YWwgXHUwMEI3IEhvamEgU0FSPC9kaXY+PC9kaXY+JyArXG4gICAgYmFkZ2UgKyAnPC9kaXY+JztcbiAgcmV0dXJuICc8ZGl2IHN0eWxlPVwiYmFja2dyb3VuZDp2YXIoLS1iZy1lbGV2YXRlZCk7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1ib3JkZXItc3VidGxlKTtib3JkZXItcmFkaXVzOjEwcHg7cGFkZGluZzoxNnB4O2Rpc3BsYXk6ZmxleDtmbGV4LWRpcmVjdGlvbjpjb2x1bW47Z2FwOjEycHhcIj4nICtcbiAgICBjYXJkSGVhZCArIG1ldGFCbG9jayArIHVwbG9hZEJ0biArXG4gICAgJzxkaXYgaWQ9XCJzYWxlcy1wbGFuLXN0YXR1cy0nICsgZi5rZXkgKyAnXCIgc3R5bGU9XCJmb250LXNpemU6MTFweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTttaW4taGVpZ2h0OjE0cHhcIj48L2Rpdj4nICtcbiAgICAnPC9kaXY+Jztcbn1cblxuZnVuY3Rpb24gX3JlbmRlclNhbGVzUGxhbnNUYWIoKSB7XG4gIGNvbnN0IGNvbnQgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZm9yZWNhc3QtdGFiLXNhbGVzLXBsYW5zJyk7XG4gIGlmICghY29udCkgcmV0dXJuO1xuICBjb25zdCBzbG90cyA9IFNBTEVTX1BMQU5fRkFNSUxJQVMubWFwKF9idWlsZFNhbGVzUGxhblNsb3RIdG1sKS5qb2luKCcnKTtcbiAgY29uc3QgaW50cm8gPSAnPGRpdiBzdHlsZT1cIm1hcmdpbi1ib3R0b206MTZweDtwYWRkaW5nOjEycHggMTRweDtiYWNrZ3JvdW5kOnZhcigtLWJnLXNlY29uZGFyeSk7Ym9yZGVyLWxlZnQ6M3B4IHNvbGlkICMwZDk0ODg7Ym9yZGVyLXJhZGl1czo2cHg7Zm9udC1zaXplOjEycHg7Y29sb3I6dmFyKC0tdGV4dC1zZWNvbmRhcnkpO2xpbmUtaGVpZ2h0OjEuNVwiPicgK1xuICAgICc8YiBzdHlsZT1cImNvbG9yOnZhcigtLXRleHQtcHJpbWFyeSlcIj5GYXNlIDE8L2I+IFx1MjAxNCBDYXJnXHUwMEUxIGxvcyAzIFNhbGVzIFBsYW5zIG1lbnN1YWxlcyAoUm9kcyAvIFJlZWxzIC8gRkcpLiBTZSBwYXJzZWEgbGEgaG9qYSA8Yj5TQVI8L2I+OiBTS1UsIE1PUSAxMiBtb250aHMsIHkgdW5hIGNvbHVtbmEgcG9yIG1lcy4gJyArXG4gICAgJ0VsIEV4Y2VsIG9yaWdpbmFsIHF1ZWRhIHNuYXBzaG90YWRvIGVuIFN0b3JhZ2UgeSBlbCBwYXJzZW8gcXVlZGEgZW4gRmlyZXN0b3JlIHBhcmEgZWwgY1x1MDBFMWxjdWxvIChwclx1MDBGM3hpbWEgZmFzZSkuJyArXG4gICAgJzwvZGl2Pic7XG4gIGNvbnN0IGdyaWQgPSAnPGRpdiBzdHlsZT1cImRpc3BsYXk6Z3JpZDtncmlkLXRlbXBsYXRlLWNvbHVtbnM6cmVwZWF0KGF1dG8tZml0LG1pbm1heCgzMjBweCwxZnIpKTtnYXA6MTZweFwiPicgKyBzbG90cyArICc8L2Rpdj4nO1xuICBjb250LmlubmVySFRNTCA9ICc8ZGl2IHN0eWxlPVwicGFkZGluZzoxOHB4XCI+JyArIGludHJvICsgZ3JpZCArICc8L2Rpdj4nO1xufVxuXG53aW5kb3cub25TYWxlc1BsYW5GaWxlRm9yRmFtaWxpYSA9IGFzeW5jIGZ1bmN0aW9uIChldmVudCwgZmFtaWxpYSkge1xuICBjb25zdCBmaWxlID0gZXZlbnQgJiYgZXZlbnQudGFyZ2V0ICYmIGV2ZW50LnRhcmdldC5maWxlcyAmJiBldmVudC50YXJnZXQuZmlsZXNbMF07XG4gIGlmICghZmlsZSkgcmV0dXJuO1xuICBjb25zdCBzdGF0dXNFbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdzYWxlcy1wbGFuLXN0YXR1cy0nICsgZmFtaWxpYSk7XG4gIGNvbnN0IHNldFN0YXR1cyA9IChtc2csIGNvbG9yKSA9PiB7XG4gICAgaWYgKCFzdGF0dXNFbCkgcmV0dXJuO1xuICAgIHN0YXR1c0VsLnRleHRDb250ZW50ID0gbXNnO1xuICAgIHN0YXR1c0VsLnN0eWxlLmNvbG9yID0gY29sb3IgfHwgJ3ZhcigtLXRleHQtbXV0ZWQpJztcbiAgfTtcbiAgdHJ5IHtcbiAgICBpZiAodHlwZW9mIFhMU1ggPT09ICd1bmRlZmluZWQnKSB7XG4gICAgICBhbGVydCgnU2hlZXRKUyAoWExTWCkgbm8gY2FyZ2FkbyBcdTIwMTQgcmVjYXJnXHUwMEUxIGxhIGFwcC4nKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgaWYgKCF3aW5kb3cuU2FsZXNQbGFuUGFyc2VyIHx8ICF3aW5kb3cuU2FsZXNQbGFuUGFyc2VyLnBhcnNlU2FsZXNQbGFuU2hlZXQpIHtcbiAgICAgIGFsZXJ0KCdQYXJzZXIgU2FsZXMgUGxhbiBubyBjYXJnYWRvLiBSZWJ1aWxkIGJ1bmRsZS4nKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgaWYgKCF3aW5kb3cuZmlyZWJhc2UgfHwgIXdpbmRvdy5maXJlYmFzZS5zdG9yYWdlKSB7XG4gICAgICBhbGVydCgnRmlyZWJhc2UgU3RvcmFnZSBubyBkaXNwb25pYmxlLicpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBzZXRTdGF0dXMoJ0xleWVuZG8gRXhjZWxcdTIwMjYnKTtcbiAgICBjb25zdCBidWYgPSBhd2FpdCBmaWxlLmFycmF5QnVmZmVyKCk7XG4gICAgY29uc3Qgd2IgPSBYTFNYLnJlYWQoYnVmLCB7IHR5cGU6ICdhcnJheScgfSk7XG4gICAgY29uc3Qgc2FyTmFtZSA9IHdiLlNoZWV0TmFtZXMuZmluZCgobikgPT4gU3RyaW5nKG4gfHwgJycpLnRyaW0oKS50b1VwcGVyQ2FzZSgpID09PSAnU0FSJyk7XG4gICAgaWYgKCFzYXJOYW1lKSB7XG4gICAgICBzZXRTdGF0dXMoJ1x1MjZBMCBFbCBFeGNlbCBubyB0aWVuZSBob2phIFwiU0FSXCIuIEhvamFzIGVuY29udHJhZGFzOiAnICsgd2IuU2hlZXROYW1lcy5qb2luKCcsICcpLCAnI2RjMjYyNicpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBjb25zdCBzaGVldCA9IHdiLlNoZWV0c1tzYXJOYW1lXTtcbiAgICBjb25zdCByb3dzID0gWExTWC51dGlscy5zaGVldF90b19qc29uKHNoZWV0LCB7IGhlYWRlcjogMSwgZGVmdmFsOiAnJywgcmF3OiB0cnVlIH0pO1xuICAgIHNldFN0YXR1cygnUGFyc2VhbmRvICcgKyByb3dzLmxlbmd0aCArICcgZmlsYXMgZGUgaG9qYSBcIicgKyBzYXJOYW1lICsgJ1wiXHUyMDI2Jyk7XG4gICAgY29uc3QgcGFyc2VkID0gd2luZG93LlNhbGVzUGxhblBhcnNlci5wYXJzZVNhbGVzUGxhblNoZWV0KHJvd3MpO1xuICAgIGlmICghcGFyc2VkLnJvd3MubGVuZ3RoKSB7XG4gICAgICBzZXRTdGF0dXMoJ1x1MjZBMCBFeGNlbCBwYXJzZWFkbyBwZXJvIHNpbiBTS1VzIHZcdTAwRTFsaWRvcy4nLCAnI2RjMjYyNicpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBjb25zdCB5ZWFyTW9udGggPSBfeWVhck1vbnRoTm93KCk7XG4gICAgY29uc3Qgc3RvcmFnZVBhdGggPSAnZm9yZWNhc3RzX3NuYXBzaG90cy8nICsgeWVhck1vbnRoICsgJy8nICsgZmFtaWxpYSArICcueGxzeCc7XG4gICAgc2V0U3RhdHVzKCdTdWJpZW5kbyBFeGNlbCBhIFN0b3JhZ2UgKCcgKyBfZm10U2l6ZShmaWxlLnNpemUpICsgJylcdTIwMjYnKTtcbiAgICBjb25zdCBzdG9yYWdlUmVmID0gd2luZG93LmZpcmViYXNlLnN0b3JhZ2UoKS5yZWYoc3RvcmFnZVBhdGgpO1xuICAgIGF3YWl0IHN0b3JhZ2VSZWYucHV0KGZpbGUsIHtcbiAgICAgIGNvbnRlbnRUeXBlOiBmaWxlLnR5cGUgfHwgJ2FwcGxpY2F0aW9uL3ZuZC5vcGVueG1sZm9ybWF0cy1vZmZpY2Vkb2N1bWVudC5zcHJlYWRzaGVldG1sLnNoZWV0JyxcbiAgICAgIGN1c3RvbU1ldGFkYXRhOiB7XG4gICAgICAgIGZhbWlsaWEsXG4gICAgICAgIHVwbG9hZGVkQnk6ICh3aW5kb3cuY3VycmVudFVzZXIgJiYgd2luZG93LmN1cnJlbnRVc2VyLmVtYWlsKSB8fCAnJyxcbiAgICAgICAgc291cmNlRmlsZW5hbWU6IGZpbGUubmFtZSB8fCAnJyxcbiAgICAgIH0sXG4gICAgfSk7XG4gICAgc2V0U3RhdHVzKCdHdWFyZGFuZG8gcGFyc2VvIGVuIEZpcmVzdG9yZSAoJyArIHBhcnNlZC5yb3dzLmxlbmd0aCArICcgU0tVcylcdTIwMjYnKTtcbiAgICBjb25zdCB1cGxvYWRlZEJ5ID0gKHdpbmRvdy5jdXJyZW50VXNlciAmJiB3aW5kb3cuY3VycmVudFVzZXIuZW1haWwpIHx8ICd1bmtub3duJztcbiAgICBjb25zdCBwYXlsb2FkID0ge1xuICAgICAgZmFtaWxpYSxcbiAgICAgIHBhcnNlZEF0OiAod2luZG93LmZpcmViYXNlICYmIHdpbmRvdy5maXJlYmFzZS5maXJlc3RvcmUgJiYgd2luZG93LmZpcmViYXNlLmZpcmVzdG9yZS5GaWVsZFZhbHVlKVxuICAgICAgICA/IHdpbmRvdy5maXJlYmFzZS5maXJlc3RvcmUuRmllbGRWYWx1ZS5zZXJ2ZXJUaW1lc3RhbXAoKVxuICAgICAgICA6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICAgIHVwbG9hZGVkQnksXG4gICAgICBzb3VyY2VGaWxlbmFtZTogZmlsZS5uYW1lIHx8ICcnLFxuICAgICAgc291cmNlU2hlZXQ6IHNhck5hbWUsXG4gICAgICB5ZWFyTW9udGgsXG4gICAgICBzdG9yYWdlUGF0aCxcbiAgICAgIHJvd3NDb3VudDogcGFyc2VkLnJvd3MubGVuZ3RoLFxuICAgICAgaGVhZGVyUm93SW5kZXg6IHBhcnNlZC5oZWFkZXJSb3dJbmRleCxcbiAgICAgIGRldGVjdGVkTW9udGhzOiBwYXJzZWQuZGV0ZWN0ZWRNb250aHMsXG4gICAgICByb3dzOiBwYXJzZWQucm93cyxcbiAgICB9O1xuICAgIGF3YWl0IHdpbmRvdy5mYkRiLmNvbGxlY3Rpb24oJ3NhbGVzX3BsYW5fY2FjaGUnKS5kb2MoZmFtaWxpYSkuc2V0KHBheWxvYWQpO1xuICAgIF9zYWxlc1BsYW5DYWNoZXNbZmFtaWxpYV0gPSBwYXlsb2FkO1xuICAgIHNldFN0YXR1cygnXHUyNzEzIE9LLiAnICsgcGFyc2VkLnJvd3MubGVuZ3RoICsgJyBTS1VzIFx1MDBENyAnICsgcGFyc2VkLmRldGVjdGVkTW9udGhzLmxlbmd0aCArICcgbWVzZXMuJywgJyMxNmEzNGEnKTtcbiAgICBfcmVuZGVyU2FsZXNQbGFuc1RhYigpO1xuICB9IGNhdGNoIChlKSB7XG4gICAgY29uc29sZS5lcnJvcignW0ZPUkVDQVNUXSB1cGxvYWQgc2FsZXMgcGxhbiAnICsgZmFtaWxpYSArICcgZmFpbDonLCBlKTtcbiAgICBzZXRTdGF0dXMoJ1x1MjcxNyBFcnJvcjogJyArICgoZSAmJiBlLm1lc3NhZ2UpIHx8IGUpLCAnI2RjMjYyNicpO1xuICAgIGlmIChlICYmIGUuY29kZSA9PT0gJ01PTlRIU19OT1RfRk9VTkQnKSB7XG4gICAgICBhbGVydCgnRWwgRXhjZWwgbm8gdGllbmUgY29sdW1uYXMgZGUgbWVzZXMgcmVjb25vY2libGVzLlxcblxcbkhlYWRlcnMgZXNwZXJhZG9zOiBcIkphbiAyMDI3XCIsIFwiTWF5IDIwMjdcIiwgXCJFbmUgMjAyN1wiLCBcIjIwMjctMDFcIiwgZXRjLlxcblxcbkRldGFsbGU6ICcgKyBlLm1lc3NhZ2UpO1xuICAgIH1cbiAgfSBmaW5hbGx5IHtcbiAgICBpZiAoZXZlbnQgJiYgZXZlbnQudGFyZ2V0KSBldmVudC50YXJnZXQudmFsdWUgPSAnJztcbiAgfVxufTtcblxud2luZG93Lm9wZW5Gb3JlY2FzdE1vZGFsID0gYXN5bmMgZnVuY3Rpb24gKCkge1xuICBpZiAoIV9jYW5Gb3JlY2FzdCgpKSB7XG4gICAgYWxlcnQoJ0ZPUkVDQVNUIGVzIHNvbG8gcGFyYSBNYXJpYW5vIChhZG1pbikuJyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGNvbnN0IGVsID0gX3JlbmRlck1vZGFsU2hlbGwoKTtcbiAgZWwuc3R5bGUuZGlzcGxheSA9ICdibG9jayc7XG4gIC8vIHYxMDk4KyBGYXNlIDE6IGNhcmdhciBTYWxlcyBQbGFucyBjYWNoZXMgKyByZW5kZXJpemFyIHRhYiBkZWZhdWx0LlxuICBfcmVuZGVyU2FsZXNQbGFuc1RhYigpO1xuICBfbG9hZFNhbGVzUGxhbkNhY2hlcygpLnRoZW4oX3JlbmRlclNhbGVzUGxhbnNUYWIpLmNhdGNoKCgpID0+IHt9KTtcbiAgLy8gTGVnYWN5OiBzbmFwc2hvdCBzb2xvIHNlIGNhcmdhIGxhenkgc2kgZWwgdXNlciBjYW1iaWEgYSB0YWIgTGVnYWN5LlxuICBpZiAoX2ZvcmVjYXN0TG9hZGluZykgcmV0dXJuO1xuICBpZiAoIV9mb3JlY2FzdFNuYXBzaG90KSB7XG4gICAgX2ZvcmVjYXN0TG9hZGluZyA9IHRydWU7XG4gICAgY29uc3Qgc3RhdHMgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZm9yZWNhc3Qtc3RhdHMnKTtcbiAgICBpZiAoc3RhdHMpIHN0YXRzLnRleHRDb250ZW50ID0gJ0NhcmdhbmRvIHNuYXBzaG90IGRlIHZlbnRhcy4uLic7XG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IF9sb2FkU25hcHNob3QoKTtcbiAgICAgIGlmIChzdGF0cykgc3RhdHMudGV4dENvbnRlbnQgPSBfZm9yZWNhc3RTbmFwc2hvdC5jb3VudCArICcgU0tVcyBlbiBzbmFwc2hvdCBoaXN0b3JpY28nO1xuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgIGlmIChzdGF0cykgc3RhdHMudGV4dENvbnRlbnQgPSAnRXJyb3IgY2FyZ2FuZG8gc25hcHNob3Q6ICcgKyAoKGUgJiYgZS5tZXNzYWdlKSB8fCBlKTtcbiAgICAgIC8vIE5vIGFsZXJ0IFx1MjAxNCBsZWdhY3kgZXMgb3B0LWluLCBubyBibG9xdWVhIGFsIHVzdWFyaW8gc2kgc29sbyB2YSBhIHN1YmlyIFNhbGVzIFBsYW5zLlxuICAgICAgY29uc29sZS53YXJuKCdbRk9SRUNBU1RdIHNuYXBzaG90IGxvYWQgZmFpbCAobGVnYWN5IHRhYiknLCBlKTtcbiAgICB9IGZpbmFsbHkge1xuICAgICAgX2ZvcmVjYXN0TG9hZGluZyA9IGZhbHNlO1xuICAgIH1cbiAgfSBlbHNlIHtcbiAgICBjb25zdCBzdGF0cyA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdmb3JlY2FzdC1zdGF0cycpO1xuICAgIGlmIChzdGF0cykgc3RhdHMudGV4dENvbnRlbnQgPSBfZm9yZWNhc3RTbmFwc2hvdC5jb3VudCArICcgU0tVcyBlbiBzbmFwc2hvdCBoaXN0b3JpY28nO1xuICB9XG59O1xuXG53aW5kb3cuY2xvc2VGb3JlY2FzdE1vZGFsID0gZnVuY3Rpb24gKCkge1xuICBjb25zdCBlbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdmb3JlY2FzdC1tb2RhbCcpO1xuICBpZiAoZWwpIGVsLnN0eWxlLmRpc3BsYXkgPSAnbm9uZSc7XG59O1xuXG53aW5kb3cub25Gb3JlY2FzdFNhbGVzUGxhbkZpbGUgPSBhc3luYyBmdW5jdGlvbiAoZXZlbnQpIHtcbiAgY29uc3QgZmlsZSA9IGV2ZW50ICYmIGV2ZW50LnRhcmdldCAmJiBldmVudC50YXJnZXQuZmlsZXMgJiYgZXZlbnQudGFyZ2V0LmZpbGVzWzBdO1xuICBpZiAoIWZpbGUpIHJldHVybjtcbiAgdHJ5IHtcbiAgICBpZiAoIV9mb3JlY2FzdFNuYXBzaG90KSBhd2FpdCBfbG9hZFNuYXBzaG90KCk7XG4gICAgY29uc3QgYnVmID0gYXdhaXQgZmlsZS5hcnJheUJ1ZmZlcigpO1xuICAgIGlmICh0eXBlb2YgWExTWCA9PT0gJ3VuZGVmaW5lZCcpIHtcbiAgICAgIGFsZXJ0KCdYTFNYIG5vIGNhcmdhZG8nKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgY29uc3Qgd2IgPSBYTFNYLnJlYWQoYnVmLCB7IHR5cGU6ICdhcnJheScgfSk7XG4gICAgY29uc3Qgc2hlZXQgPSB3Yi5TaGVldHNbd2IuU2hlZXROYW1lc1swXV07XG4gICAgY29uc3Qgcm93cyA9IFhMU1gudXRpbHMuc2hlZXRfdG9fanNvbihzaGVldCwgeyBoZWFkZXI6IDEsIGRlZnZhbDogbnVsbCwgcmF3OiB0cnVlIH0pO1xuICAgIGNvbnN0IHBhcnNlZCA9IF9wYXJzZVNhbGVzUGxhblJvd3Mocm93cyk7XG4gICAgaWYgKCFwYXJzZWQubGVuZ3RoKSB7XG4gICAgICBhbGVydCgnRWwgRXhjZWwgZXN0YSB2YWNpbyBvIG5vIHRpZW5lIGZpbGFzIHZhbGlkYXMuJyk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIF9mb3JlY2FzdFNhbGVzUGxhbiA9IHBhcnNlZDtcbiAgICBjb25zdCBob3kgPSBuZXcgRGF0ZSgpO1xuICAgIF9mb3JlY2FzdFJvd3MgPSBfY29tcHV0ZUZvcmVjYXN0Um93cyhfZm9yZWNhc3RTbmFwc2hvdCwgcGFyc2VkLCBob3kpO1xuICAgIF9yZW5kZXJUYWJsZShfZm9yZWNhc3RSb3dzKTtcbiAgICBjb25zdCBzaW5NYXRjaCA9IF9mb3JlY2FzdFJvd3MuZmlsdGVyKChyKSA9PiAhci5oYXNIaXN0b3JpYSkubGVuZ3RoO1xuICAgIGNvbnN0IHN0YXRzID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2ZvcmVjYXN0LXN0YXRzJyk7XG4gICAgaWYgKHN0YXRzKSB7XG4gICAgICBzdGF0cy50ZXh0Q29udGVudCA9XG4gICAgICAgIHBhcnNlZC5sZW5ndGggK1xuICAgICAgICAnIFNLVXMgZW4gU2FsZXMgUGxhbiBcdTAwQjcgJyArXG4gICAgICAgIChwYXJzZWQubGVuZ3RoIC0gc2luTWF0Y2gpICtcbiAgICAgICAgJyBjb24gaGlzdG9yaWEgXHUwMEI3ICcgK1xuICAgICAgICBzaW5NYXRjaCArXG4gICAgICAgICcgc2luIG1hdGNoIChmb25kbyBhbWFyaWxsbyknO1xuICAgIH1cbiAgICBjb25zdCBidG4gPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZm9yZWNhc3QtZXhwb3J0LWJ0bicpO1xuICAgIGlmIChidG4pIHtcbiAgICAgIGJ0bi5kaXNhYmxlZCA9IGZhbHNlO1xuICAgICAgYnRuLnN0eWxlLm9wYWNpdHkgPSAnMSc7XG4gICAgfVxuICB9IGNhdGNoIChlKSB7XG4gICAgY29uc29sZS5lcnJvcignW0ZPUkVDQVNUXSBwYXJzZSBlcnJvcjonLCBlKTtcbiAgICBhbGVydCgnRXJyb3IgcHJvY2VzYW5kbyBlbCBFeGNlbDpcXG4nICsgKChlICYmIGUubWVzc2FnZSkgfHwgZSkpO1xuICB9IGZpbmFsbHkge1xuICAgIC8vIFJlc2V0IGlucHV0IHBhcmEgcXVlIGVsIG1pc21vIGFyY2hpdm8gc2UgcHVlZGEgcmUtc3ViaXJcbiAgICBpZiAoZXZlbnQgJiYgZXZlbnQudGFyZ2V0KSBldmVudC50YXJnZXQudmFsdWUgPSAnJztcbiAgfVxufTtcblxud2luZG93LmV4cG9ydEZvcmVjYXN0RXhjZWwgPSBmdW5jdGlvbiAoKSB7XG4gIGlmICghX2ZvcmVjYXN0Um93cyB8fCAhX2ZvcmVjYXN0Um93cy5sZW5ndGgpIHtcbiAgICBhbGVydCgnTm8gaGF5IGRhdG9zIHBhcmEgZXhwb3J0YXIuIENhcmdhIHByaW1lcm8gZWwgU2FsZXMgUGxhbi4nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgaWYgKHR5cGVvZiBYTFNYID09PSAndW5kZWZpbmVkJykge1xuICAgIGFsZXJ0KCdYTFNYIG5vIGNhcmdhZG8nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgY29uc3Qgcm91bmQxID0gKG4pID0+IE1hdGgucm91bmQoTnVtYmVyKG4gfHwgMCkgKiAxMCkgLyAxMDtcbiAgY29uc3QgYW9hID0gW1xuICAgIFtcbiAgICAgICdTS1UnLFxuICAgICAgJ0ZBTUlMSUEnLFxuICAgICAgJ1NVQkZBTUlMSUEnLFxuICAgICAgJ1ZFTlRBUyAoMTJtKScsXG4gICAgICAnUEVESURPLVNBTEVTIFBMQU5TICg2bSknLFxuICAgICAgJ1BST01FRElPIERFIElOVkVOVEFSSU8nLFxuICAgICAgJ1BPTElUSUNBIERFIElOVkVOVEFSSU8gKDNtKScsXG4gICAgICAnVE9UQUwnLFxuICAgIF0sXG4gIF07XG4gIGZvciAoY29uc3QgciBvZiBfZm9yZWNhc3RSb3dzKSB7XG4gICAgYW9hLnB1c2goW1xuICAgICAgci5za3UsXG4gICAgICByLmZhbWlsaWEsXG4gICAgICByLnN1YmZhbWlsaWEsXG4gICAgICByb3VuZDEoci52ZW50YXMxMm0pLFxuICAgICAgcm91bmQxKHIucGVkaWRvNm0pLFxuICAgICAgcm91bmQxKHIucHJvbWVkaW8pLFxuICAgICAgcm91bmQxKHIucG9saXRpY2EpLFxuICAgICAgcm91bmQxKHIudG90YWwpLFxuICAgIF0pO1xuICB9XG4gIGNvbnN0IHdzID0gWExTWC51dGlscy5hb2FfdG9fc2hlZXQoYW9hKTtcbiAgLy8gQW5jaG9zIGRlIGNvbHVtbmFcbiAgd3NbJyFjb2xzJ10gPSBbXG4gICAgeyB3Y2g6IDE4IH0sXG4gICAgeyB3Y2g6IDI0IH0sXG4gICAgeyB3Y2g6IDI0IH0sXG4gICAgeyB3Y2g6IDE0IH0sXG4gICAgeyB3Y2g6IDIwIH0sXG4gICAgeyB3Y2g6IDIwIH0sXG4gICAgeyB3Y2g6IDIyIH0sXG4gICAgeyB3Y2g6IDEyIH0sXG4gIF07XG4gIGNvbnN0IHdiID0gWExTWC51dGlscy5ib29rX25ldygpO1xuICBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KHdiLCB3cywgJ0ZPUkVDQVNUJyk7XG4gIGNvbnN0IGhveSA9IG5ldyBEYXRlKCk7XG4gIGNvbnN0IHN0YW1wID1cbiAgICBob3kuZ2V0RnVsbFllYXIoKSArXG4gICAgJy0nICtcbiAgICBTdHJpbmcoaG95LmdldE1vbnRoKCkgKyAxKS5wYWRTdGFydCgyLCAnMCcpICtcbiAgICAnLScgK1xuICAgIFN0cmluZyhob3kuZ2V0RGF0ZSgpKS5wYWRTdGFydCgyLCAnMCcpO1xuICBYTFNYLndyaXRlRmlsZSh3YiwgJ0ZvcmVjYXN0X1NoaW1hbm9fJyArIHN0YW1wICsgJy54bHN4Jyk7XG59O1xuXG4vLyBSZWZyZXNoIHB1YmxpY28gKHBvciBzaSBlbCB1c2VyIG5lY2VzaXRhIHJlLWZldGNoZWFyIGVsIHNuYXBzaG90IHNpbiBjZXJyYXJcbi8vIGVsIG1vZGFsLCBlajogcGFzYXJvbiAzMCBtaW4geSBlbCBjcm9uIEJRIGFjdHVhbGl6byBsYSBjb2xlY2Npb24pLlxud2luZG93LnJlbG9hZEZvcmVjYXN0U25hcHNob3QgPSBhc3luYyBmdW5jdGlvbiAoKSB7XG4gIF9mb3JlY2FzdFNuYXBzaG90ID0gbnVsbDtcbiAgYXdhaXQgX2xvYWRTbmFwc2hvdCgpO1xuICBpZiAoX2ZvcmVjYXN0U2FsZXNQbGFuKSB7XG4gICAgY29uc3QgaG95ID0gbmV3IERhdGUoKTtcbiAgICBfZm9yZWNhc3RSb3dzID0gX2NvbXB1dGVGb3JlY2FzdFJvd3MoX2ZvcmVjYXN0U25hcHNob3QsIF9mb3JlY2FzdFNhbGVzUGxhbiwgaG95KTtcbiAgICBfcmVuZGVyVGFibGUoX2ZvcmVjYXN0Um93cyk7XG4gIH1cbn07XG4iXSwKICAibWFwcGluZ3MiOiAiOzs7QUFZQSxNQUFNLGdCQUFnQjtBQUFBLElBQ3BCLEtBQUs7QUFBQSxJQUFHLFNBQVM7QUFBQSxJQUFHLEtBQUs7QUFBQSxJQUFHLE9BQU87QUFBQSxJQUNuQyxLQUFLO0FBQUEsSUFBRyxVQUFVO0FBQUEsSUFBRyxTQUFTO0FBQUEsSUFDOUIsS0FBSztBQUFBLElBQUcsT0FBTztBQUFBLElBQUcsT0FBTztBQUFBLElBQ3pCLEtBQUs7QUFBQSxJQUFHLE9BQU87QUFBQSxJQUFHLEtBQUs7QUFBQSxJQUFHLE9BQU87QUFBQSxJQUNqQyxLQUFLO0FBQUEsSUFBRyxNQUFNO0FBQUEsSUFDZCxLQUFLO0FBQUEsSUFBRyxNQUFNO0FBQUEsSUFBRyxPQUFPO0FBQUEsSUFDeEIsS0FBSztBQUFBLElBQUcsTUFBTTtBQUFBLElBQUcsT0FBTztBQUFBLElBQ3hCLEtBQUs7QUFBQSxJQUFHLFFBQVE7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
