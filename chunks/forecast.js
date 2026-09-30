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
    const tabsBar = `<div id="forecast-tabs-bar" style="display:flex;gap:0;background:var(--bg-secondary);padding:0 18px;border-bottom:1px solid var(--border-subtle)"><button data-tab="sales-plans" onclick="switchForecastTab('sales-plans')" class="forecast-tab" style="padding:10px 16px;background:transparent;color:var(--text-primary);border:none;border-bottom:3px solid #0d9488;cursor:pointer;font-weight:700;font-size:12px;letter-spacing:.4px;text-transform:uppercase">Sales Plans</button><button data-tab="stat" onclick="switchForecastTab('stat')" class="forecast-tab" style="padding:10px 16px;background:transparent;color:var(--text-muted);border:none;border-bottom:3px solid transparent;cursor:pointer;font-weight:600;font-size:12px;letter-spacing:.4px;text-transform:uppercase">Forecast Estad\xEDstico</button></div>`;
    const tabSalesPlans = '<div id="forecast-tab-sales-plans" style="flex:1;overflow:auto"></div>';
    const tabStat = '<div id="forecast-tab-stat" style="flex:1;overflow:auto;display:none"></div>';
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
      if (isNaN(v) || v < 0.1 || v > 5) {
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL3B1cmUvc2FsZXMtcGxhbi1wYXJzZXIuanMiLCAiLi4vc3JjL2RvbWFpbnMvZm9yZWNhc3QuanMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbIi8vIEB0cy1ub2NoZWNrXHJcbi8vIFB1cmU6IHBhcnNlYSB1biBzaGVldCBTYWxlcyBQbGFuIChmb3JtYXRvIFNVUi9TQVIgZGUgU2hpbWFubykgYSBlc3RydWN0dXJhXHJcbi8vIG5vcm1hbGl6YWRhIHsgc2t1LCBkZXNjcmlwdGlvbiwgbW9xLCBtb250aHM6IHsnWVlZWS1NTSc6IE59IH0uXHJcbi8vIFNpbiBkZXBlbmRlbmNpYXMgXHUyMDE0IHJlY2liZSBlbCBzaGVldCB5YSBkZXNlcmlhbGl6YWRvIHBvciBTaGVldEpTXHJcbi8vIChYTFNYLnV0aWxzLnNoZWV0X3RvX2pzb24oc2hlZXQsIHtoZWFkZXI6MSwgZGVmdmFsOicnfSkpLlxyXG4vLyBUZXN0ZWFibGUgZW4gdml0ZXN0IHNpbiBjYXJnYXIgWExTWC5cclxuLy9cclxuLy8gQ29udGV4dG86IGxvcyBTYWxlcyBQbGFucyBkZSBTaGltYW5vIHZpZW5lbiBjb24gaGVhZGVycyBjb21vXHJcbi8vIFwiU0tVIENvZGUvUGFydCBOb1wiLCBcIkRlc2NyaXB0aW9uXCIsIFwiTU9RIDEyIG1vbnRoc1wiIHkgY29sdW1uYXMgZGUgbWVzZXNcclxuLy8gdGlwbyBcIkphbiAyMDI3XCIsIFwiTWF5IDIwMjdcIiAoYSB2ZWNlcyBjb24gYVx1MDBGMW8gZW4gdW5hIGZpbGEgYXJyaWJhIHkgZWwgbWVzXHJcbi8vIGVuIGxhIGZpbGEgaGVhZGVyKS4gRXN0YSBmbiB0b2xlcmEgYW1ib3MgbGF5b3V0cy5cclxuXHJcbmNvbnN0IE1PTlRIX0FMSUFTRVMgPSB7XHJcbiAgamFuOiAxLFxyXG4gIGphbnVhcnk6IDEsXHJcbiAgZW5lOiAxLFxyXG4gIGVuZXJvOiAxLFxyXG4gIGZlYjogMixcclxuICBmZWJydWFyeTogMixcclxuICBmZWJyZXJvOiAyLFxyXG4gIG1hcjogMyxcclxuICBtYXJjaDogMyxcclxuICBtYXJ6bzogMyxcclxuICBhcHI6IDQsXHJcbiAgYXByaWw6IDQsXHJcbiAgYWJyOiA0LFxyXG4gIGFicmlsOiA0LFxyXG4gIG1heTogNSxcclxuICBtYXlvOiA1LFxyXG4gIGp1bjogNixcclxuICBqdW5lOiA2LFxyXG4gIGp1bmlvOiA2LFxyXG4gIGp1bDogNyxcclxuICBqdWx5OiA3LFxyXG4gIGp1bGlvOiA3LFxyXG4gIGF1ZzogOCxcclxuICBhdWd1c3Q6IDgsXHJcbiAgYWdvOiA4LFxyXG4gIGFnb3N0bzogOCxcclxuICBzZXA6IDksXHJcbiAgc2VwdDogOSxcclxuICBzZXB0ZW1iZXI6IDksXHJcbiAgc2VwdGllbWJyZTogOSxcclxuICBvY3Q6IDEwLFxyXG4gIG9jdG9iZXI6IDEwLFxyXG4gIG9jdHVicmU6IDEwLFxyXG4gIG5vdjogMTEsXHJcbiAgbm92ZW1iZXI6IDExLFxyXG4gIG5vdmllbWJyZTogMTEsXHJcbiAgZGVjOiAxMixcclxuICBkZWNlbWJlcjogMTIsXHJcbiAgZGljOiAxMixcclxuICBkaWNpZW1icmU6IDEyLFxyXG59O1xyXG5cclxuLy8gTm9ybWFsaXphIGxhYmVscyBkZSBtZXNlcyBhICdZWVlZLU1NJy4gUmV0b3JuYSBudWxsIHNpIG5vIG1hdGNoZWEuXHJcbi8vIEZvcm1hdG9zIHNvcG9ydGFkb3M6IFwiSmFuIDIwMjdcIiwgXCJFbmUtMjdcIiwgXCJKYW4vMjAyN1wiLCBcIk1heTI3XCIsXHJcbi8vIFwiMjAyNy0wMVwiLCBcIjAxLzIwMjdcIiwgXCJKYW4uMjAyN1wiLCBcIjIwMjFcXG5KYW5cIiAobXVsdGktbGluZSBFeGNlbCkuXHJcbmZ1bmN0aW9uIG5vcm1hbGl6ZU1vbnRoTGFiZWwobGFiZWwpIHtcclxuICBpZiAobGFiZWwgPT0gbnVsbCkgcmV0dXJuIG51bGw7XHJcbiAgLy8gdjExMDQ6IGNvbGFwc2FyIG5ld2xpbmVzL3RhYnMgYSBlc3BhY2lvIGFudGVzIGRlbCB0cmltLlxyXG4gIC8vIEVsIGZvcm1hdG8gRXhjZWwgXCIyMDIxXFxuSmFuXCIgKGFcdTAwRjFvIGVuIEwxLCBtZXMgZW4gTDIgZGVudHJvIGRlIHVuYSBjZWxkYVxyXG4gIC8vIG11bHRpLXJvdykgZXMgY29tXHUwMEZBbiBlbiBTYWxlcyBQbGFucyBTVVIuIGBcXHMrYCBtYXRjaGVhIHdoaXRlc3BhY2UgaW5jbHV5ZW5kb1xyXG4gIC8vIFxcbiB5IFxcclxcbi5cclxuICBjb25zdCBzID0gU3RyaW5nKGxhYmVsKS5yZXBsYWNlKC9cXHMrL2csICcgJykudHJpbSgpLnRvTG93ZXJDYXNlKCk7XHJcbiAgaWYgKCFzKSByZXR1cm4gbnVsbDtcclxuICBsZXQgbTtcclxuICAvLyBcImphbiAyMDI3XCIgfCBcImphbi0yN1wiIHwgXCJlbmUvMjAyN1wiIHwgXCJtYXkyN1wiIHwgXCJtYXkuMjAyN1wiXHJcbiAgbSA9IHMubWF0Y2goL14oW2Etelx1MDBFMVx1MDBFOVx1MDBFRFx1MDBGM1x1MDBGQV17MywxMH0pW1xcc1xcLS8uX10qKFxcZHsyLDR9KSQvKTtcclxuICBpZiAobSkge1xyXG4gICAgY29uc3QgbW9uID0gTU9OVEhfQUxJQVNFU1ttWzFdXSB8fCBNT05USF9BTElBU0VTW21bMV0uc2xpY2UoMCwgMyldO1xyXG4gICAgaWYgKG1vbikge1xyXG4gICAgICBsZXQgeSA9IHBhcnNlSW50KG1bMl0sIDEwKTtcclxuICAgICAgaWYgKHkgPCAxMDApIHkgPSAyMDAwICsgeTtcclxuICAgICAgcmV0dXJuIFN0cmluZyh5KS5wYWRTdGFydCg0LCAnMCcpICsgJy0nICsgU3RyaW5nKG1vbikucGFkU3RhcnQoMiwgJzAnKTtcclxuICAgIH1cclxuICB9XHJcbiAgLy8gXCIyMDIxIGphblwiIHwgXCIyMDI3IGRpY1wiIChhXHUwMEYxbyBwcmltZXJvICsgbWVzLCBmb3JtYXRvIEV4Y2VsIG11bHRpLWxpbmVcclxuICAvLyBjb2xhcHNhZG8gdHJhcyByZXBsYWNlIFxccyspLlxyXG4gIG0gPSBzLm1hdGNoKC9eKFxcZHs0fSlbXFxzXFwtLy5fXSsoW2Etelx1MDBFMVx1MDBFOVx1MDBFRFx1MDBGM1x1MDBGQV17MywxMH0pJC8pO1xyXG4gIGlmIChtKSB7XHJcbiAgICBjb25zdCB5ID0gcGFyc2VJbnQobVsxXSwgMTApO1xyXG4gICAgY29uc3QgbW9uID0gTU9OVEhfQUxJQVNFU1ttWzJdXSB8fCBNT05USF9BTElBU0VTW21bMl0uc2xpY2UoMCwgMyldO1xyXG4gICAgaWYgKG1vbikgcmV0dXJuIFN0cmluZyh5KS5wYWRTdGFydCg0LCAnMCcpICsgJy0nICsgU3RyaW5nKG1vbikucGFkU3RhcnQoMiwgJzAnKTtcclxuICB9XHJcbiAgLy8gXCIyMDI3LTAxXCIgfCBcIjIwMjcvMDFcIlxyXG4gIG0gPSBzLm1hdGNoKC9eKFxcZHs0fSlbLS9dKFxcZHsxLDJ9KSQvKTtcclxuICBpZiAobSkge1xyXG4gICAgY29uc3QgeSA9IHBhcnNlSW50KG1bMV0sIDEwKTtcclxuICAgIGNvbnN0IG1vbiA9IHBhcnNlSW50KG1bMl0sIDEwKTtcclxuICAgIGlmIChtb24gPj0gMSAmJiBtb24gPD0gMTIpXHJcbiAgICAgIHJldHVybiBTdHJpbmcoeSkucGFkU3RhcnQoNCwgJzAnKSArICctJyArIFN0cmluZyhtb24pLnBhZFN0YXJ0KDIsICcwJyk7XHJcbiAgfVxyXG4gIC8vIFwiMDEvMjAyN1wiIHwgXCIwMS0yMDI3XCJcclxuICBtID0gcy5tYXRjaCgvXihcXGR7MSwyfSlbLS9dKFxcZHs0fSkkLyk7XHJcbiAgaWYgKG0pIHtcclxuICAgIGNvbnN0IG1vbiA9IHBhcnNlSW50KG1bMV0sIDEwKTtcclxuICAgIGNvbnN0IHkgPSBwYXJzZUludChtWzJdLCAxMCk7XHJcbiAgICBpZiAobW9uID49IDEgJiYgbW9uIDw9IDEyKVxyXG4gICAgICByZXR1cm4gU3RyaW5nKHkpLnBhZFN0YXJ0KDQsICcwJykgKyAnLScgKyBTdHJpbmcobW9uKS5wYWRTdGFydCgyLCAnMCcpO1xyXG4gIH1cclxuICByZXR1cm4gbnVsbDtcclxufVxyXG5cclxuLy8gQnVzY2EgbGEgZmlsYSBoZWFkZXIgKDAtYmFzZWQpLiBFc2NhbmVhIGxhcyBwcmltZXJhcyAzMCBmaWxhcy5cclxuZnVuY3Rpb24gZmluZEhlYWRlclJvdyhyb3dzKSB7XHJcbiAgY29uc3QgSEVBREVSX01BUktFUlMgPSBbXHJcbiAgICAnc2t1IGNvZGUvcGFydCBubycsXHJcbiAgICAnc2t1IGNvZGUnLFxyXG4gICAgJ3NrdScsXHJcbiAgICAncGFydCBubycsXHJcbiAgICAncGFydCBudW1iZXInLFxyXG4gICAgJ2l0ZW1jb2RlJyxcclxuICAgICdpdGVtIGNvZGUnLFxyXG4gICAgJ2NvZGlnbycsXHJcbiAgICAnY1x1MDBGM2RpZ28nLFxyXG4gIF07XHJcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBNYXRoLm1pbihyb3dzLmxlbmd0aCwgMzApOyBpKyspIHtcclxuICAgIGNvbnN0IHJvdyA9IHJvd3NbaV0gfHwgW107XHJcbiAgICBmb3IgKGNvbnN0IGNlbGwgb2Ygcm93KSB7XHJcbiAgICAgIC8vIHYxMTA0OiBjb2xhcHNhciBuZXdsaW5lcyBhIGVzcGFjaW8gcGFyYSBtYXRjaGVhciBoZWFkZXJzIGNvbW9cclxuICAgICAgLy8gXCJTS1UgQ29kZS9QYXJ0IE5vXCIgKG9rKSBvIFwiU0tVXFxuQ29kZVwiIChuZWNlc2l0YSBjb2xhcHNhcikuXHJcbiAgICAgIGNvbnN0IHMgPSBTdHJpbmcoY2VsbCA9PSBudWxsID8gJycgOiBjZWxsKVxyXG4gICAgICAgIC5yZXBsYWNlKC9cXHMrL2csICcgJylcclxuICAgICAgICAudHJpbSgpXHJcbiAgICAgICAgLnRvTG93ZXJDYXNlKCk7XHJcbiAgICAgIGlmIChIRUFERVJfTUFSS0VSUy5pbmRleE9mKHMpID49IDApIHJldHVybiBpO1xyXG4gICAgfVxyXG4gIH1cclxuICByZXR1cm4gLTE7XHJcbn1cclxuXHJcbi8vIERldGVjdGEgXHUwMEVEbmRpY2VzIGRlIGNvbHVtbmFzIHkgbWVzZXMuIGBoaW50Um93QWJvdmVgIHBlcm1pdGUgY29tYmluYXIgYVx1MDBGMW8vbWVzXHJcbi8vIGN1YW5kbyBlbCBoZWFkZXIgZXMgbXVsdGktcm93IChhXHUwMEYxbyBhcnJpYmEsIG1lcyBhYmFqbyBvIHZpY2V2ZXJzYSkuXHJcbmZ1bmN0aW9uIGRldGVjdENvbHVtbnMoaGVhZGVyUm93LCBoaW50Um93QWJvdmUpIHtcclxuICBsZXQgc2t1SWR4ID0gLTE7XHJcbiAgbGV0IGRlc2NJZHggPSAtMTtcclxuICBsZXQgbW9xSWR4ID0gLTE7XHJcbiAgY29uc3QgbW9udGhDb2x1bW5zID0gW107XHJcbiAgY29uc3QgZGV0ZWN0ZWRNb250aHNTZXQgPSBuZXcgU2V0KCk7XHJcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBoZWFkZXJSb3cubGVuZ3RoOyBpKyspIHtcclxuICAgIC8vIHYxMTA0OiBjb2xhcHNhciBuZXdsaW5lcyBhIGVzcGFjaW8gYW50ZXMgZGUgY29tcGFyYXIuIExvcyBTYWxlcyBQbGFuXHJcbiAgICAvLyBTVVIgdGllbmVuIGhlYWRlcnMgbXVsdGktbGluZSBjb21vIFwiTU9RXFxuMTIgbW9udGhzXCIgbyBcIkJhc2VcXG5GT0IoVVNEKVwiLlxyXG4gICAgY29uc3QgcmF3ID0gU3RyaW5nKGhlYWRlclJvd1tpXSA9PSBudWxsID8gJycgOiBoZWFkZXJSb3dbaV0pXHJcbiAgICAgIC5yZXBsYWNlKC9cXHMrL2csICcgJylcclxuICAgICAgLnRyaW0oKTtcclxuICAgIGNvbnN0IHMgPSByYXcudG9Mb3dlckNhc2UoKTtcclxuICAgIGlmIChcclxuICAgICAgc2t1SWR4IDwgMCAmJlxyXG4gICAgICAocyA9PT0gJ3NrdSBjb2RlL3BhcnQgbm8nIHx8XHJcbiAgICAgICAgcyA9PT0gJ3NrdSBjb2RlJyB8fFxyXG4gICAgICAgIHMgPT09ICdza3UnIHx8XHJcbiAgICAgICAgcyA9PT0gJ3BhcnQgbm8nIHx8XHJcbiAgICAgICAgcyA9PT0gJ3BhcnQgbnVtYmVyJyB8fFxyXG4gICAgICAgIHMgPT09ICdpdGVtY29kZScgfHxcclxuICAgICAgICBzID09PSAnaXRlbSBjb2RlJyB8fFxyXG4gICAgICAgIHMgPT09ICdjb2RpZ28nIHx8XHJcbiAgICAgICAgcyA9PT0gJ2NcdTAwRjNkaWdvJylcclxuICAgICkge1xyXG4gICAgICBza3VJZHggPSBpO1xyXG4gICAgICBjb250aW51ZTtcclxuICAgIH1cclxuICAgIGlmIChcclxuICAgICAgZGVzY0lkeCA8IDAgJiZcclxuICAgICAgKHMgPT09ICdkZXNjcmlwdGlvbicgfHxcclxuICAgICAgICBzID09PSAnZGVzY3JpcGNpb24nIHx8XHJcbiAgICAgICAgcyA9PT0gJ2Rlc2NyaXBjaVx1MDBGM24nIHx8XHJcbiAgICAgICAgcyA9PT0gJ2l0ZW0gbmFtZScgfHxcclxuICAgICAgICBzID09PSAnaXRlbW5hbWUnKVxyXG4gICAgKSB7XHJcbiAgICAgIGRlc2NJZHggPSBpO1xyXG4gICAgICBjb250aW51ZTtcclxuICAgIH1cclxuICAgIGlmIChtb3FJZHggPCAwICYmIChzID09PSAnbW9xIDEyIG1vbnRocycgfHwgcyA9PT0gJ21vcScgfHwgcy5pbmRleE9mKCdtb3EnKSA9PT0gMCkpIHtcclxuICAgICAgbW9xSWR4ID0gaTtcclxuICAgICAgY29udGludWU7XHJcbiAgICB9XHJcbiAgICAvLyBUcnkgZGlyZWN0IG1vbnRoIHBhcnNlXHJcbiAgICBsZXQgbW9udGhLZXkgPSBub3JtYWxpemVNb250aExhYmVsKHJhdyk7XHJcbiAgICBpZiAoIW1vbnRoS2V5ICYmIGhpbnRSb3dBYm92ZSAmJiBoaW50Um93QWJvdmVbaV0gIT0gbnVsbCkge1xyXG4gICAgICBjb25zdCBoaW50ID0gU3RyaW5nKGhpbnRSb3dBYm92ZVtpXSkudHJpbSgpO1xyXG4gICAgICBpZiAoaGludCkge1xyXG4gICAgICAgIG1vbnRoS2V5ID0gbm9ybWFsaXplTW9udGhMYWJlbChyYXcgKyAnICcgKyBoaW50KSB8fCBub3JtYWxpemVNb250aExhYmVsKGhpbnQgKyAnICcgKyByYXcpO1xyXG4gICAgICB9XHJcbiAgICB9XHJcbiAgICBpZiAobW9udGhLZXkpIHtcclxuICAgICAgbW9udGhDb2x1bW5zLnB1c2goeyBjb2xJZHg6IGksIG1vbnRoS2V5IH0pO1xyXG4gICAgICBkZXRlY3RlZE1vbnRoc1NldC5hZGQobW9udGhLZXkpO1xyXG4gICAgfVxyXG4gIH1cclxuICByZXR1cm4ge1xyXG4gICAgc2t1SWR4LFxyXG4gICAgZGVzY0lkeCxcclxuICAgIG1vcUlkeCxcclxuICAgIG1vbnRoQ29sdW1ucyxcclxuICAgIGRldGVjdGVkTW9udGhzOiBBcnJheS5mcm9tKGRldGVjdGVkTW9udGhzU2V0KS5zb3J0KCksXHJcbiAgfTtcclxufVxyXG5cclxuLy8gUHVibGljOiBwYXJzZSBmdWxsIHNoZWV0LiBUaHJvd3Mgb24gbWlzc2luZyBTS1UgY29sdW1uIC8gbW9udGhzLlxyXG5mdW5jdGlvbiBwYXJzZVNhbGVzUGxhblNoZWV0KHJvd3MpIHtcclxuICBpZiAoIXJvd3MgfHwgIXJvd3MubGVuZ3RoKSB7XHJcbiAgICBjb25zdCBlcnIgPSBuZXcgRXJyb3IoJ0V4Y2VsIHZhY2lvJyk7XHJcbiAgICBlcnIuY29kZSA9ICdFTVBUWV9TSEVFVCc7XHJcbiAgICB0aHJvdyBlcnI7XHJcbiAgfVxyXG4gIGNvbnN0IGhlYWRlcklkeCA9IGZpbmRIZWFkZXJSb3cocm93cyk7XHJcbiAgaWYgKGhlYWRlcklkeCA8IDApIHtcclxuICAgIGNvbnN0IGVyciA9IG5ldyBFcnJvcignTm8gc2UgZW5jb250cm8gZmlsYSBkZSBoZWFkZXJzIChidXNjYWJhIFwiU0tVIENvZGUvUGFydCBOb1wiIG8gXCJTS1VcIiknKTtcclxuICAgIGVyci5jb2RlID0gJ0hFQURFUl9OT1RfRk9VTkQnO1xyXG4gICAgdGhyb3cgZXJyO1xyXG4gIH1cclxuICBjb25zdCBoZWFkZXJSb3cgPSByb3dzW2hlYWRlcklkeF0gfHwgW107XHJcbiAgY29uc3Qgcm93QWJvdmUgPSBoZWFkZXJJZHggPiAwID8gcm93c1toZWFkZXJJZHggLSAxXSB8fCBbXSA6IG51bGw7XHJcbiAgY29uc3QgY29scyA9IGRldGVjdENvbHVtbnMoaGVhZGVyUm93LCByb3dBYm92ZSk7XHJcbiAgaWYgKGNvbHMuc2t1SWR4IDwgMCkge1xyXG4gICAgY29uc3QgZXJyID0gbmV3IEVycm9yKCdObyBzZSBlbmNvbnRybyBjb2x1bW5hIFNLVSBlbiBsYSBmaWxhIGhlYWRlcicpO1xyXG4gICAgZXJyLmNvZGUgPSAnU0tVX0NPTF9NSVNTSU5HJztcclxuICAgIHRocm93IGVycjtcclxuICB9XHJcbiAgaWYgKCFjb2xzLm1vbnRoQ29sdW1ucy5sZW5ndGgpIHtcclxuICAgIGNvbnN0IGVyciA9IG5ldyBFcnJvcihcclxuICAgICAgJ05vIHNlIGRldGVjdGFyb24gY29sdW1uYXMgZGUgbWVzZXMgZW4gZWwgaGVhZGVyIChlajogXCJKYW4gMjAyN1wiLCBcIk1heSAyMDI3XCIpJ1xyXG4gICAgKTtcclxuICAgIGVyci5jb2RlID0gJ01PTlRIU19OT1RfRk9VTkQnO1xyXG4gICAgdGhyb3cgZXJyO1xyXG4gIH1cclxuICBjb25zdCBwYXJzZWRSb3dzID0gW107XHJcbiAgY29uc3Qgc2VlblNrdSA9IG5ldyBTZXQoKTtcclxuICBmb3IgKGxldCByID0gaGVhZGVySWR4ICsgMTsgciA8IHJvd3MubGVuZ3RoOyByKyspIHtcclxuICAgIGNvbnN0IHJvdyA9IHJvd3Nbcl0gfHwgW107XHJcbiAgICBjb25zdCBza3VSYXcgPSByb3dbY29scy5za3VJZHhdO1xyXG4gICAgaWYgKHNrdVJhdyA9PSBudWxsIHx8IFN0cmluZyhza3VSYXcpLnRyaW0oKSA9PT0gJycpIGNvbnRpbnVlO1xyXG4gICAgY29uc3Qgc2t1ID0gU3RyaW5nKHNrdVJhdykudHJpbSgpO1xyXG4gICAgY29uc3QgdXBwZXIgPSBza3UudG9VcHBlckNhc2UoKTtcclxuICAgIC8vIFNraXAgZmlsYXMgVE9UQUwgLyBTVU0gLyBTVUJUT1RBTFxyXG4gICAgaWYgKHVwcGVyID09PSAnVE9UQUwnIHx8IHVwcGVyID09PSAnU1VNJyB8fCB1cHBlciA9PT0gJ1NVQlRPVEFMJyB8fCB1cHBlciA9PT0gJ1RPVEFMRVMnKVxyXG4gICAgICBjb250aW51ZTtcclxuICAgIGlmIChzZWVuU2t1Lmhhcyh1cHBlcikpIGNvbnRpbnVlOyAvLyBkZWR1cGVcclxuICAgIHNlZW5Ta3UuYWRkKHVwcGVyKTtcclxuICAgIGNvbnN0IGRlc2NyaXB0aW9uID1cclxuICAgICAgY29scy5kZXNjSWR4ID49IDAgPyBTdHJpbmcocm93W2NvbHMuZGVzY0lkeF0gPT0gbnVsbCA/ICcnIDogcm93W2NvbHMuZGVzY0lkeF0pLnRyaW0oKSA6ICcnO1xyXG4gICAgY29uc3QgbW9xUmF3ID0gY29scy5tb3FJZHggPj0gMCA/IHJvd1tjb2xzLm1vcUlkeF0gOiBudWxsO1xyXG4gICAgY29uc3QgbW9xTnVtID0gTnVtYmVyKG1vcVJhdyk7XHJcbiAgICBjb25zdCBtb3EgPSBOdW1iZXIuaXNGaW5pdGUobW9xTnVtKSAmJiBtb3FOdW0gPiAwID8gTWF0aC5yb3VuZChtb3FOdW0pIDogMDtcclxuICAgIGNvbnN0IG1vbnRocyA9IHt9O1xyXG4gICAgZm9yIChjb25zdCBtYyBvZiBjb2xzLm1vbnRoQ29sdW1ucykge1xyXG4gICAgICBjb25zdCB2ID0gcm93W21jLmNvbElkeF07XHJcbiAgICAgIGNvbnN0IG4gPSBOdW1iZXIodik7XHJcbiAgICAgIGlmIChOdW1iZXIuaXNGaW5pdGUobikgJiYgbiA+IDApIHtcclxuICAgICAgICBtb250aHNbbWMubW9udGhLZXldID0gTWF0aC5yb3VuZChuKTtcclxuICAgICAgfVxyXG4gICAgfVxyXG4gICAgcGFyc2VkUm93cy5wdXNoKHsgc2t1LCBkZXNjcmlwdGlvbiwgbW9xLCBtb250aHMgfSk7XHJcbiAgfVxyXG4gIHJldHVybiB7XHJcbiAgICBoZWFkZXJSb3dJbmRleDogaGVhZGVySWR4LFxyXG4gICAgZGV0ZWN0ZWRNb250aHM6IGNvbHMuZGV0ZWN0ZWRNb250aHMsXHJcbiAgICByb3dzQ291bnQ6IHBhcnNlZFJvd3MubGVuZ3RoLFxyXG4gICAgcm93czogcGFyc2VkUm93cyxcclxuICB9O1xyXG59XHJcblxyXG4vLyBVTUQtaXNoIGV4cG9ydDogcGFyYSB2aXRlc3QgKG1vZHVsZS5leHBvcnRzKSB5IHBhcmEgYnVuZGxlIGJyb3dzZXIgKHdpbmRvdyBnbG9iYWwpLlxyXG5pZiAodHlwZW9mIG1vZHVsZSAhPT0gJ3VuZGVmaW5lZCcgJiYgbW9kdWxlLmV4cG9ydHMpIHtcclxuICBtb2R1bGUuZXhwb3J0cyA9IHsgcGFyc2VTYWxlc1BsYW5TaGVldCwgbm9ybWFsaXplTW9udGhMYWJlbCwgZmluZEhlYWRlclJvdywgZGV0ZWN0Q29sdW1ucyB9O1xyXG59XHJcbmlmICh0eXBlb2Ygd2luZG93ICE9PSAndW5kZWZpbmVkJykge1xyXG4gIHdpbmRvdy5TYWxlc1BsYW5QYXJzZXIgPSB7XHJcbiAgICBwYXJzZVNhbGVzUGxhblNoZWV0LFxyXG4gICAgbm9ybWFsaXplTW9udGhMYWJlbCxcclxuICAgIGZpbmRIZWFkZXJSb3csXHJcbiAgICBkZXRlY3RDb2x1bW5zLFxyXG4gIH07XHJcbn1cclxuXHJcbmV4cG9ydCB7IGRldGVjdENvbHVtbnMsIGZpbmRIZWFkZXJSb3csIG5vcm1hbGl6ZU1vbnRoTGFiZWwsIHBhcnNlU2FsZXNQbGFuU2hlZXQgfTtcclxuIiwgIi8vIEB0cy1ub2NoZWNrXG4vLyB2MTA5OCsgRmFzZSAxOiBpbXBvcnQgZGVsIHBhcnNlciBwdXJvLiBFbCBtXHUwMEYzZHVsbyBoYWNlIGB3aW5kb3cuU2FsZXNQbGFuUGFyc2VyYFxuLy8gY29tbyBzaWRlLWVmZmVjdCB5IHRhbWJpXHUwMEU5biBleHBvcnRhIGxhcyBmbnMgbm9tYnJhZGFzOyB1c2Ftb3Mgc2lkZS1lZmZlY3Rcbi8vIHBvcnF1ZSBmb3JlY2FzdC5qcyBjb3JyZSBlbiBlbCBjaHVuayBsYXp5IHkgd2luZG93IHlhIGVzdFx1MDBFMSBkaXNwb25pYmxlLlxuaW1wb3J0ICcuLi9wdXJlL3NhbGVzLXBsYW4tcGFyc2VyLmpzJztcblxuLy8gR2xvYmFscyBsZWlkb3MgZGVsIGVudG9ybm8gKGRlY2xhcmFkb3MgZW4gaW5kZXguaHRtbCBpbmxpbmUgbyBidW5kbGUgcHJldmlvKTpcbi8vIGZiRGIsIGN1cnJlbnRVc2VyLCBYTFNYIChjZG4pLCBlc2NhcGVIdG1sLiBNaXNtbyBwYXRyb24gcXVlIG90cm9zIGRvbWluaW9zLlxuLy9cbi8vIEZPUkVDQVNUIC0gbW9kYWwgYWRtaW4tb25seSAoTWFyaWFubykuIENodW5rIGxhenk6IHNlIGNhcmdhIHNvbG8gYWwgcHJpbWVyXG4vLyBjbGljayBkZWwgYm90b24gRk9SRUNBU1QgZGVsIGhlYWRlci4gUmVnaXN0cmFkbyBlbiBidWlsZC5qcyBMQVpZX0NIVU5LUyArXG4vLyBzcmMvbWFpbi5qcyBpbnN0YWxsQ2h1bmtTdHVicyArIHN3LmpzIFNUQVRJQ19BU1NFVFMuIFZlciBDTEFVREUubWQgIzE4LlxuLy9cbi8vIHYxMTExIGNsZWFuOiBwaXBlbGluZSBsZWdhY3kgKFNLVSArIDYgY29sdW1uYXMgKyBwb2xpdGljYSAzbSkgcmVtb3ZpZG8uXG4vLyBSZWVtcGxhemFkbyBwb3I6XG4vLyAgIC0gRmFzZSAxICh2MTA5OCk6IFNhbGVzIFBsYW5zIG1lbnN1YWxlcyBSb2RzL1JlZWxzIGNvbiBmb3JtYXRvIFNVUi5cbi8vICAgLSBGYXNlIDJCICh2MTEwMyk6IEZvcmVjYXN0IEVzdGFkaXN0aWNvIChzdGF0c2ZvcmVjYXN0IHBpcGVsaW5lIG9mZmxpbmUpLlxuLy8gICAtIEZhc2UgM0EgKHYxMTA5KTogVGFibGEgUmVjb21lbmRhY2lvbiBkZSBDb21wcmEuXG5cbi8vIHYxMDk4KyAoRmFzZSAxIEZvcmVjYXN0IHYyKTogU2FsZXMgUGxhbnMgbWVuc3VhbGVzIHBvciBmYW1pbGlhIChSb2RzL1JlZWxzL0ZHKS5cbi8vIFNlIGd1YXJkYW4gZW4gRmlyZXN0b3JlIGBzYWxlc19wbGFuX2NhY2hlL3tmYW1pbGlhfWAgKyBzbmFwc2hvdCBFeGNlbCBvcmlnaW5hbFxuLy8gZW4gU3RvcmFnZSBgZm9yZWNhc3RzX3NuYXBzaG90cy97WVlZWS1NTX0ve2ZhbWlsaWF9Lnhsc3hgLlxuLy8gRWwgcGFyc2VyIHB1cm8gdml2ZSBlbiBzcmMvcHVyZS9zYWxlcy1wbGFuLXBhcnNlci5qcyAoYXR0YWNoIGEgd2luZG93LlNhbGVzUGxhblBhcnNlcikuXG4vLyB2MTEwODogRkcgcmVtb3ZpZG8gZGVsIFVJIChNYXJpYW5vIHBpZGlcdTAwRjMpLiBTb2xvIFJvZHMgKyBSZWVscyBwb3IgYWhvcmEuXG4vLyBMYSBydWxlIEZpcmVzdG9yZSBzaWd1ZSBhY2VwdGFuZG8gJ2ZnJyBwb3Igc2kgZW4gZWwgZnV0dXJvIHNlIHZ1ZWx2ZSBhXG4vLyBhY3RpdmFyIFx1MjAxNCBubyBib3JyYXJsYSBlbiBzdG9yYWdlL2ZpcmVzdG9yZS5ydWxlcyBoYXN0YSBjb25maXJtYXIgZGVwcmVjYXRlLlxuY29uc3QgU0FMRVNfUExBTl9GQU1JTElBUyA9IFtcbiAgeyBrZXk6ICdyb2RzJywgbGFiZWw6ICdSb2RzIChDYVx1MDBGMWFzKScsIGNvbG9yOiAnIzBlYTVlOScgfSxcbiAgeyBrZXk6ICdyZWVscycsIGxhYmVsOiAnUmVlbHMnLCBjb2xvcjogJyM4YjVjZjYnIH0sXG5dO1xuY29uc3QgX3NhbGVzUGxhbkNhY2hlcyA9IHsgcm9kczogbnVsbCwgcmVlbHM6IG51bGwgfTsgLy8gbGFzdCBsb2FkZWQgZG9jXG5sZXQgX2ZvcmVjYXN0QWN0aXZlVGFiID0gJ3NhbGVzLXBsYW5zJzsgLy8gJ3NhbGVzLXBsYW5zJyB8ICdzdGF0JyB8ICdsZWdhY3knXG5cbi8vIHYxMTAzKyAoRmFzZSAyQik6IEZvcmVjYXN0IEVzdGFkXHUwMEVEc3RpY28gXHUyMDE0IG91dHB1dCBwdWJsaWNhZG8gcG9yXG4vLyBzY3JpcHRzL2ZvcmVjYXN0L3B1Ymxpc2hfdG9fZmlyZXN0b3JlLnB5IGEgZm9yZWNhc3Rfb3V0cHV0L3tzdWJfc2x1Z31cbi8vICsgZm9yZWNhc3Rfb3V0cHV0X21ldGEvY3VycmVudC4gMjQgc3VicyArIDEgbWV0YSBkb2MuXG5sZXQgX2ZvcmVjYXN0U3RhdERvY3MgPSBudWxsOyAvLyBbe2lkLCBzdWJmYW1pbGlhLCBmb3JlY2FzdFs3XSwgbWV0cmljcywgYmVzdE1vZGVsLCB2ZXJzaW9uSWR9XVxubGV0IF9mb3JlY2FzdFN0YXRNZXRhID0gbnVsbDsgLy8ge2dlbmVyYXRlZEF0LCB2ZXJzaW9uSWQsIHJlc3VtZW46IHsuLi59fVxubGV0IF9mb3JlY2FzdFN0YXRIaXN0b3J5Q2FjaGUgPSBudWxsOyAvLyB7IFtzdWJdOiBbe2RzLCB5fV0gfSBjYWNoZSBsYXp5IG9uLWRlbWFuZFxuXG4vLyB2MTEwOSsgKEZhc2UgM0EpOiBUYWJsYSBSZWNvbWVuZGFjaVx1MDBGM24gZGUgQ29tcHJhIFx1MjAxNCBjb21iaW5hIHNhbGVzIHBsYW5zICtcbi8vIHN0b2NrX3NuYXBzaG90ICsgc2t1X3ZlbnRhc19zbmFwc2hvdCBwYXJhIGNvbXB1dGFyIHJlY29tZW5kYWRvIHBvciBTS1UuXG5sZXQgX3JlY29TdG9ja1NuYXBzaG90ID0gbnVsbDsgLy8ge3dhcmVob3VzZUJyZWFrZG93bjoge3NrdTp7JzExJzpuLCcxMic6biwuLi59fSwgYmFja29yZGVyQnlTa3U6IHtza3U6bn19XG5sZXQgX3JlY29WZW50YXNTbmFwc2hvdCA9IG51bGw7IC8vIHsgW1NLVSB1cHBlcl06IHttZXNlczogeydZWVlZLU1NJzoge3F0eSxhcnN9fX0gfVxubGV0IF9yZWNvRmlsdGVyTWluUmVjID0gdHJ1ZTsgLy8gXCJzb2xvIG1vc3RyYXIgU0tVcyBjb24gcmVjb21lbmRhZG8gPiAwXCJcbmxldCBfcmVjb0ZpbHRlckZhbWlsaWEgPSAnYWxsJzsgLy8gJ2FsbCcgfCAncm9kcycgfCAncmVlbHMnXG5sZXQgX3JlY29TZWFyY2hUZXh0ID0gJyc7XG5cbi8vIHYxMTEyKyAoRjNCKTogU0tVcyBkZXNjb250aW51YWRvcyBxdWUgTWFyaWFubyBtYXJjYSBwYXJhIGV4Y2x1aXIgZGVsIGZvcmVjYXN0LlxuLy8gUGVyc2lzdGVuIGVuIEZpcmVzdG9yZSBgZm9yZWNhc3RfY29uZmlnL2Rpc2NvbnRpbnVlZF9za3VzYCBjb21vIHsgc2t1czogW1NLVSB1cHBlcl0sIHVwZGF0ZWRBdCwgdXBkYXRlZEJ5IH0uXG5sZXQgX2Rpc2NvbnRpbnVlZFNrdXMgPSBudWxsOyAvLyBTZXQ8c3RyaW5nIHVwcGVyPiBvIG51bGwgc2kgbm8gY2FyZ2Fkb1xubGV0IF9kaXNjb250aW51ZWRNZXRhID0gbnVsbDsgLy8ge3VwZGF0ZWRBdCwgdXBkYXRlZEJ5fVxuXG4vLyB2MTExNCsgKEYzQiBtdWx0aXBsaWNhZG9yIGRpblx1MDBFMW1pY28pOiBtdWx0aXBsaWNhZG9yIGF1dG8gcG9yIFNLVSA9IHZlbnRhXzJtXG4vLyBkaXZpZGlkbyBwb3IgdmVudGFfNm0sIGNvbiBjYXAuIE92ZXJyaWRlIG1hbnVhbCBwZXJzaXN0aWRvIGVuIEZpcmVzdG9yZVxuLy8gYGZvcmVjYXN0X2NvbmZpZy9tdWx0aXBsaWVyc2AgY29uIHtza3VPdmVycmlkZXM6IHtTS1U6IHt2YWx1ZSwgdXBkYXRlZEJ5LCB1cGRhdGVkQXR9fX0uXG5sZXQgX211bHRpcGxpZXJPdmVycmlkZXMgPSBudWxsOyAvLyB7IFtTS1UgdXBwZXJdOiB7dmFsdWUsIHVwZGF0ZWRCeSwgdXBkYXRlZEF0fSB9XG5jb25zdCBSRUNPX01VTFRfUkVDRU5UX01PTlRIUyA9IDI7XG5jb25zdCBSRUNPX01VTFRfQkFTRUxJTkVfTU9OVEhTID0gNjtcbmNvbnN0IFJFQ09fTVVMVF9NSU4gPSAwLjU7XG5jb25zdCBSRUNPX01VTFRfTUFYID0gMi41O1xuY29uc3QgUkVDT19NVUxUX01JTl9CQVNFTElORSA9IDAuMTsgLy8gZXZpdGEgZGl2aXNpXHUwMEYzbiBwb3IgY2Vyb1xuXG5jb25zdCBSRUNPX0hPUklaT05fTU9OVEhTID0gNztcbmNvbnN0IFJFQ09fVkVOVEFfUFJPTUVESU9fV0lORE9XID0gMzsgLy8gbWVzZXMgaGFjaWEgYXRyXHUwMEUxcyBwYXJhIHByb21lZGlvIHZlbnRhXG5jb25zdCBSRUNPX0RFRkFVTFRfTVVMVElQTElFUiA9IDEuMDtcblxuLy8gV2hpdGVsaXN0IGRlIGVtYWlscyBjb24gYWNjZXNvIGFsIG1vZGFsIEZPUkVDQVNULiBSZXBsaWNhIGVsIHBhdHJvbiBkZVxuLy8gXCJBbmFsaXNpc1wiIChpbmRleC5odG1sOjEyNjI1KS4gU29sbyBNYXJpYW5vOyBzaSBvdHJvIGFkbWluIGxvIG5lY2VzaXRhXG4vLyBzZSBhZ3JlZ2EgYWNhIGV4cGxpY2l0by5cbmNvbnN0IEZPUkVDQVNUX0FMTE9XRURfRU1BSUxTID0gWydtYXJpYW5vLmVyYmlub0BzaGltYW5vLmNvbS5hcicsICdlcmJpbm9tYXJpYW5vQGdtYWlsLmNvbSddO1xuXG5mdW5jdGlvbiBfY2FuRm9yZWNhc3QoKSB7XG4gIHRyeSB7XG4gICAgY29uc3QgZW1haWwgPSAoKHdpbmRvdy5jdXJyZW50VXNlciAmJiB3aW5kb3cuY3VycmVudFVzZXIuZW1haWwpIHx8ICcnKS50b0xvd2VyQ2FzZSgpO1xuICAgIGlmICghZW1haWwpIHJldHVybiBmYWxzZTtcbiAgICByZXR1cm4gRk9SRUNBU1RfQUxMT1dFRF9FTUFJTFMuaW5kZXhPZihlbWFpbCkgPj0gMDtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG59XG5cbmZ1bmN0aW9uIF9yZW5kZXJNb2RhbFNoZWxsKCkge1xuICBjb25zdCBleGlzdGluZyA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdmb3JlY2FzdC1tb2RhbCcpO1xuICBpZiAoZXhpc3RpbmcpIHJldHVybiBleGlzdGluZztcbiAgY29uc3QgZWwgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKTtcbiAgZWwuaWQgPSAnZm9yZWNhc3QtbW9kYWwnO1xuICBlbC5jbGFzc05hbWUgPSAnbW9kYWwtb3ZlcmxheSc7XG4gIGVsLnN0eWxlLmNzc1RleHQgPVxuICAgICdkaXNwbGF5Om5vbmU7cG9zaXRpb246Zml4ZWQ7aW5zZXQ6MDtiYWNrZ3JvdW5kOnJnYmEoMTUsMjMsNDIsLjYpO3otaW5kZXg6MjA1MDsnO1xuICBlbC5vbmNsaWNrID0gZnVuY3Rpb24gKGV2KSB7XG4gICAgaWYgKGV2LnRhcmdldCA9PT0gZWwpIHdpbmRvdy5jbG9zZUZvcmVjYXN0TW9kYWwoKTtcbiAgfTtcbiAgLy8gU2hlbGwgKyB0YWJzIGJhciArIDIgY29udGVuZWRvcmVzIGRlIHRhYnMgKFNhbGVzIFBsYW5zIG51ZXZhLCBMZWdhY3kgNm0pLlxuICAvLyBFbCBjb250ZW5pZG8gZGUgY2FkYSB0YWIgc2UgcGludGEgY29uIF9yZW5kZXJTYWxlc1BsYW5zVGFiKCkgeSBlbCBsZWdhY3lcbiAgLy8gdXNhIGVsIGZsdWpvIF9yZW5kZXJUYWJsZSgpIGRlIHNpZW1wcmUuXG4gIGNvbnN0IHNoZWxsSHRtbCA9IF9idWlsZFNoZWxsSHRtbCgpO1xuICBlbC5pbm5lckhUTUwgPSBzaGVsbEh0bWw7XG4gIGRvY3VtZW50LmJvZHkuYXBwZW5kQ2hpbGQoZWwpO1xuICByZXR1cm4gZWw7XG59XG5cbmZ1bmN0aW9uIF9idWlsZFNoZWxsSHRtbCgpIHtcbiAgLy8gQnJva2VuLW91dCBwdXJlIHN0cmluZyBidWlsZGVyIHBhcmEgcGFzYXIgZWwgaG9vayBkZSBpbm5lckhUTUwuXG4gIGNvbnN0IG1vZGFsT3V0ZXIgPVxuICAgICc8ZGl2IHN0eWxlPVwicG9zaXRpb246YWJzb2x1dGU7aW5zZXQ6MXZoIDF2dztiYWNrZ3JvdW5kOnZhcigtLWJnLWVsZXZhdGVkKTtib3JkZXItcmFkaXVzOjEwcHg7ZGlzcGxheTpmbGV4O2ZsZXgtZGlyZWN0aW9uOmNvbHVtbjtvdmVyZmxvdzpoaWRkZW47Ym94LXNoYWRvdzowIDIwcHggNTBweCByZ2JhKDAsMCwwLC4zNSlcIj4nO1xuICBjb25zdCBoZWFkZXIgPVxuICAgICc8ZGl2IHN0eWxlPVwicGFkZGluZzoxMnB4IDE4cHg7YmFja2dyb3VuZDojMGYxNzJhO2NvbG9yOiNmZmY7ZGlzcGxheTpmbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtnYXA6MTJweFwiPicgK1xuICAgICc8ZGl2IHN0eWxlPVwiZmxleDoxXCI+PGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxNnB4O2ZvbnQtd2VpZ2h0OjgwMDtsZXR0ZXItc3BhY2luZzouNXB4XCI+Rk9SRUNBU1Q8L2Rpdj4nICtcbiAgICAnPGRpdiBpZD1cImZvcmVjYXN0LXN1YnRpdGxlXCIgc3R5bGU9XCJmb250LXNpemU6MTFweDtvcGFjaXR5Oi44O21hcmdpbi10b3A6MnB4XCI+U2FsZXMgUGxhbnMgbWVuc3VhbGVzICsgcG9saXRpY2EgZGUgaW52ZW50YXJpbzwvZGl2PjwvZGl2PicgK1xuICAgICc8YnV0dG9uIG9uY2xpY2s9XCJjbG9zZUZvcmVjYXN0TW9kYWwoKVwiIHN0eWxlPVwiYmFja2dyb3VuZDp0cmFuc3BhcmVudDtjb2xvcjojZmZmO2JvcmRlcjoxcHggc29saWQgcmdiYSgyNTUsMjU1LDI1NSwuNCk7Ym9yZGVyLXJhZGl1czo2cHg7cGFkZGluZzo2cHggMTBweDtjdXJzb3I6cG9pbnRlcjtmb250LXdlaWdodDo3MDBcIj5DZXJyYXI8L2J1dHRvbj4nICtcbiAgICAnPC9kaXY+JztcbiAgLy8gdjExMTE6IHRhYiBcIkxlZ2FjeSAoNm0pXCIgZWxpbWluYWRhIFx1MjAxNCBlbCBwaXBlbGluZSB2aWVqbyAoU0tVICsgNiBjb2x1bW5hc1xuICAvLyB2cyBza3VfdmVudGFzX3NuYXBzaG90ICsgcG9sXHUwMEVEdGljYSAzbSkgZnVlIHJlZW1wbGF6YWRvIHBvciBsYSB0YWJsYVxuICAvLyBSZWNvbWVuZGFjaVx1MDBGM24gZGUgQ29tcHJhICh2MTEwOSwgRjNBKSBxdWUgdXNhIGRhdG9zIG1cdTAwRTFzIGNvbXBsZXRvcy5cbiAgY29uc3QgdGFic0JhciA9XG4gICAgJzxkaXYgaWQ9XCJmb3JlY2FzdC10YWJzLWJhclwiIHN0eWxlPVwiZGlzcGxheTpmbGV4O2dhcDowO2JhY2tncm91bmQ6dmFyKC0tYmctc2Vjb25kYXJ5KTtwYWRkaW5nOjAgMThweDtib3JkZXItYm90dG9tOjFweCBzb2xpZCB2YXIoLS1ib3JkZXItc3VidGxlKVwiPicgK1xuICAgICc8YnV0dG9uIGRhdGEtdGFiPVwic2FsZXMtcGxhbnNcIiBvbmNsaWNrPVwic3dpdGNoRm9yZWNhc3RUYWIoXFwnc2FsZXMtcGxhbnNcXCcpXCIgY2xhc3M9XCJmb3JlY2FzdC10YWJcIiBzdHlsZT1cInBhZGRpbmc6MTBweCAxNnB4O2JhY2tncm91bmQ6dHJhbnNwYXJlbnQ7Y29sb3I6dmFyKC0tdGV4dC1wcmltYXJ5KTtib3JkZXI6bm9uZTtib3JkZXItYm90dG9tOjNweCBzb2xpZCAjMGQ5NDg4O2N1cnNvcjpwb2ludGVyO2ZvbnQtd2VpZ2h0OjcwMDtmb250LXNpemU6MTJweDtsZXR0ZXItc3BhY2luZzouNHB4O3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZVwiPlNhbGVzIFBsYW5zPC9idXR0b24+JyArXG4gICAgJzxidXR0b24gZGF0YS10YWI9XCJzdGF0XCIgb25jbGljaz1cInN3aXRjaEZvcmVjYXN0VGFiKFxcJ3N0YXRcXCcpXCIgY2xhc3M9XCJmb3JlY2FzdC10YWJcIiBzdHlsZT1cInBhZGRpbmc6MTBweCAxNnB4O2JhY2tncm91bmQ6dHJhbnNwYXJlbnQ7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7Ym9yZGVyOm5vbmU7Ym9yZGVyLWJvdHRvbTozcHggc29saWQgdHJhbnNwYXJlbnQ7Y3Vyc29yOnBvaW50ZXI7Zm9udC13ZWlnaHQ6NjAwO2ZvbnQtc2l6ZToxMnB4O2xldHRlci1zcGFjaW5nOi40cHg7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlXCI+Rm9yZWNhc3QgRXN0YWRcdTAwRURzdGljbzwvYnV0dG9uPicgK1xuICAgICc8L2Rpdj4nO1xuICBjb25zdCB0YWJTYWxlc1BsYW5zID0gJzxkaXYgaWQ9XCJmb3JlY2FzdC10YWItc2FsZXMtcGxhbnNcIiBzdHlsZT1cImZsZXg6MTtvdmVyZmxvdzphdXRvXCI+PC9kaXY+JztcbiAgY29uc3QgdGFiU3RhdCA9ICc8ZGl2IGlkPVwiZm9yZWNhc3QtdGFiLXN0YXRcIiBzdHlsZT1cImZsZXg6MTtvdmVyZmxvdzphdXRvO2Rpc3BsYXk6bm9uZVwiPjwvZGl2Pic7XG4gIHJldHVybiBtb2RhbE91dGVyICsgaGVhZGVyICsgdGFic0JhciArIHRhYlNhbGVzUGxhbnMgKyB0YWJTdGF0ICsgJzwvZGl2Pic7XG59XG5cbi8vIHYxMDk4KyBGYXNlIDEgKyB2MTEwMysgRmFzZSAyQiArIHYxMTA1IGZpeCArIHYxMTExIGNsZWFuIGxlZ2FjeTogc3dpdGNoXG4vLyBlbnRyZSB0YWJzIFNhbGVzIFBsYW5zIC8gRm9yZWNhc3QgRXN0YWRcdTAwRURzdGljby5cbndpbmRvdy5zd2l0Y2hGb3JlY2FzdFRhYiA9IGZ1bmN0aW9uICh0YWJJZCkge1xuICBfZm9yZWNhc3RBY3RpdmVUYWIgPSB0YWJJZDtcbiAgY29uc3Qgc3AgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZm9yZWNhc3QtdGFiLXNhbGVzLXBsYW5zJyk7XG4gIGNvbnN0IHN0ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2ZvcmVjYXN0LXRhYi1zdGF0Jyk7XG4gIGlmIChzcCkgc3Auc3R5bGUuZGlzcGxheSA9IHRhYklkID09PSAnc2FsZXMtcGxhbnMnID8gJ2Jsb2NrJyA6ICdub25lJztcbiAgaWYgKHN0KSBzdC5zdHlsZS5kaXNwbGF5ID0gdGFiSWQgPT09ICdzdGF0JyA/ICdibG9jaycgOiAnbm9uZSc7XG4gIGNvbnN0IGJ0bnMgPSBkb2N1bWVudC5xdWVyeVNlbGVjdG9yQWxsKCcjZm9yZWNhc3QtdGFicy1iYXIgLmZvcmVjYXN0LXRhYicpO1xuICBidG5zLmZvckVhY2goKGIpID0+IHtcbiAgICBjb25zdCBhY3RpdmUgPSBiLmdldEF0dHJpYnV0ZSgnZGF0YS10YWInKSA9PT0gdGFiSWQ7XG4gICAgYi5zdHlsZS5jb2xvciA9IGFjdGl2ZSA/ICd2YXIoLS10ZXh0LXByaW1hcnkpJyA6ICd2YXIoLS10ZXh0LW11dGVkKSc7XG4gICAgYi5zdHlsZS5ib3JkZXJCb3R0b21Db2xvciA9IGFjdGl2ZSA/ICcjMGQ5NDg4JyA6ICd0cmFuc3BhcmVudCc7XG4gICAgYi5zdHlsZS5mb250V2VpZ2h0ID0gYWN0aXZlID8gJzcwMCcgOiAnNjAwJztcbiAgfSk7XG4gIC8vIHYxMTA1IGZpeDogYWwgYWN0aXZhciBsYSB0YWIgc3RhdCwgbW9zdHJhciBwbGFjZWhvbGRlciBpbm1lZGlhdG8gcGFyYVxuICAvLyBxdWUgc2UgdmVhIGFsZ28gbWllbnRyYXMgY2FyZ2EgKG8gc2kgZWwgbG9hZCB5YSB0ZXJtaW5vLCByZS1yZW5kZXIpLlxuICBpZiAodGFiSWQgPT09ICdzdGF0Jykge1xuICAgIGNvbnN0IGNvbnQgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZm9yZWNhc3QtdGFiLXN0YXQnKTtcbiAgICBpZiAoY29udCkge1xuICAgICAgaWYgKF9mb3JlY2FzdFN0YXREb2NzKSB7XG4gICAgICAgIC8vIFlhIGNhcmdhZG86IHJlLXJlbmRlciAocG9yIHNpIGVsIHVzZXIgdmllbmUgZGUgb3RyYSB0YWIpLlxuICAgICAgICBfcmVuZGVyRm9yZWNhc3RTdGF0VGFiKCk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICAvLyBBXHUwMEZBbiBubyBjYXJnYWRvOiBwbGFjZWhvbGRlciArIGxvYWQuXG4gICAgICAgIGNvbnQuaW5uZXJIVE1MID1cbiAgICAgICAgICAnPGRpdiBzdHlsZT1cInBhZGRpbmc6NjBweCAyMHB4O3RleHQtYWxpZ246Y2VudGVyO2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO2ZvbnQtc2l6ZToxNHB4XCI+JyArXG4gICAgICAgICAgJzxkaXYgc3R5bGU9XCJkaXNwbGF5OmlubGluZS1ibG9jazt3aWR0aDoyNHB4O2hlaWdodDoyNHB4O2JvcmRlcjozcHggc29saWQgIzBkOTQ4ODtib3JkZXItdG9wLWNvbG9yOnRyYW5zcGFyZW50O2JvcmRlci1yYWRpdXM6NTAlO2FuaW1hdGlvbjpzcGluIDAuOHMgbGluZWFyIGluZmluaXRlO21hcmdpbi1ib3R0b206MTJweFwiPjwvZGl2PicgK1xuICAgICAgICAgICc8ZGl2PkNhcmdhbmRvIGZvcmVjYXN0X291dHB1dCBkZXNkZSBGaXJlc3RvcmUuLi48L2Rpdj4nICtcbiAgICAgICAgICAnPHN0eWxlPkBrZXlmcmFtZXMgc3Bpbnt0b3t0cmFuc2Zvcm06cm90YXRlKDM2MGRlZyl9fTwvc3R5bGU+JyArXG4gICAgICAgICAgJzwvZGl2Pic7XG4gICAgICAgIF9sb2FkRm9yZWNhc3RPdXRwdXQoKVxuICAgICAgICAgIC50aGVuKF9yZW5kZXJGb3JlY2FzdFN0YXRUYWIpXG4gICAgICAgICAgLmNhdGNoKChlKSA9PiB7XG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKCdbRk9SRUNBU1Qgc3RhdF0gbG9hZCBmYWlsJywgZSk7XG4gICAgICAgICAgICBjb25zdCBjID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2ZvcmVjYXN0LXRhYi1zdGF0Jyk7XG4gICAgICAgICAgICBpZiAoYykge1xuICAgICAgICAgICAgICBjLmlubmVySFRNTCA9XG4gICAgICAgICAgICAgICAgJzxkaXYgc3R5bGU9XCJwYWRkaW5nOjYwcHggMjBweDt0ZXh0LWFsaWduOmNlbnRlcjtjb2xvcjojZGMyNjI2O2xpbmUtaGVpZ2h0OjEuNlwiPicgK1xuICAgICAgICAgICAgICAgICc8ZGl2IHN0eWxlPVwiZm9udC1zaXplOjE2cHg7Zm9udC13ZWlnaHQ6NzAwO21hcmdpbi1ib3R0b206MTJweFwiPkVycm9yIGNhcmdhbmRvIGZvcmVjYXN0X291dHB1dDwvZGl2PicgK1xuICAgICAgICAgICAgICAgICc8ZGl2IHN0eWxlPVwiZm9udC1zaXplOjEycHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7bWFyZ2luLWJvdHRvbToxNnB4XCI+JyArXG4gICAgICAgICAgICAgICAgZXNjYXBlSHRtbFNhZmUoZS5tZXNzYWdlIHx8IFN0cmluZyhlKSkgK1xuICAgICAgICAgICAgICAgICc8L2Rpdj4nICtcbiAgICAgICAgICAgICAgICAnPGJ1dHRvbiBvbmNsaWNrPVwic3dpdGNoRm9yZWNhc3RUYWIoXFwnc3RhdFxcJylcIiBzdHlsZT1cInBhZGRpbmc6OHB4IDE0cHg7YmFja2dyb3VuZDojMGQ5NDg4O2NvbG9yOiNmZmY7Ym9yZGVyOm5vbmU7Ym9yZGVyLXJhZGl1czo2cHg7Zm9udC13ZWlnaHQ6NzAwO2N1cnNvcjpwb2ludGVyXCI+UmVpbnRlbnRhcjwvYnV0dG9uPicgK1xuICAgICAgICAgICAgICAgICc8L2Rpdj4nO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH0pO1xuICAgICAgfVxuICAgIH1cbiAgfVxufTtcblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBGQVNFIDEgXHUyMDE0IFNhbGVzIFBsYW5zIHVwbG9hZCAoUm9kcyAvIFJlZWxzIC8gRkcpXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuZnVuY3Rpb24gX3llYXJNb250aE5vdygpIHtcbiAgY29uc3QgZCA9IG5ldyBEYXRlKCk7XG4gIHJldHVybiBkLmdldEZ1bGxZZWFyKCkgKyAnLScgKyBTdHJpbmcoZC5nZXRNb250aCgpICsgMSkucGFkU3RhcnQoMiwgJzAnKTtcbn1cblxuZnVuY3Rpb24gX2ZtdFNpemUoYnl0ZXMpIHtcbiAgaWYgKCFieXRlcykgcmV0dXJuICcnO1xuICBpZiAoYnl0ZXMgPCAxMDI0KSByZXR1cm4gYnl0ZXMgKyAnIEInO1xuICBpZiAoYnl0ZXMgPCAxMDI0ICogMTAyNCkgcmV0dXJuIChieXRlcyAvIDEwMjQpLnRvRml4ZWQoMSkgKyAnIEtCJztcbiAgcmV0dXJuIChieXRlcyAvICgxMDI0ICogMTAyNCkpLnRvRml4ZWQoMikgKyAnIE1CJztcbn1cblxuZnVuY3Rpb24gX2ZtdERhdGVTaG9ydChpc28pIHtcbiAgaWYgKCFpc28pIHJldHVybiAnXHUyMDE0JztcbiAgdHJ5IHtcbiAgICBjb25zdCBkID0gaXNvLnRvRGF0ZSA/IGlzby50b0RhdGUoKSA6IG5ldyBEYXRlKGlzbyk7XG4gICAgcmV0dXJuIChcbiAgICAgIGQudG9Mb2NhbGVEYXRlU3RyaW5nKCdlcy1BUicsIHsgZGF5OiAnMi1kaWdpdCcsIG1vbnRoOiAnc2hvcnQnLCB5ZWFyOiAnMi1kaWdpdCcgfSkgK1xuICAgICAgJyAnICtcbiAgICAgIGQudG9Mb2NhbGVUaW1lU3RyaW5nKCdlcy1BUicsIHsgaG91cjogJzItZGlnaXQnLCBtaW51dGU6ICcyLWRpZ2l0JyB9KVxuICAgICk7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiBTdHJpbmcoaXNvKTtcbiAgfVxufVxuXG5hc3luYyBmdW5jdGlvbiBfbG9hZFNhbGVzUGxhbkNhY2hlcygpIHtcbiAgaWYgKCF3aW5kb3cuZmJEYikgcmV0dXJuO1xuICBhd2FpdCBQcm9taXNlLmFsbChcbiAgICBTQUxFU19QTEFOX0ZBTUlMSUFTLm1hcChhc3luYyAoZikgPT4ge1xuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3QgZG9jID0gYXdhaXQgd2luZG93LmZiRGIuY29sbGVjdGlvbignc2FsZXNfcGxhbl9jYWNoZScpLmRvYyhmLmtleSkuZ2V0KCk7XG4gICAgICAgIF9zYWxlc1BsYW5DYWNoZXNbZi5rZXldID0gZG9jLmV4aXN0cyA/IGRvYy5kYXRhKCkgOiBudWxsO1xuICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICBjb25zb2xlLndhcm4oJ1tGT1JFQ0FTVF0gbG9hZCBzYWxlc19wbGFuX2NhY2hlLycgKyBmLmtleSArICcgZmFpbDonLCBlICYmIGUubWVzc2FnZSk7XG4gICAgICAgIF9zYWxlc1BsYW5DYWNoZXNbZi5rZXldID0gbnVsbDtcbiAgICAgIH1cbiAgICB9KVxuICApO1xufVxuXG5mdW5jdGlvbiBlc2NhcGVIdG1sU2FmZShzKSB7XG4gIGlmICh0eXBlb2Ygd2luZG93LmVzY2FwZUh0bWwgPT09ICdmdW5jdGlvbicpIHJldHVybiB3aW5kb3cuZXNjYXBlSHRtbChzKTtcbiAgcmV0dXJuIFN0cmluZyhzID09IG51bGwgPyAnJyA6IHMpLnJlcGxhY2UoXG4gICAgL1smPD5cIiddL2csXG4gICAgKGNoKSA9PiAoeyAnJic6ICcmYW1wOycsICc8JzogJyZsdDsnLCAnPic6ICcmZ3Q7JywgJ1wiJzogJyZxdW90OycsIFwiJ1wiOiAnJiMzOTsnIH0pW2NoXVxuICApO1xufVxuXG5mdW5jdGlvbiBfYnVpbGRTYWxlc1BsYW5TbG90SHRtbChmKSB7XG4gIGNvbnN0IGNhY2hlID0gX3NhbGVzUGxhbkNhY2hlc1tmLmtleV07XG4gIGNvbnN0IHJvd3NDb3VudCA9IGNhY2hlICYmIE51bWJlci5pc0Zpbml0ZShjYWNoZS5yb3dzQ291bnQpID8gY2FjaGUucm93c0NvdW50IDogMDtcbiAgY29uc3QgbW9udGhzQ291bnQgPVxuICAgIGNhY2hlICYmIEFycmF5LmlzQXJyYXkoY2FjaGUuZGV0ZWN0ZWRNb250aHMpID8gY2FjaGUuZGV0ZWN0ZWRNb250aHMubGVuZ3RoIDogMDtcbiAgY29uc3QgcGFyc2VkQXQgPSBjYWNoZSAmJiBjYWNoZS5wYXJzZWRBdCA/IF9mbXREYXRlU2hvcnQoY2FjaGUucGFyc2VkQXQpIDogJyc7XG4gIGNvbnN0IHVwbG9hZGVkQnkgPSBjYWNoZSAmJiBjYWNoZS51cGxvYWRlZEJ5ID8gY2FjaGUudXBsb2FkZWRCeSA6ICcnO1xuICBjb25zdCBzb3VyY2VGaWxlbmFtZSA9IGNhY2hlICYmIGNhY2hlLnNvdXJjZUZpbGVuYW1lID8gY2FjaGUuc291cmNlRmlsZW5hbWUgOiAnJztcbiAgY29uc3QgeWVhck1vbnRoID0gY2FjaGUgJiYgY2FjaGUueWVhck1vbnRoID8gY2FjaGUueWVhck1vbnRoIDogJyc7XG4gIGNvbnN0IG1vbnRoc1JhbmdlID1cbiAgICBjYWNoZSAmJiBjYWNoZS5kZXRlY3RlZE1vbnRocyAmJiBjYWNoZS5kZXRlY3RlZE1vbnRocy5sZW5ndGhcbiAgICAgID8gY2FjaGUuZGV0ZWN0ZWRNb250aHNbMF0gKyAnIFx1MjE5MiAnICsgY2FjaGUuZGV0ZWN0ZWRNb250aHNbY2FjaGUuZGV0ZWN0ZWRNb250aHMubGVuZ3RoIC0gMV1cbiAgICAgIDogJ1x1MjAxNCc7XG4gIGNvbnN0IGhhc0NhY2hlID0gISFjYWNoZTtcbiAgY29uc3QgYmFkZ2UgPSBoYXNDYWNoZVxuICAgID8gJzxkaXYgc3R5bGU9XCJwYWRkaW5nOjRweCA4cHg7YmFja2dyb3VuZDojMTZhMzRhO2NvbG9yOiNmZmY7Ym9yZGVyLXJhZGl1czoxMnB4O2ZvbnQtc2l6ZToxMHB4O2ZvbnQtd2VpZ2h0OjcwMDtsZXR0ZXItc3BhY2luZzouNHB4XCI+Q0FSR0FETzwvZGl2PidcbiAgICA6ICc8ZGl2IHN0eWxlPVwicGFkZGluZzo0cHggOHB4O2JhY2tncm91bmQ6I2RjMjYyNjtjb2xvcjojZmZmO2JvcmRlci1yYWRpdXM6MTJweDtmb250LXNpemU6MTBweDtmb250LXdlaWdodDo3MDA7bGV0dGVyLXNwYWNpbmc6LjRweFwiPkZBTFRBPC9kaXY+JztcbiAgY29uc3QgbWV0YUJsb2NrID0gaGFzQ2FjaGVcbiAgICA/ICc8ZGl2IHN0eWxlPVwiZGlzcGxheTpncmlkO2dyaWQtdGVtcGxhdGUtY29sdW1uczphdXRvIDFmcjtnYXA6NnB4IDEycHg7Zm9udC1zaXplOjExcHg7cGFkZGluZzoxMHB4IDEycHg7YmFja2dyb3VuZDp2YXIoLS1iZy1zZWNvbmRhcnkpO2JvcmRlci1yYWRpdXM6NnB4XCI+JyArXG4gICAgICAnPGRpdiBzdHlsZT1cImNvbG9yOnZhcigtLXRleHQtbXV0ZWQpO2ZvbnQtd2VpZ2h0OjYwMFwiPkFyY2hpdm88L2Rpdj48ZGl2IHN0eWxlPVwiY29sb3I6dmFyKC0tdGV4dC1wcmltYXJ5KTtmb250LWZhbWlseTptb25vc3BhY2U7d29yZC1icmVhazpicmVhay1hbGxcIj4nICtcbiAgICAgIGVzY2FwZUh0bWxTYWZlKHNvdXJjZUZpbGVuYW1lKSArXG4gICAgICAnPC9kaXY+JyArXG4gICAgICAnPGRpdiBzdHlsZT1cImNvbG9yOnZhcigtLXRleHQtbXV0ZWQpO2ZvbnQtd2VpZ2h0OjYwMFwiPlN1YmlkbzwvZGl2PjxkaXYgc3R5bGU9XCJjb2xvcjp2YXIoLS10ZXh0LXByaW1hcnkpXCI+JyArXG4gICAgICBlc2NhcGVIdG1sU2FmZShwYXJzZWRBdCkgK1xuICAgICAgJzwvZGl2PicgK1xuICAgICAgJzxkaXYgc3R5bGU9XCJjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTtmb250LXdlaWdodDo2MDBcIj5Qb3I8L2Rpdj48ZGl2IHN0eWxlPVwiY29sb3I6dmFyKC0tdGV4dC1wcmltYXJ5KVwiPicgK1xuICAgICAgZXNjYXBlSHRtbFNhZmUodXBsb2FkZWRCeSkgK1xuICAgICAgJzwvZGl2PicgK1xuICAgICAgJzxkaXYgc3R5bGU9XCJjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTtmb250LXdlaWdodDo2MDBcIj5TbmFwc2hvdDwvZGl2PjxkaXYgc3R5bGU9XCJjb2xvcjp2YXIoLS10ZXh0LXByaW1hcnkpO2ZvbnQtZmFtaWx5Om1vbm9zcGFjZVwiPicgK1xuICAgICAgZXNjYXBlSHRtbFNhZmUoeWVhck1vbnRoKSArXG4gICAgICAnPC9kaXY+JyArXG4gICAgICAnPGRpdiBzdHlsZT1cImNvbG9yOnZhcigtLXRleHQtbXV0ZWQpO2ZvbnQtd2VpZ2h0OjYwMFwiPlNLVXM8L2Rpdj48ZGl2IHN0eWxlPVwiY29sb3I6dmFyKC0tdGV4dC1wcmltYXJ5KTtmb250LXdlaWdodDo3MDBcIj4nICtcbiAgICAgIHJvd3NDb3VudC50b0xvY2FsZVN0cmluZygnZXMtQVInKSArXG4gICAgICAnPC9kaXY+JyArXG4gICAgICAnPGRpdiBzdHlsZT1cImNvbG9yOnZhcigtLXRleHQtbXV0ZWQpO2ZvbnQtd2VpZ2h0OjYwMFwiPk1lc2VzPC9kaXY+PGRpdiBzdHlsZT1cImNvbG9yOnZhcigtLXRleHQtcHJpbWFyeSk7Zm9udC13ZWlnaHQ6NzAwXCI+JyArXG4gICAgICBtb250aHNDb3VudCArXG4gICAgICAnIDxzcGFuIHN0eWxlPVwiY29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7Zm9udC13ZWlnaHQ6NDAwXCI+KCcgK1xuICAgICAgZXNjYXBlSHRtbFNhZmUobW9udGhzUmFuZ2UpICtcbiAgICAgICcpPC9zcGFuPjwvZGl2PicgK1xuICAgICAgJzwvZGl2PidcbiAgICA6ICc8ZGl2IHN0eWxlPVwicGFkZGluZzoxNHB4O3RleHQtYWxpZ246Y2VudGVyO2ZvbnQtc2l6ZToxMnB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO2JhY2tncm91bmQ6dmFyKC0tYmctc2Vjb25kYXJ5KTtib3JkZXItcmFkaXVzOjZweDtib3JkZXI6MXB4IGRhc2hlZCB2YXIoLS1ib3JkZXItc3VidGxlKVwiPkF1biBubyBzdWJpc3RlIGVsIFNhbGVzIFBsYW4gZGUgZXN0YSBmYW1pbGlhLjwvZGl2Pic7XG4gIGNvbnN0IHVwbG9hZEJ0biA9XG4gICAgJzxsYWJlbCBzdHlsZT1cImRpc3BsYXk6aW5saW5lLWZsZXg7YWxpZ24taXRlbXM6Y2VudGVyO2p1c3RpZnktY29udGVudDpjZW50ZXI7Z2FwOjhweDtwYWRkaW5nOjEwcHggMTRweDtiYWNrZ3JvdW5kOicgK1xuICAgIGYuY29sb3IgK1xuICAgICc7Y29sb3I6I2ZmZjtib3JkZXItcmFkaXVzOjZweDtmb250LXdlaWdodDo3MDA7Zm9udC1zaXplOjEycHg7Y3Vyc29yOnBvaW50ZXI7bGV0dGVyLXNwYWNpbmc6LjRweFwiPicgK1xuICAgICc8c3Bhbj4nICtcbiAgICAoaGFzQ2FjaGUgPyAnXHUyMUJCIFJlZW1wbGF6YXIgRXhjZWwnIDogJ1x1MkIwNiBDYXJnYXIgRXhjZWwnKSArXG4gICAgJzwvc3Bhbj4nICtcbiAgICAnPGlucHV0IHR5cGU9XCJmaWxlXCIgYWNjZXB0PVwiLnhsc3gsLnhsc1wiIGRhdGEtZmFtaWxpYT1cIicgK1xuICAgIGYua2V5ICtcbiAgICAnXCIgc3R5bGU9XCJkaXNwbGF5Om5vbmVcIiBvbmNoYW5nZT1cIm9uU2FsZXNQbGFuRmlsZUZvckZhbWlsaWEoZXZlbnQsIFxcJycgK1xuICAgIGYua2V5ICtcbiAgICAnXFwnKVwiLz4nICtcbiAgICAnPC9sYWJlbD4nO1xuICBjb25zdCBjYXJkSGVhZCA9XG4gICAgJzxkaXYgc3R5bGU9XCJkaXNwbGF5OmZsZXg7YWxpZ24taXRlbXM6Y2VudGVyO2dhcDoxMHB4XCI+JyArXG4gICAgJzxkaXYgc3R5bGU9XCJ3aWR0aDoxMnB4O2hlaWdodDozMnB4O2JhY2tncm91bmQ6JyArXG4gICAgZi5jb2xvciArXG4gICAgJztib3JkZXItcmFkaXVzOjNweFwiPjwvZGl2PicgK1xuICAgICc8ZGl2IHN0eWxlPVwiZmxleDoxXCI+PGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxNHB4O2ZvbnQtd2VpZ2h0OjgwMDtjb2xvcjp2YXIoLS10ZXh0LXByaW1hcnkpXCI+JyArXG4gICAgZXNjYXBlSHRtbFNhZmUoZi5sYWJlbCkgK1xuICAgICc8L2Rpdj4nICtcbiAgICAnPGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMXB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO21hcmdpbi10b3A6MnB4XCI+U2FsZXMgUGxhbiBtZW5zdWFsIFx1MDBCNyBIb2phIFNBUjwvZGl2PjwvZGl2PicgK1xuICAgIGJhZGdlICtcbiAgICAnPC9kaXY+JztcbiAgcmV0dXJuIChcbiAgICAnPGRpdiBzdHlsZT1cImJhY2tncm91bmQ6dmFyKC0tYmctZWxldmF0ZWQpO2JvcmRlcjoxcHggc29saWQgdmFyKC0tYm9yZGVyLXN1YnRsZSk7Ym9yZGVyLXJhZGl1czoxMHB4O3BhZGRpbmc6MTZweDtkaXNwbGF5OmZsZXg7ZmxleC1kaXJlY3Rpb246Y29sdW1uO2dhcDoxMnB4XCI+JyArXG4gICAgY2FyZEhlYWQgK1xuICAgIG1ldGFCbG9jayArXG4gICAgdXBsb2FkQnRuICtcbiAgICAnPGRpdiBpZD1cInNhbGVzLXBsYW4tc3RhdHVzLScgK1xuICAgIGYua2V5ICtcbiAgICAnXCIgc3R5bGU9XCJmb250LXNpemU6MTFweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTttaW4taGVpZ2h0OjE0cHhcIj48L2Rpdj4nICtcbiAgICAnPC9kaXY+J1xuICApO1xufVxuXG5mdW5jdGlvbiBfcmVuZGVyU2FsZXNQbGFuc1RhYigpIHtcbiAgY29uc3QgY29udCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdmb3JlY2FzdC10YWItc2FsZXMtcGxhbnMnKTtcbiAgaWYgKCFjb250KSByZXR1cm47XG4gIGNvbnN0IHNsb3RzID0gU0FMRVNfUExBTl9GQU1JTElBUy5tYXAoX2J1aWxkU2FsZXNQbGFuU2xvdEh0bWwpLmpvaW4oJycpO1xuICBjb25zdCBpbnRybyA9XG4gICAgJzxkaXYgc3R5bGU9XCJtYXJnaW4tYm90dG9tOjE2cHg7cGFkZGluZzoxMnB4IDE0cHg7YmFja2dyb3VuZDp2YXIoLS1iZy1zZWNvbmRhcnkpO2JvcmRlci1sZWZ0OjNweCBzb2xpZCAjMGQ5NDg4O2JvcmRlci1yYWRpdXM6NnB4O2ZvbnQtc2l6ZToxMnB4O2NvbG9yOnZhcigtLXRleHQtc2Vjb25kYXJ5KTtsaW5lLWhlaWdodDoxLjVcIj4nICtcbiAgICAnPGIgc3R5bGU9XCJjb2xvcjp2YXIoLS10ZXh0LXByaW1hcnkpXCI+RmFzZSAxPC9iPiBcdTIwMTQgQ2FyZ1x1MDBFMSBsb3MgU2FsZXMgUGxhbnMgbWVuc3VhbGVzIChSb2RzIC8gUmVlbHMpLiBTZSBwYXJzZWEgbGEgaG9qYSA8Yj5TQVI8L2I+OiBTS1UsIE1PUSAxMiBtb250aHMsIHkgdW5hIGNvbHVtbmEgcG9yIG1lcy4gJyArXG4gICAgJ0VsIEV4Y2VsIG9yaWdpbmFsIHF1ZWRhIHNuYXBzaG90YWRvIGVuIFN0b3JhZ2UgeSBlbCBwYXJzZW8gcXVlZGEgZW4gRmlyZXN0b3JlIHBhcmEgZWwgY1x1MDBFMWxjdWxvIGRlYmFqby4nICtcbiAgICAnPC9kaXY+JztcbiAgY29uc3QgZ3JpZCA9XG4gICAgJzxkaXYgc3R5bGU9XCJkaXNwbGF5OmdyaWQ7Z3JpZC10ZW1wbGF0ZS1jb2x1bW5zOnJlcGVhdChhdXRvLWZpdCxtaW5tYXgoMzIwcHgsMWZyKSk7Z2FwOjE2cHg7bWFyZ2luLWJvdHRvbToyNHB4XCI+JyArXG4gICAgc2xvdHMgK1xuICAgICc8L2Rpdj4nO1xuICAvLyB2MTEwOTogY29udGVuZWRvciBwYXJhIHRhYmxhIFJlY29tZW5kYWNpXHUwMEYzbiBkZSBDb21wcmEuIFNlIHJlbGxlbmEgb24tZGVtYW5kXG4gIC8vIHZpYSBfcmVuZGVyUmVjb1NlY3Rpb24oKSAobGF6eSBsb2FkIGRlIHN0b2NrX3NuYXBzaG90ICsgc2t1X3ZlbnRhc19zbmFwc2hvdCkuXG4gIGNvbnN0IHJlY29TZWN0aW9uID0gJzxkaXYgaWQ9XCJyZWNvLXNlY3Rpb24tY29udGFpbmVyXCI+PC9kaXY+JztcbiAgY29udC5pbm5lckhUTUwgPSAnPGRpdiBzdHlsZT1cInBhZGRpbmc6MThweFwiPicgKyBpbnRybyArIGdyaWQgKyByZWNvU2VjdGlvbiArICc8L2Rpdj4nO1xuICBfcmVuZGVyUmVjb1NlY3Rpb24oKTtcbn1cblxud2luZG93Lm9uU2FsZXNQbGFuRmlsZUZvckZhbWlsaWEgPSBhc3luYyBmdW5jdGlvbiAoZXZlbnQsIGZhbWlsaWEpIHtcbiAgY29uc3QgZmlsZSA9IGV2ZW50ICYmIGV2ZW50LnRhcmdldCAmJiBldmVudC50YXJnZXQuZmlsZXMgJiYgZXZlbnQudGFyZ2V0LmZpbGVzWzBdO1xuICBpZiAoIWZpbGUpIHJldHVybjtcbiAgY29uc3Qgc3RhdHVzRWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnc2FsZXMtcGxhbi1zdGF0dXMtJyArIGZhbWlsaWEpO1xuICBjb25zdCBzZXRTdGF0dXMgPSAobXNnLCBjb2xvcikgPT4ge1xuICAgIGlmICghc3RhdHVzRWwpIHJldHVybjtcbiAgICBzdGF0dXNFbC50ZXh0Q29udGVudCA9IG1zZztcbiAgICBzdGF0dXNFbC5zdHlsZS5jb2xvciA9IGNvbG9yIHx8ICd2YXIoLS10ZXh0LW11dGVkKSc7XG4gIH07XG4gIHRyeSB7XG4gICAgaWYgKHR5cGVvZiBYTFNYID09PSAndW5kZWZpbmVkJykge1xuICAgICAgYWxlcnQoJ1NoZWV0SlMgKFhMU1gpIG5vIGNhcmdhZG8gXHUyMDE0IHJlY2FyZ1x1MDBFMSBsYSBhcHAuJyk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGlmICghd2luZG93LlNhbGVzUGxhblBhcnNlciB8fCAhd2luZG93LlNhbGVzUGxhblBhcnNlci5wYXJzZVNhbGVzUGxhblNoZWV0KSB7XG4gICAgICBhbGVydCgnUGFyc2VyIFNhbGVzIFBsYW4gbm8gY2FyZ2Fkby4gUmVidWlsZCBidW5kbGUuJyk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGlmICghd2luZG93LmZpcmViYXNlIHx8ICF3aW5kb3cuZmlyZWJhc2Uuc3RvcmFnZSkge1xuICAgICAgYWxlcnQoJ0ZpcmViYXNlIFN0b3JhZ2Ugbm8gZGlzcG9uaWJsZS4nKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgc2V0U3RhdHVzKCdMZXllbmRvIEV4Y2VsXHUyMDI2Jyk7XG4gICAgY29uc3QgYnVmID0gYXdhaXQgZmlsZS5hcnJheUJ1ZmZlcigpO1xuICAgIGNvbnN0IHdiID0gWExTWC5yZWFkKGJ1ZiwgeyB0eXBlOiAnYXJyYXknIH0pO1xuICAgIGNvbnN0IHNhck5hbWUgPSB3Yi5TaGVldE5hbWVzLmZpbmQoXG4gICAgICAobikgPT5cbiAgICAgICAgU3RyaW5nKG4gfHwgJycpXG4gICAgICAgICAgLnRyaW0oKVxuICAgICAgICAgIC50b1VwcGVyQ2FzZSgpID09PSAnU0FSJ1xuICAgICk7XG4gICAgaWYgKCFzYXJOYW1lKSB7XG4gICAgICBzZXRTdGF0dXMoXG4gICAgICAgICdcdTI2QTAgRWwgRXhjZWwgbm8gdGllbmUgaG9qYSBcIlNBUlwiLiBIb2phcyBlbmNvbnRyYWRhczogJyArIHdiLlNoZWV0TmFtZXMuam9pbignLCAnKSxcbiAgICAgICAgJyNkYzI2MjYnXG4gICAgICApO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBjb25zdCBzaGVldCA9IHdiLlNoZWV0c1tzYXJOYW1lXTtcbiAgICBjb25zdCByb3dzID0gWExTWC51dGlscy5zaGVldF90b19qc29uKHNoZWV0LCB7IGhlYWRlcjogMSwgZGVmdmFsOiAnJywgcmF3OiB0cnVlIH0pO1xuICAgIHNldFN0YXR1cygnUGFyc2VhbmRvICcgKyByb3dzLmxlbmd0aCArICcgZmlsYXMgZGUgaG9qYSBcIicgKyBzYXJOYW1lICsgJ1wiXHUyMDI2Jyk7XG4gICAgY29uc3QgcGFyc2VkID0gd2luZG93LlNhbGVzUGxhblBhcnNlci5wYXJzZVNhbGVzUGxhblNoZWV0KHJvd3MpO1xuICAgIGlmICghcGFyc2VkLnJvd3MubGVuZ3RoKSB7XG4gICAgICBzZXRTdGF0dXMoJ1x1MjZBMCBFeGNlbCBwYXJzZWFkbyBwZXJvIHNpbiBTS1VzIHZcdTAwRTFsaWRvcy4nLCAnI2RjMjYyNicpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBjb25zdCB5ZWFyTW9udGggPSBfeWVhck1vbnRoTm93KCk7XG4gICAgY29uc3Qgc3RvcmFnZVBhdGggPSAnZm9yZWNhc3RzX3NuYXBzaG90cy8nICsgeWVhck1vbnRoICsgJy8nICsgZmFtaWxpYSArICcueGxzeCc7XG4gICAgc2V0U3RhdHVzKCdTdWJpZW5kbyBFeGNlbCBhIFN0b3JhZ2UgKCcgKyBfZm10U2l6ZShmaWxlLnNpemUpICsgJylcdTIwMjYnKTtcbiAgICBjb25zdCBzdG9yYWdlUmVmID0gd2luZG93LmZpcmViYXNlLnN0b3JhZ2UoKS5yZWYoc3RvcmFnZVBhdGgpO1xuICAgIGF3YWl0IHN0b3JhZ2VSZWYucHV0KGZpbGUsIHtcbiAgICAgIGNvbnRlbnRUeXBlOiBmaWxlLnR5cGUgfHwgJ2FwcGxpY2F0aW9uL3ZuZC5vcGVueG1sZm9ybWF0cy1vZmZpY2Vkb2N1bWVudC5zcHJlYWRzaGVldG1sLnNoZWV0JyxcbiAgICAgIGN1c3RvbU1ldGFkYXRhOiB7XG4gICAgICAgIGZhbWlsaWEsXG4gICAgICAgIHVwbG9hZGVkQnk6ICh3aW5kb3cuY3VycmVudFVzZXIgJiYgd2luZG93LmN1cnJlbnRVc2VyLmVtYWlsKSB8fCAnJyxcbiAgICAgICAgc291cmNlRmlsZW5hbWU6IGZpbGUubmFtZSB8fCAnJyxcbiAgICAgIH0sXG4gICAgfSk7XG4gICAgc2V0U3RhdHVzKCdHdWFyZGFuZG8gcGFyc2VvIGVuIEZpcmVzdG9yZSAoJyArIHBhcnNlZC5yb3dzLmxlbmd0aCArICcgU0tVcylcdTIwMjYnKTtcbiAgICBjb25zdCB1cGxvYWRlZEJ5ID0gKHdpbmRvdy5jdXJyZW50VXNlciAmJiB3aW5kb3cuY3VycmVudFVzZXIuZW1haWwpIHx8ICd1bmtub3duJztcbiAgICBjb25zdCBwYXlsb2FkID0ge1xuICAgICAgZmFtaWxpYSxcbiAgICAgIHBhcnNlZEF0OlxuICAgICAgICB3aW5kb3cuZmlyZWJhc2UgJiYgd2luZG93LmZpcmViYXNlLmZpcmVzdG9yZSAmJiB3aW5kb3cuZmlyZWJhc2UuZmlyZXN0b3JlLkZpZWxkVmFsdWVcbiAgICAgICAgICA/IHdpbmRvdy5maXJlYmFzZS5maXJlc3RvcmUuRmllbGRWYWx1ZS5zZXJ2ZXJUaW1lc3RhbXAoKVxuICAgICAgICAgIDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgICAgdXBsb2FkZWRCeSxcbiAgICAgIHNvdXJjZUZpbGVuYW1lOiBmaWxlLm5hbWUgfHwgJycsXG4gICAgICBzb3VyY2VTaGVldDogc2FyTmFtZSxcbiAgICAgIHllYXJNb250aCxcbiAgICAgIHN0b3JhZ2VQYXRoLFxuICAgICAgcm93c0NvdW50OiBwYXJzZWQucm93cy5sZW5ndGgsXG4gICAgICBoZWFkZXJSb3dJbmRleDogcGFyc2VkLmhlYWRlclJvd0luZGV4LFxuICAgICAgZGV0ZWN0ZWRNb250aHM6IHBhcnNlZC5kZXRlY3RlZE1vbnRocyxcbiAgICAgIHJvd3M6IHBhcnNlZC5yb3dzLFxuICAgIH07XG4gICAgYXdhaXQgd2luZG93LmZiRGIuY29sbGVjdGlvbignc2FsZXNfcGxhbl9jYWNoZScpLmRvYyhmYW1pbGlhKS5zZXQocGF5bG9hZCk7XG4gICAgLy8gdjExMDcgZml4OiBndWFyZGFyIGNhY2hlIGxvY2FsIGNvbiBEYXRlIHJlYWwgKG5vIGVsIFNlbnRpbmVsVmFsdWUpIHBhcmFcbiAgICAvLyBxdWUgX2ZtdERhdGVTaG9ydCBubyBtdWVzdHJlIFwiSW52YWxpZCBEYXRlXCIuIEVsIHNlcnZlciB0aWVuZSBlbCB0cyBleGFjdG8sXG4gICAgLy8gZWwgbG9jYWwgbXVlc3RyYSBlbCBtb21lbnRvIGRlbCB1cGxvYWQgKGFwcm94aW1hZG8gfjFzIGRlIGRpZmVyZW5jaWEpLlxuICAgIF9zYWxlc1BsYW5DYWNoZXNbZmFtaWxpYV0gPSBPYmplY3QuYXNzaWduKHt9LCBwYXlsb2FkLCB7IHBhcnNlZEF0OiBuZXcgRGF0ZSgpIH0pO1xuICAgIHNldFN0YXR1cyhcbiAgICAgICdcdTI3MTMgT0suICcgKyBwYXJzZWQucm93cy5sZW5ndGggKyAnIFNLVXMgXHUwMEQ3ICcgKyBwYXJzZWQuZGV0ZWN0ZWRNb250aHMubGVuZ3RoICsgJyBtZXNlcy4nLFxuICAgICAgJyMxNmEzNGEnXG4gICAgKTtcbiAgICBfcmVuZGVyU2FsZXNQbGFuc1RhYigpO1xuICB9IGNhdGNoIChlKSB7XG4gICAgY29uc29sZS5lcnJvcignW0ZPUkVDQVNUXSB1cGxvYWQgc2FsZXMgcGxhbiAnICsgZmFtaWxpYSArICcgZmFpbDonLCBlKTtcbiAgICBzZXRTdGF0dXMoJ1x1MjcxNyBFcnJvcjogJyArICgoZSAmJiBlLm1lc3NhZ2UpIHx8IGUpLCAnI2RjMjYyNicpO1xuICAgIGlmIChlICYmIGUuY29kZSA9PT0gJ01PTlRIU19OT1RfRk9VTkQnKSB7XG4gICAgICBhbGVydChcbiAgICAgICAgJ0VsIEV4Y2VsIG5vIHRpZW5lIGNvbHVtbmFzIGRlIG1lc2VzIHJlY29ub2NpYmxlcy5cXG5cXG5IZWFkZXJzIGVzcGVyYWRvczogXCJKYW4gMjAyN1wiLCBcIk1heSAyMDI3XCIsIFwiRW5lIDIwMjdcIiwgXCIyMDI3LTAxXCIsIGV0Yy5cXG5cXG5EZXRhbGxlOiAnICtcbiAgICAgICAgICBlLm1lc3NhZ2VcbiAgICAgICk7XG4gICAgfVxuICB9IGZpbmFsbHkge1xuICAgIGlmIChldmVudCAmJiBldmVudC50YXJnZXQpIGV2ZW50LnRhcmdldC52YWx1ZSA9ICcnO1xuICB9XG59O1xuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIEYyQiBcdTIwMTQgRm9yZWNhc3QgRXN0YWRcdTAwRURzdGljbzogdGFibGEgKyBkZXRhbGxlXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuYXN5bmMgZnVuY3Rpb24gX2xvYWRGb3JlY2FzdE91dHB1dCgpIHtcbiAgaWYgKCF3aW5kb3cuZmJEYikgdGhyb3cgbmV3IEVycm9yKCdGaXJlc3RvcmUgbm8gaW5pY2lhbGl6YWRvJyk7XG4gIGNvbnNvbGUubG9nKCdbRk9SRUNBU1Qgc3RhdF0gbG9hZGluZyBmb3JlY2FzdF9vdXRwdXQuLi4nKTtcbiAgY29uc3QgW3NuYXAsIG1ldGFEb2NdID0gYXdhaXQgUHJvbWlzZS5hbGwoW1xuICAgIHdpbmRvdy5mYkRiLmNvbGxlY3Rpb24oJ2ZvcmVjYXN0X291dHB1dCcpLmdldCgpLFxuICAgIHdpbmRvdy5mYkRiLmNvbGxlY3Rpb24oJ2ZvcmVjYXN0X291dHB1dF9tZXRhJykuZG9jKCdjdXJyZW50JykuZ2V0KCksXG4gIF0pO1xuICBjb25zdCBkb2NzID0gW107XG4gIHNuYXAuZm9yRWFjaCgoZCkgPT4gZG9jcy5wdXNoKE9iamVjdC5hc3NpZ24oeyBpZDogZC5pZCB9LCBkLmRhdGEoKSkpKTtcbiAgZG9jcy5zb3J0KChhLCBiKSA9PiB7XG4gICAgY29uc3Qgd2EgPSAoYS5tZXRyaWNzICYmIGEubWV0cmljcy53YXBlKSB8fCA5OTk7XG4gICAgY29uc3Qgd2IgPSAoYi5tZXRyaWNzICYmIGIubWV0cmljcy53YXBlKSB8fCA5OTk7XG4gICAgcmV0dXJuIHdhIC0gd2I7XG4gIH0pO1xuICBfZm9yZWNhc3RTdGF0RG9jcyA9IGRvY3M7XG4gIF9mb3JlY2FzdFN0YXRNZXRhID0gbWV0YURvYy5leGlzdHMgPyBtZXRhRG9jLmRhdGEoKSA6IG51bGw7XG4gIGNvbnNvbGUubG9nKCdbRk9SRUNBU1Qgc3RhdF0gbG9hZGVkJywgZG9jcy5sZW5ndGgsICdkb2NzIFx1MDBCNyBtZXRhOicsICEhX2ZvcmVjYXN0U3RhdE1ldGEpO1xuICByZXR1cm4gZG9jcztcbn1cblxuZnVuY3Rpb24gX3dhcGVCYWRnZUNvbG9yKHcpIHtcbiAgaWYgKHcgPT0gbnVsbCkgcmV0dXJuICcjNjQ3NDhiJztcbiAgaWYgKHcgPCAwLjMpIHJldHVybiAnIzE2YTM0YSc7IC8vIHZlcmRlIC0gZXhjZWxlbnRlXG4gIGlmICh3IDwgMC41KSByZXR1cm4gJyM4NGNjMTYnOyAvLyBsaW1hIC0gYnVlbm9cbiAgaWYgKHcgPCAwLjcpIHJldHVybiAnI2VhYjMwOCc7IC8vIGFtYXJpbGxvIC0gYWNlcHRhYmxlXG4gIGlmICh3IDwgMS4wKSByZXR1cm4gJyNmOTczMTYnOyAvLyBuYXJhbmphIC0gcG9icmVcbiAgcmV0dXJuICcjZGMyNjI2JzsgLy8gcm9qbyAtIG11eSBwb2JyZVxufVxuXG5mdW5jdGlvbiBfZm10TnVtKG4pIHtcbiAgaWYgKG4gPT0gbnVsbCB8fCAhTnVtYmVyLmlzRmluaXRlKE51bWJlcihuKSkpIHJldHVybiAnXHUyMDE0JztcbiAgcmV0dXJuIE51bWJlcihuKS50b0xvY2FsZVN0cmluZygnZXMtQVInLCB7IG1heGltdW1GcmFjdGlvbkRpZ2l0czogMCB9KTtcbn1cblxuZnVuY3Rpb24gX2ZtdFdhcGUodykge1xuICBpZiAodyA9PSBudWxsIHx8ICFOdW1iZXIuaXNGaW5pdGUoTnVtYmVyKHcpKSkgcmV0dXJuICdcdTIwMTQnO1xuICByZXR1cm4gKE51bWJlcih3KSAqIDEwMCkudG9GaXhlZCgwKSArICclJztcbn1cblxuZnVuY3Rpb24gX2ZtdERzU2hvcnQoaXNvKSB7XG4gIC8vICcyMDI2LTEwLTAxJyAtPiAnb2N0IDI2J1xuICB0cnkge1xuICAgIGNvbnN0IFt5LCBtXSA9IGlzby5zcGxpdCgnLScpLm1hcChOdW1iZXIpO1xuICAgIGNvbnN0IG5hbWVzID0gW1xuICAgICAgJ2VuZScsXG4gICAgICAnZmViJyxcbiAgICAgICdtYXInLFxuICAgICAgJ2FicicsXG4gICAgICAnbWF5JyxcbiAgICAgICdqdW4nLFxuICAgICAgJ2p1bCcsXG4gICAgICAnYWdvJyxcbiAgICAgICdzZXAnLFxuICAgICAgJ29jdCcsXG4gICAgICAnbm92JyxcbiAgICAgICdkaWMnLFxuICAgIF07XG4gICAgcmV0dXJuIG5hbWVzW20gLSAxXSArICcgJyArIFN0cmluZyh5KS5zbGljZSgtMik7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiBpc287XG4gIH1cbn1cblxuZnVuY3Rpb24gX3JlbmRlckZvcmVjYXN0U3RhdFRhYigpIHtcbiAgY29uc3QgY29udCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdmb3JlY2FzdC10YWItc3RhdCcpO1xuICBpZiAoIWNvbnQpIHJldHVybjtcbiAgdHJ5IHtcbiAgICBfcmVuZGVyRm9yZWNhc3RTdGF0VGFiSW1wbChjb250KTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGNvbnNvbGUuZXJyb3IoJ1tGT1JFQ0FTVCBzdGF0XSByZW5kZXIgZmFpbCcsIGUpO1xuICAgIGNvbnQuaW5uZXJIVE1MID1cbiAgICAgICc8ZGl2IHN0eWxlPVwicGFkZGluZzo0MHB4IDIwcHg7Y29sb3I6I2RjMjYyNjtsaW5lLWhlaWdodDoxLjZcIj4nICtcbiAgICAgICc8ZGl2IHN0eWxlPVwiZm9udC1zaXplOjE2cHg7Zm9udC13ZWlnaHQ6NzAwO21hcmdpbi1ib3R0b206MTBweFwiPkVycm9yIHJlbmRlcml6YW5kbyB0YWIgRm9yZWNhc3QgRXN0YWRcdTAwRURzdGljbzwvZGl2PicgK1xuICAgICAgJzxwcmUgc3R5bGU9XCJmb250LXNpemU6MTFweDtiYWNrZ3JvdW5kOiNmZWYyZjI7cGFkZGluZzoxMnB4O2JvcmRlci1yYWRpdXM6NnB4O292ZXJmbG93OmF1dG87d2hpdGUtc3BhY2U6cHJlLXdyYXBcIj4nICtcbiAgICAgIGVzY2FwZUh0bWxTYWZlKGUuc3RhY2sgfHwgZS5tZXNzYWdlIHx8IFN0cmluZyhlKSkgK1xuICAgICAgJzwvcHJlPjwvZGl2Pic7XG4gIH1cbn1cblxuZnVuY3Rpb24gX3JlbmRlckZvcmVjYXN0U3RhdFRhYkltcGwoY29udCkge1xuICBjb25zdCBkb2NzID0gX2ZvcmVjYXN0U3RhdERvY3MgfHwgW107XG4gIGNvbnN0IG1ldGEgPSBfZm9yZWNhc3RTdGF0TWV0YSB8fCB7fTtcbiAgY29uc3QgcmVzdW1lbiA9IG1ldGEucmVzdW1lbiB8fCB7fTtcbiAgY29uc29sZS5sb2coJ1tGT1JFQ0FTVCBzdGF0XSByZW5kZXIgXHUyMDE0IGRvY3M6JywgZG9jcy5sZW5ndGgsICdtZXRhOicsICEhbWV0YS5nZW5lcmF0ZWRBdCk7XG4gIGlmICghZG9jcy5sZW5ndGgpIHtcbiAgICBjb250LmlubmVySFRNTCA9XG4gICAgICAnPGRpdiBzdHlsZT1cInBhZGRpbmc6NjBweCAyMHB4O3RleHQtYWxpZ246Y2VudGVyO2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpXCI+JyArXG4gICAgICAnTm8gaGF5IGZvcmVjYXN0X291dHB1dCBwdWJsaWNhZG8uPGJyPjxicj4nICtcbiAgICAgICdDb3JyZXIgPGNvZGU+cHl0aG9uIHNjcmlwdHMvZm9yZWNhc3QvdHJhaW5fcHJvZC5weSAmJiBweXRob24gc2NyaXB0cy9mb3JlY2FzdC9wdWJsaXNoX3RvX2ZpcmVzdG9yZS5weTwvY29kZT4uJyArXG4gICAgICAnPC9kaXY+JztcbiAgICByZXR1cm47XG4gIH1cbiAgLy8gTWVzZXMgZGVsIGZvcmVjYXN0IChkcyBkZWwgcHJpbWVyIGRvYywgc2UgYXN1bWUgaWd1YWwgZW4gdG9kb3MpLlxuICBjb25zdCBtb250aHNJc28gPSAoZG9jc1swXS5mb3JlY2FzdCB8fCBbXSkubWFwKChmKSA9PiBmLmRzKTtcbiAgY29uc3QgbW9udGhIZWFkZXJzID0gbW9udGhzSXNvLm1hcChfZm10RHNTaG9ydCk7XG5cbiAgLy8gTWV0cmljcyBjaGlwIGdsb2JhbFxuICBjb25zdCBnZW5lcmF0ZWQgPSBtZXRhLmdlbmVyYXRlZEF0XG4gICAgPyBuZXcgRGF0ZShtZXRhLmdlbmVyYXRlZEF0KS50b0xvY2FsZVN0cmluZygnZXMtQVInLCB7XG4gICAgICAgIGRheTogJzItZGlnaXQnLFxuICAgICAgICBtb250aDogJ3Nob3J0JyxcbiAgICAgICAgeWVhcjogJzItZGlnaXQnLFxuICAgICAgICBob3VyOiAnMi1kaWdpdCcsXG4gICAgICAgIG1pbnV0ZTogJzItZGlnaXQnLFxuICAgICAgfSlcbiAgICA6ICdcdTIwMTQnO1xuICBjb25zdCB3YXBlTWVkID1cbiAgICByZXN1bWVuLndhcGVfbWVkaWFub19iZXN0X3Blcl9zZXJpZXMgIT0gbnVsbFxuICAgICAgPyBfZm10V2FwZShyZXN1bWVuLndhcGVfbWVkaWFub19iZXN0X3Blcl9zZXJpZXMpXG4gICAgICA6ICdcdTIwMTQnO1xuICBjb25zdCBuU3VicyA9IHJlc3VtZW4ubl9zdWJmYW1pbGlhcyB8fCBkb2NzLmxlbmd0aDtcbiAgY29uc3Qgbkx0MDUgPVxuICAgIHJlc3VtZW4ubl9zZXJpZXNfd2FwZV9sdF8wXzUgIT0gbnVsbCA/IHJlc3VtZW4ubl9zZXJpZXNfd2FwZV9sdF8wXzUgKyAnLycgKyBuU3VicyA6ICdcdTIwMTQnO1xuICBjb25zdCBuTHQwMyA9XG4gICAgcmVzdW1lbi5uX3Nlcmllc193YXBlX2x0XzBfMyAhPSBudWxsID8gcmVzdW1lbi5uX3Nlcmllc193YXBlX2x0XzBfMyArICcvJyArIG5TdWJzIDogJ1x1MjAxNCc7XG5cbiAgY29uc3QgYmFubmVyID1cbiAgICAnPGRpdiBzdHlsZT1cIm1hcmdpbi1ib3R0b206MTRweDtwYWRkaW5nOjEycHggMTRweDtiYWNrZ3JvdW5kOnZhcigtLWJnLXNlY29uZGFyeSk7Ym9yZGVyLWxlZnQ6M3B4IHNvbGlkICMwZDk0ODg7Ym9yZGVyLXJhZGl1czo2cHg7Zm9udC1zaXplOjEycHg7Y29sb3I6dmFyKC0tdGV4dC1zZWNvbmRhcnkpO2xpbmUtaGVpZ2h0OjEuNTtkaXNwbGF5OmdyaWQ7Z3JpZC10ZW1wbGF0ZS1jb2x1bW5zOnJlcGVhdChhdXRvLWZpdCxtaW5tYXgoMTYwcHgsMWZyKSk7Z2FwOjEwcHhcIj4nICtcbiAgICAnPGRpdj48ZGl2IHN0eWxlPVwiZm9udC1zaXplOjEwcHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO2xldHRlci1zcGFjaW5nOi40cHhcIj5XQVBFIG1lZGlhbm88L2Rpdj48ZGl2IHN0eWxlPVwiZm9udC1zaXplOjIwcHg7Zm9udC13ZWlnaHQ6ODAwO2NvbG9yOnZhcigtLXRleHQtcHJpbWFyeSlcIj4nICtcbiAgICB3YXBlTWVkICtcbiAgICAnPC9kaXY+PC9kaXY+JyArXG4gICAgJzxkaXY+PGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMHB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtsZXR0ZXItc3BhY2luZzouNHB4XCI+U3ViZmFtaWxpYXM8L2Rpdj48ZGl2IHN0eWxlPVwiZm9udC1zaXplOjIwcHg7Zm9udC13ZWlnaHQ6ODAwO2NvbG9yOnZhcigtLXRleHQtcHJpbWFyeSlcIj4nICtcbiAgICBuU3VicyArXG4gICAgJzwvZGl2PjwvZGl2PicgK1xuICAgICc8ZGl2PjxkaXYgc3R5bGU9XCJmb250LXNpemU6MTBweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7bGV0dGVyLXNwYWNpbmc6LjRweFwiPldBUEUgJmx0OyAzMCUgKGV4Y2VsZW50ZSk8L2Rpdj48ZGl2IHN0eWxlPVwiZm9udC1zaXplOjIwcHg7Zm9udC13ZWlnaHQ6ODAwO2NvbG9yOiMxNmEzNGFcIj4nICtcbiAgICBuTHQwMyArXG4gICAgJzwvZGl2PjwvZGl2PicgK1xuICAgICc8ZGl2PjxkaXYgc3R5bGU9XCJmb250LXNpemU6MTBweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7bGV0dGVyLXNwYWNpbmc6LjRweFwiPldBUEUgJmx0OyA1MCUgKGJ1ZW5vKTwvZGl2PjxkaXYgc3R5bGU9XCJmb250LXNpemU6MjBweDtmb250LXdlaWdodDo4MDA7Y29sb3I6Izg0Y2MxNlwiPicgK1xuICAgIG5MdDA1ICtcbiAgICAnPC9kaXY+PC9kaXY+JyArXG4gICAgJzxkaXY+PGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMHB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtsZXR0ZXItc3BhY2luZzouNHB4XCI+XHUwMERBbHRpbWEgY29ycmlkYTwvZGl2PjxkaXYgc3R5bGU9XCJmb250LXNpemU6MTNweDtmb250LXdlaWdodDo2MDA7Y29sb3I6dmFyKC0tdGV4dC1wcmltYXJ5KTttYXJnaW4tdG9wOjRweFwiPicgK1xuICAgIGVzY2FwZUh0bWxTYWZlKGdlbmVyYXRlZCkgK1xuICAgICc8L2Rpdj48L2Rpdj4nICtcbiAgICAnPC9kaXY+JztcblxuICAvLyBUYWJsYSByb3dzXG4gIGNvbnN0IHJvd3NIdG1sID0gZG9jc1xuICAgIC5tYXAoKGQpID0+IHtcbiAgICAgIGNvbnN0IHdhcGUgPSBkLm1ldHJpY3MgJiYgZC5tZXRyaWNzLndhcGUgIT0gbnVsbCA/IGQubWV0cmljcy53YXBlIDogbnVsbDtcbiAgICAgIGNvbnN0IGJlc3RNb2RlbCA9IGQuYmVzdE1vZGVsIHx8ICdcdTIwMTQnO1xuICAgICAgY29uc3QgZm9yZWNhc3RNYXAgPSB7fTtcbiAgICAgIChkLmZvcmVjYXN0IHx8IFtdKS5mb3JFYWNoKChmKSA9PiB7XG4gICAgICAgIGZvcmVjYXN0TWFwW2YuZHNdID0gZi55X2hhdDtcbiAgICAgIH0pO1xuICAgICAgY29uc3QgbW9udGhDZWxscyA9IG1vbnRoc0lzb1xuICAgICAgICAubWFwKFxuICAgICAgICAgIChkcykgPT5cbiAgICAgICAgICAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjhweCAxMHB4O3RleHQtYWxpZ246cmlnaHQ7Zm9udC12YXJpYW50LW51bWVyaWM6dGFidWxhci1udW1zO2ZvbnQtd2VpZ2h0OjYwMDtjb2xvcjp2YXIoLS10ZXh0LXByaW1hcnkpXCI+JyArXG4gICAgICAgICAgICBfZm10TnVtKGZvcmVjYXN0TWFwW2RzXSkgK1xuICAgICAgICAgICAgJzwvdGQ+J1xuICAgICAgICApXG4gICAgICAgIC5qb2luKCcnKTtcbiAgICAgIGNvbnN0IHRvdGFsNyA9IChkLmZvcmVjYXN0IHx8IFtdKS5yZWR1Y2UoKHMsIGYpID0+IHMgKyAoTnVtYmVyKGYueV9oYXQpIHx8IDApLCAwKTtcbiAgICAgIHJldHVybiAoXG4gICAgICAgICc8dHIgb25jbGljaz1cIm9wZW5Gb3JlY2FzdFN0YXREZXRhaWwoXFwnJyArXG4gICAgICAgIGVzY2FwZUh0bWxTYWZlKGQuaWQpICtcbiAgICAgICAgJ1xcJylcIiBzdHlsZT1cImN1cnNvcjpwb2ludGVyO2JvcmRlci1ib3R0b206MXB4IHNvbGlkIHZhcigtLWJvcmRlci1zdWJ0bGUpXCIgb25tb3VzZW92ZXI9XCJ0aGlzLnN0eWxlLmJhY2tncm91bmQ9XFwndmFyKC0tYmctc2Vjb25kYXJ5KVxcJ1wiIG9ubW91c2VvdXQ9XCJ0aGlzLnN0eWxlLmJhY2tncm91bmQ9XFwndHJhbnNwYXJlbnRcXCdcIj4nICtcbiAgICAgICAgJzx0ZCBzdHlsZT1cInBhZGRpbmc6OHB4IDEwcHg7Zm9udC13ZWlnaHQ6NzAwO2NvbG9yOnZhcigtLXRleHQtcHJpbWFyeSlcIj4nICtcbiAgICAgICAgZXNjYXBlSHRtbFNhZmUoZC5zdWJmYW1pbGlhIHx8IGQuaWQpICtcbiAgICAgICAgJzwvdGQ+JyArXG4gICAgICAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjhweCAxMHB4O2ZvbnQtc2l6ZToxMXB4O2NvbG9yOnZhcigtLXRleHQtc2Vjb25kYXJ5KVwiPicgK1xuICAgICAgICBlc2NhcGVIdG1sU2FmZShiZXN0TW9kZWwpICtcbiAgICAgICAgJzwvdGQ+JyArXG4gICAgICAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjhweCAxMHB4O3RleHQtYWxpZ246Y2VudGVyXCI+PHNwYW4gc3R5bGU9XCJkaXNwbGF5OmlubGluZS1ibG9jaztwYWRkaW5nOjNweCA4cHg7Ym9yZGVyLXJhZGl1czoxMnB4O2JhY2tncm91bmQ6JyArXG4gICAgICAgIF93YXBlQmFkZ2VDb2xvcih3YXBlKSArXG4gICAgICAgICc7Y29sb3I6I2ZmZjtmb250LXNpemU6MTFweDtmb250LXdlaWdodDo3MDBcIj4nICtcbiAgICAgICAgX2ZtdFdhcGUod2FwZSkgK1xuICAgICAgICAnPC9zcGFuPjwvdGQ+JyArXG4gICAgICAgIG1vbnRoQ2VsbHMgK1xuICAgICAgICAnPHRkIHN0eWxlPVwicGFkZGluZzo4cHggMTBweDt0ZXh0LWFsaWduOnJpZ2h0O2ZvbnQtdmFyaWFudC1udW1lcmljOnRhYnVsYXItbnVtcztmb250LXdlaWdodDo3MDA7Y29sb3I6IzBkOTQ4ODtiYWNrZ3JvdW5kOnZhcigtLWJnLXNlY29uZGFyeSlcIj4nICtcbiAgICAgICAgX2ZtdE51bSh0b3RhbDcpICtcbiAgICAgICAgJzwvdGQ+JyArXG4gICAgICAgICc8L3RyPidcbiAgICAgICk7XG4gICAgfSlcbiAgICAuam9pbignJyk7XG5cbiAgY29uc3QgbW9udGhIZWFkZXJzSHRtbCA9IG1vbnRoSGVhZGVyc1xuICAgIC5tYXAoXG4gICAgICAobSkgPT5cbiAgICAgICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6OHB4IDEwcHg7dGV4dC1hbGlnbjpyaWdodDtmb250LXNpemU6MTBweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7bGV0dGVyLXNwYWNpbmc6LjRweDtjb2xvcjojOTRhM2I4XCI+JyArXG4gICAgICAgIGVzY2FwZUh0bWxTYWZlKG0pICtcbiAgICAgICAgJzwvdGg+J1xuICAgIClcbiAgICAuam9pbignJyk7XG5cbiAgY29uc3QgdGFibGUgPVxuICAgICc8ZGl2IHN0eWxlPVwib3ZlcmZsb3c6YXV0bztib3JkZXI6MXB4IHNvbGlkIHZhcigtLWJvcmRlci1zdWJ0bGUpO2JvcmRlci1yYWRpdXM6OHB4XCI+JyArXG4gICAgJzx0YWJsZSBzdHlsZT1cIndpZHRoOjEwMCU7Ym9yZGVyLWNvbGxhcHNlOmNvbGxhcHNlO2ZvbnQtc2l6ZToxMnB4XCI+JyArXG4gICAgJzx0aGVhZCBzdHlsZT1cImJhY2tncm91bmQ6IzBmMTcyYTtjb2xvcjojZmZmXCI+PHRyPicgK1xuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjhweCAxMHB4O3RleHQtYWxpZ246bGVmdDtmb250LXNpemU6MTBweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7bGV0dGVyLXNwYWNpbmc6LjRweFwiPlN1YmZhbWlsaWE8L3RoPicgK1xuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjhweCAxMHB4O3RleHQtYWxpZ246bGVmdDtmb250LXNpemU6MTBweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7bGV0dGVyLXNwYWNpbmc6LjRweFwiPk1vZGVsbzwvdGg+JyArXG4gICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6OHB4IDEwcHg7dGV4dC1hbGlnbjpjZW50ZXI7Zm9udC1zaXplOjEwcHg7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO2xldHRlci1zcGFjaW5nOi40cHhcIj5XQVBFPC90aD4nICtcbiAgICBtb250aEhlYWRlcnNIdG1sICtcbiAgICAnPHRoIHN0eWxlPVwicGFkZGluZzo4cHggMTBweDt0ZXh0LWFsaWduOnJpZ2h0O2ZvbnQtc2l6ZToxMHB4O3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtsZXR0ZXItc3BhY2luZzouNHB4O2JhY2tncm91bmQ6IzEzNGU0YVwiPlRvdGFsIDdtPC90aD4nICtcbiAgICAnPC90cj48L3RoZWFkPicgK1xuICAgICc8dGJvZHk+JyArXG4gICAgcm93c0h0bWwgK1xuICAgICc8L3Rib2R5PjwvdGFibGU+PC9kaXY+JztcblxuICBjb25zdCBmb290ZXIgPVxuICAgICc8ZGl2IHN0eWxlPVwibWFyZ2luLXRvcDoxMnB4O2ZvbnQtc2l6ZToxMXB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO2xpbmUtaGVpZ2h0OjEuNVwiPicgK1xuICAgICc8Yj5DXHUwMEYzbW8gbGVlcjwvYj46IFdBUEUgKFdlaWdodGVkIEFic29sdXRlIFBlcmNlbnRhZ2UgRXJyb3IpIG1pZGUgZWwgZXJyb3IgZGVsIG1vZGVsbyByZWxhdGl2byBhbCB0b3RhbCByZWFsOiAmbHQ7MzAlIGV4Y2VsZW50ZSwgMzAtNTAlIGJ1ZW5vLCA1MC03MCUgYWNlcHRhYmxlLCAmZ3Q7NzAlIHBvYnJlLiBDbGljayBlbiBmaWxhIHBhcmEgZGV0YWxsZSArIGdyXHUwMEUxZmljby4gJyArXG4gICAgJ1NlIGVsaWdlIGVsIG1vZGVsbyBjb24gbWVub3IgV0FQRSBwb3Igc2VyaWUgdHJhcyBiYWNrdGVzdCByb2xsaW5nLW9yaWdpbiAoaD0yLCB2ZW50YW5hcz0zKS4nICtcbiAgICAnPC9kaXY+JztcblxuICBjb250LmlubmVySFRNTCA9ICc8ZGl2IHN0eWxlPVwicGFkZGluZzoxOHB4XCI+JyArIGJhbm5lciArIHRhYmxlICsgZm9vdGVyICsgJzwvZGl2Pic7XG59XG5cbi8vIENhY2hlIGhpc3RvcmlhIGFncmVnYWRhIHBvciBzdWJmYW1pbGlhIChwYXJhIGdyXHUwMEUxZmljbyBkZXRhbGxlKS5cbmFzeW5jIGZ1bmN0aW9uIF9sb2FkRm9yZWNhc3RTdGF0SGlzdG9yeSgpIHtcbiAgaWYgKF9mb3JlY2FzdFN0YXRIaXN0b3J5Q2FjaGUpIHJldHVybiBfZm9yZWNhc3RTdGF0SGlzdG9yeUNhY2hlO1xuICAvLyBMYSBoaXN0b3JpYSBzb2xvIGVzdFx1MDBFMSBlbiBCUSAofjEwIGFcdTAwRjFvcyBCYXJhbGRvICsgMTIgbWVzZXMgU2hpbWFubykuIENvbW9cbiAgLy8gZWwgcGlwZWxpbmUgbGEgZXNjcmliZSBhIENTViBsb2NhbCwgYWNcdTAwRTEgbm8gbGEgcG9kZW1vcyBsZWVyLiBBbHRlcm5hdGl2YTpcbiAgLy8gdXNhciBza3VfdmVudGFzX3NuYXBzaG90IHF1ZSB0aWVuZSB2ZW50YXMgbWVuc3VhbGVzIHBlcm8gc29sbyBncnVwbyBQRVNDQS5cbiAgLy8gRW4gRjJCLjIgc29sbyBtb3N0cmFtb3MgZm9yZWNhc3QrSUMgKHNpbiBvdmVybGF5IGhpc3RvcmlhIHBvciBhaG9yYSkuXG4gIF9mb3JlY2FzdFN0YXRIaXN0b3J5Q2FjaGUgPSB7fTtcbiAgcmV0dXJuIF9mb3JlY2FzdFN0YXRIaXN0b3J5Q2FjaGU7XG59XG5cbmZ1bmN0aW9uIF9idWlsZEZvcmVjYXN0Q2hhcnRTdmcoZG9jKSB7XG4gIGNvbnN0IGZjID0gZG9jLmZvcmVjYXN0IHx8IFtdO1xuICBpZiAoIWZjLmxlbmd0aClcbiAgICByZXR1cm4gJzxkaXYgc3R5bGU9XCJwYWRkaW5nOjMwcHg7dGV4dC1hbGlnbjpjZW50ZXI7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZClcIj5TaW4gZGF0b3MgZGUgZm9yZWNhc3Q8L2Rpdj4nO1xuICAvLyBEaW1lbnNpb25lc1xuICBjb25zdCBXID0gNjQwLFxuICAgIEggPSAyNjA7XG4gIGNvbnN0IHBhZEwgPSA1MCxcbiAgICBwYWRSID0gMjAsXG4gICAgcGFkVCA9IDIwLFxuICAgIHBhZEIgPSA0MDtcbiAgY29uc3QgaW5uZXJXID0gVyAtIHBhZEwgLSBwYWRSO1xuICBjb25zdCBpbm5lckggPSBIIC0gcGFkVCAtIHBhZEI7XG5cbiAgLy8gWSByYW5nZTogbWF4KGhpODApICogMS4xXG4gIGNvbnN0IG1heFkgPSBNYXRoLm1heCgxLCAuLi5mYy5tYXAoKGYpID0+IE51bWJlcihmLmhpODApIHx8IE51bWJlcihmLnlfaGF0KSB8fCAwKSk7XG4gIGNvbnN0IG1pblkgPSAwO1xuICBjb25zdCBzY2FsZVggPSAoaSkgPT4gcGFkTCArIChpbm5lclcgKiBpKSAvIE1hdGgubWF4KDEsIGZjLmxlbmd0aCAtIDEpO1xuICBjb25zdCBzY2FsZVkgPSAodikgPT4gcGFkVCArIGlubmVySCAtIChpbm5lckggKiAodiAtIG1pblkpKSAvIChtYXhZIC0gbWluWSk7XG5cbiAgLy8gR3JpZCArIGVqZSBZXG4gIGNvbnN0IHlUaWNrcyA9IFswLCAwLjI1LCAwLjUsIDAuNzUsIDFdXG4gICAgLm1hcCgocikgPT4ge1xuICAgICAgY29uc3QgdmFsID0gbWluWSArIHIgKiAobWF4WSAtIG1pblkpO1xuICAgICAgY29uc3QgeXkgPSBzY2FsZVkodmFsKTtcbiAgICAgIHJldHVybiAoXG4gICAgICAgICc8bGluZSB4MT1cIicgK1xuICAgICAgICBwYWRMICtcbiAgICAgICAgJ1wiIHkxPVwiJyArXG4gICAgICAgIHl5ICtcbiAgICAgICAgJ1wiIHgyPVwiJyArXG4gICAgICAgIChXIC0gcGFkUikgK1xuICAgICAgICAnXCIgeTI9XCInICtcbiAgICAgICAgeXkgK1xuICAgICAgICAnXCIgc3Ryb2tlPVwiI2UyZThmMFwiIHN0cm9rZS13aWR0aD1cIjFcIi8+JyArXG4gICAgICAgICc8dGV4dCB4PVwiJyArXG4gICAgICAgIChwYWRMIC0gNikgK1xuICAgICAgICAnXCIgeT1cIicgK1xuICAgICAgICAoeXkgKyA0KSArXG4gICAgICAgICdcIiB0ZXh0LWFuY2hvcj1cImVuZFwiIGZvbnQtc2l6ZT1cIjEwXCIgZmlsbD1cIiM2NDc0OGJcIj4nICtcbiAgICAgICAgX2ZtdE51bSh2YWwpICtcbiAgICAgICAgJzwvdGV4dD4nXG4gICAgICApO1xuICAgIH0pXG4gICAgLmpvaW4oJycpO1xuXG4gIC8vIEVqZSBYIChtZXNlcylcbiAgY29uc3QgeExhYmVscyA9IGZjXG4gICAgLm1hcCgoZiwgaSkgPT4ge1xuICAgICAgY29uc3QgeHggPSBzY2FsZVgoaSk7XG4gICAgICByZXR1cm4gKFxuICAgICAgICAnPHRleHQgeD1cIicgK1xuICAgICAgICB4eCArXG4gICAgICAgICdcIiB5PVwiJyArXG4gICAgICAgIChIIC0gcGFkQiArIDE1KSArXG4gICAgICAgICdcIiB0ZXh0LWFuY2hvcj1cIm1pZGRsZVwiIGZvbnQtc2l6ZT1cIjEwXCIgZmlsbD1cIiM2NDc0OGJcIj4nICtcbiAgICAgICAgX2ZtdERzU2hvcnQoZi5kcykgK1xuICAgICAgICAnPC90ZXh0PidcbiAgICAgICk7XG4gICAgfSlcbiAgICAuam9pbignJyk7XG5cbiAgLy8gSW50ZXJ2YWxvIGNvbmZpYW56YSAoYmFuZClcbiAgY29uc3QgYmFuZFBvaW50cyA9XG4gICAgZmMubWFwKChmLCBpKSA9PiBzY2FsZVgoaSkgKyAnLCcgKyBzY2FsZVkoTnVtYmVyKGYuaGk4MCkgfHwgMCkpLmpvaW4oJyAnKSArXG4gICAgJyAnICtcbiAgICBmY1xuICAgICAgLnNsaWNlKClcbiAgICAgIC5yZXZlcnNlKClcbiAgICAgIC5tYXAoKGYsIGkpID0+IHNjYWxlWChmYy5sZW5ndGggLSAxIC0gaSkgKyAnLCcgKyBzY2FsZVkoTnVtYmVyKGYubG84MCkgfHwgMCkpXG4gICAgICAuam9pbignICcpO1xuICBjb25zdCBiYW5kID0gJzxwb2x5Z29uIHBvaW50cz1cIicgKyBiYW5kUG9pbnRzICsgJ1wiIGZpbGw9XCIjMGQ5NDg4MzNcIiBzdHJva2U9XCJub25lXCIvPic7XG5cbiAgLy8gTGluZSBmb3JlY2FzdCArIHB1bnRvc1xuICBjb25zdCBsaW5lUG9pbnRzID0gZmMubWFwKChmLCBpKSA9PiBzY2FsZVgoaSkgKyAnLCcgKyBzY2FsZVkoTnVtYmVyKGYueV9oYXQpIHx8IDApKS5qb2luKCcgJyk7XG4gIGNvbnN0IGxpbmUgPVxuICAgICc8cG9seWxpbmUgcG9pbnRzPVwiJyArXG4gICAgbGluZVBvaW50cyArXG4gICAgJ1wiIGZpbGw9XCJub25lXCIgc3Ryb2tlPVwiIzBkOTQ4OFwiIHN0cm9rZS13aWR0aD1cIjIuNVwiIHN0cm9rZS1saW5lam9pbj1cInJvdW5kXCIvPic7XG4gIGNvbnN0IHBvaW50cyA9IGZjXG4gICAgLm1hcChcbiAgICAgIChmLCBpKSA9PlxuICAgICAgICAnPGNpcmNsZSBjeD1cIicgK1xuICAgICAgICBzY2FsZVgoaSkgK1xuICAgICAgICAnXCIgY3k9XCInICtcbiAgICAgICAgc2NhbGVZKE51bWJlcihmLnlfaGF0KSB8fCAwKSArXG4gICAgICAgICdcIiByPVwiNFwiIGZpbGw9XCIjMGQ5NDg4XCIgc3Ryb2tlPVwiI2ZmZlwiIHN0cm9rZS13aWR0aD1cIjJcIi8+J1xuICAgIClcbiAgICAuam9pbignJyk7XG4gIC8vIExhYmVscyBkZSB2YWxvclxuICBjb25zdCB2YWx1ZUxhYmVscyA9IGZjXG4gICAgLm1hcCgoZiwgaSkgPT4ge1xuICAgICAgY29uc3QgeHggPSBzY2FsZVgoaSk7XG4gICAgICBjb25zdCB5eSA9IHNjYWxlWShOdW1iZXIoZi55X2hhdCkgfHwgMCk7XG4gICAgICByZXR1cm4gKFxuICAgICAgICAnPHRleHQgeD1cIicgK1xuICAgICAgICB4eCArXG4gICAgICAgICdcIiB5PVwiJyArXG4gICAgICAgICh5eSAtIDgpICtcbiAgICAgICAgJ1wiIHRleHQtYW5jaG9yPVwibWlkZGxlXCIgZm9udC1zaXplPVwiMTBcIiBmb250LXdlaWdodD1cIjcwMFwiIGZpbGw9XCIjMGY3NjZlXCI+JyArXG4gICAgICAgIF9mbXROdW0oZi55X2hhdCkgK1xuICAgICAgICAnPC90ZXh0PidcbiAgICAgICk7XG4gICAgfSlcbiAgICAuam9pbignJyk7XG5cbiAgY29uc3Qgc3ZnID1cbiAgICAnPHN2ZyB2aWV3Qm94PVwiMCAwICcgK1xuICAgIFcgK1xuICAgICcgJyArXG4gICAgSCArXG4gICAgJ1wiIHN0eWxlPVwid2lkdGg6MTAwJTttYXgtd2lkdGg6ODAwcHg7aGVpZ2h0OmF1dG9cIj4nICtcbiAgICAnPHJlY3QgeD1cIjBcIiB5PVwiMFwiIHdpZHRoPVwiJyArXG4gICAgVyArXG4gICAgJ1wiIGhlaWdodD1cIicgK1xuICAgIEggK1xuICAgICdcIiBmaWxsPVwiI2ZmZlwiLz4nICtcbiAgICB5VGlja3MgK1xuICAgIHhMYWJlbHMgK1xuICAgIGJhbmQgK1xuICAgIGxpbmUgK1xuICAgIHBvaW50cyArXG4gICAgdmFsdWVMYWJlbHMgK1xuICAgICc8L3N2Zz4nO1xuICByZXR1cm4gc3ZnO1xufVxuXG53aW5kb3cub3BlbkZvcmVjYXN0U3RhdERldGFpbCA9IGZ1bmN0aW9uIChzdWJJZCkge1xuICBpZiAoIV9mb3JlY2FzdFN0YXREb2NzKSByZXR1cm47XG4gIGNvbnN0IGRvYyA9IF9mb3JlY2FzdFN0YXREb2NzLmZpbmQoKGQpID0+IGQuaWQgPT09IHN1YklkKTtcbiAgaWYgKCFkb2MpIHtcbiAgICBhbGVydCgnTm8gc2UgZW5jb250clx1MDBGMyBkZXRhbGxlIGRlICcgKyBzdWJJZCk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGNvbnN0IGV4aXN0aW5nID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2ZvcmVjYXN0LXN0YXQtZGV0YWlsJyk7XG4gIGlmIChleGlzdGluZykgZXhpc3RpbmcucmVtb3ZlKCk7XG5cbiAgY29uc3QgZWwgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKTtcbiAgZWwuaWQgPSAnZm9yZWNhc3Qtc3RhdC1kZXRhaWwnO1xuICBlbC5zdHlsZS5jc3NUZXh0ID1cbiAgICAncG9zaXRpb246Zml4ZWQ7aW5zZXQ6MDtiYWNrZ3JvdW5kOnJnYmEoMTUsMjMsNDIsLjY1KTt6LWluZGV4OjIxMDA7ZGlzcGxheTpmbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtqdXN0aWZ5LWNvbnRlbnQ6Y2VudGVyO3BhZGRpbmc6MnZoJztcbiAgZWwub25jbGljayA9IChldikgPT4ge1xuICAgIGlmIChldi50YXJnZXQgPT09IGVsKSBlbC5yZW1vdmUoKTtcbiAgfTtcblxuICBjb25zdCB3YXBlID0gZG9jLm1ldHJpY3MgJiYgZG9jLm1ldHJpY3Mud2FwZTtcbiAgY29uc3QgYmlhcyA9IGRvYy5tZXRyaWNzICYmIGRvYy5tZXRyaWNzLmJpYXM7XG4gIGNvbnN0IG1hZSA9IGRvYy5tZXRyaWNzICYmIGRvYy5tZXRyaWNzLm1hZTtcbiAgY29uc3Qgcm1zZSA9IGRvYy5tZXRyaWNzICYmIGRvYy5tZXRyaWNzLnJtc2U7XG4gIGNvbnN0IGJlc3RNb2RlbCA9IGRvYy5iZXN0TW9kZWwgfHwgJ1x1MjAxNCc7XG4gIGNvbnN0IHZlcnNpb25JZCA9IGRvYy52ZXJzaW9uSWQgfHwgJ1x1MjAxNCc7XG4gIGNvbnN0IHN2Z0h0bWwgPSBfYnVpbGRGb3JlY2FzdENoYXJ0U3ZnKGRvYyk7XG5cbiAgY29uc3QgbWV0cmljc0h0bWwgPVxuICAgICc8ZGl2IHN0eWxlPVwiZGlzcGxheTpncmlkO2dyaWQtdGVtcGxhdGUtY29sdW1uczpyZXBlYXQoYXV0by1maXQsbWlubWF4KDEyMHB4LDFmcikpO2dhcDoxMHB4O21hcmdpbjoxNHB4IDBcIj4nICtcbiAgICAnPGRpdiBzdHlsZT1cInBhZGRpbmc6MTBweDtiYWNrZ3JvdW5kOnZhcigtLWJnLXNlY29uZGFyeSk7Ym9yZGVyLXJhZGl1czo2cHhcIj48ZGl2IHN0eWxlPVwiZm9udC1zaXplOjEwcHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlXCI+TW9kZWxvPC9kaXY+PGRpdiBzdHlsZT1cImZvbnQtd2VpZ2h0OjcwMFwiPicgK1xuICAgIGVzY2FwZUh0bWxTYWZlKGJlc3RNb2RlbCkgK1xuICAgICc8L2Rpdj48L2Rpdj4nICtcbiAgICAnPGRpdiBzdHlsZT1cInBhZGRpbmc6MTBweDtiYWNrZ3JvdW5kOnZhcigtLWJnLXNlY29uZGFyeSk7Ym9yZGVyLXJhZGl1czo2cHhcIj48ZGl2IHN0eWxlPVwiZm9udC1zaXplOjEwcHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlXCI+V0FQRTwvZGl2PjxkaXYgc3R5bGU9XCJmb250LXdlaWdodDo3MDA7Y29sb3I6JyArXG4gICAgX3dhcGVCYWRnZUNvbG9yKHdhcGUpICtcbiAgICAnXCI+JyArXG4gICAgX2ZtdFdhcGUod2FwZSkgK1xuICAgICc8L2Rpdj48L2Rpdj4nICtcbiAgICAnPGRpdiBzdHlsZT1cInBhZGRpbmc6MTBweDtiYWNrZ3JvdW5kOnZhcigtLWJnLXNlY29uZGFyeSk7Ym9yZGVyLXJhZGl1czo2cHhcIj48ZGl2IHN0eWxlPVwiZm9udC1zaXplOjEwcHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlXCI+QmlhczwvZGl2PjxkaXYgc3R5bGU9XCJmb250LXdlaWdodDo3MDBcIj4nICtcbiAgICAoYmlhcyAhPSBudWxsID8gKGJpYXMgKiAxMDApLnRvRml4ZWQoMCkgKyAnJScgOiAnXHUyMDE0JykgK1xuICAgICc8L2Rpdj48L2Rpdj4nICtcbiAgICAnPGRpdiBzdHlsZT1cInBhZGRpbmc6MTBweDtiYWNrZ3JvdW5kOnZhcigtLWJnLXNlY29uZGFyeSk7Ym9yZGVyLXJhZGl1czo2cHhcIj48ZGl2IHN0eWxlPVwiZm9udC1zaXplOjEwcHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlXCI+TUFFPC9kaXY+PGRpdiBzdHlsZT1cImZvbnQtd2VpZ2h0OjcwMFwiPicgK1xuICAgIF9mbXROdW0obWFlKSArXG4gICAgJzwvZGl2PjwvZGl2PicgK1xuICAgICc8ZGl2IHN0eWxlPVwicGFkZGluZzoxMHB4O2JhY2tncm91bmQ6dmFyKC0tYmctc2Vjb25kYXJ5KTtib3JkZXItcmFkaXVzOjZweFwiPjxkaXYgc3R5bGU9XCJmb250LXNpemU6MTBweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2VcIj5STVNFPC9kaXY+PGRpdiBzdHlsZT1cImZvbnQtd2VpZ2h0OjcwMFwiPicgK1xuICAgIF9mbXROdW0ocm1zZSkgK1xuICAgICc8L2Rpdj48L2Rpdj4nICtcbiAgICAnPC9kaXY+JztcblxuICBjb25zdCB0YWJsZUh0bWwgPVxuICAgICc8dGFibGUgc3R5bGU9XCJ3aWR0aDoxMDAlO2ZvbnQtc2l6ZToxMnB4O2JvcmRlci1jb2xsYXBzZTpjb2xsYXBzZTttYXJnaW4tdG9wOjEwcHhcIj4nICtcbiAgICAnPHRoZWFkIHN0eWxlPVwiYmFja2dyb3VuZDojMGYxNzJhO2NvbG9yOiNmZmZcIj48dHI+JyArXG4gICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6NnB4IDEwcHg7dGV4dC1hbGlnbjpsZWZ0XCI+TWVzPC90aD4nICtcbiAgICAnPHRoIHN0eWxlPVwicGFkZGluZzo2cHggMTBweDt0ZXh0LWFsaWduOnJpZ2h0XCI+Rm9yZWNhc3Q8L3RoPicgK1xuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjZweCAxMHB4O3RleHQtYWxpZ246cmlnaHRcIj5JQyA4MCUgYmFqbzwvdGg+JyArXG4gICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6NnB4IDEwcHg7dGV4dC1hbGlnbjpyaWdodFwiPklDIDgwJSBhbHRvPC90aD4nICtcbiAgICAnPC90cj48L3RoZWFkPjx0Ym9keT4nICtcbiAgICAoZG9jLmZvcmVjYXN0IHx8IFtdKVxuICAgICAgLm1hcChcbiAgICAgICAgKGYpID0+XG4gICAgICAgICAgJzx0ciBzdHlsZT1cImJvcmRlci1ib3R0b206MXB4IHNvbGlkIHZhcigtLWJvcmRlci1zdWJ0bGUpXCI+PHRkIHN0eWxlPVwicGFkZGluZzo2cHggMTBweFwiPicgK1xuICAgICAgICAgIGVzY2FwZUh0bWxTYWZlKF9mbXREc1Nob3J0KGYuZHMpKSArXG4gICAgICAgICAgJzwvdGQ+JyArXG4gICAgICAgICAgJzx0ZCBzdHlsZT1cInBhZGRpbmc6NnB4IDEwcHg7dGV4dC1hbGlnbjpyaWdodDtmb250LXdlaWdodDo3MDBcIj4nICtcbiAgICAgICAgICBfZm10TnVtKGYueV9oYXQpICtcbiAgICAgICAgICAnPC90ZD4nICtcbiAgICAgICAgICAnPHRkIHN0eWxlPVwicGFkZGluZzo2cHggMTBweDt0ZXh0LWFsaWduOnJpZ2h0O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpXCI+JyArXG4gICAgICAgICAgX2ZtdE51bShmLmxvODApICtcbiAgICAgICAgICAnPC90ZD4nICtcbiAgICAgICAgICAnPHRkIHN0eWxlPVwicGFkZGluZzo2cHggMTBweDt0ZXh0LWFsaWduOnJpZ2h0O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpXCI+JyArXG4gICAgICAgICAgX2ZtdE51bShmLmhpODApICtcbiAgICAgICAgICAnPC90ZD48L3RyPidcbiAgICAgIClcbiAgICAgIC5qb2luKCcnKSArXG4gICAgJzwvdGJvZHk+PC90YWJsZT4nO1xuXG4gIGNvbnN0IGNvbnRlbnQgPVxuICAgICc8ZGl2IHN0eWxlPVwiYmFja2dyb3VuZDp2YXIoLS1iZy1lbGV2YXRlZCk7Ym9yZGVyLXJhZGl1czoxMnB4O3BhZGRpbmc6MjRweDttYXgtd2lkdGg6ODIwcHg7d2lkdGg6MTAwJTttYXgtaGVpZ2h0Ojk2dmg7b3ZlcmZsb3c6YXV0bztib3gtc2hhZG93OjAgMjBweCA2MHB4IHJnYmEoMCwwLDAsLjQpXCI+JyArXG4gICAgJzxkaXYgc3R5bGU9XCJkaXNwbGF5OmZsZXg7anVzdGlmeS1jb250ZW50OnNwYWNlLWJldHdlZW47YWxpZ24taXRlbXM6Y2VudGVyO21hcmdpbi1ib3R0b206MTBweFwiPicgK1xuICAgICc8ZGl2PjxkaXYgc3R5bGU9XCJmb250LXNpemU6MTFweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7bGV0dGVyLXNwYWNpbmc6LjRweFwiPlN1YmZhbWlsaWE8L2Rpdj48ZGl2IHN0eWxlPVwiZm9udC1zaXplOjIycHg7Zm9udC13ZWlnaHQ6ODAwXCI+JyArXG4gICAgZXNjYXBlSHRtbFNhZmUoZG9jLnN1YmZhbWlsaWEgfHwgZG9jLmlkKSArXG4gICAgJzwvZGl2PjwvZGl2PicgK1xuICAgICc8YnV0dG9uIG9uY2xpY2s9XCJkb2N1bWVudC5nZXRFbGVtZW50QnlJZChcXCdmb3JlY2FzdC1zdGF0LWRldGFpbFxcJykucmVtb3ZlKClcIiBzdHlsZT1cImJhY2tncm91bmQ6dHJhbnNwYXJlbnQ7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1ib3JkZXItc3VidGxlKTtib3JkZXItcmFkaXVzOjZweDtwYWRkaW5nOjZweCAxMnB4O2N1cnNvcjpwb2ludGVyO2ZvbnQtd2VpZ2h0OjcwMFwiPkNlcnJhcjwvYnV0dG9uPicgK1xuICAgICc8L2Rpdj4nICtcbiAgICBtZXRyaWNzSHRtbCArXG4gICAgJzxkaXYgc3R5bGU9XCJiYWNrZ3JvdW5kOiNmZmY7cGFkZGluZzo4cHg7Ym9yZGVyLXJhZGl1czo4cHg7bWFyZ2luLXRvcDoxMHB4O2JvcmRlcjoxcHggc29saWQgdmFyKC0tYm9yZGVyLXN1YnRsZSlcIj4nICtcbiAgICBzdmdIdG1sICtcbiAgICAnPC9kaXY+JyArXG4gICAgdGFibGVIdG1sICtcbiAgICAnPGRpdiBzdHlsZT1cIm1hcmdpbi10b3A6MTRweDtmb250LXNpemU6MTFweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKVwiPlZlcnNpb246IDxjb2RlPicgK1xuICAgIGVzY2FwZUh0bWxTYWZlKHZlcnNpb25JZCkgK1xuICAgICc8L2NvZGU+IFx1MDBCNyBBcHByb2FjaDogJyArXG4gICAgZXNjYXBlSHRtbFNhZmUoKGRvYy5jb25maWcgfHwge30pLmFwcHJvYWNoIHx8ICdcdTIwMTQnKSArXG4gICAgJzwvZGl2PicgK1xuICAgICc8L2Rpdj4nO1xuICBlbC5pbm5lckhUTUwgPSBjb250ZW50O1xuICBkb2N1bWVudC5ib2R5LmFwcGVuZENoaWxkKGVsKTtcbn07XG5cbndpbmRvdy5vcGVuRm9yZWNhc3RNb2RhbCA9IGFzeW5jIGZ1bmN0aW9uICgpIHtcbiAgaWYgKCFfY2FuRm9yZWNhc3QoKSkge1xuICAgIGFsZXJ0KCdGT1JFQ0FTVCBlcyBzb2xvIHBhcmEgTWFyaWFubyAoYWRtaW4pLicpO1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCBlbCA9IF9yZW5kZXJNb2RhbFNoZWxsKCk7XG4gIGVsLnN0eWxlLmRpc3BsYXkgPSAnYmxvY2snO1xuICAvLyBGYXNlIDE6IGNhcmdhciBTYWxlcyBQbGFucyBjYWNoZXMgKyByZW5kZXJpemFyIHRhYiBkZWZhdWx0LlxuICBfcmVuZGVyU2FsZXNQbGFuc1RhYigpO1xuICBfbG9hZFNhbGVzUGxhbkNhY2hlcygpXG4gICAgLnRoZW4oX3JlbmRlclNhbGVzUGxhbnNUYWIpXG4gICAgLmNhdGNoKCgpID0+IHt9KTtcbn07XG5cbndpbmRvdy5jbG9zZUZvcmVjYXN0TW9kYWwgPSBmdW5jdGlvbiAoKSB7XG4gIGNvbnN0IGVsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2ZvcmVjYXN0LW1vZGFsJyk7XG4gIGlmIChlbCkgZWwuc3R5bGUuZGlzcGxheSA9ICdub25lJztcbn07XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gRjNBIFx1MjAxNCBUYWJsYSBSZWNvbWVuZGFjaVx1MDBGM24gZGUgQ29tcHJhICh0YWIgU2FsZXMgUGxhbnMpXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuYXN5bmMgZnVuY3Rpb24gX2xvYWRNdWx0aXBsaWVyT3ZlcnJpZGVzKCkge1xuICBpZiAoIXdpbmRvdy5mYkRiKSByZXR1cm47XG4gIHRyeSB7XG4gICAgY29uc3QgZG9jID0gYXdhaXQgd2luZG93LmZiRGIuY29sbGVjdGlvbignZm9yZWNhc3RfY29uZmlnJykuZG9jKCdtdWx0aXBsaWVycycpLmdldCgpO1xuICAgIGlmIChkb2MuZXhpc3RzKSB7XG4gICAgICBjb25zdCBkID0gZG9jLmRhdGEoKSB8fCB7fTtcbiAgICAgIF9tdWx0aXBsaWVyT3ZlcnJpZGVzID0gZC5za3VPdmVycmlkZXMgfHwge307XG4gICAgfSBlbHNlIHtcbiAgICAgIF9tdWx0aXBsaWVyT3ZlcnJpZGVzID0ge307XG4gICAgfVxuICB9IGNhdGNoIChlKSB7XG4gICAgY29uc29sZS53YXJuKCdbRk9SRUNBU1QgcmVjb10gbG9hZCBtdWx0aXBsaWVycyBmYWlsOicsIGUgJiYgZS5tZXNzYWdlKTtcbiAgICBfbXVsdGlwbGllck92ZXJyaWRlcyA9IHt9O1xuICB9XG59XG5cbmFzeW5jIGZ1bmN0aW9uIF9zYXZlTXVsdGlwbGllck92ZXJyaWRlKHNrdVVwcGVyLCB2YWx1ZSkge1xuICBpZiAoIXdpbmRvdy5mYkRiKSByZXR1cm47XG4gIGlmICghX211bHRpcGxpZXJPdmVycmlkZXMpIF9tdWx0aXBsaWVyT3ZlcnJpZGVzID0ge307XG4gIGNvbnN0IHVpZCA9ICh3aW5kb3cuY3VycmVudFVzZXIgJiYgd2luZG93LmN1cnJlbnRVc2VyLmVtYWlsKSB8fCAndW5rbm93bic7XG4gIF9tdWx0aXBsaWVyT3ZlcnJpZGVzW3NrdVVwcGVyXSA9IHtcbiAgICB2YWx1ZTogTnVtYmVyKHZhbHVlKSxcbiAgICB1cGRhdGVkQXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICB1cGRhdGVkQnk6IHVpZCxcbiAgfTtcbiAgYXdhaXQgd2luZG93LmZiRGIuY29sbGVjdGlvbignZm9yZWNhc3RfY29uZmlnJykuZG9jKCdtdWx0aXBsaWVycycpLnNldCh7XG4gICAgc2t1T3ZlcnJpZGVzOiBfbXVsdGlwbGllck92ZXJyaWRlcyxcbiAgICB1cGRhdGVkQXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICB1cGRhdGVkQnk6IHVpZCxcbiAgfSk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIF9yZW1vdmVNdWx0aXBsaWVyT3ZlcnJpZGUoc2t1VXBwZXIpIHtcbiAgaWYgKCF3aW5kb3cuZmJEYiB8fCAhX211bHRpcGxpZXJPdmVycmlkZXMpIHJldHVybjtcbiAgZGVsZXRlIF9tdWx0aXBsaWVyT3ZlcnJpZGVzW3NrdVVwcGVyXTtcbiAgY29uc3QgdWlkID0gKHdpbmRvdy5jdXJyZW50VXNlciAmJiB3aW5kb3cuY3VycmVudFVzZXIuZW1haWwpIHx8ICd1bmtub3duJztcbiAgYXdhaXQgd2luZG93LmZiRGIuY29sbGVjdGlvbignZm9yZWNhc3RfY29uZmlnJykuZG9jKCdtdWx0aXBsaWVycycpLnNldCh7XG4gICAgc2t1T3ZlcnJpZGVzOiBfbXVsdGlwbGllck92ZXJyaWRlcyxcbiAgICB1cGRhdGVkQXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICB1cGRhdGVkQnk6IHVpZCxcbiAgfSk7XG59XG5cbi8vIEF1dG8gbXVsdGlwbGllcjogcmVjZW50L2Jhc2VsaW5lIGNvbiBjYXAuIFJldG9ybmEge3ZhbHVlLCBzb3VyY2U6ICdhdXRvJ3wnZmFsbGJhY2snfCdkZWZhdWx0JywgcmVjZW50LCBiYXNlbGluZX0uXG5mdW5jdGlvbiBfY29tcHV0ZU11bHRpcGxpZXJBdXRvKHNrdVVwcGVyKSB7XG4gIGNvbnN0IHJlYyA9IF9yZWNvVmVudGFzU25hcHNob3QgJiYgX3JlY29WZW50YXNTbmFwc2hvdFtza3VVcHBlcl07XG4gIGlmICghcmVjIHx8ICFyZWMubWVzZXMpIHJldHVybiB7IHZhbHVlOiAxLjAsIHNvdXJjZTogJ2RlZmF1bHQnLCByZWNlbnQ6IDAsIGJhc2VsaW5lOiAwIH07XG4gIGNvbnN0IGhveSA9IG5ldyBEYXRlKCk7XG4gIGNvbnN0IG1vbnRoc0JhY2tLZXkgPSAobikgPT4ge1xuICAgIGNvbnN0IGQgPSBuZXcgRGF0ZShob3kuZ2V0RnVsbFllYXIoKSwgaG95LmdldE1vbnRoKCkgLSBuLCAxKTtcbiAgICByZXR1cm4gU3RyaW5nKGQuZ2V0RnVsbFllYXIoKSkgKyAnLScgKyBTdHJpbmcoZC5nZXRNb250aCgpICsgMSkucGFkU3RhcnQoMiwgJzAnKTtcbiAgfTtcbiAgY29uc3QgY29sbGVjdEF2ZyA9IChuKSA9PiB7XG4gICAgbGV0IHN1bSA9IDA7XG4gICAgbGV0IGNvdW50ID0gMDtcbiAgICBmb3IgKGxldCBpID0gMTsgaSA8PSBuOyBpKyspIHtcbiAgICAgIGNvbnN0IGsgPSBtb250aHNCYWNrS2V5KGkpO1xuICAgICAgY29uc3QgbSA9IHJlYy5tZXNlc1trXTtcbiAgICAgIGlmIChtICYmIE51bWJlci5pc0Zpbml0ZShOdW1iZXIobS5xdHkpKSkge1xuICAgICAgICBzdW0gKz0gTnVtYmVyKG0ucXR5KTtcbiAgICAgICAgY291bnQrKztcbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIGNvdW50ID4gMCA/IHsgYXZnOiBzdW0gLyBjb3VudCwgbjogY291bnQgfSA6IHsgYXZnOiAwLCBuOiAwIH07XG4gIH07XG4gIGNvbnN0IHJlYzIgPSBjb2xsZWN0QXZnKFJFQ09fTVVMVF9SRUNFTlRfTU9OVEhTKTtcbiAgY29uc3QgYmFzNiA9IGNvbGxlY3RBdmcoUkVDT19NVUxUX0JBU0VMSU5FX01PTlRIUyk7XG4gIC8vIE5lY2VzaXRhbW9zIGFsIG1lbm9zIDEgbWVzIHJlY2llbnRlICsgMyBtZXNlcyBiYXNlbGluZSBwYXJhIGNhbGN1bGFyIGF1dG8uXG4gIGlmIChyZWMyLm4gPT09IDAgfHwgYmFzNi5uIDwgMyB8fCBiYXM2LmF2ZyA8IFJFQ09fTVVMVF9NSU5fQkFTRUxJTkUpIHtcbiAgICByZXR1cm4geyB2YWx1ZTogMS4wLCBzb3VyY2U6ICdkZWZhdWx0JywgcmVjZW50OiByZWMyLmF2ZywgYmFzZWxpbmU6IGJhczYuYXZnIH07XG4gIH1cbiAgbGV0IHJhdGlvID0gcmVjMi5hdmcgLyBiYXM2LmF2ZztcbiAgaWYgKHJhdGlvIDwgUkVDT19NVUxUX01JTikgcmF0aW8gPSBSRUNPX01VTFRfTUlOO1xuICBpZiAocmF0aW8gPiBSRUNPX01VTFRfTUFYKSByYXRpbyA9IFJFQ09fTVVMVF9NQVg7XG4gIHJldHVybiB7XG4gICAgdmFsdWU6IE1hdGgucm91bmQocmF0aW8gKiAxMDApIC8gMTAwLFxuICAgIHNvdXJjZTogJ2F1dG8nLFxuICAgIHJlY2VudDogTWF0aC5yb3VuZChyZWMyLmF2ZyAqIDEwKSAvIDEwLFxuICAgIGJhc2VsaW5lOiBNYXRoLnJvdW5kKGJhczYuYXZnICogMTApIC8gMTAsXG4gIH07XG59XG5cbmZ1bmN0aW9uIF9nZXRFZmZlY3RpdmVNdWx0aXBsaWVyKHNrdVVwcGVyKSB7XG4gIC8vIE92ZXJyaWRlIG1hbnVhbCBnYW5hXG4gIGlmIChfbXVsdGlwbGllck92ZXJyaWRlcyAmJiBfbXVsdGlwbGllck92ZXJyaWRlc1tza3VVcHBlcl0pIHtcbiAgICByZXR1cm4ge1xuICAgICAgdmFsdWU6IE51bWJlcihfbXVsdGlwbGllck92ZXJyaWRlc1tza3VVcHBlcl0udmFsdWUpIHx8IDEuMCxcbiAgICAgIHNvdXJjZTogJ21hbnVhbCcsXG4gICAgICBhdXRvOiBfY29tcHV0ZU11bHRpcGxpZXJBdXRvKHNrdVVwcGVyKSxcbiAgICB9O1xuICB9XG4gIGNvbnN0IGF1dG8gPSBfY29tcHV0ZU11bHRpcGxpZXJBdXRvKHNrdVVwcGVyKTtcbiAgcmV0dXJuIHsgdmFsdWU6IGF1dG8udmFsdWUsIHNvdXJjZTogYXV0by5zb3VyY2UsIGF1dG8gfTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gX2xvYWREaXNjb250aW51ZWRTa3VzKCkge1xuICBpZiAoIXdpbmRvdy5mYkRiKSByZXR1cm47XG4gIHRyeSB7XG4gICAgY29uc3QgZG9jID0gYXdhaXQgd2luZG93LmZiRGIuY29sbGVjdGlvbignZm9yZWNhc3RfY29uZmlnJykuZG9jKCdkaXNjb250aW51ZWRfc2t1cycpLmdldCgpO1xuICAgIGlmIChkb2MuZXhpc3RzKSB7XG4gICAgICBjb25zdCBkID0gZG9jLmRhdGEoKSB8fCB7fTtcbiAgICAgIGNvbnN0IGFyciA9IEFycmF5LmlzQXJyYXkoZC5za3VzKSA/IGQuc2t1cyA6IFtdO1xuICAgICAgX2Rpc2NvbnRpbnVlZFNrdXMgPSBuZXcgU2V0KGFyci5tYXAoKHMpID0+IFN0cmluZyhzKS50cmltKCkudG9VcHBlckNhc2UoKSkpO1xuICAgICAgX2Rpc2NvbnRpbnVlZE1ldGEgPSB7IHVwZGF0ZWRBdDogZC51cGRhdGVkQXQsIHVwZGF0ZWRCeTogZC51cGRhdGVkQnkgfTtcbiAgICB9IGVsc2Uge1xuICAgICAgX2Rpc2NvbnRpbnVlZFNrdXMgPSBuZXcgU2V0KCk7XG4gICAgICBfZGlzY29udGludWVkTWV0YSA9IG51bGw7XG4gICAgfVxuICB9IGNhdGNoIChlKSB7XG4gICAgY29uc29sZS53YXJuKCdbRk9SRUNBU1QgcmVjb10gbG9hZCBkaXNjb250aW51ZWQgZmFpbDonLCBlICYmIGUubWVzc2FnZSk7XG4gICAgX2Rpc2NvbnRpbnVlZFNrdXMgPSBuZXcgU2V0KCk7XG4gIH1cbn1cblxuYXN5bmMgZnVuY3Rpb24gX3NhdmVEaXNjb250aW51ZWRTa3VzKCkge1xuICBpZiAoIXdpbmRvdy5mYkRiIHx8ICFfZGlzY29udGludWVkU2t1cykgcmV0dXJuO1xuICBjb25zdCB1aWQgPSAod2luZG93LmN1cnJlbnRVc2VyICYmIHdpbmRvdy5jdXJyZW50VXNlci5lbWFpbCkgfHwgJ3Vua25vd24nO1xuICBjb25zdCBwYXlsb2FkID0ge1xuICAgIHNrdXM6IEFycmF5LmZyb20oX2Rpc2NvbnRpbnVlZFNrdXMpLnNvcnQoKSxcbiAgICB1cGRhdGVkQXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICB1cGRhdGVkQnk6IHVpZCxcbiAgfTtcbiAgYXdhaXQgd2luZG93LmZiRGIuY29sbGVjdGlvbignZm9yZWNhc3RfY29uZmlnJykuZG9jKCdkaXNjb250aW51ZWRfc2t1cycpLnNldChwYXlsb2FkKTtcbiAgX2Rpc2NvbnRpbnVlZE1ldGEgPSB7IHVwZGF0ZWRBdDogcGF5bG9hZC51cGRhdGVkQXQsIHVwZGF0ZWRCeTogcGF5bG9hZC51cGRhdGVkQnkgfTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gX2xvYWRSZWNvRGF0YSgpIHtcbiAgaWYgKCF3aW5kb3cuZmJEYikgdGhyb3cgbmV3IEVycm9yKCdGaXJlc3RvcmUgbm8gaW5pY2lhbGl6YWRvJyk7XG4gIGNvbnN0IHByb21pc2VzID0gW107XG4gIGlmICghX2Rpc2NvbnRpbnVlZFNrdXMpIHByb21pc2VzLnB1c2goX2xvYWREaXNjb250aW51ZWRTa3VzKCkpO1xuICBpZiAoIV9tdWx0aXBsaWVyT3ZlcnJpZGVzKSBwcm9taXNlcy5wdXNoKF9sb2FkTXVsdGlwbGllck92ZXJyaWRlcygpKTtcbiAgaWYgKCFfcmVjb1N0b2NrU25hcHNob3QpIHtcbiAgICBwcm9taXNlcy5wdXNoKFxuICAgICAgd2luZG93LmZiRGJcbiAgICAgICAgLmNvbGxlY3Rpb24oJ2FwcF9jb25maWcnKVxuICAgICAgICAuZG9jKCdzdG9ja19zbmFwc2hvdCcpXG4gICAgICAgIC5nZXQoKVxuICAgICAgICAudGhlbigoZCkgPT4ge1xuICAgICAgICAgIGNvbnN0IGRhdGEgPSBkLmV4aXN0cyA/IGQuZGF0YSgpIDoge307XG4gICAgICAgICAgbGV0IHdoID0ge307XG4gICAgICAgICAgbGV0IGJvID0ge307XG4gICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIHdoID0gZGF0YS53YXJlaG91c2VCcmVha2Rvd24gPyBKU09OLnBhcnNlKGRhdGEud2FyZWhvdXNlQnJlYWtkb3duKSA6IHt9O1xuICAgICAgICAgIH0gY2F0Y2gge1xuICAgICAgICAgICAgd2ggPSB7fTtcbiAgICAgICAgICB9XG4gICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGJvID0gZGF0YS5iYWNrb3JkZXJCeVNrdSA/IEpTT04ucGFyc2UoZGF0YS5iYWNrb3JkZXJCeVNrdSkgOiB7fTtcbiAgICAgICAgICB9IGNhdGNoIHtcbiAgICAgICAgICAgIGJvID0ge307XG4gICAgICAgICAgfVxuICAgICAgICAgIF9yZWNvU3RvY2tTbmFwc2hvdCA9IHsgd2FyZWhvdXNlQnJlYWtkb3duOiB3aCwgYmFja29yZGVyQnlTa3U6IGJvIH07XG4gICAgICAgIH0pXG4gICAgKTtcbiAgfVxuICBpZiAoIV9yZWNvVmVudGFzU25hcHNob3QpIHtcbiAgICBwcm9taXNlcy5wdXNoKFxuICAgICAgd2luZG93LmZiRGJcbiAgICAgICAgLmNvbGxlY3Rpb24oJ3NrdV92ZW50YXNfc25hcHNob3QnKVxuICAgICAgICAuZ2V0KClcbiAgICAgICAgLnRoZW4oKHNuYXApID0+IHtcbiAgICAgICAgICBjb25zdCBtYXAgPSB7fTtcbiAgICAgICAgICBzbmFwLmZvckVhY2goKGRvYykgPT4ge1xuICAgICAgICAgICAgY29uc3QgZCA9IGRvYy5kYXRhKCk7XG4gICAgICAgICAgICBpZiAoIWQgfHwgIWQuc2t1KSByZXR1cm47XG4gICAgICAgICAgICBtYXBbU3RyaW5nKGQuc2t1KS50cmltKCkudG9VcHBlckNhc2UoKV0gPSB7IG1lc2VzOiBkLm1lc2VzIHx8IHt9IH07XG4gICAgICAgICAgfSk7XG4gICAgICAgICAgX3JlY29WZW50YXNTbmFwc2hvdCA9IG1hcDtcbiAgICAgICAgfSlcbiAgICApO1xuICB9XG4gIGF3YWl0IFByb21pc2UuYWxsKHByb21pc2VzKTtcbn1cblxuZnVuY3Rpb24gX2NvbXB1dGVWZW50YU1lbnN1YWxQcm9tZWRpbyhza3VVcHBlcikge1xuICAvLyBQcm9tZWRpbyBkZSBsb3MgXHUwMEZBbHRpbW9zIFJFQ09fVkVOVEFfUFJPTUVESU9fV0lORE9XIG1lc2VzIGNlcnJhZG9zXG4gIC8vIChleGNsdXllIGVsIG1lcyBhY3R1YWwgcGFyY2lhbCkuXG4gIGNvbnN0IHJlYyA9IF9yZWNvVmVudGFzU25hcHNob3QgJiYgX3JlY29WZW50YXNTbmFwc2hvdFtza3VVcHBlcl07XG4gIGlmICghcmVjIHx8ICFyZWMubWVzZXMpIHJldHVybiAwO1xuICBjb25zdCBob3kgPSBuZXcgRGF0ZSgpO1xuICBjb25zdCBtb250aHNCYWNrID0gW107XG4gIGZvciAobGV0IGkgPSAxOyBpIDw9IFJFQ09fVkVOVEFfUFJPTUVESU9fV0lORE9XOyBpKyspIHtcbiAgICBjb25zdCBkID0gbmV3IERhdGUoaG95LmdldEZ1bGxZZWFyKCksIGhveS5nZXRNb250aCgpIC0gaSwgMSk7XG4gICAgbW9udGhzQmFjay5wdXNoKFN0cmluZyhkLmdldEZ1bGxZZWFyKCkpICsgJy0nICsgU3RyaW5nKGQuZ2V0TW9udGgoKSArIDEpLnBhZFN0YXJ0KDIsICcwJykpO1xuICB9XG4gIGxldCBzdW0gPSAwO1xuICBsZXQgbiA9IDA7XG4gIG1vbnRoc0JhY2suZm9yRWFjaCgoaykgPT4ge1xuICAgIGNvbnN0IG0gPSByZWMubWVzZXNba107XG4gICAgaWYgKG0gJiYgTnVtYmVyLmlzRmluaXRlKE51bWJlcihtLnF0eSkpKSB7XG4gICAgICBzdW0gKz0gTnVtYmVyKG0ucXR5KTtcbiAgICAgIG4rKztcbiAgICB9XG4gIH0pO1xuICByZXR1cm4gbiA+IDAgPyBzdW0gLyBuIDogMDtcbn1cblxuZnVuY3Rpb24gX2NvbXB1dGVTYWxlc1BsYW5GdXR1cm8ocm93KSB7XG4gIC8vIFN1bWEgbG9zIG1lc2VzIGRlIHJvdy5tb250aHMgZGVzZGUgZWwgbWVzIGFjdHVhbCAoaW5jbHVzaXZlKSBoYXN0YSBlbFxuICAvLyBcdTAwRkFsdGltbyBtZXMgZGVsIHNhbGVzIHBsYW4uIExvcyBtZXNlcyBzb24gJ1lZWVktTU0nLlxuICBpZiAoIXJvdyB8fCAhcm93Lm1vbnRocykgcmV0dXJuIDA7XG4gIGNvbnN0IGhveSA9IG5ldyBEYXRlKCk7XG4gIGNvbnN0IGN1cnJlbnRLZXkgPSBTdHJpbmcoaG95LmdldEZ1bGxZZWFyKCkpICsgJy0nICsgU3RyaW5nKGhveS5nZXRNb250aCgpICsgMSkucGFkU3RhcnQoMiwgJzAnKTtcbiAgbGV0IHN1bSA9IDA7XG4gIE9iamVjdC5rZXlzKHJvdy5tb250aHMpLmZvckVhY2goKGspID0+IHtcbiAgICBpZiAoayA+PSBjdXJyZW50S2V5KSBzdW0gKz0gTnVtYmVyKHJvdy5tb250aHNba10gfHwgMCk7XG4gIH0pO1xuICByZXR1cm4gc3VtO1xufVxuXG5mdW5jdGlvbiBfY29tcHV0ZVJlY29tbWVuZGF0aW9ucygpIHtcbiAgLy8gQ29tYmluYSBSb2RzICsgUmVlbHMgc2FsZXMgcGxhbnMgKyBzdG9jayArIGJhY2tvcmRlciArIHZlbnRhcyBwcm9tZWRpby5cbiAgLy8gUmV0b3JuYSBhcnJheSBkZSByb3dzIGNvbiB0b2RvcyBsb3MgY2FtcG9zICsgcmVjb21lbmRhZG8uXG4gIGNvbnN0IHJvd3MgPSBbXTtcbiAgY29uc3QgZmFtaWxpYXMgPSBbJ3JvZHMnLCAncmVlbHMnXTtcbiAgZm9yIChjb25zdCBmYW0gb2YgZmFtaWxpYXMpIHtcbiAgICBjb25zdCBjYWNoZSA9IF9zYWxlc1BsYW5DYWNoZXNbZmFtXTtcbiAgICBpZiAoIWNhY2hlIHx8ICFjYWNoZS5yb3dzKSBjb250aW51ZTtcbiAgICBmb3IgKGNvbnN0IHNwUm93IG9mIGNhY2hlLnJvd3MpIHtcbiAgICAgIGNvbnN0IHNrdSA9IFN0cmluZyhzcFJvdy5za3UgfHwgJycpLnRyaW0oKTtcbiAgICAgIGNvbnN0IHNrdVVwcGVyID0gc2t1LnRvVXBwZXJDYXNlKCk7XG4gICAgICAvLyB2MTExMjogc2tpcGVhbW9zIFNLVXMgZGVzY29udGludWFkb3MgKE1hcmlhbm8gbG9zIG1hcmNhIGRlc2RlIGxhIFVJKS5cbiAgICAgIGlmIChfZGlzY29udGludWVkU2t1cyAmJiBfZGlzY29udGludWVkU2t1cy5oYXMoc2t1VXBwZXIpKSBjb250aW51ZTtcbiAgICAgIGNvbnN0IHN0b2NrV2ggPVxuICAgICAgICAoX3JlY29TdG9ja1NuYXBzaG90ICYmXG4gICAgICAgICAgX3JlY29TdG9ja1NuYXBzaG90LndhcmVob3VzZUJyZWFrZG93biAmJlxuICAgICAgICAgIF9yZWNvU3RvY2tTbmFwc2hvdC53YXJlaG91c2VCcmVha2Rvd25bc2t1XSkgfHxcbiAgICAgICAge307XG4gICAgICBjb25zdCBzdG9ja0xpYnJlID0gTnVtYmVyKHN0b2NrV2hbJzExJ10gfHwgMCk7XG4gICAgICBjb25zdCBlblRyYW5zaXRvID0gTnVtYmVyKHN0b2NrV2hbJzEyJ10gfHwgMCk7XG4gICAgICBjb25zdCBiYWNrb3JkZXIgPSBOdW1iZXIoXG4gICAgICAgIChfcmVjb1N0b2NrU25hcHNob3QgJiZcbiAgICAgICAgICBfcmVjb1N0b2NrU25hcHNob3QuYmFja29yZGVyQnlTa3UgJiZcbiAgICAgICAgICBfcmVjb1N0b2NrU25hcHNob3QuYmFja29yZGVyQnlTa3Vbc2t1XSkgfHxcbiAgICAgICAgICAwXG4gICAgICApO1xuICAgICAgY29uc3QgdmVudGFNZW5zdWFsID0gX2NvbXB1dGVWZW50YU1lbnN1YWxQcm9tZWRpbyhza3VVcHBlcik7XG4gICAgICBjb25zdCBzYWxlc1BsYW5GdXQgPSBfY29tcHV0ZVNhbGVzUGxhbkZ1dHVybyhzcFJvdyk7XG4gICAgICBjb25zdCBtb3EgPSBOdW1iZXIoc3BSb3cubW9xIHx8IDApO1xuICAgICAgLy8gdjExMTQgRjNCOiBtdWx0aXBsaWNhZG9yIGF1dG8gKHJlY2VudC9iYXNlbGluZSkgbyBvdmVycmlkZSBtYW51YWwuXG4gICAgICBjb25zdCBtdWx0SW5mbyA9IF9nZXRFZmZlY3RpdmVNdWx0aXBsaWVyKHNrdVVwcGVyKTtcbiAgICAgIGNvbnN0IG11bHRpcGxpZXIgPSBtdWx0SW5mby52YWx1ZTtcbiAgICAgIGNvbnN0IGRlbWFuZGFFc3BlcmFkYSA9IHZlbnRhTWVuc3VhbCAqIG11bHRpcGxpZXIgKiBSRUNPX0hPUklaT05fTU9OVEhTO1xuICAgICAgY29uc3QgYmFsYW5jZSA9IHN0b2NrTGlicmUgKyBlblRyYW5zaXRvICsgc2FsZXNQbGFuRnV0IC0gYmFja29yZGVyIC0gZGVtYW5kYUVzcGVyYWRhO1xuICAgICAgbGV0IHJlY29tZW5kYWRvID0gMDtcbiAgICAgIGlmIChiYWxhbmNlIDwgMCkge1xuICAgICAgICBjb25zdCBkZWZpY2l0ID0gLWJhbGFuY2U7XG4gICAgICAgIHJlY29tZW5kYWRvID0gbW9xID4gMCA/IE1hdGgubWF4KG1vcSwgTWF0aC5jZWlsKGRlZmljaXQgLyBtb3EpICogbW9xKSA6IE1hdGguY2VpbChkZWZpY2l0KTtcbiAgICAgIH1cbiAgICAgIHJvd3MucHVzaCh7XG4gICAgICAgIGZhbWlsaWE6IGZhbSxcbiAgICAgICAgc2t1LFxuICAgICAgICBkZXNjcmlwdGlvbjogc3BSb3cuZGVzY3JpcHRpb24gfHwgJycsXG4gICAgICAgIG1vcSxcbiAgICAgICAgc3RvY2tMaWJyZSxcbiAgICAgICAgZW5UcmFuc2l0byxcbiAgICAgICAgYmFja29yZGVyLFxuICAgICAgICB2ZW50YU1lbnN1YWw6IE1hdGgucm91bmQodmVudGFNZW5zdWFsICogMTApIC8gMTAsXG4gICAgICAgIHNhbGVzUGxhbkZ1dCxcbiAgICAgICAgbXVsdGlwbGllcixcbiAgICAgICAgbXVsdFNvdXJjZTogbXVsdEluZm8uc291cmNlLCAvLyAnYXV0bycgfCAnbWFudWFsJyB8ICdkZWZhdWx0JyB8ICdmYWxsYmFjaydcbiAgICAgICAgbXVsdEF1dG86IG11bHRJbmZvLmF1dG8gPyBtdWx0SW5mby5hdXRvLnZhbHVlIDogbnVsbCwgLy8gZWwgdmFsb3IgYXV0byBzaSBoYXkgb3ZlcnJpZGUgbWFudWFsXG4gICAgICAgIGRlbWFuZGFFc3BlcmFkYTogTWF0aC5yb3VuZChkZW1hbmRhRXNwZXJhZGEgKiAxMCkgLyAxMCxcbiAgICAgICAgYmFsYW5jZTogTWF0aC5yb3VuZChiYWxhbmNlICogMTApIC8gMTAsXG4gICAgICAgIHJlY29tZW5kYWRvLFxuICAgICAgfSk7XG4gICAgfVxuICB9XG4gIC8vIE9yZGVuYXIgcG9yIHJlY29tZW5kYWRvIGRlc2NlbmRlbnRlXG4gIHJvd3Muc29ydCgoYSwgYikgPT4gYi5yZWNvbWVuZGFkbyAtIGEucmVjb21lbmRhZG8pO1xuICByZXR1cm4gcm93cztcbn1cblxuZnVuY3Rpb24gX2ZtdE51bVNpZ25lZChuKSB7XG4gIGlmIChuID09IG51bGwgfHwgIU51bWJlci5pc0Zpbml0ZShOdW1iZXIobikpKSByZXR1cm4gJ1x1MjAxNCc7XG4gIGNvbnN0IHYgPSBOdW1iZXIobik7XG4gIGNvbnN0IGFicyA9IE1hdGguYWJzKHYpLnRvTG9jYWxlU3RyaW5nKCdlcy1BUicsIHsgbWF4aW11bUZyYWN0aW9uRGlnaXRzOiAwIH0pO1xuICByZXR1cm4gKHYgPCAwID8gJ1x1MjIxMicgOiAnJykgKyBhYnM7XG59XG5cbmZ1bmN0aW9uIF9mbXRJbnQobikge1xuICBpZiAobiA9PSBudWxsIHx8ICFOdW1iZXIuaXNGaW5pdGUoTnVtYmVyKG4pKSkgcmV0dXJuICdcdTIwMTQnO1xuICByZXR1cm4gTWF0aC5yb3VuZChOdW1iZXIobikpLnRvTG9jYWxlU3RyaW5nKCdlcy1BUicpO1xufVxuXG4vLyB2MTExNCBGM0I6IGNlbGRhIG11bHRpcGxpY2Fkb3IgY29uIGNoaXAgYXV0by9tYW51YWwgKyBpbnB1dCBlZGl0YWJsZS5cbmZ1bmN0aW9uIF9idWlsZE11bHRDZWxsSHRtbChyKSB7XG4gIGNvbnN0IHNrdVVwcGVyID0gU3RyaW5nKHIuc2t1KS50cmltKCkudG9VcHBlckNhc2UoKTtcbiAgY29uc3QgaXNNYW51YWwgPSByLm11bHRTb3VyY2UgPT09ICdtYW51YWwnO1xuICBjb25zdCBpc0RlZmF1bHQgPSByLm11bHRTb3VyY2UgPT09ICdkZWZhdWx0JztcbiAgY29uc3QgdmFsID0gTnVtYmVyKHIubXVsdGlwbGllciB8fCAxLjApLnRvRml4ZWQoMik7XG4gIC8vIENvbG9yIHBvciBkaXJlY2NpXHUwMEYzbjogPjEuMDUgdmVyZGUgKGNyZWNpZW5kbyksIDwwLjk1IHJvam8gKGNheWVuZG8pLCBtZWRpbyBncmlzLlxuICBsZXQgZGlyQ29sb3IgPSAndmFyKC0tdGV4dC1tdXRlZCknO1xuICBpZiAoci5tdWx0aXBsaWVyID4gMS4wNSkgZGlyQ29sb3IgPSAnIzE2YTM0YSc7XG4gIGVsc2UgaWYgKHIubXVsdGlwbGllciA8IDAuOTUpIGRpckNvbG9yID0gJyNkYzI2MjYnO1xuXG4gIGNvbnN0IGNoaXAgPSBpc01hbnVhbFxuICAgID8gJzxzcGFuIHN0eWxlPVwiZGlzcGxheTppbmxpbmUtYmxvY2s7cGFkZGluZzoxcHggNXB4O2JhY2tncm91bmQ6I2Y1OWUwYjtjb2xvcjojZmZmO2JvcmRlci1yYWRpdXM6OHB4O2ZvbnQtc2l6ZTo5cHg7Zm9udC13ZWlnaHQ6NzAwO21hcmdpbi1sZWZ0OjRweFwiIHRpdGxlPVwiT3ZlcnJpZGUgbWFudWFsOiBwaXNhIGVsIGF1dG9cIj5NPC9zcGFuPidcbiAgICA6IGlzRGVmYXVsdFxuICAgICAgPyAnPHNwYW4gc3R5bGU9XCJkaXNwbGF5OmlubGluZS1ibG9jaztwYWRkaW5nOjFweCA1cHg7YmFja2dyb3VuZDojOTRhM2I4O2NvbG9yOiNmZmY7Ym9yZGVyLXJhZGl1czo4cHg7Zm9udC1zaXplOjlweDtmb250LXdlaWdodDo3MDA7bWFyZ2luLWxlZnQ6NHB4XCIgdGl0bGU9XCJTaW4gZGF0b3Mgc3VmaWNpZW50ZXM6IHVzYSAxLjBcIj5cdTAwQjc8L3NwYW4+J1xuICAgICAgOiAnPHNwYW4gc3R5bGU9XCJkaXNwbGF5OmlubGluZS1ibG9jaztwYWRkaW5nOjFweCA1cHg7YmFja2dyb3VuZDojMGQ5NDg4O2NvbG9yOiNmZmY7Ym9yZGVyLXJhZGl1czo4cHg7Zm9udC1zaXplOjlweDtmb250LXdlaWdodDo3MDA7bWFyZ2luLWxlZnQ6NHB4XCIgdGl0bGU9XCJBdXRvID0gdmVudGEgMm0gLyB2ZW50YSA2bVwiPkE8L3NwYW4+JztcblxuICBjb25zdCByZXNldEJ0biA9IGlzTWFudWFsXG4gICAgPyAnPGJ1dHRvbiBvbmNsaWNrPVwicmVzZXRNdWx0aXBsaWVyKFxcJycgK1xuICAgICAgZXNjYXBlSHRtbFNhZmUoc2t1VXBwZXIpICtcbiAgICAgICdcXCcpXCIgdGl0bGU9XCJWb2x2ZXIgYWwgYXV0b1wiIHN0eWxlPVwibWFyZ2luLWxlZnQ6NHB4O2JhY2tncm91bmQ6dHJhbnNwYXJlbnQ7Ym9yZGVyOm5vbmU7Y3Vyc29yOnBvaW50ZXI7Zm9udC1zaXplOjEycHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7cGFkZGluZzowXCI+XHUyMUJCPC9idXR0b24+J1xuICAgIDogJyc7XG5cbiAgY29uc3QgYXV0b0hpbnQgPVxuICAgIGlzTWFudWFsICYmIHIubXVsdEF1dG8gIT0gbnVsbFxuICAgICAgPyAnIDxzcGFuIHN0eWxlPVwiZm9udC1zaXplOjEwcHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZClcIiB0aXRsZT1cIlZhbG9yIGF1dG8gY2FsY3VsYWRvXCI+KGF1dG8gJyArXG4gICAgICAgIE51bWJlcihyLm11bHRBdXRvKS50b0ZpeGVkKDIpICtcbiAgICAgICAgJyk8L3NwYW4+J1xuICAgICAgOiAnJztcblxuICByZXR1cm4gKFxuICAgICc8c3BhbiBzdHlsZT1cImRpc3BsYXk6aW5saW5lLWZsZXg7YWxpZ24taXRlbXM6Y2VudGVyO2dhcDoycHhcIj4nICtcbiAgICAnPHNwYW4gb25jbGljaz1cImVkaXRNdWx0aXBsaWVyKHRoaXMsIFxcJycgK1xuICAgIGVzY2FwZUh0bWxTYWZlKHNrdVVwcGVyKSArXG4gICAgJ1xcJylcIiBzdHlsZT1cImN1cnNvcjpwb2ludGVyO3BhZGRpbmc6MnB4IDZweDtib3JkZXItcmFkaXVzOjRweDtiYWNrZ3JvdW5kOnZhcigtLWJnLXNlY29uZGFyeSk7Zm9udC12YXJpYW50LW51bWVyaWM6dGFidWxhci1udW1zO2ZvbnQtd2VpZ2h0OjcwMDtjb2xvcjonICtcbiAgICBkaXJDb2xvciArXG4gICAgJ1wiIHRpdGxlPVwiQ2xpY2sgcGFyYSBlZGl0YXJcIj4nICtcbiAgICB2YWwgK1xuICAgICc8L3NwYW4+JyArXG4gICAgY2hpcCArXG4gICAgcmVzZXRCdG4gK1xuICAgIGF1dG9IaW50ICtcbiAgICAnPC9zcGFuPidcbiAgKTtcbn1cblxud2luZG93LmVkaXRNdWx0aXBsaWVyID0gZnVuY3Rpb24gKGVsLCBza3VVcHBlcikge1xuICBjb25zdCBjdXJyZW50VmFsID0gcGFyc2VGbG9hdChlbC50ZXh0Q29udGVudCkgfHwgMS4wO1xuICBjb25zdCBpbnB1dCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2lucHV0Jyk7XG4gIGlucHV0LnR5cGUgPSAnbnVtYmVyJztcbiAgaW5wdXQuc3RlcCA9ICcwLjA1JztcbiAgaW5wdXQubWluID0gJzAuMSc7XG4gIGlucHV0Lm1heCA9ICc1JztcbiAgaW5wdXQudmFsdWUgPSBTdHJpbmcoY3VycmVudFZhbCk7XG4gIGlucHV0LnN0eWxlLmNzc1RleHQgPVxuICAgICd3aWR0aDo2MHB4O3BhZGRpbmc6MnB4IDRweDtmb250LXNpemU6MTJweDtmb250LXdlaWdodDo3MDA7dGV4dC1hbGlnbjpjZW50ZXI7Ym9yZGVyOjJweCBzb2xpZCAjMGQ5NDg4O2JvcmRlci1yYWRpdXM6NHB4O2JhY2tncm91bmQ6dmFyKC0tYmctZWxldmF0ZWQpO2NvbG9yOnZhcigtLXRleHQtcHJpbWFyeSk7Zm9udC12YXJpYW50LW51bWVyaWM6dGFidWxhci1udW1zJztcbiAgY29uc3QgcGFyZW50ID0gZWwucGFyZW50Tm9kZTtcbiAgcGFyZW50LnJlcGxhY2VDaGlsZChpbnB1dCwgZWwpO1xuICBpbnB1dC5mb2N1cygpO1xuICBpbnB1dC5zZWxlY3QoKTtcblxuICBjb25zdCBjb21taXQgPSBhc3luYyAoKSA9PiB7XG4gICAgY29uc3QgdiA9IHBhcnNlRmxvYXQoaW5wdXQudmFsdWUpO1xuICAgIGlmIChpc05hTih2KSB8fCB2IDwgMC4xIHx8IHYgPiA1KSB7XG4gICAgICBfcmVuZGVyUmVjb1NlY3Rpb24oKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgaWYgKE1hdGguYWJzKHYgLSBjdXJyZW50VmFsKSA8IDAuMDAxKSB7XG4gICAgICBfcmVuZGVyUmVjb1NlY3Rpb24oKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IF9zYXZlTXVsdGlwbGllck92ZXJyaWRlKHNrdVVwcGVyLCB2KTtcbiAgICAgIF9yZW5kZXJSZWNvU2VjdGlvbigpO1xuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgIGFsZXJ0KCdFcnJvciBndWFyZGFuZG86ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcbiAgICAgIF9yZW5kZXJSZWNvU2VjdGlvbigpO1xuICAgIH1cbiAgfTtcblxuICBjb25zdCBjYW5jZWwgPSAoKSA9PiBfcmVuZGVyUmVjb1NlY3Rpb24oKTtcblxuICBpbnB1dC5hZGRFdmVudExpc3RlbmVyKCdibHVyJywgY29tbWl0KTtcbiAgaW5wdXQuYWRkRXZlbnRMaXN0ZW5lcigna2V5ZG93bicsIChldikgPT4ge1xuICAgIGlmIChldi5rZXkgPT09ICdFbnRlcicpIHtcbiAgICAgIGV2LnByZXZlbnREZWZhdWx0KCk7XG4gICAgICBpbnB1dC5ibHVyKCk7XG4gICAgfSBlbHNlIGlmIChldi5rZXkgPT09ICdFc2NhcGUnKSB7XG4gICAgICBldi5wcmV2ZW50RGVmYXVsdCgpO1xuICAgICAgY2FuY2VsKCk7XG4gICAgfVxuICB9KTtcbn07XG5cbndpbmRvdy5yZXNldE11bHRpcGxpZXIgPSBhc3luYyBmdW5jdGlvbiAoc2t1VXBwZXIpIHtcbiAgaWYgKCFjb25maXJtKCdWb2x2ZXIgZWwgbXVsdGlwbGljYWRvciBkZSAnICsgc2t1VXBwZXIgKyAnIGFsIGNcdTAwRTFsY3VsbyBhdXRvbVx1MDBFMXRpY28/JykpIHJldHVybjtcbiAgdHJ5IHtcbiAgICBhd2FpdCBfcmVtb3ZlTXVsdGlwbGllck92ZXJyaWRlKHNrdVVwcGVyKTtcbiAgICBfcmVuZGVyUmVjb1NlY3Rpb24oKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGFsZXJ0KCdFcnJvcjogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xuICB9XG59O1xuXG5mdW5jdGlvbiBfcmVuZGVyUmVjb1NlY3Rpb24oKSB7XG4gIGNvbnN0IGNvbnQgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgncmVjby1zZWN0aW9uLWNvbnRhaW5lcicpO1xuICBpZiAoIWNvbnQpIHJldHVybjtcbiAgdHJ5IHtcbiAgICBfcmVuZGVyUmVjb1NlY3Rpb25JbXBsKGNvbnQpO1xuICB9IGNhdGNoIChlKSB7XG4gICAgY29uc29sZS5lcnJvcignW0ZPUkVDQVNUIHJlY29dIHJlbmRlciBmYWlsJywgZSk7XG4gICAgY29udC5pbm5lckhUTUwgPVxuICAgICAgJzxkaXYgc3R5bGU9XCJwYWRkaW5nOjIwcHg7Y29sb3I6I2RjMjYyNlwiPicgK1xuICAgICAgJzxkaXYgc3R5bGU9XCJmb250LXdlaWdodDo3MDA7bWFyZ2luLWJvdHRvbTo4cHhcIj5FcnJvciByZW5kZXJpemFuZG8gdGFibGEgcmVjb21lbmRhY2lcdTAwRjNuPC9kaXY+JyArXG4gICAgICAnPHByZSBzdHlsZT1cImZvbnQtc2l6ZToxMXB4O2JhY2tncm91bmQ6I2ZlZjJmMjtwYWRkaW5nOjEwcHg7Ym9yZGVyLXJhZGl1czo2cHg7b3ZlcmZsb3c6YXV0bzt3aGl0ZS1zcGFjZTpwcmUtd3JhcFwiPicgK1xuICAgICAgZXNjYXBlSHRtbFNhZmUoZS5zdGFjayB8fCBlLm1lc3NhZ2UgfHwgU3RyaW5nKGUpKSArXG4gICAgICAnPC9wcmU+PC9kaXY+JztcbiAgfVxufVxuXG5mdW5jdGlvbiBfcmVuZGVyUmVjb1NlY3Rpb25JbXBsKGNvbnQpIHtcbiAgY29uc3QgYW55TG9hZGVkID0gISEoX3NhbGVzUGxhbkNhY2hlcy5yb2RzIHx8IF9zYWxlc1BsYW5DYWNoZXMucmVlbHMpO1xuICBpZiAoIWFueUxvYWRlZCkge1xuICAgIGNvbnQuaW5uZXJIVE1MID0gJyc7XG4gICAgcmV0dXJuO1xuICB9XG4gIGlmICghX3JlY29TdG9ja1NuYXBzaG90IHx8ICFfcmVjb1ZlbnRhc1NuYXBzaG90KSB7XG4gICAgY29udC5pbm5lckhUTUwgPVxuICAgICAgJzxkaXYgc3R5bGU9XCJwYWRkaW5nOjQwcHggMThweDt0ZXh0LWFsaWduOmNlbnRlcjtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKVwiPicgK1xuICAgICAgJzxkaXYgc3R5bGU9XCJkaXNwbGF5OmlubGluZS1ibG9jazt3aWR0aDoyNHB4O2hlaWdodDoyNHB4O2JvcmRlcjozcHggc29saWQgIzBkOTQ4ODtib3JkZXItdG9wLWNvbG9yOnRyYW5zcGFyZW50O2JvcmRlci1yYWRpdXM6NTAlO2FuaW1hdGlvbjpzcGluIDAuOHMgbGluZWFyIGluZmluaXRlO21hcmdpbi1ib3R0b206MTBweFwiPjwvZGl2PicgK1xuICAgICAgJzxkaXY+Q2FyZ2FuZG8gc3RvY2sgKyB2ZW50YXMgaGlzdFx1MDBGM3JpY2FzLi4uPC9kaXY+JyArXG4gICAgICAnPHN0eWxlPkBrZXlmcmFtZXMgc3Bpbnt0b3t0cmFuc2Zvcm06cm90YXRlKDM2MGRlZyl9fTwvc3R5bGU+PC9kaXY+JztcbiAgICBfbG9hZFJlY29EYXRhKClcbiAgICAgIC50aGVuKF9yZW5kZXJSZWNvU2VjdGlvbilcbiAgICAgIC5jYXRjaCgoZSkgPT4ge1xuICAgICAgICBjb25zb2xlLmVycm9yKCdbRk9SRUNBU1QgcmVjb10gbG9hZCBmYWlsJywgZSk7XG4gICAgICAgIGNvbnQuaW5uZXJIVE1MID1cbiAgICAgICAgICAnPGRpdiBzdHlsZT1cInBhZGRpbmc6MjBweDtjb2xvcjojZGMyNjI2XCI+RXJyb3IgY2FyZ2FuZG8gZGF0b3M6ICcgK1xuICAgICAgICAgIGVzY2FwZUh0bWxTYWZlKGUubWVzc2FnZSB8fCBTdHJpbmcoZSkpICtcbiAgICAgICAgICAnPC9kaXY+JztcbiAgICAgIH0pO1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCBhbGxSb3dzID0gX2NvbXB1dGVSZWNvbW1lbmRhdGlvbnMoKTtcbiAgY29uc3Qgc2VhcmNoTGMgPSBfcmVjb1NlYXJjaFRleHQudHJpbSgpLnRvTG93ZXJDYXNlKCk7XG4gIGNvbnN0IHJvd3MgPSBhbGxSb3dzLmZpbHRlcigocikgPT4ge1xuICAgIGlmIChfcmVjb0ZpbHRlckZhbWlsaWEgIT09ICdhbGwnICYmIHIuZmFtaWxpYSAhPT0gX3JlY29GaWx0ZXJGYW1pbGlhKSByZXR1cm4gZmFsc2U7XG4gICAgaWYgKF9yZWNvRmlsdGVyTWluUmVjICYmIHIucmVjb21lbmRhZG8gPD0gMCkgcmV0dXJuIGZhbHNlO1xuICAgIGlmIChzZWFyY2hMYykge1xuICAgICAgY29uc3QgaGF5ID1cbiAgICAgICAgci5za3UudG9Mb3dlckNhc2UoKS5pbmNsdWRlcyhzZWFyY2hMYykgfHwgci5kZXNjcmlwdGlvbi50b0xvd2VyQ2FzZSgpLmluY2x1ZGVzKHNlYXJjaExjKTtcbiAgICAgIGlmICghaGF5KSByZXR1cm4gZmFsc2U7XG4gICAgfVxuICAgIHJldHVybiB0cnVlO1xuICB9KTtcbiAgY29uc3QgdG90YWxSZWNvID0gYWxsUm93cy5yZWR1Y2UoKHMsIHIpID0+IHMgKyByLnJlY29tZW5kYWRvLCAwKTtcbiAgY29uc3QgdG90YWxDb25SZWNvID0gYWxsUm93cy5maWx0ZXIoKHIpID0+IHIucmVjb21lbmRhZG8gPiAwKS5sZW5ndGg7XG5cbiAgY29uc3QgbkRpc2MgPSBfZGlzY29udGludWVkU2t1cyA/IF9kaXNjb250aW51ZWRTa3VzLnNpemUgOiAwO1xuICBjb25zdCBkaXNjQ2hpcCA9XG4gICAgbkRpc2MgPiAwXG4gICAgICA/ICc8YnV0dG9uIG9uY2xpY2s9XCJvcGVuRGlzY29udGludWVkTW9kYWwoKVwiIHN0eWxlPVwicGFkZGluZzo2cHggMTJweDtiYWNrZ3JvdW5kOiM5MzMzZWE7Y29sb3I6I2ZmZjtib3JkZXI6bm9uZTtib3JkZXItcmFkaXVzOjZweDtmb250LXNpemU6MTJweDtmb250LXdlaWdodDo3MDA7Y3Vyc29yOnBvaW50ZXJcIiB0aXRsZT1cIkdlc3Rpb25hciBTS1VzIGRlc2NvbnRpbnVhZG9zXCI+XHVEODNEXHVERUFCICcgK1xuICAgICAgICBfZm10SW50KG5EaXNjKSArXG4gICAgICAgICcgZGVzY29udGludWFkb3M8L2J1dHRvbj4nXG4gICAgICA6ICcnO1xuXG4gIGNvbnN0IGhlYWRlciA9XG4gICAgJzxkaXYgc3R5bGU9XCJkaXNwbGF5OmZsZXg7ZmxleC13cmFwOndyYXA7Z2FwOjEwcHg7YWxpZ24taXRlbXM6Y2VudGVyO21hcmdpbi1ib3R0b206MTJweFwiPicgK1xuICAgICc8ZGl2IHN0eWxlPVwiZmxleDoxO21pbi13aWR0aDoyODBweFwiPjxkaXYgc3R5bGU9XCJmb250LXNpemU6MThweDtmb250LXdlaWdodDo4MDA7Y29sb3I6dmFyKC0tdGV4dC1wcmltYXJ5KVwiPlJlY29tZW5kYWNpXHUwMEYzbiBkZSBDb21wcmE8L2Rpdj4nICtcbiAgICAnPGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMXB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO21hcmdpbi10b3A6MnB4XCI+QmFsYW5jZSA9IFN0b2NrICsgVHJcdTAwRTFuc2l0byArIFBsYW4gXHUyMjEyIEJhY2tvcmRlciBcdTIyMTIgKFZlbnRhIG1lbnMuIFx1MDBENyAnICtcbiAgICBSRUNPX0hPUklaT05fTU9OVEhTICtcbiAgICAnbSk8L2Rpdj48L2Rpdj4nICtcbiAgICAnPGRpdiBzdHlsZT1cInBhZGRpbmc6NnB4IDEycHg7YmFja2dyb3VuZDojMGQ5NDg4O2NvbG9yOiNmZmY7Ym9yZGVyLXJhZGl1czo2cHg7Zm9udC1zaXplOjEycHg7Zm9udC13ZWlnaHQ6NzAwXCI+JyArXG4gICAgX2ZtdEludCh0b3RhbENvblJlY28pICtcbiAgICAnIFNLVXMgY29uIHJlY288L2Rpdj4nICtcbiAgICAnPGRpdiBzdHlsZT1cInBhZGRpbmc6NnB4IDEycHg7YmFja2dyb3VuZDojMTM0ZTRhO2NvbG9yOiNmZmY7Ym9yZGVyLXJhZGl1czo2cHg7Zm9udC1zaXplOjEycHg7Zm9udC13ZWlnaHQ6NzAwXCI+XHUwM0EzICcgK1xuICAgIF9mbXRJbnQodG90YWxSZWNvKSArXG4gICAgJyB1bmlkYWRlczwvZGl2PicgK1xuICAgIGRpc2NDaGlwICtcbiAgICAnPC9kaXY+JztcblxuICBjb25zdCBmaWx0ZXJzID1cbiAgICAnPGRpdiBzdHlsZT1cImRpc3BsYXk6ZmxleDtmbGV4LXdyYXA6d3JhcDtnYXA6OHB4O21hcmdpbi1ib3R0b206MTBweDtwYWRkaW5nOjEwcHg7YmFja2dyb3VuZDp2YXIoLS1iZy1zZWNvbmRhcnkpO2JvcmRlci1yYWRpdXM6NnB4XCI+JyArXG4gICAgJzxpbnB1dCB0eXBlPVwidGV4dFwiIGlkPVwicmVjby1zZWFyY2hcIiBwbGFjZWhvbGRlcj1cIkJ1c2NhciBTS1UgbyBkZXNjcmlwY2lvbi4uLlwiIHZhbHVlPVwiJyArXG4gICAgZXNjYXBlSHRtbFNhZmUoX3JlY29TZWFyY2hUZXh0KSArXG4gICAgJ1wiIG9uaW5wdXQ9XCJvblJlY29TZWFyY2hDaGFuZ2UoZXZlbnQpXCIgc3R5bGU9XCJmbGV4OjE7bWluLXdpZHRoOjIwMHB4O3BhZGRpbmc6NnB4IDEwcHg7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1ib3JkZXItc3VidGxlKTtib3JkZXItcmFkaXVzOjRweDtmb250LXNpemU6MTJweDtiYWNrZ3JvdW5kOnZhcigtLWJnLWVsZXZhdGVkKTtjb2xvcjp2YXIoLS10ZXh0LXByaW1hcnkpXCIvPicgK1xuICAgICc8c2VsZWN0IG9uY2hhbmdlPVwib25SZWNvRmFtaWxpYUNoYW5nZShldmVudClcIiBzdHlsZT1cInBhZGRpbmc6NnB4IDEwcHg7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1ib3JkZXItc3VidGxlKTtib3JkZXItcmFkaXVzOjRweDtmb250LXNpemU6MTJweDtiYWNrZ3JvdW5kOnZhcigtLWJnLWVsZXZhdGVkKTtjb2xvcjp2YXIoLS10ZXh0LXByaW1hcnkpXCI+JyArXG4gICAgJzxvcHRpb24gdmFsdWU9XCJhbGxcIicgK1xuICAgIChfcmVjb0ZpbHRlckZhbWlsaWEgPT09ICdhbGwnID8gJyBzZWxlY3RlZCcgOiAnJykgK1xuICAgICc+VG9kYXMgbGFzIGZhbWlsaWFzPC9vcHRpb24+JyArXG4gICAgJzxvcHRpb24gdmFsdWU9XCJyb2RzXCInICtcbiAgICAoX3JlY29GaWx0ZXJGYW1pbGlhID09PSAncm9kcycgPyAnIHNlbGVjdGVkJyA6ICcnKSArXG4gICAgJz5Tb2xvIFJvZHMgKENhXHUwMEYxYXMpPC9vcHRpb24+JyArXG4gICAgJzxvcHRpb24gdmFsdWU9XCJyZWVsc1wiJyArXG4gICAgKF9yZWNvRmlsdGVyRmFtaWxpYSA9PT0gJ3JlZWxzJyA/ICcgc2VsZWN0ZWQnIDogJycpICtcbiAgICAnPlNvbG8gUmVlbHM8L29wdGlvbj4nICtcbiAgICAnPC9zZWxlY3Q+JyArXG4gICAgJzxsYWJlbCBzdHlsZT1cImRpc3BsYXk6aW5saW5lLWZsZXg7YWxpZ24taXRlbXM6Y2VudGVyO2dhcDo2cHg7cGFkZGluZzo2cHggMTBweDtmb250LXNpemU6MTJweDtjb2xvcjp2YXIoLS10ZXh0LXByaW1hcnkpO2N1cnNvcjpwb2ludGVyXCI+JyArXG4gICAgJzxpbnB1dCB0eXBlPVwiY2hlY2tib3hcIicgK1xuICAgIChfcmVjb0ZpbHRlck1pblJlYyA/ICcgY2hlY2tlZCcgOiAnJykgK1xuICAgICcgb25jaGFuZ2U9XCJvblJlY29GaWx0ZXJNaW5DaGFuZ2UoZXZlbnQpXCIvPicgK1xuICAgICdTb2xvIGNvbiByZWNvbWVuZGFkbyAmZ3Q7IDA8L2xhYmVsPicgK1xuICAgICc8YnV0dG9uIG9uY2xpY2s9XCJleHBvcnRSZWNvRXhjZWwoKVwiIHN0eWxlPVwicGFkZGluZzo2cHggMTJweDtiYWNrZ3JvdW5kOiMxNmEzNGE7Y29sb3I6I2ZmZjtib3JkZXI6bm9uZTtib3JkZXItcmFkaXVzOjRweDtmb250LXNpemU6MTJweDtmb250LXdlaWdodDo3MDA7Y3Vyc29yOnBvaW50ZXJcIj5cdTJCMDcgRXhjZWw8L2J1dHRvbj4nICtcbiAgICAnPC9kaXY+JztcblxuICBjb25zdCByb3dzSHRtbCA9IHJvd3NcbiAgICAubWFwKChyKSA9PiB7XG4gICAgICBjb25zdCBiYWxDb2xvciA9IHIuYmFsYW5jZSA8IDAgPyAnI2RjMjYyNicgOiByLmJhbGFuY2UgPCA1MCA/ICcjZjU5ZTBiJyA6ICcjMTZhMzRhJztcbiAgICAgIGNvbnN0IHJlY0NvbG9yID0gci5yZWNvbWVuZGFkbyA+IDAgPyAnI2RjMjYyNicgOiAnIzk0YTNiOCc7XG4gICAgICByZXR1cm4gKFxuICAgICAgICAnPHRyIHN0eWxlPVwiYm9yZGVyLWJvdHRvbToxcHggc29saWQgdmFyKC0tYm9yZGVyLXN1YnRsZSlcIj4nICtcbiAgICAgICAgJzx0ZCBzdHlsZT1cInBhZGRpbmc6NnB4IDhweDt0ZXh0LWFsaWduOmNlbnRlclwiPjxzcGFuIHN0eWxlPVwiZGlzcGxheTppbmxpbmUtYmxvY2s7cGFkZGluZzoycHggNnB4O2JvcmRlci1yYWRpdXM6MTBweDtiYWNrZ3JvdW5kOicgK1xuICAgICAgICAoci5mYW1pbGlhID09PSAncm9kcycgPyAnIzBlYTVlOScgOiAnIzhiNWNmNicpICtcbiAgICAgICAgJztjb2xvcjojZmZmO2ZvbnQtc2l6ZToxMHB4O2ZvbnQtd2VpZ2h0OjcwMFwiPicgK1xuICAgICAgICAoci5mYW1pbGlhID09PSAncm9kcycgPyAnUk9EJyA6ICdSRUVMJykgK1xuICAgICAgICAnPC9zcGFuPjwvdGQ+JyArXG4gICAgICAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjZweCA4cHg7dGV4dC1hbGlnbjpjZW50ZXI7Zm9udC1mYW1pbHk6bW9ub3NwYWNlO2ZvbnQtc2l6ZToxMXB4O2NvbG9yOnZhcigtLXRleHQtcHJpbWFyeSk7Zm9udC13ZWlnaHQ6NzAwXCI+JyArXG4gICAgICAgIGVzY2FwZUh0bWxTYWZlKHIuc2t1KSArXG4gICAgICAgICc8L3RkPicgK1xuICAgICAgICAnPHRkIHN0eWxlPVwicGFkZGluZzo2cHggOHB4O2ZvbnQtc2l6ZToxMXB4O2NvbG9yOnZhcigtLXRleHQtc2Vjb25kYXJ5KTttYXgtd2lkdGg6MjQwcHg7b3ZlcmZsb3c6aGlkZGVuO3RleHQtb3ZlcmZsb3c6ZWxsaXBzaXM7d2hpdGUtc3BhY2U6bm93cmFwXCIgdGl0bGU9XCInICtcbiAgICAgICAgZXNjYXBlSHRtbFNhZmUoci5kZXNjcmlwdGlvbikgK1xuICAgICAgICAnXCI+JyArXG4gICAgICAgIGVzY2FwZUh0bWxTYWZlKHIuZGVzY3JpcHRpb24pICtcbiAgICAgICAgJzwvdGQ+JyArXG4gICAgICAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjZweCA4cHg7dGV4dC1hbGlnbjpjZW50ZXI7Zm9udC12YXJpYW50LW51bWVyaWM6dGFidWxhci1udW1zO2NvbG9yOnZhcigtLXRleHQtcHJpbWFyeSlcIj4nICtcbiAgICAgICAgX2ZtdEludChyLnN0b2NrTGlicmUpICtcbiAgICAgICAgJzwvdGQ+JyArXG4gICAgICAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjZweCA4cHg7dGV4dC1hbGlnbjpjZW50ZXI7Zm9udC12YXJpYW50LW51bWVyaWM6dGFidWxhci1udW1zO2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpXCI+JyArXG4gICAgICAgIF9mbXRJbnQoci5lblRyYW5zaXRvKSArXG4gICAgICAgICc8L3RkPicgK1xuICAgICAgICAnPHRkIHN0eWxlPVwicGFkZGluZzo2cHggOHB4O3RleHQtYWxpZ246Y2VudGVyO2ZvbnQtdmFyaWFudC1udW1lcmljOnRhYnVsYXItbnVtcztjb2xvcjojZGMyNjI2XCI+JyArXG4gICAgICAgIF9mbXRJbnQoci5iYWNrb3JkZXIpICtcbiAgICAgICAgJzwvdGQ+JyArXG4gICAgICAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjZweCA4cHg7dGV4dC1hbGlnbjpjZW50ZXI7Zm9udC12YXJpYW50LW51bWVyaWM6dGFidWxhci1udW1zO2NvbG9yOnZhcigtLXRleHQtc2Vjb25kYXJ5KVwiPicgK1xuICAgICAgICBfZm10SW50KHIudmVudGFNZW5zdWFsKSArXG4gICAgICAgICc8L3RkPicgK1xuICAgICAgICAnPHRkIHN0eWxlPVwicGFkZGluZzo2cHggOHB4O3RleHQtYWxpZ246Y2VudGVyXCI+JyArXG4gICAgICAgIF9idWlsZE11bHRDZWxsSHRtbChyKSArXG4gICAgICAgICc8L3RkPicgK1xuICAgICAgICAnPHRkIHN0eWxlPVwicGFkZGluZzo2cHggOHB4O3RleHQtYWxpZ246Y2VudGVyO2ZvbnQtdmFyaWFudC1udW1lcmljOnRhYnVsYXItbnVtcztjb2xvcjp2YXIoLS10ZXh0LXNlY29uZGFyeSlcIj4nICtcbiAgICAgICAgX2ZtdEludChyLmRlbWFuZGFFc3BlcmFkYSkgK1xuICAgICAgICAnPC90ZD4nICtcbiAgICAgICAgJzx0ZCBzdHlsZT1cInBhZGRpbmc6NnB4IDhweDt0ZXh0LWFsaWduOmNlbnRlcjtmb250LXZhcmlhbnQtbnVtZXJpYzp0YWJ1bGFyLW51bXM7Y29sb3I6dmFyKC0tdGV4dC1wcmltYXJ5KTtmb250LXdlaWdodDo2MDBcIj4nICtcbiAgICAgICAgX2ZtdEludChyLnNhbGVzUGxhbkZ1dCkgK1xuICAgICAgICAnPC90ZD4nICtcbiAgICAgICAgJzx0ZCBzdHlsZT1cInBhZGRpbmc6NnB4IDhweDt0ZXh0LWFsaWduOmNlbnRlcjtmb250LXZhcmlhbnQtbnVtZXJpYzp0YWJ1bGFyLW51bXM7Zm9udC13ZWlnaHQ6NzAwO2NvbG9yOicgK1xuICAgICAgICBiYWxDb2xvciArXG4gICAgICAgICdcIj4nICtcbiAgICAgICAgX2ZtdE51bVNpZ25lZChyLmJhbGFuY2UpICtcbiAgICAgICAgJzwvdGQ+JyArXG4gICAgICAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjZweCA4cHg7dGV4dC1hbGlnbjpjZW50ZXI7Zm9udC12YXJpYW50LW51bWVyaWM6dGFidWxhci1udW1zO2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO2ZvbnQtc2l6ZToxMXB4XCI+JyArXG4gICAgICAgIF9mbXRJbnQoci5tb3EpICtcbiAgICAgICAgJzwvdGQ+JyArXG4gICAgICAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjZweCA4cHg7dGV4dC1hbGlnbjpjZW50ZXJcIj48c3BhbiBzdHlsZT1cImRpc3BsYXk6aW5saW5lLWJsb2NrO3BhZGRpbmc6NHB4IDEwcHg7Ym9yZGVyLXJhZGl1czoxMnB4O2JhY2tncm91bmQ6JyArXG4gICAgICAgIHJlY0NvbG9yICtcbiAgICAgICAgJztjb2xvcjojZmZmO2ZvbnQtc2l6ZToxMnB4O2ZvbnQtd2VpZ2h0OjgwMDttaW4td2lkdGg6NTBweFwiPicgK1xuICAgICAgICBfZm10SW50KHIucmVjb21lbmRhZG8pICtcbiAgICAgICAgJzwvc3Bhbj48L3RkPicgK1xuICAgICAgICAnPHRkIHN0eWxlPVwicGFkZGluZzo2cHggOHB4O3RleHQtYWxpZ246Y2VudGVyXCI+JyArXG4gICAgICAgICc8YnV0dG9uIG9uY2xpY2s9XCJkaXNjb250aW51ZVNrdShcXCcnICtcbiAgICAgICAgZXNjYXBlSHRtbFNhZmUoci5za3UpICtcbiAgICAgICAgXCInLCAnXCIgK1xuICAgICAgICBlc2NhcGVIdG1sU2FmZShyLmRlc2NyaXB0aW9uLnJlcGxhY2UoLycvZywgJycpKSArXG4gICAgICAgICdcXCcpXCIgdGl0bGU9XCJEZXNjb250aW51YXIgZXN0ZSBTS1VcIiBzdHlsZT1cImJhY2tncm91bmQ6dHJhbnNwYXJlbnQ7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1ib3JkZXItc3VidGxlKTtib3JkZXItcmFkaXVzOjRweDtwYWRkaW5nOjRweCA4cHg7Y3Vyc29yOnBvaW50ZXI7Zm9udC1zaXplOjE0cHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZClcIj5cdUQ4M0RcdURERDE8L2J1dHRvbj4nICtcbiAgICAgICAgJzwvdGQ+JyArXG4gICAgICAgICc8L3RyPidcbiAgICAgICk7XG4gICAgfSlcbiAgICAuam9pbignJyk7XG5cbiAgLy8gdjExMTI6IG1pbi13aWR0aCBwYXJhIGZvcnphciBzY3JvbGwgaG9yaXpvbnRhbCBzaSBubyBjYWJlIGxhIGNvbHVtbmFcbiAgLy8gQWNjaVx1MDBGM24uIFNpbiBlc3RvLCB0YWJsZSB3aWR0aDoxMDAlIGNvbXByaW1lIHRvZG8geSBsYSBcdTAwRkFsdGltYSBjb2x1bW5hXG4gIC8vIHF1ZWRhIGZ1ZXJhIGRlbCB2aWV3cG9ydCBzaW4gc2Nyb2xsIHZpc2libGUuXG4gIGNvbnN0IHRhYmxlID1cbiAgICAnPGRpdiBzdHlsZT1cIm92ZXJmbG93OmF1dG87bWF4LWhlaWdodDo2MHZoO2JvcmRlcjoxcHggc29saWQgdmFyKC0tYm9yZGVyLXN1YnRsZSk7Ym9yZGVyLXJhZGl1czo4cHhcIj4nICtcbiAgICAnPHRhYmxlIHN0eWxlPVwid2lkdGg6MTAwJTttaW4td2lkdGg6MTQwMHB4O2JvcmRlci1jb2xsYXBzZTpjb2xsYXBzZTtmb250LXNpemU6MTJweFwiPicgK1xuICAgICc8dGhlYWQgc3R5bGU9XCJiYWNrZ3JvdW5kOiMwZjE3MmE7Y29sb3I6I2ZmZjtwb3NpdGlvbjpzdGlja3k7dG9wOjA7ei1pbmRleDoxXCI+PHRyPicgK1xuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjhweDt0ZXh0LWFsaWduOmNlbnRlcjtmb250LXNpemU6MTBweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2VcIj5GYW08L3RoPicgK1xuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjhweDt0ZXh0LWFsaWduOmNlbnRlcjtmb250LXNpemU6MTBweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2VcIj5TS1U8L3RoPicgK1xuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjhweDt0ZXh0LWFsaWduOmNlbnRlcjtmb250LXNpemU6MTBweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2VcIj5EZXNjcmlwY2lcdTAwRjNuPC90aD4nICtcbiAgICAnPHRoIHN0eWxlPVwicGFkZGluZzo4cHg7dGV4dC1hbGlnbjpjZW50ZXI7Zm9udC1zaXplOjEwcHg7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlXCIgdGl0bGU9XCJXaHMgMTEgZGlzcG9uaWJsZSB2ZW50YVwiPlN0b2NrPC90aD4nICtcbiAgICAnPHRoIHN0eWxlPVwicGFkZGluZzo4cHg7dGV4dC1hbGlnbjpjZW50ZXI7Zm9udC1zaXplOjEwcHg7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlXCIgdGl0bGU9XCJXaHMgMTJcIj5Uclx1MDBFMW5zaXRvPC90aD4nICtcbiAgICAnPHRoIHN0eWxlPVwicGFkZGluZzo4cHg7dGV4dC1hbGlnbjpjZW50ZXI7Zm9udC1zaXplOjEwcHg7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlXCI+QmFja29yZGVyPC90aD4nICtcbiAgICAnPHRoIHN0eWxlPVwicGFkZGluZzo4cHg7dGV4dC1hbGlnbjpjZW50ZXI7Zm9udC1zaXplOjEwcHg7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlXCIgdGl0bGU9XCJQcm9tZWRpbyBcdTAwRkFsdGltb3MgMyBtZXNlc1wiPlZ0YS9tZXM8L3RoPicgK1xuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjhweDt0ZXh0LWFsaWduOmNlbnRlcjtmb250LXNpemU6MTBweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2VcIiB0aXRsZT1cIk11bHRpcGxpY2Fkb3IgZGUgdGVuZGVuY2lhID0gdmVudGEgMm0gLyB2ZW50YSA2bS4gRWRpdGFibGUgKGNsaWNrIHBhcmEgb3ZlcnJpZGUpLlwiPk11bHRpcC48L3RoPicgK1xuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjhweDt0ZXh0LWFsaWduOmNlbnRlcjtmb250LXNpemU6MTBweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2VcIiB0aXRsZT1cIlZ0YS9tZXMgXHUwMEQ3IDcgbWVzZXNcIj5EZW1hbmRhIGVzcC48L3RoPicgK1xuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjhweDt0ZXh0LWFsaWduOmNlbnRlcjtmb250LXNpemU6MTBweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2VcIiB0aXRsZT1cIlN1bWEgY29sdW1uYXMgU2FsZXMgUGxhbiBkZXNkZSBtZXMgYWN0dWFsXCI+UGxhbiBmdXR1cm88L3RoPicgK1xuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjhweDt0ZXh0LWFsaWduOmNlbnRlcjtmb250LXNpemU6MTBweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2VcIj5CYWxhbmNlPC90aD4nICtcbiAgICAnPHRoIHN0eWxlPVwicGFkZGluZzo4cHg7dGV4dC1hbGlnbjpjZW50ZXI7Zm9udC1zaXplOjEwcHg7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlXCI+TU9RPC90aD4nICtcbiAgICAnPHRoIHN0eWxlPVwicGFkZGluZzo4cHg7dGV4dC1hbGlnbjpjZW50ZXI7Zm9udC1zaXplOjEwcHg7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO2JhY2tncm91bmQ6IzEzNGU0YVwiPlJlY29tZW5kYWRvPC90aD4nICtcbiAgICAnPHRoIHN0eWxlPVwicGFkZGluZzo4cHg7dGV4dC1hbGlnbjpjZW50ZXI7Zm9udC1zaXplOjEwcHg7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlXCIgdGl0bGU9XCJEZXNjb250aW51YXIgU0tVXCI+QWNjaVx1MDBGM248L3RoPicgK1xuICAgICc8L3RyPjwvdGhlYWQ+PHRib2R5PicgK1xuICAgIChyb3dzLmxlbmd0aFxuICAgICAgPyByb3dzSHRtbFxuICAgICAgOiAnPHRyPjx0ZCBjb2xzcGFuPVwiMTRcIiBzdHlsZT1cInBhZGRpbmc6NDBweDt0ZXh0LWFsaWduOmNlbnRlcjtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKVwiPlNpbiByZXN1bHRhZG9zIGNvbiBsb3MgZmlsdHJvcyBhY3R1YWxlczwvdGQ+PC90cj4nKSArXG4gICAgJzwvdGJvZHk+PC90YWJsZT48L2Rpdj4nO1xuXG4gIGNvbnN0IGZvb3RlciA9XG4gICAgJzxkaXYgc3R5bGU9XCJtYXJnaW4tdG9wOjhweDtmb250LXNpemU6MTBweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKVwiPicgK1xuICAgICdNb3N0cmFuZG8gJyArXG4gICAgX2ZtdEludChyb3dzLmxlbmd0aCkgK1xuICAgICcgZGUgJyArXG4gICAgX2ZtdEludChhbGxSb3dzLmxlbmd0aCkgK1xuICAgICcgU0tVcyBcdTAwQjcgJyArXG4gICAgJ0JhbGFuY2UgPSBTdG9jayArIFRyXHUwMEUxbnNpdG8gKyBQbGFuIFx1MjIxMiBCYWNrb3JkZXIgXHUyMjEyIERlbWFuZGEuIFJvam8gPSBxdWllYnJlIGVzcGVyYWRvLiBSZWNvbWVuZGFkbyBzZSByZWRvbmRlYSBhbCBtXHUwMEZBbHRpcGxvIGRlIE1PUSBzdXBlcmlvci4nICtcbiAgICAnPC9kaXY+JztcblxuICBjb250LmlubmVySFRNTCA9XG4gICAgJzxkaXYgc3R5bGU9XCJwYWRkaW5nOjE4cHggMThweCAzMHB4XCI+JyArIGhlYWRlciArIGZpbHRlcnMgKyB0YWJsZSArIGZvb3RlciArICc8L2Rpdj4nO1xufVxuXG53aW5kb3cub25SZWNvU2VhcmNoQ2hhbmdlID0gZnVuY3Rpb24gKGV2KSB7XG4gIF9yZWNvU2VhcmNoVGV4dCA9IGV2LnRhcmdldC52YWx1ZSB8fCAnJztcbiAgX3JlbmRlclJlY29TZWN0aW9uKCk7XG4gIC8vIFJlc3RhdXJhciBmb2N1cyArIGNhcmV0IGFsIGlucHV0XG4gIHNldFRpbWVvdXQoKCkgPT4ge1xuICAgIGNvbnN0IGlucCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdyZWNvLXNlYXJjaCcpO1xuICAgIGlmIChpbnApIHtcbiAgICAgIGlucC5mb2N1cygpO1xuICAgICAgaW5wLnNldFNlbGVjdGlvblJhbmdlKGlucC52YWx1ZS5sZW5ndGgsIGlucC52YWx1ZS5sZW5ndGgpO1xuICAgIH1cbiAgfSwgMCk7XG59O1xuXG53aW5kb3cub25SZWNvRmFtaWxpYUNoYW5nZSA9IGZ1bmN0aW9uIChldikge1xuICBfcmVjb0ZpbHRlckZhbWlsaWEgPSBldi50YXJnZXQudmFsdWUgfHwgJ2FsbCc7XG4gIF9yZW5kZXJSZWNvU2VjdGlvbigpO1xufTtcblxud2luZG93Lm9uUmVjb0ZpbHRlck1pbkNoYW5nZSA9IGZ1bmN0aW9uIChldikge1xuICBfcmVjb0ZpbHRlck1pblJlYyA9ICEhZXYudGFyZ2V0LmNoZWNrZWQ7XG4gIF9yZW5kZXJSZWNvU2VjdGlvbigpO1xufTtcblxud2luZG93LmV4cG9ydFJlY29FeGNlbCA9IGZ1bmN0aW9uICgpIHtcbiAgaWYgKHR5cGVvZiBYTFNYID09PSAndW5kZWZpbmVkJykge1xuICAgIGFsZXJ0KCdTaGVldEpTIChYTFNYKSBubyBjYXJnYWRvJyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGNvbnN0IHJvd3MgPSBfY29tcHV0ZVJlY29tbWVuZGF0aW9ucygpO1xuICBjb25zdCBhb2EgPSBbXG4gICAgW1xuICAgICAgJ0ZhbWlsaWEnLFxuICAgICAgJ1NLVScsXG4gICAgICAnRGVzY3JpcGNpXHUwMEYzbicsXG4gICAgICAnU3RvY2snLFxuICAgICAgJ1RyXHUwMEUxbnNpdG8nLFxuICAgICAgJ0JhY2tvcmRlcicsXG4gICAgICAnVnRhIHByb20vbWVzJyxcbiAgICAgICdNdWx0aXBsaWNhZG9yJyxcbiAgICAgICdPcmlnZW4gbXVsdCcsXG4gICAgICAnRGVtYW5kYSBlc3AuIDdtJyxcbiAgICAgICdTYWxlcyBQbGFuIGZ1dHVybycsXG4gICAgICAnQmFsYW5jZScsXG4gICAgICAnTU9RJyxcbiAgICAgICdSZWNvbWVuZGFkbycsXG4gICAgXSxcbiAgXTtcbiAgZm9yIChjb25zdCByIG9mIHJvd3MpIHtcbiAgICBhb2EucHVzaChbXG4gICAgICByLmZhbWlsaWEgPT09ICdyb2RzJyA/ICdSb2RzIChDYVx1MDBGMWFzKScgOiAnUmVlbHMnLFxuICAgICAgci5za3UsXG4gICAgICByLmRlc2NyaXB0aW9uLFxuICAgICAgci5zdG9ja0xpYnJlLFxuICAgICAgci5lblRyYW5zaXRvLFxuICAgICAgci5iYWNrb3JkZXIsXG4gICAgICByLnZlbnRhTWVuc3VhbCxcbiAgICAgIHIubXVsdGlwbGllcixcbiAgICAgIHIubXVsdFNvdXJjZSB8fCAnYXV0bycsXG4gICAgICByLmRlbWFuZGFFc3BlcmFkYSxcbiAgICAgIHIuc2FsZXNQbGFuRnV0LFxuICAgICAgci5iYWxhbmNlLFxuICAgICAgci5tb3EsXG4gICAgICByLnJlY29tZW5kYWRvLFxuICAgIF0pO1xuICB9XG4gIGNvbnN0IHdzID0gWExTWC51dGlscy5hb2FfdG9fc2hlZXQoYW9hKTtcbiAgd3NbJyFjb2xzJ10gPSBbXG4gICAgeyB3Y2g6IDE0IH0sIC8vIEZhbWlsaWFcbiAgICB7IHdjaDogMTggfSwgLy8gU0tVXG4gICAgeyB3Y2g6IDQwIH0sIC8vIERlc2NyaXBjaVx1MDBGM25cbiAgICB7IHdjaDogOCB9LCAvLyBTdG9ja1xuICAgIHsgd2NoOiAxMCB9LCAvLyBUclx1MDBFMW5zaXRvXG4gICAgeyB3Y2g6IDExIH0sIC8vIEJhY2tvcmRlclxuICAgIHsgd2NoOiAxMiB9LCAvLyBWdGEgcHJvbS9tZXNcbiAgICB7IHdjaDogMTIgfSwgLy8gTXVsdGlwbGljYWRvclxuICAgIHsgd2NoOiAxMSB9LCAvLyBPcmlnZW4gbXVsdFxuICAgIHsgd2NoOiAxNSB9LCAvLyBEZW1hbmRhIGVzcCA3bVxuICAgIHsgd2NoOiAxNiB9LCAvLyBTYWxlcyBQbGFuIGZ1dHVyb1xuICAgIHsgd2NoOiAxMCB9LCAvLyBCYWxhbmNlXG4gICAgeyB3Y2g6IDggfSwgLy8gTU9RXG4gICAgeyB3Y2g6IDEyIH0sIC8vIFJlY29tZW5kYWRvXG4gIF07XG4gIGNvbnN0IHdiID0gWExTWC51dGlscy5ib29rX25ldygpO1xuICBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KHdiLCB3cywgJ1JlY29tZW5kYWNpXHUwMEYzbicpO1xuICBjb25zdCBob3kgPSBuZXcgRGF0ZSgpO1xuICBjb25zdCBzdGFtcCA9XG4gICAgaG95LmdldEZ1bGxZZWFyKCkgK1xuICAgICctJyArXG4gICAgU3RyaW5nKGhveS5nZXRNb250aCgpICsgMSkucGFkU3RhcnQoMiwgJzAnKSArXG4gICAgJy0nICtcbiAgICBTdHJpbmcoaG95LmdldERhdGUoKSkucGFkU3RhcnQoMiwgJzAnKTtcbiAgWExTWC53cml0ZUZpbGUod2IsICdSZWNvbWVuZGFjaW9uX0NvbXByYV8nICsgc3RhbXAgKyAnLnhsc3gnKTtcbn07XG5cbi8vIHYxMTEyIEYzQjogZGVzY29udGludWFyIC8gcmVhY3RpdmFyIFNLVXMuXG53aW5kb3cuZGlzY29udGludWVTa3UgPSBhc3luYyBmdW5jdGlvbiAoc2t1LCBkZXNjcmlwdGlvbikge1xuICBpZiAoIV9kaXNjb250aW51ZWRTa3VzKSBfZGlzY29udGludWVkU2t1cyA9IG5ldyBTZXQoKTtcbiAgY29uc3QgdXBwZXIgPSBTdHJpbmcoc2t1KS50cmltKCkudG9VcHBlckNhc2UoKTtcbiAgY29uc3QgbGFiZWwgPSBkZXNjcmlwdGlvbiA/IHNrdSArICcgXHUyMDE0ICcgKyBkZXNjcmlwdGlvbi5zbGljZSgwLCA2MCkgOiBza3U7XG4gIGlmIChcbiAgICAhY29uZmlybShcbiAgICAgICdEZXNjb250aW51YXIgJyArXG4gICAgICAgIGxhYmVsICtcbiAgICAgICAgJz9cXG5cXG5RdWVkYXJcdTAwRTEgZXhjbHVpZG8gZGVsIGNcdTAwRTFsY3VsbyBkZSByZWNvbWVuZGFjaVx1MDBGM24gZGUgY29tcHJhIGhhc3RhIHF1ZSBsbyByZWFjdGl2ZXMgZGVzZGUgZWwgY2hpcCBcIkRlc2NvbnRpbnVhZG9zXCIuJ1xuICAgIClcbiAgKSB7XG4gICAgcmV0dXJuO1xuICB9XG4gIF9kaXNjb250aW51ZWRTa3VzLmFkZCh1cHBlcik7XG4gIHRyeSB7XG4gICAgYXdhaXQgX3NhdmVEaXNjb250aW51ZWRTa3VzKCk7XG4gICAgX3JlbmRlclJlY29TZWN0aW9uKCk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBfZGlzY29udGludWVkU2t1cy5kZWxldGUodXBwZXIpO1xuICAgIGFsZXJ0KCdFcnJvciBndWFyZGFuZG86ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcbiAgfVxufTtcblxud2luZG93LnJlYWN0aXZhdGVTa3UgPSBhc3luYyBmdW5jdGlvbiAoc2t1KSB7XG4gIGlmICghX2Rpc2NvbnRpbnVlZFNrdXMpIHJldHVybjtcbiAgY29uc3QgdXBwZXIgPSBTdHJpbmcoc2t1KS50cmltKCkudG9VcHBlckNhc2UoKTtcbiAgX2Rpc2NvbnRpbnVlZFNrdXMuZGVsZXRlKHVwcGVyKTtcbiAgdHJ5IHtcbiAgICBhd2FpdCBfc2F2ZURpc2NvbnRpbnVlZFNrdXMoKTtcbiAgICBfcmVuZGVyRGlzY29udGludWVkTW9kYWwoKTtcbiAgICBfcmVuZGVyUmVjb1NlY3Rpb24oKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIF9kaXNjb250aW51ZWRTa3VzLmFkZCh1cHBlcik7XG4gICAgYWxlcnQoJ0Vycm9yIGd1YXJkYW5kbzogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xuICB9XG59O1xuXG53aW5kb3cub3BlbkRpc2NvbnRpbnVlZE1vZGFsID0gZnVuY3Rpb24gKCkge1xuICBjb25zdCBleGlzdGluZyA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdkaXNjb250aW51ZWQtc2t1cy1tb2RhbCcpO1xuICBpZiAoZXhpc3RpbmcpIGV4aXN0aW5nLnJlbW92ZSgpO1xuICBjb25zdCBlbCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpO1xuICBlbC5pZCA9ICdkaXNjb250aW51ZWQtc2t1cy1tb2RhbCc7XG4gIGVsLnN0eWxlLmNzc1RleHQgPVxuICAgICdwb3NpdGlvbjpmaXhlZDtpbnNldDowO2JhY2tncm91bmQ6cmdiYSgxNSwyMyw0MiwuNjUpO3otaW5kZXg6MjEwMDtkaXNwbGF5OmZsZXg7YWxpZ24taXRlbXM6Y2VudGVyO2p1c3RpZnktY29udGVudDpjZW50ZXI7cGFkZGluZzozdmgnO1xuICBlbC5vbmNsaWNrID0gKGV2KSA9PiB7XG4gICAgaWYgKGV2LnRhcmdldCA9PT0gZWwpIGVsLnJlbW92ZSgpO1xuICB9O1xuICBlbC5pbm5lckhUTUwgPVxuICAgICc8ZGl2IGlkPVwiZGlzY29udGludWVkLW1vZGFsLWNvbnRlbnRcIiBzdHlsZT1cImJhY2tncm91bmQ6dmFyKC0tYmctZWxldmF0ZWQpO2JvcmRlci1yYWRpdXM6MTJweDtwYWRkaW5nOjI0cHg7bWF4LXdpZHRoOjY0MHB4O3dpZHRoOjEwMCU7bWF4LWhlaWdodDo5MHZoO292ZXJmbG93OmF1dG87Ym94LXNoYWRvdzowIDIwcHggNjBweCByZ2JhKDAsMCwwLC40KVwiPjwvZGl2Pic7XG4gIGRvY3VtZW50LmJvZHkuYXBwZW5kQ2hpbGQoZWwpO1xuICBfcmVuZGVyRGlzY29udGludWVkTW9kYWwoKTtcbn07XG5cbmZ1bmN0aW9uIF9yZW5kZXJEaXNjb250aW51ZWRNb2RhbCgpIHtcbiAgY29uc3QgY29udCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdkaXNjb250aW51ZWQtbW9kYWwtY29udGVudCcpO1xuICBpZiAoIWNvbnQpIHJldHVybjtcbiAgY29uc3QgbGlzdCA9IF9kaXNjb250aW51ZWRTa3VzID8gQXJyYXkuZnJvbShfZGlzY29udGludWVkU2t1cykuc29ydCgpIDogW107XG4gIC8vIEJ1c2NhciBkZXNjcmlwY2lcdTAwRjNuIGVuIGxvcyBzYWxlcyBwbGFucyBjYWNoZXMgcG9yIHNpIGVzdGEgY2FyZ2Fkb1xuICBjb25zdCBza3VUb0Rlc2MgPSB7fTtcbiAgZm9yIChjb25zdCBmYW0gb2YgWydyb2RzJywgJ3JlZWxzJ10pIHtcbiAgICBjb25zdCBjYWNoZSA9IF9zYWxlc1BsYW5DYWNoZXNbZmFtXTtcbiAgICBpZiAoY2FjaGUgJiYgY2FjaGUucm93cykge1xuICAgICAgZm9yIChjb25zdCByIG9mIGNhY2hlLnJvd3MpIHtcbiAgICAgICAgc2t1VG9EZXNjW1N0cmluZyhyLnNrdSkudHJpbSgpLnRvVXBwZXJDYXNlKCldID0gci5kZXNjcmlwdGlvbiB8fCAnJztcbiAgICAgIH1cbiAgICB9XG4gIH1cbiAgY29uc3QgaGVhZCA9XG4gICAgJzxkaXYgc3R5bGU9XCJkaXNwbGF5OmZsZXg7anVzdGlmeS1jb250ZW50OnNwYWNlLWJldHdlZW47YWxpZ24taXRlbXM6Y2VudGVyO21hcmdpbi1ib3R0b206MTRweFwiPicgK1xuICAgICc8ZGl2PjxkaXYgc3R5bGU9XCJmb250LXNpemU6MThweDtmb250LXdlaWdodDo4MDA7Y29sb3I6dmFyKC0tdGV4dC1wcmltYXJ5KVwiPlNLVXMgZGVzY29udGludWFkb3M8L2Rpdj4nICtcbiAgICAnPGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMXB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO21hcmdpbi10b3A6MnB4XCI+JyArXG4gICAgbGlzdC5sZW5ndGggK1xuICAgICcgU0tVcyBleGNsdWlkb3MgZGVsIGNcdTAwRTFsY3VsbyBkZSBSZWNvbWVuZGFjaVx1MDBGM24gZGUgQ29tcHJhJyArXG4gICAgJzwvZGl2PjwvZGl2PicgK1xuICAgICc8YnV0dG9uIG9uY2xpY2s9XCJkb2N1bWVudC5nZXRFbGVtZW50QnlJZChcXCdkaXNjb250aW51ZWQtc2t1cy1tb2RhbFxcJykucmVtb3ZlKClcIiBzdHlsZT1cImJhY2tncm91bmQ6dHJhbnNwYXJlbnQ7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1ib3JkZXItc3VidGxlKTtib3JkZXItcmFkaXVzOjZweDtwYWRkaW5nOjZweCAxMnB4O2N1cnNvcjpwb2ludGVyO2ZvbnQtd2VpZ2h0OjcwMFwiPkNlcnJhcjwvYnV0dG9uPicgK1xuICAgICc8L2Rpdj4nO1xuICBjb25zdCBib2R5ID1cbiAgICBsaXN0Lmxlbmd0aCA9PT0gMFxuICAgICAgPyAnPGRpdiBzdHlsZT1cInBhZGRpbmc6NDBweDt0ZXh0LWFsaWduOmNlbnRlcjtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKVwiPk5vIGhheSBTS1VzIGRlc2NvbnRpbnVhZG9zLjxicj48YnI+UG9kXHUwMEU5cyBkZXNjb250aW51YXIgU0tVcyBkZXNkZSBlbCBib3RcdTAwRjNuIFx1RDgzRFx1REREMSBlbiBjYWRhIGZpbGEgZGUgbGEgdGFibGEgUmVjb21lbmRhY2lcdTAwRjNuIGRlIENvbXByYS48L2Rpdj4nXG4gICAgICA6ICc8ZGl2IHN0eWxlPVwiZGlzcGxheTpmbGV4O2ZsZXgtZGlyZWN0aW9uOmNvbHVtbjtnYXA6NnB4XCI+JyArXG4gICAgICAgIGxpc3RcbiAgICAgICAgICAubWFwKChza3UpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IGRlc2MgPSBza3VUb0Rlc2Nbc2t1XSB8fCAnJztcbiAgICAgICAgICAgIHJldHVybiAoXG4gICAgICAgICAgICAgICc8ZGl2IHN0eWxlPVwiZGlzcGxheTpmbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtnYXA6MTBweDtwYWRkaW5nOjEwcHggMTJweDtiYWNrZ3JvdW5kOnZhcigtLWJnLXNlY29uZGFyeSk7Ym9yZGVyLXJhZGl1czo2cHhcIj4nICtcbiAgICAgICAgICAgICAgJzxkaXYgc3R5bGU9XCJmbGV4OjFcIj48ZGl2IHN0eWxlPVwiZm9udC1mYW1pbHk6bW9ub3NwYWNlO2ZvbnQtd2VpZ2h0OjcwMDtjb2xvcjp2YXIoLS10ZXh0LXByaW1hcnkpXCI+JyArXG4gICAgICAgICAgICAgIGVzY2FwZUh0bWxTYWZlKHNrdSkgK1xuICAgICAgICAgICAgICAnPC9kaXY+JyArXG4gICAgICAgICAgICAgIChkZXNjXG4gICAgICAgICAgICAgICAgPyAnPGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMXB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO21hcmdpbi10b3A6MnB4XCI+JyArXG4gICAgICAgICAgICAgICAgICBlc2NhcGVIdG1sU2FmZShkZXNjKSArXG4gICAgICAgICAgICAgICAgICAnPC9kaXY+J1xuICAgICAgICAgICAgICAgIDogJycpICtcbiAgICAgICAgICAgICAgJzwvZGl2PicgK1xuICAgICAgICAgICAgICAnPGJ1dHRvbiBvbmNsaWNrPVwicmVhY3RpdmF0ZVNrdShcXCcnICtcbiAgICAgICAgICAgICAgZXNjYXBlSHRtbFNhZmUoc2t1KSArXG4gICAgICAgICAgICAgICdcXCcpXCIgc3R5bGU9XCJwYWRkaW5nOjZweCAxMnB4O2JhY2tncm91bmQ6IzE2YTM0YTtjb2xvcjojZmZmO2JvcmRlcjpub25lO2JvcmRlci1yYWRpdXM6NHB4O2ZvbnQtc2l6ZToxMXB4O2ZvbnQtd2VpZ2h0OjcwMDtjdXJzb3I6cG9pbnRlclwiPlx1MjFCQiBSZWFjdGl2YXI8L2J1dHRvbj4nICtcbiAgICAgICAgICAgICAgJzwvZGl2PidcbiAgICAgICAgICAgICk7XG4gICAgICAgICAgfSlcbiAgICAgICAgICAuam9pbignJykgK1xuICAgICAgICAnPC9kaXY+JztcbiAgY29udC5pbm5lckhUTUwgPSBoZWFkICsgYm9keTtcbn1cbiJdLAogICJtYXBwaW5ncyI6ICI7OztBQVlBLE1BQU0sZ0JBQWdCO0FBQUEsSUFDcEIsS0FBSztBQUFBLElBQ0wsU0FBUztBQUFBLElBQ1QsS0FBSztBQUFBLElBQ0wsT0FBTztBQUFBLElBQ1AsS0FBSztBQUFBLElBQ0wsVUFBVTtBQUFBLElBQ1YsU0FBUztBQUFBLElBQ1QsS0FBSztBQUFBLElBQ0wsT0FBTztBQUFBLElBQ1AsT0FBTztBQUFBLElBQ1AsS0FBSztBQUFBLElBQ0wsT0FBTztBQUFBLElBQ1AsS0FBSztBQUFBLElBQ0wsT0FBTztBQUFBLElBQ1AsS0FBSztBQUFBLElBQ0wsTUFBTTtBQUFBLElBQ04sS0FBSztBQUFBLElBQ0wsTUFBTTtBQUFBLElBQ04sT0FBTztBQUFBLElBQ1AsS0FBSztBQUFBLElBQ0wsTUFBTTtBQUFBLElBQ04sT0FBTztBQUFBLElBQ1AsS0FBSztBQUFBLElBQ0wsUUFBUTtBQUFBLElBQ1IsS0FBSztBQUFBLElBQ0wsUUFBUTtBQUFBLElBQ1IsS0FBSztBQUFBLElBQ0wsTUFBTTtBQUFBLElBQ04sV0FBVztBQUFBLElBQ1gsWUFBWTtBQUFBLElBQ1osS0FBSztBQUFBLElBQ0wsU0FBUztBQUFBLElBQ1QsU0FBUztBQUFBLElBQ1QsS0FBSztBQUFBLElBQ0wsVUFBVTtBQUFBLElBQ1YsV0FBVztBQUFBLElBQ1gsS0FBSztBQUFBLElBQ0wsVUFBVTtBQUFBLElBQ1YsS0FBSztBQUFBLElBQ0wsV0FBVztBQUFBLEVBQ2I7QUFLQSxXQUFTLG9CQUFvQixPQUFPO0FBQ2xDLFFBQUksU0FBUyxLQUFNLFFBQU87QUFLMUIsVUFBTSxJQUFJLE9BQU8sS0FBSyxFQUFFLFFBQVEsUUFBUSxHQUFHLEVBQUUsS0FBSyxFQUFFLFlBQVk7QUFDaEUsUUFBSSxDQUFDLEVBQUcsUUFB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
