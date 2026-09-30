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
    const s = String(label).replace(/\s+/g, " ").trim().toLowerCase();
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
    m = s.match(/^(\d{4})[\s\-/._]+([a-záéíóú]{3,10})$/);
    if (m) {
      const y = parseInt(m[1], 10);
      const mon = MONTH_ALIASES[m[2]] || MONTH_ALIASES[m[2].slice(0, 3)];
      if (mon) return String(y).padStart(4, "0") + "-" + String(mon).padStart(2, "0");
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
        const s = String(cell == null ? "" : cell).replace(/\s+/g, " ").trim().toLowerCase();
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
      const raw = String(headerRow[i] == null ? "" : headerRow[i]).replace(/\s+/g, " ").trim();
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL3B1cmUvc2FsZXMtcGxhbi1wYXJzZXIuanMiLCAiLi4vc3JjL2RvbWFpbnMvZm9yZWNhc3QuanMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbIi8vIEB0cy1ub2NoZWNrXHJcbi8vIFB1cmU6IHBhcnNlYSB1biBzaGVldCBTYWxlcyBQbGFuIChmb3JtYXRvIFNVUi9TQVIgZGUgU2hpbWFubykgYSBlc3RydWN0dXJhXHJcbi8vIG5vcm1hbGl6YWRhIHsgc2t1LCBkZXNjcmlwdGlvbiwgbW9xLCBtb250aHM6IHsnWVlZWS1NTSc6IE59IH0uXHJcbi8vIFNpbiBkZXBlbmRlbmNpYXMgXHUyMDE0IHJlY2liZSBlbCBzaGVldCB5YSBkZXNlcmlhbGl6YWRvIHBvciBTaGVldEpTXHJcbi8vIChYTFNYLnV0aWxzLnNoZWV0X3RvX2pzb24oc2hlZXQsIHtoZWFkZXI6MSwgZGVmdmFsOicnfSkpLlxyXG4vLyBUZXN0ZWFibGUgZW4gdml0ZXN0IHNpbiBjYXJnYXIgWExTWC5cclxuLy9cclxuLy8gQ29udGV4dG86IGxvcyBTYWxlcyBQbGFucyBkZSBTaGltYW5vIHZpZW5lbiBjb24gaGVhZGVycyBjb21vXHJcbi8vIFwiU0tVIENvZGUvUGFydCBOb1wiLCBcIkRlc2NyaXB0aW9uXCIsIFwiTU9RIDEyIG1vbnRoc1wiIHkgY29sdW1uYXMgZGUgbWVzZXNcclxuLy8gdGlwbyBcIkphbiAyMDI3XCIsIFwiTWF5IDIwMjdcIiAoYSB2ZWNlcyBjb24gYVx1MDBGMW8gZW4gdW5hIGZpbGEgYXJyaWJhIHkgZWwgbWVzXHJcbi8vIGVuIGxhIGZpbGEgaGVhZGVyKS4gRXN0YSBmbiB0b2xlcmEgYW1ib3MgbGF5b3V0cy5cclxuXHJcbmNvbnN0IE1PTlRIX0FMSUFTRVMgPSB7XHJcbiAgamFuOiAxLFxyXG4gIGphbnVhcnk6IDEsXHJcbiAgZW5lOiAxLFxyXG4gIGVuZXJvOiAxLFxyXG4gIGZlYjogMixcclxuICBmZWJydWFyeTogMixcclxuICBmZWJyZXJvOiAyLFxyXG4gIG1hcjogMyxcclxuICBtYXJjaDogMyxcclxuICBtYXJ6bzogMyxcclxuICBhcHI6IDQsXHJcbiAgYXByaWw6IDQsXHJcbiAgYWJyOiA0LFxyXG4gIGFicmlsOiA0LFxyXG4gIG1heTogNSxcclxuICBtYXlvOiA1LFxyXG4gIGp1bjogNixcclxuICBqdW5lOiA2LFxyXG4gIGp1bmlvOiA2LFxyXG4gIGp1bDogNyxcclxuICBqdWx5OiA3LFxyXG4gIGp1bGlvOiA3LFxyXG4gIGF1ZzogOCxcclxuICBhdWd1c3Q6IDgsXHJcbiAgYWdvOiA4LFxyXG4gIGFnb3N0bzogOCxcclxuICBzZXA6IDksXHJcbiAgc2VwdDogOSxcclxuICBzZXB0ZW1iZXI6IDksXHJcbiAgc2VwdGllbWJyZTogOSxcclxuICBvY3Q6IDEwLFxyXG4gIG9jdG9iZXI6IDEwLFxyXG4gIG9jdHVicmU6IDEwLFxyXG4gIG5vdjogMTEsXHJcbiAgbm92ZW1iZXI6IDExLFxyXG4gIG5vdmllbWJyZTogMTEsXHJcbiAgZGVjOiAxMixcclxuICBkZWNlbWJlcjogMTIsXHJcbiAgZGljOiAxMixcclxuICBkaWNpZW1icmU6IDEyLFxyXG59O1xyXG5cclxuLy8gTm9ybWFsaXphIGxhYmVscyBkZSBtZXNlcyBhICdZWVlZLU1NJy4gUmV0b3JuYSBudWxsIHNpIG5vIG1hdGNoZWEuXHJcbi8vIEZvcm1hdG9zIHNvcG9ydGFkb3M6IFwiSmFuIDIwMjdcIiwgXCJFbmUtMjdcIiwgXCJKYW4vMjAyN1wiLCBcIk1heTI3XCIsXHJcbi8vIFwiMjAyNy0wMVwiLCBcIjAxLzIwMjdcIiwgXCJKYW4uMjAyN1wiLCBcIjIwMjFcXG5KYW5cIiAobXVsdGktbGluZSBFeGNlbCkuXHJcbmZ1bmN0aW9uIG5vcm1hbGl6ZU1vbnRoTGFiZWwobGFiZWwpIHtcclxuICBpZiAobGFiZWwgPT0gbnVsbCkgcmV0dXJuIG51bGw7XHJcbiAgLy8gdjExMDQ6IGNvbGFwc2FyIG5ld2xpbmVzL3RhYnMgYSBlc3BhY2lvIGFudGVzIGRlbCB0cmltLlxyXG4gIC8vIEVsIGZvcm1hdG8gRXhjZWwgXCIyMDIxXFxuSmFuXCIgKGFcdTAwRjFvIGVuIEwxLCBtZXMgZW4gTDIgZGVudHJvIGRlIHVuYSBjZWxkYVxyXG4gIC8vIG11bHRpLXJvdykgZXMgY29tXHUwMEZBbiBlbiBTYWxlcyBQbGFucyBTVVIuIGBcXHMrYCBtYXRjaGVhIHdoaXRlc3BhY2UgaW5jbHV5ZW5kb1xyXG4gIC8vIFxcbiB5IFxcclxcbi5cclxuICBjb25zdCBzID0gU3RyaW5nKGxhYmVsKS5yZXBsYWNlKC9cXHMrL2csICcgJykudHJpbSgpLnRvTG93ZXJDYXNlKCk7XHJcbiAgaWYgKCFzKSByZXR1cm4gbnVsbDtcclxuICBsZXQgbTtcclxuICAvLyBcImphbiAyMDI3XCIgfCBcImphbi0yN1wiIHwgXCJlbmUvMjAyN1wiIHwgXCJtYXkyN1wiIHwgXCJtYXkuMjAyN1wiXHJcbiAgbSA9IHMubWF0Y2goL14oW2Etelx1MDBFMVx1MDBFOVx1MDBFRFx1MDBGM1x1MDBGQV17MywxMH0pW1xcc1xcLS8uX10qKFxcZHsyLDR9KSQvKTtcclxuICBpZiAobSkge1xyXG4gICAgY29uc3QgbW9uID0gTU9OVEhfQUxJQVNFU1ttWzFdXSB8fCBNT05USF9BTElBU0VTW21bMV0uc2xpY2UoMCwgMyldO1xyXG4gICAgaWYgKG1vbikge1xyXG4gICAgICBsZXQgeSA9IHBhcnNlSW50KG1bMl0sIDEwKTtcclxuICAgICAgaWYgKHkgPCAxMDApIHkgPSAyMDAwICsgeTtcclxuICAgICAgcmV0dXJuIFN0cmluZyh5KS5wYWRTdGFydCg0LCAnMCcpICsgJy0nICsgU3RyaW5nKG1vbikucGFkU3RhcnQoMiwgJzAnKTtcclxuICAgIH1cclxuICB9XHJcbiAgLy8gXCIyMDIxIGphblwiIHwgXCIyMDI3IGRpY1wiIChhXHUwMEYxbyBwcmltZXJvICsgbWVzLCBmb3JtYXRvIEV4Y2VsIG11bHRpLWxpbmVcclxuICAvLyBjb2xhcHNhZG8gdHJhcyByZXBsYWNlIFxccyspLlxyXG4gIG0gPSBzLm1hdGNoKC9eKFxcZHs0fSlbXFxzXFwtLy5fXSsoW2Etelx1MDBFMVx1MDBFOVx1MDBFRFx1MDBGM1x1MDBGQV17MywxMH0pJC8pO1xyXG4gIGlmIChtKSB7XHJcbiAgICBjb25zdCB5ID0gcGFyc2VJbnQobVsxXSwgMTApO1xyXG4gICAgY29uc3QgbW9uID0gTU9OVEhfQUxJQVNFU1ttWzJdXSB8fCBNT05USF9BTElBU0VTW21bMl0uc2xpY2UoMCwgMyldO1xyXG4gICAgaWYgKG1vbikgcmV0dXJuIFN0cmluZyh5KS5wYWRTdGFydCg0LCAnMCcpICsgJy0nICsgU3RyaW5nKG1vbikucGFkU3RhcnQoMiwgJzAnKTtcclxuICB9XHJcbiAgLy8gXCIyMDI3LTAxXCIgfCBcIjIwMjcvMDFcIlxyXG4gIG0gPSBzLm1hdGNoKC9eKFxcZHs0fSlbLS9dKFxcZHsxLDJ9KSQvKTtcclxuICBpZiAobSkge1xyXG4gICAgY29uc3QgeSA9IHBhcnNlSW50KG1bMV0sIDEwKTtcclxuICAgIGNvbnN0IG1vbiA9IHBhcnNlSW50KG1bMl0sIDEwKTtcclxuICAgIGlmIChtb24gPj0gMSAmJiBtb24gPD0gMTIpXHJcbiAgICAgIHJldHVybiBTdHJpbmcoeSkucGFkU3RhcnQoNCwgJzAnKSArICctJyArIFN0cmluZyhtb24pLnBhZFN0YXJ0KDIsICcwJyk7XHJcbiAgfVxyXG4gIC8vIFwiMDEvMjAyN1wiIHwgXCIwMS0yMDI3XCJcclxuICBtID0gcy5tYXRjaCgvXihcXGR7MSwyfSlbLS9dKFxcZHs0fSkkLyk7XHJcbiAgaWYgKG0pIHtcclxuICAgIGNvbnN0IG1vbiA9IHBhcnNlSW50KG1bMV0sIDEwKTtcclxuICAgIGNvbnN0IHkgPSBwYXJzZUludChtWzJdLCAxMCk7XHJcbiAgICBpZiAobW9uID49IDEgJiYgbW9uIDw9IDEyKVxyXG4gICAgICByZXR1cm4gU3RyaW5nKHkpLnBhZFN0YXJ0KDQsICcwJykgKyAnLScgKyBTdHJpbmcobW9uKS5wYWRTdGFydCgyLCAnMCcpO1xyXG4gIH1cclxuICByZXR1cm4gbnVsbDtcclxufVxyXG5cclxuLy8gQnVzY2EgbGEgZmlsYSBoZWFkZXIgKDAtYmFzZWQpLiBFc2NhbmVhIGxhcyBwcmltZXJhcyAzMCBmaWxhcy5cclxuZnVuY3Rpb24gZmluZEhlYWRlclJvdyhyb3dzKSB7XHJcbiAgY29uc3QgSEVBREVSX01BUktFUlMgPSBbXHJcbiAgICAnc2t1IGNvZGUvcGFydCBubycsXHJcbiAgICAnc2t1IGNvZGUnLFxyXG4gICAgJ3NrdScsXHJcbiAgICAncGFydCBubycsXHJcbiAgICAncGFydCBudW1iZXInLFxyXG4gICAgJ2l0ZW1jb2RlJyxcclxuICAgICdpdGVtIGNvZGUnLFxyXG4gICAgJ2NvZGlnbycsXHJcbiAgICAnY1x1MDBGM2RpZ28nLFxyXG4gIF07XHJcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBNYXRoLm1pbihyb3dzLmxlbmd0aCwgMzApOyBpKyspIHtcclxuICAgIGNvbnN0IHJvdyA9IHJvd3NbaV0gfHwgW107XHJcbiAgICBmb3IgKGNvbnN0IGNlbGwgb2Ygcm93KSB7XHJcbiAgICAgIC8vIHYxMTA0OiBjb2xhcHNhciBuZXdsaW5lcyBhIGVzcGFjaW8gcGFyYSBtYXRjaGVhciBoZWFkZXJzIGNvbW9cclxuICAgICAgLy8gXCJTS1UgQ29kZS9QYXJ0IE5vXCIgKG9rKSBvIFwiU0tVXFxuQ29kZVwiIChuZWNlc2l0YSBjb2xhcHNhcikuXHJcbiAgICAgIGNvbnN0IHMgPSBTdHJpbmcoY2VsbCA9PSBudWxsID8gJycgOiBjZWxsKVxyXG4gICAgICAgIC5yZXBsYWNlKC9cXHMrL2csICcgJylcclxuICAgICAgICAudHJpbSgpXHJcbiAgICAgICAgLnRvTG93ZXJDYXNlKCk7XHJcbiAgICAgIGlmIChIRUFERVJfTUFSS0VSUy5pbmRleE9mKHMpID49IDApIHJldHVybiBpO1xyXG4gICAgfVxyXG4gIH1cclxuICByZXR1cm4gLTE7XHJcbn1cclxuXHJcbi8vIERldGVjdGEgXHUwMEVEbmRpY2VzIGRlIGNvbHVtbmFzIHkgbWVzZXMuIGBoaW50Um93QWJvdmVgIHBlcm1pdGUgY29tYmluYXIgYVx1MDBGMW8vbWVzXHJcbi8vIGN1YW5kbyBlbCBoZWFkZXIgZXMgbXVsdGktcm93IChhXHUwMEYxbyBhcnJpYmEsIG1lcyBhYmFqbyBvIHZpY2V2ZXJzYSkuXHJcbmZ1bmN0aW9uIGRldGVjdENvbHVtbnMoaGVhZGVyUm93LCBoaW50Um93QWJvdmUpIHtcclxuICBsZXQgc2t1SWR4ID0gLTE7XHJcbiAgbGV0IGRlc2NJZHggPSAtMTtcclxuICBsZXQgbW9xSWR4ID0gLTE7XHJcbiAgY29uc3QgbW9udGhDb2x1bW5zID0gW107XHJcbiAgY29uc3QgZGV0ZWN0ZWRNb250aHNTZXQgPSBuZXcgU2V0KCk7XHJcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBoZWFkZXJSb3cubGVuZ3RoOyBpKyspIHtcclxuICAgIC8vIHYxMTA0OiBjb2xhcHNhciBuZXdsaW5lcyBhIGVzcGFjaW8gYW50ZXMgZGUgY29tcGFyYXIuIExvcyBTYWxlcyBQbGFuXHJcbiAgICAvLyBTVVIgdGllbmVuIGhlYWRlcnMgbXVsdGktbGluZSBjb21vIFwiTU9RXFxuMTIgbW9udGhzXCIgbyBcIkJhc2VcXG5GT0IoVVNEKVwiLlxyXG4gICAgY29uc3QgcmF3ID0gU3RyaW5nKGhlYWRlclJvd1tpXSA9PSBudWxsID8gJycgOiBoZWFkZXJSb3dbaV0pLnJlcGxhY2UoL1xccysvZywgJyAnKS50cmltKCk7XHJcbiAgICBjb25zdCBzID0gcmF3LnRvTG93ZXJDYXNlKCk7XHJcbiAgICBpZiAoXHJcbiAgICAgIHNrdUlkeCA8IDAgJiZcclxuICAgICAgKHMgPT09ICdza3UgY29kZS9wYXJ0IG5vJyB8fFxyXG4gICAgICAgIHMgPT09ICdza3UgY29kZScgfHxcclxuICAgICAgICBzID09PSAnc2t1JyB8fFxyXG4gICAgICAgIHMgPT09ICdwYXJ0IG5vJyB8fFxyXG4gICAgICAgIHMgPT09ICdwYXJ0IG51bWJlcicgfHxcclxuICAgICAgICBzID09PSAnaXRlbWNvZGUnIHx8XHJcbiAgICAgICAgcyA9PT0gJ2l0ZW0gY29kZScgfHxcclxuICAgICAgICBzID09PSAnY29kaWdvJyB8fFxyXG4gICAgICAgIHMgPT09ICdjXHUwMEYzZGlnbycpXHJcbiAgICApIHtcclxuICAgICAgc2t1SWR4ID0gaTtcclxuICAgICAgY29udGludWU7XHJcbiAgICB9XHJcbiAgICBpZiAoXHJcbiAgICAgIGRlc2NJZHggPCAwICYmXHJcbiAgICAgIChzID09PSAnZGVzY3JpcHRpb24nIHx8XHJcbiAgICAgICAgcyA9PT0gJ2Rlc2NyaXBjaW9uJyB8fFxyXG4gICAgICAgIHMgPT09ICdkZXNjcmlwY2lcdTAwRjNuJyB8fFxyXG4gICAgICAgIHMgPT09ICdpdGVtIG5hbWUnIHx8XHJcbiAgICAgICAgcyA9PT0gJ2l0ZW1uYW1lJylcclxuICAgICkge1xyXG4gICAgICBkZXNjSWR4ID0gaTtcclxuICAgICAgY29udGludWU7XHJcbiAgICB9XHJcbiAgICBpZiAobW9xSWR4IDwgMCAmJiAocyA9PT0gJ21vcSAxMiBtb250aHMnIHx8IHMgPT09ICdtb3EnIHx8IHMuaW5kZXhPZignbW9xJykgPT09IDApKSB7XHJcbiAgICAgIG1vcUlkeCA9IGk7XHJcbiAgICAgIGNvbnRpbnVlO1xyXG4gICAgfVxyXG4gICAgLy8gVHJ5IGRpcmVjdCBtb250aCBwYXJzZVxyXG4gICAgbGV0IG1vbnRoS2V5ID0gbm9ybWFsaXplTW9udGhMYWJlbChyYXcpO1xyXG4gICAgaWYgKCFtb250aEtleSAmJiBoaW50Um93QWJvdmUgJiYgaGludFJvd0Fib3ZlW2ldICE9IG51bGwpIHtcclxuICAgICAgY29uc3QgaGludCA9IFN0cmluZyhoaW50Um93QWJvdmVbaV0pLnRyaW0oKTtcclxuICAgICAgaWYgKGhpbnQpIHtcclxuICAgICAgICBtb250aEtleSA9IG5vcm1hbGl6ZU1vbnRoTGFiZWwocmF3ICsgJyAnICsgaGludCkgfHwgbm9ybWFsaXplTW9udGhMYWJlbChoaW50ICsgJyAnICsgcmF3KTtcclxuICAgICAgfVxyXG4gICAgfVxyXG4gICAgaWYgKG1vbnRoS2V5KSB7XHJcbiAgICAgIG1vbnRoQ29sdW1ucy5wdXNoKHsgY29sSWR4OiBpLCBtb250aEtleSB9KTtcclxuICAgICAgZGV0ZWN0ZWRNb250aHNTZXQuYWRkKG1vbnRoS2V5KTtcclxuICAgIH1cclxuICB9XHJcbiAgcmV0dXJuIHtcclxuICAgIHNrdUlkeCxcclxuICAgIGRlc2NJZHgsXHJcbiAgICBtb3FJZHgsXHJcbiAgICBtb250aENvbHVtbnMsXHJcbiAgICBkZXRlY3RlZE1vbnRoczogQXJyYXkuZnJvbShkZXRlY3RlZE1vbnRoc1NldCkuc29ydCgpLFxyXG4gIH07XHJcbn1cclxuXHJcbi8vIFB1YmxpYzogcGFyc2UgZnVsbCBzaGVldC4gVGhyb3dzIG9uIG1pc3NpbmcgU0tVIGNvbHVtbiAvIG1vbnRocy5cclxuZnVuY3Rpb24gcGFyc2VTYWxlc1BsYW5TaGVldChyb3dzKSB7XHJcbiAgaWYgKCFyb3dzIHx8ICFyb3dzLmxlbmd0aCkge1xyXG4gICAgY29uc3QgZXJyID0gbmV3IEVycm9yKCdFeGNlbCB2YWNpbycpO1xyXG4gICAgZXJyLmNvZGUgPSAnRU1QVFlfU0hFRVQnO1xyXG4gICAgdGhyb3cgZXJyO1xyXG4gIH1cclxuICBjb25zdCBoZWFkZXJJZHggPSBmaW5kSGVhZGVyUm93KHJvd3MpO1xyXG4gIGlmIChoZWFkZXJJZHggPCAwKSB7XHJcbiAgICBjb25zdCBlcnIgPSBuZXcgRXJyb3IoJ05vIHNlIGVuY29udHJvIGZpbGEgZGUgaGVhZGVycyAoYnVzY2FiYSBcIlNLVSBDb2RlL1BhcnQgTm9cIiBvIFwiU0tVXCIpJyk7XHJcbiAgICBlcnIuY29kZSA9ICdIRUFERVJfTk9UX0ZPVU5EJztcclxuICAgIHRocm93IGVycjtcclxuICB9XHJcbiAgY29uc3QgaGVhZGVyUm93ID0gcm93c1toZWFkZXJJZHhdIHx8IFtdO1xyXG4gIGNvbnN0IHJvd0Fib3ZlID0gaGVhZGVySWR4ID4gMCA/IHJvd3NbaGVhZGVySWR4IC0gMV0gfHwgW10gOiBudWxsO1xyXG4gIGNvbnN0IGNvbHMgPSBkZXRlY3RDb2x1bW5zKGhlYWRlclJvdywgcm93QWJvdmUpO1xyXG4gIGlmIChjb2xzLnNrdUlkeCA8IDApIHtcclxuICAgIGNvbnN0IGVyciA9IG5ldyBFcnJvcignTm8gc2UgZW5jb250cm8gY29sdW1uYSBTS1UgZW4gbGEgZmlsYSBoZWFkZXInKTtcclxuICAgIGVyci5jb2RlID0gJ1NLVV9DT0xfTUlTU0lORyc7XHJcbiAgICB0aHJvdyBlcnI7XHJcbiAgfVxyXG4gIGlmICghY29scy5tb250aENvbHVtbnMubGVuZ3RoKSB7XHJcbiAgICBjb25zdCBlcnIgPSBuZXcgRXJyb3IoXHJcbiAgICAgICdObyBzZSBkZXRlY3Rhcm9uIGNvbHVtbmFzIGRlIG1lc2VzIGVuIGVsIGhlYWRlciAoZWo6IFwiSmFuIDIwMjdcIiwgXCJNYXkgMjAyN1wiKSdcclxuICAgICk7XHJcbiAgICBlcnIuY29kZSA9ICdNT05USFNfTk9UX0ZPVU5EJztcclxuICAgIHRocm93IGVycjtcclxuICB9XHJcbiAgY29uc3QgcGFyc2VkUm93cyA9IFtdO1xyXG4gIGNvbnN0IHNlZW5Ta3UgPSBuZXcgU2V0KCk7XHJcbiAgZm9yIChsZXQgciA9IGhlYWRlcklkeCArIDE7IHIgPCByb3dzLmxlbmd0aDsgcisrKSB7XHJcbiAgICBjb25zdCByb3cgPSByb3dzW3JdIHx8IFtdO1xyXG4gICAgY29uc3Qgc2t1UmF3ID0gcm93W2NvbHMuc2t1SWR4XTtcclxuICAgIGlmIChza3VSYXcgPT0gbnVsbCB8fCBTdHJpbmcoc2t1UmF3KS50cmltKCkgPT09ICcnKSBjb250aW51ZTtcclxuICAgIGNvbnN0IHNrdSA9IFN0cmluZyhza3VSYXcpLnRyaW0oKTtcclxuICAgIGNvbnN0IHVwcGVyID0gc2t1LnRvVXBwZXJDYXNlKCk7XHJcbiAgICAvLyBTa2lwIGZpbGFzIFRPVEFMIC8gU1VNIC8gU1VCVE9UQUxcclxuICAgIGlmICh1cHBlciA9PT0gJ1RPVEFMJyB8fCB1cHBlciA9PT0gJ1NVTScgfHwgdXBwZXIgPT09ICdTVUJUT1RBTCcgfHwgdXBwZXIgPT09ICdUT1RBTEVTJylcclxuICAgICAgY29udGludWU7XHJcbiAgICBpZiAoc2VlblNrdS5oYXModXBwZXIpKSBjb250aW51ZTsgLy8gZGVkdXBlXHJcbiAgICBzZWVuU2t1LmFkZCh1cHBlcik7XHJcbiAgICBjb25zdCBkZXNjcmlwdGlvbiA9XHJcbiAgICAgIGNvbHMuZGVzY0lkeCA+PSAwID8gU3RyaW5nKHJvd1tjb2xzLmRlc2NJZHhdID09IG51bGwgPyAnJyA6IHJvd1tjb2xzLmRlc2NJZHhdKS50cmltKCkgOiAnJztcclxuICAgIGNvbnN0IG1vcVJhdyA9IGNvbHMubW9xSWR4ID49IDAgPyByb3dbY29scy5tb3FJZHhdIDogbnVsbDtcclxuICAgIGNvbnN0IG1vcU51bSA9IE51bWJlcihtb3FSYXcpO1xyXG4gICAgY29uc3QgbW9xID0gTnVtYmVyLmlzRmluaXRlKG1vcU51bSkgJiYgbW9xTnVtID4gMCA/IE1hdGgucm91bmQobW9xTnVtKSA6IDA7XHJcbiAgICBjb25zdCBtb250aHMgPSB7fTtcclxuICAgIGZvciAoY29uc3QgbWMgb2YgY29scy5tb250aENvbHVtbnMpIHtcclxuICAgICAgY29uc3QgdiA9IHJvd1ttYy5jb2xJZHhdO1xyXG4gICAgICBjb25zdCBuID0gTnVtYmVyKHYpO1xyXG4gICAgICBpZiAoTnVtYmVyLmlzRmluaXRlKG4pICYmIG4gPiAwKSB7XHJcbiAgICAgICAgbW9udGhzW21jLm1vbnRoS2V5XSA9IE1hdGgucm91bmQobik7XHJcbiAgICAgIH1cclxuICAgIH1cclxuICAgIHBhcnNlZFJvd3MucHVzaCh7IHNrdSwgZGVzY3JpcHRpb24sIG1vcSwgbW9udGhzIH0pO1xyXG4gIH1cclxuICByZXR1cm4ge1xyXG4gICAgaGVhZGVyUm93SW5kZXg6IGhlYWRlcklkeCxcclxuICAgIGRldGVjdGVkTW9udGhzOiBjb2xzLmRldGVjdGVkTW9udGhzLFxyXG4gICAgcm93c0NvdW50OiBwYXJzZWRSb3dzLmxlbmd0aCxcclxuICAgIHJvd3M6IHBhcnNlZFJvd3MsXHJcbiAgfTtcclxufVxyXG5cclxuLy8gVU1ELWlzaCBleHBvcnQ6IHBhcmEgdml0ZXN0IChtb2R1bGUuZXhwb3J0cykgeSBwYXJhIGJ1bmRsZSBicm93c2VyICh3aW5kb3cgZ2xvYmFsKS5cclxuaWYgKHR5cGVvZiBtb2R1bGUgIT09ICd1bmRlZmluZWQnICYmIG1vZHVsZS5leHBvcnRzKSB7XHJcbiAgbW9kdWxlLmV4cG9ydHMgPSB7IHBhcnNlU2FsZXNQbGFuU2hlZXQsIG5vcm1hbGl6ZU1vbnRoTGFiZWwsIGZpbmRIZWFkZXJSb3csIGRldGVjdENvbHVtbnMgfTtcclxufVxyXG5pZiAodHlwZW9mIHdpbmRvdyAhPT0gJ3VuZGVmaW5lZCcpIHtcclxuICB3aW5kb3cuU2FsZXNQbGFuUGFyc2VyID0ge1xyXG4gICAgcGFyc2VTYWxlc1BsYW5TaGVldCxcclxuICAgIG5vcm1hbGl6ZU1vbnRoTGFiZWwsXHJcbiAgICBmaW5kSGVhZGVyUm93LFxyXG4gICAgZGV0ZWN0Q29sdW1ucyxcclxuICB9O1xyXG59XHJcblxyXG5leHBvcnQgeyBkZXRlY3RDb2x1bW5zLCBmaW5kSGVhZGVyUm93LCBub3JtYWxpemVNb250aExhYmVsLCBwYXJzZVNhbGVzUGxhblNoZWV0IH07XHJcbiIsICIvLyBAdHMtbm9jaGVja1xyXG4vLyB2MTA5OCsgRmFzZSAxOiBpbXBvcnQgZGVsIHBhcnNlciBwdXJvLiBFbCBtXHUwMEYzZHVsbyBoYWNlIGB3aW5kb3cuU2FsZXNQbGFuUGFyc2VyYFxyXG4vLyBjb21vIHNpZGUtZWZmZWN0IHkgdGFtYmlcdTAwRTluIGV4cG9ydGEgbGFzIGZucyBub21icmFkYXM7IHVzYW1vcyBzaWRlLWVmZmVjdFxyXG4vLyBwb3JxdWUgZm9yZWNhc3QuanMgY29ycmUgZW4gZWwgY2h1bmsgbGF6eSB5IHdpbmRvdyB5YSBlc3RcdTAwRTEgZGlzcG9uaWJsZS5cclxuaW1wb3J0ICcuLi9wdXJlL3NhbGVzLXBsYW4tcGFyc2VyLmpzJztcclxuXHJcbi8vIEdsb2JhbHMgbGVpZG9zIGRlbCBlbnRvcm5vIChkZWNsYXJhZG9zIGVuIGluZGV4Lmh0bWwgaW5saW5lIG8gYnVuZGxlIHByZXZpbyk6XHJcbi8vIGZiRGIsIGN1cnJlbnRVc2VyLCBYTFNYIChjZG4pLCBlc2NhcGVIdG1sLiBNaXNtbyBwYXRyb24gcXVlIG90cm9zIGRvbWluaW9zLlxyXG4vL1xyXG4vLyBGT1JFQ0FTVCAtIG1vZGFsIGFkbWluLW9ubHkgKE1hcmlhbm8pIHF1ZSBjb21wYXJhIHZlbnRhcyBoaXN0b3JpY2FzXHJcbi8vIChGaXJlc3RvcmUgc2t1X3ZlbnRhc19zbmFwc2hvdCwgYWxpbWVudGFkbyBwb3Igc3luYyBCUSB2X3ZlbnRhc19saW5lYXNcclxuLy8gdmVudGFuYSAxM20pIHZzIFNhbGVzIFBsYW4gY2FyZ2FkbyBwb3IgZWwgdXNlciB2aWEgRXhjZWwgKyBwb2xpdGljYSBkZVxyXG4vLyBpbnZlbnRhcmlvIChwcm9tZWRpbyBZVEQgeCAzIG1lc2VzKS5cclxuLy9cclxuLy8gQ2h1bmsgbGF6eTogc2UgY2FyZ2Egc29sbyBhbCBwcmltZXIgY2xpY2sgZGVsIGJvdG9uIEZPUkVDQVNUIGRlbCBoZWFkZXIuXHJcbi8vIFJlZ2lzdHJhZG8gZW4gYnVpbGQuanMgTEFaWV9DSFVOS1MgKyBzcmMvbWFpbi5qcyBpbnN0YWxsQ2h1bmtTdHVicyArIHN3LmpzXHJcbi8vIFNUQVRJQ19BU1NFVFMuIFZlciBDTEFVREUubWQgIzE4ICgzIGx1Z2FyZXMgc2luY3Jvbml6YWRvcykuXHJcbi8vXHJcbi8vIENvbnRyYXRvIGRlbCBFeGNlbCBTYWxlcyBQbGFuIHF1ZSBzdWJlIGVsIHVzZXI6XHJcbi8vICAgQ29sdW1uYXM6IFNLVSB8IE1lczEgfCBNZXMyIHwgTWVzMyB8IE1lczQgfCBNZXM1IHwgTWVzNlxyXG4vLyAgIChub21icmVzIGV4YWN0b3MgZGUgaGVhZGVycyBjYXNlLWluc2Vuc2l0aXZlOyBNZXMxLi42IHNvbiBsb3MgcHJveGltb3NcclxuLy8gICA2IG1lc2VzIGRlc2RlIGVsIG1lcyBhY3R1YWwpLiBVbmEgZmlsYSBwb3IgU0tVLlxyXG4vL1xyXG4vLyBGdWVudGUgZGUgZGF0b3MgaGlzdG9yaWNhczpcclxuLy8gICBGaXJlc3RvcmUgL3NrdV92ZW50YXNfc25hcHNob3Qve1NLVV88c2t1X3NhbmVhZG8+fVxyXG4vLyAgIHtcclxuLy8gICAgIHNrdSwgaXRlbU5hbWUsIGZhbWlsaWEsIHN1YmZhbWlsaWEsXHJcbi8vICAgICBtZXNlczogeyAnMjAyNS0wOCc6IHtxdHksIGFyc30sIC4uLiwgJzIwMjYtMDgnOiB7cXR5LCBhcnN9IH1cclxuLy8gICB9XHJcbi8vICAgUnVsZXM6IHJlYWQgYWRtaW4tb25seSAoY29tcGV0aXRpdmVseSBzZW5zaXRpdmUpLiBFc2NyaXRvIHBvciBjcm9uXHJcbi8vICAgc3luY19zYXBfdG9fYmlncXVlcnkucHkgY2FkYSAzMCBtaW4uXHJcblxyXG4vLyBFc3RhZG8gZGVsIG1vZGFsIChpbnRyYS1jaHVuaywgbm8gY3Jvc3Mtc2NvcGUpLlxyXG5sZXQgX2ZvcmVjYXN0U25hcHNob3QgPSBudWxsOyAvLyB7IFNLVToge2ZhbWlsaWEsIHN1YmZhbWlsaWEsIGl0ZW1OYW1lLCBtZXNlc30gfVxyXG5sZXQgX2ZvcmVjYXN0U2FsZXNQbGFuID0gbnVsbDsgLy8gW3sgc2t1LCBwZWRpZG9Ub3RhbCwgbWVzZXNBcnI6IFtuMS4ubjZdIH1dXHJcbmxldCBfZm9yZWNhc3RSb3dzID0gbnVsbDsgLy8gZmlsYXMgZmluYWxlcyBjYWxjdWxhZGFzIHBhcmEgcHJldmlldyArIGV4cG9ydFxyXG5sZXQgX2ZvcmVjYXN0TG9hZGluZyA9IGZhbHNlO1xyXG5cclxuLy8gdjEwOTgrIChGYXNlIDEgRm9yZWNhc3QgdjIpOiBTYWxlcyBQbGFucyBtZW5zdWFsZXMgcG9yIGZhbWlsaWEgKFJvZHMvUmVlbHMvRkcpLlxyXG4vLyBTZSBndWFyZGFuIGVuIEZpcmVzdG9yZSBgc2FsZXNfcGxhbl9jYWNoZS97ZmFtaWxpYX1gICsgc25hcHNob3QgRXhjZWwgb3JpZ2luYWxcclxuLy8gZW4gU3RvcmFnZSBgZm9yZWNhc3RzX3NuYXBzaG90cy97WVlZWS1NTX0ve2ZhbWlsaWF9Lnhsc3hgLlxyXG4vLyBFbCBwYXJzZXIgcHVybyB2aXZlIGVuIHNyYy9wdXJlL3NhbGVzLXBsYW4tcGFyc2VyLmpzIChhdHRhY2ggYSB3aW5kb3cuU2FsZXNQbGFuUGFyc2VyKS5cclxuY29uc3QgU0FMRVNfUExBTl9GQU1JTElBUyA9IFtcclxuICB7IGtleTogJ3JvZHMnLCBsYWJlbDogJ1JvZHMgKENhXHUwMEYxYXMpJywgY29sb3I6ICcjMGVhNWU5JyB9LFxyXG4gIHsga2V5OiAncmVlbHMnLCBsYWJlbDogJ1JlZWxzJywgY29sb3I6ICcjOGI1Y2Y2JyB9LFxyXG4gIHsga2V5OiAnZmcnLCBsYWJlbDogJ0ZHIChyZXN0byknLCBjb2xvcjogJyNmNTllMGInIH0sXHJcbl07XHJcbmNvbnN0IF9zYWxlc1BsYW5DYWNoZXMgPSB7IHJvZHM6IG51bGwsIHJlZWxzOiBudWxsLCBmZzogbnVsbCB9OyAvLyBsYXN0IGxvYWRlZCBkb2NcclxubGV0IF9mb3JlY2FzdEFjdGl2ZVRhYiA9ICdzYWxlcy1wbGFucyc7IC8vICdzYWxlcy1wbGFucycgfCAnc3RhdCcgfCAnbGVnYWN5J1xyXG5cclxuLy8gdjExMDMrIChGYXNlIDJCKTogRm9yZWNhc3QgRXN0YWRcdTAwRURzdGljbyBcdTIwMTQgb3V0cHV0IHB1YmxpY2FkbyBwb3JcclxuLy8gc2NyaXB0cy9mb3JlY2FzdC9wdWJsaXNoX3RvX2ZpcmVzdG9yZS5weSBhIGZvcmVjYXN0X291dHB1dC97c3ViX3NsdWd9XHJcbi8vICsgZm9yZWNhc3Rfb3V0cHV0X21ldGEvY3VycmVudC4gMjQgc3VicyArIDEgbWV0YSBkb2MuXHJcbmxldCBfZm9yZWNhc3RTdGF0RG9jcyA9IG51bGw7IC8vIFt7aWQsIHN1YmZhbWlsaWEsIGZvcmVjYXN0WzddLCBtZXRyaWNzLCBiZXN0TW9kZWwsIHZlcnNpb25JZH1dXHJcbmxldCBfZm9yZWNhc3RTdGF0TWV0YSA9IG51bGw7IC8vIHtnZW5lcmF0ZWRBdCwgdmVyc2lvbklkLCByZXN1bWVuOiB7Li4ufX1cclxubGV0IF9mb3JlY2FzdFN0YXRIaXN0b3J5Q2FjaGUgPSBudWxsOyAvLyB7IFtzdWJdOiBbe2RzLCB5fV0gfSBjYWNoZSBsYXp5IG9uLWRlbWFuZFxyXG5cclxuLy8gV2hpdGVsaXN0IGRlIGVtYWlscyBjb24gYWNjZXNvIGFsIG1vZGFsIEZPUkVDQVNULiBSZXBsaWNhIGVsIHBhdHJvbiBkZVxyXG4vLyBcIkFuYWxpc2lzXCIgKGluZGV4Lmh0bWw6MTI2MjUpLiBTb2xvIE1hcmlhbm87IHNpIG90cm8gYWRtaW4gbG8gbmVjZXNpdGFcclxuLy8gc2UgYWdyZWdhIGFjYSBleHBsaWNpdG8uXHJcbmNvbnN0IEZPUkVDQVNUX0FMTE9XRURfRU1BSUxTID0gWydtYXJpYW5vLmVyYmlub0BzaGltYW5vLmNvbS5hcicsICdlcmJpbm9tYXJpYW5vQGdtYWlsLmNvbSddO1xyXG5cclxuZnVuY3Rpb24gX2NhbkZvcmVjYXN0KCkge1xyXG4gIHRyeSB7XHJcbiAgICBjb25zdCBlbWFpbCA9ICgod2luZG93LmN1cnJlbnRVc2VyICYmIHdpbmRvdy5jdXJyZW50VXNlci5lbWFpbCkgfHwgJycpLnRvTG93ZXJDYXNlKCk7XHJcbiAgICBpZiAoIWVtYWlsKSByZXR1cm4gZmFsc2U7XHJcbiAgICByZXR1cm4gRk9SRUNBU1RfQUxMT1dFRF9FTUFJTFMuaW5kZXhPZihlbWFpbCkgPj0gMDtcclxuICB9IGNhdGNoIHtcclxuICAgIHJldHVybiBmYWxzZTtcclxuICB9XHJcbn1cclxuXHJcbi8vIEhlbHBlcnMgZGUgbWVzIGNhbGVuZGFyLlxyXG5mdW5jdGlvbiBfbW9udGhLZXkoeWVhciwgbW9udGhPbmVCYXNlZCkge1xyXG4gIHJldHVybiBTdHJpbmcoeWVhcikucGFkU3RhcnQoNCwgJzAnKSArICctJyArIFN0cmluZyhtb250aE9uZUJhc2VkKS5wYWRTdGFydCgyLCAnMCcpO1xyXG59XHJcbmZ1bmN0aW9uIF9tb250aExhYmVsKGtleSkge1xyXG4gIC8vICcyMDI2LTA4JyAtPiAnYWdvLTI2J1xyXG4gIGNvbnN0IFt5LCBtXSA9IGtleS5zcGxpdCgnLScpLm1hcChOdW1iZXIpO1xyXG4gIGNvbnN0IG5hbWVzID0gW1xyXG4gICAgJ2VuZScsXHJcbiAgICAnZmViJyxcclxuICAgICdtYXInLFxyXG4gICAgJ2FicicsXHJcbiAgICAnbWF5JyxcclxuICAgICdqdW4nLFxyXG4gICAgJ2p1bCcsXHJcbiAgICAnYWdvJyxcclxuICAgICdzZXAnLFxyXG4gICAgJ29jdCcsXHJcbiAgICAnbm92JyxcclxuICAgICdkaWMnLFxyXG4gIF07XHJcbiAgcmV0dXJuIG5hbWVzW20gLSAxXSArICctJyArIFN0cmluZyh5KS5zbGljZSgtMik7XHJcbn1cclxuZnVuY3Rpb24gX2FkZE1vbnRocyh5ZWFyLCBtb250aE9uZUJhc2VkLCBkZWx0YSkge1xyXG4gIGNvbnN0IHRvdGFsTW9udGhzID0geWVhciAqIDEyICsgKG1vbnRoT25lQmFzZWQgLSAxKSArIGRlbHRhO1xyXG4gIGNvbnN0IHkgPSBNYXRoLmZsb29yKHRvdGFsTW9udGhzIC8gMTIpO1xyXG4gIGNvbnN0IG0gPSAodG90YWxNb250aHMgJSAxMikgKyAxO1xyXG4gIHJldHVybiB7IHksIG0gfTtcclxufVxyXG5cclxuLy8gU3VtYSBxdHkgZGVsIFNLVSBlbiBsb3MgdWx0aW1vcyAxMiBNRVNFUyBDT01QTEVUT1MgKGV4Y2x1eWUgZWwgbWVzIGFjdHVhbFxyXG4vLyBwYXJjaWFsIC0gbGEgdmVudGFuYSBtb3ZpbCBcIjEyIG1lc2VzIGNlcnJhZG9zXCIgcXVlIGVsIHVzZXIgcGllbnNhIGNvbW9cclxuLy8gXCJlbCBhXHUwMEYxbyBxdWUgeWEgcGFzb1wiKS4gRWplbXBsbyBlbiBhZ29zdG8gMjAyNjogc3VtYXIgYWdvLTI1IGEganVsLTI2LlxyXG5mdW5jdGlvbiBfc3VtVmVudGFzMTJtQ29tcGxldG9zKG1lc2VzTWFwLCBob3kpIHtcclxuICBpZiAoIW1lc2VzTWFwKSByZXR1cm4gMDtcclxuICBsZXQgc3VtID0gMDtcclxuICBjb25zdCBzdGFydE1vbnRoID0gX2FkZE1vbnRocyhob3kuZ2V0RnVsbFllYXIoKSwgaG95LmdldE1vbnRoKCkgKyAxLCAtMTIpO1xyXG4gIGNvbnN0IGVuZE1vbnRoID0gX2FkZE1vbnRocyhob3kuZ2V0RnVsbFllYXIoKSwgaG95LmdldE1vbnRoKCkgKyAxLCAtMSk7XHJcbiAgY29uc3Qgc3RhcnRLZXkgPSBfbW9udGhLZXkoc3RhcnRNb250aC55LCBzdGFydE1vbnRoLm0pO1xyXG4gIGNvbnN0IGVuZEtleSA9IF9tb250aEtleShlbmRNb250aC55LCBlbmRNb250aC5tKTtcclxuICBmb3IgKGNvbnN0IGsgb2YgT2JqZWN0LmtleXMobWVzZXNNYXApKSB7XHJcbiAgICBpZiAoayA+PSBzdGFydEtleSAmJiBrIDw9IGVuZEtleSkge1xyXG4gICAgICBzdW0gKz0gTnVtYmVyKChtZXNlc01hcFtrXSAmJiBtZXNlc01hcFtrXS5xdHkpIHx8IDApO1xyXG4gICAgfVxyXG4gIH1cclxuICByZXR1cm4gc3VtO1xyXG59XHJcblxyXG4vLyBTdW1hIHF0eSBkZWwgU0tVIFlURCAoZW5lcm8gZGVsIGFcdTAwRjFvIGFjdHVhbCBoYXN0YSBtZXMgYWN0dWFsIElOQ0xVU0lWTyxcclxuLy8gYXVucXVlIGVsIG1lcyBhY3R1YWwgc2VhIHBhcmNpYWwpLiBSZXRvcm5hIHsgdG90YWxZdGQsIG1lc2VzVHJhbnNjdXJyaWRvcyB9LlxyXG4vLyBFamVtcGxvIGFnb3N0byAyMDI2IGNvbiB2ZW50YXMganVsPTEwICsgYWdvPTIwIC0+IHszMCwgOH0sIHByb21lZGlvPTMwLzg9My43NS5cclxuLy8gKFNpIGVsIHVzdWFyaW8gZXNwZXJhYmEgZGl2aWRpciBwb3IgMiBlbiB2ZXogZGUgOCwgcmV2aXNhciBzcGVjLiBFbCBwZWRpZG9cclxuLy8gZGljZSBcImNhbnRpZGFkIGRlIG1lc2VzIHF1ZSB0cmFuc2N1cnJpbW9zXCIgPSBtZXNlcyBkZWwgYVx1MDBGMW8gcGFzYWRvcyBoYXN0YSBob3kuKVxyXG5mdW5jdGlvbiBfc3VtVmVudGFzWVREKG1lc2VzTWFwLCBob3kpIHtcclxuICBjb25zdCB5ZWFyID0gaG95LmdldEZ1bGxZZWFyKCk7XHJcbiAgY29uc3QgbWVzQWN0dWFsID0gaG95LmdldE1vbnRoKCkgKyAxO1xyXG4gIGxldCB0b3RhbCA9IDA7XHJcbiAgaWYgKG1lc2VzTWFwKSB7XHJcbiAgICBmb3IgKGxldCBtID0gMTsgbSA8PSBtZXNBY3R1YWw7IG0rKykge1xyXG4gICAgICBjb25zdCBrID0gX21vbnRoS2V5KHllYXIsIG0pO1xyXG4gICAgICB0b3RhbCArPSBOdW1iZXIoKG1lc2VzTWFwW2tdICYmIG1lc2VzTWFwW2tdLnF0eSkgfHwgMCk7XHJcbiAgICB9XHJcbiAgfVxyXG4gIHJldHVybiB7IHRvdGFsWXRkOiB0b3RhbCwgbWVzZXNUcmFuc2N1cnJpZG9zOiBtZXNBY3R1YWwgfTtcclxufVxyXG5cclxuLy8gQ2FyZ2Egc2t1X3ZlbnRhc19zbmFwc2hvdCBjb21wbGV0byAodW5hIHZleiBwb3Igc2VzaW9uIGRlbCBtb2RhbCkuXHJcbmFzeW5jIGZ1bmN0aW9uIF9sb2FkU25hcHNob3QoKSB7XHJcbiAgaWYgKF9mb3JlY2FzdFNuYXBzaG90KSByZXR1cm4gX2ZvcmVjYXN0U25hcHNob3Q7XHJcbiAgaWYgKCF3aW5kb3cuZmJEYikgdGhyb3cgbmV3IEVycm9yKCdGaXJlc3RvcmUgbm8gaW5pY2lhbGl6YWRvJyk7XHJcbiAgY29uc3Qgc25hcCA9IGF3YWl0IHdpbmRvdy5mYkRiLmNvbGxlY3Rpb24oJ3NrdV92ZW50YXNfc25hcHNob3QnKS5nZXQoKTtcclxuICBjb25zdCBieU9yaWdpbmFsU2t1ID0ge307XHJcbiAgY29uc3QgYnlVcHBlclNrdSA9IHt9O1xyXG4gIHNuYXAuZm9yRWFjaCgoZG9jKSA9PiB7XHJcbiAgICBjb25zdCBkID0gZG9jLmRhdGEoKTtcclxuICAgIGlmICghZCB8fCAhZC5za3UpIHJldHVybjtcclxuICAgIGNvbnN0IHNrdVVwcGVyID0gU3RyaW5nKGQuc2t1KS50cmltKCkudG9VcHBlckNhc2UoKTtcclxuICAgIGNvbnN0IHJlY29yZCA9IHtcclxuICAgICAgc2t1OiBkLnNrdSxcclxuICAgICAgaXRlbU5hbWU6IGQuaXRlbU5hbWUgfHwgJycsXHJcbiAgICAgIGZhbWlsaWE6IGQuZmFtaWxpYSB8fCAnJyxcclxuICAgICAgc3ViZmFtaWxpYTogZC5zdWJmYW1pbGlhIHx8ICcnLFxyXG4gICAgICBtZXNlczogZC5tZXNlcyB8fCB7fSxcclxuICAgIH07XHJcbiAgICBieU9yaWdpbmFsU2t1W2Quc2t1XSA9IHJlY29yZDtcclxuICAgIGJ5VXBwZXJTa3Vbc2t1VXBwZXJdID0gcmVjb3JkO1xyXG4gIH0pO1xyXG4gIF9mb3JlY2FzdFNuYXBzaG90ID0geyBieU9yaWdpbmFsU2t1LCBieVVwcGVyU2t1LCBjb3VudDogc25hcC5zaXplIH07XHJcbiAgcmV0dXJuIF9mb3JlY2FzdFNuYXBzaG90O1xyXG59XHJcblxyXG4vLyBQYXJzZWEgZWwgRXhjZWwgU2FsZXMgUGxhbi4gRXNwZXJhIGNvbHVtbmFzIFNLVSArIDYgY29sdW1uYXMgbnVtZXJpY2FzXHJcbi8vIChub21icmVzIGZsZXhpYmxlczogTWVzMS4uTWVzNiwgbWVzXzEuLm1lc182LCBvIGN1YWxxdWllciBoZWFkZXIgY3VzdG9tXHJcbi8vIG1pZW50cmFzIGxhIHByaW1lcmEgc2VhIFNLVSB5IGhheWEgYWwgbWVub3MgNiBjb2x1bW5hcyBudW1lcmljYXMgbWFzKS5cclxuZnVuY3Rpb24gX3BhcnNlU2FsZXNQbGFuUm93cyhyb3dzUmF3KSB7XHJcbiAgaWYgKCFyb3dzUmF3IHx8ICFyb3dzUmF3Lmxlbmd0aCkgcmV0dXJuIFtdO1xyXG4gIGNvbnN0IGhlYWRlclJvdyA9IHJvd3NSYXdbMF07XHJcbiAgLy8gRGV0ZWN0YXIgaW5kaWNlIGRlIGNvbHVtbmEgU0tVXHJcbiAgbGV0IHNrdUNvbElkeCA9IC0xO1xyXG4gIGZvciAobGV0IGkgPSAwOyBpIDwgaGVhZGVyUm93Lmxlbmd0aDsgaSsrKSB7XHJcbiAgICBjb25zdCBoID0gU3RyaW5nKGhlYWRlclJvd1tpXSB8fCAnJylcclxuICAgICAgLnRyaW0oKVxyXG4gICAgICAudG9VcHBlckNhc2UoKTtcclxuICAgIGlmIChoID09PSAnU0tVJyB8fCBoID09PSAnSVRFTUNPREUnIHx8IGggPT09ICdJVEVNJyB8fCBoID09PSAnSVRFTSBDT0RFJyB8fCBoID09PSAnQ09ESUdPJykge1xyXG4gICAgICBza3VDb2xJZHggPSBpO1xyXG4gICAgICBicmVhaztcclxuICAgIH1cclxuICB9XHJcbiAgaWYgKHNrdUNvbElkeCA8IDApXHJcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ0VsIEV4Y2VsIGRlYmUgdGVuZXIgdW5hIGNvbHVtbmEgbGxhbWFkYSBcIlNLVVwiIChvIENvZGlnbyAvIEl0ZW1Db2RlIC8gSXRlbSknKTtcclxuICAvLyBMYXMgNiBjb2x1bW5hcyBkZSBtZXNlczogbGFzIHByaW1lcmFzIDYgY29sdW1uYXMgcXVlIHNlYW4gIT0gc2t1Q29sSWR4LlxyXG4gIGNvbnN0IG1vbnRoQ29scyA9IFtdO1xyXG4gIGZvciAobGV0IGkgPSAwOyBpIDwgaGVhZGVyUm93Lmxlbmd0aCAmJiBtb250aENvbHMubGVuZ3RoIDwgNjsgaSsrKSB7XHJcbiAgICBpZiAoaSAhPT0gc2t1Q29sSWR4KSBtb250aENvbHMucHVzaChpKTtcclxuICB9XHJcbiAgaWYgKG1vbnRoQ29scy5sZW5ndGggPCA2KVxyXG4gICAgdGhyb3cgbmV3IEVycm9yKFxyXG4gICAgICAnRWwgRXhjZWwgZGViZSB0ZW5lciBhbCBtZW5vcyA2IGNvbHVtbmFzIGRlIG1lc2VzIGFkZW1hcyBkZSBTS1UgKGVuY29udHJhZGFzOiAnICtcclxuICAgICAgICBtb250aENvbHMubGVuZ3RoICtcclxuICAgICAgICAnKSdcclxuICAgICk7XHJcbiAgY29uc3Qgb3V0ID0gW107XHJcbiAgZm9yIChsZXQgciA9IDE7IHIgPCByb3dzUmF3Lmxlbmd0aDsgcisrKSB7XHJcbiAgICBjb25zdCByb3cgPSByb3dzUmF3W3JdO1xyXG4gICAgaWYgKCFyb3cgfHwgIXJvdy5sZW5ndGgpIGNvbnRpbnVlO1xyXG4gICAgY29uc3Qgc2t1UmF3ID0gcm93W3NrdUNvbElkeF07XHJcbiAgICBpZiAoc2t1UmF3ID09PSB1bmRlZmluZWQgfHwgc2t1UmF3ID09PSBudWxsIHx8IFN0cmluZyhza3VSYXcpLnRyaW0oKSA9PT0gJycpIGNvbnRpbnVlO1xyXG4gICAgY29uc3Qgc2t1ID0gU3RyaW5nKHNrdVJhdykudHJpbSgpO1xyXG4gICAgY29uc3QgbWVzZXNBcnIgPSBtb250aENvbHMubWFwKChpKSA9PiB7XHJcbiAgICAgIGNvbnN0IHYgPSByb3dbaV07XHJcbiAgICAgIGNvbnN0IG4gPSBOdW1iZXIodik7XHJcbiAgICAgIHJldHVybiBOdW1iZXIuaXNGaW5pdGUobikgPyBuIDogMDtcclxuICAgIH0pO1xyXG4gICAgY29uc3QgcGVkaWRvVG90YWwgPSBtZXNlc0Fyci5yZWR1Y2UoKGEsIGIpID0+IGEgKyBiLCAwKTtcclxuICAgIG91dC5wdXNoKHsgc2t1LCBtZXNlc0FyciwgcGVkaWRvVG90YWwgfSk7XHJcbiAgfVxyXG4gIHJldHVybiBvdXQ7XHJcbn1cclxuXHJcbi8vIENhbGN1bGEgbGFzIGZpbGFzIGZpbmFsZXMgY3J1emFuZG8gc25hcHNob3QgKyBzYWxlcyBwbGFuLlxyXG5mdW5jdGlvbiBfY29tcHV0ZUZvcmVjYXN0Um93cyhzbmFwc2hvdCwgc2FsZXNQbGFuLCBob3kpIHtcclxuICBjb25zdCByb3dzID0gW107XHJcbiAgZm9yIChjb25zdCBzcCBvZiBzYWxlc1BsYW4pIHtcclxuICAgIGNvbnN0IHNrdVVwcGVyID0gc3Auc2t1LnRvVXBwZXJDYXNlKCk7XHJcbiAgICBjb25zdCBoaXN0ID0gc25hcHNob3QuYnlVcHBlclNrdVtza3VVcHBlcl0gfHwgbnVsbDtcclxuICAgIGNvbnN0IHZlbnRhczEybSA9IGhpc3QgPyBfc3VtVmVudGFzMTJtQ29tcGxldG9zKGhpc3QubWVzZXMsIGhveSkgOiAwO1xyXG4gICAgY29uc3QgeXRkID0gaGlzdFxyXG4gICAgICA/IF9zdW1WZW50YXNZVEQoaGlzdC5tZXNlcywgaG95KVxyXG4gICAgICA6IHsgdG90YWxZdGQ6IDAsIG1lc2VzVHJhbnNjdXJyaWRvczogaG95LmdldE1vbnRoKCkgKyAxIH07XHJcbiAgICBjb25zdCBwcm9tZWRpbyA9IHl0ZC5tZXNlc1RyYW5zY3Vycmlkb3MgPiAwID8geXRkLnRvdGFsWXRkIC8geXRkLm1lc2VzVHJhbnNjdXJyaWRvcyA6IDA7XHJcbiAgICBjb25zdCBwb2xpdGljYSA9IHByb21lZGlvICogMztcclxuICAgIGNvbnN0IHRvdGFsID0gc3AucGVkaWRvVG90YWwgLSBwb2xpdGljYTtcclxuICAgIHJvd3MucHVzaCh7XHJcbiAgICAgIHNrdTogc3Auc2t1LFxyXG4gICAgICBpdGVtTmFtZTogaGlzdCA/IGhpc3QuaXRlbU5hbWUgOiAnJyxcclxuICAgICAgZmFtaWxpYTogaGlzdCA/IGhpc3QuZmFtaWxpYSA6ICcoc2luIG1hdGNoKScsXHJcbiAgICAgIHN1YmZhbWlsaWE6IGhpc3QgPyBoaXN0LnN1YmZhbWlsaWEgOiAnKHNpbiBtYXRjaCknLFxyXG4gICAgICB2ZW50YXMxMm06IHZlbnRhczEybSxcclxuICAgICAgcGVkaWRvNm06IHNwLnBlZGlkb1RvdGFsLFxyXG4gICAgICBwcm9tZWRpbzogcHJvbWVkaW8sXHJcbiAgICAgIHBvbGl0aWNhOiBwb2xpdGljYSxcclxuICAgICAgdG90YWw6IHRvdGFsLFxyXG4gICAgICBoYXNIaXN0b3JpYTogISFoaXN0LFxyXG4gICAgfSk7XHJcbiAgfVxyXG4gIHJldHVybiByb3dzO1xyXG59XHJcblxyXG5mdW5jdGlvbiBfcmVuZGVyTW9kYWxTaGVsbCgpIHtcclxuICBjb25zdCBleGlzdGluZyA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdmb3JlY2FzdC1tb2RhbCcpO1xyXG4gIGlmIChleGlzdGluZykgcmV0dXJuIGV4aXN0aW5nO1xyXG4gIGNvbnN0IGVsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2Jyk7XHJcbiAgZWwuaWQgPSAnZm9yZWNhc3QtbW9kYWwnO1xyXG4gIGVsLmNsYXNzTmFtZSA9ICdtb2RhbC1vdmVybGF5JztcclxuICBlbC5zdHlsZS5jc3NUZXh0ID1cclxuICAgICdkaXNwbGF5Om5vbmU7cG9zaXRpb246Zml4ZWQ7aW5zZXQ6MDtiYWNrZ3JvdW5kOnJnYmEoMTUsMjMsNDIsLjYpO3otaW5kZXg6MjA1MDsnO1xyXG4gIGVsLm9uY2xpY2sgPSBmdW5jdGlvbiAoZXYpIHtcclxuICAgIGlmIChldi50YXJnZXQgPT09IGVsKSB3aW5kb3cuY2xvc2VGb3JlY2FzdE1vZGFsKCk7XHJcbiAgfTtcclxuICAvLyBTaGVsbCArIHRhYnMgYmFyICsgMiBjb250ZW5lZG9yZXMgZGUgdGFicyAoU2FsZXMgUGxhbnMgbnVldmEsIExlZ2FjeSA2bSkuXHJcbiAgLy8gRWwgY29udGVuaWRvIGRlIGNhZGEgdGFiIHNlIHBpbnRhIGNvbiBfcmVuZGVyU2FsZXNQbGFuc1RhYigpIHkgZWwgbGVnYWN5XHJcbiAgLy8gdXNhIGVsIGZsdWpvIF9yZW5kZXJUYWJsZSgpIGRlIHNpZW1wcmUuXHJcbiAgY29uc3Qgc2hlbGxIdG1sID0gX2J1aWxkU2hlbGxIdG1sKCk7XHJcbiAgZWwuaW5uZXJIVE1MID0gc2hlbGxIdG1sO1xyXG4gIGRvY3VtZW50LmJvZHkuYXBwZW5kQ2hpbGQoZWwpO1xyXG4gIHJldHVybiBlbDtcclxufVxyXG5cclxuZnVuY3Rpb24gX2J1aWxkU2hlbGxIdG1sKCkge1xyXG4gIC8vIEJyb2tlbi1vdXQgcHVyZSBzdHJpbmcgYnVpbGRlciBwYXJhIHBhc2FyIGVsIGhvb2sgZGUgaW5uZXJIVE1MLlxyXG4gIGNvbnN0IG1vZGFsT3V0ZXIgPVxyXG4gICAgJzxkaXYgc3R5bGU9XCJwb3NpdGlvbjphYnNvbHV0ZTtpbnNldDoxdmggMXZ3O2JhY2tncm91bmQ6dmFyKC0tYmctZWxldmF0ZWQpO2JvcmRlci1yYWRpdXM6MTBweDtkaXNwbGF5OmZsZXg7ZmxleC1kaXJlY3Rpb246Y29sdW1uO292ZXJmbG93OmhpZGRlbjtib3gtc2hhZG93OjAgMjBweCA1MHB4IHJnYmEoMCwwLDAsLjM1KVwiPic7XHJcbiAgY29uc3QgaGVhZGVyID1cclxuICAgICc8ZGl2IHN0eWxlPVwicGFkZGluZzoxMnB4IDE4cHg7YmFja2dyb3VuZDojMGYxNzJhO2NvbG9yOiNmZmY7ZGlzcGxheTpmbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtnYXA6MTJweFwiPicgK1xyXG4gICAgJzxkaXYgc3R5bGU9XCJmbGV4OjFcIj48ZGl2IHN0eWxlPVwiZm9udC1zaXplOjE2cHg7Zm9udC13ZWlnaHQ6ODAwO2xldHRlci1zcGFjaW5nOi41cHhcIj5GT1JFQ0FTVDwvZGl2PicgK1xyXG4gICAgJzxkaXYgaWQ9XCJmb3JlY2FzdC1zdWJ0aXRsZVwiIHN0eWxlPVwiZm9udC1zaXplOjExcHg7b3BhY2l0eTouODttYXJnaW4tdG9wOjJweFwiPlNhbGVzIFBsYW5zIG1lbnN1YWxlcyArIHBvbGl0aWNhIGRlIGludmVudGFyaW88L2Rpdj48L2Rpdj4nICtcclxuICAgICc8YnV0dG9uIG9uY2xpY2s9XCJjbG9zZUZvcmVjYXN0TW9kYWwoKVwiIHN0eWxlPVwiYmFja2dyb3VuZDp0cmFuc3BhcmVudDtjb2xvcjojZmZmO2JvcmRlcjoxcHggc29saWQgcmdiYSgyNTUsMjU1LDI1NSwuNCk7Ym9yZGVyLXJhZGl1czo2cHg7cGFkZGluZzo2cHggMTBweDtjdXJzb3I6cG9pbnRlcjtmb250LXdlaWdodDo3MDBcIj5DZXJyYXI8L2J1dHRvbj4nICtcclxuICAgICc8L2Rpdj4nO1xyXG4gIGNvbnN0IHRhYnNCYXIgPVxyXG4gICAgJzxkaXYgaWQ9XCJmb3JlY2FzdC10YWJzLWJhclwiIHN0eWxlPVwiZGlzcGxheTpmbGV4O2dhcDowO2JhY2tncm91bmQ6IzFlMjkzYjtwYWRkaW5nOjAgMThweDtib3JkZXItYm90dG9tOjFweCBzb2xpZCB2YXIoLS1ib3JkZXItc3VidGxlKVwiPicgK1xyXG4gICAgJzxidXR0b24gZGF0YS10YWI9XCJzYWxlcy1wbGFuc1wiIG9uY2xpY2s9XCJzd2l0Y2hGb3JlY2FzdFRhYihcXCdzYWxlcy1wbGFuc1xcJylcIiBjbGFzcz1cImZvcmVjYXN0LXRhYlwiIHN0eWxlPVwicGFkZGluZzoxMHB4IDE2cHg7YmFja2dyb3VuZDp0cmFuc3BhcmVudDtjb2xvcjojZmZmO2JvcmRlcjpub25lO2JvcmRlci1ib3R0b206M3B4IHNvbGlkICMwZDk0ODg7Y3Vyc29yOnBvaW50ZXI7Zm9udC13ZWlnaHQ6NzAwO2ZvbnQtc2l6ZToxMnB4O2xldHRlci1zcGFjaW5nOi40cHg7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlXCI+U2FsZXMgUGxhbnM8L2J1dHRvbj4nICtcclxuICAgICc8YnV0dG9uIGRhdGEtdGFiPVwic3RhdFwiIG9uY2xpY2s9XCJzd2l0Y2hGb3JlY2FzdFRhYihcXCdzdGF0XFwnKVwiIGNsYXNzPVwiZm9yZWNhc3QtdGFiXCIgc3R5bGU9XCJwYWRkaW5nOjEwcHggMTZweDtiYWNrZ3JvdW5kOnRyYW5zcGFyZW50O2NvbG9yOiM5NGEzYjg7Ym9yZGVyOm5vbmU7Ym9yZGVyLWJvdHRvbTozcHggc29saWQgdHJhbnNwYXJlbnQ7Y3Vyc29yOnBvaW50ZXI7Zm9udC13ZWlnaHQ6NjAwO2ZvbnQtc2l6ZToxMnB4O2xldHRlci1zcGFjaW5nOi40cHg7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlXCI+Rm9yZWNhc3QgRXN0YWRcdTAwRURzdGljbzwvYnV0dG9uPicgK1xyXG4gICAgJzxidXR0b24gZGF0YS10YWI9XCJsZWdhY3lcIiBvbmNsaWNrPVwic3dpdGNoRm9yZWNhc3RUYWIoXFwnbGVnYWN5XFwnKVwiIGNsYXNzPVwiZm9yZWNhc3QtdGFiXCIgc3R5bGU9XCJwYWRkaW5nOjEwcHggMTZweDtiYWNrZ3JvdW5kOnRyYW5zcGFyZW50O2NvbG9yOiM5NGEzYjg7Ym9yZGVyOm5vbmU7Ym9yZGVyLWJvdHRvbTozcHggc29saWQgdHJhbnNwYXJlbnQ7Y3Vyc29yOnBvaW50ZXI7Zm9udC13ZWlnaHQ6NjAwO2ZvbnQtc2l6ZToxMnB4O2xldHRlci1zcGFjaW5nOi40cHg7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlXCI+TGVnYWN5ICg2bSk8L2J1dHRvbj4nICtcclxuICAgICc8L2Rpdj4nO1xyXG4gIGNvbnN0IHRhYlNhbGVzUGxhbnMgPSAnPGRpdiBpZD1cImZvcmVjYXN0LXRhYi1zYWxlcy1wbGFuc1wiIHN0eWxlPVwiZmxleDoxO292ZXJmbG93OmF1dG9cIj48L2Rpdj4nO1xyXG4gIGNvbnN0IHRhYlN0YXQgPSAnPGRpdiBpZD1cImZvcmVjYXN0LXRhYi1zdGF0XCIgc3R5bGU9XCJmbGV4OjE7b3ZlcmZsb3c6YXV0bztkaXNwbGF5Om5vbmVcIj48L2Rpdj4nO1xyXG4gIGNvbnN0IGxlZ2FjeUJhciA9XHJcbiAgICAnPGRpdiBzdHlsZT1cInBhZGRpbmc6MTJweCAxOHB4O2JhY2tncm91bmQ6dmFyKC0tYmctc2Vjb25kYXJ5KTtib3JkZXItYm90dG9tOjFweCBzb2xpZCB2YXIoLS1ib3JkZXItc3VidGxlKTtkaXNwbGF5OmZsZXg7ZmxleC13cmFwOndyYXA7Z2FwOjE0cHg7YWxpZ24taXRlbXM6Y2VudGVyXCI+JyArXHJcbiAgICAnPGxhYmVsIHN0eWxlPVwiZGlzcGxheTppbmxpbmUtZmxleDthbGlnbi1pdGVtczpjZW50ZXI7Z2FwOjhweDtwYWRkaW5nOjhweCAxMnB4O2JhY2tncm91bmQ6IzBkOTQ4ODtjb2xvcjojZmZmO2JvcmRlci1yYWRpdXM6NnB4O2ZvbnQtd2VpZ2h0OjcwMDtmb250LXNpemU6MTJweDtjdXJzb3I6cG9pbnRlclwiPicgK1xyXG4gICAgJzxzcGFuPkNhcmdhciBTYWxlcyBQbGFuICgueGxzeCk8L3NwYW4+JyArXHJcbiAgICAnPGlucHV0IHR5cGU9XCJmaWxlXCIgYWNjZXB0PVwiLnhsc3gsLnhsc1wiIHN0eWxlPVwiZGlzcGxheTpub25lXCIgb25jaGFuZ2U9XCJvbkZvcmVjYXN0U2FsZXNQbGFuRmlsZShldmVudClcIi8+PC9sYWJlbD4nICtcclxuICAgICc8ZGl2IGlkPVwiZm9yZWNhc3QtaGludFwiIHN0eWxlPVwiZm9udC1zaXplOjExcHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7bWF4LXdpZHRoOjUyMHB4XCI+Rm9ybWF0byBsZWdhY3k6IHByaW1lcmEgY29sdW1uYSA8Yj5TS1U8L2I+LCBsdWVnbyA2IGNvbHVtbmFzIGNvbiBsYXMgdW5pZGFkZXMgcGVkaWRhcyBtZXMgYSBtZXMuPC9kaXY+JyArXHJcbiAgICAnPGJ1dHRvbiBpZD1cImZvcmVjYXN0LWV4cG9ydC1idG5cIiBvbmNsaWNrPVwiZXhwb3J0Rm9yZWNhc3RFeGNlbCgpXCIgZGlzYWJsZWQgc3R5bGU9XCJwYWRkaW5nOjhweCAxNHB4O2JhY2tncm91bmQ6dmFyKC0tY29sb3Itc3VjY2Vzcyk7Y29sb3I6I2ZmZjtib3JkZXI6bm9uZTtib3JkZXItcmFkaXVzOjZweDtmb250LXdlaWdodDo3MDA7Y3Vyc29yOnBvaW50ZXI7b3BhY2l0eTouNVwiPkV4cG9ydGFyIEV4Y2VsPC9idXR0b24+JyArXHJcbiAgICAnPGRpdiBpZD1cImZvcmVjYXN0LXN0YXRzXCIgc3R5bGU9XCJtYXJnaW4tbGVmdDphdXRvO2ZvbnQtc2l6ZToxMXB4O2NvbG9yOnZhcigtLXRleHQtc2Vjb25kYXJ5KTtmb250LXdlaWdodDo2MDBcIj48L2Rpdj4nICtcclxuICAgICc8L2Rpdj4nO1xyXG4gIGNvbnN0IGxlZ2FjeUJvZHkgPVxyXG4gICAgJzxkaXYgaWQ9XCJmb3JlY2FzdC1ib2R5XCIgc3R5bGU9XCJmbGV4OjE7b3ZlcmZsb3c6YXV0bztwYWRkaW5nOjBcIj48ZGl2IHN0eWxlPVwicGFkZGluZzo2MHB4IDIwcHg7dGV4dC1hbGlnbjpjZW50ZXI7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7Zm9udC1zaXplOjE0cHhcIj5Fc3BlcmFuZG8gYXJjaGl2byBTYWxlcyBQbGFuLi4uPC9kaXY+PC9kaXY+JztcclxuICBjb25zdCB0YWJMZWdhY3kgPVxyXG4gICAgJzxkaXYgaWQ9XCJmb3JlY2FzdC10YWItbGVnYWN5XCIgc3R5bGU9XCJmbGV4OjE7b3ZlcmZsb3c6aGlkZGVuO2ZsZXgtZGlyZWN0aW9uOmNvbHVtbjtkaXNwbGF5Om5vbmVcIj4nICtcclxuICAgIGxlZ2FjeUJhciArXHJcbiAgICBsZWdhY3lCb2R5ICtcclxuICAgICc8L2Rpdj4nO1xyXG4gIHJldHVybiBtb2RhbE91dGVyICsgaGVhZGVyICsgdGFic0JhciArIHRhYlNhbGVzUGxhbnMgKyB0YWJTdGF0ICsgdGFiTGVnYWN5ICsgJzwvZGl2Pic7XHJcbn1cclxuXHJcbi8vIHYxMDk4KyBGYXNlIDEgKyB2MTEwMysgRmFzZSAyQjogc3dpdGNoIGVudHJlIHRhYnMgU2FsZXMgUGxhbnMgLyBTdGF0IC8gTGVnYWN5LlxyXG53aW5kb3cuc3dpdGNoRm9yZWNhc3RUYWIgPSBmdW5jdGlvbiAodGFiSWQpIHtcclxuICBfZm9yZWNhc3RBY3RpdmVUYWIgPSB0YWJJZDtcclxuICBjb25zdCBzcCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdmb3JlY2FzdC10YWItc2FsZXMtcGxhbnMnKTtcclxuICBjb25zdCBzdCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdmb3JlY2FzdC10YWItc3RhdCcpO1xyXG4gIGNvbnN0IGxnID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2ZvcmVjYXN0LXRhYi1sZWdhY3knKTtcclxuICBpZiAoc3ApIHNwLnN0eWxlLmRpc3BsYXkgPSB0YWJJZCA9PT0gJ3NhbGVzLXBsYW5zJyA/ICdibG9jaycgOiAnbm9uZSc7XHJcbiAgaWYgKHN0KSBzdC5zdHlsZS5kaXNwbGF5ID0gdGFiSWQgPT09ICdzdGF0JyA/ICdibG9jaycgOiAnbm9uZSc7XHJcbiAgaWYgKGxnKSBsZy5zdHlsZS5kaXNwbGF5ID0gdGFiSWQgPT09ICdsZWdhY3knID8gJ2ZsZXgnIDogJ25vbmUnO1xyXG4gIGNvbnN0IGJ0bnMgPSBkb2N1bWVudC5xdWVyeVNlbGVjdG9yQWxsKCcjZm9yZWNhc3QtdGFicy1iYXIgLmZvcmVjYXN0LXRhYicpO1xyXG4gIGJ0bnMuZm9yRWFjaCgoYikgPT4ge1xyXG4gICAgY29uc3QgYWN0aXZlID0gYi5nZXRBdHRyaWJ1dGUoJ2RhdGEtdGFiJykgPT09IHRhYklkO1xyXG4gICAgYi5zdHlsZS5jb2xvciA9IGFjdGl2ZSA/ICcjZmZmJyA6ICcjOTRhM2I4JztcclxuICAgIGIuc3R5bGUuYm9yZGVyQm90dG9tQ29sb3IgPSBhY3RpdmUgPyAnIzBkOTQ4OCcgOiAndHJhbnNwYXJlbnQnO1xyXG4gICAgYi5zdHlsZS5mb250V2VpZ2h0ID0gYWN0aXZlID8gJzcwMCcgOiAnNjAwJztcclxuICB9KTtcclxuICAvLyBMYXp5IGxvYWQgZGVsIGNvbnRlbmlkbyBzdGF0IG9uLWRlbWFuZCBsYSBwcmltZXJhIHZlelxyXG4gIGlmICh0YWJJZCA9PT0gJ3N0YXQnICYmICFfZm9yZWNhc3RTdGF0RG9jcykge1xyXG4gICAgX2xvYWRGb3JlY2FzdE91dHB1dCgpXHJcbiAgICAgIC50aGVuKF9yZW5kZXJGb3JlY2FzdFN0YXRUYWIpXHJcbiAgICAgIC5jYXRjaCgoZSkgPT4ge1xyXG4gICAgICAgIGNvbnNvbGUuZXJyb3IoJ1tGT1JFQ0FTVCBzdGF0XSBsb2FkIGZhaWwnLCBlKTtcclxuICAgICAgICBjb25zdCBjID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2ZvcmVjYXN0LXRhYi1zdGF0Jyk7XHJcbiAgICAgICAgaWYgKGMpXHJcbiAgICAgICAgICBjLmlubmVySFRNTCA9XHJcbiAgICAgICAgICAgICc8ZGl2IHN0eWxlPVwicGFkZGluZzo2MHB4IDIwcHg7dGV4dC1hbGlnbjpjZW50ZXI7Y29sb3I6I2RjMjYyNlwiPkVycm9yIGNhcmdhbmRvIGZvcmVjYXN0X291dHB1dDogJyArXHJcbiAgICAgICAgICAgIGVzY2FwZUh0bWxTYWZlKGUubWVzc2FnZSB8fCBTdHJpbmcoZSkpICtcclxuICAgICAgICAgICAgJzwvZGl2Pic7XHJcbiAgICAgIH0pO1xyXG4gIH1cclxufTtcclxuXHJcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG4vLyBGQVNFIDEgXHUyMDE0IFNhbGVzIFBsYW5zIHVwbG9hZCAoUm9kcyAvIFJlZWxzIC8gRkcpXHJcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cclxuZnVuY3Rpb24gX3llYXJNb250aE5vdygpIHtcclxuICBjb25zdCBkID0gbmV3IERhdGUoKTtcclxuICByZXR1cm4gZC5nZXRGdWxsWWVhcigpICsgJy0nICsgU3RyaW5nKGQuZ2V0TW9udGgoKSArIDEpLnBhZFN0YXJ0KDIsICcwJyk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIF9mbXRTaXplKGJ5dGVzKSB7XHJcbiAgaWYgKCFieXRlcykgcmV0dXJuICcnO1xyXG4gIGlmIChieXRlcyA8IDEwMjQpIHJldHVybiBieXRlcyArICcgQic7XHJcbiAgaWYgKGJ5dGVzIDwgMTAyNCAqIDEwMjQpIHJldHVybiAoYnl0ZXMgLyAxMDI0KS50b0ZpeGVkKDEpICsgJyBLQic7XHJcbiAgcmV0dXJuIChieXRlcyAvICgxMDI0ICogMTAyNCkpLnRvRml4ZWQoMikgKyAnIE1CJztcclxufVxyXG5cclxuZnVuY3Rpb24gX2ZtdERhdGVTaG9ydChpc28pIHtcclxuICBpZiAoIWlzbykgcmV0dXJuICdcdTIwMTQnO1xyXG4gIHRyeSB7XHJcbiAgICBjb25zdCBkID0gaXNvLnRvRGF0ZSA/IGlzby50b0RhdGUoKSA6IG5ldyBEYXRlKGlzbyk7XHJcbiAgICByZXR1cm4gKFxyXG4gICAgICBkLnRvTG9jYWxlRGF0ZVN0cmluZygnZXMtQVInLCB7IGRheTogJzItZGlnaXQnLCBtb250aDogJ3Nob3J0JywgeWVhcjogJzItZGlnaXQnIH0pICtcclxuICAgICAgJyAnICtcclxuICAgICAgZC50b0xvY2FsZVRpbWVTdHJpbmcoJ2VzLUFSJywgeyBob3VyOiAnMi1kaWdpdCcsIG1pbnV0ZTogJzItZGlnaXQnIH0pXHJcbiAgICApO1xyXG4gIH0gY2F0Y2gge1xyXG4gICAgcmV0dXJuIFN0cmluZyhpc28pO1xyXG4gIH1cclxufVxyXG5cclxuYXN5bmMgZnVuY3Rpb24gX2xvYWRTYWxlc1BsYW5DYWNoZXMoKSB7XHJcbiAgaWYgKCF3aW5kb3cuZmJEYikgcmV0dXJuO1xyXG4gIGF3YWl0IFByb21pc2UuYWxsKFxyXG4gICAgU0FMRVNfUExBTl9GQU1JTElBUy5tYXAoYXN5bmMgKGYpID0+IHtcclxuICAgICAgdHJ5IHtcclxuICAgICAgICBjb25zdCBkb2MgPSBhd2FpdCB3aW5kb3cuZmJEYi5jb2xsZWN0aW9uKCdzYWxlc19wbGFuX2NhY2hlJykuZG9jKGYua2V5KS5nZXQoKTtcclxuICAgICAgICBfc2FsZXNQbGFuQ2FjaGVzW2Yua2V5XSA9IGRvYy5leGlzdHMgPyBkb2MuZGF0YSgpIDogbnVsbDtcclxuICAgICAgfSBjYXRjaCAoZSkge1xyXG4gICAgICAgIGNvbnNvbGUud2FybignW0ZPUkVDQVNUXSBsb2FkIHNhbGVzX3BsYW5fY2FjaGUvJyArIGYua2V5ICsgJyBmYWlsOicsIGUgJiYgZS5tZXNzYWdlKTtcclxuICAgICAgICBfc2FsZXNQbGFuQ2FjaGVzW2Yua2V5XSA9IG51bGw7XHJcbiAgICAgIH1cclxuICAgIH0pXHJcbiAgKTtcclxufVxyXG5cclxuZnVuY3Rpb24gX3JlbmRlclRhYmxlKHJvd3MpIHtcclxuICBjb25zdCBib2R5ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2ZvcmVjYXN0LWJvZHknKTtcclxuICBpZiAoIWJvZHkpIHJldHVybjtcclxuICBpZiAoIXJvd3MgfHwgIXJvd3MubGVuZ3RoKSB7XHJcbiAgICBib2R5LmlubmVySFRNTCA9XHJcbiAgICAgICc8ZGl2IHN0eWxlPVwicGFkZGluZzo2MHB4IDIwcHg7dGV4dC1hbGlnbjpjZW50ZXI7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZClcIj5TYWxlcyBQbGFuIHZhY2lvIG8gc2luIGZpbGFzIHZhbGlkYXMuPC9kaXY+JztcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgY29uc3QgZm10ID0gKG4pID0+XHJcbiAgICBuID09PSAwIHx8ICFOdW1iZXIuaXNGaW5pdGUobilcclxuICAgICAgPyAnMCdcclxuICAgICAgOiBOdW1iZXIobikudG9Mb2NhbGVTdHJpbmcoJ2VzLUFSJywgeyBtYXhpbXVtRnJhY3Rpb25EaWdpdHM6IDEgfSk7XHJcbiAgY29uc3QgY29sb3JGb3JUb3RhbCA9ICh0KSA9PiB7XHJcbiAgICBpZiAodCA+IDApIHJldHVybiAnIzE2NjUzNCc7IC8vIHNvYnJhIChwZWRpc3RlIG1hcyBxdWUgbGEgcG9saXRpY2EpIC0gdmVyZGVcclxuICAgIGlmICh0IDwgMCkgcmV0dXJuICcjYzI0MTBjJzsgLy8gZmFsdGEgKHBlZGlzdGUgbWVub3MgcXVlIGxhIHBvbGl0aWNhKSAtIG5hcmFuamEgdXJnZW50ZVxyXG4gICAgcmV0dXJuICcjNDc1NTY5JztcclxuICB9O1xyXG4gIGNvbnN0IHJvd3NIdG1sID0gcm93c1xyXG4gICAgLm1hcChcclxuICAgICAgKHIpID0+XHJcbiAgICAgICAgJycgK1xyXG4gICAgICAgICc8dHInICtcclxuICAgICAgICAoci5oYXNIaXN0b3JpYSA/ICcnIDogJyBzdHlsZT1cImJhY2tncm91bmQ6dmFyKC0tY29sb3Itd2FybmluZy1iZylcIicpICtcclxuICAgICAgICAnPicgK1xyXG4gICAgICAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjZweCAxMHB4O2ZvbnQtZmFtaWx5Om1vbm9zcGFjZTtmb250LXNpemU6MTFweDt3aGl0ZS1zcGFjZTpub3dyYXBcIj4nICtcclxuICAgICAgICBlc2NhcGVIdG1sU2FmZShyLnNrdSkgK1xyXG4gICAgICAgICc8L3RkPicgK1xyXG4gICAgICAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjZweCAxMHB4O2ZvbnQtc2l6ZToxMXB4XCI+JyArXHJcbiAgICAgICAgZXNjYXBlSHRtbFNhZmUoci5mYW1pbGlhKSArXHJcbiAgICAgICAgJzwvdGQ+JyArXHJcbiAgICAgICAgJzx0ZCBzdHlsZT1cInBhZGRpbmc6NnB4IDEwcHg7Zm9udC1zaXplOjExcHhcIj4nICtcclxuICAgICAgICBlc2NhcGVIdG1sU2FmZShyLnN1YmZhbWlsaWEpICtcclxuICAgICAgICAnPC90ZD4nICtcclxuICAgICAgICAnPHRkIHN0eWxlPVwicGFkZGluZzo2cHggMTBweDt0ZXh0LWFsaWduOnJpZ2h0O2ZvbnQtdmFyaWFudC1udW1lcmljOnRhYnVsYXItbnVtc1wiPicgK1xyXG4gICAgICAgIGZtdChyLnZlbnRhczEybSkgK1xyXG4gICAgICAgICc8L3RkPicgK1xyXG4gICAgICAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjZweCAxMHB4O3RleHQtYWxpZ246cmlnaHQ7Zm9udC12YXJpYW50LW51bWVyaWM6dGFidWxhci1udW1zO2ZvbnQtd2VpZ2h0OjYwMFwiPicgK1xyXG4gICAgICAgIGZtdChyLnBlZGlkbzZtKSArXHJcbiAgICAgICAgJzwvdGQ+JyArXHJcbiAgICAgICAgJzx0ZCBzdHlsZT1cInBhZGRpbmc6NnB4IDEwcHg7dGV4dC1hbGlnbjpyaWdodDtmb250LXZhcmlhbnQtbnVtZXJpYzp0YWJ1bGFyLW51bXM7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZClcIj4nICtcclxuICAgICAgICBmbXQoci5wcm9tZWRpbykgK1xyXG4gICAgICAgICc8L3RkPicgK1xyXG4gICAgICAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjZweCAxMHB4O3RleHQtYWxpZ246cmlnaHQ7Zm9udC12YXJpYW50LW51bWVyaWM6dGFidWxhci1udW1zXCI+JyArXHJcbiAgICAgICAgZm10KHIucG9saXRpY2EpICtcclxuICAgICAgICAnPC90ZD4nICtcclxuICAgICAgICAnPHRkIHN0eWxlPVwicGFkZGluZzo2cHggMTBweDt0ZXh0LWFsaWduOnJpZ2h0O2ZvbnQtdmFyaWFudC1udW1lcmljOnRhYnVsYXItbnVtcztmb250LXdlaWdodDo3MDA7Y29sb3I6JyArXHJcbiAgICAgICAgY29sb3JGb3JUb3RhbChyLnRvdGFsKSArXHJcbiAgICAgICAgJ1wiPicgK1xyXG4gICAgICAgIGZtdChyLnRvdGFsKSArXHJcbiAgICAgICAgJzwvdGQ+JyArXHJcbiAgICAgICAgJzwvdHI+J1xyXG4gICAgKVxyXG4gICAgLmpvaW4oJycpO1xyXG4gIGNvbnN0IGhlYWRlciA9XHJcbiAgICAnJyArXHJcbiAgICAnPHRoZWFkIHN0eWxlPVwicG9zaXRpb246c3RpY2t5O3RvcDowO2JhY2tncm91bmQ6IzBmMTcyYTtjb2xvcjojZmZmO3otaW5kZXg6MVwiPicgK1xyXG4gICAgJzx0cj4nICtcclxuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjhweCAxMHB4O3RleHQtYWxpZ246bGVmdDtmb250LXNpemU6MTFweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7bGV0dGVyLXNwYWNpbmc6LjRweFwiPlNLVTwvdGg+JyArXHJcbiAgICAnPHRoIHN0eWxlPVwicGFkZGluZzo4cHggMTBweDt0ZXh0LWFsaWduOmxlZnQ7Zm9udC1zaXplOjExcHg7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO2xldHRlci1zcGFjaW5nOi40cHhcIj5GYW1pbGlhPC90aD4nICtcclxuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjhweCAxMHB4O3RleHQtYWxpZ246bGVmdDtmb250LXNpemU6MTFweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7bGV0dGVyLXNwYWNpbmc6LjRweFwiPlN1YmZhbWlsaWE8L3RoPicgK1xyXG4gICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6OHB4IDEwcHg7dGV4dC1hbGlnbjpyaWdodDtmb250LXNpemU6MTFweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7bGV0dGVyLXNwYWNpbmc6LjRweFwiIHRpdGxlPVwiU3VtYSBkZSBxdHkgZmFjdHVyYWRhIGVuIGxvcyB1bHRpbW9zIDEyIG1lc2VzIGNvbXBsZXRvc1wiPlZlbnRhcyAxMm08L3RoPicgK1xyXG4gICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6OHB4IDEwcHg7dGV4dC1hbGlnbjpyaWdodDtmb250LXNpemU6MTFweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7bGV0dGVyLXNwYWNpbmc6LjRweFwiIHRpdGxlPVwiU3VtYSBkZSBsYXMgNiBjb2x1bW5hcyBkZWwgRXhjZWwgU2FsZXMgUGxhblwiPlBlZGlkbyA2bTwvdGg+JyArXHJcbiAgICAnPHRoIHN0eWxlPVwicGFkZGluZzo4cHggMTBweDt0ZXh0LWFsaWduOnJpZ2h0O2ZvbnQtc2l6ZToxMXB4O3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtsZXR0ZXItc3BhY2luZzouNHB4XCIgdGl0bGU9XCJWZW50YXMgWVREIC8gbWVzZXMgdHJhbnNjdXJyaWRvcyBkZWwgYVx1MDBGMW9cIj5Qcm9tIC8gTWVzPC90aD4nICtcclxuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjhweCAxMHB4O3RleHQtYWxpZ246cmlnaHQ7Zm9udC1zaXplOjExcHg7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO2xldHRlci1zcGFjaW5nOi40cHhcIiB0aXRsZT1cIlByb21lZGlvIHggMyBtZXNlcyAocG9saXRpY2EgZGUgaW52ZW50YXJpbylcIj5Qb2xpdGljYTwvdGg+JyArXHJcbiAgICAnPHRoIHN0eWxlPVwicGFkZGluZzo4cHggMTBweDt0ZXh0LWFsaWduOnJpZ2h0O2ZvbnQtc2l6ZToxMXB4O3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtsZXR0ZXItc3BhY2luZzouNHB4XCIgdGl0bGU9XCJQZWRpZG8gNm0gLSBQb2xpdGljYS4gTmVnYXRpdm8gPSB0ZSBmYWx0YSBwZWRpcjsgUG9zaXRpdm8gPSBzb2JyZXBlZGlkb1wiPlRvdGFsPC90aD4nICtcclxuICAgICc8L3RyPicgK1xyXG4gICAgJzwvdGhlYWQ+JztcclxuICBib2R5LmlubmVySFRNTCA9XHJcbiAgICAnPHRhYmxlIHN0eWxlPVwid2lkdGg6MTAwJTtib3JkZXItY29sbGFwc2U6Y29sbGFwc2U7Zm9udC1zaXplOjEycHhcIj4nICtcclxuICAgIGhlYWRlciArXHJcbiAgICAnPHRib2R5PicgK1xyXG4gICAgcm93c0h0bWwgK1xyXG4gICAgJzwvdGJvZHk+PC90YWJsZT4nO1xyXG59XHJcblxyXG5mdW5jdGlvbiBlc2NhcGVIdG1sU2FmZShzKSB7XHJcbiAgaWYgKHR5cGVvZiB3aW5kb3cuZXNjYXBlSHRtbCA9PT0gJ2Z1bmN0aW9uJykgcmV0dXJuIHdpbmRvdy5lc2NhcGVIdG1sKHMpO1xyXG4gIHJldHVybiBTdHJpbmcocyA9PSBudWxsID8gJycgOiBzKS5yZXBsYWNlKFxyXG4gICAgL1smPD5cIiddL2csXHJcbiAgICAoY2gpID0+ICh7ICcmJzogJyZhbXA7JywgJzwnOiAnJmx0OycsICc+JzogJyZndDsnLCAnXCInOiAnJnF1b3Q7JywgXCInXCI6ICcmIzM5OycgfSlbY2hdXHJcbiAgKTtcclxufVxyXG5cclxuZnVuY3Rpb24gX2J1aWxkU2FsZXNQbGFuU2xvdEh0bWwoZikge1xyXG4gIGNvbnN0IGNhY2hlID0gX3NhbGVzUGxhbkNhY2hlc1tmLmtleV07XHJcbiAgY29uc3Qgcm93c0NvdW50ID0gY2FjaGUgJiYgTnVtYmVyLmlzRmluaXRlKGNhY2hlLnJvd3NDb3VudCkgPyBjYWNoZS5yb3dzQ291bnQgOiAwO1xyXG4gIGNvbnN0IG1vbnRoc0NvdW50ID1cclxuICAgIGNhY2hlICYmIEFycmF5LmlzQXJyYXkoY2FjaGUuZGV0ZWN0ZWRNb250aHMpID8gY2FjaGUuZGV0ZWN0ZWRNb250aHMubGVuZ3RoIDogMDtcclxuICBjb25zdCBwYXJzZWRBdCA9IGNhY2hlICYmIGNhY2hlLnBhcnNlZEF0ID8gX2ZtdERhdGVTaG9ydChjYWNoZS5wYXJzZWRBdCkgOiAnJztcclxuICBjb25zdCB1cGxvYWRlZEJ5ID0gY2FjaGUgJiYgY2FjaGUudXBsb2FkZWRCeSA/IGNhY2hlLnVwbG9hZGVkQnkgOiAnJztcclxuICBjb25zdCBzb3VyY2VGaWxlbmFtZSA9IGNhY2hlICYmIGNhY2hlLnNvdXJjZUZpbGVuYW1lID8gY2FjaGUuc291cmNlRmlsZW5hbWUgOiAnJztcclxuICBjb25zdCB5ZWFyTW9udGggPSBjYWNoZSAmJiBjYWNoZS55ZWFyTW9udGggPyBjYWNoZS55ZWFyTW9udGggOiAnJztcclxuICBjb25zdCBtb250aHNSYW5nZSA9XHJcbiAgICBjYWNoZSAmJiBjYWNoZS5kZXRlY3RlZE1vbnRocyAmJiBjYWNoZS5kZXRlY3RlZE1vbnRocy5sZW5ndGhcclxuICAgICAgPyBjYWNoZS5kZXRlY3RlZE1vbnRoc1swXSArICcgXHUyMTkyICcgKyBjYWNoZS5kZXRlY3RlZE1vbnRoc1tjYWNoZS5kZXRlY3RlZE1vbnRocy5sZW5ndGggLSAxXVxyXG4gICAgICA6ICdcdTIwMTQnO1xyXG4gIGNvbnN0IGhhc0NhY2hlID0gISFjYWNoZTtcclxuICBjb25zdCBiYWRnZSA9IGhhc0NhY2hlXHJcbiAgICA/ICc8ZGl2IHN0eWxlPVwicGFkZGluZzo0cHggOHB4O2JhY2tncm91bmQ6IzE2YTM0YTtjb2xvcjojZmZmO2JvcmRlci1yYWRpdXM6MTJweDtmb250LXNpemU6MTBweDtmb250LXdlaWdodDo3MDA7bGV0dGVyLXNwYWNpbmc6LjRweFwiPkNBUkdBRE88L2Rpdj4nXHJcbiAgICA6ICc8ZGl2IHN0eWxlPVwicGFkZGluZzo0cHggOHB4O2JhY2tncm91bmQ6I2RjMjYyNjtjb2xvcjojZmZmO2JvcmRlci1yYWRpdXM6MTJweDtmb250LXNpemU6MTBweDtmb250LXdlaWdodDo3MDA7bGV0dGVyLXNwYWNpbmc6LjRweFwiPkZBTFRBPC9kaXY+JztcclxuICBjb25zdCBtZXRhQmxvY2sgPSBoYXNDYWNoZVxyXG4gICAgPyAnPGRpdiBzdHlsZT1cImRpc3BsYXk6Z3JpZDtncmlkLXRlbXBsYXRlLWNvbHVtbnM6YXV0byAxZnI7Z2FwOjZweCAxMnB4O2ZvbnQtc2l6ZToxMXB4O3BhZGRpbmc6MTBweCAxMnB4O2JhY2tncm91bmQ6dmFyKC0tYmctc2Vjb25kYXJ5KTtib3JkZXItcmFkaXVzOjZweFwiPicgK1xyXG4gICAgICAnPGRpdiBzdHlsZT1cImNvbG9yOnZhcigtLXRleHQtbXV0ZWQpO2ZvbnQtd2VpZ2h0OjYwMFwiPkFyY2hpdm88L2Rpdj48ZGl2IHN0eWxlPVwiY29sb3I6dmFyKC0tdGV4dC1wcmltYXJ5KTtmb250LWZhbWlseTptb25vc3BhY2U7d29yZC1icmVhazpicmVhay1hbGxcIj4nICtcclxuICAgICAgZXNjYXBlSHRtbFNhZmUoc291cmNlRmlsZW5hbWUpICtcclxuICAgICAgJzwvZGl2PicgK1xyXG4gICAgICAnPGRpdiBzdHlsZT1cImNvbG9yOnZhcigtLXRleHQtbXV0ZWQpO2ZvbnQtd2VpZ2h0OjYwMFwiPlN1YmlkbzwvZGl2PjxkaXYgc3R5bGU9XCJjb2xvcjp2YXIoLS10ZXh0LXByaW1hcnkpXCI+JyArXHJcbiAgICAgIGVzY2FwZUh0bWxTYWZlKHBhcnNlZEF0KSArXHJcbiAgICAgICc8L2Rpdj4nICtcclxuICAgICAgJzxkaXYgc3R5bGU9XCJjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTtmb250LXdlaWdodDo2MDBcIj5Qb3I8L2Rpdj48ZGl2IHN0eWxlPVwiY29sb3I6dmFyKC0tdGV4dC1wcmltYXJ5KVwiPicgK1xyXG4gICAgICBlc2NhcGVIdG1sU2FmZSh1cGxvYWRlZEJ5KSArXHJcbiAgICAgICc8L2Rpdj4nICtcclxuICAgICAgJzxkaXYgc3R5bGU9XCJjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTtmb250LXdlaWdodDo2MDBcIj5TbmFwc2hvdDwvZGl2PjxkaXYgc3R5bGU9XCJjb2xvcjp2YXIoLS10ZXh0LXByaW1hcnkpO2ZvbnQtZmFtaWx5Om1vbm9zcGFjZVwiPicgK1xyXG4gICAgICBlc2NhcGVIdG1sU2FmZSh5ZWFyTW9udGgpICtcclxuICAgICAgJzwvZGl2PicgK1xyXG4gICAgICAnPGRpdiBzdHlsZT1cImNvbG9yOnZhcigtLXRleHQtbXV0ZWQpO2ZvbnQtd2VpZ2h0OjYwMFwiPlNLVXM8L2Rpdj48ZGl2IHN0eWxlPVwiY29sb3I6dmFyKC0tdGV4dC1wcmltYXJ5KTtmb250LXdlaWdodDo3MDBcIj4nICtcclxuICAgICAgcm93c0NvdW50LnRvTG9jYWxlU3RyaW5nKCdlcy1BUicpICtcclxuICAgICAgJzwvZGl2PicgK1xyXG4gICAgICAnPGRpdiBzdHlsZT1cImNvbG9yOnZhcigtLXRleHQtbXV0ZWQpO2ZvbnQtd2VpZ2h0OjYwMFwiPk1lc2VzPC9kaXY+PGRpdiBzdHlsZT1cImNvbG9yOnZhcigtLXRleHQtcHJpbWFyeSk7Zm9udC13ZWlnaHQ6NzAwXCI+JyArXHJcbiAgICAgIG1vbnRoc0NvdW50ICtcclxuICAgICAgJyA8c3BhbiBzdHlsZT1cImNvbG9yOnZhcigtLXRleHQtbXV0ZWQpO2ZvbnQtd2VpZ2h0OjQwMFwiPignICtcclxuICAgICAgZXNjYXBlSHRtbFNhZmUobW9udGhzUmFuZ2UpICtcclxuICAgICAgJyk8L3NwYW4+PC9kaXY+JyArXHJcbiAgICAgICc8L2Rpdj4nXHJcbiAgICA6ICc8ZGl2IHN0eWxlPVwicGFkZGluZzoxNHB4O3RleHQtYWxpZ246Y2VudGVyO2ZvbnQtc2l6ZToxMnB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO2JhY2tncm91bmQ6dmFyKC0tYmctc2Vjb25kYXJ5KTtib3JkZXItcmFkaXVzOjZweDtib3JkZXI6MXB4IGRhc2hlZCB2YXIoLS1ib3JkZXItc3VidGxlKVwiPkF1biBubyBzdWJpc3RlIGVsIFNhbGVzIFBsYW4gZGUgZXN0YSBmYW1pbGlhLjwvZGl2Pic7XHJcbiAgY29uc3QgdXBsb2FkQnRuID1cclxuICAgICc8bGFiZWwgc3R5bGU9XCJkaXNwbGF5OmlubGluZS1mbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtqdXN0aWZ5LWNvbnRlbnQ6Y2VudGVyO2dhcDo4cHg7cGFkZGluZzoxMHB4IDE0cHg7YmFja2dyb3VuZDonICtcclxuICAgIGYuY29sb3IgK1xyXG4gICAgJztjb2xvcjojZmZmO2JvcmRlci1yYWRpdXM6NnB4O2ZvbnQtd2VpZ2h0OjcwMDtmb250LXNpemU6MTJweDtjdXJzb3I6cG9pbnRlcjtsZXR0ZXItc3BhY2luZzouNHB4XCI+JyArXHJcbiAgICAnPHNwYW4+JyArXHJcbiAgICAoaGFzQ2FjaGUgPyAnXHUyMUJCIFJlZW1wbGF6YXIgRXhjZWwnIDogJ1x1MkIwNiBDYXJnYXIgRXhjZWwnKSArXHJcbiAgICAnPC9zcGFuPicgK1xyXG4gICAgJzxpbnB1dCB0eXBlPVwiZmlsZVwiIGFjY2VwdD1cIi54bHN4LC54bHNcIiBkYXRhLWZhbWlsaWE9XCInICtcclxuICAgIGYua2V5ICtcclxuICAgICdcIiBzdHlsZT1cImRpc3BsYXk6bm9uZVwiIG9uY2hhbmdlPVwib25TYWxlc1BsYW5GaWxlRm9yRmFtaWxpYShldmVudCwgXFwnJyArXHJcbiAgICBmLmtleSArXHJcbiAgICAnXFwnKVwiLz4nICtcclxuICAgICc8L2xhYmVsPic7XHJcbiAgY29uc3QgY2FyZEhlYWQgPVxyXG4gICAgJzxkaXYgc3R5bGU9XCJkaXNwbGF5OmZsZXg7YWxpZ24taXRlbXM6Y2VudGVyO2dhcDoxMHB4XCI+JyArXHJcbiAgICAnPGRpdiBzdHlsZT1cIndpZHRoOjEycHg7aGVpZ2h0OjMycHg7YmFja2dyb3VuZDonICtcclxuICAgIGYuY29sb3IgK1xyXG4gICAgJztib3JkZXItcmFkaXVzOjNweFwiPjwvZGl2PicgK1xyXG4gICAgJzxkaXYgc3R5bGU9XCJmbGV4OjFcIj48ZGl2IHN0eWxlPVwiZm9udC1zaXplOjE0cHg7Zm9udC13ZWlnaHQ6ODAwO2NvbG9yOnZhcigtLXRleHQtcHJpbWFyeSlcIj4nICtcclxuICAgIGVzY2FwZUh0bWxTYWZlKGYubGFiZWwpICtcclxuICAgICc8L2Rpdj4nICtcclxuICAgICc8ZGl2IHN0eWxlPVwiZm9udC1zaXplOjExcHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7bWFyZ2luLXRvcDoycHhcIj5TYWxlcyBQbGFuIG1lbnN1YWwgXHUwMEI3IEhvamEgU0FSPC9kaXY+PC9kaXY+JyArXHJcbiAgICBiYWRnZSArXHJcbiAgICAnPC9kaXY+JztcclxuICByZXR1cm4gKFxyXG4gICAgJzxkaXYgc3R5bGU9XCJiYWNrZ3JvdW5kOnZhcigtLWJnLWVsZXZhdGVkKTtib3JkZXI6MXB4IHNvbGlkIHZhcigtLWJvcmRlci1zdWJ0bGUpO2JvcmRlci1yYWRpdXM6MTBweDtwYWRkaW5nOjE2cHg7ZGlzcGxheTpmbGV4O2ZsZXgtZGlyZWN0aW9uOmNvbHVtbjtnYXA6MTJweFwiPicgK1xyXG4gICAgY2FyZEhlYWQgK1xyXG4gICAgbWV0YUJsb2NrICtcclxuICAgIHVwbG9hZEJ0biArXHJcbiAgICAnPGRpdiBpZD1cInNhbGVzLXBsYW4tc3RhdHVzLScgK1xyXG4gICAgZi5rZXkgK1xyXG4gICAgJ1wiIHN0eWxlPVwiZm9udC1zaXplOjExcHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7bWluLWhlaWdodDoxNHB4XCI+PC9kaXY+JyArXHJcbiAgICAnPC9kaXY+J1xyXG4gICk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIF9yZW5kZXJTYWxlc1BsYW5zVGFiKCkge1xyXG4gIGNvbnN0IGNvbnQgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZm9yZWNhc3QtdGFiLXNhbGVzLXBsYW5zJyk7XHJcbiAgaWYgKCFjb250KSByZXR1cm47XHJcbiAgY29uc3Qgc2xvdHMgPSBTQUxFU19QTEFOX0ZBTUlMSUFTLm1hcChfYnVpbGRTYWxlc1BsYW5TbG90SHRtbCkuam9pbignJyk7XHJcbiAgY29uc3QgaW50cm8gPVxyXG4gICAgJzxkaXYgc3R5bGU9XCJtYXJnaW4tYm90dG9tOjE2cHg7cGFkZGluZzoxMnB4IDE0cHg7YmFja2dyb3VuZDp2YXIoLS1iZy1zZWNvbmRhcnkpO2JvcmRlci1sZWZ0OjNweCBzb2xpZCAjMGQ5NDg4O2JvcmRlci1yYWRpdXM6NnB4O2ZvbnQtc2l6ZToxMnB4O2NvbG9yOnZhcigtLXRleHQtc2Vjb25kYXJ5KTtsaW5lLWhlaWdodDoxLjVcIj4nICtcclxuICAgICc8YiBzdHlsZT1cImNvbG9yOnZhcigtLXRleHQtcHJpbWFyeSlcIj5GYXNlIDE8L2I+IFx1MjAxNCBDYXJnXHUwMEUxIGxvcyAzIFNhbGVzIFBsYW5zIG1lbnN1YWxlcyAoUm9kcyAvIFJlZWxzIC8gRkcpLiBTZSBwYXJzZWEgbGEgaG9qYSA8Yj5TQVI8L2I+OiBTS1UsIE1PUSAxMiBtb250aHMsIHkgdW5hIGNvbHVtbmEgcG9yIG1lcy4gJyArXHJcbiAgICAnRWwgRXhjZWwgb3JpZ2luYWwgcXVlZGEgc25hcHNob3RhZG8gZW4gU3RvcmFnZSB5IGVsIHBhcnNlbyBxdWVkYSBlbiBGaXJlc3RvcmUgcGFyYSBlbCBjXHUwMEUxbGN1bG8gKHByXHUwMEYzeGltYSBmYXNlKS4nICtcclxuICAgICc8L2Rpdj4nO1xyXG4gIGNvbnN0IGdyaWQgPVxyXG4gICAgJzxkaXYgc3R5bGU9XCJkaXNwbGF5OmdyaWQ7Z3JpZC10ZW1wbGF0ZS1jb2x1bW5zOnJlcGVhdChhdXRvLWZpdCxtaW5tYXgoMzIwcHgsMWZyKSk7Z2FwOjE2cHhcIj4nICtcclxuICAgIHNsb3RzICtcclxuICAgICc8L2Rpdj4nO1xyXG4gIGNvbnQuaW5uZXJIVE1MID0gJzxkaXYgc3R5bGU9XCJwYWRkaW5nOjE4cHhcIj4nICsgaW50cm8gKyBncmlkICsgJzwvZGl2Pic7XHJcbn1cclxuXHJcbndpbmRvdy5vblNhbGVzUGxhbkZpbGVGb3JGYW1pbGlhID0gYXN5bmMgZnVuY3Rpb24gKGV2ZW50LCBmYW1pbGlhKSB7XHJcbiAgY29uc3QgZmlsZSA9IGV2ZW50ICYmIGV2ZW50LnRhcmdldCAmJiBldmVudC50YXJnZXQuZmlsZXMgJiYgZXZlbnQudGFyZ2V0LmZpbGVzWzBdO1xyXG4gIGlmICghZmlsZSkgcmV0dXJuO1xyXG4gIGNvbnN0IHN0YXR1c0VsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3NhbGVzLXBsYW4tc3RhdHVzLScgKyBmYW1pbGlhKTtcclxuICBjb25zdCBzZXRTdGF0dXMgPSAobXNnLCBjb2xvcikgPT4ge1xyXG4gICAgaWYgKCFzdGF0dXNFbCkgcmV0dXJuO1xyXG4gICAgc3RhdHVzRWwudGV4dENvbnRlbnQgPSBtc2c7XHJcbiAgICBzdGF0dXNFbC5zdHlsZS5jb2xvciA9IGNvbG9yIHx8ICd2YXIoLS10ZXh0LW11dGVkKSc7XHJcbiAgfTtcclxuICB0cnkge1xyXG4gICAgaWYgKHR5cGVvZiBYTFNYID09PSAndW5kZWZpbmVkJykge1xyXG4gICAgICBhbGVydCgnU2hlZXRKUyAoWExTWCkgbm8gY2FyZ2FkbyBcdTIwMTQgcmVjYXJnXHUwMEUxIGxhIGFwcC4nKTtcclxuICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG4gICAgaWYgKCF3aW5kb3cuU2FsZXNQbGFuUGFyc2VyIHx8ICF3aW5kb3cuU2FsZXNQbGFuUGFyc2VyLnBhcnNlU2FsZXNQbGFuU2hlZXQpIHtcclxuICAgICAgYWxlcnQoJ1BhcnNlciBTYWxlcyBQbGFuIG5vIGNhcmdhZG8uIFJlYnVpbGQgYnVuZGxlLicpO1xyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcbiAgICBpZiAoIXdpbmRvdy5maXJlYmFzZSB8fCAhd2luZG93LmZpcmViYXNlLnN0b3JhZ2UpIHtcclxuICAgICAgYWxlcnQoJ0ZpcmViYXNlIFN0b3JhZ2Ugbm8gZGlzcG9uaWJsZS4nKTtcclxuICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG4gICAgc2V0U3RhdHVzKCdMZXllbmRvIEV4Y2VsXHUyMDI2Jyk7XHJcbiAgICBjb25zdCBidWYgPSBhd2FpdCBmaWxlLmFycmF5QnVmZmVyKCk7XHJcbiAgICBjb25zdCB3YiA9IFhMU1gucmVhZChidWYsIHsgdHlwZTogJ2FycmF5JyB9KTtcclxuICAgIGNvbnN0IHNhck5hbWUgPSB3Yi5TaGVldE5hbWVzLmZpbmQoXHJcbiAgICAgIChuKSA9PlxyXG4gICAgICAgIFN0cmluZyhuIHx8ICcnKVxyXG4gICAgICAgICAgLnRyaW0oKVxyXG4gICAgICAgICAgLnRvVXBwZXJDYXNlKCkgPT09ICdTQVInXHJcbiAgICApO1xyXG4gICAgaWYgKCFzYXJOYW1lKSB7XHJcbiAgICAgIHNldFN0YXR1cyhcclxuICAgICAgICAnXHUyNkEwIEVsIEV4Y2VsIG5vIHRpZW5lIGhvamEgXCJTQVJcIi4gSG9qYXMgZW5jb250cmFkYXM6ICcgKyB3Yi5TaGVldE5hbWVzLmpvaW4oJywgJyksXHJcbiAgICAgICAgJyNkYzI2MjYnXHJcbiAgICAgICk7XHJcbiAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIGNvbnN0IHNoZWV0ID0gd2IuU2hlZXRzW3Nhck5hbWVdO1xyXG4gICAgY29uc3Qgcm93cyA9IFhMU1gudXRpbHMuc2hlZXRfdG9fanNvbihzaGVldCwgeyBoZWFkZXI6IDEsIGRlZnZhbDogJycsIHJhdzogdHJ1ZSB9KTtcclxuICAgIHNldFN0YXR1cygnUGFyc2VhbmRvICcgKyByb3dzLmxlbmd0aCArICcgZmlsYXMgZGUgaG9qYSBcIicgKyBzYXJOYW1lICsgJ1wiXHUyMDI2Jyk7XHJcbiAgICBjb25zdCBwYXJzZWQgPSB3aW5kb3cuU2FsZXNQbGFuUGFyc2VyLnBhcnNlU2FsZXNQbGFuU2hlZXQocm93cyk7XHJcbiAgICBpZiAoIXBhcnNlZC5yb3dzLmxlbmd0aCkge1xyXG4gICAgICBzZXRTdGF0dXMoJ1x1MjZBMCBFeGNlbCBwYXJzZWFkbyBwZXJvIHNpbiBTS1VzIHZcdTAwRTFsaWRvcy4nLCAnI2RjMjYyNicpO1xyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcbiAgICBjb25zdCB5ZWFyTW9udGggPSBfeWVhck1vbnRoTm93KCk7XHJcbiAgICBjb25zdCBzdG9yYWdlUGF0aCA9ICdmb3JlY2FzdHNfc25hcHNob3RzLycgKyB5ZWFyTW9udGggKyAnLycgKyBmYW1pbGlhICsgJy54bHN4JztcclxuICAgIHNldFN0YXR1cygnU3ViaWVuZG8gRXhjZWwgYSBTdG9yYWdlICgnICsgX2ZtdFNpemUoZmlsZS5zaXplKSArICcpXHUyMDI2Jyk7XHJcbiAgICBjb25zdCBzdG9yYWdlUmVmID0gd2luZG93LmZpcmViYXNlLnN0b3JhZ2UoKS5yZWYoc3RvcmFnZVBhdGgpO1xyXG4gICAgYXdhaXQgc3RvcmFnZVJlZi5wdXQoZmlsZSwge1xyXG4gICAgICBjb250ZW50VHlwZTogZmlsZS50eXBlIHx8ICdhcHBsaWNhdGlvbi92bmQub3BlbnhtbGZvcm1hdHMtb2ZmaWNlZG9jdW1lbnQuc3ByZWFkc2hlZXRtbC5zaGVldCcsXHJcbiAgICAgIGN1c3RvbU1ldGFkYXRhOiB7XHJcbiAgICAgICAgZmFtaWxpYSxcclxuICAgICAgICB1cGxvYWRlZEJ5OiAod2luZG93LmN1cnJlbnRVc2VyICYmIHdpbmRvdy5jdXJyZW50VXNlci5lbWFpbCkgfHwgJycsXHJcbiAgICAgICAgc291cmNlRmlsZW5hbWU6IGZpbGUubmFtZSB8fCAnJyxcclxuICAgICAgfSxcclxuICAgIH0pO1xyXG4gICAgc2V0U3RhdHVzKCdHdWFyZGFuZG8gcGFyc2VvIGVuIEZpcmVzdG9yZSAoJyArIHBhcnNlZC5yb3dzLmxlbmd0aCArICcgU0tVcylcdTIwMjYnKTtcclxuICAgIGNvbnN0IHVwbG9hZGVkQnkgPSAod2luZG93LmN1cnJlbnRVc2VyICYmIHdpbmRvdy5jdXJyZW50VXNlci5lbWFpbCkgfHwgJ3Vua25vd24nO1xyXG4gICAgY29uc3QgcGF5bG9hZCA9IHtcclxuICAgICAgZmFtaWxpYSxcclxuICAgICAgcGFyc2VkQXQ6XHJcbiAgICAgICAgd2luZG93LmZpcmViYXNlICYmIHdpbmRvdy5maXJlYmFzZS5maXJlc3RvcmUgJiYgd2luZG93LmZpcmViYXNlLmZpcmVzdG9yZS5GaWVsZFZhbHVlXHJcbiAgICAgICAgICA/IHdpbmRvdy5maXJlYmFzZS5maXJlc3RvcmUuRmllbGRWYWx1ZS5zZXJ2ZXJUaW1lc3RhbXAoKVxyXG4gICAgICAgICAgOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXHJcbiAgICAgIHVwbG9hZGVkQnksXHJcbiAgICAgIHNvdXJjZUZpbGVuYW1lOiBmaWxlLm5hbWUgfHwgJycsXHJcbiAgICAgIHNvdXJjZVNoZWV0OiBzYXJOYW1lLFxyXG4gICAgICB5ZWFyTW9udGgsXHJcbiAgICAgIHN0b3JhZ2VQYXRoLFxyXG4gICAgICByb3dzQ291bnQ6IHBhcnNlZC5yb3dzLmxlbmd0aCxcclxuICAgICAgaGVhZGVyUm93SW5kZXg6IHBhcnNlZC5oZWFkZXJSb3dJbmRleCxcclxuICAgICAgZGV0ZWN0ZWRNb250aHM6IHBhcnNlZC5kZXRlY3RlZE1vbnRocyxcclxuICAgICAgcm93czogcGFyc2VkLnJvd3MsXHJcbiAgICB9O1xyXG4gICAgYXdhaXQgd2luZG93LmZiRGIuY29sbGVjdGlvbignc2FsZXNfcGxhbl9jYWNoZScpLmRvYyhmYW1pbGlhKS5zZXQocGF5bG9hZCk7XHJcbiAgICBfc2FsZXNQbGFuQ2FjaGVzW2ZhbWlsaWFdID0gcGF5bG9hZDtcclxuICAgIHNldFN0YXR1cyhcclxuICAgICAgJ1x1MjcxMyBPSy4gJyArIHBhcnNlZC5yb3dzLmxlbmd0aCArICcgU0tVcyBcdTAwRDcgJyArIHBhcnNlZC5kZXRlY3RlZE1vbnRocy5sZW5ndGggKyAnIG1lc2VzLicsXHJcbiAgICAgICcjMTZhMzRhJ1xyXG4gICAgKTtcclxuICAgIF9yZW5kZXJTYWxlc1BsYW5zVGFiKCk7XHJcbiAgfSBjYXRjaCAoZSkge1xyXG4gICAgY29uc29sZS5lcnJvcignW0ZPUkVDQVNUXSB1cGxvYWQgc2FsZXMgcGxhbiAnICsgZmFtaWxpYSArICcgZmFpbDonLCBlKTtcclxuICAgIHNldFN0YXR1cygnXHUyNzE3IEVycm9yOiAnICsgKChlICYmIGUubWVzc2FnZSkgfHwgZSksICcjZGMyNjI2Jyk7XHJcbiAgICBpZiAoZSAmJiBlLmNvZGUgPT09ICdNT05USFNfTk9UX0ZPVU5EJykge1xyXG4gICAgICBhbGVydChcclxuICAgICAgICAnRWwgRXhjZWwgbm8gdGllbmUgY29sdW1uYXMgZGUgbWVzZXMgcmVjb25vY2libGVzLlxcblxcbkhlYWRlcnMgZXNwZXJhZG9zOiBcIkphbiAyMDI3XCIsIFwiTWF5IDIwMjdcIiwgXCJFbmUgMjAyN1wiLCBcIjIwMjctMDFcIiwgZXRjLlxcblxcbkRldGFsbGU6ICcgK1xyXG4gICAgICAgICAgZS5tZXNzYWdlXHJcbiAgICAgICk7XHJcbiAgICB9XHJcbiAgfSBmaW5hbGx5IHtcclxuICAgIGlmIChldmVudCAmJiBldmVudC50YXJnZXQpIGV2ZW50LnRhcmdldC52YWx1ZSA9ICcnO1xyXG4gIH1cclxufTtcclxuXHJcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG4vLyBGMkIgXHUyMDE0IEZvcmVjYXN0IEVzdGFkXHUwMEVEc3RpY286IHRhYmxhICsgZGV0YWxsZVxyXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHJcbmFzeW5jIGZ1bmN0aW9uIF9sb2FkRm9yZWNhc3RPdXRwdXQoKSB7XHJcbiAgaWYgKCF3aW5kb3cuZmJEYikgdGhyb3cgbmV3IEVycm9yKCdGaXJlc3RvcmUgbm8gaW5pY2lhbGl6YWRvJyk7XHJcbiAgY29uc3QgW3NuYXAsIG1ldGFEb2NdID0gYXdhaXQgUHJvbWlzZS5hbGwoW1xyXG4gICAgd2luZG93LmZiRGIuY29sbGVjdGlvbignZm9yZWNhc3Rfb3V0cHV0JykuZ2V0KCksXHJcbiAgICB3aW5kb3cuZmJEYi5jb2xsZWN0aW9uKCdmb3JlY2FzdF9vdXRwdXRfbWV0YScpLmRvYygnY3VycmVudCcpLmdldCgpLFxyXG4gIF0pO1xyXG4gIGNvbnN0IGRvY3MgPSBbXTtcclxuICBzbmFwLmZvckVhY2goKGQpID0+IGRvY3MucHVzaChPYmplY3QuYXNzaWduKHsgaWQ6IGQuaWQgfSwgZC5kYXRhKCkpKSk7XHJcbiAgZG9jcy5zb3J0KChhLCBiKSA9PiB7XHJcbiAgICBjb25zdCB3YSA9IChhLm1ldHJpY3MgJiYgYS5tZXRyaWNzLndhcGUpIHx8IDk5OTtcclxuICAgIGNvbnN0IHdiID0gKGIubWV0cmljcyAmJiBiLm1ldHJpY3Mud2FwZSkgfHwgOTk5O1xyXG4gICAgcmV0dXJuIHdhIC0gd2I7XHJcbiAgfSk7XHJcbiAgX2ZvcmVjYXN0U3RhdERvY3MgPSBkb2NzO1xyXG4gIF9mb3JlY2FzdFN0YXRNZXRhID0gbWV0YURvYy5leGlzdHMgPyBtZXRhRG9jLmRhdGEoKSA6IG51bGw7XHJcbiAgcmV0dXJuIGRvY3M7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIF93YXBlQmFkZ2VDb2xvcih3KSB7XHJcbiAgaWYgKHcgPT0gbnVsbCkgcmV0dXJuICcjNjQ3NDhiJztcclxuICBpZiAodyA8IDAuMykgcmV0dXJuICcjMTZhMzRhJzsgLy8gdmVyZGUgLSBleGNlbGVudGVcclxuICBpZiAodyA8IDAuNSkgcmV0dXJuICcjODRjYzE2JzsgLy8gbGltYSAtIGJ1ZW5vXHJcbiAgaWYgKHcgPCAwLjcpIHJldHVybiAnI2VhYjMwOCc7IC8vIGFtYXJpbGxvIC0gYWNlcHRhYmxlXHJcbiAgaWYgKHcgPCAxLjApIHJldHVybiAnI2Y5NzMxNic7IC8vIG5hcmFuamEgLSBwb2JyZVxyXG4gIHJldHVybiAnI2RjMjYyNic7IC8vIHJvam8gLSBtdXkgcG9icmVcclxufVxyXG5cclxuZnVuY3Rpb24gX2ZtdE51bShuKSB7XHJcbiAgaWYgKG4gPT0gbnVsbCB8fCAhTnVtYmVyLmlzRmluaXRlKE51bWJlcihuKSkpIHJldHVybiAnXHUyMDE0JztcclxuICByZXR1cm4gTnVtYmVyKG4pLnRvTG9jYWxlU3RyaW5nKCdlcy1BUicsIHsgbWF4aW11bUZyYWN0aW9uRGlnaXRzOiAwIH0pO1xyXG59XHJcblxyXG5mdW5jdGlvbiBfZm10V2FwZSh3KSB7XHJcbiAgaWYgKHcgPT0gbnVsbCB8fCAhTnVtYmVyLmlzRmluaXRlKE51bWJlcih3KSkpIHJldHVybiAnXHUyMDE0JztcclxuICByZXR1cm4gKE51bWJlcih3KSAqIDEwMCkudG9GaXhlZCgwKSArICclJztcclxufVxyXG5cclxuZnVuY3Rpb24gX2ZtdERzU2hvcnQoaXNvKSB7XHJcbiAgLy8gJzIwMjYtMTAtMDEnIC0+ICdvY3QgMjYnXHJcbiAgdHJ5IHtcclxuICAgIGNvbnN0IFt5LCBtXSA9IGlzby5zcGxpdCgnLScpLm1hcChOdW1iZXIpO1xyXG4gICAgY29uc3QgbmFtZXMgPSBbXHJcbiAgICAgICdlbmUnLFxyXG4gICAgICAnZmViJyxcclxuICAgICAgJ21hcicsXHJcbiAgICAgICdhYnInLFxyXG4gICAgICAnbWF5JyxcclxuICAgICAgJ2p1bicsXHJcbiAgICAgICdqdWwnLFxyXG4gICAgICAnYWdvJyxcclxuICAgICAgJ3NlcCcsXHJcbiAgICAgICdvY3QnLFxyXG4gICAgICAnbm92JyxcclxuICAgICAgJ2RpYycsXHJcbiAgICBdO1xyXG4gICAgcmV0dXJuIG5hbWVzW20gLSAxXSArICcgJyArIFN0cmluZyh5KS5zbGljZSgtMik7XHJcbiAgfSBjYXRjaCB7XHJcbiAgICByZXR1cm4gaXNvO1xyXG4gIH1cclxufVxyXG5cclxuZnVuY3Rpb24gX3JlbmRlckZvcmVjYXN0U3RhdFRhYigpIHtcclxuICBjb25zdCBjb250ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2ZvcmVjYXN0LXRhYi1zdGF0Jyk7XHJcbiAgaWYgKCFjb250KSByZXR1cm47XHJcbiAgY29uc3QgZG9jcyA9IF9mb3JlY2FzdFN0YXREb2NzIHx8IFtdO1xyXG4gIGNvbnN0IG1ldGEgPSBfZm9yZWNhc3RTdGF0TWV0YSB8fCB7fTtcclxuICBjb25zdCByZXN1bWVuID0gbWV0YS5yZXN1bWVuIHx8IHt9O1xyXG4gIGlmICghZG9jcy5sZW5ndGgpIHtcclxuICAgIGNvbnQuaW5uZXJIVE1MID1cclxuICAgICAgJzxkaXYgc3R5bGU9XCJwYWRkaW5nOjYwcHggMjBweDt0ZXh0LWFsaWduOmNlbnRlcjtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKVwiPicgK1xyXG4gICAgICAnTm8gaGF5IGZvcmVjYXN0X291dHB1dCBwdWJsaWNhZG8uPGJyPjxicj4nICtcclxuICAgICAgJ0NvcnJlciA8Y29kZT5weXRob24gc2NyaXB0cy9mb3JlY2FzdC90cmFpbl9wcm9kLnB5ICYmIHB5dGhvbiBzY3JpcHRzL2ZvcmVjYXN0L3B1Ymxpc2hfdG9fZmlyZXN0b3JlLnB5PC9jb2RlPi4nICtcclxuICAgICAgJzwvZGl2Pic7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIC8vIE1lc2VzIGRlbCBmb3JlY2FzdCAoZHMgZGVsIHByaW1lciBkb2MsIHNlIGFzdW1lIGlndWFsIGVuIHRvZG9zKS5cclxuICBjb25zdCBtb250aHNJc28gPSAoZG9jc1swXS5mb3JlY2FzdCB8fCBbXSkubWFwKChmKSA9PiBmLmRzKTtcclxuICBjb25zdCBtb250aEhlYWRlcnMgPSBtb250aHNJc28ubWFwKF9mbXREc1Nob3J0KTtcclxuXHJcbiAgLy8gTWV0cmljcyBjaGlwIGdsb2JhbFxyXG4gIGNvbnN0IGdlbmVyYXRlZCA9IG1ldGEuZ2VuZXJhdGVkQXRcclxuICAgID8gbmV3IERhdGUobWV0YS5nZW5lcmF0ZWRBdCkudG9Mb2NhbGVTdHJpbmcoJ2VzLUFSJywge1xyXG4gICAgICAgIGRheTogJzItZGlnaXQnLFxyXG4gICAgICAgIG1vbnRoOiAnc2hvcnQnLFxyXG4gICAgICAgIHllYXI6ICcyLWRpZ2l0JyxcclxuICAgICAgICBob3VyOiAnMi1kaWdpdCcsXHJcbiAgICAgICAgbWludXRlOiAnMi1kaWdpdCcsXHJcbiAgICAgIH0pXHJcbiAgICA6ICdcdTIwMTQnO1xyXG4gIGNvbnN0IHdhcGVNZWQgPVxyXG4gICAgcmVzdW1lbi53YXBlX21lZGlhbm9fYmVzdF9wZXJfc2VyaWVzICE9IG51bGxcclxuICAgICAgPyBfZm10V2FwZShyZXN1bWVuLndhcGVfbWVkaWFub19iZXN0X3Blcl9zZXJpZXMpXHJcbiAgICAgIDogJ1x1MjAxNCc7XHJcbiAgY29uc3QgblN1YnMgPSByZXN1bWVuLm5fc3ViZmFtaWxpYXMgfHwgZG9jcy5sZW5ndGg7XHJcbiAgY29uc3Qgbkx0MDUgPVxyXG4gICAgcmVzdW1lbi5uX3Nlcmllc193YXBlX2x0XzBfNSAhPSBudWxsID8gcmVzdW1lbi5uX3Nlcmllc193YXBlX2x0XzBfNSArICcvJyArIG5TdWJzIDogJ1x1MjAxNCc7XHJcbiAgY29uc3Qgbkx0MDMgPVxyXG4gICAgcmVzdW1lbi5uX3Nlcmllc193YXBlX2x0XzBfMyAhPSBudWxsID8gcmVzdW1lbi5uX3Nlcmllc193YXBlX2x0XzBfMyArICcvJyArIG5TdWJzIDogJ1x1MjAxNCc7XHJcblxyXG4gIGNvbnN0IGJhbm5lciA9XHJcbiAgICAnPGRpdiBzdHlsZT1cIm1hcmdpbi1ib3R0b206MTRweDtwYWRkaW5nOjEycHggMTRweDtiYWNrZ3JvdW5kOnZhcigtLWJnLXNlY29uZGFyeSk7Ym9yZGVyLWxlZnQ6M3B4IHNvbGlkICMwZDk0ODg7Ym9yZGVyLXJhZGl1czo2cHg7Zm9udC1zaXplOjEycHg7Y29sb3I6dmFyKC0tdGV4dC1zZWNvbmRhcnkpO2xpbmUtaGVpZ2h0OjEuNTtkaXNwbGF5OmdyaWQ7Z3JpZC10ZW1wbGF0ZS1jb2x1bW5zOnJlcGVhdChhdXRvLWZpdCxtaW5tYXgoMTYwcHgsMWZyKSk7Z2FwOjEwcHhcIj4nICtcclxuICAgICc8ZGl2PjxkaXYgc3R5bGU9XCJmb250LXNpemU6MTBweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7bGV0dGVyLXNwYWNpbmc6LjRweFwiPldBUEUgbWVkaWFubzwvZGl2PjxkaXYgc3R5bGU9XCJmb250LXNpemU6MjBweDtmb250LXdlaWdodDo4MDA7Y29sb3I6dmFyKC0tdGV4dC1wcmltYXJ5KVwiPicgK1xyXG4gICAgd2FwZU1lZCArXHJcbiAgICAnPC9kaXY+PC9kaXY+JyArXHJcbiAgICAnPGRpdj48ZGl2IHN0eWxlPVwiZm9udC1zaXplOjEwcHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO2xldHRlci1zcGFjaW5nOi40cHhcIj5TdWJmYW1pbGlhczwvZGl2PjxkaXYgc3R5bGU9XCJmb250LXNpemU6MjBweDtmb250LXdlaWdodDo4MDA7Y29sb3I6dmFyKC0tdGV4dC1wcmltYXJ5KVwiPicgK1xyXG4gICAgblN1YnMgK1xyXG4gICAgJzwvZGl2PjwvZGl2PicgK1xyXG4gICAgJzxkaXY+PGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMHB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtsZXR0ZXItc3BhY2luZzouNHB4XCI+V0FQRSAmbHQ7IDMwJSAoZXhjZWxlbnRlKTwvZGl2PjxkaXYgc3R5bGU9XCJmb250LXNpemU6MjBweDtmb250LXdlaWdodDo4MDA7Y29sb3I6IzE2YTM0YVwiPicgK1xyXG4gICAgbkx0MDMgK1xyXG4gICAgJzwvZGl2PjwvZGl2PicgK1xyXG4gICAgJzxkaXY+PGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMHB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtsZXR0ZXItc3BhY2luZzouNHB4XCI+V0FQRSAmbHQ7IDUwJSAoYnVlbm8pPC9kaXY+PGRpdiBzdHlsZT1cImZvbnQtc2l6ZToyMHB4O2ZvbnQtd2VpZ2h0OjgwMDtjb2xvcjojODRjYzE2XCI+JyArXHJcbiAgICBuTHQwNSArXHJcbiAgICAnPC9kaXY+PC9kaXY+JyArXHJcbiAgICAnPGRpdj48ZGl2IHN0eWxlPVwiZm9udC1zaXplOjEwcHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO2xldHRlci1zcGFjaW5nOi40cHhcIj5cdTAwREFsdGltYSBjb3JyaWRhPC9kaXY+PGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxM3B4O2ZvbnQtd2VpZ2h0OjYwMDtjb2xvcjp2YXIoLS10ZXh0LXByaW1hcnkpO21hcmdpbi10b3A6NHB4XCI+JyArXHJcbiAgICBlc2NhcGVIdG1sU2FmZShnZW5lcmF0ZWQpICtcclxuICAgICc8L2Rpdj48L2Rpdj4nICtcclxuICAgICc8L2Rpdj4nO1xyXG5cclxuICAvLyBUYWJsYSByb3dzXHJcbiAgY29uc3Qgcm93c0h0bWwgPSBkb2NzXHJcbiAgICAubWFwKChkKSA9PiB7XHJcbiAgICAgIGNvbnN0IHdhcGUgPSBkLm1ldHJpY3MgJiYgZC5tZXRyaWNzLndhcGUgIT0gbnVsbCA/IGQubWV0cmljcy53YXBlIDogbnVsbDtcclxuICAgICAgY29uc3QgYmVzdE1vZGVsID0gZC5iZXN0TW9kZWwgfHwgJ1x1MjAxNCc7XHJcbiAgICAgIGNvbnN0IGZvcmVjYXN0TWFwID0ge307XHJcbiAgICAgIChkLmZvcmVjYXN0IHx8IFtdKS5mb3JFYWNoKChmKSA9PiB7XHJcbiAgICAgICAgZm9yZWNhc3RNYXBbZi5kc10gPSBmLnlfaGF0O1xyXG4gICAgICB9KTtcclxuICAgICAgY29uc3QgbW9udGhDZWxscyA9IG1vbnRoc0lzb1xyXG4gICAgICAgIC5tYXAoXHJcbiAgICAgICAgICAoZHMpID0+XHJcbiAgICAgICAgICAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjhweCAxMHB4O3RleHQtYWxpZ246cmlnaHQ7Zm9udC12YXJpYW50LW51bWVyaWM6dGFidWxhci1udW1zO2ZvbnQtd2VpZ2h0OjYwMDtjb2xvcjp2YXIoLS10ZXh0LXByaW1hcnkpXCI+JyArXHJcbiAgICAgICAgICAgIF9mbXROdW0oZm9yZWNhc3RNYXBbZHNdKSArXHJcbiAgICAgICAgICAgICc8L3RkPidcclxuICAgICAgICApXHJcbiAgICAgICAgLmpvaW4oJycpO1xyXG4gICAgICBjb25zdCB0b3RhbDcgPSAoZC5mb3JlY2FzdCB8fCBbXSkucmVkdWNlKChzLCBmKSA9PiBzICsgKE51bWJlcihmLnlfaGF0KSB8fCAwKSwgMCk7XHJcbiAgICAgIHJldHVybiAoXHJcbiAgICAgICAgJzx0ciBvbmNsaWNrPVwib3BlbkZvcmVjYXN0U3RhdERldGFpbChcXCcnICtcclxuICAgICAgICBlc2NhcGVIdG1sU2FmZShkLmlkKSArXHJcbiAgICAgICAgJ1xcJylcIiBzdHlsZT1cImN1cnNvcjpwb2ludGVyO2JvcmRlci1ib3R0b206MXB4IHNvbGlkIHZhcigtLWJvcmRlci1zdWJ0bGUpXCIgb25tb3VzZW92ZXI9XCJ0aGlzLnN0eWxlLmJhY2tncm91bmQ9XFwndmFyKC0tYmctc2Vjb25kYXJ5KVxcJ1wiIG9ubW91c2VvdXQ9XCJ0aGlzLnN0eWxlLmJhY2tncm91bmQ9XFwndHJhbnNwYXJlbnRcXCdcIj4nICtcclxuICAgICAgICAnPHRkIHN0eWxlPVwicGFkZGluZzo4cHggMTBweDtmb250LXdlaWdodDo3MDA7Y29sb3I6dmFyKC0tdGV4dC1wcmltYXJ5KVwiPicgK1xyXG4gICAgICAgIGVzY2FwZUh0bWxTYWZlKGQuc3ViZmFtaWxpYSB8fCBkLmlkKSArXHJcbiAgICAgICAgJzwvdGQ+JyArXHJcbiAgICAgICAgJzx0ZCBzdHlsZT1cInBhZGRpbmc6OHB4IDEwcHg7Zm9udC1zaXplOjExcHg7Y29sb3I6dmFyKC0tdGV4dC1zZWNvbmRhcnkpXCI+JyArXHJcbiAgICAgICAgZXNjYXBlSHRtbFNhZmUoYmVzdE1vZGVsKSArXHJcbiAgICAgICAgJzwvdGQ+JyArXHJcbiAgICAgICAgJzx0ZCBzdHlsZT1cInBhZGRpbmc6OHB4IDEwcHg7dGV4dC1hbGlnbjpjZW50ZXJcIj48c3BhbiBzdHlsZT1cImRpc3BsYXk6aW5saW5lLWJsb2NrO3BhZGRpbmc6M3B4IDhweDtib3JkZXItcmFkaXVzOjEycHg7YmFja2dyb3VuZDonICtcclxuICAgICAgICBfd2FwZUJhZGdlQ29sb3Iod2FwZSkgK1xyXG4gICAgICAgICc7Y29sb3I6I2ZmZjtmb250LXNpemU6MTFweDtmb250LXdlaWdodDo3MDBcIj4nICtcclxuICAgICAgICBfZm10V2FwZSh3YXBlKSArXHJcbiAgICAgICAgJzwvc3Bhbj48L3RkPicgK1xyXG4gICAgICAgIG1vbnRoQ2VsbHMgK1xyXG4gICAgICAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjhweCAxMHB4O3RleHQtYWxpZ246cmlnaHQ7Zm9udC12YXJpYW50LW51bWVyaWM6dGFidWxhci1udW1zO2ZvbnQtd2VpZ2h0OjcwMDtjb2xvcjojMGQ5NDg4O2JhY2tncm91bmQ6dmFyKC0tYmctc2Vjb25kYXJ5KVwiPicgK1xyXG4gICAgICAgIF9mbXROdW0odG90YWw3KSArXHJcbiAgICAgICAgJzwvdGQ+JyArXHJcbiAgICAgICAgJzwvdHI+J1xyXG4gICAgICApO1xyXG4gICAgfSlcclxuICAgIC5qb2luKCcnKTtcclxuXHJcbiAgY29uc3QgbW9udGhIZWFkZXJzSHRtbCA9IG1vbnRoSGVhZGVyc1xyXG4gICAgLm1hcChcclxuICAgICAgKG0pID0+XHJcbiAgICAgICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6OHB4IDEwcHg7dGV4dC1hbGlnbjpyaWdodDtmb250LXNpemU6MTBweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7bGV0dGVyLXNwYWNpbmc6LjRweDtjb2xvcjojOTRhM2I4XCI+JyArXHJcbiAgICAgICAgZXNjYXBlSHRtbFNhZmUobSkgK1xyXG4gICAgICAgICc8L3RoPidcclxuICAgIClcclxuICAgIC5qb2luKCcnKTtcclxuXHJcbiAgY29uc3QgdGFibGUgPVxyXG4gICAgJzxkaXYgc3R5bGU9XCJvdmVyZmxvdzphdXRvO2JvcmRlcjoxcHggc29saWQgdmFyKC0tYm9yZGVyLXN1YnRsZSk7Ym9yZGVyLXJhZGl1czo4cHhcIj4nICtcclxuICAgICc8dGFibGUgc3R5bGU9XCJ3aWR0aDoxMDAlO2JvcmRlci1jb2xsYXBzZTpjb2xsYXBzZTtmb250LXNpemU6MTJweFwiPicgK1xyXG4gICAgJzx0aGVhZCBzdHlsZT1cImJhY2tncm91bmQ6IzBmMTcyYTtjb2xvcjojZmZmXCI+PHRyPicgK1xyXG4gICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6OHB4IDEwcHg7dGV4dC1hbGlnbjpsZWZ0O2ZvbnQtc2l6ZToxMHB4O3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtsZXR0ZXItc3BhY2luZzouNHB4XCI+U3ViZmFtaWxpYTwvdGg+JyArXHJcbiAgICAnPHRoIHN0eWxlPVwicGFkZGluZzo4cHggMTBweDt0ZXh0LWFsaWduOmxlZnQ7Zm9udC1zaXplOjEwcHg7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO2xldHRlci1zcGFjaW5nOi40cHhcIj5Nb2RlbG88L3RoPicgK1xyXG4gICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6OHB4IDEwcHg7dGV4dC1hbGlnbjpjZW50ZXI7Zm9udC1zaXplOjEwcHg7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO2xldHRlci1zcGFjaW5nOi40cHhcIj5XQVBFPC90aD4nICtcclxuICAgIG1vbnRoSGVhZGVyc0h0bWwgK1xyXG4gICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6OHB4IDEwcHg7dGV4dC1hbGlnbjpyaWdodDtmb250LXNpemU6MTBweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7bGV0dGVyLXNwYWNpbmc6LjRweDtiYWNrZ3JvdW5kOiMxMzRlNGFcIj5Ub3RhbCA3bTwvdGg+JyArXHJcbiAgICAnPC90cj48L3RoZWFkPicgK1xyXG4gICAgJzx0Ym9keT4nICtcclxuICAgIHJvd3NIdG1sICtcclxuICAgICc8L3Rib2R5PjwvdGFibGU+PC9kaXY+JztcclxuXHJcbiAgY29uc3QgZm9vdGVyID1cclxuICAgICc8ZGl2IHN0eWxlPVwibWFyZ2luLXRvcDoxMnB4O2ZvbnQtc2l6ZToxMXB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO2xpbmUtaGVpZ2h0OjEuNVwiPicgK1xyXG4gICAgJzxiPkNcdTAwRjNtbyBsZWVyPC9iPjogV0FQRSAoV2VpZ2h0ZWQgQWJzb2x1dGUgUGVyY2VudGFnZSBFcnJvcikgbWlkZSBlbCBlcnJvciBkZWwgbW9kZWxvIHJlbGF0aXZvIGFsIHRvdGFsIHJlYWw6ICZsdDszMCUgZXhjZWxlbnRlLCAzMC01MCUgYnVlbm8sIDUwLTcwJSBhY2VwdGFibGUsICZndDs3MCUgcG9icmUuIENsaWNrIGVuIGZpbGEgcGFyYSBkZXRhbGxlICsgZ3JcdTAwRTFmaWNvLiAnICtcclxuICAgICdTZSBlbGlnZSBlbCBtb2RlbG8gY29uIG1lbm9yIFdBUEUgcG9yIHNlcmllIHRyYXMgYmFja3Rlc3Qgcm9sbGluZy1vcmlnaW4gKGg9MiwgdmVudGFuYXM9MykuJyArXHJcbiAgICAnPC9kaXY+JztcclxuXHJcbiAgY29udC5pbm5lckhUTUwgPSAnPGRpdiBzdHlsZT1cInBhZGRpbmc6MThweFwiPicgKyBiYW5uZXIgKyB0YWJsZSArIGZvb3RlciArICc8L2Rpdj4nO1xyXG59XHJcblxyXG4vLyBDYWNoZSBoaXN0b3JpYSBhZ3JlZ2FkYSBwb3Igc3ViZmFtaWxpYSAocGFyYSBnclx1MDBFMWZpY28gZGV0YWxsZSkuXHJcbmFzeW5jIGZ1bmN0aW9uIF9sb2FkRm9yZWNhc3RTdGF0SGlzdG9yeSgpIHtcclxuICBpZiAoX2ZvcmVjYXN0U3RhdEhpc3RvcnlDYWNoZSkgcmV0dXJuIF9mb3JlY2FzdFN0YXRIaXN0b3J5Q2FjaGU7XHJcbiAgLy8gTGEgaGlzdG9yaWEgc29sbyBlc3RcdTAwRTEgZW4gQlEgKH4xMCBhXHUwMEYxb3MgQmFyYWxkbyArIDEyIG1lc2VzIFNoaW1hbm8pLiBDb21vXHJcbiAgLy8gZWwgcGlwZWxpbmUgbGEgZXNjcmliZSBhIENTViBsb2NhbCwgYWNcdTAwRTEgbm8gbGEgcG9kZW1vcyBsZWVyLiBBbHRlcm5hdGl2YTpcclxuICAvLyB1c2FyIHNrdV92ZW50YXNfc25hcHNob3QgcXVlIHRpZW5lIHZlbnRhcyBtZW5zdWFsZXMgcGVybyBzb2xvIGdydXBvIFBFU0NBLlxyXG4gIC8vIEVuIEYyQi4yIHNvbG8gbW9zdHJhbW9zIGZvcmVjYXN0K0lDIChzaW4gb3ZlcmxheSBoaXN0b3JpYSBwb3IgYWhvcmEpLlxyXG4gIF9mb3JlY2FzdFN0YXRIaXN0b3J5Q2FjaGUgPSB7fTtcclxuICByZXR1cm4gX2ZvcmVjYXN0U3RhdEhpc3RvcnlDYWNoZTtcclxufVxyXG5cclxuZnVuY3Rpb24gX2J1aWxkRm9yZWNhc3RDaGFydFN2Zyhkb2MpIHtcclxuICBjb25zdCBmYyA9IGRvYy5mb3JlY2FzdCB8fCBbXTtcclxuICBpZiAoIWZjLmxlbmd0aClcclxuICAgIHJldHVybiAnPGRpdiBzdHlsZT1cInBhZGRpbmc6MzBweDt0ZXh0LWFsaWduOmNlbnRlcjtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKVwiPlNpbiBkYXRvcyBkZSBmb3JlY2FzdDwvZGl2Pic7XHJcbiAgLy8gRGltZW5zaW9uZXNcclxuICBjb25zdCBXID0gNjQwLFxyXG4gICAgSCA9IDI2MDtcclxuICBjb25zdCBwYWRMID0gNTAsXHJcbiAgICBwYWRSID0gMjAsXHJcbiAgICBwYWRUID0gMjAsXHJcbiAgICBwYWRCID0gNDA7XHJcbiAgY29uc3QgaW5uZXJXID0gVyAtIHBhZEwgLSBwYWRSO1xyXG4gIGNvbnN0IGlubmVySCA9IEggLSBwYWRUIC0gcGFkQjtcclxuXHJcbiAgLy8gWSByYW5nZTogbWF4KGhpODApICogMS4xXHJcbiAgY29uc3QgbWF4WSA9IE1hdGgubWF4KDEsIC4uLmZjLm1hcCgoZikgPT4gTnVtYmVyKGYuaGk4MCkgfHwgTnVtYmVyKGYueV9oYXQpIHx8IDApKTtcclxuICBjb25zdCBtaW5ZID0gMDtcclxuICBjb25zdCBzY2FsZVggPSAoaSkgPT4gcGFkTCArIChpbm5lclcgKiBpKSAvIE1hdGgubWF4KDEsIGZjLmxlbmd0aCAtIDEpO1xyXG4gIGNvbnN0IHNjYWxlWSA9ICh2KSA9PiBwYWRUICsgaW5uZXJIIC0gKGlubmVySCAqICh2IC0gbWluWSkpIC8gKG1heFkgLSBtaW5ZKTtcclxuXHJcbiAgLy8gR3JpZCArIGVqZSBZXHJcbiAgY29uc3QgeVRpY2tzID0gWzAsIDAuMjUsIDAuNSwgMC43NSwgMV1cclxuICAgIC5tYXAoKHIpID0+IHtcclxuICAgICAgY29uc3QgdmFsID0gbWluWSArIHIgKiAobWF4WSAtIG1pblkpO1xyXG4gICAgICBjb25zdCB5eSA9IHNjYWxlWSh2YWwpO1xyXG4gICAgICByZXR1cm4gKFxyXG4gICAgICAgICc8bGluZSB4MT1cIicgK1xyXG4gICAgICAgIHBhZEwgK1xyXG4gICAgICAgICdcIiB5MT1cIicgK1xyXG4gICAgICAgIHl5ICtcclxuICAgICAgICAnXCIgeDI9XCInICtcclxuICAgICAgICAoVyAtIHBhZFIpICtcclxuICAgICAgICAnXCIgeTI9XCInICtcclxuICAgICAgICB5eSArXHJcbiAgICAgICAgJ1wiIHN0cm9rZT1cIiNlMmU4ZjBcIiBzdHJva2Utd2lkdGg9XCIxXCIvPicgK1xyXG4gICAgICAgICc8dGV4dCB4PVwiJyArXHJcbiAgICAgICAgKHBhZEwgLSA2KSArXHJcbiAgICAgICAgJ1wiIHk9XCInICtcclxuICAgICAgICAoeXkgKyA0KSArXHJcbiAgICAgICAgJ1wiIHRleHQtYW5jaG9yPVwiZW5kXCIgZm9udC1zaXplPVwiMTBcIiBmaWxsPVwiIzY0NzQ4YlwiPicgK1xyXG4gICAgICAgIF9mbXROdW0odmFsKSArXHJcbiAgICAgICAgJzwvdGV4dD4nXHJcbiAgICAgICk7XHJcbiAgICB9KVxyXG4gICAgLmpvaW4oJycpO1xyXG5cclxuICAvLyBFamUgWCAobWVzZXMpXHJcbiAgY29uc3QgeExhYmVscyA9IGZjXHJcbiAgICAubWFwKChmLCBpKSA9PiB7XHJcbiAgICAgIGNvbnN0IHh4ID0gc2NhbGVYKGkpO1xyXG4gICAgICByZXR1cm4gKFxyXG4gICAgICAgICc8dGV4dCB4PVwiJyArXHJcbiAgICAgICAgeHggK1xyXG4gICAgICAgICdcIiB5PVwiJyArXHJcbiAgICAgICAgKEggLSBwYWRCICsgMTUpICtcclxuICAgICAgICAnXCIgdGV4dC1hbmNob3I9XCJtaWRkbGVcIiBmb250LXNpemU9XCIxMFwiIGZpbGw9XCIjNjQ3NDhiXCI+JyArXHJcbiAgICAgICAgX2ZtdERzU2hvcnQoZi5kcykgK1xyXG4gICAgICAgICc8L3RleHQ+J1xyXG4gICAgICApO1xyXG4gICAgfSlcclxuICAgIC5qb2luKCcnKTtcclxuXHJcbiAgLy8gSW50ZXJ2YWxvIGNvbmZpYW56YSAoYmFuZClcclxuICBjb25zdCBiYW5kUG9pbnRzID1cclxuICAgIGZjLm1hcCgoZiwgaSkgPT4gc2NhbGVYKGkpICsgJywnICsgc2NhbGVZKE51bWJlcihmLmhpODApIHx8IDApKS5qb2luKCcgJykgK1xyXG4gICAgJyAnICtcclxuICAgIGZjXHJcbiAgICAgIC5zbGljZSgpXHJcbiAgICAgIC5yZXZlcnNlKClcclxuICAgICAgLm1hcCgoZiwgaSkgPT4gc2NhbGVYKGZjLmxlbmd0aCAtIDEgLSBpKSArICcsJyArIHNjYWxlWShOdW1iZXIoZi5sbzgwKSB8fCAwKSlcclxuICAgICAgLmpvaW4oJyAnKTtcclxuICBjb25zdCBiYW5kID0gJzxwb2x5Z29uIHBvaW50cz1cIicgKyBiYW5kUG9pbnRzICsgJ1wiIGZpbGw9XCIjMGQ5NDg4MzNcIiBzdHJva2U9XCJub25lXCIvPic7XHJcblxyXG4gIC8vIExpbmUgZm9yZWNhc3QgKyBwdW50b3NcclxuICBjb25zdCBsaW5lUG9pbnRzID0gZmMubWFwKChmLCBpKSA9PiBzY2FsZVgoaSkgKyAnLCcgKyBzY2FsZVkoTnVtYmVyKGYueV9oYXQpIHx8IDApKS5qb2luKCcgJyk7XHJcbiAgY29uc3QgbGluZSA9XHJcbiAgICAnPHBvbHlsaW5lIHBvaW50cz1cIicgK1xyXG4gICAgbGluZVBvaW50cyArXHJcbiAgICAnXCIgZmlsbD1cIm5vbmVcIiBzdHJva2U9XCIjMGQ5NDg4XCIgc3Ryb2tlLXdpZHRoPVwiMi41XCIgc3Ryb2tlLWxpbmVqb2luPVwicm91bmRcIi8+JztcclxuICBjb25zdCBwb2ludHMgPSBmY1xyXG4gICAgLm1hcChcclxuICAgICAgKGYsIGkpID0+XHJcbiAgICAgICAgJzxjaXJjbGUgY3g9XCInICtcclxuICAgICAgICBzY2FsZVgoaSkgK1xyXG4gICAgICAgICdcIiBjeT1cIicgK1xyXG4gICAgICAgIHNjYWxlWShOdW1iZXIoZi55X2hhdCkgfHwgMCkgK1xyXG4gICAgICAgICdcIiByPVwiNFwiIGZpbGw9XCIjMGQ5NDg4XCIgc3Ryb2tlPVwiI2ZmZlwiIHN0cm9rZS13aWR0aD1cIjJcIi8+J1xyXG4gICAgKVxyXG4gICAgLmpvaW4oJycpO1xyXG4gIC8vIExhYmVscyBkZSB2YWxvclxyXG4gIGNvbnN0IHZhbHVlTGFiZWxzID0gZmNcclxuICAgIC5tYXAoKGYsIGkpID0+IHtcclxuICAgICAgY29uc3QgeHggPSBzY2FsZVgoaSk7XHJcbiAgICAgIGNvbnN0IHl5ID0gc2NhbGVZKE51bWJlcihmLnlfaGF0KSB8fCAwKTtcclxuICAgICAgcmV0dXJuIChcclxuICAgICAgICAnPHRleHQgeD1cIicgK1xyXG4gICAgICAgIHh4ICtcclxuICAgICAgICAnXCIgeT1cIicgK1xyXG4gICAgICAgICh5eSAtIDgpICtcclxuICAgICAgICAnXCIgdGV4dC1hbmNob3I9XCJtaWRkbGVcIiBmb250LXNpemU9XCIxMFwiIGZvbnQtd2VpZ2h0PVwiNzAwXCIgZmlsbD1cIiMwZjc2NmVcIj4nICtcclxuICAgICAgICBfZm10TnVtKGYueV9oYXQpICtcclxuICAgICAgICAnPC90ZXh0PidcclxuICAgICAgKTtcclxuICAgIH0pXHJcbiAgICAuam9pbignJyk7XHJcblxyXG4gIGNvbnN0IHN2ZyA9XHJcbiAgICAnPHN2ZyB2aWV3Qm94PVwiMCAwICcgK1xyXG4gICAgVyArXHJcbiAgICAnICcgK1xyXG4gICAgSCArXHJcbiAgICAnXCIgc3R5bGU9XCJ3aWR0aDoxMDAlO21heC13aWR0aDo4MDBweDtoZWlnaHQ6YXV0b1wiPicgK1xyXG4gICAgJzxyZWN0IHg9XCIwXCIgeT1cIjBcIiB3aWR0aD1cIicgK1xyXG4gICAgVyArXHJcbiAgICAnXCIgaGVpZ2h0PVwiJyArXHJcbiAgICBIICtcclxuICAgICdcIiBmaWxsPVwiI2ZmZlwiLz4nICtcclxuICAgIHlUaWNrcyArXHJcbiAgICB4TGFiZWxzICtcclxuICAgIGJhbmQgK1xyXG4gICAgbGluZSArXHJcbiAgICBwb2ludHMgK1xyXG4gICAgdmFsdWVMYWJlbHMgK1xyXG4gICAgJzwvc3ZnPic7XHJcbiAgcmV0dXJuIHN2ZztcclxufVxyXG5cclxud2luZG93Lm9wZW5Gb3JlY2FzdFN0YXREZXRhaWwgPSBmdW5jdGlvbiAoc3ViSWQpIHtcclxuICBpZiAoIV9mb3JlY2FzdFN0YXREb2NzKSByZXR1cm47XHJcbiAgY29uc3QgZG9jID0gX2ZvcmVjYXN0U3RhdERvY3MuZmluZCgoZCkgPT4gZC5pZCA9PT0gc3ViSWQpO1xyXG4gIGlmICghZG9jKSB7XHJcbiAgICBhbGVydCgnTm8gc2UgZW5jb250clx1MDBGMyBkZXRhbGxlIGRlICcgKyBzdWJJZCk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIGNvbnN0IGV4aXN0aW5nID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2ZvcmVjYXN0LXN0YXQtZGV0YWlsJyk7XHJcbiAgaWYgKGV4aXN0aW5nKSBleGlzdGluZy5yZW1vdmUoKTtcclxuXHJcbiAgY29uc3QgZWwgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKTtcclxuICBlbC5pZCA9ICdmb3JlY2FzdC1zdGF0LWRldGFpbCc7XHJcbiAgZWwuc3R5bGUuY3NzVGV4dCA9XHJcbiAgICAncG9zaXRpb246Zml4ZWQ7aW5zZXQ6MDtiYWNrZ3JvdW5kOnJnYmEoMTUsMjMsNDIsLjY1KTt6LWluZGV4OjIxMDA7ZGlzcGxheTpmbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtqdXN0aWZ5LWNvbnRlbnQ6Y2VudGVyO3BhZGRpbmc6MnZoJztcclxuICBlbC5vbmNsaWNrID0gKGV2KSA9PiB7XHJcbiAgICBpZiAoZXYudGFyZ2V0ID09PSBlbCkgZWwucmVtb3ZlKCk7XHJcbiAgfTtcclxuXHJcbiAgY29uc3Qgd2FwZSA9IGRvYy5tZXRyaWNzICYmIGRvYy5tZXRyaWNzLndhcGU7XHJcbiAgY29uc3QgYmlhcyA9IGRvYy5tZXRyaWNzICYmIGRvYy5tZXRyaWNzLmJpYXM7XHJcbiAgY29uc3QgbWFlID0gZG9jLm1ldHJpY3MgJiYgZG9jLm1ldHJpY3MubWFlO1xyXG4gIGNvbnN0IHJtc2UgPSBkb2MubWV0cmljcyAmJiBkb2MubWV0cmljcy5ybXNlO1xyXG4gIGNvbnN0IGJlc3RNb2RlbCA9IGRvYy5iZXN0TW9kZWwgfHwgJ1x1MjAxNCc7XHJcbiAgY29uc3QgdmVyc2lvbklkID0gZG9jLnZlcnNpb25JZCB8fCAnXHUyMDE0JztcclxuICBjb25zdCBzdmdIdG1sID0gX2J1aWxkRm9yZWNhc3RDaGFydFN2Zyhkb2MpO1xyXG5cclxuICBjb25zdCBtZXRyaWNzSHRtbCA9XHJcbiAgICAnPGRpdiBzdHlsZT1cImRpc3BsYXk6Z3JpZDtncmlkLXRlbXBsYXRlLWNvbHVtbnM6cmVwZWF0KGF1dG8tZml0LG1pbm1heCgxMjBweCwxZnIpKTtnYXA6MTBweDttYXJnaW46MTRweCAwXCI+JyArXHJcbiAgICAnPGRpdiBzdHlsZT1cInBhZGRpbmc6MTBweDtiYWNrZ3JvdW5kOnZhcigtLWJnLXNlY29uZGFyeSk7Ym9yZGVyLXJhZGl1czo2cHhcIj48ZGl2IHN0eWxlPVwiZm9udC1zaXplOjEwcHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlXCI+TW9kZWxvPC9kaXY+PGRpdiBzdHlsZT1cImZvbnQtd2VpZ2h0OjcwMFwiPicgK1xyXG4gICAgZXNjYXBlSHRtbFNhZmUoYmVzdE1vZGVsKSArXHJcbiAgICAnPC9kaXY+PC9kaXY+JyArXHJcbiAgICAnPGRpdiBzdHlsZT1cInBhZGRpbmc6MTBweDtiYWNrZ3JvdW5kOnZhcigtLWJnLXNlY29uZGFyeSk7Ym9yZGVyLXJhZGl1czo2cHhcIj48ZGl2IHN0eWxlPVwiZm9udC1zaXplOjEwcHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlXCI+V0FQRTwvZGl2PjxkaXYgc3R5bGU9XCJmb250LXdlaWdodDo3MDA7Y29sb3I6JyArXHJcbiAgICBfd2FwZUJhZGdlQ29sb3Iod2FwZSkgK1xyXG4gICAgJ1wiPicgK1xyXG4gICAgX2ZtdFdhcGUod2FwZSkgK1xyXG4gICAgJzwvZGl2PjwvZGl2PicgK1xyXG4gICAgJzxkaXYgc3R5bGU9XCJwYWRkaW5nOjEwcHg7YmFja2dyb3VuZDp2YXIoLS1iZy1zZWNvbmRhcnkpO2JvcmRlci1yYWRpdXM6NnB4XCI+PGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMHB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZVwiPkJpYXM8L2Rpdj48ZGl2IHN0eWxlPVwiZm9udC13ZWlnaHQ6NzAwXCI+JyArXHJcbiAgICAoYmlhcyAhPSBudWxsID8gKGJpYXMgKiAxMDApLnRvRml4ZWQoMCkgKyAnJScgOiAnXHUyMDE0JykgK1xyXG4gICAgJzwvZGl2PjwvZGl2PicgK1xyXG4gICAgJzxkaXYgc3R5bGU9XCJwYWRkaW5nOjEwcHg7YmFja2dyb3VuZDp2YXIoLS1iZy1zZWNvbmRhcnkpO2JvcmRlci1yYWRpdXM6NnB4XCI+PGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMHB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZVwiPk1BRTwvZGl2PjxkaXYgc3R5bGU9XCJmb250LXdlaWdodDo3MDBcIj4nICtcclxuICAgIF9mbXROdW0obWFlKSArXHJcbiAgICAnPC9kaXY+PC9kaXY+JyArXHJcbiAgICAnPGRpdiBzdHlsZT1cInBhZGRpbmc6MTBweDtiYWNrZ3JvdW5kOnZhcigtLWJnLXNlY29uZGFyeSk7Ym9yZGVyLXJhZGl1czo2cHhcIj48ZGl2IHN0eWxlPVwiZm9udC1zaXplOjEwcHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlXCI+Uk1TRTwvZGl2PjxkaXYgc3R5bGU9XCJmb250LXdlaWdodDo3MDBcIj4nICtcclxuICAgIF9mbXROdW0ocm1zZSkgK1xyXG4gICAgJzwvZGl2PjwvZGl2PicgK1xyXG4gICAgJzwvZGl2Pic7XHJcblxyXG4gIGNvbnN0IHRhYmxlSHRtbCA9XHJcbiAgICAnPHRhYmxlIHN0eWxlPVwid2lkdGg6MTAwJTtmb250LXNpemU6MTJweDtib3JkZXItY29sbGFwc2U6Y29sbGFwc2U7bWFyZ2luLXRvcDoxMHB4XCI+JyArXHJcbiAgICAnPHRoZWFkIHN0eWxlPVwiYmFja2dyb3VuZDojMGYxNzJhO2NvbG9yOiNmZmZcIj48dHI+JyArXHJcbiAgICAnPHRoIHN0eWxlPVwicGFkZGluZzo2cHggMTBweDt0ZXh0LWFsaWduOmxlZnRcIj5NZXM8L3RoPicgK1xyXG4gICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6NnB4IDEwcHg7dGV4dC1hbGlnbjpyaWdodFwiPkZvcmVjYXN0PC90aD4nICtcclxuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjZweCAxMHB4O3RleHQtYWxpZ246cmlnaHRcIj5JQyA4MCUgYmFqbzwvdGg+JyArXHJcbiAgICAnPHRoIHN0eWxlPVwicGFkZGluZzo2cHggMTBweDt0ZXh0LWFsaWduOnJpZ2h0XCI+SUMgODAlIGFsdG88L3RoPicgK1xyXG4gICAgJzwvdHI+PC90aGVhZD48dGJvZHk+JyArXHJcbiAgICAoZG9jLmZvcmVjYXN0IHx8IFtdKVxyXG4gICAgICAubWFwKFxyXG4gICAgICAgIChmKSA9PlxyXG4gICAgICAgICAgJzx0ciBzdHlsZT1cImJvcmRlci1ib3R0b206MXB4IHNvbGlkIHZhcigtLWJvcmRlci1zdWJ0bGUpXCI+PHRkIHN0eWxlPVwicGFkZGluZzo2cHggMTBweFwiPicgK1xyXG4gICAgICAgICAgZXNjYXBlSHRtbFNhZmUoX2ZtdERzU2hvcnQoZi5kcykpICtcclxuICAgICAgICAgICc8L3RkPicgK1xyXG4gICAgICAgICAgJzx0ZCBzdHlsZT1cInBhZGRpbmc6NnB4IDEwcHg7dGV4dC1hbGlnbjpyaWdodDtmb250LXdlaWdodDo3MDBcIj4nICtcclxuICAgICAgICAgIF9mbXROdW0oZi55X2hhdCkgK1xyXG4gICAgICAgICAgJzwvdGQ+JyArXHJcbiAgICAgICAgICAnPHRkIHN0eWxlPVwicGFkZGluZzo2cHggMTBweDt0ZXh0LWFsaWduOnJpZ2h0O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpXCI+JyArXHJcbiAgICAgICAgICBfZm10TnVtKGYubG84MCkgK1xyXG4gICAgICAgICAgJzwvdGQ+JyArXHJcbiAgICAgICAgICAnPHRkIHN0eWxlPVwicGFkZGluZzo2cHggMTBweDt0ZXh0LWFsaWduOnJpZ2h0O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpXCI+JyArXHJcbiAgICAgICAgICBfZm10TnVtKGYuaGk4MCkgK1xyXG4gICAgICAgICAgJzwvdGQ+PC90cj4nXHJcbiAgICAgIClcclxuICAgICAgLmpvaW4oJycpICtcclxuICAgICc8L3Rib2R5PjwvdGFibGU+JztcclxuXHJcbiAgY29uc3QgY29udGVudCA9XHJcbiAgICAnPGRpdiBzdHlsZT1cImJhY2tncm91bmQ6dmFyKC0tYmctZWxldmF0ZWQpO2JvcmRlci1yYWRpdXM6MTJweDtwYWRkaW5nOjI0cHg7bWF4LXdpZHRoOjgyMHB4O3dpZHRoOjEwMCU7bWF4LWhlaWdodDo5NnZoO292ZXJmbG93OmF1dG87Ym94LXNoYWRvdzowIDIwcHggNjBweCByZ2JhKDAsMCwwLC40KVwiPicgK1xyXG4gICAgJzxkaXYgc3R5bGU9XCJkaXNwbGF5OmZsZXg7anVzdGlmeS1jb250ZW50OnNwYWNlLWJldHdlZW47YWxpZ24taXRlbXM6Y2VudGVyO21hcmdpbi1ib3R0b206MTBweFwiPicgK1xyXG4gICAgJzxkaXY+PGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMXB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtsZXR0ZXItc3BhY2luZzouNHB4XCI+U3ViZmFtaWxpYTwvZGl2PjxkaXYgc3R5bGU9XCJmb250LXNpemU6MjJweDtmb250LXdlaWdodDo4MDBcIj4nICtcclxuICAgIGVzY2FwZUh0bWxTYWZlKGRvYy5zdWJmYW1pbGlhIHx8IGRvYy5pZCkgK1xyXG4gICAgJzwvZGl2PjwvZGl2PicgK1xyXG4gICAgJzxidXR0b24gb25jbGljaz1cImRvY3VtZW50LmdldEVsZW1lbnRCeUlkKFxcJ2ZvcmVjYXN0LXN0YXQtZGV0YWlsXFwnKS5yZW1vdmUoKVwiIHN0eWxlPVwiYmFja2dyb3VuZDp0cmFuc3BhcmVudDtib3JkZXI6MXB4IHNvbGlkIHZhcigtLWJvcmRlci1zdWJ0bGUpO2JvcmRlci1yYWRpdXM6NnB4O3BhZGRpbmc6NnB4IDEycHg7Y3Vyc29yOnBvaW50ZXI7Zm9udC13ZWlnaHQ6NzAwXCI+Q2VycmFyPC9idXR0b24+JyArXHJcbiAgICAnPC9kaXY+JyArXHJcbiAgICBtZXRyaWNzSHRtbCArXHJcbiAgICAnPGRpdiBzdHlsZT1cImJhY2tncm91bmQ6I2ZmZjtwYWRkaW5nOjhweDtib3JkZXItcmFkaXVzOjhweDttYXJnaW4tdG9wOjEwcHg7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1ib3JkZXItc3VidGxlKVwiPicgK1xyXG4gICAgc3ZnSHRtbCArXHJcbiAgICAnPC9kaXY+JyArXHJcbiAgICB0YWJsZUh0bWwgK1xyXG4gICAgJzxkaXYgc3R5bGU9XCJtYXJnaW4tdG9wOjE0cHg7Zm9udC1zaXplOjExcHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZClcIj5WZXJzaW9uOiA8Y29kZT4nICtcclxuICAgIGVzY2FwZUh0bWxTYWZlKHZlcnNpb25JZCkgK1xyXG4gICAgJzwvY29kZT4gXHUwMEI3IEFwcHJvYWNoOiAnICtcclxuICAgIGVzY2FwZUh0bWxTYWZlKChkb2MuY29uZmlnIHx8IHt9KS5hcHByb2FjaCB8fCAnXHUyMDE0JykgK1xyXG4gICAgJzwvZGl2PicgK1xyXG4gICAgJzwvZGl2Pic7XHJcbiAgZWwuaW5uZXJIVE1MID0gY29udGVudDtcclxuICBkb2N1bWVudC5ib2R5LmFwcGVuZENoaWxkKGVsKTtcclxufTtcclxuXHJcbndpbmRvdy5vcGVuRm9yZWNhc3RNb2RhbCA9IGFzeW5jIGZ1bmN0aW9uICgpIHtcclxuICBpZiAoIV9jYW5Gb3JlY2FzdCgpKSB7XHJcbiAgICBhbGVydCgnRk9SRUNBU1QgZXMgc29sbyBwYXJhIE1hcmlhbm8gKGFkbWluKS4nKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgY29uc3QgZWwgPSBfcmVuZGVyTW9kYWxTaGVsbCgpO1xyXG4gIGVsLnN0eWxlLmRpc3BsYXkgPSAnYmxvY2snO1xyXG4gIC8vIHYxMDk4KyBGYXNlIDE6IGNhcmdhciBTYWxlcyBQbGFucyBjYWNoZXMgKyByZW5kZXJpemFyIHRhYiBkZWZhdWx0LlxyXG4gIF9yZW5kZXJTYWxlc1BsYW5zVGFiKCk7XHJcbiAgX2xvYWRTYWxlc1BsYW5DYWNoZXMoKVxyXG4gICAgLnRoZW4oX3JlbmRlclNhbGVzUGxhbnNUYWIpXHJcbiAgICAuY2F0Y2goKCkgPT4ge30pO1xyXG4gIC8vIExlZ2FjeTogc25hcHNob3Qgc29sbyBzZSBjYXJnYSBsYXp5IHNpIGVsIHVzZXIgY2FtYmlhIGEgdGFiIExlZ2FjeS5cclxuICBpZiAoX2ZvcmVjYXN0TG9hZGluZykgcmV0dXJuO1xyXG4gIGlmICghX2ZvcmVjYXN0U25hcHNob3QpIHtcclxuICAgIF9mb3JlY2FzdExvYWRpbmcgPSB0cnVlO1xyXG4gICAgY29uc3Qgc3RhdHMgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZm9yZWNhc3Qtc3RhdHMnKTtcclxuICAgIGlmIChzdGF0cykgc3RhdHMudGV4dENvbnRlbnQgPSAnQ2FyZ2FuZG8gc25hcHNob3QgZGUgdmVudGFzLi4uJztcclxuICAgIHRyeSB7XHJcbiAgICAgIGF3YWl0IF9sb2FkU25hcHNob3QoKTtcclxuICAgICAgaWYgKHN0YXRzKSBzdGF0cy50ZXh0Q29udGVudCA9IF9mb3JlY2FzdFNuYXBzaG90LmNvdW50ICsgJyBTS1VzIGVuIHNuYXBzaG90IGhpc3Rvcmljbyc7XHJcbiAgICB9IGNhdGNoIChlKSB7XHJcbiAgICAgIGlmIChzdGF0cykgc3RhdHMudGV4dENvbnRlbnQgPSAnRXJyb3IgY2FyZ2FuZG8gc25hcHNob3Q6ICcgKyAoKGUgJiYgZS5tZXNzYWdlKSB8fCBlKTtcclxuICAgICAgLy8gTm8gYWxlcnQgXHUyMDE0IGxlZ2FjeSBlcyBvcHQtaW4sIG5vIGJsb3F1ZWEgYWwgdXN1YXJpbyBzaSBzb2xvIHZhIGEgc3ViaXIgU2FsZXMgUGxhbnMuXHJcbiAgICAgIGNvbnNvbGUud2FybignW0ZPUkVDQVNUXSBzbmFwc2hvdCBsb2FkIGZhaWwgKGxlZ2FjeSB0YWIpJywgZSk7XHJcbiAgICB9IGZpbmFsbHkge1xyXG4gICAgICBfZm9yZWNhc3RMb2FkaW5nID0gZmFsc2U7XHJcbiAgICB9XHJcbiAgfSBlbHNlIHtcclxuICAgIGNvbnN0IHN0YXRzID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2ZvcmVjYXN0LXN0YXRzJyk7XHJcbiAgICBpZiAoc3RhdHMpIHN0YXRzLnRleHRDb250ZW50ID0gX2ZvcmVjYXN0U25hcHNob3QuY291bnQgKyAnIFNLVXMgZW4gc25hcHNob3QgaGlzdG9yaWNvJztcclxuICB9XHJcbn07XHJcblxyXG53aW5kb3cuY2xvc2VGb3JlY2FzdE1vZGFsID0gZnVuY3Rpb24gKCkge1xyXG4gIGNvbnN0IGVsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2ZvcmVjYXN0LW1vZGFsJyk7XHJcbiAgaWYgKGVsKSBlbC5zdHlsZS5kaXNwbGF5ID0gJ25vbmUnO1xyXG59O1xyXG5cclxud2luZG93Lm9uRm9yZWNhc3RTYWxlc1BsYW5GaWxlID0gYXN5bmMgZnVuY3Rpb24gKGV2ZW50KSB7XHJcbiAgY29uc3QgZmlsZSA9IGV2ZW50ICYmIGV2ZW50LnRhcmdldCAmJiBldmVudC50YXJnZXQuZmlsZXMgJiYgZXZlbnQudGFyZ2V0LmZpbGVzWzBdO1xyXG4gIGlmICghZmlsZSkgcmV0dXJuO1xyXG4gIHRyeSB7XHJcbiAgICBpZiAoIV9mb3JlY2FzdFNuYXBzaG90KSBhd2FpdCBfbG9hZFNuYXBzaG90KCk7XHJcbiAgICBjb25zdCBidWYgPSBhd2FpdCBmaWxlLmFycmF5QnVmZmVyKCk7XHJcbiAgICBpZiAodHlwZW9mIFhMU1ggPT09ICd1bmRlZmluZWQnKSB7XHJcbiAgICAgIGFsZXJ0KCdYTFNYIG5vIGNhcmdhZG8nKTtcclxuICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG4gICAgY29uc3Qgd2IgPSBYTFNYLnJlYWQoYnVmLCB7IHR5cGU6ICdhcnJheScgfSk7XHJcbiAgICBjb25zdCBzaGVldCA9IHdiLlNoZWV0c1t3Yi5TaGVldE5hbWVzWzBdXTtcclxuICAgIGNvbnN0IHJvd3MgPSBYTFNYLnV0aWxzLnNoZWV0X3RvX2pzb24oc2hlZXQsIHsgaGVhZGVyOiAxLCBkZWZ2YWw6IG51bGwsIHJhdzogdHJ1ZSB9KTtcclxuICAgIGNvbnN0IHBhcnNlZCA9IF9wYXJzZVNhbGVzUGxhblJvd3Mocm93cyk7XHJcbiAgICBpZiAoIXBhcnNlZC5sZW5ndGgpIHtcclxuICAgICAgYWxlcnQoJ0VsIEV4Y2VsIGVzdGEgdmFjaW8gbyBubyB0aWVuZSBmaWxhcyB2YWxpZGFzLicpO1xyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcbiAgICBfZm9yZWNhc3RTYWxlc1BsYW4gPSBwYXJzZWQ7XHJcbiAgICBjb25zdCBob3kgPSBuZXcgRGF0ZSgpO1xyXG4gICAgX2ZvcmVjYXN0Um93cyA9IF9jb21wdXRlRm9yZWNhc3RSb3dzKF9mb3JlY2FzdFNuYXBzaG90LCBwYXJzZWQsIGhveSk7XHJcbiAgICBfcmVuZGVyVGFibGUoX2ZvcmVjYXN0Um93cyk7XHJcbiAgICBjb25zdCBzaW5NYXRjaCA9IF9mb3JlY2FzdFJvd3MuZmlsdGVyKChyKSA9PiAhci5oYXNIaXN0b3JpYSkubGVuZ3RoO1xyXG4gICAgY29uc3Qgc3RhdHMgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZm9yZWNhc3Qtc3RhdHMnKTtcclxuICAgIGlmIChzdGF0cykge1xyXG4gICAgICBzdGF0cy50ZXh0Q29udGVudCA9XHJcbiAgICAgICAgcGFyc2VkLmxlbmd0aCArXHJcbiAgICAgICAgJyBTS1VzIGVuIFNhbGVzIFBsYW4gXHUwMEI3ICcgK1xyXG4gICAgICAgIChwYXJzZWQubGVuZ3RoIC0gc2luTWF0Y2gpICtcclxuICAgICAgICAnIGNvbiBoaXN0b3JpYSBcdTAwQjcgJyArXHJcbiAgICAgICAgc2luTWF0Y2ggK1xyXG4gICAgICAgICcgc2luIG1hdGNoIChmb25kbyBhbWFyaWxsbyknO1xyXG4gICAgfVxyXG4gICAgY29uc3QgYnRuID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2ZvcmVjYXN0LWV4cG9ydC1idG4nKTtcclxuICAgIGlmIChidG4pIHtcclxuICAgICAgYnRuLmRpc2FibGVkID0gZmFsc2U7XHJcbiAgICAgIGJ0bi5zdHlsZS5vcGFjaXR5ID0gJzEnO1xyXG4gICAgfVxyXG4gIH0gY2F0Y2ggKGUpIHtcclxuICAgIGNvbnNvbGUuZXJyb3IoJ1tGT1JFQ0FTVF0gcGFyc2UgZXJyb3I6JywgZSk7XHJcbiAgICBhbGVydCgnRXJyb3IgcHJvY2VzYW5kbyBlbCBFeGNlbDpcXG4nICsgKChlICYmIGUubWVzc2FnZSkgfHwgZSkpO1xyXG4gIH0gZmluYWxseSB7XHJcbiAgICAvLyBSZXNldCBpbnB1dCBwYXJhIHF1ZSBlbCBtaXNtbyBhcmNoaXZvIHNlIHB1ZWRhIHJlLXN1YmlyXHJcbiAgICBpZiAoZXZlbnQgJiYgZXZlbnQudGFyZ2V0KSBldmVudC50YXJnZXQudmFsdWUgPSAnJztcclxuICB9XHJcbn07XHJcblxyXG53aW5kb3cuZXhwb3J0Rm9yZWNhc3RFeGNlbCA9IGZ1bmN0aW9uICgpIHtcclxuICBpZiAoIV9mb3JlY2FzdFJvd3MgfHwgIV9mb3JlY2FzdFJvd3MubGVuZ3RoKSB7XHJcbiAgICBhbGVydCgnTm8gaGF5IGRhdG9zIHBhcmEgZXhwb3J0YXIuIENhcmdhIHByaW1lcm8gZWwgU2FsZXMgUGxhbi4nKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgaWYgKHR5cGVvZiBYTFNYID09PSAndW5kZWZpbmVkJykge1xyXG4gICAgYWxlcnQoJ1hMU1ggbm8gY2FyZ2FkbycpO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuICBjb25zdCByb3VuZDEgPSAobikgPT4gTWF0aC5yb3VuZChOdW1iZXIobiB8fCAwKSAqIDEwKSAvIDEwO1xyXG4gIGNvbnN0IGFvYSA9IFtcclxuICAgIFtcclxuICAgICAgJ1NLVScsXHJcbiAgICAgICdGQU1JTElBJyxcclxuICAgICAgJ1NVQkZBTUlMSUEnLFxyXG4gICAgICAnVkVOVEFTICgxMm0pJyxcclxuICAgICAgJ1BFRElETy1TQUxFUyBQTEFOUyAoNm0pJyxcclxuICAgICAgJ1BST01FRElPIERFIElOVkVOVEFSSU8nLFxyXG4gICAgICAnUE9MSVRJQ0EgREUgSU5WRU5UQVJJTyAoM20pJyxcclxuICAgICAgJ1RPVEFMJyxcclxuICAgIF0sXHJcbiAgXTtcclxuICBmb3IgKGNvbnN0IHIgb2YgX2ZvcmVjYXN0Um93cykge1xyXG4gICAgYW9hLnB1c2goW1xyXG4gICAgICByLnNrdSxcclxuICAgICAgci5mYW1pbGlhLFxyXG4gICAgICByLnN1YmZhbWlsaWEsXHJcbiAgICAgIHJvdW5kMShyLnZlbnRhczEybSksXHJcbiAgICAgIHJvdW5kMShyLnBlZGlkbzZtKSxcclxuICAgICAgcm91bmQxKHIucHJvbWVkaW8pLFxyXG4gICAgICByb3VuZDEoci5wb2xpdGljYSksXHJcbiAgICAgIHJvdW5kMShyLnRvdGFsKSxcclxuICAgIF0pO1xyXG4gIH1cclxuICBjb25zdCB3cyA9IFhMU1gudXRpbHMuYW9hX3RvX3NoZWV0KGFvYSk7XHJcbiAgLy8gQW5jaG9zIGRlIGNvbHVtbmFcclxuICB3c1snIWNvbHMnXSA9IFtcclxuICAgIHsgd2NoOiAxOCB9LFxyXG4gICAgeyB3Y2g6IDI0IH0sXHJcbiAgICB7IHdjaDogMjQgfSxcclxuICAgIHsgd2NoOiAxNCB9LFxyXG4gICAgeyB3Y2g6IDIwIH0sXHJcbiAgICB7IHdjaDogMjAgfSxcclxuICAgIHsgd2NoOiAyMiB9LFxyXG4gICAgeyB3Y2g6IDEyIH0sXHJcbiAgXTtcclxuICBjb25zdCB3YiA9IFhMU1gudXRpbHMuYm9va19uZXcoKTtcclxuICBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KHdiLCB3cywgJ0ZPUkVDQVNUJyk7XHJcbiAgY29uc3QgaG95ID0gbmV3IERhdGUoKTtcclxuICBjb25zdCBzdGFtcCA9XHJcbiAgICBob3kuZ2V0RnVsbFllYXIoKSArXHJcbiAgICAnLScgK1xyXG4gICAgU3RyaW5nKGhveS5nZXRNb250aCgpICsgMSkucGFkU3RhcnQoMiwgJzAnKSArXHJcbiAgICAnLScgK1xyXG4gICAgU3RyaW5nKGhveS5nZXREYXRlKCkpLnBhZFN0YXJ0KDIsICcwJyk7XHJcbiAgWExTWC53cml0ZUZpbGUod2IsICdGb3JlY2FzdF9TaGltYW5vXycgKyBzdGFtcCArICcueGxzeCcpO1xyXG59O1xyXG5cclxuLy8gUmVmcmVzaCBwdWJsaWNvIChwb3Igc2kgZWwgdXNlciBuZWNlc2l0YSByZS1mZXRjaGVhciBlbCBzbmFwc2hvdCBzaW4gY2VycmFyXHJcbi8vIGVsIG1vZGFsLCBlajogcGFzYXJvbiAzMCBtaW4geSBlbCBjcm9uIEJRIGFjdHVhbGl6byBsYSBjb2xlY2Npb24pLlxyXG53aW5kb3cucmVsb2FkRm9yZWNhc3RTbmFwc2hvdCA9IGFzeW5jIGZ1bmN0aW9uICgpIHtcclxuICBfZm9yZWNhc3RTbmFwc2hvdCA9IG51bGw7XHJcbiAgYXdhaXQgX2xvYWRTbmFwc2hvdCgpO1xyXG4gIGlmIChfZm9yZWNhc3RTYWxlc1BsYW4pIHtcclxuICAgIGNvbnN0IGhveSA9IG5ldyBEYXRlKCk7XHJcbiAgICBfZm9yZWNhc3RSb3dzID0gX2NvbXB1dGVGb3JlY2FzdFJvd3MoX2ZvcmVjYXN0U25hcHNob3QsIF9mb3JlY2FzdFNhbGVzUGxhbiwgaG95KTtcclxuICAgIF9yZW5kZXJUYWJsZShfZm9yZWNhc3RSb3dzKTtcclxuICB9XHJcbn07XHJcbiJdLAogICJtYXBwaW5ncyI6ICI7OztBQVlBLE1BQU0sZ0JBQWdCO0FBQUEsSUFDcEIsS0FBSztBQUFBLElBQ0wsU0FBUztBQUFBLElBQ1QsS0FBSztBQUFBLElBQ0wsT0FBTztBQUFBLElBQ1AsS0FBSztBQUFBLElBQ0wsVUFBVTtBQUFBLElBQ1YsU0FBUztBQUFBLElBQ1QsS0FBSztBQUFBLElBQ0wsT0FBTztBQUFBLElBQ1AsT0FBTztBQUFBLElBQ1AsS0FBSztBQUFBLElBQ0wsT0FBTztBQUFBLElBQ1AsS0FBSztBQUFBLElBQ0wsT0FBTztBQUFBLElBQ1AsS0FBSztBQUFBLElBQ0wsTUFBTTtBQUFBLElBQ04sS0FBSztBQUFBLElBQ0wsTUFBTTtBQUFBLElBQ04sT0FBTztBQUFBLElBQ1AsS0FBSztBQUFBLElBQ0wsTUFBTTtBQUFBLElBQ04sT0FBTztBQUFBLElBQ1AsS0FBSztBQUFBLElBQ0wsUUFBUTtBQUFBLElBQ1IsS0FBSztBQUFBLElBQ0wsUUFBUTtBQUFBLElBQ1IsS0FBSztBQUFBLElBQ0wsTUFBTTtBQUFBLElBQ04sV0FBVztBQUFBLElBQ1gsWUFBWTtBQUFBLElBQ1osS0FBSztBQUFBLElBQ0wsU0FBUztBQUFBLElBQ1QsU0FBUztBQUFBLElBQ1QsS0FBSztBQUFBLElBQ0wsVUFBVTtBQUFBLElBQ1YsV0FBVztBQUFBLElB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
