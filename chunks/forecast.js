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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL3B1cmUvc2FsZXMtcGxhbi1wYXJzZXIuanMiLCAiLi4vc3JjL2RvbWFpbnMvZm9yZWNhc3QuanMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbIi8vIEB0cy1ub2NoZWNrXHJcbi8vIFB1cmU6IHBhcnNlYSB1biBzaGVldCBTYWxlcyBQbGFuIChmb3JtYXRvIFNVUi9TQVIgZGUgU2hpbWFubykgYSBlc3RydWN0dXJhXHJcbi8vIG5vcm1hbGl6YWRhIHsgc2t1LCBkZXNjcmlwdGlvbiwgbW9xLCBtb250aHM6IHsnWVlZWS1NTSc6IE59IH0uXHJcbi8vIFNpbiBkZXBlbmRlbmNpYXMgXHUyMDE0IHJlY2liZSBlbCBzaGVldCB5YSBkZXNlcmlhbGl6YWRvIHBvciBTaGVldEpTXHJcbi8vIChYTFNYLnV0aWxzLnNoZWV0X3RvX2pzb24oc2hlZXQsIHtoZWFkZXI6MSwgZGVmdmFsOicnfSkpLlxyXG4vLyBUZXN0ZWFibGUgZW4gdml0ZXN0IHNpbiBjYXJnYXIgWExTWC5cclxuLy9cclxuLy8gQ29udGV4dG86IGxvcyBTYWxlcyBQbGFucyBkZSBTaGltYW5vIHZpZW5lbiBjb24gaGVhZGVycyBjb21vXHJcbi8vIFwiU0tVIENvZGUvUGFydCBOb1wiLCBcIkRlc2NyaXB0aW9uXCIsIFwiTU9RIDEyIG1vbnRoc1wiIHkgY29sdW1uYXMgZGUgbWVzZXNcclxuLy8gdGlwbyBcIkphbiAyMDI3XCIsIFwiTWF5IDIwMjdcIiAoYSB2ZWNlcyBjb24gYVx1MDBGMW8gZW4gdW5hIGZpbGEgYXJyaWJhIHkgZWwgbWVzXHJcbi8vIGVuIGxhIGZpbGEgaGVhZGVyKS4gRXN0YSBmbiB0b2xlcmEgYW1ib3MgbGF5b3V0cy5cclxuXHJcbmNvbnN0IE1PTlRIX0FMSUFTRVMgPSB7XHJcbiAgamFuOiAxLFxyXG4gIGphbnVhcnk6IDEsXHJcbiAgZW5lOiAxLFxyXG4gIGVuZXJvOiAxLFxyXG4gIGZlYjogMixcclxuICBmZWJydWFyeTogMixcclxuICBmZWJyZXJvOiAyLFxyXG4gIG1hcjogMyxcclxuICBtYXJjaDogMyxcclxuICBtYXJ6bzogMyxcclxuICBhcHI6IDQsXHJcbiAgYXByaWw6IDQsXHJcbiAgYWJyOiA0LFxyXG4gIGFicmlsOiA0LFxyXG4gIG1heTogNSxcclxuICBtYXlvOiA1LFxyXG4gIGp1bjogNixcclxuICBqdW5lOiA2LFxyXG4gIGp1bmlvOiA2LFxyXG4gIGp1bDogNyxcclxuICBqdWx5OiA3LFxyXG4gIGp1bGlvOiA3LFxyXG4gIGF1ZzogOCxcclxuICBhdWd1c3Q6IDgsXHJcbiAgYWdvOiA4LFxyXG4gIGFnb3N0bzogOCxcclxuICBzZXA6IDksXHJcbiAgc2VwdDogOSxcclxuICBzZXB0ZW1iZXI6IDksXHJcbiAgc2VwdGllbWJyZTogOSxcclxuICBvY3Q6IDEwLFxyXG4gIG9jdG9iZXI6IDEwLFxyXG4gIG9jdHVicmU6IDEwLFxyXG4gIG5vdjogMTEsXHJcbiAgbm92ZW1iZXI6IDExLFxyXG4gIG5vdmllbWJyZTogMTEsXHJcbiAgZGVjOiAxMixcclxuICBkZWNlbWJlcjogMTIsXHJcbiAgZGljOiAxMixcclxuICBkaWNpZW1icmU6IDEyLFxyXG59O1xyXG5cclxuLy8gTm9ybWFsaXphIGxhYmVscyBkZSBtZXNlcyBhICdZWVlZLU1NJy4gUmV0b3JuYSBudWxsIHNpIG5vIG1hdGNoZWEuXHJcbi8vIEZvcm1hdG9zIHNvcG9ydGFkb3M6IFwiSmFuIDIwMjdcIiwgXCJFbmUtMjdcIiwgXCJKYW4vMjAyN1wiLCBcIk1heTI3XCIsXHJcbi8vIFwiMjAyNy0wMVwiLCBcIjAxLzIwMjdcIiwgXCJKYW4uMjAyN1wiLCBcIjIwMjFcXG5KYW5cIiAobXVsdGktbGluZSBFeGNlbCkuXHJcbmZ1bmN0aW9uIG5vcm1hbGl6ZU1vbnRoTGFiZWwobGFiZWwpIHtcclxuICBpZiAobGFiZWwgPT0gbnVsbCkgcmV0dXJuIG51bGw7XHJcbiAgLy8gdjExMDQ6IGNvbGFwc2FyIG5ld2xpbmVzL3RhYnMgYSBlc3BhY2lvIGFudGVzIGRlbCB0cmltLlxyXG4gIC8vIEVsIGZvcm1hdG8gRXhjZWwgXCIyMDIxXFxuSmFuXCIgKGFcdTAwRjFvIGVuIEwxLCBtZXMgZW4gTDIgZGVudHJvIGRlIHVuYSBjZWxkYVxyXG4gIC8vIG11bHRpLXJvdykgZXMgY29tXHUwMEZBbiBlbiBTYWxlcyBQbGFucyBTVVIuIGBcXHMrYCBtYXRjaGVhIHdoaXRlc3BhY2UgaW5jbHV5ZW5kb1xyXG4gIC8vIFxcbiB5IFxcclxcbi5cclxuICBjb25zdCBzID0gU3RyaW5nKGxhYmVsKS5yZXBsYWNlKC9cXHMrL2csICcgJykudHJpbSgpLnRvTG93ZXJDYXNlKCk7XHJcbiAgaWYgKCFzKSByZXR1cm4gbnVsbDtcclxuICBsZXQgbTtcclxuICAvLyBcImphbiAyMDI3XCIgfCBcImphbi0yN1wiIHwgXCJlbmUvMjAyN1wiIHwgXCJtYXkyN1wiIHwgXCJtYXkuMjAyN1wiXHJcbiAgbSA9IHMubWF0Y2goL14oW2Etelx1MDBFMVx1MDBFOVx1MDBFRFx1MDBGM1x1MDBGQV17MywxMH0pW1xcc1xcLS8uX10qKFxcZHsyLDR9KSQvKTtcclxuICBpZiAobSkge1xyXG4gICAgY29uc3QgbW9uID0gTU9OVEhfQUxJQVNFU1ttWzFdXSB8fCBNT05USF9BTElBU0VTW21bMV0uc2xpY2UoMCwgMyldO1xyXG4gICAgaWYgKG1vbikge1xyXG4gICAgICBsZXQgeSA9IHBhcnNlSW50KG1bMl0sIDEwKTtcclxuICAgICAgaWYgKHkgPCAxMDApIHkgPSAyMDAwICsgeTtcclxuICAgICAgcmV0dXJuIFN0cmluZyh5KS5wYWRTdGFydCg0LCAnMCcpICsgJy0nICsgU3RyaW5nKG1vbikucGFkU3RhcnQoMiwgJzAnKTtcclxuICAgIH1cclxuICB9XHJcbiAgLy8gXCIyMDIxIGphblwiIHwgXCIyMDI3IGRpY1wiIChhXHUwMEYxbyBwcmltZXJvICsgbWVzLCBmb3JtYXRvIEV4Y2VsIG11bHRpLWxpbmVcclxuICAvLyBjb2xhcHNhZG8gdHJhcyByZXBsYWNlIFxccyspLlxyXG4gIG0gPSBzLm1hdGNoKC9eKFxcZHs0fSlbXFxzXFwtLy5fXSsoW2Etelx1MDBFMVx1MDBFOVx1MDBFRFx1MDBGM1x1MDBGQV17MywxMH0pJC8pO1xyXG4gIGlmIChtKSB7XHJcbiAgICBjb25zdCB5ID0gcGFyc2VJbnQobVsxXSwgMTApO1xyXG4gICAgY29uc3QgbW9uID0gTU9OVEhfQUxJQVNFU1ttWzJdXSB8fCBNT05USF9BTElBU0VTW21bMl0uc2xpY2UoMCwgMyldO1xyXG4gICAgaWYgKG1vbikgcmV0dXJuIFN0cmluZyh5KS5wYWRTdGFydCg0LCAnMCcpICsgJy0nICsgU3RyaW5nKG1vbikucGFkU3RhcnQoMiwgJzAnKTtcclxuICB9XHJcbiAgLy8gXCIyMDI3LTAxXCIgfCBcIjIwMjcvMDFcIlxyXG4gIG0gPSBzLm1hdGNoKC9eKFxcZHs0fSlbLS9dKFxcZHsxLDJ9KSQvKTtcclxuICBpZiAobSkge1xyXG4gICAgY29uc3QgeSA9IHBhcnNlSW50KG1bMV0sIDEwKTtcclxuICAgIGNvbnN0IG1vbiA9IHBhcnNlSW50KG1bMl0sIDEwKTtcclxuICAgIGlmIChtb24gPj0gMSAmJiBtb24gPD0gMTIpXHJcbiAgICAgIHJldHVybiBTdHJpbmcoeSkucGFkU3RhcnQoNCwgJzAnKSArICctJyArIFN0cmluZyhtb24pLnBhZFN0YXJ0KDIsICcwJyk7XHJcbiAgfVxyXG4gIC8vIFwiMDEvMjAyN1wiIHwgXCIwMS0yMDI3XCJcclxuICBtID0gcy5tYXRjaCgvXihcXGR7MSwyfSlbLS9dKFxcZHs0fSkkLyk7XHJcbiAgaWYgKG0pIHtcclxuICAgIGNvbnN0IG1vbiA9IHBhcnNlSW50KG1bMV0sIDEwKTtcclxuICAgIGNvbnN0IHkgPSBwYXJzZUludChtWzJdLCAxMCk7XHJcbiAgICBpZiAobW9uID49IDEgJiYgbW9uIDw9IDEyKVxyXG4gICAgICByZXR1cm4gU3RyaW5nKHkpLnBhZFN0YXJ0KDQsICcwJykgKyAnLScgKyBTdHJpbmcobW9uKS5wYWRTdGFydCgyLCAnMCcpO1xyXG4gIH1cclxuICByZXR1cm4gbnVsbDtcclxufVxyXG5cclxuLy8gQnVzY2EgbGEgZmlsYSBoZWFkZXIgKDAtYmFzZWQpLiBFc2NhbmVhIGxhcyBwcmltZXJhcyAzMCBmaWxhcy5cclxuZnVuY3Rpb24gZmluZEhlYWRlclJvdyhyb3dzKSB7XHJcbiAgY29uc3QgSEVBREVSX01BUktFUlMgPSBbXHJcbiAgICAnc2t1IGNvZGUvcGFydCBubycsXHJcbiAgICAnc2t1IGNvZGUnLFxyXG4gICAgJ3NrdScsXHJcbiAgICAncGFydCBubycsXHJcbiAgICAncGFydCBudW1iZXInLFxyXG4gICAgJ2l0ZW1jb2RlJyxcclxuICAgICdpdGVtIGNvZGUnLFxyXG4gICAgJ2NvZGlnbycsXHJcbiAgICAnY1x1MDBGM2RpZ28nLFxyXG4gIF07XHJcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBNYXRoLm1pbihyb3dzLmxlbmd0aCwgMzApOyBpKyspIHtcclxuICAgIGNvbnN0IHJvdyA9IHJvd3NbaV0gfHwgW107XHJcbiAgICBmb3IgKGNvbnN0IGNlbGwgb2Ygcm93KSB7XHJcbiAgICAgIC8vIHYxMTA0OiBjb2xhcHNhciBuZXdsaW5lcyBhIGVzcGFjaW8gcGFyYSBtYXRjaGVhciBoZWFkZXJzIGNvbW9cclxuICAgICAgLy8gXCJTS1UgQ29kZS9QYXJ0IE5vXCIgKG9rKSBvIFwiU0tVXFxuQ29kZVwiIChuZWNlc2l0YSBjb2xhcHNhcikuXHJcbiAgICAgIGNvbnN0IHMgPSBTdHJpbmcoY2VsbCA9PSBudWxsID8gJycgOiBjZWxsKVxyXG4gICAgICAgIC5yZXBsYWNlKC9cXHMrL2csICcgJylcclxuICAgICAgICAudHJpbSgpXHJcbiAgICAgICAgLnRvTG93ZXJDYXNlKCk7XHJcbiAgICAgIGlmIChIRUFERVJfTUFSS0VSUy5pbmRleE9mKHMpID49IDApIHJldHVybiBpO1xyXG4gICAgfVxyXG4gIH1cclxuICByZXR1cm4gLTE7XHJcbn1cclxuXHJcbi8vIERldGVjdGEgXHUwMEVEbmRpY2VzIGRlIGNvbHVtbmFzIHkgbWVzZXMuIGBoaW50Um93QWJvdmVgIHBlcm1pdGUgY29tYmluYXIgYVx1MDBGMW8vbWVzXHJcbi8vIGN1YW5kbyBlbCBoZWFkZXIgZXMgbXVsdGktcm93IChhXHUwMEYxbyBhcnJpYmEsIG1lcyBhYmFqbyBvIHZpY2V2ZXJzYSkuXHJcbmZ1bmN0aW9uIGRldGVjdENvbHVtbnMoaGVhZGVyUm93LCBoaW50Um93QWJvdmUpIHtcclxuICBsZXQgc2t1SWR4ID0gLTE7XHJcbiAgbGV0IGRlc2NJZHggPSAtMTtcclxuICBsZXQgbW9xSWR4ID0gLTE7XHJcbiAgY29uc3QgbW9udGhDb2x1bW5zID0gW107XHJcbiAgY29uc3QgZGV0ZWN0ZWRNb250aHNTZXQgPSBuZXcgU2V0KCk7XHJcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBoZWFkZXJSb3cubGVuZ3RoOyBpKyspIHtcclxuICAgIC8vIHYxMTA0OiBjb2xhcHNhciBuZXdsaW5lcyBhIGVzcGFjaW8gYW50ZXMgZGUgY29tcGFyYXIuIExvcyBTYWxlcyBQbGFuXHJcbiAgICAvLyBTVVIgdGllbmVuIGhlYWRlcnMgbXVsdGktbGluZSBjb21vIFwiTU9RXFxuMTIgbW9udGhzXCIgbyBcIkJhc2VcXG5GT0IoVVNEKVwiLlxyXG4gICAgY29uc3QgcmF3ID0gU3RyaW5nKGhlYWRlclJvd1tpXSA9PSBudWxsID8gJycgOiBoZWFkZXJSb3dbaV0pXHJcbiAgICAgIC5yZXBsYWNlKC9cXHMrL2csICcgJylcclxuICAgICAgLnRyaW0oKTtcclxuICAgIGNvbnN0IHMgPSByYXcudG9Mb3dlckNhc2UoKTtcclxuICAgIGlmIChcclxuICAgICAgc2t1SWR4IDwgMCAmJlxyXG4gICAgICAocyA9PT0gJ3NrdSBjb2RlL3BhcnQgbm8nIHx8XHJcbiAgICAgICAgcyA9PT0gJ3NrdSBjb2RlJyB8fFxyXG4gICAgICAgIHMgPT09ICdza3UnIHx8XHJcbiAgICAgICAgcyA9PT0gJ3BhcnQgbm8nIHx8XHJcbiAgICAgICAgcyA9PT0gJ3BhcnQgbnVtYmVyJyB8fFxyXG4gICAgICAgIHMgPT09ICdpdGVtY29kZScgfHxcclxuICAgICAgICBzID09PSAnaXRlbSBjb2RlJyB8fFxyXG4gICAgICAgIHMgPT09ICdjb2RpZ28nIHx8XHJcbiAgICAgICAgcyA9PT0gJ2NcdTAwRjNkaWdvJylcclxuICAgICkge1xyXG4gICAgICBza3VJZHggPSBpO1xyXG4gICAgICBjb250aW51ZTtcclxuICAgIH1cclxuICAgIGlmIChcclxuICAgICAgZGVzY0lkeCA8IDAgJiZcclxuICAgICAgKHMgPT09ICdkZXNjcmlwdGlvbicgfHxcclxuICAgICAgICBzID09PSAnZGVzY3JpcGNpb24nIHx8XHJcbiAgICAgICAgcyA9PT0gJ2Rlc2NyaXBjaVx1MDBGM24nIHx8XHJcbiAgICAgICAgcyA9PT0gJ2l0ZW0gbmFtZScgfHxcclxuICAgICAgICBzID09PSAnaXRlbW5hbWUnKVxyXG4gICAgKSB7XHJcbiAgICAgIGRlc2NJZHggPSBpO1xyXG4gICAgICBjb250aW51ZTtcclxuICAgIH1cclxuICAgIGlmIChtb3FJZHggPCAwICYmIChzID09PSAnbW9xIDEyIG1vbnRocycgfHwgcyA9PT0gJ21vcScgfHwgcy5pbmRleE9mKCdtb3EnKSA9PT0gMCkpIHtcclxuICAgICAgbW9xSWR4ID0gaTtcclxuICAgICAgY29udGludWU7XHJcbiAgICB9XHJcbiAgICAvLyBUcnkgZGlyZWN0IG1vbnRoIHBhcnNlXHJcbiAgICBsZXQgbW9udGhLZXkgPSBub3JtYWxpemVNb250aExhYmVsKHJhdyk7XHJcbiAgICBpZiAoIW1vbnRoS2V5ICYmIGhpbnRSb3dBYm92ZSAmJiBoaW50Um93QWJvdmVbaV0gIT0gbnVsbCkge1xyXG4gICAgICBjb25zdCBoaW50ID0gU3RyaW5nKGhpbnRSb3dBYm92ZVtpXSkudHJpbSgpO1xyXG4gICAgICBpZiAoaGludCkge1xyXG4gICAgICAgIG1vbnRoS2V5ID0gbm9ybWFsaXplTW9udGhMYWJlbChyYXcgKyAnICcgKyBoaW50KSB8fCBub3JtYWxpemVNb250aExhYmVsKGhpbnQgKyAnICcgKyByYXcpO1xyXG4gICAgICB9XHJcbiAgICB9XHJcbiAgICBpZiAobW9udGhLZXkpIHtcclxuICAgICAgbW9udGhDb2x1bW5zLnB1c2goeyBjb2xJZHg6IGksIG1vbnRoS2V5IH0pO1xyXG4gICAgICBkZXRlY3RlZE1vbnRoc1NldC5hZGQobW9udGhLZXkpO1xyXG4gICAgfVxyXG4gIH1cclxuICByZXR1cm4ge1xyXG4gICAgc2t1SWR4LFxyXG4gICAgZGVzY0lkeCxcclxuICAgIG1vcUlkeCxcclxuICAgIG1vbnRoQ29sdW1ucyxcclxuICAgIGRldGVjdGVkTW9udGhzOiBBcnJheS5mcm9tKGRldGVjdGVkTW9udGhzU2V0KS5zb3J0KCksXHJcbiAgfTtcclxufVxyXG5cclxuLy8gUHVibGljOiBwYXJzZSBmdWxsIHNoZWV0LiBUaHJvd3Mgb24gbWlzc2luZyBTS1UgY29sdW1uIC8gbW9udGhzLlxyXG5mdW5jdGlvbiBwYXJzZVNhbGVzUGxhblNoZWV0KHJvd3MpIHtcclxuICBpZiAoIXJvd3MgfHwgIXJvd3MubGVuZ3RoKSB7XHJcbiAgICBjb25zdCBlcnIgPSBuZXcgRXJyb3IoJ0V4Y2VsIHZhY2lvJyk7XHJcbiAgICBlcnIuY29kZSA9ICdFTVBUWV9TSEVFVCc7XHJcbiAgICB0aHJvdyBlcnI7XHJcbiAgfVxyXG4gIGNvbnN0IGhlYWRlcklkeCA9IGZpbmRIZWFkZXJSb3cocm93cyk7XHJcbiAgaWYgKGhlYWRlcklkeCA8IDApIHtcclxuICAgIGNvbnN0IGVyciA9IG5ldyBFcnJvcignTm8gc2UgZW5jb250cm8gZmlsYSBkZSBoZWFkZXJzIChidXNjYWJhIFwiU0tVIENvZGUvUGFydCBOb1wiIG8gXCJTS1VcIiknKTtcclxuICAgIGVyci5jb2RlID0gJ0hFQURFUl9OT1RfRk9VTkQnO1xyXG4gICAgdGhyb3cgZXJyO1xyXG4gIH1cclxuICBjb25zdCBoZWFkZXJSb3cgPSByb3dzW2hlYWRlcklkeF0gfHwgW107XHJcbiAgY29uc3Qgcm93QWJvdmUgPSBoZWFkZXJJZHggPiAwID8gcm93c1toZWFkZXJJZHggLSAxXSB8fCBbXSA6IG51bGw7XHJcbiAgY29uc3QgY29scyA9IGRldGVjdENvbHVtbnMoaGVhZGVyUm93LCByb3dBYm92ZSk7XHJcbiAgaWYgKGNvbHMuc2t1SWR4IDwgMCkge1xyXG4gICAgY29uc3QgZXJyID0gbmV3IEVycm9yKCdObyBzZSBlbmNvbnRybyBjb2x1bW5hIFNLVSBlbiBsYSBmaWxhIGhlYWRlcicpO1xyXG4gICAgZXJyLmNvZGUgPSAnU0tVX0NPTF9NSVNTSU5HJztcclxuICAgIHRocm93IGVycjtcclxuICB9XHJcbiAgaWYgKCFjb2xzLm1vbnRoQ29sdW1ucy5sZW5ndGgpIHtcclxuICAgIGNvbnN0IGVyciA9IG5ldyBFcnJvcihcclxuICAgICAgJ05vIHNlIGRldGVjdGFyb24gY29sdW1uYXMgZGUgbWVzZXMgZW4gZWwgaGVhZGVyIChlajogXCJKYW4gMjAyN1wiLCBcIk1heSAyMDI3XCIpJ1xyXG4gICAgKTtcclxuICAgIGVyci5jb2RlID0gJ01PTlRIU19OT1RfRk9VTkQnO1xyXG4gICAgdGhyb3cgZXJyO1xyXG4gIH1cclxuICBjb25zdCBwYXJzZWRSb3dzID0gW107XHJcbiAgY29uc3Qgc2VlblNrdSA9IG5ldyBTZXQoKTtcclxuICBmb3IgKGxldCByID0gaGVhZGVySWR4ICsgMTsgciA8IHJvd3MubGVuZ3RoOyByKyspIHtcclxuICAgIGNvbnN0IHJvdyA9IHJvd3Nbcl0gfHwgW107XHJcbiAgICBjb25zdCBza3VSYXcgPSByb3dbY29scy5za3VJZHhdO1xyXG4gICAgaWYgKHNrdVJhdyA9PSBudWxsIHx8IFN0cmluZyhza3VSYXcpLnRyaW0oKSA9PT0gJycpIGNvbnRpbnVlO1xyXG4gICAgY29uc3Qgc2t1ID0gU3RyaW5nKHNrdVJhdykudHJpbSgpO1xyXG4gICAgY29uc3QgdXBwZXIgPSBza3UudG9VcHBlckNhc2UoKTtcclxuICAgIC8vIFNraXAgZmlsYXMgVE9UQUwgLyBTVU0gLyBTVUJUT1RBTFxyXG4gICAgaWYgKHVwcGVyID09PSAnVE9UQUwnIHx8IHVwcGVyID09PSAnU1VNJyB8fCB1cHBlciA9PT0gJ1NVQlRPVEFMJyB8fCB1cHBlciA9PT0gJ1RPVEFMRVMnKVxyXG4gICAgICBjb250aW51ZTtcclxuICAgIGlmIChzZWVuU2t1Lmhhcyh1cHBlcikpIGNvbnRpbnVlOyAvLyBkZWR1cGVcclxuICAgIHNlZW5Ta3UuYWRkKHVwcGVyKTtcclxuICAgIGNvbnN0IGRlc2NyaXB0aW9uID1cclxuICAgICAgY29scy5kZXNjSWR4ID49IDAgPyBTdHJpbmcocm93W2NvbHMuZGVzY0lkeF0gPT0gbnVsbCA/ICcnIDogcm93W2NvbHMuZGVzY0lkeF0pLnRyaW0oKSA6ICcnO1xyXG4gICAgY29uc3QgbW9xUmF3ID0gY29scy5tb3FJZHggPj0gMCA/IHJvd1tjb2xzLm1vcUlkeF0gOiBudWxsO1xyXG4gICAgY29uc3QgbW9xTnVtID0gTnVtYmVyKG1vcVJhdyk7XHJcbiAgICBjb25zdCBtb3EgPSBOdW1iZXIuaXNGaW5pdGUobW9xTnVtKSAmJiBtb3FOdW0gPiAwID8gTWF0aC5yb3VuZChtb3FOdW0pIDogMDtcclxuICAgIGNvbnN0IG1vbnRocyA9IHt9O1xyXG4gICAgZm9yIChjb25zdCBtYyBvZiBjb2xzLm1vbnRoQ29sdW1ucykge1xyXG4gICAgICBjb25zdCB2ID0gcm93W21jLmNvbElkeF07XHJcbiAgICAgIGNvbnN0IG4gPSBOdW1iZXIodik7XHJcbiAgICAgIGlmIChOdW1iZXIuaXNGaW5pdGUobikgJiYgbiA+IDApIHtcclxuICAgICAgICBtb250aHNbbWMubW9udGhLZXldID0gTWF0aC5yb3VuZChuKTtcclxuICAgICAgfVxyXG4gICAgfVxyXG4gICAgcGFyc2VkUm93cy5wdXNoKHsgc2t1LCBkZXNjcmlwdGlvbiwgbW9xLCBtb250aHMgfSk7XHJcbiAgfVxyXG4gIHJldHVybiB7XHJcbiAgICBoZWFkZXJSb3dJbmRleDogaGVhZGVySWR4LFxyXG4gICAgZGV0ZWN0ZWRNb250aHM6IGNvbHMuZGV0ZWN0ZWRNb250aHMsXHJcbiAgICByb3dzQ291bnQ6IHBhcnNlZFJvd3MubGVuZ3RoLFxyXG4gICAgcm93czogcGFyc2VkUm93cyxcclxuICB9O1xyXG59XHJcblxyXG4vLyBVTUQtaXNoIGV4cG9ydDogcGFyYSB2aXRlc3QgKG1vZHVsZS5leHBvcnRzKSB5IHBhcmEgYnVuZGxlIGJyb3dzZXIgKHdpbmRvdyBnbG9iYWwpLlxyXG5pZiAodHlwZW9mIG1vZHVsZSAhPT0gJ3VuZGVmaW5lZCcgJiYgbW9kdWxlLmV4cG9ydHMpIHtcclxuICBtb2R1bGUuZXhwb3J0cyA9IHsgcGFyc2VTYWxlc1BsYW5TaGVldCwgbm9ybWFsaXplTW9udGhMYWJlbCwgZmluZEhlYWRlclJvdywgZGV0ZWN0Q29sdW1ucyB9O1xyXG59XHJcbmlmICh0eXBlb2Ygd2luZG93ICE9PSAndW5kZWZpbmVkJykge1xyXG4gIHdpbmRvdy5TYWxlc1BsYW5QYXJzZXIgPSB7XHJcbiAgICBwYXJzZVNhbGVzUGxhblNoZWV0LFxyXG4gICAgbm9ybWFsaXplTW9udGhMYWJlbCxcclxuICAgIGZpbmRIZWFkZXJSb3csXHJcbiAgICBkZXRlY3RDb2x1bW5zLFxyXG4gIH07XHJcbn1cclxuXHJcbmV4cG9ydCB7IGRldGVjdENvbHVtbnMsIGZpbmRIZWFkZXJSb3csIG5vcm1hbGl6ZU1vbnRoTGFiZWwsIHBhcnNlU2FsZXNQbGFuU2hlZXQgfTtcclxuIiwgIi8vIEB0cy1ub2NoZWNrXHJcbi8vIHYxMDk4KyBGYXNlIDE6IGltcG9ydCBkZWwgcGFyc2VyIHB1cm8uIEVsIG1cdTAwRjNkdWxvIGhhY2UgYHdpbmRvdy5TYWxlc1BsYW5QYXJzZXJgXHJcbi8vIGNvbW8gc2lkZS1lZmZlY3QgeSB0YW1iaVx1MDBFOW4gZXhwb3J0YSBsYXMgZm5zIG5vbWJyYWRhczsgdXNhbW9zIHNpZGUtZWZmZWN0XHJcbi8vIHBvcnF1ZSBmb3JlY2FzdC5qcyBjb3JyZSBlbiBlbCBjaHVuayBsYXp5IHkgd2luZG93IHlhIGVzdFx1MDBFMSBkaXNwb25pYmxlLlxyXG5pbXBvcnQgJy4uL3B1cmUvc2FsZXMtcGxhbi1wYXJzZXIuanMnO1xyXG5cclxuLy8gR2xvYmFscyBsZWlkb3MgZGVsIGVudG9ybm8gKGRlY2xhcmFkb3MgZW4gaW5kZXguaHRtbCBpbmxpbmUgbyBidW5kbGUgcHJldmlvKTpcclxuLy8gZmJEYiwgY3VycmVudFVzZXIsIFhMU1ggKGNkbiksIGVzY2FwZUh0bWwuIE1pc21vIHBhdHJvbiBxdWUgb3Ryb3MgZG9taW5pb3MuXHJcbi8vXHJcbi8vIEZPUkVDQVNUIC0gbW9kYWwgYWRtaW4tb25seSAoTWFyaWFubykuIENodW5rIGxhenk6IHNlIGNhcmdhIHNvbG8gYWwgcHJpbWVyXHJcbi8vIGNsaWNrIGRlbCBib3RvbiBGT1JFQ0FTVCBkZWwgaGVhZGVyLiBSZWdpc3RyYWRvIGVuIGJ1aWxkLmpzIExBWllfQ0hVTktTICtcclxuLy8gc3JjL21haW4uanMgaW5zdGFsbENodW5rU3R1YnMgKyBzdy5qcyBTVEFUSUNfQVNTRVRTLiBWZXIgQ0xBVURFLm1kICMxOC5cclxuLy9cclxuLy8gdjExMTEgY2xlYW46IHBpcGVsaW5lIGxlZ2FjeSAoU0tVICsgNiBjb2x1bW5hcyArIHBvbGl0aWNhIDNtKSByZW1vdmlkby5cclxuLy8gUmVlbXBsYXphZG8gcG9yOlxyXG4vLyAgIC0gRmFzZSAxICh2MTA5OCk6IFNhbGVzIFBsYW5zIG1lbnN1YWxlcyBSb2RzL1JlZWxzIGNvbiBmb3JtYXRvIFNVUi5cclxuLy8gICAtIEZhc2UgMkIgKHYxMTAzKTogRm9yZWNhc3QgRXN0YWRpc3RpY28gKHN0YXRzZm9yZWNhc3QgcGlwZWxpbmUgb2ZmbGluZSkuXHJcbi8vICAgLSBGYXNlIDNBICh2MTEwOSk6IFRhYmxhIFJlY29tZW5kYWNpb24gZGUgQ29tcHJhLlxyXG5cclxuLy8gdjEwOTgrIChGYXNlIDEgRm9yZWNhc3QgdjIpOiBTYWxlcyBQbGFucyBtZW5zdWFsZXMgcG9yIGZhbWlsaWEgKFJvZHMvUmVlbHMvRkcpLlxyXG4vLyBTZSBndWFyZGFuIGVuIEZpcmVzdG9yZSBgc2FsZXNfcGxhbl9jYWNoZS97ZmFtaWxpYX1gICsgc25hcHNob3QgRXhjZWwgb3JpZ2luYWxcclxuLy8gZW4gU3RvcmFnZSBgZm9yZWNhc3RzX3NuYXBzaG90cy97WVlZWS1NTX0ve2ZhbWlsaWF9Lnhsc3hgLlxyXG4vLyBFbCBwYXJzZXIgcHVybyB2aXZlIGVuIHNyYy9wdXJlL3NhbGVzLXBsYW4tcGFyc2VyLmpzIChhdHRhY2ggYSB3aW5kb3cuU2FsZXNQbGFuUGFyc2VyKS5cclxuLy8gdjExMDg6IEZHIHJlbW92aWRvIGRlbCBVSSAoTWFyaWFubyBwaWRpXHUwMEYzKS4gU29sbyBSb2RzICsgUmVlbHMgcG9yIGFob3JhLlxyXG4vLyBMYSBydWxlIEZpcmVzdG9yZSBzaWd1ZSBhY2VwdGFuZG8gJ2ZnJyBwb3Igc2kgZW4gZWwgZnV0dXJvIHNlIHZ1ZWx2ZSBhXHJcbi8vIGFjdGl2YXIgXHUyMDE0IG5vIGJvcnJhcmxhIGVuIHN0b3JhZ2UvZmlyZXN0b3JlLnJ1bGVzIGhhc3RhIGNvbmZpcm1hciBkZXByZWNhdGUuXHJcbmNvbnN0IFNBTEVTX1BMQU5fRkFNSUxJQVMgPSBbXHJcbiAgeyBrZXk6ICdyb2RzJywgbGFiZWw6ICdSb2RzIChDYVx1MDBGMWFzKScsIGNvbG9yOiAnIzBlYTVlOScgfSxcclxuICB7IGtleTogJ3JlZWxzJywgbGFiZWw6ICdSZWVscycsIGNvbG9yOiAnIzhiNWNmNicgfSxcclxuXTtcclxuY29uc3QgX3NhbGVzUGxhbkNhY2hlcyA9IHsgcm9kczogbnVsbCwgcmVlbHM6IG51bGwgfTsgLy8gbGFzdCBsb2FkZWQgZG9jXHJcbmxldCBfZm9yZWNhc3RBY3RpdmVUYWIgPSAnc2FsZXMtcGxhbnMnOyAvLyAnc2FsZXMtcGxhbnMnIHwgJ3N0YXQnIHwgJ2xlZ2FjeSdcclxuXHJcbi8vIHYxMTAzKyAoRmFzZSAyQik6IEZvcmVjYXN0IEVzdGFkXHUwMEVEc3RpY28gXHUyMDE0IG91dHB1dCBwdWJsaWNhZG8gcG9yXHJcbi8vIHNjcmlwdHMvZm9yZWNhc3QvcHVibGlzaF90b19maXJlc3RvcmUucHkgYSBmb3JlY2FzdF9vdXRwdXQve3N1Yl9zbHVnfVxyXG4vLyArIGZvcmVjYXN0X291dHB1dF9tZXRhL2N1cnJlbnQuIDI0IHN1YnMgKyAxIG1ldGEgZG9jLlxyXG5sZXQgX2ZvcmVjYXN0U3RhdERvY3MgPSBudWxsOyAvLyBbe2lkLCBzdWJmYW1pbGlhLCBmb3JlY2FzdFs3XSwgbWV0cmljcywgYmVzdE1vZGVsLCB2ZXJzaW9uSWR9XVxyXG5sZXQgX2ZvcmVjYXN0U3RhdE1ldGEgPSBudWxsOyAvLyB7Z2VuZXJhdGVkQXQsIHZlcnNpb25JZCwgcmVzdW1lbjogey4uLn19XHJcbmxldCBfZm9yZWNhc3RTdGF0SGlzdG9yeUNhY2hlID0gbnVsbDsgLy8geyBbc3ViXTogW3tkcywgeX1dIH0gY2FjaGUgbGF6eSBvbi1kZW1hbmRcclxuXHJcbi8vIHYxMTA5KyAoRmFzZSAzQSk6IFRhYmxhIFJlY29tZW5kYWNpXHUwMEYzbiBkZSBDb21wcmEgXHUyMDE0IGNvbWJpbmEgc2FsZXMgcGxhbnMgK1xyXG4vLyBzdG9ja19zbmFwc2hvdCArIHNrdV92ZW50YXNfc25hcHNob3QgcGFyYSBjb21wdXRhciByZWNvbWVuZGFkbyBwb3IgU0tVLlxyXG5sZXQgX3JlY29TdG9ja1NuYXBzaG90ID0gbnVsbDsgLy8ge3dhcmVob3VzZUJyZWFrZG93bjoge3NrdTp7JzExJzpuLCcxMic6biwuLi59fSwgYmFja29yZGVyQnlTa3U6IHtza3U6bn19XHJcbmxldCBfcmVjb1ZlbnRhc1NuYXBzaG90ID0gbnVsbDsgLy8geyBbU0tVIHVwcGVyXToge21lc2VzOiB7J1lZWVktTU0nOiB7cXR5LGFyc319fSB9XHJcbmxldCBfcmVjb0ZpbHRlck1pblJlYyA9IHRydWU7IC8vIFwic29sbyBtb3N0cmFyIFNLVXMgY29uIHJlY29tZW5kYWRvID4gMFwiXHJcbmxldCBfcmVjb0ZpbHRlckZhbWlsaWEgPSAnYWxsJzsgLy8gJ2FsbCcgfCAncm9kcycgfCAncmVlbHMnXHJcbmxldCBfcmVjb1NlYXJjaFRleHQgPSAnJztcclxuXHJcbi8vIHYxMTEyKyAoRjNCKTogU0tVcyBkZXNjb250aW51YWRvcyBxdWUgTWFyaWFubyBtYXJjYSBwYXJhIGV4Y2x1aXIgZGVsIGZvcmVjYXN0LlxyXG4vLyBQZXJzaXN0ZW4gZW4gRmlyZXN0b3JlIGBmb3JlY2FzdF9jb25maWcvZGlzY29udGludWVkX3NrdXNgIGNvbW8geyBza3VzOiBbU0tVIHVwcGVyXSwgdXBkYXRlZEF0LCB1cGRhdGVkQnkgfS5cclxubGV0IF9kaXNjb250aW51ZWRTa3VzID0gbnVsbDsgLy8gU2V0PHN0cmluZyB1cHBlcj4gbyBudWxsIHNpIG5vIGNhcmdhZG9cclxubGV0IF9kaXNjb250aW51ZWRNZXRhID0gbnVsbDsgLy8ge3VwZGF0ZWRBdCwgdXBkYXRlZEJ5fVxyXG5cclxuLy8gdjExMTQrIChGM0IgbXVsdGlwbGljYWRvciBkaW5cdTAwRTFtaWNvKTogbXVsdGlwbGljYWRvciBhdXRvIHBvciBTS1UgPSB2ZW50YV8ybVxyXG4vLyBkaXZpZGlkbyBwb3IgdmVudGFfNm0sIGNvbiBjYXAuIE92ZXJyaWRlIG1hbnVhbCBwZXJzaXN0aWRvIGVuIEZpcmVzdG9yZVxyXG4vLyBgZm9yZWNhc3RfY29uZmlnL211bHRpcGxpZXJzYCBjb24ge3NrdU92ZXJyaWRlczoge1NLVToge3ZhbHVlLCB1cGRhdGVkQnksIHVwZGF0ZWRBdH19fS5cclxubGV0IF9tdWx0aXBsaWVyT3ZlcnJpZGVzID0gbnVsbDsgLy8geyBbU0tVIHVwcGVyXToge3ZhbHVlLCB1cGRhdGVkQnksIHVwZGF0ZWRBdH0gfVxyXG5jb25zdCBSRUNPX01VTFRfUkVDRU5UX01PTlRIUyA9IDI7XHJcbmNvbnN0IFJFQ09fTVVMVF9CQVNFTElORV9NT05USFMgPSA2O1xyXG5jb25zdCBSRUNPX01VTFRfTUlOID0gMC41O1xyXG5jb25zdCBSRUNPX01VTFRfTUFYID0gMi41O1xyXG5jb25zdCBSRUNPX01VTFRfTUlOX0JBU0VMSU5FID0gMC4xOyAvLyBldml0YSBkaXZpc2lcdTAwRjNuIHBvciBjZXJvXHJcblxyXG5jb25zdCBSRUNPX0hPUklaT05fTU9OVEhTID0gNztcclxuY29uc3QgUkVDT19WRU5UQV9QUk9NRURJT19XSU5ET1cgPSAzOyAvLyBtZXNlcyBoYWNpYSBhdHJcdTAwRTFzIHBhcmEgcHJvbWVkaW8gdmVudGFcclxuLy8gUkVDT19ERUZBVUxUX01VTFRJUExJRVIgcmVtb3ZlZCAyMDI2LTEwLTA2ICh1bnVzZWQsIGZsYWdnZWQgYnkgYmlvbWUpLlxyXG5cclxuLy8gV2hpdGVsaXN0IGRlIGVtYWlscyBjb24gYWNjZXNvIGFsIG1vZGFsIEZPUkVDQVNULiBSZXBsaWNhIGVsIHBhdHJvbiBkZVxyXG4vLyBcIkFuYWxpc2lzXCIgKGluZGV4Lmh0bWw6MTI2MjUpLiBTb2xvIE1hcmlhbm87IHNpIG90cm8gYWRtaW4gbG8gbmVjZXNpdGFcclxuLy8gc2UgYWdyZWdhIGFjYSBleHBsaWNpdG8uXHJcbmNvbnN0IEZPUkVDQVNUX0FMTE9XRURfRU1BSUxTID0gWydtYXJpYW5vLmVyYmlub0BzaGltYW5vLmNvbS5hcicsICdlcmJpbm9tYXJpYW5vQGdtYWlsLmNvbSddO1xyXG5cclxuZnVuY3Rpb24gX2NhbkZvcmVjYXN0KCkge1xyXG4gIHRyeSB7XHJcbiAgICBjb25zdCBlbWFpbCA9ICgod2luZG93LmN1cnJlbnRVc2VyICYmIHdpbmRvdy5jdXJyZW50VXNlci5lbWFpbCkgfHwgJycpLnRvTG93ZXJDYXNlKCk7XHJcbiAgICBpZiAoIWVtYWlsKSByZXR1cm4gZmFsc2U7XHJcbiAgICByZXR1cm4gRk9SRUNBU1RfQUxMT1dFRF9FTUFJTFMuaW5kZXhPZihlbWFpbCkgPj0gMDtcclxuICB9IGNhdGNoIHtcclxuICAgIHJldHVybiBmYWxzZTtcclxuICB9XHJcbn1cclxuXHJcbmZ1bmN0aW9uIF9yZW5kZXJNb2RhbFNoZWxsKCkge1xyXG4gIGNvbnN0IGV4aXN0aW5nID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2ZvcmVjYXN0LW1vZGFsJyk7XHJcbiAgaWYgKGV4aXN0aW5nKSByZXR1cm4gZXhpc3Rpbmc7XHJcbiAgY29uc3QgZWwgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKTtcclxuICBlbC5pZCA9ICdmb3JlY2FzdC1tb2RhbCc7XHJcbiAgZWwuY2xhc3NOYW1lID0gJ21vZGFsLW92ZXJsYXknO1xyXG4gIC8vIHYxMzA2ICgyMDI2LTEwLTE1KTogQXBwbGUtc3R5bGUgbW9kYWwgb3ZlcmxheSBjb24gYmFja2Ryb3AgYmx1ci5cclxuICBlbC5zdHlsZS5jc3NUZXh0ID1cclxuICAgICdkaXNwbGF5Om5vbmU7cG9zaXRpb246Zml4ZWQ7aW5zZXQ6MDtiYWNrZ3JvdW5kOnJnYmEoMCwwLDAsLjMpOy13ZWJraXQtYmFja2Ryb3AtZmlsdGVyOnNhdHVyYXRlKDE0MCUpIGJsdXIoOHB4KTtiYWNrZHJvcC1maWx0ZXI6c2F0dXJhdGUoMTQwJSkgYmx1cig4cHgpO3otaW5kZXg6MjA1MDsnO1xyXG4gIGVsLm9uY2xpY2sgPSBmdW5jdGlvbiAoZXYpIHtcclxuICAgIGlmIChldi50YXJnZXQgPT09IGVsKSB3aW5kb3cuY2xvc2VGb3JlY2FzdE1vZGFsKCk7XHJcbiAgfTtcclxuICBjb25zdCBzaGVsbEh0bWwgPSBfYnVpbGRTaGVsbEh0bWwoKTtcclxuICBlbC5pbm5lckhUTUwgPSBzaGVsbEh0bWw7XHJcbiAgZG9jdW1lbnQuYm9keS5hcHBlbmRDaGlsZChlbCk7XHJcbiAgX2Vuc3VyZUZvcmVjYXN0QXBwbGVDc3MoKTtcclxuICByZXR1cm4gZWw7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIF9lbnN1cmVGb3JlY2FzdEFwcGxlQ3NzKCkge1xyXG4gIC8vIHYxMzA2OiBDU1MgQXBwbGUtc3R5bGUgaW55ZWN0YWRvIHVuYSBzb2xhIHZleiBhbCBhYnJpciBlbCBtb2RhbC5cclxuICAvLyBTa2lsbCBhcHBsZS1kZXNpZ246IGZlZWRiYWNrIHBvaW50ZXJkb3duLCBiYWNrZHJvcCBibHVyLCByZWR1Y2VkLW1vdGlvbixcclxuICAvLyB0eXBvZ3JhcGh5IHRyYWNraW5nIHNpemUtc3BlY2lmaWMuXHJcbiAgaWYgKGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdmb3JlY2FzdC1hcHBsZS1jc3MnKSkgcmV0dXJuO1xyXG4gIGNvbnN0IHN0eWxlID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnc3R5bGUnKTtcclxuICBzdHlsZS5pZCA9ICdmb3JlY2FzdC1hcHBsZS1jc3MnO1xyXG4gIGNvbnN0IGNzcyA9XHJcbiAgICAnI2ZvcmVjYXN0LW1vZGFsIC5mYy1hcHBsZSAqe2ZvbnQtZmFtaWx5Oi1hcHBsZS1zeXN0ZW0sQmxpbmtNYWNTeXN0ZW1Gb250LFwiU0YgUHJvIERpc3BsYXlcIixcIlNGIFBybyBUZXh0XCIsXCJIZWx2ZXRpY2EgTmV1ZVwiLHNhbnMtc2VyaWZ9JyArXHJcbiAgICAnI2ZvcmVjYXN0LW1vZGFsIC5mYy1hcHBsZS1jbG9zZXtib3JkZXI6bm9uZTtiYWNrZ3JvdW5kOnJnYmEoMTIwLDEyMCwxMjgsLjE0KTt3aWR0aDozMHB4O2hlaWdodDozMHB4O2JvcmRlci1yYWRpdXM6NTAlO2N1cnNvcjpwb2ludGVyO2NvbG9yOiM4Njg2OGI7Zm9udC1zaXplOjE2cHg7ZGlzcGxheTpmbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtqdXN0aWZ5LWNvbnRlbnQ6Y2VudGVyO3RyYW5zaXRpb246dHJhbnNmb3JtIC4xMnMgZWFzZS1vdXQsYmFja2dyb3VuZCAuMTVzIGVhc2UsY29sb3IgLjE1cyBlYXNlfScgK1xyXG4gICAgJyNmb3JlY2FzdC1tb2RhbCAuZmMtYXBwbGUtY2xvc2U6aG92ZXJ7YmFja2dyb3VuZDpyZ2JhKDEyMCwxMjAsMTI4LC4yMik7Y29sb3I6IzFkMWQxZn0nICtcclxuICAgICcjZm9yZWNhc3QtbW9kYWwgLmZjLWFwcGxlLWNsb3NlOmFjdGl2ZXt0cmFuc2Zvcm06c2NhbGUoLjkpO2JhY2tncm91bmQ6cmdiYSgxMjAsMTIwLDEyOCwuMyl9JyArXHJcbiAgICAnI2ZvcmVjYXN0LW1vZGFsIC5mYy1hcHBsZS10YWJ7cGFkZGluZzo3cHggMTZweDtib3JkZXItcmFkaXVzOjk4MHB4O2JvcmRlcjpub25lO2JhY2tncm91bmQ6dHJhbnNwYXJlbnQ7Y29sb3I6Izg2ODY4Yjtmb250LXNpemU6MTIuNXB4O2ZvbnQtd2VpZ2h0OjYwMDtsZXR0ZXItc3BhY2luZzotMC4xcHg7Y3Vyc29yOnBvaW50ZXI7dHJhbnNpdGlvbjpiYWNrZ3JvdW5kIC4xNXMgZWFzZSxjb2xvciAuMTVzIGVhc2UsdHJhbnNmb3JtIC4xcyBlYXNlLW91dH0nICtcclxuICAgICcjZm9yZWNhc3QtbW9kYWwgLmZjLWFwcGxlLXRhYjpob3ZlcntiYWNrZ3JvdW5kOnJnYmEoMTIwLDEyMCwxMjgsLjEpO2NvbG9yOiMxZDFkMWZ9JyArXHJcbiAgICAnI2ZvcmVjYXN0LW1vZGFsIC5mYy1hcHBsZS10YWI6YWN0aXZle3RyYW5zZm9ybTpzY2FsZSguOTcpfScgK1xyXG4gICAgJyNmb3JlY2FzdC1tb2RhbCAuZmMtYXBwbGUtdGFiLmFjdGl2ZXtiYWNrZ3JvdW5kOiMxZDFkMWY7Y29sb3I6I2ZmZn0nICtcclxuICAgICcjZm9yZWNhc3QtbW9kYWwgLmZjLWFwcGxlLXRhYi5hY3RpdmU6aG92ZXJ7YmFja2dyb3VuZDojMDAwfScgK1xyXG4gICAgJ0BtZWRpYSAocHJlZmVycy1yZWR1Y2VkLW1vdGlvbjpyZWR1Y2UpeycgK1xyXG4gICAgJyAgI2ZvcmVjYXN0LW1vZGFsIC5mYy1hcHBsZS1jbG9zZSwjZm9yZWNhc3QtbW9kYWwgLmZjLWFwcGxlLXRhYnt0cmFuc2l0aW9uOm5vbmUgIWltcG9ydGFudH0nICtcclxuICAgICcgICNmb3JlY2FzdC1tb2RhbCAuZmMtYXBwbGUtY2xvc2U6YWN0aXZlLCNmb3JlY2FzdC1tb2RhbCAuZmMtYXBwbGUtdGFiOmFjdGl2ZXt0cmFuc2Zvcm06bm9uZSAhaW1wb3J0YW50fScgK1xyXG4gICAgJ30nO1xyXG4gIHN0eWxlLnRleHRDb250ZW50ID0gY3NzO1xyXG4gIGRvY3VtZW50LmhlYWQuYXBwZW5kQ2hpbGQoc3R5bGUpO1xyXG59XHJcblxyXG5mdW5jdGlvbiBfYnVpbGRTaGVsbEh0bWwoKSB7XHJcbiAgLy8gdjEzMDY6IHJlZGlzZVx1MDBGMW8gQXBwbGUtc3R5bGUuXHJcbiAgLy8gdjEzMDcgKDIwMjYtMTAtMTUpOiB0YWIgXCJGb3JlY2FzdCBlc3RhZFx1MDBFRHN0aWNvXCIgcmVtb3ZpZGEgKGRlY2lzaVx1MDBGM24gTWFyaWFubykuXHJcbiAgLy8gRWwgZm9yZWNhc3QgcG9yIHN1YmZhbWlsaWEgKGZvcmVjYXN0X291dHB1dC8pIG5vIGFncmVnYSB2YWxvciBzb2JyZVxyXG4gIC8vIFwiU2FsZXMgUGxhbnNcIiBxdWUgeWEgaGFjZSByZWNvbWVuZGFjaVx1MDBGM24gbml2ZWwgU0tVIGNvbiBCTyArIHN0b2NrICsgcGxhbi5cclxuICAvLyBTaGVsbCBxdWVkYSBzaW4gdGFicyBiYXIgXHUyMDE0IHVuYSBzb2xhIHZpc3RhLlxyXG4gIGNvbnN0IG1vZGFsT3V0ZXIgPVxyXG4gICAgJzxkaXYgY2xhc3M9XCJmYy1hcHBsZVwiIHN0eWxlPVwicG9zaXRpb246YWJzb2x1dGU7aW5zZXQ6MXZoIDF2dztiYWNrZ3JvdW5kOiNmYmZiZmQ7Ym9yZGVyLXJhZGl1czoxOHB4O2Rpc3BsYXk6ZmxleDtmbGV4LWRpcmVjdGlvbjpjb2x1bW47b3ZlcmZsb3c6aGlkZGVuO2JveC1zaGFkb3c6MCAyNHB4IDcwcHggcmdiYSgwLDAsMCwuMjIpXCI+JztcclxuICBjb25zdCBoZWFkZXIgPVxyXG4gICAgJzxkaXYgc3R5bGU9XCJwYWRkaW5nOjIycHggMjZweCAxOHB4O2JhY2tncm91bmQ6cmdiYSgyNTEsMjUxLDI1MywuOTIpOy13ZWJraXQtYmFja2Ryb3AtZmlsdGVyOnNhdHVyYXRlKDE4MCUpIGJsdXIoMjBweCk7YmFja2Ryb3AtZmlsdGVyOnNhdHVyYXRlKDE4MCUpIGJsdXIoMjBweCk7Ym9yZGVyLWJvdHRvbTowLjVweCBzb2xpZCByZ2JhKDAsMCwwLC4wOCk7ZGlzcGxheTpmbGV4O2FsaWduLWl0ZW1zOmZsZXgtc3RhcnQ7Z2FwOjE0cHhcIj4nICtcclxuICAgICc8ZGl2IHN0eWxlPVwiZmxleDoxO21pbi13aWR0aDowXCI+JyArXHJcbiAgICAnPGgyIHN0eWxlPVwibWFyZ2luOjAgMCA0cHg7Zm9udC1zaXplOjIycHg7Zm9udC13ZWlnaHQ6NzAwO2xldHRlci1zcGFjaW5nOi0wLjVweDtjb2xvcjojMWQxZDFmXCI+Rm9yZWNhc3Q8L2gyPicgK1xyXG4gICAgJzxkaXYgaWQ9XCJmb3JlY2FzdC1zdWJ0aXRsZVwiIHN0eWxlPVwiZm9udC1zaXplOjEzcHg7bGV0dGVyLXNwYWNpbmc6LTAuMXB4O2NvbG9yOiM4Njg2OGJcIj5TYWxlcyBQbGFucyBtZW5zdWFsZXMgKyBwb2xcdTAwRUR0aWNhIGRlIGludmVudGFyaW88L2Rpdj4nICtcclxuICAgICc8L2Rpdj4nICtcclxuICAgICc8YnV0dG9uIGNsYXNzPVwiZmMtYXBwbGUtY2xvc2VcIiBvbmNsaWNrPVwiY2xvc2VGb3JlY2FzdE1vZGFsKClcIiBhcmlhLWxhYmVsPVwiQ2VycmFyXCI+JnRpbWVzOzwvYnV0dG9uPicgK1xyXG4gICAgJzwvZGl2Pic7XHJcbiAgY29uc3QgdGFiU2FsZXNQbGFucyA9XHJcbiAgICAnPGRpdiBpZD1cImZvcmVjYXN0LXRhYi1zYWxlcy1wbGFuc1wiIHN0eWxlPVwiZmxleDoxO292ZXJmbG93OmF1dG87cGFkZGluZzowO2JhY2tncm91bmQ6I2ZiZmJmZFwiPjwvZGl2Pic7XHJcbiAgLy8gdjEzMDc6IGNvbnRlbmVkb3Igc3RhdCBxdWVkYSBvY3VsdG8gcGFyYSBwcmVzZXJ2YXIgcmVmZXJlbmNpYXMgZGVsIGNvZGlnb1xyXG4gIC8vIChzd2l0Y2hGb3JlY2FzdFRhYi9fcmVuZGVyRm9yZWNhc3RTdGF0VGFiIGV4aXN0ZW4gcGVybyBubyBzZSBpbnZvY2FuXHJcbiAgLy8gZGVzZGUgbGEgVUkpLiBTaSBxdWVyXHUwMEU5cyBsaW1waWFyIGVsIGNvZGlnbyBlbnRlcm8sIGVzIHNhZmUgYm9ycmFybG9zLlxyXG4gIGNvbnN0IHRhYlN0YXQgPSAnPGRpdiBpZD1cImZvcmVjYXN0LXRhYi1zdGF0XCIgc3R5bGU9XCJkaXNwbGF5Om5vbmVcIj48L2Rpdj4nO1xyXG4gIHJldHVybiBtb2RhbE91dGVyICsgaGVhZGVyICsgdGFiU2FsZXNQbGFucyArIHRhYlN0YXQgKyAnPC9kaXY+JztcclxufVxyXG5cclxuLy8gdjEwOTgrIEZhc2UgMSArIHYxMTAzKyBGYXNlIDJCICsgdjExMDUgZml4ICsgdjExMTEgY2xlYW4gbGVnYWN5OiBzd2l0Y2hcclxuLy8gZW50cmUgdGFicyBTYWxlcyBQbGFucyAvIEZvcmVjYXN0IEVzdGFkXHUwMEVEc3RpY28uXHJcbndpbmRvdy5zd2l0Y2hGb3JlY2FzdFRhYiA9IGZ1bmN0aW9uICh0YWJJZCkge1xyXG4gIF9mb3JlY2FzdEFjdGl2ZVRhYiA9IHRhYklkO1xyXG4gIGNvbnN0IHNwID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2ZvcmVjYXN0LXRhYi1zYWxlcy1wbGFucycpO1xyXG4gIGNvbnN0IHN0ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2ZvcmVjYXN0LXRhYi1zdGF0Jyk7XHJcbiAgaWYgKHNwKSBzcC5zdHlsZS5kaXNwbGF5ID0gdGFiSWQgPT09ICdzYWxlcy1wbGFucycgPyAnYmxvY2snIDogJ25vbmUnO1xyXG4gIGlmIChzdCkgc3Quc3R5bGUuZGlzcGxheSA9IHRhYklkID09PSAnc3RhdCcgPyAnYmxvY2snIDogJ25vbmUnO1xyXG4gIGNvbnN0IGJ0bnMgPSBkb2N1bWVudC5xdWVyeVNlbGVjdG9yQWxsKCcjZm9yZWNhc3QtdGFicy1iYXIgLmZvcmVjYXN0LXRhYicpO1xyXG4gIGJ0bnMuZm9yRWFjaCgoYikgPT4ge1xyXG4gICAgY29uc3QgYWN0aXZlID0gYi5nZXRBdHRyaWJ1dGUoJ2RhdGEtdGFiJykgPT09IHRhYklkO1xyXG4gICAgLy8gdjEzMDYgQXBwbGUtc3R5bGU6IHRvZ2dsZSBjbGFzcyBhY3RpdmUgKGxvcyBlc3RpbG9zIGRlIHBpbGwgdmllbmVuIGRlbCBDU1MpLlxyXG4gICAgYi5jbGFzc0xpc3QudG9nZ2xlKCdhY3RpdmUnLCBhY3RpdmUpO1xyXG4gIH0pO1xyXG4gIC8vIHYxMTA1IGZpeDogYWwgYWN0aXZhciBsYSB0YWIgc3RhdCwgbW9zdHJhciBwbGFjZWhvbGRlciBpbm1lZGlhdG8gcGFyYVxyXG4gIC8vIHF1ZSBzZSB2ZWEgYWxnbyBtaWVudHJhcyBjYXJnYSAobyBzaSBlbCBsb2FkIHlhIHRlcm1pbm8sIHJlLXJlbmRlcikuXHJcbiAgaWYgKHRhYklkID09PSAnc3RhdCcpIHtcclxuICAgIGNvbnN0IGNvbnQgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZm9yZWNhc3QtdGFiLXN0YXQnKTtcclxuICAgIGlmIChjb250KSB7XHJcbiAgICAgIGlmIChfZm9yZWNhc3RTdGF0RG9jcykge1xyXG4gICAgICAgIC8vIFlhIGNhcmdhZG86IHJlLXJlbmRlciAocG9yIHNpIGVsIHVzZXIgdmllbmUgZGUgb3RyYSB0YWIpLlxyXG4gICAgICAgIF9yZW5kZXJGb3JlY2FzdFN0YXRUYWIoKTtcclxuICAgICAgfSBlbHNlIHtcclxuICAgICAgICAvLyBBXHUwMEZBbiBubyBjYXJnYWRvOiBwbGFjZWhvbGRlciArIGxvYWQuXHJcbiAgICAgICAgY29udC5pbm5lckhUTUwgPVxyXG4gICAgICAgICAgJzxkaXYgY2xhc3M9XCJmYy1hcHBsZVwiIHN0eWxlPVwicGFkZGluZzo4MHB4IDIwcHg7dGV4dC1hbGlnbjpjZW50ZXI7Y29sb3I6Izg2ODY4Yjtmb250LXNpemU6MTRweDtsZXR0ZXItc3BhY2luZzotMC4xcHhcIj4nICtcclxuICAgICAgICAgICc8ZGl2IHN0eWxlPVwiZGlzcGxheTppbmxpbmUtYmxvY2s7d2lkdGg6MjhweDtoZWlnaHQ6MjhweDtib3JkZXI6Mi41cHggc29saWQgcmdiYSgwLDEyMiwyNTUsLjIpO2JvcmRlci10b3AtY29sb3I6IzAwN2FmZjtib3JkZXItcmFkaXVzOjUwJTthbmltYXRpb246c3BpbiAwLjc1cyBsaW5lYXIgaW5maW5pdGU7bWFyZ2luLWJvdHRvbToxNnB4XCI+PC9kaXY+JyArXHJcbiAgICAgICAgICAnPGRpdj5DYXJnYW5kbyBmb3JlY2FzdCBkZXNkZSBGaXJlc3RvcmU8L2Rpdj4nICtcclxuICAgICAgICAgICc8c3R5bGU+QGtleWZyYW1lcyBzcGlue3Rve3RyYW5zZm9ybTpyb3RhdGUoMzYwZGVnKX19PC9zdHlsZT4nICtcclxuICAgICAgICAgICc8L2Rpdj4nO1xyXG4gICAgICAgIF9sb2FkRm9yZWNhc3RPdXRwdXQoKVxyXG4gICAgICAgICAgLnRoZW4oX3JlbmRlckZvcmVjYXN0U3RhdFRhYilcclxuICAgICAgICAgIC5jYXRjaCgoZSkgPT4ge1xyXG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKCdbRk9SRUNBU1Qgc3RhdF0gbG9hZCBmYWlsJywgZSk7XHJcbiAgICAgICAgICAgIGNvbnN0IGMgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZm9yZWNhc3QtdGFiLXN0YXQnKTtcclxuICAgICAgICAgICAgaWYgKGMpIHtcclxuICAgICAgICAgICAgICBjLmlubmVySFRNTCA9XHJcbiAgICAgICAgICAgICAgICAnPGRpdiBjbGFzcz1cImZjLWFwcGxlXCIgc3R5bGU9XCJwYWRkaW5nOjgwcHggMjBweDt0ZXh0LWFsaWduOmNlbnRlcjtsaW5lLWhlaWdodDoxLjVcIj4nICtcclxuICAgICAgICAgICAgICAgICc8ZGl2IHN0eWxlPVwiZm9udC1zaXplOjE2cHg7Zm9udC13ZWlnaHQ6NjAwO21hcmdpbi1ib3R0b206MTBweDtjb2xvcjojYzczNzJmO2xldHRlci1zcGFjaW5nOi0wLjJweFwiPkVycm9yIGNhcmdhbmRvIGZvcmVjYXN0PC9kaXY+JyArXHJcbiAgICAgICAgICAgICAgICAnPGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMi41cHg7Y29sb3I6Izg2ODY4YjttYXJnaW4tYm90dG9tOjE4cHg7bGV0dGVyLXNwYWNpbmc6LTAuMXB4XCI+JyArXHJcbiAgICAgICAgICAgICAgICBlc2NhcGVIdG1sU2FmZShlLm1lc3NhZ2UgfHwgU3RyaW5nKGUpKSArXHJcbiAgICAgICAgICAgICAgICAnPC9kaXY+JyArXHJcbiAgICAgICAgICAgICAgICAnPGJ1dHRvbiBvbmNsaWNrPVwic3dpdGNoRm9yZWNhc3RUYWIoXFwnc3RhdFxcJylcIiBzdHlsZT1cInBhZGRpbmc6OXB4IDE4cHg7YmFja2dyb3VuZDojMDA3YWZmO2NvbG9yOiNmZmY7Ym9yZGVyOm5vbmU7Ym9yZGVyLXJhZGl1czo5ODBweDtmb250LXdlaWdodDo2MDA7Y3Vyc29yOnBvaW50ZXI7Zm9udC1zaXplOjEzcHg7bGV0dGVyLXNwYWNpbmc6LTAuMXB4XCI+UmVpbnRlbnRhcjwvYnV0dG9uPicgK1xyXG4gICAgICAgICAgICAgICAgJzwvZGl2Pic7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgIH0pO1xyXG4gICAgICB9XHJcbiAgICB9XHJcbiAgfVxyXG59O1xyXG5cclxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcbi8vIEZBU0UgMSBcdTIwMTQgU2FsZXMgUGxhbnMgdXBsb2FkIChSb2RzIC8gUmVlbHMgLyBGRylcclxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblxyXG5mdW5jdGlvbiBfeWVhck1vbnRoTm93KCkge1xyXG4gIGNvbnN0IGQgPSBuZXcgRGF0ZSgpO1xyXG4gIHJldHVybiBkLmdldEZ1bGxZZWFyKCkgKyAnLScgKyBTdHJpbmcoZC5nZXRNb250aCgpICsgMSkucGFkU3RhcnQoMiwgJzAnKTtcclxufVxyXG5cclxuZnVuY3Rpb24gX2ZtdFNpemUoYnl0ZXMpIHtcclxuICBpZiAoIWJ5dGVzKSByZXR1cm4gJyc7XHJcbiAgaWYgKGJ5dGVzIDwgMTAyNCkgcmV0dXJuIGJ5dGVzICsgJyBCJztcclxuICBpZiAoYnl0ZXMgPCAxMDI0ICogMTAyNCkgcmV0dXJuIChieXRlcyAvIDEwMjQpLnRvRml4ZWQoMSkgKyAnIEtCJztcclxuICByZXR1cm4gKGJ5dGVzIC8gKDEwMjQgKiAxMDI0KSkudG9GaXhlZCgyKSArICcgTUInO1xyXG59XHJcblxyXG5mdW5jdGlvbiBfZm10RGF0ZVNob3J0KGlzbykge1xyXG4gIGlmICghaXNvKSByZXR1cm4gJ1x1MjAxNCc7XHJcbiAgdHJ5IHtcclxuICAgIGNvbnN0IGQgPSBpc28udG9EYXRlID8gaXNvLnRvRGF0ZSgpIDogbmV3IERhdGUoaXNvKTtcclxuICAgIHJldHVybiAoXHJcbiAgICAgIGQudG9Mb2NhbGVEYXRlU3RyaW5nKCdlcy1BUicsIHsgZGF5OiAnMi1kaWdpdCcsIG1vbnRoOiAnc2hvcnQnLCB5ZWFyOiAnMi1kaWdpdCcgfSkgK1xyXG4gICAgICAnICcgK1xyXG4gICAgICBkLnRvTG9jYWxlVGltZVN0cmluZygnZXMtQVInLCB7IGhvdXI6ICcyLWRpZ2l0JywgbWludXRlOiAnMi1kaWdpdCcgfSlcclxuICAgICk7XHJcbiAgfSBjYXRjaCB7XHJcbiAgICByZXR1cm4gU3RyaW5nKGlzbyk7XHJcbiAgfVxyXG59XHJcblxyXG5hc3luYyBmdW5jdGlvbiBfbG9hZFNhbGVzUGxhbkNhY2hlcygpIHtcclxuICBpZiAoIXdpbmRvdy5mYkRiKSByZXR1cm47XHJcbiAgYXdhaXQgUHJvbWlzZS5hbGwoXHJcbiAgICBTQUxFU19QTEFOX0ZBTUlMSUFTLm1hcChhc3luYyAoZikgPT4ge1xyXG4gICAgICB0cnkge1xyXG4gICAgICAgIGNvbnN0IGRvYyA9IGF3YWl0IHdpbmRvdy5mYkRiLmNvbGxlY3Rpb24oJ3NhbGVzX3BsYW5fY2FjaGUnKS5kb2MoZi5rZXkpLmdldCgpO1xyXG4gICAgICAgIF9zYWxlc1BsYW5DYWNoZXNbZi5rZXldID0gZG9jLmV4aXN0cyA/IGRvYy5kYXRhKCkgOiBudWxsO1xyXG4gICAgICB9IGNhdGNoIChlKSB7XHJcbiAgICAgICAgY29uc29sZS53YXJuKCdbRk9SRUNBU1RdIGxvYWQgc2FsZXNfcGxhbl9jYWNoZS8nICsgZi5rZXkgKyAnIGZhaWw6JywgZSAmJiBlLm1lc3NhZ2UpO1xyXG4gICAgICAgIF9zYWxlc1BsYW5DYWNoZXNbZi5rZXldID0gbnVsbDtcclxuICAgICAgfVxyXG4gICAgfSlcclxuICApO1xyXG59XHJcblxyXG5mdW5jdGlvbiBlc2NhcGVIdG1sU2FmZShzKSB7XHJcbiAgaWYgKHR5cGVvZiB3aW5kb3cuZXNjYXBlSHRtbCA9PT0gJ2Z1bmN0aW9uJykgcmV0dXJuIHdpbmRvdy5lc2NhcGVIdG1sKHMpO1xyXG4gIHJldHVybiBTdHJpbmcocyA9PSBudWxsID8gJycgOiBzKS5yZXBsYWNlKFxyXG4gICAgL1smPD5cIiddL2csXHJcbiAgICAoY2gpID0+ICh7ICcmJzogJyZhbXA7JywgJzwnOiAnJmx0OycsICc+JzogJyZndDsnLCAnXCInOiAnJnF1b3Q7JywgXCInXCI6ICcmIzM5OycgfSlbY2hdXHJcbiAgKTtcclxufVxyXG5cclxuZnVuY3Rpb24gX2J1aWxkU2FsZXNQbGFuU2xvdEh0bWwoZikge1xyXG4gIGNvbnN0IGNhY2hlID0gX3NhbGVzUGxhbkNhY2hlc1tmLmtleV07XHJcbiAgY29uc3Qgcm93c0NvdW50ID0gY2FjaGUgJiYgTnVtYmVyLmlzRmluaXRlKGNhY2hlLnJvd3NDb3VudCkgPyBjYWNoZS5yb3dzQ291bnQgOiAwO1xyXG4gIGNvbnN0IG1vbnRoc0NvdW50ID1cclxuICAgIGNhY2hlICYmIEFycmF5LmlzQXJyYXkoY2FjaGUuZGV0ZWN0ZWRNb250aHMpID8gY2FjaGUuZGV0ZWN0ZWRNb250aHMubGVuZ3RoIDogMDtcclxuICBjb25zdCBwYXJzZWRBdCA9IGNhY2hlICYmIGNhY2hlLnBhcnNlZEF0ID8gX2ZtdERhdGVTaG9ydChjYWNoZS5wYXJzZWRBdCkgOiAnJztcclxuICBjb25zdCB1cGxvYWRlZEJ5ID0gY2FjaGUgJiYgY2FjaGUudXBsb2FkZWRCeSA/IGNhY2hlLnVwbG9hZGVkQnkgOiAnJztcclxuICBjb25zdCBzb3VyY2VGaWxlbmFtZSA9IGNhY2hlICYmIGNhY2hlLnNvdXJjZUZpbGVuYW1lID8gY2FjaGUuc291cmNlRmlsZW5hbWUgOiAnJztcclxuICBjb25zdCB5ZWFyTW9udGggPSBjYWNoZSAmJiBjYWNoZS55ZWFyTW9udGggPyBjYWNoZS55ZWFyTW9udGggOiAnJztcclxuICBjb25zdCBtb250aHNSYW5nZSA9XHJcbiAgICBjYWNoZSAmJiBjYWNoZS5kZXRlY3RlZE1vbnRocyAmJiBjYWNoZS5kZXRlY3RlZE1vbnRocy5sZW5ndGhcclxuICAgICAgPyBjYWNoZS5kZXRlY3RlZE1vbnRoc1swXSArICcgXHUyMTkyICcgKyBjYWNoZS5kZXRlY3RlZE1vbnRoc1tjYWNoZS5kZXRlY3RlZE1vbnRocy5sZW5ndGggLSAxXVxyXG4gICAgICA6ICdcdTIwMTQnO1xyXG4gIGNvbnN0IGhhc0NhY2hlID0gISFjYWNoZTtcclxuICBjb25zdCBiYWRnZSA9IGhhc0NhY2hlXHJcbiAgICA/ICc8ZGl2IHN0eWxlPVwicGFkZGluZzo0cHggOHB4O2JhY2tncm91bmQ6IzE2YTM0YTtjb2xvcjojZmZmO2JvcmRlci1yYWRpdXM6MTJweDtmb250LXNpemU6MTBweDtmb250LXdlaWdodDo3MDA7bGV0dGVyLXNwYWNpbmc6LjRweFwiPkNBUkdBRE88L2Rpdj4nXHJcbiAgICA6ICc8ZGl2IHN0eWxlPVwicGFkZGluZzo0cHggOHB4O2JhY2tncm91bmQ6I2RjMjYyNjtjb2xvcjojZmZmO2JvcmRlci1yYWRpdXM6MTJweDtmb250LXNpemU6MTBweDtmb250LXdlaWdodDo3MDA7bGV0dGVyLXNwYWNpbmc6LjRweFwiPkZBTFRBPC9kaXY+JztcclxuICBjb25zdCBtZXRhQmxvY2sgPSBoYXNDYWNoZVxyXG4gICAgPyAnPGRpdiBzdHlsZT1cImRpc3BsYXk6Z3JpZDtncmlkLXRlbXBsYXRlLWNvbHVtbnM6YXV0byAxZnI7Z2FwOjZweCAxMnB4O2ZvbnQtc2l6ZToxMXB4O3BhZGRpbmc6MTBweCAxMnB4O2JhY2tncm91bmQ6dmFyKC0tYmctc2Vjb25kYXJ5KTtib3JkZXItcmFkaXVzOjZweFwiPicgK1xyXG4gICAgICAnPGRpdiBzdHlsZT1cImNvbG9yOnZhcigtLXRleHQtbXV0ZWQpO2ZvbnQtd2VpZ2h0OjYwMFwiPkFyY2hpdm88L2Rpdj48ZGl2IHN0eWxlPVwiY29sb3I6dmFyKC0tdGV4dC1wcmltYXJ5KTtmb250LWZhbWlseTptb25vc3BhY2U7d29yZC1icmVhazpicmVhay1hbGxcIj4nICtcclxuICAgICAgZXNjYXBlSHRtbFNhZmUoc291cmNlRmlsZW5hbWUpICtcclxuICAgICAgJzwvZGl2PicgK1xyXG4gICAgICAnPGRpdiBzdHlsZT1cImNvbG9yOnZhcigtLXRleHQtbXV0ZWQpO2ZvbnQtd2VpZ2h0OjYwMFwiPlN1YmlkbzwvZGl2PjxkaXYgc3R5bGU9XCJjb2xvcjp2YXIoLS10ZXh0LXByaW1hcnkpXCI+JyArXHJcbiAgICAgIGVzY2FwZUh0bWxTYWZlKHBhcnNlZEF0KSArXHJcbiAgICAgICc8L2Rpdj4nICtcclxuICAgICAgJzxkaXYgc3R5bGU9XCJjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTtmb250LXdlaWdodDo2MDBcIj5Qb3I8L2Rpdj48ZGl2IHN0eWxlPVwiY29sb3I6dmFyKC0tdGV4dC1wcmltYXJ5KVwiPicgK1xyXG4gICAgICBlc2NhcGVIdG1sU2FmZSh1cGxvYWRlZEJ5KSArXHJcbiAgICAgICc8L2Rpdj4nICtcclxuICAgICAgJzxkaXYgc3R5bGU9XCJjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTtmb250LXdlaWdodDo2MDBcIj5TbmFwc2hvdDwvZGl2PjxkaXYgc3R5bGU9XCJjb2xvcjp2YXIoLS10ZXh0LXByaW1hcnkpO2ZvbnQtZmFtaWx5Om1vbm9zcGFjZVwiPicgK1xyXG4gICAgICBlc2NhcGVIdG1sU2FmZSh5ZWFyTW9udGgpICtcclxuICAgICAgJzwvZGl2PicgK1xyXG4gICAgICAnPGRpdiBzdHlsZT1cImNvbG9yOnZhcigtLXRleHQtbXV0ZWQpO2ZvbnQtd2VpZ2h0OjYwMFwiPlNLVXM8L2Rpdj48ZGl2IHN0eWxlPVwiY29sb3I6dmFyKC0tdGV4dC1wcmltYXJ5KTtmb250LXdlaWdodDo3MDBcIj4nICtcclxuICAgICAgcm93c0NvdW50LnRvTG9jYWxlU3RyaW5nKCdlcy1BUicpICtcclxuICAgICAgJzwvZGl2PicgK1xyXG4gICAgICAnPGRpdiBzdHlsZT1cImNvbG9yOnZhcigtLXRleHQtbXV0ZWQpO2ZvbnQtd2VpZ2h0OjYwMFwiPk1lc2VzPC9kaXY+PGRpdiBzdHlsZT1cImNvbG9yOnZhcigtLXRleHQtcHJpbWFyeSk7Zm9udC13ZWlnaHQ6NzAwXCI+JyArXHJcbiAgICAgIG1vbnRoc0NvdW50ICtcclxuICAgICAgJyA8c3BhbiBzdHlsZT1cImNvbG9yOnZhcigtLXRleHQtbXV0ZWQpO2ZvbnQtd2VpZ2h0OjQwMFwiPignICtcclxuICAgICAgZXNjYXBlSHRtbFNhZmUobW9udGhzUmFuZ2UpICtcclxuICAgICAgJyk8L3NwYW4+PC9kaXY+JyArXHJcbiAgICAgICc8L2Rpdj4nXHJcbiAgICA6ICc8ZGl2IHN0eWxlPVwicGFkZGluZzoxNHB4O3RleHQtYWxpZ246Y2VudGVyO2ZvbnQtc2l6ZToxMnB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO2JhY2tncm91bmQ6dmFyKC0tYmctc2Vjb25kYXJ5KTtib3JkZXItcmFkaXVzOjZweDtib3JkZXI6MXB4IGRhc2hlZCB2YXIoLS1ib3JkZXItc3VidGxlKVwiPkF1biBubyBzdWJpc3RlIGVsIFNhbGVzIFBsYW4gZGUgZXN0YSBmYW1pbGlhLjwvZGl2Pic7XHJcbiAgY29uc3QgdXBsb2FkQnRuID1cclxuICAgICc8bGFiZWwgc3R5bGU9XCJkaXNwbGF5OmlubGluZS1mbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtqdXN0aWZ5LWNvbnRlbnQ6Y2VudGVyO2dhcDo4cHg7cGFkZGluZzoxMHB4IDE0cHg7YmFja2dyb3VuZDonICtcclxuICAgIGYuY29sb3IgK1xyXG4gICAgJztjb2xvcjojZmZmO2JvcmRlci1yYWRpdXM6NnB4O2ZvbnQtd2VpZ2h0OjcwMDtmb250LXNpemU6MTJweDtjdXJzb3I6cG9pbnRlcjtsZXR0ZXItc3BhY2luZzouNHB4XCI+JyArXHJcbiAgICAnPHNwYW4+JyArXHJcbiAgICAoaGFzQ2FjaGUgPyAnXHUyMUJCIFJlZW1wbGF6YXIgRXhjZWwnIDogJ1x1MkIwNiBDYXJnYXIgRXhjZWwnKSArXHJcbiAgICAnPC9zcGFuPicgK1xyXG4gICAgJzxpbnB1dCB0eXBlPVwiZmlsZVwiIGFjY2VwdD1cIi54bHN4LC54bHNcIiBkYXRhLWZhbWlsaWE9XCInICtcclxuICAgIGYua2V5ICtcclxuICAgICdcIiBzdHlsZT1cImRpc3BsYXk6bm9uZVwiIG9uY2hhbmdlPVwib25TYWxlc1BsYW5GaWxlRm9yRmFtaWxpYShldmVudCwgXFwnJyArXHJcbiAgICBmLmtleSArXHJcbiAgICAnXFwnKVwiLz4nICtcclxuICAgICc8L2xhYmVsPic7XHJcbiAgY29uc3QgY2FyZEhlYWQgPVxyXG4gICAgJzxkaXYgc3R5bGU9XCJkaXNwbGF5OmZsZXg7YWxpZ24taXRlbXM6Y2VudGVyO2dhcDoxMHB4XCI+JyArXHJcbiAgICAnPGRpdiBzdHlsZT1cIndpZHRoOjEycHg7aGVpZ2h0OjMycHg7YmFja2dyb3VuZDonICtcclxuICAgIGYuY29sb3IgK1xyXG4gICAgJztib3JkZXItcmFkaXVzOjNweFwiPjwvZGl2PicgK1xyXG4gICAgJzxkaXYgc3R5bGU9XCJmbGV4OjFcIj48ZGl2IHN0eWxlPVwiZm9udC1zaXplOjE0cHg7Zm9udC13ZWlnaHQ6ODAwO2NvbG9yOnZhcigtLXRleHQtcHJpbWFyeSlcIj4nICtcclxuICAgIGVzY2FwZUh0bWxTYWZlKGYubGFiZWwpICtcclxuICAgICc8L2Rpdj4nICtcclxuICAgICc8ZGl2IHN0eWxlPVwiZm9udC1zaXplOjExcHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7bWFyZ2luLXRvcDoycHhcIj5TYWxlcyBQbGFuIG1lbnN1YWwgXHUwMEI3IEhvamEgU0FSPC9kaXY+PC9kaXY+JyArXHJcbiAgICBiYWRnZSArXHJcbiAgICAnPC9kaXY+JztcclxuICByZXR1cm4gKFxyXG4gICAgJzxkaXYgc3R5bGU9XCJiYWNrZ3JvdW5kOnZhcigtLWJnLWVsZXZhdGVkKTtib3JkZXI6MXB4IHNvbGlkIHZhcigtLWJvcmRlci1zdWJ0bGUpO2JvcmRlci1yYWRpdXM6MTBweDtwYWRkaW5nOjE2cHg7ZGlzcGxheTpmbGV4O2ZsZXgtZGlyZWN0aW9uOmNvbHVtbjtnYXA6MTJweFwiPicgK1xyXG4gICAgY2FyZEhlYWQgK1xyXG4gICAgbWV0YUJsb2NrICtcclxuICAgIHVwbG9hZEJ0biArXHJcbiAgICAnPGRpdiBpZD1cInNhbGVzLXBsYW4tc3RhdHVzLScgK1xyXG4gICAgZi5rZXkgK1xyXG4gICAgJ1wiIHN0eWxlPVwiZm9udC1zaXplOjExcHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7bWluLWhlaWdodDoxNHB4XCI+PC9kaXY+JyArXHJcbiAgICAnPC9kaXY+J1xyXG4gICk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIF9yZW5kZXJTYWxlc1BsYW5zVGFiKCkge1xyXG4gIGNvbnN0IGNvbnQgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZm9yZWNhc3QtdGFiLXNhbGVzLXBsYW5zJyk7XHJcbiAgaWYgKCFjb250KSByZXR1cm47XHJcbiAgY29uc3Qgc2xvdHMgPSBTQUxFU19QTEFOX0ZBTUlMSUFTLm1hcChfYnVpbGRTYWxlc1BsYW5TbG90SHRtbCkuam9pbignJyk7XHJcbiAgY29uc3QgaW50cm8gPVxyXG4gICAgJzxkaXYgc3R5bGU9XCJtYXJnaW4tYm90dG9tOjE2cHg7cGFkZGluZzoxMnB4IDE0cHg7YmFja2dyb3VuZDp2YXIoLS1iZy1zZWNvbmRhcnkpO2JvcmRlci1sZWZ0OjNweCBzb2xpZCAjMGQ5NDg4O2JvcmRlci1yYWRpdXM6NnB4O2ZvbnQtc2l6ZToxMnB4O2NvbG9yOnZhcigtLXRleHQtc2Vjb25kYXJ5KTtsaW5lLWhlaWdodDoxLjVcIj4nICtcclxuICAgICc8YiBzdHlsZT1cImNvbG9yOnZhcigtLXRleHQtcHJpbWFyeSlcIj5GYXNlIDE8L2I+IFx1MjAxNCBDYXJnXHUwMEUxIGxvcyBTYWxlcyBQbGFucyBtZW5zdWFsZXMgKFJvZHMgLyBSZWVscykuIFNlIHBhcnNlYSBsYSBob2phIDxiPlNBUjwvYj46IFNLVSwgTU9RIDEyIG1vbnRocywgeSB1bmEgY29sdW1uYSBwb3IgbWVzLiAnICtcclxuICAgICdFbCBFeGNlbCBvcmlnaW5hbCBxdWVkYSBzbmFwc2hvdGFkbyBlbiBTdG9yYWdlIHkgZWwgcGFyc2VvIHF1ZWRhIGVuIEZpcmVzdG9yZSBwYXJhIGVsIGNcdTAwRTFsY3VsbyBkZWJham8uJyArXHJcbiAgICAnPC9kaXY+JztcclxuICBjb25zdCBncmlkID1cclxuICAgICc8ZGl2IHN0eWxlPVwiZGlzcGxheTpncmlkO2dyaWQtdGVtcGxhdGUtY29sdW1uczpyZXBlYXQoYXV0by1maXQsbWlubWF4KDMyMHB4LDFmcikpO2dhcDoxNnB4O21hcmdpbi1ib3R0b206MjRweFwiPicgK1xyXG4gICAgc2xvdHMgK1xyXG4gICAgJzwvZGl2Pic7XHJcbiAgLy8gdjExMDk6IGNvbnRlbmVkb3IgcGFyYSB0YWJsYSBSZWNvbWVuZGFjaVx1MDBGM24gZGUgQ29tcHJhLiBTZSByZWxsZW5hIG9uLWRlbWFuZFxyXG4gIC8vIHZpYSBfcmVuZGVyUmVjb1NlY3Rpb24oKSAobGF6eSBsb2FkIGRlIHN0b2NrX3NuYXBzaG90ICsgc2t1X3ZlbnRhc19zbmFwc2hvdCkuXHJcbiAgY29uc3QgcmVjb1NlY3Rpb24gPSAnPGRpdiBpZD1cInJlY28tc2VjdGlvbi1jb250YWluZXJcIj48L2Rpdj4nO1xyXG4gIGNvbnQuaW5uZXJIVE1MID0gJzxkaXYgc3R5bGU9XCJwYWRkaW5nOjE4cHhcIj4nICsgaW50cm8gKyBncmlkICsgcmVjb1NlY3Rpb24gKyAnPC9kaXY+JztcclxuICBfcmVuZGVyUmVjb1NlY3Rpb24oKTtcclxufVxyXG5cclxud2luZG93Lm9uU2FsZXNQbGFuRmlsZUZvckZhbWlsaWEgPSBhc3luYyBmdW5jdGlvbiAoZXZlbnQsIGZhbWlsaWEpIHtcclxuICBjb25zdCBmaWxlID0gZXZlbnQgJiYgZXZlbnQudGFyZ2V0ICYmIGV2ZW50LnRhcmdldC5maWxlcyAmJiBldmVudC50YXJnZXQuZmlsZXNbMF07XHJcbiAgaWYgKCFmaWxlKSByZXR1cm47XHJcbiAgY29uc3Qgc3RhdHVzRWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnc2FsZXMtcGxhbi1zdGF0dXMtJyArIGZhbWlsaWEpO1xyXG4gIGNvbnN0IHNldFN0YXR1cyA9IChtc2csIGNvbG9yKSA9PiB7XHJcbiAgICBpZiAoIXN0YXR1c0VsKSByZXR1cm47XHJcbiAgICBzdGF0dXNFbC50ZXh0Q29udGVudCA9IG1zZztcclxuICAgIHN0YXR1c0VsLnN0eWxlLmNvbG9yID0gY29sb3IgfHwgJ3ZhcigtLXRleHQtbXV0ZWQpJztcclxuICB9O1xyXG4gIHRyeSB7XHJcbiAgICBpZiAodHlwZW9mIFhMU1ggPT09ICd1bmRlZmluZWQnKSB7XHJcbiAgICAgIGFsZXJ0KCdTaGVldEpTIChYTFNYKSBubyBjYXJnYWRvIFx1MjAxNCByZWNhcmdcdTAwRTEgbGEgYXBwLicpO1xyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcbiAgICBpZiAoIXdpbmRvdy5TYWxlc1BsYW5QYXJzZXIgfHwgIXdpbmRvdy5TYWxlc1BsYW5QYXJzZXIucGFyc2VTYWxlc1BsYW5TaGVldCkge1xyXG4gICAgICBhbGVydCgnUGFyc2VyIFNhbGVzIFBsYW4gbm8gY2FyZ2Fkby4gUmVidWlsZCBidW5kbGUuJyk7XHJcbiAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIGlmICghd2luZG93LmZpcmViYXNlIHx8ICF3aW5kb3cuZmlyZWJhc2Uuc3RvcmFnZSkge1xyXG4gICAgICBhbGVydCgnRmlyZWJhc2UgU3RvcmFnZSBubyBkaXNwb25pYmxlLicpO1xyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcbiAgICBzZXRTdGF0dXMoJ0xleWVuZG8gRXhjZWxcdTIwMjYnKTtcclxuICAgIGNvbnN0IGJ1ZiA9IGF3YWl0IGZpbGUuYXJyYXlCdWZmZXIoKTtcclxuICAgIGNvbnN0IHdiID0gWExTWC5yZWFkKGJ1ZiwgeyB0eXBlOiAnYXJyYXknIH0pO1xyXG4gICAgY29uc3Qgc2FyTmFtZSA9IHdiLlNoZWV0TmFtZXMuZmluZChcclxuICAgICAgKG4pID0+XHJcbiAgICAgICAgU3RyaW5nKG4gfHwgJycpXHJcbiAgICAgICAgICAudHJpbSgpXHJcbiAgICAgICAgICAudG9VcHBlckNhc2UoKSA9PT0gJ1NBUidcclxuICAgICk7XHJcbiAgICBpZiAoIXNhck5hbWUpIHtcclxuICAgICAgc2V0U3RhdHVzKFxyXG4gICAgICAgICdcdTI2QTAgRWwgRXhjZWwgbm8gdGllbmUgaG9qYSBcIlNBUlwiLiBIb2phcyBlbmNvbnRyYWRhczogJyArIHdiLlNoZWV0TmFtZXMuam9pbignLCAnKSxcclxuICAgICAgICAnI2RjMjYyNidcclxuICAgICAgKTtcclxuICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG4gICAgY29uc3Qgc2hlZXQgPSB3Yi5TaGVldHNbc2FyTmFtZV07XHJcbiAgICBjb25zdCByb3dzID0gWExTWC51dGlscy5zaGVldF90b19qc29uKHNoZWV0LCB7IGhlYWRlcjogMSwgZGVmdmFsOiAnJywgcmF3OiB0cnVlIH0pO1xyXG4gICAgc2V0U3RhdHVzKCdQYXJzZWFuZG8gJyArIHJvd3MubGVuZ3RoICsgJyBmaWxhcyBkZSBob2phIFwiJyArIHNhck5hbWUgKyAnXCJcdTIwMjYnKTtcclxuICAgIGNvbnN0IHBhcnNlZCA9IHdpbmRvdy5TYWxlc1BsYW5QYXJzZXIucGFyc2VTYWxlc1BsYW5TaGVldChyb3dzKTtcclxuICAgIGlmICghcGFyc2VkLnJvd3MubGVuZ3RoKSB7XHJcbiAgICAgIHNldFN0YXR1cygnXHUyNkEwIEV4Y2VsIHBhcnNlYWRvIHBlcm8gc2luIFNLVXMgdlx1MDBFMWxpZG9zLicsICcjZGMyNjI2Jyk7XHJcbiAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIGNvbnN0IHllYXJNb250aCA9IF95ZWFyTW9udGhOb3coKTtcclxuICAgIGNvbnN0IHN0b3JhZ2VQYXRoID0gJ2ZvcmVjYXN0c19zbmFwc2hvdHMvJyArIHllYXJNb250aCArICcvJyArIGZhbWlsaWEgKyAnLnhsc3gnO1xyXG4gICAgc2V0U3RhdHVzKCdTdWJpZW5kbyBFeGNlbCBhIFN0b3JhZ2UgKCcgKyBfZm10U2l6ZShmaWxlLnNpemUpICsgJylcdTIwMjYnKTtcclxuICAgIGNvbnN0IHN0b3JhZ2VSZWYgPSB3aW5kb3cuZmlyZWJhc2Uuc3RvcmFnZSgpLnJlZihzdG9yYWdlUGF0aCk7XHJcbiAgICBhd2FpdCBzdG9yYWdlUmVmLnB1dChmaWxlLCB7XHJcbiAgICAgIGNvbnRlbnRUeXBlOiBmaWxlLnR5cGUgfHwgJ2FwcGxpY2F0aW9uL3ZuZC5vcGVueG1sZm9ybWF0cy1vZmZpY2Vkb2N1bWVudC5zcHJlYWRzaGVldG1sLnNoZWV0JyxcclxuICAgICAgY3VzdG9tTWV0YWRhdGE6IHtcclxuICAgICAgICBmYW1pbGlhLFxyXG4gICAgICAgIHVwbG9hZGVkQnk6ICh3aW5kb3cuY3VycmVudFVzZXIgJiYgd2luZG93LmN1cnJlbnRVc2VyLmVtYWlsKSB8fCAnJyxcclxuICAgICAgICBzb3VyY2VGaWxlbmFtZTogZmlsZS5uYW1lIHx8ICcnLFxyXG4gICAgICB9LFxyXG4gICAgfSk7XHJcbiAgICBzZXRTdGF0dXMoJ0d1YXJkYW5kbyBwYXJzZW8gZW4gRmlyZXN0b3JlICgnICsgcGFyc2VkLnJvd3MubGVuZ3RoICsgJyBTS1VzKVx1MjAyNicpO1xyXG4gICAgY29uc3QgdXBsb2FkZWRCeSA9ICh3aW5kb3cuY3VycmVudFVzZXIgJiYgd2luZG93LmN1cnJlbnRVc2VyLmVtYWlsKSB8fCAndW5rbm93bic7XHJcbiAgICBjb25zdCBwYXlsb2FkID0ge1xyXG4gICAgICBmYW1pbGlhLFxyXG4gICAgICBwYXJzZWRBdDpcclxuICAgICAgICB3aW5kb3cuZmlyZWJhc2UgJiYgd2luZG93LmZpcmViYXNlLmZpcmVzdG9yZSAmJiB3aW5kb3cuZmlyZWJhc2UuZmlyZXN0b3JlLkZpZWxkVmFsdWVcclxuICAgICAgICAgID8gd2luZG93LmZpcmViYXNlLmZpcmVzdG9yZS5GaWVsZFZhbHVlLnNlcnZlclRpbWVzdGFtcCgpXHJcbiAgICAgICAgICA6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcclxuICAgICAgdXBsb2FkZWRCeSxcclxuICAgICAgc291cmNlRmlsZW5hbWU6IGZpbGUubmFtZSB8fCAnJyxcclxuICAgICAgc291cmNlU2hlZXQ6IHNhck5hbWUsXHJcbiAgICAgIHllYXJNb250aCxcclxuICAgICAgc3RvcmFnZVBhdGgsXHJcbiAgICAgIHJvd3NDb3VudDogcGFyc2VkLnJvd3MubGVuZ3RoLFxyXG4gICAgICBoZWFkZXJSb3dJbmRleDogcGFyc2VkLmhlYWRlclJvd0luZGV4LFxyXG4gICAgICBkZXRlY3RlZE1vbnRoczogcGFyc2VkLmRldGVjdGVkTW9udGhzLFxyXG4gICAgICByb3dzOiBwYXJzZWQucm93cyxcclxuICAgIH07XHJcbiAgICBhd2FpdCB3aW5kb3cuZmJEYi5jb2xsZWN0aW9uKCdzYWxlc19wbGFuX2NhY2hlJykuZG9jKGZhbWlsaWEpLnNldChwYXlsb2FkKTtcclxuICAgIC8vIHYxMTA3IGZpeDogZ3VhcmRhciBjYWNoZSBsb2NhbCBjb24gRGF0ZSByZWFsIChubyBlbCBTZW50aW5lbFZhbHVlKSBwYXJhXHJcbiAgICAvLyBxdWUgX2ZtdERhdGVTaG9ydCBubyBtdWVzdHJlIFwiSW52YWxpZCBEYXRlXCIuIEVsIHNlcnZlciB0aWVuZSBlbCB0cyBleGFjdG8sXHJcbiAgICAvLyBlbCBsb2NhbCBtdWVzdHJhIGVsIG1vbWVudG8gZGVsIHVwbG9hZCAoYXByb3hpbWFkbyB+MXMgZGUgZGlmZXJlbmNpYSkuXHJcbiAgICBfc2FsZXNQbGFuQ2FjaGVzW2ZhbWlsaWFdID0gT2JqZWN0LmFzc2lnbih7fSwgcGF5bG9hZCwgeyBwYXJzZWRBdDogbmV3IERhdGUoKSB9KTtcclxuICAgIHNldFN0YXR1cyhcclxuICAgICAgJ1x1MjcxMyBPSy4gJyArIHBhcnNlZC5yb3dzLmxlbmd0aCArICcgU0tVcyBcdTAwRDcgJyArIHBhcnNlZC5kZXRlY3RlZE1vbnRocy5sZW5ndGggKyAnIG1lc2VzLicsXHJcbiAgICAgICcjMTZhMzRhJ1xyXG4gICAgKTtcclxuICAgIF9yZW5kZXJTYWxlc1BsYW5zVGFiKCk7XHJcbiAgfSBjYXRjaCAoZSkge1xyXG4gICAgY29uc29sZS5lcnJvcignW0ZPUkVDQVNUXSB1cGxvYWQgc2FsZXMgcGxhbiAnICsgZmFtaWxpYSArICcgZmFpbDonLCBlKTtcclxuICAgIHNldFN0YXR1cygnXHUyNzE3IEVycm9yOiAnICsgKChlICYmIGUubWVzc2FnZSkgfHwgZSksICcjZGMyNjI2Jyk7XHJcbiAgICBpZiAoZSAmJiBlLmNvZGUgPT09ICdNT05USFNfTk9UX0ZPVU5EJykge1xyXG4gICAgICBhbGVydChcclxuICAgICAgICAnRWwgRXhjZWwgbm8gdGllbmUgY29sdW1uYXMgZGUgbWVzZXMgcmVjb25vY2libGVzLlxcblxcbkhlYWRlcnMgZXNwZXJhZG9zOiBcIkphbiAyMDI3XCIsIFwiTWF5IDIwMjdcIiwgXCJFbmUgMjAyN1wiLCBcIjIwMjctMDFcIiwgZXRjLlxcblxcbkRldGFsbGU6ICcgK1xyXG4gICAgICAgICAgZS5tZXNzYWdlXHJcbiAgICAgICk7XHJcbiAgICB9XHJcbiAgfSBmaW5hbGx5IHtcclxuICAgIGlmIChldmVudCAmJiBldmVudC50YXJnZXQpIGV2ZW50LnRhcmdldC52YWx1ZSA9ICcnO1xyXG4gIH1cclxufTtcclxuXHJcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG4vLyBGMkIgXHUyMDE0IEZvcmVjYXN0IEVzdGFkXHUwMEVEc3RpY286IHRhYmxhICsgZGV0YWxsZVxyXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHJcbmFzeW5jIGZ1bmN0aW9uIF9sb2FkRm9yZWNhc3RPdXRwdXQoKSB7XHJcbiAgaWYgKCF3aW5kb3cuZmJEYikgdGhyb3cgbmV3IEVycm9yKCdGaXJlc3RvcmUgbm8gaW5pY2lhbGl6YWRvJyk7XHJcbiAgY29uc29sZS5sb2coJ1tGT1JFQ0FTVCBzdGF0XSBsb2FkaW5nIGZvcmVjYXN0X291dHB1dC4uLicpO1xyXG4gIGNvbnN0IFtzbmFwLCBtZXRhRG9jXSA9IGF3YWl0IFByb21pc2UuYWxsKFtcclxuICAgIHdpbmRvdy5mYkRiLmNvbGxlY3Rpb24oJ2ZvcmVjYXN0X291dHB1dCcpLmdldCgpLFxyXG4gICAgd2luZG93LmZiRGIuY29sbGVjdGlvbignZm9yZWNhc3Rfb3V0cHV0X21ldGEnKS5kb2MoJ2N1cnJlbnQnKS5nZXQoKSxcclxuICBdKTtcclxuICBjb25zdCBkb2NzID0gW107XHJcbiAgc25hcC5mb3JFYWNoKChkKSA9PiBkb2NzLnB1c2goT2JqZWN0LmFzc2lnbih7IGlkOiBkLmlkIH0sIGQuZGF0YSgpKSkpO1xyXG4gIGRvY3Muc29ydCgoYSwgYikgPT4ge1xyXG4gICAgY29uc3Qgd2EgPSAoYS5tZXRyaWNzICYmIGEubWV0cmljcy53YXBlKSB8fCA5OTk7XHJcbiAgICBjb25zdCB3YiA9IChiLm1ldHJpY3MgJiYgYi5tZXRyaWNzLndhcGUpIHx8IDk5OTtcclxuICAgIHJldHVybiB3YSAtIHdiO1xyXG4gIH0pO1xyXG4gIF9mb3JlY2FzdFN0YXREb2NzID0gZG9jcztcclxuICBfZm9yZWNhc3RTdGF0TWV0YSA9IG1ldGFEb2MuZXhpc3RzID8gbWV0YURvYy5kYXRhKCkgOiBudWxsO1xyXG4gIGNvbnNvbGUubG9nKCdbRk9SRUNBU1Qgc3RhdF0gbG9hZGVkJywgZG9jcy5sZW5ndGgsICdkb2NzIFx1MDBCNyBtZXRhOicsICEhX2ZvcmVjYXN0U3RhdE1ldGEpO1xyXG4gIHJldHVybiBkb2NzO1xyXG59XHJcblxyXG5mdW5jdGlvbiBfd2FwZUJhZGdlQ29sb3Iodykge1xyXG4gIGlmICh3ID09IG51bGwpIHJldHVybiAnIzY0NzQ4Yic7XHJcbiAgaWYgKHcgPCAwLjMpIHJldHVybiAnIzE2YTM0YSc7IC8vIHZlcmRlIC0gZXhjZWxlbnRlXHJcbiAgaWYgKHcgPCAwLjUpIHJldHVybiAnIzg0Y2MxNic7IC8vIGxpbWEgLSBidWVub1xyXG4gIGlmICh3IDwgMC43KSByZXR1cm4gJyNlYWIzMDgnOyAvLyBhbWFyaWxsbyAtIGFjZXB0YWJsZVxyXG4gIGlmICh3IDwgMS4wKSByZXR1cm4gJyNmOTczMTYnOyAvLyBuYXJhbmphIC0gcG9icmVcclxuICByZXR1cm4gJyNkYzI2MjYnOyAvLyByb2pvIC0gbXV5IHBvYnJlXHJcbn1cclxuXHJcbmZ1bmN0aW9uIF9mbXROdW0obikge1xyXG4gIGlmIChuID09IG51bGwgfHwgIU51bWJlci5pc0Zpbml0ZShOdW1iZXIobikpKSByZXR1cm4gJ1x1MjAxNCc7XHJcbiAgcmV0dXJuIE51bWJlcihuKS50b0xvY2FsZVN0cmluZygnZXMtQVInLCB7IG1heGltdW1GcmFjdGlvbkRpZ2l0czogMCB9KTtcclxufVxyXG5cclxuZnVuY3Rpb24gX2ZtdFdhcGUodykge1xyXG4gIGlmICh3ID09IG51bGwgfHwgIU51bWJlci5pc0Zpbml0ZShOdW1iZXIodykpKSByZXR1cm4gJ1x1MjAxNCc7XHJcbiAgcmV0dXJuIChOdW1iZXIodykgKiAxMDApLnRvRml4ZWQoMCkgKyAnJSc7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIF9mbXREc1Nob3J0KGlzbykge1xyXG4gIC8vICcyMDI2LTEwLTAxJyAtPiAnb2N0IDI2J1xyXG4gIHRyeSB7XHJcbiAgICBjb25zdCBbeSwgbV0gPSBpc28uc3BsaXQoJy0nKS5tYXAoTnVtYmVyKTtcclxuICAgIGNvbnN0IG5hbWVzID0gW1xyXG4gICAgICAnZW5lJyxcclxuICAgICAgJ2ZlYicsXHJcbiAgICAgICdtYXInLFxyXG4gICAgICAnYWJyJyxcclxuICAgICAgJ21heScsXHJcbiAgICAgICdqdW4nLFxyXG4gICAgICAnanVsJyxcclxuICAgICAgJ2FnbycsXHJcbiAgICAgICdzZXAnLFxyXG4gICAgICAnb2N0JyxcclxuICAgICAgJ25vdicsXHJcbiAgICAgICdkaWMnLFxyXG4gICAgXTtcclxuICAgIHJldHVybiBuYW1lc1ttIC0gMV0gKyAnICcgKyBTdHJpbmcoeSkuc2xpY2UoLTIpO1xyXG4gIH0gY2F0Y2gge1xyXG4gICAgcmV0dXJuIGlzbztcclxuICB9XHJcbn1cclxuXHJcbmZ1bmN0aW9uIF9yZW5kZXJGb3JlY2FzdFN0YXRUYWIoKSB7XHJcbiAgY29uc3QgY29udCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdmb3JlY2FzdC10YWItc3RhdCcpO1xyXG4gIGlmICghY29udCkgcmV0dXJuO1xyXG4gIHRyeSB7XHJcbiAgICBfcmVuZGVyRm9yZWNhc3RTdGF0VGFiSW1wbChjb250KTtcclxuICB9IGNhdGNoIChlKSB7XHJcbiAgICBjb25zb2xlLmVycm9yKCdbRk9SRUNBU1Qgc3RhdF0gcmVuZGVyIGZhaWwnLCBlKTtcclxuICAgIGNvbnQuaW5uZXJIVE1MID1cclxuICAgICAgJzxkaXYgc3R5bGU9XCJwYWRkaW5nOjQwcHggMjBweDtjb2xvcjojZGMyNjI2O2xpbmUtaGVpZ2h0OjEuNlwiPicgK1xyXG4gICAgICAnPGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxNnB4O2ZvbnQtd2VpZ2h0OjcwMDttYXJnaW4tYm90dG9tOjEwcHhcIj5FcnJvciByZW5kZXJpemFuZG8gdGFiIEZvcmVjYXN0IEVzdGFkXHUwMEVEc3RpY288L2Rpdj4nICtcclxuICAgICAgJzxwcmUgc3R5bGU9XCJmb250LXNpemU6MTFweDtiYWNrZ3JvdW5kOiNmZWYyZjI7cGFkZGluZzoxMnB4O2JvcmRlci1yYWRpdXM6NnB4O292ZXJmbG93OmF1dG87d2hpdGUtc3BhY2U6cHJlLXdyYXBcIj4nICtcclxuICAgICAgZXNjYXBlSHRtbFNhZmUoZS5zdGFjayB8fCBlLm1lc3NhZ2UgfHwgU3RyaW5nKGUpKSArXHJcbiAgICAgICc8L3ByZT48L2Rpdj4nO1xyXG4gIH1cclxufVxyXG5cclxuZnVuY3Rpb24gX3JlbmRlckZvcmVjYXN0U3RhdFRhYkltcGwoY29udCkge1xyXG4gIGNvbnN0IGRvY3MgPSBfZm9yZWNhc3RTdGF0RG9jcyB8fCBbXTtcclxuICBjb25zdCBtZXRhID0gX2ZvcmVjYXN0U3RhdE1ldGEgfHwge307XHJcbiAgY29uc3QgcmVzdW1lbiA9IG1ldGEucmVzdW1lbiB8fCB7fTtcclxuICBjb25zb2xlLmxvZygnW0ZPUkVDQVNUIHN0YXRdIHJlbmRlciBcdTIwMTQgZG9jczonLCBkb2NzLmxlbmd0aCwgJ21ldGE6JywgISFtZXRhLmdlbmVyYXRlZEF0KTtcclxuICBpZiAoIWRvY3MubGVuZ3RoKSB7XHJcbiAgICBjb250LmlubmVySFRNTCA9XHJcbiAgICAgICc8ZGl2IHN0eWxlPVwicGFkZGluZzo2MHB4IDIwcHg7dGV4dC1hbGlnbjpjZW50ZXI7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZClcIj4nICtcclxuICAgICAgJ05vIGhheSBmb3JlY2FzdF9vdXRwdXQgcHVibGljYWRvLjxicj48YnI+JyArXHJcbiAgICAgICdDb3JyZXIgPGNvZGU+cHl0aG9uIHNjcmlwdHMvZm9yZWNhc3QvdHJhaW5fcHJvZC5weSAmJiBweXRob24gc2NyaXB0cy9mb3JlY2FzdC9wdWJsaXNoX3RvX2ZpcmVzdG9yZS5weTwvY29kZT4uJyArXHJcbiAgICAgICc8L2Rpdj4nO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuICAvLyBNZXNlcyBkZWwgZm9yZWNhc3QgKGRzIGRlbCBwcmltZXIgZG9jLCBzZSBhc3VtZSBpZ3VhbCBlbiB0b2RvcykuXHJcbiAgY29uc3QgbW9udGhzSXNvID0gKGRvY3NbMF0uZm9yZWNhc3QgfHwgW10pLm1hcCgoZikgPT4gZi5kcyk7XHJcbiAgY29uc3QgbW9udGhIZWFkZXJzID0gbW9udGhzSXNvLm1hcChfZm10RHNTaG9ydCk7XHJcblxyXG4gIC8vIE1ldHJpY3MgY2hpcCBnbG9iYWxcclxuICBjb25zdCBnZW5lcmF0ZWQgPSBtZXRhLmdlbmVyYXRlZEF0XHJcbiAgICA/IG5ldyBEYXRlKG1ldGEuZ2VuZXJhdGVkQXQpLnRvTG9jYWxlU3RyaW5nKCdlcy1BUicsIHtcclxuICAgICAgICBkYXk6ICcyLWRpZ2l0JyxcclxuICAgICAgICBtb250aDogJ3Nob3J0JyxcclxuICAgICAgICB5ZWFyOiAnMi1kaWdpdCcsXHJcbiAgICAgICAgaG91cjogJzItZGlnaXQnLFxyXG4gICAgICAgIG1pbnV0ZTogJzItZGlnaXQnLFxyXG4gICAgICB9KVxyXG4gICAgOiAnXHUyMDE0JztcclxuICBjb25zdCB3YXBlTWVkID1cclxuICAgIHJlc3VtZW4ud2FwZV9tZWRpYW5vX2Jlc3RfcGVyX3NlcmllcyAhPSBudWxsXHJcbiAgICAgID8gX2ZtdFdhcGUocmVzdW1lbi53YXBlX21lZGlhbm9fYmVzdF9wZXJfc2VyaWVzKVxyXG4gICAgICA6ICdcdTIwMTQnO1xyXG4gIGNvbnN0IG5TdWJzID0gcmVzdW1lbi5uX3N1YmZhbWlsaWFzIHx8IGRvY3MubGVuZ3RoO1xyXG4gIGNvbnN0IG5MdDA1ID1cclxuICAgIHJlc3VtZW4ubl9zZXJpZXNfd2FwZV9sdF8wXzUgIT0gbnVsbCA/IHJlc3VtZW4ubl9zZXJpZXNfd2FwZV9sdF8wXzUgKyAnLycgKyBuU3VicyA6ICdcdTIwMTQnO1xyXG4gIGNvbnN0IG5MdDAzID1cclxuICAgIHJlc3VtZW4ubl9zZXJpZXNfd2FwZV9sdF8wXzMgIT0gbnVsbCA/IHJlc3VtZW4ubl9zZXJpZXNfd2FwZV9sdF8wXzMgKyAnLycgKyBuU3VicyA6ICdcdTIwMTQnO1xyXG5cclxuICBjb25zdCBiYW5uZXIgPVxyXG4gICAgJzxkaXYgc3R5bGU9XCJtYXJnaW4tYm90dG9tOjE0cHg7cGFkZGluZzoxMnB4IDE0cHg7YmFja2dyb3VuZDp2YXIoLS1iZy1zZWNvbmRhcnkpO2JvcmRlci1sZWZ0OjNweCBzb2xpZCAjMGQ5NDg4O2JvcmRlci1yYWRpdXM6NnB4O2ZvbnQtc2l6ZToxMnB4O2NvbG9yOnZhcigtLXRleHQtc2Vjb25kYXJ5KTtsaW5lLWhlaWdodDoxLjU7ZGlzcGxheTpncmlkO2dyaWQtdGVtcGxhdGUtY29sdW1uczpyZXBlYXQoYXV0by1maXQsbWlubWF4KDE2MHB4LDFmcikpO2dhcDoxMHB4XCI+JyArXHJcbiAgICAnPGRpdj48ZGl2IHN0eWxlPVwiZm9udC1zaXplOjEwcHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO2xldHRlci1zcGFjaW5nOi40cHhcIj5XQVBFIG1lZGlhbm88L2Rpdj48ZGl2IHN0eWxlPVwiZm9udC1zaXplOjIwcHg7Zm9udC13ZWlnaHQ6ODAwO2NvbG9yOnZhcigtLXRleHQtcHJpbWFyeSlcIj4nICtcclxuICAgIHdhcGVNZWQgK1xyXG4gICAgJzwvZGl2PjwvZGl2PicgK1xyXG4gICAgJzxkaXY+PGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMHB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtsZXR0ZXItc3BhY2luZzouNHB4XCI+U3ViZmFtaWxpYXM8L2Rpdj48ZGl2IHN0eWxlPVwiZm9udC1zaXplOjIwcHg7Zm9udC13ZWlnaHQ6ODAwO2NvbG9yOnZhcigtLXRleHQtcHJpbWFyeSlcIj4nICtcclxuICAgIG5TdWJzICtcclxuICAgICc8L2Rpdj48L2Rpdj4nICtcclxuICAgICc8ZGl2PjxkaXYgc3R5bGU9XCJmb250LXNpemU6MTBweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7bGV0dGVyLXNwYWNpbmc6LjRweFwiPldBUEUgJmx0OyAzMCUgKGV4Y2VsZW50ZSk8L2Rpdj48ZGl2IHN0eWxlPVwiZm9udC1zaXplOjIwcHg7Zm9udC13ZWlnaHQ6ODAwO2NvbG9yOiMxNmEzNGFcIj4nICtcclxuICAgIG5MdDAzICtcclxuICAgICc8L2Rpdj48L2Rpdj4nICtcclxuICAgICc8ZGl2PjxkaXYgc3R5bGU9XCJmb250LXNpemU6MTBweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7bGV0dGVyLXNwYWNpbmc6LjRweFwiPldBUEUgJmx0OyA1MCUgKGJ1ZW5vKTwvZGl2PjxkaXYgc3R5bGU9XCJmb250LXNpemU6MjBweDtmb250LXdlaWdodDo4MDA7Y29sb3I6Izg0Y2MxNlwiPicgK1xyXG4gICAgbkx0MDUgK1xyXG4gICAgJzwvZGl2PjwvZGl2PicgK1xyXG4gICAgJzxkaXY+PGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMHB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtsZXR0ZXItc3BhY2luZzouNHB4XCI+XHUwMERBbHRpbWEgY29ycmlkYTwvZGl2PjxkaXYgc3R5bGU9XCJmb250LXNpemU6MTNweDtmb250LXdlaWdodDo2MDA7Y29sb3I6dmFyKC0tdGV4dC1wcmltYXJ5KTttYXJnaW4tdG9wOjRweFwiPicgK1xyXG4gICAgZXNjYXBlSHRtbFNhZmUoZ2VuZXJhdGVkKSArXHJcbiAgICAnPC9kaXY+PC9kaXY+JyArXHJcbiAgICAnPC9kaXY+JztcclxuXHJcbiAgLy8gVGFibGEgcm93c1xyXG4gIGNvbnN0IHJvd3NIdG1sID0gZG9jc1xyXG4gICAgLm1hcCgoZCkgPT4ge1xyXG4gICAgICBjb25zdCB3YXBlID0gZC5tZXRyaWNzICYmIGQubWV0cmljcy53YXBlICE9IG51bGwgPyBkLm1ldHJpY3Mud2FwZSA6IG51bGw7XHJcbiAgICAgIGNvbnN0IGJlc3RNb2RlbCA9IGQuYmVzdE1vZGVsIHx8ICdcdTIwMTQnO1xyXG4gICAgICBjb25zdCBmb3JlY2FzdE1hcCA9IHt9O1xyXG4gICAgICAoZC5mb3JlY2FzdCB8fCBbXSkuZm9yRWFjaCgoZikgPT4ge1xyXG4gICAgICAgIGZvcmVjYXN0TWFwW2YuZHNdID0gZi55X2hhdDtcclxuICAgICAgfSk7XHJcbiAgICAgIGNvbnN0IG1vbnRoQ2VsbHMgPSBtb250aHNJc29cclxuICAgICAgICAubWFwKFxyXG4gICAgICAgICAgKGRzKSA9PlxyXG4gICAgICAgICAgICAnPHRkIHN0eWxlPVwicGFkZGluZzo4cHggMTBweDt0ZXh0LWFsaWduOnJpZ2h0O2ZvbnQtdmFyaWFudC1udW1lcmljOnRhYnVsYXItbnVtcztmb250LXdlaWdodDo2MDA7Y29sb3I6dmFyKC0tdGV4dC1wcmltYXJ5KVwiPicgK1xyXG4gICAgICAgICAgICBfZm10TnVtKGZvcmVjYXN0TWFwW2RzXSkgK1xyXG4gICAgICAgICAgICAnPC90ZD4nXHJcbiAgICAgICAgKVxyXG4gICAgICAgIC5qb2luKCcnKTtcclxuICAgICAgY29uc3QgdG90YWw3ID0gKGQuZm9yZWNhc3QgfHwgW10pLnJlZHVjZSgocywgZikgPT4gcyArIChOdW1iZXIoZi55X2hhdCkgfHwgMCksIDApO1xyXG4gICAgICByZXR1cm4gKFxyXG4gICAgICAgICc8dHIgb25jbGljaz1cIm9wZW5Gb3JlY2FzdFN0YXREZXRhaWwoXFwnJyArXHJcbiAgICAgICAgZXNjYXBlSHRtbFNhZmUoZC5pZCkgK1xyXG4gICAgICAgICdcXCcpXCIgc3R5bGU9XCJjdXJzb3I6cG9pbnRlcjtib3JkZXItYm90dG9tOjFweCBzb2xpZCB2YXIoLS1ib3JkZXItc3VidGxlKVwiIG9ubW91c2VvdmVyPVwidGhpcy5zdHlsZS5iYWNrZ3JvdW5kPVxcJ3ZhcigtLWJnLXNlY29uZGFyeSlcXCdcIiBvbm1vdXNlb3V0PVwidGhpcy5zdHlsZS5iYWNrZ3JvdW5kPVxcJ3RyYW5zcGFyZW50XFwnXCI+JyArXHJcbiAgICAgICAgJzx0ZCBzdHlsZT1cInBhZGRpbmc6OHB4IDEwcHg7Zm9udC13ZWlnaHQ6NzAwO2NvbG9yOnZhcigtLXRleHQtcHJpbWFyeSlcIj4nICtcclxuICAgICAgICBlc2NhcGVIdG1sU2FmZShkLnN1YmZhbWlsaWEgfHwgZC5pZCkgK1xyXG4gICAgICAgICc8L3RkPicgK1xyXG4gICAgICAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjhweCAxMHB4O2ZvbnQtc2l6ZToxMXB4O2NvbG9yOnZhcigtLXRleHQtc2Vjb25kYXJ5KVwiPicgK1xyXG4gICAgICAgIGVzY2FwZUh0bWxTYWZlKGJlc3RNb2RlbCkgK1xyXG4gICAgICAgICc8L3RkPicgK1xyXG4gICAgICAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjhweCAxMHB4O3RleHQtYWxpZ246Y2VudGVyXCI+PHNwYW4gc3R5bGU9XCJkaXNwbGF5OmlubGluZS1ibG9jaztwYWRkaW5nOjNweCA4cHg7Ym9yZGVyLXJhZGl1czoxMnB4O2JhY2tncm91bmQ6JyArXHJcbiAgICAgICAgX3dhcGVCYWRnZUNvbG9yKHdhcGUpICtcclxuICAgICAgICAnO2NvbG9yOiNmZmY7Zm9udC1zaXplOjExcHg7Zm9udC13ZWlnaHQ6NzAwXCI+JyArXHJcbiAgICAgICAgX2ZtdFdhcGUod2FwZSkgK1xyXG4gICAgICAgICc8L3NwYW4+PC90ZD4nICtcclxuICAgICAgICBtb250aENlbGxzICtcclxuICAgICAgICAnPHRkIHN0eWxlPVwicGFkZGluZzo4cHggMTBweDt0ZXh0LWFsaWduOnJpZ2h0O2ZvbnQtdmFyaWFudC1udW1lcmljOnRhYnVsYXItbnVtcztmb250LXdlaWdodDo3MDA7Y29sb3I6IzBkOTQ4ODtiYWNrZ3JvdW5kOnZhcigtLWJnLXNlY29uZGFyeSlcIj4nICtcclxuICAgICAgICBfZm10TnVtKHRvdGFsNykgK1xyXG4gICAgICAgICc8L3RkPicgK1xyXG4gICAgICAgICc8L3RyPidcclxuICAgICAgKTtcclxuICAgIH0pXHJcbiAgICAuam9pbignJyk7XHJcblxyXG4gIGNvbnN0IG1vbnRoSGVhZGVyc0h0bWwgPSBtb250aEhlYWRlcnNcclxuICAgIC5tYXAoXHJcbiAgICAgIChtKSA9PlxyXG4gICAgICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjhweCAxMHB4O3RleHQtYWxpZ246cmlnaHQ7Zm9udC1zaXplOjEwcHg7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO2xldHRlci1zcGFjaW5nOi40cHg7Y29sb3I6Izk0YTNiOFwiPicgK1xyXG4gICAgICAgIGVzY2FwZUh0bWxTYWZlKG0pICtcclxuICAgICAgICAnPC90aD4nXHJcbiAgICApXHJcbiAgICAuam9pbignJyk7XHJcblxyXG4gIGNvbnN0IHRhYmxlID1cclxuICAgICc8ZGl2IHN0eWxlPVwib3ZlcmZsb3c6YXV0bztib3JkZXI6MXB4IHNvbGlkIHZhcigtLWJvcmRlci1zdWJ0bGUpO2JvcmRlci1yYWRpdXM6OHB4XCI+JyArXHJcbiAgICAnPHRhYmxlIHN0eWxlPVwid2lkdGg6MTAwJTtib3JkZXItY29sbGFwc2U6Y29sbGFwc2U7Zm9udC1zaXplOjEycHhcIj4nICtcclxuICAgICc8dGhlYWQgc3R5bGU9XCJiYWNrZ3JvdW5kOiMwZjE3MmE7Y29sb3I6I2ZmZlwiPjx0cj4nICtcclxuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjhweCAxMHB4O3RleHQtYWxpZ246bGVmdDtmb250LXNpemU6MTBweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7bGV0dGVyLXNwYWNpbmc6LjRweFwiPlN1YmZhbWlsaWE8L3RoPicgK1xyXG4gICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6OHB4IDEwcHg7dGV4dC1hbGlnbjpsZWZ0O2ZvbnQtc2l6ZToxMHB4O3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtsZXR0ZXItc3BhY2luZzouNHB4XCI+TW9kZWxvPC90aD4nICtcclxuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjhweCAxMHB4O3RleHQtYWxpZ246Y2VudGVyO2ZvbnQtc2l6ZToxMHB4O3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtsZXR0ZXItc3BhY2luZzouNHB4XCI+V0FQRTwvdGg+JyArXHJcbiAgICBtb250aEhlYWRlcnNIdG1sICtcclxuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjhweCAxMHB4O3RleHQtYWxpZ246cmlnaHQ7Zm9udC1zaXplOjEwcHg7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO2xldHRlci1zcGFjaW5nOi40cHg7YmFja2dyb3VuZDojMTM0ZTRhXCI+VG90YWwgN208L3RoPicgK1xyXG4gICAgJzwvdHI+PC90aGVhZD4nICtcclxuICAgICc8dGJvZHk+JyArXHJcbiAgICByb3dzSHRtbCArXHJcbiAgICAnPC90Ym9keT48L3RhYmxlPjwvZGl2Pic7XHJcblxyXG4gIGNvbnN0IGZvb3RlciA9XHJcbiAgICAnPGRpdiBzdHlsZT1cIm1hcmdpbi10b3A6MTJweDtmb250LXNpemU6MTFweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTtsaW5lLWhlaWdodDoxLjVcIj4nICtcclxuICAgICc8Yj5DXHUwMEYzbW8gbGVlcjwvYj46IFdBUEUgKFdlaWdodGVkIEFic29sdXRlIFBlcmNlbnRhZ2UgRXJyb3IpIG1pZGUgZWwgZXJyb3IgZGVsIG1vZGVsbyByZWxhdGl2byBhbCB0b3RhbCByZWFsOiAmbHQ7MzAlIGV4Y2VsZW50ZSwgMzAtNTAlIGJ1ZW5vLCA1MC03MCUgYWNlcHRhYmxlLCAmZ3Q7NzAlIHBvYnJlLiBDbGljayBlbiBmaWxhIHBhcmEgZGV0YWxsZSArIGdyXHUwMEUxZmljby4gJyArXHJcbiAgICAnU2UgZWxpZ2UgZWwgbW9kZWxvIGNvbiBtZW5vciBXQVBFIHBvciBzZXJpZSB0cmFzIGJhY2t0ZXN0IHJvbGxpbmctb3JpZ2luIChoPTIsIHZlbnRhbmFzPTMpLicgK1xyXG4gICAgJzwvZGl2Pic7XHJcblxyXG4gIGNvbnQuaW5uZXJIVE1MID0gJzxkaXYgc3R5bGU9XCJwYWRkaW5nOjE4cHhcIj4nICsgYmFubmVyICsgdGFibGUgKyBmb290ZXIgKyAnPC9kaXY+JztcclxufVxyXG5cclxuLy8gQ2FjaGUgaGlzdG9yaWEgYWdyZWdhZGEgcG9yIHN1YmZhbWlsaWEgKHBhcmEgZ3JcdTAwRTFmaWNvIGRldGFsbGUpLlxyXG5hc3luYyBmdW5jdGlvbiBfbG9hZEZvcmVjYXN0U3RhdEhpc3RvcnkoKSB7XHJcbiAgaWYgKF9mb3JlY2FzdFN0YXRIaXN0b3J5Q2FjaGUpIHJldHVybiBfZm9yZWNhc3RTdGF0SGlzdG9yeUNhY2hlO1xyXG4gIC8vIExhIGhpc3RvcmlhIHNvbG8gZXN0XHUwMEUxIGVuIEJRICh+MTAgYVx1MDBGMW9zIEJhcmFsZG8gKyAxMiBtZXNlcyBTaGltYW5vKS4gQ29tb1xyXG4gIC8vIGVsIHBpcGVsaW5lIGxhIGVzY3JpYmUgYSBDU1YgbG9jYWwsIGFjXHUwMEUxIG5vIGxhIHBvZGVtb3MgbGVlci4gQWx0ZXJuYXRpdmE6XHJcbiAgLy8gdXNhciBza3VfdmVudGFzX3NuYXBzaG90IHF1ZSB0aWVuZSB2ZW50YXMgbWVuc3VhbGVzIHBlcm8gc29sbyBncnVwbyBQRVNDQS5cclxuICAvLyBFbiBGMkIuMiBzb2xvIG1vc3RyYW1vcyBmb3JlY2FzdCtJQyAoc2luIG92ZXJsYXkgaGlzdG9yaWEgcG9yIGFob3JhKS5cclxuICBfZm9yZWNhc3RTdGF0SGlzdG9yeUNhY2hlID0ge307XHJcbiAgcmV0dXJuIF9mb3JlY2FzdFN0YXRIaXN0b3J5Q2FjaGU7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIF9idWlsZEZvcmVjYXN0Q2hhcnRTdmcoZG9jKSB7XHJcbiAgY29uc3QgZmMgPSBkb2MuZm9yZWNhc3QgfHwgW107XHJcbiAgaWYgKCFmYy5sZW5ndGgpXHJcbiAgICByZXR1cm4gJzxkaXYgc3R5bGU9XCJwYWRkaW5nOjMwcHg7dGV4dC1hbGlnbjpjZW50ZXI7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZClcIj5TaW4gZGF0b3MgZGUgZm9yZWNhc3Q8L2Rpdj4nO1xyXG4gIC8vIERpbWVuc2lvbmVzXHJcbiAgY29uc3QgVyA9IDY0MCxcclxuICAgIEggPSAyNjA7XHJcbiAgY29uc3QgcGFkTCA9IDUwLFxyXG4gICAgcGFkUiA9IDIwLFxyXG4gICAgcGFkVCA9IDIwLFxyXG4gICAgcGFkQiA9IDQwO1xyXG4gIGNvbnN0IGlubmVyVyA9IFcgLSBwYWRMIC0gcGFkUjtcclxuICBjb25zdCBpbm5lckggPSBIIC0gcGFkVCAtIHBhZEI7XHJcblxyXG4gIC8vIFkgcmFuZ2U6IG1heChoaTgwKSAqIDEuMVxyXG4gIGNvbnN0IG1heFkgPSBNYXRoLm1heCgxLCAuLi5mYy5tYXAoKGYpID0+IE51bWJlcihmLmhpODApIHx8IE51bWJlcihmLnlfaGF0KSB8fCAwKSk7XHJcbiAgY29uc3QgbWluWSA9IDA7XHJcbiAgY29uc3Qgc2NhbGVYID0gKGkpID0+IHBhZEwgKyAoaW5uZXJXICogaSkgLyBNYXRoLm1heCgxLCBmYy5sZW5ndGggLSAxKTtcclxuICBjb25zdCBzY2FsZVkgPSAodikgPT4gcGFkVCArIGlubmVySCAtIChpbm5lckggKiAodiAtIG1pblkpKSAvIChtYXhZIC0gbWluWSk7XHJcblxyXG4gIC8vIEdyaWQgKyBlamUgWVxyXG4gIGNvbnN0IHlUaWNrcyA9IFswLCAwLjI1LCAwLjUsIDAuNzUsIDFdXHJcbiAgICAubWFwKChyKSA9PiB7XHJcbiAgICAgIGNvbnN0IHZhbCA9IG1pblkgKyByICogKG1heFkgLSBtaW5ZKTtcclxuICAgICAgY29uc3QgeXkgPSBzY2FsZVkodmFsKTtcclxuICAgICAgcmV0dXJuIChcclxuICAgICAgICAnPGxpbmUgeDE9XCInICtcclxuICAgICAgICBwYWRMICtcclxuICAgICAgICAnXCIgeTE9XCInICtcclxuICAgICAgICB5eSArXHJcbiAgICAgICAgJ1wiIHgyPVwiJyArXHJcbiAgICAgICAgKFcgLSBwYWRSKSArXHJcbiAgICAgICAgJ1wiIHkyPVwiJyArXHJcbiAgICAgICAgeXkgK1xyXG4gICAgICAgICdcIiBzdHJva2U9XCIjZTJlOGYwXCIgc3Ryb2tlLXdpZHRoPVwiMVwiLz4nICtcclxuICAgICAgICAnPHRleHQgeD1cIicgK1xyXG4gICAgICAgIChwYWRMIC0gNikgK1xyXG4gICAgICAgICdcIiB5PVwiJyArXHJcbiAgICAgICAgKHl5ICsgNCkgK1xyXG4gICAgICAgICdcIiB0ZXh0LWFuY2hvcj1cImVuZFwiIGZvbnQtc2l6ZT1cIjEwXCIgZmlsbD1cIiM2NDc0OGJcIj4nICtcclxuICAgICAgICBfZm10TnVtKHZhbCkgK1xyXG4gICAgICAgICc8L3RleHQ+J1xyXG4gICAgICApO1xyXG4gICAgfSlcclxuICAgIC5qb2luKCcnKTtcclxuXHJcbiAgLy8gRWplIFggKG1lc2VzKVxyXG4gIGNvbnN0IHhMYWJlbHMgPSBmY1xyXG4gICAgLm1hcCgoZiwgaSkgPT4ge1xyXG4gICAgICBjb25zdCB4eCA9IHNjYWxlWChpKTtcclxuICAgICAgcmV0dXJuIChcclxuICAgICAgICAnPHRleHQgeD1cIicgK1xyXG4gICAgICAgIHh4ICtcclxuICAgICAgICAnXCIgeT1cIicgK1xyXG4gICAgICAgIChIIC0gcGFkQiArIDE1KSArXHJcbiAgICAgICAgJ1wiIHRleHQtYW5jaG9yPVwibWlkZGxlXCIgZm9udC1zaXplPVwiMTBcIiBmaWxsPVwiIzY0NzQ4YlwiPicgK1xyXG4gICAgICAgIF9mbXREc1Nob3J0KGYuZHMpICtcclxuICAgICAgICAnPC90ZXh0PidcclxuICAgICAgKTtcclxuICAgIH0pXHJcbiAgICAuam9pbignJyk7XHJcblxyXG4gIC8vIEludGVydmFsbyBjb25maWFuemEgKGJhbmQpXHJcbiAgY29uc3QgYmFuZFBvaW50cyA9XHJcbiAgICBmYy5tYXAoKGYsIGkpID0+IHNjYWxlWChpKSArICcsJyArIHNjYWxlWShOdW1iZXIoZi5oaTgwKSB8fCAwKSkuam9pbignICcpICtcclxuICAgICcgJyArXHJcbiAgICBmY1xyXG4gICAgICAuc2xpY2UoKVxyXG4gICAgICAucmV2ZXJzZSgpXHJcbiAgICAgIC5tYXAoKGYsIGkpID0+IHNjYWxlWChmYy5sZW5ndGggLSAxIC0gaSkgKyAnLCcgKyBzY2FsZVkoTnVtYmVyKGYubG84MCkgfHwgMCkpXHJcbiAgICAgIC5qb2luKCcgJyk7XHJcbiAgY29uc3QgYmFuZCA9ICc8cG9seWdvbiBwb2ludHM9XCInICsgYmFuZFBvaW50cyArICdcIiBmaWxsPVwiIzBkOTQ4ODMzXCIgc3Ryb2tlPVwibm9uZVwiLz4nO1xyXG5cclxuICAvLyBMaW5lIGZvcmVjYXN0ICsgcHVudG9zXHJcbiAgY29uc3QgbGluZVBvaW50cyA9IGZjLm1hcCgoZiwgaSkgPT4gc2NhbGVYKGkpICsgJywnICsgc2NhbGVZKE51bWJlcihmLnlfaGF0KSB8fCAwKSkuam9pbignICcpO1xyXG4gIGNvbnN0IGxpbmUgPVxyXG4gICAgJzxwb2x5bGluZSBwb2ludHM9XCInICtcclxuICAgIGxpbmVQb2ludHMgK1xyXG4gICAgJ1wiIGZpbGw9XCJub25lXCIgc3Ryb2tlPVwiIzBkOTQ4OFwiIHN0cm9rZS13aWR0aD1cIjIuNVwiIHN0cm9rZS1saW5lam9pbj1cInJvdW5kXCIvPic7XHJcbiAgY29uc3QgcG9pbnRzID0gZmNcclxuICAgIC5tYXAoXHJcbiAgICAgIChmLCBpKSA9PlxyXG4gICAgICAgICc8Y2lyY2xlIGN4PVwiJyArXHJcbiAgICAgICAgc2NhbGVYKGkpICtcclxuICAgICAgICAnXCIgY3k9XCInICtcclxuICAgICAgICBzY2FsZVkoTnVtYmVyKGYueV9oYXQpIHx8IDApICtcclxuICAgICAgICAnXCIgcj1cIjRcIiBmaWxsPVwiIzBkOTQ4OFwiIHN0cm9rZT1cIiNmZmZcIiBzdHJva2Utd2lkdGg9XCIyXCIvPidcclxuICAgIClcclxuICAgIC5qb2luKCcnKTtcclxuICAvLyBMYWJlbHMgZGUgdmFsb3JcclxuICBjb25zdCB2YWx1ZUxhYmVscyA9IGZjXHJcbiAgICAubWFwKChmLCBpKSA9PiB7XHJcbiAgICAgIGNvbnN0IHh4ID0gc2NhbGVYKGkpO1xyXG4gICAgICBjb25zdCB5eSA9IHNjYWxlWShOdW1iZXIoZi55X2hhdCkgfHwgMCk7XHJcbiAgICAgIHJldHVybiAoXHJcbiAgICAgICAgJzx0ZXh0IHg9XCInICtcclxuICAgICAgICB4eCArXHJcbiAgICAgICAgJ1wiIHk9XCInICtcclxuICAgICAgICAoeXkgLSA4KSArXHJcbiAgICAgICAgJ1wiIHRleHQtYW5jaG9yPVwibWlkZGxlXCIgZm9udC1zaXplPVwiMTBcIiBmb250LXdlaWdodD1cIjcwMFwiIGZpbGw9XCIjMGY3NjZlXCI+JyArXHJcbiAgICAgICAgX2ZtdE51bShmLnlfaGF0KSArXHJcbiAgICAgICAgJzwvdGV4dD4nXHJcbiAgICAgICk7XHJcbiAgICB9KVxyXG4gICAgLmpvaW4oJycpO1xyXG5cclxuICBjb25zdCBzdmcgPVxyXG4gICAgJzxzdmcgdmlld0JveD1cIjAgMCAnICtcclxuICAgIFcgK1xyXG4gICAgJyAnICtcclxuICAgIEggK1xyXG4gICAgJ1wiIHN0eWxlPVwid2lkdGg6MTAwJTttYXgtd2lkdGg6ODAwcHg7aGVpZ2h0OmF1dG9cIj4nICtcclxuICAgICc8cmVjdCB4PVwiMFwiIHk9XCIwXCIgd2lkdGg9XCInICtcclxuICAgIFcgK1xyXG4gICAgJ1wiIGhlaWdodD1cIicgK1xyXG4gICAgSCArXHJcbiAgICAnXCIgZmlsbD1cIiNmZmZcIi8+JyArXHJcbiAgICB5VGlja3MgK1xyXG4gICAgeExhYmVscyArXHJcbiAgICBiYW5kICtcclxuICAgIGxpbmUgK1xyXG4gICAgcG9pbnRzICtcclxuICAgIHZhbHVlTGFiZWxzICtcclxuICAgICc8L3N2Zz4nO1xyXG4gIHJldHVybiBzdmc7XHJcbn1cclxuXHJcbndpbmRvdy5vcGVuRm9yZWNhc3RTdGF0RGV0YWlsID0gZnVuY3Rpb24gKHN1YklkKSB7XHJcbiAgaWYgKCFfZm9yZWNhc3RTdGF0RG9jcykgcmV0dXJuO1xyXG4gIGNvbnN0IGRvYyA9IF9mb3JlY2FzdFN0YXREb2NzLmZpbmQoKGQpID0+IGQuaWQgPT09IHN1YklkKTtcclxuICBpZiAoIWRvYykge1xyXG4gICAgYWxlcnQoJ05vIHNlIGVuY29udHJcdTAwRjMgZGV0YWxsZSBkZSAnICsgc3ViSWQpO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuICBjb25zdCBleGlzdGluZyA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdmb3JlY2FzdC1zdGF0LWRldGFpbCcpO1xyXG4gIGlmIChleGlzdGluZykgZXhpc3RpbmcucmVtb3ZlKCk7XHJcblxyXG4gIGNvbnN0IGVsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2Jyk7XHJcbiAgZWwuaWQgPSAnZm9yZWNhc3Qtc3RhdC1kZXRhaWwnO1xyXG4gIGVsLnN0eWxlLmNzc1RleHQgPVxyXG4gICAgJ3Bvc2l0aW9uOmZpeGVkO2luc2V0OjA7YmFja2dyb3VuZDpyZ2JhKDE1LDIzLDQyLC42NSk7ei1pbmRleDoyMTAwO2Rpc3BsYXk6ZmxleDthbGlnbi1pdGVtczpjZW50ZXI7anVzdGlmeS1jb250ZW50OmNlbnRlcjtwYWRkaW5nOjJ2aCc7XHJcbiAgZWwub25jbGljayA9IChldikgPT4ge1xyXG4gICAgaWYgKGV2LnRhcmdldCA9PT0gZWwpIGVsLnJlbW92ZSgpO1xyXG4gIH07XHJcblxyXG4gIGNvbnN0IHdhcGUgPSBkb2MubWV0cmljcyAmJiBkb2MubWV0cmljcy53YXBlO1xyXG4gIGNvbnN0IGJpYXMgPSBkb2MubWV0cmljcyAmJiBkb2MubWV0cmljcy5iaWFzO1xyXG4gIGNvbnN0IG1hZSA9IGRvYy5tZXRyaWNzICYmIGRvYy5tZXRyaWNzLm1hZTtcclxuICBjb25zdCBybXNlID0gZG9jLm1ldHJpY3MgJiYgZG9jLm1ldHJpY3Mucm1zZTtcclxuICBjb25zdCBiZXN0TW9kZWwgPSBkb2MuYmVzdE1vZGVsIHx8ICdcdTIwMTQnO1xyXG4gIGNvbnN0IHZlcnNpb25JZCA9IGRvYy52ZXJzaW9uSWQgfHwgJ1x1MjAxNCc7XHJcbiAgY29uc3Qgc3ZnSHRtbCA9IF9idWlsZEZvcmVjYXN0Q2hhcnRTdmcoZG9jKTtcclxuXHJcbiAgY29uc3QgbWV0cmljc0h0bWwgPVxyXG4gICAgJzxkaXYgc3R5bGU9XCJkaXNwbGF5OmdyaWQ7Z3JpZC10ZW1wbGF0ZS1jb2x1bW5zOnJlcGVhdChhdXRvLWZpdCxtaW5tYXgoMTIwcHgsMWZyKSk7Z2FwOjEwcHg7bWFyZ2luOjE0cHggMFwiPicgK1xyXG4gICAgJzxkaXYgc3R5bGU9XCJwYWRkaW5nOjEwcHg7YmFja2dyb3VuZDp2YXIoLS1iZy1zZWNvbmRhcnkpO2JvcmRlci1yYWRpdXM6NnB4XCI+PGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMHB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZVwiPk1vZGVsbzwvZGl2PjxkaXYgc3R5bGU9XCJmb250LXdlaWdodDo3MDBcIj4nICtcclxuICAgIGVzY2FwZUh0bWxTYWZlKGJlc3RNb2RlbCkgK1xyXG4gICAgJzwvZGl2PjwvZGl2PicgK1xyXG4gICAgJzxkaXYgc3R5bGU9XCJwYWRkaW5nOjEwcHg7YmFja2dyb3VuZDp2YXIoLS1iZy1zZWNvbmRhcnkpO2JvcmRlci1yYWRpdXM6NnB4XCI+PGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMHB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZVwiPldBUEU8L2Rpdj48ZGl2IHN0eWxlPVwiZm9udC13ZWlnaHQ6NzAwO2NvbG9yOicgK1xyXG4gICAgX3dhcGVCYWRnZUNvbG9yKHdhcGUpICtcclxuICAgICdcIj4nICtcclxuICAgIF9mbXRXYXBlKHdhcGUpICtcclxuICAgICc8L2Rpdj48L2Rpdj4nICtcclxuICAgICc8ZGl2IHN0eWxlPVwicGFkZGluZzoxMHB4O2JhY2tncm91bmQ6dmFyKC0tYmctc2Vjb25kYXJ5KTtib3JkZXItcmFkaXVzOjZweFwiPjxkaXYgc3R5bGU9XCJmb250LXNpemU6MTBweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2VcIj5CaWFzPC9kaXY+PGRpdiBzdHlsZT1cImZvbnQtd2VpZ2h0OjcwMFwiPicgK1xyXG4gICAgKGJpYXMgIT0gbnVsbCA/IChiaWFzICogMTAwKS50b0ZpeGVkKDApICsgJyUnIDogJ1x1MjAxNCcpICtcclxuICAgICc8L2Rpdj48L2Rpdj4nICtcclxuICAgICc8ZGl2IHN0eWxlPVwicGFkZGluZzoxMHB4O2JhY2tncm91bmQ6dmFyKC0tYmctc2Vjb25kYXJ5KTtib3JkZXItcmFkaXVzOjZweFwiPjxkaXYgc3R5bGU9XCJmb250LXNpemU6MTBweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2VcIj5NQUU8L2Rpdj48ZGl2IHN0eWxlPVwiZm9udC13ZWlnaHQ6NzAwXCI+JyArXHJcbiAgICBfZm10TnVtKG1hZSkgK1xyXG4gICAgJzwvZGl2PjwvZGl2PicgK1xyXG4gICAgJzxkaXYgc3R5bGU9XCJwYWRkaW5nOjEwcHg7YmFja2dyb3VuZDp2YXIoLS1iZy1zZWNvbmRhcnkpO2JvcmRlci1yYWRpdXM6NnB4XCI+PGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMHB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZVwiPlJNU0U8L2Rpdj48ZGl2IHN0eWxlPVwiZm9udC13ZWlnaHQ6NzAwXCI+JyArXHJcbiAgICBfZm10TnVtKHJtc2UpICtcclxuICAgICc8L2Rpdj48L2Rpdj4nICtcclxuICAgICc8L2Rpdj4nO1xyXG5cclxuICBjb25zdCB0YWJsZUh0bWwgPVxyXG4gICAgJzx0YWJsZSBzdHlsZT1cIndpZHRoOjEwMCU7Zm9udC1zaXplOjEycHg7Ym9yZGVyLWNvbGxhcHNlOmNvbGxhcHNlO21hcmdpbi10b3A6MTBweFwiPicgK1xyXG4gICAgJzx0aGVhZCBzdHlsZT1cImJhY2tncm91bmQ6IzBmMTcyYTtjb2xvcjojZmZmXCI+PHRyPicgK1xyXG4gICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6NnB4IDEwcHg7dGV4dC1hbGlnbjpsZWZ0XCI+TWVzPC90aD4nICtcclxuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjZweCAxMHB4O3RleHQtYWxpZ246cmlnaHRcIj5Gb3JlY2FzdDwvdGg+JyArXHJcbiAgICAnPHRoIHN0eWxlPVwicGFkZGluZzo2cHggMTBweDt0ZXh0LWFsaWduOnJpZ2h0XCI+SUMgODAlIGJham88L3RoPicgK1xyXG4gICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6NnB4IDEwcHg7dGV4dC1hbGlnbjpyaWdodFwiPklDIDgwJSBhbHRvPC90aD4nICtcclxuICAgICc8L3RyPjwvdGhlYWQ+PHRib2R5PicgK1xyXG4gICAgKGRvYy5mb3JlY2FzdCB8fCBbXSlcclxuICAgICAgLm1hcChcclxuICAgICAgICAoZikgPT5cclxuICAgICAgICAgICc8dHIgc3R5bGU9XCJib3JkZXItYm90dG9tOjFweCBzb2xpZCB2YXIoLS1ib3JkZXItc3VidGxlKVwiPjx0ZCBzdHlsZT1cInBhZGRpbmc6NnB4IDEwcHhcIj4nICtcclxuICAgICAgICAgIGVzY2FwZUh0bWxTYWZlKF9mbXREc1Nob3J0KGYuZHMpKSArXHJcbiAgICAgICAgICAnPC90ZD4nICtcclxuICAgICAgICAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjZweCAxMHB4O3RleHQtYWxpZ246cmlnaHQ7Zm9udC13ZWlnaHQ6NzAwXCI+JyArXHJcbiAgICAgICAgICBfZm10TnVtKGYueV9oYXQpICtcclxuICAgICAgICAgICc8L3RkPicgK1xyXG4gICAgICAgICAgJzx0ZCBzdHlsZT1cInBhZGRpbmc6NnB4IDEwcHg7dGV4dC1hbGlnbjpyaWdodDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKVwiPicgK1xyXG4gICAgICAgICAgX2ZtdE51bShmLmxvODApICtcclxuICAgICAgICAgICc8L3RkPicgK1xyXG4gICAgICAgICAgJzx0ZCBzdHlsZT1cInBhZGRpbmc6NnB4IDEwcHg7dGV4dC1hbGlnbjpyaWdodDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKVwiPicgK1xyXG4gICAgICAgICAgX2ZtdE51bShmLmhpODApICtcclxuICAgICAgICAgICc8L3RkPjwvdHI+J1xyXG4gICAgICApXHJcbiAgICAgIC5qb2luKCcnKSArXHJcbiAgICAnPC90Ym9keT48L3RhYmxlPic7XHJcblxyXG4gIGNvbnN0IGNvbnRlbnQgPVxyXG4gICAgJzxkaXYgc3R5bGU9XCJiYWNrZ3JvdW5kOnZhcigtLWJnLWVsZXZhdGVkKTtib3JkZXItcmFkaXVzOjEycHg7cGFkZGluZzoyNHB4O21heC13aWR0aDo4MjBweDt3aWR0aDoxMDAlO21heC1oZWlnaHQ6OTZ2aDtvdmVyZmxvdzphdXRvO2JveC1zaGFkb3c6MCAyMHB4IDYwcHggcmdiYSgwLDAsMCwuNClcIj4nICtcclxuICAgICc8ZGl2IHN0eWxlPVwiZGlzcGxheTpmbGV4O2p1c3RpZnktY29udGVudDpzcGFjZS1iZXR3ZWVuO2FsaWduLWl0ZW1zOmNlbnRlcjttYXJnaW4tYm90dG9tOjEwcHhcIj4nICtcclxuICAgICc8ZGl2PjxkaXYgc3R5bGU9XCJmb250LXNpemU6MTFweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7bGV0dGVyLXNwYWNpbmc6LjRweFwiPlN1YmZhbWlsaWE8L2Rpdj48ZGl2IHN0eWxlPVwiZm9udC1zaXplOjIycHg7Zm9udC13ZWlnaHQ6ODAwXCI+JyArXHJcbiAgICBlc2NhcGVIdG1sU2FmZShkb2Muc3ViZmFtaWxpYSB8fCBkb2MuaWQpICtcclxuICAgICc8L2Rpdj48L2Rpdj4nICtcclxuICAgICc8YnV0dG9uIG9uY2xpY2s9XCJkb2N1bWVudC5nZXRFbGVtZW50QnlJZChcXCdmb3JlY2FzdC1zdGF0LWRldGFpbFxcJykucmVtb3ZlKClcIiBzdHlsZT1cImJhY2tncm91bmQ6dHJhbnNwYXJlbnQ7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1ib3JkZXItc3VidGxlKTtib3JkZXItcmFkaXVzOjZweDtwYWRkaW5nOjZweCAxMnB4O2N1cnNvcjpwb2ludGVyO2ZvbnQtd2VpZ2h0OjcwMFwiPkNlcnJhcjwvYnV0dG9uPicgK1xyXG4gICAgJzwvZGl2PicgK1xyXG4gICAgbWV0cmljc0h0bWwgK1xyXG4gICAgJzxkaXYgc3R5bGU9XCJiYWNrZ3JvdW5kOiNmZmY7cGFkZGluZzo4cHg7Ym9yZGVyLXJhZGl1czo4cHg7bWFyZ2luLXRvcDoxMHB4O2JvcmRlcjoxcHggc29saWQgdmFyKC0tYm9yZGVyLXN1YnRsZSlcIj4nICtcclxuICAgIHN2Z0h0bWwgK1xyXG4gICAgJzwvZGl2PicgK1xyXG4gICAgdGFibGVIdG1sICtcclxuICAgICc8ZGl2IHN0eWxlPVwibWFyZ2luLXRvcDoxNHB4O2ZvbnQtc2l6ZToxMXB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpXCI+VmVyc2lvbjogPGNvZGU+JyArXHJcbiAgICBlc2NhcGVIdG1sU2FmZSh2ZXJzaW9uSWQpICtcclxuICAgICc8L2NvZGU+IFx1MDBCNyBBcHByb2FjaDogJyArXHJcbiAgICBlc2NhcGVIdG1sU2FmZSgoZG9jLmNvbmZpZyB8fCB7fSkuYXBwcm9hY2ggfHwgJ1x1MjAxNCcpICtcclxuICAgICc8L2Rpdj4nICtcclxuICAgICc8L2Rpdj4nO1xyXG4gIGVsLmlubmVySFRNTCA9IGNvbnRlbnQ7XHJcbiAgZG9jdW1lbnQuYm9keS5hcHBlbmRDaGlsZChlbCk7XHJcbn07XHJcblxyXG53aW5kb3cub3BlbkZvcmVjYXN0TW9kYWwgPSBhc3luYyBmdW5jdGlvbiAoKSB7XHJcbiAgaWYgKCFfY2FuRm9yZWNhc3QoKSkge1xyXG4gICAgYWxlcnQoJ0ZPUkVDQVNUIGVzIHNvbG8gcGFyYSBNYXJpYW5vIChhZG1pbikuJyk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIGNvbnN0IGVsID0gX3JlbmRlck1vZGFsU2hlbGwoKTtcclxuICBlbC5zdHlsZS5kaXNwbGF5ID0gJ2Jsb2NrJztcclxuICAvLyBGYXNlIDE6IGNhcmdhciBTYWxlcyBQbGFucyBjYWNoZXMgKyByZW5kZXJpemFyIHRhYiBkZWZhdWx0LlxyXG4gIF9yZW5kZXJTYWxlc1BsYW5zVGFiKCk7XHJcbiAgX2xvYWRTYWxlc1BsYW5DYWNoZXMoKVxyXG4gICAgLnRoZW4oX3JlbmRlclNhbGVzUGxhbnNUYWIpXHJcbiAgICAuY2F0Y2goKCkgPT4ge30pO1xyXG59O1xyXG5cclxud2luZG93LmNsb3NlRm9yZWNhc3RNb2RhbCA9IGZ1bmN0aW9uICgpIHtcclxuICBjb25zdCBlbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdmb3JlY2FzdC1tb2RhbCcpO1xyXG4gIGlmIChlbCkgZWwuc3R5bGUuZGlzcGxheSA9ICdub25lJztcclxufTtcclxuXHJcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG4vLyBGM0EgXHUyMDE0IFRhYmxhIFJlY29tZW5kYWNpXHUwMEYzbiBkZSBDb21wcmEgKHRhYiBTYWxlcyBQbGFucylcclxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblxyXG5hc3luYyBmdW5jdGlvbiBfbG9hZE11bHRpcGxpZXJPdmVycmlkZXMoKSB7XHJcbiAgaWYgKCF3aW5kb3cuZmJEYikgcmV0dXJuO1xyXG4gIHRyeSB7XHJcbiAgICBjb25zdCBkb2MgPSBhd2FpdCB3aW5kb3cuZmJEYi5jb2xsZWN0aW9uKCdmb3JlY2FzdF9jb25maWcnKS5kb2MoJ211bHRpcGxpZXJzJykuZ2V0KCk7XHJcbiAgICBpZiAoZG9jLmV4aXN0cykge1xyXG4gICAgICBjb25zdCBkID0gZG9jLmRhdGEoKSB8fCB7fTtcclxuICAgICAgX211bHRpcGxpZXJPdmVycmlkZXMgPSBkLnNrdU92ZXJyaWRlcyB8fCB7fTtcclxuICAgIH0gZWxzZSB7XHJcbiAgICAgIF9tdWx0aXBsaWVyT3ZlcnJpZGVzID0ge307XHJcbiAgICB9XHJcbiAgfSBjYXRjaCAoZSkge1xyXG4gICAgY29uc29sZS53YXJuKCdbRk9SRUNBU1QgcmVjb10gbG9hZCBtdWx0aXBsaWVycyBmYWlsOicsIGUgJiYgZS5tZXNzYWdlKTtcclxuICAgIF9tdWx0aXBsaWVyT3ZlcnJpZGVzID0ge307XHJcbiAgfVxyXG59XHJcblxyXG5hc3luYyBmdW5jdGlvbiBfc2F2ZU11bHRpcGxpZXJPdmVycmlkZShza3VVcHBlciwgdmFsdWUpIHtcclxuICBpZiAoIXdpbmRvdy5mYkRiKSByZXR1cm47XHJcbiAgaWYgKCFfbXVsdGlwbGllck92ZXJyaWRlcykgX211bHRpcGxpZXJPdmVycmlkZXMgPSB7fTtcclxuICBjb25zdCB1aWQgPSAod2luZG93LmN1cnJlbnRVc2VyICYmIHdpbmRvdy5jdXJyZW50VXNlci5lbWFpbCkgfHwgJ3Vua25vd24nO1xyXG4gIF9tdWx0aXBsaWVyT3ZlcnJpZGVzW3NrdVVwcGVyXSA9IHtcclxuICAgIHZhbHVlOiBOdW1iZXIodmFsdWUpLFxyXG4gICAgdXBkYXRlZEF0OiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXHJcbiAgICB1cGRhdGVkQnk6IHVpZCxcclxuICB9O1xyXG4gIGF3YWl0IHdpbmRvdy5mYkRiLmNvbGxlY3Rpb24oJ2ZvcmVjYXN0X2NvbmZpZycpLmRvYygnbXVsdGlwbGllcnMnKS5zZXQoe1xyXG4gICAgc2t1T3ZlcnJpZGVzOiBfbXVsdGlwbGllck92ZXJyaWRlcyxcclxuICAgIHVwZGF0ZWRBdDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxyXG4gICAgdXBkYXRlZEJ5OiB1aWQsXHJcbiAgfSk7XHJcbn1cclxuXHJcbmFzeW5jIGZ1bmN0aW9uIF9yZW1vdmVNdWx0aXBsaWVyT3ZlcnJpZGUoc2t1VXBwZXIpIHtcclxuICBpZiAoIXdpbmRvdy5mYkRiIHx8ICFfbXVsdGlwbGllck92ZXJyaWRlcykgcmV0dXJuO1xyXG4gIGRlbGV0ZSBfbXVsdGlwbGllck92ZXJyaWRlc1tza3VVcHBlcl07XHJcbiAgY29uc3QgdWlkID0gKHdpbmRvdy5jdXJyZW50VXNlciAmJiB3aW5kb3cuY3VycmVudFVzZXIuZW1haWwpIHx8ICd1bmtub3duJztcclxuICBhd2FpdCB3aW5kb3cuZmJEYi5jb2xsZWN0aW9uKCdmb3JlY2FzdF9jb25maWcnKS5kb2MoJ211bHRpcGxpZXJzJykuc2V0KHtcclxuICAgIHNrdU92ZXJyaWRlczogX211bHRpcGxpZXJPdmVycmlkZXMsXHJcbiAgICB1cGRhdGVkQXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcclxuICAgIHVwZGF0ZWRCeTogdWlkLFxyXG4gIH0pO1xyXG59XHJcblxyXG4vLyBBdXRvIG11bHRpcGxpZXI6IHJlY2VudC9iYXNlbGluZSBjb24gY2FwLiBSZXRvcm5hIHt2YWx1ZSwgc291cmNlOiAnYXV0byd8J2ZhbGxiYWNrJ3wnZGVmYXVsdCcsIHJlY2VudCwgYmFzZWxpbmV9LlxyXG5mdW5jdGlvbiBfY29tcHV0ZU11bHRpcGxpZXJBdXRvKHNrdVVwcGVyKSB7XHJcbiAgY29uc3QgcmVjID0gX3JlY29WZW50YXNTbmFwc2hvdCAmJiBfcmVjb1ZlbnRhc1NuYXBzaG90W3NrdVVwcGVyXTtcclxuICBpZiAoIXJlYyB8fCAhcmVjLm1lc2VzKSByZXR1cm4geyB2YWx1ZTogMS4wLCBzb3VyY2U6ICdkZWZhdWx0JywgcmVjZW50OiAwLCBiYXNlbGluZTogMCB9O1xyXG4gIGNvbnN0IGhveSA9IG5ldyBEYXRlKCk7XHJcbiAgY29uc3QgbW9udGhzQmFja0tleSA9IChuKSA9PiB7XHJcbiAgICBjb25zdCBkID0gbmV3IERhdGUoaG95LmdldEZ1bGxZZWFyKCksIGhveS5nZXRNb250aCgpIC0gbiwgMSk7XHJcbiAgICByZXR1cm4gU3RyaW5nKGQuZ2V0RnVsbFllYXIoKSkgKyAnLScgKyBTdHJpbmcoZC5nZXRNb250aCgpICsgMSkucGFkU3RhcnQoMiwgJzAnKTtcclxuICB9O1xyXG4gIGNvbnN0IGNvbGxlY3RBdmcgPSAobikgPT4ge1xyXG4gICAgbGV0IHN1bSA9IDA7XHJcbiAgICBsZXQgY291bnQgPSAwO1xyXG4gICAgZm9yIChsZXQgaSA9IDE7IGkgPD0gbjsgaSsrKSB7XHJcbiAgICAgIGNvbnN0IGsgPSBtb250aHNCYWNrS2V5KGkpO1xyXG4gICAgICBjb25zdCBtID0gcmVjLm1lc2VzW2tdO1xyXG4gICAgICBpZiAobSAmJiBOdW1iZXIuaXNGaW5pdGUoTnVtYmVyKG0ucXR5KSkpIHtcclxuICAgICAgICBzdW0gKz0gTnVtYmVyKG0ucXR5KTtcclxuICAgICAgICBjb3VudCsrO1xyXG4gICAgICB9XHJcbiAgICB9XHJcbiAgICByZXR1cm4gY291bnQgPiAwID8geyBhdmc6IHN1bSAvIGNvdW50LCBuOiBjb3VudCB9IDogeyBhdmc6IDAsIG46IDAgfTtcclxuICB9O1xyXG4gIGNvbnN0IHJlYzIgPSBjb2xsZWN0QXZnKFJFQ09fTVVMVF9SRUNFTlRfTU9OVEhTKTtcclxuICBjb25zdCBiYXM2ID0gY29sbGVjdEF2ZyhSRUNPX01VTFRfQkFTRUxJTkVfTU9OVEhTKTtcclxuICAvLyBOZWNlc2l0YW1vcyBhbCBtZW5vcyAxIG1lcyByZWNpZW50ZSArIDMgbWVzZXMgYmFzZWxpbmUgcGFyYSBjYWxjdWxhciBhdXRvLlxyXG4gIGlmIChyZWMyLm4gPT09IDAgfHwgYmFzNi5uIDwgMyB8fCBiYXM2LmF2ZyA8IFJFQ09fTVVMVF9NSU5fQkFTRUxJTkUpIHtcclxuICAgIHJldHVybiB7IHZhbHVlOiAxLjAsIHNvdXJjZTogJ2RlZmF1bHQnLCByZWNlbnQ6IHJlYzIuYXZnLCBiYXNlbGluZTogYmFzNi5hdmcgfTtcclxuICB9XHJcbiAgbGV0IHJhdGlvID0gcmVjMi5hdmcgLyBiYXM2LmF2ZztcclxuICBpZiAocmF0aW8gPCBSRUNPX01VTFRfTUlOKSByYXRpbyA9IFJFQ09fTVVMVF9NSU47XHJcbiAgaWYgKHJhdGlvID4gUkVDT19NVUxUX01BWCkgcmF0aW8gPSBSRUNPX01VTFRfTUFYO1xyXG4gIHJldHVybiB7XHJcbiAgICB2YWx1ZTogTWF0aC5yb3VuZChyYXRpbyAqIDEwMCkgLyAxMDAsXHJcbiAgICBzb3VyY2U6ICdhdXRvJyxcclxuICAgIHJlY2VudDogTWF0aC5yb3VuZChyZWMyLmF2ZyAqIDEwKSAvIDEwLFxyXG4gICAgYmFzZWxpbmU6IE1hdGgucm91bmQoYmFzNi5hdmcgKiAxMCkgLyAxMCxcclxuICB9O1xyXG59XHJcblxyXG5mdW5jdGlvbiBfZ2V0RWZmZWN0aXZlTXVsdGlwbGllcihza3VVcHBlcikge1xyXG4gIC8vIE92ZXJyaWRlIG1hbnVhbCBnYW5hXHJcbiAgaWYgKF9tdWx0aXBsaWVyT3ZlcnJpZGVzICYmIF9tdWx0aXBsaWVyT3ZlcnJpZGVzW3NrdVVwcGVyXSkge1xyXG4gICAgcmV0dXJuIHtcclxuICAgICAgdmFsdWU6IE51bWJlcihfbXVsdGlwbGllck92ZXJyaWRlc1tza3VVcHBlcl0udmFsdWUpIHx8IDEuMCxcclxuICAgICAgc291cmNlOiAnbWFudWFsJyxcclxuICAgICAgYXV0bzogX2NvbXB1dGVNdWx0aXBsaWVyQXV0byhza3VVcHBlciksXHJcbiAgICB9O1xyXG4gIH1cclxuICBjb25zdCBhdXRvID0gX2NvbXB1dGVNdWx0aXBsaWVyQXV0byhza3VVcHBlcik7XHJcbiAgcmV0dXJuIHsgdmFsdWU6IGF1dG8udmFsdWUsIHNvdXJjZTogYXV0by5zb3VyY2UsIGF1dG8gfTtcclxufVxyXG5cclxuYXN5bmMgZnVuY3Rpb24gX2xvYWREaXNjb250aW51ZWRTa3VzKCkge1xyXG4gIGlmICghd2luZG93LmZiRGIpIHJldHVybjtcclxuICB0cnkge1xyXG4gICAgY29uc3QgZG9jID0gYXdhaXQgd2luZG93LmZiRGIuY29sbGVjdGlvbignZm9yZWNhc3RfY29uZmlnJykuZG9jKCdkaXNjb250aW51ZWRfc2t1cycpLmdldCgpO1xyXG4gICAgaWYgKGRvYy5leGlzdHMpIHtcclxuICAgICAgY29uc3QgZCA9IGRvYy5kYXRhKCkgfHwge307XHJcbiAgICAgIGNvbnN0IGFyciA9IEFycmF5LmlzQXJyYXkoZC5za3VzKSA/IGQuc2t1cyA6IFtdO1xyXG4gICAgICBfZGlzY29udGludWVkU2t1cyA9IG5ldyBTZXQoYXJyLm1hcCgocykgPT4gU3RyaW5nKHMpLnRyaW0oKS50b1VwcGVyQ2FzZSgpKSk7XHJcbiAgICAgIF9kaXNjb250aW51ZWRNZXRhID0geyB1cGRhdGVkQXQ6IGQudXBkYXRlZEF0LCB1cGRhdGVkQnk6IGQudXBkYXRlZEJ5IH07XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICBfZGlzY29udGludWVkU2t1cyA9IG5ldyBTZXQoKTtcclxuICAgICAgX2Rpc2NvbnRpbnVlZE1ldGEgPSBudWxsO1xyXG4gICAgfVxyXG4gIH0gY2F0Y2ggKGUpIHtcclxuICAgIGNvbnNvbGUud2FybignW0ZPUkVDQVNUIHJlY29dIGxvYWQgZGlzY29udGludWVkIGZhaWw6JywgZSAmJiBlLm1lc3NhZ2UpO1xyXG4gICAgX2Rpc2NvbnRpbnVlZFNrdXMgPSBuZXcgU2V0KCk7XHJcbiAgfVxyXG59XHJcblxyXG5hc3luYyBmdW5jdGlvbiBfc2F2ZURpc2NvbnRpbnVlZFNrdXMoKSB7XHJcbiAgaWYgKCF3aW5kb3cuZmJEYiB8fCAhX2Rpc2NvbnRpbnVlZFNrdXMpIHJldHVybjtcclxuICBjb25zdCB1aWQgPSAod2luZG93LmN1cnJlbnRVc2VyICYmIHdpbmRvdy5jdXJyZW50VXNlci5lbWFpbCkgfHwgJ3Vua25vd24nO1xyXG4gIGNvbnN0IHBheWxvYWQgPSB7XHJcbiAgICBza3VzOiBBcnJheS5mcm9tKF9kaXNjb250aW51ZWRTa3VzKS5zb3J0KCksXHJcbiAgICB1cGRhdGVkQXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcclxuICAgIHVwZGF0ZWRCeTogdWlkLFxyXG4gIH07XHJcbiAgYXdhaXQgd2luZG93LmZiRGIuY29sbGVjdGlvbignZm9yZWNhc3RfY29uZmlnJykuZG9jKCdkaXNjb250aW51ZWRfc2t1cycpLnNldChwYXlsb2FkKTtcclxuICBfZGlzY29udGludWVkTWV0YSA9IHsgdXBkYXRlZEF0OiBwYXlsb2FkLnVwZGF0ZWRBdCwgdXBkYXRlZEJ5OiBwYXlsb2FkLnVwZGF0ZWRCeSB9O1xyXG59XHJcblxyXG5hc3luYyBmdW5jdGlvbiBfbG9hZFJlY29EYXRhKCkge1xyXG4gIGlmICghd2luZG93LmZiRGIpIHRocm93IG5ldyBFcnJvcignRmlyZXN0b3JlIG5vIGluaWNpYWxpemFkbycpO1xyXG4gIGNvbnN0IHByb21pc2VzID0gW107XHJcbiAgaWYgKCFfZGlzY29udGludWVkU2t1cykgcHJvbWlzZXMucHVzaChfbG9hZERpc2NvbnRpbnVlZFNrdXMoKSk7XHJcbiAgaWYgKCFfbXVsdGlwbGllck92ZXJyaWRlcykgcHJvbWlzZXMucHVzaChfbG9hZE11bHRpcGxpZXJPdmVycmlkZXMoKSk7XHJcbiAgaWYgKCFfcmVjb1N0b2NrU25hcHNob3QpIHtcclxuICAgIHByb21pc2VzLnB1c2goXHJcbiAgICAgIHdpbmRvdy5mYkRiXHJcbiAgICAgICAgLmNvbGxlY3Rpb24oJ2FwcF9jb25maWcnKVxyXG4gICAgICAgIC5kb2MoJ3N0b2NrX3NuYXBzaG90JylcclxuICAgICAgICAuZ2V0KClcclxuICAgICAgICAudGhlbigoZCkgPT4ge1xyXG4gICAgICAgICAgY29uc3QgZGF0YSA9IGQuZXhpc3RzID8gZC5kYXRhKCkgOiB7fTtcclxuICAgICAgICAgIGxldCB3aCA9IHt9O1xyXG4gICAgICAgICAgbGV0IGJvID0ge307XHJcbiAgICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICB3aCA9IGRhdGEud2FyZWhvdXNlQnJlYWtkb3duID8gSlNPTi5wYXJzZShkYXRhLndhcmVob3VzZUJyZWFrZG93bikgOiB7fTtcclxuICAgICAgICAgIH0gY2F0Y2gge1xyXG4gICAgICAgICAgICB3aCA9IHt9O1xyXG4gICAgICAgICAgfVxyXG4gICAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgYm8gPSBkYXRhLmJhY2tvcmRlckJ5U2t1ID8gSlNPTi5wYXJzZShkYXRhLmJhY2tvcmRlckJ5U2t1KSA6IHt9O1xyXG4gICAgICAgICAgfSBjYXRjaCB7XHJcbiAgICAgICAgICAgIGJvID0ge307XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgICBfcmVjb1N0b2NrU25hcHNob3QgPSB7IHdhcmVob3VzZUJyZWFrZG93bjogd2gsIGJhY2tvcmRlckJ5U2t1OiBibyB9O1xyXG4gICAgICAgIH0pXHJcbiAgICApO1xyXG4gIH1cclxuICBpZiAoIV9yZWNvVmVudGFzU25hcHNob3QpIHtcclxuICAgIHByb21pc2VzLnB1c2goXHJcbiAgICAgIHdpbmRvdy5mYkRiXHJcbiAgICAgICAgLmNvbGxlY3Rpb24oJ3NrdV92ZW50YXNfc25hcHNob3QnKVxyXG4gICAgICAgIC5nZXQoKVxyXG4gICAgICAgIC50aGVuKChzbmFwKSA9PiB7XHJcbiAgICAgICAgICBjb25zdCBtYXAgPSB7fTtcclxuICAgICAgICAgIHNuYXAuZm9yRWFjaCgoZG9jKSA9PiB7XHJcbiAgICAgICAgICAgIGNvbnN0IGQgPSBkb2MuZGF0YSgpO1xyXG4gICAgICAgICAgICBpZiAoIWQgfHwgIWQuc2t1KSByZXR1cm47XHJcbiAgICAgICAgICAgIG1hcFtTdHJpbmcoZC5za3UpLnRyaW0oKS50b1VwcGVyQ2FzZSgpXSA9IHsgbWVzZXM6IGQubWVzZXMgfHwge30gfTtcclxuICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgX3JlY29WZW50YXNTbmFwc2hvdCA9IG1hcDtcclxuICAgICAgICB9KVxyXG4gICAgKTtcclxuICB9XHJcbiAgYXdhaXQgUHJvbWlzZS5hbGwocHJvbWlzZXMpO1xyXG59XHJcblxyXG5mdW5jdGlvbiBfY29tcHV0ZVZlbnRhTWVuc3VhbFByb21lZGlvKHNrdVVwcGVyKSB7XHJcbiAgLy8gUHJvbWVkaW8gZGUgbG9zIFx1MDBGQWx0aW1vcyBSRUNPX1ZFTlRBX1BST01FRElPX1dJTkRPVyBtZXNlcyBjZXJyYWRvc1xyXG4gIC8vIChleGNsdXllIGVsIG1lcyBhY3R1YWwgcGFyY2lhbCkuXHJcbiAgY29uc3QgcmVjID0gX3JlY29WZW50YXNTbmFwc2hvdCAmJiBfcmVjb1ZlbnRhc1NuYXBzaG90W3NrdVVwcGVyXTtcclxuICBpZiAoIXJlYyB8fCAhcmVjLm1lc2VzKSByZXR1cm4gMDtcclxuICBjb25zdCBob3kgPSBuZXcgRGF0ZSgpO1xyXG4gIGNvbnN0IG1vbnRoc0JhY2sgPSBbXTtcclxuICBmb3IgKGxldCBpID0gMTsgaSA8PSBSRUNPX1ZFTlRBX1BST01FRElPX1dJTkRPVzsgaSsrKSB7XHJcbiAgICBjb25zdCBkID0gbmV3IERhdGUoaG95LmdldEZ1bGxZZWFyKCksIGhveS5nZXRNb250aCgpIC0gaSwgMSk7XHJcbiAgICBtb250aHNCYWNrLnB1c2goU3RyaW5nKGQuZ2V0RnVsbFllYXIoKSkgKyAnLScgKyBTdHJpbmcoZC5nZXRNb250aCgpICsgMSkucGFkU3RhcnQoMiwgJzAnKSk7XHJcbiAgfVxyXG4gIGxldCBzdW0gPSAwO1xyXG4gIGxldCBuID0gMDtcclxuICBtb250aHNCYWNrLmZvckVhY2goKGspID0+IHtcclxuICAgIGNvbnN0IG0gPSByZWMubWVzZXNba107XHJcbiAgICBpZiAobSAmJiBOdW1iZXIuaXNGaW5pdGUoTnVtYmVyKG0ucXR5KSkpIHtcclxuICAgICAgc3VtICs9IE51bWJlcihtLnF0eSk7XHJcbiAgICAgIG4rKztcclxuICAgIH1cclxuICB9KTtcclxuICByZXR1cm4gbiA+IDAgPyBzdW0gLyBuIDogMDtcclxufVxyXG5cclxuZnVuY3Rpb24gX2NvbXB1dGVTYWxlc1BsYW5GdXR1cm8ocm93KSB7XHJcbiAgLy8gU3VtYSBsb3MgbWVzZXMgZGUgcm93Lm1vbnRocyBkZXNkZSBlbCBtZXMgYWN0dWFsIChpbmNsdXNpdmUpIGhhc3RhIGVsXHJcbiAgLy8gXHUwMEZBbHRpbW8gbWVzIGRlbCBzYWxlcyBwbGFuLiBMb3MgbWVzZXMgc29uICdZWVlZLU1NJy5cclxuICBpZiAoIXJvdyB8fCAhcm93Lm1vbnRocykgcmV0dXJuIDA7XHJcbiAgY29uc3QgaG95ID0gbmV3IERhdGUoKTtcclxuICBjb25zdCBjdXJyZW50S2V5ID0gU3RyaW5nKGhveS5nZXRGdWxsWWVhcigpKSArICctJyArIFN0cmluZyhob3kuZ2V0TW9udGgoKSArIDEpLnBhZFN0YXJ0KDIsICcwJyk7XHJcbiAgbGV0IHN1bSA9IDA7XHJcbiAgT2JqZWN0LmtleXMocm93Lm1vbnRocykuZm9yRWFjaCgoaykgPT4ge1xyXG4gICAgaWYgKGsgPj0gY3VycmVudEtleSkgc3VtICs9IE51bWJlcihyb3cubW9udGhzW2tdIHx8IDApO1xyXG4gIH0pO1xyXG4gIHJldHVybiBzdW07XHJcbn1cclxuXHJcbmZ1bmN0aW9uIF9jb21wdXRlUmVjb21tZW5kYXRpb25zKCkge1xyXG4gIC8vIENvbWJpbmEgUm9kcyArIFJlZWxzIHNhbGVzIHBsYW5zICsgc3RvY2sgKyBiYWNrb3JkZXIgKyB2ZW50YXMgcHJvbWVkaW8uXHJcbiAgLy8gUmV0b3JuYSBhcnJheSBkZSByb3dzIGNvbiB0b2RvcyBsb3MgY2FtcG9zICsgcmVjb21lbmRhZG8uXHJcbiAgY29uc3Qgcm93cyA9IFtdO1xyXG4gIGNvbnN0IGZhbWlsaWFzID0gWydyb2RzJywgJ3JlZWxzJ107XHJcbiAgZm9yIChjb25zdCBmYW0gb2YgZmFtaWxpYXMpIHtcclxuICAgIGNvbnN0IGNhY2hlID0gX3NhbGVzUGxhbkNhY2hlc1tmYW1dO1xyXG4gICAgaWYgKCFjYWNoZSB8fCAhY2FjaGUucm93cykgY29udGludWU7XHJcbiAgICBmb3IgKGNvbnN0IHNwUm93IG9mIGNhY2hlLnJvd3MpIHtcclxuICAgICAgY29uc3Qgc2t1ID0gU3RyaW5nKHNwUm93LnNrdSB8fCAnJykudHJpbSgpO1xyXG4gICAgICBjb25zdCBza3VVcHBlciA9IHNrdS50b1VwcGVyQ2FzZSgpO1xyXG4gICAgICAvLyB2MTExMjogc2tpcGVhbW9zIFNLVXMgZGVzY29udGludWFkb3MgKE1hcmlhbm8gbG9zIG1hcmNhIGRlc2RlIGxhIFVJKS5cclxuICAgICAgaWYgKF9kaXNjb250aW51ZWRTa3VzICYmIF9kaXNjb250aW51ZWRTa3VzLmhhcyhza3VVcHBlcikpIGNvbnRpbnVlO1xyXG4gICAgICBjb25zdCBzdG9ja1doID1cclxuICAgICAgICAoX3JlY29TdG9ja1NuYXBzaG90ICYmXHJcbiAgICAgICAgICBfcmVjb1N0b2NrU25hcHNob3Qud2FyZWhvdXNlQnJlYWtkb3duICYmXHJcbiAgICAgICAgICBfcmVjb1N0b2NrU25hcHNob3Qud2FyZWhvdXNlQnJlYWtkb3duW3NrdV0pIHx8XHJcbiAgICAgICAge307XHJcbiAgICAgIGNvbnN0IHN0b2NrTGlicmUgPSBOdW1iZXIoc3RvY2tXaFsnMTEnXSB8fCAwKTtcclxuICAgICAgY29uc3QgZW5UcmFuc2l0byA9IE51bWJlcihzdG9ja1doWycxMiddIHx8IDApO1xyXG4gICAgICBjb25zdCBiYWNrb3JkZXIgPSBOdW1iZXIoXHJcbiAgICAgICAgKF9yZWNvU3RvY2tTbmFwc2hvdCAmJlxyXG4gICAgICAgICAgX3JlY29TdG9ja1NuYXBzaG90LmJhY2tvcmRlckJ5U2t1ICYmXHJcbiAgICAgICAgICBfcmVjb1N0b2NrU25hcHNob3QuYmFja29yZGVyQnlTa3Vbc2t1XSkgfHxcclxuICAgICAgICAgIDBcclxuICAgICAgKTtcclxuICAgICAgY29uc3QgdmVudGFNZW5zdWFsID0gX2NvbXB1dGVWZW50YU1lbnN1YWxQcm9tZWRpbyhza3VVcHBlcik7XHJcbiAgICAgIGNvbnN0IHNhbGVzUGxhbkZ1dCA9IF9jb21wdXRlU2FsZXNQbGFuRnV0dXJvKHNwUm93KTtcclxuICAgICAgY29uc3QgbW9xID0gTnVtYmVyKHNwUm93Lm1vcSB8fCAwKTtcclxuICAgICAgLy8gdjExMTQgRjNCOiBtdWx0aXBsaWNhZG9yIGF1dG8gKHJlY2VudC9iYXNlbGluZSkgbyBvdmVycmlkZSBtYW51YWwuXHJcbiAgICAgIGNvbnN0IG11bHRJbmZvID0gX2dldEVmZmVjdGl2ZU11bHRpcGxpZXIoc2t1VXBwZXIpO1xyXG4gICAgICBjb25zdCBtdWx0aXBsaWVyID0gbXVsdEluZm8udmFsdWU7XHJcbiAgICAgIGNvbnN0IGRlbWFuZGFFc3BlcmFkYSA9IHZlbnRhTWVuc3VhbCAqIG11bHRpcGxpZXIgKiBSRUNPX0hPUklaT05fTU9OVEhTO1xyXG4gICAgICBjb25zdCBiYWxhbmNlID0gc3RvY2tMaWJyZSArIGVuVHJhbnNpdG8gKyBzYWxlc1BsYW5GdXQgLSBiYWNrb3JkZXIgLSBkZW1hbmRhRXNwZXJhZGE7XHJcbiAgICAgIGxldCByZWNvbWVuZGFkbyA9IDA7XHJcbiAgICAgIGlmIChiYWxhbmNlIDwgMCkge1xyXG4gICAgICAgIGNvbnN0IGRlZmljaXQgPSAtYmFsYW5jZTtcclxuICAgICAgICByZWNvbWVuZGFkbyA9IG1vcSA+IDAgPyBNYXRoLm1heChtb3EsIE1hdGguY2VpbChkZWZpY2l0IC8gbW9xKSAqIG1vcSkgOiBNYXRoLmNlaWwoZGVmaWNpdCk7XHJcbiAgICAgIH1cclxuICAgICAgcm93cy5wdXNoKHtcclxuICAgICAgICBmYW1pbGlhOiBmYW0sXHJcbiAgICAgICAgc2t1LFxyXG4gICAgICAgIGRlc2NyaXB0aW9uOiBzcFJvdy5kZXNjcmlwdGlvbiB8fCAnJyxcclxuICAgICAgICBtb3EsXHJcbiAgICAgICAgc3RvY2tMaWJyZSxcclxuICAgICAgICBlblRyYW5zaXRvLFxyXG4gICAgICAgIGJhY2tvcmRlcixcclxuICAgICAgICB2ZW50YU1lbnN1YWw6IE1hdGgucm91bmQodmVudGFNZW5zdWFsICogMTApIC8gMTAsXHJcbiAgICAgICAgc2FsZXNQbGFuRnV0LFxyXG4gICAgICAgIG11bHRpcGxpZXIsXHJcbiAgICAgICAgbXVsdFNvdXJjZTogbXVsdEluZm8uc291cmNlLCAvLyAnYXV0bycgfCAnbWFudWFsJyB8ICdkZWZhdWx0JyB8ICdmYWxsYmFjaydcclxuICAgICAgICBtdWx0QXV0bzogbXVsdEluZm8uYXV0byA/IG11bHRJbmZvLmF1dG8udmFsdWUgOiBudWxsLCAvLyBlbCB2YWxvciBhdXRvIHNpIGhheSBvdmVycmlkZSBtYW51YWxcclxuICAgICAgICBkZW1hbmRhRXNwZXJhZGE6IE1hdGgucm91bmQoZGVtYW5kYUVzcGVyYWRhICogMTApIC8gMTAsXHJcbiAgICAgICAgYmFsYW5jZTogTWF0aC5yb3VuZChiYWxhbmNlICogMTApIC8gMTAsXHJcbiAgICAgICAgcmVjb21lbmRhZG8sXHJcbiAgICAgIH0pO1xyXG4gICAgfVxyXG4gIH1cclxuICAvLyBPcmRlbmFyIHBvciByZWNvbWVuZGFkbyBkZXNjZW5kZW50ZVxyXG4gIHJvd3Muc29ydCgoYSwgYikgPT4gYi5yZWNvbWVuZGFkbyAtIGEucmVjb21lbmRhZG8pO1xyXG4gIHJldHVybiByb3dzO1xyXG59XHJcblxyXG5mdW5jdGlvbiBfZm10TnVtU2lnbmVkKG4pIHtcclxuICBpZiAobiA9PSBudWxsIHx8ICFOdW1iZXIuaXNGaW5pdGUoTnVtYmVyKG4pKSkgcmV0dXJuICdcdTIwMTQnO1xyXG4gIGNvbnN0IHYgPSBOdW1iZXIobik7XHJcbiAgY29uc3QgYWJzID0gTWF0aC5hYnModikudG9Mb2NhbGVTdHJpbmcoJ2VzLUFSJywgeyBtYXhpbXVtRnJhY3Rpb25EaWdpdHM6IDAgfSk7XHJcbiAgcmV0dXJuICh2IDwgMCA/ICdcdTIyMTInIDogJycpICsgYWJzO1xyXG59XHJcblxyXG5mdW5jdGlvbiBfZm10SW50KG4pIHtcclxuICBpZiAobiA9PSBudWxsIHx8ICFOdW1iZXIuaXNGaW5pdGUoTnVtYmVyKG4pKSkgcmV0dXJuICdcdTIwMTQnO1xyXG4gIHJldHVybiBNYXRoLnJvdW5kKE51bWJlcihuKSkudG9Mb2NhbGVTdHJpbmcoJ2VzLUFSJyk7XHJcbn1cclxuXHJcbi8vIHYxMTE0IEYzQjogY2VsZGEgbXVsdGlwbGljYWRvciBjb24gY2hpcCBhdXRvL21hbnVhbCArIGlucHV0IGVkaXRhYmxlLlxyXG5mdW5jdGlvbiBfYnVpbGRNdWx0Q2VsbEh0bWwocikge1xyXG4gIGNvbnN0IHNrdVVwcGVyID0gU3RyaW5nKHIuc2t1KS50cmltKCkudG9VcHBlckNhc2UoKTtcclxuICBjb25zdCBpc01hbnVhbCA9IHIubXVsdFNvdXJjZSA9PT0gJ21hbnVhbCc7XHJcbiAgY29uc3QgaXNEZWZhdWx0ID0gci5tdWx0U291cmNlID09PSAnZGVmYXVsdCc7XHJcbiAgY29uc3QgdmFsID0gTnVtYmVyKHIubXVsdGlwbGllciB8fCAxLjApLnRvRml4ZWQoMik7XHJcbiAgLy8gQ29sb3IgcG9yIGRpcmVjY2lcdTAwRjNuOiA+MS4wNSB2ZXJkZSAoY3JlY2llbmRvKSwgPDAuOTUgcm9qbyAoY2F5ZW5kbyksIG1lZGlvIGdyaXMuXHJcbiAgbGV0IGRpckNvbG9yID0gJ3ZhcigtLXRleHQtbXV0ZWQpJztcclxuICBpZiAoci5tdWx0aXBsaWVyID4gMS4wNSkgZGlyQ29sb3IgPSAnIzE2YTM0YSc7XHJcbiAgZWxzZSBpZiAoci5tdWx0aXBsaWVyIDwgMC45NSkgZGlyQ29sb3IgPSAnI2RjMjYyNic7XHJcblxyXG4gIGNvbnN0IGNoaXAgPSBpc01hbnVhbFxyXG4gICAgPyAnPHNwYW4gc3R5bGU9XCJkaXNwbGF5OmlubGluZS1ibG9jaztwYWRkaW5nOjFweCA1cHg7YmFja2dyb3VuZDojZjU5ZTBiO2NvbG9yOiNmZmY7Ym9yZGVyLXJhZGl1czo4cHg7Zm9udC1zaXplOjlweDtmb250LXdlaWdodDo3MDA7bWFyZ2luLWxlZnQ6NHB4XCIgdGl0bGU9XCJPdmVycmlkZSBtYW51YWw6IHBpc2EgZWwgYXV0b1wiPk08L3NwYW4+J1xyXG4gICAgOiBpc0RlZmF1bHRcclxuICAgICAgPyAnPHNwYW4gc3R5bGU9XCJkaXNwbGF5OmlubGluZS1ibG9jaztwYWRkaW5nOjFweCA1cHg7YmFja2dyb3VuZDojOTRhM2I4O2NvbG9yOiNmZmY7Ym9yZGVyLXJhZGl1czo4cHg7Zm9udC1zaXplOjlweDtmb250LXdlaWdodDo3MDA7bWFyZ2luLWxlZnQ6NHB4XCIgdGl0bGU9XCJTaW4gZGF0b3Mgc3VmaWNpZW50ZXM6IHVzYSAxLjBcIj5cdTAwQjc8L3NwYW4+J1xyXG4gICAgICA6ICc8c3BhbiBzdHlsZT1cImRpc3BsYXk6aW5saW5lLWJsb2NrO3BhZGRpbmc6MXB4IDVweDtiYWNrZ3JvdW5kOiMwZDk0ODg7Y29sb3I6I2ZmZjtib3JkZXItcmFkaXVzOjhweDtmb250LXNpemU6OXB4O2ZvbnQtd2VpZ2h0OjcwMDttYXJnaW4tbGVmdDo0cHhcIiB0aXRsZT1cIkF1dG8gPSB2ZW50YSAybSAvIHZlbnRhIDZtXCI+QTwvc3Bhbj4nO1xyXG5cclxuICBjb25zdCByZXNldEJ0biA9IGlzTWFudWFsXHJcbiAgICA/ICc8YnV0dG9uIG9uY2xpY2s9XCJyZXNldE11bHRpcGxpZXIoXFwnJyArXHJcbiAgICAgIGVzY2FwZUh0bWxTYWZlKHNrdVVwcGVyKSArXHJcbiAgICAgICdcXCcpXCIgdGl0bGU9XCJWb2x2ZXIgYWwgYXV0b1wiIHN0eWxlPVwibWFyZ2luLWxlZnQ6NHB4O2JhY2tncm91bmQ6dHJhbnNwYXJlbnQ7Ym9yZGVyOm5vbmU7Y3Vyc29yOnBvaW50ZXI7Zm9udC1zaXplOjEycHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7cGFkZGluZzowXCI+XHUyMUJCPC9idXR0b24+J1xyXG4gICAgOiAnJztcclxuXHJcbiAgY29uc3QgYXV0b0hpbnQgPVxyXG4gICAgaXNNYW51YWwgJiYgci5tdWx0QXV0byAhPSBudWxsXHJcbiAgICAgID8gJyA8c3BhbiBzdHlsZT1cImZvbnQtc2l6ZToxMHB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpXCIgdGl0bGU9XCJWYWxvciBhdXRvIGNhbGN1bGFkb1wiPihhdXRvICcgK1xyXG4gICAgICAgIE51bWJlcihyLm11bHRBdXRvKS50b0ZpeGVkKDIpICtcclxuICAgICAgICAnKTwvc3Bhbj4nXHJcbiAgICAgIDogJyc7XHJcblxyXG4gIHJldHVybiAoXHJcbiAgICAnPHNwYW4gc3R5bGU9XCJkaXNwbGF5OmlubGluZS1mbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtnYXA6MnB4XCI+JyArXHJcbiAgICAnPHNwYW4gb25jbGljaz1cImVkaXRNdWx0aXBsaWVyKHRoaXMsIFxcJycgK1xyXG4gICAgZXNjYXBlSHRtbFNhZmUoc2t1VXBwZXIpICtcclxuICAgICdcXCcpXCIgc3R5bGU9XCJjdXJzb3I6cG9pbnRlcjtwYWRkaW5nOjJweCA2cHg7Ym9yZGVyLXJhZGl1czo0cHg7YmFja2dyb3VuZDp2YXIoLS1iZy1zZWNvbmRhcnkpO2ZvbnQtdmFyaWFudC1udW1lcmljOnRhYnVsYXItbnVtcztmb250LXdlaWdodDo3MDA7Y29sb3I6JyArXHJcbiAgICBkaXJDb2xvciArXHJcbiAgICAnXCIgdGl0bGU9XCJDbGljayBwYXJhIGVkaXRhclwiPicgK1xyXG4gICAgdmFsICtcclxuICAgICc8L3NwYW4+JyArXHJcbiAgICBjaGlwICtcclxuICAgIHJlc2V0QnRuICtcclxuICAgIGF1dG9IaW50ICtcclxuICAgICc8L3NwYW4+J1xyXG4gICk7XHJcbn1cclxuXHJcbndpbmRvdy5lZGl0TXVsdGlwbGllciA9IGZ1bmN0aW9uIChlbCwgc2t1VXBwZXIpIHtcclxuICBjb25zdCBjdXJyZW50VmFsID0gcGFyc2VGbG9hdChlbC50ZXh0Q29udGVudCkgfHwgMS4wO1xyXG4gIGNvbnN0IGlucHV0ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnaW5wdXQnKTtcclxuICBpbnB1dC50eXBlID0gJ251bWJlcic7XHJcbiAgaW5wdXQuc3RlcCA9ICcwLjA1JztcclxuICBpbnB1dC5taW4gPSAnMC4xJztcclxuICBpbnB1dC5tYXggPSAnNSc7XHJcbiAgaW5wdXQudmFsdWUgPSBTdHJpbmcoY3VycmVudFZhbCk7XHJcbiAgaW5wdXQuc3R5bGUuY3NzVGV4dCA9XHJcbiAgICAnd2lkdGg6NjBweDtwYWRkaW5nOjJweCA0cHg7Zm9udC1zaXplOjEycHg7Zm9udC13ZWlnaHQ6NzAwO3RleHQtYWxpZ246Y2VudGVyO2JvcmRlcjoycHggc29saWQgIzBkOTQ4ODtib3JkZXItcmFkaXVzOjRweDtiYWNrZ3JvdW5kOnZhcigtLWJnLWVsZXZhdGVkKTtjb2xvcjp2YXIoLS10ZXh0LXByaW1hcnkpO2ZvbnQtdmFyaWFudC1udW1lcmljOnRhYnVsYXItbnVtcyc7XHJcbiAgY29uc3QgcGFyZW50ID0gZWwucGFyZW50Tm9kZTtcclxuICBwYXJlbnQucmVwbGFjZUNoaWxkKGlucHV0LCBlbCk7XHJcbiAgaW5wdXQuZm9jdXMoKTtcclxuICBpbnB1dC5zZWxlY3QoKTtcclxuXHJcbiAgY29uc3QgY29tbWl0ID0gYXN5bmMgKCkgPT4ge1xyXG4gICAgY29uc3QgdiA9IHBhcnNlRmxvYXQoaW5wdXQudmFsdWUpO1xyXG4gICAgaWYgKE51bWJlci5pc05hTih2KSB8fCB2IDwgMC4xIHx8IHYgPiA1KSB7XHJcbiAgICAgIF9yZW5kZXJSZWNvU2VjdGlvbigpO1xyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcbiAgICBpZiAoTWF0aC5hYnModiAtIGN1cnJlbnRWYWwpIDwgMC4wMDEpIHtcclxuICAgICAgX3JlbmRlclJlY29TZWN0aW9uKCk7XHJcbiAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIHRyeSB7XHJcbiAgICAgIGF3YWl0IF9zYXZlTXVsdGlwbGllck92ZXJyaWRlKHNrdVVwcGVyLCB2KTtcclxuICAgICAgX3JlbmRlclJlY29TZWN0aW9uKCk7XHJcbiAgICB9IGNhdGNoIChlKSB7XHJcbiAgICAgIGFsZXJ0KCdFcnJvciBndWFyZGFuZG86ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcclxuICAgICAgX3JlbmRlclJlY29TZWN0aW9uKCk7XHJcbiAgICB9XHJcbiAgfTtcclxuXHJcbiAgY29uc3QgY2FuY2VsID0gKCkgPT4gX3JlbmRlclJlY29TZWN0aW9uKCk7XHJcblxyXG4gIGlucHV0LmFkZEV2ZW50TGlzdGVuZXIoJ2JsdXInLCBjb21taXQpO1xyXG4gIGlucHV0LmFkZEV2ZW50TGlzdGVuZXIoJ2tleWRvd24nLCAoZXYpID0+IHtcclxuICAgIGlmIChldi5rZXkgPT09ICdFbnRlcicpIHtcclxuICAgICAgZXYucHJldmVudERlZmF1bHQoKTtcclxuICAgICAgaW5wdXQuYmx1cigpO1xyXG4gICAgfSBlbHNlIGlmIChldi5rZXkgPT09ICdFc2NhcGUnKSB7XHJcbiAgICAgIGV2LnByZXZlbnREZWZhdWx0KCk7XHJcbiAgICAgIGNhbmNlbCgpO1xyXG4gICAgfVxyXG4gIH0pO1xyXG59O1xyXG5cclxud2luZG93LnJlc2V0TXVsdGlwbGllciA9IGFzeW5jIGZ1bmN0aW9uIChza3VVcHBlcikge1xyXG4gIGlmICghY29uZmlybSgnVm9sdmVyIGVsIG11bHRpcGxpY2Fkb3IgZGUgJyArIHNrdVVwcGVyICsgJyBhbCBjXHUwMEUxbGN1bG8gYXV0b21cdTAwRTF0aWNvPycpKSByZXR1cm47XHJcbiAgdHJ5IHtcclxuICAgIGF3YWl0IF9yZW1vdmVNdWx0aXBsaWVyT3ZlcnJpZGUoc2t1VXBwZXIpO1xyXG4gICAgX3JlbmRlclJlY29TZWN0aW9uKCk7XHJcbiAgfSBjYXRjaCAoZSkge1xyXG4gICAgYWxlcnQoJ0Vycm9yOiAnICsgKGUubWVzc2FnZSB8fCBlKSk7XHJcbiAgfVxyXG59O1xyXG5cclxuZnVuY3Rpb24gX3JlbmRlclJlY29TZWN0aW9uKCkge1xyXG4gIGNvbnN0IGNvbnQgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgncmVjby1zZWN0aW9uLWNvbnRhaW5lcicpO1xyXG4gIGlmICghY29udCkgcmV0dXJuO1xyXG4gIHRyeSB7XHJcbiAgICBfcmVuZGVyUmVjb1NlY3Rpb25JbXBsKGNvbnQpO1xyXG4gIH0gY2F0Y2ggKGUpIHtcclxuICAgIGNvbnNvbGUuZXJyb3IoJ1tGT1JFQ0FTVCByZWNvXSByZW5kZXIgZmFpbCcsIGUpO1xyXG4gICAgY29udC5pbm5lckhUTUwgPVxyXG4gICAgICAnPGRpdiBzdHlsZT1cInBhZGRpbmc6MjBweDtjb2xvcjojZGMyNjI2XCI+JyArXHJcbiAgICAgICc8ZGl2IHN0eWxlPVwiZm9udC13ZWlnaHQ6NzAwO21hcmdpbi1ib3R0b206OHB4XCI+RXJyb3IgcmVuZGVyaXphbmRvIHRhYmxhIHJlY29tZW5kYWNpXHUwMEYzbjwvZGl2PicgK1xyXG4gICAgICAnPHByZSBzdHlsZT1cImZvbnQtc2l6ZToxMXB4O2JhY2tncm91bmQ6I2ZlZjJmMjtwYWRkaW5nOjEwcHg7Ym9yZGVyLXJhZGl1czo2cHg7b3ZlcmZsb3c6YXV0bzt3aGl0ZS1zcGFjZTpwcmUtd3JhcFwiPicgK1xyXG4gICAgICBlc2NhcGVIdG1sU2FmZShlLnN0YWNrIHx8IGUubWVzc2FnZSB8fCBTdHJpbmcoZSkpICtcclxuICAgICAgJzwvcHJlPjwvZGl2Pic7XHJcbiAgfVxyXG59XHJcblxyXG5mdW5jdGlvbiBfcmVuZGVyUmVjb1NlY3Rpb25JbXBsKGNvbnQpIHtcclxuICBjb25zdCBhbnlMb2FkZWQgPSAhIShfc2FsZXNQbGFuQ2FjaGVzLnJvZHMgfHwgX3NhbGVzUGxhbkNhY2hlcy5yZWVscyk7XHJcbiAgaWYgKCFhbnlMb2FkZWQpIHtcclxuICAgIGNvbnQuaW5uZXJIVE1MID0gJyc7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIGlmICghX3JlY29TdG9ja1NuYXBzaG90IHx8ICFfcmVjb1ZlbnRhc1NuYXBzaG90KSB7XHJcbiAgICBjb250LmlubmVySFRNTCA9XHJcbiAgICAgICc8ZGl2IHN0eWxlPVwicGFkZGluZzo0MHB4IDE4cHg7dGV4dC1hbGlnbjpjZW50ZXI7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZClcIj4nICtcclxuICAgICAgJzxkaXYgc3R5bGU9XCJkaXNwbGF5OmlubGluZS1ibG9jazt3aWR0aDoyNHB4O2hlaWdodDoyNHB4O2JvcmRlcjozcHggc29saWQgIzBkOTQ4ODtib3JkZXItdG9wLWNvbG9yOnRyYW5zcGFyZW50O2JvcmRlci1yYWRpdXM6NTAlO2FuaW1hdGlvbjpzcGluIDAuOHMgbGluZWFyIGluZmluaXRlO21hcmdpbi1ib3R0b206MTBweFwiPjwvZGl2PicgK1xyXG4gICAgICAnPGRpdj5DYXJnYW5kbyBzdG9jayArIHZlbnRhcyBoaXN0XHUwMEYzcmljYXMuLi48L2Rpdj4nICtcclxuICAgICAgJzxzdHlsZT5Aa2V5ZnJhbWVzIHNwaW57dG97dHJhbnNmb3JtOnJvdGF0ZSgzNjBkZWcpfX08L3N0eWxlPjwvZGl2Pic7XHJcbiAgICBfbG9hZFJlY29EYXRhKClcclxuICAgICAgLnRoZW4oX3JlbmRlclJlY29TZWN0aW9uKVxyXG4gICAgICAuY2F0Y2goKGUpID0+IHtcclxuICAgICAgICBjb25zb2xlLmVycm9yKCdbRk9SRUNBU1QgcmVjb10gbG9hZCBmYWlsJywgZSk7XHJcbiAgICAgICAgY29udC5pbm5lckhUTUwgPVxyXG4gICAgICAgICAgJzxkaXYgc3R5bGU9XCJwYWRkaW5nOjIwcHg7Y29sb3I6I2RjMjYyNlwiPkVycm9yIGNhcmdhbmRvIGRhdG9zOiAnICtcclxuICAgICAgICAgIGVzY2FwZUh0bWxTYWZlKGUubWVzc2FnZSB8fCBTdHJpbmcoZSkpICtcclxuICAgICAgICAgICc8L2Rpdj4nO1xyXG4gICAgICB9KTtcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgY29uc3QgYWxsUm93cyA9IF9jb21wdXRlUmVjb21tZW5kYXRpb25zKCk7XHJcbiAgY29uc3Qgc2VhcmNoTGMgPSBfcmVjb1NlYXJjaFRleHQudHJpbSgpLnRvTG93ZXJDYXNlKCk7XHJcbiAgY29uc3Qgcm93cyA9IGFsbFJvd3MuZmlsdGVyKChyKSA9PiB7XHJcbiAgICBpZiAoX3JlY29GaWx0ZXJGYW1pbGlhICE9PSAnYWxsJyAmJiByLmZhbWlsaWEgIT09IF9yZWNvRmlsdGVyRmFtaWxpYSkgcmV0dXJuIGZhbHNlO1xyXG4gICAgaWYgKF9yZWNvRmlsdGVyTWluUmVjICYmIHIucmVjb21lbmRhZG8gPD0gMCkgcmV0dXJuIGZhbHNlO1xyXG4gICAgaWYgKHNlYXJjaExjKSB7XHJcbiAgICAgIGNvbnN0IGhheSA9XHJcbiAgICAgICAgci5za3UudG9Mb3dlckNhc2UoKS5pbmNsdWRlcyhzZWFyY2hMYykgfHwgci5kZXNjcmlwdGlvbi50b0xvd2VyQ2FzZSgpLmluY2x1ZGVzKHNlYXJjaExjKTtcclxuICAgICAgaWYgKCFoYXkpIHJldHVybiBmYWxzZTtcclxuICAgIH1cclxuICAgIHJldHVybiB0cnVlO1xyXG4gIH0pO1xyXG4gIGNvbnN0IHRvdGFsUmVjbyA9IGFsbFJvd3MucmVkdWNlKChzLCByKSA9PiBzICsgci5yZWNvbWVuZGFkbywgMCk7XHJcbiAgY29uc3QgdG90YWxDb25SZWNvID0gYWxsUm93cy5maWx0ZXIoKHIpID0+IHIucmVjb21lbmRhZG8gPiAwKS5sZW5ndGg7XHJcblxyXG4gIGNvbnN0IG5EaXNjID0gX2Rpc2NvbnRpbnVlZFNrdXMgPyBfZGlzY29udGludWVkU2t1cy5zaXplIDogMDtcclxuICBjb25zdCBkaXNjQ2hpcCA9XHJcbiAgICBuRGlzYyA+IDBcclxuICAgICAgPyAnPGJ1dHRvbiBvbmNsaWNrPVwib3BlbkRpc2NvbnRpbnVlZE1vZGFsKClcIiBzdHlsZT1cInBhZGRpbmc6NnB4IDEycHg7YmFja2dyb3VuZDojOTMzM2VhO2NvbG9yOiNmZmY7Ym9yZGVyOm5vbmU7Ym9yZGVyLXJhZGl1czo2cHg7Zm9udC1zaXplOjEycHg7Zm9udC13ZWlnaHQ6NzAwO2N1cnNvcjpwb2ludGVyXCIgdGl0bGU9XCJHZXN0aW9uYXIgU0tVcyBkZXNjb250aW51YWRvc1wiPlx1RDgzRFx1REVBQiAnICtcclxuICAgICAgICBfZm10SW50KG5EaXNjKSArXHJcbiAgICAgICAgJyBkZXNjb250aW51YWRvczwvYnV0dG9uPidcclxuICAgICAgOiAnJztcclxuICAvLyB2MTM1NSAoMjAyNi0xMC0xOSk6IGJvdG9uIFwiUHJveGltYXMgZGVzY29udGludWFjaW9uZXNcIiBwYXJhIG1hcmNhciBlbiBidWxrXHJcbiAgLy8gbG9zIFNLVXMgcXVlIHNlIHZhbiBhIGRlc2NvbnRpbnVhciBlbiBwcm94aW1vcyBtZXNlcy4gTWlzbW8gZWZlY3RvIGVuXHJcbiAgLy8gZm9yZWNhc3QgcXVlIGRlc2NvbnRpbnVhciAoc2tpcGVhIGVuIF9jb21wdXRlUmVjb21tZW5kYXRpb25zKSBwZXJvIFVYXHJcbiAgLy8gYnVsay1tYXJraW5nIGNvbiBjaGVja2JveGVzIHZzIGZpbGEtcG9yLWZpbGEgY29uIFx1RDgzRFx1REREMS4gUGVkaWRvIE1hcmlhbm8uXHJcbiAgY29uc3QgdXBjb21pbmdCdG4gPVxyXG4gICAgJzxidXR0b24gb25jbGljaz1cIm9wZW5VcGNvbWluZ0Rpc2NvbnRpbnVlZE1vZGFsKClcIiBzdHlsZT1cInBhZGRpbmc6NnB4IDEycHg7YmFja2dyb3VuZDojMjU2M2ViO2NvbG9yOiNmZmY7Ym9yZGVyOm5vbmU7Ym9yZGVyLXJhZGl1czo2cHg7Zm9udC1zaXplOjEycHg7Zm9udC13ZWlnaHQ6NzAwO2N1cnNvcjpwb2ludGVyXCIgdGl0bGU9XCJNYXJjYXIgZW4gYnVsayBTS1VzIHF1ZSBzZSB2YW4gYSBkZXNjb250aW51YXJcIj5cdUQ4M0RcdURDQ0IgUHJcdTAwRjN4aW1hcyBkZXNjb250aW51YWNpb25lczwvYnV0dG9uPic7XHJcblxyXG4gIGNvbnN0IGhlYWRlciA9XHJcbiAgICAnPGRpdiBzdHlsZT1cImRpc3BsYXk6ZmxleDtmbGV4LXdyYXA6d3JhcDtnYXA6MTBweDthbGlnbi1pdGVtczpjZW50ZXI7bWFyZ2luLWJvdHRvbToxMnB4XCI+JyArXHJcbiAgICAnPGRpdiBzdHlsZT1cImZsZXg6MTttaW4td2lkdGg6MjgwcHhcIj48ZGl2IHN0eWxlPVwiZm9udC1zaXplOjE4cHg7Zm9udC13ZWlnaHQ6ODAwO2NvbG9yOnZhcigtLXRleHQtcHJpbWFyeSlcIj5SZWNvbWVuZGFjaVx1MDBGM24gZGUgQ29tcHJhPC9kaXY+JyArXHJcbiAgICAnPGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMXB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO21hcmdpbi10b3A6MnB4XCI+QmFsYW5jZSA9IFN0b2NrICsgVHJcdTAwRTFuc2l0byArIFBsYW4gXHUyMjEyIEJhY2tvcmRlciBcdTIyMTIgKFZlbnRhIG1lbnMuIFx1MDBENyAnICtcclxuICAgIFJFQ09fSE9SSVpPTl9NT05USFMgK1xyXG4gICAgJ20pPC9kaXY+PC9kaXY+JyArXHJcbiAgICB1cGNvbWluZ0J0biArXHJcbiAgICAnPGRpdiBzdHlsZT1cInBhZGRpbmc6NnB4IDEycHg7YmFja2dyb3VuZDojMGQ5NDg4O2NvbG9yOiNmZmY7Ym9yZGVyLXJhZGl1czo2cHg7Zm9udC1zaXplOjEycHg7Zm9udC13ZWlnaHQ6NzAwXCI+JyArXHJcbiAgICBfZm10SW50KHRvdGFsQ29uUmVjbykgK1xyXG4gICAgJyBTS1VzIGNvbiByZWNvPC9kaXY+JyArXHJcbiAgICAnPGRpdiBzdHlsZT1cInBhZGRpbmc6NnB4IDEycHg7YmFja2dyb3VuZDojMTM0ZTRhO2NvbG9yOiNmZmY7Ym9yZGVyLXJhZGl1czo2cHg7Zm9udC1zaXplOjEycHg7Zm9udC13ZWlnaHQ6NzAwXCI+XHUwM0EzICcgK1xyXG4gICAgX2ZtdEludCh0b3RhbFJlY28pICtcclxuICAgICcgdW5pZGFkZXM8L2Rpdj4nICtcclxuICAgIGRpc2NDaGlwICtcclxuICAgICc8L2Rpdj4nO1xyXG5cclxuICBjb25zdCBmaWx0ZXJzID1cclxuICAgICc8ZGl2IHN0eWxlPVwiZGlzcGxheTpmbGV4O2ZsZXgtd3JhcDp3cmFwO2dhcDo4cHg7bWFyZ2luLWJvdHRvbToxMHB4O3BhZGRpbmc6MTBweDtiYWNrZ3JvdW5kOnZhcigtLWJnLXNlY29uZGFyeSk7Ym9yZGVyLXJhZGl1czo2cHhcIj4nICtcclxuICAgICc8aW5wdXQgdHlwZT1cInRleHRcIiBpZD1cInJlY28tc2VhcmNoXCIgcGxhY2Vob2xkZXI9XCJCdXNjYXIgU0tVIG8gZGVzY3JpcGNpb24uLi5cIiB2YWx1ZT1cIicgK1xyXG4gICAgZXNjYXBlSHRtbFNhZmUoX3JlY29TZWFyY2hUZXh0KSArXHJcbiAgICAnXCIgb25pbnB1dD1cIm9uUmVjb1NlYXJjaENoYW5nZShldmVudClcIiBzdHlsZT1cImZsZXg6MTttaW4td2lkdGg6MjAwcHg7cGFkZGluZzo2cHggMTBweDtib3JkZXI6MXB4IHNvbGlkIHZhcigtLWJvcmRlci1zdWJ0bGUpO2JvcmRlci1yYWRpdXM6NHB4O2ZvbnQtc2l6ZToxMnB4O2JhY2tncm91bmQ6dmFyKC0tYmctZWxldmF0ZWQpO2NvbG9yOnZhcigtLXRleHQtcHJpbWFyeSlcIi8+JyArXHJcbiAgICAnPHNlbGVjdCBvbmNoYW5nZT1cIm9uUmVjb0ZhbWlsaWFDaGFuZ2UoZXZlbnQpXCIgc3R5bGU9XCJwYWRkaW5nOjZweCAxMHB4O2JvcmRlcjoxcHggc29saWQgdmFyKC0tYm9yZGVyLXN1YnRsZSk7Ym9yZGVyLXJhZGl1czo0cHg7Zm9udC1zaXplOjEycHg7YmFja2dyb3VuZDp2YXIoLS1iZy1lbGV2YXRlZCk7Y29sb3I6dmFyKC0tdGV4dC1wcmltYXJ5KVwiPicgK1xyXG4gICAgJzxvcHRpb24gdmFsdWU9XCJhbGxcIicgK1xyXG4gICAgKF9yZWNvRmlsdGVyRmFtaWxpYSA9PT0gJ2FsbCcgPyAnIHNlbGVjdGVkJyA6ICcnKSArXHJcbiAgICAnPlRvZGFzIGxhcyBmYW1pbGlhczwvb3B0aW9uPicgK1xyXG4gICAgJzxvcHRpb24gdmFsdWU9XCJyb2RzXCInICtcclxuICAgIChfcmVjb0ZpbHRlckZhbWlsaWEgPT09ICdyb2RzJyA/ICcgc2VsZWN0ZWQnIDogJycpICtcclxuICAgICc+U29sbyBSb2RzIChDYVx1MDBGMWFzKTwvb3B0aW9uPicgK1xyXG4gICAgJzxvcHRpb24gdmFsdWU9XCJyZWVsc1wiJyArXHJcbiAgICAoX3JlY29GaWx0ZXJGYW1pbGlhID09PSAncmVlbHMnID8gJyBzZWxlY3RlZCcgOiAnJykgK1xyXG4gICAgJz5Tb2xvIFJlZWxzPC9vcHRpb24+JyArXHJcbiAgICAnPC9zZWxlY3Q+JyArXHJcbiAgICAnPGxhYmVsIHN0eWxlPVwiZGlzcGxheTppbmxpbmUtZmxleDthbGlnbi1pdGVtczpjZW50ZXI7Z2FwOjZweDtwYWRkaW5nOjZweCAxMHB4O2ZvbnQtc2l6ZToxMnB4O2NvbG9yOnZhcigtLXRleHQtcHJpbWFyeSk7Y3Vyc29yOnBvaW50ZXJcIj4nICtcclxuICAgICc8aW5wdXQgdHlwZT1cImNoZWNrYm94XCInICtcclxuICAgIChfcmVjb0ZpbHRlck1pblJlYyA/ICcgY2hlY2tlZCcgOiAnJykgK1xyXG4gICAgJyBvbmNoYW5nZT1cIm9uUmVjb0ZpbHRlck1pbkNoYW5nZShldmVudClcIi8+JyArXHJcbiAgICAnU29sbyBjb24gcmVjb21lbmRhZG8gJmd0OyAwPC9sYWJlbD4nICtcclxuICAgICc8YnV0dG9uIG9uY2xpY2s9XCJleHBvcnRSZWNvRXhjZWwoKVwiIHN0eWxlPVwicGFkZGluZzo2cHggMTJweDtiYWNrZ3JvdW5kOiMxNmEzNGE7Y29sb3I6I2ZmZjtib3JkZXI6bm9uZTtib3JkZXItcmFkaXVzOjRweDtmb250LXNpemU6MTJweDtmb250LXdlaWdodDo3MDA7Y3Vyc29yOnBvaW50ZXJcIj5cdTJCMDcgRXhjZWw8L2J1dHRvbj4nICtcclxuICAgICc8L2Rpdj4nO1xyXG5cclxuICBjb25zdCByb3dzSHRtbCA9IHJvd3NcclxuICAgIC5tYXAoKHIpID0+IHtcclxuICAgICAgY29uc3QgYmFsQ29sb3IgPSByLmJhbGFuY2UgPCAwID8gJyNkYzI2MjYnIDogci5iYWxhbmNlIDwgNTAgPyAnI2Y1OWUwYicgOiAnIzE2YTM0YSc7XHJcbiAgICAgIGNvbnN0IHJlY0NvbG9yID0gci5yZWNvbWVuZGFkbyA+IDAgPyAnI2RjMjYyNicgOiAnIzk0YTNiOCc7XHJcbiAgICAgIHJldHVybiAoXHJcbiAgICAgICAgJzx0ciBzdHlsZT1cImJvcmRlci1ib3R0b206MXB4IHNvbGlkIHZhcigtLWJvcmRlci1zdWJ0bGUpXCI+JyArXHJcbiAgICAgICAgJzx0ZCBzdHlsZT1cInBhZGRpbmc6NnB4IDhweDt0ZXh0LWFsaWduOmNlbnRlclwiPjxzcGFuIHN0eWxlPVwiZGlzcGxheTppbmxpbmUtYmxvY2s7cGFkZGluZzoycHggNnB4O2JvcmRlci1yYWRpdXM6MTBweDtiYWNrZ3JvdW5kOicgK1xyXG4gICAgICAgIChyLmZhbWlsaWEgPT09ICdyb2RzJyA/ICcjMGVhNWU5JyA6ICcjOGI1Y2Y2JykgK1xyXG4gICAgICAgICc7Y29sb3I6I2ZmZjtmb250LXNpemU6MTBweDtmb250LXdlaWdodDo3MDBcIj4nICtcclxuICAgICAgICAoci5mYW1pbGlhID09PSAncm9kcycgPyAnUk9EJyA6ICdSRUVMJykgK1xyXG4gICAgICAgICc8L3NwYW4+PC90ZD4nICtcclxuICAgICAgICAnPHRkIHN0eWxlPVwicGFkZGluZzo2cHggOHB4O3RleHQtYWxpZ246Y2VudGVyO2ZvbnQtZmFtaWx5Om1vbm9zcGFjZTtmb250LXNpemU6MTFweDtjb2xvcjp2YXIoLS10ZXh0LXByaW1hcnkpO2ZvbnQtd2VpZ2h0OjcwMFwiPicgK1xyXG4gICAgICAgIGVzY2FwZUh0bWxTYWZlKHIuc2t1KSArXHJcbiAgICAgICAgJzwvdGQ+JyArXHJcbiAgICAgICAgJzx0ZCBzdHlsZT1cInBhZGRpbmc6NnB4IDhweDtmb250LXNpemU6MTFweDtjb2xvcjp2YXIoLS10ZXh0LXNlY29uZGFyeSk7bWF4LXdpZHRoOjI0MHB4O292ZXJmbG93OmhpZGRlbjt0ZXh0LW92ZXJmbG93OmVsbGlwc2lzO3doaXRlLXNwYWNlOm5vd3JhcFwiIHRpdGxlPVwiJyArXHJcbiAgICAgICAgZXNjYXBlSHRtbFNhZmUoci5kZXNjcmlwdGlvbikgK1xyXG4gICAgICAgICdcIj4nICtcclxuICAgICAgICBlc2NhcGVIdG1sU2FmZShyLmRlc2NyaXB0aW9uKSArXHJcbiAgICAgICAgJzwvdGQ+JyArXHJcbiAgICAgICAgJzx0ZCBzdHlsZT1cInBhZGRpbmc6NnB4IDhweDt0ZXh0LWFsaWduOmNlbnRlcjtmb250LXZhcmlhbnQtbnVtZXJpYzp0YWJ1bGFyLW51bXM7Y29sb3I6dmFyKC0tdGV4dC1wcmltYXJ5KVwiPicgK1xyXG4gICAgICAgIF9mbXRJbnQoci5zdG9ja0xpYnJlKSArXHJcbiAgICAgICAgJzwvdGQ+JyArXHJcbiAgICAgICAgJzx0ZCBzdHlsZT1cInBhZGRpbmc6NnB4IDhweDt0ZXh0LWFsaWduOmNlbnRlcjtmb250LXZhcmlhbnQtbnVtZXJpYzp0YWJ1bGFyLW51bXM7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZClcIj4nICtcclxuICAgICAgICBfZm10SW50KHIuZW5UcmFuc2l0bykgK1xyXG4gICAgICAgICc8L3RkPicgK1xyXG4gICAgICAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjZweCA4cHg7dGV4dC1hbGlnbjpjZW50ZXI7Zm9udC12YXJpYW50LW51bWVyaWM6dGFidWxhci1udW1zO2NvbG9yOiNkYzI2MjZcIj4nICtcclxuICAgICAgICBfZm10SW50KHIuYmFja29yZGVyKSArXHJcbiAgICAgICAgJzwvdGQ+JyArXHJcbiAgICAgICAgJzx0ZCBzdHlsZT1cInBhZGRpbmc6NnB4IDhweDt0ZXh0LWFsaWduOmNlbnRlcjtmb250LXZhcmlhbnQtbnVtZXJpYzp0YWJ1bGFyLW51bXM7Y29sb3I6dmFyKC0tdGV4dC1zZWNvbmRhcnkpXCI+JyArXHJcbiAgICAgICAgX2ZtdEludChyLnZlbnRhTWVuc3VhbCkgK1xyXG4gICAgICAgICc8L3RkPicgK1xyXG4gICAgICAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjZweCA4cHg7dGV4dC1hbGlnbjpjZW50ZXJcIj4nICtcclxuICAgICAgICBfYnVpbGRNdWx0Q2VsbEh0bWwocikgK1xyXG4gICAgICAgICc8L3RkPicgK1xyXG4gICAgICAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjZweCA4cHg7dGV4dC1hbGlnbjpjZW50ZXI7Zm9udC12YXJpYW50LW51bWVyaWM6dGFidWxhci1udW1zO2NvbG9yOnZhcigtLXRleHQtc2Vjb25kYXJ5KVwiPicgK1xyXG4gICAgICAgIF9mbXRJbnQoci5kZW1hbmRhRXNwZXJhZGEpICtcclxuICAgICAgICAnPC90ZD4nICtcclxuICAgICAgICAnPHRkIHN0eWxlPVwicGFkZGluZzo2cHggOHB4O3RleHQtYWxpZ246Y2VudGVyO2ZvbnQtdmFyaWFudC1udW1lcmljOnRhYnVsYXItbnVtcztjb2xvcjp2YXIoLS10ZXh0LXByaW1hcnkpO2ZvbnQtd2VpZ2h0OjYwMFwiPicgK1xyXG4gICAgICAgIF9mbXRJbnQoci5zYWxlc1BsYW5GdXQpICtcclxuICAgICAgICAnPC90ZD4nICtcclxuICAgICAgICAnPHRkIHN0eWxlPVwicGFkZGluZzo2cHggOHB4O3RleHQtYWxpZ246Y2VudGVyO2ZvbnQtdmFyaWFudC1udW1lcmljOnRhYnVsYXItbnVtcztmb250LXdlaWdodDo3MDA7Y29sb3I6JyArXHJcbiAgICAgICAgYmFsQ29sb3IgK1xyXG4gICAgICAgICdcIj4nICtcclxuICAgICAgICBfZm10TnVtU2lnbmVkKHIuYmFsYW5jZSkgK1xyXG4gICAgICAgICc8L3RkPicgK1xyXG4gICAgICAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjZweCA4cHg7dGV4dC1hbGlnbjpjZW50ZXI7Zm9udC12YXJpYW50LW51bWVyaWM6dGFidWxhci1udW1zO2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO2ZvbnQtc2l6ZToxMXB4XCI+JyArXHJcbiAgICAgICAgX2ZtdEludChyLm1vcSkgK1xyXG4gICAgICAgICc8L3RkPicgK1xyXG4gICAgICAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjZweCA4cHg7dGV4dC1hbGlnbjpjZW50ZXJcIj48c3BhbiBzdHlsZT1cImRpc3BsYXk6aW5saW5lLWJsb2NrO3BhZGRpbmc6NHB4IDEwcHg7Ym9yZGVyLXJhZGl1czoxMnB4O2JhY2tncm91bmQ6JyArXHJcbiAgICAgICAgcmVjQ29sb3IgK1xyXG4gICAgICAgICc7Y29sb3I6I2ZmZjtmb250LXNpemU6MTJweDtmb250LXdlaWdodDo4MDA7bWluLXdpZHRoOjUwcHhcIj4nICtcclxuICAgICAgICBfZm10SW50KHIucmVjb21lbmRhZG8pICtcclxuICAgICAgICAnPC9zcGFuPjwvdGQ+JyArXHJcbiAgICAgICAgJzx0ZCBzdHlsZT1cInBhZGRpbmc6NnB4IDhweDt0ZXh0LWFsaWduOmNlbnRlclwiPicgK1xyXG4gICAgICAgICc8YnV0dG9uIG9uY2xpY2s9XCJkaXNjb250aW51ZVNrdShcXCcnICtcclxuICAgICAgICBlc2NhcGVIdG1sU2FmZShyLnNrdSkgK1xyXG4gICAgICAgIFwiJywgJ1wiICtcclxuICAgICAgICBlc2NhcGVIdG1sU2FmZShyLmRlc2NyaXB0aW9uLnJlcGxhY2UoLycvZywgJycpKSArXHJcbiAgICAgICAgJ1xcJylcIiB0aXRsZT1cIkRlc2NvbnRpbnVhciBlc3RlIFNLVVwiIHN0eWxlPVwiYmFja2dyb3VuZDp0cmFuc3BhcmVudDtib3JkZXI6MXB4IHNvbGlkIHZhcigtLWJvcmRlci1zdWJ0bGUpO2JvcmRlci1yYWRpdXM6NHB4O3BhZGRpbmc6NHB4IDhweDtjdXJzb3I6cG9pbnRlcjtmb250LXNpemU6MTRweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKVwiPlx1RDgzRFx1REREMTwvYnV0dG9uPicgK1xyXG4gICAgICAgICc8L3RkPicgK1xyXG4gICAgICAgICc8L3RyPidcclxuICAgICAgKTtcclxuICAgIH0pXHJcbiAgICAuam9pbignJyk7XHJcblxyXG4gIC8vIHYxMTEyOiBtaW4td2lkdGggcGFyYSBmb3J6YXIgc2Nyb2xsIGhvcml6b250YWwgc2kgbm8gY2FiZSBsYSBjb2x1bW5hXHJcbiAgLy8gQWNjaVx1MDBGM24uIFNpbiBlc3RvLCB0YWJsZSB3aWR0aDoxMDAlIGNvbXByaW1lIHRvZG8geSBsYSBcdTAwRkFsdGltYSBjb2x1bW5hXHJcbiAgLy8gcXVlZGEgZnVlcmEgZGVsIHZpZXdwb3J0IHNpbiBzY3JvbGwgdmlzaWJsZS5cclxuICBjb25zdCB0YWJsZSA9XHJcbiAgICAnPGRpdiBzdHlsZT1cIm92ZXJmbG93OmF1dG87bWF4LWhlaWdodDo2MHZoO2JvcmRlcjoxcHggc29saWQgdmFyKC0tYm9yZGVyLXN1YnRsZSk7Ym9yZGVyLXJhZGl1czo4cHhcIj4nICtcclxuICAgICc8dGFibGUgc3R5bGU9XCJ3aWR0aDoxMDAlO21pbi13aWR0aDoxNDAwcHg7Ym9yZGVyLWNvbGxhcHNlOmNvbGxhcHNlO2ZvbnQtc2l6ZToxMnB4XCI+JyArXHJcbiAgICAnPHRoZWFkIHN0eWxlPVwiYmFja2dyb3VuZDojMGYxNzJhO2NvbG9yOiNmZmY7cG9zaXRpb246c3RpY2t5O3RvcDowO3otaW5kZXg6MVwiPjx0cj4nICtcclxuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjhweDt0ZXh0LWFsaWduOmNlbnRlcjtmb250LXNpemU6MTBweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2VcIj5GYW08L3RoPicgK1xyXG4gICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6OHB4O3RleHQtYWxpZ246Y2VudGVyO2ZvbnQtc2l6ZToxMHB4O3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZVwiPlNLVTwvdGg+JyArXHJcbiAgICAnPHRoIHN0eWxlPVwicGFkZGluZzo4cHg7dGV4dC1hbGlnbjpjZW50ZXI7Zm9udC1zaXplOjEwcHg7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlXCI+RGVzY3JpcGNpXHUwMEYzbjwvdGg+JyArXHJcbiAgICAnPHRoIHN0eWxlPVwicGFkZGluZzo4cHg7dGV4dC1hbGlnbjpjZW50ZXI7Zm9udC1zaXplOjEwcHg7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlXCIgdGl0bGU9XCJXaHMgMTEgZGlzcG9uaWJsZSB2ZW50YVwiPlN0b2NrPC90aD4nICtcclxuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjhweDt0ZXh0LWFsaWduOmNlbnRlcjtmb250LXNpemU6MTBweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2VcIiB0aXRsZT1cIldocyAxMlwiPlRyXHUwMEUxbnNpdG88L3RoPicgK1xyXG4gICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6OHB4O3RleHQtYWxpZ246Y2VudGVyO2ZvbnQtc2l6ZToxMHB4O3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZVwiPkJhY2tvcmRlcjwvdGg+JyArXHJcbiAgICAnPHRoIHN0eWxlPVwicGFkZGluZzo4cHg7dGV4dC1hbGlnbjpjZW50ZXI7Zm9udC1zaXplOjEwcHg7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlXCIgdGl0bGU9XCJQcm9tZWRpbyBcdTAwRkFsdGltb3MgMyBtZXNlc1wiPlZ0YS9tZXM8L3RoPicgK1xyXG4gICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6OHB4O3RleHQtYWxpZ246Y2VudGVyO2ZvbnQtc2l6ZToxMHB4O3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZVwiIHRpdGxlPVwiTXVsdGlwbGljYWRvciBkZSB0ZW5kZW5jaWEgPSB2ZW50YSAybSAvIHZlbnRhIDZtLiBFZGl0YWJsZSAoY2xpY2sgcGFyYSBvdmVycmlkZSkuXCI+TXVsdGlwLjwvdGg+JyArXHJcbiAgICAnPHRoIHN0eWxlPVwicGFkZGluZzo4cHg7dGV4dC1hbGlnbjpjZW50ZXI7Zm9udC1zaXplOjEwcHg7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlXCIgdGl0bGU9XCJWdGEvbWVzIFx1MDBENyA3IG1lc2VzXCI+RGVtYW5kYSBlc3AuPC90aD4nICtcclxuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjhweDt0ZXh0LWFsaWduOmNlbnRlcjtmb250LXNpemU6MTBweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2VcIiB0aXRsZT1cIlN1bWEgY29sdW1uYXMgU2FsZXMgUGxhbiBkZXNkZSBtZXMgYWN0dWFsXCI+UGxhbiBmdXR1cm88L3RoPicgK1xyXG4gICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6OHB4O3RleHQtYWxpZ246Y2VudGVyO2ZvbnQtc2l6ZToxMHB4O3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZVwiPkJhbGFuY2U8L3RoPicgK1xyXG4gICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6OHB4O3RleHQtYWxpZ246Y2VudGVyO2ZvbnQtc2l6ZToxMHB4O3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZVwiPk1PUTwvdGg+JyArXHJcbiAgICAnPHRoIHN0eWxlPVwicGFkZGluZzo4cHg7dGV4dC1hbGlnbjpjZW50ZXI7Zm9udC1zaXplOjEwcHg7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO2JhY2tncm91bmQ6IzEzNGU0YVwiPlJlY29tZW5kYWRvPC90aD4nICtcclxuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjhweDt0ZXh0LWFsaWduOmNlbnRlcjtmb250LXNpemU6MTBweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2VcIiB0aXRsZT1cIkRlc2NvbnRpbnVhciBTS1VcIj5BY2NpXHUwMEYzbjwvdGg+JyArXHJcbiAgICAnPC90cj48L3RoZWFkPjx0Ym9keT4nICtcclxuICAgIChyb3dzLmxlbmd0aFxyXG4gICAgICA/IHJvd3NIdG1sXHJcbiAgICAgIDogJzx0cj48dGQgY29sc3Bhbj1cIjE0XCIgc3R5bGU9XCJwYWRkaW5nOjQwcHg7dGV4dC1hbGlnbjpjZW50ZXI7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZClcIj5TaW4gcmVzdWx0YWRvcyBjb24gbG9zIGZpbHRyb3MgYWN0dWFsZXM8L3RkPjwvdHI+JykgK1xyXG4gICAgJzwvdGJvZHk+PC90YWJsZT48L2Rpdj4nO1xyXG5cclxuICBjb25zdCBmb290ZXIgPVxyXG4gICAgJzxkaXYgc3R5bGU9XCJtYXJnaW4tdG9wOjhweDtmb250LXNpemU6MTBweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKVwiPicgK1xyXG4gICAgJ01vc3RyYW5kbyAnICtcclxuICAgIF9mbXRJbnQocm93cy5sZW5ndGgpICtcclxuICAgICcgZGUgJyArXHJcbiAgICBfZm10SW50KGFsbFJvd3MubGVuZ3RoKSArXHJcbiAgICAnIFNLVXMgXHUwMEI3ICcgK1xyXG4gICAgJ0JhbGFuY2UgPSBTdG9jayArIFRyXHUwMEUxbnNpdG8gKyBQbGFuIFx1MjIxMiBCYWNrb3JkZXIgXHUyMjEyIERlbWFuZGEuIFJvam8gPSBxdWllYnJlIGVzcGVyYWRvLiBSZWNvbWVuZGFkbyBzZSByZWRvbmRlYSBhbCBtXHUwMEZBbHRpcGxvIGRlIE1PUSBzdXBlcmlvci4nICtcclxuICAgICc8L2Rpdj4nO1xyXG5cclxuICBjb250LmlubmVySFRNTCA9XHJcbiAgICAnPGRpdiBzdHlsZT1cInBhZGRpbmc6MThweCAxOHB4IDMwcHhcIj4nICsgaGVhZGVyICsgZmlsdGVycyArIHRhYmxlICsgZm9vdGVyICsgJzwvZGl2Pic7XHJcbn1cclxuXHJcbndpbmRvdy5vblJlY29TZWFyY2hDaGFuZ2UgPSBmdW5jdGlvbiAoZXYpIHtcclxuICBfcmVjb1NlYXJjaFRleHQgPSBldi50YXJnZXQudmFsdWUgfHwgJyc7XHJcbiAgX3JlbmRlclJlY29TZWN0aW9uKCk7XHJcbiAgLy8gUmVzdGF1cmFyIGZvY3VzICsgY2FyZXQgYWwgaW5wdXRcclxuICBzZXRUaW1lb3V0KCgpID0+IHtcclxuICAgIGNvbnN0IGlucCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdyZWNvLXNlYXJjaCcpO1xyXG4gICAgaWYgKGlucCkge1xyXG4gICAgICBpbnAuZm9jdXMoKTtcclxuICAgICAgaW5wLnNldFNlbGVjdGlvblJhbmdlKGlucC52YWx1ZS5sZW5ndGgsIGlucC52YWx1ZS5sZW5ndGgpO1xyXG4gICAgfVxyXG4gIH0sIDApO1xyXG59O1xyXG5cclxud2luZG93Lm9uUmVjb0ZhbWlsaWFDaGFuZ2UgPSBmdW5jdGlvbiAoZXYpIHtcclxuICBfcmVjb0ZpbHRlckZhbWlsaWEgPSBldi50YXJnZXQudmFsdWUgfHwgJ2FsbCc7XHJcbiAgX3JlbmRlclJlY29TZWN0aW9uKCk7XHJcbn07XHJcblxyXG53aW5kb3cub25SZWNvRmlsdGVyTWluQ2hhbmdlID0gZnVuY3Rpb24gKGV2KSB7XHJcbiAgX3JlY29GaWx0ZXJNaW5SZWMgPSAhIWV2LnRhcmdldC5jaGVja2VkO1xyXG4gIF9yZW5kZXJSZWNvU2VjdGlvbigpO1xyXG59O1xyXG5cclxud2luZG93LmV4cG9ydFJlY29FeGNlbCA9IGZ1bmN0aW9uICgpIHtcclxuICBpZiAodHlwZW9mIFhMU1ggPT09ICd1bmRlZmluZWQnKSB7XHJcbiAgICBhbGVydCgnU2hlZXRKUyAoWExTWCkgbm8gY2FyZ2FkbycpO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuICBjb25zdCByb3dzID0gX2NvbXB1dGVSZWNvbW1lbmRhdGlvbnMoKTtcclxuICBjb25zdCBhb2EgPSBbXHJcbiAgICBbXHJcbiAgICAgICdGYW1pbGlhJyxcclxuICAgICAgJ1NLVScsXHJcbiAgICAgICdEZXNjcmlwY2lcdTAwRjNuJyxcclxuICAgICAgJ1N0b2NrJyxcclxuICAgICAgJ1RyXHUwMEUxbnNpdG8nLFxyXG4gICAgICAnQmFja29yZGVyJyxcclxuICAgICAgJ1Z0YSBwcm9tL21lcycsXHJcbiAgICAgICdNdWx0aXBsaWNhZG9yJyxcclxuICAgICAgJ09yaWdlbiBtdWx0JyxcclxuICAgICAgJ0RlbWFuZGEgZXNwLiA3bScsXHJcbiAgICAgICdTYWxlcyBQbGFuIGZ1dHVybycsXHJcbiAgICAgICdCYWxhbmNlJyxcclxuICAgICAgJ01PUScsXHJcbiAgICAgICdSZWNvbWVuZGFkbycsXHJcbiAgICBdLFxyXG4gIF07XHJcbiAgZm9yIChjb25zdCByIG9mIHJvd3MpIHtcclxuICAgIGFvYS5wdXNoKFtcclxuICAgICAgci5mYW1pbGlhID09PSAncm9kcycgPyAnUm9kcyAoQ2FcdTAwRjFhcyknIDogJ1JlZWxzJyxcclxuICAgICAgci5za3UsXHJcbiAgICAgIHIuZGVzY3JpcHRpb24sXHJcbiAgICAgIHIuc3RvY2tMaWJyZSxcclxuICAgICAgci5lblRyYW5zaXRvLFxyXG4gICAgICByLmJhY2tvcmRlcixcclxuICAgICAgci52ZW50YU1lbnN1YWwsXHJcbiAgICAgIHIubXVsdGlwbGllcixcclxuICAgICAgci5tdWx0U291cmNlIHx8ICdhdXRvJyxcclxuICAgICAgci5kZW1hbmRhRXNwZXJhZGEsXHJcbiAgICAgIHIuc2FsZXNQbGFuRnV0LFxyXG4gICAgICByLmJhbGFuY2UsXHJcbiAgICAgIHIubW9xLFxyXG4gICAgICByLnJlY29tZW5kYWRvLFxyXG4gICAgXSk7XHJcbiAgfVxyXG4gIGNvbnN0IHdzID0gWExTWC51dGlscy5hb2FfdG9fc2hlZXQoYW9hKTtcclxuICB3c1snIWNvbHMnXSA9IFtcclxuICAgIHsgd2NoOiAxNCB9LCAvLyBGYW1pbGlhXHJcbiAgICB7IHdjaDogMTggfSwgLy8gU0tVXHJcbiAgICB7IHdjaDogNDAgfSwgLy8gRGVzY3JpcGNpXHUwMEYzblxyXG4gICAgeyB3Y2g6IDggfSwgLy8gU3RvY2tcclxuICAgIHsgd2NoOiAxMCB9LCAvLyBUclx1MDBFMW5zaXRvXHJcbiAgICB7IHdjaDogMTEgfSwgLy8gQmFja29yZGVyXHJcbiAgICB7IHdjaDogMTIgfSwgLy8gVnRhIHByb20vbWVzXHJcbiAgICB7IHdjaDogMTIgfSwgLy8gTXVsdGlwbGljYWRvclxyXG4gICAgeyB3Y2g6IDExIH0sIC8vIE9yaWdlbiBtdWx0XHJcbiAgICB7IHdjaDogMTUgfSwgLy8gRGVtYW5kYSBlc3AgN21cclxuICAgIHsgd2NoOiAxNiB9LCAvLyBTYWxlcyBQbGFuIGZ1dHVyb1xyXG4gICAgeyB3Y2g6IDEwIH0sIC8vIEJhbGFuY2VcclxuICAgIHsgd2NoOiA4IH0sIC8vIE1PUVxyXG4gICAgeyB3Y2g6IDEyIH0sIC8vIFJlY29tZW5kYWRvXHJcbiAgXTtcclxuICBjb25zdCB3YiA9IFhMU1gudXRpbHMuYm9va19uZXcoKTtcclxuICBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KHdiLCB3cywgJ1JlY29tZW5kYWNpXHUwMEYzbicpO1xyXG4gIGNvbnN0IGhveSA9IG5ldyBEYXRlKCk7XHJcbiAgY29uc3Qgc3RhbXAgPVxyXG4gICAgaG95LmdldEZ1bGxZZWFyKCkgK1xyXG4gICAgJy0nICtcclxuICAgIFN0cmluZyhob3kuZ2V0TW9udGgoKSArIDEpLnBhZFN0YXJ0KDIsICcwJykgK1xyXG4gICAgJy0nICtcclxuICAgIFN0cmluZyhob3kuZ2V0RGF0ZSgpKS5wYWRTdGFydCgyLCAnMCcpO1xyXG4gIFhMU1gud3JpdGVGaWxlKHdiLCAnUmVjb21lbmRhY2lvbl9Db21wcmFfJyArIHN0YW1wICsgJy54bHN4Jyk7XHJcbn07XHJcblxyXG4vLyB2MTExMiBGM0I6IGRlc2NvbnRpbnVhciAvIHJlYWN0aXZhciBTS1VzLlxyXG53aW5kb3cuZGlzY29udGludWVTa3UgPSBhc3luYyBmdW5jdGlvbiAoc2t1LCBkZXNjcmlwdGlvbikge1xyXG4gIGlmICghX2Rpc2NvbnRpbnVlZFNrdXMpIF9kaXNjb250aW51ZWRTa3VzID0gbmV3IFNldCgpO1xyXG4gIGNvbnN0IHVwcGVyID0gU3RyaW5nKHNrdSkudHJpbSgpLnRvVXBwZXJDYXNlKCk7XHJcbiAgY29uc3QgbGFiZWwgPSBkZXNjcmlwdGlvbiA/IHNrdSArICcgXHUyMDE0ICcgKyBkZXNjcmlwdGlvbi5zbGljZSgwLCA2MCkgOiBza3U7XHJcbiAgaWYgKFxyXG4gICAgIWNvbmZpcm0oXHJcbiAgICAgICdEZXNjb250aW51YXIgJyArXHJcbiAgICAgICAgbGFiZWwgK1xyXG4gICAgICAgICc/XFxuXFxuUXVlZGFyXHUwMEUxIGV4Y2x1aWRvIGRlbCBjXHUwMEUxbGN1bG8gZGUgcmVjb21lbmRhY2lcdTAwRjNuIGRlIGNvbXByYSBoYXN0YSBxdWUgbG8gcmVhY3RpdmVzIGRlc2RlIGVsIGNoaXAgXCJEZXNjb250aW51YWRvc1wiLidcclxuICAgIClcclxuICApIHtcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgX2Rpc2NvbnRpbnVlZFNrdXMuYWRkKHVwcGVyKTtcclxuICB0cnkge1xyXG4gICAgYXdhaXQgX3NhdmVEaXNjb250aW51ZWRTa3VzKCk7XHJcbiAgICBfcmVuZGVyUmVjb1NlY3Rpb24oKTtcclxuICB9IGNhdGNoIChlKSB7XHJcbiAgICBfZGlzY29udGludWVkU2t1cy5kZWxldGUodXBwZXIpO1xyXG4gICAgYWxlcnQoJ0Vycm9yIGd1YXJkYW5kbzogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xyXG4gIH1cclxufTtcclxuXHJcbndpbmRvdy5yZWFjdGl2YXRlU2t1ID0gYXN5bmMgZnVuY3Rpb24gKHNrdSkge1xyXG4gIGlmICghX2Rpc2NvbnRpbnVlZFNrdXMpIHJldHVybjtcclxuICBjb25zdCB1cHBlciA9IFN0cmluZyhza3UpLnRyaW0oKS50b1VwcGVyQ2FzZSgpO1xyXG4gIF9kaXNjb250aW51ZWRTa3VzLmRlbGV0ZSh1cHBlcik7XHJcbiAgdHJ5IHtcclxuICAgIGF3YWl0IF9zYXZlRGlzY29udGludWVkU2t1cygpO1xyXG4gICAgX3JlbmRlckRpc2NvbnRpbnVlZE1vZGFsKCk7XHJcbiAgICBfcmVuZGVyUmVjb1NlY3Rpb24oKTtcclxuICB9IGNhdGNoIChlKSB7XHJcbiAgICBfZGlzY29udGludWVkU2t1cy5hZGQodXBwZXIpO1xyXG4gICAgYWxlcnQoJ0Vycm9yIGd1YXJkYW5kbzogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xyXG4gIH1cclxufTtcclxuXHJcbndpbmRvdy5vcGVuRGlzY29udGludWVkTW9kYWwgPSBmdW5jdGlvbiAoKSB7XHJcbiAgY29uc3QgZXhpc3RpbmcgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZGlzY29udGludWVkLXNrdXMtbW9kYWwnKTtcclxuICBpZiAoZXhpc3RpbmcpIGV4aXN0aW5nLnJlbW92ZSgpO1xyXG4gIGNvbnN0IGVsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2Jyk7XHJcbiAgZWwuaWQgPSAnZGlzY29udGludWVkLXNrdXMtbW9kYWwnO1xyXG4gIGVsLnN0eWxlLmNzc1RleHQgPVxyXG4gICAgJ3Bvc2l0aW9uOmZpeGVkO2luc2V0OjA7YmFja2dyb3VuZDpyZ2JhKDE1LDIzLDQyLC42NSk7ei1pbmRleDoyMTAwO2Rpc3BsYXk6ZmxleDthbGlnbi1pdGVtczpjZW50ZXI7anVzdGlmeS1jb250ZW50OmNlbnRlcjtwYWRkaW5nOjN2aCc7XHJcbiAgZWwub25jbGljayA9IChldikgPT4ge1xyXG4gICAgaWYgKGV2LnRhcmdldCA9PT0gZWwpIGVsLnJlbW92ZSgpO1xyXG4gIH07XHJcbiAgZWwuaW5uZXJIVE1MID1cclxuICAgICc8ZGl2IGlkPVwiZGlzY29udGludWVkLW1vZGFsLWNvbnRlbnRcIiBzdHlsZT1cImJhY2tncm91bmQ6dmFyKC0tYmctZWxldmF0ZWQpO2JvcmRlci1yYWRpdXM6MTJweDtwYWRkaW5nOjI0cHg7bWF4LXdpZHRoOjY0MHB4O3dpZHRoOjEwMCU7bWF4LWhlaWdodDo5MHZoO292ZXJmbG93OmF1dG87Ym94LXNoYWRvdzowIDIwcHggNjBweCByZ2JhKDAsMCwwLC40KVwiPjwvZGl2Pic7XHJcbiAgZG9jdW1lbnQuYm9keS5hcHBlbmRDaGlsZChlbCk7XHJcbiAgX3JlbmRlckRpc2NvbnRpbnVlZE1vZGFsKCk7XHJcbn07XHJcblxyXG4vLyB2MTM1NTogdmVyIGJsb3F1ZSBcIlByb3hpbWFzIGRlc2NvbnRpbnVhY2lvbmVzXCIgYWwgZmluYWwgZGVsIGFyY2hpdm8uXHJcblxyXG5mdW5jdGlvbiBfcmVuZGVyRGlzY29udGludWVkTW9kYWwoKSB7XHJcbiAgY29uc3QgY29udCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdkaXNjb250aW51ZWQtbW9kYWwtY29udGVudCcpO1xyXG4gIGlmICghY29udCkgcmV0dXJuO1xyXG4gIGNvbnN0IGxpc3QgPSBfZGlzY29udGludWVkU2t1cyA/IEFycmF5LmZyb20oX2Rpc2NvbnRpbnVlZFNrdXMpLnNvcnQoKSA6IFtdO1xyXG4gIC8vIEJ1c2NhciBkZXNjcmlwY2lcdTAwRjNuIGVuIGxvcyBzYWxlcyBwbGFucyBjYWNoZXMgcG9yIHNpIGVzdGEgY2FyZ2Fkb1xyXG4gIGNvbnN0IHNrdVRvRGVzYyA9IHt9O1xyXG4gIGZvciAoY29uc3QgZmFtIG9mIFsncm9kcycsICdyZWVscyddKSB7XHJcbiAgICBjb25zdCBjYWNoZSA9IF9zYWxlc1BsYW5DYWNoZXNbZmFtXTtcclxuICAgIGlmIChjYWNoZSAmJiBjYWNoZS5yb3dzKSB7XHJcbiAgICAgIGZvciAoY29uc3QgciBvZiBjYWNoZS5yb3dzKSB7XHJcbiAgICAgICAgc2t1VG9EZXNjW1N0cmluZyhyLnNrdSkudHJpbSgpLnRvVXBwZXJDYXNlKCldID0gci5kZXNjcmlwdGlvbiB8fCAnJztcclxuICAgICAgfVxyXG4gICAgfVxyXG4gIH1cclxuICBjb25zdCBoZWFkID1cclxuICAgICc8ZGl2IHN0eWxlPVwiZGlzcGxheTpmbGV4O2p1c3RpZnktY29udGVudDpzcGFjZS1iZXR3ZWVuO2FsaWduLWl0ZW1zOmNlbnRlcjttYXJnaW4tYm90dG9tOjE0cHhcIj4nICtcclxuICAgICc8ZGl2PjxkaXYgc3R5bGU9XCJmb250LXNpemU6MThweDtmb250LXdlaWdodDo4MDA7Y29sb3I6dmFyKC0tdGV4dC1wcmltYXJ5KVwiPlNLVXMgZGVzY29udGludWFkb3M8L2Rpdj4nICtcclxuICAgICc8ZGl2IHN0eWxlPVwiZm9udC1zaXplOjExcHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7bWFyZ2luLXRvcDoycHhcIj4nICtcclxuICAgIGxpc3QubGVuZ3RoICtcclxuICAgICcgU0tVcyBleGNsdWlkb3MgZGVsIGNcdTAwRTFsY3VsbyBkZSBSZWNvbWVuZGFjaVx1MDBGM24gZGUgQ29tcHJhJyArXHJcbiAgICAnPC9kaXY+PC9kaXY+JyArXHJcbiAgICAnPGJ1dHRvbiBvbmNsaWNrPVwiZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoXFwnZGlzY29udGludWVkLXNrdXMtbW9kYWxcXCcpLnJlbW92ZSgpXCIgc3R5bGU9XCJiYWNrZ3JvdW5kOnRyYW5zcGFyZW50O2JvcmRlcjoxcHggc29saWQgdmFyKC0tYm9yZGVyLXN1YnRsZSk7Ym9yZGVyLXJhZGl1czo2cHg7cGFkZGluZzo2cHggMTJweDtjdXJzb3I6cG9pbnRlcjtmb250LXdlaWdodDo3MDBcIj5DZXJyYXI8L2J1dHRvbj4nICtcclxuICAgICc8L2Rpdj4nO1xyXG4gIGNvbnN0IGJvZHkgPVxyXG4gICAgbGlzdC5sZW5ndGggPT09IDBcclxuICAgICAgPyAnPGRpdiBzdHlsZT1cInBhZGRpbmc6NDBweDt0ZXh0LWFsaWduOmNlbnRlcjtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKVwiPk5vIGhheSBTS1VzIGRlc2NvbnRpbnVhZG9zLjxicj48YnI+UG9kXHUwMEU5cyBkZXNjb250aW51YXIgU0tVcyBkZXNkZSBlbCBib3RcdTAwRjNuIFx1RDgzRFx1REREMSBlbiBjYWRhIGZpbGEgZGUgbGEgdGFibGEgUmVjb21lbmRhY2lcdTAwRjNuIGRlIENvbXByYS48L2Rpdj4nXHJcbiAgICAgIDogJzxkaXYgc3R5bGU9XCJkaXNwbGF5OmZsZXg7ZmxleC1kaXJlY3Rpb246Y29sdW1uO2dhcDo2cHhcIj4nICtcclxuICAgICAgICBsaXN0XHJcbiAgICAgICAgICAubWFwKChza3UpID0+IHtcclxuICAgICAgICAgICAgY29uc3QgZGVzYyA9IHNrdVRvRGVzY1tza3VdIHx8ICcnO1xyXG4gICAgICAgICAgICByZXR1cm4gKFxyXG4gICAgICAgICAgICAgICc8ZGl2IHN0eWxlPVwiZGlzcGxheTpmbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtnYXA6MTBweDtwYWRkaW5nOjEwcHggMTJweDtiYWNrZ3JvdW5kOnZhcigtLWJnLXNlY29uZGFyeSk7Ym9yZGVyLXJhZGl1czo2cHhcIj4nICtcclxuICAgICAgICAgICAgICAnPGRpdiBzdHlsZT1cImZsZXg6MVwiPjxkaXYgc3R5bGU9XCJmb250LWZhbWlseTptb25vc3BhY2U7Zm9udC13ZWlnaHQ6NzAwO2NvbG9yOnZhcigtLXRleHQtcHJpbWFyeSlcIj4nICtcclxuICAgICAgICAgICAgICBlc2NhcGVIdG1sU2FmZShza3UpICtcclxuICAgICAgICAgICAgICAnPC9kaXY+JyArXHJcbiAgICAgICAgICAgICAgKGRlc2NcclxuICAgICAgICAgICAgICAgID8gJzxkaXYgc3R5bGU9XCJmb250LXNpemU6MTFweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTttYXJnaW4tdG9wOjJweFwiPicgK1xyXG4gICAgICAgICAgICAgICAgICBlc2NhcGVIdG1sU2FmZShkZXNjKSArXHJcbiAgICAgICAgICAgICAgICAgICc8L2Rpdj4nXHJcbiAgICAgICAgICAgICAgICA6ICcnKSArXHJcbiAgICAgICAgICAgICAgJzwvZGl2PicgK1xyXG4gICAgICAgICAgICAgICc8YnV0dG9uIG9uY2xpY2s9XCJyZWFjdGl2YXRlU2t1KFxcJycgK1xyXG4gICAgICAgICAgICAgIGVzY2FwZUh0bWxTYWZlKHNrdSkgK1xyXG4gICAgICAgICAgICAgICdcXCcpXCIgc3R5bGU9XCJwYWRkaW5nOjZweCAxMnB4O2JhY2tncm91bmQ6IzE2YTM0YTtjb2xvcjojZmZmO2JvcmRlcjpub25lO2JvcmRlci1yYWRpdXM6NHB4O2ZvbnQtc2l6ZToxMXB4O2ZvbnQtd2VpZ2h0OjcwMDtjdXJzb3I6cG9pbnRlclwiPlx1MjFCQiBSZWFjdGl2YXI8L2J1dHRvbj4nICtcclxuICAgICAgICAgICAgICAnPC9kaXY+J1xyXG4gICAgICAgICAgICApO1xyXG4gICAgICAgICAgfSlcclxuICAgICAgICAgIC5qb2luKCcnKSArXHJcbiAgICAgICAgJzwvZGl2Pic7XHJcbiAgY29udC5pbm5lckhUTUwgPSBoZWFkICsgYm9keTtcclxufVxyXG5cclxuLy8gdjEzNTUgKDIwMjYtMTAtMTkpOiBtb2RhbCBidWxrLW1hcmtpbmcgXCJQcm94aW1hcyBkZXNjb250aW51YWNpb25lc1wiLlxyXG4vLyBNYXJpYW5vIHBpZGlvIHBvZGVyIG1hcmNhciB2YXJpb3MgU0tVcyBhIGxhIHZleiAodnMgZmlsYS1wb3ItZmlsYSBjb24gXHVEODNEXHVEREQxKS5cclxuLy8gTGlzdGEgY29tcGxldGEgZGUgU0tVcyBkZWwgc2FsZXMgcGxhbiBhY3R1YWwgKHJvZHMgKyByZWVscywgZGVkdXBlKSBjb25cclxuLy8gY2hlY2tib3ggcHJlLXRpbGRhZG8gc2kgeWEgZXN0YW4gZW4gX2Rpc2NvbnRpbnVlZFNrdXMuIEFsIGd1YXJkYXIgc2luY3Jvbml6YVxyXG4vLyBlbCBTZXQgY29uIGxvIHRpbGRhZG8gKGFncmVnYSBsb3MgbnVldm9zLCBzYWNhIGxvcyBkZXN0aWxkYWRvcyBkZSBsb3MgcXVlXHJcbi8vIHZlbW9zIGVuIGVsIERPTSkuXHJcbi8vIE5PVEEgWFNTOiB1c2Ftb3MgY3JlYXRlRWxlbWVudCArIHRleHRDb250ZW50IHBhcmEgdG9kbyBjb250ZW5pZG8gdmFyaWFibGVcclxuLy8gKFNLVSwgZGVzY3JpcGNpb24sIHRleHRvIGRlIGJ1c3F1ZWRhKS4gSW5uZXJodG1sIHNvbG8gY29uIHN0cmluZ3MgbGl0ZXJhbGVzXHJcbi8vIGNvbnRyb2xhZG9zIHBvciBub3NvdHJvcywgbnVuY2EgY29uIGRhdG9zIGRlbCBzYWxlcyBwbGFuLlxyXG5sZXQgX3VwY29taW5nU2VhcmNoVGV4dCA9ICcnO1xyXG5cclxuZnVuY3Rpb24gX2NvbGxlY3RBbGxTa3VzRnJvbVNhbGVzUGxhbigpIHtcclxuICBjb25zdCBtYXAgPSBuZXcgTWFwKCk7XHJcbiAgZm9yIChjb25zdCBmYW0gb2YgWydyb2RzJywgJ3JlZWxzJ10pIHtcclxuICAgIGNvbnN0IGNhY2hlID0gX3NhbGVzUGxhbkNhY2hlc1tmYW1dO1xyXG4gICAgaWYgKCFjYWNoZSB8fCAhQXJyYXkuaXNBcnJheShjYWNoZS5yb3dzKSkgY29udGludWU7XHJcbiAgICBmb3IgKGNvbnN0IHIgb2YgY2FjaGUucm93cykge1xyXG4gICAgICBjb25zdCBza3UgPSBTdHJpbmcoci5za3UgfHwgJycpLnRyaW0oKTtcclxuICAgICAgaWYgKCFza3UpIGNvbnRpbnVlO1xyXG4gICAgICBjb25zdCB1cHBlciA9IHNrdS50b1VwcGVyQ2FzZSgpO1xyXG4gICAgICBtYXAuc2V0KHVwcGVyLCB7XHJcbiAgICAgICAgc2t1LFxyXG4gICAgICAgIHNrdVVwcGVyOiB1cHBlcixcclxuICAgICAgICBkZXNjcmlwdGlvbjogci5kZXNjcmlwdGlvbiB8fCAnJyxcclxuICAgICAgICBmYW1pbGlhOiBmYW0sXHJcbiAgICAgIH0pO1xyXG4gICAgfVxyXG4gIH1cclxuICByZXR1cm4gQXJyYXkuZnJvbShtYXAudmFsdWVzKCkpLnNvcnQoKGEsIGIpID0+IGEuc2t1VXBwZXIubG9jYWxlQ29tcGFyZShiLnNrdVVwcGVyKSk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIF9tYWtlRWwodGFnLCBzdHlsZVN0ciwgdGV4dENvbnRlbnQpIHtcclxuICBjb25zdCBlbCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQodGFnKTtcclxuICBpZiAoc3R5bGVTdHIpIGVsLnN0eWxlLmNzc1RleHQgPSBzdHlsZVN0cjtcclxuICBpZiAodGV4dENvbnRlbnQgIT0gbnVsbCkgZWwudGV4dENvbnRlbnQgPSB0ZXh0Q29udGVudDtcclxuICByZXR1cm4gZWw7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIF9idWlsZFVwY29taW5nUm93KHJvdywgaXNEaXNjKSB7XHJcbiAgY29uc3QgbGFiZWwgPSBfbWFrZUVsKFxyXG4gICAgJ2xhYmVsJyxcclxuICAgICdkaXNwbGF5OmZsZXg7YWxpZ24taXRlbXM6Y2VudGVyO2dhcDoxMHB4O3BhZGRpbmc6OHB4IDEwcHg7YmFja2dyb3VuZDonICtcclxuICAgICAgKGlzRGlzYyA/ICdyZ2JhKDE0Nyw1MSwyMzQsLjA4KScgOiAndmFyKC0tYmctc2Vjb25kYXJ5KScpICtcclxuICAgICAgJztib3JkZXItcmFkaXVzOjVweDtjdXJzb3I6cG9pbnRlcjt0cmFuc2l0aW9uOmJhY2tncm91bmQgLjFzJ1xyXG4gICk7XHJcbiAgY29uc3QgY2IgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdpbnB1dCcpO1xyXG4gIGNiLnR5cGUgPSAnY2hlY2tib3gnO1xyXG4gIGNiLnNldEF0dHJpYnV0ZSgnZGF0YS11cGNvbWluZy1za3UnLCByb3cuc2t1VXBwZXIpO1xyXG4gIGNiLmNoZWNrZWQgPSAhIWlzRGlzYztcclxuICBjYi5zdHlsZS5jc3NUZXh0ID0gJ21hcmdpbjowO2ZsZXgtc2hyaW5rOjA7Y3Vyc29yOnBvaW50ZXI7d2lkdGg6MTZweDtoZWlnaHQ6MTZweCc7XHJcbiAgbGFiZWwuYXBwZW5kQ2hpbGQoY2IpO1xyXG4gIGNvbnN0IGJhZGdlID0gX21ha2VFbChcclxuICAgICdzcGFuJyxcclxuICAgICdkaXNwbGF5OmlubGluZS1ibG9jaztwYWRkaW5nOjFweCA2cHg7Ym9yZGVyLXJhZGl1czo4cHg7YmFja2dyb3VuZDonICtcclxuICAgICAgKHJvdy5mYW1pbGlhID09PSAncm9kcycgPyAnIzBlYTVlOScgOiAnIzhiNWNmNicpICtcclxuICAgICAgJztjb2xvcjojZmZmO2ZvbnQtc2l6ZTo5cHg7Zm9udC13ZWlnaHQ6NzAwO21hcmdpbi1yaWdodDo2cHgnLFxyXG4gICAgcm93LmZhbWlsaWEgPT09ICdyb2RzJyA/ICdST0QnIDogJ1JFRUwnXHJcbiAgKTtcclxuICBsYWJlbC5hcHBlbmRDaGlsZChiYWRnZSk7XHJcbiAgY29uc3QgY29udGVudCA9IF9tYWtlRWwoJ2RpdicsICdmbGV4OjE7bWluLXdpZHRoOjAnKTtcclxuICBjb250ZW50LmFwcGVuZENoaWxkKFxyXG4gICAgX21ha2VFbChcclxuICAgICAgJ2RpdicsXHJcbiAgICAgICdmb250LWZhbWlseTptb25vc3BhY2U7Zm9udC13ZWlnaHQ6NzAwO2NvbG9yOnZhcigtLXRleHQtcHJpbWFyeSk7Zm9udC1zaXplOjEycHgnLFxyXG4gICAgICByb3cuc2t1XHJcbiAgICApXHJcbiAgKTtcclxuICBpZiAocm93LmRlc2NyaXB0aW9uKSB7XHJcbiAgICBjb250ZW50LmFwcGVuZENoaWxkKFxyXG4gICAgICBfbWFrZUVsKFxyXG4gICAgICAgICdkaXYnLFxyXG4gICAgICAgICdmb250LXNpemU6MTFweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTttYXJnaW4tdG9wOjFweDtvdmVyZmxvdzpoaWRkZW47dGV4dC1vdmVyZmxvdzplbGxpcHNpczt3aGl0ZS1zcGFjZTpub3dyYXAnLFxyXG4gICAgICAgIHJvdy5kZXNjcmlwdGlvblxyXG4gICAgICApXHJcbiAgICApO1xyXG4gIH1cclxuICBsYWJlbC5hcHBlbmRDaGlsZChjb250ZW50KTtcclxuICByZXR1cm4gbGFiZWw7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIF9yZW5kZXJVcGNvbWluZ0Rpc2NvbnRpbnVlZExpc3RPbmx5KCkge1xyXG4gIGNvbnN0IGxpc3RFbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCd1cGNvbWluZy1kaXNjLWxpc3QnKTtcclxuICBpZiAoIWxpc3RFbCkgcmV0dXJuO1xyXG4gIGNvbnN0IGFsbCA9IF9jb2xsZWN0QWxsU2t1c0Zyb21TYWxlc1BsYW4oKTtcclxuICBjb25zdCBxID0gX3VwY29taW5nU2VhcmNoVGV4dC50b0xvd2VyQ2FzZSgpO1xyXG4gIGNvbnN0IGZpbHRlcmVkID0gcVxyXG4gICAgPyBhbGwuZmlsdGVyKFxyXG4gICAgICAgIChyKSA9PlxyXG4gICAgICAgICAgci5za3VVcHBlci50b0xvd2VyQ2FzZSgpLmluY2x1ZGVzKHEpIHx8IChyLmRlc2NyaXB0aW9uIHx8ICcnKS50b0xvd2VyQ2FzZSgpLmluY2x1ZGVzKHEpXHJcbiAgICAgIClcclxuICAgIDogYWxsO1xyXG4gIHdoaWxlIChsaXN0RWwuZmlyc3RDaGlsZCkgbGlzdEVsLnJlbW92ZUNoaWxkKGxpc3RFbC5maXJzdENoaWxkKTtcclxuICBpZiAoZmlsdGVyZWQubGVuZ3RoID09PSAwKSB7XHJcbiAgICBjb25zdCBlbXB0eSA9IF9tYWtlRWwoXHJcbiAgICAgICdkaXYnLFxyXG4gICAgICAncGFkZGluZzozMHB4O3RleHQtYWxpZ246Y2VudGVyO2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpJyxcclxuICAgICAgcVxyXG4gICAgICAgID8gJ1NpbiByZXN1bHRhZG9zIHBhcmEgXCInICsgX3VwY29taW5nU2VhcmNoVGV4dCArICdcIi4nXHJcbiAgICAgICAgOiAnTm8gaGF5IFNLVXMgY2FyZ2Fkb3MgZW4gZWwgc2FsZXMgcGxhbi4nXHJcbiAgICApO1xyXG4gICAgbGlzdEVsLmFwcGVuZENoaWxkKGVtcHR5KTtcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgY29uc3Qgd3JhcCA9IF9tYWtlRWwoJ2RpdicsICdkaXNwbGF5OmZsZXg7ZmxleC1kaXJlY3Rpb246Y29sdW1uO2dhcDozcHgnKTtcclxuICBjb25zdCBjdXJyZW50U2V0ID0gX2Rpc2NvbnRpbnVlZFNrdXMgfHwgbmV3IFNldCgpO1xyXG4gIGZvciAoY29uc3QgciBvZiBmaWx0ZXJlZCkge1xyXG4gICAgd3JhcC5hcHBlbmRDaGlsZChfYnVpbGRVcGNvbWluZ1JvdyhyLCBjdXJyZW50U2V0LmhhcyhyLnNrdVVwcGVyKSkpO1xyXG4gIH1cclxuICBsaXN0RWwuYXBwZW5kQ2hpbGQod3JhcCk7XHJcbn1cclxuXHJcbndpbmRvdy5vblVwY29taW5nU2VhcmNoQ2hhbmdlID0gZnVuY3Rpb24gKGV2KSB7XHJcbiAgX3VwY29taW5nU2VhcmNoVGV4dCA9IFN0cmluZygoZXYgJiYgZXYudGFyZ2V0ICYmIGV2LnRhcmdldC52YWx1ZSkgfHwgJycpLnRyaW0oKTtcclxuICBfcmVuZGVyVXBjb21pbmdEaXNjb250aW51ZWRMaXN0T25seSgpO1xyXG59O1xyXG5cclxuZnVuY3Rpb24gX3JlbmRlclVwY29taW5nRGlzY29udGludWVkTW9kYWwoKSB7XHJcbiAgY29uc3QgY29udCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCd1cGNvbWluZy1kaXNjLWNvbnRlbnQnKTtcclxuICBpZiAoIWNvbnQpIHJldHVybjtcclxuICB3aGlsZSAoY29udC5maXJzdENoaWxkKSBjb250LnJlbW92ZUNoaWxkKGNvbnQuZmlyc3RDaGlsZCk7XHJcbiAgY29uc3QgYWxsID0gX2NvbGxlY3RBbGxTa3VzRnJvbVNhbGVzUGxhbigpO1xyXG4gIGNvbnN0IG5EaXNjQ3VycmVudCA9IF9kaXNjb250aW51ZWRTa3VzID8gX2Rpc2NvbnRpbnVlZFNrdXMuc2l6ZSA6IDA7XHJcbiAgLy8gSGVhZGVyLlxyXG4gIGNvbnN0IGhlYWQgPSBfbWFrZUVsKFxyXG4gICAgJ2RpdicsXHJcbiAgICAnZGlzcGxheTpmbGV4O2p1c3RpZnktY29udGVudDpzcGFjZS1iZXR3ZWVuO2FsaWduLWl0ZW1zOmZsZXgtc3RhcnQ7Z2FwOjEycHg7bWFyZ2luLWJvdHRvbToxNHB4O2ZsZXgtc2hyaW5rOjAnXHJcbiAgKTtcclxuICBjb25zdCBoZWFkTGVmdCA9IF9tYWtlRWwoJ2RpdicpO1xyXG4gIGhlYWRMZWZ0LmFwcGVuZENoaWxkKFxyXG4gICAgX21ha2VFbChcclxuICAgICAgJ2RpdicsXHJcbiAgICAgICdmb250LXNpemU6MThweDtmb250LXdlaWdodDo4MDA7Y29sb3I6dmFyKC0tdGV4dC1wcmltYXJ5KScsXHJcbiAgICAgICdQclx1MDBGM3hpbWFzIGRlc2NvbnRpbnVhY2lvbmVzJ1xyXG4gICAgKVxyXG4gICk7XHJcbiAgaGVhZExlZnQuYXBwZW5kQ2hpbGQoXHJcbiAgICBfbWFrZUVsKFxyXG4gICAgICAnZGl2JyxcclxuICAgICAgJ2ZvbnQtc2l6ZToxMXB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO21hcmdpbi10b3A6MnB4JyxcclxuICAgICAgYWxsLmxlbmd0aCArXHJcbiAgICAgICAgJyBTS1VzIGVuIGVsIHNhbGVzIHBsYW4gYWN0dWFsIFx1MDBCNyAnICtcclxuICAgICAgICBuRGlzY0N1cnJlbnQgK1xyXG4gICAgICAgICcgeWEgZGVzY29udGludWFkb3MuIE1hcmNcdTAwRTEgbG9zIHF1ZSBzZSB2YXlhbiBhIGRlc2NvbnRpbnVhciBlbiBsb3MgcHJcdTAwRjN4aW1vcyBtZXNlcyBcdTIwMTQgZWwgZm9yZWNhc3QgbG9zIHZhIGEgZGVzZXN0aW1hciBlbiBlbCBjXHUwMEUxbGN1bG8gZGUgUmVjb21lbmRhY2lcdTAwRjNuIGRlIENvbXByYS4nXHJcbiAgICApXHJcbiAgKTtcclxuICBoZWFkLmFwcGVuZENoaWxkKGhlYWRMZWZ0KTtcclxuICBjb25zdCBjbG9zZUJ0biA9IF9tYWtlRWwoXHJcbiAgICAnYnV0dG9uJyxcclxuICAgICdiYWNrZ3JvdW5kOnRyYW5zcGFyZW50O2JvcmRlcjoxcHggc29saWQgdmFyKC0tYm9yZGVyLXN1YnRsZSk7Ym9yZGVyLXJhZGl1czo2cHg7cGFkZGluZzo2cHggMTJweDtjdXJzb3I6cG9pbnRlcjtmb250LXdlaWdodDo3MDA7ZmxleC1zaHJpbms6MCcsXHJcbiAgICAnXHUyNzE1J1xyXG4gICk7XHJcbiAgY2xvc2VCdG4ub25jbGljayA9ICgpID0+IHtcclxuICAgIGNvbnN0IG0gPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgndXBjb21pbmctZGlzYy1tb2RhbCcpO1xyXG4gICAgaWYgKG0pIG0ucmVtb3ZlKCk7XHJcbiAgfTtcclxuICBoZWFkLmFwcGVuZENoaWxkKGNsb3NlQnRuKTtcclxuICBjb250LmFwcGVuZENoaWxkKGhlYWQpO1xyXG4gIC8vIFNlYXJjaC5cclxuICBjb25zdCBzZWFyY2hJbnAgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdpbnB1dCcpO1xyXG4gIHNlYXJjaElucC50eXBlID0gJ3RleHQnO1xyXG4gIHNlYXJjaElucC5wbGFjZWhvbGRlciA9ICdCdXNjYXIgU0tVIG8gZGVzY3JpcGNpXHUwMEYzbi4uLic7XHJcbiAgc2VhcmNoSW5wLnZhbHVlID0gX3VwY29taW5nU2VhcmNoVGV4dDtcclxuICBzZWFyY2hJbnAub25pbnB1dCA9IHdpbmRvdy5vblVwY29taW5nU2VhcmNoQ2hhbmdlO1xyXG4gIHNlYXJjaElucC5zdHlsZS5jc3NUZXh0ID1cclxuICAgICd3aWR0aDoxMDAlO3BhZGRpbmc6OHB4IDEycHg7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1ib3JkZXItc3VidGxlKTtib3JkZXItcmFkaXVzOjZweDtmb250LXNpemU6MTNweDtiYWNrZ3JvdW5kOnZhcigtLWJnLWVsZXZhdGVkKTtjb2xvcjp2YXIoLS10ZXh0LXByaW1hcnkpO21hcmdpbi1ib3R0b206MTBweDtmbGV4LXNocmluazowO2JveC1zaXppbmc6Ym9yZGVyLWJveCc7XHJcbiAgY29udC5hcHBlbmRDaGlsZChzZWFyY2hJbnApO1xyXG4gIC8vIExpc3QgY29udGFpbmVyIChwb2JsYWRvIHBvciBfcmVuZGVyVXBjb21pbmdEaXNjb250aW51ZWRMaXN0T25seSkuXHJcbiAgY29uc3QgbGlzdCA9IF9tYWtlRWwoJ2RpdicsICdmbGV4OjEgMSAwO292ZXJmbG93LXk6YXV0bzttaW4taGVpZ2h0OjAnKTtcclxuICBsaXN0LmlkID0gJ3VwY29taW5nLWRpc2MtbGlzdCc7XHJcbiAgY29udC5hcHBlbmRDaGlsZChsaXN0KTtcclxuICAvLyBGb290ZXIgY29uIGJvdG9uZXMuXHJcbiAgY29uc3QgZm9vdCA9IF9tYWtlRWwoXHJcbiAgICAnZGl2JyxcclxuICAgICdkaXNwbGF5OmZsZXg7anVzdGlmeS1jb250ZW50OnNwYWNlLWJldHdlZW47YWxpZ24taXRlbXM6Y2VudGVyO2dhcDoxMHB4O3BhZGRpbmctdG9wOjE0cHg7Ym9yZGVyLXRvcDoxcHggc29saWQgdmFyKC0tYm9yZGVyLXN1YnRsZSk7bWFyZ2luLXRvcDoxMnB4O2ZsZXgtc2hyaW5rOjAnXHJcbiAgKTtcclxuICBmb290LmFwcGVuZENoaWxkKFxyXG4gICAgX21ha2VFbChcclxuICAgICAgJ2RpdicsXHJcbiAgICAgICdmb250LXNpemU6MTFweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKScsXHJcbiAgICAgICdTZSBndWFyZGEgZW4gZm9yZWNhc3RfY29uZmlnL2Rpc2NvbnRpbnVlZF9za3VzLiBSZXZlcnNpYmxlIGRlc2RlIGVsIGNoaXAgXHVEODNEXHVERUFCIGRlc2NvbnRpbnVhZG9zLidcclxuICAgIClcclxuICApO1xyXG4gIGNvbnN0IGJ0bldyYXAgPSBfbWFrZUVsKCdkaXYnLCAnZGlzcGxheTpmbGV4O2dhcDo4cHgnKTtcclxuICBjb25zdCBjYW5jZWxCdG4gPSBfbWFrZUVsKFxyXG4gICAgJ2J1dHRvbicsXHJcbiAgICAncGFkZGluZzo4cHggMTRweDtiYWNrZ3JvdW5kOnRyYW5zcGFyZW50O2JvcmRlcjoxcHggc29saWQgdmFyKC0tYm9yZGVyLXN1YnRsZSk7Ym9yZGVyLXJhZGl1czo2cHg7Y3Vyc29yOnBvaW50ZXI7Zm9udC13ZWlnaHQ6NzAwO2NvbG9yOnZhcigtLXRleHQtcHJpbWFyeSknLFxyXG4gICAgJ0NhbmNlbGFyJ1xyXG4gICk7XHJcbiAgY2FuY2VsQnRuLm9uY2xpY2sgPSAoKSA9PiB7XHJcbiAgICBjb25zdCBtID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3VwY29taW5nLWRpc2MtbW9kYWwnKTtcclxuICAgIGlmIChtKSBtLnJlbW92ZSgpO1xyXG4gIH07XHJcbiAgYnRuV3JhcC5hcHBlbmRDaGlsZChjYW5jZWxCdG4pO1xyXG4gIGNvbnN0IHNhdmVCdG4gPSBfbWFrZUVsKFxyXG4gICAgJ2J1dHRvbicsXHJcbiAgICAncGFkZGluZzo4cHggMTZweDtiYWNrZ3JvdW5kOiMyNTYzZWI7Y29sb3I6I2ZmZjtib3JkZXI6bm9uZTtib3JkZXItcmFkaXVzOjZweDtjdXJzb3I6cG9pbnRlcjtmb250LXdlaWdodDo3MDAnLFxyXG4gICAgJ0d1YXJkYXIgY2FtYmlvcydcclxuICApO1xyXG4gIHNhdmVCdG4uaWQgPSAndXBjb21pbmctc2F2ZS1idG4nO1xyXG4gIHNhdmVCdG4ub25jbGljayA9IHdpbmRvdy5zYXZlVXBjb21pbmdEaXNjb250aW51ZWRDaGFuZ2VzO1xyXG4gIGJ0bldyYXAuYXBwZW5kQ2hpbGQoc2F2ZUJ0bik7XHJcbiAgZm9vdC5hcHBlbmRDaGlsZChidG5XcmFwKTtcclxuICBjb250LmFwcGVuZENoaWxkKGZvb3QpO1xyXG4gIF9yZW5kZXJVcGNvbWluZ0Rpc2NvbnRpbnVlZExpc3RPbmx5KCk7XHJcbn1cclxuXHJcbndpbmRvdy5vcGVuVXBjb21pbmdEaXNjb250aW51ZWRNb2RhbCA9IGZ1bmN0aW9uICgpIHtcclxuICBfdXBjb21pbmdTZWFyY2hUZXh0ID0gJyc7XHJcbiAgY29uc3QgZXhpc3RpbmcgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgndXBjb21pbmctZGlzYy1tb2RhbCcpO1xyXG4gIGlmIChleGlzdGluZykgZXhpc3RpbmcucmVtb3ZlKCk7XHJcbiAgY29uc3QgZWwgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKTtcclxuICBlbC5pZCA9ICd1cGNvbWluZy1kaXNjLW1vZGFsJztcclxuICBlbC5zdHlsZS5jc3NUZXh0ID1cclxuICAgICdwb3NpdGlvbjpmaXhlZDtpbnNldDowO2JhY2tncm91bmQ6cmdiYSgxNSwyMyw0MiwuNjUpO3otaW5kZXg6MjEwMDtkaXNwbGF5OmZsZXg7YWxpZ24taXRlbXM6Y2VudGVyO2p1c3RpZnktY29udGVudDpjZW50ZXI7cGFkZGluZzozdmgnO1xyXG4gIGVsLm9uY2xpY2sgPSAoZXYpID0+IHtcclxuICAgIGlmIChldi50YXJnZXQgPT09IGVsKSBlbC5yZW1vdmUoKTtcclxuICB9O1xyXG4gIGNvbnN0IGNvbnRlbnQgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKTtcclxuICBjb250ZW50LmlkID0gJ3VwY29taW5nLWRpc2MtY29udGVudCc7XHJcbiAgY29udGVudC5zdHlsZS5jc3NUZXh0ID1cclxuICAgICdiYWNrZ3JvdW5kOnZhcigtLWJnLWVsZXZhdGVkKTtib3JkZXItcmFkaXVzOjEycHg7cGFkZGluZzoyNHB4O21heC13aWR0aDo3NjBweDt3aWR0aDoxMDAlO21heC1oZWlnaHQ6OTB2aDtvdmVyZmxvdzpoaWRkZW47ZGlzcGxheTpmbGV4O2ZsZXgtZGlyZWN0aW9uOmNvbHVtbjtib3gtc2hhZG93OjAgMjBweCA2MHB4IHJnYmEoMCwwLDAsLjQpJztcclxuICBlbC5hcHBlbmRDaGlsZChjb250ZW50KTtcclxuICBkb2N1bWVudC5ib2R5LmFwcGVuZENoaWxkKGVsKTtcclxuICBfcmVuZGVyVXBjb21pbmdEaXNjb250aW51ZWRNb2RhbCgpO1xyXG59O1xyXG5cclxud2luZG93LnNhdmVVcGNvbWluZ0Rpc2NvbnRpbnVlZENoYW5nZXMgPSBhc3luYyBmdW5jdGlvbiAoKSB7XHJcbiAgY29uc3QgYnRuID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3VwY29taW5nLXNhdmUtYnRuJyk7XHJcbiAgaWYgKGJ0bikge1xyXG4gICAgYnRuLmRpc2FibGVkID0gdHJ1ZTtcclxuICAgIGJ0bi50ZXh0Q29udGVudCA9ICdHdWFyZGFuZG9cdTIwMjYnO1xyXG4gICAgYnRuLnN0eWxlLm9wYWNpdHkgPSAnLjYnO1xyXG4gIH1cclxuICAvLyBJdGVyYW1vcyBUT0RPUyBsb3MgY2hlY2tib3hlcyBkZWwgRE9NIChubyBzb2xvIGxvcyB2aXNpYmxlcyBjb24gZWwgZmlsdHJvXHJcbiAgLy8gZGUgYnVzcXVlZGEpLCBwYXJhIG5vIHBlcmRlciBjYW1iaW9zIGhlY2hvcyBhbnRlcyBkZSBmaWx0cmFyLlxyXG4gIC8vIFJlY29uc3RydWltb3MgZWwgU2V0IGRlc2RlIGVsIGVzdGFkbyBhY3R1YWwgZGVsIERPTTogbG8gcXVlIGVzdGEgdGlsZGFkbyBxdWVkYSxcclxuICAvLyBsbyBkZXN0aWxkYWRvIHNlIHF1aXRhIChwZXJvIHNvbG8gcGFyYSBTS1VzIHF1ZSB2ZW1vcyBlbiBlbCBET00gXHUyMDE0IFNLVXNcclxuICAvLyBkZXNjb250aW51YWRvcyBxdWUgbm8gZXN0YW4gZW4gZWwgc2FsZXMgcGxhbiBhY3R1YWwgc2UgcHJlc2VydmFuIGNvbW8gZXN0YWJhbikuXHJcbiAgY29uc3QgYWxsSW5Eb20gPSBkb2N1bWVudC5xdWVyeVNlbGVjdG9yQWxsKCdbZGF0YS11cGNvbWluZy1za3VdJyk7XHJcbiAgY29uc3Qgc2VlbkluRG9tID0gbmV3IFNldCgpO1xyXG4gIGNvbnN0IGNoZWNrZWRJbkRvbSA9IG5ldyBTZXQoKTtcclxuICBhbGxJbkRvbS5mb3JFYWNoKChjYikgPT4ge1xyXG4gICAgY29uc3Qgc2t1ID0gU3RyaW5nKGNiLmdldEF0dHJpYnV0ZSgnZGF0YS11cGNvbWluZy1za3UnKSB8fCAnJylcclxuICAgICAgLnRyaW0oKVxyXG4gICAgICAudG9VcHBlckNhc2UoKTtcclxuICAgIGlmICghc2t1KSByZXR1cm47XHJcbiAgICBzZWVuSW5Eb20uYWRkKHNrdSk7XHJcbiAgICBpZiAoY2IuY2hlY2tlZCkgY2hlY2tlZEluRG9tLmFkZChza3UpO1xyXG4gIH0pO1xyXG4gIGlmICghX2Rpc2NvbnRpbnVlZFNrdXMpIF9kaXNjb250aW51ZWRTa3VzID0gbmV3IFNldCgpO1xyXG4gIGNvbnN0IHByZXYgPSBuZXcgU2V0KF9kaXNjb250aW51ZWRTa3VzKTtcclxuICBjaGVja2VkSW5Eb20uZm9yRWFjaCgoc2t1KSA9PiBfZGlzY29udGludWVkU2t1cy5hZGQoc2t1KSk7XHJcbiAgc2VlbkluRG9tLmZvckVhY2goKHNrdSkgPT4ge1xyXG4gICAgaWYgKCFjaGVja2VkSW5Eb20uaGFzKHNrdSkpIF9kaXNjb250aW51ZWRTa3VzLmRlbGV0ZShza3UpO1xyXG4gIH0pO1xyXG4gIHRyeSB7XHJcbiAgICBhd2FpdCBfc2F2ZURpc2NvbnRpbnVlZFNrdXMoKTtcclxuICAgIGNvbnN0IG1vZGFsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3VwY29taW5nLWRpc2MtbW9kYWwnKTtcclxuICAgIGlmIChtb2RhbCkgbW9kYWwucmVtb3ZlKCk7XHJcbiAgICBfcmVuZGVyUmVjb1NlY3Rpb24oKTtcclxuICB9IGNhdGNoIChlKSB7XHJcbiAgICBfZGlzY29udGludWVkU2t1cyA9IHByZXY7XHJcbiAgICBpZiAoYnRuKSB7XHJcbiAgICAgIGJ0bi5kaXNhYmxlZCA9IGZhbHNlO1xyXG4gICAgICBidG4udGV4dENvbnRlbnQgPSAnR3VhcmRhciBjYW1iaW9zJztcclxuICAgICAgYnRuLnN0eWxlLm9wYWNpdHkgPSAnMSc7XHJcbiAgICB9XHJcbiAgICBhbGVydCgnRXJyb3IgZ3VhcmRhbmRvOiAnICsgKGUubWVzc2FnZSB8fCBlKSk7XHJcbiAgfVxyXG59O1xyXG4iXSwKICAibWFwcGluZ3MiOiAiOzs7QUFZQSxNQUFNLGdCQUFnQjtBQUFBLElBQ3BCLEtBQUs7QUFBQSxJQUNMLFNBQVM7QUFBQSxJQUNULEtBQUs7QUFBQSxJQUNMLE9BQU87QUFBQSxJQUNQLEtBQUs7QUFBQSxJQUNMLFVBQVU7QUFBQSxJQUNWLFNBQVM7QUFBQSxJQUNULEtBQUs7QUFBQSxJQUNMLE9BQU87QUFBQSxJQUNQLE9BQU87QUFBQSxJQUNQLEtBQUs7QUFBQSxJQUNMLE9BQU87QUFBQSxJQUNQLEtBQUs7QUFBQSxJQUNMLE9BQU87QUFBQSxJQUNQLEtBQUs7QUFBQSxJQUNMLE1BQU07QUFBQSxJQUNOLEtBQUs7QUFBQSxJ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
