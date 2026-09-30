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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL3B1cmUvc2FsZXMtcGxhbi1wYXJzZXIuanMiLCAiLi4vc3JjL2RvbWFpbnMvZm9yZWNhc3QuanMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbIi8vIEB0cy1ub2NoZWNrXG4vLyBQdXJlOiBwYXJzZWEgdW4gc2hlZXQgU2FsZXMgUGxhbiAoZm9ybWF0byBTVVIvU0FSIGRlIFNoaW1hbm8pIGEgZXN0cnVjdHVyYVxuLy8gbm9ybWFsaXphZGEgeyBza3UsIGRlc2NyaXB0aW9uLCBtb3EsIG1vbnRoczogeydZWVlZLU1NJzogTn0gfS5cbi8vIFNpbiBkZXBlbmRlbmNpYXMgXHUyMDE0IHJlY2liZSBlbCBzaGVldCB5YSBkZXNlcmlhbGl6YWRvIHBvciBTaGVldEpTXG4vLyAoWExTWC51dGlscy5zaGVldF90b19qc29uKHNoZWV0LCB7aGVhZGVyOjEsIGRlZnZhbDonJ30pKS5cbi8vIFRlc3RlYWJsZSBlbiB2aXRlc3Qgc2luIGNhcmdhciBYTFNYLlxuLy9cbi8vIENvbnRleHRvOiBsb3MgU2FsZXMgUGxhbnMgZGUgU2hpbWFubyB2aWVuZW4gY29uIGhlYWRlcnMgY29tb1xuLy8gXCJTS1UgQ29kZS9QYXJ0IE5vXCIsIFwiRGVzY3JpcHRpb25cIiwgXCJNT1EgMTIgbW9udGhzXCIgeSBjb2x1bW5hcyBkZSBtZXNlc1xuLy8gdGlwbyBcIkphbiAyMDI3XCIsIFwiTWF5IDIwMjdcIiAoYSB2ZWNlcyBjb24gYVx1MDBGMW8gZW4gdW5hIGZpbGEgYXJyaWJhIHkgZWwgbWVzXG4vLyBlbiBsYSBmaWxhIGhlYWRlcikuIEVzdGEgZm4gdG9sZXJhIGFtYm9zIGxheW91dHMuXG5cbmNvbnN0IE1PTlRIX0FMSUFTRVMgPSB7XG4gIGphbjogMSxcbiAgamFudWFyeTogMSxcbiAgZW5lOiAxLFxuICBlbmVybzogMSxcbiAgZmViOiAyLFxuICBmZWJydWFyeTogMixcbiAgZmVicmVybzogMixcbiAgbWFyOiAzLFxuICBtYXJjaDogMyxcbiAgbWFyem86IDMsXG4gIGFwcjogNCxcbiAgYXByaWw6IDQsXG4gIGFicjogNCxcbiAgYWJyaWw6IDQsXG4gIG1heTogNSxcbiAgbWF5bzogNSxcbiAganVuOiA2LFxuICBqdW5lOiA2LFxuICBqdW5pbzogNixcbiAganVsOiA3LFxuICBqdWx5OiA3LFxuICBqdWxpbzogNyxcbiAgYXVnOiA4LFxuICBhdWd1c3Q6IDgsXG4gIGFnbzogOCxcbiAgYWdvc3RvOiA4LFxuICBzZXA6IDksXG4gIHNlcHQ6IDksXG4gIHNlcHRlbWJlcjogOSxcbiAgc2VwdGllbWJyZTogOSxcbiAgb2N0OiAxMCxcbiAgb2N0b2JlcjogMTAsXG4gIG9jdHVicmU6IDEwLFxuICBub3Y6IDExLFxuICBub3ZlbWJlcjogMTEsXG4gIG5vdmllbWJyZTogMTEsXG4gIGRlYzogMTIsXG4gIGRlY2VtYmVyOiAxMixcbiAgZGljOiAxMixcbiAgZGljaWVtYnJlOiAxMixcbn07XG5cbi8vIE5vcm1hbGl6YSBsYWJlbHMgZGUgbWVzZXMgYSAnWVlZWS1NTScuIFJldG9ybmEgbnVsbCBzaSBubyBtYXRjaGVhLlxuLy8gRm9ybWF0b3Mgc29wb3J0YWRvczogXCJKYW4gMjAyN1wiLCBcIkVuZS0yN1wiLCBcIkphbi8yMDI3XCIsIFwiTWF5MjdcIixcbi8vIFwiMjAyNy0wMVwiLCBcIjAxLzIwMjdcIiwgXCJKYW4uMjAyN1wiLCBcIjIwMjFcXG5KYW5cIiAobXVsdGktbGluZSBFeGNlbCkuXG5mdW5jdGlvbiBub3JtYWxpemVNb250aExhYmVsKGxhYmVsKSB7XG4gIGlmIChsYWJlbCA9PSBudWxsKSByZXR1cm4gbnVsbDtcbiAgLy8gdjExMDQ6IGNvbGFwc2FyIG5ld2xpbmVzL3RhYnMgYSBlc3BhY2lvIGFudGVzIGRlbCB0cmltLlxuICAvLyBFbCBmb3JtYXRvIEV4Y2VsIFwiMjAyMVxcbkphblwiIChhXHUwMEYxbyBlbiBMMSwgbWVzIGVuIEwyIGRlbnRybyBkZSB1bmEgY2VsZGFcbiAgLy8gbXVsdGktcm93KSBlcyBjb21cdTAwRkFuIGVuIFNhbGVzIFBsYW5zIFNVUi4gYFxccytgIG1hdGNoZWEgd2hpdGVzcGFjZSBpbmNsdXllbmRvXG4gIC8vIFxcbiB5IFxcclxcbi5cbiAgY29uc3QgcyA9IFN0cmluZyhsYWJlbCkucmVwbGFjZSgvXFxzKy9nLCAnICcpLnRyaW0oKS50b0xvd2VyQ2FzZSgpO1xuICBpZiAoIXMpIHJldHVybiBudWxsO1xuICBsZXQgbTtcbiAgLy8gXCJqYW4gMjAyN1wiIHwgXCJqYW4tMjdcIiB8IFwiZW5lLzIwMjdcIiB8IFwibWF5MjdcIiB8IFwibWF5LjIwMjdcIlxuICBtID0gcy5tYXRjaCgvXihbYS16XHUwMEUxXHUwMEU5XHUwMEVEXHUwMEYzXHUwMEZBXXszLDEwfSlbXFxzXFwtLy5fXSooXFxkezIsNH0pJC8pO1xuICBpZiAobSkge1xuICAgIGNvbnN0IG1vbiA9IE1PTlRIX0FMSUFTRVNbbVsxXV0gfHwgTU9OVEhfQUxJQVNFU1ttWzFdLnNsaWNlKDAsIDMpXTtcbiAgICBpZiAobW9uKSB7XG4gICAgICBsZXQgeSA9IHBhcnNlSW50KG1bMl0sIDEwKTtcbiAgICAgIGlmICh5IDwgMTAwKSB5ID0gMjAwMCArIHk7XG4gICAgICByZXR1cm4gU3RyaW5nKHkpLnBhZFN0YXJ0KDQsICcwJykgKyAnLScgKyBTdHJpbmcobW9uKS5wYWRTdGFydCgyLCAnMCcpO1xuICAgIH1cbiAgfVxuICAvLyBcIjIwMjEgamFuXCIgfCBcIjIwMjcgZGljXCIgKGFcdTAwRjFvIHByaW1lcm8gKyBtZXMsIGZvcm1hdG8gRXhjZWwgbXVsdGktbGluZVxuICAvLyBjb2xhcHNhZG8gdHJhcyByZXBsYWNlIFxccyspLlxuICBtID0gcy5tYXRjaCgvXihcXGR7NH0pW1xcc1xcLS8uX10rKFthLXpcdTAwRTFcdTAwRTlcdTAwRURcdTAwRjNcdTAwRkFdezMsMTB9KSQvKTtcbiAgaWYgKG0pIHtcbiAgICBjb25zdCB5ID0gcGFyc2VJbnQobVsxXSwgMTApO1xuICAgIGNvbnN0IG1vbiA9IE1PTlRIX0FMSUFTRVNbbVsyXV0gfHwgTU9OVEhfQUxJQVNFU1ttWzJdLnNsaWNlKDAsIDMpXTtcbiAgICBpZiAobW9uKSByZXR1cm4gU3RyaW5nKHkpLnBhZFN0YXJ0KDQsICcwJykgKyAnLScgKyBTdHJpbmcobW9uKS5wYWRTdGFydCgyLCAnMCcpO1xuICB9XG4gIC8vIFwiMjAyNy0wMVwiIHwgXCIyMDI3LzAxXCJcbiAgbSA9IHMubWF0Y2goL14oXFxkezR9KVstL10oXFxkezEsMn0pJC8pO1xuICBpZiAobSkge1xuICAgIGNvbnN0IHkgPSBwYXJzZUludChtWzFdLCAxMCk7XG4gICAgY29uc3QgbW9uID0gcGFyc2VJbnQobVsyXSwgMTApO1xuICAgIGlmIChtb24gPj0gMSAmJiBtb24gPD0gMTIpXG4gICAgICByZXR1cm4gU3RyaW5nKHkpLnBhZFN0YXJ0KDQsICcwJykgKyAnLScgKyBTdHJpbmcobW9uKS5wYWRTdGFydCgyLCAnMCcpO1xuICB9XG4gIC8vIFwiMDEvMjAyN1wiIHwgXCIwMS0yMDI3XCJcbiAgbSA9IHMubWF0Y2goL14oXFxkezEsMn0pWy0vXShcXGR7NH0pJC8pO1xuICBpZiAobSkge1xuICAgIGNvbnN0IG1vbiA9IHBhcnNlSW50KG1bMV0sIDEwKTtcbiAgICBjb25zdCB5ID0gcGFyc2VJbnQobVsyXSwgMTApO1xuICAgIGlmIChtb24gPj0gMSAmJiBtb24gPD0gMTIpXG4gICAgICByZXR1cm4gU3RyaW5nKHkpLnBhZFN0YXJ0KDQsICcwJykgKyAnLScgKyBTdHJpbmcobW9uKS5wYWRTdGFydCgyLCAnMCcpO1xuICB9XG4gIHJldHVybiBudWxsO1xufVxuXG4vLyBCdXNjYSBsYSBmaWxhIGhlYWRlciAoMC1iYXNlZCkuIEVzY2FuZWEgbGFzIHByaW1lcmFzIDMwIGZpbGFzLlxuZnVuY3Rpb24gZmluZEhlYWRlclJvdyhyb3dzKSB7XG4gIGNvbnN0IEhFQURFUl9NQVJLRVJTID0gW1xuICAgICdza3UgY29kZS9wYXJ0IG5vJyxcbiAgICAnc2t1IGNvZGUnLFxuICAgICdza3UnLFxuICAgICdwYXJ0IG5vJyxcbiAgICAncGFydCBudW1iZXInLFxuICAgICdpdGVtY29kZScsXG4gICAgJ2l0ZW0gY29kZScsXG4gICAgJ2NvZGlnbycsXG4gICAgJ2NcdTAwRjNkaWdvJyxcbiAgXTtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBNYXRoLm1pbihyb3dzLmxlbmd0aCwgMzApOyBpKyspIHtcbiAgICBjb25zdCByb3cgPSByb3dzW2ldIHx8IFtdO1xuICAgIGZvciAoY29uc3QgY2VsbCBvZiByb3cpIHtcbiAgICAgIC8vIHYxMTA0OiBjb2xhcHNhciBuZXdsaW5lcyBhIGVzcGFjaW8gcGFyYSBtYXRjaGVhciBoZWFkZXJzIGNvbW9cbiAgICAgIC8vIFwiU0tVIENvZGUvUGFydCBOb1wiIChvaykgbyBcIlNLVVxcbkNvZGVcIiAobmVjZXNpdGEgY29sYXBzYXIpLlxuICAgICAgY29uc3QgcyA9IFN0cmluZyhjZWxsID09IG51bGwgPyAnJyA6IGNlbGwpXG4gICAgICAgIC5yZXBsYWNlKC9cXHMrL2csICcgJylcbiAgICAgICAgLnRyaW0oKVxuICAgICAgICAudG9Mb3dlckNhc2UoKTtcbiAgICAgIGlmIChIRUFERVJfTUFSS0VSUy5pbmRleE9mKHMpID49IDApIHJldHVybiBpO1xuICAgIH1cbiAgfVxuICByZXR1cm4gLTE7XG59XG5cbi8vIERldGVjdGEgXHUwMEVEbmRpY2VzIGRlIGNvbHVtbmFzIHkgbWVzZXMuIGBoaW50Um93QWJvdmVgIHBlcm1pdGUgY29tYmluYXIgYVx1MDBGMW8vbWVzXG4vLyBjdWFuZG8gZWwgaGVhZGVyIGVzIG11bHRpLXJvdyAoYVx1MDBGMW8gYXJyaWJhLCBtZXMgYWJham8gbyB2aWNldmVyc2EpLlxuZnVuY3Rpb24gZGV0ZWN0Q29sdW1ucyhoZWFkZXJSb3csIGhpbnRSb3dBYm92ZSkge1xuICBsZXQgc2t1SWR4ID0gLTE7XG4gIGxldCBkZXNjSWR4ID0gLTE7XG4gIGxldCBtb3FJZHggPSAtMTtcbiAgY29uc3QgbW9udGhDb2x1bW5zID0gW107XG4gIGNvbnN0IGRldGVjdGVkTW9udGhzU2V0ID0gbmV3IFNldCgpO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IGhlYWRlclJvdy5sZW5ndGg7IGkrKykge1xuICAgIC8vIHYxMTA0OiBjb2xhcHNhciBuZXdsaW5lcyBhIGVzcGFjaW8gYW50ZXMgZGUgY29tcGFyYXIuIExvcyBTYWxlcyBQbGFuXG4gICAgLy8gU1VSIHRpZW5lbiBoZWFkZXJzIG11bHRpLWxpbmUgY29tbyBcIk1PUVxcbjEyIG1vbnRoc1wiIG8gXCJCYXNlXFxuRk9CKFVTRClcIi5cbiAgICBjb25zdCByYXcgPSBTdHJpbmcoaGVhZGVyUm93W2ldID09IG51bGwgPyAnJyA6IGhlYWRlclJvd1tpXSlcbiAgICAgIC5yZXBsYWNlKC9cXHMrL2csICcgJylcbiAgICAgIC50cmltKCk7XG4gICAgY29uc3QgcyA9IHJhdy50b0xvd2VyQ2FzZSgpO1xuICAgIGlmIChcbiAgICAgIHNrdUlkeCA8IDAgJiZcbiAgICAgIChzID09PSAnc2t1IGNvZGUvcGFydCBubycgfHxcbiAgICAgICAgcyA9PT0gJ3NrdSBjb2RlJyB8fFxuICAgICAgICBzID09PSAnc2t1JyB8fFxuICAgICAgICBzID09PSAncGFydCBubycgfHxcbiAgICAgICAgcyA9PT0gJ3BhcnQgbnVtYmVyJyB8fFxuICAgICAgICBzID09PSAnaXRlbWNvZGUnIHx8XG4gICAgICAgIHMgPT09ICdpdGVtIGNvZGUnIHx8XG4gICAgICAgIHMgPT09ICdjb2RpZ28nIHx8XG4gICAgICAgIHMgPT09ICdjXHUwMEYzZGlnbycpXG4gICAgKSB7XG4gICAgICBza3VJZHggPSBpO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChcbiAgICAgIGRlc2NJZHggPCAwICYmXG4gICAgICAocyA9PT0gJ2Rlc2NyaXB0aW9uJyB8fFxuICAgICAgICBzID09PSAnZGVzY3JpcGNpb24nIHx8XG4gICAgICAgIHMgPT09ICdkZXNjcmlwY2lcdTAwRjNuJyB8fFxuICAgICAgICBzID09PSAnaXRlbSBuYW1lJyB8fFxuICAgICAgICBzID09PSAnaXRlbW5hbWUnKVxuICAgICkge1xuICAgICAgZGVzY0lkeCA9IGk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKG1vcUlkeCA8IDAgJiYgKHMgPT09ICdtb3EgMTIgbW9udGhzJyB8fCBzID09PSAnbW9xJyB8fCBzLmluZGV4T2YoJ21vcScpID09PSAwKSkge1xuICAgICAgbW9xSWR4ID0gaTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICAvLyBUcnkgZGlyZWN0IG1vbnRoIHBhcnNlXG4gICAgbGV0IG1vbnRoS2V5ID0gbm9ybWFsaXplTW9udGhMYWJlbChyYXcpO1xuICAgIGlmICghbW9udGhLZXkgJiYgaGludFJvd0Fib3ZlICYmIGhpbnRSb3dBYm92ZVtpXSAhPSBudWxsKSB7XG4gICAgICBjb25zdCBoaW50ID0gU3RyaW5nKGhpbnRSb3dBYm92ZVtpXSkudHJpbSgpO1xuICAgICAgaWYgKGhpbnQpIHtcbiAgICAgICAgbW9udGhLZXkgPSBub3JtYWxpemVNb250aExhYmVsKHJhdyArICcgJyArIGhpbnQpIHx8IG5vcm1hbGl6ZU1vbnRoTGFiZWwoaGludCArICcgJyArIHJhdyk7XG4gICAgICB9XG4gICAgfVxuICAgIGlmIChtb250aEtleSkge1xuICAgICAgbW9udGhDb2x1bW5zLnB1c2goeyBjb2xJZHg6IGksIG1vbnRoS2V5IH0pO1xuICAgICAgZGV0ZWN0ZWRNb250aHNTZXQuYWRkKG1vbnRoS2V5KTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHtcbiAgICBza3VJZHgsXG4gICAgZGVzY0lkeCxcbiAgICBtb3FJZHgsXG4gICAgbW9udGhDb2x1bW5zLFxuICAgIGRldGVjdGVkTW9udGhzOiBBcnJheS5mcm9tKGRldGVjdGVkTW9udGhzU2V0KS5zb3J0KCksXG4gIH07XG59XG5cbi8vIFB1YmxpYzogcGFyc2UgZnVsbCBzaGVldC4gVGhyb3dzIG9uIG1pc3NpbmcgU0tVIGNvbHVtbiAvIG1vbnRocy5cbmZ1bmN0aW9uIHBhcnNlU2FsZXNQbGFuU2hlZXQocm93cykge1xuICBpZiAoIXJvd3MgfHwgIXJvd3MubGVuZ3RoKSB7XG4gICAgY29uc3QgZXJyID0gbmV3IEVycm9yKCdFeGNlbCB2YWNpbycpO1xuICAgIGVyci5jb2RlID0gJ0VNUFRZX1NIRUVUJztcbiAgICB0aHJvdyBlcnI7XG4gIH1cbiAgY29uc3QgaGVhZGVySWR4ID0gZmluZEhlYWRlclJvdyhyb3dzKTtcbiAgaWYgKGhlYWRlcklkeCA8IDApIHtcbiAgICBjb25zdCBlcnIgPSBuZXcgRXJyb3IoJ05vIHNlIGVuY29udHJvIGZpbGEgZGUgaGVhZGVycyAoYnVzY2FiYSBcIlNLVSBDb2RlL1BhcnQgTm9cIiBvIFwiU0tVXCIpJyk7XG4gICAgZXJyLmNvZGUgPSAnSEVBREVSX05PVF9GT1VORCc7XG4gICAgdGhyb3cgZXJyO1xuICB9XG4gIGNvbnN0IGhlYWRlclJvdyA9IHJvd3NbaGVhZGVySWR4XSB8fCBbXTtcbiAgY29uc3Qgcm93QWJvdmUgPSBoZWFkZXJJZHggPiAwID8gcm93c1toZWFkZXJJZHggLSAxXSB8fCBbXSA6IG51bGw7XG4gIGNvbnN0IGNvbHMgPSBkZXRlY3RDb2x1bW5zKGhlYWRlclJvdywgcm93QWJvdmUpO1xuICBpZiAoY29scy5za3VJZHggPCAwKSB7XG4gICAgY29uc3QgZXJyID0gbmV3IEVycm9yKCdObyBzZSBlbmNvbnRybyBjb2x1bW5hIFNLVSBlbiBsYSBmaWxhIGhlYWRlcicpO1xuICAgIGVyci5jb2RlID0gJ1NLVV9DT0xfTUlTU0lORyc7XG4gICAgdGhyb3cgZXJyO1xuICB9XG4gIGlmICghY29scy5tb250aENvbHVtbnMubGVuZ3RoKSB7XG4gICAgY29uc3QgZXJyID0gbmV3IEVycm9yKFxuICAgICAgJ05vIHNlIGRldGVjdGFyb24gY29sdW1uYXMgZGUgbWVzZXMgZW4gZWwgaGVhZGVyIChlajogXCJKYW4gMjAyN1wiLCBcIk1heSAyMDI3XCIpJ1xuICAgICk7XG4gICAgZXJyLmNvZGUgPSAnTU9OVEhTX05PVF9GT1VORCc7XG4gICAgdGhyb3cgZXJyO1xuICB9XG4gIGNvbnN0IHBhcnNlZFJvd3MgPSBbXTtcbiAgY29uc3Qgc2VlblNrdSA9IG5ldyBTZXQoKTtcbiAgZm9yIChsZXQgciA9IGhlYWRlcklkeCArIDE7IHIgPCByb3dzLmxlbmd0aDsgcisrKSB7XG4gICAgY29uc3Qgcm93ID0gcm93c1tyXSB8fCBbXTtcbiAgICBjb25zdCBza3VSYXcgPSByb3dbY29scy5za3VJZHhdO1xuICAgIGlmIChza3VSYXcgPT0gbnVsbCB8fCBTdHJpbmcoc2t1UmF3KS50cmltKCkgPT09ICcnKSBjb250aW51ZTtcbiAgICBjb25zdCBza3UgPSBTdHJpbmcoc2t1UmF3KS50cmltKCk7XG4gICAgY29uc3QgdXBwZXIgPSBza3UudG9VcHBlckNhc2UoKTtcbiAgICAvLyBTa2lwIGZpbGFzIFRPVEFMIC8gU1VNIC8gU1VCVE9UQUxcbiAgICBpZiAodXBwZXIgPT09ICdUT1RBTCcgfHwgdXBwZXIgPT09ICdTVU0nIHx8IHVwcGVyID09PSAnU1VCVE9UQUwnIHx8IHVwcGVyID09PSAnVE9UQUxFUycpXG4gICAgICBjb250aW51ZTtcbiAgICBpZiAoc2VlblNrdS5oYXModXBwZXIpKSBjb250aW51ZTsgLy8gZGVkdXBlXG4gICAgc2VlblNrdS5hZGQodXBwZXIpO1xuICAgIGNvbnN0IGRlc2NyaXB0aW9uID1cbiAgICAgIGNvbHMuZGVzY0lkeCA+PSAwID8gU3RyaW5nKHJvd1tjb2xzLmRlc2NJZHhdID09IG51bGwgPyAnJyA6IHJvd1tjb2xzLmRlc2NJZHhdKS50cmltKCkgOiAnJztcbiAgICBjb25zdCBtb3FSYXcgPSBjb2xzLm1vcUlkeCA+PSAwID8gcm93W2NvbHMubW9xSWR4XSA6IG51bGw7XG4gICAgY29uc3QgbW9xTnVtID0gTnVtYmVyKG1vcVJhdyk7XG4gICAgY29uc3QgbW9xID0gTnVtYmVyLmlzRmluaXRlKG1vcU51bSkgJiYgbW9xTnVtID4gMCA/IE1hdGgucm91bmQobW9xTnVtKSA6IDA7XG4gICAgY29uc3QgbW9udGhzID0ge307XG4gICAgZm9yIChjb25zdCBtYyBvZiBjb2xzLm1vbnRoQ29sdW1ucykge1xuICAgICAgY29uc3QgdiA9IHJvd1ttYy5jb2xJZHhdO1xuICAgICAgY29uc3QgbiA9IE51bWJlcih2KTtcbiAgICAgIGlmIChOdW1iZXIuaXNGaW5pdGUobikgJiYgbiA+IDApIHtcbiAgICAgICAgbW9udGhzW21jLm1vbnRoS2V5XSA9IE1hdGgucm91bmQobik7XG4gICAgICB9XG4gICAgfVxuICAgIHBhcnNlZFJvd3MucHVzaCh7IHNrdSwgZGVzY3JpcHRpb24sIG1vcSwgbW9udGhzIH0pO1xuICB9XG4gIHJldHVybiB7XG4gICAgaGVhZGVyUm93SW5kZXg6IGhlYWRlcklkeCxcbiAgICBkZXRlY3RlZE1vbnRoczogY29scy5kZXRlY3RlZE1vbnRocyxcbiAgICByb3dzQ291bnQ6IHBhcnNlZFJvd3MubGVuZ3RoLFxuICAgIHJvd3M6IHBhcnNlZFJvd3MsXG4gIH07XG59XG5cbi8vIFVNRC1pc2ggZXhwb3J0OiBwYXJhIHZpdGVzdCAobW9kdWxlLmV4cG9ydHMpIHkgcGFyYSBidW5kbGUgYnJvd3NlciAod2luZG93IGdsb2JhbCkuXG5pZiAodHlwZW9mIG1vZHVsZSAhPT0gJ3VuZGVmaW5lZCcgJiYgbW9kdWxlLmV4cG9ydHMpIHtcbiAgbW9kdWxlLmV4cG9ydHMgPSB7IHBhcnNlU2FsZXNQbGFuU2hlZXQsIG5vcm1hbGl6ZU1vbnRoTGFiZWwsIGZpbmRIZWFkZXJSb3csIGRldGVjdENvbHVtbnMgfTtcbn1cbmlmICh0eXBlb2Ygd2luZG93ICE9PSAndW5kZWZpbmVkJykge1xuICB3aW5kb3cuU2FsZXNQbGFuUGFyc2VyID0ge1xuICAgIHBhcnNlU2FsZXNQbGFuU2hlZXQsXG4gICAgbm9ybWFsaXplTW9udGhMYWJlbCxcbiAgICBmaW5kSGVhZGVyUm93LFxuICAgIGRldGVjdENvbHVtbnMsXG4gIH07XG59XG5cbmV4cG9ydCB7IGRldGVjdENvbHVtbnMsIGZpbmRIZWFkZXJSb3csIG5vcm1hbGl6ZU1vbnRoTGFiZWwsIHBhcnNlU2FsZXNQbGFuU2hlZXQgfTtcbiIsICIvLyBAdHMtbm9jaGVja1xyXG4vLyB2MTA5OCsgRmFzZSAxOiBpbXBvcnQgZGVsIHBhcnNlciBwdXJvLiBFbCBtXHUwMEYzZHVsbyBoYWNlIGB3aW5kb3cuU2FsZXNQbGFuUGFyc2VyYFxyXG4vLyBjb21vIHNpZGUtZWZmZWN0IHkgdGFtYmlcdTAwRTluIGV4cG9ydGEgbGFzIGZucyBub21icmFkYXM7IHVzYW1vcyBzaWRlLWVmZmVjdFxyXG4vLyBwb3JxdWUgZm9yZWNhc3QuanMgY29ycmUgZW4gZWwgY2h1bmsgbGF6eSB5IHdpbmRvdyB5YSBlc3RcdTAwRTEgZGlzcG9uaWJsZS5cclxuaW1wb3J0ICcuLi9wdXJlL3NhbGVzLXBsYW4tcGFyc2VyLmpzJztcclxuXHJcbi8vIEdsb2JhbHMgbGVpZG9zIGRlbCBlbnRvcm5vIChkZWNsYXJhZG9zIGVuIGluZGV4Lmh0bWwgaW5saW5lIG8gYnVuZGxlIHByZXZpbyk6XHJcbi8vIGZiRGIsIGN1cnJlbnRVc2VyLCBYTFNYIChjZG4pLCBlc2NhcGVIdG1sLiBNaXNtbyBwYXRyb24gcXVlIG90cm9zIGRvbWluaW9zLlxyXG4vL1xyXG4vLyBGT1JFQ0FTVCAtIG1vZGFsIGFkbWluLW9ubHkgKE1hcmlhbm8pIHF1ZSBjb21wYXJhIHZlbnRhcyBoaXN0b3JpY2FzXHJcbi8vIChGaXJlc3RvcmUgc2t1X3ZlbnRhc19zbmFwc2hvdCwgYWxpbWVudGFkbyBwb3Igc3luYyBCUSB2X3ZlbnRhc19saW5lYXNcclxuLy8gdmVudGFuYSAxM20pIHZzIFNhbGVzIFBsYW4gY2FyZ2FkbyBwb3IgZWwgdXNlciB2aWEgRXhjZWwgKyBwb2xpdGljYSBkZVxyXG4vLyBpbnZlbnRhcmlvIChwcm9tZWRpbyBZVEQgeCAzIG1lc2VzKS5cclxuLy9cclxuLy8gQ2h1bmsgbGF6eTogc2UgY2FyZ2Egc29sbyBhbCBwcmltZXIgY2xpY2sgZGVsIGJvdG9uIEZPUkVDQVNUIGRlbCBoZWFkZXIuXHJcbi8vIFJlZ2lzdHJhZG8gZW4gYnVpbGQuanMgTEFaWV9DSFVOS1MgKyBzcmMvbWFpbi5qcyBpbnN0YWxsQ2h1bmtTdHVicyArIHN3LmpzXHJcbi8vIFNUQVRJQ19BU1NFVFMuIFZlciBDTEFVREUubWQgIzE4ICgzIGx1Z2FyZXMgc2luY3Jvbml6YWRvcykuXHJcbi8vXHJcbi8vIENvbnRyYXRvIGRlbCBFeGNlbCBTYWxlcyBQbGFuIHF1ZSBzdWJlIGVsIHVzZXI6XHJcbi8vICAgQ29sdW1uYXM6IFNLVSB8IE1lczEgfCBNZXMyIHwgTWVzMyB8IE1lczQgfCBNZXM1IHwgTWVzNlxyXG4vLyAgIChub21icmVzIGV4YWN0b3MgZGUgaGVhZGVycyBjYXNlLWluc2Vuc2l0aXZlOyBNZXMxLi42IHNvbiBsb3MgcHJveGltb3NcclxuLy8gICA2IG1lc2VzIGRlc2RlIGVsIG1lcyBhY3R1YWwpLiBVbmEgZmlsYSBwb3IgU0tVLlxyXG4vL1xyXG4vLyBGdWVudGUgZGUgZGF0b3MgaGlzdG9yaWNhczpcclxuLy8gICBGaXJlc3RvcmUgL3NrdV92ZW50YXNfc25hcHNob3Qve1NLVV88c2t1X3NhbmVhZG8+fVxyXG4vLyAgIHtcclxuLy8gICAgIHNrdSwgaXRlbU5hbWUsIGZhbWlsaWEsIHN1YmZhbWlsaWEsXHJcbi8vICAgICBtZXNlczogeyAnMjAyNS0wOCc6IHtxdHksIGFyc30sIC4uLiwgJzIwMjYtMDgnOiB7cXR5LCBhcnN9IH1cclxuLy8gICB9XHJcbi8vICAgUnVsZXM6IHJlYWQgYWRtaW4tb25seSAoY29tcGV0aXRpdmVseSBzZW5zaXRpdmUpLiBFc2NyaXRvIHBvciBjcm9uXHJcbi8vICAgc3luY19zYXBfdG9fYmlncXVlcnkucHkgY2FkYSAzMCBtaW4uXHJcblxyXG4vLyBFc3RhZG8gZGVsIG1vZGFsIChpbnRyYS1jaHVuaywgbm8gY3Jvc3Mtc2NvcGUpLlxyXG5sZXQgX2ZvcmVjYXN0U25hcHNob3QgPSBudWxsOyAvLyB7IFNLVToge2ZhbWlsaWEsIHN1YmZhbWlsaWEsIGl0ZW1OYW1lLCBtZXNlc30gfVxyXG5sZXQgX2ZvcmVjYXN0U2FsZXNQbGFuID0gbnVsbDsgLy8gW3sgc2t1LCBwZWRpZG9Ub3RhbCwgbWVzZXNBcnI6IFtuMS4ubjZdIH1dXHJcbmxldCBfZm9yZWNhc3RSb3dzID0gbnVsbDsgLy8gZmlsYXMgZmluYWxlcyBjYWxjdWxhZGFzIHBhcmEgcHJldmlldyArIGV4cG9ydFxyXG5sZXQgX2ZvcmVjYXN0TG9hZGluZyA9IGZhbHNlO1xyXG5cclxuLy8gdjEwOTgrIChGYXNlIDEgRm9yZWNhc3QgdjIpOiBTYWxlcyBQbGFucyBtZW5zdWFsZXMgcG9yIGZhbWlsaWEgKFJvZHMvUmVlbHMvRkcpLlxyXG4vLyBTZSBndWFyZGFuIGVuIEZpcmVzdG9yZSBgc2FsZXNfcGxhbl9jYWNoZS97ZmFtaWxpYX1gICsgc25hcHNob3QgRXhjZWwgb3JpZ2luYWxcclxuLy8gZW4gU3RvcmFnZSBgZm9yZWNhc3RzX3NuYXBzaG90cy97WVlZWS1NTX0ve2ZhbWlsaWF9Lnhsc3hgLlxyXG4vLyBFbCBwYXJzZXIgcHVybyB2aXZlIGVuIHNyYy9wdXJlL3NhbGVzLXBsYW4tcGFyc2VyLmpzIChhdHRhY2ggYSB3aW5kb3cuU2FsZXNQbGFuUGFyc2VyKS5cclxuY29uc3QgU0FMRVNfUExBTl9GQU1JTElBUyA9IFtcclxuICB7IGtleTogJ3JvZHMnLCBsYWJlbDogJ1JvZHMgKENhXHUwMEYxYXMpJywgY29sb3I6ICcjMGVhNWU5JyB9LFxyXG4gIHsga2V5OiAncmVlbHMnLCBsYWJlbDogJ1JlZWxzJywgY29sb3I6ICcjOGI1Y2Y2JyB9LFxyXG4gIHsga2V5OiAnZmcnLCBsYWJlbDogJ0ZHIChyZXN0byknLCBjb2xvcjogJyNmNTllMGInIH0sXHJcbl07XHJcbmNvbnN0IF9zYWxlc1BsYW5DYWNoZXMgPSB7IHJvZHM6IG51bGwsIHJlZWxzOiBudWxsLCBmZzogbnVsbCB9OyAvLyBsYXN0IGxvYWRlZCBkb2NcclxubGV0IF9mb3JlY2FzdEFjdGl2ZVRhYiA9ICdzYWxlcy1wbGFucyc7IC8vICdzYWxlcy1wbGFucycgfCAnc3RhdCcgfCAnbGVnYWN5J1xyXG5cclxuLy8gdjExMDMrIChGYXNlIDJCKTogRm9yZWNhc3QgRXN0YWRcdTAwRURzdGljbyBcdTIwMTQgb3V0cHV0IHB1YmxpY2FkbyBwb3JcclxuLy8gc2NyaXB0cy9mb3JlY2FzdC9wdWJsaXNoX3RvX2ZpcmVzdG9yZS5weSBhIGZvcmVjYXN0X291dHB1dC97c3ViX3NsdWd9XHJcbi8vICsgZm9yZWNhc3Rfb3V0cHV0X21ldGEvY3VycmVudC4gMjQgc3VicyArIDEgbWV0YSBkb2MuXHJcbmxldCBfZm9yZWNhc3RTdGF0RG9jcyA9IG51bGw7IC8vIFt7aWQsIHN1YmZhbWlsaWEsIGZvcmVjYXN0WzddLCBtZXRyaWNzLCBiZXN0TW9kZWwsIHZlcnNpb25JZH1dXHJcbmxldCBfZm9yZWNhc3RTdGF0TWV0YSA9IG51bGw7IC8vIHtnZW5lcmF0ZWRBdCwgdmVyc2lvbklkLCByZXN1bWVuOiB7Li4ufX1cclxubGV0IF9mb3JlY2FzdFN0YXRIaXN0b3J5Q2FjaGUgPSBudWxsOyAvLyB7IFtzdWJdOiBbe2RzLCB5fV0gfSBjYWNoZSBsYXp5IG9uLWRlbWFuZFxyXG5cclxuLy8gV2hpdGVsaXN0IGRlIGVtYWlscyBjb24gYWNjZXNvIGFsIG1vZGFsIEZPUkVDQVNULiBSZXBsaWNhIGVsIHBhdHJvbiBkZVxyXG4vLyBcIkFuYWxpc2lzXCIgKGluZGV4Lmh0bWw6MTI2MjUpLiBTb2xvIE1hcmlhbm87IHNpIG90cm8gYWRtaW4gbG8gbmVjZXNpdGFcclxuLy8gc2UgYWdyZWdhIGFjYSBleHBsaWNpdG8uXHJcbmNvbnN0IEZPUkVDQVNUX0FMTE9XRURfRU1BSUxTID0gWydtYXJpYW5vLmVyYmlub0BzaGltYW5vLmNvbS5hcicsICdlcmJpbm9tYXJpYW5vQGdtYWlsLmNvbSddO1xyXG5cclxuZnVuY3Rpb24gX2NhbkZvcmVjYXN0KCkge1xyXG4gIHRyeSB7XHJcbiAgICBjb25zdCBlbWFpbCA9ICgod2luZG93LmN1cnJlbnRVc2VyICYmIHdpbmRvdy5jdXJyZW50VXNlci5lbWFpbCkgfHwgJycpLnRvTG93ZXJDYXNlKCk7XHJcbiAgICBpZiAoIWVtYWlsKSByZXR1cm4gZmFsc2U7XHJcbiAgICByZXR1cm4gRk9SRUNBU1RfQUxMT1dFRF9FTUFJTFMuaW5kZXhPZihlbWFpbCkgPj0gMDtcclxuICB9IGNhdGNoIHtcclxuICAgIHJldHVybiBmYWxzZTtcclxuICB9XHJcbn1cclxuXHJcbi8vIEhlbHBlcnMgZGUgbWVzIGNhbGVuZGFyLlxyXG5mdW5jdGlvbiBfbW9udGhLZXkoeWVhciwgbW9udGhPbmVCYXNlZCkge1xyXG4gIHJldHVybiBTdHJpbmcoeWVhcikucGFkU3RhcnQoNCwgJzAnKSArICctJyArIFN0cmluZyhtb250aE9uZUJhc2VkKS5wYWRTdGFydCgyLCAnMCcpO1xyXG59XHJcbmZ1bmN0aW9uIF9tb250aExhYmVsKGtleSkge1xyXG4gIC8vICcyMDI2LTA4JyAtPiAnYWdvLTI2J1xyXG4gIGNvbnN0IFt5LCBtXSA9IGtleS5zcGxpdCgnLScpLm1hcChOdW1iZXIpO1xyXG4gIGNvbnN0IG5hbWVzID0gW1xyXG4gICAgJ2VuZScsXHJcbiAgICAnZmViJyxcclxuICAgICdtYXInLFxyXG4gICAgJ2FicicsXHJcbiAgICAnbWF5JyxcclxuICAgICdqdW4nLFxyXG4gICAgJ2p1bCcsXHJcbiAgICAnYWdvJyxcclxuICAgICdzZXAnLFxyXG4gICAgJ29jdCcsXHJcbiAgICAnbm92JyxcclxuICAgICdkaWMnLFxyXG4gIF07XHJcbiAgcmV0dXJuIG5hbWVzW20gLSAxXSArICctJyArIFN0cmluZyh5KS5zbGljZSgtMik7XHJcbn1cclxuZnVuY3Rpb24gX2FkZE1vbnRocyh5ZWFyLCBtb250aE9uZUJhc2VkLCBkZWx0YSkge1xyXG4gIGNvbnN0IHRvdGFsTW9udGhzID0geWVhciAqIDEyICsgKG1vbnRoT25lQmFzZWQgLSAxKSArIGRlbHRhO1xyXG4gIGNvbnN0IHkgPSBNYXRoLmZsb29yKHRvdGFsTW9udGhzIC8gMTIpO1xyXG4gIGNvbnN0IG0gPSAodG90YWxNb250aHMgJSAxMikgKyAxO1xyXG4gIHJldHVybiB7IHksIG0gfTtcclxufVxyXG5cclxuLy8gU3VtYSBxdHkgZGVsIFNLVSBlbiBsb3MgdWx0aW1vcyAxMiBNRVNFUyBDT01QTEVUT1MgKGV4Y2x1eWUgZWwgbWVzIGFjdHVhbFxyXG4vLyBwYXJjaWFsIC0gbGEgdmVudGFuYSBtb3ZpbCBcIjEyIG1lc2VzIGNlcnJhZG9zXCIgcXVlIGVsIHVzZXIgcGllbnNhIGNvbW9cclxuLy8gXCJlbCBhXHUwMEYxbyBxdWUgeWEgcGFzb1wiKS4gRWplbXBsbyBlbiBhZ29zdG8gMjAyNjogc3VtYXIgYWdvLTI1IGEganVsLTI2LlxyXG5mdW5jdGlvbiBfc3VtVmVudGFzMTJtQ29tcGxldG9zKG1lc2VzTWFwLCBob3kpIHtcclxuICBpZiAoIW1lc2VzTWFwKSByZXR1cm4gMDtcclxuICBsZXQgc3VtID0gMDtcclxuICBjb25zdCBzdGFydE1vbnRoID0gX2FkZE1vbnRocyhob3kuZ2V0RnVsbFllYXIoKSwgaG95LmdldE1vbnRoKCkgKyAxLCAtMTIpO1xyXG4gIGNvbnN0IGVuZE1vbnRoID0gX2FkZE1vbnRocyhob3kuZ2V0RnVsbFllYXIoKSwgaG95LmdldE1vbnRoKCkgKyAxLCAtMSk7XHJcbiAgY29uc3Qgc3RhcnRLZXkgPSBfbW9udGhLZXkoc3RhcnRNb250aC55LCBzdGFydE1vbnRoLm0pO1xyXG4gIGNvbnN0IGVuZEtleSA9IF9tb250aEtleShlbmRNb250aC55LCBlbmRNb250aC5tKTtcclxuICBmb3IgKGNvbnN0IGsgb2YgT2JqZWN0LmtleXMobWVzZXNNYXApKSB7XHJcbiAgICBpZiAoayA+PSBzdGFydEtleSAmJiBrIDw9IGVuZEtleSkge1xyXG4gICAgICBzdW0gKz0gTnVtYmVyKChtZXNlc01hcFtrXSAmJiBtZXNlc01hcFtrXS5xdHkpIHx8IDApO1xyXG4gICAgfVxyXG4gIH1cclxuICByZXR1cm4gc3VtO1xyXG59XHJcblxyXG4vLyBTdW1hIHF0eSBkZWwgU0tVIFlURCAoZW5lcm8gZGVsIGFcdTAwRjFvIGFjdHVhbCBoYXN0YSBtZXMgYWN0dWFsIElOQ0xVU0lWTyxcclxuLy8gYXVucXVlIGVsIG1lcyBhY3R1YWwgc2VhIHBhcmNpYWwpLiBSZXRvcm5hIHsgdG90YWxZdGQsIG1lc2VzVHJhbnNjdXJyaWRvcyB9LlxyXG4vLyBFamVtcGxvIGFnb3N0byAyMDI2IGNvbiB2ZW50YXMganVsPTEwICsgYWdvPTIwIC0+IHszMCwgOH0sIHByb21lZGlvPTMwLzg9My43NS5cclxuLy8gKFNpIGVsIHVzdWFyaW8gZXNwZXJhYmEgZGl2aWRpciBwb3IgMiBlbiB2ZXogZGUgOCwgcmV2aXNhciBzcGVjLiBFbCBwZWRpZG9cclxuLy8gZGljZSBcImNhbnRpZGFkIGRlIG1lc2VzIHF1ZSB0cmFuc2N1cnJpbW9zXCIgPSBtZXNlcyBkZWwgYVx1MDBGMW8gcGFzYWRvcyBoYXN0YSBob3kuKVxyXG5mdW5jdGlvbiBfc3VtVmVudGFzWVREKG1lc2VzTWFwLCBob3kpIHtcclxuICBjb25zdCB5ZWFyID0gaG95LmdldEZ1bGxZZWFyKCk7XHJcbiAgY29uc3QgbWVzQWN0dWFsID0gaG95LmdldE1vbnRoKCkgKyAxO1xyXG4gIGxldCB0b3RhbCA9IDA7XHJcbiAgaWYgKG1lc2VzTWFwKSB7XHJcbiAgICBmb3IgKGxldCBtID0gMTsgbSA8PSBtZXNBY3R1YWw7IG0rKykge1xyXG4gICAgICBjb25zdCBrID0gX21vbnRoS2V5KHllYXIsIG0pO1xyXG4gICAgICB0b3RhbCArPSBOdW1iZXIoKG1lc2VzTWFwW2tdICYmIG1lc2VzTWFwW2tdLnF0eSkgfHwgMCk7XHJcbiAgICB9XHJcbiAgfVxyXG4gIHJldHVybiB7IHRvdGFsWXRkOiB0b3RhbCwgbWVzZXNUcmFuc2N1cnJpZG9zOiBtZXNBY3R1YWwgfTtcclxufVxyXG5cclxuLy8gQ2FyZ2Egc2t1X3ZlbnRhc19zbmFwc2hvdCBjb21wbGV0byAodW5hIHZleiBwb3Igc2VzaW9uIGRlbCBtb2RhbCkuXHJcbmFzeW5jIGZ1bmN0aW9uIF9sb2FkU25hcHNob3QoKSB7XHJcbiAgaWYgKF9mb3JlY2FzdFNuYXBzaG90KSByZXR1cm4gX2ZvcmVjYXN0U25hcHNob3Q7XHJcbiAgaWYgKCF3aW5kb3cuZmJEYikgdGhyb3cgbmV3IEVycm9yKCdGaXJlc3RvcmUgbm8gaW5pY2lhbGl6YWRvJyk7XHJcbiAgY29uc3Qgc25hcCA9IGF3YWl0IHdpbmRvdy5mYkRiLmNvbGxlY3Rpb24oJ3NrdV92ZW50YXNfc25hcHNob3QnKS5nZXQoKTtcclxuICBjb25zdCBieU9yaWdpbmFsU2t1ID0ge307XHJcbiAgY29uc3QgYnlVcHBlclNrdSA9IHt9O1xyXG4gIHNuYXAuZm9yRWFjaCgoZG9jKSA9PiB7XHJcbiAgICBjb25zdCBkID0gZG9jLmRhdGEoKTtcclxuICAgIGlmICghZCB8fCAhZC5za3UpIHJldHVybjtcclxuICAgIGNvbnN0IHNrdVVwcGVyID0gU3RyaW5nKGQuc2t1KS50cmltKCkudG9VcHBlckNhc2UoKTtcclxuICAgIGNvbnN0IHJlY29yZCA9IHtcclxuICAgICAgc2t1OiBkLnNrdSxcclxuICAgICAgaXRlbU5hbWU6IGQuaXRlbU5hbWUgfHwgJycsXHJcbiAgICAgIGZhbWlsaWE6IGQuZmFtaWxpYSB8fCAnJyxcclxuICAgICAgc3ViZmFtaWxpYTogZC5zdWJmYW1pbGlhIHx8ICcnLFxyXG4gICAgICBtZXNlczogZC5tZXNlcyB8fCB7fSxcclxuICAgIH07XHJcbiAgICBieU9yaWdpbmFsU2t1W2Quc2t1XSA9IHJlY29yZDtcclxuICAgIGJ5VXBwZXJTa3Vbc2t1VXBwZXJdID0gcmVjb3JkO1xyXG4gIH0pO1xyXG4gIF9mb3JlY2FzdFNuYXBzaG90ID0geyBieU9yaWdpbmFsU2t1LCBieVVwcGVyU2t1LCBjb3VudDogc25hcC5zaXplIH07XHJcbiAgcmV0dXJuIF9mb3JlY2FzdFNuYXBzaG90O1xyXG59XHJcblxyXG4vLyBQYXJzZWEgZWwgRXhjZWwgU2FsZXMgUGxhbi4gRXNwZXJhIGNvbHVtbmFzIFNLVSArIDYgY29sdW1uYXMgbnVtZXJpY2FzXHJcbi8vIChub21icmVzIGZsZXhpYmxlczogTWVzMS4uTWVzNiwgbWVzXzEuLm1lc182LCBvIGN1YWxxdWllciBoZWFkZXIgY3VzdG9tXHJcbi8vIG1pZW50cmFzIGxhIHByaW1lcmEgc2VhIFNLVSB5IGhheWEgYWwgbWVub3MgNiBjb2x1bW5hcyBudW1lcmljYXMgbWFzKS5cclxuZnVuY3Rpb24gX3BhcnNlU2FsZXNQbGFuUm93cyhyb3dzUmF3KSB7XHJcbiAgaWYgKCFyb3dzUmF3IHx8ICFyb3dzUmF3Lmxlbmd0aCkgcmV0dXJuIFtdO1xyXG4gIGNvbnN0IGhlYWRlclJvdyA9IHJvd3NSYXdbMF07XHJcbiAgLy8gRGV0ZWN0YXIgaW5kaWNlIGRlIGNvbHVtbmEgU0tVXHJcbiAgbGV0IHNrdUNvbElkeCA9IC0xO1xyXG4gIGZvciAobGV0IGkgPSAwOyBpIDwgaGVhZGVyUm93Lmxlbmd0aDsgaSsrKSB7XHJcbiAgICBjb25zdCBoID0gU3RyaW5nKGhlYWRlclJvd1tpXSB8fCAnJylcclxuICAgICAgLnRyaW0oKVxyXG4gICAgICAudG9VcHBlckNhc2UoKTtcclxuICAgIGlmIChoID09PSAnU0tVJyB8fCBoID09PSAnSVRFTUNPREUnIHx8IGggPT09ICdJVEVNJyB8fCBoID09PSAnSVRFTSBDT0RFJyB8fCBoID09PSAnQ09ESUdPJykge1xyXG4gICAgICBza3VDb2xJZHggPSBpO1xyXG4gICAgICBicmVhaztcclxuICAgIH1cclxuICB9XHJcbiAgaWYgKHNrdUNvbElkeCA8IDApXHJcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ0VsIEV4Y2VsIGRlYmUgdGVuZXIgdW5hIGNvbHVtbmEgbGxhbWFkYSBcIlNLVVwiIChvIENvZGlnbyAvIEl0ZW1Db2RlIC8gSXRlbSknKTtcclxuICAvLyBMYXMgNiBjb2x1bW5hcyBkZSBtZXNlczogbGFzIHByaW1lcmFzIDYgY29sdW1uYXMgcXVlIHNlYW4gIT0gc2t1Q29sSWR4LlxyXG4gIGNvbnN0IG1vbnRoQ29scyA9IFtdO1xyXG4gIGZvciAobGV0IGkgPSAwOyBpIDwgaGVhZGVyUm93Lmxlbmd0aCAmJiBtb250aENvbHMubGVuZ3RoIDwgNjsgaSsrKSB7XHJcbiAgICBpZiAoaSAhPT0gc2t1Q29sSWR4KSBtb250aENvbHMucHVzaChpKTtcclxuICB9XHJcbiAgaWYgKG1vbnRoQ29scy5sZW5ndGggPCA2KVxyXG4gICAgdGhyb3cgbmV3IEVycm9yKFxyXG4gICAgICAnRWwgRXhjZWwgZGViZSB0ZW5lciBhbCBtZW5vcyA2IGNvbHVtbmFzIGRlIG1lc2VzIGFkZW1hcyBkZSBTS1UgKGVuY29udHJhZGFzOiAnICtcclxuICAgICAgICBtb250aENvbHMubGVuZ3RoICtcclxuICAgICAgICAnKSdcclxuICAgICk7XHJcbiAgY29uc3Qgb3V0ID0gW107XHJcbiAgZm9yIChsZXQgciA9IDE7IHIgPCByb3dzUmF3Lmxlbmd0aDsgcisrKSB7XHJcbiAgICBjb25zdCByb3cgPSByb3dzUmF3W3JdO1xyXG4gICAgaWYgKCFyb3cgfHwgIXJvdy5sZW5ndGgpIGNvbnRpbnVlO1xyXG4gICAgY29uc3Qgc2t1UmF3ID0gcm93W3NrdUNvbElkeF07XHJcbiAgICBpZiAoc2t1UmF3ID09PSB1bmRlZmluZWQgfHwgc2t1UmF3ID09PSBudWxsIHx8IFN0cmluZyhza3VSYXcpLnRyaW0oKSA9PT0gJycpIGNvbnRpbnVlO1xyXG4gICAgY29uc3Qgc2t1ID0gU3RyaW5nKHNrdVJhdykudHJpbSgpO1xyXG4gICAgY29uc3QgbWVzZXNBcnIgPSBtb250aENvbHMubWFwKChpKSA9PiB7XHJcbiAgICAgIGNvbnN0IHYgPSByb3dbaV07XHJcbiAgICAgIGNvbnN0IG4gPSBOdW1iZXIodik7XHJcbiAgICAgIHJldHVybiBOdW1iZXIuaXNGaW5pdGUobikgPyBuIDogMDtcclxuICAgIH0pO1xyXG4gICAgY29uc3QgcGVkaWRvVG90YWwgPSBtZXNlc0Fyci5yZWR1Y2UoKGEsIGIpID0+IGEgKyBiLCAwKTtcclxuICAgIG91dC5wdXNoKHsgc2t1LCBtZXNlc0FyciwgcGVkaWRvVG90YWwgfSk7XHJcbiAgfVxyXG4gIHJldHVybiBvdXQ7XHJcbn1cclxuXHJcbi8vIENhbGN1bGEgbGFzIGZpbGFzIGZpbmFsZXMgY3J1emFuZG8gc25hcHNob3QgKyBzYWxlcyBwbGFuLlxyXG5mdW5jdGlvbiBfY29tcHV0ZUZvcmVjYXN0Um93cyhzbmFwc2hvdCwgc2FsZXNQbGFuLCBob3kpIHtcclxuICBjb25zdCByb3dzID0gW107XHJcbiAgZm9yIChjb25zdCBzcCBvZiBzYWxlc1BsYW4pIHtcclxuICAgIGNvbnN0IHNrdVVwcGVyID0gc3Auc2t1LnRvVXBwZXJDYXNlKCk7XHJcbiAgICBjb25zdCBoaXN0ID0gc25hcHNob3QuYnlVcHBlclNrdVtza3VVcHBlcl0gfHwgbnVsbDtcclxuICAgIGNvbnN0IHZlbnRhczEybSA9IGhpc3QgPyBfc3VtVmVudGFzMTJtQ29tcGxldG9zKGhpc3QubWVzZXMsIGhveSkgOiAwO1xyXG4gICAgY29uc3QgeXRkID0gaGlzdFxyXG4gICAgICA/IF9zdW1WZW50YXNZVEQoaGlzdC5tZXNlcywgaG95KVxyXG4gICAgICA6IHsgdG90YWxZdGQ6IDAsIG1lc2VzVHJhbnNjdXJyaWRvczogaG95LmdldE1vbnRoKCkgKyAxIH07XHJcbiAgICBjb25zdCBwcm9tZWRpbyA9IHl0ZC5tZXNlc1RyYW5zY3Vycmlkb3MgPiAwID8geXRkLnRvdGFsWXRkIC8geXRkLm1lc2VzVHJhbnNjdXJyaWRvcyA6IDA7XHJcbiAgICBjb25zdCBwb2xpdGljYSA9IHByb21lZGlvICogMztcclxuICAgIGNvbnN0IHRvdGFsID0gc3AucGVkaWRvVG90YWwgLSBwb2xpdGljYTtcclxuICAgIHJvd3MucHVzaCh7XHJcbiAgICAgIHNrdTogc3Auc2t1LFxyXG4gICAgICBpdGVtTmFtZTogaGlzdCA/IGhpc3QuaXRlbU5hbWUgOiAnJyxcclxuICAgICAgZmFtaWxpYTogaGlzdCA/IGhpc3QuZmFtaWxpYSA6ICcoc2luIG1hdGNoKScsXHJcbiAgICAgIHN1YmZhbWlsaWE6IGhpc3QgPyBoaXN0LnN1YmZhbWlsaWEgOiAnKHNpbiBtYXRjaCknLFxyXG4gICAgICB2ZW50YXMxMm06IHZlbnRhczEybSxcclxuICAgICAgcGVkaWRvNm06IHNwLnBlZGlkb1RvdGFsLFxyXG4gICAgICBwcm9tZWRpbzogcHJvbWVkaW8sXHJcbiAgICAgIHBvbGl0aWNhOiBwb2xpdGljYSxcclxuICAgICAgdG90YWw6IHRvdGFsLFxyXG4gICAgICBoYXNIaXN0b3JpYTogISFoaXN0LFxyXG4gICAgfSk7XHJcbiAgfVxyXG4gIHJldHVybiByb3dzO1xyXG59XHJcblxyXG5mdW5jdGlvbiBfcmVuZGVyTW9kYWxTaGVsbCgpIHtcclxuICBjb25zdCBleGlzdGluZyA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdmb3JlY2FzdC1tb2RhbCcpO1xyXG4gIGlmIChleGlzdGluZykgcmV0dXJuIGV4aXN0aW5nO1xyXG4gIGNvbnN0IGVsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2Jyk7XHJcbiAgZWwuaWQgPSAnZm9yZWNhc3QtbW9kYWwnO1xyXG4gIGVsLmNsYXNzTmFtZSA9ICdtb2RhbC1vdmVybGF5JztcclxuICBlbC5zdHlsZS5jc3NUZXh0ID1cclxuICAgICdkaXNwbGF5Om5vbmU7cG9zaXRpb246Zml4ZWQ7aW5zZXQ6MDtiYWNrZ3JvdW5kOnJnYmEoMTUsMjMsNDIsLjYpO3otaW5kZXg6MjA1MDsnO1xyXG4gIGVsLm9uY2xpY2sgPSBmdW5jdGlvbiAoZXYpIHtcclxuICAgIGlmIChldi50YXJnZXQgPT09IGVsKSB3aW5kb3cuY2xvc2VGb3JlY2FzdE1vZGFsKCk7XHJcbiAgfTtcclxuICAvLyBTaGVsbCArIHRhYnMgYmFyICsgMiBjb250ZW5lZG9yZXMgZGUgdGFicyAoU2FsZXMgUGxhbnMgbnVldmEsIExlZ2FjeSA2bSkuXHJcbiAgLy8gRWwgY29udGVuaWRvIGRlIGNhZGEgdGFiIHNlIHBpbnRhIGNvbiBfcmVuZGVyU2FsZXNQbGFuc1RhYigpIHkgZWwgbGVnYWN5XHJcbiAgLy8gdXNhIGVsIGZsdWpvIF9yZW5kZXJUYWJsZSgpIGRlIHNpZW1wcmUuXHJcbiAgY29uc3Qgc2hlbGxIdG1sID0gX2J1aWxkU2hlbGxIdG1sKCk7XHJcbiAgZWwuaW5uZXJIVE1MID0gc2hlbGxIdG1sO1xyXG4gIGRvY3VtZW50LmJvZHkuYXBwZW5kQ2hpbGQoZWwpO1xyXG4gIHJldHVybiBlbDtcclxufVxyXG5cclxuZnVuY3Rpb24gX2J1aWxkU2hlbGxIdG1sKCkge1xyXG4gIC8vIEJyb2tlbi1vdXQgcHVyZSBzdHJpbmcgYnVpbGRlciBwYXJhIHBhc2FyIGVsIGhvb2sgZGUgaW5uZXJIVE1MLlxyXG4gIGNvbnN0IG1vZGFsT3V0ZXIgPVxyXG4gICAgJzxkaXYgc3R5bGU9XCJwb3NpdGlvbjphYnNvbHV0ZTtpbnNldDoxdmggMXZ3O2JhY2tncm91bmQ6dmFyKC0tYmctZWxldmF0ZWQpO2JvcmRlci1yYWRpdXM6MTBweDtkaXNwbGF5OmZsZXg7ZmxleC1kaXJlY3Rpb246Y29sdW1uO292ZXJmbG93OmhpZGRlbjtib3gtc2hhZG93OjAgMjBweCA1MHB4IHJnYmEoMCwwLDAsLjM1KVwiPic7XHJcbiAgY29uc3QgaGVhZGVyID1cclxuICAgICc8ZGl2IHN0eWxlPVwicGFkZGluZzoxMnB4IDE4cHg7YmFja2dyb3VuZDojMGYxNzJhO2NvbG9yOiNmZmY7ZGlzcGxheTpmbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtnYXA6MTJweFwiPicgK1xyXG4gICAgJzxkaXYgc3R5bGU9XCJmbGV4OjFcIj48ZGl2IHN0eWxlPVwiZm9udC1zaXplOjE2cHg7Zm9udC13ZWlnaHQ6ODAwO2xldHRlci1zcGFjaW5nOi41cHhcIj5GT1JFQ0FTVDwvZGl2PicgK1xyXG4gICAgJzxkaXYgaWQ9XCJmb3JlY2FzdC1zdWJ0aXRsZVwiIHN0eWxlPVwiZm9udC1zaXplOjExcHg7b3BhY2l0eTouODttYXJnaW4tdG9wOjJweFwiPlNhbGVzIFBsYW5zIG1lbnN1YWxlcyArIHBvbGl0aWNhIGRlIGludmVudGFyaW88L2Rpdj48L2Rpdj4nICtcclxuICAgICc8YnV0dG9uIG9uY2xpY2s9XCJjbG9zZUZvcmVjYXN0TW9kYWwoKVwiIHN0eWxlPVwiYmFja2dyb3VuZDp0cmFuc3BhcmVudDtjb2xvcjojZmZmO2JvcmRlcjoxcHggc29saWQgcmdiYSgyNTUsMjU1LDI1NSwuNCk7Ym9yZGVyLXJhZGl1czo2cHg7cGFkZGluZzo2cHggMTBweDtjdXJzb3I6cG9pbnRlcjtmb250LXdlaWdodDo3MDBcIj5DZXJyYXI8L2J1dHRvbj4nICtcclxuICAgICc8L2Rpdj4nO1xyXG4gIGNvbnN0IHRhYnNCYXIgPVxyXG4gICAgJzxkaXYgaWQ9XCJmb3JlY2FzdC10YWJzLWJhclwiIHN0eWxlPVwiZGlzcGxheTpmbGV4O2dhcDowO2JhY2tncm91bmQ6IzFlMjkzYjtwYWRkaW5nOjAgMThweDtib3JkZXItYm90dG9tOjFweCBzb2xpZCB2YXIoLS1ib3JkZXItc3VidGxlKVwiPicgK1xyXG4gICAgJzxidXR0b24gZGF0YS10YWI9XCJzYWxlcy1wbGFuc1wiIG9uY2xpY2s9XCJzd2l0Y2hGb3JlY2FzdFRhYihcXCdzYWxlcy1wbGFuc1xcJylcIiBjbGFzcz1cImZvcmVjYXN0LXRhYlwiIHN0eWxlPVwicGFkZGluZzoxMHB4IDE2cHg7YmFja2dyb3VuZDp0cmFuc3BhcmVudDtjb2xvcjojZmZmO2JvcmRlcjpub25lO2JvcmRlci1ib3R0b206M3B4IHNvbGlkICMwZDk0ODg7Y3Vyc29yOnBvaW50ZXI7Zm9udC13ZWlnaHQ6NzAwO2ZvbnQtc2l6ZToxMnB4O2xldHRlci1zcGFjaW5nOi40cHg7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlXCI+U2FsZXMgUGxhbnM8L2J1dHRvbj4nICtcclxuICAgICc8YnV0dG9uIGRhdGEtdGFiPVwic3RhdFwiIG9uY2xpY2s9XCJzd2l0Y2hGb3JlY2FzdFRhYihcXCdzdGF0XFwnKVwiIGNsYXNzPVwiZm9yZWNhc3QtdGFiXCIgc3R5bGU9XCJwYWRkaW5nOjEwcHggMTZweDtiYWNrZ3JvdW5kOnRyYW5zcGFyZW50O2NvbG9yOiM5NGEzYjg7Ym9yZGVyOm5vbmU7Ym9yZGVyLWJvdHRvbTozcHggc29saWQgdHJhbnNwYXJlbnQ7Y3Vyc29yOnBvaW50ZXI7Zm9udC13ZWlnaHQ6NjAwO2ZvbnQtc2l6ZToxMnB4O2xldHRlci1zcGFjaW5nOi40cHg7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlXCI+Rm9yZWNhc3QgRXN0YWRcdTAwRURzdGljbzwvYnV0dG9uPicgK1xyXG4gICAgJzxidXR0b24gZGF0YS10YWI9XCJsZWdhY3lcIiBvbmNsaWNrPVwic3dpdGNoRm9yZWNhc3RUYWIoXFwnbGVnYWN5XFwnKVwiIGNsYXNzPVwiZm9yZWNhc3QtdGFiXCIgc3R5bGU9XCJwYWRkaW5nOjEwcHggMTZweDtiYWNrZ3JvdW5kOnRyYW5zcGFyZW50O2NvbG9yOiM5NGEzYjg7Ym9yZGVyOm5vbmU7Ym9yZGVyLWJvdHRvbTozcHggc29saWQgdHJhbnNwYXJlbnQ7Y3Vyc29yOnBvaW50ZXI7Zm9udC13ZWlnaHQ6NjAwO2ZvbnQtc2l6ZToxMnB4O2xldHRlci1zcGFjaW5nOi40cHg7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlXCI+TGVnYWN5ICg2bSk8L2J1dHRvbj4nICtcclxuICAgICc8L2Rpdj4nO1xyXG4gIGNvbnN0IHRhYlNhbGVzUGxhbnMgPSAnPGRpdiBpZD1cImZvcmVjYXN0LXRhYi1zYWxlcy1wbGFuc1wiIHN0eWxlPVwiZmxleDoxO292ZXJmbG93OmF1dG9cIj48L2Rpdj4nO1xyXG4gIGNvbnN0IHRhYlN0YXQgPSAnPGRpdiBpZD1cImZvcmVjYXN0LXRhYi1zdGF0XCIgc3R5bGU9XCJmbGV4OjE7b3ZlcmZsb3c6YXV0bztkaXNwbGF5Om5vbmVcIj48L2Rpdj4nO1xyXG4gIGNvbnN0IGxlZ2FjeUJhciA9XHJcbiAgICAnPGRpdiBzdHlsZT1cInBhZGRpbmc6MTJweCAxOHB4O2JhY2tncm91bmQ6dmFyKC0tYmctc2Vjb25kYXJ5KTtib3JkZXItYm90dG9tOjFweCBzb2xpZCB2YXIoLS1ib3JkZXItc3VidGxlKTtkaXNwbGF5OmZsZXg7ZmxleC13cmFwOndyYXA7Z2FwOjE0cHg7YWxpZ24taXRlbXM6Y2VudGVyXCI+JyArXHJcbiAgICAnPGxhYmVsIHN0eWxlPVwiZGlzcGxheTppbmxpbmUtZmxleDthbGlnbi1pdGVtczpjZW50ZXI7Z2FwOjhweDtwYWRkaW5nOjhweCAxMnB4O2JhY2tncm91bmQ6IzBkOTQ4ODtjb2xvcjojZmZmO2JvcmRlci1yYWRpdXM6NnB4O2ZvbnQtd2VpZ2h0OjcwMDtmb250LXNpemU6MTJweDtjdXJzb3I6cG9pbnRlclwiPicgK1xyXG4gICAgJzxzcGFuPkNhcmdhciBTYWxlcyBQbGFuICgueGxzeCk8L3NwYW4+JyArXHJcbiAgICAnPGlucHV0IHR5cGU9XCJmaWxlXCIgYWNjZXB0PVwiLnhsc3gsLnhsc1wiIHN0eWxlPVwiZGlzcGxheTpub25lXCIgb25jaGFuZ2U9XCJvbkZvcmVjYXN0U2FsZXNQbGFuRmlsZShldmVudClcIi8+PC9sYWJlbD4nICtcclxuICAgICc8ZGl2IGlkPVwiZm9yZWNhc3QtaGludFwiIHN0eWxlPVwiZm9udC1zaXplOjExcHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7bWF4LXdpZHRoOjUyMHB4XCI+Rm9ybWF0byBsZWdhY3k6IHByaW1lcmEgY29sdW1uYSA8Yj5TS1U8L2I+LCBsdWVnbyA2IGNvbHVtbmFzIGNvbiBsYXMgdW5pZGFkZXMgcGVkaWRhcyBtZXMgYSBtZXMuPC9kaXY+JyArXHJcbiAgICAnPGJ1dHRvbiBpZD1cImZvcmVjYXN0LWV4cG9ydC1idG5cIiBvbmNsaWNrPVwiZXhwb3J0Rm9yZWNhc3RFeGNlbCgpXCIgZGlzYWJsZWQgc3R5bGU9XCJwYWRkaW5nOjhweCAxNHB4O2JhY2tncm91bmQ6dmFyKC0tY29sb3Itc3VjY2Vzcyk7Y29sb3I6I2ZmZjtib3JkZXI6bm9uZTtib3JkZXItcmFkaXVzOjZweDtmb250LXdlaWdodDo3MDA7Y3Vyc29yOnBvaW50ZXI7b3BhY2l0eTouNVwiPkV4cG9ydGFyIEV4Y2VsPC9idXR0b24+JyArXHJcbiAgICAnPGRpdiBpZD1cImZvcmVjYXN0LXN0YXRzXCIgc3R5bGU9XCJtYXJnaW4tbGVmdDphdXRvO2ZvbnQtc2l6ZToxMXB4O2NvbG9yOnZhcigtLXRleHQtc2Vjb25kYXJ5KTtmb250LXdlaWdodDo2MDBcIj48L2Rpdj4nICtcclxuICAgICc8L2Rpdj4nO1xyXG4gIGNvbnN0IGxlZ2FjeUJvZHkgPVxyXG4gICAgJzxkaXYgaWQ9XCJmb3JlY2FzdC1ib2R5XCIgc3R5bGU9XCJmbGV4OjE7b3ZlcmZsb3c6YXV0bztwYWRkaW5nOjBcIj48ZGl2IHN0eWxlPVwicGFkZGluZzo2MHB4IDIwcHg7dGV4dC1hbGlnbjpjZW50ZXI7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7Zm9udC1zaXplOjE0cHhcIj5Fc3BlcmFuZG8gYXJjaGl2byBTYWxlcyBQbGFuLi4uPC9kaXY+PC9kaXY+JztcclxuICBjb25zdCB0YWJMZWdhY3kgPVxyXG4gICAgJzxkaXYgaWQ9XCJmb3JlY2FzdC10YWItbGVnYWN5XCIgc3R5bGU9XCJmbGV4OjE7b3ZlcmZsb3c6aGlkZGVuO2ZsZXgtZGlyZWN0aW9uOmNvbHVtbjtkaXNwbGF5Om5vbmVcIj4nICtcclxuICAgIGxlZ2FjeUJhciArXHJcbiAgICBsZWdhY3lCb2R5ICtcclxuICAgICc8L2Rpdj4nO1xyXG4gIHJldHVybiBtb2RhbE91dGVyICsgaGVhZGVyICsgdGFic0JhciArIHRhYlNhbGVzUGxhbnMgKyB0YWJTdGF0ICsgdGFiTGVnYWN5ICsgJzwvZGl2Pic7XHJcbn1cclxuXHJcbi8vIHYxMDk4KyBGYXNlIDEgKyB2MTEwMysgRmFzZSAyQjogc3dpdGNoIGVudHJlIHRhYnMgU2FsZXMgUGxhbnMgLyBTdGF0IC8gTGVnYWN5LlxyXG53aW5kb3cuc3dpdGNoRm9yZWNhc3RUYWIgPSBmdW5jdGlvbiAodGFiSWQpIHtcclxuICBfZm9yZWNhc3RBY3RpdmVUYWIgPSB0YWJJZDtcclxuICBjb25zdCBzcCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdmb3JlY2FzdC10YWItc2FsZXMtcGxhbnMnKTtcclxuICBjb25zdCBzdCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdmb3JlY2FzdC10YWItc3RhdCcpO1xyXG4gIGNvbnN0IGxnID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2ZvcmVjYXN0LXRhYi1sZWdhY3knKTtcclxuICBpZiAoc3ApIHNwLnN0eWxlLmRpc3BsYXkgPSB0YWJJZCA9PT0gJ3NhbGVzLXBsYW5zJyA/ICdibG9jaycgOiAnbm9uZSc7XHJcbiAgaWYgKHN0KSBzdC5zdHlsZS5kaXNwbGF5ID0gdGFiSWQgPT09ICdzdGF0JyA/ICdibG9jaycgOiAnbm9uZSc7XHJcbiAgaWYgKGxnKSBsZy5zdHlsZS5kaXNwbGF5ID0gdGFiSWQgPT09ICdsZWdhY3knID8gJ2ZsZXgnIDogJ25vbmUnO1xyXG4gIGNvbnN0IGJ0bnMgPSBkb2N1bWVudC5xdWVyeVNlbGVjdG9yQWxsKCcjZm9yZWNhc3QtdGFicy1iYXIgLmZvcmVjYXN0LXRhYicpO1xyXG4gIGJ0bnMuZm9yRWFjaCgoYikgPT4ge1xyXG4gICAgY29uc3QgYWN0aXZlID0gYi5nZXRBdHRyaWJ1dGUoJ2RhdGEtdGFiJykgPT09IHRhYklkO1xyXG4gICAgYi5zdHlsZS5jb2xvciA9IGFjdGl2ZSA/ICcjZmZmJyA6ICcjOTRhM2I4JztcclxuICAgIGIuc3R5bGUuYm9yZGVyQm90dG9tQ29sb3IgPSBhY3RpdmUgPyAnIzBkOTQ4OCcgOiAndHJhbnNwYXJlbnQnO1xyXG4gICAgYi5zdHlsZS5mb250V2VpZ2h0ID0gYWN0aXZlID8gJzcwMCcgOiAnNjAwJztcclxuICB9KTtcclxuICAvLyBMYXp5IGxvYWQgZGVsIGNvbnRlbmlkbyBzdGF0IG9uLWRlbWFuZCBsYSBwcmltZXJhIHZlelxyXG4gIGlmICh0YWJJZCA9PT0gJ3N0YXQnICYmICFfZm9yZWNhc3RTdGF0RG9jcykge1xyXG4gICAgX2xvYWRGb3JlY2FzdE91dHB1dCgpXHJcbiAgICAgIC50aGVuKF9yZW5kZXJGb3JlY2FzdFN0YXRUYWIpXHJcbiAgICAgIC5jYXRjaCgoZSkgPT4ge1xyXG4gICAgICAgIGNvbnNvbGUuZXJyb3IoJ1tGT1JFQ0FTVCBzdGF0XSBsb2FkIGZhaWwnLCBlKTtcclxuICAgICAgICBjb25zdCBjID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2ZvcmVjYXN0LXRhYi1zdGF0Jyk7XHJcbiAgICAgICAgaWYgKGMpXHJcbiAgICAgICAgICBjLmlubmVySFRNTCA9XHJcbiAgICAgICAgICAgICc8ZGl2IHN0eWxlPVwicGFkZGluZzo2MHB4IDIwcHg7dGV4dC1hbGlnbjpjZW50ZXI7Y29sb3I6I2RjMjYyNlwiPkVycm9yIGNhcmdhbmRvIGZvcmVjYXN0X291dHB1dDogJyArXHJcbiAgICAgICAgICAgIGVzY2FwZUh0bWxTYWZlKGUubWVzc2FnZSB8fCBTdHJpbmcoZSkpICtcclxuICAgICAgICAgICAgJzwvZGl2Pic7XHJcbiAgICAgIH0pO1xyXG4gIH1cclxufTtcclxuXHJcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG4vLyBGQVNFIDEgXHUyMDE0IFNhbGVzIFBsYW5zIHVwbG9hZCAoUm9kcyAvIFJlZWxzIC8gRkcpXHJcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cclxuZnVuY3Rpb24gX3llYXJNb250aE5vdygpIHtcclxuICBjb25zdCBkID0gbmV3IERhdGUoKTtcclxuICByZXR1cm4gZC5nZXRGdWxsWWVhcigpICsgJy0nICsgU3RyaW5nKGQuZ2V0TW9udGgoKSArIDEpLnBhZFN0YXJ0KDIsICcwJyk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIF9mbXRTaXplKGJ5dGVzKSB7XHJcbiAgaWYgKCFieXRlcykgcmV0dXJuICcnO1xyXG4gIGlmIChieXRlcyA8IDEwMjQpIHJldHVybiBieXRlcyArICcgQic7XHJcbiAgaWYgKGJ5dGVzIDwgMTAyNCAqIDEwMjQpIHJldHVybiAoYnl0ZXMgLyAxMDI0KS50b0ZpeGVkKDEpICsgJyBLQic7XHJcbiAgcmV0dXJuIChieXRlcyAvICgxMDI0ICogMTAyNCkpLnRvRml4ZWQoMikgKyAnIE1CJztcclxufVxyXG5cclxuZnVuY3Rpb24gX2ZtdERhdGVTaG9ydChpc28pIHtcclxuICBpZiAoIWlzbykgcmV0dXJuICdcdTIwMTQnO1xyXG4gIHRyeSB7XHJcbiAgICBjb25zdCBkID0gaXNvLnRvRGF0ZSA/IGlzby50b0RhdGUoKSA6IG5ldyBEYXRlKGlzbyk7XHJcbiAgICByZXR1cm4gKFxyXG4gICAgICBkLnRvTG9jYWxlRGF0ZVN0cmluZygnZXMtQVInLCB7IGRheTogJzItZGlnaXQnLCBtb250aDogJ3Nob3J0JywgeWVhcjogJzItZGlnaXQnIH0pICtcclxuICAgICAgJyAnICtcclxuICAgICAgZC50b0xvY2FsZVRpbWVTdHJpbmcoJ2VzLUFSJywgeyBob3VyOiAnMi1kaWdpdCcsIG1pbnV0ZTogJzItZGlnaXQnIH0pXHJcbiAgICApO1xyXG4gIH0gY2F0Y2gge1xyXG4gICAgcmV0dXJuIFN0cmluZyhpc28pO1xyXG4gIH1cclxufVxyXG5cclxuYXN5bmMgZnVuY3Rpb24gX2xvYWRTYWxlc1BsYW5DYWNoZXMoKSB7XHJcbiAgaWYgKCF3aW5kb3cuZmJEYikgcmV0dXJuO1xyXG4gIGF3YWl0IFByb21pc2UuYWxsKFxyXG4gICAgU0FMRVNfUExBTl9GQU1JTElBUy5tYXAoYXN5bmMgKGYpID0+IHtcclxuICAgICAgdHJ5IHtcclxuICAgICAgICBjb25zdCBkb2MgPSBhd2FpdCB3aW5kb3cuZmJEYi5jb2xsZWN0aW9uKCdzYWxlc19wbGFuX2NhY2hlJykuZG9jKGYua2V5KS5nZXQoKTtcclxuICAgICAgICBfc2FsZXNQbGFuQ2FjaGVzW2Yua2V5XSA9IGRvYy5leGlzdHMgPyBkb2MuZGF0YSgpIDogbnVsbDtcclxuICAgICAgfSBjYXRjaCAoZSkge1xyXG4gICAgICAgIGNvbnNvbGUud2FybignW0ZPUkVDQVNUXSBsb2FkIHNhbGVzX3BsYW5fY2FjaGUvJyArIGYua2V5ICsgJyBmYWlsOicsIGUgJiYgZS5tZXNzYWdlKTtcclxuICAgICAgICBfc2FsZXNQbGFuQ2FjaGVzW2Yua2V5XSA9IG51bGw7XHJcbiAgICAgIH1cclxuICAgIH0pXHJcbiAgKTtcclxufVxyXG5cclxuZnVuY3Rpb24gX3JlbmRlclRhYmxlKHJvd3MpIHtcclxuICBjb25zdCBib2R5ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2ZvcmVjYXN0LWJvZHknKTtcclxuICBpZiAoIWJvZHkpIHJldHVybjtcclxuICBpZiAoIXJvd3MgfHwgIXJvd3MubGVuZ3RoKSB7XHJcbiAgICBib2R5LmlubmVySFRNTCA9XHJcbiAgICAgICc8ZGl2IHN0eWxlPVwicGFkZGluZzo2MHB4IDIwcHg7dGV4dC1hbGlnbjpjZW50ZXI7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZClcIj5TYWxlcyBQbGFuIHZhY2lvIG8gc2luIGZpbGFzIHZhbGlkYXMuPC9kaXY+JztcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgY29uc3QgZm10ID0gKG4pID0+XHJcbiAgICBuID09PSAwIHx8ICFOdW1iZXIuaXNGaW5pdGUobilcclxuICAgICAgPyAnMCdcclxuICAgICAgOiBOdW1iZXIobikudG9Mb2NhbGVTdHJpbmcoJ2VzLUFSJywgeyBtYXhpbXVtRnJhY3Rpb25EaWdpdHM6IDEgfSk7XHJcbiAgY29uc3QgY29sb3JGb3JUb3RhbCA9ICh0KSA9PiB7XHJcbiAgICBpZiAodCA+IDApIHJldHVybiAnIzE2NjUzNCc7IC8vIHNvYnJhIChwZWRpc3RlIG1hcyBxdWUgbGEgcG9saXRpY2EpIC0gdmVyZGVcclxuICAgIGlmICh0IDwgMCkgcmV0dXJuICcjYzI0MTBjJzsgLy8gZmFsdGEgKHBlZGlzdGUgbWVub3MgcXVlIGxhIHBvbGl0aWNhKSAtIG5hcmFuamEgdXJnZW50ZVxyXG4gICAgcmV0dXJuICcjNDc1NTY5JztcclxuICB9O1xyXG4gIGNvbnN0IHJvd3NIdG1sID0gcm93c1xyXG4gICAgLm1hcChcclxuICAgICAgKHIpID0+XHJcbiAgICAgICAgJycgK1xyXG4gICAgICAgICc8dHInICtcclxuICAgICAgICAoci5oYXNIaXN0b3JpYSA/ICcnIDogJyBzdHlsZT1cImJhY2tncm91bmQ6dmFyKC0tY29sb3Itd2FybmluZy1iZylcIicpICtcclxuICAgICAgICAnPicgK1xyXG4gICAgICAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjZweCAxMHB4O2ZvbnQtZmFtaWx5Om1vbm9zcGFjZTtmb250LXNpemU6MTFweDt3aGl0ZS1zcGFjZTpub3dyYXBcIj4nICtcclxuICAgICAgICBlc2NhcGVIdG1sU2FmZShyLnNrdSkgK1xyXG4gICAgICAgICc8L3RkPicgK1xyXG4gICAgICAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjZweCAxMHB4O2ZvbnQtc2l6ZToxMXB4XCI+JyArXHJcbiAgICAgICAgZXNjYXBlSHRtbFNhZmUoci5mYW1pbGlhKSArXHJcbiAgICAgICAgJzwvdGQ+JyArXHJcbiAgICAgICAgJzx0ZCBzdHlsZT1cInBhZGRpbmc6NnB4IDEwcHg7Zm9udC1zaXplOjExcHhcIj4nICtcclxuICAgICAgICBlc2NhcGVIdG1sU2FmZShyLnN1YmZhbWlsaWEpICtcclxuICAgICAgICAnPC90ZD4nICtcclxuICAgICAgICAnPHRkIHN0eWxlPVwicGFkZGluZzo2cHggMTBweDt0ZXh0LWFsaWduOnJpZ2h0O2ZvbnQtdmFyaWFudC1udW1lcmljOnRhYnVsYXItbnVtc1wiPicgK1xyXG4gICAgICAgIGZtdChyLnZlbnRhczEybSkgK1xyXG4gICAgICAgICc8L3RkPicgK1xyXG4gICAgICAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjZweCAxMHB4O3RleHQtYWxpZ246cmlnaHQ7Zm9udC12YXJpYW50LW51bWVyaWM6dGFidWxhci1udW1zO2ZvbnQtd2VpZ2h0OjYwMFwiPicgK1xyXG4gICAgICAgIGZtdChyLnBlZGlkbzZtKSArXHJcbiAgICAgICAgJzwvdGQ+JyArXHJcbiAgICAgICAgJzx0ZCBzdHlsZT1cInBhZGRpbmc6NnB4IDEwcHg7dGV4dC1hbGlnbjpyaWdodDtmb250LXZhcmlhbnQtbnVtZXJpYzp0YWJ1bGFyLW51bXM7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZClcIj4nICtcclxuICAgICAgICBmbXQoci5wcm9tZWRpbykgK1xyXG4gICAgICAgICc8L3RkPicgK1xyXG4gICAgICAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjZweCAxMHB4O3RleHQtYWxpZ246cmlnaHQ7Zm9udC12YXJpYW50LW51bWVyaWM6dGFidWxhci1udW1zXCI+JyArXHJcbiAgICAgICAgZm10KHIucG9saXRpY2EpICtcclxuICAgICAgICAnPC90ZD4nICtcclxuICAgICAgICAnPHRkIHN0eWxlPVwicGFkZGluZzo2cHggMTBweDt0ZXh0LWFsaWduOnJpZ2h0O2ZvbnQtdmFyaWFudC1udW1lcmljOnRhYnVsYXItbnVtcztmb250LXdlaWdodDo3MDA7Y29sb3I6JyArXHJcbiAgICAgICAgY29sb3JGb3JUb3RhbChyLnRvdGFsKSArXHJcbiAgICAgICAgJ1wiPicgK1xyXG4gICAgICAgIGZtdChyLnRvdGFsKSArXHJcbiAgICAgICAgJzwvdGQ+JyArXHJcbiAgICAgICAgJzwvdHI+J1xyXG4gICAgKVxyXG4gICAgLmpvaW4oJycpO1xyXG4gIGNvbnN0IGhlYWRlciA9XHJcbiAgICAnJyArXHJcbiAgICAnPHRoZWFkIHN0eWxlPVwicG9zaXRpb246c3RpY2t5O3RvcDowO2JhY2tncm91bmQ6IzBmMTcyYTtjb2xvcjojZmZmO3otaW5kZXg6MVwiPicgK1xyXG4gICAgJzx0cj4nICtcclxuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjhweCAxMHB4O3RleHQtYWxpZ246bGVmdDtmb250LXNpemU6MTFweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7bGV0dGVyLXNwYWNpbmc6LjRweFwiPlNLVTwvdGg+JyArXHJcbiAgICAnPHRoIHN0eWxlPVwicGFkZGluZzo4cHggMTBweDt0ZXh0LWFsaWduOmxlZnQ7Zm9udC1zaXplOjExcHg7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO2xldHRlci1zcGFjaW5nOi40cHhcIj5GYW1pbGlhPC90aD4nICtcclxuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjhweCAxMHB4O3RleHQtYWxpZ246bGVmdDtmb250LXNpemU6MTFweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7bGV0dGVyLXNwYWNpbmc6LjRweFwiPlN1YmZhbWlsaWE8L3RoPicgK1xyXG4gICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6OHB4IDEwcHg7dGV4dC1hbGlnbjpyaWdodDtmb250LXNpemU6MTFweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7bGV0dGVyLXNwYWNpbmc6LjRweFwiIHRpdGxlPVwiU3VtYSBkZSBxdHkgZmFjdHVyYWRhIGVuIGxvcyB1bHRpbW9zIDEyIG1lc2VzIGNvbXBsZXRvc1wiPlZlbnRhcyAxMm08L3RoPicgK1xyXG4gICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6OHB4IDEwcHg7dGV4dC1hbGlnbjpyaWdodDtmb250LXNpemU6MTFweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7bGV0dGVyLXNwYWNpbmc6LjRweFwiIHRpdGxlPVwiU3VtYSBkZSBsYXMgNiBjb2x1bW5hcyBkZWwgRXhjZWwgU2FsZXMgUGxhblwiPlBlZGlkbyA2bTwvdGg+JyArXHJcbiAgICAnPHRoIHN0eWxlPVwicGFkZGluZzo4cHggMTBweDt0ZXh0LWFsaWduOnJpZ2h0O2ZvbnQtc2l6ZToxMXB4O3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtsZXR0ZXItc3BhY2luZzouNHB4XCIgdGl0bGU9XCJWZW50YXMgWVREIC8gbWVzZXMgdHJhbnNjdXJyaWRvcyBkZWwgYVx1MDBGMW9cIj5Qcm9tIC8gTWVzPC90aD4nICtcclxuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjhweCAxMHB4O3RleHQtYWxpZ246cmlnaHQ7Zm9udC1zaXplOjExcHg7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO2xldHRlci1zcGFjaW5nOi40cHhcIiB0aXRsZT1cIlByb21lZGlvIHggMyBtZXNlcyAocG9saXRpY2EgZGUgaW52ZW50YXJpbylcIj5Qb2xpdGljYTwvdGg+JyArXHJcbiAgICAnPHRoIHN0eWxlPVwicGFkZGluZzo4cHggMTBweDt0ZXh0LWFsaWduOnJpZ2h0O2ZvbnQtc2l6ZToxMXB4O3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtsZXR0ZXItc3BhY2luZzouNHB4XCIgdGl0bGU9XCJQZWRpZG8gNm0gLSBQb2xpdGljYS4gTmVnYXRpdm8gPSB0ZSBmYWx0YSBwZWRpcjsgUG9zaXRpdm8gPSBzb2JyZXBlZGlkb1wiPlRvdGFsPC90aD4nICtcclxuICAgICc8L3RyPicgK1xyXG4gICAgJzwvdGhlYWQ+JztcclxuICBib2R5LmlubmVySFRNTCA9XHJcbiAgICAnPHRhYmxlIHN0eWxlPVwid2lkdGg6MTAwJTtib3JkZXItY29sbGFwc2U6Y29sbGFwc2U7Zm9udC1zaXplOjEycHhcIj4nICtcclxuICAgIGhlYWRlciArXHJcbiAgICAnPHRib2R5PicgK1xyXG4gICAgcm93c0h0bWwgK1xyXG4gICAgJzwvdGJvZHk+PC90YWJsZT4nO1xyXG59XHJcblxyXG5mdW5jdGlvbiBlc2NhcGVIdG1sU2FmZShzKSB7XHJcbiAgaWYgKHR5cGVvZiB3aW5kb3cuZXNjYXBlSHRtbCA9PT0gJ2Z1bmN0aW9uJykgcmV0dXJuIHdpbmRvdy5lc2NhcGVIdG1sKHMpO1xyXG4gIHJldHVybiBTdHJpbmcocyA9PSBudWxsID8gJycgOiBzKS5yZXBsYWNlKFxyXG4gICAgL1smPD5cIiddL2csXHJcbiAgICAoY2gpID0+ICh7ICcmJzogJyZhbXA7JywgJzwnOiAnJmx0OycsICc+JzogJyZndDsnLCAnXCInOiAnJnF1b3Q7JywgXCInXCI6ICcmIzM5OycgfSlbY2hdXHJcbiAgKTtcclxufVxyXG5cclxuZnVuY3Rpb24gX2J1aWxkU2FsZXNQbGFuU2xvdEh0bWwoZikge1xyXG4gIGNvbnN0IGNhY2hlID0gX3NhbGVzUGxhbkNhY2hlc1tmLmtleV07XHJcbiAgY29uc3Qgcm93c0NvdW50ID0gY2FjaGUgJiYgTnVtYmVyLmlzRmluaXRlKGNhY2hlLnJvd3NDb3VudCkgPyBjYWNoZS5yb3dzQ291bnQgOiAwO1xyXG4gIGNvbnN0IG1vbnRoc0NvdW50ID1cclxuICAgIGNhY2hlICYmIEFycmF5LmlzQXJyYXkoY2FjaGUuZGV0ZWN0ZWRNb250aHMpID8gY2FjaGUuZGV0ZWN0ZWRNb250aHMubGVuZ3RoIDogMDtcclxuICBjb25zdCBwYXJzZWRBdCA9IGNhY2hlICYmIGNhY2hlLnBhcnNlZEF0ID8gX2ZtdERhdGVTaG9ydChjYWNoZS5wYXJzZWRBdCkgOiAnJztcclxuICBjb25zdCB1cGxvYWRlZEJ5ID0gY2FjaGUgJiYgY2FjaGUudXBsb2FkZWRCeSA/IGNhY2hlLnVwbG9hZGVkQnkgOiAnJztcclxuICBjb25zdCBzb3VyY2VGaWxlbmFtZSA9IGNhY2hlICYmIGNhY2hlLnNvdXJjZUZpbGVuYW1lID8gY2FjaGUuc291cmNlRmlsZW5hbWUgOiAnJztcclxuICBjb25zdCB5ZWFyTW9udGggPSBjYWNoZSAmJiBjYWNoZS55ZWFyTW9udGggPyBjYWNoZS55ZWFyTW9udGggOiAnJztcclxuICBjb25zdCBtb250aHNSYW5nZSA9XHJcbiAgICBjYWNoZSAmJiBjYWNoZS5kZXRlY3RlZE1vbnRocyAmJiBjYWNoZS5kZXRlY3RlZE1vbnRocy5sZW5ndGhcclxuICAgICAgPyBjYWNoZS5kZXRlY3RlZE1vbnRoc1swXSArICcgXHUyMTkyICcgKyBjYWNoZS5kZXRlY3RlZE1vbnRoc1tjYWNoZS5kZXRlY3RlZE1vbnRocy5sZW5ndGggLSAxXVxyXG4gICAgICA6ICdcdTIwMTQnO1xyXG4gIGNvbnN0IGhhc0NhY2hlID0gISFjYWNoZTtcclxuICBjb25zdCBiYWRnZSA9IGhhc0NhY2hlXHJcbiAgICA/ICc8ZGl2IHN0eWxlPVwicGFkZGluZzo0cHggOHB4O2JhY2tncm91bmQ6IzE2YTM0YTtjb2xvcjojZmZmO2JvcmRlci1yYWRpdXM6MTJweDtmb250LXNpemU6MTBweDtmb250LXdlaWdodDo3MDA7bGV0dGVyLXNwYWNpbmc6LjRweFwiPkNBUkdBRE88L2Rpdj4nXHJcbiAgICA6ICc8ZGl2IHN0eWxlPVwicGFkZGluZzo0cHggOHB4O2JhY2tncm91bmQ6I2RjMjYyNjtjb2xvcjojZmZmO2JvcmRlci1yYWRpdXM6MTJweDtmb250LXNpemU6MTBweDtmb250LXdlaWdodDo3MDA7bGV0dGVyLXNwYWNpbmc6LjRweFwiPkZBTFRBPC9kaXY+JztcclxuICBjb25zdCBtZXRhQmxvY2sgPSBoYXNDYWNoZVxyXG4gICAgPyAnPGRpdiBzdHlsZT1cImRpc3BsYXk6Z3JpZDtncmlkLXRlbXBsYXRlLWNvbHVtbnM6YXV0byAxZnI7Z2FwOjZweCAxMnB4O2ZvbnQtc2l6ZToxMXB4O3BhZGRpbmc6MTBweCAxMnB4O2JhY2tncm91bmQ6dmFyKC0tYmctc2Vjb25kYXJ5KTtib3JkZXItcmFkaXVzOjZweFwiPicgK1xyXG4gICAgICAnPGRpdiBzdHlsZT1cImNvbG9yOnZhcigtLXRleHQtbXV0ZWQpO2ZvbnQtd2VpZ2h0OjYwMFwiPkFyY2hpdm88L2Rpdj48ZGl2IHN0eWxlPVwiY29sb3I6dmFyKC0tdGV4dC1wcmltYXJ5KTtmb250LWZhbWlseTptb25vc3BhY2U7d29yZC1icmVhazpicmVhay1hbGxcIj4nICtcclxuICAgICAgZXNjYXBlSHRtbFNhZmUoc291cmNlRmlsZW5hbWUpICtcclxuICAgICAgJzwvZGl2PicgK1xyXG4gICAgICAnPGRpdiBzdHlsZT1cImNvbG9yOnZhcigtLXRleHQtbXV0ZWQpO2ZvbnQtd2VpZ2h0OjYwMFwiPlN1YmlkbzwvZGl2PjxkaXYgc3R5bGU9XCJjb2xvcjp2YXIoLS10ZXh0LXByaW1hcnkpXCI+JyArXHJcbiAgICAgIGVzY2FwZUh0bWxTYWZlKHBhcnNlZEF0KSArXHJcbiAgICAgICc8L2Rpdj4nICtcclxuICAgICAgJzxkaXYgc3R5bGU9XCJjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTtmb250LXdlaWdodDo2MDBcIj5Qb3I8L2Rpdj48ZGl2IHN0eWxlPVwiY29sb3I6dmFyKC0tdGV4dC1wcmltYXJ5KVwiPicgK1xyXG4gICAgICBlc2NhcGVIdG1sU2FmZSh1cGxvYWRlZEJ5KSArXHJcbiAgICAgICc8L2Rpdj4nICtcclxuICAgICAgJzxkaXYgc3R5bGU9XCJjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTtmb250LXdlaWdodDo2MDBcIj5TbmFwc2hvdDwvZGl2PjxkaXYgc3R5bGU9XCJjb2xvcjp2YXIoLS10ZXh0LXByaW1hcnkpO2ZvbnQtZmFtaWx5Om1vbm9zcGFjZVwiPicgK1xyXG4gICAgICBlc2NhcGVIdG1sU2FmZSh5ZWFyTW9udGgpICtcclxuICAgICAgJzwvZGl2PicgK1xyXG4gICAgICAnPGRpdiBzdHlsZT1cImNvbG9yOnZhcigtLXRleHQtbXV0ZWQpO2ZvbnQtd2VpZ2h0OjYwMFwiPlNLVXM8L2Rpdj48ZGl2IHN0eWxlPVwiY29sb3I6dmFyKC0tdGV4dC1wcmltYXJ5KTtmb250LXdlaWdodDo3MDBcIj4nICtcclxuICAgICAgcm93c0NvdW50LnRvTG9jYWxlU3RyaW5nKCdlcy1BUicpICtcclxuICAgICAgJzwvZGl2PicgK1xyXG4gICAgICAnPGRpdiBzdHlsZT1cImNvbG9yOnZhcigtLXRleHQtbXV0ZWQpO2ZvbnQtd2VpZ2h0OjYwMFwiPk1lc2VzPC9kaXY+PGRpdiBzdHlsZT1cImNvbG9yOnZhcigtLXRleHQtcHJpbWFyeSk7Zm9udC13ZWlnaHQ6NzAwXCI+JyArXHJcbiAgICAgIG1vbnRoc0NvdW50ICtcclxuICAgICAgJyA8c3BhbiBzdHlsZT1cImNvbG9yOnZhcigtLXRleHQtbXV0ZWQpO2ZvbnQtd2VpZ2h0OjQwMFwiPignICtcclxuICAgICAgZXNjYXBlSHRtbFNhZmUobW9udGhzUmFuZ2UpICtcclxuICAgICAgJyk8L3NwYW4+PC9kaXY+JyArXHJcbiAgICAgICc8L2Rpdj4nXHJcbiAgICA6ICc8ZGl2IHN0eWxlPVwicGFkZGluZzoxNHB4O3RleHQtYWxpZ246Y2VudGVyO2ZvbnQtc2l6ZToxMnB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO2JhY2tncm91bmQ6dmFyKC0tYmctc2Vjb25kYXJ5KTtib3JkZXItcmFkaXVzOjZweDtib3JkZXI6MXB4IGRhc2hlZCB2YXIoLS1ib3JkZXItc3VidGxlKVwiPkF1biBubyBzdWJpc3RlIGVsIFNhbGVzIFBsYW4gZGUgZXN0YSBmYW1pbGlhLjwvZGl2Pic7XHJcbiAgY29uc3QgdXBsb2FkQnRuID1cclxuICAgICc8bGFiZWwgc3R5bGU9XCJkaXNwbGF5OmlubGluZS1mbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtqdXN0aWZ5LWNvbnRlbnQ6Y2VudGVyO2dhcDo4cHg7cGFkZGluZzoxMHB4IDE0cHg7YmFja2dyb3VuZDonICtcclxuICAgIGYuY29sb3IgK1xyXG4gICAgJztjb2xvcjojZmZmO2JvcmRlci1yYWRpdXM6NnB4O2ZvbnQtd2VpZ2h0OjcwMDtmb250LXNpemU6MTJweDtjdXJzb3I6cG9pbnRlcjtsZXR0ZXItc3BhY2luZzouNHB4XCI+JyArXHJcbiAgICAnPHNwYW4+JyArXHJcbiAgICAoaGFzQ2FjaGUgPyAnXHUyMUJCIFJlZW1wbGF6YXIgRXhjZWwnIDogJ1x1MkIwNiBDYXJnYXIgRXhjZWwnKSArXHJcbiAgICAnPC9zcGFuPicgK1xyXG4gICAgJzxpbnB1dCB0eXBlPVwiZmlsZVwiIGFjY2VwdD1cIi54bHN4LC54bHNcIiBkYXRhLWZhbWlsaWE9XCInICtcclxuICAgIGYua2V5ICtcclxuICAgICdcIiBzdHlsZT1cImRpc3BsYXk6bm9uZVwiIG9uY2hhbmdlPVwib25TYWxlc1BsYW5GaWxlRm9yRmFtaWxpYShldmVudCwgXFwnJyArXHJcbiAgICBmLmtleSArXHJcbiAgICAnXFwnKVwiLz4nICtcclxuICAgICc8L2xhYmVsPic7XHJcbiAgY29uc3QgY2FyZEhlYWQgPVxyXG4gICAgJzxkaXYgc3R5bGU9XCJkaXNwbGF5OmZsZXg7YWxpZ24taXRlbXM6Y2VudGVyO2dhcDoxMHB4XCI+JyArXHJcbiAgICAnPGRpdiBzdHlsZT1cIndpZHRoOjEycHg7aGVpZ2h0OjMycHg7YmFja2dyb3VuZDonICtcclxuICAgIGYuY29sb3IgK1xyXG4gICAgJztib3JkZXItcmFkaXVzOjNweFwiPjwvZGl2PicgK1xyXG4gICAgJzxkaXYgc3R5bGU9XCJmbGV4OjFcIj48ZGl2IHN0eWxlPVwiZm9udC1zaXplOjE0cHg7Zm9udC13ZWlnaHQ6ODAwO2NvbG9yOnZhcigtLXRleHQtcHJpbWFyeSlcIj4nICtcclxuICAgIGVzY2FwZUh0bWxTYWZlKGYubGFiZWwpICtcclxuICAgICc8L2Rpdj4nICtcclxuICAgICc8ZGl2IHN0eWxlPVwiZm9udC1zaXplOjExcHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7bWFyZ2luLXRvcDoycHhcIj5TYWxlcyBQbGFuIG1lbnN1YWwgXHUwMEI3IEhvamEgU0FSPC9kaXY+PC9kaXY+JyArXHJcbiAgICBiYWRnZSArXHJcbiAgICAnPC9kaXY+JztcclxuICByZXR1cm4gKFxyXG4gICAgJzxkaXYgc3R5bGU9XCJiYWNrZ3JvdW5kOnZhcigtLWJnLWVsZXZhdGVkKTtib3JkZXI6MXB4IHNvbGlkIHZhcigtLWJvcmRlci1zdWJ0bGUpO2JvcmRlci1yYWRpdXM6MTBweDtwYWRkaW5nOjE2cHg7ZGlzcGxheTpmbGV4O2ZsZXgtZGlyZWN0aW9uOmNvbHVtbjtnYXA6MTJweFwiPicgK1xyXG4gICAgY2FyZEhlYWQgK1xyXG4gICAgbWV0YUJsb2NrICtcclxuICAgIHVwbG9hZEJ0biArXHJcbiAgICAnPGRpdiBpZD1cInNhbGVzLXBsYW4tc3RhdHVzLScgK1xyXG4gICAgZi5rZXkgK1xyXG4gICAgJ1wiIHN0eWxlPVwiZm9udC1zaXplOjExcHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7bWluLWhlaWdodDoxNHB4XCI+PC9kaXY+JyArXHJcbiAgICAnPC9kaXY+J1xyXG4gICk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIF9yZW5kZXJTYWxlc1BsYW5zVGFiKCkge1xyXG4gIGNvbnN0IGNvbnQgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZm9yZWNhc3QtdGFiLXNhbGVzLXBsYW5zJyk7XHJcbiAgaWYgKCFjb250KSByZXR1cm47XHJcbiAgY29uc3Qgc2xvdHMgPSBTQUxFU19QTEFOX0ZBTUlMSUFTLm1hcChfYnVpbGRTYWxlc1BsYW5TbG90SHRtbCkuam9pbignJyk7XHJcbiAgY29uc3QgaW50cm8gPVxyXG4gICAgJzxkaXYgc3R5bGU9XCJtYXJnaW4tYm90dG9tOjE2cHg7cGFkZGluZzoxMnB4IDE0cHg7YmFja2dyb3VuZDp2YXIoLS1iZy1zZWNvbmRhcnkpO2JvcmRlci1sZWZ0OjNweCBzb2xpZCAjMGQ5NDg4O2JvcmRlci1yYWRpdXM6NnB4O2ZvbnQtc2l6ZToxMnB4O2NvbG9yOnZhcigtLXRleHQtc2Vjb25kYXJ5KTtsaW5lLWhlaWdodDoxLjVcIj4nICtcclxuICAgICc8YiBzdHlsZT1cImNvbG9yOnZhcigtLXRleHQtcHJpbWFyeSlcIj5GYXNlIDE8L2I+IFx1MjAxNCBDYXJnXHUwMEUxIGxvcyAzIFNhbGVzIFBsYW5zIG1lbnN1YWxlcyAoUm9kcyAvIFJlZWxzIC8gRkcpLiBTZSBwYXJzZWEgbGEgaG9qYSA8Yj5TQVI8L2I+OiBTS1UsIE1PUSAxMiBtb250aHMsIHkgdW5hIGNvbHVtbmEgcG9yIG1lcy4gJyArXHJcbiAgICAnRWwgRXhjZWwgb3JpZ2luYWwgcXVlZGEgc25hcHNob3RhZG8gZW4gU3RvcmFnZSB5IGVsIHBhcnNlbyBxdWVkYSBlbiBGaXJlc3RvcmUgcGFyYSBlbCBjXHUwMEUxbGN1bG8gKHByXHUwMEYzeGltYSBmYXNlKS4nICtcclxuICAgICc8L2Rpdj4nO1xyXG4gIGNvbnN0IGdyaWQgPVxyXG4gICAgJzxkaXYgc3R5bGU9XCJkaXNwbGF5OmdyaWQ7Z3JpZC10ZW1wbGF0ZS1jb2x1bW5zOnJlcGVhdChhdXRvLWZpdCxtaW5tYXgoMzIwcHgsMWZyKSk7Z2FwOjE2cHhcIj4nICtcclxuICAgIHNsb3RzICtcclxuICAgICc8L2Rpdj4nO1xyXG4gIGNvbnQuaW5uZXJIVE1MID0gJzxkaXYgc3R5bGU9XCJwYWRkaW5nOjE4cHhcIj4nICsgaW50cm8gKyBncmlkICsgJzwvZGl2Pic7XHJcbn1cclxuXHJcbndpbmRvdy5vblNhbGVzUGxhbkZpbGVGb3JGYW1pbGlhID0gYXN5bmMgZnVuY3Rpb24gKGV2ZW50LCBmYW1pbGlhKSB7XHJcbiAgY29uc3QgZmlsZSA9IGV2ZW50ICYmIGV2ZW50LnRhcmdldCAmJiBldmVudC50YXJnZXQuZmlsZXMgJiYgZXZlbnQudGFyZ2V0LmZpbGVzWzBdO1xyXG4gIGlmICghZmlsZSkgcmV0dXJuO1xyXG4gIGNvbnN0IHN0YXR1c0VsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3NhbGVzLXBsYW4tc3RhdHVzLScgKyBmYW1pbGlhKTtcclxuICBjb25zdCBzZXRTdGF0dXMgPSAobXNnLCBjb2xvcikgPT4ge1xyXG4gICAgaWYgKCFzdGF0dXNFbCkgcmV0dXJuO1xyXG4gICAgc3RhdHVzRWwudGV4dENvbnRlbnQgPSBtc2c7XHJcbiAgICBzdGF0dXNFbC5zdHlsZS5jb2xvciA9IGNvbG9yIHx8ICd2YXIoLS10ZXh0LW11dGVkKSc7XHJcbiAgfTtcclxuICB0cnkge1xyXG4gICAgaWYgKHR5cGVvZiBYTFNYID09PSAndW5kZWZpbmVkJykge1xyXG4gICAgICBhbGVydCgnU2hlZXRKUyAoWExTWCkgbm8gY2FyZ2FkbyBcdTIwMTQgcmVjYXJnXHUwMEUxIGxhIGFwcC4nKTtcclxuICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG4gICAgaWYgKCF3aW5kb3cuU2FsZXNQbGFuUGFyc2VyIHx8ICF3aW5kb3cuU2FsZXNQbGFuUGFyc2VyLnBhcnNlU2FsZXNQbGFuU2hlZXQpIHtcclxuICAgICAgYWxlcnQoJ1BhcnNlciBTYWxlcyBQbGFuIG5vIGNhcmdhZG8uIFJlYnVpbGQgYnVuZGxlLicpO1xyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcbiAgICBpZiAoIXdpbmRvdy5maXJlYmFzZSB8fCAhd2luZG93LmZpcmViYXNlLnN0b3JhZ2UpIHtcclxuICAgICAgYWxlcnQoJ0ZpcmViYXNlIFN0b3JhZ2Ugbm8gZGlzcG9uaWJsZS4nKTtcclxuICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG4gICAgc2V0U3RhdHVzKCdMZXllbmRvIEV4Y2VsXHUyMDI2Jyk7XHJcbiAgICBjb25zdCBidWYgPSBhd2FpdCBmaWxlLmFycmF5QnVmZmVyKCk7XHJcbiAgICBjb25zdCB3YiA9IFhMU1gucmVhZChidWYsIHsgdHlwZTogJ2FycmF5JyB9KTtcclxuICAgIGNvbnN0IHNhck5hbWUgPSB3Yi5TaGVldE5hbWVzLmZpbmQoXHJcbiAgICAgIChuKSA9PlxyXG4gICAgICAgIFN0cmluZyhuIHx8ICcnKVxyXG4gICAgICAgICAgLnRyaW0oKVxyXG4gICAgICAgICAgLnRvVXBwZXJDYXNlKCkgPT09ICdTQVInXHJcbiAgICApO1xyXG4gICAgaWYgKCFzYXJOYW1lKSB7XHJcbiAgICAgIHNldFN0YXR1cyhcclxuICAgICAgICAnXHUyNkEwIEVsIEV4Y2VsIG5vIHRpZW5lIGhvamEgXCJTQVJcIi4gSG9qYXMgZW5jb250cmFkYXM6ICcgKyB3Yi5TaGVldE5hbWVzLmpvaW4oJywgJyksXHJcbiAgICAgICAgJyNkYzI2MjYnXHJcbiAgICAgICk7XHJcbiAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIGNvbnN0IHNoZWV0ID0gd2IuU2hlZXRzW3Nhck5hbWVdO1xyXG4gICAgY29uc3Qgcm93cyA9IFhMU1gudXRpbHMuc2hlZXRfdG9fanNvbihzaGVldCwgeyBoZWFkZXI6IDEsIGRlZnZhbDogJycsIHJhdzogdHJ1ZSB9KTtcclxuICAgIHNldFN0YXR1cygnUGFyc2VhbmRvICcgKyByb3dzLmxlbmd0aCArICcgZmlsYXMgZGUgaG9qYSBcIicgKyBzYXJOYW1lICsgJ1wiXHUyMDI2Jyk7XHJcbiAgICBjb25zdCBwYXJzZWQgPSB3aW5kb3cuU2FsZXNQbGFuUGFyc2VyLnBhcnNlU2FsZXNQbGFuU2hlZXQocm93cyk7XHJcbiAgICBpZiAoIXBhcnNlZC5yb3dzLmxlbmd0aCkge1xyXG4gICAgICBzZXRTdGF0dXMoJ1x1MjZBMCBFeGNlbCBwYXJzZWFkbyBwZXJvIHNpbiBTS1VzIHZcdTAwRTFsaWRvcy4nLCAnI2RjMjYyNicpO1xyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcbiAgICBjb25zdCB5ZWFyTW9udGggPSBfeWVhck1vbnRoTm93KCk7XHJcbiAgICBjb25zdCBzdG9yYWdlUGF0aCA9ICdmb3JlY2FzdHNfc25hcHNob3RzLycgKyB5ZWFyTW9udGggKyAnLycgKyBmYW1pbGlhICsgJy54bHN4JztcclxuICAgIHNldFN0YXR1cygnU3ViaWVuZG8gRXhjZWwgYSBTdG9yYWdlICgnICsgX2ZtdFNpemUoZmlsZS5zaXplKSArICcpXHUyMDI2Jyk7XHJcbiAgICBjb25zdCBzdG9yYWdlUmVmID0gd2luZG93LmZpcmViYXNlLnN0b3JhZ2UoKS5yZWYoc3RvcmFnZVBhdGgpO1xyXG4gICAgYXdhaXQgc3RvcmFnZVJlZi5wdXQoZmlsZSwge1xyXG4gICAgICBjb250ZW50VHlwZTogZmlsZS50eXBlIHx8ICdhcHBsaWNhdGlvbi92bmQub3BlbnhtbGZvcm1hdHMtb2ZmaWNlZG9jdW1lbnQuc3ByZWFkc2hlZXRtbC5zaGVldCcsXHJcbiAgICAgIGN1c3RvbU1ldGFkYXRhOiB7XHJcbiAgICAgICAgZmFtaWxpYSxcclxuICAgICAgICB1cGxvYWRlZEJ5OiAod2luZG93LmN1cnJlbnRVc2VyICYmIHdpbmRvdy5jdXJyZW50VXNlci5lbWFpbCkgfHwgJycsXHJcbiAgICAgICAgc291cmNlRmlsZW5hbWU6IGZpbGUubmFtZSB8fCAnJyxcclxuICAgICAgfSxcclxuICAgIH0pO1xyXG4gICAgc2V0U3RhdHVzKCdHdWFyZGFuZG8gcGFyc2VvIGVuIEZpcmVzdG9yZSAoJyArIHBhcnNlZC5yb3dzLmxlbmd0aCArICcgU0tVcylcdTIwMjYnKTtcclxuICAgIGNvbnN0IHVwbG9hZGVkQnkgPSAod2luZG93LmN1cnJlbnRVc2VyICYmIHdpbmRvdy5jdXJyZW50VXNlci5lbWFpbCkgfHwgJ3Vua25vd24nO1xyXG4gICAgY29uc3QgcGF5bG9hZCA9IHtcclxuICAgICAgZmFtaWxpYSxcclxuICAgICAgcGFyc2VkQXQ6XHJcbiAgICAgICAgd2luZG93LmZpcmViYXNlICYmIHdpbmRvdy5maXJlYmFzZS5maXJlc3RvcmUgJiYgd2luZG93LmZpcmViYXNlLmZpcmVzdG9yZS5GaWVsZFZhbHVlXHJcbiAgICAgICAgICA/IHdpbmRvdy5maXJlYmFzZS5maXJlc3RvcmUuRmllbGRWYWx1ZS5zZXJ2ZXJUaW1lc3RhbXAoKVxyXG4gICAgICAgICAgOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXHJcbiAgICAgIHVwbG9hZGVkQnksXHJcbiAgICAgIHNvdXJjZUZpbGVuYW1lOiBmaWxlLm5hbWUgfHwgJycsXHJcbiAgICAgIHNvdXJjZVNoZWV0OiBzYXJOYW1lLFxyXG4gICAgICB5ZWFyTW9udGgsXHJcbiAgICAgIHN0b3JhZ2VQYXRoLFxyXG4gICAgICByb3dzQ291bnQ6IHBhcnNlZC5yb3dzLmxlbmd0aCxcclxuICAgICAgaGVhZGVyUm93SW5kZXg6IHBhcnNlZC5oZWFkZXJSb3dJbmRleCxcclxuICAgICAgZGV0ZWN0ZWRNb250aHM6IHBhcnNlZC5kZXRlY3RlZE1vbnRocyxcclxuICAgICAgcm93czogcGFyc2VkLnJvd3MsXHJcbiAgICB9O1xyXG4gICAgYXdhaXQgd2luZG93LmZiRGIuY29sbGVjdGlvbignc2FsZXNfcGxhbl9jYWNoZScpLmRvYyhmYW1pbGlhKS5zZXQocGF5bG9hZCk7XHJcbiAgICBfc2FsZXNQbGFuQ2FjaGVzW2ZhbWlsaWFdID0gcGF5bG9hZDtcclxuICAgIHNldFN0YXR1cyhcclxuICAgICAgJ1x1MjcxMyBPSy4gJyArIHBhcnNlZC5yb3dzLmxlbmd0aCArICcgU0tVcyBcdTAwRDcgJyArIHBhcnNlZC5kZXRlY3RlZE1vbnRocy5sZW5ndGggKyAnIG1lc2VzLicsXHJcbiAgICAgICcjMTZhMzRhJ1xyXG4gICAgKTtcclxuICAgIF9yZW5kZXJTYWxlc1BsYW5zVGFiKCk7XHJcbiAgfSBjYXRjaCAoZSkge1xyXG4gICAgY29uc29sZS5lcnJvcignW0ZPUkVDQVNUXSB1cGxvYWQgc2FsZXMgcGxhbiAnICsgZmFtaWxpYSArICcgZmFpbDonLCBlKTtcclxuICAgIHNldFN0YXR1cygnXHUyNzE3IEVycm9yOiAnICsgKChlICYmIGUubWVzc2FnZSkgfHwgZSksICcjZGMyNjI2Jyk7XHJcbiAgICBpZiAoZSAmJiBlLmNvZGUgPT09ICdNT05USFNfTk9UX0ZPVU5EJykge1xyXG4gICAgICBhbGVydChcclxuICAgICAgICAnRWwgRXhjZWwgbm8gdGllbmUgY29sdW1uYXMgZGUgbWVzZXMgcmVjb25vY2libGVzLlxcblxcbkhlYWRlcnMgZXNwZXJhZG9zOiBcIkphbiAyMDI3XCIsIFwiTWF5IDIwMjdcIiwgXCJFbmUgMjAyN1wiLCBcIjIwMjctMDFcIiwgZXRjLlxcblxcbkRldGFsbGU6ICcgK1xyXG4gICAgICAgICAgZS5tZXNzYWdlXHJcbiAgICAgICk7XHJcbiAgICB9XHJcbiAgfSBmaW5hbGx5IHtcclxuICAgIGlmIChldmVudCAmJiBldmVudC50YXJnZXQpIGV2ZW50LnRhcmdldC52YWx1ZSA9ICcnO1xyXG4gIH1cclxufTtcclxuXHJcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG4vLyBGMkIgXHUyMDE0IEZvcmVjYXN0IEVzdGFkXHUwMEVEc3RpY286IHRhYmxhICsgZGV0YWxsZVxyXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHJcbmFzeW5jIGZ1bmN0aW9uIF9sb2FkRm9yZWNhc3RPdXRwdXQoKSB7XHJcbiAgaWYgKCF3aW5kb3cuZmJEYikgdGhyb3cgbmV3IEVycm9yKCdGaXJlc3RvcmUgbm8gaW5pY2lhbGl6YWRvJyk7XHJcbiAgY29uc3QgW3NuYXAsIG1ldGFEb2NdID0gYXdhaXQgUHJvbWlzZS5hbGwoW1xyXG4gICAgd2luZG93LmZiRGIuY29sbGVjdGlvbignZm9yZWNhc3Rfb3V0cHV0JykuZ2V0KCksXHJcbiAgICB3aW5kb3cuZmJEYi5jb2xsZWN0aW9uKCdmb3JlY2FzdF9vdXRwdXRfbWV0YScpLmRvYygnY3VycmVudCcpLmdldCgpLFxyXG4gIF0pO1xyXG4gIGNvbnN0IGRvY3MgPSBbXTtcclxuICBzbmFwLmZvckVhY2goKGQpID0+IGRvY3MucHVzaChPYmplY3QuYXNzaWduKHsgaWQ6IGQuaWQgfSwgZC5kYXRhKCkpKSk7XHJcbiAgZG9jcy5zb3J0KChhLCBiKSA9PiB7XHJcbiAgICBjb25zdCB3YSA9IChhLm1ldHJpY3MgJiYgYS5tZXRyaWNzLndhcGUpIHx8IDk5OTtcclxuICAgIGNvbnN0IHdiID0gKGIubWV0cmljcyAmJiBiLm1ldHJpY3Mud2FwZSkgfHwgOTk5O1xyXG4gICAgcmV0dXJuIHdhIC0gd2I7XHJcbiAgfSk7XHJcbiAgX2ZvcmVjYXN0U3RhdERvY3MgPSBkb2NzO1xyXG4gIF9mb3JlY2FzdFN0YXRNZXRhID0gbWV0YURvYy5leGlzdHMgPyBtZXRhRG9jLmRhdGEoKSA6IG51bGw7XHJcbiAgcmV0dXJuIGRvY3M7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIF93YXBlQmFkZ2VDb2xvcih3KSB7XHJcbiAgaWYgKHcgPT0gbnVsbCkgcmV0dXJuICcjNjQ3NDhiJztcclxuICBpZiAodyA8IDAuMykgcmV0dXJuICcjMTZhMzRhJzsgLy8gdmVyZGUgLSBleGNlbGVudGVcclxuICBpZiAodyA8IDAuNSkgcmV0dXJuICcjODRjYzE2JzsgLy8gbGltYSAtIGJ1ZW5vXHJcbiAgaWYgKHcgPCAwLjcpIHJldHVybiAnI2VhYjMwOCc7IC8vIGFtYXJpbGxvIC0gYWNlcHRhYmxlXHJcbiAgaWYgKHcgPCAxLjApIHJldHVybiAnI2Y5NzMxNic7IC8vIG5hcmFuamEgLSBwb2JyZVxyXG4gIHJldHVybiAnI2RjMjYyNic7IC8vIHJvam8gLSBtdXkgcG9icmVcclxufVxyXG5cclxuZnVuY3Rpb24gX2ZtdE51bShuKSB7XHJcbiAgaWYgKG4gPT0gbnVsbCB8fCAhTnVtYmVyLmlzRmluaXRlKE51bWJlcihuKSkpIHJldHVybiAnXHUyMDE0JztcclxuICByZXR1cm4gTnVtYmVyKG4pLnRvTG9jYWxlU3RyaW5nKCdlcy1BUicsIHsgbWF4aW11bUZyYWN0aW9uRGlnaXRzOiAwIH0pO1xyXG59XHJcblxyXG5mdW5jdGlvbiBfZm10V2FwZSh3KSB7XHJcbiAgaWYgKHcgPT0gbnVsbCB8fCAhTnVtYmVyLmlzRmluaXRlKE51bWJlcih3KSkpIHJldHVybiAnXHUyMDE0JztcclxuICByZXR1cm4gKE51bWJlcih3KSAqIDEwMCkudG9GaXhlZCgwKSArICclJztcclxufVxyXG5cclxuZnVuY3Rpb24gX2ZtdERzU2hvcnQoaXNvKSB7XHJcbiAgLy8gJzIwMjYtMTAtMDEnIC0+ICdvY3QgMjYnXHJcbiAgdHJ5IHtcclxuICAgIGNvbnN0IFt5LCBtXSA9IGlzby5zcGxpdCgnLScpLm1hcChOdW1iZXIpO1xyXG4gICAgY29uc3QgbmFtZXMgPSBbXHJcbiAgICAgICdlbmUnLFxyXG4gICAgICAnZmViJyxcclxuICAgICAgJ21hcicsXHJcbiAgICAgICdhYnInLFxyXG4gICAgICAnbWF5JyxcclxuICAgICAgJ2p1bicsXHJcbiAgICAgICdqdWwnLFxyXG4gICAgICAnYWdvJyxcclxuICAgICAgJ3NlcCcsXHJcbiAgICAgICdvY3QnLFxyXG4gICAgICAnbm92JyxcclxuICAgICAgJ2RpYycsXHJcbiAgICBdO1xyXG4gICAgcmV0dXJuIG5hbWVzW20gLSAxXSArICcgJyArIFN0cmluZyh5KS5zbGljZSgtMik7XHJcbiAgfSBjYXRjaCB7XHJcbiAgICByZXR1cm4gaXNvO1xyXG4gIH1cclxufVxyXG5cclxuZnVuY3Rpb24gX3JlbmRlckZvcmVjYXN0U3RhdFRhYigpIHtcclxuICBjb25zdCBjb250ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2ZvcmVjYXN0LXRhYi1zdGF0Jyk7XHJcbiAgaWYgKCFjb250KSByZXR1cm47XHJcbiAgY29uc3QgZG9jcyA9IF9mb3JlY2FzdFN0YXREb2NzIHx8IFtdO1xyXG4gIGNvbnN0IG1ldGEgPSBfZm9yZWNhc3RTdGF0TWV0YSB8fCB7fTtcclxuICBjb25zdCByZXN1bWVuID0gbWV0YS5yZXN1bWVuIHx8IHt9O1xyXG4gIGlmICghZG9jcy5sZW5ndGgpIHtcclxuICAgIGNvbnQuaW5uZXJIVE1MID1cclxuICAgICAgJzxkaXYgc3R5bGU9XCJwYWRkaW5nOjYwcHggMjBweDt0ZXh0LWFsaWduOmNlbnRlcjtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKVwiPicgK1xyXG4gICAgICAnTm8gaGF5IGZvcmVjYXN0X291dHB1dCBwdWJsaWNhZG8uPGJyPjxicj4nICtcclxuICAgICAgJ0NvcnJlciA8Y29kZT5weXRob24gc2NyaXB0cy9mb3JlY2FzdC90cmFpbl9wcm9kLnB5ICYmIHB5dGhvbiBzY3JpcHRzL2ZvcmVjYXN0L3B1Ymxpc2hfdG9fZmlyZXN0b3JlLnB5PC9jb2RlPi4nICtcclxuICAgICAgJzwvZGl2Pic7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIC8vIE1lc2VzIGRlbCBmb3JlY2FzdCAoZHMgZGVsIHByaW1lciBkb2MsIHNlIGFzdW1lIGlndWFsIGVuIHRvZG9zKS5cclxuICBjb25zdCBtb250aHNJc28gPSAoZG9jc1swXS5mb3JlY2FzdCB8fCBbXSkubWFwKChmKSA9PiBmLmRzKTtcclxuICBjb25zdCBtb250aEhlYWRlcnMgPSBtb250aHNJc28ubWFwKF9mbXREc1Nob3J0KTtcclxuXHJcbiAgLy8gTWV0cmljcyBjaGlwIGdsb2JhbFxyXG4gIGNvbnN0IGdlbmVyYXRlZCA9IG1ldGEuZ2VuZXJhdGVkQXRcclxuICAgID8gbmV3IERhdGUobWV0YS5nZW5lcmF0ZWRBdCkudG9Mb2NhbGVTdHJpbmcoJ2VzLUFSJywge1xyXG4gICAgICAgIGRheTogJzItZGlnaXQnLFxyXG4gICAgICAgIG1vbnRoOiAnc2hvcnQnLFxyXG4gICAgICAgIHllYXI6ICcyLWRpZ2l0JyxcclxuICAgICAgICBob3VyOiAnMi1kaWdpdCcsXHJcbiAgICAgICAgbWludXRlOiAnMi1kaWdpdCcsXHJcbiAgICAgIH0pXHJcbiAgICA6ICdcdTIwMTQnO1xyXG4gIGNvbnN0IHdhcGVNZWQgPVxyXG4gICAgcmVzdW1lbi53YXBlX21lZGlhbm9fYmVzdF9wZXJfc2VyaWVzICE9IG51bGxcclxuICAgICAgPyBfZm10V2FwZShyZXN1bWVuLndhcGVfbWVkaWFub19iZXN0X3Blcl9zZXJpZXMpXHJcbiAgICAgIDogJ1x1MjAxNCc7XHJcbiAgY29uc3QgblN1YnMgPSByZXN1bWVuLm5fc3ViZmFtaWxpYXMgfHwgZG9jcy5sZW5ndGg7XHJcbiAgY29uc3Qgbkx0MDUgPVxyXG4gICAgcmVzdW1lbi5uX3Nlcmllc193YXBlX2x0XzBfNSAhPSBudWxsID8gcmVzdW1lbi5uX3Nlcmllc193YXBlX2x0XzBfNSArICcvJyArIG5TdWJzIDogJ1x1MjAxNCc7XHJcbiAgY29uc3Qgbkx0MDMgPVxyXG4gICAgcmVzdW1lbi5uX3Nlcmllc193YXBlX2x0XzBfMyAhPSBudWxsID8gcmVzdW1lbi5uX3Nlcmllc193YXBlX2x0XzBfMyArICcvJyArIG5TdWJzIDogJ1x1MjAxNCc7XHJcblxyXG4gIGNvbnN0IGJhbm5lciA9XHJcbiAgICAnPGRpdiBzdHlsZT1cIm1hcmdpbi1ib3R0b206MTRweDtwYWRkaW5nOjEycHggMTRweDtiYWNrZ3JvdW5kOnZhcigtLWJnLXNlY29uZGFyeSk7Ym9yZGVyLWxlZnQ6M3B4IHNvbGlkICMwZDk0ODg7Ym9yZGVyLXJhZGl1czo2cHg7Zm9udC1zaXplOjEycHg7Y29sb3I6dmFyKC0tdGV4dC1zZWNvbmRhcnkpO2xpbmUtaGVpZ2h0OjEuNTtkaXNwbGF5OmdyaWQ7Z3JpZC10ZW1wbGF0ZS1jb2x1bW5zOnJlcGVhdChhdXRvLWZpdCxtaW5tYXgoMTYwcHgsMWZyKSk7Z2FwOjEwcHhcIj4nICtcclxuICAgICc8ZGl2PjxkaXYgc3R5bGU9XCJmb250LXNpemU6MTBweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7bGV0dGVyLXNwYWNpbmc6LjRweFwiPldBUEUgbWVkaWFubzwvZGl2PjxkaXYgc3R5bGU9XCJmb250LXNpemU6MjBweDtmb250LXdlaWdodDo4MDA7Y29sb3I6dmFyKC0tdGV4dC1wcmltYXJ5KVwiPicgK1xyXG4gICAgd2FwZU1lZCArXHJcbiAgICAnPC9kaXY+PC9kaXY+JyArXHJcbiAgICAnPGRpdj48ZGl2IHN0eWxlPVwiZm9udC1zaXplOjEwcHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO2xldHRlci1zcGFjaW5nOi40cHhcIj5TdWJmYW1pbGlhczwvZGl2PjxkaXYgc3R5bGU9XCJmb250LXNpemU6MjBweDtmb250LXdlaWdodDo4MDA7Y29sb3I6dmFyKC0tdGV4dC1wcmltYXJ5KVwiPicgK1xyXG4gICAgblN1YnMgK1xyXG4gICAgJzwvZGl2PjwvZGl2PicgK1xyXG4gICAgJzxkaXY+PGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMHB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtsZXR0ZXItc3BhY2luZzouNHB4XCI+V0FQRSAmbHQ7IDMwJSAoZXhjZWxlbnRlKTwvZGl2PjxkaXYgc3R5bGU9XCJmb250LXNpemU6MjBweDtmb250LXdlaWdodDo4MDA7Y29sb3I6IzE2YTM0YVwiPicgK1xyXG4gICAgbkx0MDMgK1xyXG4gICAgJzwvZGl2PjwvZGl2PicgK1xyXG4gICAgJzxkaXY+PGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMHB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtsZXR0ZXItc3BhY2luZzouNHB4XCI+V0FQRSAmbHQ7IDUwJSAoYnVlbm8pPC9kaXY+PGRpdiBzdHlsZT1cImZvbnQtc2l6ZToyMHB4O2ZvbnQtd2VpZ2h0OjgwMDtjb2xvcjojODRjYzE2XCI+JyArXHJcbiAgICBuTHQwNSArXHJcbiAgICAnPC9kaXY+PC9kaXY+JyArXHJcbiAgICAnPGRpdj48ZGl2IHN0eWxlPVwiZm9udC1zaXplOjEwcHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO2xldHRlci1zcGFjaW5nOi40cHhcIj5cdTAwREFsdGltYSBjb3JyaWRhPC9kaXY+PGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxM3B4O2ZvbnQtd2VpZ2h0OjYwMDtjb2xvcjp2YXIoLS10ZXh0LXByaW1hcnkpO21hcmdpbi10b3A6NHB4XCI+JyArXHJcbiAgICBlc2NhcGVIdG1sU2FmZShnZW5lcmF0ZWQpICtcclxuICAgICc8L2Rpdj48L2Rpdj4nICtcclxuICAgICc8L2Rpdj4nO1xyXG5cclxuICAvLyBUYWJsYSByb3dzXHJcbiAgY29uc3Qgcm93c0h0bWwgPSBkb2NzXHJcbiAgICAubWFwKChkKSA9PiB7XHJcbiAgICAgIGNvbnN0IHdhcGUgPSBkLm1ldHJpY3MgJiYgZC5tZXRyaWNzLndhcGUgIT0gbnVsbCA/IGQubWV0cmljcy53YXBlIDogbnVsbDtcclxuICAgICAgY29uc3QgYmVzdE1vZGVsID0gZC5iZXN0TW9kZWwgfHwgJ1x1MjAxNCc7XHJcbiAgICAgIGNvbnN0IGZvcmVjYXN0TWFwID0ge307XHJcbiAgICAgIChkLmZvcmVjYXN0IHx8IFtdKS5mb3JFYWNoKChmKSA9PiB7XHJcbiAgICAgICAgZm9yZWNhc3RNYXBbZi5kc10gPSBmLnlfaGF0O1xyXG4gICAgICB9KTtcclxuICAgICAgY29uc3QgbW9udGhDZWxscyA9IG1vbnRoc0lzb1xyXG4gICAgICAgIC5tYXAoXHJcbiAgICAgICAgICAoZHMpID0+XHJcbiAgICAgICAgICAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjhweCAxMHB4O3RleHQtYWxpZ246cmlnaHQ7Zm9udC12YXJpYW50LW51bWVyaWM6dGFidWxhci1udW1zO2ZvbnQtd2VpZ2h0OjYwMDtjb2xvcjp2YXIoLS10ZXh0LXByaW1hcnkpXCI+JyArXHJcbiAgICAgICAgICAgIF9mbXROdW0oZm9yZWNhc3RNYXBbZHNdKSArXHJcbiAgICAgICAgICAgICc8L3RkPidcclxuICAgICAgICApXHJcbiAgICAgICAgLmpvaW4oJycpO1xyXG4gICAgICBjb25zdCB0b3RhbDcgPSAoZC5mb3JlY2FzdCB8fCBbXSkucmVkdWNlKChzLCBmKSA9PiBzICsgKE51bWJlcihmLnlfaGF0KSB8fCAwKSwgMCk7XHJcbiAgICAgIHJldHVybiAoXHJcbiAgICAgICAgJzx0ciBvbmNsaWNrPVwib3BlbkZvcmVjYXN0U3RhdERldGFpbChcXCcnICtcclxuICAgICAgICBlc2NhcGVIdG1sU2FmZShkLmlkKSArXHJcbiAgICAgICAgJ1xcJylcIiBzdHlsZT1cImN1cnNvcjpwb2ludGVyO2JvcmRlci1ib3R0b206MXB4IHNvbGlkIHZhcigtLWJvcmRlci1zdWJ0bGUpXCIgb25tb3VzZW92ZXI9XCJ0aGlzLnN0eWxlLmJhY2tncm91bmQ9XFwndmFyKC0tYmctc2Vjb25kYXJ5KVxcJ1wiIG9ubW91c2VvdXQ9XCJ0aGlzLnN0eWxlLmJhY2tncm91bmQ9XFwndHJhbnNwYXJlbnRcXCdcIj4nICtcclxuICAgICAgICAnPHRkIHN0eWxlPVwicGFkZGluZzo4cHggMTBweDtmb250LXdlaWdodDo3MDA7Y29sb3I6dmFyKC0tdGV4dC1wcmltYXJ5KVwiPicgK1xyXG4gICAgICAgIGVzY2FwZUh0bWxTYWZlKGQuc3ViZmFtaWxpYSB8fCBkLmlkKSArXHJcbiAgICAgICAgJzwvdGQ+JyArXHJcbiAgICAgICAgJzx0ZCBzdHlsZT1cInBhZGRpbmc6OHB4IDEwcHg7Zm9udC1zaXplOjExcHg7Y29sb3I6dmFyKC0tdGV4dC1zZWNvbmRhcnkpXCI+JyArXHJcbiAgICAgICAgZXNjYXBlSHRtbFNhZmUoYmVzdE1vZGVsKSArXHJcbiAgICAgICAgJzwvdGQ+JyArXHJcbiAgICAgICAgJzx0ZCBzdHlsZT1cInBhZGRpbmc6OHB4IDEwcHg7dGV4dC1hbGlnbjpjZW50ZXJcIj48c3BhbiBzdHlsZT1cImRpc3BsYXk6aW5saW5lLWJsb2NrO3BhZGRpbmc6M3B4IDhweDtib3JkZXItcmFkaXVzOjEycHg7YmFja2dyb3VuZDonICtcclxuICAgICAgICBfd2FwZUJhZGdlQ29sb3Iod2FwZSkgK1xyXG4gICAgICAgICc7Y29sb3I6I2ZmZjtmb250LXNpemU6MTFweDtmb250LXdlaWdodDo3MDBcIj4nICtcclxuICAgICAgICBfZm10V2FwZSh3YXBlKSArXHJcbiAgICAgICAgJzwvc3Bhbj48L3RkPicgK1xyXG4gICAgICAgIG1vbnRoQ2VsbHMgK1xyXG4gICAgICAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjhweCAxMHB4O3RleHQtYWxpZ246cmlnaHQ7Zm9udC12YXJpYW50LW51bWVyaWM6dGFidWxhci1udW1zO2ZvbnQtd2VpZ2h0OjcwMDtjb2xvcjojMGQ5NDg4O2JhY2tncm91bmQ6dmFyKC0tYmctc2Vjb25kYXJ5KVwiPicgK1xyXG4gICAgICAgIF9mbXROdW0odG90YWw3KSArXHJcbiAgICAgICAgJzwvdGQ+JyArXHJcbiAgICAgICAgJzwvdHI+J1xyXG4gICAgICApO1xyXG4gICAgfSlcclxuICAgIC5qb2luKCcnKTtcclxuXHJcbiAgY29uc3QgbW9udGhIZWFkZXJzSHRtbCA9IG1vbnRoSGVhZGVyc1xyXG4gICAgLm1hcChcclxuICAgICAgKG0pID0+XHJcbiAgICAgICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6OHB4IDEwcHg7dGV4dC1hbGlnbjpyaWdodDtmb250LXNpemU6MTBweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7bGV0dGVyLXNwYWNpbmc6LjRweDtjb2xvcjojOTRhM2I4XCI+JyArXHJcbiAgICAgICAgZXNjYXBlSHRtbFNhZmUobSkgK1xyXG4gICAgICAgICc8L3RoPidcclxuICAgIClcclxuICAgIC5qb2luKCcnKTtcclxuXHJcbiAgY29uc3QgdGFibGUgPVxyXG4gICAgJzxkaXYgc3R5bGU9XCJvdmVyZmxvdzphdXRvO2JvcmRlcjoxcHggc29saWQgdmFyKC0tYm9yZGVyLXN1YnRsZSk7Ym9yZGVyLXJhZGl1czo4cHhcIj4nICtcclxuICAgICc8dGFibGUgc3R5bGU9XCJ3aWR0aDoxMDAlO2JvcmRlci1jb2xsYXBzZTpjb2xsYXBzZTtmb250LXNpemU6MTJweFwiPicgK1xyXG4gICAgJzx0aGVhZCBzdHlsZT1cImJhY2tncm91bmQ6IzBmMTcyYTtjb2xvcjojZmZmXCI+PHRyPicgK1xyXG4gICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6OHB4IDEwcHg7dGV4dC1hbGlnbjpsZWZ0O2ZvbnQtc2l6ZToxMHB4O3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtsZXR0ZXItc3BhY2luZzouNHB4XCI+U3ViZmFtaWxpYTwvdGg+JyArXHJcbiAgICAnPHRoIHN0eWxlPVwicGFkZGluZzo4cHggMTBweDt0ZXh0LWFsaWduOmxlZnQ7Zm9udC1zaXplOjEwcHg7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO2xldHRlci1zcGFjaW5nOi40cHhcIj5Nb2RlbG88L3RoPicgK1xyXG4gICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6OHB4IDEwcHg7dGV4dC1hbGlnbjpjZW50ZXI7Zm9udC1zaXplOjEwcHg7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO2xldHRlci1zcGFjaW5nOi40cHhcIj5XQVBFPC90aD4nICtcclxuICAgIG1vbnRoSGVhZGVyc0h0bWwgK1xyXG4gICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6OHB4IDEwcHg7dGV4dC1hbGlnbjpyaWdodDtmb250LXNpemU6MTBweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7bGV0dGVyLXNwYWNpbmc6LjRweDtiYWNrZ3JvdW5kOiMxMzRlNGFcIj5Ub3RhbCA3bTwvdGg+JyArXHJcbiAgICAnPC90cj48L3RoZWFkPicgK1xyXG4gICAgJzx0Ym9keT4nICtcclxuICAgIHJvd3NIdG1sICtcclxuICAgICc8L3Rib2R5PjwvdGFibGU+PC9kaXY+JztcclxuXHJcbiAgY29uc3QgZm9vdGVyID1cclxuICAgICc8ZGl2IHN0eWxlPVwibWFyZ2luLXRvcDoxMnB4O2ZvbnQtc2l6ZToxMXB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO2xpbmUtaGVpZ2h0OjEuNVwiPicgK1xyXG4gICAgJzxiPkNcdTAwRjNtbyBsZWVyPC9iPjogV0FQRSAoV2VpZ2h0ZWQgQWJzb2x1dGUgUGVyY2VudGFnZSBFcnJvcikgbWlkZSBlbCBlcnJvciBkZWwgbW9kZWxvIHJlbGF0aXZvIGFsIHRvdGFsIHJlYWw6ICZsdDszMCUgZXhjZWxlbnRlLCAzMC01MCUgYnVlbm8sIDUwLTcwJSBhY2VwdGFibGUsICZndDs3MCUgcG9icmUuIENsaWNrIGVuIGZpbGEgcGFyYSBkZXRhbGxlICsgZ3JcdTAwRTFmaWNvLiAnICtcclxuICAgICdTZSBlbGlnZSBlbCBtb2RlbG8gY29uIG1lbm9yIFdBUEUgcG9yIHNlcmllIHRyYXMgYmFja3Rlc3Qgcm9sbGluZy1vcmlnaW4gKGg9MiwgdmVudGFuYXM9MykuJyArXHJcbiAgICAnPC9kaXY+JztcclxuXHJcbiAgY29udC5pbm5lckhUTUwgPSAnPGRpdiBzdHlsZT1cInBhZGRpbmc6MThweFwiPicgKyBiYW5uZXIgKyB0YWJsZSArIGZvb3RlciArICc8L2Rpdj4nO1xyXG59XHJcblxyXG4vLyBDYWNoZSBoaXN0b3JpYSBhZ3JlZ2FkYSBwb3Igc3ViZmFtaWxpYSAocGFyYSBnclx1MDBFMWZpY28gZGV0YWxsZSkuXHJcbmFzeW5jIGZ1bmN0aW9uIF9sb2FkRm9yZWNhc3RTdGF0SGlzdG9yeSgpIHtcclxuICBpZiAoX2ZvcmVjYXN0U3RhdEhpc3RvcnlDYWNoZSkgcmV0dXJuIF9mb3JlY2FzdFN0YXRIaXN0b3J5Q2FjaGU7XHJcbiAgLy8gTGEgaGlzdG9yaWEgc29sbyBlc3RcdTAwRTEgZW4gQlEgKH4xMCBhXHUwMEYxb3MgQmFyYWxkbyArIDEyIG1lc2VzIFNoaW1hbm8pLiBDb21vXHJcbiAgLy8gZWwgcGlwZWxpbmUgbGEgZXNjcmliZSBhIENTViBsb2NhbCwgYWNcdTAwRTEgbm8gbGEgcG9kZW1vcyBsZWVyLiBBbHRlcm5hdGl2YTpcclxuICAvLyB1c2FyIHNrdV92ZW50YXNfc25hcHNob3QgcXVlIHRpZW5lIHZlbnRhcyBtZW5zdWFsZXMgcGVybyBzb2xvIGdydXBvIFBFU0NBLlxyXG4gIC8vIEVuIEYyQi4yIHNvbG8gbW9zdHJhbW9zIGZvcmVjYXN0K0lDIChzaW4gb3ZlcmxheSBoaXN0b3JpYSBwb3IgYWhvcmEpLlxyXG4gIF9mb3JlY2FzdFN0YXRIaXN0b3J5Q2FjaGUgPSB7fTtcclxuICByZXR1cm4gX2ZvcmVjYXN0U3RhdEhpc3RvcnlDYWNoZTtcclxufVxyXG5cclxuZnVuY3Rpb24gX2J1aWxkRm9yZWNhc3RDaGFydFN2Zyhkb2MpIHtcclxuICBjb25zdCBmYyA9IGRvYy5mb3JlY2FzdCB8fCBbXTtcclxuICBpZiAoIWZjLmxlbmd0aClcclxuICAgIHJldHVybiAnPGRpdiBzdHlsZT1cInBhZGRpbmc6MzBweDt0ZXh0LWFsaWduOmNlbnRlcjtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKVwiPlNpbiBkYXRvcyBkZSBmb3JlY2FzdDwvZGl2Pic7XHJcbiAgLy8gRGltZW5zaW9uZXNcclxuICBjb25zdCBXID0gNjQwLFxyXG4gICAgSCA9IDI2MDtcclxuICBjb25zdCBwYWRMID0gNTAsXHJcbiAgICBwYWRSID0gMjAsXHJcbiAgICBwYWRUID0gMjAsXHJcbiAgICBwYWRCID0gNDA7XHJcbiAgY29uc3QgaW5uZXJXID0gVyAtIHBhZEwgLSBwYWRSO1xyXG4gIGNvbnN0IGlubmVySCA9IEggLSBwYWRUIC0gcGFkQjtcclxuXHJcbiAgLy8gWSByYW5nZTogbWF4KGhpODApICogMS4xXHJcbiAgY29uc3QgbWF4WSA9IE1hdGgubWF4KDEsIC4uLmZjLm1hcCgoZikgPT4gTnVtYmVyKGYuaGk4MCkgfHwgTnVtYmVyKGYueV9oYXQpIHx8IDApKTtcclxuICBjb25zdCBtaW5ZID0gMDtcclxuICBjb25zdCBzY2FsZVggPSAoaSkgPT4gcGFkTCArIChpbm5lclcgKiBpKSAvIE1hdGgubWF4KDEsIGZjLmxlbmd0aCAtIDEpO1xyXG4gIGNvbnN0IHNjYWxlWSA9ICh2KSA9PiBwYWRUICsgaW5uZXJIIC0gKGlubmVySCAqICh2IC0gbWluWSkpIC8gKG1heFkgLSBtaW5ZKTtcclxuXHJcbiAgLy8gR3JpZCArIGVqZSBZXHJcbiAgY29uc3QgeVRpY2tzID0gWzAsIDAuMjUsIDAuNSwgMC43NSwgMV1cclxuICAgIC5tYXAoKHIpID0+IHtcclxuICAgICAgY29uc3QgdmFsID0gbWluWSArIHIgKiAobWF4WSAtIG1pblkpO1xyXG4gICAgICBjb25zdCB5eSA9IHNjYWxlWSh2YWwpO1xyXG4gICAgICByZXR1cm4gKFxyXG4gICAgICAgICc8bGluZSB4MT1cIicgK1xyXG4gICAgICAgIHBhZEwgK1xyXG4gICAgICAgICdcIiB5MT1cIicgK1xyXG4gICAgICAgIHl5ICtcclxuICAgICAgICAnXCIgeDI9XCInICtcclxuICAgICAgICAoVyAtIHBhZFIpICtcclxuICAgICAgICAnXCIgeTI9XCInICtcclxuICAgICAgICB5eSArXHJcbiAgICAgICAgJ1wiIHN0cm9rZT1cIiNlMmU4ZjBcIiBzdHJva2Utd2lkdGg9XCIxXCIvPicgK1xyXG4gICAgICAgICc8dGV4dCB4PVwiJyArXHJcbiAgICAgICAgKHBhZEwgLSA2KSArXHJcbiAgICAgICAgJ1wiIHk9XCInICtcclxuICAgICAgICAoeXkgKyA0KSArXHJcbiAgICAgICAgJ1wiIHRleHQtYW5jaG9yPVwiZW5kXCIgZm9udC1zaXplPVwiMTBcIiBmaWxsPVwiIzY0NzQ4YlwiPicgK1xyXG4gICAgICAgIF9mbXROdW0odmFsKSArXHJcbiAgICAgICAgJzwvdGV4dD4nXHJcbiAgICAgICk7XHJcbiAgICB9KVxyXG4gICAgLmpvaW4oJycpO1xyXG5cclxuICAvLyBFamUgWCAobWVzZXMpXHJcbiAgY29uc3QgeExhYmVscyA9IGZjXHJcbiAgICAubWFwKChmLCBpKSA9PiB7XHJcbiAgICAgIGNvbnN0IHh4ID0gc2NhbGVYKGkpO1xyXG4gICAgICByZXR1cm4gKFxyXG4gICAgICAgICc8dGV4dCB4PVwiJyArXHJcbiAgICAgICAgeHggK1xyXG4gICAgICAgICdcIiB5PVwiJyArXHJcbiAgICAgICAgKEggLSBwYWRCICsgMTUpICtcclxuICAgICAgICAnXCIgdGV4dC1hbmNob3I9XCJtaWRkbGVcIiBmb250LXNpemU9XCIxMFwiIGZpbGw9XCIjNjQ3NDhiXCI+JyArXHJcbiAgICAgICAgX2ZtdERzU2hvcnQoZi5kcykgK1xyXG4gICAgICAgICc8L3RleHQ+J1xyXG4gICAgICApO1xyXG4gICAgfSlcclxuICAgIC5qb2luKCcnKTtcclxuXHJcbiAgLy8gSW50ZXJ2YWxvIGNvbmZpYW56YSAoYmFuZClcclxuICBjb25zdCBiYW5kUG9pbnRzID1cclxuICAgIGZjLm1hcCgoZiwgaSkgPT4gc2NhbGVYKGkpICsgJywnICsgc2NhbGVZKE51bWJlcihmLmhpODApIHx8IDApKS5qb2luKCcgJykgK1xyXG4gICAgJyAnICtcclxuICAgIGZjXHJcbiAgICAgIC5zbGljZSgpXHJcbiAgICAgIC5yZXZlcnNlKClcclxuICAgICAgLm1hcCgoZiwgaSkgPT4gc2NhbGVYKGZjLmxlbmd0aCAtIDEgLSBpKSArICcsJyArIHNjYWxlWShOdW1iZXIoZi5sbzgwKSB8fCAwKSlcclxuICAgICAgLmpvaW4oJyAnKTtcclxuICBjb25zdCBiYW5kID0gJzxwb2x5Z29uIHBvaW50cz1cIicgKyBiYW5kUG9pbnRzICsgJ1wiIGZpbGw9XCIjMGQ5NDg4MzNcIiBzdHJva2U9XCJub25lXCIvPic7XHJcblxyXG4gIC8vIExpbmUgZm9yZWNhc3QgKyBwdW50b3NcclxuICBjb25zdCBsaW5lUG9pbnRzID0gZmMubWFwKChmLCBpKSA9PiBzY2FsZVgoaSkgKyAnLCcgKyBzY2FsZVkoTnVtYmVyKGYueV9oYXQpIHx8IDApKS5qb2luKCcgJyk7XHJcbiAgY29uc3QgbGluZSA9XHJcbiAgICAnPHBvbHlsaW5lIHBvaW50cz1cIicgK1xyXG4gICAgbGluZVBvaW50cyArXHJcbiAgICAnXCIgZmlsbD1cIm5vbmVcIiBzdHJva2U9XCIjMGQ5NDg4XCIgc3Ryb2tlLXdpZHRoPVwiMi41XCIgc3Ryb2tlLWxpbmVqb2luPVwicm91bmRcIi8+JztcclxuICBjb25zdCBwb2ludHMgPSBmY1xyXG4gICAgLm1hcChcclxuICAgICAgKGYsIGkpID0+XHJcbiAgICAgICAgJzxjaXJjbGUgY3g9XCInICtcclxuICAgICAgICBzY2FsZVgoaSkgK1xyXG4gICAgICAgICdcIiBjeT1cIicgK1xyXG4gICAgICAgIHNjYWxlWShOdW1iZXIoZi55X2hhdCkgfHwgMCkgK1xyXG4gICAgICAgICdcIiByPVwiNFwiIGZpbGw9XCIjMGQ5NDg4XCIgc3Ryb2tlPVwiI2ZmZlwiIHN0cm9rZS13aWR0aD1cIjJcIi8+J1xyXG4gICAgKVxyXG4gICAgLmpvaW4oJycpO1xyXG4gIC8vIExhYmVscyBkZSB2YWxvclxyXG4gIGNvbnN0IHZhbHVlTGFiZWxzID0gZmNcclxuICAgIC5tYXAoKGYsIGkpID0+IHtcclxuICAgICAgY29uc3QgeHggPSBzY2FsZVgoaSk7XHJcbiAgICAgIGNvbnN0IHl5ID0gc2NhbGVZKE51bWJlcihmLnlfaGF0KSB8fCAwKTtcclxuICAgICAgcmV0dXJuIChcclxuICAgICAgICAnPHRleHQgeD1cIicgK1xyXG4gICAgICAgIHh4ICtcclxuICAgICAgICAnXCIgeT1cIicgK1xyXG4gICAgICAgICh5eSAtIDgpICtcclxuICAgICAgICAnXCIgdGV4dC1hbmNob3I9XCJtaWRkbGVcIiBmb250LXNpemU9XCIxMFwiIGZvbnQtd2VpZ2h0PVwiNzAwXCIgZmlsbD1cIiMwZjc2NmVcIj4nICtcclxuICAgICAgICBfZm10TnVtKGYueV9oYXQpICtcclxuICAgICAgICAnPC90ZXh0PidcclxuICAgICAgKTtcclxuICAgIH0pXHJcbiAgICAuam9pbignJyk7XHJcblxyXG4gIGNvbnN0IHN2ZyA9XHJcbiAgICAnPHN2ZyB2aWV3Qm94PVwiMCAwICcgK1xyXG4gICAgVyArXHJcbiAgICAnICcgK1xyXG4gICAgSCArXHJcbiAgICAnXCIgc3R5bGU9XCJ3aWR0aDoxMDAlO21heC13aWR0aDo4MDBweDtoZWlnaHQ6YXV0b1wiPicgK1xyXG4gICAgJzxyZWN0IHg9XCIwXCIgeT1cIjBcIiB3aWR0aD1cIicgK1xyXG4gICAgVyArXHJcbiAgICAnXCIgaGVpZ2h0PVwiJyArXHJcbiAgICBIICtcclxuICAgICdcIiBmaWxsPVwiI2ZmZlwiLz4nICtcclxuICAgIHlUaWNrcyArXHJcbiAgICB4TGFiZWxzICtcclxuICAgIGJhbmQgK1xyXG4gICAgbGluZSArXHJcbiAgICBwb2ludHMgK1xyXG4gICAgdmFsdWVMYWJlbHMgK1xyXG4gICAgJzwvc3ZnPic7XHJcbiAgcmV0dXJuIHN2ZztcclxufVxyXG5cclxud2luZG93Lm9wZW5Gb3JlY2FzdFN0YXREZXRhaWwgPSBmdW5jdGlvbiAoc3ViSWQpIHtcclxuICBpZiAoIV9mb3JlY2FzdFN0YXREb2NzKSByZXR1cm47XHJcbiAgY29uc3QgZG9jID0gX2ZvcmVjYXN0U3RhdERvY3MuZmluZCgoZCkgPT4gZC5pZCA9PT0gc3ViSWQpO1xyXG4gIGlmICghZG9jKSB7XHJcbiAgICBhbGVydCgnTm8gc2UgZW5jb250clx1MDBGMyBkZXRhbGxlIGRlICcgKyBzdWJJZCk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIGNvbnN0IGV4aXN0aW5nID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2ZvcmVjYXN0LXN0YXQtZGV0YWlsJyk7XHJcbiAgaWYgKGV4aXN0aW5nKSBleGlzdGluZy5yZW1vdmUoKTtcclxuXHJcbiAgY29uc3QgZWwgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKTtcclxuICBlbC5pZCA9ICdmb3JlY2FzdC1zdGF0LWRldGFpbCc7XHJcbiAgZWwuc3R5bGUuY3NzVGV4dCA9XHJcbiAgICAncG9zaXRpb246Zml4ZWQ7aW5zZXQ6MDtiYWNrZ3JvdW5kOnJnYmEoMTUsMjMsNDIsLjY1KTt6LWluZGV4OjIxMDA7ZGlzcGxheTpmbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtqdXN0aWZ5LWNvbnRlbnQ6Y2VudGVyO3BhZGRpbmc6MnZoJztcclxuICBlbC5vbmNsaWNrID0gKGV2KSA9PiB7XHJcbiAgICBpZiAoZXYudGFyZ2V0ID09PSBlbCkgZWwucmVtb3ZlKCk7XHJcbiAgfTtcclxuXHJcbiAgY29uc3Qgd2FwZSA9IGRvYy5tZXRyaWNzICYmIGRvYy5tZXRyaWNzLndhcGU7XHJcbiAgY29uc3QgYmlhcyA9IGRvYy5tZXRyaWNzICYmIGRvYy5tZXRyaWNzLmJpYXM7XHJcbiAgY29uc3QgbWFlID0gZG9jLm1ldHJpY3MgJiYgZG9jLm1ldHJpY3MubWFlO1xyXG4gIGNvbnN0IHJtc2UgPSBkb2MubWV0cmljcyAmJiBkb2MubWV0cmljcy5ybXNlO1xyXG4gIGNvbnN0IGJlc3RNb2RlbCA9IGRvYy5iZXN0TW9kZWwgfHwgJ1x1MjAxNCc7XHJcbiAgY29uc3QgdmVyc2lvbklkID0gZG9jLnZlcnNpb25JZCB8fCAnXHUyMDE0JztcclxuICBjb25zdCBzdmdIdG1sID0gX2J1aWxkRm9yZWNhc3RDaGFydFN2Zyhkb2MpO1xyXG5cclxuICBjb25zdCBtZXRyaWNzSHRtbCA9XHJcbiAgICAnPGRpdiBzdHlsZT1cImRpc3BsYXk6Z3JpZDtncmlkLXRlbXBsYXRlLWNvbHVtbnM6cmVwZWF0KGF1dG8tZml0LG1pbm1heCgxMjBweCwxZnIpKTtnYXA6MTBweDttYXJnaW46MTRweCAwXCI+JyArXHJcbiAgICAnPGRpdiBzdHlsZT1cInBhZGRpbmc6MTBweDtiYWNrZ3JvdW5kOnZhcigtLWJnLXNlY29uZGFyeSk7Ym9yZGVyLXJhZGl1czo2cHhcIj48ZGl2IHN0eWxlPVwiZm9udC1zaXplOjEwcHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlXCI+TW9kZWxvPC9kaXY+PGRpdiBzdHlsZT1cImZvbnQtd2VpZ2h0OjcwMFwiPicgK1xyXG4gICAgZXNjYXBlSHRtbFNhZmUoYmVzdE1vZGVsKSArXHJcbiAgICAnPC9kaXY+PC9kaXY+JyArXHJcbiAgICAnPGRpdiBzdHlsZT1cInBhZGRpbmc6MTBweDtiYWNrZ3JvdW5kOnZhcigtLWJnLXNlY29uZGFyeSk7Ym9yZGVyLXJhZGl1czo2cHhcIj48ZGl2IHN0eWxlPVwiZm9udC1zaXplOjEwcHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlXCI+V0FQRTwvZGl2PjxkaXYgc3R5bGU9XCJmb250LXdlaWdodDo3MDA7Y29sb3I6JyArXHJcbiAgICBfd2FwZUJhZGdlQ29sb3Iod2FwZSkgK1xyXG4gICAgJ1wiPicgK1xyXG4gICAgX2ZtdFdhcGUod2FwZSkgK1xyXG4gICAgJzwvZGl2PjwvZGl2PicgK1xyXG4gICAgJzxkaXYgc3R5bGU9XCJwYWRkaW5nOjEwcHg7YmFja2dyb3VuZDp2YXIoLS1iZy1zZWNvbmRhcnkpO2JvcmRlci1yYWRpdXM6NnB4XCI+PGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMHB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZVwiPkJpYXM8L2Rpdj48ZGl2IHN0eWxlPVwiZm9udC13ZWlnaHQ6NzAwXCI+JyArXHJcbiAgICAoYmlhcyAhPSBudWxsID8gKGJpYXMgKiAxMDApLnRvRml4ZWQoMCkgKyAnJScgOiAnXHUyMDE0JykgK1xyXG4gICAgJzwvZGl2PjwvZGl2PicgK1xyXG4gICAgJzxkaXYgc3R5bGU9XCJwYWRkaW5nOjEwcHg7YmFja2dyb3VuZDp2YXIoLS1iZy1zZWNvbmRhcnkpO2JvcmRlci1yYWRpdXM6NnB4XCI+PGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMHB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZVwiPk1BRTwvZGl2PjxkaXYgc3R5bGU9XCJmb250LXdlaWdodDo3MDBcIj4nICtcclxuICAgIF9mbXROdW0obWFlKSArXHJcbiAgICAnPC9kaXY+PC9kaXY+JyArXHJcbiAgICAnPGRpdiBzdHlsZT1cInBhZGRpbmc6MTBweDtiYWNrZ3JvdW5kOnZhcigtLWJnLXNlY29uZGFyeSk7Ym9yZGVyLXJhZGl1czo2cHhcIj48ZGl2IHN0eWxlPVwiZm9udC1zaXplOjEwcHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlXCI+Uk1TRTwvZGl2PjxkaXYgc3R5bGU9XCJmb250LXdlaWdodDo3MDBcIj4nICtcclxuICAgIF9mbXROdW0ocm1zZSkgK1xyXG4gICAgJzwvZGl2PjwvZGl2PicgK1xyXG4gICAgJzwvZGl2Pic7XHJcblxyXG4gIGNvbnN0IHRhYmxlSHRtbCA9XHJcbiAgICAnPHRhYmxlIHN0eWxlPVwid2lkdGg6MTAwJTtmb250LXNpemU6MTJweDtib3JkZXItY29sbGFwc2U6Y29sbGFwc2U7bWFyZ2luLXRvcDoxMHB4XCI+JyArXHJcbiAgICAnPHRoZWFkIHN0eWxlPVwiYmFja2dyb3VuZDojMGYxNzJhO2NvbG9yOiNmZmZcIj48dHI+JyArXHJcbiAgICAnPHRoIHN0eWxlPVwicGFkZGluZzo2cHggMTBweDt0ZXh0LWFsaWduOmxlZnRcIj5NZXM8L3RoPicgK1xyXG4gICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6NnB4IDEwcHg7dGV4dC1hbGlnbjpyaWdodFwiPkZvcmVjYXN0PC90aD4nICtcclxuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjZweCAxMHB4O3RleHQtYWxpZ246cmlnaHRcIj5JQyA4MCUgYmFqbzwvdGg+JyArXHJcbiAgICAnPHRoIHN0eWxlPVwicGFkZGluZzo2cHggMTBweDt0ZXh0LWFsaWduOnJpZ2h0XCI+SUMgODAlIGFsdG88L3RoPicgK1xyXG4gICAgJzwvdHI+PC90aGVhZD48dGJvZHk+JyArXHJcbiAgICAoZG9jLmZvcmVjYXN0IHx8IFtdKVxyXG4gICAgICAubWFwKFxyXG4gICAgICAgIChmKSA9PlxyXG4gICAgICAgICAgJzx0ciBzdHlsZT1cImJvcmRlci1ib3R0b206MXB4IHNvbGlkIHZhcigtLWJvcmRlci1zdWJ0bGUpXCI+PHRkIHN0eWxlPVwicGFkZGluZzo2cHggMTBweFwiPicgK1xyXG4gICAgICAgICAgZXNjYXBlSHRtbFNhZmUoX2ZtdERzU2hvcnQoZi5kcykpICtcclxuICAgICAgICAgICc8L3RkPicgK1xyXG4gICAgICAgICAgJzx0ZCBzdHlsZT1cInBhZGRpbmc6NnB4IDEwcHg7dGV4dC1hbGlnbjpyaWdodDtmb250LXdlaWdodDo3MDBcIj4nICtcclxuICAgICAgICAgIF9mbXROdW0oZi55X2hhdCkgK1xyXG4gICAgICAgICAgJzwvdGQ+JyArXHJcbiAgICAgICAgICAnPHRkIHN0eWxlPVwicGFkZGluZzo2cHggMTBweDt0ZXh0LWFsaWduOnJpZ2h0O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpXCI+JyArXHJcbiAgICAgICAgICBfZm10TnVtKGYubG84MCkgK1xyXG4gICAgICAgICAgJzwvdGQ+JyArXHJcbiAgICAgICAgICAnPHRkIHN0eWxlPVwicGFkZGluZzo2cHggMTBweDt0ZXh0LWFsaWduOnJpZ2h0O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpXCI+JyArXHJcbiAgICAgICAgICBfZm10TnVtKGYuaGk4MCkgK1xyXG4gICAgICAgICAgJzwvdGQ+PC90cj4nXHJcbiAgICAgIClcclxuICAgICAgLmpvaW4oJycpICtcclxuICAgICc8L3Rib2R5PjwvdGFibGU+JztcclxuXHJcbiAgY29uc3QgY29udGVudCA9XHJcbiAgICAnPGRpdiBzdHlsZT1cImJhY2tncm91bmQ6dmFyKC0tYmctZWxldmF0ZWQpO2JvcmRlci1yYWRpdXM6MTJweDtwYWRkaW5nOjI0cHg7bWF4LXdpZHRoOjgyMHB4O3dpZHRoOjEwMCU7bWF4LWhlaWdodDo5NnZoO292ZXJmbG93OmF1dG87Ym94LXNoYWRvdzowIDIwcHggNjBweCByZ2JhKDAsMCwwLC40KVwiPicgK1xyXG4gICAgJzxkaXYgc3R5bGU9XCJkaXNwbGF5OmZsZXg7anVzdGlmeS1jb250ZW50OnNwYWNlLWJldHdlZW47YWxpZ24taXRlbXM6Y2VudGVyO21hcmdpbi1ib3R0b206MTBweFwiPicgK1xyXG4gICAgJzxkaXY+PGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMXB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtsZXR0ZXItc3BhY2luZzouNHB4XCI+U3ViZmFtaWxpYTwvZGl2PjxkaXYgc3R5bGU9XCJmb250LXNpemU6MjJweDtmb250LXdlaWdodDo4MDBcIj4nICtcclxuICAgIGVzY2FwZUh0bWxTYWZlKGRvYy5zdWJmYW1pbGlhIHx8IGRvYy5pZCkgK1xyXG4gICAgJzwvZGl2PjwvZGl2PicgK1xyXG4gICAgJzxidXR0b24gb25jbGljaz1cImRvY3VtZW50LmdldEVsZW1lbnRCeUlkKFxcJ2ZvcmVjYXN0LXN0YXQtZGV0YWlsXFwnKS5yZW1vdmUoKVwiIHN0eWxlPVwiYmFja2dyb3VuZDp0cmFuc3BhcmVudDtib3JkZXI6MXB4IHNvbGlkIHZhcigtLWJvcmRlci1zdWJ0bGUpO2JvcmRlci1yYWRpdXM6NnB4O3BhZGRpbmc6NnB4IDEycHg7Y3Vyc29yOnBvaW50ZXI7Zm9udC13ZWlnaHQ6NzAwXCI+Q2VycmFyPC9idXR0b24+JyArXHJcbiAgICAnPC9kaXY+JyArXHJcbiAgICBtZXRyaWNzSHRtbCArXHJcbiAgICAnPGRpdiBzdHlsZT1cImJhY2tncm91bmQ6I2ZmZjtwYWRkaW5nOjhweDtib3JkZXItcmFkaXVzOjhweDttYXJnaW4tdG9wOjEwcHg7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1ib3JkZXItc3VidGxlKVwiPicgK1xyXG4gICAgc3ZnSHRtbCArXHJcbiAgICAnPC9kaXY+JyArXHJcbiAgICB0YWJsZUh0bWwgK1xyXG4gICAgJzxkaXYgc3R5bGU9XCJtYXJnaW4tdG9wOjE0cHg7Zm9udC1zaXplOjExcHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZClcIj5WZXJzaW9uOiA8Y29kZT4nICtcclxuICAgIGVzY2FwZUh0bWxTYWZlKHZlcnNpb25JZCkgK1xyXG4gICAgJzwvY29kZT4gXHUwMEI3IEFwcHJvYWNoOiAnICtcclxuICAgIGVzY2FwZUh0bWxTYWZlKChkb2MuY29uZmlnIHx8IHt9KS5hcHByb2FjaCB8fCAnXHUyMDE0JykgK1xyXG4gICAgJzwvZGl2PicgK1xyXG4gICAgJzwvZGl2Pic7XHJcbiAgZWwuaW5uZXJIVE1MID0gY29udGVudDtcclxuICBkb2N1bWVudC5ib2R5LmFwcGVuZENoaWxkKGVsKTtcclxufTtcclxuXHJcbndpbmRvdy5vcGVuRm9yZWNhc3RNb2RhbCA9IGFzeW5jIGZ1bmN0aW9uICgpIHtcclxuICBpZiAoIV9jYW5Gb3JlY2FzdCgpKSB7XHJcbiAgICBhbGVydCgnRk9SRUNBU1QgZXMgc29sbyBwYXJhIE1hcmlhbm8gKGFkbWluKS4nKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgY29uc3QgZWwgPSBfcmVuZGVyTW9kYWxTaGVsbCgpO1xyXG4gIGVsLnN0eWxlLmRpc3BsYXkgPSAnYmxvY2snO1xyXG4gIC8vIHYxMDk4KyBGYXNlIDE6IGNhcmdhciBTYWxlcyBQbGFucyBjYWNoZXMgKyByZW5kZXJpemFyIHRhYiBkZWZhdWx0LlxyXG4gIF9yZW5kZXJTYWxlc1BsYW5zVGFiKCk7XHJcbiAgX2xvYWRTYWxlc1BsYW5DYWNoZXMoKVxyXG4gICAgLnRoZW4oX3JlbmRlclNhbGVzUGxhbnNUYWIpXHJcbiAgICAuY2F0Y2goKCkgPT4ge30pO1xyXG4gIC8vIExlZ2FjeTogc25hcHNob3Qgc29sbyBzZSBjYXJnYSBsYXp5IHNpIGVsIHVzZXIgY2FtYmlhIGEgdGFiIExlZ2FjeS5cclxuICBpZiAoX2ZvcmVjYXN0TG9hZGluZykgcmV0dXJuO1xyXG4gIGlmICghX2ZvcmVjYXN0U25hcHNob3QpIHtcclxuICAgIF9mb3JlY2FzdExvYWRpbmcgPSB0cnVlO1xyXG4gICAgY29uc3Qgc3RhdHMgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZm9yZWNhc3Qtc3RhdHMnKTtcclxuICAgIGlmIChzdGF0cykgc3RhdHMudGV4dENvbnRlbnQgPSAnQ2FyZ2FuZG8gc25hcHNob3QgZGUgdmVudGFzLi4uJztcclxuICAgIHRyeSB7XHJcbiAgICAgIGF3YWl0IF9sb2FkU25hcHNob3QoKTtcclxuICAgICAgaWYgKHN0YXRzKSBzdGF0cy50ZXh0Q29udGVudCA9IF9mb3JlY2FzdFNuYXBzaG90LmNvdW50ICsgJyBTS1VzIGVuIHNuYXBzaG90IGhpc3Rvcmljbyc7XHJcbiAgICB9IGNhdGNoIChlKSB7XHJcbiAgICAgIGlmIChzdGF0cykgc3RhdHMudGV4dENvbnRlbnQgPSAnRXJyb3IgY2FyZ2FuZG8gc25hcHNob3Q6ICcgKyAoKGUgJiYgZS5tZXNzYWdlKSB8fCBlKTtcclxuICAgICAgLy8gTm8gYWxlcnQgXHUyMDE0IGxlZ2FjeSBlcyBvcHQtaW4sIG5vIGJsb3F1ZWEgYWwgdXN1YXJpbyBzaSBzb2xvIHZhIGEgc3ViaXIgU2FsZXMgUGxhbnMuXHJcbiAgICAgIGNvbnNvbGUud2FybignW0ZPUkVDQVNUXSBzbmFwc2hvdCBsb2FkIGZhaWwgKGxlZ2FjeSB0YWIpJywgZSk7XHJcbiAgICB9IGZpbmFsbHkge1xyXG4gICAgICBfZm9yZWNhc3RMb2FkaW5nID0gZmFsc2U7XHJcbiAgICB9XHJcbiAgfSBlbHNlIHtcclxuICAgIGNvbnN0IHN0YXRzID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2ZvcmVjYXN0LXN0YXRzJyk7XHJcbiAgICBpZiAoc3RhdHMpIHN0YXRzLnRleHRDb250ZW50ID0gX2ZvcmVjYXN0U25hcHNob3QuY291bnQgKyAnIFNLVXMgZW4gc25hcHNob3QgaGlzdG9yaWNvJztcclxuICB9XHJcbn07XHJcblxyXG53aW5kb3cuY2xvc2VGb3JlY2FzdE1vZGFsID0gZnVuY3Rpb24gKCkge1xyXG4gIGNvbnN0IGVsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2ZvcmVjYXN0LW1vZGFsJyk7XHJcbiAgaWYgKGVsKSBlbC5zdHlsZS5kaXNwbGF5ID0gJ25vbmUnO1xyXG59O1xyXG5cclxud2luZG93Lm9uRm9yZWNhc3RTYWxlc1BsYW5GaWxlID0gYXN5bmMgZnVuY3Rpb24gKGV2ZW50KSB7XHJcbiAgY29uc3QgZmlsZSA9IGV2ZW50ICYmIGV2ZW50LnRhcmdldCAmJiBldmVudC50YXJnZXQuZmlsZXMgJiYgZXZlbnQudGFyZ2V0LmZpbGVzWzBdO1xyXG4gIGlmICghZmlsZSkgcmV0dXJuO1xyXG4gIHRyeSB7XHJcbiAgICBpZiAoIV9mb3JlY2FzdFNuYXBzaG90KSBhd2FpdCBfbG9hZFNuYXBzaG90KCk7XHJcbiAgICBjb25zdCBidWYgPSBhd2FpdCBmaWxlLmFycmF5QnVmZmVyKCk7XHJcbiAgICBpZiAodHlwZW9mIFhMU1ggPT09ICd1bmRlZmluZWQnKSB7XHJcbiAgICAgIGFsZXJ0KCdYTFNYIG5vIGNhcmdhZG8nKTtcclxuICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG4gICAgY29uc3Qgd2IgPSBYTFNYLnJlYWQoYnVmLCB7IHR5cGU6ICdhcnJheScgfSk7XHJcbiAgICBjb25zdCBzaGVldCA9IHdiLlNoZWV0c1t3Yi5TaGVldE5hbWVzWzBdXTtcclxuICAgIGNvbnN0IHJvd3MgPSBYTFNYLnV0aWxzLnNoZWV0X3RvX2pzb24oc2hlZXQsIHsgaGVhZGVyOiAxLCBkZWZ2YWw6IG51bGwsIHJhdzogdHJ1ZSB9KTtcclxuICAgIGNvbnN0IHBhcnNlZCA9IF9wYXJzZVNhbGVzUGxhblJvd3Mocm93cyk7XHJcbiAgICBpZiAoIXBhcnNlZC5sZW5ndGgpIHtcclxuICAgICAgYWxlcnQoJ0VsIEV4Y2VsIGVzdGEgdmFjaW8gbyBubyB0aWVuZSBmaWxhcyB2YWxpZGFzLicpO1xyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcbiAgICBfZm9yZWNhc3RTYWxlc1BsYW4gPSBwYXJzZWQ7XHJcbiAgICBjb25zdCBob3kgPSBuZXcgRGF0ZSgpO1xyXG4gICAgX2ZvcmVjYXN0Um93cyA9IF9jb21wdXRlRm9yZWNhc3RSb3dzKF9mb3JlY2FzdFNuYXBzaG90LCBwYXJzZWQsIGhveSk7XHJcbiAgICBfcmVuZGVyVGFibGUoX2ZvcmVjYXN0Um93cyk7XHJcbiAgICBjb25zdCBzaW5NYXRjaCA9IF9mb3JlY2FzdFJvd3MuZmlsdGVyKChyKSA9PiAhci5oYXNIaXN0b3JpYSkubGVuZ3RoO1xyXG4gICAgY29uc3Qgc3RhdHMgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZm9yZWNhc3Qtc3RhdHMnKTtcclxuICAgIGlmIChzdGF0cykge1xyXG4gICAgICBzdGF0cy50ZXh0Q29udGVudCA9XHJcbiAgICAgICAgcGFyc2VkLmxlbmd0aCArXHJcbiAgICAgICAgJyBTS1VzIGVuIFNhbGVzIFBsYW4gXHUwMEI3ICcgK1xyXG4gICAgICAgIChwYXJzZWQubGVuZ3RoIC0gc2luTWF0Y2gpICtcclxuICAgICAgICAnIGNvbiBoaXN0b3JpYSBcdTAwQjcgJyArXHJcbiAgICAgICAgc2luTWF0Y2ggK1xyXG4gICAgICAgICcgc2luIG1hdGNoIChmb25kbyBhbWFyaWxsbyknO1xyXG4gICAgfVxyXG4gICAgY29uc3QgYnRuID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2ZvcmVjYXN0LWV4cG9ydC1idG4nKTtcclxuICAgIGlmIChidG4pIHtcclxuICAgICAgYnRuLmRpc2FibGVkID0gZmFsc2U7XHJcbiAgICAgIGJ0bi5zdHlsZS5vcGFjaXR5ID0gJzEnO1xyXG4gICAgfVxyXG4gIH0gY2F0Y2ggKGUpIHtcclxuICAgIGNvbnNvbGUuZXJyb3IoJ1tGT1JFQ0FTVF0gcGFyc2UgZXJyb3I6JywgZSk7XHJcbiAgICBhbGVydCgnRXJyb3IgcHJvY2VzYW5kbyBlbCBFeGNlbDpcXG4nICsgKChlICYmIGUubWVzc2FnZSkgfHwgZSkpO1xyXG4gIH0gZmluYWxseSB7XHJcbiAgICAvLyBSZXNldCBpbnB1dCBwYXJhIHF1ZSBlbCBtaXNtbyBhcmNoaXZvIHNlIHB1ZWRhIHJlLXN1YmlyXHJcbiAgICBpZiAoZXZlbnQgJiYgZXZlbnQudGFyZ2V0KSBldmVudC50YXJnZXQudmFsdWUgPSAnJztcclxuICB9XHJcbn07XHJcblxyXG53aW5kb3cuZXhwb3J0Rm9yZWNhc3RFeGNlbCA9IGZ1bmN0aW9uICgpIHtcclxuICBpZiAoIV9mb3JlY2FzdFJvd3MgfHwgIV9mb3JlY2FzdFJvd3MubGVuZ3RoKSB7XHJcbiAgICBhbGVydCgnTm8gaGF5IGRhdG9zIHBhcmEgZXhwb3J0YXIuIENhcmdhIHByaW1lcm8gZWwgU2FsZXMgUGxhbi4nKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgaWYgKHR5cGVvZiBYTFNYID09PSAndW5kZWZpbmVkJykge1xyXG4gICAgYWxlcnQoJ1hMU1ggbm8gY2FyZ2FkbycpO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuICBjb25zdCByb3VuZDEgPSAobikgPT4gTWF0aC5yb3VuZChOdW1iZXIobiB8fCAwKSAqIDEwKSAvIDEwO1xyXG4gIGNvbnN0IGFvYSA9IFtcclxuICAgIFtcclxuICAgICAgJ1NLVScsXHJcbiAgICAgICdGQU1JTElBJyxcclxuICAgICAgJ1NVQkZBTUlMSUEnLFxyXG4gICAgICAnVkVOVEFTICgxMm0pJyxcclxuICAgICAgJ1BFRElETy1TQUxFUyBQTEFOUyAoNm0pJyxcclxuICAgICAgJ1BST01FRElPIERFIElOVkVOVEFSSU8nLFxyXG4gICAgICAnUE9MSVRJQ0EgREUgSU5WRU5UQVJJTyAoM20pJyxcclxuICAgICAgJ1RPVEFMJyxcclxuICAgIF0sXHJcbiAgXTtcclxuICBmb3IgKGNvbnN0IHIgb2YgX2ZvcmVjYXN0Um93cykge1xyXG4gICAgYW9hLnB1c2goW1xyXG4gICAgICByLnNrdSxcclxuICAgICAgci5mYW1pbGlhLFxyXG4gICAgICByLnN1YmZhbWlsaWEsXHJcbiAgICAgIHJvdW5kMShyLnZlbnRhczEybSksXHJcbiAgICAgIHJvdW5kMShyLnBlZGlkbzZtKSxcclxuICAgICAgcm91bmQxKHIucHJvbWVkaW8pLFxyXG4gICAgICByb3VuZDEoci5wb2xpdGljYSksXHJcbiAgICAgIHJvdW5kMShyLnRvdGFsKSxcclxuICAgIF0pO1xyXG4gIH1cclxuICBjb25zdCB3cyA9IFhMU1gudXRpbHMuYW9hX3RvX3NoZWV0KGFvYSk7XHJcbiAgLy8gQW5jaG9zIGRlIGNvbHVtbmFcclxuICB3c1snIWNvbHMnXSA9IFtcclxuICAgIHsgd2NoOiAxOCB9LFxyXG4gICAgeyB3Y2g6IDI0IH0sXHJcbiAgICB7IHdjaDogMjQgfSxcclxuICAgIHsgd2NoOiAxNCB9LFxyXG4gICAgeyB3Y2g6IDIwIH0sXHJcbiAgICB7IHdjaDogMjAgfSxcclxuICAgIHsgd2NoOiAyMiB9LFxyXG4gICAgeyB3Y2g6IDEyIH0sXHJcbiAgXTtcclxuICBjb25zdCB3YiA9IFhMU1gudXRpbHMuYm9va19uZXcoKTtcclxuICBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KHdiLCB3cywgJ0ZPUkVDQVNUJyk7XHJcbiAgY29uc3QgaG95ID0gbmV3IERhdGUoKTtcclxuICBjb25zdCBzdGFtcCA9XHJcbiAgICBob3kuZ2V0RnVsbFllYXIoKSArXHJcbiAgICAnLScgK1xyXG4gICAgU3RyaW5nKGhveS5nZXRNb250aCgpICsgMSkucGFkU3RhcnQoMiwgJzAnKSArXHJcbiAgICAnLScgK1xyXG4gICAgU3RyaW5nKGhveS5nZXREYXRlKCkpLnBhZFN0YXJ0KDIsICcwJyk7XHJcbiAgWExTWC53cml0ZUZpbGUod2IsICdGb3JlY2FzdF9TaGltYW5vXycgKyBzdGFtcCArICcueGxzeCcpO1xyXG59O1xyXG5cclxuLy8gUmVmcmVzaCBwdWJsaWNvIChwb3Igc2kgZWwgdXNlciBuZWNlc2l0YSByZS1mZXRjaGVhciBlbCBzbmFwc2hvdCBzaW4gY2VycmFyXHJcbi8vIGVsIG1vZGFsLCBlajogcGFzYXJvbiAzMCBtaW4geSBlbCBjcm9uIEJRIGFjdHVhbGl6byBsYSBjb2xlY2Npb24pLlxyXG53aW5kb3cucmVsb2FkRm9yZWNhc3RTbmFwc2hvdCA9IGFzeW5jIGZ1bmN0aW9uICgpIHtcclxuICBfZm9yZWNhc3RTbmFwc2hvdCA9IG51bGw7XHJcbiAgYXdhaXQgX2xvYWRTbmFwc2hvdCgpO1xyXG4gIGlmIChfZm9yZWNhc3RTYWxlc1BsYW4pIHtcclxuICAgIGNvbnN0IGhveSA9IG5ldyBEYXRlKCk7XHJcbiAgICBfZm9yZWNhc3RSb3dzID0gX2NvbXB1dGVGb3JlY2FzdFJvd3MoX2ZvcmVjYXN0U25hcHNob3QsIF9mb3JlY2FzdFNhbGVzUGxhbiwgaG95KTtcclxuICAgIF9yZW5kZXJUYWJsZShfZm9yZWNhc3RSb3dzKTtcclxuICB9XHJcbn07XHJcbiJdLAogICJtYXBwaW5ncyI6ICI7OztBQVlBLE1BQU0sZ0JBQWdCO0FBQUEsSUFDcEIsS0FBSztBQUFBLElBQ0wsU0FBUztBQUFBLElBQ1QsS0FBSztBQUFBLElBQ0wsT0FBTztBQUFBLElBQ1AsS0FBSztBQUFBLElBQ0wsVUFBVTtBQUFBLElBQ1YsU0FBUztBQUFBLElBQ1QsS0FBSztBQUFBLElBQ0wsT0FBTztBQUFBLElBQ1AsT0FBTztBQUFBLElBQ1AsS0FBSztBQUFBLElBQ0wsT0FBTztB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
