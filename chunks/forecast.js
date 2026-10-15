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
    const tabSalesPlans = '<div id="forecast-tab-sales-plans" style="flex:1;overflow:auto;padding:0;background:#fbfbfd"></div>';
    const tabStat = '<div id="forecast-tab-stat" style="display:none"></div>';
    return modalOuter + header + tabSalesPlans + tabStat + "</div>";
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL3B1cmUvc2FsZXMtcGxhbi1wYXJzZXIuanMiLCAiLi4vc3JjL2RvbWFpbnMvZm9yZWNhc3QuanMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbIi8vIEB0cy1ub2NoZWNrXG4vLyBQdXJlOiBwYXJzZWEgdW4gc2hlZXQgU2FsZXMgUGxhbiAoZm9ybWF0byBTVVIvU0FSIGRlIFNoaW1hbm8pIGEgZXN0cnVjdHVyYVxuLy8gbm9ybWFsaXphZGEgeyBza3UsIGRlc2NyaXB0aW9uLCBtb3EsIG1vbnRoczogeydZWVlZLU1NJzogTn0gfS5cbi8vIFNpbiBkZXBlbmRlbmNpYXMgXHUyMDE0IHJlY2liZSBlbCBzaGVldCB5YSBkZXNlcmlhbGl6YWRvIHBvciBTaGVldEpTXG4vLyAoWExTWC51dGlscy5zaGVldF90b19qc29uKHNoZWV0LCB7aGVhZGVyOjEsIGRlZnZhbDonJ30pKS5cbi8vIFRlc3RlYWJsZSBlbiB2aXRlc3Qgc2luIGNhcmdhciBYTFNYLlxuLy9cbi8vIENvbnRleHRvOiBsb3MgU2FsZXMgUGxhbnMgZGUgU2hpbWFubyB2aWVuZW4gY29uIGhlYWRlcnMgY29tb1xuLy8gXCJTS1UgQ29kZS9QYXJ0IE5vXCIsIFwiRGVzY3JpcHRpb25cIiwgXCJNT1EgMTIgbW9udGhzXCIgeSBjb2x1bW5hcyBkZSBtZXNlc1xuLy8gdGlwbyBcIkphbiAyMDI3XCIsIFwiTWF5IDIwMjdcIiAoYSB2ZWNlcyBjb24gYVx1MDBGMW8gZW4gdW5hIGZpbGEgYXJyaWJhIHkgZWwgbWVzXG4vLyBlbiBsYSBmaWxhIGhlYWRlcikuIEVzdGEgZm4gdG9sZXJhIGFtYm9zIGxheW91dHMuXG5cbmNvbnN0IE1PTlRIX0FMSUFTRVMgPSB7XG4gIGphbjogMSxcbiAgamFudWFyeTogMSxcbiAgZW5lOiAxLFxuICBlbmVybzogMSxcbiAgZmViOiAyLFxuICBmZWJydWFyeTogMixcbiAgZmVicmVybzogMixcbiAgbWFyOiAzLFxuICBtYXJjaDogMyxcbiAgbWFyem86IDMsXG4gIGFwcjogNCxcbiAgYXByaWw6IDQsXG4gIGFicjogNCxcbiAgYWJyaWw6IDQsXG4gIG1heTogNSxcbiAgbWF5bzogNSxcbiAganVuOiA2LFxuICBqdW5lOiA2LFxuICBqdW5pbzogNixcbiAganVsOiA3LFxuICBqdWx5OiA3LFxuICBqdWxpbzogNyxcbiAgYXVnOiA4LFxuICBhdWd1c3Q6IDgsXG4gIGFnbzogOCxcbiAgYWdvc3RvOiA4LFxuICBzZXA6IDksXG4gIHNlcHQ6IDksXG4gIHNlcHRlbWJlcjogOSxcbiAgc2VwdGllbWJyZTogOSxcbiAgb2N0OiAxMCxcbiAgb2N0b2JlcjogMTAsXG4gIG9jdHVicmU6IDEwLFxuICBub3Y6IDExLFxuICBub3ZlbWJlcjogMTEsXG4gIG5vdmllbWJyZTogMTEsXG4gIGRlYzogMTIsXG4gIGRlY2VtYmVyOiAxMixcbiAgZGljOiAxMixcbiAgZGljaWVtYnJlOiAxMixcbn07XG5cbi8vIE5vcm1hbGl6YSBsYWJlbHMgZGUgbWVzZXMgYSAnWVlZWS1NTScuIFJldG9ybmEgbnVsbCBzaSBubyBtYXRjaGVhLlxuLy8gRm9ybWF0b3Mgc29wb3J0YWRvczogXCJKYW4gMjAyN1wiLCBcIkVuZS0yN1wiLCBcIkphbi8yMDI3XCIsIFwiTWF5MjdcIixcbi8vIFwiMjAyNy0wMVwiLCBcIjAxLzIwMjdcIiwgXCJKYW4uMjAyN1wiLCBcIjIwMjFcXG5KYW5cIiAobXVsdGktbGluZSBFeGNlbCkuXG5mdW5jdGlvbiBub3JtYWxpemVNb250aExhYmVsKGxhYmVsKSB7XG4gIGlmIChsYWJlbCA9PSBudWxsKSByZXR1cm4gbnVsbDtcbiAgLy8gdjExMDQ6IGNvbGFwc2FyIG5ld2xpbmVzL3RhYnMgYSBlc3BhY2lvIGFudGVzIGRlbCB0cmltLlxuICAvLyBFbCBmb3JtYXRvIEV4Y2VsIFwiMjAyMVxcbkphblwiIChhXHUwMEYxbyBlbiBMMSwgbWVzIGVuIEwyIGRlbnRybyBkZSB1bmEgY2VsZGFcbiAgLy8gbXVsdGktcm93KSBlcyBjb21cdTAwRkFuIGVuIFNhbGVzIFBsYW5zIFNVUi4gYFxccytgIG1hdGNoZWEgd2hpdGVzcGFjZSBpbmNsdXllbmRvXG4gIC8vIFxcbiB5IFxcclxcbi5cbiAgY29uc3QgcyA9IFN0cmluZyhsYWJlbCkucmVwbGFjZSgvXFxzKy9nLCAnICcpLnRyaW0oKS50b0xvd2VyQ2FzZSgpO1xuICBpZiAoIXMpIHJldHVybiBudWxsO1xuICBsZXQgbTtcbiAgLy8gXCJqYW4gMjAyN1wiIHwgXCJqYW4tMjdcIiB8IFwiZW5lLzIwMjdcIiB8IFwibWF5MjdcIiB8IFwibWF5LjIwMjdcIlxuICBtID0gcy5tYXRjaCgvXihbYS16XHUwMEUxXHUwMEU5XHUwMEVEXHUwMEYzXHUwMEZBXXszLDEwfSlbXFxzXFwtLy5fXSooXFxkezIsNH0pJC8pO1xuICBpZiAobSkge1xuICAgIGNvbnN0IG1vbiA9IE1PTlRIX0FMSUFTRVNbbVsxXV0gfHwgTU9OVEhfQUxJQVNFU1ttWzFdLnNsaWNlKDAsIDMpXTtcbiAgICBpZiAobW9uKSB7XG4gICAgICBsZXQgeSA9IHBhcnNlSW50KG1bMl0sIDEwKTtcbiAgICAgIGlmICh5IDwgMTAwKSB5ID0gMjAwMCArIHk7XG4gICAgICByZXR1cm4gU3RyaW5nKHkpLnBhZFN0YXJ0KDQsICcwJykgKyAnLScgKyBTdHJpbmcobW9uKS5wYWRTdGFydCgyLCAnMCcpO1xuICAgIH1cbiAgfVxuICAvLyBcIjIwMjEgamFuXCIgfCBcIjIwMjcgZGljXCIgKGFcdTAwRjFvIHByaW1lcm8gKyBtZXMsIGZvcm1hdG8gRXhjZWwgbXVsdGktbGluZVxuICAvLyBjb2xhcHNhZG8gdHJhcyByZXBsYWNlIFxccyspLlxuICBtID0gcy5tYXRjaCgvXihcXGR7NH0pW1xcc1xcLS8uX10rKFthLXpcdTAwRTFcdTAwRTlcdTAwRURcdTAwRjNcdTAwRkFdezMsMTB9KSQvKTtcbiAgaWYgKG0pIHtcbiAgICBjb25zdCB5ID0gcGFyc2VJbnQobVsxXSwgMTApO1xuICAgIGNvbnN0IG1vbiA9IE1PTlRIX0FMSUFTRVNbbVsyXV0gfHwgTU9OVEhfQUxJQVNFU1ttWzJdLnNsaWNlKDAsIDMpXTtcbiAgICBpZiAobW9uKSByZXR1cm4gU3RyaW5nKHkpLnBhZFN0YXJ0KDQsICcwJykgKyAnLScgKyBTdHJpbmcobW9uKS5wYWRTdGFydCgyLCAnMCcpO1xuICB9XG4gIC8vIFwiMjAyNy0wMVwiIHwgXCIyMDI3LzAxXCJcbiAgbSA9IHMubWF0Y2goL14oXFxkezR9KVstL10oXFxkezEsMn0pJC8pO1xuICBpZiAobSkge1xuICAgIGNvbnN0IHkgPSBwYXJzZUludChtWzFdLCAxMCk7XG4gICAgY29uc3QgbW9uID0gcGFyc2VJbnQobVsyXSwgMTApO1xuICAgIGlmIChtb24gPj0gMSAmJiBtb24gPD0gMTIpXG4gICAgICByZXR1cm4gU3RyaW5nKHkpLnBhZFN0YXJ0KDQsICcwJykgKyAnLScgKyBTdHJpbmcobW9uKS5wYWRTdGFydCgyLCAnMCcpO1xuICB9XG4gIC8vIFwiMDEvMjAyN1wiIHwgXCIwMS0yMDI3XCJcbiAgbSA9IHMubWF0Y2goL14oXFxkezEsMn0pWy0vXShcXGR7NH0pJC8pO1xuICBpZiAobSkge1xuICAgIGNvbnN0IG1vbiA9IHBhcnNlSW50KG1bMV0sIDEwKTtcbiAgICBjb25zdCB5ID0gcGFyc2VJbnQobVsyXSwgMTApO1xuICAgIGlmIChtb24gPj0gMSAmJiBtb24gPD0gMTIpXG4gICAgICByZXR1cm4gU3RyaW5nKHkpLnBhZFN0YXJ0KDQsICcwJykgKyAnLScgKyBTdHJpbmcobW9uKS5wYWRTdGFydCgyLCAnMCcpO1xuICB9XG4gIHJldHVybiBudWxsO1xufVxuXG4vLyBCdXNjYSBsYSBmaWxhIGhlYWRlciAoMC1iYXNlZCkuIEVzY2FuZWEgbGFzIHByaW1lcmFzIDMwIGZpbGFzLlxuZnVuY3Rpb24gZmluZEhlYWRlclJvdyhyb3dzKSB7XG4gIGNvbnN0IEhFQURFUl9NQVJLRVJTID0gW1xuICAgICdza3UgY29kZS9wYXJ0IG5vJyxcbiAgICAnc2t1IGNvZGUnLFxuICAgICdza3UnLFxuICAgICdwYXJ0IG5vJyxcbiAgICAncGFydCBudW1iZXInLFxuICAgICdpdGVtY29kZScsXG4gICAgJ2l0ZW0gY29kZScsXG4gICAgJ2NvZGlnbycsXG4gICAgJ2NcdTAwRjNkaWdvJyxcbiAgXTtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBNYXRoLm1pbihyb3dzLmxlbmd0aCwgMzApOyBpKyspIHtcbiAgICBjb25zdCByb3cgPSByb3dzW2ldIHx8IFtdO1xuICAgIGZvciAoY29uc3QgY2VsbCBvZiByb3cpIHtcbiAgICAgIC8vIHYxMTA0OiBjb2xhcHNhciBuZXdsaW5lcyBhIGVzcGFjaW8gcGFyYSBtYXRjaGVhciBoZWFkZXJzIGNvbW9cbiAgICAgIC8vIFwiU0tVIENvZGUvUGFydCBOb1wiIChvaykgbyBcIlNLVVxcbkNvZGVcIiAobmVjZXNpdGEgY29sYXBzYXIpLlxuICAgICAgY29uc3QgcyA9IFN0cmluZyhjZWxsID09IG51bGwgPyAnJyA6IGNlbGwpXG4gICAgICAgIC5yZXBsYWNlKC9cXHMrL2csICcgJylcbiAgICAgICAgLnRyaW0oKVxuICAgICAgICAudG9Mb3dlckNhc2UoKTtcbiAgICAgIGlmIChIRUFERVJfTUFSS0VSUy5pbmRleE9mKHMpID49IDApIHJldHVybiBpO1xuICAgIH1cbiAgfVxuICByZXR1cm4gLTE7XG59XG5cbi8vIERldGVjdGEgXHUwMEVEbmRpY2VzIGRlIGNvbHVtbmFzIHkgbWVzZXMuIGBoaW50Um93QWJvdmVgIHBlcm1pdGUgY29tYmluYXIgYVx1MDBGMW8vbWVzXG4vLyBjdWFuZG8gZWwgaGVhZGVyIGVzIG11bHRpLXJvdyAoYVx1MDBGMW8gYXJyaWJhLCBtZXMgYWJham8gbyB2aWNldmVyc2EpLlxuZnVuY3Rpb24gZGV0ZWN0Q29sdW1ucyhoZWFkZXJSb3csIGhpbnRSb3dBYm92ZSkge1xuICBsZXQgc2t1SWR4ID0gLTE7XG4gIGxldCBkZXNjSWR4ID0gLTE7XG4gIGxldCBtb3FJZHggPSAtMTtcbiAgY29uc3QgbW9udGhDb2x1bW5zID0gW107XG4gIGNvbnN0IGRldGVjdGVkTW9udGhzU2V0ID0gbmV3IFNldCgpO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IGhlYWRlclJvdy5sZW5ndGg7IGkrKykge1xuICAgIC8vIHYxMTA0OiBjb2xhcHNhciBuZXdsaW5lcyBhIGVzcGFjaW8gYW50ZXMgZGUgY29tcGFyYXIuIExvcyBTYWxlcyBQbGFuXG4gICAgLy8gU1VSIHRpZW5lbiBoZWFkZXJzIG11bHRpLWxpbmUgY29tbyBcIk1PUVxcbjEyIG1vbnRoc1wiIG8gXCJCYXNlXFxuRk9CKFVTRClcIi5cbiAgICBjb25zdCByYXcgPSBTdHJpbmcoaGVhZGVyUm93W2ldID09IG51bGwgPyAnJyA6IGhlYWRlclJvd1tpXSlcbiAgICAgIC5yZXBsYWNlKC9cXHMrL2csICcgJylcbiAgICAgIC50cmltKCk7XG4gICAgY29uc3QgcyA9IHJhdy50b0xvd2VyQ2FzZSgpO1xuICAgIGlmIChcbiAgICAgIHNrdUlkeCA8IDAgJiZcbiAgICAgIChzID09PSAnc2t1IGNvZGUvcGFydCBubycgfHxcbiAgICAgICAgcyA9PT0gJ3NrdSBjb2RlJyB8fFxuICAgICAgICBzID09PSAnc2t1JyB8fFxuICAgICAgICBzID09PSAncGFydCBubycgfHxcbiAgICAgICAgcyA9PT0gJ3BhcnQgbnVtYmVyJyB8fFxuICAgICAgICBzID09PSAnaXRlbWNvZGUnIHx8XG4gICAgICAgIHMgPT09ICdpdGVtIGNvZGUnIHx8XG4gICAgICAgIHMgPT09ICdjb2RpZ28nIHx8XG4gICAgICAgIHMgPT09ICdjXHUwMEYzZGlnbycpXG4gICAgKSB7XG4gICAgICBza3VJZHggPSBpO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChcbiAgICAgIGRlc2NJZHggPCAwICYmXG4gICAgICAocyA9PT0gJ2Rlc2NyaXB0aW9uJyB8fFxuICAgICAgICBzID09PSAnZGVzY3JpcGNpb24nIHx8XG4gICAgICAgIHMgPT09ICdkZXNjcmlwY2lcdTAwRjNuJyB8fFxuICAgICAgICBzID09PSAnaXRlbSBuYW1lJyB8fFxuICAgICAgICBzID09PSAnaXRlbW5hbWUnKVxuICAgICkge1xuICAgICAgZGVzY0lkeCA9IGk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKG1vcUlkeCA8IDAgJiYgKHMgPT09ICdtb3EgMTIgbW9udGhzJyB8fCBzID09PSAnbW9xJyB8fCBzLmluZGV4T2YoJ21vcScpID09PSAwKSkge1xuICAgICAgbW9xSWR4ID0gaTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICAvLyBUcnkgZGlyZWN0IG1vbnRoIHBhcnNlXG4gICAgbGV0IG1vbnRoS2V5ID0gbm9ybWFsaXplTW9udGhMYWJlbChyYXcpO1xuICAgIGlmICghbW9udGhLZXkgJiYgaGludFJvd0Fib3ZlICYmIGhpbnRSb3dBYm92ZVtpXSAhPSBudWxsKSB7XG4gICAgICBjb25zdCBoaW50ID0gU3RyaW5nKGhpbnRSb3dBYm92ZVtpXSkudHJpbSgpO1xuICAgICAgaWYgKGhpbnQpIHtcbiAgICAgICAgbW9udGhLZXkgPSBub3JtYWxpemVNb250aExhYmVsKHJhdyArICcgJyArIGhpbnQpIHx8IG5vcm1hbGl6ZU1vbnRoTGFiZWwoaGludCArICcgJyArIHJhdyk7XG4gICAgICB9XG4gICAgfVxuICAgIGlmIChtb250aEtleSkge1xuICAgICAgbW9udGhDb2x1bW5zLnB1c2goeyBjb2xJZHg6IGksIG1vbnRoS2V5IH0pO1xuICAgICAgZGV0ZWN0ZWRNb250aHNTZXQuYWRkKG1vbnRoS2V5KTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHtcbiAgICBza3VJZHgsXG4gICAgZGVzY0lkeCxcbiAgICBtb3FJZHgsXG4gICAgbW9udGhDb2x1bW5zLFxuICAgIGRldGVjdGVkTW9udGhzOiBBcnJheS5mcm9tKGRldGVjdGVkTW9udGhzU2V0KS5zb3J0KCksXG4gIH07XG59XG5cbi8vIFB1YmxpYzogcGFyc2UgZnVsbCBzaGVldC4gVGhyb3dzIG9uIG1pc3NpbmcgU0tVIGNvbHVtbiAvIG1vbnRocy5cbmZ1bmN0aW9uIHBhcnNlU2FsZXNQbGFuU2hlZXQocm93cykge1xuICBpZiAoIXJvd3MgfHwgIXJvd3MubGVuZ3RoKSB7XG4gICAgY29uc3QgZXJyID0gbmV3IEVycm9yKCdFeGNlbCB2YWNpbycpO1xuICAgIGVyci5jb2RlID0gJ0VNUFRZX1NIRUVUJztcbiAgICB0aHJvdyBlcnI7XG4gIH1cbiAgY29uc3QgaGVhZGVySWR4ID0gZmluZEhlYWRlclJvdyhyb3dzKTtcbiAgaWYgKGhlYWRlcklkeCA8IDApIHtcbiAgICBjb25zdCBlcnIgPSBuZXcgRXJyb3IoJ05vIHNlIGVuY29udHJvIGZpbGEgZGUgaGVhZGVycyAoYnVzY2FiYSBcIlNLVSBDb2RlL1BhcnQgTm9cIiBvIFwiU0tVXCIpJyk7XG4gICAgZXJyLmNvZGUgPSAnSEVBREVSX05PVF9GT1VORCc7XG4gICAgdGhyb3cgZXJyO1xuICB9XG4gIGNvbnN0IGhlYWRlclJvdyA9IHJvd3NbaGVhZGVySWR4XSB8fCBbXTtcbiAgY29uc3Qgcm93QWJvdmUgPSBoZWFkZXJJZHggPiAwID8gcm93c1toZWFkZXJJZHggLSAxXSB8fCBbXSA6IG51bGw7XG4gIGNvbnN0IGNvbHMgPSBkZXRlY3RDb2x1bW5zKGhlYWRlclJvdywgcm93QWJvdmUpO1xuICBpZiAoY29scy5za3VJZHggPCAwKSB7XG4gICAgY29uc3QgZXJyID0gbmV3IEVycm9yKCdObyBzZSBlbmNvbnRybyBjb2x1bW5hIFNLVSBlbiBsYSBmaWxhIGhlYWRlcicpO1xuICAgIGVyci5jb2RlID0gJ1NLVV9DT0xfTUlTU0lORyc7XG4gICAgdGhyb3cgZXJyO1xuICB9XG4gIGlmICghY29scy5tb250aENvbHVtbnMubGVuZ3RoKSB7XG4gICAgY29uc3QgZXJyID0gbmV3IEVycm9yKFxuICAgICAgJ05vIHNlIGRldGVjdGFyb24gY29sdW1uYXMgZGUgbWVzZXMgZW4gZWwgaGVhZGVyIChlajogXCJKYW4gMjAyN1wiLCBcIk1heSAyMDI3XCIpJ1xuICAgICk7XG4gICAgZXJyLmNvZGUgPSAnTU9OVEhTX05PVF9GT1VORCc7XG4gICAgdGhyb3cgZXJyO1xuICB9XG4gIGNvbnN0IHBhcnNlZFJvd3MgPSBbXTtcbiAgY29uc3Qgc2VlblNrdSA9IG5ldyBTZXQoKTtcbiAgZm9yIChsZXQgciA9IGhlYWRlcklkeCArIDE7IHIgPCByb3dzLmxlbmd0aDsgcisrKSB7XG4gICAgY29uc3Qgcm93ID0gcm93c1tyXSB8fCBbXTtcbiAgICBjb25zdCBza3VSYXcgPSByb3dbY29scy5za3VJZHhdO1xuICAgIGlmIChza3VSYXcgPT0gbnVsbCB8fCBTdHJpbmcoc2t1UmF3KS50cmltKCkgPT09ICcnKSBjb250aW51ZTtcbiAgICBjb25zdCBza3UgPSBTdHJpbmcoc2t1UmF3KS50cmltKCk7XG4gICAgY29uc3QgdXBwZXIgPSBza3UudG9VcHBlckNhc2UoKTtcbiAgICAvLyBTa2lwIGZpbGFzIFRPVEFMIC8gU1VNIC8gU1VCVE9UQUxcbiAgICBpZiAodXBwZXIgPT09ICdUT1RBTCcgfHwgdXBwZXIgPT09ICdTVU0nIHx8IHVwcGVyID09PSAnU1VCVE9UQUwnIHx8IHVwcGVyID09PSAnVE9UQUxFUycpXG4gICAgICBjb250aW51ZTtcbiAgICBpZiAoc2VlblNrdS5oYXModXBwZXIpKSBjb250aW51ZTsgLy8gZGVkdXBlXG4gICAgc2VlblNrdS5hZGQodXBwZXIpO1xuICAgIGNvbnN0IGRlc2NyaXB0aW9uID1cbiAgICAgIGNvbHMuZGVzY0lkeCA+PSAwID8gU3RyaW5nKHJvd1tjb2xzLmRlc2NJZHhdID09IG51bGwgPyAnJyA6IHJvd1tjb2xzLmRlc2NJZHhdKS50cmltKCkgOiAnJztcbiAgICBjb25zdCBtb3FSYXcgPSBjb2xzLm1vcUlkeCA+PSAwID8gcm93W2NvbHMubW9xSWR4XSA6IG51bGw7XG4gICAgY29uc3QgbW9xTnVtID0gTnVtYmVyKG1vcVJhdyk7XG4gICAgY29uc3QgbW9xID0gTnVtYmVyLmlzRmluaXRlKG1vcU51bSkgJiYgbW9xTnVtID4gMCA/IE1hdGgucm91bmQobW9xTnVtKSA6IDA7XG4gICAgY29uc3QgbW9udGhzID0ge307XG4gICAgZm9yIChjb25zdCBtYyBvZiBjb2xzLm1vbnRoQ29sdW1ucykge1xuICAgICAgY29uc3QgdiA9IHJvd1ttYy5jb2xJZHhdO1xuICAgICAgY29uc3QgbiA9IE51bWJlcih2KTtcbiAgICAgIGlmIChOdW1iZXIuaXNGaW5pdGUobikgJiYgbiA+IDApIHtcbiAgICAgICAgbW9udGhzW21jLm1vbnRoS2V5XSA9IE1hdGgucm91bmQobik7XG4gICAgICB9XG4gICAgfVxuICAgIHBhcnNlZFJvd3MucHVzaCh7IHNrdSwgZGVzY3JpcHRpb24sIG1vcSwgbW9udGhzIH0pO1xuICB9XG4gIHJldHVybiB7XG4gICAgaGVhZGVyUm93SW5kZXg6IGhlYWRlcklkeCxcbiAgICBkZXRlY3RlZE1vbnRoczogY29scy5kZXRlY3RlZE1vbnRocyxcbiAgICByb3dzQ291bnQ6IHBhcnNlZFJvd3MubGVuZ3RoLFxuICAgIHJvd3M6IHBhcnNlZFJvd3MsXG4gIH07XG59XG5cbi8vIFVNRC1pc2ggZXhwb3J0OiBwYXJhIHZpdGVzdCAobW9kdWxlLmV4cG9ydHMpIHkgcGFyYSBidW5kbGUgYnJvd3NlciAod2luZG93IGdsb2JhbCkuXG5pZiAodHlwZW9mIG1vZHVsZSAhPT0gJ3VuZGVmaW5lZCcgJiYgbW9kdWxlLmV4cG9ydHMpIHtcbiAgbW9kdWxlLmV4cG9ydHMgPSB7IHBhcnNlU2FsZXNQbGFuU2hlZXQsIG5vcm1hbGl6ZU1vbnRoTGFiZWwsIGZpbmRIZWFkZXJSb3csIGRldGVjdENvbHVtbnMgfTtcbn1cbmlmICh0eXBlb2Ygd2luZG93ICE9PSAndW5kZWZpbmVkJykge1xuICB3aW5kb3cuU2FsZXNQbGFuUGFyc2VyID0ge1xuICAgIHBhcnNlU2FsZXNQbGFuU2hlZXQsXG4gICAgbm9ybWFsaXplTW9udGhMYWJlbCxcbiAgICBmaW5kSGVhZGVyUm93LFxuICAgIGRldGVjdENvbHVtbnMsXG4gIH07XG59XG5cbmV4cG9ydCB7IGRldGVjdENvbHVtbnMsIGZpbmRIZWFkZXJSb3csIG5vcm1hbGl6ZU1vbnRoTGFiZWwsIHBhcnNlU2FsZXNQbGFuU2hlZXQgfTtcbiIsICIvLyBAdHMtbm9jaGVja1xyXG4vLyB2MTA5OCsgRmFzZSAxOiBpbXBvcnQgZGVsIHBhcnNlciBwdXJvLiBFbCBtXHUwMEYzZHVsbyBoYWNlIGB3aW5kb3cuU2FsZXNQbGFuUGFyc2VyYFxyXG4vLyBjb21vIHNpZGUtZWZmZWN0IHkgdGFtYmlcdTAwRTluIGV4cG9ydGEgbGFzIGZucyBub21icmFkYXM7IHVzYW1vcyBzaWRlLWVmZmVjdFxyXG4vLyBwb3JxdWUgZm9yZWNhc3QuanMgY29ycmUgZW4gZWwgY2h1bmsgbGF6eSB5IHdpbmRvdyB5YSBlc3RcdTAwRTEgZGlzcG9uaWJsZS5cclxuaW1wb3J0ICcuLi9wdXJlL3NhbGVzLXBsYW4tcGFyc2VyLmpzJztcclxuXHJcbi8vIEdsb2JhbHMgbGVpZG9zIGRlbCBlbnRvcm5vIChkZWNsYXJhZG9zIGVuIGluZGV4Lmh0bWwgaW5saW5lIG8gYnVuZGxlIHByZXZpbyk6XHJcbi8vIGZiRGIsIGN1cnJlbnRVc2VyLCBYTFNYIChjZG4pLCBlc2NhcGVIdG1sLiBNaXNtbyBwYXRyb24gcXVlIG90cm9zIGRvbWluaW9zLlxyXG4vL1xyXG4vLyBGT1JFQ0FTVCAtIG1vZGFsIGFkbWluLW9ubHkgKE1hcmlhbm8pLiBDaHVuayBsYXp5OiBzZSBjYXJnYSBzb2xvIGFsIHByaW1lclxyXG4vLyBjbGljayBkZWwgYm90b24gRk9SRUNBU1QgZGVsIGhlYWRlci4gUmVnaXN0cmFkbyBlbiBidWlsZC5qcyBMQVpZX0NIVU5LUyArXHJcbi8vIHNyYy9tYWluLmpzIGluc3RhbGxDaHVua1N0dWJzICsgc3cuanMgU1RBVElDX0FTU0VUUy4gVmVyIENMQVVERS5tZCAjMTguXHJcbi8vXHJcbi8vIHYxMTExIGNsZWFuOiBwaXBlbGluZSBsZWdhY3kgKFNLVSArIDYgY29sdW1uYXMgKyBwb2xpdGljYSAzbSkgcmVtb3ZpZG8uXHJcbi8vIFJlZW1wbGF6YWRvIHBvcjpcclxuLy8gICAtIEZhc2UgMSAodjEwOTgpOiBTYWxlcyBQbGFucyBtZW5zdWFsZXMgUm9kcy9SZWVscyBjb24gZm9ybWF0byBTVVIuXHJcbi8vICAgLSBGYXNlIDJCICh2MTEwMyk6IEZvcmVjYXN0IEVzdGFkaXN0aWNvIChzdGF0c2ZvcmVjYXN0IHBpcGVsaW5lIG9mZmxpbmUpLlxyXG4vLyAgIC0gRmFzZSAzQSAodjExMDkpOiBUYWJsYSBSZWNvbWVuZGFjaW9uIGRlIENvbXByYS5cclxuXHJcbi8vIHYxMDk4KyAoRmFzZSAxIEZvcmVjYXN0IHYyKTogU2FsZXMgUGxhbnMgbWVuc3VhbGVzIHBvciBmYW1pbGlhIChSb2RzL1JlZWxzL0ZHKS5cclxuLy8gU2UgZ3VhcmRhbiBlbiBGaXJlc3RvcmUgYHNhbGVzX3BsYW5fY2FjaGUve2ZhbWlsaWF9YCArIHNuYXBzaG90IEV4Y2VsIG9yaWdpbmFsXHJcbi8vIGVuIFN0b3JhZ2UgYGZvcmVjYXN0c19zbmFwc2hvdHMve1lZWVktTU19L3tmYW1pbGlhfS54bHN4YC5cclxuLy8gRWwgcGFyc2VyIHB1cm8gdml2ZSBlbiBzcmMvcHVyZS9zYWxlcy1wbGFuLXBhcnNlci5qcyAoYXR0YWNoIGEgd2luZG93LlNhbGVzUGxhblBhcnNlcikuXHJcbi8vIHYxMTA4OiBGRyByZW1vdmlkbyBkZWwgVUkgKE1hcmlhbm8gcGlkaVx1MDBGMykuIFNvbG8gUm9kcyArIFJlZWxzIHBvciBhaG9yYS5cclxuLy8gTGEgcnVsZSBGaXJlc3RvcmUgc2lndWUgYWNlcHRhbmRvICdmZycgcG9yIHNpIGVuIGVsIGZ1dHVybyBzZSB2dWVsdmUgYVxyXG4vLyBhY3RpdmFyIFx1MjAxNCBubyBib3JyYXJsYSBlbiBzdG9yYWdlL2ZpcmVzdG9yZS5ydWxlcyBoYXN0YSBjb25maXJtYXIgZGVwcmVjYXRlLlxyXG5jb25zdCBTQUxFU19QTEFOX0ZBTUlMSUFTID0gW1xyXG4gIHsga2V5OiAncm9kcycsIGxhYmVsOiAnUm9kcyAoQ2FcdTAwRjFhcyknLCBjb2xvcjogJyMwZWE1ZTknIH0sXHJcbiAgeyBrZXk6ICdyZWVscycsIGxhYmVsOiAnUmVlbHMnLCBjb2xvcjogJyM4YjVjZjYnIH0sXHJcbl07XHJcbmNvbnN0IF9zYWxlc1BsYW5DYWNoZXMgPSB7IHJvZHM6IG51bGwsIHJlZWxzOiBudWxsIH07IC8vIGxhc3QgbG9hZGVkIGRvY1xyXG5sZXQgX2ZvcmVjYXN0QWN0aXZlVGFiID0gJ3NhbGVzLXBsYW5zJzsgLy8gJ3NhbGVzLXBsYW5zJyB8ICdzdGF0JyB8ICdsZWdhY3knXHJcblxyXG4vLyB2MTEwMysgKEZhc2UgMkIpOiBGb3JlY2FzdCBFc3RhZFx1MDBFRHN0aWNvIFx1MjAxNCBvdXRwdXQgcHVibGljYWRvIHBvclxyXG4vLyBzY3JpcHRzL2ZvcmVjYXN0L3B1Ymxpc2hfdG9fZmlyZXN0b3JlLnB5IGEgZm9yZWNhc3Rfb3V0cHV0L3tzdWJfc2x1Z31cclxuLy8gKyBmb3JlY2FzdF9vdXRwdXRfbWV0YS9jdXJyZW50LiAyNCBzdWJzICsgMSBtZXRhIGRvYy5cclxubGV0IF9mb3JlY2FzdFN0YXREb2NzID0gbnVsbDsgLy8gW3tpZCwgc3ViZmFtaWxpYSwgZm9yZWNhc3RbN10sIG1ldHJpY3MsIGJlc3RNb2RlbCwgdmVyc2lvbklkfV1cclxubGV0IF9mb3JlY2FzdFN0YXRNZXRhID0gbnVsbDsgLy8ge2dlbmVyYXRlZEF0LCB2ZXJzaW9uSWQsIHJlc3VtZW46IHsuLi59fVxyXG5sZXQgX2ZvcmVjYXN0U3RhdEhpc3RvcnlDYWNoZSA9IG51bGw7IC8vIHsgW3N1Yl06IFt7ZHMsIHl9XSB9IGNhY2hlIGxhenkgb24tZGVtYW5kXHJcblxyXG4vLyB2MTEwOSsgKEZhc2UgM0EpOiBUYWJsYSBSZWNvbWVuZGFjaVx1MDBGM24gZGUgQ29tcHJhIFx1MjAxNCBjb21iaW5hIHNhbGVzIHBsYW5zICtcclxuLy8gc3RvY2tfc25hcHNob3QgKyBza3VfdmVudGFzX3NuYXBzaG90IHBhcmEgY29tcHV0YXIgcmVjb21lbmRhZG8gcG9yIFNLVS5cclxubGV0IF9yZWNvU3RvY2tTbmFwc2hvdCA9IG51bGw7IC8vIHt3YXJlaG91c2VCcmVha2Rvd246IHtza3U6eycxMSc6biwnMTInOm4sLi4ufX0sIGJhY2tvcmRlckJ5U2t1OiB7c2t1Om59fVxyXG5sZXQgX3JlY29WZW50YXNTbmFwc2hvdCA9IG51bGw7IC8vIHsgW1NLVSB1cHBlcl06IHttZXNlczogeydZWVlZLU1NJzoge3F0eSxhcnN9fX0gfVxyXG5sZXQgX3JlY29GaWx0ZXJNaW5SZWMgPSB0cnVlOyAvLyBcInNvbG8gbW9zdHJhciBTS1VzIGNvbiByZWNvbWVuZGFkbyA+IDBcIlxyXG5sZXQgX3JlY29GaWx0ZXJGYW1pbGlhID0gJ2FsbCc7IC8vICdhbGwnIHwgJ3JvZHMnIHwgJ3JlZWxzJ1xyXG5sZXQgX3JlY29TZWFyY2hUZXh0ID0gJyc7XHJcblxyXG4vLyB2MTExMisgKEYzQik6IFNLVXMgZGVzY29udGludWFkb3MgcXVlIE1hcmlhbm8gbWFyY2EgcGFyYSBleGNsdWlyIGRlbCBmb3JlY2FzdC5cclxuLy8gUGVyc2lzdGVuIGVuIEZpcmVzdG9yZSBgZm9yZWNhc3RfY29uZmlnL2Rpc2NvbnRpbnVlZF9za3VzYCBjb21vIHsgc2t1czogW1NLVSB1cHBlcl0sIHVwZGF0ZWRBdCwgdXBkYXRlZEJ5IH0uXHJcbmxldCBfZGlzY29udGludWVkU2t1cyA9IG51bGw7IC8vIFNldDxzdHJpbmcgdXBwZXI+IG8gbnVsbCBzaSBubyBjYXJnYWRvXHJcbmxldCBfZGlzY29udGludWVkTWV0YSA9IG51bGw7IC8vIHt1cGRhdGVkQXQsIHVwZGF0ZWRCeX1cclxuXHJcbi8vIHYxMTE0KyAoRjNCIG11bHRpcGxpY2Fkb3IgZGluXHUwMEUxbWljbyk6IG11bHRpcGxpY2Fkb3IgYXV0byBwb3IgU0tVID0gdmVudGFfMm1cclxuLy8gZGl2aWRpZG8gcG9yIHZlbnRhXzZtLCBjb24gY2FwLiBPdmVycmlkZSBtYW51YWwgcGVyc2lzdGlkbyBlbiBGaXJlc3RvcmVcclxuLy8gYGZvcmVjYXN0X2NvbmZpZy9tdWx0aXBsaWVyc2AgY29uIHtza3VPdmVycmlkZXM6IHtTS1U6IHt2YWx1ZSwgdXBkYXRlZEJ5LCB1cGRhdGVkQXR9fX0uXHJcbmxldCBfbXVsdGlwbGllck92ZXJyaWRlcyA9IG51bGw7IC8vIHsgW1NLVSB1cHBlcl06IHt2YWx1ZSwgdXBkYXRlZEJ5LCB1cGRhdGVkQXR9IH1cclxuY29uc3QgUkVDT19NVUxUX1JFQ0VOVF9NT05USFMgPSAyO1xyXG5jb25zdCBSRUNPX01VTFRfQkFTRUxJTkVfTU9OVEhTID0gNjtcclxuY29uc3QgUkVDT19NVUxUX01JTiA9IDAuNTtcclxuY29uc3QgUkVDT19NVUxUX01BWCA9IDIuNTtcclxuY29uc3QgUkVDT19NVUxUX01JTl9CQVNFTElORSA9IDAuMTsgLy8gZXZpdGEgZGl2aXNpXHUwMEYzbiBwb3IgY2Vyb1xyXG5cclxuY29uc3QgUkVDT19IT1JJWk9OX01PTlRIUyA9IDc7XHJcbmNvbnN0IFJFQ09fVkVOVEFfUFJPTUVESU9fV0lORE9XID0gMzsgLy8gbWVzZXMgaGFjaWEgYXRyXHUwMEUxcyBwYXJhIHByb21lZGlvIHZlbnRhXHJcbi8vIFJFQ09fREVGQVVMVF9NVUxUSVBMSUVSIHJlbW92ZWQgMjAyNi0xMC0wNiAodW51c2VkLCBmbGFnZ2VkIGJ5IGJpb21lKS5cclxuXHJcbi8vIFdoaXRlbGlzdCBkZSBlbWFpbHMgY29uIGFjY2VzbyBhbCBtb2RhbCBGT1JFQ0FTVC4gUmVwbGljYSBlbCBwYXRyb24gZGVcclxuLy8gXCJBbmFsaXNpc1wiIChpbmRleC5odG1sOjEyNjI1KS4gU29sbyBNYXJpYW5vOyBzaSBvdHJvIGFkbWluIGxvIG5lY2VzaXRhXHJcbi8vIHNlIGFncmVnYSBhY2EgZXhwbGljaXRvLlxyXG5jb25zdCBGT1JFQ0FTVF9BTExPV0VEX0VNQUlMUyA9IFsnbWFyaWFuby5lcmJpbm9Ac2hpbWFuby5jb20uYXInLCAnZXJiaW5vbWFyaWFub0BnbWFpbC5jb20nXTtcclxuXHJcbmZ1bmN0aW9uIF9jYW5Gb3JlY2FzdCgpIHtcclxuICB0cnkge1xyXG4gICAgY29uc3QgZW1haWwgPSAoKHdpbmRvdy5jdXJyZW50VXNlciAmJiB3aW5kb3cuY3VycmVudFVzZXIuZW1haWwpIHx8ICcnKS50b0xvd2VyQ2FzZSgpO1xyXG4gICAgaWYgKCFlbWFpbCkgcmV0dXJuIGZhbHNlO1xyXG4gICAgcmV0dXJuIEZPUkVDQVNUX0FMTE9XRURfRU1BSUxTLmluZGV4T2YoZW1haWwpID49IDA7XHJcbiAgfSBjYXRjaCB7XHJcbiAgICByZXR1cm4gZmFsc2U7XHJcbiAgfVxyXG59XHJcblxyXG5mdW5jdGlvbiBfcmVuZGVyTW9kYWxTaGVsbCgpIHtcclxuICBjb25zdCBleGlzdGluZyA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdmb3JlY2FzdC1tb2RhbCcpO1xyXG4gIGlmIChleGlzdGluZykgcmV0dXJuIGV4aXN0aW5nO1xyXG4gIGNvbnN0IGVsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2Jyk7XHJcbiAgZWwuaWQgPSAnZm9yZWNhc3QtbW9kYWwnO1xyXG4gIGVsLmNsYXNzTmFtZSA9ICdtb2RhbC1vdmVybGF5JztcclxuICAvLyB2MTMwNiAoMjAyNi0xMC0xNSk6IEFwcGxlLXN0eWxlIG1vZGFsIG92ZXJsYXkgY29uIGJhY2tkcm9wIGJsdXIuXHJcbiAgZWwuc3R5bGUuY3NzVGV4dCA9XHJcbiAgICAnZGlzcGxheTpub25lO3Bvc2l0aW9uOmZpeGVkO2luc2V0OjA7YmFja2dyb3VuZDpyZ2JhKDAsMCwwLC4zKTstd2Via2l0LWJhY2tkcm9wLWZpbHRlcjpzYXR1cmF0ZSgxNDAlKSBibHVyKDhweCk7YmFja2Ryb3AtZmlsdGVyOnNhdHVyYXRlKDE0MCUpIGJsdXIoOHB4KTt6LWluZGV4OjIwNTA7JztcclxuICBlbC5vbmNsaWNrID0gZnVuY3Rpb24gKGV2KSB7XHJcbiAgICBpZiAoZXYudGFyZ2V0ID09PSBlbCkgd2luZG93LmNsb3NlRm9yZWNhc3RNb2RhbCgpO1xyXG4gIH07XHJcbiAgY29uc3Qgc2hlbGxIdG1sID0gX2J1aWxkU2hlbGxIdG1sKCk7XHJcbiAgZWwuaW5uZXJIVE1MID0gc2hlbGxIdG1sO1xyXG4gIGRvY3VtZW50LmJvZHkuYXBwZW5kQ2hpbGQoZWwpO1xyXG4gIF9lbnN1cmVGb3JlY2FzdEFwcGxlQ3NzKCk7XHJcbiAgcmV0dXJuIGVsO1xyXG59XHJcblxyXG5mdW5jdGlvbiBfZW5zdXJlRm9yZWNhc3RBcHBsZUNzcygpIHtcclxuICAvLyB2MTMwNjogQ1NTIEFwcGxlLXN0eWxlIGlueWVjdGFkbyB1bmEgc29sYSB2ZXogYWwgYWJyaXIgZWwgbW9kYWwuXHJcbiAgLy8gU2tpbGwgYXBwbGUtZGVzaWduOiBmZWVkYmFjayBwb2ludGVyZG93biwgYmFja2Ryb3AgYmx1ciwgcmVkdWNlZC1tb3Rpb24sXHJcbiAgLy8gdHlwb2dyYXBoeSB0cmFja2luZyBzaXplLXNwZWNpZmljLlxyXG4gIGlmIChkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZm9yZWNhc3QtYXBwbGUtY3NzJykpIHJldHVybjtcclxuICBjb25zdCBzdHlsZSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3N0eWxlJyk7XHJcbiAgc3R5bGUuaWQgPSAnZm9yZWNhc3QtYXBwbGUtY3NzJztcclxuICBjb25zdCBjc3MgPVxyXG4gICAgJyNmb3JlY2FzdC1tb2RhbCAuZmMtYXBwbGUgKntmb250LWZhbWlseTotYXBwbGUtc3lzdGVtLEJsaW5rTWFjU3lzdGVtRm9udCxcIlNGIFBybyBEaXNwbGF5XCIsXCJTRiBQcm8gVGV4dFwiLFwiSGVsdmV0aWNhIE5ldWVcIixzYW5zLXNlcmlmfScgK1xyXG4gICAgJyNmb3JlY2FzdC1tb2RhbCAuZmMtYXBwbGUtY2xvc2V7Ym9yZGVyOm5vbmU7YmFja2dyb3VuZDpyZ2JhKDEyMCwxMjAsMTI4LC4xNCk7d2lkdGg6MzBweDtoZWlnaHQ6MzBweDtib3JkZXItcmFkaXVzOjUwJTtjdXJzb3I6cG9pbnRlcjtjb2xvcjojODY4NjhiO2ZvbnQtc2l6ZToxNnB4O2Rpc3BsYXk6ZmxleDthbGlnbi1pdGVtczpjZW50ZXI7anVzdGlmeS1jb250ZW50OmNlbnRlcjt0cmFuc2l0aW9uOnRyYW5zZm9ybSAuMTJzIGVhc2Utb3V0LGJhY2tncm91bmQgLjE1cyBlYXNlLGNvbG9yIC4xNXMgZWFzZX0nICtcclxuICAgICcjZm9yZWNhc3QtbW9kYWwgLmZjLWFwcGxlLWNsb3NlOmhvdmVye2JhY2tncm91bmQ6cmdiYSgxMjAsMTIwLDEyOCwuMjIpO2NvbG9yOiMxZDFkMWZ9JyArXHJcbiAgICAnI2ZvcmVjYXN0LW1vZGFsIC5mYy1hcHBsZS1jbG9zZTphY3RpdmV7dHJhbnNmb3JtOnNjYWxlKC45KTtiYWNrZ3JvdW5kOnJnYmEoMTIwLDEyMCwxMjgsLjMpfScgK1xyXG4gICAgJyNmb3JlY2FzdC1tb2RhbCAuZmMtYXBwbGUtdGFie3BhZGRpbmc6N3B4IDE2cHg7Ym9yZGVyLXJhZGl1czo5ODBweDtib3JkZXI6bm9uZTtiYWNrZ3JvdW5kOnRyYW5zcGFyZW50O2NvbG9yOiM4Njg2OGI7Zm9udC1zaXplOjEyLjVweDtmb250LXdlaWdodDo2MDA7bGV0dGVyLXNwYWNpbmc6LTAuMXB4O2N1cnNvcjpwb2ludGVyO3RyYW5zaXRpb246YmFja2dyb3VuZCAuMTVzIGVhc2UsY29sb3IgLjE1cyBlYXNlLHRyYW5zZm9ybSAuMXMgZWFzZS1vdXR9JyArXHJcbiAgICAnI2ZvcmVjYXN0LW1vZGFsIC5mYy1hcHBsZS10YWI6aG92ZXJ7YmFja2dyb3VuZDpyZ2JhKDEyMCwxMjAsMTI4LC4xKTtjb2xvcjojMWQxZDFmfScgK1xyXG4gICAgJyNmb3JlY2FzdC1tb2RhbCAuZmMtYXBwbGUtdGFiOmFjdGl2ZXt0cmFuc2Zvcm06c2NhbGUoLjk3KX0nICtcclxuICAgICcjZm9yZWNhc3QtbW9kYWwgLmZjLWFwcGxlLXRhYi5hY3RpdmV7YmFja2dyb3VuZDojMWQxZDFmO2NvbG9yOiNmZmZ9JyArXHJcbiAgICAnI2ZvcmVjYXN0LW1vZGFsIC5mYy1hcHBsZS10YWIuYWN0aXZlOmhvdmVye2JhY2tncm91bmQ6IzAwMH0nICtcclxuICAgICdAbWVkaWEgKHByZWZlcnMtcmVkdWNlZC1tb3Rpb246cmVkdWNlKXsnICtcclxuICAgICcgICNmb3JlY2FzdC1tb2RhbCAuZmMtYXBwbGUtY2xvc2UsI2ZvcmVjYXN0LW1vZGFsIC5mYy1hcHBsZS10YWJ7dHJhbnNpdGlvbjpub25lICFpbXBvcnRhbnR9JyArXHJcbiAgICAnICAjZm9yZWNhc3QtbW9kYWwgLmZjLWFwcGxlLWNsb3NlOmFjdGl2ZSwjZm9yZWNhc3QtbW9kYWwgLmZjLWFwcGxlLXRhYjphY3RpdmV7dHJhbnNmb3JtOm5vbmUgIWltcG9ydGFudH0nICtcclxuICAgICd9JztcclxuICBzdHlsZS50ZXh0Q29udGVudCA9IGNzcztcclxuICBkb2N1bWVudC5oZWFkLmFwcGVuZENoaWxkKHN0eWxlKTtcclxufVxyXG5cclxuZnVuY3Rpb24gX2J1aWxkU2hlbGxIdG1sKCkge1xyXG4gIC8vIHYxMzA2OiByZWRpc2VcdTAwRjFvIEFwcGxlLXN0eWxlLlxyXG4gIC8vIHYxMzA3ICgyMDI2LTEwLTE1KTogdGFiIFwiRm9yZWNhc3QgZXN0YWRcdTAwRURzdGljb1wiIHJlbW92aWRhIChkZWNpc2lcdTAwRjNuIE1hcmlhbm8pLlxyXG4gIC8vIEVsIGZvcmVjYXN0IHBvciBzdWJmYW1pbGlhIChmb3JlY2FzdF9vdXRwdXQvKSBubyBhZ3JlZ2EgdmFsb3Igc29icmVcclxuICAvLyBcIlNhbGVzIFBsYW5zXCIgcXVlIHlhIGhhY2UgcmVjb21lbmRhY2lcdTAwRjNuIG5pdmVsIFNLVSBjb24gQk8gKyBzdG9jayArIHBsYW4uXHJcbiAgLy8gU2hlbGwgcXVlZGEgc2luIHRhYnMgYmFyIFx1MjAxNCB1bmEgc29sYSB2aXN0YS5cclxuICBjb25zdCBtb2RhbE91dGVyID1cclxuICAgICc8ZGl2IGNsYXNzPVwiZmMtYXBwbGVcIiBzdHlsZT1cInBvc2l0aW9uOmFic29sdXRlO2luc2V0OjF2aCAxdnc7YmFja2dyb3VuZDojZmJmYmZkO2JvcmRlci1yYWRpdXM6MThweDtkaXNwbGF5OmZsZXg7ZmxleC1kaXJlY3Rpb246Y29sdW1uO292ZXJmbG93OmhpZGRlbjtib3gtc2hhZG93OjAgMjRweCA3MHB4IHJnYmEoMCwwLDAsLjIyKVwiPic7XHJcbiAgY29uc3QgaGVhZGVyID1cclxuICAgICc8ZGl2IHN0eWxlPVwicGFkZGluZzoyMnB4IDI2cHggMThweDtiYWNrZ3JvdW5kOnJnYmEoMjUxLDI1MSwyNTMsLjkyKTstd2Via2l0LWJhY2tkcm9wLWZpbHRlcjpzYXR1cmF0ZSgxODAlKSBibHVyKDIwcHgpO2JhY2tkcm9wLWZpbHRlcjpzYXR1cmF0ZSgxODAlKSBibHVyKDIwcHgpO2JvcmRlci1ib3R0b206MC41cHggc29saWQgcmdiYSgwLDAsMCwuMDgpO2Rpc3BsYXk6ZmxleDthbGlnbi1pdGVtczpmbGV4LXN0YXJ0O2dhcDoxNHB4XCI+JyArXHJcbiAgICAnPGRpdiBzdHlsZT1cImZsZXg6MTttaW4td2lkdGg6MFwiPicgK1xyXG4gICAgJzxoMiBzdHlsZT1cIm1hcmdpbjowIDAgNHB4O2ZvbnQtc2l6ZToyMnB4O2ZvbnQtd2VpZ2h0OjcwMDtsZXR0ZXItc3BhY2luZzotMC41cHg7Y29sb3I6IzFkMWQxZlwiPkZvcmVjYXN0PC9oMj4nICtcclxuICAgICc8ZGl2IGlkPVwiZm9yZWNhc3Qtc3VidGl0bGVcIiBzdHlsZT1cImZvbnQtc2l6ZToxM3B4O2xldHRlci1zcGFjaW5nOi0wLjFweDtjb2xvcjojODY4NjhiXCI+U2FsZXMgUGxhbnMgbWVuc3VhbGVzICsgcG9sXHUwMEVEdGljYSBkZSBpbnZlbnRhcmlvPC9kaXY+JyArXHJcbiAgICAnPC9kaXY+JyArXHJcbiAgICAnPGJ1dHRvbiBjbGFzcz1cImZjLWFwcGxlLWNsb3NlXCIgb25jbGljaz1cImNsb3NlRm9yZWNhc3RNb2RhbCgpXCIgYXJpYS1sYWJlbD1cIkNlcnJhclwiPiZ0aW1lczs8L2J1dHRvbj4nICtcclxuICAgICc8L2Rpdj4nO1xyXG4gIGNvbnN0IHRhYlNhbGVzUGxhbnMgPVxyXG4gICAgJzxkaXYgaWQ9XCJmb3JlY2FzdC10YWItc2FsZXMtcGxhbnNcIiBzdHlsZT1cImZsZXg6MTtvdmVyZmxvdzphdXRvO3BhZGRpbmc6MDtiYWNrZ3JvdW5kOiNmYmZiZmRcIj48L2Rpdj4nO1xyXG4gIC8vIHYxMzA3OiBjb250ZW5lZG9yIHN0YXQgcXVlZGEgb2N1bHRvIHBhcmEgcHJlc2VydmFyIHJlZmVyZW5jaWFzIGRlbCBjb2RpZ29cclxuICAvLyAoc3dpdGNoRm9yZWNhc3RUYWIvX3JlbmRlckZvcmVjYXN0U3RhdFRhYiBleGlzdGVuIHBlcm8gbm8gc2UgaW52b2NhblxyXG4gIC8vIGRlc2RlIGxhIFVJKS4gU2kgcXVlclx1MDBFOXMgbGltcGlhciBlbCBjb2RpZ28gZW50ZXJvLCBlcyBzYWZlIGJvcnJhcmxvcy5cclxuICBjb25zdCB0YWJTdGF0ID1cclxuICAgICc8ZGl2IGlkPVwiZm9yZWNhc3QtdGFiLXN0YXRcIiBzdHlsZT1cImRpc3BsYXk6bm9uZVwiPjwvZGl2Pic7XHJcbiAgcmV0dXJuIG1vZGFsT3V0ZXIgKyBoZWFkZXIgKyB0YWJTYWxlc1BsYW5zICsgdGFiU3RhdCArICc8L2Rpdj4nO1xyXG59XHJcblxyXG4vLyB2MTA5OCsgRmFzZSAxICsgdjExMDMrIEZhc2UgMkIgKyB2MTEwNSBmaXggKyB2MTExMSBjbGVhbiBsZWdhY3k6IHN3aXRjaFxyXG4vLyBlbnRyZSB0YWJzIFNhbGVzIFBsYW5zIC8gRm9yZWNhc3QgRXN0YWRcdTAwRURzdGljby5cclxud2luZG93LnN3aXRjaEZvcmVjYXN0VGFiID0gZnVuY3Rpb24gKHRhYklkKSB7XHJcbiAgX2ZvcmVjYXN0QWN0aXZlVGFiID0gdGFiSWQ7XHJcbiAgY29uc3Qgc3AgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZm9yZWNhc3QtdGFiLXNhbGVzLXBsYW5zJyk7XHJcbiAgY29uc3Qgc3QgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZm9yZWNhc3QtdGFiLXN0YXQnKTtcclxuICBpZiAoc3ApIHNwLnN0eWxlLmRpc3BsYXkgPSB0YWJJZCA9PT0gJ3NhbGVzLXBsYW5zJyA/ICdibG9jaycgOiAnbm9uZSc7XHJcbiAgaWYgKHN0KSBzdC5zdHlsZS5kaXNwbGF5ID0gdGFiSWQgPT09ICdzdGF0JyA/ICdibG9jaycgOiAnbm9uZSc7XHJcbiAgY29uc3QgYnRucyA9IGRvY3VtZW50LnF1ZXJ5U2VsZWN0b3JBbGwoJyNmb3JlY2FzdC10YWJzLWJhciAuZm9yZWNhc3QtdGFiJyk7XHJcbiAgYnRucy5mb3JFYWNoKChiKSA9PiB7XHJcbiAgICBjb25zdCBhY3RpdmUgPSBiLmdldEF0dHJpYnV0ZSgnZGF0YS10YWInKSA9PT0gdGFiSWQ7XHJcbiAgICAvLyB2MTMwNiBBcHBsZS1zdHlsZTogdG9nZ2xlIGNsYXNzIGFjdGl2ZSAobG9zIGVzdGlsb3MgZGUgcGlsbCB2aWVuZW4gZGVsIENTUykuXHJcbiAgICBiLmNsYXNzTGlzdC50b2dnbGUoJ2FjdGl2ZScsIGFjdGl2ZSk7XHJcbiAgfSk7XHJcbiAgLy8gdjExMDUgZml4OiBhbCBhY3RpdmFyIGxhIHRhYiBzdGF0LCBtb3N0cmFyIHBsYWNlaG9sZGVyIGlubWVkaWF0byBwYXJhXHJcbiAgLy8gcXVlIHNlIHZlYSBhbGdvIG1pZW50cmFzIGNhcmdhIChvIHNpIGVsIGxvYWQgeWEgdGVybWlubywgcmUtcmVuZGVyKS5cclxuICBpZiAodGFiSWQgPT09ICdzdGF0Jykge1xyXG4gICAgY29uc3QgY29udCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdmb3JlY2FzdC10YWItc3RhdCcpO1xyXG4gICAgaWYgKGNvbnQpIHtcclxuICAgICAgaWYgKF9mb3JlY2FzdFN0YXREb2NzKSB7XHJcbiAgICAgICAgLy8gWWEgY2FyZ2FkbzogcmUtcmVuZGVyIChwb3Igc2kgZWwgdXNlciB2aWVuZSBkZSBvdHJhIHRhYikuXHJcbiAgICAgICAgX3JlbmRlckZvcmVjYXN0U3RhdFRhYigpO1xyXG4gICAgICB9IGVsc2Uge1xyXG4gICAgICAgIC8vIEFcdTAwRkFuIG5vIGNhcmdhZG86IHBsYWNlaG9sZGVyICsgbG9hZC5cclxuICAgICAgICBjb250LmlubmVySFRNTCA9XHJcbiAgICAgICAgICAnPGRpdiBjbGFzcz1cImZjLWFwcGxlXCIgc3R5bGU9XCJwYWRkaW5nOjgwcHggMjBweDt0ZXh0LWFsaWduOmNlbnRlcjtjb2xvcjojODY4NjhiO2ZvbnQtc2l6ZToxNHB4O2xldHRlci1zcGFjaW5nOi0wLjFweFwiPicgK1xyXG4gICAgICAgICAgJzxkaXYgc3R5bGU9XCJkaXNwbGF5OmlubGluZS1ibG9jazt3aWR0aDoyOHB4O2hlaWdodDoyOHB4O2JvcmRlcjoyLjVweCBzb2xpZCByZ2JhKDAsMTIyLDI1NSwuMik7Ym9yZGVyLXRvcC1jb2xvcjojMDA3YWZmO2JvcmRlci1yYWRpdXM6NTAlO2FuaW1hdGlvbjpzcGluIDAuNzVzIGxpbmVhciBpbmZpbml0ZTttYXJnaW4tYm90dG9tOjE2cHhcIj48L2Rpdj4nICtcclxuICAgICAgICAgICc8ZGl2PkNhcmdhbmRvIGZvcmVjYXN0IGRlc2RlIEZpcmVzdG9yZTwvZGl2PicgK1xyXG4gICAgICAgICAgJzxzdHlsZT5Aa2V5ZnJhbWVzIHNwaW57dG97dHJhbnNmb3JtOnJvdGF0ZSgzNjBkZWcpfX08L3N0eWxlPicgK1xyXG4gICAgICAgICAgJzwvZGl2Pic7XHJcbiAgICAgICAgX2xvYWRGb3JlY2FzdE91dHB1dCgpXHJcbiAgICAgICAgICAudGhlbihfcmVuZGVyRm9yZWNhc3RTdGF0VGFiKVxyXG4gICAgICAgICAgLmNhdGNoKChlKSA9PiB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ1tGT1JFQ0FTVCBzdGF0XSBsb2FkIGZhaWwnLCBlKTtcclxuICAgICAgICAgICAgY29uc3QgYyA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdmb3JlY2FzdC10YWItc3RhdCcpO1xyXG4gICAgICAgICAgICBpZiAoYykge1xyXG4gICAgICAgICAgICAgIGMuaW5uZXJIVE1MID1cclxuICAgICAgICAgICAgICAgICc8ZGl2IGNsYXNzPVwiZmMtYXBwbGVcIiBzdHlsZT1cInBhZGRpbmc6ODBweCAyMHB4O3RleHQtYWxpZ246Y2VudGVyO2xpbmUtaGVpZ2h0OjEuNVwiPicgK1xyXG4gICAgICAgICAgICAgICAgJzxkaXYgc3R5bGU9XCJmb250LXNpemU6MTZweDtmb250LXdlaWdodDo2MDA7bWFyZ2luLWJvdHRvbToxMHB4O2NvbG9yOiNjNzM3MmY7bGV0dGVyLXNwYWNpbmc6LTAuMnB4XCI+RXJyb3IgY2FyZ2FuZG8gZm9yZWNhc3Q8L2Rpdj4nICtcclxuICAgICAgICAgICAgICAgICc8ZGl2IHN0eWxlPVwiZm9udC1zaXplOjEyLjVweDtjb2xvcjojODY4NjhiO21hcmdpbi1ib3R0b206MThweDtsZXR0ZXItc3BhY2luZzotMC4xcHhcIj4nICtcclxuICAgICAgICAgICAgICAgIGVzY2FwZUh0bWxTYWZlKGUubWVzc2FnZSB8fCBTdHJpbmcoZSkpICtcclxuICAgICAgICAgICAgICAgICc8L2Rpdj4nICtcclxuICAgICAgICAgICAgICAgICc8YnV0dG9uIG9uY2xpY2s9XCJzd2l0Y2hGb3JlY2FzdFRhYihcXCdzdGF0XFwnKVwiIHN0eWxlPVwicGFkZGluZzo5cHggMThweDtiYWNrZ3JvdW5kOiMwMDdhZmY7Y29sb3I6I2ZmZjtib3JkZXI6bm9uZTtib3JkZXItcmFkaXVzOjk4MHB4O2ZvbnQtd2VpZ2h0OjYwMDtjdXJzb3I6cG9pbnRlcjtmb250LXNpemU6MTNweDtsZXR0ZXItc3BhY2luZzotMC4xcHhcIj5SZWludGVudGFyPC9idXR0b24+JyArXHJcbiAgICAgICAgICAgICAgICAnPC9kaXY+JztcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgfSk7XHJcbiAgICAgIH1cclxuICAgIH1cclxuICB9XHJcbn07XHJcblxyXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuLy8gRkFTRSAxIFx1MjAxNCBTYWxlcyBQbGFucyB1cGxvYWQgKFJvZHMgLyBSZWVscyAvIEZHKVxyXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHJcbmZ1bmN0aW9uIF95ZWFyTW9udGhOb3coKSB7XHJcbiAgY29uc3QgZCA9IG5ldyBEYXRlKCk7XHJcbiAgcmV0dXJuIGQuZ2V0RnVsbFllYXIoKSArICctJyArIFN0cmluZyhkLmdldE1vbnRoKCkgKyAxKS5wYWRTdGFydCgyLCAnMCcpO1xyXG59XHJcblxyXG5mdW5jdGlvbiBfZm10U2l6ZShieXRlcykge1xyXG4gIGlmICghYnl0ZXMpIHJldHVybiAnJztcclxuICBpZiAoYnl0ZXMgPCAxMDI0KSByZXR1cm4gYnl0ZXMgKyAnIEInO1xyXG4gIGlmIChieXRlcyA8IDEwMjQgKiAxMDI0KSByZXR1cm4gKGJ5dGVzIC8gMTAyNCkudG9GaXhlZCgxKSArICcgS0InO1xyXG4gIHJldHVybiAoYnl0ZXMgLyAoMTAyNCAqIDEwMjQpKS50b0ZpeGVkKDIpICsgJyBNQic7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIF9mbXREYXRlU2hvcnQoaXNvKSB7XHJcbiAgaWYgKCFpc28pIHJldHVybiAnXHUyMDE0JztcclxuICB0cnkge1xyXG4gICAgY29uc3QgZCA9IGlzby50b0RhdGUgPyBpc28udG9EYXRlKCkgOiBuZXcgRGF0ZShpc28pO1xyXG4gICAgcmV0dXJuIChcclxuICAgICAgZC50b0xvY2FsZURhdGVTdHJpbmcoJ2VzLUFSJywgeyBkYXk6ICcyLWRpZ2l0JywgbW9udGg6ICdzaG9ydCcsIHllYXI6ICcyLWRpZ2l0JyB9KSArXHJcbiAgICAgICcgJyArXHJcbiAgICAgIGQudG9Mb2NhbGVUaW1lU3RyaW5nKCdlcy1BUicsIHsgaG91cjogJzItZGlnaXQnLCBtaW51dGU6ICcyLWRpZ2l0JyB9KVxyXG4gICAgKTtcclxuICB9IGNhdGNoIHtcclxuICAgIHJldHVybiBTdHJpbmcoaXNvKTtcclxuICB9XHJcbn1cclxuXHJcbmFzeW5jIGZ1bmN0aW9uIF9sb2FkU2FsZXNQbGFuQ2FjaGVzKCkge1xyXG4gIGlmICghd2luZG93LmZiRGIpIHJldHVybjtcclxuICBhd2FpdCBQcm9taXNlLmFsbChcclxuICAgIFNBTEVTX1BMQU5fRkFNSUxJQVMubWFwKGFzeW5jIChmKSA9PiB7XHJcbiAgICAgIHRyeSB7XHJcbiAgICAgICAgY29uc3QgZG9jID0gYXdhaXQgd2luZG93LmZiRGIuY29sbGVjdGlvbignc2FsZXNfcGxhbl9jYWNoZScpLmRvYyhmLmtleSkuZ2V0KCk7XHJcbiAgICAgICAgX3NhbGVzUGxhbkNhY2hlc1tmLmtleV0gPSBkb2MuZXhpc3RzID8gZG9jLmRhdGEoKSA6IG51bGw7XHJcbiAgICAgIH0gY2F0Y2ggKGUpIHtcclxuICAgICAgICBjb25zb2xlLndhcm4oJ1tGT1JFQ0FTVF0gbG9hZCBzYWxlc19wbGFuX2NhY2hlLycgKyBmLmtleSArICcgZmFpbDonLCBlICYmIGUubWVzc2FnZSk7XHJcbiAgICAgICAgX3NhbGVzUGxhbkNhY2hlc1tmLmtleV0gPSBudWxsO1xyXG4gICAgICB9XHJcbiAgICB9KVxyXG4gICk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGVzY2FwZUh0bWxTYWZlKHMpIHtcclxuICBpZiAodHlwZW9mIHdpbmRvdy5lc2NhcGVIdG1sID09PSAnZnVuY3Rpb24nKSByZXR1cm4gd2luZG93LmVzY2FwZUh0bWwocyk7XHJcbiAgcmV0dXJuIFN0cmluZyhzID09IG51bGwgPyAnJyA6IHMpLnJlcGxhY2UoXHJcbiAgICAvWyY8PlwiJ10vZyxcclxuICAgIChjaCkgPT4gKHsgJyYnOiAnJmFtcDsnLCAnPCc6ICcmbHQ7JywgJz4nOiAnJmd0OycsICdcIic6ICcmcXVvdDsnLCBcIidcIjogJyYjMzk7JyB9KVtjaF1cclxuICApO1xyXG59XHJcblxyXG5mdW5jdGlvbiBfYnVpbGRTYWxlc1BsYW5TbG90SHRtbChmKSB7XHJcbiAgY29uc3QgY2FjaGUgPSBfc2FsZXNQbGFuQ2FjaGVzW2Yua2V5XTtcclxuICBjb25zdCByb3dzQ291bnQgPSBjYWNoZSAmJiBOdW1iZXIuaXNGaW5pdGUoY2FjaGUucm93c0NvdW50KSA/IGNhY2hlLnJvd3NDb3VudCA6IDA7XHJcbiAgY29uc3QgbW9udGhzQ291bnQgPVxyXG4gICAgY2FjaGUgJiYgQXJyYXkuaXNBcnJheShjYWNoZS5kZXRlY3RlZE1vbnRocykgPyBjYWNoZS5kZXRlY3RlZE1vbnRocy5sZW5ndGggOiAwO1xyXG4gIGNvbnN0IHBhcnNlZEF0ID0gY2FjaGUgJiYgY2FjaGUucGFyc2VkQXQgPyBfZm10RGF0ZVNob3J0KGNhY2hlLnBhcnNlZEF0KSA6ICcnO1xyXG4gIGNvbnN0IHVwbG9hZGVkQnkgPSBjYWNoZSAmJiBjYWNoZS51cGxvYWRlZEJ5ID8gY2FjaGUudXBsb2FkZWRCeSA6ICcnO1xyXG4gIGNvbnN0IHNvdXJjZUZpbGVuYW1lID0gY2FjaGUgJiYgY2FjaGUuc291cmNlRmlsZW5hbWUgPyBjYWNoZS5zb3VyY2VGaWxlbmFtZSA6ICcnO1xyXG4gIGNvbnN0IHllYXJNb250aCA9IGNhY2hlICYmIGNhY2hlLnllYXJNb250aCA/IGNhY2hlLnllYXJNb250aCA6ICcnO1xyXG4gIGNvbnN0IG1vbnRoc1JhbmdlID1cclxuICAgIGNhY2hlICYmIGNhY2hlLmRldGVjdGVkTW9udGhzICYmIGNhY2hlLmRldGVjdGVkTW9udGhzLmxlbmd0aFxyXG4gICAgICA/IGNhY2hlLmRldGVjdGVkTW9udGhzWzBdICsgJyBcdTIxOTIgJyArIGNhY2hlLmRldGVjdGVkTW9udGhzW2NhY2hlLmRldGVjdGVkTW9udGhzLmxlbmd0aCAtIDFdXHJcbiAgICAgIDogJ1x1MjAxNCc7XHJcbiAgY29uc3QgaGFzQ2FjaGUgPSAhIWNhY2hlO1xyXG4gIGNvbnN0IGJhZGdlID0gaGFzQ2FjaGVcclxuICAgID8gJzxkaXYgc3R5bGU9XCJwYWRkaW5nOjRweCA4cHg7YmFja2dyb3VuZDojMTZhMzRhO2NvbG9yOiNmZmY7Ym9yZGVyLXJhZGl1czoxMnB4O2ZvbnQtc2l6ZToxMHB4O2ZvbnQtd2VpZ2h0OjcwMDtsZXR0ZXItc3BhY2luZzouNHB4XCI+Q0FSR0FETzwvZGl2PidcclxuICAgIDogJzxkaXYgc3R5bGU9XCJwYWRkaW5nOjRweCA4cHg7YmFja2dyb3VuZDojZGMyNjI2O2NvbG9yOiNmZmY7Ym9yZGVyLXJhZGl1czoxMnB4O2ZvbnQtc2l6ZToxMHB4O2ZvbnQtd2VpZ2h0OjcwMDtsZXR0ZXItc3BhY2luZzouNHB4XCI+RkFMVEE8L2Rpdj4nO1xyXG4gIGNvbnN0IG1ldGFCbG9jayA9IGhhc0NhY2hlXHJcbiAgICA/ICc8ZGl2IHN0eWxlPVwiZGlzcGxheTpncmlkO2dyaWQtdGVtcGxhdGUtY29sdW1uczphdXRvIDFmcjtnYXA6NnB4IDEycHg7Zm9udC1zaXplOjExcHg7cGFkZGluZzoxMHB4IDEycHg7YmFja2dyb3VuZDp2YXIoLS1iZy1zZWNvbmRhcnkpO2JvcmRlci1yYWRpdXM6NnB4XCI+JyArXHJcbiAgICAgICc8ZGl2IHN0eWxlPVwiY29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7Zm9udC13ZWlnaHQ6NjAwXCI+QXJjaGl2bzwvZGl2PjxkaXYgc3R5bGU9XCJjb2xvcjp2YXIoLS10ZXh0LXByaW1hcnkpO2ZvbnQtZmFtaWx5Om1vbm9zcGFjZTt3b3JkLWJyZWFrOmJyZWFrLWFsbFwiPicgK1xyXG4gICAgICBlc2NhcGVIdG1sU2FmZShzb3VyY2VGaWxlbmFtZSkgK1xyXG4gICAgICAnPC9kaXY+JyArXHJcbiAgICAgICc8ZGl2IHN0eWxlPVwiY29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7Zm9udC13ZWlnaHQ6NjAwXCI+U3ViaWRvPC9kaXY+PGRpdiBzdHlsZT1cImNvbG9yOnZhcigtLXRleHQtcHJpbWFyeSlcIj4nICtcclxuICAgICAgZXNjYXBlSHRtbFNhZmUocGFyc2VkQXQpICtcclxuICAgICAgJzwvZGl2PicgK1xyXG4gICAgICAnPGRpdiBzdHlsZT1cImNvbG9yOnZhcigtLXRleHQtbXV0ZWQpO2ZvbnQtd2VpZ2h0OjYwMFwiPlBvcjwvZGl2PjxkaXYgc3R5bGU9XCJjb2xvcjp2YXIoLS10ZXh0LXByaW1hcnkpXCI+JyArXHJcbiAgICAgIGVzY2FwZUh0bWxTYWZlKHVwbG9hZGVkQnkpICtcclxuICAgICAgJzwvZGl2PicgK1xyXG4gICAgICAnPGRpdiBzdHlsZT1cImNvbG9yOnZhcigtLXRleHQtbXV0ZWQpO2ZvbnQtd2VpZ2h0OjYwMFwiPlNuYXBzaG90PC9kaXY+PGRpdiBzdHlsZT1cImNvbG9yOnZhcigtLXRleHQtcHJpbWFyeSk7Zm9udC1mYW1pbHk6bW9ub3NwYWNlXCI+JyArXHJcbiAgICAgIGVzY2FwZUh0bWxTYWZlKHllYXJNb250aCkgK1xyXG4gICAgICAnPC9kaXY+JyArXHJcbiAgICAgICc8ZGl2IHN0eWxlPVwiY29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7Zm9udC13ZWlnaHQ6NjAwXCI+U0tVczwvZGl2PjxkaXYgc3R5bGU9XCJjb2xvcjp2YXIoLS10ZXh0LXByaW1hcnkpO2ZvbnQtd2VpZ2h0OjcwMFwiPicgK1xyXG4gICAgICByb3dzQ291bnQudG9Mb2NhbGVTdHJpbmcoJ2VzLUFSJykgK1xyXG4gICAgICAnPC9kaXY+JyArXHJcbiAgICAgICc8ZGl2IHN0eWxlPVwiY29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7Zm9udC13ZWlnaHQ6NjAwXCI+TWVzZXM8L2Rpdj48ZGl2IHN0eWxlPVwiY29sb3I6dmFyKC0tdGV4dC1wcmltYXJ5KTtmb250LXdlaWdodDo3MDBcIj4nICtcclxuICAgICAgbW9udGhzQ291bnQgK1xyXG4gICAgICAnIDxzcGFuIHN0eWxlPVwiY29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7Zm9udC13ZWlnaHQ6NDAwXCI+KCcgK1xyXG4gICAgICBlc2NhcGVIdG1sU2FmZShtb250aHNSYW5nZSkgK1xyXG4gICAgICAnKTwvc3Bhbj48L2Rpdj4nICtcclxuICAgICAgJzwvZGl2PidcclxuICAgIDogJzxkaXYgc3R5bGU9XCJwYWRkaW5nOjE0cHg7dGV4dC1hbGlnbjpjZW50ZXI7Zm9udC1zaXplOjEycHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7YmFja2dyb3VuZDp2YXIoLS1iZy1zZWNvbmRhcnkpO2JvcmRlci1yYWRpdXM6NnB4O2JvcmRlcjoxcHggZGFzaGVkIHZhcigtLWJvcmRlci1zdWJ0bGUpXCI+QXVuIG5vIHN1YmlzdGUgZWwgU2FsZXMgUGxhbiBkZSBlc3RhIGZhbWlsaWEuPC9kaXY+JztcclxuICBjb25zdCB1cGxvYWRCdG4gPVxyXG4gICAgJzxsYWJlbCBzdHlsZT1cImRpc3BsYXk6aW5saW5lLWZsZXg7YWxpZ24taXRlbXM6Y2VudGVyO2p1c3RpZnktY29udGVudDpjZW50ZXI7Z2FwOjhweDtwYWRkaW5nOjEwcHggMTRweDtiYWNrZ3JvdW5kOicgK1xyXG4gICAgZi5jb2xvciArXHJcbiAgICAnO2NvbG9yOiNmZmY7Ym9yZGVyLXJhZGl1czo2cHg7Zm9udC13ZWlnaHQ6NzAwO2ZvbnQtc2l6ZToxMnB4O2N1cnNvcjpwb2ludGVyO2xldHRlci1zcGFjaW5nOi40cHhcIj4nICtcclxuICAgICc8c3Bhbj4nICtcclxuICAgIChoYXNDYWNoZSA/ICdcdTIxQkIgUmVlbXBsYXphciBFeGNlbCcgOiAnXHUyQjA2IENhcmdhciBFeGNlbCcpICtcclxuICAgICc8L3NwYW4+JyArXHJcbiAgICAnPGlucHV0IHR5cGU9XCJmaWxlXCIgYWNjZXB0PVwiLnhsc3gsLnhsc1wiIGRhdGEtZmFtaWxpYT1cIicgK1xyXG4gICAgZi5rZXkgK1xyXG4gICAgJ1wiIHN0eWxlPVwiZGlzcGxheTpub25lXCIgb25jaGFuZ2U9XCJvblNhbGVzUGxhbkZpbGVGb3JGYW1pbGlhKGV2ZW50LCBcXCcnICtcclxuICAgIGYua2V5ICtcclxuICAgICdcXCcpXCIvPicgK1xyXG4gICAgJzwvbGFiZWw+JztcclxuICBjb25zdCBjYXJkSGVhZCA9XHJcbiAgICAnPGRpdiBzdHlsZT1cImRpc3BsYXk6ZmxleDthbGlnbi1pdGVtczpjZW50ZXI7Z2FwOjEwcHhcIj4nICtcclxuICAgICc8ZGl2IHN0eWxlPVwid2lkdGg6MTJweDtoZWlnaHQ6MzJweDtiYWNrZ3JvdW5kOicgK1xyXG4gICAgZi5jb2xvciArXHJcbiAgICAnO2JvcmRlci1yYWRpdXM6M3B4XCI+PC9kaXY+JyArXHJcbiAgICAnPGRpdiBzdHlsZT1cImZsZXg6MVwiPjxkaXYgc3R5bGU9XCJmb250LXNpemU6MTRweDtmb250LXdlaWdodDo4MDA7Y29sb3I6dmFyKC0tdGV4dC1wcmltYXJ5KVwiPicgK1xyXG4gICAgZXNjYXBlSHRtbFNhZmUoZi5sYWJlbCkgK1xyXG4gICAgJzwvZGl2PicgK1xyXG4gICAgJzxkaXYgc3R5bGU9XCJmb250LXNpemU6MTFweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTttYXJnaW4tdG9wOjJweFwiPlNhbGVzIFBsYW4gbWVuc3VhbCBcdTAwQjcgSG9qYSBTQVI8L2Rpdj48L2Rpdj4nICtcclxuICAgIGJhZGdlICtcclxuICAgICc8L2Rpdj4nO1xyXG4gIHJldHVybiAoXHJcbiAgICAnPGRpdiBzdHlsZT1cImJhY2tncm91bmQ6dmFyKC0tYmctZWxldmF0ZWQpO2JvcmRlcjoxcHggc29saWQgdmFyKC0tYm9yZGVyLXN1YnRsZSk7Ym9yZGVyLXJhZGl1czoxMHB4O3BhZGRpbmc6MTZweDtkaXNwbGF5OmZsZXg7ZmxleC1kaXJlY3Rpb246Y29sdW1uO2dhcDoxMnB4XCI+JyArXHJcbiAgICBjYXJkSGVhZCArXHJcbiAgICBtZXRhQmxvY2sgK1xyXG4gICAgdXBsb2FkQnRuICtcclxuICAgICc8ZGl2IGlkPVwic2FsZXMtcGxhbi1zdGF0dXMtJyArXHJcbiAgICBmLmtleSArXHJcbiAgICAnXCIgc3R5bGU9XCJmb250LXNpemU6MTFweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTttaW4taGVpZ2h0OjE0cHhcIj48L2Rpdj4nICtcclxuICAgICc8L2Rpdj4nXHJcbiAgKTtcclxufVxyXG5cclxuZnVuY3Rpb24gX3JlbmRlclNhbGVzUGxhbnNUYWIoKSB7XHJcbiAgY29uc3QgY29udCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdmb3JlY2FzdC10YWItc2FsZXMtcGxhbnMnKTtcclxuICBpZiAoIWNvbnQpIHJldHVybjtcclxuICBjb25zdCBzbG90cyA9IFNBTEVTX1BMQU5fRkFNSUxJQVMubWFwKF9idWlsZFNhbGVzUGxhblNsb3RIdG1sKS5qb2luKCcnKTtcclxuICBjb25zdCBpbnRybyA9XHJcbiAgICAnPGRpdiBzdHlsZT1cIm1hcmdpbi1ib3R0b206MTZweDtwYWRkaW5nOjEycHggMTRweDtiYWNrZ3JvdW5kOnZhcigtLWJnLXNlY29uZGFyeSk7Ym9yZGVyLWxlZnQ6M3B4IHNvbGlkICMwZDk0ODg7Ym9yZGVyLXJhZGl1czo2cHg7Zm9udC1zaXplOjEycHg7Y29sb3I6dmFyKC0tdGV4dC1zZWNvbmRhcnkpO2xpbmUtaGVpZ2h0OjEuNVwiPicgK1xyXG4gICAgJzxiIHN0eWxlPVwiY29sb3I6dmFyKC0tdGV4dC1wcmltYXJ5KVwiPkZhc2UgMTwvYj4gXHUyMDE0IENhcmdcdTAwRTEgbG9zIFNhbGVzIFBsYW5zIG1lbnN1YWxlcyAoUm9kcyAvIFJlZWxzKS4gU2UgcGFyc2VhIGxhIGhvamEgPGI+U0FSPC9iPjogU0tVLCBNT1EgMTIgbW9udGhzLCB5IHVuYSBjb2x1bW5hIHBvciBtZXMuICcgK1xyXG4gICAgJ0VsIEV4Y2VsIG9yaWdpbmFsIHF1ZWRhIHNuYXBzaG90YWRvIGVuIFN0b3JhZ2UgeSBlbCBwYXJzZW8gcXVlZGEgZW4gRmlyZXN0b3JlIHBhcmEgZWwgY1x1MDBFMWxjdWxvIGRlYmFqby4nICtcclxuICAgICc8L2Rpdj4nO1xyXG4gIGNvbnN0IGdyaWQgPVxyXG4gICAgJzxkaXYgc3R5bGU9XCJkaXNwbGF5OmdyaWQ7Z3JpZC10ZW1wbGF0ZS1jb2x1bW5zOnJlcGVhdChhdXRvLWZpdCxtaW5tYXgoMzIwcHgsMWZyKSk7Z2FwOjE2cHg7bWFyZ2luLWJvdHRvbToyNHB4XCI+JyArXHJcbiAgICBzbG90cyArXHJcbiAgICAnPC9kaXY+JztcclxuICAvLyB2MTEwOTogY29udGVuZWRvciBwYXJhIHRhYmxhIFJlY29tZW5kYWNpXHUwMEYzbiBkZSBDb21wcmEuIFNlIHJlbGxlbmEgb24tZGVtYW5kXHJcbiAgLy8gdmlhIF9yZW5kZXJSZWNvU2VjdGlvbigpIChsYXp5IGxvYWQgZGUgc3RvY2tfc25hcHNob3QgKyBza3VfdmVudGFzX3NuYXBzaG90KS5cclxuICBjb25zdCByZWNvU2VjdGlvbiA9ICc8ZGl2IGlkPVwicmVjby1zZWN0aW9uLWNvbnRhaW5lclwiPjwvZGl2Pic7XHJcbiAgY29udC5pbm5lckhUTUwgPSAnPGRpdiBzdHlsZT1cInBhZGRpbmc6MThweFwiPicgKyBpbnRybyArIGdyaWQgKyByZWNvU2VjdGlvbiArICc8L2Rpdj4nO1xyXG4gIF9yZW5kZXJSZWNvU2VjdGlvbigpO1xyXG59XHJcblxyXG53aW5kb3cub25TYWxlc1BsYW5GaWxlRm9yRmFtaWxpYSA9IGFzeW5jIGZ1bmN0aW9uIChldmVudCwgZmFtaWxpYSkge1xyXG4gIGNvbnN0IGZpbGUgPSBldmVudCAmJiBldmVudC50YXJnZXQgJiYgZXZlbnQudGFyZ2V0LmZpbGVzICYmIGV2ZW50LnRhcmdldC5maWxlc1swXTtcclxuICBpZiAoIWZpbGUpIHJldHVybjtcclxuICBjb25zdCBzdGF0dXNFbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdzYWxlcy1wbGFuLXN0YXR1cy0nICsgZmFtaWxpYSk7XHJcbiAgY29uc3Qgc2V0U3RhdHVzID0gKG1zZywgY29sb3IpID0+IHtcclxuICAgIGlmICghc3RhdHVzRWwpIHJldHVybjtcclxuICAgIHN0YXR1c0VsLnRleHRDb250ZW50ID0gbXNnO1xyXG4gICAgc3RhdHVzRWwuc3R5bGUuY29sb3IgPSBjb2xvciB8fCAndmFyKC0tdGV4dC1tdXRlZCknO1xyXG4gIH07XHJcbiAgdHJ5IHtcclxuICAgIGlmICh0eXBlb2YgWExTWCA9PT0gJ3VuZGVmaW5lZCcpIHtcclxuICAgICAgYWxlcnQoJ1NoZWV0SlMgKFhMU1gpIG5vIGNhcmdhZG8gXHUyMDE0IHJlY2FyZ1x1MDBFMSBsYSBhcHAuJyk7XHJcbiAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIGlmICghd2luZG93LlNhbGVzUGxhblBhcnNlciB8fCAhd2luZG93LlNhbGVzUGxhblBhcnNlci5wYXJzZVNhbGVzUGxhblNoZWV0KSB7XHJcbiAgICAgIGFsZXJ0KCdQYXJzZXIgU2FsZXMgUGxhbiBubyBjYXJnYWRvLiBSZWJ1aWxkIGJ1bmRsZS4nKTtcclxuICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG4gICAgaWYgKCF3aW5kb3cuZmlyZWJhc2UgfHwgIXdpbmRvdy5maXJlYmFzZS5zdG9yYWdlKSB7XHJcbiAgICAgIGFsZXJ0KCdGaXJlYmFzZSBTdG9yYWdlIG5vIGRpc3BvbmlibGUuJyk7XHJcbiAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIHNldFN0YXR1cygnTGV5ZW5kbyBFeGNlbFx1MjAyNicpO1xyXG4gICAgY29uc3QgYnVmID0gYXdhaXQgZmlsZS5hcnJheUJ1ZmZlcigpO1xyXG4gICAgY29uc3Qgd2IgPSBYTFNYLnJlYWQoYnVmLCB7IHR5cGU6ICdhcnJheScgfSk7XHJcbiAgICBjb25zdCBzYXJOYW1lID0gd2IuU2hlZXROYW1lcy5maW5kKFxyXG4gICAgICAobikgPT5cclxuICAgICAgICBTdHJpbmcobiB8fCAnJylcclxuICAgICAgICAgIC50cmltKClcclxuICAgICAgICAgIC50b1VwcGVyQ2FzZSgpID09PSAnU0FSJ1xyXG4gICAgKTtcclxuICAgIGlmICghc2FyTmFtZSkge1xyXG4gICAgICBzZXRTdGF0dXMoXHJcbiAgICAgICAgJ1x1MjZBMCBFbCBFeGNlbCBubyB0aWVuZSBob2phIFwiU0FSXCIuIEhvamFzIGVuY29udHJhZGFzOiAnICsgd2IuU2hlZXROYW1lcy5qb2luKCcsICcpLFxyXG4gICAgICAgICcjZGMyNjI2J1xyXG4gICAgICApO1xyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcbiAgICBjb25zdCBzaGVldCA9IHdiLlNoZWV0c1tzYXJOYW1lXTtcclxuICAgIGNvbnN0IHJvd3MgPSBYTFNYLnV0aWxzLnNoZWV0X3RvX2pzb24oc2hlZXQsIHsgaGVhZGVyOiAxLCBkZWZ2YWw6ICcnLCByYXc6IHRydWUgfSk7XHJcbiAgICBzZXRTdGF0dXMoJ1BhcnNlYW5kbyAnICsgcm93cy5sZW5ndGggKyAnIGZpbGFzIGRlIGhvamEgXCInICsgc2FyTmFtZSArICdcIlx1MjAyNicpO1xyXG4gICAgY29uc3QgcGFyc2VkID0gd2luZG93LlNhbGVzUGxhblBhcnNlci5wYXJzZVNhbGVzUGxhblNoZWV0KHJvd3MpO1xyXG4gICAgaWYgKCFwYXJzZWQucm93cy5sZW5ndGgpIHtcclxuICAgICAgc2V0U3RhdHVzKCdcdTI2QTAgRXhjZWwgcGFyc2VhZG8gcGVybyBzaW4gU0tVcyB2XHUwMEUxbGlkb3MuJywgJyNkYzI2MjYnKTtcclxuICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG4gICAgY29uc3QgeWVhck1vbnRoID0gX3llYXJNb250aE5vdygpO1xyXG4gICAgY29uc3Qgc3RvcmFnZVBhdGggPSAnZm9yZWNhc3RzX3NuYXBzaG90cy8nICsgeWVhck1vbnRoICsgJy8nICsgZmFtaWxpYSArICcueGxzeCc7XHJcbiAgICBzZXRTdGF0dXMoJ1N1YmllbmRvIEV4Y2VsIGEgU3RvcmFnZSAoJyArIF9mbXRTaXplKGZpbGUuc2l6ZSkgKyAnKVx1MjAyNicpO1xyXG4gICAgY29uc3Qgc3RvcmFnZVJlZiA9IHdpbmRvdy5maXJlYmFzZS5zdG9yYWdlKCkucmVmKHN0b3JhZ2VQYXRoKTtcclxuICAgIGF3YWl0IHN0b3JhZ2VSZWYucHV0KGZpbGUsIHtcclxuICAgICAgY29udGVudFR5cGU6IGZpbGUudHlwZSB8fCAnYXBwbGljYXRpb24vdm5kLm9wZW54bWxmb3JtYXRzLW9mZmljZWRvY3VtZW50LnNwcmVhZHNoZWV0bWwuc2hlZXQnLFxyXG4gICAgICBjdXN0b21NZXRhZGF0YToge1xyXG4gICAgICAgIGZhbWlsaWEsXHJcbiAgICAgICAgdXBsb2FkZWRCeTogKHdpbmRvdy5jdXJyZW50VXNlciAmJiB3aW5kb3cuY3VycmVudFVzZXIuZW1haWwpIHx8ICcnLFxyXG4gICAgICAgIHNvdXJjZUZpbGVuYW1lOiBmaWxlLm5hbWUgfHwgJycsXHJcbiAgICAgIH0sXHJcbiAgICB9KTtcclxuICAgIHNldFN0YXR1cygnR3VhcmRhbmRvIHBhcnNlbyBlbiBGaXJlc3RvcmUgKCcgKyBwYXJzZWQucm93cy5sZW5ndGggKyAnIFNLVXMpXHUyMDI2Jyk7XHJcbiAgICBjb25zdCB1cGxvYWRlZEJ5ID0gKHdpbmRvdy5jdXJyZW50VXNlciAmJiB3aW5kb3cuY3VycmVudFVzZXIuZW1haWwpIHx8ICd1bmtub3duJztcclxuICAgIGNvbnN0IHBheWxvYWQgPSB7XHJcbiAgICAgIGZhbWlsaWEsXHJcbiAgICAgIHBhcnNlZEF0OlxyXG4gICAgICAgIHdpbmRvdy5maXJlYmFzZSAmJiB3aW5kb3cuZmlyZWJhc2UuZmlyZXN0b3JlICYmIHdpbmRvdy5maXJlYmFzZS5maXJlc3RvcmUuRmllbGRWYWx1ZVxyXG4gICAgICAgICAgPyB3aW5kb3cuZmlyZWJhc2UuZmlyZXN0b3JlLkZpZWxkVmFsdWUuc2VydmVyVGltZXN0YW1wKClcclxuICAgICAgICAgIDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxyXG4gICAgICB1cGxvYWRlZEJ5LFxyXG4gICAgICBzb3VyY2VGaWxlbmFtZTogZmlsZS5uYW1lIHx8ICcnLFxyXG4gICAgICBzb3VyY2VTaGVldDogc2FyTmFtZSxcclxuICAgICAgeWVhck1vbnRoLFxyXG4gICAgICBzdG9yYWdlUGF0aCxcclxuICAgICAgcm93c0NvdW50OiBwYXJzZWQucm93cy5sZW5ndGgsXHJcbiAgICAgIGhlYWRlclJvd0luZGV4OiBwYXJzZWQuaGVhZGVyUm93SW5kZXgsXHJcbiAgICAgIGRldGVjdGVkTW9udGhzOiBwYXJzZWQuZGV0ZWN0ZWRNb250aHMsXHJcbiAgICAgIHJvd3M6IHBhcnNlZC5yb3dzLFxyXG4gICAgfTtcclxuICAgIGF3YWl0IHdpbmRvdy5mYkRiLmNvbGxlY3Rpb24oJ3NhbGVzX3BsYW5fY2FjaGUnKS5kb2MoZmFtaWxpYSkuc2V0KHBheWxvYWQpO1xyXG4gICAgLy8gdjExMDcgZml4OiBndWFyZGFyIGNhY2hlIGxvY2FsIGNvbiBEYXRlIHJlYWwgKG5vIGVsIFNlbnRpbmVsVmFsdWUpIHBhcmFcclxuICAgIC8vIHF1ZSBfZm10RGF0ZVNob3J0IG5vIG11ZXN0cmUgXCJJbnZhbGlkIERhdGVcIi4gRWwgc2VydmVyIHRpZW5lIGVsIHRzIGV4YWN0byxcclxuICAgIC8vIGVsIGxvY2FsIG11ZXN0cmEgZWwgbW9tZW50byBkZWwgdXBsb2FkIChhcHJveGltYWRvIH4xcyBkZSBkaWZlcmVuY2lhKS5cclxuICAgIF9zYWxlc1BsYW5DYWNoZXNbZmFtaWxpYV0gPSBPYmplY3QuYXNzaWduKHt9LCBwYXlsb2FkLCB7IHBhcnNlZEF0OiBuZXcgRGF0ZSgpIH0pO1xyXG4gICAgc2V0U3RhdHVzKFxyXG4gICAgICAnXHUyNzEzIE9LLiAnICsgcGFyc2VkLnJvd3MubGVuZ3RoICsgJyBTS1VzIFx1MDBENyAnICsgcGFyc2VkLmRldGVjdGVkTW9udGhzLmxlbmd0aCArICcgbWVzZXMuJyxcclxuICAgICAgJyMxNmEzNGEnXHJcbiAgICApO1xyXG4gICAgX3JlbmRlclNhbGVzUGxhbnNUYWIoKTtcclxuICB9IGNhdGNoIChlKSB7XHJcbiAgICBjb25zb2xlLmVycm9yKCdbRk9SRUNBU1RdIHVwbG9hZCBzYWxlcyBwbGFuICcgKyBmYW1pbGlhICsgJyBmYWlsOicsIGUpO1xyXG4gICAgc2V0U3RhdHVzKCdcdTI3MTcgRXJyb3I6ICcgKyAoKGUgJiYgZS5tZXNzYWdlKSB8fCBlKSwgJyNkYzI2MjYnKTtcclxuICAgIGlmIChlICYmIGUuY29kZSA9PT0gJ01PTlRIU19OT1RfRk9VTkQnKSB7XHJcbiAgICAgIGFsZXJ0KFxyXG4gICAgICAgICdFbCBFeGNlbCBubyB0aWVuZSBjb2x1bW5hcyBkZSBtZXNlcyByZWNvbm9jaWJsZXMuXFxuXFxuSGVhZGVycyBlc3BlcmFkb3M6IFwiSmFuIDIwMjdcIiwgXCJNYXkgMjAyN1wiLCBcIkVuZSAyMDI3XCIsIFwiMjAyNy0wMVwiLCBldGMuXFxuXFxuRGV0YWxsZTogJyArXHJcbiAgICAgICAgICBlLm1lc3NhZ2VcclxuICAgICAgKTtcclxuICAgIH1cclxuICB9IGZpbmFsbHkge1xyXG4gICAgaWYgKGV2ZW50ICYmIGV2ZW50LnRhcmdldCkgZXZlbnQudGFyZ2V0LnZhbHVlID0gJyc7XHJcbiAgfVxyXG59O1xyXG5cclxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcbi8vIEYyQiBcdTIwMTQgRm9yZWNhc3QgRXN0YWRcdTAwRURzdGljbzogdGFibGEgKyBkZXRhbGxlXHJcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cclxuYXN5bmMgZnVuY3Rpb24gX2xvYWRGb3JlY2FzdE91dHB1dCgpIHtcclxuICBpZiAoIXdpbmRvdy5mYkRiKSB0aHJvdyBuZXcgRXJyb3IoJ0ZpcmVzdG9yZSBubyBpbmljaWFsaXphZG8nKTtcclxuICBjb25zb2xlLmxvZygnW0ZPUkVDQVNUIHN0YXRdIGxvYWRpbmcgZm9yZWNhc3Rfb3V0cHV0Li4uJyk7XHJcbiAgY29uc3QgW3NuYXAsIG1ldGFEb2NdID0gYXdhaXQgUHJvbWlzZS5hbGwoW1xyXG4gICAgd2luZG93LmZiRGIuY29sbGVjdGlvbignZm9yZWNhc3Rfb3V0cHV0JykuZ2V0KCksXHJcbiAgICB3aW5kb3cuZmJEYi5jb2xsZWN0aW9uKCdmb3JlY2FzdF9vdXRwdXRfbWV0YScpLmRvYygnY3VycmVudCcpLmdldCgpLFxyXG4gIF0pO1xyXG4gIGNvbnN0IGRvY3MgPSBbXTtcclxuICBzbmFwLmZvckVhY2goKGQpID0+IGRvY3MucHVzaChPYmplY3QuYXNzaWduKHsgaWQ6IGQuaWQgfSwgZC5kYXRhKCkpKSk7XHJcbiAgZG9jcy5zb3J0KChhLCBiKSA9PiB7XHJcbiAgICBjb25zdCB3YSA9IChhLm1ldHJpY3MgJiYgYS5tZXRyaWNzLndhcGUpIHx8IDk5OTtcclxuICAgIGNvbnN0IHdiID0gKGIubWV0cmljcyAmJiBiLm1ldHJpY3Mud2FwZSkgfHwgOTk5O1xyXG4gICAgcmV0dXJuIHdhIC0gd2I7XHJcbiAgfSk7XHJcbiAgX2ZvcmVjYXN0U3RhdERvY3MgPSBkb2NzO1xyXG4gIF9mb3JlY2FzdFN0YXRNZXRhID0gbWV0YURvYy5leGlzdHMgPyBtZXRhRG9jLmRhdGEoKSA6IG51bGw7XHJcbiAgY29uc29sZS5sb2coJ1tGT1JFQ0FTVCBzdGF0XSBsb2FkZWQnLCBkb2NzLmxlbmd0aCwgJ2RvY3MgXHUwMEI3IG1ldGE6JywgISFfZm9yZWNhc3RTdGF0TWV0YSk7XHJcbiAgcmV0dXJuIGRvY3M7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIF93YXBlQmFkZ2VDb2xvcih3KSB7XHJcbiAgaWYgKHcgPT0gbnVsbCkgcmV0dXJuICcjNjQ3NDhiJztcclxuICBpZiAodyA8IDAuMykgcmV0dXJuICcjMTZhMzRhJzsgLy8gdmVyZGUgLSBleGNlbGVudGVcclxuICBpZiAodyA8IDAuNSkgcmV0dXJuICcjODRjYzE2JzsgLy8gbGltYSAtIGJ1ZW5vXHJcbiAgaWYgKHcgPCAwLjcpIHJldHVybiAnI2VhYjMwOCc7IC8vIGFtYXJpbGxvIC0gYWNlcHRhYmxlXHJcbiAgaWYgKHcgPCAxLjApIHJldHVybiAnI2Y5NzMxNic7IC8vIG5hcmFuamEgLSBwb2JyZVxyXG4gIHJldHVybiAnI2RjMjYyNic7IC8vIHJvam8gLSBtdXkgcG9icmVcclxufVxyXG5cclxuZnVuY3Rpb24gX2ZtdE51bShuKSB7XHJcbiAgaWYgKG4gPT0gbnVsbCB8fCAhTnVtYmVyLmlzRmluaXRlKE51bWJlcihuKSkpIHJldHVybiAnXHUyMDE0JztcclxuICByZXR1cm4gTnVtYmVyKG4pLnRvTG9jYWxlU3RyaW5nKCdlcy1BUicsIHsgbWF4aW11bUZyYWN0aW9uRGlnaXRzOiAwIH0pO1xyXG59XHJcblxyXG5mdW5jdGlvbiBfZm10V2FwZSh3KSB7XHJcbiAgaWYgKHcgPT0gbnVsbCB8fCAhTnVtYmVyLmlzRmluaXRlKE51bWJlcih3KSkpIHJldHVybiAnXHUyMDE0JztcclxuICByZXR1cm4gKE51bWJlcih3KSAqIDEwMCkudG9GaXhlZCgwKSArICclJztcclxufVxyXG5cclxuZnVuY3Rpb24gX2ZtdERzU2hvcnQoaXNvKSB7XHJcbiAgLy8gJzIwMjYtMTAtMDEnIC0+ICdvY3QgMjYnXHJcbiAgdHJ5IHtcclxuICAgIGNvbnN0IFt5LCBtXSA9IGlzby5zcGxpdCgnLScpLm1hcChOdW1iZXIpO1xyXG4gICAgY29uc3QgbmFtZXMgPSBbXHJcbiAgICAgICdlbmUnLFxyXG4gICAgICAnZmViJyxcclxuICAgICAgJ21hcicsXHJcbiAgICAgICdhYnInLFxyXG4gICAgICAnbWF5JyxcclxuICAgICAgJ2p1bicsXHJcbiAgICAgICdqdWwnLFxyXG4gICAgICAnYWdvJyxcclxuICAgICAgJ3NlcCcsXHJcbiAgICAgICdvY3QnLFxyXG4gICAgICAnbm92JyxcclxuICAgICAgJ2RpYycsXHJcbiAgICBdO1xyXG4gICAgcmV0dXJuIG5hbWVzW20gLSAxXSArICcgJyArIFN0cmluZyh5KS5zbGljZSgtMik7XHJcbiAgfSBjYXRjaCB7XHJcbiAgICByZXR1cm4gaXNvO1xyXG4gIH1cclxufVxyXG5cclxuZnVuY3Rpb24gX3JlbmRlckZvcmVjYXN0U3RhdFRhYigpIHtcclxuICBjb25zdCBjb250ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2ZvcmVjYXN0LXRhYi1zdGF0Jyk7XHJcbiAgaWYgKCFjb250KSByZXR1cm47XHJcbiAgdHJ5IHtcclxuICAgIF9yZW5kZXJGb3JlY2FzdFN0YXRUYWJJbXBsKGNvbnQpO1xyXG4gIH0gY2F0Y2ggKGUpIHtcclxuICAgIGNvbnNvbGUuZXJyb3IoJ1tGT1JFQ0FTVCBzdGF0XSByZW5kZXIgZmFpbCcsIGUpO1xyXG4gICAgY29udC5pbm5lckhUTUwgPVxyXG4gICAgICAnPGRpdiBzdHlsZT1cInBhZGRpbmc6NDBweCAyMHB4O2NvbG9yOiNkYzI2MjY7bGluZS1oZWlnaHQ6MS42XCI+JyArXHJcbiAgICAgICc8ZGl2IHN0eWxlPVwiZm9udC1zaXplOjE2cHg7Zm9udC13ZWlnaHQ6NzAwO21hcmdpbi1ib3R0b206MTBweFwiPkVycm9yIHJlbmRlcml6YW5kbyB0YWIgRm9yZWNhc3QgRXN0YWRcdTAwRURzdGljbzwvZGl2PicgK1xyXG4gICAgICAnPHByZSBzdHlsZT1cImZvbnQtc2l6ZToxMXB4O2JhY2tncm91bmQ6I2ZlZjJmMjtwYWRkaW5nOjEycHg7Ym9yZGVyLXJhZGl1czo2cHg7b3ZlcmZsb3c6YXV0bzt3aGl0ZS1zcGFjZTpwcmUtd3JhcFwiPicgK1xyXG4gICAgICBlc2NhcGVIdG1sU2FmZShlLnN0YWNrIHx8IGUubWVzc2FnZSB8fCBTdHJpbmcoZSkpICtcclxuICAgICAgJzwvcHJlPjwvZGl2Pic7XHJcbiAgfVxyXG59XHJcblxyXG5mdW5jdGlvbiBfcmVuZGVyRm9yZWNhc3RTdGF0VGFiSW1wbChjb250KSB7XHJcbiAgY29uc3QgZG9jcyA9IF9mb3JlY2FzdFN0YXREb2NzIHx8IFtdO1xyXG4gIGNvbnN0IG1ldGEgPSBfZm9yZWNhc3RTdGF0TWV0YSB8fCB7fTtcclxuICBjb25zdCByZXN1bWVuID0gbWV0YS5yZXN1bWVuIHx8IHt9O1xyXG4gIGNvbnNvbGUubG9nKCdbRk9SRUNBU1Qgc3RhdF0gcmVuZGVyIFx1MjAxNCBkb2NzOicsIGRvY3MubGVuZ3RoLCAnbWV0YTonLCAhIW1ldGEuZ2VuZXJhdGVkQXQpO1xyXG4gIGlmICghZG9jcy5sZW5ndGgpIHtcclxuICAgIGNvbnQuaW5uZXJIVE1MID1cclxuICAgICAgJzxkaXYgc3R5bGU9XCJwYWRkaW5nOjYwcHggMjBweDt0ZXh0LWFsaWduOmNlbnRlcjtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKVwiPicgK1xyXG4gICAgICAnTm8gaGF5IGZvcmVjYXN0X291dHB1dCBwdWJsaWNhZG8uPGJyPjxicj4nICtcclxuICAgICAgJ0NvcnJlciA8Y29kZT5weXRob24gc2NyaXB0cy9mb3JlY2FzdC90cmFpbl9wcm9kLnB5ICYmIHB5dGhvbiBzY3JpcHRzL2ZvcmVjYXN0L3B1Ymxpc2hfdG9fZmlyZXN0b3JlLnB5PC9jb2RlPi4nICtcclxuICAgICAgJzwvZGl2Pic7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIC8vIE1lc2VzIGRlbCBmb3JlY2FzdCAoZHMgZGVsIHByaW1lciBkb2MsIHNlIGFzdW1lIGlndWFsIGVuIHRvZG9zKS5cclxuICBjb25zdCBtb250aHNJc28gPSAoZG9jc1swXS5mb3JlY2FzdCB8fCBbXSkubWFwKChmKSA9PiBmLmRzKTtcclxuICBjb25zdCBtb250aEhlYWRlcnMgPSBtb250aHNJc28ubWFwKF9mbXREc1Nob3J0KTtcclxuXHJcbiAgLy8gTWV0cmljcyBjaGlwIGdsb2JhbFxyXG4gIGNvbnN0IGdlbmVyYXRlZCA9IG1ldGEuZ2VuZXJhdGVkQXRcclxuICAgID8gbmV3IERhdGUobWV0YS5nZW5lcmF0ZWRBdCkudG9Mb2NhbGVTdHJpbmcoJ2VzLUFSJywge1xyXG4gICAgICAgIGRheTogJzItZGlnaXQnLFxyXG4gICAgICAgIG1vbnRoOiAnc2hvcnQnLFxyXG4gICAgICAgIHllYXI6ICcyLWRpZ2l0JyxcclxuICAgICAgICBob3VyOiAnMi1kaWdpdCcsXHJcbiAgICAgICAgbWludXRlOiAnMi1kaWdpdCcsXHJcbiAgICAgIH0pXHJcbiAgICA6ICdcdTIwMTQnO1xyXG4gIGNvbnN0IHdhcGVNZWQgPVxyXG4gICAgcmVzdW1lbi53YXBlX21lZGlhbm9fYmVzdF9wZXJfc2VyaWVzICE9IG51bGxcclxuICAgICAgPyBfZm10V2FwZShyZXN1bWVuLndhcGVfbWVkaWFub19iZXN0X3Blcl9zZXJpZXMpXHJcbiAgICAgIDogJ1x1MjAxNCc7XHJcbiAgY29uc3QgblN1YnMgPSByZXN1bWVuLm5fc3ViZmFtaWxpYXMgfHwgZG9jcy5sZW5ndGg7XHJcbiAgY29uc3Qgbkx0MDUgPVxyXG4gICAgcmVzdW1lbi5uX3Nlcmllc193YXBlX2x0XzBfNSAhPSBudWxsID8gcmVzdW1lbi5uX3Nlcmllc193YXBlX2x0XzBfNSArICcvJyArIG5TdWJzIDogJ1x1MjAxNCc7XHJcbiAgY29uc3Qgbkx0MDMgPVxyXG4gICAgcmVzdW1lbi5uX3Nlcmllc193YXBlX2x0XzBfMyAhPSBudWxsID8gcmVzdW1lbi5uX3Nlcmllc193YXBlX2x0XzBfMyArICcvJyArIG5TdWJzIDogJ1x1MjAxNCc7XHJcblxyXG4gIGNvbnN0IGJhbm5lciA9XHJcbiAgICAnPGRpdiBzdHlsZT1cIm1hcmdpbi1ib3R0b206MTRweDtwYWRkaW5nOjEycHggMTRweDtiYWNrZ3JvdW5kOnZhcigtLWJnLXNlY29uZGFyeSk7Ym9yZGVyLWxlZnQ6M3B4IHNvbGlkICMwZDk0ODg7Ym9yZGVyLXJhZGl1czo2cHg7Zm9udC1zaXplOjEycHg7Y29sb3I6dmFyKC0tdGV4dC1zZWNvbmRhcnkpO2xpbmUtaGVpZ2h0OjEuNTtkaXNwbGF5OmdyaWQ7Z3JpZC10ZW1wbGF0ZS1jb2x1bW5zOnJlcGVhdChhdXRvLWZpdCxtaW5tYXgoMTYwcHgsMWZyKSk7Z2FwOjEwcHhcIj4nICtcclxuICAgICc8ZGl2PjxkaXYgc3R5bGU9XCJmb250LXNpemU6MTBweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7bGV0dGVyLXNwYWNpbmc6LjRweFwiPldBUEUgbWVkaWFubzwvZGl2PjxkaXYgc3R5bGU9XCJmb250LXNpemU6MjBweDtmb250LXdlaWdodDo4MDA7Y29sb3I6dmFyKC0tdGV4dC1wcmltYXJ5KVwiPicgK1xyXG4gICAgd2FwZU1lZCArXHJcbiAgICAnPC9kaXY+PC9kaXY+JyArXHJcbiAgICAnPGRpdj48ZGl2IHN0eWxlPVwiZm9udC1zaXplOjEwcHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO2xldHRlci1zcGFjaW5nOi40cHhcIj5TdWJmYW1pbGlhczwvZGl2PjxkaXYgc3R5bGU9XCJmb250LXNpemU6MjBweDtmb250LXdlaWdodDo4MDA7Y29sb3I6dmFyKC0tdGV4dC1wcmltYXJ5KVwiPicgK1xyXG4gICAgblN1YnMgK1xyXG4gICAgJzwvZGl2PjwvZGl2PicgK1xyXG4gICAgJzxkaXY+PGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMHB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtsZXR0ZXItc3BhY2luZzouNHB4XCI+V0FQRSAmbHQ7IDMwJSAoZXhjZWxlbnRlKTwvZGl2PjxkaXYgc3R5bGU9XCJmb250LXNpemU6MjBweDtmb250LXdlaWdodDo4MDA7Y29sb3I6IzE2YTM0YVwiPicgK1xyXG4gICAgbkx0MDMgK1xyXG4gICAgJzwvZGl2PjwvZGl2PicgK1xyXG4gICAgJzxkaXY+PGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMHB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtsZXR0ZXItc3BhY2luZzouNHB4XCI+V0FQRSAmbHQ7IDUwJSAoYnVlbm8pPC9kaXY+PGRpdiBzdHlsZT1cImZvbnQtc2l6ZToyMHB4O2ZvbnQtd2VpZ2h0OjgwMDtjb2xvcjojODRjYzE2XCI+JyArXHJcbiAgICBuTHQwNSArXHJcbiAgICAnPC9kaXY+PC9kaXY+JyArXHJcbiAgICAnPGRpdj48ZGl2IHN0eWxlPVwiZm9udC1zaXplOjEwcHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO2xldHRlci1zcGFjaW5nOi40cHhcIj5cdTAwREFsdGltYSBjb3JyaWRhPC9kaXY+PGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxM3B4O2ZvbnQtd2VpZ2h0OjYwMDtjb2xvcjp2YXIoLS10ZXh0LXByaW1hcnkpO21hcmdpbi10b3A6NHB4XCI+JyArXHJcbiAgICBlc2NhcGVIdG1sU2FmZShnZW5lcmF0ZWQpICtcclxuICAgICc8L2Rpdj48L2Rpdj4nICtcclxuICAgICc8L2Rpdj4nO1xyXG5cclxuICAvLyBUYWJsYSByb3dzXHJcbiAgY29uc3Qgcm93c0h0bWwgPSBkb2NzXHJcbiAgICAubWFwKChkKSA9PiB7XHJcbiAgICAgIGNvbnN0IHdhcGUgPSBkLm1ldHJpY3MgJiYgZC5tZXRyaWNzLndhcGUgIT0gbnVsbCA/IGQubWV0cmljcy53YXBlIDogbnVsbDtcclxuICAgICAgY29uc3QgYmVzdE1vZGVsID0gZC5iZXN0TW9kZWwgfHwgJ1x1MjAxNCc7XHJcbiAgICAgIGNvbnN0IGZvcmVjYXN0TWFwID0ge307XHJcbiAgICAgIChkLmZvcmVjYXN0IHx8IFtdKS5mb3JFYWNoKChmKSA9PiB7XHJcbiAgICAgICAgZm9yZWNhc3RNYXBbZi5kc10gPSBmLnlfaGF0O1xyXG4gICAgICB9KTtcclxuICAgICAgY29uc3QgbW9udGhDZWxscyA9IG1vbnRoc0lzb1xyXG4gICAgICAgIC5tYXAoXHJcbiAgICAgICAgICAoZHMpID0+XHJcbiAgICAgICAgICAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjhweCAxMHB4O3RleHQtYWxpZ246cmlnaHQ7Zm9udC12YXJpYW50LW51bWVyaWM6dGFidWxhci1udW1zO2ZvbnQtd2VpZ2h0OjYwMDtjb2xvcjp2YXIoLS10ZXh0LXByaW1hcnkpXCI+JyArXHJcbiAgICAgICAgICAgIF9mbXROdW0oZm9yZWNhc3RNYXBbZHNdKSArXHJcbiAgICAgICAgICAgICc8L3RkPidcclxuICAgICAgICApXHJcbiAgICAgICAgLmpvaW4oJycpO1xyXG4gICAgICBjb25zdCB0b3RhbDcgPSAoZC5mb3JlY2FzdCB8fCBbXSkucmVkdWNlKChzLCBmKSA9PiBzICsgKE51bWJlcihmLnlfaGF0KSB8fCAwKSwgMCk7XHJcbiAgICAgIHJldHVybiAoXHJcbiAgICAgICAgJzx0ciBvbmNsaWNrPVwib3BlbkZvcmVjYXN0U3RhdERldGFpbChcXCcnICtcclxuICAgICAgICBlc2NhcGVIdG1sU2FmZShkLmlkKSArXHJcbiAgICAgICAgJ1xcJylcIiBzdHlsZT1cImN1cnNvcjpwb2ludGVyO2JvcmRlci1ib3R0b206MXB4IHNvbGlkIHZhcigtLWJvcmRlci1zdWJ0bGUpXCIgb25tb3VzZW92ZXI9XCJ0aGlzLnN0eWxlLmJhY2tncm91bmQ9XFwndmFyKC0tYmctc2Vjb25kYXJ5KVxcJ1wiIG9ubW91c2VvdXQ9XCJ0aGlzLnN0eWxlLmJhY2tncm91bmQ9XFwndHJhbnNwYXJlbnRcXCdcIj4nICtcclxuICAgICAgICAnPHRkIHN0eWxlPVwicGFkZGluZzo4cHggMTBweDtmb250LXdlaWdodDo3MDA7Y29sb3I6dmFyKC0tdGV4dC1wcmltYXJ5KVwiPicgK1xyXG4gICAgICAgIGVzY2FwZUh0bWxTYWZlKGQuc3ViZmFtaWxpYSB8fCBkLmlkKSArXHJcbiAgICAgICAgJzwvdGQ+JyArXHJcbiAgICAgICAgJzx0ZCBzdHlsZT1cInBhZGRpbmc6OHB4IDEwcHg7Zm9udC1zaXplOjExcHg7Y29sb3I6dmFyKC0tdGV4dC1zZWNvbmRhcnkpXCI+JyArXHJcbiAgICAgICAgZXNjYXBlSHRtbFNhZmUoYmVzdE1vZGVsKSArXHJcbiAgICAgICAgJzwvdGQ+JyArXHJcbiAgICAgICAgJzx0ZCBzdHlsZT1cInBhZGRpbmc6OHB4IDEwcHg7dGV4dC1hbGlnbjpjZW50ZXJcIj48c3BhbiBzdHlsZT1cImRpc3BsYXk6aW5saW5lLWJsb2NrO3BhZGRpbmc6M3B4IDhweDtib3JkZXItcmFkaXVzOjEycHg7YmFja2dyb3VuZDonICtcclxuICAgICAgICBfd2FwZUJhZGdlQ29sb3Iod2FwZSkgK1xyXG4gICAgICAgICc7Y29sb3I6I2ZmZjtmb250LXNpemU6MTFweDtmb250LXdlaWdodDo3MDBcIj4nICtcclxuICAgICAgICBfZm10V2FwZSh3YXBlKSArXHJcbiAgICAgICAgJzwvc3Bhbj48L3RkPicgK1xyXG4gICAgICAgIG1vbnRoQ2VsbHMgK1xyXG4gICAgICAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjhweCAxMHB4O3RleHQtYWxpZ246cmlnaHQ7Zm9udC12YXJpYW50LW51bWVyaWM6dGFidWxhci1udW1zO2ZvbnQtd2VpZ2h0OjcwMDtjb2xvcjojMGQ5NDg4O2JhY2tncm91bmQ6dmFyKC0tYmctc2Vjb25kYXJ5KVwiPicgK1xyXG4gICAgICAgIF9mbXROdW0odG90YWw3KSArXHJcbiAgICAgICAgJzwvdGQ+JyArXHJcbiAgICAgICAgJzwvdHI+J1xyXG4gICAgICApO1xyXG4gICAgfSlcclxuICAgIC5qb2luKCcnKTtcclxuXHJcbiAgY29uc3QgbW9udGhIZWFkZXJzSHRtbCA9IG1vbnRoSGVhZGVyc1xyXG4gICAgLm1hcChcclxuICAgICAgKG0pID0+XHJcbiAgICAgICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6OHB4IDEwcHg7dGV4dC1hbGlnbjpyaWdodDtmb250LXNpemU6MTBweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7bGV0dGVyLXNwYWNpbmc6LjRweDtjb2xvcjojOTRhM2I4XCI+JyArXHJcbiAgICAgICAgZXNjYXBlSHRtbFNhZmUobSkgK1xyXG4gICAgICAgICc8L3RoPidcclxuICAgIClcclxuICAgIC5qb2luKCcnKTtcclxuXHJcbiAgY29uc3QgdGFibGUgPVxyXG4gICAgJzxkaXYgc3R5bGU9XCJvdmVyZmxvdzphdXRvO2JvcmRlcjoxcHggc29saWQgdmFyKC0tYm9yZGVyLXN1YnRsZSk7Ym9yZGVyLXJhZGl1czo4cHhcIj4nICtcclxuICAgICc8dGFibGUgc3R5bGU9XCJ3aWR0aDoxMDAlO2JvcmRlci1jb2xsYXBzZTpjb2xsYXBzZTtmb250LXNpemU6MTJweFwiPicgK1xyXG4gICAgJzx0aGVhZCBzdHlsZT1cImJhY2tncm91bmQ6IzBmMTcyYTtjb2xvcjojZmZmXCI+PHRyPicgK1xyXG4gICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6OHB4IDEwcHg7dGV4dC1hbGlnbjpsZWZ0O2ZvbnQtc2l6ZToxMHB4O3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtsZXR0ZXItc3BhY2luZzouNHB4XCI+U3ViZmFtaWxpYTwvdGg+JyArXHJcbiAgICAnPHRoIHN0eWxlPVwicGFkZGluZzo4cHggMTBweDt0ZXh0LWFsaWduOmxlZnQ7Zm9udC1zaXplOjEwcHg7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO2xldHRlci1zcGFjaW5nOi40cHhcIj5Nb2RlbG88L3RoPicgK1xyXG4gICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6OHB4IDEwcHg7dGV4dC1hbGlnbjpjZW50ZXI7Zm9udC1zaXplOjEwcHg7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO2xldHRlci1zcGFjaW5nOi40cHhcIj5XQVBFPC90aD4nICtcclxuICAgIG1vbnRoSGVhZGVyc0h0bWwgK1xyXG4gICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6OHB4IDEwcHg7dGV4dC1hbGlnbjpyaWdodDtmb250LXNpemU6MTBweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7bGV0dGVyLXNwYWNpbmc6LjRweDtiYWNrZ3JvdW5kOiMxMzRlNGFcIj5Ub3RhbCA3bTwvdGg+JyArXHJcbiAgICAnPC90cj48L3RoZWFkPicgK1xyXG4gICAgJzx0Ym9keT4nICtcclxuICAgIHJvd3NIdG1sICtcclxuICAgICc8L3Rib2R5PjwvdGFibGU+PC9kaXY+JztcclxuXHJcbiAgY29uc3QgZm9vdGVyID1cclxuICAgICc8ZGl2IHN0eWxlPVwibWFyZ2luLXRvcDoxMnB4O2ZvbnQtc2l6ZToxMXB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO2xpbmUtaGVpZ2h0OjEuNVwiPicgK1xyXG4gICAgJzxiPkNcdTAwRjNtbyBsZWVyPC9iPjogV0FQRSAoV2VpZ2h0ZWQgQWJzb2x1dGUgUGVyY2VudGFnZSBFcnJvcikgbWlkZSBlbCBlcnJvciBkZWwgbW9kZWxvIHJlbGF0aXZvIGFsIHRvdGFsIHJlYWw6ICZsdDszMCUgZXhjZWxlbnRlLCAzMC01MCUgYnVlbm8sIDUwLTcwJSBhY2VwdGFibGUsICZndDs3MCUgcG9icmUuIENsaWNrIGVuIGZpbGEgcGFyYSBkZXRhbGxlICsgZ3JcdTAwRTFmaWNvLiAnICtcclxuICAgICdTZSBlbGlnZSBlbCBtb2RlbG8gY29uIG1lbm9yIFdBUEUgcG9yIHNlcmllIHRyYXMgYmFja3Rlc3Qgcm9sbGluZy1vcmlnaW4gKGg9MiwgdmVudGFuYXM9MykuJyArXHJcbiAgICAnPC9kaXY+JztcclxuXHJcbiAgY29udC5pbm5lckhUTUwgPSAnPGRpdiBzdHlsZT1cInBhZGRpbmc6MThweFwiPicgKyBiYW5uZXIgKyB0YWJsZSArIGZvb3RlciArICc8L2Rpdj4nO1xyXG59XHJcblxyXG4vLyBDYWNoZSBoaXN0b3JpYSBhZ3JlZ2FkYSBwb3Igc3ViZmFtaWxpYSAocGFyYSBnclx1MDBFMWZpY28gZGV0YWxsZSkuXHJcbmFzeW5jIGZ1bmN0aW9uIF9sb2FkRm9yZWNhc3RTdGF0SGlzdG9yeSgpIHtcclxuICBpZiAoX2ZvcmVjYXN0U3RhdEhpc3RvcnlDYWNoZSkgcmV0dXJuIF9mb3JlY2FzdFN0YXRIaXN0b3J5Q2FjaGU7XHJcbiAgLy8gTGEgaGlzdG9yaWEgc29sbyBlc3RcdTAwRTEgZW4gQlEgKH4xMCBhXHUwMEYxb3MgQmFyYWxkbyArIDEyIG1lc2VzIFNoaW1hbm8pLiBDb21vXHJcbiAgLy8gZWwgcGlwZWxpbmUgbGEgZXNjcmliZSBhIENTViBsb2NhbCwgYWNcdTAwRTEgbm8gbGEgcG9kZW1vcyBsZWVyLiBBbHRlcm5hdGl2YTpcclxuICAvLyB1c2FyIHNrdV92ZW50YXNfc25hcHNob3QgcXVlIHRpZW5lIHZlbnRhcyBtZW5zdWFsZXMgcGVybyBzb2xvIGdydXBvIFBFU0NBLlxyXG4gIC8vIEVuIEYyQi4yIHNvbG8gbW9zdHJhbW9zIGZvcmVjYXN0K0lDIChzaW4gb3ZlcmxheSBoaXN0b3JpYSBwb3IgYWhvcmEpLlxyXG4gIF9mb3JlY2FzdFN0YXRIaXN0b3J5Q2FjaGUgPSB7fTtcclxuICByZXR1cm4gX2ZvcmVjYXN0U3RhdEhpc3RvcnlDYWNoZTtcclxufVxyXG5cclxuZnVuY3Rpb24gX2J1aWxkRm9yZWNhc3RDaGFydFN2Zyhkb2MpIHtcclxuICBjb25zdCBmYyA9IGRvYy5mb3JlY2FzdCB8fCBbXTtcclxuICBpZiAoIWZjLmxlbmd0aClcclxuICAgIHJldHVybiAnPGRpdiBzdHlsZT1cInBhZGRpbmc6MzBweDt0ZXh0LWFsaWduOmNlbnRlcjtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKVwiPlNpbiBkYXRvcyBkZSBmb3JlY2FzdDwvZGl2Pic7XHJcbiAgLy8gRGltZW5zaW9uZXNcclxuICBjb25zdCBXID0gNjQwLFxyXG4gICAgSCA9IDI2MDtcclxuICBjb25zdCBwYWRMID0gNTAsXHJcbiAgICBwYWRSID0gMjAsXHJcbiAgICBwYWRUID0gMjAsXHJcbiAgICBwYWRCID0gNDA7XHJcbiAgY29uc3QgaW5uZXJXID0gVyAtIHBhZEwgLSBwYWRSO1xyXG4gIGNvbnN0IGlubmVySCA9IEggLSBwYWRUIC0gcGFkQjtcclxuXHJcbiAgLy8gWSByYW5nZTogbWF4KGhpODApICogMS4xXHJcbiAgY29uc3QgbWF4WSA9IE1hdGgubWF4KDEsIC4uLmZjLm1hcCgoZikgPT4gTnVtYmVyKGYuaGk4MCkgfHwgTnVtYmVyKGYueV9oYXQpIHx8IDApKTtcclxuICBjb25zdCBtaW5ZID0gMDtcclxuICBjb25zdCBzY2FsZVggPSAoaSkgPT4gcGFkTCArIChpbm5lclcgKiBpKSAvIE1hdGgubWF4KDEsIGZjLmxlbmd0aCAtIDEpO1xyXG4gIGNvbnN0IHNjYWxlWSA9ICh2KSA9PiBwYWRUICsgaW5uZXJIIC0gKGlubmVySCAqICh2IC0gbWluWSkpIC8gKG1heFkgLSBtaW5ZKTtcclxuXHJcbiAgLy8gR3JpZCArIGVqZSBZXHJcbiAgY29uc3QgeVRpY2tzID0gWzAsIDAuMjUsIDAuNSwgMC43NSwgMV1cclxuICAgIC5tYXAoKHIpID0+IHtcclxuICAgICAgY29uc3QgdmFsID0gbWluWSArIHIgKiAobWF4WSAtIG1pblkpO1xyXG4gICAgICBjb25zdCB5eSA9IHNjYWxlWSh2YWwpO1xyXG4gICAgICByZXR1cm4gKFxyXG4gICAgICAgICc8bGluZSB4MT1cIicgK1xyXG4gICAgICAgIHBhZEwgK1xyXG4gICAgICAgICdcIiB5MT1cIicgK1xyXG4gICAgICAgIHl5ICtcclxuICAgICAgICAnXCIgeDI9XCInICtcclxuICAgICAgICAoVyAtIHBhZFIpICtcclxuICAgICAgICAnXCIgeTI9XCInICtcclxuICAgICAgICB5eSArXHJcbiAgICAgICAgJ1wiIHN0cm9rZT1cIiNlMmU4ZjBcIiBzdHJva2Utd2lkdGg9XCIxXCIvPicgK1xyXG4gICAgICAgICc8dGV4dCB4PVwiJyArXHJcbiAgICAgICAgKHBhZEwgLSA2KSArXHJcbiAgICAgICAgJ1wiIHk9XCInICtcclxuICAgICAgICAoeXkgKyA0KSArXHJcbiAgICAgICAgJ1wiIHRleHQtYW5jaG9yPVwiZW5kXCIgZm9udC1zaXplPVwiMTBcIiBmaWxsPVwiIzY0NzQ4YlwiPicgK1xyXG4gICAgICAgIF9mbXROdW0odmFsKSArXHJcbiAgICAgICAgJzwvdGV4dD4nXHJcbiAgICAgICk7XHJcbiAgICB9KVxyXG4gICAgLmpvaW4oJycpO1xyXG5cclxuICAvLyBFamUgWCAobWVzZXMpXHJcbiAgY29uc3QgeExhYmVscyA9IGZjXHJcbiAgICAubWFwKChmLCBpKSA9PiB7XHJcbiAgICAgIGNvbnN0IHh4ID0gc2NhbGVYKGkpO1xyXG4gICAgICByZXR1cm4gKFxyXG4gICAgICAgICc8dGV4dCB4PVwiJyArXHJcbiAgICAgICAgeHggK1xyXG4gICAgICAgICdcIiB5PVwiJyArXHJcbiAgICAgICAgKEggLSBwYWRCICsgMTUpICtcclxuICAgICAgICAnXCIgdGV4dC1hbmNob3I9XCJtaWRkbGVcIiBmb250LXNpemU9XCIxMFwiIGZpbGw9XCIjNjQ3NDhiXCI+JyArXHJcbiAgICAgICAgX2ZtdERzU2hvcnQoZi5kcykgK1xyXG4gICAgICAgICc8L3RleHQ+J1xyXG4gICAgICApO1xyXG4gICAgfSlcclxuICAgIC5qb2luKCcnKTtcclxuXHJcbiAgLy8gSW50ZXJ2YWxvIGNvbmZpYW56YSAoYmFuZClcclxuICBjb25zdCBiYW5kUG9pbnRzID1cclxuICAgIGZjLm1hcCgoZiwgaSkgPT4gc2NhbGVYKGkpICsgJywnICsgc2NhbGVZKE51bWJlcihmLmhpODApIHx8IDApKS5qb2luKCcgJykgK1xyXG4gICAgJyAnICtcclxuICAgIGZjXHJcbiAgICAgIC5zbGljZSgpXHJcbiAgICAgIC5yZXZlcnNlKClcclxuICAgICAgLm1hcCgoZiwgaSkgPT4gc2NhbGVYKGZjLmxlbmd0aCAtIDEgLSBpKSArICcsJyArIHNjYWxlWShOdW1iZXIoZi5sbzgwKSB8fCAwKSlcclxuICAgICAgLmpvaW4oJyAnKTtcclxuICBjb25zdCBiYW5kID0gJzxwb2x5Z29uIHBvaW50cz1cIicgKyBiYW5kUG9pbnRzICsgJ1wiIGZpbGw9XCIjMGQ5NDg4MzNcIiBzdHJva2U9XCJub25lXCIvPic7XHJcblxyXG4gIC8vIExpbmUgZm9yZWNhc3QgKyBwdW50b3NcclxuICBjb25zdCBsaW5lUG9pbnRzID0gZmMubWFwKChmLCBpKSA9PiBzY2FsZVgoaSkgKyAnLCcgKyBzY2FsZVkoTnVtYmVyKGYueV9oYXQpIHx8IDApKS5qb2luKCcgJyk7XHJcbiAgY29uc3QgbGluZSA9XHJcbiAgICAnPHBvbHlsaW5lIHBvaW50cz1cIicgK1xyXG4gICAgbGluZVBvaW50cyArXHJcbiAgICAnXCIgZmlsbD1cIm5vbmVcIiBzdHJva2U9XCIjMGQ5NDg4XCIgc3Ryb2tlLXdpZHRoPVwiMi41XCIgc3Ryb2tlLWxpbmVqb2luPVwicm91bmRcIi8+JztcclxuICBjb25zdCBwb2ludHMgPSBmY1xyXG4gICAgLm1hcChcclxuICAgICAgKGYsIGkpID0+XHJcbiAgICAgICAgJzxjaXJjbGUgY3g9XCInICtcclxuICAgICAgICBzY2FsZVgoaSkgK1xyXG4gICAgICAgICdcIiBjeT1cIicgK1xyXG4gICAgICAgIHNjYWxlWShOdW1iZXIoZi55X2hhdCkgfHwgMCkgK1xyXG4gICAgICAgICdcIiByPVwiNFwiIGZpbGw9XCIjMGQ5NDg4XCIgc3Ryb2tlPVwiI2ZmZlwiIHN0cm9rZS13aWR0aD1cIjJcIi8+J1xyXG4gICAgKVxyXG4gICAgLmpvaW4oJycpO1xyXG4gIC8vIExhYmVscyBkZSB2YWxvclxyXG4gIGNvbnN0IHZhbHVlTGFiZWxzID0gZmNcclxuICAgIC5tYXAoKGYsIGkpID0+IHtcclxuICAgICAgY29uc3QgeHggPSBzY2FsZVgoaSk7XHJcbiAgICAgIGNvbnN0IHl5ID0gc2NhbGVZKE51bWJlcihmLnlfaGF0KSB8fCAwKTtcclxuICAgICAgcmV0dXJuIChcclxuICAgICAgICAnPHRleHQgeD1cIicgK1xyXG4gICAgICAgIHh4ICtcclxuICAgICAgICAnXCIgeT1cIicgK1xyXG4gICAgICAgICh5eSAtIDgpICtcclxuICAgICAgICAnXCIgdGV4dC1hbmNob3I9XCJtaWRkbGVcIiBmb250LXNpemU9XCIxMFwiIGZvbnQtd2VpZ2h0PVwiNzAwXCIgZmlsbD1cIiMwZjc2NmVcIj4nICtcclxuICAgICAgICBfZm10TnVtKGYueV9oYXQpICtcclxuICAgICAgICAnPC90ZXh0PidcclxuICAgICAgKTtcclxuICAgIH0pXHJcbiAgICAuam9pbignJyk7XHJcblxyXG4gIGNvbnN0IHN2ZyA9XHJcbiAgICAnPHN2ZyB2aWV3Qm94PVwiMCAwICcgK1xyXG4gICAgVyArXHJcbiAgICAnICcgK1xyXG4gICAgSCArXHJcbiAgICAnXCIgc3R5bGU9XCJ3aWR0aDoxMDAlO21heC13aWR0aDo4MDBweDtoZWlnaHQ6YXV0b1wiPicgK1xyXG4gICAgJzxyZWN0IHg9XCIwXCIgeT1cIjBcIiB3aWR0aD1cIicgK1xyXG4gICAgVyArXHJcbiAgICAnXCIgaGVpZ2h0PVwiJyArXHJcbiAgICBIICtcclxuICAgICdcIiBmaWxsPVwiI2ZmZlwiLz4nICtcclxuICAgIHlUaWNrcyArXHJcbiAgICB4TGFiZWxzICtcclxuICAgIGJhbmQgK1xyXG4gICAgbGluZSArXHJcbiAgICBwb2ludHMgK1xyXG4gICAgdmFsdWVMYWJlbHMgK1xyXG4gICAgJzwvc3ZnPic7XHJcbiAgcmV0dXJuIHN2ZztcclxufVxyXG5cclxud2luZG93Lm9wZW5Gb3JlY2FzdFN0YXREZXRhaWwgPSBmdW5jdGlvbiAoc3ViSWQpIHtcclxuICBpZiAoIV9mb3JlY2FzdFN0YXREb2NzKSByZXR1cm47XHJcbiAgY29uc3QgZG9jID0gX2ZvcmVjYXN0U3RhdERvY3MuZmluZCgoZCkgPT4gZC5pZCA9PT0gc3ViSWQpO1xyXG4gIGlmICghZG9jKSB7XHJcbiAgICBhbGVydCgnTm8gc2UgZW5jb250clx1MDBGMyBkZXRhbGxlIGRlICcgKyBzdWJJZCk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIGNvbnN0IGV4aXN0aW5nID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2ZvcmVjYXN0LXN0YXQtZGV0YWlsJyk7XHJcbiAgaWYgKGV4aXN0aW5nKSBleGlzdGluZy5yZW1vdmUoKTtcclxuXHJcbiAgY29uc3QgZWwgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKTtcclxuICBlbC5pZCA9ICdmb3JlY2FzdC1zdGF0LWRldGFpbCc7XHJcbiAgZWwuc3R5bGUuY3NzVGV4dCA9XHJcbiAgICAncG9zaXRpb246Zml4ZWQ7aW5zZXQ6MDtiYWNrZ3JvdW5kOnJnYmEoMTUsMjMsNDIsLjY1KTt6LWluZGV4OjIxMDA7ZGlzcGxheTpmbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtqdXN0aWZ5LWNvbnRlbnQ6Y2VudGVyO3BhZGRpbmc6MnZoJztcclxuICBlbC5vbmNsaWNrID0gKGV2KSA9PiB7XHJcbiAgICBpZiAoZXYudGFyZ2V0ID09PSBlbCkgZWwucmVtb3ZlKCk7XHJcbiAgfTtcclxuXHJcbiAgY29uc3Qgd2FwZSA9IGRvYy5tZXRyaWNzICYmIGRvYy5tZXRyaWNzLndhcGU7XHJcbiAgY29uc3QgYmlhcyA9IGRvYy5tZXRyaWNzICYmIGRvYy5tZXRyaWNzLmJpYXM7XHJcbiAgY29uc3QgbWFlID0gZG9jLm1ldHJpY3MgJiYgZG9jLm1ldHJpY3MubWFlO1xyXG4gIGNvbnN0IHJtc2UgPSBkb2MubWV0cmljcyAmJiBkb2MubWV0cmljcy5ybXNlO1xyXG4gIGNvbnN0IGJlc3RNb2RlbCA9IGRvYy5iZXN0TW9kZWwgfHwgJ1x1MjAxNCc7XHJcbiAgY29uc3QgdmVyc2lvbklkID0gZG9jLnZlcnNpb25JZCB8fCAnXHUyMDE0JztcclxuICBjb25zdCBzdmdIdG1sID0gX2J1aWxkRm9yZWNhc3RDaGFydFN2Zyhkb2MpO1xyXG5cclxuICBjb25zdCBtZXRyaWNzSHRtbCA9XHJcbiAgICAnPGRpdiBzdHlsZT1cImRpc3BsYXk6Z3JpZDtncmlkLXRlbXBsYXRlLWNvbHVtbnM6cmVwZWF0KGF1dG8tZml0LG1pbm1heCgxMjBweCwxZnIpKTtnYXA6MTBweDttYXJnaW46MTRweCAwXCI+JyArXHJcbiAgICAnPGRpdiBzdHlsZT1cInBhZGRpbmc6MTBweDtiYWNrZ3JvdW5kOnZhcigtLWJnLXNlY29uZGFyeSk7Ym9yZGVyLXJhZGl1czo2cHhcIj48ZGl2IHN0eWxlPVwiZm9udC1zaXplOjEwcHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlXCI+TW9kZWxvPC9kaXY+PGRpdiBzdHlsZT1cImZvbnQtd2VpZ2h0OjcwMFwiPicgK1xyXG4gICAgZXNjYXBlSHRtbFNhZmUoYmVzdE1vZGVsKSArXHJcbiAgICAnPC9kaXY+PC9kaXY+JyArXHJcbiAgICAnPGRpdiBzdHlsZT1cInBhZGRpbmc6MTBweDtiYWNrZ3JvdW5kOnZhcigtLWJnLXNlY29uZGFyeSk7Ym9yZGVyLXJhZGl1czo2cHhcIj48ZGl2IHN0eWxlPVwiZm9udC1zaXplOjEwcHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlXCI+V0FQRTwvZGl2PjxkaXYgc3R5bGU9XCJmb250LXdlaWdodDo3MDA7Y29sb3I6JyArXHJcbiAgICBfd2FwZUJhZGdlQ29sb3Iod2FwZSkgK1xyXG4gICAgJ1wiPicgK1xyXG4gICAgX2ZtdFdhcGUod2FwZSkgK1xyXG4gICAgJzwvZGl2PjwvZGl2PicgK1xyXG4gICAgJzxkaXYgc3R5bGU9XCJwYWRkaW5nOjEwcHg7YmFja2dyb3VuZDp2YXIoLS1iZy1zZWNvbmRhcnkpO2JvcmRlci1yYWRpdXM6NnB4XCI+PGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMHB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZVwiPkJpYXM8L2Rpdj48ZGl2IHN0eWxlPVwiZm9udC13ZWlnaHQ6NzAwXCI+JyArXHJcbiAgICAoYmlhcyAhPSBudWxsID8gKGJpYXMgKiAxMDApLnRvRml4ZWQoMCkgKyAnJScgOiAnXHUyMDE0JykgK1xyXG4gICAgJzwvZGl2PjwvZGl2PicgK1xyXG4gICAgJzxkaXYgc3R5bGU9XCJwYWRkaW5nOjEwcHg7YmFja2dyb3VuZDp2YXIoLS1iZy1zZWNvbmRhcnkpO2JvcmRlci1yYWRpdXM6NnB4XCI+PGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMHB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZVwiPk1BRTwvZGl2PjxkaXYgc3R5bGU9XCJmb250LXdlaWdodDo3MDBcIj4nICtcclxuICAgIF9mbXROdW0obWFlKSArXHJcbiAgICAnPC9kaXY+PC9kaXY+JyArXHJcbiAgICAnPGRpdiBzdHlsZT1cInBhZGRpbmc6MTBweDtiYWNrZ3JvdW5kOnZhcigtLWJnLXNlY29uZGFyeSk7Ym9yZGVyLXJhZGl1czo2cHhcIj48ZGl2IHN0eWxlPVwiZm9udC1zaXplOjEwcHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlXCI+Uk1TRTwvZGl2PjxkaXYgc3R5bGU9XCJmb250LXdlaWdodDo3MDBcIj4nICtcclxuICAgIF9mbXROdW0ocm1zZSkgK1xyXG4gICAgJzwvZGl2PjwvZGl2PicgK1xyXG4gICAgJzwvZGl2Pic7XHJcblxyXG4gIGNvbnN0IHRhYmxlSHRtbCA9XHJcbiAgICAnPHRhYmxlIHN0eWxlPVwid2lkdGg6MTAwJTtmb250LXNpemU6MTJweDtib3JkZXItY29sbGFwc2U6Y29sbGFwc2U7bWFyZ2luLXRvcDoxMHB4XCI+JyArXHJcbiAgICAnPHRoZWFkIHN0eWxlPVwiYmFja2dyb3VuZDojMGYxNzJhO2NvbG9yOiNmZmZcIj48dHI+JyArXHJcbiAgICAnPHRoIHN0eWxlPVwicGFkZGluZzo2cHggMTBweDt0ZXh0LWFsaWduOmxlZnRcIj5NZXM8L3RoPicgK1xyXG4gICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6NnB4IDEwcHg7dGV4dC1hbGlnbjpyaWdodFwiPkZvcmVjYXN0PC90aD4nICtcclxuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjZweCAxMHB4O3RleHQtYWxpZ246cmlnaHRcIj5JQyA4MCUgYmFqbzwvdGg+JyArXHJcbiAgICAnPHRoIHN0eWxlPVwicGFkZGluZzo2cHggMTBweDt0ZXh0LWFsaWduOnJpZ2h0XCI+SUMgODAlIGFsdG88L3RoPicgK1xyXG4gICAgJzwvdHI+PC90aGVhZD48dGJvZHk+JyArXHJcbiAgICAoZG9jLmZvcmVjYXN0IHx8IFtdKVxyXG4gICAgICAubWFwKFxyXG4gICAgICAgIChmKSA9PlxyXG4gICAgICAgICAgJzx0ciBzdHlsZT1cImJvcmRlci1ib3R0b206MXB4IHNvbGlkIHZhcigtLWJvcmRlci1zdWJ0bGUpXCI+PHRkIHN0eWxlPVwicGFkZGluZzo2cHggMTBweFwiPicgK1xyXG4gICAgICAgICAgZXNjYXBlSHRtbFNhZmUoX2ZtdERzU2hvcnQoZi5kcykpICtcclxuICAgICAgICAgICc8L3RkPicgK1xyXG4gICAgICAgICAgJzx0ZCBzdHlsZT1cInBhZGRpbmc6NnB4IDEwcHg7dGV4dC1hbGlnbjpyaWdodDtmb250LXdlaWdodDo3MDBcIj4nICtcclxuICAgICAgICAgIF9mbXROdW0oZi55X2hhdCkgK1xyXG4gICAgICAgICAgJzwvdGQ+JyArXHJcbiAgICAgICAgICAnPHRkIHN0eWxlPVwicGFkZGluZzo2cHggMTBweDt0ZXh0LWFsaWduOnJpZ2h0O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpXCI+JyArXHJcbiAgICAgICAgICBfZm10TnVtKGYubG84MCkgK1xyXG4gICAgICAgICAgJzwvdGQ+JyArXHJcbiAgICAgICAgICAnPHRkIHN0eWxlPVwicGFkZGluZzo2cHggMTBweDt0ZXh0LWFsaWduOnJpZ2h0O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpXCI+JyArXHJcbiAgICAgICAgICBfZm10TnVtKGYuaGk4MCkgK1xyXG4gICAgICAgICAgJzwvdGQ+PC90cj4nXHJcbiAgICAgIClcclxuICAgICAgLmpvaW4oJycpICtcclxuICAgICc8L3Rib2R5PjwvdGFibGU+JztcclxuXHJcbiAgY29uc3QgY29udGVudCA9XHJcbiAgICAnPGRpdiBzdHlsZT1cImJhY2tncm91bmQ6dmFyKC0tYmctZWxldmF0ZWQpO2JvcmRlci1yYWRpdXM6MTJweDtwYWRkaW5nOjI0cHg7bWF4LXdpZHRoOjgyMHB4O3dpZHRoOjEwMCU7bWF4LWhlaWdodDo5NnZoO292ZXJmbG93OmF1dG87Ym94LXNoYWRvdzowIDIwcHggNjBweCByZ2JhKDAsMCwwLC40KVwiPicgK1xyXG4gICAgJzxkaXYgc3R5bGU9XCJkaXNwbGF5OmZsZXg7anVzdGlmeS1jb250ZW50OnNwYWNlLWJldHdlZW47YWxpZ24taXRlbXM6Y2VudGVyO21hcmdpbi1ib3R0b206MTBweFwiPicgK1xyXG4gICAgJzxkaXY+PGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMXB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtsZXR0ZXItc3BhY2luZzouNHB4XCI+U3ViZmFtaWxpYTwvZGl2PjxkaXYgc3R5bGU9XCJmb250LXNpemU6MjJweDtmb250LXdlaWdodDo4MDBcIj4nICtcclxuICAgIGVzY2FwZUh0bWxTYWZlKGRvYy5zdWJmYW1pbGlhIHx8IGRvYy5pZCkgK1xyXG4gICAgJzwvZGl2PjwvZGl2PicgK1xyXG4gICAgJzxidXR0b24gb25jbGljaz1cImRvY3VtZW50LmdldEVsZW1lbnRCeUlkKFxcJ2ZvcmVjYXN0LXN0YXQtZGV0YWlsXFwnKS5yZW1vdmUoKVwiIHN0eWxlPVwiYmFja2dyb3VuZDp0cmFuc3BhcmVudDtib3JkZXI6MXB4IHNvbGlkIHZhcigtLWJvcmRlci1zdWJ0bGUpO2JvcmRlci1yYWRpdXM6NnB4O3BhZGRpbmc6NnB4IDEycHg7Y3Vyc29yOnBvaW50ZXI7Zm9udC13ZWlnaHQ6NzAwXCI+Q2VycmFyPC9idXR0b24+JyArXHJcbiAgICAnPC9kaXY+JyArXHJcbiAgICBtZXRyaWNzSHRtbCArXHJcbiAgICAnPGRpdiBzdHlsZT1cImJhY2tncm91bmQ6I2ZmZjtwYWRkaW5nOjhweDtib3JkZXItcmFkaXVzOjhweDttYXJnaW4tdG9wOjEwcHg7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1ib3JkZXItc3VidGxlKVwiPicgK1xyXG4gICAgc3ZnSHRtbCArXHJcbiAgICAnPC9kaXY+JyArXHJcbiAgICB0YWJsZUh0bWwgK1xyXG4gICAgJzxkaXYgc3R5bGU9XCJtYXJnaW4tdG9wOjE0cHg7Zm9udC1zaXplOjExcHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZClcIj5WZXJzaW9uOiA8Y29kZT4nICtcclxuICAgIGVzY2FwZUh0bWxTYWZlKHZlcnNpb25JZCkgK1xyXG4gICAgJzwvY29kZT4gXHUwMEI3IEFwcHJvYWNoOiAnICtcclxuICAgIGVzY2FwZUh0bWxTYWZlKChkb2MuY29uZmlnIHx8IHt9KS5hcHByb2FjaCB8fCAnXHUyMDE0JykgK1xyXG4gICAgJzwvZGl2PicgK1xyXG4gICAgJzwvZGl2Pic7XHJcbiAgZWwuaW5uZXJIVE1MID0gY29udGVudDtcclxuICBkb2N1bWVudC5ib2R5LmFwcGVuZENoaWxkKGVsKTtcclxufTtcclxuXHJcbndpbmRvdy5vcGVuRm9yZWNhc3RNb2RhbCA9IGFzeW5jIGZ1bmN0aW9uICgpIHtcclxuICBpZiAoIV9jYW5Gb3JlY2FzdCgpKSB7XHJcbiAgICBhbGVydCgnRk9SRUNBU1QgZXMgc29sbyBwYXJhIE1hcmlhbm8gKGFkbWluKS4nKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgY29uc3QgZWwgPSBfcmVuZGVyTW9kYWxTaGVsbCgpO1xyXG4gIGVsLnN0eWxlLmRpc3BsYXkgPSAnYmxvY2snO1xyXG4gIC8vIEZhc2UgMTogY2FyZ2FyIFNhbGVzIFBsYW5zIGNhY2hlcyArIHJlbmRlcml6YXIgdGFiIGRlZmF1bHQuXHJcbiAgX3JlbmRlclNhbGVzUGxhbnNUYWIoKTtcclxuICBfbG9hZFNhbGVzUGxhbkNhY2hlcygpXHJcbiAgICAudGhlbihfcmVuZGVyU2FsZXNQbGFuc1RhYilcclxuICAgIC5jYXRjaCgoKSA9PiB7fSk7XHJcbn07XHJcblxyXG53aW5kb3cuY2xvc2VGb3JlY2FzdE1vZGFsID0gZnVuY3Rpb24gKCkge1xyXG4gIGNvbnN0IGVsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2ZvcmVjYXN0LW1vZGFsJyk7XHJcbiAgaWYgKGVsKSBlbC5zdHlsZS5kaXNwbGF5ID0gJ25vbmUnO1xyXG59O1xyXG5cclxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcbi8vIEYzQSBcdTIwMTQgVGFibGEgUmVjb21lbmRhY2lcdTAwRjNuIGRlIENvbXByYSAodGFiIFNhbGVzIFBsYW5zKVxyXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHJcbmFzeW5jIGZ1bmN0aW9uIF9sb2FkTXVsdGlwbGllck92ZXJyaWRlcygpIHtcclxuICBpZiAoIXdpbmRvdy5mYkRiKSByZXR1cm47XHJcbiAgdHJ5IHtcclxuICAgIGNvbnN0IGRvYyA9IGF3YWl0IHdpbmRvdy5mYkRiLmNvbGxlY3Rpb24oJ2ZvcmVjYXN0X2NvbmZpZycpLmRvYygnbXVsdGlwbGllcnMnKS5nZXQoKTtcclxuICAgIGlmIChkb2MuZXhpc3RzKSB7XHJcbiAgICAgIGNvbnN0IGQgPSBkb2MuZGF0YSgpIHx8IHt9O1xyXG4gICAgICBfbXVsdGlwbGllck92ZXJyaWRlcyA9IGQuc2t1T3ZlcnJpZGVzIHx8IHt9O1xyXG4gICAgfSBlbHNlIHtcclxuICAgICAgX211bHRpcGxpZXJPdmVycmlkZXMgPSB7fTtcclxuICAgIH1cclxuICB9IGNhdGNoIChlKSB7XHJcbiAgICBjb25zb2xlLndhcm4oJ1tGT1JFQ0FTVCByZWNvXSBsb2FkIG11bHRpcGxpZXJzIGZhaWw6JywgZSAmJiBlLm1lc3NhZ2UpO1xyXG4gICAgX211bHRpcGxpZXJPdmVycmlkZXMgPSB7fTtcclxuICB9XHJcbn1cclxuXHJcbmFzeW5jIGZ1bmN0aW9uIF9zYXZlTXVsdGlwbGllck92ZXJyaWRlKHNrdVVwcGVyLCB2YWx1ZSkge1xyXG4gIGlmICghd2luZG93LmZiRGIpIHJldHVybjtcclxuICBpZiAoIV9tdWx0aXBsaWVyT3ZlcnJpZGVzKSBfbXVsdGlwbGllck92ZXJyaWRlcyA9IHt9O1xyXG4gIGNvbnN0IHVpZCA9ICh3aW5kb3cuY3VycmVudFVzZXIgJiYgd2luZG93LmN1cnJlbnRVc2VyLmVtYWlsKSB8fCAndW5rbm93bic7XHJcbiAgX211bHRpcGxpZXJPdmVycmlkZXNbc2t1VXBwZXJdID0ge1xyXG4gICAgdmFsdWU6IE51bWJlcih2YWx1ZSksXHJcbiAgICB1cGRhdGVkQXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcclxuICAgIHVwZGF0ZWRCeTogdWlkLFxyXG4gIH07XHJcbiAgYXdhaXQgd2luZG93LmZiRGIuY29sbGVjdGlvbignZm9yZWNhc3RfY29uZmlnJykuZG9jKCdtdWx0aXBsaWVycycpLnNldCh7XHJcbiAgICBza3VPdmVycmlkZXM6IF9tdWx0aXBsaWVyT3ZlcnJpZGVzLFxyXG4gICAgdXBkYXRlZEF0OiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXHJcbiAgICB1cGRhdGVkQnk6IHVpZCxcclxuICB9KTtcclxufVxyXG5cclxuYXN5bmMgZnVuY3Rpb24gX3JlbW92ZU11bHRpcGxpZXJPdmVycmlkZShza3VVcHBlcikge1xyXG4gIGlmICghd2luZG93LmZiRGIgfHwgIV9tdWx0aXBsaWVyT3ZlcnJpZGVzKSByZXR1cm47XHJcbiAgZGVsZXRlIF9tdWx0aXBsaWVyT3ZlcnJpZGVzW3NrdVVwcGVyXTtcclxuICBjb25zdCB1aWQgPSAod2luZG93LmN1cnJlbnRVc2VyICYmIHdpbmRvdy5jdXJyZW50VXNlci5lbWFpbCkgfHwgJ3Vua25vd24nO1xyXG4gIGF3YWl0IHdpbmRvdy5mYkRiLmNvbGxlY3Rpb24oJ2ZvcmVjYXN0X2NvbmZpZycpLmRvYygnbXVsdGlwbGllcnMnKS5zZXQoe1xyXG4gICAgc2t1T3ZlcnJpZGVzOiBfbXVsdGlwbGllck92ZXJyaWRlcyxcclxuICAgIHVwZGF0ZWRBdDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxyXG4gICAgdXBkYXRlZEJ5OiB1aWQsXHJcbiAgfSk7XHJcbn1cclxuXHJcbi8vIEF1dG8gbXVsdGlwbGllcjogcmVjZW50L2Jhc2VsaW5lIGNvbiBjYXAuIFJldG9ybmEge3ZhbHVlLCBzb3VyY2U6ICdhdXRvJ3wnZmFsbGJhY2snfCdkZWZhdWx0JywgcmVjZW50LCBiYXNlbGluZX0uXHJcbmZ1bmN0aW9uIF9jb21wdXRlTXVsdGlwbGllckF1dG8oc2t1VXBwZXIpIHtcclxuICBjb25zdCByZWMgPSBfcmVjb1ZlbnRhc1NuYXBzaG90ICYmIF9yZWNvVmVudGFzU25hcHNob3Rbc2t1VXBwZXJdO1xyXG4gIGlmICghcmVjIHx8ICFyZWMubWVzZXMpIHJldHVybiB7IHZhbHVlOiAxLjAsIHNvdXJjZTogJ2RlZmF1bHQnLCByZWNlbnQ6IDAsIGJhc2VsaW5lOiAwIH07XHJcbiAgY29uc3QgaG95ID0gbmV3IERhdGUoKTtcclxuICBjb25zdCBtb250aHNCYWNrS2V5ID0gKG4pID0+IHtcclxuICAgIGNvbnN0IGQgPSBuZXcgRGF0ZShob3kuZ2V0RnVsbFllYXIoKSwgaG95LmdldE1vbnRoKCkgLSBuLCAxKTtcclxuICAgIHJldHVybiBTdHJpbmcoZC5nZXRGdWxsWWVhcigpKSArICctJyArIFN0cmluZyhkLmdldE1vbnRoKCkgKyAxKS5wYWRTdGFydCgyLCAnMCcpO1xyXG4gIH07XHJcbiAgY29uc3QgY29sbGVjdEF2ZyA9IChuKSA9PiB7XHJcbiAgICBsZXQgc3VtID0gMDtcclxuICAgIGxldCBjb3VudCA9IDA7XHJcbiAgICBmb3IgKGxldCBpID0gMTsgaSA8PSBuOyBpKyspIHtcclxuICAgICAgY29uc3QgayA9IG1vbnRoc0JhY2tLZXkoaSk7XHJcbiAgICAgIGNvbnN0IG0gPSByZWMubWVzZXNba107XHJcbiAgICAgIGlmIChtICYmIE51bWJlci5pc0Zpbml0ZShOdW1iZXIobS5xdHkpKSkge1xyXG4gICAgICAgIHN1bSArPSBOdW1iZXIobS5xdHkpO1xyXG4gICAgICAgIGNvdW50Kys7XHJcbiAgICAgIH1cclxuICAgIH1cclxuICAgIHJldHVybiBjb3VudCA+IDAgPyB7IGF2Zzogc3VtIC8gY291bnQsIG46IGNvdW50IH0gOiB7IGF2ZzogMCwgbjogMCB9O1xyXG4gIH07XHJcbiAgY29uc3QgcmVjMiA9IGNvbGxlY3RBdmcoUkVDT19NVUxUX1JFQ0VOVF9NT05USFMpO1xyXG4gIGNvbnN0IGJhczYgPSBjb2xsZWN0QXZnKFJFQ09fTVVMVF9CQVNFTElORV9NT05USFMpO1xyXG4gIC8vIE5lY2VzaXRhbW9zIGFsIG1lbm9zIDEgbWVzIHJlY2llbnRlICsgMyBtZXNlcyBiYXNlbGluZSBwYXJhIGNhbGN1bGFyIGF1dG8uXHJcbiAgaWYgKHJlYzIubiA9PT0gMCB8fCBiYXM2Lm4gPCAzIHx8IGJhczYuYXZnIDwgUkVDT19NVUxUX01JTl9CQVNFTElORSkge1xyXG4gICAgcmV0dXJuIHsgdmFsdWU6IDEuMCwgc291cmNlOiAnZGVmYXVsdCcsIHJlY2VudDogcmVjMi5hdmcsIGJhc2VsaW5lOiBiYXM2LmF2ZyB9O1xyXG4gIH1cclxuICBsZXQgcmF0aW8gPSByZWMyLmF2ZyAvIGJhczYuYXZnO1xyXG4gIGlmIChyYXRpbyA8IFJFQ09fTVVMVF9NSU4pIHJhdGlvID0gUkVDT19NVUxUX01JTjtcclxuICBpZiAocmF0aW8gPiBSRUNPX01VTFRfTUFYKSByYXRpbyA9IFJFQ09fTVVMVF9NQVg7XHJcbiAgcmV0dXJuIHtcclxuICAgIHZhbHVlOiBNYXRoLnJvdW5kKHJhdGlvICogMTAwKSAvIDEwMCxcclxuICAgIHNvdXJjZTogJ2F1dG8nLFxyXG4gICAgcmVjZW50OiBNYXRoLnJvdW5kKHJlYzIuYXZnICogMTApIC8gMTAsXHJcbiAgICBiYXNlbGluZTogTWF0aC5yb3VuZChiYXM2LmF2ZyAqIDEwKSAvIDEwLFxyXG4gIH07XHJcbn1cclxuXHJcbmZ1bmN0aW9uIF9nZXRFZmZlY3RpdmVNdWx0aXBsaWVyKHNrdVVwcGVyKSB7XHJcbiAgLy8gT3ZlcnJpZGUgbWFudWFsIGdhbmFcclxuICBpZiAoX211bHRpcGxpZXJPdmVycmlkZXMgJiYgX211bHRpcGxpZXJPdmVycmlkZXNbc2t1VXBwZXJdKSB7XHJcbiAgICByZXR1cm4ge1xyXG4gICAgICB2YWx1ZTogTnVtYmVyKF9tdWx0aXBsaWVyT3ZlcnJpZGVzW3NrdVVwcGVyXS52YWx1ZSkgfHwgMS4wLFxyXG4gICAgICBzb3VyY2U6ICdtYW51YWwnLFxyXG4gICAgICBhdXRvOiBfY29tcHV0ZU11bHRpcGxpZXJBdXRvKHNrdVVwcGVyKSxcclxuICAgIH07XHJcbiAgfVxyXG4gIGNvbnN0IGF1dG8gPSBfY29tcHV0ZU11bHRpcGxpZXJBdXRvKHNrdVVwcGVyKTtcclxuICByZXR1cm4geyB2YWx1ZTogYXV0by52YWx1ZSwgc291cmNlOiBhdXRvLnNvdXJjZSwgYXV0byB9O1xyXG59XHJcblxyXG5hc3luYyBmdW5jdGlvbiBfbG9hZERpc2NvbnRpbnVlZFNrdXMoKSB7XHJcbiAgaWYgKCF3aW5kb3cuZmJEYikgcmV0dXJuO1xyXG4gIHRyeSB7XHJcbiAgICBjb25zdCBkb2MgPSBhd2FpdCB3aW5kb3cuZmJEYi5jb2xsZWN0aW9uKCdmb3JlY2FzdF9jb25maWcnKS5kb2MoJ2Rpc2NvbnRpbnVlZF9za3VzJykuZ2V0KCk7XHJcbiAgICBpZiAoZG9jLmV4aXN0cykge1xyXG4gICAgICBjb25zdCBkID0gZG9jLmRhdGEoKSB8fCB7fTtcclxuICAgICAgY29uc3QgYXJyID0gQXJyYXkuaXNBcnJheShkLnNrdXMpID8gZC5za3VzIDogW107XHJcbiAgICAgIF9kaXNjb250aW51ZWRTa3VzID0gbmV3IFNldChhcnIubWFwKChzKSA9PiBTdHJpbmcocykudHJpbSgpLnRvVXBwZXJDYXNlKCkpKTtcclxuICAgICAgX2Rpc2NvbnRpbnVlZE1ldGEgPSB7IHVwZGF0ZWRBdDogZC51cGRhdGVkQXQsIHVwZGF0ZWRCeTogZC51cGRhdGVkQnkgfTtcclxuICAgIH0gZWxzZSB7XHJcbiAgICAgIF9kaXNjb250aW51ZWRTa3VzID0gbmV3IFNldCgpO1xyXG4gICAgICBfZGlzY29udGludWVkTWV0YSA9IG51bGw7XHJcbiAgICB9XHJcbiAgfSBjYXRjaCAoZSkge1xyXG4gICAgY29uc29sZS53YXJuKCdbRk9SRUNBU1QgcmVjb10gbG9hZCBkaXNjb250aW51ZWQgZmFpbDonLCBlICYmIGUubWVzc2FnZSk7XHJcbiAgICBfZGlzY29udGludWVkU2t1cyA9IG5ldyBTZXQoKTtcclxuICB9XHJcbn1cclxuXHJcbmFzeW5jIGZ1bmN0aW9uIF9zYXZlRGlzY29udGludWVkU2t1cygpIHtcclxuICBpZiAoIXdpbmRvdy5mYkRiIHx8ICFfZGlzY29udGludWVkU2t1cykgcmV0dXJuO1xyXG4gIGNvbnN0IHVpZCA9ICh3aW5kb3cuY3VycmVudFVzZXIgJiYgd2luZG93LmN1cnJlbnRVc2VyLmVtYWlsKSB8fCAndW5rbm93bic7XHJcbiAgY29uc3QgcGF5bG9hZCA9IHtcclxuICAgIHNrdXM6IEFycmF5LmZyb20oX2Rpc2NvbnRpbnVlZFNrdXMpLnNvcnQoKSxcclxuICAgIHVwZGF0ZWRBdDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxyXG4gICAgdXBkYXRlZEJ5OiB1aWQsXHJcbiAgfTtcclxuICBhd2FpdCB3aW5kb3cuZmJEYi5jb2xsZWN0aW9uKCdmb3JlY2FzdF9jb25maWcnKS5kb2MoJ2Rpc2NvbnRpbnVlZF9za3VzJykuc2V0KHBheWxvYWQpO1xyXG4gIF9kaXNjb250aW51ZWRNZXRhID0geyB1cGRhdGVkQXQ6IHBheWxvYWQudXBkYXRlZEF0LCB1cGRhdGVkQnk6IHBheWxvYWQudXBkYXRlZEJ5IH07XHJcbn1cclxuXHJcbmFzeW5jIGZ1bmN0aW9uIF9sb2FkUmVjb0RhdGEoKSB7XHJcbiAgaWYgKCF3aW5kb3cuZmJEYikgdGhyb3cgbmV3IEVycm9yKCdGaXJlc3RvcmUgbm8gaW5pY2lhbGl6YWRvJyk7XHJcbiAgY29uc3QgcHJvbWlzZXMgPSBbXTtcclxuICBpZiAoIV9kaXNjb250aW51ZWRTa3VzKSBwcm9taXNlcy5wdXNoKF9sb2FkRGlzY29udGludWVkU2t1cygpKTtcclxuICBpZiAoIV9tdWx0aXBsaWVyT3ZlcnJpZGVzKSBwcm9taXNlcy5wdXNoKF9sb2FkTXVsdGlwbGllck92ZXJyaWRlcygpKTtcclxuICBpZiAoIV9yZWNvU3RvY2tTbmFwc2hvdCkge1xyXG4gICAgcHJvbWlzZXMucHVzaChcclxuICAgICAgd2luZG93LmZiRGJcclxuICAgICAgICAuY29sbGVjdGlvbignYXBwX2NvbmZpZycpXHJcbiAgICAgICAgLmRvYygnc3RvY2tfc25hcHNob3QnKVxyXG4gICAgICAgIC5nZXQoKVxyXG4gICAgICAgIC50aGVuKChkKSA9PiB7XHJcbiAgICAgICAgICBjb25zdCBkYXRhID0gZC5leGlzdHMgPyBkLmRhdGEoKSA6IHt9O1xyXG4gICAgICAgICAgbGV0IHdoID0ge307XHJcbiAgICAgICAgICBsZXQgYm8gPSB7fTtcclxuICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIHdoID0gZGF0YS53YXJlaG91c2VCcmVha2Rvd24gPyBKU09OLnBhcnNlKGRhdGEud2FyZWhvdXNlQnJlYWtkb3duKSA6IHt9O1xyXG4gICAgICAgICAgfSBjYXRjaCB7XHJcbiAgICAgICAgICAgIHdoID0ge307XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICBibyA9IGRhdGEuYmFja29yZGVyQnlTa3UgPyBKU09OLnBhcnNlKGRhdGEuYmFja29yZGVyQnlTa3UpIDoge307XHJcbiAgICAgICAgICB9IGNhdGNoIHtcclxuICAgICAgICAgICAgYm8gPSB7fTtcclxuICAgICAgICAgIH1cclxuICAgICAgICAgIF9yZWNvU3RvY2tTbmFwc2hvdCA9IHsgd2FyZWhvdXNlQnJlYWtkb3duOiB3aCwgYmFja29yZGVyQnlTa3U6IGJvIH07XHJcbiAgICAgICAgfSlcclxuICAgICk7XHJcbiAgfVxyXG4gIGlmICghX3JlY29WZW50YXNTbmFwc2hvdCkge1xyXG4gICAgcHJvbWlzZXMucHVzaChcclxuICAgICAgd2luZG93LmZiRGJcclxuICAgICAgICAuY29sbGVjdGlvbignc2t1X3ZlbnRhc19zbmFwc2hvdCcpXHJcbiAgICAgICAgLmdldCgpXHJcbiAgICAgICAgLnRoZW4oKHNuYXApID0+IHtcclxuICAgICAgICAgIGNvbnN0IG1hcCA9IHt9O1xyXG4gICAgICAgICAgc25hcC5mb3JFYWNoKChkb2MpID0+IHtcclxuICAgICAgICAgICAgY29uc3QgZCA9IGRvYy5kYXRhKCk7XHJcbiAgICAgICAgICAgIGlmICghZCB8fCAhZC5za3UpIHJldHVybjtcclxuICAgICAgICAgICAgbWFwW1N0cmluZyhkLnNrdSkudHJpbSgpLnRvVXBwZXJDYXNlKCldID0geyBtZXNlczogZC5tZXNlcyB8fCB7fSB9O1xyXG4gICAgICAgICAgfSk7XHJcbiAgICAgICAgICBfcmVjb1ZlbnRhc1NuYXBzaG90ID0gbWFwO1xyXG4gICAgICAgIH0pXHJcbiAgICApO1xyXG4gIH1cclxuICBhd2FpdCBQcm9taXNlLmFsbChwcm9taXNlcyk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIF9jb21wdXRlVmVudGFNZW5zdWFsUHJvbWVkaW8oc2t1VXBwZXIpIHtcclxuICAvLyBQcm9tZWRpbyBkZSBsb3MgXHUwMEZBbHRpbW9zIFJFQ09fVkVOVEFfUFJPTUVESU9fV0lORE9XIG1lc2VzIGNlcnJhZG9zXHJcbiAgLy8gKGV4Y2x1eWUgZWwgbWVzIGFjdHVhbCBwYXJjaWFsKS5cclxuICBjb25zdCByZWMgPSBfcmVjb1ZlbnRhc1NuYXBzaG90ICYmIF9yZWNvVmVudGFzU25hcHNob3Rbc2t1VXBwZXJdO1xyXG4gIGlmICghcmVjIHx8ICFyZWMubWVzZXMpIHJldHVybiAwO1xyXG4gIGNvbnN0IGhveSA9IG5ldyBEYXRlKCk7XHJcbiAgY29uc3QgbW9udGhzQmFjayA9IFtdO1xyXG4gIGZvciAobGV0IGkgPSAxOyBpIDw9IFJFQ09fVkVOVEFfUFJPTUVESU9fV0lORE9XOyBpKyspIHtcclxuICAgIGNvbnN0IGQgPSBuZXcgRGF0ZShob3kuZ2V0RnVsbFllYXIoKSwgaG95LmdldE1vbnRoKCkgLSBpLCAxKTtcclxuICAgIG1vbnRoc0JhY2sucHVzaChTdHJpbmcoZC5nZXRGdWxsWWVhcigpKSArICctJyArIFN0cmluZyhkLmdldE1vbnRoKCkgKyAxKS5wYWRTdGFydCgyLCAnMCcpKTtcclxuICB9XHJcbiAgbGV0IHN1bSA9IDA7XHJcbiAgbGV0IG4gPSAwO1xyXG4gIG1vbnRoc0JhY2suZm9yRWFjaCgoaykgPT4ge1xyXG4gICAgY29uc3QgbSA9IHJlYy5tZXNlc1trXTtcclxuICAgIGlmIChtICYmIE51bWJlci5pc0Zpbml0ZShOdW1iZXIobS5xdHkpKSkge1xyXG4gICAgICBzdW0gKz0gTnVtYmVyKG0ucXR5KTtcclxuICAgICAgbisrO1xyXG4gICAgfVxyXG4gIH0pO1xyXG4gIHJldHVybiBuID4gMCA/IHN1bSAvIG4gOiAwO1xyXG59XHJcblxyXG5mdW5jdGlvbiBfY29tcHV0ZVNhbGVzUGxhbkZ1dHVybyhyb3cpIHtcclxuICAvLyBTdW1hIGxvcyBtZXNlcyBkZSByb3cubW9udGhzIGRlc2RlIGVsIG1lcyBhY3R1YWwgKGluY2x1c2l2ZSkgaGFzdGEgZWxcclxuICAvLyBcdTAwRkFsdGltbyBtZXMgZGVsIHNhbGVzIHBsYW4uIExvcyBtZXNlcyBzb24gJ1lZWVktTU0nLlxyXG4gIGlmICghcm93IHx8ICFyb3cubW9udGhzKSByZXR1cm4gMDtcclxuICBjb25zdCBob3kgPSBuZXcgRGF0ZSgpO1xyXG4gIGNvbnN0IGN1cnJlbnRLZXkgPSBTdHJpbmcoaG95LmdldEZ1bGxZZWFyKCkpICsgJy0nICsgU3RyaW5nKGhveS5nZXRNb250aCgpICsgMSkucGFkU3RhcnQoMiwgJzAnKTtcclxuICBsZXQgc3VtID0gMDtcclxuICBPYmplY3Qua2V5cyhyb3cubW9udGhzKS5mb3JFYWNoKChrKSA9PiB7XHJcbiAgICBpZiAoayA+PSBjdXJyZW50S2V5KSBzdW0gKz0gTnVtYmVyKHJvdy5tb250aHNba10gfHwgMCk7XHJcbiAgfSk7XHJcbiAgcmV0dXJuIHN1bTtcclxufVxyXG5cclxuZnVuY3Rpb24gX2NvbXB1dGVSZWNvbW1lbmRhdGlvbnMoKSB7XHJcbiAgLy8gQ29tYmluYSBSb2RzICsgUmVlbHMgc2FsZXMgcGxhbnMgKyBzdG9jayArIGJhY2tvcmRlciArIHZlbnRhcyBwcm9tZWRpby5cclxuICAvLyBSZXRvcm5hIGFycmF5IGRlIHJvd3MgY29uIHRvZG9zIGxvcyBjYW1wb3MgKyByZWNvbWVuZGFkby5cclxuICBjb25zdCByb3dzID0gW107XHJcbiAgY29uc3QgZmFtaWxpYXMgPSBbJ3JvZHMnLCAncmVlbHMnXTtcclxuICBmb3IgKGNvbnN0IGZhbSBvZiBmYW1pbGlhcykge1xyXG4gICAgY29uc3QgY2FjaGUgPSBfc2FsZXNQbGFuQ2FjaGVzW2ZhbV07XHJcbiAgICBpZiAoIWNhY2hlIHx8ICFjYWNoZS5yb3dzKSBjb250aW51ZTtcclxuICAgIGZvciAoY29uc3Qgc3BSb3cgb2YgY2FjaGUucm93cykge1xyXG4gICAgICBjb25zdCBza3UgPSBTdHJpbmcoc3BSb3cuc2t1IHx8ICcnKS50cmltKCk7XHJcbiAgICAgIGNvbnN0IHNrdVVwcGVyID0gc2t1LnRvVXBwZXJDYXNlKCk7XHJcbiAgICAgIC8vIHYxMTEyOiBza2lwZWFtb3MgU0tVcyBkZXNjb250aW51YWRvcyAoTWFyaWFubyBsb3MgbWFyY2EgZGVzZGUgbGEgVUkpLlxyXG4gICAgICBpZiAoX2Rpc2NvbnRpbnVlZFNrdXMgJiYgX2Rpc2NvbnRpbnVlZFNrdXMuaGFzKHNrdVVwcGVyKSkgY29udGludWU7XHJcbiAgICAgIGNvbnN0IHN0b2NrV2ggPVxyXG4gICAgICAgIChfcmVjb1N0b2NrU25hcHNob3QgJiZcclxuICAgICAgICAgIF9yZWNvU3RvY2tTbmFwc2hvdC53YXJlaG91c2VCcmVha2Rvd24gJiZcclxuICAgICAgICAgIF9yZWNvU3RvY2tTbmFwc2hvdC53YXJlaG91c2VCcmVha2Rvd25bc2t1XSkgfHxcclxuICAgICAgICB7fTtcclxuICAgICAgY29uc3Qgc3RvY2tMaWJyZSA9IE51bWJlcihzdG9ja1doWycxMSddIHx8IDApO1xyXG4gICAgICBjb25zdCBlblRyYW5zaXRvID0gTnVtYmVyKHN0b2NrV2hbJzEyJ10gfHwgMCk7XHJcbiAgICAgIGNvbnN0IGJhY2tvcmRlciA9IE51bWJlcihcclxuICAgICAgICAoX3JlY29TdG9ja1NuYXBzaG90ICYmXHJcbiAgICAgICAgICBfcmVjb1N0b2NrU25hcHNob3QuYmFja29yZGVyQnlTa3UgJiZcclxuICAgICAgICAgIF9yZWNvU3RvY2tTbmFwc2hvdC5iYWNrb3JkZXJCeVNrdVtza3VdKSB8fFxyXG4gICAgICAgICAgMFxyXG4gICAgICApO1xyXG4gICAgICBjb25zdCB2ZW50YU1lbnN1YWwgPSBfY29tcHV0ZVZlbnRhTWVuc3VhbFByb21lZGlvKHNrdVVwcGVyKTtcclxuICAgICAgY29uc3Qgc2FsZXNQbGFuRnV0ID0gX2NvbXB1dGVTYWxlc1BsYW5GdXR1cm8oc3BSb3cpO1xyXG4gICAgICBjb25zdCBtb3EgPSBOdW1iZXIoc3BSb3cubW9xIHx8IDApO1xyXG4gICAgICAvLyB2MTExNCBGM0I6IG11bHRpcGxpY2Fkb3IgYXV0byAocmVjZW50L2Jhc2VsaW5lKSBvIG92ZXJyaWRlIG1hbnVhbC5cclxuICAgICAgY29uc3QgbXVsdEluZm8gPSBfZ2V0RWZmZWN0aXZlTXVsdGlwbGllcihza3VVcHBlcik7XHJcbiAgICAgIGNvbnN0IG11bHRpcGxpZXIgPSBtdWx0SW5mby52YWx1ZTtcclxuICAgICAgY29uc3QgZGVtYW5kYUVzcGVyYWRhID0gdmVudGFNZW5zdWFsICogbXVsdGlwbGllciAqIFJFQ09fSE9SSVpPTl9NT05USFM7XHJcbiAgICAgIGNvbnN0IGJhbGFuY2UgPSBzdG9ja0xpYnJlICsgZW5UcmFuc2l0byArIHNhbGVzUGxhbkZ1dCAtIGJhY2tvcmRlciAtIGRlbWFuZGFFc3BlcmFkYTtcclxuICAgICAgbGV0IHJlY29tZW5kYWRvID0gMDtcclxuICAgICAgaWYgKGJhbGFuY2UgPCAwKSB7XHJcbiAgICAgICAgY29uc3QgZGVmaWNpdCA9IC1iYWxhbmNlO1xyXG4gICAgICAgIHJlY29tZW5kYWRvID0gbW9xID4gMCA/IE1hdGgubWF4KG1vcSwgTWF0aC5jZWlsKGRlZmljaXQgLyBtb3EpICogbW9xKSA6IE1hdGguY2VpbChkZWZpY2l0KTtcclxuICAgICAgfVxyXG4gICAgICByb3dzLnB1c2goe1xyXG4gICAgICAgIGZhbWlsaWE6IGZhbSxcclxuICAgICAgICBza3UsXHJcbiAgICAgICAgZGVzY3JpcHRpb246IHNwUm93LmRlc2NyaXB0aW9uIHx8ICcnLFxyXG4gICAgICAgIG1vcSxcclxuICAgICAgICBzdG9ja0xpYnJlLFxyXG4gICAgICAgIGVuVHJhbnNpdG8sXHJcbiAgICAgICAgYmFja29yZGVyLFxyXG4gICAgICAgIHZlbnRhTWVuc3VhbDogTWF0aC5yb3VuZCh2ZW50YU1lbnN1YWwgKiAxMCkgLyAxMCxcclxuICAgICAgICBzYWxlc1BsYW5GdXQsXHJcbiAgICAgICAgbXVsdGlwbGllcixcclxuICAgICAgICBtdWx0U291cmNlOiBtdWx0SW5mby5zb3VyY2UsIC8vICdhdXRvJyB8ICdtYW51YWwnIHwgJ2RlZmF1bHQnIHwgJ2ZhbGxiYWNrJ1xyXG4gICAgICAgIG11bHRBdXRvOiBtdWx0SW5mby5hdXRvID8gbXVsdEluZm8uYXV0by52YWx1ZSA6IG51bGwsIC8vIGVsIHZhbG9yIGF1dG8gc2kgaGF5IG92ZXJyaWRlIG1hbnVhbFxyXG4gICAgICAgIGRlbWFuZGFFc3BlcmFkYTogTWF0aC5yb3VuZChkZW1hbmRhRXNwZXJhZGEgKiAxMCkgLyAxMCxcclxuICAgICAgICBiYWxhbmNlOiBNYXRoLnJvdW5kKGJhbGFuY2UgKiAxMCkgLyAxMCxcclxuICAgICAgICByZWNvbWVuZGFkbyxcclxuICAgICAgfSk7XHJcbiAgICB9XHJcbiAgfVxyXG4gIC8vIE9yZGVuYXIgcG9yIHJlY29tZW5kYWRvIGRlc2NlbmRlbnRlXHJcbiAgcm93cy5zb3J0KChhLCBiKSA9PiBiLnJlY29tZW5kYWRvIC0gYS5yZWNvbWVuZGFkbyk7XHJcbiAgcmV0dXJuIHJvd3M7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIF9mbXROdW1TaWduZWQobikge1xyXG4gIGlmIChuID09IG51bGwgfHwgIU51bWJlci5pc0Zpbml0ZShOdW1iZXIobikpKSByZXR1cm4gJ1x1MjAxNCc7XHJcbiAgY29uc3QgdiA9IE51bWJlcihuKTtcclxuICBjb25zdCBhYnMgPSBNYXRoLmFicyh2KS50b0xvY2FsZVN0cmluZygnZXMtQVInLCB7IG1heGltdW1GcmFjdGlvbkRpZ2l0czogMCB9KTtcclxuICByZXR1cm4gKHYgPCAwID8gJ1x1MjIxMicgOiAnJykgKyBhYnM7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIF9mbXRJbnQobikge1xyXG4gIGlmIChuID09IG51bGwgfHwgIU51bWJlci5pc0Zpbml0ZShOdW1iZXIobikpKSByZXR1cm4gJ1x1MjAxNCc7XHJcbiAgcmV0dXJuIE1hdGgucm91bmQoTnVtYmVyKG4pKS50b0xvY2FsZVN0cmluZygnZXMtQVInKTtcclxufVxyXG5cclxuLy8gdjExMTQgRjNCOiBjZWxkYSBtdWx0aXBsaWNhZG9yIGNvbiBjaGlwIGF1dG8vbWFudWFsICsgaW5wdXQgZWRpdGFibGUuXHJcbmZ1bmN0aW9uIF9idWlsZE11bHRDZWxsSHRtbChyKSB7XHJcbiAgY29uc3Qgc2t1VXBwZXIgPSBTdHJpbmcoci5za3UpLnRyaW0oKS50b1VwcGVyQ2FzZSgpO1xyXG4gIGNvbnN0IGlzTWFudWFsID0gci5tdWx0U291cmNlID09PSAnbWFudWFsJztcclxuICBjb25zdCBpc0RlZmF1bHQgPSByLm11bHRTb3VyY2UgPT09ICdkZWZhdWx0JztcclxuICBjb25zdCB2YWwgPSBOdW1iZXIoci5tdWx0aXBsaWVyIHx8IDEuMCkudG9GaXhlZCgyKTtcclxuICAvLyBDb2xvciBwb3IgZGlyZWNjaVx1MDBGM246ID4xLjA1IHZlcmRlIChjcmVjaWVuZG8pLCA8MC45NSByb2pvIChjYXllbmRvKSwgbWVkaW8gZ3Jpcy5cclxuICBsZXQgZGlyQ29sb3IgPSAndmFyKC0tdGV4dC1tdXRlZCknO1xyXG4gIGlmIChyLm11bHRpcGxpZXIgPiAxLjA1KSBkaXJDb2xvciA9ICcjMTZhMzRhJztcclxuICBlbHNlIGlmIChyLm11bHRpcGxpZXIgPCAwLjk1KSBkaXJDb2xvciA9ICcjZGMyNjI2JztcclxuXHJcbiAgY29uc3QgY2hpcCA9IGlzTWFudWFsXHJcbiAgICA/ICc8c3BhbiBzdHlsZT1cImRpc3BsYXk6aW5saW5lLWJsb2NrO3BhZGRpbmc6MXB4IDVweDtiYWNrZ3JvdW5kOiNmNTllMGI7Y29sb3I6I2ZmZjtib3JkZXItcmFkaXVzOjhweDtmb250LXNpemU6OXB4O2ZvbnQtd2VpZ2h0OjcwMDttYXJnaW4tbGVmdDo0cHhcIiB0aXRsZT1cIk92ZXJyaWRlIG1hbnVhbDogcGlzYSBlbCBhdXRvXCI+TTwvc3Bhbj4nXHJcbiAgICA6IGlzRGVmYXVsdFxyXG4gICAgICA/ICc8c3BhbiBzdHlsZT1cImRpc3BsYXk6aW5saW5lLWJsb2NrO3BhZGRpbmc6MXB4IDVweDtiYWNrZ3JvdW5kOiM5NGEzYjg7Y29sb3I6I2ZmZjtib3JkZXItcmFkaXVzOjhweDtmb250LXNpemU6OXB4O2ZvbnQtd2VpZ2h0OjcwMDttYXJnaW4tbGVmdDo0cHhcIiB0aXRsZT1cIlNpbiBkYXRvcyBzdWZpY2llbnRlczogdXNhIDEuMFwiPlx1MDBCNzwvc3Bhbj4nXHJcbiAgICAgIDogJzxzcGFuIHN0eWxlPVwiZGlzcGxheTppbmxpbmUtYmxvY2s7cGFkZGluZzoxcHggNXB4O2JhY2tncm91bmQ6IzBkOTQ4ODtjb2xvcjojZmZmO2JvcmRlci1yYWRpdXM6OHB4O2ZvbnQtc2l6ZTo5cHg7Zm9udC13ZWlnaHQ6NzAwO21hcmdpbi1sZWZ0OjRweFwiIHRpdGxlPVwiQXV0byA9IHZlbnRhIDJtIC8gdmVudGEgNm1cIj5BPC9zcGFuPic7XHJcblxyXG4gIGNvbnN0IHJlc2V0QnRuID0gaXNNYW51YWxcclxuICAgID8gJzxidXR0b24gb25jbGljaz1cInJlc2V0TXVsdGlwbGllcihcXCcnICtcclxuICAgICAgZXNjYXBlSHRtbFNhZmUoc2t1VXBwZXIpICtcclxuICAgICAgJ1xcJylcIiB0aXRsZT1cIlZvbHZlciBhbCBhdXRvXCIgc3R5bGU9XCJtYXJnaW4tbGVmdDo0cHg7YmFja2dyb3VuZDp0cmFuc3BhcmVudDtib3JkZXI6bm9uZTtjdXJzb3I6cG9pbnRlcjtmb250LXNpemU6MTJweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTtwYWRkaW5nOjBcIj5cdTIxQkI8L2J1dHRvbj4nXHJcbiAgICA6ICcnO1xyXG5cclxuICBjb25zdCBhdXRvSGludCA9XHJcbiAgICBpc01hbnVhbCAmJiByLm11bHRBdXRvICE9IG51bGxcclxuICAgICAgPyAnIDxzcGFuIHN0eWxlPVwiZm9udC1zaXplOjEwcHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZClcIiB0aXRsZT1cIlZhbG9yIGF1dG8gY2FsY3VsYWRvXCI+KGF1dG8gJyArXHJcbiAgICAgICAgTnVtYmVyKHIubXVsdEF1dG8pLnRvRml4ZWQoMikgK1xyXG4gICAgICAgICcpPC9zcGFuPidcclxuICAgICAgOiAnJztcclxuXHJcbiAgcmV0dXJuIChcclxuICAgICc8c3BhbiBzdHlsZT1cImRpc3BsYXk6aW5saW5lLWZsZXg7YWxpZ24taXRlbXM6Y2VudGVyO2dhcDoycHhcIj4nICtcclxuICAgICc8c3BhbiBvbmNsaWNrPVwiZWRpdE11bHRpcGxpZXIodGhpcywgXFwnJyArXHJcbiAgICBlc2NhcGVIdG1sU2FmZShza3VVcHBlcikgK1xyXG4gICAgJ1xcJylcIiBzdHlsZT1cImN1cnNvcjpwb2ludGVyO3BhZGRpbmc6MnB4IDZweDtib3JkZXItcmFkaXVzOjRweDtiYWNrZ3JvdW5kOnZhcigtLWJnLXNlY29uZGFyeSk7Zm9udC12YXJpYW50LW51bWVyaWM6dGFidWxhci1udW1zO2ZvbnQtd2VpZ2h0OjcwMDtjb2xvcjonICtcclxuICAgIGRpckNvbG9yICtcclxuICAgICdcIiB0aXRsZT1cIkNsaWNrIHBhcmEgZWRpdGFyXCI+JyArXHJcbiAgICB2YWwgK1xyXG4gICAgJzwvc3Bhbj4nICtcclxuICAgIGNoaXAgK1xyXG4gICAgcmVzZXRCdG4gK1xyXG4gICAgYXV0b0hpbnQgK1xyXG4gICAgJzwvc3Bhbj4nXHJcbiAgKTtcclxufVxyXG5cclxud2luZG93LmVkaXRNdWx0aXBsaWVyID0gZnVuY3Rpb24gKGVsLCBza3VVcHBlcikge1xyXG4gIGNvbnN0IGN1cnJlbnRWYWwgPSBwYXJzZUZsb2F0KGVsLnRleHRDb250ZW50KSB8fCAxLjA7XHJcbiAgY29uc3QgaW5wdXQgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdpbnB1dCcpO1xyXG4gIGlucHV0LnR5cGUgPSAnbnVtYmVyJztcclxuICBpbnB1dC5zdGVwID0gJzAuMDUnO1xyXG4gIGlucHV0Lm1pbiA9ICcwLjEnO1xyXG4gIGlucHV0Lm1heCA9ICc1JztcclxuICBpbnB1dC52YWx1ZSA9IFN0cmluZyhjdXJyZW50VmFsKTtcclxuICBpbnB1dC5zdHlsZS5jc3NUZXh0ID1cclxuICAgICd3aWR0aDo2MHB4O3BhZGRpbmc6MnB4IDRweDtmb250LXNpemU6MTJweDtmb250LXdlaWdodDo3MDA7dGV4dC1hbGlnbjpjZW50ZXI7Ym9yZGVyOjJweCBzb2xpZCAjMGQ5NDg4O2JvcmRlci1yYWRpdXM6NHB4O2JhY2tncm91bmQ6dmFyKC0tYmctZWxldmF0ZWQpO2NvbG9yOnZhcigtLXRleHQtcHJpbWFyeSk7Zm9udC12YXJpYW50LW51bWVyaWM6dGFidWxhci1udW1zJztcclxuICBjb25zdCBwYXJlbnQgPSBlbC5wYXJlbnROb2RlO1xyXG4gIHBhcmVudC5yZXBsYWNlQ2hpbGQoaW5wdXQsIGVsKTtcclxuICBpbnB1dC5mb2N1cygpO1xyXG4gIGlucHV0LnNlbGVjdCgpO1xyXG5cclxuICBjb25zdCBjb21taXQgPSBhc3luYyAoKSA9PiB7XHJcbiAgICBjb25zdCB2ID0gcGFyc2VGbG9hdChpbnB1dC52YWx1ZSk7XHJcbiAgICBpZiAoTnVtYmVyLmlzTmFOKHYpIHx8IHYgPCAwLjEgfHwgdiA+IDUpIHtcclxuICAgICAgX3JlbmRlclJlY29TZWN0aW9uKCk7XHJcbiAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIGlmIChNYXRoLmFicyh2IC0gY3VycmVudFZhbCkgPCAwLjAwMSkge1xyXG4gICAgICBfcmVuZGVyUmVjb1NlY3Rpb24oKTtcclxuICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG4gICAgdHJ5IHtcclxuICAgICAgYXdhaXQgX3NhdmVNdWx0aXBsaWVyT3ZlcnJpZGUoc2t1VXBwZXIsIHYpO1xyXG4gICAgICBfcmVuZGVyUmVjb1NlY3Rpb24oKTtcclxuICAgIH0gY2F0Y2ggKGUpIHtcclxuICAgICAgYWxlcnQoJ0Vycm9yIGd1YXJkYW5kbzogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xyXG4gICAgICBfcmVuZGVyUmVjb1NlY3Rpb24oKTtcclxuICAgIH1cclxuICB9O1xyXG5cclxuICBjb25zdCBjYW5jZWwgPSAoKSA9PiBfcmVuZGVyUmVjb1NlY3Rpb24oKTtcclxuXHJcbiAgaW5wdXQuYWRkRXZlbnRMaXN0ZW5lcignYmx1cicsIGNvbW1pdCk7XHJcbiAgaW5wdXQuYWRkRXZlbnRMaXN0ZW5lcigna2V5ZG93bicsIChldikgPT4ge1xyXG4gICAgaWYgKGV2LmtleSA9PT0gJ0VudGVyJykge1xyXG4gICAgICBldi5wcmV2ZW50RGVmYXVsdCgpO1xyXG4gICAgICBpbnB1dC5ibHVyKCk7XHJcbiAgICB9IGVsc2UgaWYgKGV2LmtleSA9PT0gJ0VzY2FwZScpIHtcclxuICAgICAgZXYucHJldmVudERlZmF1bHQoKTtcclxuICAgICAgY2FuY2VsKCk7XHJcbiAgICB9XHJcbiAgfSk7XHJcbn07XHJcblxyXG53aW5kb3cucmVzZXRNdWx0aXBsaWVyID0gYXN5bmMgZnVuY3Rpb24gKHNrdVVwcGVyKSB7XHJcbiAgaWYgKCFjb25maXJtKCdWb2x2ZXIgZWwgbXVsdGlwbGljYWRvciBkZSAnICsgc2t1VXBwZXIgKyAnIGFsIGNcdTAwRTFsY3VsbyBhdXRvbVx1MDBFMXRpY28/JykpIHJldHVybjtcclxuICB0cnkge1xyXG4gICAgYXdhaXQgX3JlbW92ZU11bHRpcGxpZXJPdmVycmlkZShza3VVcHBlcik7XHJcbiAgICBfcmVuZGVyUmVjb1NlY3Rpb24oKTtcclxuICB9IGNhdGNoIChlKSB7XHJcbiAgICBhbGVydCgnRXJyb3I6ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcclxuICB9XHJcbn07XHJcblxyXG5mdW5jdGlvbiBfcmVuZGVyUmVjb1NlY3Rpb24oKSB7XHJcbiAgY29uc3QgY29udCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdyZWNvLXNlY3Rpb24tY29udGFpbmVyJyk7XHJcbiAgaWYgKCFjb250KSByZXR1cm47XHJcbiAgdHJ5IHtcclxuICAgIF9yZW5kZXJSZWNvU2VjdGlvbkltcGwoY29udCk7XHJcbiAgfSBjYXRjaCAoZSkge1xyXG4gICAgY29uc29sZS5lcnJvcignW0ZPUkVDQVNUIHJlY29dIHJlbmRlciBmYWlsJywgZSk7XHJcbiAgICBjb250LmlubmVySFRNTCA9XHJcbiAgICAgICc8ZGl2IHN0eWxlPVwicGFkZGluZzoyMHB4O2NvbG9yOiNkYzI2MjZcIj4nICtcclxuICAgICAgJzxkaXYgc3R5bGU9XCJmb250LXdlaWdodDo3MDA7bWFyZ2luLWJvdHRvbTo4cHhcIj5FcnJvciByZW5kZXJpemFuZG8gdGFibGEgcmVjb21lbmRhY2lcdTAwRjNuPC9kaXY+JyArXHJcbiAgICAgICc8cHJlIHN0eWxlPVwiZm9udC1zaXplOjExcHg7YmFja2dyb3VuZDojZmVmMmYyO3BhZGRpbmc6MTBweDtib3JkZXItcmFkaXVzOjZweDtvdmVyZmxvdzphdXRvO3doaXRlLXNwYWNlOnByZS13cmFwXCI+JyArXHJcbiAgICAgIGVzY2FwZUh0bWxTYWZlKGUuc3RhY2sgfHwgZS5tZXNzYWdlIHx8IFN0cmluZyhlKSkgK1xyXG4gICAgICAnPC9wcmU+PC9kaXY+JztcclxuICB9XHJcbn1cclxuXHJcbmZ1bmN0aW9uIF9yZW5kZXJSZWNvU2VjdGlvbkltcGwoY29udCkge1xyXG4gIGNvbnN0IGFueUxvYWRlZCA9ICEhKF9zYWxlc1BsYW5DYWNoZXMucm9kcyB8fCBfc2FsZXNQbGFuQ2FjaGVzLnJlZWxzKTtcclxuICBpZiAoIWFueUxvYWRlZCkge1xyXG4gICAgY29udC5pbm5lckhUTUwgPSAnJztcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgaWYgKCFfcmVjb1N0b2NrU25hcHNob3QgfHwgIV9yZWNvVmVudGFzU25hcHNob3QpIHtcclxuICAgIGNvbnQuaW5uZXJIVE1MID1cclxuICAgICAgJzxkaXYgc3R5bGU9XCJwYWRkaW5nOjQwcHggMThweDt0ZXh0LWFsaWduOmNlbnRlcjtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKVwiPicgK1xyXG4gICAgICAnPGRpdiBzdHlsZT1cImRpc3BsYXk6aW5saW5lLWJsb2NrO3dpZHRoOjI0cHg7aGVpZ2h0OjI0cHg7Ym9yZGVyOjNweCBzb2xpZCAjMGQ5NDg4O2JvcmRlci10b3AtY29sb3I6dHJhbnNwYXJlbnQ7Ym9yZGVyLXJhZGl1czo1MCU7YW5pbWF0aW9uOnNwaW4gMC44cyBsaW5lYXIgaW5maW5pdGU7bWFyZ2luLWJvdHRvbToxMHB4XCI+PC9kaXY+JyArXHJcbiAgICAgICc8ZGl2PkNhcmdhbmRvIHN0b2NrICsgdmVudGFzIGhpc3RcdTAwRjNyaWNhcy4uLjwvZGl2PicgK1xyXG4gICAgICAnPHN0eWxlPkBrZXlmcmFtZXMgc3Bpbnt0b3t0cmFuc2Zvcm06cm90YXRlKDM2MGRlZyl9fTwvc3R5bGU+PC9kaXY+JztcclxuICAgIF9sb2FkUmVjb0RhdGEoKVxyXG4gICAgICAudGhlbihfcmVuZGVyUmVjb1NlY3Rpb24pXHJcbiAgICAgIC5jYXRjaCgoZSkgPT4ge1xyXG4gICAgICAgIGNvbnNvbGUuZXJyb3IoJ1tGT1JFQ0FTVCByZWNvXSBsb2FkIGZhaWwnLCBlKTtcclxuICAgICAgICBjb250LmlubmVySFRNTCA9XHJcbiAgICAgICAgICAnPGRpdiBzdHlsZT1cInBhZGRpbmc6MjBweDtjb2xvcjojZGMyNjI2XCI+RXJyb3IgY2FyZ2FuZG8gZGF0b3M6ICcgK1xyXG4gICAgICAgICAgZXNjYXBlSHRtbFNhZmUoZS5tZXNzYWdlIHx8IFN0cmluZyhlKSkgK1xyXG4gICAgICAgICAgJzwvZGl2Pic7XHJcbiAgICAgIH0pO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuICBjb25zdCBhbGxSb3dzID0gX2NvbXB1dGVSZWNvbW1lbmRhdGlvbnMoKTtcclxuICBjb25zdCBzZWFyY2hMYyA9IF9yZWNvU2VhcmNoVGV4dC50cmltKCkudG9Mb3dlckNhc2UoKTtcclxuICBjb25zdCByb3dzID0gYWxsUm93cy5maWx0ZXIoKHIpID0+IHtcclxuICAgIGlmIChfcmVjb0ZpbHRlckZhbWlsaWEgIT09ICdhbGwnICYmIHIuZmFtaWxpYSAhPT0gX3JlY29GaWx0ZXJGYW1pbGlhKSByZXR1cm4gZmFsc2U7XHJcbiAgICBpZiAoX3JlY29GaWx0ZXJNaW5SZWMgJiYgci5yZWNvbWVuZGFkbyA8PSAwKSByZXR1cm4gZmFsc2U7XHJcbiAgICBpZiAoc2VhcmNoTGMpIHtcclxuICAgICAgY29uc3QgaGF5ID1cclxuICAgICAgICByLnNrdS50b0xvd2VyQ2FzZSgpLmluY2x1ZGVzKHNlYXJjaExjKSB8fCByLmRlc2NyaXB0aW9uLnRvTG93ZXJDYXNlKCkuaW5jbHVkZXMoc2VhcmNoTGMpO1xyXG4gICAgICBpZiAoIWhheSkgcmV0dXJuIGZhbHNlO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuIHRydWU7XHJcbiAgfSk7XHJcbiAgY29uc3QgdG90YWxSZWNvID0gYWxsUm93cy5yZWR1Y2UoKHMsIHIpID0+IHMgKyByLnJlY29tZW5kYWRvLCAwKTtcclxuICBjb25zdCB0b3RhbENvblJlY28gPSBhbGxSb3dzLmZpbHRlcigocikgPT4gci5yZWNvbWVuZGFkbyA+IDApLmxlbmd0aDtcclxuXHJcbiAgY29uc3QgbkRpc2MgPSBfZGlzY29udGludWVkU2t1cyA/IF9kaXNjb250aW51ZWRTa3VzLnNpemUgOiAwO1xyXG4gIGNvbnN0IGRpc2NDaGlwID1cclxuICAgIG5EaXNjID4gMFxyXG4gICAgICA/ICc8YnV0dG9uIG9uY2xpY2s9XCJvcGVuRGlzY29udGludWVkTW9kYWwoKVwiIHN0eWxlPVwicGFkZGluZzo2cHggMTJweDtiYWNrZ3JvdW5kOiM5MzMzZWE7Y29sb3I6I2ZmZjtib3JkZXI6bm9uZTtib3JkZXItcmFkaXVzOjZweDtmb250LXNpemU6MTJweDtmb250LXdlaWdodDo3MDA7Y3Vyc29yOnBvaW50ZXJcIiB0aXRsZT1cIkdlc3Rpb25hciBTS1VzIGRlc2NvbnRpbnVhZG9zXCI+XHVEODNEXHVERUFCICcgK1xyXG4gICAgICAgIF9mbXRJbnQobkRpc2MpICtcclxuICAgICAgICAnIGRlc2NvbnRpbnVhZG9zPC9idXR0b24+J1xyXG4gICAgICA6ICcnO1xyXG5cclxuICBjb25zdCBoZWFkZXIgPVxyXG4gICAgJzxkaXYgc3R5bGU9XCJkaXNwbGF5OmZsZXg7ZmxleC13cmFwOndyYXA7Z2FwOjEwcHg7YWxpZ24taXRlbXM6Y2VudGVyO21hcmdpbi1ib3R0b206MTJweFwiPicgK1xyXG4gICAgJzxkaXYgc3R5bGU9XCJmbGV4OjE7bWluLXdpZHRoOjI4MHB4XCI+PGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxOHB4O2ZvbnQtd2VpZ2h0OjgwMDtjb2xvcjp2YXIoLS10ZXh0LXByaW1hcnkpXCI+UmVjb21lbmRhY2lcdTAwRjNuIGRlIENvbXByYTwvZGl2PicgK1xyXG4gICAgJzxkaXYgc3R5bGU9XCJmb250LXNpemU6MTFweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTttYXJnaW4tdG9wOjJweFwiPkJhbGFuY2UgPSBTdG9jayArIFRyXHUwMEUxbnNpdG8gKyBQbGFuIFx1MjIxMiBCYWNrb3JkZXIgXHUyMjEyIChWZW50YSBtZW5zLiBcdTAwRDcgJyArXHJcbiAgICBSRUNPX0hPUklaT05fTU9OVEhTICtcclxuICAgICdtKTwvZGl2PjwvZGl2PicgK1xyXG4gICAgJzxkaXYgc3R5bGU9XCJwYWRkaW5nOjZweCAxMnB4O2JhY2tncm91bmQ6IzBkOTQ4ODtjb2xvcjojZmZmO2JvcmRlci1yYWRpdXM6NnB4O2ZvbnQtc2l6ZToxMnB4O2ZvbnQtd2VpZ2h0OjcwMFwiPicgK1xyXG4gICAgX2ZtdEludCh0b3RhbENvblJlY28pICtcclxuICAgICcgU0tVcyBjb24gcmVjbzwvZGl2PicgK1xyXG4gICAgJzxkaXYgc3R5bGU9XCJwYWRkaW5nOjZweCAxMnB4O2JhY2tncm91bmQ6IzEzNGU0YTtjb2xvcjojZmZmO2JvcmRlci1yYWRpdXM6NnB4O2ZvbnQtc2l6ZToxMnB4O2ZvbnQtd2VpZ2h0OjcwMFwiPlx1MDNBMyAnICtcclxuICAgIF9mbXRJbnQodG90YWxSZWNvKSArXHJcbiAgICAnIHVuaWRhZGVzPC9kaXY+JyArXHJcbiAgICBkaXNjQ2hpcCArXHJcbiAgICAnPC9kaXY+JztcclxuXHJcbiAgY29uc3QgZmlsdGVycyA9XHJcbiAgICAnPGRpdiBzdHlsZT1cImRpc3BsYXk6ZmxleDtmbGV4LXdyYXA6d3JhcDtnYXA6OHB4O21hcmdpbi1ib3R0b206MTBweDtwYWRkaW5nOjEwcHg7YmFja2dyb3VuZDp2YXIoLS1iZy1zZWNvbmRhcnkpO2JvcmRlci1yYWRpdXM6NnB4XCI+JyArXHJcbiAgICAnPGlucHV0IHR5cGU9XCJ0ZXh0XCIgaWQ9XCJyZWNvLXNlYXJjaFwiIHBsYWNlaG9sZGVyPVwiQnVzY2FyIFNLVSBvIGRlc2NyaXBjaW9uLi4uXCIgdmFsdWU9XCInICtcclxuICAgIGVzY2FwZUh0bWxTYWZlKF9yZWNvU2VhcmNoVGV4dCkgK1xyXG4gICAgJ1wiIG9uaW5wdXQ9XCJvblJlY29TZWFyY2hDaGFuZ2UoZXZlbnQpXCIgc3R5bGU9XCJmbGV4OjE7bWluLXdpZHRoOjIwMHB4O3BhZGRpbmc6NnB4IDEwcHg7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1ib3JkZXItc3VidGxlKTtib3JkZXItcmFkaXVzOjRweDtmb250LXNpemU6MTJweDtiYWNrZ3JvdW5kOnZhcigtLWJnLWVsZXZhdGVkKTtjb2xvcjp2YXIoLS10ZXh0LXByaW1hcnkpXCIvPicgK1xyXG4gICAgJzxzZWxlY3Qgb25jaGFuZ2U9XCJvblJlY29GYW1pbGlhQ2hhbmdlKGV2ZW50KVwiIHN0eWxlPVwicGFkZGluZzo2cHggMTBweDtib3JkZXI6MXB4IHNvbGlkIHZhcigtLWJvcmRlci1zdWJ0bGUpO2JvcmRlci1yYWRpdXM6NHB4O2ZvbnQtc2l6ZToxMnB4O2JhY2tncm91bmQ6dmFyKC0tYmctZWxldmF0ZWQpO2NvbG9yOnZhcigtLXRleHQtcHJpbWFyeSlcIj4nICtcclxuICAgICc8b3B0aW9uIHZhbHVlPVwiYWxsXCInICtcclxuICAgIChfcmVjb0ZpbHRlckZhbWlsaWEgPT09ICdhbGwnID8gJyBzZWxlY3RlZCcgOiAnJykgK1xyXG4gICAgJz5Ub2RhcyBsYXMgZmFtaWxpYXM8L29wdGlvbj4nICtcclxuICAgICc8b3B0aW9uIHZhbHVlPVwicm9kc1wiJyArXHJcbiAgICAoX3JlY29GaWx0ZXJGYW1pbGlhID09PSAncm9kcycgPyAnIHNlbGVjdGVkJyA6ICcnKSArXHJcbiAgICAnPlNvbG8gUm9kcyAoQ2FcdTAwRjFhcyk8L29wdGlvbj4nICtcclxuICAgICc8b3B0aW9uIHZhbHVlPVwicmVlbHNcIicgK1xyXG4gICAgKF9yZWNvRmlsdGVyRmFtaWxpYSA9PT0gJ3JlZWxzJyA/ICcgc2VsZWN0ZWQnIDogJycpICtcclxuICAgICc+U29sbyBSZWVsczwvb3B0aW9uPicgK1xyXG4gICAgJzwvc2VsZWN0PicgK1xyXG4gICAgJzxsYWJlbCBzdHlsZT1cImRpc3BsYXk6aW5saW5lLWZsZXg7YWxpZ24taXRlbXM6Y2VudGVyO2dhcDo2cHg7cGFkZGluZzo2cHggMTBweDtmb250LXNpemU6MTJweDtjb2xvcjp2YXIoLS10ZXh0LXByaW1hcnkpO2N1cnNvcjpwb2ludGVyXCI+JyArXHJcbiAgICAnPGlucHV0IHR5cGU9XCJjaGVja2JveFwiJyArXHJcbiAgICAoX3JlY29GaWx0ZXJNaW5SZWMgPyAnIGNoZWNrZWQnIDogJycpICtcclxuICAgICcgb25jaGFuZ2U9XCJvblJlY29GaWx0ZXJNaW5DaGFuZ2UoZXZlbnQpXCIvPicgK1xyXG4gICAgJ1NvbG8gY29uIHJlY29tZW5kYWRvICZndDsgMDwvbGFiZWw+JyArXHJcbiAgICAnPGJ1dHRvbiBvbmNsaWNrPVwiZXhwb3J0UmVjb0V4Y2VsKClcIiBzdHlsZT1cInBhZGRpbmc6NnB4IDEycHg7YmFja2dyb3VuZDojMTZhMzRhO2NvbG9yOiNmZmY7Ym9yZGVyOm5vbmU7Ym9yZGVyLXJhZGl1czo0cHg7Zm9udC1zaXplOjEycHg7Zm9udC13ZWlnaHQ6NzAwO2N1cnNvcjpwb2ludGVyXCI+XHUyQjA3IEV4Y2VsPC9idXR0b24+JyArXHJcbiAgICAnPC9kaXY+JztcclxuXHJcbiAgY29uc3Qgcm93c0h0bWwgPSByb3dzXHJcbiAgICAubWFwKChyKSA9PiB7XHJcbiAgICAgIGNvbnN0IGJhbENvbG9yID0gci5iYWxhbmNlIDwgMCA/ICcjZGMyNjI2JyA6IHIuYmFsYW5jZSA8IDUwID8gJyNmNTllMGInIDogJyMxNmEzNGEnO1xyXG4gICAgICBjb25zdCByZWNDb2xvciA9IHIucmVjb21lbmRhZG8gPiAwID8gJyNkYzI2MjYnIDogJyM5NGEzYjgnO1xyXG4gICAgICByZXR1cm4gKFxyXG4gICAgICAgICc8dHIgc3R5bGU9XCJib3JkZXItYm90dG9tOjFweCBzb2xpZCB2YXIoLS1ib3JkZXItc3VidGxlKVwiPicgK1xyXG4gICAgICAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjZweCA4cHg7dGV4dC1hbGlnbjpjZW50ZXJcIj48c3BhbiBzdHlsZT1cImRpc3BsYXk6aW5saW5lLWJsb2NrO3BhZGRpbmc6MnB4IDZweDtib3JkZXItcmFkaXVzOjEwcHg7YmFja2dyb3VuZDonICtcclxuICAgICAgICAoci5mYW1pbGlhID09PSAncm9kcycgPyAnIzBlYTVlOScgOiAnIzhiNWNmNicpICtcclxuICAgICAgICAnO2NvbG9yOiNmZmY7Zm9udC1zaXplOjEwcHg7Zm9udC13ZWlnaHQ6NzAwXCI+JyArXHJcbiAgICAgICAgKHIuZmFtaWxpYSA9PT0gJ3JvZHMnID8gJ1JPRCcgOiAnUkVFTCcpICtcclxuICAgICAgICAnPC9zcGFuPjwvdGQ+JyArXHJcbiAgICAgICAgJzx0ZCBzdHlsZT1cInBhZGRpbmc6NnB4IDhweDt0ZXh0LWFsaWduOmNlbnRlcjtmb250LWZhbWlseTptb25vc3BhY2U7Zm9udC1zaXplOjExcHg7Y29sb3I6dmFyKC0tdGV4dC1wcmltYXJ5KTtmb250LXdlaWdodDo3MDBcIj4nICtcclxuICAgICAgICBlc2NhcGVIdG1sU2FmZShyLnNrdSkgK1xyXG4gICAgICAgICc8L3RkPicgK1xyXG4gICAgICAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjZweCA4cHg7Zm9udC1zaXplOjExcHg7Y29sb3I6dmFyKC0tdGV4dC1zZWNvbmRhcnkpO21heC13aWR0aDoyNDBweDtvdmVyZmxvdzpoaWRkZW47dGV4dC1vdmVyZmxvdzplbGxpcHNpczt3aGl0ZS1zcGFjZTpub3dyYXBcIiB0aXRsZT1cIicgK1xyXG4gICAgICAgIGVzY2FwZUh0bWxTYWZlKHIuZGVzY3JpcHRpb24pICtcclxuICAgICAgICAnXCI+JyArXHJcbiAgICAgICAgZXNjYXBlSHRtbFNhZmUoci5kZXNjcmlwdGlvbikgK1xyXG4gICAgICAgICc8L3RkPicgK1xyXG4gICAgICAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjZweCA4cHg7dGV4dC1hbGlnbjpjZW50ZXI7Zm9udC12YXJpYW50LW51bWVyaWM6dGFidWxhci1udW1zO2NvbG9yOnZhcigtLXRleHQtcHJpbWFyeSlcIj4nICtcclxuICAgICAgICBfZm10SW50KHIuc3RvY2tMaWJyZSkgK1xyXG4gICAgICAgICc8L3RkPicgK1xyXG4gICAgICAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjZweCA4cHg7dGV4dC1hbGlnbjpjZW50ZXI7Zm9udC12YXJpYW50LW51bWVyaWM6dGFidWxhci1udW1zO2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpXCI+JyArXHJcbiAgICAgICAgX2ZtdEludChyLmVuVHJhbnNpdG8pICtcclxuICAgICAgICAnPC90ZD4nICtcclxuICAgICAgICAnPHRkIHN0eWxlPVwicGFkZGluZzo2cHggOHB4O3RleHQtYWxpZ246Y2VudGVyO2ZvbnQtdmFyaWFudC1udW1lcmljOnRhYnVsYXItbnVtcztjb2xvcjojZGMyNjI2XCI+JyArXHJcbiAgICAgICAgX2ZtdEludChyLmJhY2tvcmRlcikgK1xyXG4gICAgICAgICc8L3RkPicgK1xyXG4gICAgICAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjZweCA4cHg7dGV4dC1hbGlnbjpjZW50ZXI7Zm9udC12YXJpYW50LW51bWVyaWM6dGFidWxhci1udW1zO2NvbG9yOnZhcigtLXRleHQtc2Vjb25kYXJ5KVwiPicgK1xyXG4gICAgICAgIF9mbXRJbnQoci52ZW50YU1lbnN1YWwpICtcclxuICAgICAgICAnPC90ZD4nICtcclxuICAgICAgICAnPHRkIHN0eWxlPVwicGFkZGluZzo2cHggOHB4O3RleHQtYWxpZ246Y2VudGVyXCI+JyArXHJcbiAgICAgICAgX2J1aWxkTXVsdENlbGxIdG1sKHIpICtcclxuICAgICAgICAnPC90ZD4nICtcclxuICAgICAgICAnPHRkIHN0eWxlPVwicGFkZGluZzo2cHggOHB4O3RleHQtYWxpZ246Y2VudGVyO2ZvbnQtdmFyaWFudC1udW1lcmljOnRhYnVsYXItbnVtcztjb2xvcjp2YXIoLS10ZXh0LXNlY29uZGFyeSlcIj4nICtcclxuICAgICAgICBfZm10SW50KHIuZGVtYW5kYUVzcGVyYWRhKSArXHJcbiAgICAgICAgJzwvdGQ+JyArXHJcbiAgICAgICAgJzx0ZCBzdHlsZT1cInBhZGRpbmc6NnB4IDhweDt0ZXh0LWFsaWduOmNlbnRlcjtmb250LXZhcmlhbnQtbnVtZXJpYzp0YWJ1bGFyLW51bXM7Y29sb3I6dmFyKC0tdGV4dC1wcmltYXJ5KTtmb250LXdlaWdodDo2MDBcIj4nICtcclxuICAgICAgICBfZm10SW50KHIuc2FsZXNQbGFuRnV0KSArXHJcbiAgICAgICAgJzwvdGQ+JyArXHJcbiAgICAgICAgJzx0ZCBzdHlsZT1cInBhZGRpbmc6NnB4IDhweDt0ZXh0LWFsaWduOmNlbnRlcjtmb250LXZhcmlhbnQtbnVtZXJpYzp0YWJ1bGFyLW51bXM7Zm9udC13ZWlnaHQ6NzAwO2NvbG9yOicgK1xyXG4gICAgICAgIGJhbENvbG9yICtcclxuICAgICAgICAnXCI+JyArXHJcbiAgICAgICAgX2ZtdE51bVNpZ25lZChyLmJhbGFuY2UpICtcclxuICAgICAgICAnPC90ZD4nICtcclxuICAgICAgICAnPHRkIHN0eWxlPVwicGFkZGluZzo2cHggOHB4O3RleHQtYWxpZ246Y2VudGVyO2ZvbnQtdmFyaWFudC1udW1lcmljOnRhYnVsYXItbnVtcztjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTtmb250LXNpemU6MTFweFwiPicgK1xyXG4gICAgICAgIF9mbXRJbnQoci5tb3EpICtcclxuICAgICAgICAnPC90ZD4nICtcclxuICAgICAgICAnPHRkIHN0eWxlPVwicGFkZGluZzo2cHggOHB4O3RleHQtYWxpZ246Y2VudGVyXCI+PHNwYW4gc3R5bGU9XCJkaXNwbGF5OmlubGluZS1ibG9jaztwYWRkaW5nOjRweCAxMHB4O2JvcmRlci1yYWRpdXM6MTJweDtiYWNrZ3JvdW5kOicgK1xyXG4gICAgICAgIHJlY0NvbG9yICtcclxuICAgICAgICAnO2NvbG9yOiNmZmY7Zm9udC1zaXplOjEycHg7Zm9udC13ZWlnaHQ6ODAwO21pbi13aWR0aDo1MHB4XCI+JyArXHJcbiAgICAgICAgX2ZtdEludChyLnJlY29tZW5kYWRvKSArXHJcbiAgICAgICAgJzwvc3Bhbj48L3RkPicgK1xyXG4gICAgICAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjZweCA4cHg7dGV4dC1hbGlnbjpjZW50ZXJcIj4nICtcclxuICAgICAgICAnPGJ1dHRvbiBvbmNsaWNrPVwiZGlzY29udGludWVTa3UoXFwnJyArXHJcbiAgICAgICAgZXNjYXBlSHRtbFNhZmUoci5za3UpICtcclxuICAgICAgICBcIicsICdcIiArXHJcbiAgICAgICAgZXNjYXBlSHRtbFNhZmUoci5kZXNjcmlwdGlvbi5yZXBsYWNlKC8nL2csICcnKSkgK1xyXG4gICAgICAgICdcXCcpXCIgdGl0bGU9XCJEZXNjb250aW51YXIgZXN0ZSBTS1VcIiBzdHlsZT1cImJhY2tncm91bmQ6dHJhbnNwYXJlbnQ7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1ib3JkZXItc3VidGxlKTtib3JkZXItcmFkaXVzOjRweDtwYWRkaW5nOjRweCA4cHg7Y3Vyc29yOnBvaW50ZXI7Zm9udC1zaXplOjE0cHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZClcIj5cdUQ4M0RcdURERDE8L2J1dHRvbj4nICtcclxuICAgICAgICAnPC90ZD4nICtcclxuICAgICAgICAnPC90cj4nXHJcbiAgICAgICk7XHJcbiAgICB9KVxyXG4gICAgLmpvaW4oJycpO1xyXG5cclxuICAvLyB2MTExMjogbWluLXdpZHRoIHBhcmEgZm9yemFyIHNjcm9sbCBob3Jpem9udGFsIHNpIG5vIGNhYmUgbGEgY29sdW1uYVxyXG4gIC8vIEFjY2lcdTAwRjNuLiBTaW4gZXN0bywgdGFibGUgd2lkdGg6MTAwJSBjb21wcmltZSB0b2RvIHkgbGEgXHUwMEZBbHRpbWEgY29sdW1uYVxyXG4gIC8vIHF1ZWRhIGZ1ZXJhIGRlbCB2aWV3cG9ydCBzaW4gc2Nyb2xsIHZpc2libGUuXHJcbiAgY29uc3QgdGFibGUgPVxyXG4gICAgJzxkaXYgc3R5bGU9XCJvdmVyZmxvdzphdXRvO21heC1oZWlnaHQ6NjB2aDtib3JkZXI6MXB4IHNvbGlkIHZhcigtLWJvcmRlci1zdWJ0bGUpO2JvcmRlci1yYWRpdXM6OHB4XCI+JyArXHJcbiAgICAnPHRhYmxlIHN0eWxlPVwid2lkdGg6MTAwJTttaW4td2lkdGg6MTQwMHB4O2JvcmRlci1jb2xsYXBzZTpjb2xsYXBzZTtmb250LXNpemU6MTJweFwiPicgK1xyXG4gICAgJzx0aGVhZCBzdHlsZT1cImJhY2tncm91bmQ6IzBmMTcyYTtjb2xvcjojZmZmO3Bvc2l0aW9uOnN0aWNreTt0b3A6MDt6LWluZGV4OjFcIj48dHI+JyArXHJcbiAgICAnPHRoIHN0eWxlPVwicGFkZGluZzo4cHg7dGV4dC1hbGlnbjpjZW50ZXI7Zm9udC1zaXplOjEwcHg7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlXCI+RmFtPC90aD4nICtcclxuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjhweDt0ZXh0LWFsaWduOmNlbnRlcjtmb250LXNpemU6MTBweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2VcIj5TS1U8L3RoPicgK1xyXG4gICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6OHB4O3RleHQtYWxpZ246Y2VudGVyO2ZvbnQtc2l6ZToxMHB4O3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZVwiPkRlc2NyaXBjaVx1MDBGM248L3RoPicgK1xyXG4gICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6OHB4O3RleHQtYWxpZ246Y2VudGVyO2ZvbnQtc2l6ZToxMHB4O3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZVwiIHRpdGxlPVwiV2hzIDExIGRpc3BvbmlibGUgdmVudGFcIj5TdG9jazwvdGg+JyArXHJcbiAgICAnPHRoIHN0eWxlPVwicGFkZGluZzo4cHg7dGV4dC1hbGlnbjpjZW50ZXI7Zm9udC1zaXplOjEwcHg7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlXCIgdGl0bGU9XCJXaHMgMTJcIj5Uclx1MDBFMW5zaXRvPC90aD4nICtcclxuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjhweDt0ZXh0LWFsaWduOmNlbnRlcjtmb250LXNpemU6MTBweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2VcIj5CYWNrb3JkZXI8L3RoPicgK1xyXG4gICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6OHB4O3RleHQtYWxpZ246Y2VudGVyO2ZvbnQtc2l6ZToxMHB4O3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZVwiIHRpdGxlPVwiUHJvbWVkaW8gXHUwMEZBbHRpbW9zIDMgbWVzZXNcIj5WdGEvbWVzPC90aD4nICtcclxuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjhweDt0ZXh0LWFsaWduOmNlbnRlcjtmb250LXNpemU6MTBweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2VcIiB0aXRsZT1cIk11bHRpcGxpY2Fkb3IgZGUgdGVuZGVuY2lhID0gdmVudGEgMm0gLyB2ZW50YSA2bS4gRWRpdGFibGUgKGNsaWNrIHBhcmEgb3ZlcnJpZGUpLlwiPk11bHRpcC48L3RoPicgK1xyXG4gICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6OHB4O3RleHQtYWxpZ246Y2VudGVyO2ZvbnQtc2l6ZToxMHB4O3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZVwiIHRpdGxlPVwiVnRhL21lcyBcdTAwRDcgNyBtZXNlc1wiPkRlbWFuZGEgZXNwLjwvdGg+JyArXHJcbiAgICAnPHRoIHN0eWxlPVwicGFkZGluZzo4cHg7dGV4dC1hbGlnbjpjZW50ZXI7Zm9udC1zaXplOjEwcHg7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlXCIgdGl0bGU9XCJTdW1hIGNvbHVtbmFzIFNhbGVzIFBsYW4gZGVzZGUgbWVzIGFjdHVhbFwiPlBsYW4gZnV0dXJvPC90aD4nICtcclxuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjhweDt0ZXh0LWFsaWduOmNlbnRlcjtmb250LXNpemU6MTBweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2VcIj5CYWxhbmNlPC90aD4nICtcclxuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjhweDt0ZXh0LWFsaWduOmNlbnRlcjtmb250LXNpemU6MTBweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2VcIj5NT1E8L3RoPicgK1xyXG4gICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6OHB4O3RleHQtYWxpZ246Y2VudGVyO2ZvbnQtc2l6ZToxMHB4O3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtiYWNrZ3JvdW5kOiMxMzRlNGFcIj5SZWNvbWVuZGFkbzwvdGg+JyArXHJcbiAgICAnPHRoIHN0eWxlPVwicGFkZGluZzo4cHg7dGV4dC1hbGlnbjpjZW50ZXI7Zm9udC1zaXplOjEwcHg7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlXCIgdGl0bGU9XCJEZXNjb250aW51YXIgU0tVXCI+QWNjaVx1MDBGM248L3RoPicgK1xyXG4gICAgJzwvdHI+PC90aGVhZD48dGJvZHk+JyArXHJcbiAgICAocm93cy5sZW5ndGhcclxuICAgICAgPyByb3dzSHRtbFxyXG4gICAgICA6ICc8dHI+PHRkIGNvbHNwYW49XCIxNFwiIHN0eWxlPVwicGFkZGluZzo0MHB4O3RleHQtYWxpZ246Y2VudGVyO2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpXCI+U2luIHJlc3VsdGFkb3MgY29uIGxvcyBmaWx0cm9zIGFjdHVhbGVzPC90ZD48L3RyPicpICtcclxuICAgICc8L3Rib2R5PjwvdGFibGU+PC9kaXY+JztcclxuXHJcbiAgY29uc3QgZm9vdGVyID1cclxuICAgICc8ZGl2IHN0eWxlPVwibWFyZ2luLXRvcDo4cHg7Zm9udC1zaXplOjEwcHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZClcIj4nICtcclxuICAgICdNb3N0cmFuZG8gJyArXHJcbiAgICBfZm10SW50KHJvd3MubGVuZ3RoKSArXHJcbiAgICAnIGRlICcgK1xyXG4gICAgX2ZtdEludChhbGxSb3dzLmxlbmd0aCkgK1xyXG4gICAgJyBTS1VzIFx1MDBCNyAnICtcclxuICAgICdCYWxhbmNlID0gU3RvY2sgKyBUclx1MDBFMW5zaXRvICsgUGxhbiBcdTIyMTIgQmFja29yZGVyIFx1MjIxMiBEZW1hbmRhLiBSb2pvID0gcXVpZWJyZSBlc3BlcmFkby4gUmVjb21lbmRhZG8gc2UgcmVkb25kZWEgYWwgbVx1MDBGQWx0aXBsbyBkZSBNT1Egc3VwZXJpb3IuJyArXHJcbiAgICAnPC9kaXY+JztcclxuXHJcbiAgY29udC5pbm5lckhUTUwgPVxyXG4gICAgJzxkaXYgc3R5bGU9XCJwYWRkaW5nOjE4cHggMThweCAzMHB4XCI+JyArIGhlYWRlciArIGZpbHRlcnMgKyB0YWJsZSArIGZvb3RlciArICc8L2Rpdj4nO1xyXG59XHJcblxyXG53aW5kb3cub25SZWNvU2VhcmNoQ2hhbmdlID0gZnVuY3Rpb24gKGV2KSB7XHJcbiAgX3JlY29TZWFyY2hUZXh0ID0gZXYudGFyZ2V0LnZhbHVlIHx8ICcnO1xyXG4gIF9yZW5kZXJSZWNvU2VjdGlvbigpO1xyXG4gIC8vIFJlc3RhdXJhciBmb2N1cyArIGNhcmV0IGFsIGlucHV0XHJcbiAgc2V0VGltZW91dCgoKSA9PiB7XHJcbiAgICBjb25zdCBpbnAgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgncmVjby1zZWFyY2gnKTtcclxuICAgIGlmIChpbnApIHtcclxuICAgICAgaW5wLmZvY3VzKCk7XHJcbiAgICAgIGlucC5zZXRTZWxlY3Rpb25SYW5nZShpbnAudmFsdWUubGVuZ3RoLCBpbnAudmFsdWUubGVuZ3RoKTtcclxuICAgIH1cclxuICB9LCAwKTtcclxufTtcclxuXHJcbndpbmRvdy5vblJlY29GYW1pbGlhQ2hhbmdlID0gZnVuY3Rpb24gKGV2KSB7XHJcbiAgX3JlY29GaWx0ZXJGYW1pbGlhID0gZXYudGFyZ2V0LnZhbHVlIHx8ICdhbGwnO1xyXG4gIF9yZW5kZXJSZWNvU2VjdGlvbigpO1xyXG59O1xyXG5cclxud2luZG93Lm9uUmVjb0ZpbHRlck1pbkNoYW5nZSA9IGZ1bmN0aW9uIChldikge1xyXG4gIF9yZWNvRmlsdGVyTWluUmVjID0gISFldi50YXJnZXQuY2hlY2tlZDtcclxuICBfcmVuZGVyUmVjb1NlY3Rpb24oKTtcclxufTtcclxuXHJcbndpbmRvdy5leHBvcnRSZWNvRXhjZWwgPSBmdW5jdGlvbiAoKSB7XHJcbiAgaWYgKHR5cGVvZiBYTFNYID09PSAndW5kZWZpbmVkJykge1xyXG4gICAgYWxlcnQoJ1NoZWV0SlMgKFhMU1gpIG5vIGNhcmdhZG8nKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgY29uc3Qgcm93cyA9IF9jb21wdXRlUmVjb21tZW5kYXRpb25zKCk7XHJcbiAgY29uc3QgYW9hID0gW1xyXG4gICAgW1xyXG4gICAgICAnRmFtaWxpYScsXHJcbiAgICAgICdTS1UnLFxyXG4gICAgICAnRGVzY3JpcGNpXHUwMEYzbicsXHJcbiAgICAgICdTdG9jaycsXHJcbiAgICAgICdUclx1MDBFMW5zaXRvJyxcclxuICAgICAgJ0JhY2tvcmRlcicsXHJcbiAgICAgICdWdGEgcHJvbS9tZXMnLFxyXG4gICAgICAnTXVsdGlwbGljYWRvcicsXHJcbiAgICAgICdPcmlnZW4gbXVsdCcsXHJcbiAgICAgICdEZW1hbmRhIGVzcC4gN20nLFxyXG4gICAgICAnU2FsZXMgUGxhbiBmdXR1cm8nLFxyXG4gICAgICAnQmFsYW5jZScsXHJcbiAgICAgICdNT1EnLFxyXG4gICAgICAnUmVjb21lbmRhZG8nLFxyXG4gICAgXSxcclxuICBdO1xyXG4gIGZvciAoY29uc3QgciBvZiByb3dzKSB7XHJcbiAgICBhb2EucHVzaChbXHJcbiAgICAgIHIuZmFtaWxpYSA9PT0gJ3JvZHMnID8gJ1JvZHMgKENhXHUwMEYxYXMpJyA6ICdSZWVscycsXHJcbiAgICAgIHIuc2t1LFxyXG4gICAgICByLmRlc2NyaXB0aW9uLFxyXG4gICAgICByLnN0b2NrTGlicmUsXHJcbiAgICAgIHIuZW5UcmFuc2l0byxcclxuICAgICAgci5iYWNrb3JkZXIsXHJcbiAgICAgIHIudmVudGFNZW5zdWFsLFxyXG4gICAgICByLm11bHRpcGxpZXIsXHJcbiAgICAgIHIubXVsdFNvdXJjZSB8fCAnYXV0bycsXHJcbiAgICAgIHIuZGVtYW5kYUVzcGVyYWRhLFxyXG4gICAgICByLnNhbGVzUGxhbkZ1dCxcclxuICAgICAgci5iYWxhbmNlLFxyXG4gICAgICByLm1vcSxcclxuICAgICAgci5yZWNvbWVuZGFkbyxcclxuICAgIF0pO1xyXG4gIH1cclxuICBjb25zdCB3cyA9IFhMU1gudXRpbHMuYW9hX3RvX3NoZWV0KGFvYSk7XHJcbiAgd3NbJyFjb2xzJ10gPSBbXHJcbiAgICB7IHdjaDogMTQgfSwgLy8gRmFtaWxpYVxyXG4gICAgeyB3Y2g6IDE4IH0sIC8vIFNLVVxyXG4gICAgeyB3Y2g6IDQwIH0sIC8vIERlc2NyaXBjaVx1MDBGM25cclxuICAgIHsgd2NoOiA4IH0sIC8vIFN0b2NrXHJcbiAgICB7IHdjaDogMTAgfSwgLy8gVHJcdTAwRTFuc2l0b1xyXG4gICAgeyB3Y2g6IDExIH0sIC8vIEJhY2tvcmRlclxyXG4gICAgeyB3Y2g6IDEyIH0sIC8vIFZ0YSBwcm9tL21lc1xyXG4gICAgeyB3Y2g6IDEyIH0sIC8vIE11bHRpcGxpY2Fkb3JcclxuICAgIHsgd2NoOiAxMSB9LCAvLyBPcmlnZW4gbXVsdFxyXG4gICAgeyB3Y2g6IDE1IH0sIC8vIERlbWFuZGEgZXNwIDdtXHJcbiAgICB7IHdjaDogMTYgfSwgLy8gU2FsZXMgUGxhbiBmdXR1cm9cclxuICAgIHsgd2NoOiAxMCB9LCAvLyBCYWxhbmNlXHJcbiAgICB7IHdjaDogOCB9LCAvLyBNT1FcclxuICAgIHsgd2NoOiAxMiB9LCAvLyBSZWNvbWVuZGFkb1xyXG4gIF07XHJcbiAgY29uc3Qgd2IgPSBYTFNYLnV0aWxzLmJvb2tfbmV3KCk7XHJcbiAgWExTWC51dGlscy5ib29rX2FwcGVuZF9zaGVldCh3Yiwgd3MsICdSZWNvbWVuZGFjaVx1MDBGM24nKTtcclxuICBjb25zdCBob3kgPSBuZXcgRGF0ZSgpO1xyXG4gIGNvbnN0IHN0YW1wID1cclxuICAgIGhveS5nZXRGdWxsWWVhcigpICtcclxuICAgICctJyArXHJcbiAgICBTdHJpbmcoaG95LmdldE1vbnRoKCkgKyAxKS5wYWRTdGFydCgyLCAnMCcpICtcclxuICAgICctJyArXHJcbiAgICBTdHJpbmcoaG95LmdldERhdGUoKSkucGFkU3RhcnQoMiwgJzAnKTtcclxuICBYTFNYLndyaXRlRmlsZSh3YiwgJ1JlY29tZW5kYWNpb25fQ29tcHJhXycgKyBzdGFtcCArICcueGxzeCcpO1xyXG59O1xyXG5cclxuLy8gdjExMTIgRjNCOiBkZXNjb250aW51YXIgLyByZWFjdGl2YXIgU0tVcy5cclxud2luZG93LmRpc2NvbnRpbnVlU2t1ID0gYXN5bmMgZnVuY3Rpb24gKHNrdSwgZGVzY3JpcHRpb24pIHtcclxuICBpZiAoIV9kaXNjb250aW51ZWRTa3VzKSBfZGlzY29udGludWVkU2t1cyA9IG5ldyBTZXQoKTtcclxuICBjb25zdCB1cHBlciA9IFN0cmluZyhza3UpLnRyaW0oKS50b1VwcGVyQ2FzZSgpO1xyXG4gIGNvbnN0IGxhYmVsID0gZGVzY3JpcHRpb24gPyBza3UgKyAnIFx1MjAxNCAnICsgZGVzY3JpcHRpb24uc2xpY2UoMCwgNjApIDogc2t1O1xyXG4gIGlmIChcclxuICAgICFjb25maXJtKFxyXG4gICAgICAnRGVzY29udGludWFyICcgK1xyXG4gICAgICAgIGxhYmVsICtcclxuICAgICAgICAnP1xcblxcblF1ZWRhclx1MDBFMSBleGNsdWlkbyBkZWwgY1x1MDBFMWxjdWxvIGRlIHJlY29tZW5kYWNpXHUwMEYzbiBkZSBjb21wcmEgaGFzdGEgcXVlIGxvIHJlYWN0aXZlcyBkZXNkZSBlbCBjaGlwIFwiRGVzY29udGludWFkb3NcIi4nXHJcbiAgICApXHJcbiAgKSB7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIF9kaXNjb250aW51ZWRTa3VzLmFkZCh1cHBlcik7XHJcbiAgdHJ5IHtcclxuICAgIGF3YWl0IF9zYXZlRGlzY29udGludWVkU2t1cygpO1xyXG4gICAgX3JlbmRlclJlY29TZWN0aW9uKCk7XHJcbiAgfSBjYXRjaCAoZSkge1xyXG4gICAgX2Rpc2NvbnRpbnVlZFNrdXMuZGVsZXRlKHVwcGVyKTtcclxuICAgIGFsZXJ0KCdFcnJvciBndWFyZGFuZG86ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcclxuICB9XHJcbn07XHJcblxyXG53aW5kb3cucmVhY3RpdmF0ZVNrdSA9IGFzeW5jIGZ1bmN0aW9uIChza3UpIHtcclxuICBpZiAoIV9kaXNjb250aW51ZWRTa3VzKSByZXR1cm47XHJcbiAgY29uc3QgdXBwZXIgPSBTdHJpbmcoc2t1KS50cmltKCkudG9VcHBlckNhc2UoKTtcclxuICBfZGlzY29udGludWVkU2t1cy5kZWxldGUodXBwZXIpO1xyXG4gIHRyeSB7XHJcbiAgICBhd2FpdCBfc2F2ZURpc2NvbnRpbnVlZFNrdXMoKTtcclxuICAgIF9yZW5kZXJEaXNjb250aW51ZWRNb2RhbCgpO1xyXG4gICAgX3JlbmRlclJlY29TZWN0aW9uKCk7XHJcbiAgfSBjYXRjaCAoZSkge1xyXG4gICAgX2Rpc2NvbnRpbnVlZFNrdXMuYWRkKHVwcGVyKTtcclxuICAgIGFsZXJ0KCdFcnJvciBndWFyZGFuZG86ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcclxuICB9XHJcbn07XHJcblxyXG53aW5kb3cub3BlbkRpc2NvbnRpbnVlZE1vZGFsID0gZnVuY3Rpb24gKCkge1xyXG4gIGNvbnN0IGV4aXN0aW5nID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2Rpc2NvbnRpbnVlZC1za3VzLW1vZGFsJyk7XHJcbiAgaWYgKGV4aXN0aW5nKSBleGlzdGluZy5yZW1vdmUoKTtcclxuICBjb25zdCBlbCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpO1xyXG4gIGVsLmlkID0gJ2Rpc2NvbnRpbnVlZC1za3VzLW1vZGFsJztcclxuICBlbC5zdHlsZS5jc3NUZXh0ID1cclxuICAgICdwb3NpdGlvbjpmaXhlZDtpbnNldDowO2JhY2tncm91bmQ6cmdiYSgxNSwyMyw0MiwuNjUpO3otaW5kZXg6MjEwMDtkaXNwbGF5OmZsZXg7YWxpZ24taXRlbXM6Y2VudGVyO2p1c3RpZnktY29udGVudDpjZW50ZXI7cGFkZGluZzozdmgnO1xyXG4gIGVsLm9uY2xpY2sgPSAoZXYpID0+IHtcclxuICAgIGlmIChldi50YXJnZXQgPT09IGVsKSBlbC5yZW1vdmUoKTtcclxuICB9O1xyXG4gIGVsLmlubmVySFRNTCA9XHJcbiAgICAnPGRpdiBpZD1cImRpc2NvbnRpbnVlZC1tb2RhbC1jb250ZW50XCIgc3R5bGU9XCJiYWNrZ3JvdW5kOnZhcigtLWJnLWVsZXZhdGVkKTtib3JkZXItcmFkaXVzOjEycHg7cGFkZGluZzoyNHB4O21heC13aWR0aDo2NDBweDt3aWR0aDoxMDAlO21heC1oZWlnaHQ6OTB2aDtvdmVyZmxvdzphdXRvO2JveC1zaGFkb3c6MCAyMHB4IDYwcHggcmdiYSgwLDAsMCwuNClcIj48L2Rpdj4nO1xyXG4gIGRvY3VtZW50LmJvZHkuYXBwZW5kQ2hpbGQoZWwpO1xyXG4gIF9yZW5kZXJEaXNjb250aW51ZWRNb2RhbCgpO1xyXG59O1xyXG5cclxuZnVuY3Rpb24gX3JlbmRlckRpc2NvbnRpbnVlZE1vZGFsKCkge1xyXG4gIGNvbnN0IGNvbnQgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZGlzY29udGludWVkLW1vZGFsLWNvbnRlbnQnKTtcclxuICBpZiAoIWNvbnQpIHJldHVybjtcclxuICBjb25zdCBsaXN0ID0gX2Rpc2NvbnRpbnVlZFNrdXMgPyBBcnJheS5mcm9tKF9kaXNjb250aW51ZWRTa3VzKS5zb3J0KCkgOiBbXTtcclxuICAvLyBCdXNjYXIgZGVzY3JpcGNpXHUwMEYzbiBlbiBsb3Mgc2FsZXMgcGxhbnMgY2FjaGVzIHBvciBzaSBlc3RhIGNhcmdhZG9cclxuICBjb25zdCBza3VUb0Rlc2MgPSB7fTtcclxuICBmb3IgKGNvbnN0IGZhbSBvZiBbJ3JvZHMnLCAncmVlbHMnXSkge1xyXG4gICAgY29uc3QgY2FjaGUgPSBfc2FsZXNQbGFuQ2FjaGVzW2ZhbV07XHJcbiAgICBpZiAoY2FjaGUgJiYgY2FjaGUucm93cykge1xyXG4gICAgICBmb3IgKGNvbnN0IHIgb2YgY2FjaGUucm93cykge1xyXG4gICAgICAgIHNrdVRvRGVzY1tTdHJpbmcoci5za3UpLnRyaW0oKS50b1VwcGVyQ2FzZSgpXSA9IHIuZGVzY3JpcHRpb24gfHwgJyc7XHJcbiAgICAgIH1cclxuICAgIH1cclxuICB9XHJcbiAgY29uc3QgaGVhZCA9XHJcbiAgICAnPGRpdiBzdHlsZT1cImRpc3BsYXk6ZmxleDtqdXN0aWZ5LWNvbnRlbnQ6c3BhY2UtYmV0d2VlbjthbGlnbi1pdGVtczpjZW50ZXI7bWFyZ2luLWJvdHRvbToxNHB4XCI+JyArXHJcbiAgICAnPGRpdj48ZGl2IHN0eWxlPVwiZm9udC1zaXplOjE4cHg7Zm9udC13ZWlnaHQ6ODAwO2NvbG9yOnZhcigtLXRleHQtcHJpbWFyeSlcIj5TS1VzIGRlc2NvbnRpbnVhZG9zPC9kaXY+JyArXHJcbiAgICAnPGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMXB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO21hcmdpbi10b3A6MnB4XCI+JyArXHJcbiAgICBsaXN0Lmxlbmd0aCArXHJcbiAgICAnIFNLVXMgZXhjbHVpZG9zIGRlbCBjXHUwMEUxbGN1bG8gZGUgUmVjb21lbmRhY2lcdTAwRjNuIGRlIENvbXByYScgK1xyXG4gICAgJzwvZGl2PjwvZGl2PicgK1xyXG4gICAgJzxidXR0b24gb25jbGljaz1cImRvY3VtZW50LmdldEVsZW1lbnRCeUlkKFxcJ2Rpc2NvbnRpbnVlZC1za3VzLW1vZGFsXFwnKS5yZW1vdmUoKVwiIHN0eWxlPVwiYmFja2dyb3VuZDp0cmFuc3BhcmVudDtib3JkZXI6MXB4IHNvbGlkIHZhcigtLWJvcmRlci1zdWJ0bGUpO2JvcmRlci1yYWRpdXM6NnB4O3BhZGRpbmc6NnB4IDEycHg7Y3Vyc29yOnBvaW50ZXI7Zm9udC13ZWlnaHQ6NzAwXCI+Q2VycmFyPC9idXR0b24+JyArXHJcbiAgICAnPC9kaXY+JztcclxuICBjb25zdCBib2R5ID1cclxuICAgIGxpc3QubGVuZ3RoID09PSAwXHJcbiAgICAgID8gJzxkaXYgc3R5bGU9XCJwYWRkaW5nOjQwcHg7dGV4dC1hbGlnbjpjZW50ZXI7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZClcIj5ObyBoYXkgU0tVcyBkZXNjb250aW51YWRvcy48YnI+PGJyPlBvZFx1MDBFOXMgZGVzY29udGludWFyIFNLVXMgZGVzZGUgZWwgYm90XHUwMEYzbiBcdUQ4M0RcdURERDEgZW4gY2FkYSBmaWxhIGRlIGxhIHRhYmxhIFJlY29tZW5kYWNpXHUwMEYzbiBkZSBDb21wcmEuPC9kaXY+J1xyXG4gICAgICA6ICc8ZGl2IHN0eWxlPVwiZGlzcGxheTpmbGV4O2ZsZXgtZGlyZWN0aW9uOmNvbHVtbjtnYXA6NnB4XCI+JyArXHJcbiAgICAgICAgbGlzdFxyXG4gICAgICAgICAgLm1hcCgoc2t1KSA9PiB7XHJcbiAgICAgICAgICAgIGNvbnN0IGRlc2MgPSBza3VUb0Rlc2Nbc2t1XSB8fCAnJztcclxuICAgICAgICAgICAgcmV0dXJuIChcclxuICAgICAgICAgICAgICAnPGRpdiBzdHlsZT1cImRpc3BsYXk6ZmxleDthbGlnbi1pdGVtczpjZW50ZXI7Z2FwOjEwcHg7cGFkZGluZzoxMHB4IDEycHg7YmFja2dyb3VuZDp2YXIoLS1iZy1zZWNvbmRhcnkpO2JvcmRlci1yYWRpdXM6NnB4XCI+JyArXHJcbiAgICAgICAgICAgICAgJzxkaXYgc3R5bGU9XCJmbGV4OjFcIj48ZGl2IHN0eWxlPVwiZm9udC1mYW1pbHk6bW9ub3NwYWNlO2ZvbnQtd2VpZ2h0OjcwMDtjb2xvcjp2YXIoLS10ZXh0LXByaW1hcnkpXCI+JyArXHJcbiAgICAgICAgICAgICAgZXNjYXBlSHRtbFNhZmUoc2t1KSArXHJcbiAgICAgICAgICAgICAgJzwvZGl2PicgK1xyXG4gICAgICAgICAgICAgIChkZXNjXHJcbiAgICAgICAgICAgICAgICA/ICc8ZGl2IHN0eWxlPVwiZm9udC1zaXplOjExcHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7bWFyZ2luLXRvcDoycHhcIj4nICtcclxuICAgICAgICAgICAgICAgICAgZXNjYXBlSHRtbFNhZmUoZGVzYykgK1xyXG4gICAgICAgICAgICAgICAgICAnPC9kaXY+J1xyXG4gICAgICAgICAgICAgICAgOiAnJykgK1xyXG4gICAgICAgICAgICAgICc8L2Rpdj4nICtcclxuICAgICAgICAgICAgICAnPGJ1dHRvbiBvbmNsaWNrPVwicmVhY3RpdmF0ZVNrdShcXCcnICtcclxuICAgICAgICAgICAgICBlc2NhcGVIdG1sU2FmZShza3UpICtcclxuICAgICAgICAgICAgICAnXFwnKVwiIHN0eWxlPVwicGFkZGluZzo2cHggMTJweDtiYWNrZ3JvdW5kOiMxNmEzNGE7Y29sb3I6I2ZmZjtib3JkZXI6bm9uZTtib3JkZXItcmFkaXVzOjRweDtmb250LXNpemU6MTFweDtmb250LXdlaWdodDo3MDA7Y3Vyc29yOnBvaW50ZXJcIj5cdTIxQkIgUmVhY3RpdmFyPC9idXR0b24+JyArXHJcbiAgICAgICAgICAgICAgJzwvZGl2PidcclxuICAgICAgICAgICAgKTtcclxuICAgICAgICAgIH0pXHJcbiAgICAgICAgICAuam9pbignJykgK1xyXG4gICAgICAgICc8L2Rpdj4nO1xy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
