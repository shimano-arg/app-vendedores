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
    m = s.match(/^([a-záéíóú]{3,10})[\s\-/._]*(\d{2,4})$/);
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
      if (mon >= 1 && mon <= 12)
        return String(y).padStart(4, "0") + "-" + String(mon).padStart(2, "0");
    }
    m = s.match(/^(\d{1,2})[-/](\d{4})$/);
    if (m) {
      const mon = parseInt(m[1], 10);
      const y = parseInt(m[2], 10);
      if (mon >= 1 && mon <= 12)
        return String(y).padStart(4, "0") + "-" + String(mon).padStart(2, "0");
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
      const err = new Error(
        'No se detectaron columnas de meses en el header (ej: "Jan 2027", "May 2027")'
      );
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
      if (upper === "TOTAL" || upper === "SUM" || upper === "SUBTOTAL" || upper === "TOTALES")
        continue;
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
    window.SalesPlanParser = {
      parseSalesPlanSheet,
      normalizeMonthLabel,
      findHeaderRow,
      detectColumns
    };
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
    await Promise.all(
      SALES_PLAN_FAMILIAS.map(async (f) => {
        try {
          const doc = await window.fbDb.collection("sales_plan_cache").doc(f.key).get();
          _salesPlanCaches[f.key] = doc.exists ? doc.data() : null;
        } catch (e) {
          console.warn("[FORECAST] load sales_plan_cache/" + f.key + " fail:", e && e.message);
          _salesPlanCaches[f.key] = null;
        }
      })
    );
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
      const sarName = wb.SheetNames.find(
        (n) => String(n || "").trim().toUpperCase() === "SAR"
      );
      if (!sarName) {
        setStatus(
          '\u26A0 El Excel no tiene hoja "SAR". Hojas encontradas: ' + wb.SheetNames.join(", "),
          "#dc2626"
        );
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
      setStatus(
        "\u2713 OK. " + parsed.rows.length + " SKUs \xD7 " + parsed.detectedMonths.length + " meses.",
        "#16a34a"
      );
      _renderSalesPlansTab();
    } catch (e) {
      console.error("[FORECAST] upload sales plan " + familia + " fail:", e);
      setStatus("\u2717 Error: " + (e && e.message || e), "#dc2626");
      if (e && e.code === "MONTHS_NOT_FOUND") {
        alert(
          'El Excel no tiene columnas de meses reconocibles.\n\nHeaders esperados: "Jan 2027", "May 2027", "Ene 2027", "2027-01", etc.\n\nDetalle: ' + e.message
        );
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL3B1cmUvc2FsZXMtcGxhbi1wYXJzZXIuanMiLCAiLi4vc3JjL2RvbWFpbnMvZm9yZWNhc3QuanMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbIi8vIEB0cy1ub2NoZWNrXG4vLyBQdXJlOiBwYXJzZWEgdW4gc2hlZXQgU2FsZXMgUGxhbiAoZm9ybWF0byBTVVIvU0FSIGRlIFNoaW1hbm8pIGEgZXN0cnVjdHVyYVxuLy8gbm9ybWFsaXphZGEgeyBza3UsIGRlc2NyaXB0aW9uLCBtb3EsIG1vbnRoczogeydZWVlZLU1NJzogTn0gfS5cbi8vIFNpbiBkZXBlbmRlbmNpYXMgXHUyMDE0IHJlY2liZSBlbCBzaGVldCB5YSBkZXNlcmlhbGl6YWRvIHBvciBTaGVldEpTXG4vLyAoWExTWC51dGlscy5zaGVldF90b19qc29uKHNoZWV0LCB7aGVhZGVyOjEsIGRlZnZhbDonJ30pKS5cbi8vIFRlc3RlYWJsZSBlbiB2aXRlc3Qgc2luIGNhcmdhciBYTFNYLlxuLy9cbi8vIENvbnRleHRvOiBsb3MgU2FsZXMgUGxhbnMgZGUgU2hpbWFubyB2aWVuZW4gY29uIGhlYWRlcnMgY29tb1xuLy8gXCJTS1UgQ29kZS9QYXJ0IE5vXCIsIFwiRGVzY3JpcHRpb25cIiwgXCJNT1EgMTIgbW9udGhzXCIgeSBjb2x1bW5hcyBkZSBtZXNlc1xuLy8gdGlwbyBcIkphbiAyMDI3XCIsIFwiTWF5IDIwMjdcIiAoYSB2ZWNlcyBjb24gYVx1MDBGMW8gZW4gdW5hIGZpbGEgYXJyaWJhIHkgZWwgbWVzXG4vLyBlbiBsYSBmaWxhIGhlYWRlcikuIEVzdGEgZm4gdG9sZXJhIGFtYm9zIGxheW91dHMuXG5cbmNvbnN0IE1PTlRIX0FMSUFTRVMgPSB7XG4gIGphbjogMSxcbiAgamFudWFyeTogMSxcbiAgZW5lOiAxLFxuICBlbmVybzogMSxcbiAgZmViOiAyLFxuICBmZWJydWFyeTogMixcbiAgZmVicmVybzogMixcbiAgbWFyOiAzLFxuICBtYXJjaDogMyxcbiAgbWFyem86IDMsXG4gIGFwcjogNCxcbiAgYXByaWw6IDQsXG4gIGFicjogNCxcbiAgYWJyaWw6IDQsXG4gIG1heTogNSxcbiAgbWF5bzogNSxcbiAganVuOiA2LFxuICBqdW5lOiA2LFxuICBqdW5pbzogNixcbiAganVsOiA3LFxuICBqdWx5OiA3LFxuICBqdWxpbzogNyxcbiAgYXVnOiA4LFxuICBhdWd1c3Q6IDgsXG4gIGFnbzogOCxcbiAgYWdvc3RvOiA4LFxuICBzZXA6IDksXG4gIHNlcHQ6IDksXG4gIHNlcHRlbWJlcjogOSxcbiAgc2VwdGllbWJyZTogOSxcbiAgb2N0OiAxMCxcbiAgb2N0b2JlcjogMTAsXG4gIG9jdHVicmU6IDEwLFxuICBub3Y6IDExLFxuICBub3ZlbWJlcjogMTEsXG4gIG5vdmllbWJyZTogMTEsXG4gIGRlYzogMTIsXG4gIGRlY2VtYmVyOiAxMixcbiAgZGljOiAxMixcbiAgZGljaWVtYnJlOiAxMixcbn07XG5cbi8vIE5vcm1hbGl6YSBsYWJlbHMgZGUgbWVzZXMgYSAnWVlZWS1NTScuIFJldG9ybmEgbnVsbCBzaSBubyBtYXRjaGVhLlxuLy8gRm9ybWF0b3Mgc29wb3J0YWRvczogXCJKYW4gMjAyN1wiLCBcIkVuZS0yN1wiLCBcIkphbi8yMDI3XCIsIFwiTWF5MjdcIixcbi8vIFwiMjAyNy0wMVwiLCBcIjAxLzIwMjdcIiwgXCJKYW4uMjAyN1wiLlxuZnVuY3Rpb24gbm9ybWFsaXplTW9udGhMYWJlbChsYWJlbCkge1xuICBpZiAobGFiZWwgPT0gbnVsbCkgcmV0dXJuIG51bGw7XG4gIGNvbnN0IHMgPSBTdHJpbmcobGFiZWwpLnRyaW0oKS50b0xvd2VyQ2FzZSgpO1xuICBpZiAoIXMpIHJldHVybiBudWxsO1xuICBsZXQgbTtcbiAgLy8gXCJqYW4gMjAyN1wiIHwgXCJqYW4tMjdcIiB8IFwiZW5lLzIwMjdcIiB8IFwibWF5MjdcIiB8IFwibWF5LjIwMjdcIlxuICBtID0gcy5tYXRjaCgvXihbYS16XHUwMEUxXHUwMEU5XHUwMEVEXHUwMEYzXHUwMEZBXXszLDEwfSlbXFxzXFwtLy5fXSooXFxkezIsNH0pJC8pO1xuICBpZiAobSkge1xuICAgIGNvbnN0IG1vbiA9IE1PTlRIX0FMSUFTRVNbbVsxXV0gfHwgTU9OVEhfQUxJQVNFU1ttWzFdLnNsaWNlKDAsIDMpXTtcbiAgICBpZiAobW9uKSB7XG4gICAgICBsZXQgeSA9IHBhcnNlSW50KG1bMl0sIDEwKTtcbiAgICAgIGlmICh5IDwgMTAwKSB5ID0gMjAwMCArIHk7XG4gICAgICByZXR1cm4gU3RyaW5nKHkpLnBhZFN0YXJ0KDQsICcwJykgKyAnLScgKyBTdHJpbmcobW9uKS5wYWRTdGFydCgyLCAnMCcpO1xuICAgIH1cbiAgfVxuICAvLyBcIjIwMjctMDFcIiB8IFwiMjAyNy8wMVwiXG4gIG0gPSBzLm1hdGNoKC9eKFxcZHs0fSlbLS9dKFxcZHsxLDJ9KSQvKTtcbiAgaWYgKG0pIHtcbiAgICBjb25zdCB5ID0gcGFyc2VJbnQobVsxXSwgMTApO1xuICAgIGNvbnN0IG1vbiA9IHBhcnNlSW50KG1bMl0sIDEwKTtcbiAgICBpZiAobW9uID49IDEgJiYgbW9uIDw9IDEyKVxuICAgICAgcmV0dXJuIFN0cmluZyh5KS5wYWRTdGFydCg0LCAnMCcpICsgJy0nICsgU3RyaW5nKG1vbikucGFkU3RhcnQoMiwgJzAnKTtcbiAgfVxuICAvLyBcIjAxLzIwMjdcIiB8IFwiMDEtMjAyN1wiXG4gIG0gPSBzLm1hdGNoKC9eKFxcZHsxLDJ9KVstL10oXFxkezR9KSQvKTtcbiAgaWYgKG0pIHtcbiAgICBjb25zdCBtb24gPSBwYXJzZUludChtWzFdLCAxMCk7XG4gICAgY29uc3QgeSA9IHBhcnNlSW50KG1bMl0sIDEwKTtcbiAgICBpZiAobW9uID49IDEgJiYgbW9uIDw9IDEyKVxuICAgICAgcmV0dXJuIFN0cmluZyh5KS5wYWRTdGFydCg0LCAnMCcpICsgJy0nICsgU3RyaW5nKG1vbikucGFkU3RhcnQoMiwgJzAnKTtcbiAgfVxuICByZXR1cm4gbnVsbDtcbn1cblxuLy8gQnVzY2EgbGEgZmlsYSBoZWFkZXIgKDAtYmFzZWQpLiBFc2NhbmVhIGxhcyBwcmltZXJhcyAzMCBmaWxhcy5cbmZ1bmN0aW9uIGZpbmRIZWFkZXJSb3cocm93cykge1xuICBjb25zdCBIRUFERVJfTUFSS0VSUyA9IFtcbiAgICAnc2t1IGNvZGUvcGFydCBubycsXG4gICAgJ3NrdSBjb2RlJyxcbiAgICAnc2t1JyxcbiAgICAncGFydCBubycsXG4gICAgJ3BhcnQgbnVtYmVyJyxcbiAgICAnaXRlbWNvZGUnLFxuICAgICdpdGVtIGNvZGUnLFxuICAgICdjb2RpZ28nLFxuICAgICdjXHUwMEYzZGlnbycsXG4gIF07XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgTWF0aC5taW4ocm93cy5sZW5ndGgsIDMwKTsgaSsrKSB7XG4gICAgY29uc3Qgcm93ID0gcm93c1tpXSB8fCBbXTtcbiAgICBmb3IgKGNvbnN0IGNlbGwgb2Ygcm93KSB7XG4gICAgICBjb25zdCBzID0gU3RyaW5nKGNlbGwgPT0gbnVsbCA/ICcnIDogY2VsbClcbiAgICAgICAgLnRyaW0oKVxuICAgICAgICAudG9Mb3dlckNhc2UoKTtcbiAgICAgIGlmIChIRUFERVJfTUFSS0VSUy5pbmRleE9mKHMpID49IDApIHJldHVybiBpO1xuICAgIH1cbiAgfVxuICByZXR1cm4gLTE7XG59XG5cbi8vIERldGVjdGEgXHUwMEVEbmRpY2VzIGRlIGNvbHVtbmFzIHkgbWVzZXMuIGBoaW50Um93QWJvdmVgIHBlcm1pdGUgY29tYmluYXIgYVx1MDBGMW8vbWVzXG4vLyBjdWFuZG8gZWwgaGVhZGVyIGVzIG11bHRpLXJvdyAoYVx1MDBGMW8gYXJyaWJhLCBtZXMgYWJham8gbyB2aWNldmVyc2EpLlxuZnVuY3Rpb24gZGV0ZWN0Q29sdW1ucyhoZWFkZXJSb3csIGhpbnRSb3dBYm92ZSkge1xuICBsZXQgc2t1SWR4ID0gLTE7XG4gIGxldCBkZXNjSWR4ID0gLTE7XG4gIGxldCBtb3FJZHggPSAtMTtcbiAgY29uc3QgbW9udGhDb2x1bW5zID0gW107XG4gIGNvbnN0IGRldGVjdGVkTW9udGhzU2V0ID0gbmV3IFNldCgpO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IGhlYWRlclJvdy5sZW5ndGg7IGkrKykge1xuICAgIGNvbnN0IHJhdyA9IFN0cmluZyhoZWFkZXJSb3dbaV0gPT0gbnVsbCA/ICcnIDogaGVhZGVyUm93W2ldKS50cmltKCk7XG4gICAgY29uc3QgcyA9IHJhdy50b0xvd2VyQ2FzZSgpO1xuICAgIGlmIChcbiAgICAgIHNrdUlkeCA8IDAgJiZcbiAgICAgIChzID09PSAnc2t1IGNvZGUvcGFydCBubycgfHxcbiAgICAgICAgcyA9PT0gJ3NrdSBjb2RlJyB8fFxuICAgICAgICBzID09PSAnc2t1JyB8fFxuICAgICAgICBzID09PSAncGFydCBubycgfHxcbiAgICAgICAgcyA9PT0gJ3BhcnQgbnVtYmVyJyB8fFxuICAgICAgICBzID09PSAnaXRlbWNvZGUnIHx8XG4gICAgICAgIHMgPT09ICdpdGVtIGNvZGUnIHx8XG4gICAgICAgIHMgPT09ICdjb2RpZ28nIHx8XG4gICAgICAgIHMgPT09ICdjXHUwMEYzZGlnbycpXG4gICAgKSB7XG4gICAgICBza3VJZHggPSBpO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChcbiAgICAgIGRlc2NJZHggPCAwICYmXG4gICAgICAocyA9PT0gJ2Rlc2NyaXB0aW9uJyB8fFxuICAgICAgICBzID09PSAnZGVzY3JpcGNpb24nIHx8XG4gICAgICAgIHMgPT09ICdkZXNjcmlwY2lcdTAwRjNuJyB8fFxuICAgICAgICBzID09PSAnaXRlbSBuYW1lJyB8fFxuICAgICAgICBzID09PSAnaXRlbW5hbWUnKVxuICAgICkge1xuICAgICAgZGVzY0lkeCA9IGk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKG1vcUlkeCA8IDAgJiYgKHMgPT09ICdtb3EgMTIgbW9udGhzJyB8fCBzID09PSAnbW9xJyB8fCBzLmluZGV4T2YoJ21vcScpID09PSAwKSkge1xuICAgICAgbW9xSWR4ID0gaTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICAvLyBUcnkgZGlyZWN0IG1vbnRoIHBhcnNlXG4gICAgbGV0IG1vbnRoS2V5ID0gbm9ybWFsaXplTW9udGhMYWJlbChyYXcpO1xuICAgIGlmICghbW9udGhLZXkgJiYgaGludFJvd0Fib3ZlICYmIGhpbnRSb3dBYm92ZVtpXSAhPSBudWxsKSB7XG4gICAgICBjb25zdCBoaW50ID0gU3RyaW5nKGhpbnRSb3dBYm92ZVtpXSkudHJpbSgpO1xuICAgICAgaWYgKGhpbnQpIHtcbiAgICAgICAgbW9udGhLZXkgPSBub3JtYWxpemVNb250aExhYmVsKHJhdyArICcgJyArIGhpbnQpIHx8IG5vcm1hbGl6ZU1vbnRoTGFiZWwoaGludCArICcgJyArIHJhdyk7XG4gICAgICB9XG4gICAgfVxuICAgIGlmIChtb250aEtleSkge1xuICAgICAgbW9udGhDb2x1bW5zLnB1c2goeyBjb2xJZHg6IGksIG1vbnRoS2V5IH0pO1xuICAgICAgZGV0ZWN0ZWRNb250aHNTZXQuYWRkKG1vbnRoS2V5KTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHtcbiAgICBza3VJZHgsXG4gICAgZGVzY0lkeCxcbiAgICBtb3FJZHgsXG4gICAgbW9udGhDb2x1bW5zLFxuICAgIGRldGVjdGVkTW9udGhzOiBBcnJheS5mcm9tKGRldGVjdGVkTW9udGhzU2V0KS5zb3J0KCksXG4gIH07XG59XG5cbi8vIFB1YmxpYzogcGFyc2UgZnVsbCBzaGVldC4gVGhyb3dzIG9uIG1pc3NpbmcgU0tVIGNvbHVtbiAvIG1vbnRocy5cbmZ1bmN0aW9uIHBhcnNlU2FsZXNQbGFuU2hlZXQocm93cykge1xuICBpZiAoIXJvd3MgfHwgIXJvd3MubGVuZ3RoKSB7XG4gICAgY29uc3QgZXJyID0gbmV3IEVycm9yKCdFeGNlbCB2YWNpbycpO1xuICAgIGVyci5jb2RlID0gJ0VNUFRZX1NIRUVUJztcbiAgICB0aHJvdyBlcnI7XG4gIH1cbiAgY29uc3QgaGVhZGVySWR4ID0gZmluZEhlYWRlclJvdyhyb3dzKTtcbiAgaWYgKGhlYWRlcklkeCA8IDApIHtcbiAgICBjb25zdCBlcnIgPSBuZXcgRXJyb3IoJ05vIHNlIGVuY29udHJvIGZpbGEgZGUgaGVhZGVycyAoYnVzY2FiYSBcIlNLVSBDb2RlL1BhcnQgTm9cIiBvIFwiU0tVXCIpJyk7XG4gICAgZXJyLmNvZGUgPSAnSEVBREVSX05PVF9GT1VORCc7XG4gICAgdGhyb3cgZXJyO1xuICB9XG4gIGNvbnN0IGhlYWRlclJvdyA9IHJvd3NbaGVhZGVySWR4XSB8fCBbXTtcbiAgY29uc3Qgcm93QWJvdmUgPSBoZWFkZXJJZHggPiAwID8gcm93c1toZWFkZXJJZHggLSAxXSB8fCBbXSA6IG51bGw7XG4gIGNvbnN0IGNvbHMgPSBkZXRlY3RDb2x1bW5zKGhlYWRlclJvdywgcm93QWJvdmUpO1xuICBpZiAoY29scy5za3VJZHggPCAwKSB7XG4gICAgY29uc3QgZXJyID0gbmV3IEVycm9yKCdObyBzZSBlbmNvbnRybyBjb2x1bW5hIFNLVSBlbiBsYSBmaWxhIGhlYWRlcicpO1xuICAgIGVyci5jb2RlID0gJ1NLVV9DT0xfTUlTU0lORyc7XG4gICAgdGhyb3cgZXJyO1xuICB9XG4gIGlmICghY29scy5tb250aENvbHVtbnMubGVuZ3RoKSB7XG4gICAgY29uc3QgZXJyID0gbmV3IEVycm9yKFxuICAgICAgJ05vIHNlIGRldGVjdGFyb24gY29sdW1uYXMgZGUgbWVzZXMgZW4gZWwgaGVhZGVyIChlajogXCJKYW4gMjAyN1wiLCBcIk1heSAyMDI3XCIpJ1xuICAgICk7XG4gICAgZXJyLmNvZGUgPSAnTU9OVEhTX05PVF9GT1VORCc7XG4gICAgdGhyb3cgZXJyO1xuICB9XG4gIGNvbnN0IHBhcnNlZFJvd3MgPSBbXTtcbiAgY29uc3Qgc2VlblNrdSA9IG5ldyBTZXQoKTtcbiAgZm9yIChsZXQgciA9IGhlYWRlcklkeCArIDE7IHIgPCByb3dzLmxlbmd0aDsgcisrKSB7XG4gICAgY29uc3Qgcm93ID0gcm93c1tyXSB8fCBbXTtcbiAgICBjb25zdCBza3VSYXcgPSByb3dbY29scy5za3VJZHhdO1xuICAgIGlmIChza3VSYXcgPT0gbnVsbCB8fCBTdHJpbmcoc2t1UmF3KS50cmltKCkgPT09ICcnKSBjb250aW51ZTtcbiAgICBjb25zdCBza3UgPSBTdHJpbmcoc2t1UmF3KS50cmltKCk7XG4gICAgY29uc3QgdXBwZXIgPSBza3UudG9VcHBlckNhc2UoKTtcbiAgICAvLyBTa2lwIGZpbGFzIFRPVEFMIC8gU1VNIC8gU1VCVE9UQUxcbiAgICBpZiAodXBwZXIgPT09ICdUT1RBTCcgfHwgdXBwZXIgPT09ICdTVU0nIHx8IHVwcGVyID09PSAnU1VCVE9UQUwnIHx8IHVwcGVyID09PSAnVE9UQUxFUycpXG4gICAgICBjb250aW51ZTtcbiAgICBpZiAoc2VlblNrdS5oYXModXBwZXIpKSBjb250aW51ZTsgLy8gZGVkdXBlXG4gICAgc2VlblNrdS5hZGQodXBwZXIpO1xuICAgIGNvbnN0IGRlc2NyaXB0aW9uID1cbiAgICAgIGNvbHMuZGVzY0lkeCA+PSAwID8gU3RyaW5nKHJvd1tjb2xzLmRlc2NJZHhdID09IG51bGwgPyAnJyA6IHJvd1tjb2xzLmRlc2NJZHhdKS50cmltKCkgOiAnJztcbiAgICBjb25zdCBtb3FSYXcgPSBjb2xzLm1vcUlkeCA+PSAwID8gcm93W2NvbHMubW9xSWR4XSA6IG51bGw7XG4gICAgY29uc3QgbW9xTnVtID0gTnVtYmVyKG1vcVJhdyk7XG4gICAgY29uc3QgbW9xID0gTnVtYmVyLmlzRmluaXRlKG1vcU51bSkgJiYgbW9xTnVtID4gMCA/IE1hdGgucm91bmQobW9xTnVtKSA6IDA7XG4gICAgY29uc3QgbW9udGhzID0ge307XG4gICAgZm9yIChjb25zdCBtYyBvZiBjb2xzLm1vbnRoQ29sdW1ucykge1xuICAgICAgY29uc3QgdiA9IHJvd1ttYy5jb2xJZHhdO1xuICAgICAgY29uc3QgbiA9IE51bWJlcih2KTtcbiAgICAgIGlmIChOdW1iZXIuaXNGaW5pdGUobikgJiYgbiA+IDApIHtcbiAgICAgICAgbW9udGhzW21jLm1vbnRoS2V5XSA9IE1hdGgucm91bmQobik7XG4gICAgICB9XG4gICAgfVxuICAgIHBhcnNlZFJvd3MucHVzaCh7IHNrdSwgZGVzY3JpcHRpb24sIG1vcSwgbW9udGhzIH0pO1xuICB9XG4gIHJldHVybiB7XG4gICAgaGVhZGVyUm93SW5kZXg6IGhlYWRlcklkeCxcbiAgICBkZXRlY3RlZE1vbnRoczogY29scy5kZXRlY3RlZE1vbnRocyxcbiAgICByb3dzQ291bnQ6IHBhcnNlZFJvd3MubGVuZ3RoLFxuICAgIHJvd3M6IHBhcnNlZFJvd3MsXG4gIH07XG59XG5cbi8vIFVNRC1pc2ggZXhwb3J0OiBwYXJhIHZpdGVzdCAobW9kdWxlLmV4cG9ydHMpIHkgcGFyYSBidW5kbGUgYnJvd3NlciAod2luZG93IGdsb2JhbCkuXG5pZiAodHlwZW9mIG1vZHVsZSAhPT0gJ3VuZGVmaW5lZCcgJiYgbW9kdWxlLmV4cG9ydHMpIHtcbiAgbW9kdWxlLmV4cG9ydHMgPSB7IHBhcnNlU2FsZXNQbGFuU2hlZXQsIG5vcm1hbGl6ZU1vbnRoTGFiZWwsIGZpbmRIZWFkZXJSb3csIGRldGVjdENvbHVtbnMgfTtcbn1cbmlmICh0eXBlb2Ygd2luZG93ICE9PSAndW5kZWZpbmVkJykge1xuICB3aW5kb3cuU2FsZXNQbGFuUGFyc2VyID0ge1xuICAgIHBhcnNlU2FsZXNQbGFuU2hlZXQsXG4gICAgbm9ybWFsaXplTW9udGhMYWJlbCxcbiAgICBmaW5kSGVhZGVyUm93LFxuICAgIGRldGVjdENvbHVtbnMsXG4gIH07XG59XG5cbmV4cG9ydCB7IGRldGVjdENvbHVtbnMsIGZpbmRIZWFkZXJSb3csIG5vcm1hbGl6ZU1vbnRoTGFiZWwsIHBhcnNlU2FsZXNQbGFuU2hlZXQgfTtcbiIsICIvLyBAdHMtbm9jaGVja1xuLy8gdjEwOTgrIEZhc2UgMTogaW1wb3J0IGRlbCBwYXJzZXIgcHVyby4gRWwgbVx1MDBGM2R1bG8gaGFjZSBgd2luZG93LlNhbGVzUGxhblBhcnNlcmBcbi8vIGNvbW8gc2lkZS1lZmZlY3QgeSB0YW1iaVx1MDBFOW4gZXhwb3J0YSBsYXMgZm5zIG5vbWJyYWRhczsgdXNhbW9zIHNpZGUtZWZmZWN0XG4vLyBwb3JxdWUgZm9yZWNhc3QuanMgY29ycmUgZW4gZWwgY2h1bmsgbGF6eSB5IHdpbmRvdyB5YSBlc3RcdTAwRTEgZGlzcG9uaWJsZS5cbmltcG9ydCAnLi4vcHVyZS9zYWxlcy1wbGFuLXBhcnNlci5qcyc7XG5cbi8vIEdsb2JhbHMgbGVpZG9zIGRlbCBlbnRvcm5vIChkZWNsYXJhZG9zIGVuIGluZGV4Lmh0bWwgaW5saW5lIG8gYnVuZGxlIHByZXZpbyk6XG4vLyBmYkRiLCBjdXJyZW50VXNlciwgWExTWCAoY2RuKSwgZXNjYXBlSHRtbC4gTWlzbW8gcGF0cm9uIHF1ZSBvdHJvcyBkb21pbmlvcy5cbi8vXG4vLyBGT1JFQ0FTVCAtIG1vZGFsIGFkbWluLW9ubHkgKE1hcmlhbm8pIHF1ZSBjb21wYXJhIHZlbnRhcyBoaXN0b3JpY2FzXG4vLyAoRmlyZXN0b3JlIHNrdV92ZW50YXNfc25hcHNob3QsIGFsaW1lbnRhZG8gcG9yIHN5bmMgQlEgdl92ZW50YXNfbGluZWFzXG4vLyB2ZW50YW5hIDEzbSkgdnMgU2FsZXMgUGxhbiBjYXJnYWRvIHBvciBlbCB1c2VyIHZpYSBFeGNlbCArIHBvbGl0aWNhIGRlXG4vLyBpbnZlbnRhcmlvIChwcm9tZWRpbyBZVEQgeCAzIG1lc2VzKS5cbi8vXG4vLyBDaHVuayBsYXp5OiBzZSBjYXJnYSBzb2xvIGFsIHByaW1lciBjbGljayBkZWwgYm90b24gRk9SRUNBU1QgZGVsIGhlYWRlci5cbi8vIFJlZ2lzdHJhZG8gZW4gYnVpbGQuanMgTEFaWV9DSFVOS1MgKyBzcmMvbWFpbi5qcyBpbnN0YWxsQ2h1bmtTdHVicyArIHN3LmpzXG4vLyBTVEFUSUNfQVNTRVRTLiBWZXIgQ0xBVURFLm1kICMxOCAoMyBsdWdhcmVzIHNpbmNyb25pemFkb3MpLlxuLy9cbi8vIENvbnRyYXRvIGRlbCBFeGNlbCBTYWxlcyBQbGFuIHF1ZSBzdWJlIGVsIHVzZXI6XG4vLyAgIENvbHVtbmFzOiBTS1UgfCBNZXMxIHwgTWVzMiB8IE1lczMgfCBNZXM0IHwgTWVzNSB8IE1lczZcbi8vICAgKG5vbWJyZXMgZXhhY3RvcyBkZSBoZWFkZXJzIGNhc2UtaW5zZW5zaXRpdmU7IE1lczEuLjYgc29uIGxvcyBwcm94aW1vc1xuLy8gICA2IG1lc2VzIGRlc2RlIGVsIG1lcyBhY3R1YWwpLiBVbmEgZmlsYSBwb3IgU0tVLlxuLy9cbi8vIEZ1ZW50ZSBkZSBkYXRvcyBoaXN0b3JpY2FzOlxuLy8gICBGaXJlc3RvcmUgL3NrdV92ZW50YXNfc25hcHNob3Qve1NLVV88c2t1X3NhbmVhZG8+fVxuLy8gICB7XG4vLyAgICAgc2t1LCBpdGVtTmFtZSwgZmFtaWxpYSwgc3ViZmFtaWxpYSxcbi8vICAgICBtZXNlczogeyAnMjAyNS0wOCc6IHtxdHksIGFyc30sIC4uLiwgJzIwMjYtMDgnOiB7cXR5LCBhcnN9IH1cbi8vICAgfVxuLy8gICBSdWxlczogcmVhZCBhZG1pbi1vbmx5IChjb21wZXRpdGl2ZWx5IHNlbnNpdGl2ZSkuIEVzY3JpdG8gcG9yIGNyb25cbi8vICAgc3luY19zYXBfdG9fYmlncXVlcnkucHkgY2FkYSAzMCBtaW4uXG5cbi8vIEVzdGFkbyBkZWwgbW9kYWwgKGludHJhLWNodW5rLCBubyBjcm9zcy1zY29wZSkuXG5sZXQgX2ZvcmVjYXN0U25hcHNob3QgPSBudWxsOyAvLyB7IFNLVToge2ZhbWlsaWEsIHN1YmZhbWlsaWEsIGl0ZW1OYW1lLCBtZXNlc30gfVxubGV0IF9mb3JlY2FzdFNhbGVzUGxhbiA9IG51bGw7IC8vIFt7IHNrdSwgcGVkaWRvVG90YWwsIG1lc2VzQXJyOiBbbjEuLm42XSB9XVxubGV0IF9mb3JlY2FzdFJvd3MgPSBudWxsOyAvLyBmaWxhcyBmaW5hbGVzIGNhbGN1bGFkYXMgcGFyYSBwcmV2aWV3ICsgZXhwb3J0XG5sZXQgX2ZvcmVjYXN0TG9hZGluZyA9IGZhbHNlO1xuXG4vLyB2MTA5OCsgKEZhc2UgMSBGb3JlY2FzdCB2Mik6IFNhbGVzIFBsYW5zIG1lbnN1YWxlcyBwb3IgZmFtaWxpYSAoUm9kcy9SZWVscy9GRykuXG4vLyBTZSBndWFyZGFuIGVuIEZpcmVzdG9yZSBgc2FsZXNfcGxhbl9jYWNoZS97ZmFtaWxpYX1gICsgc25hcHNob3QgRXhjZWwgb3JpZ2luYWxcbi8vIGVuIFN0b3JhZ2UgYGZvcmVjYXN0c19zbmFwc2hvdHMve1lZWVktTU19L3tmYW1pbGlhfS54bHN4YC5cbi8vIEVsIHBhcnNlciBwdXJvIHZpdmUgZW4gc3JjL3B1cmUvc2FsZXMtcGxhbi1wYXJzZXIuanMgKGF0dGFjaCBhIHdpbmRvdy5TYWxlc1BsYW5QYXJzZXIpLlxuY29uc3QgU0FMRVNfUExBTl9GQU1JTElBUyA9IFtcbiAgeyBrZXk6ICdyb2RzJywgbGFiZWw6ICdSb2RzIChDYVx1MDBGMWFzKScsIGNvbG9yOiAnIzBlYTVlOScgfSxcbiAgeyBrZXk6ICdyZWVscycsIGxhYmVsOiAnUmVlbHMnLCBjb2xvcjogJyM4YjVjZjYnIH0sXG4gIHsga2V5OiAnZmcnLCBsYWJlbDogJ0ZHIChyZXN0byknLCBjb2xvcjogJyNmNTllMGInIH0sXG5dO1xuY29uc3QgX3NhbGVzUGxhbkNhY2hlcyA9IHsgcm9kczogbnVsbCwgcmVlbHM6IG51bGwsIGZnOiBudWxsIH07IC8vIGxhc3QgbG9hZGVkIGRvY1xubGV0IF9mb3JlY2FzdEFjdGl2ZVRhYiA9ICdzYWxlcy1wbGFucyc7IC8vICdzYWxlcy1wbGFucycgfCAnbGVnYWN5J1xuXG4vLyBXaGl0ZWxpc3QgZGUgZW1haWxzIGNvbiBhY2Nlc28gYWwgbW9kYWwgRk9SRUNBU1QuIFJlcGxpY2EgZWwgcGF0cm9uIGRlXG4vLyBcIkFuYWxpc2lzXCIgKGluZGV4Lmh0bWw6MTI2MjUpLiBTb2xvIE1hcmlhbm87IHNpIG90cm8gYWRtaW4gbG8gbmVjZXNpdGFcbi8vIHNlIGFncmVnYSBhY2EgZXhwbGljaXRvLlxuY29uc3QgRk9SRUNBU1RfQUxMT1dFRF9FTUFJTFMgPSBbJ21hcmlhbm8uZXJiaW5vQHNoaW1hbm8uY29tLmFyJywgJ2VyYmlub21hcmlhbm9AZ21haWwuY29tJ107XG5cbmZ1bmN0aW9uIF9jYW5Gb3JlY2FzdCgpIHtcbiAgdHJ5IHtcbiAgICBjb25zdCBlbWFpbCA9ICgod2luZG93LmN1cnJlbnRVc2VyICYmIHdpbmRvdy5jdXJyZW50VXNlci5lbWFpbCkgfHwgJycpLnRvTG93ZXJDYXNlKCk7XG4gICAgaWYgKCFlbWFpbCkgcmV0dXJuIGZhbHNlO1xuICAgIHJldHVybiBGT1JFQ0FTVF9BTExPV0VEX0VNQUlMUy5pbmRleE9mKGVtYWlsKSA+PSAwO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbn1cblxuLy8gSGVscGVycyBkZSBtZXMgY2FsZW5kYXIuXG5mdW5jdGlvbiBfbW9udGhLZXkoeWVhciwgbW9udGhPbmVCYXNlZCkge1xuICByZXR1cm4gU3RyaW5nKHllYXIpLnBhZFN0YXJ0KDQsICcwJykgKyAnLScgKyBTdHJpbmcobW9udGhPbmVCYXNlZCkucGFkU3RhcnQoMiwgJzAnKTtcbn1cbmZ1bmN0aW9uIF9tb250aExhYmVsKGtleSkge1xuICAvLyAnMjAyNi0wOCcgLT4gJ2Fnby0yNidcbiAgY29uc3QgW3ksIG1dID0ga2V5LnNwbGl0KCctJykubWFwKE51bWJlcik7XG4gIGNvbnN0IG5hbWVzID0gW1xuICAgICdlbmUnLFxuICAgICdmZWInLFxuICAgICdtYXInLFxuICAgICdhYnInLFxuICAgICdtYXknLFxuICAgICdqdW4nLFxuICAgICdqdWwnLFxuICAgICdhZ28nLFxuICAgICdzZXAnLFxuICAgICdvY3QnLFxuICAgICdub3YnLFxuICAgICdkaWMnLFxuICBdO1xuICByZXR1cm4gbmFtZXNbbSAtIDFdICsgJy0nICsgU3RyaW5nKHkpLnNsaWNlKC0yKTtcbn1cbmZ1bmN0aW9uIF9hZGRNb250aHMoeWVhciwgbW9udGhPbmVCYXNlZCwgZGVsdGEpIHtcbiAgY29uc3QgdG90YWxNb250aHMgPSB5ZWFyICogMTIgKyAobW9udGhPbmVCYXNlZCAtIDEpICsgZGVsdGE7XG4gIGNvbnN0IHkgPSBNYXRoLmZsb29yKHRvdGFsTW9udGhzIC8gMTIpO1xuICBjb25zdCBtID0gKHRvdGFsTW9udGhzICUgMTIpICsgMTtcbiAgcmV0dXJuIHsgeSwgbSB9O1xufVxuXG4vLyBTdW1hIHF0eSBkZWwgU0tVIGVuIGxvcyB1bHRpbW9zIDEyIE1FU0VTIENPTVBMRVRPUyAoZXhjbHV5ZSBlbCBtZXMgYWN0dWFsXG4vLyBwYXJjaWFsIC0gbGEgdmVudGFuYSBtb3ZpbCBcIjEyIG1lc2VzIGNlcnJhZG9zXCIgcXVlIGVsIHVzZXIgcGllbnNhIGNvbW9cbi8vIFwiZWwgYVx1MDBGMW8gcXVlIHlhIHBhc29cIikuIEVqZW1wbG8gZW4gYWdvc3RvIDIwMjY6IHN1bWFyIGFnby0yNSBhIGp1bC0yNi5cbmZ1bmN0aW9uIF9zdW1WZW50YXMxMm1Db21wbGV0b3MobWVzZXNNYXAsIGhveSkge1xuICBpZiAoIW1lc2VzTWFwKSByZXR1cm4gMDtcbiAgbGV0IHN1bSA9IDA7XG4gIGNvbnN0IHN0YXJ0TW9udGggPSBfYWRkTW9udGhzKGhveS5nZXRGdWxsWWVhcigpLCBob3kuZ2V0TW9udGgoKSArIDEsIC0xMik7XG4gIGNvbnN0IGVuZE1vbnRoID0gX2FkZE1vbnRocyhob3kuZ2V0RnVsbFllYXIoKSwgaG95LmdldE1vbnRoKCkgKyAxLCAtMSk7XG4gIGNvbnN0IHN0YXJ0S2V5ID0gX21vbnRoS2V5KHN0YXJ0TW9udGgueSwgc3RhcnRNb250aC5tKTtcbiAgY29uc3QgZW5kS2V5ID0gX21vbnRoS2V5KGVuZE1vbnRoLnksIGVuZE1vbnRoLm0pO1xuICBmb3IgKGNvbnN0IGsgb2YgT2JqZWN0LmtleXMobWVzZXNNYXApKSB7XG4gICAgaWYgKGsgPj0gc3RhcnRLZXkgJiYgayA8PSBlbmRLZXkpIHtcbiAgICAgIHN1bSArPSBOdW1iZXIoKG1lc2VzTWFwW2tdICYmIG1lc2VzTWFwW2tdLnF0eSkgfHwgMCk7XG4gICAgfVxuICB9XG4gIHJldHVybiBzdW07XG59XG5cbi8vIFN1bWEgcXR5IGRlbCBTS1UgWVREIChlbmVybyBkZWwgYVx1MDBGMW8gYWN0dWFsIGhhc3RhIG1lcyBhY3R1YWwgSU5DTFVTSVZPLFxuLy8gYXVucXVlIGVsIG1lcyBhY3R1YWwgc2VhIHBhcmNpYWwpLiBSZXRvcm5hIHsgdG90YWxZdGQsIG1lc2VzVHJhbnNjdXJyaWRvcyB9LlxuLy8gRWplbXBsbyBhZ29zdG8gMjAyNiBjb24gdmVudGFzIGp1bD0xMCArIGFnbz0yMCAtPiB7MzAsIDh9LCBwcm9tZWRpbz0zMC84PTMuNzUuXG4vLyAoU2kgZWwgdXN1YXJpbyBlc3BlcmFiYSBkaXZpZGlyIHBvciAyIGVuIHZleiBkZSA4LCByZXZpc2FyIHNwZWMuIEVsIHBlZGlkb1xuLy8gZGljZSBcImNhbnRpZGFkIGRlIG1lc2VzIHF1ZSB0cmFuc2N1cnJpbW9zXCIgPSBtZXNlcyBkZWwgYVx1MDBGMW8gcGFzYWRvcyBoYXN0YSBob3kuKVxuZnVuY3Rpb24gX3N1bVZlbnRhc1lURChtZXNlc01hcCwgaG95KSB7XG4gIGNvbnN0IHllYXIgPSBob3kuZ2V0RnVsbFllYXIoKTtcbiAgY29uc3QgbWVzQWN0dWFsID0gaG95LmdldE1vbnRoKCkgKyAxO1xuICBsZXQgdG90YWwgPSAwO1xuICBpZiAobWVzZXNNYXApIHtcbiAgICBmb3IgKGxldCBtID0gMTsgbSA8PSBtZXNBY3R1YWw7IG0rKykge1xuICAgICAgY29uc3QgayA9IF9tb250aEtleSh5ZWFyLCBtKTtcbiAgICAgIHRvdGFsICs9IE51bWJlcigobWVzZXNNYXBba10gJiYgbWVzZXNNYXBba10ucXR5KSB8fCAwKTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHsgdG90YWxZdGQ6IHRvdGFsLCBtZXNlc1RyYW5zY3Vycmlkb3M6IG1lc0FjdHVhbCB9O1xufVxuXG4vLyBDYXJnYSBza3VfdmVudGFzX3NuYXBzaG90IGNvbXBsZXRvICh1bmEgdmV6IHBvciBzZXNpb24gZGVsIG1vZGFsKS5cbmFzeW5jIGZ1bmN0aW9uIF9sb2FkU25hcHNob3QoKSB7XG4gIGlmIChfZm9yZWNhc3RTbmFwc2hvdCkgcmV0dXJuIF9mb3JlY2FzdFNuYXBzaG90O1xuICBpZiAoIXdpbmRvdy5mYkRiKSB0aHJvdyBuZXcgRXJyb3IoJ0ZpcmVzdG9yZSBubyBpbmljaWFsaXphZG8nKTtcbiAgY29uc3Qgc25hcCA9IGF3YWl0IHdpbmRvdy5mYkRiLmNvbGxlY3Rpb24oJ3NrdV92ZW50YXNfc25hcHNob3QnKS5nZXQoKTtcbiAgY29uc3QgYnlPcmlnaW5hbFNrdSA9IHt9O1xuICBjb25zdCBieVVwcGVyU2t1ID0ge307XG4gIHNuYXAuZm9yRWFjaCgoZG9jKSA9PiB7XG4gICAgY29uc3QgZCA9IGRvYy5kYXRhKCk7XG4gICAgaWYgKCFkIHx8ICFkLnNrdSkgcmV0dXJuO1xuICAgIGNvbnN0IHNrdVVwcGVyID0gU3RyaW5nKGQuc2t1KS50cmltKCkudG9VcHBlckNhc2UoKTtcbiAgICBjb25zdCByZWNvcmQgPSB7XG4gICAgICBza3U6IGQuc2t1LFxuICAgICAgaXRlbU5hbWU6IGQuaXRlbU5hbWUgfHwgJycsXG4gICAgICBmYW1pbGlhOiBkLmZhbWlsaWEgfHwgJycsXG4gICAgICBzdWJmYW1pbGlhOiBkLnN1YmZhbWlsaWEgfHwgJycsXG4gICAgICBtZXNlczogZC5tZXNlcyB8fCB7fSxcbiAgICB9O1xuICAgIGJ5T3JpZ2luYWxTa3VbZC5za3VdID0gcmVjb3JkO1xuICAgIGJ5VXBwZXJTa3Vbc2t1VXBwZXJdID0gcmVjb3JkO1xuICB9KTtcbiAgX2ZvcmVjYXN0U25hcHNob3QgPSB7IGJ5T3JpZ2luYWxTa3UsIGJ5VXBwZXJTa3UsIGNvdW50OiBzbmFwLnNpemUgfTtcbiAgcmV0dXJuIF9mb3JlY2FzdFNuYXBzaG90O1xufVxuXG4vLyBQYXJzZWEgZWwgRXhjZWwgU2FsZXMgUGxhbi4gRXNwZXJhIGNvbHVtbmFzIFNLVSArIDYgY29sdW1uYXMgbnVtZXJpY2FzXG4vLyAobm9tYnJlcyBmbGV4aWJsZXM6IE1lczEuLk1lczYsIG1lc18xLi5tZXNfNiwgbyBjdWFscXVpZXIgaGVhZGVyIGN1c3RvbVxuLy8gbWllbnRyYXMgbGEgcHJpbWVyYSBzZWEgU0tVIHkgaGF5YSBhbCBtZW5vcyA2IGNvbHVtbmFzIG51bWVyaWNhcyBtYXMpLlxuZnVuY3Rpb24gX3BhcnNlU2FsZXNQbGFuUm93cyhyb3dzUmF3KSB7XG4gIGlmICghcm93c1JhdyB8fCAhcm93c1Jhdy5sZW5ndGgpIHJldHVybiBbXTtcbiAgY29uc3QgaGVhZGVyUm93ID0gcm93c1Jhd1swXTtcbiAgLy8gRGV0ZWN0YXIgaW5kaWNlIGRlIGNvbHVtbmEgU0tVXG4gIGxldCBza3VDb2xJZHggPSAtMTtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBoZWFkZXJSb3cubGVuZ3RoOyBpKyspIHtcbiAgICBjb25zdCBoID0gU3RyaW5nKGhlYWRlclJvd1tpXSB8fCAnJylcbiAgICAgIC50cmltKClcbiAgICAgIC50b1VwcGVyQ2FzZSgpO1xuICAgIGlmIChoID09PSAnU0tVJyB8fCBoID09PSAnSVRFTUNPREUnIHx8IGggPT09ICdJVEVNJyB8fCBoID09PSAnSVRFTSBDT0RFJyB8fCBoID09PSAnQ09ESUdPJykge1xuICAgICAgc2t1Q29sSWR4ID0gaTtcbiAgICAgIGJyZWFrO1xuICAgIH1cbiAgfVxuICBpZiAoc2t1Q29sSWR4IDwgMClcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ0VsIEV4Y2VsIGRlYmUgdGVuZXIgdW5hIGNvbHVtbmEgbGxhbWFkYSBcIlNLVVwiIChvIENvZGlnbyAvIEl0ZW1Db2RlIC8gSXRlbSknKTtcbiAgLy8gTGFzIDYgY29sdW1uYXMgZGUgbWVzZXM6IGxhcyBwcmltZXJhcyA2IGNvbHVtbmFzIHF1ZSBzZWFuICE9IHNrdUNvbElkeC5cbiAgY29uc3QgbW9udGhDb2xzID0gW107XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgaGVhZGVyUm93Lmxlbmd0aCAmJiBtb250aENvbHMubGVuZ3RoIDwgNjsgaSsrKSB7XG4gICAgaWYgKGkgIT09IHNrdUNvbElkeCkgbW9udGhDb2xzLnB1c2goaSk7XG4gIH1cbiAgaWYgKG1vbnRoQ29scy5sZW5ndGggPCA2KVxuICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICdFbCBFeGNlbCBkZWJlIHRlbmVyIGFsIG1lbm9zIDYgY29sdW1uYXMgZGUgbWVzZXMgYWRlbWFzIGRlIFNLVSAoZW5jb250cmFkYXM6ICcgK1xuICAgICAgICBtb250aENvbHMubGVuZ3RoICtcbiAgICAgICAgJyknXG4gICAgKTtcbiAgY29uc3Qgb3V0ID0gW107XG4gIGZvciAobGV0IHIgPSAxOyByIDwgcm93c1Jhdy5sZW5ndGg7IHIrKykge1xuICAgIGNvbnN0IHJvdyA9IHJvd3NSYXdbcl07XG4gICAgaWYgKCFyb3cgfHwgIXJvdy5sZW5ndGgpIGNvbnRpbnVlO1xuICAgIGNvbnN0IHNrdVJhdyA9IHJvd1tza3VDb2xJZHhdO1xuICAgIGlmIChza3VSYXcgPT09IHVuZGVmaW5lZCB8fCBza3VSYXcgPT09IG51bGwgfHwgU3RyaW5nKHNrdVJhdykudHJpbSgpID09PSAnJykgY29udGludWU7XG4gICAgY29uc3Qgc2t1ID0gU3RyaW5nKHNrdVJhdykudHJpbSgpO1xuICAgIGNvbnN0IG1lc2VzQXJyID0gbW9udGhDb2xzLm1hcCgoaSkgPT4ge1xuICAgICAgY29uc3QgdiA9IHJvd1tpXTtcbiAgICAgIGNvbnN0IG4gPSBOdW1iZXIodik7XG4gICAgICByZXR1cm4gTnVtYmVyLmlzRmluaXRlKG4pID8gbiA6IDA7XG4gICAgfSk7XG4gICAgY29uc3QgcGVkaWRvVG90YWwgPSBtZXNlc0Fyci5yZWR1Y2UoKGEsIGIpID0+IGEgKyBiLCAwKTtcbiAgICBvdXQucHVzaCh7IHNrdSwgbWVzZXNBcnIsIHBlZGlkb1RvdGFsIH0pO1xuICB9XG4gIHJldHVybiBvdXQ7XG59XG5cbi8vIENhbGN1bGEgbGFzIGZpbGFzIGZpbmFsZXMgY3J1emFuZG8gc25hcHNob3QgKyBzYWxlcyBwbGFuLlxuZnVuY3Rpb24gX2NvbXB1dGVGb3JlY2FzdFJvd3Moc25hcHNob3QsIHNhbGVzUGxhbiwgaG95KSB7XG4gIGNvbnN0IHJvd3MgPSBbXTtcbiAgZm9yIChjb25zdCBzcCBvZiBzYWxlc1BsYW4pIHtcbiAgICBjb25zdCBza3VVcHBlciA9IHNwLnNrdS50b1VwcGVyQ2FzZSgpO1xuICAgIGNvbnN0IGhpc3QgPSBzbmFwc2hvdC5ieVVwcGVyU2t1W3NrdVVwcGVyXSB8fCBudWxsO1xuICAgIGNvbnN0IHZlbnRhczEybSA9IGhpc3QgPyBfc3VtVmVudGFzMTJtQ29tcGxldG9zKGhpc3QubWVzZXMsIGhveSkgOiAwO1xuICAgIGNvbnN0IHl0ZCA9IGhpc3RcbiAgICAgID8gX3N1bVZlbnRhc1lURChoaXN0Lm1lc2VzLCBob3kpXG4gICAgICA6IHsgdG90YWxZdGQ6IDAsIG1lc2VzVHJhbnNjdXJyaWRvczogaG95LmdldE1vbnRoKCkgKyAxIH07XG4gICAgY29uc3QgcHJvbWVkaW8gPSB5dGQubWVzZXNUcmFuc2N1cnJpZG9zID4gMCA/IHl0ZC50b3RhbFl0ZCAvIHl0ZC5tZXNlc1RyYW5zY3Vycmlkb3MgOiAwO1xuICAgIGNvbnN0IHBvbGl0aWNhID0gcHJvbWVkaW8gKiAzO1xuICAgIGNvbnN0IHRvdGFsID0gc3AucGVkaWRvVG90YWwgLSBwb2xpdGljYTtcbiAgICByb3dzLnB1c2goe1xuICAgICAgc2t1OiBzcC5za3UsXG4gICAgICBpdGVtTmFtZTogaGlzdCA/IGhpc3QuaXRlbU5hbWUgOiAnJyxcbiAgICAgIGZhbWlsaWE6IGhpc3QgPyBoaXN0LmZhbWlsaWEgOiAnKHNpbiBtYXRjaCknLFxuICAgICAgc3ViZmFtaWxpYTogaGlzdCA/IGhpc3Quc3ViZmFtaWxpYSA6ICcoc2luIG1hdGNoKScsXG4gICAgICB2ZW50YXMxMm06IHZlbnRhczEybSxcbiAgICAgIHBlZGlkbzZtOiBzcC5wZWRpZG9Ub3RhbCxcbiAgICAgIHByb21lZGlvOiBwcm9tZWRpbyxcbiAgICAgIHBvbGl0aWNhOiBwb2xpdGljYSxcbiAgICAgIHRvdGFsOiB0b3RhbCxcbiAgICAgIGhhc0hpc3RvcmlhOiAhIWhpc3QsXG4gICAgfSk7XG4gIH1cbiAgcmV0dXJuIHJvd3M7XG59XG5cbmZ1bmN0aW9uIF9yZW5kZXJNb2RhbFNoZWxsKCkge1xuICBjb25zdCBleGlzdGluZyA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdmb3JlY2FzdC1tb2RhbCcpO1xuICBpZiAoZXhpc3RpbmcpIHJldHVybiBleGlzdGluZztcbiAgY29uc3QgZWwgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKTtcbiAgZWwuaWQgPSAnZm9yZWNhc3QtbW9kYWwnO1xuICBlbC5jbGFzc05hbWUgPSAnbW9kYWwtb3ZlcmxheSc7XG4gIGVsLnN0eWxlLmNzc1RleHQgPVxuICAgICdkaXNwbGF5Om5vbmU7cG9zaXRpb246Zml4ZWQ7aW5zZXQ6MDtiYWNrZ3JvdW5kOnJnYmEoMTUsMjMsNDIsLjYpO3otaW5kZXg6MjA1MDsnO1xuICBlbC5vbmNsaWNrID0gZnVuY3Rpb24gKGV2KSB7XG4gICAgaWYgKGV2LnRhcmdldCA9PT0gZWwpIHdpbmRvdy5jbG9zZUZvcmVjYXN0TW9kYWwoKTtcbiAgfTtcbiAgLy8gU2hlbGwgKyB0YWJzIGJhciArIDIgY29udGVuZWRvcmVzIGRlIHRhYnMgKFNhbGVzIFBsYW5zIG51ZXZhLCBMZWdhY3kgNm0pLlxuICAvLyBFbCBjb250ZW5pZG8gZGUgY2FkYSB0YWIgc2UgcGludGEgY29uIF9yZW5kZXJTYWxlc1BsYW5zVGFiKCkgeSBlbCBsZWdhY3lcbiAgLy8gdXNhIGVsIGZsdWpvIF9yZW5kZXJUYWJsZSgpIGRlIHNpZW1wcmUuXG4gIGNvbnN0IHNoZWxsSHRtbCA9IF9idWlsZFNoZWxsSHRtbCgpO1xuICBlbC5pbm5lckhUTUwgPSBzaGVsbEh0bWw7XG4gIGRvY3VtZW50LmJvZHkuYXBwZW5kQ2hpbGQoZWwpO1xuICByZXR1cm4gZWw7XG59XG5cbmZ1bmN0aW9uIF9idWlsZFNoZWxsSHRtbCgpIHtcbiAgLy8gQnJva2VuLW91dCBwdXJlIHN0cmluZyBidWlsZGVyIHBhcmEgcGFzYXIgZWwgaG9vayBkZSBpbm5lckhUTUwuXG4gIGNvbnN0IG1vZGFsT3V0ZXIgPVxuICAgICc8ZGl2IHN0eWxlPVwicG9zaXRpb246YWJzb2x1dGU7aW5zZXQ6MXZoIDF2dztiYWNrZ3JvdW5kOnZhcigtLWJnLWVsZXZhdGVkKTtib3JkZXItcmFkaXVzOjEwcHg7ZGlzcGxheTpmbGV4O2ZsZXgtZGlyZWN0aW9uOmNvbHVtbjtvdmVyZmxvdzpoaWRkZW47Ym94LXNoYWRvdzowIDIwcHggNTBweCByZ2JhKDAsMCwwLC4zNSlcIj4nO1xuICBjb25zdCBoZWFkZXIgPVxuICAgICc8ZGl2IHN0eWxlPVwicGFkZGluZzoxMnB4IDE4cHg7YmFja2dyb3VuZDojMGYxNzJhO2NvbG9yOiNmZmY7ZGlzcGxheTpmbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtnYXA6MTJweFwiPicgK1xuICAgICc8ZGl2IHN0eWxlPVwiZmxleDoxXCI+PGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxNnB4O2ZvbnQtd2VpZ2h0OjgwMDtsZXR0ZXItc3BhY2luZzouNXB4XCI+Rk9SRUNBU1Q8L2Rpdj4nICtcbiAgICAnPGRpdiBpZD1cImZvcmVjYXN0LXN1YnRpdGxlXCIgc3R5bGU9XCJmb250LXNpemU6MTFweDtvcGFjaXR5Oi44O21hcmdpbi10b3A6MnB4XCI+U2FsZXMgUGxhbnMgbWVuc3VhbGVzICsgcG9saXRpY2EgZGUgaW52ZW50YXJpbzwvZGl2PjwvZGl2PicgK1xuICAgICc8YnV0dG9uIG9uY2xpY2s9XCJjbG9zZUZvcmVjYXN0TW9kYWwoKVwiIHN0eWxlPVwiYmFja2dyb3VuZDp0cmFuc3BhcmVudDtjb2xvcjojZmZmO2JvcmRlcjoxcHggc29saWQgcmdiYSgyNTUsMjU1LDI1NSwuNCk7Ym9yZGVyLXJhZGl1czo2cHg7cGFkZGluZzo2cHggMTBweDtjdXJzb3I6cG9pbnRlcjtmb250LXdlaWdodDo3MDBcIj5DZXJyYXI8L2J1dHRvbj4nICtcbiAgICAnPC9kaXY+JztcbiAgY29uc3QgdGFic0JhciA9XG4gICAgJzxkaXYgaWQ9XCJmb3JlY2FzdC10YWJzLWJhclwiIHN0eWxlPVwiZGlzcGxheTpmbGV4O2dhcDowO2JhY2tncm91bmQ6IzFlMjkzYjtwYWRkaW5nOjAgMThweDtib3JkZXItYm90dG9tOjFweCBzb2xpZCB2YXIoLS1ib3JkZXItc3VidGxlKVwiPicgK1xuICAgICc8YnV0dG9uIGRhdGEtdGFiPVwic2FsZXMtcGxhbnNcIiBvbmNsaWNrPVwic3dpdGNoRm9yZWNhc3RUYWIoXFwnc2FsZXMtcGxhbnNcXCcpXCIgY2xhc3M9XCJmb3JlY2FzdC10YWJcIiBzdHlsZT1cInBhZGRpbmc6MTBweCAxNnB4O2JhY2tncm91bmQ6dHJhbnNwYXJlbnQ7Y29sb3I6I2ZmZjtib3JkZXI6bm9uZTtib3JkZXItYm90dG9tOjNweCBzb2xpZCAjMGQ5NDg4O2N1cnNvcjpwb2ludGVyO2ZvbnQtd2VpZ2h0OjcwMDtmb250LXNpemU6MTJweDtsZXR0ZXItc3BhY2luZzouNHB4O3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZVwiPlNhbGVzIFBsYW5zPC9idXR0b24+JyArXG4gICAgJzxidXR0b24gZGF0YS10YWI9XCJsZWdhY3lcIiBvbmNsaWNrPVwic3dpdGNoRm9yZWNhc3RUYWIoXFwnbGVnYWN5XFwnKVwiIGNsYXNzPVwiZm9yZWNhc3QtdGFiXCIgc3R5bGU9XCJwYWRkaW5nOjEwcHggMTZweDtiYWNrZ3JvdW5kOnRyYW5zcGFyZW50O2NvbG9yOiM5NGEzYjg7Ym9yZGVyOm5vbmU7Ym9yZGVyLWJvdHRvbTozcHggc29saWQgdHJhbnNwYXJlbnQ7Y3Vyc29yOnBvaW50ZXI7Zm9udC13ZWlnaHQ6NjAwO2ZvbnQtc2l6ZToxMnB4O2xldHRlci1zcGFjaW5nOi40cHg7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlXCI+Rm9yZWNhc3QgTGVnYWN5ICg2bSk8L2J1dHRvbj4nICtcbiAgICAnPC9kaXY+JztcbiAgY29uc3QgdGFiU2FsZXNQbGFucyA9ICc8ZGl2IGlkPVwiZm9yZWNhc3QtdGFiLXNhbGVzLXBsYW5zXCIgc3R5bGU9XCJmbGV4OjE7b3ZlcmZsb3c6YXV0b1wiPjwvZGl2Pic7XG4gIGNvbnN0IGxlZ2FjeUJhciA9XG4gICAgJzxkaXYgc3R5bGU9XCJwYWRkaW5nOjEycHggMThweDtiYWNrZ3JvdW5kOnZhcigtLWJnLXNlY29uZGFyeSk7Ym9yZGVyLWJvdHRvbToxcHggc29saWQgdmFyKC0tYm9yZGVyLXN1YnRsZSk7ZGlzcGxheTpmbGV4O2ZsZXgtd3JhcDp3cmFwO2dhcDoxNHB4O2FsaWduLWl0ZW1zOmNlbnRlclwiPicgK1xuICAgICc8bGFiZWwgc3R5bGU9XCJkaXNwbGF5OmlubGluZS1mbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtnYXA6OHB4O3BhZGRpbmc6OHB4IDEycHg7YmFja2dyb3VuZDojMGQ5NDg4O2NvbG9yOiNmZmY7Ym9yZGVyLXJhZGl1czo2cHg7Zm9udC13ZWlnaHQ6NzAwO2ZvbnQtc2l6ZToxMnB4O2N1cnNvcjpwb2ludGVyXCI+JyArXG4gICAgJzxzcGFuPkNhcmdhciBTYWxlcyBQbGFuICgueGxzeCk8L3NwYW4+JyArXG4gICAgJzxpbnB1dCB0eXBlPVwiZmlsZVwiIGFjY2VwdD1cIi54bHN4LC54bHNcIiBzdHlsZT1cImRpc3BsYXk6bm9uZVwiIG9uY2hhbmdlPVwib25Gb3JlY2FzdFNhbGVzUGxhbkZpbGUoZXZlbnQpXCIvPjwvbGFiZWw+JyArXG4gICAgJzxkaXYgaWQ9XCJmb3JlY2FzdC1oaW50XCIgc3R5bGU9XCJmb250LXNpemU6MTFweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTttYXgtd2lkdGg6NTIwcHhcIj5Gb3JtYXRvIGxlZ2FjeTogcHJpbWVyYSBjb2x1bW5hIDxiPlNLVTwvYj4sIGx1ZWdvIDYgY29sdW1uYXMgY29uIGxhcyB1bmlkYWRlcyBwZWRpZGFzIG1lcyBhIG1lcy48L2Rpdj4nICtcbiAgICAnPGJ1dHRvbiBpZD1cImZvcmVjYXN0LWV4cG9ydC1idG5cIiBvbmNsaWNrPVwiZXhwb3J0Rm9yZWNhc3RFeGNlbCgpXCIgZGlzYWJsZWQgc3R5bGU9XCJwYWRkaW5nOjhweCAxNHB4O2JhY2tncm91bmQ6dmFyKC0tY29sb3Itc3VjY2Vzcyk7Y29sb3I6I2ZmZjtib3JkZXI6bm9uZTtib3JkZXItcmFkaXVzOjZweDtmb250LXdlaWdodDo3MDA7Y3Vyc29yOnBvaW50ZXI7b3BhY2l0eTouNVwiPkV4cG9ydGFyIEV4Y2VsPC9idXR0b24+JyArXG4gICAgJzxkaXYgaWQ9XCJmb3JlY2FzdC1zdGF0c1wiIHN0eWxlPVwibWFyZ2luLWxlZnQ6YXV0bztmb250LXNpemU6MTFweDtjb2xvcjp2YXIoLS10ZXh0LXNlY29uZGFyeSk7Zm9udC13ZWlnaHQ6NjAwXCI+PC9kaXY+JyArXG4gICAgJzwvZGl2Pic7XG4gIGNvbnN0IGxlZ2FjeUJvZHkgPVxuICAgICc8ZGl2IGlkPVwiZm9yZWNhc3QtYm9keVwiIHN0eWxlPVwiZmxleDoxO292ZXJmbG93OmF1dG87cGFkZGluZzowXCI+PGRpdiBzdHlsZT1cInBhZGRpbmc6NjBweCAyMHB4O3RleHQtYWxpZ246Y2VudGVyO2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO2ZvbnQtc2l6ZToxNHB4XCI+RXNwZXJhbmRvIGFyY2hpdm8gU2FsZXMgUGxhbi4uLjwvZGl2PjwvZGl2Pic7XG4gIGNvbnN0IHRhYkxlZ2FjeSA9XG4gICAgJzxkaXYgaWQ9XCJmb3JlY2FzdC10YWItbGVnYWN5XCIgc3R5bGU9XCJmbGV4OjE7b3ZlcmZsb3c6aGlkZGVuO2ZsZXgtZGlyZWN0aW9uOmNvbHVtbjtkaXNwbGF5Om5vbmVcIj4nICtcbiAgICBsZWdhY3lCYXIgK1xuICAgIGxlZ2FjeUJvZHkgK1xuICAgICc8L2Rpdj4nO1xuICByZXR1cm4gbW9kYWxPdXRlciArIGhlYWRlciArIHRhYnNCYXIgKyB0YWJTYWxlc1BsYW5zICsgdGFiTGVnYWN5ICsgJzwvZGl2Pic7XG59XG5cbi8vIHYxMDk4KyBGYXNlIDE6IHN3aXRjaCBlbnRyZSB0YWJzIFNhbGVzIFBsYW5zIDwtPiBMZWdhY3kuXG53aW5kb3cuc3dpdGNoRm9yZWNhc3RUYWIgPSBmdW5jdGlvbiAodGFiSWQpIHtcbiAgX2ZvcmVjYXN0QWN0aXZlVGFiID0gdGFiSWQ7XG4gIGNvbnN0IHNwID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2ZvcmVjYXN0LXRhYi1zYWxlcy1wbGFucycpO1xuICBjb25zdCBsZyA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdmb3JlY2FzdC10YWItbGVnYWN5Jyk7XG4gIGlmIChzcCkgc3Auc3R5bGUuZGlzcGxheSA9IHRhYklkID09PSAnc2FsZXMtcGxhbnMnID8gJ2Jsb2NrJyA6ICdub25lJztcbiAgaWYgKGxnKSBsZy5zdHlsZS5kaXNwbGF5ID0gdGFiSWQgPT09ICdsZWdhY3knID8gJ2ZsZXgnIDogJ25vbmUnO1xuICBjb25zdCBidG5zID0gZG9jdW1lbnQucXVlcnlTZWxlY3RvckFsbCgnI2ZvcmVjYXN0LXRhYnMtYmFyIC5mb3JlY2FzdC10YWInKTtcbiAgYnRucy5mb3JFYWNoKChiKSA9PiB7XG4gICAgY29uc3QgYWN0aXZlID0gYi5nZXRBdHRyaWJ1dGUoJ2RhdGEtdGFiJykgPT09IHRhYklkO1xuICAgIGIuc3R5bGUuY29sb3IgPSBhY3RpdmUgPyAnI2ZmZicgOiAnIzk0YTNiOCc7XG4gICAgYi5zdHlsZS5ib3JkZXJCb3R0b21Db2xvciA9IGFjdGl2ZSA/ICcjMGQ5NDg4JyA6ICd0cmFuc3BhcmVudCc7XG4gICAgYi5zdHlsZS5mb250V2VpZ2h0ID0gYWN0aXZlID8gJzcwMCcgOiAnNjAwJztcbiAgfSk7XG59O1xuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIEZBU0UgMSBcdTIwMTQgU2FsZXMgUGxhbnMgdXBsb2FkIChSb2RzIC8gUmVlbHMgLyBGRylcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5mdW5jdGlvbiBfeWVhck1vbnRoTm93KCkge1xuICBjb25zdCBkID0gbmV3IERhdGUoKTtcbiAgcmV0dXJuIGQuZ2V0RnVsbFllYXIoKSArICctJyArIFN0cmluZyhkLmdldE1vbnRoKCkgKyAxKS5wYWRTdGFydCgyLCAnMCcpO1xufVxuXG5mdW5jdGlvbiBfZm10U2l6ZShieXRlcykge1xuICBpZiAoIWJ5dGVzKSByZXR1cm4gJyc7XG4gIGlmIChieXRlcyA8IDEwMjQpIHJldHVybiBieXRlcyArICcgQic7XG4gIGlmIChieXRlcyA8IDEwMjQgKiAxMDI0KSByZXR1cm4gKGJ5dGVzIC8gMTAyNCkudG9GaXhlZCgxKSArICcgS0InO1xuICByZXR1cm4gKGJ5dGVzIC8gKDEwMjQgKiAxMDI0KSkudG9GaXhlZCgyKSArICcgTUInO1xufVxuXG5mdW5jdGlvbiBfZm10RGF0ZVNob3J0KGlzbykge1xuICBpZiAoIWlzbykgcmV0dXJuICdcdTIwMTQnO1xuICB0cnkge1xuICAgIGNvbnN0IGQgPSBpc28udG9EYXRlID8gaXNvLnRvRGF0ZSgpIDogbmV3IERhdGUoaXNvKTtcbiAgICByZXR1cm4gKFxuICAgICAgZC50b0xvY2FsZURhdGVTdHJpbmcoJ2VzLUFSJywgeyBkYXk6ICcyLWRpZ2l0JywgbW9udGg6ICdzaG9ydCcsIHllYXI6ICcyLWRpZ2l0JyB9KSArXG4gICAgICAnICcgK1xuICAgICAgZC50b0xvY2FsZVRpbWVTdHJpbmcoJ2VzLUFSJywgeyBob3VyOiAnMi1kaWdpdCcsIG1pbnV0ZTogJzItZGlnaXQnIH0pXG4gICAgKTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIFN0cmluZyhpc28pO1xuICB9XG59XG5cbmFzeW5jIGZ1bmN0aW9uIF9sb2FkU2FsZXNQbGFuQ2FjaGVzKCkge1xuICBpZiAoIXdpbmRvdy5mYkRiKSByZXR1cm47XG4gIGF3YWl0IFByb21pc2UuYWxsKFxuICAgIFNBTEVTX1BMQU5fRkFNSUxJQVMubWFwKGFzeW5jIChmKSA9PiB7XG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCBkb2MgPSBhd2FpdCB3aW5kb3cuZmJEYi5jb2xsZWN0aW9uKCdzYWxlc19wbGFuX2NhY2hlJykuZG9jKGYua2V5KS5nZXQoKTtcbiAgICAgICAgX3NhbGVzUGxhbkNhY2hlc1tmLmtleV0gPSBkb2MuZXhpc3RzID8gZG9jLmRhdGEoKSA6IG51bGw7XG4gICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgIGNvbnNvbGUud2FybignW0ZPUkVDQVNUXSBsb2FkIHNhbGVzX3BsYW5fY2FjaGUvJyArIGYua2V5ICsgJyBmYWlsOicsIGUgJiYgZS5tZXNzYWdlKTtcbiAgICAgICAgX3NhbGVzUGxhbkNhY2hlc1tmLmtleV0gPSBudWxsO1xuICAgICAgfVxuICAgIH0pXG4gICk7XG59XG5cbmZ1bmN0aW9uIF9yZW5kZXJUYWJsZShyb3dzKSB7XG4gIGNvbnN0IGJvZHkgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZm9yZWNhc3QtYm9keScpO1xuICBpZiAoIWJvZHkpIHJldHVybjtcbiAgaWYgKCFyb3dzIHx8ICFyb3dzLmxlbmd0aCkge1xuICAgIGJvZHkuaW5uZXJIVE1MID1cbiAgICAgICc8ZGl2IHN0eWxlPVwicGFkZGluZzo2MHB4IDIwcHg7dGV4dC1hbGlnbjpjZW50ZXI7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZClcIj5TYWxlcyBQbGFuIHZhY2lvIG8gc2luIGZpbGFzIHZhbGlkYXMuPC9kaXY+JztcbiAgICByZXR1cm47XG4gIH1cbiAgY29uc3QgZm10ID0gKG4pID0+XG4gICAgbiA9PT0gMCB8fCAhTnVtYmVyLmlzRmluaXRlKG4pXG4gICAgICA/ICcwJ1xuICAgICAgOiBOdW1iZXIobikudG9Mb2NhbGVTdHJpbmcoJ2VzLUFSJywgeyBtYXhpbXVtRnJhY3Rpb25EaWdpdHM6IDEgfSk7XG4gIGNvbnN0IGNvbG9yRm9yVG90YWwgPSAodCkgPT4ge1xuICAgIGlmICh0ID4gMCkgcmV0dXJuICcjMTY2NTM0JzsgLy8gc29icmEgKHBlZGlzdGUgbWFzIHF1ZSBsYSBwb2xpdGljYSkgLSB2ZXJkZVxuICAgIGlmICh0IDwgMCkgcmV0dXJuICcjYzI0MTBjJzsgLy8gZmFsdGEgKHBlZGlzdGUgbWVub3MgcXVlIGxhIHBvbGl0aWNhKSAtIG5hcmFuamEgdXJnZW50ZVxuICAgIHJldHVybiAnIzQ3NTU2OSc7XG4gIH07XG4gIGNvbnN0IHJvd3NIdG1sID0gcm93c1xuICAgIC5tYXAoXG4gICAgICAocikgPT5cbiAgICAgICAgJycgK1xuICAgICAgICAnPHRyJyArXG4gICAgICAgIChyLmhhc0hpc3RvcmlhID8gJycgOiAnIHN0eWxlPVwiYmFja2dyb3VuZDp2YXIoLS1jb2xvci13YXJuaW5nLWJnKVwiJykgK1xuICAgICAgICAnPicgK1xuICAgICAgICAnPHRkIHN0eWxlPVwicGFkZGluZzo2cHggMTBweDtmb250LWZhbWlseTptb25vc3BhY2U7Zm9udC1zaXplOjExcHg7d2hpdGUtc3BhY2U6bm93cmFwXCI+JyArXG4gICAgICAgIGVzY2FwZUh0bWxTYWZlKHIuc2t1KSArXG4gICAgICAgICc8L3RkPicgK1xuICAgICAgICAnPHRkIHN0eWxlPVwicGFkZGluZzo2cHggMTBweDtmb250LXNpemU6MTFweFwiPicgK1xuICAgICAgICBlc2NhcGVIdG1sU2FmZShyLmZhbWlsaWEpICtcbiAgICAgICAgJzwvdGQ+JyArXG4gICAgICAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjZweCAxMHB4O2ZvbnQtc2l6ZToxMXB4XCI+JyArXG4gICAgICAgIGVzY2FwZUh0bWxTYWZlKHIuc3ViZmFtaWxpYSkgK1xuICAgICAgICAnPC90ZD4nICtcbiAgICAgICAgJzx0ZCBzdHlsZT1cInBhZGRpbmc6NnB4IDEwcHg7dGV4dC1hbGlnbjpyaWdodDtmb250LXZhcmlhbnQtbnVtZXJpYzp0YWJ1bGFyLW51bXNcIj4nICtcbiAgICAgICAgZm10KHIudmVudGFzMTJtKSArXG4gICAgICAgICc8L3RkPicgK1xuICAgICAgICAnPHRkIHN0eWxlPVwicGFkZGluZzo2cHggMTBweDt0ZXh0LWFsaWduOnJpZ2h0O2ZvbnQtdmFyaWFudC1udW1lcmljOnRhYnVsYXItbnVtcztmb250LXdlaWdodDo2MDBcIj4nICtcbiAgICAgICAgZm10KHIucGVkaWRvNm0pICtcbiAgICAgICAgJzwvdGQ+JyArXG4gICAgICAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjZweCAxMHB4O3RleHQtYWxpZ246cmlnaHQ7Zm9udC12YXJpYW50LW51bWVyaWM6dGFidWxhci1udW1zO2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpXCI+JyArXG4gICAgICAgIGZtdChyLnByb21lZGlvKSArXG4gICAgICAgICc8L3RkPicgK1xuICAgICAgICAnPHRkIHN0eWxlPVwicGFkZGluZzo2cHggMTBweDt0ZXh0LWFsaWduOnJpZ2h0O2ZvbnQtdmFyaWFudC1udW1lcmljOnRhYnVsYXItbnVtc1wiPicgK1xuICAgICAgICBmbXQoci5wb2xpdGljYSkgK1xuICAgICAgICAnPC90ZD4nICtcbiAgICAgICAgJzx0ZCBzdHlsZT1cInBhZGRpbmc6NnB4IDEwcHg7dGV4dC1hbGlnbjpyaWdodDtmb250LXZhcmlhbnQtbnVtZXJpYzp0YWJ1bGFyLW51bXM7Zm9udC13ZWlnaHQ6NzAwO2NvbG9yOicgK1xuICAgICAgICBjb2xvckZvclRvdGFsKHIudG90YWwpICtcbiAgICAgICAgJ1wiPicgK1xuICAgICAgICBmbXQoci50b3RhbCkgK1xuICAgICAgICAnPC90ZD4nICtcbiAgICAgICAgJzwvdHI+J1xuICAgIClcbiAgICAuam9pbignJyk7XG4gIGNvbnN0IGhlYWRlciA9XG4gICAgJycgK1xuICAgICc8dGhlYWQgc3R5bGU9XCJwb3NpdGlvbjpzdGlja3k7dG9wOjA7YmFja2dyb3VuZDojMGYxNzJhO2NvbG9yOiNmZmY7ei1pbmRleDoxXCI+JyArXG4gICAgJzx0cj4nICtcbiAgICAnPHRoIHN0eWxlPVwicGFkZGluZzo4cHggMTBweDt0ZXh0LWFsaWduOmxlZnQ7Zm9udC1zaXplOjExcHg7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO2xldHRlci1zcGFjaW5nOi40cHhcIj5TS1U8L3RoPicgK1xuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjhweCAxMHB4O3RleHQtYWxpZ246bGVmdDtmb250LXNpemU6MTFweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7bGV0dGVyLXNwYWNpbmc6LjRweFwiPkZhbWlsaWE8L3RoPicgK1xuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjhweCAxMHB4O3RleHQtYWxpZ246bGVmdDtmb250LXNpemU6MTFweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7bGV0dGVyLXNwYWNpbmc6LjRweFwiPlN1YmZhbWlsaWE8L3RoPicgK1xuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjhweCAxMHB4O3RleHQtYWxpZ246cmlnaHQ7Zm9udC1zaXplOjExcHg7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO2xldHRlci1zcGFjaW5nOi40cHhcIiB0aXRsZT1cIlN1bWEgZGUgcXR5IGZhY3R1cmFkYSBlbiBsb3MgdWx0aW1vcyAxMiBtZXNlcyBjb21wbGV0b3NcIj5WZW50YXMgMTJtPC90aD4nICtcbiAgICAnPHRoIHN0eWxlPVwicGFkZGluZzo4cHggMTBweDt0ZXh0LWFsaWduOnJpZ2h0O2ZvbnQtc2l6ZToxMXB4O3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtsZXR0ZXItc3BhY2luZzouNHB4XCIgdGl0bGU9XCJTdW1hIGRlIGxhcyA2IGNvbHVtbmFzIGRlbCBFeGNlbCBTYWxlcyBQbGFuXCI+UGVkaWRvIDZtPC90aD4nICtcbiAgICAnPHRoIHN0eWxlPVwicGFkZGluZzo4cHggMTBweDt0ZXh0LWFsaWduOnJpZ2h0O2ZvbnQtc2l6ZToxMXB4O3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtsZXR0ZXItc3BhY2luZzouNHB4XCIgdGl0bGU9XCJWZW50YXMgWVREIC8gbWVzZXMgdHJhbnNjdXJyaWRvcyBkZWwgYVx1MDBGMW9cIj5Qcm9tIC8gTWVzPC90aD4nICtcbiAgICAnPHRoIHN0eWxlPVwicGFkZGluZzo4cHggMTBweDt0ZXh0LWFsaWduOnJpZ2h0O2ZvbnQtc2l6ZToxMXB4O3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtsZXR0ZXItc3BhY2luZzouNHB4XCIgdGl0bGU9XCJQcm9tZWRpbyB4IDMgbWVzZXMgKHBvbGl0aWNhIGRlIGludmVudGFyaW8pXCI+UG9saXRpY2E8L3RoPicgK1xuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjhweCAxMHB4O3RleHQtYWxpZ246cmlnaHQ7Zm9udC1zaXplOjExcHg7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO2xldHRlci1zcGFjaW5nOi40cHhcIiB0aXRsZT1cIlBlZGlkbyA2bSAtIFBvbGl0aWNhLiBOZWdhdGl2byA9IHRlIGZhbHRhIHBlZGlyOyBQb3NpdGl2byA9IHNvYnJlcGVkaWRvXCI+VG90YWw8L3RoPicgK1xuICAgICc8L3RyPicgK1xuICAgICc8L3RoZWFkPic7XG4gIGJvZHkuaW5uZXJIVE1MID1cbiAgICAnPHRhYmxlIHN0eWxlPVwid2lkdGg6MTAwJTtib3JkZXItY29sbGFwc2U6Y29sbGFwc2U7Zm9udC1zaXplOjEycHhcIj4nICtcbiAgICBoZWFkZXIgK1xuICAgICc8dGJvZHk+JyArXG4gICAgcm93c0h0bWwgK1xuICAgICc8L3Rib2R5PjwvdGFibGU+Jztcbn1cblxuZnVuY3Rpb24gZXNjYXBlSHRtbFNhZmUocykge1xuICBpZiAodHlwZW9mIHdpbmRvdy5lc2NhcGVIdG1sID09PSAnZnVuY3Rpb24nKSByZXR1cm4gd2luZG93LmVzY2FwZUh0bWwocyk7XG4gIHJldHVybiBTdHJpbmcocyA9PSBudWxsID8gJycgOiBzKS5yZXBsYWNlKFxuICAgIC9bJjw+XCInXS9nLFxuICAgIChjaCkgPT4gKHsgJyYnOiAnJmFtcDsnLCAnPCc6ICcmbHQ7JywgJz4nOiAnJmd0OycsICdcIic6ICcmcXVvdDsnLCBcIidcIjogJyYjMzk7JyB9KVtjaF1cbiAgKTtcbn1cblxuZnVuY3Rpb24gX2J1aWxkU2FsZXNQbGFuU2xvdEh0bWwoZikge1xuICBjb25zdCBjYWNoZSA9IF9zYWxlc1BsYW5DYWNoZXNbZi5rZXldO1xuICBjb25zdCByb3dzQ291bnQgPSBjYWNoZSAmJiBOdW1iZXIuaXNGaW5pdGUoY2FjaGUucm93c0NvdW50KSA/IGNhY2hlLnJvd3NDb3VudCA6IDA7XG4gIGNvbnN0IG1vbnRoc0NvdW50ID1cbiAgICBjYWNoZSAmJiBBcnJheS5pc0FycmF5KGNhY2hlLmRldGVjdGVkTW9udGhzKSA/IGNhY2hlLmRldGVjdGVkTW9udGhzLmxlbmd0aCA6IDA7XG4gIGNvbnN0IHBhcnNlZEF0ID0gY2FjaGUgJiYgY2FjaGUucGFyc2VkQXQgPyBfZm10RGF0ZVNob3J0KGNhY2hlLnBhcnNlZEF0KSA6ICcnO1xuICBjb25zdCB1cGxvYWRlZEJ5ID0gY2FjaGUgJiYgY2FjaGUudXBsb2FkZWRCeSA/IGNhY2hlLnVwbG9hZGVkQnkgOiAnJztcbiAgY29uc3Qgc291cmNlRmlsZW5hbWUgPSBjYWNoZSAmJiBjYWNoZS5zb3VyY2VGaWxlbmFtZSA/IGNhY2hlLnNvdXJjZUZpbGVuYW1lIDogJyc7XG4gIGNvbnN0IHllYXJNb250aCA9IGNhY2hlICYmIGNhY2hlLnllYXJNb250aCA/IGNhY2hlLnllYXJNb250aCA6ICcnO1xuICBjb25zdCBtb250aHNSYW5nZSA9XG4gICAgY2FjaGUgJiYgY2FjaGUuZGV0ZWN0ZWRNb250aHMgJiYgY2FjaGUuZGV0ZWN0ZWRNb250aHMubGVuZ3RoXG4gICAgICA/IGNhY2hlLmRldGVjdGVkTW9udGhzWzBdICsgJyBcdTIxOTIgJyArIGNhY2hlLmRldGVjdGVkTW9udGhzW2NhY2hlLmRldGVjdGVkTW9udGhzLmxlbmd0aCAtIDFdXG4gICAgICA6ICdcdTIwMTQnO1xuICBjb25zdCBoYXNDYWNoZSA9ICEhY2FjaGU7XG4gIGNvbnN0IGJhZGdlID0gaGFzQ2FjaGVcbiAgICA/ICc8ZGl2IHN0eWxlPVwicGFkZGluZzo0cHggOHB4O2JhY2tncm91bmQ6IzE2YTM0YTtjb2xvcjojZmZmO2JvcmRlci1yYWRpdXM6MTJweDtmb250LXNpemU6MTBweDtmb250LXdlaWdodDo3MDA7bGV0dGVyLXNwYWNpbmc6LjRweFwiPkNBUkdBRE88L2Rpdj4nXG4gICAgOiAnPGRpdiBzdHlsZT1cInBhZGRpbmc6NHB4IDhweDtiYWNrZ3JvdW5kOiNkYzI2MjY7Y29sb3I6I2ZmZjtib3JkZXItcmFkaXVzOjEycHg7Zm9udC1zaXplOjEwcHg7Zm9udC13ZWlnaHQ6NzAwO2xldHRlci1zcGFjaW5nOi40cHhcIj5GQUxUQTwvZGl2Pic7XG4gIGNvbnN0IG1ldGFCbG9jayA9IGhhc0NhY2hlXG4gICAgPyAnPGRpdiBzdHlsZT1cImRpc3BsYXk6Z3JpZDtncmlkLXRlbXBsYXRlLWNvbHVtbnM6YXV0byAxZnI7Z2FwOjZweCAxMnB4O2ZvbnQtc2l6ZToxMXB4O3BhZGRpbmc6MTBweCAxMnB4O2JhY2tncm91bmQ6dmFyKC0tYmctc2Vjb25kYXJ5KTtib3JkZXItcmFkaXVzOjZweFwiPicgK1xuICAgICAgJzxkaXYgc3R5bGU9XCJjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTtmb250LXdlaWdodDo2MDBcIj5BcmNoaXZvPC9kaXY+PGRpdiBzdHlsZT1cImNvbG9yOnZhcigtLXRleHQtcHJpbWFyeSk7Zm9udC1mYW1pbHk6bW9ub3NwYWNlO3dvcmQtYnJlYWs6YnJlYWstYWxsXCI+JyArXG4gICAgICBlc2NhcGVIdG1sU2FmZShzb3VyY2VGaWxlbmFtZSkgK1xuICAgICAgJzwvZGl2PicgK1xuICAgICAgJzxkaXYgc3R5bGU9XCJjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTtmb250LXdlaWdodDo2MDBcIj5TdWJpZG88L2Rpdj48ZGl2IHN0eWxlPVwiY29sb3I6dmFyKC0tdGV4dC1wcmltYXJ5KVwiPicgK1xuICAgICAgZXNjYXBlSHRtbFNhZmUocGFyc2VkQXQpICtcbiAgICAgICc8L2Rpdj4nICtcbiAgICAgICc8ZGl2IHN0eWxlPVwiY29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7Zm9udC13ZWlnaHQ6NjAwXCI+UG9yPC9kaXY+PGRpdiBzdHlsZT1cImNvbG9yOnZhcigtLXRleHQtcHJpbWFyeSlcIj4nICtcbiAgICAgIGVzY2FwZUh0bWxTYWZlKHVwbG9hZGVkQnkpICtcbiAgICAgICc8L2Rpdj4nICtcbiAgICAgICc8ZGl2IHN0eWxlPVwiY29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7Zm9udC13ZWlnaHQ6NjAwXCI+U25hcHNob3Q8L2Rpdj48ZGl2IHN0eWxlPVwiY29sb3I6dmFyKC0tdGV4dC1wcmltYXJ5KTtmb250LWZhbWlseTptb25vc3BhY2VcIj4nICtcbiAgICAgIGVzY2FwZUh0bWxTYWZlKHllYXJNb250aCkgK1xuICAgICAgJzwvZGl2PicgK1xuICAgICAgJzxkaXYgc3R5bGU9XCJjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTtmb250LXdlaWdodDo2MDBcIj5TS1VzPC9kaXY+PGRpdiBzdHlsZT1cImNvbG9yOnZhcigtLXRleHQtcHJpbWFyeSk7Zm9udC13ZWlnaHQ6NzAwXCI+JyArXG4gICAgICByb3dzQ291bnQudG9Mb2NhbGVTdHJpbmcoJ2VzLUFSJykgK1xuICAgICAgJzwvZGl2PicgK1xuICAgICAgJzxkaXYgc3R5bGU9XCJjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTtmb250LXdlaWdodDo2MDBcIj5NZXNlczwvZGl2PjxkaXYgc3R5bGU9XCJjb2xvcjp2YXIoLS10ZXh0LXByaW1hcnkpO2ZvbnQtd2VpZ2h0OjcwMFwiPicgK1xuICAgICAgbW9udGhzQ291bnQgK1xuICAgICAgJyA8c3BhbiBzdHlsZT1cImNvbG9yOnZhcigtLXRleHQtbXV0ZWQpO2ZvbnQtd2VpZ2h0OjQwMFwiPignICtcbiAgICAgIGVzY2FwZUh0bWxTYWZlKG1vbnRoc1JhbmdlKSArXG4gICAgICAnKTwvc3Bhbj48L2Rpdj4nICtcbiAgICAgICc8L2Rpdj4nXG4gICAgOiAnPGRpdiBzdHlsZT1cInBhZGRpbmc6MTRweDt0ZXh0LWFsaWduOmNlbnRlcjtmb250LXNpemU6MTJweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTtiYWNrZ3JvdW5kOnZhcigtLWJnLXNlY29uZGFyeSk7Ym9yZGVyLXJhZGl1czo2cHg7Ym9yZGVyOjFweCBkYXNoZWQgdmFyKC0tYm9yZGVyLXN1YnRsZSlcIj5BdW4gbm8gc3ViaXN0ZSBlbCBTYWxlcyBQbGFuIGRlIGVzdGEgZmFtaWxpYS48L2Rpdj4nO1xuICBjb25zdCB1cGxvYWRCdG4gPVxuICAgICc8bGFiZWwgc3R5bGU9XCJkaXNwbGF5OmlubGluZS1mbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtqdXN0aWZ5LWNvbnRlbnQ6Y2VudGVyO2dhcDo4cHg7cGFkZGluZzoxMHB4IDE0cHg7YmFja2dyb3VuZDonICtcbiAgICBmLmNvbG9yICtcbiAgICAnO2NvbG9yOiNmZmY7Ym9yZGVyLXJhZGl1czo2cHg7Zm9udC13ZWlnaHQ6NzAwO2ZvbnQtc2l6ZToxMnB4O2N1cnNvcjpwb2ludGVyO2xldHRlci1zcGFjaW5nOi40cHhcIj4nICtcbiAgICAnPHNwYW4+JyArXG4gICAgKGhhc0NhY2hlID8gJ1x1MjFCQiBSZWVtcGxhemFyIEV4Y2VsJyA6ICdcdTJCMDYgQ2FyZ2FyIEV4Y2VsJykgK1xuICAgICc8L3NwYW4+JyArXG4gICAgJzxpbnB1dCB0eXBlPVwiZmlsZVwiIGFjY2VwdD1cIi54bHN4LC54bHNcIiBkYXRhLWZhbWlsaWE9XCInICtcbiAgICBmLmtleSArXG4gICAgJ1wiIHN0eWxlPVwiZGlzcGxheTpub25lXCIgb25jaGFuZ2U9XCJvblNhbGVzUGxhbkZpbGVGb3JGYW1pbGlhKGV2ZW50LCBcXCcnICtcbiAgICBmLmtleSArXG4gICAgJ1xcJylcIi8+JyArXG4gICAgJzwvbGFiZWw+JztcbiAgY29uc3QgY2FyZEhlYWQgPVxuICAgICc8ZGl2IHN0eWxlPVwiZGlzcGxheTpmbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtnYXA6MTBweFwiPicgK1xuICAgICc8ZGl2IHN0eWxlPVwid2lkdGg6MTJweDtoZWlnaHQ6MzJweDtiYWNrZ3JvdW5kOicgK1xuICAgIGYuY29sb3IgK1xuICAgICc7Ym9yZGVyLXJhZGl1czozcHhcIj48L2Rpdj4nICtcbiAgICAnPGRpdiBzdHlsZT1cImZsZXg6MVwiPjxkaXYgc3R5bGU9XCJmb250LXNpemU6MTRweDtmb250LXdlaWdodDo4MDA7Y29sb3I6dmFyKC0tdGV4dC1wcmltYXJ5KVwiPicgK1xuICAgIGVzY2FwZUh0bWxTYWZlKGYubGFiZWwpICtcbiAgICAnPC9kaXY+JyArXG4gICAgJzxkaXYgc3R5bGU9XCJmb250LXNpemU6MTFweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTttYXJnaW4tdG9wOjJweFwiPlNhbGVzIFBsYW4gbWVuc3VhbCBcdTAwQjcgSG9qYSBTQVI8L2Rpdj48L2Rpdj4nICtcbiAgICBiYWRnZSArXG4gICAgJzwvZGl2Pic7XG4gIHJldHVybiAoXG4gICAgJzxkaXYgc3R5bGU9XCJiYWNrZ3JvdW5kOnZhcigtLWJnLWVsZXZhdGVkKTtib3JkZXI6MXB4IHNvbGlkIHZhcigtLWJvcmRlci1zdWJ0bGUpO2JvcmRlci1yYWRpdXM6MTBweDtwYWRkaW5nOjE2cHg7ZGlzcGxheTpmbGV4O2ZsZXgtZGlyZWN0aW9uOmNvbHVtbjtnYXA6MTJweFwiPicgK1xuICAgIGNhcmRIZWFkICtcbiAgICBtZXRhQmxvY2sgK1xuICAgIHVwbG9hZEJ0biArXG4gICAgJzxkaXYgaWQ9XCJzYWxlcy1wbGFuLXN0YXR1cy0nICtcbiAgICBmLmtleSArXG4gICAgJ1wiIHN0eWxlPVwiZm9udC1zaXplOjExcHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7bWluLWhlaWdodDoxNHB4XCI+PC9kaXY+JyArXG4gICAgJzwvZGl2PidcbiAgKTtcbn1cblxuZnVuY3Rpb24gX3JlbmRlclNhbGVzUGxhbnNUYWIoKSB7XG4gIGNvbnN0IGNvbnQgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZm9yZWNhc3QtdGFiLXNhbGVzLXBsYW5zJyk7XG4gIGlmICghY29udCkgcmV0dXJuO1xuICBjb25zdCBzbG90cyA9IFNBTEVTX1BMQU5fRkFNSUxJQVMubWFwKF9idWlsZFNhbGVzUGxhblNsb3RIdG1sKS5qb2luKCcnKTtcbiAgY29uc3QgaW50cm8gPVxuICAgICc8ZGl2IHN0eWxlPVwibWFyZ2luLWJvdHRvbToxNnB4O3BhZGRpbmc6MTJweCAxNHB4O2JhY2tncm91bmQ6dmFyKC0tYmctc2Vjb25kYXJ5KTtib3JkZXItbGVmdDozcHggc29saWQgIzBkOTQ4ODtib3JkZXItcmFkaXVzOjZweDtmb250LXNpemU6MTJweDtjb2xvcjp2YXIoLS10ZXh0LXNlY29uZGFyeSk7bGluZS1oZWlnaHQ6MS41XCI+JyArXG4gICAgJzxiIHN0eWxlPVwiY29sb3I6dmFyKC0tdGV4dC1wcmltYXJ5KVwiPkZhc2UgMTwvYj4gXHUyMDE0IENhcmdcdTAwRTEgbG9zIDMgU2FsZXMgUGxhbnMgbWVuc3VhbGVzIChSb2RzIC8gUmVlbHMgLyBGRykuIFNlIHBhcnNlYSBsYSBob2phIDxiPlNBUjwvYj46IFNLVSwgTU9RIDEyIG1vbnRocywgeSB1bmEgY29sdW1uYSBwb3IgbWVzLiAnICtcbiAgICAnRWwgRXhjZWwgb3JpZ2luYWwgcXVlZGEgc25hcHNob3RhZG8gZW4gU3RvcmFnZSB5IGVsIHBhcnNlbyBxdWVkYSBlbiBGaXJlc3RvcmUgcGFyYSBlbCBjXHUwMEUxbGN1bG8gKHByXHUwMEYzeGltYSBmYXNlKS4nICtcbiAgICAnPC9kaXY+JztcbiAgY29uc3QgZ3JpZCA9XG4gICAgJzxkaXYgc3R5bGU9XCJkaXNwbGF5OmdyaWQ7Z3JpZC10ZW1wbGF0ZS1jb2x1bW5zOnJlcGVhdChhdXRvLWZpdCxtaW5tYXgoMzIwcHgsMWZyKSk7Z2FwOjE2cHhcIj4nICtcbiAgICBzbG90cyArXG4gICAgJzwvZGl2Pic7XG4gIGNvbnQuaW5uZXJIVE1MID0gJzxkaXYgc3R5bGU9XCJwYWRkaW5nOjE4cHhcIj4nICsgaW50cm8gKyBncmlkICsgJzwvZGl2Pic7XG59XG5cbndpbmRvdy5vblNhbGVzUGxhbkZpbGVGb3JGYW1pbGlhID0gYXN5bmMgZnVuY3Rpb24gKGV2ZW50LCBmYW1pbGlhKSB7XG4gIGNvbnN0IGZpbGUgPSBldmVudCAmJiBldmVudC50YXJnZXQgJiYgZXZlbnQudGFyZ2V0LmZpbGVzICYmIGV2ZW50LnRhcmdldC5maWxlc1swXTtcbiAgaWYgKCFmaWxlKSByZXR1cm47XG4gIGNvbnN0IHN0YXR1c0VsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3NhbGVzLXBsYW4tc3RhdHVzLScgKyBmYW1pbGlhKTtcbiAgY29uc3Qgc2V0U3RhdHVzID0gKG1zZywgY29sb3IpID0+IHtcbiAgICBpZiAoIXN0YXR1c0VsKSByZXR1cm47XG4gICAgc3RhdHVzRWwudGV4dENvbnRlbnQgPSBtc2c7XG4gICAgc3RhdHVzRWwuc3R5bGUuY29sb3IgPSBjb2xvciB8fCAndmFyKC0tdGV4dC1tdXRlZCknO1xuICB9O1xuICB0cnkge1xuICAgIGlmICh0eXBlb2YgWExTWCA9PT0gJ3VuZGVmaW5lZCcpIHtcbiAgICAgIGFsZXJ0KCdTaGVldEpTIChYTFNYKSBubyBjYXJnYWRvIFx1MjAxNCByZWNhcmdcdTAwRTEgbGEgYXBwLicpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBpZiAoIXdpbmRvdy5TYWxlc1BsYW5QYXJzZXIgfHwgIXdpbmRvdy5TYWxlc1BsYW5QYXJzZXIucGFyc2VTYWxlc1BsYW5TaGVldCkge1xuICAgICAgYWxlcnQoJ1BhcnNlciBTYWxlcyBQbGFuIG5vIGNhcmdhZG8uIFJlYnVpbGQgYnVuZGxlLicpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBpZiAoIXdpbmRvdy5maXJlYmFzZSB8fCAhd2luZG93LmZpcmViYXNlLnN0b3JhZ2UpIHtcbiAgICAgIGFsZXJ0KCdGaXJlYmFzZSBTdG9yYWdlIG5vIGRpc3BvbmlibGUuJyk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIHNldFN0YXR1cygnTGV5ZW5kbyBFeGNlbFx1MjAyNicpO1xuICAgIGNvbnN0IGJ1ZiA9IGF3YWl0IGZpbGUuYXJyYXlCdWZmZXIoKTtcbiAgICBjb25zdCB3YiA9IFhMU1gucmVhZChidWYsIHsgdHlwZTogJ2FycmF5JyB9KTtcbiAgICBjb25zdCBzYXJOYW1lID0gd2IuU2hlZXROYW1lcy5maW5kKFxuICAgICAgKG4pID0+XG4gICAgICAgIFN0cmluZyhuIHx8ICcnKVxuICAgICAgICAgIC50cmltKClcbiAgICAgICAgICAudG9VcHBlckNhc2UoKSA9PT0gJ1NBUidcbiAgICApO1xuICAgIGlmICghc2FyTmFtZSkge1xuICAgICAgc2V0U3RhdHVzKFxuICAgICAgICAnXHUyNkEwIEVsIEV4Y2VsIG5vIHRpZW5lIGhvamEgXCJTQVJcIi4gSG9qYXMgZW5jb250cmFkYXM6ICcgKyB3Yi5TaGVldE5hbWVzLmpvaW4oJywgJyksXG4gICAgICAgICcjZGMyNjI2J1xuICAgICAgKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgY29uc3Qgc2hlZXQgPSB3Yi5TaGVldHNbc2FyTmFtZV07XG4gICAgY29uc3Qgcm93cyA9IFhMU1gudXRpbHMuc2hlZXRfdG9fanNvbihzaGVldCwgeyBoZWFkZXI6IDEsIGRlZnZhbDogJycsIHJhdzogdHJ1ZSB9KTtcbiAgICBzZXRTdGF0dXMoJ1BhcnNlYW5kbyAnICsgcm93cy5sZW5ndGggKyAnIGZpbGFzIGRlIGhvamEgXCInICsgc2FyTmFtZSArICdcIlx1MjAyNicpO1xuICAgIGNvbnN0IHBhcnNlZCA9IHdpbmRvdy5TYWxlc1BsYW5QYXJzZXIucGFyc2VTYWxlc1BsYW5TaGVldChyb3dzKTtcbiAgICBpZiAoIXBhcnNlZC5yb3dzLmxlbmd0aCkge1xuICAgICAgc2V0U3RhdHVzKCdcdTI2QTAgRXhjZWwgcGFyc2VhZG8gcGVybyBzaW4gU0tVcyB2XHUwMEUxbGlkb3MuJywgJyNkYzI2MjYnKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgY29uc3QgeWVhck1vbnRoID0gX3llYXJNb250aE5vdygpO1xuICAgIGNvbnN0IHN0b3JhZ2VQYXRoID0gJ2ZvcmVjYXN0c19zbmFwc2hvdHMvJyArIHllYXJNb250aCArICcvJyArIGZhbWlsaWEgKyAnLnhsc3gnO1xuICAgIHNldFN0YXR1cygnU3ViaWVuZG8gRXhjZWwgYSBTdG9yYWdlICgnICsgX2ZtdFNpemUoZmlsZS5zaXplKSArICcpXHUyMDI2Jyk7XG4gICAgY29uc3Qgc3RvcmFnZVJlZiA9IHdpbmRvdy5maXJlYmFzZS5zdG9yYWdlKCkucmVmKHN0b3JhZ2VQYXRoKTtcbiAgICBhd2FpdCBzdG9yYWdlUmVmLnB1dChmaWxlLCB7XG4gICAgICBjb250ZW50VHlwZTogZmlsZS50eXBlIHx8ICdhcHBsaWNhdGlvbi92bmQub3BlbnhtbGZvcm1hdHMtb2ZmaWNlZG9jdW1lbnQuc3ByZWFkc2hlZXRtbC5zaGVldCcsXG4gICAgICBjdXN0b21NZXRhZGF0YToge1xuICAgICAgICBmYW1pbGlhLFxuICAgICAgICB1cGxvYWRlZEJ5OiAod2luZG93LmN1cnJlbnRVc2VyICYmIHdpbmRvdy5jdXJyZW50VXNlci5lbWFpbCkgfHwgJycsXG4gICAgICAgIHNvdXJjZUZpbGVuYW1lOiBmaWxlLm5hbWUgfHwgJycsXG4gICAgICB9LFxuICAgIH0pO1xuICAgIHNldFN0YXR1cygnR3VhcmRhbmRvIHBhcnNlbyBlbiBGaXJlc3RvcmUgKCcgKyBwYXJzZWQucm93cy5sZW5ndGggKyAnIFNLVXMpXHUyMDI2Jyk7XG4gICAgY29uc3QgdXBsb2FkZWRCeSA9ICh3aW5kb3cuY3VycmVudFVzZXIgJiYgd2luZG93LmN1cnJlbnRVc2VyLmVtYWlsKSB8fCAndW5rbm93bic7XG4gICAgY29uc3QgcGF5bG9hZCA9IHtcbiAgICAgIGZhbWlsaWEsXG4gICAgICBwYXJzZWRBdDpcbiAgICAgICAgd2luZG93LmZpcmViYXNlICYmIHdpbmRvdy5maXJlYmFzZS5maXJlc3RvcmUgJiYgd2luZG93LmZpcmViYXNlLmZpcmVzdG9yZS5GaWVsZFZhbHVlXG4gICAgICAgICAgPyB3aW5kb3cuZmlyZWJhc2UuZmlyZXN0b3JlLkZpZWxkVmFsdWUuc2VydmVyVGltZXN0YW1wKClcbiAgICAgICAgICA6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICAgIHVwbG9hZGVkQnksXG4gICAgICBzb3VyY2VGaWxlbmFtZTogZmlsZS5uYW1lIHx8ICcnLFxuICAgICAgc291cmNlU2hlZXQ6IHNhck5hbWUsXG4gICAgICB5ZWFyTW9udGgsXG4gICAgICBzdG9yYWdlUGF0aCxcbiAgICAgIHJvd3NDb3VudDogcGFyc2VkLnJvd3MubGVuZ3RoLFxuICAgICAgaGVhZGVyUm93SW5kZXg6IHBhcnNlZC5oZWFkZXJSb3dJbmRleCxcbiAgICAgIGRldGVjdGVkTW9udGhzOiBwYXJzZWQuZGV0ZWN0ZWRNb250aHMsXG4gICAgICByb3dzOiBwYXJzZWQucm93cyxcbiAgICB9O1xuICAgIGF3YWl0IHdpbmRvdy5mYkRiLmNvbGxlY3Rpb24oJ3NhbGVzX3BsYW5fY2FjaGUnKS5kb2MoZmFtaWxpYSkuc2V0KHBheWxvYWQpO1xuICAgIF9zYWxlc1BsYW5DYWNoZXNbZmFtaWxpYV0gPSBwYXlsb2FkO1xuICAgIHNldFN0YXR1cyhcbiAgICAgICdcdTI3MTMgT0suICcgKyBwYXJzZWQucm93cy5sZW5ndGggKyAnIFNLVXMgXHUwMEQ3ICcgKyBwYXJzZWQuZGV0ZWN0ZWRNb250aHMubGVuZ3RoICsgJyBtZXNlcy4nLFxuICAgICAgJyMxNmEzNGEnXG4gICAgKTtcbiAgICBfcmVuZGVyU2FsZXNQbGFuc1RhYigpO1xuICB9IGNhdGNoIChlKSB7XG4gICAgY29uc29sZS5lcnJvcignW0ZPUkVDQVNUXSB1cGxvYWQgc2FsZXMgcGxhbiAnICsgZmFtaWxpYSArICcgZmFpbDonLCBlKTtcbiAgICBzZXRTdGF0dXMoJ1x1MjcxNyBFcnJvcjogJyArICgoZSAmJiBlLm1lc3NhZ2UpIHx8IGUpLCAnI2RjMjYyNicpO1xuICAgIGlmIChlICYmIGUuY29kZSA9PT0gJ01PTlRIU19OT1RfRk9VTkQnKSB7XG4gICAgICBhbGVydChcbiAgICAgICAgJ0VsIEV4Y2VsIG5vIHRpZW5lIGNvbHVtbmFzIGRlIG1lc2VzIHJlY29ub2NpYmxlcy5cXG5cXG5IZWFkZXJzIGVzcGVyYWRvczogXCJKYW4gMjAyN1wiLCBcIk1heSAyMDI3XCIsIFwiRW5lIDIwMjdcIiwgXCIyMDI3LTAxXCIsIGV0Yy5cXG5cXG5EZXRhbGxlOiAnICtcbiAgICAgICAgICBlLm1lc3NhZ2VcbiAgICAgICk7XG4gICAgfVxuICB9IGZpbmFsbHkge1xuICAgIGlmIChldmVudCAmJiBldmVudC50YXJnZXQpIGV2ZW50LnRhcmdldC52YWx1ZSA9ICcnO1xuICB9XG59O1xuXG53aW5kb3cub3BlbkZvcmVjYXN0TW9kYWwgPSBhc3luYyBmdW5jdGlvbiAoKSB7XG4gIGlmICghX2NhbkZvcmVjYXN0KCkpIHtcbiAgICBhbGVydCgnRk9SRUNBU1QgZXMgc29sbyBwYXJhIE1hcmlhbm8gKGFkbWluKS4nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgY29uc3QgZWwgPSBfcmVuZGVyTW9kYWxTaGVsbCgpO1xuICBlbC5zdHlsZS5kaXNwbGF5ID0gJ2Jsb2NrJztcbiAgLy8gdjEwOTgrIEZhc2UgMTogY2FyZ2FyIFNhbGVzIFBsYW5zIGNhY2hlcyArIHJlbmRlcml6YXIgdGFiIGRlZmF1bHQuXG4gIF9yZW5kZXJTYWxlc1BsYW5zVGFiKCk7XG4gIF9sb2FkU2FsZXNQbGFuQ2FjaGVzKClcbiAgICAudGhlbihfcmVuZGVyU2FsZXNQbGFuc1RhYilcbiAgICAuY2F0Y2goKCkgPT4ge30pO1xuICAvLyBMZWdhY3k6IHNuYXBzaG90IHNvbG8gc2UgY2FyZ2EgbGF6eSBzaSBlbCB1c2VyIGNhbWJpYSBhIHRhYiBMZWdhY3kuXG4gIGlmIChfZm9yZWNhc3RMb2FkaW5nKSByZXR1cm47XG4gIGlmICghX2ZvcmVjYXN0U25hcHNob3QpIHtcbiAgICBfZm9yZWNhc3RMb2FkaW5nID0gdHJ1ZTtcbiAgICBjb25zdCBzdGF0cyA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdmb3JlY2FzdC1zdGF0cycpO1xuICAgIGlmIChzdGF0cykgc3RhdHMudGV4dENvbnRlbnQgPSAnQ2FyZ2FuZG8gc25hcHNob3QgZGUgdmVudGFzLi4uJztcbiAgICB0cnkge1xuICAgICAgYXdhaXQgX2xvYWRTbmFwc2hvdCgpO1xuICAgICAgaWYgKHN0YXRzKSBzdGF0cy50ZXh0Q29udGVudCA9IF9mb3JlY2FzdFNuYXBzaG90LmNvdW50ICsgJyBTS1VzIGVuIHNuYXBzaG90IGhpc3Rvcmljbyc7XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgaWYgKHN0YXRzKSBzdGF0cy50ZXh0Q29udGVudCA9ICdFcnJvciBjYXJnYW5kbyBzbmFwc2hvdDogJyArICgoZSAmJiBlLm1lc3NhZ2UpIHx8IGUpO1xuICAgICAgLy8gTm8gYWxlcnQgXHUyMDE0IGxlZ2FjeSBlcyBvcHQtaW4sIG5vIGJsb3F1ZWEgYWwgdXN1YXJpbyBzaSBzb2xvIHZhIGEgc3ViaXIgU2FsZXMgUGxhbnMuXG4gICAgICBjb25zb2xlLndhcm4oJ1tGT1JFQ0FTVF0gc25hcHNob3QgbG9hZCBmYWlsIChsZWdhY3kgdGFiKScsIGUpO1xuICAgIH0gZmluYWxseSB7XG4gICAgICBfZm9yZWNhc3RMb2FkaW5nID0gZmFsc2U7XG4gICAgfVxuICB9IGVsc2Uge1xuICAgIGNvbnN0IHN0YXRzID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2ZvcmVjYXN0LXN0YXRzJyk7XG4gICAgaWYgKHN0YXRzKSBzdGF0cy50ZXh0Q29udGVudCA9IF9mb3JlY2FzdFNuYXBzaG90LmNvdW50ICsgJyBTS1VzIGVuIHNuYXBzaG90IGhpc3Rvcmljbyc7XG4gIH1cbn07XG5cbndpbmRvdy5jbG9zZUZvcmVjYXN0TW9kYWwgPSBmdW5jdGlvbiAoKSB7XG4gIGNvbnN0IGVsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2ZvcmVjYXN0LW1vZGFsJyk7XG4gIGlmIChlbCkgZWwuc3R5bGUuZGlzcGxheSA9ICdub25lJztcbn07XG5cbndpbmRvdy5vbkZvcmVjYXN0U2FsZXNQbGFuRmlsZSA9IGFzeW5jIGZ1bmN0aW9uIChldmVudCkge1xuICBjb25zdCBmaWxlID0gZXZlbnQgJiYgZXZlbnQudGFyZ2V0ICYmIGV2ZW50LnRhcmdldC5maWxlcyAmJiBldmVudC50YXJnZXQuZmlsZXNbMF07XG4gIGlmICghZmlsZSkgcmV0dXJuO1xuICB0cnkge1xuICAgIGlmICghX2ZvcmVjYXN0U25hcHNob3QpIGF3YWl0IF9sb2FkU25hcHNob3QoKTtcbiAgICBjb25zdCBidWYgPSBhd2FpdCBmaWxlLmFycmF5QnVmZmVyKCk7XG4gICAgaWYgKHR5cGVvZiBYTFNYID09PSAndW5kZWZpbmVkJykge1xuICAgICAgYWxlcnQoJ1hMU1ggbm8gY2FyZ2FkbycpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBjb25zdCB3YiA9IFhMU1gucmVhZChidWYsIHsgdHlwZTogJ2FycmF5JyB9KTtcbiAgICBjb25zdCBzaGVldCA9IHdiLlNoZWV0c1t3Yi5TaGVldE5hbWVzWzBdXTtcbiAgICBjb25zdCByb3dzID0gWExTWC51dGlscy5zaGVldF90b19qc29uKHNoZWV0LCB7IGhlYWRlcjogMSwgZGVmdmFsOiBudWxsLCByYXc6IHRydWUgfSk7XG4gICAgY29uc3QgcGFyc2VkID0gX3BhcnNlU2FsZXNQbGFuUm93cyhyb3dzKTtcbiAgICBpZiAoIXBhcnNlZC5sZW5ndGgpIHtcbiAgICAgIGFsZXJ0KCdFbCBFeGNlbCBlc3RhIHZhY2lvIG8gbm8gdGllbmUgZmlsYXMgdmFsaWRhcy4nKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgX2ZvcmVjYXN0U2FsZXNQbGFuID0gcGFyc2VkO1xuICAgIGNvbnN0IGhveSA9IG5ldyBEYXRlKCk7XG4gICAgX2ZvcmVjYXN0Um93cyA9IF9jb21wdXRlRm9yZWNhc3RSb3dzKF9mb3JlY2FzdFNuYXBzaG90LCBwYXJzZWQsIGhveSk7XG4gICAgX3JlbmRlclRhYmxlKF9mb3JlY2FzdFJvd3MpO1xuICAgIGNvbnN0IHNpbk1hdGNoID0gX2ZvcmVjYXN0Um93cy5maWx0ZXIoKHIpID0+ICFyLmhhc0hpc3RvcmlhKS5sZW5ndGg7XG4gICAgY29uc3Qgc3RhdHMgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZm9yZWNhc3Qtc3RhdHMnKTtcbiAgICBpZiAoc3RhdHMpIHtcbiAgICAgIHN0YXRzLnRleHRDb250ZW50ID1cbiAgICAgICAgcGFyc2VkLmxlbmd0aCArXG4gICAgICAgICcgU0tVcyBlbiBTYWxlcyBQbGFuIFx1MDBCNyAnICtcbiAgICAgICAgKHBhcnNlZC5sZW5ndGggLSBzaW5NYXRjaCkgK1xuICAgICAgICAnIGNvbiBoaXN0b3JpYSBcdTAwQjcgJyArXG4gICAgICAgIHNpbk1hdGNoICtcbiAgICAgICAgJyBzaW4gbWF0Y2ggKGZvbmRvIGFtYXJpbGxvKSc7XG4gICAgfVxuICAgIGNvbnN0IGJ0biA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdmb3JlY2FzdC1leHBvcnQtYnRuJyk7XG4gICAgaWYgKGJ0bikge1xuICAgICAgYnRuLmRpc2FibGVkID0gZmFsc2U7XG4gICAgICBidG4uc3R5bGUub3BhY2l0eSA9ICcxJztcbiAgICB9XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBjb25zb2xlLmVycm9yKCdbRk9SRUNBU1RdIHBhcnNlIGVycm9yOicsIGUpO1xuICAgIGFsZXJ0KCdFcnJvciBwcm9jZXNhbmRvIGVsIEV4Y2VsOlxcbicgKyAoKGUgJiYgZS5tZXNzYWdlKSB8fCBlKSk7XG4gIH0gZmluYWxseSB7XG4gICAgLy8gUmVzZXQgaW5wdXQgcGFyYSBxdWUgZWwgbWlzbW8gYXJjaGl2byBzZSBwdWVkYSByZS1zdWJpclxuICAgIGlmIChldmVudCAmJiBldmVudC50YXJnZXQpIGV2ZW50LnRhcmdldC52YWx1ZSA9ICcnO1xuICB9XG59O1xuXG53aW5kb3cuZXhwb3J0Rm9yZWNhc3RFeGNlbCA9IGZ1bmN0aW9uICgpIHtcbiAgaWYgKCFfZm9yZWNhc3RSb3dzIHx8ICFfZm9yZWNhc3RSb3dzLmxlbmd0aCkge1xuICAgIGFsZXJ0KCdObyBoYXkgZGF0b3MgcGFyYSBleHBvcnRhci4gQ2FyZ2EgcHJpbWVybyBlbCBTYWxlcyBQbGFuLicpO1xuICAgIHJldHVybjtcbiAgfVxuICBpZiAodHlwZW9mIFhMU1ggPT09ICd1bmRlZmluZWQnKSB7XG4gICAgYWxlcnQoJ1hMU1ggbm8gY2FyZ2FkbycpO1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCByb3VuZDEgPSAobikgPT4gTWF0aC5yb3VuZChOdW1iZXIobiB8fCAwKSAqIDEwKSAvIDEwO1xuICBjb25zdCBhb2EgPSBbXG4gICAgW1xuICAgICAgJ1NLVScsXG4gICAgICAnRkFNSUxJQScsXG4gICAgICAnU1VCRkFNSUxJQScsXG4gICAgICAnVkVOVEFTICgxMm0pJyxcbiAgICAgICdQRURJRE8tU0FMRVMgUExBTlMgKDZtKScsXG4gICAgICAnUFJPTUVESU8gREUgSU5WRU5UQVJJTycsXG4gICAgICAnUE9MSVRJQ0EgREUgSU5WRU5UQVJJTyAoM20pJyxcbiAgICAgICdUT1RBTCcsXG4gICAgXSxcbiAgXTtcbiAgZm9yIChjb25zdCByIG9mIF9mb3JlY2FzdFJvd3MpIHtcbiAgICBhb2EucHVzaChbXG4gICAgICByLnNrdSxcbiAgICAgIHIuZmFtaWxpYSxcbiAgICAgIHIuc3ViZmFtaWxpYSxcbiAgICAgIHJvdW5kMShyLnZlbnRhczEybSksXG4gICAgICByb3VuZDEoci5wZWRpZG82bSksXG4gICAgICByb3VuZDEoci5wcm9tZWRpbyksXG4gICAgICByb3VuZDEoci5wb2xpdGljYSksXG4gICAgICByb3VuZDEoci50b3RhbCksXG4gICAgXSk7XG4gIH1cbiAgY29uc3Qgd3MgPSBYTFNYLnV0aWxzLmFvYV90b19zaGVldChhb2EpO1xuICAvLyBBbmNob3MgZGUgY29sdW1uYVxuICB3c1snIWNvbHMnXSA9IFtcbiAgICB7IHdjaDogMTggfSxcbiAgICB7IHdjaDogMjQgfSxcbiAgICB7IHdjaDogMjQgfSxcbiAgICB7IHdjaDogMTQgfSxcbiAgICB7IHdjaDogMjAgfSxcbiAgICB7IHdjaDogMjAgfSxcbiAgICB7IHdjaDogMjIgfSxcbiAgICB7IHdjaDogMTIgfSxcbiAgXTtcbiAgY29uc3Qgd2IgPSBYTFNYLnV0aWxzLmJvb2tfbmV3KCk7XG4gIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQod2IsIHdzLCAnRk9SRUNBU1QnKTtcbiAgY29uc3QgaG95ID0gbmV3IERhdGUoKTtcbiAgY29uc3Qgc3RhbXAgPVxuICAgIGhveS5nZXRGdWxsWWVhcigpICtcbiAgICAnLScgK1xuICAgIFN0cmluZyhob3kuZ2V0TW9udGgoKSArIDEpLnBhZFN0YXJ0KDIsICcwJykgK1xuICAgICctJyArXG4gICAgU3RyaW5nKGhveS5nZXREYXRlKCkpLnBhZFN0YXJ0KDIsICcwJyk7XG4gIFhMU1gud3JpdGVGaWxlKHdiLCAnRm9yZWNhc3RfU2hpbWFub18nICsgc3RhbXAgKyAnLnhsc3gnKTtcbn07XG5cbi8vIFJlZnJlc2ggcHVibGljbyAocG9yIHNpIGVsIHVzZXIgbmVjZXNpdGEgcmUtZmV0Y2hlYXIgZWwgc25hcHNob3Qgc2luIGNlcnJhclxuLy8gZWwgbW9kYWwsIGVqOiBwYXNhcm9uIDMwIG1pbiB5IGVsIGNyb24gQlEgYWN0dWFsaXpvIGxhIGNvbGVjY2lvbikuXG53aW5kb3cucmVsb2FkRm9yZWNhc3RTbmFwc2hvdCA9IGFzeW5jIGZ1bmN0aW9uICgpIHtcbiAgX2ZvcmVjYXN0U25hcHNob3QgPSBudWxsO1xuICBhd2FpdCBfbG9hZFNuYXBzaG90KCk7XG4gIGlmIChfZm9yZWNhc3RTYWxlc1BsYW4pIHtcbiAgICBjb25zdCBob3kgPSBuZXcgRGF0ZSgpO1xuICAgIF9mb3JlY2FzdFJvd3MgPSBfY29tcHV0ZUZvcmVjYXN0Um93cyhfZm9yZWNhc3RTbmFwc2hvdCwgX2ZvcmVjYXN0U2FsZXNQbGFuLCBob3kpO1xuICAgIF9yZW5kZXJUYWJsZShfZm9yZWNhc3RSb3dzKTtcbiAgfVxufTtcbiJdLAogICJtYXBwaW5ncyI6ICI7OztBQVlBLE1BQU0sZ0JBQWdCO0FBQUEsSUFDcEIsS0FBSztBQUFBLElBQ0wsU0FBUztBQUFBLElBQ1QsS0FBSztBQUFBLElBQ0wsT0FBTztBQUFBLElBQ1AsS0FBSztBQUFBLElBQ0wsVUFBVTtBQUFBLElBQ1YsU0FBUztBQUFBLElBQ1QsS0FBSztBQUFBLElBQ0wsT0FBTztBQUFBLElBQ1AsT0FBTztBQUFBLElBQ1AsS0FBSztBQUFBLElBQ0wsT0FBTztBQUFBLElBQ1AsS0FBSztBQUFBLElBQ0wsT0FBTztBQUFBLElBQ1AsS0FBSztBQUFBLElBQ0wsTUFBTTtBQUFBLElBQ04sS0FBSztBQUFBLElBQ0wsTUFBTTtBQUFBLElBQ04sT0FBTztBQUFBLElBQ1AsS0FBSztBQUFBLElBQ0wsTUFBTTtBQUFBLElBQ04sT0FBTztBQUFBLElBQ1AsS0FBSztBQUFBLElBQ0wsUUFBUTtBQUFBLElBQ1IsS0FBSztBQUFBLElBQ0wsUUFBUTtBQUFBLElBQ1IsS0FBSztBQUFBLElBQ0wsTUFBTTtBQUFBLElBQ04sV0FBVztBQUFBLElBQ1gsWUFBWTtBQUFBLElBQ1os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
