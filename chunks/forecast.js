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
    const upcomingBtn = '<button onclick="openUpcomingDiscontinuedModal()" style="padding:6px 12px;background:#2563eb;color:#fff;border:none;border-radius:6px;font-size:12px;font-weight:700;cursor:pointer" title="Marcar en bulk SKUs que se van a descontinuar">\u{1F4CB} Pr\xF3ximas descontinuaciones</button>';
    const header = '<div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-bottom:12px"><div style="flex:1;min-width:280px"><div style="font-size:18px;font-weight:800;color:var(--text-primary)">Recomendaci\xF3n de Compra</div><div style="font-size:11px;color:var(--text-muted);margin-top:2px">Balance = Stock + Tr\xE1nsito + Plan \u2212 Backorder \u2212 (Venta mens. \xD7 ' + RECO_HORIZON_MONTHS + "m)</div></div>" + upcomingBtn + '<div style="padding:6px 12px;background:#0d9488;color:#fff;border-radius:6px;font-size:12px;font-weight:700">' + _fmtInt(totalConReco) + ' SKUs con reco</div><div style="padding:6px 12px;background:#134e4a;color:#fff;border-radius:6px;font-size:12px;font-weight:700">\u03A3 ' + _fmtInt(totalReco) + " unidades</div>" + discChip + "</div>";
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
  var _upcomingSearchText = "";
  function _collectAllSkusFromSalesPlan() {
    const map = /* @__PURE__ */ new Map();
    for (const fam of ["rods", "reels"]) {
      const cache = _salesPlanCaches[fam];
      if (!cache || !Array.isArray(cache.rows)) continue;
      for (const r of cache.rows) {
        const sku = String(r.sku || "").trim();
        if (!sku) continue;
        const upper = sku.toUpperCase();
        map.set(upper, {
          sku,
          skuUpper: upper,
          description: r.description || "",
          familia: fam
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.skuUpper.localeCompare(b.skuUpper));
  }
  function _makeEl(tag, styleStr, textContent) {
    const el = document.createElement(tag);
    if (styleStr) el.style.cssText = styleStr;
    if (textContent != null) el.textContent = textContent;
    return el;
  }
  function _buildUpcomingRow(row, isDisc) {
    const label = _makeEl(
      "label",
      "display:flex;align-items:center;gap:10px;padding:8px 10px;background:" + (isDisc ? "rgba(147,51,234,.08)" : "var(--bg-secondary)") + ";border-radius:5px;cursor:pointer;transition:background .1s"
    );
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.setAttribute("data-upcoming-sku", row.skuUpper);
    cb.checked = !!isDisc;
    cb.style.cssText = "margin:0;flex-shrink:0;cursor:pointer;width:16px;height:16px";
    label.appendChild(cb);
    const badge = _makeEl(
      "span",
      "display:inline-block;padding:1px 6px;border-radius:8px;background:" + (row.familia === "rods" ? "#0ea5e9" : "#8b5cf6") + ";color:#fff;font-size:9px;font-weight:700;margin-right:6px",
      row.familia === "rods" ? "ROD" : "REEL"
    );
    label.appendChild(badge);
    const content = _makeEl("div", "flex:1;min-width:0");
    content.appendChild(
      _makeEl(
        "div",
        "font-family:monospace;font-weight:700;color:var(--text-primary);font-size:12px",
        row.sku
      )
    );
    if (row.description) {
      content.appendChild(
        _makeEl(
          "div",
          "font-size:11px;color:var(--text-muted);margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap",
          row.description
        )
      );
    }
    label.appendChild(content);
    return label;
  }
  function _renderUpcomingDiscontinuedListOnly() {
    const listEl = document.getElementById("upcoming-disc-list");
    if (!listEl) return;
    const all = _collectAllSkusFromSalesPlan();
    const q = _upcomingSearchText.toLowerCase();
    const filtered = q ? all.filter(
      (r) => r.skuUpper.toLowerCase().includes(q) || (r.description || "").toLowerCase().includes(q)
    ) : all;
    while (listEl.firstChild) listEl.removeChild(listEl.firstChild);
    if (filtered.length === 0) {
      const empty = _makeEl(
        "div",
        "padding:30px;text-align:center;color:var(--text-muted)",
        q ? 'Sin resultados para "' + _upcomingSearchText + '".' : "No hay SKUs cargados en el sales plan."
      );
      listEl.appendChild(empty);
      return;
    }
    const wrap = _makeEl("div", "display:flex;flex-direction:column;gap:3px");
    const currentSet = _discontinuedSkus || /* @__PURE__ */ new Set();
    for (const r of filtered) {
      wrap.appendChild(_buildUpcomingRow(r, currentSet.has(r.skuUpper)));
    }
    listEl.appendChild(wrap);
  }
  window.onUpcomingSearchChange = function(ev) {
    _upcomingSearchText = String(ev && ev.target && ev.target.value || "").trim();
    _renderUpcomingDiscontinuedListOnly();
  };
  function _renderUpcomingDiscontinuedModal() {
    const cont = document.getElementById("upcoming-disc-content");
    if (!cont) return;
    while (cont.firstChild) cont.removeChild(cont.firstChild);
    const all = _collectAllSkusFromSalesPlan();
    const nDiscCurrent = _discontinuedSkus ? _discontinuedSkus.size : 0;
    const head = _makeEl(
      "div",
      "display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:14px;flex-shrink:0"
    );
    const headLeft = _makeEl("div");
    headLeft.appendChild(
      _makeEl(
        "div",
        "font-size:18px;font-weight:800;color:var(--text-primary)",
        "Pr\xF3ximas descontinuaciones"
      )
    );
    headLeft.appendChild(
      _makeEl(
        "div",
        "font-size:11px;color:var(--text-muted);margin-top:2px",
        all.length + " SKUs en el sales plan actual \xB7 " + nDiscCurrent + " ya descontinuados. Marc\xE1 los que se vayan a descontinuar en los pr\xF3ximos meses \u2014 el forecast los va a desestimar en el c\xE1lculo de Recomendaci\xF3n de Compra."
      )
    );
    head.appendChild(headLeft);
    const closeBtn = _makeEl(
      "button",
      "background:transparent;border:1px solid var(--border-subtle);border-radius:6px;padding:6px 12px;cursor:pointer;font-weight:700;flex-shrink:0",
      "\u2715"
    );
    closeBtn.onclick = () => {
      const m = document.getElementById("upcoming-disc-modal");
      if (m) m.remove();
    };
    head.appendChild(closeBtn);
    cont.appendChild(head);
    const searchInp = document.createElement("input");
    searchInp.type = "text";
    searchInp.placeholder = "Buscar SKU o descripci\xF3n...";
    searchInp.value = _upcomingSearchText;
    searchInp.oninput = window.onUpcomingSearchChange;
    searchInp.style.cssText = "width:100%;padding:8px 12px;border:1px solid var(--border-subtle);border-radius:6px;font-size:13px;background:var(--bg-elevated);color:var(--text-primary);margin-bottom:10px;flex-shrink:0;box-sizing:border-box";
    cont.appendChild(searchInp);
    const list = _makeEl("div", "flex:1 1 0;overflow-y:auto;min-height:0");
    list.id = "upcoming-disc-list";
    cont.appendChild(list);
    const foot = _makeEl(
      "div",
      "display:flex;justify-content:space-between;align-items:center;gap:10px;padding-top:14px;border-top:1px solid var(--border-subtle);margin-top:12px;flex-shrink:0"
    );
    foot.appendChild(
      _makeEl(
        "div",
        "font-size:11px;color:var(--text-muted)",
        "Se guarda en forecast_config/discontinued_skus. Reversible desde el chip \u{1F6AB} descontinuados."
      )
    );
    const btnWrap = _makeEl("div", "display:flex;gap:8px");
    const cancelBtn = _makeEl(
      "button",
      "padding:8px 14px;background:transparent;border:1px solid var(--border-subtle);border-radius:6px;cursor:pointer;font-weight:700;color:var(--text-primary)",
      "Cancelar"
    );
    cancelBtn.onclick = () => {
      const m = document.getElementById("upcoming-disc-modal");
      if (m) m.remove();
    };
    btnWrap.appendChild(cancelBtn);
    const saveBtn = _makeEl(
      "button",
      "padding:8px 16px;background:#2563eb;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:700",
      "Guardar cambios"
    );
    saveBtn.id = "upcoming-save-btn";
    saveBtn.onclick = window.saveUpcomingDiscontinuedChanges;
    btnWrap.appendChild(saveBtn);
    foot.appendChild(btnWrap);
    cont.appendChild(foot);
    _renderUpcomingDiscontinuedListOnly();
  }
  window.openUpcomingDiscontinuedModal = function() {
    _upcomingSearchText = "";
    const existing = document.getElementById("upcoming-disc-modal");
    if (existing) existing.remove();
    const el = document.createElement("div");
    el.id = "upcoming-disc-modal";
    el.style.cssText = "position:fixed;inset:0;background:rgba(15,23,42,.65);z-index:2100;display:flex;align-items:center;justify-content:center;padding:3vh";
    el.onclick = (ev) => {
      if (ev.target === el) el.remove();
    };
    const content = document.createElement("div");
    content.id = "upcoming-disc-content";
    content.style.cssText = "background:var(--bg-elevated);border-radius:12px;padding:24px;max-width:760px;width:100%;max-height:90vh;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,.4)";
    el.appendChild(content);
    document.body.appendChild(el);
    _renderUpcomingDiscontinuedModal();
  };
  window.saveUpcomingDiscontinuedChanges = async function() {
    const btn = document.getElementById("upcoming-save-btn");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Guardando\u2026";
      btn.style.opacity = ".6";
    }
    const allInDom = document.querySelectorAll("[data-upcoming-sku]");
    const seenInDom = /* @__PURE__ */ new Set();
    const checkedInDom = /* @__PURE__ */ new Set();
    allInDom.forEach((cb) => {
      const sku = String(cb.getAttribute("data-upcoming-sku") || "").trim().toUpperCase();
      if (!sku) return;
      seenInDom.add(sku);
      if (cb.checked) checkedInDom.add(sku);
    });
    if (!_discontinuedSkus) _discontinuedSkus = /* @__PURE__ */ new Set();
    const prev = new Set(_discontinuedSkus);
    checkedInDom.forEach((sku) => _discontinuedSkus.add(sku));
    seenInDom.forEach((sku) => {
      if (!checkedInDom.has(sku)) _discontinuedSkus.delete(sku);
    });
    try {
      await _saveDiscontinuedSkus();
      const modal = document.getElementById("upcoming-disc-modal");
      if (modal) modal.remove();
      _renderRecoSection();
    } catch (e) {
      _discontinuedSkus = prev;
      if (btn) {
        btn.disabled = false;
        btn.textContent = "Guardar cambios";
        btn.style.opacity = "1";
      }
      alert("Error guardando: " + (e.message || e));
    }
  };
})();
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL3B1cmUvc2FsZXMtcGxhbi1wYXJzZXIuanMiLCAiLi4vc3JjL2RvbWFpbnMvZm9yZWNhc3QuanMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbIi8vIEB0cy1ub2NoZWNrXG4vLyBQdXJlOiBwYXJzZWEgdW4gc2hlZXQgU2FsZXMgUGxhbiAoZm9ybWF0byBTVVIvU0FSIGRlIFNoaW1hbm8pIGEgZXN0cnVjdHVyYVxuLy8gbm9ybWFsaXphZGEgeyBza3UsIGRlc2NyaXB0aW9uLCBtb3EsIG1vbnRoczogeydZWVlZLU1NJzogTn0gfS5cbi8vIFNpbiBkZXBlbmRlbmNpYXMgXHUyMDE0IHJlY2liZSBlbCBzaGVldCB5YSBkZXNlcmlhbGl6YWRvIHBvciBTaGVldEpTXG4vLyAoWExTWC51dGlscy5zaGVldF90b19qc29uKHNoZWV0LCB7aGVhZGVyOjEsIGRlZnZhbDonJ30pKS5cbi8vIFRlc3RlYWJsZSBlbiB2aXRlc3Qgc2luIGNhcmdhciBYTFNYLlxuLy9cbi8vIENvbnRleHRvOiBsb3MgU2FsZXMgUGxhbnMgZGUgU2hpbWFubyB2aWVuZW4gY29uIGhlYWRlcnMgY29tb1xuLy8gXCJTS1UgQ29kZS9QYXJ0IE5vXCIsIFwiRGVzY3JpcHRpb25cIiwgXCJNT1EgMTIgbW9udGhzXCIgeSBjb2x1bW5hcyBkZSBtZXNlc1xuLy8gdGlwbyBcIkphbiAyMDI3XCIsIFwiTWF5IDIwMjdcIiAoYSB2ZWNlcyBjb24gYVx1MDBGMW8gZW4gdW5hIGZpbGEgYXJyaWJhIHkgZWwgbWVzXG4vLyBlbiBsYSBmaWxhIGhlYWRlcikuIEVzdGEgZm4gdG9sZXJhIGFtYm9zIGxheW91dHMuXG5cbmNvbnN0IE1PTlRIX0FMSUFTRVMgPSB7XG4gIGphbjogMSxcbiAgamFudWFyeTogMSxcbiAgZW5lOiAxLFxuICBlbmVybzogMSxcbiAgZmViOiAyLFxuICBmZWJydWFyeTogMixcbiAgZmVicmVybzogMixcbiAgbWFyOiAzLFxuICBtYXJjaDogMyxcbiAgbWFyem86IDMsXG4gIGFwcjogNCxcbiAgYXByaWw6IDQsXG4gIGFicjogNCxcbiAgYWJyaWw6IDQsXG4gIG1heTogNSxcbiAgbWF5bzogNSxcbiAganVuOiA2LFxuICBqdW5lOiA2LFxuICBqdW5pbzogNixcbiAganVsOiA3LFxuICBqdWx5OiA3LFxuICBqdWxpbzogNyxcbiAgYXVnOiA4LFxuICBhdWd1c3Q6IDgsXG4gIGFnbzogOCxcbiAgYWdvc3RvOiA4LFxuICBzZXA6IDksXG4gIHNlcHQ6IDksXG4gIHNlcHRlbWJlcjogOSxcbiAgc2VwdGllbWJyZTogOSxcbiAgb2N0OiAxMCxcbiAgb2N0b2JlcjogMTAsXG4gIG9jdHVicmU6IDEwLFxuICBub3Y6IDExLFxuICBub3ZlbWJlcjogMTEsXG4gIG5vdmllbWJyZTogMTEsXG4gIGRlYzogMTIsXG4gIGRlY2VtYmVyOiAxMixcbiAgZGljOiAxMixcbiAgZGljaWVtYnJlOiAxMixcbn07XG5cbi8vIE5vcm1hbGl6YSBsYWJlbHMgZGUgbWVzZXMgYSAnWVlZWS1NTScuIFJldG9ybmEgbnVsbCBzaSBubyBtYXRjaGVhLlxuLy8gRm9ybWF0b3Mgc29wb3J0YWRvczogXCJKYW4gMjAyN1wiLCBcIkVuZS0yN1wiLCBcIkphbi8yMDI3XCIsIFwiTWF5MjdcIixcbi8vIFwiMjAyNy0wMVwiLCBcIjAxLzIwMjdcIiwgXCJKYW4uMjAyN1wiLCBcIjIwMjFcXG5KYW5cIiAobXVsdGktbGluZSBFeGNlbCkuXG5mdW5jdGlvbiBub3JtYWxpemVNb250aExhYmVsKGxhYmVsKSB7XG4gIGlmIChsYWJlbCA9PSBudWxsKSByZXR1cm4gbnVsbDtcbiAgLy8gdjExMDQ6IGNvbGFwc2FyIG5ld2xpbmVzL3RhYnMgYSBlc3BhY2lvIGFudGVzIGRlbCB0cmltLlxuICAvLyBFbCBmb3JtYXRvIEV4Y2VsIFwiMjAyMVxcbkphblwiIChhXHUwMEYxbyBlbiBMMSwgbWVzIGVuIEwyIGRlbnRybyBkZSB1bmEgY2VsZGFcbiAgLy8gbXVsdGktcm93KSBlcyBjb21cdTAwRkFuIGVuIFNhbGVzIFBsYW5zIFNVUi4gYFxccytgIG1hdGNoZWEgd2hpdGVzcGFjZSBpbmNsdXllbmRvXG4gIC8vIFxcbiB5IFxcclxcbi5cbiAgY29uc3QgcyA9IFN0cmluZyhsYWJlbCkucmVwbGFjZSgvXFxzKy9nLCAnICcpLnRyaW0oKS50b0xvd2VyQ2FzZSgpO1xuICBpZiAoIXMpIHJldHVybiBudWxsO1xuICBsZXQgbTtcbiAgLy8gXCJqYW4gMjAyN1wiIHwgXCJqYW4tMjdcIiB8IFwiZW5lLzIwMjdcIiB8IFwibWF5MjdcIiB8IFwibWF5LjIwMjdcIlxuICBtID0gcy5tYXRjaCgvXihbYS16XHUwMEUxXHUwMEU5XHUwMEVEXHUwMEYzXHUwMEZBXXszLDEwfSlbXFxzXFwtLy5fXSooXFxkezIsNH0pJC8pO1xuICBpZiAobSkge1xuICAgIGNvbnN0IG1vbiA9IE1PTlRIX0FMSUFTRVNbbVsxXV0gfHwgTU9OVEhfQUxJQVNFU1ttWzFdLnNsaWNlKDAsIDMpXTtcbiAgICBpZiAobW9uKSB7XG4gICAgICBsZXQgeSA9IHBhcnNlSW50KG1bMl0sIDEwKTtcbiAgICAgIGlmICh5IDwgMTAwKSB5ID0gMjAwMCArIHk7XG4gICAgICByZXR1cm4gU3RyaW5nKHkpLnBhZFN0YXJ0KDQsICcwJykgKyAnLScgKyBTdHJpbmcobW9uKS5wYWRTdGFydCgyLCAnMCcpO1xuICAgIH1cbiAgfVxuICAvLyBcIjIwMjEgamFuXCIgfCBcIjIwMjcgZGljXCIgKGFcdTAwRjFvIHByaW1lcm8gKyBtZXMsIGZvcm1hdG8gRXhjZWwgbXVsdGktbGluZVxuICAvLyBjb2xhcHNhZG8gdHJhcyByZXBsYWNlIFxccyspLlxuICBtID0gcy5tYXRjaCgvXihcXGR7NH0pW1xcc1xcLS8uX10rKFthLXpcdTAwRTFcdTAwRTlcdTAwRURcdTAwRjNcdTAwRkFdezMsMTB9KSQvKTtcbiAgaWYgKG0pIHtcbiAgICBjb25zdCB5ID0gcGFyc2VJbnQobVsxXSwgMTApO1xuICAgIGNvbnN0IG1vbiA9IE1PTlRIX0FMSUFTRVNbbVsyXV0gfHwgTU9OVEhfQUxJQVNFU1ttWzJdLnNsaWNlKDAsIDMpXTtcbiAgICBpZiAobW9uKSByZXR1cm4gU3RyaW5nKHkpLnBhZFN0YXJ0KDQsICcwJykgKyAnLScgKyBTdHJpbmcobW9uKS5wYWRTdGFydCgyLCAnMCcpO1xuICB9XG4gIC8vIFwiMjAyNy0wMVwiIHwgXCIyMDI3LzAxXCJcbiAgbSA9IHMubWF0Y2goL14oXFxkezR9KVstL10oXFxkezEsMn0pJC8pO1xuICBpZiAobSkge1xuICAgIGNvbnN0IHkgPSBwYXJzZUludChtWzFdLCAxMCk7XG4gICAgY29uc3QgbW9uID0gcGFyc2VJbnQobVsyXSwgMTApO1xuICAgIGlmIChtb24gPj0gMSAmJiBtb24gPD0gMTIpXG4gICAgICByZXR1cm4gU3RyaW5nKHkpLnBhZFN0YXJ0KDQsICcwJykgKyAnLScgKyBTdHJpbmcobW9uKS5wYWRTdGFydCgyLCAnMCcpO1xuICB9XG4gIC8vIFwiMDEvMjAyN1wiIHwgXCIwMS0yMDI3XCJcbiAgbSA9IHMubWF0Y2goL14oXFxkezEsMn0pWy0vXShcXGR7NH0pJC8pO1xuICBpZiAobSkge1xuICAgIGNvbnN0IG1vbiA9IHBhcnNlSW50KG1bMV0sIDEwKTtcbiAgICBjb25zdCB5ID0gcGFyc2VJbnQobVsyXSwgMTApO1xuICAgIGlmIChtb24gPj0gMSAmJiBtb24gPD0gMTIpXG4gICAgICByZXR1cm4gU3RyaW5nKHkpLnBhZFN0YXJ0KDQsICcwJykgKyAnLScgKyBTdHJpbmcobW9uKS5wYWRTdGFydCgyLCAnMCcpO1xuICB9XG4gIHJldHVybiBudWxsO1xufVxuXG4vLyBCdXNjYSBsYSBmaWxhIGhlYWRlciAoMC1iYXNlZCkuIEVzY2FuZWEgbGFzIHByaW1lcmFzIDMwIGZpbGFzLlxuZnVuY3Rpb24gZmluZEhlYWRlclJvdyhyb3dzKSB7XG4gIGNvbnN0IEhFQURFUl9NQVJLRVJTID0gW1xuICAgICdza3UgY29kZS9wYXJ0IG5vJyxcbiAgICAnc2t1IGNvZGUnLFxuICAgICdza3UnLFxuICAgICdwYXJ0IG5vJyxcbiAgICAncGFydCBudW1iZXInLFxuICAgICdpdGVtY29kZScsXG4gICAgJ2l0ZW0gY29kZScsXG4gICAgJ2NvZGlnbycsXG4gICAgJ2NcdTAwRjNkaWdvJyxcbiAgXTtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBNYXRoLm1pbihyb3dzLmxlbmd0aCwgMzApOyBpKyspIHtcbiAgICBjb25zdCByb3cgPSByb3dzW2ldIHx8IFtdO1xuICAgIGZvciAoY29uc3QgY2VsbCBvZiByb3cpIHtcbiAgICAgIC8vIHYxMTA0OiBjb2xhcHNhciBuZXdsaW5lcyBhIGVzcGFjaW8gcGFyYSBtYXRjaGVhciBoZWFkZXJzIGNvbW9cbiAgICAgIC8vIFwiU0tVIENvZGUvUGFydCBOb1wiIChvaykgbyBcIlNLVVxcbkNvZGVcIiAobmVjZXNpdGEgY29sYXBzYXIpLlxuICAgICAgY29uc3QgcyA9IFN0cmluZyhjZWxsID09IG51bGwgPyAnJyA6IGNlbGwpXG4gICAgICAgIC5yZXBsYWNlKC9cXHMrL2csICcgJylcbiAgICAgICAgLnRyaW0oKVxuICAgICAgICAudG9Mb3dlckNhc2UoKTtcbiAgICAgIGlmIChIRUFERVJfTUFSS0VSUy5pbmRleE9mKHMpID49IDApIHJldHVybiBpO1xuICAgIH1cbiAgfVxuICByZXR1cm4gLTE7XG59XG5cbi8vIERldGVjdGEgXHUwMEVEbmRpY2VzIGRlIGNvbHVtbmFzIHkgbWVzZXMuIGBoaW50Um93QWJvdmVgIHBlcm1pdGUgY29tYmluYXIgYVx1MDBGMW8vbWVzXG4vLyBjdWFuZG8gZWwgaGVhZGVyIGVzIG11bHRpLXJvdyAoYVx1MDBGMW8gYXJyaWJhLCBtZXMgYWJham8gbyB2aWNldmVyc2EpLlxuZnVuY3Rpb24gZGV0ZWN0Q29sdW1ucyhoZWFkZXJSb3csIGhpbnRSb3dBYm92ZSkge1xuICBsZXQgc2t1SWR4ID0gLTE7XG4gIGxldCBkZXNjSWR4ID0gLTE7XG4gIGxldCBtb3FJZHggPSAtMTtcbiAgY29uc3QgbW9udGhDb2x1bW5zID0gW107XG4gIGNvbnN0IGRldGVjdGVkTW9udGhzU2V0ID0gbmV3IFNldCgpO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IGhlYWRlclJvdy5sZW5ndGg7IGkrKykge1xuICAgIC8vIHYxMTA0OiBjb2xhcHNhciBuZXdsaW5lcyBhIGVzcGFjaW8gYW50ZXMgZGUgY29tcGFyYXIuIExvcyBTYWxlcyBQbGFuXG4gICAgLy8gU1VSIHRpZW5lbiBoZWFkZXJzIG11bHRpLWxpbmUgY29tbyBcIk1PUVxcbjEyIG1vbnRoc1wiIG8gXCJCYXNlXFxuRk9CKFVTRClcIi5cbiAgICBjb25zdCByYXcgPSBTdHJpbmcoaGVhZGVyUm93W2ldID09IG51bGwgPyAnJyA6IGhlYWRlclJvd1tpXSlcbiAgICAgIC5yZXBsYWNlKC9cXHMrL2csICcgJylcbiAgICAgIC50cmltKCk7XG4gICAgY29uc3QgcyA9IHJhdy50b0xvd2VyQ2FzZSgpO1xuICAgIGlmIChcbiAgICAgIHNrdUlkeCA8IDAgJiZcbiAgICAgIChzID09PSAnc2t1IGNvZGUvcGFydCBubycgfHxcbiAgICAgICAgcyA9PT0gJ3NrdSBjb2RlJyB8fFxuICAgICAgICBzID09PSAnc2t1JyB8fFxuICAgICAgICBzID09PSAncGFydCBubycgfHxcbiAgICAgICAgcyA9PT0gJ3BhcnQgbnVtYmVyJyB8fFxuICAgICAgICBzID09PSAnaXRlbWNvZGUnIHx8XG4gICAgICAgIHMgPT09ICdpdGVtIGNvZGUnIHx8XG4gICAgICAgIHMgPT09ICdjb2RpZ28nIHx8XG4gICAgICAgIHMgPT09ICdjXHUwMEYzZGlnbycpXG4gICAgKSB7XG4gICAgICBza3VJZHggPSBpO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChcbiAgICAgIGRlc2NJZHggPCAwICYmXG4gICAgICAocyA9PT0gJ2Rlc2NyaXB0aW9uJyB8fFxuICAgICAgICBzID09PSAnZGVzY3JpcGNpb24nIHx8XG4gICAgICAgIHMgPT09ICdkZXNjcmlwY2lcdTAwRjNuJyB8fFxuICAgICAgICBzID09PSAnaXRlbSBuYW1lJyB8fFxuICAgICAgICBzID09PSAnaXRlbW5hbWUnKVxuICAgICkge1xuICAgICAgZGVzY0lkeCA9IGk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKG1vcUlkeCA8IDAgJiYgKHMgPT09ICdtb3EgMTIgbW9udGhzJyB8fCBzID09PSAnbW9xJyB8fCBzLmluZGV4T2YoJ21vcScpID09PSAwKSkge1xuICAgICAgbW9xSWR4ID0gaTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICAvLyBUcnkgZGlyZWN0IG1vbnRoIHBhcnNlXG4gICAgbGV0IG1vbnRoS2V5ID0gbm9ybWFsaXplTW9udGhMYWJlbChyYXcpO1xuICAgIGlmICghbW9udGhLZXkgJiYgaGludFJvd0Fib3ZlICYmIGhpbnRSb3dBYm92ZVtpXSAhPSBudWxsKSB7XG4gICAgICBjb25zdCBoaW50ID0gU3RyaW5nKGhpbnRSb3dBYm92ZVtpXSkudHJpbSgpO1xuICAgICAgaWYgKGhpbnQpIHtcbiAgICAgICAgbW9udGhLZXkgPSBub3JtYWxpemVNb250aExhYmVsKHJhdyArICcgJyArIGhpbnQpIHx8IG5vcm1hbGl6ZU1vbnRoTGFiZWwoaGludCArICcgJyArIHJhdyk7XG4gICAgICB9XG4gICAgfVxuICAgIGlmIChtb250aEtleSkge1xuICAgICAgbW9udGhDb2x1bW5zLnB1c2goeyBjb2xJZHg6IGksIG1vbnRoS2V5IH0pO1xuICAgICAgZGV0ZWN0ZWRNb250aHNTZXQuYWRkKG1vbnRoS2V5KTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHtcbiAgICBza3VJZHgsXG4gICAgZGVzY0lkeCxcbiAgICBtb3FJZHgsXG4gICAgbW9udGhDb2x1bW5zLFxuICAgIGRldGVjdGVkTW9udGhzOiBBcnJheS5mcm9tKGRldGVjdGVkTW9udGhzU2V0KS5zb3J0KCksXG4gIH07XG59XG5cbi8vIFB1YmxpYzogcGFyc2UgZnVsbCBzaGVldC4gVGhyb3dzIG9uIG1pc3NpbmcgU0tVIGNvbHVtbiAvIG1vbnRocy5cbmZ1bmN0aW9uIHBhcnNlU2FsZXNQbGFuU2hlZXQocm93cykge1xuICBpZiAoIXJvd3MgfHwgIXJvd3MubGVuZ3RoKSB7XG4gICAgY29uc3QgZXJyID0gbmV3IEVycm9yKCdFeGNlbCB2YWNpbycpO1xuICAgIGVyci5jb2RlID0gJ0VNUFRZX1NIRUVUJztcbiAgICB0aHJvdyBlcnI7XG4gIH1cbiAgY29uc3QgaGVhZGVySWR4ID0gZmluZEhlYWRlclJvdyhyb3dzKTtcbiAgaWYgKGhlYWRlcklkeCA8IDApIHtcbiAgICBjb25zdCBlcnIgPSBuZXcgRXJyb3IoJ05vIHNlIGVuY29udHJvIGZpbGEgZGUgaGVhZGVycyAoYnVzY2FiYSBcIlNLVSBDb2RlL1BhcnQgTm9cIiBvIFwiU0tVXCIpJyk7XG4gICAgZXJyLmNvZGUgPSAnSEVBREVSX05PVF9GT1VORCc7XG4gICAgdGhyb3cgZXJyO1xuICB9XG4gIGNvbnN0IGhlYWRlclJvdyA9IHJvd3NbaGVhZGVySWR4XSB8fCBbXTtcbiAgY29uc3Qgcm93QWJvdmUgPSBoZWFkZXJJZHggPiAwID8gcm93c1toZWFkZXJJZHggLSAxXSB8fCBbXSA6IG51bGw7XG4gIGNvbnN0IGNvbHMgPSBkZXRlY3RDb2x1bW5zKGhlYWRlclJvdywgcm93QWJvdmUpO1xuICBpZiAoY29scy5za3VJZHggPCAwKSB7XG4gICAgY29uc3QgZXJyID0gbmV3IEVycm9yKCdObyBzZSBlbmNvbnRybyBjb2x1bW5hIFNLVSBlbiBsYSBmaWxhIGhlYWRlcicpO1xuICAgIGVyci5jb2RlID0gJ1NLVV9DT0xfTUlTU0lORyc7XG4gICAgdGhyb3cgZXJyO1xuICB9XG4gIGlmICghY29scy5tb250aENvbHVtbnMubGVuZ3RoKSB7XG4gICAgY29uc3QgZXJyID0gbmV3IEVycm9yKFxuICAgICAgJ05vIHNlIGRldGVjdGFyb24gY29sdW1uYXMgZGUgbWVzZXMgZW4gZWwgaGVhZGVyIChlajogXCJKYW4gMjAyN1wiLCBcIk1heSAyMDI3XCIpJ1xuICAgICk7XG4gICAgZXJyLmNvZGUgPSAnTU9OVEhTX05PVF9GT1VORCc7XG4gICAgdGhyb3cgZXJyO1xuICB9XG4gIGNvbnN0IHBhcnNlZFJvd3MgPSBbXTtcbiAgY29uc3Qgc2VlblNrdSA9IG5ldyBTZXQoKTtcbiAgZm9yIChsZXQgciA9IGhlYWRlcklkeCArIDE7IHIgPCByb3dzLmxlbmd0aDsgcisrKSB7XG4gICAgY29uc3Qgcm93ID0gcm93c1tyXSB8fCBbXTtcbiAgICBjb25zdCBza3VSYXcgPSByb3dbY29scy5za3VJZHhdO1xuICAgIGlmIChza3VSYXcgPT0gbnVsbCB8fCBTdHJpbmcoc2t1UmF3KS50cmltKCkgPT09ICcnKSBjb250aW51ZTtcbiAgICBjb25zdCBza3UgPSBTdHJpbmcoc2t1UmF3KS50cmltKCk7XG4gICAgY29uc3QgdXBwZXIgPSBza3UudG9VcHBlckNhc2UoKTtcbiAgICAvLyBTa2lwIGZpbGFzIFRPVEFMIC8gU1VNIC8gU1VCVE9UQUxcbiAgICBpZiAodXBwZXIgPT09ICdUT1RBTCcgfHwgdXBwZXIgPT09ICdTVU0nIHx8IHVwcGVyID09PSAnU1VCVE9UQUwnIHx8IHVwcGVyID09PSAnVE9UQUxFUycpXG4gICAgICBjb250aW51ZTtcbiAgICBpZiAoc2VlblNrdS5oYXModXBwZXIpKSBjb250aW51ZTsgLy8gZGVkdXBlXG4gICAgc2VlblNrdS5hZGQodXBwZXIpO1xuICAgIGNvbnN0IGRlc2NyaXB0aW9uID1cbiAgICAgIGNvbHMuZGVzY0lkeCA+PSAwID8gU3RyaW5nKHJvd1tjb2xzLmRlc2NJZHhdID09IG51bGwgPyAnJyA6IHJvd1tjb2xzLmRlc2NJZHhdKS50cmltKCkgOiAnJztcbiAgICBjb25zdCBtb3FSYXcgPSBjb2xzLm1vcUlkeCA+PSAwID8gcm93W2NvbHMubW9xSWR4XSA6IG51bGw7XG4gICAgY29uc3QgbW9xTnVtID0gTnVtYmVyKG1vcVJhdyk7XG4gICAgY29uc3QgbW9xID0gTnVtYmVyLmlzRmluaXRlKG1vcU51bSkgJiYgbW9xTnVtID4gMCA/IE1hdGgucm91bmQobW9xTnVtKSA6IDA7XG4gICAgY29uc3QgbW9udGhzID0ge307XG4gICAgZm9yIChjb25zdCBtYyBvZiBjb2xzLm1vbnRoQ29sdW1ucykge1xuICAgICAgY29uc3QgdiA9IHJvd1ttYy5jb2xJZHhdO1xuICAgICAgY29uc3QgbiA9IE51bWJlcih2KTtcbiAgICAgIGlmIChOdW1iZXIuaXNGaW5pdGUobikgJiYgbiA+IDApIHtcbiAgICAgICAgbW9udGhzW21jLm1vbnRoS2V5XSA9IE1hdGgucm91bmQobik7XG4gICAgICB9XG4gICAgfVxuICAgIHBhcnNlZFJvd3MucHVzaCh7IHNrdSwgZGVzY3JpcHRpb24sIG1vcSwgbW9udGhzIH0pO1xuICB9XG4gIHJldHVybiB7XG4gICAgaGVhZGVyUm93SW5kZXg6IGhlYWRlcklkeCxcbiAgICBkZXRlY3RlZE1vbnRoczogY29scy5kZXRlY3RlZE1vbnRocyxcbiAgICByb3dzQ291bnQ6IHBhcnNlZFJvd3MubGVuZ3RoLFxuICAgIHJvd3M6IHBhcnNlZFJvd3MsXG4gIH07XG59XG5cbi8vIFVNRC1pc2ggZXhwb3J0OiBwYXJhIHZpdGVzdCAobW9kdWxlLmV4cG9ydHMpIHkgcGFyYSBidW5kbGUgYnJvd3NlciAod2luZG93IGdsb2JhbCkuXG5pZiAodHlwZW9mIG1vZHVsZSAhPT0gJ3VuZGVmaW5lZCcgJiYgbW9kdWxlLmV4cG9ydHMpIHtcbiAgbW9kdWxlLmV4cG9ydHMgPSB7IHBhcnNlU2FsZXNQbGFuU2hlZXQsIG5vcm1hbGl6ZU1vbnRoTGFiZWwsIGZpbmRIZWFkZXJSb3csIGRldGVjdENvbHVtbnMgfTtcbn1cbmlmICh0eXBlb2Ygd2luZG93ICE9PSAndW5kZWZpbmVkJykge1xuICB3aW5kb3cuU2FsZXNQbGFuUGFyc2VyID0ge1xuICAgIHBhcnNlU2FsZXNQbGFuU2hlZXQsXG4gICAgbm9ybWFsaXplTW9udGhMYWJlbCxcbiAgICBmaW5kSGVhZGVyUm93LFxuICAgIGRldGVjdENvbHVtbnMsXG4gIH07XG59XG5cbmV4cG9ydCB7IGRldGVjdENvbHVtbnMsIGZpbmRIZWFkZXJSb3csIG5vcm1hbGl6ZU1vbnRoTGFiZWwsIHBhcnNlU2FsZXNQbGFuU2hlZXQgfTtcbiIsICIvLyBAdHMtbm9jaGVja1xyXG4vLyB2MTA5OCsgRmFzZSAxOiBpbXBvcnQgZGVsIHBhcnNlciBwdXJvLiBFbCBtXHUwMEYzZHVsbyBoYWNlIGB3aW5kb3cuU2FsZXNQbGFuUGFyc2VyYFxyXG4vLyBjb21vIHNpZGUtZWZmZWN0IHkgdGFtYmlcdTAwRTluIGV4cG9ydGEgbGFzIGZucyBub21icmFkYXM7IHVzYW1vcyBzaWRlLWVmZmVjdFxyXG4vLyBwb3JxdWUgZm9yZWNhc3QuanMgY29ycmUgZW4gZWwgY2h1bmsgbGF6eSB5IHdpbmRvdyB5YSBlc3RcdTAwRTEgZGlzcG9uaWJsZS5cclxuaW1wb3J0ICcuLi9wdXJlL3NhbGVzLXBsYW4tcGFyc2VyLmpzJztcclxuXHJcbi8vIEdsb2JhbHMgbGVpZG9zIGRlbCBlbnRvcm5vIChkZWNsYXJhZG9zIGVuIGluZGV4Lmh0bWwgaW5saW5lIG8gYnVuZGxlIHByZXZpbyk6XHJcbi8vIGZiRGIsIGN1cnJlbnRVc2VyLCBYTFNYIChjZG4pLCBlc2NhcGVIdG1sLiBNaXNtbyBwYXRyb24gcXVlIG90cm9zIGRvbWluaW9zLlxyXG4vL1xyXG4vLyBGT1JFQ0FTVCAtIG1vZGFsIGFkbWluLW9ubHkgKE1hcmlhbm8pLiBDaHVuayBsYXp5OiBzZSBjYXJnYSBzb2xvIGFsIHByaW1lclxyXG4vLyBjbGljayBkZWwgYm90b24gRk9SRUNBU1QgZGVsIGhlYWRlci4gUmVnaXN0cmFkbyBlbiBidWlsZC5qcyBMQVpZX0NIVU5LUyArXHJcbi8vIHNyYy9tYWluLmpzIGluc3RhbGxDaHVua1N0dWJzICsgc3cuanMgU1RBVElDX0FTU0VUUy4gVmVyIENMQVVERS5tZCAjMTguXHJcbi8vXHJcbi8vIHYxMTExIGNsZWFuOiBwaXBlbGluZSBsZWdhY3kgKFNLVSArIDYgY29sdW1uYXMgKyBwb2xpdGljYSAzbSkgcmVtb3ZpZG8uXHJcbi8vIFJlZW1wbGF6YWRvIHBvcjpcclxuLy8gICAtIEZhc2UgMSAodjEwOTgpOiBTYWxlcyBQbGFucyBtZW5zdWFsZXMgUm9kcy9SZWVscyBjb24gZm9ybWF0byBTVVIuXHJcbi8vICAgLSBGYXNlIDJCICh2MTEwMyk6IEZvcmVjYXN0IEVzdGFkaXN0aWNvIChzdGF0c2ZvcmVjYXN0IHBpcGVsaW5lIG9mZmxpbmUpLlxyXG4vLyAgIC0gRmFzZSAzQSAodjExMDkpOiBUYWJsYSBSZWNvbWVuZGFjaW9uIGRlIENvbXByYS5cclxuXHJcbi8vIHYxMDk4KyAoRmFzZSAxIEZvcmVjYXN0IHYyKTogU2FsZXMgUGxhbnMgbWVuc3VhbGVzIHBvciBmYW1pbGlhIChSb2RzL1JlZWxzL0ZHKS5cclxuLy8gU2UgZ3VhcmRhbiBlbiBGaXJlc3RvcmUgYHNhbGVzX3BsYW5fY2FjaGUve2ZhbWlsaWF9YCArIHNuYXBzaG90IEV4Y2VsIG9yaWdpbmFsXHJcbi8vIGVuIFN0b3JhZ2UgYGZvcmVjYXN0c19zbmFwc2hvdHMve1lZWVktTU19L3tmYW1pbGlhfS54bHN4YC5cclxuLy8gRWwgcGFyc2VyIHB1cm8gdml2ZSBlbiBzcmMvcHVyZS9zYWxlcy1wbGFuLXBhcnNlci5qcyAoYXR0YWNoIGEgd2luZG93LlNhbGVzUGxhblBhcnNlcikuXHJcbi8vIHYxMTA4OiBGRyByZW1vdmlkbyBkZWwgVUkgKE1hcmlhbm8gcGlkaVx1MDBGMykuIFNvbG8gUm9kcyArIFJlZWxzIHBvciBhaG9yYS5cclxuLy8gTGEgcnVsZSBGaXJlc3RvcmUgc2lndWUgYWNlcHRhbmRvICdmZycgcG9yIHNpIGVuIGVsIGZ1dHVybyBzZSB2dWVsdmUgYVxyXG4vLyBhY3RpdmFyIFx1MjAxNCBubyBib3JyYXJsYSBlbiBzdG9yYWdlL2ZpcmVzdG9yZS5ydWxlcyBoYXN0YSBjb25maXJtYXIgZGVwcmVjYXRlLlxyXG5jb25zdCBTQUxFU19QTEFOX0ZBTUlMSUFTID0gW1xyXG4gIHsga2V5OiAncm9kcycsIGxhYmVsOiAnUm9kcyAoQ2FcdTAwRjFhcyknLCBjb2xvcjogJyMwZWE1ZTknIH0sXHJcbiAgeyBrZXk6ICdyZWVscycsIGxhYmVsOiAnUmVlbHMnLCBjb2xvcjogJyM4YjVjZjYnIH0sXHJcbl07XHJcbmNvbnN0IF9zYWxlc1BsYW5DYWNoZXMgPSB7IHJvZHM6IG51bGwsIHJlZWxzOiBudWxsIH07IC8vIGxhc3QgbG9hZGVkIGRvY1xyXG5sZXQgX2ZvcmVjYXN0QWN0aXZlVGFiID0gJ3NhbGVzLXBsYW5zJzsgLy8gJ3NhbGVzLXBsYW5zJyB8ICdzdGF0JyB8ICdsZWdhY3knXHJcblxyXG4vLyB2MTEwMysgKEZhc2UgMkIpOiBGb3JlY2FzdCBFc3RhZFx1MDBFRHN0aWNvIFx1MjAxNCBvdXRwdXQgcHVibGljYWRvIHBvclxyXG4vLyBzY3JpcHRzL2ZvcmVjYXN0L3B1Ymxpc2hfdG9fZmlyZXN0b3JlLnB5IGEgZm9yZWNhc3Rfb3V0cHV0L3tzdWJfc2x1Z31cclxuLy8gKyBmb3JlY2FzdF9vdXRwdXRfbWV0YS9jdXJyZW50LiAyNCBzdWJzICsgMSBtZXRhIGRvYy5cclxubGV0IF9mb3JlY2FzdFN0YXREb2NzID0gbnVsbDsgLy8gW3tpZCwgc3ViZmFtaWxpYSwgZm9yZWNhc3RbN10sIG1ldHJpY3MsIGJlc3RNb2RlbCwgdmVyc2lvbklkfV1cclxubGV0IF9mb3JlY2FzdFN0YXRNZXRhID0gbnVsbDsgLy8ge2dlbmVyYXRlZEF0LCB2ZXJzaW9uSWQsIHJlc3VtZW46IHsuLi59fVxyXG5sZXQgX2ZvcmVjYXN0U3RhdEhpc3RvcnlDYWNoZSA9IG51bGw7IC8vIHsgW3N1Yl06IFt7ZHMsIHl9XSB9IGNhY2hlIGxhenkgb24tZGVtYW5kXHJcblxyXG4vLyB2MTEwOSsgKEZhc2UgM0EpOiBUYWJsYSBSZWNvbWVuZGFjaVx1MDBGM24gZGUgQ29tcHJhIFx1MjAxNCBjb21iaW5hIHNhbGVzIHBsYW5zICtcclxuLy8gc3RvY2tfc25hcHNob3QgKyBza3VfdmVudGFzX3NuYXBzaG90IHBhcmEgY29tcHV0YXIgcmVjb21lbmRhZG8gcG9yIFNLVS5cclxubGV0IF9yZWNvU3RvY2tTbmFwc2hvdCA9IG51bGw7IC8vIHt3YXJlaG91c2VCcmVha2Rvd246IHtza3U6eycxMSc6biwnMTInOm4sLi4ufX0sIGJhY2tvcmRlckJ5U2t1OiB7c2t1Om59fVxyXG5sZXQgX3JlY29WZW50YXNTbmFwc2hvdCA9IG51bGw7IC8vIHsgW1NLVSB1cHBlcl06IHttZXNlczogeydZWVlZLU1NJzoge3F0eSxhcnN9fX0gfVxyXG5sZXQgX3JlY29GaWx0ZXJNaW5SZWMgPSB0cnVlOyAvLyBcInNvbG8gbW9zdHJhciBTS1VzIGNvbiByZWNvbWVuZGFkbyA+IDBcIlxyXG5sZXQgX3JlY29GaWx0ZXJGYW1pbGlhID0gJ2FsbCc7IC8vICdhbGwnIHwgJ3JvZHMnIHwgJ3JlZWxzJ1xyXG5sZXQgX3JlY29TZWFyY2hUZXh0ID0gJyc7XHJcblxyXG4vLyB2MTExMisgKEYzQik6IFNLVXMgZGVzY29udGludWFkb3MgcXVlIE1hcmlhbm8gbWFyY2EgcGFyYSBleGNsdWlyIGRlbCBmb3JlY2FzdC5cclxuLy8gUGVyc2lzdGVuIGVuIEZpcmVzdG9yZSBgZm9yZWNhc3RfY29uZmlnL2Rpc2NvbnRpbnVlZF9za3VzYCBjb21vIHsgc2t1czogW1NLVSB1cHBlcl0sIHVwZGF0ZWRBdCwgdXBkYXRlZEJ5IH0uXHJcbmxldCBfZGlzY29udGludWVkU2t1cyA9IG51bGw7IC8vIFNldDxzdHJpbmcgdXBwZXI+IG8gbnVsbCBzaSBubyBjYXJnYWRvXHJcbmxldCBfZGlzY29udGludWVkTWV0YSA9IG51bGw7IC8vIHt1cGRhdGVkQXQsIHVwZGF0ZWRCeX1cclxuXHJcbi8vIHYxMTE0KyAoRjNCIG11bHRpcGxpY2Fkb3IgZGluXHUwMEUxbWljbyk6IG11bHRpcGxpY2Fkb3IgYXV0byBwb3IgU0tVID0gdmVudGFfMm1cclxuLy8gZGl2aWRpZG8gcG9yIHZlbnRhXzZtLCBjb24gY2FwLiBPdmVycmlkZSBtYW51YWwgcGVyc2lzdGlkbyBlbiBGaXJlc3RvcmVcclxuLy8gYGZvcmVjYXN0X2NvbmZpZy9tdWx0aXBsaWVyc2AgY29uIHtza3VPdmVycmlkZXM6IHtTS1U6IHt2YWx1ZSwgdXBkYXRlZEJ5LCB1cGRhdGVkQXR9fX0uXHJcbmxldCBfbXVsdGlwbGllck92ZXJyaWRlcyA9IG51bGw7IC8vIHsgW1NLVSB1cHBlcl06IHt2YWx1ZSwgdXBkYXRlZEJ5LCB1cGRhdGVkQXR9IH1cclxuY29uc3QgUkVDT19NVUxUX1JFQ0VOVF9NT05USFMgPSAyO1xyXG5jb25zdCBSRUNPX01VTFRfQkFTRUxJTkVfTU9OVEhTID0gNjtcclxuY29uc3QgUkVDT19NVUxUX01JTiA9IDAuNTtcclxuY29uc3QgUkVDT19NVUxUX01BWCA9IDIuNTtcclxuY29uc3QgUkVDT19NVUxUX01JTl9CQVNFTElORSA9IDAuMTsgLy8gZXZpdGEgZGl2aXNpXHUwMEYzbiBwb3IgY2Vyb1xyXG5cclxuY29uc3QgUkVDT19IT1JJWk9OX01PTlRIUyA9IDc7XHJcbmNvbnN0IFJFQ09fVkVOVEFfUFJPTUVESU9fV0lORE9XID0gMzsgLy8gbWVzZXMgaGFjaWEgYXRyXHUwMEUxcyBwYXJhIHByb21lZGlvIHZlbnRhXHJcbi8vIFJFQ09fREVGQVVMVF9NVUxUSVBMSUVSIHJlbW92ZWQgMjAyNi0xMC0wNiAodW51c2VkLCBmbGFnZ2VkIGJ5IGJpb21lKS5cclxuXHJcbi8vIFdoaXRlbGlzdCBkZSBlbWFpbHMgY29uIGFjY2VzbyBhbCBtb2RhbCBGT1JFQ0FTVC4gUmVwbGljYSBlbCBwYXRyb24gZGVcclxuLy8gXCJBbmFsaXNpc1wiIChpbmRleC5odG1sOjEyNjI1KS4gU29sbyBNYXJpYW5vOyBzaSBvdHJvIGFkbWluIGxvIG5lY2VzaXRhXHJcbi8vIHNlIGFncmVnYSBhY2EgZXhwbGljaXRvLlxyXG5jb25zdCBGT1JFQ0FTVF9BTExPV0VEX0VNQUlMUyA9IFsnbWFyaWFuby5lcmJpbm9Ac2hpbWFuby5jb20uYXInLCAnZXJiaW5vbWFyaWFub0BnbWFpbC5jb20nXTtcclxuXHJcbmZ1bmN0aW9uIF9jYW5Gb3JlY2FzdCgpIHtcclxuICB0cnkge1xyXG4gICAgY29uc3QgZW1haWwgPSAoKHdpbmRvdy5jdXJyZW50VXNlciAmJiB3aW5kb3cuY3VycmVudFVzZXIuZW1haWwpIHx8ICcnKS50b0xvd2VyQ2FzZSgpO1xyXG4gICAgaWYgKCFlbWFpbCkgcmV0dXJuIGZhbHNlO1xyXG4gICAgcmV0dXJuIEZPUkVDQVNUX0FMTE9XRURfRU1BSUxTLmluZGV4T2YoZW1haWwpID49IDA7XHJcbiAgfSBjYXRjaCB7XHJcbiAgICByZXR1cm4gZmFsc2U7XHJcbiAgfVxyXG59XHJcblxyXG5mdW5jdGlvbiBfcmVuZGVyTW9kYWxTaGVsbCgpIHtcclxuICBjb25zdCBleGlzdGluZyA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdmb3JlY2FzdC1tb2RhbCcpO1xyXG4gIGlmIChleGlzdGluZykgcmV0dXJuIGV4aXN0aW5nO1xyXG4gIGNvbnN0IGVsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2Jyk7XHJcbiAgZWwuaWQgPSAnZm9yZWNhc3QtbW9kYWwnO1xyXG4gIGVsLmNsYXNzTmFtZSA9ICdtb2RhbC1vdmVybGF5JztcclxuICAvLyB2MTMwNiAoMjAyNi0xMC0xNSk6IEFwcGxlLXN0eWxlIG1vZGFsIG92ZXJsYXkgY29uIGJhY2tkcm9wIGJsdXIuXHJcbiAgZWwuc3R5bGUuY3NzVGV4dCA9XHJcbiAgICAnZGlzcGxheTpub25lO3Bvc2l0aW9uOmZpeGVkO2luc2V0OjA7YmFja2dyb3VuZDpyZ2JhKDAsMCwwLC4zKTstd2Via2l0LWJhY2tkcm9wLWZpbHRlcjpzYXR1cmF0ZSgxNDAlKSBibHVyKDhweCk7YmFja2Ryb3AtZmlsdGVyOnNhdHVyYXRlKDE0MCUpIGJsdXIoOHB4KTt6LWluZGV4OjIwNTA7JztcclxuICBlbC5vbmNsaWNrID0gZnVuY3Rpb24gKGV2KSB7XHJcbiAgICBpZiAoZXYudGFyZ2V0ID09PSBlbCkgd2luZG93LmNsb3NlRm9yZWNhc3RNb2RhbCgpO1xyXG4gIH07XHJcbiAgY29uc3Qgc2hlbGxIdG1sID0gX2J1aWxkU2hlbGxIdG1sKCk7XHJcbiAgZWwuaW5uZXJIVE1MID0gc2hlbGxIdG1sO1xyXG4gIGRvY3VtZW50LmJvZHkuYXBwZW5kQ2hpbGQoZWwpO1xyXG4gIF9lbnN1cmVGb3JlY2FzdEFwcGxlQ3NzKCk7XHJcbiAgcmV0dXJuIGVsO1xyXG59XHJcblxyXG5mdW5jdGlvbiBfZW5zdXJlRm9yZWNhc3RBcHBsZUNzcygpIHtcclxuICAvLyB2MTMwNjogQ1NTIEFwcGxlLXN0eWxlIGlueWVjdGFkbyB1bmEgc29sYSB2ZXogYWwgYWJyaXIgZWwgbW9kYWwuXHJcbiAgLy8gU2tpbGwgYXBwbGUtZGVzaWduOiBmZWVkYmFjayBwb2ludGVyZG93biwgYmFja2Ryb3AgYmx1ciwgcmVkdWNlZC1tb3Rpb24sXHJcbiAgLy8gdHlwb2dyYXBoeSB0cmFja2luZyBzaXplLXNwZWNpZmljLlxyXG4gIGlmIChkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZm9yZWNhc3QtYXBwbGUtY3NzJykpIHJldHVybjtcclxuICBjb25zdCBzdHlsZSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3N0eWxlJyk7XHJcbiAgc3R5bGUuaWQgPSAnZm9yZWNhc3QtYXBwbGUtY3NzJztcclxuICBjb25zdCBjc3MgPVxyXG4gICAgJyNmb3JlY2FzdC1tb2RhbCAuZmMtYXBwbGUgKntmb250LWZhbWlseTotYXBwbGUtc3lzdGVtLEJsaW5rTWFjU3lzdGVtRm9udCxcIlNGIFBybyBEaXNwbGF5XCIsXCJTRiBQcm8gVGV4dFwiLFwiSGVsdmV0aWNhIE5ldWVcIixzYW5zLXNlcmlmfScgK1xyXG4gICAgJyNmb3JlY2FzdC1tb2RhbCAuZmMtYXBwbGUtY2xvc2V7Ym9yZGVyOm5vbmU7YmFja2dyb3VuZDpyZ2JhKDEyMCwxMjAsMTI4LC4xNCk7d2lkdGg6MzBweDtoZWlnaHQ6MzBweDtib3JkZXItcmFkaXVzOjUwJTtjdXJzb3I6cG9pbnRlcjtjb2xvcjojODY4NjhiO2ZvbnQtc2l6ZToxNnB4O2Rpc3BsYXk6ZmxleDthbGlnbi1pdGVtczpjZW50ZXI7anVzdGlmeS1jb250ZW50OmNlbnRlcjt0cmFuc2l0aW9uOnRyYW5zZm9ybSAuMTJzIGVhc2Utb3V0LGJhY2tncm91bmQgLjE1cyBlYXNlLGNvbG9yIC4xNXMgZWFzZX0nICtcclxuICAgICcjZm9yZWNhc3QtbW9kYWwgLmZjLWFwcGxlLWNsb3NlOmhvdmVye2JhY2tncm91bmQ6cmdiYSgxMjAsMTIwLDEyOCwuMjIpO2NvbG9yOiMxZDFkMWZ9JyArXHJcbiAgICAnI2ZvcmVjYXN0LW1vZGFsIC5mYy1hcHBsZS1jbG9zZTphY3RpdmV7dHJhbnNmb3JtOnNjYWxlKC45KTtiYWNrZ3JvdW5kOnJnYmEoMTIwLDEyMCwxMjgsLjMpfScgK1xyXG4gICAgJyNmb3JlY2FzdC1tb2RhbCAuZmMtYXBwbGUtdGFie3BhZGRpbmc6N3B4IDE2cHg7Ym9yZGVyLXJhZGl1czo5ODBweDtib3JkZXI6bm9uZTtiYWNrZ3JvdW5kOnRyYW5zcGFyZW50O2NvbG9yOiM4Njg2OGI7Zm9udC1zaXplOjEyLjVweDtmb250LXdlaWdodDo2MDA7bGV0dGVyLXNwYWNpbmc6LTAuMXB4O2N1cnNvcjpwb2ludGVyO3RyYW5zaXRpb246YmFja2dyb3VuZCAuMTVzIGVhc2UsY29sb3IgLjE1cyBlYXNlLHRyYW5zZm9ybSAuMXMgZWFzZS1vdXR9JyArXHJcbiAgICAnI2ZvcmVjYXN0LW1vZGFsIC5mYy1hcHBsZS10YWI6aG92ZXJ7YmFja2dyb3VuZDpyZ2JhKDEyMCwxMjAsMTI4LC4xKTtjb2xvcjojMWQxZDFmfScgK1xyXG4gICAgJyNmb3JlY2FzdC1tb2RhbCAuZmMtYXBwbGUtdGFiOmFjdGl2ZXt0cmFuc2Zvcm06c2NhbGUoLjk3KX0nICtcclxuICAgICcjZm9yZWNhc3QtbW9kYWwgLmZjLWFwcGxlLXRhYi5hY3RpdmV7YmFja2dyb3VuZDojMWQxZDFmO2NvbG9yOiNmZmZ9JyArXHJcbiAgICAnI2ZvcmVjYXN0LW1vZGFsIC5mYy1hcHBsZS10YWIuYWN0aXZlOmhvdmVye2JhY2tncm91bmQ6IzAwMH0nICtcclxuICAgICdAbWVkaWEgKHByZWZlcnMtcmVkdWNlZC1tb3Rpb246cmVkdWNlKXsnICtcclxuICAgICcgICNmb3JlY2FzdC1tb2RhbCAuZmMtYXBwbGUtY2xvc2UsI2ZvcmVjYXN0LW1vZGFsIC5mYy1hcHBsZS10YWJ7dHJhbnNpdGlvbjpub25lICFpbXBvcnRhbnR9JyArXHJcbiAgICAnICAjZm9yZWNhc3QtbW9kYWwgLmZjLWFwcGxlLWNsb3NlOmFjdGl2ZSwjZm9yZWNhc3QtbW9kYWwgLmZjLWFwcGxlLXRhYjphY3RpdmV7dHJhbnNmb3JtOm5vbmUgIWltcG9ydGFudH0nICtcclxuICAgICd9JztcclxuICBzdHlsZS50ZXh0Q29udGVudCA9IGNzcztcclxuICBkb2N1bWVudC5oZWFkLmFwcGVuZENoaWxkKHN0eWxlKTtcclxufVxyXG5cclxuZnVuY3Rpb24gX2J1aWxkU2hlbGxIdG1sKCkge1xyXG4gIC8vIHYxMzA2OiByZWRpc2VcdTAwRjFvIEFwcGxlLXN0eWxlLlxyXG4gIC8vIHYxMzA3ICgyMDI2LTEwLTE1KTogdGFiIFwiRm9yZWNhc3QgZXN0YWRcdTAwRURzdGljb1wiIHJlbW92aWRhIChkZWNpc2lcdTAwRjNuIE1hcmlhbm8pLlxyXG4gIC8vIEVsIGZvcmVjYXN0IHBvciBzdWJmYW1pbGlhIChmb3JlY2FzdF9vdXRwdXQvKSBubyBhZ3JlZ2EgdmFsb3Igc29icmVcclxuICAvLyBcIlNhbGVzIFBsYW5zXCIgcXVlIHlhIGhhY2UgcmVjb21lbmRhY2lcdTAwRjNuIG5pdmVsIFNLVSBjb24gQk8gKyBzdG9jayArIHBsYW4uXHJcbiAgLy8gU2hlbGwgcXVlZGEgc2luIHRhYnMgYmFyIFx1MjAxNCB1bmEgc29sYSB2aXN0YS5cclxuICBjb25zdCBtb2RhbE91dGVyID1cclxuICAgICc8ZGl2IGNsYXNzPVwiZmMtYXBwbGVcIiBzdHlsZT1cInBvc2l0aW9uOmFic29sdXRlO2luc2V0OjF2aCAxdnc7YmFja2dyb3VuZDojZmJmYmZkO2JvcmRlci1yYWRpdXM6MThweDtkaXNwbGF5OmZsZXg7ZmxleC1kaXJlY3Rpb246Y29sdW1uO292ZXJmbG93OmhpZGRlbjtib3gtc2hhZG93OjAgMjRweCA3MHB4IHJnYmEoMCwwLDAsLjIyKVwiPic7XHJcbiAgY29uc3QgaGVhZGVyID1cclxuICAgICc8ZGl2IHN0eWxlPVwicGFkZGluZzoyMnB4IDI2cHggMThweDtiYWNrZ3JvdW5kOnJnYmEoMjUxLDI1MSwyNTMsLjkyKTstd2Via2l0LWJhY2tkcm9wLWZpbHRlcjpzYXR1cmF0ZSgxODAlKSBibHVyKDIwcHgpO2JhY2tkcm9wLWZpbHRlcjpzYXR1cmF0ZSgxODAlKSBibHVyKDIwcHgpO2JvcmRlci1ib3R0b206MC41cHggc29saWQgcmdiYSgwLDAsMCwuMDgpO2Rpc3BsYXk6ZmxleDthbGlnbi1pdGVtczpmbGV4LXN0YXJ0O2dhcDoxNHB4XCI+JyArXHJcbiAgICAnPGRpdiBzdHlsZT1cImZsZXg6MTttaW4td2lkdGg6MFwiPicgK1xyXG4gICAgJzxoMiBzdHlsZT1cIm1hcmdpbjowIDAgNHB4O2ZvbnQtc2l6ZToyMnB4O2ZvbnQtd2VpZ2h0OjcwMDtsZXR0ZXItc3BhY2luZzotMC41cHg7Y29sb3I6IzFkMWQxZlwiPkZvcmVjYXN0PC9oMj4nICtcclxuICAgICc8ZGl2IGlkPVwiZm9yZWNhc3Qtc3VidGl0bGVcIiBzdHlsZT1cImZvbnQtc2l6ZToxM3B4O2xldHRlci1zcGFjaW5nOi0wLjFweDtjb2xvcjojODY4NjhiXCI+U2FsZXMgUGxhbnMgbWVuc3VhbGVzICsgcG9sXHUwMEVEdGljYSBkZSBpbnZlbnRhcmlvPC9kaXY+JyArXHJcbiAgICAnPC9kaXY+JyArXHJcbiAgICAnPGJ1dHRvbiBjbGFzcz1cImZjLWFwcGxlLWNsb3NlXCIgb25jbGljaz1cImNsb3NlRm9yZWNhc3RNb2RhbCgpXCIgYXJpYS1sYWJlbD1cIkNlcnJhclwiPiZ0aW1lczs8L2J1dHRvbj4nICtcclxuICAgICc8L2Rpdj4nO1xyXG4gIGNvbnN0IHRhYlNhbGVzUGxhbnMgPVxyXG4gICAgJzxkaXYgaWQ9XCJmb3JlY2FzdC10YWItc2FsZXMtcGxhbnNcIiBzdHlsZT1cImZsZXg6MTtvdmVyZmxvdzphdXRvO3BhZGRpbmc6MDtiYWNrZ3JvdW5kOiNmYmZiZmRcIj48L2Rpdj4nO1xyXG4gIC8vIHYxMzA3OiBjb250ZW5lZG9yIHN0YXQgcXVlZGEgb2N1bHRvIHBhcmEgcHJlc2VydmFyIHJlZmVyZW5jaWFzIGRlbCBjb2RpZ29cclxuICAvLyAoc3dpdGNoRm9yZWNhc3RUYWIvX3JlbmRlckZvcmVjYXN0U3RhdFRhYiBleGlzdGVuIHBlcm8gbm8gc2UgaW52b2NhblxyXG4gIC8vIGRlc2RlIGxhIFVJKS4gU2kgcXVlclx1MDBFOXMgbGltcGlhciBlbCBjb2RpZ28gZW50ZXJvLCBlcyBzYWZlIGJvcnJhcmxvcy5cclxuICBjb25zdCB0YWJTdGF0ID0gJzxkaXYgaWQ9XCJmb3JlY2FzdC10YWItc3RhdFwiIHN0eWxlPVwiZGlzcGxheTpub25lXCI+PC9kaXY+JztcclxuICByZXR1cm4gbW9kYWxPdXRlciArIGhlYWRlciArIHRhYlNhbGVzUGxhbnMgKyB0YWJTdGF0ICsgJzwvZGl2Pic7XHJcbn1cclxuXHJcbi8vIHYxMDk4KyBGYXNlIDEgKyB2MTEwMysgRmFzZSAyQiArIHYxMTA1IGZpeCArIHYxMTExIGNsZWFuIGxlZ2FjeTogc3dpdGNoXHJcbi8vIGVudHJlIHRhYnMgU2FsZXMgUGxhbnMgLyBGb3JlY2FzdCBFc3RhZFx1MDBFRHN0aWNvLlxyXG53aW5kb3cuc3dpdGNoRm9yZWNhc3RUYWIgPSBmdW5jdGlvbiAodGFiSWQpIHtcclxuICBfZm9yZWNhc3RBY3RpdmVUYWIgPSB0YWJJZDtcclxuICBjb25zdCBzcCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdmb3JlY2FzdC10YWItc2FsZXMtcGxhbnMnKTtcclxuICBjb25zdCBzdCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdmb3JlY2FzdC10YWItc3RhdCcpO1xyXG4gIGlmIChzcCkgc3Auc3R5bGUuZGlzcGxheSA9IHRhYklkID09PSAnc2FsZXMtcGxhbnMnID8gJ2Jsb2NrJyA6ICdub25lJztcclxuICBpZiAoc3QpIHN0LnN0eWxlLmRpc3BsYXkgPSB0YWJJZCA9PT0gJ3N0YXQnID8gJ2Jsb2NrJyA6ICdub25lJztcclxuICBjb25zdCBidG5zID0gZG9jdW1lbnQucXVlcnlTZWxlY3RvckFsbCgnI2ZvcmVjYXN0LXRhYnMtYmFyIC5mb3JlY2FzdC10YWInKTtcclxuICBidG5zLmZvckVhY2goKGIpID0+IHtcclxuICAgIGNvbnN0IGFjdGl2ZSA9IGIuZ2V0QXR0cmlidXRlKCdkYXRhLXRhYicpID09PSB0YWJJZDtcclxuICAgIC8vIHYxMzA2IEFwcGxlLXN0eWxlOiB0b2dnbGUgY2xhc3MgYWN0aXZlIChsb3MgZXN0aWxvcyBkZSBwaWxsIHZpZW5lbiBkZWwgQ1NTKS5cclxuICAgIGIuY2xhc3NMaXN0LnRvZ2dsZSgnYWN0aXZlJywgYWN0aXZlKTtcclxuICB9KTtcclxuICAvLyB2MTEwNSBmaXg6IGFsIGFjdGl2YXIgbGEgdGFiIHN0YXQsIG1vc3RyYXIgcGxhY2Vob2xkZXIgaW5tZWRpYXRvIHBhcmFcclxuICAvLyBxdWUgc2UgdmVhIGFsZ28gbWllbnRyYXMgY2FyZ2EgKG8gc2kgZWwgbG9hZCB5YSB0ZXJtaW5vLCByZS1yZW5kZXIpLlxyXG4gIGlmICh0YWJJZCA9PT0gJ3N0YXQnKSB7XHJcbiAgICBjb25zdCBjb250ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2ZvcmVjYXN0LXRhYi1zdGF0Jyk7XHJcbiAgICBpZiAoY29udCkge1xyXG4gICAgICBpZiAoX2ZvcmVjYXN0U3RhdERvY3MpIHtcclxuICAgICAgICAvLyBZYSBjYXJnYWRvOiByZS1yZW5kZXIgKHBvciBzaSBlbCB1c2VyIHZpZW5lIGRlIG90cmEgdGFiKS5cclxuICAgICAgICBfcmVuZGVyRm9yZWNhc3RTdGF0VGFiKCk7XHJcbiAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgLy8gQVx1MDBGQW4gbm8gY2FyZ2FkbzogcGxhY2Vob2xkZXIgKyBsb2FkLlxyXG4gICAgICAgIGNvbnQuaW5uZXJIVE1MID1cclxuICAgICAgICAgICc8ZGl2IGNsYXNzPVwiZmMtYXBwbGVcIiBzdHlsZT1cInBhZGRpbmc6ODBweCAyMHB4O3RleHQtYWxpZ246Y2VudGVyO2NvbG9yOiM4Njg2OGI7Zm9udC1zaXplOjE0cHg7bGV0dGVyLXNwYWNpbmc6LTAuMXB4XCI+JyArXHJcbiAgICAgICAgICAnPGRpdiBzdHlsZT1cImRpc3BsYXk6aW5saW5lLWJsb2NrO3dpZHRoOjI4cHg7aGVpZ2h0OjI4cHg7Ym9yZGVyOjIuNXB4IHNvbGlkIHJnYmEoMCwxMjIsMjU1LC4yKTtib3JkZXItdG9wLWNvbG9yOiMwMDdhZmY7Ym9yZGVyLXJhZGl1czo1MCU7YW5pbWF0aW9uOnNwaW4gMC43NXMgbGluZWFyIGluZmluaXRlO21hcmdpbi1ib3R0b206MTZweFwiPjwvZGl2PicgK1xyXG4gICAgICAgICAgJzxkaXY+Q2FyZ2FuZG8gZm9yZWNhc3QgZGVzZGUgRmlyZXN0b3JlPC9kaXY+JyArXHJcbiAgICAgICAgICAnPHN0eWxlPkBrZXlmcmFtZXMgc3Bpbnt0b3t0cmFuc2Zvcm06cm90YXRlKDM2MGRlZyl9fTwvc3R5bGU+JyArXHJcbiAgICAgICAgICAnPC9kaXY+JztcclxuICAgICAgICBfbG9hZEZvcmVjYXN0T3V0cHV0KClcclxuICAgICAgICAgIC50aGVuKF9yZW5kZXJGb3JlY2FzdFN0YXRUYWIpXHJcbiAgICAgICAgICAuY2F0Y2goKGUpID0+IHtcclxuICAgICAgICAgICAgY29uc29sZS5lcnJvcignW0ZPUkVDQVNUIHN0YXRdIGxvYWQgZmFpbCcsIGUpO1xyXG4gICAgICAgICAgICBjb25zdCBjID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2ZvcmVjYXN0LXRhYi1zdGF0Jyk7XHJcbiAgICAgICAgICAgIGlmIChjKSB7XHJcbiAgICAgICAgICAgICAgYy5pbm5lckhUTUwgPVxyXG4gICAgICAgICAgICAgICAgJzxkaXYgY2xhc3M9XCJmYy1hcHBsZVwiIHN0eWxlPVwicGFkZGluZzo4MHB4IDIwcHg7dGV4dC1hbGlnbjpjZW50ZXI7bGluZS1oZWlnaHQ6MS41XCI+JyArXHJcbiAgICAgICAgICAgICAgICAnPGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxNnB4O2ZvbnQtd2VpZ2h0OjYwMDttYXJnaW4tYm90dG9tOjEwcHg7Y29sb3I6I2M3MzcyZjtsZXR0ZXItc3BhY2luZzotMC4ycHhcIj5FcnJvciBjYXJnYW5kbyBmb3JlY2FzdDwvZGl2PicgK1xyXG4gICAgICAgICAgICAgICAgJzxkaXYgc3R5bGU9XCJmb250LXNpemU6MTIuNXB4O2NvbG9yOiM4Njg2OGI7bWFyZ2luLWJvdHRvbToxOHB4O2xldHRlci1zcGFjaW5nOi0wLjFweFwiPicgK1xyXG4gICAgICAgICAgICAgICAgZXNjYXBlSHRtbFNhZmUoZS5tZXNzYWdlIHx8IFN0cmluZyhlKSkgK1xyXG4gICAgICAgICAgICAgICAgJzwvZGl2PicgK1xyXG4gICAgICAgICAgICAgICAgJzxidXR0b24gb25jbGljaz1cInN3aXRjaEZvcmVjYXN0VGFiKFxcJ3N0YXRcXCcpXCIgc3R5bGU9XCJwYWRkaW5nOjlweCAxOHB4O2JhY2tncm91bmQ6IzAwN2FmZjtjb2xvcjojZmZmO2JvcmRlcjpub25lO2JvcmRlci1yYWRpdXM6OTgwcHg7Zm9udC13ZWlnaHQ6NjAwO2N1cnNvcjpwb2ludGVyO2ZvbnQtc2l6ZToxM3B4O2xldHRlci1zcGFjaW5nOi0wLjFweFwiPlJlaW50ZW50YXI8L2J1dHRvbj4nICtcclxuICAgICAgICAgICAgICAgICc8L2Rpdj4nO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICB9KTtcclxuICAgICAgfVxyXG4gICAgfVxyXG4gIH1cclxufTtcclxuXHJcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG4vLyBGQVNFIDEgXHUyMDE0IFNhbGVzIFBsYW5zIHVwbG9hZCAoUm9kcyAvIFJlZWxzIC8gRkcpXHJcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cclxuZnVuY3Rpb24gX3llYXJNb250aE5vdygpIHtcclxuICBjb25zdCBkID0gbmV3IERhdGUoKTtcclxuICByZXR1cm4gZC5nZXRGdWxsWWVhcigpICsgJy0nICsgU3RyaW5nKGQuZ2V0TW9udGgoKSArIDEpLnBhZFN0YXJ0KDIsICcwJyk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIF9mbXRTaXplKGJ5dGVzKSB7XHJcbiAgaWYgKCFieXRlcykgcmV0dXJuICcnO1xyXG4gIGlmIChieXRlcyA8IDEwMjQpIHJldHVybiBieXRlcyArICcgQic7XHJcbiAgaWYgKGJ5dGVzIDwgMTAyNCAqIDEwMjQpIHJldHVybiAoYnl0ZXMgLyAxMDI0KS50b0ZpeGVkKDEpICsgJyBLQic7XHJcbiAgcmV0dXJuIChieXRlcyAvICgxMDI0ICogMTAyNCkpLnRvRml4ZWQoMikgKyAnIE1CJztcclxufVxyXG5cclxuZnVuY3Rpb24gX2ZtdERhdGVTaG9ydChpc28pIHtcclxuICBpZiAoIWlzbykgcmV0dXJuICdcdTIwMTQnO1xyXG4gIHRyeSB7XHJcbiAgICBjb25zdCBkID0gaXNvLnRvRGF0ZSA/IGlzby50b0RhdGUoKSA6IG5ldyBEYXRlKGlzbyk7XHJcbiAgICByZXR1cm4gKFxyXG4gICAgICBkLnRvTG9jYWxlRGF0ZVN0cmluZygnZXMtQVInLCB7IGRheTogJzItZGlnaXQnLCBtb250aDogJ3Nob3J0JywgeWVhcjogJzItZGlnaXQnIH0pICtcclxuICAgICAgJyAnICtcclxuICAgICAgZC50b0xvY2FsZVRpbWVTdHJpbmcoJ2VzLUFSJywgeyBob3VyOiAnMi1kaWdpdCcsIG1pbnV0ZTogJzItZGlnaXQnIH0pXHJcbiAgICApO1xyXG4gIH0gY2F0Y2gge1xyXG4gICAgcmV0dXJuIFN0cmluZyhpc28pO1xyXG4gIH1cclxufVxyXG5cclxuYXN5bmMgZnVuY3Rpb24gX2xvYWRTYWxlc1BsYW5DYWNoZXMoKSB7XHJcbiAgaWYgKCF3aW5kb3cuZmJEYikgcmV0dXJuO1xyXG4gIGF3YWl0IFByb21pc2UuYWxsKFxyXG4gICAgU0FMRVNfUExBTl9GQU1JTElBUy5tYXAoYXN5bmMgKGYpID0+IHtcclxuICAgICAgdHJ5IHtcclxuICAgICAgICBjb25zdCBkb2MgPSBhd2FpdCB3aW5kb3cuZmJEYi5jb2xsZWN0aW9uKCdzYWxlc19wbGFuX2NhY2hlJykuZG9jKGYua2V5KS5nZXQoKTtcclxuICAgICAgICBfc2FsZXNQbGFuQ2FjaGVzW2Yua2V5XSA9IGRvYy5leGlzdHMgPyBkb2MuZGF0YSgpIDogbnVsbDtcclxuICAgICAgfSBjYXRjaCAoZSkge1xyXG4gICAgICAgIGNvbnNvbGUud2FybignW0ZPUkVDQVNUXSBsb2FkIHNhbGVzX3BsYW5fY2FjaGUvJyArIGYua2V5ICsgJyBmYWlsOicsIGUgJiYgZS5tZXNzYWdlKTtcclxuICAgICAgICBfc2FsZXNQbGFuQ2FjaGVzW2Yua2V5XSA9IG51bGw7XHJcbiAgICAgIH1cclxuICAgIH0pXHJcbiAgKTtcclxufVxyXG5cclxuZnVuY3Rpb24gZXNjYXBlSHRtbFNhZmUocykge1xyXG4gIGlmICh0eXBlb2Ygd2luZG93LmVzY2FwZUh0bWwgPT09ICdmdW5jdGlvbicpIHJldHVybiB3aW5kb3cuZXNjYXBlSHRtbChzKTtcclxuICByZXR1cm4gU3RyaW5nKHMgPT0gbnVsbCA/ICcnIDogcykucmVwbGFjZShcclxuICAgIC9bJjw+XCInXS9nLFxyXG4gICAgKGNoKSA9PiAoeyAnJic6ICcmYW1wOycsICc8JzogJyZsdDsnLCAnPic6ICcmZ3Q7JywgJ1wiJzogJyZxdW90OycsIFwiJ1wiOiAnJiMzOTsnIH0pW2NoXVxyXG4gICk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIF9idWlsZFNhbGVzUGxhblNsb3RIdG1sKGYpIHtcclxuICBjb25zdCBjYWNoZSA9IF9zYWxlc1BsYW5DYWNoZXNbZi5rZXldO1xyXG4gIGNvbnN0IHJvd3NDb3VudCA9IGNhY2hlICYmIE51bWJlci5pc0Zpbml0ZShjYWNoZS5yb3dzQ291bnQpID8gY2FjaGUucm93c0NvdW50IDogMDtcclxuICBjb25zdCBtb250aHNDb3VudCA9XHJcbiAgICBjYWNoZSAmJiBBcnJheS5pc0FycmF5KGNhY2hlLmRldGVjdGVkTW9udGhzKSA/IGNhY2hlLmRldGVjdGVkTW9udGhzLmxlbmd0aCA6IDA7XHJcbiAgY29uc3QgcGFyc2VkQXQgPSBjYWNoZSAmJiBjYWNoZS5wYXJzZWRBdCA/IF9mbXREYXRlU2hvcnQoY2FjaGUucGFyc2VkQXQpIDogJyc7XHJcbiAgY29uc3QgdXBsb2FkZWRCeSA9IGNhY2hlICYmIGNhY2hlLnVwbG9hZGVkQnkgPyBjYWNoZS51cGxvYWRlZEJ5IDogJyc7XHJcbiAgY29uc3Qgc291cmNlRmlsZW5hbWUgPSBjYWNoZSAmJiBjYWNoZS5zb3VyY2VGaWxlbmFtZSA/IGNhY2hlLnNvdXJjZUZpbGVuYW1lIDogJyc7XHJcbiAgY29uc3QgeWVhck1vbnRoID0gY2FjaGUgJiYgY2FjaGUueWVhck1vbnRoID8gY2FjaGUueWVhck1vbnRoIDogJyc7XHJcbiAgY29uc3QgbW9udGhzUmFuZ2UgPVxyXG4gICAgY2FjaGUgJiYgY2FjaGUuZGV0ZWN0ZWRNb250aHMgJiYgY2FjaGUuZGV0ZWN0ZWRNb250aHMubGVuZ3RoXHJcbiAgICAgID8gY2FjaGUuZGV0ZWN0ZWRNb250aHNbMF0gKyAnIFx1MjE5MiAnICsgY2FjaGUuZGV0ZWN0ZWRNb250aHNbY2FjaGUuZGV0ZWN0ZWRNb250aHMubGVuZ3RoIC0gMV1cclxuICAgICAgOiAnXHUyMDE0JztcclxuICBjb25zdCBoYXNDYWNoZSA9ICEhY2FjaGU7XHJcbiAgY29uc3QgYmFkZ2UgPSBoYXNDYWNoZVxyXG4gICAgPyAnPGRpdiBzdHlsZT1cInBhZGRpbmc6NHB4IDhweDtiYWNrZ3JvdW5kOiMxNmEzNGE7Y29sb3I6I2ZmZjtib3JkZXItcmFkaXVzOjEycHg7Zm9udC1zaXplOjEwcHg7Zm9udC13ZWlnaHQ6NzAwO2xldHRlci1zcGFjaW5nOi40cHhcIj5DQVJHQURPPC9kaXY+J1xyXG4gICAgOiAnPGRpdiBzdHlsZT1cInBhZGRpbmc6NHB4IDhweDtiYWNrZ3JvdW5kOiNkYzI2MjY7Y29sb3I6I2ZmZjtib3JkZXItcmFkaXVzOjEycHg7Zm9udC1zaXplOjEwcHg7Zm9udC13ZWlnaHQ6NzAwO2xldHRlci1zcGFjaW5nOi40cHhcIj5GQUxUQTwvZGl2Pic7XHJcbiAgY29uc3QgbWV0YUJsb2NrID0gaGFzQ2FjaGVcclxuICAgID8gJzxkaXYgc3R5bGU9XCJkaXNwbGF5OmdyaWQ7Z3JpZC10ZW1wbGF0ZS1jb2x1bW5zOmF1dG8gMWZyO2dhcDo2cHggMTJweDtmb250LXNpemU6MTFweDtwYWRkaW5nOjEwcHggMTJweDtiYWNrZ3JvdW5kOnZhcigtLWJnLXNlY29uZGFyeSk7Ym9yZGVyLXJhZGl1czo2cHhcIj4nICtcclxuICAgICAgJzxkaXYgc3R5bGU9XCJjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTtmb250LXdlaWdodDo2MDBcIj5BcmNoaXZvPC9kaXY+PGRpdiBzdHlsZT1cImNvbG9yOnZhcigtLXRleHQtcHJpbWFyeSk7Zm9udC1mYW1pbHk6bW9ub3NwYWNlO3dvcmQtYnJlYWs6YnJlYWstYWxsXCI+JyArXHJcbiAgICAgIGVzY2FwZUh0bWxTYWZlKHNvdXJjZUZpbGVuYW1lKSArXHJcbiAgICAgICc8L2Rpdj4nICtcclxuICAgICAgJzxkaXYgc3R5bGU9XCJjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTtmb250LXdlaWdodDo2MDBcIj5TdWJpZG88L2Rpdj48ZGl2IHN0eWxlPVwiY29sb3I6dmFyKC0tdGV4dC1wcmltYXJ5KVwiPicgK1xyXG4gICAgICBlc2NhcGVIdG1sU2FmZShwYXJzZWRBdCkgK1xyXG4gICAgICAnPC9kaXY+JyArXHJcbiAgICAgICc8ZGl2IHN0eWxlPVwiY29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7Zm9udC13ZWlnaHQ6NjAwXCI+UG9yPC9kaXY+PGRpdiBzdHlsZT1cImNvbG9yOnZhcigtLXRleHQtcHJpbWFyeSlcIj4nICtcclxuICAgICAgZXNjYXBlSHRtbFNhZmUodXBsb2FkZWRCeSkgK1xyXG4gICAgICAnPC9kaXY+JyArXHJcbiAgICAgICc8ZGl2IHN0eWxlPVwiY29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7Zm9udC13ZWlnaHQ6NjAwXCI+U25hcHNob3Q8L2Rpdj48ZGl2IHN0eWxlPVwiY29sb3I6dmFyKC0tdGV4dC1wcmltYXJ5KTtmb250LWZhbWlseTptb25vc3BhY2VcIj4nICtcclxuICAgICAgZXNjYXBlSHRtbFNhZmUoeWVhck1vbnRoKSArXHJcbiAgICAgICc8L2Rpdj4nICtcclxuICAgICAgJzxkaXYgc3R5bGU9XCJjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTtmb250LXdlaWdodDo2MDBcIj5TS1VzPC9kaXY+PGRpdiBzdHlsZT1cImNvbG9yOnZhcigtLXRleHQtcHJpbWFyeSk7Zm9udC13ZWlnaHQ6NzAwXCI+JyArXHJcbiAgICAgIHJvd3NDb3VudC50b0xvY2FsZVN0cmluZygnZXMtQVInKSArXHJcbiAgICAgICc8L2Rpdj4nICtcclxuICAgICAgJzxkaXYgc3R5bGU9XCJjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTtmb250LXdlaWdodDo2MDBcIj5NZXNlczwvZGl2PjxkaXYgc3R5bGU9XCJjb2xvcjp2YXIoLS10ZXh0LXByaW1hcnkpO2ZvbnQtd2VpZ2h0OjcwMFwiPicgK1xyXG4gICAgICBtb250aHNDb3VudCArXHJcbiAgICAgICcgPHNwYW4gc3R5bGU9XCJjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTtmb250LXdlaWdodDo0MDBcIj4oJyArXHJcbiAgICAgIGVzY2FwZUh0bWxTYWZlKG1vbnRoc1JhbmdlKSArXHJcbiAgICAgICcpPC9zcGFuPjwvZGl2PicgK1xyXG4gICAgICAnPC9kaXY+J1xyXG4gICAgOiAnPGRpdiBzdHlsZT1cInBhZGRpbmc6MTRweDt0ZXh0LWFsaWduOmNlbnRlcjtmb250LXNpemU6MTJweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTtiYWNrZ3JvdW5kOnZhcigtLWJnLXNlY29uZGFyeSk7Ym9yZGVyLXJhZGl1czo2cHg7Ym9yZGVyOjFweCBkYXNoZWQgdmFyKC0tYm9yZGVyLXN1YnRsZSlcIj5BdW4gbm8gc3ViaXN0ZSBlbCBTYWxlcyBQbGFuIGRlIGVzdGEgZmFtaWxpYS48L2Rpdj4nO1xyXG4gIGNvbnN0IHVwbG9hZEJ0biA9XHJcbiAgICAnPGxhYmVsIHN0eWxlPVwiZGlzcGxheTppbmxpbmUtZmxleDthbGlnbi1pdGVtczpjZW50ZXI7anVzdGlmeS1jb250ZW50OmNlbnRlcjtnYXA6OHB4O3BhZGRpbmc6MTBweCAxNHB4O2JhY2tncm91bmQ6JyArXHJcbiAgICBmLmNvbG9yICtcclxuICAgICc7Y29sb3I6I2ZmZjtib3JkZXItcmFkaXVzOjZweDtmb250LXdlaWdodDo3MDA7Zm9udC1zaXplOjEycHg7Y3Vyc29yOnBvaW50ZXI7bGV0dGVyLXNwYWNpbmc6LjRweFwiPicgK1xyXG4gICAgJzxzcGFuPicgK1xyXG4gICAgKGhhc0NhY2hlID8gJ1x1MjFCQiBSZWVtcGxhemFyIEV4Y2VsJyA6ICdcdTJCMDYgQ2FyZ2FyIEV4Y2VsJykgK1xyXG4gICAgJzwvc3Bhbj4nICtcclxuICAgICc8aW5wdXQgdHlwZT1cImZpbGVcIiBhY2NlcHQ9XCIueGxzeCwueGxzXCIgZGF0YS1mYW1pbGlhPVwiJyArXHJcbiAgICBmLmtleSArXHJcbiAgICAnXCIgc3R5bGU9XCJkaXNwbGF5Om5vbmVcIiBvbmNoYW5nZT1cIm9uU2FsZXNQbGFuRmlsZUZvckZhbWlsaWEoZXZlbnQsIFxcJycgK1xyXG4gICAgZi5rZXkgK1xyXG4gICAgJ1xcJylcIi8+JyArXHJcbiAgICAnPC9sYWJlbD4nO1xyXG4gIGNvbnN0IGNhcmRIZWFkID1cclxuICAgICc8ZGl2IHN0eWxlPVwiZGlzcGxheTpmbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtnYXA6MTBweFwiPicgK1xyXG4gICAgJzxkaXYgc3R5bGU9XCJ3aWR0aDoxMnB4O2hlaWdodDozMnB4O2JhY2tncm91bmQ6JyArXHJcbiAgICBmLmNvbG9yICtcclxuICAgICc7Ym9yZGVyLXJhZGl1czozcHhcIj48L2Rpdj4nICtcclxuICAgICc8ZGl2IHN0eWxlPVwiZmxleDoxXCI+PGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxNHB4O2ZvbnQtd2VpZ2h0OjgwMDtjb2xvcjp2YXIoLS10ZXh0LXByaW1hcnkpXCI+JyArXHJcbiAgICBlc2NhcGVIdG1sU2FmZShmLmxhYmVsKSArXHJcbiAgICAnPC9kaXY+JyArXHJcbiAgICAnPGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMXB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO21hcmdpbi10b3A6MnB4XCI+U2FsZXMgUGxhbiBtZW5zdWFsIFx1MDBCNyBIb2phIFNBUjwvZGl2PjwvZGl2PicgK1xyXG4gICAgYmFkZ2UgK1xyXG4gICAgJzwvZGl2Pic7XHJcbiAgcmV0dXJuIChcclxuICAgICc8ZGl2IHN0eWxlPVwiYmFja2dyb3VuZDp2YXIoLS1iZy1lbGV2YXRlZCk7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1ib3JkZXItc3VidGxlKTtib3JkZXItcmFkaXVzOjEwcHg7cGFkZGluZzoxNnB4O2Rpc3BsYXk6ZmxleDtmbGV4LWRpcmVjdGlvbjpjb2x1bW47Z2FwOjEycHhcIj4nICtcclxuICAgIGNhcmRIZWFkICtcclxuICAgIG1ldGFCbG9jayArXHJcbiAgICB1cGxvYWRCdG4gK1xyXG4gICAgJzxkaXYgaWQ9XCJzYWxlcy1wbGFuLXN0YXR1cy0nICtcclxuICAgIGYua2V5ICtcclxuICAgICdcIiBzdHlsZT1cImZvbnQtc2l6ZToxMXB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO21pbi1oZWlnaHQ6MTRweFwiPjwvZGl2PicgK1xyXG4gICAgJzwvZGl2PidcclxuICApO1xyXG59XHJcblxyXG5mdW5jdGlvbiBfcmVuZGVyU2FsZXNQbGFuc1RhYigpIHtcclxuICBjb25zdCBjb250ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2ZvcmVjYXN0LXRhYi1zYWxlcy1wbGFucycpO1xyXG4gIGlmICghY29udCkgcmV0dXJuO1xyXG4gIGNvbnN0IHNsb3RzID0gU0FMRVNfUExBTl9GQU1JTElBUy5tYXAoX2J1aWxkU2FsZXNQbGFuU2xvdEh0bWwpLmpvaW4oJycpO1xyXG4gIGNvbnN0IGludHJvID1cclxuICAgICc8ZGl2IHN0eWxlPVwibWFyZ2luLWJvdHRvbToxNnB4O3BhZGRpbmc6MTJweCAxNHB4O2JhY2tncm91bmQ6dmFyKC0tYmctc2Vjb25kYXJ5KTtib3JkZXItbGVmdDozcHggc29saWQgIzBkOTQ4ODtib3JkZXItcmFkaXVzOjZweDtmb250LXNpemU6MTJweDtjb2xvcjp2YXIoLS10ZXh0LXNlY29uZGFyeSk7bGluZS1oZWlnaHQ6MS41XCI+JyArXHJcbiAgICAnPGIgc3R5bGU9XCJjb2xvcjp2YXIoLS10ZXh0LXByaW1hcnkpXCI+RmFzZSAxPC9iPiBcdTIwMTQgQ2FyZ1x1MDBFMSBsb3MgU2FsZXMgUGxhbnMgbWVuc3VhbGVzIChSb2RzIC8gUmVlbHMpLiBTZSBwYXJzZWEgbGEgaG9qYSA8Yj5TQVI8L2I+OiBTS1UsIE1PUSAxMiBtb250aHMsIHkgdW5hIGNvbHVtbmEgcG9yIG1lcy4gJyArXHJcbiAgICAnRWwgRXhjZWwgb3JpZ2luYWwgcXVlZGEgc25hcHNob3RhZG8gZW4gU3RvcmFnZSB5IGVsIHBhcnNlbyBxdWVkYSBlbiBGaXJlc3RvcmUgcGFyYSBlbCBjXHUwMEUxbGN1bG8gZGViYWpvLicgK1xyXG4gICAgJzwvZGl2Pic7XHJcbiAgY29uc3QgZ3JpZCA9XHJcbiAgICAnPGRpdiBzdHlsZT1cImRpc3BsYXk6Z3JpZDtncmlkLXRlbXBsYXRlLWNvbHVtbnM6cmVwZWF0KGF1dG8tZml0LG1pbm1heCgzMjBweCwxZnIpKTtnYXA6MTZweDttYXJnaW4tYm90dG9tOjI0cHhcIj4nICtcclxuICAgIHNsb3RzICtcclxuICAgICc8L2Rpdj4nO1xyXG4gIC8vIHYxMTA5OiBjb250ZW5lZG9yIHBhcmEgdGFibGEgUmVjb21lbmRhY2lcdTAwRjNuIGRlIENvbXByYS4gU2UgcmVsbGVuYSBvbi1kZW1hbmRcclxuICAvLyB2aWEgX3JlbmRlclJlY29TZWN0aW9uKCkgKGxhenkgbG9hZCBkZSBzdG9ja19zbmFwc2hvdCArIHNrdV92ZW50YXNfc25hcHNob3QpLlxyXG4gIGNvbnN0IHJlY29TZWN0aW9uID0gJzxkaXYgaWQ9XCJyZWNvLXNlY3Rpb24tY29udGFpbmVyXCI+PC9kaXY+JztcclxuICBjb250LmlubmVySFRNTCA9ICc8ZGl2IHN0eWxlPVwicGFkZGluZzoxOHB4XCI+JyArIGludHJvICsgZ3JpZCArIHJlY29TZWN0aW9uICsgJzwvZGl2Pic7XHJcbiAgX3JlbmRlclJlY29TZWN0aW9uKCk7XHJcbn1cclxuXHJcbndpbmRvdy5vblNhbGVzUGxhbkZpbGVGb3JGYW1pbGlhID0gYXN5bmMgZnVuY3Rpb24gKGV2ZW50LCBmYW1pbGlhKSB7XHJcbiAgY29uc3QgZmlsZSA9IGV2ZW50ICYmIGV2ZW50LnRhcmdldCAmJiBldmVudC50YXJnZXQuZmlsZXMgJiYgZXZlbnQudGFyZ2V0LmZpbGVzWzBdO1xyXG4gIGlmICghZmlsZSkgcmV0dXJuO1xyXG4gIGNvbnN0IHN0YXR1c0VsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3NhbGVzLXBsYW4tc3RhdHVzLScgKyBmYW1pbGlhKTtcclxuICBjb25zdCBzZXRTdGF0dXMgPSAobXNnLCBjb2xvcikgPT4ge1xyXG4gICAgaWYgKCFzdGF0dXNFbCkgcmV0dXJuO1xyXG4gICAgc3RhdHVzRWwudGV4dENvbnRlbnQgPSBtc2c7XHJcbiAgICBzdGF0dXNFbC5zdHlsZS5jb2xvciA9IGNvbG9yIHx8ICd2YXIoLS10ZXh0LW11dGVkKSc7XHJcbiAgfTtcclxuICB0cnkge1xyXG4gICAgaWYgKHR5cGVvZiBYTFNYID09PSAndW5kZWZpbmVkJykge1xyXG4gICAgICBhbGVydCgnU2hlZXRKUyAoWExTWCkgbm8gY2FyZ2FkbyBcdTIwMTQgcmVjYXJnXHUwMEUxIGxhIGFwcC4nKTtcclxuICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG4gICAgaWYgKCF3aW5kb3cuU2FsZXNQbGFuUGFyc2VyIHx8ICF3aW5kb3cuU2FsZXNQbGFuUGFyc2VyLnBhcnNlU2FsZXNQbGFuU2hlZXQpIHtcclxuICAgICAgYWxlcnQoJ1BhcnNlciBTYWxlcyBQbGFuIG5vIGNhcmdhZG8uIFJlYnVpbGQgYnVuZGxlLicpO1xyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcbiAgICBpZiAoIXdpbmRvdy5maXJlYmFzZSB8fCAhd2luZG93LmZpcmViYXNlLnN0b3JhZ2UpIHtcclxuICAgICAgYWxlcnQoJ0ZpcmViYXNlIFN0b3JhZ2Ugbm8gZGlzcG9uaWJsZS4nKTtcclxuICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG4gICAgc2V0U3RhdHVzKCdMZXllbmRvIEV4Y2VsXHUyMDI2Jyk7XHJcbiAgICBjb25zdCBidWYgPSBhd2FpdCBmaWxlLmFycmF5QnVmZmVyKCk7XHJcbiAgICBjb25zdCB3YiA9IFhMU1gucmVhZChidWYsIHsgdHlwZTogJ2FycmF5JyB9KTtcclxuICAgIGNvbnN0IHNhck5hbWUgPSB3Yi5TaGVldE5hbWVzLmZpbmQoXHJcbiAgICAgIChuKSA9PlxyXG4gICAgICAgIFN0cmluZyhuIHx8ICcnKVxyXG4gICAgICAgICAgLnRyaW0oKVxyXG4gICAgICAgICAgLnRvVXBwZXJDYXNlKCkgPT09ICdTQVInXHJcbiAgICApO1xyXG4gICAgaWYgKCFzYXJOYW1lKSB7XHJcbiAgICAgIHNldFN0YXR1cyhcclxuICAgICAgICAnXHUyNkEwIEVsIEV4Y2VsIG5vIHRpZW5lIGhvamEgXCJTQVJcIi4gSG9qYXMgZW5jb250cmFkYXM6ICcgKyB3Yi5TaGVldE5hbWVzLmpvaW4oJywgJyksXHJcbiAgICAgICAgJyNkYzI2MjYnXHJcbiAgICAgICk7XHJcbiAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIGNvbnN0IHNoZWV0ID0gd2IuU2hlZXRzW3Nhck5hbWVdO1xyXG4gICAgY29uc3Qgcm93cyA9IFhMU1gudXRpbHMuc2hlZXRfdG9fanNvbihzaGVldCwgeyBoZWFkZXI6IDEsIGRlZnZhbDogJycsIHJhdzogdHJ1ZSB9KTtcclxuICAgIHNldFN0YXR1cygnUGFyc2VhbmRvICcgKyByb3dzLmxlbmd0aCArICcgZmlsYXMgZGUgaG9qYSBcIicgKyBzYXJOYW1lICsgJ1wiXHUyMDI2Jyk7XHJcbiAgICBjb25zdCBwYXJzZWQgPSB3aW5kb3cuU2FsZXNQbGFuUGFyc2VyLnBhcnNlU2FsZXNQbGFuU2hlZXQocm93cyk7XHJcbiAgICBpZiAoIXBhcnNlZC5yb3dzLmxlbmd0aCkge1xyXG4gICAgICBzZXRTdGF0dXMoJ1x1MjZBMCBFeGNlbCBwYXJzZWFkbyBwZXJvIHNpbiBTS1VzIHZcdTAwRTFsaWRvcy4nLCAnI2RjMjYyNicpO1xyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcbiAgICBjb25zdCB5ZWFyTW9udGggPSBfeWVhck1vbnRoTm93KCk7XHJcbiAgICBjb25zdCBzdG9yYWdlUGF0aCA9ICdmb3JlY2FzdHNfc25hcHNob3RzLycgKyB5ZWFyTW9udGggKyAnLycgKyBmYW1pbGlhICsgJy54bHN4JztcclxuICAgIHNldFN0YXR1cygnU3ViaWVuZG8gRXhjZWwgYSBTdG9yYWdlICgnICsgX2ZtdFNpemUoZmlsZS5zaXplKSArICcpXHUyMDI2Jyk7XHJcbiAgICBjb25zdCBzdG9yYWdlUmVmID0gd2luZG93LmZpcmViYXNlLnN0b3JhZ2UoKS5yZWYoc3RvcmFnZVBhdGgpO1xyXG4gICAgYXdhaXQgc3RvcmFnZVJlZi5wdXQoZmlsZSwge1xyXG4gICAgICBjb250ZW50VHlwZTogZmlsZS50eXBlIHx8ICdhcHBsaWNhdGlvbi92bmQub3BlbnhtbGZvcm1hdHMtb2ZmaWNlZG9jdW1lbnQuc3ByZWFkc2hlZXRtbC5zaGVldCcsXHJcbiAgICAgIGN1c3RvbU1ldGFkYXRhOiB7XHJcbiAgICAgICAgZmFtaWxpYSxcclxuICAgICAgICB1cGxvYWRlZEJ5OiAod2luZG93LmN1cnJlbnRVc2VyICYmIHdpbmRvdy5jdXJyZW50VXNlci5lbWFpbCkgfHwgJycsXHJcbiAgICAgICAgc291cmNlRmlsZW5hbWU6IGZpbGUubmFtZSB8fCAnJyxcclxuICAgICAgfSxcclxuICAgIH0pO1xyXG4gICAgc2V0U3RhdHVzKCdHdWFyZGFuZG8gcGFyc2VvIGVuIEZpcmVzdG9yZSAoJyArIHBhcnNlZC5yb3dzLmxlbmd0aCArICcgU0tVcylcdTIwMjYnKTtcclxuICAgIGNvbnN0IHVwbG9hZGVkQnkgPSAod2luZG93LmN1cnJlbnRVc2VyICYmIHdpbmRvdy5jdXJyZW50VXNlci5lbWFpbCkgfHwgJ3Vua25vd24nO1xyXG4gICAgY29uc3QgcGF5bG9hZCA9IHtcclxuICAgICAgZmFtaWxpYSxcclxuICAgICAgcGFyc2VkQXQ6XHJcbiAgICAgICAgd2luZG93LmZpcmViYXNlICYmIHdpbmRvdy5maXJlYmFzZS5maXJlc3RvcmUgJiYgd2luZG93LmZpcmViYXNlLmZpcmVzdG9yZS5GaWVsZFZhbHVlXHJcbiAgICAgICAgICA/IHdpbmRvdy5maXJlYmFzZS5maXJlc3RvcmUuRmllbGRWYWx1ZS5zZXJ2ZXJUaW1lc3RhbXAoKVxyXG4gICAgICAgICAgOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXHJcbiAgICAgIHVwbG9hZGVkQnksXHJcbiAgICAgIHNvdXJjZUZpbGVuYW1lOiBmaWxlLm5hbWUgfHwgJycsXHJcbiAgICAgIHNvdXJjZVNoZWV0OiBzYXJOYW1lLFxyXG4gICAgICB5ZWFyTW9udGgsXHJcbiAgICAgIHN0b3JhZ2VQYXRoLFxyXG4gICAgICByb3dzQ291bnQ6IHBhcnNlZC5yb3dzLmxlbmd0aCxcclxuICAgICAgaGVhZGVyUm93SW5kZXg6IHBhcnNlZC5oZWFkZXJSb3dJbmRleCxcclxuICAgICAgZGV0ZWN0ZWRNb250aHM6IHBhcnNlZC5kZXRlY3RlZE1vbnRocyxcclxuICAgICAgcm93czogcGFyc2VkLnJvd3MsXHJcbiAgICB9O1xyXG4gICAgYXdhaXQgd2luZG93LmZiRGIuY29sbGVjdGlvbignc2FsZXNfcGxhbl9jYWNoZScpLmRvYyhmYW1pbGlhKS5zZXQocGF5bG9hZCk7XHJcbiAgICAvLyB2MTEwNyBmaXg6IGd1YXJkYXIgY2FjaGUgbG9jYWwgY29uIERhdGUgcmVhbCAobm8gZWwgU2VudGluZWxWYWx1ZSkgcGFyYVxyXG4gICAgLy8gcXVlIF9mbXREYXRlU2hvcnQgbm8gbXVlc3RyZSBcIkludmFsaWQgRGF0ZVwiLiBFbCBzZXJ2ZXIgdGllbmUgZWwgdHMgZXhhY3RvLFxyXG4gICAgLy8gZWwgbG9jYWwgbXVlc3RyYSBlbCBtb21lbnRvIGRlbCB1cGxvYWQgKGFwcm94aW1hZG8gfjFzIGRlIGRpZmVyZW5jaWEpLlxyXG4gICAgX3NhbGVzUGxhbkNhY2hlc1tmYW1pbGlhXSA9IE9iamVjdC5hc3NpZ24oe30sIHBheWxvYWQsIHsgcGFyc2VkQXQ6IG5ldyBEYXRlKCkgfSk7XHJcbiAgICBzZXRTdGF0dXMoXHJcbiAgICAgICdcdTI3MTMgT0suICcgKyBwYXJzZWQucm93cy5sZW5ndGggKyAnIFNLVXMgXHUwMEQ3ICcgKyBwYXJzZWQuZGV0ZWN0ZWRNb250aHMubGVuZ3RoICsgJyBtZXNlcy4nLFxyXG4gICAgICAnIzE2YTM0YSdcclxuICAgICk7XHJcbiAgICBfcmVuZGVyU2FsZXNQbGFuc1RhYigpO1xyXG4gIH0gY2F0Y2ggKGUpIHtcclxuICAgIGNvbnNvbGUuZXJyb3IoJ1tGT1JFQ0FTVF0gdXBsb2FkIHNhbGVzIHBsYW4gJyArIGZhbWlsaWEgKyAnIGZhaWw6JywgZSk7XHJcbiAgICBzZXRTdGF0dXMoJ1x1MjcxNyBFcnJvcjogJyArICgoZSAmJiBlLm1lc3NhZ2UpIHx8IGUpLCAnI2RjMjYyNicpO1xyXG4gICAgaWYgKGUgJiYgZS5jb2RlID09PSAnTU9OVEhTX05PVF9GT1VORCcpIHtcclxuICAgICAgYWxlcnQoXHJcbiAgICAgICAgJ0VsIEV4Y2VsIG5vIHRpZW5lIGNvbHVtbmFzIGRlIG1lc2VzIHJlY29ub2NpYmxlcy5cXG5cXG5IZWFkZXJzIGVzcGVyYWRvczogXCJKYW4gMjAyN1wiLCBcIk1heSAyMDI3XCIsIFwiRW5lIDIwMjdcIiwgXCIyMDI3LTAxXCIsIGV0Yy5cXG5cXG5EZXRhbGxlOiAnICtcclxuICAgICAgICAgIGUubWVzc2FnZVxyXG4gICAgICApO1xyXG4gICAgfVxyXG4gIH0gZmluYWxseSB7XHJcbiAgICBpZiAoZXZlbnQgJiYgZXZlbnQudGFyZ2V0KSBldmVudC50YXJnZXQudmFsdWUgPSAnJztcclxuICB9XHJcbn07XHJcblxyXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuLy8gRjJCIFx1MjAxNCBGb3JlY2FzdCBFc3RhZFx1MDBFRHN0aWNvOiB0YWJsYSArIGRldGFsbGVcclxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblxyXG5hc3luYyBmdW5jdGlvbiBfbG9hZEZvcmVjYXN0T3V0cHV0KCkge1xyXG4gIGlmICghd2luZG93LmZiRGIpIHRocm93IG5ldyBFcnJvcignRmlyZXN0b3JlIG5vIGluaWNpYWxpemFkbycpO1xyXG4gIGNvbnNvbGUubG9nKCdbRk9SRUNBU1Qgc3RhdF0gbG9hZGluZyBmb3JlY2FzdF9vdXRwdXQuLi4nKTtcclxuICBjb25zdCBbc25hcCwgbWV0YURvY10gPSBhd2FpdCBQcm9taXNlLmFsbChbXHJcbiAgICB3aW5kb3cuZmJEYi5jb2xsZWN0aW9uKCdmb3JlY2FzdF9vdXRwdXQnKS5nZXQoKSxcclxuICAgIHdpbmRvdy5mYkRiLmNvbGxlY3Rpb24oJ2ZvcmVjYXN0X291dHB1dF9tZXRhJykuZG9jKCdjdXJyZW50JykuZ2V0KCksXHJcbiAgXSk7XHJcbiAgY29uc3QgZG9jcyA9IFtdO1xyXG4gIHNuYXAuZm9yRWFjaCgoZCkgPT4gZG9jcy5wdXNoKE9iamVjdC5hc3NpZ24oeyBpZDogZC5pZCB9LCBkLmRhdGEoKSkpKTtcclxuICBkb2NzLnNvcnQoKGEsIGIpID0+IHtcclxuICAgIGNvbnN0IHdhID0gKGEubWV0cmljcyAmJiBhLm1ldHJpY3Mud2FwZSkgfHwgOTk5O1xyXG4gICAgY29uc3Qgd2IgPSAoYi5tZXRyaWNzICYmIGIubWV0cmljcy53YXBlKSB8fCA5OTk7XHJcbiAgICByZXR1cm4gd2EgLSB3YjtcclxuICB9KTtcclxuICBfZm9yZWNhc3RTdGF0RG9jcyA9IGRvY3M7XHJcbiAgX2ZvcmVjYXN0U3RhdE1ldGEgPSBtZXRhRG9jLmV4aXN0cyA/IG1ldGFEb2MuZGF0YSgpIDogbnVsbDtcclxuICBjb25zb2xlLmxvZygnW0ZPUkVDQVNUIHN0YXRdIGxvYWRlZCcsIGRvY3MubGVuZ3RoLCAnZG9jcyBcdTAwQjcgbWV0YTonLCAhIV9mb3JlY2FzdFN0YXRNZXRhKTtcclxuICByZXR1cm4gZG9jcztcclxufVxyXG5cclxuZnVuY3Rpb24gX3dhcGVCYWRnZUNvbG9yKHcpIHtcclxuICBpZiAodyA9PSBudWxsKSByZXR1cm4gJyM2NDc0OGInO1xyXG4gIGlmICh3IDwgMC4zKSByZXR1cm4gJyMxNmEzNGEnOyAvLyB2ZXJkZSAtIGV4Y2VsZW50ZVxyXG4gIGlmICh3IDwgMC41KSByZXR1cm4gJyM4NGNjMTYnOyAvLyBsaW1hIC0gYnVlbm9cclxuICBpZiAodyA8IDAuNykgcmV0dXJuICcjZWFiMzA4JzsgLy8gYW1hcmlsbG8gLSBhY2VwdGFibGVcclxuICBpZiAodyA8IDEuMCkgcmV0dXJuICcjZjk3MzE2JzsgLy8gbmFyYW5qYSAtIHBvYnJlXHJcbiAgcmV0dXJuICcjZGMyNjI2JzsgLy8gcm9qbyAtIG11eSBwb2JyZVxyXG59XHJcblxyXG5mdW5jdGlvbiBfZm10TnVtKG4pIHtcclxuICBpZiAobiA9PSBudWxsIHx8ICFOdW1iZXIuaXNGaW5pdGUoTnVtYmVyKG4pKSkgcmV0dXJuICdcdTIwMTQnO1xyXG4gIHJldHVybiBOdW1iZXIobikudG9Mb2NhbGVTdHJpbmcoJ2VzLUFSJywgeyBtYXhpbXVtRnJhY3Rpb25EaWdpdHM6IDAgfSk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIF9mbXRXYXBlKHcpIHtcclxuICBpZiAodyA9PSBudWxsIHx8ICFOdW1iZXIuaXNGaW5pdGUoTnVtYmVyKHcpKSkgcmV0dXJuICdcdTIwMTQnO1xyXG4gIHJldHVybiAoTnVtYmVyKHcpICogMTAwKS50b0ZpeGVkKDApICsgJyUnO1xyXG59XHJcblxyXG5mdW5jdGlvbiBfZm10RHNTaG9ydChpc28pIHtcclxuICAvLyAnMjAyNi0xMC0wMScgLT4gJ29jdCAyNidcclxuICB0cnkge1xyXG4gICAgY29uc3QgW3ksIG1dID0gaXNvLnNwbGl0KCctJykubWFwKE51bWJlcik7XHJcbiAgICBjb25zdCBuYW1lcyA9IFtcclxuICAgICAgJ2VuZScsXHJcbiAgICAgICdmZWInLFxyXG4gICAgICAnbWFyJyxcclxuICAgICAgJ2FicicsXHJcbiAgICAgICdtYXknLFxyXG4gICAgICAnanVuJyxcclxuICAgICAgJ2p1bCcsXHJcbiAgICAgICdhZ28nLFxyXG4gICAgICAnc2VwJyxcclxuICAgICAgJ29jdCcsXHJcbiAgICAgICdub3YnLFxyXG4gICAgICAnZGljJyxcclxuICAgIF07XHJcbiAgICByZXR1cm4gbmFtZXNbbSAtIDFdICsgJyAnICsgU3RyaW5nKHkpLnNsaWNlKC0yKTtcclxuICB9IGNhdGNoIHtcclxuICAgIHJldHVybiBpc287XHJcbiAgfVxyXG59XHJcblxyXG5mdW5jdGlvbiBfcmVuZGVyRm9yZWNhc3RTdGF0VGFiKCkge1xyXG4gIGNvbnN0IGNvbnQgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZm9yZWNhc3QtdGFiLXN0YXQnKTtcclxuICBpZiAoIWNvbnQpIHJldHVybjtcclxuICB0cnkge1xyXG4gICAgX3JlbmRlckZvcmVjYXN0U3RhdFRhYkltcGwoY29udCk7XHJcbiAgfSBjYXRjaCAoZSkge1xyXG4gICAgY29uc29sZS5lcnJvcignW0ZPUkVDQVNUIHN0YXRdIHJlbmRlciBmYWlsJywgZSk7XHJcbiAgICBjb250LmlubmVySFRNTCA9XHJcbiAgICAgICc8ZGl2IHN0eWxlPVwicGFkZGluZzo0MHB4IDIwcHg7Y29sb3I6I2RjMjYyNjtsaW5lLWhlaWdodDoxLjZcIj4nICtcclxuICAgICAgJzxkaXYgc3R5bGU9XCJmb250LXNpemU6MTZweDtmb250LXdlaWdodDo3MDA7bWFyZ2luLWJvdHRvbToxMHB4XCI+RXJyb3IgcmVuZGVyaXphbmRvIHRhYiBGb3JlY2FzdCBFc3RhZFx1MDBFRHN0aWNvPC9kaXY+JyArXHJcbiAgICAgICc8cHJlIHN0eWxlPVwiZm9udC1zaXplOjExcHg7YmFja2dyb3VuZDojZmVmMmYyO3BhZGRpbmc6MTJweDtib3JkZXItcmFkaXVzOjZweDtvdmVyZmxvdzphdXRvO3doaXRlLXNwYWNlOnByZS13cmFwXCI+JyArXHJcbiAgICAgIGVzY2FwZUh0bWxTYWZlKGUuc3RhY2sgfHwgZS5tZXNzYWdlIHx8IFN0cmluZyhlKSkgK1xyXG4gICAgICAnPC9wcmU+PC9kaXY+JztcclxuICB9XHJcbn1cclxuXHJcbmZ1bmN0aW9uIF9yZW5kZXJGb3JlY2FzdFN0YXRUYWJJbXBsKGNvbnQpIHtcclxuICBjb25zdCBkb2NzID0gX2ZvcmVjYXN0U3RhdERvY3MgfHwgW107XHJcbiAgY29uc3QgbWV0YSA9IF9mb3JlY2FzdFN0YXRNZXRhIHx8IHt9O1xyXG4gIGNvbnN0IHJlc3VtZW4gPSBtZXRhLnJlc3VtZW4gfHwge307XHJcbiAgY29uc29sZS5sb2coJ1tGT1JFQ0FTVCBzdGF0XSByZW5kZXIgXHUyMDE0IGRvY3M6JywgZG9jcy5sZW5ndGgsICdtZXRhOicsICEhbWV0YS5nZW5lcmF0ZWRBdCk7XHJcbiAgaWYgKCFkb2NzLmxlbmd0aCkge1xyXG4gICAgY29udC5pbm5lckhUTUwgPVxyXG4gICAgICAnPGRpdiBzdHlsZT1cInBhZGRpbmc6NjBweCAyMHB4O3RleHQtYWxpZ246Y2VudGVyO2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpXCI+JyArXHJcbiAgICAgICdObyBoYXkgZm9yZWNhc3Rfb3V0cHV0IHB1YmxpY2Fkby48YnI+PGJyPicgK1xyXG4gICAgICAnQ29ycmVyIDxjb2RlPnB5dGhvbiBzY3JpcHRzL2ZvcmVjYXN0L3RyYWluX3Byb2QucHkgJiYgcHl0aG9uIHNjcmlwdHMvZm9yZWNhc3QvcHVibGlzaF90b19maXJlc3RvcmUucHk8L2NvZGU+LicgK1xyXG4gICAgICAnPC9kaXY+JztcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgLy8gTWVzZXMgZGVsIGZvcmVjYXN0IChkcyBkZWwgcHJpbWVyIGRvYywgc2UgYXN1bWUgaWd1YWwgZW4gdG9kb3MpLlxyXG4gIGNvbnN0IG1vbnRoc0lzbyA9IChkb2NzWzBdLmZvcmVjYXN0IHx8IFtdKS5tYXAoKGYpID0+IGYuZHMpO1xyXG4gIGNvbnN0IG1vbnRoSGVhZGVycyA9IG1vbnRoc0lzby5tYXAoX2ZtdERzU2hvcnQpO1xyXG5cclxuICAvLyBNZXRyaWNzIGNoaXAgZ2xvYmFsXHJcbiAgY29uc3QgZ2VuZXJhdGVkID0gbWV0YS5nZW5lcmF0ZWRBdFxyXG4gICAgPyBuZXcgRGF0ZShtZXRhLmdlbmVyYXRlZEF0KS50b0xvY2FsZVN0cmluZygnZXMtQVInLCB7XHJcbiAgICAgICAgZGF5OiAnMi1kaWdpdCcsXHJcbiAgICAgICAgbW9udGg6ICdzaG9ydCcsXHJcbiAgICAgICAgeWVhcjogJzItZGlnaXQnLFxyXG4gICAgICAgIGhvdXI6ICcyLWRpZ2l0JyxcclxuICAgICAgICBtaW51dGU6ICcyLWRpZ2l0JyxcclxuICAgICAgfSlcclxuICAgIDogJ1x1MjAxNCc7XHJcbiAgY29uc3Qgd2FwZU1lZCA9XHJcbiAgICByZXN1bWVuLndhcGVfbWVkaWFub19iZXN0X3Blcl9zZXJpZXMgIT0gbnVsbFxyXG4gICAgICA/IF9mbXRXYXBlKHJlc3VtZW4ud2FwZV9tZWRpYW5vX2Jlc3RfcGVyX3NlcmllcylcclxuICAgICAgOiAnXHUyMDE0JztcclxuICBjb25zdCBuU3VicyA9IHJlc3VtZW4ubl9zdWJmYW1pbGlhcyB8fCBkb2NzLmxlbmd0aDtcclxuICBjb25zdCBuTHQwNSA9XHJcbiAgICByZXN1bWVuLm5fc2VyaWVzX3dhcGVfbHRfMF81ICE9IG51bGwgPyByZXN1bWVuLm5fc2VyaWVzX3dhcGVfbHRfMF81ICsgJy8nICsgblN1YnMgOiAnXHUyMDE0JztcclxuICBjb25zdCBuTHQwMyA9XHJcbiAgICByZXN1bWVuLm5fc2VyaWVzX3dhcGVfbHRfMF8zICE9IG51bGwgPyByZXN1bWVuLm5fc2VyaWVzX3dhcGVfbHRfMF8zICsgJy8nICsgblN1YnMgOiAnXHUyMDE0JztcclxuXHJcbiAgY29uc3QgYmFubmVyID1cclxuICAgICc8ZGl2IHN0eWxlPVwibWFyZ2luLWJvdHRvbToxNHB4O3BhZGRpbmc6MTJweCAxNHB4O2JhY2tncm91bmQ6dmFyKC0tYmctc2Vjb25kYXJ5KTtib3JkZXItbGVmdDozcHggc29saWQgIzBkOTQ4ODtib3JkZXItcmFkaXVzOjZweDtmb250LXNpemU6MTJweDtjb2xvcjp2YXIoLS10ZXh0LXNlY29uZGFyeSk7bGluZS1oZWlnaHQ6MS41O2Rpc3BsYXk6Z3JpZDtncmlkLXRlbXBsYXRlLWNvbHVtbnM6cmVwZWF0KGF1dG8tZml0LG1pbm1heCgxNjBweCwxZnIpKTtnYXA6MTBweFwiPicgK1xyXG4gICAgJzxkaXY+PGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMHB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtsZXR0ZXItc3BhY2luZzouNHB4XCI+V0FQRSBtZWRpYW5vPC9kaXY+PGRpdiBzdHlsZT1cImZvbnQtc2l6ZToyMHB4O2ZvbnQtd2VpZ2h0OjgwMDtjb2xvcjp2YXIoLS10ZXh0LXByaW1hcnkpXCI+JyArXHJcbiAgICB3YXBlTWVkICtcclxuICAgICc8L2Rpdj48L2Rpdj4nICtcclxuICAgICc8ZGl2PjxkaXYgc3R5bGU9XCJmb250LXNpemU6MTBweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7bGV0dGVyLXNwYWNpbmc6LjRweFwiPlN1YmZhbWlsaWFzPC9kaXY+PGRpdiBzdHlsZT1cImZvbnQtc2l6ZToyMHB4O2ZvbnQtd2VpZ2h0OjgwMDtjb2xvcjp2YXIoLS10ZXh0LXByaW1hcnkpXCI+JyArXHJcbiAgICBuU3VicyArXHJcbiAgICAnPC9kaXY+PC9kaXY+JyArXHJcbiAgICAnPGRpdj48ZGl2IHN0eWxlPVwiZm9udC1zaXplOjEwcHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO2xldHRlci1zcGFjaW5nOi40cHhcIj5XQVBFICZsdDsgMzAlIChleGNlbGVudGUpPC9kaXY+PGRpdiBzdHlsZT1cImZvbnQtc2l6ZToyMHB4O2ZvbnQtd2VpZ2h0OjgwMDtjb2xvcjojMTZhMzRhXCI+JyArXHJcbiAgICBuTHQwMyArXHJcbiAgICAnPC9kaXY+PC9kaXY+JyArXHJcbiAgICAnPGRpdj48ZGl2IHN0eWxlPVwiZm9udC1zaXplOjEwcHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO2xldHRlci1zcGFjaW5nOi40cHhcIj5XQVBFICZsdDsgNTAlIChidWVubyk8L2Rpdj48ZGl2IHN0eWxlPVwiZm9udC1zaXplOjIwcHg7Zm9udC13ZWlnaHQ6ODAwO2NvbG9yOiM4NGNjMTZcIj4nICtcclxuICAgIG5MdDA1ICtcclxuICAgICc8L2Rpdj48L2Rpdj4nICtcclxuICAgICc8ZGl2PjxkaXYgc3R5bGU9XCJmb250LXNpemU6MTBweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7bGV0dGVyLXNwYWNpbmc6LjRweFwiPlx1MDBEQWx0aW1hIGNvcnJpZGE8L2Rpdj48ZGl2IHN0eWxlPVwiZm9udC1zaXplOjEzcHg7Zm9udC13ZWlnaHQ6NjAwO2NvbG9yOnZhcigtLXRleHQtcHJpbWFyeSk7bWFyZ2luLXRvcDo0cHhcIj4nICtcclxuICAgIGVzY2FwZUh0bWxTYWZlKGdlbmVyYXRlZCkgK1xyXG4gICAgJzwvZGl2PjwvZGl2PicgK1xyXG4gICAgJzwvZGl2Pic7XHJcblxyXG4gIC8vIFRhYmxhIHJvd3NcclxuICBjb25zdCByb3dzSHRtbCA9IGRvY3NcclxuICAgIC5tYXAoKGQpID0+IHtcclxuICAgICAgY29uc3Qgd2FwZSA9IGQubWV0cmljcyAmJiBkLm1ldHJpY3Mud2FwZSAhPSBudWxsID8gZC5tZXRyaWNzLndhcGUgOiBudWxsO1xyXG4gICAgICBjb25zdCBiZXN0TW9kZWwgPSBkLmJlc3RNb2RlbCB8fCAnXHUyMDE0JztcclxuICAgICAgY29uc3QgZm9yZWNhc3RNYXAgPSB7fTtcclxuICAgICAgKGQuZm9yZWNhc3QgfHwgW10pLmZvckVhY2goKGYpID0+IHtcclxuICAgICAgICBmb3JlY2FzdE1hcFtmLmRzXSA9IGYueV9oYXQ7XHJcbiAgICAgIH0pO1xyXG4gICAgICBjb25zdCBtb250aENlbGxzID0gbW9udGhzSXNvXHJcbiAgICAgICAgLm1hcChcclxuICAgICAgICAgIChkcykgPT5cclxuICAgICAgICAgICAgJzx0ZCBzdHlsZT1cInBhZGRpbmc6OHB4IDEwcHg7dGV4dC1hbGlnbjpyaWdodDtmb250LXZhcmlhbnQtbnVtZXJpYzp0YWJ1bGFyLW51bXM7Zm9udC13ZWlnaHQ6NjAwO2NvbG9yOnZhcigtLXRleHQtcHJpbWFyeSlcIj4nICtcclxuICAgICAgICAgICAgX2ZtdE51bShmb3JlY2FzdE1hcFtkc10pICtcclxuICAgICAgICAgICAgJzwvdGQ+J1xyXG4gICAgICAgIClcclxuICAgICAgICAuam9pbignJyk7XHJcbiAgICAgIGNvbnN0IHRvdGFsNyA9IChkLmZvcmVjYXN0IHx8IFtdKS5yZWR1Y2UoKHMsIGYpID0+IHMgKyAoTnVtYmVyKGYueV9oYXQpIHx8IDApLCAwKTtcclxuICAgICAgcmV0dXJuIChcclxuICAgICAgICAnPHRyIG9uY2xpY2s9XCJvcGVuRm9yZWNhc3RTdGF0RGV0YWlsKFxcJycgK1xyXG4gICAgICAgIGVzY2FwZUh0bWxTYWZlKGQuaWQpICtcclxuICAgICAgICAnXFwnKVwiIHN0eWxlPVwiY3Vyc29yOnBvaW50ZXI7Ym9yZGVyLWJvdHRvbToxcHggc29saWQgdmFyKC0tYm9yZGVyLXN1YnRsZSlcIiBvbm1vdXNlb3Zlcj1cInRoaXMuc3R5bGUuYmFja2dyb3VuZD1cXCd2YXIoLS1iZy1zZWNvbmRhcnkpXFwnXCIgb25tb3VzZW91dD1cInRoaXMuc3R5bGUuYmFja2dyb3VuZD1cXCd0cmFuc3BhcmVudFxcJ1wiPicgK1xyXG4gICAgICAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjhweCAxMHB4O2ZvbnQtd2VpZ2h0OjcwMDtjb2xvcjp2YXIoLS10ZXh0LXByaW1hcnkpXCI+JyArXHJcbiAgICAgICAgZXNjYXBlSHRtbFNhZmUoZC5zdWJmYW1pbGlhIHx8IGQuaWQpICtcclxuICAgICAgICAnPC90ZD4nICtcclxuICAgICAgICAnPHRkIHN0eWxlPVwicGFkZGluZzo4cHggMTBweDtmb250LXNpemU6MTFweDtjb2xvcjp2YXIoLS10ZXh0LXNlY29uZGFyeSlcIj4nICtcclxuICAgICAgICBlc2NhcGVIdG1sU2FmZShiZXN0TW9kZWwpICtcclxuICAgICAgICAnPC90ZD4nICtcclxuICAgICAgICAnPHRkIHN0eWxlPVwicGFkZGluZzo4cHggMTBweDt0ZXh0LWFsaWduOmNlbnRlclwiPjxzcGFuIHN0eWxlPVwiZGlzcGxheTppbmxpbmUtYmxvY2s7cGFkZGluZzozcHggOHB4O2JvcmRlci1yYWRpdXM6MTJweDtiYWNrZ3JvdW5kOicgK1xyXG4gICAgICAgIF93YXBlQmFkZ2VDb2xvcih3YXBlKSArXHJcbiAgICAgICAgJztjb2xvcjojZmZmO2ZvbnQtc2l6ZToxMXB4O2ZvbnQtd2VpZ2h0OjcwMFwiPicgK1xyXG4gICAgICAgIF9mbXRXYXBlKHdhcGUpICtcclxuICAgICAgICAnPC9zcGFuPjwvdGQ+JyArXHJcbiAgICAgICAgbW9udGhDZWxscyArXHJcbiAgICAgICAgJzx0ZCBzdHlsZT1cInBhZGRpbmc6OHB4IDEwcHg7dGV4dC1hbGlnbjpyaWdodDtmb250LXZhcmlhbnQtbnVtZXJpYzp0YWJ1bGFyLW51bXM7Zm9udC13ZWlnaHQ6NzAwO2NvbG9yOiMwZDk0ODg7YmFja2dyb3VuZDp2YXIoLS1iZy1zZWNvbmRhcnkpXCI+JyArXHJcbiAgICAgICAgX2ZtdE51bSh0b3RhbDcpICtcclxuICAgICAgICAnPC90ZD4nICtcclxuICAgICAgICAnPC90cj4nXHJcbiAgICAgICk7XHJcbiAgICB9KVxyXG4gICAgLmpvaW4oJycpO1xyXG5cclxuICBjb25zdCBtb250aEhlYWRlcnNIdG1sID0gbW9udGhIZWFkZXJzXHJcbiAgICAubWFwKFxyXG4gICAgICAobSkgPT5cclxuICAgICAgICAnPHRoIHN0eWxlPVwicGFkZGluZzo4cHggMTBweDt0ZXh0LWFsaWduOnJpZ2h0O2ZvbnQtc2l6ZToxMHB4O3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtsZXR0ZXItc3BhY2luZzouNHB4O2NvbG9yOiM5NGEzYjhcIj4nICtcclxuICAgICAgICBlc2NhcGVIdG1sU2FmZShtKSArXHJcbiAgICAgICAgJzwvdGg+J1xyXG4gICAgKVxyXG4gICAgLmpvaW4oJycpO1xyXG5cclxuICBjb25zdCB0YWJsZSA9XHJcbiAgICAnPGRpdiBzdHlsZT1cIm92ZXJmbG93OmF1dG87Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1ib3JkZXItc3VidGxlKTtib3JkZXItcmFkaXVzOjhweFwiPicgK1xyXG4gICAgJzx0YWJsZSBzdHlsZT1cIndpZHRoOjEwMCU7Ym9yZGVyLWNvbGxhcHNlOmNvbGxhcHNlO2ZvbnQtc2l6ZToxMnB4XCI+JyArXHJcbiAgICAnPHRoZWFkIHN0eWxlPVwiYmFja2dyb3VuZDojMGYxNzJhO2NvbG9yOiNmZmZcIj48dHI+JyArXHJcbiAgICAnPHRoIHN0eWxlPVwicGFkZGluZzo4cHggMTBweDt0ZXh0LWFsaWduOmxlZnQ7Zm9udC1zaXplOjEwcHg7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO2xldHRlci1zcGFjaW5nOi40cHhcIj5TdWJmYW1pbGlhPC90aD4nICtcclxuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjhweCAxMHB4O3RleHQtYWxpZ246bGVmdDtmb250LXNpemU6MTBweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7bGV0dGVyLXNwYWNpbmc6LjRweFwiPk1vZGVsbzwvdGg+JyArXHJcbiAgICAnPHRoIHN0eWxlPVwicGFkZGluZzo4cHggMTBweDt0ZXh0LWFsaWduOmNlbnRlcjtmb250LXNpemU6MTBweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7bGV0dGVyLXNwYWNpbmc6LjRweFwiPldBUEU8L3RoPicgK1xyXG4gICAgbW9udGhIZWFkZXJzSHRtbCArXHJcbiAgICAnPHRoIHN0eWxlPVwicGFkZGluZzo4cHggMTBweDt0ZXh0LWFsaWduOnJpZ2h0O2ZvbnQtc2l6ZToxMHB4O3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtsZXR0ZXItc3BhY2luZzouNHB4O2JhY2tncm91bmQ6IzEzNGU0YVwiPlRvdGFsIDdtPC90aD4nICtcclxuICAgICc8L3RyPjwvdGhlYWQ+JyArXHJcbiAgICAnPHRib2R5PicgK1xyXG4gICAgcm93c0h0bWwgK1xyXG4gICAgJzwvdGJvZHk+PC90YWJsZT48L2Rpdj4nO1xyXG5cclxuICBjb25zdCBmb290ZXIgPVxyXG4gICAgJzxkaXYgc3R5bGU9XCJtYXJnaW4tdG9wOjEycHg7Zm9udC1zaXplOjExcHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7bGluZS1oZWlnaHQ6MS41XCI+JyArXHJcbiAgICAnPGI+Q1x1MDBGM21vIGxlZXI8L2I+OiBXQVBFIChXZWlnaHRlZCBBYnNvbHV0ZSBQZXJjZW50YWdlIEVycm9yKSBtaWRlIGVsIGVycm9yIGRlbCBtb2RlbG8gcmVsYXRpdm8gYWwgdG90YWwgcmVhbDogJmx0OzMwJSBleGNlbGVudGUsIDMwLTUwJSBidWVubywgNTAtNzAlIGFjZXB0YWJsZSwgJmd0OzcwJSBwb2JyZS4gQ2xpY2sgZW4gZmlsYSBwYXJhIGRldGFsbGUgKyBnclx1MDBFMWZpY28uICcgK1xyXG4gICAgJ1NlIGVsaWdlIGVsIG1vZGVsbyBjb24gbWVub3IgV0FQRSBwb3Igc2VyaWUgdHJhcyBiYWNrdGVzdCByb2xsaW5nLW9yaWdpbiAoaD0yLCB2ZW50YW5hcz0zKS4nICtcclxuICAgICc8L2Rpdj4nO1xyXG5cclxuICBjb250LmlubmVySFRNTCA9ICc8ZGl2IHN0eWxlPVwicGFkZGluZzoxOHB4XCI+JyArIGJhbm5lciArIHRhYmxlICsgZm9vdGVyICsgJzwvZGl2Pic7XHJcbn1cclxuXHJcbi8vIENhY2hlIGhpc3RvcmlhIGFncmVnYWRhIHBvciBzdWJmYW1pbGlhIChwYXJhIGdyXHUwMEUxZmljbyBkZXRhbGxlKS5cclxuYXN5bmMgZnVuY3Rpb24gX2xvYWRGb3JlY2FzdFN0YXRIaXN0b3J5KCkge1xyXG4gIGlmIChfZm9yZWNhc3RTdGF0SGlzdG9yeUNhY2hlKSByZXR1cm4gX2ZvcmVjYXN0U3RhdEhpc3RvcnlDYWNoZTtcclxuICAvLyBMYSBoaXN0b3JpYSBzb2xvIGVzdFx1MDBFMSBlbiBCUSAofjEwIGFcdTAwRjFvcyBCYXJhbGRvICsgMTIgbWVzZXMgU2hpbWFubykuIENvbW9cclxuICAvLyBlbCBwaXBlbGluZSBsYSBlc2NyaWJlIGEgQ1NWIGxvY2FsLCBhY1x1MDBFMSBubyBsYSBwb2RlbW9zIGxlZXIuIEFsdGVybmF0aXZhOlxyXG4gIC8vIHVzYXIgc2t1X3ZlbnRhc19zbmFwc2hvdCBxdWUgdGllbmUgdmVudGFzIG1lbnN1YWxlcyBwZXJvIHNvbG8gZ3J1cG8gUEVTQ0EuXHJcbiAgLy8gRW4gRjJCLjIgc29sbyBtb3N0cmFtb3MgZm9yZWNhc3QrSUMgKHNpbiBvdmVybGF5IGhpc3RvcmlhIHBvciBhaG9yYSkuXHJcbiAgX2ZvcmVjYXN0U3RhdEhpc3RvcnlDYWNoZSA9IHt9O1xyXG4gIHJldHVybiBfZm9yZWNhc3RTdGF0SGlzdG9yeUNhY2hlO1xyXG59XHJcblxyXG5mdW5jdGlvbiBfYnVpbGRGb3JlY2FzdENoYXJ0U3ZnKGRvYykge1xyXG4gIGNvbnN0IGZjID0gZG9jLmZvcmVjYXN0IHx8IFtdO1xyXG4gIGlmICghZmMubGVuZ3RoKVxyXG4gICAgcmV0dXJuICc8ZGl2IHN0eWxlPVwicGFkZGluZzozMHB4O3RleHQtYWxpZ246Y2VudGVyO2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpXCI+U2luIGRhdG9zIGRlIGZvcmVjYXN0PC9kaXY+JztcclxuICAvLyBEaW1lbnNpb25lc1xyXG4gIGNvbnN0IFcgPSA2NDAsXHJcbiAgICBIID0gMjYwO1xyXG4gIGNvbnN0IHBhZEwgPSA1MCxcclxuICAgIHBhZFIgPSAyMCxcclxuICAgIHBhZFQgPSAyMCxcclxuICAgIHBhZEIgPSA0MDtcclxuICBjb25zdCBpbm5lclcgPSBXIC0gcGFkTCAtIHBhZFI7XHJcbiAgY29uc3QgaW5uZXJIID0gSCAtIHBhZFQgLSBwYWRCO1xyXG5cclxuICAvLyBZIHJhbmdlOiBtYXgoaGk4MCkgKiAxLjFcclxuICBjb25zdCBtYXhZID0gTWF0aC5tYXgoMSwgLi4uZmMubWFwKChmKSA9PiBOdW1iZXIoZi5oaTgwKSB8fCBOdW1iZXIoZi55X2hhdCkgfHwgMCkpO1xyXG4gIGNvbnN0IG1pblkgPSAwO1xyXG4gIGNvbnN0IHNjYWxlWCA9IChpKSA9PiBwYWRMICsgKGlubmVyVyAqIGkpIC8gTWF0aC5tYXgoMSwgZmMubGVuZ3RoIC0gMSk7XHJcbiAgY29uc3Qgc2NhbGVZID0gKHYpID0+IHBhZFQgKyBpbm5lckggLSAoaW5uZXJIICogKHYgLSBtaW5ZKSkgLyAobWF4WSAtIG1pblkpO1xyXG5cclxuICAvLyBHcmlkICsgZWplIFlcclxuICBjb25zdCB5VGlja3MgPSBbMCwgMC4yNSwgMC41LCAwLjc1LCAxXVxyXG4gICAgLm1hcCgocikgPT4ge1xyXG4gICAgICBjb25zdCB2YWwgPSBtaW5ZICsgciAqIChtYXhZIC0gbWluWSk7XHJcbiAgICAgIGNvbnN0IHl5ID0gc2NhbGVZKHZhbCk7XHJcbiAgICAgIHJldHVybiAoXHJcbiAgICAgICAgJzxsaW5lIHgxPVwiJyArXHJcbiAgICAgICAgcGFkTCArXHJcbiAgICAgICAgJ1wiIHkxPVwiJyArXHJcbiAgICAgICAgeXkgK1xyXG4gICAgICAgICdcIiB4Mj1cIicgK1xyXG4gICAgICAgIChXIC0gcGFkUikgK1xyXG4gICAgICAgICdcIiB5Mj1cIicgK1xyXG4gICAgICAgIHl5ICtcclxuICAgICAgICAnXCIgc3Ryb2tlPVwiI2UyZThmMFwiIHN0cm9rZS13aWR0aD1cIjFcIi8+JyArXHJcbiAgICAgICAgJzx0ZXh0IHg9XCInICtcclxuICAgICAgICAocGFkTCAtIDYpICtcclxuICAgICAgICAnXCIgeT1cIicgK1xyXG4gICAgICAgICh5eSArIDQpICtcclxuICAgICAgICAnXCIgdGV4dC1hbmNob3I9XCJlbmRcIiBmb250LXNpemU9XCIxMFwiIGZpbGw9XCIjNjQ3NDhiXCI+JyArXHJcbiAgICAgICAgX2ZtdE51bSh2YWwpICtcclxuICAgICAgICAnPC90ZXh0PidcclxuICAgICAgKTtcclxuICAgIH0pXHJcbiAgICAuam9pbignJyk7XHJcblxyXG4gIC8vIEVqZSBYIChtZXNlcylcclxuICBjb25zdCB4TGFiZWxzID0gZmNcclxuICAgIC5tYXAoKGYsIGkpID0+IHtcclxuICAgICAgY29uc3QgeHggPSBzY2FsZVgoaSk7XHJcbiAgICAgIHJldHVybiAoXHJcbiAgICAgICAgJzx0ZXh0IHg9XCInICtcclxuICAgICAgICB4eCArXHJcbiAgICAgICAgJ1wiIHk9XCInICtcclxuICAgICAgICAoSCAtIHBhZEIgKyAxNSkgK1xyXG4gICAgICAgICdcIiB0ZXh0LWFuY2hvcj1cIm1pZGRsZVwiIGZvbnQtc2l6ZT1cIjEwXCIgZmlsbD1cIiM2NDc0OGJcIj4nICtcclxuICAgICAgICBfZm10RHNTaG9ydChmLmRzKSArXHJcbiAgICAgICAgJzwvdGV4dD4nXHJcbiAgICAgICk7XHJcbiAgICB9KVxyXG4gICAgLmpvaW4oJycpO1xyXG5cclxuICAvLyBJbnRlcnZhbG8gY29uZmlhbnphIChiYW5kKVxyXG4gIGNvbnN0IGJhbmRQb2ludHMgPVxyXG4gICAgZmMubWFwKChmLCBpKSA9PiBzY2FsZVgoaSkgKyAnLCcgKyBzY2FsZVkoTnVtYmVyKGYuaGk4MCkgfHwgMCkpLmpvaW4oJyAnKSArXHJcbiAgICAnICcgK1xyXG4gICAgZmNcclxuICAgICAgLnNsaWNlKClcclxuICAgICAgLnJldmVyc2UoKVxyXG4gICAgICAubWFwKChmLCBpKSA9PiBzY2FsZVgoZmMubGVuZ3RoIC0gMSAtIGkpICsgJywnICsgc2NhbGVZKE51bWJlcihmLmxvODApIHx8IDApKVxyXG4gICAgICAuam9pbignICcpO1xyXG4gIGNvbnN0IGJhbmQgPSAnPHBvbHlnb24gcG9pbnRzPVwiJyArIGJhbmRQb2ludHMgKyAnXCIgZmlsbD1cIiMwZDk0ODgzM1wiIHN0cm9rZT1cIm5vbmVcIi8+JztcclxuXHJcbiAgLy8gTGluZSBmb3JlY2FzdCArIHB1bnRvc1xyXG4gIGNvbnN0IGxpbmVQb2ludHMgPSBmYy5tYXAoKGYsIGkpID0+IHNjYWxlWChpKSArICcsJyArIHNjYWxlWShOdW1iZXIoZi55X2hhdCkgfHwgMCkpLmpvaW4oJyAnKTtcclxuICBjb25zdCBsaW5lID1cclxuICAgICc8cG9seWxpbmUgcG9pbnRzPVwiJyArXHJcbiAgICBsaW5lUG9pbnRzICtcclxuICAgICdcIiBmaWxsPVwibm9uZVwiIHN0cm9rZT1cIiMwZDk0ODhcIiBzdHJva2Utd2lkdGg9XCIyLjVcIiBzdHJva2UtbGluZWpvaW49XCJyb3VuZFwiLz4nO1xyXG4gIGNvbnN0IHBvaW50cyA9IGZjXHJcbiAgICAubWFwKFxyXG4gICAgICAoZiwgaSkgPT5cclxuICAgICAgICAnPGNpcmNsZSBjeD1cIicgK1xyXG4gICAgICAgIHNjYWxlWChpKSArXHJcbiAgICAgICAgJ1wiIGN5PVwiJyArXHJcbiAgICAgICAgc2NhbGVZKE51bWJlcihmLnlfaGF0KSB8fCAwKSArXHJcbiAgICAgICAgJ1wiIHI9XCI0XCIgZmlsbD1cIiMwZDk0ODhcIiBzdHJva2U9XCIjZmZmXCIgc3Ryb2tlLXdpZHRoPVwiMlwiLz4nXHJcbiAgICApXHJcbiAgICAuam9pbignJyk7XHJcbiAgLy8gTGFiZWxzIGRlIHZhbG9yXHJcbiAgY29uc3QgdmFsdWVMYWJlbHMgPSBmY1xyXG4gICAgLm1hcCgoZiwgaSkgPT4ge1xyXG4gICAgICBjb25zdCB4eCA9IHNjYWxlWChpKTtcclxuICAgICAgY29uc3QgeXkgPSBzY2FsZVkoTnVtYmVyKGYueV9oYXQpIHx8IDApO1xyXG4gICAgICByZXR1cm4gKFxyXG4gICAgICAgICc8dGV4dCB4PVwiJyArXHJcbiAgICAgICAgeHggK1xyXG4gICAgICAgICdcIiB5PVwiJyArXHJcbiAgICAgICAgKHl5IC0gOCkgK1xyXG4gICAgICAgICdcIiB0ZXh0LWFuY2hvcj1cIm1pZGRsZVwiIGZvbnQtc2l6ZT1cIjEwXCIgZm9udC13ZWlnaHQ9XCI3MDBcIiBmaWxsPVwiIzBmNzY2ZVwiPicgK1xyXG4gICAgICAgIF9mbXROdW0oZi55X2hhdCkgK1xyXG4gICAgICAgICc8L3RleHQ+J1xyXG4gICAgICApO1xyXG4gICAgfSlcclxuICAgIC5qb2luKCcnKTtcclxuXHJcbiAgY29uc3Qgc3ZnID1cclxuICAgICc8c3ZnIHZpZXdCb3g9XCIwIDAgJyArXHJcbiAgICBXICtcclxuICAgICcgJyArXHJcbiAgICBIICtcclxuICAgICdcIiBzdHlsZT1cIndpZHRoOjEwMCU7bWF4LXdpZHRoOjgwMHB4O2hlaWdodDphdXRvXCI+JyArXHJcbiAgICAnPHJlY3QgeD1cIjBcIiB5PVwiMFwiIHdpZHRoPVwiJyArXHJcbiAgICBXICtcclxuICAgICdcIiBoZWlnaHQ9XCInICtcclxuICAgIEggK1xyXG4gICAgJ1wiIGZpbGw9XCIjZmZmXCIvPicgK1xyXG4gICAgeVRpY2tzICtcclxuICAgIHhMYWJlbHMgK1xyXG4gICAgYmFuZCArXHJcbiAgICBsaW5lICtcclxuICAgIHBvaW50cyArXHJcbiAgICB2YWx1ZUxhYmVscyArXHJcbiAgICAnPC9zdmc+JztcclxuICByZXR1cm4gc3ZnO1xyXG59XHJcblxyXG53aW5kb3cub3BlbkZvcmVjYXN0U3RhdERldGFpbCA9IGZ1bmN0aW9uIChzdWJJZCkge1xyXG4gIGlmICghX2ZvcmVjYXN0U3RhdERvY3MpIHJldHVybjtcclxuICBjb25zdCBkb2MgPSBfZm9yZWNhc3RTdGF0RG9jcy5maW5kKChkKSA9PiBkLmlkID09PSBzdWJJZCk7XHJcbiAgaWYgKCFkb2MpIHtcclxuICAgIGFsZXJ0KCdObyBzZSBlbmNvbnRyXHUwMEYzIGRldGFsbGUgZGUgJyArIHN1YklkKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgY29uc3QgZXhpc3RpbmcgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZm9yZWNhc3Qtc3RhdC1kZXRhaWwnKTtcclxuICBpZiAoZXhpc3RpbmcpIGV4aXN0aW5nLnJlbW92ZSgpO1xyXG5cclxuICBjb25zdCBlbCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpO1xyXG4gIGVsLmlkID0gJ2ZvcmVjYXN0LXN0YXQtZGV0YWlsJztcclxuICBlbC5zdHlsZS5jc3NUZXh0ID1cclxuICAgICdwb3NpdGlvbjpmaXhlZDtpbnNldDowO2JhY2tncm91bmQ6cmdiYSgxNSwyMyw0MiwuNjUpO3otaW5kZXg6MjEwMDtkaXNwbGF5OmZsZXg7YWxpZ24taXRlbXM6Y2VudGVyO2p1c3RpZnktY29udGVudDpjZW50ZXI7cGFkZGluZzoydmgnO1xyXG4gIGVsLm9uY2xpY2sgPSAoZXYpID0+IHtcclxuICAgIGlmIChldi50YXJnZXQgPT09IGVsKSBlbC5yZW1vdmUoKTtcclxuICB9O1xyXG5cclxuICBjb25zdCB3YXBlID0gZG9jLm1ldHJpY3MgJiYgZG9jLm1ldHJpY3Mud2FwZTtcclxuICBjb25zdCBiaWFzID0gZG9jLm1ldHJpY3MgJiYgZG9jLm1ldHJpY3MuYmlhcztcclxuICBjb25zdCBtYWUgPSBkb2MubWV0cmljcyAmJiBkb2MubWV0cmljcy5tYWU7XHJcbiAgY29uc3Qgcm1zZSA9IGRvYy5tZXRyaWNzICYmIGRvYy5tZXRyaWNzLnJtc2U7XHJcbiAgY29uc3QgYmVzdE1vZGVsID0gZG9jLmJlc3RNb2RlbCB8fCAnXHUyMDE0JztcclxuICBjb25zdCB2ZXJzaW9uSWQgPSBkb2MudmVyc2lvbklkIHx8ICdcdTIwMTQnO1xyXG4gIGNvbnN0IHN2Z0h0bWwgPSBfYnVpbGRGb3JlY2FzdENoYXJ0U3ZnKGRvYyk7XHJcblxyXG4gIGNvbnN0IG1ldHJpY3NIdG1sID1cclxuICAgICc8ZGl2IHN0eWxlPVwiZGlzcGxheTpncmlkO2dyaWQtdGVtcGxhdGUtY29sdW1uczpyZXBlYXQoYXV0by1maXQsbWlubWF4KDEyMHB4LDFmcikpO2dhcDoxMHB4O21hcmdpbjoxNHB4IDBcIj4nICtcclxuICAgICc8ZGl2IHN0eWxlPVwicGFkZGluZzoxMHB4O2JhY2tncm91bmQ6dmFyKC0tYmctc2Vjb25kYXJ5KTtib3JkZXItcmFkaXVzOjZweFwiPjxkaXYgc3R5bGU9XCJmb250LXNpemU6MTBweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2VcIj5Nb2RlbG88L2Rpdj48ZGl2IHN0eWxlPVwiZm9udC13ZWlnaHQ6NzAwXCI+JyArXHJcbiAgICBlc2NhcGVIdG1sU2FmZShiZXN0TW9kZWwpICtcclxuICAgICc8L2Rpdj48L2Rpdj4nICtcclxuICAgICc8ZGl2IHN0eWxlPVwicGFkZGluZzoxMHB4O2JhY2tncm91bmQ6dmFyKC0tYmctc2Vjb25kYXJ5KTtib3JkZXItcmFkaXVzOjZweFwiPjxkaXYgc3R5bGU9XCJmb250LXNpemU6MTBweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2VcIj5XQVBFPC9kaXY+PGRpdiBzdHlsZT1cImZvbnQtd2VpZ2h0OjcwMDtjb2xvcjonICtcclxuICAgIF93YXBlQmFkZ2VDb2xvcih3YXBlKSArXHJcbiAgICAnXCI+JyArXHJcbiAgICBfZm10V2FwZSh3YXBlKSArXHJcbiAgICAnPC9kaXY+PC9kaXY+JyArXHJcbiAgICAnPGRpdiBzdHlsZT1cInBhZGRpbmc6MTBweDtiYWNrZ3JvdW5kOnZhcigtLWJnLXNlY29uZGFyeSk7Ym9yZGVyLXJhZGl1czo2cHhcIj48ZGl2IHN0eWxlPVwiZm9udC1zaXplOjEwcHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlXCI+QmlhczwvZGl2PjxkaXYgc3R5bGU9XCJmb250LXdlaWdodDo3MDBcIj4nICtcclxuICAgIChiaWFzICE9IG51bGwgPyAoYmlhcyAqIDEwMCkudG9GaXhlZCgwKSArICclJyA6ICdcdTIwMTQnKSArXHJcbiAgICAnPC9kaXY+PC9kaXY+JyArXHJcbiAgICAnPGRpdiBzdHlsZT1cInBhZGRpbmc6MTBweDtiYWNrZ3JvdW5kOnZhcigtLWJnLXNlY29uZGFyeSk7Ym9yZGVyLXJhZGl1czo2cHhcIj48ZGl2IHN0eWxlPVwiZm9udC1zaXplOjEwcHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlXCI+TUFFPC9kaXY+PGRpdiBzdHlsZT1cImZvbnQtd2VpZ2h0OjcwMFwiPicgK1xyXG4gICAgX2ZtdE51bShtYWUpICtcclxuICAgICc8L2Rpdj48L2Rpdj4nICtcclxuICAgICc8ZGl2IHN0eWxlPVwicGFkZGluZzoxMHB4O2JhY2tncm91bmQ6dmFyKC0tYmctc2Vjb25kYXJ5KTtib3JkZXItcmFkaXVzOjZweFwiPjxkaXYgc3R5bGU9XCJmb250LXNpemU6MTBweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2VcIj5STVNFPC9kaXY+PGRpdiBzdHlsZT1cImZvbnQtd2VpZ2h0OjcwMFwiPicgK1xyXG4gICAgX2ZtdE51bShybXNlKSArXHJcbiAgICAnPC9kaXY+PC9kaXY+JyArXHJcbiAgICAnPC9kaXY+JztcclxuXHJcbiAgY29uc3QgdGFibGVIdG1sID1cclxuICAgICc8dGFibGUgc3R5bGU9XCJ3aWR0aDoxMDAlO2ZvbnQtc2l6ZToxMnB4O2JvcmRlci1jb2xsYXBzZTpjb2xsYXBzZTttYXJnaW4tdG9wOjEwcHhcIj4nICtcclxuICAgICc8dGhlYWQgc3R5bGU9XCJiYWNrZ3JvdW5kOiMwZjE3MmE7Y29sb3I6I2ZmZlwiPjx0cj4nICtcclxuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjZweCAxMHB4O3RleHQtYWxpZ246bGVmdFwiPk1lczwvdGg+JyArXHJcbiAgICAnPHRoIHN0eWxlPVwicGFkZGluZzo2cHggMTBweDt0ZXh0LWFsaWduOnJpZ2h0XCI+Rm9yZWNhc3Q8L3RoPicgK1xyXG4gICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6NnB4IDEwcHg7dGV4dC1hbGlnbjpyaWdodFwiPklDIDgwJSBiYWpvPC90aD4nICtcclxuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjZweCAxMHB4O3RleHQtYWxpZ246cmlnaHRcIj5JQyA4MCUgYWx0bzwvdGg+JyArXHJcbiAgICAnPC90cj48L3RoZWFkPjx0Ym9keT4nICtcclxuICAgIChkb2MuZm9yZWNhc3QgfHwgW10pXHJcbiAgICAgIC5tYXAoXHJcbiAgICAgICAgKGYpID0+XHJcbiAgICAgICAgICAnPHRyIHN0eWxlPVwiYm9yZGVyLWJvdHRvbToxcHggc29saWQgdmFyKC0tYm9yZGVyLXN1YnRsZSlcIj48dGQgc3R5bGU9XCJwYWRkaW5nOjZweCAxMHB4XCI+JyArXHJcbiAgICAgICAgICBlc2NhcGVIdG1sU2FmZShfZm10RHNTaG9ydChmLmRzKSkgK1xyXG4gICAgICAgICAgJzwvdGQ+JyArXHJcbiAgICAgICAgICAnPHRkIHN0eWxlPVwicGFkZGluZzo2cHggMTBweDt0ZXh0LWFsaWduOnJpZ2h0O2ZvbnQtd2VpZ2h0OjcwMFwiPicgK1xyXG4gICAgICAgICAgX2ZtdE51bShmLnlfaGF0KSArXHJcbiAgICAgICAgICAnPC90ZD4nICtcclxuICAgICAgICAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjZweCAxMHB4O3RleHQtYWxpZ246cmlnaHQ7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZClcIj4nICtcclxuICAgICAgICAgIF9mbXROdW0oZi5sbzgwKSArXHJcbiAgICAgICAgICAnPC90ZD4nICtcclxuICAgICAgICAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjZweCAxMHB4O3RleHQtYWxpZ246cmlnaHQ7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZClcIj4nICtcclxuICAgICAgICAgIF9mbXROdW0oZi5oaTgwKSArXHJcbiAgICAgICAgICAnPC90ZD48L3RyPidcclxuICAgICAgKVxyXG4gICAgICAuam9pbignJykgK1xyXG4gICAgJzwvdGJvZHk+PC90YWJsZT4nO1xyXG5cclxuICBjb25zdCBjb250ZW50ID1cclxuICAgICc8ZGl2IHN0eWxlPVwiYmFja2dyb3VuZDp2YXIoLS1iZy1lbGV2YXRlZCk7Ym9yZGVyLXJhZGl1czoxMnB4O3BhZGRpbmc6MjRweDttYXgtd2lkdGg6ODIwcHg7d2lkdGg6MTAwJTttYXgtaGVpZ2h0Ojk2dmg7b3ZlcmZsb3c6YXV0bztib3gtc2hhZG93OjAgMjBweCA2MHB4IHJnYmEoMCwwLDAsLjQpXCI+JyArXHJcbiAgICAnPGRpdiBzdHlsZT1cImRpc3BsYXk6ZmxleDtqdXN0aWZ5LWNvbnRlbnQ6c3BhY2UtYmV0d2VlbjthbGlnbi1pdGVtczpjZW50ZXI7bWFyZ2luLWJvdHRvbToxMHB4XCI+JyArXHJcbiAgICAnPGRpdj48ZGl2IHN0eWxlPVwiZm9udC1zaXplOjExcHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO2xldHRlci1zcGFjaW5nOi40cHhcIj5TdWJmYW1pbGlhPC9kaXY+PGRpdiBzdHlsZT1cImZvbnQtc2l6ZToyMnB4O2ZvbnQtd2VpZ2h0OjgwMFwiPicgK1xyXG4gICAgZXNjYXBlSHRtbFNhZmUoZG9jLnN1YmZhbWlsaWEgfHwgZG9jLmlkKSArXHJcbiAgICAnPC9kaXY+PC9kaXY+JyArXHJcbiAgICAnPGJ1dHRvbiBvbmNsaWNrPVwiZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoXFwnZm9yZWNhc3Qtc3RhdC1kZXRhaWxcXCcpLnJlbW92ZSgpXCIgc3R5bGU9XCJiYWNrZ3JvdW5kOnRyYW5zcGFyZW50O2JvcmRlcjoxcHggc29saWQgdmFyKC0tYm9yZGVyLXN1YnRsZSk7Ym9yZGVyLXJhZGl1czo2cHg7cGFkZGluZzo2cHggMTJweDtjdXJzb3I6cG9pbnRlcjtmb250LXdlaWdodDo3MDBcIj5DZXJyYXI8L2J1dHRvbj4nICtcclxuICAgICc8L2Rpdj4nICtcclxuICAgIG1ldHJpY3NIdG1sICtcclxuICAgICc8ZGl2IHN0eWxlPVwiYmFja2dyb3VuZDojZmZmO3BhZGRpbmc6OHB4O2JvcmRlci1yYWRpdXM6OHB4O21hcmdpbi10b3A6MTBweDtib3JkZXI6MXB4IHNvbGlkIHZhcigtLWJvcmRlci1zdWJ0bGUpXCI+JyArXHJcbiAgICBzdmdIdG1sICtcclxuICAgICc8L2Rpdj4nICtcclxuICAgIHRhYmxlSHRtbCArXHJcbiAgICAnPGRpdiBzdHlsZT1cIm1hcmdpbi10b3A6MTRweDtmb250LXNpemU6MTFweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKVwiPlZlcnNpb246IDxjb2RlPicgK1xyXG4gICAgZXNjYXBlSHRtbFNhZmUodmVyc2lvbklkKSArXHJcbiAgICAnPC9jb2RlPiBcdTAwQjcgQXBwcm9hY2g6ICcgK1xyXG4gICAgZXNjYXBlSHRtbFNhZmUoKGRvYy5jb25maWcgfHwge30pLmFwcHJvYWNoIHx8ICdcdTIwMTQnKSArXHJcbiAgICAnPC9kaXY+JyArXHJcbiAgICAnPC9kaXY+JztcclxuICBlbC5pbm5lckhUTUwgPSBjb250ZW50O1xyXG4gIGRvY3VtZW50LmJvZHkuYXBwZW5kQ2hpbGQoZWwpO1xyXG59O1xyXG5cclxud2luZG93Lm9wZW5Gb3JlY2FzdE1vZGFsID0gYXN5bmMgZnVuY3Rpb24gKCkge1xyXG4gIGlmICghX2NhbkZvcmVjYXN0KCkpIHtcclxuICAgIGFsZXJ0KCdGT1JFQ0FTVCBlcyBzb2xvIHBhcmEgTWFyaWFubyAoYWRtaW4pLicpO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuICBjb25zdCBlbCA9IF9yZW5kZXJNb2RhbFNoZWxsKCk7XHJcbiAgZWwuc3R5bGUuZGlzcGxheSA9ICdibG9jayc7XHJcbiAgLy8gRmFzZSAxOiBjYXJnYXIgU2FsZXMgUGxhbnMgY2FjaGVzICsgcmVuZGVyaXphciB0YWIgZGVmYXVsdC5cclxuICBfcmVuZGVyU2FsZXNQbGFuc1RhYigpO1xyXG4gIF9sb2FkU2FsZXNQbGFuQ2FjaGVzKClcclxuICAgIC50aGVuKF9yZW5kZXJTYWxlc1BsYW5zVGFiKVxyXG4gICAgLmNhdGNoKCgpID0+IHt9KTtcclxufTtcclxuXHJcbndpbmRvdy5jbG9zZUZvcmVjYXN0TW9kYWwgPSBmdW5jdGlvbiAoKSB7XHJcbiAgY29uc3QgZWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZm9yZWNhc3QtbW9kYWwnKTtcclxuICBpZiAoZWwpIGVsLnN0eWxlLmRpc3BsYXkgPSAnbm9uZSc7XHJcbn07XHJcblxyXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuLy8gRjNBIFx1MjAxNCBUYWJsYSBSZWNvbWVuZGFjaVx1MDBGM24gZGUgQ29tcHJhICh0YWIgU2FsZXMgUGxhbnMpXHJcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cclxuYXN5bmMgZnVuY3Rpb24gX2xvYWRNdWx0aXBsaWVyT3ZlcnJpZGVzKCkge1xyXG4gIGlmICghd2luZG93LmZiRGIpIHJldHVybjtcclxuICB0cnkge1xyXG4gICAgY29uc3QgZG9jID0gYXdhaXQgd2luZG93LmZiRGIuY29sbGVjdGlvbignZm9yZWNhc3RfY29uZmlnJykuZG9jKCdtdWx0aXBsaWVycycpLmdldCgpO1xyXG4gICAgaWYgKGRvYy5leGlzdHMpIHtcclxuICAgICAgY29uc3QgZCA9IGRvYy5kYXRhKCkgfHwge307XHJcbiAgICAgIF9tdWx0aXBsaWVyT3ZlcnJpZGVzID0gZC5za3VPdmVycmlkZXMgfHwge307XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICBfbXVsdGlwbGllck92ZXJyaWRlcyA9IHt9O1xyXG4gICAgfVxyXG4gIH0gY2F0Y2ggKGUpIHtcclxuICAgIGNvbnNvbGUud2FybignW0ZPUkVDQVNUIHJlY29dIGxvYWQgbXVsdGlwbGllcnMgZmFpbDonLCBlICYmIGUubWVzc2FnZSk7XHJcbiAgICBfbXVsdGlwbGllck92ZXJyaWRlcyA9IHt9O1xyXG4gIH1cclxufVxyXG5cclxuYXN5bmMgZnVuY3Rpb24gX3NhdmVNdWx0aXBsaWVyT3ZlcnJpZGUoc2t1VXBwZXIsIHZhbHVlKSB7XHJcbiAgaWYgKCF3aW5kb3cuZmJEYikgcmV0dXJuO1xyXG4gIGlmICghX211bHRpcGxpZXJPdmVycmlkZXMpIF9tdWx0aXBsaWVyT3ZlcnJpZGVzID0ge307XHJcbiAgY29uc3QgdWlkID0gKHdpbmRvdy5jdXJyZW50VXNlciAmJiB3aW5kb3cuY3VycmVudFVzZXIuZW1haWwpIHx8ICd1bmtub3duJztcclxuICBfbXVsdGlwbGllck92ZXJyaWRlc1tza3VVcHBlcl0gPSB7XHJcbiAgICB2YWx1ZTogTnVtYmVyKHZhbHVlKSxcclxuICAgIHVwZGF0ZWRBdDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxyXG4gICAgdXBkYXRlZEJ5OiB1aWQsXHJcbiAgfTtcclxuICBhd2FpdCB3aW5kb3cuZmJEYi5jb2xsZWN0aW9uKCdmb3JlY2FzdF9jb25maWcnKS5kb2MoJ211bHRpcGxpZXJzJykuc2V0KHtcclxuICAgIHNrdU92ZXJyaWRlczogX211bHRpcGxpZXJPdmVycmlkZXMsXHJcbiAgICB1cGRhdGVkQXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcclxuICAgIHVwZGF0ZWRCeTogdWlkLFxyXG4gIH0pO1xyXG59XHJcblxyXG5hc3luYyBmdW5jdGlvbiBfcmVtb3ZlTXVsdGlwbGllck92ZXJyaWRlKHNrdVVwcGVyKSB7XHJcbiAgaWYgKCF3aW5kb3cuZmJEYiB8fCAhX211bHRpcGxpZXJPdmVycmlkZXMpIHJldHVybjtcclxuICBkZWxldGUgX211bHRpcGxpZXJPdmVycmlkZXNbc2t1VXBwZXJdO1xyXG4gIGNvbnN0IHVpZCA9ICh3aW5kb3cuY3VycmVudFVzZXIgJiYgd2luZG93LmN1cnJlbnRVc2VyLmVtYWlsKSB8fCAndW5rbm93bic7XHJcbiAgYXdhaXQgd2luZG93LmZiRGIuY29sbGVjdGlvbignZm9yZWNhc3RfY29uZmlnJykuZG9jKCdtdWx0aXBsaWVycycpLnNldCh7XHJcbiAgICBza3VPdmVycmlkZXM6IF9tdWx0aXBsaWVyT3ZlcnJpZGVzLFxyXG4gICAgdXBkYXRlZEF0OiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXHJcbiAgICB1cGRhdGVkQnk6IHVpZCxcclxuICB9KTtcclxufVxyXG5cclxuLy8gQXV0byBtdWx0aXBsaWVyOiByZWNlbnQvYmFzZWxpbmUgY29uIGNhcC4gUmV0b3JuYSB7dmFsdWUsIHNvdXJjZTogJ2F1dG8nfCdmYWxsYmFjayd8J2RlZmF1bHQnLCByZWNlbnQsIGJhc2VsaW5lfS5cclxuZnVuY3Rpb24gX2NvbXB1dGVNdWx0aXBsaWVyQXV0byhza3VVcHBlcikge1xyXG4gIGNvbnN0IHJlYyA9IF9yZWNvVmVudGFzU25hcHNob3QgJiYgX3JlY29WZW50YXNTbmFwc2hvdFtza3VVcHBlcl07XHJcbiAgaWYgKCFyZWMgfHwgIXJlYy5tZXNlcykgcmV0dXJuIHsgdmFsdWU6IDEuMCwgc291cmNlOiAnZGVmYXVsdCcsIHJlY2VudDogMCwgYmFzZWxpbmU6IDAgfTtcclxuICBjb25zdCBob3kgPSBuZXcgRGF0ZSgpO1xyXG4gIGNvbnN0IG1vbnRoc0JhY2tLZXkgPSAobikgPT4ge1xyXG4gICAgY29uc3QgZCA9IG5ldyBEYXRlKGhveS5nZXRGdWxsWWVhcigpLCBob3kuZ2V0TW9udGgoKSAtIG4sIDEpO1xyXG4gICAgcmV0dXJuIFN0cmluZyhkLmdldEZ1bGxZZWFyKCkpICsgJy0nICsgU3RyaW5nKGQuZ2V0TW9udGgoKSArIDEpLnBhZFN0YXJ0KDIsICcwJyk7XHJcbiAgfTtcclxuICBjb25zdCBjb2xsZWN0QXZnID0gKG4pID0+IHtcclxuICAgIGxldCBzdW0gPSAwO1xyXG4gICAgbGV0IGNvdW50ID0gMDtcclxuICAgIGZvciAobGV0IGkgPSAxOyBpIDw9IG47IGkrKykge1xyXG4gICAgICBjb25zdCBrID0gbW9udGhzQmFja0tleShpKTtcclxuICAgICAgY29uc3QgbSA9IHJlYy5tZXNlc1trXTtcclxuICAgICAgaWYgKG0gJiYgTnVtYmVyLmlzRmluaXRlKE51bWJlcihtLnF0eSkpKSB7XHJcbiAgICAgICAgc3VtICs9IE51bWJlcihtLnF0eSk7XHJcbiAgICAgICAgY291bnQrKztcclxuICAgICAgfVxyXG4gICAgfVxyXG4gICAgcmV0dXJuIGNvdW50ID4gMCA/IHsgYXZnOiBzdW0gLyBjb3VudCwgbjogY291bnQgfSA6IHsgYXZnOiAwLCBuOiAwIH07XHJcbiAgfTtcclxuICBjb25zdCByZWMyID0gY29sbGVjdEF2ZyhSRUNPX01VTFRfUkVDRU5UX01PTlRIUyk7XHJcbiAgY29uc3QgYmFzNiA9IGNvbGxlY3RBdmcoUkVDT19NVUxUX0JBU0VMSU5FX01PTlRIUyk7XHJcbiAgLy8gTmVjZXNpdGFtb3MgYWwgbWVub3MgMSBtZXMgcmVjaWVudGUgKyAzIG1lc2VzIGJhc2VsaW5lIHBhcmEgY2FsY3VsYXIgYXV0by5cclxuICBpZiAocmVjMi5uID09PSAwIHx8IGJhczYubiA8IDMgfHwgYmFzNi5hdmcgPCBSRUNPX01VTFRfTUlOX0JBU0VMSU5FKSB7XHJcbiAgICByZXR1cm4geyB2YWx1ZTogMS4wLCBzb3VyY2U6ICdkZWZhdWx0JywgcmVjZW50OiByZWMyLmF2ZywgYmFzZWxpbmU6IGJhczYuYXZnIH07XHJcbiAgfVxyXG4gIGxldCByYXRpbyA9IHJlYzIuYXZnIC8gYmFzNi5hdmc7XHJcbiAgaWYgKHJhdGlvIDwgUkVDT19NVUxUX01JTikgcmF0aW8gPSBSRUNPX01VTFRfTUlOO1xyXG4gIGlmIChyYXRpbyA+IFJFQ09fTVVMVF9NQVgpIHJhdGlvID0gUkVDT19NVUxUX01BWDtcclxuICByZXR1cm4ge1xyXG4gICAgdmFsdWU6IE1hdGgucm91bmQocmF0aW8gKiAxMDApIC8gMTAwLFxyXG4gICAgc291cmNlOiAnYXV0bycsXHJcbiAgICByZWNlbnQ6IE1hdGgucm91bmQocmVjMi5hdmcgKiAxMCkgLyAxMCxcclxuICAgIGJhc2VsaW5lOiBNYXRoLnJvdW5kKGJhczYuYXZnICogMTApIC8gMTAsXHJcbiAgfTtcclxufVxyXG5cclxuZnVuY3Rpb24gX2dldEVmZmVjdGl2ZU11bHRpcGxpZXIoc2t1VXBwZXIpIHtcclxuICAvLyBPdmVycmlkZSBtYW51YWwgZ2FuYVxyXG4gIGlmIChfbXVsdGlwbGllck92ZXJyaWRlcyAmJiBfbXVsdGlwbGllck92ZXJyaWRlc1tza3VVcHBlcl0pIHtcclxuICAgIHJldHVybiB7XHJcbiAgICAgIHZhbHVlOiBOdW1iZXIoX211bHRpcGxpZXJPdmVycmlkZXNbc2t1VXBwZXJdLnZhbHVlKSB8fCAxLjAsXHJcbiAgICAgIHNvdXJjZTogJ21hbnVhbCcsXHJcbiAgICAgIGF1dG86IF9jb21wdXRlTXVsdGlwbGllckF1dG8oc2t1VXBwZXIpLFxyXG4gICAgfTtcclxuICB9XHJcbiAgY29uc3QgYXV0byA9IF9jb21wdXRlTXVsdGlwbGllckF1dG8oc2t1VXBwZXIpO1xyXG4gIHJldHVybiB7IHZhbHVlOiBhdXRvLnZhbHVlLCBzb3VyY2U6IGF1dG8uc291cmNlLCBhdXRvIH07XHJcbn1cclxuXHJcbmFzeW5jIGZ1bmN0aW9uIF9sb2FkRGlzY29udGludWVkU2t1cygpIHtcclxuICBpZiAoIXdpbmRvdy5mYkRiKSByZXR1cm47XHJcbiAgdHJ5IHtcclxuICAgIGNvbnN0IGRvYyA9IGF3YWl0IHdpbmRvdy5mYkRiLmNvbGxlY3Rpb24oJ2ZvcmVjYXN0X2NvbmZpZycpLmRvYygnZGlzY29udGludWVkX3NrdXMnKS5nZXQoKTtcclxuICAgIGlmIChkb2MuZXhpc3RzKSB7XHJcbiAgICAgIGNvbnN0IGQgPSBkb2MuZGF0YSgpIHx8IHt9O1xyXG4gICAgICBjb25zdCBhcnIgPSBBcnJheS5pc0FycmF5KGQuc2t1cykgPyBkLnNrdXMgOiBbXTtcclxuICAgICAgX2Rpc2NvbnRpbnVlZFNrdXMgPSBuZXcgU2V0KGFyci5tYXAoKHMpID0+IFN0cmluZyhzKS50cmltKCkudG9VcHBlckNhc2UoKSkpO1xyXG4gICAgICBfZGlzY29udGludWVkTWV0YSA9IHsgdXBkYXRlZEF0OiBkLnVwZGF0ZWRBdCwgdXBkYXRlZEJ5OiBkLnVwZGF0ZWRCeSB9O1xyXG4gICAgfSBlbHNlIHtcclxuICAgICAgX2Rpc2NvbnRpbnVlZFNrdXMgPSBuZXcgU2V0KCk7XHJcbiAgICAgIF9kaXNjb250aW51ZWRNZXRhID0gbnVsbDtcclxuICAgIH1cclxuICB9IGNhdGNoIChlKSB7XHJcbiAgICBjb25zb2xlLndhcm4oJ1tGT1JFQ0FTVCByZWNvXSBsb2FkIGRpc2NvbnRpbnVlZCBmYWlsOicsIGUgJiYgZS5tZXNzYWdlKTtcclxuICAgIF9kaXNjb250aW51ZWRTa3VzID0gbmV3IFNldCgpO1xyXG4gIH1cclxufVxyXG5cclxuYXN5bmMgZnVuY3Rpb24gX3NhdmVEaXNjb250aW51ZWRTa3VzKCkge1xyXG4gIGlmICghd2luZG93LmZiRGIgfHwgIV9kaXNjb250aW51ZWRTa3VzKSByZXR1cm47XHJcbiAgY29uc3QgdWlkID0gKHdpbmRvdy5jdXJyZW50VXNlciAmJiB3aW5kb3cuY3VycmVudFVzZXIuZW1haWwpIHx8ICd1bmtub3duJztcclxuICBjb25zdCBwYXlsb2FkID0ge1xyXG4gICAgc2t1czogQXJyYXkuZnJvbShfZGlzY29udGludWVkU2t1cykuc29ydCgpLFxyXG4gICAgdXBkYXRlZEF0OiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXHJcbiAgICB1cGRhdGVkQnk6IHVpZCxcclxuICB9O1xyXG4gIGF3YWl0IHdpbmRvdy5mYkRiLmNvbGxlY3Rpb24oJ2ZvcmVjYXN0X2NvbmZpZycpLmRvYygnZGlzY29udGludWVkX3NrdXMnKS5zZXQocGF5bG9hZCk7XHJcbiAgX2Rpc2NvbnRpbnVlZE1ldGEgPSB7IHVwZGF0ZWRBdDogcGF5bG9hZC51cGRhdGVkQXQsIHVwZGF0ZWRCeTogcGF5bG9hZC51cGRhdGVkQnkgfTtcclxufVxyXG5cclxuYXN5bmMgZnVuY3Rpb24gX2xvYWRSZWNvRGF0YSgpIHtcclxuICBpZiAoIXdpbmRvdy5mYkRiKSB0aHJvdyBuZXcgRXJyb3IoJ0ZpcmVzdG9yZSBubyBpbmljaWFsaXphZG8nKTtcclxuICBjb25zdCBwcm9taXNlcyA9IFtdO1xyXG4gIGlmICghX2Rpc2NvbnRpbnVlZFNrdXMpIHByb21pc2VzLnB1c2goX2xvYWREaXNjb250aW51ZWRTa3VzKCkpO1xyXG4gIGlmICghX211bHRpcGxpZXJPdmVycmlkZXMpIHByb21pc2VzLnB1c2goX2xvYWRNdWx0aXBsaWVyT3ZlcnJpZGVzKCkpO1xyXG4gIGlmICghX3JlY29TdG9ja1NuYXBzaG90KSB7XHJcbiAgICBwcm9taXNlcy5wdXNoKFxyXG4gICAgICB3aW5kb3cuZmJEYlxyXG4gICAgICAgIC5jb2xsZWN0aW9uKCdhcHBfY29uZmlnJylcclxuICAgICAgICAuZG9jKCdzdG9ja19zbmFwc2hvdCcpXHJcbiAgICAgICAgLmdldCgpXHJcbiAgICAgICAgLnRoZW4oKGQpID0+IHtcclxuICAgICAgICAgIGNvbnN0IGRhdGEgPSBkLmV4aXN0cyA/IGQuZGF0YSgpIDoge307XHJcbiAgICAgICAgICBsZXQgd2ggPSB7fTtcclxuICAgICAgICAgIGxldCBibyA9IHt9O1xyXG4gICAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgd2ggPSBkYXRhLndhcmVob3VzZUJyZWFrZG93biA/IEpTT04ucGFyc2UoZGF0YS53YXJlaG91c2VCcmVha2Rvd24pIDoge307XHJcbiAgICAgICAgICB9IGNhdGNoIHtcclxuICAgICAgICAgICAgd2ggPSB7fTtcclxuICAgICAgICAgIH1cclxuICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIGJvID0gZGF0YS5iYWNrb3JkZXJCeVNrdSA/IEpTT04ucGFyc2UoZGF0YS5iYWNrb3JkZXJCeVNrdSkgOiB7fTtcclxuICAgICAgICAgIH0gY2F0Y2gge1xyXG4gICAgICAgICAgICBibyA9IHt9O1xyXG4gICAgICAgICAgfVxyXG4gICAgICAgICAgX3JlY29TdG9ja1NuYXBzaG90ID0geyB3YXJlaG91c2VCcmVha2Rvd246IHdoLCBiYWNrb3JkZXJCeVNrdTogYm8gfTtcclxuICAgICAgICB9KVxyXG4gICAgKTtcclxuICB9XHJcbiAgaWYgKCFfcmVjb1ZlbnRhc1NuYXBzaG90KSB7XHJcbiAgICBwcm9taXNlcy5wdXNoKFxyXG4gICAgICB3aW5kb3cuZmJEYlxyXG4gICAgICAgIC5jb2xsZWN0aW9uKCdza3VfdmVudGFzX3NuYXBzaG90JylcclxuICAgICAgICAuZ2V0KClcclxuICAgICAgICAudGhlbigoc25hcCkgPT4ge1xyXG4gICAgICAgICAgY29uc3QgbWFwID0ge307XHJcbiAgICAgICAgICBzbmFwLmZvckVhY2goKGRvYykgPT4ge1xyXG4gICAgICAgICAgICBjb25zdCBkID0gZG9jLmRhdGEoKTtcclxuICAgICAgICAgICAgaWYgKCFkIHx8ICFkLnNrdSkgcmV0dXJuO1xyXG4gICAgICAgICAgICBtYXBbU3RyaW5nKGQuc2t1KS50cmltKCkudG9VcHBlckNhc2UoKV0gPSB7IG1lc2VzOiBkLm1lc2VzIHx8IHt9IH07XHJcbiAgICAgICAgICB9KTtcclxuICAgICAgICAgIF9yZWNvVmVudGFzU25hcHNob3QgPSBtYXA7XHJcbiAgICAgICAgfSlcclxuICAgICk7XHJcbiAgfVxyXG4gIGF3YWl0IFByb21pc2UuYWxsKHByb21pc2VzKTtcclxufVxyXG5cclxuZnVuY3Rpb24gX2NvbXB1dGVWZW50YU1lbnN1YWxQcm9tZWRpbyhza3VVcHBlcikge1xyXG4gIC8vIFByb21lZGlvIGRlIGxvcyBcdTAwRkFsdGltb3MgUkVDT19WRU5UQV9QUk9NRURJT19XSU5ET1cgbWVzZXMgY2VycmFkb3NcclxuICAvLyAoZXhjbHV5ZSBlbCBtZXMgYWN0dWFsIHBhcmNpYWwpLlxyXG4gIGNvbnN0IHJlYyA9IF9yZWNvVmVudGFzU25hcHNob3QgJiYgX3JlY29WZW50YXNTbmFwc2hvdFtza3VVcHBlcl07XHJcbiAgaWYgKCFyZWMgfHwgIXJlYy5tZXNlcykgcmV0dXJuIDA7XHJcbiAgY29uc3QgaG95ID0gbmV3IERhdGUoKTtcclxuICBjb25zdCBtb250aHNCYWNrID0gW107XHJcbiAgZm9yIChsZXQgaSA9IDE7IGkgPD0gUkVDT19WRU5UQV9QUk9NRURJT19XSU5ET1c7IGkrKykge1xyXG4gICAgY29uc3QgZCA9IG5ldyBEYXRlKGhveS5nZXRGdWxsWWVhcigpLCBob3kuZ2V0TW9udGgoKSAtIGksIDEpO1xyXG4gICAgbW9udGhzQmFjay5wdXNoKFN0cmluZyhkLmdldEZ1bGxZZWFyKCkpICsgJy0nICsgU3RyaW5nKGQuZ2V0TW9udGgoKSArIDEpLnBhZFN0YXJ0KDIsICcwJykpO1xyXG4gIH1cclxuICBsZXQgc3VtID0gMDtcclxuICBsZXQgbiA9IDA7XHJcbiAgbW9udGhzQmFjay5mb3JFYWNoKChrKSA9PiB7XHJcbiAgICBjb25zdCBtID0gcmVjLm1lc2VzW2tdO1xyXG4gICAgaWYgKG0gJiYgTnVtYmVyLmlzRmluaXRlKE51bWJlcihtLnF0eSkpKSB7XHJcbiAgICAgIHN1bSArPSBOdW1iZXIobS5xdHkpO1xyXG4gICAgICBuKys7XHJcbiAgICB9XHJcbiAgfSk7XHJcbiAgcmV0dXJuIG4gPiAwID8gc3VtIC8gbiA6IDA7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIF9jb21wdXRlU2FsZXNQbGFuRnV0dXJvKHJvdykge1xyXG4gIC8vIFN1bWEgbG9zIG1lc2VzIGRlIHJvdy5tb250aHMgZGVzZGUgZWwgbWVzIGFjdHVhbCAoaW5jbHVzaXZlKSBoYXN0YSBlbFxyXG4gIC8vIFx1MDBGQWx0aW1vIG1lcyBkZWwgc2FsZXMgcGxhbi4gTG9zIG1lc2VzIHNvbiAnWVlZWS1NTScuXHJcbiAgaWYgKCFyb3cgfHwgIXJvdy5tb250aHMpIHJldHVybiAwO1xyXG4gIGNvbnN0IGhveSA9IG5ldyBEYXRlKCk7XHJcbiAgY29uc3QgY3VycmVudEtleSA9IFN0cmluZyhob3kuZ2V0RnVsbFllYXIoKSkgKyAnLScgKyBTdHJpbmcoaG95LmdldE1vbnRoKCkgKyAxKS5wYWRTdGFydCgyLCAnMCcpO1xyXG4gIGxldCBzdW0gPSAwO1xyXG4gIE9iamVjdC5rZXlzKHJvdy5tb250aHMpLmZvckVhY2goKGspID0+IHtcclxuICAgIGlmIChrID49IGN1cnJlbnRLZXkpIHN1bSArPSBOdW1iZXIocm93Lm1vbnRoc1trXSB8fCAwKTtcclxuICB9KTtcclxuICByZXR1cm4gc3VtO1xyXG59XHJcblxyXG5mdW5jdGlvbiBfY29tcHV0ZVJlY29tbWVuZGF0aW9ucygpIHtcclxuICAvLyBDb21iaW5hIFJvZHMgKyBSZWVscyBzYWxlcyBwbGFucyArIHN0b2NrICsgYmFja29yZGVyICsgdmVudGFzIHByb21lZGlvLlxyXG4gIC8vIFJldG9ybmEgYXJyYXkgZGUgcm93cyBjb24gdG9kb3MgbG9zIGNhbXBvcyArIHJlY29tZW5kYWRvLlxyXG4gIGNvbnN0IHJvd3MgPSBbXTtcclxuICBjb25zdCBmYW1pbGlhcyA9IFsncm9kcycsICdyZWVscyddO1xyXG4gIGZvciAoY29uc3QgZmFtIG9mIGZhbWlsaWFzKSB7XHJcbiAgICBjb25zdCBjYWNoZSA9IF9zYWxlc1BsYW5DYWNoZXNbZmFtXTtcclxuICAgIGlmICghY2FjaGUgfHwgIWNhY2hlLnJvd3MpIGNvbnRpbnVlO1xyXG4gICAgZm9yIChjb25zdCBzcFJvdyBvZiBjYWNoZS5yb3dzKSB7XHJcbiAgICAgIGNvbnN0IHNrdSA9IFN0cmluZyhzcFJvdy5za3UgfHwgJycpLnRyaW0oKTtcclxuICAgICAgY29uc3Qgc2t1VXBwZXIgPSBza3UudG9VcHBlckNhc2UoKTtcclxuICAgICAgLy8gdjExMTI6IHNraXBlYW1vcyBTS1VzIGRlc2NvbnRpbnVhZG9zIChNYXJpYW5vIGxvcyBtYXJjYSBkZXNkZSBsYSBVSSkuXHJcbiAgICAgIGlmIChfZGlzY29udGludWVkU2t1cyAmJiBfZGlzY29udGludWVkU2t1cy5oYXMoc2t1VXBwZXIpKSBjb250aW51ZTtcclxuICAgICAgY29uc3Qgc3RvY2tXaCA9XHJcbiAgICAgICAgKF9yZWNvU3RvY2tTbmFwc2hvdCAmJlxyXG4gICAgICAgICAgX3JlY29TdG9ja1NuYXBzaG90LndhcmVob3VzZUJyZWFrZG93biAmJlxyXG4gICAgICAgICAgX3JlY29TdG9ja1NuYXBzaG90LndhcmVob3VzZUJyZWFrZG93bltza3VdKSB8fFxyXG4gICAgICAgIHt9O1xyXG4gICAgICBjb25zdCBzdG9ja0xpYnJlID0gTnVtYmVyKHN0b2NrV2hbJzExJ10gfHwgMCk7XHJcbiAgICAgIGNvbnN0IGVuVHJhbnNpdG8gPSBOdW1iZXIoc3RvY2tXaFsnMTInXSB8fCAwKTtcclxuICAgICAgY29uc3QgYmFja29yZGVyID0gTnVtYmVyKFxyXG4gICAgICAgIChfcmVjb1N0b2NrU25hcHNob3QgJiZcclxuICAgICAgICAgIF9yZWNvU3RvY2tTbmFwc2hvdC5iYWNrb3JkZXJCeVNrdSAmJlxyXG4gICAgICAgICAgX3JlY29TdG9ja1NuYXBzaG90LmJhY2tvcmRlckJ5U2t1W3NrdV0pIHx8XHJcbiAgICAgICAgICAwXHJcbiAgICAgICk7XHJcbiAgICAgIGNvbnN0IHZlbnRhTWVuc3VhbCA9IF9jb21wdXRlVmVudGFNZW5zdWFsUHJvbWVkaW8oc2t1VXBwZXIpO1xyXG4gICAgICBjb25zdCBzYWxlc1BsYW5GdXQgPSBfY29tcHV0ZVNhbGVzUGxhbkZ1dHVybyhzcFJvdyk7XHJcbiAgICAgIGNvbnN0IG1vcSA9IE51bWJlcihzcFJvdy5tb3EgfHwgMCk7XHJcbiAgICAgIC8vIHYxMTE0IEYzQjogbXVsdGlwbGljYWRvciBhdXRvIChyZWNlbnQvYmFzZWxpbmUpIG8gb3ZlcnJpZGUgbWFudWFsLlxyXG4gICAgICBjb25zdCBtdWx0SW5mbyA9IF9nZXRFZmZlY3RpdmVNdWx0aXBsaWVyKHNrdVVwcGVyKTtcclxuICAgICAgY29uc3QgbXVsdGlwbGllciA9IG11bHRJbmZvLnZhbHVlO1xyXG4gICAgICBjb25zdCBkZW1hbmRhRXNwZXJhZGEgPSB2ZW50YU1lbnN1YWwgKiBtdWx0aXBsaWVyICogUkVDT19IT1JJWk9OX01PTlRIUztcclxuICAgICAgY29uc3QgYmFsYW5jZSA9IHN0b2NrTGlicmUgKyBlblRyYW5zaXRvICsgc2FsZXNQbGFuRnV0IC0gYmFja29yZGVyIC0gZGVtYW5kYUVzcGVyYWRhO1xyXG4gICAgICBsZXQgcmVjb21lbmRhZG8gPSAwO1xyXG4gICAgICBpZiAoYmFsYW5jZSA8IDApIHtcclxuICAgICAgICBjb25zdCBkZWZpY2l0ID0gLWJhbGFuY2U7XHJcbiAgICAgICAgcmVjb21lbmRhZG8gPSBtb3EgPiAwID8gTWF0aC5tYXgobW9xLCBNYXRoLmNlaWwoZGVmaWNpdCAvIG1vcSkgKiBtb3EpIDogTWF0aC5jZWlsKGRlZmljaXQpO1xyXG4gICAgICB9XHJcbiAgICAgIHJvd3MucHVzaCh7XHJcbiAgICAgICAgZmFtaWxpYTogZmFtLFxyXG4gICAgICAgIHNrdSxcclxuICAgICAgICBkZXNjcmlwdGlvbjogc3BSb3cuZGVzY3JpcHRpb24gfHwgJycsXHJcbiAgICAgICAgbW9xLFxyXG4gICAgICAgIHN0b2NrTGlicmUsXHJcbiAgICAgICAgZW5UcmFuc2l0byxcclxuICAgICAgICBiYWNrb3JkZXIsXHJcbiAgICAgICAgdmVudGFNZW5zdWFsOiBNYXRoLnJvdW5kKHZlbnRhTWVuc3VhbCAqIDEwKSAvIDEwLFxyXG4gICAgICAgIHNhbGVzUGxhbkZ1dCxcclxuICAgICAgICBtdWx0aXBsaWVyLFxyXG4gICAgICAgIG11bHRTb3VyY2U6IG11bHRJbmZvLnNvdXJjZSwgLy8gJ2F1dG8nIHwgJ21hbnVhbCcgfCAnZGVmYXVsdCcgfCAnZmFsbGJhY2snXHJcbiAgICAgICAgbXVsdEF1dG86IG11bHRJbmZvLmF1dG8gPyBtdWx0SW5mby5hdXRvLnZhbHVlIDogbnVsbCwgLy8gZWwgdmFsb3IgYXV0byBzaSBoYXkgb3ZlcnJpZGUgbWFudWFsXHJcbiAgICAgICAgZGVtYW5kYUVzcGVyYWRhOiBNYXRoLnJvdW5kKGRlbWFuZGFFc3BlcmFkYSAqIDEwKSAvIDEwLFxyXG4gICAgICAgIGJhbGFuY2U6IE1hdGgucm91bmQoYmFsYW5jZSAqIDEwKSAvIDEwLFxyXG4gICAgICAgIHJlY29tZW5kYWRvLFxyXG4gICAgICB9KTtcclxuICAgIH1cclxuICB9XHJcbiAgLy8gT3JkZW5hciBwb3IgcmVjb21lbmRhZG8gZGVzY2VuZGVudGVcclxuICByb3dzLnNvcnQoKGEsIGIpID0+IGIucmVjb21lbmRhZG8gLSBhLnJlY29tZW5kYWRvKTtcclxuICByZXR1cm4gcm93cztcclxufVxyXG5cclxuZnVuY3Rpb24gX2ZtdE51bVNpZ25lZChuKSB7XHJcbiAgaWYgKG4gPT0gbnVsbCB8fCAhTnVtYmVyLmlzRmluaXRlKE51bWJlcihuKSkpIHJldHVybiAnXHUyMDE0JztcclxuICBjb25zdCB2ID0gTnVtYmVyKG4pO1xyXG4gIGNvbnN0IGFicyA9IE1hdGguYWJzKHYpLnRvTG9jYWxlU3RyaW5nKCdlcy1BUicsIHsgbWF4aW11bUZyYWN0aW9uRGlnaXRzOiAwIH0pO1xyXG4gIHJldHVybiAodiA8IDAgPyAnXHUyMjEyJyA6ICcnKSArIGFicztcclxufVxyXG5cclxuZnVuY3Rpb24gX2ZtdEludChuKSB7XHJcbiAgaWYgKG4gPT0gbnVsbCB8fCAhTnVtYmVyLmlzRmluaXRlKE51bWJlcihuKSkpIHJldHVybiAnXHUyMDE0JztcclxuICByZXR1cm4gTWF0aC5yb3VuZChOdW1iZXIobikpLnRvTG9jYWxlU3RyaW5nKCdlcy1BUicpO1xyXG59XHJcblxyXG4vLyB2MTExNCBGM0I6IGNlbGRhIG11bHRpcGxpY2Fkb3IgY29uIGNoaXAgYXV0by9tYW51YWwgKyBpbnB1dCBlZGl0YWJsZS5cclxuZnVuY3Rpb24gX2J1aWxkTXVsdENlbGxIdG1sKHIpIHtcclxuICBjb25zdCBza3VVcHBlciA9IFN0cmluZyhyLnNrdSkudHJpbSgpLnRvVXBwZXJDYXNlKCk7XHJcbiAgY29uc3QgaXNNYW51YWwgPSByLm11bHRTb3VyY2UgPT09ICdtYW51YWwnO1xyXG4gIGNvbnN0IGlzRGVmYXVsdCA9IHIubXVsdFNvdXJjZSA9PT0gJ2RlZmF1bHQnO1xyXG4gIGNvbnN0IHZhbCA9IE51bWJlcihyLm11bHRpcGxpZXIgfHwgMS4wKS50b0ZpeGVkKDIpO1xyXG4gIC8vIENvbG9yIHBvciBkaXJlY2NpXHUwMEYzbjogPjEuMDUgdmVyZGUgKGNyZWNpZW5kbyksIDwwLjk1IHJvam8gKGNheWVuZG8pLCBtZWRpbyBncmlzLlxyXG4gIGxldCBkaXJDb2xvciA9ICd2YXIoLS10ZXh0LW11dGVkKSc7XHJcbiAgaWYgKHIubXVsdGlwbGllciA+IDEuMDUpIGRpckNvbG9yID0gJyMxNmEzNGEnO1xyXG4gIGVsc2UgaWYgKHIubXVsdGlwbGllciA8IDAuOTUpIGRpckNvbG9yID0gJyNkYzI2MjYnO1xyXG5cclxuICBjb25zdCBjaGlwID0gaXNNYW51YWxcclxuICAgID8gJzxzcGFuIHN0eWxlPVwiZGlzcGxheTppbmxpbmUtYmxvY2s7cGFkZGluZzoxcHggNXB4O2JhY2tncm91bmQ6I2Y1OWUwYjtjb2xvcjojZmZmO2JvcmRlci1yYWRpdXM6OHB4O2ZvbnQtc2l6ZTo5cHg7Zm9udC13ZWlnaHQ6NzAwO21hcmdpbi1sZWZ0OjRweFwiIHRpdGxlPVwiT3ZlcnJpZGUgbWFudWFsOiBwaXNhIGVsIGF1dG9cIj5NPC9zcGFuPidcclxuICAgIDogaXNEZWZhdWx0XHJcbiAgICAgID8gJzxzcGFuIHN0eWxlPVwiZGlzcGxheTppbmxpbmUtYmxvY2s7cGFkZGluZzoxcHggNXB4O2JhY2tncm91bmQ6Izk0YTNiODtjb2xvcjojZmZmO2JvcmRlci1yYWRpdXM6OHB4O2ZvbnQtc2l6ZTo5cHg7Zm9udC13ZWlnaHQ6NzAwO21hcmdpbi1sZWZ0OjRweFwiIHRpdGxlPVwiU2luIGRhdG9zIHN1ZmljaWVudGVzOiB1c2EgMS4wXCI+XHUwMEI3PC9zcGFuPidcclxuICAgICAgOiAnPHNwYW4gc3R5bGU9XCJkaXNwbGF5OmlubGluZS1ibG9jaztwYWRkaW5nOjFweCA1cHg7YmFja2dyb3VuZDojMGQ5NDg4O2NvbG9yOiNmZmY7Ym9yZGVyLXJhZGl1czo4cHg7Zm9udC1zaXplOjlweDtmb250LXdlaWdodDo3MDA7bWFyZ2luLWxlZnQ6NHB4XCIgdGl0bGU9XCJBdXRvID0gdmVudGEgMm0gLyB2ZW50YSA2bVwiPkE8L3NwYW4+JztcclxuXHJcbiAgY29uc3QgcmVzZXRCdG4gPSBpc01hbnVhbFxyXG4gICAgPyAnPGJ1dHRvbiBvbmNsaWNrPVwicmVzZXRNdWx0aXBsaWVyKFxcJycgK1xyXG4gICAgICBlc2NhcGVIdG1sU2FmZShza3VVcHBlcikgK1xyXG4gICAgICAnXFwnKVwiIHRpdGxlPVwiVm9sdmVyIGFsIGF1dG9cIiBzdHlsZT1cIm1hcmdpbi1sZWZ0OjRweDtiYWNrZ3JvdW5kOnRyYW5zcGFyZW50O2JvcmRlcjpub25lO2N1cnNvcjpwb2ludGVyO2ZvbnQtc2l6ZToxMnB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO3BhZGRpbmc6MFwiPlx1MjFCQjwvYnV0dG9uPidcclxuICAgIDogJyc7XHJcblxyXG4gIGNvbnN0IGF1dG9IaW50ID1cclxuICAgIGlzTWFudWFsICYmIHIubXVsdEF1dG8gIT0gbnVsbFxyXG4gICAgICA/ICcgPHNwYW4gc3R5bGU9XCJmb250LXNpemU6MTBweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKVwiIHRpdGxlPVwiVmFsb3IgYXV0byBjYWxjdWxhZG9cIj4oYXV0byAnICtcclxuICAgICAgICBOdW1iZXIoci5tdWx0QXV0bykudG9GaXhlZCgyKSArXHJcbiAgICAgICAgJyk8L3NwYW4+J1xyXG4gICAgICA6ICcnO1xyXG5cclxuICByZXR1cm4gKFxyXG4gICAgJzxzcGFuIHN0eWxlPVwiZGlzcGxheTppbmxpbmUtZmxleDthbGlnbi1pdGVtczpjZW50ZXI7Z2FwOjJweFwiPicgK1xyXG4gICAgJzxzcGFuIG9uY2xpY2s9XCJlZGl0TXVsdGlwbGllcih0aGlzLCBcXCcnICtcclxuICAgIGVzY2FwZUh0bWxTYWZlKHNrdVVwcGVyKSArXHJcbiAgICAnXFwnKVwiIHN0eWxlPVwiY3Vyc29yOnBvaW50ZXI7cGFkZGluZzoycHggNnB4O2JvcmRlci1yYWRpdXM6NHB4O2JhY2tncm91bmQ6dmFyKC0tYmctc2Vjb25kYXJ5KTtmb250LXZhcmlhbnQtbnVtZXJpYzp0YWJ1bGFyLW51bXM7Zm9udC13ZWlnaHQ6NzAwO2NvbG9yOicgK1xyXG4gICAgZGlyQ29sb3IgK1xyXG4gICAgJ1wiIHRpdGxlPVwiQ2xpY2sgcGFyYSBlZGl0YXJcIj4nICtcclxuICAgIHZhbCArXHJcbiAgICAnPC9zcGFuPicgK1xyXG4gICAgY2hpcCArXHJcbiAgICByZXNldEJ0biArXHJcbiAgICBhdXRvSGludCArXHJcbiAgICAnPC9zcGFuPidcclxuICApO1xyXG59XHJcblxyXG53aW5kb3cuZWRpdE11bHRpcGxpZXIgPSBmdW5jdGlvbiAoZWwsIHNrdVVwcGVyKSB7XHJcbiAgY29uc3QgY3VycmVudFZhbCA9IHBhcnNlRmxvYXQoZWwudGV4dENvbnRlbnQpIHx8IDEuMDtcclxuICBjb25zdCBpbnB1dCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2lucHV0Jyk7XHJcbiAgaW5wdXQudHlwZSA9ICdudW1iZXInO1xyXG4gIGlucHV0LnN0ZXAgPSAnMC4wNSc7XHJcbiAgaW5wdXQubWluID0gJzAuMSc7XHJcbiAgaW5wdXQubWF4ID0gJzUnO1xyXG4gIGlucHV0LnZhbHVlID0gU3RyaW5nKGN1cnJlbnRWYWwpO1xyXG4gIGlucHV0LnN0eWxlLmNzc1RleHQgPVxyXG4gICAgJ3dpZHRoOjYwcHg7cGFkZGluZzoycHggNHB4O2ZvbnQtc2l6ZToxMnB4O2ZvbnQtd2VpZ2h0OjcwMDt0ZXh0LWFsaWduOmNlbnRlcjtib3JkZXI6MnB4IHNvbGlkICMwZDk0ODg7Ym9yZGVyLXJhZGl1czo0cHg7YmFja2dyb3VuZDp2YXIoLS1iZy1lbGV2YXRlZCk7Y29sb3I6dmFyKC0tdGV4dC1wcmltYXJ5KTtmb250LXZhcmlhbnQtbnVtZXJpYzp0YWJ1bGFyLW51bXMnO1xyXG4gIGNvbnN0IHBhcmVudCA9IGVsLnBhcmVudE5vZGU7XHJcbiAgcGFyZW50LnJlcGxhY2VDaGlsZChpbnB1dCwgZWwpO1xyXG4gIGlucHV0LmZvY3VzKCk7XHJcbiAgaW5wdXQuc2VsZWN0KCk7XHJcblxyXG4gIGNvbnN0IGNvbW1pdCA9IGFzeW5jICgpID0+IHtcclxuICAgIGNvbnN0IHYgPSBwYXJzZUZsb2F0KGlucHV0LnZhbHVlKTtcclxuICAgIGlmIChOdW1iZXIuaXNOYU4odikgfHwgdiA8IDAuMSB8fCB2ID4gNSkge1xyXG4gICAgICBfcmVuZGVyUmVjb1NlY3Rpb24oKTtcclxuICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG4gICAgaWYgKE1hdGguYWJzKHYgLSBjdXJyZW50VmFsKSA8IDAuMDAxKSB7XHJcbiAgICAgIF9yZW5kZXJSZWNvU2VjdGlvbigpO1xyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcbiAgICB0cnkge1xyXG4gICAgICBhd2FpdCBfc2F2ZU11bHRpcGxpZXJPdmVycmlkZShza3VVcHBlciwgdik7XHJcbiAgICAgIF9yZW5kZXJSZWNvU2VjdGlvbigpO1xyXG4gICAgfSBjYXRjaCAoZSkge1xyXG4gICAgICBhbGVydCgnRXJyb3IgZ3VhcmRhbmRvOiAnICsgKGUubWVzc2FnZSB8fCBlKSk7XHJcbiAgICAgIF9yZW5kZXJSZWNvU2VjdGlvbigpO1xyXG4gICAgfVxyXG4gIH07XHJcblxyXG4gIGNvbnN0IGNhbmNlbCA9ICgpID0+IF9yZW5kZXJSZWNvU2VjdGlvbigpO1xyXG5cclxuICBpbnB1dC5hZGRFdmVudExpc3RlbmVyKCdibHVyJywgY29tbWl0KTtcclxuICBpbnB1dC5hZGRFdmVudExpc3RlbmVyKCdrZXlkb3duJywgKGV2KSA9PiB7XHJcbiAgICBpZiAoZXYua2V5ID09PSAnRW50ZXInKSB7XHJcbiAgICAgIGV2LnByZXZlbnREZWZhdWx0KCk7XHJcbiAgICAgIGlucHV0LmJsdXIoKTtcclxuICAgIH0gZWxzZSBpZiAoZXYua2V5ID09PSAnRXNjYXBlJykge1xyXG4gICAgICBldi5wcmV2ZW50RGVmYXVsdCgpO1xyXG4gICAgICBjYW5jZWwoKTtcclxuICAgIH1cclxuICB9KTtcclxufTtcclxuXHJcbndpbmRvdy5yZXNldE11bHRpcGxpZXIgPSBhc3luYyBmdW5jdGlvbiAoc2t1VXBwZXIpIHtcclxuICBpZiAoIWNvbmZpcm0oJ1ZvbHZlciBlbCBtdWx0aXBsaWNhZG9yIGRlICcgKyBza3VVcHBlciArICcgYWwgY1x1MDBFMWxjdWxvIGF1dG9tXHUwMEUxdGljbz8nKSkgcmV0dXJuO1xyXG4gIHRyeSB7XHJcbiAgICBhd2FpdCBfcmVtb3ZlTXVsdGlwbGllck92ZXJyaWRlKHNrdVVwcGVyKTtcclxuICAgIF9yZW5kZXJSZWNvU2VjdGlvbigpO1xyXG4gIH0gY2F0Y2ggKGUpIHtcclxuICAgIGFsZXJ0KCdFcnJvcjogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xyXG4gIH1cclxufTtcclxuXHJcbmZ1bmN0aW9uIF9yZW5kZXJSZWNvU2VjdGlvbigpIHtcclxuICBjb25zdCBjb250ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3JlY28tc2VjdGlvbi1jb250YWluZXInKTtcclxuICBpZiAoIWNvbnQpIHJldHVybjtcclxuICB0cnkge1xyXG4gICAgX3JlbmRlclJlY29TZWN0aW9uSW1wbChjb250KTtcclxuICB9IGNhdGNoIChlKSB7XHJcbiAgICBjb25zb2xlLmVycm9yKCdbRk9SRUNBU1QgcmVjb10gcmVuZGVyIGZhaWwnLCBlKTtcclxuICAgIGNvbnQuaW5uZXJIVE1MID1cclxuICAgICAgJzxkaXYgc3R5bGU9XCJwYWRkaW5nOjIwcHg7Y29sb3I6I2RjMjYyNlwiPicgK1xyXG4gICAgICAnPGRpdiBzdHlsZT1cImZvbnQtd2VpZ2h0OjcwMDttYXJnaW4tYm90dG9tOjhweFwiPkVycm9yIHJlbmRlcml6YW5kbyB0YWJsYSByZWNvbWVuZGFjaVx1MDBGM248L2Rpdj4nICtcclxuICAgICAgJzxwcmUgc3R5bGU9XCJmb250LXNpemU6MTFweDtiYWNrZ3JvdW5kOiNmZWYyZjI7cGFkZGluZzoxMHB4O2JvcmRlci1yYWRpdXM6NnB4O292ZXJmbG93OmF1dG87d2hpdGUtc3BhY2U6cHJlLXdyYXBcIj4nICtcclxuICAgICAgZXNjYXBlSHRtbFNhZmUoZS5zdGFjayB8fCBlLm1lc3NhZ2UgfHwgU3RyaW5nKGUpKSArXHJcbiAgICAgICc8L3ByZT48L2Rpdj4nO1xyXG4gIH1cclxufVxyXG5cclxuZnVuY3Rpb24gX3JlbmRlclJlY29TZWN0aW9uSW1wbChjb250KSB7XHJcbiAgY29uc3QgYW55TG9hZGVkID0gISEoX3NhbGVzUGxhbkNhY2hlcy5yb2RzIHx8IF9zYWxlc1BsYW5DYWNoZXMucmVlbHMpO1xyXG4gIGlmICghYW55TG9hZGVkKSB7XHJcbiAgICBjb250LmlubmVySFRNTCA9ICcnO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuICBpZiAoIV9yZWNvU3RvY2tTbmFwc2hvdCB8fCAhX3JlY29WZW50YXNTbmFwc2hvdCkge1xyXG4gICAgY29udC5pbm5lckhUTUwgPVxyXG4gICAgICAnPGRpdiBzdHlsZT1cInBhZGRpbmc6NDBweCAxOHB4O3RleHQtYWxpZ246Y2VudGVyO2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpXCI+JyArXHJcbiAgICAgICc8ZGl2IHN0eWxlPVwiZGlzcGxheTppbmxpbmUtYmxvY2s7d2lkdGg6MjRweDtoZWlnaHQ6MjRweDtib3JkZXI6M3B4IHNvbGlkICMwZDk0ODg7Ym9yZGVyLXRvcC1jb2xvcjp0cmFuc3BhcmVudDtib3JkZXItcmFkaXVzOjUwJTthbmltYXRpb246c3BpbiAwLjhzIGxpbmVhciBpbmZpbml0ZTttYXJnaW4tYm90dG9tOjEwcHhcIj48L2Rpdj4nICtcclxuICAgICAgJzxkaXY+Q2FyZ2FuZG8gc3RvY2sgKyB2ZW50YXMgaGlzdFx1MDBGM3JpY2FzLi4uPC9kaXY+JyArXHJcbiAgICAgICc8c3R5bGU+QGtleWZyYW1lcyBzcGlue3Rve3RyYW5zZm9ybTpyb3RhdGUoMzYwZGVnKX19PC9zdHlsZT48L2Rpdj4nO1xyXG4gICAgX2xvYWRSZWNvRGF0YSgpXHJcbiAgICAgIC50aGVuKF9yZW5kZXJSZWNvU2VjdGlvbilcclxuICAgICAgLmNhdGNoKChlKSA9PiB7XHJcbiAgICAgICAgY29uc29sZS5lcnJvcignW0ZPUkVDQVNUIHJlY29dIGxvYWQgZmFpbCcsIGUpO1xyXG4gICAgICAgIGNvbnQuaW5uZXJIVE1MID1cclxuICAgICAgICAgICc8ZGl2IHN0eWxlPVwicGFkZGluZzoyMHB4O2NvbG9yOiNkYzI2MjZcIj5FcnJvciBjYXJnYW5kbyBkYXRvczogJyArXHJcbiAgICAgICAgICBlc2NhcGVIdG1sU2FmZShlLm1lc3NhZ2UgfHwgU3RyaW5nKGUpKSArXHJcbiAgICAgICAgICAnPC9kaXY+JztcclxuICAgICAgfSk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIGNvbnN0IGFsbFJvd3MgPSBfY29tcHV0ZVJlY29tbWVuZGF0aW9ucygpO1xyXG4gIGNvbnN0IHNlYXJjaExjID0gX3JlY29TZWFyY2hUZXh0LnRyaW0oKS50b0xvd2VyQ2FzZSgpO1xyXG4gIGNvbnN0IHJvd3MgPSBhbGxSb3dzLmZpbHRlcigocikgPT4ge1xyXG4gICAgaWYgKF9yZWNvRmlsdGVyRmFtaWxpYSAhPT0gJ2FsbCcgJiYgci5mYW1pbGlhICE9PSBfcmVjb0ZpbHRlckZhbWlsaWEpIHJldHVybiBmYWxzZTtcclxuICAgIGlmIChfcmVjb0ZpbHRlck1pblJlYyAmJiByLnJlY29tZW5kYWRvIDw9IDApIHJldHVybiBmYWxzZTtcclxuICAgIGlmIChzZWFyY2hMYykge1xyXG4gICAgICBjb25zdCBoYXkgPVxyXG4gICAgICAgIHIuc2t1LnRvTG93ZXJDYXNlKCkuaW5jbHVkZXMoc2VhcmNoTGMpIHx8IHIuZGVzY3JpcHRpb24udG9Mb3dlckNhc2UoKS5pbmNsdWRlcyhzZWFyY2hMYyk7XHJcbiAgICAgIGlmICghaGF5KSByZXR1cm4gZmFsc2U7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gdHJ1ZTtcclxuICB9KTtcclxuICBjb25zdCB0b3RhbFJlY28gPSBhbGxSb3dzLnJlZHVjZSgocywgcikgPT4gcyArIHIucmVjb21lbmRhZG8sIDApO1xyXG4gIGNvbnN0IHRvdGFsQ29uUmVjbyA9IGFsbFJvd3MuZmlsdGVyKChyKSA9PiByLnJlY29tZW5kYWRvID4gMCkubGVuZ3RoO1xyXG5cclxuICBjb25zdCBuRGlzYyA9IF9kaXNjb250aW51ZWRTa3VzID8gX2Rpc2NvbnRpbnVlZFNrdXMuc2l6ZSA6IDA7XHJcbiAgY29uc3QgZGlzY0NoaXAgPVxyXG4gICAgbkRpc2MgPiAwXHJcbiAgICAgID8gJzxidXR0b24gb25jbGljaz1cIm9wZW5EaXNjb250aW51ZWRNb2RhbCgpXCIgc3R5bGU9XCJwYWRkaW5nOjZweCAxMnB4O2JhY2tncm91bmQ6IzkzMzNlYTtjb2xvcjojZmZmO2JvcmRlcjpub25lO2JvcmRlci1yYWRpdXM6NnB4O2ZvbnQtc2l6ZToxMnB4O2ZvbnQtd2VpZ2h0OjcwMDtjdXJzb3I6cG9pbnRlclwiIHRpdGxlPVwiR2VzdGlvbmFyIFNLVXMgZGVzY29udGludWFkb3NcIj5cdUQ4M0RcdURFQUIgJyArXHJcbiAgICAgICAgX2ZtdEludChuRGlzYykgK1xyXG4gICAgICAgICcgZGVzY29udGludWFkb3M8L2J1dHRvbj4nXHJcbiAgICAgIDogJyc7XHJcbiAgLy8gdjEzNTUgKDIwMjYtMTAtMTkpOiBib3RvbiBcIlByb3hpbWFzIGRlc2NvbnRpbnVhY2lvbmVzXCIgcGFyYSBtYXJjYXIgZW4gYnVsa1xyXG4gIC8vIGxvcyBTS1VzIHF1ZSBzZSB2YW4gYSBkZXNjb250aW51YXIgZW4gcHJveGltb3MgbWVzZXMuIE1pc21vIGVmZWN0byBlblxyXG4gIC8vIGZvcmVjYXN0IHF1ZSBkZXNjb250aW51YXIgKHNraXBlYSBlbiBfY29tcHV0ZVJlY29tbWVuZGF0aW9ucykgcGVybyBVWFxyXG4gIC8vIGJ1bGstbWFya2luZyBjb24gY2hlY2tib3hlcyB2cyBmaWxhLXBvci1maWxhIGNvbiBcdUQ4M0RcdURERDEuIFBlZGlkbyBNYXJpYW5vLlxyXG4gIGNvbnN0IHVwY29taW5nQnRuID1cclxuICAgICc8YnV0dG9uIG9uY2xpY2s9XCJvcGVuVXBjb21pbmdEaXNjb250aW51ZWRNb2RhbCgpXCIgc3R5bGU9XCJwYWRkaW5nOjZweCAxMnB4O2JhY2tncm91bmQ6IzI1NjNlYjtjb2xvcjojZmZmO2JvcmRlcjpub25lO2JvcmRlci1yYWRpdXM6NnB4O2ZvbnQtc2l6ZToxMnB4O2ZvbnQtd2VpZ2h0OjcwMDtjdXJzb3I6cG9pbnRlclwiIHRpdGxlPVwiTWFyY2FyIGVuIGJ1bGsgU0tVcyBxdWUgc2UgdmFuIGEgZGVzY29udGludWFyXCI+XHVEODNEXHVEQ0NCIFByXHUwMEYzeGltYXMgZGVzY29udGludWFjaW9uZXM8L2J1dHRvbj4nO1xyXG5cclxuICBjb25zdCBoZWFkZXIgPVxyXG4gICAgJzxkaXYgc3R5bGU9XCJkaXNwbGF5OmZsZXg7ZmxleC13cmFwOndyYXA7Z2FwOjEwcHg7YWxpZ24taXRlbXM6Y2VudGVyO21hcmdpbi1ib3R0b206MTJweFwiPicgK1xyXG4gICAgJzxkaXYgc3R5bGU9XCJmbGV4OjE7bWluLXdpZHRoOjI4MHB4XCI+PGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxOHB4O2ZvbnQtd2VpZ2h0OjgwMDtjb2xvcjp2YXIoLS10ZXh0LXByaW1hcnkpXCI+UmVjb21lbmRhY2lcdTAwRjNuIGRlIENvbXByYTwvZGl2PicgK1xyXG4gICAgJzxkaXYgc3R5bGU9XCJmb250LXNpemU6MTFweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTttYXJnaW4tdG9wOjJweFwiPkJhbGFuY2UgPSBTdG9jayArIFRyXHUwMEUxbnNpdG8gKyBQbGFuIFx1MjIxMiBCYWNrb3JkZXIgXHUyMjEyIChWZW50YSBtZW5zLiBcdTAwRDcgJyArXHJcbiAgICBSRUNPX0hPUklaT05fTU9OVEhTICtcclxuICAgICdtKTwvZGl2PjwvZGl2PicgK1xyXG4gICAgdXBjb21pbmdCdG4gK1xyXG4gICAgJzxkaXYgc3R5bGU9XCJwYWRkaW5nOjZweCAxMnB4O2JhY2tncm91bmQ6IzBkOTQ4ODtjb2xvcjojZmZmO2JvcmRlci1yYWRpdXM6NnB4O2ZvbnQtc2l6ZToxMnB4O2ZvbnQtd2VpZ2h0OjcwMFwiPicgK1xyXG4gICAgX2ZtdEludCh0b3RhbENvblJlY28pICtcclxuICAgICcgU0tVcyBjb24gcmVjbzwvZGl2PicgK1xyXG4gICAgJzxkaXYgc3R5bGU9XCJwYWRkaW5nOjZweCAxMnB4O2JhY2tncm91bmQ6IzEzNGU0YTtjb2xvcjojZmZmO2JvcmRlci1yYWRpdXM6NnB4O2ZvbnQtc2l6ZToxMnB4O2ZvbnQtd2VpZ2h0OjcwMFwiPlx1MDNBMyAnICtcclxuICAgIF9mbXRJbnQodG90YWxSZWNvKSArXHJcbiAgICAnIHVuaWRhZGVzPC9kaXY+JyArXHJcbiAgICBkaXNjQ2hpcCArXHJcbiAgICAnPC9kaXY+JztcclxuXHJcbiAgY29uc3QgZmlsdGVycyA9XHJcbiAgICAnPGRpdiBzdHlsZT1cImRpc3BsYXk6ZmxleDtmbGV4LXdyYXA6d3JhcDtnYXA6OHB4O21hcmdpbi1ib3R0b206MTBweDtwYWRkaW5nOjEwcHg7YmFja2dyb3VuZDp2YXIoLS1iZy1zZWNvbmRhcnkpO2JvcmRlci1yYWRpdXM6NnB4XCI+JyArXHJcbiAgICAnPGlucHV0IHR5cGU9XCJ0ZXh0XCIgaWQ9XCJyZWNvLXNlYXJjaFwiIHBsYWNlaG9sZGVyPVwiQnVzY2FyIFNLVSBvIGRlc2NyaXBjaW9uLi4uXCIgdmFsdWU9XCInICtcclxuICAgIGVzY2FwZUh0bWxTYWZlKF9yZWNvU2VhcmNoVGV4dCkgK1xyXG4gICAgJ1wiIG9uaW5wdXQ9XCJvblJlY29TZWFyY2hDaGFuZ2UoZXZlbnQpXCIgc3R5bGU9XCJmbGV4OjE7bWluLXdpZHRoOjIwMHB4O3BhZGRpbmc6NnB4IDEwcHg7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1ib3JkZXItc3VidGxlKTtib3JkZXItcmFkaXVzOjRweDtmb250LXNpemU6MTJweDtiYWNrZ3JvdW5kOnZhcigtLWJnLWVsZXZhdGVkKTtjb2xvcjp2YXIoLS10ZXh0LXByaW1hcnkpXCIvPicgK1xyXG4gICAgJzxzZWxlY3Qgb25jaGFuZ2U9XCJvblJlY29GYW1pbGlhQ2hhbmdlKGV2ZW50KVwiIHN0eWxlPVwicGFkZGluZzo2cHggMTBweDtib3JkZXI6MXB4IHNvbGlkIHZhcigtLWJvcmRlci1zdWJ0bGUpO2JvcmRlci1yYWRpdXM6NHB4O2ZvbnQtc2l6ZToxMnB4O2JhY2tncm91bmQ6dmFyKC0tYmctZWxldmF0ZWQpO2NvbG9yOnZhcigtLXRleHQtcHJpbWFyeSlcIj4nICtcclxuICAgICc8b3B0aW9uIHZhbHVlPVwiYWxsXCInICtcclxuICAgIChfcmVjb0ZpbHRlckZhbWlsaWEgPT09ICdhbGwnID8gJyBzZWxlY3RlZCcgOiAnJykgK1xyXG4gICAgJz5Ub2RhcyBsYXMgZmFtaWxpYXM8L29wdGlvbj4nICtcclxuICAgICc8b3B0aW9uIHZhbHVlPVwicm9kc1wiJyArXHJcbiAgICAoX3JlY29GaWx0ZXJGYW1pbGlhID09PSAncm9kcycgPyAnIHNlbGVjdGVkJyA6ICcnKSArXHJcbiAgICAnPlNvbG8gUm9kcyAoQ2FcdTAwRjFhcyk8L29wdGlvbj4nICtcclxuICAgICc8b3B0aW9uIHZhbHVlPVwicmVlbHNcIicgK1xyXG4gICAgKF9yZWNvRmlsdGVyRmFtaWxpYSA9PT0gJ3JlZWxzJyA/ICcgc2VsZWN0ZWQnIDogJycpICtcclxuICAgICc+U29sbyBSZWVsczwvb3B0aW9uPicgK1xyXG4gICAgJzwvc2VsZWN0PicgK1xyXG4gICAgJzxsYWJlbCBzdHlsZT1cImRpc3BsYXk6aW5saW5lLWZsZXg7YWxpZ24taXRlbXM6Y2VudGVyO2dhcDo2cHg7cGFkZGluZzo2cHggMTBweDtmb250LXNpemU6MTJweDtjb2xvcjp2YXIoLS10ZXh0LXByaW1hcnkpO2N1cnNvcjpwb2ludGVyXCI+JyArXHJcbiAgICAnPGlucHV0IHR5cGU9XCJjaGVja2JveFwiJyArXHJcbiAgICAoX3JlY29GaWx0ZXJNaW5SZWMgPyAnIGNoZWNrZWQnIDogJycpICtcclxuICAgICcgb25jaGFuZ2U9XCJvblJlY29GaWx0ZXJNaW5DaGFuZ2UoZXZlbnQpXCIvPicgK1xyXG4gICAgJ1NvbG8gY29uIHJlY29tZW5kYWRvICZndDsgMDwvbGFiZWw+JyArXHJcbiAgICAnPGJ1dHRvbiBvbmNsaWNrPVwiZXhwb3J0UmVjb0V4Y2VsKClcIiBzdHlsZT1cInBhZGRpbmc6NnB4IDEycHg7YmFja2dyb3VuZDojMTZhMzRhO2NvbG9yOiNmZmY7Ym9yZGVyOm5vbmU7Ym9yZGVyLXJhZGl1czo0cHg7Zm9udC1zaXplOjEycHg7Zm9udC13ZWlnaHQ6NzAwO2N1cnNvcjpwb2ludGVyXCI+XHUyQjA3IEV4Y2VsPC9idXR0b24+JyArXHJcbiAgICAnPC9kaXY+JztcclxuXHJcbiAgY29uc3Qgcm93c0h0bWwgPSByb3dzXHJcbiAgICAubWFwKChyKSA9PiB7XHJcbiAgICAgIGNvbnN0IGJhbENvbG9yID0gci5iYWxhbmNlIDwgMCA/ICcjZGMyNjI2JyA6IHIuYmFsYW5jZSA8IDUwID8gJyNmNTllMGInIDogJyMxNmEzNGEnO1xyXG4gICAgICBjb25zdCByZWNDb2xvciA9IHIucmVjb21lbmRhZG8gPiAwID8gJyNkYzI2MjYnIDogJyM5NGEzYjgnO1xyXG4gICAgICByZXR1cm4gKFxyXG4gICAgICAgICc8dHIgc3R5bGU9XCJib3JkZXItYm90dG9tOjFweCBzb2xpZCB2YXIoLS1ib3JkZXItc3VidGxlKVwiPicgK1xyXG4gICAgICAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjZweCA4cHg7dGV4dC1hbGlnbjpjZW50ZXJcIj48c3BhbiBzdHlsZT1cImRpc3BsYXk6aW5saW5lLWJsb2NrO3BhZGRpbmc6MnB4IDZweDtib3JkZXItcmFkaXVzOjEwcHg7YmFja2dyb3VuZDonICtcclxuICAgICAgICAoci5mYW1pbGlhID09PSAncm9kcycgPyAnIzBlYTVlOScgOiAnIzhiNWNmNicpICtcclxuICAgICAgICAnO2NvbG9yOiNmZmY7Zm9udC1zaXplOjEwcHg7Zm9udC13ZWlnaHQ6NzAwXCI+JyArXHJcbiAgICAgICAgKHIuZmFtaWxpYSA9PT0gJ3JvZHMnID8gJ1JPRCcgOiAnUkVFTCcpICtcclxuICAgICAgICAnPC9zcGFuPjwvdGQ+JyArXHJcbiAgICAgICAgJzx0ZCBzdHlsZT1cInBhZGRpbmc6NnB4IDhweDt0ZXh0LWFsaWduOmNlbnRlcjtmb250LWZhbWlseTptb25vc3BhY2U7Zm9udC1zaXplOjExcHg7Y29sb3I6dmFyKC0tdGV4dC1wcmltYXJ5KTtmb250LXdlaWdodDo3MDBcIj4nICtcclxuICAgICAgICBlc2NhcGVIdG1sU2FmZShyLnNrdSkgK1xyXG4gICAgICAgICc8L3RkPicgK1xyXG4gICAgICAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjZweCA4cHg7Zm9udC1zaXplOjExcHg7Y29sb3I6dmFyKC0tdGV4dC1zZWNvbmRhcnkpO21heC13aWR0aDoyNDBweDtvdmVyZmxvdzpoaWRkZW47dGV4dC1vdmVyZmxvdzplbGxpcHNpczt3aGl0ZS1zcGFjZTpub3dyYXBcIiB0aXRsZT1cIicgK1xyXG4gICAgICAgIGVzY2FwZUh0bWxTYWZlKHIuZGVzY3JpcHRpb24pICtcclxuICAgICAgICAnXCI+JyArXHJcbiAgICAgICAgZXNjYXBlSHRtbFNhZmUoci5kZXNjcmlwdGlvbikgK1xyXG4gICAgICAgICc8L3RkPicgK1xyXG4gICAgICAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjZweCA4cHg7dGV4dC1hbGlnbjpjZW50ZXI7Zm9udC12YXJpYW50LW51bWVyaWM6dGFidWxhci1udW1zO2NvbG9yOnZhcigtLXRleHQtcHJpbWFyeSlcIj4nICtcclxuICAgICAgICBfZm10SW50KHIuc3RvY2tMaWJyZSkgK1xyXG4gICAgICAgICc8L3RkPicgK1xyXG4gICAgICAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjZweCA4cHg7dGV4dC1hbGlnbjpjZW50ZXI7Zm9udC12YXJpYW50LW51bWVyaWM6dGFidWxhci1udW1zO2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpXCI+JyArXHJcbiAgICAgICAgX2ZtdEludChyLmVuVHJhbnNpdG8pICtcclxuICAgICAgICAnPC90ZD4nICtcclxuICAgICAgICAnPHRkIHN0eWxlPVwicGFkZGluZzo2cHggOHB4O3RleHQtYWxpZ246Y2VudGVyO2ZvbnQtdmFyaWFudC1udW1lcmljOnRhYnVsYXItbnVtcztjb2xvcjojZGMyNjI2XCI+JyArXHJcbiAgICAgICAgX2ZtdEludChyLmJhY2tvcmRlcikgK1xyXG4gICAgICAgICc8L3RkPicgK1xyXG4gICAgICAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjZweCA4cHg7dGV4dC1hbGlnbjpjZW50ZXI7Zm9udC12YXJpYW50LW51bWVyaWM6dGFidWxhci1udW1zO2NvbG9yOnZhcigtLXRleHQtc2Vjb25kYXJ5KVwiPicgK1xyXG4gICAgICAgIF9mbXRJbnQoci52ZW50YU1lbnN1YWwpICtcclxuICAgICAgICAnPC90ZD4nICtcclxuICAgICAgICAnPHRkIHN0eWxlPVwicGFkZGluZzo2cHggOHB4O3RleHQtYWxpZ246Y2VudGVyXCI+JyArXHJcbiAgICAgICAgX2J1aWxkTXVsdENlbGxIdG1sKHIpICtcclxuICAgICAgICAnPC90ZD4nICtcclxuICAgICAgICAnPHRkIHN0eWxlPVwicGFkZGluZzo2cHggOHB4O3RleHQtYWxpZ246Y2VudGVyO2ZvbnQtdmFyaWFudC1udW1lcmljOnRhYnVsYXItbnVtcztjb2xvcjp2YXIoLS10ZXh0LXNlY29uZGFyeSlcIj4nICtcclxuICAgICAgICBfZm10SW50KHIuZGVtYW5kYUVzcGVyYWRhKSArXHJcbiAgICAgICAgJzwvdGQ+JyArXHJcbiAgICAgICAgJzx0ZCBzdHlsZT1cInBhZGRpbmc6NnB4IDhweDt0ZXh0LWFsaWduOmNlbnRlcjtmb250LXZhcmlhbnQtbnVtZXJpYzp0YWJ1bGFyLW51bXM7Y29sb3I6dmFyKC0tdGV4dC1wcmltYXJ5KTtmb250LXdlaWdodDo2MDBcIj4nICtcclxuICAgICAgICBfZm10SW50KHIuc2FsZXNQbGFuRnV0KSArXHJcbiAgICAgICAgJzwvdGQ+JyArXHJcbiAgICAgICAgJzx0ZCBzdHlsZT1cInBhZGRpbmc6NnB4IDhweDt0ZXh0LWFsaWduOmNlbnRlcjtmb250LXZhcmlhbnQtbnVtZXJpYzp0YWJ1bGFyLW51bXM7Zm9udC13ZWlnaHQ6NzAwO2NvbG9yOicgK1xyXG4gICAgICAgIGJhbENvbG9yICtcclxuICAgICAgICAnXCI+JyArXHJcbiAgICAgICAgX2ZtdE51bVNpZ25lZChyLmJhbGFuY2UpICtcclxuICAgICAgICAnPC90ZD4nICtcclxuICAgICAgICAnPHRkIHN0eWxlPVwicGFkZGluZzo2cHggOHB4O3RleHQtYWxpZ246Y2VudGVyO2ZvbnQtdmFyaWFudC1udW1lcmljOnRhYnVsYXItbnVtcztjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTtmb250LXNpemU6MTFweFwiPicgK1xyXG4gICAgICAgIF9mbXRJbnQoci5tb3EpICtcclxuICAgICAgICAnPC90ZD4nICtcclxuICAgICAgICAnPHRkIHN0eWxlPVwicGFkZGluZzo2cHggOHB4O3RleHQtYWxpZ246Y2VudGVyXCI+PHNwYW4gc3R5bGU9XCJkaXNwbGF5OmlubGluZS1ibG9jaztwYWRkaW5nOjRweCAxMHB4O2JvcmRlci1yYWRpdXM6MTJweDtiYWNrZ3JvdW5kOicgK1xyXG4gICAgICAgIHJlY0NvbG9yICtcclxuICAgICAgICAnO2NvbG9yOiNmZmY7Zm9udC1zaXplOjEycHg7Zm9udC13ZWlnaHQ6ODAwO21pbi13aWR0aDo1MHB4XCI+JyArXHJcbiAgICAgICAgX2ZtdEludChyLnJlY29tZW5kYWRvKSArXHJcbiAgICAgICAgJzwvc3Bhbj48L3RkPicgK1xyXG4gICAgICAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjZweCA4cHg7dGV4dC1hbGlnbjpjZW50ZXJcIj4nICtcclxuICAgICAgICAnPGJ1dHRvbiBvbmNsaWNrPVwiZGlzY29udGludWVTa3UoXFwnJyArXHJcbiAgICAgICAgZXNjYXBlSHRtbFNhZmUoci5za3UpICtcclxuICAgICAgICBcIicsICdcIiArXHJcbiAgICAgICAgZXNjYXBlSHRtbFNhZmUoci5kZXNjcmlwdGlvbi5yZXBsYWNlKC8nL2csICcnKSkgK1xyXG4gICAgICAgICdcXCcpXCIgdGl0bGU9XCJEZXNjb250aW51YXIgZXN0ZSBTS1VcIiBzdHlsZT1cImJhY2tncm91bmQ6dHJhbnNwYXJlbnQ7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1ib3JkZXItc3VidGxlKTtib3JkZXItcmFkaXVzOjRweDtwYWRkaW5nOjRweCA4cHg7Y3Vyc29yOnBvaW50ZXI7Zm9udC1zaXplOjE0cHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZClcIj5cdUQ4M0RcdURERDE8L2J1dHRvbj4nICtcclxuICAgICAgICAnPC90ZD4nICtcclxuICAgICAgICAnPC90cj4nXHJcbiAgICAgICk7XHJcbiAgICB9KVxyXG4gICAgLmpvaW4oJycpO1xyXG5cclxuICAvLyB2MTExMjogbWluLXdpZHRoIHBhcmEgZm9yemFyIHNjcm9sbCBob3Jpem9udGFsIHNpIG5vIGNhYmUgbGEgY29sdW1uYVxyXG4gIC8vIEFjY2lcdTAwRjNuLiBTaW4gZXN0bywgdGFibGUgd2lkdGg6MTAwJSBjb21wcmltZSB0b2RvIHkgbGEgXHUwMEZBbHRpbWEgY29sdW1uYVxyXG4gIC8vIHF1ZWRhIGZ1ZXJhIGRlbCB2aWV3cG9ydCBzaW4gc2Nyb2xsIHZpc2libGUuXHJcbiAgY29uc3QgdGFibGUgPVxyXG4gICAgJzxkaXYgc3R5bGU9XCJvdmVyZmxvdzphdXRvO21heC1oZWlnaHQ6NjB2aDtib3JkZXI6MXB4IHNvbGlkIHZhcigtLWJvcmRlci1zdWJ0bGUpO2JvcmRlci1yYWRpdXM6OHB4XCI+JyArXHJcbiAgICAnPHRhYmxlIHN0eWxlPVwid2lkdGg6MTAwJTttaW4td2lkdGg6MTQwMHB4O2JvcmRlci1jb2xsYXBzZTpjb2xsYXBzZTtmb250LXNpemU6MTJweFwiPicgK1xyXG4gICAgJzx0aGVhZCBzdHlsZT1cImJhY2tncm91bmQ6IzBmMTcyYTtjb2xvcjojZmZmO3Bvc2l0aW9uOnN0aWNreTt0b3A6MDt6LWluZGV4OjFcIj48dHI+JyArXHJcbiAgICAnPHRoIHN0eWxlPVwicGFkZGluZzo4cHg7dGV4dC1hbGlnbjpjZW50ZXI7Zm9udC1zaXplOjEwcHg7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlXCI+RmFtPC90aD4nICtcclxuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjhweDt0ZXh0LWFsaWduOmNlbnRlcjtmb250LXNpemU6MTBweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2VcIj5TS1U8L3RoPicgK1xyXG4gICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6OHB4O3RleHQtYWxpZ246Y2VudGVyO2ZvbnQtc2l6ZToxMHB4O3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZVwiPkRlc2NyaXBjaVx1MDBGM248L3RoPicgK1xyXG4gICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6OHB4O3RleHQtYWxpZ246Y2VudGVyO2ZvbnQtc2l6ZToxMHB4O3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZVwiIHRpdGxlPVwiV2hzIDExIGRpc3BvbmlibGUgdmVudGFcIj5TdG9jazwvdGg+JyArXHJcbiAgICAnPHRoIHN0eWxlPVwicGFkZGluZzo4cHg7dGV4dC1hbGlnbjpjZW50ZXI7Zm9udC1zaXplOjEwcHg7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlXCIgdGl0bGU9XCJXaHMgMTJcIj5Uclx1MDBFMW5zaXRvPC90aD4nICtcclxuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjhweDt0ZXh0LWFsaWduOmNlbnRlcjtmb250LXNpemU6MTBweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2VcIj5CYWNrb3JkZXI8L3RoPicgK1xyXG4gICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6OHB4O3RleHQtYWxpZ246Y2VudGVyO2ZvbnQtc2l6ZToxMHB4O3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZVwiIHRpdGxlPVwiUHJvbWVkaW8gXHUwMEZBbHRpbW9zIDMgbWVzZXNcIj5WdGEvbWVzPC90aD4nICtcclxuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjhweDt0ZXh0LWFsaWduOmNlbnRlcjtmb250LXNpemU6MTBweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2VcIiB0aXRsZT1cIk11bHRpcGxpY2Fkb3IgZGUgdGVuZGVuY2lhID0gdmVudGEgMm0gLyB2ZW50YSA2bS4gRWRpdGFibGUgKGNsaWNrIHBhcmEgb3ZlcnJpZGUpLlwiPk11bHRpcC48L3RoPicgK1xyXG4gICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6OHB4O3RleHQtYWxpZ246Y2VudGVyO2ZvbnQtc2l6ZToxMHB4O3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZVwiIHRpdGxlPVwiVnRhL21lcyBcdTAwRDcgNyBtZXNlc1wiPkRlbWFuZGEgZXNwLjwvdGg+JyArXHJcbiAgICAnPHRoIHN0eWxlPVwicGFkZGluZzo4cHg7dGV4dC1hbGlnbjpjZW50ZXI7Zm9udC1zaXplOjEwcHg7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlXCIgdGl0bGU9XCJTdW1hIGNvbHVtbmFzIFNhbGVzIFBsYW4gZGVzZGUgbWVzIGFjdHVhbFwiPlBsYW4gZnV0dXJvPC90aD4nICtcclxuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjhweDt0ZXh0LWFsaWduOmNlbnRlcjtmb250LXNpemU6MTBweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2VcIj5CYWxhbmNlPC90aD4nICtcclxuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjhweDt0ZXh0LWFsaWduOmNlbnRlcjtmb250LXNpemU6MTBweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2VcIj5NT1E8L3RoPicgK1xyXG4gICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6OHB4O3RleHQtYWxpZ246Y2VudGVyO2ZvbnQtc2l6ZToxMHB4O3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtiYWNrZ3JvdW5kOiMxMzRlNGFcIj5SZWNvbWVuZGFkbzwvdGg+JyArXHJcbiAgICAnPHRoIHN0eWxlPVwicGFkZGluZzo4cHg7dGV4dC1hbGlnbjpjZW50ZXI7Zm9udC1zaXplOjEwcHg7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlXCIgdGl0bGU9XCJEZXNjb250aW51YXIgU0tVXCI+QWNjaVx1MDBGM248L3RoPicgK1xyXG4gICAgJzwvdHI+PC90aGVhZD48dGJvZHk+JyArXHJcbiAgICAocm93cy5sZW5ndGhcclxuICAgICAgPyByb3dzSHRtbFxyXG4gICAgICA6ICc8dHI+PHRkIGNvbHNwYW49XCIxNFwiIHN0eWxlPVwicGFkZGluZzo0MHB4O3RleHQtYWxpZ246Y2VudGVyO2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpXCI+U2luIHJlc3VsdGFkb3MgY29uIGxvcyBmaWx0cm9zIGFjdHVhbGVzPC90ZD48L3RyPicpICtcclxuICAgICc8L3Rib2R5PjwvdGFibGU+PC9kaXY+JztcclxuXHJcbiAgY29uc3QgZm9vdGVyID1cclxuICAgICc8ZGl2IHN0eWxlPVwibWFyZ2luLXRvcDo4cHg7Zm9udC1zaXplOjEwcHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZClcIj4nICtcclxuICAgICdNb3N0cmFuZG8gJyArXHJcbiAgICBfZm10SW50KHJvd3MubGVuZ3RoKSArXHJcbiAgICAnIGRlICcgK1xyXG4gICAgX2ZtdEludChhbGxSb3dzLmxlbmd0aCkgK1xyXG4gICAgJyBTS1VzIFx1MDBCNyAnICtcclxuICAgICdCYWxhbmNlID0gU3RvY2sgKyBUclx1MDBFMW5zaXRvICsgUGxhbiBcdTIyMTIgQmFja29yZGVyIFx1MjIxMiBEZW1hbmRhLiBSb2pvID0gcXVpZWJyZSBlc3BlcmFkby4gUmVjb21lbmRhZG8gc2UgcmVkb25kZWEgYWwgbVx1MDBGQWx0aXBsbyBkZSBNT1Egc3VwZXJpb3IuJyArXHJcbiAgICAnPC9kaXY+JztcclxuXHJcbiAgY29udC5pbm5lckhUTUwgPVxyXG4gICAgJzxkaXYgc3R5bGU9XCJwYWRkaW5nOjE4cHggMThweCAzMHB4XCI+JyArIGhlYWRlciArIGZpbHRlcnMgKyB0YWJsZSArIGZvb3RlciArICc8L2Rpdj4nO1xyXG59XHJcblxyXG53aW5kb3cub25SZWNvU2VhcmNoQ2hhbmdlID0gZnVuY3Rpb24gKGV2KSB7XHJcbiAgX3JlY29TZWFyY2hUZXh0ID0gZXYudGFyZ2V0LnZhbHVlIHx8ICcnO1xyXG4gIF9yZW5kZXJSZWNvU2VjdGlvbigpO1xyXG4gIC8vIFJlc3RhdXJhciBmb2N1cyArIGNhcmV0IGFsIGlucHV0XHJcbiAgc2V0VGltZW91dCgoKSA9PiB7XHJcbiAgICBjb25zdCBpbnAgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgncmVjby1zZWFyY2gnKTtcclxuICAgIGlmIChpbnApIHtcclxuICAgICAgaW5wLmZvY3VzKCk7XHJcbiAgICAgIGlucC5zZXRTZWxlY3Rpb25SYW5nZShpbnAudmFsdWUubGVuZ3RoLCBpbnAudmFsdWUubGVuZ3RoKTtcclxuICAgIH1cclxuICB9LCAwKTtcclxufTtcclxuXHJcbndpbmRvdy5vblJlY29GYW1pbGlhQ2hhbmdlID0gZnVuY3Rpb24gKGV2KSB7XHJcbiAgX3JlY29GaWx0ZXJGYW1pbGlhID0gZXYudGFyZ2V0LnZhbHVlIHx8ICdhbGwnO1xyXG4gIF9yZW5kZXJSZWNvU2VjdGlvbigpO1xyXG59O1xyXG5cclxud2luZG93Lm9uUmVjb0ZpbHRlck1pbkNoYW5nZSA9IGZ1bmN0aW9uIChldikge1xyXG4gIF9yZWNvRmlsdGVyTWluUmVjID0gISFldi50YXJnZXQuY2hlY2tlZDtcclxuICBfcmVuZGVyUmVjb1NlY3Rpb24oKTtcclxufTtcclxuXHJcbndpbmRvdy5leHBvcnRSZWNvRXhjZWwgPSBmdW5jdGlvbiAoKSB7XHJcbiAgaWYgKHR5cGVvZiBYTFNYID09PSAndW5kZWZpbmVkJykge1xyXG4gICAgYWxlcnQoJ1NoZWV0SlMgKFhMU1gpIG5vIGNhcmdhZG8nKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgY29uc3Qgcm93cyA9IF9jb21wdXRlUmVjb21tZW5kYXRpb25zKCk7XHJcbiAgY29uc3QgYW9hID0gW1xyXG4gICAgW1xyXG4gICAgICAnRmFtaWxpYScsXHJcbiAgICAgICdTS1UnLFxyXG4gICAgICAnRGVzY3JpcGNpXHUwMEYzbicsXHJcbiAgICAgICdTdG9jaycsXHJcbiAgICAgICdUclx1MDBFMW5zaXRvJyxcclxuICAgICAgJ0JhY2tvcmRlcicsXHJcbiAgICAgICdWdGEgcHJvbS9tZXMnLFxyXG4gICAgICAnTXVsdGlwbGljYWRvcicsXHJcbiAgICAgICdPcmlnZW4gbXVsdCcsXHJcbiAgICAgICdEZW1hbmRhIGVzcC4gN20nLFxyXG4gICAgICAnU2FsZXMgUGxhbiBmdXR1cm8nLFxyXG4gICAgICAnQmFsYW5jZScsXHJcbiAgICAgICdNT1EnLFxyXG4gICAgICAnUmVjb21lbmRhZG8nLFxyXG4gICAgXSxcclxuICBdO1xyXG4gIGZvciAoY29uc3QgciBvZiByb3dzKSB7XHJcbiAgICBhb2EucHVzaChbXHJcbiAgICAgIHIuZmFtaWxpYSA9PT0gJ3JvZHMnID8gJ1JvZHMgKENhXHUwMEYxYXMpJyA6ICdSZWVscycsXHJcbiAgICAgIHIuc2t1LFxyXG4gICAgICByLmRlc2NyaXB0aW9uLFxyXG4gICAgICByLnN0b2NrTGlicmUsXHJcbiAgICAgIHIuZW5UcmFuc2l0byxcclxuICAgICAgci5iYWNrb3JkZXIsXHJcbiAgICAgIHIudmVudGFNZW5zdWFsLFxyXG4gICAgICByLm11bHRpcGxpZXIsXHJcbiAgICAgIHIubXVsdFNvdXJjZSB8fCAnYXV0bycsXHJcbiAgICAgIHIuZGVtYW5kYUVzcGVyYWRhLFxyXG4gICAgICByLnNhbGVzUGxhbkZ1dCxcclxuICAgICAgci5iYWxhbmNlLFxyXG4gICAgICByLm1vcSxcclxuICAgICAgci5yZWNvbWVuZGFkbyxcclxuICAgIF0pO1xyXG4gIH1cclxuICBjb25zdCB3cyA9IFhMU1gudXRpbHMuYW9hX3RvX3NoZWV0KGFvYSk7XHJcbiAgd3NbJyFjb2xzJ10gPSBbXHJcbiAgICB7IHdjaDogMTQgfSwgLy8gRmFtaWxpYVxyXG4gICAgeyB3Y2g6IDE4IH0sIC8vIFNLVVxyXG4gICAgeyB3Y2g6IDQwIH0sIC8vIERlc2NyaXBjaVx1MDBGM25cclxuICAgIHsgd2NoOiA4IH0sIC8vIFN0b2NrXHJcbiAgICB7IHdjaDogMTAgfSwgLy8gVHJcdTAwRTFuc2l0b1xyXG4gICAgeyB3Y2g6IDExIH0sIC8vIEJhY2tvcmRlclxyXG4gICAgeyB3Y2g6IDEyIH0sIC8vIFZ0YSBwcm9tL21lc1xyXG4gICAgeyB3Y2g6IDEyIH0sIC8vIE11bHRpcGxpY2Fkb3JcclxuICAgIHsgd2NoOiAxMSB9LCAvLyBPcmlnZW4gbXVsdFxyXG4gICAgeyB3Y2g6IDE1IH0sIC8vIERlbWFuZGEgZXNwIDdtXHJcbiAgICB7IHdjaDogMTYgfSwgLy8gU2FsZXMgUGxhbiBmdXR1cm9cclxuICAgIHsgd2NoOiAxMCB9LCAvLyBCYWxhbmNlXHJcbiAgICB7IHdjaDogOCB9LCAvLyBNT1FcclxuICAgIHsgd2NoOiAxMiB9LCAvLyBSZWNvbWVuZGFkb1xyXG4gIF07XHJcbiAgY29uc3Qgd2IgPSBYTFNYLnV0aWxzLmJvb2tfbmV3KCk7XHJcbiAgWExTWC51dGlscy5ib29rX2FwcGVuZF9zaGVldCh3Yiwgd3MsICdSZWNvbWVuZGFjaVx1MDBGM24nKTtcclxuICBjb25zdCBob3kgPSBuZXcgRGF0ZSgpO1xyXG4gIGNvbnN0IHN0YW1wID1cclxuICAgIGhveS5nZXRGdWxsWWVhcigpICtcclxuICAgICctJyArXHJcbiAgICBTdHJpbmcoaG95LmdldE1vbnRoKCkgKyAxKS5wYWRTdGFydCgyLCAnMCcpICtcclxuICAgICctJyArXHJcbiAgICBTdHJpbmcoaG95LmdldERhdGUoKSkucGFkU3RhcnQoMiwgJzAnKTtcclxuICBYTFNYLndyaXRlRmlsZSh3YiwgJ1JlY29tZW5kYWNpb25fQ29tcHJhXycgKyBzdGFtcCArICcueGxzeCcpO1xyXG59O1xyXG5cclxuLy8gdjExMTIgRjNCOiBkZXNjb250aW51YXIgLyByZWFjdGl2YXIgU0tVcy5cclxud2luZG93LmRpc2NvbnRpbnVlU2t1ID0gYXN5bmMgZnVuY3Rpb24gKHNrdSwgZGVzY3JpcHRpb24pIHtcclxuICBpZiAoIV9kaXNjb250aW51ZWRTa3VzKSBfZGlzY29udGludWVkU2t1cyA9IG5ldyBTZXQoKTtcclxuICBjb25zdCB1cHBlciA9IFN0cmluZyhza3UpLnRyaW0oKS50b1VwcGVyQ2FzZSgpO1xyXG4gIGNvbnN0IGxhYmVsID0gZGVzY3JpcHRpb24gPyBza3UgKyAnIFx1MjAxNCAnICsgZGVzY3JpcHRpb24uc2xpY2UoMCwgNjApIDogc2t1O1xyXG4gIGlmIChcclxuICAgICFjb25maXJtKFxyXG4gICAgICAnRGVzY29udGludWFyICcgK1xyXG4gICAgICAgIGxhYmVsICtcclxuICAgICAgICAnP1xcblxcblF1ZWRhclx1MDBFMSBleGNsdWlkbyBkZWwgY1x1MDBFMWxjdWxvIGRlIHJlY29tZW5kYWNpXHUwMEYzbiBkZSBjb21wcmEgaGFzdGEgcXVlIGxvIHJlYWN0aXZlcyBkZXNkZSBlbCBjaGlwIFwiRGVzY29udGludWFkb3NcIi4nXHJcbiAgICApXHJcbiAgKSB7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIF9kaXNjb250aW51ZWRTa3VzLmFkZCh1cHBlcik7XHJcbiAgdHJ5IHtcclxuICAgIGF3YWl0IF9zYXZlRGlzY29udGludWVkU2t1cygpO1xyXG4gICAgX3JlbmRlclJlY29TZWN0aW9uKCk7XHJcbiAgfSBjYXRjaCAoZSkge1xyXG4gICAgX2Rpc2NvbnRpbnVlZFNrdXMuZGVsZXRlKHVwcGVyKTtcclxuICAgIGFsZXJ0KCdFcnJvciBndWFyZGFuZG86ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcclxuICB9XHJcbn07XHJcblxyXG53aW5kb3cucmVhY3RpdmF0ZVNrdSA9IGFzeW5jIGZ1bmN0aW9uIChza3UpIHtcclxuICBpZiAoIV9kaXNjb250aW51ZWRTa3VzKSByZXR1cm47XHJcbiAgY29uc3QgdXBwZXIgPSBTdHJpbmcoc2t1KS50cmltKCkudG9VcHBlckNhc2UoKTtcclxuICBfZGlzY29udGludWVkU2t1cy5kZWxldGUodXBwZXIpO1xyXG4gIHRyeSB7XHJcbiAgICBhd2FpdCBfc2F2ZURpc2NvbnRpbnVlZFNrdXMoKTtcclxuICAgIF9yZW5kZXJEaXNjb250aW51ZWRNb2RhbCgpO1xyXG4gICAgX3JlbmRlclJlY29TZWN0aW9uKCk7XHJcbiAgfSBjYXRjaCAoZSkge1xyXG4gICAgX2Rpc2NvbnRpbnVlZFNrdXMuYWRkKHVwcGVyKTtcclxuICAgIGFsZXJ0KCdFcnJvciBndWFyZGFuZG86ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcclxuICB9XHJcbn07XHJcblxyXG53aW5kb3cub3BlbkRpc2NvbnRpbnVlZE1vZGFsID0gZnVuY3Rpb24gKCkge1xyXG4gIGNvbnN0IGV4aXN0aW5nID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2Rpc2NvbnRpbnVlZC1za3VzLW1vZGFsJyk7XHJcbiAgaWYgKGV4aXN0aW5nKSBleGlzdGluZy5yZW1vdmUoKTtcclxuICBjb25zdCBlbCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpO1xyXG4gIGVsLmlkID0gJ2Rpc2NvbnRpbnVlZC1za3VzLW1vZGFsJztcclxuICBlbC5zdHlsZS5jc3NUZXh0ID1cclxuICAgICdwb3NpdGlvbjpmaXhlZDtpbnNldDowO2JhY2tncm91bmQ6cmdiYSgxNSwyMyw0MiwuNjUpO3otaW5kZXg6MjEwMDtkaXNwbGF5OmZsZXg7YWxpZ24taXRlbXM6Y2VudGVyO2p1c3RpZnktY29udGVudDpjZW50ZXI7cGFkZGluZzozdmgnO1xyXG4gIGVsLm9uY2xpY2sgPSAoZXYpID0+IHtcclxuICAgIGlmIChldi50YXJnZXQgPT09IGVsKSBlbC5yZW1vdmUoKTtcclxuICB9O1xyXG4gIGVsLmlubmVySFRNTCA9XHJcbiAgICAnPGRpdiBpZD1cImRpc2NvbnRpbnVlZC1tb2RhbC1jb250ZW50XCIgc3R5bGU9XCJiYWNrZ3JvdW5kOnZhcigtLWJnLWVsZXZhdGVkKTtib3JkZXItcmFkaXVzOjEycHg7cGFkZGluZzoyNHB4O21heC13aWR0aDo2NDBweDt3aWR0aDoxMDAlO21heC1oZWlnaHQ6OTB2aDtvdmVyZmxvdzphdXRvO2JveC1zaGFkb3c6MCAyMHB4IDYwcHggcmdiYSgwLDAsMCwuNClcIj48L2Rpdj4nO1xyXG4gIGRvY3VtZW50LmJvZHkuYXBwZW5kQ2hpbGQoZWwpO1xyXG4gIF9yZW5kZXJEaXNjb250aW51ZWRNb2RhbCgpO1xyXG59O1xyXG5cclxuLy8gdjEzNTU6IHZlciBibG9xdWUgXCJQcm94aW1hcyBkZXNjb250aW51YWNpb25lc1wiIGFsIGZpbmFsIGRlbCBhcmNoaXZvLlxyXG5cclxuZnVuY3Rpb24gX3JlbmRlckRpc2NvbnRpbnVlZE1vZGFsKCkge1xyXG4gIGNvbnN0IGNvbnQgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZGlzY29udGludWVkLW1vZGFsLWNvbnRlbnQnKTtcclxuICBpZiAoIWNvbnQpIHJldHVybjtcclxuICBjb25zdCBsaXN0ID0gX2Rpc2NvbnRpbnVlZFNrdXMgPyBBcnJheS5mcm9tKF9kaXNjb250aW51ZWRTa3VzKS5zb3J0KCkgOiBbXTtcclxuICAvLyBCdXNjYXIgZGVzY3JpcGNpXHUwMEYzbiBlbiBsb3Mgc2FsZXMgcGxhbnMgY2FjaGVzIHBvciBzaSBlc3RhIGNhcmdhZG9cclxuICBjb25zdCBza3VUb0Rlc2MgPSB7fTtcclxuICBmb3IgKGNvbnN0IGZhbSBvZiBbJ3JvZHMnLCAncmVlbHMnXSkge1xyXG4gICAgY29uc3QgY2FjaGUgPSBfc2FsZXNQbGFuQ2FjaGVzW2ZhbV07XHJcbiAgICBpZiAoY2FjaGUgJiYgY2FjaGUucm93cykge1xyXG4gICAgICBmb3IgKGNvbnN0IHIgb2YgY2FjaGUucm93cykge1xyXG4gICAgICAgIHNrdVRvRGVzY1tTdHJpbmcoci5za3UpLnRyaW0oKS50b1VwcGVyQ2FzZSgpXSA9IHIuZGVzY3JpcHRpb24gfHwgJyc7XHJcbiAgICAgIH1cclxuICAgIH1cclxuICB9XHJcbiAgY29uc3QgaGVhZCA9XHJcbiAgICAnPGRpdiBzdHlsZT1cImRpc3BsYXk6ZmxleDtqdXN0aWZ5LWNvbnRlbnQ6c3BhY2UtYmV0d2VlbjthbGlnbi1pdGVtczpjZW50ZXI7bWFyZ2luLWJvdHRvbToxNHB4XCI+JyArXHJcbiAgICAnPGRpdj48ZGl2IHN0eWxlPVwiZm9udC1zaXplOjE4cHg7Zm9udC13ZWlnaHQ6ODAwO2NvbG9yOnZhcigtLXRleHQtcHJpbWFyeSlcIj5TS1VzIGRlc2NvbnRpbnVhZG9zPC9kaXY+JyArXHJcbiAgICAnPGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMXB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO21hcmdpbi10b3A6MnB4XCI+JyArXHJcbiAgICBsaXN0Lmxlbmd0aCArXHJcbiAgICAnIFNLVXMgZXhjbHVpZG9zIGRlbCBjXHUwMEUxbGN1bG8gZGUgUmVjb21lbmRhY2lcdTAwRjNuIGRlIENvbXByYScgK1xyXG4gICAgJzwvZGl2PjwvZGl2PicgK1xyXG4gICAgJzxidXR0b24gb25jbGljaz1cImRvY3VtZW50LmdldEVsZW1lbnRCeUlkKFxcJ2Rpc2NvbnRpbnVlZC1za3VzLW1vZGFsXFwnKS5yZW1vdmUoKVwiIHN0eWxlPVwiYmFja2dyb3VuZDp0cmFuc3BhcmVudDtib3JkZXI6MXB4IHNvbGlkIHZhcigtLWJvcmRlci1zdWJ0bGUpO2JvcmRlci1yYWRpdXM6NnB4O3BhZGRpbmc6NnB4IDEycHg7Y3Vyc29yOnBvaW50ZXI7Zm9udC13ZWlnaHQ6NzAwXCI+Q2VycmFyPC9idXR0b24+JyArXHJcbiAgICAnPC9kaXY+JztcclxuICBjb25zdCBib2R5ID1cclxuICAgIGxpc3QubGVuZ3RoID09PSAwXHJcbiAgICAgID8gJzxkaXYgc3R5bGU9XCJwYWRkaW5nOjQwcHg7dGV4dC1hbGlnbjpjZW50ZXI7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZClcIj5ObyBoYXkgU0tVcyBkZXNjb250aW51YWRvcy48YnI+PGJyPlBvZFx1MDBFOXMgZGVzY29udGludWFyIFNLVXMgZGVzZGUgZWwgYm90XHUwMEYzbiBcdUQ4M0RcdURERDEgZW4gY2FkYSBmaWxhIGRlIGxhIHRhYmxhIFJlY29tZW5kYWNpXHUwMEYzbiBkZSBDb21wcmEuPC9kaXY+J1xyXG4gICAgICA6ICc8ZGl2IHN0eWxlPVwiZGlzcGxheTpmbGV4O2ZsZXgtZGlyZWN0aW9uOmNvbHVtbjtnYXA6NnB4XCI+JyArXHJcbiAgICAgICAgbGlzdFxyXG4gICAgICAgICAgLm1hcCgoc2t1KSA9PiB7XHJcbiAgICAgICAgICAgIGNvbnN0IGRlc2MgPSBza3VUb0Rlc2Nbc2t1XSB8fCAnJztcclxuICAgICAgICAgICAgcmV0dXJuIChcclxuICAgICAgICAgICAgICAnPGRpdiBzdHlsZT1cImRpc3BsYXk6ZmxleDthbGlnbi1pdGVtczpjZW50ZXI7Z2FwOjEwcHg7cGFkZGluZzoxMHB4IDEycHg7YmFja2dyb3VuZDp2YXIoLS1iZy1zZWNvbmRhcnkpO2JvcmRlci1yYWRpdXM6NnB4XCI+JyArXHJcbiAgICAgICAgICAgICAgJzxkaXYgc3R5bGU9XCJmbGV4OjFcIj48ZGl2IHN0eWxlPVwiZm9udC1mYW1pbHk6bW9ub3NwYWNlO2ZvbnQtd2VpZ2h0OjcwMDtjb2xvcjp2YXIoLS10ZXh0LXByaW1hcnkpXCI+JyArXHJcbiAgICAgICAgICAgICAgZXNjYXBlSHRtbFNhZmUoc2t1KSArXHJcbiAgICAgICAgICAgICAgJzwvZGl2PicgK1xyXG4gICAgICAgICAgICAgIChkZXNjXHJcbiAgICAgICAgICAgICAgICA/ICc8ZGl2IHN0eWxlPVwiZm9udC1zaXplOjExcHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7bWFyZ2luLXRvcDoycHhcIj4nICtcclxuICAgICAgICAgICAgICAgICAgZXNjYXBlSHRtbFNhZmUoZGVzYykgK1xyXG4gICAgICAgICAgICAgICAgICAnPC9kaXY+J1xyXG4gICAgICAgICAgICAgICAgOiAnJykgK1xyXG4gICAgICAgICAgICAgICc8L2Rpdj4nICtcclxuICAgICAgICAgICAgICAnPGJ1dHRvbiBvbmNsaWNrPVwicmVhY3RpdmF0ZVNrdShcXCcnICtcclxuICAgICAgICAgICAgICBlc2NhcGVIdG1sU2FmZShza3UpICtcclxuICAgICAgICAgICAgICAnXFwnKVwiIHN0eWxlPVwicGFkZGluZzo2cHggMTJweDtiYWNrZ3JvdW5kOiMxNmEzNGE7Y29sb3I6I2ZmZjtib3JkZXI6bm9uZTtib3JkZXItcmFkaXVzOjRweDtmb250LXNpemU6MTFweDtmb250LXdlaWdodDo3MDA7Y3Vyc29yOnBvaW50ZXJcIj5cdTIxQkIgUmVhY3RpdmFyPC9idXR0b24+JyArXHJcbiAgICAgICAgICAgICAgJzwvZGl2PidcclxuICAgICAgICAgICAgKTtcclxuICAgICAgICAgIH0pXHJcbiAgICAgICAgICAuam9pbignJykgK1xyXG4gICAgICAgICc8L2Rpdj4nO1xyXG4gIGNvbnQuaW5uZXJIVE1MID0gaGVhZCArIGJvZHk7XHJcbn1cclxuXHJcbi8vIHYxMzU1ICgyMDI2LTEwLTE5KTogbW9kYWwgYnVsay1tYXJraW5nIFwiUHJveGltYXMgZGVzY29udGludWFjaW9uZXNcIi5cclxuLy8gTWFyaWFubyBwaWRpbyBwb2RlciBtYXJjYXIgdmFyaW9zIFNLVXMgYSBsYSB2ZXogKHZzIGZpbGEtcG9yLWZpbGEgY29uIFx1RDgzRFx1REREMSkuXHJcbi8vIExpc3RhIGNvbXBsZXRhIGRlIFNLVXMgZGVsIHNhbGVzIHBsYW4gYWN0dWFsIChyb2RzICsgcmVlbHMsIGRlZHVwZSkgY29uXHJcbi8vIGNoZWNrYm94IHByZS10aWxkYWRvIHNpIHlhIGVzdGFuIGVuIF9kaXNjb250aW51ZWRTa3VzLiBBbCBndWFyZGFyIHNpbmNyb25pemFcclxuLy8gZWwgU2V0IGNvbiBsbyB0aWxkYWRvIChhZ3JlZ2EgbG9zIG51ZXZvcywgc2FjYSBsb3MgZGVzdGlsZGFkb3MgZGUgbG9zIHF1ZVxyXG4vLyB2ZW1vcyBlbiBlbCBET00pLlxyXG4vLyBOT1RBIFhTUzogdXNhbW9zIGNyZWF0ZUVsZW1lbnQgKyB0ZXh0Q29udGVudCBwYXJhIHRvZG8gY29udGVuaWRvIHZhcmlhYmxlXHJcbi8vIChTS1UsIGRlc2NyaXBjaW9uLCB0ZXh0byBkZSBidXNxdWVkYSkuIElubmVyaHRtbCBzb2xvIGNvbiBzdHJpbmdzIGxpdGVyYWxlc1xyXG4vLyBjb250cm9sYWRvcyBwb3Igbm9zb3Ryb3MsIG51bmNhIGNvbiBkYXRvcyBkZWwgc2FsZXMgcGxhbi5cclxubGV0IF91cGNvbWluZ1NlYXJjaFRleHQgPSAnJztcclxuXHJcbmZ1bmN0aW9uIF9jb2xsZWN0QWxsU2t1c0Zyb21TYWxlc1BsYW4oKSB7XHJcbiAgY29uc3QgbWFwID0gbmV3IE1hcCgpO1xyXG4gIGZvciAoY29uc3QgZmFtIG9mIFsncm9kcycsICdyZWVscyddKSB7XHJcbiAgICBjb25zdCBjYWNoZSA9IF9zYWxlc1BsYW5DYWNoZXNbZmFtXTtcclxuICAgIGlmICghY2FjaGUgfHwgIUFycmF5LmlzQXJyYXkoY2FjaGUucm93cykpIGNvbnRpbnVlO1xyXG4gICAgZm9yIChjb25zdCByIG9mIGNhY2hlLnJvd3MpIHtcclxuICAgICAgY29uc3Qgc2t1ID0gU3RyaW5nKHIuc2t1IHx8ICcnKS50cmltKCk7XHJcbiAgICAgIGlmICghc2t1KSBjb250aW51ZTtcclxuICAgICAgY29uc3QgdXBwZXIgPSBza3UudG9VcHBlckNhc2UoKTtcclxuICAgICAgbWFwLnNldCh1cHBlciwge1xyXG4gICAgICAgIHNrdSxcclxuICAgICAgICBza3VVcHBlcjogdXBwZXIsXHJcbiAgICAgICAgZGVzY3JpcHRpb246IHIuZGVzY3JpcHRpb24gfHwgJycsXHJcbiAgICAgICAgZmFtaWxpYTogZmFtLFxyXG4gICAgICB9KTtcclxuICAgIH1cclxuICB9XHJcbiAgcmV0dXJuIEFycmF5LmZyb20obWFwLnZhbHVlcygpKS5zb3J0KChhLCBiKSA9PiBhLnNrdVVwcGVyLmxvY2FsZUNvbXBhcmUoYi5za3VVcHBlcikpO1xyXG59XHJcblxyXG5mdW5jdGlvbiBfbWFrZUVsKHRhZywgc3R5bGVTdHIsIHRleHRDb250ZW50KSB7XHJcbiAgY29uc3QgZWwgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KHRhZyk7XHJcbiAgaWYgKHN0eWxlU3RyKSBlbC5zdHlsZS5jc3NUZXh0ID0gc3R5bGVTdHI7XHJcbiAgaWYgKHRleHRDb250ZW50ICE9IG51bGwpIGVsLnRleHRDb250ZW50ID0gdGV4dENvbnRlbnQ7XHJcbiAgcmV0dXJuIGVsO1xyXG59XHJcblxyXG5mdW5jdGlvbiBfYnVpbGRVcGNvbWluZ1Jvdyhyb3csIGlzRGlzYykge1xyXG4gIGNvbnN0IGxhYmVsID0gX21ha2VFbChcclxuICAgICdsYWJlbCcsXHJcbiAgICAnZGlzcGxheTpmbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtnYXA6MTBweDtwYWRkaW5nOjhweCAxMHB4O2JhY2tncm91bmQ6JyArXHJcbiAgICAgIChpc0Rpc2MgPyAncmdiYSgxNDcsNTEsMjM0LC4wOCknIDogJ3ZhcigtLWJnLXNlY29uZGFyeSknKSArXHJcbiAgICAgICc7Ym9yZGVyLXJhZGl1czo1cHg7Y3Vyc29yOnBvaW50ZXI7dHJhbnNpdGlvbjpiYWNrZ3JvdW5kIC4xcydcclxuICApO1xyXG4gIGNvbnN0IGNiID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnaW5wdXQnKTtcclxuICBjYi50eXBlID0gJ2NoZWNrYm94JztcclxuICBjYi5zZXRBdHRyaWJ1dGUoJ2RhdGEtdXBjb21pbmctc2t1Jywgcm93LnNrdVVwcGVyKTtcclxuICBjYi5jaGVja2VkID0gISFpc0Rpc2M7XHJcbiAgY2Iuc3R5bGUuY3NzVGV4dCA9ICdtYXJnaW46MDtmbGV4LXNocmluazowO2N1cnNvcjpwb2ludGVyO3dpZHRoOjE2cHg7aGVpZ2h0OjE2cHgnO1xyXG4gIGxhYmVsLmFwcGVuZENoaWxkKGNiKTtcclxuICBjb25zdCBiYWRnZSA9IF9tYWtlRWwoXHJcbiAgICAnc3BhbicsXHJcbiAgICAnZGlzcGxheTppbmxpbmUtYmxvY2s7cGFkZGluZzoxcHggNnB4O2JvcmRlci1yYWRpdXM6OHB4O2JhY2tncm91bmQ6JyArXHJcbiAgICAgIChyb3cuZmFtaWxpYSA9PT0gJ3JvZHMnID8gJyMwZWE1ZTknIDogJyM4YjVjZjYnKSArXHJcbiAgICAgICc7Y29sb3I6I2ZmZjtmb250LXNpemU6OXB4O2ZvbnQtd2VpZ2h0OjcwMDttYXJnaW4tcmlnaHQ6NnB4JyxcclxuICAgIHJvdy5mYW1pbGlhID09PSAncm9kcycgPyAnUk9EJyA6ICdSRUVMJ1xyXG4gICk7XHJcbiAgbGFiZWwuYXBwZW5kQ2hpbGQoYmFkZ2UpO1xyXG4gIGNvbnN0IGNvbnRlbnQgPSBfbWFrZUVsKCdkaXYnLCAnZmxleDoxO21pbi13aWR0aDowJyk7XHJcbiAgY29udGVudC5hcHBlbmRDaGlsZChcclxuICAgIF9tYWtlRWwoXHJcbiAgICAgICdkaXYnLFxyXG4gICAgICAnZm9udC1mYW1pbHk6bW9ub3NwYWNlO2ZvbnQtd2VpZ2h0OjcwMDtjb2xvcjp2YXIoLS10ZXh0LXByaW1hcnkpO2ZvbnQtc2l6ZToxMnB4JyxcclxuICAgICAgcm93LnNrdVxyXG4gICAgKVxyXG4gICk7XHJcbiAgaWYgKHJvdy5kZXNjcmlwdGlvbikge1xyXG4gICAgY29udGVudC5hcHBlbmRDaGlsZChcclxuICAgICAgX21ha2VFbChcclxuICAgICAgICAnZGl2JyxcclxuICAgICAgICAnZm9udC1zaXplOjExcHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7bWFyZ2luLXRvcDoxcHg7b3ZlcmZsb3c6aGlkZGVuO3RleHQtb3ZlcmZsb3c6ZWxsaXBzaXM7d2hpdGUtc3BhY2U6bm93cmFwJyxcclxuICAgICAgICByb3cuZGVzY3JpcHRpb25cclxuICAgICAgKVxyXG4gICAgKTtcclxuICB9XHJcbiAgbGFiZWwuYXBwZW5kQ2hpbGQoY29udGVudCk7XHJcbiAgcmV0dXJuIGxhYmVsO1xyXG59XHJcblxyXG5mdW5jdGlvbiBfcmVuZGVyVXBjb21pbmdEaXNjb250aW51ZWRMaXN0T25seSgpIHtcclxuICBjb25zdCBsaXN0RWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgndXBjb21pbmctZGlzYy1saXN0Jyk7XHJcbiAgaWYgKCFsaXN0RWwpIHJldHVybjtcclxuICBjb25zdCBhbGwgPSBfY29sbGVjdEFsbFNrdXNGcm9tU2FsZXNQbGFuKCk7XHJcbiAgY29uc3QgcSA9IF91cGNvbWluZ1NlYXJjaFRleHQudG9Mb3dlckNhc2UoKTtcclxuICBjb25zdCBmaWx0ZXJlZCA9IHFcclxuICAgID8gYWxsLmZpbHRlcihcclxuICAgICAgICAocikgPT5cclxuICAgICAgICAgIHIuc2t1VXBwZXIudG9Mb3dlckNhc2UoKS5pbmNsdWRlcyhxKSB8fCAoci5kZXNjcmlwdGlvbiB8fCAnJykudG9Mb3dlckNhc2UoKS5pbmNsdWRlcyhxKVxyXG4gICAgICApXHJcbiAgICA6IGFsbDtcclxuICB3aGlsZSAobGlzdEVsLmZpcnN0Q2hpbGQpIGxpc3RFbC5yZW1vdmVDaGlsZChsaXN0RWwuZmlyc3RDaGlsZCk7XHJcbiAgaWYgKGZpbHRlcmVkLmxlbmd0aCA9PT0gMCkge1xyXG4gICAgY29uc3QgZW1wdHkgPSBfbWFrZUVsKFxyXG4gICAgICAnZGl2JyxcclxuICAgICAgJ3BhZGRpbmc6MzBweDt0ZXh0LWFsaWduOmNlbnRlcjtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKScsXHJcbiAgICAgIHFcclxuICAgICAgICA/ICdTaW4gcmVzdWx0YWRvcyBwYXJhIFwiJyArIF91cGNvbWluZ1NlYXJjaFRleHQgKyAnXCIuJ1xyXG4gICAgICAgIDogJ05vIGhheSBTS1VzIGNhcmdhZG9zIGVuIGVsIHNhbGVzIHBsYW4uJ1xyXG4gICAgKTtcclxuICAgIGxpc3RFbC5hcHBlbmRDaGlsZChlbXB0eSk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIGNvbnN0IHdyYXAgPSBfbWFrZUVsKCdkaXYnLCAnZGlzcGxheTpmbGV4O2ZsZXgtZGlyZWN0aW9uOmNvbHVtbjtnYXA6M3B4Jyk7XHJcbiAgY29uc3QgY3VycmVudFNldCA9IF9kaXNjb250aW51ZWRTa3VzIHx8IG5ldyBTZXQoKTtcclxuICBmb3IgKGNvbnN0IHIgb2YgZmlsdGVyZWQpIHtcclxuICAgIHdyYXAuYXBwZW5kQ2hpbGQoX2J1aWxkVXBjb21pbmdSb3cociwgY3VycmVudFNldC5oYXMoci5za3VVcHBlcikpKTtcclxuICB9XHJcbiAgbGlzdEVsLmFwcGVuZENoaWxkKHdyYXApO1xyXG59XHJcblxyXG53aW5kb3cub25VcGNvbWluZ1NlYXJjaENoYW5nZSA9IGZ1bmN0aW9uIChldikge1xyXG4gIF91cGNvbWluZ1NlYXJjaFRleHQgPSBTdHJpbmcoKGV2ICYmIGV2LnRhcmdldCAmJiBldi50YXJnZXQudmFsdWUpIHx8ICcnKS50cmltKCk7XHJcbiAgX3JlbmRlclVwY29taW5nRGlzY29udGludWVkTGlzdE9ubHkoKTtcclxufTtcclxuXHJcbmZ1bmN0aW9uIF9yZW5kZXJVcGNvbWluZ0Rpc2NvbnRpbnVlZE1vZGFsKCkge1xyXG4gIGNvbnN0IGNvbnQgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgndXBjb21pbmctZGlzYy1jb250ZW50Jyk7XHJcbiAgaWYgKCFjb250KSByZXR1cm47XHJcbiAgd2hpbGUgKGNvbnQuZmlyc3RDaGlsZCkgY29udC5yZW1vdmVDaGlsZChjb250LmZpcnN0Q2hpbGQpO1xyXG4gIGNvbnN0IGFsbCA9IF9jb2xsZWN0QWxsU2t1c0Zyb21TYWxlc1BsYW4oKTtcclxuICBjb25zdCBuRGlzY0N1cnJlbnQgPSBfZGlzY29udGludWVkU2t1cyA/IF9kaXNjb250aW51ZWRTa3VzLnNpemUgOiAwO1xyXG4gIC8vIEhlYWRlci5cclxuICBjb25zdCBoZWFkID0gX21ha2VFbChcclxuICAgICdkaXYnLFxyXG4gICAgJ2Rpc3BsYXk6ZmxleDtqdXN0aWZ5LWNvbnRlbnQ6c3BhY2UtYmV0d2VlbjthbGlnbi1pdGVtczpmbGV4LXN0YXJ0O2dhcDoxMnB4O21hcmdpbi1ib3R0b206MTRweDtmbGV4LXNocmluazowJ1xyXG4gICk7XHJcbiAgY29uc3QgaGVhZExlZnQgPSBfbWFrZUVsKCdkaXYnKTtcclxuICBoZWFkTGVmdC5hcHBlbmRDaGlsZChcclxuICAgIF9tYWtlRWwoXHJcbiAgICAgICdkaXYnLFxyXG4gICAgICAnZm9udC1zaXplOjE4cHg7Zm9udC13ZWlnaHQ6ODAwO2NvbG9yOnZhcigtLXRleHQtcHJpbWFyeSknLFxyXG4gICAgICAnUHJcdTAwRjN4aW1hcyBkZXNjb250aW51YWNpb25lcydcclxuICAgIClcclxuICApO1xyXG4gIGhlYWRMZWZ0LmFwcGVuZENoaWxkKFxyXG4gICAgX21ha2VFbChcclxuICAgICAgJ2RpdicsXHJcbiAgICAgICdmb250LXNpemU6MTFweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTttYXJnaW4tdG9wOjJweCcsXHJcbiAgICAgIGFsbC5sZW5ndGggK1xyXG4gICAgICAgICcgU0tVcyBlbiBlbCBzYWxlcyBwbGFuIGFjdHVhbCBcdTAwQjcgJyArXHJcbiAgICAgICAgbkRpc2NDdXJyZW50ICtcclxuICAgICAgICAnIHlhIGRlc2NvbnRpbnVhZG9zLiBNYXJjXHUwMEUxIGxvcyBxdWUgc2UgdmF5YW4gYSBkZXNjb250aW51YXIgZW4gbG9zIHByXHUwMEYzeGltb3MgbWVzZXMgXHUyMDE0IGVsIGZvcmVjYXN0IGxvcyB2YSBhIGRlc2VzdGltYXIgZW4gZWwgY1x1MDBFMWxjdWxvIGRlIFJlY29tZW5kYWNpXHUwMEYzbiBkZSBDb21wcmEuJ1xyXG4gICAgKVxyXG4gICk7XHJcbiAgaGVhZC5hcHBlbmRDaGlsZChoZWFkTGVmdCk7XHJcbiAgY29uc3QgY2xvc2VCdG4gPSBfbWFrZUVsKFxyXG4gICAgJ2J1dHRvbicsXHJcbiAgICAnYmFja2dyb3VuZDp0cmFuc3BhcmVudDtib3JkZXI6MXB4IHNvbGlkIHZhcigtLWJvcmRlci1zdWJ0bGUpO2JvcmRlci1yYWRpdXM6NnB4O3BhZGRpbmc6NnB4IDEycHg7Y3Vyc29yOnBvaW50ZXI7Zm9udC13ZWlnaHQ6NzAwO2ZsZXgtc2hyaW5rOjAnLFxyXG4gICAgJ1x1MjcxNSdcclxuICApO1xyXG4gIGNsb3NlQnRuLm9uY2xpY2sgPSAoKSA9PiB7XHJcbiAgICBjb25zdCBtID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3VwY29taW5nLWRpc2MtbW9kYWwnKTtcclxuICAgIGlmIChtKSBtLnJlbW92ZSgpO1xyXG4gIH07XHJcbiAgaGVhZC5hcHBlbmRDaGlsZChjbG9zZUJ0bik7XHJcbiAgY29udC5hcHBlbmRDaGlsZChoZWFkKTtcclxuICAvLyBTZWFyY2guXHJcbiAgY29uc3Qgc2VhcmNoSW5wID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnaW5wdXQnKTtcclxuICBzZWFyY2hJbnAudHlwZSA9ICd0ZXh0JztcclxuICBzZWFyY2hJbnAucGxhY2Vob2xkZXIgPSAnQnVzY2FyIFNLVSBvIGRlc2NyaXBjaVx1MDBGM24uLi4nO1xyXG4gIHNlYXJjaElucC52YWx1ZSA9IF91cGNvbWluZ1NlYXJjaFRleHQ7XHJcbiAgc2VhcmNoSW5wLm9uaW5wdXQgPSB3aW5kb3cub25VcGNvbWluZ1NlYXJjaENoYW5nZTtcclxuICBzZWFyY2hJbnAuc3R5bGUuY3NzVGV4dCA9XHJcbiAgICAnd2lkdGg6MTAwJTtwYWRkaW5nOjhweCAxMnB4O2JvcmRlcjoxcHggc29saWQgdmFyKC0tYm9yZGVyLXN1YnRsZSk7Ym9yZGVyLXJhZGl1czo2cHg7Zm9udC1zaXplOjEzcHg7YmFja2dyb3VuZDp2YXIoLS1iZy1lbGV2YXRlZCk7Y29sb3I6dmFyKC0tdGV4dC1wcmltYXJ5KTttYXJnaW4tYm90dG9tOjEwcHg7ZmxleC1zaHJpbms6MDtib3gtc2l6aW5nOmJvcmRlci1ib3gnO1xyXG4gIGNvbnQuYXBwZW5kQ2hpbGQoc2VhcmNoSW5wKTtcclxuICAvLyBMaXN0IGNvbnRhaW5lciAocG9ibGFkbyBwb3IgX3JlbmRlclVwY29taW5nRGlzY29udGludWVkTGlzdE9ubHkpLlxyXG4gIGNvbnN0IGxpc3QgPSBfbWFrZUVsKCdkaXYnLCAnZmxleDoxIDEgMDtvdmVyZmxvdy15OmF1dG87bWluLWhlaWdodDowJyk7XHJcbiAgbGlzdC5pZCA9ICd1cGNvbWluZy1kaXNjLWxpc3QnO1xyXG4gIGNvbnQuYXBwZW5kQ2hpbGQobGlzdCk7XHJcbiAgLy8gRm9vdGVyIGNvbiBib3RvbmVzLlxyXG4gIGNvbnN0IGZvb3QgPSBfbWFrZUVsKFxyXG4gICAgJ2RpdicsXHJcbiAgICAnZGlzcGxheTpmbGV4O2p1c3RpZnktY29udGVudDpzcGFjZS1iZXR3ZWVuO2FsaWduLWl0ZW1zOmNlbnRlcjtnYXA6MTBweDtwYWRkaW5nLXRvcDoxNHB4O2JvcmRlci10b3A6MXB4IHNvbGlkIHZhcigtLWJvcmRlci1zdWJ0bGUpO21hcmdpbi10b3A6MTJweDtmbGV4LXNocmluazowJ1xyXG4gICk7XHJcbiAgZm9vdC5hcHBlbmRDaGlsZChcclxuICAgIF9tYWtlRWwoXHJcbiAgICAgICdkaXYnLFxyXG4gICAgICAnZm9udC1zaXplOjExcHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCknLFxyXG4gICAgICAnU2UgZ3VhcmRhIGVuIGZvcmVjYXN0X2NvbmZpZy9kaXNjb250aW51ZWRfc2t1cy4gUmV2ZXJzaWJsZSBkZXNkZSBlbCBjaGlwIFx1RDgzRFx1REVBQiBkZXNjb250aW51YWRvcy4nXHJcbiAgICApXHJcbiAgKTtcclxuICBjb25zdCBidG5XcmFwID0gX21ha2VFbCgnZGl2JywgJ2Rpc3BsYXk6ZmxleDtnYXA6OHB4Jyk7XHJcbiAgY29uc3QgY2FuY2VsQnRuID0gX21ha2VFbChcclxuICAgICdidXR0b24nLFxyXG4gICAgJ3BhZGRpbmc6OHB4IDE0cHg7YmFja2dyb3VuZDp0cmFuc3BhcmVudDtib3JkZXI6MXB4IHNvbGlkIHZhcigtLWJvcmRlci1zdWJ0bGUpO2JvcmRlci1yYWRpdXM6NnB4O2N1cnNvcjpwb2ludGVyO2ZvbnQtd2VpZ2h0OjcwMDtjb2xvcjp2YXIoLS10ZXh0LXByaW1hcnkpJyxcclxuICAgICdDYW5jZWxhcidcclxuICApO1xyXG4gIGNhbmNlbEJ0bi5vbmNsaWNrID0gKCkgPT4ge1xyXG4gICAgY29uc3QgbSA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCd1cGNvbWluZy1kaXNjLW1vZGFsJyk7XHJcbiAgICBpZiAobSkgbS5yZW1vdmUoKTtcclxuICB9O1xyXG4gIGJ0bldyYXAuYXBwZW5kQ2hpbGQoY2FuY2VsQnRuKTtcclxuICBjb25zdCBzYXZlQnRuID0gX21ha2VFbChcclxuICAgICdidXR0b24nLFxyXG4gICAgJ3BhZGRpbmc6OHB4IDE2cHg7YmFja2dyb3VuZDojMjU2M2ViO2NvbG9yOiNmZmY7Ym9yZGVyOm5vbmU7Ym9yZGVyLXJhZGl1czo2cHg7Y3Vyc29yOnBvaW50ZXI7Zm9udC13ZWlnaHQ6NzAwJyxcclxuICAgICdHdWFyZGFyIGNhbWJpb3MnXHJcbiAgKTtcclxuICBzYXZlQnRuLmlkID0gJ3VwY29taW5nLXNhdmUtYnRuJztcclxuICBzYXZlQnRuLm9uY2xpY2sgPSB3aW5kb3cuc2F2ZVVwY29taW5nRGlzY29udGludWVkQ2hhbmdlcztcclxuICBidG5XcmFwLmFwcGVuZENoaWxkKHNhdmVCdG4pO1xyXG4gIGZvb3QuYXBwZW5kQ2hpbGQoYnRuV3JhcCk7XHJcbiAgY29udC5hcHBlbmRDaGlsZChmb290KTtcclxuICBfcmVuZGVyVXBjb21pbmdEaXNjb250aW51ZWRMaXN0T25seSgpO1xyXG59XHJcblxyXG53aW5kb3cub3BlblVwY29taW5nRGlzY29udGludWVkTW9kYWwgPSBmdW5jdGlvbiAoKSB7XHJcbiAgX3VwY29taW5nU2VhcmNoVGV4dCA9ICcnO1xyXG4gIGNvbnN0IGV4aXN0aW5nID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3VwY29taW5nLWRpc2MtbW9kYWwnKTtcclxuICBpZiAoZXhpc3RpbmcpIGV4aXN0aW5nLnJlbW92ZSgpO1xyXG4gIGNvbnN0IGVsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2Jyk7XHJcbiAgZWwuaWQgPSAndXBjb21pbmctZGlzYy1tb2RhbCc7XHJcbiAgZWwuc3R5bGUuY3NzVGV4dCA9XHJcbiAgICAncG9zaXRpb246Zml4ZWQ7aW5zZXQ6MDtiYWNrZ3JvdW5kOnJnYmEoMTUsMjMsNDIsLjY1KTt6LWluZGV4OjIxMDA7ZGlzcGxheTpmbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtqdXN0aWZ5LWNvbnRlbnQ6Y2VudGVyO3BhZGRpbmc6M3ZoJztcclxuICBlbC5vbmNsaWNrID0gKGV2KSA9PiB7XHJcbiAgICBpZiAoZXYudGFyZ2V0ID09PSBlbCkgZWwucmVtb3ZlKCk7XHJcbiAgfTtcclxuICBjb25zdCBjb250ZW50ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2Jyk7XHJcbiAgY29udGVudC5pZCA9ICd1cGNvbWluZy1kaXNjLWNvbnRlbnQnO1xyXG4gIGNvbnRlbnQuc3R5bGUuY3NzVGV4dCA9XHJcbiAgICAnYmFja2dyb3VuZDp2YXIoLS1iZy1lbGV2YXRlZCk7Ym9yZGVyLXJhZGl1czoxMnB4O3BhZGRpbmc6MjRweDttYXgtd2lkdGg6NzYwcHg7d2lkdGg6MTAwJTttYXgtaGVpZ2h0Ojkwdmg7b3ZlcmZsb3c6aGlkZGVuO2Rpc3BsYXk6ZmxleDtmbGV4LWRpcmVjdGlvbjpjb2x1bW47Ym94LXNoYWRvdzowIDIwcHggNjBweCByZ2JhKDAsMCwwLC40KSc7XHJcbiAgZWwuYXBwZW5kQ2hpbGQoY29udGVudCk7XHJcbiAgZG9jdW1lbnQuYm9keS5hcHBlbmRDaGlsZChlbCk7XHJcbiAgX3JlbmRlclVwY29taW5nRGlzY29udGludWVkTW9kYWwoKTtcclxufTtcclxuXHJcbndpbmRvdy5zYXZlVXBjb21pbmdEaXNjb250aW51ZWRDaGFuZ2VzID0gYXN5bmMgZnVuY3Rpb24gKCkge1xyXG4gIGNvbnN0IGJ0biA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCd1cGNvbWluZy1zYXZlLWJ0bicpO1xyXG4gIGlmIChidG4pIHtcclxuICAgIGJ0bi5kaXNhYmxlZCA9IHRydWU7XHJcbiAgICBidG4udGV4dENvbnRlbnQgPSAnR3VhcmRhbmRvXHUyMDI2JztcclxuICAgIGJ0bi5zdHlsZS5vcGFjaXR5ID0gJy42JztcclxuICB9XHJcbiAgLy8gSXRlcmFtb3MgVE9ET1MgbG9zIGNoZWNrYm94ZXMgZGVsIERPTSAobm8gc29sbyBsb3MgdmlzaWJsZXMgY29uIGVsIGZpbHRyb1xyXG4gIC8vIGRlIGJ1c3F1ZWRhKSwgcGFyYSBubyBwZXJkZXIgY2FtYmlvcyBoZWNob3MgYW50ZXMgZGUgZmlsdHJhci5cclxuICAvLyBSZWNvbnN0cnVpbW9zIGVsIFNldCBkZXNkZSBlbCBlc3RhZG8gYWN0dWFsIGRlbCBET006IGxvIHF1ZSBlc3RhIHRpbGRhZG8gcXVlZGEsXHJcbiAgLy8gbG8gZGVzdGlsZGFkbyBzZSBxdWl0YSAocGVybyBzb2xvIHBhcmEgU0tVcyBxdWUgdmVtb3MgZW4gZWwgRE9NIFx1MjAxNCBTS1VzXHJcbiAgLy8gZGVzY29udGludWFkb3MgcXVlIG5vIGVzdGFuIGVuIGVsIHNhbGVzIHBsYW4gYWN0dWFsIHNlIHByZXNlcnZhbiBjb21vIGVzdGFiYW4pLlxyXG4gIGNvbnN0IGFsbEluRG9tID0gZG9jdW1lbnQucXVlcnlTZWxlY3RvckFsbCgnW2RhdGEtdXBjb21pbmctc2t1XScpO1xyXG4gIGNvbnN0IHNlZW5JbkRvbSA9IG5ldyBTZXQoKTtcclxuICBjb25zdCBjaGVja2VkSW5Eb20gPSBuZXcgU2V0KCk7XHJcbiAgYWxsSW5Eb20uZm9yRWFjaCgoY2IpID0+IHtcclxuICAgIGNvbnN0IHNrdSA9IFN0cmluZyhjYi5nZXRBdHRyaWJ1dGUoJ2RhdGEtdXBjb21pbmctc2t1JykgfHwgJycpXHJcbiAgICAgIC50cmltKClcclxuICAgICAgLnRvVXBwZXJDYXNlKCk7XHJcbiAgICBpZiAoIXNrdSkgcmV0dXJuO1xyXG4gICAgc2VlbkluRG9tLmFkZChza3UpO1xyXG4gICAgaWYgKGNiLmNoZWNrZWQpIGNoZWNrZWRJbkRvbS5hZGQoc2t1KTtcclxuICB9KTtcclxuICBpZiAoIV9kaXNjb250aW51ZWRTa3VzKSBfZGlzY29udGludWVkU2t1cyA9IG5ldyBTZXQoKTtcclxuICBjb25zdCBwcmV2ID0gbmV3IFNldChfZGlzY29udGludWVkU2t1cyk7XHJcbiAgY2hlY2tlZEluRG9tLmZvckVhY2goKHNrdSkgPT4gX2Rpc2NvbnRpbnVlZFNrdXMuYWRkKHNrdSkpO1xyXG4gIHNlZW5JbkRvbS5mb3JFYWNoKChza3UpID0+IHtcclxuICAgIGlmICghY2hlY2tlZEluRG9tLmhhcyhza3UpKSBfZGlzY29udGludWVkU2t1cy5kZWxldGUoc2t1KTtcclxuICB9KTtcclxuICB0cnkge1xyXG4gICAgYXdhaXQgX3NhdmVEaXNjb250aW51ZWRTa3VzKCk7XHJcbiAgICBjb25zdCBtb2RhbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCd1cGNvbWluZy1kaXNjLW1vZGFsJyk7XHJcbiAgICBpZiAobW9kYWwpIG1vZGFsLnJlbW92ZSgpO1xyXG4gICAgX3JlbmRlclJlY29TZWN0aW9uKCk7XHJcbiAgfSBjYXRjaCAoZSkge1xyXG4gICAgX2Rpc2NvbnRpbnVlZFNrdXMgPSBwcmV2O1xyXG4gICAgaWYgKGJ0bikge1xyXG4gICAgICBidG4uZGlzYWJsZWQgPSBmYWxzZTtcclxuICAgICAgYnRuLnRleHRDb250ZW50ID0gJ0d1YXJkYXIgY2FtYmlvcyc7XHJcbiAgICAgIGJ0bi5zdHlsZS5vcGFjaXR5ID0gJzEnO1xyXG4gICAgfVxyXG4gICAgYWxlcnQoJ0Vycm9yIGd1YXJk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
