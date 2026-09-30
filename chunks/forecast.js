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
    { key: "reels", label: "Reels", color: "#8b5cf6" }
  ];
  var _salesPlanCaches = { rods: null, reels: null };
  var _forecastActiveTab = "sales-plans";
  var _forecastStatDocs = null;
  var _forecastStatMeta = null;
  var _recoStockSnapshot = null;
  var _recoVentasSnapshot = null;
  var _recoFilterMinRec = true;
  var _recoFilterFamilia = "all";
  var _recoSearchText = "";
  var RECO_HORIZON_MONTHS = 7;
  var RECO_VENTA_PROMEDIO_WINDOW = 3;
  var RECO_DEFAULT_MULTIPLIER = 1;
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
    const tabsBar = `<div id="forecast-tabs-bar" style="display:flex;gap:0;background:var(--bg-secondary);padding:0 18px;border-bottom:1px solid var(--border-subtle)"><button data-tab="sales-plans" onclick="switchForecastTab('sales-plans')" class="forecast-tab" style="padding:10px 16px;background:transparent;color:var(--text-primary);border:none;border-bottom:3px solid #0d9488;cursor:pointer;font-weight:700;font-size:12px;letter-spacing:.4px;text-transform:uppercase">Sales Plans</button><button data-tab="stat" onclick="switchForecastTab('stat')" class="forecast-tab" style="padding:10px 16px;background:transparent;color:var(--text-muted);border:none;border-bottom:3px solid transparent;cursor:pointer;font-weight:600;font-size:12px;letter-spacing:.4px;text-transform:uppercase">Forecast Estad\xEDstico</button><button data-tab="legacy" onclick="switchForecastTab('legacy')" class="forecast-tab" style="padding:10px 16px;background:transparent;color:var(--text-muted);border:none;border-bottom:3px solid transparent;cursor:pointer;font-weight:600;font-size:12px;letter-spacing:.4px;text-transform:uppercase">Legacy (6m)</button></div>`;
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
      b.style.color = active ? "var(--text-primary)" : "var(--text-muted)";
      b.style.borderBottomColor = active ? "#0d9488" : "transparent";
      b.style.fontWeight = active ? "700" : "600";
    });
    if (tabId === "stat") {
      const cont = document.getElementById("forecast-tab-stat");
      if (cont) {
        if (_forecastStatDocs) {
          _renderForecastStatTab();
        } else {
          cont.innerHTML = '<div style="padding:60px 20px;text-align:center;color:var(--text-muted);font-size:14px"><div style="display:inline-block;width:24px;height:24px;border:3px solid #0d9488;border-top-color:transparent;border-radius:50%;animation:spin 0.8s linear infinite;margin-bottom:12px"></div><div>Cargando forecast_output desde Firestore...</div><style>@keyframes spin{to{transform:rotate(360deg)}}</style></div>';
          _loadForecastOutput().then(_renderForecastStatTab).catch((e) => {
            console.error("[FORECAST stat] load fail", e);
            const c = document.getElementById("forecast-tab-stat");
            if (c) {
              c.innerHTML = '<div style="padding:60px 20px;text-align:center;color:#dc2626;line-height:1.6"><div style="font-size:16px;font-weight:700;margin-bottom:12px">Error cargando forecast_output</div><div style="font-size:12px;color:var(--text-muted);margin-bottom:16px">' + escapeHtmlSafe(e.message || String(e)) + `</div><button onclick="switchForecastTab('stat')" style="padding:8px 14px;background:#0d9488;color:#fff;border:none;border-radius:6px;font-weight:700;cursor:pointer">Reintentar</button></div>`;
            }
          });
        }
      }
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
    const intro = '<div style="margin-bottom:16px;padding:12px 14px;background:var(--bg-secondary);border-left:3px solid #0d9488;border-radius:6px;font-size:12px;color:var(--text-secondary);line-height:1.5"><b style="color:var(--text-primary)">Fase 1</b> \u2014 Carg\xE1 los Sales Plans mensuales (Rods / Reels). Se parsea la hoja <b>SAR</b>: SKU, MOQ 12 months, y una columna por mes. El Excel original queda snapshotado en Storage y el parseo queda en Firestore para el c\xE1lculo debajo.</div>';
    const grid = '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px;margin-bottom:24px">' + slots + "</div>";
    const recoSection = '<div id="reco-section-container"></div>';
    cont.innerHTML = '<div style="padding:18px">' + intro + grid + recoSection + "</div>";
    _renderRecoSection();
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
      _salesPlanCaches[familia] = Object.assign({}, payload, { parsedAt: /* @__PURE__ */ new Date() });
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
    console.log("[FORECAST stat] loading forecast_output...");
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
    console.log("[FORECAST stat] loaded", docs.length, "docs \xB7 meta:", !!_forecastStatMeta);
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
    try {
      _renderForecastStatTabImpl(cont);
    } catch (e) {
      console.error("[FORECAST stat] render fail", e);
      cont.innerHTML = '<div style="padding:40px 20px;color:#dc2626;line-height:1.6"><div style="font-size:16px;font-weight:700;margin-bottom:10px">Error renderizando tab Forecast Estad\xEDstico</div><pre style="font-size:11px;background:#fef2f2;padding:12px;border-radius:6px;overflow:auto;white-space:pre-wrap">' + escapeHtmlSafe(e.stack || e.message || String(e)) + "</pre></div>";
    }
  }
  function _renderForecastStatTabImpl(cont) {
    const docs = _forecastStatDocs || [];
    const meta = _forecastStatMeta || {};
    const resumen = meta.resumen || {};
    console.log("[FORECAST stat] render \u2014 docs:", docs.length, "meta:", !!meta.generatedAt);
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
  async function _loadRecoData() {
    if (!window.fbDb) throw new Error("Firestore no inicializado");
    const promises = [];
    if (!_recoStockSnapshot) {
      promises.push(
        window.fbDb.collection("app_config").doc("stock_snapshot").get().then((d) => {
          const data = d.exists ? d.data() : {};
          let wh = {};
          let bo = {};
          try {
            wh = data.warehouseBreakdown ? JSON.parse(data.warehouseBreakdown) : {};
          } catch {
            wh = {};
          }
          try {
            bo = data.backorderBySku ? JSON.parse(data.backorderBySku) : {};
          } catch {
            bo = {};
          }
          _recoStockSnapshot = { warehouseBreakdown: wh, backorderBySku: bo };
        })
      );
    }
    if (!_recoVentasSnapshot) {
      promises.push(
        window.fbDb.collection("sku_ventas_snapshot").get().then((snap) => {
          const map = {};
          snap.forEach((doc) => {
            const d = doc.data();
            if (!d || !d.sku) return;
            map[String(d.sku).trim().toUpperCase()] = { meses: d.meses || {} };
          });
          _recoVentasSnapshot = map;
        })
      );
    }
    await Promise.all(promises);
  }
  function _computeVentaMensualPromedio(skuUpper) {
    const rec = _recoVentasSnapshot && _recoVentasSnapshot[skuUpper];
    if (!rec || !rec.meses) return 0;
    const hoy = /* @__PURE__ */ new Date();
    const monthsBack = [];
    for (let i = 1; i <= RECO_VENTA_PROMEDIO_WINDOW; i++) {
      const d = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1);
      monthsBack.push(String(d.getFullYear()) + "-" + String(d.getMonth() + 1).padStart(2, "0"));
    }
    let sum = 0;
    let n = 0;
    monthsBack.forEach((k) => {
      const m = rec.meses[k];
      if (m && Number.isFinite(Number(m.qty))) {
        sum += Number(m.qty);
        n++;
      }
    });
    return n > 0 ? sum / n : 0;
  }
  function _computeSalesPlanFuturo(row) {
    if (!row || !row.months) return 0;
    const hoy = /* @__PURE__ */ new Date();
    const currentKey = String(hoy.getFullYear()) + "-" + String(hoy.getMonth() + 1).padStart(2, "0");
    let sum = 0;
    Object.keys(row.months).forEach((k) => {
      if (k >= currentKey) sum += Number(row.months[k] || 0);
    });
    return sum;
  }
  function _computeRecommendations() {
    const rows = [];
    const familias = ["rods", "reels"];
    for (const fam of familias) {
      const cache = _salesPlanCaches[fam];
      if (!cache || !cache.rows) continue;
      for (const spRow of cache.rows) {
        const sku = String(spRow.sku || "").trim();
        const skuUpper = sku.toUpperCase();
        const stockWh = _recoStockSnapshot && _recoStockSnapshot.warehouseBreakdown && _recoStockSnapshot.warehouseBreakdown[sku] || {};
        const stockLibre = Number(stockWh["11"] || 0);
        const enTransito = Number(stockWh["12"] || 0);
        const backorder = Number(
          _recoStockSnapshot && _recoStockSnapshot.backorderBySku && _recoStockSnapshot.backorderBySku[sku] || 0
        );
        const ventaMensual = _computeVentaMensualPromedio(skuUpper);
        const salesPlanFut = _computeSalesPlanFuturo(spRow);
        const moq = Number(spRow.moq || 0);
        const multiplier = RECO_DEFAULT_MULTIPLIER;
        const demandaEsperada = ventaMensual * multiplier * RECO_HORIZON_MONTHS;
        const balance = stockLibre + enTransito + salesPlanFut - backorder - demandaEsperada;
        let recomendado = 0;
        if (balance < 0) {
          const deficit = -balance;
          recomendado = moq > 0 ? Math.max(moq, Math.ceil(deficit / moq) * moq) : Math.ceil(deficit);
        }
        rows.push({
          familia: fam,
          sku,
          description: spRow.description || "",
          moq,
          stockLibre,
          enTransito,
          backorder,
          ventaMensual: Math.round(ventaMensual * 10) / 10,
          salesPlanFut,
          multiplier,
          demandaEsperada: Math.round(demandaEsperada * 10) / 10,
          balance: Math.round(balance * 10) / 10,
          recomendado
        });
      }
    }
    rows.sort((a, b) => b.recomendado - a.recomendado);
    return rows;
  }
  function _fmtNumSigned(n) {
    if (n == null || !Number.isFinite(Number(n))) return "\u2014";
    const v = Number(n);
    const abs = Math.abs(v).toLocaleString("es-AR", { maximumFractionDigits: 0 });
    return (v < 0 ? "\u2212" : "") + abs;
  }
  function _fmtInt(n) {
    if (n == null || !Number.isFinite(Number(n))) return "\u2014";
    return Math.round(Number(n)).toLocaleString("es-AR");
  }
  function _renderRecoSection() {
    const cont = document.getElementById("reco-section-container");
    if (!cont) return;
    try {
      _renderRecoSectionImpl(cont);
    } catch (e) {
      console.error("[FORECAST reco] render fail", e);
      cont.innerHTML = '<div style="padding:20px;color:#dc2626"><div style="font-weight:700;margin-bottom:8px">Error renderizando tabla recomendaci\xF3n</div><pre style="font-size:11px;background:#fef2f2;padding:10px;border-radius:6px;overflow:auto;white-space:pre-wrap">' + escapeHtmlSafe(e.stack || e.message || String(e)) + "</pre></div>";
    }
  }
  function _renderRecoSectionImpl(cont) {
    const anyLoaded = !!(_salesPlanCaches.rods || _salesPlanCaches.reels);
    if (!anyLoaded) {
      cont.innerHTML = "";
      return;
    }
    if (!_recoStockSnapshot || !_recoVentasSnapshot) {
      cont.innerHTML = '<div style="padding:40px 18px;text-align:center;color:var(--text-muted)"><div style="display:inline-block;width:24px;height:24px;border:3px solid #0d9488;border-top-color:transparent;border-radius:50%;animation:spin 0.8s linear infinite;margin-bottom:10px"></div><div>Cargando stock + ventas hist\xF3ricas...</div><style>@keyframes spin{to{transform:rotate(360deg)}}</style></div>';
      _loadRecoData().then(_renderRecoSection).catch((e) => {
        console.error("[FORECAST reco] load fail", e);
        cont.innerHTML = '<div style="padding:20px;color:#dc2626">Error cargando datos: ' + escapeHtmlSafe(e.message || String(e)) + "</div>";
      });
      return;
    }
    const allRows = _computeRecommendations();
    const searchLc = _recoSearchText.trim().toLowerCase();
    const rows = allRows.filter((r) => {
      if (_recoFilterFamilia !== "all" && r.familia !== _recoFilterFamilia) return false;
      if (_recoFilterMinRec && r.recomendado <= 0) return false;
      if (searchLc) {
        const hay = r.sku.toLowerCase().includes(searchLc) || r.description.toLowerCase().includes(searchLc);
        if (!hay) return false;
      }
      return true;
    });
    const totalReco = allRows.reduce((s, r) => s + r.recomendado, 0);
    const totalConReco = allRows.filter((r) => r.recomendado > 0).length;
    const header = '<div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-bottom:12px"><div style="flex:1;min-width:280px"><div style="font-size:18px;font-weight:800;color:var(--text-primary)">Recomendaci\xF3n de Compra</div><div style="font-size:11px;color:var(--text-muted);margin-top:2px">Balance = Stock + Tr\xE1nsito + Plan \u2212 Backorder \u2212 (Venta mens. \xD7 ' + RECO_HORIZON_MONTHS + 'm)</div></div><div style="padding:6px 12px;background:#0d9488;color:#fff;border-radius:6px;font-size:12px;font-weight:700">' + _fmtInt(totalConReco) + ' SKUs con reco</div><div style="padding:6px 12px;background:#134e4a;color:#fff;border-radius:6px;font-size:12px;font-weight:700">\u03A3 ' + _fmtInt(totalReco) + " unidades</div></div>";
    const filters = '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:10px;padding:10px;background:var(--bg-secondary);border-radius:6px"><input type="text" id="reco-search" placeholder="Buscar SKU o descripcion..." value="' + escapeHtmlSafe(_recoSearchText) + '" oninput="onRecoSearchChange(event)" style="flex:1;min-width:200px;padding:6px 10px;border:1px solid var(--border-subtle);border-radius:4px;font-size:12px;background:var(--bg-elevated);color:var(--text-primary)"/><select onchange="onRecoFamiliaChange(event)" style="padding:6px 10px;border:1px solid var(--border-subtle);border-radius:4px;font-size:12px;background:var(--bg-elevated);color:var(--text-primary)"><option value="all"' + (_recoFilterFamilia === "all" ? " selected" : "") + '>Todas las familias</option><option value="rods"' + (_recoFilterFamilia === "rods" ? " selected" : "") + '>Solo Rods (Ca\xF1as)</option><option value="reels"' + (_recoFilterFamilia === "reels" ? " selected" : "") + '>Solo Reels</option></select><label style="display:inline-flex;align-items:center;gap:6px;padding:6px 10px;font-size:12px;color:var(--text-primary);cursor:pointer"><input type="checkbox"' + (_recoFilterMinRec ? " checked" : "") + ' onchange="onRecoFilterMinChange(event)"/>Solo con recomendado &gt; 0</label><button onclick="exportRecoExcel()" style="padding:6px 12px;background:#16a34a;color:#fff;border:none;border-radius:4px;font-size:12px;font-weight:700;cursor:pointer">\u2B07 Excel</button></div>';
    const rowsHtml = rows.map((r) => {
      const balColor = r.balance < 0 ? "#dc2626" : r.balance < 50 ? "#f59e0b" : "#16a34a";
      const recColor = r.recomendado > 0 ? "#dc2626" : "#94a3b8";
      return '<tr style="border-bottom:1px solid var(--border-subtle)"><td style="padding:6px 8px;text-align:center"><span style="display:inline-block;padding:2px 6px;border-radius:10px;background:' + (r.familia === "rods" ? "#0ea5e9" : "#8b5cf6") + ';color:#fff;font-size:10px;font-weight:700">' + (r.familia === "rods" ? "ROD" : "REEL") + '</span></td><td style="padding:6px 8px;text-align:center;font-family:monospace;font-size:11px;color:var(--text-primary);font-weight:700">' + escapeHtmlSafe(r.sku) + '</td><td style="padding:6px 8px;font-size:11px;color:var(--text-secondary);max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + escapeHtmlSafe(r.description) + '">' + escapeHtmlSafe(r.description) + '</td><td style="padding:6px 8px;text-align:center;font-variant-numeric:tabular-nums;color:var(--text-primary)">' + _fmtInt(r.stockLibre) + '</td><td style="padding:6px 8px;text-align:center;font-variant-numeric:tabular-nums;color:var(--text-muted)">' + _fmtInt(r.enTransito) + '</td><td style="padding:6px 8px;text-align:center;font-variant-numeric:tabular-nums;color:#dc2626">' + _fmtInt(r.backorder) + '</td><td style="padding:6px 8px;text-align:center;font-variant-numeric:tabular-nums;color:var(--text-secondary)">' + _fmtInt(r.ventaMensual) + '</td><td style="padding:6px 8px;text-align:center;font-variant-numeric:tabular-nums;color:var(--text-secondary)">' + _fmtInt(r.demandaEsperada) + '</td><td style="padding:6px 8px;text-align:center;font-variant-numeric:tabular-nums;color:var(--text-primary);font-weight:600">' + _fmtInt(r.salesPlanFut) + '</td><td style="padding:6px 8px;text-align:center;font-variant-numeric:tabular-nums;font-weight:700;color:' + balColor + '">' + _fmtNumSigned(r.balance) + '</td><td style="padding:6px 8px;text-align:center;font-variant-numeric:tabular-nums;color:var(--text-muted);font-size:11px">' + _fmtInt(r.moq) + '</td><td style="padding:6px 8px;text-align:center"><span style="display:inline-block;padding:4px 10px;border-radius:12px;background:' + recColor + ';color:#fff;font-size:12px;font-weight:800;min-width:50px">' + _fmtInt(r.recomendado) + "</span></td></tr>";
    }).join("");
    const table = '<div style="overflow:auto;max-height:60vh;border:1px solid var(--border-subtle);border-radius:8px"><table style="width:100%;border-collapse:collapse;font-size:12px"><thead style="background:#0f172a;color:#fff;position:sticky;top:0;z-index:1"><tr><th style="padding:8px;text-align:center;font-size:10px;text-transform:uppercase">Fam</th><th style="padding:8px;text-align:center;font-size:10px;text-transform:uppercase">SKU</th><th style="padding:8px;text-align:center;font-size:10px;text-transform:uppercase">Descripci\xF3n</th><th style="padding:8px;text-align:center;font-size:10px;text-transform:uppercase" title="Whs 11 disponible venta">Stock</th><th style="padding:8px;text-align:center;font-size:10px;text-transform:uppercase" title="Whs 12">Tr\xE1nsito</th><th style="padding:8px;text-align:center;font-size:10px;text-transform:uppercase">Backorder</th><th style="padding:8px;text-align:center;font-size:10px;text-transform:uppercase" title="Promedio \xFAltimos 3 meses">Vta/mes</th><th style="padding:8px;text-align:center;font-size:10px;text-transform:uppercase" title="Vta/mes \xD7 7 meses">Demanda esp.</th><th style="padding:8px;text-align:center;font-size:10px;text-transform:uppercase" title="Suma columnas Sales Plan desde mes actual">Plan futuro</th><th style="padding:8px;text-align:center;font-size:10px;text-transform:uppercase">Balance</th><th style="padding:8px;text-align:center;font-size:10px;text-transform:uppercase">MOQ</th><th style="padding:8px;text-align:center;font-size:10px;text-transform:uppercase;background:#134e4a">Recomendado</th></tr></thead><tbody>' + (rows.length ? rowsHtml : '<tr><td colspan="12" style="padding:40px;text-align:center;color:var(--text-muted)">Sin resultados con los filtros actuales</td></tr>') + "</tbody></table></div>";
    const footer = '<div style="margin-top:8px;font-size:10px;color:var(--text-muted)">Mostrando ' + _fmtInt(rows.length) + " de " + _fmtInt(allRows.length) + " SKUs \xB7 Balance = Stock + Tr\xE1nsito + Plan \u2212 Backorder \u2212 Demanda. Rojo = quiebre esperado. Recomendado se redondea al m\xFAltiplo de MOQ superior.</div>";
    cont.innerHTML = '<div style="padding:18px 18px 30px">' + header + filters + table + footer + "</div>";
  }
  window.onRecoSearchChange = function(ev) {
    _recoSearchText = ev.target.value || "";
    _renderRecoSection();
    setTimeout(() => {
      const inp = document.getElementById("reco-search");
      if (inp) {
        inp.focus();
        inp.setSelectionRange(inp.value.length, inp.value.length);
      }
    }, 0);
  };
  window.onRecoFamiliaChange = function(ev) {
    _recoFilterFamilia = ev.target.value || "all";
    _renderRecoSection();
  };
  window.onRecoFilterMinChange = function(ev) {
    _recoFilterMinRec = !!ev.target.checked;
    _renderRecoSection();
  };
  window.exportRecoExcel = function() {
    if (typeof XLSX === "undefined") {
      alert("SheetJS (XLSX) no cargado");
      return;
    }
    const rows = _computeRecommendations();
    const aoa = [
      [
        "Familia",
        "SKU",
        "Descripci\xF3n",
        "Stock",
        "Tr\xE1nsito",
        "Backorder",
        "Vta prom/mes",
        "Demanda esp. 7m",
        "Sales Plan futuro",
        "Balance",
        "MOQ",
        "Recomendado"
      ]
    ];
    for (const r of rows) {
      aoa.push([
        r.familia === "rods" ? "Rods (Ca\xF1as)" : "Reels",
        r.sku,
        r.description,
        r.stockLibre,
        r.enTransito,
        r.backorder,
        r.ventaMensual,
        r.demandaEsperada,
        r.salesPlanFut,
        r.balance,
        r.moq,
        r.recomendado
      ]);
    }
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = [
      { wch: 14 },
      { wch: 18 },
      { wch: 40 },
      { wch: 8 },
      { wch: 10 },
      { wch: 11 },
      { wch: 12 },
      { wch: 15 },
      { wch: 16 },
      { wch: 10 },
      { wch: 8 },
      { wch: 12 }
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Recomendaci\xF3n");
    const hoy = /* @__PURE__ */ new Date();
    const stamp = hoy.getFullYear() + "-" + String(hoy.getMonth() + 1).padStart(2, "0") + "-" + String(hoy.getDate()).padStart(2, "0");
    XLSX.writeFile(wb, "Recomendacion_Compra_" + stamp + ".xlsx");
  };
})();
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL3B1cmUvc2FsZXMtcGxhbi1wYXJzZXIuanMiLCAiLi4vc3JjL2RvbWFpbnMvZm9yZWNhc3QuanMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbIi8vIEB0cy1ub2NoZWNrXHJcbi8vIFB1cmU6IHBhcnNlYSB1biBzaGVldCBTYWxlcyBQbGFuIChmb3JtYXRvIFNVUi9TQVIgZGUgU2hpbWFubykgYSBlc3RydWN0dXJhXHJcbi8vIG5vcm1hbGl6YWRhIHsgc2t1LCBkZXNjcmlwdGlvbiwgbW9xLCBtb250aHM6IHsnWVlZWS1NTSc6IE59IH0uXHJcbi8vIFNpbiBkZXBlbmRlbmNpYXMgXHUyMDE0IHJlY2liZSBlbCBzaGVldCB5YSBkZXNlcmlhbGl6YWRvIHBvciBTaGVldEpTXHJcbi8vIChYTFNYLnV0aWxzLnNoZWV0X3RvX2pzb24oc2hlZXQsIHtoZWFkZXI6MSwgZGVmdmFsOicnfSkpLlxyXG4vLyBUZXN0ZWFibGUgZW4gdml0ZXN0IHNpbiBjYXJnYXIgWExTWC5cclxuLy9cclxuLy8gQ29udGV4dG86IGxvcyBTYWxlcyBQbGFucyBkZSBTaGltYW5vIHZpZW5lbiBjb24gaGVhZGVycyBjb21vXHJcbi8vIFwiU0tVIENvZGUvUGFydCBOb1wiLCBcIkRlc2NyaXB0aW9uXCIsIFwiTU9RIDEyIG1vbnRoc1wiIHkgY29sdW1uYXMgZGUgbWVzZXNcclxuLy8gdGlwbyBcIkphbiAyMDI3XCIsIFwiTWF5IDIwMjdcIiAoYSB2ZWNlcyBjb24gYVx1MDBGMW8gZW4gdW5hIGZpbGEgYXJyaWJhIHkgZWwgbWVzXHJcbi8vIGVuIGxhIGZpbGEgaGVhZGVyKS4gRXN0YSBmbiB0b2xlcmEgYW1ib3MgbGF5b3V0cy5cclxuXHJcbmNvbnN0IE1PTlRIX0FMSUFTRVMgPSB7XHJcbiAgamFuOiAxLFxyXG4gIGphbnVhcnk6IDEsXHJcbiAgZW5lOiAxLFxyXG4gIGVuZXJvOiAxLFxyXG4gIGZlYjogMixcclxuICBmZWJydWFyeTogMixcclxuICBmZWJyZXJvOiAyLFxyXG4gIG1hcjogMyxcclxuICBtYXJjaDogMyxcclxuICBtYXJ6bzogMyxcclxuICBhcHI6IDQsXHJcbiAgYXByaWw6IDQsXHJcbiAgYWJyOiA0LFxyXG4gIGFicmlsOiA0LFxyXG4gIG1heTogNSxcclxuICBtYXlvOiA1LFxyXG4gIGp1bjogNixcclxuICBqdW5lOiA2LFxyXG4gIGp1bmlvOiA2LFxyXG4gIGp1bDogNyxcclxuICBqdWx5OiA3LFxyXG4gIGp1bGlvOiA3LFxyXG4gIGF1ZzogOCxcclxuICBhdWd1c3Q6IDgsXHJcbiAgYWdvOiA4LFxyXG4gIGFnb3N0bzogOCxcclxuICBzZXA6IDksXHJcbiAgc2VwdDogOSxcclxuICBzZXB0ZW1iZXI6IDksXHJcbiAgc2VwdGllbWJyZTogOSxcclxuICBvY3Q6IDEwLFxyXG4gIG9jdG9iZXI6IDEwLFxyXG4gIG9jdHVicmU6IDEwLFxyXG4gIG5vdjogMTEsXHJcbiAgbm92ZW1iZXI6IDExLFxyXG4gIG5vdmllbWJyZTogMTEsXHJcbiAgZGVjOiAxMixcclxuICBkZWNlbWJlcjogMTIsXHJcbiAgZGljOiAxMixcclxuICBkaWNpZW1icmU6IDEyLFxyXG59O1xyXG5cclxuLy8gTm9ybWFsaXphIGxhYmVscyBkZSBtZXNlcyBhICdZWVlZLU1NJy4gUmV0b3JuYSBudWxsIHNpIG5vIG1hdGNoZWEuXHJcbi8vIEZvcm1hdG9zIHNvcG9ydGFkb3M6IFwiSmFuIDIwMjdcIiwgXCJFbmUtMjdcIiwgXCJKYW4vMjAyN1wiLCBcIk1heTI3XCIsXHJcbi8vIFwiMjAyNy0wMVwiLCBcIjAxLzIwMjdcIiwgXCJKYW4uMjAyN1wiLCBcIjIwMjFcXG5KYW5cIiAobXVsdGktbGluZSBFeGNlbCkuXHJcbmZ1bmN0aW9uIG5vcm1hbGl6ZU1vbnRoTGFiZWwobGFiZWwpIHtcclxuICBpZiAobGFiZWwgPT0gbnVsbCkgcmV0dXJuIG51bGw7XHJcbiAgLy8gdjExMDQ6IGNvbGFwc2FyIG5ld2xpbmVzL3RhYnMgYSBlc3BhY2lvIGFudGVzIGRlbCB0cmltLlxyXG4gIC8vIEVsIGZvcm1hdG8gRXhjZWwgXCIyMDIxXFxuSmFuXCIgKGFcdTAwRjFvIGVuIEwxLCBtZXMgZW4gTDIgZGVudHJvIGRlIHVuYSBjZWxkYVxyXG4gIC8vIG11bHRpLXJvdykgZXMgY29tXHUwMEZBbiBlbiBTYWxlcyBQbGFucyBTVVIuIGBcXHMrYCBtYXRjaGVhIHdoaXRlc3BhY2UgaW5jbHV5ZW5kb1xyXG4gIC8vIFxcbiB5IFxcclxcbi5cclxuICBjb25zdCBzID0gU3RyaW5nKGxhYmVsKS5yZXBsYWNlKC9cXHMrL2csICcgJykudHJpbSgpLnRvTG93ZXJDYXNlKCk7XHJcbiAgaWYgKCFzKSByZXR1cm4gbnVsbDtcclxuICBsZXQgbTtcclxuICAvLyBcImphbiAyMDI3XCIgfCBcImphbi0yN1wiIHwgXCJlbmUvMjAyN1wiIHwgXCJtYXkyN1wiIHwgXCJtYXkuMjAyN1wiXHJcbiAgbSA9IHMubWF0Y2goL14oW2Etelx1MDBFMVx1MDBFOVx1MDBFRFx1MDBGM1x1MDBGQV17MywxMH0pW1xcc1xcLS8uX10qKFxcZHsyLDR9KSQvKTtcclxuICBpZiAobSkge1xyXG4gICAgY29uc3QgbW9uID0gTU9OVEhfQUxJQVNFU1ttWzFdXSB8fCBNT05USF9BTElBU0VTW21bMV0uc2xpY2UoMCwgMyldO1xyXG4gICAgaWYgKG1vbikge1xyXG4gICAgICBsZXQgeSA9IHBhcnNlSW50KG1bMl0sIDEwKTtcclxuICAgICAgaWYgKHkgPCAxMDApIHkgPSAyMDAwICsgeTtcclxuICAgICAgcmV0dXJuIFN0cmluZyh5KS5wYWRTdGFydCg0LCAnMCcpICsgJy0nICsgU3RyaW5nKG1vbikucGFkU3RhcnQoMiwgJzAnKTtcclxuICAgIH1cclxuICB9XHJcbiAgLy8gXCIyMDIxIGphblwiIHwgXCIyMDI3IGRpY1wiIChhXHUwMEYxbyBwcmltZXJvICsgbWVzLCBmb3JtYXRvIEV4Y2VsIG11bHRpLWxpbmVcclxuICAvLyBjb2xhcHNhZG8gdHJhcyByZXBsYWNlIFxccyspLlxyXG4gIG0gPSBzLm1hdGNoKC9eKFxcZHs0fSlbXFxzXFwtLy5fXSsoW2Etelx1MDBFMVx1MDBFOVx1MDBFRFx1MDBGM1x1MDBGQV17MywxMH0pJC8pO1xyXG4gIGlmIChtKSB7XHJcbiAgICBjb25zdCB5ID0gcGFyc2VJbnQobVsxXSwgMTApO1xyXG4gICAgY29uc3QgbW9uID0gTU9OVEhfQUxJQVNFU1ttWzJdXSB8fCBNT05USF9BTElBU0VTW21bMl0uc2xpY2UoMCwgMyldO1xyXG4gICAgaWYgKG1vbikgcmV0dXJuIFN0cmluZyh5KS5wYWRTdGFydCg0LCAnMCcpICsgJy0nICsgU3RyaW5nKG1vbikucGFkU3RhcnQoMiwgJzAnKTtcclxuICB9XHJcbiAgLy8gXCIyMDI3LTAxXCIgfCBcIjIwMjcvMDFcIlxyXG4gIG0gPSBzLm1hdGNoKC9eKFxcZHs0fSlbLS9dKFxcZHsxLDJ9KSQvKTtcclxuICBpZiAobSkge1xyXG4gICAgY29uc3QgeSA9IHBhcnNlSW50KG1bMV0sIDEwKTtcclxuICAgIGNvbnN0IG1vbiA9IHBhcnNlSW50KG1bMl0sIDEwKTtcclxuICAgIGlmIChtb24gPj0gMSAmJiBtb24gPD0gMTIpXHJcbiAgICAgIHJldHVybiBTdHJpbmcoeSkucGFkU3RhcnQoNCwgJzAnKSArICctJyArIFN0cmluZyhtb24pLnBhZFN0YXJ0KDIsICcwJyk7XHJcbiAgfVxyXG4gIC8vIFwiMDEvMjAyN1wiIHwgXCIwMS0yMDI3XCJcclxuICBtID0gcy5tYXRjaCgvXihcXGR7MSwyfSlbLS9dKFxcZHs0fSkkLyk7XHJcbiAgaWYgKG0pIHtcclxuICAgIGNvbnN0IG1vbiA9IHBhcnNlSW50KG1bMV0sIDEwKTtcclxuICAgIGNvbnN0IHkgPSBwYXJzZUludChtWzJdLCAxMCk7XHJcbiAgICBpZiAobW9uID49IDEgJiYgbW9uIDw9IDEyKVxyXG4gICAgICByZXR1cm4gU3RyaW5nKHkpLnBhZFN0YXJ0KDQsICcwJykgKyAnLScgKyBTdHJpbmcobW9uKS5wYWRTdGFydCgyLCAnMCcpO1xyXG4gIH1cclxuICByZXR1cm4gbnVsbDtcclxufVxyXG5cclxuLy8gQnVzY2EgbGEgZmlsYSBoZWFkZXIgKDAtYmFzZWQpLiBFc2NhbmVhIGxhcyBwcmltZXJhcyAzMCBmaWxhcy5cclxuZnVuY3Rpb24gZmluZEhlYWRlclJvdyhyb3dzKSB7XHJcbiAgY29uc3QgSEVBREVSX01BUktFUlMgPSBbXHJcbiAgICAnc2t1IGNvZGUvcGFydCBubycsXHJcbiAgICAnc2t1IGNvZGUnLFxyXG4gICAgJ3NrdScsXHJcbiAgICAncGFydCBubycsXHJcbiAgICAncGFydCBudW1iZXInLFxyXG4gICAgJ2l0ZW1jb2RlJyxcclxuICAgICdpdGVtIGNvZGUnLFxyXG4gICAgJ2NvZGlnbycsXHJcbiAgICAnY1x1MDBGM2RpZ28nLFxyXG4gIF07XHJcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBNYXRoLm1pbihyb3dzLmxlbmd0aCwgMzApOyBpKyspIHtcclxuICAgIGNvbnN0IHJvdyA9IHJvd3NbaV0gfHwgW107XHJcbiAgICBmb3IgKGNvbnN0IGNlbGwgb2Ygcm93KSB7XHJcbiAgICAgIC8vIHYxMTA0OiBjb2xhcHNhciBuZXdsaW5lcyBhIGVzcGFjaW8gcGFyYSBtYXRjaGVhciBoZWFkZXJzIGNvbW9cclxuICAgICAgLy8gXCJTS1UgQ29kZS9QYXJ0IE5vXCIgKG9rKSBvIFwiU0tVXFxuQ29kZVwiIChuZWNlc2l0YSBjb2xhcHNhcikuXHJcbiAgICAgIGNvbnN0IHMgPSBTdHJpbmcoY2VsbCA9PSBudWxsID8gJycgOiBjZWxsKVxyXG4gICAgICAgIC5yZXBsYWNlKC9cXHMrL2csICcgJylcclxuICAgICAgICAudHJpbSgpXHJcbiAgICAgICAgLnRvTG93ZXJDYXNlKCk7XHJcbiAgICAgIGlmIChIRUFERVJfTUFSS0VSUy5pbmRleE9mKHMpID49IDApIHJldHVybiBpO1xyXG4gICAgfVxyXG4gIH1cclxuICByZXR1cm4gLTE7XHJcbn1cclxuXHJcbi8vIERldGVjdGEgXHUwMEVEbmRpY2VzIGRlIGNvbHVtbmFzIHkgbWVzZXMuIGBoaW50Um93QWJvdmVgIHBlcm1pdGUgY29tYmluYXIgYVx1MDBGMW8vbWVzXHJcbi8vIGN1YW5kbyBlbCBoZWFkZXIgZXMgbXVsdGktcm93IChhXHUwMEYxbyBhcnJpYmEsIG1lcyBhYmFqbyBvIHZpY2V2ZXJzYSkuXHJcbmZ1bmN0aW9uIGRldGVjdENvbHVtbnMoaGVhZGVyUm93LCBoaW50Um93QWJvdmUpIHtcclxuICBsZXQgc2t1SWR4ID0gLTE7XHJcbiAgbGV0IGRlc2NJZHggPSAtMTtcclxuICBsZXQgbW9xSWR4ID0gLTE7XHJcbiAgY29uc3QgbW9udGhDb2x1bW5zID0gW107XHJcbiAgY29uc3QgZGV0ZWN0ZWRNb250aHNTZXQgPSBuZXcgU2V0KCk7XHJcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBoZWFkZXJSb3cubGVuZ3RoOyBpKyspIHtcclxuICAgIC8vIHYxMTA0OiBjb2xhcHNhciBuZXdsaW5lcyBhIGVzcGFjaW8gYW50ZXMgZGUgY29tcGFyYXIuIExvcyBTYWxlcyBQbGFuXHJcbiAgICAvLyBTVVIgdGllbmVuIGhlYWRlcnMgbXVsdGktbGluZSBjb21vIFwiTU9RXFxuMTIgbW9udGhzXCIgbyBcIkJhc2VcXG5GT0IoVVNEKVwiLlxyXG4gICAgY29uc3QgcmF3ID0gU3RyaW5nKGhlYWRlclJvd1tpXSA9PSBudWxsID8gJycgOiBoZWFkZXJSb3dbaV0pXHJcbiAgICAgIC5yZXBsYWNlKC9cXHMrL2csICcgJylcclxuICAgICAgLnRyaW0oKTtcclxuICAgIGNvbnN0IHMgPSByYXcudG9Mb3dlckNhc2UoKTtcclxuICAgIGlmIChcclxuICAgICAgc2t1SWR4IDwgMCAmJlxyXG4gICAgICAocyA9PT0gJ3NrdSBjb2RlL3BhcnQgbm8nIHx8XHJcbiAgICAgICAgcyA9PT0gJ3NrdSBjb2RlJyB8fFxyXG4gICAgICAgIHMgPT09ICdza3UnIHx8XHJcbiAgICAgICAgcyA9PT0gJ3BhcnQgbm8nIHx8XHJcbiAgICAgICAgcyA9PT0gJ3BhcnQgbnVtYmVyJyB8fFxyXG4gICAgICAgIHMgPT09ICdpdGVtY29kZScgfHxcclxuICAgICAgICBzID09PSAnaXRlbSBjb2RlJyB8fFxyXG4gICAgICAgIHMgPT09ICdjb2RpZ28nIHx8XHJcbiAgICAgICAgcyA9PT0gJ2NcdTAwRjNkaWdvJylcclxuICAgICkge1xyXG4gICAgICBza3VJZHggPSBpO1xyXG4gICAgICBjb250aW51ZTtcclxuICAgIH1cclxuICAgIGlmIChcclxuICAgICAgZGVzY0lkeCA8IDAgJiZcclxuICAgICAgKHMgPT09ICdkZXNjcmlwdGlvbicgfHxcclxuICAgICAgICBzID09PSAnZGVzY3JpcGNpb24nIHx8XHJcbiAgICAgICAgcyA9PT0gJ2Rlc2NyaXBjaVx1MDBGM24nIHx8XHJcbiAgICAgICAgcyA9PT0gJ2l0ZW0gbmFtZScgfHxcclxuICAgICAgICBzID09PSAnaXRlbW5hbWUnKVxyXG4gICAgKSB7XHJcbiAgICAgIGRlc2NJZHggPSBpO1xyXG4gICAgICBjb250aW51ZTtcclxuICAgIH1cclxuICAgIGlmIChtb3FJZHggPCAwICYmIChzID09PSAnbW9xIDEyIG1vbnRocycgfHwgcyA9PT0gJ21vcScgfHwgcy5pbmRleE9mKCdtb3EnKSA9PT0gMCkpIHtcclxuICAgICAgbW9xSWR4ID0gaTtcclxuICAgICAgY29udGludWU7XHJcbiAgICB9XHJcbiAgICAvLyBUcnkgZGlyZWN0IG1vbnRoIHBhcnNlXHJcbiAgICBsZXQgbW9udGhLZXkgPSBub3JtYWxpemVNb250aExhYmVsKHJhdyk7XHJcbiAgICBpZiAoIW1vbnRoS2V5ICYmIGhpbnRSb3dBYm92ZSAmJiBoaW50Um93QWJvdmVbaV0gIT0gbnVsbCkge1xyXG4gICAgICBjb25zdCBoaW50ID0gU3RyaW5nKGhpbnRSb3dBYm92ZVtpXSkudHJpbSgpO1xyXG4gICAgICBpZiAoaGludCkge1xyXG4gICAgICAgIG1vbnRoS2V5ID0gbm9ybWFsaXplTW9udGhMYWJlbChyYXcgKyAnICcgKyBoaW50KSB8fCBub3JtYWxpemVNb250aExhYmVsKGhpbnQgKyAnICcgKyByYXcpO1xyXG4gICAgICB9XHJcbiAgICB9XHJcbiAgICBpZiAobW9udGhLZXkpIHtcclxuICAgICAgbW9udGhDb2x1bW5zLnB1c2goeyBjb2xJZHg6IGksIG1vbnRoS2V5IH0pO1xyXG4gICAgICBkZXRlY3RlZE1vbnRoc1NldC5hZGQobW9udGhLZXkpO1xyXG4gICAgfVxyXG4gIH1cclxuICByZXR1cm4ge1xyXG4gICAgc2t1SWR4LFxyXG4gICAgZGVzY0lkeCxcclxuICAgIG1vcUlkeCxcclxuICAgIG1vbnRoQ29sdW1ucyxcclxuICAgIGRldGVjdGVkTW9udGhzOiBBcnJheS5mcm9tKGRldGVjdGVkTW9udGhzU2V0KS5zb3J0KCksXHJcbiAgfTtcclxufVxyXG5cclxuLy8gUHVibGljOiBwYXJzZSBmdWxsIHNoZWV0LiBUaHJvd3Mgb24gbWlzc2luZyBTS1UgY29sdW1uIC8gbW9udGhzLlxyXG5mdW5jdGlvbiBwYXJzZVNhbGVzUGxhblNoZWV0KHJvd3MpIHtcclxuICBpZiAoIXJvd3MgfHwgIXJvd3MubGVuZ3RoKSB7XHJcbiAgICBjb25zdCBlcnIgPSBuZXcgRXJyb3IoJ0V4Y2VsIHZhY2lvJyk7XHJcbiAgICBlcnIuY29kZSA9ICdFTVBUWV9TSEVFVCc7XHJcbiAgICB0aHJvdyBlcnI7XHJcbiAgfVxyXG4gIGNvbnN0IGhlYWRlcklkeCA9IGZpbmRIZWFkZXJSb3cocm93cyk7XHJcbiAgaWYgKGhlYWRlcklkeCA8IDApIHtcclxuICAgIGNvbnN0IGVyciA9IG5ldyBFcnJvcignTm8gc2UgZW5jb250cm8gZmlsYSBkZSBoZWFkZXJzIChidXNjYWJhIFwiU0tVIENvZGUvUGFydCBOb1wiIG8gXCJTS1VcIiknKTtcclxuICAgIGVyci5jb2RlID0gJ0hFQURFUl9OT1RfRk9VTkQnO1xyXG4gICAgdGhyb3cgZXJyO1xyXG4gIH1cclxuICBjb25zdCBoZWFkZXJSb3cgPSByb3dzW2hlYWRlcklkeF0gfHwgW107XHJcbiAgY29uc3Qgcm93QWJvdmUgPSBoZWFkZXJJZHggPiAwID8gcm93c1toZWFkZXJJZHggLSAxXSB8fCBbXSA6IG51bGw7XHJcbiAgY29uc3QgY29scyA9IGRldGVjdENvbHVtbnMoaGVhZGVyUm93LCByb3dBYm92ZSk7XHJcbiAgaWYgKGNvbHMuc2t1SWR4IDwgMCkge1xyXG4gICAgY29uc3QgZXJyID0gbmV3IEVycm9yKCdObyBzZSBlbmNvbnRybyBjb2x1bW5hIFNLVSBlbiBsYSBmaWxhIGhlYWRlcicpO1xyXG4gICAgZXJyLmNvZGUgPSAnU0tVX0NPTF9NSVNTSU5HJztcclxuICAgIHRocm93IGVycjtcclxuICB9XHJcbiAgaWYgKCFjb2xzLm1vbnRoQ29sdW1ucy5sZW5ndGgpIHtcclxuICAgIGNvbnN0IGVyciA9IG5ldyBFcnJvcihcclxuICAgICAgJ05vIHNlIGRldGVjdGFyb24gY29sdW1uYXMgZGUgbWVzZXMgZW4gZWwgaGVhZGVyIChlajogXCJKYW4gMjAyN1wiLCBcIk1heSAyMDI3XCIpJ1xyXG4gICAgKTtcclxuICAgIGVyci5jb2RlID0gJ01PTlRIU19OT1RfRk9VTkQnO1xyXG4gICAgdGhyb3cgZXJyO1xyXG4gIH1cclxuICBjb25zdCBwYXJzZWRSb3dzID0gW107XHJcbiAgY29uc3Qgc2VlblNrdSA9IG5ldyBTZXQoKTtcclxuICBmb3IgKGxldCByID0gaGVhZGVySWR4ICsgMTsgciA8IHJvd3MubGVuZ3RoOyByKyspIHtcclxuICAgIGNvbnN0IHJvdyA9IHJvd3Nbcl0gfHwgW107XHJcbiAgICBjb25zdCBza3VSYXcgPSByb3dbY29scy5za3VJZHhdO1xyXG4gICAgaWYgKHNrdVJhdyA9PSBudWxsIHx8IFN0cmluZyhza3VSYXcpLnRyaW0oKSA9PT0gJycpIGNvbnRpbnVlO1xyXG4gICAgY29uc3Qgc2t1ID0gU3RyaW5nKHNrdVJhdykudHJpbSgpO1xyXG4gICAgY29uc3QgdXBwZXIgPSBza3UudG9VcHBlckNhc2UoKTtcclxuICAgIC8vIFNraXAgZmlsYXMgVE9UQUwgLyBTVU0gLyBTVUJUT1RBTFxyXG4gICAgaWYgKHVwcGVyID09PSAnVE9UQUwnIHx8IHVwcGVyID09PSAnU1VNJyB8fCB1cHBlciA9PT0gJ1NVQlRPVEFMJyB8fCB1cHBlciA9PT0gJ1RPVEFMRVMnKVxyXG4gICAgICBjb250aW51ZTtcclxuICAgIGlmIChzZWVuU2t1Lmhhcyh1cHBlcikpIGNvbnRpbnVlOyAvLyBkZWR1cGVcclxuICAgIHNlZW5Ta3UuYWRkKHVwcGVyKTtcclxuICAgIGNvbnN0IGRlc2NyaXB0aW9uID1cclxuICAgICAgY29scy5kZXNjSWR4ID49IDAgPyBTdHJpbmcocm93W2NvbHMuZGVzY0lkeF0gPT0gbnVsbCA/ICcnIDogcm93W2NvbHMuZGVzY0lkeF0pLnRyaW0oKSA6ICcnO1xyXG4gICAgY29uc3QgbW9xUmF3ID0gY29scy5tb3FJZHggPj0gMCA/IHJvd1tjb2xzLm1vcUlkeF0gOiBudWxsO1xyXG4gICAgY29uc3QgbW9xTnVtID0gTnVtYmVyKG1vcVJhdyk7XHJcbiAgICBjb25zdCBtb3EgPSBOdW1iZXIuaXNGaW5pdGUobW9xTnVtKSAmJiBtb3FOdW0gPiAwID8gTWF0aC5yb3VuZChtb3FOdW0pIDogMDtcclxuICAgIGNvbnN0IG1vbnRocyA9IHt9O1xyXG4gICAgZm9yIChjb25zdCBtYyBvZiBjb2xzLm1vbnRoQ29sdW1ucykge1xyXG4gICAgICBjb25zdCB2ID0gcm93W21jLmNvbElkeF07XHJcbiAgICAgIGNvbnN0IG4gPSBOdW1iZXIodik7XHJcbiAgICAgIGlmIChOdW1iZXIuaXNGaW5pdGUobikgJiYgbiA+IDApIHtcclxuICAgICAgICBtb250aHNbbWMubW9udGhLZXldID0gTWF0aC5yb3VuZChuKTtcclxuICAgICAgfVxyXG4gICAgfVxyXG4gICAgcGFyc2VkUm93cy5wdXNoKHsgc2t1LCBkZXNjcmlwdGlvbiwgbW9xLCBtb250aHMgfSk7XHJcbiAgfVxyXG4gIHJldHVybiB7XHJcbiAgICBoZWFkZXJSb3dJbmRleDogaGVhZGVySWR4LFxyXG4gICAgZGV0ZWN0ZWRNb250aHM6IGNvbHMuZGV0ZWN0ZWRNb250aHMsXHJcbiAgICByb3dzQ291bnQ6IHBhcnNlZFJvd3MubGVuZ3RoLFxyXG4gICAgcm93czogcGFyc2VkUm93cyxcclxuICB9O1xyXG59XHJcblxyXG4vLyBVTUQtaXNoIGV4cG9ydDogcGFyYSB2aXRlc3QgKG1vZHVsZS5leHBvcnRzKSB5IHBhcmEgYnVuZGxlIGJyb3dzZXIgKHdpbmRvdyBnbG9iYWwpLlxyXG5pZiAodHlwZW9mIG1vZHVsZSAhPT0gJ3VuZGVmaW5lZCcgJiYgbW9kdWxlLmV4cG9ydHMpIHtcclxuICBtb2R1bGUuZXhwb3J0cyA9IHsgcGFyc2VTYWxlc1BsYW5TaGVldCwgbm9ybWFsaXplTW9udGhMYWJlbCwgZmluZEhlYWRlclJvdywgZGV0ZWN0Q29sdW1ucyB9O1xyXG59XHJcbmlmICh0eXBlb2Ygd2luZG93ICE9PSAndW5kZWZpbmVkJykge1xyXG4gIHdpbmRvdy5TYWxlc1BsYW5QYXJzZXIgPSB7XHJcbiAgICBwYXJzZVNhbGVzUGxhblNoZWV0LFxyXG4gICAgbm9ybWFsaXplTW9udGhMYWJlbCxcclxuICAgIGZpbmRIZWFkZXJSb3csXHJcbiAgICBkZXRlY3RDb2x1bW5zLFxyXG4gIH07XHJcbn1cclxuXHJcbmV4cG9ydCB7IGRldGVjdENvbHVtbnMsIGZpbmRIZWFkZXJSb3csIG5vcm1hbGl6ZU1vbnRoTGFiZWwsIHBhcnNlU2FsZXNQbGFuU2hlZXQgfTtcclxuIiwgIi8vIEB0cy1ub2NoZWNrXHJcbi8vIHYxMDk4KyBGYXNlIDE6IGltcG9ydCBkZWwgcGFyc2VyIHB1cm8uIEVsIG1cdTAwRjNkdWxvIGhhY2UgYHdpbmRvdy5TYWxlc1BsYW5QYXJzZXJgXHJcbi8vIGNvbW8gc2lkZS1lZmZlY3QgeSB0YW1iaVx1MDBFOW4gZXhwb3J0YSBsYXMgZm5zIG5vbWJyYWRhczsgdXNhbW9zIHNpZGUtZWZmZWN0XHJcbi8vIHBvcnF1ZSBmb3JlY2FzdC5qcyBjb3JyZSBlbiBlbCBjaHVuayBsYXp5IHkgd2luZG93IHlhIGVzdFx1MDBFMSBkaXNwb25pYmxlLlxyXG5pbXBvcnQgJy4uL3B1cmUvc2FsZXMtcGxhbi1wYXJzZXIuanMnO1xyXG5cclxuLy8gR2xvYmFscyBsZWlkb3MgZGVsIGVudG9ybm8gKGRlY2xhcmFkb3MgZW4gaW5kZXguaHRtbCBpbmxpbmUgbyBidW5kbGUgcHJldmlvKTpcclxuLy8gZmJEYiwgY3VycmVudFVzZXIsIFhMU1ggKGNkbiksIGVzY2FwZUh0bWwuIE1pc21vIHBhdHJvbiBxdWUgb3Ryb3MgZG9taW5pb3MuXHJcbi8vXHJcbi8vIEZPUkVDQVNUIC0gbW9kYWwgYWRtaW4tb25seSAoTWFyaWFubykgcXVlIGNvbXBhcmEgdmVudGFzIGhpc3RvcmljYXNcclxuLy8gKEZpcmVzdG9yZSBza3VfdmVudGFzX3NuYXBzaG90LCBhbGltZW50YWRvIHBvciBzeW5jIEJRIHZfdmVudGFzX2xpbmVhc1xyXG4vLyB2ZW50YW5hIDEzbSkgdnMgU2FsZXMgUGxhbiBjYXJnYWRvIHBvciBlbCB1c2VyIHZpYSBFeGNlbCArIHBvbGl0aWNhIGRlXHJcbi8vIGludmVudGFyaW8gKHByb21lZGlvIFlURCB4IDMgbWVzZXMpLlxyXG4vL1xyXG4vLyBDaHVuayBsYXp5OiBzZSBjYXJnYSBzb2xvIGFsIHByaW1lciBjbGljayBkZWwgYm90b24gRk9SRUNBU1QgZGVsIGhlYWRlci5cclxuLy8gUmVnaXN0cmFkbyBlbiBidWlsZC5qcyBMQVpZX0NIVU5LUyArIHNyYy9tYWluLmpzIGluc3RhbGxDaHVua1N0dWJzICsgc3cuanNcclxuLy8gU1RBVElDX0FTU0VUUy4gVmVyIENMQVVERS5tZCAjMTggKDMgbHVnYXJlcyBzaW5jcm9uaXphZG9zKS5cclxuLy9cclxuLy8gQ29udHJhdG8gZGVsIEV4Y2VsIFNhbGVzIFBsYW4gcXVlIHN1YmUgZWwgdXNlcjpcclxuLy8gICBDb2x1bW5hczogU0tVIHwgTWVzMSB8IE1lczIgfCBNZXMzIHwgTWVzNCB8IE1lczUgfCBNZXM2XHJcbi8vICAgKG5vbWJyZXMgZXhhY3RvcyBkZSBoZWFkZXJzIGNhc2UtaW5zZW5zaXRpdmU7IE1lczEuLjYgc29uIGxvcyBwcm94aW1vc1xyXG4vLyAgIDYgbWVzZXMgZGVzZGUgZWwgbWVzIGFjdHVhbCkuIFVuYSBmaWxhIHBvciBTS1UuXHJcbi8vXHJcbi8vIEZ1ZW50ZSBkZSBkYXRvcyBoaXN0b3JpY2FzOlxyXG4vLyAgIEZpcmVzdG9yZSAvc2t1X3ZlbnRhc19zbmFwc2hvdC97U0tVXzxza3Vfc2FuZWFkbz59XHJcbi8vICAge1xyXG4vLyAgICAgc2t1LCBpdGVtTmFtZSwgZmFtaWxpYSwgc3ViZmFtaWxpYSxcclxuLy8gICAgIG1lc2VzOiB7ICcyMDI1LTA4Jzoge3F0eSwgYXJzfSwgLi4uLCAnMjAyNi0wOCc6IHtxdHksIGFyc30gfVxyXG4vLyAgIH1cclxuLy8gICBSdWxlczogcmVhZCBhZG1pbi1vbmx5IChjb21wZXRpdGl2ZWx5IHNlbnNpdGl2ZSkuIEVzY3JpdG8gcG9yIGNyb25cclxuLy8gICBzeW5jX3NhcF90b19iaWdxdWVyeS5weSBjYWRhIDMwIG1pbi5cclxuXHJcbi8vIEVzdGFkbyBkZWwgbW9kYWwgKGludHJhLWNodW5rLCBubyBjcm9zcy1zY29wZSkuXHJcbmxldCBfZm9yZWNhc3RTbmFwc2hvdCA9IG51bGw7IC8vIHsgU0tVOiB7ZmFtaWxpYSwgc3ViZmFtaWxpYSwgaXRlbU5hbWUsIG1lc2VzfSB9XHJcbmxldCBfZm9yZWNhc3RTYWxlc1BsYW4gPSBudWxsOyAvLyBbeyBza3UsIHBlZGlkb1RvdGFsLCBtZXNlc0FycjogW24xLi5uNl0gfV1cclxubGV0IF9mb3JlY2FzdFJvd3MgPSBudWxsOyAvLyBmaWxhcyBmaW5hbGVzIGNhbGN1bGFkYXMgcGFyYSBwcmV2aWV3ICsgZXhwb3J0XHJcbmxldCBfZm9yZWNhc3RMb2FkaW5nID0gZmFsc2U7XHJcblxyXG4vLyB2MTA5OCsgKEZhc2UgMSBGb3JlY2FzdCB2Mik6IFNhbGVzIFBsYW5zIG1lbnN1YWxlcyBwb3IgZmFtaWxpYSAoUm9kcy9SZWVscy9GRykuXHJcbi8vIFNlIGd1YXJkYW4gZW4gRmlyZXN0b3JlIGBzYWxlc19wbGFuX2NhY2hlL3tmYW1pbGlhfWAgKyBzbmFwc2hvdCBFeGNlbCBvcmlnaW5hbFxyXG4vLyBlbiBTdG9yYWdlIGBmb3JlY2FzdHNfc25hcHNob3RzL3tZWVlZLU1NfS97ZmFtaWxpYX0ueGxzeGAuXHJcbi8vIEVsIHBhcnNlciBwdXJvIHZpdmUgZW4gc3JjL3B1cmUvc2FsZXMtcGxhbi1wYXJzZXIuanMgKGF0dGFjaCBhIHdpbmRvdy5TYWxlc1BsYW5QYXJzZXIpLlxyXG4vLyB2MTEwODogRkcgcmVtb3ZpZG8gZGVsIFVJIChNYXJpYW5vIHBpZGlcdTAwRjMpLiBTb2xvIFJvZHMgKyBSZWVscyBwb3IgYWhvcmEuXHJcbi8vIExhIHJ1bGUgRmlyZXN0b3JlIHNpZ3VlIGFjZXB0YW5kbyAnZmcnIHBvciBzaSBlbiBlbCBmdXR1cm8gc2UgdnVlbHZlIGFcclxuLy8gYWN0aXZhciBcdTIwMTQgbm8gYm9ycmFybGEgZW4gc3RvcmFnZS9maXJlc3RvcmUucnVsZXMgaGFzdGEgY29uZmlybWFyIGRlcHJlY2F0ZS5cclxuY29uc3QgU0FMRVNfUExBTl9GQU1JTElBUyA9IFtcclxuICB7IGtleTogJ3JvZHMnLCBsYWJlbDogJ1JvZHMgKENhXHUwMEYxYXMpJywgY29sb3I6ICcjMGVhNWU5JyB9LFxyXG4gIHsga2V5OiAncmVlbHMnLCBsYWJlbDogJ1JlZWxzJywgY29sb3I6ICcjOGI1Y2Y2JyB9LFxyXG5dO1xyXG5jb25zdCBfc2FsZXNQbGFuQ2FjaGVzID0geyByb2RzOiBudWxsLCByZWVsczogbnVsbCB9OyAvLyBsYXN0IGxvYWRlZCBkb2NcclxubGV0IF9mb3JlY2FzdEFjdGl2ZVRhYiA9ICdzYWxlcy1wbGFucyc7IC8vICdzYWxlcy1wbGFucycgfCAnc3RhdCcgfCAnbGVnYWN5J1xyXG5cclxuLy8gdjExMDMrIChGYXNlIDJCKTogRm9yZWNhc3QgRXN0YWRcdTAwRURzdGljbyBcdTIwMTQgb3V0cHV0IHB1YmxpY2FkbyBwb3JcclxuLy8gc2NyaXB0cy9mb3JlY2FzdC9wdWJsaXNoX3RvX2ZpcmVzdG9yZS5weSBhIGZvcmVjYXN0X291dHB1dC97c3ViX3NsdWd9XHJcbi8vICsgZm9yZWNhc3Rfb3V0cHV0X21ldGEvY3VycmVudC4gMjQgc3VicyArIDEgbWV0YSBkb2MuXHJcbmxldCBfZm9yZWNhc3RTdGF0RG9jcyA9IG51bGw7IC8vIFt7aWQsIHN1YmZhbWlsaWEsIGZvcmVjYXN0WzddLCBtZXRyaWNzLCBiZXN0TW9kZWwsIHZlcnNpb25JZH1dXHJcbmxldCBfZm9yZWNhc3RTdGF0TWV0YSA9IG51bGw7IC8vIHtnZW5lcmF0ZWRBdCwgdmVyc2lvbklkLCByZXN1bWVuOiB7Li4ufX1cclxubGV0IF9mb3JlY2FzdFN0YXRIaXN0b3J5Q2FjaGUgPSBudWxsOyAvLyB7IFtzdWJdOiBbe2RzLCB5fV0gfSBjYWNoZSBsYXp5IG9uLWRlbWFuZFxyXG5cclxuLy8gdjExMDkrIChGYXNlIDNBKTogVGFibGEgUmVjb21lbmRhY2lcdTAwRjNuIGRlIENvbXByYSBcdTIwMTQgY29tYmluYSBzYWxlcyBwbGFucyArXHJcbi8vIHN0b2NrX3NuYXBzaG90ICsgc2t1X3ZlbnRhc19zbmFwc2hvdCBwYXJhIGNvbXB1dGFyIHJlY29tZW5kYWRvIHBvciBTS1UuXHJcbmxldCBfcmVjb1N0b2NrU25hcHNob3QgPSBudWxsOyAvLyB7d2FyZWhvdXNlQnJlYWtkb3duOiB7c2t1OnsnMTEnOm4sJzEyJzpuLC4uLn19LCBiYWNrb3JkZXJCeVNrdToge3NrdTpufX1cclxubGV0IF9yZWNvVmVudGFzU25hcHNob3QgPSBudWxsOyAvLyB7IFtTS1UgdXBwZXJdOiB7bWVzZXM6IHsnWVlZWS1NTSc6IHtxdHksYXJzfX19IH1cclxubGV0IF9yZWNvRmlsdGVyTWluUmVjID0gdHJ1ZTsgLy8gXCJzb2xvIG1vc3RyYXIgU0tVcyBjb24gcmVjb21lbmRhZG8gPiAwXCJcclxubGV0IF9yZWNvRmlsdGVyRmFtaWxpYSA9ICdhbGwnOyAvLyAnYWxsJyB8ICdyb2RzJyB8ICdyZWVscydcclxubGV0IF9yZWNvU2VhcmNoVGV4dCA9ICcnO1xyXG5cclxuY29uc3QgUkVDT19IT1JJWk9OX01PTlRIUyA9IDc7XHJcbmNvbnN0IFJFQ09fVkVOVEFfUFJPTUVESU9fV0lORE9XID0gMzsgLy8gbWVzZXMgaGFjaWEgYXRyXHUwMEUxcyBwYXJhIHByb21lZGlvIHZlbnRhXHJcbmNvbnN0IFJFQ09fREVGQVVMVF9NVUxUSVBMSUVSID0gMS4wO1xyXG5cclxuLy8gV2hpdGVsaXN0IGRlIGVtYWlscyBjb24gYWNjZXNvIGFsIG1vZGFsIEZPUkVDQVNULiBSZXBsaWNhIGVsIHBhdHJvbiBkZVxyXG4vLyBcIkFuYWxpc2lzXCIgKGluZGV4Lmh0bWw6MTI2MjUpLiBTb2xvIE1hcmlhbm87IHNpIG90cm8gYWRtaW4gbG8gbmVjZXNpdGFcclxuLy8gc2UgYWdyZWdhIGFjYSBleHBsaWNpdG8uXHJcbmNvbnN0IEZPUkVDQVNUX0FMTE9XRURfRU1BSUxTID0gWydtYXJpYW5vLmVyYmlub0BzaGltYW5vLmNvbS5hcicsICdlcmJpbm9tYXJpYW5vQGdtYWlsLmNvbSddO1xyXG5cclxuZnVuY3Rpb24gX2NhbkZvcmVjYXN0KCkge1xyXG4gIHRyeSB7XHJcbiAgICBjb25zdCBlbWFpbCA9ICgod2luZG93LmN1cnJlbnRVc2VyICYmIHdpbmRvdy5jdXJyZW50VXNlci5lbWFpbCkgfHwgJycpLnRvTG93ZXJDYXNlKCk7XHJcbiAgICBpZiAoIWVtYWlsKSByZXR1cm4gZmFsc2U7XHJcbiAgICByZXR1cm4gRk9SRUNBU1RfQUxMT1dFRF9FTUFJTFMuaW5kZXhPZihlbWFpbCkgPj0gMDtcclxuICB9IGNhdGNoIHtcclxuICAgIHJldHVybiBmYWxzZTtcclxuICB9XHJcbn1cclxuXHJcbi8vIEhlbHBlcnMgZGUgbWVzIGNhbGVuZGFyLlxyXG5mdW5jdGlvbiBfbW9udGhLZXkoeWVhciwgbW9udGhPbmVCYXNlZCkge1xyXG4gIHJldHVybiBTdHJpbmcoeWVhcikucGFkU3RhcnQoNCwgJzAnKSArICctJyArIFN0cmluZyhtb250aE9uZUJhc2VkKS5wYWRTdGFydCgyLCAnMCcpO1xyXG59XHJcbmZ1bmN0aW9uIF9tb250aExhYmVsKGtleSkge1xyXG4gIC8vICcyMDI2LTA4JyAtPiAnYWdvLTI2J1xyXG4gIGNvbnN0IFt5LCBtXSA9IGtleS5zcGxpdCgnLScpLm1hcChOdW1iZXIpO1xyXG4gIGNvbnN0IG5hbWVzID0gW1xyXG4gICAgJ2VuZScsXHJcbiAgICAnZmViJyxcclxuICAgICdtYXInLFxyXG4gICAgJ2FicicsXHJcbiAgICAnbWF5JyxcclxuICAgICdqdW4nLFxyXG4gICAgJ2p1bCcsXHJcbiAgICAnYWdvJyxcclxuICAgICdzZXAnLFxyXG4gICAgJ29jdCcsXHJcbiAgICAnbm92JyxcclxuICAgICdkaWMnLFxyXG4gIF07XHJcbiAgcmV0dXJuIG5hbWVzW20gLSAxXSArICctJyArIFN0cmluZyh5KS5zbGljZSgtMik7XHJcbn1cclxuZnVuY3Rpb24gX2FkZE1vbnRocyh5ZWFyLCBtb250aE9uZUJhc2VkLCBkZWx0YSkge1xyXG4gIGNvbnN0IHRvdGFsTW9udGhzID0geWVhciAqIDEyICsgKG1vbnRoT25lQmFzZWQgLSAxKSArIGRlbHRhO1xyXG4gIGNvbnN0IHkgPSBNYXRoLmZsb29yKHRvdGFsTW9udGhzIC8gMTIpO1xyXG4gIGNvbnN0IG0gPSAodG90YWxNb250aHMgJSAxMikgKyAxO1xyXG4gIHJldHVybiB7IHksIG0gfTtcclxufVxyXG5cclxuLy8gU3VtYSBxdHkgZGVsIFNLVSBlbiBsb3MgdWx0aW1vcyAxMiBNRVNFUyBDT01QTEVUT1MgKGV4Y2x1eWUgZWwgbWVzIGFjdHVhbFxyXG4vLyBwYXJjaWFsIC0gbGEgdmVudGFuYSBtb3ZpbCBcIjEyIG1lc2VzIGNlcnJhZG9zXCIgcXVlIGVsIHVzZXIgcGllbnNhIGNvbW9cclxuLy8gXCJlbCBhXHUwMEYxbyBxdWUgeWEgcGFzb1wiKS4gRWplbXBsbyBlbiBhZ29zdG8gMjAyNjogc3VtYXIgYWdvLTI1IGEganVsLTI2LlxyXG5mdW5jdGlvbiBfc3VtVmVudGFzMTJtQ29tcGxldG9zKG1lc2VzTWFwLCBob3kpIHtcclxuICBpZiAoIW1lc2VzTWFwKSByZXR1cm4gMDtcclxuICBsZXQgc3VtID0gMDtcclxuICBjb25zdCBzdGFydE1vbnRoID0gX2FkZE1vbnRocyhob3kuZ2V0RnVsbFllYXIoKSwgaG95LmdldE1vbnRoKCkgKyAxLCAtMTIpO1xyXG4gIGNvbnN0IGVuZE1vbnRoID0gX2FkZE1vbnRocyhob3kuZ2V0RnVsbFllYXIoKSwgaG95LmdldE1vbnRoKCkgKyAxLCAtMSk7XHJcbiAgY29uc3Qgc3RhcnRLZXkgPSBfbW9udGhLZXkoc3RhcnRNb250aC55LCBzdGFydE1vbnRoLm0pO1xyXG4gIGNvbnN0IGVuZEtleSA9IF9tb250aEtleShlbmRNb250aC55LCBlbmRNb250aC5tKTtcclxuICBmb3IgKGNvbnN0IGsgb2YgT2JqZWN0LmtleXMobWVzZXNNYXApKSB7XHJcbiAgICBpZiAoayA+PSBzdGFydEtleSAmJiBrIDw9IGVuZEtleSkge1xyXG4gICAgICBzdW0gKz0gTnVtYmVyKChtZXNlc01hcFtrXSAmJiBtZXNlc01hcFtrXS5xdHkpIHx8IDApO1xyXG4gICAgfVxyXG4gIH1cclxuICByZXR1cm4gc3VtO1xyXG59XHJcblxyXG4vLyBTdW1hIHF0eSBkZWwgU0tVIFlURCAoZW5lcm8gZGVsIGFcdTAwRjFvIGFjdHVhbCBoYXN0YSBtZXMgYWN0dWFsIElOQ0xVU0lWTyxcclxuLy8gYXVucXVlIGVsIG1lcyBhY3R1YWwgc2VhIHBhcmNpYWwpLiBSZXRvcm5hIHsgdG90YWxZdGQsIG1lc2VzVHJhbnNjdXJyaWRvcyB9LlxyXG4vLyBFamVtcGxvIGFnb3N0byAyMDI2IGNvbiB2ZW50YXMganVsPTEwICsgYWdvPTIwIC0+IHszMCwgOH0sIHByb21lZGlvPTMwLzg9My43NS5cclxuLy8gKFNpIGVsIHVzdWFyaW8gZXNwZXJhYmEgZGl2aWRpciBwb3IgMiBlbiB2ZXogZGUgOCwgcmV2aXNhciBzcGVjLiBFbCBwZWRpZG9cclxuLy8gZGljZSBcImNhbnRpZGFkIGRlIG1lc2VzIHF1ZSB0cmFuc2N1cnJpbW9zXCIgPSBtZXNlcyBkZWwgYVx1MDBGMW8gcGFzYWRvcyBoYXN0YSBob3kuKVxyXG5mdW5jdGlvbiBfc3VtVmVudGFzWVREKG1lc2VzTWFwLCBob3kpIHtcclxuICBjb25zdCB5ZWFyID0gaG95LmdldEZ1bGxZZWFyKCk7XHJcbiAgY29uc3QgbWVzQWN0dWFsID0gaG95LmdldE1vbnRoKCkgKyAxO1xyXG4gIGxldCB0b3RhbCA9IDA7XHJcbiAgaWYgKG1lc2VzTWFwKSB7XHJcbiAgICBmb3IgKGxldCBtID0gMTsgbSA8PSBtZXNBY3R1YWw7IG0rKykge1xyXG4gICAgICBjb25zdCBrID0gX21vbnRoS2V5KHllYXIsIG0pO1xyXG4gICAgICB0b3RhbCArPSBOdW1iZXIoKG1lc2VzTWFwW2tdICYmIG1lc2VzTWFwW2tdLnF0eSkgfHwgMCk7XHJcbiAgICB9XHJcbiAgfVxyXG4gIHJldHVybiB7IHRvdGFsWXRkOiB0b3RhbCwgbWVzZXNUcmFuc2N1cnJpZG9zOiBtZXNBY3R1YWwgfTtcclxufVxyXG5cclxuLy8gQ2FyZ2Egc2t1X3ZlbnRhc19zbmFwc2hvdCBjb21wbGV0byAodW5hIHZleiBwb3Igc2VzaW9uIGRlbCBtb2RhbCkuXHJcbmFzeW5jIGZ1bmN0aW9uIF9sb2FkU25hcHNob3QoKSB7XHJcbiAgaWYgKF9mb3JlY2FzdFNuYXBzaG90KSByZXR1cm4gX2ZvcmVjYXN0U25hcHNob3Q7XHJcbiAgaWYgKCF3aW5kb3cuZmJEYikgdGhyb3cgbmV3IEVycm9yKCdGaXJlc3RvcmUgbm8gaW5pY2lhbGl6YWRvJyk7XHJcbiAgY29uc3Qgc25hcCA9IGF3YWl0IHdpbmRvdy5mYkRiLmNvbGxlY3Rpb24oJ3NrdV92ZW50YXNfc25hcHNob3QnKS5nZXQoKTtcclxuICBjb25zdCBieU9yaWdpbmFsU2t1ID0ge307XHJcbiAgY29uc3QgYnlVcHBlclNrdSA9IHt9O1xyXG4gIHNuYXAuZm9yRWFjaCgoZG9jKSA9PiB7XHJcbiAgICBjb25zdCBkID0gZG9jLmRhdGEoKTtcclxuICAgIGlmICghZCB8fCAhZC5za3UpIHJldHVybjtcclxuICAgIGNvbnN0IHNrdVVwcGVyID0gU3RyaW5nKGQuc2t1KS50cmltKCkudG9VcHBlckNhc2UoKTtcclxuICAgIGNvbnN0IHJlY29yZCA9IHtcclxuICAgICAgc2t1OiBkLnNrdSxcclxuICAgICAgaXRlbU5hbWU6IGQuaXRlbU5hbWUgfHwgJycsXHJcbiAgICAgIGZhbWlsaWE6IGQuZmFtaWxpYSB8fCAnJyxcclxuICAgICAgc3ViZmFtaWxpYTogZC5zdWJmYW1pbGlhIHx8ICcnLFxyXG4gICAgICBtZXNlczogZC5tZXNlcyB8fCB7fSxcclxuICAgIH07XHJcbiAgICBieU9yaWdpbmFsU2t1W2Quc2t1XSA9IHJlY29yZDtcclxuICAgIGJ5VXBwZXJTa3Vbc2t1VXBwZXJdID0gcmVjb3JkO1xyXG4gIH0pO1xyXG4gIF9mb3JlY2FzdFNuYXBzaG90ID0geyBieU9yaWdpbmFsU2t1LCBieVVwcGVyU2t1LCBjb3VudDogc25hcC5zaXplIH07XHJcbiAgcmV0dXJuIF9mb3JlY2FzdFNuYXBzaG90O1xyXG59XHJcblxyXG4vLyBQYXJzZWEgZWwgRXhjZWwgU2FsZXMgUGxhbi4gRXNwZXJhIGNvbHVtbmFzIFNLVSArIDYgY29sdW1uYXMgbnVtZXJpY2FzXHJcbi8vIChub21icmVzIGZsZXhpYmxlczogTWVzMS4uTWVzNiwgbWVzXzEuLm1lc182LCBvIGN1YWxxdWllciBoZWFkZXIgY3VzdG9tXHJcbi8vIG1pZW50cmFzIGxhIHByaW1lcmEgc2VhIFNLVSB5IGhheWEgYWwgbWVub3MgNiBjb2x1bW5hcyBudW1lcmljYXMgbWFzKS5cclxuZnVuY3Rpb24gX3BhcnNlU2FsZXNQbGFuUm93cyhyb3dzUmF3KSB7XHJcbiAgaWYgKCFyb3dzUmF3IHx8ICFyb3dzUmF3Lmxlbmd0aCkgcmV0dXJuIFtdO1xyXG4gIGNvbnN0IGhlYWRlclJvdyA9IHJvd3NSYXdbMF07XHJcbiAgLy8gRGV0ZWN0YXIgaW5kaWNlIGRlIGNvbHVtbmEgU0tVXHJcbiAgbGV0IHNrdUNvbElkeCA9IC0xO1xyXG4gIGZvciAobGV0IGkgPSAwOyBpIDwgaGVhZGVyUm93Lmxlbmd0aDsgaSsrKSB7XHJcbiAgICBjb25zdCBoID0gU3RyaW5nKGhlYWRlclJvd1tpXSB8fCAnJylcclxuICAgICAgLnRyaW0oKVxyXG4gICAgICAudG9VcHBlckNhc2UoKTtcclxuICAgIGlmIChoID09PSAnU0tVJyB8fCBoID09PSAnSVRFTUNPREUnIHx8IGggPT09ICdJVEVNJyB8fCBoID09PSAnSVRFTSBDT0RFJyB8fCBoID09PSAnQ09ESUdPJykge1xyXG4gICAgICBza3VDb2xJZHggPSBpO1xyXG4gICAgICBicmVhaztcclxuICAgIH1cclxuICB9XHJcbiAgaWYgKHNrdUNvbElkeCA8IDApXHJcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ0VsIEV4Y2VsIGRlYmUgdGVuZXIgdW5hIGNvbHVtbmEgbGxhbWFkYSBcIlNLVVwiIChvIENvZGlnbyAvIEl0ZW1Db2RlIC8gSXRlbSknKTtcclxuICAvLyBMYXMgNiBjb2x1bW5hcyBkZSBtZXNlczogbGFzIHByaW1lcmFzIDYgY29sdW1uYXMgcXVlIHNlYW4gIT0gc2t1Q29sSWR4LlxyXG4gIGNvbnN0IG1vbnRoQ29scyA9IFtdO1xyXG4gIGZvciAobGV0IGkgPSAwOyBpIDwgaGVhZGVyUm93Lmxlbmd0aCAmJiBtb250aENvbHMubGVuZ3RoIDwgNjsgaSsrKSB7XHJcbiAgICBpZiAoaSAhPT0gc2t1Q29sSWR4KSBtb250aENvbHMucHVzaChpKTtcclxuICB9XHJcbiAgaWYgKG1vbnRoQ29scy5sZW5ndGggPCA2KVxyXG4gICAgdGhyb3cgbmV3IEVycm9yKFxyXG4gICAgICAnRWwgRXhjZWwgZGViZSB0ZW5lciBhbCBtZW5vcyA2IGNvbHVtbmFzIGRlIG1lc2VzIGFkZW1hcyBkZSBTS1UgKGVuY29udHJhZGFzOiAnICtcclxuICAgICAgICBtb250aENvbHMubGVuZ3RoICtcclxuICAgICAgICAnKSdcclxuICAgICk7XHJcbiAgY29uc3Qgb3V0ID0gW107XHJcbiAgZm9yIChsZXQgciA9IDE7IHIgPCByb3dzUmF3Lmxlbmd0aDsgcisrKSB7XHJcbiAgICBjb25zdCByb3cgPSByb3dzUmF3W3JdO1xyXG4gICAgaWYgKCFyb3cgfHwgIXJvdy5sZW5ndGgpIGNvbnRpbnVlO1xyXG4gICAgY29uc3Qgc2t1UmF3ID0gcm93W3NrdUNvbElkeF07XHJcbiAgICBpZiAoc2t1UmF3ID09PSB1bmRlZmluZWQgfHwgc2t1UmF3ID09PSBudWxsIHx8IFN0cmluZyhza3VSYXcpLnRyaW0oKSA9PT0gJycpIGNvbnRpbnVlO1xyXG4gICAgY29uc3Qgc2t1ID0gU3RyaW5nKHNrdVJhdykudHJpbSgpO1xyXG4gICAgY29uc3QgbWVzZXNBcnIgPSBtb250aENvbHMubWFwKChpKSA9PiB7XHJcbiAgICAgIGNvbnN0IHYgPSByb3dbaV07XHJcbiAgICAgIGNvbnN0IG4gPSBOdW1iZXIodik7XHJcbiAgICAgIHJldHVybiBOdW1iZXIuaXNGaW5pdGUobikgPyBuIDogMDtcclxuICAgIH0pO1xyXG4gICAgY29uc3QgcGVkaWRvVG90YWwgPSBtZXNlc0Fyci5yZWR1Y2UoKGEsIGIpID0+IGEgKyBiLCAwKTtcclxuICAgIG91dC5wdXNoKHsgc2t1LCBtZXNlc0FyciwgcGVkaWRvVG90YWwgfSk7XHJcbiAgfVxyXG4gIHJldHVybiBvdXQ7XHJcbn1cclxuXHJcbi8vIENhbGN1bGEgbGFzIGZpbGFzIGZpbmFsZXMgY3J1emFuZG8gc25hcHNob3QgKyBzYWxlcyBwbGFuLlxyXG5mdW5jdGlvbiBfY29tcHV0ZUZvcmVjYXN0Um93cyhzbmFwc2hvdCwgc2FsZXNQbGFuLCBob3kpIHtcclxuICBjb25zdCByb3dzID0gW107XHJcbiAgZm9yIChjb25zdCBzcCBvZiBzYWxlc1BsYW4pIHtcclxuICAgIGNvbnN0IHNrdVVwcGVyID0gc3Auc2t1LnRvVXBwZXJDYXNlKCk7XHJcbiAgICBjb25zdCBoaXN0ID0gc25hcHNob3QuYnlVcHBlclNrdVtza3VVcHBlcl0gfHwgbnVsbDtcclxuICAgIGNvbnN0IHZlbnRhczEybSA9IGhpc3QgPyBfc3VtVmVudGFzMTJtQ29tcGxldG9zKGhpc3QubWVzZXMsIGhveSkgOiAwO1xyXG4gICAgY29uc3QgeXRkID0gaGlzdFxyXG4gICAgICA/IF9zdW1WZW50YXNZVEQoaGlzdC5tZXNlcywgaG95KVxyXG4gICAgICA6IHsgdG90YWxZdGQ6IDAsIG1lc2VzVHJhbnNjdXJyaWRvczogaG95LmdldE1vbnRoKCkgKyAxIH07XHJcbiAgICBjb25zdCBwcm9tZWRpbyA9IHl0ZC5tZXNlc1RyYW5zY3Vycmlkb3MgPiAwID8geXRkLnRvdGFsWXRkIC8geXRkLm1lc2VzVHJhbnNjdXJyaWRvcyA6IDA7XHJcbiAgICBjb25zdCBwb2xpdGljYSA9IHByb21lZGlvICogMztcclxuICAgIGNvbnN0IHRvdGFsID0gc3AucGVkaWRvVG90YWwgLSBwb2xpdGljYTtcclxuICAgIHJvd3MucHVzaCh7XHJcbiAgICAgIHNrdTogc3Auc2t1LFxyXG4gICAgICBpdGVtTmFtZTogaGlzdCA/IGhpc3QuaXRlbU5hbWUgOiAnJyxcclxuICAgICAgZmFtaWxpYTogaGlzdCA/IGhpc3QuZmFtaWxpYSA6ICcoc2luIG1hdGNoKScsXHJcbiAgICAgIHN1YmZhbWlsaWE6IGhpc3QgPyBoaXN0LnN1YmZhbWlsaWEgOiAnKHNpbiBtYXRjaCknLFxyXG4gICAgICB2ZW50YXMxMm06IHZlbnRhczEybSxcclxuICAgICAgcGVkaWRvNm06IHNwLnBlZGlkb1RvdGFsLFxyXG4gICAgICBwcm9tZWRpbzogcHJvbWVkaW8sXHJcbiAgICAgIHBvbGl0aWNhOiBwb2xpdGljYSxcclxuICAgICAgdG90YWw6IHRvdGFsLFxyXG4gICAgICBoYXNIaXN0b3JpYTogISFoaXN0LFxyXG4gICAgfSk7XHJcbiAgfVxyXG4gIHJldHVybiByb3dzO1xyXG59XHJcblxyXG5mdW5jdGlvbiBfcmVuZGVyTW9kYWxTaGVsbCgpIHtcclxuICBjb25zdCBleGlzdGluZyA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdmb3JlY2FzdC1tb2RhbCcpO1xyXG4gIGlmIChleGlzdGluZykgcmV0dXJuIGV4aXN0aW5nO1xyXG4gIGNvbnN0IGVsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2Jyk7XHJcbiAgZWwuaWQgPSAnZm9yZWNhc3QtbW9kYWwnO1xyXG4gIGVsLmNsYXNzTmFtZSA9ICdtb2RhbC1vdmVybGF5JztcclxuICBlbC5zdHlsZS5jc3NUZXh0ID1cclxuICAgICdkaXNwbGF5Om5vbmU7cG9zaXRpb246Zml4ZWQ7aW5zZXQ6MDtiYWNrZ3JvdW5kOnJnYmEoMTUsMjMsNDIsLjYpO3otaW5kZXg6MjA1MDsnO1xyXG4gIGVsLm9uY2xpY2sgPSBmdW5jdGlvbiAoZXYpIHtcclxuICAgIGlmIChldi50YXJnZXQgPT09IGVsKSB3aW5kb3cuY2xvc2VGb3JlY2FzdE1vZGFsKCk7XHJcbiAgfTtcclxuICAvLyBTaGVsbCArIHRhYnMgYmFyICsgMiBjb250ZW5lZG9yZXMgZGUgdGFicyAoU2FsZXMgUGxhbnMgbnVldmEsIExlZ2FjeSA2bSkuXHJcbiAgLy8gRWwgY29udGVuaWRvIGRlIGNhZGEgdGFiIHNlIHBpbnRhIGNvbiBfcmVuZGVyU2FsZXNQbGFuc1RhYigpIHkgZWwgbGVnYWN5XHJcbiAgLy8gdXNhIGVsIGZsdWpvIF9yZW5kZXJUYWJsZSgpIGRlIHNpZW1wcmUuXHJcbiAgY29uc3Qgc2hlbGxIdG1sID0gX2J1aWxkU2hlbGxIdG1sKCk7XHJcbiAgZWwuaW5uZXJIVE1MID0gc2hlbGxIdG1sO1xyXG4gIGRvY3VtZW50LmJvZHkuYXBwZW5kQ2hpbGQoZWwpO1xyXG4gIHJldHVybiBlbDtcclxufVxyXG5cclxuZnVuY3Rpb24gX2J1aWxkU2hlbGxIdG1sKCkge1xyXG4gIC8vIEJyb2tlbi1vdXQgcHVyZSBzdHJpbmcgYnVpbGRlciBwYXJhIHBhc2FyIGVsIGhvb2sgZGUgaW5uZXJIVE1MLlxyXG4gIGNvbnN0IG1vZGFsT3V0ZXIgPVxyXG4gICAgJzxkaXYgc3R5bGU9XCJwb3NpdGlvbjphYnNvbHV0ZTtpbnNldDoxdmggMXZ3O2JhY2tncm91bmQ6dmFyKC0tYmctZWxldmF0ZWQpO2JvcmRlci1yYWRpdXM6MTBweDtkaXNwbGF5OmZsZXg7ZmxleC1kaXJlY3Rpb246Y29sdW1uO292ZXJmbG93OmhpZGRlbjtib3gtc2hhZG93OjAgMjBweCA1MHB4IHJnYmEoMCwwLDAsLjM1KVwiPic7XHJcbiAgY29uc3QgaGVhZGVyID1cclxuICAgICc8ZGl2IHN0eWxlPVwicGFkZGluZzoxMnB4IDE4cHg7YmFja2dyb3VuZDojMGYxNzJhO2NvbG9yOiNmZmY7ZGlzcGxheTpmbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtnYXA6MTJweFwiPicgK1xyXG4gICAgJzxkaXYgc3R5bGU9XCJmbGV4OjFcIj48ZGl2IHN0eWxlPVwiZm9udC1zaXplOjE2cHg7Zm9udC13ZWlnaHQ6ODAwO2xldHRlci1zcGFjaW5nOi41cHhcIj5GT1JFQ0FTVDwvZGl2PicgK1xyXG4gICAgJzxkaXYgaWQ9XCJmb3JlY2FzdC1zdWJ0aXRsZVwiIHN0eWxlPVwiZm9udC1zaXplOjExcHg7b3BhY2l0eTouODttYXJnaW4tdG9wOjJweFwiPlNhbGVzIFBsYW5zIG1lbnN1YWxlcyArIHBvbGl0aWNhIGRlIGludmVudGFyaW88L2Rpdj48L2Rpdj4nICtcclxuICAgICc8YnV0dG9uIG9uY2xpY2s9XCJjbG9zZUZvcmVjYXN0TW9kYWwoKVwiIHN0eWxlPVwiYmFja2dyb3VuZDp0cmFuc3BhcmVudDtjb2xvcjojZmZmO2JvcmRlcjoxcHggc29saWQgcmdiYSgyNTUsMjU1LDI1NSwuNCk7Ym9yZGVyLXJhZGl1czo2cHg7cGFkZGluZzo2cHggMTBweDtjdXJzb3I6cG9pbnRlcjtmb250LXdlaWdodDo3MDBcIj5DZXJyYXI8L2J1dHRvbj4nICtcclxuICAgICc8L2Rpdj4nO1xyXG4gIGNvbnN0IHRhYnNCYXIgPVxyXG4gICAgJzxkaXYgaWQ9XCJmb3JlY2FzdC10YWJzLWJhclwiIHN0eWxlPVwiZGlzcGxheTpmbGV4O2dhcDowO2JhY2tncm91bmQ6dmFyKC0tYmctc2Vjb25kYXJ5KTtwYWRkaW5nOjAgMThweDtib3JkZXItYm90dG9tOjFweCBzb2xpZCB2YXIoLS1ib3JkZXItc3VidGxlKVwiPicgK1xyXG4gICAgJzxidXR0b24gZGF0YS10YWI9XCJzYWxlcy1wbGFuc1wiIG9uY2xpY2s9XCJzd2l0Y2hGb3JlY2FzdFRhYihcXCdzYWxlcy1wbGFuc1xcJylcIiBjbGFzcz1cImZvcmVjYXN0LXRhYlwiIHN0eWxlPVwicGFkZGluZzoxMHB4IDE2cHg7YmFja2dyb3VuZDp0cmFuc3BhcmVudDtjb2xvcjp2YXIoLS10ZXh0LXByaW1hcnkpO2JvcmRlcjpub25lO2JvcmRlci1ib3R0b206M3B4IHNvbGlkICMwZDk0ODg7Y3Vyc29yOnBvaW50ZXI7Zm9udC13ZWlnaHQ6NzAwO2ZvbnQtc2l6ZToxMnB4O2xldHRlci1zcGFjaW5nOi40cHg7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlXCI+U2FsZXMgUGxhbnM8L2J1dHRvbj4nICtcclxuICAgICc8YnV0dG9uIGRhdGEtdGFiPVwic3RhdFwiIG9uY2xpY2s9XCJzd2l0Y2hGb3JlY2FzdFRhYihcXCdzdGF0XFwnKVwiIGNsYXNzPVwiZm9yZWNhc3QtdGFiXCIgc3R5bGU9XCJwYWRkaW5nOjEwcHggMTZweDtiYWNrZ3JvdW5kOnRyYW5zcGFyZW50O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO2JvcmRlcjpub25lO2JvcmRlci1ib3R0b206M3B4IHNvbGlkIHRyYW5zcGFyZW50O2N1cnNvcjpwb2ludGVyO2ZvbnQtd2VpZ2h0OjYwMDtmb250LXNpemU6MTJweDtsZXR0ZXItc3BhY2luZzouNHB4O3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZVwiPkZvcmVjYXN0IEVzdGFkXHUwMEVEc3RpY288L2J1dHRvbj4nICtcclxuICAgICc8YnV0dG9uIGRhdGEtdGFiPVwibGVnYWN5XCIgb25jbGljaz1cInN3aXRjaEZvcmVjYXN0VGFiKFxcJ2xlZ2FjeVxcJylcIiBjbGFzcz1cImZvcmVjYXN0LXRhYlwiIHN0eWxlPVwicGFkZGluZzoxMHB4IDE2cHg7YmFja2dyb3VuZDp0cmFuc3BhcmVudDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTtib3JkZXI6bm9uZTtib3JkZXItYm90dG9tOjNweCBzb2xpZCB0cmFuc3BhcmVudDtjdXJzb3I6cG9pbnRlcjtmb250LXdlaWdodDo2MDA7Zm9udC1zaXplOjEycHg7bGV0dGVyLXNwYWNpbmc6LjRweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2VcIj5MZWdhY3kgKDZtKTwvYnV0dG9uPicgK1xyXG4gICAgJzwvZGl2Pic7XHJcbiAgY29uc3QgdGFiU2FsZXNQbGFucyA9ICc8ZGl2IGlkPVwiZm9yZWNhc3QtdGFiLXNhbGVzLXBsYW5zXCIgc3R5bGU9XCJmbGV4OjE7b3ZlcmZsb3c6YXV0b1wiPjwvZGl2Pic7XHJcbiAgY29uc3QgdGFiU3RhdCA9ICc8ZGl2IGlkPVwiZm9yZWNhc3QtdGFiLXN0YXRcIiBzdHlsZT1cImZsZXg6MTtvdmVyZmxvdzphdXRvO2Rpc3BsYXk6bm9uZVwiPjwvZGl2Pic7XHJcbiAgY29uc3QgbGVnYWN5QmFyID1cclxuICAgICc8ZGl2IHN0eWxlPVwicGFkZGluZzoxMnB4IDE4cHg7YmFja2dyb3VuZDp2YXIoLS1iZy1zZWNvbmRhcnkpO2JvcmRlci1ib3R0b206MXB4IHNvbGlkIHZhcigtLWJvcmRlci1zdWJ0bGUpO2Rpc3BsYXk6ZmxleDtmbGV4LXdyYXA6d3JhcDtnYXA6MTRweDthbGlnbi1pdGVtczpjZW50ZXJcIj4nICtcclxuICAgICc8bGFiZWwgc3R5bGU9XCJkaXNwbGF5OmlubGluZS1mbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtnYXA6OHB4O3BhZGRpbmc6OHB4IDEycHg7YmFja2dyb3VuZDojMGQ5NDg4O2NvbG9yOiNmZmY7Ym9yZGVyLXJhZGl1czo2cHg7Zm9udC13ZWlnaHQ6NzAwO2ZvbnQtc2l6ZToxMnB4O2N1cnNvcjpwb2ludGVyXCI+JyArXHJcbiAgICAnPHNwYW4+Q2FyZ2FyIFNhbGVzIFBsYW4gKC54bHN4KTwvc3Bhbj4nICtcclxuICAgICc8aW5wdXQgdHlwZT1cImZpbGVcIiBhY2NlcHQ9XCIueGxzeCwueGxzXCIgc3R5bGU9XCJkaXNwbGF5Om5vbmVcIiBvbmNoYW5nZT1cIm9uRm9yZWNhc3RTYWxlc1BsYW5GaWxlKGV2ZW50KVwiLz48L2xhYmVsPicgK1xyXG4gICAgJzxkaXYgaWQ9XCJmb3JlY2FzdC1oaW50XCIgc3R5bGU9XCJmb250LXNpemU6MTFweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTttYXgtd2lkdGg6NTIwcHhcIj5Gb3JtYXRvIGxlZ2FjeTogcHJpbWVyYSBjb2x1bW5hIDxiPlNLVTwvYj4sIGx1ZWdvIDYgY29sdW1uYXMgY29uIGxhcyB1bmlkYWRlcyBwZWRpZGFzIG1lcyBhIG1lcy48L2Rpdj4nICtcclxuICAgICc8YnV0dG9uIGlkPVwiZm9yZWNhc3QtZXhwb3J0LWJ0blwiIG9uY2xpY2s9XCJleHBvcnRGb3JlY2FzdEV4Y2VsKClcIiBkaXNhYmxlZCBzdHlsZT1cInBhZGRpbmc6OHB4IDE0cHg7YmFja2dyb3VuZDp2YXIoLS1jb2xvci1zdWNjZXNzKTtjb2xvcjojZmZmO2JvcmRlcjpub25lO2JvcmRlci1yYWRpdXM6NnB4O2ZvbnQtd2VpZ2h0OjcwMDtjdXJzb3I6cG9pbnRlcjtvcGFjaXR5Oi41XCI+RXhwb3J0YXIgRXhjZWw8L2J1dHRvbj4nICtcclxuICAgICc8ZGl2IGlkPVwiZm9yZWNhc3Qtc3RhdHNcIiBzdHlsZT1cIm1hcmdpbi1sZWZ0OmF1dG87Zm9udC1zaXplOjExcHg7Y29sb3I6dmFyKC0tdGV4dC1zZWNvbmRhcnkpO2ZvbnQtd2VpZ2h0OjYwMFwiPjwvZGl2PicgK1xyXG4gICAgJzwvZGl2Pic7XHJcbiAgY29uc3QgbGVnYWN5Qm9keSA9XHJcbiAgICAnPGRpdiBpZD1cImZvcmVjYXN0LWJvZHlcIiBzdHlsZT1cImZsZXg6MTtvdmVyZmxvdzphdXRvO3BhZGRpbmc6MFwiPjxkaXYgc3R5bGU9XCJwYWRkaW5nOjYwcHggMjBweDt0ZXh0LWFsaWduOmNlbnRlcjtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTtmb250LXNpemU6MTRweFwiPkVzcGVyYW5kbyBhcmNoaXZvIFNhbGVzIFBsYW4uLi48L2Rpdj48L2Rpdj4nO1xyXG4gIGNvbnN0IHRhYkxlZ2FjeSA9XHJcbiAgICAnPGRpdiBpZD1cImZvcmVjYXN0LXRhYi1sZWdhY3lcIiBzdHlsZT1cImZsZXg6MTtvdmVyZmxvdzpoaWRkZW47ZmxleC1kaXJlY3Rpb246Y29sdW1uO2Rpc3BsYXk6bm9uZVwiPicgK1xyXG4gICAgbGVnYWN5QmFyICtcclxuICAgIGxlZ2FjeUJvZHkgK1xyXG4gICAgJzwvZGl2Pic7XHJcbiAgcmV0dXJuIG1vZGFsT3V0ZXIgKyBoZWFkZXIgKyB0YWJzQmFyICsgdGFiU2FsZXNQbGFucyArIHRhYlN0YXQgKyB0YWJMZWdhY3kgKyAnPC9kaXY+JztcclxufVxyXG5cclxuLy8gdjEwOTgrIEZhc2UgMSArIHYxMTAzKyBGYXNlIDJCICsgdjExMDUgZml4OiBzd2l0Y2ggZW50cmUgdGFicyBTYWxlcyBQbGFucyAvIFN0YXQgLyBMZWdhY3kuXHJcbndpbmRvdy5zd2l0Y2hGb3JlY2FzdFRhYiA9IGZ1bmN0aW9uICh0YWJJZCkge1xyXG4gIF9mb3JlY2FzdEFjdGl2ZVRhYiA9IHRhYklkO1xyXG4gIGNvbnN0IHNwID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2ZvcmVjYXN0LXRhYi1zYWxlcy1wbGFucycpO1xyXG4gIGNvbnN0IHN0ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2ZvcmVjYXN0LXRhYi1zdGF0Jyk7XHJcbiAgY29uc3QgbGcgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZm9yZWNhc3QtdGFiLWxlZ2FjeScpO1xyXG4gIGlmIChzcCkgc3Auc3R5bGUuZGlzcGxheSA9IHRhYklkID09PSAnc2FsZXMtcGxhbnMnID8gJ2Jsb2NrJyA6ICdub25lJztcclxuICBpZiAoc3QpIHN0LnN0eWxlLmRpc3BsYXkgPSB0YWJJZCA9PT0gJ3N0YXQnID8gJ2Jsb2NrJyA6ICdub25lJztcclxuICBpZiAobGcpIGxnLnN0eWxlLmRpc3BsYXkgPSB0YWJJZCA9PT0gJ2xlZ2FjeScgPyAnZmxleCcgOiAnbm9uZSc7XHJcbiAgY29uc3QgYnRucyA9IGRvY3VtZW50LnF1ZXJ5U2VsZWN0b3JBbGwoJyNmb3JlY2FzdC10YWJzLWJhciAuZm9yZWNhc3QtdGFiJyk7XHJcbiAgYnRucy5mb3JFYWNoKChiKSA9PiB7XHJcbiAgICBjb25zdCBhY3RpdmUgPSBiLmdldEF0dHJpYnV0ZSgnZGF0YS10YWInKSA9PT0gdGFiSWQ7XHJcbiAgICBiLnN0eWxlLmNvbG9yID0gYWN0aXZlID8gJ3ZhcigtLXRleHQtcHJpbWFyeSknIDogJ3ZhcigtLXRleHQtbXV0ZWQpJztcclxuICAgIGIuc3R5bGUuYm9yZGVyQm90dG9tQ29sb3IgPSBhY3RpdmUgPyAnIzBkOTQ4OCcgOiAndHJhbnNwYXJlbnQnO1xyXG4gICAgYi5zdHlsZS5mb250V2VpZ2h0ID0gYWN0aXZlID8gJzcwMCcgOiAnNjAwJztcclxuICB9KTtcclxuICAvLyB2MTEwNSBmaXg6IGFsIGFjdGl2YXIgbGEgdGFiIHN0YXQsIG1vc3RyYXIgcGxhY2Vob2xkZXIgaW5tZWRpYXRvIHBhcmFcclxuICAvLyBxdWUgc2UgdmVhIGFsZ28gbWllbnRyYXMgY2FyZ2EgKG8gc2kgZWwgbG9hZCB5YSB0ZXJtaW5vLCByZS1yZW5kZXIpLlxyXG4gIGlmICh0YWJJZCA9PT0gJ3N0YXQnKSB7XHJcbiAgICBjb25zdCBjb250ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2ZvcmVjYXN0LXRhYi1zdGF0Jyk7XHJcbiAgICBpZiAoY29udCkge1xyXG4gICAgICBpZiAoX2ZvcmVjYXN0U3RhdERvY3MpIHtcclxuICAgICAgICAvLyBZYSBjYXJnYWRvOiByZS1yZW5kZXIgKHBvciBzaSBlbCB1c2VyIHZpZW5lIGRlIG90cmEgdGFiKS5cclxuICAgICAgICBfcmVuZGVyRm9yZWNhc3RTdGF0VGFiKCk7XHJcbiAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgLy8gQVx1MDBGQW4gbm8gY2FyZ2FkbzogcGxhY2Vob2xkZXIgKyBsb2FkLlxyXG4gICAgICAgIGNvbnQuaW5uZXJIVE1MID1cclxuICAgICAgICAgICc8ZGl2IHN0eWxlPVwicGFkZGluZzo2MHB4IDIwcHg7dGV4dC1hbGlnbjpjZW50ZXI7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7Zm9udC1zaXplOjE0cHhcIj4nICtcclxuICAgICAgICAgICc8ZGl2IHN0eWxlPVwiZGlzcGxheTppbmxpbmUtYmxvY2s7d2lkdGg6MjRweDtoZWlnaHQ6MjRweDtib3JkZXI6M3B4IHNvbGlkICMwZDk0ODg7Ym9yZGVyLXRvcC1jb2xvcjp0cmFuc3BhcmVudDtib3JkZXItcmFkaXVzOjUwJTthbmltYXRpb246c3BpbiAwLjhzIGxpbmVhciBpbmZpbml0ZTttYXJnaW4tYm90dG9tOjEycHhcIj48L2Rpdj4nICtcclxuICAgICAgICAgICc8ZGl2PkNhcmdhbmRvIGZvcmVjYXN0X291dHB1dCBkZXNkZSBGaXJlc3RvcmUuLi48L2Rpdj4nICtcclxuICAgICAgICAgICc8c3R5bGU+QGtleWZyYW1lcyBzcGlue3Rve3RyYW5zZm9ybTpyb3RhdGUoMzYwZGVnKX19PC9zdHlsZT4nICtcclxuICAgICAgICAgICc8L2Rpdj4nO1xyXG4gICAgICAgIF9sb2FkRm9yZWNhc3RPdXRwdXQoKVxyXG4gICAgICAgICAgLnRoZW4oX3JlbmRlckZvcmVjYXN0U3RhdFRhYilcclxuICAgICAgICAgIC5jYXRjaCgoZSkgPT4ge1xyXG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKCdbRk9SRUNBU1Qgc3RhdF0gbG9hZCBmYWlsJywgZSk7XHJcbiAgICAgICAgICAgIGNvbnN0IGMgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZm9yZWNhc3QtdGFiLXN0YXQnKTtcclxuICAgICAgICAgICAgaWYgKGMpIHtcclxuICAgICAgICAgICAgICBjLmlubmVySFRNTCA9XHJcbiAgICAgICAgICAgICAgICAnPGRpdiBzdHlsZT1cInBhZGRpbmc6NjBweCAyMHB4O3RleHQtYWxpZ246Y2VudGVyO2NvbG9yOiNkYzI2MjY7bGluZS1oZWlnaHQ6MS42XCI+JyArXHJcbiAgICAgICAgICAgICAgICAnPGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxNnB4O2ZvbnQtd2VpZ2h0OjcwMDttYXJnaW4tYm90dG9tOjEycHhcIj5FcnJvciBjYXJnYW5kbyBmb3JlY2FzdF9vdXRwdXQ8L2Rpdj4nICtcclxuICAgICAgICAgICAgICAgICc8ZGl2IHN0eWxlPVwiZm9udC1zaXplOjEycHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7bWFyZ2luLWJvdHRvbToxNnB4XCI+JyArXHJcbiAgICAgICAgICAgICAgICBlc2NhcGVIdG1sU2FmZShlLm1lc3NhZ2UgfHwgU3RyaW5nKGUpKSArXHJcbiAgICAgICAgICAgICAgICAnPC9kaXY+JyArXHJcbiAgICAgICAgICAgICAgICAnPGJ1dHRvbiBvbmNsaWNrPVwic3dpdGNoRm9yZWNhc3RUYWIoXFwnc3RhdFxcJylcIiBzdHlsZT1cInBhZGRpbmc6OHB4IDE0cHg7YmFja2dyb3VuZDojMGQ5NDg4O2NvbG9yOiNmZmY7Ym9yZGVyOm5vbmU7Ym9yZGVyLXJhZGl1czo2cHg7Zm9udC13ZWlnaHQ6NzAwO2N1cnNvcjpwb2ludGVyXCI+UmVpbnRlbnRhcjwvYnV0dG9uPicgK1xyXG4gICAgICAgICAgICAgICAgJzwvZGl2Pic7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgIH0pO1xyXG4gICAgICB9XHJcbiAgICB9XHJcbiAgfVxyXG59O1xyXG5cclxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcbi8vIEZBU0UgMSBcdTIwMTQgU2FsZXMgUGxhbnMgdXBsb2FkIChSb2RzIC8gUmVlbHMgLyBGRylcclxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblxyXG5mdW5jdGlvbiBfeWVhck1vbnRoTm93KCkge1xyXG4gIGNvbnN0IGQgPSBuZXcgRGF0ZSgpO1xyXG4gIHJldHVybiBkLmdldEZ1bGxZZWFyKCkgKyAnLScgKyBTdHJpbmcoZC5nZXRNb250aCgpICsgMSkucGFkU3RhcnQoMiwgJzAnKTtcclxufVxyXG5cclxuZnVuY3Rpb24gX2ZtdFNpemUoYnl0ZXMpIHtcclxuICBpZiAoIWJ5dGVzKSByZXR1cm4gJyc7XHJcbiAgaWYgKGJ5dGVzIDwgMTAyNCkgcmV0dXJuIGJ5dGVzICsgJyBCJztcclxuICBpZiAoYnl0ZXMgPCAxMDI0ICogMTAyNCkgcmV0dXJuIChieXRlcyAvIDEwMjQpLnRvRml4ZWQoMSkgKyAnIEtCJztcclxuICByZXR1cm4gKGJ5dGVzIC8gKDEwMjQgKiAxMDI0KSkudG9GaXhlZCgyKSArICcgTUInO1xyXG59XHJcblxyXG5mdW5jdGlvbiBfZm10RGF0ZVNob3J0KGlzbykge1xyXG4gIGlmICghaXNvKSByZXR1cm4gJ1x1MjAxNCc7XHJcbiAgdHJ5IHtcclxuICAgIGNvbnN0IGQgPSBpc28udG9EYXRlID8gaXNvLnRvRGF0ZSgpIDogbmV3IERhdGUoaXNvKTtcclxuICAgIHJldHVybiAoXHJcbiAgICAgIGQudG9Mb2NhbGVEYXRlU3RyaW5nKCdlcy1BUicsIHsgZGF5OiAnMi1kaWdpdCcsIG1vbnRoOiAnc2hvcnQnLCB5ZWFyOiAnMi1kaWdpdCcgfSkgK1xyXG4gICAgICAnICcgK1xyXG4gICAgICBkLnRvTG9jYWxlVGltZVN0cmluZygnZXMtQVInLCB7IGhvdXI6ICcyLWRpZ2l0JywgbWludXRlOiAnMi1kaWdpdCcgfSlcclxuICAgICk7XHJcbiAgfSBjYXRjaCB7XHJcbiAgICByZXR1cm4gU3RyaW5nKGlzbyk7XHJcbiAgfVxyXG59XHJcblxyXG5hc3luYyBmdW5jdGlvbiBfbG9hZFNhbGVzUGxhbkNhY2hlcygpIHtcclxuICBpZiAoIXdpbmRvdy5mYkRiKSByZXR1cm47XHJcbiAgYXdhaXQgUHJvbWlzZS5hbGwoXHJcbiAgICBTQUxFU19QTEFOX0ZBTUlMSUFTLm1hcChhc3luYyAoZikgPT4ge1xyXG4gICAgICB0cnkge1xyXG4gICAgICAgIGNvbnN0IGRvYyA9IGF3YWl0IHdpbmRvdy5mYkRiLmNvbGxlY3Rpb24oJ3NhbGVzX3BsYW5fY2FjaGUnKS5kb2MoZi5rZXkpLmdldCgpO1xyXG4gICAgICAgIF9zYWxlc1BsYW5DYWNoZXNbZi5rZXldID0gZG9jLmV4aXN0cyA/IGRvYy5kYXRhKCkgOiBudWxsO1xyXG4gICAgICB9IGNhdGNoIChlKSB7XHJcbiAgICAgICAgY29uc29sZS53YXJuKCdbRk9SRUNBU1RdIGxvYWQgc2FsZXNfcGxhbl9jYWNoZS8nICsgZi5rZXkgKyAnIGZhaWw6JywgZSAmJiBlLm1lc3NhZ2UpO1xyXG4gICAgICAgIF9zYWxlc1BsYW5DYWNoZXNbZi5rZXldID0gbnVsbDtcclxuICAgICAgfVxyXG4gICAgfSlcclxuICApO1xyXG59XHJcblxyXG5mdW5jdGlvbiBfcmVuZGVyVGFibGUocm93cykge1xyXG4gIGNvbnN0IGJvZHkgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZm9yZWNhc3QtYm9keScpO1xyXG4gIGlmICghYm9keSkgcmV0dXJuO1xyXG4gIGlmICghcm93cyB8fCAhcm93cy5sZW5ndGgpIHtcclxuICAgIGJvZHkuaW5uZXJIVE1MID1cclxuICAgICAgJzxkaXYgc3R5bGU9XCJwYWRkaW5nOjYwcHggMjBweDt0ZXh0LWFsaWduOmNlbnRlcjtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKVwiPlNhbGVzIFBsYW4gdmFjaW8gbyBzaW4gZmlsYXMgdmFsaWRhcy48L2Rpdj4nO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuICBjb25zdCBmbXQgPSAobikgPT5cclxuICAgIG4gPT09IDAgfHwgIU51bWJlci5pc0Zpbml0ZShuKVxyXG4gICAgICA/ICcwJ1xyXG4gICAgICA6IE51bWJlcihuKS50b0xvY2FsZVN0cmluZygnZXMtQVInLCB7IG1heGltdW1GcmFjdGlvbkRpZ2l0czogMSB9KTtcclxuICBjb25zdCBjb2xvckZvclRvdGFsID0gKHQpID0+IHtcclxuICAgIGlmICh0ID4gMCkgcmV0dXJuICcjMTY2NTM0JzsgLy8gc29icmEgKHBlZGlzdGUgbWFzIHF1ZSBsYSBwb2xpdGljYSkgLSB2ZXJkZVxyXG4gICAgaWYgKHQgPCAwKSByZXR1cm4gJyNjMjQxMGMnOyAvLyBmYWx0YSAocGVkaXN0ZSBtZW5vcyBxdWUgbGEgcG9saXRpY2EpIC0gbmFyYW5qYSB1cmdlbnRlXHJcbiAgICByZXR1cm4gJyM0NzU1NjknO1xyXG4gIH07XHJcbiAgY29uc3Qgcm93c0h0bWwgPSByb3dzXHJcbiAgICAubWFwKFxyXG4gICAgICAocikgPT5cclxuICAgICAgICAnJyArXHJcbiAgICAgICAgJzx0cicgK1xyXG4gICAgICAgIChyLmhhc0hpc3RvcmlhID8gJycgOiAnIHN0eWxlPVwiYmFja2dyb3VuZDp2YXIoLS1jb2xvci13YXJuaW5nLWJnKVwiJykgK1xyXG4gICAgICAgICc+JyArXHJcbiAgICAgICAgJzx0ZCBzdHlsZT1cInBhZGRpbmc6NnB4IDEwcHg7Zm9udC1mYW1pbHk6bW9ub3NwYWNlO2ZvbnQtc2l6ZToxMXB4O3doaXRlLXNwYWNlOm5vd3JhcFwiPicgK1xyXG4gICAgICAgIGVzY2FwZUh0bWxTYWZlKHIuc2t1KSArXHJcbiAgICAgICAgJzwvdGQ+JyArXHJcbiAgICAgICAgJzx0ZCBzdHlsZT1cInBhZGRpbmc6NnB4IDEwcHg7Zm9udC1zaXplOjExcHhcIj4nICtcclxuICAgICAgICBlc2NhcGVIdG1sU2FmZShyLmZhbWlsaWEpICtcclxuICAgICAgICAnPC90ZD4nICtcclxuICAgICAgICAnPHRkIHN0eWxlPVwicGFkZGluZzo2cHggMTBweDtmb250LXNpemU6MTFweFwiPicgK1xyXG4gICAgICAgIGVzY2FwZUh0bWxTYWZlKHIuc3ViZmFtaWxpYSkgK1xyXG4gICAgICAgICc8L3RkPicgK1xyXG4gICAgICAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjZweCAxMHB4O3RleHQtYWxpZ246cmlnaHQ7Zm9udC12YXJpYW50LW51bWVyaWM6dGFidWxhci1udW1zXCI+JyArXHJcbiAgICAgICAgZm10KHIudmVudGFzMTJtKSArXHJcbiAgICAgICAgJzwvdGQ+JyArXHJcbiAgICAgICAgJzx0ZCBzdHlsZT1cInBhZGRpbmc6NnB4IDEwcHg7dGV4dC1hbGlnbjpyaWdodDtmb250LXZhcmlhbnQtbnVtZXJpYzp0YWJ1bGFyLW51bXM7Zm9udC13ZWlnaHQ6NjAwXCI+JyArXHJcbiAgICAgICAgZm10KHIucGVkaWRvNm0pICtcclxuICAgICAgICAnPC90ZD4nICtcclxuICAgICAgICAnPHRkIHN0eWxlPVwicGFkZGluZzo2cHggMTBweDt0ZXh0LWFsaWduOnJpZ2h0O2ZvbnQtdmFyaWFudC1udW1lcmljOnRhYnVsYXItbnVtcztjb2xvcjp2YXIoLS10ZXh0LW11dGVkKVwiPicgK1xyXG4gICAgICAgIGZtdChyLnByb21lZGlvKSArXHJcbiAgICAgICAgJzwvdGQ+JyArXHJcbiAgICAgICAgJzx0ZCBzdHlsZT1cInBhZGRpbmc6NnB4IDEwcHg7dGV4dC1hbGlnbjpyaWdodDtmb250LXZhcmlhbnQtbnVtZXJpYzp0YWJ1bGFyLW51bXNcIj4nICtcclxuICAgICAgICBmbXQoci5wb2xpdGljYSkgK1xyXG4gICAgICAgICc8L3RkPicgK1xyXG4gICAgICAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjZweCAxMHB4O3RleHQtYWxpZ246cmlnaHQ7Zm9udC12YXJpYW50LW51bWVyaWM6dGFidWxhci1udW1zO2ZvbnQtd2VpZ2h0OjcwMDtjb2xvcjonICtcclxuICAgICAgICBjb2xvckZvclRvdGFsKHIudG90YWwpICtcclxuICAgICAgICAnXCI+JyArXHJcbiAgICAgICAgZm10KHIudG90YWwpICtcclxuICAgICAgICAnPC90ZD4nICtcclxuICAgICAgICAnPC90cj4nXHJcbiAgICApXHJcbiAgICAuam9pbignJyk7XHJcbiAgY29uc3QgaGVhZGVyID1cclxuICAgICcnICtcclxuICAgICc8dGhlYWQgc3R5bGU9XCJwb3NpdGlvbjpzdGlja3k7dG9wOjA7YmFja2dyb3VuZDojMGYxNzJhO2NvbG9yOiNmZmY7ei1pbmRleDoxXCI+JyArXHJcbiAgICAnPHRyPicgK1xyXG4gICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6OHB4IDEwcHg7dGV4dC1hbGlnbjpsZWZ0O2ZvbnQtc2l6ZToxMXB4O3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtsZXR0ZXItc3BhY2luZzouNHB4XCI+U0tVPC90aD4nICtcclxuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjhweCAxMHB4O3RleHQtYWxpZ246bGVmdDtmb250LXNpemU6MTFweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7bGV0dGVyLXNwYWNpbmc6LjRweFwiPkZhbWlsaWE8L3RoPicgK1xyXG4gICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6OHB4IDEwcHg7dGV4dC1hbGlnbjpsZWZ0O2ZvbnQtc2l6ZToxMXB4O3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtsZXR0ZXItc3BhY2luZzouNHB4XCI+U3ViZmFtaWxpYTwvdGg+JyArXHJcbiAgICAnPHRoIHN0eWxlPVwicGFkZGluZzo4cHggMTBweDt0ZXh0LWFsaWduOnJpZ2h0O2ZvbnQtc2l6ZToxMXB4O3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtsZXR0ZXItc3BhY2luZzouNHB4XCIgdGl0bGU9XCJTdW1hIGRlIHF0eSBmYWN0dXJhZGEgZW4gbG9zIHVsdGltb3MgMTIgbWVzZXMgY29tcGxldG9zXCI+VmVudGFzIDEybTwvdGg+JyArXHJcbiAgICAnPHRoIHN0eWxlPVwicGFkZGluZzo4cHggMTBweDt0ZXh0LWFsaWduOnJpZ2h0O2ZvbnQtc2l6ZToxMXB4O3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtsZXR0ZXItc3BhY2luZzouNHB4XCIgdGl0bGU9XCJTdW1hIGRlIGxhcyA2IGNvbHVtbmFzIGRlbCBFeGNlbCBTYWxlcyBQbGFuXCI+UGVkaWRvIDZtPC90aD4nICtcclxuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjhweCAxMHB4O3RleHQtYWxpZ246cmlnaHQ7Zm9udC1zaXplOjExcHg7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO2xldHRlci1zcGFjaW5nOi40cHhcIiB0aXRsZT1cIlZlbnRhcyBZVEQgLyBtZXNlcyB0cmFuc2N1cnJpZG9zIGRlbCBhXHUwMEYxb1wiPlByb20gLyBNZXM8L3RoPicgK1xyXG4gICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6OHB4IDEwcHg7dGV4dC1hbGlnbjpyaWdodDtmb250LXNpemU6MTFweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7bGV0dGVyLXNwYWNpbmc6LjRweFwiIHRpdGxlPVwiUHJvbWVkaW8geCAzIG1lc2VzIChwb2xpdGljYSBkZSBpbnZlbnRhcmlvKVwiPlBvbGl0aWNhPC90aD4nICtcclxuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjhweCAxMHB4O3RleHQtYWxpZ246cmlnaHQ7Zm9udC1zaXplOjExcHg7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO2xldHRlci1zcGFjaW5nOi40cHhcIiB0aXRsZT1cIlBlZGlkbyA2bSAtIFBvbGl0aWNhLiBOZWdhdGl2byA9IHRlIGZhbHRhIHBlZGlyOyBQb3NpdGl2byA9IHNvYnJlcGVkaWRvXCI+VG90YWw8L3RoPicgK1xyXG4gICAgJzwvdHI+JyArXHJcbiAgICAnPC90aGVhZD4nO1xyXG4gIGJvZHkuaW5uZXJIVE1MID1cclxuICAgICc8dGFibGUgc3R5bGU9XCJ3aWR0aDoxMDAlO2JvcmRlci1jb2xsYXBzZTpjb2xsYXBzZTtmb250LXNpemU6MTJweFwiPicgK1xyXG4gICAgaGVhZGVyICtcclxuICAgICc8dGJvZHk+JyArXHJcbiAgICByb3dzSHRtbCArXHJcbiAgICAnPC90Ym9keT48L3RhYmxlPic7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGVzY2FwZUh0bWxTYWZlKHMpIHtcclxuICBpZiAodHlwZW9mIHdpbmRvdy5lc2NhcGVIdG1sID09PSAnZnVuY3Rpb24nKSByZXR1cm4gd2luZG93LmVzY2FwZUh0bWwocyk7XHJcbiAgcmV0dXJuIFN0cmluZyhzID09IG51bGwgPyAnJyA6IHMpLnJlcGxhY2UoXHJcbiAgICAvWyY8PlwiJ10vZyxcclxuICAgIChjaCkgPT4gKHsgJyYnOiAnJmFtcDsnLCAnPCc6ICcmbHQ7JywgJz4nOiAnJmd0OycsICdcIic6ICcmcXVvdDsnLCBcIidcIjogJyYjMzk7JyB9KVtjaF1cclxuICApO1xyXG59XHJcblxyXG5mdW5jdGlvbiBfYnVpbGRTYWxlc1BsYW5TbG90SHRtbChmKSB7XHJcbiAgY29uc3QgY2FjaGUgPSBfc2FsZXNQbGFuQ2FjaGVzW2Yua2V5XTtcclxuICBjb25zdCByb3dzQ291bnQgPSBjYWNoZSAmJiBOdW1iZXIuaXNGaW5pdGUoY2FjaGUucm93c0NvdW50KSA/IGNhY2hlLnJvd3NDb3VudCA6IDA7XHJcbiAgY29uc3QgbW9udGhzQ291bnQgPVxyXG4gICAgY2FjaGUgJiYgQXJyYXkuaXNBcnJheShjYWNoZS5kZXRlY3RlZE1vbnRocykgPyBjYWNoZS5kZXRlY3RlZE1vbnRocy5sZW5ndGggOiAwO1xyXG4gIGNvbnN0IHBhcnNlZEF0ID0gY2FjaGUgJiYgY2FjaGUucGFyc2VkQXQgPyBfZm10RGF0ZVNob3J0KGNhY2hlLnBhcnNlZEF0KSA6ICcnO1xyXG4gIGNvbnN0IHVwbG9hZGVkQnkgPSBjYWNoZSAmJiBjYWNoZS51cGxvYWRlZEJ5ID8gY2FjaGUudXBsb2FkZWRCeSA6ICcnO1xyXG4gIGNvbnN0IHNvdXJjZUZpbGVuYW1lID0gY2FjaGUgJiYgY2FjaGUuc291cmNlRmlsZW5hbWUgPyBjYWNoZS5zb3VyY2VGaWxlbmFtZSA6ICcnO1xyXG4gIGNvbnN0IHllYXJNb250aCA9IGNhY2hlICYmIGNhY2hlLnllYXJNb250aCA/IGNhY2hlLnllYXJNb250aCA6ICcnO1xyXG4gIGNvbnN0IG1vbnRoc1JhbmdlID1cclxuICAgIGNhY2hlICYmIGNhY2hlLmRldGVjdGVkTW9udGhzICYmIGNhY2hlLmRldGVjdGVkTW9udGhzLmxlbmd0aFxyXG4gICAgICA/IGNhY2hlLmRldGVjdGVkTW9udGhzWzBdICsgJyBcdTIxOTIgJyArIGNhY2hlLmRldGVjdGVkTW9udGhzW2NhY2hlLmRldGVjdGVkTW9udGhzLmxlbmd0aCAtIDFdXHJcbiAgICAgIDogJ1x1MjAxNCc7XHJcbiAgY29uc3QgaGFzQ2FjaGUgPSAhIWNhY2hlO1xyXG4gIGNvbnN0IGJhZGdlID0gaGFzQ2FjaGVcclxuICAgID8gJzxkaXYgc3R5bGU9XCJwYWRkaW5nOjRweCA4cHg7YmFja2dyb3VuZDojMTZhMzRhO2NvbG9yOiNmZmY7Ym9yZGVyLXJhZGl1czoxMnB4O2ZvbnQtc2l6ZToxMHB4O2ZvbnQtd2VpZ2h0OjcwMDtsZXR0ZXItc3BhY2luZzouNHB4XCI+Q0FSR0FETzwvZGl2PidcclxuICAgIDogJzxkaXYgc3R5bGU9XCJwYWRkaW5nOjRweCA4cHg7YmFja2dyb3VuZDojZGMyNjI2O2NvbG9yOiNmZmY7Ym9yZGVyLXJhZGl1czoxMnB4O2ZvbnQtc2l6ZToxMHB4O2ZvbnQtd2VpZ2h0OjcwMDtsZXR0ZXItc3BhY2luZzouNHB4XCI+RkFMVEE8L2Rpdj4nO1xyXG4gIGNvbnN0IG1ldGFCbG9jayA9IGhhc0NhY2hlXHJcbiAgICA/ICc8ZGl2IHN0eWxlPVwiZGlzcGxheTpncmlkO2dyaWQtdGVtcGxhdGUtY29sdW1uczphdXRvIDFmcjtnYXA6NnB4IDEycHg7Zm9udC1zaXplOjExcHg7cGFkZGluZzoxMHB4IDEycHg7YmFja2dyb3VuZDp2YXIoLS1iZy1zZWNvbmRhcnkpO2JvcmRlci1yYWRpdXM6NnB4XCI+JyArXHJcbiAgICAgICc8ZGl2IHN0eWxlPVwiY29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7Zm9udC13ZWlnaHQ6NjAwXCI+QXJjaGl2bzwvZGl2PjxkaXYgc3R5bGU9XCJjb2xvcjp2YXIoLS10ZXh0LXByaW1hcnkpO2ZvbnQtZmFtaWx5Om1vbm9zcGFjZTt3b3JkLWJyZWFrOmJyZWFrLWFsbFwiPicgK1xyXG4gICAgICBlc2NhcGVIdG1sU2FmZShzb3VyY2VGaWxlbmFtZSkgK1xyXG4gICAgICAnPC9kaXY+JyArXHJcbiAgICAgICc8ZGl2IHN0eWxlPVwiY29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7Zm9udC13ZWlnaHQ6NjAwXCI+U3ViaWRvPC9kaXY+PGRpdiBzdHlsZT1cImNvbG9yOnZhcigtLXRleHQtcHJpbWFyeSlcIj4nICtcclxuICAgICAgZXNjYXBlSHRtbFNhZmUocGFyc2VkQXQpICtcclxuICAgICAgJzwvZGl2PicgK1xyXG4gICAgICAnPGRpdiBzdHlsZT1cImNvbG9yOnZhcigtLXRleHQtbXV0ZWQpO2ZvbnQtd2VpZ2h0OjYwMFwiPlBvcjwvZGl2PjxkaXYgc3R5bGU9XCJjb2xvcjp2YXIoLS10ZXh0LXByaW1hcnkpXCI+JyArXHJcbiAgICAgIGVzY2FwZUh0bWxTYWZlKHVwbG9hZGVkQnkpICtcclxuICAgICAgJzwvZGl2PicgK1xyXG4gICAgICAnPGRpdiBzdHlsZT1cImNvbG9yOnZhcigtLXRleHQtbXV0ZWQpO2ZvbnQtd2VpZ2h0OjYwMFwiPlNuYXBzaG90PC9kaXY+PGRpdiBzdHlsZT1cImNvbG9yOnZhcigtLXRleHQtcHJpbWFyeSk7Zm9udC1mYW1pbHk6bW9ub3NwYWNlXCI+JyArXHJcbiAgICAgIGVzY2FwZUh0bWxTYWZlKHllYXJNb250aCkgK1xyXG4gICAgICAnPC9kaXY+JyArXHJcbiAgICAgICc8ZGl2IHN0eWxlPVwiY29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7Zm9udC13ZWlnaHQ6NjAwXCI+U0tVczwvZGl2PjxkaXYgc3R5bGU9XCJjb2xvcjp2YXIoLS10ZXh0LXByaW1hcnkpO2ZvbnQtd2VpZ2h0OjcwMFwiPicgK1xyXG4gICAgICByb3dzQ291bnQudG9Mb2NhbGVTdHJpbmcoJ2VzLUFSJykgK1xyXG4gICAgICAnPC9kaXY+JyArXHJcbiAgICAgICc8ZGl2IHN0eWxlPVwiY29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7Zm9udC13ZWlnaHQ6NjAwXCI+TWVzZXM8L2Rpdj48ZGl2IHN0eWxlPVwiY29sb3I6dmFyKC0tdGV4dC1wcmltYXJ5KTtmb250LXdlaWdodDo3MDBcIj4nICtcclxuICAgICAgbW9udGhzQ291bnQgK1xyXG4gICAgICAnIDxzcGFuIHN0eWxlPVwiY29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7Zm9udC13ZWlnaHQ6NDAwXCI+KCcgK1xyXG4gICAgICBlc2NhcGVIdG1sU2FmZShtb250aHNSYW5nZSkgK1xyXG4gICAgICAnKTwvc3Bhbj48L2Rpdj4nICtcclxuICAgICAgJzwvZGl2PidcclxuICAgIDogJzxkaXYgc3R5bGU9XCJwYWRkaW5nOjE0cHg7dGV4dC1hbGlnbjpjZW50ZXI7Zm9udC1zaXplOjEycHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7YmFja2dyb3VuZDp2YXIoLS1iZy1zZWNvbmRhcnkpO2JvcmRlci1yYWRpdXM6NnB4O2JvcmRlcjoxcHggZGFzaGVkIHZhcigtLWJvcmRlci1zdWJ0bGUpXCI+QXVuIG5vIHN1YmlzdGUgZWwgU2FsZXMgUGxhbiBkZSBlc3RhIGZhbWlsaWEuPC9kaXY+JztcclxuICBjb25zdCB1cGxvYWRCdG4gPVxyXG4gICAgJzxsYWJlbCBzdHlsZT1cImRpc3BsYXk6aW5saW5lLWZsZXg7YWxpZ24taXRlbXM6Y2VudGVyO2p1c3RpZnktY29udGVudDpjZW50ZXI7Z2FwOjhweDtwYWRkaW5nOjEwcHggMTRweDtiYWNrZ3JvdW5kOicgK1xyXG4gICAgZi5jb2xvciArXHJcbiAgICAnO2NvbG9yOiNmZmY7Ym9yZGVyLXJhZGl1czo2cHg7Zm9udC13ZWlnaHQ6NzAwO2ZvbnQtc2l6ZToxMnB4O2N1cnNvcjpwb2ludGVyO2xldHRlci1zcGFjaW5nOi40cHhcIj4nICtcclxuICAgICc8c3Bhbj4nICtcclxuICAgIChoYXNDYWNoZSA/ICdcdTIxQkIgUmVlbXBsYXphciBFeGNlbCcgOiAnXHUyQjA2IENhcmdhciBFeGNlbCcpICtcclxuICAgICc8L3NwYW4+JyArXHJcbiAgICAnPGlucHV0IHR5cGU9XCJmaWxlXCIgYWNjZXB0PVwiLnhsc3gsLnhsc1wiIGRhdGEtZmFtaWxpYT1cIicgK1xyXG4gICAgZi5rZXkgK1xyXG4gICAgJ1wiIHN0eWxlPVwiZGlzcGxheTpub25lXCIgb25jaGFuZ2U9XCJvblNhbGVzUGxhbkZpbGVGb3JGYW1pbGlhKGV2ZW50LCBcXCcnICtcclxuICAgIGYua2V5ICtcclxuICAgICdcXCcpXCIvPicgK1xyXG4gICAgJzwvbGFiZWw+JztcclxuICBjb25zdCBjYXJkSGVhZCA9XHJcbiAgICAnPGRpdiBzdHlsZT1cImRpc3BsYXk6ZmxleDthbGlnbi1pdGVtczpjZW50ZXI7Z2FwOjEwcHhcIj4nICtcclxuICAgICc8ZGl2IHN0eWxlPVwid2lkdGg6MTJweDtoZWlnaHQ6MzJweDtiYWNrZ3JvdW5kOicgK1xyXG4gICAgZi5jb2xvciArXHJcbiAgICAnO2JvcmRlci1yYWRpdXM6M3B4XCI+PC9kaXY+JyArXHJcbiAgICAnPGRpdiBzdHlsZT1cImZsZXg6MVwiPjxkaXYgc3R5bGU9XCJmb250LXNpemU6MTRweDtmb250LXdlaWdodDo4MDA7Y29sb3I6dmFyKC0tdGV4dC1wcmltYXJ5KVwiPicgK1xyXG4gICAgZXNjYXBlSHRtbFNhZmUoZi5sYWJlbCkgK1xyXG4gICAgJzwvZGl2PicgK1xyXG4gICAgJzxkaXYgc3R5bGU9XCJmb250LXNpemU6MTFweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTttYXJnaW4tdG9wOjJweFwiPlNhbGVzIFBsYW4gbWVuc3VhbCBcdTAwQjcgSG9qYSBTQVI8L2Rpdj48L2Rpdj4nICtcclxuICAgIGJhZGdlICtcclxuICAgICc8L2Rpdj4nO1xyXG4gIHJldHVybiAoXHJcbiAgICAnPGRpdiBzdHlsZT1cImJhY2tncm91bmQ6dmFyKC0tYmctZWxldmF0ZWQpO2JvcmRlcjoxcHggc29saWQgdmFyKC0tYm9yZGVyLXN1YnRsZSk7Ym9yZGVyLXJhZGl1czoxMHB4O3BhZGRpbmc6MTZweDtkaXNwbGF5OmZsZXg7ZmxleC1kaXJlY3Rpb246Y29sdW1uO2dhcDoxMnB4XCI+JyArXHJcbiAgICBjYXJkSGVhZCArXHJcbiAgICBtZXRhQmxvY2sgK1xyXG4gICAgdXBsb2FkQnRuICtcclxuICAgICc8ZGl2IGlkPVwic2FsZXMtcGxhbi1zdGF0dXMtJyArXHJcbiAgICBmLmtleSArXHJcbiAgICAnXCIgc3R5bGU9XCJmb250LXNpemU6MTFweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTttaW4taGVpZ2h0OjE0cHhcIj48L2Rpdj4nICtcclxuICAgICc8L2Rpdj4nXHJcbiAgKTtcclxufVxyXG5cclxuZnVuY3Rpb24gX3JlbmRlclNhbGVzUGxhbnNUYWIoKSB7XHJcbiAgY29uc3QgY29udCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdmb3JlY2FzdC10YWItc2FsZXMtcGxhbnMnKTtcclxuICBpZiAoIWNvbnQpIHJldHVybjtcclxuICBjb25zdCBzbG90cyA9IFNBTEVTX1BMQU5fRkFNSUxJQVMubWFwKF9idWlsZFNhbGVzUGxhblNsb3RIdG1sKS5qb2luKCcnKTtcclxuICBjb25zdCBpbnRybyA9XHJcbiAgICAnPGRpdiBzdHlsZT1cIm1hcmdpbi1ib3R0b206MTZweDtwYWRkaW5nOjEycHggMTRweDtiYWNrZ3JvdW5kOnZhcigtLWJnLXNlY29uZGFyeSk7Ym9yZGVyLWxlZnQ6M3B4IHNvbGlkICMwZDk0ODg7Ym9yZGVyLXJhZGl1czo2cHg7Zm9udC1zaXplOjEycHg7Y29sb3I6dmFyKC0tdGV4dC1zZWNvbmRhcnkpO2xpbmUtaGVpZ2h0OjEuNVwiPicgK1xyXG4gICAgJzxiIHN0eWxlPVwiY29sb3I6dmFyKC0tdGV4dC1wcmltYXJ5KVwiPkZhc2UgMTwvYj4gXHUyMDE0IENhcmdcdTAwRTEgbG9zIFNhbGVzIFBsYW5zIG1lbnN1YWxlcyAoUm9kcyAvIFJlZWxzKS4gU2UgcGFyc2VhIGxhIGhvamEgPGI+U0FSPC9iPjogU0tVLCBNT1EgMTIgbW9udGhzLCB5IHVuYSBjb2x1bW5hIHBvciBtZXMuICcgK1xyXG4gICAgJ0VsIEV4Y2VsIG9yaWdpbmFsIHF1ZWRhIHNuYXBzaG90YWRvIGVuIFN0b3JhZ2UgeSBlbCBwYXJzZW8gcXVlZGEgZW4gRmlyZXN0b3JlIHBhcmEgZWwgY1x1MDBFMWxjdWxvIGRlYmFqby4nICtcclxuICAgICc8L2Rpdj4nO1xyXG4gIGNvbnN0IGdyaWQgPVxyXG4gICAgJzxkaXYgc3R5bGU9XCJkaXNwbGF5OmdyaWQ7Z3JpZC10ZW1wbGF0ZS1jb2x1bW5zOnJlcGVhdChhdXRvLWZpdCxtaW5tYXgoMzIwcHgsMWZyKSk7Z2FwOjE2cHg7bWFyZ2luLWJvdHRvbToyNHB4XCI+JyArXHJcbiAgICBzbG90cyArXHJcbiAgICAnPC9kaXY+JztcclxuICAvLyB2MTEwOTogY29udGVuZWRvciBwYXJhIHRhYmxhIFJlY29tZW5kYWNpXHUwMEYzbiBkZSBDb21wcmEuIFNlIHJlbGxlbmEgb24tZGVtYW5kXHJcbiAgLy8gdmlhIF9yZW5kZXJSZWNvU2VjdGlvbigpIChsYXp5IGxvYWQgZGUgc3RvY2tfc25hcHNob3QgKyBza3VfdmVudGFzX3NuYXBzaG90KS5cclxuICBjb25zdCByZWNvU2VjdGlvbiA9ICc8ZGl2IGlkPVwicmVjby1zZWN0aW9uLWNvbnRhaW5lclwiPjwvZGl2Pic7XHJcbiAgY29udC5pbm5lckhUTUwgPSAnPGRpdiBzdHlsZT1cInBhZGRpbmc6MThweFwiPicgKyBpbnRybyArIGdyaWQgKyByZWNvU2VjdGlvbiArICc8L2Rpdj4nO1xyXG4gIF9yZW5kZXJSZWNvU2VjdGlvbigpO1xyXG59XHJcblxyXG53aW5kb3cub25TYWxlc1BsYW5GaWxlRm9yRmFtaWxpYSA9IGFzeW5jIGZ1bmN0aW9uIChldmVudCwgZmFtaWxpYSkge1xyXG4gIGNvbnN0IGZpbGUgPSBldmVudCAmJiBldmVudC50YXJnZXQgJiYgZXZlbnQudGFyZ2V0LmZpbGVzICYmIGV2ZW50LnRhcmdldC5maWxlc1swXTtcclxuICBpZiAoIWZpbGUpIHJldHVybjtcclxuICBjb25zdCBzdGF0dXNFbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdzYWxlcy1wbGFuLXN0YXR1cy0nICsgZmFtaWxpYSk7XHJcbiAgY29uc3Qgc2V0U3RhdHVzID0gKG1zZywgY29sb3IpID0+IHtcclxuICAgIGlmICghc3RhdHVzRWwpIHJldHVybjtcclxuICAgIHN0YXR1c0VsLnRleHRDb250ZW50ID0gbXNnO1xyXG4gICAgc3RhdHVzRWwuc3R5bGUuY29sb3IgPSBjb2xvciB8fCAndmFyKC0tdGV4dC1tdXRlZCknO1xyXG4gIH07XHJcbiAgdHJ5IHtcclxuICAgIGlmICh0eXBlb2YgWExTWCA9PT0gJ3VuZGVmaW5lZCcpIHtcclxuICAgICAgYWxlcnQoJ1NoZWV0SlMgKFhMU1gpIG5vIGNhcmdhZG8gXHUyMDE0IHJlY2FyZ1x1MDBFMSBsYSBhcHAuJyk7XHJcbiAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIGlmICghd2luZG93LlNhbGVzUGxhblBhcnNlciB8fCAhd2luZG93LlNhbGVzUGxhblBhcnNlci5wYXJzZVNhbGVzUGxhblNoZWV0KSB7XHJcbiAgICAgIGFsZXJ0KCdQYXJzZXIgU2FsZXMgUGxhbiBubyBjYXJnYWRvLiBSZWJ1aWxkIGJ1bmRsZS4nKTtcclxuICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG4gICAgaWYgKCF3aW5kb3cuZmlyZWJhc2UgfHwgIXdpbmRvdy5maXJlYmFzZS5zdG9yYWdlKSB7XHJcbiAgICAgIGFsZXJ0KCdGaXJlYmFzZSBTdG9yYWdlIG5vIGRpc3BvbmlibGUuJyk7XHJcbiAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIHNldFN0YXR1cygnTGV5ZW5kbyBFeGNlbFx1MjAyNicpO1xyXG4gICAgY29uc3QgYnVmID0gYXdhaXQgZmlsZS5hcnJheUJ1ZmZlcigpO1xyXG4gICAgY29uc3Qgd2IgPSBYTFNYLnJlYWQoYnVmLCB7IHR5cGU6ICdhcnJheScgfSk7XHJcbiAgICBjb25zdCBzYXJOYW1lID0gd2IuU2hlZXROYW1lcy5maW5kKFxyXG4gICAgICAobikgPT5cclxuICAgICAgICBTdHJpbmcobiB8fCAnJylcclxuICAgICAgICAgIC50cmltKClcclxuICAgICAgICAgIC50b1VwcGVyQ2FzZSgpID09PSAnU0FSJ1xyXG4gICAgKTtcclxuICAgIGlmICghc2FyTmFtZSkge1xyXG4gICAgICBzZXRTdGF0dXMoXHJcbiAgICAgICAgJ1x1MjZBMCBFbCBFeGNlbCBubyB0aWVuZSBob2phIFwiU0FSXCIuIEhvamFzIGVuY29udHJhZGFzOiAnICsgd2IuU2hlZXROYW1lcy5qb2luKCcsICcpLFxyXG4gICAgICAgICcjZGMyNjI2J1xyXG4gICAgICApO1xyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcbiAgICBjb25zdCBzaGVldCA9IHdiLlNoZWV0c1tzYXJOYW1lXTtcclxuICAgIGNvbnN0IHJvd3MgPSBYTFNYLnV0aWxzLnNoZWV0X3RvX2pzb24oc2hlZXQsIHsgaGVhZGVyOiAxLCBkZWZ2YWw6ICcnLCByYXc6IHRydWUgfSk7XHJcbiAgICBzZXRTdGF0dXMoJ1BhcnNlYW5kbyAnICsgcm93cy5sZW5ndGggKyAnIGZpbGFzIGRlIGhvamEgXCInICsgc2FyTmFtZSArICdcIlx1MjAyNicpO1xyXG4gICAgY29uc3QgcGFyc2VkID0gd2luZG93LlNhbGVzUGxhblBhcnNlci5wYXJzZVNhbGVzUGxhblNoZWV0KHJvd3MpO1xyXG4gICAgaWYgKCFwYXJzZWQucm93cy5sZW5ndGgpIHtcclxuICAgICAgc2V0U3RhdHVzKCdcdTI2QTAgRXhjZWwgcGFyc2VhZG8gcGVybyBzaW4gU0tVcyB2XHUwMEUxbGlkb3MuJywgJyNkYzI2MjYnKTtcclxuICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG4gICAgY29uc3QgeWVhck1vbnRoID0gX3llYXJNb250aE5vdygpO1xyXG4gICAgY29uc3Qgc3RvcmFnZVBhdGggPSAnZm9yZWNhc3RzX3NuYXBzaG90cy8nICsgeWVhck1vbnRoICsgJy8nICsgZmFtaWxpYSArICcueGxzeCc7XHJcbiAgICBzZXRTdGF0dXMoJ1N1YmllbmRvIEV4Y2VsIGEgU3RvcmFnZSAoJyArIF9mbXRTaXplKGZpbGUuc2l6ZSkgKyAnKVx1MjAyNicpO1xyXG4gICAgY29uc3Qgc3RvcmFnZVJlZiA9IHdpbmRvdy5maXJlYmFzZS5zdG9yYWdlKCkucmVmKHN0b3JhZ2VQYXRoKTtcclxuICAgIGF3YWl0IHN0b3JhZ2VSZWYucHV0KGZpbGUsIHtcclxuICAgICAgY29udGVudFR5cGU6IGZpbGUudHlwZSB8fCAnYXBwbGljYXRpb24vdm5kLm9wZW54bWxmb3JtYXRzLW9mZmljZWRvY3VtZW50LnNwcmVhZHNoZWV0bWwuc2hlZXQnLFxyXG4gICAgICBjdXN0b21NZXRhZGF0YToge1xyXG4gICAgICAgIGZhbWlsaWEsXHJcbiAgICAgICAgdXBsb2FkZWRCeTogKHdpbmRvdy5jdXJyZW50VXNlciAmJiB3aW5kb3cuY3VycmVudFVzZXIuZW1haWwpIHx8ICcnLFxyXG4gICAgICAgIHNvdXJjZUZpbGVuYW1lOiBmaWxlLm5hbWUgfHwgJycsXHJcbiAgICAgIH0sXHJcbiAgICB9KTtcclxuICAgIHNldFN0YXR1cygnR3VhcmRhbmRvIHBhcnNlbyBlbiBGaXJlc3RvcmUgKCcgKyBwYXJzZWQucm93cy5sZW5ndGggKyAnIFNLVXMpXHUyMDI2Jyk7XHJcbiAgICBjb25zdCB1cGxvYWRlZEJ5ID0gKHdpbmRvdy5jdXJyZW50VXNlciAmJiB3aW5kb3cuY3VycmVudFVzZXIuZW1haWwpIHx8ICd1bmtub3duJztcclxuICAgIGNvbnN0IHBheWxvYWQgPSB7XHJcbiAgICAgIGZhbWlsaWEsXHJcbiAgICAgIHBhcnNlZEF0OlxyXG4gICAgICAgIHdpbmRvdy5maXJlYmFzZSAmJiB3aW5kb3cuZmlyZWJhc2UuZmlyZXN0b3JlICYmIHdpbmRvdy5maXJlYmFzZS5maXJlc3RvcmUuRmllbGRWYWx1ZVxyXG4gICAgICAgICAgPyB3aW5kb3cuZmlyZWJhc2UuZmlyZXN0b3JlLkZpZWxkVmFsdWUuc2VydmVyVGltZXN0YW1wKClcclxuICAgICAgICAgIDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxyXG4gICAgICB1cGxvYWRlZEJ5LFxyXG4gICAgICBzb3VyY2VGaWxlbmFtZTogZmlsZS5uYW1lIHx8ICcnLFxyXG4gICAgICBzb3VyY2VTaGVldDogc2FyTmFtZSxcclxuICAgICAgeWVhck1vbnRoLFxyXG4gICAgICBzdG9yYWdlUGF0aCxcclxuICAgICAgcm93c0NvdW50OiBwYXJzZWQucm93cy5sZW5ndGgsXHJcbiAgICAgIGhlYWRlclJvd0luZGV4OiBwYXJzZWQuaGVhZGVyUm93SW5kZXgsXHJcbiAgICAgIGRldGVjdGVkTW9udGhzOiBwYXJzZWQuZGV0ZWN0ZWRNb250aHMsXHJcbiAgICAgIHJvd3M6IHBhcnNlZC5yb3dzLFxyXG4gICAgfTtcclxuICAgIGF3YWl0IHdpbmRvdy5mYkRiLmNvbGxlY3Rpb24oJ3NhbGVzX3BsYW5fY2FjaGUnKS5kb2MoZmFtaWxpYSkuc2V0KHBheWxvYWQpO1xyXG4gICAgLy8gdjExMDcgZml4OiBndWFyZGFyIGNhY2hlIGxvY2FsIGNvbiBEYXRlIHJlYWwgKG5vIGVsIFNlbnRpbmVsVmFsdWUpIHBhcmFcclxuICAgIC8vIHF1ZSBfZm10RGF0ZVNob3J0IG5vIG11ZXN0cmUgXCJJbnZhbGlkIERhdGVcIi4gRWwgc2VydmVyIHRpZW5lIGVsIHRzIGV4YWN0byxcclxuICAgIC8vIGVsIGxvY2FsIG11ZXN0cmEgZWwgbW9tZW50byBkZWwgdXBsb2FkIChhcHJveGltYWRvIH4xcyBkZSBkaWZlcmVuY2lhKS5cclxuICAgIF9zYWxlc1BsYW5DYWNoZXNbZmFtaWxpYV0gPSBPYmplY3QuYXNzaWduKHt9LCBwYXlsb2FkLCB7IHBhcnNlZEF0OiBuZXcgRGF0ZSgpIH0pO1xyXG4gICAgc2V0U3RhdHVzKFxyXG4gICAgICAnXHUyNzEzIE9LLiAnICsgcGFyc2VkLnJvd3MubGVuZ3RoICsgJyBTS1VzIFx1MDBENyAnICsgcGFyc2VkLmRldGVjdGVkTW9udGhzLmxlbmd0aCArICcgbWVzZXMuJyxcclxuICAgICAgJyMxNmEzNGEnXHJcbiAgICApO1xyXG4gICAgX3JlbmRlclNhbGVzUGxhbnNUYWIoKTtcclxuICB9IGNhdGNoIChlKSB7XHJcbiAgICBjb25zb2xlLmVycm9yKCdbRk9SRUNBU1RdIHVwbG9hZCBzYWxlcyBwbGFuICcgKyBmYW1pbGlhICsgJyBmYWlsOicsIGUpO1xyXG4gICAgc2V0U3RhdHVzKCdcdTI3MTcgRXJyb3I6ICcgKyAoKGUgJiYgZS5tZXNzYWdlKSB8fCBlKSwgJyNkYzI2MjYnKTtcclxuICAgIGlmIChlICYmIGUuY29kZSA9PT0gJ01PTlRIU19OT1RfRk9VTkQnKSB7XHJcbiAgICAgIGFsZXJ0KFxyXG4gICAgICAgICdFbCBFeGNlbCBubyB0aWVuZSBjb2x1bW5hcyBkZSBtZXNlcyByZWNvbm9jaWJsZXMuXFxuXFxuSGVhZGVycyBlc3BlcmFkb3M6IFwiSmFuIDIwMjdcIiwgXCJNYXkgMjAyN1wiLCBcIkVuZSAyMDI3XCIsIFwiMjAyNy0wMVwiLCBldGMuXFxuXFxuRGV0YWxsZTogJyArXHJcbiAgICAgICAgICBlLm1lc3NhZ2VcclxuICAgICAgKTtcclxuICAgIH1cclxuICB9IGZpbmFsbHkge1xyXG4gICAgaWYgKGV2ZW50ICYmIGV2ZW50LnRhcmdldCkgZXZlbnQudGFyZ2V0LnZhbHVlID0gJyc7XHJcbiAgfVxyXG59O1xyXG5cclxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcbi8vIEYyQiBcdTIwMTQgRm9yZWNhc3QgRXN0YWRcdTAwRURzdGljbzogdGFibGEgKyBkZXRhbGxlXHJcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cclxuYXN5bmMgZnVuY3Rpb24gX2xvYWRGb3JlY2FzdE91dHB1dCgpIHtcclxuICBpZiAoIXdpbmRvdy5mYkRiKSB0aHJvdyBuZXcgRXJyb3IoJ0ZpcmVzdG9yZSBubyBpbmljaWFsaXphZG8nKTtcclxuICBjb25zb2xlLmxvZygnW0ZPUkVDQVNUIHN0YXRdIGxvYWRpbmcgZm9yZWNhc3Rfb3V0cHV0Li4uJyk7XHJcbiAgY29uc3QgW3NuYXAsIG1ldGFEb2NdID0gYXdhaXQgUHJvbWlzZS5hbGwoW1xyXG4gICAgd2luZG93LmZiRGIuY29sbGVjdGlvbignZm9yZWNhc3Rfb3V0cHV0JykuZ2V0KCksXHJcbiAgICB3aW5kb3cuZmJEYi5jb2xsZWN0aW9uKCdmb3JlY2FzdF9vdXRwdXRfbWV0YScpLmRvYygnY3VycmVudCcpLmdldCgpLFxyXG4gIF0pO1xyXG4gIGNvbnN0IGRvY3MgPSBbXTtcclxuICBzbmFwLmZvckVhY2goKGQpID0+IGRvY3MucHVzaChPYmplY3QuYXNzaWduKHsgaWQ6IGQuaWQgfSwgZC5kYXRhKCkpKSk7XHJcbiAgZG9jcy5zb3J0KChhLCBiKSA9PiB7XHJcbiAgICBjb25zdCB3YSA9IChhLm1ldHJpY3MgJiYgYS5tZXRyaWNzLndhcGUpIHx8IDk5OTtcclxuICAgIGNvbnN0IHdiID0gKGIubWV0cmljcyAmJiBiLm1ldHJpY3Mud2FwZSkgfHwgOTk5O1xyXG4gICAgcmV0dXJuIHdhIC0gd2I7XHJcbiAgfSk7XHJcbiAgX2ZvcmVjYXN0U3RhdERvY3MgPSBkb2NzO1xyXG4gIF9mb3JlY2FzdFN0YXRNZXRhID0gbWV0YURvYy5leGlzdHMgPyBtZXRhRG9jLmRhdGEoKSA6IG51bGw7XHJcbiAgY29uc29sZS5sb2coJ1tGT1JFQ0FTVCBzdGF0XSBsb2FkZWQnLCBkb2NzLmxlbmd0aCwgJ2RvY3MgXHUwMEI3IG1ldGE6JywgISFfZm9yZWNhc3RTdGF0TWV0YSk7XHJcbiAgcmV0dXJuIGRvY3M7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIF93YXBlQmFkZ2VDb2xvcih3KSB7XHJcbiAgaWYgKHcgPT0gbnVsbCkgcmV0dXJuICcjNjQ3NDhiJztcclxuICBpZiAodyA8IDAuMykgcmV0dXJuICcjMTZhMzRhJzsgLy8gdmVyZGUgLSBleGNlbGVudGVcclxuICBpZiAodyA8IDAuNSkgcmV0dXJuICcjODRjYzE2JzsgLy8gbGltYSAtIGJ1ZW5vXHJcbiAgaWYgKHcgPCAwLjcpIHJldHVybiAnI2VhYjMwOCc7IC8vIGFtYXJpbGxvIC0gYWNlcHRhYmxlXHJcbiAgaWYgKHcgPCAxLjApIHJldHVybiAnI2Y5NzMxNic7IC8vIG5hcmFuamEgLSBwb2JyZVxyXG4gIHJldHVybiAnI2RjMjYyNic7IC8vIHJvam8gLSBtdXkgcG9icmVcclxufVxyXG5cclxuZnVuY3Rpb24gX2ZtdE51bShuKSB7XHJcbiAgaWYgKG4gPT0gbnVsbCB8fCAhTnVtYmVyLmlzRmluaXRlKE51bWJlcihuKSkpIHJldHVybiAnXHUyMDE0JztcclxuICByZXR1cm4gTnVtYmVyKG4pLnRvTG9jYWxlU3RyaW5nKCdlcy1BUicsIHsgbWF4aW11bUZyYWN0aW9uRGlnaXRzOiAwIH0pO1xyXG59XHJcblxyXG5mdW5jdGlvbiBfZm10V2FwZSh3KSB7XHJcbiAgaWYgKHcgPT0gbnVsbCB8fCAhTnVtYmVyLmlzRmluaXRlKE51bWJlcih3KSkpIHJldHVybiAnXHUyMDE0JztcclxuICByZXR1cm4gKE51bWJlcih3KSAqIDEwMCkudG9GaXhlZCgwKSArICclJztcclxufVxyXG5cclxuZnVuY3Rpb24gX2ZtdERzU2hvcnQoaXNvKSB7XHJcbiAgLy8gJzIwMjYtMTAtMDEnIC0+ICdvY3QgMjYnXHJcbiAgdHJ5IHtcclxuICAgIGNvbnN0IFt5LCBtXSA9IGlzby5zcGxpdCgnLScpLm1hcChOdW1iZXIpO1xyXG4gICAgY29uc3QgbmFtZXMgPSBbXHJcbiAgICAgICdlbmUnLFxyXG4gICAgICAnZmViJyxcclxuICAgICAgJ21hcicsXHJcbiAgICAgICdhYnInLFxyXG4gICAgICAnbWF5JyxcclxuICAgICAgJ2p1bicsXHJcbiAgICAgICdqdWwnLFxyXG4gICAgICAnYWdvJyxcclxuICAgICAgJ3NlcCcsXHJcbiAgICAgICdvY3QnLFxyXG4gICAgICAnbm92JyxcclxuICAgICAgJ2RpYycsXHJcbiAgICBdO1xyXG4gICAgcmV0dXJuIG5hbWVzW20gLSAxXSArICcgJyArIFN0cmluZyh5KS5zbGljZSgtMik7XHJcbiAgfSBjYXRjaCB7XHJcbiAgICByZXR1cm4gaXNvO1xyXG4gIH1cclxufVxyXG5cclxuZnVuY3Rpb24gX3JlbmRlckZvcmVjYXN0U3RhdFRhYigpIHtcclxuICBjb25zdCBjb250ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2ZvcmVjYXN0LXRhYi1zdGF0Jyk7XHJcbiAgaWYgKCFjb250KSByZXR1cm47XHJcbiAgdHJ5IHtcclxuICAgIF9yZW5kZXJGb3JlY2FzdFN0YXRUYWJJbXBsKGNvbnQpO1xyXG4gIH0gY2F0Y2ggKGUpIHtcclxuICAgIGNvbnNvbGUuZXJyb3IoJ1tGT1JFQ0FTVCBzdGF0XSByZW5kZXIgZmFpbCcsIGUpO1xyXG4gICAgY29udC5pbm5lckhUTUwgPVxyXG4gICAgICAnPGRpdiBzdHlsZT1cInBhZGRpbmc6NDBweCAyMHB4O2NvbG9yOiNkYzI2MjY7bGluZS1oZWlnaHQ6MS42XCI+JyArXHJcbiAgICAgICc8ZGl2IHN0eWxlPVwiZm9udC1zaXplOjE2cHg7Zm9udC13ZWlnaHQ6NzAwO21hcmdpbi1ib3R0b206MTBweFwiPkVycm9yIHJlbmRlcml6YW5kbyB0YWIgRm9yZWNhc3QgRXN0YWRcdTAwRURzdGljbzwvZGl2PicgK1xyXG4gICAgICAnPHByZSBzdHlsZT1cImZvbnQtc2l6ZToxMXB4O2JhY2tncm91bmQ6I2ZlZjJmMjtwYWRkaW5nOjEycHg7Ym9yZGVyLXJhZGl1czo2cHg7b3ZlcmZsb3c6YXV0bzt3aGl0ZS1zcGFjZTpwcmUtd3JhcFwiPicgK1xyXG4gICAgICBlc2NhcGVIdG1sU2FmZShlLnN0YWNrIHx8IGUubWVzc2FnZSB8fCBTdHJpbmcoZSkpICtcclxuICAgICAgJzwvcHJlPjwvZGl2Pic7XHJcbiAgfVxyXG59XHJcblxyXG5mdW5jdGlvbiBfcmVuZGVyRm9yZWNhc3RTdGF0VGFiSW1wbChjb250KSB7XHJcbiAgY29uc3QgZG9jcyA9IF9mb3JlY2FzdFN0YXREb2NzIHx8IFtdO1xyXG4gIGNvbnN0IG1ldGEgPSBfZm9yZWNhc3RTdGF0TWV0YSB8fCB7fTtcclxuICBjb25zdCByZXN1bWVuID0gbWV0YS5yZXN1bWVuIHx8IHt9O1xyXG4gIGNvbnNvbGUubG9nKCdbRk9SRUNBU1Qgc3RhdF0gcmVuZGVyIFx1MjAxNCBkb2NzOicsIGRvY3MubGVuZ3RoLCAnbWV0YTonLCAhIW1ldGEuZ2VuZXJhdGVkQXQpO1xyXG4gIGlmICghZG9jcy5sZW5ndGgpIHtcclxuICAgIGNvbnQuaW5uZXJIVE1MID1cclxuICAgICAgJzxkaXYgc3R5bGU9XCJwYWRkaW5nOjYwcHggMjBweDt0ZXh0LWFsaWduOmNlbnRlcjtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKVwiPicgK1xyXG4gICAgICAnTm8gaGF5IGZvcmVjYXN0X291dHB1dCBwdWJsaWNhZG8uPGJyPjxicj4nICtcclxuICAgICAgJ0NvcnJlciA8Y29kZT5weXRob24gc2NyaXB0cy9mb3JlY2FzdC90cmFpbl9wcm9kLnB5ICYmIHB5dGhvbiBzY3JpcHRzL2ZvcmVjYXN0L3B1Ymxpc2hfdG9fZmlyZXN0b3JlLnB5PC9jb2RlPi4nICtcclxuICAgICAgJzwvZGl2Pic7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIC8vIE1lc2VzIGRlbCBmb3JlY2FzdCAoZHMgZGVsIHByaW1lciBkb2MsIHNlIGFzdW1lIGlndWFsIGVuIHRvZG9zKS5cclxuICBjb25zdCBtb250aHNJc28gPSAoZG9jc1swXS5mb3JlY2FzdCB8fCBbXSkubWFwKChmKSA9PiBmLmRzKTtcclxuICBjb25zdCBtb250aEhlYWRlcnMgPSBtb250aHNJc28ubWFwKF9mbXREc1Nob3J0KTtcclxuXHJcbiAgLy8gTWV0cmljcyBjaGlwIGdsb2JhbFxyXG4gIGNvbnN0IGdlbmVyYXRlZCA9IG1ldGEuZ2VuZXJhdGVkQXRcclxuICAgID8gbmV3IERhdGUobWV0YS5nZW5lcmF0ZWRBdCkudG9Mb2NhbGVTdHJpbmcoJ2VzLUFSJywge1xyXG4gICAgICAgIGRheTogJzItZGlnaXQnLFxyXG4gICAgICAgIG1vbnRoOiAnc2hvcnQnLFxyXG4gICAgICAgIHllYXI6ICcyLWRpZ2l0JyxcclxuICAgICAgICBob3VyOiAnMi1kaWdpdCcsXHJcbiAgICAgICAgbWludXRlOiAnMi1kaWdpdCcsXHJcbiAgICAgIH0pXHJcbiAgICA6ICdcdTIwMTQnO1xyXG4gIGNvbnN0IHdhcGVNZWQgPVxyXG4gICAgcmVzdW1lbi53YXBlX21lZGlhbm9fYmVzdF9wZXJfc2VyaWVzICE9IG51bGxcclxuICAgICAgPyBfZm10V2FwZShyZXN1bWVuLndhcGVfbWVkaWFub19iZXN0X3Blcl9zZXJpZXMpXHJcbiAgICAgIDogJ1x1MjAxNCc7XHJcbiAgY29uc3QgblN1YnMgPSByZXN1bWVuLm5fc3ViZmFtaWxpYXMgfHwgZG9jcy5sZW5ndGg7XHJcbiAgY29uc3Qgbkx0MDUgPVxyXG4gICAgcmVzdW1lbi5uX3Nlcmllc193YXBlX2x0XzBfNSAhPSBudWxsID8gcmVzdW1lbi5uX3Nlcmllc193YXBlX2x0XzBfNSArICcvJyArIG5TdWJzIDogJ1x1MjAxNCc7XHJcbiAgY29uc3Qgbkx0MDMgPVxyXG4gICAgcmVzdW1lbi5uX3Nlcmllc193YXBlX2x0XzBfMyAhPSBudWxsID8gcmVzdW1lbi5uX3Nlcmllc193YXBlX2x0XzBfMyArICcvJyArIG5TdWJzIDogJ1x1MjAxNCc7XHJcblxyXG4gIGNvbnN0IGJhbm5lciA9XHJcbiAgICAnPGRpdiBzdHlsZT1cIm1hcmdpbi1ib3R0b206MTRweDtwYWRkaW5nOjEycHggMTRweDtiYWNrZ3JvdW5kOnZhcigtLWJnLXNlY29uZGFyeSk7Ym9yZGVyLWxlZnQ6M3B4IHNvbGlkICMwZDk0ODg7Ym9yZGVyLXJhZGl1czo2cHg7Zm9udC1zaXplOjEycHg7Y29sb3I6dmFyKC0tdGV4dC1zZWNvbmRhcnkpO2xpbmUtaGVpZ2h0OjEuNTtkaXNwbGF5OmdyaWQ7Z3JpZC10ZW1wbGF0ZS1jb2x1bW5zOnJlcGVhdChhdXRvLWZpdCxtaW5tYXgoMTYwcHgsMWZyKSk7Z2FwOjEwcHhcIj4nICtcclxuICAgICc8ZGl2PjxkaXYgc3R5bGU9XCJmb250LXNpemU6MTBweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7bGV0dGVyLXNwYWNpbmc6LjRweFwiPldBUEUgbWVkaWFubzwvZGl2PjxkaXYgc3R5bGU9XCJmb250LXNpemU6MjBweDtmb250LXdlaWdodDo4MDA7Y29sb3I6dmFyKC0tdGV4dC1wcmltYXJ5KVwiPicgK1xyXG4gICAgd2FwZU1lZCArXHJcbiAgICAnPC9kaXY+PC9kaXY+JyArXHJcbiAgICAnPGRpdj48ZGl2IHN0eWxlPVwiZm9udC1zaXplOjEwcHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO2xldHRlci1zcGFjaW5nOi40cHhcIj5TdWJmYW1pbGlhczwvZGl2PjxkaXYgc3R5bGU9XCJmb250LXNpemU6MjBweDtmb250LXdlaWdodDo4MDA7Y29sb3I6dmFyKC0tdGV4dC1wcmltYXJ5KVwiPicgK1xyXG4gICAgblN1YnMgK1xyXG4gICAgJzwvZGl2PjwvZGl2PicgK1xyXG4gICAgJzxkaXY+PGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMHB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtsZXR0ZXItc3BhY2luZzouNHB4XCI+V0FQRSAmbHQ7IDMwJSAoZXhjZWxlbnRlKTwvZGl2PjxkaXYgc3R5bGU9XCJmb250LXNpemU6MjBweDtmb250LXdlaWdodDo4MDA7Y29sb3I6IzE2YTM0YVwiPicgK1xyXG4gICAgbkx0MDMgK1xyXG4gICAgJzwvZGl2PjwvZGl2PicgK1xyXG4gICAgJzxkaXY+PGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMHB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtsZXR0ZXItc3BhY2luZzouNHB4XCI+V0FQRSAmbHQ7IDUwJSAoYnVlbm8pPC9kaXY+PGRpdiBzdHlsZT1cImZvbnQtc2l6ZToyMHB4O2ZvbnQtd2VpZ2h0OjgwMDtjb2xvcjojODRjYzE2XCI+JyArXHJcbiAgICBuTHQwNSArXHJcbiAgICAnPC9kaXY+PC9kaXY+JyArXHJcbiAgICAnPGRpdj48ZGl2IHN0eWxlPVwiZm9udC1zaXplOjEwcHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO2xldHRlci1zcGFjaW5nOi40cHhcIj5cdTAwREFsdGltYSBjb3JyaWRhPC9kaXY+PGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxM3B4O2ZvbnQtd2VpZ2h0OjYwMDtjb2xvcjp2YXIoLS10ZXh0LXByaW1hcnkpO21hcmdpbi10b3A6NHB4XCI+JyArXHJcbiAgICBlc2NhcGVIdG1sU2FmZShnZW5lcmF0ZWQpICtcclxuICAgICc8L2Rpdj48L2Rpdj4nICtcclxuICAgICc8L2Rpdj4nO1xyXG5cclxuICAvLyBUYWJsYSByb3dzXHJcbiAgY29uc3Qgcm93c0h0bWwgPSBkb2NzXHJcbiAgICAubWFwKChkKSA9PiB7XHJcbiAgICAgIGNvbnN0IHdhcGUgPSBkLm1ldHJpY3MgJiYgZC5tZXRyaWNzLndhcGUgIT0gbnVsbCA/IGQubWV0cmljcy53YXBlIDogbnVsbDtcclxuICAgICAgY29uc3QgYmVzdE1vZGVsID0gZC5iZXN0TW9kZWwgfHwgJ1x1MjAxNCc7XHJcbiAgICAgIGNvbnN0IGZvcmVjYXN0TWFwID0ge307XHJcbiAgICAgIChkLmZvcmVjYXN0IHx8IFtdKS5mb3JFYWNoKChmKSA9PiB7XHJcbiAgICAgICAgZm9yZWNhc3RNYXBbZi5kc10gPSBmLnlfaGF0O1xyXG4gICAgICB9KTtcclxuICAgICAgY29uc3QgbW9udGhDZWxscyA9IG1vbnRoc0lzb1xyXG4gICAgICAgIC5tYXAoXHJcbiAgICAgICAgICAoZHMpID0+XHJcbiAgICAgICAgICAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjhweCAxMHB4O3RleHQtYWxpZ246cmlnaHQ7Zm9udC12YXJpYW50LW51bWVyaWM6dGFidWxhci1udW1zO2ZvbnQtd2VpZ2h0OjYwMDtjb2xvcjp2YXIoLS10ZXh0LXByaW1hcnkpXCI+JyArXHJcbiAgICAgICAgICAgIF9mbXROdW0oZm9yZWNhc3RNYXBbZHNdKSArXHJcbiAgICAgICAgICAgICc8L3RkPidcclxuICAgICAgICApXHJcbiAgICAgICAgLmpvaW4oJycpO1xyXG4gICAgICBjb25zdCB0b3RhbDcgPSAoZC5mb3JlY2FzdCB8fCBbXSkucmVkdWNlKChzLCBmKSA9PiBzICsgKE51bWJlcihmLnlfaGF0KSB8fCAwKSwgMCk7XHJcbiAgICAgIHJldHVybiAoXHJcbiAgICAgICAgJzx0ciBvbmNsaWNrPVwib3BlbkZvcmVjYXN0U3RhdERldGFpbChcXCcnICtcclxuICAgICAgICBlc2NhcGVIdG1sU2FmZShkLmlkKSArXHJcbiAgICAgICAgJ1xcJylcIiBzdHlsZT1cImN1cnNvcjpwb2ludGVyO2JvcmRlci1ib3R0b206MXB4IHNvbGlkIHZhcigtLWJvcmRlci1zdWJ0bGUpXCIgb25tb3VzZW92ZXI9XCJ0aGlzLnN0eWxlLmJhY2tncm91bmQ9XFwndmFyKC0tYmctc2Vjb25kYXJ5KVxcJ1wiIG9ubW91c2VvdXQ9XCJ0aGlzLnN0eWxlLmJhY2tncm91bmQ9XFwndHJhbnNwYXJlbnRcXCdcIj4nICtcclxuICAgICAgICAnPHRkIHN0eWxlPVwicGFkZGluZzo4cHggMTBweDtmb250LXdlaWdodDo3MDA7Y29sb3I6dmFyKC0tdGV4dC1wcmltYXJ5KVwiPicgK1xyXG4gICAgICAgIGVzY2FwZUh0bWxTYWZlKGQuc3ViZmFtaWxpYSB8fCBkLmlkKSArXHJcbiAgICAgICAgJzwvdGQ+JyArXHJcbiAgICAgICAgJzx0ZCBzdHlsZT1cInBhZGRpbmc6OHB4IDEwcHg7Zm9udC1zaXplOjExcHg7Y29sb3I6dmFyKC0tdGV4dC1zZWNvbmRhcnkpXCI+JyArXHJcbiAgICAgICAgZXNjYXBlSHRtbFNhZmUoYmVzdE1vZGVsKSArXHJcbiAgICAgICAgJzwvdGQ+JyArXHJcbiAgICAgICAgJzx0ZCBzdHlsZT1cInBhZGRpbmc6OHB4IDEwcHg7dGV4dC1hbGlnbjpjZW50ZXJcIj48c3BhbiBzdHlsZT1cImRpc3BsYXk6aW5saW5lLWJsb2NrO3BhZGRpbmc6M3B4IDhweDtib3JkZXItcmFkaXVzOjEycHg7YmFja2dyb3VuZDonICtcclxuICAgICAgICBfd2FwZUJhZGdlQ29sb3Iod2FwZSkgK1xyXG4gICAgICAgICc7Y29sb3I6I2ZmZjtmb250LXNpemU6MTFweDtmb250LXdlaWdodDo3MDBcIj4nICtcclxuICAgICAgICBfZm10V2FwZSh3YXBlKSArXHJcbiAgICAgICAgJzwvc3Bhbj48L3RkPicgK1xyXG4gICAgICAgIG1vbnRoQ2VsbHMgK1xyXG4gICAgICAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjhweCAxMHB4O3RleHQtYWxpZ246cmlnaHQ7Zm9udC12YXJpYW50LW51bWVyaWM6dGFidWxhci1udW1zO2ZvbnQtd2VpZ2h0OjcwMDtjb2xvcjojMGQ5NDg4O2JhY2tncm91bmQ6dmFyKC0tYmctc2Vjb25kYXJ5KVwiPicgK1xyXG4gICAgICAgIF9mbXROdW0odG90YWw3KSArXHJcbiAgICAgICAgJzwvdGQ+JyArXHJcbiAgICAgICAgJzwvdHI+J1xyXG4gICAgICApO1xyXG4gICAgfSlcclxuICAgIC5qb2luKCcnKTtcclxuXHJcbiAgY29uc3QgbW9udGhIZWFkZXJzSHRtbCA9IG1vbnRoSGVhZGVyc1xyXG4gICAgLm1hcChcclxuICAgICAgKG0pID0+XHJcbiAgICAgICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6OHB4IDEwcHg7dGV4dC1hbGlnbjpyaWdodDtmb250LXNpemU6MTBweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7bGV0dGVyLXNwYWNpbmc6LjRweDtjb2xvcjojOTRhM2I4XCI+JyArXHJcbiAgICAgICAgZXNjYXBlSHRtbFNhZmUobSkgK1xyXG4gICAgICAgICc8L3RoPidcclxuICAgIClcclxuICAgIC5qb2luKCcnKTtcclxuXHJcbiAgY29uc3QgdGFibGUgPVxyXG4gICAgJzxkaXYgc3R5bGU9XCJvdmVyZmxvdzphdXRvO2JvcmRlcjoxcHggc29saWQgdmFyKC0tYm9yZGVyLXN1YnRsZSk7Ym9yZGVyLXJhZGl1czo4cHhcIj4nICtcclxuICAgICc8dGFibGUgc3R5bGU9XCJ3aWR0aDoxMDAlO2JvcmRlci1jb2xsYXBzZTpjb2xsYXBzZTtmb250LXNpemU6MTJweFwiPicgK1xyXG4gICAgJzx0aGVhZCBzdHlsZT1cImJhY2tncm91bmQ6IzBmMTcyYTtjb2xvcjojZmZmXCI+PHRyPicgK1xyXG4gICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6OHB4IDEwcHg7dGV4dC1hbGlnbjpsZWZ0O2ZvbnQtc2l6ZToxMHB4O3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtsZXR0ZXItc3BhY2luZzouNHB4XCI+U3ViZmFtaWxpYTwvdGg+JyArXHJcbiAgICAnPHRoIHN0eWxlPVwicGFkZGluZzo4cHggMTBweDt0ZXh0LWFsaWduOmxlZnQ7Zm9udC1zaXplOjEwcHg7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO2xldHRlci1zcGFjaW5nOi40cHhcIj5Nb2RlbG88L3RoPicgK1xyXG4gICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6OHB4IDEwcHg7dGV4dC1hbGlnbjpjZW50ZXI7Zm9udC1zaXplOjEwcHg7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO2xldHRlci1zcGFjaW5nOi40cHhcIj5XQVBFPC90aD4nICtcclxuICAgIG1vbnRoSGVhZGVyc0h0bWwgK1xyXG4gICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6OHB4IDEwcHg7dGV4dC1hbGlnbjpyaWdodDtmb250LXNpemU6MTBweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7bGV0dGVyLXNwYWNpbmc6LjRweDtiYWNrZ3JvdW5kOiMxMzRlNGFcIj5Ub3RhbCA3bTwvdGg+JyArXHJcbiAgICAnPC90cj48L3RoZWFkPicgK1xyXG4gICAgJzx0Ym9keT4nICtcclxuICAgIHJvd3NIdG1sICtcclxuICAgICc8L3Rib2R5PjwvdGFibGU+PC9kaXY+JztcclxuXHJcbiAgY29uc3QgZm9vdGVyID1cclxuICAgICc8ZGl2IHN0eWxlPVwibWFyZ2luLXRvcDoxMnB4O2ZvbnQtc2l6ZToxMXB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO2xpbmUtaGVpZ2h0OjEuNVwiPicgK1xyXG4gICAgJzxiPkNcdTAwRjNtbyBsZWVyPC9iPjogV0FQRSAoV2VpZ2h0ZWQgQWJzb2x1dGUgUGVyY2VudGFnZSBFcnJvcikgbWlkZSBlbCBlcnJvciBkZWwgbW9kZWxvIHJlbGF0aXZvIGFsIHRvdGFsIHJlYWw6ICZsdDszMCUgZXhjZWxlbnRlLCAzMC01MCUgYnVlbm8sIDUwLTcwJSBhY2VwdGFibGUsICZndDs3MCUgcG9icmUuIENsaWNrIGVuIGZpbGEgcGFyYSBkZXRhbGxlICsgZ3JcdTAwRTFmaWNvLiAnICtcclxuICAgICdTZSBlbGlnZSBlbCBtb2RlbG8gY29uIG1lbm9yIFdBUEUgcG9yIHNlcmllIHRyYXMgYmFja3Rlc3Qgcm9sbGluZy1vcmlnaW4gKGg9MiwgdmVudGFuYXM9MykuJyArXHJcbiAgICAnPC9kaXY+JztcclxuXHJcbiAgY29udC5pbm5lckhUTUwgPSAnPGRpdiBzdHlsZT1cInBhZGRpbmc6MThweFwiPicgKyBiYW5uZXIgKyB0YWJsZSArIGZvb3RlciArICc8L2Rpdj4nO1xyXG59XHJcblxyXG4vLyBDYWNoZSBoaXN0b3JpYSBhZ3JlZ2FkYSBwb3Igc3ViZmFtaWxpYSAocGFyYSBnclx1MDBFMWZpY28gZGV0YWxsZSkuXHJcbmFzeW5jIGZ1bmN0aW9uIF9sb2FkRm9yZWNhc3RTdGF0SGlzdG9yeSgpIHtcclxuICBpZiAoX2ZvcmVjYXN0U3RhdEhpc3RvcnlDYWNoZSkgcmV0dXJuIF9mb3JlY2FzdFN0YXRIaXN0b3J5Q2FjaGU7XHJcbiAgLy8gTGEgaGlzdG9yaWEgc29sbyBlc3RcdTAwRTEgZW4gQlEgKH4xMCBhXHUwMEYxb3MgQmFyYWxkbyArIDEyIG1lc2VzIFNoaW1hbm8pLiBDb21vXHJcbiAgLy8gZWwgcGlwZWxpbmUgbGEgZXNjcmliZSBhIENTViBsb2NhbCwgYWNcdTAwRTEgbm8gbGEgcG9kZW1vcyBsZWVyLiBBbHRlcm5hdGl2YTpcclxuICAvLyB1c2FyIHNrdV92ZW50YXNfc25hcHNob3QgcXVlIHRpZW5lIHZlbnRhcyBtZW5zdWFsZXMgcGVybyBzb2xvIGdydXBvIFBFU0NBLlxyXG4gIC8vIEVuIEYyQi4yIHNvbG8gbW9zdHJhbW9zIGZvcmVjYXN0K0lDIChzaW4gb3ZlcmxheSBoaXN0b3JpYSBwb3IgYWhvcmEpLlxyXG4gIF9mb3JlY2FzdFN0YXRIaXN0b3J5Q2FjaGUgPSB7fTtcclxuICByZXR1cm4gX2ZvcmVjYXN0U3RhdEhpc3RvcnlDYWNoZTtcclxufVxyXG5cclxuZnVuY3Rpb24gX2J1aWxkRm9yZWNhc3RDaGFydFN2Zyhkb2MpIHtcclxuICBjb25zdCBmYyA9IGRvYy5mb3JlY2FzdCB8fCBbXTtcclxuICBpZiAoIWZjLmxlbmd0aClcclxuICAgIHJldHVybiAnPGRpdiBzdHlsZT1cInBhZGRpbmc6MzBweDt0ZXh0LWFsaWduOmNlbnRlcjtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKVwiPlNpbiBkYXRvcyBkZSBmb3JlY2FzdDwvZGl2Pic7XHJcbiAgLy8gRGltZW5zaW9uZXNcclxuICBjb25zdCBXID0gNjQwLFxyXG4gICAgSCA9IDI2MDtcclxuICBjb25zdCBwYWRMID0gNTAsXHJcbiAgICBwYWRSID0gMjAsXHJcbiAgICBwYWRUID0gMjAsXHJcbiAgICBwYWRCID0gNDA7XHJcbiAgY29uc3QgaW5uZXJXID0gVyAtIHBhZEwgLSBwYWRSO1xyXG4gIGNvbnN0IGlubmVySCA9IEggLSBwYWRUIC0gcGFkQjtcclxuXHJcbiAgLy8gWSByYW5nZTogbWF4KGhpODApICogMS4xXHJcbiAgY29uc3QgbWF4WSA9IE1hdGgubWF4KDEsIC4uLmZjLm1hcCgoZikgPT4gTnVtYmVyKGYuaGk4MCkgfHwgTnVtYmVyKGYueV9oYXQpIHx8IDApKTtcclxuICBjb25zdCBtaW5ZID0gMDtcclxuICBjb25zdCBzY2FsZVggPSAoaSkgPT4gcGFkTCArIChpbm5lclcgKiBpKSAvIE1hdGgubWF4KDEsIGZjLmxlbmd0aCAtIDEpO1xyXG4gIGNvbnN0IHNjYWxlWSA9ICh2KSA9PiBwYWRUICsgaW5uZXJIIC0gKGlubmVySCAqICh2IC0gbWluWSkpIC8gKG1heFkgLSBtaW5ZKTtcclxuXHJcbiAgLy8gR3JpZCArIGVqZSBZXHJcbiAgY29uc3QgeVRpY2tzID0gWzAsIDAuMjUsIDAuNSwgMC43NSwgMV1cclxuICAgIC5tYXAoKHIpID0+IHtcclxuICAgICAgY29uc3QgdmFsID0gbWluWSArIHIgKiAobWF4WSAtIG1pblkpO1xyXG4gICAgICBjb25zdCB5eSA9IHNjYWxlWSh2YWwpO1xyXG4gICAgICByZXR1cm4gKFxyXG4gICAgICAgICc8bGluZSB4MT1cIicgK1xyXG4gICAgICAgIHBhZEwgK1xyXG4gICAgICAgICdcIiB5MT1cIicgK1xyXG4gICAgICAgIHl5ICtcclxuICAgICAgICAnXCIgeDI9XCInICtcclxuICAgICAgICAoVyAtIHBhZFIpICtcclxuICAgICAgICAnXCIgeTI9XCInICtcclxuICAgICAgICB5eSArXHJcbiAgICAgICAgJ1wiIHN0cm9rZT1cIiNlMmU4ZjBcIiBzdHJva2Utd2lkdGg9XCIxXCIvPicgK1xyXG4gICAgICAgICc8dGV4dCB4PVwiJyArXHJcbiAgICAgICAgKHBhZEwgLSA2KSArXHJcbiAgICAgICAgJ1wiIHk9XCInICtcclxuICAgICAgICAoeXkgKyA0KSArXHJcbiAgICAgICAgJ1wiIHRleHQtYW5jaG9yPVwiZW5kXCIgZm9udC1zaXplPVwiMTBcIiBmaWxsPVwiIzY0NzQ4YlwiPicgK1xyXG4gICAgICAgIF9mbXROdW0odmFsKSArXHJcbiAgICAgICAgJzwvdGV4dD4nXHJcbiAgICAgICk7XHJcbiAgICB9KVxyXG4gICAgLmpvaW4oJycpO1xyXG5cclxuICAvLyBFamUgWCAobWVzZXMpXHJcbiAgY29uc3QgeExhYmVscyA9IGZjXHJcbiAgICAubWFwKChmLCBpKSA9PiB7XHJcbiAgICAgIGNvbnN0IHh4ID0gc2NhbGVYKGkpO1xyXG4gICAgICByZXR1cm4gKFxyXG4gICAgICAgICc8dGV4dCB4PVwiJyArXHJcbiAgICAgICAgeHggK1xyXG4gICAgICAgICdcIiB5PVwiJyArXHJcbiAgICAgICAgKEggLSBwYWRCICsgMTUpICtcclxuICAgICAgICAnXCIgdGV4dC1hbmNob3I9XCJtaWRkbGVcIiBmb250LXNpemU9XCIxMFwiIGZpbGw9XCIjNjQ3NDhiXCI+JyArXHJcbiAgICAgICAgX2ZtdERzU2hvcnQoZi5kcykgK1xyXG4gICAgICAgICc8L3RleHQ+J1xyXG4gICAgICApO1xyXG4gICAgfSlcclxuICAgIC5qb2luKCcnKTtcclxuXHJcbiAgLy8gSW50ZXJ2YWxvIGNvbmZpYW56YSAoYmFuZClcclxuICBjb25zdCBiYW5kUG9pbnRzID1cclxuICAgIGZjLm1hcCgoZiwgaSkgPT4gc2NhbGVYKGkpICsgJywnICsgc2NhbGVZKE51bWJlcihmLmhpODApIHx8IDApKS5qb2luKCcgJykgK1xyXG4gICAgJyAnICtcclxuICAgIGZjXHJcbiAgICAgIC5zbGljZSgpXHJcbiAgICAgIC5yZXZlcnNlKClcclxuICAgICAgLm1hcCgoZiwgaSkgPT4gc2NhbGVYKGZjLmxlbmd0aCAtIDEgLSBpKSArICcsJyArIHNjYWxlWShOdW1iZXIoZi5sbzgwKSB8fCAwKSlcclxuICAgICAgLmpvaW4oJyAnKTtcclxuICBjb25zdCBiYW5kID0gJzxwb2x5Z29uIHBvaW50cz1cIicgKyBiYW5kUG9pbnRzICsgJ1wiIGZpbGw9XCIjMGQ5NDg4MzNcIiBzdHJva2U9XCJub25lXCIvPic7XHJcblxyXG4gIC8vIExpbmUgZm9yZWNhc3QgKyBwdW50b3NcclxuICBjb25zdCBsaW5lUG9pbnRzID0gZmMubWFwKChmLCBpKSA9PiBzY2FsZVgoaSkgKyAnLCcgKyBzY2FsZVkoTnVtYmVyKGYueV9oYXQpIHx8IDApKS5qb2luKCcgJyk7XHJcbiAgY29uc3QgbGluZSA9XHJcbiAgICAnPHBvbHlsaW5lIHBvaW50cz1cIicgK1xyXG4gICAgbGluZVBvaW50cyArXHJcbiAgICAnXCIgZmlsbD1cIm5vbmVcIiBzdHJva2U9XCIjMGQ5NDg4XCIgc3Ryb2tlLXdpZHRoPVwiMi41XCIgc3Ryb2tlLWxpbmVqb2luPVwicm91bmRcIi8+JztcclxuICBjb25zdCBwb2ludHMgPSBmY1xyXG4gICAgLm1hcChcclxuICAgICAgKGYsIGkpID0+XHJcbiAgICAgICAgJzxjaXJjbGUgY3g9XCInICtcclxuICAgICAgICBzY2FsZVgoaSkgK1xyXG4gICAgICAgICdcIiBjeT1cIicgK1xyXG4gICAgICAgIHNjYWxlWShOdW1iZXIoZi55X2hhdCkgfHwgMCkgK1xyXG4gICAgICAgICdcIiByPVwiNFwiIGZpbGw9XCIjMGQ5NDg4XCIgc3Ryb2tlPVwiI2ZmZlwiIHN0cm9rZS13aWR0aD1cIjJcIi8+J1xyXG4gICAgKVxyXG4gICAgLmpvaW4oJycpO1xyXG4gIC8vIExhYmVscyBkZSB2YWxvclxyXG4gIGNvbnN0IHZhbHVlTGFiZWxzID0gZmNcclxuICAgIC5tYXAoKGYsIGkpID0+IHtcclxuICAgICAgY29uc3QgeHggPSBzY2FsZVgoaSk7XHJcbiAgICAgIGNvbnN0IHl5ID0gc2NhbGVZKE51bWJlcihmLnlfaGF0KSB8fCAwKTtcclxuICAgICAgcmV0dXJuIChcclxuICAgICAgICAnPHRleHQgeD1cIicgK1xyXG4gICAgICAgIHh4ICtcclxuICAgICAgICAnXCIgeT1cIicgK1xyXG4gICAgICAgICh5eSAtIDgpICtcclxuICAgICAgICAnXCIgdGV4dC1hbmNob3I9XCJtaWRkbGVcIiBmb250LXNpemU9XCIxMFwiIGZvbnQtd2VpZ2h0PVwiNzAwXCIgZmlsbD1cIiMwZjc2NmVcIj4nICtcclxuICAgICAgICBfZm10TnVtKGYueV9oYXQpICtcclxuICAgICAgICAnPC90ZXh0PidcclxuICAgICAgKTtcclxuICAgIH0pXHJcbiAgICAuam9pbignJyk7XHJcblxyXG4gIGNvbnN0IHN2ZyA9XHJcbiAgICAnPHN2ZyB2aWV3Qm94PVwiMCAwICcgK1xyXG4gICAgVyArXHJcbiAgICAnICcgK1xyXG4gICAgSCArXHJcbiAgICAnXCIgc3R5bGU9XCJ3aWR0aDoxMDAlO21heC13aWR0aDo4MDBweDtoZWlnaHQ6YXV0b1wiPicgK1xyXG4gICAgJzxyZWN0IHg9XCIwXCIgeT1cIjBcIiB3aWR0aD1cIicgK1xyXG4gICAgVyArXHJcbiAgICAnXCIgaGVpZ2h0PVwiJyArXHJcbiAgICBIICtcclxuICAgICdcIiBmaWxsPVwiI2ZmZlwiLz4nICtcclxuICAgIHlUaWNrcyArXHJcbiAgICB4TGFiZWxzICtcclxuICAgIGJhbmQgK1xyXG4gICAgbGluZSArXHJcbiAgICBwb2ludHMgK1xyXG4gICAgdmFsdWVMYWJlbHMgK1xyXG4gICAgJzwvc3ZnPic7XHJcbiAgcmV0dXJuIHN2ZztcclxufVxyXG5cclxud2luZG93Lm9wZW5Gb3JlY2FzdFN0YXREZXRhaWwgPSBmdW5jdGlvbiAoc3ViSWQpIHtcclxuICBpZiAoIV9mb3JlY2FzdFN0YXREb2NzKSByZXR1cm47XHJcbiAgY29uc3QgZG9jID0gX2ZvcmVjYXN0U3RhdERvY3MuZmluZCgoZCkgPT4gZC5pZCA9PT0gc3ViSWQpO1xyXG4gIGlmICghZG9jKSB7XHJcbiAgICBhbGVydCgnTm8gc2UgZW5jb250clx1MDBGMyBkZXRhbGxlIGRlICcgKyBzdWJJZCk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIGNvbnN0IGV4aXN0aW5nID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2ZvcmVjYXN0LXN0YXQtZGV0YWlsJyk7XHJcbiAgaWYgKGV4aXN0aW5nKSBleGlzdGluZy5yZW1vdmUoKTtcclxuXHJcbiAgY29uc3QgZWwgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKTtcclxuICBlbC5pZCA9ICdmb3JlY2FzdC1zdGF0LWRldGFpbCc7XHJcbiAgZWwuc3R5bGUuY3NzVGV4dCA9XHJcbiAgICAncG9zaXRpb246Zml4ZWQ7aW5zZXQ6MDtiYWNrZ3JvdW5kOnJnYmEoMTUsMjMsNDIsLjY1KTt6LWluZGV4OjIxMDA7ZGlzcGxheTpmbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtqdXN0aWZ5LWNvbnRlbnQ6Y2VudGVyO3BhZGRpbmc6MnZoJztcclxuICBlbC5vbmNsaWNrID0gKGV2KSA9PiB7XHJcbiAgICBpZiAoZXYudGFyZ2V0ID09PSBlbCkgZWwucmVtb3ZlKCk7XHJcbiAgfTtcclxuXHJcbiAgY29uc3Qgd2FwZSA9IGRvYy5tZXRyaWNzICYmIGRvYy5tZXRyaWNzLndhcGU7XHJcbiAgY29uc3QgYmlhcyA9IGRvYy5tZXRyaWNzICYmIGRvYy5tZXRyaWNzLmJpYXM7XHJcbiAgY29uc3QgbWFlID0gZG9jLm1ldHJpY3MgJiYgZG9jLm1ldHJpY3MubWFlO1xyXG4gIGNvbnN0IHJtc2UgPSBkb2MubWV0cmljcyAmJiBkb2MubWV0cmljcy5ybXNlO1xyXG4gIGNvbnN0IGJlc3RNb2RlbCA9IGRvYy5iZXN0TW9kZWwgfHwgJ1x1MjAxNCc7XHJcbiAgY29uc3QgdmVyc2lvbklkID0gZG9jLnZlcnNpb25JZCB8fCAnXHUyMDE0JztcclxuICBjb25zdCBzdmdIdG1sID0gX2J1aWxkRm9yZWNhc3RDaGFydFN2Zyhkb2MpO1xyXG5cclxuICBjb25zdCBtZXRyaWNzSHRtbCA9XHJcbiAgICAnPGRpdiBzdHlsZT1cImRpc3BsYXk6Z3JpZDtncmlkLXRlbXBsYXRlLWNvbHVtbnM6cmVwZWF0KGF1dG8tZml0LG1pbm1heCgxMjBweCwxZnIpKTtnYXA6MTBweDttYXJnaW46MTRweCAwXCI+JyArXHJcbiAgICAnPGRpdiBzdHlsZT1cInBhZGRpbmc6MTBweDtiYWNrZ3JvdW5kOnZhcigtLWJnLXNlY29uZGFyeSk7Ym9yZGVyLXJhZGl1czo2cHhcIj48ZGl2IHN0eWxlPVwiZm9udC1zaXplOjEwcHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlXCI+TW9kZWxvPC9kaXY+PGRpdiBzdHlsZT1cImZvbnQtd2VpZ2h0OjcwMFwiPicgK1xyXG4gICAgZXNjYXBlSHRtbFNhZmUoYmVzdE1vZGVsKSArXHJcbiAgICAnPC9kaXY+PC9kaXY+JyArXHJcbiAgICAnPGRpdiBzdHlsZT1cInBhZGRpbmc6MTBweDtiYWNrZ3JvdW5kOnZhcigtLWJnLXNlY29uZGFyeSk7Ym9yZGVyLXJhZGl1czo2cHhcIj48ZGl2IHN0eWxlPVwiZm9udC1zaXplOjEwcHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlXCI+V0FQRTwvZGl2PjxkaXYgc3R5bGU9XCJmb250LXdlaWdodDo3MDA7Y29sb3I6JyArXHJcbiAgICBfd2FwZUJhZGdlQ29sb3Iod2FwZSkgK1xyXG4gICAgJ1wiPicgK1xyXG4gICAgX2ZtdFdhcGUod2FwZSkgK1xyXG4gICAgJzwvZGl2PjwvZGl2PicgK1xyXG4gICAgJzxkaXYgc3R5bGU9XCJwYWRkaW5nOjEwcHg7YmFja2dyb3VuZDp2YXIoLS1iZy1zZWNvbmRhcnkpO2JvcmRlci1yYWRpdXM6NnB4XCI+PGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMHB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZVwiPkJpYXM8L2Rpdj48ZGl2IHN0eWxlPVwiZm9udC13ZWlnaHQ6NzAwXCI+JyArXHJcbiAgICAoYmlhcyAhPSBudWxsID8gKGJpYXMgKiAxMDApLnRvRml4ZWQoMCkgKyAnJScgOiAnXHUyMDE0JykgK1xyXG4gICAgJzwvZGl2PjwvZGl2PicgK1xyXG4gICAgJzxkaXYgc3R5bGU9XCJwYWRkaW5nOjEwcHg7YmFja2dyb3VuZDp2YXIoLS1iZy1zZWNvbmRhcnkpO2JvcmRlci1yYWRpdXM6NnB4XCI+PGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMHB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZVwiPk1BRTwvZGl2PjxkaXYgc3R5bGU9XCJmb250LXdlaWdodDo3MDBcIj4nICtcclxuICAgIF9mbXROdW0obWFlKSArXHJcbiAgICAnPC9kaXY+PC9kaXY+JyArXHJcbiAgICAnPGRpdiBzdHlsZT1cInBhZGRpbmc6MTBweDtiYWNrZ3JvdW5kOnZhcigtLWJnLXNlY29uZGFyeSk7Ym9yZGVyLXJhZGl1czo2cHhcIj48ZGl2IHN0eWxlPVwiZm9udC1zaXplOjEwcHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlXCI+Uk1TRTwvZGl2PjxkaXYgc3R5bGU9XCJmb250LXdlaWdodDo3MDBcIj4nICtcclxuICAgIF9mbXROdW0ocm1zZSkgK1xyXG4gICAgJzwvZGl2PjwvZGl2PicgK1xyXG4gICAgJzwvZGl2Pic7XHJcblxyXG4gIGNvbnN0IHRhYmxlSHRtbCA9XHJcbiAgICAnPHRhYmxlIHN0eWxlPVwid2lkdGg6MTAwJTtmb250LXNpemU6MTJweDtib3JkZXItY29sbGFwc2U6Y29sbGFwc2U7bWFyZ2luLXRvcDoxMHB4XCI+JyArXHJcbiAgICAnPHRoZWFkIHN0eWxlPVwiYmFja2dyb3VuZDojMGYxNzJhO2NvbG9yOiNmZmZcIj48dHI+JyArXHJcbiAgICAnPHRoIHN0eWxlPVwicGFkZGluZzo2cHggMTBweDt0ZXh0LWFsaWduOmxlZnRcIj5NZXM8L3RoPicgK1xyXG4gICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6NnB4IDEwcHg7dGV4dC1hbGlnbjpyaWdodFwiPkZvcmVjYXN0PC90aD4nICtcclxuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjZweCAxMHB4O3RleHQtYWxpZ246cmlnaHRcIj5JQyA4MCUgYmFqbzwvdGg+JyArXHJcbiAgICAnPHRoIHN0eWxlPVwicGFkZGluZzo2cHggMTBweDt0ZXh0LWFsaWduOnJpZ2h0XCI+SUMgODAlIGFsdG88L3RoPicgK1xyXG4gICAgJzwvdHI+PC90aGVhZD48dGJvZHk+JyArXHJcbiAgICAoZG9jLmZvcmVjYXN0IHx8IFtdKVxyXG4gICAgICAubWFwKFxyXG4gICAgICAgIChmKSA9PlxyXG4gICAgICAgICAgJzx0ciBzdHlsZT1cImJvcmRlci1ib3R0b206MXB4IHNvbGlkIHZhcigtLWJvcmRlci1zdWJ0bGUpXCI+PHRkIHN0eWxlPVwicGFkZGluZzo2cHggMTBweFwiPicgK1xyXG4gICAgICAgICAgZXNjYXBlSHRtbFNhZmUoX2ZtdERzU2hvcnQoZi5kcykpICtcclxuICAgICAgICAgICc8L3RkPicgK1xyXG4gICAgICAgICAgJzx0ZCBzdHlsZT1cInBhZGRpbmc6NnB4IDEwcHg7dGV4dC1hbGlnbjpyaWdodDtmb250LXdlaWdodDo3MDBcIj4nICtcclxuICAgICAgICAgIF9mbXROdW0oZi55X2hhdCkgK1xyXG4gICAgICAgICAgJzwvdGQ+JyArXHJcbiAgICAgICAgICAnPHRkIHN0eWxlPVwicGFkZGluZzo2cHggMTBweDt0ZXh0LWFsaWduOnJpZ2h0O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpXCI+JyArXHJcbiAgICAgICAgICBfZm10TnVtKGYubG84MCkgK1xyXG4gICAgICAgICAgJzwvdGQ+JyArXHJcbiAgICAgICAgICAnPHRkIHN0eWxlPVwicGFkZGluZzo2cHggMTBweDt0ZXh0LWFsaWduOnJpZ2h0O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpXCI+JyArXHJcbiAgICAgICAgICBfZm10TnVtKGYuaGk4MCkgK1xyXG4gICAgICAgICAgJzwvdGQ+PC90cj4nXHJcbiAgICAgIClcclxuICAgICAgLmpvaW4oJycpICtcclxuICAgICc8L3Rib2R5PjwvdGFibGU+JztcclxuXHJcbiAgY29uc3QgY29udGVudCA9XHJcbiAgICAnPGRpdiBzdHlsZT1cImJhY2tncm91bmQ6dmFyKC0tYmctZWxldmF0ZWQpO2JvcmRlci1yYWRpdXM6MTJweDtwYWRkaW5nOjI0cHg7bWF4LXdpZHRoOjgyMHB4O3dpZHRoOjEwMCU7bWF4LWhlaWdodDo5NnZoO292ZXJmbG93OmF1dG87Ym94LXNoYWRvdzowIDIwcHggNjBweCByZ2JhKDAsMCwwLC40KVwiPicgK1xyXG4gICAgJzxkaXYgc3R5bGU9XCJkaXNwbGF5OmZsZXg7anVzdGlmeS1jb250ZW50OnNwYWNlLWJldHdlZW47YWxpZ24taXRlbXM6Y2VudGVyO21hcmdpbi1ib3R0b206MTBweFwiPicgK1xyXG4gICAgJzxkaXY+PGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMXB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtsZXR0ZXItc3BhY2luZzouNHB4XCI+U3ViZmFtaWxpYTwvZGl2PjxkaXYgc3R5bGU9XCJmb250LXNpemU6MjJweDtmb250LXdlaWdodDo4MDBcIj4nICtcclxuICAgIGVzY2FwZUh0bWxTYWZlKGRvYy5zdWJmYW1pbGlhIHx8IGRvYy5pZCkgK1xyXG4gICAgJzwvZGl2PjwvZGl2PicgK1xyXG4gICAgJzxidXR0b24gb25jbGljaz1cImRvY3VtZW50LmdldEVsZW1lbnRCeUlkKFxcJ2ZvcmVjYXN0LXN0YXQtZGV0YWlsXFwnKS5yZW1vdmUoKVwiIHN0eWxlPVwiYmFja2dyb3VuZDp0cmFuc3BhcmVudDtib3JkZXI6MXB4IHNvbGlkIHZhcigtLWJvcmRlci1zdWJ0bGUpO2JvcmRlci1yYWRpdXM6NnB4O3BhZGRpbmc6NnB4IDEycHg7Y3Vyc29yOnBvaW50ZXI7Zm9udC13ZWlnaHQ6NzAwXCI+Q2VycmFyPC9idXR0b24+JyArXHJcbiAgICAnPC9kaXY+JyArXHJcbiAgICBtZXRyaWNzSHRtbCArXHJcbiAgICAnPGRpdiBzdHlsZT1cImJhY2tncm91bmQ6I2ZmZjtwYWRkaW5nOjhweDtib3JkZXItcmFkaXVzOjhweDttYXJnaW4tdG9wOjEwcHg7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1ib3JkZXItc3VidGxlKVwiPicgK1xyXG4gICAgc3ZnSHRtbCArXHJcbiAgICAnPC9kaXY+JyArXHJcbiAgICB0YWJsZUh0bWwgK1xyXG4gICAgJzxkaXYgc3R5bGU9XCJtYXJnaW4tdG9wOjE0cHg7Zm9udC1zaXplOjExcHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZClcIj5WZXJzaW9uOiA8Y29kZT4nICtcclxuICAgIGVzY2FwZUh0bWxTYWZlKHZlcnNpb25JZCkgK1xyXG4gICAgJzwvY29kZT4gXHUwMEI3IEFwcHJvYWNoOiAnICtcclxuICAgIGVzY2FwZUh0bWxTYWZlKChkb2MuY29uZmlnIHx8IHt9KS5hcHByb2FjaCB8fCAnXHUyMDE0JykgK1xyXG4gICAgJzwvZGl2PicgK1xyXG4gICAgJzwvZGl2Pic7XHJcbiAgZWwuaW5uZXJIVE1MID0gY29udGVudDtcclxuICBkb2N1bWVudC5ib2R5LmFwcGVuZENoaWxkKGVsKTtcclxufTtcclxuXHJcbndpbmRvdy5vcGVuRm9yZWNhc3RNb2RhbCA9IGFzeW5jIGZ1bmN0aW9uICgpIHtcclxuICBpZiAoIV9jYW5Gb3JlY2FzdCgpKSB7XHJcbiAgICBhbGVydCgnRk9SRUNBU1QgZXMgc29sbyBwYXJhIE1hcmlhbm8gKGFkbWluKS4nKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgY29uc3QgZWwgPSBfcmVuZGVyTW9kYWxTaGVsbCgpO1xyXG4gIGVsLnN0eWxlLmRpc3BsYXkgPSAnYmxvY2snO1xyXG4gIC8vIHYxMDk4KyBGYXNlIDE6IGNhcmdhciBTYWxlcyBQbGFucyBjYWNoZXMgKyByZW5kZXJpemFyIHRhYiBkZWZhdWx0LlxyXG4gIF9yZW5kZXJTYWxlc1BsYW5zVGFiKCk7XHJcbiAgX2xvYWRTYWxlc1BsYW5DYWNoZXMoKVxyXG4gICAgLnRoZW4oX3JlbmRlclNhbGVzUGxhbnNUYWIpXHJcbiAgICAuY2F0Y2goKCkgPT4ge30pO1xyXG4gIC8vIExlZ2FjeTogc25hcHNob3Qgc29sbyBzZSBjYXJnYSBsYXp5IHNpIGVsIHVzZXIgY2FtYmlhIGEgdGFiIExlZ2FjeS5cclxuICBpZiAoX2ZvcmVjYXN0TG9hZGluZykgcmV0dXJuO1xyXG4gIGlmICghX2ZvcmVjYXN0U25hcHNob3QpIHtcclxuICAgIF9mb3JlY2FzdExvYWRpbmcgPSB0cnVlO1xyXG4gICAgY29uc3Qgc3RhdHMgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZm9yZWNhc3Qtc3RhdHMnKTtcclxuICAgIGlmIChzdGF0cykgc3RhdHMudGV4dENvbnRlbnQgPSAnQ2FyZ2FuZG8gc25hcHNob3QgZGUgdmVudGFzLi4uJztcclxuICAgIHRyeSB7XHJcbiAgICAgIGF3YWl0IF9sb2FkU25hcHNob3QoKTtcclxuICAgICAgaWYgKHN0YXRzKSBzdGF0cy50ZXh0Q29udGVudCA9IF9mb3JlY2FzdFNuYXBzaG90LmNvdW50ICsgJyBTS1VzIGVuIHNuYXBzaG90IGhpc3Rvcmljbyc7XHJcbiAgICB9IGNhdGNoIChlKSB7XHJcbiAgICAgIGlmIChzdGF0cykgc3RhdHMudGV4dENvbnRlbnQgPSAnRXJyb3IgY2FyZ2FuZG8gc25hcHNob3Q6ICcgKyAoKGUgJiYgZS5tZXNzYWdlKSB8fCBlKTtcclxuICAgICAgLy8gTm8gYWxlcnQgXHUyMDE0IGxlZ2FjeSBlcyBvcHQtaW4sIG5vIGJsb3F1ZWEgYWwgdXN1YXJpbyBzaSBzb2xvIHZhIGEgc3ViaXIgU2FsZXMgUGxhbnMuXHJcbiAgICAgIGNvbnNvbGUud2FybignW0ZPUkVDQVNUXSBzbmFwc2hvdCBsb2FkIGZhaWwgKGxlZ2FjeSB0YWIpJywgZSk7XHJcbiAgICB9IGZpbmFsbHkge1xyXG4gICAgICBfZm9yZWNhc3RMb2FkaW5nID0gZmFsc2U7XHJcbiAgICB9XHJcbiAgfSBlbHNlIHtcclxuICAgIGNvbnN0IHN0YXRzID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2ZvcmVjYXN0LXN0YXRzJyk7XHJcbiAgICBpZiAoc3RhdHMpIHN0YXRzLnRleHRDb250ZW50ID0gX2ZvcmVjYXN0U25hcHNob3QuY291bnQgKyAnIFNLVXMgZW4gc25hcHNob3QgaGlzdG9yaWNvJztcclxuICB9XHJcbn07XHJcblxyXG53aW5kb3cuY2xvc2VGb3JlY2FzdE1vZGFsID0gZnVuY3Rpb24gKCkge1xyXG4gIGNvbnN0IGVsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2ZvcmVjYXN0LW1vZGFsJyk7XHJcbiAgaWYgKGVsKSBlbC5zdHlsZS5kaXNwbGF5ID0gJ25vbmUnO1xyXG59O1xyXG5cclxud2luZG93Lm9uRm9yZWNhc3RTYWxlc1BsYW5GaWxlID0gYXN5bmMgZnVuY3Rpb24gKGV2ZW50KSB7XHJcbiAgY29uc3QgZmlsZSA9IGV2ZW50ICYmIGV2ZW50LnRhcmdldCAmJiBldmVudC50YXJnZXQuZmlsZXMgJiYgZXZlbnQudGFyZ2V0LmZpbGVzWzBdO1xyXG4gIGlmICghZmlsZSkgcmV0dXJuO1xyXG4gIHRyeSB7XHJcbiAgICBpZiAoIV9mb3JlY2FzdFNuYXBzaG90KSBhd2FpdCBfbG9hZFNuYXBzaG90KCk7XHJcbiAgICBjb25zdCBidWYgPSBhd2FpdCBmaWxlLmFycmF5QnVmZmVyKCk7XHJcbiAgICBpZiAodHlwZW9mIFhMU1ggPT09ICd1bmRlZmluZWQnKSB7XHJcbiAgICAgIGFsZXJ0KCdYTFNYIG5vIGNhcmdhZG8nKTtcclxuICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG4gICAgY29uc3Qgd2IgPSBYTFNYLnJlYWQoYnVmLCB7IHR5cGU6ICdhcnJheScgfSk7XHJcbiAgICBjb25zdCBzaGVldCA9IHdiLlNoZWV0c1t3Yi5TaGVldE5hbWVzWzBdXTtcclxuICAgIGNvbnN0IHJvd3MgPSBYTFNYLnV0aWxzLnNoZWV0X3RvX2pzb24oc2hlZXQsIHsgaGVhZGVyOiAxLCBkZWZ2YWw6IG51bGwsIHJhdzogdHJ1ZSB9KTtcclxuICAgIGNvbnN0IHBhcnNlZCA9IF9wYXJzZVNhbGVzUGxhblJvd3Mocm93cyk7XHJcbiAgICBpZiAoIXBhcnNlZC5sZW5ndGgpIHtcclxuICAgICAgYWxlcnQoJ0VsIEV4Y2VsIGVzdGEgdmFjaW8gbyBubyB0aWVuZSBmaWxhcyB2YWxpZGFzLicpO1xyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcbiAgICBfZm9yZWNhc3RTYWxlc1BsYW4gPSBwYXJzZWQ7XHJcbiAgICBjb25zdCBob3kgPSBuZXcgRGF0ZSgpO1xyXG4gICAgX2ZvcmVjYXN0Um93cyA9IF9jb21wdXRlRm9yZWNhc3RSb3dzKF9mb3JlY2FzdFNuYXBzaG90LCBwYXJzZWQsIGhveSk7XHJcbiAgICBfcmVuZGVyVGFibGUoX2ZvcmVjYXN0Um93cyk7XHJcbiAgICBjb25zdCBzaW5NYXRjaCA9IF9mb3JlY2FzdFJvd3MuZmlsdGVyKChyKSA9PiAhci5oYXNIaXN0b3JpYSkubGVuZ3RoO1xyXG4gICAgY29uc3Qgc3RhdHMgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZm9yZWNhc3Qtc3RhdHMnKTtcclxuICAgIGlmIChzdGF0cykge1xyXG4gICAgICBzdGF0cy50ZXh0Q29udGVudCA9XHJcbiAgICAgICAgcGFyc2VkLmxlbmd0aCArXHJcbiAgICAgICAgJyBTS1VzIGVuIFNhbGVzIFBsYW4gXHUwMEI3ICcgK1xyXG4gICAgICAgIChwYXJzZWQubGVuZ3RoIC0gc2luTWF0Y2gpICtcclxuICAgICAgICAnIGNvbiBoaXN0b3JpYSBcdTAwQjcgJyArXHJcbiAgICAgICAgc2luTWF0Y2ggK1xyXG4gICAgICAgICcgc2luIG1hdGNoIChmb25kbyBhbWFyaWxsbyknO1xyXG4gICAgfVxyXG4gICAgY29uc3QgYnRuID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2ZvcmVjYXN0LWV4cG9ydC1idG4nKTtcclxuICAgIGlmIChidG4pIHtcclxuICAgICAgYnRuLmRpc2FibGVkID0gZmFsc2U7XHJcbiAgICAgIGJ0bi5zdHlsZS5vcGFjaXR5ID0gJzEnO1xyXG4gICAgfVxyXG4gIH0gY2F0Y2ggKGUpIHtcclxuICAgIGNvbnNvbGUuZXJyb3IoJ1tGT1JFQ0FTVF0gcGFyc2UgZXJyb3I6JywgZSk7XHJcbiAgICBhbGVydCgnRXJyb3IgcHJvY2VzYW5kbyBlbCBFeGNlbDpcXG4nICsgKChlICYmIGUubWVzc2FnZSkgfHwgZSkpO1xyXG4gIH0gZmluYWxseSB7XHJcbiAgICAvLyBSZXNldCBpbnB1dCBwYXJhIHF1ZSBlbCBtaXNtbyBhcmNoaXZvIHNlIHB1ZWRhIHJlLXN1YmlyXHJcbiAgICBpZiAoZXZlbnQgJiYgZXZlbnQudGFyZ2V0KSBldmVudC50YXJnZXQudmFsdWUgPSAnJztcclxuICB9XHJcbn07XHJcblxyXG53aW5kb3cuZXhwb3J0Rm9yZWNhc3RFeGNlbCA9IGZ1bmN0aW9uICgpIHtcclxuICBpZiAoIV9mb3JlY2FzdFJvd3MgfHwgIV9mb3JlY2FzdFJvd3MubGVuZ3RoKSB7XHJcbiAgICBhbGVydCgnTm8gaGF5IGRhdG9zIHBhcmEgZXhwb3J0YXIuIENhcmdhIHByaW1lcm8gZWwgU2FsZXMgUGxhbi4nKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgaWYgKHR5cGVvZiBYTFNYID09PSAndW5kZWZpbmVkJykge1xyXG4gICAgYWxlcnQoJ1hMU1ggbm8gY2FyZ2FkbycpO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuICBjb25zdCByb3VuZDEgPSAobikgPT4gTWF0aC5yb3VuZChOdW1iZXIobiB8fCAwKSAqIDEwKSAvIDEwO1xyXG4gIGNvbnN0IGFvYSA9IFtcclxuICAgIFtcclxuICAgICAgJ1NLVScsXHJcbiAgICAgICdGQU1JTElBJyxcclxuICAgICAgJ1NVQkZBTUlMSUEnLFxyXG4gICAgICAnVkVOVEFTICgxMm0pJyxcclxuICAgICAgJ1BFRElETy1TQUxFUyBQTEFOUyAoNm0pJyxcclxuICAgICAgJ1BST01FRElPIERFIElOVkVOVEFSSU8nLFxyXG4gICAgICAnUE9MSVRJQ0EgREUgSU5WRU5UQVJJTyAoM20pJyxcclxuICAgICAgJ1RPVEFMJyxcclxuICAgIF0sXHJcbiAgXTtcclxuICBmb3IgKGNvbnN0IHIgb2YgX2ZvcmVjYXN0Um93cykge1xyXG4gICAgYW9hLnB1c2goW1xyXG4gICAgICByLnNrdSxcclxuICAgICAgci5mYW1pbGlhLFxyXG4gICAgICByLnN1YmZhbWlsaWEsXHJcbiAgICAgIHJvdW5kMShyLnZlbnRhczEybSksXHJcbiAgICAgIHJvdW5kMShyLnBlZGlkbzZtKSxcclxuICAgICAgcm91bmQxKHIucHJvbWVkaW8pLFxyXG4gICAgICByb3VuZDEoci5wb2xpdGljYSksXHJcbiAgICAgIHJvdW5kMShyLnRvdGFsKSxcclxuICAgIF0pO1xyXG4gIH1cclxuICBjb25zdCB3cyA9IFhMU1gudXRpbHMuYW9hX3RvX3NoZWV0KGFvYSk7XHJcbiAgLy8gQW5jaG9zIGRlIGNvbHVtbmFcclxuICB3c1snIWNvbHMnXSA9IFtcclxuICAgIHsgd2NoOiAxOCB9LFxyXG4gICAgeyB3Y2g6IDI0IH0sXHJcbiAgICB7IHdjaDogMjQgfSxcclxuICAgIHsgd2NoOiAxNCB9LFxyXG4gICAgeyB3Y2g6IDIwIH0sXHJcbiAgICB7IHdjaDogMjAgfSxcclxuICAgIHsgd2NoOiAyMiB9LFxyXG4gICAgeyB3Y2g6IDEyIH0sXHJcbiAgXTtcclxuICBjb25zdCB3YiA9IFhMU1gudXRpbHMuYm9va19uZXcoKTtcclxuICBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KHdiLCB3cywgJ0ZPUkVDQVNUJyk7XHJcbiAgY29uc3QgaG95ID0gbmV3IERhdGUoKTtcclxuICBjb25zdCBzdGFtcCA9XHJcbiAgICBob3kuZ2V0RnVsbFllYXIoKSArXHJcbiAgICAnLScgK1xyXG4gICAgU3RyaW5nKGhveS5nZXRNb250aCgpICsgMSkucGFkU3RhcnQoMiwgJzAnKSArXHJcbiAgICAnLScgK1xyXG4gICAgU3RyaW5nKGhveS5nZXREYXRlKCkpLnBhZFN0YXJ0KDIsICcwJyk7XHJcbiAgWExTWC53cml0ZUZpbGUod2IsICdGb3JlY2FzdF9TaGltYW5vXycgKyBzdGFtcCArICcueGxzeCcpO1xyXG59O1xyXG5cclxuLy8gUmVmcmVzaCBwdWJsaWNvIChwb3Igc2kgZWwgdXNlciBuZWNlc2l0YSByZS1mZXRjaGVhciBlbCBzbmFwc2hvdCBzaW4gY2VycmFyXHJcbi8vIGVsIG1vZGFsLCBlajogcGFzYXJvbiAzMCBtaW4geSBlbCBjcm9uIEJRIGFjdHVhbGl6byBsYSBjb2xlY2Npb24pLlxyXG53aW5kb3cucmVsb2FkRm9yZWNhc3RTbmFwc2hvdCA9IGFzeW5jIGZ1bmN0aW9uICgpIHtcclxuICBfZm9yZWNhc3RTbmFwc2hvdCA9IG51bGw7XHJcbiAgYXdhaXQgX2xvYWRTbmFwc2hvdCgpO1xyXG4gIGlmIChfZm9yZWNhc3RTYWxlc1BsYW4pIHtcclxuICAgIGNvbnN0IGhveSA9IG5ldyBEYXRlKCk7XHJcbiAgICBfZm9yZWNhc3RSb3dzID0gX2NvbXB1dGVGb3JlY2FzdFJvd3MoX2ZvcmVjYXN0U25hcHNob3QsIF9mb3JlY2FzdFNhbGVzUGxhbiwgaG95KTtcclxuICAgIF9yZW5kZXJUYWJsZShfZm9yZWNhc3RSb3dzKTtcclxuICB9XHJcbn07XHJcblxyXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuLy8gRjNBIFx1MjAxNCBUYWJsYSBSZWNvbWVuZGFjaVx1MDBGM24gZGUgQ29tcHJhICh0YWIgU2FsZXMgUGxhbnMpXHJcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cclxuYXN5bmMgZnVuY3Rpb24gX2xvYWRSZWNvRGF0YSgpIHtcclxuICBpZiAoIXdpbmRvdy5mYkRiKSB0aHJvdyBuZXcgRXJyb3IoJ0ZpcmVzdG9yZSBubyBpbmljaWFsaXphZG8nKTtcclxuICBjb25zdCBwcm9taXNlcyA9IFtdO1xyXG4gIGlmICghX3JlY29TdG9ja1NuYXBzaG90KSB7XHJcbiAgICBwcm9taXNlcy5wdXNoKFxyXG4gICAgICB3aW5kb3cuZmJEYlxyXG4gICAgICAgIC5jb2xsZWN0aW9uKCdhcHBfY29uZmlnJylcclxuICAgICAgICAuZG9jKCdzdG9ja19zbmFwc2hvdCcpXHJcbiAgICAgICAgLmdldCgpXHJcbiAgICAgICAgLnRoZW4oKGQpID0+IHtcclxuICAgICAgICAgIGNvbnN0IGRhdGEgPSBkLmV4aXN0cyA/IGQuZGF0YSgpIDoge307XHJcbiAgICAgICAgICBsZXQgd2ggPSB7fTtcclxuICAgICAgICAgIGxldCBibyA9IHt9O1xyXG4gICAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgd2ggPSBkYXRhLndhcmVob3VzZUJyZWFrZG93biA/IEpTT04ucGFyc2UoZGF0YS53YXJlaG91c2VCcmVha2Rvd24pIDoge307XHJcbiAgICAgICAgICB9IGNhdGNoIHtcclxuICAgICAgICAgICAgd2ggPSB7fTtcclxuICAgICAgICAgIH1cclxuICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIGJvID0gZGF0YS5iYWNrb3JkZXJCeVNrdSA/IEpTT04ucGFyc2UoZGF0YS5iYWNrb3JkZXJCeVNrdSkgOiB7fTtcclxuICAgICAgICAgIH0gY2F0Y2gge1xyXG4gICAgICAgICAgICBibyA9IHt9O1xyXG4gICAgICAgICAgfVxyXG4gICAgICAgICAgX3JlY29TdG9ja1NuYXBzaG90ID0geyB3YXJlaG91c2VCcmVha2Rvd246IHdoLCBiYWNrb3JkZXJCeVNrdTogYm8gfTtcclxuICAgICAgICB9KVxyXG4gICAgKTtcclxuICB9XHJcbiAgaWYgKCFfcmVjb1ZlbnRhc1NuYXBzaG90KSB7XHJcbiAgICBwcm9taXNlcy5wdXNoKFxyXG4gICAgICB3aW5kb3cuZmJEYlxyXG4gICAgICAgIC5jb2xsZWN0aW9uKCdza3VfdmVudGFzX3NuYXBzaG90JylcclxuICAgICAgICAuZ2V0KClcclxuICAgICAgICAudGhlbigoc25hcCkgPT4ge1xyXG4gICAgICAgICAgY29uc3QgbWFwID0ge307XHJcbiAgICAgICAgICBzbmFwLmZvckVhY2goKGRvYykgPT4ge1xyXG4gICAgICAgICAgICBjb25zdCBkID0gZG9jLmRhdGEoKTtcclxuICAgICAgICAgICAgaWYgKCFkIHx8ICFkLnNrdSkgcmV0dXJuO1xyXG4gICAgICAgICAgICBtYXBbU3RyaW5nKGQuc2t1KS50cmltKCkudG9VcHBlckNhc2UoKV0gPSB7IG1lc2VzOiBkLm1lc2VzIHx8IHt9IH07XHJcbiAgICAgICAgICB9KTtcclxuICAgICAgICAgIF9yZWNvVmVudGFzU25hcHNob3QgPSBtYXA7XHJcbiAgICAgICAgfSlcclxuICAgICk7XHJcbiAgfVxyXG4gIGF3YWl0IFByb21pc2UuYWxsKHByb21pc2VzKTtcclxufVxyXG5cclxuZnVuY3Rpb24gX2NvbXB1dGVWZW50YU1lbnN1YWxQcm9tZWRpbyhza3VVcHBlcikge1xyXG4gIC8vIFByb21lZGlvIGRlIGxvcyBcdTAwRkFsdGltb3MgUkVDT19WRU5UQV9QUk9NRURJT19XSU5ET1cgbWVzZXMgY2VycmFkb3NcclxuICAvLyAoZXhjbHV5ZSBlbCBtZXMgYWN0dWFsIHBhcmNpYWwpLlxyXG4gIGNvbnN0IHJlYyA9IF9yZWNvVmVudGFzU25hcHNob3QgJiYgX3JlY29WZW50YXNTbmFwc2hvdFtza3VVcHBlcl07XHJcbiAgaWYgKCFyZWMgfHwgIXJlYy5tZXNlcykgcmV0dXJuIDA7XHJcbiAgY29uc3QgaG95ID0gbmV3IERhdGUoKTtcclxuICBjb25zdCBtb250aHNCYWNrID0gW107XHJcbiAgZm9yIChsZXQgaSA9IDE7IGkgPD0gUkVDT19WRU5UQV9QUk9NRURJT19XSU5ET1c7IGkrKykge1xyXG4gICAgY29uc3QgZCA9IG5ldyBEYXRlKGhveS5nZXRGdWxsWWVhcigpLCBob3kuZ2V0TW9udGgoKSAtIGksIDEpO1xyXG4gICAgbW9udGhzQmFjay5wdXNoKFN0cmluZyhkLmdldEZ1bGxZZWFyKCkpICsgJy0nICsgU3RyaW5nKGQuZ2V0TW9udGgoKSArIDEpLnBhZFN0YXJ0KDIsICcwJykpO1xyXG4gIH1cclxuICBsZXQgc3VtID0gMDtcclxuICBsZXQgbiA9IDA7XHJcbiAgbW9udGhzQmFjay5mb3JFYWNoKChrKSA9PiB7XHJcbiAgICBjb25zdCBtID0gcmVjLm1lc2VzW2tdO1xyXG4gICAgaWYgKG0gJiYgTnVtYmVyLmlzRmluaXRlKE51bWJlcihtLnF0eSkpKSB7XHJcbiAgICAgIHN1bSArPSBOdW1iZXIobS5xdHkpO1xyXG4gICAgICBuKys7XHJcbiAgICB9XHJcbiAgfSk7XHJcbiAgcmV0dXJuIG4gPiAwID8gc3VtIC8gbiA6IDA7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIF9jb21wdXRlU2FsZXNQbGFuRnV0dXJvKHJvdykge1xyXG4gIC8vIFN1bWEgbG9zIG1lc2VzIGRlIHJvdy5tb250aHMgZGVzZGUgZWwgbWVzIGFjdHVhbCAoaW5jbHVzaXZlKSBoYXN0YSBlbFxyXG4gIC8vIFx1MDBGQWx0aW1vIG1lcyBkZWwgc2FsZXMgcGxhbi4gTG9zIG1lc2VzIHNvbiAnWVlZWS1NTScuXHJcbiAgaWYgKCFyb3cgfHwgIXJvdy5tb250aHMpIHJldHVybiAwO1xyXG4gIGNvbnN0IGhveSA9IG5ldyBEYXRlKCk7XHJcbiAgY29uc3QgY3VycmVudEtleSA9IFN0cmluZyhob3kuZ2V0RnVsbFllYXIoKSkgKyAnLScgKyBTdHJpbmcoaG95LmdldE1vbnRoKCkgKyAxKS5wYWRTdGFydCgyLCAnMCcpO1xyXG4gIGxldCBzdW0gPSAwO1xyXG4gIE9iamVjdC5rZXlzKHJvdy5tb250aHMpLmZvckVhY2goKGspID0+IHtcclxuICAgIGlmIChrID49IGN1cnJlbnRLZXkpIHN1bSArPSBOdW1iZXIocm93Lm1vbnRoc1trXSB8fCAwKTtcclxuICB9KTtcclxuICByZXR1cm4gc3VtO1xyXG59XHJcblxyXG5mdW5jdGlvbiBfY29tcHV0ZVJlY29tbWVuZGF0aW9ucygpIHtcclxuICAvLyBDb21iaW5hIFJvZHMgKyBSZWVscyBzYWxlcyBwbGFucyArIHN0b2NrICsgYmFja29yZGVyICsgdmVudGFzIHByb21lZGlvLlxyXG4gIC8vIFJldG9ybmEgYXJyYXkgZGUgcm93cyBjb24gdG9kb3MgbG9zIGNhbXBvcyArIHJlY29tZW5kYWRvLlxyXG4gIGNvbnN0IHJvd3MgPSBbXTtcclxuICBjb25zdCBmYW1pbGlhcyA9IFsncm9kcycsICdyZWVscyddO1xyXG4gIGZvciAoY29uc3QgZmFtIG9mIGZhbWlsaWFzKSB7XHJcbiAgICBjb25zdCBjYWNoZSA9IF9zYWxlc1BsYW5DYWNoZXNbZmFtXTtcclxuICAgIGlmICghY2FjaGUgfHwgIWNhY2hlLnJvd3MpIGNvbnRpbnVlO1xyXG4gICAgZm9yIChjb25zdCBzcFJvdyBvZiBjYWNoZS5yb3dzKSB7XHJcbiAgICAgIGNvbnN0IHNrdSA9IFN0cmluZyhzcFJvdy5za3UgfHwgJycpLnRyaW0oKTtcclxuICAgICAgY29uc3Qgc2t1VXBwZXIgPSBza3UudG9VcHBlckNhc2UoKTtcclxuICAgICAgY29uc3Qgc3RvY2tXaCA9XHJcbiAgICAgICAgKF9yZWNvU3RvY2tTbmFwc2hvdCAmJlxyXG4gICAgICAgICAgX3JlY29TdG9ja1NuYXBzaG90LndhcmVob3VzZUJyZWFrZG93biAmJlxyXG4gICAgICAgICAgX3JlY29TdG9ja1NuYXBzaG90LndhcmVob3VzZUJyZWFrZG93bltza3VdKSB8fFxyXG4gICAgICAgIHt9O1xyXG4gICAgICBjb25zdCBzdG9ja0xpYnJlID0gTnVtYmVyKHN0b2NrV2hbJzExJ10gfHwgMCk7XHJcbiAgICAgIGNvbnN0IGVuVHJhbnNpdG8gPSBOdW1iZXIoc3RvY2tXaFsnMTInXSB8fCAwKTtcclxuICAgICAgY29uc3QgYmFja29yZGVyID0gTnVtYmVyKFxyXG4gICAgICAgIChfcmVjb1N0b2NrU25hcHNob3QgJiZcclxuICAgICAgICAgIF9yZWNvU3RvY2tTbmFwc2hvdC5iYWNrb3JkZXJCeVNrdSAmJlxyXG4gICAgICAgICAgX3JlY29TdG9ja1NuYXBzaG90LmJhY2tvcmRlckJ5U2t1W3NrdV0pIHx8XHJcbiAgICAgICAgICAwXHJcbiAgICAgICk7XHJcbiAgICAgIGNvbnN0IHZlbnRhTWVuc3VhbCA9IF9jb21wdXRlVmVudGFNZW5zdWFsUHJvbWVkaW8oc2t1VXBwZXIpO1xyXG4gICAgICBjb25zdCBzYWxlc1BsYW5GdXQgPSBfY29tcHV0ZVNhbGVzUGxhbkZ1dHVybyhzcFJvdyk7XHJcbiAgICAgIGNvbnN0IG1vcSA9IE51bWJlcihzcFJvdy5tb3EgfHwgMCk7XHJcbiAgICAgIGNvbnN0IG11bHRpcGxpZXIgPSBSRUNPX0RFRkFVTFRfTVVMVElQTElFUjsgLy8gdjExMDk6IGZpam8gMS4wOyBGM0IgbG8gaGFjZSBlZGl0YWJsZSBwb3Igc3ViZmFtaWxpYVxyXG4gICAgICBjb25zdCBkZW1hbmRhRXNwZXJhZGEgPSB2ZW50YU1lbnN1YWwgKiBtdWx0aXBsaWVyICogUkVDT19IT1JJWk9OX01PTlRIUztcclxuICAgICAgY29uc3QgYmFsYW5jZSA9IHN0b2NrTGlicmUgKyBlblRyYW5zaXRvICsgc2FsZXNQbGFuRnV0IC0gYmFja29yZGVyIC0gZGVtYW5kYUVzcGVyYWRhO1xyXG4gICAgICBsZXQgcmVjb21lbmRhZG8gPSAwO1xyXG4gICAgICBpZiAoYmFsYW5jZSA8IDApIHtcclxuICAgICAgICBjb25zdCBkZWZpY2l0ID0gLWJhbGFuY2U7XHJcbiAgICAgICAgcmVjb21lbmRhZG8gPSBtb3EgPiAwID8gTWF0aC5tYXgobW9xLCBNYXRoLmNlaWwoZGVmaWNpdCAvIG1vcSkgKiBtb3EpIDogTWF0aC5jZWlsKGRlZmljaXQpO1xyXG4gICAgICB9XHJcbiAgICAgIHJvd3MucHVzaCh7XHJcbiAgICAgICAgZmFtaWxpYTogZmFtLFxyXG4gICAgICAgIHNrdSxcclxuICAgICAgICBkZXNjcmlwdGlvbjogc3BSb3cuZGVzY3JpcHRpb24gfHwgJycsXHJcbiAgICAgICAgbW9xLFxyXG4gICAgICAgIHN0b2NrTGlicmUsXHJcbiAgICAgICAgZW5UcmFuc2l0byxcclxuICAgICAgICBiYWNrb3JkZXIsXHJcbiAgICAgICAgdmVudGFNZW5zdWFsOiBNYXRoLnJvdW5kKHZlbnRhTWVuc3VhbCAqIDEwKSAvIDEwLFxyXG4gICAgICAgIHNhbGVzUGxhbkZ1dCxcclxuICAgICAgICBtdWx0aXBsaWVyLFxyXG4gICAgICAgIGRlbWFuZGFFc3BlcmFkYTogTWF0aC5yb3VuZChkZW1hbmRhRXNwZXJhZGEgKiAxMCkgLyAxMCxcclxuICAgICAgICBiYWxhbmNlOiBNYXRoLnJvdW5kKGJhbGFuY2UgKiAxMCkgLyAxMCxcclxuICAgICAgICByZWNvbWVuZGFkbyxcclxuICAgICAgfSk7XHJcbiAgICB9XHJcbiAgfVxyXG4gIC8vIE9yZGVuYXIgcG9yIHJlY29tZW5kYWRvIGRlc2NlbmRlbnRlXHJcbiAgcm93cy5zb3J0KChhLCBiKSA9PiBiLnJlY29tZW5kYWRvIC0gYS5yZWNvbWVuZGFkbyk7XHJcbiAgcmV0dXJuIHJvd3M7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIF9mbXROdW1TaWduZWQobikge1xyXG4gIGlmIChuID09IG51bGwgfHwgIU51bWJlci5pc0Zpbml0ZShOdW1iZXIobikpKSByZXR1cm4gJ1x1MjAxNCc7XHJcbiAgY29uc3QgdiA9IE51bWJlcihuKTtcclxuICBjb25zdCBhYnMgPSBNYXRoLmFicyh2KS50b0xvY2FsZVN0cmluZygnZXMtQVInLCB7IG1heGltdW1GcmFjdGlvbkRpZ2l0czogMCB9KTtcclxuICByZXR1cm4gKHYgPCAwID8gJ1x1MjIxMicgOiAnJykgKyBhYnM7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIF9mbXRJbnQobikge1xyXG4gIGlmIChuID09IG51bGwgfHwgIU51bWJlci5pc0Zpbml0ZShOdW1iZXIobikpKSByZXR1cm4gJ1x1MjAxNCc7XHJcbiAgcmV0dXJuIE1hdGgucm91bmQoTnVtYmVyKG4pKS50b0xvY2FsZVN0cmluZygnZXMtQVInKTtcclxufVxyXG5cclxuZnVuY3Rpb24gX3JlbmRlclJlY29TZWN0aW9uKCkge1xyXG4gIGNvbnN0IGNvbnQgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgncmVjby1zZWN0aW9uLWNvbnRhaW5lcicpO1xyXG4gIGlmICghY29udCkgcmV0dXJuO1xyXG4gIHRyeSB7XHJcbiAgICBfcmVuZGVyUmVjb1NlY3Rpb25JbXBsKGNvbnQpO1xyXG4gIH0gY2F0Y2ggKGUpIHtcclxuICAgIGNvbnNvbGUuZXJyb3IoJ1tGT1JFQ0FTVCByZWNvXSByZW5kZXIgZmFpbCcsIGUpO1xyXG4gICAgY29udC5pbm5lckhUTUwgPVxyXG4gICAgICAnPGRpdiBzdHlsZT1cInBhZGRpbmc6MjBweDtjb2xvcjojZGMyNjI2XCI+JyArXHJcbiAgICAgICc8ZGl2IHN0eWxlPVwiZm9udC13ZWlnaHQ6NzAwO21hcmdpbi1ib3R0b206OHB4XCI+RXJyb3IgcmVuZGVyaXphbmRvIHRhYmxhIHJlY29tZW5kYWNpXHUwMEYzbjwvZGl2PicgK1xyXG4gICAgICAnPHByZSBzdHlsZT1cImZvbnQtc2l6ZToxMXB4O2JhY2tncm91bmQ6I2ZlZjJmMjtwYWRkaW5nOjEwcHg7Ym9yZGVyLXJhZGl1czo2cHg7b3ZlcmZsb3c6YXV0bzt3aGl0ZS1zcGFjZTpwcmUtd3JhcFwiPicgK1xyXG4gICAgICBlc2NhcGVIdG1sU2FmZShlLnN0YWNrIHx8IGUubWVzc2FnZSB8fCBTdHJpbmcoZSkpICtcclxuICAgICAgJzwvcHJlPjwvZGl2Pic7XHJcbiAgfVxyXG59XHJcblxyXG5mdW5jdGlvbiBfcmVuZGVyUmVjb1NlY3Rpb25JbXBsKGNvbnQpIHtcclxuICBjb25zdCBhbnlMb2FkZWQgPSAhIShfc2FsZXNQbGFuQ2FjaGVzLnJvZHMgfHwgX3NhbGVzUGxhbkNhY2hlcy5yZWVscyk7XHJcbiAgaWYgKCFhbnlMb2FkZWQpIHtcclxuICAgIGNvbnQuaW5uZXJIVE1MID0gJyc7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIGlmICghX3JlY29TdG9ja1NuYXBzaG90IHx8ICFfcmVjb1ZlbnRhc1NuYXBzaG90KSB7XHJcbiAgICBjb250LmlubmVySFRNTCA9XHJcbiAgICAgICc8ZGl2IHN0eWxlPVwicGFkZGluZzo0MHB4IDE4cHg7dGV4dC1hbGlnbjpjZW50ZXI7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZClcIj4nICtcclxuICAgICAgJzxkaXYgc3R5bGU9XCJkaXNwbGF5OmlubGluZS1ibG9jazt3aWR0aDoyNHB4O2hlaWdodDoyNHB4O2JvcmRlcjozcHggc29saWQgIzBkOTQ4ODtib3JkZXItdG9wLWNvbG9yOnRyYW5zcGFyZW50O2JvcmRlci1yYWRpdXM6NTAlO2FuaW1hdGlvbjpzcGluIDAuOHMgbGluZWFyIGluZmluaXRlO21hcmdpbi1ib3R0b206MTBweFwiPjwvZGl2PicgK1xyXG4gICAgICAnPGRpdj5DYXJnYW5kbyBzdG9jayArIHZlbnRhcyBoaXN0XHUwMEYzcmljYXMuLi48L2Rpdj4nICtcclxuICAgICAgJzxzdHlsZT5Aa2V5ZnJhbWVzIHNwaW57dG97dHJhbnNmb3JtOnJvdGF0ZSgzNjBkZWcpfX08L3N0eWxlPjwvZGl2Pic7XHJcbiAgICBfbG9hZFJlY29EYXRhKClcclxuICAgICAgLnRoZW4oX3JlbmRlclJlY29TZWN0aW9uKVxyXG4gICAgICAuY2F0Y2goKGUpID0+IHtcclxuICAgICAgICBjb25zb2xlLmVycm9yKCdbRk9SRUNBU1QgcmVjb10gbG9hZCBmYWlsJywgZSk7XHJcbiAgICAgICAgY29udC5pbm5lckhUTUwgPVxyXG4gICAgICAgICAgJzxkaXYgc3R5bGU9XCJwYWRkaW5nOjIwcHg7Y29sb3I6I2RjMjYyNlwiPkVycm9yIGNhcmdhbmRvIGRhdG9zOiAnICtcclxuICAgICAgICAgIGVzY2FwZUh0bWxTYWZlKGUubWVzc2FnZSB8fCBTdHJpbmcoZSkpICtcclxuICAgICAgICAgICc8L2Rpdj4nO1xyXG4gICAgICB9KTtcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgY29uc3QgYWxsUm93cyA9IF9jb21wdXRlUmVjb21tZW5kYXRpb25zKCk7XHJcbiAgY29uc3Qgc2VhcmNoTGMgPSBfcmVjb1NlYXJjaFRleHQudHJpbSgpLnRvTG93ZXJDYXNlKCk7XHJcbiAgY29uc3Qgcm93cyA9IGFsbFJvd3MuZmlsdGVyKChyKSA9PiB7XHJcbiAgICBpZiAoX3JlY29GaWx0ZXJGYW1pbGlhICE9PSAnYWxsJyAmJiByLmZhbWlsaWEgIT09IF9yZWNvRmlsdGVyRmFtaWxpYSkgcmV0dXJuIGZhbHNlO1xyXG4gICAgaWYgKF9yZWNvRmlsdGVyTWluUmVjICYmIHIucmVjb21lbmRhZG8gPD0gMCkgcmV0dXJuIGZhbHNlO1xyXG4gICAgaWYgKHNlYXJjaExjKSB7XHJcbiAgICAgIGNvbnN0IGhheSA9XHJcbiAgICAgICAgci5za3UudG9Mb3dlckNhc2UoKS5pbmNsdWRlcyhzZWFyY2hMYykgfHwgci5kZXNjcmlwdGlvbi50b0xvd2VyQ2FzZSgpLmluY2x1ZGVzKHNlYXJjaExjKTtcclxuICAgICAgaWYgKCFoYXkpIHJldHVybiBmYWxzZTtcclxuICAgIH1cclxuICAgIHJldHVybiB0cnVlO1xyXG4gIH0pO1xyXG4gIGNvbnN0IHRvdGFsUmVjbyA9IGFsbFJvd3MucmVkdWNlKChzLCByKSA9PiBzICsgci5yZWNvbWVuZGFkbywgMCk7XHJcbiAgY29uc3QgdG90YWxDb25SZWNvID0gYWxsUm93cy5maWx0ZXIoKHIpID0+IHIucmVjb21lbmRhZG8gPiAwKS5sZW5ndGg7XHJcblxyXG4gIGNvbnN0IGhlYWRlciA9XHJcbiAgICAnPGRpdiBzdHlsZT1cImRpc3BsYXk6ZmxleDtmbGV4LXdyYXA6d3JhcDtnYXA6MTBweDthbGlnbi1pdGVtczpjZW50ZXI7bWFyZ2luLWJvdHRvbToxMnB4XCI+JyArXHJcbiAgICAnPGRpdiBzdHlsZT1cImZsZXg6MTttaW4td2lkdGg6MjgwcHhcIj48ZGl2IHN0eWxlPVwiZm9udC1zaXplOjE4cHg7Zm9udC13ZWlnaHQ6ODAwO2NvbG9yOnZhcigtLXRleHQtcHJpbWFyeSlcIj5SZWNvbWVuZGFjaVx1MDBGM24gZGUgQ29tcHJhPC9kaXY+JyArXHJcbiAgICAnPGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMXB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO21hcmdpbi10b3A6MnB4XCI+QmFsYW5jZSA9IFN0b2NrICsgVHJcdTAwRTFuc2l0byArIFBsYW4gXHUyMjEyIEJhY2tvcmRlciBcdTIyMTIgKFZlbnRhIG1lbnMuIFx1MDBENyAnICtcclxuICAgIFJFQ09fSE9SSVpPTl9NT05USFMgK1xyXG4gICAgJ20pPC9kaXY+PC9kaXY+JyArXHJcbiAgICAnPGRpdiBzdHlsZT1cInBhZGRpbmc6NnB4IDEycHg7YmFja2dyb3VuZDojMGQ5NDg4O2NvbG9yOiNmZmY7Ym9yZGVyLXJhZGl1czo2cHg7Zm9udC1zaXplOjEycHg7Zm9udC13ZWlnaHQ6NzAwXCI+JyArXHJcbiAgICBfZm10SW50KHRvdGFsQ29uUmVjbykgK1xyXG4gICAgJyBTS1VzIGNvbiByZWNvPC9kaXY+JyArXHJcbiAgICAnPGRpdiBzdHlsZT1cInBhZGRpbmc6NnB4IDEycHg7YmFja2dyb3VuZDojMTM0ZTRhO2NvbG9yOiNmZmY7Ym9yZGVyLXJhZGl1czo2cHg7Zm9udC1zaXplOjEycHg7Zm9udC13ZWlnaHQ6NzAwXCI+XHUwM0EzICcgK1xyXG4gICAgX2ZtdEludCh0b3RhbFJlY28pICtcclxuICAgICcgdW5pZGFkZXM8L2Rpdj4nICtcclxuICAgICc8L2Rpdj4nO1xyXG5cclxuICBjb25zdCBmaWx0ZXJzID1cclxuICAgICc8ZGl2IHN0eWxlPVwiZGlzcGxheTpmbGV4O2ZsZXgtd3JhcDp3cmFwO2dhcDo4cHg7bWFyZ2luLWJvdHRvbToxMHB4O3BhZGRpbmc6MTBweDtiYWNrZ3JvdW5kOnZhcigtLWJnLXNlY29uZGFyeSk7Ym9yZGVyLXJhZGl1czo2cHhcIj4nICtcclxuICAgICc8aW5wdXQgdHlwZT1cInRleHRcIiBpZD1cInJlY28tc2VhcmNoXCIgcGxhY2Vob2xkZXI9XCJCdXNjYXIgU0tVIG8gZGVzY3JpcGNpb24uLi5cIiB2YWx1ZT1cIicgK1xyXG4gICAgZXNjYXBlSHRtbFNhZmUoX3JlY29TZWFyY2hUZXh0KSArXHJcbiAgICAnXCIgb25pbnB1dD1cIm9uUmVjb1NlYXJjaENoYW5nZShldmVudClcIiBzdHlsZT1cImZsZXg6MTttaW4td2lkdGg6MjAwcHg7cGFkZGluZzo2cHggMTBweDtib3JkZXI6MXB4IHNvbGlkIHZhcigtLWJvcmRlci1zdWJ0bGUpO2JvcmRlci1yYWRpdXM6NHB4O2ZvbnQtc2l6ZToxMnB4O2JhY2tncm91bmQ6dmFyKC0tYmctZWxldmF0ZWQpO2NvbG9yOnZhcigtLXRleHQtcHJpbWFyeSlcIi8+JyArXHJcbiAgICAnPHNlbGVjdCBvbmNoYW5nZT1cIm9uUmVjb0ZhbWlsaWFDaGFuZ2UoZXZlbnQpXCIgc3R5bGU9XCJwYWRkaW5nOjZweCAxMHB4O2JvcmRlcjoxcHggc29saWQgdmFyKC0tYm9yZGVyLXN1YnRsZSk7Ym9yZGVyLXJhZGl1czo0cHg7Zm9udC1zaXplOjEycHg7YmFja2dyb3VuZDp2YXIoLS1iZy1lbGV2YXRlZCk7Y29sb3I6dmFyKC0tdGV4dC1wcmltYXJ5KVwiPicgK1xyXG4gICAgJzxvcHRpb24gdmFsdWU9XCJhbGxcIicgK1xyXG4gICAgKF9yZWNvRmlsdGVyRmFtaWxpYSA9PT0gJ2FsbCcgPyAnIHNlbGVjdGVkJyA6ICcnKSArXHJcbiAgICAnPlRvZGFzIGxhcyBmYW1pbGlhczwvb3B0aW9uPicgK1xyXG4gICAgJzxvcHRpb24gdmFsdWU9XCJyb2RzXCInICtcclxuICAgIChfcmVjb0ZpbHRlckZhbWlsaWEgPT09ICdyb2RzJyA/ICcgc2VsZWN0ZWQnIDogJycpICtcclxuICAgICc+U29sbyBSb2RzIChDYVx1MDBGMWFzKTwvb3B0aW9uPicgK1xyXG4gICAgJzxvcHRpb24gdmFsdWU9XCJyZWVsc1wiJyArXHJcbiAgICAoX3JlY29GaWx0ZXJGYW1pbGlhID09PSAncmVlbHMnID8gJyBzZWxlY3RlZCcgOiAnJykgK1xyXG4gICAgJz5Tb2xvIFJlZWxzPC9vcHRpb24+JyArXHJcbiAgICAnPC9zZWxlY3Q+JyArXHJcbiAgICAnPGxhYmVsIHN0eWxlPVwiZGlzcGxheTppbmxpbmUtZmxleDthbGlnbi1pdGVtczpjZW50ZXI7Z2FwOjZweDtwYWRkaW5nOjZweCAxMHB4O2ZvbnQtc2l6ZToxMnB4O2NvbG9yOnZhcigtLXRleHQtcHJpbWFyeSk7Y3Vyc29yOnBvaW50ZXJcIj4nICtcclxuICAgICc8aW5wdXQgdHlwZT1cImNoZWNrYm94XCInICtcclxuICAgIChfcmVjb0ZpbHRlck1pblJlYyA/ICcgY2hlY2tlZCcgOiAnJykgK1xyXG4gICAgJyBvbmNoYW5nZT1cIm9uUmVjb0ZpbHRlck1pbkNoYW5nZShldmVudClcIi8+JyArXHJcbiAgICAnU29sbyBjb24gcmVjb21lbmRhZG8gJmd0OyAwPC9sYWJlbD4nICtcclxuICAgICc8YnV0dG9uIG9uY2xpY2s9XCJleHBvcnRSZWNvRXhjZWwoKVwiIHN0eWxlPVwicGFkZGluZzo2cHggMTJweDtiYWNrZ3JvdW5kOiMxNmEzNGE7Y29sb3I6I2ZmZjtib3JkZXI6bm9uZTtib3JkZXItcmFkaXVzOjRweDtmb250LXNpemU6MTJweDtmb250LXdlaWdodDo3MDA7Y3Vyc29yOnBvaW50ZXJcIj5cdTJCMDcgRXhjZWw8L2J1dHRvbj4nICtcclxuICAgICc8L2Rpdj4nO1xyXG5cclxuICBjb25zdCByb3dzSHRtbCA9IHJvd3NcclxuICAgIC5tYXAoKHIpID0+IHtcclxuICAgICAgY29uc3QgYmFsQ29sb3IgPSByLmJhbGFuY2UgPCAwID8gJyNkYzI2MjYnIDogci5iYWxhbmNlIDwgNTAgPyAnI2Y1OWUwYicgOiAnIzE2YTM0YSc7XHJcbiAgICAgIGNvbnN0IHJlY0NvbG9yID0gci5yZWNvbWVuZGFkbyA+IDAgPyAnI2RjMjYyNicgOiAnIzk0YTNiOCc7XHJcbiAgICAgIHJldHVybiAoXHJcbiAgICAgICAgJzx0ciBzdHlsZT1cImJvcmRlci1ib3R0b206MXB4IHNvbGlkIHZhcigtLWJvcmRlci1zdWJ0bGUpXCI+JyArXHJcbiAgICAgICAgJzx0ZCBzdHlsZT1cInBhZGRpbmc6NnB4IDhweDt0ZXh0LWFsaWduOmNlbnRlclwiPjxzcGFuIHN0eWxlPVwiZGlzcGxheTppbmxpbmUtYmxvY2s7cGFkZGluZzoycHggNnB4O2JvcmRlci1yYWRpdXM6MTBweDtiYWNrZ3JvdW5kOicgK1xyXG4gICAgICAgIChyLmZhbWlsaWEgPT09ICdyb2RzJyA/ICcjMGVhNWU5JyA6ICcjOGI1Y2Y2JykgK1xyXG4gICAgICAgICc7Y29sb3I6I2ZmZjtmb250LXNpemU6MTBweDtmb250LXdlaWdodDo3MDBcIj4nICtcclxuICAgICAgICAoci5mYW1pbGlhID09PSAncm9kcycgPyAnUk9EJyA6ICdSRUVMJykgK1xyXG4gICAgICAgICc8L3NwYW4+PC90ZD4nICtcclxuICAgICAgICAnPHRkIHN0eWxlPVwicGFkZGluZzo2cHggOHB4O3RleHQtYWxpZ246Y2VudGVyO2ZvbnQtZmFtaWx5Om1vbm9zcGFjZTtmb250LXNpemU6MTFweDtjb2xvcjp2YXIoLS10ZXh0LXByaW1hcnkpO2ZvbnQtd2VpZ2h0OjcwMFwiPicgK1xyXG4gICAgICAgIGVzY2FwZUh0bWxTYWZlKHIuc2t1KSArXHJcbiAgICAgICAgJzwvdGQ+JyArXHJcbiAgICAgICAgJzx0ZCBzdHlsZT1cInBhZGRpbmc6NnB4IDhweDtmb250LXNpemU6MTFweDtjb2xvcjp2YXIoLS10ZXh0LXNlY29uZGFyeSk7bWF4LXdpZHRoOjI0MHB4O292ZXJmbG93OmhpZGRlbjt0ZXh0LW92ZXJmbG93OmVsbGlwc2lzO3doaXRlLXNwYWNlOm5vd3JhcFwiIHRpdGxlPVwiJyArXHJcbiAgICAgICAgZXNjYXBlSHRtbFNhZmUoci5kZXNjcmlwdGlvbikgK1xyXG4gICAgICAgICdcIj4nICtcclxuICAgICAgICBlc2NhcGVIdG1sU2FmZShyLmRlc2NyaXB0aW9uKSArXHJcbiAgICAgICAgJzwvdGQ+JyArXHJcbiAgICAgICAgJzx0ZCBzdHlsZT1cInBhZGRpbmc6NnB4IDhweDt0ZXh0LWFsaWduOmNlbnRlcjtmb250LXZhcmlhbnQtbnVtZXJpYzp0YWJ1bGFyLW51bXM7Y29sb3I6dmFyKC0tdGV4dC1wcmltYXJ5KVwiPicgK1xyXG4gICAgICAgIF9mbXRJbnQoci5zdG9ja0xpYnJlKSArXHJcbiAgICAgICAgJzwvdGQ+JyArXHJcbiAgICAgICAgJzx0ZCBzdHlsZT1cInBhZGRpbmc6NnB4IDhweDt0ZXh0LWFsaWduOmNlbnRlcjtmb250LXZhcmlhbnQtbnVtZXJpYzp0YWJ1bGFyLW51bXM7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZClcIj4nICtcclxuICAgICAgICBfZm10SW50KHIuZW5UcmFuc2l0bykgK1xyXG4gICAgICAgICc8L3RkPicgK1xyXG4gICAgICAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjZweCA4cHg7dGV4dC1hbGlnbjpjZW50ZXI7Zm9udC12YXJpYW50LW51bWVyaWM6dGFidWxhci1udW1zO2NvbG9yOiNkYzI2MjZcIj4nICtcclxuICAgICAgICBfZm10SW50KHIuYmFja29yZGVyKSArXHJcbiAgICAgICAgJzwvdGQ+JyArXHJcbiAgICAgICAgJzx0ZCBzdHlsZT1cInBhZGRpbmc6NnB4IDhweDt0ZXh0LWFsaWduOmNlbnRlcjtmb250LXZhcmlhbnQtbnVtZXJpYzp0YWJ1bGFyLW51bXM7Y29sb3I6dmFyKC0tdGV4dC1zZWNvbmRhcnkpXCI+JyArXHJcbiAgICAgICAgX2ZtdEludChyLnZlbnRhTWVuc3VhbCkgK1xyXG4gICAgICAgICc8L3RkPicgK1xyXG4gICAgICAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjZweCA4cHg7dGV4dC1hbGlnbjpjZW50ZXI7Zm9udC12YXJpYW50LW51bWVyaWM6dGFidWxhci1udW1zO2NvbG9yOnZhcigtLXRleHQtc2Vjb25kYXJ5KVwiPicgK1xyXG4gICAgICAgIF9mbXRJbnQoci5kZW1hbmRhRXNwZXJhZGEpICtcclxuICAgICAgICAnPC90ZD4nICtcclxuICAgICAgICAnPHRkIHN0eWxlPVwicGFkZGluZzo2cHggOHB4O3RleHQtYWxpZ246Y2VudGVyO2ZvbnQtdmFyaWFudC1udW1lcmljOnRhYnVsYXItbnVtcztjb2xvcjp2YXIoLS10ZXh0LXByaW1hcnkpO2ZvbnQtd2VpZ2h0OjYwMFwiPicgK1xyXG4gICAgICAgIF9mbXRJbnQoci5zYWxlc1BsYW5GdXQpICtcclxuICAgICAgICAnPC90ZD4nICtcclxuICAgICAgICAnPHRkIHN0eWxlPVwicGFkZGluZzo2cHggOHB4O3RleHQtYWxpZ246Y2VudGVyO2ZvbnQtdmFyaWFudC1udW1lcmljOnRhYnVsYXItbnVtcztmb250LXdlaWdodDo3MDA7Y29sb3I6JyArXHJcbiAgICAgICAgYmFsQ29sb3IgK1xyXG4gICAgICAgICdcIj4nICtcclxuICAgICAgICBfZm10TnVtU2lnbmVkKHIuYmFsYW5jZSkgK1xyXG4gICAgICAgICc8L3RkPicgK1xyXG4gICAgICAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjZweCA4cHg7dGV4dC1hbGlnbjpjZW50ZXI7Zm9udC12YXJpYW50LW51bWVyaWM6dGFidWxhci1udW1zO2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO2ZvbnQtc2l6ZToxMXB4XCI+JyArXHJcbiAgICAgICAgX2ZtdEludChyLm1vcSkgK1xyXG4gICAgICAgICc8L3RkPicgK1xyXG4gICAgICAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjZweCA4cHg7dGV4dC1hbGlnbjpjZW50ZXJcIj48c3BhbiBzdHlsZT1cImRpc3BsYXk6aW5saW5lLWJsb2NrO3BhZGRpbmc6NHB4IDEwcHg7Ym9yZGVyLXJhZGl1czoxMnB4O2JhY2tncm91bmQ6JyArXHJcbiAgICAgICAgcmVjQ29sb3IgK1xyXG4gICAgICAgICc7Y29sb3I6I2ZmZjtmb250LXNpemU6MTJweDtmb250LXdlaWdodDo4MDA7bWluLXdpZHRoOjUwcHhcIj4nICtcclxuICAgICAgICBfZm10SW50KHIucmVjb21lbmRhZG8pICtcclxuICAgICAgICAnPC9zcGFuPjwvdGQ+JyArXHJcbiAgICAgICAgJzwvdHI+J1xyXG4gICAgICApO1xyXG4gICAgfSlcclxuICAgIC5qb2luKCcnKTtcclxuXHJcbiAgY29uc3QgdGFibGUgPVxyXG4gICAgJzxkaXYgc3R5bGU9XCJvdmVyZmxvdzphdXRvO21heC1oZWlnaHQ6NjB2aDtib3JkZXI6MXB4IHNvbGlkIHZhcigtLWJvcmRlci1zdWJ0bGUpO2JvcmRlci1yYWRpdXM6OHB4XCI+JyArXHJcbiAgICAnPHRhYmxlIHN0eWxlPVwid2lkdGg6MTAwJTtib3JkZXItY29sbGFwc2U6Y29sbGFwc2U7Zm9udC1zaXplOjEycHhcIj4nICtcclxuICAgICc8dGhlYWQgc3R5bGU9XCJiYWNrZ3JvdW5kOiMwZjE3MmE7Y29sb3I6I2ZmZjtwb3NpdGlvbjpzdGlja3k7dG9wOjA7ei1pbmRleDoxXCI+PHRyPicgK1xyXG4gICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6OHB4O3RleHQtYWxpZ246Y2VudGVyO2ZvbnQtc2l6ZToxMHB4O3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZVwiPkZhbTwvdGg+JyArXHJcbiAgICAnPHRoIHN0eWxlPVwicGFkZGluZzo4cHg7dGV4dC1hbGlnbjpjZW50ZXI7Zm9udC1zaXplOjEwcHg7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlXCI+U0tVPC90aD4nICtcclxuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjhweDt0ZXh0LWFsaWduOmNlbnRlcjtmb250LXNpemU6MTBweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2VcIj5EZXNjcmlwY2lcdTAwRjNuPC90aD4nICtcclxuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjhweDt0ZXh0LWFsaWduOmNlbnRlcjtmb250LXNpemU6MTBweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2VcIiB0aXRsZT1cIldocyAxMSBkaXNwb25pYmxlIHZlbnRhXCI+U3RvY2s8L3RoPicgK1xyXG4gICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6OHB4O3RleHQtYWxpZ246Y2VudGVyO2ZvbnQtc2l6ZToxMHB4O3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZVwiIHRpdGxlPVwiV2hzIDEyXCI+VHJcdTAwRTFuc2l0bzwvdGg+JyArXHJcbiAgICAnPHRoIHN0eWxlPVwicGFkZGluZzo4cHg7dGV4dC1hbGlnbjpjZW50ZXI7Zm9udC1zaXplOjEwcHg7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlXCI+QmFja29yZGVyPC90aD4nICtcclxuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjhweDt0ZXh0LWFsaWduOmNlbnRlcjtmb250LXNpemU6MTBweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2VcIiB0aXRsZT1cIlByb21lZGlvIFx1MDBGQWx0aW1vcyAzIG1lc2VzXCI+VnRhL21lczwvdGg+JyArXHJcbiAgICAnPHRoIHN0eWxlPVwicGFkZGluZzo4cHg7dGV4dC1hbGlnbjpjZW50ZXI7Zm9udC1zaXplOjEwcHg7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlXCIgdGl0bGU9XCJWdGEvbWVzIFx1MDBENyA3IG1lc2VzXCI+RGVtYW5kYSBlc3AuPC90aD4nICtcclxuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjhweDt0ZXh0LWFsaWduOmNlbnRlcjtmb250LXNpemU6MTBweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2VcIiB0aXRsZT1cIlN1bWEgY29sdW1uYXMgU2FsZXMgUGxhbiBkZXNkZSBtZXMgYWN0dWFsXCI+UGxhbiBmdXR1cm88L3RoPicgK1xyXG4gICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6OHB4O3RleHQtYWxpZ246Y2VudGVyO2ZvbnQtc2l6ZToxMHB4O3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZVwiPkJhbGFuY2U8L3RoPicgK1xyXG4gICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6OHB4O3RleHQtYWxpZ246Y2VudGVyO2ZvbnQtc2l6ZToxMHB4O3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZVwiPk1PUTwvdGg+JyArXHJcbiAgICAnPHRoIHN0eWxlPVwicGFkZGluZzo4cHg7dGV4dC1hbGlnbjpjZW50ZXI7Zm9udC1zaXplOjEwcHg7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO2JhY2tncm91bmQ6IzEzNGU0YVwiPlJlY29tZW5kYWRvPC90aD4nICtcclxuICAgICc8L3RyPjwvdGhlYWQ+PHRib2R5PicgK1xyXG4gICAgKHJvd3MubGVuZ3RoXHJcbiAgICAgID8gcm93c0h0bWxcclxuICAgICAgOiAnPHRyPjx0ZCBjb2xzcGFuPVwiMTJcIiBzdHlsZT1cInBhZGRpbmc6NDBweDt0ZXh0LWFsaWduOmNlbnRlcjtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKVwiPlNpbiByZXN1bHRhZG9zIGNvbiBsb3MgZmlsdHJvcyBhY3R1YWxlczwvdGQ+PC90cj4nKSArXHJcbiAgICAnPC90Ym9keT48L3RhYmxlPjwvZGl2Pic7XHJcblxyXG4gIGNvbnN0IGZvb3RlciA9XHJcbiAgICAnPGRpdiBzdHlsZT1cIm1hcmdpbi10b3A6OHB4O2ZvbnQtc2l6ZToxMHB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpXCI+JyArXHJcbiAgICAnTW9zdHJhbmRvICcgK1xyXG4gICAgX2ZtdEludChyb3dzLmxlbmd0aCkgK1xyXG4gICAgJyBkZSAnICtcclxuICAgIF9mbXRJbnQoYWxsUm93cy5sZW5ndGgpICtcclxuICAgICcgU0tVcyBcdTAwQjcgJyArXHJcbiAgICAnQmFsYW5jZSA9IFN0b2NrICsgVHJcdTAwRTFuc2l0byArIFBsYW4gXHUyMjEyIEJhY2tvcmRlciBcdTIyMTIgRGVtYW5kYS4gUm9qbyA9IHF1aWVicmUgZXNwZXJhZG8uIFJlY29tZW5kYWRvIHNlIHJlZG9uZGVhIGFsIG1cdTAwRkFsdGlwbG8gZGUgTU9RIHN1cGVyaW9yLicgK1xyXG4gICAgJzwvZGl2Pic7XHJcblxyXG4gIGNvbnQuaW5uZXJIVE1MID1cclxuICAgICc8ZGl2IHN0eWxlPVwicGFkZGluZzoxOHB4IDE4cHggMzBweFwiPicgKyBoZWFkZXIgKyBmaWx0ZXJzICsgdGFibGUgKyBmb290ZXIgKyAnPC9kaXY+JztcclxufVxyXG5cclxud2luZG93Lm9uUmVjb1NlYXJjaENoYW5nZSA9IGZ1bmN0aW9uIChldikge1xyXG4gIF9yZWNvU2VhcmNoVGV4dCA9IGV2LnRhcmdldC52YWx1ZSB8fCAnJztcclxuICBfcmVuZGVyUmVjb1NlY3Rpb24oKTtcclxuICAvLyBSZXN0YXVyYXIgZm9jdXMgKyBjYXJldCBhbCBpbnB1dFxyXG4gIHNldFRpbWVvdXQoKCkgPT4ge1xyXG4gICAgY29uc3QgaW5wID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3JlY28tc2VhcmNoJyk7XHJcbiAgICBpZiAoaW5wKSB7XHJcbiAgICAgIGlucC5mb2N1cygpO1xyXG4gICAgICBpbnAuc2V0U2VsZWN0aW9uUmFuZ2UoaW5wLnZhbHVlLmxlbmd0aCwgaW5wLnZhbHVlLmxlbmd0aCk7XHJcbiAgICB9XHJcbiAgfSwgMCk7XHJcbn07XHJcblxyXG53aW5kb3cub25SZWNvRmFtaWxpYUNoYW5nZSA9IGZ1bmN0aW9uIChldikge1xyXG4gIF9yZWNvRmlsdGVyRmFtaWxpYSA9IGV2LnRhcmdldC52YWx1ZSB8fCAnYWxsJztcclxuICBfcmVuZGVyUmVjb1NlY3Rpb24oKTtcclxufTtcclxuXHJcbndpbmRvdy5vblJlY29GaWx0ZXJNaW5DaGFuZ2UgPSBmdW5jdGlvbiAoZXYpIHtcclxuICBfcmVjb0ZpbHRlck1pblJlYyA9ICEhZXYudGFyZ2V0LmNoZWNrZWQ7XHJcbiAgX3JlbmRlclJlY29TZWN0aW9uKCk7XHJcbn07XHJcblxyXG53aW5kb3cuZXhwb3J0UmVjb0V4Y2VsID0gZnVuY3Rpb24gKCkge1xyXG4gIGlmICh0eXBlb2YgWExTWCA9PT0gJ3VuZGVmaW5lZCcpIHtcclxuICAgIGFsZXJ0KCdTaGVldEpTIChYTFNYKSBubyBjYXJnYWRvJyk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIGNvbnN0IHJvd3MgPSBfY29tcHV0ZVJlY29tbWVuZGF0aW9ucygpO1xyXG4gIGNvbnN0IGFvYSA9IFtcclxuICAgIFtcclxuICAgICAgJ0ZhbWlsaWEnLFxyXG4gICAgICAnU0tVJyxcclxuICAgICAgJ0Rlc2NyaXBjaVx1MDBGM24nLFxyXG4gICAgICAnU3RvY2snLFxyXG4gICAgICAnVHJcdTAwRTFuc2l0bycsXHJcbiAgICAgICdCYWNrb3JkZXInLFxyXG4gICAgICAnVnRhIHByb20vbWVzJyxcclxuICAgICAgJ0RlbWFuZGEgZXNwLiA3bScsXHJcbiAgICAgICdTYWxlcyBQbGFuIGZ1dHVybycsXHJcbiAgICAgICdCYWxhbmNlJyxcclxuICAgICAgJ01PUScsXHJcbiAgICAgICdSZWNvbWVuZGFkbycsXHJcbiAgICBdLFxyXG4gIF07XHJcbiAgZm9yIChjb25zdCByIG9mIHJvd3MpIHtcclxuICAgIGFvYS5wdXNoKFtcclxuICAgICAgci5mYW1pbGlhID09PSAncm9kcycgPyAnUm9kcyAoQ2FcdTAwRjFhcyknIDogJ1JlZWxzJyxcclxuICAgICAgci5za3UsXHJcbiAgICAgIHIuZGVzY3JpcHRpb24sXHJcbiAgICAgIHIuc3RvY2tMaWJyZSxcclxuICAgICAgci5lblRyYW5zaXRvLFxyXG4gICAgICByLmJhY2tvcmRlcixcclxuICAgICAgci52ZW50YU1lbnN1YWwsXHJcbiAgICAgIHIuZGVtYW5kYUVzcGVyYWRhLFxyXG4gICAgICByLnNhbGVzUGxhbkZ1dCxcclxuICAgICAgci5iYWxhbmNlLFxyXG4gICAgICByLm1vcSxcclxuICAgICAgci5yZWNvbWVuZGFkbyxcclxuICAgIF0pO1xyXG4gIH1cclxuICBjb25zdCB3cyA9IFhMU1gudXRpbHMuYW9hX3RvX3NoZWV0KGFvYSk7XHJcbiAgd3NbJyFjb2xzJ10gPSBbXHJcbiAgICB7IHdjaDogMTQgfSxcclxuICAgIHsgd2NoOiAxOCB9LFxyXG4gICAgeyB3Y2g6IDQwIH0sXHJcbiAgICB7IHdjaDogOCB9LFxyXG4gICAgeyB3Y2g6IDEwIH0sXHJcbiAgICB7IHdjaDogMTEgfSxcclxuICAgIHsgd2NoOiAxMiB9LFxyXG4gICAgeyB3Y2g6IDE1IH0sXHJcbiAgICB7IHdjaDogMTYgfSxcclxuICAgIHsgd2NoOiAxMCB9LFxyXG4gICAgeyB3Y2g6IDggfSxcclxuICAgIHsgd2NoOiAxMiB9LFxyXG4gIF07XHJcbiAgY29uc3Qgd2IgPSBYTFNYLnV0aWxzLmJvb2tfbmV3KCk7XHJcbiAgWExTWC51dGlscy5ib29rX2FwcGVuZF9zaGVldCh3Yiwgd3MsICdSZWNvbWVuZGFjaVx1MDBGM24nKTtcclxuICBjb25zdCBob3kgPSBuZXcgRGF0ZSgpO1xyXG4gIGNvbnN0IHN0YW1wID1cclxuICAgIGhveS5nZXRGdWxsWWVhcigpICtcclxuICAgICctJyArXHJcbiAgICBTdHJpbmcoaG95LmdldE1vbnRoKCkgKyAxKS5wYWRTdGFydCgyLCAnMCcpICtcclxuICAgICctJyArXHJcbiAgICBTdHJpbmcoaG95LmdldERhdGUoKSkucGFkU3RhcnQoMiwgJzAnKTtcclxuICBYTFNYLndyaXRlRmlsZSh3YiwgJ1JlY29tZW5kYWNpb25fQ29tcHJhXycgKyBzdGFtcCArICcueGxzeCcpO1xyXG59O1xyXG4iXSwKICAibWFwcGluZ3MiOiAiOzs7QUFZQSxNQUFNLGdCQUFnQjtBQUFBLElBQ3BCLEtBQUs7QUFBQSxJQUNMLFNBQVM7QUFBQSxJQUNULEtBQUs7QUFBQSxJQUNMLE9BQU87QUFBQSxJQUNQLEtBQUs7QUFBQSxJQUNMLFVBQVU7QUFBQSxJQUNWLFNBQVM7QUFBQSxJQUNULEtBQUs7QUFBQSxJQUNMLE9BQU87QUFBQSxJQUNQLE9BQU87QUFBQSxJQUNQLEtBQUs7QUFBQSxJQUNMLE9BQU87QUFBQSxJQUNQLEtBQUs7QUFBQSxJQUNMLE9BQU87QUFBQSxJQUNQLEtBQUs7QUFBQSxJQUNMLE1BQU07QUFBQSxJQUNOLEtBQUs7QUFBQSxJQUNMLE1BQU07QUFBQSxJQUNOLE9BQU87QUFBQSxJQUNQLEtBQUs7QUFBQSxJQUNMLE1BQU07QUFBQSxJQUNOLE9BQU87QUFBQSxJQUNQLEtBQUs7QUFBQSxJQUNMLFFBQVE7QUFBQSxJQUNSLEtBQUs7QUFBQSxJQUNMLFFBQVE7QUFBQSxJQUNSLEtBQUs7QUFBQSxJQUNMLE1BQU07QUFBQSxJQUNOLFdBQVc7QUFBQSxJQUNYLFlBQVk7QUFBQSxJQUNaLEtBQUs7QUFBQSxJQUNMLFNBQVM7QUFBQSxJQUNULFNBQVM7QUFBQSxJQUNULEtBQUs7QUFBQSxJQUNMLFVBQVU7QUFBQSxJQUNWLFdBQVc7QUFBQSxJQUNYLEtBQUs7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
