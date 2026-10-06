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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL3B1cmUvc2FsZXMtcGxhbi1wYXJzZXIuanMiLCAiLi4vc3JjL2RvbWFpbnMvZm9yZWNhc3QuanMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbIi8vIEB0cy1ub2NoZWNrXG4vLyBQdXJlOiBwYXJzZWEgdW4gc2hlZXQgU2FsZXMgUGxhbiAoZm9ybWF0byBTVVIvU0FSIGRlIFNoaW1hbm8pIGEgZXN0cnVjdHVyYVxuLy8gbm9ybWFsaXphZGEgeyBza3UsIGRlc2NyaXB0aW9uLCBtb3EsIG1vbnRoczogeydZWVlZLU1NJzogTn0gfS5cbi8vIFNpbiBkZXBlbmRlbmNpYXMgXHUyMDE0IHJlY2liZSBlbCBzaGVldCB5YSBkZXNlcmlhbGl6YWRvIHBvciBTaGVldEpTXG4vLyAoWExTWC51dGlscy5zaGVldF90b19qc29uKHNoZWV0LCB7aGVhZGVyOjEsIGRlZnZhbDonJ30pKS5cbi8vIFRlc3RlYWJsZSBlbiB2aXRlc3Qgc2luIGNhcmdhciBYTFNYLlxuLy9cbi8vIENvbnRleHRvOiBsb3MgU2FsZXMgUGxhbnMgZGUgU2hpbWFubyB2aWVuZW4gY29uIGhlYWRlcnMgY29tb1xuLy8gXCJTS1UgQ29kZS9QYXJ0IE5vXCIsIFwiRGVzY3JpcHRpb25cIiwgXCJNT1EgMTIgbW9udGhzXCIgeSBjb2x1bW5hcyBkZSBtZXNlc1xuLy8gdGlwbyBcIkphbiAyMDI3XCIsIFwiTWF5IDIwMjdcIiAoYSB2ZWNlcyBjb24gYVx1MDBGMW8gZW4gdW5hIGZpbGEgYXJyaWJhIHkgZWwgbWVzXG4vLyBlbiBsYSBmaWxhIGhlYWRlcikuIEVzdGEgZm4gdG9sZXJhIGFtYm9zIGxheW91dHMuXG5cbmNvbnN0IE1PTlRIX0FMSUFTRVMgPSB7XG4gIGphbjogMSxcbiAgamFudWFyeTogMSxcbiAgZW5lOiAxLFxuICBlbmVybzogMSxcbiAgZmViOiAyLFxuICBmZWJydWFyeTogMixcbiAgZmVicmVybzogMixcbiAgbWFyOiAzLFxuICBtYXJjaDogMyxcbiAgbWFyem86IDMsXG4gIGFwcjogNCxcbiAgYXByaWw6IDQsXG4gIGFicjogNCxcbiAgYWJyaWw6IDQsXG4gIG1heTogNSxcbiAgbWF5bzogNSxcbiAganVuOiA2LFxuICBqdW5lOiA2LFxuICBqdW5pbzogNixcbiAganVsOiA3LFxuICBqdWx5OiA3LFxuICBqdWxpbzogNyxcbiAgYXVnOiA4LFxuICBhdWd1c3Q6IDgsXG4gIGFnbzogOCxcbiAgYWdvc3RvOiA4LFxuICBzZXA6IDksXG4gIHNlcHQ6IDksXG4gIHNlcHRlbWJlcjogOSxcbiAgc2VwdGllbWJyZTogOSxcbiAgb2N0OiAxMCxcbiAgb2N0b2JlcjogMTAsXG4gIG9jdHVicmU6IDEwLFxuICBub3Y6IDExLFxuICBub3ZlbWJlcjogMTEsXG4gIG5vdmllbWJyZTogMTEsXG4gIGRlYzogMTIsXG4gIGRlY2VtYmVyOiAxMixcbiAgZGljOiAxMixcbiAgZGljaWVtYnJlOiAxMixcbn07XG5cbi8vIE5vcm1hbGl6YSBsYWJlbHMgZGUgbWVzZXMgYSAnWVlZWS1NTScuIFJldG9ybmEgbnVsbCBzaSBubyBtYXRjaGVhLlxuLy8gRm9ybWF0b3Mgc29wb3J0YWRvczogXCJKYW4gMjAyN1wiLCBcIkVuZS0yN1wiLCBcIkphbi8yMDI3XCIsIFwiTWF5MjdcIixcbi8vIFwiMjAyNy0wMVwiLCBcIjAxLzIwMjdcIiwgXCJKYW4uMjAyN1wiLCBcIjIwMjFcXG5KYW5cIiAobXVsdGktbGluZSBFeGNlbCkuXG5mdW5jdGlvbiBub3JtYWxpemVNb250aExhYmVsKGxhYmVsKSB7XG4gIGlmIChsYWJlbCA9PSBudWxsKSByZXR1cm4gbnVsbDtcbiAgLy8gdjExMDQ6IGNvbGFwc2FyIG5ld2xpbmVzL3RhYnMgYSBlc3BhY2lvIGFudGVzIGRlbCB0cmltLlxuICAvLyBFbCBmb3JtYXRvIEV4Y2VsIFwiMjAyMVxcbkphblwiIChhXHUwMEYxbyBlbiBMMSwgbWVzIGVuIEwyIGRlbnRybyBkZSB1bmEgY2VsZGFcbiAgLy8gbXVsdGktcm93KSBlcyBjb21cdTAwRkFuIGVuIFNhbGVzIFBsYW5zIFNVUi4gYFxccytgIG1hdGNoZWEgd2hpdGVzcGFjZSBpbmNsdXllbmRvXG4gIC8vIFxcbiB5IFxcclxcbi5cbiAgY29uc3QgcyA9IFN0cmluZyhsYWJlbCkucmVwbGFjZSgvXFxzKy9nLCAnICcpLnRyaW0oKS50b0xvd2VyQ2FzZSgpO1xuICBpZiAoIXMpIHJldHVybiBudWxsO1xuICBsZXQgbTtcbiAgLy8gXCJqYW4gMjAyN1wiIHwgXCJqYW4tMjdcIiB8IFwiZW5lLzIwMjdcIiB8IFwibWF5MjdcIiB8IFwibWF5LjIwMjdcIlxuICBtID0gcy5tYXRjaCgvXihbYS16XHUwMEUxXHUwMEU5XHUwMEVEXHUwMEYzXHUwMEZBXXszLDEwfSlbXFxzXFwtLy5fXSooXFxkezIsNH0pJC8pO1xuICBpZiAobSkge1xuICAgIGNvbnN0IG1vbiA9IE1PTlRIX0FMSUFTRVNbbVsxXV0gfHwgTU9OVEhfQUxJQVNFU1ttWzFdLnNsaWNlKDAsIDMpXTtcbiAgICBpZiAobW9uKSB7XG4gICAgICBsZXQgeSA9IHBhcnNlSW50KG1bMl0sIDEwKTtcbiAgICAgIGlmICh5IDwgMTAwKSB5ID0gMjAwMCArIHk7XG4gICAgICByZXR1cm4gU3RyaW5nKHkpLnBhZFN0YXJ0KDQsICcwJykgKyAnLScgKyBTdHJpbmcobW9uKS5wYWRTdGFydCgyLCAnMCcpO1xuICAgIH1cbiAgfVxuICAvLyBcIjIwMjEgamFuXCIgfCBcIjIwMjcgZGljXCIgKGFcdTAwRjFvIHByaW1lcm8gKyBtZXMsIGZvcm1hdG8gRXhjZWwgbXVsdGktbGluZVxuICAvLyBjb2xhcHNhZG8gdHJhcyByZXBsYWNlIFxccyspLlxuICBtID0gcy5tYXRjaCgvXihcXGR7NH0pW1xcc1xcLS8uX10rKFthLXpcdTAwRTFcdTAwRTlcdTAwRURcdTAwRjNcdTAwRkFdezMsMTB9KSQvKTtcbiAgaWYgKG0pIHtcbiAgICBjb25zdCB5ID0gcGFyc2VJbnQobVsxXSwgMTApO1xuICAgIGNvbnN0IG1vbiA9IE1PTlRIX0FMSUFTRVNbbVsyXV0gfHwgTU9OVEhfQUxJQVNFU1ttWzJdLnNsaWNlKDAsIDMpXTtcbiAgICBpZiAobW9uKSByZXR1cm4gU3RyaW5nKHkpLnBhZFN0YXJ0KDQsICcwJykgKyAnLScgKyBTdHJpbmcobW9uKS5wYWRTdGFydCgyLCAnMCcpO1xuICB9XG4gIC8vIFwiMjAyNy0wMVwiIHwgXCIyMDI3LzAxXCJcbiAgbSA9IHMubWF0Y2goL14oXFxkezR9KVstL10oXFxkezEsMn0pJC8pO1xuICBpZiAobSkge1xuICAgIGNvbnN0IHkgPSBwYXJzZUludChtWzFdLCAxMCk7XG4gICAgY29uc3QgbW9uID0gcGFyc2VJbnQobVsyXSwgMTApO1xuICAgIGlmIChtb24gPj0gMSAmJiBtb24gPD0gMTIpXG4gICAgICByZXR1cm4gU3RyaW5nKHkpLnBhZFN0YXJ0KDQsICcwJykgKyAnLScgKyBTdHJpbmcobW9uKS5wYWRTdGFydCgyLCAnMCcpO1xuICB9XG4gIC8vIFwiMDEvMjAyN1wiIHwgXCIwMS0yMDI3XCJcbiAgbSA9IHMubWF0Y2goL14oXFxkezEsMn0pWy0vXShcXGR7NH0pJC8pO1xuICBpZiAobSkge1xuICAgIGNvbnN0IG1vbiA9IHBhcnNlSW50KG1bMV0sIDEwKTtcbiAgICBjb25zdCB5ID0gcGFyc2VJbnQobVsyXSwgMTApO1xuICAgIGlmIChtb24gPj0gMSAmJiBtb24gPD0gMTIpXG4gICAgICByZXR1cm4gU3RyaW5nKHkpLnBhZFN0YXJ0KDQsICcwJykgKyAnLScgKyBTdHJpbmcobW9uKS5wYWRTdGFydCgyLCAnMCcpO1xuICB9XG4gIHJldHVybiBudWxsO1xufVxuXG4vLyBCdXNjYSBsYSBmaWxhIGhlYWRlciAoMC1iYXNlZCkuIEVzY2FuZWEgbGFzIHByaW1lcmFzIDMwIGZpbGFzLlxuZnVuY3Rpb24gZmluZEhlYWRlclJvdyhyb3dzKSB7XG4gIGNvbnN0IEhFQURFUl9NQVJLRVJTID0gW1xuICAgICdza3UgY29kZS9wYXJ0IG5vJyxcbiAgICAnc2t1IGNvZGUnLFxuICAgICdza3UnLFxuICAgICdwYXJ0IG5vJyxcbiAgICAncGFydCBudW1iZXInLFxuICAgICdpdGVtY29kZScsXG4gICAgJ2l0ZW0gY29kZScsXG4gICAgJ2NvZGlnbycsXG4gICAgJ2NcdTAwRjNkaWdvJyxcbiAgXTtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBNYXRoLm1pbihyb3dzLmxlbmd0aCwgMzApOyBpKyspIHtcbiAgICBjb25zdCByb3cgPSByb3dzW2ldIHx8IFtdO1xuICAgIGZvciAoY29uc3QgY2VsbCBvZiByb3cpIHtcbiAgICAgIC8vIHYxMTA0OiBjb2xhcHNhciBuZXdsaW5lcyBhIGVzcGFjaW8gcGFyYSBtYXRjaGVhciBoZWFkZXJzIGNvbW9cbiAgICAgIC8vIFwiU0tVIENvZGUvUGFydCBOb1wiIChvaykgbyBcIlNLVVxcbkNvZGVcIiAobmVjZXNpdGEgY29sYXBzYXIpLlxuICAgICAgY29uc3QgcyA9IFN0cmluZyhjZWxsID09IG51bGwgPyAnJyA6IGNlbGwpXG4gICAgICAgIC5yZXBsYWNlKC9cXHMrL2csICcgJylcbiAgICAgICAgLnRyaW0oKVxuICAgICAgICAudG9Mb3dlckNhc2UoKTtcbiAgICAgIGlmIChIRUFERVJfTUFSS0VSUy5pbmRleE9mKHMpID49IDApIHJldHVybiBpO1xuICAgIH1cbiAgfVxuICByZXR1cm4gLTE7XG59XG5cbi8vIERldGVjdGEgXHUwMEVEbmRpY2VzIGRlIGNvbHVtbmFzIHkgbWVzZXMuIGBoaW50Um93QWJvdmVgIHBlcm1pdGUgY29tYmluYXIgYVx1MDBGMW8vbWVzXG4vLyBjdWFuZG8gZWwgaGVhZGVyIGVzIG11bHRpLXJvdyAoYVx1MDBGMW8gYXJyaWJhLCBtZXMgYWJham8gbyB2aWNldmVyc2EpLlxuZnVuY3Rpb24gZGV0ZWN0Q29sdW1ucyhoZWFkZXJSb3csIGhpbnRSb3dBYm92ZSkge1xuICBsZXQgc2t1SWR4ID0gLTE7XG4gIGxldCBkZXNjSWR4ID0gLTE7XG4gIGxldCBtb3FJZHggPSAtMTtcbiAgY29uc3QgbW9udGhDb2x1bW5zID0gW107XG4gIGNvbnN0IGRldGVjdGVkTW9udGhzU2V0ID0gbmV3IFNldCgpO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IGhlYWRlclJvdy5sZW5ndGg7IGkrKykge1xuICAgIC8vIHYxMTA0OiBjb2xhcHNhciBuZXdsaW5lcyBhIGVzcGFjaW8gYW50ZXMgZGUgY29tcGFyYXIuIExvcyBTYWxlcyBQbGFuXG4gICAgLy8gU1VSIHRpZW5lbiBoZWFkZXJzIG11bHRpLWxpbmUgY29tbyBcIk1PUVxcbjEyIG1vbnRoc1wiIG8gXCJCYXNlXFxuRk9CKFVTRClcIi5cbiAgICBjb25zdCByYXcgPSBTdHJpbmcoaGVhZGVyUm93W2ldID09IG51bGwgPyAnJyA6IGhlYWRlclJvd1tpXSlcbiAgICAgIC5yZXBsYWNlKC9cXHMrL2csICcgJylcbiAgICAgIC50cmltKCk7XG4gICAgY29uc3QgcyA9IHJhdy50b0xvd2VyQ2FzZSgpO1xuICAgIGlmIChcbiAgICAgIHNrdUlkeCA8IDAgJiZcbiAgICAgIChzID09PSAnc2t1IGNvZGUvcGFydCBubycgfHxcbiAgICAgICAgcyA9PT0gJ3NrdSBjb2RlJyB8fFxuICAgICAgICBzID09PSAnc2t1JyB8fFxuICAgICAgICBzID09PSAncGFydCBubycgfHxcbiAgICAgICAgcyA9PT0gJ3BhcnQgbnVtYmVyJyB8fFxuICAgICAgICBzID09PSAnaXRlbWNvZGUnIHx8XG4gICAgICAgIHMgPT09ICdpdGVtIGNvZGUnIHx8XG4gICAgICAgIHMgPT09ICdjb2RpZ28nIHx8XG4gICAgICAgIHMgPT09ICdjXHUwMEYzZGlnbycpXG4gICAgKSB7XG4gICAgICBza3VJZHggPSBpO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChcbiAgICAgIGRlc2NJZHggPCAwICYmXG4gICAgICAocyA9PT0gJ2Rlc2NyaXB0aW9uJyB8fFxuICAgICAgICBzID09PSAnZGVzY3JpcGNpb24nIHx8XG4gICAgICAgIHMgPT09ICdkZXNjcmlwY2lcdTAwRjNuJyB8fFxuICAgICAgICBzID09PSAnaXRlbSBuYW1lJyB8fFxuICAgICAgICBzID09PSAnaXRlbW5hbWUnKVxuICAgICkge1xuICAgICAgZGVzY0lkeCA9IGk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKG1vcUlkeCA8IDAgJiYgKHMgPT09ICdtb3EgMTIgbW9udGhzJyB8fCBzID09PSAnbW9xJyB8fCBzLmluZGV4T2YoJ21vcScpID09PSAwKSkge1xuICAgICAgbW9xSWR4ID0gaTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICAvLyBUcnkgZGlyZWN0IG1vbnRoIHBhcnNlXG4gICAgbGV0IG1vbnRoS2V5ID0gbm9ybWFsaXplTW9udGhMYWJlbChyYXcpO1xuICAgIGlmICghbW9udGhLZXkgJiYgaGludFJvd0Fib3ZlICYmIGhpbnRSb3dBYm92ZVtpXSAhPSBudWxsKSB7XG4gICAgICBjb25zdCBoaW50ID0gU3RyaW5nKGhpbnRSb3dBYm92ZVtpXSkudHJpbSgpO1xuICAgICAgaWYgKGhpbnQpIHtcbiAgICAgICAgbW9udGhLZXkgPSBub3JtYWxpemVNb250aExhYmVsKHJhdyArICcgJyArIGhpbnQpIHx8IG5vcm1hbGl6ZU1vbnRoTGFiZWwoaGludCArICcgJyArIHJhdyk7XG4gICAgICB9XG4gICAgfVxuICAgIGlmIChtb250aEtleSkge1xuICAgICAgbW9udGhDb2x1bW5zLnB1c2goeyBjb2xJZHg6IGksIG1vbnRoS2V5IH0pO1xuICAgICAgZGV0ZWN0ZWRNb250aHNTZXQuYWRkKG1vbnRoS2V5KTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHtcbiAgICBza3VJZHgsXG4gICAgZGVzY0lkeCxcbiAgICBtb3FJZHgsXG4gICAgbW9udGhDb2x1bW5zLFxuICAgIGRldGVjdGVkTW9udGhzOiBBcnJheS5mcm9tKGRldGVjdGVkTW9udGhzU2V0KS5zb3J0KCksXG4gIH07XG59XG5cbi8vIFB1YmxpYzogcGFyc2UgZnVsbCBzaGVldC4gVGhyb3dzIG9uIG1pc3NpbmcgU0tVIGNvbHVtbiAvIG1vbnRocy5cbmZ1bmN0aW9uIHBhcnNlU2FsZXNQbGFuU2hlZXQocm93cykge1xuICBpZiAoIXJvd3MgfHwgIXJvd3MubGVuZ3RoKSB7XG4gICAgY29uc3QgZXJyID0gbmV3IEVycm9yKCdFeGNlbCB2YWNpbycpO1xuICAgIGVyci5jb2RlID0gJ0VNUFRZX1NIRUVUJztcbiAgICB0aHJvdyBlcnI7XG4gIH1cbiAgY29uc3QgaGVhZGVySWR4ID0gZmluZEhlYWRlclJvdyhyb3dzKTtcbiAgaWYgKGhlYWRlcklkeCA8IDApIHtcbiAgICBjb25zdCBlcnIgPSBuZXcgRXJyb3IoJ05vIHNlIGVuY29udHJvIGZpbGEgZGUgaGVhZGVycyAoYnVzY2FiYSBcIlNLVSBDb2RlL1BhcnQgTm9cIiBvIFwiU0tVXCIpJyk7XG4gICAgZXJyLmNvZGUgPSAnSEVBREVSX05PVF9GT1VORCc7XG4gICAgdGhyb3cgZXJyO1xuICB9XG4gIGNvbnN0IGhlYWRlclJvdyA9IHJvd3NbaGVhZGVySWR4XSB8fCBbXTtcbiAgY29uc3Qgcm93QWJvdmUgPSBoZWFkZXJJZHggPiAwID8gcm93c1toZWFkZXJJZHggLSAxXSB8fCBbXSA6IG51bGw7XG4gIGNvbnN0IGNvbHMgPSBkZXRlY3RDb2x1bW5zKGhlYWRlclJvdywgcm93QWJvdmUpO1xuICBpZiAoY29scy5za3VJZHggPCAwKSB7XG4gICAgY29uc3QgZXJyID0gbmV3IEVycm9yKCdObyBzZSBlbmNvbnRybyBjb2x1bW5hIFNLVSBlbiBsYSBmaWxhIGhlYWRlcicpO1xuICAgIGVyci5jb2RlID0gJ1NLVV9DT0xfTUlTU0lORyc7XG4gICAgdGhyb3cgZXJyO1xuICB9XG4gIGlmICghY29scy5tb250aENvbHVtbnMubGVuZ3RoKSB7XG4gICAgY29uc3QgZXJyID0gbmV3IEVycm9yKFxuICAgICAgJ05vIHNlIGRldGVjdGFyb24gY29sdW1uYXMgZGUgbWVzZXMgZW4gZWwgaGVhZGVyIChlajogXCJKYW4gMjAyN1wiLCBcIk1heSAyMDI3XCIpJ1xuICAgICk7XG4gICAgZXJyLmNvZGUgPSAnTU9OVEhTX05PVF9GT1VORCc7XG4gICAgdGhyb3cgZXJyO1xuICB9XG4gIGNvbnN0IHBhcnNlZFJvd3MgPSBbXTtcbiAgY29uc3Qgc2VlblNrdSA9IG5ldyBTZXQoKTtcbiAgZm9yIChsZXQgciA9IGhlYWRlcklkeCArIDE7IHIgPCByb3dzLmxlbmd0aDsgcisrKSB7XG4gICAgY29uc3Qgcm93ID0gcm93c1tyXSB8fCBbXTtcbiAgICBjb25zdCBza3VSYXcgPSByb3dbY29scy5za3VJZHhdO1xuICAgIGlmIChza3VSYXcgPT0gbnVsbCB8fCBTdHJpbmcoc2t1UmF3KS50cmltKCkgPT09ICcnKSBjb250aW51ZTtcbiAgICBjb25zdCBza3UgPSBTdHJpbmcoc2t1UmF3KS50cmltKCk7XG4gICAgY29uc3QgdXBwZXIgPSBza3UudG9VcHBlckNhc2UoKTtcbiAgICAvLyBTa2lwIGZpbGFzIFRPVEFMIC8gU1VNIC8gU1VCVE9UQUxcbiAgICBpZiAodXBwZXIgPT09ICdUT1RBTCcgfHwgdXBwZXIgPT09ICdTVU0nIHx8IHVwcGVyID09PSAnU1VCVE9UQUwnIHx8IHVwcGVyID09PSAnVE9UQUxFUycpXG4gICAgICBjb250aW51ZTtcbiAgICBpZiAoc2VlblNrdS5oYXModXBwZXIpKSBjb250aW51ZTsgLy8gZGVkdXBlXG4gICAgc2VlblNrdS5hZGQodXBwZXIpO1xuICAgIGNvbnN0IGRlc2NyaXB0aW9uID1cbiAgICAgIGNvbHMuZGVzY0lkeCA+PSAwID8gU3RyaW5nKHJvd1tjb2xzLmRlc2NJZHhdID09IG51bGwgPyAnJyA6IHJvd1tjb2xzLmRlc2NJZHhdKS50cmltKCkgOiAnJztcbiAgICBjb25zdCBtb3FSYXcgPSBjb2xzLm1vcUlkeCA+PSAwID8gcm93W2NvbHMubW9xSWR4XSA6IG51bGw7XG4gICAgY29uc3QgbW9xTnVtID0gTnVtYmVyKG1vcVJhdyk7XG4gICAgY29uc3QgbW9xID0gTnVtYmVyLmlzRmluaXRlKG1vcU51bSkgJiYgbW9xTnVtID4gMCA/IE1hdGgucm91bmQobW9xTnVtKSA6IDA7XG4gICAgY29uc3QgbW9udGhzID0ge307XG4gICAgZm9yIChjb25zdCBtYyBvZiBjb2xzLm1vbnRoQ29sdW1ucykge1xuICAgICAgY29uc3QgdiA9IHJvd1ttYy5jb2xJZHhdO1xuICAgICAgY29uc3QgbiA9IE51bWJlcih2KTtcbiAgICAgIGlmIChOdW1iZXIuaXNGaW5pdGUobikgJiYgbiA+IDApIHtcbiAgICAgICAgbW9udGhzW21jLm1vbnRoS2V5XSA9IE1hdGgucm91bmQobik7XG4gICAgICB9XG4gICAgfVxuICAgIHBhcnNlZFJvd3MucHVzaCh7IHNrdSwgZGVzY3JpcHRpb24sIG1vcSwgbW9udGhzIH0pO1xuICB9XG4gIHJldHVybiB7XG4gICAgaGVhZGVyUm93SW5kZXg6IGhlYWRlcklkeCxcbiAgICBkZXRlY3RlZE1vbnRoczogY29scy5kZXRlY3RlZE1vbnRocyxcbiAgICByb3dzQ291bnQ6IHBhcnNlZFJvd3MubGVuZ3RoLFxuICAgIHJvd3M6IHBhcnNlZFJvd3MsXG4gIH07XG59XG5cbi8vIFVNRC1pc2ggZXhwb3J0OiBwYXJhIHZpdGVzdCAobW9kdWxlLmV4cG9ydHMpIHkgcGFyYSBidW5kbGUgYnJvd3NlciAod2luZG93IGdsb2JhbCkuXG5pZiAodHlwZW9mIG1vZHVsZSAhPT0gJ3VuZGVmaW5lZCcgJiYgbW9kdWxlLmV4cG9ydHMpIHtcbiAgbW9kdWxlLmV4cG9ydHMgPSB7IHBhcnNlU2FsZXNQbGFuU2hlZXQsIG5vcm1hbGl6ZU1vbnRoTGFiZWwsIGZpbmRIZWFkZXJSb3csIGRldGVjdENvbHVtbnMgfTtcbn1cbmlmICh0eXBlb2Ygd2luZG93ICE9PSAndW5kZWZpbmVkJykge1xuICB3aW5kb3cuU2FsZXNQbGFuUGFyc2VyID0ge1xuICAgIHBhcnNlU2FsZXNQbGFuU2hlZXQsXG4gICAgbm9ybWFsaXplTW9udGhMYWJlbCxcbiAgICBmaW5kSGVhZGVyUm93LFxuICAgIGRldGVjdENvbHVtbnMsXG4gIH07XG59XG5cbmV4cG9ydCB7IGRldGVjdENvbHVtbnMsIGZpbmRIZWFkZXJSb3csIG5vcm1hbGl6ZU1vbnRoTGFiZWwsIHBhcnNlU2FsZXNQbGFuU2hlZXQgfTtcbiIsICIvLyBAdHMtbm9jaGVja1xuLy8gdjEwOTgrIEZhc2UgMTogaW1wb3J0IGRlbCBwYXJzZXIgcHVyby4gRWwgbVx1MDBGM2R1bG8gaGFjZSBgd2luZG93LlNhbGVzUGxhblBhcnNlcmBcbi8vIGNvbW8gc2lkZS1lZmZlY3QgeSB0YW1iaVx1MDBFOW4gZXhwb3J0YSBsYXMgZm5zIG5vbWJyYWRhczsgdXNhbW9zIHNpZGUtZWZmZWN0XG4vLyBwb3JxdWUgZm9yZWNhc3QuanMgY29ycmUgZW4gZWwgY2h1bmsgbGF6eSB5IHdpbmRvdyB5YSBlc3RcdTAwRTEgZGlzcG9uaWJsZS5cbmltcG9ydCAnLi4vcHVyZS9zYWxlcy1wbGFuLXBhcnNlci5qcyc7XG5cbi8vIEdsb2JhbHMgbGVpZG9zIGRlbCBlbnRvcm5vIChkZWNsYXJhZG9zIGVuIGluZGV4Lmh0bWwgaW5saW5lIG8gYnVuZGxlIHByZXZpbyk6XG4vLyBmYkRiLCBjdXJyZW50VXNlciwgWExTWCAoY2RuKSwgZXNjYXBlSHRtbC4gTWlzbW8gcGF0cm9uIHF1ZSBvdHJvcyBkb21pbmlvcy5cbi8vXG4vLyBGT1JFQ0FTVCAtIG1vZGFsIGFkbWluLW9ubHkgKE1hcmlhbm8pLiBDaHVuayBsYXp5OiBzZSBjYXJnYSBzb2xvIGFsIHByaW1lclxuLy8gY2xpY2sgZGVsIGJvdG9uIEZPUkVDQVNUIGRlbCBoZWFkZXIuIFJlZ2lzdHJhZG8gZW4gYnVpbGQuanMgTEFaWV9DSFVOS1MgK1xuLy8gc3JjL21haW4uanMgaW5zdGFsbENodW5rU3R1YnMgKyBzdy5qcyBTVEFUSUNfQVNTRVRTLiBWZXIgQ0xBVURFLm1kICMxOC5cbi8vXG4vLyB2MTExMSBjbGVhbjogcGlwZWxpbmUgbGVnYWN5IChTS1UgKyA2IGNvbHVtbmFzICsgcG9saXRpY2EgM20pIHJlbW92aWRvLlxuLy8gUmVlbXBsYXphZG8gcG9yOlxuLy8gICAtIEZhc2UgMSAodjEwOTgpOiBTYWxlcyBQbGFucyBtZW5zdWFsZXMgUm9kcy9SZWVscyBjb24gZm9ybWF0byBTVVIuXG4vLyAgIC0gRmFzZSAyQiAodjExMDMpOiBGb3JlY2FzdCBFc3RhZGlzdGljbyAoc3RhdHNmb3JlY2FzdCBwaXBlbGluZSBvZmZsaW5lKS5cbi8vICAgLSBGYXNlIDNBICh2MTEwOSk6IFRhYmxhIFJlY29tZW5kYWNpb24gZGUgQ29tcHJhLlxuXG4vLyB2MTA5OCsgKEZhc2UgMSBGb3JlY2FzdCB2Mik6IFNhbGVzIFBsYW5zIG1lbnN1YWxlcyBwb3IgZmFtaWxpYSAoUm9kcy9SZWVscy9GRykuXG4vLyBTZSBndWFyZGFuIGVuIEZpcmVzdG9yZSBgc2FsZXNfcGxhbl9jYWNoZS97ZmFtaWxpYX1gICsgc25hcHNob3QgRXhjZWwgb3JpZ2luYWxcbi8vIGVuIFN0b3JhZ2UgYGZvcmVjYXN0c19zbmFwc2hvdHMve1lZWVktTU19L3tmYW1pbGlhfS54bHN4YC5cbi8vIEVsIHBhcnNlciBwdXJvIHZpdmUgZW4gc3JjL3B1cmUvc2FsZXMtcGxhbi1wYXJzZXIuanMgKGF0dGFjaCBhIHdpbmRvdy5TYWxlc1BsYW5QYXJzZXIpLlxuLy8gdjExMDg6IEZHIHJlbW92aWRvIGRlbCBVSSAoTWFyaWFubyBwaWRpXHUwMEYzKS4gU29sbyBSb2RzICsgUmVlbHMgcG9yIGFob3JhLlxuLy8gTGEgcnVsZSBGaXJlc3RvcmUgc2lndWUgYWNlcHRhbmRvICdmZycgcG9yIHNpIGVuIGVsIGZ1dHVybyBzZSB2dWVsdmUgYVxuLy8gYWN0aXZhciBcdTIwMTQgbm8gYm9ycmFybGEgZW4gc3RvcmFnZS9maXJlc3RvcmUucnVsZXMgaGFzdGEgY29uZmlybWFyIGRlcHJlY2F0ZS5cbmNvbnN0IFNBTEVTX1BMQU5fRkFNSUxJQVMgPSBbXG4gIHsga2V5OiAncm9kcycsIGxhYmVsOiAnUm9kcyAoQ2FcdTAwRjFhcyknLCBjb2xvcjogJyMwZWE1ZTknIH0sXG4gIHsga2V5OiAncmVlbHMnLCBsYWJlbDogJ1JlZWxzJywgY29sb3I6ICcjOGI1Y2Y2JyB9LFxuXTtcbmNvbnN0IF9zYWxlc1BsYW5DYWNoZXMgPSB7IHJvZHM6IG51bGwsIHJlZWxzOiBudWxsIH07IC8vIGxhc3QgbG9hZGVkIGRvY1xubGV0IF9mb3JlY2FzdEFjdGl2ZVRhYiA9ICdzYWxlcy1wbGFucyc7IC8vICdzYWxlcy1wbGFucycgfCAnc3RhdCcgfCAnbGVnYWN5J1xuXG4vLyB2MTEwMysgKEZhc2UgMkIpOiBGb3JlY2FzdCBFc3RhZFx1MDBFRHN0aWNvIFx1MjAxNCBvdXRwdXQgcHVibGljYWRvIHBvclxuLy8gc2NyaXB0cy9mb3JlY2FzdC9wdWJsaXNoX3RvX2ZpcmVzdG9yZS5weSBhIGZvcmVjYXN0X291dHB1dC97c3ViX3NsdWd9XG4vLyArIGZvcmVjYXN0X291dHB1dF9tZXRhL2N1cnJlbnQuIDI0IHN1YnMgKyAxIG1ldGEgZG9jLlxubGV0IF9mb3JlY2FzdFN0YXREb2NzID0gbnVsbDsgLy8gW3tpZCwgc3ViZmFtaWxpYSwgZm9yZWNhc3RbN10sIG1ldHJpY3MsIGJlc3RNb2RlbCwgdmVyc2lvbklkfV1cbmxldCBfZm9yZWNhc3RTdGF0TWV0YSA9IG51bGw7IC8vIHtnZW5lcmF0ZWRBdCwgdmVyc2lvbklkLCByZXN1bWVuOiB7Li4ufX1cbmxldCBfZm9yZWNhc3RTdGF0SGlzdG9yeUNhY2hlID0gbnVsbDsgLy8geyBbc3ViXTogW3tkcywgeX1dIH0gY2FjaGUgbGF6eSBvbi1kZW1hbmRcblxuLy8gdjExMDkrIChGYXNlIDNBKTogVGFibGEgUmVjb21lbmRhY2lcdTAwRjNuIGRlIENvbXByYSBcdTIwMTQgY29tYmluYSBzYWxlcyBwbGFucyArXG4vLyBzdG9ja19zbmFwc2hvdCArIHNrdV92ZW50YXNfc25hcHNob3QgcGFyYSBjb21wdXRhciByZWNvbWVuZGFkbyBwb3IgU0tVLlxubGV0IF9yZWNvU3RvY2tTbmFwc2hvdCA9IG51bGw7IC8vIHt3YXJlaG91c2VCcmVha2Rvd246IHtza3U6eycxMSc6biwnMTInOm4sLi4ufX0sIGJhY2tvcmRlckJ5U2t1OiB7c2t1Om59fVxubGV0IF9yZWNvVmVudGFzU25hcHNob3QgPSBudWxsOyAvLyB7IFtTS1UgdXBwZXJdOiB7bWVzZXM6IHsnWVlZWS1NTSc6IHtxdHksYXJzfX19IH1cbmxldCBfcmVjb0ZpbHRlck1pblJlYyA9IHRydWU7IC8vIFwic29sbyBtb3N0cmFyIFNLVXMgY29uIHJlY29tZW5kYWRvID4gMFwiXG5sZXQgX3JlY29GaWx0ZXJGYW1pbGlhID0gJ2FsbCc7IC8vICdhbGwnIHwgJ3JvZHMnIHwgJ3JlZWxzJ1xubGV0IF9yZWNvU2VhcmNoVGV4dCA9ICcnO1xuXG4vLyB2MTExMisgKEYzQik6IFNLVXMgZGVzY29udGludWFkb3MgcXVlIE1hcmlhbm8gbWFyY2EgcGFyYSBleGNsdWlyIGRlbCBmb3JlY2FzdC5cbi8vIFBlcnNpc3RlbiBlbiBGaXJlc3RvcmUgYGZvcmVjYXN0X2NvbmZpZy9kaXNjb250aW51ZWRfc2t1c2AgY29tbyB7IHNrdXM6IFtTS1UgdXBwZXJdLCB1cGRhdGVkQXQsIHVwZGF0ZWRCeSB9LlxubGV0IF9kaXNjb250aW51ZWRTa3VzID0gbnVsbDsgLy8gU2V0PHN0cmluZyB1cHBlcj4gbyBudWxsIHNpIG5vIGNhcmdhZG9cbmxldCBfZGlzY29udGludWVkTWV0YSA9IG51bGw7IC8vIHt1cGRhdGVkQXQsIHVwZGF0ZWRCeX1cblxuLy8gdjExMTQrIChGM0IgbXVsdGlwbGljYWRvciBkaW5cdTAwRTFtaWNvKTogbXVsdGlwbGljYWRvciBhdXRvIHBvciBTS1UgPSB2ZW50YV8ybVxuLy8gZGl2aWRpZG8gcG9yIHZlbnRhXzZtLCBjb24gY2FwLiBPdmVycmlkZSBtYW51YWwgcGVyc2lzdGlkbyBlbiBGaXJlc3RvcmVcbi8vIGBmb3JlY2FzdF9jb25maWcvbXVsdGlwbGllcnNgIGNvbiB7c2t1T3ZlcnJpZGVzOiB7U0tVOiB7dmFsdWUsIHVwZGF0ZWRCeSwgdXBkYXRlZEF0fX19LlxubGV0IF9tdWx0aXBsaWVyT3ZlcnJpZGVzID0gbnVsbDsgLy8geyBbU0tVIHVwcGVyXToge3ZhbHVlLCB1cGRhdGVkQnksIHVwZGF0ZWRBdH0gfVxuY29uc3QgUkVDT19NVUxUX1JFQ0VOVF9NT05USFMgPSAyO1xuY29uc3QgUkVDT19NVUxUX0JBU0VMSU5FX01PTlRIUyA9IDY7XG5jb25zdCBSRUNPX01VTFRfTUlOID0gMC41O1xuY29uc3QgUkVDT19NVUxUX01BWCA9IDIuNTtcbmNvbnN0IFJFQ09fTVVMVF9NSU5fQkFTRUxJTkUgPSAwLjE7IC8vIGV2aXRhIGRpdmlzaVx1MDBGM24gcG9yIGNlcm9cblxuY29uc3QgUkVDT19IT1JJWk9OX01PTlRIUyA9IDc7XG5jb25zdCBSRUNPX1ZFTlRBX1BST01FRElPX1dJTkRPVyA9IDM7IC8vIG1lc2VzIGhhY2lhIGF0clx1MDBFMXMgcGFyYSBwcm9tZWRpbyB2ZW50YVxuLy8gUkVDT19ERUZBVUxUX01VTFRJUExJRVIgcmVtb3ZlZCAyMDI2LTEwLTA2ICh1bnVzZWQsIGZsYWdnZWQgYnkgYmlvbWUpLlxuXG4vLyBXaGl0ZWxpc3QgZGUgZW1haWxzIGNvbiBhY2Nlc28gYWwgbW9kYWwgRk9SRUNBU1QuIFJlcGxpY2EgZWwgcGF0cm9uIGRlXG4vLyBcIkFuYWxpc2lzXCIgKGluZGV4Lmh0bWw6MTI2MjUpLiBTb2xvIE1hcmlhbm87IHNpIG90cm8gYWRtaW4gbG8gbmVjZXNpdGFcbi8vIHNlIGFncmVnYSBhY2EgZXhwbGljaXRvLlxuY29uc3QgRk9SRUNBU1RfQUxMT1dFRF9FTUFJTFMgPSBbJ21hcmlhbm8uZXJiaW5vQHNoaW1hbm8uY29tLmFyJywgJ2VyYmlub21hcmlhbm9AZ21haWwuY29tJ107XG5cbmZ1bmN0aW9uIF9jYW5Gb3JlY2FzdCgpIHtcbiAgdHJ5IHtcbiAgICBjb25zdCBlbWFpbCA9ICgod2luZG93LmN1cnJlbnRVc2VyICYmIHdpbmRvdy5jdXJyZW50VXNlci5lbWFpbCkgfHwgJycpLnRvTG93ZXJDYXNlKCk7XG4gICAgaWYgKCFlbWFpbCkgcmV0dXJuIGZhbHNlO1xuICAgIHJldHVybiBGT1JFQ0FTVF9BTExPV0VEX0VNQUlMUy5pbmRleE9mKGVtYWlsKSA+PSAwO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbn1cblxuZnVuY3Rpb24gX3JlbmRlck1vZGFsU2hlbGwoKSB7XG4gIGNvbnN0IGV4aXN0aW5nID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2ZvcmVjYXN0LW1vZGFsJyk7XG4gIGlmIChleGlzdGluZykgcmV0dXJuIGV4aXN0aW5nO1xuICBjb25zdCBlbCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpO1xuICBlbC5pZCA9ICdmb3JlY2FzdC1tb2RhbCc7XG4gIGVsLmNsYXNzTmFtZSA9ICdtb2RhbC1vdmVybGF5JztcbiAgZWwuc3R5bGUuY3NzVGV4dCA9XG4gICAgJ2Rpc3BsYXk6bm9uZTtwb3NpdGlvbjpmaXhlZDtpbnNldDowO2JhY2tncm91bmQ6cmdiYSgxNSwyMyw0MiwuNik7ei1pbmRleDoyMDUwOyc7XG4gIGVsLm9uY2xpY2sgPSBmdW5jdGlvbiAoZXYpIHtcbiAgICBpZiAoZXYudGFyZ2V0ID09PSBlbCkgd2luZG93LmNsb3NlRm9yZWNhc3RNb2RhbCgpO1xuICB9O1xuICAvLyBTaGVsbCArIHRhYnMgYmFyICsgMiBjb250ZW5lZG9yZXMgZGUgdGFicyAoU2FsZXMgUGxhbnMgbnVldmEsIExlZ2FjeSA2bSkuXG4gIC8vIEVsIGNvbnRlbmlkbyBkZSBjYWRhIHRhYiBzZSBwaW50YSBjb24gX3JlbmRlclNhbGVzUGxhbnNUYWIoKSB5IGVsIGxlZ2FjeVxuICAvLyB1c2EgZWwgZmx1am8gX3JlbmRlclRhYmxlKCkgZGUgc2llbXByZS5cbiAgY29uc3Qgc2hlbGxIdG1sID0gX2J1aWxkU2hlbGxIdG1sKCk7XG4gIGVsLmlubmVySFRNTCA9IHNoZWxsSHRtbDtcbiAgZG9jdW1lbnQuYm9keS5hcHBlbmRDaGlsZChlbCk7XG4gIHJldHVybiBlbDtcbn1cblxuZnVuY3Rpb24gX2J1aWxkU2hlbGxIdG1sKCkge1xuICAvLyBCcm9rZW4tb3V0IHB1cmUgc3RyaW5nIGJ1aWxkZXIgcGFyYSBwYXNhciBlbCBob29rIGRlIGlubmVySFRNTC5cbiAgY29uc3QgbW9kYWxPdXRlciA9XG4gICAgJzxkaXYgc3R5bGU9XCJwb3NpdGlvbjphYnNvbHV0ZTtpbnNldDoxdmggMXZ3O2JhY2tncm91bmQ6dmFyKC0tYmctZWxldmF0ZWQpO2JvcmRlci1yYWRpdXM6MTBweDtkaXNwbGF5OmZsZXg7ZmxleC1kaXJlY3Rpb246Y29sdW1uO292ZXJmbG93OmhpZGRlbjtib3gtc2hhZG93OjAgMjBweCA1MHB4IHJnYmEoMCwwLDAsLjM1KVwiPic7XG4gIGNvbnN0IGhlYWRlciA9XG4gICAgJzxkaXYgc3R5bGU9XCJwYWRkaW5nOjEycHggMThweDtiYWNrZ3JvdW5kOiMwZjE3MmE7Y29sb3I6I2ZmZjtkaXNwbGF5OmZsZXg7YWxpZ24taXRlbXM6Y2VudGVyO2dhcDoxMnB4XCI+JyArXG4gICAgJzxkaXYgc3R5bGU9XCJmbGV4OjFcIj48ZGl2IHN0eWxlPVwiZm9udC1zaXplOjE2cHg7Zm9udC13ZWlnaHQ6ODAwO2xldHRlci1zcGFjaW5nOi41cHhcIj5GT1JFQ0FTVDwvZGl2PicgK1xuICAgICc8ZGl2IGlkPVwiZm9yZWNhc3Qtc3VidGl0bGVcIiBzdHlsZT1cImZvbnQtc2l6ZToxMXB4O29wYWNpdHk6Ljg7bWFyZ2luLXRvcDoycHhcIj5TYWxlcyBQbGFucyBtZW5zdWFsZXMgKyBwb2xpdGljYSBkZSBpbnZlbnRhcmlvPC9kaXY+PC9kaXY+JyArXG4gICAgJzxidXR0b24gb25jbGljaz1cImNsb3NlRm9yZWNhc3RNb2RhbCgpXCIgc3R5bGU9XCJiYWNrZ3JvdW5kOnRyYW5zcGFyZW50O2NvbG9yOiNmZmY7Ym9yZGVyOjFweCBzb2xpZCByZ2JhKDI1NSwyNTUsMjU1LC40KTtib3JkZXItcmFkaXVzOjZweDtwYWRkaW5nOjZweCAxMHB4O2N1cnNvcjpwb2ludGVyO2ZvbnQtd2VpZ2h0OjcwMFwiPkNlcnJhcjwvYnV0dG9uPicgK1xuICAgICc8L2Rpdj4nO1xuICAvLyB2MTExMTogdGFiIFwiTGVnYWN5ICg2bSlcIiBlbGltaW5hZGEgXHUyMDE0IGVsIHBpcGVsaW5lIHZpZWpvIChTS1UgKyA2IGNvbHVtbmFzXG4gIC8vIHZzIHNrdV92ZW50YXNfc25hcHNob3QgKyBwb2xcdTAwRUR0aWNhIDNtKSBmdWUgcmVlbXBsYXphZG8gcG9yIGxhIHRhYmxhXG4gIC8vIFJlY29tZW5kYWNpXHUwMEYzbiBkZSBDb21wcmEgKHYxMTA5LCBGM0EpIHF1ZSB1c2EgZGF0b3MgbVx1MDBFMXMgY29tcGxldG9zLlxuICBjb25zdCB0YWJzQmFyID1cbiAgICAnPGRpdiBpZD1cImZvcmVjYXN0LXRhYnMtYmFyXCIgc3R5bGU9XCJkaXNwbGF5OmZsZXg7Z2FwOjA7YmFja2dyb3VuZDp2YXIoLS1iZy1zZWNvbmRhcnkpO3BhZGRpbmc6MCAxOHB4O2JvcmRlci1ib3R0b206MXB4IHNvbGlkIHZhcigtLWJvcmRlci1zdWJ0bGUpXCI+JyArXG4gICAgJzxidXR0b24gZGF0YS10YWI9XCJzYWxlcy1wbGFuc1wiIG9uY2xpY2s9XCJzd2l0Y2hGb3JlY2FzdFRhYihcXCdzYWxlcy1wbGFuc1xcJylcIiBjbGFzcz1cImZvcmVjYXN0LXRhYlwiIHN0eWxlPVwicGFkZGluZzoxMHB4IDE2cHg7YmFja2dyb3VuZDp0cmFuc3BhcmVudDtjb2xvcjp2YXIoLS10ZXh0LXByaW1hcnkpO2JvcmRlcjpub25lO2JvcmRlci1ib3R0b206M3B4IHNvbGlkICMwZDk0ODg7Y3Vyc29yOnBvaW50ZXI7Zm9udC13ZWlnaHQ6NzAwO2ZvbnQtc2l6ZToxMnB4O2xldHRlci1zcGFjaW5nOi40cHg7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlXCI+U2FsZXMgUGxhbnM8L2J1dHRvbj4nICtcbiAgICAnPGJ1dHRvbiBkYXRhLXRhYj1cInN0YXRcIiBvbmNsaWNrPVwic3dpdGNoRm9yZWNhc3RUYWIoXFwnc3RhdFxcJylcIiBjbGFzcz1cImZvcmVjYXN0LXRhYlwiIHN0eWxlPVwicGFkZGluZzoxMHB4IDE2cHg7YmFja2dyb3VuZDp0cmFuc3BhcmVudDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTtib3JkZXI6bm9uZTtib3JkZXItYm90dG9tOjNweCBzb2xpZCB0cmFuc3BhcmVudDtjdXJzb3I6cG9pbnRlcjtmb250LXdlaWdodDo2MDA7Zm9udC1zaXplOjEycHg7bGV0dGVyLXNwYWNpbmc6LjRweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2VcIj5Gb3JlY2FzdCBFc3RhZFx1MDBFRHN0aWNvPC9idXR0b24+JyArXG4gICAgJzwvZGl2Pic7XG4gIGNvbnN0IHRhYlNhbGVzUGxhbnMgPSAnPGRpdiBpZD1cImZvcmVjYXN0LXRhYi1zYWxlcy1wbGFuc1wiIHN0eWxlPVwiZmxleDoxO292ZXJmbG93OmF1dG9cIj48L2Rpdj4nO1xuICBjb25zdCB0YWJTdGF0ID0gJzxkaXYgaWQ9XCJmb3JlY2FzdC10YWItc3RhdFwiIHN0eWxlPVwiZmxleDoxO292ZXJmbG93OmF1dG87ZGlzcGxheTpub25lXCI+PC9kaXY+JztcbiAgcmV0dXJuIG1vZGFsT3V0ZXIgKyBoZWFkZXIgKyB0YWJzQmFyICsgdGFiU2FsZXNQbGFucyArIHRhYlN0YXQgKyAnPC9kaXY+Jztcbn1cblxuLy8gdjEwOTgrIEZhc2UgMSArIHYxMTAzKyBGYXNlIDJCICsgdjExMDUgZml4ICsgdjExMTEgY2xlYW4gbGVnYWN5OiBzd2l0Y2hcbi8vIGVudHJlIHRhYnMgU2FsZXMgUGxhbnMgLyBGb3JlY2FzdCBFc3RhZFx1MDBFRHN0aWNvLlxud2luZG93LnN3aXRjaEZvcmVjYXN0VGFiID0gZnVuY3Rpb24gKHRhYklkKSB7XG4gIF9mb3JlY2FzdEFjdGl2ZVRhYiA9IHRhYklkO1xuICBjb25zdCBzcCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdmb3JlY2FzdC10YWItc2FsZXMtcGxhbnMnKTtcbiAgY29uc3Qgc3QgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZm9yZWNhc3QtdGFiLXN0YXQnKTtcbiAgaWYgKHNwKSBzcC5zdHlsZS5kaXNwbGF5ID0gdGFiSWQgPT09ICdzYWxlcy1wbGFucycgPyAnYmxvY2snIDogJ25vbmUnO1xuICBpZiAoc3QpIHN0LnN0eWxlLmRpc3BsYXkgPSB0YWJJZCA9PT0gJ3N0YXQnID8gJ2Jsb2NrJyA6ICdub25lJztcbiAgY29uc3QgYnRucyA9IGRvY3VtZW50LnF1ZXJ5U2VsZWN0b3JBbGwoJyNmb3JlY2FzdC10YWJzLWJhciAuZm9yZWNhc3QtdGFiJyk7XG4gIGJ0bnMuZm9yRWFjaCgoYikgPT4ge1xuICAgIGNvbnN0IGFjdGl2ZSA9IGIuZ2V0QXR0cmlidXRlKCdkYXRhLXRhYicpID09PSB0YWJJZDtcbiAgICBiLnN0eWxlLmNvbG9yID0gYWN0aXZlID8gJ3ZhcigtLXRleHQtcHJpbWFyeSknIDogJ3ZhcigtLXRleHQtbXV0ZWQpJztcbiAgICBiLnN0eWxlLmJvcmRlckJvdHRvbUNvbG9yID0gYWN0aXZlID8gJyMwZDk0ODgnIDogJ3RyYW5zcGFyZW50JztcbiAgICBiLnN0eWxlLmZvbnRXZWlnaHQgPSBhY3RpdmUgPyAnNzAwJyA6ICc2MDAnO1xuICB9KTtcbiAgLy8gdjExMDUgZml4OiBhbCBhY3RpdmFyIGxhIHRhYiBzdGF0LCBtb3N0cmFyIHBsYWNlaG9sZGVyIGlubWVkaWF0byBwYXJhXG4gIC8vIHF1ZSBzZSB2ZWEgYWxnbyBtaWVudHJhcyBjYXJnYSAobyBzaSBlbCBsb2FkIHlhIHRlcm1pbm8sIHJlLXJlbmRlcikuXG4gIGlmICh0YWJJZCA9PT0gJ3N0YXQnKSB7XG4gICAgY29uc3QgY29udCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdmb3JlY2FzdC10YWItc3RhdCcpO1xuICAgIGlmIChjb250KSB7XG4gICAgICBpZiAoX2ZvcmVjYXN0U3RhdERvY3MpIHtcbiAgICAgICAgLy8gWWEgY2FyZ2FkbzogcmUtcmVuZGVyIChwb3Igc2kgZWwgdXNlciB2aWVuZSBkZSBvdHJhIHRhYikuXG4gICAgICAgIF9yZW5kZXJGb3JlY2FzdFN0YXRUYWIoKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIC8vIEFcdTAwRkFuIG5vIGNhcmdhZG86IHBsYWNlaG9sZGVyICsgbG9hZC5cbiAgICAgICAgY29udC5pbm5lckhUTUwgPVxuICAgICAgICAgICc8ZGl2IHN0eWxlPVwicGFkZGluZzo2MHB4IDIwcHg7dGV4dC1hbGlnbjpjZW50ZXI7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7Zm9udC1zaXplOjE0cHhcIj4nICtcbiAgICAgICAgICAnPGRpdiBzdHlsZT1cImRpc3BsYXk6aW5saW5lLWJsb2NrO3dpZHRoOjI0cHg7aGVpZ2h0OjI0cHg7Ym9yZGVyOjNweCBzb2xpZCAjMGQ5NDg4O2JvcmRlci10b3AtY29sb3I6dHJhbnNwYXJlbnQ7Ym9yZGVyLXJhZGl1czo1MCU7YW5pbWF0aW9uOnNwaW4gMC44cyBsaW5lYXIgaW5maW5pdGU7bWFyZ2luLWJvdHRvbToxMnB4XCI+PC9kaXY+JyArXG4gICAgICAgICAgJzxkaXY+Q2FyZ2FuZG8gZm9yZWNhc3Rfb3V0cHV0IGRlc2RlIEZpcmVzdG9yZS4uLjwvZGl2PicgK1xuICAgICAgICAgICc8c3R5bGU+QGtleWZyYW1lcyBzcGlue3Rve3RyYW5zZm9ybTpyb3RhdGUoMzYwZGVnKX19PC9zdHlsZT4nICtcbiAgICAgICAgICAnPC9kaXY+JztcbiAgICAgICAgX2xvYWRGb3JlY2FzdE91dHB1dCgpXG4gICAgICAgICAgLnRoZW4oX3JlbmRlckZvcmVjYXN0U3RhdFRhYilcbiAgICAgICAgICAuY2F0Y2goKGUpID0+IHtcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ1tGT1JFQ0FTVCBzdGF0XSBsb2FkIGZhaWwnLCBlKTtcbiAgICAgICAgICAgIGNvbnN0IGMgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZm9yZWNhc3QtdGFiLXN0YXQnKTtcbiAgICAgICAgICAgIGlmIChjKSB7XG4gICAgICAgICAgICAgIGMuaW5uZXJIVE1MID1cbiAgICAgICAgICAgICAgICAnPGRpdiBzdHlsZT1cInBhZGRpbmc6NjBweCAyMHB4O3RleHQtYWxpZ246Y2VudGVyO2NvbG9yOiNkYzI2MjY7bGluZS1oZWlnaHQ6MS42XCI+JyArXG4gICAgICAgICAgICAgICAgJzxkaXYgc3R5bGU9XCJmb250LXNpemU6MTZweDtmb250LXdlaWdodDo3MDA7bWFyZ2luLWJvdHRvbToxMnB4XCI+RXJyb3IgY2FyZ2FuZG8gZm9yZWNhc3Rfb3V0cHV0PC9kaXY+JyArXG4gICAgICAgICAgICAgICAgJzxkaXYgc3R5bGU9XCJmb250LXNpemU6MTJweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTttYXJnaW4tYm90dG9tOjE2cHhcIj4nICtcbiAgICAgICAgICAgICAgICBlc2NhcGVIdG1sU2FmZShlLm1lc3NhZ2UgfHwgU3RyaW5nKGUpKSArXG4gICAgICAgICAgICAgICAgJzwvZGl2PicgK1xuICAgICAgICAgICAgICAgICc8YnV0dG9uIG9uY2xpY2s9XCJzd2l0Y2hGb3JlY2FzdFRhYihcXCdzdGF0XFwnKVwiIHN0eWxlPVwicGFkZGluZzo4cHggMTRweDtiYWNrZ3JvdW5kOiMwZDk0ODg7Y29sb3I6I2ZmZjtib3JkZXI6bm9uZTtib3JkZXItcmFkaXVzOjZweDtmb250LXdlaWdodDo3MDA7Y3Vyc29yOnBvaW50ZXJcIj5SZWludGVudGFyPC9idXR0b24+JyArXG4gICAgICAgICAgICAgICAgJzwvZGl2Pic7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfSk7XG4gICAgICB9XG4gICAgfVxuICB9XG59O1xuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIEZBU0UgMSBcdTIwMTQgU2FsZXMgUGxhbnMgdXBsb2FkIChSb2RzIC8gUmVlbHMgLyBGRylcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5mdW5jdGlvbiBfeWVhck1vbnRoTm93KCkge1xuICBjb25zdCBkID0gbmV3IERhdGUoKTtcbiAgcmV0dXJuIGQuZ2V0RnVsbFllYXIoKSArICctJyArIFN0cmluZyhkLmdldE1vbnRoKCkgKyAxKS5wYWRTdGFydCgyLCAnMCcpO1xufVxuXG5mdW5jdGlvbiBfZm10U2l6ZShieXRlcykge1xuICBpZiAoIWJ5dGVzKSByZXR1cm4gJyc7XG4gIGlmIChieXRlcyA8IDEwMjQpIHJldHVybiBieXRlcyArICcgQic7XG4gIGlmIChieXRlcyA8IDEwMjQgKiAxMDI0KSByZXR1cm4gKGJ5dGVzIC8gMTAyNCkudG9GaXhlZCgxKSArICcgS0InO1xuICByZXR1cm4gKGJ5dGVzIC8gKDEwMjQgKiAxMDI0KSkudG9GaXhlZCgyKSArICcgTUInO1xufVxuXG5mdW5jdGlvbiBfZm10RGF0ZVNob3J0KGlzbykge1xuICBpZiAoIWlzbykgcmV0dXJuICdcdTIwMTQnO1xuICB0cnkge1xuICAgIGNvbnN0IGQgPSBpc28udG9EYXRlID8gaXNvLnRvRGF0ZSgpIDogbmV3IERhdGUoaXNvKTtcbiAgICByZXR1cm4gKFxuICAgICAgZC50b0xvY2FsZURhdGVTdHJpbmcoJ2VzLUFSJywgeyBkYXk6ICcyLWRpZ2l0JywgbW9udGg6ICdzaG9ydCcsIHllYXI6ICcyLWRpZ2l0JyB9KSArXG4gICAgICAnICcgK1xuICAgICAgZC50b0xvY2FsZVRpbWVTdHJpbmcoJ2VzLUFSJywgeyBob3VyOiAnMi1kaWdpdCcsIG1pbnV0ZTogJzItZGlnaXQnIH0pXG4gICAgKTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIFN0cmluZyhpc28pO1xuICB9XG59XG5cbmFzeW5jIGZ1bmN0aW9uIF9sb2FkU2FsZXNQbGFuQ2FjaGVzKCkge1xuICBpZiAoIXdpbmRvdy5mYkRiKSByZXR1cm47XG4gIGF3YWl0IFByb21pc2UuYWxsKFxuICAgIFNBTEVTX1BMQU5fRkFNSUxJQVMubWFwKGFzeW5jIChmKSA9PiB7XG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCBkb2MgPSBhd2FpdCB3aW5kb3cuZmJEYi5jb2xsZWN0aW9uKCdzYWxlc19wbGFuX2NhY2hlJykuZG9jKGYua2V5KS5nZXQoKTtcbiAgICAgICAgX3NhbGVzUGxhbkNhY2hlc1tmLmtleV0gPSBkb2MuZXhpc3RzID8gZG9jLmRhdGEoKSA6IG51bGw7XG4gICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgIGNvbnNvbGUud2FybignW0ZPUkVDQVNUXSBsb2FkIHNhbGVzX3BsYW5fY2FjaGUvJyArIGYua2V5ICsgJyBmYWlsOicsIGUgJiYgZS5tZXNzYWdlKTtcbiAgICAgICAgX3NhbGVzUGxhbkNhY2hlc1tmLmtleV0gPSBudWxsO1xuICAgICAgfVxuICAgIH0pXG4gICk7XG59XG5cbmZ1bmN0aW9uIGVzY2FwZUh0bWxTYWZlKHMpIHtcbiAgaWYgKHR5cGVvZiB3aW5kb3cuZXNjYXBlSHRtbCA9PT0gJ2Z1bmN0aW9uJykgcmV0dXJuIHdpbmRvdy5lc2NhcGVIdG1sKHMpO1xuICByZXR1cm4gU3RyaW5nKHMgPT0gbnVsbCA/ICcnIDogcykucmVwbGFjZShcbiAgICAvWyY8PlwiJ10vZyxcbiAgICAoY2gpID0+ICh7ICcmJzogJyZhbXA7JywgJzwnOiAnJmx0OycsICc+JzogJyZndDsnLCAnXCInOiAnJnF1b3Q7JywgXCInXCI6ICcmIzM5OycgfSlbY2hdXG4gICk7XG59XG5cbmZ1bmN0aW9uIF9idWlsZFNhbGVzUGxhblNsb3RIdG1sKGYpIHtcbiAgY29uc3QgY2FjaGUgPSBfc2FsZXNQbGFuQ2FjaGVzW2Yua2V5XTtcbiAgY29uc3Qgcm93c0NvdW50ID0gY2FjaGUgJiYgTnVtYmVyLmlzRmluaXRlKGNhY2hlLnJvd3NDb3VudCkgPyBjYWNoZS5yb3dzQ291bnQgOiAwO1xuICBjb25zdCBtb250aHNDb3VudCA9XG4gICAgY2FjaGUgJiYgQXJyYXkuaXNBcnJheShjYWNoZS5kZXRlY3RlZE1vbnRocykgPyBjYWNoZS5kZXRlY3RlZE1vbnRocy5sZW5ndGggOiAwO1xuICBjb25zdCBwYXJzZWRBdCA9IGNhY2hlICYmIGNhY2hlLnBhcnNlZEF0ID8gX2ZtdERhdGVTaG9ydChjYWNoZS5wYXJzZWRBdCkgOiAnJztcbiAgY29uc3QgdXBsb2FkZWRCeSA9IGNhY2hlICYmIGNhY2hlLnVwbG9hZGVkQnkgPyBjYWNoZS51cGxvYWRlZEJ5IDogJyc7XG4gIGNvbnN0IHNvdXJjZUZpbGVuYW1lID0gY2FjaGUgJiYgY2FjaGUuc291cmNlRmlsZW5hbWUgPyBjYWNoZS5zb3VyY2VGaWxlbmFtZSA6ICcnO1xuICBjb25zdCB5ZWFyTW9udGggPSBjYWNoZSAmJiBjYWNoZS55ZWFyTW9udGggPyBjYWNoZS55ZWFyTW9udGggOiAnJztcbiAgY29uc3QgbW9udGhzUmFuZ2UgPVxuICAgIGNhY2hlICYmIGNhY2hlLmRldGVjdGVkTW9udGhzICYmIGNhY2hlLmRldGVjdGVkTW9udGhzLmxlbmd0aFxuICAgICAgPyBjYWNoZS5kZXRlY3RlZE1vbnRoc1swXSArICcgXHUyMTkyICcgKyBjYWNoZS5kZXRlY3RlZE1vbnRoc1tjYWNoZS5kZXRlY3RlZE1vbnRocy5sZW5ndGggLSAxXVxuICAgICAgOiAnXHUyMDE0JztcbiAgY29uc3QgaGFzQ2FjaGUgPSAhIWNhY2hlO1xuICBjb25zdCBiYWRnZSA9IGhhc0NhY2hlXG4gICAgPyAnPGRpdiBzdHlsZT1cInBhZGRpbmc6NHB4IDhweDtiYWNrZ3JvdW5kOiMxNmEzNGE7Y29sb3I6I2ZmZjtib3JkZXItcmFkaXVzOjEycHg7Zm9udC1zaXplOjEwcHg7Zm9udC13ZWlnaHQ6NzAwO2xldHRlci1zcGFjaW5nOi40cHhcIj5DQVJHQURPPC9kaXY+J1xuICAgIDogJzxkaXYgc3R5bGU9XCJwYWRkaW5nOjRweCA4cHg7YmFja2dyb3VuZDojZGMyNjI2O2NvbG9yOiNmZmY7Ym9yZGVyLXJhZGl1czoxMnB4O2ZvbnQtc2l6ZToxMHB4O2ZvbnQtd2VpZ2h0OjcwMDtsZXR0ZXItc3BhY2luZzouNHB4XCI+RkFMVEE8L2Rpdj4nO1xuICBjb25zdCBtZXRhQmxvY2sgPSBoYXNDYWNoZVxuICAgID8gJzxkaXYgc3R5bGU9XCJkaXNwbGF5OmdyaWQ7Z3JpZC10ZW1wbGF0ZS1jb2x1bW5zOmF1dG8gMWZyO2dhcDo2cHggMTJweDtmb250LXNpemU6MTFweDtwYWRkaW5nOjEwcHggMTJweDtiYWNrZ3JvdW5kOnZhcigtLWJnLXNlY29uZGFyeSk7Ym9yZGVyLXJhZGl1czo2cHhcIj4nICtcbiAgICAgICc8ZGl2IHN0eWxlPVwiY29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7Zm9udC13ZWlnaHQ6NjAwXCI+QXJjaGl2bzwvZGl2PjxkaXYgc3R5bGU9XCJjb2xvcjp2YXIoLS10ZXh0LXByaW1hcnkpO2ZvbnQtZmFtaWx5Om1vbm9zcGFjZTt3b3JkLWJyZWFrOmJyZWFrLWFsbFwiPicgK1xuICAgICAgZXNjYXBlSHRtbFNhZmUoc291cmNlRmlsZW5hbWUpICtcbiAgICAgICc8L2Rpdj4nICtcbiAgICAgICc8ZGl2IHN0eWxlPVwiY29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7Zm9udC13ZWlnaHQ6NjAwXCI+U3ViaWRvPC9kaXY+PGRpdiBzdHlsZT1cImNvbG9yOnZhcigtLXRleHQtcHJpbWFyeSlcIj4nICtcbiAgICAgIGVzY2FwZUh0bWxTYWZlKHBhcnNlZEF0KSArXG4gICAgICAnPC9kaXY+JyArXG4gICAgICAnPGRpdiBzdHlsZT1cImNvbG9yOnZhcigtLXRleHQtbXV0ZWQpO2ZvbnQtd2VpZ2h0OjYwMFwiPlBvcjwvZGl2PjxkaXYgc3R5bGU9XCJjb2xvcjp2YXIoLS10ZXh0LXByaW1hcnkpXCI+JyArXG4gICAgICBlc2NhcGVIdG1sU2FmZSh1cGxvYWRlZEJ5KSArXG4gICAgICAnPC9kaXY+JyArXG4gICAgICAnPGRpdiBzdHlsZT1cImNvbG9yOnZhcigtLXRleHQtbXV0ZWQpO2ZvbnQtd2VpZ2h0OjYwMFwiPlNuYXBzaG90PC9kaXY+PGRpdiBzdHlsZT1cImNvbG9yOnZhcigtLXRleHQtcHJpbWFyeSk7Zm9udC1mYW1pbHk6bW9ub3NwYWNlXCI+JyArXG4gICAgICBlc2NhcGVIdG1sU2FmZSh5ZWFyTW9udGgpICtcbiAgICAgICc8L2Rpdj4nICtcbiAgICAgICc8ZGl2IHN0eWxlPVwiY29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7Zm9udC13ZWlnaHQ6NjAwXCI+U0tVczwvZGl2PjxkaXYgc3R5bGU9XCJjb2xvcjp2YXIoLS10ZXh0LXByaW1hcnkpO2ZvbnQtd2VpZ2h0OjcwMFwiPicgK1xuICAgICAgcm93c0NvdW50LnRvTG9jYWxlU3RyaW5nKCdlcy1BUicpICtcbiAgICAgICc8L2Rpdj4nICtcbiAgICAgICc8ZGl2IHN0eWxlPVwiY29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7Zm9udC13ZWlnaHQ6NjAwXCI+TWVzZXM8L2Rpdj48ZGl2IHN0eWxlPVwiY29sb3I6dmFyKC0tdGV4dC1wcmltYXJ5KTtmb250LXdlaWdodDo3MDBcIj4nICtcbiAgICAgIG1vbnRoc0NvdW50ICtcbiAgICAgICcgPHNwYW4gc3R5bGU9XCJjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTtmb250LXdlaWdodDo0MDBcIj4oJyArXG4gICAgICBlc2NhcGVIdG1sU2FmZShtb250aHNSYW5nZSkgK1xuICAgICAgJyk8L3NwYW4+PC9kaXY+JyArXG4gICAgICAnPC9kaXY+J1xuICAgIDogJzxkaXYgc3R5bGU9XCJwYWRkaW5nOjE0cHg7dGV4dC1hbGlnbjpjZW50ZXI7Zm9udC1zaXplOjEycHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7YmFja2dyb3VuZDp2YXIoLS1iZy1zZWNvbmRhcnkpO2JvcmRlci1yYWRpdXM6NnB4O2JvcmRlcjoxcHggZGFzaGVkIHZhcigtLWJvcmRlci1zdWJ0bGUpXCI+QXVuIG5vIHN1YmlzdGUgZWwgU2FsZXMgUGxhbiBkZSBlc3RhIGZhbWlsaWEuPC9kaXY+JztcbiAgY29uc3QgdXBsb2FkQnRuID1cbiAgICAnPGxhYmVsIHN0eWxlPVwiZGlzcGxheTppbmxpbmUtZmxleDthbGlnbi1pdGVtczpjZW50ZXI7anVzdGlmeS1jb250ZW50OmNlbnRlcjtnYXA6OHB4O3BhZGRpbmc6MTBweCAxNHB4O2JhY2tncm91bmQ6JyArXG4gICAgZi5jb2xvciArXG4gICAgJztjb2xvcjojZmZmO2JvcmRlci1yYWRpdXM6NnB4O2ZvbnQtd2VpZ2h0OjcwMDtmb250LXNpemU6MTJweDtjdXJzb3I6cG9pbnRlcjtsZXR0ZXItc3BhY2luZzouNHB4XCI+JyArXG4gICAgJzxzcGFuPicgK1xuICAgIChoYXNDYWNoZSA/ICdcdTIxQkIgUmVlbXBsYXphciBFeGNlbCcgOiAnXHUyQjA2IENhcmdhciBFeGNlbCcpICtcbiAgICAnPC9zcGFuPicgK1xuICAgICc8aW5wdXQgdHlwZT1cImZpbGVcIiBhY2NlcHQ9XCIueGxzeCwueGxzXCIgZGF0YS1mYW1pbGlhPVwiJyArXG4gICAgZi5rZXkgK1xuICAgICdcIiBzdHlsZT1cImRpc3BsYXk6bm9uZVwiIG9uY2hhbmdlPVwib25TYWxlc1BsYW5GaWxlRm9yRmFtaWxpYShldmVudCwgXFwnJyArXG4gICAgZi5rZXkgK1xuICAgICdcXCcpXCIvPicgK1xuICAgICc8L2xhYmVsPic7XG4gIGNvbnN0IGNhcmRIZWFkID1cbiAgICAnPGRpdiBzdHlsZT1cImRpc3BsYXk6ZmxleDthbGlnbi1pdGVtczpjZW50ZXI7Z2FwOjEwcHhcIj4nICtcbiAgICAnPGRpdiBzdHlsZT1cIndpZHRoOjEycHg7aGVpZ2h0OjMycHg7YmFja2dyb3VuZDonICtcbiAgICBmLmNvbG9yICtcbiAgICAnO2JvcmRlci1yYWRpdXM6M3B4XCI+PC9kaXY+JyArXG4gICAgJzxkaXYgc3R5bGU9XCJmbGV4OjFcIj48ZGl2IHN0eWxlPVwiZm9udC1zaXplOjE0cHg7Zm9udC13ZWlnaHQ6ODAwO2NvbG9yOnZhcigtLXRleHQtcHJpbWFyeSlcIj4nICtcbiAgICBlc2NhcGVIdG1sU2FmZShmLmxhYmVsKSArXG4gICAgJzwvZGl2PicgK1xuICAgICc8ZGl2IHN0eWxlPVwiZm9udC1zaXplOjExcHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7bWFyZ2luLXRvcDoycHhcIj5TYWxlcyBQbGFuIG1lbnN1YWwgXHUwMEI3IEhvamEgU0FSPC9kaXY+PC9kaXY+JyArXG4gICAgYmFkZ2UgK1xuICAgICc8L2Rpdj4nO1xuICByZXR1cm4gKFxuICAgICc8ZGl2IHN0eWxlPVwiYmFja2dyb3VuZDp2YXIoLS1iZy1lbGV2YXRlZCk7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1ib3JkZXItc3VidGxlKTtib3JkZXItcmFkaXVzOjEwcHg7cGFkZGluZzoxNnB4O2Rpc3BsYXk6ZmxleDtmbGV4LWRpcmVjdGlvbjpjb2x1bW47Z2FwOjEycHhcIj4nICtcbiAgICBjYXJkSGVhZCArXG4gICAgbWV0YUJsb2NrICtcbiAgICB1cGxvYWRCdG4gK1xuICAgICc8ZGl2IGlkPVwic2FsZXMtcGxhbi1zdGF0dXMtJyArXG4gICAgZi5rZXkgK1xuICAgICdcIiBzdHlsZT1cImZvbnQtc2l6ZToxMXB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO21pbi1oZWlnaHQ6MTRweFwiPjwvZGl2PicgK1xuICAgICc8L2Rpdj4nXG4gICk7XG59XG5cbmZ1bmN0aW9uIF9yZW5kZXJTYWxlc1BsYW5zVGFiKCkge1xuICBjb25zdCBjb250ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2ZvcmVjYXN0LXRhYi1zYWxlcy1wbGFucycpO1xuICBpZiAoIWNvbnQpIHJldHVybjtcbiAgY29uc3Qgc2xvdHMgPSBTQUxFU19QTEFOX0ZBTUlMSUFTLm1hcChfYnVpbGRTYWxlc1BsYW5TbG90SHRtbCkuam9pbignJyk7XG4gIGNvbnN0IGludHJvID1cbiAgICAnPGRpdiBzdHlsZT1cIm1hcmdpbi1ib3R0b206MTZweDtwYWRkaW5nOjEycHggMTRweDtiYWNrZ3JvdW5kOnZhcigtLWJnLXNlY29uZGFyeSk7Ym9yZGVyLWxlZnQ6M3B4IHNvbGlkICMwZDk0ODg7Ym9yZGVyLXJhZGl1czo2cHg7Zm9udC1zaXplOjEycHg7Y29sb3I6dmFyKC0tdGV4dC1zZWNvbmRhcnkpO2xpbmUtaGVpZ2h0OjEuNVwiPicgK1xuICAgICc8YiBzdHlsZT1cImNvbG9yOnZhcigtLXRleHQtcHJpbWFyeSlcIj5GYXNlIDE8L2I+IFx1MjAxNCBDYXJnXHUwMEUxIGxvcyBTYWxlcyBQbGFucyBtZW5zdWFsZXMgKFJvZHMgLyBSZWVscykuIFNlIHBhcnNlYSBsYSBob2phIDxiPlNBUjwvYj46IFNLVSwgTU9RIDEyIG1vbnRocywgeSB1bmEgY29sdW1uYSBwb3IgbWVzLiAnICtcbiAgICAnRWwgRXhjZWwgb3JpZ2luYWwgcXVlZGEgc25hcHNob3RhZG8gZW4gU3RvcmFnZSB5IGVsIHBhcnNlbyBxdWVkYSBlbiBGaXJlc3RvcmUgcGFyYSBlbCBjXHUwMEUxbGN1bG8gZGViYWpvLicgK1xuICAgICc8L2Rpdj4nO1xuICBjb25zdCBncmlkID1cbiAgICAnPGRpdiBzdHlsZT1cImRpc3BsYXk6Z3JpZDtncmlkLXRlbXBsYXRlLWNvbHVtbnM6cmVwZWF0KGF1dG8tZml0LG1pbm1heCgzMjBweCwxZnIpKTtnYXA6MTZweDttYXJnaW4tYm90dG9tOjI0cHhcIj4nICtcbiAgICBzbG90cyArXG4gICAgJzwvZGl2Pic7XG4gIC8vIHYxMTA5OiBjb250ZW5lZG9yIHBhcmEgdGFibGEgUmVjb21lbmRhY2lcdTAwRjNuIGRlIENvbXByYS4gU2UgcmVsbGVuYSBvbi1kZW1hbmRcbiAgLy8gdmlhIF9yZW5kZXJSZWNvU2VjdGlvbigpIChsYXp5IGxvYWQgZGUgc3RvY2tfc25hcHNob3QgKyBza3VfdmVudGFzX3NuYXBzaG90KS5cbiAgY29uc3QgcmVjb1NlY3Rpb24gPSAnPGRpdiBpZD1cInJlY28tc2VjdGlvbi1jb250YWluZXJcIj48L2Rpdj4nO1xuICBjb250LmlubmVySFRNTCA9ICc8ZGl2IHN0eWxlPVwicGFkZGluZzoxOHB4XCI+JyArIGludHJvICsgZ3JpZCArIHJlY29TZWN0aW9uICsgJzwvZGl2Pic7XG4gIF9yZW5kZXJSZWNvU2VjdGlvbigpO1xufVxuXG53aW5kb3cub25TYWxlc1BsYW5GaWxlRm9yRmFtaWxpYSA9IGFzeW5jIGZ1bmN0aW9uIChldmVudCwgZmFtaWxpYSkge1xuICBjb25zdCBmaWxlID0gZXZlbnQgJiYgZXZlbnQudGFyZ2V0ICYmIGV2ZW50LnRhcmdldC5maWxlcyAmJiBldmVudC50YXJnZXQuZmlsZXNbMF07XG4gIGlmICghZmlsZSkgcmV0dXJuO1xuICBjb25zdCBzdGF0dXNFbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdzYWxlcy1wbGFuLXN0YXR1cy0nICsgZmFtaWxpYSk7XG4gIGNvbnN0IHNldFN0YXR1cyA9IChtc2csIGNvbG9yKSA9PiB7XG4gICAgaWYgKCFzdGF0dXNFbCkgcmV0dXJuO1xuICAgIHN0YXR1c0VsLnRleHRDb250ZW50ID0gbXNnO1xuICAgIHN0YXR1c0VsLnN0eWxlLmNvbG9yID0gY29sb3IgfHwgJ3ZhcigtLXRleHQtbXV0ZWQpJztcbiAgfTtcbiAgdHJ5IHtcbiAgICBpZiAodHlwZW9mIFhMU1ggPT09ICd1bmRlZmluZWQnKSB7XG4gICAgICBhbGVydCgnU2hlZXRKUyAoWExTWCkgbm8gY2FyZ2FkbyBcdTIwMTQgcmVjYXJnXHUwMEUxIGxhIGFwcC4nKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgaWYgKCF3aW5kb3cuU2FsZXNQbGFuUGFyc2VyIHx8ICF3aW5kb3cuU2FsZXNQbGFuUGFyc2VyLnBhcnNlU2FsZXNQbGFuU2hlZXQpIHtcbiAgICAgIGFsZXJ0KCdQYXJzZXIgU2FsZXMgUGxhbiBubyBjYXJnYWRvLiBSZWJ1aWxkIGJ1bmRsZS4nKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgaWYgKCF3aW5kb3cuZmlyZWJhc2UgfHwgIXdpbmRvdy5maXJlYmFzZS5zdG9yYWdlKSB7XG4gICAgICBhbGVydCgnRmlyZWJhc2UgU3RvcmFnZSBubyBkaXNwb25pYmxlLicpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBzZXRTdGF0dXMoJ0xleWVuZG8gRXhjZWxcdTIwMjYnKTtcbiAgICBjb25zdCBidWYgPSBhd2FpdCBmaWxlLmFycmF5QnVmZmVyKCk7XG4gICAgY29uc3Qgd2IgPSBYTFNYLnJlYWQoYnVmLCB7IHR5cGU6ICdhcnJheScgfSk7XG4gICAgY29uc3Qgc2FyTmFtZSA9IHdiLlNoZWV0TmFtZXMuZmluZChcbiAgICAgIChuKSA9PlxuICAgICAgICBTdHJpbmcobiB8fCAnJylcbiAgICAgICAgICAudHJpbSgpXG4gICAgICAgICAgLnRvVXBwZXJDYXNlKCkgPT09ICdTQVInXG4gICAgKTtcbiAgICBpZiAoIXNhck5hbWUpIHtcbiAgICAgIHNldFN0YXR1cyhcbiAgICAgICAgJ1x1MjZBMCBFbCBFeGNlbCBubyB0aWVuZSBob2phIFwiU0FSXCIuIEhvamFzIGVuY29udHJhZGFzOiAnICsgd2IuU2hlZXROYW1lcy5qb2luKCcsICcpLFxuICAgICAgICAnI2RjMjYyNidcbiAgICAgICk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGNvbnN0IHNoZWV0ID0gd2IuU2hlZXRzW3Nhck5hbWVdO1xuICAgIGNvbnN0IHJvd3MgPSBYTFNYLnV0aWxzLnNoZWV0X3RvX2pzb24oc2hlZXQsIHsgaGVhZGVyOiAxLCBkZWZ2YWw6ICcnLCByYXc6IHRydWUgfSk7XG4gICAgc2V0U3RhdHVzKCdQYXJzZWFuZG8gJyArIHJvd3MubGVuZ3RoICsgJyBmaWxhcyBkZSBob2phIFwiJyArIHNhck5hbWUgKyAnXCJcdTIwMjYnKTtcbiAgICBjb25zdCBwYXJzZWQgPSB3aW5kb3cuU2FsZXNQbGFuUGFyc2VyLnBhcnNlU2FsZXNQbGFuU2hlZXQocm93cyk7XG4gICAgaWYgKCFwYXJzZWQucm93cy5sZW5ndGgpIHtcbiAgICAgIHNldFN0YXR1cygnXHUyNkEwIEV4Y2VsIHBhcnNlYWRvIHBlcm8gc2luIFNLVXMgdlx1MDBFMWxpZG9zLicsICcjZGMyNjI2Jyk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGNvbnN0IHllYXJNb250aCA9IF95ZWFyTW9udGhOb3coKTtcbiAgICBjb25zdCBzdG9yYWdlUGF0aCA9ICdmb3JlY2FzdHNfc25hcHNob3RzLycgKyB5ZWFyTW9udGggKyAnLycgKyBmYW1pbGlhICsgJy54bHN4JztcbiAgICBzZXRTdGF0dXMoJ1N1YmllbmRvIEV4Y2VsIGEgU3RvcmFnZSAoJyArIF9mbXRTaXplKGZpbGUuc2l6ZSkgKyAnKVx1MjAyNicpO1xuICAgIGNvbnN0IHN0b3JhZ2VSZWYgPSB3aW5kb3cuZmlyZWJhc2Uuc3RvcmFnZSgpLnJlZihzdG9yYWdlUGF0aCk7XG4gICAgYXdhaXQgc3RvcmFnZVJlZi5wdXQoZmlsZSwge1xuICAgICAgY29udGVudFR5cGU6IGZpbGUudHlwZSB8fCAnYXBwbGljYXRpb24vdm5kLm9wZW54bWxmb3JtYXRzLW9mZmljZWRvY3VtZW50LnNwcmVhZHNoZWV0bWwuc2hlZXQnLFxuICAgICAgY3VzdG9tTWV0YWRhdGE6IHtcbiAgICAgICAgZmFtaWxpYSxcbiAgICAgICAgdXBsb2FkZWRCeTogKHdpbmRvdy5jdXJyZW50VXNlciAmJiB3aW5kb3cuY3VycmVudFVzZXIuZW1haWwpIHx8ICcnLFxuICAgICAgICBzb3VyY2VGaWxlbmFtZTogZmlsZS5uYW1lIHx8ICcnLFxuICAgICAgfSxcbiAgICB9KTtcbiAgICBzZXRTdGF0dXMoJ0d1YXJkYW5kbyBwYXJzZW8gZW4gRmlyZXN0b3JlICgnICsgcGFyc2VkLnJvd3MubGVuZ3RoICsgJyBTS1VzKVx1MjAyNicpO1xuICAgIGNvbnN0IHVwbG9hZGVkQnkgPSAod2luZG93LmN1cnJlbnRVc2VyICYmIHdpbmRvdy5jdXJyZW50VXNlci5lbWFpbCkgfHwgJ3Vua25vd24nO1xuICAgIGNvbnN0IHBheWxvYWQgPSB7XG4gICAgICBmYW1pbGlhLFxuICAgICAgcGFyc2VkQXQ6XG4gICAgICAgIHdpbmRvdy5maXJlYmFzZSAmJiB3aW5kb3cuZmlyZWJhc2UuZmlyZXN0b3JlICYmIHdpbmRvdy5maXJlYmFzZS5maXJlc3RvcmUuRmllbGRWYWx1ZVxuICAgICAgICAgID8gd2luZG93LmZpcmViYXNlLmZpcmVzdG9yZS5GaWVsZFZhbHVlLnNlcnZlclRpbWVzdGFtcCgpXG4gICAgICAgICAgOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICB1cGxvYWRlZEJ5LFxuICAgICAgc291cmNlRmlsZW5hbWU6IGZpbGUubmFtZSB8fCAnJyxcbiAgICAgIHNvdXJjZVNoZWV0OiBzYXJOYW1lLFxuICAgICAgeWVhck1vbnRoLFxuICAgICAgc3RvcmFnZVBhdGgsXG4gICAgICByb3dzQ291bnQ6IHBhcnNlZC5yb3dzLmxlbmd0aCxcbiAgICAgIGhlYWRlclJvd0luZGV4OiBwYXJzZWQuaGVhZGVyUm93SW5kZXgsXG4gICAgICBkZXRlY3RlZE1vbnRoczogcGFyc2VkLmRldGVjdGVkTW9udGhzLFxuICAgICAgcm93czogcGFyc2VkLnJvd3MsXG4gICAgfTtcbiAgICBhd2FpdCB3aW5kb3cuZmJEYi5jb2xsZWN0aW9uKCdzYWxlc19wbGFuX2NhY2hlJykuZG9jKGZhbWlsaWEpLnNldChwYXlsb2FkKTtcbiAgICAvLyB2MTEwNyBmaXg6IGd1YXJkYXIgY2FjaGUgbG9jYWwgY29uIERhdGUgcmVhbCAobm8gZWwgU2VudGluZWxWYWx1ZSkgcGFyYVxuICAgIC8vIHF1ZSBfZm10RGF0ZVNob3J0IG5vIG11ZXN0cmUgXCJJbnZhbGlkIERhdGVcIi4gRWwgc2VydmVyIHRpZW5lIGVsIHRzIGV4YWN0byxcbiAgICAvLyBlbCBsb2NhbCBtdWVzdHJhIGVsIG1vbWVudG8gZGVsIHVwbG9hZCAoYXByb3hpbWFkbyB+MXMgZGUgZGlmZXJlbmNpYSkuXG4gICAgX3NhbGVzUGxhbkNhY2hlc1tmYW1pbGlhXSA9IE9iamVjdC5hc3NpZ24oe30sIHBheWxvYWQsIHsgcGFyc2VkQXQ6IG5ldyBEYXRlKCkgfSk7XG4gICAgc2V0U3RhdHVzKFxuICAgICAgJ1x1MjcxMyBPSy4gJyArIHBhcnNlZC5yb3dzLmxlbmd0aCArICcgU0tVcyBcdTAwRDcgJyArIHBhcnNlZC5kZXRlY3RlZE1vbnRocy5sZW5ndGggKyAnIG1lc2VzLicsXG4gICAgICAnIzE2YTM0YSdcbiAgICApO1xuICAgIF9yZW5kZXJTYWxlc1BsYW5zVGFiKCk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBjb25zb2xlLmVycm9yKCdbRk9SRUNBU1RdIHVwbG9hZCBzYWxlcyBwbGFuICcgKyBmYW1pbGlhICsgJyBmYWlsOicsIGUpO1xuICAgIHNldFN0YXR1cygnXHUyNzE3IEVycm9yOiAnICsgKChlICYmIGUubWVzc2FnZSkgfHwgZSksICcjZGMyNjI2Jyk7XG4gICAgaWYgKGUgJiYgZS5jb2RlID09PSAnTU9OVEhTX05PVF9GT1VORCcpIHtcbiAgICAgIGFsZXJ0KFxuICAgICAgICAnRWwgRXhjZWwgbm8gdGllbmUgY29sdW1uYXMgZGUgbWVzZXMgcmVjb25vY2libGVzLlxcblxcbkhlYWRlcnMgZXNwZXJhZG9zOiBcIkphbiAyMDI3XCIsIFwiTWF5IDIwMjdcIiwgXCJFbmUgMjAyN1wiLCBcIjIwMjctMDFcIiwgZXRjLlxcblxcbkRldGFsbGU6ICcgK1xuICAgICAgICAgIGUubWVzc2FnZVxuICAgICAgKTtcbiAgICB9XG4gIH0gZmluYWxseSB7XG4gICAgaWYgKGV2ZW50ICYmIGV2ZW50LnRhcmdldCkgZXZlbnQudGFyZ2V0LnZhbHVlID0gJyc7XG4gIH1cbn07XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gRjJCIFx1MjAxNCBGb3JlY2FzdCBFc3RhZFx1MDBFRHN0aWNvOiB0YWJsYSArIGRldGFsbGVcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5hc3luYyBmdW5jdGlvbiBfbG9hZEZvcmVjYXN0T3V0cHV0KCkge1xuICBpZiAoIXdpbmRvdy5mYkRiKSB0aHJvdyBuZXcgRXJyb3IoJ0ZpcmVzdG9yZSBubyBpbmljaWFsaXphZG8nKTtcbiAgY29uc29sZS5sb2coJ1tGT1JFQ0FTVCBzdGF0XSBsb2FkaW5nIGZvcmVjYXN0X291dHB1dC4uLicpO1xuICBjb25zdCBbc25hcCwgbWV0YURvY10gPSBhd2FpdCBQcm9taXNlLmFsbChbXG4gICAgd2luZG93LmZiRGIuY29sbGVjdGlvbignZm9yZWNhc3Rfb3V0cHV0JykuZ2V0KCksXG4gICAgd2luZG93LmZiRGIuY29sbGVjdGlvbignZm9yZWNhc3Rfb3V0cHV0X21ldGEnKS5kb2MoJ2N1cnJlbnQnKS5nZXQoKSxcbiAgXSk7XG4gIGNvbnN0IGRvY3MgPSBbXTtcbiAgc25hcC5mb3JFYWNoKChkKSA9PiBkb2NzLnB1c2goT2JqZWN0LmFzc2lnbih7IGlkOiBkLmlkIH0sIGQuZGF0YSgpKSkpO1xuICBkb2NzLnNvcnQoKGEsIGIpID0+IHtcbiAgICBjb25zdCB3YSA9IChhLm1ldHJpY3MgJiYgYS5tZXRyaWNzLndhcGUpIHx8IDk5OTtcbiAgICBjb25zdCB3YiA9IChiLm1ldHJpY3MgJiYgYi5tZXRyaWNzLndhcGUpIHx8IDk5OTtcbiAgICByZXR1cm4gd2EgLSB3YjtcbiAgfSk7XG4gIF9mb3JlY2FzdFN0YXREb2NzID0gZG9jcztcbiAgX2ZvcmVjYXN0U3RhdE1ldGEgPSBtZXRhRG9jLmV4aXN0cyA/IG1ldGFEb2MuZGF0YSgpIDogbnVsbDtcbiAgY29uc29sZS5sb2coJ1tGT1JFQ0FTVCBzdGF0XSBsb2FkZWQnLCBkb2NzLmxlbmd0aCwgJ2RvY3MgXHUwMEI3IG1ldGE6JywgISFfZm9yZWNhc3RTdGF0TWV0YSk7XG4gIHJldHVybiBkb2NzO1xufVxuXG5mdW5jdGlvbiBfd2FwZUJhZGdlQ29sb3Iodykge1xuICBpZiAodyA9PSBudWxsKSByZXR1cm4gJyM2NDc0OGInO1xuICBpZiAodyA8IDAuMykgcmV0dXJuICcjMTZhMzRhJzsgLy8gdmVyZGUgLSBleGNlbGVudGVcbiAgaWYgKHcgPCAwLjUpIHJldHVybiAnIzg0Y2MxNic7IC8vIGxpbWEgLSBidWVub1xuICBpZiAodyA8IDAuNykgcmV0dXJuICcjZWFiMzA4JzsgLy8gYW1hcmlsbG8gLSBhY2VwdGFibGVcbiAgaWYgKHcgPCAxLjApIHJldHVybiAnI2Y5NzMxNic7IC8vIG5hcmFuamEgLSBwb2JyZVxuICByZXR1cm4gJyNkYzI2MjYnOyAvLyByb2pvIC0gbXV5IHBvYnJlXG59XG5cbmZ1bmN0aW9uIF9mbXROdW0obikge1xuICBpZiAobiA9PSBudWxsIHx8ICFOdW1iZXIuaXNGaW5pdGUoTnVtYmVyKG4pKSkgcmV0dXJuICdcdTIwMTQnO1xuICByZXR1cm4gTnVtYmVyKG4pLnRvTG9jYWxlU3RyaW5nKCdlcy1BUicsIHsgbWF4aW11bUZyYWN0aW9uRGlnaXRzOiAwIH0pO1xufVxuXG5mdW5jdGlvbiBfZm10V2FwZSh3KSB7XG4gIGlmICh3ID09IG51bGwgfHwgIU51bWJlci5pc0Zpbml0ZShOdW1iZXIodykpKSByZXR1cm4gJ1x1MjAxNCc7XG4gIHJldHVybiAoTnVtYmVyKHcpICogMTAwKS50b0ZpeGVkKDApICsgJyUnO1xufVxuXG5mdW5jdGlvbiBfZm10RHNTaG9ydChpc28pIHtcbiAgLy8gJzIwMjYtMTAtMDEnIC0+ICdvY3QgMjYnXG4gIHRyeSB7XG4gICAgY29uc3QgW3ksIG1dID0gaXNvLnNwbGl0KCctJykubWFwKE51bWJlcik7XG4gICAgY29uc3QgbmFtZXMgPSBbXG4gICAgICAnZW5lJyxcbiAgICAgICdmZWInLFxuICAgICAgJ21hcicsXG4gICAgICAnYWJyJyxcbiAgICAgICdtYXknLFxuICAgICAgJ2p1bicsXG4gICAgICAnanVsJyxcbiAgICAgICdhZ28nLFxuICAgICAgJ3NlcCcsXG4gICAgICAnb2N0JyxcbiAgICAgICdub3YnLFxuICAgICAgJ2RpYycsXG4gICAgXTtcbiAgICByZXR1cm4gbmFtZXNbbSAtIDFdICsgJyAnICsgU3RyaW5nKHkpLnNsaWNlKC0yKTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIGlzbztcbiAgfVxufVxuXG5mdW5jdGlvbiBfcmVuZGVyRm9yZWNhc3RTdGF0VGFiKCkge1xuICBjb25zdCBjb250ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2ZvcmVjYXN0LXRhYi1zdGF0Jyk7XG4gIGlmICghY29udCkgcmV0dXJuO1xuICB0cnkge1xuICAgIF9yZW5kZXJGb3JlY2FzdFN0YXRUYWJJbXBsKGNvbnQpO1xuICB9IGNhdGNoIChlKSB7XG4gICAgY29uc29sZS5lcnJvcignW0ZPUkVDQVNUIHN0YXRdIHJlbmRlciBmYWlsJywgZSk7XG4gICAgY29udC5pbm5lckhUTUwgPVxuICAgICAgJzxkaXYgc3R5bGU9XCJwYWRkaW5nOjQwcHggMjBweDtjb2xvcjojZGMyNjI2O2xpbmUtaGVpZ2h0OjEuNlwiPicgK1xuICAgICAgJzxkaXYgc3R5bGU9XCJmb250LXNpemU6MTZweDtmb250LXdlaWdodDo3MDA7bWFyZ2luLWJvdHRvbToxMHB4XCI+RXJyb3IgcmVuZGVyaXphbmRvIHRhYiBGb3JlY2FzdCBFc3RhZFx1MDBFRHN0aWNvPC9kaXY+JyArXG4gICAgICAnPHByZSBzdHlsZT1cImZvbnQtc2l6ZToxMXB4O2JhY2tncm91bmQ6I2ZlZjJmMjtwYWRkaW5nOjEycHg7Ym9yZGVyLXJhZGl1czo2cHg7b3ZlcmZsb3c6YXV0bzt3aGl0ZS1zcGFjZTpwcmUtd3JhcFwiPicgK1xuICAgICAgZXNjYXBlSHRtbFNhZmUoZS5zdGFjayB8fCBlLm1lc3NhZ2UgfHwgU3RyaW5nKGUpKSArXG4gICAgICAnPC9wcmU+PC9kaXY+JztcbiAgfVxufVxuXG5mdW5jdGlvbiBfcmVuZGVyRm9yZWNhc3RTdGF0VGFiSW1wbChjb250KSB7XG4gIGNvbnN0IGRvY3MgPSBfZm9yZWNhc3RTdGF0RG9jcyB8fCBbXTtcbiAgY29uc3QgbWV0YSA9IF9mb3JlY2FzdFN0YXRNZXRhIHx8IHt9O1xuICBjb25zdCByZXN1bWVuID0gbWV0YS5yZXN1bWVuIHx8IHt9O1xuICBjb25zb2xlLmxvZygnW0ZPUkVDQVNUIHN0YXRdIHJlbmRlciBcdTIwMTQgZG9jczonLCBkb2NzLmxlbmd0aCwgJ21ldGE6JywgISFtZXRhLmdlbmVyYXRlZEF0KTtcbiAgaWYgKCFkb2NzLmxlbmd0aCkge1xuICAgIGNvbnQuaW5uZXJIVE1MID1cbiAgICAgICc8ZGl2IHN0eWxlPVwicGFkZGluZzo2MHB4IDIwcHg7dGV4dC1hbGlnbjpjZW50ZXI7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZClcIj4nICtcbiAgICAgICdObyBoYXkgZm9yZWNhc3Rfb3V0cHV0IHB1YmxpY2Fkby48YnI+PGJyPicgK1xuICAgICAgJ0NvcnJlciA8Y29kZT5weXRob24gc2NyaXB0cy9mb3JlY2FzdC90cmFpbl9wcm9kLnB5ICYmIHB5dGhvbiBzY3JpcHRzL2ZvcmVjYXN0L3B1Ymxpc2hfdG9fZmlyZXN0b3JlLnB5PC9jb2RlPi4nICtcbiAgICAgICc8L2Rpdj4nO1xuICAgIHJldHVybjtcbiAgfVxuICAvLyBNZXNlcyBkZWwgZm9yZWNhc3QgKGRzIGRlbCBwcmltZXIgZG9jLCBzZSBhc3VtZSBpZ3VhbCBlbiB0b2RvcykuXG4gIGNvbnN0IG1vbnRoc0lzbyA9IChkb2NzWzBdLmZvcmVjYXN0IHx8IFtdKS5tYXAoKGYpID0+IGYuZHMpO1xuICBjb25zdCBtb250aEhlYWRlcnMgPSBtb250aHNJc28ubWFwKF9mbXREc1Nob3J0KTtcblxuICAvLyBNZXRyaWNzIGNoaXAgZ2xvYmFsXG4gIGNvbnN0IGdlbmVyYXRlZCA9IG1ldGEuZ2VuZXJhdGVkQXRcbiAgICA/IG5ldyBEYXRlKG1ldGEuZ2VuZXJhdGVkQXQpLnRvTG9jYWxlU3RyaW5nKCdlcy1BUicsIHtcbiAgICAgICAgZGF5OiAnMi1kaWdpdCcsXG4gICAgICAgIG1vbnRoOiAnc2hvcnQnLFxuICAgICAgICB5ZWFyOiAnMi1kaWdpdCcsXG4gICAgICAgIGhvdXI6ICcyLWRpZ2l0JyxcbiAgICAgICAgbWludXRlOiAnMi1kaWdpdCcsXG4gICAgICB9KVxuICAgIDogJ1x1MjAxNCc7XG4gIGNvbnN0IHdhcGVNZWQgPVxuICAgIHJlc3VtZW4ud2FwZV9tZWRpYW5vX2Jlc3RfcGVyX3NlcmllcyAhPSBudWxsXG4gICAgICA/IF9mbXRXYXBlKHJlc3VtZW4ud2FwZV9tZWRpYW5vX2Jlc3RfcGVyX3NlcmllcylcbiAgICAgIDogJ1x1MjAxNCc7XG4gIGNvbnN0IG5TdWJzID0gcmVzdW1lbi5uX3N1YmZhbWlsaWFzIHx8IGRvY3MubGVuZ3RoO1xuICBjb25zdCBuTHQwNSA9XG4gICAgcmVzdW1lbi5uX3Nlcmllc193YXBlX2x0XzBfNSAhPSBudWxsID8gcmVzdW1lbi5uX3Nlcmllc193YXBlX2x0XzBfNSArICcvJyArIG5TdWJzIDogJ1x1MjAxNCc7XG4gIGNvbnN0IG5MdDAzID1cbiAgICByZXN1bWVuLm5fc2VyaWVzX3dhcGVfbHRfMF8zICE9IG51bGwgPyByZXN1bWVuLm5fc2VyaWVzX3dhcGVfbHRfMF8zICsgJy8nICsgblN1YnMgOiAnXHUyMDE0JztcblxuICBjb25zdCBiYW5uZXIgPVxuICAgICc8ZGl2IHN0eWxlPVwibWFyZ2luLWJvdHRvbToxNHB4O3BhZGRpbmc6MTJweCAxNHB4O2JhY2tncm91bmQ6dmFyKC0tYmctc2Vjb25kYXJ5KTtib3JkZXItbGVmdDozcHggc29saWQgIzBkOTQ4ODtib3JkZXItcmFkaXVzOjZweDtmb250LXNpemU6MTJweDtjb2xvcjp2YXIoLS10ZXh0LXNlY29uZGFyeSk7bGluZS1oZWlnaHQ6MS41O2Rpc3BsYXk6Z3JpZDtncmlkLXRlbXBsYXRlLWNvbHVtbnM6cmVwZWF0KGF1dG8tZml0LG1pbm1heCgxNjBweCwxZnIpKTtnYXA6MTBweFwiPicgK1xuICAgICc8ZGl2PjxkaXYgc3R5bGU9XCJmb250LXNpemU6MTBweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7bGV0dGVyLXNwYWNpbmc6LjRweFwiPldBUEUgbWVkaWFubzwvZGl2PjxkaXYgc3R5bGU9XCJmb250LXNpemU6MjBweDtmb250LXdlaWdodDo4MDA7Y29sb3I6dmFyKC0tdGV4dC1wcmltYXJ5KVwiPicgK1xuICAgIHdhcGVNZWQgK1xuICAgICc8L2Rpdj48L2Rpdj4nICtcbiAgICAnPGRpdj48ZGl2IHN0eWxlPVwiZm9udC1zaXplOjEwcHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO2xldHRlci1zcGFjaW5nOi40cHhcIj5TdWJmYW1pbGlhczwvZGl2PjxkaXYgc3R5bGU9XCJmb250LXNpemU6MjBweDtmb250LXdlaWdodDo4MDA7Y29sb3I6dmFyKC0tdGV4dC1wcmltYXJ5KVwiPicgK1xuICAgIG5TdWJzICtcbiAgICAnPC9kaXY+PC9kaXY+JyArXG4gICAgJzxkaXY+PGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMHB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtsZXR0ZXItc3BhY2luZzouNHB4XCI+V0FQRSAmbHQ7IDMwJSAoZXhjZWxlbnRlKTwvZGl2PjxkaXYgc3R5bGU9XCJmb250LXNpemU6MjBweDtmb250LXdlaWdodDo4MDA7Y29sb3I6IzE2YTM0YVwiPicgK1xuICAgIG5MdDAzICtcbiAgICAnPC9kaXY+PC9kaXY+JyArXG4gICAgJzxkaXY+PGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMHB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtsZXR0ZXItc3BhY2luZzouNHB4XCI+V0FQRSAmbHQ7IDUwJSAoYnVlbm8pPC9kaXY+PGRpdiBzdHlsZT1cImZvbnQtc2l6ZToyMHB4O2ZvbnQtd2VpZ2h0OjgwMDtjb2xvcjojODRjYzE2XCI+JyArXG4gICAgbkx0MDUgK1xuICAgICc8L2Rpdj48L2Rpdj4nICtcbiAgICAnPGRpdj48ZGl2IHN0eWxlPVwiZm9udC1zaXplOjEwcHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO2xldHRlci1zcGFjaW5nOi40cHhcIj5cdTAwREFsdGltYSBjb3JyaWRhPC9kaXY+PGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxM3B4O2ZvbnQtd2VpZ2h0OjYwMDtjb2xvcjp2YXIoLS10ZXh0LXByaW1hcnkpO21hcmdpbi10b3A6NHB4XCI+JyArXG4gICAgZXNjYXBlSHRtbFNhZmUoZ2VuZXJhdGVkKSArXG4gICAgJzwvZGl2PjwvZGl2PicgK1xuICAgICc8L2Rpdj4nO1xuXG4gIC8vIFRhYmxhIHJvd3NcbiAgY29uc3Qgcm93c0h0bWwgPSBkb2NzXG4gICAgLm1hcCgoZCkgPT4ge1xuICAgICAgY29uc3Qgd2FwZSA9IGQubWV0cmljcyAmJiBkLm1ldHJpY3Mud2FwZSAhPSBudWxsID8gZC5tZXRyaWNzLndhcGUgOiBudWxsO1xuICAgICAgY29uc3QgYmVzdE1vZGVsID0gZC5iZXN0TW9kZWwgfHwgJ1x1MjAxNCc7XG4gICAgICBjb25zdCBmb3JlY2FzdE1hcCA9IHt9O1xuICAgICAgKGQuZm9yZWNhc3QgfHwgW10pLmZvckVhY2goKGYpID0+IHtcbiAgICAgICAgZm9yZWNhc3RNYXBbZi5kc10gPSBmLnlfaGF0O1xuICAgICAgfSk7XG4gICAgICBjb25zdCBtb250aENlbGxzID0gbW9udGhzSXNvXG4gICAgICAgIC5tYXAoXG4gICAgICAgICAgKGRzKSA9PlxuICAgICAgICAgICAgJzx0ZCBzdHlsZT1cInBhZGRpbmc6OHB4IDEwcHg7dGV4dC1hbGlnbjpyaWdodDtmb250LXZhcmlhbnQtbnVtZXJpYzp0YWJ1bGFyLW51bXM7Zm9udC13ZWlnaHQ6NjAwO2NvbG9yOnZhcigtLXRleHQtcHJpbWFyeSlcIj4nICtcbiAgICAgICAgICAgIF9mbXROdW0oZm9yZWNhc3RNYXBbZHNdKSArXG4gICAgICAgICAgICAnPC90ZD4nXG4gICAgICAgIClcbiAgICAgICAgLmpvaW4oJycpO1xuICAgICAgY29uc3QgdG90YWw3ID0gKGQuZm9yZWNhc3QgfHwgW10pLnJlZHVjZSgocywgZikgPT4gcyArIChOdW1iZXIoZi55X2hhdCkgfHwgMCksIDApO1xuICAgICAgcmV0dXJuIChcbiAgICAgICAgJzx0ciBvbmNsaWNrPVwib3BlbkZvcmVjYXN0U3RhdERldGFpbChcXCcnICtcbiAgICAgICAgZXNjYXBlSHRtbFNhZmUoZC5pZCkgK1xuICAgICAgICAnXFwnKVwiIHN0eWxlPVwiY3Vyc29yOnBvaW50ZXI7Ym9yZGVyLWJvdHRvbToxcHggc29saWQgdmFyKC0tYm9yZGVyLXN1YnRsZSlcIiBvbm1vdXNlb3Zlcj1cInRoaXMuc3R5bGUuYmFja2dyb3VuZD1cXCd2YXIoLS1iZy1zZWNvbmRhcnkpXFwnXCIgb25tb3VzZW91dD1cInRoaXMuc3R5bGUuYmFja2dyb3VuZD1cXCd0cmFuc3BhcmVudFxcJ1wiPicgK1xuICAgICAgICAnPHRkIHN0eWxlPVwicGFkZGluZzo4cHggMTBweDtmb250LXdlaWdodDo3MDA7Y29sb3I6dmFyKC0tdGV4dC1wcmltYXJ5KVwiPicgK1xuICAgICAgICBlc2NhcGVIdG1sU2FmZShkLnN1YmZhbWlsaWEgfHwgZC5pZCkgK1xuICAgICAgICAnPC90ZD4nICtcbiAgICAgICAgJzx0ZCBzdHlsZT1cInBhZGRpbmc6OHB4IDEwcHg7Zm9udC1zaXplOjExcHg7Y29sb3I6dmFyKC0tdGV4dC1zZWNvbmRhcnkpXCI+JyArXG4gICAgICAgIGVzY2FwZUh0bWxTYWZlKGJlc3RNb2RlbCkgK1xuICAgICAgICAnPC90ZD4nICtcbiAgICAgICAgJzx0ZCBzdHlsZT1cInBhZGRpbmc6OHB4IDEwcHg7dGV4dC1hbGlnbjpjZW50ZXJcIj48c3BhbiBzdHlsZT1cImRpc3BsYXk6aW5saW5lLWJsb2NrO3BhZGRpbmc6M3B4IDhweDtib3JkZXItcmFkaXVzOjEycHg7YmFja2dyb3VuZDonICtcbiAgICAgICAgX3dhcGVCYWRnZUNvbG9yKHdhcGUpICtcbiAgICAgICAgJztjb2xvcjojZmZmO2ZvbnQtc2l6ZToxMXB4O2ZvbnQtd2VpZ2h0OjcwMFwiPicgK1xuICAgICAgICBfZm10V2FwZSh3YXBlKSArXG4gICAgICAgICc8L3NwYW4+PC90ZD4nICtcbiAgICAgICAgbW9udGhDZWxscyArXG4gICAgICAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjhweCAxMHB4O3RleHQtYWxpZ246cmlnaHQ7Zm9udC12YXJpYW50LW51bWVyaWM6dGFidWxhci1udW1zO2ZvbnQtd2VpZ2h0OjcwMDtjb2xvcjojMGQ5NDg4O2JhY2tncm91bmQ6dmFyKC0tYmctc2Vjb25kYXJ5KVwiPicgK1xuICAgICAgICBfZm10TnVtKHRvdGFsNykgK1xuICAgICAgICAnPC90ZD4nICtcbiAgICAgICAgJzwvdHI+J1xuICAgICAgKTtcbiAgICB9KVxuICAgIC5qb2luKCcnKTtcblxuICBjb25zdCBtb250aEhlYWRlcnNIdG1sID0gbW9udGhIZWFkZXJzXG4gICAgLm1hcChcbiAgICAgIChtKSA9PlxuICAgICAgICAnPHRoIHN0eWxlPVwicGFkZGluZzo4cHggMTBweDt0ZXh0LWFsaWduOnJpZ2h0O2ZvbnQtc2l6ZToxMHB4O3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtsZXR0ZXItc3BhY2luZzouNHB4O2NvbG9yOiM5NGEzYjhcIj4nICtcbiAgICAgICAgZXNjYXBlSHRtbFNhZmUobSkgK1xuICAgICAgICAnPC90aD4nXG4gICAgKVxuICAgIC5qb2luKCcnKTtcblxuICBjb25zdCB0YWJsZSA9XG4gICAgJzxkaXYgc3R5bGU9XCJvdmVyZmxvdzphdXRvO2JvcmRlcjoxcHggc29saWQgdmFyKC0tYm9yZGVyLXN1YnRsZSk7Ym9yZGVyLXJhZGl1czo4cHhcIj4nICtcbiAgICAnPHRhYmxlIHN0eWxlPVwid2lkdGg6MTAwJTtib3JkZXItY29sbGFwc2U6Y29sbGFwc2U7Zm9udC1zaXplOjEycHhcIj4nICtcbiAgICAnPHRoZWFkIHN0eWxlPVwiYmFja2dyb3VuZDojMGYxNzJhO2NvbG9yOiNmZmZcIj48dHI+JyArXG4gICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6OHB4IDEwcHg7dGV4dC1hbGlnbjpsZWZ0O2ZvbnQtc2l6ZToxMHB4O3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtsZXR0ZXItc3BhY2luZzouNHB4XCI+U3ViZmFtaWxpYTwvdGg+JyArXG4gICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6OHB4IDEwcHg7dGV4dC1hbGlnbjpsZWZ0O2ZvbnQtc2l6ZToxMHB4O3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtsZXR0ZXItc3BhY2luZzouNHB4XCI+TW9kZWxvPC90aD4nICtcbiAgICAnPHRoIHN0eWxlPVwicGFkZGluZzo4cHggMTBweDt0ZXh0LWFsaWduOmNlbnRlcjtmb250LXNpemU6MTBweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7bGV0dGVyLXNwYWNpbmc6LjRweFwiPldBUEU8L3RoPicgK1xuICAgIG1vbnRoSGVhZGVyc0h0bWwgK1xuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjhweCAxMHB4O3RleHQtYWxpZ246cmlnaHQ7Zm9udC1zaXplOjEwcHg7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO2xldHRlci1zcGFjaW5nOi40cHg7YmFja2dyb3VuZDojMTM0ZTRhXCI+VG90YWwgN208L3RoPicgK1xuICAgICc8L3RyPjwvdGhlYWQ+JyArXG4gICAgJzx0Ym9keT4nICtcbiAgICByb3dzSHRtbCArXG4gICAgJzwvdGJvZHk+PC90YWJsZT48L2Rpdj4nO1xuXG4gIGNvbnN0IGZvb3RlciA9XG4gICAgJzxkaXYgc3R5bGU9XCJtYXJnaW4tdG9wOjEycHg7Zm9udC1zaXplOjExcHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7bGluZS1oZWlnaHQ6MS41XCI+JyArXG4gICAgJzxiPkNcdTAwRjNtbyBsZWVyPC9iPjogV0FQRSAoV2VpZ2h0ZWQgQWJzb2x1dGUgUGVyY2VudGFnZSBFcnJvcikgbWlkZSBlbCBlcnJvciBkZWwgbW9kZWxvIHJlbGF0aXZvIGFsIHRvdGFsIHJlYWw6ICZsdDszMCUgZXhjZWxlbnRlLCAzMC01MCUgYnVlbm8sIDUwLTcwJSBhY2VwdGFibGUsICZndDs3MCUgcG9icmUuIENsaWNrIGVuIGZpbGEgcGFyYSBkZXRhbGxlICsgZ3JcdTAwRTFmaWNvLiAnICtcbiAgICAnU2UgZWxpZ2UgZWwgbW9kZWxvIGNvbiBtZW5vciBXQVBFIHBvciBzZXJpZSB0cmFzIGJhY2t0ZXN0IHJvbGxpbmctb3JpZ2luIChoPTIsIHZlbnRhbmFzPTMpLicgK1xuICAgICc8L2Rpdj4nO1xuXG4gIGNvbnQuaW5uZXJIVE1MID0gJzxkaXYgc3R5bGU9XCJwYWRkaW5nOjE4cHhcIj4nICsgYmFubmVyICsgdGFibGUgKyBmb290ZXIgKyAnPC9kaXY+Jztcbn1cblxuLy8gQ2FjaGUgaGlzdG9yaWEgYWdyZWdhZGEgcG9yIHN1YmZhbWlsaWEgKHBhcmEgZ3JcdTAwRTFmaWNvIGRldGFsbGUpLlxuYXN5bmMgZnVuY3Rpb24gX2xvYWRGb3JlY2FzdFN0YXRIaXN0b3J5KCkge1xuICBpZiAoX2ZvcmVjYXN0U3RhdEhpc3RvcnlDYWNoZSkgcmV0dXJuIF9mb3JlY2FzdFN0YXRIaXN0b3J5Q2FjaGU7XG4gIC8vIExhIGhpc3RvcmlhIHNvbG8gZXN0XHUwMEUxIGVuIEJRICh+MTAgYVx1MDBGMW9zIEJhcmFsZG8gKyAxMiBtZXNlcyBTaGltYW5vKS4gQ29tb1xuICAvLyBlbCBwaXBlbGluZSBsYSBlc2NyaWJlIGEgQ1NWIGxvY2FsLCBhY1x1MDBFMSBubyBsYSBwb2RlbW9zIGxlZXIuIEFsdGVybmF0aXZhOlxuICAvLyB1c2FyIHNrdV92ZW50YXNfc25hcHNob3QgcXVlIHRpZW5lIHZlbnRhcyBtZW5zdWFsZXMgcGVybyBzb2xvIGdydXBvIFBFU0NBLlxuICAvLyBFbiBGMkIuMiBzb2xvIG1vc3RyYW1vcyBmb3JlY2FzdCtJQyAoc2luIG92ZXJsYXkgaGlzdG9yaWEgcG9yIGFob3JhKS5cbiAgX2ZvcmVjYXN0U3RhdEhpc3RvcnlDYWNoZSA9IHt9O1xuICByZXR1cm4gX2ZvcmVjYXN0U3RhdEhpc3RvcnlDYWNoZTtcbn1cblxuZnVuY3Rpb24gX2J1aWxkRm9yZWNhc3RDaGFydFN2Zyhkb2MpIHtcbiAgY29uc3QgZmMgPSBkb2MuZm9yZWNhc3QgfHwgW107XG4gIGlmICghZmMubGVuZ3RoKVxuICAgIHJldHVybiAnPGRpdiBzdHlsZT1cInBhZGRpbmc6MzBweDt0ZXh0LWFsaWduOmNlbnRlcjtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKVwiPlNpbiBkYXRvcyBkZSBmb3JlY2FzdDwvZGl2Pic7XG4gIC8vIERpbWVuc2lvbmVzXG4gIGNvbnN0IFcgPSA2NDAsXG4gICAgSCA9IDI2MDtcbiAgY29uc3QgcGFkTCA9IDUwLFxuICAgIHBhZFIgPSAyMCxcbiAgICBwYWRUID0gMjAsXG4gICAgcGFkQiA9IDQwO1xuICBjb25zdCBpbm5lclcgPSBXIC0gcGFkTCAtIHBhZFI7XG4gIGNvbnN0IGlubmVySCA9IEggLSBwYWRUIC0gcGFkQjtcblxuICAvLyBZIHJhbmdlOiBtYXgoaGk4MCkgKiAxLjFcbiAgY29uc3QgbWF4WSA9IE1hdGgubWF4KDEsIC4uLmZjLm1hcCgoZikgPT4gTnVtYmVyKGYuaGk4MCkgfHwgTnVtYmVyKGYueV9oYXQpIHx8IDApKTtcbiAgY29uc3QgbWluWSA9IDA7XG4gIGNvbnN0IHNjYWxlWCA9IChpKSA9PiBwYWRMICsgKGlubmVyVyAqIGkpIC8gTWF0aC5tYXgoMSwgZmMubGVuZ3RoIC0gMSk7XG4gIGNvbnN0IHNjYWxlWSA9ICh2KSA9PiBwYWRUICsgaW5uZXJIIC0gKGlubmVySCAqICh2IC0gbWluWSkpIC8gKG1heFkgLSBtaW5ZKTtcblxuICAvLyBHcmlkICsgZWplIFlcbiAgY29uc3QgeVRpY2tzID0gWzAsIDAuMjUsIDAuNSwgMC43NSwgMV1cbiAgICAubWFwKChyKSA9PiB7XG4gICAgICBjb25zdCB2YWwgPSBtaW5ZICsgciAqIChtYXhZIC0gbWluWSk7XG4gICAgICBjb25zdCB5eSA9IHNjYWxlWSh2YWwpO1xuICAgICAgcmV0dXJuIChcbiAgICAgICAgJzxsaW5lIHgxPVwiJyArXG4gICAgICAgIHBhZEwgK1xuICAgICAgICAnXCIgeTE9XCInICtcbiAgICAgICAgeXkgK1xuICAgICAgICAnXCIgeDI9XCInICtcbiAgICAgICAgKFcgLSBwYWRSKSArXG4gICAgICAgICdcIiB5Mj1cIicgK1xuICAgICAgICB5eSArXG4gICAgICAgICdcIiBzdHJva2U9XCIjZTJlOGYwXCIgc3Ryb2tlLXdpZHRoPVwiMVwiLz4nICtcbiAgICAgICAgJzx0ZXh0IHg9XCInICtcbiAgICAgICAgKHBhZEwgLSA2KSArXG4gICAgICAgICdcIiB5PVwiJyArXG4gICAgICAgICh5eSArIDQpICtcbiAgICAgICAgJ1wiIHRleHQtYW5jaG9yPVwiZW5kXCIgZm9udC1zaXplPVwiMTBcIiBmaWxsPVwiIzY0NzQ4YlwiPicgK1xuICAgICAgICBfZm10TnVtKHZhbCkgK1xuICAgICAgICAnPC90ZXh0PidcbiAgICAgICk7XG4gICAgfSlcbiAgICAuam9pbignJyk7XG5cbiAgLy8gRWplIFggKG1lc2VzKVxuICBjb25zdCB4TGFiZWxzID0gZmNcbiAgICAubWFwKChmLCBpKSA9PiB7XG4gICAgICBjb25zdCB4eCA9IHNjYWxlWChpKTtcbiAgICAgIHJldHVybiAoXG4gICAgICAgICc8dGV4dCB4PVwiJyArXG4gICAgICAgIHh4ICtcbiAgICAgICAgJ1wiIHk9XCInICtcbiAgICAgICAgKEggLSBwYWRCICsgMTUpICtcbiAgICAgICAgJ1wiIHRleHQtYW5jaG9yPVwibWlkZGxlXCIgZm9udC1zaXplPVwiMTBcIiBmaWxsPVwiIzY0NzQ4YlwiPicgK1xuICAgICAgICBfZm10RHNTaG9ydChmLmRzKSArXG4gICAgICAgICc8L3RleHQ+J1xuICAgICAgKTtcbiAgICB9KVxuICAgIC5qb2luKCcnKTtcblxuICAvLyBJbnRlcnZhbG8gY29uZmlhbnphIChiYW5kKVxuICBjb25zdCBiYW5kUG9pbnRzID1cbiAgICBmYy5tYXAoKGYsIGkpID0+IHNjYWxlWChpKSArICcsJyArIHNjYWxlWShOdW1iZXIoZi5oaTgwKSB8fCAwKSkuam9pbignICcpICtcbiAgICAnICcgK1xuICAgIGZjXG4gICAgICAuc2xpY2UoKVxuICAgICAgLnJldmVyc2UoKVxuICAgICAgLm1hcCgoZiwgaSkgPT4gc2NhbGVYKGZjLmxlbmd0aCAtIDEgLSBpKSArICcsJyArIHNjYWxlWShOdW1iZXIoZi5sbzgwKSB8fCAwKSlcbiAgICAgIC5qb2luKCcgJyk7XG4gIGNvbnN0IGJhbmQgPSAnPHBvbHlnb24gcG9pbnRzPVwiJyArIGJhbmRQb2ludHMgKyAnXCIgZmlsbD1cIiMwZDk0ODgzM1wiIHN0cm9rZT1cIm5vbmVcIi8+JztcblxuICAvLyBMaW5lIGZvcmVjYXN0ICsgcHVudG9zXG4gIGNvbnN0IGxpbmVQb2ludHMgPSBmYy5tYXAoKGYsIGkpID0+IHNjYWxlWChpKSArICcsJyArIHNjYWxlWShOdW1iZXIoZi55X2hhdCkgfHwgMCkpLmpvaW4oJyAnKTtcbiAgY29uc3QgbGluZSA9XG4gICAgJzxwb2x5bGluZSBwb2ludHM9XCInICtcbiAgICBsaW5lUG9pbnRzICtcbiAgICAnXCIgZmlsbD1cIm5vbmVcIiBzdHJva2U9XCIjMGQ5NDg4XCIgc3Ryb2tlLXdpZHRoPVwiMi41XCIgc3Ryb2tlLWxpbmVqb2luPVwicm91bmRcIi8+JztcbiAgY29uc3QgcG9pbnRzID0gZmNcbiAgICAubWFwKFxuICAgICAgKGYsIGkpID0+XG4gICAgICAgICc8Y2lyY2xlIGN4PVwiJyArXG4gICAgICAgIHNjYWxlWChpKSArXG4gICAgICAgICdcIiBjeT1cIicgK1xuICAgICAgICBzY2FsZVkoTnVtYmVyKGYueV9oYXQpIHx8IDApICtcbiAgICAgICAgJ1wiIHI9XCI0XCIgZmlsbD1cIiMwZDk0ODhcIiBzdHJva2U9XCIjZmZmXCIgc3Ryb2tlLXdpZHRoPVwiMlwiLz4nXG4gICAgKVxuICAgIC5qb2luKCcnKTtcbiAgLy8gTGFiZWxzIGRlIHZhbG9yXG4gIGNvbnN0IHZhbHVlTGFiZWxzID0gZmNcbiAgICAubWFwKChmLCBpKSA9PiB7XG4gICAgICBjb25zdCB4eCA9IHNjYWxlWChpKTtcbiAgICAgIGNvbnN0IHl5ID0gc2NhbGVZKE51bWJlcihmLnlfaGF0KSB8fCAwKTtcbiAgICAgIHJldHVybiAoXG4gICAgICAgICc8dGV4dCB4PVwiJyArXG4gICAgICAgIHh4ICtcbiAgICAgICAgJ1wiIHk9XCInICtcbiAgICAgICAgKHl5IC0gOCkgK1xuICAgICAgICAnXCIgdGV4dC1hbmNob3I9XCJtaWRkbGVcIiBmb250LXNpemU9XCIxMFwiIGZvbnQtd2VpZ2h0PVwiNzAwXCIgZmlsbD1cIiMwZjc2NmVcIj4nICtcbiAgICAgICAgX2ZtdE51bShmLnlfaGF0KSArXG4gICAgICAgICc8L3RleHQ+J1xuICAgICAgKTtcbiAgICB9KVxuICAgIC5qb2luKCcnKTtcblxuICBjb25zdCBzdmcgPVxuICAgICc8c3ZnIHZpZXdCb3g9XCIwIDAgJyArXG4gICAgVyArXG4gICAgJyAnICtcbiAgICBIICtcbiAgICAnXCIgc3R5bGU9XCJ3aWR0aDoxMDAlO21heC13aWR0aDo4MDBweDtoZWlnaHQ6YXV0b1wiPicgK1xuICAgICc8cmVjdCB4PVwiMFwiIHk9XCIwXCIgd2lkdGg9XCInICtcbiAgICBXICtcbiAgICAnXCIgaGVpZ2h0PVwiJyArXG4gICAgSCArXG4gICAgJ1wiIGZpbGw9XCIjZmZmXCIvPicgK1xuICAgIHlUaWNrcyArXG4gICAgeExhYmVscyArXG4gICAgYmFuZCArXG4gICAgbGluZSArXG4gICAgcG9pbnRzICtcbiAgICB2YWx1ZUxhYmVscyArXG4gICAgJzwvc3ZnPic7XG4gIHJldHVybiBzdmc7XG59XG5cbndpbmRvdy5vcGVuRm9yZWNhc3RTdGF0RGV0YWlsID0gZnVuY3Rpb24gKHN1YklkKSB7XG4gIGlmICghX2ZvcmVjYXN0U3RhdERvY3MpIHJldHVybjtcbiAgY29uc3QgZG9jID0gX2ZvcmVjYXN0U3RhdERvY3MuZmluZCgoZCkgPT4gZC5pZCA9PT0gc3ViSWQpO1xuICBpZiAoIWRvYykge1xuICAgIGFsZXJ0KCdObyBzZSBlbmNvbnRyXHUwMEYzIGRldGFsbGUgZGUgJyArIHN1YklkKTtcbiAgICByZXR1cm47XG4gIH1cbiAgY29uc3QgZXhpc3RpbmcgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZm9yZWNhc3Qtc3RhdC1kZXRhaWwnKTtcbiAgaWYgKGV4aXN0aW5nKSBleGlzdGluZy5yZW1vdmUoKTtcblxuICBjb25zdCBlbCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpO1xuICBlbC5pZCA9ICdmb3JlY2FzdC1zdGF0LWRldGFpbCc7XG4gIGVsLnN0eWxlLmNzc1RleHQgPVxuICAgICdwb3NpdGlvbjpmaXhlZDtpbnNldDowO2JhY2tncm91bmQ6cmdiYSgxNSwyMyw0MiwuNjUpO3otaW5kZXg6MjEwMDtkaXNwbGF5OmZsZXg7YWxpZ24taXRlbXM6Y2VudGVyO2p1c3RpZnktY29udGVudDpjZW50ZXI7cGFkZGluZzoydmgnO1xuICBlbC5vbmNsaWNrID0gKGV2KSA9PiB7XG4gICAgaWYgKGV2LnRhcmdldCA9PT0gZWwpIGVsLnJlbW92ZSgpO1xuICB9O1xuXG4gIGNvbnN0IHdhcGUgPSBkb2MubWV0cmljcyAmJiBkb2MubWV0cmljcy53YXBlO1xuICBjb25zdCBiaWFzID0gZG9jLm1ldHJpY3MgJiYgZG9jLm1ldHJpY3MuYmlhcztcbiAgY29uc3QgbWFlID0gZG9jLm1ldHJpY3MgJiYgZG9jLm1ldHJpY3MubWFlO1xuICBjb25zdCBybXNlID0gZG9jLm1ldHJpY3MgJiYgZG9jLm1ldHJpY3Mucm1zZTtcbiAgY29uc3QgYmVzdE1vZGVsID0gZG9jLmJlc3RNb2RlbCB8fCAnXHUyMDE0JztcbiAgY29uc3QgdmVyc2lvbklkID0gZG9jLnZlcnNpb25JZCB8fCAnXHUyMDE0JztcbiAgY29uc3Qgc3ZnSHRtbCA9IF9idWlsZEZvcmVjYXN0Q2hhcnRTdmcoZG9jKTtcblxuICBjb25zdCBtZXRyaWNzSHRtbCA9XG4gICAgJzxkaXYgc3R5bGU9XCJkaXNwbGF5OmdyaWQ7Z3JpZC10ZW1wbGF0ZS1jb2x1bW5zOnJlcGVhdChhdXRvLWZpdCxtaW5tYXgoMTIwcHgsMWZyKSk7Z2FwOjEwcHg7bWFyZ2luOjE0cHggMFwiPicgK1xuICAgICc8ZGl2IHN0eWxlPVwicGFkZGluZzoxMHB4O2JhY2tncm91bmQ6dmFyKC0tYmctc2Vjb25kYXJ5KTtib3JkZXItcmFkaXVzOjZweFwiPjxkaXYgc3R5bGU9XCJmb250LXNpemU6MTBweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2VcIj5Nb2RlbG88L2Rpdj48ZGl2IHN0eWxlPVwiZm9udC13ZWlnaHQ6NzAwXCI+JyArXG4gICAgZXNjYXBlSHRtbFNhZmUoYmVzdE1vZGVsKSArXG4gICAgJzwvZGl2PjwvZGl2PicgK1xuICAgICc8ZGl2IHN0eWxlPVwicGFkZGluZzoxMHB4O2JhY2tncm91bmQ6dmFyKC0tYmctc2Vjb25kYXJ5KTtib3JkZXItcmFkaXVzOjZweFwiPjxkaXYgc3R5bGU9XCJmb250LXNpemU6MTBweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2VcIj5XQVBFPC9kaXY+PGRpdiBzdHlsZT1cImZvbnQtd2VpZ2h0OjcwMDtjb2xvcjonICtcbiAgICBfd2FwZUJhZGdlQ29sb3Iod2FwZSkgK1xuICAgICdcIj4nICtcbiAgICBfZm10V2FwZSh3YXBlKSArXG4gICAgJzwvZGl2PjwvZGl2PicgK1xuICAgICc8ZGl2IHN0eWxlPVwicGFkZGluZzoxMHB4O2JhY2tncm91bmQ6dmFyKC0tYmctc2Vjb25kYXJ5KTtib3JkZXItcmFkaXVzOjZweFwiPjxkaXYgc3R5bGU9XCJmb250LXNpemU6MTBweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2VcIj5CaWFzPC9kaXY+PGRpdiBzdHlsZT1cImZvbnQtd2VpZ2h0OjcwMFwiPicgK1xuICAgIChiaWFzICE9IG51bGwgPyAoYmlhcyAqIDEwMCkudG9GaXhlZCgwKSArICclJyA6ICdcdTIwMTQnKSArXG4gICAgJzwvZGl2PjwvZGl2PicgK1xuICAgICc8ZGl2IHN0eWxlPVwicGFkZGluZzoxMHB4O2JhY2tncm91bmQ6dmFyKC0tYmctc2Vjb25kYXJ5KTtib3JkZXItcmFkaXVzOjZweFwiPjxkaXYgc3R5bGU9XCJmb250LXNpemU6MTBweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2VcIj5NQUU8L2Rpdj48ZGl2IHN0eWxlPVwiZm9udC13ZWlnaHQ6NzAwXCI+JyArXG4gICAgX2ZtdE51bShtYWUpICtcbiAgICAnPC9kaXY+PC9kaXY+JyArXG4gICAgJzxkaXYgc3R5bGU9XCJwYWRkaW5nOjEwcHg7YmFja2dyb3VuZDp2YXIoLS1iZy1zZWNvbmRhcnkpO2JvcmRlci1yYWRpdXM6NnB4XCI+PGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMHB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZVwiPlJNU0U8L2Rpdj48ZGl2IHN0eWxlPVwiZm9udC13ZWlnaHQ6NzAwXCI+JyArXG4gICAgX2ZtdE51bShybXNlKSArXG4gICAgJzwvZGl2PjwvZGl2PicgK1xuICAgICc8L2Rpdj4nO1xuXG4gIGNvbnN0IHRhYmxlSHRtbCA9XG4gICAgJzx0YWJsZSBzdHlsZT1cIndpZHRoOjEwMCU7Zm9udC1zaXplOjEycHg7Ym9yZGVyLWNvbGxhcHNlOmNvbGxhcHNlO21hcmdpbi10b3A6MTBweFwiPicgK1xuICAgICc8dGhlYWQgc3R5bGU9XCJiYWNrZ3JvdW5kOiMwZjE3MmE7Y29sb3I6I2ZmZlwiPjx0cj4nICtcbiAgICAnPHRoIHN0eWxlPVwicGFkZGluZzo2cHggMTBweDt0ZXh0LWFsaWduOmxlZnRcIj5NZXM8L3RoPicgK1xuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjZweCAxMHB4O3RleHQtYWxpZ246cmlnaHRcIj5Gb3JlY2FzdDwvdGg+JyArXG4gICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6NnB4IDEwcHg7dGV4dC1hbGlnbjpyaWdodFwiPklDIDgwJSBiYWpvPC90aD4nICtcbiAgICAnPHRoIHN0eWxlPVwicGFkZGluZzo2cHggMTBweDt0ZXh0LWFsaWduOnJpZ2h0XCI+SUMgODAlIGFsdG88L3RoPicgK1xuICAgICc8L3RyPjwvdGhlYWQ+PHRib2R5PicgK1xuICAgIChkb2MuZm9yZWNhc3QgfHwgW10pXG4gICAgICAubWFwKFxuICAgICAgICAoZikgPT5cbiAgICAgICAgICAnPHRyIHN0eWxlPVwiYm9yZGVyLWJvdHRvbToxcHggc29saWQgdmFyKC0tYm9yZGVyLXN1YnRsZSlcIj48dGQgc3R5bGU9XCJwYWRkaW5nOjZweCAxMHB4XCI+JyArXG4gICAgICAgICAgZXNjYXBlSHRtbFNhZmUoX2ZtdERzU2hvcnQoZi5kcykpICtcbiAgICAgICAgICAnPC90ZD4nICtcbiAgICAgICAgICAnPHRkIHN0eWxlPVwicGFkZGluZzo2cHggMTBweDt0ZXh0LWFsaWduOnJpZ2h0O2ZvbnQtd2VpZ2h0OjcwMFwiPicgK1xuICAgICAgICAgIF9mbXROdW0oZi55X2hhdCkgK1xuICAgICAgICAgICc8L3RkPicgK1xuICAgICAgICAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjZweCAxMHB4O3RleHQtYWxpZ246cmlnaHQ7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZClcIj4nICtcbiAgICAgICAgICBfZm10TnVtKGYubG84MCkgK1xuICAgICAgICAgICc8L3RkPicgK1xuICAgICAgICAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjZweCAxMHB4O3RleHQtYWxpZ246cmlnaHQ7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZClcIj4nICtcbiAgICAgICAgICBfZm10TnVtKGYuaGk4MCkgK1xuICAgICAgICAgICc8L3RkPjwvdHI+J1xuICAgICAgKVxuICAgICAgLmpvaW4oJycpICtcbiAgICAnPC90Ym9keT48L3RhYmxlPic7XG5cbiAgY29uc3QgY29udGVudCA9XG4gICAgJzxkaXYgc3R5bGU9XCJiYWNrZ3JvdW5kOnZhcigtLWJnLWVsZXZhdGVkKTtib3JkZXItcmFkaXVzOjEycHg7cGFkZGluZzoyNHB4O21heC13aWR0aDo4MjBweDt3aWR0aDoxMDAlO21heC1oZWlnaHQ6OTZ2aDtvdmVyZmxvdzphdXRvO2JveC1zaGFkb3c6MCAyMHB4IDYwcHggcmdiYSgwLDAsMCwuNClcIj4nICtcbiAgICAnPGRpdiBzdHlsZT1cImRpc3BsYXk6ZmxleDtqdXN0aWZ5LWNvbnRlbnQ6c3BhY2UtYmV0d2VlbjthbGlnbi1pdGVtczpjZW50ZXI7bWFyZ2luLWJvdHRvbToxMHB4XCI+JyArXG4gICAgJzxkaXY+PGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMXB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtsZXR0ZXItc3BhY2luZzouNHB4XCI+U3ViZmFtaWxpYTwvZGl2PjxkaXYgc3R5bGU9XCJmb250LXNpemU6MjJweDtmb250LXdlaWdodDo4MDBcIj4nICtcbiAgICBlc2NhcGVIdG1sU2FmZShkb2Muc3ViZmFtaWxpYSB8fCBkb2MuaWQpICtcbiAgICAnPC9kaXY+PC9kaXY+JyArXG4gICAgJzxidXR0b24gb25jbGljaz1cImRvY3VtZW50LmdldEVsZW1lbnRCeUlkKFxcJ2ZvcmVjYXN0LXN0YXQtZGV0YWlsXFwnKS5yZW1vdmUoKVwiIHN0eWxlPVwiYmFja2dyb3VuZDp0cmFuc3BhcmVudDtib3JkZXI6MXB4IHNvbGlkIHZhcigtLWJvcmRlci1zdWJ0bGUpO2JvcmRlci1yYWRpdXM6NnB4O3BhZGRpbmc6NnB4IDEycHg7Y3Vyc29yOnBvaW50ZXI7Zm9udC13ZWlnaHQ6NzAwXCI+Q2VycmFyPC9idXR0b24+JyArXG4gICAgJzwvZGl2PicgK1xuICAgIG1ldHJpY3NIdG1sICtcbiAgICAnPGRpdiBzdHlsZT1cImJhY2tncm91bmQ6I2ZmZjtwYWRkaW5nOjhweDtib3JkZXItcmFkaXVzOjhweDttYXJnaW4tdG9wOjEwcHg7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1ib3JkZXItc3VidGxlKVwiPicgK1xuICAgIHN2Z0h0bWwgK1xuICAgICc8L2Rpdj4nICtcbiAgICB0YWJsZUh0bWwgK1xuICAgICc8ZGl2IHN0eWxlPVwibWFyZ2luLXRvcDoxNHB4O2ZvbnQtc2l6ZToxMXB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpXCI+VmVyc2lvbjogPGNvZGU+JyArXG4gICAgZXNjYXBlSHRtbFNhZmUodmVyc2lvbklkKSArXG4gICAgJzwvY29kZT4gXHUwMEI3IEFwcHJvYWNoOiAnICtcbiAgICBlc2NhcGVIdG1sU2FmZSgoZG9jLmNvbmZpZyB8fCB7fSkuYXBwcm9hY2ggfHwgJ1x1MjAxNCcpICtcbiAgICAnPC9kaXY+JyArXG4gICAgJzwvZGl2Pic7XG4gIGVsLmlubmVySFRNTCA9IGNvbnRlbnQ7XG4gIGRvY3VtZW50LmJvZHkuYXBwZW5kQ2hpbGQoZWwpO1xufTtcblxud2luZG93Lm9wZW5Gb3JlY2FzdE1vZGFsID0gYXN5bmMgZnVuY3Rpb24gKCkge1xuICBpZiAoIV9jYW5Gb3JlY2FzdCgpKSB7XG4gICAgYWxlcnQoJ0ZPUkVDQVNUIGVzIHNvbG8gcGFyYSBNYXJpYW5vIChhZG1pbikuJyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGNvbnN0IGVsID0gX3JlbmRlck1vZGFsU2hlbGwoKTtcbiAgZWwuc3R5bGUuZGlzcGxheSA9ICdibG9jayc7XG4gIC8vIEZhc2UgMTogY2FyZ2FyIFNhbGVzIFBsYW5zIGNhY2hlcyArIHJlbmRlcml6YXIgdGFiIGRlZmF1bHQuXG4gIF9yZW5kZXJTYWxlc1BsYW5zVGFiKCk7XG4gIF9sb2FkU2FsZXNQbGFuQ2FjaGVzKClcbiAgICAudGhlbihfcmVuZGVyU2FsZXNQbGFuc1RhYilcbiAgICAuY2F0Y2goKCkgPT4ge30pO1xufTtcblxud2luZG93LmNsb3NlRm9yZWNhc3RNb2RhbCA9IGZ1bmN0aW9uICgpIHtcbiAgY29uc3QgZWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZm9yZWNhc3QtbW9kYWwnKTtcbiAgaWYgKGVsKSBlbC5zdHlsZS5kaXNwbGF5ID0gJ25vbmUnO1xufTtcblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBGM0EgXHUyMDE0IFRhYmxhIFJlY29tZW5kYWNpXHUwMEYzbiBkZSBDb21wcmEgKHRhYiBTYWxlcyBQbGFucylcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5hc3luYyBmdW5jdGlvbiBfbG9hZE11bHRpcGxpZXJPdmVycmlkZXMoKSB7XG4gIGlmICghd2luZG93LmZiRGIpIHJldHVybjtcbiAgdHJ5IHtcbiAgICBjb25zdCBkb2MgPSBhd2FpdCB3aW5kb3cuZmJEYi5jb2xsZWN0aW9uKCdmb3JlY2FzdF9jb25maWcnKS5kb2MoJ211bHRpcGxpZXJzJykuZ2V0KCk7XG4gICAgaWYgKGRvYy5leGlzdHMpIHtcbiAgICAgIGNvbnN0IGQgPSBkb2MuZGF0YSgpIHx8IHt9O1xuICAgICAgX211bHRpcGxpZXJPdmVycmlkZXMgPSBkLnNrdU92ZXJyaWRlcyB8fCB7fTtcbiAgICB9IGVsc2Uge1xuICAgICAgX211bHRpcGxpZXJPdmVycmlkZXMgPSB7fTtcbiAgICB9XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBjb25zb2xlLndhcm4oJ1tGT1JFQ0FTVCByZWNvXSBsb2FkIG11bHRpcGxpZXJzIGZhaWw6JywgZSAmJiBlLm1lc3NhZ2UpO1xuICAgIF9tdWx0aXBsaWVyT3ZlcnJpZGVzID0ge307XG4gIH1cbn1cblxuYXN5bmMgZnVuY3Rpb24gX3NhdmVNdWx0aXBsaWVyT3ZlcnJpZGUoc2t1VXBwZXIsIHZhbHVlKSB7XG4gIGlmICghd2luZG93LmZiRGIpIHJldHVybjtcbiAgaWYgKCFfbXVsdGlwbGllck92ZXJyaWRlcykgX211bHRpcGxpZXJPdmVycmlkZXMgPSB7fTtcbiAgY29uc3QgdWlkID0gKHdpbmRvdy5jdXJyZW50VXNlciAmJiB3aW5kb3cuY3VycmVudFVzZXIuZW1haWwpIHx8ICd1bmtub3duJztcbiAgX211bHRpcGxpZXJPdmVycmlkZXNbc2t1VXBwZXJdID0ge1xuICAgIHZhbHVlOiBOdW1iZXIodmFsdWUpLFxuICAgIHVwZGF0ZWRBdDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgIHVwZGF0ZWRCeTogdWlkLFxuICB9O1xuICBhd2FpdCB3aW5kb3cuZmJEYi5jb2xsZWN0aW9uKCdmb3JlY2FzdF9jb25maWcnKS5kb2MoJ211bHRpcGxpZXJzJykuc2V0KHtcbiAgICBza3VPdmVycmlkZXM6IF9tdWx0aXBsaWVyT3ZlcnJpZGVzLFxuICAgIHVwZGF0ZWRBdDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgIHVwZGF0ZWRCeTogdWlkLFxuICB9KTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gX3JlbW92ZU11bHRpcGxpZXJPdmVycmlkZShza3VVcHBlcikge1xuICBpZiAoIXdpbmRvdy5mYkRiIHx8ICFfbXVsdGlwbGllck92ZXJyaWRlcykgcmV0dXJuO1xuICBkZWxldGUgX211bHRpcGxpZXJPdmVycmlkZXNbc2t1VXBwZXJdO1xuICBjb25zdCB1aWQgPSAod2luZG93LmN1cnJlbnRVc2VyICYmIHdpbmRvdy5jdXJyZW50VXNlci5lbWFpbCkgfHwgJ3Vua25vd24nO1xuICBhd2FpdCB3aW5kb3cuZmJEYi5jb2xsZWN0aW9uKCdmb3JlY2FzdF9jb25maWcnKS5kb2MoJ211bHRpcGxpZXJzJykuc2V0KHtcbiAgICBza3VPdmVycmlkZXM6IF9tdWx0aXBsaWVyT3ZlcnJpZGVzLFxuICAgIHVwZGF0ZWRBdDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgIHVwZGF0ZWRCeTogdWlkLFxuICB9KTtcbn1cblxuLy8gQXV0byBtdWx0aXBsaWVyOiByZWNlbnQvYmFzZWxpbmUgY29uIGNhcC4gUmV0b3JuYSB7dmFsdWUsIHNvdXJjZTogJ2F1dG8nfCdmYWxsYmFjayd8J2RlZmF1bHQnLCByZWNlbnQsIGJhc2VsaW5lfS5cbmZ1bmN0aW9uIF9jb21wdXRlTXVsdGlwbGllckF1dG8oc2t1VXBwZXIpIHtcbiAgY29uc3QgcmVjID0gX3JlY29WZW50YXNTbmFwc2hvdCAmJiBfcmVjb1ZlbnRhc1NuYXBzaG90W3NrdVVwcGVyXTtcbiAgaWYgKCFyZWMgfHwgIXJlYy5tZXNlcykgcmV0dXJuIHsgdmFsdWU6IDEuMCwgc291cmNlOiAnZGVmYXVsdCcsIHJlY2VudDogMCwgYmFzZWxpbmU6IDAgfTtcbiAgY29uc3QgaG95ID0gbmV3IERhdGUoKTtcbiAgY29uc3QgbW9udGhzQmFja0tleSA9IChuKSA9PiB7XG4gICAgY29uc3QgZCA9IG5ldyBEYXRlKGhveS5nZXRGdWxsWWVhcigpLCBob3kuZ2V0TW9udGgoKSAtIG4sIDEpO1xuICAgIHJldHVybiBTdHJpbmcoZC5nZXRGdWxsWWVhcigpKSArICctJyArIFN0cmluZyhkLmdldE1vbnRoKCkgKyAxKS5wYWRTdGFydCgyLCAnMCcpO1xuICB9O1xuICBjb25zdCBjb2xsZWN0QXZnID0gKG4pID0+IHtcbiAgICBsZXQgc3VtID0gMDtcbiAgICBsZXQgY291bnQgPSAwO1xuICAgIGZvciAobGV0IGkgPSAxOyBpIDw9IG47IGkrKykge1xuICAgICAgY29uc3QgayA9IG1vbnRoc0JhY2tLZXkoaSk7XG4gICAgICBjb25zdCBtID0gcmVjLm1lc2VzW2tdO1xuICAgICAgaWYgKG0gJiYgTnVtYmVyLmlzRmluaXRlKE51bWJlcihtLnF0eSkpKSB7XG4gICAgICAgIHN1bSArPSBOdW1iZXIobS5xdHkpO1xuICAgICAgICBjb3VudCsrO1xuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gY291bnQgPiAwID8geyBhdmc6IHN1bSAvIGNvdW50LCBuOiBjb3VudCB9IDogeyBhdmc6IDAsIG46IDAgfTtcbiAgfTtcbiAgY29uc3QgcmVjMiA9IGNvbGxlY3RBdmcoUkVDT19NVUxUX1JFQ0VOVF9NT05USFMpO1xuICBjb25zdCBiYXM2ID0gY29sbGVjdEF2ZyhSRUNPX01VTFRfQkFTRUxJTkVfTU9OVEhTKTtcbiAgLy8gTmVjZXNpdGFtb3MgYWwgbWVub3MgMSBtZXMgcmVjaWVudGUgKyAzIG1lc2VzIGJhc2VsaW5lIHBhcmEgY2FsY3VsYXIgYXV0by5cbiAgaWYgKHJlYzIubiA9PT0gMCB8fCBiYXM2Lm4gPCAzIHx8IGJhczYuYXZnIDwgUkVDT19NVUxUX01JTl9CQVNFTElORSkge1xuICAgIHJldHVybiB7IHZhbHVlOiAxLjAsIHNvdXJjZTogJ2RlZmF1bHQnLCByZWNlbnQ6IHJlYzIuYXZnLCBiYXNlbGluZTogYmFzNi5hdmcgfTtcbiAgfVxuICBsZXQgcmF0aW8gPSByZWMyLmF2ZyAvIGJhczYuYXZnO1xuICBpZiAocmF0aW8gPCBSRUNPX01VTFRfTUlOKSByYXRpbyA9IFJFQ09fTVVMVF9NSU47XG4gIGlmIChyYXRpbyA+IFJFQ09fTVVMVF9NQVgpIHJhdGlvID0gUkVDT19NVUxUX01BWDtcbiAgcmV0dXJuIHtcbiAgICB2YWx1ZTogTWF0aC5yb3VuZChyYXRpbyAqIDEwMCkgLyAxMDAsXG4gICAgc291cmNlOiAnYXV0bycsXG4gICAgcmVjZW50OiBNYXRoLnJvdW5kKHJlYzIuYXZnICogMTApIC8gMTAsXG4gICAgYmFzZWxpbmU6IE1hdGgucm91bmQoYmFzNi5hdmcgKiAxMCkgLyAxMCxcbiAgfTtcbn1cblxuZnVuY3Rpb24gX2dldEVmZmVjdGl2ZU11bHRpcGxpZXIoc2t1VXBwZXIpIHtcbiAgLy8gT3ZlcnJpZGUgbWFudWFsIGdhbmFcbiAgaWYgKF9tdWx0aXBsaWVyT3ZlcnJpZGVzICYmIF9tdWx0aXBsaWVyT3ZlcnJpZGVzW3NrdVVwcGVyXSkge1xuICAgIHJldHVybiB7XG4gICAgICB2YWx1ZTogTnVtYmVyKF9tdWx0aXBsaWVyT3ZlcnJpZGVzW3NrdVVwcGVyXS52YWx1ZSkgfHwgMS4wLFxuICAgICAgc291cmNlOiAnbWFudWFsJyxcbiAgICAgIGF1dG86IF9jb21wdXRlTXVsdGlwbGllckF1dG8oc2t1VXBwZXIpLFxuICAgIH07XG4gIH1cbiAgY29uc3QgYXV0byA9IF9jb21wdXRlTXVsdGlwbGllckF1dG8oc2t1VXBwZXIpO1xuICByZXR1cm4geyB2YWx1ZTogYXV0by52YWx1ZSwgc291cmNlOiBhdXRvLnNvdXJjZSwgYXV0byB9O1xufVxuXG5hc3luYyBmdW5jdGlvbiBfbG9hZERpc2NvbnRpbnVlZFNrdXMoKSB7XG4gIGlmICghd2luZG93LmZiRGIpIHJldHVybjtcbiAgdHJ5IHtcbiAgICBjb25zdCBkb2MgPSBhd2FpdCB3aW5kb3cuZmJEYi5jb2xsZWN0aW9uKCdmb3JlY2FzdF9jb25maWcnKS5kb2MoJ2Rpc2NvbnRpbnVlZF9za3VzJykuZ2V0KCk7XG4gICAgaWYgKGRvYy5leGlzdHMpIHtcbiAgICAgIGNvbnN0IGQgPSBkb2MuZGF0YSgpIHx8IHt9O1xuICAgICAgY29uc3QgYXJyID0gQXJyYXkuaXNBcnJheShkLnNrdXMpID8gZC5za3VzIDogW107XG4gICAgICBfZGlzY29udGludWVkU2t1cyA9IG5ldyBTZXQoYXJyLm1hcCgocykgPT4gU3RyaW5nKHMpLnRyaW0oKS50b1VwcGVyQ2FzZSgpKSk7XG4gICAgICBfZGlzY29udGludWVkTWV0YSA9IHsgdXBkYXRlZEF0OiBkLnVwZGF0ZWRBdCwgdXBkYXRlZEJ5OiBkLnVwZGF0ZWRCeSB9O1xuICAgIH0gZWxzZSB7XG4gICAgICBfZGlzY29udGludWVkU2t1cyA9IG5ldyBTZXQoKTtcbiAgICAgIF9kaXNjb250aW51ZWRNZXRhID0gbnVsbDtcbiAgICB9XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBjb25zb2xlLndhcm4oJ1tGT1JFQ0FTVCByZWNvXSBsb2FkIGRpc2NvbnRpbnVlZCBmYWlsOicsIGUgJiYgZS5tZXNzYWdlKTtcbiAgICBfZGlzY29udGludWVkU2t1cyA9IG5ldyBTZXQoKTtcbiAgfVxufVxuXG5hc3luYyBmdW5jdGlvbiBfc2F2ZURpc2NvbnRpbnVlZFNrdXMoKSB7XG4gIGlmICghd2luZG93LmZiRGIgfHwgIV9kaXNjb250aW51ZWRTa3VzKSByZXR1cm47XG4gIGNvbnN0IHVpZCA9ICh3aW5kb3cuY3VycmVudFVzZXIgJiYgd2luZG93LmN1cnJlbnRVc2VyLmVtYWlsKSB8fCAndW5rbm93bic7XG4gIGNvbnN0IHBheWxvYWQgPSB7XG4gICAgc2t1czogQXJyYXkuZnJvbShfZGlzY29udGludWVkU2t1cykuc29ydCgpLFxuICAgIHVwZGF0ZWRBdDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgIHVwZGF0ZWRCeTogdWlkLFxuICB9O1xuICBhd2FpdCB3aW5kb3cuZmJEYi5jb2xsZWN0aW9uKCdmb3JlY2FzdF9jb25maWcnKS5kb2MoJ2Rpc2NvbnRpbnVlZF9za3VzJykuc2V0KHBheWxvYWQpO1xuICBfZGlzY29udGludWVkTWV0YSA9IHsgdXBkYXRlZEF0OiBwYXlsb2FkLnVwZGF0ZWRBdCwgdXBkYXRlZEJ5OiBwYXlsb2FkLnVwZGF0ZWRCeSB9O1xufVxuXG5hc3luYyBmdW5jdGlvbiBfbG9hZFJlY29EYXRhKCkge1xuICBpZiAoIXdpbmRvdy5mYkRiKSB0aHJvdyBuZXcgRXJyb3IoJ0ZpcmVzdG9yZSBubyBpbmljaWFsaXphZG8nKTtcbiAgY29uc3QgcHJvbWlzZXMgPSBbXTtcbiAgaWYgKCFfZGlzY29udGludWVkU2t1cykgcHJvbWlzZXMucHVzaChfbG9hZERpc2NvbnRpbnVlZFNrdXMoKSk7XG4gIGlmICghX211bHRpcGxpZXJPdmVycmlkZXMpIHByb21pc2VzLnB1c2goX2xvYWRNdWx0aXBsaWVyT3ZlcnJpZGVzKCkpO1xuICBpZiAoIV9yZWNvU3RvY2tTbmFwc2hvdCkge1xuICAgIHByb21pc2VzLnB1c2goXG4gICAgICB3aW5kb3cuZmJEYlxuICAgICAgICAuY29sbGVjdGlvbignYXBwX2NvbmZpZycpXG4gICAgICAgIC5kb2MoJ3N0b2NrX3NuYXBzaG90JylcbiAgICAgICAgLmdldCgpXG4gICAgICAgIC50aGVuKChkKSA9PiB7XG4gICAgICAgICAgY29uc3QgZGF0YSA9IGQuZXhpc3RzID8gZC5kYXRhKCkgOiB7fTtcbiAgICAgICAgICBsZXQgd2ggPSB7fTtcbiAgICAgICAgICBsZXQgYm8gPSB7fTtcbiAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgd2ggPSBkYXRhLndhcmVob3VzZUJyZWFrZG93biA/IEpTT04ucGFyc2UoZGF0YS53YXJlaG91c2VCcmVha2Rvd24pIDoge307XG4gICAgICAgICAgfSBjYXRjaCB7XG4gICAgICAgICAgICB3aCA9IHt9O1xuICAgICAgICAgIH1cbiAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgYm8gPSBkYXRhLmJhY2tvcmRlckJ5U2t1ID8gSlNPTi5wYXJzZShkYXRhLmJhY2tvcmRlckJ5U2t1KSA6IHt9O1xuICAgICAgICAgIH0gY2F0Y2gge1xuICAgICAgICAgICAgYm8gPSB7fTtcbiAgICAgICAgICB9XG4gICAgICAgICAgX3JlY29TdG9ja1NuYXBzaG90ID0geyB3YXJlaG91c2VCcmVha2Rvd246IHdoLCBiYWNrb3JkZXJCeVNrdTogYm8gfTtcbiAgICAgICAgfSlcbiAgICApO1xuICB9XG4gIGlmICghX3JlY29WZW50YXNTbmFwc2hvdCkge1xuICAgIHByb21pc2VzLnB1c2goXG4gICAgICB3aW5kb3cuZmJEYlxuICAgICAgICAuY29sbGVjdGlvbignc2t1X3ZlbnRhc19zbmFwc2hvdCcpXG4gICAgICAgIC5nZXQoKVxuICAgICAgICAudGhlbigoc25hcCkgPT4ge1xuICAgICAgICAgIGNvbnN0IG1hcCA9IHt9O1xuICAgICAgICAgIHNuYXAuZm9yRWFjaCgoZG9jKSA9PiB7XG4gICAgICAgICAgICBjb25zdCBkID0gZG9jLmRhdGEoKTtcbiAgICAgICAgICAgIGlmICghZCB8fCAhZC5za3UpIHJldHVybjtcbiAgICAgICAgICAgIG1hcFtTdHJpbmcoZC5za3UpLnRyaW0oKS50b1VwcGVyQ2FzZSgpXSA9IHsgbWVzZXM6IGQubWVzZXMgfHwge30gfTtcbiAgICAgICAgICB9KTtcbiAgICAgICAgICBfcmVjb1ZlbnRhc1NuYXBzaG90ID0gbWFwO1xuICAgICAgICB9KVxuICAgICk7XG4gIH1cbiAgYXdhaXQgUHJvbWlzZS5hbGwocHJvbWlzZXMpO1xufVxuXG5mdW5jdGlvbiBfY29tcHV0ZVZlbnRhTWVuc3VhbFByb21lZGlvKHNrdVVwcGVyKSB7XG4gIC8vIFByb21lZGlvIGRlIGxvcyBcdTAwRkFsdGltb3MgUkVDT19WRU5UQV9QUk9NRURJT19XSU5ET1cgbWVzZXMgY2VycmFkb3NcbiAgLy8gKGV4Y2x1eWUgZWwgbWVzIGFjdHVhbCBwYXJjaWFsKS5cbiAgY29uc3QgcmVjID0gX3JlY29WZW50YXNTbmFwc2hvdCAmJiBfcmVjb1ZlbnRhc1NuYXBzaG90W3NrdVVwcGVyXTtcbiAgaWYgKCFyZWMgfHwgIXJlYy5tZXNlcykgcmV0dXJuIDA7XG4gIGNvbnN0IGhveSA9IG5ldyBEYXRlKCk7XG4gIGNvbnN0IG1vbnRoc0JhY2sgPSBbXTtcbiAgZm9yIChsZXQgaSA9IDE7IGkgPD0gUkVDT19WRU5UQV9QUk9NRURJT19XSU5ET1c7IGkrKykge1xuICAgIGNvbnN0IGQgPSBuZXcgRGF0ZShob3kuZ2V0RnVsbFllYXIoKSwgaG95LmdldE1vbnRoKCkgLSBpLCAxKTtcbiAgICBtb250aHNCYWNrLnB1c2goU3RyaW5nKGQuZ2V0RnVsbFllYXIoKSkgKyAnLScgKyBTdHJpbmcoZC5nZXRNb250aCgpICsgMSkucGFkU3RhcnQoMiwgJzAnKSk7XG4gIH1cbiAgbGV0IHN1bSA9IDA7XG4gIGxldCBuID0gMDtcbiAgbW9udGhzQmFjay5mb3JFYWNoKChrKSA9PiB7XG4gICAgY29uc3QgbSA9IHJlYy5tZXNlc1trXTtcbiAgICBpZiAobSAmJiBOdW1iZXIuaXNGaW5pdGUoTnVtYmVyKG0ucXR5KSkpIHtcbiAgICAgIHN1bSArPSBOdW1iZXIobS5xdHkpO1xuICAgICAgbisrO1xuICAgIH1cbiAgfSk7XG4gIHJldHVybiBuID4gMCA/IHN1bSAvIG4gOiAwO1xufVxuXG5mdW5jdGlvbiBfY29tcHV0ZVNhbGVzUGxhbkZ1dHVybyhyb3cpIHtcbiAgLy8gU3VtYSBsb3MgbWVzZXMgZGUgcm93Lm1vbnRocyBkZXNkZSBlbCBtZXMgYWN0dWFsIChpbmNsdXNpdmUpIGhhc3RhIGVsXG4gIC8vIFx1MDBGQWx0aW1vIG1lcyBkZWwgc2FsZXMgcGxhbi4gTG9zIG1lc2VzIHNvbiAnWVlZWS1NTScuXG4gIGlmICghcm93IHx8ICFyb3cubW9udGhzKSByZXR1cm4gMDtcbiAgY29uc3QgaG95ID0gbmV3IERhdGUoKTtcbiAgY29uc3QgY3VycmVudEtleSA9IFN0cmluZyhob3kuZ2V0RnVsbFllYXIoKSkgKyAnLScgKyBTdHJpbmcoaG95LmdldE1vbnRoKCkgKyAxKS5wYWRTdGFydCgyLCAnMCcpO1xuICBsZXQgc3VtID0gMDtcbiAgT2JqZWN0LmtleXMocm93Lm1vbnRocykuZm9yRWFjaCgoaykgPT4ge1xuICAgIGlmIChrID49IGN1cnJlbnRLZXkpIHN1bSArPSBOdW1iZXIocm93Lm1vbnRoc1trXSB8fCAwKTtcbiAgfSk7XG4gIHJldHVybiBzdW07XG59XG5cbmZ1bmN0aW9uIF9jb21wdXRlUmVjb21tZW5kYXRpb25zKCkge1xuICAvLyBDb21iaW5hIFJvZHMgKyBSZWVscyBzYWxlcyBwbGFucyArIHN0b2NrICsgYmFja29yZGVyICsgdmVudGFzIHByb21lZGlvLlxuICAvLyBSZXRvcm5hIGFycmF5IGRlIHJvd3MgY29uIHRvZG9zIGxvcyBjYW1wb3MgKyByZWNvbWVuZGFkby5cbiAgY29uc3Qgcm93cyA9IFtdO1xuICBjb25zdCBmYW1pbGlhcyA9IFsncm9kcycsICdyZWVscyddO1xuICBmb3IgKGNvbnN0IGZhbSBvZiBmYW1pbGlhcykge1xuICAgIGNvbnN0IGNhY2hlID0gX3NhbGVzUGxhbkNhY2hlc1tmYW1dO1xuICAgIGlmICghY2FjaGUgfHwgIWNhY2hlLnJvd3MpIGNvbnRpbnVlO1xuICAgIGZvciAoY29uc3Qgc3BSb3cgb2YgY2FjaGUucm93cykge1xuICAgICAgY29uc3Qgc2t1ID0gU3RyaW5nKHNwUm93LnNrdSB8fCAnJykudHJpbSgpO1xuICAgICAgY29uc3Qgc2t1VXBwZXIgPSBza3UudG9VcHBlckNhc2UoKTtcbiAgICAgIC8vIHYxMTEyOiBza2lwZWFtb3MgU0tVcyBkZXNjb250aW51YWRvcyAoTWFyaWFubyBsb3MgbWFyY2EgZGVzZGUgbGEgVUkpLlxuICAgICAgaWYgKF9kaXNjb250aW51ZWRTa3VzICYmIF9kaXNjb250aW51ZWRTa3VzLmhhcyhza3VVcHBlcikpIGNvbnRpbnVlO1xuICAgICAgY29uc3Qgc3RvY2tXaCA9XG4gICAgICAgIChfcmVjb1N0b2NrU25hcHNob3QgJiZcbiAgICAgICAgICBfcmVjb1N0b2NrU25hcHNob3Qud2FyZWhvdXNlQnJlYWtkb3duICYmXG4gICAgICAgICAgX3JlY29TdG9ja1NuYXBzaG90LndhcmVob3VzZUJyZWFrZG93bltza3VdKSB8fFxuICAgICAgICB7fTtcbiAgICAgIGNvbnN0IHN0b2NrTGlicmUgPSBOdW1iZXIoc3RvY2tXaFsnMTEnXSB8fCAwKTtcbiAgICAgIGNvbnN0IGVuVHJhbnNpdG8gPSBOdW1iZXIoc3RvY2tXaFsnMTInXSB8fCAwKTtcbiAgICAgIGNvbnN0IGJhY2tvcmRlciA9IE51bWJlcihcbiAgICAgICAgKF9yZWNvU3RvY2tTbmFwc2hvdCAmJlxuICAgICAgICAgIF9yZWNvU3RvY2tTbmFwc2hvdC5iYWNrb3JkZXJCeVNrdSAmJlxuICAgICAgICAgIF9yZWNvU3RvY2tTbmFwc2hvdC5iYWNrb3JkZXJCeVNrdVtza3VdKSB8fFxuICAgICAgICAgIDBcbiAgICAgICk7XG4gICAgICBjb25zdCB2ZW50YU1lbnN1YWwgPSBfY29tcHV0ZVZlbnRhTWVuc3VhbFByb21lZGlvKHNrdVVwcGVyKTtcbiAgICAgIGNvbnN0IHNhbGVzUGxhbkZ1dCA9IF9jb21wdXRlU2FsZXNQbGFuRnV0dXJvKHNwUm93KTtcbiAgICAgIGNvbnN0IG1vcSA9IE51bWJlcihzcFJvdy5tb3EgfHwgMCk7XG4gICAgICAvLyB2MTExNCBGM0I6IG11bHRpcGxpY2Fkb3IgYXV0byAocmVjZW50L2Jhc2VsaW5lKSBvIG92ZXJyaWRlIG1hbnVhbC5cbiAgICAgIGNvbnN0IG11bHRJbmZvID0gX2dldEVmZmVjdGl2ZU11bHRpcGxpZXIoc2t1VXBwZXIpO1xuICAgICAgY29uc3QgbXVsdGlwbGllciA9IG11bHRJbmZvLnZhbHVlO1xuICAgICAgY29uc3QgZGVtYW5kYUVzcGVyYWRhID0gdmVudGFNZW5zdWFsICogbXVsdGlwbGllciAqIFJFQ09fSE9SSVpPTl9NT05USFM7XG4gICAgICBjb25zdCBiYWxhbmNlID0gc3RvY2tMaWJyZSArIGVuVHJhbnNpdG8gKyBzYWxlc1BsYW5GdXQgLSBiYWNrb3JkZXIgLSBkZW1hbmRhRXNwZXJhZGE7XG4gICAgICBsZXQgcmVjb21lbmRhZG8gPSAwO1xuICAgICAgaWYgKGJhbGFuY2UgPCAwKSB7XG4gICAgICAgIGNvbnN0IGRlZmljaXQgPSAtYmFsYW5jZTtcbiAgICAgICAgcmVjb21lbmRhZG8gPSBtb3EgPiAwID8gTWF0aC5tYXgobW9xLCBNYXRoLmNlaWwoZGVmaWNpdCAvIG1vcSkgKiBtb3EpIDogTWF0aC5jZWlsKGRlZmljaXQpO1xuICAgICAgfVxuICAgICAgcm93cy5wdXNoKHtcbiAgICAgICAgZmFtaWxpYTogZmFtLFxuICAgICAgICBza3UsXG4gICAgICAgIGRlc2NyaXB0aW9uOiBzcFJvdy5kZXNjcmlwdGlvbiB8fCAnJyxcbiAgICAgICAgbW9xLFxuICAgICAgICBzdG9ja0xpYnJlLFxuICAgICAgICBlblRyYW5zaXRvLFxuICAgICAgICBiYWNrb3JkZXIsXG4gICAgICAgIHZlbnRhTWVuc3VhbDogTWF0aC5yb3VuZCh2ZW50YU1lbnN1YWwgKiAxMCkgLyAxMCxcbiAgICAgICAgc2FsZXNQbGFuRnV0LFxuICAgICAgICBtdWx0aXBsaWVyLFxuICAgICAgICBtdWx0U291cmNlOiBtdWx0SW5mby5zb3VyY2UsIC8vICdhdXRvJyB8ICdtYW51YWwnIHwgJ2RlZmF1bHQnIHwgJ2ZhbGxiYWNrJ1xuICAgICAgICBtdWx0QXV0bzogbXVsdEluZm8uYXV0byA/IG11bHRJbmZvLmF1dG8udmFsdWUgOiBudWxsLCAvLyBlbCB2YWxvciBhdXRvIHNpIGhheSBvdmVycmlkZSBtYW51YWxcbiAgICAgICAgZGVtYW5kYUVzcGVyYWRhOiBNYXRoLnJvdW5kKGRlbWFuZGFFc3BlcmFkYSAqIDEwKSAvIDEwLFxuICAgICAgICBiYWxhbmNlOiBNYXRoLnJvdW5kKGJhbGFuY2UgKiAxMCkgLyAxMCxcbiAgICAgICAgcmVjb21lbmRhZG8sXG4gICAgICB9KTtcbiAgICB9XG4gIH1cbiAgLy8gT3JkZW5hciBwb3IgcmVjb21lbmRhZG8gZGVzY2VuZGVudGVcbiAgcm93cy5zb3J0KChhLCBiKSA9PiBiLnJlY29tZW5kYWRvIC0gYS5yZWNvbWVuZGFkbyk7XG4gIHJldHVybiByb3dzO1xufVxuXG5mdW5jdGlvbiBfZm10TnVtU2lnbmVkKG4pIHtcbiAgaWYgKG4gPT0gbnVsbCB8fCAhTnVtYmVyLmlzRmluaXRlKE51bWJlcihuKSkpIHJldHVybiAnXHUyMDE0JztcbiAgY29uc3QgdiA9IE51bWJlcihuKTtcbiAgY29uc3QgYWJzID0gTWF0aC5hYnModikudG9Mb2NhbGVTdHJpbmcoJ2VzLUFSJywgeyBtYXhpbXVtRnJhY3Rpb25EaWdpdHM6IDAgfSk7XG4gIHJldHVybiAodiA8IDAgPyAnXHUyMjEyJyA6ICcnKSArIGFicztcbn1cblxuZnVuY3Rpb24gX2ZtdEludChuKSB7XG4gIGlmIChuID09IG51bGwgfHwgIU51bWJlci5pc0Zpbml0ZShOdW1iZXIobikpKSByZXR1cm4gJ1x1MjAxNCc7XG4gIHJldHVybiBNYXRoLnJvdW5kKE51bWJlcihuKSkudG9Mb2NhbGVTdHJpbmcoJ2VzLUFSJyk7XG59XG5cbi8vIHYxMTE0IEYzQjogY2VsZGEgbXVsdGlwbGljYWRvciBjb24gY2hpcCBhdXRvL21hbnVhbCArIGlucHV0IGVkaXRhYmxlLlxuZnVuY3Rpb24gX2J1aWxkTXVsdENlbGxIdG1sKHIpIHtcbiAgY29uc3Qgc2t1VXBwZXIgPSBTdHJpbmcoci5za3UpLnRyaW0oKS50b1VwcGVyQ2FzZSgpO1xuICBjb25zdCBpc01hbnVhbCA9IHIubXVsdFNvdXJjZSA9PT0gJ21hbnVhbCc7XG4gIGNvbnN0IGlzRGVmYXVsdCA9IHIubXVsdFNvdXJjZSA9PT0gJ2RlZmF1bHQnO1xuICBjb25zdCB2YWwgPSBOdW1iZXIoci5tdWx0aXBsaWVyIHx8IDEuMCkudG9GaXhlZCgyKTtcbiAgLy8gQ29sb3IgcG9yIGRpcmVjY2lcdTAwRjNuOiA+MS4wNSB2ZXJkZSAoY3JlY2llbmRvKSwgPDAuOTUgcm9qbyAoY2F5ZW5kbyksIG1lZGlvIGdyaXMuXG4gIGxldCBkaXJDb2xvciA9ICd2YXIoLS10ZXh0LW11dGVkKSc7XG4gIGlmIChyLm11bHRpcGxpZXIgPiAxLjA1KSBkaXJDb2xvciA9ICcjMTZhMzRhJztcbiAgZWxzZSBpZiAoci5tdWx0aXBsaWVyIDwgMC45NSkgZGlyQ29sb3IgPSAnI2RjMjYyNic7XG5cbiAgY29uc3QgY2hpcCA9IGlzTWFudWFsXG4gICAgPyAnPHNwYW4gc3R5bGU9XCJkaXNwbGF5OmlubGluZS1ibG9jaztwYWRkaW5nOjFweCA1cHg7YmFja2dyb3VuZDojZjU5ZTBiO2NvbG9yOiNmZmY7Ym9yZGVyLXJhZGl1czo4cHg7Zm9udC1zaXplOjlweDtmb250LXdlaWdodDo3MDA7bWFyZ2luLWxlZnQ6NHB4XCIgdGl0bGU9XCJPdmVycmlkZSBtYW51YWw6IHBpc2EgZWwgYXV0b1wiPk08L3NwYW4+J1xuICAgIDogaXNEZWZhdWx0XG4gICAgICA/ICc8c3BhbiBzdHlsZT1cImRpc3BsYXk6aW5saW5lLWJsb2NrO3BhZGRpbmc6MXB4IDVweDtiYWNrZ3JvdW5kOiM5NGEzYjg7Y29sb3I6I2ZmZjtib3JkZXItcmFkaXVzOjhweDtmb250LXNpemU6OXB4O2ZvbnQtd2VpZ2h0OjcwMDttYXJnaW4tbGVmdDo0cHhcIiB0aXRsZT1cIlNpbiBkYXRvcyBzdWZpY2llbnRlczogdXNhIDEuMFwiPlx1MDBCNzwvc3Bhbj4nXG4gICAgICA6ICc8c3BhbiBzdHlsZT1cImRpc3BsYXk6aW5saW5lLWJsb2NrO3BhZGRpbmc6MXB4IDVweDtiYWNrZ3JvdW5kOiMwZDk0ODg7Y29sb3I6I2ZmZjtib3JkZXItcmFkaXVzOjhweDtmb250LXNpemU6OXB4O2ZvbnQtd2VpZ2h0OjcwMDttYXJnaW4tbGVmdDo0cHhcIiB0aXRsZT1cIkF1dG8gPSB2ZW50YSAybSAvIHZlbnRhIDZtXCI+QTwvc3Bhbj4nO1xuXG4gIGNvbnN0IHJlc2V0QnRuID0gaXNNYW51YWxcbiAgICA/ICc8YnV0dG9uIG9uY2xpY2s9XCJyZXNldE11bHRpcGxpZXIoXFwnJyArXG4gICAgICBlc2NhcGVIdG1sU2FmZShza3VVcHBlcikgK1xuICAgICAgJ1xcJylcIiB0aXRsZT1cIlZvbHZlciBhbCBhdXRvXCIgc3R5bGU9XCJtYXJnaW4tbGVmdDo0cHg7YmFja2dyb3VuZDp0cmFuc3BhcmVudDtib3JkZXI6bm9uZTtjdXJzb3I6cG9pbnRlcjtmb250LXNpemU6MTJweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTtwYWRkaW5nOjBcIj5cdTIxQkI8L2J1dHRvbj4nXG4gICAgOiAnJztcblxuICBjb25zdCBhdXRvSGludCA9XG4gICAgaXNNYW51YWwgJiYgci5tdWx0QXV0byAhPSBudWxsXG4gICAgICA/ICcgPHNwYW4gc3R5bGU9XCJmb250LXNpemU6MTBweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKVwiIHRpdGxlPVwiVmFsb3IgYXV0byBjYWxjdWxhZG9cIj4oYXV0byAnICtcbiAgICAgICAgTnVtYmVyKHIubXVsdEF1dG8pLnRvRml4ZWQoMikgK1xuICAgICAgICAnKTwvc3Bhbj4nXG4gICAgICA6ICcnO1xuXG4gIHJldHVybiAoXG4gICAgJzxzcGFuIHN0eWxlPVwiZGlzcGxheTppbmxpbmUtZmxleDthbGlnbi1pdGVtczpjZW50ZXI7Z2FwOjJweFwiPicgK1xuICAgICc8c3BhbiBvbmNsaWNrPVwiZWRpdE11bHRpcGxpZXIodGhpcywgXFwnJyArXG4gICAgZXNjYXBlSHRtbFNhZmUoc2t1VXBwZXIpICtcbiAgICAnXFwnKVwiIHN0eWxlPVwiY3Vyc29yOnBvaW50ZXI7cGFkZGluZzoycHggNnB4O2JvcmRlci1yYWRpdXM6NHB4O2JhY2tncm91bmQ6dmFyKC0tYmctc2Vjb25kYXJ5KTtmb250LXZhcmlhbnQtbnVtZXJpYzp0YWJ1bGFyLW51bXM7Zm9udC13ZWlnaHQ6NzAwO2NvbG9yOicgK1xuICAgIGRpckNvbG9yICtcbiAgICAnXCIgdGl0bGU9XCJDbGljayBwYXJhIGVkaXRhclwiPicgK1xuICAgIHZhbCArXG4gICAgJzwvc3Bhbj4nICtcbiAgICBjaGlwICtcbiAgICByZXNldEJ0biArXG4gICAgYXV0b0hpbnQgK1xuICAgICc8L3NwYW4+J1xuICApO1xufVxuXG53aW5kb3cuZWRpdE11bHRpcGxpZXIgPSBmdW5jdGlvbiAoZWwsIHNrdVVwcGVyKSB7XG4gIGNvbnN0IGN1cnJlbnRWYWwgPSBwYXJzZUZsb2F0KGVsLnRleHRDb250ZW50KSB8fCAxLjA7XG4gIGNvbnN0IGlucHV0ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnaW5wdXQnKTtcbiAgaW5wdXQudHlwZSA9ICdudW1iZXInO1xuICBpbnB1dC5zdGVwID0gJzAuMDUnO1xuICBpbnB1dC5taW4gPSAnMC4xJztcbiAgaW5wdXQubWF4ID0gJzUnO1xuICBpbnB1dC52YWx1ZSA9IFN0cmluZyhjdXJyZW50VmFsKTtcbiAgaW5wdXQuc3R5bGUuY3NzVGV4dCA9XG4gICAgJ3dpZHRoOjYwcHg7cGFkZGluZzoycHggNHB4O2ZvbnQtc2l6ZToxMnB4O2ZvbnQtd2VpZ2h0OjcwMDt0ZXh0LWFsaWduOmNlbnRlcjtib3JkZXI6MnB4IHNvbGlkICMwZDk0ODg7Ym9yZGVyLXJhZGl1czo0cHg7YmFja2dyb3VuZDp2YXIoLS1iZy1lbGV2YXRlZCk7Y29sb3I6dmFyKC0tdGV4dC1wcmltYXJ5KTtmb250LXZhcmlhbnQtbnVtZXJpYzp0YWJ1bGFyLW51bXMnO1xuICBjb25zdCBwYXJlbnQgPSBlbC5wYXJlbnROb2RlO1xuICBwYXJlbnQucmVwbGFjZUNoaWxkKGlucHV0LCBlbCk7XG4gIGlucHV0LmZvY3VzKCk7XG4gIGlucHV0LnNlbGVjdCgpO1xuXG4gIGNvbnN0IGNvbW1pdCA9IGFzeW5jICgpID0+IHtcbiAgICBjb25zdCB2ID0gcGFyc2VGbG9hdChpbnB1dC52YWx1ZSk7XG4gICAgaWYgKE51bWJlci5pc05hTih2KSB8fCB2IDwgMC4xIHx8IHYgPiA1KSB7XG4gICAgICBfcmVuZGVyUmVjb1NlY3Rpb24oKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgaWYgKE1hdGguYWJzKHYgLSBjdXJyZW50VmFsKSA8IDAuMDAxKSB7XG4gICAgICBfcmVuZGVyUmVjb1NlY3Rpb24oKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IF9zYXZlTXVsdGlwbGllck92ZXJyaWRlKHNrdVVwcGVyLCB2KTtcbiAgICAgIF9yZW5kZXJSZWNvU2VjdGlvbigpO1xuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgIGFsZXJ0KCdFcnJvciBndWFyZGFuZG86ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcbiAgICAgIF9yZW5kZXJSZWNvU2VjdGlvbigpO1xuICAgIH1cbiAgfTtcblxuICBjb25zdCBjYW5jZWwgPSAoKSA9PiBfcmVuZGVyUmVjb1NlY3Rpb24oKTtcblxuICBpbnB1dC5hZGRFdmVudExpc3RlbmVyKCdibHVyJywgY29tbWl0KTtcbiAgaW5wdXQuYWRkRXZlbnRMaXN0ZW5lcigna2V5ZG93bicsIChldikgPT4ge1xuICAgIGlmIChldi5rZXkgPT09ICdFbnRlcicpIHtcbiAgICAgIGV2LnByZXZlbnREZWZhdWx0KCk7XG4gICAgICBpbnB1dC5ibHVyKCk7XG4gICAgfSBlbHNlIGlmIChldi5rZXkgPT09ICdFc2NhcGUnKSB7XG4gICAgICBldi5wcmV2ZW50RGVmYXVsdCgpO1xuICAgICAgY2FuY2VsKCk7XG4gICAgfVxuICB9KTtcbn07XG5cbndpbmRvdy5yZXNldE11bHRpcGxpZXIgPSBhc3luYyBmdW5jdGlvbiAoc2t1VXBwZXIpIHtcbiAgaWYgKCFjb25maXJtKCdWb2x2ZXIgZWwgbXVsdGlwbGljYWRvciBkZSAnICsgc2t1VXBwZXIgKyAnIGFsIGNcdTAwRTFsY3VsbyBhdXRvbVx1MDBFMXRpY28/JykpIHJldHVybjtcbiAgdHJ5IHtcbiAgICBhd2FpdCBfcmVtb3ZlTXVsdGlwbGllck92ZXJyaWRlKHNrdVVwcGVyKTtcbiAgICBfcmVuZGVyUmVjb1NlY3Rpb24oKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGFsZXJ0KCdFcnJvcjogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xuICB9XG59O1xuXG5mdW5jdGlvbiBfcmVuZGVyUmVjb1NlY3Rpb24oKSB7XG4gIGNvbnN0IGNvbnQgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgncmVjby1zZWN0aW9uLWNvbnRhaW5lcicpO1xuICBpZiAoIWNvbnQpIHJldHVybjtcbiAgdHJ5IHtcbiAgICBfcmVuZGVyUmVjb1NlY3Rpb25JbXBsKGNvbnQpO1xuICB9IGNhdGNoIChlKSB7XG4gICAgY29uc29sZS5lcnJvcignW0ZPUkVDQVNUIHJlY29dIHJlbmRlciBmYWlsJywgZSk7XG4gICAgY29udC5pbm5lckhUTUwgPVxuICAgICAgJzxkaXYgc3R5bGU9XCJwYWRkaW5nOjIwcHg7Y29sb3I6I2RjMjYyNlwiPicgK1xuICAgICAgJzxkaXYgc3R5bGU9XCJmb250LXdlaWdodDo3MDA7bWFyZ2luLWJvdHRvbTo4cHhcIj5FcnJvciByZW5kZXJpemFuZG8gdGFibGEgcmVjb21lbmRhY2lcdTAwRjNuPC9kaXY+JyArXG4gICAgICAnPHByZSBzdHlsZT1cImZvbnQtc2l6ZToxMXB4O2JhY2tncm91bmQ6I2ZlZjJmMjtwYWRkaW5nOjEwcHg7Ym9yZGVyLXJhZGl1czo2cHg7b3ZlcmZsb3c6YXV0bzt3aGl0ZS1zcGFjZTpwcmUtd3JhcFwiPicgK1xuICAgICAgZXNjYXBlSHRtbFNhZmUoZS5zdGFjayB8fCBlLm1lc3NhZ2UgfHwgU3RyaW5nKGUpKSArXG4gICAgICAnPC9wcmU+PC9kaXY+JztcbiAgfVxufVxuXG5mdW5jdGlvbiBfcmVuZGVyUmVjb1NlY3Rpb25JbXBsKGNvbnQpIHtcbiAgY29uc3QgYW55TG9hZGVkID0gISEoX3NhbGVzUGxhbkNhY2hlcy5yb2RzIHx8IF9zYWxlc1BsYW5DYWNoZXMucmVlbHMpO1xuICBpZiAoIWFueUxvYWRlZCkge1xuICAgIGNvbnQuaW5uZXJIVE1MID0gJyc7XG4gICAgcmV0dXJuO1xuICB9XG4gIGlmICghX3JlY29TdG9ja1NuYXBzaG90IHx8ICFfcmVjb1ZlbnRhc1NuYXBzaG90KSB7XG4gICAgY29udC5pbm5lckhUTUwgPVxuICAgICAgJzxkaXYgc3R5bGU9XCJwYWRkaW5nOjQwcHggMThweDt0ZXh0LWFsaWduOmNlbnRlcjtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKVwiPicgK1xuICAgICAgJzxkaXYgc3R5bGU9XCJkaXNwbGF5OmlubGluZS1ibG9jazt3aWR0aDoyNHB4O2hlaWdodDoyNHB4O2JvcmRlcjozcHggc29saWQgIzBkOTQ4ODtib3JkZXItdG9wLWNvbG9yOnRyYW5zcGFyZW50O2JvcmRlci1yYWRpdXM6NTAlO2FuaW1hdGlvbjpzcGluIDAuOHMgbGluZWFyIGluZmluaXRlO21hcmdpbi1ib3R0b206MTBweFwiPjwvZGl2PicgK1xuICAgICAgJzxkaXY+Q2FyZ2FuZG8gc3RvY2sgKyB2ZW50YXMgaGlzdFx1MDBGM3JpY2FzLi4uPC9kaXY+JyArXG4gICAgICAnPHN0eWxlPkBrZXlmcmFtZXMgc3Bpbnt0b3t0cmFuc2Zvcm06cm90YXRlKDM2MGRlZyl9fTwvc3R5bGU+PC9kaXY+JztcbiAgICBfbG9hZFJlY29EYXRhKClcbiAgICAgIC50aGVuKF9yZW5kZXJSZWNvU2VjdGlvbilcbiAgICAgIC5jYXRjaCgoZSkgPT4ge1xuICAgICAgICBjb25zb2xlLmVycm9yKCdbRk9SRUNBU1QgcmVjb10gbG9hZCBmYWlsJywgZSk7XG4gICAgICAgIGNvbnQuaW5uZXJIVE1MID1cbiAgICAgICAgICAnPGRpdiBzdHlsZT1cInBhZGRpbmc6MjBweDtjb2xvcjojZGMyNjI2XCI+RXJyb3IgY2FyZ2FuZG8gZGF0b3M6ICcgK1xuICAgICAgICAgIGVzY2FwZUh0bWxTYWZlKGUubWVzc2FnZSB8fCBTdHJpbmcoZSkpICtcbiAgICAgICAgICAnPC9kaXY+JztcbiAgICAgIH0pO1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCBhbGxSb3dzID0gX2NvbXB1dGVSZWNvbW1lbmRhdGlvbnMoKTtcbiAgY29uc3Qgc2VhcmNoTGMgPSBfcmVjb1NlYXJjaFRleHQudHJpbSgpLnRvTG93ZXJDYXNlKCk7XG4gIGNvbnN0IHJvd3MgPSBhbGxSb3dzLmZpbHRlcigocikgPT4ge1xuICAgIGlmIChfcmVjb0ZpbHRlckZhbWlsaWEgIT09ICdhbGwnICYmIHIuZmFtaWxpYSAhPT0gX3JlY29GaWx0ZXJGYW1pbGlhKSByZXR1cm4gZmFsc2U7XG4gICAgaWYgKF9yZWNvRmlsdGVyTWluUmVjICYmIHIucmVjb21lbmRhZG8gPD0gMCkgcmV0dXJuIGZhbHNlO1xuICAgIGlmIChzZWFyY2hMYykge1xuICAgICAgY29uc3QgaGF5ID1cbiAgICAgICAgci5za3UudG9Mb3dlckNhc2UoKS5pbmNsdWRlcyhzZWFyY2hMYykgfHwgci5kZXNjcmlwdGlvbi50b0xvd2VyQ2FzZSgpLmluY2x1ZGVzKHNlYXJjaExjKTtcbiAgICAgIGlmICghaGF5KSByZXR1cm4gZmFsc2U7XG4gICAgfVxuICAgIHJldHVybiB0cnVlO1xuICB9KTtcbiAgY29uc3QgdG90YWxSZWNvID0gYWxsUm93cy5yZWR1Y2UoKHMsIHIpID0+IHMgKyByLnJlY29tZW5kYWRvLCAwKTtcbiAgY29uc3QgdG90YWxDb25SZWNvID0gYWxsUm93cy5maWx0ZXIoKHIpID0+IHIucmVjb21lbmRhZG8gPiAwKS5sZW5ndGg7XG5cbiAgY29uc3QgbkRpc2MgPSBfZGlzY29udGludWVkU2t1cyA/IF9kaXNjb250aW51ZWRTa3VzLnNpemUgOiAwO1xuICBjb25zdCBkaXNjQ2hpcCA9XG4gICAgbkRpc2MgPiAwXG4gICAgICA/ICc8YnV0dG9uIG9uY2xpY2s9XCJvcGVuRGlzY29udGludWVkTW9kYWwoKVwiIHN0eWxlPVwicGFkZGluZzo2cHggMTJweDtiYWNrZ3JvdW5kOiM5MzMzZWE7Y29sb3I6I2ZmZjtib3JkZXI6bm9uZTtib3JkZXItcmFkaXVzOjZweDtmb250LXNpemU6MTJweDtmb250LXdlaWdodDo3MDA7Y3Vyc29yOnBvaW50ZXJcIiB0aXRsZT1cIkdlc3Rpb25hciBTS1VzIGRlc2NvbnRpbnVhZG9zXCI+XHVEODNEXHVERUFCICcgK1xuICAgICAgICBfZm10SW50KG5EaXNjKSArXG4gICAgICAgICcgZGVzY29udGludWFkb3M8L2J1dHRvbj4nXG4gICAgICA6ICcnO1xuXG4gIGNvbnN0IGhlYWRlciA9XG4gICAgJzxkaXYgc3R5bGU9XCJkaXNwbGF5OmZsZXg7ZmxleC13cmFwOndyYXA7Z2FwOjEwcHg7YWxpZ24taXRlbXM6Y2VudGVyO21hcmdpbi1ib3R0b206MTJweFwiPicgK1xuICAgICc8ZGl2IHN0eWxlPVwiZmxleDoxO21pbi13aWR0aDoyODBweFwiPjxkaXYgc3R5bGU9XCJmb250LXNpemU6MThweDtmb250LXdlaWdodDo4MDA7Y29sb3I6dmFyKC0tdGV4dC1wcmltYXJ5KVwiPlJlY29tZW5kYWNpXHUwMEYzbiBkZSBDb21wcmE8L2Rpdj4nICtcbiAgICAnPGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMXB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO21hcmdpbi10b3A6MnB4XCI+QmFsYW5jZSA9IFN0b2NrICsgVHJcdTAwRTFuc2l0byArIFBsYW4gXHUyMjEyIEJhY2tvcmRlciBcdTIyMTIgKFZlbnRhIG1lbnMuIFx1MDBENyAnICtcbiAgICBSRUNPX0hPUklaT05fTU9OVEhTICtcbiAgICAnbSk8L2Rpdj48L2Rpdj4nICtcbiAgICAnPGRpdiBzdHlsZT1cInBhZGRpbmc6NnB4IDEycHg7YmFja2dyb3VuZDojMGQ5NDg4O2NvbG9yOiNmZmY7Ym9yZGVyLXJhZGl1czo2cHg7Zm9udC1zaXplOjEycHg7Zm9udC13ZWlnaHQ6NzAwXCI+JyArXG4gICAgX2ZtdEludCh0b3RhbENvblJlY28pICtcbiAgICAnIFNLVXMgY29uIHJlY288L2Rpdj4nICtcbiAgICAnPGRpdiBzdHlsZT1cInBhZGRpbmc6NnB4IDEycHg7YmFja2dyb3VuZDojMTM0ZTRhO2NvbG9yOiNmZmY7Ym9yZGVyLXJhZGl1czo2cHg7Zm9udC1zaXplOjEycHg7Zm9udC13ZWlnaHQ6NzAwXCI+XHUwM0EzICcgK1xuICAgIF9mbXRJbnQodG90YWxSZWNvKSArXG4gICAgJyB1bmlkYWRlczwvZGl2PicgK1xuICAgIGRpc2NDaGlwICtcbiAgICAnPC9kaXY+JztcblxuICBjb25zdCBmaWx0ZXJzID1cbiAgICAnPGRpdiBzdHlsZT1cImRpc3BsYXk6ZmxleDtmbGV4LXdyYXA6d3JhcDtnYXA6OHB4O21hcmdpbi1ib3R0b206MTBweDtwYWRkaW5nOjEwcHg7YmFja2dyb3VuZDp2YXIoLS1iZy1zZWNvbmRhcnkpO2JvcmRlci1yYWRpdXM6NnB4XCI+JyArXG4gICAgJzxpbnB1dCB0eXBlPVwidGV4dFwiIGlkPVwicmVjby1zZWFyY2hcIiBwbGFjZWhvbGRlcj1cIkJ1c2NhciBTS1UgbyBkZXNjcmlwY2lvbi4uLlwiIHZhbHVlPVwiJyArXG4gICAgZXNjYXBlSHRtbFNhZmUoX3JlY29TZWFyY2hUZXh0KSArXG4gICAgJ1wiIG9uaW5wdXQ9XCJvblJlY29TZWFyY2hDaGFuZ2UoZXZlbnQpXCIgc3R5bGU9XCJmbGV4OjE7bWluLXdpZHRoOjIwMHB4O3BhZGRpbmc6NnB4IDEwcHg7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1ib3JkZXItc3VidGxlKTtib3JkZXItcmFkaXVzOjRweDtmb250LXNpemU6MTJweDtiYWNrZ3JvdW5kOnZhcigtLWJnLWVsZXZhdGVkKTtjb2xvcjp2YXIoLS10ZXh0LXByaW1hcnkpXCIvPicgK1xuICAgICc8c2VsZWN0IG9uY2hhbmdlPVwib25SZWNvRmFtaWxpYUNoYW5nZShldmVudClcIiBzdHlsZT1cInBhZGRpbmc6NnB4IDEwcHg7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1ib3JkZXItc3VidGxlKTtib3JkZXItcmFkaXVzOjRweDtmb250LXNpemU6MTJweDtiYWNrZ3JvdW5kOnZhcigtLWJnLWVsZXZhdGVkKTtjb2xvcjp2YXIoLS10ZXh0LXByaW1hcnkpXCI+JyArXG4gICAgJzxvcHRpb24gdmFsdWU9XCJhbGxcIicgK1xuICAgIChfcmVjb0ZpbHRlckZhbWlsaWEgPT09ICdhbGwnID8gJyBzZWxlY3RlZCcgOiAnJykgK1xuICAgICc+VG9kYXMgbGFzIGZhbWlsaWFzPC9vcHRpb24+JyArXG4gICAgJzxvcHRpb24gdmFsdWU9XCJyb2RzXCInICtcbiAgICAoX3JlY29GaWx0ZXJGYW1pbGlhID09PSAncm9kcycgPyAnIHNlbGVjdGVkJyA6ICcnKSArXG4gICAgJz5Tb2xvIFJvZHMgKENhXHUwMEYxYXMpPC9vcHRpb24+JyArXG4gICAgJzxvcHRpb24gdmFsdWU9XCJyZWVsc1wiJyArXG4gICAgKF9yZWNvRmlsdGVyRmFtaWxpYSA9PT0gJ3JlZWxzJyA/ICcgc2VsZWN0ZWQnIDogJycpICtcbiAgICAnPlNvbG8gUmVlbHM8L29wdGlvbj4nICtcbiAgICAnPC9zZWxlY3Q+JyArXG4gICAgJzxsYWJlbCBzdHlsZT1cImRpc3BsYXk6aW5saW5lLWZsZXg7YWxpZ24taXRlbXM6Y2VudGVyO2dhcDo2cHg7cGFkZGluZzo2cHggMTBweDtmb250LXNpemU6MTJweDtjb2xvcjp2YXIoLS10ZXh0LXByaW1hcnkpO2N1cnNvcjpwb2ludGVyXCI+JyArXG4gICAgJzxpbnB1dCB0eXBlPVwiY2hlY2tib3hcIicgK1xuICAgIChfcmVjb0ZpbHRlck1pblJlYyA/ICcgY2hlY2tlZCcgOiAnJykgK1xuICAgICcgb25jaGFuZ2U9XCJvblJlY29GaWx0ZXJNaW5DaGFuZ2UoZXZlbnQpXCIvPicgK1xuICAgICdTb2xvIGNvbiByZWNvbWVuZGFkbyAmZ3Q7IDA8L2xhYmVsPicgK1xuICAgICc8YnV0dG9uIG9uY2xpY2s9XCJleHBvcnRSZWNvRXhjZWwoKVwiIHN0eWxlPVwicGFkZGluZzo2cHggMTJweDtiYWNrZ3JvdW5kOiMxNmEzNGE7Y29sb3I6I2ZmZjtib3JkZXI6bm9uZTtib3JkZXItcmFkaXVzOjRweDtmb250LXNpemU6MTJweDtmb250LXdlaWdodDo3MDA7Y3Vyc29yOnBvaW50ZXJcIj5cdTJCMDcgRXhjZWw8L2J1dHRvbj4nICtcbiAgICAnPC9kaXY+JztcblxuICBjb25zdCByb3dzSHRtbCA9IHJvd3NcbiAgICAubWFwKChyKSA9PiB7XG4gICAgICBjb25zdCBiYWxDb2xvciA9IHIuYmFsYW5jZSA8IDAgPyAnI2RjMjYyNicgOiByLmJhbGFuY2UgPCA1MCA/ICcjZjU5ZTBiJyA6ICcjMTZhMzRhJztcbiAgICAgIGNvbnN0IHJlY0NvbG9yID0gci5yZWNvbWVuZGFkbyA+IDAgPyAnI2RjMjYyNicgOiAnIzk0YTNiOCc7XG4gICAgICByZXR1cm4gKFxuICAgICAgICAnPHRyIHN0eWxlPVwiYm9yZGVyLWJvdHRvbToxcHggc29saWQgdmFyKC0tYm9yZGVyLXN1YnRsZSlcIj4nICtcbiAgICAgICAgJzx0ZCBzdHlsZT1cInBhZGRpbmc6NnB4IDhweDt0ZXh0LWFsaWduOmNlbnRlclwiPjxzcGFuIHN0eWxlPVwiZGlzcGxheTppbmxpbmUtYmxvY2s7cGFkZGluZzoycHggNnB4O2JvcmRlci1yYWRpdXM6MTBweDtiYWNrZ3JvdW5kOicgK1xuICAgICAgICAoci5mYW1pbGlhID09PSAncm9kcycgPyAnIzBlYTVlOScgOiAnIzhiNWNmNicpICtcbiAgICAgICAgJztjb2xvcjojZmZmO2ZvbnQtc2l6ZToxMHB4O2ZvbnQtd2VpZ2h0OjcwMFwiPicgK1xuICAgICAgICAoci5mYW1pbGlhID09PSAncm9kcycgPyAnUk9EJyA6ICdSRUVMJykgK1xuICAgICAgICAnPC9zcGFuPjwvdGQ+JyArXG4gICAgICAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjZweCA4cHg7dGV4dC1hbGlnbjpjZW50ZXI7Zm9udC1mYW1pbHk6bW9ub3NwYWNlO2ZvbnQtc2l6ZToxMXB4O2NvbG9yOnZhcigtLXRleHQtcHJpbWFyeSk7Zm9udC13ZWlnaHQ6NzAwXCI+JyArXG4gICAgICAgIGVzY2FwZUh0bWxTYWZlKHIuc2t1KSArXG4gICAgICAgICc8L3RkPicgK1xuICAgICAgICAnPHRkIHN0eWxlPVwicGFkZGluZzo2cHggOHB4O2ZvbnQtc2l6ZToxMXB4O2NvbG9yOnZhcigtLXRleHQtc2Vjb25kYXJ5KTttYXgtd2lkdGg6MjQwcHg7b3ZlcmZsb3c6aGlkZGVuO3RleHQtb3ZlcmZsb3c6ZWxsaXBzaXM7d2hpdGUtc3BhY2U6bm93cmFwXCIgdGl0bGU9XCInICtcbiAgICAgICAgZXNjYXBlSHRtbFNhZmUoci5kZXNjcmlwdGlvbikgK1xuICAgICAgICAnXCI+JyArXG4gICAgICAgIGVzY2FwZUh0bWxTYWZlKHIuZGVzY3JpcHRpb24pICtcbiAgICAgICAgJzwvdGQ+JyArXG4gICAgICAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjZweCA4cHg7dGV4dC1hbGlnbjpjZW50ZXI7Zm9udC12YXJpYW50LW51bWVyaWM6dGFidWxhci1udW1zO2NvbG9yOnZhcigtLXRleHQtcHJpbWFyeSlcIj4nICtcbiAgICAgICAgX2ZtdEludChyLnN0b2NrTGlicmUpICtcbiAgICAgICAgJzwvdGQ+JyArXG4gICAgICAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjZweCA4cHg7dGV4dC1hbGlnbjpjZW50ZXI7Zm9udC12YXJpYW50LW51bWVyaWM6dGFidWxhci1udW1zO2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpXCI+JyArXG4gICAgICAgIF9mbXRJbnQoci5lblRyYW5zaXRvKSArXG4gICAgICAgICc8L3RkPicgK1xuICAgICAgICAnPHRkIHN0eWxlPVwicGFkZGluZzo2cHggOHB4O3RleHQtYWxpZ246Y2VudGVyO2ZvbnQtdmFyaWFudC1udW1lcmljOnRhYnVsYXItbnVtcztjb2xvcjojZGMyNjI2XCI+JyArXG4gICAgICAgIF9mbXRJbnQoci5iYWNrb3JkZXIpICtcbiAgICAgICAgJzwvdGQ+JyArXG4gICAgICAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjZweCA4cHg7dGV4dC1hbGlnbjpjZW50ZXI7Zm9udC12YXJpYW50LW51bWVyaWM6dGFidWxhci1udW1zO2NvbG9yOnZhcigtLXRleHQtc2Vjb25kYXJ5KVwiPicgK1xuICAgICAgICBfZm10SW50KHIudmVudGFNZW5zdWFsKSArXG4gICAgICAgICc8L3RkPicgK1xuICAgICAgICAnPHRkIHN0eWxlPVwicGFkZGluZzo2cHggOHB4O3RleHQtYWxpZ246Y2VudGVyXCI+JyArXG4gICAgICAgIF9idWlsZE11bHRDZWxsSHRtbChyKSArXG4gICAgICAgICc8L3RkPicgK1xuICAgICAgICAnPHRkIHN0eWxlPVwicGFkZGluZzo2cHggOHB4O3RleHQtYWxpZ246Y2VudGVyO2ZvbnQtdmFyaWFudC1udW1lcmljOnRhYnVsYXItbnVtcztjb2xvcjp2YXIoLS10ZXh0LXNlY29uZGFyeSlcIj4nICtcbiAgICAgICAgX2ZtdEludChyLmRlbWFuZGFFc3BlcmFkYSkgK1xuICAgICAgICAnPC90ZD4nICtcbiAgICAgICAgJzx0ZCBzdHlsZT1cInBhZGRpbmc6NnB4IDhweDt0ZXh0LWFsaWduOmNlbnRlcjtmb250LXZhcmlhbnQtbnVtZXJpYzp0YWJ1bGFyLW51bXM7Y29sb3I6dmFyKC0tdGV4dC1wcmltYXJ5KTtmb250LXdlaWdodDo2MDBcIj4nICtcbiAgICAgICAgX2ZtdEludChyLnNhbGVzUGxhbkZ1dCkgK1xuICAgICAgICAnPC90ZD4nICtcbiAgICAgICAgJzx0ZCBzdHlsZT1cInBhZGRpbmc6NnB4IDhweDt0ZXh0LWFsaWduOmNlbnRlcjtmb250LXZhcmlhbnQtbnVtZXJpYzp0YWJ1bGFyLW51bXM7Zm9udC13ZWlnaHQ6NzAwO2NvbG9yOicgK1xuICAgICAgICBiYWxDb2xvciArXG4gICAgICAgICdcIj4nICtcbiAgICAgICAgX2ZtdE51bVNpZ25lZChyLmJhbGFuY2UpICtcbiAgICAgICAgJzwvdGQ+JyArXG4gICAgICAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjZweCA4cHg7dGV4dC1hbGlnbjpjZW50ZXI7Zm9udC12YXJpYW50LW51bWVyaWM6dGFidWxhci1udW1zO2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO2ZvbnQtc2l6ZToxMXB4XCI+JyArXG4gICAgICAgIF9mbXRJbnQoci5tb3EpICtcbiAgICAgICAgJzwvdGQ+JyArXG4gICAgICAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjZweCA4cHg7dGV4dC1hbGlnbjpjZW50ZXJcIj48c3BhbiBzdHlsZT1cImRpc3BsYXk6aW5saW5lLWJsb2NrO3BhZGRpbmc6NHB4IDEwcHg7Ym9yZGVyLXJhZGl1czoxMnB4O2JhY2tncm91bmQ6JyArXG4gICAgICAgIHJlY0NvbG9yICtcbiAgICAgICAgJztjb2xvcjojZmZmO2ZvbnQtc2l6ZToxMnB4O2ZvbnQtd2VpZ2h0OjgwMDttaW4td2lkdGg6NTBweFwiPicgK1xuICAgICAgICBfZm10SW50KHIucmVjb21lbmRhZG8pICtcbiAgICAgICAgJzwvc3Bhbj48L3RkPicgK1xuICAgICAgICAnPHRkIHN0eWxlPVwicGFkZGluZzo2cHggOHB4O3RleHQtYWxpZ246Y2VudGVyXCI+JyArXG4gICAgICAgICc8YnV0dG9uIG9uY2xpY2s9XCJkaXNjb250aW51ZVNrdShcXCcnICtcbiAgICAgICAgZXNjYXBlSHRtbFNhZmUoci5za3UpICtcbiAgICAgICAgXCInLCAnXCIgK1xuICAgICAgICBlc2NhcGVIdG1sU2FmZShyLmRlc2NyaXB0aW9uLnJlcGxhY2UoLycvZywgJycpKSArXG4gICAgICAgICdcXCcpXCIgdGl0bGU9XCJEZXNjb250aW51YXIgZXN0ZSBTS1VcIiBzdHlsZT1cImJhY2tncm91bmQ6dHJhbnNwYXJlbnQ7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1ib3JkZXItc3VidGxlKTtib3JkZXItcmFkaXVzOjRweDtwYWRkaW5nOjRweCA4cHg7Y3Vyc29yOnBvaW50ZXI7Zm9udC1zaXplOjE0cHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZClcIj5cdUQ4M0RcdURERDE8L2J1dHRvbj4nICtcbiAgICAgICAgJzwvdGQ+JyArXG4gICAgICAgICc8L3RyPidcbiAgICAgICk7XG4gICAgfSlcbiAgICAuam9pbignJyk7XG5cbiAgLy8gdjExMTI6IG1pbi13aWR0aCBwYXJhIGZvcnphciBzY3JvbGwgaG9yaXpvbnRhbCBzaSBubyBjYWJlIGxhIGNvbHVtbmFcbiAgLy8gQWNjaVx1MDBGM24uIFNpbiBlc3RvLCB0YWJsZSB3aWR0aDoxMDAlIGNvbXByaW1lIHRvZG8geSBsYSBcdTAwRkFsdGltYSBjb2x1bW5hXG4gIC8vIHF1ZWRhIGZ1ZXJhIGRlbCB2aWV3cG9ydCBzaW4gc2Nyb2xsIHZpc2libGUuXG4gIGNvbnN0IHRhYmxlID1cbiAgICAnPGRpdiBzdHlsZT1cIm92ZXJmbG93OmF1dG87bWF4LWhlaWdodDo2MHZoO2JvcmRlcjoxcHggc29saWQgdmFyKC0tYm9yZGVyLXN1YnRsZSk7Ym9yZGVyLXJhZGl1czo4cHhcIj4nICtcbiAgICAnPHRhYmxlIHN0eWxlPVwid2lkdGg6MTAwJTttaW4td2lkdGg6MTQwMHB4O2JvcmRlci1jb2xsYXBzZTpjb2xsYXBzZTtmb250LXNpemU6MTJweFwiPicgK1xuICAgICc8dGhlYWQgc3R5bGU9XCJiYWNrZ3JvdW5kOiMwZjE3MmE7Y29sb3I6I2ZmZjtwb3NpdGlvbjpzdGlja3k7dG9wOjA7ei1pbmRleDoxXCI+PHRyPicgK1xuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjhweDt0ZXh0LWFsaWduOmNlbnRlcjtmb250LXNpemU6MTBweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2VcIj5GYW08L3RoPicgK1xuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjhweDt0ZXh0LWFsaWduOmNlbnRlcjtmb250LXNpemU6MTBweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2VcIj5TS1U8L3RoPicgK1xuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjhweDt0ZXh0LWFsaWduOmNlbnRlcjtmb250LXNpemU6MTBweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2VcIj5EZXNjcmlwY2lcdTAwRjNuPC90aD4nICtcbiAgICAnPHRoIHN0eWxlPVwicGFkZGluZzo4cHg7dGV4dC1hbGlnbjpjZW50ZXI7Zm9udC1zaXplOjEwcHg7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlXCIgdGl0bGU9XCJXaHMgMTEgZGlzcG9uaWJsZSB2ZW50YVwiPlN0b2NrPC90aD4nICtcbiAgICAnPHRoIHN0eWxlPVwicGFkZGluZzo4cHg7dGV4dC1hbGlnbjpjZW50ZXI7Zm9udC1zaXplOjEwcHg7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlXCIgdGl0bGU9XCJXaHMgMTJcIj5Uclx1MDBFMW5zaXRvPC90aD4nICtcbiAgICAnPHRoIHN0eWxlPVwicGFkZGluZzo4cHg7dGV4dC1hbGlnbjpjZW50ZXI7Zm9udC1zaXplOjEwcHg7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlXCI+QmFja29yZGVyPC90aD4nICtcbiAgICAnPHRoIHN0eWxlPVwicGFkZGluZzo4cHg7dGV4dC1hbGlnbjpjZW50ZXI7Zm9udC1zaXplOjEwcHg7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlXCIgdGl0bGU9XCJQcm9tZWRpbyBcdTAwRkFsdGltb3MgMyBtZXNlc1wiPlZ0YS9tZXM8L3RoPicgK1xuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjhweDt0ZXh0LWFsaWduOmNlbnRlcjtmb250LXNpemU6MTBweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2VcIiB0aXRsZT1cIk11bHRpcGxpY2Fkb3IgZGUgdGVuZGVuY2lhID0gdmVudGEgMm0gLyB2ZW50YSA2bS4gRWRpdGFibGUgKGNsaWNrIHBhcmEgb3ZlcnJpZGUpLlwiPk11bHRpcC48L3RoPicgK1xuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjhweDt0ZXh0LWFsaWduOmNlbnRlcjtmb250LXNpemU6MTBweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2VcIiB0aXRsZT1cIlZ0YS9tZXMgXHUwMEQ3IDcgbWVzZXNcIj5EZW1hbmRhIGVzcC48L3RoPicgK1xuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjhweDt0ZXh0LWFsaWduOmNlbnRlcjtmb250LXNpemU6MTBweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2VcIiB0aXRsZT1cIlN1bWEgY29sdW1uYXMgU2FsZXMgUGxhbiBkZXNkZSBtZXMgYWN0dWFsXCI+UGxhbiBmdXR1cm88L3RoPicgK1xuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjhweDt0ZXh0LWFsaWduOmNlbnRlcjtmb250LXNpemU6MTBweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2VcIj5CYWxhbmNlPC90aD4nICtcbiAgICAnPHRoIHN0eWxlPVwicGFkZGluZzo4cHg7dGV4dC1hbGlnbjpjZW50ZXI7Zm9udC1zaXplOjEwcHg7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlXCI+TU9RPC90aD4nICtcbiAgICAnPHRoIHN0eWxlPVwicGFkZGluZzo4cHg7dGV4dC1hbGlnbjpjZW50ZXI7Zm9udC1zaXplOjEwcHg7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO2JhY2tncm91bmQ6IzEzNGU0YVwiPlJlY29tZW5kYWRvPC90aD4nICtcbiAgICAnPHRoIHN0eWxlPVwicGFkZGluZzo4cHg7dGV4dC1hbGlnbjpjZW50ZXI7Zm9udC1zaXplOjEwcHg7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlXCIgdGl0bGU9XCJEZXNjb250aW51YXIgU0tVXCI+QWNjaVx1MDBGM248L3RoPicgK1xuICAgICc8L3RyPjwvdGhlYWQ+PHRib2R5PicgK1xuICAgIChyb3dzLmxlbmd0aFxuICAgICAgPyByb3dzSHRtbFxuICAgICAgOiAnPHRyPjx0ZCBjb2xzcGFuPVwiMTRcIiBzdHlsZT1cInBhZGRpbmc6NDBweDt0ZXh0LWFsaWduOmNlbnRlcjtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKVwiPlNpbiByZXN1bHRhZG9zIGNvbiBsb3MgZmlsdHJvcyBhY3R1YWxlczwvdGQ+PC90cj4nKSArXG4gICAgJzwvdGJvZHk+PC90YWJsZT48L2Rpdj4nO1xuXG4gIGNvbnN0IGZvb3RlciA9XG4gICAgJzxkaXYgc3R5bGU9XCJtYXJnaW4tdG9wOjhweDtmb250LXNpemU6MTBweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKVwiPicgK1xuICAgICdNb3N0cmFuZG8gJyArXG4gICAgX2ZtdEludChyb3dzLmxlbmd0aCkgK1xuICAgICcgZGUgJyArXG4gICAgX2ZtdEludChhbGxSb3dzLmxlbmd0aCkgK1xuICAgICcgU0tVcyBcdTAwQjcgJyArXG4gICAgJ0JhbGFuY2UgPSBTdG9jayArIFRyXHUwMEUxbnNpdG8gKyBQbGFuIFx1MjIxMiBCYWNrb3JkZXIgXHUyMjEyIERlbWFuZGEuIFJvam8gPSBxdWllYnJlIGVzcGVyYWRvLiBSZWNvbWVuZGFkbyBzZSByZWRvbmRlYSBhbCBtXHUwMEZBbHRpcGxvIGRlIE1PUSBzdXBlcmlvci4nICtcbiAgICAnPC9kaXY+JztcblxuICBjb250LmlubmVySFRNTCA9XG4gICAgJzxkaXYgc3R5bGU9XCJwYWRkaW5nOjE4cHggMThweCAzMHB4XCI+JyArIGhlYWRlciArIGZpbHRlcnMgKyB0YWJsZSArIGZvb3RlciArICc8L2Rpdj4nO1xufVxuXG53aW5kb3cub25SZWNvU2VhcmNoQ2hhbmdlID0gZnVuY3Rpb24gKGV2KSB7XG4gIF9yZWNvU2VhcmNoVGV4dCA9IGV2LnRhcmdldC52YWx1ZSB8fCAnJztcbiAgX3JlbmRlclJlY29TZWN0aW9uKCk7XG4gIC8vIFJlc3RhdXJhciBmb2N1cyArIGNhcmV0IGFsIGlucHV0XG4gIHNldFRpbWVvdXQoKCkgPT4ge1xuICAgIGNvbnN0IGlucCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdyZWNvLXNlYXJjaCcpO1xuICAgIGlmIChpbnApIHtcbiAgICAgIGlucC5mb2N1cygpO1xuICAgICAgaW5wLnNldFNlbGVjdGlvblJhbmdlKGlucC52YWx1ZS5sZW5ndGgsIGlucC52YWx1ZS5sZW5ndGgpO1xuICAgIH1cbiAgfSwgMCk7XG59O1xuXG53aW5kb3cub25SZWNvRmFtaWxpYUNoYW5nZSA9IGZ1bmN0aW9uIChldikge1xuICBfcmVjb0ZpbHRlckZhbWlsaWEgPSBldi50YXJnZXQudmFsdWUgfHwgJ2FsbCc7XG4gIF9yZW5kZXJSZWNvU2VjdGlvbigpO1xufTtcblxud2luZG93Lm9uUmVjb0ZpbHRlck1pbkNoYW5nZSA9IGZ1bmN0aW9uIChldikge1xuICBfcmVjb0ZpbHRlck1pblJlYyA9ICEhZXYudGFyZ2V0LmNoZWNrZWQ7XG4gIF9yZW5kZXJSZWNvU2VjdGlvbigpO1xufTtcblxud2luZG93LmV4cG9ydFJlY29FeGNlbCA9IGZ1bmN0aW9uICgpIHtcbiAgaWYgKHR5cGVvZiBYTFNYID09PSAndW5kZWZpbmVkJykge1xuICAgIGFsZXJ0KCdTaGVldEpTIChYTFNYKSBubyBjYXJnYWRvJyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGNvbnN0IHJvd3MgPSBfY29tcHV0ZVJlY29tbWVuZGF0aW9ucygpO1xuICBjb25zdCBhb2EgPSBbXG4gICAgW1xuICAgICAgJ0ZhbWlsaWEnLFxuICAgICAgJ1NLVScsXG4gICAgICAnRGVzY3JpcGNpXHUwMEYzbicsXG4gICAgICAnU3RvY2snLFxuICAgICAgJ1RyXHUwMEUxbnNpdG8nLFxuICAgICAgJ0JhY2tvcmRlcicsXG4gICAgICAnVnRhIHByb20vbWVzJyxcbiAgICAgICdNdWx0aXBsaWNhZG9yJyxcbiAgICAgICdPcmlnZW4gbXVsdCcsXG4gICAgICAnRGVtYW5kYSBlc3AuIDdtJyxcbiAgICAgICdTYWxlcyBQbGFuIGZ1dHVybycsXG4gICAgICAnQmFsYW5jZScsXG4gICAgICAnTU9RJyxcbiAgICAgICdSZWNvbWVuZGFkbycsXG4gICAgXSxcbiAgXTtcbiAgZm9yIChjb25zdCByIG9mIHJvd3MpIHtcbiAgICBhb2EucHVzaChbXG4gICAgICByLmZhbWlsaWEgPT09ICdyb2RzJyA/ICdSb2RzIChDYVx1MDBGMWFzKScgOiAnUmVlbHMnLFxuICAgICAgci5za3UsXG4gICAgICByLmRlc2NyaXB0aW9uLFxuICAgICAgci5zdG9ja0xpYnJlLFxuICAgICAgci5lblRyYW5zaXRvLFxuICAgICAgci5iYWNrb3JkZXIsXG4gICAgICByLnZlbnRhTWVuc3VhbCxcbiAgICAgIHIubXVsdGlwbGllcixcbiAgICAgIHIubXVsdFNvdXJjZSB8fCAnYXV0bycsXG4gICAgICByLmRlbWFuZGFFc3BlcmFkYSxcbiAgICAgIHIuc2FsZXNQbGFuRnV0LFxuICAgICAgci5iYWxhbmNlLFxuICAgICAgci5tb3EsXG4gICAgICByLnJlY29tZW5kYWRvLFxuICAgIF0pO1xuICB9XG4gIGNvbnN0IHdzID0gWExTWC51dGlscy5hb2FfdG9fc2hlZXQoYW9hKTtcbiAgd3NbJyFjb2xzJ10gPSBbXG4gICAgeyB3Y2g6IDE0IH0sIC8vIEZhbWlsaWFcbiAgICB7IHdjaDogMTggfSwgLy8gU0tVXG4gICAgeyB3Y2g6IDQwIH0sIC8vIERlc2NyaXBjaVx1MDBGM25cbiAgICB7IHdjaDogOCB9LCAvLyBTdG9ja1xuICAgIHsgd2NoOiAxMCB9LCAvLyBUclx1MDBFMW5zaXRvXG4gICAgeyB3Y2g6IDExIH0sIC8vIEJhY2tvcmRlclxuICAgIHsgd2NoOiAxMiB9LCAvLyBWdGEgcHJvbS9tZXNcbiAgICB7IHdjaDogMTIgfSwgLy8gTXVsdGlwbGljYWRvclxuICAgIHsgd2NoOiAxMSB9LCAvLyBPcmlnZW4gbXVsdFxuICAgIHsgd2NoOiAxNSB9LCAvLyBEZW1hbmRhIGVzcCA3bVxuICAgIHsgd2NoOiAxNiB9LCAvLyBTYWxlcyBQbGFuIGZ1dHVyb1xuICAgIHsgd2NoOiAxMCB9LCAvLyBCYWxhbmNlXG4gICAgeyB3Y2g6IDggfSwgLy8gTU9RXG4gICAgeyB3Y2g6IDEyIH0sIC8vIFJlY29tZW5kYWRvXG4gIF07XG4gIGNvbnN0IHdiID0gWExTWC51dGlscy5ib29rX25ldygpO1xuICBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KHdiLCB3cywgJ1JlY29tZW5kYWNpXHUwMEYzbicpO1xuICBjb25zdCBob3kgPSBuZXcgRGF0ZSgpO1xuICBjb25zdCBzdGFtcCA9XG4gICAgaG95LmdldEZ1bGxZZWFyKCkgK1xuICAgICctJyArXG4gICAgU3RyaW5nKGhveS5nZXRNb250aCgpICsgMSkucGFkU3RhcnQoMiwgJzAnKSArXG4gICAgJy0nICtcbiAgICBTdHJpbmcoaG95LmdldERhdGUoKSkucGFkU3RhcnQoMiwgJzAnKTtcbiAgWExTWC53cml0ZUZpbGUod2IsICdSZWNvbWVuZGFjaW9uX0NvbXByYV8nICsgc3RhbXAgKyAnLnhsc3gnKTtcbn07XG5cbi8vIHYxMTEyIEYzQjogZGVzY29udGludWFyIC8gcmVhY3RpdmFyIFNLVXMuXG53aW5kb3cuZGlzY29udGludWVTa3UgPSBhc3luYyBmdW5jdGlvbiAoc2t1LCBkZXNjcmlwdGlvbikge1xuICBpZiAoIV9kaXNjb250aW51ZWRTa3VzKSBfZGlzY29udGludWVkU2t1cyA9IG5ldyBTZXQoKTtcbiAgY29uc3QgdXBwZXIgPSBTdHJpbmcoc2t1KS50cmltKCkudG9VcHBlckNhc2UoKTtcbiAgY29uc3QgbGFiZWwgPSBkZXNjcmlwdGlvbiA/IHNrdSArICcgXHUyMDE0ICcgKyBkZXNjcmlwdGlvbi5zbGljZSgwLCA2MCkgOiBza3U7XG4gIGlmIChcbiAgICAhY29uZmlybShcbiAgICAgICdEZXNjb250aW51YXIgJyArXG4gICAgICAgIGxhYmVsICtcbiAgICAgICAgJz9cXG5cXG5RdWVkYXJcdTAwRTEgZXhjbHVpZG8gZGVsIGNcdTAwRTFsY3VsbyBkZSByZWNvbWVuZGFjaVx1MDBGM24gZGUgY29tcHJhIGhhc3RhIHF1ZSBsbyByZWFjdGl2ZXMgZGVzZGUgZWwgY2hpcCBcIkRlc2NvbnRpbnVhZG9zXCIuJ1xuICAgIClcbiAgKSB7XG4gICAgcmV0dXJuO1xuICB9XG4gIF9kaXNjb250aW51ZWRTa3VzLmFkZCh1cHBlcik7XG4gIHRyeSB7XG4gICAgYXdhaXQgX3NhdmVEaXNjb250aW51ZWRTa3VzKCk7XG4gICAgX3JlbmRlclJlY29TZWN0aW9uKCk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBfZGlzY29udGludWVkU2t1cy5kZWxldGUodXBwZXIpO1xuICAgIGFsZXJ0KCdFcnJvciBndWFyZGFuZG86ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcbiAgfVxufTtcblxud2luZG93LnJlYWN0aXZhdGVTa3UgPSBhc3luYyBmdW5jdGlvbiAoc2t1KSB7XG4gIGlmICghX2Rpc2NvbnRpbnVlZFNrdXMpIHJldHVybjtcbiAgY29uc3QgdXBwZXIgPSBTdHJpbmcoc2t1KS50cmltKCkudG9VcHBlckNhc2UoKTtcbiAgX2Rpc2NvbnRpbnVlZFNrdXMuZGVsZXRlKHVwcGVyKTtcbiAgdHJ5IHtcbiAgICBhd2FpdCBfc2F2ZURpc2NvbnRpbnVlZFNrdXMoKTtcbiAgICBfcmVuZGVyRGlzY29udGludWVkTW9kYWwoKTtcbiAgICBfcmVuZGVyUmVjb1NlY3Rpb24oKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIF9kaXNjb250aW51ZWRTa3VzLmFkZCh1cHBlcik7XG4gICAgYWxlcnQoJ0Vycm9yIGd1YXJkYW5kbzogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xuICB9XG59O1xuXG53aW5kb3cub3BlbkRpc2NvbnRpbnVlZE1vZGFsID0gZnVuY3Rpb24gKCkge1xuICBjb25zdCBleGlzdGluZyA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdkaXNjb250aW51ZWQtc2t1cy1tb2RhbCcpO1xuICBpZiAoZXhpc3RpbmcpIGV4aXN0aW5nLnJlbW92ZSgpO1xuICBjb25zdCBlbCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpO1xuICBlbC5pZCA9ICdkaXNjb250aW51ZWQtc2t1cy1tb2RhbCc7XG4gIGVsLnN0eWxlLmNzc1RleHQgPVxuICAgICdwb3NpdGlvbjpmaXhlZDtpbnNldDowO2JhY2tncm91bmQ6cmdiYSgxNSwyMyw0MiwuNjUpO3otaW5kZXg6MjEwMDtkaXNwbGF5OmZsZXg7YWxpZ24taXRlbXM6Y2VudGVyO2p1c3RpZnktY29udGVudDpjZW50ZXI7cGFkZGluZzozdmgnO1xuICBlbC5vbmNsaWNrID0gKGV2KSA9PiB7XG4gICAgaWYgKGV2LnRhcmdldCA9PT0gZWwpIGVsLnJlbW92ZSgpO1xuICB9O1xuICBlbC5pbm5lckhUTUwgPVxuICAgICc8ZGl2IGlkPVwiZGlzY29udGludWVkLW1vZGFsLWNvbnRlbnRcIiBzdHlsZT1cImJhY2tncm91bmQ6dmFyKC0tYmctZWxldmF0ZWQpO2JvcmRlci1yYWRpdXM6MTJweDtwYWRkaW5nOjI0cHg7bWF4LXdpZHRoOjY0MHB4O3dpZHRoOjEwMCU7bWF4LWhlaWdodDo5MHZoO292ZXJmbG93OmF1dG87Ym94LXNoYWRvdzowIDIwcHggNjBweCByZ2JhKDAsMCwwLC40KVwiPjwvZGl2Pic7XG4gIGRvY3VtZW50LmJvZHkuYXBwZW5kQ2hpbGQoZWwpO1xuICBfcmVuZGVyRGlzY29udGludWVkTW9kYWwoKTtcbn07XG5cbmZ1bmN0aW9uIF9yZW5kZXJEaXNjb250aW51ZWRNb2RhbCgpIHtcbiAgY29uc3QgY29udCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdkaXNjb250aW51ZWQtbW9kYWwtY29udGVudCcpO1xuICBpZiAoIWNvbnQpIHJldHVybjtcbiAgY29uc3QgbGlzdCA9IF9kaXNjb250aW51ZWRTa3VzID8gQXJyYXkuZnJvbShfZGlzY29udGludWVkU2t1cykuc29ydCgpIDogW107XG4gIC8vIEJ1c2NhciBkZXNjcmlwY2lcdTAwRjNuIGVuIGxvcyBzYWxlcyBwbGFucyBjYWNoZXMgcG9yIHNpIGVzdGEgY2FyZ2Fkb1xuICBjb25zdCBza3VUb0Rlc2MgPSB7fTtcbiAgZm9yIChjb25zdCBmYW0gb2YgWydyb2RzJywgJ3JlZWxzJ10pIHtcbiAgICBjb25zdCBjYWNoZSA9IF9zYWxlc1BsYW5DYWNoZXNbZmFtXTtcbiAgICBpZiAoY2FjaGUgJiYgY2FjaGUucm93cykge1xuICAgICAgZm9yIChjb25zdCByIG9mIGNhY2hlLnJvd3MpIHtcbiAgICAgICAgc2t1VG9EZXNjW1N0cmluZyhyLnNrdSkudHJpbSgpLnRvVXBwZXJDYXNlKCldID0gci5kZXNjcmlwdGlvbiB8fCAnJztcbiAgICAgIH1cbiAgICB9XG4gIH1cbiAgY29uc3QgaGVhZCA9XG4gICAgJzxkaXYgc3R5bGU9XCJkaXNwbGF5OmZsZXg7anVzdGlmeS1jb250ZW50OnNwYWNlLWJldHdlZW47YWxpZ24taXRlbXM6Y2VudGVyO21hcmdpbi1ib3R0b206MTRweFwiPicgK1xuICAgICc8ZGl2PjxkaXYgc3R5bGU9XCJmb250LXNpemU6MThweDtmb250LXdlaWdodDo4MDA7Y29sb3I6dmFyKC0tdGV4dC1wcmltYXJ5KVwiPlNLVXMgZGVzY29udGludWFkb3M8L2Rpdj4nICtcbiAgICAnPGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMXB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO21hcmdpbi10b3A6MnB4XCI+JyArXG4gICAgbGlzdC5sZW5ndGggK1xuICAgICcgU0tVcyBleGNsdWlkb3MgZGVsIGNcdTAwRTFsY3VsbyBkZSBSZWNvbWVuZGFjaVx1MDBGM24gZGUgQ29tcHJhJyArXG4gICAgJzwvZGl2PjwvZGl2PicgK1xuICAgICc8YnV0dG9uIG9uY2xpY2s9XCJkb2N1bWVudC5nZXRFbGVtZW50QnlJZChcXCdkaXNjb250aW51ZWQtc2t1cy1tb2RhbFxcJykucmVtb3ZlKClcIiBzdHlsZT1cImJhY2tncm91bmQ6dHJhbnNwYXJlbnQ7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1ib3JkZXItc3VidGxlKTtib3JkZXItcmFkaXVzOjZweDtwYWRkaW5nOjZweCAxMnB4O2N1cnNvcjpwb2ludGVyO2ZvbnQtd2VpZ2h0OjcwMFwiPkNlcnJhcjwvYnV0dG9uPicgK1xuICAgICc8L2Rpdj4nO1xuICBjb25zdCBib2R5ID1cbiAgICBsaXN0Lmxlbmd0aCA9PT0gMFxuICAgICAgPyAnPGRpdiBzdHlsZT1cInBhZGRpbmc6NDBweDt0ZXh0LWFsaWduOmNlbnRlcjtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKVwiPk5vIGhheSBTS1VzIGRlc2NvbnRpbnVhZG9zLjxicj48YnI+UG9kXHUwMEU5cyBkZXNjb250aW51YXIgU0tVcyBkZXNkZSBlbCBib3RcdTAwRjNuIFx1RDgzRFx1REREMSBlbiBjYWRhIGZpbGEgZGUgbGEgdGFibGEgUmVjb21lbmRhY2lcdTAwRjNuIGRlIENvbXByYS48L2Rpdj4nXG4gICAgICA6ICc8ZGl2IHN0eWxlPVwiZGlzcGxheTpmbGV4O2ZsZXgtZGlyZWN0aW9uOmNvbHVtbjtnYXA6NnB4XCI+JyArXG4gICAgICAgIGxpc3RcbiAgICAgICAgICAubWFwKChza3UpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IGRlc2MgPSBza3VUb0Rlc2Nbc2t1XSB8fCAnJztcbiAgICAgICAgICAgIHJldHVybiAoXG4gICAgICAgICAgICAgICc8ZGl2IHN0eWxlPVwiZGlzcGxheTpmbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtnYXA6MTBweDtwYWRkaW5nOjEwcHggMTJweDtiYWNrZ3JvdW5kOnZhcigtLWJnLXNlY29uZGFyeSk7Ym9yZGVyLXJhZGl1czo2cHhcIj4nICtcbiAgICAgICAgICAgICAgJzxkaXYgc3R5bGU9XCJmbGV4OjFcIj48ZGl2IHN0eWxlPVwiZm9udC1mYW1pbHk6bW9ub3NwYWNlO2ZvbnQtd2VpZ2h0OjcwMDtjb2xvcjp2YXIoLS10ZXh0LXByaW1hcnkpXCI+JyArXG4gICAgICAgICAgICAgIGVzY2FwZUh0bWxTYWZlKHNrdSkgK1xuICAgICAgICAgICAgICAnPC9kaXY+JyArXG4gICAgICAgICAgICAgIChkZXNjXG4gICAgICAgICAgICAgICAgPyAnPGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMXB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO21hcmdpbi10b3A6MnB4XCI+JyArXG4gICAgICAgICAgICAgICAgICBlc2NhcGVIdG1sU2FmZShkZXNjKSArXG4gICAgICAgICAgICAgICAgICAnPC9kaXY+J1xuICAgICAgICAgICAgICAgIDogJycpICtcbiAgICAgICAgICAgICAgJzwvZGl2PicgK1xuICAgICAgICAgICAgICAnPGJ1dHRvbiBvbmNsaWNrPVwicmVhY3RpdmF0ZVNrdShcXCcnICtcbiAgICAgICAgICAgICAgZXNjYXBlSHRtbFNhZmUoc2t1KSArXG4gICAgICAgICAgICAgICdcXCcpXCIgc3R5bGU9XCJwYWRkaW5nOjZweCAxMnB4O2JhY2tncm91bmQ6IzE2YTM0YTtjb2xvcjojZmZmO2JvcmRlcjpub25lO2JvcmRlci1yYWRpdXM6NHB4O2ZvbnQtc2l6ZToxMXB4O2ZvbnQtd2VpZ2h0OjcwMDtjdXJzb3I6cG9pbnRlclwiPlx1MjFCQiBSZWFjdGl2YXI8L2J1dHRvbj4nICtcbiAgICAgICAgICAgICAgJzwvZGl2PidcbiAgICAgICAgICAgICk7XG4gICAgICAgICAgfSlcbiAgICAgICAgICAuam9pbignJykgK1xuICAgICAgICAnPC9kaXY+JztcbiAgY29udC5pbm5lckhUTUwgPSBoZWFkICsgYm9keTtcbn1cbiJdLAogICJtYXBwaW5ncyI6ICI7OztBQVlBLE1BQU0sZ0JBQWdCO0FBQUEsSUFDcEIsS0FBSztBQUFBLElBQ0wsU0FBUztBQUFBLElBQ1QsS0FBSztBQUFBLElBQ0wsT0FBTztBQUFBLElBQ1AsS0FBSztBQUFBLElBQ0wsVUFBVTtBQUFBLElBQ1YsU0FBUztBQUFBLElBQ1QsS0FBSztBQUFBLElBQ0wsT0FBTztBQUFBLElBQ1AsT0FBTztBQUFBLElBQ1AsS0FBSztBQUFBLElBQ0wsT0FBTztBQUFBLElBQ1AsS0FBSztBQUFBLElBQ0wsT0FBTztBQUFBLElBQ1AsS0FBSztBQUFBLElBQ0wsTUFBTTtBQUFBLElBQ04sS0FBSztBQUFBLElBQ0wsTUFBTTtBQUFBLElBQ04sT0FBTztBQUFBLElBQ1AsS0FBSztBQUFBLElBQ0wsTUFBTTtBQUFBLElBQ04sT0FBTztBQUFBLElBQ1AsS0FBSztBQUFBLElBQ0wsUUFB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
