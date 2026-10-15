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
  var _discontinuedSkus = null;
  var _discontinuedMeta = null;
  var _multiplierOverrides = null;
  var RECO_MULT_RECENT_MONTHS = 2;
  var RECO_MULT_BASELINE_MONTHS = 6;
  var RECO_MULT_MIN = 0.5;
  var RECO_MULT_MAX = 2.5;
  var RECO_MULT_MIN_BASELINE = 0.1;
  var RECO_HORIZON_MONTHS = 7;
  var RECO_VENTA_PROMEDIO_WINDOW = 3;
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
  function _renderModalShell() {
    const existing = document.getElementById("forecast-modal");
    if (existing) return existing;
    const el = document.createElement("div");
    el.id = "forecast-modal";
    el.className = "modal-overlay";
    el.style.cssText = "display:none;position:fixed;inset:0;background:rgba(0,0,0,.3);-webkit-backdrop-filter:saturate(140%) blur(8px);backdrop-filter:saturate(140%) blur(8px);z-index:2050;";
    el.onclick = function(ev) {
      if (ev.target === el) window.closeForecastModal();
    };
    const shellHtml = _buildShellHtml();
    el.innerHTML = shellHtml;
    document.body.appendChild(el);
    _ensureForecastAppleCss();
    return el;
  }
  function _ensureForecastAppleCss() {
    if (document.getElementById("forecast-apple-css")) return;
    const style = document.createElement("style");
    style.id = "forecast-apple-css";
    const css = '#forecast-modal .fc-apple *{font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","SF Pro Text","Helvetica Neue",sans-serif}#forecast-modal .fc-apple-close{border:none;background:rgba(120,120,128,.14);width:30px;height:30px;border-radius:50%;cursor:pointer;color:#86868b;font-size:16px;display:flex;align-items:center;justify-content:center;transition:transform .12s ease-out,background .15s ease,color .15s ease}#forecast-modal .fc-apple-close:hover{background:rgba(120,120,128,.22);color:#1d1d1f}#forecast-modal .fc-apple-close:active{transform:scale(.9);background:rgba(120,120,128,.3)}#forecast-modal .fc-apple-tab{padding:7px 16px;border-radius:980px;border:none;background:transparent;color:#86868b;font-size:12.5px;font-weight:600;letter-spacing:-0.1px;cursor:pointer;transition:background .15s ease,color .15s ease,transform .1s ease-out}#forecast-modal .fc-apple-tab:hover{background:rgba(120,120,128,.1);color:#1d1d1f}#forecast-modal .fc-apple-tab:active{transform:scale(.97)}#forecast-modal .fc-apple-tab.active{background:#1d1d1f;color:#fff}#forecast-modal .fc-apple-tab.active:hover{background:#000}@media (prefers-reduced-motion:reduce){  #forecast-modal .fc-apple-close,#forecast-modal .fc-apple-tab{transition:none !important}  #forecast-modal .fc-apple-close:active,#forecast-modal .fc-apple-tab:active{transform:none !important}}';
    style.textContent = css;
    document.head.appendChild(style);
  }
  function _buildShellHtml() {
    const modalOuter = '<div class="fc-apple" style="position:absolute;inset:1vh 1vw;background:#fbfbfd;border-radius:18px;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 24px 70px rgba(0,0,0,.22)">';
    const header = '<div style="padding:22px 26px 18px;background:rgba(251,251,253,.92);-webkit-backdrop-filter:saturate(180%) blur(20px);backdrop-filter:saturate(180%) blur(20px);border-bottom:0.5px solid rgba(0,0,0,.08);display:flex;align-items:flex-start;gap:14px"><div style="flex:1;min-width:0"><h2 style="margin:0 0 4px;font-size:22px;font-weight:700;letter-spacing:-0.5px;color:#1d1d1f">Forecast</h2><div id="forecast-subtitle" style="font-size:13px;letter-spacing:-0.1px;color:#86868b">Sales Plans mensuales + pol\xEDtica de inventario</div></div><button class="fc-apple-close" onclick="closeForecastModal()" aria-label="Cerrar">&times;</button></div>';
    const tabsBar = `<div id="forecast-tabs-bar" style="display:flex;gap:6px;background:#fbfbfd;padding:12px 26px;border-bottom:0.5px solid rgba(0,0,0,.06)"><button data-tab="sales-plans" onclick="switchForecastTab('sales-plans')" class="forecast-tab fc-apple-tab active">Sales Plans</button><button data-tab="stat" onclick="switchForecastTab('stat')" class="forecast-tab fc-apple-tab">Forecast estad\xEDstico</button></div>`;
    const tabSalesPlans = '<div id="forecast-tab-sales-plans" style="flex:1;overflow:auto;padding:0;background:#fbfbfd"></div>';
    const tabStat = '<div id="forecast-tab-stat" style="flex:1;overflow:auto;display:none;padding:0;background:#fbfbfd"></div>';
    return modalOuter + header + tabsBar + tabSalesPlans + tabStat + "</div>";
  }
  window.switchForecastTab = function(tabId) {
    _forecastActiveTab = tabId;
    const sp = document.getElementById("forecast-tab-sales-plans");
    const st = document.getElementById("forecast-tab-stat");
    if (sp) sp.style.display = tabId === "sales-plans" ? "block" : "none";
    if (st) st.style.display = tabId === "stat" ? "block" : "none";
    const btns = document.querySelectorAll("#forecast-tabs-bar .forecast-tab");
    btns.forEach((b) => {
      const active = b.getAttribute("data-tab") === tabId;
      b.classList.toggle("active", active);
    });
    if (tabId === "stat") {
      const cont = document.getElementById("forecast-tab-stat");
      if (cont) {
        if (_forecastStatDocs) {
          _renderForecastStatTab();
        } else {
          cont.innerHTML = '<div class="fc-apple" style="padding:80px 20px;text-align:center;color:#86868b;font-size:14px;letter-spacing:-0.1px"><div style="display:inline-block;width:28px;height:28px;border:2.5px solid rgba(0,122,255,.2);border-top-color:#007aff;border-radius:50%;animation:spin 0.75s linear infinite;margin-bottom:16px"></div><div>Cargando forecast desde Firestore</div><style>@keyframes spin{to{transform:rotate(360deg)}}</style></div>';
          _loadForecastOutput().then(_renderForecastStatTab).catch((e) => {
            console.error("[FORECAST stat] load fail", e);
            const c = document.getElementById("forecast-tab-stat");
            if (c) {
              c.innerHTML = '<div class="fc-apple" style="padding:80px 20px;text-align:center;line-height:1.5"><div style="font-size:16px;font-weight:600;margin-bottom:10px;color:#c7372f;letter-spacing:-0.2px">Error cargando forecast</div><div style="font-size:12.5px;color:#86868b;margin-bottom:18px;letter-spacing:-0.1px">' + escapeHtmlSafe(e.message || String(e)) + `</div><button onclick="switchForecastTab('stat')" style="padding:9px 18px;background:#007aff;color:#fff;border:none;border-radius:980px;font-weight:600;cursor:pointer;font-size:13px;letter-spacing:-0.1px">Reintentar</button></div>`;
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
  };
  window.closeForecastModal = function() {
    const el = document.getElementById("forecast-modal");
    if (el) el.style.display = "none";
  };
  async function _loadMultiplierOverrides() {
    if (!window.fbDb) return;
    try {
      const doc = await window.fbDb.collection("forecast_config").doc("multipliers").get();
      if (doc.exists) {
        const d = doc.data() || {};
        _multiplierOverrides = d.skuOverrides || {};
      } else {
        _multiplierOverrides = {};
      }
    } catch (e) {
      console.warn("[FORECAST reco] load multipliers fail:", e && e.message);
      _multiplierOverrides = {};
    }
  }
  async function _saveMultiplierOverride(skuUpper, value) {
    if (!window.fbDb) return;
    if (!_multiplierOverrides) _multiplierOverrides = {};
    const uid = window.currentUser && window.currentUser.email || "unknown";
    _multiplierOverrides[skuUpper] = {
      value: Number(value),
      updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
      updatedBy: uid
    };
    await window.fbDb.collection("forecast_config").doc("multipliers").set({
      skuOverrides: _multiplierOverrides,
      updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
      updatedBy: uid
    });
  }
  async function _removeMultiplierOverride(skuUpper) {
    if (!window.fbDb || !_multiplierOverrides) return;
    delete _multiplierOverrides[skuUpper];
    const uid = window.currentUser && window.currentUser.email || "unknown";
    await window.fbDb.collection("forecast_config").doc("multipliers").set({
      skuOverrides: _multiplierOverrides,
      updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
      updatedBy: uid
    });
  }
  function _computeMultiplierAuto(skuUpper) {
    const rec = _recoVentasSnapshot && _recoVentasSnapshot[skuUpper];
    if (!rec || !rec.meses) return { value: 1, source: "default", recent: 0, baseline: 0 };
    const hoy = /* @__PURE__ */ new Date();
    const monthsBackKey = (n) => {
      const d = new Date(hoy.getFullYear(), hoy.getMonth() - n, 1);
      return String(d.getFullYear()) + "-" + String(d.getMonth() + 1).padStart(2, "0");
    };
    const collectAvg = (n) => {
      let sum = 0;
      let count = 0;
      for (let i = 1; i <= n; i++) {
        const k = monthsBackKey(i);
        const m = rec.meses[k];
        if (m && Number.isFinite(Number(m.qty))) {
          sum += Number(m.qty);
          count++;
        }
      }
      return count > 0 ? { avg: sum / count, n: count } : { avg: 0, n: 0 };
    };
    const rec2 = collectAvg(RECO_MULT_RECENT_MONTHS);
    const bas6 = collectAvg(RECO_MULT_BASELINE_MONTHS);
    if (rec2.n === 0 || bas6.n < 3 || bas6.avg < RECO_MULT_MIN_BASELINE) {
      return { value: 1, source: "default", recent: rec2.avg, baseline: bas6.avg };
    }
    let ratio = rec2.avg / bas6.avg;
    if (ratio < RECO_MULT_MIN) ratio = RECO_MULT_MIN;
    if (ratio > RECO_MULT_MAX) ratio = RECO_MULT_MAX;
    return {
      value: Math.round(ratio * 100) / 100,
      source: "auto",
      recent: Math.round(rec2.avg * 10) / 10,
      baseline: Math.round(bas6.avg * 10) / 10
    };
  }
  function _getEffectiveMultiplier(skuUpper) {
    if (_multiplierOverrides && _multiplierOverrides[skuUpper]) {
      return {
        value: Number(_multiplierOverrides[skuUpper].value) || 1,
        source: "manual",
        auto: _computeMultiplierAuto(skuUpper)
      };
    }
    const auto = _computeMultiplierAuto(skuUpper);
    return { value: auto.value, source: auto.source, auto };
  }
  async function _loadDiscontinuedSkus() {
    if (!window.fbDb) return;
    try {
      const doc = await window.fbDb.collection("forecast_config").doc("discontinued_skus").get();
      if (doc.exists) {
        const d = doc.data() || {};
        const arr = Array.isArray(d.skus) ? d.skus : [];
        _discontinuedSkus = new Set(arr.map((s) => String(s).trim().toUpperCase()));
        _discontinuedMeta = { updatedAt: d.updatedAt, updatedBy: d.updatedBy };
      } else {
        _discontinuedSkus = /* @__PURE__ */ new Set();
        _discontinuedMeta = null;
      }
    } catch (e) {
      console.warn("[FORECAST reco] load discontinued fail:", e && e.message);
      _discontinuedSkus = /* @__PURE__ */ new Set();
    }
  }
  async function _saveDiscontinuedSkus() {
    if (!window.fbDb || !_discontinuedSkus) return;
    const uid = window.currentUser && window.currentUser.email || "unknown";
    const payload = {
      skus: Array.from(_discontinuedSkus).sort(),
      updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
      updatedBy: uid
    };
    await window.fbDb.collection("forecast_config").doc("discontinued_skus").set(payload);
    _discontinuedMeta = { updatedAt: payload.updatedAt, updatedBy: payload.updatedBy };
  }
  async function _loadRecoData() {
    if (!window.fbDb) throw new Error("Firestore no inicializado");
    const promises = [];
    if (!_discontinuedSkus) promises.push(_loadDiscontinuedSkus());
    if (!_multiplierOverrides) promises.push(_loadMultiplierOverrides());
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
        if (_discontinuedSkus && _discontinuedSkus.has(skuUpper)) continue;
        const stockWh = _recoStockSnapshot && _recoStockSnapshot.warehouseBreakdown && _recoStockSnapshot.warehouseBreakdown[sku] || {};
        const stockLibre = Number(stockWh["11"] || 0);
        const enTransito = Number(stockWh["12"] || 0);
        const backorder = Number(
          _recoStockSnapshot && _recoStockSnapshot.backorderBySku && _recoStockSnapshot.backorderBySku[sku] || 0
        );
        const ventaMensual = _computeVentaMensualPromedio(skuUpper);
        const salesPlanFut = _computeSalesPlanFuturo(spRow);
        const moq = Number(spRow.moq || 0);
        const multInfo = _getEffectiveMultiplier(skuUpper);
        const multiplier = multInfo.value;
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
          multSource: multInfo.source,
          // 'auto' | 'manual' | 'default' | 'fallback'
          multAuto: multInfo.auto ? multInfo.auto.value : null,
          // el valor auto si hay override manual
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
  function _buildMultCellHtml(r) {
    const skuUpper = String(r.sku).trim().toUpperCase();
    const isManual = r.multSource === "manual";
    const isDefault = r.multSource === "default";
    const val = Number(r.multiplier || 1).toFixed(2);
    let dirColor = "var(--text-muted)";
    if (r.multiplier > 1.05) dirColor = "#16a34a";
    else if (r.multiplier < 0.95) dirColor = "#dc2626";
    const chip = isManual ? '<span style="display:inline-block;padding:1px 5px;background:#f59e0b;color:#fff;border-radius:8px;font-size:9px;font-weight:700;margin-left:4px" title="Override manual: pisa el auto">M</span>' : isDefault ? '<span style="display:inline-block;padding:1px 5px;background:#94a3b8;color:#fff;border-radius:8px;font-size:9px;font-weight:700;margin-left:4px" title="Sin datos suficientes: usa 1.0">\xB7</span>' : '<span style="display:inline-block;padding:1px 5px;background:#0d9488;color:#fff;border-radius:8px;font-size:9px;font-weight:700;margin-left:4px" title="Auto = venta 2m / venta 6m">A</span>';
    const resetBtn = isManual ? `<button onclick="resetMultiplier('` + escapeHtmlSafe(skuUpper) + `')" title="Volver al auto" style="margin-left:4px;background:transparent;border:none;cursor:pointer;font-size:12px;color:var(--text-muted);padding:0">\u21BB</button>` : "";
    const autoHint = isManual && r.multAuto != null ? ' <span style="font-size:10px;color:var(--text-muted)" title="Valor auto calculado">(auto ' + Number(r.multAuto).toFixed(2) + ")</span>" : "";
    return `<span style="display:inline-flex;align-items:center;gap:2px"><span onclick="editMultiplier(this, '` + escapeHtmlSafe(skuUpper) + `')" style="cursor:pointer;padding:2px 6px;border-radius:4px;background:var(--bg-secondary);font-variant-numeric:tabular-nums;font-weight:700;color:` + dirColor + '" title="Click para editar">' + val + "</span>" + chip + resetBtn + autoHint + "</span>";
  }
  window.editMultiplier = function(el, skuUpper) {
    const currentVal = parseFloat(el.textContent) || 1;
    const input = document.createElement("input");
    input.type = "number";
    input.step = "0.05";
    input.min = "0.1";
    input.max = "5";
    input.value = String(currentVal);
    input.style.cssText = "width:60px;padding:2px 4px;font-size:12px;font-weight:700;text-align:center;border:2px solid #0d9488;border-radius:4px;background:var(--bg-elevated);color:var(--text-primary);font-variant-numeric:tabular-nums";
    const parent = el.parentNode;
    parent.replaceChild(input, el);
    input.focus();
    input.select();
    const commit = async () => {
      const v = parseFloat(input.value);
      if (Number.isNaN(v) || v < 0.1 || v > 5) {
        _renderRecoSection();
        return;
      }
      if (Math.abs(v - currentVal) < 1e-3) {
        _renderRecoSection();
        return;
      }
      try {
        await _saveMultiplierOverride(skuUpper, v);
        _renderRecoSection();
      } catch (e) {
        alert("Error guardando: " + (e.message || e));
        _renderRecoSection();
      }
    };
    const cancel = () => _renderRecoSection();
    input.addEventListener("blur", commit);
    input.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        input.blur();
      } else if (ev.key === "Escape") {
        ev.preventDefault();
        cancel();
      }
    });
  };
  window.resetMultiplier = async function(skuUpper) {
    if (!confirm("Volver el multiplicador de " + skuUpper + " al c\xE1lculo autom\xE1tico?")) return;
    try {
      await _removeMultiplierOverride(skuUpper);
      _renderRecoSection();
    } catch (e) {
      alert("Error: " + (e.message || e));
    }
  };
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
    const nDisc = _discontinuedSkus ? _discontinuedSkus.size : 0;
    const discChip = nDisc > 0 ? '<button onclick="openDiscontinuedModal()" style="padding:6px 12px;background:#9333ea;color:#fff;border:none;border-radius:6px;font-size:12px;font-weight:700;cursor:pointer" title="Gestionar SKUs descontinuados">\u{1F6AB} ' + _fmtInt(nDisc) + " descontinuados</button>" : "";
    const header = '<div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-bottom:12px"><div style="flex:1;min-width:280px"><div style="font-size:18px;font-weight:800;color:var(--text-primary)">Recomendaci\xF3n de Compra</div><div style="font-size:11px;color:var(--text-muted);margin-top:2px">Balance = Stock + Tr\xE1nsito + Plan \u2212 Backorder \u2212 (Venta mens. \xD7 ' + RECO_HORIZON_MONTHS + 'm)</div></div><div style="padding:6px 12px;background:#0d9488;color:#fff;border-radius:6px;font-size:12px;font-weight:700">' + _fmtInt(totalConReco) + ' SKUs con reco</div><div style="padding:6px 12px;background:#134e4a;color:#fff;border-radius:6px;font-size:12px;font-weight:700">\u03A3 ' + _fmtInt(totalReco) + " unidades</div>" + discChip + "</div>";
    const filters = '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:10px;padding:10px;background:var(--bg-secondary);border-radius:6px"><input type="text" id="reco-search" placeholder="Buscar SKU o descripcion..." value="' + escapeHtmlSafe(_recoSearchText) + '" oninput="onRecoSearchChange(event)" style="flex:1;min-width:200px;padding:6px 10px;border:1px solid var(--border-subtle);border-radius:4px;font-size:12px;background:var(--bg-elevated);color:var(--text-primary)"/><select onchange="onRecoFamiliaChange(event)" style="padding:6px 10px;border:1px solid var(--border-subtle);border-radius:4px;font-size:12px;background:var(--bg-elevated);color:var(--text-primary)"><option value="all"' + (_recoFilterFamilia === "all" ? " selected" : "") + '>Todas las familias</option><option value="rods"' + (_recoFilterFamilia === "rods" ? " selected" : "") + '>Solo Rods (Ca\xF1as)</option><option value="reels"' + (_recoFilterFamilia === "reels" ? " selected" : "") + '>Solo Reels</option></select><label style="display:inline-flex;align-items:center;gap:6px;padding:6px 10px;font-size:12px;color:var(--text-primary);cursor:pointer"><input type="checkbox"' + (_recoFilterMinRec ? " checked" : "") + ' onchange="onRecoFilterMinChange(event)"/>Solo con recomendado &gt; 0</label><button onclick="exportRecoExcel()" style="padding:6px 12px;background:#16a34a;color:#fff;border:none;border-radius:4px;font-size:12px;font-weight:700;cursor:pointer">\u2B07 Excel</button></div>';
    const rowsHtml = rows.map((r) => {
      const balColor = r.balance < 0 ? "#dc2626" : r.balance < 50 ? "#f59e0b" : "#16a34a";
      const recColor = r.recomendado > 0 ? "#dc2626" : "#94a3b8";
      return '<tr style="border-bottom:1px solid var(--border-subtle)"><td style="padding:6px 8px;text-align:center"><span style="display:inline-block;padding:2px 6px;border-radius:10px;background:' + (r.familia === "rods" ? "#0ea5e9" : "#8b5cf6") + ';color:#fff;font-size:10px;font-weight:700">' + (r.familia === "rods" ? "ROD" : "REEL") + '</span></td><td style="padding:6px 8px;text-align:center;font-family:monospace;font-size:11px;color:var(--text-primary);font-weight:700">' + escapeHtmlSafe(r.sku) + '</td><td style="padding:6px 8px;font-size:11px;color:var(--text-secondary);max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + escapeHtmlSafe(r.description) + '">' + escapeHtmlSafe(r.description) + '</td><td style="padding:6px 8px;text-align:center;font-variant-numeric:tabular-nums;color:var(--text-primary)">' + _fmtInt(r.stockLibre) + '</td><td style="padding:6px 8px;text-align:center;font-variant-numeric:tabular-nums;color:var(--text-muted)">' + _fmtInt(r.enTransito) + '</td><td style="padding:6px 8px;text-align:center;font-variant-numeric:tabular-nums;color:#dc2626">' + _fmtInt(r.backorder) + '</td><td style="padding:6px 8px;text-align:center;font-variant-numeric:tabular-nums;color:var(--text-secondary)">' + _fmtInt(r.ventaMensual) + '</td><td style="padding:6px 8px;text-align:center">' + _buildMultCellHtml(r) + '</td><td style="padding:6px 8px;text-align:center;font-variant-numeric:tabular-nums;color:var(--text-secondary)">' + _fmtInt(r.demandaEsperada) + '</td><td style="padding:6px 8px;text-align:center;font-variant-numeric:tabular-nums;color:var(--text-primary);font-weight:600">' + _fmtInt(r.salesPlanFut) + '</td><td style="padding:6px 8px;text-align:center;font-variant-numeric:tabular-nums;font-weight:700;color:' + balColor + '">' + _fmtNumSigned(r.balance) + '</td><td style="padding:6px 8px;text-align:center;font-variant-numeric:tabular-nums;color:var(--text-muted);font-size:11px">' + _fmtInt(r.moq) + '</td><td style="padding:6px 8px;text-align:center"><span style="display:inline-block;padding:4px 10px;border-radius:12px;background:' + recColor + ';color:#fff;font-size:12px;font-weight:800;min-width:50px">' + _fmtInt(r.recomendado) + `</span></td><td style="padding:6px 8px;text-align:center"><button onclick="discontinueSku('` + escapeHtmlSafe(r.sku) + "', '" + escapeHtmlSafe(r.description.replace(/'/g, "")) + `')" title="Descontinuar este SKU" style="background:transparent;border:1px solid var(--border-subtle);border-radius:4px;padding:4px 8px;cursor:pointer;font-size:14px;color:var(--text-muted)">\u{1F5D1}</button></td></tr>`;
    }).join("");
    const table = '<div style="overflow:auto;max-height:60vh;border:1px solid var(--border-subtle);border-radius:8px"><table style="width:100%;min-width:1400px;border-collapse:collapse;font-size:12px"><thead style="background:#0f172a;color:#fff;position:sticky;top:0;z-index:1"><tr><th style="padding:8px;text-align:center;font-size:10px;text-transform:uppercase">Fam</th><th style="padding:8px;text-align:center;font-size:10px;text-transform:uppercase">SKU</th><th style="padding:8px;text-align:center;font-size:10px;text-transform:uppercase">Descripci\xF3n</th><th style="padding:8px;text-align:center;font-size:10px;text-transform:uppercase" title="Whs 11 disponible venta">Stock</th><th style="padding:8px;text-align:center;font-size:10px;text-transform:uppercase" title="Whs 12">Tr\xE1nsito</th><th style="padding:8px;text-align:center;font-size:10px;text-transform:uppercase">Backorder</th><th style="padding:8px;text-align:center;font-size:10px;text-transform:uppercase" title="Promedio \xFAltimos 3 meses">Vta/mes</th><th style="padding:8px;text-align:center;font-size:10px;text-transform:uppercase" title="Multiplicador de tendencia = venta 2m / venta 6m. Editable (click para override).">Multip.</th><th style="padding:8px;text-align:center;font-size:10px;text-transform:uppercase" title="Vta/mes \xD7 7 meses">Demanda esp.</th><th style="padding:8px;text-align:center;font-size:10px;text-transform:uppercase" title="Suma columnas Sales Plan desde mes actual">Plan futuro</th><th style="padding:8px;text-align:center;font-size:10px;text-transform:uppercase">Balance</th><th style="padding:8px;text-align:center;font-size:10px;text-transform:uppercase">MOQ</th><th style="padding:8px;text-align:center;font-size:10px;text-transform:uppercase;background:#134e4a">Recomendado</th><th style="padding:8px;text-align:center;font-size:10px;text-transform:uppercase" title="Descontinuar SKU">Acci\xF3n</th></tr></thead><tbody>' + (rows.length ? rowsHtml : '<tr><td colspan="14" style="padding:40px;text-align:center;color:var(--text-muted)">Sin resultados con los filtros actuales</td></tr>') + "</tbody></table></div>";
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
        "Multiplicador",
        "Origen mult",
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
        r.multiplier,
        r.multSource || "auto",
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
      // Familia
      { wch: 18 },
      // SKU
      { wch: 40 },
      // Descripción
      { wch: 8 },
      // Stock
      { wch: 10 },
      // Tránsito
      { wch: 11 },
      // Backorder
      { wch: 12 },
      // Vta prom/mes
      { wch: 12 },
      // Multiplicador
      { wch: 11 },
      // Origen mult
      { wch: 15 },
      // Demanda esp 7m
      { wch: 16 },
      // Sales Plan futuro
      { wch: 10 },
      // Balance
      { wch: 8 },
      // MOQ
      { wch: 12 }
      // Recomendado
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Recomendaci\xF3n");
    const hoy = /* @__PURE__ */ new Date();
    const stamp = hoy.getFullYear() + "-" + String(hoy.getMonth() + 1).padStart(2, "0") + "-" + String(hoy.getDate()).padStart(2, "0");
    XLSX.writeFile(wb, "Recomendacion_Compra_" + stamp + ".xlsx");
  };
  window.discontinueSku = async function(sku, description) {
    if (!_discontinuedSkus) _discontinuedSkus = /* @__PURE__ */ new Set();
    const upper = String(sku).trim().toUpperCase();
    const label = description ? sku + " \u2014 " + description.slice(0, 60) : sku;
    if (!confirm(
      "Descontinuar " + label + '?\n\nQuedar\xE1 excluido del c\xE1lculo de recomendaci\xF3n de compra hasta que lo reactives desde el chip "Descontinuados".'
    )) {
      return;
    }
    _discontinuedSkus.add(upper);
    try {
      await _saveDiscontinuedSkus();
      _renderRecoSection();
    } catch (e) {
      _discontinuedSkus.delete(upper);
      alert("Error guardando: " + (e.message || e));
    }
  };
  window.reactivateSku = async function(sku) {
    if (!_discontinuedSkus) return;
    const upper = String(sku).trim().toUpperCase();
    _discontinuedSkus.delete(upper);
    try {
      await _saveDiscontinuedSkus();
      _renderDiscontinuedModal();
      _renderRecoSection();
    } catch (e) {
      _discontinuedSkus.add(upper);
      alert("Error guardando: " + (e.message || e));
    }
  };
  window.openDiscontinuedModal = function() {
    const existing = document.getElementById("discontinued-skus-modal");
    if (existing) existing.remove();
    const el = document.createElement("div");
    el.id = "discontinued-skus-modal";
    el.style.cssText = "position:fixed;inset:0;background:rgba(15,23,42,.65);z-index:2100;display:flex;align-items:center;justify-content:center;padding:3vh";
    el.onclick = (ev) => {
      if (ev.target === el) el.remove();
    };
    el.innerHTML = '<div id="discontinued-modal-content" style="background:var(--bg-elevated);border-radius:12px;padding:24px;max-width:640px;width:100%;max-height:90vh;overflow:auto;box-shadow:0 20px 60px rgba(0,0,0,.4)"></div>';
    document.body.appendChild(el);
    _renderDiscontinuedModal();
  };
  function _renderDiscontinuedModal() {
    const cont = document.getElementById("discontinued-modal-content");
    if (!cont) return;
    const list = _discontinuedSkus ? Array.from(_discontinuedSkus).sort() : [];
    const skuToDesc = {};
    for (const fam of ["rods", "reels"]) {
      const cache = _salesPlanCaches[fam];
      if (cache && cache.rows) {
        for (const r of cache.rows) {
          skuToDesc[String(r.sku).trim().toUpperCase()] = r.description || "";
        }
      }
    }
    const head = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px"><div><div style="font-size:18px;font-weight:800;color:var(--text-primary)">SKUs descontinuados</div><div style="font-size:11px;color:var(--text-muted);margin-top:2px">' + list.length + ` SKUs excluidos del c\xE1lculo de Recomendaci\xF3n de Compra</div></div><button onclick="document.getElementById('discontinued-skus-modal').remove()" style="background:transparent;border:1px solid var(--border-subtle);border-radius:6px;padding:6px 12px;cursor:pointer;font-weight:700">Cerrar</button></div>`;
    const body = list.length === 0 ? '<div style="padding:40px;text-align:center;color:var(--text-muted)">No hay SKUs descontinuados.<br><br>Pod\xE9s descontinuar SKUs desde el bot\xF3n \u{1F5D1} en cada fila de la tabla Recomendaci\xF3n de Compra.</div>' : '<div style="display:flex;flex-direction:column;gap:6px">' + list.map((sku) => {
      const desc = skuToDesc[sku] || "";
      return '<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:var(--bg-secondary);border-radius:6px"><div style="flex:1"><div style="font-family:monospace;font-weight:700;color:var(--text-primary)">' + escapeHtmlSafe(sku) + "</div>" + (desc ? '<div style="font-size:11px;color:var(--text-muted);margin-top:2px">' + escapeHtmlSafe(desc) + "</div>" : "") + `</div><button onclick="reactivateSku('` + escapeHtmlSafe(sku) + `')" style="padding:6px 12px;background:#16a34a;color:#fff;border:none;border-radius:4px;font-size:11px;font-weight:700;cursor:pointer">\u21BB Reactivar</button></div>`;
    }).join("") + "</div>";
    cont.innerHTML = head + body;
  }
})();
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL3B1cmUvc2FsZXMtcGxhbi1wYXJzZXIuanMiLCAiLi4vc3JjL2RvbWFpbnMvZm9yZWNhc3QuanMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbIi8vIEB0cy1ub2NoZWNrXG4vLyBQdXJlOiBwYXJzZWEgdW4gc2hlZXQgU2FsZXMgUGxhbiAoZm9ybWF0byBTVVIvU0FSIGRlIFNoaW1hbm8pIGEgZXN0cnVjdHVyYVxuLy8gbm9ybWFsaXphZGEgeyBza3UsIGRlc2NyaXB0aW9uLCBtb3EsIG1vbnRoczogeydZWVlZLU1NJzogTn0gfS5cbi8vIFNpbiBkZXBlbmRlbmNpYXMgXHUyMDE0IHJlY2liZSBlbCBzaGVldCB5YSBkZXNlcmlhbGl6YWRvIHBvciBTaGVldEpTXG4vLyAoWExTWC51dGlscy5zaGVldF90b19qc29uKHNoZWV0LCB7aGVhZGVyOjEsIGRlZnZhbDonJ30pKS5cbi8vIFRlc3RlYWJsZSBlbiB2aXRlc3Qgc2luIGNhcmdhciBYTFNYLlxuLy9cbi8vIENvbnRleHRvOiBsb3MgU2FsZXMgUGxhbnMgZGUgU2hpbWFubyB2aWVuZW4gY29uIGhlYWRlcnMgY29tb1xuLy8gXCJTS1UgQ29kZS9QYXJ0IE5vXCIsIFwiRGVzY3JpcHRpb25cIiwgXCJNT1EgMTIgbW9udGhzXCIgeSBjb2x1bW5hcyBkZSBtZXNlc1xuLy8gdGlwbyBcIkphbiAyMDI3XCIsIFwiTWF5IDIwMjdcIiAoYSB2ZWNlcyBjb24gYVx1MDBGMW8gZW4gdW5hIGZpbGEgYXJyaWJhIHkgZWwgbWVzXG4vLyBlbiBsYSBmaWxhIGhlYWRlcikuIEVzdGEgZm4gdG9sZXJhIGFtYm9zIGxheW91dHMuXG5cbmNvbnN0IE1PTlRIX0FMSUFTRVMgPSB7XG4gIGphbjogMSxcbiAgamFudWFyeTogMSxcbiAgZW5lOiAxLFxuICBlbmVybzogMSxcbiAgZmViOiAyLFxuICBmZWJydWFyeTogMixcbiAgZmVicmVybzogMixcbiAgbWFyOiAzLFxuICBtYXJjaDogMyxcbiAgbWFyem86IDMsXG4gIGFwcjogNCxcbiAgYXByaWw6IDQsXG4gIGFicjogNCxcbiAgYWJyaWw6IDQsXG4gIG1heTogNSxcbiAgbWF5bzogNSxcbiAganVuOiA2LFxuICBqdW5lOiA2LFxuICBqdW5pbzogNixcbiAganVsOiA3LFxuICBqdWx5OiA3LFxuICBqdWxpbzogNyxcbiAgYXVnOiA4LFxuICBhdWd1c3Q6IDgsXG4gIGFnbzogOCxcbiAgYWdvc3RvOiA4LFxuICBzZXA6IDksXG4gIHNlcHQ6IDksXG4gIHNlcHRlbWJlcjogOSxcbiAgc2VwdGllbWJyZTogOSxcbiAgb2N0OiAxMCxcbiAgb2N0b2JlcjogMTAsXG4gIG9jdHVicmU6IDEwLFxuICBub3Y6IDExLFxuICBub3ZlbWJlcjogMTEsXG4gIG5vdmllbWJyZTogMTEsXG4gIGRlYzogMTIsXG4gIGRlY2VtYmVyOiAxMixcbiAgZGljOiAxMixcbiAgZGljaWVtYnJlOiAxMixcbn07XG5cbi8vIE5vcm1hbGl6YSBsYWJlbHMgZGUgbWVzZXMgYSAnWVlZWS1NTScuIFJldG9ybmEgbnVsbCBzaSBubyBtYXRjaGVhLlxuLy8gRm9ybWF0b3Mgc29wb3J0YWRvczogXCJKYW4gMjAyN1wiLCBcIkVuZS0yN1wiLCBcIkphbi8yMDI3XCIsIFwiTWF5MjdcIixcbi8vIFwiMjAyNy0wMVwiLCBcIjAxLzIwMjdcIiwgXCJKYW4uMjAyN1wiLCBcIjIwMjFcXG5KYW5cIiAobXVsdGktbGluZSBFeGNlbCkuXG5mdW5jdGlvbiBub3JtYWxpemVNb250aExhYmVsKGxhYmVsKSB7XG4gIGlmIChsYWJlbCA9PSBudWxsKSByZXR1cm4gbnVsbDtcbiAgLy8gdjExMDQ6IGNvbGFwc2FyIG5ld2xpbmVzL3RhYnMgYSBlc3BhY2lvIGFudGVzIGRlbCB0cmltLlxuICAvLyBFbCBmb3JtYXRvIEV4Y2VsIFwiMjAyMVxcbkphblwiIChhXHUwMEYxbyBlbiBMMSwgbWVzIGVuIEwyIGRlbnRybyBkZSB1bmEgY2VsZGFcbiAgLy8gbXVsdGktcm93KSBlcyBjb21cdTAwRkFuIGVuIFNhbGVzIFBsYW5zIFNVUi4gYFxccytgIG1hdGNoZWEgd2hpdGVzcGFjZSBpbmNsdXllbmRvXG4gIC8vIFxcbiB5IFxcclxcbi5cbiAgY29uc3QgcyA9IFN0cmluZyhsYWJlbCkucmVwbGFjZSgvXFxzKy9nLCAnICcpLnRyaW0oKS50b0xvd2VyQ2FzZSgpO1xuICBpZiAoIXMpIHJldHVybiBudWxsO1xuICBsZXQgbTtcbiAgLy8gXCJqYW4gMjAyN1wiIHwgXCJqYW4tMjdcIiB8IFwiZW5lLzIwMjdcIiB8IFwibWF5MjdcIiB8IFwibWF5LjIwMjdcIlxuICBtID0gcy5tYXRjaCgvXihbYS16XHUwMEUxXHUwMEU5XHUwMEVEXHUwMEYzXHUwMEZBXXszLDEwfSlbXFxzXFwtLy5fXSooXFxkezIsNH0pJC8pO1xuICBpZiAobSkge1xuICAgIGNvbnN0IG1vbiA9IE1PTlRIX0FMSUFTRVNbbVsxXV0gfHwgTU9OVEhfQUxJQVNFU1ttWzFdLnNsaWNlKDAsIDMpXTtcbiAgICBpZiAobW9uKSB7XG4gICAgICBsZXQgeSA9IHBhcnNlSW50KG1bMl0sIDEwKTtcbiAgICAgIGlmICh5IDwgMTAwKSB5ID0gMjAwMCArIHk7XG4gICAgICByZXR1cm4gU3RyaW5nKHkpLnBhZFN0YXJ0KDQsICcwJykgKyAnLScgKyBTdHJpbmcobW9uKS5wYWRTdGFydCgyLCAnMCcpO1xuICAgIH1cbiAgfVxuICAvLyBcIjIwMjEgamFuXCIgfCBcIjIwMjcgZGljXCIgKGFcdTAwRjFvIHByaW1lcm8gKyBtZXMsIGZvcm1hdG8gRXhjZWwgbXVsdGktbGluZVxuICAvLyBjb2xhcHNhZG8gdHJhcyByZXBsYWNlIFxccyspLlxuICBtID0gcy5tYXRjaCgvXihcXGR7NH0pW1xcc1xcLS8uX10rKFthLXpcdTAwRTFcdTAwRTlcdTAwRURcdTAwRjNcdTAwRkFdezMsMTB9KSQvKTtcbiAgaWYgKG0pIHtcbiAgICBjb25zdCB5ID0gcGFyc2VJbnQobVsxXSwgMTApO1xuICAgIGNvbnN0IG1vbiA9IE1PTlRIX0FMSUFTRVNbbVsyXV0gfHwgTU9OVEhfQUxJQVNFU1ttWzJdLnNsaWNlKDAsIDMpXTtcbiAgICBpZiAobW9uKSByZXR1cm4gU3RyaW5nKHkpLnBhZFN0YXJ0KDQsICcwJykgKyAnLScgKyBTdHJpbmcobW9uKS5wYWRTdGFydCgyLCAnMCcpO1xuICB9XG4gIC8vIFwiMjAyNy0wMVwiIHwgXCIyMDI3LzAxXCJcbiAgbSA9IHMubWF0Y2goL14oXFxkezR9KVstL10oXFxkezEsMn0pJC8pO1xuICBpZiAobSkge1xuICAgIGNvbnN0IHkgPSBwYXJzZUludChtWzFdLCAxMCk7XG4gICAgY29uc3QgbW9uID0gcGFyc2VJbnQobVsyXSwgMTApO1xuICAgIGlmIChtb24gPj0gMSAmJiBtb24gPD0gMTIpXG4gICAgICByZXR1cm4gU3RyaW5nKHkpLnBhZFN0YXJ0KDQsICcwJykgKyAnLScgKyBTdHJpbmcobW9uKS5wYWRTdGFydCgyLCAnMCcpO1xuICB9XG4gIC8vIFwiMDEvMjAyN1wiIHwgXCIwMS0yMDI3XCJcbiAgbSA9IHMubWF0Y2goL14oXFxkezEsMn0pWy0vXShcXGR7NH0pJC8pO1xuICBpZiAobSkge1xuICAgIGNvbnN0IG1vbiA9IHBhcnNlSW50KG1bMV0sIDEwKTtcbiAgICBjb25zdCB5ID0gcGFyc2VJbnQobVsyXSwgMTApO1xuICAgIGlmIChtb24gPj0gMSAmJiBtb24gPD0gMTIpXG4gICAgICByZXR1cm4gU3RyaW5nKHkpLnBhZFN0YXJ0KDQsICcwJykgKyAnLScgKyBTdHJpbmcobW9uKS5wYWRTdGFydCgyLCAnMCcpO1xuICB9XG4gIHJldHVybiBudWxsO1xufVxuXG4vLyBCdXNjYSBsYSBmaWxhIGhlYWRlciAoMC1iYXNlZCkuIEVzY2FuZWEgbGFzIHByaW1lcmFzIDMwIGZpbGFzLlxuZnVuY3Rpb24gZmluZEhlYWRlclJvdyhyb3dzKSB7XG4gIGNvbnN0IEhFQURFUl9NQVJLRVJTID0gW1xuICAgICdza3UgY29kZS9wYXJ0IG5vJyxcbiAgICAnc2t1IGNvZGUnLFxuICAgICdza3UnLFxuICAgICdwYXJ0IG5vJyxcbiAgICAncGFydCBudW1iZXInLFxuICAgICdpdGVtY29kZScsXG4gICAgJ2l0ZW0gY29kZScsXG4gICAgJ2NvZGlnbycsXG4gICAgJ2NcdTAwRjNkaWdvJyxcbiAgXTtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBNYXRoLm1pbihyb3dzLmxlbmd0aCwgMzApOyBpKyspIHtcbiAgICBjb25zdCByb3cgPSByb3dzW2ldIHx8IFtdO1xuICAgIGZvciAoY29uc3QgY2VsbCBvZiByb3cpIHtcbiAgICAgIC8vIHYxMTA0OiBjb2xhcHNhciBuZXdsaW5lcyBhIGVzcGFjaW8gcGFyYSBtYXRjaGVhciBoZWFkZXJzIGNvbW9cbiAgICAgIC8vIFwiU0tVIENvZGUvUGFydCBOb1wiIChvaykgbyBcIlNLVVxcbkNvZGVcIiAobmVjZXNpdGEgY29sYXBzYXIpLlxuICAgICAgY29uc3QgcyA9IFN0cmluZyhjZWxsID09IG51bGwgPyAnJyA6IGNlbGwpXG4gICAgICAgIC5yZXBsYWNlKC9cXHMrL2csICcgJylcbiAgICAgICAgLnRyaW0oKVxuICAgICAgICAudG9Mb3dlckNhc2UoKTtcbiAgICAgIGlmIChIRUFERVJfTUFSS0VSUy5pbmRleE9mKHMpID49IDApIHJldHVybiBpO1xuICAgIH1cbiAgfVxuICByZXR1cm4gLTE7XG59XG5cbi8vIERldGVjdGEgXHUwMEVEbmRpY2VzIGRlIGNvbHVtbmFzIHkgbWVzZXMuIGBoaW50Um93QWJvdmVgIHBlcm1pdGUgY29tYmluYXIgYVx1MDBGMW8vbWVzXG4vLyBjdWFuZG8gZWwgaGVhZGVyIGVzIG11bHRpLXJvdyAoYVx1MDBGMW8gYXJyaWJhLCBtZXMgYWJham8gbyB2aWNldmVyc2EpLlxuZnVuY3Rpb24gZGV0ZWN0Q29sdW1ucyhoZWFkZXJSb3csIGhpbnRSb3dBYm92ZSkge1xuICBsZXQgc2t1SWR4ID0gLTE7XG4gIGxldCBkZXNjSWR4ID0gLTE7XG4gIGxldCBtb3FJZHggPSAtMTtcbiAgY29uc3QgbW9udGhDb2x1bW5zID0gW107XG4gIGNvbnN0IGRldGVjdGVkTW9udGhzU2V0ID0gbmV3IFNldCgpO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IGhlYWRlclJvdy5sZW5ndGg7IGkrKykge1xuICAgIC8vIHYxMTA0OiBjb2xhcHNhciBuZXdsaW5lcyBhIGVzcGFjaW8gYW50ZXMgZGUgY29tcGFyYXIuIExvcyBTYWxlcyBQbGFuXG4gICAgLy8gU1VSIHRpZW5lbiBoZWFkZXJzIG11bHRpLWxpbmUgY29tbyBcIk1PUVxcbjEyIG1vbnRoc1wiIG8gXCJCYXNlXFxuRk9CKFVTRClcIi5cbiAgICBjb25zdCByYXcgPSBTdHJpbmcoaGVhZGVyUm93W2ldID09IG51bGwgPyAnJyA6IGhlYWRlclJvd1tpXSlcbiAgICAgIC5yZXBsYWNlKC9cXHMrL2csICcgJylcbiAgICAgIC50cmltKCk7XG4gICAgY29uc3QgcyA9IHJhdy50b0xvd2VyQ2FzZSgpO1xuICAgIGlmIChcbiAgICAgIHNrdUlkeCA8IDAgJiZcbiAgICAgIChzID09PSAnc2t1IGNvZGUvcGFydCBubycgfHxcbiAgICAgICAgcyA9PT0gJ3NrdSBjb2RlJyB8fFxuICAgICAgICBzID09PSAnc2t1JyB8fFxuICAgICAgICBzID09PSAncGFydCBubycgfHxcbiAgICAgICAgcyA9PT0gJ3BhcnQgbnVtYmVyJyB8fFxuICAgICAgICBzID09PSAnaXRlbWNvZGUnIHx8XG4gICAgICAgIHMgPT09ICdpdGVtIGNvZGUnIHx8XG4gICAgICAgIHMgPT09ICdjb2RpZ28nIHx8XG4gICAgICAgIHMgPT09ICdjXHUwMEYzZGlnbycpXG4gICAgKSB7XG4gICAgICBza3VJZHggPSBpO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChcbiAgICAgIGRlc2NJZHggPCAwICYmXG4gICAgICAocyA9PT0gJ2Rlc2NyaXB0aW9uJyB8fFxuICAgICAgICBzID09PSAnZGVzY3JpcGNpb24nIHx8XG4gICAgICAgIHMgPT09ICdkZXNjcmlwY2lcdTAwRjNuJyB8fFxuICAgICAgICBzID09PSAnaXRlbSBuYW1lJyB8fFxuICAgICAgICBzID09PSAnaXRlbW5hbWUnKVxuICAgICkge1xuICAgICAgZGVzY0lkeCA9IGk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKG1vcUlkeCA8IDAgJiYgKHMgPT09ICdtb3EgMTIgbW9udGhzJyB8fCBzID09PSAnbW9xJyB8fCBzLmluZGV4T2YoJ21vcScpID09PSAwKSkge1xuICAgICAgbW9xSWR4ID0gaTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICAvLyBUcnkgZGlyZWN0IG1vbnRoIHBhcnNlXG4gICAgbGV0IG1vbnRoS2V5ID0gbm9ybWFsaXplTW9udGhMYWJlbChyYXcpO1xuICAgIGlmICghbW9udGhLZXkgJiYgaGludFJvd0Fib3ZlICYmIGhpbnRSb3dBYm92ZVtpXSAhPSBudWxsKSB7XG4gICAgICBjb25zdCBoaW50ID0gU3RyaW5nKGhpbnRSb3dBYm92ZVtpXSkudHJpbSgpO1xuICAgICAgaWYgKGhpbnQpIHtcbiAgICAgICAgbW9udGhLZXkgPSBub3JtYWxpemVNb250aExhYmVsKHJhdyArICcgJyArIGhpbnQpIHx8IG5vcm1hbGl6ZU1vbnRoTGFiZWwoaGludCArICcgJyArIHJhdyk7XG4gICAgICB9XG4gICAgfVxuICAgIGlmIChtb250aEtleSkge1xuICAgICAgbW9udGhDb2x1bW5zLnB1c2goeyBjb2xJZHg6IGksIG1vbnRoS2V5IH0pO1xuICAgICAgZGV0ZWN0ZWRNb250aHNTZXQuYWRkKG1vbnRoS2V5KTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHtcbiAgICBza3VJZHgsXG4gICAgZGVzY0lkeCxcbiAgICBtb3FJZHgsXG4gICAgbW9udGhDb2x1bW5zLFxuICAgIGRldGVjdGVkTW9udGhzOiBBcnJheS5mcm9tKGRldGVjdGVkTW9udGhzU2V0KS5zb3J0KCksXG4gIH07XG59XG5cbi8vIFB1YmxpYzogcGFyc2UgZnVsbCBzaGVldC4gVGhyb3dzIG9uIG1pc3NpbmcgU0tVIGNvbHVtbiAvIG1vbnRocy5cbmZ1bmN0aW9uIHBhcnNlU2FsZXNQbGFuU2hlZXQocm93cykge1xuICBpZiAoIXJvd3MgfHwgIXJvd3MubGVuZ3RoKSB7XG4gICAgY29uc3QgZXJyID0gbmV3IEVycm9yKCdFeGNlbCB2YWNpbycpO1xuICAgIGVyci5jb2RlID0gJ0VNUFRZX1NIRUVUJztcbiAgICB0aHJvdyBlcnI7XG4gIH1cbiAgY29uc3QgaGVhZGVySWR4ID0gZmluZEhlYWRlclJvdyhyb3dzKTtcbiAgaWYgKGhlYWRlcklkeCA8IDApIHtcbiAgICBjb25zdCBlcnIgPSBuZXcgRXJyb3IoJ05vIHNlIGVuY29udHJvIGZpbGEgZGUgaGVhZGVycyAoYnVzY2FiYSBcIlNLVSBDb2RlL1BhcnQgTm9cIiBvIFwiU0tVXCIpJyk7XG4gICAgZXJyLmNvZGUgPSAnSEVBREVSX05PVF9GT1VORCc7XG4gICAgdGhyb3cgZXJyO1xuICB9XG4gIGNvbnN0IGhlYWRlclJvdyA9IHJvd3NbaGVhZGVySWR4XSB8fCBbXTtcbiAgY29uc3Qgcm93QWJvdmUgPSBoZWFkZXJJZHggPiAwID8gcm93c1toZWFkZXJJZHggLSAxXSB8fCBbXSA6IG51bGw7XG4gIGNvbnN0IGNvbHMgPSBkZXRlY3RDb2x1bW5zKGhlYWRlclJvdywgcm93QWJvdmUpO1xuICBpZiAoY29scy5za3VJZHggPCAwKSB7XG4gICAgY29uc3QgZXJyID0gbmV3IEVycm9yKCdObyBzZSBlbmNvbnRybyBjb2x1bW5hIFNLVSBlbiBsYSBmaWxhIGhlYWRlcicpO1xuICAgIGVyci5jb2RlID0gJ1NLVV9DT0xfTUlTU0lORyc7XG4gICAgdGhyb3cgZXJyO1xuICB9XG4gIGlmICghY29scy5tb250aENvbHVtbnMubGVuZ3RoKSB7XG4gICAgY29uc3QgZXJyID0gbmV3IEVycm9yKFxuICAgICAgJ05vIHNlIGRldGVjdGFyb24gY29sdW1uYXMgZGUgbWVzZXMgZW4gZWwgaGVhZGVyIChlajogXCJKYW4gMjAyN1wiLCBcIk1heSAyMDI3XCIpJ1xuICAgICk7XG4gICAgZXJyLmNvZGUgPSAnTU9OVEhTX05PVF9GT1VORCc7XG4gICAgdGhyb3cgZXJyO1xuICB9XG4gIGNvbnN0IHBhcnNlZFJvd3MgPSBbXTtcbiAgY29uc3Qgc2VlblNrdSA9IG5ldyBTZXQoKTtcbiAgZm9yIChsZXQgciA9IGhlYWRlcklkeCArIDE7IHIgPCByb3dzLmxlbmd0aDsgcisrKSB7XG4gICAgY29uc3Qgcm93ID0gcm93c1tyXSB8fCBbXTtcbiAgICBjb25zdCBza3VSYXcgPSByb3dbY29scy5za3VJZHhdO1xuICAgIGlmIChza3VSYXcgPT0gbnVsbCB8fCBTdHJpbmcoc2t1UmF3KS50cmltKCkgPT09ICcnKSBjb250aW51ZTtcbiAgICBjb25zdCBza3UgPSBTdHJpbmcoc2t1UmF3KS50cmltKCk7XG4gICAgY29uc3QgdXBwZXIgPSBza3UudG9VcHBlckNhc2UoKTtcbiAgICAvLyBTa2lwIGZpbGFzIFRPVEFMIC8gU1VNIC8gU1VCVE9UQUxcbiAgICBpZiAodXBwZXIgPT09ICdUT1RBTCcgfHwgdXBwZXIgPT09ICdTVU0nIHx8IHVwcGVyID09PSAnU1VCVE9UQUwnIHx8IHVwcGVyID09PSAnVE9UQUxFUycpXG4gICAgICBjb250aW51ZTtcbiAgICBpZiAoc2VlblNrdS5oYXModXBwZXIpKSBjb250aW51ZTsgLy8gZGVkdXBlXG4gICAgc2VlblNrdS5hZGQodXBwZXIpO1xuICAgIGNvbnN0IGRlc2NyaXB0aW9uID1cbiAgICAgIGNvbHMuZGVzY0lkeCA+PSAwID8gU3RyaW5nKHJvd1tjb2xzLmRlc2NJZHhdID09IG51bGwgPyAnJyA6IHJvd1tjb2xzLmRlc2NJZHhdKS50cmltKCkgOiAnJztcbiAgICBjb25zdCBtb3FSYXcgPSBjb2xzLm1vcUlkeCA+PSAwID8gcm93W2NvbHMubW9xSWR4XSA6IG51bGw7XG4gICAgY29uc3QgbW9xTnVtID0gTnVtYmVyKG1vcVJhdyk7XG4gICAgY29uc3QgbW9xID0gTnVtYmVyLmlzRmluaXRlKG1vcU51bSkgJiYgbW9xTnVtID4gMCA/IE1hdGgucm91bmQobW9xTnVtKSA6IDA7XG4gICAgY29uc3QgbW9udGhzID0ge307XG4gICAgZm9yIChjb25zdCBtYyBvZiBjb2xzLm1vbnRoQ29sdW1ucykge1xuICAgICAgY29uc3QgdiA9IHJvd1ttYy5jb2xJZHhdO1xuICAgICAgY29uc3QgbiA9IE51bWJlcih2KTtcbiAgICAgIGlmIChOdW1iZXIuaXNGaW5pdGUobikgJiYgbiA+IDApIHtcbiAgICAgICAgbW9udGhzW21jLm1vbnRoS2V5XSA9IE1hdGgucm91bmQobik7XG4gICAgICB9XG4gICAgfVxuICAgIHBhcnNlZFJvd3MucHVzaCh7IHNrdSwgZGVzY3JpcHRpb24sIG1vcSwgbW9udGhzIH0pO1xuICB9XG4gIHJldHVybiB7XG4gICAgaGVhZGVyUm93SW5kZXg6IGhlYWRlcklkeCxcbiAgICBkZXRlY3RlZE1vbnRoczogY29scy5kZXRlY3RlZE1vbnRocyxcbiAgICByb3dzQ291bnQ6IHBhcnNlZFJvd3MubGVuZ3RoLFxuICAgIHJvd3M6IHBhcnNlZFJvd3MsXG4gIH07XG59XG5cbi8vIFVNRC1pc2ggZXhwb3J0OiBwYXJhIHZpdGVzdCAobW9kdWxlLmV4cG9ydHMpIHkgcGFyYSBidW5kbGUgYnJvd3NlciAod2luZG93IGdsb2JhbCkuXG5pZiAodHlwZW9mIG1vZHVsZSAhPT0gJ3VuZGVmaW5lZCcgJiYgbW9kdWxlLmV4cG9ydHMpIHtcbiAgbW9kdWxlLmV4cG9ydHMgPSB7IHBhcnNlU2FsZXNQbGFuU2hlZXQsIG5vcm1hbGl6ZU1vbnRoTGFiZWwsIGZpbmRIZWFkZXJSb3csIGRldGVjdENvbHVtbnMgfTtcbn1cbmlmICh0eXBlb2Ygd2luZG93ICE9PSAndW5kZWZpbmVkJykge1xuICB3aW5kb3cuU2FsZXNQbGFuUGFyc2VyID0ge1xuICAgIHBhcnNlU2FsZXNQbGFuU2hlZXQsXG4gICAgbm9ybWFsaXplTW9udGhMYWJlbCxcbiAgICBmaW5kSGVhZGVyUm93LFxuICAgIGRldGVjdENvbHVtbnMsXG4gIH07XG59XG5cbmV4cG9ydCB7IGRldGVjdENvbHVtbnMsIGZpbmRIZWFkZXJSb3csIG5vcm1hbGl6ZU1vbnRoTGFiZWwsIHBhcnNlU2FsZXNQbGFuU2hlZXQgfTtcbiIsICIvLyBAdHMtbm9jaGVja1xuLy8gdjEwOTgrIEZhc2UgMTogaW1wb3J0IGRlbCBwYXJzZXIgcHVyby4gRWwgbVx1MDBGM2R1bG8gaGFjZSBgd2luZG93LlNhbGVzUGxhblBhcnNlcmBcbi8vIGNvbW8gc2lkZS1lZmZlY3QgeSB0YW1iaVx1MDBFOW4gZXhwb3J0YSBsYXMgZm5zIG5vbWJyYWRhczsgdXNhbW9zIHNpZGUtZWZmZWN0XG4vLyBwb3JxdWUgZm9yZWNhc3QuanMgY29ycmUgZW4gZWwgY2h1bmsgbGF6eSB5IHdpbmRvdyB5YSBlc3RcdTAwRTEgZGlzcG9uaWJsZS5cbmltcG9ydCAnLi4vcHVyZS9zYWxlcy1wbGFuLXBhcnNlci5qcyc7XG5cbi8vIEdsb2JhbHMgbGVpZG9zIGRlbCBlbnRvcm5vIChkZWNsYXJhZG9zIGVuIGluZGV4Lmh0bWwgaW5saW5lIG8gYnVuZGxlIHByZXZpbyk6XG4vLyBmYkRiLCBjdXJyZW50VXNlciwgWExTWCAoY2RuKSwgZXNjYXBlSHRtbC4gTWlzbW8gcGF0cm9uIHF1ZSBvdHJvcyBkb21pbmlvcy5cbi8vXG4vLyBGT1JFQ0FTVCAtIG1vZGFsIGFkbWluLW9ubHkgKE1hcmlhbm8pLiBDaHVuayBsYXp5OiBzZSBjYXJnYSBzb2xvIGFsIHByaW1lclxuLy8gY2xpY2sgZGVsIGJvdG9uIEZPUkVDQVNUIGRlbCBoZWFkZXIuIFJlZ2lzdHJhZG8gZW4gYnVpbGQuanMgTEFaWV9DSFVOS1MgK1xuLy8gc3JjL21haW4uanMgaW5zdGFsbENodW5rU3R1YnMgKyBzdy5qcyBTVEFUSUNfQVNTRVRTLiBWZXIgQ0xBVURFLm1kICMxOC5cbi8vXG4vLyB2MTExMSBjbGVhbjogcGlwZWxpbmUgbGVnYWN5IChTS1UgKyA2IGNvbHVtbmFzICsgcG9saXRpY2EgM20pIHJlbW92aWRvLlxuLy8gUmVlbXBsYXphZG8gcG9yOlxuLy8gICAtIEZhc2UgMSAodjEwOTgpOiBTYWxlcyBQbGFucyBtZW5zdWFsZXMgUm9kcy9SZWVscyBjb24gZm9ybWF0byBTVVIuXG4vLyAgIC0gRmFzZSAyQiAodjExMDMpOiBGb3JlY2FzdCBFc3RhZGlzdGljbyAoc3RhdHNmb3JlY2FzdCBwaXBlbGluZSBvZmZsaW5lKS5cbi8vICAgLSBGYXNlIDNBICh2MTEwOSk6IFRhYmxhIFJlY29tZW5kYWNpb24gZGUgQ29tcHJhLlxuXG4vLyB2MTA5OCsgKEZhc2UgMSBGb3JlY2FzdCB2Mik6IFNhbGVzIFBsYW5zIG1lbnN1YWxlcyBwb3IgZmFtaWxpYSAoUm9kcy9SZWVscy9GRykuXG4vLyBTZSBndWFyZGFuIGVuIEZpcmVzdG9yZSBgc2FsZXNfcGxhbl9jYWNoZS97ZmFtaWxpYX1gICsgc25hcHNob3QgRXhjZWwgb3JpZ2luYWxcbi8vIGVuIFN0b3JhZ2UgYGZvcmVjYXN0c19zbmFwc2hvdHMve1lZWVktTU19L3tmYW1pbGlhfS54bHN4YC5cbi8vIEVsIHBhcnNlciBwdXJvIHZpdmUgZW4gc3JjL3B1cmUvc2FsZXMtcGxhbi1wYXJzZXIuanMgKGF0dGFjaCBhIHdpbmRvdy5TYWxlc1BsYW5QYXJzZXIpLlxuLy8gdjExMDg6IEZHIHJlbW92aWRvIGRlbCBVSSAoTWFyaWFubyBwaWRpXHUwMEYzKS4gU29sbyBSb2RzICsgUmVlbHMgcG9yIGFob3JhLlxuLy8gTGEgcnVsZSBGaXJlc3RvcmUgc2lndWUgYWNlcHRhbmRvICdmZycgcG9yIHNpIGVuIGVsIGZ1dHVybyBzZSB2dWVsdmUgYVxuLy8gYWN0aXZhciBcdTIwMTQgbm8gYm9ycmFybGEgZW4gc3RvcmFnZS9maXJlc3RvcmUucnVsZXMgaGFzdGEgY29uZmlybWFyIGRlcHJlY2F0ZS5cbmNvbnN0IFNBTEVTX1BMQU5fRkFNSUxJQVMgPSBbXG4gIHsga2V5OiAncm9kcycsIGxhYmVsOiAnUm9kcyAoQ2FcdTAwRjFhcyknLCBjb2xvcjogJyMwZWE1ZTknIH0sXG4gIHsga2V5OiAncmVlbHMnLCBsYWJlbDogJ1JlZWxzJywgY29sb3I6ICcjOGI1Y2Y2JyB9LFxuXTtcbmNvbnN0IF9zYWxlc1BsYW5DYWNoZXMgPSB7IHJvZHM6IG51bGwsIHJlZWxzOiBudWxsIH07IC8vIGxhc3QgbG9hZGVkIGRvY1xubGV0IF9mb3JlY2FzdEFjdGl2ZVRhYiA9ICdzYWxlcy1wbGFucyc7IC8vICdzYWxlcy1wbGFucycgfCAnc3RhdCcgfCAnbGVnYWN5J1xuXG4vLyB2MTEwMysgKEZhc2UgMkIpOiBGb3JlY2FzdCBFc3RhZFx1MDBFRHN0aWNvIFx1MjAxNCBvdXRwdXQgcHVibGljYWRvIHBvclxuLy8gc2NyaXB0cy9mb3JlY2FzdC9wdWJsaXNoX3RvX2ZpcmVzdG9yZS5weSBhIGZvcmVjYXN0X291dHB1dC97c3ViX3NsdWd9XG4vLyArIGZvcmVjYXN0X291dHB1dF9tZXRhL2N1cnJlbnQuIDI0IHN1YnMgKyAxIG1ldGEgZG9jLlxubGV0IF9mb3JlY2FzdFN0YXREb2NzID0gbnVsbDsgLy8gW3tpZCwgc3ViZmFtaWxpYSwgZm9yZWNhc3RbN10sIG1ldHJpY3MsIGJlc3RNb2RlbCwgdmVyc2lvbklkfV1cbmxldCBfZm9yZWNhc3RTdGF0TWV0YSA9IG51bGw7IC8vIHtnZW5lcmF0ZWRBdCwgdmVyc2lvbklkLCByZXN1bWVuOiB7Li4ufX1cbmxldCBfZm9yZWNhc3RTdGF0SGlzdG9yeUNhY2hlID0gbnVsbDsgLy8geyBbc3ViXTogW3tkcywgeX1dIH0gY2FjaGUgbGF6eSBvbi1kZW1hbmRcblxuLy8gdjExMDkrIChGYXNlIDNBKTogVGFibGEgUmVjb21lbmRhY2lcdTAwRjNuIGRlIENvbXByYSBcdTIwMTQgY29tYmluYSBzYWxlcyBwbGFucyArXG4vLyBzdG9ja19zbmFwc2hvdCArIHNrdV92ZW50YXNfc25hcHNob3QgcGFyYSBjb21wdXRhciByZWNvbWVuZGFkbyBwb3IgU0tVLlxubGV0IF9yZWNvU3RvY2tTbmFwc2hvdCA9IG51bGw7IC8vIHt3YXJlaG91c2VCcmVha2Rvd246IHtza3U6eycxMSc6biwnMTInOm4sLi4ufX0sIGJhY2tvcmRlckJ5U2t1OiB7c2t1Om59fVxubGV0IF9yZWNvVmVudGFzU25hcHNob3QgPSBudWxsOyAvLyB7IFtTS1UgdXBwZXJdOiB7bWVzZXM6IHsnWVlZWS1NTSc6IHtxdHksYXJzfX19IH1cbmxldCBfcmVjb0ZpbHRlck1pblJlYyA9IHRydWU7IC8vIFwic29sbyBtb3N0cmFyIFNLVXMgY29uIHJlY29tZW5kYWRvID4gMFwiXG5sZXQgX3JlY29GaWx0ZXJGYW1pbGlhID0gJ2FsbCc7IC8vICdhbGwnIHwgJ3JvZHMnIHwgJ3JlZWxzJ1xubGV0IF9yZWNvU2VhcmNoVGV4dCA9ICcnO1xuXG4vLyB2MTExMisgKEYzQik6IFNLVXMgZGVzY29udGludWFkb3MgcXVlIE1hcmlhbm8gbWFyY2EgcGFyYSBleGNsdWlyIGRlbCBmb3JlY2FzdC5cbi8vIFBlcnNpc3RlbiBlbiBGaXJlc3RvcmUgYGZvcmVjYXN0X2NvbmZpZy9kaXNjb250aW51ZWRfc2t1c2AgY29tbyB7IHNrdXM6IFtTS1UgdXBwZXJdLCB1cGRhdGVkQXQsIHVwZGF0ZWRCeSB9LlxubGV0IF9kaXNjb250aW51ZWRTa3VzID0gbnVsbDsgLy8gU2V0PHN0cmluZyB1cHBlcj4gbyBudWxsIHNpIG5vIGNhcmdhZG9cbmxldCBfZGlzY29udGludWVkTWV0YSA9IG51bGw7IC8vIHt1cGRhdGVkQXQsIHVwZGF0ZWRCeX1cblxuLy8gdjExMTQrIChGM0IgbXVsdGlwbGljYWRvciBkaW5cdTAwRTFtaWNvKTogbXVsdGlwbGljYWRvciBhdXRvIHBvciBTS1UgPSB2ZW50YV8ybVxuLy8gZGl2aWRpZG8gcG9yIHZlbnRhXzZtLCBjb24gY2FwLiBPdmVycmlkZSBtYW51YWwgcGVyc2lzdGlkbyBlbiBGaXJlc3RvcmVcbi8vIGBmb3JlY2FzdF9jb25maWcvbXVsdGlwbGllcnNgIGNvbiB7c2t1T3ZlcnJpZGVzOiB7U0tVOiB7dmFsdWUsIHVwZGF0ZWRCeSwgdXBkYXRlZEF0fX19LlxubGV0IF9tdWx0aXBsaWVyT3ZlcnJpZGVzID0gbnVsbDsgLy8geyBbU0tVIHVwcGVyXToge3ZhbHVlLCB1cGRhdGVkQnksIHVwZGF0ZWRBdH0gfVxuY29uc3QgUkVDT19NVUxUX1JFQ0VOVF9NT05USFMgPSAyO1xuY29uc3QgUkVDT19NVUxUX0JBU0VMSU5FX01PTlRIUyA9IDY7XG5jb25zdCBSRUNPX01VTFRfTUlOID0gMC41O1xuY29uc3QgUkVDT19NVUxUX01BWCA9IDIuNTtcbmNvbnN0IFJFQ09fTVVMVF9NSU5fQkFTRUxJTkUgPSAwLjE7IC8vIGV2aXRhIGRpdmlzaVx1MDBGM24gcG9yIGNlcm9cblxuY29uc3QgUkVDT19IT1JJWk9OX01PTlRIUyA9IDc7XG5jb25zdCBSRUNPX1ZFTlRBX1BST01FRElPX1dJTkRPVyA9IDM7IC8vIG1lc2VzIGhhY2lhIGF0clx1MDBFMXMgcGFyYSBwcm9tZWRpbyB2ZW50YVxuLy8gUkVDT19ERUZBVUxUX01VTFRJUExJRVIgcmVtb3ZlZCAyMDI2LTEwLTA2ICh1bnVzZWQsIGZsYWdnZWQgYnkgYmlvbWUpLlxuXG4vLyBXaGl0ZWxpc3QgZGUgZW1haWxzIGNvbiBhY2Nlc28gYWwgbW9kYWwgRk9SRUNBU1QuIFJlcGxpY2EgZWwgcGF0cm9uIGRlXG4vLyBcIkFuYWxpc2lzXCIgKGluZGV4Lmh0bWw6MTI2MjUpLiBTb2xvIE1hcmlhbm87IHNpIG90cm8gYWRtaW4gbG8gbmVjZXNpdGFcbi8vIHNlIGFncmVnYSBhY2EgZXhwbGljaXRvLlxuY29uc3QgRk9SRUNBU1RfQUxMT1dFRF9FTUFJTFMgPSBbJ21hcmlhbm8uZXJiaW5vQHNoaW1hbm8uY29tLmFyJywgJ2VyYmlub21hcmlhbm9AZ21haWwuY29tJ107XG5cbmZ1bmN0aW9uIF9jYW5Gb3JlY2FzdCgpIHtcbiAgdHJ5IHtcbiAgICBjb25zdCBlbWFpbCA9ICgod2luZG93LmN1cnJlbnRVc2VyICYmIHdpbmRvdy5jdXJyZW50VXNlci5lbWFpbCkgfHwgJycpLnRvTG93ZXJDYXNlKCk7XG4gICAgaWYgKCFlbWFpbCkgcmV0dXJuIGZhbHNlO1xuICAgIHJldHVybiBGT1JFQ0FTVF9BTExPV0VEX0VNQUlMUy5pbmRleE9mKGVtYWlsKSA+PSAwO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbn1cblxuZnVuY3Rpb24gX3JlbmRlck1vZGFsU2hlbGwoKSB7XG4gIGNvbnN0IGV4aXN0aW5nID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2ZvcmVjYXN0LW1vZGFsJyk7XG4gIGlmIChleGlzdGluZykgcmV0dXJuIGV4aXN0aW5nO1xuICBjb25zdCBlbCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpO1xuICBlbC5pZCA9ICdmb3JlY2FzdC1tb2RhbCc7XG4gIGVsLmNsYXNzTmFtZSA9ICdtb2RhbC1vdmVybGF5JztcbiAgLy8gdjEzMDYgKDIwMjYtMTAtMTUpOiBBcHBsZS1zdHlsZSBtb2RhbCBvdmVybGF5IGNvbiBiYWNrZHJvcCBibHVyLlxuICBlbC5zdHlsZS5jc3NUZXh0ID1cbiAgICAnZGlzcGxheTpub25lO3Bvc2l0aW9uOmZpeGVkO2luc2V0OjA7YmFja2dyb3VuZDpyZ2JhKDAsMCwwLC4zKTstd2Via2l0LWJhY2tkcm9wLWZpbHRlcjpzYXR1cmF0ZSgxNDAlKSBibHVyKDhweCk7YmFja2Ryb3AtZmlsdGVyOnNhdHVyYXRlKDE0MCUpIGJsdXIoOHB4KTt6LWluZGV4OjIwNTA7JztcbiAgZWwub25jbGljayA9IGZ1bmN0aW9uIChldikge1xuICAgIGlmIChldi50YXJnZXQgPT09IGVsKSB3aW5kb3cuY2xvc2VGb3JlY2FzdE1vZGFsKCk7XG4gIH07XG4gIGNvbnN0IHNoZWxsSHRtbCA9IF9idWlsZFNoZWxsSHRtbCgpO1xuICBlbC5pbm5lckhUTUwgPSBzaGVsbEh0bWw7XG4gIGRvY3VtZW50LmJvZHkuYXBwZW5kQ2hpbGQoZWwpO1xuICBfZW5zdXJlRm9yZWNhc3RBcHBsZUNzcygpO1xuICByZXR1cm4gZWw7XG59XG5cbmZ1bmN0aW9uIF9lbnN1cmVGb3JlY2FzdEFwcGxlQ3NzKCkge1xuICAvLyB2MTMwNjogQ1NTIEFwcGxlLXN0eWxlIGlueWVjdGFkbyB1bmEgc29sYSB2ZXogYWwgYWJyaXIgZWwgbW9kYWwuXG4gIC8vIFNraWxsIGFwcGxlLWRlc2lnbjogZmVlZGJhY2sgcG9pbnRlcmRvd24sIGJhY2tkcm9wIGJsdXIsIHJlZHVjZWQtbW90aW9uLFxuICAvLyB0eXBvZ3JhcGh5IHRyYWNraW5nIHNpemUtc3BlY2lmaWMuXG4gIGlmIChkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZm9yZWNhc3QtYXBwbGUtY3NzJykpIHJldHVybjtcbiAgY29uc3Qgc3R5bGUgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdzdHlsZScpO1xuICBzdHlsZS5pZCA9ICdmb3JlY2FzdC1hcHBsZS1jc3MnO1xuICBjb25zdCBjc3MgPVxuICAgICcjZm9yZWNhc3QtbW9kYWwgLmZjLWFwcGxlICp7Zm9udC1mYW1pbHk6LWFwcGxlLXN5c3RlbSxCbGlua01hY1N5c3RlbUZvbnQsXCJTRiBQcm8gRGlzcGxheVwiLFwiU0YgUHJvIFRleHRcIixcIkhlbHZldGljYSBOZXVlXCIsc2Fucy1zZXJpZn0nICtcbiAgICAnI2ZvcmVjYXN0LW1vZGFsIC5mYy1hcHBsZS1jbG9zZXtib3JkZXI6bm9uZTtiYWNrZ3JvdW5kOnJnYmEoMTIwLDEyMCwxMjgsLjE0KTt3aWR0aDozMHB4O2hlaWdodDozMHB4O2JvcmRlci1yYWRpdXM6NTAlO2N1cnNvcjpwb2ludGVyO2NvbG9yOiM4Njg2OGI7Zm9udC1zaXplOjE2cHg7ZGlzcGxheTpmbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtqdXN0aWZ5LWNvbnRlbnQ6Y2VudGVyO3RyYW5zaXRpb246dHJhbnNmb3JtIC4xMnMgZWFzZS1vdXQsYmFja2dyb3VuZCAuMTVzIGVhc2UsY29sb3IgLjE1cyBlYXNlfScgK1xuICAgICcjZm9yZWNhc3QtbW9kYWwgLmZjLWFwcGxlLWNsb3NlOmhvdmVye2JhY2tncm91bmQ6cmdiYSgxMjAsMTIwLDEyOCwuMjIpO2NvbG9yOiMxZDFkMWZ9JyArXG4gICAgJyNmb3JlY2FzdC1tb2RhbCAuZmMtYXBwbGUtY2xvc2U6YWN0aXZle3RyYW5zZm9ybTpzY2FsZSguOSk7YmFja2dyb3VuZDpyZ2JhKDEyMCwxMjAsMTI4LC4zKX0nICtcbiAgICAnI2ZvcmVjYXN0LW1vZGFsIC5mYy1hcHBsZS10YWJ7cGFkZGluZzo3cHggMTZweDtib3JkZXItcmFkaXVzOjk4MHB4O2JvcmRlcjpub25lO2JhY2tncm91bmQ6dHJhbnNwYXJlbnQ7Y29sb3I6Izg2ODY4Yjtmb250LXNpemU6MTIuNXB4O2ZvbnQtd2VpZ2h0OjYwMDtsZXR0ZXItc3BhY2luZzotMC4xcHg7Y3Vyc29yOnBvaW50ZXI7dHJhbnNpdGlvbjpiYWNrZ3JvdW5kIC4xNXMgZWFzZSxjb2xvciAuMTVzIGVhc2UsdHJhbnNmb3JtIC4xcyBlYXNlLW91dH0nICtcbiAgICAnI2ZvcmVjYXN0LW1vZGFsIC5mYy1hcHBsZS10YWI6aG92ZXJ7YmFja2dyb3VuZDpyZ2JhKDEyMCwxMjAsMTI4LC4xKTtjb2xvcjojMWQxZDFmfScgK1xuICAgICcjZm9yZWNhc3QtbW9kYWwgLmZjLWFwcGxlLXRhYjphY3RpdmV7dHJhbnNmb3JtOnNjYWxlKC45Nyl9JyArXG4gICAgJyNmb3JlY2FzdC1tb2RhbCAuZmMtYXBwbGUtdGFiLmFjdGl2ZXtiYWNrZ3JvdW5kOiMxZDFkMWY7Y29sb3I6I2ZmZn0nICtcbiAgICAnI2ZvcmVjYXN0LW1vZGFsIC5mYy1hcHBsZS10YWIuYWN0aXZlOmhvdmVye2JhY2tncm91bmQ6IzAwMH0nICtcbiAgICAnQG1lZGlhIChwcmVmZXJzLXJlZHVjZWQtbW90aW9uOnJlZHVjZSl7JyArXG4gICAgJyAgI2ZvcmVjYXN0LW1vZGFsIC5mYy1hcHBsZS1jbG9zZSwjZm9yZWNhc3QtbW9kYWwgLmZjLWFwcGxlLXRhYnt0cmFuc2l0aW9uOm5vbmUgIWltcG9ydGFudH0nICtcbiAgICAnICAjZm9yZWNhc3QtbW9kYWwgLmZjLWFwcGxlLWNsb3NlOmFjdGl2ZSwjZm9yZWNhc3QtbW9kYWwgLmZjLWFwcGxlLXRhYjphY3RpdmV7dHJhbnNmb3JtOm5vbmUgIWltcG9ydGFudH0nICtcbiAgICAnfSc7XG4gIHN0eWxlLnRleHRDb250ZW50ID0gY3NzO1xuICBkb2N1bWVudC5oZWFkLmFwcGVuZENoaWxkKHN0eWxlKTtcbn1cblxuZnVuY3Rpb24gX2J1aWxkU2hlbGxIdG1sKCkge1xuICAvLyB2MTMwNjogcmVkaXNlXHUwMEYxbyBBcHBsZS1zdHlsZS4gTWluaW1hbGlzdGEsIG5ldXRybywgYm9yZGVzIHN1dGlsZXMsXG4gIC8vIHJhZGl1cyBncmFuZGVzLCB0YWJzIGlPUyBTZXR0aW5ncyBwaWxsLlxuICBjb25zdCBtb2RhbE91dGVyID1cbiAgICAnPGRpdiBjbGFzcz1cImZjLWFwcGxlXCIgc3R5bGU9XCJwb3NpdGlvbjphYnNvbHV0ZTtpbnNldDoxdmggMXZ3O2JhY2tncm91bmQ6I2ZiZmJmZDtib3JkZXItcmFkaXVzOjE4cHg7ZGlzcGxheTpmbGV4O2ZsZXgtZGlyZWN0aW9uOmNvbHVtbjtvdmVyZmxvdzpoaWRkZW47Ym94LXNoYWRvdzowIDI0cHggNzBweCByZ2JhKDAsMCwwLC4yMilcIj4nO1xuICBjb25zdCBoZWFkZXIgPVxuICAgICc8ZGl2IHN0eWxlPVwicGFkZGluZzoyMnB4IDI2cHggMThweDtiYWNrZ3JvdW5kOnJnYmEoMjUxLDI1MSwyNTMsLjkyKTstd2Via2l0LWJhY2tkcm9wLWZpbHRlcjpzYXR1cmF0ZSgxODAlKSBibHVyKDIwcHgpO2JhY2tkcm9wLWZpbHRlcjpzYXR1cmF0ZSgxODAlKSBibHVyKDIwcHgpO2JvcmRlci1ib3R0b206MC41cHggc29saWQgcmdiYSgwLDAsMCwuMDgpO2Rpc3BsYXk6ZmxleDthbGlnbi1pdGVtczpmbGV4LXN0YXJ0O2dhcDoxNHB4XCI+JyArXG4gICAgJzxkaXYgc3R5bGU9XCJmbGV4OjE7bWluLXdpZHRoOjBcIj4nICtcbiAgICAnPGgyIHN0eWxlPVwibWFyZ2luOjAgMCA0cHg7Zm9udC1zaXplOjIycHg7Zm9udC13ZWlnaHQ6NzAwO2xldHRlci1zcGFjaW5nOi0wLjVweDtjb2xvcjojMWQxZDFmXCI+Rm9yZWNhc3Q8L2gyPicgK1xuICAgICc8ZGl2IGlkPVwiZm9yZWNhc3Qtc3VidGl0bGVcIiBzdHlsZT1cImZvbnQtc2l6ZToxM3B4O2xldHRlci1zcGFjaW5nOi0wLjFweDtjb2xvcjojODY4NjhiXCI+U2FsZXMgUGxhbnMgbWVuc3VhbGVzICsgcG9sXHUwMEVEdGljYSBkZSBpbnZlbnRhcmlvPC9kaXY+JyArXG4gICAgJzwvZGl2PicgK1xuICAgICc8YnV0dG9uIGNsYXNzPVwiZmMtYXBwbGUtY2xvc2VcIiBvbmNsaWNrPVwiY2xvc2VGb3JlY2FzdE1vZGFsKClcIiBhcmlhLWxhYmVsPVwiQ2VycmFyXCI+JnRpbWVzOzwvYnV0dG9uPicgK1xuICAgICc8L2Rpdj4nO1xuICBjb25zdCB0YWJzQmFyID1cbiAgICAnPGRpdiBpZD1cImZvcmVjYXN0LXRhYnMtYmFyXCIgc3R5bGU9XCJkaXNwbGF5OmZsZXg7Z2FwOjZweDtiYWNrZ3JvdW5kOiNmYmZiZmQ7cGFkZGluZzoxMnB4IDI2cHg7Ym9yZGVyLWJvdHRvbTowLjVweCBzb2xpZCByZ2JhKDAsMCwwLC4wNilcIj4nICtcbiAgICAnPGJ1dHRvbiBkYXRhLXRhYj1cInNhbGVzLXBsYW5zXCIgb25jbGljaz1cInN3aXRjaEZvcmVjYXN0VGFiKFxcJ3NhbGVzLXBsYW5zXFwnKVwiIGNsYXNzPVwiZm9yZWNhc3QtdGFiIGZjLWFwcGxlLXRhYiBhY3RpdmVcIj5TYWxlcyBQbGFuczwvYnV0dG9uPicgK1xuICAgICc8YnV0dG9uIGRhdGEtdGFiPVwic3RhdFwiIG9uY2xpY2s9XCJzd2l0Y2hGb3JlY2FzdFRhYihcXCdzdGF0XFwnKVwiIGNsYXNzPVwiZm9yZWNhc3QtdGFiIGZjLWFwcGxlLXRhYlwiPkZvcmVjYXN0IGVzdGFkXHUwMEVEc3RpY288L2J1dHRvbj4nICtcbiAgICAnPC9kaXY+JztcbiAgY29uc3QgdGFiU2FsZXNQbGFucyA9XG4gICAgJzxkaXYgaWQ9XCJmb3JlY2FzdC10YWItc2FsZXMtcGxhbnNcIiBzdHlsZT1cImZsZXg6MTtvdmVyZmxvdzphdXRvO3BhZGRpbmc6MDtiYWNrZ3JvdW5kOiNmYmZiZmRcIj48L2Rpdj4nO1xuICBjb25zdCB0YWJTdGF0ID1cbiAgICAnPGRpdiBpZD1cImZvcmVjYXN0LXRhYi1zdGF0XCIgc3R5bGU9XCJmbGV4OjE7b3ZlcmZsb3c6YXV0bztkaXNwbGF5Om5vbmU7cGFkZGluZzowO2JhY2tncm91bmQ6I2ZiZmJmZFwiPjwvZGl2Pic7XG4gIHJldHVybiBtb2RhbE91dGVyICsgaGVhZGVyICsgdGFic0JhciArIHRhYlNhbGVzUGxhbnMgKyB0YWJTdGF0ICsgJzwvZGl2Pic7XG59XG5cbi8vIHYxMDk4KyBGYXNlIDEgKyB2MTEwMysgRmFzZSAyQiArIHYxMTA1IGZpeCArIHYxMTExIGNsZWFuIGxlZ2FjeTogc3dpdGNoXG4vLyBlbnRyZSB0YWJzIFNhbGVzIFBsYW5zIC8gRm9yZWNhc3QgRXN0YWRcdTAwRURzdGljby5cbndpbmRvdy5zd2l0Y2hGb3JlY2FzdFRhYiA9IGZ1bmN0aW9uICh0YWJJZCkge1xuICBfZm9yZWNhc3RBY3RpdmVUYWIgPSB0YWJJZDtcbiAgY29uc3Qgc3AgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZm9yZWNhc3QtdGFiLXNhbGVzLXBsYW5zJyk7XG4gIGNvbnN0IHN0ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2ZvcmVjYXN0LXRhYi1zdGF0Jyk7XG4gIGlmIChzcCkgc3Auc3R5bGUuZGlzcGxheSA9IHRhYklkID09PSAnc2FsZXMtcGxhbnMnID8gJ2Jsb2NrJyA6ICdub25lJztcbiAgaWYgKHN0KSBzdC5zdHlsZS5kaXNwbGF5ID0gdGFiSWQgPT09ICdzdGF0JyA/ICdibG9jaycgOiAnbm9uZSc7XG4gIGNvbnN0IGJ0bnMgPSBkb2N1bWVudC5xdWVyeVNlbGVjdG9yQWxsKCcjZm9yZWNhc3QtdGFicy1iYXIgLmZvcmVjYXN0LXRhYicpO1xuICBidG5zLmZvckVhY2goKGIpID0+IHtcbiAgICBjb25zdCBhY3RpdmUgPSBiLmdldEF0dHJpYnV0ZSgnZGF0YS10YWInKSA9PT0gdGFiSWQ7XG4gICAgLy8gdjEzMDYgQXBwbGUtc3R5bGU6IHRvZ2dsZSBjbGFzcyBhY3RpdmUgKGxvcyBlc3RpbG9zIGRlIHBpbGwgdmllbmVuIGRlbCBDU1MpLlxuICAgIGIuY2xhc3NMaXN0LnRvZ2dsZSgnYWN0aXZlJywgYWN0aXZlKTtcbiAgfSk7XG4gIC8vIHYxMTA1IGZpeDogYWwgYWN0aXZhciBsYSB0YWIgc3RhdCwgbW9zdHJhciBwbGFjZWhvbGRlciBpbm1lZGlhdG8gcGFyYVxuICAvLyBxdWUgc2UgdmVhIGFsZ28gbWllbnRyYXMgY2FyZ2EgKG8gc2kgZWwgbG9hZCB5YSB0ZXJtaW5vLCByZS1yZW5kZXIpLlxuICBpZiAodGFiSWQgPT09ICdzdGF0Jykge1xuICAgIGNvbnN0IGNvbnQgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZm9yZWNhc3QtdGFiLXN0YXQnKTtcbiAgICBpZiAoY29udCkge1xuICAgICAgaWYgKF9mb3JlY2FzdFN0YXREb2NzKSB7XG4gICAgICAgIC8vIFlhIGNhcmdhZG86IHJlLXJlbmRlciAocG9yIHNpIGVsIHVzZXIgdmllbmUgZGUgb3RyYSB0YWIpLlxuICAgICAgICBfcmVuZGVyRm9yZWNhc3RTdGF0VGFiKCk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICAvLyBBXHUwMEZBbiBubyBjYXJnYWRvOiBwbGFjZWhvbGRlciArIGxvYWQuXG4gICAgICAgIGNvbnQuaW5uZXJIVE1MID1cbiAgICAgICAgICAnPGRpdiBjbGFzcz1cImZjLWFwcGxlXCIgc3R5bGU9XCJwYWRkaW5nOjgwcHggMjBweDt0ZXh0LWFsaWduOmNlbnRlcjtjb2xvcjojODY4NjhiO2ZvbnQtc2l6ZToxNHB4O2xldHRlci1zcGFjaW5nOi0wLjFweFwiPicgK1xuICAgICAgICAgICc8ZGl2IHN0eWxlPVwiZGlzcGxheTppbmxpbmUtYmxvY2s7d2lkdGg6MjhweDtoZWlnaHQ6MjhweDtib3JkZXI6Mi41cHggc29saWQgcmdiYSgwLDEyMiwyNTUsLjIpO2JvcmRlci10b3AtY29sb3I6IzAwN2FmZjtib3JkZXItcmFkaXVzOjUwJTthbmltYXRpb246c3BpbiAwLjc1cyBsaW5lYXIgaW5maW5pdGU7bWFyZ2luLWJvdHRvbToxNnB4XCI+PC9kaXY+JyArXG4gICAgICAgICAgJzxkaXY+Q2FyZ2FuZG8gZm9yZWNhc3QgZGVzZGUgRmlyZXN0b3JlPC9kaXY+JyArXG4gICAgICAgICAgJzxzdHlsZT5Aa2V5ZnJhbWVzIHNwaW57dG97dHJhbnNmb3JtOnJvdGF0ZSgzNjBkZWcpfX08L3N0eWxlPicgK1xuICAgICAgICAgICc8L2Rpdj4nO1xuICAgICAgICBfbG9hZEZvcmVjYXN0T3V0cHV0KClcbiAgICAgICAgICAudGhlbihfcmVuZGVyRm9yZWNhc3RTdGF0VGFiKVxuICAgICAgICAgIC5jYXRjaCgoZSkgPT4ge1xuICAgICAgICAgICAgY29uc29sZS5lcnJvcignW0ZPUkVDQVNUIHN0YXRdIGxvYWQgZmFpbCcsIGUpO1xuICAgICAgICAgICAgY29uc3QgYyA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdmb3JlY2FzdC10YWItc3RhdCcpO1xuICAgICAgICAgICAgaWYgKGMpIHtcbiAgICAgICAgICAgICAgYy5pbm5lckhUTUwgPVxuICAgICAgICAgICAgICAgICc8ZGl2IGNsYXNzPVwiZmMtYXBwbGVcIiBzdHlsZT1cInBhZGRpbmc6ODBweCAyMHB4O3RleHQtYWxpZ246Y2VudGVyO2xpbmUtaGVpZ2h0OjEuNVwiPicgK1xuICAgICAgICAgICAgICAgICc8ZGl2IHN0eWxlPVwiZm9udC1zaXplOjE2cHg7Zm9udC13ZWlnaHQ6NjAwO21hcmdpbi1ib3R0b206MTBweDtjb2xvcjojYzczNzJmO2xldHRlci1zcGFjaW5nOi0wLjJweFwiPkVycm9yIGNhcmdhbmRvIGZvcmVjYXN0PC9kaXY+JyArXG4gICAgICAgICAgICAgICAgJzxkaXYgc3R5bGU9XCJmb250LXNpemU6MTIuNXB4O2NvbG9yOiM4Njg2OGI7bWFyZ2luLWJvdHRvbToxOHB4O2xldHRlci1zcGFjaW5nOi0wLjFweFwiPicgK1xuICAgICAgICAgICAgICAgIGVzY2FwZUh0bWxTYWZlKGUubWVzc2FnZSB8fCBTdHJpbmcoZSkpICtcbiAgICAgICAgICAgICAgICAnPC9kaXY+JyArXG4gICAgICAgICAgICAgICAgJzxidXR0b24gb25jbGljaz1cInN3aXRjaEZvcmVjYXN0VGFiKFxcJ3N0YXRcXCcpXCIgc3R5bGU9XCJwYWRkaW5nOjlweCAxOHB4O2JhY2tncm91bmQ6IzAwN2FmZjtjb2xvcjojZmZmO2JvcmRlcjpub25lO2JvcmRlci1yYWRpdXM6OTgwcHg7Zm9udC13ZWlnaHQ6NjAwO2N1cnNvcjpwb2ludGVyO2ZvbnQtc2l6ZToxM3B4O2xldHRlci1zcGFjaW5nOi0wLjFweFwiPlJlaW50ZW50YXI8L2J1dHRvbj4nICtcbiAgICAgICAgICAgICAgICAnPC9kaXY+JztcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9KTtcbiAgICAgIH1cbiAgICB9XG4gIH1cbn07XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gRkFTRSAxIFx1MjAxNCBTYWxlcyBQbGFucyB1cGxvYWQgKFJvZHMgLyBSZWVscyAvIEZHKVxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmZ1bmN0aW9uIF95ZWFyTW9udGhOb3coKSB7XG4gIGNvbnN0IGQgPSBuZXcgRGF0ZSgpO1xuICByZXR1cm4gZC5nZXRGdWxsWWVhcigpICsgJy0nICsgU3RyaW5nKGQuZ2V0TW9udGgoKSArIDEpLnBhZFN0YXJ0KDIsICcwJyk7XG59XG5cbmZ1bmN0aW9uIF9mbXRTaXplKGJ5dGVzKSB7XG4gIGlmICghYnl0ZXMpIHJldHVybiAnJztcbiAgaWYgKGJ5dGVzIDwgMTAyNCkgcmV0dXJuIGJ5dGVzICsgJyBCJztcbiAgaWYgKGJ5dGVzIDwgMTAyNCAqIDEwMjQpIHJldHVybiAoYnl0ZXMgLyAxMDI0KS50b0ZpeGVkKDEpICsgJyBLQic7XG4gIHJldHVybiAoYnl0ZXMgLyAoMTAyNCAqIDEwMjQpKS50b0ZpeGVkKDIpICsgJyBNQic7XG59XG5cbmZ1bmN0aW9uIF9mbXREYXRlU2hvcnQoaXNvKSB7XG4gIGlmICghaXNvKSByZXR1cm4gJ1x1MjAxNCc7XG4gIHRyeSB7XG4gICAgY29uc3QgZCA9IGlzby50b0RhdGUgPyBpc28udG9EYXRlKCkgOiBuZXcgRGF0ZShpc28pO1xuICAgIHJldHVybiAoXG4gICAgICBkLnRvTG9jYWxlRGF0ZVN0cmluZygnZXMtQVInLCB7IGRheTogJzItZGlnaXQnLCBtb250aDogJ3Nob3J0JywgeWVhcjogJzItZGlnaXQnIH0pICtcbiAgICAgICcgJyArXG4gICAgICBkLnRvTG9jYWxlVGltZVN0cmluZygnZXMtQVInLCB7IGhvdXI6ICcyLWRpZ2l0JywgbWludXRlOiAnMi1kaWdpdCcgfSlcbiAgICApO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gU3RyaW5nKGlzbyk7XG4gIH1cbn1cblxuYXN5bmMgZnVuY3Rpb24gX2xvYWRTYWxlc1BsYW5DYWNoZXMoKSB7XG4gIGlmICghd2luZG93LmZiRGIpIHJldHVybjtcbiAgYXdhaXQgUHJvbWlzZS5hbGwoXG4gICAgU0FMRVNfUExBTl9GQU1JTElBUy5tYXAoYXN5bmMgKGYpID0+IHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IGRvYyA9IGF3YWl0IHdpbmRvdy5mYkRiLmNvbGxlY3Rpb24oJ3NhbGVzX3BsYW5fY2FjaGUnKS5kb2MoZi5rZXkpLmdldCgpO1xuICAgICAgICBfc2FsZXNQbGFuQ2FjaGVzW2Yua2V5XSA9IGRvYy5leGlzdHMgPyBkb2MuZGF0YSgpIDogbnVsbDtcbiAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgY29uc29sZS53YXJuKCdbRk9SRUNBU1RdIGxvYWQgc2FsZXNfcGxhbl9jYWNoZS8nICsgZi5rZXkgKyAnIGZhaWw6JywgZSAmJiBlLm1lc3NhZ2UpO1xuICAgICAgICBfc2FsZXNQbGFuQ2FjaGVzW2Yua2V5XSA9IG51bGw7XG4gICAgICB9XG4gICAgfSlcbiAgKTtcbn1cblxuZnVuY3Rpb24gZXNjYXBlSHRtbFNhZmUocykge1xuICBpZiAodHlwZW9mIHdpbmRvdy5lc2NhcGVIdG1sID09PSAnZnVuY3Rpb24nKSByZXR1cm4gd2luZG93LmVzY2FwZUh0bWwocyk7XG4gIHJldHVybiBTdHJpbmcocyA9PSBudWxsID8gJycgOiBzKS5yZXBsYWNlKFxuICAgIC9bJjw+XCInXS9nLFxuICAgIChjaCkgPT4gKHsgJyYnOiAnJmFtcDsnLCAnPCc6ICcmbHQ7JywgJz4nOiAnJmd0OycsICdcIic6ICcmcXVvdDsnLCBcIidcIjogJyYjMzk7JyB9KVtjaF1cbiAgKTtcbn1cblxuZnVuY3Rpb24gX2J1aWxkU2FsZXNQbGFuU2xvdEh0bWwoZikge1xuICBjb25zdCBjYWNoZSA9IF9zYWxlc1BsYW5DYWNoZXNbZi5rZXldO1xuICBjb25zdCByb3dzQ291bnQgPSBjYWNoZSAmJiBOdW1iZXIuaXNGaW5pdGUoY2FjaGUucm93c0NvdW50KSA/IGNhY2hlLnJvd3NDb3VudCA6IDA7XG4gIGNvbnN0IG1vbnRoc0NvdW50ID1cbiAgICBjYWNoZSAmJiBBcnJheS5pc0FycmF5KGNhY2hlLmRldGVjdGVkTW9udGhzKSA/IGNhY2hlLmRldGVjdGVkTW9udGhzLmxlbmd0aCA6IDA7XG4gIGNvbnN0IHBhcnNlZEF0ID0gY2FjaGUgJiYgY2FjaGUucGFyc2VkQXQgPyBfZm10RGF0ZVNob3J0KGNhY2hlLnBhcnNlZEF0KSA6ICcnO1xuICBjb25zdCB1cGxvYWRlZEJ5ID0gY2FjaGUgJiYgY2FjaGUudXBsb2FkZWRCeSA/IGNhY2hlLnVwbG9hZGVkQnkgOiAnJztcbiAgY29uc3Qgc291cmNlRmlsZW5hbWUgPSBjYWNoZSAmJiBjYWNoZS5zb3VyY2VGaWxlbmFtZSA/IGNhY2hlLnNvdXJjZUZpbGVuYW1lIDogJyc7XG4gIGNvbnN0IHllYXJNb250aCA9IGNhY2hlICYmIGNhY2hlLnllYXJNb250aCA/IGNhY2hlLnllYXJNb250aCA6ICcnO1xuICBjb25zdCBtb250aHNSYW5nZSA9XG4gICAgY2FjaGUgJiYgY2FjaGUuZGV0ZWN0ZWRNb250aHMgJiYgY2FjaGUuZGV0ZWN0ZWRNb250aHMubGVuZ3RoXG4gICAgICA/IGNhY2hlLmRldGVjdGVkTW9udGhzWzBdICsgJyBcdTIxOTIgJyArIGNhY2hlLmRldGVjdGVkTW9udGhzW2NhY2hlLmRldGVjdGVkTW9udGhzLmxlbmd0aCAtIDFdXG4gICAgICA6ICdcdTIwMTQnO1xuICBjb25zdCBoYXNDYWNoZSA9ICEhY2FjaGU7XG4gIGNvbnN0IGJhZGdlID0gaGFzQ2FjaGVcbiAgICA/ICc8ZGl2IHN0eWxlPVwicGFkZGluZzo0cHggOHB4O2JhY2tncm91bmQ6IzE2YTM0YTtjb2xvcjojZmZmO2JvcmRlci1yYWRpdXM6MTJweDtmb250LXNpemU6MTBweDtmb250LXdlaWdodDo3MDA7bGV0dGVyLXNwYWNpbmc6LjRweFwiPkNBUkdBRE88L2Rpdj4nXG4gICAgOiAnPGRpdiBzdHlsZT1cInBhZGRpbmc6NHB4IDhweDtiYWNrZ3JvdW5kOiNkYzI2MjY7Y29sb3I6I2ZmZjtib3JkZXItcmFkaXVzOjEycHg7Zm9udC1zaXplOjEwcHg7Zm9udC13ZWlnaHQ6NzAwO2xldHRlci1zcGFjaW5nOi40cHhcIj5GQUxUQTwvZGl2Pic7XG4gIGNvbnN0IG1ldGFCbG9jayA9IGhhc0NhY2hlXG4gICAgPyAnPGRpdiBzdHlsZT1cImRpc3BsYXk6Z3JpZDtncmlkLXRlbXBsYXRlLWNvbHVtbnM6YXV0byAxZnI7Z2FwOjZweCAxMnB4O2ZvbnQtc2l6ZToxMXB4O3BhZGRpbmc6MTBweCAxMnB4O2JhY2tncm91bmQ6dmFyKC0tYmctc2Vjb25kYXJ5KTtib3JkZXItcmFkaXVzOjZweFwiPicgK1xuICAgICAgJzxkaXYgc3R5bGU9XCJjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTtmb250LXdlaWdodDo2MDBcIj5BcmNoaXZvPC9kaXY+PGRpdiBzdHlsZT1cImNvbG9yOnZhcigtLXRleHQtcHJpbWFyeSk7Zm9udC1mYW1pbHk6bW9ub3NwYWNlO3dvcmQtYnJlYWs6YnJlYWstYWxsXCI+JyArXG4gICAgICBlc2NhcGVIdG1sU2FmZShzb3VyY2VGaWxlbmFtZSkgK1xuICAgICAgJzwvZGl2PicgK1xuICAgICAgJzxkaXYgc3R5bGU9XCJjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTtmb250LXdlaWdodDo2MDBcIj5TdWJpZG88L2Rpdj48ZGl2IHN0eWxlPVwiY29sb3I6dmFyKC0tdGV4dC1wcmltYXJ5KVwiPicgK1xuICAgICAgZXNjYXBlSHRtbFNhZmUocGFyc2VkQXQpICtcbiAgICAgICc8L2Rpdj4nICtcbiAgICAgICc8ZGl2IHN0eWxlPVwiY29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7Zm9udC13ZWlnaHQ6NjAwXCI+UG9yPC9kaXY+PGRpdiBzdHlsZT1cImNvbG9yOnZhcigtLXRleHQtcHJpbWFyeSlcIj4nICtcbiAgICAgIGVzY2FwZUh0bWxTYWZlKHVwbG9hZGVkQnkpICtcbiAgICAgICc8L2Rpdj4nICtcbiAgICAgICc8ZGl2IHN0eWxlPVwiY29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7Zm9udC13ZWlnaHQ6NjAwXCI+U25hcHNob3Q8L2Rpdj48ZGl2IHN0eWxlPVwiY29sb3I6dmFyKC0tdGV4dC1wcmltYXJ5KTtmb250LWZhbWlseTptb25vc3BhY2VcIj4nICtcbiAgICAgIGVzY2FwZUh0bWxTYWZlKHllYXJNb250aCkgK1xuICAgICAgJzwvZGl2PicgK1xuICAgICAgJzxkaXYgc3R5bGU9XCJjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTtmb250LXdlaWdodDo2MDBcIj5TS1VzPC9kaXY+PGRpdiBzdHlsZT1cImNvbG9yOnZhcigtLXRleHQtcHJpbWFyeSk7Zm9udC13ZWlnaHQ6NzAwXCI+JyArXG4gICAgICByb3dzQ291bnQudG9Mb2NhbGVTdHJpbmcoJ2VzLUFSJykgK1xuICAgICAgJzwvZGl2PicgK1xuICAgICAgJzxkaXYgc3R5bGU9XCJjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTtmb250LXdlaWdodDo2MDBcIj5NZXNlczwvZGl2PjxkaXYgc3R5bGU9XCJjb2xvcjp2YXIoLS10ZXh0LXByaW1hcnkpO2ZvbnQtd2VpZ2h0OjcwMFwiPicgK1xuICAgICAgbW9udGhzQ291bnQgK1xuICAgICAgJyA8c3BhbiBzdHlsZT1cImNvbG9yOnZhcigtLXRleHQtbXV0ZWQpO2ZvbnQtd2VpZ2h0OjQwMFwiPignICtcbiAgICAgIGVzY2FwZUh0bWxTYWZlKG1vbnRoc1JhbmdlKSArXG4gICAgICAnKTwvc3Bhbj48L2Rpdj4nICtcbiAgICAgICc8L2Rpdj4nXG4gICAgOiAnPGRpdiBzdHlsZT1cInBhZGRpbmc6MTRweDt0ZXh0LWFsaWduOmNlbnRlcjtmb250LXNpemU6MTJweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTtiYWNrZ3JvdW5kOnZhcigtLWJnLXNlY29uZGFyeSk7Ym9yZGVyLXJhZGl1czo2cHg7Ym9yZGVyOjFweCBkYXNoZWQgdmFyKC0tYm9yZGVyLXN1YnRsZSlcIj5BdW4gbm8gc3ViaXN0ZSBlbCBTYWxlcyBQbGFuIGRlIGVzdGEgZmFtaWxpYS48L2Rpdj4nO1xuICBjb25zdCB1cGxvYWRCdG4gPVxuICAgICc8bGFiZWwgc3R5bGU9XCJkaXNwbGF5OmlubGluZS1mbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtqdXN0aWZ5LWNvbnRlbnQ6Y2VudGVyO2dhcDo4cHg7cGFkZGluZzoxMHB4IDE0cHg7YmFja2dyb3VuZDonICtcbiAgICBmLmNvbG9yICtcbiAgICAnO2NvbG9yOiNmZmY7Ym9yZGVyLXJhZGl1czo2cHg7Zm9udC13ZWlnaHQ6NzAwO2ZvbnQtc2l6ZToxMnB4O2N1cnNvcjpwb2ludGVyO2xldHRlci1zcGFjaW5nOi40cHhcIj4nICtcbiAgICAnPHNwYW4+JyArXG4gICAgKGhhc0NhY2hlID8gJ1x1MjFCQiBSZWVtcGxhemFyIEV4Y2VsJyA6ICdcdTJCMDYgQ2FyZ2FyIEV4Y2VsJykgK1xuICAgICc8L3NwYW4+JyArXG4gICAgJzxpbnB1dCB0eXBlPVwiZmlsZVwiIGFjY2VwdD1cIi54bHN4LC54bHNcIiBkYXRhLWZhbWlsaWE9XCInICtcbiAgICBmLmtleSArXG4gICAgJ1wiIHN0eWxlPVwiZGlzcGxheTpub25lXCIgb25jaGFuZ2U9XCJvblNhbGVzUGxhbkZpbGVGb3JGYW1pbGlhKGV2ZW50LCBcXCcnICtcbiAgICBmLmtleSArXG4gICAgJ1xcJylcIi8+JyArXG4gICAgJzwvbGFiZWw+JztcbiAgY29uc3QgY2FyZEhlYWQgPVxuICAgICc8ZGl2IHN0eWxlPVwiZGlzcGxheTpmbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtnYXA6MTBweFwiPicgK1xuICAgICc8ZGl2IHN0eWxlPVwid2lkdGg6MTJweDtoZWlnaHQ6MzJweDtiYWNrZ3JvdW5kOicgK1xuICAgIGYuY29sb3IgK1xuICAgICc7Ym9yZGVyLXJhZGl1czozcHhcIj48L2Rpdj4nICtcbiAgICAnPGRpdiBzdHlsZT1cImZsZXg6MVwiPjxkaXYgc3R5bGU9XCJmb250LXNpemU6MTRweDtmb250LXdlaWdodDo4MDA7Y29sb3I6dmFyKC0tdGV4dC1wcmltYXJ5KVwiPicgK1xuICAgIGVzY2FwZUh0bWxTYWZlKGYubGFiZWwpICtcbiAgICAnPC9kaXY+JyArXG4gICAgJzxkaXYgc3R5bGU9XCJmb250LXNpemU6MTFweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTttYXJnaW4tdG9wOjJweFwiPlNhbGVzIFBsYW4gbWVuc3VhbCBcdTAwQjcgSG9qYSBTQVI8L2Rpdj48L2Rpdj4nICtcbiAgICBiYWRnZSArXG4gICAgJzwvZGl2Pic7XG4gIHJldHVybiAoXG4gICAgJzxkaXYgc3R5bGU9XCJiYWNrZ3JvdW5kOnZhcigtLWJnLWVsZXZhdGVkKTtib3JkZXI6MXB4IHNvbGlkIHZhcigtLWJvcmRlci1zdWJ0bGUpO2JvcmRlci1yYWRpdXM6MTBweDtwYWRkaW5nOjE2cHg7ZGlzcGxheTpmbGV4O2ZsZXgtZGlyZWN0aW9uOmNvbHVtbjtnYXA6MTJweFwiPicgK1xuICAgIGNhcmRIZWFkICtcbiAgICBtZXRhQmxvY2sgK1xuICAgIHVwbG9hZEJ0biArXG4gICAgJzxkaXYgaWQ9XCJzYWxlcy1wbGFuLXN0YXR1cy0nICtcbiAgICBmLmtleSArXG4gICAgJ1wiIHN0eWxlPVwiZm9udC1zaXplOjExcHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7bWluLWhlaWdodDoxNHB4XCI+PC9kaXY+JyArXG4gICAgJzwvZGl2PidcbiAgKTtcbn1cblxuZnVuY3Rpb24gX3JlbmRlclNhbGVzUGxhbnNUYWIoKSB7XG4gIGNvbnN0IGNvbnQgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZm9yZWNhc3QtdGFiLXNhbGVzLXBsYW5zJyk7XG4gIGlmICghY29udCkgcmV0dXJuO1xuICBjb25zdCBzbG90cyA9IFNBTEVTX1BMQU5fRkFNSUxJQVMubWFwKF9idWlsZFNhbGVzUGxhblNsb3RIdG1sKS5qb2luKCcnKTtcbiAgY29uc3QgaW50cm8gPVxuICAgICc8ZGl2IHN0eWxlPVwibWFyZ2luLWJvdHRvbToxNnB4O3BhZGRpbmc6MTJweCAxNHB4O2JhY2tncm91bmQ6dmFyKC0tYmctc2Vjb25kYXJ5KTtib3JkZXItbGVmdDozcHggc29saWQgIzBkOTQ4ODtib3JkZXItcmFkaXVzOjZweDtmb250LXNpemU6MTJweDtjb2xvcjp2YXIoLS10ZXh0LXNlY29uZGFyeSk7bGluZS1oZWlnaHQ6MS41XCI+JyArXG4gICAgJzxiIHN0eWxlPVwiY29sb3I6dmFyKC0tdGV4dC1wcmltYXJ5KVwiPkZhc2UgMTwvYj4gXHUyMDE0IENhcmdcdTAwRTEgbG9zIFNhbGVzIFBsYW5zIG1lbnN1YWxlcyAoUm9kcyAvIFJlZWxzKS4gU2UgcGFyc2VhIGxhIGhvamEgPGI+U0FSPC9iPjogU0tVLCBNT1EgMTIgbW9udGhzLCB5IHVuYSBjb2x1bW5hIHBvciBtZXMuICcgK1xuICAgICdFbCBFeGNlbCBvcmlnaW5hbCBxdWVkYSBzbmFwc2hvdGFkbyBlbiBTdG9yYWdlIHkgZWwgcGFyc2VvIHF1ZWRhIGVuIEZpcmVzdG9yZSBwYXJhIGVsIGNcdTAwRTFsY3VsbyBkZWJham8uJyArXG4gICAgJzwvZGl2Pic7XG4gIGNvbnN0IGdyaWQgPVxuICAgICc8ZGl2IHN0eWxlPVwiZGlzcGxheTpncmlkO2dyaWQtdGVtcGxhdGUtY29sdW1uczpyZXBlYXQoYXV0by1maXQsbWlubWF4KDMyMHB4LDFmcikpO2dhcDoxNnB4O21hcmdpbi1ib3R0b206MjRweFwiPicgK1xuICAgIHNsb3RzICtcbiAgICAnPC9kaXY+JztcbiAgLy8gdjExMDk6IGNvbnRlbmVkb3IgcGFyYSB0YWJsYSBSZWNvbWVuZGFjaVx1MDBGM24gZGUgQ29tcHJhLiBTZSByZWxsZW5hIG9uLWRlbWFuZFxuICAvLyB2aWEgX3JlbmRlclJlY29TZWN0aW9uKCkgKGxhenkgbG9hZCBkZSBzdG9ja19zbmFwc2hvdCArIHNrdV92ZW50YXNfc25hcHNob3QpLlxuICBjb25zdCByZWNvU2VjdGlvbiA9ICc8ZGl2IGlkPVwicmVjby1zZWN0aW9uLWNvbnRhaW5lclwiPjwvZGl2Pic7XG4gIGNvbnQuaW5uZXJIVE1MID0gJzxkaXYgc3R5bGU9XCJwYWRkaW5nOjE4cHhcIj4nICsgaW50cm8gKyBncmlkICsgcmVjb1NlY3Rpb24gKyAnPC9kaXY+JztcbiAgX3JlbmRlclJlY29TZWN0aW9uKCk7XG59XG5cbndpbmRvdy5vblNhbGVzUGxhbkZpbGVGb3JGYW1pbGlhID0gYXN5bmMgZnVuY3Rpb24gKGV2ZW50LCBmYW1pbGlhKSB7XG4gIGNvbnN0IGZpbGUgPSBldmVudCAmJiBldmVudC50YXJnZXQgJiYgZXZlbnQudGFyZ2V0LmZpbGVzICYmIGV2ZW50LnRhcmdldC5maWxlc1swXTtcbiAgaWYgKCFmaWxlKSByZXR1cm47XG4gIGNvbnN0IHN0YXR1c0VsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3NhbGVzLXBsYW4tc3RhdHVzLScgKyBmYW1pbGlhKTtcbiAgY29uc3Qgc2V0U3RhdHVzID0gKG1zZywgY29sb3IpID0+IHtcbiAgICBpZiAoIXN0YXR1c0VsKSByZXR1cm47XG4gICAgc3RhdHVzRWwudGV4dENvbnRlbnQgPSBtc2c7XG4gICAgc3RhdHVzRWwuc3R5bGUuY29sb3IgPSBjb2xvciB8fCAndmFyKC0tdGV4dC1tdXRlZCknO1xuICB9O1xuICB0cnkge1xuICAgIGlmICh0eXBlb2YgWExTWCA9PT0gJ3VuZGVmaW5lZCcpIHtcbiAgICAgIGFsZXJ0KCdTaGVldEpTIChYTFNYKSBubyBjYXJnYWRvIFx1MjAxNCByZWNhcmdcdTAwRTEgbGEgYXBwLicpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBpZiAoIXdpbmRvdy5TYWxlc1BsYW5QYXJzZXIgfHwgIXdpbmRvdy5TYWxlc1BsYW5QYXJzZXIucGFyc2VTYWxlc1BsYW5TaGVldCkge1xuICAgICAgYWxlcnQoJ1BhcnNlciBTYWxlcyBQbGFuIG5vIGNhcmdhZG8uIFJlYnVpbGQgYnVuZGxlLicpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBpZiAoIXdpbmRvdy5maXJlYmFzZSB8fCAhd2luZG93LmZpcmViYXNlLnN0b3JhZ2UpIHtcbiAgICAgIGFsZXJ0KCdGaXJlYmFzZSBTdG9yYWdlIG5vIGRpc3BvbmlibGUuJyk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIHNldFN0YXR1cygnTGV5ZW5kbyBFeGNlbFx1MjAyNicpO1xuICAgIGNvbnN0IGJ1ZiA9IGF3YWl0IGZpbGUuYXJyYXlCdWZmZXIoKTtcbiAgICBjb25zdCB3YiA9IFhMU1gucmVhZChidWYsIHsgdHlwZTogJ2FycmF5JyB9KTtcbiAgICBjb25zdCBzYXJOYW1lID0gd2IuU2hlZXROYW1lcy5maW5kKFxuICAgICAgKG4pID0+XG4gICAgICAgIFN0cmluZyhuIHx8ICcnKVxuICAgICAgICAgIC50cmltKClcbiAgICAgICAgICAudG9VcHBlckNhc2UoKSA9PT0gJ1NBUidcbiAgICApO1xuICAgIGlmICghc2FyTmFtZSkge1xuICAgICAgc2V0U3RhdHVzKFxuICAgICAgICAnXHUyNkEwIEVsIEV4Y2VsIG5vIHRpZW5lIGhvamEgXCJTQVJcIi4gSG9qYXMgZW5jb250cmFkYXM6ICcgKyB3Yi5TaGVldE5hbWVzLmpvaW4oJywgJyksXG4gICAgICAgICcjZGMyNjI2J1xuICAgICAgKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgY29uc3Qgc2hlZXQgPSB3Yi5TaGVldHNbc2FyTmFtZV07XG4gICAgY29uc3Qgcm93cyA9IFhMU1gudXRpbHMuc2hlZXRfdG9fanNvbihzaGVldCwgeyBoZWFkZXI6IDEsIGRlZnZhbDogJycsIHJhdzogdHJ1ZSB9KTtcbiAgICBzZXRTdGF0dXMoJ1BhcnNlYW5kbyAnICsgcm93cy5sZW5ndGggKyAnIGZpbGFzIGRlIGhvamEgXCInICsgc2FyTmFtZSArICdcIlx1MjAyNicpO1xuICAgIGNvbnN0IHBhcnNlZCA9IHdpbmRvdy5TYWxlc1BsYW5QYXJzZXIucGFyc2VTYWxlc1BsYW5TaGVldChyb3dzKTtcbiAgICBpZiAoIXBhcnNlZC5yb3dzLmxlbmd0aCkge1xuICAgICAgc2V0U3RhdHVzKCdcdTI2QTAgRXhjZWwgcGFyc2VhZG8gcGVybyBzaW4gU0tVcyB2XHUwMEUxbGlkb3MuJywgJyNkYzI2MjYnKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgY29uc3QgeWVhck1vbnRoID0gX3llYXJNb250aE5vdygpO1xuICAgIGNvbnN0IHN0b3JhZ2VQYXRoID0gJ2ZvcmVjYXN0c19zbmFwc2hvdHMvJyArIHllYXJNb250aCArICcvJyArIGZhbWlsaWEgKyAnLnhsc3gnO1xuICAgIHNldFN0YXR1cygnU3ViaWVuZG8gRXhjZWwgYSBTdG9yYWdlICgnICsgX2ZtdFNpemUoZmlsZS5zaXplKSArICcpXHUyMDI2Jyk7XG4gICAgY29uc3Qgc3RvcmFnZVJlZiA9IHdpbmRvdy5maXJlYmFzZS5zdG9yYWdlKCkucmVmKHN0b3JhZ2VQYXRoKTtcbiAgICBhd2FpdCBzdG9yYWdlUmVmLnB1dChmaWxlLCB7XG4gICAgICBjb250ZW50VHlwZTogZmlsZS50eXBlIHx8ICdhcHBsaWNhdGlvbi92bmQub3BlbnhtbGZvcm1hdHMtb2ZmaWNlZG9jdW1lbnQuc3ByZWFkc2hlZXRtbC5zaGVldCcsXG4gICAgICBjdXN0b21NZXRhZGF0YToge1xuICAgICAgICBmYW1pbGlhLFxuICAgICAgICB1cGxvYWRlZEJ5OiAod2luZG93LmN1cnJlbnRVc2VyICYmIHdpbmRvdy5jdXJyZW50VXNlci5lbWFpbCkgfHwgJycsXG4gICAgICAgIHNvdXJjZUZpbGVuYW1lOiBmaWxlLm5hbWUgfHwgJycsXG4gICAgICB9LFxuICAgIH0pO1xuICAgIHNldFN0YXR1cygnR3VhcmRhbmRvIHBhcnNlbyBlbiBGaXJlc3RvcmUgKCcgKyBwYXJzZWQucm93cy5sZW5ndGggKyAnIFNLVXMpXHUyMDI2Jyk7XG4gICAgY29uc3QgdXBsb2FkZWRCeSA9ICh3aW5kb3cuY3VycmVudFVzZXIgJiYgd2luZG93LmN1cnJlbnRVc2VyLmVtYWlsKSB8fCAndW5rbm93bic7XG4gICAgY29uc3QgcGF5bG9hZCA9IHtcbiAgICAgIGZhbWlsaWEsXG4gICAgICBwYXJzZWRBdDpcbiAgICAgICAgd2luZG93LmZpcmViYXNlICYmIHdpbmRvdy5maXJlYmFzZS5maXJlc3RvcmUgJiYgd2luZG93LmZpcmViYXNlLmZpcmVzdG9yZS5GaWVsZFZhbHVlXG4gICAgICAgICAgPyB3aW5kb3cuZmlyZWJhc2UuZmlyZXN0b3JlLkZpZWxkVmFsdWUuc2VydmVyVGltZXN0YW1wKClcbiAgICAgICAgICA6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICAgIHVwbG9hZGVkQnksXG4gICAgICBzb3VyY2VGaWxlbmFtZTogZmlsZS5uYW1lIHx8ICcnLFxuICAgICAgc291cmNlU2hlZXQ6IHNhck5hbWUsXG4gICAgICB5ZWFyTW9udGgsXG4gICAgICBzdG9yYWdlUGF0aCxcbiAgICAgIHJvd3NDb3VudDogcGFyc2VkLnJvd3MubGVuZ3RoLFxuICAgICAgaGVhZGVyUm93SW5kZXg6IHBhcnNlZC5oZWFkZXJSb3dJbmRleCxcbiAgICAgIGRldGVjdGVkTW9udGhzOiBwYXJzZWQuZGV0ZWN0ZWRNb250aHMsXG4gICAgICByb3dzOiBwYXJzZWQucm93cyxcbiAgICB9O1xuICAgIGF3YWl0IHdpbmRvdy5mYkRiLmNvbGxlY3Rpb24oJ3NhbGVzX3BsYW5fY2FjaGUnKS5kb2MoZmFtaWxpYSkuc2V0KHBheWxvYWQpO1xuICAgIC8vIHYxMTA3IGZpeDogZ3VhcmRhciBjYWNoZSBsb2NhbCBjb24gRGF0ZSByZWFsIChubyBlbCBTZW50aW5lbFZhbHVlKSBwYXJhXG4gICAgLy8gcXVlIF9mbXREYXRlU2hvcnQgbm8gbXVlc3RyZSBcIkludmFsaWQgRGF0ZVwiLiBFbCBzZXJ2ZXIgdGllbmUgZWwgdHMgZXhhY3RvLFxuICAgIC8vIGVsIGxvY2FsIG11ZXN0cmEgZWwgbW9tZW50byBkZWwgdXBsb2FkIChhcHJveGltYWRvIH4xcyBkZSBkaWZlcmVuY2lhKS5cbiAgICBfc2FsZXNQbGFuQ2FjaGVzW2ZhbWlsaWFdID0gT2JqZWN0LmFzc2lnbih7fSwgcGF5bG9hZCwgeyBwYXJzZWRBdDogbmV3IERhdGUoKSB9KTtcbiAgICBzZXRTdGF0dXMoXG4gICAgICAnXHUyNzEzIE9LLiAnICsgcGFyc2VkLnJvd3MubGVuZ3RoICsgJyBTS1VzIFx1MDBENyAnICsgcGFyc2VkLmRldGVjdGVkTW9udGhzLmxlbmd0aCArICcgbWVzZXMuJyxcbiAgICAgICcjMTZhMzRhJ1xuICAgICk7XG4gICAgX3JlbmRlclNhbGVzUGxhbnNUYWIoKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGNvbnNvbGUuZXJyb3IoJ1tGT1JFQ0FTVF0gdXBsb2FkIHNhbGVzIHBsYW4gJyArIGZhbWlsaWEgKyAnIGZhaWw6JywgZSk7XG4gICAgc2V0U3RhdHVzKCdcdTI3MTcgRXJyb3I6ICcgKyAoKGUgJiYgZS5tZXNzYWdlKSB8fCBlKSwgJyNkYzI2MjYnKTtcbiAgICBpZiAoZSAmJiBlLmNvZGUgPT09ICdNT05USFNfTk9UX0ZPVU5EJykge1xuICAgICAgYWxlcnQoXG4gICAgICAgICdFbCBFeGNlbCBubyB0aWVuZSBjb2x1bW5hcyBkZSBtZXNlcyByZWNvbm9jaWJsZXMuXFxuXFxuSGVhZGVycyBlc3BlcmFkb3M6IFwiSmFuIDIwMjdcIiwgXCJNYXkgMjAyN1wiLCBcIkVuZSAyMDI3XCIsIFwiMjAyNy0wMVwiLCBldGMuXFxuXFxuRGV0YWxsZTogJyArXG4gICAgICAgICAgZS5tZXNzYWdlXG4gICAgICApO1xuICAgIH1cbiAgfSBmaW5hbGx5IHtcbiAgICBpZiAoZXZlbnQgJiYgZXZlbnQudGFyZ2V0KSBldmVudC50YXJnZXQudmFsdWUgPSAnJztcbiAgfVxufTtcblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBGMkIgXHUyMDE0IEZvcmVjYXN0IEVzdGFkXHUwMEVEc3RpY286IHRhYmxhICsgZGV0YWxsZVxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmFzeW5jIGZ1bmN0aW9uIF9sb2FkRm9yZWNhc3RPdXRwdXQoKSB7XG4gIGlmICghd2luZG93LmZiRGIpIHRocm93IG5ldyBFcnJvcignRmlyZXN0b3JlIG5vIGluaWNpYWxpemFkbycpO1xuICBjb25zb2xlLmxvZygnW0ZPUkVDQVNUIHN0YXRdIGxvYWRpbmcgZm9yZWNhc3Rfb3V0cHV0Li4uJyk7XG4gIGNvbnN0IFtzbmFwLCBtZXRhRG9jXSA9IGF3YWl0IFByb21pc2UuYWxsKFtcbiAgICB3aW5kb3cuZmJEYi5jb2xsZWN0aW9uKCdmb3JlY2FzdF9vdXRwdXQnKS5nZXQoKSxcbiAgICB3aW5kb3cuZmJEYi5jb2xsZWN0aW9uKCdmb3JlY2FzdF9vdXRwdXRfbWV0YScpLmRvYygnY3VycmVudCcpLmdldCgpLFxuICBdKTtcbiAgY29uc3QgZG9jcyA9IFtdO1xuICBzbmFwLmZvckVhY2goKGQpID0+IGRvY3MucHVzaChPYmplY3QuYXNzaWduKHsgaWQ6IGQuaWQgfSwgZC5kYXRhKCkpKSk7XG4gIGRvY3Muc29ydCgoYSwgYikgPT4ge1xuICAgIGNvbnN0IHdhID0gKGEubWV0cmljcyAmJiBhLm1ldHJpY3Mud2FwZSkgfHwgOTk5O1xuICAgIGNvbnN0IHdiID0gKGIubWV0cmljcyAmJiBiLm1ldHJpY3Mud2FwZSkgfHwgOTk5O1xuICAgIHJldHVybiB3YSAtIHdiO1xuICB9KTtcbiAgX2ZvcmVjYXN0U3RhdERvY3MgPSBkb2NzO1xuICBfZm9yZWNhc3RTdGF0TWV0YSA9IG1ldGFEb2MuZXhpc3RzID8gbWV0YURvYy5kYXRhKCkgOiBudWxsO1xuICBjb25zb2xlLmxvZygnW0ZPUkVDQVNUIHN0YXRdIGxvYWRlZCcsIGRvY3MubGVuZ3RoLCAnZG9jcyBcdTAwQjcgbWV0YTonLCAhIV9mb3JlY2FzdFN0YXRNZXRhKTtcbiAgcmV0dXJuIGRvY3M7XG59XG5cbmZ1bmN0aW9uIF93YXBlQmFkZ2VDb2xvcih3KSB7XG4gIGlmICh3ID09IG51bGwpIHJldHVybiAnIzY0NzQ4Yic7XG4gIGlmICh3IDwgMC4zKSByZXR1cm4gJyMxNmEzNGEnOyAvLyB2ZXJkZSAtIGV4Y2VsZW50ZVxuICBpZiAodyA8IDAuNSkgcmV0dXJuICcjODRjYzE2JzsgLy8gbGltYSAtIGJ1ZW5vXG4gIGlmICh3IDwgMC43KSByZXR1cm4gJyNlYWIzMDgnOyAvLyBhbWFyaWxsbyAtIGFjZXB0YWJsZVxuICBpZiAodyA8IDEuMCkgcmV0dXJuICcjZjk3MzE2JzsgLy8gbmFyYW5qYSAtIHBvYnJlXG4gIHJldHVybiAnI2RjMjYyNic7IC8vIHJvam8gLSBtdXkgcG9icmVcbn1cblxuZnVuY3Rpb24gX2ZtdE51bShuKSB7XG4gIGlmIChuID09IG51bGwgfHwgIU51bWJlci5pc0Zpbml0ZShOdW1iZXIobikpKSByZXR1cm4gJ1x1MjAxNCc7XG4gIHJldHVybiBOdW1iZXIobikudG9Mb2NhbGVTdHJpbmcoJ2VzLUFSJywgeyBtYXhpbXVtRnJhY3Rpb25EaWdpdHM6IDAgfSk7XG59XG5cbmZ1bmN0aW9uIF9mbXRXYXBlKHcpIHtcbiAgaWYgKHcgPT0gbnVsbCB8fCAhTnVtYmVyLmlzRmluaXRlKE51bWJlcih3KSkpIHJldHVybiAnXHUyMDE0JztcbiAgcmV0dXJuIChOdW1iZXIodykgKiAxMDApLnRvRml4ZWQoMCkgKyAnJSc7XG59XG5cbmZ1bmN0aW9uIF9mbXREc1Nob3J0KGlzbykge1xuICAvLyAnMjAyNi0xMC0wMScgLT4gJ29jdCAyNidcbiAgdHJ5IHtcbiAgICBjb25zdCBbeSwgbV0gPSBpc28uc3BsaXQoJy0nKS5tYXAoTnVtYmVyKTtcbiAgICBjb25zdCBuYW1lcyA9IFtcbiAgICAgICdlbmUnLFxuICAgICAgJ2ZlYicsXG4gICAgICAnbWFyJyxcbiAgICAgICdhYnInLFxuICAgICAgJ21heScsXG4gICAgICAnanVuJyxcbiAgICAgICdqdWwnLFxuICAgICAgJ2FnbycsXG4gICAgICAnc2VwJyxcbiAgICAgICdvY3QnLFxuICAgICAgJ25vdicsXG4gICAgICAnZGljJyxcbiAgICBdO1xuICAgIHJldHVybiBuYW1lc1ttIC0gMV0gKyAnICcgKyBTdHJpbmcoeSkuc2xpY2UoLTIpO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gaXNvO1xuICB9XG59XG5cbmZ1bmN0aW9uIF9yZW5kZXJGb3JlY2FzdFN0YXRUYWIoKSB7XG4gIGNvbnN0IGNvbnQgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZm9yZWNhc3QtdGFiLXN0YXQnKTtcbiAgaWYgKCFjb250KSByZXR1cm47XG4gIHRyeSB7XG4gICAgX3JlbmRlckZvcmVjYXN0U3RhdFRhYkltcGwoY29udCk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBjb25zb2xlLmVycm9yKCdbRk9SRUNBU1Qgc3RhdF0gcmVuZGVyIGZhaWwnLCBlKTtcbiAgICBjb250LmlubmVySFRNTCA9XG4gICAgICAnPGRpdiBzdHlsZT1cInBhZGRpbmc6NDBweCAyMHB4O2NvbG9yOiNkYzI2MjY7bGluZS1oZWlnaHQ6MS42XCI+JyArXG4gICAgICAnPGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxNnB4O2ZvbnQtd2VpZ2h0OjcwMDttYXJnaW4tYm90dG9tOjEwcHhcIj5FcnJvciByZW5kZXJpemFuZG8gdGFiIEZvcmVjYXN0IEVzdGFkXHUwMEVEc3RpY288L2Rpdj4nICtcbiAgICAgICc8cHJlIHN0eWxlPVwiZm9udC1zaXplOjExcHg7YmFja2dyb3VuZDojZmVmMmYyO3BhZGRpbmc6MTJweDtib3JkZXItcmFkaXVzOjZweDtvdmVyZmxvdzphdXRvO3doaXRlLXNwYWNlOnByZS13cmFwXCI+JyArXG4gICAgICBlc2NhcGVIdG1sU2FmZShlLnN0YWNrIHx8IGUubWVzc2FnZSB8fCBTdHJpbmcoZSkpICtcbiAgICAgICc8L3ByZT48L2Rpdj4nO1xuICB9XG59XG5cbmZ1bmN0aW9uIF9yZW5kZXJGb3JlY2FzdFN0YXRUYWJJbXBsKGNvbnQpIHtcbiAgY29uc3QgZG9jcyA9IF9mb3JlY2FzdFN0YXREb2NzIHx8IFtdO1xuICBjb25zdCBtZXRhID0gX2ZvcmVjYXN0U3RhdE1ldGEgfHwge307XG4gIGNvbnN0IHJlc3VtZW4gPSBtZXRhLnJlc3VtZW4gfHwge307XG4gIGNvbnNvbGUubG9nKCdbRk9SRUNBU1Qgc3RhdF0gcmVuZGVyIFx1MjAxNCBkb2NzOicsIGRvY3MubGVuZ3RoLCAnbWV0YTonLCAhIW1ldGEuZ2VuZXJhdGVkQXQpO1xuICBpZiAoIWRvY3MubGVuZ3RoKSB7XG4gICAgY29udC5pbm5lckhUTUwgPVxuICAgICAgJzxkaXYgc3R5bGU9XCJwYWRkaW5nOjYwcHggMjBweDt0ZXh0LWFsaWduOmNlbnRlcjtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKVwiPicgK1xuICAgICAgJ05vIGhheSBmb3JlY2FzdF9vdXRwdXQgcHVibGljYWRvLjxicj48YnI+JyArXG4gICAgICAnQ29ycmVyIDxjb2RlPnB5dGhvbiBzY3JpcHRzL2ZvcmVjYXN0L3RyYWluX3Byb2QucHkgJiYgcHl0aG9uIHNjcmlwdHMvZm9yZWNhc3QvcHVibGlzaF90b19maXJlc3RvcmUucHk8L2NvZGU+LicgK1xuICAgICAgJzwvZGl2Pic7XG4gICAgcmV0dXJuO1xuICB9XG4gIC8vIE1lc2VzIGRlbCBmb3JlY2FzdCAoZHMgZGVsIHByaW1lciBkb2MsIHNlIGFzdW1lIGlndWFsIGVuIHRvZG9zKS5cbiAgY29uc3QgbW9udGhzSXNvID0gKGRvY3NbMF0uZm9yZWNhc3QgfHwgW10pLm1hcCgoZikgPT4gZi5kcyk7XG4gIGNvbnN0IG1vbnRoSGVhZGVycyA9IG1vbnRoc0lzby5tYXAoX2ZtdERzU2hvcnQpO1xuXG4gIC8vIE1ldHJpY3MgY2hpcCBnbG9iYWxcbiAgY29uc3QgZ2VuZXJhdGVkID0gbWV0YS5nZW5lcmF0ZWRBdFxuICAgID8gbmV3IERhdGUobWV0YS5nZW5lcmF0ZWRBdCkudG9Mb2NhbGVTdHJpbmcoJ2VzLUFSJywge1xuICAgICAgICBkYXk6ICcyLWRpZ2l0JyxcbiAgICAgICAgbW9udGg6ICdzaG9ydCcsXG4gICAgICAgIHllYXI6ICcyLWRpZ2l0JyxcbiAgICAgICAgaG91cjogJzItZGlnaXQnLFxuICAgICAgICBtaW51dGU6ICcyLWRpZ2l0JyxcbiAgICAgIH0pXG4gICAgOiAnXHUyMDE0JztcbiAgY29uc3Qgd2FwZU1lZCA9XG4gICAgcmVzdW1lbi53YXBlX21lZGlhbm9fYmVzdF9wZXJfc2VyaWVzICE9IG51bGxcbiAgICAgID8gX2ZtdFdhcGUocmVzdW1lbi53YXBlX21lZGlhbm9fYmVzdF9wZXJfc2VyaWVzKVxuICAgICAgOiAnXHUyMDE0JztcbiAgY29uc3QgblN1YnMgPSByZXN1bWVuLm5fc3ViZmFtaWxpYXMgfHwgZG9jcy5sZW5ndGg7XG4gIGNvbnN0IG5MdDA1ID1cbiAgICByZXN1bWVuLm5fc2VyaWVzX3dhcGVfbHRfMF81ICE9IG51bGwgPyByZXN1bWVuLm5fc2VyaWVzX3dhcGVfbHRfMF81ICsgJy8nICsgblN1YnMgOiAnXHUyMDE0JztcbiAgY29uc3Qgbkx0MDMgPVxuICAgIHJlc3VtZW4ubl9zZXJpZXNfd2FwZV9sdF8wXzMgIT0gbnVsbCA/IHJlc3VtZW4ubl9zZXJpZXNfd2FwZV9sdF8wXzMgKyAnLycgKyBuU3VicyA6ICdcdTIwMTQnO1xuXG4gIGNvbnN0IGJhbm5lciA9XG4gICAgJzxkaXYgc3R5bGU9XCJtYXJnaW4tYm90dG9tOjE0cHg7cGFkZGluZzoxMnB4IDE0cHg7YmFja2dyb3VuZDp2YXIoLS1iZy1zZWNvbmRhcnkpO2JvcmRlci1sZWZ0OjNweCBzb2xpZCAjMGQ5NDg4O2JvcmRlci1yYWRpdXM6NnB4O2ZvbnQtc2l6ZToxMnB4O2NvbG9yOnZhcigtLXRleHQtc2Vjb25kYXJ5KTtsaW5lLWhlaWdodDoxLjU7ZGlzcGxheTpncmlkO2dyaWQtdGVtcGxhdGUtY29sdW1uczpyZXBlYXQoYXV0by1maXQsbWlubWF4KDE2MHB4LDFmcikpO2dhcDoxMHB4XCI+JyArXG4gICAgJzxkaXY+PGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMHB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtsZXR0ZXItc3BhY2luZzouNHB4XCI+V0FQRSBtZWRpYW5vPC9kaXY+PGRpdiBzdHlsZT1cImZvbnQtc2l6ZToyMHB4O2ZvbnQtd2VpZ2h0OjgwMDtjb2xvcjp2YXIoLS10ZXh0LXByaW1hcnkpXCI+JyArXG4gICAgd2FwZU1lZCArXG4gICAgJzwvZGl2PjwvZGl2PicgK1xuICAgICc8ZGl2PjxkaXYgc3R5bGU9XCJmb250LXNpemU6MTBweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7bGV0dGVyLXNwYWNpbmc6LjRweFwiPlN1YmZhbWlsaWFzPC9kaXY+PGRpdiBzdHlsZT1cImZvbnQtc2l6ZToyMHB4O2ZvbnQtd2VpZ2h0OjgwMDtjb2xvcjp2YXIoLS10ZXh0LXByaW1hcnkpXCI+JyArXG4gICAgblN1YnMgK1xuICAgICc8L2Rpdj48L2Rpdj4nICtcbiAgICAnPGRpdj48ZGl2IHN0eWxlPVwiZm9udC1zaXplOjEwcHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO2xldHRlci1zcGFjaW5nOi40cHhcIj5XQVBFICZsdDsgMzAlIChleGNlbGVudGUpPC9kaXY+PGRpdiBzdHlsZT1cImZvbnQtc2l6ZToyMHB4O2ZvbnQtd2VpZ2h0OjgwMDtjb2xvcjojMTZhMzRhXCI+JyArXG4gICAgbkx0MDMgK1xuICAgICc8L2Rpdj48L2Rpdj4nICtcbiAgICAnPGRpdj48ZGl2IHN0eWxlPVwiZm9udC1zaXplOjEwcHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO2xldHRlci1zcGFjaW5nOi40cHhcIj5XQVBFICZsdDsgNTAlIChidWVubyk8L2Rpdj48ZGl2IHN0eWxlPVwiZm9udC1zaXplOjIwcHg7Zm9udC13ZWlnaHQ6ODAwO2NvbG9yOiM4NGNjMTZcIj4nICtcbiAgICBuTHQwNSArXG4gICAgJzwvZGl2PjwvZGl2PicgK1xuICAgICc8ZGl2PjxkaXYgc3R5bGU9XCJmb250LXNpemU6MTBweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7bGV0dGVyLXNwYWNpbmc6LjRweFwiPlx1MDBEQWx0aW1hIGNvcnJpZGE8L2Rpdj48ZGl2IHN0eWxlPVwiZm9udC1zaXplOjEzcHg7Zm9udC13ZWlnaHQ6NjAwO2NvbG9yOnZhcigtLXRleHQtcHJpbWFyeSk7bWFyZ2luLXRvcDo0cHhcIj4nICtcbiAgICBlc2NhcGVIdG1sU2FmZShnZW5lcmF0ZWQpICtcbiAgICAnPC9kaXY+PC9kaXY+JyArXG4gICAgJzwvZGl2Pic7XG5cbiAgLy8gVGFibGEgcm93c1xuICBjb25zdCByb3dzSHRtbCA9IGRvY3NcbiAgICAubWFwKChkKSA9PiB7XG4gICAgICBjb25zdCB3YXBlID0gZC5tZXRyaWNzICYmIGQubWV0cmljcy53YXBlICE9IG51bGwgPyBkLm1ldHJpY3Mud2FwZSA6IG51bGw7XG4gICAgICBjb25zdCBiZXN0TW9kZWwgPSBkLmJlc3RNb2RlbCB8fCAnXHUyMDE0JztcbiAgICAgIGNvbnN0IGZvcmVjYXN0TWFwID0ge307XG4gICAgICAoZC5mb3JlY2FzdCB8fCBbXSkuZm9yRWFjaCgoZikgPT4ge1xuICAgICAgICBmb3JlY2FzdE1hcFtmLmRzXSA9IGYueV9oYXQ7XG4gICAgICB9KTtcbiAgICAgIGNvbnN0IG1vbnRoQ2VsbHMgPSBtb250aHNJc29cbiAgICAgICAgLm1hcChcbiAgICAgICAgICAoZHMpID0+XG4gICAgICAgICAgICAnPHRkIHN0eWxlPVwicGFkZGluZzo4cHggMTBweDt0ZXh0LWFsaWduOnJpZ2h0O2ZvbnQtdmFyaWFudC1udW1lcmljOnRhYnVsYXItbnVtcztmb250LXdlaWdodDo2MDA7Y29sb3I6dmFyKC0tdGV4dC1wcmltYXJ5KVwiPicgK1xuICAgICAgICAgICAgX2ZtdE51bShmb3JlY2FzdE1hcFtkc10pICtcbiAgICAgICAgICAgICc8L3RkPidcbiAgICAgICAgKVxuICAgICAgICAuam9pbignJyk7XG4gICAgICBjb25zdCB0b3RhbDcgPSAoZC5mb3JlY2FzdCB8fCBbXSkucmVkdWNlKChzLCBmKSA9PiBzICsgKE51bWJlcihmLnlfaGF0KSB8fCAwKSwgMCk7XG4gICAgICByZXR1cm4gKFxuICAgICAgICAnPHRyIG9uY2xpY2s9XCJvcGVuRm9yZWNhc3RTdGF0RGV0YWlsKFxcJycgK1xuICAgICAgICBlc2NhcGVIdG1sU2FmZShkLmlkKSArXG4gICAgICAgICdcXCcpXCIgc3R5bGU9XCJjdXJzb3I6cG9pbnRlcjtib3JkZXItYm90dG9tOjFweCBzb2xpZCB2YXIoLS1ib3JkZXItc3VidGxlKVwiIG9ubW91c2VvdmVyPVwidGhpcy5zdHlsZS5iYWNrZ3JvdW5kPVxcJ3ZhcigtLWJnLXNlY29uZGFyeSlcXCdcIiBvbm1vdXNlb3V0PVwidGhpcy5zdHlsZS5iYWNrZ3JvdW5kPVxcJ3RyYW5zcGFyZW50XFwnXCI+JyArXG4gICAgICAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjhweCAxMHB4O2ZvbnQtd2VpZ2h0OjcwMDtjb2xvcjp2YXIoLS10ZXh0LXByaW1hcnkpXCI+JyArXG4gICAgICAgIGVzY2FwZUh0bWxTYWZlKGQuc3ViZmFtaWxpYSB8fCBkLmlkKSArXG4gICAgICAgICc8L3RkPicgK1xuICAgICAgICAnPHRkIHN0eWxlPVwicGFkZGluZzo4cHggMTBweDtmb250LXNpemU6MTFweDtjb2xvcjp2YXIoLS10ZXh0LXNlY29uZGFyeSlcIj4nICtcbiAgICAgICAgZXNjYXBlSHRtbFNhZmUoYmVzdE1vZGVsKSArXG4gICAgICAgICc8L3RkPicgK1xuICAgICAgICAnPHRkIHN0eWxlPVwicGFkZGluZzo4cHggMTBweDt0ZXh0LWFsaWduOmNlbnRlclwiPjxzcGFuIHN0eWxlPVwiZGlzcGxheTppbmxpbmUtYmxvY2s7cGFkZGluZzozcHggOHB4O2JvcmRlci1yYWRpdXM6MTJweDtiYWNrZ3JvdW5kOicgK1xuICAgICAgICBfd2FwZUJhZGdlQ29sb3Iod2FwZSkgK1xuICAgICAgICAnO2NvbG9yOiNmZmY7Zm9udC1zaXplOjExcHg7Zm9udC13ZWlnaHQ6NzAwXCI+JyArXG4gICAgICAgIF9mbXRXYXBlKHdhcGUpICtcbiAgICAgICAgJzwvc3Bhbj48L3RkPicgK1xuICAgICAgICBtb250aENlbGxzICtcbiAgICAgICAgJzx0ZCBzdHlsZT1cInBhZGRpbmc6OHB4IDEwcHg7dGV4dC1hbGlnbjpyaWdodDtmb250LXZhcmlhbnQtbnVtZXJpYzp0YWJ1bGFyLW51bXM7Zm9udC13ZWlnaHQ6NzAwO2NvbG9yOiMwZDk0ODg7YmFja2dyb3VuZDp2YXIoLS1iZy1zZWNvbmRhcnkpXCI+JyArXG4gICAgICAgIF9mbXROdW0odG90YWw3KSArXG4gICAgICAgICc8L3RkPicgK1xuICAgICAgICAnPC90cj4nXG4gICAgICApO1xuICAgIH0pXG4gICAgLmpvaW4oJycpO1xuXG4gIGNvbnN0IG1vbnRoSGVhZGVyc0h0bWwgPSBtb250aEhlYWRlcnNcbiAgICAubWFwKFxuICAgICAgKG0pID0+XG4gICAgICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjhweCAxMHB4O3RleHQtYWxpZ246cmlnaHQ7Zm9udC1zaXplOjEwcHg7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO2xldHRlci1zcGFjaW5nOi40cHg7Y29sb3I6Izk0YTNiOFwiPicgK1xuICAgICAgICBlc2NhcGVIdG1sU2FmZShtKSArXG4gICAgICAgICc8L3RoPidcbiAgICApXG4gICAgLmpvaW4oJycpO1xuXG4gIGNvbnN0IHRhYmxlID1cbiAgICAnPGRpdiBzdHlsZT1cIm92ZXJmbG93OmF1dG87Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1ib3JkZXItc3VidGxlKTtib3JkZXItcmFkaXVzOjhweFwiPicgK1xuICAgICc8dGFibGUgc3R5bGU9XCJ3aWR0aDoxMDAlO2JvcmRlci1jb2xsYXBzZTpjb2xsYXBzZTtmb250LXNpemU6MTJweFwiPicgK1xuICAgICc8dGhlYWQgc3R5bGU9XCJiYWNrZ3JvdW5kOiMwZjE3MmE7Y29sb3I6I2ZmZlwiPjx0cj4nICtcbiAgICAnPHRoIHN0eWxlPVwicGFkZGluZzo4cHggMTBweDt0ZXh0LWFsaWduOmxlZnQ7Zm9udC1zaXplOjEwcHg7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO2xldHRlci1zcGFjaW5nOi40cHhcIj5TdWJmYW1pbGlhPC90aD4nICtcbiAgICAnPHRoIHN0eWxlPVwicGFkZGluZzo4cHggMTBweDt0ZXh0LWFsaWduOmxlZnQ7Zm9udC1zaXplOjEwcHg7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO2xldHRlci1zcGFjaW5nOi40cHhcIj5Nb2RlbG88L3RoPicgK1xuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjhweCAxMHB4O3RleHQtYWxpZ246Y2VudGVyO2ZvbnQtc2l6ZToxMHB4O3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtsZXR0ZXItc3BhY2luZzouNHB4XCI+V0FQRTwvdGg+JyArXG4gICAgbW9udGhIZWFkZXJzSHRtbCArXG4gICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6OHB4IDEwcHg7dGV4dC1hbGlnbjpyaWdodDtmb250LXNpemU6MTBweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7bGV0dGVyLXNwYWNpbmc6LjRweDtiYWNrZ3JvdW5kOiMxMzRlNGFcIj5Ub3RhbCA3bTwvdGg+JyArXG4gICAgJzwvdHI+PC90aGVhZD4nICtcbiAgICAnPHRib2R5PicgK1xuICAgIHJvd3NIdG1sICtcbiAgICAnPC90Ym9keT48L3RhYmxlPjwvZGl2Pic7XG5cbiAgY29uc3QgZm9vdGVyID1cbiAgICAnPGRpdiBzdHlsZT1cIm1hcmdpbi10b3A6MTJweDtmb250LXNpemU6MTFweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTtsaW5lLWhlaWdodDoxLjVcIj4nICtcbiAgICAnPGI+Q1x1MDBGM21vIGxlZXI8L2I+OiBXQVBFIChXZWlnaHRlZCBBYnNvbHV0ZSBQZXJjZW50YWdlIEVycm9yKSBtaWRlIGVsIGVycm9yIGRlbCBtb2RlbG8gcmVsYXRpdm8gYWwgdG90YWwgcmVhbDogJmx0OzMwJSBleGNlbGVudGUsIDMwLTUwJSBidWVubywgNTAtNzAlIGFjZXB0YWJsZSwgJmd0OzcwJSBwb2JyZS4gQ2xpY2sgZW4gZmlsYSBwYXJhIGRldGFsbGUgKyBnclx1MDBFMWZpY28uICcgK1xuICAgICdTZSBlbGlnZSBlbCBtb2RlbG8gY29uIG1lbm9yIFdBUEUgcG9yIHNlcmllIHRyYXMgYmFja3Rlc3Qgcm9sbGluZy1vcmlnaW4gKGg9MiwgdmVudGFuYXM9MykuJyArXG4gICAgJzwvZGl2Pic7XG5cbiAgY29udC5pbm5lckhUTUwgPSAnPGRpdiBzdHlsZT1cInBhZGRpbmc6MThweFwiPicgKyBiYW5uZXIgKyB0YWJsZSArIGZvb3RlciArICc8L2Rpdj4nO1xufVxuXG4vLyBDYWNoZSBoaXN0b3JpYSBhZ3JlZ2FkYSBwb3Igc3ViZmFtaWxpYSAocGFyYSBnclx1MDBFMWZpY28gZGV0YWxsZSkuXG5hc3luYyBmdW5jdGlvbiBfbG9hZEZvcmVjYXN0U3RhdEhpc3RvcnkoKSB7XG4gIGlmIChfZm9yZWNhc3RTdGF0SGlzdG9yeUNhY2hlKSByZXR1cm4gX2ZvcmVjYXN0U3RhdEhpc3RvcnlDYWNoZTtcbiAgLy8gTGEgaGlzdG9yaWEgc29sbyBlc3RcdTAwRTEgZW4gQlEgKH4xMCBhXHUwMEYxb3MgQmFyYWxkbyArIDEyIG1lc2VzIFNoaW1hbm8pLiBDb21vXG4gIC8vIGVsIHBpcGVsaW5lIGxhIGVzY3JpYmUgYSBDU1YgbG9jYWwsIGFjXHUwMEUxIG5vIGxhIHBvZGVtb3MgbGVlci4gQWx0ZXJuYXRpdmE6XG4gIC8vIHVzYXIgc2t1X3ZlbnRhc19zbmFwc2hvdCBxdWUgdGllbmUgdmVudGFzIG1lbnN1YWxlcyBwZXJvIHNvbG8gZ3J1cG8gUEVTQ0EuXG4gIC8vIEVuIEYyQi4yIHNvbG8gbW9zdHJhbW9zIGZvcmVjYXN0K0lDIChzaW4gb3ZlcmxheSBoaXN0b3JpYSBwb3IgYWhvcmEpLlxuICBfZm9yZWNhc3RTdGF0SGlzdG9yeUNhY2hlID0ge307XG4gIHJldHVybiBfZm9yZWNhc3RTdGF0SGlzdG9yeUNhY2hlO1xufVxuXG5mdW5jdGlvbiBfYnVpbGRGb3JlY2FzdENoYXJ0U3ZnKGRvYykge1xuICBjb25zdCBmYyA9IGRvYy5mb3JlY2FzdCB8fCBbXTtcbiAgaWYgKCFmYy5sZW5ndGgpXG4gICAgcmV0dXJuICc8ZGl2IHN0eWxlPVwicGFkZGluZzozMHB4O3RleHQtYWxpZ246Y2VudGVyO2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpXCI+U2luIGRhdG9zIGRlIGZvcmVjYXN0PC9kaXY+JztcbiAgLy8gRGltZW5zaW9uZXNcbiAgY29uc3QgVyA9IDY0MCxcbiAgICBIID0gMjYwO1xuICBjb25zdCBwYWRMID0gNTAsXG4gICAgcGFkUiA9IDIwLFxuICAgIHBhZFQgPSAyMCxcbiAgICBwYWRCID0gNDA7XG4gIGNvbnN0IGlubmVyVyA9IFcgLSBwYWRMIC0gcGFkUjtcbiAgY29uc3QgaW5uZXJIID0gSCAtIHBhZFQgLSBwYWRCO1xuXG4gIC8vIFkgcmFuZ2U6IG1heChoaTgwKSAqIDEuMVxuICBjb25zdCBtYXhZID0gTWF0aC5tYXgoMSwgLi4uZmMubWFwKChmKSA9PiBOdW1iZXIoZi5oaTgwKSB8fCBOdW1iZXIoZi55X2hhdCkgfHwgMCkpO1xuICBjb25zdCBtaW5ZID0gMDtcbiAgY29uc3Qgc2NhbGVYID0gKGkpID0+IHBhZEwgKyAoaW5uZXJXICogaSkgLyBNYXRoLm1heCgxLCBmYy5sZW5ndGggLSAxKTtcbiAgY29uc3Qgc2NhbGVZID0gKHYpID0+IHBhZFQgKyBpbm5lckggLSAoaW5uZXJIICogKHYgLSBtaW5ZKSkgLyAobWF4WSAtIG1pblkpO1xuXG4gIC8vIEdyaWQgKyBlamUgWVxuICBjb25zdCB5VGlja3MgPSBbMCwgMC4yNSwgMC41LCAwLjc1LCAxXVxuICAgIC5tYXAoKHIpID0+IHtcbiAgICAgIGNvbnN0IHZhbCA9IG1pblkgKyByICogKG1heFkgLSBtaW5ZKTtcbiAgICAgIGNvbnN0IHl5ID0gc2NhbGVZKHZhbCk7XG4gICAgICByZXR1cm4gKFxuICAgICAgICAnPGxpbmUgeDE9XCInICtcbiAgICAgICAgcGFkTCArXG4gICAgICAgICdcIiB5MT1cIicgK1xuICAgICAgICB5eSArXG4gICAgICAgICdcIiB4Mj1cIicgK1xuICAgICAgICAoVyAtIHBhZFIpICtcbiAgICAgICAgJ1wiIHkyPVwiJyArXG4gICAgICAgIHl5ICtcbiAgICAgICAgJ1wiIHN0cm9rZT1cIiNlMmU4ZjBcIiBzdHJva2Utd2lkdGg9XCIxXCIvPicgK1xuICAgICAgICAnPHRleHQgeD1cIicgK1xuICAgICAgICAocGFkTCAtIDYpICtcbiAgICAgICAgJ1wiIHk9XCInICtcbiAgICAgICAgKHl5ICsgNCkgK1xuICAgICAgICAnXCIgdGV4dC1hbmNob3I9XCJlbmRcIiBmb250LXNpemU9XCIxMFwiIGZpbGw9XCIjNjQ3NDhiXCI+JyArXG4gICAgICAgIF9mbXROdW0odmFsKSArXG4gICAgICAgICc8L3RleHQ+J1xuICAgICAgKTtcbiAgICB9KVxuICAgIC5qb2luKCcnKTtcblxuICAvLyBFamUgWCAobWVzZXMpXG4gIGNvbnN0IHhMYWJlbHMgPSBmY1xuICAgIC5tYXAoKGYsIGkpID0+IHtcbiAgICAgIGNvbnN0IHh4ID0gc2NhbGVYKGkpO1xuICAgICAgcmV0dXJuIChcbiAgICAgICAgJzx0ZXh0IHg9XCInICtcbiAgICAgICAgeHggK1xuICAgICAgICAnXCIgeT1cIicgK1xuICAgICAgICAoSCAtIHBhZEIgKyAxNSkgK1xuICAgICAgICAnXCIgdGV4dC1hbmNob3I9XCJtaWRkbGVcIiBmb250LXNpemU9XCIxMFwiIGZpbGw9XCIjNjQ3NDhiXCI+JyArXG4gICAgICAgIF9mbXREc1Nob3J0KGYuZHMpICtcbiAgICAgICAgJzwvdGV4dD4nXG4gICAgICApO1xuICAgIH0pXG4gICAgLmpvaW4oJycpO1xuXG4gIC8vIEludGVydmFsbyBjb25maWFuemEgKGJhbmQpXG4gIGNvbnN0IGJhbmRQb2ludHMgPVxuICAgIGZjLm1hcCgoZiwgaSkgPT4gc2NhbGVYKGkpICsgJywnICsgc2NhbGVZKE51bWJlcihmLmhpODApIHx8IDApKS5qb2luKCcgJykgK1xuICAgICcgJyArXG4gICAgZmNcbiAgICAgIC5zbGljZSgpXG4gICAgICAucmV2ZXJzZSgpXG4gICAgICAubWFwKChmLCBpKSA9PiBzY2FsZVgoZmMubGVuZ3RoIC0gMSAtIGkpICsgJywnICsgc2NhbGVZKE51bWJlcihmLmxvODApIHx8IDApKVxuICAgICAgLmpvaW4oJyAnKTtcbiAgY29uc3QgYmFuZCA9ICc8cG9seWdvbiBwb2ludHM9XCInICsgYmFuZFBvaW50cyArICdcIiBmaWxsPVwiIzBkOTQ4ODMzXCIgc3Ryb2tlPVwibm9uZVwiLz4nO1xuXG4gIC8vIExpbmUgZm9yZWNhc3QgKyBwdW50b3NcbiAgY29uc3QgbGluZVBvaW50cyA9IGZjLm1hcCgoZiwgaSkgPT4gc2NhbGVYKGkpICsgJywnICsgc2NhbGVZKE51bWJlcihmLnlfaGF0KSB8fCAwKSkuam9pbignICcpO1xuICBjb25zdCBsaW5lID1cbiAgICAnPHBvbHlsaW5lIHBvaW50cz1cIicgK1xuICAgIGxpbmVQb2ludHMgK1xuICAgICdcIiBmaWxsPVwibm9uZVwiIHN0cm9rZT1cIiMwZDk0ODhcIiBzdHJva2Utd2lkdGg9XCIyLjVcIiBzdHJva2UtbGluZWpvaW49XCJyb3VuZFwiLz4nO1xuICBjb25zdCBwb2ludHMgPSBmY1xuICAgIC5tYXAoXG4gICAgICAoZiwgaSkgPT5cbiAgICAgICAgJzxjaXJjbGUgY3g9XCInICtcbiAgICAgICAgc2NhbGVYKGkpICtcbiAgICAgICAgJ1wiIGN5PVwiJyArXG4gICAgICAgIHNjYWxlWShOdW1iZXIoZi55X2hhdCkgfHwgMCkgK1xuICAgICAgICAnXCIgcj1cIjRcIiBmaWxsPVwiIzBkOTQ4OFwiIHN0cm9rZT1cIiNmZmZcIiBzdHJva2Utd2lkdGg9XCIyXCIvPidcbiAgICApXG4gICAgLmpvaW4oJycpO1xuICAvLyBMYWJlbHMgZGUgdmFsb3JcbiAgY29uc3QgdmFsdWVMYWJlbHMgPSBmY1xuICAgIC5tYXAoKGYsIGkpID0+IHtcbiAgICAgIGNvbnN0IHh4ID0gc2NhbGVYKGkpO1xuICAgICAgY29uc3QgeXkgPSBzY2FsZVkoTnVtYmVyKGYueV9oYXQpIHx8IDApO1xuICAgICAgcmV0dXJuIChcbiAgICAgICAgJzx0ZXh0IHg9XCInICtcbiAgICAgICAgeHggK1xuICAgICAgICAnXCIgeT1cIicgK1xuICAgICAgICAoeXkgLSA4KSArXG4gICAgICAgICdcIiB0ZXh0LWFuY2hvcj1cIm1pZGRsZVwiIGZvbnQtc2l6ZT1cIjEwXCIgZm9udC13ZWlnaHQ9XCI3MDBcIiBmaWxsPVwiIzBmNzY2ZVwiPicgK1xuICAgICAgICBfZm10TnVtKGYueV9oYXQpICtcbiAgICAgICAgJzwvdGV4dD4nXG4gICAgICApO1xuICAgIH0pXG4gICAgLmpvaW4oJycpO1xuXG4gIGNvbnN0IHN2ZyA9XG4gICAgJzxzdmcgdmlld0JveD1cIjAgMCAnICtcbiAgICBXICtcbiAgICAnICcgK1xuICAgIEggK1xuICAgICdcIiBzdHlsZT1cIndpZHRoOjEwMCU7bWF4LXdpZHRoOjgwMHB4O2hlaWdodDphdXRvXCI+JyArXG4gICAgJzxyZWN0IHg9XCIwXCIgeT1cIjBcIiB3aWR0aD1cIicgK1xuICAgIFcgK1xuICAgICdcIiBoZWlnaHQ9XCInICtcbiAgICBIICtcbiAgICAnXCIgZmlsbD1cIiNmZmZcIi8+JyArXG4gICAgeVRpY2tzICtcbiAgICB4TGFiZWxzICtcbiAgICBiYW5kICtcbiAgICBsaW5lICtcbiAgICBwb2ludHMgK1xuICAgIHZhbHVlTGFiZWxzICtcbiAgICAnPC9zdmc+JztcbiAgcmV0dXJuIHN2Zztcbn1cblxud2luZG93Lm9wZW5Gb3JlY2FzdFN0YXREZXRhaWwgPSBmdW5jdGlvbiAoc3ViSWQpIHtcbiAgaWYgKCFfZm9yZWNhc3RTdGF0RG9jcykgcmV0dXJuO1xuICBjb25zdCBkb2MgPSBfZm9yZWNhc3RTdGF0RG9jcy5maW5kKChkKSA9PiBkLmlkID09PSBzdWJJZCk7XG4gIGlmICghZG9jKSB7XG4gICAgYWxlcnQoJ05vIHNlIGVuY29udHJcdTAwRjMgZGV0YWxsZSBkZSAnICsgc3ViSWQpO1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCBleGlzdGluZyA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdmb3JlY2FzdC1zdGF0LWRldGFpbCcpO1xuICBpZiAoZXhpc3RpbmcpIGV4aXN0aW5nLnJlbW92ZSgpO1xuXG4gIGNvbnN0IGVsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2Jyk7XG4gIGVsLmlkID0gJ2ZvcmVjYXN0LXN0YXQtZGV0YWlsJztcbiAgZWwuc3R5bGUuY3NzVGV4dCA9XG4gICAgJ3Bvc2l0aW9uOmZpeGVkO2luc2V0OjA7YmFja2dyb3VuZDpyZ2JhKDE1LDIzLDQyLC42NSk7ei1pbmRleDoyMTAwO2Rpc3BsYXk6ZmxleDthbGlnbi1pdGVtczpjZW50ZXI7anVzdGlmeS1jb250ZW50OmNlbnRlcjtwYWRkaW5nOjJ2aCc7XG4gIGVsLm9uY2xpY2sgPSAoZXYpID0+IHtcbiAgICBpZiAoZXYudGFyZ2V0ID09PSBlbCkgZWwucmVtb3ZlKCk7XG4gIH07XG5cbiAgY29uc3Qgd2FwZSA9IGRvYy5tZXRyaWNzICYmIGRvYy5tZXRyaWNzLndhcGU7XG4gIGNvbnN0IGJpYXMgPSBkb2MubWV0cmljcyAmJiBkb2MubWV0cmljcy5iaWFzO1xuICBjb25zdCBtYWUgPSBkb2MubWV0cmljcyAmJiBkb2MubWV0cmljcy5tYWU7XG4gIGNvbnN0IHJtc2UgPSBkb2MubWV0cmljcyAmJiBkb2MubWV0cmljcy5ybXNlO1xuICBjb25zdCBiZXN0TW9kZWwgPSBkb2MuYmVzdE1vZGVsIHx8ICdcdTIwMTQnO1xuICBjb25zdCB2ZXJzaW9uSWQgPSBkb2MudmVyc2lvbklkIHx8ICdcdTIwMTQnO1xuICBjb25zdCBzdmdIdG1sID0gX2J1aWxkRm9yZWNhc3RDaGFydFN2Zyhkb2MpO1xuXG4gIGNvbnN0IG1ldHJpY3NIdG1sID1cbiAgICAnPGRpdiBzdHlsZT1cImRpc3BsYXk6Z3JpZDtncmlkLXRlbXBsYXRlLWNvbHVtbnM6cmVwZWF0KGF1dG8tZml0LG1pbm1heCgxMjBweCwxZnIpKTtnYXA6MTBweDttYXJnaW46MTRweCAwXCI+JyArXG4gICAgJzxkaXYgc3R5bGU9XCJwYWRkaW5nOjEwcHg7YmFja2dyb3VuZDp2YXIoLS1iZy1zZWNvbmRhcnkpO2JvcmRlci1yYWRpdXM6NnB4XCI+PGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMHB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZVwiPk1vZGVsbzwvZGl2PjxkaXYgc3R5bGU9XCJmb250LXdlaWdodDo3MDBcIj4nICtcbiAgICBlc2NhcGVIdG1sU2FmZShiZXN0TW9kZWwpICtcbiAgICAnPC9kaXY+PC9kaXY+JyArXG4gICAgJzxkaXYgc3R5bGU9XCJwYWRkaW5nOjEwcHg7YmFja2dyb3VuZDp2YXIoLS1iZy1zZWNvbmRhcnkpO2JvcmRlci1yYWRpdXM6NnB4XCI+PGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMHB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZVwiPldBUEU8L2Rpdj48ZGl2IHN0eWxlPVwiZm9udC13ZWlnaHQ6NzAwO2NvbG9yOicgK1xuICAgIF93YXBlQmFkZ2VDb2xvcih3YXBlKSArXG4gICAgJ1wiPicgK1xuICAgIF9mbXRXYXBlKHdhcGUpICtcbiAgICAnPC9kaXY+PC9kaXY+JyArXG4gICAgJzxkaXYgc3R5bGU9XCJwYWRkaW5nOjEwcHg7YmFja2dyb3VuZDp2YXIoLS1iZy1zZWNvbmRhcnkpO2JvcmRlci1yYWRpdXM6NnB4XCI+PGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMHB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZVwiPkJpYXM8L2Rpdj48ZGl2IHN0eWxlPVwiZm9udC13ZWlnaHQ6NzAwXCI+JyArXG4gICAgKGJpYXMgIT0gbnVsbCA/IChiaWFzICogMTAwKS50b0ZpeGVkKDApICsgJyUnIDogJ1x1MjAxNCcpICtcbiAgICAnPC9kaXY+PC9kaXY+JyArXG4gICAgJzxkaXYgc3R5bGU9XCJwYWRkaW5nOjEwcHg7YmFja2dyb3VuZDp2YXIoLS1iZy1zZWNvbmRhcnkpO2JvcmRlci1yYWRpdXM6NnB4XCI+PGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMHB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZVwiPk1BRTwvZGl2PjxkaXYgc3R5bGU9XCJmb250LXdlaWdodDo3MDBcIj4nICtcbiAgICBfZm10TnVtKG1hZSkgK1xuICAgICc8L2Rpdj48L2Rpdj4nICtcbiAgICAnPGRpdiBzdHlsZT1cInBhZGRpbmc6MTBweDtiYWNrZ3JvdW5kOnZhcigtLWJnLXNlY29uZGFyeSk7Ym9yZGVyLXJhZGl1czo2cHhcIj48ZGl2IHN0eWxlPVwiZm9udC1zaXplOjEwcHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlXCI+Uk1TRTwvZGl2PjxkaXYgc3R5bGU9XCJmb250LXdlaWdodDo3MDBcIj4nICtcbiAgICBfZm10TnVtKHJtc2UpICtcbiAgICAnPC9kaXY+PC9kaXY+JyArXG4gICAgJzwvZGl2Pic7XG5cbiAgY29uc3QgdGFibGVIdG1sID1cbiAgICAnPHRhYmxlIHN0eWxlPVwid2lkdGg6MTAwJTtmb250LXNpemU6MTJweDtib3JkZXItY29sbGFwc2U6Y29sbGFwc2U7bWFyZ2luLXRvcDoxMHB4XCI+JyArXG4gICAgJzx0aGVhZCBzdHlsZT1cImJhY2tncm91bmQ6IzBmMTcyYTtjb2xvcjojZmZmXCI+PHRyPicgK1xuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjZweCAxMHB4O3RleHQtYWxpZ246bGVmdFwiPk1lczwvdGg+JyArXG4gICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6NnB4IDEwcHg7dGV4dC1hbGlnbjpyaWdodFwiPkZvcmVjYXN0PC90aD4nICtcbiAgICAnPHRoIHN0eWxlPVwicGFkZGluZzo2cHggMTBweDt0ZXh0LWFsaWduOnJpZ2h0XCI+SUMgODAlIGJham88L3RoPicgK1xuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjZweCAxMHB4O3RleHQtYWxpZ246cmlnaHRcIj5JQyA4MCUgYWx0bzwvdGg+JyArXG4gICAgJzwvdHI+PC90aGVhZD48dGJvZHk+JyArXG4gICAgKGRvYy5mb3JlY2FzdCB8fCBbXSlcbiAgICAgIC5tYXAoXG4gICAgICAgIChmKSA9PlxuICAgICAgICAgICc8dHIgc3R5bGU9XCJib3JkZXItYm90dG9tOjFweCBzb2xpZCB2YXIoLS1ib3JkZXItc3VidGxlKVwiPjx0ZCBzdHlsZT1cInBhZGRpbmc6NnB4IDEwcHhcIj4nICtcbiAgICAgICAgICBlc2NhcGVIdG1sU2FmZShfZm10RHNTaG9ydChmLmRzKSkgK1xuICAgICAgICAgICc8L3RkPicgK1xuICAgICAgICAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjZweCAxMHB4O3RleHQtYWxpZ246cmlnaHQ7Zm9udC13ZWlnaHQ6NzAwXCI+JyArXG4gICAgICAgICAgX2ZtdE51bShmLnlfaGF0KSArXG4gICAgICAgICAgJzwvdGQ+JyArXG4gICAgICAgICAgJzx0ZCBzdHlsZT1cInBhZGRpbmc6NnB4IDEwcHg7dGV4dC1hbGlnbjpyaWdodDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKVwiPicgK1xuICAgICAgICAgIF9mbXROdW0oZi5sbzgwKSArXG4gICAgICAgICAgJzwvdGQ+JyArXG4gICAgICAgICAgJzx0ZCBzdHlsZT1cInBhZGRpbmc6NnB4IDEwcHg7dGV4dC1hbGlnbjpyaWdodDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKVwiPicgK1xuICAgICAgICAgIF9mbXROdW0oZi5oaTgwKSArXG4gICAgICAgICAgJzwvdGQ+PC90cj4nXG4gICAgICApXG4gICAgICAuam9pbignJykgK1xuICAgICc8L3Rib2R5PjwvdGFibGU+JztcblxuICBjb25zdCBjb250ZW50ID1cbiAgICAnPGRpdiBzdHlsZT1cImJhY2tncm91bmQ6dmFyKC0tYmctZWxldmF0ZWQpO2JvcmRlci1yYWRpdXM6MTJweDtwYWRkaW5nOjI0cHg7bWF4LXdpZHRoOjgyMHB4O3dpZHRoOjEwMCU7bWF4LWhlaWdodDo5NnZoO292ZXJmbG93OmF1dG87Ym94LXNoYWRvdzowIDIwcHggNjBweCByZ2JhKDAsMCwwLC40KVwiPicgK1xuICAgICc8ZGl2IHN0eWxlPVwiZGlzcGxheTpmbGV4O2p1c3RpZnktY29udGVudDpzcGFjZS1iZXR3ZWVuO2FsaWduLWl0ZW1zOmNlbnRlcjttYXJnaW4tYm90dG9tOjEwcHhcIj4nICtcbiAgICAnPGRpdj48ZGl2IHN0eWxlPVwiZm9udC1zaXplOjExcHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO2xldHRlci1zcGFjaW5nOi40cHhcIj5TdWJmYW1pbGlhPC9kaXY+PGRpdiBzdHlsZT1cImZvbnQtc2l6ZToyMnB4O2ZvbnQtd2VpZ2h0OjgwMFwiPicgK1xuICAgIGVzY2FwZUh0bWxTYWZlKGRvYy5zdWJmYW1pbGlhIHx8IGRvYy5pZCkgK1xuICAgICc8L2Rpdj48L2Rpdj4nICtcbiAgICAnPGJ1dHRvbiBvbmNsaWNrPVwiZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoXFwnZm9yZWNhc3Qtc3RhdC1kZXRhaWxcXCcpLnJlbW92ZSgpXCIgc3R5bGU9XCJiYWNrZ3JvdW5kOnRyYW5zcGFyZW50O2JvcmRlcjoxcHggc29saWQgdmFyKC0tYm9yZGVyLXN1YnRsZSk7Ym9yZGVyLXJhZGl1czo2cHg7cGFkZGluZzo2cHggMTJweDtjdXJzb3I6cG9pbnRlcjtmb250LXdlaWdodDo3MDBcIj5DZXJyYXI8L2J1dHRvbj4nICtcbiAgICAnPC9kaXY+JyArXG4gICAgbWV0cmljc0h0bWwgK1xuICAgICc8ZGl2IHN0eWxlPVwiYmFja2dyb3VuZDojZmZmO3BhZGRpbmc6OHB4O2JvcmRlci1yYWRpdXM6OHB4O21hcmdpbi10b3A6MTBweDtib3JkZXI6MXB4IHNvbGlkIHZhcigtLWJvcmRlci1zdWJ0bGUpXCI+JyArXG4gICAgc3ZnSHRtbCArXG4gICAgJzwvZGl2PicgK1xuICAgIHRhYmxlSHRtbCArXG4gICAgJzxkaXYgc3R5bGU9XCJtYXJnaW4tdG9wOjE0cHg7Zm9udC1zaXplOjExcHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZClcIj5WZXJzaW9uOiA8Y29kZT4nICtcbiAgICBlc2NhcGVIdG1sU2FmZSh2ZXJzaW9uSWQpICtcbiAgICAnPC9jb2RlPiBcdTAwQjcgQXBwcm9hY2g6ICcgK1xuICAgIGVzY2FwZUh0bWxTYWZlKChkb2MuY29uZmlnIHx8IHt9KS5hcHByb2FjaCB8fCAnXHUyMDE0JykgK1xuICAgICc8L2Rpdj4nICtcbiAgICAnPC9kaXY+JztcbiAgZWwuaW5uZXJIVE1MID0gY29udGVudDtcbiAgZG9jdW1lbnQuYm9keS5hcHBlbmRDaGlsZChlbCk7XG59O1xuXG53aW5kb3cub3BlbkZvcmVjYXN0TW9kYWwgPSBhc3luYyBmdW5jdGlvbiAoKSB7XG4gIGlmICghX2NhbkZvcmVjYXN0KCkpIHtcbiAgICBhbGVydCgnRk9SRUNBU1QgZXMgc29sbyBwYXJhIE1hcmlhbm8gKGFkbWluKS4nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgY29uc3QgZWwgPSBfcmVuZGVyTW9kYWxTaGVsbCgpO1xuICBlbC5zdHlsZS5kaXNwbGF5ID0gJ2Jsb2NrJztcbiAgLy8gRmFzZSAxOiBjYXJnYXIgU2FsZXMgUGxhbnMgY2FjaGVzICsgcmVuZGVyaXphciB0YWIgZGVmYXVsdC5cbiAgX3JlbmRlclNhbGVzUGxhbnNUYWIoKTtcbiAgX2xvYWRTYWxlc1BsYW5DYWNoZXMoKVxuICAgIC50aGVuKF9yZW5kZXJTYWxlc1BsYW5zVGFiKVxuICAgIC5jYXRjaCgoKSA9PiB7fSk7XG59O1xuXG53aW5kb3cuY2xvc2VGb3JlY2FzdE1vZGFsID0gZnVuY3Rpb24gKCkge1xuICBjb25zdCBlbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdmb3JlY2FzdC1tb2RhbCcpO1xuICBpZiAoZWwpIGVsLnN0eWxlLmRpc3BsYXkgPSAnbm9uZSc7XG59O1xuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIEYzQSBcdTIwMTQgVGFibGEgUmVjb21lbmRhY2lcdTAwRjNuIGRlIENvbXByYSAodGFiIFNhbGVzIFBsYW5zKVxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmFzeW5jIGZ1bmN0aW9uIF9sb2FkTXVsdGlwbGllck92ZXJyaWRlcygpIHtcbiAgaWYgKCF3aW5kb3cuZmJEYikgcmV0dXJuO1xuICB0cnkge1xuICAgIGNvbnN0IGRvYyA9IGF3YWl0IHdpbmRvdy5mYkRiLmNvbGxlY3Rpb24oJ2ZvcmVjYXN0X2NvbmZpZycpLmRvYygnbXVsdGlwbGllcnMnKS5nZXQoKTtcbiAgICBpZiAoZG9jLmV4aXN0cykge1xuICAgICAgY29uc3QgZCA9IGRvYy5kYXRhKCkgfHwge307XG4gICAgICBfbXVsdGlwbGllck92ZXJyaWRlcyA9IGQuc2t1T3ZlcnJpZGVzIHx8IHt9O1xuICAgIH0gZWxzZSB7XG4gICAgICBfbXVsdGlwbGllck92ZXJyaWRlcyA9IHt9O1xuICAgIH1cbiAgfSBjYXRjaCAoZSkge1xuICAgIGNvbnNvbGUud2FybignW0ZPUkVDQVNUIHJlY29dIGxvYWQgbXVsdGlwbGllcnMgZmFpbDonLCBlICYmIGUubWVzc2FnZSk7XG4gICAgX211bHRpcGxpZXJPdmVycmlkZXMgPSB7fTtcbiAgfVxufVxuXG5hc3luYyBmdW5jdGlvbiBfc2F2ZU11bHRpcGxpZXJPdmVycmlkZShza3VVcHBlciwgdmFsdWUpIHtcbiAgaWYgKCF3aW5kb3cuZmJEYikgcmV0dXJuO1xuICBpZiAoIV9tdWx0aXBsaWVyT3ZlcnJpZGVzKSBfbXVsdGlwbGllck92ZXJyaWRlcyA9IHt9O1xuICBjb25zdCB1aWQgPSAod2luZG93LmN1cnJlbnRVc2VyICYmIHdpbmRvdy5jdXJyZW50VXNlci5lbWFpbCkgfHwgJ3Vua25vd24nO1xuICBfbXVsdGlwbGllck92ZXJyaWRlc1tza3VVcHBlcl0gPSB7XG4gICAgdmFsdWU6IE51bWJlcih2YWx1ZSksXG4gICAgdXBkYXRlZEF0OiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgdXBkYXRlZEJ5OiB1aWQsXG4gIH07XG4gIGF3YWl0IHdpbmRvdy5mYkRiLmNvbGxlY3Rpb24oJ2ZvcmVjYXN0X2NvbmZpZycpLmRvYygnbXVsdGlwbGllcnMnKS5zZXQoe1xuICAgIHNrdU92ZXJyaWRlczogX211bHRpcGxpZXJPdmVycmlkZXMsXG4gICAgdXBkYXRlZEF0OiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgdXBkYXRlZEJ5OiB1aWQsXG4gIH0pO1xufVxuXG5hc3luYyBmdW5jdGlvbiBfcmVtb3ZlTXVsdGlwbGllck92ZXJyaWRlKHNrdVVwcGVyKSB7XG4gIGlmICghd2luZG93LmZiRGIgfHwgIV9tdWx0aXBsaWVyT3ZlcnJpZGVzKSByZXR1cm47XG4gIGRlbGV0ZSBfbXVsdGlwbGllck92ZXJyaWRlc1tza3VVcHBlcl07XG4gIGNvbnN0IHVpZCA9ICh3aW5kb3cuY3VycmVudFVzZXIgJiYgd2luZG93LmN1cnJlbnRVc2VyLmVtYWlsKSB8fCAndW5rbm93bic7XG4gIGF3YWl0IHdpbmRvdy5mYkRiLmNvbGxlY3Rpb24oJ2ZvcmVjYXN0X2NvbmZpZycpLmRvYygnbXVsdGlwbGllcnMnKS5zZXQoe1xuICAgIHNrdU92ZXJyaWRlczogX211bHRpcGxpZXJPdmVycmlkZXMsXG4gICAgdXBkYXRlZEF0OiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgdXBkYXRlZEJ5OiB1aWQsXG4gIH0pO1xufVxuXG4vLyBBdXRvIG11bHRpcGxpZXI6IHJlY2VudC9iYXNlbGluZSBjb24gY2FwLiBSZXRvcm5hIHt2YWx1ZSwgc291cmNlOiAnYXV0byd8J2ZhbGxiYWNrJ3wnZGVmYXVsdCcsIHJlY2VudCwgYmFzZWxpbmV9LlxuZnVuY3Rpb24gX2NvbXB1dGVNdWx0aXBsaWVyQXV0byhza3VVcHBlcikge1xuICBjb25zdCByZWMgPSBfcmVjb1ZlbnRhc1NuYXBzaG90ICYmIF9yZWNvVmVudGFzU25hcHNob3Rbc2t1VXBwZXJdO1xuICBpZiAoIXJlYyB8fCAhcmVjLm1lc2VzKSByZXR1cm4geyB2YWx1ZTogMS4wLCBzb3VyY2U6ICdkZWZhdWx0JywgcmVjZW50OiAwLCBiYXNlbGluZTogMCB9O1xuICBjb25zdCBob3kgPSBuZXcgRGF0ZSgpO1xuICBjb25zdCBtb250aHNCYWNrS2V5ID0gKG4pID0+IHtcbiAgICBjb25zdCBkID0gbmV3IERhdGUoaG95LmdldEZ1bGxZZWFyKCksIGhveS5nZXRNb250aCgpIC0gbiwgMSk7XG4gICAgcmV0dXJuIFN0cmluZyhkLmdldEZ1bGxZZWFyKCkpICsgJy0nICsgU3RyaW5nKGQuZ2V0TW9udGgoKSArIDEpLnBhZFN0YXJ0KDIsICcwJyk7XG4gIH07XG4gIGNvbnN0IGNvbGxlY3RBdmcgPSAobikgPT4ge1xuICAgIGxldCBzdW0gPSAwO1xuICAgIGxldCBjb3VudCA9IDA7XG4gICAgZm9yIChsZXQgaSA9IDE7IGkgPD0gbjsgaSsrKSB7XG4gICAgICBjb25zdCBrID0gbW9udGhzQmFja0tleShpKTtcbiAgICAgIGNvbnN0IG0gPSByZWMubWVzZXNba107XG4gICAgICBpZiAobSAmJiBOdW1iZXIuaXNGaW5pdGUoTnVtYmVyKG0ucXR5KSkpIHtcbiAgICAgICAgc3VtICs9IE51bWJlcihtLnF0eSk7XG4gICAgICAgIGNvdW50Kys7XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiBjb3VudCA+IDAgPyB7IGF2Zzogc3VtIC8gY291bnQsIG46IGNvdW50IH0gOiB7IGF2ZzogMCwgbjogMCB9O1xuICB9O1xuICBjb25zdCByZWMyID0gY29sbGVjdEF2ZyhSRUNPX01VTFRfUkVDRU5UX01PTlRIUyk7XG4gIGNvbnN0IGJhczYgPSBjb2xsZWN0QXZnKFJFQ09fTVVMVF9CQVNFTElORV9NT05USFMpO1xuICAvLyBOZWNlc2l0YW1vcyBhbCBtZW5vcyAxIG1lcyByZWNpZW50ZSArIDMgbWVzZXMgYmFzZWxpbmUgcGFyYSBjYWxjdWxhciBhdXRvLlxuICBpZiAocmVjMi5uID09PSAwIHx8IGJhczYubiA8IDMgfHwgYmFzNi5hdmcgPCBSRUNPX01VTFRfTUlOX0JBU0VMSU5FKSB7XG4gICAgcmV0dXJuIHsgdmFsdWU6IDEuMCwgc291cmNlOiAnZGVmYXVsdCcsIHJlY2VudDogcmVjMi5hdmcsIGJhc2VsaW5lOiBiYXM2LmF2ZyB9O1xuICB9XG4gIGxldCByYXRpbyA9IHJlYzIuYXZnIC8gYmFzNi5hdmc7XG4gIGlmIChyYXRpbyA8IFJFQ09fTVVMVF9NSU4pIHJhdGlvID0gUkVDT19NVUxUX01JTjtcbiAgaWYgKHJhdGlvID4gUkVDT19NVUxUX01BWCkgcmF0aW8gPSBSRUNPX01VTFRfTUFYO1xuICByZXR1cm4ge1xuICAgIHZhbHVlOiBNYXRoLnJvdW5kKHJhdGlvICogMTAwKSAvIDEwMCxcbiAgICBzb3VyY2U6ICdhdXRvJyxcbiAgICByZWNlbnQ6IE1hdGgucm91bmQocmVjMi5hdmcgKiAxMCkgLyAxMCxcbiAgICBiYXNlbGluZTogTWF0aC5yb3VuZChiYXM2LmF2ZyAqIDEwKSAvIDEwLFxuICB9O1xufVxuXG5mdW5jdGlvbiBfZ2V0RWZmZWN0aXZlTXVsdGlwbGllcihza3VVcHBlcikge1xuICAvLyBPdmVycmlkZSBtYW51YWwgZ2FuYVxuICBpZiAoX211bHRpcGxpZXJPdmVycmlkZXMgJiYgX211bHRpcGxpZXJPdmVycmlkZXNbc2t1VXBwZXJdKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIHZhbHVlOiBOdW1iZXIoX211bHRpcGxpZXJPdmVycmlkZXNbc2t1VXBwZXJdLnZhbHVlKSB8fCAxLjAsXG4gICAgICBzb3VyY2U6ICdtYW51YWwnLFxuICAgICAgYXV0bzogX2NvbXB1dGVNdWx0aXBsaWVyQXV0byhza3VVcHBlciksXG4gICAgfTtcbiAgfVxuICBjb25zdCBhdXRvID0gX2NvbXB1dGVNdWx0aXBsaWVyQXV0byhza3VVcHBlcik7XG4gIHJldHVybiB7IHZhbHVlOiBhdXRvLnZhbHVlLCBzb3VyY2U6IGF1dG8uc291cmNlLCBhdXRvIH07XG59XG5cbmFzeW5jIGZ1bmN0aW9uIF9sb2FkRGlzY29udGludWVkU2t1cygpIHtcbiAgaWYgKCF3aW5kb3cuZmJEYikgcmV0dXJuO1xuICB0cnkge1xuICAgIGNvbnN0IGRvYyA9IGF3YWl0IHdpbmRvdy5mYkRiLmNvbGxlY3Rpb24oJ2ZvcmVjYXN0X2NvbmZpZycpLmRvYygnZGlzY29udGludWVkX3NrdXMnKS5nZXQoKTtcbiAgICBpZiAoZG9jLmV4aXN0cykge1xuICAgICAgY29uc3QgZCA9IGRvYy5kYXRhKCkgfHwge307XG4gICAgICBjb25zdCBhcnIgPSBBcnJheS5pc0FycmF5KGQuc2t1cykgPyBkLnNrdXMgOiBbXTtcbiAgICAgIF9kaXNjb250aW51ZWRTa3VzID0gbmV3IFNldChhcnIubWFwKChzKSA9PiBTdHJpbmcocykudHJpbSgpLnRvVXBwZXJDYXNlKCkpKTtcbiAgICAgIF9kaXNjb250aW51ZWRNZXRhID0geyB1cGRhdGVkQXQ6IGQudXBkYXRlZEF0LCB1cGRhdGVkQnk6IGQudXBkYXRlZEJ5IH07XG4gICAgfSBlbHNlIHtcbiAgICAgIF9kaXNjb250aW51ZWRTa3VzID0gbmV3IFNldCgpO1xuICAgICAgX2Rpc2NvbnRpbnVlZE1ldGEgPSBudWxsO1xuICAgIH1cbiAgfSBjYXRjaCAoZSkge1xuICAgIGNvbnNvbGUud2FybignW0ZPUkVDQVNUIHJlY29dIGxvYWQgZGlzY29udGludWVkIGZhaWw6JywgZSAmJiBlLm1lc3NhZ2UpO1xuICAgIF9kaXNjb250aW51ZWRTa3VzID0gbmV3IFNldCgpO1xuICB9XG59XG5cbmFzeW5jIGZ1bmN0aW9uIF9zYXZlRGlzY29udGludWVkU2t1cygpIHtcbiAgaWYgKCF3aW5kb3cuZmJEYiB8fCAhX2Rpc2NvbnRpbnVlZFNrdXMpIHJldHVybjtcbiAgY29uc3QgdWlkID0gKHdpbmRvdy5jdXJyZW50VXNlciAmJiB3aW5kb3cuY3VycmVudFVzZXIuZW1haWwpIHx8ICd1bmtub3duJztcbiAgY29uc3QgcGF5bG9hZCA9IHtcbiAgICBza3VzOiBBcnJheS5mcm9tKF9kaXNjb250aW51ZWRTa3VzKS5zb3J0KCksXG4gICAgdXBkYXRlZEF0OiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgdXBkYXRlZEJ5OiB1aWQsXG4gIH07XG4gIGF3YWl0IHdpbmRvdy5mYkRiLmNvbGxlY3Rpb24oJ2ZvcmVjYXN0X2NvbmZpZycpLmRvYygnZGlzY29udGludWVkX3NrdXMnKS5zZXQocGF5bG9hZCk7XG4gIF9kaXNjb250aW51ZWRNZXRhID0geyB1cGRhdGVkQXQ6IHBheWxvYWQudXBkYXRlZEF0LCB1cGRhdGVkQnk6IHBheWxvYWQudXBkYXRlZEJ5IH07XG59XG5cbmFzeW5jIGZ1bmN0aW9uIF9sb2FkUmVjb0RhdGEoKSB7XG4gIGlmICghd2luZG93LmZiRGIpIHRocm93IG5ldyBFcnJvcignRmlyZXN0b3JlIG5vIGluaWNpYWxpemFkbycpO1xuICBjb25zdCBwcm9taXNlcyA9IFtdO1xuICBpZiAoIV9kaXNjb250aW51ZWRTa3VzKSBwcm9taXNlcy5wdXNoKF9sb2FkRGlzY29udGludWVkU2t1cygpKTtcbiAgaWYgKCFfbXVsdGlwbGllck92ZXJyaWRlcykgcHJvbWlzZXMucHVzaChfbG9hZE11bHRpcGxpZXJPdmVycmlkZXMoKSk7XG4gIGlmICghX3JlY29TdG9ja1NuYXBzaG90KSB7XG4gICAgcHJvbWlzZXMucHVzaChcbiAgICAgIHdpbmRvdy5mYkRiXG4gICAgICAgIC5jb2xsZWN0aW9uKCdhcHBfY29uZmlnJylcbiAgICAgICAgLmRvYygnc3RvY2tfc25hcHNob3QnKVxuICAgICAgICAuZ2V0KClcbiAgICAgICAgLnRoZW4oKGQpID0+IHtcbiAgICAgICAgICBjb25zdCBkYXRhID0gZC5leGlzdHMgPyBkLmRhdGEoKSA6IHt9O1xuICAgICAgICAgIGxldCB3aCA9IHt9O1xuICAgICAgICAgIGxldCBibyA9IHt9O1xuICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICB3aCA9IGRhdGEud2FyZWhvdXNlQnJlYWtkb3duID8gSlNPTi5wYXJzZShkYXRhLndhcmVob3VzZUJyZWFrZG93bikgOiB7fTtcbiAgICAgICAgICB9IGNhdGNoIHtcbiAgICAgICAgICAgIHdoID0ge307XG4gICAgICAgICAgfVxuICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICBibyA9IGRhdGEuYmFja29yZGVyQnlTa3UgPyBKU09OLnBhcnNlKGRhdGEuYmFja29yZGVyQnlTa3UpIDoge307XG4gICAgICAgICAgfSBjYXRjaCB7XG4gICAgICAgICAgICBibyA9IHt9O1xuICAgICAgICAgIH1cbiAgICAgICAgICBfcmVjb1N0b2NrU25hcHNob3QgPSB7IHdhcmVob3VzZUJyZWFrZG93bjogd2gsIGJhY2tvcmRlckJ5U2t1OiBibyB9O1xuICAgICAgICB9KVxuICAgICk7XG4gIH1cbiAgaWYgKCFfcmVjb1ZlbnRhc1NuYXBzaG90KSB7XG4gICAgcHJvbWlzZXMucHVzaChcbiAgICAgIHdpbmRvdy5mYkRiXG4gICAgICAgIC5jb2xsZWN0aW9uKCdza3VfdmVudGFzX3NuYXBzaG90JylcbiAgICAgICAgLmdldCgpXG4gICAgICAgIC50aGVuKChzbmFwKSA9PiB7XG4gICAgICAgICAgY29uc3QgbWFwID0ge307XG4gICAgICAgICAgc25hcC5mb3JFYWNoKChkb2MpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IGQgPSBkb2MuZGF0YSgpO1xuICAgICAgICAgICAgaWYgKCFkIHx8ICFkLnNrdSkgcmV0dXJuO1xuICAgICAgICAgICAgbWFwW1N0cmluZyhkLnNrdSkudHJpbSgpLnRvVXBwZXJDYXNlKCldID0geyBtZXNlczogZC5tZXNlcyB8fCB7fSB9O1xuICAgICAgICAgIH0pO1xuICAgICAgICAgIF9yZWNvVmVudGFzU25hcHNob3QgPSBtYXA7XG4gICAgICAgIH0pXG4gICAgKTtcbiAgfVxuICBhd2FpdCBQcm9taXNlLmFsbChwcm9taXNlcyk7XG59XG5cbmZ1bmN0aW9uIF9jb21wdXRlVmVudGFNZW5zdWFsUHJvbWVkaW8oc2t1VXBwZXIpIHtcbiAgLy8gUHJvbWVkaW8gZGUgbG9zIFx1MDBGQWx0aW1vcyBSRUNPX1ZFTlRBX1BST01FRElPX1dJTkRPVyBtZXNlcyBjZXJyYWRvc1xuICAvLyAoZXhjbHV5ZSBlbCBtZXMgYWN0dWFsIHBhcmNpYWwpLlxuICBjb25zdCByZWMgPSBfcmVjb1ZlbnRhc1NuYXBzaG90ICYmIF9yZWNvVmVudGFzU25hcHNob3Rbc2t1VXBwZXJdO1xuICBpZiAoIXJlYyB8fCAhcmVjLm1lc2VzKSByZXR1cm4gMDtcbiAgY29uc3QgaG95ID0gbmV3IERhdGUoKTtcbiAgY29uc3QgbW9udGhzQmFjayA9IFtdO1xuICBmb3IgKGxldCBpID0gMTsgaSA8PSBSRUNPX1ZFTlRBX1BST01FRElPX1dJTkRPVzsgaSsrKSB7XG4gICAgY29uc3QgZCA9IG5ldyBEYXRlKGhveS5nZXRGdWxsWWVhcigpLCBob3kuZ2V0TW9udGgoKSAtIGksIDEpO1xuICAgIG1vbnRoc0JhY2sucHVzaChTdHJpbmcoZC5nZXRGdWxsWWVhcigpKSArICctJyArIFN0cmluZyhkLmdldE1vbnRoKCkgKyAxKS5wYWRTdGFydCgyLCAnMCcpKTtcbiAgfVxuICBsZXQgc3VtID0gMDtcbiAgbGV0IG4gPSAwO1xuICBtb250aHNCYWNrLmZvckVhY2goKGspID0+IHtcbiAgICBjb25zdCBtID0gcmVjLm1lc2VzW2tdO1xuICAgIGlmIChtICYmIE51bWJlci5pc0Zpbml0ZShOdW1iZXIobS5xdHkpKSkge1xuICAgICAgc3VtICs9IE51bWJlcihtLnF0eSk7XG4gICAgICBuKys7XG4gICAgfVxuICB9KTtcbiAgcmV0dXJuIG4gPiAwID8gc3VtIC8gbiA6IDA7XG59XG5cbmZ1bmN0aW9uIF9jb21wdXRlU2FsZXNQbGFuRnV0dXJvKHJvdykge1xuICAvLyBTdW1hIGxvcyBtZXNlcyBkZSByb3cubW9udGhzIGRlc2RlIGVsIG1lcyBhY3R1YWwgKGluY2x1c2l2ZSkgaGFzdGEgZWxcbiAgLy8gXHUwMEZBbHRpbW8gbWVzIGRlbCBzYWxlcyBwbGFuLiBMb3MgbWVzZXMgc29uICdZWVlZLU1NJy5cbiAgaWYgKCFyb3cgfHwgIXJvdy5tb250aHMpIHJldHVybiAwO1xuICBjb25zdCBob3kgPSBuZXcgRGF0ZSgpO1xuICBjb25zdCBjdXJyZW50S2V5ID0gU3RyaW5nKGhveS5nZXRGdWxsWWVhcigpKSArICctJyArIFN0cmluZyhob3kuZ2V0TW9udGgoKSArIDEpLnBhZFN0YXJ0KDIsICcwJyk7XG4gIGxldCBzdW0gPSAwO1xuICBPYmplY3Qua2V5cyhyb3cubW9udGhzKS5mb3JFYWNoKChrKSA9PiB7XG4gICAgaWYgKGsgPj0gY3VycmVudEtleSkgc3VtICs9IE51bWJlcihyb3cubW9udGhzW2tdIHx8IDApO1xuICB9KTtcbiAgcmV0dXJuIHN1bTtcbn1cblxuZnVuY3Rpb24gX2NvbXB1dGVSZWNvbW1lbmRhdGlvbnMoKSB7XG4gIC8vIENvbWJpbmEgUm9kcyArIFJlZWxzIHNhbGVzIHBsYW5zICsgc3RvY2sgKyBiYWNrb3JkZXIgKyB2ZW50YXMgcHJvbWVkaW8uXG4gIC8vIFJldG9ybmEgYXJyYXkgZGUgcm93cyBjb24gdG9kb3MgbG9zIGNhbXBvcyArIHJlY29tZW5kYWRvLlxuICBjb25zdCByb3dzID0gW107XG4gIGNvbnN0IGZhbWlsaWFzID0gWydyb2RzJywgJ3JlZWxzJ107XG4gIGZvciAoY29uc3QgZmFtIG9mIGZhbWlsaWFzKSB7XG4gICAgY29uc3QgY2FjaGUgPSBfc2FsZXNQbGFuQ2FjaGVzW2ZhbV07XG4gICAgaWYgKCFjYWNoZSB8fCAhY2FjaGUucm93cykgY29udGludWU7XG4gICAgZm9yIChjb25zdCBzcFJvdyBvZiBjYWNoZS5yb3dzKSB7XG4gICAgICBjb25zdCBza3UgPSBTdHJpbmcoc3BSb3cuc2t1IHx8ICcnKS50cmltKCk7XG4gICAgICBjb25zdCBza3VVcHBlciA9IHNrdS50b1VwcGVyQ2FzZSgpO1xuICAgICAgLy8gdjExMTI6IHNraXBlYW1vcyBTS1VzIGRlc2NvbnRpbnVhZG9zIChNYXJpYW5vIGxvcyBtYXJjYSBkZXNkZSBsYSBVSSkuXG4gICAgICBpZiAoX2Rpc2NvbnRpbnVlZFNrdXMgJiYgX2Rpc2NvbnRpbnVlZFNrdXMuaGFzKHNrdVVwcGVyKSkgY29udGludWU7XG4gICAgICBjb25zdCBzdG9ja1doID1cbiAgICAgICAgKF9yZWNvU3RvY2tTbmFwc2hvdCAmJlxuICAgICAgICAgIF9yZWNvU3RvY2tTbmFwc2hvdC53YXJlaG91c2VCcmVha2Rvd24gJiZcbiAgICAgICAgICBfcmVjb1N0b2NrU25hcHNob3Qud2FyZWhvdXNlQnJlYWtkb3duW3NrdV0pIHx8XG4gICAgICAgIHt9O1xuICAgICAgY29uc3Qgc3RvY2tMaWJyZSA9IE51bWJlcihzdG9ja1doWycxMSddIHx8IDApO1xuICAgICAgY29uc3QgZW5UcmFuc2l0byA9IE51bWJlcihzdG9ja1doWycxMiddIHx8IDApO1xuICAgICAgY29uc3QgYmFja29yZGVyID0gTnVtYmVyKFxuICAgICAgICAoX3JlY29TdG9ja1NuYXBzaG90ICYmXG4gICAgICAgICAgX3JlY29TdG9ja1NuYXBzaG90LmJhY2tvcmRlckJ5U2t1ICYmXG4gICAgICAgICAgX3JlY29TdG9ja1NuYXBzaG90LmJhY2tvcmRlckJ5U2t1W3NrdV0pIHx8XG4gICAgICAgICAgMFxuICAgICAgKTtcbiAgICAgIGNvbnN0IHZlbnRhTWVuc3VhbCA9IF9jb21wdXRlVmVudGFNZW5zdWFsUHJvbWVkaW8oc2t1VXBwZXIpO1xuICAgICAgY29uc3Qgc2FsZXNQbGFuRnV0ID0gX2NvbXB1dGVTYWxlc1BsYW5GdXR1cm8oc3BSb3cpO1xuICAgICAgY29uc3QgbW9xID0gTnVtYmVyKHNwUm93Lm1vcSB8fCAwKTtcbiAgICAgIC8vIHYxMTE0IEYzQjogbXVsdGlwbGljYWRvciBhdXRvIChyZWNlbnQvYmFzZWxpbmUpIG8gb3ZlcnJpZGUgbWFudWFsLlxuICAgICAgY29uc3QgbXVsdEluZm8gPSBfZ2V0RWZmZWN0aXZlTXVsdGlwbGllcihza3VVcHBlcik7XG4gICAgICBjb25zdCBtdWx0aXBsaWVyID0gbXVsdEluZm8udmFsdWU7XG4gICAgICBjb25zdCBkZW1hbmRhRXNwZXJhZGEgPSB2ZW50YU1lbnN1YWwgKiBtdWx0aXBsaWVyICogUkVDT19IT1JJWk9OX01PTlRIUztcbiAgICAgIGNvbnN0IGJhbGFuY2UgPSBzdG9ja0xpYnJlICsgZW5UcmFuc2l0byArIHNhbGVzUGxhbkZ1dCAtIGJhY2tvcmRlciAtIGRlbWFuZGFFc3BlcmFkYTtcbiAgICAgIGxldCByZWNvbWVuZGFkbyA9IDA7XG4gICAgICBpZiAoYmFsYW5jZSA8IDApIHtcbiAgICAgICAgY29uc3QgZGVmaWNpdCA9IC1iYWxhbmNlO1xuICAgICAgICByZWNvbWVuZGFkbyA9IG1vcSA+IDAgPyBNYXRoLm1heChtb3EsIE1hdGguY2VpbChkZWZpY2l0IC8gbW9xKSAqIG1vcSkgOiBNYXRoLmNlaWwoZGVmaWNpdCk7XG4gICAgICB9XG4gICAgICByb3dzLnB1c2goe1xuICAgICAgICBmYW1pbGlhOiBmYW0sXG4gICAgICAgIHNrdSxcbiAgICAgICAgZGVzY3JpcHRpb246IHNwUm93LmRlc2NyaXB0aW9uIHx8ICcnLFxuICAgICAgICBtb3EsXG4gICAgICAgIHN0b2NrTGlicmUsXG4gICAgICAgIGVuVHJhbnNpdG8sXG4gICAgICAgIGJhY2tvcmRlcixcbiAgICAgICAgdmVudGFNZW5zdWFsOiBNYXRoLnJvdW5kKHZlbnRhTWVuc3VhbCAqIDEwKSAvIDEwLFxuICAgICAgICBzYWxlc1BsYW5GdXQsXG4gICAgICAgIG11bHRpcGxpZXIsXG4gICAgICAgIG11bHRTb3VyY2U6IG11bHRJbmZvLnNvdXJjZSwgLy8gJ2F1dG8nIHwgJ21hbnVhbCcgfCAnZGVmYXVsdCcgfCAnZmFsbGJhY2snXG4gICAgICAgIG11bHRBdXRvOiBtdWx0SW5mby5hdXRvID8gbXVsdEluZm8uYXV0by52YWx1ZSA6IG51bGwsIC8vIGVsIHZhbG9yIGF1dG8gc2kgaGF5IG92ZXJyaWRlIG1hbnVhbFxuICAgICAgICBkZW1hbmRhRXNwZXJhZGE6IE1hdGgucm91bmQoZGVtYW5kYUVzcGVyYWRhICogMTApIC8gMTAsXG4gICAgICAgIGJhbGFuY2U6IE1hdGgucm91bmQoYmFsYW5jZSAqIDEwKSAvIDEwLFxuICAgICAgICByZWNvbWVuZGFkbyxcbiAgICAgIH0pO1xuICAgIH1cbiAgfVxuICAvLyBPcmRlbmFyIHBvciByZWNvbWVuZGFkbyBkZXNjZW5kZW50ZVxuICByb3dzLnNvcnQoKGEsIGIpID0+IGIucmVjb21lbmRhZG8gLSBhLnJlY29tZW5kYWRvKTtcbiAgcmV0dXJuIHJvd3M7XG59XG5cbmZ1bmN0aW9uIF9mbXROdW1TaWduZWQobikge1xuICBpZiAobiA9PSBudWxsIHx8ICFOdW1iZXIuaXNGaW5pdGUoTnVtYmVyKG4pKSkgcmV0dXJuICdcdTIwMTQnO1xuICBjb25zdCB2ID0gTnVtYmVyKG4pO1xuICBjb25zdCBhYnMgPSBNYXRoLmFicyh2KS50b0xvY2FsZVN0cmluZygnZXMtQVInLCB7IG1heGltdW1GcmFjdGlvbkRpZ2l0czogMCB9KTtcbiAgcmV0dXJuICh2IDwgMCA/ICdcdTIyMTInIDogJycpICsgYWJzO1xufVxuXG5mdW5jdGlvbiBfZm10SW50KG4pIHtcbiAgaWYgKG4gPT0gbnVsbCB8fCAhTnVtYmVyLmlzRmluaXRlKE51bWJlcihuKSkpIHJldHVybiAnXHUyMDE0JztcbiAgcmV0dXJuIE1hdGgucm91bmQoTnVtYmVyKG4pKS50b0xvY2FsZVN0cmluZygnZXMtQVInKTtcbn1cblxuLy8gdjExMTQgRjNCOiBjZWxkYSBtdWx0aXBsaWNhZG9yIGNvbiBjaGlwIGF1dG8vbWFudWFsICsgaW5wdXQgZWRpdGFibGUuXG5mdW5jdGlvbiBfYnVpbGRNdWx0Q2VsbEh0bWwocikge1xuICBjb25zdCBza3VVcHBlciA9IFN0cmluZyhyLnNrdSkudHJpbSgpLnRvVXBwZXJDYXNlKCk7XG4gIGNvbnN0IGlzTWFudWFsID0gci5tdWx0U291cmNlID09PSAnbWFudWFsJztcbiAgY29uc3QgaXNEZWZhdWx0ID0gci5tdWx0U291cmNlID09PSAnZGVmYXVsdCc7XG4gIGNvbnN0IHZhbCA9IE51bWJlcihyLm11bHRpcGxpZXIgfHwgMS4wKS50b0ZpeGVkKDIpO1xuICAvLyBDb2xvciBwb3IgZGlyZWNjaVx1MDBGM246ID4xLjA1IHZlcmRlIChjcmVjaWVuZG8pLCA8MC45NSByb2pvIChjYXllbmRvKSwgbWVkaW8gZ3Jpcy5cbiAgbGV0IGRpckNvbG9yID0gJ3ZhcigtLXRleHQtbXV0ZWQpJztcbiAgaWYgKHIubXVsdGlwbGllciA+IDEuMDUpIGRpckNvbG9yID0gJyMxNmEzNGEnO1xuICBlbHNlIGlmIChyLm11bHRpcGxpZXIgPCAwLjk1KSBkaXJDb2xvciA9ICcjZGMyNjI2JztcblxuICBjb25zdCBjaGlwID0gaXNNYW51YWxcbiAgICA/ICc8c3BhbiBzdHlsZT1cImRpc3BsYXk6aW5saW5lLWJsb2NrO3BhZGRpbmc6MXB4IDVweDtiYWNrZ3JvdW5kOiNmNTllMGI7Y29sb3I6I2ZmZjtib3JkZXItcmFkaXVzOjhweDtmb250LXNpemU6OXB4O2ZvbnQtd2VpZ2h0OjcwMDttYXJnaW4tbGVmdDo0cHhcIiB0aXRsZT1cIk92ZXJyaWRlIG1hbnVhbDogcGlzYSBlbCBhdXRvXCI+TTwvc3Bhbj4nXG4gICAgOiBpc0RlZmF1bHRcbiAgICAgID8gJzxzcGFuIHN0eWxlPVwiZGlzcGxheTppbmxpbmUtYmxvY2s7cGFkZGluZzoxcHggNXB4O2JhY2tncm91bmQ6Izk0YTNiODtjb2xvcjojZmZmO2JvcmRlci1yYWRpdXM6OHB4O2ZvbnQtc2l6ZTo5cHg7Zm9udC13ZWlnaHQ6NzAwO21hcmdpbi1sZWZ0OjRweFwiIHRpdGxlPVwiU2luIGRhdG9zIHN1ZmljaWVudGVzOiB1c2EgMS4wXCI+XHUwMEI3PC9zcGFuPidcbiAgICAgIDogJzxzcGFuIHN0eWxlPVwiZGlzcGxheTppbmxpbmUtYmxvY2s7cGFkZGluZzoxcHggNXB4O2JhY2tncm91bmQ6IzBkOTQ4ODtjb2xvcjojZmZmO2JvcmRlci1yYWRpdXM6OHB4O2ZvbnQtc2l6ZTo5cHg7Zm9udC13ZWlnaHQ6NzAwO21hcmdpbi1sZWZ0OjRweFwiIHRpdGxlPVwiQXV0byA9IHZlbnRhIDJtIC8gdmVudGEgNm1cIj5BPC9zcGFuPic7XG5cbiAgY29uc3QgcmVzZXRCdG4gPSBpc01hbnVhbFxuICAgID8gJzxidXR0b24gb25jbGljaz1cInJlc2V0TXVsdGlwbGllcihcXCcnICtcbiAgICAgIGVzY2FwZUh0bWxTYWZlKHNrdVVwcGVyKSArXG4gICAgICAnXFwnKVwiIHRpdGxlPVwiVm9sdmVyIGFsIGF1dG9cIiBzdHlsZT1cIm1hcmdpbi1sZWZ0OjRweDtiYWNrZ3JvdW5kOnRyYW5zcGFyZW50O2JvcmRlcjpub25lO2N1cnNvcjpwb2ludGVyO2ZvbnQtc2l6ZToxMnB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO3BhZGRpbmc6MFwiPlx1MjFCQjwvYnV0dG9uPidcbiAgICA6ICcnO1xuXG4gIGNvbnN0IGF1dG9IaW50ID1cbiAgICBpc01hbnVhbCAmJiByLm11bHRBdXRvICE9IG51bGxcbiAgICAgID8gJyA8c3BhbiBzdHlsZT1cImZvbnQtc2l6ZToxMHB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpXCIgdGl0bGU9XCJWYWxvciBhdXRvIGNhbGN1bGFkb1wiPihhdXRvICcgK1xuICAgICAgICBOdW1iZXIoci5tdWx0QXV0bykudG9GaXhlZCgyKSArXG4gICAgICAgICcpPC9zcGFuPidcbiAgICAgIDogJyc7XG5cbiAgcmV0dXJuIChcbiAgICAnPHNwYW4gc3R5bGU9XCJkaXNwbGF5OmlubGluZS1mbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtnYXA6MnB4XCI+JyArXG4gICAgJzxzcGFuIG9uY2xpY2s9XCJlZGl0TXVsdGlwbGllcih0aGlzLCBcXCcnICtcbiAgICBlc2NhcGVIdG1sU2FmZShza3VVcHBlcikgK1xuICAgICdcXCcpXCIgc3R5bGU9XCJjdXJzb3I6cG9pbnRlcjtwYWRkaW5nOjJweCA2cHg7Ym9yZGVyLXJhZGl1czo0cHg7YmFja2dyb3VuZDp2YXIoLS1iZy1zZWNvbmRhcnkpO2ZvbnQtdmFyaWFudC1udW1lcmljOnRhYnVsYXItbnVtcztmb250LXdlaWdodDo3MDA7Y29sb3I6JyArXG4gICAgZGlyQ29sb3IgK1xuICAgICdcIiB0aXRsZT1cIkNsaWNrIHBhcmEgZWRpdGFyXCI+JyArXG4gICAgdmFsICtcbiAgICAnPC9zcGFuPicgK1xuICAgIGNoaXAgK1xuICAgIHJlc2V0QnRuICtcbiAgICBhdXRvSGludCArXG4gICAgJzwvc3Bhbj4nXG4gICk7XG59XG5cbndpbmRvdy5lZGl0TXVsdGlwbGllciA9IGZ1bmN0aW9uIChlbCwgc2t1VXBwZXIpIHtcbiAgY29uc3QgY3VycmVudFZhbCA9IHBhcnNlRmxvYXQoZWwudGV4dENvbnRlbnQpIHx8IDEuMDtcbiAgY29uc3QgaW5wdXQgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdpbnB1dCcpO1xuICBpbnB1dC50eXBlID0gJ251bWJlcic7XG4gIGlucHV0LnN0ZXAgPSAnMC4wNSc7XG4gIGlucHV0Lm1pbiA9ICcwLjEnO1xuICBpbnB1dC5tYXggPSAnNSc7XG4gIGlucHV0LnZhbHVlID0gU3RyaW5nKGN1cnJlbnRWYWwpO1xuICBpbnB1dC5zdHlsZS5jc3NUZXh0ID1cbiAgICAnd2lkdGg6NjBweDtwYWRkaW5nOjJweCA0cHg7Zm9udC1zaXplOjEycHg7Zm9udC13ZWlnaHQ6NzAwO3RleHQtYWxpZ246Y2VudGVyO2JvcmRlcjoycHggc29saWQgIzBkOTQ4ODtib3JkZXItcmFkaXVzOjRweDtiYWNrZ3JvdW5kOnZhcigtLWJnLWVsZXZhdGVkKTtjb2xvcjp2YXIoLS10ZXh0LXByaW1hcnkpO2ZvbnQtdmFyaWFudC1udW1lcmljOnRhYnVsYXItbnVtcyc7XG4gIGNvbnN0IHBhcmVudCA9IGVsLnBhcmVudE5vZGU7XG4gIHBhcmVudC5yZXBsYWNlQ2hpbGQoaW5wdXQsIGVsKTtcbiAgaW5wdXQuZm9jdXMoKTtcbiAgaW5wdXQuc2VsZWN0KCk7XG5cbiAgY29uc3QgY29tbWl0ID0gYXN5bmMgKCkgPT4ge1xuICAgIGNvbnN0IHYgPSBwYXJzZUZsb2F0KGlucHV0LnZhbHVlKTtcbiAgICBpZiAoTnVtYmVyLmlzTmFOKHYpIHx8IHYgPCAwLjEgfHwgdiA+IDUpIHtcbiAgICAgIF9yZW5kZXJSZWNvU2VjdGlvbigpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBpZiAoTWF0aC5hYnModiAtIGN1cnJlbnRWYWwpIDwgMC4wMDEpIHtcbiAgICAgIF9yZW5kZXJSZWNvU2VjdGlvbigpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICB0cnkge1xuICAgICAgYXdhaXQgX3NhdmVNdWx0aXBsaWVyT3ZlcnJpZGUoc2t1VXBwZXIsIHYpO1xuICAgICAgX3JlbmRlclJlY29TZWN0aW9uKCk7XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgYWxlcnQoJ0Vycm9yIGd1YXJkYW5kbzogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xuICAgICAgX3JlbmRlclJlY29TZWN0aW9uKCk7XG4gICAgfVxuICB9O1xuXG4gIGNvbnN0IGNhbmNlbCA9ICgpID0+IF9yZW5kZXJSZWNvU2VjdGlvbigpO1xuXG4gIGlucHV0LmFkZEV2ZW50TGlzdGVuZXIoJ2JsdXInLCBjb21taXQpO1xuICBpbnB1dC5hZGRFdmVudExpc3RlbmVyKCdrZXlkb3duJywgKGV2KSA9PiB7XG4gICAgaWYgKGV2LmtleSA9PT0gJ0VudGVyJykge1xuICAgICAgZXYucHJldmVudERlZmF1bHQoKTtcbiAgICAgIGlucHV0LmJsdXIoKTtcbiAgICB9IGVsc2UgaWYgKGV2LmtleSA9PT0gJ0VzY2FwZScpIHtcbiAgICAgIGV2LnByZXZlbnREZWZhdWx0KCk7XG4gICAgICBjYW5jZWwoKTtcbiAgICB9XG4gIH0pO1xufTtcblxud2luZG93LnJlc2V0TXVsdGlwbGllciA9IGFzeW5jIGZ1bmN0aW9uIChza3VVcHBlcikge1xuICBpZiAoIWNvbmZpcm0oJ1ZvbHZlciBlbCBtdWx0aXBsaWNhZG9yIGRlICcgKyBza3VVcHBlciArICcgYWwgY1x1MDBFMWxjdWxvIGF1dG9tXHUwMEUxdGljbz8nKSkgcmV0dXJuO1xuICB0cnkge1xuICAgIGF3YWl0IF9yZW1vdmVNdWx0aXBsaWVyT3ZlcnJpZGUoc2t1VXBwZXIpO1xuICAgIF9yZW5kZXJSZWNvU2VjdGlvbigpO1xuICB9IGNhdGNoIChlKSB7XG4gICAgYWxlcnQoJ0Vycm9yOiAnICsgKGUubWVzc2FnZSB8fCBlKSk7XG4gIH1cbn07XG5cbmZ1bmN0aW9uIF9yZW5kZXJSZWNvU2VjdGlvbigpIHtcbiAgY29uc3QgY29udCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdyZWNvLXNlY3Rpb24tY29udGFpbmVyJyk7XG4gIGlmICghY29udCkgcmV0dXJuO1xuICB0cnkge1xuICAgIF9yZW5kZXJSZWNvU2VjdGlvbkltcGwoY29udCk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBjb25zb2xlLmVycm9yKCdbRk9SRUNBU1QgcmVjb10gcmVuZGVyIGZhaWwnLCBlKTtcbiAgICBjb250LmlubmVySFRNTCA9XG4gICAgICAnPGRpdiBzdHlsZT1cInBhZGRpbmc6MjBweDtjb2xvcjojZGMyNjI2XCI+JyArXG4gICAgICAnPGRpdiBzdHlsZT1cImZvbnQtd2VpZ2h0OjcwMDttYXJnaW4tYm90dG9tOjhweFwiPkVycm9yIHJlbmRlcml6YW5kbyB0YWJsYSByZWNvbWVuZGFjaVx1MDBGM248L2Rpdj4nICtcbiAgICAgICc8cHJlIHN0eWxlPVwiZm9udC1zaXplOjExcHg7YmFja2dyb3VuZDojZmVmMmYyO3BhZGRpbmc6MTBweDtib3JkZXItcmFkaXVzOjZweDtvdmVyZmxvdzphdXRvO3doaXRlLXNwYWNlOnByZS13cmFwXCI+JyArXG4gICAgICBlc2NhcGVIdG1sU2FmZShlLnN0YWNrIHx8IGUubWVzc2FnZSB8fCBTdHJpbmcoZSkpICtcbiAgICAgICc8L3ByZT48L2Rpdj4nO1xuICB9XG59XG5cbmZ1bmN0aW9uIF9yZW5kZXJSZWNvU2VjdGlvbkltcGwoY29udCkge1xuICBjb25zdCBhbnlMb2FkZWQgPSAhIShfc2FsZXNQbGFuQ2FjaGVzLnJvZHMgfHwgX3NhbGVzUGxhbkNhY2hlcy5yZWVscyk7XG4gIGlmICghYW55TG9hZGVkKSB7XG4gICAgY29udC5pbm5lckhUTUwgPSAnJztcbiAgICByZXR1cm47XG4gIH1cbiAgaWYgKCFfcmVjb1N0b2NrU25hcHNob3QgfHwgIV9yZWNvVmVudGFzU25hcHNob3QpIHtcbiAgICBjb250LmlubmVySFRNTCA9XG4gICAgICAnPGRpdiBzdHlsZT1cInBhZGRpbmc6NDBweCAxOHB4O3RleHQtYWxpZ246Y2VudGVyO2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpXCI+JyArXG4gICAgICAnPGRpdiBzdHlsZT1cImRpc3BsYXk6aW5saW5lLWJsb2NrO3dpZHRoOjI0cHg7aGVpZ2h0OjI0cHg7Ym9yZGVyOjNweCBzb2xpZCAjMGQ5NDg4O2JvcmRlci10b3AtY29sb3I6dHJhbnNwYXJlbnQ7Ym9yZGVyLXJhZGl1czo1MCU7YW5pbWF0aW9uOnNwaW4gMC44cyBsaW5lYXIgaW5maW5pdGU7bWFyZ2luLWJvdHRvbToxMHB4XCI+PC9kaXY+JyArXG4gICAgICAnPGRpdj5DYXJnYW5kbyBzdG9jayArIHZlbnRhcyBoaXN0XHUwMEYzcmljYXMuLi48L2Rpdj4nICtcbiAgICAgICc8c3R5bGU+QGtleWZyYW1lcyBzcGlue3Rve3RyYW5zZm9ybTpyb3RhdGUoMzYwZGVnKX19PC9zdHlsZT48L2Rpdj4nO1xuICAgIF9sb2FkUmVjb0RhdGEoKVxuICAgICAgLnRoZW4oX3JlbmRlclJlY29TZWN0aW9uKVxuICAgICAgLmNhdGNoKChlKSA9PiB7XG4gICAgICAgIGNvbnNvbGUuZXJyb3IoJ1tGT1JFQ0FTVCByZWNvXSBsb2FkIGZhaWwnLCBlKTtcbiAgICAgICAgY29udC5pbm5lckhUTUwgPVxuICAgICAgICAgICc8ZGl2IHN0eWxlPVwicGFkZGluZzoyMHB4O2NvbG9yOiNkYzI2MjZcIj5FcnJvciBjYXJnYW5kbyBkYXRvczogJyArXG4gICAgICAgICAgZXNjYXBlSHRtbFNhZmUoZS5tZXNzYWdlIHx8IFN0cmluZyhlKSkgK1xuICAgICAgICAgICc8L2Rpdj4nO1xuICAgICAgfSk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGNvbnN0IGFsbFJvd3MgPSBfY29tcHV0ZVJlY29tbWVuZGF0aW9ucygpO1xuICBjb25zdCBzZWFyY2hMYyA9IF9yZWNvU2VhcmNoVGV4dC50cmltKCkudG9Mb3dlckNhc2UoKTtcbiAgY29uc3Qgcm93cyA9IGFsbFJvd3MuZmlsdGVyKChyKSA9PiB7XG4gICAgaWYgKF9yZWNvRmlsdGVyRmFtaWxpYSAhPT0gJ2FsbCcgJiYgci5mYW1pbGlhICE9PSBfcmVjb0ZpbHRlckZhbWlsaWEpIHJldHVybiBmYWxzZTtcbiAgICBpZiAoX3JlY29GaWx0ZXJNaW5SZWMgJiYgci5yZWNvbWVuZGFkbyA8PSAwKSByZXR1cm4gZmFsc2U7XG4gICAgaWYgKHNlYXJjaExjKSB7XG4gICAgICBjb25zdCBoYXkgPVxuICAgICAgICByLnNrdS50b0xvd2VyQ2FzZSgpLmluY2x1ZGVzKHNlYXJjaExjKSB8fCByLmRlc2NyaXB0aW9uLnRvTG93ZXJDYXNlKCkuaW5jbHVkZXMoc2VhcmNoTGMpO1xuICAgICAgaWYgKCFoYXkpIHJldHVybiBmYWxzZTtcbiAgICB9XG4gICAgcmV0dXJuIHRydWU7XG4gIH0pO1xuICBjb25zdCB0b3RhbFJlY28gPSBhbGxSb3dzLnJlZHVjZSgocywgcikgPT4gcyArIHIucmVjb21lbmRhZG8sIDApO1xuICBjb25zdCB0b3RhbENvblJlY28gPSBhbGxSb3dzLmZpbHRlcigocikgPT4gci5yZWNvbWVuZGFkbyA+IDApLmxlbmd0aDtcblxuICBjb25zdCBuRGlzYyA9IF9kaXNjb250aW51ZWRTa3VzID8gX2Rpc2NvbnRpbnVlZFNrdXMuc2l6ZSA6IDA7XG4gIGNvbnN0IGRpc2NDaGlwID1cbiAgICBuRGlzYyA+IDBcbiAgICAgID8gJzxidXR0b24gb25jbGljaz1cIm9wZW5EaXNjb250aW51ZWRNb2RhbCgpXCIgc3R5bGU9XCJwYWRkaW5nOjZweCAxMnB4O2JhY2tncm91bmQ6IzkzMzNlYTtjb2xvcjojZmZmO2JvcmRlcjpub25lO2JvcmRlci1yYWRpdXM6NnB4O2ZvbnQtc2l6ZToxMnB4O2ZvbnQtd2VpZ2h0OjcwMDtjdXJzb3I6cG9pbnRlclwiIHRpdGxlPVwiR2VzdGlvbmFyIFNLVXMgZGVzY29udGludWFkb3NcIj5cdUQ4M0RcdURFQUIgJyArXG4gICAgICAgIF9mbXRJbnQobkRpc2MpICtcbiAgICAgICAgJyBkZXNjb250aW51YWRvczwvYnV0dG9uPidcbiAgICAgIDogJyc7XG5cbiAgY29uc3QgaGVhZGVyID1cbiAgICAnPGRpdiBzdHlsZT1cImRpc3BsYXk6ZmxleDtmbGV4LXdyYXA6d3JhcDtnYXA6MTBweDthbGlnbi1pdGVtczpjZW50ZXI7bWFyZ2luLWJvdHRvbToxMnB4XCI+JyArXG4gICAgJzxkaXYgc3R5bGU9XCJmbGV4OjE7bWluLXdpZHRoOjI4MHB4XCI+PGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxOHB4O2ZvbnQtd2VpZ2h0OjgwMDtjb2xvcjp2YXIoLS10ZXh0LXByaW1hcnkpXCI+UmVjb21lbmRhY2lcdTAwRjNuIGRlIENvbXByYTwvZGl2PicgK1xuICAgICc8ZGl2IHN0eWxlPVwiZm9udC1zaXplOjExcHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7bWFyZ2luLXRvcDoycHhcIj5CYWxhbmNlID0gU3RvY2sgKyBUclx1MDBFMW5zaXRvICsgUGxhbiBcdTIyMTIgQmFja29yZGVyIFx1MjIxMiAoVmVudGEgbWVucy4gXHUwMEQ3ICcgK1xuICAgIFJFQ09fSE9SSVpPTl9NT05USFMgK1xuICAgICdtKTwvZGl2PjwvZGl2PicgK1xuICAgICc8ZGl2IHN0eWxlPVwicGFkZGluZzo2cHggMTJweDtiYWNrZ3JvdW5kOiMwZDk0ODg7Y29sb3I6I2ZmZjtib3JkZXItcmFkaXVzOjZweDtmb250LXNpemU6MTJweDtmb250LXdlaWdodDo3MDBcIj4nICtcbiAgICBfZm10SW50KHRvdGFsQ29uUmVjbykgK1xuICAgICcgU0tVcyBjb24gcmVjbzwvZGl2PicgK1xuICAgICc8ZGl2IHN0eWxlPVwicGFkZGluZzo2cHggMTJweDtiYWNrZ3JvdW5kOiMxMzRlNGE7Y29sb3I6I2ZmZjtib3JkZXItcmFkaXVzOjZweDtmb250LXNpemU6MTJweDtmb250LXdlaWdodDo3MDBcIj5cdTAzQTMgJyArXG4gICAgX2ZtdEludCh0b3RhbFJlY28pICtcbiAgICAnIHVuaWRhZGVzPC9kaXY+JyArXG4gICAgZGlzY0NoaXAgK1xuICAgICc8L2Rpdj4nO1xuXG4gIGNvbnN0IGZpbHRlcnMgPVxuICAgICc8ZGl2IHN0eWxlPVwiZGlzcGxheTpmbGV4O2ZsZXgtd3JhcDp3cmFwO2dhcDo4cHg7bWFyZ2luLWJvdHRvbToxMHB4O3BhZGRpbmc6MTBweDtiYWNrZ3JvdW5kOnZhcigtLWJnLXNlY29uZGFyeSk7Ym9yZGVyLXJhZGl1czo2cHhcIj4nICtcbiAgICAnPGlucHV0IHR5cGU9XCJ0ZXh0XCIgaWQ9XCJyZWNvLXNlYXJjaFwiIHBsYWNlaG9sZGVyPVwiQnVzY2FyIFNLVSBvIGRlc2NyaXBjaW9uLi4uXCIgdmFsdWU9XCInICtcbiAgICBlc2NhcGVIdG1sU2FmZShfcmVjb1NlYXJjaFRleHQpICtcbiAgICAnXCIgb25pbnB1dD1cIm9uUmVjb1NlYXJjaENoYW5nZShldmVudClcIiBzdHlsZT1cImZsZXg6MTttaW4td2lkdGg6MjAwcHg7cGFkZGluZzo2cHggMTBweDtib3JkZXI6MXB4IHNvbGlkIHZhcigtLWJvcmRlci1zdWJ0bGUpO2JvcmRlci1yYWRpdXM6NHB4O2ZvbnQtc2l6ZToxMnB4O2JhY2tncm91bmQ6dmFyKC0tYmctZWxldmF0ZWQpO2NvbG9yOnZhcigtLXRleHQtcHJpbWFyeSlcIi8+JyArXG4gICAgJzxzZWxlY3Qgb25jaGFuZ2U9XCJvblJlY29GYW1pbGlhQ2hhbmdlKGV2ZW50KVwiIHN0eWxlPVwicGFkZGluZzo2cHggMTBweDtib3JkZXI6MXB4IHNvbGlkIHZhcigtLWJvcmRlci1zdWJ0bGUpO2JvcmRlci1yYWRpdXM6NHB4O2ZvbnQtc2l6ZToxMnB4O2JhY2tncm91bmQ6dmFyKC0tYmctZWxldmF0ZWQpO2NvbG9yOnZhcigtLXRleHQtcHJpbWFyeSlcIj4nICtcbiAgICAnPG9wdGlvbiB2YWx1ZT1cImFsbFwiJyArXG4gICAgKF9yZWNvRmlsdGVyRmFtaWxpYSA9PT0gJ2FsbCcgPyAnIHNlbGVjdGVkJyA6ICcnKSArXG4gICAgJz5Ub2RhcyBsYXMgZmFtaWxpYXM8L29wdGlvbj4nICtcbiAgICAnPG9wdGlvbiB2YWx1ZT1cInJvZHNcIicgK1xuICAgIChfcmVjb0ZpbHRlckZhbWlsaWEgPT09ICdyb2RzJyA/ICcgc2VsZWN0ZWQnIDogJycpICtcbiAgICAnPlNvbG8gUm9kcyAoQ2FcdTAwRjFhcyk8L29wdGlvbj4nICtcbiAgICAnPG9wdGlvbiB2YWx1ZT1cInJlZWxzXCInICtcbiAgICAoX3JlY29GaWx0ZXJGYW1pbGlhID09PSAncmVlbHMnID8gJyBzZWxlY3RlZCcgOiAnJykgK1xuICAgICc+U29sbyBSZWVsczwvb3B0aW9uPicgK1xuICAgICc8L3NlbGVjdD4nICtcbiAgICAnPGxhYmVsIHN0eWxlPVwiZGlzcGxheTppbmxpbmUtZmxleDthbGlnbi1pdGVtczpjZW50ZXI7Z2FwOjZweDtwYWRkaW5nOjZweCAxMHB4O2ZvbnQtc2l6ZToxMnB4O2NvbG9yOnZhcigtLXRleHQtcHJpbWFyeSk7Y3Vyc29yOnBvaW50ZXJcIj4nICtcbiAgICAnPGlucHV0IHR5cGU9XCJjaGVja2JveFwiJyArXG4gICAgKF9yZWNvRmlsdGVyTWluUmVjID8gJyBjaGVja2VkJyA6ICcnKSArXG4gICAgJyBvbmNoYW5nZT1cIm9uUmVjb0ZpbHRlck1pbkNoYW5nZShldmVudClcIi8+JyArXG4gICAgJ1NvbG8gY29uIHJlY29tZW5kYWRvICZndDsgMDwvbGFiZWw+JyArXG4gICAgJzxidXR0b24gb25jbGljaz1cImV4cG9ydFJlY29FeGNlbCgpXCIgc3R5bGU9XCJwYWRkaW5nOjZweCAxMnB4O2JhY2tncm91bmQ6IzE2YTM0YTtjb2xvcjojZmZmO2JvcmRlcjpub25lO2JvcmRlci1yYWRpdXM6NHB4O2ZvbnQtc2l6ZToxMnB4O2ZvbnQtd2VpZ2h0OjcwMDtjdXJzb3I6cG9pbnRlclwiPlx1MkIwNyBFeGNlbDwvYnV0dG9uPicgK1xuICAgICc8L2Rpdj4nO1xuXG4gIGNvbnN0IHJvd3NIdG1sID0gcm93c1xuICAgIC5tYXAoKHIpID0+IHtcbiAgICAgIGNvbnN0IGJhbENvbG9yID0gci5iYWxhbmNlIDwgMCA/ICcjZGMyNjI2JyA6IHIuYmFsYW5jZSA8IDUwID8gJyNmNTllMGInIDogJyMxNmEzNGEnO1xuICAgICAgY29uc3QgcmVjQ29sb3IgPSByLnJlY29tZW5kYWRvID4gMCA/ICcjZGMyNjI2JyA6ICcjOTRhM2I4JztcbiAgICAgIHJldHVybiAoXG4gICAgICAgICc8dHIgc3R5bGU9XCJib3JkZXItYm90dG9tOjFweCBzb2xpZCB2YXIoLS1ib3JkZXItc3VidGxlKVwiPicgK1xuICAgICAgICAnPHRkIHN0eWxlPVwicGFkZGluZzo2cHggOHB4O3RleHQtYWxpZ246Y2VudGVyXCI+PHNwYW4gc3R5bGU9XCJkaXNwbGF5OmlubGluZS1ibG9jaztwYWRkaW5nOjJweCA2cHg7Ym9yZGVyLXJhZGl1czoxMHB4O2JhY2tncm91bmQ6JyArXG4gICAgICAgIChyLmZhbWlsaWEgPT09ICdyb2RzJyA/ICcjMGVhNWU5JyA6ICcjOGI1Y2Y2JykgK1xuICAgICAgICAnO2NvbG9yOiNmZmY7Zm9udC1zaXplOjEwcHg7Zm9udC13ZWlnaHQ6NzAwXCI+JyArXG4gICAgICAgIChyLmZhbWlsaWEgPT09ICdyb2RzJyA/ICdST0QnIDogJ1JFRUwnKSArXG4gICAgICAgICc8L3NwYW4+PC90ZD4nICtcbiAgICAgICAgJzx0ZCBzdHlsZT1cInBhZGRpbmc6NnB4IDhweDt0ZXh0LWFsaWduOmNlbnRlcjtmb250LWZhbWlseTptb25vc3BhY2U7Zm9udC1zaXplOjExcHg7Y29sb3I6dmFyKC0tdGV4dC1wcmltYXJ5KTtmb250LXdlaWdodDo3MDBcIj4nICtcbiAgICAgICAgZXNjYXBlSHRtbFNhZmUoci5za3UpICtcbiAgICAgICAgJzwvdGQ+JyArXG4gICAgICAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjZweCA4cHg7Zm9udC1zaXplOjExcHg7Y29sb3I6dmFyKC0tdGV4dC1zZWNvbmRhcnkpO21heC13aWR0aDoyNDBweDtvdmVyZmxvdzpoaWRkZW47dGV4dC1vdmVyZmxvdzplbGxpcHNpczt3aGl0ZS1zcGFjZTpub3dyYXBcIiB0aXRsZT1cIicgK1xuICAgICAgICBlc2NhcGVIdG1sU2FmZShyLmRlc2NyaXB0aW9uKSArXG4gICAgICAgICdcIj4nICtcbiAgICAgICAgZXNjYXBlSHRtbFNhZmUoci5kZXNjcmlwdGlvbikgK1xuICAgICAgICAnPC90ZD4nICtcbiAgICAgICAgJzx0ZCBzdHlsZT1cInBhZGRpbmc6NnB4IDhweDt0ZXh0LWFsaWduOmNlbnRlcjtmb250LXZhcmlhbnQtbnVtZXJpYzp0YWJ1bGFyLW51bXM7Y29sb3I6dmFyKC0tdGV4dC1wcmltYXJ5KVwiPicgK1xuICAgICAgICBfZm10SW50KHIuc3RvY2tMaWJyZSkgK1xuICAgICAgICAnPC90ZD4nICtcbiAgICAgICAgJzx0ZCBzdHlsZT1cInBhZGRpbmc6NnB4IDhweDt0ZXh0LWFsaWduOmNlbnRlcjtmb250LXZhcmlhbnQtbnVtZXJpYzp0YWJ1bGFyLW51bXM7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZClcIj4nICtcbiAgICAgICAgX2ZtdEludChyLmVuVHJhbnNpdG8pICtcbiAgICAgICAgJzwvdGQ+JyArXG4gICAgICAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjZweCA4cHg7dGV4dC1hbGlnbjpjZW50ZXI7Zm9udC12YXJpYW50LW51bWVyaWM6dGFidWxhci1udW1zO2NvbG9yOiNkYzI2MjZcIj4nICtcbiAgICAgICAgX2ZtdEludChyLmJhY2tvcmRlcikgK1xuICAgICAgICAnPC90ZD4nICtcbiAgICAgICAgJzx0ZCBzdHlsZT1cInBhZGRpbmc6NnB4IDhweDt0ZXh0LWFsaWduOmNlbnRlcjtmb250LXZhcmlhbnQtbnVtZXJpYzp0YWJ1bGFyLW51bXM7Y29sb3I6dmFyKC0tdGV4dC1zZWNvbmRhcnkpXCI+JyArXG4gICAgICAgIF9mbXRJbnQoci52ZW50YU1lbnN1YWwpICtcbiAgICAgICAgJzwvdGQ+JyArXG4gICAgICAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjZweCA4cHg7dGV4dC1hbGlnbjpjZW50ZXJcIj4nICtcbiAgICAgICAgX2J1aWxkTXVsdENlbGxIdG1sKHIpICtcbiAgICAgICAgJzwvdGQ+JyArXG4gICAgICAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjZweCA4cHg7dGV4dC1hbGlnbjpjZW50ZXI7Zm9udC12YXJpYW50LW51bWVyaWM6dGFidWxhci1udW1zO2NvbG9yOnZhcigtLXRleHQtc2Vjb25kYXJ5KVwiPicgK1xuICAgICAgICBfZm10SW50KHIuZGVtYW5kYUVzcGVyYWRhKSArXG4gICAgICAgICc8L3RkPicgK1xuICAgICAgICAnPHRkIHN0eWxlPVwicGFkZGluZzo2cHggOHB4O3RleHQtYWxpZ246Y2VudGVyO2ZvbnQtdmFyaWFudC1udW1lcmljOnRhYnVsYXItbnVtcztjb2xvcjp2YXIoLS10ZXh0LXByaW1hcnkpO2ZvbnQtd2VpZ2h0OjYwMFwiPicgK1xuICAgICAgICBfZm10SW50KHIuc2FsZXNQbGFuRnV0KSArXG4gICAgICAgICc8L3RkPicgK1xuICAgICAgICAnPHRkIHN0eWxlPVwicGFkZGluZzo2cHggOHB4O3RleHQtYWxpZ246Y2VudGVyO2ZvbnQtdmFyaWFudC1udW1lcmljOnRhYnVsYXItbnVtcztmb250LXdlaWdodDo3MDA7Y29sb3I6JyArXG4gICAgICAgIGJhbENvbG9yICtcbiAgICAgICAgJ1wiPicgK1xuICAgICAgICBfZm10TnVtU2lnbmVkKHIuYmFsYW5jZSkgK1xuICAgICAgICAnPC90ZD4nICtcbiAgICAgICAgJzx0ZCBzdHlsZT1cInBhZGRpbmc6NnB4IDhweDt0ZXh0LWFsaWduOmNlbnRlcjtmb250LXZhcmlhbnQtbnVtZXJpYzp0YWJ1bGFyLW51bXM7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7Zm9udC1zaXplOjExcHhcIj4nICtcbiAgICAgICAgX2ZtdEludChyLm1vcSkgK1xuICAgICAgICAnPC90ZD4nICtcbiAgICAgICAgJzx0ZCBzdHlsZT1cInBhZGRpbmc6NnB4IDhweDt0ZXh0LWFsaWduOmNlbnRlclwiPjxzcGFuIHN0eWxlPVwiZGlzcGxheTppbmxpbmUtYmxvY2s7cGFkZGluZzo0cHggMTBweDtib3JkZXItcmFkaXVzOjEycHg7YmFja2dyb3VuZDonICtcbiAgICAgICAgcmVjQ29sb3IgK1xuICAgICAgICAnO2NvbG9yOiNmZmY7Zm9udC1zaXplOjEycHg7Zm9udC13ZWlnaHQ6ODAwO21pbi13aWR0aDo1MHB4XCI+JyArXG4gICAgICAgIF9mbXRJbnQoci5yZWNvbWVuZGFkbykgK1xuICAgICAgICAnPC9zcGFuPjwvdGQ+JyArXG4gICAgICAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjZweCA4cHg7dGV4dC1hbGlnbjpjZW50ZXJcIj4nICtcbiAgICAgICAgJzxidXR0b24gb25jbGljaz1cImRpc2NvbnRpbnVlU2t1KFxcJycgK1xuICAgICAgICBlc2NhcGVIdG1sU2FmZShyLnNrdSkgK1xuICAgICAgICBcIicsICdcIiArXG4gICAgICAgIGVzY2FwZUh0bWxTYWZlKHIuZGVzY3JpcHRpb24ucmVwbGFjZSgvJy9nLCAnJykpICtcbiAgICAgICAgJ1xcJylcIiB0aXRsZT1cIkRlc2NvbnRpbnVhciBlc3RlIFNLVVwiIHN0eWxlPVwiYmFja2dyb3VuZDp0cmFuc3BhcmVudDtib3JkZXI6MXB4IHNvbGlkIHZhcigtLWJvcmRlci1zdWJ0bGUpO2JvcmRlci1yYWRpdXM6NHB4O3BhZGRpbmc6NHB4IDhweDtjdXJzb3I6cG9pbnRlcjtmb250LXNpemU6MTRweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKVwiPlx1RDgzRFx1REREMTwvYnV0dG9uPicgK1xuICAgICAgICAnPC90ZD4nICtcbiAgICAgICAgJzwvdHI+J1xuICAgICAgKTtcbiAgICB9KVxuICAgIC5qb2luKCcnKTtcblxuICAvLyB2MTExMjogbWluLXdpZHRoIHBhcmEgZm9yemFyIHNjcm9sbCBob3Jpem9udGFsIHNpIG5vIGNhYmUgbGEgY29sdW1uYVxuICAvLyBBY2NpXHUwMEYzbi4gU2luIGVzdG8sIHRhYmxlIHdpZHRoOjEwMCUgY29tcHJpbWUgdG9kbyB5IGxhIFx1MDBGQWx0aW1hIGNvbHVtbmFcbiAgLy8gcXVlZGEgZnVlcmEgZGVsIHZpZXdwb3J0IHNpbiBzY3JvbGwgdmlzaWJsZS5cbiAgY29uc3QgdGFibGUgPVxuICAgICc8ZGl2IHN0eWxlPVwib3ZlcmZsb3c6YXV0bzttYXgtaGVpZ2h0OjYwdmg7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1ib3JkZXItc3VidGxlKTtib3JkZXItcmFkaXVzOjhweFwiPicgK1xuICAgICc8dGFibGUgc3R5bGU9XCJ3aWR0aDoxMDAlO21pbi13aWR0aDoxNDAwcHg7Ym9yZGVyLWNvbGxhcHNlOmNvbGxhcHNlO2ZvbnQtc2l6ZToxMnB4XCI+JyArXG4gICAgJzx0aGVhZCBzdHlsZT1cImJhY2tncm91bmQ6IzBmMTcyYTtjb2xvcjojZmZmO3Bvc2l0aW9uOnN0aWNreTt0b3A6MDt6LWluZGV4OjFcIj48dHI+JyArXG4gICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6OHB4O3RleHQtYWxpZ246Y2VudGVyO2ZvbnQtc2l6ZToxMHB4O3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZVwiPkZhbTwvdGg+JyArXG4gICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6OHB4O3RleHQtYWxpZ246Y2VudGVyO2ZvbnQtc2l6ZToxMHB4O3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZVwiPlNLVTwvdGg+JyArXG4gICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6OHB4O3RleHQtYWxpZ246Y2VudGVyO2ZvbnQtc2l6ZToxMHB4O3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZVwiPkRlc2NyaXBjaVx1MDBGM248L3RoPicgK1xuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjhweDt0ZXh0LWFsaWduOmNlbnRlcjtmb250LXNpemU6MTBweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2VcIiB0aXRsZT1cIldocyAxMSBkaXNwb25pYmxlIHZlbnRhXCI+U3RvY2s8L3RoPicgK1xuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjhweDt0ZXh0LWFsaWduOmNlbnRlcjtmb250LXNpemU6MTBweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2VcIiB0aXRsZT1cIldocyAxMlwiPlRyXHUwMEUxbnNpdG88L3RoPicgK1xuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjhweDt0ZXh0LWFsaWduOmNlbnRlcjtmb250LXNpemU6MTBweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2VcIj5CYWNrb3JkZXI8L3RoPicgK1xuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjhweDt0ZXh0LWFsaWduOmNlbnRlcjtmb250LXNpemU6MTBweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2VcIiB0aXRsZT1cIlByb21lZGlvIFx1MDBGQWx0aW1vcyAzIG1lc2VzXCI+VnRhL21lczwvdGg+JyArXG4gICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6OHB4O3RleHQtYWxpZ246Y2VudGVyO2ZvbnQtc2l6ZToxMHB4O3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZVwiIHRpdGxlPVwiTXVsdGlwbGljYWRvciBkZSB0ZW5kZW5jaWEgPSB2ZW50YSAybSAvIHZlbnRhIDZtLiBFZGl0YWJsZSAoY2xpY2sgcGFyYSBvdmVycmlkZSkuXCI+TXVsdGlwLjwvdGg+JyArXG4gICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6OHB4O3RleHQtYWxpZ246Y2VudGVyO2ZvbnQtc2l6ZToxMHB4O3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZVwiIHRpdGxlPVwiVnRhL21lcyBcdTAwRDcgNyBtZXNlc1wiPkRlbWFuZGEgZXNwLjwvdGg+JyArXG4gICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6OHB4O3RleHQtYWxpZ246Y2VudGVyO2ZvbnQtc2l6ZToxMHB4O3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZVwiIHRpdGxlPVwiU3VtYSBjb2x1bW5hcyBTYWxlcyBQbGFuIGRlc2RlIG1lcyBhY3R1YWxcIj5QbGFuIGZ1dHVybzwvdGg+JyArXG4gICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6OHB4O3RleHQtYWxpZ246Y2VudGVyO2ZvbnQtc2l6ZToxMHB4O3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZVwiPkJhbGFuY2U8L3RoPicgK1xuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjhweDt0ZXh0LWFsaWduOmNlbnRlcjtmb250LXNpemU6MTBweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2VcIj5NT1E8L3RoPicgK1xuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjhweDt0ZXh0LWFsaWduOmNlbnRlcjtmb250LXNpemU6MTBweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7YmFja2dyb3VuZDojMTM0ZTRhXCI+UmVjb21lbmRhZG88L3RoPicgK1xuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjhweDt0ZXh0LWFsaWduOmNlbnRlcjtmb250LXNpemU6MTBweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2VcIiB0aXRsZT1cIkRlc2NvbnRpbnVhciBTS1VcIj5BY2NpXHUwMEYzbjwvdGg+JyArXG4gICAgJzwvdHI+PC90aGVhZD48dGJvZHk+JyArXG4gICAgKHJvd3MubGVuZ3RoXG4gICAgICA/IHJvd3NIdG1sXG4gICAgICA6ICc8dHI+PHRkIGNvbHNwYW49XCIxNFwiIHN0eWxlPVwicGFkZGluZzo0MHB4O3RleHQtYWxpZ246Y2VudGVyO2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpXCI+U2luIHJlc3VsdGFkb3MgY29uIGxvcyBmaWx0cm9zIGFjdHVhbGVzPC90ZD48L3RyPicpICtcbiAgICAnPC90Ym9keT48L3RhYmxlPjwvZGl2Pic7XG5cbiAgY29uc3QgZm9vdGVyID1cbiAgICAnPGRpdiBzdHlsZT1cIm1hcmdpbi10b3A6OHB4O2ZvbnQtc2l6ZToxMHB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpXCI+JyArXG4gICAgJ01vc3RyYW5kbyAnICtcbiAgICBfZm10SW50KHJvd3MubGVuZ3RoKSArXG4gICAgJyBkZSAnICtcbiAgICBfZm10SW50KGFsbFJvd3MubGVuZ3RoKSArXG4gICAgJyBTS1VzIFx1MDBCNyAnICtcbiAgICAnQmFsYW5jZSA9IFN0b2NrICsgVHJcdTAwRTFuc2l0byArIFBsYW4gXHUyMjEyIEJhY2tvcmRlciBcdTIyMTIgRGVtYW5kYS4gUm9qbyA9IHF1aWVicmUgZXNwZXJhZG8uIFJlY29tZW5kYWRvIHNlIHJlZG9uZGVhIGFsIG1cdTAwRkFsdGlwbG8gZGUgTU9RIHN1cGVyaW9yLicgK1xuICAgICc8L2Rpdj4nO1xuXG4gIGNvbnQuaW5uZXJIVE1MID1cbiAgICAnPGRpdiBzdHlsZT1cInBhZGRpbmc6MThweCAxOHB4IDMwcHhcIj4nICsgaGVhZGVyICsgZmlsdGVycyArIHRhYmxlICsgZm9vdGVyICsgJzwvZGl2Pic7XG59XG5cbndpbmRvdy5vblJlY29TZWFyY2hDaGFuZ2UgPSBmdW5jdGlvbiAoZXYpIHtcbiAgX3JlY29TZWFyY2hUZXh0ID0gZXYudGFyZ2V0LnZhbHVlIHx8ICcnO1xuICBfcmVuZGVyUmVjb1NlY3Rpb24oKTtcbiAgLy8gUmVzdGF1cmFyIGZvY3VzICsgY2FyZXQgYWwgaW5wdXRcbiAgc2V0VGltZW91dCgoKSA9PiB7XG4gICAgY29uc3QgaW5wID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3JlY28tc2VhcmNoJyk7XG4gICAgaWYgKGlucCkge1xuICAgICAgaW5wLmZvY3VzKCk7XG4gICAgICBpbnAuc2V0U2VsZWN0aW9uUmFuZ2UoaW5wLnZhbHVlLmxlbmd0aCwgaW5wLnZhbHVlLmxlbmd0aCk7XG4gICAgfVxuICB9LCAwKTtcbn07XG5cbndpbmRvdy5vblJlY29GYW1pbGlhQ2hhbmdlID0gZnVuY3Rpb24gKGV2KSB7XG4gIF9yZWNvRmlsdGVyRmFtaWxpYSA9IGV2LnRhcmdldC52YWx1ZSB8fCAnYWxsJztcbiAgX3JlbmRlclJlY29TZWN0aW9uKCk7XG59O1xuXG53aW5kb3cub25SZWNvRmlsdGVyTWluQ2hhbmdlID0gZnVuY3Rpb24gKGV2KSB7XG4gIF9yZWNvRmlsdGVyTWluUmVjID0gISFldi50YXJnZXQuY2hlY2tlZDtcbiAgX3JlbmRlclJlY29TZWN0aW9uKCk7XG59O1xuXG53aW5kb3cuZXhwb3J0UmVjb0V4Y2VsID0gZnVuY3Rpb24gKCkge1xuICBpZiAodHlwZW9mIFhMU1ggPT09ICd1bmRlZmluZWQnKSB7XG4gICAgYWxlcnQoJ1NoZWV0SlMgKFhMU1gpIG5vIGNhcmdhZG8nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgY29uc3Qgcm93cyA9IF9jb21wdXRlUmVjb21tZW5kYXRpb25zKCk7XG4gIGNvbnN0IGFvYSA9IFtcbiAgICBbXG4gICAgICAnRmFtaWxpYScsXG4gICAgICAnU0tVJyxcbiAgICAgICdEZXNjcmlwY2lcdTAwRjNuJyxcbiAgICAgICdTdG9jaycsXG4gICAgICAnVHJcdTAwRTFuc2l0bycsXG4gICAgICAnQmFja29yZGVyJyxcbiAgICAgICdWdGEgcHJvbS9tZXMnLFxuICAgICAgJ011bHRpcGxpY2Fkb3InLFxuICAgICAgJ09yaWdlbiBtdWx0JyxcbiAgICAgICdEZW1hbmRhIGVzcC4gN20nLFxuICAgICAgJ1NhbGVzIFBsYW4gZnV0dXJvJyxcbiAgICAgICdCYWxhbmNlJyxcbiAgICAgICdNT1EnLFxuICAgICAgJ1JlY29tZW5kYWRvJyxcbiAgICBdLFxuICBdO1xuICBmb3IgKGNvbnN0IHIgb2Ygcm93cykge1xuICAgIGFvYS5wdXNoKFtcbiAgICAgIHIuZmFtaWxpYSA9PT0gJ3JvZHMnID8gJ1JvZHMgKENhXHUwMEYxYXMpJyA6ICdSZWVscycsXG4gICAgICByLnNrdSxcbiAgICAgIHIuZGVzY3JpcHRpb24sXG4gICAgICByLnN0b2NrTGlicmUsXG4gICAgICByLmVuVHJhbnNpdG8sXG4gICAgICByLmJhY2tvcmRlcixcbiAgICAgIHIudmVudGFNZW5zdWFsLFxuICAgICAgci5tdWx0aXBsaWVyLFxuICAgICAgci5tdWx0U291cmNlIHx8ICdhdXRvJyxcbiAgICAgIHIuZGVtYW5kYUVzcGVyYWRhLFxuICAgICAgci5zYWxlc1BsYW5GdXQsXG4gICAgICByLmJhbGFuY2UsXG4gICAgICByLm1vcSxcbiAgICAgIHIucmVjb21lbmRhZG8sXG4gICAgXSk7XG4gIH1cbiAgY29uc3Qgd3MgPSBYTFNYLnV0aWxzLmFvYV90b19zaGVldChhb2EpO1xuICB3c1snIWNvbHMnXSA9IFtcbiAgICB7IHdjaDogMTQgfSwgLy8gRmFtaWxpYVxuICAgIHsgd2NoOiAxOCB9LCAvLyBTS1VcbiAgICB7IHdjaDogNDAgfSwgLy8gRGVzY3JpcGNpXHUwMEYzblxuICAgIHsgd2NoOiA4IH0sIC8vIFN0b2NrXG4gICAgeyB3Y2g6IDEwIH0sIC8vIFRyXHUwMEUxbnNpdG9cbiAgICB7IHdjaDogMTEgfSwgLy8gQmFja29yZGVyXG4gICAgeyB3Y2g6IDEyIH0sIC8vIFZ0YSBwcm9tL21lc1xuICAgIHsgd2NoOiAxMiB9LCAvLyBNdWx0aXBsaWNhZG9yXG4gICAgeyB3Y2g6IDExIH0sIC8vIE9yaWdlbiBtdWx0XG4gICAgeyB3Y2g6IDE1IH0sIC8vIERlbWFuZGEgZXNwIDdtXG4gICAgeyB3Y2g6IDE2IH0sIC8vIFNhbGVzIFBsYW4gZnV0dXJvXG4gICAgeyB3Y2g6IDEwIH0sIC8vIEJhbGFuY2VcbiAgICB7IHdjaDogOCB9LCAvLyBNT1FcbiAgICB7IHdjaDogMTIgfSwgLy8gUmVjb21lbmRhZG9cbiAgXTtcbiAgY29uc3Qgd2IgPSBYTFNYLnV0aWxzLmJvb2tfbmV3KCk7XG4gIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQod2IsIHdzLCAnUmVjb21lbmRhY2lcdTAwRjNuJyk7XG4gIGNvbnN0IGhveSA9IG5ldyBEYXRlKCk7XG4gIGNvbnN0IHN0YW1wID1cbiAgICBob3kuZ2V0RnVsbFllYXIoKSArXG4gICAgJy0nICtcbiAgICBTdHJpbmcoaG95LmdldE1vbnRoKCkgKyAxKS5wYWRTdGFydCgyLCAnMCcpICtcbiAgICAnLScgK1xuICAgIFN0cmluZyhob3kuZ2V0RGF0ZSgpKS5wYWRTdGFydCgyLCAnMCcpO1xuICBYTFNYLndyaXRlRmlsZSh3YiwgJ1JlY29tZW5kYWNpb25fQ29tcHJhXycgKyBzdGFtcCArICcueGxzeCcpO1xufTtcblxuLy8gdjExMTIgRjNCOiBkZXNjb250aW51YXIgLyByZWFjdGl2YXIgU0tVcy5cbndpbmRvdy5kaXNjb250aW51ZVNrdSA9IGFzeW5jIGZ1bmN0aW9uIChza3UsIGRlc2NyaXB0aW9uKSB7XG4gIGlmICghX2Rpc2NvbnRpbnVlZFNrdXMpIF9kaXNjb250aW51ZWRTa3VzID0gbmV3IFNldCgpO1xuICBjb25zdCB1cHBlciA9IFN0cmluZyhza3UpLnRyaW0oKS50b1VwcGVyQ2FzZSgpO1xuICBjb25zdCBsYWJlbCA9IGRlc2NyaXB0aW9uID8gc2t1ICsgJyBcdTIwMTQgJyArIGRlc2NyaXB0aW9uLnNsaWNlKDAsIDYwKSA6IHNrdTtcbiAgaWYgKFxuICAgICFjb25maXJtKFxuICAgICAgJ0Rlc2NvbnRpbnVhciAnICtcbiAgICAgICAgbGFiZWwgK1xuICAgICAgICAnP1xcblxcblF1ZWRhclx1MDBFMSBleGNsdWlkbyBkZWwgY1x1MDBFMWxjdWxvIGRlIHJlY29tZW5kYWNpXHUwMEYzbiBkZSBjb21wcmEgaGFzdGEgcXVlIGxvIHJlYWN0aXZlcyBkZXNkZSBlbCBjaGlwIFwiRGVzY29udGludWFkb3NcIi4nXG4gICAgKVxuICApIHtcbiAgICByZXR1cm47XG4gIH1cbiAgX2Rpc2NvbnRpbnVlZFNrdXMuYWRkKHVwcGVyKTtcbiAgdHJ5IHtcbiAgICBhd2FpdCBfc2F2ZURpc2NvbnRpbnVlZFNrdXMoKTtcbiAgICBfcmVuZGVyUmVjb1NlY3Rpb24oKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIF9kaXNjb250aW51ZWRTa3VzLmRlbGV0ZSh1cHBlcik7XG4gICAgYWxlcnQoJ0Vycm9yIGd1YXJkYW5kbzogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xuICB9XG59O1xuXG53aW5kb3cucmVhY3RpdmF0ZVNrdSA9IGFzeW5jIGZ1bmN0aW9uIChza3UpIHtcbiAgaWYgKCFfZGlzY29udGludWVkU2t1cykgcmV0dXJuO1xuICBjb25zdCB1cHBlciA9IFN0cmluZyhza3UpLnRyaW0oKS50b1VwcGVyQ2FzZSgpO1xuICBfZGlzY29udGludWVkU2t1cy5kZWxldGUodXBwZXIpO1xuICB0cnkge1xuICAgIGF3YWl0IF9zYXZlRGlzY29udGludWVkU2t1cygpO1xuICAgIF9yZW5kZXJEaXNjb250aW51ZWRNb2RhbCgpO1xuICAgIF9yZW5kZXJSZWNvU2VjdGlvbigpO1xuICB9IGNhdGNoIChlKSB7XG4gICAgX2Rpc2NvbnRpbnVlZFNrdXMuYWRkKHVwcGVyKTtcbiAgICBhbGVydCgnRXJyb3IgZ3VhcmRhbmRvOiAnICsgKGUubWVzc2FnZSB8fCBlKSk7XG4gIH1cbn07XG5cbndpbmRvdy5vcGVuRGlzY29udGludWVkTW9kYWwgPSBmdW5jdGlvbiAoKSB7XG4gIGNvbnN0IGV4aXN0aW5nID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2Rpc2NvbnRpbnVlZC1za3VzLW1vZGFsJyk7XG4gIGlmIChleGlzdGluZykgZXhpc3RpbmcucmVtb3ZlKCk7XG4gIGNvbnN0IGVsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2Jyk7XG4gIGVsLmlkID0gJ2Rpc2NvbnRpbnVlZC1za3VzLW1vZGFsJztcbiAgZWwuc3R5bGUuY3NzVGV4dCA9XG4gICAgJ3Bvc2l0aW9uOmZpeGVkO2luc2V0OjA7YmFja2dyb3VuZDpyZ2JhKDE1LDIzLDQyLC42NSk7ei1pbmRleDoyMTAwO2Rpc3BsYXk6ZmxleDthbGlnbi1pdGVtczpjZW50ZXI7anVzdGlmeS1jb250ZW50OmNlbnRlcjtwYWRkaW5nOjN2aCc7XG4gIGVsLm9uY2xpY2sgPSAoZXYpID0+IHtcbiAgICBpZiAoZXYudGFyZ2V0ID09PSBlbCkgZWwucmVtb3ZlKCk7XG4gIH07XG4gIGVsLmlubmVySFRNTCA9XG4gICAgJzxkaXYgaWQ9XCJkaXNjb250aW51ZWQtbW9kYWwtY29udGVudFwiIHN0eWxlPVwiYmFja2dyb3VuZDp2YXIoLS1iZy1lbGV2YXRlZCk7Ym9yZGVyLXJhZGl1czoxMnB4O3BhZGRpbmc6MjRweDttYXgtd2lkdGg6NjQwcHg7d2lkdGg6MTAwJTttYXgtaGVpZ2h0Ojkwdmg7b3ZlcmZsb3c6YXV0bztib3gtc2hhZG93OjAgMjBweCA2MHB4IHJnYmEoMCwwLDAsLjQpXCI+PC9kaXY+JztcbiAgZG9jdW1lbnQuYm9keS5hcHBlbmRDaGlsZChlbCk7XG4gIF9yZW5kZXJEaXNjb250aW51ZWRNb2RhbCgpO1xufTtcblxuZnVuY3Rpb24gX3JlbmRlckRpc2NvbnRpbnVlZE1vZGFsKCkge1xuICBjb25zdCBjb250ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2Rpc2NvbnRpbnVlZC1tb2RhbC1jb250ZW50Jyk7XG4gIGlmICghY29udCkgcmV0dXJuO1xuICBjb25zdCBsaXN0ID0gX2Rpc2NvbnRpbnVlZFNrdXMgPyBBcnJheS5mcm9tKF9kaXNjb250aW51ZWRTa3VzKS5zb3J0KCkgOiBbXTtcbiAgLy8gQnVzY2FyIGRlc2NyaXBjaVx1MDBGM24gZW4gbG9zIHNhbGVzIHBsYW5zIGNhY2hlcyBwb3Igc2kgZXN0YSBjYXJnYWRvXG4gIGNvbnN0IHNrdVRvRGVzYyA9IHt9O1xuICBmb3IgKGNvbnN0IGZhbSBvZiBbJ3JvZHMnLCAncmVlbHMnXSkge1xuICAgIGNvbnN0IGNhY2hlID0gX3NhbGVzUGxhbkNhY2hlc1tmYW1dO1xuICAgIGlmIChjYWNoZSAmJiBjYWNoZS5yb3dzKSB7XG4gICAgICBmb3IgKGNvbnN0IHIgb2YgY2FjaGUucm93cykge1xuICAgICAgICBza3VUb0Rlc2NbU3RyaW5nKHIuc2t1KS50cmltKCkudG9VcHBlckNhc2UoKV0gPSByLmRlc2NyaXB0aW9uIHx8ICcnO1xuICAgICAgfVxuICAgIH1cbiAgfVxuICBjb25zdCBoZWFkID1cbiAgICAnPGRpdiBzdHlsZT1cImRpc3BsYXk6ZmxleDtqdXN0aWZ5LWNvbnRlbnQ6c3BhY2UtYmV0d2VlbjthbGlnbi1pdGVtczpjZW50ZXI7bWFyZ2luLWJvdHRvbToxNHB4XCI+JyArXG4gICAgJzxkaXY+PGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxOHB4O2ZvbnQtd2VpZ2h0OjgwMDtjb2xvcjp2YXIoLS10ZXh0LXByaW1hcnkpXCI+U0tVcyBkZXNjb250aW51YWRvczwvZGl2PicgK1xuICAgICc8ZGl2IHN0eWxlPVwiZm9udC1zaXplOjExcHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7bWFyZ2luLXRvcDoycHhcIj4nICtcbiAgICBsaXN0Lmxlbmd0aCArXG4gICAgJyBTS1VzIGV4Y2x1aWRvcyBkZWwgY1x1MDBFMWxjdWxvIGRlIFJlY29tZW5kYWNpXHUwMEYzbiBkZSBDb21wcmEnICtcbiAgICAnPC9kaXY+PC9kaXY+JyArXG4gICAgJzxidXR0b24gb25jbGljaz1cImRvY3VtZW50LmdldEVsZW1lbnRCeUlkKFxcJ2Rpc2NvbnRpbnVlZC1za3VzLW1vZGFsXFwnKS5yZW1vdmUoKVwiIHN0eWxlPVwiYmFja2dyb3VuZDp0cmFuc3BhcmVudDtib3JkZXI6MXB4IHNvbGlkIHZhcigtLWJvcmRlci1zdWJ0bGUpO2JvcmRlci1yYWRpdXM6NnB4O3BhZGRpbmc6NnB4IDEycHg7Y3Vyc29yOnBvaW50ZXI7Zm9udC13ZWlnaHQ6NzAwXCI+Q2VycmFyPC9idXR0b24+JyArXG4gICAgJzwvZGl2Pic7XG4gIGNvbnN0IGJvZHkgPVxuICAgIGxpc3QubGVuZ3RoID09PSAwXG4gICAgICA/ICc8ZGl2IHN0eWxlPVwicGFkZGluZzo0MHB4O3RleHQtYWxpZ246Y2VudGVyO2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpXCI+Tm8gaGF5IFNLVXMgZGVzY29udGludWFkb3MuPGJyPjxicj5Qb2RcdTAwRTlzIGRlc2NvbnRpbnVhciBTS1VzIGRlc2RlIGVsIGJvdFx1MDBGM24gXHVEODNEXHVEREQxIGVuIGNhZGEgZmlsYSBkZSBsYSB0YWJsYSBSZWNvbWVuZGFjaVx1MDBGM24gZGUgQ29tcHJhLjwvZGl2PidcbiAgICAgIDogJzxkaXYgc3R5bGU9XCJkaXNwbGF5OmZsZXg7ZmxleC1kaXJlY3Rpb246Y29sdW1uO2dhcDo2cHhcIj4nICtcbiAgICAgICAgbGlzdFxuICAgICAgICAgIC5tYXAoKHNrdSkgPT4ge1xuICAgICAgICAgICAgY29uc3QgZGVzYyA9IHNrdVRvRGVzY1tza3VdIHx8ICcnO1xuICAgICAgICAgICAgcmV0dXJuIChcbiAgICAgICAgICAgICAgJzxkaXYgc3R5bGU9XCJkaXNwbGF5OmZsZXg7YWxpZ24taXRlbXM6Y2VudGVyO2dhcDoxMHB4O3BhZGRpbmc6MTBweCAxMnB4O2JhY2tncm91bmQ6dmFyKC0tYmctc2Vjb25kYXJ5KTtib3JkZXItcmFkaXVzOjZweFwiPicgK1xuICAgICAgICAgICAgICAnPGRpdiBzdHlsZT1cImZsZXg6MVwiPjxkaXYgc3R5bGU9XCJmb250LWZhbWlseTptb25vc3BhY2U7Zm9udC13ZWlnaHQ6NzAwO2NvbG9yOnZhcigtLXRleHQtcHJpbWFyeSlcIj4nICtcbiAgICAgICAgICAgICAgZXNjYXBlSHRtbFNhZmUoc2t1KSArXG4gICAgICAgICAgICAgICc8L2Rpdj4nICtcbiAgICAgICAgICAgICAgKGRlc2NcbiAgICAgICAgICAgICAgICA/ICc8ZGl2IHN0eWxlPVwiZm9udC1zaXplOjExcHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7bWFyZ2luLXRvcDoycHhcIj4nICtcbiAgICAgICAgICAgICAgICAgIGVzY2FwZUh0bWxTYWZlKGRlc2MpICtcbiAgICAgICAgICAgICAgICAgICc8L2Rpdj4nXG4gICAgICAgICAgICAgICAgOiAnJykgK1xuICAgICAgICAgICAgICAnPC9kaXY+JyArXG4gICAgICAgICAgICAgICc8YnV0dG9uIG9uY2xpY2s9XCJyZWFjdGl2YXRlU2t1KFxcJycgK1xuICAgICAgICAgICAgICBlc2NhcGVIdG1sU2FmZShza3UpICtcbiAgICAgICAgICAgICAgJ1xcJylcIiBzdHlsZT1cInBhZGRpbmc6NnB4IDEycHg7YmFja2dyb3VuZDojMTZhMzRhO2NvbG9yOiNmZmY7Ym9yZGVyOm5vbmU7Ym9yZGVyLXJhZGl1czo0cHg7Zm9udC1zaXplOjExcHg7Zm9udC13ZWlnaHQ6NzAwO2N1cnNvcjpwb2ludGVyXCI+XHUyMUJCIFJlYWN0aXZhcjwvYnV0dG9uPicgK1xuICAgICAgICAgICAgICAnPC9kaXY+J1xuICAgICAgICAgICAgKTtcbiAgICAgICAgICB9KVxuICAgICAgICAgIC5qb2luKCcnKSArXG4gICAgICAgICc8L2Rpdj4nO1xuICBjb250LmlubmVySFRNTCA9IGhlYWQgKyBib2R5O1xufVxuIl0sCiAgIm1hcHBpbmdzIjogIjs7O0FBWUEsTUFBTSxnQkFBZ0I7QUFBQSxJQUNwQixLQUFLO0FBQUEsSUFDTCxTQUFTO0FBQUEsSUFDVCxLQUFLO0FBQUEsSUFDTCxPQUFPO0FBQUEsSUFDUCxLQUFLO0FBQUEsSUFDTCxVQUFVO0FBQUEsSUFDVixTQUFTO0FBQUEsSUFDVCxLQUFLO0FBQUEsSUFDTCxPQUFPO0FBQUEsSUFDUCxPQUFPO0FBQUEsSUFDUCxLQUFLO0FBQUEsSUFDTCxPQUFPO0FBQUEsSUFDUCxLQUFLO0FBQUEsSUFDTCxPQUFPO0FBQUEsSUFDUCxLQUFLO0FBQUEsSUFDTCxNQUFNO0FBQUEsSUFDTixLQUFLO0FBQUEsSUFDTCxNQUFNO0FBQUEsSUFDTixPQUFPO0FBQUEsSUFDUCxLQUFLO0FBQUEsSUFDTCxNQUFNO0FBQUEsSUFDTixPQUFPO0FBQUEsSUFDUCxLQUFLO0FBQUEsSUFDTCxRQUFRO0FBQUEsSUFDUixLQUFLO0FBQUEsSUFDTCxRQUFRO0FBQUEsSUFDUixLQUFLO0FBQUEsSUFDTCxNQUFNO0FBQUEsSUFDTixXQUFXO0FBQUEsSUFDWCxZQUFZO0FBQUEsSUFDWixLQUFLO0FBQUEsSUFDTCxTQUFTO0FBQUEsSUFDVCxTQUFTO0FBQUEsSUFDVCxLQUFLO0FBQUEsSUFDTCxVQUFVO0FBQUEsSUFDVixXQUFXO0FBQUEsSUFDWCxLQUFLO0FBQUEsSUFDTCxVQUFVO0FBQUEsSUFDVixLQUFLO0FBQUEsSUFDTCxXQUFXO0FBQUEsRUFDYjtBQUtBLFdBQVMsb0JBQW9CLE9BQU87QUFDbEMsUUFBSSxTQUFTLEtBQU0sUUFBTztBQUsxQixVQUFNLElBQUksT0FBTyxLQUFLLEVBQUUsUUFBUSxRQUFRLEdBQUcsRUFBRSxLQUFLLEVBQUUsWUFBWTtBQUNoRSxRQUFJLENBQUMsRUFBRyxRQUFPO0FBQ2YsUUFBSTtBQUVKLFFBQUksRUFBRSxNQUFNLHlDQUF5QztBQUNyRCxRQUFJLEdBQUc7QUFDTCxZQUFNLE1BQU0sY0FBYyxFQUFFLENBQUMsQ0FBQyxLQUFLLGNBQWMsRUFBRSxDQUFDLEVBQUUsTUFBTSxHQUFHLENBQUMsQ0FBQztBQUNqRSxVQUFJLEtBQUs7QUFDUCxZQUFJLElBQUksU0FBUyxFQUFFLENBQUMsR0FBRyxFQUFFO0FBQ3pCLFlBQUksSUFBSSxJQUFLLEtBQUksTUFBTztBQUN4QixlQUFPLE9BQU8sQ0FBQyxFQUFFLFNBQVMsR0FBRyxHQUFHLElBQUksTUFBTSxPQUFPLEdBQUcsRUFBRSxTQUFTLEdBQUcsR0FBRztBQUFBLE1BQ3ZFO0FBQUEsSUFDRjtBQUdBLFFBQUksRUFBRSxNQUFNLHVDQUF1QztBQUNuRCxRQUFJLEdBQUc7QUFDTCxZQUFNLElBQUksU0FBUyxFQUFFLENBQUMsR0FBRyxFQUFFO0FBQzNCLFlBQU0sTUFBTSxjQUFjLEVBQUUsQ0FBQyxDQUFDLEtBQUssY0FBYyxFQUFFLENBQUMsRUFBRSxNQUFNLEdBQUcsQ0FBQyxDQUFDO0FBQ2pFLFVBQUksSUFBSyxRQUFPLE9BQU8sQ0FBQyxFQUFFLFNBQVMsR0FBRyxHQUFHLElBQUksTUFBTSxPQUFPLEdBQUcsRUFBRSxTQUFTLEdBQUcsR0FBRztBQUFBLElBQ2hGO0FBRUEsUUFBSSxFQUFFLE1BQU0sd0JBQXdCO0FBQ3BDLFFBQUksR0FBRztBQUNMLFlBQU0sSUFBSSxTQUFTLEVBQUUsQ0FBQyxHQUFHLEVBQUU7QUFDM0IsWUFBTSxNQUFNLFNBQVMsRUFBRSxDQUFDLEdBQUcsRUFBRTtBQUM3QixVQUFJLE9BQU8sS0FBSyxPQUFPO0FBQ3JCLGVBQU8sT0FBTyxDQUFDLEVBQUUsU0FBUyxHQUFHLEdBQUcsSUFBSSxNQUFNLE9BQU8sR0FBRyxFQUFFLFNBQVMsR0FBRyxHQUFHO0FBQUEsSUFDekU7QUFFQSxRQUFJLEVBQUUsTUFBTSx3QkFBd0I7QUFDcEMsUUFBSSxHQUFHO0FBQ0wsWUFBTSxNQUFNLFNBQVMsRUFBRSxDQUFDLEdBQUcsRUFBRTtBQUM3QixZQUFNLElBQUksU0FBUyxFQUFFLENBQUMsR0FBRyxFQUFFO0FBQzNCLFVBQUksT0FBTyxLQUFLLE9BQU87QUFDckIsZUFBTyxPQUFPLENBQUMsRUFBRSxTQUFTLEdBQUcsR0FBRyxJQUFJLE1BQU0sT0FBTyxHQUFHLEVBQUUsU0FBUyxHQUFHLEdBQUc7QUFBQSxJQUN6RTtBQUNBLFdBQU87QUFBQSxFQUNUO0FBR0EsV0FBUyxjQUFjLE1BQU07QUFDM0IsVUFBTSxpQkFBaUI7QUFBQSxNQUNyQjtBQUFBLE1BQ0E7QUFBQSxNQUNBO0FBQUEsTUFDQTtBQUFBLE1BQ0E7QUFBQSxNQUNBO0FBQUEsTUFDQTtBQUFBLE1BQ0E7QUFBQSxNQUNBO0FBQUEsSUFDRjtBQUNBLGFBQVMsSUFBSSxHQUFHLElBQUksS0FBSyxJQUFJLEtBQUssUUFBUSxFQUFFLEdBQUcsS0FBSztBQUNsRCxZQUFNLE1BQU0sS0FBSyxDQUFDLEtBQUssQ0FBQztBQUN4QixpQkFBVyxRQUFRLEtBQUs7QUFHdEIsY0FBTSxJQUFJLE9BQU8sUUFBUSxPQUFPLEtBQUssSUFBSSxFQUN0QyxRQUFRLFFBQVEsR0FBRyxFQUNuQixLQUFLLEVBQ0wsWUFBWTtBQUNmLFlBQUksZUFBZSxRQUFRLENBQUMsS0FBSyxFQUFHLFFBQU87QUFBQSxNQUM3QztBQUFBLElBQ0Y7QUFDQSxXQUFPO0FBQUEsRUFDVDtBQUlBLFdBQVMsY0FBYyxXQUFXLGNBQWM7QUFDOUMsUUFBSSxTQUFTO0FBQ2IsUUFBSSxVQUFVO0FBQ2QsUUFBSSxTQUFTO0FBQ2IsVUFBTSxlQUFlLENBQUM7QUFDdEIsVUFBTSxvQkFBb0Isb0JBQUksSUFBSTtBQUNsQyxhQUFTLElBQUksR0FBRyxJQUFJLFVBQVUsUUFBUSxLQUFLO0FBR3pDLFlBQU0sTUFBTSxPQUFPLFVBQVUsQ0FBQyxLQUFLLE9BQU8sS0FBSyxVQUFVLENBQUMsQ0FBQyxFQUN4RCxRQUFRLFFBQVEsR0FBRyxFQUNuQixLQUFLO0FBQ1IsWUFBTSxJQUFJLElBQUksWUFBWTtBQUMxQixVQUNFLFNBQVMsTUFDUixNQUFNLHNCQUNMLE1BQU0sY0FDTixNQUFNLFNBQ04sTUFBTSxhQUNOLE1BQU0saUJBQ04sTUFBTSxjQUNOLE1BQU0sZUFDTixNQUFNLFlBQ04sTUFBTSxjQUNSO0FBQ0EsaUJBQVM7QUFDVDtBQUFBLE1BQ0Y7QUFDQSxVQUNFLFVBQVUsTUFDVCxNQUFNLGlCQUNMLE1BQU0saUJBQ04sTUFBTSxvQkFDTixNQUFNLGVBQ04sTUFBTSxhQUNSO0FBQ0Esa0JBQVU7QUFDVjtBQUFBLE1BQ0Y7QUFDQSxVQUFJLFNBQVMsTUFBTSxNQUFNLG1CQUFtQixNQUFNLFNBQVMsRUFBRSxRQUFRLEtBQUssTUFBTSxJQUFJO0FBQ2xGLGlCQUFTO0FBQ1Q7QUFBQSxNQUNGO0FBRUEsVUFBSSxXQUFXLG9CQUFvQixHQUFHO0FBQ3RDLFVBQUksQ0FBQyxZQUFZLGdCQUFnQixhQUFhLENBQUMsS0FBSyxNQUFNO0FBQ3hELGNBQU0sT0FBTyxPQUFPLGFBQWEsQ0FBQyxDQUFDLEVBQUUsS0FBSztBQUMxQyxZQUFJLE1BQU07QUFDUixxQkFBVyxvQkFBb0IsTUFBTSxNQUFNLElBQUksS0FBSyxvQkFBb0IsT0FBTyxNQUFNLEdBQUc7QUFBQSxRQUMxRjtBQUFBLE1BQ0Y7QUFDQSxVQUFJLFVBQVU7QUFDWixxQkFBYSxLQUFLLEVBQUUsUUFBUSxHQUFHLFNBQVMsQ0FBQztBQUN6QywwQkFBa0IsSUFBSSxRQUFRO0FBQUEsTUFDaEM7QUFBQSxJQUNGO0FBQ0EsV0FBTztBQUFBLE1BQ0w7QUFBQSxNQUNBO0FBQUEsTUFDQTtBQUFBLE1BQ0E7QUFBQSxNQUNBLGdCQUFnQixNQUFNLEtBQUssaUJBQWlCLEVBQUUsS0FBSztBQUFBLElBQ3JEO0FBQUEsRUFDRjtBQUdBLFdBQVMsb0JBQW9CLE1BQU07QUFDakMsUUFBSSxDQUFDLFFBQVEsQ0FBQyxLQUFLLFFBQVE7QUFDekIsWUFBTSxNQUFNLElBQUksTUFBTSxhQUFhO0FBQ25DLFVBQUksT0FBTztBQUNYLFlBQU07QUFBQSxJQUNSO0FBQ0EsVUFBTSxZQUFZLGNBQWMsSUFBSTtBQUNwQyxRQUFJLFlBQVksR0FBRztBQUNqQixZQUFNLE1BQU0sSUFBSSxNQUFNLHFFQUFxRTtBQUMzRixVQUFJLE9BQU87QUFDWCxZQUFNO0FBQUEsSUFDUjtBQUNBLFVBQU0sWUFBWSxLQUFLLFNBQVMsS0FBSyxDQUFDO0FBQ3RDLFVBQU0sV0FBVyxZQUFZLElBQUksS0FBSyxZQUFZLENBQUMsS0FBSyxDQUFDLElBQUk7QUFDN0QsVUFBTSxPQUFPLGNBQWMsV0FBVyxRQUFRO0FBQzlDLFFBQUksS0FBSyxTQUFTLEdBQUc7QUFDbkIsWUFBTSxNQUFNLElBQUksTUFBTSw4Q0FBOEM7QUFDcEUsVUFBSSxPQUFPO0FBQ1gsWUFBTTtBQUFBLElBQ1I7QUFDQSxRQUFJLENBQUMsS0FBSyxhQUFhLFFBQVE7QUFDN0IsWUFBTSxNQUFNLElBQUk7QUFBQSxRQUNkO0FBQUEsTUFDRjtBQUNBLFVBQUksT0FBTztBQUNYLFlBQU07QUFBQSxJQUNSO0FBQ0EsVUFBTSxhQUFhLENBQUM7QUFDcEIsVUFBTSxVQUFVLG9CQUFJLElBQUk7QUFDeEIsYUFBUyxJQUFJLFlBQVksR0FBRyxJQUFJLEtBQUssUUFBUSxLQUFLO0FBQ2hELFlBQU0sTUFBTSxLQUFLLENBQUMsS0FBSyxDQUFDO0FBQ3hCLFlBQU0sU0FBUyxJQUFJLEtBQUssTUFBTTtBQUM5QixVQUFJLFVBQVUsUUFBUSxPQUFPLE1BQU0sRUFBRSxLQUFLLE1BQU0sR0FBSTtBQUNwRCxZQUFNLE1BQU0sT0FBTyxNQUFNLEVBQUUsS0FBSztBQUNoQyxZQUFNLFFBQVEsSUFBSSxZQUFZO0FBRTlCLFVBQUksVUFBVSxXQUFXLFVBQVUsU0FBUyxVQUFVLGNBQWMsVUFBVTtBQUM1RTtBQUNGLFVBQUksUUFBUSxJQUFJLEtBQUssRUFBRztBQUN4QixjQUFRLElBQUksS0FBSztBQUNqQixZQUFNLGNBQ0osS0FBSyxXQUFXLElBQUksT0FBTyxJQUFJLEtBQUssT0FBTyxLQUFLLE9BQU8sS0FBSyxJQUFJLEtBQUssT0FBTyxDQUFDLEVBQUUsS0FBSyxJQUFJO0FBQzFGLFlBQU0sU0FBUyxLQUFLLFVBQVUsSUFBSSxJQUFJLEtBQUssTUFBTSxJQUFJO0FBQ3JELFlBQU0sU0FBUyxPQUFPLE1BQU07QUFDNUIsWUFBTSxNQUFNLE9BQU8sU0FBUyxNQUFNLEtBQUssU0FBUyxJQUFJLEtBQUssTUFBTSxNQUFNLElBQUk7QUFDekUsWUFBTSxTQUFTLENBQUM7QUFDaEIsaUJBQVcsTUFBTSxLQUFLLGNBQWM7QUFDbEMsY0FBTSxJQUFJLElBQUksR0FBRyxNQUFNO0FBQ3ZCLGNBQU0sSUFBSSxPQUFPLENBQUM7QUFDbEIsWUFBSSxPQUFPLFNBQVMsQ0FBQyxLQUFLLElBQUksR0FBRztBQUMvQixpQkFBTyxHQUFHLFFBQVEsSUFBSSxLQUFLLE1BQU0sQ0FBQztBQUFBLFFBQ3BDO0FBQUEsTUFDRjtBQUNBLGlCQUFXLEtBQUssRUFBRSxLQUFLLGFBQWEsS0FBSyxPQUFPLENBQUM7QUFBQSxJQUNuRDtBQUNBLFdBQU87QUFBQSxNQUNMLGdCQUFnQjtBQUFBLE1BQ2hCLGdCQUFnQixLQUFLO0FBQUEsTUFDckIsV0FBVyxXQUFXO0FBQUEsTUFDdEIsTUFBTTtBQUFBLElBQ1I7QUFBQSxFQUNGO0FBR0EsTUFBSSxPQUFPLFdBQVcsZUFBZSxPQUFPLFNBQVM7QUFDbkQsV0FBTyxVQUFVLEVBQUUscUJBQXFCLHFCQUFxQixlQUFlLGNBQWM7QUFBQSxFQUM1RjtBQUNBLE1BQUksT0FBTyxXQUFXLGFBQWE7QUFDakMsV0FBTyxrQkFBa0I7QUFBQSxNQUN2QjtBQUFBLE1BQ0E7QUFBQSxNQUNBO0FBQUEsTUFDQTtBQUFBLElBQ0Y7QUFBQSxFQUNGOzs7QUN4UEEsTUFBTSxzQkFBc0I7QUFBQSxJQUMxQixFQUFFLEtBQUssUUFBUSxPQUFPLG1CQUFnQixPQUFPLFVBQVU7QUFBQSxJQUN2RCxFQUFFLEtBQUssU0FBUyxPQUFPLFNBQVMsT0FBTyxVQUFVO0FBQUEsRUFDbkQ7QUFDQSxNQUFNLG1CQUFtQixFQUFFLE1BQU0sTUFBTSxPQUFPLEtBQUs7QUFDbkQsTUFBSSxxQkFBcUI7QUFLekIsTUFBSSxvQkFBb0I7QUFDeEIsTUFBSSxvQkFBb0I7QUFLeEIsTUFBSSxxQkFBcUI7QUFDekIsTUFBSSxzQkFBc0I7QUFDMUIsTUFBSSxvQkFBb0I7QUFDeEIsTUFBSSxxQkFBcUI7QUFDekIsTUFBSSxrQkFBa0I7QUFJdEIsTUFBSSxvQkFBb0I7QUFDeEIsTUFBSSxvQkFBb0I7QUFLeEIsTUFBSSx1QkFBdUI7QUFDM0IsTUFBTSwwQkFBMEI7QUFDaEMsTUFBTSw0QkFBNEI7QUFDbEMsTUFBTSxnQkFBZ0I7QUFDdEIsTUFBTSxnQkFBZ0I7QUFDdEIsTUFBTSx5QkFBeUI7QUFFL0IsTUFBTSxzQkFBc0I7QUFDNUIsTUFBTSw2QkFBNkI7QUFNbkMsTUFBTSwwQkFBMEIsQ0FBQyxpQ0FBaUMseUJBQXlCO0FBRTNGLFdBQVMsZUFBZTtBQUN0QixRQUFJO0FBQ0YsWUFBTSxTQUFVLE9BQU8sZUFBZSxPQUFPLFlBQVksU0FBVSxJQUFJLFlBQVk7QUFDbkYsVUFBSSxDQUFDLE1BQU8sUUFBTztBQUNuQixhQUFPLHdCQUF3QixRQUFRLEtBQUssS0FBSztBQUFBLElBQ25ELFFBQVE7QUFDTixhQUFPO0FBQUEsSUFDVDtBQUFBLEVBQ0Y7QUFFQSxXQUFTLG9CQUFvQjtBQUMzQixVQUFNLFdBQVcsU0FBUyxlQUFlLGdCQUFnQjtBQUN6RCxRQUFJLFNBQVUsUUFBTztBQUNyQixVQUFNLEtBQUssU0FBUyxjQUFjLEtBQUs7QUFDdkMsT0FBRyxLQUFLO0FBQ1IsT0FBRyxZQUFZO0FBRWYsT0FBRyxNQUFNLFVBQ1A7QUFDRixPQUFHLFVBQVUsU0FBVSxJQUFJO0FBQ3pCLFVBQUksR0FBRyxXQUFXLEdBQUksUUFBTyxtQkFBbUI7QUFBQSxJQUNsRDtBQUNBLFVBQU0sWUFBWSxnQkFBZ0I7QUFDbEMsT0FBRyxZQUFZO0FBQ2YsYUFBUyxLQUFLLFlBQVksRUFBRTtBQUM1Qiw0QkFBd0I7QUFDeEIsV0FBTztBQUFBLEVBQ1Q7QUFFQSxXQUFTLDBCQUEwQjtBQUlqQyxRQUFJLFNBQVMsZUFBZSxvQkFBb0IsRUFBRztBQUNuRCxVQUFNLFFBQVEsU0FBUyxjQUFjLE9BQU87QUFDNUMsVUFBTSxLQUFLO0FBQ1gsVUFBTSxNQUNKO0FBYUYsVUFBTSxjQUFjO0FBQ3BCLGFBQVMsS0FBSyxZQUFZLEtBQUs7QUFBQSxFQUNqQztBQUVBLFdBQVMsa0JBQWtCO0FBR3pCLFVBQU0sYUFDSjtBQUNGLFVBQU0sU0FDSjtBQU9GLFVBQU0sVUFDSjtBQUlGLFVBQU0sZ0JBQ0o7QUFDRixVQUFNLFVBQ0o7QUFDRixXQUFPLGFBQWEsU0FBUyxVQUFVLGdCQUFnQixVQUFVO0FBQUEsRUFDbkU7QUFJQSxTQUFPLG9CQUFvQixTQUFVLE9BQU87QUFDMUMseUJBQXFCO0FBQ3JCLFVBQU0sS0FBSyxTQUFTLGVBQWUsMEJBQTBCO0FBQzdELFVBQU0sS0FBSyxTQUFTLGVBQWUsbUJBQW1CO0FBQ3RELFFBQUksR0FBSSxJQUFHLE1BQU0sVUFBVSxVQUFVLGdCQUFnQixVQUFVO0FBQy9ELFFBQUksR0FBSSxJQUFHLE1BQU0sVUFBVSxVQUFVLFNBQVMsVUFBVTtBQUN4RCxVQUFNLE9BQU8sU0FBUyxpQkFBaUIsa0NBQWtDO0FBQ3pFLFNBQUssUUFBUSxDQUFDLE1BQU07QUFDbEIsWUFBTSxTQUFTLEVBQUUsYUFBYSxVQUFVLE1BQU07QUFFOUMsUUFBRSxVQUFVLE9BQU8sVUFBVSxNQUFNO0FBQUEsSUFDckMsQ0FBQztBQUdELFFBQUksVUFBVSxRQUFRO0FBQ3BCLFlBQU0sT0FBTyxTQUFTLGVBQWUsbUJBQW1CO0FBQ3hELFVBQUksTUFBTTtBQUNSLFlBQUksbUJBQW1CO0FBRXJCLGlDQUF1QjtBQUFBLFFBQ3pCLE9BQU87QUFFTCxlQUFLLFlBQ0g7QUFLRiw4QkFBb0IsRUFDakIsS0FBSyxzQkFBc0IsRUFDM0IsTUFBTSxDQUFDLE1BQU07QUFDWixvQkFBUSxNQUFNLDZCQUE2QixDQUFDO0FBQzVDLGtCQUFNLElBQUksU0FBUyxlQUFlLG1CQUFtQjtBQUNyRCxnQkFBSSxHQUFHO0FBQ0wsZ0JBQUUsWUFDQSw0U0FHQSxlQUFlLEVBQUUsV0FBVyxPQUFPLENBQUMsQ0FBQyxJQUNyQztBQUFBLFlBR0o7QUFBQSxVQUNGLENBQUM7QUFBQSxRQUNMO0FBQUEsTUFDRjtBQUFBLElBQ0Y7QUFBQSxFQUNGO0FBTUEsV0FBUyxnQkFBZ0I7QUFDdkIsVUFBTSxJQUFJLG9CQUFJLEtBQUs7QUFDbkIsV0FBTyxFQUFFLFlBQVksSUFBSSxNQUFNLE9BQU8sRUFBRSxTQUFTLElBQUksQ0FBQyxFQUFFLFNBQVMsR0FBRyxHQUFHO0FBQUEsRUFDekU7QUFFQSxXQUFTLFNBQVMsT0FBTztBQUN2QixRQUFJLENBQUMsTUFBTyxRQUFPO0FBQ25CLFFBQUksUUFBUSxLQUFNLFFBQU8sUUFBUTtBQUNqQyxRQUFJLFFBQVEsT0FBTyxLQUFNLFNBQVEsUUFBUSxNQUFNLFFBQVEsQ0FBQyxJQUFJO0FBQzVELFlBQVEsU0FBUyxPQUFPLE9BQU8sUUFBUSxDQUFDLElBQUk7QUFBQSxFQUM5QztBQUVBLFdBQVMsY0FBYyxLQUFLO0FBQzFCLFFBQUksQ0FBQyxJQUFLLFFBQU87QUFDakIsUUFBSTtBQUNGLFlBQU0sSUFBSSxJQUFJLFNBQVMsSUFBSSxPQUFPLElBQUksSUFBSSxLQUFLLEdBQUc7QUFDbEQsYUFDRSxFQUFFLG1CQUFtQixTQUFTLEVBQUUsS0FBSyxXQUFXLE9BQU8sU0FBUyxNQUFNLFVBQVUsQ0FBQyxJQUNqRixNQUNBLEVBQUUsbUJBQW1CLFNBQVMsRUFBRSxNQUFNLFdBQVcsUUFBUSxVQUFVLENBQUM7QUFBQSxJQUV4RSxRQUFRO0FBQ04sYUFBTyxPQUFPLEdBQUc7QUFBQSxJQUNuQjtBQUFBLEVBQ0Y7QUFFQSxpQkFBZSx1QkFBdUI7QUFDcEMsUUFBSSxDQUFDLE9BQU8sS0FBTTtBQUNsQixVQUFNLFFBQVE7QUFBQSxNQUNaLG9CQUFvQixJQUFJLE9BQU8sTUFBTTtBQUNuQyxZQUFJO0FBQ0YsZ0JBQU0sTUFBTSxNQUFNLE9BQU8sS0FBSyxXQUFXLGtCQUFrQixFQUFFLElBQUksRUFBRSxHQUFHLEVBQUUsSUFBSTtBQUM1RSwyQkFBaUIsRUFBRSxHQUFHLElBQUksSUFBSSxTQUFTLElBQUksS0FBSyxJQUFJO0FBQUEsUUFDdEQsU0FBUyxHQUFHO0FBQ1Ysa0JBQVEsS0FBSyxzQ0FBc0MsRUFBRSxNQUFNLFVBQVUsS0FBSyxFQUFFLE9BQU87QUFDbkYsMkJBQWlCLEVBQUUsR0FBRyxJQUFJO0FBQUEsUUFDNUI7QUFBQSxNQUNGLENBQUM7QUFBQSxJQUNIO0FBQUEsRUFDRjtBQUVBLFdBQVMsZUFBZSxHQUFHO0FBQ3pCLFFBQUksT0FBTyxPQUFPLGVBQWUsV0FBWSxRQUFPLE9BQU8sV0FBVyxDQUFDO0FBQ3ZFLFdBQU8sT0FBTyxLQUFLLE9BQU8sS0FBSyxDQUFDLEVBQUU7QUFBQSxNQUNoQztBQUFBLE1BQ0EsQ0FBQyxRQUFRLEVBQUUsS0FBSyxTQUFTLEtBQUssUUFBUSxLQUFLLFFBQVEsS0FBSyxVQUFVLEtBQUssUUFBUSxHQUFHLEVBQUU7QUFBQSxJQUN0RjtBQUFBLEVBQ0Y7QUFFQSxXQUFTLHdCQUF3QixHQUFHO0FBQ2xDLFVBQU0sUUFBUSxpQkFBaUIsRUFBRSxHQUFHO0FBQ3BDLFVBQU0sWUFBWSxTQUFTLE9BQU8sU0FBUyxNQUFNLFNBQVMsSUFBSSxNQUFNLFlBQVk7QUFDaEYsVUFBTSxjQUNKLFNBQVMsTUFBTSxRQUFRLE1BQU0sY0FBYyxJQUFJLE1BQU0sZUFBZSxTQUFTO0FBQy9FLFVBQU0sV0FBVyxTQUFTLE1BQU0sV0FBVyxjQUFjLE1BQU0sUUFBUSxJQUFJO0FBQzNFLFVBQU0sYUFBYSxTQUFTLE1BQU0sYUFBYSxNQUFNLGFBQWE7QUFDbEUsVUFBTSxpQkFBaUIsU0FBUyxNQUFNLGlCQUFpQixNQUFNLGlCQUFpQjtBQUM5RSxVQUFNLFlBQVksU0FBUyxNQUFNLFlBQVksTUFBTSxZQUFZO0FBQy9ELFVBQU0sY0FDSixTQUFTLE1BQU0sa0JBQWtCLE1BQU0sZUFBZSxTQUNsRCxNQUFNLGVBQWUsQ0FBQyxJQUFJLGFBQVEsTUFBTSxlQUFlLE1BQU0sZUFBZSxTQUFTLENBQUMsSUFDdEY7QUFDTixVQUFNLFdBQVcsQ0FBQyxDQUFDO0FBQ25CLFVBQU0sUUFBUSxXQUNWLG1KQUNBO0FBQ0osVUFBTSxZQUFZLFdBQ2QsaVRBRUEsZUFBZSxjQUFjLElBQzdCLG1IQUVBLGVBQWUsUUFBUSxJQUN2QixnSEFFQSxlQUFlLFVBQVUsSUFDekIsMklBRUEsZUFBZSxTQUFTLElBQ3hCLGlJQUVBLFVBQVUsZUFBZSxPQUFPLElBQ2hDLGtJQUVBLGNBQ0EsNkRBQ0EsZUFBZSxXQUFXLElBQzFCLHlCQUVBO0FBQ0osVUFBTSxZQUNKLHNIQUNBLEVBQUUsUUFDRiw2R0FFQyxXQUFXLDRCQUF1Qix5QkFDbkMsaUVBRUEsRUFBRSxNQUNGLHdFQUNBLEVBQUUsTUFDRjtBQUVGLFVBQU0sV0FDSix5R0FFQSxFQUFFLFFBQ0YseUhBRUEsZUFBZSxFQUFFLEtBQUssSUFDdEIsMEhBRUEsUUFDQTtBQUNGLFdBQ0Usa0tBQ0EsV0FDQSxZQUNBLFlBQ0EsZ0NBQ0EsRUFBRSxNQUNGO0FBQUEsRUFHSjtBQUVBLFdBQVMsdUJBQXVCO0FBQzlCLFVBQU0sT0FBTyxTQUFTLGVBQWUsMEJBQTBCO0FBQy9ELFFBQUksQ0FBQyxLQUFNO0FBQ1gsVUFBTSxRQUFRLG9CQUFvQixJQUFJLHVCQUF1QixFQUFFLEtBQUssRUFBRTtBQUN0RSxVQUFNLFFBQ0o7QUFJRixVQUFNLE9BQ0osb0hBQ0EsUUFDQTtBQUdGLFVBQU0sY0FBYztBQUNwQixTQUFLLFlBQVksK0JBQStCLFFBQVEsT0FBTyxjQUFjO0FBQzdFLHVCQUFtQjtBQUFBLEVBQ3JCO0FBRUEsU0FBTyw0QkFBNEIsZUFBZ0IsT0FBTyxTQUFTO0FBQ2pFLFVBQU0sT0FBTyxTQUFTLE1BQU0sVUFBVSxNQUFNLE9BQU8sU0FBUyxNQUFNLE9BQU8sTUFBTSxDQUFDO0FBQ2hGLFFBQUksQ0FBQyxLQUFNO0FBQ1gsVUFBTSxXQUFXLFNBQVMsZUFBZSx1QkFBdUIsT0FBTztBQUN2RSxVQUFNLFlBQVksQ0FBQyxLQUFLLFVBQVU7QUFDaEMsVUFBSSxDQUFDLFNBQVU7QUFDZixlQUFTLGNBQWM7QUFDdkIsZUFBUyxNQUFNLFFBQVEsU0FBUztBQUFBLElBQ2xDO0FBQ0EsUUFBSTtBQUNGLFVBQUksT0FBTyxTQUFTLGFBQWE7QUFDL0IsY0FBTSxxREFBNkM7QUFDbkQ7QUFBQSxNQUNGO0FBQ0EsVUFBSSxDQUFDLE9BQU8sbUJBQW1CLENBQUMsT0FBTyxnQkFBZ0IscUJBQXFCO0FBQzFFLGNBQU0sK0NBQStDO0FBQ3JEO0FBQUEsTUFDRjtBQUNBLFVBQUksQ0FBQyxPQUFPLFlBQVksQ0FBQyxPQUFPLFNBQVMsU0FBUztBQUNoRCxjQUFNLGlDQUFpQztBQUN2QztBQUFBLE1BQ0Y7QUFDQSxnQkFBVSxxQkFBZ0I7QUFDMUIsWUFBTSxNQUFNLE1BQU0sS0FBSyxZQUFZO0FBQ25DLFlBQU0sS0FBSyxLQUFLLEtBQUssS0FBSyxFQUFFLE1BQU0sUUFBUSxDQUFDO0FBQzNDLFlBQU0sVUFBVSxHQUFHLFdBQVc7QUFBQSxRQUM1QixDQUFDLE1BQ0MsT0FBTyxLQUFLLEVBQUUsRUFDWCxLQUFLLEVBQ0wsWUFBWSxNQUFNO0FBQUEsTUFDekI7QUFDQSxVQUFJLENBQUMsU0FBUztBQUNaO0FBQUEsVUFDRSw2REFBd0QsR0FBRyxXQUFXLEtBQUssSUFBSTtBQUFBLFVBQy9FO0FBQUEsUUFDRjtBQUNBO0FBQUEsTUFDRjtBQUNBLFlBQU0sUUFBUSxHQUFHLE9BQU8sT0FBTztBQUMvQixZQUFNLE9BQU8sS0FBSyxNQUFNLGNBQWMsT0FBTyxFQUFFLFFBQVEsR0FBRyxRQUFRLElBQUksS0FBSyxLQUFLLENBQUM7QUFDakYsZ0JBQVUsZUFBZSxLQUFLLFNBQVMscUJBQXFCLFVBQVUsU0FBSTtBQUMxRSxZQUFNLFNBQVMsT0FBTyxnQkFBZ0Isb0JBQW9CLElBQUk7QUFDOUQsVUFBSSxDQUFDLE9BQU8sS0FBSyxRQUFRO0FBQ3ZCLGtCQUFVLG1EQUEyQyxTQUFTO0FBQzlEO0FBQUEsTUFDRjtBQUNBLFlBQU0sWUFBWSxjQUFjO0FBQ2hDLFlBQU0sY0FBYyx5QkFBeUIsWUFBWSxNQUFNLFVBQVU7QUFDekUsZ0JBQVUsK0JBQStCLFNBQVMsS0FBSyxJQUFJLElBQUksU0FBSTtBQUNuRSxZQUFNLGFBQWEsT0FBTyxTQUFTLFFBQVEsRUFBRSxJQUFJLFdBQVc7QUFDNUQsWUFBTSxXQUFXLElBQUksTUFBTTtBQUFBLFFBQ3pCLGFBQWEsS0FBSyxRQUFRO0FBQUEsUUFDMUIsZ0JBQWdCO0FBQUEsVUFDZDtBQUFBLFVBQ0EsWUFBYSxPQUFPLGVBQWUsT0FBTyxZQUFZLFNBQVU7QUFBQSxVQUNoRSxnQkFBZ0IsS0FBSyxRQUFRO0FBQUEsUUFDL0I7QUFBQSxNQUNGLENBQUM7QUFDRCxnQkFBVSxvQ0FBb0MsT0FBTyxLQUFLLFNBQVMsY0FBUztBQUM1RSxZQUFNLGFBQWMsT0FBTyxlQUFlLE9BQU8sWUFBWSxTQUFVO0FBQ3ZFLFlBQU0sVUFBVTtBQUFBLFFBQ2Q7QUFBQSxRQUNBLFVBQ0UsT0FBTyxZQUFZLE9BQU8sU0FBUyxhQUFhLE9BQU8sU0FBUyxVQUFVLGFBQ3RFLE9BQU8sU0FBUyxVQUFVLFdBQVcsZ0JBQWdCLEtBQ3JELG9CQUFJLEtBQUssR0FBRSxZQUFZO0FBQUEsUUFDN0I7QUFBQSxRQUNBLGdCQUFnQixLQUFLLFFBQVE7QUFBQSxRQUM3QixhQUFhO0FBQUEsUUFDYjtBQUFBLFFBQ0E7QUFBQSxRQUNBLFdBQVcsT0FBTyxLQUFLO0FBQUEsUUFDdkIsZ0JBQWdCLE9BQU87QUFBQSxRQUN2QixnQkFBZ0IsT0FBTztBQUFBLFFBQ3ZCLE1BQU0sT0FBTztBQUFBLE1BQ2Y7QUFDQSxZQUFNLE9BQU8sS0FBSyxXQUFXLGtCQUFrQixFQUFFLElBQUksT0FBTyxFQUFFLElBQUksT0FBTztBQUl6RSx1QkFBaUIsT0FBTyxJQUFJLE9BQU8sT0FBTyxDQUFDLEdBQUcsU0FBUyxFQUFFLFVBQVUsb0JBQUksS0FBSyxFQUFFLENBQUM7QUFDL0U7QUFBQSxRQUNFLGdCQUFXLE9BQU8sS0FBSyxTQUFTLGdCQUFhLE9BQU8sZUFBZSxTQUFTO0FBQUEsUUFDNUU7QUFBQSxNQUNGO0FBQ0EsMkJBQXFCO0FBQUEsSUFDdkIsU0FBUyxHQUFHO0FBQ1YsY0FBUSxNQUFNLGtDQUFrQyxVQUFVLFVBQVUsQ0FBQztBQUNyRSxnQkFBVSxvQkFBZ0IsS0FBSyxFQUFFLFdBQVksSUFBSSxTQUFTO0FBQzFELFVBQUksS0FBSyxFQUFFLFNBQVMsb0JBQW9CO0FBQ3RDO0FBQUEsVUFDRSw2SUFDRSxFQUFFO0FBQUEsUUFDTjtBQUFBLE1BQ0Y7QUFBQSxJQUNGLFVBQUU7QUFDQSxVQUFJLFNBQVMsTUFBTSxPQUFRLE9BQU0sT0FBTyxRQUFRO0FBQUEsSUFDbEQ7QUFBQSxFQUNGO0FBTUEsaUJBQWUsc0JBQXNCO0FBQ25DLFFBQUksQ0FBQyxPQUFPLEtBQU0sT0FBTSxJQUFJLE1BQU0sMkJBQTJCO0FBQzdELFlBQVEsSUFBSSw0Q0FBNEM7QUFDeEQsVUFBTSxDQUFDLE1BQU0sT0FBTyxJQUFJLE1BQU0sUUFBUSxJQUFJO0FBQUEsTUFDeEMsT0FBTyxLQUFLLFdBQVcsaUJBQWlCLEVBQUUsSUFBSTtBQUFBLE1BQzlDLE9BQU8sS0FBSyxXQUFXLHNCQUFzQixFQUFFLElBQUksU0FBUyxFQUFFLElBQUk7QUFBQSxJQUNwRSxDQUFDO0FBQ0QsVUFBTSxPQUFPLENBQUM7QUFDZCxTQUFLLFFBQVEsQ0FBQyxNQUFNLEtBQUssS0FBSyxPQUFPLE9BQU8sRUFBRSxJQUFJLEVBQUUsR0FBRyxHQUFHLEVBQUUsS0FBSyxDQUFDLENBQUMsQ0FBQztBQUNwRSxTQUFLLEtBQUssQ0FBQyxHQUFHLE1BQU07QUFDbEIsWUFBTSxLQUFNLEVBQUUsV0FBVyxFQUFFLFFBQVEsUUFBUztBQUM1QyxZQUFNLEtBQU0sRUFBRSxXQUFXLEVBQUUsUUFBUSxRQUFTO0FBQzVDLGFBQU8sS0FBSztBQUFBLElBQ2QsQ0FBQztBQUNELHdCQUFvQjtBQUNwQix3QkFBb0IsUUFBUSxTQUFTLFFBQVEsS0FBSyxJQUFJO0FBQ3RELFlBQVEsSUFBSSwwQkFBMEIsS0FBSyxRQUFRLG1CQUFnQixDQUFDLENBQUMsaUJBQWlCO0FBQ3RGLFdBQU87QUFBQSxFQUNUO0FBRUEsV0FBUyxnQkFBZ0IsR0FBRztBQUMxQixRQUFJLEtBQUssS0FBTSxRQUFPO0FBQ3RCLFFBQUksSUFBSSxJQUFLLFFBQU87QUFDcEIsUUFBSSxJQUFJLElBQUssUUFBTztBQUNwQixRQUFJLElBQUksSUFBSyxRQUFPO0FBQ3BCLFFBQUksSUFBSSxFQUFLLFFBQU87QUFDcEIsV0FBTztBQUFBLEVBQ1Q7QUFFQSxXQUFTLFFBQVEsR0FBRztBQUNsQixRQUFJLEtBQUssUUFBUSxDQUFDLE9BQU8sU0FBUyxPQUFPLENBQUMsQ0FBQyxFQUFHLFFBQU87QUFDckQsV0FBTyxPQUFPLENBQUMsRUFBRSxlQUFlLFNBQVMsRUFBRSx1QkFBdUIsRUFBRSxDQUFDO0FBQUEsRUFDdkU7QUFFQSxXQUFTLFNBQVMsR0FBRztBQUNuQixRQUFJLEtBQUssUUFBUSxDQUFDLE9BQU8sU0FBUyxPQUFPLENBQUMsQ0FBQyxFQUFHLFFBQU87QUFDckQsWUFBUSxPQUFPLENBQUMsSUFBSSxLQUFLLFFBQVEsQ0FBQyxJQUFJO0FBQUEsRUFDeEM7QUFFQSxXQUFTLFlBQVksS0FBSztBQUV4QixRQUFJO0FBQ0YsWUFBTSxDQUFDLEdBQUcsQ0FBQyxJQUFJLElBQUksTUFBTSxHQUFHLEVBQUUsSUFBSSxNQUFNO0FBQ3hDLFlBQU0sUUFBUTtBQUFBLFFBQ1o7QUFBQSxRQUNBO0FBQUEsUUFDQTtBQUFBLFFBQ0E7QUFBQSxRQUNBO0FBQUEsUUFDQTtBQUFBLFFBQ0E7QUFBQSxRQUNBO0FBQUEsUUFDQTtBQUFBLFFBQ0E7QUFBQSxRQUNBO0FBQUEsUUFDQTtBQUFBLE1BQ0Y7QUFDQSxhQUFPLE1BQU0sSUFBSSxDQUFDLElBQUksTUFBTSxPQUFPLENBQUMsRUFBRSxNQUFNLEVBQUU7QUFBQSxJQUNoRCxRQUFRO0FBQ04sYUFBTztBQUFBLElBQ1Q7QUFBQSxFQUNGO0FBRUEsV0FBUyx5QkFBeUI7QUFDaEMsVUFBTSxPQUFPLFNBQVMsZUFBZSxtQkFBbUI7QUFDeEQsUUFBSSxDQUFDLEtBQU07QUFDWCxRQUFJO0FBQ0YsaUNBQTJCLElBQUk7QUFBQSxJQUNqQyxTQUFTLEdBQUc7QUFDVixjQUFRLE1BQU0sK0JBQStCLENBQUM7QUFDOUMsV0FBSyxZQUNILHNTQUdBLGVBQWUsRUFBRSxTQUFTLEVBQUUsV0FBVyxPQUFPLENBQUMsQ0FBQyxJQUNoRDtBQUFBLElBQ0o7QUFBQSxFQUNGO0FBRUEsV0FBUywyQkFBMkIsTUFBTTtBQUN4QyxVQUFNLE9BQU8scUJBQXFCLENBQUM7QUFDbkMsVUFBTSxPQUFPLHFCQUFxQixDQUFDO0FBQ25DLFVBQU0sVUFBVSxLQUFLLFdBQVcsQ0FBQztBQUNqQyxZQUFRLElBQUksdUNBQWtDLEtBQUssUUFBUSxTQUFTLENBQUMsQ0FBQyxLQUFLLFdBQVc7QUFDdEYsUUFBSSxDQUFDLEtBQUssUUFBUTtBQUNoQixXQUFLLFlBQ0g7QUFJRjtBQUFBLElBQ0Y7QUFFQSxVQUFNLGFBQWEsS0FBSyxDQUFDLEVBQUUsWUFBWSxDQUFDLEdBQUcsSUFBSSxDQUFDLE1BQU0sRUFBRSxFQUFFO0FBQzFELFVBQU0sZUFBZSxVQUFVLElBQUksV0FBVztBQUc5QyxVQUFNLFlBQVksS0FBSyxjQUNuQixJQUFJLEtBQUssS0FBSyxXQUFXLEVBQUUsZUFBZSxTQUFTO0FBQUEsTUFDakQsS0FBSztBQUFBLE1BQ0wsT0FBTztBQUFBLE1BQ1AsTUFBTTtBQUFBLE1BQ04sTUFBTTtBQUFBLE1BQ04sUUFBUTtBQUFBLElBQ1YsQ0FBQyxJQUNEO0FBQ0osVUFBTSxVQUNKLFFBQVEsZ0NBQWdDLE9BQ3BDLFNBQVMsUUFBUSw0QkFBNEIsSUFDN0M7QUFDTixVQUFNLFFBQVEsUUFBUSxpQkFBaUIsS0FBSztBQUM1QyxVQUFNLFFBQ0osUUFBUSx3QkFBd0IsT0FBTyxRQUFRLHVCQUF1QixNQUFNLFFBQVE7QUFDdEYsVUFBTSxRQUNKLFFBQVEsd0JBQXdCLE9BQU8sUUFBUSx1QkFBdUIsTUFBTSxRQUFRO0FBRXRGLFVBQU0sU0FDSiw4Y0FFQSxVQUNBLDhNQUVBLFFBQ0EsZ05BRUEsUUFDQSw0TUFFQSxRQUNBLG1PQUVBLGVBQWUsU0FBUyxJQUN4QjtBQUlGLFVBQU0sV0FBVyxLQUNkLElBQUksQ0FBQyxNQUFNO0FBQ1YsWUFBTSxPQUFPLEVBQUUsV0FBVyxFQUFFLFFBQVEsUUFBUSxPQUFPLEVBQUUsUUFBUSxPQUFPO0FBQ3BFLFlBQU0sWUFBWSxFQUFFLGFBQWE7QUFDakMsWUFBTSxjQUFjLENBQUM7QUFDckIsT0FBQyxFQUFFLFlBQVksQ0FBQyxHQUFHLFFBQVEsQ0FBQyxNQUFNO0FBQ2hDLG9CQUFZLEVBQUUsRUFBRSxJQUFJLEVBQUU7QUFBQSxNQUN4QixDQUFDO0FBQ0QsWUFBTSxhQUFhLFVBQ2hCO0FBQUEsUUFDQyxDQUFDLE9BQ0MsK0hBQ0EsUUFBUSxZQUFZLEVBQUUsQ0FBQyxJQUN2QjtBQUFBLE1BQ0osRUFDQyxLQUFLLEVBQUU7QUFDVixZQUFNLFVBQVUsRUFBRSxZQUFZLENBQUMsR0FBRyxPQUFPLENBQUMsR0FBRyxNQUFNLEtBQUssT0FBTyxFQUFFLEtBQUssS0FBSyxJQUFJLENBQUM7QUFDaEYsYUFDRSwwQ0FDQSxlQUFlLEVBQUUsRUFBRSxJQUNuQiwrUEFFQSxlQUFlLEVBQUUsY0FBYyxFQUFFLEVBQUUsSUFDbkMsa0ZBRUEsZUFBZSxTQUFTLElBQ3hCLHlJQUVBLGdCQUFnQixJQUFJLElBQ3BCLGlEQUNBLFNBQVMsSUFBSSxJQUNiLGlCQUNBLGFBQ0Esa0pBQ0EsUUFBUSxNQUFNLElBQ2Q7QUFBQSxJQUdKLENBQUMsRUFDQSxLQUFLLEVBQUU7QUFFVixVQUFNLG1CQUFtQixhQUN0QjtBQUFBLE1BQ0MsQ0FBQyxNQUNDLDZIQUNBLGVBQWUsQ0FBQyxJQUNoQjtBQUFBLElBQ0osRUFDQyxLQUFLLEVBQUU7QUFFVixVQUFNLFFBQ0osMmlCQU1BLG1CQUNBLG1LQUdBLFdBQ0E7QUFFRixVQUFNLFNBQ0o7QUFLRixTQUFLLFlBQVksK0JBQStCLFNBQVMsUUFBUSxTQUFTO0FBQUEsRUFDNUU7QUFhQSxXQUFTLHVCQUF1QixLQUFLO0FBQ25DLFVBQU0sS0FBSyxJQUFJLFlBQVksQ0FBQztBQUM1QixRQUFJLENBQUMsR0FBRztBQUNOLGFBQU87QUFFVCxVQUFNLElBQUksS0FDUixJQUFJO0FBQ04sVUFBTSxPQUFPLElBQ1gsT0FBTyxJQUNQLE9BQU8sSUFDUCxPQUFPO0FBQ1QsVUFBTSxTQUFTLElBQUksT0FBTztBQUMxQixVQUFNLFNBQVMsSUFBSSxPQUFPO0FBRzFCLFVBQU0sT0FBTyxLQUFLLElBQUksR0FBRyxHQUFHLEdBQUcsSUFBSSxDQUFDLE1BQU0sT0FBTyxFQUFFLElBQUksS0FBSyxPQUFPLEVBQUUsS0FBSyxLQUFLLENBQUMsQ0FBQztBQUNqRixVQUFNLE9BQU87QUFDYixVQUFNLFNBQVMsQ0FBQyxNQUFNLE9BQVEsU0FBUyxJQUFLLEtBQUssSUFBSSxHQUFHLEdBQUcsU0FBUyxDQUFDO0FBQ3JFLFVBQU0sU0FBUyxDQUFDLE1BQU0sT0FBTyxTQUFVLFVBQVUsSUFBSSxTQUFVLE9BQU87QUFHdEUsVUFBTSxTQUFTLENBQUMsR0FBRyxNQUFNLEtBQUssTUFBTSxDQUFDLEVBQ2xDLElBQUksQ0FBQyxNQUFNO0FBQ1YsWUFBTSxNQUFNLE9BQU8sS0FBSyxPQUFPO0FBQy9CLFlBQU0sS0FBSyxPQUFPLEdBQUc7QUFDckIsYUFDRSxlQUNBLE9BQ0EsV0FDQSxLQUNBLFlBQ0MsSUFBSSxRQUNMLFdBQ0EsS0FDQSxvREFFQyxPQUFPLEtBQ1IsV0FDQyxLQUFLLEtBQ04sdURBQ0EsUUFBUSxHQUFHLElBQ1g7QUFBQSxJQUVKLENBQUMsRUFDQSxLQUFLLEVBQUU7QUFHVixVQUFNLFVBQVUsR0FDYixJQUFJLENBQUMsR0FBRyxNQUFNO0FBQ2IsWUFBTSxLQUFLLE9BQU8sQ0FBQztBQUNuQixhQUNFLGNBQ0EsS0FDQSxXQUNDLElBQUksT0FBTyxNQUNaLDBEQUNBLFlBQVksRUFBRSxFQUFFLElBQ2hCO0FBQUEsSUFFSixDQUFDLEVBQ0EsS0FBSyxFQUFFO0FBR1YsVUFBTSxhQUNKLEdBQUcsSUFBSSxDQUFDLEdBQUcsTUFBTSxPQUFPLENBQUMsSUFBSSxNQUFNLE9BQU8sT0FBTyxFQUFFLElBQUksS0FBSyxDQUFDLENBQUMsRUFBRSxLQUFLLEdBQUcsSUFDeEUsTUFDQSxHQUNHLE1BQU0sRUFDTixRQUFRLEVBQ1IsSUFBSSxDQUFDLEdBQUcsTUFBTSxPQUFPLEdBQUcsU0FBUyxJQUFJLENBQUMsSUFBSSxNQUFNLE9BQU8sT0FBTyxFQUFFLElBQUksS0FBSyxDQUFDLENBQUMsRUFDM0UsS0FBSyxHQUFHO0FBQ2IsVUFBTSxPQUFPLHNCQUFzQixhQUFhO0FBR2hELFVBQU0sYUFBYSxHQUFHLElBQUksQ0FBQyxHQUFHLE1BQU0sT0FBTyxDQUFDLElBQUksTUFBTSxPQUFPLE9BQU8sRUFBRSxLQUFLLEtBQUssQ0FBQyxDQUFDLEVBQUUsS0FBSyxHQUFHO0FBQzVGLFVBQU0sT0FDSix1QkFDQSxhQUNBO0FBQ0YsVUFBTSxTQUFTLEdBQ1o7QUFBQSxNQUNDLENBQUMsR0FBRyxNQUNGLGlCQUNBLE9BQU8sQ0FBQyxJQUNSLFdBQ0EsT0FBTyxPQUFPLEVBQUUsS0FBSyxLQUFLLENBQUMsSUFDM0I7QUFBQSxJQUNKLEVBQ0MsS0FBSyxFQUFFO0FBRVYsVUFBTSxjQUFjLEdBQ2pCLElBQUksQ0FBQyxHQUFHLE1BQU07QUFDYixZQUFNLEtBQUssT0FBTyxDQUFDO0FBQ25CLFlBQU0sS0FBSyxPQUFPLE9BQU8sRUFBRSxLQUFLLEtBQUssQ0FBQztBQUN0QyxhQUNFLGNBQ0EsS0FDQSxXQUNDLEtBQUssS0FDTiw0RUFDQSxRQUFRLEVBQUUsS0FBSyxJQUNmO0FBQUEsSUFFSixDQUFDLEVBQ0EsS0FBSyxFQUFFO0FBRVYsVUFBTSxNQUNKLHVCQUNBLElBQ0EsTUFDQSxJQUNBLCtFQUVBLElBQ0EsZUFDQSxJQUNBLG9CQUNBLFNBQ0EsVUFDQSxPQUNBLE9BQ0EsU0FDQSxjQUNBO0FBQ0YsV0FBTztBQUFBLEVBQ1Q7QUFFQSxTQUFPLHlCQUF5QixTQUFVLE9BQU87QUFDL0MsUUFBSSxDQUFDLGtCQUFtQjtBQUN4QixVQUFNLE1BQU0sa0JBQWtCLEtBQUssQ0FBQyxNQUFNLEVBQUUsT0FBTyxLQUFLO0FBQ3hELFFBQUksQ0FBQyxLQUFLO0FBQ1IsWUFBTSxrQ0FBK0IsS0FBSztBQUMxQztBQUFBLElBQ0Y7QUFDQSxVQUFNLFdBQVcsU0FBUyxlQUFlLHNCQUFzQjtBQUMvRCxRQUFJLFNBQVUsVUFBUyxPQUFPO0FBRTlCLFVBQU0sS0FBSyxTQUFTLGNBQWMsS0FBSztBQUN2QyxPQUFHLEtBQUs7QUFDUixPQUFHLE1BQU0sVUFDUDtBQUNGLE9BQUcsVUFBVSxDQUFDLE9BQU87QUFDbkIsVUFBSSxHQUFHLFdBQVcsR0FBSSxJQUFHLE9BQU87QUFBQSxJQUNsQztBQUVBLFVBQU0sT0FBTyxJQUFJLFdBQVcsSUFBSSxRQUFRO0FBQ3hDLFVBQU0sT0FBTyxJQUFJLFdBQVcsSUFBSSxRQUFRO0FBQ3hDLFVBQU0sTUFBTSxJQUFJLFdBQVcsSUFBSSxRQUFRO0FBQ3ZDLFVBQU0sT0FBTyxJQUFJLFdBQVcsSUFBSSxRQUFRO0FBQ3hDLFVBQU0sWUFBWSxJQUFJLGFBQWE7QUFDbkMsVUFBTSxZQUFZLElBQUksYUFBYTtBQUNuQyxVQUFNLFVBQVUsdUJBQXVCLEdBQUc7QUFFMUMsVUFBTSxjQUNKLGdUQUVBLGVBQWUsU0FBUyxJQUN4QixxTkFFQSxnQkFBZ0IsSUFBSSxJQUNwQixPQUNBLFNBQVMsSUFBSSxJQUNiLGlOQUVDLFFBQVEsUUFBUSxPQUFPLEtBQUssUUFBUSxDQUFDLElBQUksTUFBTSxZQUNoRCwrTUFFQSxRQUFRLEdBQUcsSUFDWCxnTkFFQSxRQUFRLElBQUksSUFDWjtBQUdGLFVBQU0sWUFDSix5WUFPQyxJQUFJLFlBQVksQ0FBQyxHQUNmO0FBQUEsTUFDQyxDQUFDLE1BQ0MsMkZBQ0EsZUFBZSxZQUFZLEVBQUUsRUFBRSxDQUFDLElBQ2hDLHdFQUVBLFFBQVEsRUFBRSxLQUFLLElBQ2YsZ0ZBRUEsUUFBUSxFQUFFLElBQUksSUFDZCxnRkFFQSxRQUFRLEVBQUUsSUFBSSxJQUNkO0FBQUEsSUFDSixFQUNDLEtBQUssRUFBRSxJQUNWO0FBRUYsVUFBTSxVQUNKLCthQUdBLGVBQWUsSUFBSSxjQUFjLElBQUksRUFBRSxJQUN2Qyx3UEFHQSxjQUNBLHNIQUNBLFVBQ0EsV0FDQSxZQUNBLHdGQUNBLGVBQWUsU0FBUyxJQUN4Qiw0QkFDQSxnQkFBZ0IsSUFBSSxVQUFVLENBQUMsR0FBRyxZQUFZLFFBQUcsSUFDakQ7QUFFRixPQUFHLFlBQVk7QUFDZixhQUFTLEtBQUssWUFBWSxFQUFFO0FBQUEsRUFDOUI7QUFFQSxTQUFPLG9CQUFvQixpQkFBa0I7QUFDM0MsUUFBSSxDQUFDLGFBQWEsR0FBRztBQUNuQixZQUFNLHdDQUF3QztBQUM5QztBQUFBLElBQ0Y7QUFDQSxVQUFNLEtBQUssa0JBQWtCO0FBQzdCLE9BQUcsTUFBTSxVQUFVO0FBRW5CLHlCQUFxQjtBQUNyQix5QkFBcUIsRUFDbEIsS0FBSyxvQkFBb0IsRUFDekIsTUFBTSxNQUFNO0FBQUEsSUFBQyxDQUFDO0FBQUEsRUFDbkI7QUFFQSxTQUFPLHFCQUFxQixXQUFZO0FBQ3RDLFVBQU0sS0FBSyxTQUFTLGVBQWUsZ0JBQWdCO0FBQ25ELFFBQUksR0FBSSxJQUFHLE1BQU0sVUFBVTtBQUFBLEVBQzdCO0FBTUEsaUJBQWUsMkJBQTJCO0FBQ3hDLFFBQUksQ0FBQyxPQUFPLEtBQU07QUFDbEIsUUFBSTtBQUNGLFlBQU0sTUFBTSxNQUFNLE9BQU8sS0FBSyxXQUFXLGlCQUFpQixFQUFFLElBQUksYUFBYSxFQUFFLElBQUk7QUFDbkYsVUFBSSxJQUFJLFFBQVE7QUFDZCxjQUFNLElBQUksSUFBSSxLQUFLLEtBQUssQ0FBQztBQUN6QiwrQkFBdUIsRUFBRSxnQkFBZ0IsQ0FBQztBQUFBLE1BQzVDLE9BQU87QUFDTCwrQkFBdUIsQ0FBQztBQUFBLE1BQzFCO0FBQUEsSUFDRixTQUFTLEdBQUc7QUFDVixjQUFRLEtBQUssMENBQTBDLEtBQUssRUFBRSxPQUFPO0FBQ3JFLDZCQUF1QixDQUFDO0FBQUEsSUFDMUI7QUFBQSxFQUNGO0FBRUEsaUJBQWUsd0JBQXdCLFVBQVUsT0FBTztBQUN0RCxRQUFJLENBQUMsT0FBTyxLQUFNO0FBQ2xCLFFBQUksQ0FBQyxxQkFBc0Isd0JBQXVCLENBQUM7QUFDbkQsVUFBTSxNQUFPLE9BQU8sZUFBZSxPQUFPLFlBQVksU0FBVTtBQUNoRSx5QkFBcUIsUUFBUSxJQUFJO0FBQUEsTUFDL0IsT0FBTyxPQUFPLEtBQUs7QUFBQSxNQUNuQixZQUFXLG9CQUFJLEtBQUssR0FBRSxZQUFZO0FBQUEsTUFDbEMsV0FBVztBQUFBLElBQ2I7QUFDQSxVQUFNLE9BQU8sS0FBSyxXQUFXLGlCQUFpQixFQUFFLElBQUksYUFBYSxFQUFFLElBQUk7QUFBQSxNQUNyRSxjQUFjO0FBQUEsTUFDZCxZQUFXLG9CQUFJLEtBQUssR0FBRSxZQUFZO0FBQUEsTUFDbEMsV0FBVztBQUFBLElBQ2IsQ0FBQztBQUFBLEVBQ0g7QUFFQSxpQkFBZSwwQkFBMEIsVUFBVTtBQUNqRCxRQUFJLENBQUMsT0FBTyxRQUFRLENBQUMscUJBQXNCO0FBQzNDLFdBQU8scUJBQXFCLFFBQVE7QUFDcEMsVUFBTSxNQUFPLE9BQU8sZUFBZSxPQUFPLFlBQVksU0FBVTtBQUNoRSxVQUFNLE9BQU8sS0FBSyxXQUFXLGlCQUFpQixFQUFFLElBQUksYUFBYSxFQUFFLElBQUk7QUFBQSxNQUNyRSxjQUFjO0FBQUEsTUFDZCxZQUFXLG9CQUFJLEtBQUssR0FBRSxZQUFZO0FBQUEsTUFDbEMsV0FBVztBQUFBLElBQ2IsQ0FBQztBQUFBLEVBQ0g7QUFHQSxXQUFTLHVCQUF1QixVQUFVO0FBQ3hDLFVBQU0sTUFBTSx1QkFBdUIsb0JBQW9CLFFBQVE7QUFDL0QsUUFBSSxDQUFDLE9BQU8sQ0FBQyxJQUFJLE1BQU8sUUFBTyxFQUFFLE9BQU8sR0FBSyxRQUFRLFdBQVcsUUFBUSxHQUFHLFVBQVUsRUFBRTtBQUN2RixVQUFNLE1BQU0sb0JBQUksS0FBSztBQUNyQixVQUFNLGdCQUFnQixDQUFDLE1BQU07QUFDM0IsWUFBTSxJQUFJLElBQUksS0FBSyxJQUFJLFlBQVksR0FBRyxJQUFJLFNBQVMsSUFBSSxHQUFHLENBQUM7QUFDM0QsYUFBTyxPQUFPLEVBQUUsWUFBWSxDQUFDLElBQUksTUFBTSxPQUFPLEVBQUUsU0FBUyxJQUFJLENBQUMsRUFBRSxTQUFTLEdBQUcsR0FBRztBQUFBLElBQ2pGO0FBQ0EsVUFBTSxhQUFhLENBQUMsTUFBTTtBQUN4QixVQUFJLE1BQU07QUFDVixVQUFJLFFBQVE7QUFDWixlQUFTLElBQUksR0FBRyxLQUFLLEdBQUcsS0FBSztBQUMzQixjQUFNLElBQUksY0FBYyxDQUFDO0FBQ3pCLGNBQU0sSUFBSSxJQUFJLE1BQU0sQ0FBQztBQUNyQixZQUFJLEtBQUssT0FBTyxTQUFTLE9BQU8sRUFBRSxHQUFHLENBQUMsR0FBRztBQUN2QyxpQkFBTyxPQUFPLEVBQUUsR0FBRztBQUNuQjtBQUFBLFFBQ0Y7QUFBQSxNQUNGO0FBQ0EsYUFBTyxRQUFRLElBQUksRUFBRSxLQUFLLE1BQU0sT0FBTyxHQUFHLE1BQU0sSUFBSSxFQUFFLEtBQUssR0FBRyxHQUFHLEVBQUU7QUFBQSxJQUNyRTtBQUNBLFVBQU0sT0FBTyxXQUFXLHVCQUF1QjtBQUMvQyxVQUFNLE9BQU8sV0FBVyx5QkFBeUI7QUFFakQsUUFBSSxLQUFLLE1BQU0sS0FBSyxLQUFLLElBQUksS0FBSyxLQUFLLE1BQU0sd0JBQXdCO0FBQ25FLGFBQU8sRUFBRSxPQUFPLEdBQUssUUFBUSxXQUFXLFFBQVEsS0FBSyxLQUFLLFVBQVUsS0FBSyxJQUFJO0FBQUEsSUFDL0U7QUFDQSxRQUFJLFFBQVEsS0FBSyxNQUFNLEtBQUs7QUFDNUIsUUFBSSxRQUFRLGNBQWUsU0FBUTtBQUNuQyxRQUFJLFFBQVEsY0FBZSxTQUFRO0FBQ25DLFdBQU87QUFBQSxNQUNMLE9BQU8sS0FBSyxNQUFNLFFBQVEsR0FBRyxJQUFJO0FBQUEsTUFDakMsUUFBUTtBQUFBLE1BQ1IsUUFBUSxLQUFLLE1BQU0sS0FBSyxNQUFNLEVBQUUsSUFBSTtBQUFBLE1BQ3BDLFVBQVUsS0FBSyxNQUFNLEtBQUssTUFBTSxFQUFFLElBQUk7QUFBQSxJQUN4QztBQUFBLEVBQ0Y7QUFFQSxXQUFTLHdCQUF3QixVQUFVO0FBRXpDLFFBQUksd0JBQXdCLHFCQUFxQixRQUFRLEdBQUc7QUFDMUQsYUFBTztBQUFBLFFBQ0wsT0FBTyxPQUFPLHFCQUFxQixRQUFRLEVBQUUsS0FBSyxLQUFLO0FBQUEsUUFDdkQsUUFBUTtBQUFBLFFBQ1IsTUFBTSx1QkFBdUIsUUFBUTtBQUFBLE1BQ3ZDO0FBQUEsSUFDRjtBQUNBLFVBQU0sT0FBTyx1QkFBdUIsUUFBUTtBQUM1QyxXQUFPLEVBQUUsT0FBTyxLQUFLLE9BQU8sUUFBUSxLQUFLLFFBQVEsS0FBSztBQUFBLEVBQ3hEO0FBRUEsaUJBQWUsd0JBQXdCO0FBQ3JDLFFBQUksQ0FBQyxPQUFPLEtBQU07QUFDbEIsUUFBSTtBQUNGLFlBQU0sTUFBTSxNQUFNLE9BQU8sS0FBSyxXQUFXLGlCQUFpQixFQUFFLElBQUksbUJBQW1CLEVBQUUsSUFBSTtBQUN6RixVQUFJLElBQUksUUFBUTtBQUNkLGNBQU0sSUFBSSxJQUFJLEtBQUssS0FBSyxDQUFDO0FBQ3pCLGNBQU0sTUFBTSxNQUFNLFFBQVEsRUFBRSxJQUFJLElBQUksRUFBRSxPQUFPLENBQUM7QUFDOUMsNEJBQW9CLElBQUksSUFBSSxJQUFJLElBQUksQ0FBQyxNQUFNLE9BQU8sQ0FBQyxFQUFFLEtBQUssRUFBRSxZQUFZLENBQUMsQ0FBQztBQUMxRSw0QkFBb0IsRUFBRSxXQUFXLEVBQUUsV0FBVyxXQUFXLEVBQUUsVUFBVTtBQUFBLE1BQ3ZFLE9BQU87QUFDTCw0QkFBb0Isb0JBQUksSUFBSTtBQUM1Qiw0QkFBb0I7QUFBQSxNQUN0QjtBQUFBLElBQ0YsU0FBUyxHQUFHO0FBQ1YsY0FBUSxLQUFLLDJDQUEyQyxLQUFLLEVBQUUsT0FBTztBQUN0RSwwQkFBb0Isb0JBQUksSUFBSTtBQUFBLElBQzlCO0FBQUEsRUFDRjtBQUVBLGlCQUFlLHdCQUF3QjtBQUNyQyxRQUFJLENBQUMsT0FBTyxRQUFRLENBQUMsa0JBQW1CO0FBQ3hDLFVBQU0sTUFBTyxPQUFPLGVBQWUsT0FBTyxZQUFZLFNBQVU7QUFDaEUsVUFBTSxVQUFVO0FBQUEsTUFDZCxNQUFNLE1BQU0sS0FBSyxpQkFBaUIsRUFBRSxLQUFLO0FBQUEsTUFDekMsWUFBVyxvQkFBSSxLQUFLLEdBQUUsWUFBWTtBQUFBLE1BQ2xDLFdBQVc7QUFBQSxJQUNiO0FBQ0EsVUFBTSxPQUFPLEtBQUssV0FBVyxpQkFBaUIsRUFBRSxJQUFJLG1CQUFtQixFQUFFLElBQUksT0FBTztBQUNwRix3QkFBb0IsRUFBRSxXQUFXLFFBQVEsV0FBVyxXQUFXLFFBQVEsVUFBVTtBQUFBLEVBQ25GO0FBRUEsaUJBQWUsZ0JBQWdCO0FBQzdCLFFBQUksQ0FBQyxPQUFPLEtBQU0sT0FBTSxJQUFJLE1BQU0sMkJBQTJCO0FBQzdELFVBQU0sV0FBVyxDQUFDO0FBQ2xCLFFBQUksQ0FBQyxrQkFBbUIsVUFBUyxLQUFLLHNCQUFzQixDQUFDO0FBQzdELFFBQUksQ0FBQyxxQkFBc0IsVUFBUyxLQUFLLHlCQUF5QixDQUFDO0FBQ25FLFFBQUksQ0FBQyxvQkFBb0I7QUFDdkIsZUFBUztBQUFBLFFBQ1AsT0FBTyxLQUNKLFdBQVcsWUFBWSxFQUN2QixJQUFJLGdCQUFnQixFQUNwQixJQUFJLEVBQ0osS0FBSyxDQUFDLE1BQU07QUFDWCxnQkFBTSxPQUFPLEVBQUUsU0FBUyxFQUFFLEtBQUssSUFBSSxDQUFDO0FBQ3BDLGNBQUksS0FBSyxDQUFDO0FBQ1YsY0FBSSxLQUFLLENBQUM7QUFDVixjQUFJO0FBQ0YsaUJBQUssS0FBSyxxQkFBcUIsS0FBSyxNQUFNLEtBQUssa0JBQWtCLElBQUksQ0FBQztBQUFBLFVBQ3hFLFFBQVE7QUFDTixpQkFBSyxDQUFDO0FBQUEsVUFDUjtBQUNBLGNBQUk7QUFDRixpQkFBSyxLQUFLLGlCQUFpQixLQUFLLE1BQU0sS0FBSyxjQUFjLElBQUksQ0FBQztBQUFBLFVBQ2hFLFFBQVE7QUFDTixpQkFBSyxDQUFDO0FBQUEsVUFDUjtBQUNBLCtCQUFxQixFQUFFLG9CQUFvQixJQUFJLGdCQUFnQixHQUFHO0FBQUEsUUFDcEUsQ0FBQztBQUFBLE1BQ0w7QUFBQSxJQUNGO0FBQ0EsUUFBSSxDQUFDLHFCQUFxQjtBQUN4QixlQUFTO0FBQUEsUUFDUCxPQUFPLEtBQ0osV0FBVyxxQkFBcUIsRUFDaEMsSUFBSSxFQUNKLEtBQUssQ0FBQyxTQUFTO0FBQ2QsZ0JBQU0sTUFBTSxDQUFDO0FBQ2IsZUFBSyxRQUFRLENBQUMsUUFBUTtBQUNwQixrQkFBTSxJQUFJLElBQUksS0FBSztBQUNuQixnQkFBSSxDQUFDLEtBQUssQ0FBQyxFQUFFLElBQUs7QUFDbEIsZ0JBQUksT0FBTyxFQUFFLEdBQUcsRUFBRSxLQUFLLEVBQUUsWUFBWSxDQUFDLElBQUksRUFBRSxPQUFPLEVBQUUsU0FBUyxDQUFDLEVBQUU7QUFBQSxVQUNuRSxDQUFDO0FBQ0QsZ0NBQXNCO0FBQUEsUUFDeEIsQ0FBQztBQUFBLE1BQ0w7QUFBQSxJQUNGO0FBQ0EsVUFBTSxRQUFRLElBQUksUUFBUTtBQUFBLEVBQzVCO0FBRUEsV0FBUyw2QkFBNkIsVUFBVTtBQUc5QyxVQUFNLE1BQU0sdUJBQXVCLG9CQUFvQixRQUFRO0FBQy9ELFFBQUksQ0FBQyxPQUFPLENBQUMsSUFBSSxNQUFPLFFBQU87QUFDL0IsVUFBTSxNQUFNLG9CQUFJLEtBQUs7QUFDckIsVUFBTSxhQUFhLENBQUM7QUFDcEIsYUFBUyxJQUFJLEdBQUcsS0FBSyw0QkFBNEIsS0FBSztBQUNwRCxZQUFNLElBQUksSUFBSSxLQUFLLElBQUksWUFBWSxHQUFHLElBQUksU0FBUyxJQUFJLEdBQUcsQ0FBQztBQUMzRCxpQkFBVyxLQUFLLE9BQU8sRUFBRSxZQUFZLENBQUMsSUFBSSxNQUFNLE9BQU8sRUFBRSxTQUFTLElBQUksQ0FBQyxFQUFFLFNBQVMsR0FBRyxHQUFHLENBQUM7QUFBQSxJQUMzRjtBQUNBLFFBQUksTUFBTTtBQUNWLFFBQUksSUFBSTtBQUNSLGVBQVcsUUFBUSxDQUFDLE1BQU07QUFDeEIsWUFBTSxJQUFJLElBQUksTUFBTSxDQUFDO0FBQ3JCLFVBQUksS0FBSyxPQUFPLFNBQVMsT0FBTyxFQUFFLEdBQUcsQ0FBQyxHQUFHO0FBQ3ZDLGVBQU8sT0FBTyxFQUFFLEdBQUc7QUFDbkI7QUFBQSxNQUNGO0FBQUEsSUFDRixDQUFDO0FBQ0QsV0FBTyxJQUFJLElBQUksTUFBTSxJQUFJO0FBQUEsRUFDM0I7QUFFQSxXQUFTLHdCQUF3QixLQUFLO0FBR3BDLFFBQUksQ0FBQyxPQUFPLENBQUMsSUFBSSxPQUFRLFFBQU87QUFDaEMsVUFBTSxNQUFNLG9CQUFJLEtBQUs7QUFDckIsVUFBTSxhQUFhLE9BQU8sSUFBSSxZQUFZLENBQUMsSUFBSSxNQUFNLE9BQU8sSUFBSSxTQUFTLElBQUksQ0FBQyxFQUFFLFNBQVMsR0FBRyxHQUFHO0FBQy9GLFFBQUksTUFBTTtBQUNWLFdBQU8sS0FBSyxJQUFJLE1BQU0sRUFBRSxRQUFRLENBQUMsTUFBTTtBQUNyQyxVQUFJLEtBQUssV0FBWSxRQUFPLE9BQU8sSUFBSSxPQUFPLENBQUMsS0FBSyxDQUFDO0FBQUEsSUFDdkQsQ0FBQztBQUNELFdBQU87QUFBQSxFQUNUO0FBRUEsV0FBUywwQkFBMEI7QUFHakMsVUFBTSxPQUFPLENBQUM7QUFDZCxVQUFNLFdBQVcsQ0FBQyxRQUFRLE9BQU87QUFDakMsZUFBVyxPQUFPLFVBQVU7QUFDMUIsWUFBTSxRQUFRLGlCQUFpQixHQUFHO0FBQ2xDLFVBQUksQ0FBQyxTQUFTLENBQUMsTUFBTSxLQUFNO0FBQzNCLGlCQUFXLFNBQVMsTUFBTSxNQUFNO0FBQzlCLGNBQU0sTUFBTSxPQUFPLE1BQU0sT0FBTyxFQUFFLEVBQUUsS0FBSztBQUN6QyxjQUFNLFdBQVcsSUFBSSxZQUFZO0FBRWpDLFlBQUkscUJBQXFCLGtCQUFrQixJQUFJLFFBQVEsRUFBRztBQUMxRCxjQUFNLFVBQ0gsc0JBQ0MsbUJBQW1CLHNCQUNuQixtQkFBbUIsbUJBQW1CLEdBQUcsS0FDM0MsQ0FBQztBQUNILGNBQU0sYUFBYSxPQUFPLFFBQVEsSUFBSSxLQUFLLENBQUM7QUFDNUMsY0FBTSxhQUFhLE9BQU8sUUFBUSxJQUFJLEtBQUssQ0FBQztBQUM1QyxjQUFNLFlBQVk7QUFBQSxVQUNmLHNCQUNDLG1CQUFtQixrQkFDbkIsbUJBQW1CLGVBQWUsR0FBRyxLQUNyQztBQUFBLFFBQ0o7QUFDQSxjQUFNLGVBQWUsNkJBQTZCLFFBQVE7QUFDMUQsY0FBTSxlQUFlLHdCQUF3QixLQUFLO0FBQ2xELGNBQU0sTUFBTSxPQUFPLE1BQU0sT0FBTyxDQUFDO0FBRWpDLGNBQU0sV0FBVyx3QkFBd0IsUUFBUTtBQUNqRCxjQUFNLGFBQWEsU0FBUztBQUM1QixjQUFNLGtCQUFrQixlQUFlLGFBQWE7QUFDcEQsY0FBTSxVQUFVLGFBQWEsYUFBYSxlQUFlLFlBQVk7QUFDckUsWUFBSSxjQUFjO0FBQ2xCLFlBQUksVUFBVSxHQUFHO0FBQ2YsZ0JBQU0sVUFBVSxDQUFDO0FBQ2pCLHdCQUFjLE1BQU0sSUFBSSxLQUFLLElBQUksS0FBSyxLQUFLLEtBQUssVUFBVSxHQUFHLElBQUksR0FBRyxJQUFJLEtBQUssS0FBSyxPQUFPO0FBQUEsUUFDM0Y7QUFDQSxhQUFLLEtBQUs7QUFBQSxVQUNSLFNBQVM7QUFBQSxVQUNUO0FBQUEsVUFDQSxhQUFhLE1BQU0sZUFBZTtBQUFBLFVBQ2xDO0FBQUEsVUFDQTtBQUFBLFVBQ0E7QUFBQSxVQUNBO0FBQUEsVUFDQSxjQUFjLEtBQUssTUFBTSxlQUFlLEVBQUUsSUFBSTtBQUFBLFVBQzlDO0FBQUEsVUFDQTtBQUFBLFVBQ0EsWUFBWSxTQUFTO0FBQUE7QUFBQSxVQUNyQixVQUFVLFNBQVMsT0FBTyxTQUFTLEtBQUssUUFBUTtBQUFBO0FBQUEsVUFDaEQsaUJBQWlCLEtBQUssTUFBTSxrQkFBa0IsRUFBRSxJQUFJO0FBQUEsVUFDcEQsU0FBUyxLQUFLLE1BQU0sVUFBVSxFQUFFLElBQUk7QUFBQSxVQUNwQztBQUFBLFFBQ0YsQ0FBQztBQUFBLE1BQ0g7QUFBQSxJQUNGO0FBRUEsU0FBSyxLQUFLLENBQUMsR0FBRyxNQUFNLEVBQUUsY0FBYyxFQUFFLFdBQVc7QUFDakQsV0FBTztBQUFBLEVBQ1Q7QUFFQSxXQUFTLGNBQWMsR0FBRztBQUN4QixRQUFJLEtBQUssUUFBUSxDQUFDLE9BQU8sU0FBUyxPQUFPLENBQUMsQ0FBQyxFQUFHLFFBQU87QUFDckQsVUFBTSxJQUFJLE9BQU8sQ0FBQztBQUNsQixVQUFNLE1BQU0sS0FBSyxJQUFJLENBQUMsRUFBRSxlQUFlLFNBQVMsRUFBRSx1QkFBdUIsRUFBRSxDQUFDO0FBQzVFLFlBQVEsSUFBSSxJQUFJLFdBQU0sTUFBTTtBQUFBLEVBQzlCO0FBRUEsV0FBUyxRQUFRLEdBQUc7QUFDbEIsUUFBSSxLQUFLLFFBQVEsQ0FBQyxPQUFPLFNBQVMsT0FBTyxDQUFDLENBQUMsRUFBRyxRQUFPO0FBQ3JELFdBQU8sS0FBSyxNQUFNLE9BQU8sQ0FBQyxDQUFDLEVBQUUsZUFBZSxPQUFPO0FBQUEsRUFDckQ7QUFHQSxXQUFTLG1CQUFtQixHQUFHO0FBQzdCLFVBQU0sV0FBVyxPQUFPLEVBQUUsR0FBRyxFQUFFLEtBQUssRUFBRSxZQUFZO0FBQ2xELFVBQU0sV0FBVyxFQUFFLGVBQWU7QUFDbEMsVUFBTSxZQUFZLEVBQUUsZUFBZTtBQUNuQyxVQUFNLE1BQU0sT0FBTyxFQUFFLGNBQWMsQ0FBRyxFQUFFLFFBQVEsQ0FBQztBQUVqRCxRQUFJLFdBQVc7QUFDZixRQUFJLEVBQUUsYUFBYSxLQUFNLFlBQVc7QUFBQSxhQUMzQixFQUFFLGFBQWEsS0FBTSxZQUFXO0FBRXpDLFVBQU0sT0FBTyxXQUNULG9NQUNBLFlBQ0Usd01BQ0E7QUFFTixVQUFNLFdBQVcsV0FDYix1Q0FDQSxlQUFlLFFBQVEsSUFDdkIsMEtBQ0E7QUFFSixVQUFNLFdBQ0osWUFBWSxFQUFFLFlBQVksT0FDdEIsOEZBQ0EsT0FBTyxFQUFFLFFBQVEsRUFBRSxRQUFRLENBQUMsSUFDNUIsYUFDQTtBQUVOLFdBQ0UsdUdBRUEsZUFBZSxRQUFRLElBQ3ZCLHdKQUNBLFdBQ0EsaUNBQ0EsTUFDQSxZQUNBLE9BQ0EsV0FDQSxXQUNBO0FBQUEsRUFFSjtBQUVBLFNBQU8saUJBQWlCLFNBQVUsSUFBSSxVQUFVO0FBQzlDLFVBQU0sYUFBYSxXQUFXLEdBQUcsV0FBVyxLQUFLO0FBQ2pELFVBQU0sUUFBUSxTQUFTLGNBQWMsT0FBTztBQUM1QyxVQUFNLE9BQU87QUFDYixVQUFNLE9BQU87QUFDYixVQUFNLE1BQU07QUFDWixVQUFNLE1BQU07QUFDWixVQUFNLFFBQVEsT0FBTyxVQUFVO0FBQy9CLFVBQU0sTUFBTSxVQUNWO0FBQ0YsVUFBTSxTQUFTLEdBQUc7QUFDbEIsV0FBTyxhQUFhLE9BQU8sRUFBRTtBQUM3QixVQUFNLE1BQU07QUFDWixVQUFNLE9BQU87QUFFYixVQUFNLFNBQVMsWUFBWTtBQUN6QixZQUFNLElBQUksV0FBVyxNQUFNLEtBQUs7QUFDaEMsVUFBSSxPQUFPLE1BQU0sQ0FBQyxLQUFLLElBQUksT0FBTyxJQUFJLEdBQUc7QUFDdkMsMkJBQW1CO0FBQ25CO0FBQUEsTUFDRjtBQUNBLFVBQUksS0FBSyxJQUFJLElBQUksVUFBVSxJQUFJLE1BQU87QUFDcEMsMkJBQW1CO0FBQ25CO0FBQUEsTUFDRjtBQUNBLFVBQUk7QUFDRixjQUFNLHdCQUF3QixVQUFVLENBQUM7QUFDekMsMkJBQW1CO0FBQUEsTUFDckIsU0FBUyxHQUFHO0FBQ1YsY0FBTSx1QkFBdUIsRUFBRSxXQUFXLEVBQUU7QUFDNUMsMkJBQW1CO0FBQUEsTUFDckI7QUFBQSxJQUNGO0FBRUEsVUFBTSxTQUFTLE1BQU0sbUJBQW1CO0FBRXhDLFVBQU0saUJBQWlCLFFBQVEsTUFBTTtBQUNyQyxVQUFNLGlCQUFpQixXQUFXLENBQUMsT0FBTztBQUN4QyxVQUFJLEdBQUcsUUFBUSxTQUFTO0FBQ3RCLFdBQUcsZUFBZTtBQUNsQixjQUFNLEtBQUs7QUFBQSxNQUNiLFdBQVcsR0FBRyxRQUFRLFVBQVU7QUFDOUIsV0FBRyxlQUFlO0FBQ2xCLGVBQU87QUFBQSxNQUNUO0FBQUEsSUFDRixDQUFDO0FBQUEsRUFDSDtBQUVBLFNBQU8sa0JBQWtCLGVBQWdCLFVBQVU7QUFDakQsUUFBSSxDQUFDLFFBQVEsZ0NBQWdDLFdBQVcsK0JBQXlCLEVBQUc7QUFDcEYsUUFBSTtBQUNGLFlBQU0sMEJBQTBCLFFBQVE7QUFDeEMseUJBQW1CO0FBQUEsSUFDckIsU0FBUyxHQUFHO0FBQ1YsWUFBTSxhQUFhLEVBQUUsV0FBVyxFQUFFO0FBQUEsSUFDcEM7QUFBQSxFQUNGO0FBRUEsV0FBUyxxQkFBcUI7QUFDNUIsVUFBTSxPQUFPLFNBQVMsZUFBZSx3QkFBd0I7QUFDN0QsUUFBSSxDQUFDLEtBQU07QUFDWCxRQUFJO0FBQ0YsNkJBQXVCLElBQUk7QUFBQSxJQUM3QixTQUFTLEdBQUc7QUFDVixjQUFRLE1BQU0sK0JBQStCLENBQUM7QUFDOUMsV0FBSyxZQUNILDRQQUdBLGVBQWUsRUFBRSxTQUFTLEVBQUUsV0FBVyxPQUFPLENBQUMsQ0FBQyxJQUNoRDtBQUFBLElBQ0o7QUFBQSxFQUNGO0FBRUEsV0FBUyx1QkFBdUIsTUFBTTtBQUNwQyxVQUFNLFlBQVksQ0FBQyxFQUFFLGlCQUFpQixRQUFRLGlCQUFpQjtBQUMvRCxRQUFJLENBQUMsV0FBVztBQUNkLFdBQUssWUFBWTtBQUNqQjtBQUFBLElBQ0Y7QUFDQSxRQUFJLENBQUMsc0JBQXNCLENBQUMscUJBQXFCO0FBQy9DLFdBQUssWUFDSDtBQUlGLG9CQUFjLEVBQ1gsS0FBSyxrQkFBa0IsRUFDdkIsTUFBTSxDQUFDLE1BQU07QUFDWixnQkFBUSxNQUFNLDZCQUE2QixDQUFDO0FBQzVDLGFBQUssWUFDSCxtRUFDQSxlQUFlLEVBQUUsV0FBVyxPQUFPLENBQUMsQ0FBQyxJQUNyQztBQUFBLE1BQ0osQ0FBQztBQUNIO0FBQUEsSUFDRjtBQUNBLFVBQU0sVUFBVSx3QkFBd0I7QUFDeEMsVUFBTSxXQUFXLGdCQUFnQixLQUFLLEVBQUUsWUFBWTtBQUNwRCxVQUFNLE9BQU8sUUFBUSxPQUFPLENBQUMsTUFBTTtBQUNqQyxVQUFJLHVCQUF1QixTQUFTLEVBQUUsWUFBWSxtQkFBb0IsUUFBTztBQUM3RSxVQUFJLHFCQUFxQixFQUFFLGVBQWUsRUFBRyxRQUFPO0FBQ3BELFVBQUksVUFBVTtBQUNaLGNBQU0sTUFDSixFQUFFLElBQUksWUFBWSxFQUFFLFNBQVMsUUFBUSxLQUFLLEVBQUUsWUFBWSxZQUFZLEVBQUUsU0FBUyxRQUFRO0FBQ3pGLFlBQUksQ0FBQyxJQUFLLFFBQU87QUFBQSxNQUNuQjtBQUNBLGFBQU87QUFBQSxJQUNULENBQUM7QUFDRCxVQUFNLFlBQVksUUFBUSxPQUFPLENBQUMsR0FBRyxNQUFNLElBQUksRUFBRSxhQUFhLENBQUM7QUFDL0QsVUFBTSxlQUFlLFFBQVEsT0FBTyxDQUFDLE1BQU0sRUFBRSxjQUFjLENBQUMsRUFBRTtBQUU5RCxVQUFNLFFBQVEsb0JBQW9CLGtCQUFrQixPQUFPO0FBQzNELFVBQU0sV0FDSixRQUFRLElBQ0osa09BQ0EsUUFBUSxLQUFLLElBQ2IsNkJBQ0E7QUFFTixVQUFNLFNBQ0oseVhBR0Esc0JBQ0EsZ0lBRUEsUUFBUSxZQUFZLElBQ3BCLDZJQUVBLFFBQVEsU0FBUyxJQUNqQixvQkFDQSxXQUNBO0FBRUYsVUFBTSxVQUNKLDROQUVBLGVBQWUsZUFBZSxJQUM5QixxYkFHQyx1QkFBdUIsUUFBUSxjQUFjLE1BQzlDLHNEQUVDLHVCQUF1QixTQUFTLGNBQWMsTUFDL0MseURBRUMsdUJBQXVCLFVBQVUsY0FBYyxNQUNoRCxnTUFJQyxvQkFBb0IsYUFBYSxNQUNsQztBQUtGLFVBQU0sV0FBVyxLQUNkLElBQUksQ0FBQyxNQUFNO0FBQ1YsWUFBTSxXQUFXLEVBQUUsVUFBVSxJQUFJLFlBQVksRUFBRSxVQUFVLEtBQUssWUFBWTtBQUMxRSxZQUFNLFdBQVcsRUFBRSxjQUFjLElBQUksWUFBWTtBQUNqRCxhQUNFLDZMQUVDLEVBQUUsWUFBWSxTQUFTLFlBQVksYUFDcEMsa0RBQ0MsRUFBRSxZQUFZLFNBQVMsUUFBUSxVQUNoQyw4SUFFQSxlQUFlLEVBQUUsR0FBRyxJQUNwQixrS0FFQSxlQUFlLEVBQUUsV0FBVyxJQUM1QixPQUNBLGVBQWUsRUFBRSxXQUFXLElBQzVCLG9IQUVBLFFBQVEsRUFBRSxVQUFVLElBQ3BCLGtIQUVBLFFBQVEsRUFBRSxVQUFVLElBQ3BCLHdHQUVBLFFBQVEsRUFBRSxTQUFTLElBQ25CLHNIQUVBLFFBQVEsRUFBRSxZQUFZLElBQ3RCLHdEQUVBLG1CQUFtQixDQUFDLElBQ3BCLHNIQUVBLFFBQVEsRUFBRSxlQUFlLElBQ3pCLG9JQUVBLFFBQVEsRUFBRSxZQUFZLElBQ3RCLCtHQUVBLFdBQ0EsT0FDQSxjQUFjLEVBQUUsT0FBTyxJQUN2QixpSUFFQSxRQUFRLEVBQUUsR0FBRyxJQUNiLHlJQUVBLFdBQ0EsZ0VBQ0EsUUFBUSxFQUFFLFdBQVcsSUFDckIsZ0dBR0EsZUFBZSxFQUFFLEdBQUcsSUFDcEIsU0FDQSxlQUFlLEVBQUUsWUFBWSxRQUFRLE1BQU0sRUFBRSxDQUFDLElBQzlDO0FBQUEsSUFJSixDQUFDLEVBQ0EsS0FBSyxFQUFFO0FBS1YsVUFBTSxRQUNKLDIzREFrQkMsS0FBSyxTQUNGLFdBQ0EsMklBQ0o7QUFFRixVQUFNLFNBQ0osa0ZBRUEsUUFBUSxLQUFLLE1BQU0sSUFDbkIsU0FDQSxRQUFRLFFBQVEsTUFBTSxJQUN0QjtBQUlGLFNBQUssWUFDSCx5Q0FBeUMsU0FBUyxVQUFVLFFBQVEsU0FBUztBQUFBLEVBQ2pGO0FBRUEsU0FBTyxxQkFBcUIsU0FBVSxJQUFJO0FBQ3hDLHNCQUFrQixHQUFHLE9BQU8sU0FBUztBQUNyQyx1QkFBbUI7QUFFbkIsZUFBVyxNQUFNO0FBQ2YsWUFBTSxNQUFNLFNBQVMsZUFBZSxhQUFhO0FBQ2pELFVBQUksS0FBSztBQUNQLFlBQUksTUFBTTtBQUNWLFlBQUksa0JBQWtCLElBQUksTUFBTSxRQUFRLElBQUksTUFBTSxNQUFNO0FBQUEsTUFDMUQ7QUFBQSxJQUNGLEdBQUcsQ0FBQztBQUFBLEVBQ047QUFFQSxTQUFPLHNCQUFzQixTQUFVLElBQUk7QUFDekMseUJBQXFCLEdBQUcsT0FBTyxTQUFTO0FBQ3hDLHVCQUFtQjtBQUFBLEVBQ3JCO0FBRUEsU0FBTyx3QkFBd0IsU0FBVSxJQUFJO0FBQzNDLHdCQUFvQixDQUFDLENBQUMsR0FBRyxPQUFPO0FBQ2hDLHVCQUFtQjtBQUFBLEVBQ3JCO0FBRUEsU0FBTyxrQkFBa0IsV0FBWTtBQUNuQyxRQUFJLE9BQU8sU0FBUyxhQUFhO0FBQy9CLFlBQU0sMkJBQTJCO0FBQ2pDO0FBQUEsSUFDRjtBQUNBLFVBQU0sT0FBTyx3QkFBd0I7QUFDckMsVUFBTSxNQUFNO0FBQUEsTUFDVjtBQUFBLFFBQ0U7QUFBQSxRQUNBO0FBQUEsUUFDQTtBQUFBLFFBQ0E7QUFBQSxRQUNBO0FBQUEsUUFDQTtBQUFBLFFBQ0E7QUFBQSxRQUNBO0FBQUEsUUFDQTtBQUFBLFFBQ0E7QUFBQSxRQUNBO0FBQUEsUUFDQTtBQUFBLFFBQ0E7QUFBQSxRQUNBO0FBQUEsTUFDRjtBQUFBLElBQ0Y7QUFDQSxlQUFXLEtBQUssTUFBTTtBQUNwQixVQUFJLEtBQUs7QUFBQSxRQUNQLEVBQUUsWUFBWSxTQUFTLG9CQUFpQjtBQUFBLFFBQ3hDLEVBQUU7QUFBQSxRQUNGLEVBQUU7QUFBQSxRQUNGLEVBQUU7QUFBQSxRQUNGLEVBQUU7QUFBQSxRQUNGLEVBQUU7QUFBQSxRQUNGLEVBQUU7QUFBQSxRQUNGLEVBQUU7QUFBQSxRQUNGLEVBQUUsY0FBYztBQUFBLFFBQ2hCLEVBQUU7QUFBQSxRQUNGLEVBQUU7QUFBQSxRQUNGLEVBQUU7QUFBQSxRQUNGLEVBQUU7QUFBQSxRQUNGLEVBQUU7QUFBQSxNQUNKLENBQUM7QUFBQSxJQUNIO0FBQ0EsVUFBTSxLQUFLLEtBQUssTUFBTSxhQUFhLEdBQUc7QUFDdEMsT0FBRyxPQUFPLElBQUk7QUFBQSxNQUNaLEVBQUUsS0FBSyxHQUFHO0FBQUE7QUFBQSxNQUNWLEVBQUUsS0FBSyxHQUFHO0FBQUE7QUFBQSxNQUNWLEVBQUUsS0FBSyxHQUFHO0FBQUE7QUFBQSxNQUNWLEVBQUUsS0FBSyxFQUFFO0FBQUE7QUFBQSxNQUNULEVBQUUsS0FBSyxHQUFHO0FBQUE7QUFBQSxNQUNWLEVBQUUsS0FBSyxHQUFHO0FBQUE7QUFBQSxNQUNWLEVBQUUsS0FBSyxHQUFHO0FBQUE7QUFBQSxNQUNWLEVBQUUsS0FBSyxHQUFHO0FBQUE7QUFBQSxNQUNWLEVBQUUsS0FBSyxHQUFHO0FBQUE7QUFBQSxNQUNWLEVBQUUsS0FBSyxHQUFHO0FBQUE7QUFBQSxNQUNWLEVBQUUsS0FBSyxHQUFHO0FBQUE7QUFBQSxNQUNWLEVBQUUsS0FBSyxHQUFHO0FBQUE7QUFBQSxNQUNWLEVBQUUsS0FBSyxFQUFFO0FBQUE7QUFBQSxNQUNULEVBQUUsS0FBSyxHQUFHO0FBQUE7QUFBQSxJQUNaO0FBQ0EsVUFBTSxLQUFLLEtBQUssTUFBTSxTQUFTO0FBQy9CLFNBQUssTUFBTSxrQkFBa0IsSUFBSSxJQUFJLGtCQUFlO0FBQ3BELFVBQU0sTUFBTSxvQkFBSSxLQUFLO0FBQ3JCLFVBQU0sUUFDSixJQUFJLFlBQVksSUFDaEIsTUFDQSxPQUFPLElBQUksU0FBUyxJQUFJLENBQUMsRUFBRSxTQUFTLEdBQUcsR0FBRyxJQUMxQyxNQUNBLE9BQU8sSUFBSSxRQUFRLENBQUMsRUFBRSxTQUFTLEdBQUcsR0FBRztBQUN2QyxTQUFLLFVBQVUsSUFBSSwwQkFBMEIsUUFBUSxPQUFPO0FBQUEsRUFDOUQ7QUFHQSxTQUFPLGlCQUFpQixlQUFnQixLQUFLLGFBQWE7QUFDeEQsUUFBSSxDQUFDLGtCQUFtQixxQkFBb0Isb0JBQUksSUFBSTtBQUNwRCxVQUFNLFFBQVEsT0FBTyxHQUFHLEVBQUUsS0FBSyxFQUFFLFlBQVk7QUFDN0MsVUFBTSxRQUFRLGNBQWMsTUFBTSxhQUFRLFlBQVksTUFBTSxHQUFHLEVBQUUsSUFBSTtBQUNyRSxRQUNFLENBQUM7QUFBQSxNQUNDLGtCQUNFLFFBQ0E7QUFBQSxJQUNKLEdBQ0E7QUFDQTtBQUFBLElBQ0Y7QUFDQSxzQkFBa0IsSUFBSSxLQUFLO0FBQzNCLFFBQUk7QUFDRixZQUFNLHNCQUFzQjtBQUM1Qix5QkFBbUI7QUFBQSxJQUNyQixTQUFTLEdBQUc7QUFDVix3QkFBa0IsT0FBTyxLQUFLO0FBQzlCLFlBQU0sdUJBQXVCLEVBQUUsV0FBVyxFQUFFO0FBQUEsSUFDOUM7QUFBQSxFQUNGO0FBRUEsU0FBTyxnQkFBZ0IsZUFBZ0IsS0FBSztBQUMxQyxRQUFJLENBQUMsa0JBQW1CO0FBQ3hCLFVBQU0sUUFBUSxPQUFPLEdBQUcsRUFBRSxLQUFLLEVBQUUsWUFBWTtBQUM3QyxzQkFBa0IsT0FBTyxLQUFLO0FBQzlCLFFBQUk7QUFDRixZQUFNLHNCQUFzQjtBQUM1QiwrQkFBeUI7QUFDekIseUJBQW1CO0FBQUEsSUFDckIsU0FBUyxHQUFHO0FBQ1Ysd0JBQWtCLElBQUksS0FBSztBQUMzQixZQUFNLHVCQUF1QixFQUFFLFdBQVcsRUFBRTtBQUFBLElBQzlDO0FBQUEsRUFDRjtBQUVBLFNBQU8sd0JBQXdCLFdBQVk7QUFDekMsVUFBTSxXQUFXLFNBQVMsZUFBZSx5QkFBeUI7QUFDbEUsUUFBSSxTQUFVLFVBQVMsT0FBTztBQUM5QixVQUFNLEtBQUssU0FBUyxjQUFjLEtBQUs7QUFDdkMsT0FBRyxLQUFLO0FBQ1IsT0FBRyxNQUFNLFVBQ1A7QUFDRixPQUFHLFVBQVUsQ0FBQyxPQUFPO0FBQ25CLFVBQUksR0FBRyxXQUFXLEdBQUksSUFBRyxPQUFPO0FBQUEsSUFDbEM7QUFDQSxPQUFHLFlBQ0Q7QUFDRixhQUFTLEtBQUssWUFBWSxFQUFFO0FBQzVCLDZCQUF5QjtBQUFBLEVBQzNCO0FBRUEsV0FBUywyQkFBMkI7QUFDbEMsVUFBTSxPQUFPLFNBQVMsZUFBZSw0QkFBNEI7QUFDakUsUUFBSSxDQUFDLEtBQU07QUFDWCxVQUFNLE9BQU8sb0JBQW9CLE1BQU0sS0FBSyxpQkFBaUIsRUFBRSxLQUFLLElBQUksQ0FBQztBQUV6RSxVQUFNLFlBQVksQ0FBQztBQUNuQixlQUFXLE9BQU8sQ0FBQyxRQUFRLE9BQU8sR0FBRztBQUNuQyxZQUFNLFFBQVEsaUJBQWlCLEdBQUc7QUFDbEMsVUFBSSxTQUFTLE1BQU0sTUFBTTtBQUN2QixtQkFBVyxLQUFLLE1BQU0sTUFBTTtBQUMxQixvQkFBVSxPQUFPLEVBQUUsR0FBRyxFQUFFLEtBQUssRUFBRSxZQUFZLENBQUMsSUFBSSxFQUFFLGVBQWU7QUFBQSxRQUNuRTtBQUFBLE1BQ0Y7QUFBQSxJQUNGO0FBQ0EsVUFBTSxPQUNKLDBRQUdBLEtBQUssU0FDTDtBQUlGLFVBQU0sT0FDSixLQUFLLFdBQVcsSUFDWiw2TkFDQSw2REFDQSxLQUNHLElBQUksQ0FBQyxRQUFRO0FBQ1osWUFBTSxPQUFPLFVBQVUsR0FBRyxLQUFLO0FBQy9CLGFBQ0UsK05BRUEsZUFBZSxHQUFHLElBQ2xCLFlBQ0MsT0FDRyx3RUFDQSxlQUFlLElBQUksSUFDbkIsV0FDQSxNQUNKLDJDQUVBLGVBQWUsR0FBRyxJQUNsQjtBQUFBLElBR0osQ0FBQyxFQUNBLEtBQUssRUFBRSxJQUNWO0FBQ04sU0FBSyxZQUFZLE9BQU87QUFBQSxFQUMxQjsiLAogICJuYW1lcyI6IFtdCn0K
