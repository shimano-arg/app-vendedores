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
  var _forecastStatDocs = null;
  var _forecastStatMeta = null;
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
    const tabsBar = `<div id="forecast-tabs-bar" style="display:flex;gap:0;background:#1e293b;padding:0 18px;border-bottom:1px solid var(--border-subtle)"><button data-tab="sales-plans" onclick="switchForecastTab('sales-plans')" class="forecast-tab" style="padding:10px 16px;background:transparent;color:#fff;border:none;border-bottom:3px solid #0d9488;cursor:pointer;font-weight:700;font-size:12px;letter-spacing:.4px;text-transform:uppercase">Sales Plans</button><button data-tab="stat" onclick="switchForecastTab('stat')" class="forecast-tab" style="padding:10px 16px;background:transparent;color:#94a3b8;border:none;border-bottom:3px solid transparent;cursor:pointer;font-weight:600;font-size:12px;letter-spacing:.4px;text-transform:uppercase">Forecast Estad\xEDstico</button><button data-tab="legacy" onclick="switchForecastTab('legacy')" class="forecast-tab" style="padding:10px 16px;background:transparent;color:#94a3b8;border:none;border-bottom:3px solid transparent;cursor:pointer;font-weight:600;font-size:12px;letter-spacing:.4px;text-transform:uppercase">Legacy (6m)</button></div>`;
    const tabSalesPlans = '<div id="forecast-tab-sales-plans" style="flex:1;overflow:auto"></div>';
    const tabStat = '<div id="forecast-tab-stat" style="flex:1;overflow:auto;display:none"></div>';
    const legacyBar = '<div style="padding:12px 18px;background:var(--bg-secondary);border-bottom:1px solid var(--border-subtle);display:flex;flex-wrap:wrap;gap:14px;align-items:center"><label style="display:inline-flex;align-items:center;gap:8px;padding:8px 12px;background:#0d9488;color:#fff;border-radius:6px;font-weight:700;font-size:12px;cursor:pointer"><span>Cargar Sales Plan (.xlsx)</span><input type="file" accept=".xlsx,.xls" style="display:none" onchange="onForecastSalesPlanFile(event)"/></label><div id="forecast-hint" style="font-size:11px;color:var(--text-muted);max-width:520px">Formato legacy: primera columna <b>SKU</b>, luego 6 columnas con las unidades pedidas mes a mes.</div><button id="forecast-export-btn" onclick="exportForecastExcel()" disabled style="padding:8px 14px;background:var(--color-success);color:#fff;border:none;border-radius:6px;font-weight:700;cursor:pointer;opacity:.5">Exportar Excel</button><div id="forecast-stats" style="margin-left:auto;font-size:11px;color:var(--text-secondary);font-weight:600"></div></div>';
    const legacyBody = '<div id="forecast-body" style="flex:1;overflow:auto;padding:0"><div style="padding:60px 20px;text-align:center;color:var(--text-muted);font-size:14px">Esperando archivo Sales Plan...</div></div>';
    const tabLegacy = '<div id="forecast-tab-legacy" style="flex:1;overflow:hidden;flex-direction:column;display:none">' + legacyBar + legacyBody + "</div>";
    return modalOuter + header + tabsBar + tabSalesPlans + tabStat + tabLegacy + "</div>";
  }
  window.switchForecastTab = function(tabId) {
    _forecastActiveTab = tabId;
    const sp = document.getElementById("forecast-tab-sales-plans");
    const st = document.getElementById("forecast-tab-stat");
    const lg = document.getElementById("forecast-tab-legacy");
    if (sp) sp.style.display = tabId === "sales-plans" ? "block" : "none";
    if (st) st.style.display = tabId === "stat" ? "block" : "none";
    if (lg) lg.style.display = tabId === "legacy" ? "flex" : "none";
    const btns = document.querySelectorAll("#forecast-tabs-bar .forecast-tab");
    btns.forEach((b) => {
      const active = b.getAttribute("data-tab") === tabId;
      b.style.color = active ? "#fff" : "#94a3b8";
      b.style.borderBottomColor = active ? "#0d9488" : "transparent";
      b.style.fontWeight = active ? "700" : "600";
    });
    if (tabId === "stat" && !_forecastStatDocs) {
      _loadForecastOutput().then(_renderForecastStatTab).catch((e) => {
        console.error("[FORECAST stat] load fail", e);
        const c = document.getElementById("forecast-tab-stat");
        if (c)
          c.innerHTML = '<div style="padding:60px 20px;text-align:center;color:#dc2626">Error cargando forecast_output: ' + escapeHtmlSafe(e.message || String(e)) + "</div>";
      });
    }
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
  async function _loadForecastOutput() {
    if (!window.fbDb) throw new Error("Firestore no inicializado");
    const [snap, metaDoc] = await Promise.all([
      window.fbDb.collection("forecast_output").get(),
      window.fbDb.collection("forecast_output_meta").doc("current").get()
    ]);
    const docs = [];
    snap.forEach((d) => docs.push(Object.assign({ id: d.id }, d.data())));
    docs.sort((a, b) => {
      const wa = a.metrics && a.metrics.wape || 999;
      const wb = b.metrics && b.metrics.wape || 999;
      return wa - wb;
    });
    _forecastStatDocs = docs;
    _forecastStatMeta = metaDoc.exists ? metaDoc.data() : null;
    return docs;
  }
  function _wapeBadgeColor(w) {
    if (w == null) return "#64748b";
    if (w < 0.3) return "#16a34a";
    if (w < 0.5) return "#84cc16";
    if (w < 0.7) return "#eab308";
    if (w < 1) return "#f97316";
    return "#dc2626";
  }
  function _fmtNum(n) {
    if (n == null || !Number.isFinite(Number(n))) return "\u2014";
    return Number(n).toLocaleString("es-AR", { maximumFractionDigits: 0 });
  }
  function _fmtWape(w) {
    if (w == null || !Number.isFinite(Number(w))) return "\u2014";
    return (Number(w) * 100).toFixed(0) + "%";
  }
  function _fmtDsShort(iso) {
    try {
      const [y, m] = iso.split("-").map(Number);
      const names = [
        "ene",
        "feb",
        "mar",
        "abr",
        "may",
        "jun",
        "jul",
        "ago",
        "sep",
        "oct",
        "nov",
        "dic"
      ];
      return names[m - 1] + " " + String(y).slice(-2);
    } catch {
      return iso;
    }
  }
  function _renderForecastStatTab() {
    const cont = document.getElementById("forecast-tab-stat");
    if (!cont) return;
    const docs = _forecastStatDocs || [];
    const meta = _forecastStatMeta || {};
    const resumen = meta.resumen || {};
    if (!docs.length) {
      cont.innerHTML = '<div style="padding:60px 20px;text-align:center;color:var(--text-muted)">No hay forecast_output publicado.<br><br>Correr <code>python scripts/forecast/train_prod.py && python scripts/forecast/publish_to_firestore.py</code>.</div>';
      return;
    }
    const monthsIso = (docs[0].forecast || []).map((f) => f.ds);
    const monthHeaders = monthsIso.map(_fmtDsShort);
    const generated = meta.generatedAt ? new Date(meta.generatedAt).toLocaleString("es-AR", {
      day: "2-digit",
      month: "short",
      year: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    }) : "\u2014";
    const wapeMed = resumen.wape_mediano_best_per_series != null ? _fmtWape(resumen.wape_mediano_best_per_series) : "\u2014";
    const nSubs = resumen.n_subfamilias || docs.length;
    const nLt05 = resumen.n_series_wape_lt_0_5 != null ? resumen.n_series_wape_lt_0_5 + "/" + nSubs : "\u2014";
    const nLt03 = resumen.n_series_wape_lt_0_3 != null ? resumen.n_series_wape_lt_0_3 + "/" + nSubs : "\u2014";
    const banner = '<div style="margin-bottom:14px;padding:12px 14px;background:var(--bg-secondary);border-left:3px solid #0d9488;border-radius:6px;font-size:12px;color:var(--text-secondary);line-height:1.5;display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px"><div><div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.4px">WAPE mediano</div><div style="font-size:20px;font-weight:800;color:var(--text-primary)">' + wapeMed + '</div></div><div><div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.4px">Subfamilias</div><div style="font-size:20px;font-weight:800;color:var(--text-primary)">' + nSubs + '</div></div><div><div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.4px">WAPE &lt; 30% (excelente)</div><div style="font-size:20px;font-weight:800;color:#16a34a">' + nLt03 + '</div></div><div><div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.4px">WAPE &lt; 50% (bueno)</div><div style="font-size:20px;font-weight:800;color:#84cc16">' + nLt05 + '</div></div><div><div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.4px">\xDAltima corrida</div><div style="font-size:13px;font-weight:600;color:var(--text-primary);margin-top:4px">' + escapeHtmlSafe(generated) + "</div></div></div>";
    const rowsHtml = docs.map((d) => {
      const wape = d.metrics && d.metrics.wape != null ? d.metrics.wape : null;
      const bestModel = d.bestModel || "\u2014";
      const forecastMap = {};
      (d.forecast || []).forEach((f) => {
        forecastMap[f.ds] = f.y_hat;
      });
      const monthCells = monthsIso.map(
        (ds) => '<td style="padding:8px 10px;text-align:right;font-variant-numeric:tabular-nums;font-weight:600;color:var(--text-primary)">' + _fmtNum(forecastMap[ds]) + "</td>"
      ).join("");
      const total7 = (d.forecast || []).reduce((s, f) => s + (Number(f.y_hat) || 0), 0);
      return `<tr onclick="openForecastStatDetail('` + escapeHtmlSafe(d.id) + `')" style="cursor:pointer;border-bottom:1px solid var(--border-subtle)" onmouseover="this.style.background='var(--bg-secondary)'" onmouseout="this.style.background='transparent'"><td style="padding:8px 10px;font-weight:700;color:var(--text-primary)">` + escapeHtmlSafe(d.subfamilia || d.id) + '</td><td style="padding:8px 10px;font-size:11px;color:var(--text-secondary)">' + escapeHtmlSafe(bestModel) + '</td><td style="padding:8px 10px;text-align:center"><span style="display:inline-block;padding:3px 8px;border-radius:12px;background:' + _wapeBadgeColor(wape) + ';color:#fff;font-size:11px;font-weight:700">' + _fmtWape(wape) + "</span></td>" + monthCells + '<td style="padding:8px 10px;text-align:right;font-variant-numeric:tabular-nums;font-weight:700;color:#0d9488;background:var(--bg-secondary)">' + _fmtNum(total7) + "</td></tr>";
    }).join("");
    const monthHeadersHtml = monthHeaders.map(
      (m) => '<th style="padding:8px 10px;text-align:right;font-size:10px;text-transform:uppercase;letter-spacing:.4px;color:#94a3b8">' + escapeHtmlSafe(m) + "</th>"
    ).join("");
    const table = '<div style="overflow:auto;border:1px solid var(--border-subtle);border-radius:8px"><table style="width:100%;border-collapse:collapse;font-size:12px"><thead style="background:#0f172a;color:#fff"><tr><th style="padding:8px 10px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.4px">Subfamilia</th><th style="padding:8px 10px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.4px">Modelo</th><th style="padding:8px 10px;text-align:center;font-size:10px;text-transform:uppercase;letter-spacing:.4px">WAPE</th>' + monthHeadersHtml + '<th style="padding:8px 10px;text-align:right;font-size:10px;text-transform:uppercase;letter-spacing:.4px;background:#134e4a">Total 7m</th></tr></thead><tbody>' + rowsHtml + "</tbody></table></div>";
    const footer = '<div style="margin-top:12px;font-size:11px;color:var(--text-muted);line-height:1.5"><b>C\xF3mo leer</b>: WAPE (Weighted Absolute Percentage Error) mide el error del modelo relativo al total real: &lt;30% excelente, 30-50% bueno, 50-70% aceptable, &gt;70% pobre. Click en fila para detalle + gr\xE1fico. Se elige el modelo con menor WAPE por serie tras backtest rolling-origin (h=2, ventanas=3).</div>';
    cont.innerHTML = '<div style="padding:18px">' + banner + table + footer + "</div>";
  }
  function _buildForecastChartSvg(doc) {
    const fc = doc.forecast || [];
    if (!fc.length)
      return '<div style="padding:30px;text-align:center;color:var(--text-muted)">Sin datos de forecast</div>';
    const W = 640, H = 260;
    const padL = 50, padR = 20, padT = 20, padB = 40;
    const innerW = W - padL - padR;
    const innerH = H - padT - padB;
    const maxY = Math.max(1, ...fc.map((f) => Number(f.hi80) || Number(f.y_hat) || 0));
    const minY = 0;
    const scaleX = (i) => padL + innerW * i / Math.max(1, fc.length - 1);
    const scaleY = (v) => padT + innerH - innerH * (v - minY) / (maxY - minY);
    const yTicks = [0, 0.25, 0.5, 0.75, 1].map((r) => {
      const val = minY + r * (maxY - minY);
      const yy = scaleY(val);
      return '<line x1="' + padL + '" y1="' + yy + '" x2="' + (W - padR) + '" y2="' + yy + '" stroke="#e2e8f0" stroke-width="1"/><text x="' + (padL - 6) + '" y="' + (yy + 4) + '" text-anchor="end" font-size="10" fill="#64748b">' + _fmtNum(val) + "</text>";
    }).join("");
    const xLabels = fc.map((f, i) => {
      const xx = scaleX(i);
      return '<text x="' + xx + '" y="' + (H - padB + 15) + '" text-anchor="middle" font-size="10" fill="#64748b">' + _fmtDsShort(f.ds) + "</text>";
    }).join("");
    const bandPoints = fc.map((f, i) => scaleX(i) + "," + scaleY(Number(f.hi80) || 0)).join(" ") + " " + fc.slice().reverse().map((f, i) => scaleX(fc.length - 1 - i) + "," + scaleY(Number(f.lo80) || 0)).join(" ");
    const band = '<polygon points="' + bandPoints + '" fill="#0d948833" stroke="none"/>';
    const linePoints = fc.map((f, i) => scaleX(i) + "," + scaleY(Number(f.y_hat) || 0)).join(" ");
    const line = '<polyline points="' + linePoints + '" fill="none" stroke="#0d9488" stroke-width="2.5" stroke-linejoin="round"/>';
    const points = fc.map(
      (f, i) => '<circle cx="' + scaleX(i) + '" cy="' + scaleY(Number(f.y_hat) || 0) + '" r="4" fill="#0d9488" stroke="#fff" stroke-width="2"/>'
    ).join("");
    const valueLabels = fc.map((f, i) => {
      const xx = scaleX(i);
      const yy = scaleY(Number(f.y_hat) || 0);
      return '<text x="' + xx + '" y="' + (yy - 8) + '" text-anchor="middle" font-size="10" font-weight="700" fill="#0f766e">' + _fmtNum(f.y_hat) + "</text>";
    }).join("");
    const svg = '<svg viewBox="0 0 ' + W + " " + H + '" style="width:100%;max-width:800px;height:auto"><rect x="0" y="0" width="' + W + '" height="' + H + '" fill="#fff"/>' + yTicks + xLabels + band + line + points + valueLabels + "</svg>";
    return svg;
  }
  window.openForecastStatDetail = function(subId) {
    if (!_forecastStatDocs) return;
    const doc = _forecastStatDocs.find((d) => d.id === subId);
    if (!doc) {
      alert("No se encontr\xF3 detalle de " + subId);
      return;
    }
    const existing = document.getElementById("forecast-stat-detail");
    if (existing) existing.remove();
    const el = document.createElement("div");
    el.id = "forecast-stat-detail";
    el.style.cssText = "position:fixed;inset:0;background:rgba(15,23,42,.65);z-index:2100;display:flex;align-items:center;justify-content:center;padding:2vh";
    el.onclick = (ev) => {
      if (ev.target === el) el.remove();
    };
    const wape = doc.metrics && doc.metrics.wape;
    const bias = doc.metrics && doc.metrics.bias;
    const mae = doc.metrics && doc.metrics.mae;
    const rmse = doc.metrics && doc.metrics.rmse;
    const bestModel = doc.bestModel || "\u2014";
    const versionId = doc.versionId || "\u2014";
    const svgHtml = _buildForecastChartSvg(doc);
    const metricsHtml = '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;margin:14px 0"><div style="padding:10px;background:var(--bg-secondary);border-radius:6px"><div style="font-size:10px;color:var(--text-muted);text-transform:uppercase">Modelo</div><div style="font-weight:700">' + escapeHtmlSafe(bestModel) + '</div></div><div style="padding:10px;background:var(--bg-secondary);border-radius:6px"><div style="font-size:10px;color:var(--text-muted);text-transform:uppercase">WAPE</div><div style="font-weight:700;color:' + _wapeBadgeColor(wape) + '">' + _fmtWape(wape) + '</div></div><div style="padding:10px;background:var(--bg-secondary);border-radius:6px"><div style="font-size:10px;color:var(--text-muted);text-transform:uppercase">Bias</div><div style="font-weight:700">' + (bias != null ? (bias * 100).toFixed(0) + "%" : "\u2014") + '</div></div><div style="padding:10px;background:var(--bg-secondary);border-radius:6px"><div style="font-size:10px;color:var(--text-muted);text-transform:uppercase">MAE</div><div style="font-weight:700">' + _fmtNum(mae) + '</div></div><div style="padding:10px;background:var(--bg-secondary);border-radius:6px"><div style="font-size:10px;color:var(--text-muted);text-transform:uppercase">RMSE</div><div style="font-weight:700">' + _fmtNum(rmse) + "</div></div></div>";
    const tableHtml = '<table style="width:100%;font-size:12px;border-collapse:collapse;margin-top:10px"><thead style="background:#0f172a;color:#fff"><tr><th style="padding:6px 10px;text-align:left">Mes</th><th style="padding:6px 10px;text-align:right">Forecast</th><th style="padding:6px 10px;text-align:right">IC 80% bajo</th><th style="padding:6px 10px;text-align:right">IC 80% alto</th></tr></thead><tbody>' + (doc.forecast || []).map(
      (f) => '<tr style="border-bottom:1px solid var(--border-subtle)"><td style="padding:6px 10px">' + escapeHtmlSafe(_fmtDsShort(f.ds)) + '</td><td style="padding:6px 10px;text-align:right;font-weight:700">' + _fmtNum(f.y_hat) + '</td><td style="padding:6px 10px;text-align:right;color:var(--text-muted)">' + _fmtNum(f.lo80) + '</td><td style="padding:6px 10px;text-align:right;color:var(--text-muted)">' + _fmtNum(f.hi80) + "</td></tr>"
    ).join("") + "</tbody></table>";
    const content = '<div style="background:var(--bg-elevated);border-radius:12px;padding:24px;max-width:820px;width:100%;max-height:96vh;overflow:auto;box-shadow:0 20px 60px rgba(0,0,0,.4)"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px"><div><div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.4px">Subfamilia</div><div style="font-size:22px;font-weight:800">' + escapeHtmlSafe(doc.subfamilia || doc.id) + `</div></div><button onclick="document.getElementById('forecast-stat-detail').remove()" style="background:transparent;border:1px solid var(--border-subtle);border-radius:6px;padding:6px 12px;cursor:pointer;font-weight:700">Cerrar</button></div>` + metricsHtml + '<div style="background:#fff;padding:8px;border-radius:8px;margin-top:10px;border:1px solid var(--border-subtle)">' + svgHtml + "</div>" + tableHtml + '<div style="margin-top:14px;font-size:11px;color:var(--text-muted)">Version: <code>' + escapeHtmlSafe(versionId) + "</code> \xB7 Approach: " + escapeHtmlSafe((doc.config || {}).approach || "\u2014") + "</div></div>";
    el.innerHTML = content;
    document.body.appendChild(el);
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL3B1cmUvc2FsZXMtcGxhbi1wYXJzZXIuanMiLCAiLi4vc3JjL2RvbWFpbnMvZm9yZWNhc3QuanMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbIi8vIEB0cy1ub2NoZWNrXHJcbi8vIFB1cmU6IHBhcnNlYSB1biBzaGVldCBTYWxlcyBQbGFuIChmb3JtYXRvIFNVUi9TQVIgZGUgU2hpbWFubykgYSBlc3RydWN0dXJhXHJcbi8vIG5vcm1hbGl6YWRhIHsgc2t1LCBkZXNjcmlwdGlvbiwgbW9xLCBtb250aHM6IHsnWVlZWS1NTSc6IE59IH0uXHJcbi8vIFNpbiBkZXBlbmRlbmNpYXMgXHUyMDE0IHJlY2liZSBlbCBzaGVldCB5YSBkZXNlcmlhbGl6YWRvIHBvciBTaGVldEpTXHJcbi8vIChYTFNYLnV0aWxzLnNoZWV0X3RvX2pzb24oc2hlZXQsIHtoZWFkZXI6MSwgZGVmdmFsOicnfSkpLlxyXG4vLyBUZXN0ZWFibGUgZW4gdml0ZXN0IHNpbiBjYXJnYXIgWExTWC5cclxuLy9cclxuLy8gQ29udGV4dG86IGxvcyBTYWxlcyBQbGFucyBkZSBTaGltYW5vIHZpZW5lbiBjb24gaGVhZGVycyBjb21vXHJcbi8vIFwiU0tVIENvZGUvUGFydCBOb1wiLCBcIkRlc2NyaXB0aW9uXCIsIFwiTU9RIDEyIG1vbnRoc1wiIHkgY29sdW1uYXMgZGUgbWVzZXNcclxuLy8gdGlwbyBcIkphbiAyMDI3XCIsIFwiTWF5IDIwMjdcIiAoYSB2ZWNlcyBjb24gYVx1MDBGMW8gZW4gdW5hIGZpbGEgYXJyaWJhIHkgZWwgbWVzXHJcbi8vIGVuIGxhIGZpbGEgaGVhZGVyKS4gRXN0YSBmbiB0b2xlcmEgYW1ib3MgbGF5b3V0cy5cclxuXHJcbmNvbnN0IE1PTlRIX0FMSUFTRVMgPSB7XHJcbiAgamFuOiAxLFxyXG4gIGphbnVhcnk6IDEsXHJcbiAgZW5lOiAxLFxyXG4gIGVuZXJvOiAxLFxyXG4gIGZlYjogMixcclxuICBmZWJydWFyeTogMixcclxuICBmZWJyZXJvOiAyLFxyXG4gIG1hcjogMyxcclxuICBtYXJjaDogMyxcclxuICBtYXJ6bzogMyxcclxuICBhcHI6IDQsXHJcbiAgYXByaWw6IDQsXHJcbiAgYWJyOiA0LFxyXG4gIGFicmlsOiA0LFxyXG4gIG1heTogNSxcclxuICBtYXlvOiA1LFxyXG4gIGp1bjogNixcclxuICBqdW5lOiA2LFxyXG4gIGp1bmlvOiA2LFxyXG4gIGp1bDogNyxcclxuICBqdWx5OiA3LFxyXG4gIGp1bGlvOiA3LFxyXG4gIGF1ZzogOCxcclxuICBhdWd1c3Q6IDgsXHJcbiAgYWdvOiA4LFxyXG4gIGFnb3N0bzogOCxcclxuICBzZXA6IDksXHJcbiAgc2VwdDogOSxcclxuICBzZXB0ZW1iZXI6IDksXHJcbiAgc2VwdGllbWJyZTogOSxcclxuICBvY3Q6IDEwLFxyXG4gIG9jdG9iZXI6IDEwLFxyXG4gIG9jdHVicmU6IDEwLFxyXG4gIG5vdjogMTEsXHJcbiAgbm92ZW1iZXI6IDExLFxyXG4gIG5vdmllbWJyZTogMTEsXHJcbiAgZGVjOiAxMixcclxuICBkZWNlbWJlcjogMTIsXHJcbiAgZGljOiAxMixcclxuICBkaWNpZW1icmU6IDEyLFxyXG59O1xyXG5cclxuLy8gTm9ybWFsaXphIGxhYmVscyBkZSBtZXNlcyBhICdZWVlZLU1NJy4gUmV0b3JuYSBudWxsIHNpIG5vIG1hdGNoZWEuXHJcbi8vIEZvcm1hdG9zIHNvcG9ydGFkb3M6IFwiSmFuIDIwMjdcIiwgXCJFbmUtMjdcIiwgXCJKYW4vMjAyN1wiLCBcIk1heTI3XCIsXHJcbi8vIFwiMjAyNy0wMVwiLCBcIjAxLzIwMjdcIiwgXCJKYW4uMjAyN1wiLlxyXG5mdW5jdGlvbiBub3JtYWxpemVNb250aExhYmVsKGxhYmVsKSB7XHJcbiAgaWYgKGxhYmVsID09IG51bGwpIHJldHVybiBudWxsO1xyXG4gIGNvbnN0IHMgPSBTdHJpbmcobGFiZWwpLnRyaW0oKS50b0xvd2VyQ2FzZSgpO1xyXG4gIGlmICghcykgcmV0dXJuIG51bGw7XHJcbiAgbGV0IG07XHJcbiAgLy8gXCJqYW4gMjAyN1wiIHwgXCJqYW4tMjdcIiB8IFwiZW5lLzIwMjdcIiB8IFwibWF5MjdcIiB8IFwibWF5LjIwMjdcIlxyXG4gIG0gPSBzLm1hdGNoKC9eKFthLXpcdTAwRTFcdTAwRTlcdTAwRURcdTAwRjNcdTAwRkFdezMsMTB9KVtcXHNcXC0vLl9dKihcXGR7Miw0fSkkLyk7XHJcbiAgaWYgKG0pIHtcclxuICAgIGNvbnN0IG1vbiA9IE1PTlRIX0FMSUFTRVNbbVsxXV0gfHwgTU9OVEhfQUxJQVNFU1ttWzFdLnNsaWNlKDAsIDMpXTtcclxuICAgIGlmIChtb24pIHtcclxuICAgICAgbGV0IHkgPSBwYXJzZUludChtWzJdLCAxMCk7XHJcbiAgICAgIGlmICh5IDwgMTAwKSB5ID0gMjAwMCArIHk7XHJcbiAgICAgIHJldHVybiBTdHJpbmcoeSkucGFkU3RhcnQoNCwgJzAnKSArICctJyArIFN0cmluZyhtb24pLnBhZFN0YXJ0KDIsICcwJyk7XHJcbiAgICB9XHJcbiAgfVxyXG4gIC8vIFwiMjAyNy0wMVwiIHwgXCIyMDI3LzAxXCJcclxuICBtID0gcy5tYXRjaCgvXihcXGR7NH0pWy0vXShcXGR7MSwyfSkkLyk7XHJcbiAgaWYgKG0pIHtcclxuICAgIGNvbnN0IHkgPSBwYXJzZUludChtWzFdLCAxMCk7XHJcbiAgICBjb25zdCBtb24gPSBwYXJzZUludChtWzJdLCAxMCk7XHJcbiAgICBpZiAobW9uID49IDEgJiYgbW9uIDw9IDEyKVxyXG4gICAgICByZXR1cm4gU3RyaW5nKHkpLnBhZFN0YXJ0KDQsICcwJykgKyAnLScgKyBTdHJpbmcobW9uKS5wYWRTdGFydCgyLCAnMCcpO1xyXG4gIH1cclxuICAvLyBcIjAxLzIwMjdcIiB8IFwiMDEtMjAyN1wiXHJcbiAgbSA9IHMubWF0Y2goL14oXFxkezEsMn0pWy0vXShcXGR7NH0pJC8pO1xyXG4gIGlmIChtKSB7XHJcbiAgICBjb25zdCBtb24gPSBwYXJzZUludChtWzFdLCAxMCk7XHJcbiAgICBjb25zdCB5ID0gcGFyc2VJbnQobVsyXSwgMTApO1xyXG4gICAgaWYgKG1vbiA+PSAxICYmIG1vbiA8PSAxMilcclxuICAgICAgcmV0dXJuIFN0cmluZyh5KS5wYWRTdGFydCg0LCAnMCcpICsgJy0nICsgU3RyaW5nKG1vbikucGFkU3RhcnQoMiwgJzAnKTtcclxuICB9XHJcbiAgcmV0dXJuIG51bGw7XHJcbn1cclxuXHJcbi8vIEJ1c2NhIGxhIGZpbGEgaGVhZGVyICgwLWJhc2VkKS4gRXNjYW5lYSBsYXMgcHJpbWVyYXMgMzAgZmlsYXMuXHJcbmZ1bmN0aW9uIGZpbmRIZWFkZXJSb3cocm93cykge1xyXG4gIGNvbnN0IEhFQURFUl9NQVJLRVJTID0gW1xyXG4gICAgJ3NrdSBjb2RlL3BhcnQgbm8nLFxyXG4gICAgJ3NrdSBjb2RlJyxcclxuICAgICdza3UnLFxyXG4gICAgJ3BhcnQgbm8nLFxyXG4gICAgJ3BhcnQgbnVtYmVyJyxcclxuICAgICdpdGVtY29kZScsXHJcbiAgICAnaXRlbSBjb2RlJyxcclxuICAgICdjb2RpZ28nLFxyXG4gICAgJ2NcdTAwRjNkaWdvJyxcclxuICBdO1xyXG4gIGZvciAobGV0IGkgPSAwOyBpIDwgTWF0aC5taW4ocm93cy5sZW5ndGgsIDMwKTsgaSsrKSB7XHJcbiAgICBjb25zdCByb3cgPSByb3dzW2ldIHx8IFtdO1xyXG4gICAgZm9yIChjb25zdCBjZWxsIG9mIHJvdykge1xyXG4gICAgICBjb25zdCBzID0gU3RyaW5nKGNlbGwgPT0gbnVsbCA/ICcnIDogY2VsbClcclxuICAgICAgICAudHJpbSgpXHJcbiAgICAgICAgLnRvTG93ZXJDYXNlKCk7XHJcbiAgICAgIGlmIChIRUFERVJfTUFSS0VSUy5pbmRleE9mKHMpID49IDApIHJldHVybiBpO1xyXG4gICAgfVxyXG4gIH1cclxuICByZXR1cm4gLTE7XHJcbn1cclxuXHJcbi8vIERldGVjdGEgXHUwMEVEbmRpY2VzIGRlIGNvbHVtbmFzIHkgbWVzZXMuIGBoaW50Um93QWJvdmVgIHBlcm1pdGUgY29tYmluYXIgYVx1MDBGMW8vbWVzXHJcbi8vIGN1YW5kbyBlbCBoZWFkZXIgZXMgbXVsdGktcm93IChhXHUwMEYxbyBhcnJpYmEsIG1lcyBhYmFqbyBvIHZpY2V2ZXJzYSkuXHJcbmZ1bmN0aW9uIGRldGVjdENvbHVtbnMoaGVhZGVyUm93LCBoaW50Um93QWJvdmUpIHtcclxuICBsZXQgc2t1SWR4ID0gLTE7XHJcbiAgbGV0IGRlc2NJZHggPSAtMTtcclxuICBsZXQgbW9xSWR4ID0gLTE7XHJcbiAgY29uc3QgbW9udGhDb2x1bW5zID0gW107XHJcbiAgY29uc3QgZGV0ZWN0ZWRNb250aHNTZXQgPSBuZXcgU2V0KCk7XHJcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBoZWFkZXJSb3cubGVuZ3RoOyBpKyspIHtcclxuICAgIGNvbnN0IHJhdyA9IFN0cmluZyhoZWFkZXJSb3dbaV0gPT0gbnVsbCA/ICcnIDogaGVhZGVyUm93W2ldKS50cmltKCk7XHJcbiAgICBjb25zdCBzID0gcmF3LnRvTG93ZXJDYXNlKCk7XHJcbiAgICBpZiAoXHJcbiAgICAgIHNrdUlkeCA8IDAgJiZcclxuICAgICAgKHMgPT09ICdza3UgY29kZS9wYXJ0IG5vJyB8fFxyXG4gICAgICAgIHMgPT09ICdza3UgY29kZScgfHxcclxuICAgICAgICBzID09PSAnc2t1JyB8fFxyXG4gICAgICAgIHMgPT09ICdwYXJ0IG5vJyB8fFxyXG4gICAgICAgIHMgPT09ICdwYXJ0IG51bWJlcicgfHxcclxuICAgICAgICBzID09PSAnaXRlbWNvZGUnIHx8XHJcbiAgICAgICAgcyA9PT0gJ2l0ZW0gY29kZScgfHxcclxuICAgICAgICBzID09PSAnY29kaWdvJyB8fFxyXG4gICAgICAgIHMgPT09ICdjXHUwMEYzZGlnbycpXHJcbiAgICApIHtcclxuICAgICAgc2t1SWR4ID0gaTtcclxuICAgICAgY29udGludWU7XHJcbiAgICB9XHJcbiAgICBpZiAoXHJcbiAgICAgIGRlc2NJZHggPCAwICYmXHJcbiAgICAgIChzID09PSAnZGVzY3JpcHRpb24nIHx8XHJcbiAgICAgICAgcyA9PT0gJ2Rlc2NyaXBjaW9uJyB8fFxyXG4gICAgICAgIHMgPT09ICdkZXNjcmlwY2lcdTAwRjNuJyB8fFxyXG4gICAgICAgIHMgPT09ICdpdGVtIG5hbWUnIHx8XHJcbiAgICAgICAgcyA9PT0gJ2l0ZW1uYW1lJylcclxuICAgICkge1xyXG4gICAgICBkZXNjSWR4ID0gaTtcclxuICAgICAgY29udGludWU7XHJcbiAgICB9XHJcbiAgICBpZiAobW9xSWR4IDwgMCAmJiAocyA9PT0gJ21vcSAxMiBtb250aHMnIHx8IHMgPT09ICdtb3EnIHx8IHMuaW5kZXhPZignbW9xJykgPT09IDApKSB7XHJcbiAgICAgIG1vcUlkeCA9IGk7XHJcbiAgICAgIGNvbnRpbnVlO1xyXG4gICAgfVxyXG4gICAgLy8gVHJ5IGRpcmVjdCBtb250aCBwYXJzZVxyXG4gICAgbGV0IG1vbnRoS2V5ID0gbm9ybWFsaXplTW9udGhMYWJlbChyYXcpO1xyXG4gICAgaWYgKCFtb250aEtleSAmJiBoaW50Um93QWJvdmUgJiYgaGludFJvd0Fib3ZlW2ldICE9IG51bGwpIHtcclxuICAgICAgY29uc3QgaGludCA9IFN0cmluZyhoaW50Um93QWJvdmVbaV0pLnRyaW0oKTtcclxuICAgICAgaWYgKGhpbnQpIHtcclxuICAgICAgICBtb250aEtleSA9IG5vcm1hbGl6ZU1vbnRoTGFiZWwocmF3ICsgJyAnICsgaGludCkgfHwgbm9ybWFsaXplTW9udGhMYWJlbChoaW50ICsgJyAnICsgcmF3KTtcclxuICAgICAgfVxyXG4gICAgfVxyXG4gICAgaWYgKG1vbnRoS2V5KSB7XHJcbiAgICAgIG1vbnRoQ29sdW1ucy5wdXNoKHsgY29sSWR4OiBpLCBtb250aEtleSB9KTtcclxuICAgICAgZGV0ZWN0ZWRNb250aHNTZXQuYWRkKG1vbnRoS2V5KTtcclxuICAgIH1cclxuICB9XHJcbiAgcmV0dXJuIHtcclxuICAgIHNrdUlkeCxcclxuICAgIGRlc2NJZHgsXHJcbiAgICBtb3FJZHgsXHJcbiAgICBtb250aENvbHVtbnMsXHJcbiAgICBkZXRlY3RlZE1vbnRoczogQXJyYXkuZnJvbShkZXRlY3RlZE1vbnRoc1NldCkuc29ydCgpLFxyXG4gIH07XHJcbn1cclxuXHJcbi8vIFB1YmxpYzogcGFyc2UgZnVsbCBzaGVldC4gVGhyb3dzIG9uIG1pc3NpbmcgU0tVIGNvbHVtbiAvIG1vbnRocy5cclxuZnVuY3Rpb24gcGFyc2VTYWxlc1BsYW5TaGVldChyb3dzKSB7XHJcbiAgaWYgKCFyb3dzIHx8ICFyb3dzLmxlbmd0aCkge1xyXG4gICAgY29uc3QgZXJyID0gbmV3IEVycm9yKCdFeGNlbCB2YWNpbycpO1xyXG4gICAgZXJyLmNvZGUgPSAnRU1QVFlfU0hFRVQnO1xyXG4gICAgdGhyb3cgZXJyO1xyXG4gIH1cclxuICBjb25zdCBoZWFkZXJJZHggPSBmaW5kSGVhZGVyUm93KHJvd3MpO1xyXG4gIGlmIChoZWFkZXJJZHggPCAwKSB7XHJcbiAgICBjb25zdCBlcnIgPSBuZXcgRXJyb3IoJ05vIHNlIGVuY29udHJvIGZpbGEgZGUgaGVhZGVycyAoYnVzY2FiYSBcIlNLVSBDb2RlL1BhcnQgTm9cIiBvIFwiU0tVXCIpJyk7XHJcbiAgICBlcnIuY29kZSA9ICdIRUFERVJfTk9UX0ZPVU5EJztcclxuICAgIHRocm93IGVycjtcclxuICB9XHJcbiAgY29uc3QgaGVhZGVyUm93ID0gcm93c1toZWFkZXJJZHhdIHx8IFtdO1xyXG4gIGNvbnN0IHJvd0Fib3ZlID0gaGVhZGVySWR4ID4gMCA/IHJvd3NbaGVhZGVySWR4IC0gMV0gfHwgW10gOiBudWxsO1xyXG4gIGNvbnN0IGNvbHMgPSBkZXRlY3RDb2x1bW5zKGhlYWRlclJvdywgcm93QWJvdmUpO1xyXG4gIGlmIChjb2xzLnNrdUlkeCA8IDApIHtcclxuICAgIGNvbnN0IGVyciA9IG5ldyBFcnJvcignTm8gc2UgZW5jb250cm8gY29sdW1uYSBTS1UgZW4gbGEgZmlsYSBoZWFkZXInKTtcclxuICAgIGVyci5jb2RlID0gJ1NLVV9DT0xfTUlTU0lORyc7XHJcbiAgICB0aHJvdyBlcnI7XHJcbiAgfVxyXG4gIGlmICghY29scy5tb250aENvbHVtbnMubGVuZ3RoKSB7XHJcbiAgICBjb25zdCBlcnIgPSBuZXcgRXJyb3IoXHJcbiAgICAgICdObyBzZSBkZXRlY3Rhcm9uIGNvbHVtbmFzIGRlIG1lc2VzIGVuIGVsIGhlYWRlciAoZWo6IFwiSmFuIDIwMjdcIiwgXCJNYXkgMjAyN1wiKSdcclxuICAgICk7XHJcbiAgICBlcnIuY29kZSA9ICdNT05USFNfTk9UX0ZPVU5EJztcclxuICAgIHRocm93IGVycjtcclxuICB9XHJcbiAgY29uc3QgcGFyc2VkUm93cyA9IFtdO1xyXG4gIGNvbnN0IHNlZW5Ta3UgPSBuZXcgU2V0KCk7XHJcbiAgZm9yIChsZXQgciA9IGhlYWRlcklkeCArIDE7IHIgPCByb3dzLmxlbmd0aDsgcisrKSB7XHJcbiAgICBjb25zdCByb3cgPSByb3dzW3JdIHx8IFtdO1xyXG4gICAgY29uc3Qgc2t1UmF3ID0gcm93W2NvbHMuc2t1SWR4XTtcclxuICAgIGlmIChza3VSYXcgPT0gbnVsbCB8fCBTdHJpbmcoc2t1UmF3KS50cmltKCkgPT09ICcnKSBjb250aW51ZTtcclxuICAgIGNvbnN0IHNrdSA9IFN0cmluZyhza3VSYXcpLnRyaW0oKTtcclxuICAgIGNvbnN0IHVwcGVyID0gc2t1LnRvVXBwZXJDYXNlKCk7XHJcbiAgICAvLyBTa2lwIGZpbGFzIFRPVEFMIC8gU1VNIC8gU1VCVE9UQUxcclxuICAgIGlmICh1cHBlciA9PT0gJ1RPVEFMJyB8fCB1cHBlciA9PT0gJ1NVTScgfHwgdXBwZXIgPT09ICdTVUJUT1RBTCcgfHwgdXBwZXIgPT09ICdUT1RBTEVTJylcclxuICAgICAgY29udGludWU7XHJcbiAgICBpZiAoc2VlblNrdS5oYXModXBwZXIpKSBjb250aW51ZTsgLy8gZGVkdXBlXHJcbiAgICBzZWVuU2t1LmFkZCh1cHBlcik7XHJcbiAgICBjb25zdCBkZXNjcmlwdGlvbiA9XHJcbiAgICAgIGNvbHMuZGVzY0lkeCA+PSAwID8gU3RyaW5nKHJvd1tjb2xzLmRlc2NJZHhdID09IG51bGwgPyAnJyA6IHJvd1tjb2xzLmRlc2NJZHhdKS50cmltKCkgOiAnJztcclxuICAgIGNvbnN0IG1vcVJhdyA9IGNvbHMubW9xSWR4ID49IDAgPyByb3dbY29scy5tb3FJZHhdIDogbnVsbDtcclxuICAgIGNvbnN0IG1vcU51bSA9IE51bWJlcihtb3FSYXcpO1xyXG4gICAgY29uc3QgbW9xID0gTnVtYmVyLmlzRmluaXRlKG1vcU51bSkgJiYgbW9xTnVtID4gMCA/IE1hdGgucm91bmQobW9xTnVtKSA6IDA7XHJcbiAgICBjb25zdCBtb250aHMgPSB7fTtcclxuICAgIGZvciAoY29uc3QgbWMgb2YgY29scy5tb250aENvbHVtbnMpIHtcclxuICAgICAgY29uc3QgdiA9IHJvd1ttYy5jb2xJZHhdO1xyXG4gICAgICBjb25zdCBuID0gTnVtYmVyKHYpO1xyXG4gICAgICBpZiAoTnVtYmVyLmlzRmluaXRlKG4pICYmIG4gPiAwKSB7XHJcbiAgICAgICAgbW9udGhzW21jLm1vbnRoS2V5XSA9IE1hdGgucm91bmQobik7XHJcbiAgICAgIH1cclxuICAgIH1cclxuICAgIHBhcnNlZFJvd3MucHVzaCh7IHNrdSwgZGVzY3JpcHRpb24sIG1vcSwgbW9udGhzIH0pO1xyXG4gIH1cclxuICByZXR1cm4ge1xyXG4gICAgaGVhZGVyUm93SW5kZXg6IGhlYWRlcklkeCxcclxuICAgIGRldGVjdGVkTW9udGhzOiBjb2xzLmRldGVjdGVkTW9udGhzLFxyXG4gICAgcm93c0NvdW50OiBwYXJzZWRSb3dzLmxlbmd0aCxcclxuICAgIHJvd3M6IHBhcnNlZFJvd3MsXHJcbiAgfTtcclxufVxyXG5cclxuLy8gVU1ELWlzaCBleHBvcnQ6IHBhcmEgdml0ZXN0IChtb2R1bGUuZXhwb3J0cykgeSBwYXJhIGJ1bmRsZSBicm93c2VyICh3aW5kb3cgZ2xvYmFsKS5cclxuaWYgKHR5cGVvZiBtb2R1bGUgIT09ICd1bmRlZmluZWQnICYmIG1vZHVsZS5leHBvcnRzKSB7XHJcbiAgbW9kdWxlLmV4cG9ydHMgPSB7IHBhcnNlU2FsZXNQbGFuU2hlZXQsIG5vcm1hbGl6ZU1vbnRoTGFiZWwsIGZpbmRIZWFkZXJSb3csIGRldGVjdENvbHVtbnMgfTtcclxufVxyXG5pZiAodHlwZW9mIHdpbmRvdyAhPT0gJ3VuZGVmaW5lZCcpIHtcclxuICB3aW5kb3cuU2FsZXNQbGFuUGFyc2VyID0ge1xyXG4gICAgcGFyc2VTYWxlc1BsYW5TaGVldCxcclxuICAgIG5vcm1hbGl6ZU1vbnRoTGFiZWwsXHJcbiAgICBmaW5kSGVhZGVyUm93LFxyXG4gICAgZGV0ZWN0Q29sdW1ucyxcclxuICB9O1xyXG59XHJcblxyXG5leHBvcnQgeyBkZXRlY3RDb2x1bW5zLCBmaW5kSGVhZGVyUm93LCBub3JtYWxpemVNb250aExhYmVsLCBwYXJzZVNhbGVzUGxhblNoZWV0IH07XHJcbiIsICIvLyBAdHMtbm9jaGVja1xuLy8gdjEwOTgrIEZhc2UgMTogaW1wb3J0IGRlbCBwYXJzZXIgcHVyby4gRWwgbVx1MDBGM2R1bG8gaGFjZSBgd2luZG93LlNhbGVzUGxhblBhcnNlcmBcbi8vIGNvbW8gc2lkZS1lZmZlY3QgeSB0YW1iaVx1MDBFOW4gZXhwb3J0YSBsYXMgZm5zIG5vbWJyYWRhczsgdXNhbW9zIHNpZGUtZWZmZWN0XG4vLyBwb3JxdWUgZm9yZWNhc3QuanMgY29ycmUgZW4gZWwgY2h1bmsgbGF6eSB5IHdpbmRvdyB5YSBlc3RcdTAwRTEgZGlzcG9uaWJsZS5cbmltcG9ydCAnLi4vcHVyZS9zYWxlcy1wbGFuLXBhcnNlci5qcyc7XG5cbi8vIEdsb2JhbHMgbGVpZG9zIGRlbCBlbnRvcm5vIChkZWNsYXJhZG9zIGVuIGluZGV4Lmh0bWwgaW5saW5lIG8gYnVuZGxlIHByZXZpbyk6XG4vLyBmYkRiLCBjdXJyZW50VXNlciwgWExTWCAoY2RuKSwgZXNjYXBlSHRtbC4gTWlzbW8gcGF0cm9uIHF1ZSBvdHJvcyBkb21pbmlvcy5cbi8vXG4vLyBGT1JFQ0FTVCAtIG1vZGFsIGFkbWluLW9ubHkgKE1hcmlhbm8pIHF1ZSBjb21wYXJhIHZlbnRhcyBoaXN0b3JpY2FzXG4vLyAoRmlyZXN0b3JlIHNrdV92ZW50YXNfc25hcHNob3QsIGFsaW1lbnRhZG8gcG9yIHN5bmMgQlEgdl92ZW50YXNfbGluZWFzXG4vLyB2ZW50YW5hIDEzbSkgdnMgU2FsZXMgUGxhbiBjYXJnYWRvIHBvciBlbCB1c2VyIHZpYSBFeGNlbCArIHBvbGl0aWNhIGRlXG4vLyBpbnZlbnRhcmlvIChwcm9tZWRpbyBZVEQgeCAzIG1lc2VzKS5cbi8vXG4vLyBDaHVuayBsYXp5OiBzZSBjYXJnYSBzb2xvIGFsIHByaW1lciBjbGljayBkZWwgYm90b24gRk9SRUNBU1QgZGVsIGhlYWRlci5cbi8vIFJlZ2lzdHJhZG8gZW4gYnVpbGQuanMgTEFaWV9DSFVOS1MgKyBzcmMvbWFpbi5qcyBpbnN0YWxsQ2h1bmtTdHVicyArIHN3LmpzXG4vLyBTVEFUSUNfQVNTRVRTLiBWZXIgQ0xBVURFLm1kICMxOCAoMyBsdWdhcmVzIHNpbmNyb25pemFkb3MpLlxuLy9cbi8vIENvbnRyYXRvIGRlbCBFeGNlbCBTYWxlcyBQbGFuIHF1ZSBzdWJlIGVsIHVzZXI6XG4vLyAgIENvbHVtbmFzOiBTS1UgfCBNZXMxIHwgTWVzMiB8IE1lczMgfCBNZXM0IHwgTWVzNSB8IE1lczZcbi8vICAgKG5vbWJyZXMgZXhhY3RvcyBkZSBoZWFkZXJzIGNhc2UtaW5zZW5zaXRpdmU7IE1lczEuLjYgc29uIGxvcyBwcm94aW1vc1xuLy8gICA2IG1lc2VzIGRlc2RlIGVsIG1lcyBhY3R1YWwpLiBVbmEgZmlsYSBwb3IgU0tVLlxuLy9cbi8vIEZ1ZW50ZSBkZSBkYXRvcyBoaXN0b3JpY2FzOlxuLy8gICBGaXJlc3RvcmUgL3NrdV92ZW50YXNfc25hcHNob3Qve1NLVV88c2t1X3NhbmVhZG8+fVxuLy8gICB7XG4vLyAgICAgc2t1LCBpdGVtTmFtZSwgZmFtaWxpYSwgc3ViZmFtaWxpYSxcbi8vICAgICBtZXNlczogeyAnMjAyNS0wOCc6IHtxdHksIGFyc30sIC4uLiwgJzIwMjYtMDgnOiB7cXR5LCBhcnN9IH1cbi8vICAgfVxuLy8gICBSdWxlczogcmVhZCBhZG1pbi1vbmx5IChjb21wZXRpdGl2ZWx5IHNlbnNpdGl2ZSkuIEVzY3JpdG8gcG9yIGNyb25cbi8vICAgc3luY19zYXBfdG9fYmlncXVlcnkucHkgY2FkYSAzMCBtaW4uXG5cbi8vIEVzdGFkbyBkZWwgbW9kYWwgKGludHJhLWNodW5rLCBubyBjcm9zcy1zY29wZSkuXG5sZXQgX2ZvcmVjYXN0U25hcHNob3QgPSBudWxsOyAvLyB7IFNLVToge2ZhbWlsaWEsIHN1YmZhbWlsaWEsIGl0ZW1OYW1lLCBtZXNlc30gfVxubGV0IF9mb3JlY2FzdFNhbGVzUGxhbiA9IG51bGw7IC8vIFt7IHNrdSwgcGVkaWRvVG90YWwsIG1lc2VzQXJyOiBbbjEuLm42XSB9XVxubGV0IF9mb3JlY2FzdFJvd3MgPSBudWxsOyAvLyBmaWxhcyBmaW5hbGVzIGNhbGN1bGFkYXMgcGFyYSBwcmV2aWV3ICsgZXhwb3J0XG5sZXQgX2ZvcmVjYXN0TG9hZGluZyA9IGZhbHNlO1xuXG4vLyB2MTA5OCsgKEZhc2UgMSBGb3JlY2FzdCB2Mik6IFNhbGVzIFBsYW5zIG1lbnN1YWxlcyBwb3IgZmFtaWxpYSAoUm9kcy9SZWVscy9GRykuXG4vLyBTZSBndWFyZGFuIGVuIEZpcmVzdG9yZSBgc2FsZXNfcGxhbl9jYWNoZS97ZmFtaWxpYX1gICsgc25hcHNob3QgRXhjZWwgb3JpZ2luYWxcbi8vIGVuIFN0b3JhZ2UgYGZvcmVjYXN0c19zbmFwc2hvdHMve1lZWVktTU19L3tmYW1pbGlhfS54bHN4YC5cbi8vIEVsIHBhcnNlciBwdXJvIHZpdmUgZW4gc3JjL3B1cmUvc2FsZXMtcGxhbi1wYXJzZXIuanMgKGF0dGFjaCBhIHdpbmRvdy5TYWxlc1BsYW5QYXJzZXIpLlxuY29uc3QgU0FMRVNfUExBTl9GQU1JTElBUyA9IFtcbiAgeyBrZXk6ICdyb2RzJywgbGFiZWw6ICdSb2RzIChDYVx1MDBGMWFzKScsIGNvbG9yOiAnIzBlYTVlOScgfSxcbiAgeyBrZXk6ICdyZWVscycsIGxhYmVsOiAnUmVlbHMnLCBjb2xvcjogJyM4YjVjZjYnIH0sXG4gIHsga2V5OiAnZmcnLCBsYWJlbDogJ0ZHIChyZXN0byknLCBjb2xvcjogJyNmNTllMGInIH0sXG5dO1xuY29uc3QgX3NhbGVzUGxhbkNhY2hlcyA9IHsgcm9kczogbnVsbCwgcmVlbHM6IG51bGwsIGZnOiBudWxsIH07IC8vIGxhc3QgbG9hZGVkIGRvY1xubGV0IF9mb3JlY2FzdEFjdGl2ZVRhYiA9ICdzYWxlcy1wbGFucyc7IC8vICdzYWxlcy1wbGFucycgfCAnc3RhdCcgfCAnbGVnYWN5J1xuXG4vLyB2MTEwMysgKEZhc2UgMkIpOiBGb3JlY2FzdCBFc3RhZFx1MDBFRHN0aWNvIFx1MjAxNCBvdXRwdXQgcHVibGljYWRvIHBvclxuLy8gc2NyaXB0cy9mb3JlY2FzdC9wdWJsaXNoX3RvX2ZpcmVzdG9yZS5weSBhIGZvcmVjYXN0X291dHB1dC97c3ViX3NsdWd9XG4vLyArIGZvcmVjYXN0X291dHB1dF9tZXRhL2N1cnJlbnQuIDI0IHN1YnMgKyAxIG1ldGEgZG9jLlxubGV0IF9mb3JlY2FzdFN0YXREb2NzID0gbnVsbDsgLy8gW3tpZCwgc3ViZmFtaWxpYSwgZm9yZWNhc3RbN10sIG1ldHJpY3MsIGJlc3RNb2RlbCwgdmVyc2lvbklkfV1cbmxldCBfZm9yZWNhc3RTdGF0TWV0YSA9IG51bGw7IC8vIHtnZW5lcmF0ZWRBdCwgdmVyc2lvbklkLCByZXN1bWVuOiB7Li4ufX1cbmxldCBfZm9yZWNhc3RTdGF0SGlzdG9yeUNhY2hlID0gbnVsbDsgLy8geyBbc3ViXTogW3tkcywgeX1dIH0gY2FjaGUgbGF6eSBvbi1kZW1hbmRcblxuLy8gV2hpdGVsaXN0IGRlIGVtYWlscyBjb24gYWNjZXNvIGFsIG1vZGFsIEZPUkVDQVNULiBSZXBsaWNhIGVsIHBhdHJvbiBkZVxuLy8gXCJBbmFsaXNpc1wiIChpbmRleC5odG1sOjEyNjI1KS4gU29sbyBNYXJpYW5vOyBzaSBvdHJvIGFkbWluIGxvIG5lY2VzaXRhXG4vLyBzZSBhZ3JlZ2EgYWNhIGV4cGxpY2l0by5cbmNvbnN0IEZPUkVDQVNUX0FMTE9XRURfRU1BSUxTID0gWydtYXJpYW5vLmVyYmlub0BzaGltYW5vLmNvbS5hcicsICdlcmJpbm9tYXJpYW5vQGdtYWlsLmNvbSddO1xuXG5mdW5jdGlvbiBfY2FuRm9yZWNhc3QoKSB7XG4gIHRyeSB7XG4gICAgY29uc3QgZW1haWwgPSAoKHdpbmRvdy5jdXJyZW50VXNlciAmJiB3aW5kb3cuY3VycmVudFVzZXIuZW1haWwpIHx8ICcnKS50b0xvd2VyQ2FzZSgpO1xuICAgIGlmICghZW1haWwpIHJldHVybiBmYWxzZTtcbiAgICByZXR1cm4gRk9SRUNBU1RfQUxMT1dFRF9FTUFJTFMuaW5kZXhPZihlbWFpbCkgPj0gMDtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG59XG5cbi8vIEhlbHBlcnMgZGUgbWVzIGNhbGVuZGFyLlxuZnVuY3Rpb24gX21vbnRoS2V5KHllYXIsIG1vbnRoT25lQmFzZWQpIHtcbiAgcmV0dXJuIFN0cmluZyh5ZWFyKS5wYWRTdGFydCg0LCAnMCcpICsgJy0nICsgU3RyaW5nKG1vbnRoT25lQmFzZWQpLnBhZFN0YXJ0KDIsICcwJyk7XG59XG5mdW5jdGlvbiBfbW9udGhMYWJlbChrZXkpIHtcbiAgLy8gJzIwMjYtMDgnIC0+ICdhZ28tMjYnXG4gIGNvbnN0IFt5LCBtXSA9IGtleS5zcGxpdCgnLScpLm1hcChOdW1iZXIpO1xuICBjb25zdCBuYW1lcyA9IFtcbiAgICAnZW5lJyxcbiAgICAnZmViJyxcbiAgICAnbWFyJyxcbiAgICAnYWJyJyxcbiAgICAnbWF5JyxcbiAgICAnanVuJyxcbiAgICAnanVsJyxcbiAgICAnYWdvJyxcbiAgICAnc2VwJyxcbiAgICAnb2N0JyxcbiAgICAnbm92JyxcbiAgICAnZGljJyxcbiAgXTtcbiAgcmV0dXJuIG5hbWVzW20gLSAxXSArICctJyArIFN0cmluZyh5KS5zbGljZSgtMik7XG59XG5mdW5jdGlvbiBfYWRkTW9udGhzKHllYXIsIG1vbnRoT25lQmFzZWQsIGRlbHRhKSB7XG4gIGNvbnN0IHRvdGFsTW9udGhzID0geWVhciAqIDEyICsgKG1vbnRoT25lQmFzZWQgLSAxKSArIGRlbHRhO1xuICBjb25zdCB5ID0gTWF0aC5mbG9vcih0b3RhbE1vbnRocyAvIDEyKTtcbiAgY29uc3QgbSA9ICh0b3RhbE1vbnRocyAlIDEyKSArIDE7XG4gIHJldHVybiB7IHksIG0gfTtcbn1cblxuLy8gU3VtYSBxdHkgZGVsIFNLVSBlbiBsb3MgdWx0aW1vcyAxMiBNRVNFUyBDT01QTEVUT1MgKGV4Y2x1eWUgZWwgbWVzIGFjdHVhbFxuLy8gcGFyY2lhbCAtIGxhIHZlbnRhbmEgbW92aWwgXCIxMiBtZXNlcyBjZXJyYWRvc1wiIHF1ZSBlbCB1c2VyIHBpZW5zYSBjb21vXG4vLyBcImVsIGFcdTAwRjFvIHF1ZSB5YSBwYXNvXCIpLiBFamVtcGxvIGVuIGFnb3N0byAyMDI2OiBzdW1hciBhZ28tMjUgYSBqdWwtMjYuXG5mdW5jdGlvbiBfc3VtVmVudGFzMTJtQ29tcGxldG9zKG1lc2VzTWFwLCBob3kpIHtcbiAgaWYgKCFtZXNlc01hcCkgcmV0dXJuIDA7XG4gIGxldCBzdW0gPSAwO1xuICBjb25zdCBzdGFydE1vbnRoID0gX2FkZE1vbnRocyhob3kuZ2V0RnVsbFllYXIoKSwgaG95LmdldE1vbnRoKCkgKyAxLCAtMTIpO1xuICBjb25zdCBlbmRNb250aCA9IF9hZGRNb250aHMoaG95LmdldEZ1bGxZZWFyKCksIGhveS5nZXRNb250aCgpICsgMSwgLTEpO1xuICBjb25zdCBzdGFydEtleSA9IF9tb250aEtleShzdGFydE1vbnRoLnksIHN0YXJ0TW9udGgubSk7XG4gIGNvbnN0IGVuZEtleSA9IF9tb250aEtleShlbmRNb250aC55LCBlbmRNb250aC5tKTtcbiAgZm9yIChjb25zdCBrIG9mIE9iamVjdC5rZXlzKG1lc2VzTWFwKSkge1xuICAgIGlmIChrID49IHN0YXJ0S2V5ICYmIGsgPD0gZW5kS2V5KSB7XG4gICAgICBzdW0gKz0gTnVtYmVyKChtZXNlc01hcFtrXSAmJiBtZXNlc01hcFtrXS5xdHkpIHx8IDApO1xuICAgIH1cbiAgfVxuICByZXR1cm4gc3VtO1xufVxuXG4vLyBTdW1hIHF0eSBkZWwgU0tVIFlURCAoZW5lcm8gZGVsIGFcdTAwRjFvIGFjdHVhbCBoYXN0YSBtZXMgYWN0dWFsIElOQ0xVU0lWTyxcbi8vIGF1bnF1ZSBlbCBtZXMgYWN0dWFsIHNlYSBwYXJjaWFsKS4gUmV0b3JuYSB7IHRvdGFsWXRkLCBtZXNlc1RyYW5zY3Vycmlkb3MgfS5cbi8vIEVqZW1wbG8gYWdvc3RvIDIwMjYgY29uIHZlbnRhcyBqdWw9MTAgKyBhZ289MjAgLT4gezMwLCA4fSwgcHJvbWVkaW89MzAvOD0zLjc1LlxuLy8gKFNpIGVsIHVzdWFyaW8gZXNwZXJhYmEgZGl2aWRpciBwb3IgMiBlbiB2ZXogZGUgOCwgcmV2aXNhciBzcGVjLiBFbCBwZWRpZG9cbi8vIGRpY2UgXCJjYW50aWRhZCBkZSBtZXNlcyBxdWUgdHJhbnNjdXJyaW1vc1wiID0gbWVzZXMgZGVsIGFcdTAwRjFvIHBhc2Fkb3MgaGFzdGEgaG95LilcbmZ1bmN0aW9uIF9zdW1WZW50YXNZVEQobWVzZXNNYXAsIGhveSkge1xuICBjb25zdCB5ZWFyID0gaG95LmdldEZ1bGxZZWFyKCk7XG4gIGNvbnN0IG1lc0FjdHVhbCA9IGhveS5nZXRNb250aCgpICsgMTtcbiAgbGV0IHRvdGFsID0gMDtcbiAgaWYgKG1lc2VzTWFwKSB7XG4gICAgZm9yIChsZXQgbSA9IDE7IG0gPD0gbWVzQWN0dWFsOyBtKyspIHtcbiAgICAgIGNvbnN0IGsgPSBfbW9udGhLZXkoeWVhciwgbSk7XG4gICAgICB0b3RhbCArPSBOdW1iZXIoKG1lc2VzTWFwW2tdICYmIG1lc2VzTWFwW2tdLnF0eSkgfHwgMCk7XG4gICAgfVxuICB9XG4gIHJldHVybiB7IHRvdGFsWXRkOiB0b3RhbCwgbWVzZXNUcmFuc2N1cnJpZG9zOiBtZXNBY3R1YWwgfTtcbn1cblxuLy8gQ2FyZ2Egc2t1X3ZlbnRhc19zbmFwc2hvdCBjb21wbGV0byAodW5hIHZleiBwb3Igc2VzaW9uIGRlbCBtb2RhbCkuXG5hc3luYyBmdW5jdGlvbiBfbG9hZFNuYXBzaG90KCkge1xuICBpZiAoX2ZvcmVjYXN0U25hcHNob3QpIHJldHVybiBfZm9yZWNhc3RTbmFwc2hvdDtcbiAgaWYgKCF3aW5kb3cuZmJEYikgdGhyb3cgbmV3IEVycm9yKCdGaXJlc3RvcmUgbm8gaW5pY2lhbGl6YWRvJyk7XG4gIGNvbnN0IHNuYXAgPSBhd2FpdCB3aW5kb3cuZmJEYi5jb2xsZWN0aW9uKCdza3VfdmVudGFzX3NuYXBzaG90JykuZ2V0KCk7XG4gIGNvbnN0IGJ5T3JpZ2luYWxTa3UgPSB7fTtcbiAgY29uc3QgYnlVcHBlclNrdSA9IHt9O1xuICBzbmFwLmZvckVhY2goKGRvYykgPT4ge1xuICAgIGNvbnN0IGQgPSBkb2MuZGF0YSgpO1xuICAgIGlmICghZCB8fCAhZC5za3UpIHJldHVybjtcbiAgICBjb25zdCBza3VVcHBlciA9IFN0cmluZyhkLnNrdSkudHJpbSgpLnRvVXBwZXJDYXNlKCk7XG4gICAgY29uc3QgcmVjb3JkID0ge1xuICAgICAgc2t1OiBkLnNrdSxcbiAgICAgIGl0ZW1OYW1lOiBkLml0ZW1OYW1lIHx8ICcnLFxuICAgICAgZmFtaWxpYTogZC5mYW1pbGlhIHx8ICcnLFxuICAgICAgc3ViZmFtaWxpYTogZC5zdWJmYW1pbGlhIHx8ICcnLFxuICAgICAgbWVzZXM6IGQubWVzZXMgfHwge30sXG4gICAgfTtcbiAgICBieU9yaWdpbmFsU2t1W2Quc2t1XSA9IHJlY29yZDtcbiAgICBieVVwcGVyU2t1W3NrdVVwcGVyXSA9IHJlY29yZDtcbiAgfSk7XG4gIF9mb3JlY2FzdFNuYXBzaG90ID0geyBieU9yaWdpbmFsU2t1LCBieVVwcGVyU2t1LCBjb3VudDogc25hcC5zaXplIH07XG4gIHJldHVybiBfZm9yZWNhc3RTbmFwc2hvdDtcbn1cblxuLy8gUGFyc2VhIGVsIEV4Y2VsIFNhbGVzIFBsYW4uIEVzcGVyYSBjb2x1bW5hcyBTS1UgKyA2IGNvbHVtbmFzIG51bWVyaWNhc1xuLy8gKG5vbWJyZXMgZmxleGlibGVzOiBNZXMxLi5NZXM2LCBtZXNfMS4ubWVzXzYsIG8gY3VhbHF1aWVyIGhlYWRlciBjdXN0b21cbi8vIG1pZW50cmFzIGxhIHByaW1lcmEgc2VhIFNLVSB5IGhheWEgYWwgbWVub3MgNiBjb2x1bW5hcyBudW1lcmljYXMgbWFzKS5cbmZ1bmN0aW9uIF9wYXJzZVNhbGVzUGxhblJvd3Mocm93c1Jhdykge1xuICBpZiAoIXJvd3NSYXcgfHwgIXJvd3NSYXcubGVuZ3RoKSByZXR1cm4gW107XG4gIGNvbnN0IGhlYWRlclJvdyA9IHJvd3NSYXdbMF07XG4gIC8vIERldGVjdGFyIGluZGljZSBkZSBjb2x1bW5hIFNLVVxuICBsZXQgc2t1Q29sSWR4ID0gLTE7XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgaGVhZGVyUm93Lmxlbmd0aDsgaSsrKSB7XG4gICAgY29uc3QgaCA9IFN0cmluZyhoZWFkZXJSb3dbaV0gfHwgJycpXG4gICAgICAudHJpbSgpXG4gICAgICAudG9VcHBlckNhc2UoKTtcbiAgICBpZiAoaCA9PT0gJ1NLVScgfHwgaCA9PT0gJ0lURU1DT0RFJyB8fCBoID09PSAnSVRFTScgfHwgaCA9PT0gJ0lURU0gQ09ERScgfHwgaCA9PT0gJ0NPRElHTycpIHtcbiAgICAgIHNrdUNvbElkeCA9IGk7XG4gICAgICBicmVhaztcbiAgICB9XG4gIH1cbiAgaWYgKHNrdUNvbElkeCA8IDApXG4gICAgdGhyb3cgbmV3IEVycm9yKCdFbCBFeGNlbCBkZWJlIHRlbmVyIHVuYSBjb2x1bW5hIGxsYW1hZGEgXCJTS1VcIiAobyBDb2RpZ28gLyBJdGVtQ29kZSAvIEl0ZW0pJyk7XG4gIC8vIExhcyA2IGNvbHVtbmFzIGRlIG1lc2VzOiBsYXMgcHJpbWVyYXMgNiBjb2x1bW5hcyBxdWUgc2VhbiAhPSBza3VDb2xJZHguXG4gIGNvbnN0IG1vbnRoQ29scyA9IFtdO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IGhlYWRlclJvdy5sZW5ndGggJiYgbW9udGhDb2xzLmxlbmd0aCA8IDY7IGkrKykge1xuICAgIGlmIChpICE9PSBza3VDb2xJZHgpIG1vbnRoQ29scy5wdXNoKGkpO1xuICB9XG4gIGlmIChtb250aENvbHMubGVuZ3RoIDwgNilcbiAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAnRWwgRXhjZWwgZGViZSB0ZW5lciBhbCBtZW5vcyA2IGNvbHVtbmFzIGRlIG1lc2VzIGFkZW1hcyBkZSBTS1UgKGVuY29udHJhZGFzOiAnICtcbiAgICAgICAgbW9udGhDb2xzLmxlbmd0aCArXG4gICAgICAgICcpJ1xuICAgICk7XG4gIGNvbnN0IG91dCA9IFtdO1xuICBmb3IgKGxldCByID0gMTsgciA8IHJvd3NSYXcubGVuZ3RoOyByKyspIHtcbiAgICBjb25zdCByb3cgPSByb3dzUmF3W3JdO1xuICAgIGlmICghcm93IHx8ICFyb3cubGVuZ3RoKSBjb250aW51ZTtcbiAgICBjb25zdCBza3VSYXcgPSByb3dbc2t1Q29sSWR4XTtcbiAgICBpZiAoc2t1UmF3ID09PSB1bmRlZmluZWQgfHwgc2t1UmF3ID09PSBudWxsIHx8IFN0cmluZyhza3VSYXcpLnRyaW0oKSA9PT0gJycpIGNvbnRpbnVlO1xuICAgIGNvbnN0IHNrdSA9IFN0cmluZyhza3VSYXcpLnRyaW0oKTtcbiAgICBjb25zdCBtZXNlc0FyciA9IG1vbnRoQ29scy5tYXAoKGkpID0+IHtcbiAgICAgIGNvbnN0IHYgPSByb3dbaV07XG4gICAgICBjb25zdCBuID0gTnVtYmVyKHYpO1xuICAgICAgcmV0dXJuIE51bWJlci5pc0Zpbml0ZShuKSA/IG4gOiAwO1xuICAgIH0pO1xuICAgIGNvbnN0IHBlZGlkb1RvdGFsID0gbWVzZXNBcnIucmVkdWNlKChhLCBiKSA9PiBhICsgYiwgMCk7XG4gICAgb3V0LnB1c2goeyBza3UsIG1lc2VzQXJyLCBwZWRpZG9Ub3RhbCB9KTtcbiAgfVxuICByZXR1cm4gb3V0O1xufVxuXG4vLyBDYWxjdWxhIGxhcyBmaWxhcyBmaW5hbGVzIGNydXphbmRvIHNuYXBzaG90ICsgc2FsZXMgcGxhbi5cbmZ1bmN0aW9uIF9jb21wdXRlRm9yZWNhc3RSb3dzKHNuYXBzaG90LCBzYWxlc1BsYW4sIGhveSkge1xuICBjb25zdCByb3dzID0gW107XG4gIGZvciAoY29uc3Qgc3Agb2Ygc2FsZXNQbGFuKSB7XG4gICAgY29uc3Qgc2t1VXBwZXIgPSBzcC5za3UudG9VcHBlckNhc2UoKTtcbiAgICBjb25zdCBoaXN0ID0gc25hcHNob3QuYnlVcHBlclNrdVtza3VVcHBlcl0gfHwgbnVsbDtcbiAgICBjb25zdCB2ZW50YXMxMm0gPSBoaXN0ID8gX3N1bVZlbnRhczEybUNvbXBsZXRvcyhoaXN0Lm1lc2VzLCBob3kpIDogMDtcbiAgICBjb25zdCB5dGQgPSBoaXN0XG4gICAgICA/IF9zdW1WZW50YXNZVEQoaGlzdC5tZXNlcywgaG95KVxuICAgICAgOiB7IHRvdGFsWXRkOiAwLCBtZXNlc1RyYW5zY3Vycmlkb3M6IGhveS5nZXRNb250aCgpICsgMSB9O1xuICAgIGNvbnN0IHByb21lZGlvID0geXRkLm1lc2VzVHJhbnNjdXJyaWRvcyA+IDAgPyB5dGQudG90YWxZdGQgLyB5dGQubWVzZXNUcmFuc2N1cnJpZG9zIDogMDtcbiAgICBjb25zdCBwb2xpdGljYSA9IHByb21lZGlvICogMztcbiAgICBjb25zdCB0b3RhbCA9IHNwLnBlZGlkb1RvdGFsIC0gcG9saXRpY2E7XG4gICAgcm93cy5wdXNoKHtcbiAgICAgIHNrdTogc3Auc2t1LFxuICAgICAgaXRlbU5hbWU6IGhpc3QgPyBoaXN0Lml0ZW1OYW1lIDogJycsXG4gICAgICBmYW1pbGlhOiBoaXN0ID8gaGlzdC5mYW1pbGlhIDogJyhzaW4gbWF0Y2gpJyxcbiAgICAgIHN1YmZhbWlsaWE6IGhpc3QgPyBoaXN0LnN1YmZhbWlsaWEgOiAnKHNpbiBtYXRjaCknLFxuICAgICAgdmVudGFzMTJtOiB2ZW50YXMxMm0sXG4gICAgICBwZWRpZG82bTogc3AucGVkaWRvVG90YWwsXG4gICAgICBwcm9tZWRpbzogcHJvbWVkaW8sXG4gICAgICBwb2xpdGljYTogcG9saXRpY2EsXG4gICAgICB0b3RhbDogdG90YWwsXG4gICAgICBoYXNIaXN0b3JpYTogISFoaXN0LFxuICAgIH0pO1xuICB9XG4gIHJldHVybiByb3dzO1xufVxuXG5mdW5jdGlvbiBfcmVuZGVyTW9kYWxTaGVsbCgpIHtcbiAgY29uc3QgZXhpc3RpbmcgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZm9yZWNhc3QtbW9kYWwnKTtcbiAgaWYgKGV4aXN0aW5nKSByZXR1cm4gZXhpc3Rpbmc7XG4gIGNvbnN0IGVsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2Jyk7XG4gIGVsLmlkID0gJ2ZvcmVjYXN0LW1vZGFsJztcbiAgZWwuY2xhc3NOYW1lID0gJ21vZGFsLW92ZXJsYXknO1xuICBlbC5zdHlsZS5jc3NUZXh0ID1cbiAgICAnZGlzcGxheTpub25lO3Bvc2l0aW9uOmZpeGVkO2luc2V0OjA7YmFja2dyb3VuZDpyZ2JhKDE1LDIzLDQyLC42KTt6LWluZGV4OjIwNTA7JztcbiAgZWwub25jbGljayA9IGZ1bmN0aW9uIChldikge1xuICAgIGlmIChldi50YXJnZXQgPT09IGVsKSB3aW5kb3cuY2xvc2VGb3JlY2FzdE1vZGFsKCk7XG4gIH07XG4gIC8vIFNoZWxsICsgdGFicyBiYXIgKyAyIGNvbnRlbmVkb3JlcyBkZSB0YWJzIChTYWxlcyBQbGFucyBudWV2YSwgTGVnYWN5IDZtKS5cbiAgLy8gRWwgY29udGVuaWRvIGRlIGNhZGEgdGFiIHNlIHBpbnRhIGNvbiBfcmVuZGVyU2FsZXNQbGFuc1RhYigpIHkgZWwgbGVnYWN5XG4gIC8vIHVzYSBlbCBmbHVqbyBfcmVuZGVyVGFibGUoKSBkZSBzaWVtcHJlLlxuICBjb25zdCBzaGVsbEh0bWwgPSBfYnVpbGRTaGVsbEh0bWwoKTtcbiAgZWwuaW5uZXJIVE1MID0gc2hlbGxIdG1sO1xuICBkb2N1bWVudC5ib2R5LmFwcGVuZENoaWxkKGVsKTtcbiAgcmV0dXJuIGVsO1xufVxuXG5mdW5jdGlvbiBfYnVpbGRTaGVsbEh0bWwoKSB7XG4gIC8vIEJyb2tlbi1vdXQgcHVyZSBzdHJpbmcgYnVpbGRlciBwYXJhIHBhc2FyIGVsIGhvb2sgZGUgaW5uZXJIVE1MLlxuICBjb25zdCBtb2RhbE91dGVyID1cbiAgICAnPGRpdiBzdHlsZT1cInBvc2l0aW9uOmFic29sdXRlO2luc2V0OjF2aCAxdnc7YmFja2dyb3VuZDp2YXIoLS1iZy1lbGV2YXRlZCk7Ym9yZGVyLXJhZGl1czoxMHB4O2Rpc3BsYXk6ZmxleDtmbGV4LWRpcmVjdGlvbjpjb2x1bW47b3ZlcmZsb3c6aGlkZGVuO2JveC1zaGFkb3c6MCAyMHB4IDUwcHggcmdiYSgwLDAsMCwuMzUpXCI+JztcbiAgY29uc3QgaGVhZGVyID1cbiAgICAnPGRpdiBzdHlsZT1cInBhZGRpbmc6MTJweCAxOHB4O2JhY2tncm91bmQ6IzBmMTcyYTtjb2xvcjojZmZmO2Rpc3BsYXk6ZmxleDthbGlnbi1pdGVtczpjZW50ZXI7Z2FwOjEycHhcIj4nICtcbiAgICAnPGRpdiBzdHlsZT1cImZsZXg6MVwiPjxkaXYgc3R5bGU9XCJmb250LXNpemU6MTZweDtmb250LXdlaWdodDo4MDA7bGV0dGVyLXNwYWNpbmc6LjVweFwiPkZPUkVDQVNUPC9kaXY+JyArXG4gICAgJzxkaXYgaWQ9XCJmb3JlY2FzdC1zdWJ0aXRsZVwiIHN0eWxlPVwiZm9udC1zaXplOjExcHg7b3BhY2l0eTouODttYXJnaW4tdG9wOjJweFwiPlNhbGVzIFBsYW5zIG1lbnN1YWxlcyArIHBvbGl0aWNhIGRlIGludmVudGFyaW88L2Rpdj48L2Rpdj4nICtcbiAgICAnPGJ1dHRvbiBvbmNsaWNrPVwiY2xvc2VGb3JlY2FzdE1vZGFsKClcIiBzdHlsZT1cImJhY2tncm91bmQ6dHJhbnNwYXJlbnQ7Y29sb3I6I2ZmZjtib3JkZXI6MXB4IHNvbGlkIHJnYmEoMjU1LDI1NSwyNTUsLjQpO2JvcmRlci1yYWRpdXM6NnB4O3BhZGRpbmc6NnB4IDEwcHg7Y3Vyc29yOnBvaW50ZXI7Zm9udC13ZWlnaHQ6NzAwXCI+Q2VycmFyPC9idXR0b24+JyArXG4gICAgJzwvZGl2Pic7XG4gIGNvbnN0IHRhYnNCYXIgPVxuICAgICc8ZGl2IGlkPVwiZm9yZWNhc3QtdGFicy1iYXJcIiBzdHlsZT1cImRpc3BsYXk6ZmxleDtnYXA6MDtiYWNrZ3JvdW5kOiMxZTI5M2I7cGFkZGluZzowIDE4cHg7Ym9yZGVyLWJvdHRvbToxcHggc29saWQgdmFyKC0tYm9yZGVyLXN1YnRsZSlcIj4nICtcbiAgICAnPGJ1dHRvbiBkYXRhLXRhYj1cInNhbGVzLXBsYW5zXCIgb25jbGljaz1cInN3aXRjaEZvcmVjYXN0VGFiKFxcJ3NhbGVzLXBsYW5zXFwnKVwiIGNsYXNzPVwiZm9yZWNhc3QtdGFiXCIgc3R5bGU9XCJwYWRkaW5nOjEwcHggMTZweDtiYWNrZ3JvdW5kOnRyYW5zcGFyZW50O2NvbG9yOiNmZmY7Ym9yZGVyOm5vbmU7Ym9yZGVyLWJvdHRvbTozcHggc29saWQgIzBkOTQ4ODtjdXJzb3I6cG9pbnRlcjtmb250LXdlaWdodDo3MDA7Zm9udC1zaXplOjEycHg7bGV0dGVyLXNwYWNpbmc6LjRweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2VcIj5TYWxlcyBQbGFuczwvYnV0dG9uPicgK1xuICAgICc8YnV0dG9uIGRhdGEtdGFiPVwic3RhdFwiIG9uY2xpY2s9XCJzd2l0Y2hGb3JlY2FzdFRhYihcXCdzdGF0XFwnKVwiIGNsYXNzPVwiZm9yZWNhc3QtdGFiXCIgc3R5bGU9XCJwYWRkaW5nOjEwcHggMTZweDtiYWNrZ3JvdW5kOnRyYW5zcGFyZW50O2NvbG9yOiM5NGEzYjg7Ym9yZGVyOm5vbmU7Ym9yZGVyLWJvdHRvbTozcHggc29saWQgdHJhbnNwYXJlbnQ7Y3Vyc29yOnBvaW50ZXI7Zm9udC13ZWlnaHQ6NjAwO2ZvbnQtc2l6ZToxMnB4O2xldHRlci1zcGFjaW5nOi40cHg7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlXCI+Rm9yZWNhc3QgRXN0YWRcdTAwRURzdGljbzwvYnV0dG9uPicgK1xuICAgICc8YnV0dG9uIGRhdGEtdGFiPVwibGVnYWN5XCIgb25jbGljaz1cInN3aXRjaEZvcmVjYXN0VGFiKFxcJ2xlZ2FjeVxcJylcIiBjbGFzcz1cImZvcmVjYXN0LXRhYlwiIHN0eWxlPVwicGFkZGluZzoxMHB4IDE2cHg7YmFja2dyb3VuZDp0cmFuc3BhcmVudDtjb2xvcjojOTRhM2I4O2JvcmRlcjpub25lO2JvcmRlci1ib3R0b206M3B4IHNvbGlkIHRyYW5zcGFyZW50O2N1cnNvcjpwb2ludGVyO2ZvbnQtd2VpZ2h0OjYwMDtmb250LXNpemU6MTJweDtsZXR0ZXItc3BhY2luZzouNHB4O3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZVwiPkxlZ2FjeSAoNm0pPC9idXR0b24+JyArXG4gICAgJzwvZGl2Pic7XG4gIGNvbnN0IHRhYlNhbGVzUGxhbnMgPSAnPGRpdiBpZD1cImZvcmVjYXN0LXRhYi1zYWxlcy1wbGFuc1wiIHN0eWxlPVwiZmxleDoxO292ZXJmbG93OmF1dG9cIj48L2Rpdj4nO1xuICBjb25zdCB0YWJTdGF0ID0gJzxkaXYgaWQ9XCJmb3JlY2FzdC10YWItc3RhdFwiIHN0eWxlPVwiZmxleDoxO292ZXJmbG93OmF1dG87ZGlzcGxheTpub25lXCI+PC9kaXY+JztcbiAgY29uc3QgbGVnYWN5QmFyID1cbiAgICAnPGRpdiBzdHlsZT1cInBhZGRpbmc6MTJweCAxOHB4O2JhY2tncm91bmQ6dmFyKC0tYmctc2Vjb25kYXJ5KTtib3JkZXItYm90dG9tOjFweCBzb2xpZCB2YXIoLS1ib3JkZXItc3VidGxlKTtkaXNwbGF5OmZsZXg7ZmxleC13cmFwOndyYXA7Z2FwOjE0cHg7YWxpZ24taXRlbXM6Y2VudGVyXCI+JyArXG4gICAgJzxsYWJlbCBzdHlsZT1cImRpc3BsYXk6aW5saW5lLWZsZXg7YWxpZ24taXRlbXM6Y2VudGVyO2dhcDo4cHg7cGFkZGluZzo4cHggMTJweDtiYWNrZ3JvdW5kOiMwZDk0ODg7Y29sb3I6I2ZmZjtib3JkZXItcmFkaXVzOjZweDtmb250LXdlaWdodDo3MDA7Zm9udC1zaXplOjEycHg7Y3Vyc29yOnBvaW50ZXJcIj4nICtcbiAgICAnPHNwYW4+Q2FyZ2FyIFNhbGVzIFBsYW4gKC54bHN4KTwvc3Bhbj4nICtcbiAgICAnPGlucHV0IHR5cGU9XCJmaWxlXCIgYWNjZXB0PVwiLnhsc3gsLnhsc1wiIHN0eWxlPVwiZGlzcGxheTpub25lXCIgb25jaGFuZ2U9XCJvbkZvcmVjYXN0U2FsZXNQbGFuRmlsZShldmVudClcIi8+PC9sYWJlbD4nICtcbiAgICAnPGRpdiBpZD1cImZvcmVjYXN0LWhpbnRcIiBzdHlsZT1cImZvbnQtc2l6ZToxMXB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO21heC13aWR0aDo1MjBweFwiPkZvcm1hdG8gbGVnYWN5OiBwcmltZXJhIGNvbHVtbmEgPGI+U0tVPC9iPiwgbHVlZ28gNiBjb2x1bW5hcyBjb24gbGFzIHVuaWRhZGVzIHBlZGlkYXMgbWVzIGEgbWVzLjwvZGl2PicgK1xuICAgICc8YnV0dG9uIGlkPVwiZm9yZWNhc3QtZXhwb3J0LWJ0blwiIG9uY2xpY2s9XCJleHBvcnRGb3JlY2FzdEV4Y2VsKClcIiBkaXNhYmxlZCBzdHlsZT1cInBhZGRpbmc6OHB4IDE0cHg7YmFja2dyb3VuZDp2YXIoLS1jb2xvci1zdWNjZXNzKTtjb2xvcjojZmZmO2JvcmRlcjpub25lO2JvcmRlci1yYWRpdXM6NnB4O2ZvbnQtd2VpZ2h0OjcwMDtjdXJzb3I6cG9pbnRlcjtvcGFjaXR5Oi41XCI+RXhwb3J0YXIgRXhjZWw8L2J1dHRvbj4nICtcbiAgICAnPGRpdiBpZD1cImZvcmVjYXN0LXN0YXRzXCIgc3R5bGU9XCJtYXJnaW4tbGVmdDphdXRvO2ZvbnQtc2l6ZToxMXB4O2NvbG9yOnZhcigtLXRleHQtc2Vjb25kYXJ5KTtmb250LXdlaWdodDo2MDBcIj48L2Rpdj4nICtcbiAgICAnPC9kaXY+JztcbiAgY29uc3QgbGVnYWN5Qm9keSA9XG4gICAgJzxkaXYgaWQ9XCJmb3JlY2FzdC1ib2R5XCIgc3R5bGU9XCJmbGV4OjE7b3ZlcmZsb3c6YXV0bztwYWRkaW5nOjBcIj48ZGl2IHN0eWxlPVwicGFkZGluZzo2MHB4IDIwcHg7dGV4dC1hbGlnbjpjZW50ZXI7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7Zm9udC1zaXplOjE0cHhcIj5Fc3BlcmFuZG8gYXJjaGl2byBTYWxlcyBQbGFuLi4uPC9kaXY+PC9kaXY+JztcbiAgY29uc3QgdGFiTGVnYWN5ID1cbiAgICAnPGRpdiBpZD1cImZvcmVjYXN0LXRhYi1sZWdhY3lcIiBzdHlsZT1cImZsZXg6MTtvdmVyZmxvdzpoaWRkZW47ZmxleC1kaXJlY3Rpb246Y29sdW1uO2Rpc3BsYXk6bm9uZVwiPicgK1xuICAgIGxlZ2FjeUJhciArXG4gICAgbGVnYWN5Qm9keSArXG4gICAgJzwvZGl2Pic7XG4gIHJldHVybiBtb2RhbE91dGVyICsgaGVhZGVyICsgdGFic0JhciArIHRhYlNhbGVzUGxhbnMgKyB0YWJTdGF0ICsgdGFiTGVnYWN5ICsgJzwvZGl2Pic7XG59XG5cbi8vIHYxMDk4KyBGYXNlIDEgKyB2MTEwMysgRmFzZSAyQjogc3dpdGNoIGVudHJlIHRhYnMgU2FsZXMgUGxhbnMgLyBTdGF0IC8gTGVnYWN5Llxud2luZG93LnN3aXRjaEZvcmVjYXN0VGFiID0gZnVuY3Rpb24gKHRhYklkKSB7XG4gIF9mb3JlY2FzdEFjdGl2ZVRhYiA9IHRhYklkO1xuICBjb25zdCBzcCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdmb3JlY2FzdC10YWItc2FsZXMtcGxhbnMnKTtcbiAgY29uc3Qgc3QgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZm9yZWNhc3QtdGFiLXN0YXQnKTtcbiAgY29uc3QgbGcgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZm9yZWNhc3QtdGFiLWxlZ2FjeScpO1xuICBpZiAoc3ApIHNwLnN0eWxlLmRpc3BsYXkgPSB0YWJJZCA9PT0gJ3NhbGVzLXBsYW5zJyA/ICdibG9jaycgOiAnbm9uZSc7XG4gIGlmIChzdCkgc3Quc3R5bGUuZGlzcGxheSA9IHRhYklkID09PSAnc3RhdCcgPyAnYmxvY2snIDogJ25vbmUnO1xuICBpZiAobGcpIGxnLnN0eWxlLmRpc3BsYXkgPSB0YWJJZCA9PT0gJ2xlZ2FjeScgPyAnZmxleCcgOiAnbm9uZSc7XG4gIGNvbnN0IGJ0bnMgPSBkb2N1bWVudC5xdWVyeVNlbGVjdG9yQWxsKCcjZm9yZWNhc3QtdGFicy1iYXIgLmZvcmVjYXN0LXRhYicpO1xuICBidG5zLmZvckVhY2goKGIpID0+IHtcbiAgICBjb25zdCBhY3RpdmUgPSBiLmdldEF0dHJpYnV0ZSgnZGF0YS10YWInKSA9PT0gdGFiSWQ7XG4gICAgYi5zdHlsZS5jb2xvciA9IGFjdGl2ZSA/ICcjZmZmJyA6ICcjOTRhM2I4JztcbiAgICBiLnN0eWxlLmJvcmRlckJvdHRvbUNvbG9yID0gYWN0aXZlID8gJyMwZDk0ODgnIDogJ3RyYW5zcGFyZW50JztcbiAgICBiLnN0eWxlLmZvbnRXZWlnaHQgPSBhY3RpdmUgPyAnNzAwJyA6ICc2MDAnO1xuICB9KTtcbiAgLy8gTGF6eSBsb2FkIGRlbCBjb250ZW5pZG8gc3RhdCBvbi1kZW1hbmQgbGEgcHJpbWVyYSB2ZXpcbiAgaWYgKHRhYklkID09PSAnc3RhdCcgJiYgIV9mb3JlY2FzdFN0YXREb2NzKSB7XG4gICAgX2xvYWRGb3JlY2FzdE91dHB1dCgpXG4gICAgICAudGhlbihfcmVuZGVyRm9yZWNhc3RTdGF0VGFiKVxuICAgICAgLmNhdGNoKChlKSA9PiB7XG4gICAgICAgIGNvbnNvbGUuZXJyb3IoJ1tGT1JFQ0FTVCBzdGF0XSBsb2FkIGZhaWwnLCBlKTtcbiAgICAgICAgY29uc3QgYyA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdmb3JlY2FzdC10YWItc3RhdCcpO1xuICAgICAgICBpZiAoYylcbiAgICAgICAgICBjLmlubmVySFRNTCA9XG4gICAgICAgICAgICAnPGRpdiBzdHlsZT1cInBhZGRpbmc6NjBweCAyMHB4O3RleHQtYWxpZ246Y2VudGVyO2NvbG9yOiNkYzI2MjZcIj5FcnJvciBjYXJnYW5kbyBmb3JlY2FzdF9vdXRwdXQ6ICcgK1xuICAgICAgICAgICAgZXNjYXBlSHRtbFNhZmUoZS5tZXNzYWdlIHx8IFN0cmluZyhlKSkgK1xuICAgICAgICAgICAgJzwvZGl2Pic7XG4gICAgICB9KTtcbiAgfVxufTtcblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBGQVNFIDEgXHUyMDE0IFNhbGVzIFBsYW5zIHVwbG9hZCAoUm9kcyAvIFJlZWxzIC8gRkcpXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuZnVuY3Rpb24gX3llYXJNb250aE5vdygpIHtcbiAgY29uc3QgZCA9IG5ldyBEYXRlKCk7XG4gIHJldHVybiBkLmdldEZ1bGxZZWFyKCkgKyAnLScgKyBTdHJpbmcoZC5nZXRNb250aCgpICsgMSkucGFkU3RhcnQoMiwgJzAnKTtcbn1cblxuZnVuY3Rpb24gX2ZtdFNpemUoYnl0ZXMpIHtcbiAgaWYgKCFieXRlcykgcmV0dXJuICcnO1xuICBpZiAoYnl0ZXMgPCAxMDI0KSByZXR1cm4gYnl0ZXMgKyAnIEInO1xuICBpZiAoYnl0ZXMgPCAxMDI0ICogMTAyNCkgcmV0dXJuIChieXRlcyAvIDEwMjQpLnRvRml4ZWQoMSkgKyAnIEtCJztcbiAgcmV0dXJuIChieXRlcyAvICgxMDI0ICogMTAyNCkpLnRvRml4ZWQoMikgKyAnIE1CJztcbn1cblxuZnVuY3Rpb24gX2ZtdERhdGVTaG9ydChpc28pIHtcbiAgaWYgKCFpc28pIHJldHVybiAnXHUyMDE0JztcbiAgdHJ5IHtcbiAgICBjb25zdCBkID0gaXNvLnRvRGF0ZSA/IGlzby50b0RhdGUoKSA6IG5ldyBEYXRlKGlzbyk7XG4gICAgcmV0dXJuIChcbiAgICAgIGQudG9Mb2NhbGVEYXRlU3RyaW5nKCdlcy1BUicsIHsgZGF5OiAnMi1kaWdpdCcsIG1vbnRoOiAnc2hvcnQnLCB5ZWFyOiAnMi1kaWdpdCcgfSkgK1xuICAgICAgJyAnICtcbiAgICAgIGQudG9Mb2NhbGVUaW1lU3RyaW5nKCdlcy1BUicsIHsgaG91cjogJzItZGlnaXQnLCBtaW51dGU6ICcyLWRpZ2l0JyB9KVxuICAgICk7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiBTdHJpbmcoaXNvKTtcbiAgfVxufVxuXG5hc3luYyBmdW5jdGlvbiBfbG9hZFNhbGVzUGxhbkNhY2hlcygpIHtcbiAgaWYgKCF3aW5kb3cuZmJEYikgcmV0dXJuO1xuICBhd2FpdCBQcm9taXNlLmFsbChcbiAgICBTQUxFU19QTEFOX0ZBTUlMSUFTLm1hcChhc3luYyAoZikgPT4ge1xuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3QgZG9jID0gYXdhaXQgd2luZG93LmZiRGIuY29sbGVjdGlvbignc2FsZXNfcGxhbl9jYWNoZScpLmRvYyhmLmtleSkuZ2V0KCk7XG4gICAgICAgIF9zYWxlc1BsYW5DYWNoZXNbZi5rZXldID0gZG9jLmV4aXN0cyA/IGRvYy5kYXRhKCkgOiBudWxsO1xuICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICBjb25zb2xlLndhcm4oJ1tGT1JFQ0FTVF0gbG9hZCBzYWxlc19wbGFuX2NhY2hlLycgKyBmLmtleSArICcgZmFpbDonLCBlICYmIGUubWVzc2FnZSk7XG4gICAgICAgIF9zYWxlc1BsYW5DYWNoZXNbZi5rZXldID0gbnVsbDtcbiAgICAgIH1cbiAgICB9KVxuICApO1xufVxuXG5mdW5jdGlvbiBfcmVuZGVyVGFibGUocm93cykge1xuICBjb25zdCBib2R5ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2ZvcmVjYXN0LWJvZHknKTtcbiAgaWYgKCFib2R5KSByZXR1cm47XG4gIGlmICghcm93cyB8fCAhcm93cy5sZW5ndGgpIHtcbiAgICBib2R5LmlubmVySFRNTCA9XG4gICAgICAnPGRpdiBzdHlsZT1cInBhZGRpbmc6NjBweCAyMHB4O3RleHQtYWxpZ246Y2VudGVyO2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpXCI+U2FsZXMgUGxhbiB2YWNpbyBvIHNpbiBmaWxhcyB2YWxpZGFzLjwvZGl2Pic7XG4gICAgcmV0dXJuO1xuICB9XG4gIGNvbnN0IGZtdCA9IChuKSA9PlxuICAgIG4gPT09IDAgfHwgIU51bWJlci5pc0Zpbml0ZShuKVxuICAgICAgPyAnMCdcbiAgICAgIDogTnVtYmVyKG4pLnRvTG9jYWxlU3RyaW5nKCdlcy1BUicsIHsgbWF4aW11bUZyYWN0aW9uRGlnaXRzOiAxIH0pO1xuICBjb25zdCBjb2xvckZvclRvdGFsID0gKHQpID0+IHtcbiAgICBpZiAodCA+IDApIHJldHVybiAnIzE2NjUzNCc7IC8vIHNvYnJhIChwZWRpc3RlIG1hcyBxdWUgbGEgcG9saXRpY2EpIC0gdmVyZGVcbiAgICBpZiAodCA8IDApIHJldHVybiAnI2MyNDEwYyc7IC8vIGZhbHRhIChwZWRpc3RlIG1lbm9zIHF1ZSBsYSBwb2xpdGljYSkgLSBuYXJhbmphIHVyZ2VudGVcbiAgICByZXR1cm4gJyM0NzU1NjknO1xuICB9O1xuICBjb25zdCByb3dzSHRtbCA9IHJvd3NcbiAgICAubWFwKFxuICAgICAgKHIpID0+XG4gICAgICAgICcnICtcbiAgICAgICAgJzx0cicgK1xuICAgICAgICAoci5oYXNIaXN0b3JpYSA/ICcnIDogJyBzdHlsZT1cImJhY2tncm91bmQ6dmFyKC0tY29sb3Itd2FybmluZy1iZylcIicpICtcbiAgICAgICAgJz4nICtcbiAgICAgICAgJzx0ZCBzdHlsZT1cInBhZGRpbmc6NnB4IDEwcHg7Zm9udC1mYW1pbHk6bW9ub3NwYWNlO2ZvbnQtc2l6ZToxMXB4O3doaXRlLXNwYWNlOm5vd3JhcFwiPicgK1xuICAgICAgICBlc2NhcGVIdG1sU2FmZShyLnNrdSkgK1xuICAgICAgICAnPC90ZD4nICtcbiAgICAgICAgJzx0ZCBzdHlsZT1cInBhZGRpbmc6NnB4IDEwcHg7Zm9udC1zaXplOjExcHhcIj4nICtcbiAgICAgICAgZXNjYXBlSHRtbFNhZmUoci5mYW1pbGlhKSArXG4gICAgICAgICc8L3RkPicgK1xuICAgICAgICAnPHRkIHN0eWxlPVwicGFkZGluZzo2cHggMTBweDtmb250LXNpemU6MTFweFwiPicgK1xuICAgICAgICBlc2NhcGVIdG1sU2FmZShyLnN1YmZhbWlsaWEpICtcbiAgICAgICAgJzwvdGQ+JyArXG4gICAgICAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjZweCAxMHB4O3RleHQtYWxpZ246cmlnaHQ7Zm9udC12YXJpYW50LW51bWVyaWM6dGFidWxhci1udW1zXCI+JyArXG4gICAgICAgIGZtdChyLnZlbnRhczEybSkgK1xuICAgICAgICAnPC90ZD4nICtcbiAgICAgICAgJzx0ZCBzdHlsZT1cInBhZGRpbmc6NnB4IDEwcHg7dGV4dC1hbGlnbjpyaWdodDtmb250LXZhcmlhbnQtbnVtZXJpYzp0YWJ1bGFyLW51bXM7Zm9udC13ZWlnaHQ6NjAwXCI+JyArXG4gICAgICAgIGZtdChyLnBlZGlkbzZtKSArXG4gICAgICAgICc8L3RkPicgK1xuICAgICAgICAnPHRkIHN0eWxlPVwicGFkZGluZzo2cHggMTBweDt0ZXh0LWFsaWduOnJpZ2h0O2ZvbnQtdmFyaWFudC1udW1lcmljOnRhYnVsYXItbnVtcztjb2xvcjp2YXIoLS10ZXh0LW11dGVkKVwiPicgK1xuICAgICAgICBmbXQoci5wcm9tZWRpbykgK1xuICAgICAgICAnPC90ZD4nICtcbiAgICAgICAgJzx0ZCBzdHlsZT1cInBhZGRpbmc6NnB4IDEwcHg7dGV4dC1hbGlnbjpyaWdodDtmb250LXZhcmlhbnQtbnVtZXJpYzp0YWJ1bGFyLW51bXNcIj4nICtcbiAgICAgICAgZm10KHIucG9saXRpY2EpICtcbiAgICAgICAgJzwvdGQ+JyArXG4gICAgICAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjZweCAxMHB4O3RleHQtYWxpZ246cmlnaHQ7Zm9udC12YXJpYW50LW51bWVyaWM6dGFidWxhci1udW1zO2ZvbnQtd2VpZ2h0OjcwMDtjb2xvcjonICtcbiAgICAgICAgY29sb3JGb3JUb3RhbChyLnRvdGFsKSArXG4gICAgICAgICdcIj4nICtcbiAgICAgICAgZm10KHIudG90YWwpICtcbiAgICAgICAgJzwvdGQ+JyArXG4gICAgICAgICc8L3RyPidcbiAgICApXG4gICAgLmpvaW4oJycpO1xuICBjb25zdCBoZWFkZXIgPVxuICAgICcnICtcbiAgICAnPHRoZWFkIHN0eWxlPVwicG9zaXRpb246c3RpY2t5O3RvcDowO2JhY2tncm91bmQ6IzBmMTcyYTtjb2xvcjojZmZmO3otaW5kZXg6MVwiPicgK1xuICAgICc8dHI+JyArXG4gICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6OHB4IDEwcHg7dGV4dC1hbGlnbjpsZWZ0O2ZvbnQtc2l6ZToxMXB4O3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtsZXR0ZXItc3BhY2luZzouNHB4XCI+U0tVPC90aD4nICtcbiAgICAnPHRoIHN0eWxlPVwicGFkZGluZzo4cHggMTBweDt0ZXh0LWFsaWduOmxlZnQ7Zm9udC1zaXplOjExcHg7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO2xldHRlci1zcGFjaW5nOi40cHhcIj5GYW1pbGlhPC90aD4nICtcbiAgICAnPHRoIHN0eWxlPVwicGFkZGluZzo4cHggMTBweDt0ZXh0LWFsaWduOmxlZnQ7Zm9udC1zaXplOjExcHg7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO2xldHRlci1zcGFjaW5nOi40cHhcIj5TdWJmYW1pbGlhPC90aD4nICtcbiAgICAnPHRoIHN0eWxlPVwicGFkZGluZzo4cHggMTBweDt0ZXh0LWFsaWduOnJpZ2h0O2ZvbnQtc2l6ZToxMXB4O3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtsZXR0ZXItc3BhY2luZzouNHB4XCIgdGl0bGU9XCJTdW1hIGRlIHF0eSBmYWN0dXJhZGEgZW4gbG9zIHVsdGltb3MgMTIgbWVzZXMgY29tcGxldG9zXCI+VmVudGFzIDEybTwvdGg+JyArXG4gICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6OHB4IDEwcHg7dGV4dC1hbGlnbjpyaWdodDtmb250LXNpemU6MTFweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7bGV0dGVyLXNwYWNpbmc6LjRweFwiIHRpdGxlPVwiU3VtYSBkZSBsYXMgNiBjb2x1bW5hcyBkZWwgRXhjZWwgU2FsZXMgUGxhblwiPlBlZGlkbyA2bTwvdGg+JyArXG4gICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6OHB4IDEwcHg7dGV4dC1hbGlnbjpyaWdodDtmb250LXNpemU6MTFweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7bGV0dGVyLXNwYWNpbmc6LjRweFwiIHRpdGxlPVwiVmVudGFzIFlURCAvIG1lc2VzIHRyYW5zY3Vycmlkb3MgZGVsIGFcdTAwRjFvXCI+UHJvbSAvIE1lczwvdGg+JyArXG4gICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6OHB4IDEwcHg7dGV4dC1hbGlnbjpyaWdodDtmb250LXNpemU6MTFweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7bGV0dGVyLXNwYWNpbmc6LjRweFwiIHRpdGxlPVwiUHJvbWVkaW8geCAzIG1lc2VzIChwb2xpdGljYSBkZSBpbnZlbnRhcmlvKVwiPlBvbGl0aWNhPC90aD4nICtcbiAgICAnPHRoIHN0eWxlPVwicGFkZGluZzo4cHggMTBweDt0ZXh0LWFsaWduOnJpZ2h0O2ZvbnQtc2l6ZToxMXB4O3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtsZXR0ZXItc3BhY2luZzouNHB4XCIgdGl0bGU9XCJQZWRpZG8gNm0gLSBQb2xpdGljYS4gTmVnYXRpdm8gPSB0ZSBmYWx0YSBwZWRpcjsgUG9zaXRpdm8gPSBzb2JyZXBlZGlkb1wiPlRvdGFsPC90aD4nICtcbiAgICAnPC90cj4nICtcbiAgICAnPC90aGVhZD4nO1xuICBib2R5LmlubmVySFRNTCA9XG4gICAgJzx0YWJsZSBzdHlsZT1cIndpZHRoOjEwMCU7Ym9yZGVyLWNvbGxhcHNlOmNvbGxhcHNlO2ZvbnQtc2l6ZToxMnB4XCI+JyArXG4gICAgaGVhZGVyICtcbiAgICAnPHRib2R5PicgK1xuICAgIHJvd3NIdG1sICtcbiAgICAnPC90Ym9keT48L3RhYmxlPic7XG59XG5cbmZ1bmN0aW9uIGVzY2FwZUh0bWxTYWZlKHMpIHtcbiAgaWYgKHR5cGVvZiB3aW5kb3cuZXNjYXBlSHRtbCA9PT0gJ2Z1bmN0aW9uJykgcmV0dXJuIHdpbmRvdy5lc2NhcGVIdG1sKHMpO1xuICByZXR1cm4gU3RyaW5nKHMgPT0gbnVsbCA/ICcnIDogcykucmVwbGFjZShcbiAgICAvWyY8PlwiJ10vZyxcbiAgICAoY2gpID0+ICh7ICcmJzogJyZhbXA7JywgJzwnOiAnJmx0OycsICc+JzogJyZndDsnLCAnXCInOiAnJnF1b3Q7JywgXCInXCI6ICcmIzM5OycgfSlbY2hdXG4gICk7XG59XG5cbmZ1bmN0aW9uIF9idWlsZFNhbGVzUGxhblNsb3RIdG1sKGYpIHtcbiAgY29uc3QgY2FjaGUgPSBfc2FsZXNQbGFuQ2FjaGVzW2Yua2V5XTtcbiAgY29uc3Qgcm93c0NvdW50ID0gY2FjaGUgJiYgTnVtYmVyLmlzRmluaXRlKGNhY2hlLnJvd3NDb3VudCkgPyBjYWNoZS5yb3dzQ291bnQgOiAwO1xuICBjb25zdCBtb250aHNDb3VudCA9XG4gICAgY2FjaGUgJiYgQXJyYXkuaXNBcnJheShjYWNoZS5kZXRlY3RlZE1vbnRocykgPyBjYWNoZS5kZXRlY3RlZE1vbnRocy5sZW5ndGggOiAwO1xuICBjb25zdCBwYXJzZWRBdCA9IGNhY2hlICYmIGNhY2hlLnBhcnNlZEF0ID8gX2ZtdERhdGVTaG9ydChjYWNoZS5wYXJzZWRBdCkgOiAnJztcbiAgY29uc3QgdXBsb2FkZWRCeSA9IGNhY2hlICYmIGNhY2hlLnVwbG9hZGVkQnkgPyBjYWNoZS51cGxvYWRlZEJ5IDogJyc7XG4gIGNvbnN0IHNvdXJjZUZpbGVuYW1lID0gY2FjaGUgJiYgY2FjaGUuc291cmNlRmlsZW5hbWUgPyBjYWNoZS5zb3VyY2VGaWxlbmFtZSA6ICcnO1xuICBjb25zdCB5ZWFyTW9udGggPSBjYWNoZSAmJiBjYWNoZS55ZWFyTW9udGggPyBjYWNoZS55ZWFyTW9udGggOiAnJztcbiAgY29uc3QgbW9udGhzUmFuZ2UgPVxuICAgIGNhY2hlICYmIGNhY2hlLmRldGVjdGVkTW9udGhzICYmIGNhY2hlLmRldGVjdGVkTW9udGhzLmxlbmd0aFxuICAgICAgPyBjYWNoZS5kZXRlY3RlZE1vbnRoc1swXSArICcgXHUyMTkyICcgKyBjYWNoZS5kZXRlY3RlZE1vbnRoc1tjYWNoZS5kZXRlY3RlZE1vbnRocy5sZW5ndGggLSAxXVxuICAgICAgOiAnXHUyMDE0JztcbiAgY29uc3QgaGFzQ2FjaGUgPSAhIWNhY2hlO1xuICBjb25zdCBiYWRnZSA9IGhhc0NhY2hlXG4gICAgPyAnPGRpdiBzdHlsZT1cInBhZGRpbmc6NHB4IDhweDtiYWNrZ3JvdW5kOiMxNmEzNGE7Y29sb3I6I2ZmZjtib3JkZXItcmFkaXVzOjEycHg7Zm9udC1zaXplOjEwcHg7Zm9udC13ZWlnaHQ6NzAwO2xldHRlci1zcGFjaW5nOi40cHhcIj5DQVJHQURPPC9kaXY+J1xuICAgIDogJzxkaXYgc3R5bGU9XCJwYWRkaW5nOjRweCA4cHg7YmFja2dyb3VuZDojZGMyNjI2O2NvbG9yOiNmZmY7Ym9yZGVyLXJhZGl1czoxMnB4O2ZvbnQtc2l6ZToxMHB4O2ZvbnQtd2VpZ2h0OjcwMDtsZXR0ZXItc3BhY2luZzouNHB4XCI+RkFMVEE8L2Rpdj4nO1xuICBjb25zdCBtZXRhQmxvY2sgPSBoYXNDYWNoZVxuICAgID8gJzxkaXYgc3R5bGU9XCJkaXNwbGF5OmdyaWQ7Z3JpZC10ZW1wbGF0ZS1jb2x1bW5zOmF1dG8gMWZyO2dhcDo2cHggMTJweDtmb250LXNpemU6MTFweDtwYWRkaW5nOjEwcHggMTJweDtiYWNrZ3JvdW5kOnZhcigtLWJnLXNlY29uZGFyeSk7Ym9yZGVyLXJhZGl1czo2cHhcIj4nICtcbiAgICAgICc8ZGl2IHN0eWxlPVwiY29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7Zm9udC13ZWlnaHQ6NjAwXCI+QXJjaGl2bzwvZGl2PjxkaXYgc3R5bGU9XCJjb2xvcjp2YXIoLS10ZXh0LXByaW1hcnkpO2ZvbnQtZmFtaWx5Om1vbm9zcGFjZTt3b3JkLWJyZWFrOmJyZWFrLWFsbFwiPicgK1xuICAgICAgZXNjYXBlSHRtbFNhZmUoc291cmNlRmlsZW5hbWUpICtcbiAgICAgICc8L2Rpdj4nICtcbiAgICAgICc8ZGl2IHN0eWxlPVwiY29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7Zm9udC13ZWlnaHQ6NjAwXCI+U3ViaWRvPC9kaXY+PGRpdiBzdHlsZT1cImNvbG9yOnZhcigtLXRleHQtcHJpbWFyeSlcIj4nICtcbiAgICAgIGVzY2FwZUh0bWxTYWZlKHBhcnNlZEF0KSArXG4gICAgICAnPC9kaXY+JyArXG4gICAgICAnPGRpdiBzdHlsZT1cImNvbG9yOnZhcigtLXRleHQtbXV0ZWQpO2ZvbnQtd2VpZ2h0OjYwMFwiPlBvcjwvZGl2PjxkaXYgc3R5bGU9XCJjb2xvcjp2YXIoLS10ZXh0LXByaW1hcnkpXCI+JyArXG4gICAgICBlc2NhcGVIdG1sU2FmZSh1cGxvYWRlZEJ5KSArXG4gICAgICAnPC9kaXY+JyArXG4gICAgICAnPGRpdiBzdHlsZT1cImNvbG9yOnZhcigtLXRleHQtbXV0ZWQpO2ZvbnQtd2VpZ2h0OjYwMFwiPlNuYXBzaG90PC9kaXY+PGRpdiBzdHlsZT1cImNvbG9yOnZhcigtLXRleHQtcHJpbWFyeSk7Zm9udC1mYW1pbHk6bW9ub3NwYWNlXCI+JyArXG4gICAgICBlc2NhcGVIdG1sU2FmZSh5ZWFyTW9udGgpICtcbiAgICAgICc8L2Rpdj4nICtcbiAgICAgICc8ZGl2IHN0eWxlPVwiY29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7Zm9udC13ZWlnaHQ6NjAwXCI+U0tVczwvZGl2PjxkaXYgc3R5bGU9XCJjb2xvcjp2YXIoLS10ZXh0LXByaW1hcnkpO2ZvbnQtd2VpZ2h0OjcwMFwiPicgK1xuICAgICAgcm93c0NvdW50LnRvTG9jYWxlU3RyaW5nKCdlcy1BUicpICtcbiAgICAgICc8L2Rpdj4nICtcbiAgICAgICc8ZGl2IHN0eWxlPVwiY29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7Zm9udC13ZWlnaHQ6NjAwXCI+TWVzZXM8L2Rpdj48ZGl2IHN0eWxlPVwiY29sb3I6dmFyKC0tdGV4dC1wcmltYXJ5KTtmb250LXdlaWdodDo3MDBcIj4nICtcbiAgICAgIG1vbnRoc0NvdW50ICtcbiAgICAgICcgPHNwYW4gc3R5bGU9XCJjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTtmb250LXdlaWdodDo0MDBcIj4oJyArXG4gICAgICBlc2NhcGVIdG1sU2FmZShtb250aHNSYW5nZSkgK1xuICAgICAgJyk8L3NwYW4+PC9kaXY+JyArXG4gICAgICAnPC9kaXY+J1xuICAgIDogJzxkaXYgc3R5bGU9XCJwYWRkaW5nOjE0cHg7dGV4dC1hbGlnbjpjZW50ZXI7Zm9udC1zaXplOjEycHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7YmFja2dyb3VuZDp2YXIoLS1iZy1zZWNvbmRhcnkpO2JvcmRlci1yYWRpdXM6NnB4O2JvcmRlcjoxcHggZGFzaGVkIHZhcigtLWJvcmRlci1zdWJ0bGUpXCI+QXVuIG5vIHN1YmlzdGUgZWwgU2FsZXMgUGxhbiBkZSBlc3RhIGZhbWlsaWEuPC9kaXY+JztcbiAgY29uc3QgdXBsb2FkQnRuID1cbiAgICAnPGxhYmVsIHN0eWxlPVwiZGlzcGxheTppbmxpbmUtZmxleDthbGlnbi1pdGVtczpjZW50ZXI7anVzdGlmeS1jb250ZW50OmNlbnRlcjtnYXA6OHB4O3BhZGRpbmc6MTBweCAxNHB4O2JhY2tncm91bmQ6JyArXG4gICAgZi5jb2xvciArXG4gICAgJztjb2xvcjojZmZmO2JvcmRlci1yYWRpdXM6NnB4O2ZvbnQtd2VpZ2h0OjcwMDtmb250LXNpemU6MTJweDtjdXJzb3I6cG9pbnRlcjtsZXR0ZXItc3BhY2luZzouNHB4XCI+JyArXG4gICAgJzxzcGFuPicgK1xuICAgIChoYXNDYWNoZSA/ICdcdTIxQkIgUmVlbXBsYXphciBFeGNlbCcgOiAnXHUyQjA2IENhcmdhciBFeGNlbCcpICtcbiAgICAnPC9zcGFuPicgK1xuICAgICc8aW5wdXQgdHlwZT1cImZpbGVcIiBhY2NlcHQ9XCIueGxzeCwueGxzXCIgZGF0YS1mYW1pbGlhPVwiJyArXG4gICAgZi5rZXkgK1xuICAgICdcIiBzdHlsZT1cImRpc3BsYXk6bm9uZVwiIG9uY2hhbmdlPVwib25TYWxlc1BsYW5GaWxlRm9yRmFtaWxpYShldmVudCwgXFwnJyArXG4gICAgZi5rZXkgK1xuICAgICdcXCcpXCIvPicgK1xuICAgICc8L2xhYmVsPic7XG4gIGNvbnN0IGNhcmRIZWFkID1cbiAgICAnPGRpdiBzdHlsZT1cImRpc3BsYXk6ZmxleDthbGlnbi1pdGVtczpjZW50ZXI7Z2FwOjEwcHhcIj4nICtcbiAgICAnPGRpdiBzdHlsZT1cIndpZHRoOjEycHg7aGVpZ2h0OjMycHg7YmFja2dyb3VuZDonICtcbiAgICBmLmNvbG9yICtcbiAgICAnO2JvcmRlci1yYWRpdXM6M3B4XCI+PC9kaXY+JyArXG4gICAgJzxkaXYgc3R5bGU9XCJmbGV4OjFcIj48ZGl2IHN0eWxlPVwiZm9udC1zaXplOjE0cHg7Zm9udC13ZWlnaHQ6ODAwO2NvbG9yOnZhcigtLXRleHQtcHJpbWFyeSlcIj4nICtcbiAgICBlc2NhcGVIdG1sU2FmZShmLmxhYmVsKSArXG4gICAgJzwvZGl2PicgK1xuICAgICc8ZGl2IHN0eWxlPVwiZm9udC1zaXplOjExcHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7bWFyZ2luLXRvcDoycHhcIj5TYWxlcyBQbGFuIG1lbnN1YWwgXHUwMEI3IEhvamEgU0FSPC9kaXY+PC9kaXY+JyArXG4gICAgYmFkZ2UgK1xuICAgICc8L2Rpdj4nO1xuICByZXR1cm4gKFxuICAgICc8ZGl2IHN0eWxlPVwiYmFja2dyb3VuZDp2YXIoLS1iZy1lbGV2YXRlZCk7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1ib3JkZXItc3VidGxlKTtib3JkZXItcmFkaXVzOjEwcHg7cGFkZGluZzoxNnB4O2Rpc3BsYXk6ZmxleDtmbGV4LWRpcmVjdGlvbjpjb2x1bW47Z2FwOjEycHhcIj4nICtcbiAgICBjYXJkSGVhZCArXG4gICAgbWV0YUJsb2NrICtcbiAgICB1cGxvYWRCdG4gK1xuICAgICc8ZGl2IGlkPVwic2FsZXMtcGxhbi1zdGF0dXMtJyArXG4gICAgZi5rZXkgK1xuICAgICdcIiBzdHlsZT1cImZvbnQtc2l6ZToxMXB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO21pbi1oZWlnaHQ6MTRweFwiPjwvZGl2PicgK1xuICAgICc8L2Rpdj4nXG4gICk7XG59XG5cbmZ1bmN0aW9uIF9yZW5kZXJTYWxlc1BsYW5zVGFiKCkge1xuICBjb25zdCBjb250ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2ZvcmVjYXN0LXRhYi1zYWxlcy1wbGFucycpO1xuICBpZiAoIWNvbnQpIHJldHVybjtcbiAgY29uc3Qgc2xvdHMgPSBTQUxFU19QTEFOX0ZBTUlMSUFTLm1hcChfYnVpbGRTYWxlc1BsYW5TbG90SHRtbCkuam9pbignJyk7XG4gIGNvbnN0IGludHJvID1cbiAgICAnPGRpdiBzdHlsZT1cIm1hcmdpbi1ib3R0b206MTZweDtwYWRkaW5nOjEycHggMTRweDtiYWNrZ3JvdW5kOnZhcigtLWJnLXNlY29uZGFyeSk7Ym9yZGVyLWxlZnQ6M3B4IHNvbGlkICMwZDk0ODg7Ym9yZGVyLXJhZGl1czo2cHg7Zm9udC1zaXplOjEycHg7Y29sb3I6dmFyKC0tdGV4dC1zZWNvbmRhcnkpO2xpbmUtaGVpZ2h0OjEuNVwiPicgK1xuICAgICc8YiBzdHlsZT1cImNvbG9yOnZhcigtLXRleHQtcHJpbWFyeSlcIj5GYXNlIDE8L2I+IFx1MjAxNCBDYXJnXHUwMEUxIGxvcyAzIFNhbGVzIFBsYW5zIG1lbnN1YWxlcyAoUm9kcyAvIFJlZWxzIC8gRkcpLiBTZSBwYXJzZWEgbGEgaG9qYSA8Yj5TQVI8L2I+OiBTS1UsIE1PUSAxMiBtb250aHMsIHkgdW5hIGNvbHVtbmEgcG9yIG1lcy4gJyArXG4gICAgJ0VsIEV4Y2VsIG9yaWdpbmFsIHF1ZWRhIHNuYXBzaG90YWRvIGVuIFN0b3JhZ2UgeSBlbCBwYXJzZW8gcXVlZGEgZW4gRmlyZXN0b3JlIHBhcmEgZWwgY1x1MDBFMWxjdWxvIChwclx1MDBGM3hpbWEgZmFzZSkuJyArXG4gICAgJzwvZGl2Pic7XG4gIGNvbnN0IGdyaWQgPVxuICAgICc8ZGl2IHN0eWxlPVwiZGlzcGxheTpncmlkO2dyaWQtdGVtcGxhdGUtY29sdW1uczpyZXBlYXQoYXV0by1maXQsbWlubWF4KDMyMHB4LDFmcikpO2dhcDoxNnB4XCI+JyArXG4gICAgc2xvdHMgK1xuICAgICc8L2Rpdj4nO1xuICBjb250LmlubmVySFRNTCA9ICc8ZGl2IHN0eWxlPVwicGFkZGluZzoxOHB4XCI+JyArIGludHJvICsgZ3JpZCArICc8L2Rpdj4nO1xufVxuXG53aW5kb3cub25TYWxlc1BsYW5GaWxlRm9yRmFtaWxpYSA9IGFzeW5jIGZ1bmN0aW9uIChldmVudCwgZmFtaWxpYSkge1xuICBjb25zdCBmaWxlID0gZXZlbnQgJiYgZXZlbnQudGFyZ2V0ICYmIGV2ZW50LnRhcmdldC5maWxlcyAmJiBldmVudC50YXJnZXQuZmlsZXNbMF07XG4gIGlmICghZmlsZSkgcmV0dXJuO1xuICBjb25zdCBzdGF0dXNFbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdzYWxlcy1wbGFuLXN0YXR1cy0nICsgZmFtaWxpYSk7XG4gIGNvbnN0IHNldFN0YXR1cyA9IChtc2csIGNvbG9yKSA9PiB7XG4gICAgaWYgKCFzdGF0dXNFbCkgcmV0dXJuO1xuICAgIHN0YXR1c0VsLnRleHRDb250ZW50ID0gbXNnO1xuICAgIHN0YXR1c0VsLnN0eWxlLmNvbG9yID0gY29sb3IgfHwgJ3ZhcigtLXRleHQtbXV0ZWQpJztcbiAgfTtcbiAgdHJ5IHtcbiAgICBpZiAodHlwZW9mIFhMU1ggPT09ICd1bmRlZmluZWQnKSB7XG4gICAgICBhbGVydCgnU2hlZXRKUyAoWExTWCkgbm8gY2FyZ2FkbyBcdTIwMTQgcmVjYXJnXHUwMEUxIGxhIGFwcC4nKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgaWYgKCF3aW5kb3cuU2FsZXNQbGFuUGFyc2VyIHx8ICF3aW5kb3cuU2FsZXNQbGFuUGFyc2VyLnBhcnNlU2FsZXNQbGFuU2hlZXQpIHtcbiAgICAgIGFsZXJ0KCdQYXJzZXIgU2FsZXMgUGxhbiBubyBjYXJnYWRvLiBSZWJ1aWxkIGJ1bmRsZS4nKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgaWYgKCF3aW5kb3cuZmlyZWJhc2UgfHwgIXdpbmRvdy5maXJlYmFzZS5zdG9yYWdlKSB7XG4gICAgICBhbGVydCgnRmlyZWJhc2UgU3RvcmFnZSBubyBkaXNwb25pYmxlLicpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBzZXRTdGF0dXMoJ0xleWVuZG8gRXhjZWxcdTIwMjYnKTtcbiAgICBjb25zdCBidWYgPSBhd2FpdCBmaWxlLmFycmF5QnVmZmVyKCk7XG4gICAgY29uc3Qgd2IgPSBYTFNYLnJlYWQoYnVmLCB7IHR5cGU6ICdhcnJheScgfSk7XG4gICAgY29uc3Qgc2FyTmFtZSA9IHdiLlNoZWV0TmFtZXMuZmluZChcbiAgICAgIChuKSA9PlxuICAgICAgICBTdHJpbmcobiB8fCAnJylcbiAgICAgICAgICAudHJpbSgpXG4gICAgICAgICAgLnRvVXBwZXJDYXNlKCkgPT09ICdTQVInXG4gICAgKTtcbiAgICBpZiAoIXNhck5hbWUpIHtcbiAgICAgIHNldFN0YXR1cyhcbiAgICAgICAgJ1x1MjZBMCBFbCBFeGNlbCBubyB0aWVuZSBob2phIFwiU0FSXCIuIEhvamFzIGVuY29udHJhZGFzOiAnICsgd2IuU2hlZXROYW1lcy5qb2luKCcsICcpLFxuICAgICAgICAnI2RjMjYyNidcbiAgICAgICk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGNvbnN0IHNoZWV0ID0gd2IuU2hlZXRzW3Nhck5hbWVdO1xuICAgIGNvbnN0IHJvd3MgPSBYTFNYLnV0aWxzLnNoZWV0X3RvX2pzb24oc2hlZXQsIHsgaGVhZGVyOiAxLCBkZWZ2YWw6ICcnLCByYXc6IHRydWUgfSk7XG4gICAgc2V0U3RhdHVzKCdQYXJzZWFuZG8gJyArIHJvd3MubGVuZ3RoICsgJyBmaWxhcyBkZSBob2phIFwiJyArIHNhck5hbWUgKyAnXCJcdTIwMjYnKTtcbiAgICBjb25zdCBwYXJzZWQgPSB3aW5kb3cuU2FsZXNQbGFuUGFyc2VyLnBhcnNlU2FsZXNQbGFuU2hlZXQocm93cyk7XG4gICAgaWYgKCFwYXJzZWQucm93cy5sZW5ndGgpIHtcbiAgICAgIHNldFN0YXR1cygnXHUyNkEwIEV4Y2VsIHBhcnNlYWRvIHBlcm8gc2luIFNLVXMgdlx1MDBFMWxpZG9zLicsICcjZGMyNjI2Jyk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGNvbnN0IHllYXJNb250aCA9IF95ZWFyTW9udGhOb3coKTtcbiAgICBjb25zdCBzdG9yYWdlUGF0aCA9ICdmb3JlY2FzdHNfc25hcHNob3RzLycgKyB5ZWFyTW9udGggKyAnLycgKyBmYW1pbGlhICsgJy54bHN4JztcbiAgICBzZXRTdGF0dXMoJ1N1YmllbmRvIEV4Y2VsIGEgU3RvcmFnZSAoJyArIF9mbXRTaXplKGZpbGUuc2l6ZSkgKyAnKVx1MjAyNicpO1xuICAgIGNvbnN0IHN0b3JhZ2VSZWYgPSB3aW5kb3cuZmlyZWJhc2Uuc3RvcmFnZSgpLnJlZihzdG9yYWdlUGF0aCk7XG4gICAgYXdhaXQgc3RvcmFnZVJlZi5wdXQoZmlsZSwge1xuICAgICAgY29udGVudFR5cGU6IGZpbGUudHlwZSB8fCAnYXBwbGljYXRpb24vdm5kLm9wZW54bWxmb3JtYXRzLW9mZmljZWRvY3VtZW50LnNwcmVhZHNoZWV0bWwuc2hlZXQnLFxuICAgICAgY3VzdG9tTWV0YWRhdGE6IHtcbiAgICAgICAgZmFtaWxpYSxcbiAgICAgICAgdXBsb2FkZWRCeTogKHdpbmRvdy5jdXJyZW50VXNlciAmJiB3aW5kb3cuY3VycmVudFVzZXIuZW1haWwpIHx8ICcnLFxuICAgICAgICBzb3VyY2VGaWxlbmFtZTogZmlsZS5uYW1lIHx8ICcnLFxuICAgICAgfSxcbiAgICB9KTtcbiAgICBzZXRTdGF0dXMoJ0d1YXJkYW5kbyBwYXJzZW8gZW4gRmlyZXN0b3JlICgnICsgcGFyc2VkLnJvd3MubGVuZ3RoICsgJyBTS1VzKVx1MjAyNicpO1xuICAgIGNvbnN0IHVwbG9hZGVkQnkgPSAod2luZG93LmN1cnJlbnRVc2VyICYmIHdpbmRvdy5jdXJyZW50VXNlci5lbWFpbCkgfHwgJ3Vua25vd24nO1xuICAgIGNvbnN0IHBheWxvYWQgPSB7XG4gICAgICBmYW1pbGlhLFxuICAgICAgcGFyc2VkQXQ6XG4gICAgICAgIHdpbmRvdy5maXJlYmFzZSAmJiB3aW5kb3cuZmlyZWJhc2UuZmlyZXN0b3JlICYmIHdpbmRvdy5maXJlYmFzZS5maXJlc3RvcmUuRmllbGRWYWx1ZVxuICAgICAgICAgID8gd2luZG93LmZpcmViYXNlLmZpcmVzdG9yZS5GaWVsZFZhbHVlLnNlcnZlclRpbWVzdGFtcCgpXG4gICAgICAgICAgOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICB1cGxvYWRlZEJ5LFxuICAgICAgc291cmNlRmlsZW5hbWU6IGZpbGUubmFtZSB8fCAnJyxcbiAgICAgIHNvdXJjZVNoZWV0OiBzYXJOYW1lLFxuICAgICAgeWVhck1vbnRoLFxuICAgICAgc3RvcmFnZVBhdGgsXG4gICAgICByb3dzQ291bnQ6IHBhcnNlZC5yb3dzLmxlbmd0aCxcbiAgICAgIGhlYWRlclJvd0luZGV4OiBwYXJzZWQuaGVhZGVyUm93SW5kZXgsXG4gICAgICBkZXRlY3RlZE1vbnRoczogcGFyc2VkLmRldGVjdGVkTW9udGhzLFxuICAgICAgcm93czogcGFyc2VkLnJvd3MsXG4gICAgfTtcbiAgICBhd2FpdCB3aW5kb3cuZmJEYi5jb2xsZWN0aW9uKCdzYWxlc19wbGFuX2NhY2hlJykuZG9jKGZhbWlsaWEpLnNldChwYXlsb2FkKTtcbiAgICBfc2FsZXNQbGFuQ2FjaGVzW2ZhbWlsaWFdID0gcGF5bG9hZDtcbiAgICBzZXRTdGF0dXMoXG4gICAgICAnXHUyNzEzIE9LLiAnICsgcGFyc2VkLnJvd3MubGVuZ3RoICsgJyBTS1VzIFx1MDBENyAnICsgcGFyc2VkLmRldGVjdGVkTW9udGhzLmxlbmd0aCArICcgbWVzZXMuJyxcbiAgICAgICcjMTZhMzRhJ1xuICAgICk7XG4gICAgX3JlbmRlclNhbGVzUGxhbnNUYWIoKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGNvbnNvbGUuZXJyb3IoJ1tGT1JFQ0FTVF0gdXBsb2FkIHNhbGVzIHBsYW4gJyArIGZhbWlsaWEgKyAnIGZhaWw6JywgZSk7XG4gICAgc2V0U3RhdHVzKCdcdTI3MTcgRXJyb3I6ICcgKyAoKGUgJiYgZS5tZXNzYWdlKSB8fCBlKSwgJyNkYzI2MjYnKTtcbiAgICBpZiAoZSAmJiBlLmNvZGUgPT09ICdNT05USFNfTk9UX0ZPVU5EJykge1xuICAgICAgYWxlcnQoXG4gICAgICAgICdFbCBFeGNlbCBubyB0aWVuZSBjb2x1bW5hcyBkZSBtZXNlcyByZWNvbm9jaWJsZXMuXFxuXFxuSGVhZGVycyBlc3BlcmFkb3M6IFwiSmFuIDIwMjdcIiwgXCJNYXkgMjAyN1wiLCBcIkVuZSAyMDI3XCIsIFwiMjAyNy0wMVwiLCBldGMuXFxuXFxuRGV0YWxsZTogJyArXG4gICAgICAgICAgZS5tZXNzYWdlXG4gICAgICApO1xuICAgIH1cbiAgfSBmaW5hbGx5IHtcbiAgICBpZiAoZXZlbnQgJiYgZXZlbnQudGFyZ2V0KSBldmVudC50YXJnZXQudmFsdWUgPSAnJztcbiAgfVxufTtcblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBGMkIgXHUyMDE0IEZvcmVjYXN0IEVzdGFkXHUwMEVEc3RpY286IHRhYmxhICsgZGV0YWxsZVxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmFzeW5jIGZ1bmN0aW9uIF9sb2FkRm9yZWNhc3RPdXRwdXQoKSB7XG4gIGlmICghd2luZG93LmZiRGIpIHRocm93IG5ldyBFcnJvcignRmlyZXN0b3JlIG5vIGluaWNpYWxpemFkbycpO1xuICBjb25zdCBbc25hcCwgbWV0YURvY10gPSBhd2FpdCBQcm9taXNlLmFsbChbXG4gICAgd2luZG93LmZiRGIuY29sbGVjdGlvbignZm9yZWNhc3Rfb3V0cHV0JykuZ2V0KCksXG4gICAgd2luZG93LmZiRGIuY29sbGVjdGlvbignZm9yZWNhc3Rfb3V0cHV0X21ldGEnKS5kb2MoJ2N1cnJlbnQnKS5nZXQoKSxcbiAgXSk7XG4gIGNvbnN0IGRvY3MgPSBbXTtcbiAgc25hcC5mb3JFYWNoKChkKSA9PiBkb2NzLnB1c2goT2JqZWN0LmFzc2lnbih7IGlkOiBkLmlkIH0sIGQuZGF0YSgpKSkpO1xuICBkb2NzLnNvcnQoKGEsIGIpID0+IHtcbiAgICBjb25zdCB3YSA9IChhLm1ldHJpY3MgJiYgYS5tZXRyaWNzLndhcGUpIHx8IDk5OTtcbiAgICBjb25zdCB3YiA9IChiLm1ldHJpY3MgJiYgYi5tZXRyaWNzLndhcGUpIHx8IDk5OTtcbiAgICByZXR1cm4gd2EgLSB3YjtcbiAgfSk7XG4gIF9mb3JlY2FzdFN0YXREb2NzID0gZG9jcztcbiAgX2ZvcmVjYXN0U3RhdE1ldGEgPSBtZXRhRG9jLmV4aXN0cyA/IG1ldGFEb2MuZGF0YSgpIDogbnVsbDtcbiAgcmV0dXJuIGRvY3M7XG59XG5cbmZ1bmN0aW9uIF93YXBlQmFkZ2VDb2xvcih3KSB7XG4gIGlmICh3ID09IG51bGwpIHJldHVybiAnIzY0NzQ4Yic7XG4gIGlmICh3IDwgMC4zKSByZXR1cm4gJyMxNmEzNGEnOyAvLyB2ZXJkZSAtIGV4Y2VsZW50ZVxuICBpZiAodyA8IDAuNSkgcmV0dXJuICcjODRjYzE2JzsgLy8gbGltYSAtIGJ1ZW5vXG4gIGlmICh3IDwgMC43KSByZXR1cm4gJyNlYWIzMDgnOyAvLyBhbWFyaWxsbyAtIGFjZXB0YWJsZVxuICBpZiAodyA8IDEuMCkgcmV0dXJuICcjZjk3MzE2JzsgLy8gbmFyYW5qYSAtIHBvYnJlXG4gIHJldHVybiAnI2RjMjYyNic7IC8vIHJvam8gLSBtdXkgcG9icmVcbn1cblxuZnVuY3Rpb24gX2ZtdE51bShuKSB7XG4gIGlmIChuID09IG51bGwgfHwgIU51bWJlci5pc0Zpbml0ZShOdW1iZXIobikpKSByZXR1cm4gJ1x1MjAxNCc7XG4gIHJldHVybiBOdW1iZXIobikudG9Mb2NhbGVTdHJpbmcoJ2VzLUFSJywgeyBtYXhpbXVtRnJhY3Rpb25EaWdpdHM6IDAgfSk7XG59XG5cbmZ1bmN0aW9uIF9mbXRXYXBlKHcpIHtcbiAgaWYgKHcgPT0gbnVsbCB8fCAhTnVtYmVyLmlzRmluaXRlKE51bWJlcih3KSkpIHJldHVybiAnXHUyMDE0JztcbiAgcmV0dXJuIChOdW1iZXIodykgKiAxMDApLnRvRml4ZWQoMCkgKyAnJSc7XG59XG5cbmZ1bmN0aW9uIF9mbXREc1Nob3J0KGlzbykge1xuICAvLyAnMjAyNi0xMC0wMScgLT4gJ29jdCAyNidcbiAgdHJ5IHtcbiAgICBjb25zdCBbeSwgbV0gPSBpc28uc3BsaXQoJy0nKS5tYXAoTnVtYmVyKTtcbiAgICBjb25zdCBuYW1lcyA9IFtcbiAgICAgICdlbmUnLFxuICAgICAgJ2ZlYicsXG4gICAgICAnbWFyJyxcbiAgICAgICdhYnInLFxuICAgICAgJ21heScsXG4gICAgICAnanVuJyxcbiAgICAgICdqdWwnLFxuICAgICAgJ2FnbycsXG4gICAgICAnc2VwJyxcbiAgICAgICdvY3QnLFxuICAgICAgJ25vdicsXG4gICAgICAnZGljJyxcbiAgICBdO1xuICAgIHJldHVybiBuYW1lc1ttIC0gMV0gKyAnICcgKyBTdHJpbmcoeSkuc2xpY2UoLTIpO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gaXNvO1xuICB9XG59XG5cbmZ1bmN0aW9uIF9yZW5kZXJGb3JlY2FzdFN0YXRUYWIoKSB7XG4gIGNvbnN0IGNvbnQgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZm9yZWNhc3QtdGFiLXN0YXQnKTtcbiAgaWYgKCFjb250KSByZXR1cm47XG4gIGNvbnN0IGRvY3MgPSBfZm9yZWNhc3RTdGF0RG9jcyB8fCBbXTtcbiAgY29uc3QgbWV0YSA9IF9mb3JlY2FzdFN0YXRNZXRhIHx8IHt9O1xuICBjb25zdCByZXN1bWVuID0gbWV0YS5yZXN1bWVuIHx8IHt9O1xuICBpZiAoIWRvY3MubGVuZ3RoKSB7XG4gICAgY29udC5pbm5lckhUTUwgPVxuICAgICAgJzxkaXYgc3R5bGU9XCJwYWRkaW5nOjYwcHggMjBweDt0ZXh0LWFsaWduOmNlbnRlcjtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKVwiPicgK1xuICAgICAgJ05vIGhheSBmb3JlY2FzdF9vdXRwdXQgcHVibGljYWRvLjxicj48YnI+JyArXG4gICAgICAnQ29ycmVyIDxjb2RlPnB5dGhvbiBzY3JpcHRzL2ZvcmVjYXN0L3RyYWluX3Byb2QucHkgJiYgcHl0aG9uIHNjcmlwdHMvZm9yZWNhc3QvcHVibGlzaF90b19maXJlc3RvcmUucHk8L2NvZGU+LicgK1xuICAgICAgJzwvZGl2Pic7XG4gICAgcmV0dXJuO1xuICB9XG4gIC8vIE1lc2VzIGRlbCBmb3JlY2FzdCAoZHMgZGVsIHByaW1lciBkb2MsIHNlIGFzdW1lIGlndWFsIGVuIHRvZG9zKS5cbiAgY29uc3QgbW9udGhzSXNvID0gKGRvY3NbMF0uZm9yZWNhc3QgfHwgW10pLm1hcCgoZikgPT4gZi5kcyk7XG4gIGNvbnN0IG1vbnRoSGVhZGVycyA9IG1vbnRoc0lzby5tYXAoX2ZtdERzU2hvcnQpO1xuXG4gIC8vIE1ldHJpY3MgY2hpcCBnbG9iYWxcbiAgY29uc3QgZ2VuZXJhdGVkID0gbWV0YS5nZW5lcmF0ZWRBdFxuICAgID8gbmV3IERhdGUobWV0YS5nZW5lcmF0ZWRBdCkudG9Mb2NhbGVTdHJpbmcoJ2VzLUFSJywge1xuICAgICAgICBkYXk6ICcyLWRpZ2l0JyxcbiAgICAgICAgbW9udGg6ICdzaG9ydCcsXG4gICAgICAgIHllYXI6ICcyLWRpZ2l0JyxcbiAgICAgICAgaG91cjogJzItZGlnaXQnLFxuICAgICAgICBtaW51dGU6ICcyLWRpZ2l0JyxcbiAgICAgIH0pXG4gICAgOiAnXHUyMDE0JztcbiAgY29uc3Qgd2FwZU1lZCA9XG4gICAgcmVzdW1lbi53YXBlX21lZGlhbm9fYmVzdF9wZXJfc2VyaWVzICE9IG51bGxcbiAgICAgID8gX2ZtdFdhcGUocmVzdW1lbi53YXBlX21lZGlhbm9fYmVzdF9wZXJfc2VyaWVzKVxuICAgICAgOiAnXHUyMDE0JztcbiAgY29uc3QgblN1YnMgPSByZXN1bWVuLm5fc3ViZmFtaWxpYXMgfHwgZG9jcy5sZW5ndGg7XG4gIGNvbnN0IG5MdDA1ID1cbiAgICByZXN1bWVuLm5fc2VyaWVzX3dhcGVfbHRfMF81ICE9IG51bGwgPyByZXN1bWVuLm5fc2VyaWVzX3dhcGVfbHRfMF81ICsgJy8nICsgblN1YnMgOiAnXHUyMDE0JztcbiAgY29uc3Qgbkx0MDMgPVxuICAgIHJlc3VtZW4ubl9zZXJpZXNfd2FwZV9sdF8wXzMgIT0gbnVsbCA/IHJlc3VtZW4ubl9zZXJpZXNfd2FwZV9sdF8wXzMgKyAnLycgKyBuU3VicyA6ICdcdTIwMTQnO1xuXG4gIGNvbnN0IGJhbm5lciA9XG4gICAgJzxkaXYgc3R5bGU9XCJtYXJnaW4tYm90dG9tOjE0cHg7cGFkZGluZzoxMnB4IDE0cHg7YmFja2dyb3VuZDp2YXIoLS1iZy1zZWNvbmRhcnkpO2JvcmRlci1sZWZ0OjNweCBzb2xpZCAjMGQ5NDg4O2JvcmRlci1yYWRpdXM6NnB4O2ZvbnQtc2l6ZToxMnB4O2NvbG9yOnZhcigtLXRleHQtc2Vjb25kYXJ5KTtsaW5lLWhlaWdodDoxLjU7ZGlzcGxheTpncmlkO2dyaWQtdGVtcGxhdGUtY29sdW1uczpyZXBlYXQoYXV0by1maXQsbWlubWF4KDE2MHB4LDFmcikpO2dhcDoxMHB4XCI+JyArXG4gICAgJzxkaXY+PGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMHB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtsZXR0ZXItc3BhY2luZzouNHB4XCI+V0FQRSBtZWRpYW5vPC9kaXY+PGRpdiBzdHlsZT1cImZvbnQtc2l6ZToyMHB4O2ZvbnQtd2VpZ2h0OjgwMDtjb2xvcjp2YXIoLS10ZXh0LXByaW1hcnkpXCI+JyArXG4gICAgd2FwZU1lZCArXG4gICAgJzwvZGl2PjwvZGl2PicgK1xuICAgICc8ZGl2PjxkaXYgc3R5bGU9XCJmb250LXNpemU6MTBweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7bGV0dGVyLXNwYWNpbmc6LjRweFwiPlN1YmZhbWlsaWFzPC9kaXY+PGRpdiBzdHlsZT1cImZvbnQtc2l6ZToyMHB4O2ZvbnQtd2VpZ2h0OjgwMDtjb2xvcjp2YXIoLS10ZXh0LXByaW1hcnkpXCI+JyArXG4gICAgblN1YnMgK1xuICAgICc8L2Rpdj48L2Rpdj4nICtcbiAgICAnPGRpdj48ZGl2IHN0eWxlPVwiZm9udC1zaXplOjEwcHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO2xldHRlci1zcGFjaW5nOi40cHhcIj5XQVBFICZsdDsgMzAlIChleGNlbGVudGUpPC9kaXY+PGRpdiBzdHlsZT1cImZvbnQtc2l6ZToyMHB4O2ZvbnQtd2VpZ2h0OjgwMDtjb2xvcjojMTZhMzRhXCI+JyArXG4gICAgbkx0MDMgK1xuICAgICc8L2Rpdj48L2Rpdj4nICtcbiAgICAnPGRpdj48ZGl2IHN0eWxlPVwiZm9udC1zaXplOjEwcHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO2xldHRlci1zcGFjaW5nOi40cHhcIj5XQVBFICZsdDsgNTAlIChidWVubyk8L2Rpdj48ZGl2IHN0eWxlPVwiZm9udC1zaXplOjIwcHg7Zm9udC13ZWlnaHQ6ODAwO2NvbG9yOiM4NGNjMTZcIj4nICtcbiAgICBuTHQwNSArXG4gICAgJzwvZGl2PjwvZGl2PicgK1xuICAgICc8ZGl2PjxkaXYgc3R5bGU9XCJmb250LXNpemU6MTBweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7bGV0dGVyLXNwYWNpbmc6LjRweFwiPlx1MDBEQWx0aW1hIGNvcnJpZGE8L2Rpdj48ZGl2IHN0eWxlPVwiZm9udC1zaXplOjEzcHg7Zm9udC13ZWlnaHQ6NjAwO2NvbG9yOnZhcigtLXRleHQtcHJpbWFyeSk7bWFyZ2luLXRvcDo0cHhcIj4nICtcbiAgICBlc2NhcGVIdG1sU2FmZShnZW5lcmF0ZWQpICtcbiAgICAnPC9kaXY+PC9kaXY+JyArXG4gICAgJzwvZGl2Pic7XG5cbiAgLy8gVGFibGEgcm93c1xuICBjb25zdCByb3dzSHRtbCA9IGRvY3NcbiAgICAubWFwKChkKSA9PiB7XG4gICAgICBjb25zdCB3YXBlID0gZC5tZXRyaWNzICYmIGQubWV0cmljcy53YXBlICE9IG51bGwgPyBkLm1ldHJpY3Mud2FwZSA6IG51bGw7XG4gICAgICBjb25zdCBiZXN0TW9kZWwgPSBkLmJlc3RNb2RlbCB8fCAnXHUyMDE0JztcbiAgICAgIGNvbnN0IGZvcmVjYXN0TWFwID0ge307XG4gICAgICAoZC5mb3JlY2FzdCB8fCBbXSkuZm9yRWFjaCgoZikgPT4ge1xuICAgICAgICBmb3JlY2FzdE1hcFtmLmRzXSA9IGYueV9oYXQ7XG4gICAgICB9KTtcbiAgICAgIGNvbnN0IG1vbnRoQ2VsbHMgPSBtb250aHNJc29cbiAgICAgICAgLm1hcChcbiAgICAgICAgICAoZHMpID0+XG4gICAgICAgICAgICAnPHRkIHN0eWxlPVwicGFkZGluZzo4cHggMTBweDt0ZXh0LWFsaWduOnJpZ2h0O2ZvbnQtdmFyaWFudC1udW1lcmljOnRhYnVsYXItbnVtcztmb250LXdlaWdodDo2MDA7Y29sb3I6dmFyKC0tdGV4dC1wcmltYXJ5KVwiPicgK1xuICAgICAgICAgICAgX2ZtdE51bShmb3JlY2FzdE1hcFtkc10pICtcbiAgICAgICAgICAgICc8L3RkPidcbiAgICAgICAgKVxuICAgICAgICAuam9pbignJyk7XG4gICAgICBjb25zdCB0b3RhbDcgPSAoZC5mb3JlY2FzdCB8fCBbXSkucmVkdWNlKChzLCBmKSA9PiBzICsgKE51bWJlcihmLnlfaGF0KSB8fCAwKSwgMCk7XG4gICAgICByZXR1cm4gKFxuICAgICAgICAnPHRyIG9uY2xpY2s9XCJvcGVuRm9yZWNhc3RTdGF0RGV0YWlsKFxcJycgK1xuICAgICAgICBlc2NhcGVIdG1sU2FmZShkLmlkKSArXG4gICAgICAgICdcXCcpXCIgc3R5bGU9XCJjdXJzb3I6cG9pbnRlcjtib3JkZXItYm90dG9tOjFweCBzb2xpZCB2YXIoLS1ib3JkZXItc3VidGxlKVwiIG9ubW91c2VvdmVyPVwidGhpcy5zdHlsZS5iYWNrZ3JvdW5kPVxcJ3ZhcigtLWJnLXNlY29uZGFyeSlcXCdcIiBvbm1vdXNlb3V0PVwidGhpcy5zdHlsZS5iYWNrZ3JvdW5kPVxcJ3RyYW5zcGFyZW50XFwnXCI+JyArXG4gICAgICAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjhweCAxMHB4O2ZvbnQtd2VpZ2h0OjcwMDtjb2xvcjp2YXIoLS10ZXh0LXByaW1hcnkpXCI+JyArXG4gICAgICAgIGVzY2FwZUh0bWxTYWZlKGQuc3ViZmFtaWxpYSB8fCBkLmlkKSArXG4gICAgICAgICc8L3RkPicgK1xuICAgICAgICAnPHRkIHN0eWxlPVwicGFkZGluZzo4cHggMTBweDtmb250LXNpemU6MTFweDtjb2xvcjp2YXIoLS10ZXh0LXNlY29uZGFyeSlcIj4nICtcbiAgICAgICAgZXNjYXBlSHRtbFNhZmUoYmVzdE1vZGVsKSArXG4gICAgICAgICc8L3RkPicgK1xuICAgICAgICAnPHRkIHN0eWxlPVwicGFkZGluZzo4cHggMTBweDt0ZXh0LWFsaWduOmNlbnRlclwiPjxzcGFuIHN0eWxlPVwiZGlzcGxheTppbmxpbmUtYmxvY2s7cGFkZGluZzozcHggOHB4O2JvcmRlci1yYWRpdXM6MTJweDtiYWNrZ3JvdW5kOicgK1xuICAgICAgICBfd2FwZUJhZGdlQ29sb3Iod2FwZSkgK1xuICAgICAgICAnO2NvbG9yOiNmZmY7Zm9udC1zaXplOjExcHg7Zm9udC13ZWlnaHQ6NzAwXCI+JyArXG4gICAgICAgIF9mbXRXYXBlKHdhcGUpICtcbiAgICAgICAgJzwvc3Bhbj48L3RkPicgK1xuICAgICAgICBtb250aENlbGxzICtcbiAgICAgICAgJzx0ZCBzdHlsZT1cInBhZGRpbmc6OHB4IDEwcHg7dGV4dC1hbGlnbjpyaWdodDtmb250LXZhcmlhbnQtbnVtZXJpYzp0YWJ1bGFyLW51bXM7Zm9udC13ZWlnaHQ6NzAwO2NvbG9yOiMwZDk0ODg7YmFja2dyb3VuZDp2YXIoLS1iZy1zZWNvbmRhcnkpXCI+JyArXG4gICAgICAgIF9mbXROdW0odG90YWw3KSArXG4gICAgICAgICc8L3RkPicgK1xuICAgICAgICAnPC90cj4nXG4gICAgICApO1xuICAgIH0pXG4gICAgLmpvaW4oJycpO1xuXG4gIGNvbnN0IG1vbnRoSGVhZGVyc0h0bWwgPSBtb250aEhlYWRlcnNcbiAgICAubWFwKFxuICAgICAgKG0pID0+XG4gICAgICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjhweCAxMHB4O3RleHQtYWxpZ246cmlnaHQ7Zm9udC1zaXplOjEwcHg7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO2xldHRlci1zcGFjaW5nOi40cHg7Y29sb3I6Izk0YTNiOFwiPicgK1xuICAgICAgICBlc2NhcGVIdG1sU2FmZShtKSArXG4gICAgICAgICc8L3RoPidcbiAgICApXG4gICAgLmpvaW4oJycpO1xuXG4gIGNvbnN0IHRhYmxlID1cbiAgICAnPGRpdiBzdHlsZT1cIm92ZXJmbG93OmF1dG87Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1ib3JkZXItc3VidGxlKTtib3JkZXItcmFkaXVzOjhweFwiPicgK1xuICAgICc8dGFibGUgc3R5bGU9XCJ3aWR0aDoxMDAlO2JvcmRlci1jb2xsYXBzZTpjb2xsYXBzZTtmb250LXNpemU6MTJweFwiPicgK1xuICAgICc8dGhlYWQgc3R5bGU9XCJiYWNrZ3JvdW5kOiMwZjE3MmE7Y29sb3I6I2ZmZlwiPjx0cj4nICtcbiAgICAnPHRoIHN0eWxlPVwicGFkZGluZzo4cHggMTBweDt0ZXh0LWFsaWduOmxlZnQ7Zm9udC1zaXplOjEwcHg7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO2xldHRlci1zcGFjaW5nOi40cHhcIj5TdWJmYW1pbGlhPC90aD4nICtcbiAgICAnPHRoIHN0eWxlPVwicGFkZGluZzo4cHggMTBweDt0ZXh0LWFsaWduOmxlZnQ7Zm9udC1zaXplOjEwcHg7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO2xldHRlci1zcGFjaW5nOi40cHhcIj5Nb2RlbG88L3RoPicgK1xuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjhweCAxMHB4O3RleHQtYWxpZ246Y2VudGVyO2ZvbnQtc2l6ZToxMHB4O3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtsZXR0ZXItc3BhY2luZzouNHB4XCI+V0FQRTwvdGg+JyArXG4gICAgbW9udGhIZWFkZXJzSHRtbCArXG4gICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6OHB4IDEwcHg7dGV4dC1hbGlnbjpyaWdodDtmb250LXNpemU6MTBweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7bGV0dGVyLXNwYWNpbmc6LjRweDtiYWNrZ3JvdW5kOiMxMzRlNGFcIj5Ub3RhbCA3bTwvdGg+JyArXG4gICAgJzwvdHI+PC90aGVhZD4nICtcbiAgICAnPHRib2R5PicgK1xuICAgIHJvd3NIdG1sICtcbiAgICAnPC90Ym9keT48L3RhYmxlPjwvZGl2Pic7XG5cbiAgY29uc3QgZm9vdGVyID1cbiAgICAnPGRpdiBzdHlsZT1cIm1hcmdpbi10b3A6MTJweDtmb250LXNpemU6MTFweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTtsaW5lLWhlaWdodDoxLjVcIj4nICtcbiAgICAnPGI+Q1x1MDBGM21vIGxlZXI8L2I+OiBXQVBFIChXZWlnaHRlZCBBYnNvbHV0ZSBQZXJjZW50YWdlIEVycm9yKSBtaWRlIGVsIGVycm9yIGRlbCBtb2RlbG8gcmVsYXRpdm8gYWwgdG90YWwgcmVhbDogJmx0OzMwJSBleGNlbGVudGUsIDMwLTUwJSBidWVubywgNTAtNzAlIGFjZXB0YWJsZSwgJmd0OzcwJSBwb2JyZS4gQ2xpY2sgZW4gZmlsYSBwYXJhIGRldGFsbGUgKyBnclx1MDBFMWZpY28uICcgK1xuICAgICdTZSBlbGlnZSBlbCBtb2RlbG8gY29uIG1lbm9yIFdBUEUgcG9yIHNlcmllIHRyYXMgYmFja3Rlc3Qgcm9sbGluZy1vcmlnaW4gKGg9MiwgdmVudGFuYXM9MykuJyArXG4gICAgJzwvZGl2Pic7XG5cbiAgY29udC5pbm5lckhUTUwgPSAnPGRpdiBzdHlsZT1cInBhZGRpbmc6MThweFwiPicgKyBiYW5uZXIgKyB0YWJsZSArIGZvb3RlciArICc8L2Rpdj4nO1xufVxuXG4vLyBDYWNoZSBoaXN0b3JpYSBhZ3JlZ2FkYSBwb3Igc3ViZmFtaWxpYSAocGFyYSBnclx1MDBFMWZpY28gZGV0YWxsZSkuXG5hc3luYyBmdW5jdGlvbiBfbG9hZEZvcmVjYXN0U3RhdEhpc3RvcnkoKSB7XG4gIGlmIChfZm9yZWNhc3RTdGF0SGlzdG9yeUNhY2hlKSByZXR1cm4gX2ZvcmVjYXN0U3RhdEhpc3RvcnlDYWNoZTtcbiAgLy8gTGEgaGlzdG9yaWEgc29sbyBlc3RcdTAwRTEgZW4gQlEgKH4xMCBhXHUwMEYxb3MgQmFyYWxkbyArIDEyIG1lc2VzIFNoaW1hbm8pLiBDb21vXG4gIC8vIGVsIHBpcGVsaW5lIGxhIGVzY3JpYmUgYSBDU1YgbG9jYWwsIGFjXHUwMEUxIG5vIGxhIHBvZGVtb3MgbGVlci4gQWx0ZXJuYXRpdmE6XG4gIC8vIHVzYXIgc2t1X3ZlbnRhc19zbmFwc2hvdCBxdWUgdGllbmUgdmVudGFzIG1lbnN1YWxlcyBwZXJvIHNvbG8gZ3J1cG8gUEVTQ0EuXG4gIC8vIEVuIEYyQi4yIHNvbG8gbW9zdHJhbW9zIGZvcmVjYXN0K0lDIChzaW4gb3ZlcmxheSBoaXN0b3JpYSBwb3IgYWhvcmEpLlxuICBfZm9yZWNhc3RTdGF0SGlzdG9yeUNhY2hlID0ge307XG4gIHJldHVybiBfZm9yZWNhc3RTdGF0SGlzdG9yeUNhY2hlO1xufVxuXG5mdW5jdGlvbiBfYnVpbGRGb3JlY2FzdENoYXJ0U3ZnKGRvYykge1xuICBjb25zdCBmYyA9IGRvYy5mb3JlY2FzdCB8fCBbXTtcbiAgaWYgKCFmYy5sZW5ndGgpXG4gICAgcmV0dXJuICc8ZGl2IHN0eWxlPVwicGFkZGluZzozMHB4O3RleHQtYWxpZ246Y2VudGVyO2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpXCI+U2luIGRhdG9zIGRlIGZvcmVjYXN0PC9kaXY+JztcbiAgLy8gRGltZW5zaW9uZXNcbiAgY29uc3QgVyA9IDY0MCxcbiAgICBIID0gMjYwO1xuICBjb25zdCBwYWRMID0gNTAsXG4gICAgcGFkUiA9IDIwLFxuICAgIHBhZFQgPSAyMCxcbiAgICBwYWRCID0gNDA7XG4gIGNvbnN0IGlubmVyVyA9IFcgLSBwYWRMIC0gcGFkUjtcbiAgY29uc3QgaW5uZXJIID0gSCAtIHBhZFQgLSBwYWRCO1xuXG4gIC8vIFkgcmFuZ2U6IG1heChoaTgwKSAqIDEuMVxuICBjb25zdCBtYXhZID0gTWF0aC5tYXgoMSwgLi4uZmMubWFwKChmKSA9PiBOdW1iZXIoZi5oaTgwKSB8fCBOdW1iZXIoZi55X2hhdCkgfHwgMCkpO1xuICBjb25zdCBtaW5ZID0gMDtcbiAgY29uc3Qgc2NhbGVYID0gKGkpID0+IHBhZEwgKyAoaW5uZXJXICogaSkgLyBNYXRoLm1heCgxLCBmYy5sZW5ndGggLSAxKTtcbiAgY29uc3Qgc2NhbGVZID0gKHYpID0+IHBhZFQgKyBpbm5lckggLSAoaW5uZXJIICogKHYgLSBtaW5ZKSkgLyAobWF4WSAtIG1pblkpO1xuXG4gIC8vIEdyaWQgKyBlamUgWVxuICBjb25zdCB5VGlja3MgPSBbMCwgMC4yNSwgMC41LCAwLjc1LCAxXVxuICAgIC5tYXAoKHIpID0+IHtcbiAgICAgIGNvbnN0IHZhbCA9IG1pblkgKyByICogKG1heFkgLSBtaW5ZKTtcbiAgICAgIGNvbnN0IHl5ID0gc2NhbGVZKHZhbCk7XG4gICAgICByZXR1cm4gKFxuICAgICAgICAnPGxpbmUgeDE9XCInICtcbiAgICAgICAgcGFkTCArXG4gICAgICAgICdcIiB5MT1cIicgK1xuICAgICAgICB5eSArXG4gICAgICAgICdcIiB4Mj1cIicgK1xuICAgICAgICAoVyAtIHBhZFIpICtcbiAgICAgICAgJ1wiIHkyPVwiJyArXG4gICAgICAgIHl5ICtcbiAgICAgICAgJ1wiIHN0cm9rZT1cIiNlMmU4ZjBcIiBzdHJva2Utd2lkdGg9XCIxXCIvPicgK1xuICAgICAgICAnPHRleHQgeD1cIicgK1xuICAgICAgICAocGFkTCAtIDYpICtcbiAgICAgICAgJ1wiIHk9XCInICtcbiAgICAgICAgKHl5ICsgNCkgK1xuICAgICAgICAnXCIgdGV4dC1hbmNob3I9XCJlbmRcIiBmb250LXNpemU9XCIxMFwiIGZpbGw9XCIjNjQ3NDhiXCI+JyArXG4gICAgICAgIF9mbXROdW0odmFsKSArXG4gICAgICAgICc8L3RleHQ+J1xuICAgICAgKTtcbiAgICB9KVxuICAgIC5qb2luKCcnKTtcblxuICAvLyBFamUgWCAobWVzZXMpXG4gIGNvbnN0IHhMYWJlbHMgPSBmY1xuICAgIC5tYXAoKGYsIGkpID0+IHtcbiAgICAgIGNvbnN0IHh4ID0gc2NhbGVYKGkpO1xuICAgICAgcmV0dXJuIChcbiAgICAgICAgJzx0ZXh0IHg9XCInICtcbiAgICAgICAgeHggK1xuICAgICAgICAnXCIgeT1cIicgK1xuICAgICAgICAoSCAtIHBhZEIgKyAxNSkgK1xuICAgICAgICAnXCIgdGV4dC1hbmNob3I9XCJtaWRkbGVcIiBmb250LXNpemU9XCIxMFwiIGZpbGw9XCIjNjQ3NDhiXCI+JyArXG4gICAgICAgIF9mbXREc1Nob3J0KGYuZHMpICtcbiAgICAgICAgJzwvdGV4dD4nXG4gICAgICApO1xuICAgIH0pXG4gICAgLmpvaW4oJycpO1xuXG4gIC8vIEludGVydmFsbyBjb25maWFuemEgKGJhbmQpXG4gIGNvbnN0IGJhbmRQb2ludHMgPVxuICAgIGZjLm1hcCgoZiwgaSkgPT4gc2NhbGVYKGkpICsgJywnICsgc2NhbGVZKE51bWJlcihmLmhpODApIHx8IDApKS5qb2luKCcgJykgK1xuICAgICcgJyArXG4gICAgZmNcbiAgICAgIC5zbGljZSgpXG4gICAgICAucmV2ZXJzZSgpXG4gICAgICAubWFwKChmLCBpKSA9PiBzY2FsZVgoZmMubGVuZ3RoIC0gMSAtIGkpICsgJywnICsgc2NhbGVZKE51bWJlcihmLmxvODApIHx8IDApKVxuICAgICAgLmpvaW4oJyAnKTtcbiAgY29uc3QgYmFuZCA9ICc8cG9seWdvbiBwb2ludHM9XCInICsgYmFuZFBvaW50cyArICdcIiBmaWxsPVwiIzBkOTQ4ODMzXCIgc3Ryb2tlPVwibm9uZVwiLz4nO1xuXG4gIC8vIExpbmUgZm9yZWNhc3QgKyBwdW50b3NcbiAgY29uc3QgbGluZVBvaW50cyA9IGZjLm1hcCgoZiwgaSkgPT4gc2NhbGVYKGkpICsgJywnICsgc2NhbGVZKE51bWJlcihmLnlfaGF0KSB8fCAwKSkuam9pbignICcpO1xuICBjb25zdCBsaW5lID1cbiAgICAnPHBvbHlsaW5lIHBvaW50cz1cIicgK1xuICAgIGxpbmVQb2ludHMgK1xuICAgICdcIiBmaWxsPVwibm9uZVwiIHN0cm9rZT1cIiMwZDk0ODhcIiBzdHJva2Utd2lkdGg9XCIyLjVcIiBzdHJva2UtbGluZWpvaW49XCJyb3VuZFwiLz4nO1xuICBjb25zdCBwb2ludHMgPSBmY1xuICAgIC5tYXAoXG4gICAgICAoZiwgaSkgPT5cbiAgICAgICAgJzxjaXJjbGUgY3g9XCInICtcbiAgICAgICAgc2NhbGVYKGkpICtcbiAgICAgICAgJ1wiIGN5PVwiJyArXG4gICAgICAgIHNjYWxlWShOdW1iZXIoZi55X2hhdCkgfHwgMCkgK1xuICAgICAgICAnXCIgcj1cIjRcIiBmaWxsPVwiIzBkOTQ4OFwiIHN0cm9rZT1cIiNmZmZcIiBzdHJva2Utd2lkdGg9XCIyXCIvPidcbiAgICApXG4gICAgLmpvaW4oJycpO1xuICAvLyBMYWJlbHMgZGUgdmFsb3JcbiAgY29uc3QgdmFsdWVMYWJlbHMgPSBmY1xuICAgIC5tYXAoKGYsIGkpID0+IHtcbiAgICAgIGNvbnN0IHh4ID0gc2NhbGVYKGkpO1xuICAgICAgY29uc3QgeXkgPSBzY2FsZVkoTnVtYmVyKGYueV9oYXQpIHx8IDApO1xuICAgICAgcmV0dXJuIChcbiAgICAgICAgJzx0ZXh0IHg9XCInICtcbiAgICAgICAgeHggK1xuICAgICAgICAnXCIgeT1cIicgK1xuICAgICAgICAoeXkgLSA4KSArXG4gICAgICAgICdcIiB0ZXh0LWFuY2hvcj1cIm1pZGRsZVwiIGZvbnQtc2l6ZT1cIjEwXCIgZm9udC13ZWlnaHQ9XCI3MDBcIiBmaWxsPVwiIzBmNzY2ZVwiPicgK1xuICAgICAgICBfZm10TnVtKGYueV9oYXQpICtcbiAgICAgICAgJzwvdGV4dD4nXG4gICAgICApO1xuICAgIH0pXG4gICAgLmpvaW4oJycpO1xuXG4gIGNvbnN0IHN2ZyA9XG4gICAgJzxzdmcgdmlld0JveD1cIjAgMCAnICtcbiAgICBXICtcbiAgICAnICcgK1xuICAgIEggK1xuICAgICdcIiBzdHlsZT1cIndpZHRoOjEwMCU7bWF4LXdpZHRoOjgwMHB4O2hlaWdodDphdXRvXCI+JyArXG4gICAgJzxyZWN0IHg9XCIwXCIgeT1cIjBcIiB3aWR0aD1cIicgK1xuICAgIFcgK1xuICAgICdcIiBoZWlnaHQ9XCInICtcbiAgICBIICtcbiAgICAnXCIgZmlsbD1cIiNmZmZcIi8+JyArXG4gICAgeVRpY2tzICtcbiAgICB4TGFiZWxzICtcbiAgICBiYW5kICtcbiAgICBsaW5lICtcbiAgICBwb2ludHMgK1xuICAgIHZhbHVlTGFiZWxzICtcbiAgICAnPC9zdmc+JztcbiAgcmV0dXJuIHN2Zztcbn1cblxud2luZG93Lm9wZW5Gb3JlY2FzdFN0YXREZXRhaWwgPSBmdW5jdGlvbiAoc3ViSWQpIHtcbiAgaWYgKCFfZm9yZWNhc3RTdGF0RG9jcykgcmV0dXJuO1xuICBjb25zdCBkb2MgPSBfZm9yZWNhc3RTdGF0RG9jcy5maW5kKChkKSA9PiBkLmlkID09PSBzdWJJZCk7XG4gIGlmICghZG9jKSB7XG4gICAgYWxlcnQoJ05vIHNlIGVuY29udHJcdTAwRjMgZGV0YWxsZSBkZSAnICsgc3ViSWQpO1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCBleGlzdGluZyA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdmb3JlY2FzdC1zdGF0LWRldGFpbCcpO1xuICBpZiAoZXhpc3RpbmcpIGV4aXN0aW5nLnJlbW92ZSgpO1xuXG4gIGNvbnN0IGVsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2Jyk7XG4gIGVsLmlkID0gJ2ZvcmVjYXN0LXN0YXQtZGV0YWlsJztcbiAgZWwuc3R5bGUuY3NzVGV4dCA9XG4gICAgJ3Bvc2l0aW9uOmZpeGVkO2luc2V0OjA7YmFja2dyb3VuZDpyZ2JhKDE1LDIzLDQyLC42NSk7ei1pbmRleDoyMTAwO2Rpc3BsYXk6ZmxleDthbGlnbi1pdGVtczpjZW50ZXI7anVzdGlmeS1jb250ZW50OmNlbnRlcjtwYWRkaW5nOjJ2aCc7XG4gIGVsLm9uY2xpY2sgPSAoZXYpID0+IHtcbiAgICBpZiAoZXYudGFyZ2V0ID09PSBlbCkgZWwucmVtb3ZlKCk7XG4gIH07XG5cbiAgY29uc3Qgd2FwZSA9IGRvYy5tZXRyaWNzICYmIGRvYy5tZXRyaWNzLndhcGU7XG4gIGNvbnN0IGJpYXMgPSBkb2MubWV0cmljcyAmJiBkb2MubWV0cmljcy5iaWFzO1xuICBjb25zdCBtYWUgPSBkb2MubWV0cmljcyAmJiBkb2MubWV0cmljcy5tYWU7XG4gIGNvbnN0IHJtc2UgPSBkb2MubWV0cmljcyAmJiBkb2MubWV0cmljcy5ybXNlO1xuICBjb25zdCBiZXN0TW9kZWwgPSBkb2MuYmVzdE1vZGVsIHx8ICdcdTIwMTQnO1xuICBjb25zdCB2ZXJzaW9uSWQgPSBkb2MudmVyc2lvbklkIHx8ICdcdTIwMTQnO1xuICBjb25zdCBzdmdIdG1sID0gX2J1aWxkRm9yZWNhc3RDaGFydFN2Zyhkb2MpO1xuXG4gIGNvbnN0IG1ldHJpY3NIdG1sID1cbiAgICAnPGRpdiBzdHlsZT1cImRpc3BsYXk6Z3JpZDtncmlkLXRlbXBsYXRlLWNvbHVtbnM6cmVwZWF0KGF1dG8tZml0LG1pbm1heCgxMjBweCwxZnIpKTtnYXA6MTBweDttYXJnaW46MTRweCAwXCI+JyArXG4gICAgJzxkaXYgc3R5bGU9XCJwYWRkaW5nOjEwcHg7YmFja2dyb3VuZDp2YXIoLS1iZy1zZWNvbmRhcnkpO2JvcmRlci1yYWRpdXM6NnB4XCI+PGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMHB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZVwiPk1vZGVsbzwvZGl2PjxkaXYgc3R5bGU9XCJmb250LXdlaWdodDo3MDBcIj4nICtcbiAgICBlc2NhcGVIdG1sU2FmZShiZXN0TW9kZWwpICtcbiAgICAnPC9kaXY+PC9kaXY+JyArXG4gICAgJzxkaXYgc3R5bGU9XCJwYWRkaW5nOjEwcHg7YmFja2dyb3VuZDp2YXIoLS1iZy1zZWNvbmRhcnkpO2JvcmRlci1yYWRpdXM6NnB4XCI+PGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMHB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZVwiPldBUEU8L2Rpdj48ZGl2IHN0eWxlPVwiZm9udC13ZWlnaHQ6NzAwO2NvbG9yOicgK1xuICAgIF93YXBlQmFkZ2VDb2xvcih3YXBlKSArXG4gICAgJ1wiPicgK1xuICAgIF9mbXRXYXBlKHdhcGUpICtcbiAgICAnPC9kaXY+PC9kaXY+JyArXG4gICAgJzxkaXYgc3R5bGU9XCJwYWRkaW5nOjEwcHg7YmFja2dyb3VuZDp2YXIoLS1iZy1zZWNvbmRhcnkpO2JvcmRlci1yYWRpdXM6NnB4XCI+PGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMHB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZVwiPkJpYXM8L2Rpdj48ZGl2IHN0eWxlPVwiZm9udC13ZWlnaHQ6NzAwXCI+JyArXG4gICAgKGJpYXMgIT0gbnVsbCA/IChiaWFzICogMTAwKS50b0ZpeGVkKDApICsgJyUnIDogJ1x1MjAxNCcpICtcbiAgICAnPC9kaXY+PC9kaXY+JyArXG4gICAgJzxkaXYgc3R5bGU9XCJwYWRkaW5nOjEwcHg7YmFja2dyb3VuZDp2YXIoLS1iZy1zZWNvbmRhcnkpO2JvcmRlci1yYWRpdXM6NnB4XCI+PGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMHB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZVwiPk1BRTwvZGl2PjxkaXYgc3R5bGU9XCJmb250LXdlaWdodDo3MDBcIj4nICtcbiAgICBfZm10TnVtKG1hZSkgK1xuICAgICc8L2Rpdj48L2Rpdj4nICtcbiAgICAnPGRpdiBzdHlsZT1cInBhZGRpbmc6MTBweDtiYWNrZ3JvdW5kOnZhcigtLWJnLXNlY29uZGFyeSk7Ym9yZGVyLXJhZGl1czo2cHhcIj48ZGl2IHN0eWxlPVwiZm9udC1zaXplOjEwcHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlXCI+Uk1TRTwvZGl2PjxkaXYgc3R5bGU9XCJmb250LXdlaWdodDo3MDBcIj4nICtcbiAgICBfZm10TnVtKHJtc2UpICtcbiAgICAnPC9kaXY+PC9kaXY+JyArXG4gICAgJzwvZGl2Pic7XG5cbiAgY29uc3QgdGFibGVIdG1sID1cbiAgICAnPHRhYmxlIHN0eWxlPVwid2lkdGg6MTAwJTtmb250LXNpemU6MTJweDtib3JkZXItY29sbGFwc2U6Y29sbGFwc2U7bWFyZ2luLXRvcDoxMHB4XCI+JyArXG4gICAgJzx0aGVhZCBzdHlsZT1cImJhY2tncm91bmQ6IzBmMTcyYTtjb2xvcjojZmZmXCI+PHRyPicgK1xuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjZweCAxMHB4O3RleHQtYWxpZ246bGVmdFwiPk1lczwvdGg+JyArXG4gICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6NnB4IDEwcHg7dGV4dC1hbGlnbjpyaWdodFwiPkZvcmVjYXN0PC90aD4nICtcbiAgICAnPHRoIHN0eWxlPVwicGFkZGluZzo2cHggMTBweDt0ZXh0LWFsaWduOnJpZ2h0XCI+SUMgODAlIGJham88L3RoPicgK1xuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjZweCAxMHB4O3RleHQtYWxpZ246cmlnaHRcIj5JQyA4MCUgYWx0bzwvdGg+JyArXG4gICAgJzwvdHI+PC90aGVhZD48dGJvZHk+JyArXG4gICAgKGRvYy5mb3JlY2FzdCB8fCBbXSlcbiAgICAgIC5tYXAoXG4gICAgICAgIChmKSA9PlxuICAgICAgICAgICc8dHIgc3R5bGU9XCJib3JkZXItYm90dG9tOjFweCBzb2xpZCB2YXIoLS1ib3JkZXItc3VidGxlKVwiPjx0ZCBzdHlsZT1cInBhZGRpbmc6NnB4IDEwcHhcIj4nICtcbiAgICAgICAgICBlc2NhcGVIdG1sU2FmZShfZm10RHNTaG9ydChmLmRzKSkgK1xuICAgICAgICAgICc8L3RkPicgK1xuICAgICAgICAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjZweCAxMHB4O3RleHQtYWxpZ246cmlnaHQ7Zm9udC13ZWlnaHQ6NzAwXCI+JyArXG4gICAgICAgICAgX2ZtdE51bShmLnlfaGF0KSArXG4gICAgICAgICAgJzwvdGQ+JyArXG4gICAgICAgICAgJzx0ZCBzdHlsZT1cInBhZGRpbmc6NnB4IDEwcHg7dGV4dC1hbGlnbjpyaWdodDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKVwiPicgK1xuICAgICAgICAgIF9mbXROdW0oZi5sbzgwKSArXG4gICAgICAgICAgJzwvdGQ+JyArXG4gICAgICAgICAgJzx0ZCBzdHlsZT1cInBhZGRpbmc6NnB4IDEwcHg7dGV4dC1hbGlnbjpyaWdodDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKVwiPicgK1xuICAgICAgICAgIF9mbXROdW0oZi5oaTgwKSArXG4gICAgICAgICAgJzwvdGQ+PC90cj4nXG4gICAgICApXG4gICAgICAuam9pbignJykgK1xuICAgICc8L3Rib2R5PjwvdGFibGU+JztcblxuICBjb25zdCBjb250ZW50ID1cbiAgICAnPGRpdiBzdHlsZT1cImJhY2tncm91bmQ6dmFyKC0tYmctZWxldmF0ZWQpO2JvcmRlci1yYWRpdXM6MTJweDtwYWRkaW5nOjI0cHg7bWF4LXdpZHRoOjgyMHB4O3dpZHRoOjEwMCU7bWF4LWhlaWdodDo5NnZoO292ZXJmbG93OmF1dG87Ym94LXNoYWRvdzowIDIwcHggNjBweCByZ2JhKDAsMCwwLC40KVwiPicgK1xuICAgICc8ZGl2IHN0eWxlPVwiZGlzcGxheTpmbGV4O2p1c3RpZnktY29udGVudDpzcGFjZS1iZXR3ZWVuO2FsaWduLWl0ZW1zOmNlbnRlcjttYXJnaW4tYm90dG9tOjEwcHhcIj4nICtcbiAgICAnPGRpdj48ZGl2IHN0eWxlPVwiZm9udC1zaXplOjExcHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO2xldHRlci1zcGFjaW5nOi40cHhcIj5TdWJmYW1pbGlhPC9kaXY+PGRpdiBzdHlsZT1cImZvbnQtc2l6ZToyMnB4O2ZvbnQtd2VpZ2h0OjgwMFwiPicgK1xuICAgIGVzY2FwZUh0bWxTYWZlKGRvYy5zdWJmYW1pbGlhIHx8IGRvYy5pZCkgK1xuICAgICc8L2Rpdj48L2Rpdj4nICtcbiAgICAnPGJ1dHRvbiBvbmNsaWNrPVwiZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoXFwnZm9yZWNhc3Qtc3RhdC1kZXRhaWxcXCcpLnJlbW92ZSgpXCIgc3R5bGU9XCJiYWNrZ3JvdW5kOnRyYW5zcGFyZW50O2JvcmRlcjoxcHggc29saWQgdmFyKC0tYm9yZGVyLXN1YnRsZSk7Ym9yZGVyLXJhZGl1czo2cHg7cGFkZGluZzo2cHggMTJweDtjdXJzb3I6cG9pbnRlcjtmb250LXdlaWdodDo3MDBcIj5DZXJyYXI8L2J1dHRvbj4nICtcbiAgICAnPC9kaXY+JyArXG4gICAgbWV0cmljc0h0bWwgK1xuICAgICc8ZGl2IHN0eWxlPVwiYmFja2dyb3VuZDojZmZmO3BhZGRpbmc6OHB4O2JvcmRlci1yYWRpdXM6OHB4O21hcmdpbi10b3A6MTBweDtib3JkZXI6MXB4IHNvbGlkIHZhcigtLWJvcmRlci1zdWJ0bGUpXCI+JyArXG4gICAgc3ZnSHRtbCArXG4gICAgJzwvZGl2PicgK1xuICAgIHRhYmxlSHRtbCArXG4gICAgJzxkaXYgc3R5bGU9XCJtYXJnaW4tdG9wOjE0cHg7Zm9udC1zaXplOjExcHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZClcIj5WZXJzaW9uOiA8Y29kZT4nICtcbiAgICBlc2NhcGVIdG1sU2FmZSh2ZXJzaW9uSWQpICtcbiAgICAnPC9jb2RlPiBcdTAwQjcgQXBwcm9hY2g6ICcgK1xuICAgIGVzY2FwZUh0bWxTYWZlKChkb2MuY29uZmlnIHx8IHt9KS5hcHByb2FjaCB8fCAnXHUyMDE0JykgK1xuICAgICc8L2Rpdj4nICtcbiAgICAnPC9kaXY+JztcbiAgZWwuaW5uZXJIVE1MID0gY29udGVudDtcbiAgZG9jdW1lbnQuYm9keS5hcHBlbmRDaGlsZChlbCk7XG59O1xuXG53aW5kb3cub3BlbkZvcmVjYXN0TW9kYWwgPSBhc3luYyBmdW5jdGlvbiAoKSB7XG4gIGlmICghX2NhbkZvcmVjYXN0KCkpIHtcbiAgICBhbGVydCgnRk9SRUNBU1QgZXMgc29sbyBwYXJhIE1hcmlhbm8gKGFkbWluKS4nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgY29uc3QgZWwgPSBfcmVuZGVyTW9kYWxTaGVsbCgpO1xuICBlbC5zdHlsZS5kaXNwbGF5ID0gJ2Jsb2NrJztcbiAgLy8gdjEwOTgrIEZhc2UgMTogY2FyZ2FyIFNhbGVzIFBsYW5zIGNhY2hlcyArIHJlbmRlcml6YXIgdGFiIGRlZmF1bHQuXG4gIF9yZW5kZXJTYWxlc1BsYW5zVGFiKCk7XG4gIF9sb2FkU2FsZXNQbGFuQ2FjaGVzKClcbiAgICAudGhlbihfcmVuZGVyU2FsZXNQbGFuc1RhYilcbiAgICAuY2F0Y2goKCkgPT4ge30pO1xuICAvLyBMZWdhY3k6IHNuYXBzaG90IHNvbG8gc2UgY2FyZ2EgbGF6eSBzaSBlbCB1c2VyIGNhbWJpYSBhIHRhYiBMZWdhY3kuXG4gIGlmIChfZm9yZWNhc3RMb2FkaW5nKSByZXR1cm47XG4gIGlmICghX2ZvcmVjYXN0U25hcHNob3QpIHtcbiAgICBfZm9yZWNhc3RMb2FkaW5nID0gdHJ1ZTtcbiAgICBjb25zdCBzdGF0cyA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdmb3JlY2FzdC1zdGF0cycpO1xuICAgIGlmIChzdGF0cykgc3RhdHMudGV4dENvbnRlbnQgPSAnQ2FyZ2FuZG8gc25hcHNob3QgZGUgdmVudGFzLi4uJztcbiAgICB0cnkge1xuICAgICAgYXdhaXQgX2xvYWRTbmFwc2hvdCgpO1xuICAgICAgaWYgKHN0YXRzKSBzdGF0cy50ZXh0Q29udGVudCA9IF9mb3JlY2FzdFNuYXBzaG90LmNvdW50ICsgJyBTS1VzIGVuIHNuYXBzaG90IGhpc3Rvcmljbyc7XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgaWYgKHN0YXRzKSBzdGF0cy50ZXh0Q29udGVudCA9ICdFcnJvciBjYXJnYW5kbyBzbmFwc2hvdDogJyArICgoZSAmJiBlLm1lc3NhZ2UpIHx8IGUpO1xuICAgICAgLy8gTm8gYWxlcnQgXHUyMDE0IGxlZ2FjeSBlcyBvcHQtaW4sIG5vIGJsb3F1ZWEgYWwgdXN1YXJpbyBzaSBzb2xvIHZhIGEgc3ViaXIgU2FsZXMgUGxhbnMuXG4gICAgICBjb25zb2xlLndhcm4oJ1tGT1JFQ0FTVF0gc25hcHNob3QgbG9hZCBmYWlsIChsZWdhY3kgdGFiKScsIGUpO1xuICAgIH0gZmluYWxseSB7XG4gICAgICBfZm9yZWNhc3RMb2FkaW5nID0gZmFsc2U7XG4gICAgfVxuICB9IGVsc2Uge1xuICAgIGNvbnN0IHN0YXRzID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2ZvcmVjYXN0LXN0YXRzJyk7XG4gICAgaWYgKHN0YXRzKSBzdGF0cy50ZXh0Q29udGVudCA9IF9mb3JlY2FzdFNuYXBzaG90LmNvdW50ICsgJyBTS1VzIGVuIHNuYXBzaG90IGhpc3Rvcmljbyc7XG4gIH1cbn07XG5cbndpbmRvdy5jbG9zZUZvcmVjYXN0TW9kYWwgPSBmdW5jdGlvbiAoKSB7XG4gIGNvbnN0IGVsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2ZvcmVjYXN0LW1vZGFsJyk7XG4gIGlmIChlbCkgZWwuc3R5bGUuZGlzcGxheSA9ICdub25lJztcbn07XG5cbndpbmRvdy5vbkZvcmVjYXN0U2FsZXNQbGFuRmlsZSA9IGFzeW5jIGZ1bmN0aW9uIChldmVudCkge1xuICBjb25zdCBmaWxlID0gZXZlbnQgJiYgZXZlbnQudGFyZ2V0ICYmIGV2ZW50LnRhcmdldC5maWxlcyAmJiBldmVudC50YXJnZXQuZmlsZXNbMF07XG4gIGlmICghZmlsZSkgcmV0dXJuO1xuICB0cnkge1xuICAgIGlmICghX2ZvcmVjYXN0U25hcHNob3QpIGF3YWl0IF9sb2FkU25hcHNob3QoKTtcbiAgICBjb25zdCBidWYgPSBhd2FpdCBmaWxlLmFycmF5QnVmZmVyKCk7XG4gICAgaWYgKHR5cGVvZiBYTFNYID09PSAndW5kZWZpbmVkJykge1xuICAgICAgYWxlcnQoJ1hMU1ggbm8gY2FyZ2FkbycpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBjb25zdCB3YiA9IFhMU1gucmVhZChidWYsIHsgdHlwZTogJ2FycmF5JyB9KTtcbiAgICBjb25zdCBzaGVldCA9IHdiLlNoZWV0c1t3Yi5TaGVldE5hbWVzWzBdXTtcbiAgICBjb25zdCByb3dzID0gWExTWC51dGlscy5zaGVldF90b19qc29uKHNoZWV0LCB7IGhlYWRlcjogMSwgZGVmdmFsOiBudWxsLCByYXc6IHRydWUgfSk7XG4gICAgY29uc3QgcGFyc2VkID0gX3BhcnNlU2FsZXNQbGFuUm93cyhyb3dzKTtcbiAgICBpZiAoIXBhcnNlZC5sZW5ndGgpIHtcbiAgICAgIGFsZXJ0KCdFbCBFeGNlbCBlc3RhIHZhY2lvIG8gbm8gdGllbmUgZmlsYXMgdmFsaWRhcy4nKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgX2ZvcmVjYXN0U2FsZXNQbGFuID0gcGFyc2VkO1xuICAgIGNvbnN0IGhveSA9IG5ldyBEYXRlKCk7XG4gICAgX2ZvcmVjYXN0Um93cyA9IF9jb21wdXRlRm9yZWNhc3RSb3dzKF9mb3JlY2FzdFNuYXBzaG90LCBwYXJzZWQsIGhveSk7XG4gICAgX3JlbmRlclRhYmxlKF9mb3JlY2FzdFJvd3MpO1xuICAgIGNvbnN0IHNpbk1hdGNoID0gX2ZvcmVjYXN0Um93cy5maWx0ZXIoKHIpID0+ICFyLmhhc0hpc3RvcmlhKS5sZW5ndGg7XG4gICAgY29uc3Qgc3RhdHMgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZm9yZWNhc3Qtc3RhdHMnKTtcbiAgICBpZiAoc3RhdHMpIHtcbiAgICAgIHN0YXRzLnRleHRDb250ZW50ID1cbiAgICAgICAgcGFyc2VkLmxlbmd0aCArXG4gICAgICAgICcgU0tVcyBlbiBTYWxlcyBQbGFuIFx1MDBCNyAnICtcbiAgICAgICAgKHBhcnNlZC5sZW5ndGggLSBzaW5NYXRjaCkgK1xuICAgICAgICAnIGNvbiBoaXN0b3JpYSBcdTAwQjcgJyArXG4gICAgICAgIHNpbk1hdGNoICtcbiAgICAgICAgJyBzaW4gbWF0Y2ggKGZvbmRvIGFtYXJpbGxvKSc7XG4gICAgfVxuICAgIGNvbnN0IGJ0biA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdmb3JlY2FzdC1leHBvcnQtYnRuJyk7XG4gICAgaWYgKGJ0bikge1xuICAgICAgYnRuLmRpc2FibGVkID0gZmFsc2U7XG4gICAgICBidG4uc3R5bGUub3BhY2l0eSA9ICcxJztcbiAgICB9XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBjb25zb2xlLmVycm9yKCdbRk9SRUNBU1RdIHBhcnNlIGVycm9yOicsIGUpO1xuICAgIGFsZXJ0KCdFcnJvciBwcm9jZXNhbmRvIGVsIEV4Y2VsOlxcbicgKyAoKGUgJiYgZS5tZXNzYWdlKSB8fCBlKSk7XG4gIH0gZmluYWxseSB7XG4gICAgLy8gUmVzZXQgaW5wdXQgcGFyYSBxdWUgZWwgbWlzbW8gYXJjaGl2byBzZSBwdWVkYSByZS1zdWJpclxuICAgIGlmIChldmVudCAmJiBldmVudC50YXJnZXQpIGV2ZW50LnRhcmdldC52YWx1ZSA9ICcnO1xuICB9XG59O1xuXG53aW5kb3cuZXhwb3J0Rm9yZWNhc3RFeGNlbCA9IGZ1bmN0aW9uICgpIHtcbiAgaWYgKCFfZm9yZWNhc3RSb3dzIHx8ICFfZm9yZWNhc3RSb3dzLmxlbmd0aCkge1xuICAgIGFsZXJ0KCdObyBoYXkgZGF0b3MgcGFyYSBleHBvcnRhci4gQ2FyZ2EgcHJpbWVybyBlbCBTYWxlcyBQbGFuLicpO1xuICAgIHJldHVybjtcbiAgfVxuICBpZiAodHlwZW9mIFhMU1ggPT09ICd1bmRlZmluZWQnKSB7XG4gICAgYWxlcnQoJ1hMU1ggbm8gY2FyZ2FkbycpO1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCByb3VuZDEgPSAobikgPT4gTWF0aC5yb3VuZChOdW1iZXIobiB8fCAwKSAqIDEwKSAvIDEwO1xuICBjb25zdCBhb2EgPSBbXG4gICAgW1xuICAgICAgJ1NLVScsXG4gICAgICAnRkFNSUxJQScsXG4gICAgICAnU1VCRkFNSUxJQScsXG4gICAgICAnVkVOVEFTICgxMm0pJyxcbiAgICAgICdQRURJRE8tU0FMRVMgUExBTlMgKDZtKScsXG4gICAgICAnUFJPTUVESU8gREUgSU5WRU5UQVJJTycsXG4gICAgICAnUE9MSVRJQ0EgREUgSU5WRU5UQVJJTyAoM20pJyxcbiAgICAgICdUT1RBTCcsXG4gICAgXSxcbiAgXTtcbiAgZm9yIChjb25zdCByIG9mIF9mb3JlY2FzdFJvd3MpIHtcbiAgICBhb2EucHVzaChbXG4gICAgICByLnNrdSxcbiAgICAgIHIuZmFtaWxpYSxcbiAgICAgIHIuc3ViZmFtaWxpYSxcbiAgICAgIHJvdW5kMShyLnZlbnRhczEybSksXG4gICAgICByb3VuZDEoci5wZWRpZG82bSksXG4gICAgICByb3VuZDEoci5wcm9tZWRpbyksXG4gICAgICByb3VuZDEoci5wb2xpdGljYSksXG4gICAgICByb3VuZDEoci50b3RhbCksXG4gICAgXSk7XG4gIH1cbiAgY29uc3Qgd3MgPSBYTFNYLnV0aWxzLmFvYV90b19zaGVldChhb2EpO1xuICAvLyBBbmNob3MgZGUgY29sdW1uYVxuICB3c1snIWNvbHMnXSA9IFtcbiAgICB7IHdjaDogMTggfSxcbiAgICB7IHdjaDogMjQgfSxcbiAgICB7IHdjaDogMjQgfSxcbiAgICB7IHdjaDogMTQgfSxcbiAgICB7IHdjaDogMjAgfSxcbiAgICB7IHdjaDogMjAgfSxcbiAgICB7IHdjaDogMjIgfSxcbiAgICB7IHdjaDogMTIgfSxcbiAgXTtcbiAgY29uc3Qgd2IgPSBYTFNYLnV0aWxzLmJvb2tfbmV3KCk7XG4gIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQod2IsIHdzLCAnRk9SRUNBU1QnKTtcbiAgY29uc3QgaG95ID0gbmV3IERhdGUoKTtcbiAgY29uc3Qgc3RhbXAgPVxuICAgIGhveS5nZXRGdWxsWWVhcigpICtcbiAgICAnLScgK1xuICAgIFN0cmluZyhob3kuZ2V0TW9udGgoKSArIDEpLnBhZFN0YXJ0KDIsICcwJykgK1xuICAgICctJyArXG4gICAgU3RyaW5nKGhveS5nZXREYXRlKCkpLnBhZFN0YXJ0KDIsICcwJyk7XG4gIFhMU1gud3JpdGVGaWxlKHdiLCAnRm9yZWNhc3RfU2hpbWFub18nICsgc3RhbXAgKyAnLnhsc3gnKTtcbn07XG5cbi8vIFJlZnJlc2ggcHVibGljbyAocG9yIHNpIGVsIHVzZXIgbmVjZXNpdGEgcmUtZmV0Y2hlYXIgZWwgc25hcHNob3Qgc2luIGNlcnJhclxuLy8gZWwgbW9kYWwsIGVqOiBwYXNhcm9uIDMwIG1pbiB5IGVsIGNyb24gQlEgYWN0dWFsaXpvIGxhIGNvbGVjY2lvbikuXG53aW5kb3cucmVsb2FkRm9yZWNhc3RTbmFwc2hvdCA9IGFzeW5jIGZ1bmN0aW9uICgpIHtcbiAgX2ZvcmVjYXN0U25hcHNob3QgPSBudWxsO1xuICBhd2FpdCBfbG9hZFNuYXBzaG90KCk7XG4gIGlmIChfZm9yZWNhc3RTYWxlc1BsYW4pIHtcbiAgICBjb25zdCBob3kgPSBuZXcgRGF0ZSgpO1xuICAgIF9mb3JlY2FzdFJvd3MgPSBfY29tcHV0ZUZvcmVjYXN0Um93cyhfZm9yZWNhc3RTbmFwc2hvdCwgX2ZvcmVjYXN0U2FsZXNQbGFuLCBob3kpO1xuICAgIF9yZW5kZXJUYWJsZShfZm9yZWNhc3RSb3dzKTtcbiAgfVxufTtcbiJdLAogICJtYXBwaW5ncyI6ICI7OztBQVlBLE1BQU0sZ0JBQWdCO0FBQUEsSUFDcEIsS0FBSztBQUFBLElBQ0wsU0FBUztBQUFBLElBQ1QsS0FBSztBQUFBLElBQ0wsT0FBTztBQUFBLElBQ1AsS0FBSztBQUFBLElBQ0wsVUFBVTtBQUFBLElBQ1YsU0FBUztBQUFBLElBQ1QsS0FBSztBQUFBLElBQ0wsT0FBTztBQUFBLElBQ1AsT0FBTztBQUFBLElBQ1AsS0FBSztBQUFBLElBQ0wsT0FBTztBQUFBLElBQ1AsS0FBSztBQUFBLElBQ0wsT0FBTztBQUFBLElBQ1AsS0FBSztBQUFBLElBQ0wsTUFBTTtBQUFBLElBQ04sS0FBSztBQUFBLElBQ0wsTUFBTTtBQUFBLElBQ04sT0FBTztBQUFBLElBQ1AsS0FBSztBQUFBLElBQ0wsTUFBTTtBQUFBLElBQ04sT0FBTztBQUFBLElBQ1AsS0FBSztBQUFBLElBQ0wsUUFBUTtBQUFBLElBQ1IsS0FBSztBQUFBLElBQ0wsUUFBUTtBQUFBLElBQ1IsS0FBSztBQUFBLElBQ0wsTUFBTTtBQUFBLElBQ04sV0FBVztBQUFBLElBQ1gsWUFBWTtBQUFBLElBQ1osS0FBSztBQUFBLElBQ0wsU0FBUztBQUFBLElBQ1QsU0FBUztBQUFBLElBQ1QsS0FBSztBQUFBLElBQ0wsVUFBVTtBQUFBLElBQ1YsV0FB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
