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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL3B1cmUvc2FsZXMtcGxhbi1wYXJzZXIuanMiLCAiLi4vc3JjL2RvbWFpbnMvZm9yZWNhc3QuanMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbIi8vIEB0cy1ub2NoZWNrXG4vLyBQdXJlOiBwYXJzZWEgdW4gc2hlZXQgU2FsZXMgUGxhbiAoZm9ybWF0byBTVVIvU0FSIGRlIFNoaW1hbm8pIGEgZXN0cnVjdHVyYVxuLy8gbm9ybWFsaXphZGEgeyBza3UsIGRlc2NyaXB0aW9uLCBtb3EsIG1vbnRoczogeydZWVlZLU1NJzogTn0gfS5cbi8vIFNpbiBkZXBlbmRlbmNpYXMgXHUyMDE0IHJlY2liZSBlbCBzaGVldCB5YSBkZXNlcmlhbGl6YWRvIHBvciBTaGVldEpTXG4vLyAoWExTWC51dGlscy5zaGVldF90b19qc29uKHNoZWV0LCB7aGVhZGVyOjEsIGRlZnZhbDonJ30pKS5cbi8vIFRlc3RlYWJsZSBlbiB2aXRlc3Qgc2luIGNhcmdhciBYTFNYLlxuLy9cbi8vIENvbnRleHRvOiBsb3MgU2FsZXMgUGxhbnMgZGUgU2hpbWFubyB2aWVuZW4gY29uIGhlYWRlcnMgY29tb1xuLy8gXCJTS1UgQ29kZS9QYXJ0IE5vXCIsIFwiRGVzY3JpcHRpb25cIiwgXCJNT1EgMTIgbW9udGhzXCIgeSBjb2x1bW5hcyBkZSBtZXNlc1xuLy8gdGlwbyBcIkphbiAyMDI3XCIsIFwiTWF5IDIwMjdcIiAoYSB2ZWNlcyBjb24gYVx1MDBGMW8gZW4gdW5hIGZpbGEgYXJyaWJhIHkgZWwgbWVzXG4vLyBlbiBsYSBmaWxhIGhlYWRlcikuIEVzdGEgZm4gdG9sZXJhIGFtYm9zIGxheW91dHMuXG5cbmNvbnN0IE1PTlRIX0FMSUFTRVMgPSB7XG4gIGphbjogMSxcbiAgamFudWFyeTogMSxcbiAgZW5lOiAxLFxuICBlbmVybzogMSxcbiAgZmViOiAyLFxuICBmZWJydWFyeTogMixcbiAgZmVicmVybzogMixcbiAgbWFyOiAzLFxuICBtYXJjaDogMyxcbiAgbWFyem86IDMsXG4gIGFwcjogNCxcbiAgYXByaWw6IDQsXG4gIGFicjogNCxcbiAgYWJyaWw6IDQsXG4gIG1heTogNSxcbiAgbWF5bzogNSxcbiAganVuOiA2LFxuICBqdW5lOiA2LFxuICBqdW5pbzogNixcbiAganVsOiA3LFxuICBqdWx5OiA3LFxuICBqdWxpbzogNyxcbiAgYXVnOiA4LFxuICBhdWd1c3Q6IDgsXG4gIGFnbzogOCxcbiAgYWdvc3RvOiA4LFxuICBzZXA6IDksXG4gIHNlcHQ6IDksXG4gIHNlcHRlbWJlcjogOSxcbiAgc2VwdGllbWJyZTogOSxcbiAgb2N0OiAxMCxcbiAgb2N0b2JlcjogMTAsXG4gIG9jdHVicmU6IDEwLFxuICBub3Y6IDExLFxuICBub3ZlbWJlcjogMTEsXG4gIG5vdmllbWJyZTogMTEsXG4gIGRlYzogMTIsXG4gIGRlY2VtYmVyOiAxMixcbiAgZGljOiAxMixcbiAgZGljaWVtYnJlOiAxMixcbn07XG5cbi8vIE5vcm1hbGl6YSBsYWJlbHMgZGUgbWVzZXMgYSAnWVlZWS1NTScuIFJldG9ybmEgbnVsbCBzaSBubyBtYXRjaGVhLlxuLy8gRm9ybWF0b3Mgc29wb3J0YWRvczogXCJKYW4gMjAyN1wiLCBcIkVuZS0yN1wiLCBcIkphbi8yMDI3XCIsIFwiTWF5MjdcIixcbi8vIFwiMjAyNy0wMVwiLCBcIjAxLzIwMjdcIiwgXCJKYW4uMjAyN1wiLCBcIjIwMjFcXG5KYW5cIiAobXVsdGktbGluZSBFeGNlbCkuXG5mdW5jdGlvbiBub3JtYWxpemVNb250aExhYmVsKGxhYmVsKSB7XG4gIGlmIChsYWJlbCA9PSBudWxsKSByZXR1cm4gbnVsbDtcbiAgLy8gdjExMDQ6IGNvbGFwc2FyIG5ld2xpbmVzL3RhYnMgYSBlc3BhY2lvIGFudGVzIGRlbCB0cmltLlxuICAvLyBFbCBmb3JtYXRvIEV4Y2VsIFwiMjAyMVxcbkphblwiIChhXHUwMEYxbyBlbiBMMSwgbWVzIGVuIEwyIGRlbnRybyBkZSB1bmEgY2VsZGFcbiAgLy8gbXVsdGktcm93KSBlcyBjb21cdTAwRkFuIGVuIFNhbGVzIFBsYW5zIFNVUi4gYFxccytgIG1hdGNoZWEgd2hpdGVzcGFjZSBpbmNsdXllbmRvXG4gIC8vIFxcbiB5IFxcclxcbi5cbiAgY29uc3QgcyA9IFN0cmluZyhsYWJlbCkucmVwbGFjZSgvXFxzKy9nLCAnICcpLnRyaW0oKS50b0xvd2VyQ2FzZSgpO1xuICBpZiAoIXMpIHJldHVybiBudWxsO1xuICBsZXQgbTtcbiAgLy8gXCJqYW4gMjAyN1wiIHwgXCJqYW4tMjdcIiB8IFwiZW5lLzIwMjdcIiB8IFwibWF5MjdcIiB8IFwibWF5LjIwMjdcIlxuICBtID0gcy5tYXRjaCgvXihbYS16XHUwMEUxXHUwMEU5XHUwMEVEXHUwMEYzXHUwMEZBXXszLDEwfSlbXFxzXFwtLy5fXSooXFxkezIsNH0pJC8pO1xuICBpZiAobSkge1xuICAgIGNvbnN0IG1vbiA9IE1PTlRIX0FMSUFTRVNbbVsxXV0gfHwgTU9OVEhfQUxJQVNFU1ttWzFdLnNsaWNlKDAsIDMpXTtcbiAgICBpZiAobW9uKSB7XG4gICAgICBsZXQgeSA9IHBhcnNlSW50KG1bMl0sIDEwKTtcbiAgICAgIGlmICh5IDwgMTAwKSB5ID0gMjAwMCArIHk7XG4gICAgICByZXR1cm4gU3RyaW5nKHkpLnBhZFN0YXJ0KDQsICcwJykgKyAnLScgKyBTdHJpbmcobW9uKS5wYWRTdGFydCgyLCAnMCcpO1xuICAgIH1cbiAgfVxuICAvLyBcIjIwMjEgamFuXCIgfCBcIjIwMjcgZGljXCIgKGFcdTAwRjFvIHByaW1lcm8gKyBtZXMsIGZvcm1hdG8gRXhjZWwgbXVsdGktbGluZVxuICAvLyBjb2xhcHNhZG8gdHJhcyByZXBsYWNlIFxccyspLlxuICBtID0gcy5tYXRjaCgvXihcXGR7NH0pW1xcc1xcLS8uX10rKFthLXpcdTAwRTFcdTAwRTlcdTAwRURcdTAwRjNcdTAwRkFdezMsMTB9KSQvKTtcbiAgaWYgKG0pIHtcbiAgICBjb25zdCB5ID0gcGFyc2VJbnQobVsxXSwgMTApO1xuICAgIGNvbnN0IG1vbiA9IE1PTlRIX0FMSUFTRVNbbVsyXV0gfHwgTU9OVEhfQUxJQVNFU1ttWzJdLnNsaWNlKDAsIDMpXTtcbiAgICBpZiAobW9uKSByZXR1cm4gU3RyaW5nKHkpLnBhZFN0YXJ0KDQsICcwJykgKyAnLScgKyBTdHJpbmcobW9uKS5wYWRTdGFydCgyLCAnMCcpO1xuICB9XG4gIC8vIFwiMjAyNy0wMVwiIHwgXCIyMDI3LzAxXCJcbiAgbSA9IHMubWF0Y2goL14oXFxkezR9KVstL10oXFxkezEsMn0pJC8pO1xuICBpZiAobSkge1xuICAgIGNvbnN0IHkgPSBwYXJzZUludChtWzFdLCAxMCk7XG4gICAgY29uc3QgbW9uID0gcGFyc2VJbnQobVsyXSwgMTApO1xuICAgIGlmIChtb24gPj0gMSAmJiBtb24gPD0gMTIpXG4gICAgICByZXR1cm4gU3RyaW5nKHkpLnBhZFN0YXJ0KDQsICcwJykgKyAnLScgKyBTdHJpbmcobW9uKS5wYWRTdGFydCgyLCAnMCcpO1xuICB9XG4gIC8vIFwiMDEvMjAyN1wiIHwgXCIwMS0yMDI3XCJcbiAgbSA9IHMubWF0Y2goL14oXFxkezEsMn0pWy0vXShcXGR7NH0pJC8pO1xuICBpZiAobSkge1xuICAgIGNvbnN0IG1vbiA9IHBhcnNlSW50KG1bMV0sIDEwKTtcbiAgICBjb25zdCB5ID0gcGFyc2VJbnQobVsyXSwgMTApO1xuICAgIGlmIChtb24gPj0gMSAmJiBtb24gPD0gMTIpXG4gICAgICByZXR1cm4gU3RyaW5nKHkpLnBhZFN0YXJ0KDQsICcwJykgKyAnLScgKyBTdHJpbmcobW9uKS5wYWRTdGFydCgyLCAnMCcpO1xuICB9XG4gIHJldHVybiBudWxsO1xufVxuXG4vLyBCdXNjYSBsYSBmaWxhIGhlYWRlciAoMC1iYXNlZCkuIEVzY2FuZWEgbGFzIHByaW1lcmFzIDMwIGZpbGFzLlxuZnVuY3Rpb24gZmluZEhlYWRlclJvdyhyb3dzKSB7XG4gIGNvbnN0IEhFQURFUl9NQVJLRVJTID0gW1xuICAgICdza3UgY29kZS9wYXJ0IG5vJyxcbiAgICAnc2t1IGNvZGUnLFxuICAgICdza3UnLFxuICAgICdwYXJ0IG5vJyxcbiAgICAncGFydCBudW1iZXInLFxuICAgICdpdGVtY29kZScsXG4gICAgJ2l0ZW0gY29kZScsXG4gICAgJ2NvZGlnbycsXG4gICAgJ2NcdTAwRjNkaWdvJyxcbiAgXTtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBNYXRoLm1pbihyb3dzLmxlbmd0aCwgMzApOyBpKyspIHtcbiAgICBjb25zdCByb3cgPSByb3dzW2ldIHx8IFtdO1xuICAgIGZvciAoY29uc3QgY2VsbCBvZiByb3cpIHtcbiAgICAgIC8vIHYxMTA0OiBjb2xhcHNhciBuZXdsaW5lcyBhIGVzcGFjaW8gcGFyYSBtYXRjaGVhciBoZWFkZXJzIGNvbW9cbiAgICAgIC8vIFwiU0tVIENvZGUvUGFydCBOb1wiIChvaykgbyBcIlNLVVxcbkNvZGVcIiAobmVjZXNpdGEgY29sYXBzYXIpLlxuICAgICAgY29uc3QgcyA9IFN0cmluZyhjZWxsID09IG51bGwgPyAnJyA6IGNlbGwpXG4gICAgICAgIC5yZXBsYWNlKC9cXHMrL2csICcgJylcbiAgICAgICAgLnRyaW0oKVxuICAgICAgICAudG9Mb3dlckNhc2UoKTtcbiAgICAgIGlmIChIRUFERVJfTUFSS0VSUy5pbmRleE9mKHMpID49IDApIHJldHVybiBpO1xuICAgIH1cbiAgfVxuICByZXR1cm4gLTE7XG59XG5cbi8vIERldGVjdGEgXHUwMEVEbmRpY2VzIGRlIGNvbHVtbmFzIHkgbWVzZXMuIGBoaW50Um93QWJvdmVgIHBlcm1pdGUgY29tYmluYXIgYVx1MDBGMW8vbWVzXG4vLyBjdWFuZG8gZWwgaGVhZGVyIGVzIG11bHRpLXJvdyAoYVx1MDBGMW8gYXJyaWJhLCBtZXMgYWJham8gbyB2aWNldmVyc2EpLlxuZnVuY3Rpb24gZGV0ZWN0Q29sdW1ucyhoZWFkZXJSb3csIGhpbnRSb3dBYm92ZSkge1xuICBsZXQgc2t1SWR4ID0gLTE7XG4gIGxldCBkZXNjSWR4ID0gLTE7XG4gIGxldCBtb3FJZHggPSAtMTtcbiAgY29uc3QgbW9udGhDb2x1bW5zID0gW107XG4gIGNvbnN0IGRldGVjdGVkTW9udGhzU2V0ID0gbmV3IFNldCgpO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IGhlYWRlclJvdy5sZW5ndGg7IGkrKykge1xuICAgIC8vIHYxMTA0OiBjb2xhcHNhciBuZXdsaW5lcyBhIGVzcGFjaW8gYW50ZXMgZGUgY29tcGFyYXIuIExvcyBTYWxlcyBQbGFuXG4gICAgLy8gU1VSIHRpZW5lbiBoZWFkZXJzIG11bHRpLWxpbmUgY29tbyBcIk1PUVxcbjEyIG1vbnRoc1wiIG8gXCJCYXNlXFxuRk9CKFVTRClcIi5cbiAgICBjb25zdCByYXcgPSBTdHJpbmcoaGVhZGVyUm93W2ldID09IG51bGwgPyAnJyA6IGhlYWRlclJvd1tpXSlcbiAgICAgIC5yZXBsYWNlKC9cXHMrL2csICcgJylcbiAgICAgIC50cmltKCk7XG4gICAgY29uc3QgcyA9IHJhdy50b0xvd2VyQ2FzZSgpO1xuICAgIGlmIChcbiAgICAgIHNrdUlkeCA8IDAgJiZcbiAgICAgIChzID09PSAnc2t1IGNvZGUvcGFydCBubycgfHxcbiAgICAgICAgcyA9PT0gJ3NrdSBjb2RlJyB8fFxuICAgICAgICBzID09PSAnc2t1JyB8fFxuICAgICAgICBzID09PSAncGFydCBubycgfHxcbiAgICAgICAgcyA9PT0gJ3BhcnQgbnVtYmVyJyB8fFxuICAgICAgICBzID09PSAnaXRlbWNvZGUnIHx8XG4gICAgICAgIHMgPT09ICdpdGVtIGNvZGUnIHx8XG4gICAgICAgIHMgPT09ICdjb2RpZ28nIHx8XG4gICAgICAgIHMgPT09ICdjXHUwMEYzZGlnbycpXG4gICAgKSB7XG4gICAgICBza3VJZHggPSBpO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChcbiAgICAgIGRlc2NJZHggPCAwICYmXG4gICAgICAocyA9PT0gJ2Rlc2NyaXB0aW9uJyB8fFxuICAgICAgICBzID09PSAnZGVzY3JpcGNpb24nIHx8XG4gICAgICAgIHMgPT09ICdkZXNjcmlwY2lcdTAwRjNuJyB8fFxuICAgICAgICBzID09PSAnaXRlbSBuYW1lJyB8fFxuICAgICAgICBzID09PSAnaXRlbW5hbWUnKVxuICAgICkge1xuICAgICAgZGVzY0lkeCA9IGk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKG1vcUlkeCA8IDAgJiYgKHMgPT09ICdtb3EgMTIgbW9udGhzJyB8fCBzID09PSAnbW9xJyB8fCBzLmluZGV4T2YoJ21vcScpID09PSAwKSkge1xuICAgICAgbW9xSWR4ID0gaTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICAvLyBUcnkgZGlyZWN0IG1vbnRoIHBhcnNlXG4gICAgbGV0IG1vbnRoS2V5ID0gbm9ybWFsaXplTW9udGhMYWJlbChyYXcpO1xuICAgIGlmICghbW9udGhLZXkgJiYgaGludFJvd0Fib3ZlICYmIGhpbnRSb3dBYm92ZVtpXSAhPSBudWxsKSB7XG4gICAgICBjb25zdCBoaW50ID0gU3RyaW5nKGhpbnRSb3dBYm92ZVtpXSkudHJpbSgpO1xuICAgICAgaWYgKGhpbnQpIHtcbiAgICAgICAgbW9udGhLZXkgPSBub3JtYWxpemVNb250aExhYmVsKHJhdyArICcgJyArIGhpbnQpIHx8IG5vcm1hbGl6ZU1vbnRoTGFiZWwoaGludCArICcgJyArIHJhdyk7XG4gICAgICB9XG4gICAgfVxuICAgIGlmIChtb250aEtleSkge1xuICAgICAgbW9udGhDb2x1bW5zLnB1c2goeyBjb2xJZHg6IGksIG1vbnRoS2V5IH0pO1xuICAgICAgZGV0ZWN0ZWRNb250aHNTZXQuYWRkKG1vbnRoS2V5KTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHtcbiAgICBza3VJZHgsXG4gICAgZGVzY0lkeCxcbiAgICBtb3FJZHgsXG4gICAgbW9udGhDb2x1bW5zLFxuICAgIGRldGVjdGVkTW9udGhzOiBBcnJheS5mcm9tKGRldGVjdGVkTW9udGhzU2V0KS5zb3J0KCksXG4gIH07XG59XG5cbi8vIFB1YmxpYzogcGFyc2UgZnVsbCBzaGVldC4gVGhyb3dzIG9uIG1pc3NpbmcgU0tVIGNvbHVtbiAvIG1vbnRocy5cbmZ1bmN0aW9uIHBhcnNlU2FsZXNQbGFuU2hlZXQocm93cykge1xuICBpZiAoIXJvd3MgfHwgIXJvd3MubGVuZ3RoKSB7XG4gICAgY29uc3QgZXJyID0gbmV3IEVycm9yKCdFeGNlbCB2YWNpbycpO1xuICAgIGVyci5jb2RlID0gJ0VNUFRZX1NIRUVUJztcbiAgICB0aHJvdyBlcnI7XG4gIH1cbiAgY29uc3QgaGVhZGVySWR4ID0gZmluZEhlYWRlclJvdyhyb3dzKTtcbiAgaWYgKGhlYWRlcklkeCA8IDApIHtcbiAgICBjb25zdCBlcnIgPSBuZXcgRXJyb3IoJ05vIHNlIGVuY29udHJvIGZpbGEgZGUgaGVhZGVycyAoYnVzY2FiYSBcIlNLVSBDb2RlL1BhcnQgTm9cIiBvIFwiU0tVXCIpJyk7XG4gICAgZXJyLmNvZGUgPSAnSEVBREVSX05PVF9GT1VORCc7XG4gICAgdGhyb3cgZXJyO1xuICB9XG4gIGNvbnN0IGhlYWRlclJvdyA9IHJvd3NbaGVhZGVySWR4XSB8fCBbXTtcbiAgY29uc3Qgcm93QWJvdmUgPSBoZWFkZXJJZHggPiAwID8gcm93c1toZWFkZXJJZHggLSAxXSB8fCBbXSA6IG51bGw7XG4gIGNvbnN0IGNvbHMgPSBkZXRlY3RDb2x1bW5zKGhlYWRlclJvdywgcm93QWJvdmUpO1xuICBpZiAoY29scy5za3VJZHggPCAwKSB7XG4gICAgY29uc3QgZXJyID0gbmV3IEVycm9yKCdObyBzZSBlbmNvbnRybyBjb2x1bW5hIFNLVSBlbiBsYSBmaWxhIGhlYWRlcicpO1xuICAgIGVyci5jb2RlID0gJ1NLVV9DT0xfTUlTU0lORyc7XG4gICAgdGhyb3cgZXJyO1xuICB9XG4gIGlmICghY29scy5tb250aENvbHVtbnMubGVuZ3RoKSB7XG4gICAgY29uc3QgZXJyID0gbmV3IEVycm9yKFxuICAgICAgJ05vIHNlIGRldGVjdGFyb24gY29sdW1uYXMgZGUgbWVzZXMgZW4gZWwgaGVhZGVyIChlajogXCJKYW4gMjAyN1wiLCBcIk1heSAyMDI3XCIpJ1xuICAgICk7XG4gICAgZXJyLmNvZGUgPSAnTU9OVEhTX05PVF9GT1VORCc7XG4gICAgdGhyb3cgZXJyO1xuICB9XG4gIGNvbnN0IHBhcnNlZFJvd3MgPSBbXTtcbiAgY29uc3Qgc2VlblNrdSA9IG5ldyBTZXQoKTtcbiAgZm9yIChsZXQgciA9IGhlYWRlcklkeCArIDE7IHIgPCByb3dzLmxlbmd0aDsgcisrKSB7XG4gICAgY29uc3Qgcm93ID0gcm93c1tyXSB8fCBbXTtcbiAgICBjb25zdCBza3VSYXcgPSByb3dbY29scy5za3VJZHhdO1xuICAgIGlmIChza3VSYXcgPT0gbnVsbCB8fCBTdHJpbmcoc2t1UmF3KS50cmltKCkgPT09ICcnKSBjb250aW51ZTtcbiAgICBjb25zdCBza3UgPSBTdHJpbmcoc2t1UmF3KS50cmltKCk7XG4gICAgY29uc3QgdXBwZXIgPSBza3UudG9VcHBlckNhc2UoKTtcbiAgICAvLyBTa2lwIGZpbGFzIFRPVEFMIC8gU1VNIC8gU1VCVE9UQUxcbiAgICBpZiAodXBwZXIgPT09ICdUT1RBTCcgfHwgdXBwZXIgPT09ICdTVU0nIHx8IHVwcGVyID09PSAnU1VCVE9UQUwnIHx8IHVwcGVyID09PSAnVE9UQUxFUycpXG4gICAgICBjb250aW51ZTtcbiAgICBpZiAoc2VlblNrdS5oYXModXBwZXIpKSBjb250aW51ZTsgLy8gZGVkdXBlXG4gICAgc2VlblNrdS5hZGQodXBwZXIpO1xuICAgIGNvbnN0IGRlc2NyaXB0aW9uID1cbiAgICAgIGNvbHMuZGVzY0lkeCA+PSAwID8gU3RyaW5nKHJvd1tjb2xzLmRlc2NJZHhdID09IG51bGwgPyAnJyA6IHJvd1tjb2xzLmRlc2NJZHhdKS50cmltKCkgOiAnJztcbiAgICBjb25zdCBtb3FSYXcgPSBjb2xzLm1vcUlkeCA+PSAwID8gcm93W2NvbHMubW9xSWR4XSA6IG51bGw7XG4gICAgY29uc3QgbW9xTnVtID0gTnVtYmVyKG1vcVJhdyk7XG4gICAgY29uc3QgbW9xID0gTnVtYmVyLmlzRmluaXRlKG1vcU51bSkgJiYgbW9xTnVtID4gMCA/IE1hdGgucm91bmQobW9xTnVtKSA6IDA7XG4gICAgY29uc3QgbW9udGhzID0ge307XG4gICAgZm9yIChjb25zdCBtYyBvZiBjb2xzLm1vbnRoQ29sdW1ucykge1xuICAgICAgY29uc3QgdiA9IHJvd1ttYy5jb2xJZHhdO1xuICAgICAgY29uc3QgbiA9IE51bWJlcih2KTtcbiAgICAgIGlmIChOdW1iZXIuaXNGaW5pdGUobikgJiYgbiA+IDApIHtcbiAgICAgICAgbW9udGhzW21jLm1vbnRoS2V5XSA9IE1hdGgucm91bmQobik7XG4gICAgICB9XG4gICAgfVxuICAgIHBhcnNlZFJvd3MucHVzaCh7IHNrdSwgZGVzY3JpcHRpb24sIG1vcSwgbW9udGhzIH0pO1xuICB9XG4gIHJldHVybiB7XG4gICAgaGVhZGVyUm93SW5kZXg6IGhlYWRlcklkeCxcbiAgICBkZXRlY3RlZE1vbnRoczogY29scy5kZXRlY3RlZE1vbnRocyxcbiAgICByb3dzQ291bnQ6IHBhcnNlZFJvd3MubGVuZ3RoLFxuICAgIHJvd3M6IHBhcnNlZFJvd3MsXG4gIH07XG59XG5cbi8vIFVNRC1pc2ggZXhwb3J0OiBwYXJhIHZpdGVzdCAobW9kdWxlLmV4cG9ydHMpIHkgcGFyYSBidW5kbGUgYnJvd3NlciAod2luZG93IGdsb2JhbCkuXG5pZiAodHlwZW9mIG1vZHVsZSAhPT0gJ3VuZGVmaW5lZCcgJiYgbW9kdWxlLmV4cG9ydHMpIHtcbiAgbW9kdWxlLmV4cG9ydHMgPSB7IHBhcnNlU2FsZXNQbGFuU2hlZXQsIG5vcm1hbGl6ZU1vbnRoTGFiZWwsIGZpbmRIZWFkZXJSb3csIGRldGVjdENvbHVtbnMgfTtcbn1cbmlmICh0eXBlb2Ygd2luZG93ICE9PSAndW5kZWZpbmVkJykge1xuICB3aW5kb3cuU2FsZXNQbGFuUGFyc2VyID0ge1xuICAgIHBhcnNlU2FsZXNQbGFuU2hlZXQsXG4gICAgbm9ybWFsaXplTW9udGhMYWJlbCxcbiAgICBmaW5kSGVhZGVyUm93LFxuICAgIGRldGVjdENvbHVtbnMsXG4gIH07XG59XG5cbmV4cG9ydCB7IGRldGVjdENvbHVtbnMsIGZpbmRIZWFkZXJSb3csIG5vcm1hbGl6ZU1vbnRoTGFiZWwsIHBhcnNlU2FsZXNQbGFuU2hlZXQgfTtcbiIsICIvLyBAdHMtbm9jaGVja1xuLy8gdjEwOTgrIEZhc2UgMTogaW1wb3J0IGRlbCBwYXJzZXIgcHVyby4gRWwgbVx1MDBGM2R1bG8gaGFjZSBgd2luZG93LlNhbGVzUGxhblBhcnNlcmBcbi8vIGNvbW8gc2lkZS1lZmZlY3QgeSB0YW1iaVx1MDBFOW4gZXhwb3J0YSBsYXMgZm5zIG5vbWJyYWRhczsgdXNhbW9zIHNpZGUtZWZmZWN0XG4vLyBwb3JxdWUgZm9yZWNhc3QuanMgY29ycmUgZW4gZWwgY2h1bmsgbGF6eSB5IHdpbmRvdyB5YSBlc3RcdTAwRTEgZGlzcG9uaWJsZS5cbmltcG9ydCAnLi4vcHVyZS9zYWxlcy1wbGFuLXBhcnNlci5qcyc7XG5cbi8vIEdsb2JhbHMgbGVpZG9zIGRlbCBlbnRvcm5vIChkZWNsYXJhZG9zIGVuIGluZGV4Lmh0bWwgaW5saW5lIG8gYnVuZGxlIHByZXZpbyk6XG4vLyBmYkRiLCBjdXJyZW50VXNlciwgWExTWCAoY2RuKSwgZXNjYXBlSHRtbC4gTWlzbW8gcGF0cm9uIHF1ZSBvdHJvcyBkb21pbmlvcy5cbi8vXG4vLyBGT1JFQ0FTVCAtIG1vZGFsIGFkbWluLW9ubHkgKE1hcmlhbm8pLiBDaHVuayBsYXp5OiBzZSBjYXJnYSBzb2xvIGFsIHByaW1lclxuLy8gY2xpY2sgZGVsIGJvdG9uIEZPUkVDQVNUIGRlbCBoZWFkZXIuIFJlZ2lzdHJhZG8gZW4gYnVpbGQuanMgTEFaWV9DSFVOS1MgK1xuLy8gc3JjL21haW4uanMgaW5zdGFsbENodW5rU3R1YnMgKyBzdy5qcyBTVEFUSUNfQVNTRVRTLiBWZXIgQ0xBVURFLm1kICMxOC5cbi8vXG4vLyB2MTExMSBjbGVhbjogcGlwZWxpbmUgbGVnYWN5IChTS1UgKyA2IGNvbHVtbmFzICsgcG9saXRpY2EgM20pIHJlbW92aWRvLlxuLy8gUmVlbXBsYXphZG8gcG9yOlxuLy8gICAtIEZhc2UgMSAodjEwOTgpOiBTYWxlcyBQbGFucyBtZW5zdWFsZXMgUm9kcy9SZWVscyBjb24gZm9ybWF0byBTVVIuXG4vLyAgIC0gRmFzZSAyQiAodjExMDMpOiBGb3JlY2FzdCBFc3RhZGlzdGljbyAoc3RhdHNmb3JlY2FzdCBwaXBlbGluZSBvZmZsaW5lKS5cbi8vICAgLSBGYXNlIDNBICh2MTEwOSk6IFRhYmxhIFJlY29tZW5kYWNpb24gZGUgQ29tcHJhLlxuXG4vLyB2MTA5OCsgKEZhc2UgMSBGb3JlY2FzdCB2Mik6IFNhbGVzIFBsYW5zIG1lbnN1YWxlcyBwb3IgZmFtaWxpYSAoUm9kcy9SZWVscy9GRykuXG4vLyBTZSBndWFyZGFuIGVuIEZpcmVzdG9yZSBgc2FsZXNfcGxhbl9jYWNoZS97ZmFtaWxpYX1gICsgc25hcHNob3QgRXhjZWwgb3JpZ2luYWxcbi8vIGVuIFN0b3JhZ2UgYGZvcmVjYXN0c19zbmFwc2hvdHMve1lZWVktTU19L3tmYW1pbGlhfS54bHN4YC5cbi8vIEVsIHBhcnNlciBwdXJvIHZpdmUgZW4gc3JjL3B1cmUvc2FsZXMtcGxhbi1wYXJzZXIuanMgKGF0dGFjaCBhIHdpbmRvdy5TYWxlc1BsYW5QYXJzZXIpLlxuLy8gdjExMDg6IEZHIHJlbW92aWRvIGRlbCBVSSAoTWFyaWFubyBwaWRpXHUwMEYzKS4gU29sbyBSb2RzICsgUmVlbHMgcG9yIGFob3JhLlxuLy8gTGEgcnVsZSBGaXJlc3RvcmUgc2lndWUgYWNlcHRhbmRvICdmZycgcG9yIHNpIGVuIGVsIGZ1dHVybyBzZSB2dWVsdmUgYVxuLy8gYWN0aXZhciBcdTIwMTQgbm8gYm9ycmFybGEgZW4gc3RvcmFnZS9maXJlc3RvcmUucnVsZXMgaGFzdGEgY29uZmlybWFyIGRlcHJlY2F0ZS5cbmNvbnN0IFNBTEVTX1BMQU5fRkFNSUxJQVMgPSBbXG4gIHsga2V5OiAncm9kcycsIGxhYmVsOiAnUm9kcyAoQ2FcdTAwRjFhcyknLCBjb2xvcjogJyMwZWE1ZTknIH0sXG4gIHsga2V5OiAncmVlbHMnLCBsYWJlbDogJ1JlZWxzJywgY29sb3I6ICcjOGI1Y2Y2JyB9LFxuXTtcbmNvbnN0IF9zYWxlc1BsYW5DYWNoZXMgPSB7IHJvZHM6IG51bGwsIHJlZWxzOiBudWxsIH07IC8vIGxhc3QgbG9hZGVkIGRvY1xubGV0IF9mb3JlY2FzdEFjdGl2ZVRhYiA9ICdzYWxlcy1wbGFucyc7IC8vICdzYWxlcy1wbGFucycgfCAnc3RhdCcgfCAnbGVnYWN5J1xuXG4vLyB2MTEwMysgKEZhc2UgMkIpOiBGb3JlY2FzdCBFc3RhZFx1MDBFRHN0aWNvIFx1MjAxNCBvdXRwdXQgcHVibGljYWRvIHBvclxuLy8gc2NyaXB0cy9mb3JlY2FzdC9wdWJsaXNoX3RvX2ZpcmVzdG9yZS5weSBhIGZvcmVjYXN0X291dHB1dC97c3ViX3NsdWd9XG4vLyArIGZvcmVjYXN0X291dHB1dF9tZXRhL2N1cnJlbnQuIDI0IHN1YnMgKyAxIG1ldGEgZG9jLlxubGV0IF9mb3JlY2FzdFN0YXREb2NzID0gbnVsbDsgLy8gW3tpZCwgc3ViZmFtaWxpYSwgZm9yZWNhc3RbN10sIG1ldHJpY3MsIGJlc3RNb2RlbCwgdmVyc2lvbklkfV1cbmxldCBfZm9yZWNhc3RTdGF0TWV0YSA9IG51bGw7IC8vIHtnZW5lcmF0ZWRBdCwgdmVyc2lvbklkLCByZXN1bWVuOiB7Li4ufX1cbmxldCBfZm9yZWNhc3RTdGF0SGlzdG9yeUNhY2hlID0gbnVsbDsgLy8geyBbc3ViXTogW3tkcywgeX1dIH0gY2FjaGUgbGF6eSBvbi1kZW1hbmRcblxuLy8gdjExMDkrIChGYXNlIDNBKTogVGFibGEgUmVjb21lbmRhY2lcdTAwRjNuIGRlIENvbXByYSBcdTIwMTQgY29tYmluYSBzYWxlcyBwbGFucyArXG4vLyBzdG9ja19zbmFwc2hvdCArIHNrdV92ZW50YXNfc25hcHNob3QgcGFyYSBjb21wdXRhciByZWNvbWVuZGFkbyBwb3IgU0tVLlxubGV0IF9yZWNvU3RvY2tTbmFwc2hvdCA9IG51bGw7IC8vIHt3YXJlaG91c2VCcmVha2Rvd246IHtza3U6eycxMSc6biwnMTInOm4sLi4ufX0sIGJhY2tvcmRlckJ5U2t1OiB7c2t1Om59fVxubGV0IF9yZWNvVmVudGFzU25hcHNob3QgPSBudWxsOyAvLyB7IFtTS1UgdXBwZXJdOiB7bWVzZXM6IHsnWVlZWS1NTSc6IHtxdHksYXJzfX19IH1cbmxldCBfcmVjb0ZpbHRlck1pblJlYyA9IHRydWU7IC8vIFwic29sbyBtb3N0cmFyIFNLVXMgY29uIHJlY29tZW5kYWRvID4gMFwiXG5sZXQgX3JlY29GaWx0ZXJGYW1pbGlhID0gJ2FsbCc7IC8vICdhbGwnIHwgJ3JvZHMnIHwgJ3JlZWxzJ1xubGV0IF9yZWNvU2VhcmNoVGV4dCA9ICcnO1xuXG4vLyB2MTExMisgKEYzQik6IFNLVXMgZGVzY29udGludWFkb3MgcXVlIE1hcmlhbm8gbWFyY2EgcGFyYSBleGNsdWlyIGRlbCBmb3JlY2FzdC5cbi8vIFBlcnNpc3RlbiBlbiBGaXJlc3RvcmUgYGZvcmVjYXN0X2NvbmZpZy9kaXNjb250aW51ZWRfc2t1c2AgY29tbyB7IHNrdXM6IFtTS1UgdXBwZXJdLCB1cGRhdGVkQXQsIHVwZGF0ZWRCeSB9LlxubGV0IF9kaXNjb250aW51ZWRTa3VzID0gbnVsbDsgLy8gU2V0PHN0cmluZyB1cHBlcj4gbyBudWxsIHNpIG5vIGNhcmdhZG9cbmxldCBfZGlzY29udGludWVkTWV0YSA9IG51bGw7IC8vIHt1cGRhdGVkQXQsIHVwZGF0ZWRCeX1cblxuLy8gdjExMTQrIChGM0IgbXVsdGlwbGljYWRvciBkaW5cdTAwRTFtaWNvKTogbXVsdGlwbGljYWRvciBhdXRvIHBvciBTS1UgPSB2ZW50YV8ybVxuLy8gZGl2aWRpZG8gcG9yIHZlbnRhXzZtLCBjb24gY2FwLiBPdmVycmlkZSBtYW51YWwgcGVyc2lzdGlkbyBlbiBGaXJlc3RvcmVcbi8vIGBmb3JlY2FzdF9jb25maWcvbXVsdGlwbGllcnNgIGNvbiB7c2t1T3ZlcnJpZGVzOiB7U0tVOiB7dmFsdWUsIHVwZGF0ZWRCeSwgdXBkYXRlZEF0fX19LlxubGV0IF9tdWx0aXBsaWVyT3ZlcnJpZGVzID0gbnVsbDsgLy8geyBbU0tVIHVwcGVyXToge3ZhbHVlLCB1cGRhdGVkQnksIHVwZGF0ZWRBdH0gfVxuY29uc3QgUkVDT19NVUxUX1JFQ0VOVF9NT05USFMgPSAyO1xuY29uc3QgUkVDT19NVUxUX0JBU0VMSU5FX01PTlRIUyA9IDY7XG5jb25zdCBSRUNPX01VTFRfTUlOID0gMC41O1xuY29uc3QgUkVDT19NVUxUX01BWCA9IDIuNTtcbmNvbnN0IFJFQ09fTVVMVF9NSU5fQkFTRUxJTkUgPSAwLjE7IC8vIGV2aXRhIGRpdmlzaVx1MDBGM24gcG9yIGNlcm9cblxuY29uc3QgUkVDT19IT1JJWk9OX01PTlRIUyA9IDc7XG5jb25zdCBSRUNPX1ZFTlRBX1BST01FRElPX1dJTkRPVyA9IDM7IC8vIG1lc2VzIGhhY2lhIGF0clx1MDBFMXMgcGFyYSBwcm9tZWRpbyB2ZW50YVxuLy8gUkVDT19ERUZBVUxUX01VTFRJUExJRVIgcmVtb3ZlZCAyMDI2LTEwLTA2ICh1bnVzZWQsIGZsYWdnZWQgYnkgYmlvbWUpLlxuXG4vLyBXaGl0ZWxpc3QgZGUgZW1haWxzIGNvbiBhY2Nlc28gYWwgbW9kYWwgRk9SRUNBU1QuIFJlcGxpY2EgZWwgcGF0cm9uIGRlXG4vLyBcIkFuYWxpc2lzXCIgKGluZGV4Lmh0bWw6MTI2MjUpLiBTb2xvIE1hcmlhbm87IHNpIG90cm8gYWRtaW4gbG8gbmVjZXNpdGFcbi8vIHNlIGFncmVnYSBhY2EgZXhwbGljaXRvLlxuY29uc3QgRk9SRUNBU1RfQUxMT1dFRF9FTUFJTFMgPSBbJ21hcmlhbm8uZXJiaW5vQHNoaW1hbm8uY29tLmFyJywgJ2VyYmlub21hcmlhbm9AZ21haWwuY29tJ107XG5cbmZ1bmN0aW9uIF9jYW5Gb3JlY2FzdCgpIHtcbiAgdHJ5IHtcbiAgICBjb25zdCBlbWFpbCA9ICgod2luZG93LmN1cnJlbnRVc2VyICYmIHdpbmRvdy5jdXJyZW50VXNlci5lbWFpbCkgfHwgJycpLnRvTG93ZXJDYXNlKCk7XG4gICAgaWYgKCFlbWFpbCkgcmV0dXJuIGZhbHNlO1xuICAgIHJldHVybiBGT1JFQ0FTVF9BTExPV0VEX0VNQUlMUy5pbmRleE9mKGVtYWlsKSA+PSAwO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbn1cblxuZnVuY3Rpb24gX3JlbmRlck1vZGFsU2hlbGwoKSB7XG4gIGNvbnN0IGV4aXN0aW5nID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2ZvcmVjYXN0LW1vZGFsJyk7XG4gIGlmIChleGlzdGluZykgcmV0dXJuIGV4aXN0aW5nO1xuICBjb25zdCBlbCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpO1xuICBlbC5pZCA9ICdmb3JlY2FzdC1tb2RhbCc7XG4gIGVsLmNsYXNzTmFtZSA9ICdtb2RhbC1vdmVybGF5JztcbiAgLy8gdjEzMDYgKDIwMjYtMTAtMTUpOiBBcHBsZS1zdHlsZSBtb2RhbCBvdmVybGF5IGNvbiBiYWNrZHJvcCBibHVyLlxuICBlbC5zdHlsZS5jc3NUZXh0ID1cbiAgICAnZGlzcGxheTpub25lO3Bvc2l0aW9uOmZpeGVkO2luc2V0OjA7YmFja2dyb3VuZDpyZ2JhKDAsMCwwLC4zKTstd2Via2l0LWJhY2tkcm9wLWZpbHRlcjpzYXR1cmF0ZSgxNDAlKSBibHVyKDhweCk7YmFja2Ryb3AtZmlsdGVyOnNhdHVyYXRlKDE0MCUpIGJsdXIoOHB4KTt6LWluZGV4OjIwNTA7JztcbiAgZWwub25jbGljayA9IGZ1bmN0aW9uIChldikge1xuICAgIGlmIChldi50YXJnZXQgPT09IGVsKSB3aW5kb3cuY2xvc2VGb3JlY2FzdE1vZGFsKCk7XG4gIH07XG4gIGNvbnN0IHNoZWxsSHRtbCA9IF9idWlsZFNoZWxsSHRtbCgpO1xuICBlbC5pbm5lckhUTUwgPSBzaGVsbEh0bWw7XG4gIGRvY3VtZW50LmJvZHkuYXBwZW5kQ2hpbGQoZWwpO1xuICBfZW5zdXJlRm9yZWNhc3RBcHBsZUNzcygpO1xuICByZXR1cm4gZWw7XG59XG5cbmZ1bmN0aW9uIF9lbnN1cmVGb3JlY2FzdEFwcGxlQ3NzKCkge1xuICAvLyB2MTMwNjogQ1NTIEFwcGxlLXN0eWxlIGlueWVjdGFkbyB1bmEgc29sYSB2ZXogYWwgYWJyaXIgZWwgbW9kYWwuXG4gIC8vIFNraWxsIGFwcGxlLWRlc2lnbjogZmVlZGJhY2sgcG9pbnRlcmRvd24sIGJhY2tkcm9wIGJsdXIsIHJlZHVjZWQtbW90aW9uLFxuICAvLyB0eXBvZ3JhcGh5IHRyYWNraW5nIHNpemUtc3BlY2lmaWMuXG4gIGlmIChkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZm9yZWNhc3QtYXBwbGUtY3NzJykpIHJldHVybjtcbiAgY29uc3Qgc3R5bGUgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdzdHlsZScpO1xuICBzdHlsZS5pZCA9ICdmb3JlY2FzdC1hcHBsZS1jc3MnO1xuICBjb25zdCBjc3MgPVxuICAgICcjZm9yZWNhc3QtbW9kYWwgLmZjLWFwcGxlICp7Zm9udC1mYW1pbHk6LWFwcGxlLXN5c3RlbSxCbGlua01hY1N5c3RlbUZvbnQsXCJTRiBQcm8gRGlzcGxheVwiLFwiU0YgUHJvIFRleHRcIixcIkhlbHZldGljYSBOZXVlXCIsc2Fucy1zZXJpZn0nICtcbiAgICAnI2ZvcmVjYXN0LW1vZGFsIC5mYy1hcHBsZS1jbG9zZXtib3JkZXI6bm9uZTtiYWNrZ3JvdW5kOnJnYmEoMTIwLDEyMCwxMjgsLjE0KTt3aWR0aDozMHB4O2hlaWdodDozMHB4O2JvcmRlci1yYWRpdXM6NTAlO2N1cnNvcjpwb2ludGVyO2NvbG9yOiM4Njg2OGI7Zm9udC1zaXplOjE2cHg7ZGlzcGxheTpmbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtqdXN0aWZ5LWNvbnRlbnQ6Y2VudGVyO3RyYW5zaXRpb246dHJhbnNmb3JtIC4xMnMgZWFzZS1vdXQsYmFja2dyb3VuZCAuMTVzIGVhc2UsY29sb3IgLjE1cyBlYXNlfScgK1xuICAgICcjZm9yZWNhc3QtbW9kYWwgLmZjLWFwcGxlLWNsb3NlOmhvdmVye2JhY2tncm91bmQ6cmdiYSgxMjAsMTIwLDEyOCwuMjIpO2NvbG9yOiMxZDFkMWZ9JyArXG4gICAgJyNmb3JlY2FzdC1tb2RhbCAuZmMtYXBwbGUtY2xvc2U6YWN0aXZle3RyYW5zZm9ybTpzY2FsZSguOSk7YmFja2dyb3VuZDpyZ2JhKDEyMCwxMjAsMTI4LC4zKX0nICtcbiAgICAnI2ZvcmVjYXN0LW1vZGFsIC5mYy1hcHBsZS10YWJ7cGFkZGluZzo3cHggMTZweDtib3JkZXItcmFkaXVzOjk4MHB4O2JvcmRlcjpub25lO2JhY2tncm91bmQ6dHJhbnNwYXJlbnQ7Y29sb3I6Izg2ODY4Yjtmb250LXNpemU6MTIuNXB4O2ZvbnQtd2VpZ2h0OjYwMDtsZXR0ZXItc3BhY2luZzotMC4xcHg7Y3Vyc29yOnBvaW50ZXI7dHJhbnNpdGlvbjpiYWNrZ3JvdW5kIC4xNXMgZWFzZSxjb2xvciAuMTVzIGVhc2UsdHJhbnNmb3JtIC4xcyBlYXNlLW91dH0nICtcbiAgICAnI2ZvcmVjYXN0LW1vZGFsIC5mYy1hcHBsZS10YWI6aG92ZXJ7YmFja2dyb3VuZDpyZ2JhKDEyMCwxMjAsMTI4LC4xKTtjb2xvcjojMWQxZDFmfScgK1xuICAgICcjZm9yZWNhc3QtbW9kYWwgLmZjLWFwcGxlLXRhYjphY3RpdmV7dHJhbnNmb3JtOnNjYWxlKC45Nyl9JyArXG4gICAgJyNmb3JlY2FzdC1tb2RhbCAuZmMtYXBwbGUtdGFiLmFjdGl2ZXtiYWNrZ3JvdW5kOiMxZDFkMWY7Y29sb3I6I2ZmZn0nICtcbiAgICAnI2ZvcmVjYXN0LW1vZGFsIC5mYy1hcHBsZS10YWIuYWN0aXZlOmhvdmVye2JhY2tncm91bmQ6IzAwMH0nICtcbiAgICAnQG1lZGlhIChwcmVmZXJzLXJlZHVjZWQtbW90aW9uOnJlZHVjZSl7JyArXG4gICAgJyAgI2ZvcmVjYXN0LW1vZGFsIC5mYy1hcHBsZS1jbG9zZSwjZm9yZWNhc3QtbW9kYWwgLmZjLWFwcGxlLXRhYnt0cmFuc2l0aW9uOm5vbmUgIWltcG9ydGFudH0nICtcbiAgICAnICAjZm9yZWNhc3QtbW9kYWwgLmZjLWFwcGxlLWNsb3NlOmFjdGl2ZSwjZm9yZWNhc3QtbW9kYWwgLmZjLWFwcGxlLXRhYjphY3RpdmV7dHJhbnNmb3JtOm5vbmUgIWltcG9ydGFudH0nICtcbiAgICAnfSc7XG4gIHN0eWxlLnRleHRDb250ZW50ID0gY3NzO1xuICBkb2N1bWVudC5oZWFkLmFwcGVuZENoaWxkKHN0eWxlKTtcbn1cblxuZnVuY3Rpb24gX2J1aWxkU2hlbGxIdG1sKCkge1xuICAvLyB2MTMwNjogcmVkaXNlXHUwMEYxbyBBcHBsZS1zdHlsZS5cbiAgLy8gdjEzMDcgKDIwMjYtMTAtMTUpOiB0YWIgXCJGb3JlY2FzdCBlc3RhZFx1MDBFRHN0aWNvXCIgcmVtb3ZpZGEgKGRlY2lzaVx1MDBGM24gTWFyaWFubykuXG4gIC8vIEVsIGZvcmVjYXN0IHBvciBzdWJmYW1pbGlhIChmb3JlY2FzdF9vdXRwdXQvKSBubyBhZ3JlZ2EgdmFsb3Igc29icmVcbiAgLy8gXCJTYWxlcyBQbGFuc1wiIHF1ZSB5YSBoYWNlIHJlY29tZW5kYWNpXHUwMEYzbiBuaXZlbCBTS1UgY29uIEJPICsgc3RvY2sgKyBwbGFuLlxuICAvLyBTaGVsbCBxdWVkYSBzaW4gdGFicyBiYXIgXHUyMDE0IHVuYSBzb2xhIHZpc3RhLlxuICBjb25zdCBtb2RhbE91dGVyID1cbiAgICAnPGRpdiBjbGFzcz1cImZjLWFwcGxlXCIgc3R5bGU9XCJwb3NpdGlvbjphYnNvbHV0ZTtpbnNldDoxdmggMXZ3O2JhY2tncm91bmQ6I2ZiZmJmZDtib3JkZXItcmFkaXVzOjE4cHg7ZGlzcGxheTpmbGV4O2ZsZXgtZGlyZWN0aW9uOmNvbHVtbjtvdmVyZmxvdzpoaWRkZW47Ym94LXNoYWRvdzowIDI0cHggNzBweCByZ2JhKDAsMCwwLC4yMilcIj4nO1xuICBjb25zdCBoZWFkZXIgPVxuICAgICc8ZGl2IHN0eWxlPVwicGFkZGluZzoyMnB4IDI2cHggMThweDtiYWNrZ3JvdW5kOnJnYmEoMjUxLDI1MSwyNTMsLjkyKTstd2Via2l0LWJhY2tkcm9wLWZpbHRlcjpzYXR1cmF0ZSgxODAlKSBibHVyKDIwcHgpO2JhY2tkcm9wLWZpbHRlcjpzYXR1cmF0ZSgxODAlKSBibHVyKDIwcHgpO2JvcmRlci1ib3R0b206MC41cHggc29saWQgcmdiYSgwLDAsMCwuMDgpO2Rpc3BsYXk6ZmxleDthbGlnbi1pdGVtczpmbGV4LXN0YXJ0O2dhcDoxNHB4XCI+JyArXG4gICAgJzxkaXYgc3R5bGU9XCJmbGV4OjE7bWluLXdpZHRoOjBcIj4nICtcbiAgICAnPGgyIHN0eWxlPVwibWFyZ2luOjAgMCA0cHg7Zm9udC1zaXplOjIycHg7Zm9udC13ZWlnaHQ6NzAwO2xldHRlci1zcGFjaW5nOi0wLjVweDtjb2xvcjojMWQxZDFmXCI+Rm9yZWNhc3Q8L2gyPicgK1xuICAgICc8ZGl2IGlkPVwiZm9yZWNhc3Qtc3VidGl0bGVcIiBzdHlsZT1cImZvbnQtc2l6ZToxM3B4O2xldHRlci1zcGFjaW5nOi0wLjFweDtjb2xvcjojODY4NjhiXCI+U2FsZXMgUGxhbnMgbWVuc3VhbGVzICsgcG9sXHUwMEVEdGljYSBkZSBpbnZlbnRhcmlvPC9kaXY+JyArXG4gICAgJzwvZGl2PicgK1xuICAgICc8YnV0dG9uIGNsYXNzPVwiZmMtYXBwbGUtY2xvc2VcIiBvbmNsaWNrPVwiY2xvc2VGb3JlY2FzdE1vZGFsKClcIiBhcmlhLWxhYmVsPVwiQ2VycmFyXCI+JnRpbWVzOzwvYnV0dG9uPicgK1xuICAgICc8L2Rpdj4nO1xuICBjb25zdCB0YWJTYWxlc1BsYW5zID1cbiAgICAnPGRpdiBpZD1cImZvcmVjYXN0LXRhYi1zYWxlcy1wbGFuc1wiIHN0eWxlPVwiZmxleDoxO292ZXJmbG93OmF1dG87cGFkZGluZzowO2JhY2tncm91bmQ6I2ZiZmJmZFwiPjwvZGl2Pic7XG4gIC8vIHYxMzA3OiBjb250ZW5lZG9yIHN0YXQgcXVlZGEgb2N1bHRvIHBhcmEgcHJlc2VydmFyIHJlZmVyZW5jaWFzIGRlbCBjb2RpZ29cbiAgLy8gKHN3aXRjaEZvcmVjYXN0VGFiL19yZW5kZXJGb3JlY2FzdFN0YXRUYWIgZXhpc3RlbiBwZXJvIG5vIHNlIGludm9jYW5cbiAgLy8gZGVzZGUgbGEgVUkpLiBTaSBxdWVyXHUwMEU5cyBsaW1waWFyIGVsIGNvZGlnbyBlbnRlcm8sIGVzIHNhZmUgYm9ycmFybG9zLlxuICBjb25zdCB0YWJTdGF0ID0gJzxkaXYgaWQ9XCJmb3JlY2FzdC10YWItc3RhdFwiIHN0eWxlPVwiZGlzcGxheTpub25lXCI+PC9kaXY+JztcbiAgcmV0dXJuIG1vZGFsT3V0ZXIgKyBoZWFkZXIgKyB0YWJTYWxlc1BsYW5zICsgdGFiU3RhdCArICc8L2Rpdj4nO1xufVxuXG4vLyB2MTA5OCsgRmFzZSAxICsgdjExMDMrIEZhc2UgMkIgKyB2MTEwNSBmaXggKyB2MTExMSBjbGVhbiBsZWdhY3k6IHN3aXRjaFxuLy8gZW50cmUgdGFicyBTYWxlcyBQbGFucyAvIEZvcmVjYXN0IEVzdGFkXHUwMEVEc3RpY28uXG53aW5kb3cuc3dpdGNoRm9yZWNhc3RUYWIgPSBmdW5jdGlvbiAodGFiSWQpIHtcbiAgX2ZvcmVjYXN0QWN0aXZlVGFiID0gdGFiSWQ7XG4gIGNvbnN0IHNwID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2ZvcmVjYXN0LXRhYi1zYWxlcy1wbGFucycpO1xuICBjb25zdCBzdCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdmb3JlY2FzdC10YWItc3RhdCcpO1xuICBpZiAoc3ApIHNwLnN0eWxlLmRpc3BsYXkgPSB0YWJJZCA9PT0gJ3NhbGVzLXBsYW5zJyA/ICdibG9jaycgOiAnbm9uZSc7XG4gIGlmIChzdCkgc3Quc3R5bGUuZGlzcGxheSA9IHRhYklkID09PSAnc3RhdCcgPyAnYmxvY2snIDogJ25vbmUnO1xuICBjb25zdCBidG5zID0gZG9jdW1lbnQucXVlcnlTZWxlY3RvckFsbCgnI2ZvcmVjYXN0LXRhYnMtYmFyIC5mb3JlY2FzdC10YWInKTtcbiAgYnRucy5mb3JFYWNoKChiKSA9PiB7XG4gICAgY29uc3QgYWN0aXZlID0gYi5nZXRBdHRyaWJ1dGUoJ2RhdGEtdGFiJykgPT09IHRhYklkO1xuICAgIC8vIHYxMzA2IEFwcGxlLXN0eWxlOiB0b2dnbGUgY2xhc3MgYWN0aXZlIChsb3MgZXN0aWxvcyBkZSBwaWxsIHZpZW5lbiBkZWwgQ1NTKS5cbiAgICBiLmNsYXNzTGlzdC50b2dnbGUoJ2FjdGl2ZScsIGFjdGl2ZSk7XG4gIH0pO1xuICAvLyB2MTEwNSBmaXg6IGFsIGFjdGl2YXIgbGEgdGFiIHN0YXQsIG1vc3RyYXIgcGxhY2Vob2xkZXIgaW5tZWRpYXRvIHBhcmFcbiAgLy8gcXVlIHNlIHZlYSBhbGdvIG1pZW50cmFzIGNhcmdhIChvIHNpIGVsIGxvYWQgeWEgdGVybWlubywgcmUtcmVuZGVyKS5cbiAgaWYgKHRhYklkID09PSAnc3RhdCcpIHtcbiAgICBjb25zdCBjb250ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2ZvcmVjYXN0LXRhYi1zdGF0Jyk7XG4gICAgaWYgKGNvbnQpIHtcbiAgICAgIGlmIChfZm9yZWNhc3RTdGF0RG9jcykge1xuICAgICAgICAvLyBZYSBjYXJnYWRvOiByZS1yZW5kZXIgKHBvciBzaSBlbCB1c2VyIHZpZW5lIGRlIG90cmEgdGFiKS5cbiAgICAgICAgX3JlbmRlckZvcmVjYXN0U3RhdFRhYigpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgLy8gQVx1MDBGQW4gbm8gY2FyZ2FkbzogcGxhY2Vob2xkZXIgKyBsb2FkLlxuICAgICAgICBjb250LmlubmVySFRNTCA9XG4gICAgICAgICAgJzxkaXYgY2xhc3M9XCJmYy1hcHBsZVwiIHN0eWxlPVwicGFkZGluZzo4MHB4IDIwcHg7dGV4dC1hbGlnbjpjZW50ZXI7Y29sb3I6Izg2ODY4Yjtmb250LXNpemU6MTRweDtsZXR0ZXItc3BhY2luZzotMC4xcHhcIj4nICtcbiAgICAgICAgICAnPGRpdiBzdHlsZT1cImRpc3BsYXk6aW5saW5lLWJsb2NrO3dpZHRoOjI4cHg7aGVpZ2h0OjI4cHg7Ym9yZGVyOjIuNXB4IHNvbGlkIHJnYmEoMCwxMjIsMjU1LC4yKTtib3JkZXItdG9wLWNvbG9yOiMwMDdhZmY7Ym9yZGVyLXJhZGl1czo1MCU7YW5pbWF0aW9uOnNwaW4gMC43NXMgbGluZWFyIGluZmluaXRlO21hcmdpbi1ib3R0b206MTZweFwiPjwvZGl2PicgK1xuICAgICAgICAgICc8ZGl2PkNhcmdhbmRvIGZvcmVjYXN0IGRlc2RlIEZpcmVzdG9yZTwvZGl2PicgK1xuICAgICAgICAgICc8c3R5bGU+QGtleWZyYW1lcyBzcGlue3Rve3RyYW5zZm9ybTpyb3RhdGUoMzYwZGVnKX19PC9zdHlsZT4nICtcbiAgICAgICAgICAnPC9kaXY+JztcbiAgICAgICAgX2xvYWRGb3JlY2FzdE91dHB1dCgpXG4gICAgICAgICAgLnRoZW4oX3JlbmRlckZvcmVjYXN0U3RhdFRhYilcbiAgICAgICAgICAuY2F0Y2goKGUpID0+IHtcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ1tGT1JFQ0FTVCBzdGF0XSBsb2FkIGZhaWwnLCBlKTtcbiAgICAgICAgICAgIGNvbnN0IGMgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZm9yZWNhc3QtdGFiLXN0YXQnKTtcbiAgICAgICAgICAgIGlmIChjKSB7XG4gICAgICAgICAgICAgIGMuaW5uZXJIVE1MID1cbiAgICAgICAgICAgICAgICAnPGRpdiBjbGFzcz1cImZjLWFwcGxlXCIgc3R5bGU9XCJwYWRkaW5nOjgwcHggMjBweDt0ZXh0LWFsaWduOmNlbnRlcjtsaW5lLWhlaWdodDoxLjVcIj4nICtcbiAgICAgICAgICAgICAgICAnPGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxNnB4O2ZvbnQtd2VpZ2h0OjYwMDttYXJnaW4tYm90dG9tOjEwcHg7Y29sb3I6I2M3MzcyZjtsZXR0ZXItc3BhY2luZzotMC4ycHhcIj5FcnJvciBjYXJnYW5kbyBmb3JlY2FzdDwvZGl2PicgK1xuICAgICAgICAgICAgICAgICc8ZGl2IHN0eWxlPVwiZm9udC1zaXplOjEyLjVweDtjb2xvcjojODY4NjhiO21hcmdpbi1ib3R0b206MThweDtsZXR0ZXItc3BhY2luZzotMC4xcHhcIj4nICtcbiAgICAgICAgICAgICAgICBlc2NhcGVIdG1sU2FmZShlLm1lc3NhZ2UgfHwgU3RyaW5nKGUpKSArXG4gICAgICAgICAgICAgICAgJzwvZGl2PicgK1xuICAgICAgICAgICAgICAgICc8YnV0dG9uIG9uY2xpY2s9XCJzd2l0Y2hGb3JlY2FzdFRhYihcXCdzdGF0XFwnKVwiIHN0eWxlPVwicGFkZGluZzo5cHggMThweDtiYWNrZ3JvdW5kOiMwMDdhZmY7Y29sb3I6I2ZmZjtib3JkZXI6bm9uZTtib3JkZXItcmFkaXVzOjk4MHB4O2ZvbnQtd2VpZ2h0OjYwMDtjdXJzb3I6cG9pbnRlcjtmb250LXNpemU6MTNweDtsZXR0ZXItc3BhY2luZzotMC4xcHhcIj5SZWludGVudGFyPC9idXR0b24+JyArXG4gICAgICAgICAgICAgICAgJzwvZGl2Pic7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfSk7XG4gICAgICB9XG4gICAgfVxuICB9XG59O1xuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIEZBU0UgMSBcdTIwMTQgU2FsZXMgUGxhbnMgdXBsb2FkIChSb2RzIC8gUmVlbHMgLyBGRylcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5mdW5jdGlvbiBfeWVhck1vbnRoTm93KCkge1xuICBjb25zdCBkID0gbmV3IERhdGUoKTtcbiAgcmV0dXJuIGQuZ2V0RnVsbFllYXIoKSArICctJyArIFN0cmluZyhkLmdldE1vbnRoKCkgKyAxKS5wYWRTdGFydCgyLCAnMCcpO1xufVxuXG5mdW5jdGlvbiBfZm10U2l6ZShieXRlcykge1xuICBpZiAoIWJ5dGVzKSByZXR1cm4gJyc7XG4gIGlmIChieXRlcyA8IDEwMjQpIHJldHVybiBieXRlcyArICcgQic7XG4gIGlmIChieXRlcyA8IDEwMjQgKiAxMDI0KSByZXR1cm4gKGJ5dGVzIC8gMTAyNCkudG9GaXhlZCgxKSArICcgS0InO1xuICByZXR1cm4gKGJ5dGVzIC8gKDEwMjQgKiAxMDI0KSkudG9GaXhlZCgyKSArICcgTUInO1xufVxuXG5mdW5jdGlvbiBfZm10RGF0ZVNob3J0KGlzbykge1xuICBpZiAoIWlzbykgcmV0dXJuICdcdTIwMTQnO1xuICB0cnkge1xuICAgIGNvbnN0IGQgPSBpc28udG9EYXRlID8gaXNvLnRvRGF0ZSgpIDogbmV3IERhdGUoaXNvKTtcbiAgICByZXR1cm4gKFxuICAgICAgZC50b0xvY2FsZURhdGVTdHJpbmcoJ2VzLUFSJywgeyBkYXk6ICcyLWRpZ2l0JywgbW9udGg6ICdzaG9ydCcsIHllYXI6ICcyLWRpZ2l0JyB9KSArXG4gICAgICAnICcgK1xuICAgICAgZC50b0xvY2FsZVRpbWVTdHJpbmcoJ2VzLUFSJywgeyBob3VyOiAnMi1kaWdpdCcsIG1pbnV0ZTogJzItZGlnaXQnIH0pXG4gICAgKTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIFN0cmluZyhpc28pO1xuICB9XG59XG5cbmFzeW5jIGZ1bmN0aW9uIF9sb2FkU2FsZXNQbGFuQ2FjaGVzKCkge1xuICBpZiAoIXdpbmRvdy5mYkRiKSByZXR1cm47XG4gIGF3YWl0IFByb21pc2UuYWxsKFxuICAgIFNBTEVTX1BMQU5fRkFNSUxJQVMubWFwKGFzeW5jIChmKSA9PiB7XG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCBkb2MgPSBhd2FpdCB3aW5kb3cuZmJEYi5jb2xsZWN0aW9uKCdzYWxlc19wbGFuX2NhY2hlJykuZG9jKGYua2V5KS5nZXQoKTtcbiAgICAgICAgX3NhbGVzUGxhbkNhY2hlc1tmLmtleV0gPSBkb2MuZXhpc3RzID8gZG9jLmRhdGEoKSA6IG51bGw7XG4gICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgIGNvbnNvbGUud2FybignW0ZPUkVDQVNUXSBsb2FkIHNhbGVzX3BsYW5fY2FjaGUvJyArIGYua2V5ICsgJyBmYWlsOicsIGUgJiYgZS5tZXNzYWdlKTtcbiAgICAgICAgX3NhbGVzUGxhbkNhY2hlc1tmLmtleV0gPSBudWxsO1xuICAgICAgfVxuICAgIH0pXG4gICk7XG59XG5cbmZ1bmN0aW9uIGVzY2FwZUh0bWxTYWZlKHMpIHtcbiAgaWYgKHR5cGVvZiB3aW5kb3cuZXNjYXBlSHRtbCA9PT0gJ2Z1bmN0aW9uJykgcmV0dXJuIHdpbmRvdy5lc2NhcGVIdG1sKHMpO1xuICByZXR1cm4gU3RyaW5nKHMgPT0gbnVsbCA/ICcnIDogcykucmVwbGFjZShcbiAgICAvWyY8PlwiJ10vZyxcbiAgICAoY2gpID0+ICh7ICcmJzogJyZhbXA7JywgJzwnOiAnJmx0OycsICc+JzogJyZndDsnLCAnXCInOiAnJnF1b3Q7JywgXCInXCI6ICcmIzM5OycgfSlbY2hdXG4gICk7XG59XG5cbmZ1bmN0aW9uIF9idWlsZFNhbGVzUGxhblNsb3RIdG1sKGYpIHtcbiAgY29uc3QgY2FjaGUgPSBfc2FsZXNQbGFuQ2FjaGVzW2Yua2V5XTtcbiAgY29uc3Qgcm93c0NvdW50ID0gY2FjaGUgJiYgTnVtYmVyLmlzRmluaXRlKGNhY2hlLnJvd3NDb3VudCkgPyBjYWNoZS5yb3dzQ291bnQgOiAwO1xuICBjb25zdCBtb250aHNDb3VudCA9XG4gICAgY2FjaGUgJiYgQXJyYXkuaXNBcnJheShjYWNoZS5kZXRlY3RlZE1vbnRocykgPyBjYWNoZS5kZXRlY3RlZE1vbnRocy5sZW5ndGggOiAwO1xuICBjb25zdCBwYXJzZWRBdCA9IGNhY2hlICYmIGNhY2hlLnBhcnNlZEF0ID8gX2ZtdERhdGVTaG9ydChjYWNoZS5wYXJzZWRBdCkgOiAnJztcbiAgY29uc3QgdXBsb2FkZWRCeSA9IGNhY2hlICYmIGNhY2hlLnVwbG9hZGVkQnkgPyBjYWNoZS51cGxvYWRlZEJ5IDogJyc7XG4gIGNvbnN0IHNvdXJjZUZpbGVuYW1lID0gY2FjaGUgJiYgY2FjaGUuc291cmNlRmlsZW5hbWUgPyBjYWNoZS5zb3VyY2VGaWxlbmFtZSA6ICcnO1xuICBjb25zdCB5ZWFyTW9udGggPSBjYWNoZSAmJiBjYWNoZS55ZWFyTW9udGggPyBjYWNoZS55ZWFyTW9udGggOiAnJztcbiAgY29uc3QgbW9udGhzUmFuZ2UgPVxuICAgIGNhY2hlICYmIGNhY2hlLmRldGVjdGVkTW9udGhzICYmIGNhY2hlLmRldGVjdGVkTW9udGhzLmxlbmd0aFxuICAgICAgPyBjYWNoZS5kZXRlY3RlZE1vbnRoc1swXSArICcgXHUyMTkyICcgKyBjYWNoZS5kZXRlY3RlZE1vbnRoc1tjYWNoZS5kZXRlY3RlZE1vbnRocy5sZW5ndGggLSAxXVxuICAgICAgOiAnXHUyMDE0JztcbiAgY29uc3QgaGFzQ2FjaGUgPSAhIWNhY2hlO1xuICBjb25zdCBiYWRnZSA9IGhhc0NhY2hlXG4gICAgPyAnPGRpdiBzdHlsZT1cInBhZGRpbmc6NHB4IDhweDtiYWNrZ3JvdW5kOiMxNmEzNGE7Y29sb3I6I2ZmZjtib3JkZXItcmFkaXVzOjEycHg7Zm9udC1zaXplOjEwcHg7Zm9udC13ZWlnaHQ6NzAwO2xldHRlci1zcGFjaW5nOi40cHhcIj5DQVJHQURPPC9kaXY+J1xuICAgIDogJzxkaXYgc3R5bGU9XCJwYWRkaW5nOjRweCA4cHg7YmFja2dyb3VuZDojZGMyNjI2O2NvbG9yOiNmZmY7Ym9yZGVyLXJhZGl1czoxMnB4O2ZvbnQtc2l6ZToxMHB4O2ZvbnQtd2VpZ2h0OjcwMDtsZXR0ZXItc3BhY2luZzouNHB4XCI+RkFMVEE8L2Rpdj4nO1xuICBjb25zdCBtZXRhQmxvY2sgPSBoYXNDYWNoZVxuICAgID8gJzxkaXYgc3R5bGU9XCJkaXNwbGF5OmdyaWQ7Z3JpZC10ZW1wbGF0ZS1jb2x1bW5zOmF1dG8gMWZyO2dhcDo2cHggMTJweDtmb250LXNpemU6MTFweDtwYWRkaW5nOjEwcHggMTJweDtiYWNrZ3JvdW5kOnZhcigtLWJnLXNlY29uZGFyeSk7Ym9yZGVyLXJhZGl1czo2cHhcIj4nICtcbiAgICAgICc8ZGl2IHN0eWxlPVwiY29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7Zm9udC13ZWlnaHQ6NjAwXCI+QXJjaGl2bzwvZGl2PjxkaXYgc3R5bGU9XCJjb2xvcjp2YXIoLS10ZXh0LXByaW1hcnkpO2ZvbnQtZmFtaWx5Om1vbm9zcGFjZTt3b3JkLWJyZWFrOmJyZWFrLWFsbFwiPicgK1xuICAgICAgZXNjYXBlSHRtbFNhZmUoc291cmNlRmlsZW5hbWUpICtcbiAgICAgICc8L2Rpdj4nICtcbiAgICAgICc8ZGl2IHN0eWxlPVwiY29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7Zm9udC13ZWlnaHQ6NjAwXCI+U3ViaWRvPC9kaXY+PGRpdiBzdHlsZT1cImNvbG9yOnZhcigtLXRleHQtcHJpbWFyeSlcIj4nICtcbiAgICAgIGVzY2FwZUh0bWxTYWZlKHBhcnNlZEF0KSArXG4gICAgICAnPC9kaXY+JyArXG4gICAgICAnPGRpdiBzdHlsZT1cImNvbG9yOnZhcigtLXRleHQtbXV0ZWQpO2ZvbnQtd2VpZ2h0OjYwMFwiPlBvcjwvZGl2PjxkaXYgc3R5bGU9XCJjb2xvcjp2YXIoLS10ZXh0LXByaW1hcnkpXCI+JyArXG4gICAgICBlc2NhcGVIdG1sU2FmZSh1cGxvYWRlZEJ5KSArXG4gICAgICAnPC9kaXY+JyArXG4gICAgICAnPGRpdiBzdHlsZT1cImNvbG9yOnZhcigtLXRleHQtbXV0ZWQpO2ZvbnQtd2VpZ2h0OjYwMFwiPlNuYXBzaG90PC9kaXY+PGRpdiBzdHlsZT1cImNvbG9yOnZhcigtLXRleHQtcHJpbWFyeSk7Zm9udC1mYW1pbHk6bW9ub3NwYWNlXCI+JyArXG4gICAgICBlc2NhcGVIdG1sU2FmZSh5ZWFyTW9udGgpICtcbiAgICAgICc8L2Rpdj4nICtcbiAgICAgICc8ZGl2IHN0eWxlPVwiY29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7Zm9udC13ZWlnaHQ6NjAwXCI+U0tVczwvZGl2PjxkaXYgc3R5bGU9XCJjb2xvcjp2YXIoLS10ZXh0LXByaW1hcnkpO2ZvbnQtd2VpZ2h0OjcwMFwiPicgK1xuICAgICAgcm93c0NvdW50LnRvTG9jYWxlU3RyaW5nKCdlcy1BUicpICtcbiAgICAgICc8L2Rpdj4nICtcbiAgICAgICc8ZGl2IHN0eWxlPVwiY29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7Zm9udC13ZWlnaHQ6NjAwXCI+TWVzZXM8L2Rpdj48ZGl2IHN0eWxlPVwiY29sb3I6dmFyKC0tdGV4dC1wcmltYXJ5KTtmb250LXdlaWdodDo3MDBcIj4nICtcbiAgICAgIG1vbnRoc0NvdW50ICtcbiAgICAgICcgPHNwYW4gc3R5bGU9XCJjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTtmb250LXdlaWdodDo0MDBcIj4oJyArXG4gICAgICBlc2NhcGVIdG1sU2FmZShtb250aHNSYW5nZSkgK1xuICAgICAgJyk8L3NwYW4+PC9kaXY+JyArXG4gICAgICAnPC9kaXY+J1xuICAgIDogJzxkaXYgc3R5bGU9XCJwYWRkaW5nOjE0cHg7dGV4dC1hbGlnbjpjZW50ZXI7Zm9udC1zaXplOjEycHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7YmFja2dyb3VuZDp2YXIoLS1iZy1zZWNvbmRhcnkpO2JvcmRlci1yYWRpdXM6NnB4O2JvcmRlcjoxcHggZGFzaGVkIHZhcigtLWJvcmRlci1zdWJ0bGUpXCI+QXVuIG5vIHN1YmlzdGUgZWwgU2FsZXMgUGxhbiBkZSBlc3RhIGZhbWlsaWEuPC9kaXY+JztcbiAgY29uc3QgdXBsb2FkQnRuID1cbiAgICAnPGxhYmVsIHN0eWxlPVwiZGlzcGxheTppbmxpbmUtZmxleDthbGlnbi1pdGVtczpjZW50ZXI7anVzdGlmeS1jb250ZW50OmNlbnRlcjtnYXA6OHB4O3BhZGRpbmc6MTBweCAxNHB4O2JhY2tncm91bmQ6JyArXG4gICAgZi5jb2xvciArXG4gICAgJztjb2xvcjojZmZmO2JvcmRlci1yYWRpdXM6NnB4O2ZvbnQtd2VpZ2h0OjcwMDtmb250LXNpemU6MTJweDtjdXJzb3I6cG9pbnRlcjtsZXR0ZXItc3BhY2luZzouNHB4XCI+JyArXG4gICAgJzxzcGFuPicgK1xuICAgIChoYXNDYWNoZSA/ICdcdTIxQkIgUmVlbXBsYXphciBFeGNlbCcgOiAnXHUyQjA2IENhcmdhciBFeGNlbCcpICtcbiAgICAnPC9zcGFuPicgK1xuICAgICc8aW5wdXQgdHlwZT1cImZpbGVcIiBhY2NlcHQ9XCIueGxzeCwueGxzXCIgZGF0YS1mYW1pbGlhPVwiJyArXG4gICAgZi5rZXkgK1xuICAgICdcIiBzdHlsZT1cImRpc3BsYXk6bm9uZVwiIG9uY2hhbmdlPVwib25TYWxlc1BsYW5GaWxlRm9yRmFtaWxpYShldmVudCwgXFwnJyArXG4gICAgZi5rZXkgK1xuICAgICdcXCcpXCIvPicgK1xuICAgICc8L2xhYmVsPic7XG4gIGNvbnN0IGNhcmRIZWFkID1cbiAgICAnPGRpdiBzdHlsZT1cImRpc3BsYXk6ZmxleDthbGlnbi1pdGVtczpjZW50ZXI7Z2FwOjEwcHhcIj4nICtcbiAgICAnPGRpdiBzdHlsZT1cIndpZHRoOjEycHg7aGVpZ2h0OjMycHg7YmFja2dyb3VuZDonICtcbiAgICBmLmNvbG9yICtcbiAgICAnO2JvcmRlci1yYWRpdXM6M3B4XCI+PC9kaXY+JyArXG4gICAgJzxkaXYgc3R5bGU9XCJmbGV4OjFcIj48ZGl2IHN0eWxlPVwiZm9udC1zaXplOjE0cHg7Zm9udC13ZWlnaHQ6ODAwO2NvbG9yOnZhcigtLXRleHQtcHJpbWFyeSlcIj4nICtcbiAgICBlc2NhcGVIdG1sU2FmZShmLmxhYmVsKSArXG4gICAgJzwvZGl2PicgK1xuICAgICc8ZGl2IHN0eWxlPVwiZm9udC1zaXplOjExcHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7bWFyZ2luLXRvcDoycHhcIj5TYWxlcyBQbGFuIG1lbnN1YWwgXHUwMEI3IEhvamEgU0FSPC9kaXY+PC9kaXY+JyArXG4gICAgYmFkZ2UgK1xuICAgICc8L2Rpdj4nO1xuICByZXR1cm4gKFxuICAgICc8ZGl2IHN0eWxlPVwiYmFja2dyb3VuZDp2YXIoLS1iZy1lbGV2YXRlZCk7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1ib3JkZXItc3VidGxlKTtib3JkZXItcmFkaXVzOjEwcHg7cGFkZGluZzoxNnB4O2Rpc3BsYXk6ZmxleDtmbGV4LWRpcmVjdGlvbjpjb2x1bW47Z2FwOjEycHhcIj4nICtcbiAgICBjYXJkSGVhZCArXG4gICAgbWV0YUJsb2NrICtcbiAgICB1cGxvYWRCdG4gK1xuICAgICc8ZGl2IGlkPVwic2FsZXMtcGxhbi1zdGF0dXMtJyArXG4gICAgZi5rZXkgK1xuICAgICdcIiBzdHlsZT1cImZvbnQtc2l6ZToxMXB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO21pbi1oZWlnaHQ6MTRweFwiPjwvZGl2PicgK1xuICAgICc8L2Rpdj4nXG4gICk7XG59XG5cbmZ1bmN0aW9uIF9yZW5kZXJTYWxlc1BsYW5zVGFiKCkge1xuICBjb25zdCBjb250ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2ZvcmVjYXN0LXRhYi1zYWxlcy1wbGFucycpO1xuICBpZiAoIWNvbnQpIHJldHVybjtcbiAgY29uc3Qgc2xvdHMgPSBTQUxFU19QTEFOX0ZBTUlMSUFTLm1hcChfYnVpbGRTYWxlc1BsYW5TbG90SHRtbCkuam9pbignJyk7XG4gIGNvbnN0IGludHJvID1cbiAgICAnPGRpdiBzdHlsZT1cIm1hcmdpbi1ib3R0b206MTZweDtwYWRkaW5nOjEycHggMTRweDtiYWNrZ3JvdW5kOnZhcigtLWJnLXNlY29uZGFyeSk7Ym9yZGVyLWxlZnQ6M3B4IHNvbGlkICMwZDk0ODg7Ym9yZGVyLXJhZGl1czo2cHg7Zm9udC1zaXplOjEycHg7Y29sb3I6dmFyKC0tdGV4dC1zZWNvbmRhcnkpO2xpbmUtaGVpZ2h0OjEuNVwiPicgK1xuICAgICc8YiBzdHlsZT1cImNvbG9yOnZhcigtLXRleHQtcHJpbWFyeSlcIj5GYXNlIDE8L2I+IFx1MjAxNCBDYXJnXHUwMEUxIGxvcyBTYWxlcyBQbGFucyBtZW5zdWFsZXMgKFJvZHMgLyBSZWVscykuIFNlIHBhcnNlYSBsYSBob2phIDxiPlNBUjwvYj46IFNLVSwgTU9RIDEyIG1vbnRocywgeSB1bmEgY29sdW1uYSBwb3IgbWVzLiAnICtcbiAgICAnRWwgRXhjZWwgb3JpZ2luYWwgcXVlZGEgc25hcHNob3RhZG8gZW4gU3RvcmFnZSB5IGVsIHBhcnNlbyBxdWVkYSBlbiBGaXJlc3RvcmUgcGFyYSBlbCBjXHUwMEUxbGN1bG8gZGViYWpvLicgK1xuICAgICc8L2Rpdj4nO1xuICBjb25zdCBncmlkID1cbiAgICAnPGRpdiBzdHlsZT1cImRpc3BsYXk6Z3JpZDtncmlkLXRlbXBsYXRlLWNvbHVtbnM6cmVwZWF0KGF1dG8tZml0LG1pbm1heCgzMjBweCwxZnIpKTtnYXA6MTZweDttYXJnaW4tYm90dG9tOjI0cHhcIj4nICtcbiAgICBzbG90cyArXG4gICAgJzwvZGl2Pic7XG4gIC8vIHYxMTA5OiBjb250ZW5lZG9yIHBhcmEgdGFibGEgUmVjb21lbmRhY2lcdTAwRjNuIGRlIENvbXByYS4gU2UgcmVsbGVuYSBvbi1kZW1hbmRcbiAgLy8gdmlhIF9yZW5kZXJSZWNvU2VjdGlvbigpIChsYXp5IGxvYWQgZGUgc3RvY2tfc25hcHNob3QgKyBza3VfdmVudGFzX3NuYXBzaG90KS5cbiAgY29uc3QgcmVjb1NlY3Rpb24gPSAnPGRpdiBpZD1cInJlY28tc2VjdGlvbi1jb250YWluZXJcIj48L2Rpdj4nO1xuICBjb250LmlubmVySFRNTCA9ICc8ZGl2IHN0eWxlPVwicGFkZGluZzoxOHB4XCI+JyArIGludHJvICsgZ3JpZCArIHJlY29TZWN0aW9uICsgJzwvZGl2Pic7XG4gIF9yZW5kZXJSZWNvU2VjdGlvbigpO1xufVxuXG53aW5kb3cub25TYWxlc1BsYW5GaWxlRm9yRmFtaWxpYSA9IGFzeW5jIGZ1bmN0aW9uIChldmVudCwgZmFtaWxpYSkge1xuICBjb25zdCBmaWxlID0gZXZlbnQgJiYgZXZlbnQudGFyZ2V0ICYmIGV2ZW50LnRhcmdldC5maWxlcyAmJiBldmVudC50YXJnZXQuZmlsZXNbMF07XG4gIGlmICghZmlsZSkgcmV0dXJuO1xuICBjb25zdCBzdGF0dXNFbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdzYWxlcy1wbGFuLXN0YXR1cy0nICsgZmFtaWxpYSk7XG4gIGNvbnN0IHNldFN0YXR1cyA9IChtc2csIGNvbG9yKSA9PiB7XG4gICAgaWYgKCFzdGF0dXNFbCkgcmV0dXJuO1xuICAgIHN0YXR1c0VsLnRleHRDb250ZW50ID0gbXNnO1xuICAgIHN0YXR1c0VsLnN0eWxlLmNvbG9yID0gY29sb3IgfHwgJ3ZhcigtLXRleHQtbXV0ZWQpJztcbiAgfTtcbiAgdHJ5IHtcbiAgICBpZiAodHlwZW9mIFhMU1ggPT09ICd1bmRlZmluZWQnKSB7XG4gICAgICBhbGVydCgnU2hlZXRKUyAoWExTWCkgbm8gY2FyZ2FkbyBcdTIwMTQgcmVjYXJnXHUwMEUxIGxhIGFwcC4nKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgaWYgKCF3aW5kb3cuU2FsZXNQbGFuUGFyc2VyIHx8ICF3aW5kb3cuU2FsZXNQbGFuUGFyc2VyLnBhcnNlU2FsZXNQbGFuU2hlZXQpIHtcbiAgICAgIGFsZXJ0KCdQYXJzZXIgU2FsZXMgUGxhbiBubyBjYXJnYWRvLiBSZWJ1aWxkIGJ1bmRsZS4nKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgaWYgKCF3aW5kb3cuZmlyZWJhc2UgfHwgIXdpbmRvdy5maXJlYmFzZS5zdG9yYWdlKSB7XG4gICAgICBhbGVydCgnRmlyZWJhc2UgU3RvcmFnZSBubyBkaXNwb25pYmxlLicpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBzZXRTdGF0dXMoJ0xleWVuZG8gRXhjZWxcdTIwMjYnKTtcbiAgICBjb25zdCBidWYgPSBhd2FpdCBmaWxlLmFycmF5QnVmZmVyKCk7XG4gICAgY29uc3Qgd2IgPSBYTFNYLnJlYWQoYnVmLCB7IHR5cGU6ICdhcnJheScgfSk7XG4gICAgY29uc3Qgc2FyTmFtZSA9IHdiLlNoZWV0TmFtZXMuZmluZChcbiAgICAgIChuKSA9PlxuICAgICAgICBTdHJpbmcobiB8fCAnJylcbiAgICAgICAgICAudHJpbSgpXG4gICAgICAgICAgLnRvVXBwZXJDYXNlKCkgPT09ICdTQVInXG4gICAgKTtcbiAgICBpZiAoIXNhck5hbWUpIHtcbiAgICAgIHNldFN0YXR1cyhcbiAgICAgICAgJ1x1MjZBMCBFbCBFeGNlbCBubyB0aWVuZSBob2phIFwiU0FSXCIuIEhvamFzIGVuY29udHJhZGFzOiAnICsgd2IuU2hlZXROYW1lcy5qb2luKCcsICcpLFxuICAgICAgICAnI2RjMjYyNidcbiAgICAgICk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGNvbnN0IHNoZWV0ID0gd2IuU2hlZXRzW3Nhck5hbWVdO1xuICAgIGNvbnN0IHJvd3MgPSBYTFNYLnV0aWxzLnNoZWV0X3RvX2pzb24oc2hlZXQsIHsgaGVhZGVyOiAxLCBkZWZ2YWw6ICcnLCByYXc6IHRydWUgfSk7XG4gICAgc2V0U3RhdHVzKCdQYXJzZWFuZG8gJyArIHJvd3MubGVuZ3RoICsgJyBmaWxhcyBkZSBob2phIFwiJyArIHNhck5hbWUgKyAnXCJcdTIwMjYnKTtcbiAgICBjb25zdCBwYXJzZWQgPSB3aW5kb3cuU2FsZXNQbGFuUGFyc2VyLnBhcnNlU2FsZXNQbGFuU2hlZXQocm93cyk7XG4gICAgaWYgKCFwYXJzZWQucm93cy5sZW5ndGgpIHtcbiAgICAgIHNldFN0YXR1cygnXHUyNkEwIEV4Y2VsIHBhcnNlYWRvIHBlcm8gc2luIFNLVXMgdlx1MDBFMWxpZG9zLicsICcjZGMyNjI2Jyk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGNvbnN0IHllYXJNb250aCA9IF95ZWFyTW9udGhOb3coKTtcbiAgICBjb25zdCBzdG9yYWdlUGF0aCA9ICdmb3JlY2FzdHNfc25hcHNob3RzLycgKyB5ZWFyTW9udGggKyAnLycgKyBmYW1pbGlhICsgJy54bHN4JztcbiAgICBzZXRTdGF0dXMoJ1N1YmllbmRvIEV4Y2VsIGEgU3RvcmFnZSAoJyArIF9mbXRTaXplKGZpbGUuc2l6ZSkgKyAnKVx1MjAyNicpO1xuICAgIGNvbnN0IHN0b3JhZ2VSZWYgPSB3aW5kb3cuZmlyZWJhc2Uuc3RvcmFnZSgpLnJlZihzdG9yYWdlUGF0aCk7XG4gICAgYXdhaXQgc3RvcmFnZVJlZi5wdXQoZmlsZSwge1xuICAgICAgY29udGVudFR5cGU6IGZpbGUudHlwZSB8fCAnYXBwbGljYXRpb24vdm5kLm9wZW54bWxmb3JtYXRzLW9mZmljZWRvY3VtZW50LnNwcmVhZHNoZWV0bWwuc2hlZXQnLFxuICAgICAgY3VzdG9tTWV0YWRhdGE6IHtcbiAgICAgICAgZmFtaWxpYSxcbiAgICAgICAgdXBsb2FkZWRCeTogKHdpbmRvdy5jdXJyZW50VXNlciAmJiB3aW5kb3cuY3VycmVudFVzZXIuZW1haWwpIHx8ICcnLFxuICAgICAgICBzb3VyY2VGaWxlbmFtZTogZmlsZS5uYW1lIHx8ICcnLFxuICAgICAgfSxcbiAgICB9KTtcbiAgICBzZXRTdGF0dXMoJ0d1YXJkYW5kbyBwYXJzZW8gZW4gRmlyZXN0b3JlICgnICsgcGFyc2VkLnJvd3MubGVuZ3RoICsgJyBTS1VzKVx1MjAyNicpO1xuICAgIGNvbnN0IHVwbG9hZGVkQnkgPSAod2luZG93LmN1cnJlbnRVc2VyICYmIHdpbmRvdy5jdXJyZW50VXNlci5lbWFpbCkgfHwgJ3Vua25vd24nO1xuICAgIGNvbnN0IHBheWxvYWQgPSB7XG4gICAgICBmYW1pbGlhLFxuICAgICAgcGFyc2VkQXQ6XG4gICAgICAgIHdpbmRvdy5maXJlYmFzZSAmJiB3aW5kb3cuZmlyZWJhc2UuZmlyZXN0b3JlICYmIHdpbmRvdy5maXJlYmFzZS5maXJlc3RvcmUuRmllbGRWYWx1ZVxuICAgICAgICAgID8gd2luZG93LmZpcmViYXNlLmZpcmVzdG9yZS5GaWVsZFZhbHVlLnNlcnZlclRpbWVzdGFtcCgpXG4gICAgICAgICAgOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICB1cGxvYWRlZEJ5LFxuICAgICAgc291cmNlRmlsZW5hbWU6IGZpbGUubmFtZSB8fCAnJyxcbiAgICAgIHNvdXJjZVNoZWV0OiBzYXJOYW1lLFxuICAgICAgeWVhck1vbnRoLFxuICAgICAgc3RvcmFnZVBhdGgsXG4gICAgICByb3dzQ291bnQ6IHBhcnNlZC5yb3dzLmxlbmd0aCxcbiAgICAgIGhlYWRlclJvd0luZGV4OiBwYXJzZWQuaGVhZGVyUm93SW5kZXgsXG4gICAgICBkZXRlY3RlZE1vbnRoczogcGFyc2VkLmRldGVjdGVkTW9udGhzLFxuICAgICAgcm93czogcGFyc2VkLnJvd3MsXG4gICAgfTtcbiAgICBhd2FpdCB3aW5kb3cuZmJEYi5jb2xsZWN0aW9uKCdzYWxlc19wbGFuX2NhY2hlJykuZG9jKGZhbWlsaWEpLnNldChwYXlsb2FkKTtcbiAgICAvLyB2MTEwNyBmaXg6IGd1YXJkYXIgY2FjaGUgbG9jYWwgY29uIERhdGUgcmVhbCAobm8gZWwgU2VudGluZWxWYWx1ZSkgcGFyYVxuICAgIC8vIHF1ZSBfZm10RGF0ZVNob3J0IG5vIG11ZXN0cmUgXCJJbnZhbGlkIERhdGVcIi4gRWwgc2VydmVyIHRpZW5lIGVsIHRzIGV4YWN0byxcbiAgICAvLyBlbCBsb2NhbCBtdWVzdHJhIGVsIG1vbWVudG8gZGVsIHVwbG9hZCAoYXByb3hpbWFkbyB+MXMgZGUgZGlmZXJlbmNpYSkuXG4gICAgX3NhbGVzUGxhbkNhY2hlc1tmYW1pbGlhXSA9IE9iamVjdC5hc3NpZ24oe30sIHBheWxvYWQsIHsgcGFyc2VkQXQ6IG5ldyBEYXRlKCkgfSk7XG4gICAgc2V0U3RhdHVzKFxuICAgICAgJ1x1MjcxMyBPSy4gJyArIHBhcnNlZC5yb3dzLmxlbmd0aCArICcgU0tVcyBcdTAwRDcgJyArIHBhcnNlZC5kZXRlY3RlZE1vbnRocy5sZW5ndGggKyAnIG1lc2VzLicsXG4gICAgICAnIzE2YTM0YSdcbiAgICApO1xuICAgIF9yZW5kZXJTYWxlc1BsYW5zVGFiKCk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBjb25zb2xlLmVycm9yKCdbRk9SRUNBU1RdIHVwbG9hZCBzYWxlcyBwbGFuICcgKyBmYW1pbGlhICsgJyBmYWlsOicsIGUpO1xuICAgIHNldFN0YXR1cygnXHUyNzE3IEVycm9yOiAnICsgKChlICYmIGUubWVzc2FnZSkgfHwgZSksICcjZGMyNjI2Jyk7XG4gICAgaWYgKGUgJiYgZS5jb2RlID09PSAnTU9OVEhTX05PVF9GT1VORCcpIHtcbiAgICAgIGFsZXJ0KFxuICAgICAgICAnRWwgRXhjZWwgbm8gdGllbmUgY29sdW1uYXMgZGUgbWVzZXMgcmVjb25vY2libGVzLlxcblxcbkhlYWRlcnMgZXNwZXJhZG9zOiBcIkphbiAyMDI3XCIsIFwiTWF5IDIwMjdcIiwgXCJFbmUgMjAyN1wiLCBcIjIwMjctMDFcIiwgZXRjLlxcblxcbkRldGFsbGU6ICcgK1xuICAgICAgICAgIGUubWVzc2FnZVxuICAgICAgKTtcbiAgICB9XG4gIH0gZmluYWxseSB7XG4gICAgaWYgKGV2ZW50ICYmIGV2ZW50LnRhcmdldCkgZXZlbnQudGFyZ2V0LnZhbHVlID0gJyc7XG4gIH1cbn07XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gRjJCIFx1MjAxNCBGb3JlY2FzdCBFc3RhZFx1MDBFRHN0aWNvOiB0YWJsYSArIGRldGFsbGVcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5hc3luYyBmdW5jdGlvbiBfbG9hZEZvcmVjYXN0T3V0cHV0KCkge1xuICBpZiAoIXdpbmRvdy5mYkRiKSB0aHJvdyBuZXcgRXJyb3IoJ0ZpcmVzdG9yZSBubyBpbmljaWFsaXphZG8nKTtcbiAgY29uc29sZS5sb2coJ1tGT1JFQ0FTVCBzdGF0XSBsb2FkaW5nIGZvcmVjYXN0X291dHB1dC4uLicpO1xuICBjb25zdCBbc25hcCwgbWV0YURvY10gPSBhd2FpdCBQcm9taXNlLmFsbChbXG4gICAgd2luZG93LmZiRGIuY29sbGVjdGlvbignZm9yZWNhc3Rfb3V0cHV0JykuZ2V0KCksXG4gICAgd2luZG93LmZiRGIuY29sbGVjdGlvbignZm9yZWNhc3Rfb3V0cHV0X21ldGEnKS5kb2MoJ2N1cnJlbnQnKS5nZXQoKSxcbiAgXSk7XG4gIGNvbnN0IGRvY3MgPSBbXTtcbiAgc25hcC5mb3JFYWNoKChkKSA9PiBkb2NzLnB1c2goT2JqZWN0LmFzc2lnbih7IGlkOiBkLmlkIH0sIGQuZGF0YSgpKSkpO1xuICBkb2NzLnNvcnQoKGEsIGIpID0+IHtcbiAgICBjb25zdCB3YSA9IChhLm1ldHJpY3MgJiYgYS5tZXRyaWNzLndhcGUpIHx8IDk5OTtcbiAgICBjb25zdCB3YiA9IChiLm1ldHJpY3MgJiYgYi5tZXRyaWNzLndhcGUpIHx8IDk5OTtcbiAgICByZXR1cm4gd2EgLSB3YjtcbiAgfSk7XG4gIF9mb3JlY2FzdFN0YXREb2NzID0gZG9jcztcbiAgX2ZvcmVjYXN0U3RhdE1ldGEgPSBtZXRhRG9jLmV4aXN0cyA/IG1ldGFEb2MuZGF0YSgpIDogbnVsbDtcbiAgY29uc29sZS5sb2coJ1tGT1JFQ0FTVCBzdGF0XSBsb2FkZWQnLCBkb2NzLmxlbmd0aCwgJ2RvY3MgXHUwMEI3IG1ldGE6JywgISFfZm9yZWNhc3RTdGF0TWV0YSk7XG4gIHJldHVybiBkb2NzO1xufVxuXG5mdW5jdGlvbiBfd2FwZUJhZGdlQ29sb3Iodykge1xuICBpZiAodyA9PSBudWxsKSByZXR1cm4gJyM2NDc0OGInO1xuICBpZiAodyA8IDAuMykgcmV0dXJuICcjMTZhMzRhJzsgLy8gdmVyZGUgLSBleGNlbGVudGVcbiAgaWYgKHcgPCAwLjUpIHJldHVybiAnIzg0Y2MxNic7IC8vIGxpbWEgLSBidWVub1xuICBpZiAodyA8IDAuNykgcmV0dXJuICcjZWFiMzA4JzsgLy8gYW1hcmlsbG8gLSBhY2VwdGFibGVcbiAgaWYgKHcgPCAxLjApIHJldHVybiAnI2Y5NzMxNic7IC8vIG5hcmFuamEgLSBwb2JyZVxuICByZXR1cm4gJyNkYzI2MjYnOyAvLyByb2pvIC0gbXV5IHBvYnJlXG59XG5cbmZ1bmN0aW9uIF9mbXROdW0obikge1xuICBpZiAobiA9PSBudWxsIHx8ICFOdW1iZXIuaXNGaW5pdGUoTnVtYmVyKG4pKSkgcmV0dXJuICdcdTIwMTQnO1xuICByZXR1cm4gTnVtYmVyKG4pLnRvTG9jYWxlU3RyaW5nKCdlcy1BUicsIHsgbWF4aW11bUZyYWN0aW9uRGlnaXRzOiAwIH0pO1xufVxuXG5mdW5jdGlvbiBfZm10V2FwZSh3KSB7XG4gIGlmICh3ID09IG51bGwgfHwgIU51bWJlci5pc0Zpbml0ZShOdW1iZXIodykpKSByZXR1cm4gJ1x1MjAxNCc7XG4gIHJldHVybiAoTnVtYmVyKHcpICogMTAwKS50b0ZpeGVkKDApICsgJyUnO1xufVxuXG5mdW5jdGlvbiBfZm10RHNTaG9ydChpc28pIHtcbiAgLy8gJzIwMjYtMTAtMDEnIC0+ICdvY3QgMjYnXG4gIHRyeSB7XG4gICAgY29uc3QgW3ksIG1dID0gaXNvLnNwbGl0KCctJykubWFwKE51bWJlcik7XG4gICAgY29uc3QgbmFtZXMgPSBbXG4gICAgICAnZW5lJyxcbiAgICAgICdmZWInLFxuICAgICAgJ21hcicsXG4gICAgICAnYWJyJyxcbiAgICAgICdtYXknLFxuICAgICAgJ2p1bicsXG4gICAgICAnanVsJyxcbiAgICAgICdhZ28nLFxuICAgICAgJ3NlcCcsXG4gICAgICAnb2N0JyxcbiAgICAgICdub3YnLFxuICAgICAgJ2RpYycsXG4gICAgXTtcbiAgICByZXR1cm4gbmFtZXNbbSAtIDFdICsgJyAnICsgU3RyaW5nKHkpLnNsaWNlKC0yKTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIGlzbztcbiAgfVxufVxuXG5mdW5jdGlvbiBfcmVuZGVyRm9yZWNhc3RTdGF0VGFiKCkge1xuICBjb25zdCBjb250ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2ZvcmVjYXN0LXRhYi1zdGF0Jyk7XG4gIGlmICghY29udCkgcmV0dXJuO1xuICB0cnkge1xuICAgIF9yZW5kZXJGb3JlY2FzdFN0YXRUYWJJbXBsKGNvbnQpO1xuICB9IGNhdGNoIChlKSB7XG4gICAgY29uc29sZS5lcnJvcignW0ZPUkVDQVNUIHN0YXRdIHJlbmRlciBmYWlsJywgZSk7XG4gICAgY29udC5pbm5lckhUTUwgPVxuICAgICAgJzxkaXYgc3R5bGU9XCJwYWRkaW5nOjQwcHggMjBweDtjb2xvcjojZGMyNjI2O2xpbmUtaGVpZ2h0OjEuNlwiPicgK1xuICAgICAgJzxkaXYgc3R5bGU9XCJmb250LXNpemU6MTZweDtmb250LXdlaWdodDo3MDA7bWFyZ2luLWJvdHRvbToxMHB4XCI+RXJyb3IgcmVuZGVyaXphbmRvIHRhYiBGb3JlY2FzdCBFc3RhZFx1MDBFRHN0aWNvPC9kaXY+JyArXG4gICAgICAnPHByZSBzdHlsZT1cImZvbnQtc2l6ZToxMXB4O2JhY2tncm91bmQ6I2ZlZjJmMjtwYWRkaW5nOjEycHg7Ym9yZGVyLXJhZGl1czo2cHg7b3ZlcmZsb3c6YXV0bzt3aGl0ZS1zcGFjZTpwcmUtd3JhcFwiPicgK1xuICAgICAgZXNjYXBlSHRtbFNhZmUoZS5zdGFjayB8fCBlLm1lc3NhZ2UgfHwgU3RyaW5nKGUpKSArXG4gICAgICAnPC9wcmU+PC9kaXY+JztcbiAgfVxufVxuXG5mdW5jdGlvbiBfcmVuZGVyRm9yZWNhc3RTdGF0VGFiSW1wbChjb250KSB7XG4gIGNvbnN0IGRvY3MgPSBfZm9yZWNhc3RTdGF0RG9jcyB8fCBbXTtcbiAgY29uc3QgbWV0YSA9IF9mb3JlY2FzdFN0YXRNZXRhIHx8IHt9O1xuICBjb25zdCByZXN1bWVuID0gbWV0YS5yZXN1bWVuIHx8IHt9O1xuICBjb25zb2xlLmxvZygnW0ZPUkVDQVNUIHN0YXRdIHJlbmRlciBcdTIwMTQgZG9jczonLCBkb2NzLmxlbmd0aCwgJ21ldGE6JywgISFtZXRhLmdlbmVyYXRlZEF0KTtcbiAgaWYgKCFkb2NzLmxlbmd0aCkge1xuICAgIGNvbnQuaW5uZXJIVE1MID1cbiAgICAgICc8ZGl2IHN0eWxlPVwicGFkZGluZzo2MHB4IDIwcHg7dGV4dC1hbGlnbjpjZW50ZXI7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZClcIj4nICtcbiAgICAgICdObyBoYXkgZm9yZWNhc3Rfb3V0cHV0IHB1YmxpY2Fkby48YnI+PGJyPicgK1xuICAgICAgJ0NvcnJlciA8Y29kZT5weXRob24gc2NyaXB0cy9mb3JlY2FzdC90cmFpbl9wcm9kLnB5ICYmIHB5dGhvbiBzY3JpcHRzL2ZvcmVjYXN0L3B1Ymxpc2hfdG9fZmlyZXN0b3JlLnB5PC9jb2RlPi4nICtcbiAgICAgICc8L2Rpdj4nO1xuICAgIHJldHVybjtcbiAgfVxuICAvLyBNZXNlcyBkZWwgZm9yZWNhc3QgKGRzIGRlbCBwcmltZXIgZG9jLCBzZSBhc3VtZSBpZ3VhbCBlbiB0b2RvcykuXG4gIGNvbnN0IG1vbnRoc0lzbyA9IChkb2NzWzBdLmZvcmVjYXN0IHx8IFtdKS5tYXAoKGYpID0+IGYuZHMpO1xuICBjb25zdCBtb250aEhlYWRlcnMgPSBtb250aHNJc28ubWFwKF9mbXREc1Nob3J0KTtcblxuICAvLyBNZXRyaWNzIGNoaXAgZ2xvYmFsXG4gIGNvbnN0IGdlbmVyYXRlZCA9IG1ldGEuZ2VuZXJhdGVkQXRcbiAgICA/IG5ldyBEYXRlKG1ldGEuZ2VuZXJhdGVkQXQpLnRvTG9jYWxlU3RyaW5nKCdlcy1BUicsIHtcbiAgICAgICAgZGF5OiAnMi1kaWdpdCcsXG4gICAgICAgIG1vbnRoOiAnc2hvcnQnLFxuICAgICAgICB5ZWFyOiAnMi1kaWdpdCcsXG4gICAgICAgIGhvdXI6ICcyLWRpZ2l0JyxcbiAgICAgICAgbWludXRlOiAnMi1kaWdpdCcsXG4gICAgICB9KVxuICAgIDogJ1x1MjAxNCc7XG4gIGNvbnN0IHdhcGVNZWQgPVxuICAgIHJlc3VtZW4ud2FwZV9tZWRpYW5vX2Jlc3RfcGVyX3NlcmllcyAhPSBudWxsXG4gICAgICA/IF9mbXRXYXBlKHJlc3VtZW4ud2FwZV9tZWRpYW5vX2Jlc3RfcGVyX3NlcmllcylcbiAgICAgIDogJ1x1MjAxNCc7XG4gIGNvbnN0IG5TdWJzID0gcmVzdW1lbi5uX3N1YmZhbWlsaWFzIHx8IGRvY3MubGVuZ3RoO1xuICBjb25zdCBuTHQwNSA9XG4gICAgcmVzdW1lbi5uX3Nlcmllc193YXBlX2x0XzBfNSAhPSBudWxsID8gcmVzdW1lbi5uX3Nlcmllc193YXBlX2x0XzBfNSArICcvJyArIG5TdWJzIDogJ1x1MjAxNCc7XG4gIGNvbnN0IG5MdDAzID1cbiAgICByZXN1bWVuLm5fc2VyaWVzX3dhcGVfbHRfMF8zICE9IG51bGwgPyByZXN1bWVuLm5fc2VyaWVzX3dhcGVfbHRfMF8zICsgJy8nICsgblN1YnMgOiAnXHUyMDE0JztcblxuICBjb25zdCBiYW5uZXIgPVxuICAgICc8ZGl2IHN0eWxlPVwibWFyZ2luLWJvdHRvbToxNHB4O3BhZGRpbmc6MTJweCAxNHB4O2JhY2tncm91bmQ6dmFyKC0tYmctc2Vjb25kYXJ5KTtib3JkZXItbGVmdDozcHggc29saWQgIzBkOTQ4ODtib3JkZXItcmFkaXVzOjZweDtmb250LXNpemU6MTJweDtjb2xvcjp2YXIoLS10ZXh0LXNlY29uZGFyeSk7bGluZS1oZWlnaHQ6MS41O2Rpc3BsYXk6Z3JpZDtncmlkLXRlbXBsYXRlLWNvbHVtbnM6cmVwZWF0KGF1dG8tZml0LG1pbm1heCgxNjBweCwxZnIpKTtnYXA6MTBweFwiPicgK1xuICAgICc8ZGl2PjxkaXYgc3R5bGU9XCJmb250LXNpemU6MTBweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7bGV0dGVyLXNwYWNpbmc6LjRweFwiPldBUEUgbWVkaWFubzwvZGl2PjxkaXYgc3R5bGU9XCJmb250LXNpemU6MjBweDtmb250LXdlaWdodDo4MDA7Y29sb3I6dmFyKC0tdGV4dC1wcmltYXJ5KVwiPicgK1xuICAgIHdhcGVNZWQgK1xuICAgICc8L2Rpdj48L2Rpdj4nICtcbiAgICAnPGRpdj48ZGl2IHN0eWxlPVwiZm9udC1zaXplOjEwcHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO2xldHRlci1zcGFjaW5nOi40cHhcIj5TdWJmYW1pbGlhczwvZGl2PjxkaXYgc3R5bGU9XCJmb250LXNpemU6MjBweDtmb250LXdlaWdodDo4MDA7Y29sb3I6dmFyKC0tdGV4dC1wcmltYXJ5KVwiPicgK1xuICAgIG5TdWJzICtcbiAgICAnPC9kaXY+PC9kaXY+JyArXG4gICAgJzxkaXY+PGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMHB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtsZXR0ZXItc3BhY2luZzouNHB4XCI+V0FQRSAmbHQ7IDMwJSAoZXhjZWxlbnRlKTwvZGl2PjxkaXYgc3R5bGU9XCJmb250LXNpemU6MjBweDtmb250LXdlaWdodDo4MDA7Y29sb3I6IzE2YTM0YVwiPicgK1xuICAgIG5MdDAzICtcbiAgICAnPC9kaXY+PC9kaXY+JyArXG4gICAgJzxkaXY+PGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMHB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtsZXR0ZXItc3BhY2luZzouNHB4XCI+V0FQRSAmbHQ7IDUwJSAoYnVlbm8pPC9kaXY+PGRpdiBzdHlsZT1cImZvbnQtc2l6ZToyMHB4O2ZvbnQtd2VpZ2h0OjgwMDtjb2xvcjojODRjYzE2XCI+JyArXG4gICAgbkx0MDUgK1xuICAgICc8L2Rpdj48L2Rpdj4nICtcbiAgICAnPGRpdj48ZGl2IHN0eWxlPVwiZm9udC1zaXplOjEwcHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO2xldHRlci1zcGFjaW5nOi40cHhcIj5cdTAwREFsdGltYSBjb3JyaWRhPC9kaXY+PGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxM3B4O2ZvbnQtd2VpZ2h0OjYwMDtjb2xvcjp2YXIoLS10ZXh0LXByaW1hcnkpO21hcmdpbi10b3A6NHB4XCI+JyArXG4gICAgZXNjYXBlSHRtbFNhZmUoZ2VuZXJhdGVkKSArXG4gICAgJzwvZGl2PjwvZGl2PicgK1xuICAgICc8L2Rpdj4nO1xuXG4gIC8vIFRhYmxhIHJvd3NcbiAgY29uc3Qgcm93c0h0bWwgPSBkb2NzXG4gICAgLm1hcCgoZCkgPT4ge1xuICAgICAgY29uc3Qgd2FwZSA9IGQubWV0cmljcyAmJiBkLm1ldHJpY3Mud2FwZSAhPSBudWxsID8gZC5tZXRyaWNzLndhcGUgOiBudWxsO1xuICAgICAgY29uc3QgYmVzdE1vZGVsID0gZC5iZXN0TW9kZWwgfHwgJ1x1MjAxNCc7XG4gICAgICBjb25zdCBmb3JlY2FzdE1hcCA9IHt9O1xuICAgICAgKGQuZm9yZWNhc3QgfHwgW10pLmZvckVhY2goKGYpID0+IHtcbiAgICAgICAgZm9yZWNhc3RNYXBbZi5kc10gPSBmLnlfaGF0O1xuICAgICAgfSk7XG4gICAgICBjb25zdCBtb250aENlbGxzID0gbW9udGhzSXNvXG4gICAgICAgIC5tYXAoXG4gICAgICAgICAgKGRzKSA9PlxuICAgICAgICAgICAgJzx0ZCBzdHlsZT1cInBhZGRpbmc6OHB4IDEwcHg7dGV4dC1hbGlnbjpyaWdodDtmb250LXZhcmlhbnQtbnVtZXJpYzp0YWJ1bGFyLW51bXM7Zm9udC13ZWlnaHQ6NjAwO2NvbG9yOnZhcigtLXRleHQtcHJpbWFyeSlcIj4nICtcbiAgICAgICAgICAgIF9mbXROdW0oZm9yZWNhc3RNYXBbZHNdKSArXG4gICAgICAgICAgICAnPC90ZD4nXG4gICAgICAgIClcbiAgICAgICAgLmpvaW4oJycpO1xuICAgICAgY29uc3QgdG90YWw3ID0gKGQuZm9yZWNhc3QgfHwgW10pLnJlZHVjZSgocywgZikgPT4gcyArIChOdW1iZXIoZi55X2hhdCkgfHwgMCksIDApO1xuICAgICAgcmV0dXJuIChcbiAgICAgICAgJzx0ciBvbmNsaWNrPVwib3BlbkZvcmVjYXN0U3RhdERldGFpbChcXCcnICtcbiAgICAgICAgZXNjYXBlSHRtbFNhZmUoZC5pZCkgK1xuICAgICAgICAnXFwnKVwiIHN0eWxlPVwiY3Vyc29yOnBvaW50ZXI7Ym9yZGVyLWJvdHRvbToxcHggc29saWQgdmFyKC0tYm9yZGVyLXN1YnRsZSlcIiBvbm1vdXNlb3Zlcj1cInRoaXMuc3R5bGUuYmFja2dyb3VuZD1cXCd2YXIoLS1iZy1zZWNvbmRhcnkpXFwnXCIgb25tb3VzZW91dD1cInRoaXMuc3R5bGUuYmFja2dyb3VuZD1cXCd0cmFuc3BhcmVudFxcJ1wiPicgK1xuICAgICAgICAnPHRkIHN0eWxlPVwicGFkZGluZzo4cHggMTBweDtmb250LXdlaWdodDo3MDA7Y29sb3I6dmFyKC0tdGV4dC1wcmltYXJ5KVwiPicgK1xuICAgICAgICBlc2NhcGVIdG1sU2FmZShkLnN1YmZhbWlsaWEgfHwgZC5pZCkgK1xuICAgICAgICAnPC90ZD4nICtcbiAgICAgICAgJzx0ZCBzdHlsZT1cInBhZGRpbmc6OHB4IDEwcHg7Zm9udC1zaXplOjExcHg7Y29sb3I6dmFyKC0tdGV4dC1zZWNvbmRhcnkpXCI+JyArXG4gICAgICAgIGVzY2FwZUh0bWxTYWZlKGJlc3RNb2RlbCkgK1xuICAgICAgICAnPC90ZD4nICtcbiAgICAgICAgJzx0ZCBzdHlsZT1cInBhZGRpbmc6OHB4IDEwcHg7dGV4dC1hbGlnbjpjZW50ZXJcIj48c3BhbiBzdHlsZT1cImRpc3BsYXk6aW5saW5lLWJsb2NrO3BhZGRpbmc6M3B4IDhweDtib3JkZXItcmFkaXVzOjEycHg7YmFja2dyb3VuZDonICtcbiAgICAgICAgX3dhcGVCYWRnZUNvbG9yKHdhcGUpICtcbiAgICAgICAgJztjb2xvcjojZmZmO2ZvbnQtc2l6ZToxMXB4O2ZvbnQtd2VpZ2h0OjcwMFwiPicgK1xuICAgICAgICBfZm10V2FwZSh3YXBlKSArXG4gICAgICAgICc8L3NwYW4+PC90ZD4nICtcbiAgICAgICAgbW9udGhDZWxscyArXG4gICAgICAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjhweCAxMHB4O3RleHQtYWxpZ246cmlnaHQ7Zm9udC12YXJpYW50LW51bWVyaWM6dGFidWxhci1udW1zO2ZvbnQtd2VpZ2h0OjcwMDtjb2xvcjojMGQ5NDg4O2JhY2tncm91bmQ6dmFyKC0tYmctc2Vjb25kYXJ5KVwiPicgK1xuICAgICAgICBfZm10TnVtKHRvdGFsNykgK1xuICAgICAgICAnPC90ZD4nICtcbiAgICAgICAgJzwvdHI+J1xuICAgICAgKTtcbiAgICB9KVxuICAgIC5qb2luKCcnKTtcblxuICBjb25zdCBtb250aEhlYWRlcnNIdG1sID0gbW9udGhIZWFkZXJzXG4gICAgLm1hcChcbiAgICAgIChtKSA9PlxuICAgICAgICAnPHRoIHN0eWxlPVwicGFkZGluZzo4cHggMTBweDt0ZXh0LWFsaWduOnJpZ2h0O2ZvbnQtc2l6ZToxMHB4O3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtsZXR0ZXItc3BhY2luZzouNHB4O2NvbG9yOiM5NGEzYjhcIj4nICtcbiAgICAgICAgZXNjYXBlSHRtbFNhZmUobSkgK1xuICAgICAgICAnPC90aD4nXG4gICAgKVxuICAgIC5qb2luKCcnKTtcblxuICBjb25zdCB0YWJsZSA9XG4gICAgJzxkaXYgc3R5bGU9XCJvdmVyZmxvdzphdXRvO2JvcmRlcjoxcHggc29saWQgdmFyKC0tYm9yZGVyLXN1YnRsZSk7Ym9yZGVyLXJhZGl1czo4cHhcIj4nICtcbiAgICAnPHRhYmxlIHN0eWxlPVwid2lkdGg6MTAwJTtib3JkZXItY29sbGFwc2U6Y29sbGFwc2U7Zm9udC1zaXplOjEycHhcIj4nICtcbiAgICAnPHRoZWFkIHN0eWxlPVwiYmFja2dyb3VuZDojMGYxNzJhO2NvbG9yOiNmZmZcIj48dHI+JyArXG4gICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6OHB4IDEwcHg7dGV4dC1hbGlnbjpsZWZ0O2ZvbnQtc2l6ZToxMHB4O3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtsZXR0ZXItc3BhY2luZzouNHB4XCI+U3ViZmFtaWxpYTwvdGg+JyArXG4gICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6OHB4IDEwcHg7dGV4dC1hbGlnbjpsZWZ0O2ZvbnQtc2l6ZToxMHB4O3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtsZXR0ZXItc3BhY2luZzouNHB4XCI+TW9kZWxvPC90aD4nICtcbiAgICAnPHRoIHN0eWxlPVwicGFkZGluZzo4cHggMTBweDt0ZXh0LWFsaWduOmNlbnRlcjtmb250LXNpemU6MTBweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7bGV0dGVyLXNwYWNpbmc6LjRweFwiPldBUEU8L3RoPicgK1xuICAgIG1vbnRoSGVhZGVyc0h0bWwgK1xuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjhweCAxMHB4O3RleHQtYWxpZ246cmlnaHQ7Zm9udC1zaXplOjEwcHg7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO2xldHRlci1zcGFjaW5nOi40cHg7YmFja2dyb3VuZDojMTM0ZTRhXCI+VG90YWwgN208L3RoPicgK1xuICAgICc8L3RyPjwvdGhlYWQ+JyArXG4gICAgJzx0Ym9keT4nICtcbiAgICByb3dzSHRtbCArXG4gICAgJzwvdGJvZHk+PC90YWJsZT48L2Rpdj4nO1xuXG4gIGNvbnN0IGZvb3RlciA9XG4gICAgJzxkaXYgc3R5bGU9XCJtYXJnaW4tdG9wOjEycHg7Zm9udC1zaXplOjExcHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7bGluZS1oZWlnaHQ6MS41XCI+JyArXG4gICAgJzxiPkNcdTAwRjNtbyBsZWVyPC9iPjogV0FQRSAoV2VpZ2h0ZWQgQWJzb2x1dGUgUGVyY2VudGFnZSBFcnJvcikgbWlkZSBlbCBlcnJvciBkZWwgbW9kZWxvIHJlbGF0aXZvIGFsIHRvdGFsIHJlYWw6ICZsdDszMCUgZXhjZWxlbnRlLCAzMC01MCUgYnVlbm8sIDUwLTcwJSBhY2VwdGFibGUsICZndDs3MCUgcG9icmUuIENsaWNrIGVuIGZpbGEgcGFyYSBkZXRhbGxlICsgZ3JcdTAwRTFmaWNvLiAnICtcbiAgICAnU2UgZWxpZ2UgZWwgbW9kZWxvIGNvbiBtZW5vciBXQVBFIHBvciBzZXJpZSB0cmFzIGJhY2t0ZXN0IHJvbGxpbmctb3JpZ2luIChoPTIsIHZlbnRhbmFzPTMpLicgK1xuICAgICc8L2Rpdj4nO1xuXG4gIGNvbnQuaW5uZXJIVE1MID0gJzxkaXYgc3R5bGU9XCJwYWRkaW5nOjE4cHhcIj4nICsgYmFubmVyICsgdGFibGUgKyBmb290ZXIgKyAnPC9kaXY+Jztcbn1cblxuLy8gQ2FjaGUgaGlzdG9yaWEgYWdyZWdhZGEgcG9yIHN1YmZhbWlsaWEgKHBhcmEgZ3JcdTAwRTFmaWNvIGRldGFsbGUpLlxuYXN5bmMgZnVuY3Rpb24gX2xvYWRGb3JlY2FzdFN0YXRIaXN0b3J5KCkge1xuICBpZiAoX2ZvcmVjYXN0U3RhdEhpc3RvcnlDYWNoZSkgcmV0dXJuIF9mb3JlY2FzdFN0YXRIaXN0b3J5Q2FjaGU7XG4gIC8vIExhIGhpc3RvcmlhIHNvbG8gZXN0XHUwMEUxIGVuIEJRICh+MTAgYVx1MDBGMW9zIEJhcmFsZG8gKyAxMiBtZXNlcyBTaGltYW5vKS4gQ29tb1xuICAvLyBlbCBwaXBlbGluZSBsYSBlc2NyaWJlIGEgQ1NWIGxvY2FsLCBhY1x1MDBFMSBubyBsYSBwb2RlbW9zIGxlZXIuIEFsdGVybmF0aXZhOlxuICAvLyB1c2FyIHNrdV92ZW50YXNfc25hcHNob3QgcXVlIHRpZW5lIHZlbnRhcyBtZW5zdWFsZXMgcGVybyBzb2xvIGdydXBvIFBFU0NBLlxuICAvLyBFbiBGMkIuMiBzb2xvIG1vc3RyYW1vcyBmb3JlY2FzdCtJQyAoc2luIG92ZXJsYXkgaGlzdG9yaWEgcG9yIGFob3JhKS5cbiAgX2ZvcmVjYXN0U3RhdEhpc3RvcnlDYWNoZSA9IHt9O1xuICByZXR1cm4gX2ZvcmVjYXN0U3RhdEhpc3RvcnlDYWNoZTtcbn1cblxuZnVuY3Rpb24gX2J1aWxkRm9yZWNhc3RDaGFydFN2Zyhkb2MpIHtcbiAgY29uc3QgZmMgPSBkb2MuZm9yZWNhc3QgfHwgW107XG4gIGlmICghZmMubGVuZ3RoKVxuICAgIHJldHVybiAnPGRpdiBzdHlsZT1cInBhZGRpbmc6MzBweDt0ZXh0LWFsaWduOmNlbnRlcjtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKVwiPlNpbiBkYXRvcyBkZSBmb3JlY2FzdDwvZGl2Pic7XG4gIC8vIERpbWVuc2lvbmVzXG4gIGNvbnN0IFcgPSA2NDAsXG4gICAgSCA9IDI2MDtcbiAgY29uc3QgcGFkTCA9IDUwLFxuICAgIHBhZFIgPSAyMCxcbiAgICBwYWRUID0gMjAsXG4gICAgcGFkQiA9IDQwO1xuICBjb25zdCBpbm5lclcgPSBXIC0gcGFkTCAtIHBhZFI7XG4gIGNvbnN0IGlubmVySCA9IEggLSBwYWRUIC0gcGFkQjtcblxuICAvLyBZIHJhbmdlOiBtYXgoaGk4MCkgKiAxLjFcbiAgY29uc3QgbWF4WSA9IE1hdGgubWF4KDEsIC4uLmZjLm1hcCgoZikgPT4gTnVtYmVyKGYuaGk4MCkgfHwgTnVtYmVyKGYueV9oYXQpIHx8IDApKTtcbiAgY29uc3QgbWluWSA9IDA7XG4gIGNvbnN0IHNjYWxlWCA9IChpKSA9PiBwYWRMICsgKGlubmVyVyAqIGkpIC8gTWF0aC5tYXgoMSwgZmMubGVuZ3RoIC0gMSk7XG4gIGNvbnN0IHNjYWxlWSA9ICh2KSA9PiBwYWRUICsgaW5uZXJIIC0gKGlubmVySCAqICh2IC0gbWluWSkpIC8gKG1heFkgLSBtaW5ZKTtcblxuICAvLyBHcmlkICsgZWplIFlcbiAgY29uc3QgeVRpY2tzID0gWzAsIDAuMjUsIDAuNSwgMC43NSwgMV1cbiAgICAubWFwKChyKSA9PiB7XG4gICAgICBjb25zdCB2YWwgPSBtaW5ZICsgciAqIChtYXhZIC0gbWluWSk7XG4gICAgICBjb25zdCB5eSA9IHNjYWxlWSh2YWwpO1xuICAgICAgcmV0dXJuIChcbiAgICAgICAgJzxsaW5lIHgxPVwiJyArXG4gICAgICAgIHBhZEwgK1xuICAgICAgICAnXCIgeTE9XCInICtcbiAgICAgICAgeXkgK1xuICAgICAgICAnXCIgeDI9XCInICtcbiAgICAgICAgKFcgLSBwYWRSKSArXG4gICAgICAgICdcIiB5Mj1cIicgK1xuICAgICAgICB5eSArXG4gICAgICAgICdcIiBzdHJva2U9XCIjZTJlOGYwXCIgc3Ryb2tlLXdpZHRoPVwiMVwiLz4nICtcbiAgICAgICAgJzx0ZXh0IHg9XCInICtcbiAgICAgICAgKHBhZEwgLSA2KSArXG4gICAgICAgICdcIiB5PVwiJyArXG4gICAgICAgICh5eSArIDQpICtcbiAgICAgICAgJ1wiIHRleHQtYW5jaG9yPVwiZW5kXCIgZm9udC1zaXplPVwiMTBcIiBmaWxsPVwiIzY0NzQ4YlwiPicgK1xuICAgICAgICBfZm10TnVtKHZhbCkgK1xuICAgICAgICAnPC90ZXh0PidcbiAgICAgICk7XG4gICAgfSlcbiAgICAuam9pbignJyk7XG5cbiAgLy8gRWplIFggKG1lc2VzKVxuICBjb25zdCB4TGFiZWxzID0gZmNcbiAgICAubWFwKChmLCBpKSA9PiB7XG4gICAgICBjb25zdCB4eCA9IHNjYWxlWChpKTtcbiAgICAgIHJldHVybiAoXG4gICAgICAgICc8dGV4dCB4PVwiJyArXG4gICAgICAgIHh4ICtcbiAgICAgICAgJ1wiIHk9XCInICtcbiAgICAgICAgKEggLSBwYWRCICsgMTUpICtcbiAgICAgICAgJ1wiIHRleHQtYW5jaG9yPVwibWlkZGxlXCIgZm9udC1zaXplPVwiMTBcIiBmaWxsPVwiIzY0NzQ4YlwiPicgK1xuICAgICAgICBfZm10RHNTaG9ydChmLmRzKSArXG4gICAgICAgICc8L3RleHQ+J1xuICAgICAgKTtcbiAgICB9KVxuICAgIC5qb2luKCcnKTtcblxuICAvLyBJbnRlcnZhbG8gY29uZmlhbnphIChiYW5kKVxuICBjb25zdCBiYW5kUG9pbnRzID1cbiAgICBmYy5tYXAoKGYsIGkpID0+IHNjYWxlWChpKSArICcsJyArIHNjYWxlWShOdW1iZXIoZi5oaTgwKSB8fCAwKSkuam9pbignICcpICtcbiAgICAnICcgK1xuICAgIGZjXG4gICAgICAuc2xpY2UoKVxuICAgICAgLnJldmVyc2UoKVxuICAgICAgLm1hcCgoZiwgaSkgPT4gc2NhbGVYKGZjLmxlbmd0aCAtIDEgLSBpKSArICcsJyArIHNjYWxlWShOdW1iZXIoZi5sbzgwKSB8fCAwKSlcbiAgICAgIC5qb2luKCcgJyk7XG4gIGNvbnN0IGJhbmQgPSAnPHBvbHlnb24gcG9pbnRzPVwiJyArIGJhbmRQb2ludHMgKyAnXCIgZmlsbD1cIiMwZDk0ODgzM1wiIHN0cm9rZT1cIm5vbmVcIi8+JztcblxuICAvLyBMaW5lIGZvcmVjYXN0ICsgcHVudG9zXG4gIGNvbnN0IGxpbmVQb2ludHMgPSBmYy5tYXAoKGYsIGkpID0+IHNjYWxlWChpKSArICcsJyArIHNjYWxlWShOdW1iZXIoZi55X2hhdCkgfHwgMCkpLmpvaW4oJyAnKTtcbiAgY29uc3QgbGluZSA9XG4gICAgJzxwb2x5bGluZSBwb2ludHM9XCInICtcbiAgICBsaW5lUG9pbnRzICtcbiAgICAnXCIgZmlsbD1cIm5vbmVcIiBzdHJva2U9XCIjMGQ5NDg4XCIgc3Ryb2tlLXdpZHRoPVwiMi41XCIgc3Ryb2tlLWxpbmVqb2luPVwicm91bmRcIi8+JztcbiAgY29uc3QgcG9pbnRzID0gZmNcbiAgICAubWFwKFxuICAgICAgKGYsIGkpID0+XG4gICAgICAgICc8Y2lyY2xlIGN4PVwiJyArXG4gICAgICAgIHNjYWxlWChpKSArXG4gICAgICAgICdcIiBjeT1cIicgK1xuICAgICAgICBzY2FsZVkoTnVtYmVyKGYueV9oYXQpIHx8IDApICtcbiAgICAgICAgJ1wiIHI9XCI0XCIgZmlsbD1cIiMwZDk0ODhcIiBzdHJva2U9XCIjZmZmXCIgc3Ryb2tlLXdpZHRoPVwiMlwiLz4nXG4gICAgKVxuICAgIC5qb2luKCcnKTtcbiAgLy8gTGFiZWxzIGRlIHZhbG9yXG4gIGNvbnN0IHZhbHVlTGFiZWxzID0gZmNcbiAgICAubWFwKChmLCBpKSA9PiB7XG4gICAgICBjb25zdCB4eCA9IHNjYWxlWChpKTtcbiAgICAgIGNvbnN0IHl5ID0gc2NhbGVZKE51bWJlcihmLnlfaGF0KSB8fCAwKTtcbiAgICAgIHJldHVybiAoXG4gICAgICAgICc8dGV4dCB4PVwiJyArXG4gICAgICAgIHh4ICtcbiAgICAgICAgJ1wiIHk9XCInICtcbiAgICAgICAgKHl5IC0gOCkgK1xuICAgICAgICAnXCIgdGV4dC1hbmNob3I9XCJtaWRkbGVcIiBmb250LXNpemU9XCIxMFwiIGZvbnQtd2VpZ2h0PVwiNzAwXCIgZmlsbD1cIiMwZjc2NmVcIj4nICtcbiAgICAgICAgX2ZtdE51bShmLnlfaGF0KSArXG4gICAgICAgICc8L3RleHQ+J1xuICAgICAgKTtcbiAgICB9KVxuICAgIC5qb2luKCcnKTtcblxuICBjb25zdCBzdmcgPVxuICAgICc8c3ZnIHZpZXdCb3g9XCIwIDAgJyArXG4gICAgVyArXG4gICAgJyAnICtcbiAgICBIICtcbiAgICAnXCIgc3R5bGU9XCJ3aWR0aDoxMDAlO21heC13aWR0aDo4MDBweDtoZWlnaHQ6YXV0b1wiPicgK1xuICAgICc8cmVjdCB4PVwiMFwiIHk9XCIwXCIgd2lkdGg9XCInICtcbiAgICBXICtcbiAgICAnXCIgaGVpZ2h0PVwiJyArXG4gICAgSCArXG4gICAgJ1wiIGZpbGw9XCIjZmZmXCIvPicgK1xuICAgIHlUaWNrcyArXG4gICAgeExhYmVscyArXG4gICAgYmFuZCArXG4gICAgbGluZSArXG4gICAgcG9pbnRzICtcbiAgICB2YWx1ZUxhYmVscyArXG4gICAgJzwvc3ZnPic7XG4gIHJldHVybiBzdmc7XG59XG5cbndpbmRvdy5vcGVuRm9yZWNhc3RTdGF0RGV0YWlsID0gZnVuY3Rpb24gKHN1YklkKSB7XG4gIGlmICghX2ZvcmVjYXN0U3RhdERvY3MpIHJldHVybjtcbiAgY29uc3QgZG9jID0gX2ZvcmVjYXN0U3RhdERvY3MuZmluZCgoZCkgPT4gZC5pZCA9PT0gc3ViSWQpO1xuICBpZiAoIWRvYykge1xuICAgIGFsZXJ0KCdObyBzZSBlbmNvbnRyXHUwMEYzIGRldGFsbGUgZGUgJyArIHN1YklkKTtcbiAgICByZXR1cm47XG4gIH1cbiAgY29uc3QgZXhpc3RpbmcgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZm9yZWNhc3Qtc3RhdC1kZXRhaWwnKTtcbiAgaWYgKGV4aXN0aW5nKSBleGlzdGluZy5yZW1vdmUoKTtcblxuICBjb25zdCBlbCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpO1xuICBlbC5pZCA9ICdmb3JlY2FzdC1zdGF0LWRldGFpbCc7XG4gIGVsLnN0eWxlLmNzc1RleHQgPVxuICAgICdwb3NpdGlvbjpmaXhlZDtpbnNldDowO2JhY2tncm91bmQ6cmdiYSgxNSwyMyw0MiwuNjUpO3otaW5kZXg6MjEwMDtkaXNwbGF5OmZsZXg7YWxpZ24taXRlbXM6Y2VudGVyO2p1c3RpZnktY29udGVudDpjZW50ZXI7cGFkZGluZzoydmgnO1xuICBlbC5vbmNsaWNrID0gKGV2KSA9PiB7XG4gICAgaWYgKGV2LnRhcmdldCA9PT0gZWwpIGVsLnJlbW92ZSgpO1xuICB9O1xuXG4gIGNvbnN0IHdhcGUgPSBkb2MubWV0cmljcyAmJiBkb2MubWV0cmljcy53YXBlO1xuICBjb25zdCBiaWFzID0gZG9jLm1ldHJpY3MgJiYgZG9jLm1ldHJpY3MuYmlhcztcbiAgY29uc3QgbWFlID0gZG9jLm1ldHJpY3MgJiYgZG9jLm1ldHJpY3MubWFlO1xuICBjb25zdCBybXNlID0gZG9jLm1ldHJpY3MgJiYgZG9jLm1ldHJpY3Mucm1zZTtcbiAgY29uc3QgYmVzdE1vZGVsID0gZG9jLmJlc3RNb2RlbCB8fCAnXHUyMDE0JztcbiAgY29uc3QgdmVyc2lvbklkID0gZG9jLnZlcnNpb25JZCB8fCAnXHUyMDE0JztcbiAgY29uc3Qgc3ZnSHRtbCA9IF9idWlsZEZvcmVjYXN0Q2hhcnRTdmcoZG9jKTtcblxuICBjb25zdCBtZXRyaWNzSHRtbCA9XG4gICAgJzxkaXYgc3R5bGU9XCJkaXNwbGF5OmdyaWQ7Z3JpZC10ZW1wbGF0ZS1jb2x1bW5zOnJlcGVhdChhdXRvLWZpdCxtaW5tYXgoMTIwcHgsMWZyKSk7Z2FwOjEwcHg7bWFyZ2luOjE0cHggMFwiPicgK1xuICAgICc8ZGl2IHN0eWxlPVwicGFkZGluZzoxMHB4O2JhY2tncm91bmQ6dmFyKC0tYmctc2Vjb25kYXJ5KTtib3JkZXItcmFkaXVzOjZweFwiPjxkaXYgc3R5bGU9XCJmb250LXNpemU6MTBweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2VcIj5Nb2RlbG88L2Rpdj48ZGl2IHN0eWxlPVwiZm9udC13ZWlnaHQ6NzAwXCI+JyArXG4gICAgZXNjYXBlSHRtbFNhZmUoYmVzdE1vZGVsKSArXG4gICAgJzwvZGl2PjwvZGl2PicgK1xuICAgICc8ZGl2IHN0eWxlPVwicGFkZGluZzoxMHB4O2JhY2tncm91bmQ6dmFyKC0tYmctc2Vjb25kYXJ5KTtib3JkZXItcmFkaXVzOjZweFwiPjxkaXYgc3R5bGU9XCJmb250LXNpemU6MTBweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2VcIj5XQVBFPC9kaXY+PGRpdiBzdHlsZT1cImZvbnQtd2VpZ2h0OjcwMDtjb2xvcjonICtcbiAgICBfd2FwZUJhZGdlQ29sb3Iod2FwZSkgK1xuICAgICdcIj4nICtcbiAgICBfZm10V2FwZSh3YXBlKSArXG4gICAgJzwvZGl2PjwvZGl2PicgK1xuICAgICc8ZGl2IHN0eWxlPVwicGFkZGluZzoxMHB4O2JhY2tncm91bmQ6dmFyKC0tYmctc2Vjb25kYXJ5KTtib3JkZXItcmFkaXVzOjZweFwiPjxkaXYgc3R5bGU9XCJmb250LXNpemU6MTBweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2VcIj5CaWFzPC9kaXY+PGRpdiBzdHlsZT1cImZvbnQtd2VpZ2h0OjcwMFwiPicgK1xuICAgIChiaWFzICE9IG51bGwgPyAoYmlhcyAqIDEwMCkudG9GaXhlZCgwKSArICclJyA6ICdcdTIwMTQnKSArXG4gICAgJzwvZGl2PjwvZGl2PicgK1xuICAgICc8ZGl2IHN0eWxlPVwicGFkZGluZzoxMHB4O2JhY2tncm91bmQ6dmFyKC0tYmctc2Vjb25kYXJ5KTtib3JkZXItcmFkaXVzOjZweFwiPjxkaXYgc3R5bGU9XCJmb250LXNpemU6MTBweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2VcIj5NQUU8L2Rpdj48ZGl2IHN0eWxlPVwiZm9udC13ZWlnaHQ6NzAwXCI+JyArXG4gICAgX2ZtdE51bShtYWUpICtcbiAgICAnPC9kaXY+PC9kaXY+JyArXG4gICAgJzxkaXYgc3R5bGU9XCJwYWRkaW5nOjEwcHg7YmFja2dyb3VuZDp2YXIoLS1iZy1zZWNvbmRhcnkpO2JvcmRlci1yYWRpdXM6NnB4XCI+PGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMHB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZVwiPlJNU0U8L2Rpdj48ZGl2IHN0eWxlPVwiZm9udC13ZWlnaHQ6NzAwXCI+JyArXG4gICAgX2ZtdE51bShybXNlKSArXG4gICAgJzwvZGl2PjwvZGl2PicgK1xuICAgICc8L2Rpdj4nO1xuXG4gIGNvbnN0IHRhYmxlSHRtbCA9XG4gICAgJzx0YWJsZSBzdHlsZT1cIndpZHRoOjEwMCU7Zm9udC1zaXplOjEycHg7Ym9yZGVyLWNvbGxhcHNlOmNvbGxhcHNlO21hcmdpbi10b3A6MTBweFwiPicgK1xuICAgICc8dGhlYWQgc3R5bGU9XCJiYWNrZ3JvdW5kOiMwZjE3MmE7Y29sb3I6I2ZmZlwiPjx0cj4nICtcbiAgICAnPHRoIHN0eWxlPVwicGFkZGluZzo2cHggMTBweDt0ZXh0LWFsaWduOmxlZnRcIj5NZXM8L3RoPicgK1xuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjZweCAxMHB4O3RleHQtYWxpZ246cmlnaHRcIj5Gb3JlY2FzdDwvdGg+JyArXG4gICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6NnB4IDEwcHg7dGV4dC1hbGlnbjpyaWdodFwiPklDIDgwJSBiYWpvPC90aD4nICtcbiAgICAnPHRoIHN0eWxlPVwicGFkZGluZzo2cHggMTBweDt0ZXh0LWFsaWduOnJpZ2h0XCI+SUMgODAlIGFsdG88L3RoPicgK1xuICAgICc8L3RyPjwvdGhlYWQ+PHRib2R5PicgK1xuICAgIChkb2MuZm9yZWNhc3QgfHwgW10pXG4gICAgICAubWFwKFxuICAgICAgICAoZikgPT5cbiAgICAgICAgICAnPHRyIHN0eWxlPVwiYm9yZGVyLWJvdHRvbToxcHggc29saWQgdmFyKC0tYm9yZGVyLXN1YnRsZSlcIj48dGQgc3R5bGU9XCJwYWRkaW5nOjZweCAxMHB4XCI+JyArXG4gICAgICAgICAgZXNjYXBlSHRtbFNhZmUoX2ZtdERzU2hvcnQoZi5kcykpICtcbiAgICAgICAgICAnPC90ZD4nICtcbiAgICAgICAgICAnPHRkIHN0eWxlPVwicGFkZGluZzo2cHggMTBweDt0ZXh0LWFsaWduOnJpZ2h0O2ZvbnQtd2VpZ2h0OjcwMFwiPicgK1xuICAgICAgICAgIF9mbXROdW0oZi55X2hhdCkgK1xuICAgICAgICAgICc8L3RkPicgK1xuICAgICAgICAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjZweCAxMHB4O3RleHQtYWxpZ246cmlnaHQ7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZClcIj4nICtcbiAgICAgICAgICBfZm10TnVtKGYubG84MCkgK1xuICAgICAgICAgICc8L3RkPicgK1xuICAgICAgICAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjZweCAxMHB4O3RleHQtYWxpZ246cmlnaHQ7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZClcIj4nICtcbiAgICAgICAgICBfZm10TnVtKGYuaGk4MCkgK1xuICAgICAgICAgICc8L3RkPjwvdHI+J1xuICAgICAgKVxuICAgICAgLmpvaW4oJycpICtcbiAgICAnPC90Ym9keT48L3RhYmxlPic7XG5cbiAgY29uc3QgY29udGVudCA9XG4gICAgJzxkaXYgc3R5bGU9XCJiYWNrZ3JvdW5kOnZhcigtLWJnLWVsZXZhdGVkKTtib3JkZXItcmFkaXVzOjEycHg7cGFkZGluZzoyNHB4O21heC13aWR0aDo4MjBweDt3aWR0aDoxMDAlO21heC1oZWlnaHQ6OTZ2aDtvdmVyZmxvdzphdXRvO2JveC1zaGFkb3c6MCAyMHB4IDYwcHggcmdiYSgwLDAsMCwuNClcIj4nICtcbiAgICAnPGRpdiBzdHlsZT1cImRpc3BsYXk6ZmxleDtqdXN0aWZ5LWNvbnRlbnQ6c3BhY2UtYmV0d2VlbjthbGlnbi1pdGVtczpjZW50ZXI7bWFyZ2luLWJvdHRvbToxMHB4XCI+JyArXG4gICAgJzxkaXY+PGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMXB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtsZXR0ZXItc3BhY2luZzouNHB4XCI+U3ViZmFtaWxpYTwvZGl2PjxkaXYgc3R5bGU9XCJmb250LXNpemU6MjJweDtmb250LXdlaWdodDo4MDBcIj4nICtcbiAgICBlc2NhcGVIdG1sU2FmZShkb2Muc3ViZmFtaWxpYSB8fCBkb2MuaWQpICtcbiAgICAnPC9kaXY+PC9kaXY+JyArXG4gICAgJzxidXR0b24gb25jbGljaz1cImRvY3VtZW50LmdldEVsZW1lbnRCeUlkKFxcJ2ZvcmVjYXN0LXN0YXQtZGV0YWlsXFwnKS5yZW1vdmUoKVwiIHN0eWxlPVwiYmFja2dyb3VuZDp0cmFuc3BhcmVudDtib3JkZXI6MXB4IHNvbGlkIHZhcigtLWJvcmRlci1zdWJ0bGUpO2JvcmRlci1yYWRpdXM6NnB4O3BhZGRpbmc6NnB4IDEycHg7Y3Vyc29yOnBvaW50ZXI7Zm9udC13ZWlnaHQ6NzAwXCI+Q2VycmFyPC9idXR0b24+JyArXG4gICAgJzwvZGl2PicgK1xuICAgIG1ldHJpY3NIdG1sICtcbiAgICAnPGRpdiBzdHlsZT1cImJhY2tncm91bmQ6I2ZmZjtwYWRkaW5nOjhweDtib3JkZXItcmFkaXVzOjhweDttYXJnaW4tdG9wOjEwcHg7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1ib3JkZXItc3VidGxlKVwiPicgK1xuICAgIHN2Z0h0bWwgK1xuICAgICc8L2Rpdj4nICtcbiAgICB0YWJsZUh0bWwgK1xuICAgICc8ZGl2IHN0eWxlPVwibWFyZ2luLXRvcDoxNHB4O2ZvbnQtc2l6ZToxMXB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpXCI+VmVyc2lvbjogPGNvZGU+JyArXG4gICAgZXNjYXBlSHRtbFNhZmUodmVyc2lvbklkKSArXG4gICAgJzwvY29kZT4gXHUwMEI3IEFwcHJvYWNoOiAnICtcbiAgICBlc2NhcGVIdG1sU2FmZSgoZG9jLmNvbmZpZyB8fCB7fSkuYXBwcm9hY2ggfHwgJ1x1MjAxNCcpICtcbiAgICAnPC9kaXY+JyArXG4gICAgJzwvZGl2Pic7XG4gIGVsLmlubmVySFRNTCA9IGNvbnRlbnQ7XG4gIGRvY3VtZW50LmJvZHkuYXBwZW5kQ2hpbGQoZWwpO1xufTtcblxud2luZG93Lm9wZW5Gb3JlY2FzdE1vZGFsID0gYXN5bmMgZnVuY3Rpb24gKCkge1xuICBpZiAoIV9jYW5Gb3JlY2FzdCgpKSB7XG4gICAgYWxlcnQoJ0ZPUkVDQVNUIGVzIHNvbG8gcGFyYSBNYXJpYW5vIChhZG1pbikuJyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGNvbnN0IGVsID0gX3JlbmRlck1vZGFsU2hlbGwoKTtcbiAgZWwuc3R5bGUuZGlzcGxheSA9ICdibG9jayc7XG4gIC8vIEZhc2UgMTogY2FyZ2FyIFNhbGVzIFBsYW5zIGNhY2hlcyArIHJlbmRlcml6YXIgdGFiIGRlZmF1bHQuXG4gIF9yZW5kZXJTYWxlc1BsYW5zVGFiKCk7XG4gIF9sb2FkU2FsZXNQbGFuQ2FjaGVzKClcbiAgICAudGhlbihfcmVuZGVyU2FsZXNQbGFuc1RhYilcbiAgICAuY2F0Y2goKCkgPT4ge30pO1xufTtcblxud2luZG93LmNsb3NlRm9yZWNhc3RNb2RhbCA9IGZ1bmN0aW9uICgpIHtcbiAgY29uc3QgZWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZm9yZWNhc3QtbW9kYWwnKTtcbiAgaWYgKGVsKSBlbC5zdHlsZS5kaXNwbGF5ID0gJ25vbmUnO1xufTtcblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBGM0EgXHUyMDE0IFRhYmxhIFJlY29tZW5kYWNpXHUwMEYzbiBkZSBDb21wcmEgKHRhYiBTYWxlcyBQbGFucylcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5hc3luYyBmdW5jdGlvbiBfbG9hZE11bHRpcGxpZXJPdmVycmlkZXMoKSB7XG4gIGlmICghd2luZG93LmZiRGIpIHJldHVybjtcbiAgdHJ5IHtcbiAgICBjb25zdCBkb2MgPSBhd2FpdCB3aW5kb3cuZmJEYi5jb2xsZWN0aW9uKCdmb3JlY2FzdF9jb25maWcnKS5kb2MoJ211bHRpcGxpZXJzJykuZ2V0KCk7XG4gICAgaWYgKGRvYy5leGlzdHMpIHtcbiAgICAgIGNvbnN0IGQgPSBkb2MuZGF0YSgpIHx8IHt9O1xuICAgICAgX211bHRpcGxpZXJPdmVycmlkZXMgPSBkLnNrdU92ZXJyaWRlcyB8fCB7fTtcbiAgICB9IGVsc2Uge1xuICAgICAgX211bHRpcGxpZXJPdmVycmlkZXMgPSB7fTtcbiAgICB9XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBjb25zb2xlLndhcm4oJ1tGT1JFQ0FTVCByZWNvXSBsb2FkIG11bHRpcGxpZXJzIGZhaWw6JywgZSAmJiBlLm1lc3NhZ2UpO1xuICAgIF9tdWx0aXBsaWVyT3ZlcnJpZGVzID0ge307XG4gIH1cbn1cblxuYXN5bmMgZnVuY3Rpb24gX3NhdmVNdWx0aXBsaWVyT3ZlcnJpZGUoc2t1VXBwZXIsIHZhbHVlKSB7XG4gIGlmICghd2luZG93LmZiRGIpIHJldHVybjtcbiAgaWYgKCFfbXVsdGlwbGllck92ZXJyaWRlcykgX211bHRpcGxpZXJPdmVycmlkZXMgPSB7fTtcbiAgY29uc3QgdWlkID0gKHdpbmRvdy5jdXJyZW50VXNlciAmJiB3aW5kb3cuY3VycmVudFVzZXIuZW1haWwpIHx8ICd1bmtub3duJztcbiAgX211bHRpcGxpZXJPdmVycmlkZXNbc2t1VXBwZXJdID0ge1xuICAgIHZhbHVlOiBOdW1iZXIodmFsdWUpLFxuICAgIHVwZGF0ZWRBdDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgIHVwZGF0ZWRCeTogdWlkLFxuICB9O1xuICBhd2FpdCB3aW5kb3cuZmJEYi5jb2xsZWN0aW9uKCdmb3JlY2FzdF9jb25maWcnKS5kb2MoJ211bHRpcGxpZXJzJykuc2V0KHtcbiAgICBza3VPdmVycmlkZXM6IF9tdWx0aXBsaWVyT3ZlcnJpZGVzLFxuICAgIHVwZGF0ZWRBdDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgIHVwZGF0ZWRCeTogdWlkLFxuICB9KTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gX3JlbW92ZU11bHRpcGxpZXJPdmVycmlkZShza3VVcHBlcikge1xuICBpZiAoIXdpbmRvdy5mYkRiIHx8ICFfbXVsdGlwbGllck92ZXJyaWRlcykgcmV0dXJuO1xuICBkZWxldGUgX211bHRpcGxpZXJPdmVycmlkZXNbc2t1VXBwZXJdO1xuICBjb25zdCB1aWQgPSAod2luZG93LmN1cnJlbnRVc2VyICYmIHdpbmRvdy5jdXJyZW50VXNlci5lbWFpbCkgfHwgJ3Vua25vd24nO1xuICBhd2FpdCB3aW5kb3cuZmJEYi5jb2xsZWN0aW9uKCdmb3JlY2FzdF9jb25maWcnKS5kb2MoJ211bHRpcGxpZXJzJykuc2V0KHtcbiAgICBza3VPdmVycmlkZXM6IF9tdWx0aXBsaWVyT3ZlcnJpZGVzLFxuICAgIHVwZGF0ZWRBdDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgIHVwZGF0ZWRCeTogdWlkLFxuICB9KTtcbn1cblxuLy8gQXV0byBtdWx0aXBsaWVyOiByZWNlbnQvYmFzZWxpbmUgY29uIGNhcC4gUmV0b3JuYSB7dmFsdWUsIHNvdXJjZTogJ2F1dG8nfCdmYWxsYmFjayd8J2RlZmF1bHQnLCByZWNlbnQsIGJhc2VsaW5lfS5cbmZ1bmN0aW9uIF9jb21wdXRlTXVsdGlwbGllckF1dG8oc2t1VXBwZXIpIHtcbiAgY29uc3QgcmVjID0gX3JlY29WZW50YXNTbmFwc2hvdCAmJiBfcmVjb1ZlbnRhc1NuYXBzaG90W3NrdVVwcGVyXTtcbiAgaWYgKCFyZWMgfHwgIXJlYy5tZXNlcykgcmV0dXJuIHsgdmFsdWU6IDEuMCwgc291cmNlOiAnZGVmYXVsdCcsIHJlY2VudDogMCwgYmFzZWxpbmU6IDAgfTtcbiAgY29uc3QgaG95ID0gbmV3IERhdGUoKTtcbiAgY29uc3QgbW9udGhzQmFja0tleSA9IChuKSA9PiB7XG4gICAgY29uc3QgZCA9IG5ldyBEYXRlKGhveS5nZXRGdWxsWWVhcigpLCBob3kuZ2V0TW9udGgoKSAtIG4sIDEpO1xuICAgIHJldHVybiBTdHJpbmcoZC5nZXRGdWxsWWVhcigpKSArICctJyArIFN0cmluZyhkLmdldE1vbnRoKCkgKyAxKS5wYWRTdGFydCgyLCAnMCcpO1xuICB9O1xuICBjb25zdCBjb2xsZWN0QXZnID0gKG4pID0+IHtcbiAgICBsZXQgc3VtID0gMDtcbiAgICBsZXQgY291bnQgPSAwO1xuICAgIGZvciAobGV0IGkgPSAxOyBpIDw9IG47IGkrKykge1xuICAgICAgY29uc3QgayA9IG1vbnRoc0JhY2tLZXkoaSk7XG4gICAgICBjb25zdCBtID0gcmVjLm1lc2VzW2tdO1xuICAgICAgaWYgKG0gJiYgTnVtYmVyLmlzRmluaXRlKE51bWJlcihtLnF0eSkpKSB7XG4gICAgICAgIHN1bSArPSBOdW1iZXIobS5xdHkpO1xuICAgICAgICBjb3VudCsrO1xuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gY291bnQgPiAwID8geyBhdmc6IHN1bSAvIGNvdW50LCBuOiBjb3VudCB9IDogeyBhdmc6IDAsIG46IDAgfTtcbiAgfTtcbiAgY29uc3QgcmVjMiA9IGNvbGxlY3RBdmcoUkVDT19NVUxUX1JFQ0VOVF9NT05USFMpO1xuICBjb25zdCBiYXM2ID0gY29sbGVjdEF2ZyhSRUNPX01VTFRfQkFTRUxJTkVfTU9OVEhTKTtcbiAgLy8gTmVjZXNpdGFtb3MgYWwgbWVub3MgMSBtZXMgcmVjaWVudGUgKyAzIG1lc2VzIGJhc2VsaW5lIHBhcmEgY2FsY3VsYXIgYXV0by5cbiAgaWYgKHJlYzIubiA9PT0gMCB8fCBiYXM2Lm4gPCAzIHx8IGJhczYuYXZnIDwgUkVDT19NVUxUX01JTl9CQVNFTElORSkge1xuICAgIHJldHVybiB7IHZhbHVlOiAxLjAsIHNvdXJjZTogJ2RlZmF1bHQnLCByZWNlbnQ6IHJlYzIuYXZnLCBiYXNlbGluZTogYmFzNi5hdmcgfTtcbiAgfVxuICBsZXQgcmF0aW8gPSByZWMyLmF2ZyAvIGJhczYuYXZnO1xuICBpZiAocmF0aW8gPCBSRUNPX01VTFRfTUlOKSByYXRpbyA9IFJFQ09fTVVMVF9NSU47XG4gIGlmIChyYXRpbyA+IFJFQ09fTVVMVF9NQVgpIHJhdGlvID0gUkVDT19NVUxUX01BWDtcbiAgcmV0dXJuIHtcbiAgICB2YWx1ZTogTWF0aC5yb3VuZChyYXRpbyAqIDEwMCkgLyAxMDAsXG4gICAgc291cmNlOiAnYXV0bycsXG4gICAgcmVjZW50OiBNYXRoLnJvdW5kKHJlYzIuYXZnICogMTApIC8gMTAsXG4gICAgYmFzZWxpbmU6IE1hdGgucm91bmQoYmFzNi5hdmcgKiAxMCkgLyAxMCxcbiAgfTtcbn1cblxuZnVuY3Rpb24gX2dldEVmZmVjdGl2ZU11bHRpcGxpZXIoc2t1VXBwZXIpIHtcbiAgLy8gT3ZlcnJpZGUgbWFudWFsIGdhbmFcbiAgaWYgKF9tdWx0aXBsaWVyT3ZlcnJpZGVzICYmIF9tdWx0aXBsaWVyT3ZlcnJpZGVzW3NrdVVwcGVyXSkge1xuICAgIHJldHVybiB7XG4gICAgICB2YWx1ZTogTnVtYmVyKF9tdWx0aXBsaWVyT3ZlcnJpZGVzW3NrdVVwcGVyXS52YWx1ZSkgfHwgMS4wLFxuICAgICAgc291cmNlOiAnbWFudWFsJyxcbiAgICAgIGF1dG86IF9jb21wdXRlTXVsdGlwbGllckF1dG8oc2t1VXBwZXIpLFxuICAgIH07XG4gIH1cbiAgY29uc3QgYXV0byA9IF9jb21wdXRlTXVsdGlwbGllckF1dG8oc2t1VXBwZXIpO1xuICByZXR1cm4geyB2YWx1ZTogYXV0by52YWx1ZSwgc291cmNlOiBhdXRvLnNvdXJjZSwgYXV0byB9O1xufVxuXG5hc3luYyBmdW5jdGlvbiBfbG9hZERpc2NvbnRpbnVlZFNrdXMoKSB7XG4gIGlmICghd2luZG93LmZiRGIpIHJldHVybjtcbiAgdHJ5IHtcbiAgICBjb25zdCBkb2MgPSBhd2FpdCB3aW5kb3cuZmJEYi5jb2xsZWN0aW9uKCdmb3JlY2FzdF9jb25maWcnKS5kb2MoJ2Rpc2NvbnRpbnVlZF9za3VzJykuZ2V0KCk7XG4gICAgaWYgKGRvYy5leGlzdHMpIHtcbiAgICAgIGNvbnN0IGQgPSBkb2MuZGF0YSgpIHx8IHt9O1xuICAgICAgY29uc3QgYXJyID0gQXJyYXkuaXNBcnJheShkLnNrdXMpID8gZC5za3VzIDogW107XG4gICAgICBfZGlzY29udGludWVkU2t1cyA9IG5ldyBTZXQoYXJyLm1hcCgocykgPT4gU3RyaW5nKHMpLnRyaW0oKS50b1VwcGVyQ2FzZSgpKSk7XG4gICAgICBfZGlzY29udGludWVkTWV0YSA9IHsgdXBkYXRlZEF0OiBkLnVwZGF0ZWRBdCwgdXBkYXRlZEJ5OiBkLnVwZGF0ZWRCeSB9O1xuICAgIH0gZWxzZSB7XG4gICAgICBfZGlzY29udGludWVkU2t1cyA9IG5ldyBTZXQoKTtcbiAgICAgIF9kaXNjb250aW51ZWRNZXRhID0gbnVsbDtcbiAgICB9XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBjb25zb2xlLndhcm4oJ1tGT1JFQ0FTVCByZWNvXSBsb2FkIGRpc2NvbnRpbnVlZCBmYWlsOicsIGUgJiYgZS5tZXNzYWdlKTtcbiAgICBfZGlzY29udGludWVkU2t1cyA9IG5ldyBTZXQoKTtcbiAgfVxufVxuXG5hc3luYyBmdW5jdGlvbiBfc2F2ZURpc2NvbnRpbnVlZFNrdXMoKSB7XG4gIGlmICghd2luZG93LmZiRGIgfHwgIV9kaXNjb250aW51ZWRTa3VzKSByZXR1cm47XG4gIGNvbnN0IHVpZCA9ICh3aW5kb3cuY3VycmVudFVzZXIgJiYgd2luZG93LmN1cnJlbnRVc2VyLmVtYWlsKSB8fCAndW5rbm93bic7XG4gIGNvbnN0IHBheWxvYWQgPSB7XG4gICAgc2t1czogQXJyYXkuZnJvbShfZGlzY29udGludWVkU2t1cykuc29ydCgpLFxuICAgIHVwZGF0ZWRBdDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgIHVwZGF0ZWRCeTogdWlkLFxuICB9O1xuICBhd2FpdCB3aW5kb3cuZmJEYi5jb2xsZWN0aW9uKCdmb3JlY2FzdF9jb25maWcnKS5kb2MoJ2Rpc2NvbnRpbnVlZF9za3VzJykuc2V0KHBheWxvYWQpO1xuICBfZGlzY29udGludWVkTWV0YSA9IHsgdXBkYXRlZEF0OiBwYXlsb2FkLnVwZGF0ZWRBdCwgdXBkYXRlZEJ5OiBwYXlsb2FkLnVwZGF0ZWRCeSB9O1xufVxuXG5hc3luYyBmdW5jdGlvbiBfbG9hZFJlY29EYXRhKCkge1xuICBpZiAoIXdpbmRvdy5mYkRiKSB0aHJvdyBuZXcgRXJyb3IoJ0ZpcmVzdG9yZSBubyBpbmljaWFsaXphZG8nKTtcbiAgY29uc3QgcHJvbWlzZXMgPSBbXTtcbiAgaWYgKCFfZGlzY29udGludWVkU2t1cykgcHJvbWlzZXMucHVzaChfbG9hZERpc2NvbnRpbnVlZFNrdXMoKSk7XG4gIGlmICghX211bHRpcGxpZXJPdmVycmlkZXMpIHByb21pc2VzLnB1c2goX2xvYWRNdWx0aXBsaWVyT3ZlcnJpZGVzKCkpO1xuICBpZiAoIV9yZWNvU3RvY2tTbmFwc2hvdCkge1xuICAgIHByb21pc2VzLnB1c2goXG4gICAgICB3aW5kb3cuZmJEYlxuICAgICAgICAuY29sbGVjdGlvbignYXBwX2NvbmZpZycpXG4gICAgICAgIC5kb2MoJ3N0b2NrX3NuYXBzaG90JylcbiAgICAgICAgLmdldCgpXG4gICAgICAgIC50aGVuKChkKSA9PiB7XG4gICAgICAgICAgY29uc3QgZGF0YSA9IGQuZXhpc3RzID8gZC5kYXRhKCkgOiB7fTtcbiAgICAgICAgICBsZXQgd2ggPSB7fTtcbiAgICAgICAgICBsZXQgYm8gPSB7fTtcbiAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgd2ggPSBkYXRhLndhcmVob3VzZUJyZWFrZG93biA/IEpTT04ucGFyc2UoZGF0YS53YXJlaG91c2VCcmVha2Rvd24pIDoge307XG4gICAgICAgICAgfSBjYXRjaCB7XG4gICAgICAgICAgICB3aCA9IHt9O1xuICAgICAgICAgIH1cbiAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgYm8gPSBkYXRhLmJhY2tvcmRlckJ5U2t1ID8gSlNPTi5wYXJzZShkYXRhLmJhY2tvcmRlckJ5U2t1KSA6IHt9O1xuICAgICAgICAgIH0gY2F0Y2gge1xuICAgICAgICAgICAgYm8gPSB7fTtcbiAgICAgICAgICB9XG4gICAgICAgICAgX3JlY29TdG9ja1NuYXBzaG90ID0geyB3YXJlaG91c2VCcmVha2Rvd246IHdoLCBiYWNrb3JkZXJCeVNrdTogYm8gfTtcbiAgICAgICAgfSlcbiAgICApO1xuICB9XG4gIGlmICghX3JlY29WZW50YXNTbmFwc2hvdCkge1xuICAgIHByb21pc2VzLnB1c2goXG4gICAgICB3aW5kb3cuZmJEYlxuICAgICAgICAuY29sbGVjdGlvbignc2t1X3ZlbnRhc19zbmFwc2hvdCcpXG4gICAgICAgIC5nZXQoKVxuICAgICAgICAudGhlbigoc25hcCkgPT4ge1xuICAgICAgICAgIGNvbnN0IG1hcCA9IHt9O1xuICAgICAgICAgIHNuYXAuZm9yRWFjaCgoZG9jKSA9PiB7XG4gICAgICAgICAgICBjb25zdCBkID0gZG9jLmRhdGEoKTtcbiAgICAgICAgICAgIGlmICghZCB8fCAhZC5za3UpIHJldHVybjtcbiAgICAgICAgICAgIG1hcFtTdHJpbmcoZC5za3UpLnRyaW0oKS50b1VwcGVyQ2FzZSgpXSA9IHsgbWVzZXM6IGQubWVzZXMgfHwge30gfTtcbiAgICAgICAgICB9KTtcbiAgICAgICAgICBfcmVjb1ZlbnRhc1NuYXBzaG90ID0gbWFwO1xuICAgICAgICB9KVxuICAgICk7XG4gIH1cbiAgYXdhaXQgUHJvbWlzZS5hbGwocHJvbWlzZXMpO1xufVxuXG5mdW5jdGlvbiBfY29tcHV0ZVZlbnRhTWVuc3VhbFByb21lZGlvKHNrdVVwcGVyKSB7XG4gIC8vIFByb21lZGlvIGRlIGxvcyBcdTAwRkFsdGltb3MgUkVDT19WRU5UQV9QUk9NRURJT19XSU5ET1cgbWVzZXMgY2VycmFkb3NcbiAgLy8gKGV4Y2x1eWUgZWwgbWVzIGFjdHVhbCBwYXJjaWFsKS5cbiAgY29uc3QgcmVjID0gX3JlY29WZW50YXNTbmFwc2hvdCAmJiBfcmVjb1ZlbnRhc1NuYXBzaG90W3NrdVVwcGVyXTtcbiAgaWYgKCFyZWMgfHwgIXJlYy5tZXNlcykgcmV0dXJuIDA7XG4gIGNvbnN0IGhveSA9IG5ldyBEYXRlKCk7XG4gIGNvbnN0IG1vbnRoc0JhY2sgPSBbXTtcbiAgZm9yIChsZXQgaSA9IDE7IGkgPD0gUkVDT19WRU5UQV9QUk9NRURJT19XSU5ET1c7IGkrKykge1xuICAgIGNvbnN0IGQgPSBuZXcgRGF0ZShob3kuZ2V0RnVsbFllYXIoKSwgaG95LmdldE1vbnRoKCkgLSBpLCAxKTtcbiAgICBtb250aHNCYWNrLnB1c2goU3RyaW5nKGQuZ2V0RnVsbFllYXIoKSkgKyAnLScgKyBTdHJpbmcoZC5nZXRNb250aCgpICsgMSkucGFkU3RhcnQoMiwgJzAnKSk7XG4gIH1cbiAgbGV0IHN1bSA9IDA7XG4gIGxldCBuID0gMDtcbiAgbW9udGhzQmFjay5mb3JFYWNoKChrKSA9PiB7XG4gICAgY29uc3QgbSA9IHJlYy5tZXNlc1trXTtcbiAgICBpZiAobSAmJiBOdW1iZXIuaXNGaW5pdGUoTnVtYmVyKG0ucXR5KSkpIHtcbiAgICAgIHN1bSArPSBOdW1iZXIobS5xdHkpO1xuICAgICAgbisrO1xuICAgIH1cbiAgfSk7XG4gIHJldHVybiBuID4gMCA/IHN1bSAvIG4gOiAwO1xufVxuXG5mdW5jdGlvbiBfY29tcHV0ZVNhbGVzUGxhbkZ1dHVybyhyb3cpIHtcbiAgLy8gU3VtYSBsb3MgbWVzZXMgZGUgcm93Lm1vbnRocyBkZXNkZSBlbCBtZXMgYWN0dWFsIChpbmNsdXNpdmUpIGhhc3RhIGVsXG4gIC8vIFx1MDBGQWx0aW1vIG1lcyBkZWwgc2FsZXMgcGxhbi4gTG9zIG1lc2VzIHNvbiAnWVlZWS1NTScuXG4gIGlmICghcm93IHx8ICFyb3cubW9udGhzKSByZXR1cm4gMDtcbiAgY29uc3QgaG95ID0gbmV3IERhdGUoKTtcbiAgY29uc3QgY3VycmVudEtleSA9IFN0cmluZyhob3kuZ2V0RnVsbFllYXIoKSkgKyAnLScgKyBTdHJpbmcoaG95LmdldE1vbnRoKCkgKyAxKS5wYWRTdGFydCgyLCAnMCcpO1xuICBsZXQgc3VtID0gMDtcbiAgT2JqZWN0LmtleXMocm93Lm1vbnRocykuZm9yRWFjaCgoaykgPT4ge1xuICAgIGlmIChrID49IGN1cnJlbnRLZXkpIHN1bSArPSBOdW1iZXIocm93Lm1vbnRoc1trXSB8fCAwKTtcbiAgfSk7XG4gIHJldHVybiBzdW07XG59XG5cbmZ1bmN0aW9uIF9jb21wdXRlUmVjb21tZW5kYXRpb25zKCkge1xuICAvLyBDb21iaW5hIFJvZHMgKyBSZWVscyBzYWxlcyBwbGFucyArIHN0b2NrICsgYmFja29yZGVyICsgdmVudGFzIHByb21lZGlvLlxuICAvLyBSZXRvcm5hIGFycmF5IGRlIHJvd3MgY29uIHRvZG9zIGxvcyBjYW1wb3MgKyByZWNvbWVuZGFkby5cbiAgY29uc3Qgcm93cyA9IFtdO1xuICBjb25zdCBmYW1pbGlhcyA9IFsncm9kcycsICdyZWVscyddO1xuICBmb3IgKGNvbnN0IGZhbSBvZiBmYW1pbGlhcykge1xuICAgIGNvbnN0IGNhY2hlID0gX3NhbGVzUGxhbkNhY2hlc1tmYW1dO1xuICAgIGlmICghY2FjaGUgfHwgIWNhY2hlLnJvd3MpIGNvbnRpbnVlO1xuICAgIGZvciAoY29uc3Qgc3BSb3cgb2YgY2FjaGUucm93cykge1xuICAgICAgY29uc3Qgc2t1ID0gU3RyaW5nKHNwUm93LnNrdSB8fCAnJykudHJpbSgpO1xuICAgICAgY29uc3Qgc2t1VXBwZXIgPSBza3UudG9VcHBlckNhc2UoKTtcbiAgICAgIC8vIHYxMTEyOiBza2lwZWFtb3MgU0tVcyBkZXNjb250aW51YWRvcyAoTWFyaWFubyBsb3MgbWFyY2EgZGVzZGUgbGEgVUkpLlxuICAgICAgaWYgKF9kaXNjb250aW51ZWRTa3VzICYmIF9kaXNjb250aW51ZWRTa3VzLmhhcyhza3VVcHBlcikpIGNvbnRpbnVlO1xuICAgICAgY29uc3Qgc3RvY2tXaCA9XG4gICAgICAgIChfcmVjb1N0b2NrU25hcHNob3QgJiZcbiAgICAgICAgICBfcmVjb1N0b2NrU25hcHNob3Qud2FyZWhvdXNlQnJlYWtkb3duICYmXG4gICAgICAgICAgX3JlY29TdG9ja1NuYXBzaG90LndhcmVob3VzZUJyZWFrZG93bltza3VdKSB8fFxuICAgICAgICB7fTtcbiAgICAgIGNvbnN0IHN0b2NrTGlicmUgPSBOdW1iZXIoc3RvY2tXaFsnMTEnXSB8fCAwKTtcbiAgICAgIGNvbnN0IGVuVHJhbnNpdG8gPSBOdW1iZXIoc3RvY2tXaFsnMTInXSB8fCAwKTtcbiAgICAgIGNvbnN0IGJhY2tvcmRlciA9IE51bWJlcihcbiAgICAgICAgKF9yZWNvU3RvY2tTbmFwc2hvdCAmJlxuICAgICAgICAgIF9yZWNvU3RvY2tTbmFwc2hvdC5iYWNrb3JkZXJCeVNrdSAmJlxuICAgICAgICAgIF9yZWNvU3RvY2tTbmFwc2hvdC5iYWNrb3JkZXJCeVNrdVtza3VdKSB8fFxuICAgICAgICAgIDBcbiAgICAgICk7XG4gICAgICBjb25zdCB2ZW50YU1lbnN1YWwgPSBfY29tcHV0ZVZlbnRhTWVuc3VhbFByb21lZGlvKHNrdVVwcGVyKTtcbiAgICAgIGNvbnN0IHNhbGVzUGxhbkZ1dCA9IF9jb21wdXRlU2FsZXNQbGFuRnV0dXJvKHNwUm93KTtcbiAgICAgIGNvbnN0IG1vcSA9IE51bWJlcihzcFJvdy5tb3EgfHwgMCk7XG4gICAgICAvLyB2MTExNCBGM0I6IG11bHRpcGxpY2Fkb3IgYXV0byAocmVjZW50L2Jhc2VsaW5lKSBvIG92ZXJyaWRlIG1hbnVhbC5cbiAgICAgIGNvbnN0IG11bHRJbmZvID0gX2dldEVmZmVjdGl2ZU11bHRpcGxpZXIoc2t1VXBwZXIpO1xuICAgICAgY29uc3QgbXVsdGlwbGllciA9IG11bHRJbmZvLnZhbHVlO1xuICAgICAgY29uc3QgZGVtYW5kYUVzcGVyYWRhID0gdmVudGFNZW5zdWFsICogbXVsdGlwbGllciAqIFJFQ09fSE9SSVpPTl9NT05USFM7XG4gICAgICBjb25zdCBiYWxhbmNlID0gc3RvY2tMaWJyZSArIGVuVHJhbnNpdG8gKyBzYWxlc1BsYW5GdXQgLSBiYWNrb3JkZXIgLSBkZW1hbmRhRXNwZXJhZGE7XG4gICAgICBsZXQgcmVjb21lbmRhZG8gPSAwO1xuICAgICAgaWYgKGJhbGFuY2UgPCAwKSB7XG4gICAgICAgIGNvbnN0IGRlZmljaXQgPSAtYmFsYW5jZTtcbiAgICAgICAgcmVjb21lbmRhZG8gPSBtb3EgPiAwID8gTWF0aC5tYXgobW9xLCBNYXRoLmNlaWwoZGVmaWNpdCAvIG1vcSkgKiBtb3EpIDogTWF0aC5jZWlsKGRlZmljaXQpO1xuICAgICAgfVxuICAgICAgcm93cy5wdXNoKHtcbiAgICAgICAgZmFtaWxpYTogZmFtLFxuICAgICAgICBza3UsXG4gICAgICAgIGRlc2NyaXB0aW9uOiBzcFJvdy5kZXNjcmlwdGlvbiB8fCAnJyxcbiAgICAgICAgbW9xLFxuICAgICAgICBzdG9ja0xpYnJlLFxuICAgICAgICBlblRyYW5zaXRvLFxuICAgICAgICBiYWNrb3JkZXIsXG4gICAgICAgIHZlbnRhTWVuc3VhbDogTWF0aC5yb3VuZCh2ZW50YU1lbnN1YWwgKiAxMCkgLyAxMCxcbiAgICAgICAgc2FsZXNQbGFuRnV0LFxuICAgICAgICBtdWx0aXBsaWVyLFxuICAgICAgICBtdWx0U291cmNlOiBtdWx0SW5mby5zb3VyY2UsIC8vICdhdXRvJyB8ICdtYW51YWwnIHwgJ2RlZmF1bHQnIHwgJ2ZhbGxiYWNrJ1xuICAgICAgICBtdWx0QXV0bzogbXVsdEluZm8uYXV0byA/IG11bHRJbmZvLmF1dG8udmFsdWUgOiBudWxsLCAvLyBlbCB2YWxvciBhdXRvIHNpIGhheSBvdmVycmlkZSBtYW51YWxcbiAgICAgICAgZGVtYW5kYUVzcGVyYWRhOiBNYXRoLnJvdW5kKGRlbWFuZGFFc3BlcmFkYSAqIDEwKSAvIDEwLFxuICAgICAgICBiYWxhbmNlOiBNYXRoLnJvdW5kKGJhbGFuY2UgKiAxMCkgLyAxMCxcbiAgICAgICAgcmVjb21lbmRhZG8sXG4gICAgICB9KTtcbiAgICB9XG4gIH1cbiAgLy8gT3JkZW5hciBwb3IgcmVjb21lbmRhZG8gZGVzY2VuZGVudGVcbiAgcm93cy5zb3J0KChhLCBiKSA9PiBiLnJlY29tZW5kYWRvIC0gYS5yZWNvbWVuZGFkbyk7XG4gIHJldHVybiByb3dzO1xufVxuXG5mdW5jdGlvbiBfZm10TnVtU2lnbmVkKG4pIHtcbiAgaWYgKG4gPT0gbnVsbCB8fCAhTnVtYmVyLmlzRmluaXRlKE51bWJlcihuKSkpIHJldHVybiAnXHUyMDE0JztcbiAgY29uc3QgdiA9IE51bWJlcihuKTtcbiAgY29uc3QgYWJzID0gTWF0aC5hYnModikudG9Mb2NhbGVTdHJpbmcoJ2VzLUFSJywgeyBtYXhpbXVtRnJhY3Rpb25EaWdpdHM6IDAgfSk7XG4gIHJldHVybiAodiA8IDAgPyAnXHUyMjEyJyA6ICcnKSArIGFicztcbn1cblxuZnVuY3Rpb24gX2ZtdEludChuKSB7XG4gIGlmIChuID09IG51bGwgfHwgIU51bWJlci5pc0Zpbml0ZShOdW1iZXIobikpKSByZXR1cm4gJ1x1MjAxNCc7XG4gIHJldHVybiBNYXRoLnJvdW5kKE51bWJlcihuKSkudG9Mb2NhbGVTdHJpbmcoJ2VzLUFSJyk7XG59XG5cbi8vIHYxMTE0IEYzQjogY2VsZGEgbXVsdGlwbGljYWRvciBjb24gY2hpcCBhdXRvL21hbnVhbCArIGlucHV0IGVkaXRhYmxlLlxuZnVuY3Rpb24gX2J1aWxkTXVsdENlbGxIdG1sKHIpIHtcbiAgY29uc3Qgc2t1VXBwZXIgPSBTdHJpbmcoci5za3UpLnRyaW0oKS50b1VwcGVyQ2FzZSgpO1xuICBjb25zdCBpc01hbnVhbCA9IHIubXVsdFNvdXJjZSA9PT0gJ21hbnVhbCc7XG4gIGNvbnN0IGlzRGVmYXVsdCA9IHIubXVsdFNvdXJjZSA9PT0gJ2RlZmF1bHQnO1xuICBjb25zdCB2YWwgPSBOdW1iZXIoci5tdWx0aXBsaWVyIHx8IDEuMCkudG9GaXhlZCgyKTtcbiAgLy8gQ29sb3IgcG9yIGRpcmVjY2lcdTAwRjNuOiA+MS4wNSB2ZXJkZSAoY3JlY2llbmRvKSwgPDAuOTUgcm9qbyAoY2F5ZW5kbyksIG1lZGlvIGdyaXMuXG4gIGxldCBkaXJDb2xvciA9ICd2YXIoLS10ZXh0LW11dGVkKSc7XG4gIGlmIChyLm11bHRpcGxpZXIgPiAxLjA1KSBkaXJDb2xvciA9ICcjMTZhMzRhJztcbiAgZWxzZSBpZiAoci5tdWx0aXBsaWVyIDwgMC45NSkgZGlyQ29sb3IgPSAnI2RjMjYyNic7XG5cbiAgY29uc3QgY2hpcCA9IGlzTWFudWFsXG4gICAgPyAnPHNwYW4gc3R5bGU9XCJkaXNwbGF5OmlubGluZS1ibG9jaztwYWRkaW5nOjFweCA1cHg7YmFja2dyb3VuZDojZjU5ZTBiO2NvbG9yOiNmZmY7Ym9yZGVyLXJhZGl1czo4cHg7Zm9udC1zaXplOjlweDtmb250LXdlaWdodDo3MDA7bWFyZ2luLWxlZnQ6NHB4XCIgdGl0bGU9XCJPdmVycmlkZSBtYW51YWw6IHBpc2EgZWwgYXV0b1wiPk08L3NwYW4+J1xuICAgIDogaXNEZWZhdWx0XG4gICAgICA/ICc8c3BhbiBzdHlsZT1cImRpc3BsYXk6aW5saW5lLWJsb2NrO3BhZGRpbmc6MXB4IDVweDtiYWNrZ3JvdW5kOiM5NGEzYjg7Y29sb3I6I2ZmZjtib3JkZXItcmFkaXVzOjhweDtmb250LXNpemU6OXB4O2ZvbnQtd2VpZ2h0OjcwMDttYXJnaW4tbGVmdDo0cHhcIiB0aXRsZT1cIlNpbiBkYXRvcyBzdWZpY2llbnRlczogdXNhIDEuMFwiPlx1MDBCNzwvc3Bhbj4nXG4gICAgICA6ICc8c3BhbiBzdHlsZT1cImRpc3BsYXk6aW5saW5lLWJsb2NrO3BhZGRpbmc6MXB4IDVweDtiYWNrZ3JvdW5kOiMwZDk0ODg7Y29sb3I6I2ZmZjtib3JkZXItcmFkaXVzOjhweDtmb250LXNpemU6OXB4O2ZvbnQtd2VpZ2h0OjcwMDttYXJnaW4tbGVmdDo0cHhcIiB0aXRsZT1cIkF1dG8gPSB2ZW50YSAybSAvIHZlbnRhIDZtXCI+QTwvc3Bhbj4nO1xuXG4gIGNvbnN0IHJlc2V0QnRuID0gaXNNYW51YWxcbiAgICA/ICc8YnV0dG9uIG9uY2xpY2s9XCJyZXNldE11bHRpcGxpZXIoXFwnJyArXG4gICAgICBlc2NhcGVIdG1sU2FmZShza3VVcHBlcikgK1xuICAgICAgJ1xcJylcIiB0aXRsZT1cIlZvbHZlciBhbCBhdXRvXCIgc3R5bGU9XCJtYXJnaW4tbGVmdDo0cHg7YmFja2dyb3VuZDp0cmFuc3BhcmVudDtib3JkZXI6bm9uZTtjdXJzb3I6cG9pbnRlcjtmb250LXNpemU6MTJweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTtwYWRkaW5nOjBcIj5cdTIxQkI8L2J1dHRvbj4nXG4gICAgOiAnJztcblxuICBjb25zdCBhdXRvSGludCA9XG4gICAgaXNNYW51YWwgJiYgci5tdWx0QXV0byAhPSBudWxsXG4gICAgICA/ICcgPHNwYW4gc3R5bGU9XCJmb250LXNpemU6MTBweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKVwiIHRpdGxlPVwiVmFsb3IgYXV0byBjYWxjdWxhZG9cIj4oYXV0byAnICtcbiAgICAgICAgTnVtYmVyKHIubXVsdEF1dG8pLnRvRml4ZWQoMikgK1xuICAgICAgICAnKTwvc3Bhbj4nXG4gICAgICA6ICcnO1xuXG4gIHJldHVybiAoXG4gICAgJzxzcGFuIHN0eWxlPVwiZGlzcGxheTppbmxpbmUtZmxleDthbGlnbi1pdGVtczpjZW50ZXI7Z2FwOjJweFwiPicgK1xuICAgICc8c3BhbiBvbmNsaWNrPVwiZWRpdE11bHRpcGxpZXIodGhpcywgXFwnJyArXG4gICAgZXNjYXBlSHRtbFNhZmUoc2t1VXBwZXIpICtcbiAgICAnXFwnKVwiIHN0eWxlPVwiY3Vyc29yOnBvaW50ZXI7cGFkZGluZzoycHggNnB4O2JvcmRlci1yYWRpdXM6NHB4O2JhY2tncm91bmQ6dmFyKC0tYmctc2Vjb25kYXJ5KTtmb250LXZhcmlhbnQtbnVtZXJpYzp0YWJ1bGFyLW51bXM7Zm9udC13ZWlnaHQ6NzAwO2NvbG9yOicgK1xuICAgIGRpckNvbG9yICtcbiAgICAnXCIgdGl0bGU9XCJDbGljayBwYXJhIGVkaXRhclwiPicgK1xuICAgIHZhbCArXG4gICAgJzwvc3Bhbj4nICtcbiAgICBjaGlwICtcbiAgICByZXNldEJ0biArXG4gICAgYXV0b0hpbnQgK1xuICAgICc8L3NwYW4+J1xuICApO1xufVxuXG53aW5kb3cuZWRpdE11bHRpcGxpZXIgPSBmdW5jdGlvbiAoZWwsIHNrdVVwcGVyKSB7XG4gIGNvbnN0IGN1cnJlbnRWYWwgPSBwYXJzZUZsb2F0KGVsLnRleHRDb250ZW50KSB8fCAxLjA7XG4gIGNvbnN0IGlucHV0ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnaW5wdXQnKTtcbiAgaW5wdXQudHlwZSA9ICdudW1iZXInO1xuICBpbnB1dC5zdGVwID0gJzAuMDUnO1xuICBpbnB1dC5taW4gPSAnMC4xJztcbiAgaW5wdXQubWF4ID0gJzUnO1xuICBpbnB1dC52YWx1ZSA9IFN0cmluZyhjdXJyZW50VmFsKTtcbiAgaW5wdXQuc3R5bGUuY3NzVGV4dCA9XG4gICAgJ3dpZHRoOjYwcHg7cGFkZGluZzoycHggNHB4O2ZvbnQtc2l6ZToxMnB4O2ZvbnQtd2VpZ2h0OjcwMDt0ZXh0LWFsaWduOmNlbnRlcjtib3JkZXI6MnB4IHNvbGlkICMwZDk0ODg7Ym9yZGVyLXJhZGl1czo0cHg7YmFja2dyb3VuZDp2YXIoLS1iZy1lbGV2YXRlZCk7Y29sb3I6dmFyKC0tdGV4dC1wcmltYXJ5KTtmb250LXZhcmlhbnQtbnVtZXJpYzp0YWJ1bGFyLW51bXMnO1xuICBjb25zdCBwYXJlbnQgPSBlbC5wYXJlbnROb2RlO1xuICBwYXJlbnQucmVwbGFjZUNoaWxkKGlucHV0LCBlbCk7XG4gIGlucHV0LmZvY3VzKCk7XG4gIGlucHV0LnNlbGVjdCgpO1xuXG4gIGNvbnN0IGNvbW1pdCA9IGFzeW5jICgpID0+IHtcbiAgICBjb25zdCB2ID0gcGFyc2VGbG9hdChpbnB1dC52YWx1ZSk7XG4gICAgaWYgKE51bWJlci5pc05hTih2KSB8fCB2IDwgMC4xIHx8IHYgPiA1KSB7XG4gICAgICBfcmVuZGVyUmVjb1NlY3Rpb24oKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgaWYgKE1hdGguYWJzKHYgLSBjdXJyZW50VmFsKSA8IDAuMDAxKSB7XG4gICAgICBfcmVuZGVyUmVjb1NlY3Rpb24oKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IF9zYXZlTXVsdGlwbGllck92ZXJyaWRlKHNrdVVwcGVyLCB2KTtcbiAgICAgIF9yZW5kZXJSZWNvU2VjdGlvbigpO1xuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgIGFsZXJ0KCdFcnJvciBndWFyZGFuZG86ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcbiAgICAgIF9yZW5kZXJSZWNvU2VjdGlvbigpO1xuICAgIH1cbiAgfTtcblxuICBjb25zdCBjYW5jZWwgPSAoKSA9PiBfcmVuZGVyUmVjb1NlY3Rpb24oKTtcblxuICBpbnB1dC5hZGRFdmVudExpc3RlbmVyKCdibHVyJywgY29tbWl0KTtcbiAgaW5wdXQuYWRkRXZlbnRMaXN0ZW5lcigna2V5ZG93bicsIChldikgPT4ge1xuICAgIGlmIChldi5rZXkgPT09ICdFbnRlcicpIHtcbiAgICAgIGV2LnByZXZlbnREZWZhdWx0KCk7XG4gICAgICBpbnB1dC5ibHVyKCk7XG4gICAgfSBlbHNlIGlmIChldi5rZXkgPT09ICdFc2NhcGUnKSB7XG4gICAgICBldi5wcmV2ZW50RGVmYXVsdCgpO1xuICAgICAgY2FuY2VsKCk7XG4gICAgfVxuICB9KTtcbn07XG5cbndpbmRvdy5yZXNldE11bHRpcGxpZXIgPSBhc3luYyBmdW5jdGlvbiAoc2t1VXBwZXIpIHtcbiAgaWYgKCFjb25maXJtKCdWb2x2ZXIgZWwgbXVsdGlwbGljYWRvciBkZSAnICsgc2t1VXBwZXIgKyAnIGFsIGNcdTAwRTFsY3VsbyBhdXRvbVx1MDBFMXRpY28/JykpIHJldHVybjtcbiAgdHJ5IHtcbiAgICBhd2FpdCBfcmVtb3ZlTXVsdGlwbGllck92ZXJyaWRlKHNrdVVwcGVyKTtcbiAgICBfcmVuZGVyUmVjb1NlY3Rpb24oKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGFsZXJ0KCdFcnJvcjogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xuICB9XG59O1xuXG5mdW5jdGlvbiBfcmVuZGVyUmVjb1NlY3Rpb24oKSB7XG4gIGNvbnN0IGNvbnQgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgncmVjby1zZWN0aW9uLWNvbnRhaW5lcicpO1xuICBpZiAoIWNvbnQpIHJldHVybjtcbiAgdHJ5IHtcbiAgICBfcmVuZGVyUmVjb1NlY3Rpb25JbXBsKGNvbnQpO1xuICB9IGNhdGNoIChlKSB7XG4gICAgY29uc29sZS5lcnJvcignW0ZPUkVDQVNUIHJlY29dIHJlbmRlciBmYWlsJywgZSk7XG4gICAgY29udC5pbm5lckhUTUwgPVxuICAgICAgJzxkaXYgc3R5bGU9XCJwYWRkaW5nOjIwcHg7Y29sb3I6I2RjMjYyNlwiPicgK1xuICAgICAgJzxkaXYgc3R5bGU9XCJmb250LXdlaWdodDo3MDA7bWFyZ2luLWJvdHRvbTo4cHhcIj5FcnJvciByZW5kZXJpemFuZG8gdGFibGEgcmVjb21lbmRhY2lcdTAwRjNuPC9kaXY+JyArXG4gICAgICAnPHByZSBzdHlsZT1cImZvbnQtc2l6ZToxMXB4O2JhY2tncm91bmQ6I2ZlZjJmMjtwYWRkaW5nOjEwcHg7Ym9yZGVyLXJhZGl1czo2cHg7b3ZlcmZsb3c6YXV0bzt3aGl0ZS1zcGFjZTpwcmUtd3JhcFwiPicgK1xuICAgICAgZXNjYXBlSHRtbFNhZmUoZS5zdGFjayB8fCBlLm1lc3NhZ2UgfHwgU3RyaW5nKGUpKSArXG4gICAgICAnPC9wcmU+PC9kaXY+JztcbiAgfVxufVxuXG5mdW5jdGlvbiBfcmVuZGVyUmVjb1NlY3Rpb25JbXBsKGNvbnQpIHtcbiAgY29uc3QgYW55TG9hZGVkID0gISEoX3NhbGVzUGxhbkNhY2hlcy5yb2RzIHx8IF9zYWxlc1BsYW5DYWNoZXMucmVlbHMpO1xuICBpZiAoIWFueUxvYWRlZCkge1xuICAgIGNvbnQuaW5uZXJIVE1MID0gJyc7XG4gICAgcmV0dXJuO1xuICB9XG4gIGlmICghX3JlY29TdG9ja1NuYXBzaG90IHx8ICFfcmVjb1ZlbnRhc1NuYXBzaG90KSB7XG4gICAgY29udC5pbm5lckhUTUwgPVxuICAgICAgJzxkaXYgc3R5bGU9XCJwYWRkaW5nOjQwcHggMThweDt0ZXh0LWFsaWduOmNlbnRlcjtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKVwiPicgK1xuICAgICAgJzxkaXYgc3R5bGU9XCJkaXNwbGF5OmlubGluZS1ibG9jazt3aWR0aDoyNHB4O2hlaWdodDoyNHB4O2JvcmRlcjozcHggc29saWQgIzBkOTQ4ODtib3JkZXItdG9wLWNvbG9yOnRyYW5zcGFyZW50O2JvcmRlci1yYWRpdXM6NTAlO2FuaW1hdGlvbjpzcGluIDAuOHMgbGluZWFyIGluZmluaXRlO21hcmdpbi1ib3R0b206MTBweFwiPjwvZGl2PicgK1xuICAgICAgJzxkaXY+Q2FyZ2FuZG8gc3RvY2sgKyB2ZW50YXMgaGlzdFx1MDBGM3JpY2FzLi4uPC9kaXY+JyArXG4gICAgICAnPHN0eWxlPkBrZXlmcmFtZXMgc3Bpbnt0b3t0cmFuc2Zvcm06cm90YXRlKDM2MGRlZyl9fTwvc3R5bGU+PC9kaXY+JztcbiAgICBfbG9hZFJlY29EYXRhKClcbiAgICAgIC50aGVuKF9yZW5kZXJSZWNvU2VjdGlvbilcbiAgICAgIC5jYXRjaCgoZSkgPT4ge1xuICAgICAgICBjb25zb2xlLmVycm9yKCdbRk9SRUNBU1QgcmVjb10gbG9hZCBmYWlsJywgZSk7XG4gICAgICAgIGNvbnQuaW5uZXJIVE1MID1cbiAgICAgICAgICAnPGRpdiBzdHlsZT1cInBhZGRpbmc6MjBweDtjb2xvcjojZGMyNjI2XCI+RXJyb3IgY2FyZ2FuZG8gZGF0b3M6ICcgK1xuICAgICAgICAgIGVzY2FwZUh0bWxTYWZlKGUubWVzc2FnZSB8fCBTdHJpbmcoZSkpICtcbiAgICAgICAgICAnPC9kaXY+JztcbiAgICAgIH0pO1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCBhbGxSb3dzID0gX2NvbXB1dGVSZWNvbW1lbmRhdGlvbnMoKTtcbiAgY29uc3Qgc2VhcmNoTGMgPSBfcmVjb1NlYXJjaFRleHQudHJpbSgpLnRvTG93ZXJDYXNlKCk7XG4gIGNvbnN0IHJvd3MgPSBhbGxSb3dzLmZpbHRlcigocikgPT4ge1xuICAgIGlmIChfcmVjb0ZpbHRlckZhbWlsaWEgIT09ICdhbGwnICYmIHIuZmFtaWxpYSAhPT0gX3JlY29GaWx0ZXJGYW1pbGlhKSByZXR1cm4gZmFsc2U7XG4gICAgaWYgKF9yZWNvRmlsdGVyTWluUmVjICYmIHIucmVjb21lbmRhZG8gPD0gMCkgcmV0dXJuIGZhbHNlO1xuICAgIGlmIChzZWFyY2hMYykge1xuICAgICAgY29uc3QgaGF5ID1cbiAgICAgICAgci5za3UudG9Mb3dlckNhc2UoKS5pbmNsdWRlcyhzZWFyY2hMYykgfHwgci5kZXNjcmlwdGlvbi50b0xvd2VyQ2FzZSgpLmluY2x1ZGVzKHNlYXJjaExjKTtcbiAgICAgIGlmICghaGF5KSByZXR1cm4gZmFsc2U7XG4gICAgfVxuICAgIHJldHVybiB0cnVlO1xuICB9KTtcbiAgY29uc3QgdG90YWxSZWNvID0gYWxsUm93cy5yZWR1Y2UoKHMsIHIpID0+IHMgKyByLnJlY29tZW5kYWRvLCAwKTtcbiAgY29uc3QgdG90YWxDb25SZWNvID0gYWxsUm93cy5maWx0ZXIoKHIpID0+IHIucmVjb21lbmRhZG8gPiAwKS5sZW5ndGg7XG5cbiAgY29uc3QgbkRpc2MgPSBfZGlzY29udGludWVkU2t1cyA/IF9kaXNjb250aW51ZWRTa3VzLnNpemUgOiAwO1xuICBjb25zdCBkaXNjQ2hpcCA9XG4gICAgbkRpc2MgPiAwXG4gICAgICA/ICc8YnV0dG9uIG9uY2xpY2s9XCJvcGVuRGlzY29udGludWVkTW9kYWwoKVwiIHN0eWxlPVwicGFkZGluZzo2cHggMTJweDtiYWNrZ3JvdW5kOiM5MzMzZWE7Y29sb3I6I2ZmZjtib3JkZXI6bm9uZTtib3JkZXItcmFkaXVzOjZweDtmb250LXNpemU6MTJweDtmb250LXdlaWdodDo3MDA7Y3Vyc29yOnBvaW50ZXJcIiB0aXRsZT1cIkdlc3Rpb25hciBTS1VzIGRlc2NvbnRpbnVhZG9zXCI+XHVEODNEXHVERUFCICcgK1xuICAgICAgICBfZm10SW50KG5EaXNjKSArXG4gICAgICAgICcgZGVzY29udGludWFkb3M8L2J1dHRvbj4nXG4gICAgICA6ICcnO1xuICAvLyB2MTM1NSAoMjAyNi0xMC0xOSk6IGJvdG9uIFwiUHJveGltYXMgZGVzY29udGludWFjaW9uZXNcIiBwYXJhIG1hcmNhciBlbiBidWxrXG4gIC8vIGxvcyBTS1VzIHF1ZSBzZSB2YW4gYSBkZXNjb250aW51YXIgZW4gcHJveGltb3MgbWVzZXMuIE1pc21vIGVmZWN0byBlblxuICAvLyBmb3JlY2FzdCBxdWUgZGVzY29udGludWFyIChza2lwZWEgZW4gX2NvbXB1dGVSZWNvbW1lbmRhdGlvbnMpIHBlcm8gVVhcbiAgLy8gYnVsay1tYXJraW5nIGNvbiBjaGVja2JveGVzIHZzIGZpbGEtcG9yLWZpbGEgY29uIFx1RDgzRFx1REREMS4gUGVkaWRvIE1hcmlhbm8uXG4gIGNvbnN0IHVwY29taW5nQnRuID1cbiAgICAnPGJ1dHRvbiBvbmNsaWNrPVwib3BlblVwY29taW5nRGlzY29udGludWVkTW9kYWwoKVwiIHN0eWxlPVwicGFkZGluZzo2cHggMTJweDtiYWNrZ3JvdW5kOiMyNTYzZWI7Y29sb3I6I2ZmZjtib3JkZXI6bm9uZTtib3JkZXItcmFkaXVzOjZweDtmb250LXNpemU6MTJweDtmb250LXdlaWdodDo3MDA7Y3Vyc29yOnBvaW50ZXJcIiB0aXRsZT1cIk1hcmNhciBlbiBidWxrIFNLVXMgcXVlIHNlIHZhbiBhIGRlc2NvbnRpbnVhclwiPlx1RDgzRFx1RENDQiBQclx1MDBGM3hpbWFzIGRlc2NvbnRpbnVhY2lvbmVzPC9idXR0b24+JztcblxuICBjb25zdCBoZWFkZXIgPVxuICAgICc8ZGl2IHN0eWxlPVwiZGlzcGxheTpmbGV4O2ZsZXgtd3JhcDp3cmFwO2dhcDoxMHB4O2FsaWduLWl0ZW1zOmNlbnRlcjttYXJnaW4tYm90dG9tOjEycHhcIj4nICtcbiAgICAnPGRpdiBzdHlsZT1cImZsZXg6MTttaW4td2lkdGg6MjgwcHhcIj48ZGl2IHN0eWxlPVwiZm9udC1zaXplOjE4cHg7Zm9udC13ZWlnaHQ6ODAwO2NvbG9yOnZhcigtLXRleHQtcHJpbWFyeSlcIj5SZWNvbWVuZGFjaVx1MDBGM24gZGUgQ29tcHJhPC9kaXY+JyArXG4gICAgJzxkaXYgc3R5bGU9XCJmb250LXNpemU6MTFweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTttYXJnaW4tdG9wOjJweFwiPkJhbGFuY2UgPSBTdG9jayArIFRyXHUwMEUxbnNpdG8gKyBQbGFuIFx1MjIxMiBCYWNrb3JkZXIgXHUyMjEyIChWZW50YSBtZW5zLiBcdTAwRDcgJyArXG4gICAgUkVDT19IT1JJWk9OX01PTlRIUyArXG4gICAgJ20pPC9kaXY+PC9kaXY+JyArXG4gICAgdXBjb21pbmdCdG4gK1xuICAgICc8ZGl2IHN0eWxlPVwicGFkZGluZzo2cHggMTJweDtiYWNrZ3JvdW5kOiMwZDk0ODg7Y29sb3I6I2ZmZjtib3JkZXItcmFkaXVzOjZweDtmb250LXNpemU6MTJweDtmb250LXdlaWdodDo3MDBcIj4nICtcbiAgICBfZm10SW50KHRvdGFsQ29uUmVjbykgK1xuICAgICcgU0tVcyBjb24gcmVjbzwvZGl2PicgK1xuICAgICc8ZGl2IHN0eWxlPVwicGFkZGluZzo2cHggMTJweDtiYWNrZ3JvdW5kOiMxMzRlNGE7Y29sb3I6I2ZmZjtib3JkZXItcmFkaXVzOjZweDtmb250LXNpemU6MTJweDtmb250LXdlaWdodDo3MDBcIj5cdTAzQTMgJyArXG4gICAgX2ZtdEludCh0b3RhbFJlY28pICtcbiAgICAnIHVuaWRhZGVzPC9kaXY+JyArXG4gICAgZGlzY0NoaXAgK1xuICAgICc8L2Rpdj4nO1xuXG4gIGNvbnN0IGZpbHRlcnMgPVxuICAgICc8ZGl2IHN0eWxlPVwiZGlzcGxheTpmbGV4O2ZsZXgtd3JhcDp3cmFwO2dhcDo4cHg7bWFyZ2luLWJvdHRvbToxMHB4O3BhZGRpbmc6MTBweDtiYWNrZ3JvdW5kOnZhcigtLWJnLXNlY29uZGFyeSk7Ym9yZGVyLXJhZGl1czo2cHhcIj4nICtcbiAgICAnPGlucHV0IHR5cGU9XCJ0ZXh0XCIgaWQ9XCJyZWNvLXNlYXJjaFwiIHBsYWNlaG9sZGVyPVwiQnVzY2FyIFNLVSBvIGRlc2NyaXBjaW9uLi4uXCIgdmFsdWU9XCInICtcbiAgICBlc2NhcGVIdG1sU2FmZShfcmVjb1NlYXJjaFRleHQpICtcbiAgICAnXCIgb25pbnB1dD1cIm9uUmVjb1NlYXJjaENoYW5nZShldmVudClcIiBzdHlsZT1cImZsZXg6MTttaW4td2lkdGg6MjAwcHg7cGFkZGluZzo2cHggMTBweDtib3JkZXI6MXB4IHNvbGlkIHZhcigtLWJvcmRlci1zdWJ0bGUpO2JvcmRlci1yYWRpdXM6NHB4O2ZvbnQtc2l6ZToxMnB4O2JhY2tncm91bmQ6dmFyKC0tYmctZWxldmF0ZWQpO2NvbG9yOnZhcigtLXRleHQtcHJpbWFyeSlcIi8+JyArXG4gICAgJzxzZWxlY3Qgb25jaGFuZ2U9XCJvblJlY29GYW1pbGlhQ2hhbmdlKGV2ZW50KVwiIHN0eWxlPVwicGFkZGluZzo2cHggMTBweDtib3JkZXI6MXB4IHNvbGlkIHZhcigtLWJvcmRlci1zdWJ0bGUpO2JvcmRlci1yYWRpdXM6NHB4O2ZvbnQtc2l6ZToxMnB4O2JhY2tncm91bmQ6dmFyKC0tYmctZWxldmF0ZWQpO2NvbG9yOnZhcigtLXRleHQtcHJpbWFyeSlcIj4nICtcbiAgICAnPG9wdGlvbiB2YWx1ZT1cImFsbFwiJyArXG4gICAgKF9yZWNvRmlsdGVyRmFtaWxpYSA9PT0gJ2FsbCcgPyAnIHNlbGVjdGVkJyA6ICcnKSArXG4gICAgJz5Ub2RhcyBsYXMgZmFtaWxpYXM8L29wdGlvbj4nICtcbiAgICAnPG9wdGlvbiB2YWx1ZT1cInJvZHNcIicgK1xuICAgIChfcmVjb0ZpbHRlckZhbWlsaWEgPT09ICdyb2RzJyA/ICcgc2VsZWN0ZWQnIDogJycpICtcbiAgICAnPlNvbG8gUm9kcyAoQ2FcdTAwRjFhcyk8L29wdGlvbj4nICtcbiAgICAnPG9wdGlvbiB2YWx1ZT1cInJlZWxzXCInICtcbiAgICAoX3JlY29GaWx0ZXJGYW1pbGlhID09PSAncmVlbHMnID8gJyBzZWxlY3RlZCcgOiAnJykgK1xuICAgICc+U29sbyBSZWVsczwvb3B0aW9uPicgK1xuICAgICc8L3NlbGVjdD4nICtcbiAgICAnPGxhYmVsIHN0eWxlPVwiZGlzcGxheTppbmxpbmUtZmxleDthbGlnbi1pdGVtczpjZW50ZXI7Z2FwOjZweDtwYWRkaW5nOjZweCAxMHB4O2ZvbnQtc2l6ZToxMnB4O2NvbG9yOnZhcigtLXRleHQtcHJpbWFyeSk7Y3Vyc29yOnBvaW50ZXJcIj4nICtcbiAgICAnPGlucHV0IHR5cGU9XCJjaGVja2JveFwiJyArXG4gICAgKF9yZWNvRmlsdGVyTWluUmVjID8gJyBjaGVja2VkJyA6ICcnKSArXG4gICAgJyBvbmNoYW5nZT1cIm9uUmVjb0ZpbHRlck1pbkNoYW5nZShldmVudClcIi8+JyArXG4gICAgJ1NvbG8gY29uIHJlY29tZW5kYWRvICZndDsgMDwvbGFiZWw+JyArXG4gICAgJzxidXR0b24gb25jbGljaz1cImV4cG9ydFJlY29FeGNlbCgpXCIgc3R5bGU9XCJwYWRkaW5nOjZweCAxMnB4O2JhY2tncm91bmQ6IzE2YTM0YTtjb2xvcjojZmZmO2JvcmRlcjpub25lO2JvcmRlci1yYWRpdXM6NHB4O2ZvbnQtc2l6ZToxMnB4O2ZvbnQtd2VpZ2h0OjcwMDtjdXJzb3I6cG9pbnRlclwiPlx1MkIwNyBFeGNlbDwvYnV0dG9uPicgK1xuICAgICc8L2Rpdj4nO1xuXG4gIGNvbnN0IHJvd3NIdG1sID0gcm93c1xuICAgIC5tYXAoKHIpID0+IHtcbiAgICAgIGNvbnN0IGJhbENvbG9yID0gci5iYWxhbmNlIDwgMCA/ICcjZGMyNjI2JyA6IHIuYmFsYW5jZSA8IDUwID8gJyNmNTllMGInIDogJyMxNmEzNGEnO1xuICAgICAgY29uc3QgcmVjQ29sb3IgPSByLnJlY29tZW5kYWRvID4gMCA/ICcjZGMyNjI2JyA6ICcjOTRhM2I4JztcbiAgICAgIHJldHVybiAoXG4gICAgICAgICc8dHIgc3R5bGU9XCJib3JkZXItYm90dG9tOjFweCBzb2xpZCB2YXIoLS1ib3JkZXItc3VidGxlKVwiPicgK1xuICAgICAgICAnPHRkIHN0eWxlPVwicGFkZGluZzo2cHggOHB4O3RleHQtYWxpZ246Y2VudGVyXCI+PHNwYW4gc3R5bGU9XCJkaXNwbGF5OmlubGluZS1ibG9jaztwYWRkaW5nOjJweCA2cHg7Ym9yZGVyLXJhZGl1czoxMHB4O2JhY2tncm91bmQ6JyArXG4gICAgICAgIChyLmZhbWlsaWEgPT09ICdyb2RzJyA/ICcjMGVhNWU5JyA6ICcjOGI1Y2Y2JykgK1xuICAgICAgICAnO2NvbG9yOiNmZmY7Zm9udC1zaXplOjEwcHg7Zm9udC13ZWlnaHQ6NzAwXCI+JyArXG4gICAgICAgIChyLmZhbWlsaWEgPT09ICdyb2RzJyA/ICdST0QnIDogJ1JFRUwnKSArXG4gICAgICAgICc8L3NwYW4+PC90ZD4nICtcbiAgICAgICAgJzx0ZCBzdHlsZT1cInBhZGRpbmc6NnB4IDhweDt0ZXh0LWFsaWduOmNlbnRlcjtmb250LWZhbWlseTptb25vc3BhY2U7Zm9udC1zaXplOjExcHg7Y29sb3I6dmFyKC0tdGV4dC1wcmltYXJ5KTtmb250LXdlaWdodDo3MDBcIj4nICtcbiAgICAgICAgZXNjYXBlSHRtbFNhZmUoci5za3UpICtcbiAgICAgICAgJzwvdGQ+JyArXG4gICAgICAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjZweCA4cHg7Zm9udC1zaXplOjExcHg7Y29sb3I6dmFyKC0tdGV4dC1zZWNvbmRhcnkpO21heC13aWR0aDoyNDBweDtvdmVyZmxvdzpoaWRkZW47dGV4dC1vdmVyZmxvdzplbGxpcHNpczt3aGl0ZS1zcGFjZTpub3dyYXBcIiB0aXRsZT1cIicgK1xuICAgICAgICBlc2NhcGVIdG1sU2FmZShyLmRlc2NyaXB0aW9uKSArXG4gICAgICAgICdcIj4nICtcbiAgICAgICAgZXNjYXBlSHRtbFNhZmUoci5kZXNjcmlwdGlvbikgK1xuICAgICAgICAnPC90ZD4nICtcbiAgICAgICAgJzx0ZCBzdHlsZT1cInBhZGRpbmc6NnB4IDhweDt0ZXh0LWFsaWduOmNlbnRlcjtmb250LXZhcmlhbnQtbnVtZXJpYzp0YWJ1bGFyLW51bXM7Y29sb3I6dmFyKC0tdGV4dC1wcmltYXJ5KVwiPicgK1xuICAgICAgICBfZm10SW50KHIuc3RvY2tMaWJyZSkgK1xuICAgICAgICAnPC90ZD4nICtcbiAgICAgICAgJzx0ZCBzdHlsZT1cInBhZGRpbmc6NnB4IDhweDt0ZXh0LWFsaWduOmNlbnRlcjtmb250LXZhcmlhbnQtbnVtZXJpYzp0YWJ1bGFyLW51bXM7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZClcIj4nICtcbiAgICAgICAgX2ZtdEludChyLmVuVHJhbnNpdG8pICtcbiAgICAgICAgJzwvdGQ+JyArXG4gICAgICAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjZweCA4cHg7dGV4dC1hbGlnbjpjZW50ZXI7Zm9udC12YXJpYW50LW51bWVyaWM6dGFidWxhci1udW1zO2NvbG9yOiNkYzI2MjZcIj4nICtcbiAgICAgICAgX2ZtdEludChyLmJhY2tvcmRlcikgK1xuICAgICAgICAnPC90ZD4nICtcbiAgICAgICAgJzx0ZCBzdHlsZT1cInBhZGRpbmc6NnB4IDhweDt0ZXh0LWFsaWduOmNlbnRlcjtmb250LXZhcmlhbnQtbnVtZXJpYzp0YWJ1bGFyLW51bXM7Y29sb3I6dmFyKC0tdGV4dC1zZWNvbmRhcnkpXCI+JyArXG4gICAgICAgIF9mbXRJbnQoci52ZW50YU1lbnN1YWwpICtcbiAgICAgICAgJzwvdGQ+JyArXG4gICAgICAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjZweCA4cHg7dGV4dC1hbGlnbjpjZW50ZXJcIj4nICtcbiAgICAgICAgX2J1aWxkTXVsdENlbGxIdG1sKHIpICtcbiAgICAgICAgJzwvdGQ+JyArXG4gICAgICAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjZweCA4cHg7dGV4dC1hbGlnbjpjZW50ZXI7Zm9udC12YXJpYW50LW51bWVyaWM6dGFidWxhci1udW1zO2NvbG9yOnZhcigtLXRleHQtc2Vjb25kYXJ5KVwiPicgK1xuICAgICAgICBfZm10SW50KHIuZGVtYW5kYUVzcGVyYWRhKSArXG4gICAgICAgICc8L3RkPicgK1xuICAgICAgICAnPHRkIHN0eWxlPVwicGFkZGluZzo2cHggOHB4O3RleHQtYWxpZ246Y2VudGVyO2ZvbnQtdmFyaWFudC1udW1lcmljOnRhYnVsYXItbnVtcztjb2xvcjp2YXIoLS10ZXh0LXByaW1hcnkpO2ZvbnQtd2VpZ2h0OjYwMFwiPicgK1xuICAgICAgICBfZm10SW50KHIuc2FsZXNQbGFuRnV0KSArXG4gICAgICAgICc8L3RkPicgK1xuICAgICAgICAnPHRkIHN0eWxlPVwicGFkZGluZzo2cHggOHB4O3RleHQtYWxpZ246Y2VudGVyO2ZvbnQtdmFyaWFudC1udW1lcmljOnRhYnVsYXItbnVtcztmb250LXdlaWdodDo3MDA7Y29sb3I6JyArXG4gICAgICAgIGJhbENvbG9yICtcbiAgICAgICAgJ1wiPicgK1xuICAgICAgICBfZm10TnVtU2lnbmVkKHIuYmFsYW5jZSkgK1xuICAgICAgICAnPC90ZD4nICtcbiAgICAgICAgJzx0ZCBzdHlsZT1cInBhZGRpbmc6NnB4IDhweDt0ZXh0LWFsaWduOmNlbnRlcjtmb250LXZhcmlhbnQtbnVtZXJpYzp0YWJ1bGFyLW51bXM7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7Zm9udC1zaXplOjExcHhcIj4nICtcbiAgICAgICAgX2ZtdEludChyLm1vcSkgK1xuICAgICAgICAnPC90ZD4nICtcbiAgICAgICAgJzx0ZCBzdHlsZT1cInBhZGRpbmc6NnB4IDhweDt0ZXh0LWFsaWduOmNlbnRlclwiPjxzcGFuIHN0eWxlPVwiZGlzcGxheTppbmxpbmUtYmxvY2s7cGFkZGluZzo0cHggMTBweDtib3JkZXItcmFkaXVzOjEycHg7YmFja2dyb3VuZDonICtcbiAgICAgICAgcmVjQ29sb3IgK1xuICAgICAgICAnO2NvbG9yOiNmZmY7Zm9udC1zaXplOjEycHg7Zm9udC13ZWlnaHQ6ODAwO21pbi13aWR0aDo1MHB4XCI+JyArXG4gICAgICAgIF9mbXRJbnQoci5yZWNvbWVuZGFkbykgK1xuICAgICAgICAnPC9zcGFuPjwvdGQ+JyArXG4gICAgICAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjZweCA4cHg7dGV4dC1hbGlnbjpjZW50ZXJcIj4nICtcbiAgICAgICAgJzxidXR0b24gb25jbGljaz1cImRpc2NvbnRpbnVlU2t1KFxcJycgK1xuICAgICAgICBlc2NhcGVIdG1sU2FmZShyLnNrdSkgK1xuICAgICAgICBcIicsICdcIiArXG4gICAgICAgIGVzY2FwZUh0bWxTYWZlKHIuZGVzY3JpcHRpb24ucmVwbGFjZSgvJy9nLCAnJykpICtcbiAgICAgICAgJ1xcJylcIiB0aXRsZT1cIkRlc2NvbnRpbnVhciBlc3RlIFNLVVwiIHN0eWxlPVwiYmFja2dyb3VuZDp0cmFuc3BhcmVudDtib3JkZXI6MXB4IHNvbGlkIHZhcigtLWJvcmRlci1zdWJ0bGUpO2JvcmRlci1yYWRpdXM6NHB4O3BhZGRpbmc6NHB4IDhweDtjdXJzb3I6cG9pbnRlcjtmb250LXNpemU6MTRweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKVwiPlx1RDgzRFx1REREMTwvYnV0dG9uPicgK1xuICAgICAgICAnPC90ZD4nICtcbiAgICAgICAgJzwvdHI+J1xuICAgICAgKTtcbiAgICB9KVxuICAgIC5qb2luKCcnKTtcblxuICAvLyB2MTExMjogbWluLXdpZHRoIHBhcmEgZm9yemFyIHNjcm9sbCBob3Jpem9udGFsIHNpIG5vIGNhYmUgbGEgY29sdW1uYVxuICAvLyBBY2NpXHUwMEYzbi4gU2luIGVzdG8sIHRhYmxlIHdpZHRoOjEwMCUgY29tcHJpbWUgdG9kbyB5IGxhIFx1MDBGQWx0aW1hIGNvbHVtbmFcbiAgLy8gcXVlZGEgZnVlcmEgZGVsIHZpZXdwb3J0IHNpbiBzY3JvbGwgdmlzaWJsZS5cbiAgY29uc3QgdGFibGUgPVxuICAgICc8ZGl2IHN0eWxlPVwib3ZlcmZsb3c6YXV0bzttYXgtaGVpZ2h0OjYwdmg7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1ib3JkZXItc3VidGxlKTtib3JkZXItcmFkaXVzOjhweFwiPicgK1xuICAgICc8dGFibGUgc3R5bGU9XCJ3aWR0aDoxMDAlO21pbi13aWR0aDoxNDAwcHg7Ym9yZGVyLWNvbGxhcHNlOmNvbGxhcHNlO2ZvbnQtc2l6ZToxMnB4XCI+JyArXG4gICAgJzx0aGVhZCBzdHlsZT1cImJhY2tncm91bmQ6IzBmMTcyYTtjb2xvcjojZmZmO3Bvc2l0aW9uOnN0aWNreTt0b3A6MDt6LWluZGV4OjFcIj48dHI+JyArXG4gICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6OHB4O3RleHQtYWxpZ246Y2VudGVyO2ZvbnQtc2l6ZToxMHB4O3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZVwiPkZhbTwvdGg+JyArXG4gICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6OHB4O3RleHQtYWxpZ246Y2VudGVyO2ZvbnQtc2l6ZToxMHB4O3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZVwiPlNLVTwvdGg+JyArXG4gICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6OHB4O3RleHQtYWxpZ246Y2VudGVyO2ZvbnQtc2l6ZToxMHB4O3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZVwiPkRlc2NyaXBjaVx1MDBGM248L3RoPicgK1xuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjhweDt0ZXh0LWFsaWduOmNlbnRlcjtmb250LXNpemU6MTBweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2VcIiB0aXRsZT1cIldocyAxMSBkaXNwb25pYmxlIHZlbnRhXCI+U3RvY2s8L3RoPicgK1xuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjhweDt0ZXh0LWFsaWduOmNlbnRlcjtmb250LXNpemU6MTBweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2VcIiB0aXRsZT1cIldocyAxMlwiPlRyXHUwMEUxbnNpdG88L3RoPicgK1xuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjhweDt0ZXh0LWFsaWduOmNlbnRlcjtmb250LXNpemU6MTBweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2VcIj5CYWNrb3JkZXI8L3RoPicgK1xuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjhweDt0ZXh0LWFsaWduOmNlbnRlcjtmb250LXNpemU6MTBweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2VcIiB0aXRsZT1cIlByb21lZGlvIFx1MDBGQWx0aW1vcyAzIG1lc2VzXCI+VnRhL21lczwvdGg+JyArXG4gICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6OHB4O3RleHQtYWxpZ246Y2VudGVyO2ZvbnQtc2l6ZToxMHB4O3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZVwiIHRpdGxlPVwiTXVsdGlwbGljYWRvciBkZSB0ZW5kZW5jaWEgPSB2ZW50YSAybSAvIHZlbnRhIDZtLiBFZGl0YWJsZSAoY2xpY2sgcGFyYSBvdmVycmlkZSkuXCI+TXVsdGlwLjwvdGg+JyArXG4gICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6OHB4O3RleHQtYWxpZ246Y2VudGVyO2ZvbnQtc2l6ZToxMHB4O3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZVwiIHRpdGxlPVwiVnRhL21lcyBcdTAwRDcgNyBtZXNlc1wiPkRlbWFuZGEgZXNwLjwvdGg+JyArXG4gICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6OHB4O3RleHQtYWxpZ246Y2VudGVyO2ZvbnQtc2l6ZToxMHB4O3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZVwiIHRpdGxlPVwiU3VtYSBjb2x1bW5hcyBTYWxlcyBQbGFuIGRlc2RlIG1lcyBhY3R1YWxcIj5QbGFuIGZ1dHVybzwvdGg+JyArXG4gICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6OHB4O3RleHQtYWxpZ246Y2VudGVyO2ZvbnQtc2l6ZToxMHB4O3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZVwiPkJhbGFuY2U8L3RoPicgK1xuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjhweDt0ZXh0LWFsaWduOmNlbnRlcjtmb250LXNpemU6MTBweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2VcIj5NT1E8L3RoPicgK1xuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjhweDt0ZXh0LWFsaWduOmNlbnRlcjtmb250LXNpemU6MTBweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7YmFja2dyb3VuZDojMTM0ZTRhXCI+UmVjb21lbmRhZG88L3RoPicgK1xuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjhweDt0ZXh0LWFsaWduOmNlbnRlcjtmb250LXNpemU6MTBweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2VcIiB0aXRsZT1cIkRlc2NvbnRpbnVhciBTS1VcIj5BY2NpXHUwMEYzbjwvdGg+JyArXG4gICAgJzwvdHI+PC90aGVhZD48dGJvZHk+JyArXG4gICAgKHJvd3MubGVuZ3RoXG4gICAgICA/IHJvd3NIdG1sXG4gICAgICA6ICc8dHI+PHRkIGNvbHNwYW49XCIxNFwiIHN0eWxlPVwicGFkZGluZzo0MHB4O3RleHQtYWxpZ246Y2VudGVyO2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpXCI+U2luIHJlc3VsdGFkb3MgY29uIGxvcyBmaWx0cm9zIGFjdHVhbGVzPC90ZD48L3RyPicpICtcbiAgICAnPC90Ym9keT48L3RhYmxlPjwvZGl2Pic7XG5cbiAgY29uc3QgZm9vdGVyID1cbiAgICAnPGRpdiBzdHlsZT1cIm1hcmdpbi10b3A6OHB4O2ZvbnQtc2l6ZToxMHB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpXCI+JyArXG4gICAgJ01vc3RyYW5kbyAnICtcbiAgICBfZm10SW50KHJvd3MubGVuZ3RoKSArXG4gICAgJyBkZSAnICtcbiAgICBfZm10SW50KGFsbFJvd3MubGVuZ3RoKSArXG4gICAgJyBTS1VzIFx1MDBCNyAnICtcbiAgICAnQmFsYW5jZSA9IFN0b2NrICsgVHJcdTAwRTFuc2l0byArIFBsYW4gXHUyMjEyIEJhY2tvcmRlciBcdTIyMTIgRGVtYW5kYS4gUm9qbyA9IHF1aWVicmUgZXNwZXJhZG8uIFJlY29tZW5kYWRvIHNlIHJlZG9uZGVhIGFsIG1cdTAwRkFsdGlwbG8gZGUgTU9RIHN1cGVyaW9yLicgK1xuICAgICc8L2Rpdj4nO1xuXG4gIGNvbnQuaW5uZXJIVE1MID1cbiAgICAnPGRpdiBzdHlsZT1cInBhZGRpbmc6MThweCAxOHB4IDMwcHhcIj4nICsgaGVhZGVyICsgZmlsdGVycyArIHRhYmxlICsgZm9vdGVyICsgJzwvZGl2Pic7XG59XG5cbndpbmRvdy5vblJlY29TZWFyY2hDaGFuZ2UgPSBmdW5jdGlvbiAoZXYpIHtcbiAgX3JlY29TZWFyY2hUZXh0ID0gZXYudGFyZ2V0LnZhbHVlIHx8ICcnO1xuICBfcmVuZGVyUmVjb1NlY3Rpb24oKTtcbiAgLy8gUmVzdGF1cmFyIGZvY3VzICsgY2FyZXQgYWwgaW5wdXRcbiAgc2V0VGltZW91dCgoKSA9PiB7XG4gICAgY29uc3QgaW5wID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3JlY28tc2VhcmNoJyk7XG4gICAgaWYgKGlucCkge1xuICAgICAgaW5wLmZvY3VzKCk7XG4gICAgICBpbnAuc2V0U2VsZWN0aW9uUmFuZ2UoaW5wLnZhbHVlLmxlbmd0aCwgaW5wLnZhbHVlLmxlbmd0aCk7XG4gICAgfVxuICB9LCAwKTtcbn07XG5cbndpbmRvdy5vblJlY29GYW1pbGlhQ2hhbmdlID0gZnVuY3Rpb24gKGV2KSB7XG4gIF9yZWNvRmlsdGVyRmFtaWxpYSA9IGV2LnRhcmdldC52YWx1ZSB8fCAnYWxsJztcbiAgX3JlbmRlclJlY29TZWN0aW9uKCk7XG59O1xuXG53aW5kb3cub25SZWNvRmlsdGVyTWluQ2hhbmdlID0gZnVuY3Rpb24gKGV2KSB7XG4gIF9yZWNvRmlsdGVyTWluUmVjID0gISFldi50YXJnZXQuY2hlY2tlZDtcbiAgX3JlbmRlclJlY29TZWN0aW9uKCk7XG59O1xuXG53aW5kb3cuZXhwb3J0UmVjb0V4Y2VsID0gZnVuY3Rpb24gKCkge1xuICBpZiAodHlwZW9mIFhMU1ggPT09ICd1bmRlZmluZWQnKSB7XG4gICAgYWxlcnQoJ1NoZWV0SlMgKFhMU1gpIG5vIGNhcmdhZG8nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgY29uc3Qgcm93cyA9IF9jb21wdXRlUmVjb21tZW5kYXRpb25zKCk7XG4gIGNvbnN0IGFvYSA9IFtcbiAgICBbXG4gICAgICAnRmFtaWxpYScsXG4gICAgICAnU0tVJyxcbiAgICAgICdEZXNjcmlwY2lcdTAwRjNuJyxcbiAgICAgICdTdG9jaycsXG4gICAgICAnVHJcdTAwRTFuc2l0bycsXG4gICAgICAnQmFja29yZGVyJyxcbiAgICAgICdWdGEgcHJvbS9tZXMnLFxuICAgICAgJ011bHRpcGxpY2Fkb3InLFxuICAgICAgJ09yaWdlbiBtdWx0JyxcbiAgICAgICdEZW1hbmRhIGVzcC4gN20nLFxuICAgICAgJ1NhbGVzIFBsYW4gZnV0dXJvJyxcbiAgICAgICdCYWxhbmNlJyxcbiAgICAgICdNT1EnLFxuICAgICAgJ1JlY29tZW5kYWRvJyxcbiAgICBdLFxuICBdO1xuICBmb3IgKGNvbnN0IHIgb2Ygcm93cykge1xuICAgIGFvYS5wdXNoKFtcbiAgICAgIHIuZmFtaWxpYSA9PT0gJ3JvZHMnID8gJ1JvZHMgKENhXHUwMEYxYXMpJyA6ICdSZWVscycsXG4gICAgICByLnNrdSxcbiAgICAgIHIuZGVzY3JpcHRpb24sXG4gICAgICByLnN0b2NrTGlicmUsXG4gICAgICByLmVuVHJhbnNpdG8sXG4gICAgICByLmJhY2tvcmRlcixcbiAgICAgIHIudmVudGFNZW5zdWFsLFxuICAgICAgci5tdWx0aXBsaWVyLFxuICAgICAgci5tdWx0U291cmNlIHx8ICdhdXRvJyxcbiAgICAgIHIuZGVtYW5kYUVzcGVyYWRhLFxuICAgICAgci5zYWxlc1BsYW5GdXQsXG4gICAgICByLmJhbGFuY2UsXG4gICAgICByLm1vcSxcbiAgICAgIHIucmVjb21lbmRhZG8sXG4gICAgXSk7XG4gIH1cbiAgY29uc3Qgd3MgPSBYTFNYLnV0aWxzLmFvYV90b19zaGVldChhb2EpO1xuICB3c1snIWNvbHMnXSA9IFtcbiAgICB7IHdjaDogMTQgfSwgLy8gRmFtaWxpYVxuICAgIHsgd2NoOiAxOCB9LCAvLyBTS1VcbiAgICB7IHdjaDogNDAgfSwgLy8gRGVzY3JpcGNpXHUwMEYzblxuICAgIHsgd2NoOiA4IH0sIC8vIFN0b2NrXG4gICAgeyB3Y2g6IDEwIH0sIC8vIFRyXHUwMEUxbnNpdG9cbiAgICB7IHdjaDogMTEgfSwgLy8gQmFja29yZGVyXG4gICAgeyB3Y2g6IDEyIH0sIC8vIFZ0YSBwcm9tL21lc1xuICAgIHsgd2NoOiAxMiB9LCAvLyBNdWx0aXBsaWNhZG9yXG4gICAgeyB3Y2g6IDExIH0sIC8vIE9yaWdlbiBtdWx0XG4gICAgeyB3Y2g6IDE1IH0sIC8vIERlbWFuZGEgZXNwIDdtXG4gICAgeyB3Y2g6IDE2IH0sIC8vIFNhbGVzIFBsYW4gZnV0dXJvXG4gICAgeyB3Y2g6IDEwIH0sIC8vIEJhbGFuY2VcbiAgICB7IHdjaDogOCB9LCAvLyBNT1FcbiAgICB7IHdjaDogMTIgfSwgLy8gUmVjb21lbmRhZG9cbiAgXTtcbiAgY29uc3Qgd2IgPSBYTFNYLnV0aWxzLmJvb2tfbmV3KCk7XG4gIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQod2IsIHdzLCAnUmVjb21lbmRhY2lcdTAwRjNuJyk7XG4gIGNvbnN0IGhveSA9IG5ldyBEYXRlKCk7XG4gIGNvbnN0IHN0YW1wID1cbiAgICBob3kuZ2V0RnVsbFllYXIoKSArXG4gICAgJy0nICtcbiAgICBTdHJpbmcoaG95LmdldE1vbnRoKCkgKyAxKS5wYWRTdGFydCgyLCAnMCcpICtcbiAgICAnLScgK1xuICAgIFN0cmluZyhob3kuZ2V0RGF0ZSgpKS5wYWRTdGFydCgyLCAnMCcpO1xuICBYTFNYLndyaXRlRmlsZSh3YiwgJ1JlY29tZW5kYWNpb25fQ29tcHJhXycgKyBzdGFtcCArICcueGxzeCcpO1xufTtcblxuLy8gdjExMTIgRjNCOiBkZXNjb250aW51YXIgLyByZWFjdGl2YXIgU0tVcy5cbndpbmRvdy5kaXNjb250aW51ZVNrdSA9IGFzeW5jIGZ1bmN0aW9uIChza3UsIGRlc2NyaXB0aW9uKSB7XG4gIGlmICghX2Rpc2NvbnRpbnVlZFNrdXMpIF9kaXNjb250aW51ZWRTa3VzID0gbmV3IFNldCgpO1xuICBjb25zdCB1cHBlciA9IFN0cmluZyhza3UpLnRyaW0oKS50b1VwcGVyQ2FzZSgpO1xuICBjb25zdCBsYWJlbCA9IGRlc2NyaXB0aW9uID8gc2t1ICsgJyBcdTIwMTQgJyArIGRlc2NyaXB0aW9uLnNsaWNlKDAsIDYwKSA6IHNrdTtcbiAgaWYgKFxuICAgICFjb25maXJtKFxuICAgICAgJ0Rlc2NvbnRpbnVhciAnICtcbiAgICAgICAgbGFiZWwgK1xuICAgICAgICAnP1xcblxcblF1ZWRhclx1MDBFMSBleGNsdWlkbyBkZWwgY1x1MDBFMWxjdWxvIGRlIHJlY29tZW5kYWNpXHUwMEYzbiBkZSBjb21wcmEgaGFzdGEgcXVlIGxvIHJlYWN0aXZlcyBkZXNkZSBlbCBjaGlwIFwiRGVzY29udGludWFkb3NcIi4nXG4gICAgKVxuICApIHtcbiAgICByZXR1cm47XG4gIH1cbiAgX2Rpc2NvbnRpbnVlZFNrdXMuYWRkKHVwcGVyKTtcbiAgdHJ5IHtcbiAgICBhd2FpdCBfc2F2ZURpc2NvbnRpbnVlZFNrdXMoKTtcbiAgICBfcmVuZGVyUmVjb1NlY3Rpb24oKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIF9kaXNjb250aW51ZWRTa3VzLmRlbGV0ZSh1cHBlcik7XG4gICAgYWxlcnQoJ0Vycm9yIGd1YXJkYW5kbzogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xuICB9XG59O1xuXG53aW5kb3cucmVhY3RpdmF0ZVNrdSA9IGFzeW5jIGZ1bmN0aW9uIChza3UpIHtcbiAgaWYgKCFfZGlzY29udGludWVkU2t1cykgcmV0dXJuO1xuICBjb25zdCB1cHBlciA9IFN0cmluZyhza3UpLnRyaW0oKS50b1VwcGVyQ2FzZSgpO1xuICBfZGlzY29udGludWVkU2t1cy5kZWxldGUodXBwZXIpO1xuICB0cnkge1xuICAgIGF3YWl0IF9zYXZlRGlzY29udGludWVkU2t1cygpO1xuICAgIF9yZW5kZXJEaXNjb250aW51ZWRNb2RhbCgpO1xuICAgIF9yZW5kZXJSZWNvU2VjdGlvbigpO1xuICB9IGNhdGNoIChlKSB7XG4gICAgX2Rpc2NvbnRpbnVlZFNrdXMuYWRkKHVwcGVyKTtcbiAgICBhbGVydCgnRXJyb3IgZ3VhcmRhbmRvOiAnICsgKGUubWVzc2FnZSB8fCBlKSk7XG4gIH1cbn07XG5cbndpbmRvdy5vcGVuRGlzY29udGludWVkTW9kYWwgPSBmdW5jdGlvbiAoKSB7XG4gIGNvbnN0IGV4aXN0aW5nID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2Rpc2NvbnRpbnVlZC1za3VzLW1vZGFsJyk7XG4gIGlmIChleGlzdGluZykgZXhpc3RpbmcucmVtb3ZlKCk7XG4gIGNvbnN0IGVsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2Jyk7XG4gIGVsLmlkID0gJ2Rpc2NvbnRpbnVlZC1za3VzLW1vZGFsJztcbiAgZWwuc3R5bGUuY3NzVGV4dCA9XG4gICAgJ3Bvc2l0aW9uOmZpeGVkO2luc2V0OjA7YmFja2dyb3VuZDpyZ2JhKDE1LDIzLDQyLC42NSk7ei1pbmRleDoyMTAwO2Rpc3BsYXk6ZmxleDthbGlnbi1pdGVtczpjZW50ZXI7anVzdGlmeS1jb250ZW50OmNlbnRlcjtwYWRkaW5nOjN2aCc7XG4gIGVsLm9uY2xpY2sgPSAoZXYpID0+IHtcbiAgICBpZiAoZXYudGFyZ2V0ID09PSBlbCkgZWwucmVtb3ZlKCk7XG4gIH07XG4gIGVsLmlubmVySFRNTCA9XG4gICAgJzxkaXYgaWQ9XCJkaXNjb250aW51ZWQtbW9kYWwtY29udGVudFwiIHN0eWxlPVwiYmFja2dyb3VuZDp2YXIoLS1iZy1lbGV2YXRlZCk7Ym9yZGVyLXJhZGl1czoxMnB4O3BhZGRpbmc6MjRweDttYXgtd2lkdGg6NjQwcHg7d2lkdGg6MTAwJTttYXgtaGVpZ2h0Ojkwdmg7b3ZlcmZsb3c6YXV0bztib3gtc2hhZG93OjAgMjBweCA2MHB4IHJnYmEoMCwwLDAsLjQpXCI+PC9kaXY+JztcbiAgZG9jdW1lbnQuYm9keS5hcHBlbmRDaGlsZChlbCk7XG4gIF9yZW5kZXJEaXNjb250aW51ZWRNb2RhbCgpO1xufTtcblxuLy8gdjEzNTU6IHZlciBibG9xdWUgXCJQcm94aW1hcyBkZXNjb250aW51YWNpb25lc1wiIGFsIGZpbmFsIGRlbCBhcmNoaXZvLlxuXG5mdW5jdGlvbiBfcmVuZGVyRGlzY29udGludWVkTW9kYWwoKSB7XG4gIGNvbnN0IGNvbnQgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZGlzY29udGludWVkLW1vZGFsLWNvbnRlbnQnKTtcbiAgaWYgKCFjb250KSByZXR1cm47XG4gIGNvbnN0IGxpc3QgPSBfZGlzY29udGludWVkU2t1cyA/IEFycmF5LmZyb20oX2Rpc2NvbnRpbnVlZFNrdXMpLnNvcnQoKSA6IFtdO1xuICAvLyBCdXNjYXIgZGVzY3JpcGNpXHUwMEYzbiBlbiBsb3Mgc2FsZXMgcGxhbnMgY2FjaGVzIHBvciBzaSBlc3RhIGNhcmdhZG9cbiAgY29uc3Qgc2t1VG9EZXNjID0ge307XG4gIGZvciAoY29uc3QgZmFtIG9mIFsncm9kcycsICdyZWVscyddKSB7XG4gICAgY29uc3QgY2FjaGUgPSBfc2FsZXNQbGFuQ2FjaGVzW2ZhbV07XG4gICAgaWYgKGNhY2hlICYmIGNhY2hlLnJvd3MpIHtcbiAgICAgIGZvciAoY29uc3QgciBvZiBjYWNoZS5yb3dzKSB7XG4gICAgICAgIHNrdVRvRGVzY1tTdHJpbmcoci5za3UpLnRyaW0oKS50b1VwcGVyQ2FzZSgpXSA9IHIuZGVzY3JpcHRpb24gfHwgJyc7XG4gICAgICB9XG4gICAgfVxuICB9XG4gIGNvbnN0IGhlYWQgPVxuICAgICc8ZGl2IHN0eWxlPVwiZGlzcGxheTpmbGV4O2p1c3RpZnktY29udGVudDpzcGFjZS1iZXR3ZWVuO2FsaWduLWl0ZW1zOmNlbnRlcjttYXJnaW4tYm90dG9tOjE0cHhcIj4nICtcbiAgICAnPGRpdj48ZGl2IHN0eWxlPVwiZm9udC1zaXplOjE4cHg7Zm9udC13ZWlnaHQ6ODAwO2NvbG9yOnZhcigtLXRleHQtcHJpbWFyeSlcIj5TS1VzIGRlc2NvbnRpbnVhZG9zPC9kaXY+JyArXG4gICAgJzxkaXYgc3R5bGU9XCJmb250LXNpemU6MTFweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTttYXJnaW4tdG9wOjJweFwiPicgK1xuICAgIGxpc3QubGVuZ3RoICtcbiAgICAnIFNLVXMgZXhjbHVpZG9zIGRlbCBjXHUwMEUxbGN1bG8gZGUgUmVjb21lbmRhY2lcdTAwRjNuIGRlIENvbXByYScgK1xuICAgICc8L2Rpdj48L2Rpdj4nICtcbiAgICAnPGJ1dHRvbiBvbmNsaWNrPVwiZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoXFwnZGlzY29udGludWVkLXNrdXMtbW9kYWxcXCcpLnJlbW92ZSgpXCIgc3R5bGU9XCJiYWNrZ3JvdW5kOnRyYW5zcGFyZW50O2JvcmRlcjoxcHggc29saWQgdmFyKC0tYm9yZGVyLXN1YnRsZSk7Ym9yZGVyLXJhZGl1czo2cHg7cGFkZGluZzo2cHggMTJweDtjdXJzb3I6cG9pbnRlcjtmb250LXdlaWdodDo3MDBcIj5DZXJyYXI8L2J1dHRvbj4nICtcbiAgICAnPC9kaXY+JztcbiAgY29uc3QgYm9keSA9XG4gICAgbGlzdC5sZW5ndGggPT09IDBcbiAgICAgID8gJzxkaXYgc3R5bGU9XCJwYWRkaW5nOjQwcHg7dGV4dC1hbGlnbjpjZW50ZXI7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZClcIj5ObyBoYXkgU0tVcyBkZXNjb250aW51YWRvcy48YnI+PGJyPlBvZFx1MDBFOXMgZGVzY29udGludWFyIFNLVXMgZGVzZGUgZWwgYm90XHUwMEYzbiBcdUQ4M0RcdURERDEgZW4gY2FkYSBmaWxhIGRlIGxhIHRhYmxhIFJlY29tZW5kYWNpXHUwMEYzbiBkZSBDb21wcmEuPC9kaXY+J1xuICAgICAgOiAnPGRpdiBzdHlsZT1cImRpc3BsYXk6ZmxleDtmbGV4LWRpcmVjdGlvbjpjb2x1bW47Z2FwOjZweFwiPicgK1xuICAgICAgICBsaXN0XG4gICAgICAgICAgLm1hcCgoc2t1KSA9PiB7XG4gICAgICAgICAgICBjb25zdCBkZXNjID0gc2t1VG9EZXNjW3NrdV0gfHwgJyc7XG4gICAgICAgICAgICByZXR1cm4gKFxuICAgICAgICAgICAgICAnPGRpdiBzdHlsZT1cImRpc3BsYXk6ZmxleDthbGlnbi1pdGVtczpjZW50ZXI7Z2FwOjEwcHg7cGFkZGluZzoxMHB4IDEycHg7YmFja2dyb3VuZDp2YXIoLS1iZy1zZWNvbmRhcnkpO2JvcmRlci1yYWRpdXM6NnB4XCI+JyArXG4gICAgICAgICAgICAgICc8ZGl2IHN0eWxlPVwiZmxleDoxXCI+PGRpdiBzdHlsZT1cImZvbnQtZmFtaWx5Om1vbm9zcGFjZTtmb250LXdlaWdodDo3MDA7Y29sb3I6dmFyKC0tdGV4dC1wcmltYXJ5KVwiPicgK1xuICAgICAgICAgICAgICBlc2NhcGVIdG1sU2FmZShza3UpICtcbiAgICAgICAgICAgICAgJzwvZGl2PicgK1xuICAgICAgICAgICAgICAoZGVzY1xuICAgICAgICAgICAgICAgID8gJzxkaXYgc3R5bGU9XCJmb250LXNpemU6MTFweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTttYXJnaW4tdG9wOjJweFwiPicgK1xuICAgICAgICAgICAgICAgICAgZXNjYXBlSHRtbFNhZmUoZGVzYykgK1xuICAgICAgICAgICAgICAgICAgJzwvZGl2PidcbiAgICAgICAgICAgICAgICA6ICcnKSArXG4gICAgICAgICAgICAgICc8L2Rpdj4nICtcbiAgICAgICAgICAgICAgJzxidXR0b24gb25jbGljaz1cInJlYWN0aXZhdGVTa3UoXFwnJyArXG4gICAgICAgICAgICAgIGVzY2FwZUh0bWxTYWZlKHNrdSkgK1xuICAgICAgICAgICAgICAnXFwnKVwiIHN0eWxlPVwicGFkZGluZzo2cHggMTJweDtiYWNrZ3JvdW5kOiMxNmEzNGE7Y29sb3I6I2ZmZjtib3JkZXI6bm9uZTtib3JkZXItcmFkaXVzOjRweDtmb250LXNpemU6MTFweDtmb250LXdlaWdodDo3MDA7Y3Vyc29yOnBvaW50ZXJcIj5cdTIxQkIgUmVhY3RpdmFyPC9idXR0b24+JyArXG4gICAgICAgICAgICAgICc8L2Rpdj4nXG4gICAgICAgICAgICApO1xuICAgICAgICAgIH0pXG4gICAgICAgICAgLmpvaW4oJycpICtcbiAgICAgICAgJzwvZGl2Pic7XG4gIGNvbnQuaW5uZXJIVE1MID0gaGVhZCArIGJvZHk7XG59XG5cbi8vIHYxMzU1ICgyMDI2LTEwLTE5KTogbW9kYWwgYnVsay1tYXJraW5nIFwiUHJveGltYXMgZGVzY29udGludWFjaW9uZXNcIi5cbi8vIE1hcmlhbm8gcGlkaW8gcG9kZXIgbWFyY2FyIHZhcmlvcyBTS1VzIGEgbGEgdmV6ICh2cyBmaWxhLXBvci1maWxhIGNvbiBcdUQ4M0RcdURERDEpLlxuLy8gTGlzdGEgY29tcGxldGEgZGUgU0tVcyBkZWwgc2FsZXMgcGxhbiBhY3R1YWwgKHJvZHMgKyByZWVscywgZGVkdXBlKSBjb25cbi8vIGNoZWNrYm94IHByZS10aWxkYWRvIHNpIHlhIGVzdGFuIGVuIF9kaXNjb250aW51ZWRTa3VzLiBBbCBndWFyZGFyIHNpbmNyb25pemFcbi8vIGVsIFNldCBjb24gbG8gdGlsZGFkbyAoYWdyZWdhIGxvcyBudWV2b3MsIHNhY2EgbG9zIGRlc3RpbGRhZG9zIGRlIGxvcyBxdWVcbi8vIHZlbW9zIGVuIGVsIERPTSkuXG4vLyBOT1RBIFhTUzogdXNhbW9zIGNyZWF0ZUVsZW1lbnQgKyB0ZXh0Q29udGVudCBwYXJhIHRvZG8gY29udGVuaWRvIHZhcmlhYmxlXG4vLyAoU0tVLCBkZXNjcmlwY2lvbiwgdGV4dG8gZGUgYnVzcXVlZGEpLiBJbm5lcmh0bWwgc29sbyBjb24gc3RyaW5ncyBsaXRlcmFsZXNcbi8vIGNvbnRyb2xhZG9zIHBvciBub3NvdHJvcywgbnVuY2EgY29uIGRhdG9zIGRlbCBzYWxlcyBwbGFuLlxubGV0IF91cGNvbWluZ1NlYXJjaFRleHQgPSAnJztcblxuZnVuY3Rpb24gX2NvbGxlY3RBbGxTa3VzRnJvbVNhbGVzUGxhbigpIHtcbiAgY29uc3QgbWFwID0gbmV3IE1hcCgpO1xuICBmb3IgKGNvbnN0IGZhbSBvZiBbJ3JvZHMnLCAncmVlbHMnXSkge1xuICAgIGNvbnN0IGNhY2hlID0gX3NhbGVzUGxhbkNhY2hlc1tmYW1dO1xuICAgIGlmICghY2FjaGUgfHwgIUFycmF5LmlzQXJyYXkoY2FjaGUucm93cykpIGNvbnRpbnVlO1xuICAgIGZvciAoY29uc3QgciBvZiBjYWNoZS5yb3dzKSB7XG4gICAgICBjb25zdCBza3UgPSBTdHJpbmcoci5za3UgfHwgJycpLnRyaW0oKTtcbiAgICAgIGlmICghc2t1KSBjb250aW51ZTtcbiAgICAgIGNvbnN0IHVwcGVyID0gc2t1LnRvVXBwZXJDYXNlKCk7XG4gICAgICBtYXAuc2V0KHVwcGVyLCB7XG4gICAgICAgIHNrdSxcbiAgICAgICAgc2t1VXBwZXI6IHVwcGVyLFxuICAgICAgICBkZXNjcmlwdGlvbjogci5kZXNjcmlwdGlvbiB8fCAnJyxcbiAgICAgICAgZmFtaWxpYTogZmFtLFxuICAgICAgfSk7XG4gICAgfVxuICB9XG4gIHJldHVybiBBcnJheS5mcm9tKG1hcC52YWx1ZXMoKSkuc29ydCgoYSwgYikgPT4gYS5za3VVcHBlci5sb2NhbGVDb21wYXJlKGIuc2t1VXBwZXIpKTtcbn1cblxuZnVuY3Rpb24gX21ha2VFbCh0YWcsIHN0eWxlU3RyLCB0ZXh0Q29udGVudCkge1xuICBjb25zdCBlbCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQodGFnKTtcbiAgaWYgKHN0eWxlU3RyKSBlbC5zdHlsZS5jc3NUZXh0ID0gc3R5bGVTdHI7XG4gIGlmICh0ZXh0Q29udGVudCAhPSBudWxsKSBlbC50ZXh0Q29udGVudCA9IHRleHRDb250ZW50O1xuICByZXR1cm4gZWw7XG59XG5cbmZ1bmN0aW9uIF9idWlsZFVwY29taW5nUm93KHJvdywgaXNEaXNjKSB7XG4gIGNvbnN0IGxhYmVsID0gX21ha2VFbChcbiAgICAnbGFiZWwnLFxuICAgICdkaXNwbGF5OmZsZXg7YWxpZ24taXRlbXM6Y2VudGVyO2dhcDoxMHB4O3BhZGRpbmc6OHB4IDEwcHg7YmFja2dyb3VuZDonICtcbiAgICAgIChpc0Rpc2MgPyAncmdiYSgxNDcsNTEsMjM0LC4wOCknIDogJ3ZhcigtLWJnLXNlY29uZGFyeSknKSArXG4gICAgICAnO2JvcmRlci1yYWRpdXM6NXB4O2N1cnNvcjpwb2ludGVyO3RyYW5zaXRpb246YmFja2dyb3VuZCAuMXMnXG4gICk7XG4gIGNvbnN0IGNiID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnaW5wdXQnKTtcbiAgY2IudHlwZSA9ICdjaGVja2JveCc7XG4gIGNiLnNldEF0dHJpYnV0ZSgnZGF0YS11cGNvbWluZy1za3UnLCByb3cuc2t1VXBwZXIpO1xuICBjYi5jaGVja2VkID0gISFpc0Rpc2M7XG4gIGNiLnN0eWxlLmNzc1RleHQgPSAnbWFyZ2luOjA7ZmxleC1zaHJpbms6MDtjdXJzb3I6cG9pbnRlcjt3aWR0aDoxNnB4O2hlaWdodDoxNnB4JztcbiAgbGFiZWwuYXBwZW5kQ2hpbGQoY2IpO1xuICBjb25zdCBiYWRnZSA9IF9tYWtlRWwoXG4gICAgJ3NwYW4nLFxuICAgICdkaXNwbGF5OmlubGluZS1ibG9jaztwYWRkaW5nOjFweCA2cHg7Ym9yZGVyLXJhZGl1czo4cHg7YmFja2dyb3VuZDonICtcbiAgICAgIChyb3cuZmFtaWxpYSA9PT0gJ3JvZHMnID8gJyMwZWE1ZTknIDogJyM4YjVjZjYnKSArXG4gICAgICAnO2NvbG9yOiNmZmY7Zm9udC1zaXplOjlweDtmb250LXdlaWdodDo3MDA7bWFyZ2luLXJpZ2h0OjZweCcsXG4gICAgcm93LmZhbWlsaWEgPT09ICdyb2RzJyA/ICdST0QnIDogJ1JFRUwnXG4gICk7XG4gIGxhYmVsLmFwcGVuZENoaWxkKGJhZGdlKTtcbiAgY29uc3QgY29udGVudCA9IF9tYWtlRWwoJ2RpdicsICdmbGV4OjE7bWluLXdpZHRoOjAnKTtcbiAgY29udGVudC5hcHBlbmRDaGlsZChcbiAgICBfbWFrZUVsKFxuICAgICAgJ2RpdicsXG4gICAgICAnZm9udC1mYW1pbHk6bW9ub3NwYWNlO2ZvbnQtd2VpZ2h0OjcwMDtjb2xvcjp2YXIoLS10ZXh0LXByaW1hcnkpO2ZvbnQtc2l6ZToxMnB4JyxcbiAgICAgIHJvdy5za3VcbiAgICApXG4gICk7XG4gIGlmIChyb3cuZGVzY3JpcHRpb24pIHtcbiAgICBjb250ZW50LmFwcGVuZENoaWxkKFxuICAgICAgX21ha2VFbChcbiAgICAgICAgJ2RpdicsXG4gICAgICAgICdmb250LXNpemU6MTFweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTttYXJnaW4tdG9wOjFweDtvdmVyZmxvdzpoaWRkZW47dGV4dC1vdmVyZmxvdzplbGxpcHNpczt3aGl0ZS1zcGFjZTpub3dyYXAnLFxuICAgICAgICByb3cuZGVzY3JpcHRpb25cbiAgICAgIClcbiAgICApO1xuICB9XG4gIGxhYmVsLmFwcGVuZENoaWxkKGNvbnRlbnQpO1xuICByZXR1cm4gbGFiZWw7XG59XG5cbmZ1bmN0aW9uIF9yZW5kZXJVcGNvbWluZ0Rpc2NvbnRpbnVlZExpc3RPbmx5KCkge1xuICBjb25zdCBsaXN0RWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgndXBjb21pbmctZGlzYy1saXN0Jyk7XG4gIGlmICghbGlzdEVsKSByZXR1cm47XG4gIGNvbnN0IGFsbCA9IF9jb2xsZWN0QWxsU2t1c0Zyb21TYWxlc1BsYW4oKTtcbiAgY29uc3QgcSA9IF91cGNvbWluZ1NlYXJjaFRleHQudG9Mb3dlckNhc2UoKTtcbiAgY29uc3QgZmlsdGVyZWQgPSBxXG4gICAgPyBhbGwuZmlsdGVyKFxuICAgICAgICAocikgPT5cbiAgICAgICAgICByLnNrdVVwcGVyLnRvTG93ZXJDYXNlKCkuaW5jbHVkZXMocSkgfHwgKHIuZGVzY3JpcHRpb24gfHwgJycpLnRvTG93ZXJDYXNlKCkuaW5jbHVkZXMocSlcbiAgICAgIClcbiAgICA6IGFsbDtcbiAgd2hpbGUgKGxpc3RFbC5maXJzdENoaWxkKSBsaXN0RWwucmVtb3ZlQ2hpbGQobGlzdEVsLmZpcnN0Q2hpbGQpO1xuICBpZiAoZmlsdGVyZWQubGVuZ3RoID09PSAwKSB7XG4gICAgY29uc3QgZW1wdHkgPSBfbWFrZUVsKFxuICAgICAgJ2RpdicsXG4gICAgICAncGFkZGluZzozMHB4O3RleHQtYWxpZ246Y2VudGVyO2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpJyxcbiAgICAgIHFcbiAgICAgICAgPyAnU2luIHJlc3VsdGFkb3MgcGFyYSBcIicgKyBfdXBjb21pbmdTZWFyY2hUZXh0ICsgJ1wiLidcbiAgICAgICAgOiAnTm8gaGF5IFNLVXMgY2FyZ2Fkb3MgZW4gZWwgc2FsZXMgcGxhbi4nXG4gICAgKTtcbiAgICBsaXN0RWwuYXBwZW5kQ2hpbGQoZW1wdHkpO1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCB3cmFwID0gX21ha2VFbCgnZGl2JywgJ2Rpc3BsYXk6ZmxleDtmbGV4LWRpcmVjdGlvbjpjb2x1bW47Z2FwOjNweCcpO1xuICBjb25zdCBjdXJyZW50U2V0ID0gX2Rpc2NvbnRpbnVlZFNrdXMgfHwgbmV3IFNldCgpO1xuICBmb3IgKGNvbnN0IHIgb2YgZmlsdGVyZWQpIHtcbiAgICB3cmFwLmFwcGVuZENoaWxkKF9idWlsZFVwY29taW5nUm93KHIsIGN1cnJlbnRTZXQuaGFzKHIuc2t1VXBwZXIpKSk7XG4gIH1cbiAgbGlzdEVsLmFwcGVuZENoaWxkKHdyYXApO1xufVxuXG53aW5kb3cub25VcGNvbWluZ1NlYXJjaENoYW5nZSA9IGZ1bmN0aW9uIChldikge1xuICBfdXBjb21pbmdTZWFyY2hUZXh0ID0gU3RyaW5nKChldiAmJiBldi50YXJnZXQgJiYgZXYudGFyZ2V0LnZhbHVlKSB8fCAnJykudHJpbSgpO1xuICBfcmVuZGVyVXBjb21pbmdEaXNjb250aW51ZWRMaXN0T25seSgpO1xufTtcblxuZnVuY3Rpb24gX3JlbmRlclVwY29taW5nRGlzY29udGludWVkTW9kYWwoKSB7XG4gIGNvbnN0IGNvbnQgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgndXBjb21pbmctZGlzYy1jb250ZW50Jyk7XG4gIGlmICghY29udCkgcmV0dXJuO1xuICB3aGlsZSAoY29udC5maXJzdENoaWxkKSBjb250LnJlbW92ZUNoaWxkKGNvbnQuZmlyc3RDaGlsZCk7XG4gIGNvbnN0IGFsbCA9IF9jb2xsZWN0QWxsU2t1c0Zyb21TYWxlc1BsYW4oKTtcbiAgY29uc3QgbkRpc2NDdXJyZW50ID0gX2Rpc2NvbnRpbnVlZFNrdXMgPyBfZGlzY29udGludWVkU2t1cy5zaXplIDogMDtcbiAgLy8gSGVhZGVyLlxuICBjb25zdCBoZWFkID0gX21ha2VFbChcbiAgICAnZGl2JyxcbiAgICAnZGlzcGxheTpmbGV4O2p1c3RpZnktY29udGVudDpzcGFjZS1iZXR3ZWVuO2FsaWduLWl0ZW1zOmZsZXgtc3RhcnQ7Z2FwOjEycHg7bWFyZ2luLWJvdHRvbToxNHB4O2ZsZXgtc2hyaW5rOjAnXG4gICk7XG4gIGNvbnN0IGhlYWRMZWZ0ID0gX21ha2VFbCgnZGl2Jyk7XG4gIGhlYWRMZWZ0LmFwcGVuZENoaWxkKFxuICAgIF9tYWtlRWwoXG4gICAgICAnZGl2JyxcbiAgICAgICdmb250LXNpemU6MThweDtmb250LXdlaWdodDo4MDA7Y29sb3I6dmFyKC0tdGV4dC1wcmltYXJ5KScsXG4gICAgICAnUHJcdTAwRjN4aW1hcyBkZXNjb250aW51YWNpb25lcydcbiAgICApXG4gICk7XG4gIGhlYWRMZWZ0LmFwcGVuZENoaWxkKFxuICAgIF9tYWtlRWwoXG4gICAgICAnZGl2JyxcbiAgICAgICdmb250LXNpemU6MTFweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTttYXJnaW4tdG9wOjJweCcsXG4gICAgICBhbGwubGVuZ3RoICtcbiAgICAgICAgJyBTS1VzIGVuIGVsIHNhbGVzIHBsYW4gYWN0dWFsIFx1MDBCNyAnICtcbiAgICAgICAgbkRpc2NDdXJyZW50ICtcbiAgICAgICAgJyB5YSBkZXNjb250aW51YWRvcy4gTWFyY1x1MDBFMSBsb3MgcXVlIHNlIHZheWFuIGEgZGVzY29udGludWFyIGVuIGxvcyBwclx1MDBGM3hpbW9zIG1lc2VzIFx1MjAxNCBlbCBmb3JlY2FzdCBsb3MgdmEgYSBkZXNlc3RpbWFyIGVuIGVsIGNcdTAwRTFsY3VsbyBkZSBSZWNvbWVuZGFjaVx1MDBGM24gZGUgQ29tcHJhLidcbiAgICApXG4gICk7XG4gIGhlYWQuYXBwZW5kQ2hpbGQoaGVhZExlZnQpO1xuICBjb25zdCBjbG9zZUJ0biA9IF9tYWtlRWwoXG4gICAgJ2J1dHRvbicsXG4gICAgJ2JhY2tncm91bmQ6dHJhbnNwYXJlbnQ7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1ib3JkZXItc3VidGxlKTtib3JkZXItcmFkaXVzOjZweDtwYWRkaW5nOjZweCAxMnB4O2N1cnNvcjpwb2ludGVyO2ZvbnQtd2VpZ2h0OjcwMDtmbGV4LXNocmluazowJyxcbiAgICAnXHUyNzE1J1xuICApO1xuICBjbG9zZUJ0bi5vbmNsaWNrID0gKCkgPT4ge1xuICAgIGNvbnN0IG0gPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgndXBjb21pbmctZGlzYy1tb2RhbCcpO1xuICAgIGlmIChtKSBtLnJlbW92ZSgpO1xuICB9O1xuICBoZWFkLmFwcGVuZENoaWxkKGNsb3NlQnRuKTtcbiAgY29udC5hcHBlbmRDaGlsZChoZWFkKTtcbiAgLy8gU2VhcmNoLlxuICBjb25zdCBzZWFyY2hJbnAgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdpbnB1dCcpO1xuICBzZWFyY2hJbnAudHlwZSA9ICd0ZXh0JztcbiAgc2VhcmNoSW5wLnBsYWNlaG9sZGVyID0gJ0J1c2NhciBTS1UgbyBkZXNjcmlwY2lcdTAwRjNuLi4uJztcbiAgc2VhcmNoSW5wLnZhbHVlID0gX3VwY29taW5nU2VhcmNoVGV4dDtcbiAgc2VhcmNoSW5wLm9uaW5wdXQgPSB3aW5kb3cub25VcGNvbWluZ1NlYXJjaENoYW5nZTtcbiAgc2VhcmNoSW5wLnN0eWxlLmNzc1RleHQgPVxuICAgICd3aWR0aDoxMDAlO3BhZGRpbmc6OHB4IDEycHg7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1ib3JkZXItc3VidGxlKTtib3JkZXItcmFkaXVzOjZweDtmb250LXNpemU6MTNweDtiYWNrZ3JvdW5kOnZhcigtLWJnLWVsZXZhdGVkKTtjb2xvcjp2YXIoLS10ZXh0LXByaW1hcnkpO21hcmdpbi1ib3R0b206MTBweDtmbGV4LXNocmluazowO2JveC1zaXppbmc6Ym9yZGVyLWJveCc7XG4gIGNvbnQuYXBwZW5kQ2hpbGQoc2VhcmNoSW5wKTtcbiAgLy8gTGlzdCBjb250YWluZXIgKHBvYmxhZG8gcG9yIF9yZW5kZXJVcGNvbWluZ0Rpc2NvbnRpbnVlZExpc3RPbmx5KS5cbiAgY29uc3QgbGlzdCA9IF9tYWtlRWwoJ2RpdicsICdmbGV4OjEgMSAwO292ZXJmbG93LXk6YXV0bzttaW4taGVpZ2h0OjAnKTtcbiAgbGlzdC5pZCA9ICd1cGNvbWluZy1kaXNjLWxpc3QnO1xuICBjb250LmFwcGVuZENoaWxkKGxpc3QpO1xuICAvLyBGb290ZXIgY29uIGJvdG9uZXMuXG4gIGNvbnN0IGZvb3QgPSBfbWFrZUVsKFxuICAgICdkaXYnLFxuICAgICdkaXNwbGF5OmZsZXg7anVzdGlmeS1jb250ZW50OnNwYWNlLWJldHdlZW47YWxpZ24taXRlbXM6Y2VudGVyO2dhcDoxMHB4O3BhZGRpbmctdG9wOjE0cHg7Ym9yZGVyLXRvcDoxcHggc29saWQgdmFyKC0tYm9yZGVyLXN1YnRsZSk7bWFyZ2luLXRvcDoxMnB4O2ZsZXgtc2hyaW5rOjAnXG4gICk7XG4gIGZvb3QuYXBwZW5kQ2hpbGQoXG4gICAgX21ha2VFbChcbiAgICAgICdkaXYnLFxuICAgICAgJ2ZvbnQtc2l6ZToxMXB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpJyxcbiAgICAgICdTZSBndWFyZGEgZW4gZm9yZWNhc3RfY29uZmlnL2Rpc2NvbnRpbnVlZF9za3VzLiBSZXZlcnNpYmxlIGRlc2RlIGVsIGNoaXAgXHVEODNEXHVERUFCIGRlc2NvbnRpbnVhZG9zLidcbiAgICApXG4gICk7XG4gIGNvbnN0IGJ0bldyYXAgPSBfbWFrZUVsKCdkaXYnLCAnZGlzcGxheTpmbGV4O2dhcDo4cHgnKTtcbiAgY29uc3QgY2FuY2VsQnRuID0gX21ha2VFbChcbiAgICAnYnV0dG9uJyxcbiAgICAncGFkZGluZzo4cHggMTRweDtiYWNrZ3JvdW5kOnRyYW5zcGFyZW50O2JvcmRlcjoxcHggc29saWQgdmFyKC0tYm9yZGVyLXN1YnRsZSk7Ym9yZGVyLXJhZGl1czo2cHg7Y3Vyc29yOnBvaW50ZXI7Zm9udC13ZWlnaHQ6NzAwO2NvbG9yOnZhcigtLXRleHQtcHJpbWFyeSknLFxuICAgICdDYW5jZWxhcidcbiAgKTtcbiAgY2FuY2VsQnRuLm9uY2xpY2sgPSAoKSA9PiB7XG4gICAgY29uc3QgbSA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCd1cGNvbWluZy1kaXNjLW1vZGFsJyk7XG4gICAgaWYgKG0pIG0ucmVtb3ZlKCk7XG4gIH07XG4gIGJ0bldyYXAuYXBwZW5kQ2hpbGQoY2FuY2VsQnRuKTtcbiAgY29uc3Qgc2F2ZUJ0biA9IF9tYWtlRWwoXG4gICAgJ2J1dHRvbicsXG4gICAgJ3BhZGRpbmc6OHB4IDE2cHg7YmFja2dyb3VuZDojMjU2M2ViO2NvbG9yOiNmZmY7Ym9yZGVyOm5vbmU7Ym9yZGVyLXJhZGl1czo2cHg7Y3Vyc29yOnBvaW50ZXI7Zm9udC13ZWlnaHQ6NzAwJyxcbiAgICAnR3VhcmRhciBjYW1iaW9zJ1xuICApO1xuICBzYXZlQnRuLmlkID0gJ3VwY29taW5nLXNhdmUtYnRuJztcbiAgc2F2ZUJ0bi5vbmNsaWNrID0gd2luZG93LnNhdmVVcGNvbWluZ0Rpc2NvbnRpbnVlZENoYW5nZXM7XG4gIGJ0bldyYXAuYXBwZW5kQ2hpbGQoc2F2ZUJ0bik7XG4gIGZvb3QuYXBwZW5kQ2hpbGQoYnRuV3JhcCk7XG4gIGNvbnQuYXBwZW5kQ2hpbGQoZm9vdCk7XG4gIF9yZW5kZXJVcGNvbWluZ0Rpc2NvbnRpbnVlZExpc3RPbmx5KCk7XG59XG5cbndpbmRvdy5vcGVuVXBjb21pbmdEaXNjb250aW51ZWRNb2RhbCA9IGZ1bmN0aW9uICgpIHtcbiAgX3VwY29taW5nU2VhcmNoVGV4dCA9ICcnO1xuICBjb25zdCBleGlzdGluZyA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCd1cGNvbWluZy1kaXNjLW1vZGFsJyk7XG4gIGlmIChleGlzdGluZykgZXhpc3RpbmcucmVtb3ZlKCk7XG4gIGNvbnN0IGVsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2Jyk7XG4gIGVsLmlkID0gJ3VwY29taW5nLWRpc2MtbW9kYWwnO1xuICBlbC5zdHlsZS5jc3NUZXh0ID1cbiAgICAncG9zaXRpb246Zml4ZWQ7aW5zZXQ6MDtiYWNrZ3JvdW5kOnJnYmEoMTUsMjMsNDIsLjY1KTt6LWluZGV4OjIxMDA7ZGlzcGxheTpmbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtqdXN0aWZ5LWNvbnRlbnQ6Y2VudGVyO3BhZGRpbmc6M3ZoJztcbiAgZWwub25jbGljayA9IChldikgPT4ge1xuICAgIGlmIChldi50YXJnZXQgPT09IGVsKSBlbC5yZW1vdmUoKTtcbiAgfTtcbiAgY29uc3QgY29udGVudCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpO1xuICBjb250ZW50LmlkID0gJ3VwY29taW5nLWRpc2MtY29udGVudCc7XG4gIGNvbnRlbnQuc3R5bGUuY3NzVGV4dCA9XG4gICAgJ2JhY2tncm91bmQ6dmFyKC0tYmctZWxldmF0ZWQpO2JvcmRlci1yYWRpdXM6MTJweDtwYWRkaW5nOjI0cHg7bWF4LXdpZHRoOjc2MHB4O3dpZHRoOjEwMCU7bWF4LWhlaWdodDo5MHZoO292ZXJmbG93OmhpZGRlbjtkaXNwbGF5OmZsZXg7ZmxleC1kaXJlY3Rpb246Y29sdW1uO2JveC1zaGFkb3c6MCAyMHB4IDYwcHggcmdiYSgwLDAsMCwuNCknO1xuICBlbC5hcHBlbmRDaGlsZChjb250ZW50KTtcbiAgZG9jdW1lbnQuYm9keS5hcHBlbmRDaGlsZChlbCk7XG4gIF9yZW5kZXJVcGNvbWluZ0Rpc2NvbnRpbnVlZE1vZGFsKCk7XG59O1xuXG53aW5kb3cuc2F2ZVVwY29taW5nRGlzY29udGludWVkQ2hhbmdlcyA9IGFzeW5jIGZ1bmN0aW9uICgpIHtcbiAgY29uc3QgYnRuID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3VwY29taW5nLXNhdmUtYnRuJyk7XG4gIGlmIChidG4pIHtcbiAgICBidG4uZGlzYWJsZWQgPSB0cnVlO1xuICAgIGJ0bi50ZXh0Q29udGVudCA9ICdHdWFyZGFuZG9cdTIwMjYnO1xuICAgIGJ0bi5zdHlsZS5vcGFjaXR5ID0gJy42JztcbiAgfVxuICAvLyBJdGVyYW1vcyBUT0RPUyBsb3MgY2hlY2tib3hlcyBkZWwgRE9NIChubyBzb2xvIGxvcyB2aXNpYmxlcyBjb24gZWwgZmlsdHJvXG4gIC8vIGRlIGJ1c3F1ZWRhKSwgcGFyYSBubyBwZXJkZXIgY2FtYmlvcyBoZWNob3MgYW50ZXMgZGUgZmlsdHJhci5cbiAgLy8gUmVjb25zdHJ1aW1vcyBlbCBTZXQgZGVzZGUgZWwgZXN0YWRvIGFjdHVhbCBkZWwgRE9NOiBsbyBxdWUgZXN0YSB0aWxkYWRvIHF1ZWRhLFxuICAvLyBsbyBkZXN0aWxkYWRvIHNlIHF1aXRhIChwZXJvIHNvbG8gcGFyYSBTS1VzIHF1ZSB2ZW1vcyBlbiBlbCBET00gXHUyMDE0IFNLVXNcbiAgLy8gZGVzY29udGludWFkb3MgcXVlIG5vIGVzdGFuIGVuIGVsIHNhbGVzIHBsYW4gYWN0dWFsIHNlIHByZXNlcnZhbiBjb21vIGVzdGFiYW4pLlxuICBjb25zdCBhbGxJbkRvbSA9IGRvY3VtZW50LnF1ZXJ5U2VsZWN0b3JBbGwoJ1tkYXRhLXVwY29taW5nLXNrdV0nKTtcbiAgY29uc3Qgc2VlbkluRG9tID0gbmV3IFNldCgpO1xuICBjb25zdCBjaGVja2VkSW5Eb20gPSBuZXcgU2V0KCk7XG4gIGFsbEluRG9tLmZvckVhY2goKGNiKSA9PiB7XG4gICAgY29uc3Qgc2t1ID0gU3RyaW5nKGNiLmdldEF0dHJpYnV0ZSgnZGF0YS11cGNvbWluZy1za3UnKSB8fCAnJylcbiAgICAgIC50cmltKClcbiAgICAgIC50b1VwcGVyQ2FzZSgpO1xuICAgIGlmICghc2t1KSByZXR1cm47XG4gICAgc2VlbkluRG9tLmFkZChza3UpO1xuICAgIGlmIChjYi5jaGVja2VkKSBjaGVja2VkSW5Eb20uYWRkKHNrdSk7XG4gIH0pO1xuICBpZiAoIV9kaXNjb250aW51ZWRTa3VzKSBfZGlzY29udGludWVkU2t1cyA9IG5ldyBTZXQoKTtcbiAgY29uc3QgcHJldiA9IG5ldyBTZXQoX2Rpc2NvbnRpbnVlZFNrdXMpO1xuICBjaGVja2VkSW5Eb20uZm9yRWFjaCgoc2t1KSA9PiBfZGlzY29udGludWVkU2t1cy5hZGQoc2t1KSk7XG4gIHNlZW5JbkRvbS5mb3JFYWNoKChza3UpID0+IHtcbiAgICBpZiAoIWNoZWNrZWRJbkRvbS5oYXMoc2t1KSkgX2Rpc2NvbnRpbnVlZFNrdXMuZGVsZXRlKHNrdSk7XG4gIH0pO1xuICB0cnkge1xuICAgIGF3YWl0IF9zYXZlRGlzY29udGludWVkU2t1cygpO1xuICAgIGNvbnN0IG1vZGFsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3VwY29taW5nLWRpc2MtbW9kYWwnKTtcbiAgICBpZiAobW9kYWwpIG1vZGFsLnJlbW92ZSgpO1xuICAgIF9yZW5kZXJSZWNvU2VjdGlvbigpO1xuICB9IGNhdGNoIChlKSB7XG4gICAgX2Rpc2NvbnRpbnVlZFNrdXMgPSBwcmV2O1xuICAgIGlmIChidG4pIHtcbiAgICAgIGJ0bi5kaXNhYmxlZCA9IGZhbHNlO1xuICAgICAgYnRuLnRleHRDb250ZW50ID0gJ0d1YXJkYXIgY2FtYmlvcyc7XG4gICAgICBidG4uc3R5bGUub3BhY2l0eSA9ICcxJztcbiAgICB9XG4gICAgYWxlcnQoJ0Vycm9yIGd1YXJkYW5kbzogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xuICB9XG59O1xuIl0sCiAgIm1hcHBpbmdzIjogIjs7O0FBWUEsTUFBTSxnQkFBZ0I7QUFBQSxJQUNwQixLQUFLO0FBQUEsSUFDTCxTQUFTO0FBQUEsSUFDVCxLQUFLO0FBQUEsSUFDTCxPQUFPO0FBQUEsSUFDUCxLQUFLO0FBQUEsSUFDTCxVQUFVO0FBQUEsSUFDVixTQUFTO0FBQUEsSUFDVCxLQUFLO0FBQUEsSUFDTCxPQUFPO0FBQUEsSUFDUCxPQUFPO0FBQUEsSUFDUCxLQUFLO0FBQUEsSUFDTCxPQUFPO0FBQUEsSUFDUCxLQUFLO0FBQUEsSUFDTCxPQUFPO0FBQUEsSUFDUCxLQUFLO0FBQUEsSUFDTCxNQUFNO0FBQUEsSUFDTixLQUFLO0FBQUEsSUFDTCxNQUFNO0FBQUEsSUFDTixPQUFPO0FBQUEsSUFDUCxLQUFLO0FBQUEsSUFDTCxN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
