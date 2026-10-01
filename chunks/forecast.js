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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL3B1cmUvc2FsZXMtcGxhbi1wYXJzZXIuanMiLCAiLi4vc3JjL2RvbWFpbnMvZm9yZWNhc3QuanMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbIi8vIEB0cy1ub2NoZWNrXHJcbi8vIFB1cmU6IHBhcnNlYSB1biBzaGVldCBTYWxlcyBQbGFuIChmb3JtYXRvIFNVUi9TQVIgZGUgU2hpbWFubykgYSBlc3RydWN0dXJhXHJcbi8vIG5vcm1hbGl6YWRhIHsgc2t1LCBkZXNjcmlwdGlvbiwgbW9xLCBtb250aHM6IHsnWVlZWS1NTSc6IE59IH0uXHJcbi8vIFNpbiBkZXBlbmRlbmNpYXMgXHUyMDE0IHJlY2liZSBlbCBzaGVldCB5YSBkZXNlcmlhbGl6YWRvIHBvciBTaGVldEpTXHJcbi8vIChYTFNYLnV0aWxzLnNoZWV0X3RvX2pzb24oc2hlZXQsIHtoZWFkZXI6MSwgZGVmdmFsOicnfSkpLlxyXG4vLyBUZXN0ZWFibGUgZW4gdml0ZXN0IHNpbiBjYXJnYXIgWExTWC5cclxuLy9cclxuLy8gQ29udGV4dG86IGxvcyBTYWxlcyBQbGFucyBkZSBTaGltYW5vIHZpZW5lbiBjb24gaGVhZGVycyBjb21vXHJcbi8vIFwiU0tVIENvZGUvUGFydCBOb1wiLCBcIkRlc2NyaXB0aW9uXCIsIFwiTU9RIDEyIG1vbnRoc1wiIHkgY29sdW1uYXMgZGUgbWVzZXNcclxuLy8gdGlwbyBcIkphbiAyMDI3XCIsIFwiTWF5IDIwMjdcIiAoYSB2ZWNlcyBjb24gYVx1MDBGMW8gZW4gdW5hIGZpbGEgYXJyaWJhIHkgZWwgbWVzXHJcbi8vIGVuIGxhIGZpbGEgaGVhZGVyKS4gRXN0YSBmbiB0b2xlcmEgYW1ib3MgbGF5b3V0cy5cclxuXHJcbmNvbnN0IE1PTlRIX0FMSUFTRVMgPSB7XHJcbiAgamFuOiAxLFxyXG4gIGphbnVhcnk6IDEsXHJcbiAgZW5lOiAxLFxyXG4gIGVuZXJvOiAxLFxyXG4gIGZlYjogMixcclxuICBmZWJydWFyeTogMixcclxuICBmZWJyZXJvOiAyLFxyXG4gIG1hcjogMyxcclxuICBtYXJjaDogMyxcclxuICBtYXJ6bzogMyxcclxuICBhcHI6IDQsXHJcbiAgYXByaWw6IDQsXHJcbiAgYWJyOiA0LFxyXG4gIGFicmlsOiA0LFxyXG4gIG1heTogNSxcclxuICBtYXlvOiA1LFxyXG4gIGp1bjogNixcclxuICBqdW5lOiA2LFxyXG4gIGp1bmlvOiA2LFxyXG4gIGp1bDogNyxcclxuICBqdWx5OiA3LFxyXG4gIGp1bGlvOiA3LFxyXG4gIGF1ZzogOCxcclxuICBhdWd1c3Q6IDgsXHJcbiAgYWdvOiA4LFxyXG4gIGFnb3N0bzogOCxcclxuICBzZXA6IDksXHJcbiAgc2VwdDogOSxcclxuICBzZXB0ZW1iZXI6IDksXHJcbiAgc2VwdGllbWJyZTogOSxcclxuICBvY3Q6IDEwLFxyXG4gIG9jdG9iZXI6IDEwLFxyXG4gIG9jdHVicmU6IDEwLFxyXG4gIG5vdjogMTEsXHJcbiAgbm92ZW1iZXI6IDExLFxyXG4gIG5vdmllbWJyZTogMTEsXHJcbiAgZGVjOiAxMixcclxuICBkZWNlbWJlcjogMTIsXHJcbiAgZGljOiAxMixcclxuICBkaWNpZW1icmU6IDEyLFxyXG59O1xyXG5cclxuLy8gTm9ybWFsaXphIGxhYmVscyBkZSBtZXNlcyBhICdZWVlZLU1NJy4gUmV0b3JuYSBudWxsIHNpIG5vIG1hdGNoZWEuXHJcbi8vIEZvcm1hdG9zIHNvcG9ydGFkb3M6IFwiSmFuIDIwMjdcIiwgXCJFbmUtMjdcIiwgXCJKYW4vMjAyN1wiLCBcIk1heTI3XCIsXHJcbi8vIFwiMjAyNy0wMVwiLCBcIjAxLzIwMjdcIiwgXCJKYW4uMjAyN1wiLCBcIjIwMjFcXG5KYW5cIiAobXVsdGktbGluZSBFeGNlbCkuXHJcbmZ1bmN0aW9uIG5vcm1hbGl6ZU1vbnRoTGFiZWwobGFiZWwpIHtcclxuICBpZiAobGFiZWwgPT0gbnVsbCkgcmV0dXJuIG51bGw7XHJcbiAgLy8gdjExMDQ6IGNvbGFwc2FyIG5ld2xpbmVzL3RhYnMgYSBlc3BhY2lvIGFudGVzIGRlbCB0cmltLlxyXG4gIC8vIEVsIGZvcm1hdG8gRXhjZWwgXCIyMDIxXFxuSmFuXCIgKGFcdTAwRjFvIGVuIEwxLCBtZXMgZW4gTDIgZGVudHJvIGRlIHVuYSBjZWxkYVxyXG4gIC8vIG11bHRpLXJvdykgZXMgY29tXHUwMEZBbiBlbiBTYWxlcyBQbGFucyBTVVIuIGBcXHMrYCBtYXRjaGVhIHdoaXRlc3BhY2UgaW5jbHV5ZW5kb1xyXG4gIC8vIFxcbiB5IFxcclxcbi5cclxuICBjb25zdCBzID0gU3RyaW5nKGxhYmVsKS5yZXBsYWNlKC9cXHMrL2csICcgJykudHJpbSgpLnRvTG93ZXJDYXNlKCk7XHJcbiAgaWYgKCFzKSByZXR1cm4gbnVsbDtcclxuICBsZXQgbTtcclxuICAvLyBcImphbiAyMDI3XCIgfCBcImphbi0yN1wiIHwgXCJlbmUvMjAyN1wiIHwgXCJtYXkyN1wiIHwgXCJtYXkuMjAyN1wiXHJcbiAgbSA9IHMubWF0Y2goL14oW2Etelx1MDBFMVx1MDBFOVx1MDBFRFx1MDBGM1x1MDBGQV17MywxMH0pW1xcc1xcLS8uX10qKFxcZHsyLDR9KSQvKTtcclxuICBpZiAobSkge1xyXG4gICAgY29uc3QgbW9uID0gTU9OVEhfQUxJQVNFU1ttWzFdXSB8fCBNT05USF9BTElBU0VTW21bMV0uc2xpY2UoMCwgMyldO1xyXG4gICAgaWYgKG1vbikge1xyXG4gICAgICBsZXQgeSA9IHBhcnNlSW50KG1bMl0sIDEwKTtcclxuICAgICAgaWYgKHkgPCAxMDApIHkgPSAyMDAwICsgeTtcclxuICAgICAgcmV0dXJuIFN0cmluZyh5KS5wYWRTdGFydCg0LCAnMCcpICsgJy0nICsgU3RyaW5nKG1vbikucGFkU3RhcnQoMiwgJzAnKTtcclxuICAgIH1cclxuICB9XHJcbiAgLy8gXCIyMDIxIGphblwiIHwgXCIyMDI3IGRpY1wiIChhXHUwMEYxbyBwcmltZXJvICsgbWVzLCBmb3JtYXRvIEV4Y2VsIG11bHRpLWxpbmVcclxuICAvLyBjb2xhcHNhZG8gdHJhcyByZXBsYWNlIFxccyspLlxyXG4gIG0gPSBzLm1hdGNoKC9eKFxcZHs0fSlbXFxzXFwtLy5fXSsoW2Etelx1MDBFMVx1MDBFOVx1MDBFRFx1MDBGM1x1MDBGQV17MywxMH0pJC8pO1xyXG4gIGlmIChtKSB7XHJcbiAgICBjb25zdCB5ID0gcGFyc2VJbnQobVsxXSwgMTApO1xyXG4gICAgY29uc3QgbW9uID0gTU9OVEhfQUxJQVNFU1ttWzJdXSB8fCBNT05USF9BTElBU0VTW21bMl0uc2xpY2UoMCwgMyldO1xyXG4gICAgaWYgKG1vbikgcmV0dXJuIFN0cmluZyh5KS5wYWRTdGFydCg0LCAnMCcpICsgJy0nICsgU3RyaW5nKG1vbikucGFkU3RhcnQoMiwgJzAnKTtcclxuICB9XHJcbiAgLy8gXCIyMDI3LTAxXCIgfCBcIjIwMjcvMDFcIlxyXG4gIG0gPSBzLm1hdGNoKC9eKFxcZHs0fSlbLS9dKFxcZHsxLDJ9KSQvKTtcclxuICBpZiAobSkge1xyXG4gICAgY29uc3QgeSA9IHBhcnNlSW50KG1bMV0sIDEwKTtcclxuICAgIGNvbnN0IG1vbiA9IHBhcnNlSW50KG1bMl0sIDEwKTtcclxuICAgIGlmIChtb24gPj0gMSAmJiBtb24gPD0gMTIpXHJcbiAgICAgIHJldHVybiBTdHJpbmcoeSkucGFkU3RhcnQoNCwgJzAnKSArICctJyArIFN0cmluZyhtb24pLnBhZFN0YXJ0KDIsICcwJyk7XHJcbiAgfVxyXG4gIC8vIFwiMDEvMjAyN1wiIHwgXCIwMS0yMDI3XCJcclxuICBtID0gcy5tYXRjaCgvXihcXGR7MSwyfSlbLS9dKFxcZHs0fSkkLyk7XHJcbiAgaWYgKG0pIHtcclxuICAgIGNvbnN0IG1vbiA9IHBhcnNlSW50KG1bMV0sIDEwKTtcclxuICAgIGNvbnN0IHkgPSBwYXJzZUludChtWzJdLCAxMCk7XHJcbiAgICBpZiAobW9uID49IDEgJiYgbW9uIDw9IDEyKVxyXG4gICAgICByZXR1cm4gU3RyaW5nKHkpLnBhZFN0YXJ0KDQsICcwJykgKyAnLScgKyBTdHJpbmcobW9uKS5wYWRTdGFydCgyLCAnMCcpO1xyXG4gIH1cclxuICByZXR1cm4gbnVsbDtcclxufVxyXG5cclxuLy8gQnVzY2EgbGEgZmlsYSBoZWFkZXIgKDAtYmFzZWQpLiBFc2NhbmVhIGxhcyBwcmltZXJhcyAzMCBmaWxhcy5cclxuZnVuY3Rpb24gZmluZEhlYWRlclJvdyhyb3dzKSB7XHJcbiAgY29uc3QgSEVBREVSX01BUktFUlMgPSBbXHJcbiAgICAnc2t1IGNvZGUvcGFydCBubycsXHJcbiAgICAnc2t1IGNvZGUnLFxyXG4gICAgJ3NrdScsXHJcbiAgICAncGFydCBubycsXHJcbiAgICAncGFydCBudW1iZXInLFxyXG4gICAgJ2l0ZW1jb2RlJyxcclxuICAgICdpdGVtIGNvZGUnLFxyXG4gICAgJ2NvZGlnbycsXHJcbiAgICAnY1x1MDBGM2RpZ28nLFxyXG4gIF07XHJcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBNYXRoLm1pbihyb3dzLmxlbmd0aCwgMzApOyBpKyspIHtcclxuICAgIGNvbnN0IHJvdyA9IHJvd3NbaV0gfHwgW107XHJcbiAgICBmb3IgKGNvbnN0IGNlbGwgb2Ygcm93KSB7XHJcbiAgICAgIC8vIHYxMTA0OiBjb2xhcHNhciBuZXdsaW5lcyBhIGVzcGFjaW8gcGFyYSBtYXRjaGVhciBoZWFkZXJzIGNvbW9cclxuICAgICAgLy8gXCJTS1UgQ29kZS9QYXJ0IE5vXCIgKG9rKSBvIFwiU0tVXFxuQ29kZVwiIChuZWNlc2l0YSBjb2xhcHNhcikuXHJcbiAgICAgIGNvbnN0IHMgPSBTdHJpbmcoY2VsbCA9PSBudWxsID8gJycgOiBjZWxsKVxyXG4gICAgICAgIC5yZXBsYWNlKC9cXHMrL2csICcgJylcclxuICAgICAgICAudHJpbSgpXHJcbiAgICAgICAgLnRvTG93ZXJDYXNlKCk7XHJcbiAgICAgIGlmIChIRUFERVJfTUFSS0VSUy5pbmRleE9mKHMpID49IDApIHJldHVybiBpO1xyXG4gICAgfVxyXG4gIH1cclxuICByZXR1cm4gLTE7XHJcbn1cclxuXHJcbi8vIERldGVjdGEgXHUwMEVEbmRpY2VzIGRlIGNvbHVtbmFzIHkgbWVzZXMuIGBoaW50Um93QWJvdmVgIHBlcm1pdGUgY29tYmluYXIgYVx1MDBGMW8vbWVzXHJcbi8vIGN1YW5kbyBlbCBoZWFkZXIgZXMgbXVsdGktcm93IChhXHUwMEYxbyBhcnJpYmEsIG1lcyBhYmFqbyBvIHZpY2V2ZXJzYSkuXHJcbmZ1bmN0aW9uIGRldGVjdENvbHVtbnMoaGVhZGVyUm93LCBoaW50Um93QWJvdmUpIHtcclxuICBsZXQgc2t1SWR4ID0gLTE7XHJcbiAgbGV0IGRlc2NJZHggPSAtMTtcclxuICBsZXQgbW9xSWR4ID0gLTE7XHJcbiAgY29uc3QgbW9udGhDb2x1bW5zID0gW107XHJcbiAgY29uc3QgZGV0ZWN0ZWRNb250aHNTZXQgPSBuZXcgU2V0KCk7XHJcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBoZWFkZXJSb3cubGVuZ3RoOyBpKyspIHtcclxuICAgIC8vIHYxMTA0OiBjb2xhcHNhciBuZXdsaW5lcyBhIGVzcGFjaW8gYW50ZXMgZGUgY29tcGFyYXIuIExvcyBTYWxlcyBQbGFuXHJcbiAgICAvLyBTVVIgdGllbmVuIGhlYWRlcnMgbXVsdGktbGluZSBjb21vIFwiTU9RXFxuMTIgbW9udGhzXCIgbyBcIkJhc2VcXG5GT0IoVVNEKVwiLlxyXG4gICAgY29uc3QgcmF3ID0gU3RyaW5nKGhlYWRlclJvd1tpXSA9PSBudWxsID8gJycgOiBoZWFkZXJSb3dbaV0pXHJcbiAgICAgIC5yZXBsYWNlKC9cXHMrL2csICcgJylcclxuICAgICAgLnRyaW0oKTtcclxuICAgIGNvbnN0IHMgPSByYXcudG9Mb3dlckNhc2UoKTtcclxuICAgIGlmIChcclxuICAgICAgc2t1SWR4IDwgMCAmJlxyXG4gICAgICAocyA9PT0gJ3NrdSBjb2RlL3BhcnQgbm8nIHx8XHJcbiAgICAgICAgcyA9PT0gJ3NrdSBjb2RlJyB8fFxyXG4gICAgICAgIHMgPT09ICdza3UnIHx8XHJcbiAgICAgICAgcyA9PT0gJ3BhcnQgbm8nIHx8XHJcbiAgICAgICAgcyA9PT0gJ3BhcnQgbnVtYmVyJyB8fFxyXG4gICAgICAgIHMgPT09ICdpdGVtY29kZScgfHxcclxuICAgICAgICBzID09PSAnaXRlbSBjb2RlJyB8fFxyXG4gICAgICAgIHMgPT09ICdjb2RpZ28nIHx8XHJcbiAgICAgICAgcyA9PT0gJ2NcdTAwRjNkaWdvJylcclxuICAgICkge1xyXG4gICAgICBza3VJZHggPSBpO1xyXG4gICAgICBjb250aW51ZTtcclxuICAgIH1cclxuICAgIGlmIChcclxuICAgICAgZGVzY0lkeCA8IDAgJiZcclxuICAgICAgKHMgPT09ICdkZXNjcmlwdGlvbicgfHxcclxuICAgICAgICBzID09PSAnZGVzY3JpcGNpb24nIHx8XHJcbiAgICAgICAgcyA9PT0gJ2Rlc2NyaXBjaVx1MDBGM24nIHx8XHJcbiAgICAgICAgcyA9PT0gJ2l0ZW0gbmFtZScgfHxcclxuICAgICAgICBzID09PSAnaXRlbW5hbWUnKVxyXG4gICAgKSB7XHJcbiAgICAgIGRlc2NJZHggPSBpO1xyXG4gICAgICBjb250aW51ZTtcclxuICAgIH1cclxuICAgIGlmIChtb3FJZHggPCAwICYmIChzID09PSAnbW9xIDEyIG1vbnRocycgfHwgcyA9PT0gJ21vcScgfHwgcy5pbmRleE9mKCdtb3EnKSA9PT0gMCkpIHtcclxuICAgICAgbW9xSWR4ID0gaTtcclxuICAgICAgY29udGludWU7XHJcbiAgICB9XHJcbiAgICAvLyBUcnkgZGlyZWN0IG1vbnRoIHBhcnNlXHJcbiAgICBsZXQgbW9udGhLZXkgPSBub3JtYWxpemVNb250aExhYmVsKHJhdyk7XHJcbiAgICBpZiAoIW1vbnRoS2V5ICYmIGhpbnRSb3dBYm92ZSAmJiBoaW50Um93QWJvdmVbaV0gIT0gbnVsbCkge1xyXG4gICAgICBjb25zdCBoaW50ID0gU3RyaW5nKGhpbnRSb3dBYm92ZVtpXSkudHJpbSgpO1xyXG4gICAgICBpZiAoaGludCkge1xyXG4gICAgICAgIG1vbnRoS2V5ID0gbm9ybWFsaXplTW9udGhMYWJlbChyYXcgKyAnICcgKyBoaW50KSB8fCBub3JtYWxpemVNb250aExhYmVsKGhpbnQgKyAnICcgKyByYXcpO1xyXG4gICAgICB9XHJcbiAgICB9XHJcbiAgICBpZiAobW9udGhLZXkpIHtcclxuICAgICAgbW9udGhDb2x1bW5zLnB1c2goeyBjb2xJZHg6IGksIG1vbnRoS2V5IH0pO1xyXG4gICAgICBkZXRlY3RlZE1vbnRoc1NldC5hZGQobW9udGhLZXkpO1xyXG4gICAgfVxyXG4gIH1cclxuICByZXR1cm4ge1xyXG4gICAgc2t1SWR4LFxyXG4gICAgZGVzY0lkeCxcclxuICAgIG1vcUlkeCxcclxuICAgIG1vbnRoQ29sdW1ucyxcclxuICAgIGRldGVjdGVkTW9udGhzOiBBcnJheS5mcm9tKGRldGVjdGVkTW9udGhzU2V0KS5zb3J0KCksXHJcbiAgfTtcclxufVxyXG5cclxuLy8gUHVibGljOiBwYXJzZSBmdWxsIHNoZWV0LiBUaHJvd3Mgb24gbWlzc2luZyBTS1UgY29sdW1uIC8gbW9udGhzLlxyXG5mdW5jdGlvbiBwYXJzZVNhbGVzUGxhblNoZWV0KHJvd3MpIHtcclxuICBpZiAoIXJvd3MgfHwgIXJvd3MubGVuZ3RoKSB7XHJcbiAgICBjb25zdCBlcnIgPSBuZXcgRXJyb3IoJ0V4Y2VsIHZhY2lvJyk7XHJcbiAgICBlcnIuY29kZSA9ICdFTVBUWV9TSEVFVCc7XHJcbiAgICB0aHJvdyBlcnI7XHJcbiAgfVxyXG4gIGNvbnN0IGhlYWRlcklkeCA9IGZpbmRIZWFkZXJSb3cocm93cyk7XHJcbiAgaWYgKGhlYWRlcklkeCA8IDApIHtcclxuICAgIGNvbnN0IGVyciA9IG5ldyBFcnJvcignTm8gc2UgZW5jb250cm8gZmlsYSBkZSBoZWFkZXJzIChidXNjYWJhIFwiU0tVIENvZGUvUGFydCBOb1wiIG8gXCJTS1VcIiknKTtcclxuICAgIGVyci5jb2RlID0gJ0hFQURFUl9OT1RfRk9VTkQnO1xyXG4gICAgdGhyb3cgZXJyO1xyXG4gIH1cclxuICBjb25zdCBoZWFkZXJSb3cgPSByb3dzW2hlYWRlcklkeF0gfHwgW107XHJcbiAgY29uc3Qgcm93QWJvdmUgPSBoZWFkZXJJZHggPiAwID8gcm93c1toZWFkZXJJZHggLSAxXSB8fCBbXSA6IG51bGw7XHJcbiAgY29uc3QgY29scyA9IGRldGVjdENvbHVtbnMoaGVhZGVyUm93LCByb3dBYm92ZSk7XHJcbiAgaWYgKGNvbHMuc2t1SWR4IDwgMCkge1xyXG4gICAgY29uc3QgZXJyID0gbmV3IEVycm9yKCdObyBzZSBlbmNvbnRybyBjb2x1bW5hIFNLVSBlbiBsYSBmaWxhIGhlYWRlcicpO1xyXG4gICAgZXJyLmNvZGUgPSAnU0tVX0NPTF9NSVNTSU5HJztcclxuICAgIHRocm93IGVycjtcclxuICB9XHJcbiAgaWYgKCFjb2xzLm1vbnRoQ29sdW1ucy5sZW5ndGgpIHtcclxuICAgIGNvbnN0IGVyciA9IG5ldyBFcnJvcihcclxuICAgICAgJ05vIHNlIGRldGVjdGFyb24gY29sdW1uYXMgZGUgbWVzZXMgZW4gZWwgaGVhZGVyIChlajogXCJKYW4gMjAyN1wiLCBcIk1heSAyMDI3XCIpJ1xyXG4gICAgKTtcclxuICAgIGVyci5jb2RlID0gJ01PTlRIU19OT1RfRk9VTkQnO1xyXG4gICAgdGhyb3cgZXJyO1xyXG4gIH1cclxuICBjb25zdCBwYXJzZWRSb3dzID0gW107XHJcbiAgY29uc3Qgc2VlblNrdSA9IG5ldyBTZXQoKTtcclxuICBmb3IgKGxldCByID0gaGVhZGVySWR4ICsgMTsgciA8IHJvd3MubGVuZ3RoOyByKyspIHtcclxuICAgIGNvbnN0IHJvdyA9IHJvd3Nbcl0gfHwgW107XHJcbiAgICBjb25zdCBza3VSYXcgPSByb3dbY29scy5za3VJZHhdO1xyXG4gICAgaWYgKHNrdVJhdyA9PSBudWxsIHx8IFN0cmluZyhza3VSYXcpLnRyaW0oKSA9PT0gJycpIGNvbnRpbnVlO1xyXG4gICAgY29uc3Qgc2t1ID0gU3RyaW5nKHNrdVJhdykudHJpbSgpO1xyXG4gICAgY29uc3QgdXBwZXIgPSBza3UudG9VcHBlckNhc2UoKTtcclxuICAgIC8vIFNraXAgZmlsYXMgVE9UQUwgLyBTVU0gLyBTVUJUT1RBTFxyXG4gICAgaWYgKHVwcGVyID09PSAnVE9UQUwnIHx8IHVwcGVyID09PSAnU1VNJyB8fCB1cHBlciA9PT0gJ1NVQlRPVEFMJyB8fCB1cHBlciA9PT0gJ1RPVEFMRVMnKVxyXG4gICAgICBjb250aW51ZTtcclxuICAgIGlmIChzZWVuU2t1Lmhhcyh1cHBlcikpIGNvbnRpbnVlOyAvLyBkZWR1cGVcclxuICAgIHNlZW5Ta3UuYWRkKHVwcGVyKTtcclxuICAgIGNvbnN0IGRlc2NyaXB0aW9uID1cclxuICAgICAgY29scy5kZXNjSWR4ID49IDAgPyBTdHJpbmcocm93W2NvbHMuZGVzY0lkeF0gPT0gbnVsbCA/ICcnIDogcm93W2NvbHMuZGVzY0lkeF0pLnRyaW0oKSA6ICcnO1xyXG4gICAgY29uc3QgbW9xUmF3ID0gY29scy5tb3FJZHggPj0gMCA/IHJvd1tjb2xzLm1vcUlkeF0gOiBudWxsO1xyXG4gICAgY29uc3QgbW9xTnVtID0gTnVtYmVyKG1vcVJhdyk7XHJcbiAgICBjb25zdCBtb3EgPSBOdW1iZXIuaXNGaW5pdGUobW9xTnVtKSAmJiBtb3FOdW0gPiAwID8gTWF0aC5yb3VuZChtb3FOdW0pIDogMDtcclxuICAgIGNvbnN0IG1vbnRocyA9IHt9O1xyXG4gICAgZm9yIChjb25zdCBtYyBvZiBjb2xzLm1vbnRoQ29sdW1ucykge1xyXG4gICAgICBjb25zdCB2ID0gcm93W21jLmNvbElkeF07XHJcbiAgICAgIGNvbnN0IG4gPSBOdW1iZXIodik7XHJcbiAgICAgIGlmIChOdW1iZXIuaXNGaW5pdGUobikgJiYgbiA+IDApIHtcclxuICAgICAgICBtb250aHNbbWMubW9udGhLZXldID0gTWF0aC5yb3VuZChuKTtcclxuICAgICAgfVxyXG4gICAgfVxyXG4gICAgcGFyc2VkUm93cy5wdXNoKHsgc2t1LCBkZXNjcmlwdGlvbiwgbW9xLCBtb250aHMgfSk7XHJcbiAgfVxyXG4gIHJldHVybiB7XHJcbiAgICBoZWFkZXJSb3dJbmRleDogaGVhZGVySWR4LFxyXG4gICAgZGV0ZWN0ZWRNb250aHM6IGNvbHMuZGV0ZWN0ZWRNb250aHMsXHJcbiAgICByb3dzQ291bnQ6IHBhcnNlZFJvd3MubGVuZ3RoLFxyXG4gICAgcm93czogcGFyc2VkUm93cyxcclxuICB9O1xyXG59XHJcblxyXG4vLyBVTUQtaXNoIGV4cG9ydDogcGFyYSB2aXRlc3QgKG1vZHVsZS5leHBvcnRzKSB5IHBhcmEgYnVuZGxlIGJyb3dzZXIgKHdpbmRvdyBnbG9iYWwpLlxyXG5pZiAodHlwZW9mIG1vZHVsZSAhPT0gJ3VuZGVmaW5lZCcgJiYgbW9kdWxlLmV4cG9ydHMpIHtcclxuICBtb2R1bGUuZXhwb3J0cyA9IHsgcGFyc2VTYWxlc1BsYW5TaGVldCwgbm9ybWFsaXplTW9udGhMYWJlbCwgZmluZEhlYWRlclJvdywgZGV0ZWN0Q29sdW1ucyB9O1xyXG59XHJcbmlmICh0eXBlb2Ygd2luZG93ICE9PSAndW5kZWZpbmVkJykge1xyXG4gIHdpbmRvdy5TYWxlc1BsYW5QYXJzZXIgPSB7XHJcbiAgICBwYXJzZVNhbGVzUGxhblNoZWV0LFxyXG4gICAgbm9ybWFsaXplTW9udGhMYWJlbCxcclxuICAgIGZpbmRIZWFkZXJSb3csXHJcbiAgICBkZXRlY3RDb2x1bW5zLFxyXG4gIH07XHJcbn1cclxuXHJcbmV4cG9ydCB7IGRldGVjdENvbHVtbnMsIGZpbmRIZWFkZXJSb3csIG5vcm1hbGl6ZU1vbnRoTGFiZWwsIHBhcnNlU2FsZXNQbGFuU2hlZXQgfTtcclxuIiwgIi8vIEB0cy1ub2NoZWNrXHJcbi8vIHYxMDk4KyBGYXNlIDE6IGltcG9ydCBkZWwgcGFyc2VyIHB1cm8uIEVsIG1cdTAwRjNkdWxvIGhhY2UgYHdpbmRvdy5TYWxlc1BsYW5QYXJzZXJgXHJcbi8vIGNvbW8gc2lkZS1lZmZlY3QgeSB0YW1iaVx1MDBFOW4gZXhwb3J0YSBsYXMgZm5zIG5vbWJyYWRhczsgdXNhbW9zIHNpZGUtZWZmZWN0XHJcbi8vIHBvcnF1ZSBmb3JlY2FzdC5qcyBjb3JyZSBlbiBlbCBjaHVuayBsYXp5IHkgd2luZG93IHlhIGVzdFx1MDBFMSBkaXNwb25pYmxlLlxyXG5pbXBvcnQgJy4uL3B1cmUvc2FsZXMtcGxhbi1wYXJzZXIuanMnO1xyXG5cclxuLy8gR2xvYmFscyBsZWlkb3MgZGVsIGVudG9ybm8gKGRlY2xhcmFkb3MgZW4gaW5kZXguaHRtbCBpbmxpbmUgbyBidW5kbGUgcHJldmlvKTpcclxuLy8gZmJEYiwgY3VycmVudFVzZXIsIFhMU1ggKGNkbiksIGVzY2FwZUh0bWwuIE1pc21vIHBhdHJvbiBxdWUgb3Ryb3MgZG9taW5pb3MuXHJcbi8vXHJcbi8vIEZPUkVDQVNUIC0gbW9kYWwgYWRtaW4tb25seSAoTWFyaWFubykuIENodW5rIGxhenk6IHNlIGNhcmdhIHNvbG8gYWwgcHJpbWVyXHJcbi8vIGNsaWNrIGRlbCBib3RvbiBGT1JFQ0FTVCBkZWwgaGVhZGVyLiBSZWdpc3RyYWRvIGVuIGJ1aWxkLmpzIExBWllfQ0hVTktTICtcclxuLy8gc3JjL21haW4uanMgaW5zdGFsbENodW5rU3R1YnMgKyBzdy5qcyBTVEFUSUNfQVNTRVRTLiBWZXIgQ0xBVURFLm1kICMxOC5cclxuLy9cclxuLy8gdjExMTEgY2xlYW46IHBpcGVsaW5lIGxlZ2FjeSAoU0tVICsgNiBjb2x1bW5hcyArIHBvbGl0aWNhIDNtKSByZW1vdmlkby5cclxuLy8gUmVlbXBsYXphZG8gcG9yOlxyXG4vLyAgIC0gRmFzZSAxICh2MTA5OCk6IFNhbGVzIFBsYW5zIG1lbnN1YWxlcyBSb2RzL1JlZWxzIGNvbiBmb3JtYXRvIFNVUi5cclxuLy8gICAtIEZhc2UgMkIgKHYxMTAzKTogRm9yZWNhc3QgRXN0YWRpc3RpY28gKHN0YXRzZm9yZWNhc3QgcGlwZWxpbmUgb2ZmbGluZSkuXHJcbi8vICAgLSBGYXNlIDNBICh2MTEwOSk6IFRhYmxhIFJlY29tZW5kYWNpb24gZGUgQ29tcHJhLlxyXG5cclxuLy8gdjEwOTgrIChGYXNlIDEgRm9yZWNhc3QgdjIpOiBTYWxlcyBQbGFucyBtZW5zdWFsZXMgcG9yIGZhbWlsaWEgKFJvZHMvUmVlbHMvRkcpLlxyXG4vLyBTZSBndWFyZGFuIGVuIEZpcmVzdG9yZSBgc2FsZXNfcGxhbl9jYWNoZS97ZmFtaWxpYX1gICsgc25hcHNob3QgRXhjZWwgb3JpZ2luYWxcclxuLy8gZW4gU3RvcmFnZSBgZm9yZWNhc3RzX3NuYXBzaG90cy97WVlZWS1NTX0ve2ZhbWlsaWF9Lnhsc3hgLlxyXG4vLyBFbCBwYXJzZXIgcHVybyB2aXZlIGVuIHNyYy9wdXJlL3NhbGVzLXBsYW4tcGFyc2VyLmpzIChhdHRhY2ggYSB3aW5kb3cuU2FsZXNQbGFuUGFyc2VyKS5cclxuLy8gdjExMDg6IEZHIHJlbW92aWRvIGRlbCBVSSAoTWFyaWFubyBwaWRpXHUwMEYzKS4gU29sbyBSb2RzICsgUmVlbHMgcG9yIGFob3JhLlxyXG4vLyBMYSBydWxlIEZpcmVzdG9yZSBzaWd1ZSBhY2VwdGFuZG8gJ2ZnJyBwb3Igc2kgZW4gZWwgZnV0dXJvIHNlIHZ1ZWx2ZSBhXHJcbi8vIGFjdGl2YXIgXHUyMDE0IG5vIGJvcnJhcmxhIGVuIHN0b3JhZ2UvZmlyZXN0b3JlLnJ1bGVzIGhhc3RhIGNvbmZpcm1hciBkZXByZWNhdGUuXHJcbmNvbnN0IFNBTEVTX1BMQU5fRkFNSUxJQVMgPSBbXHJcbiAgeyBrZXk6ICdyb2RzJywgbGFiZWw6ICdSb2RzIChDYVx1MDBGMWFzKScsIGNvbG9yOiAnIzBlYTVlOScgfSxcclxuICB7IGtleTogJ3JlZWxzJywgbGFiZWw6ICdSZWVscycsIGNvbG9yOiAnIzhiNWNmNicgfSxcclxuXTtcclxuY29uc3QgX3NhbGVzUGxhbkNhY2hlcyA9IHsgcm9kczogbnVsbCwgcmVlbHM6IG51bGwgfTsgLy8gbGFzdCBsb2FkZWQgZG9jXHJcbmxldCBfZm9yZWNhc3RBY3RpdmVUYWIgPSAnc2FsZXMtcGxhbnMnOyAvLyAnc2FsZXMtcGxhbnMnIHwgJ3N0YXQnIHwgJ2xlZ2FjeSdcclxuXHJcbi8vIHYxMTAzKyAoRmFzZSAyQik6IEZvcmVjYXN0IEVzdGFkXHUwMEVEc3RpY28gXHUyMDE0IG91dHB1dCBwdWJsaWNhZG8gcG9yXHJcbi8vIHNjcmlwdHMvZm9yZWNhc3QvcHVibGlzaF90b19maXJlc3RvcmUucHkgYSBmb3JlY2FzdF9vdXRwdXQve3N1Yl9zbHVnfVxyXG4vLyArIGZvcmVjYXN0X291dHB1dF9tZXRhL2N1cnJlbnQuIDI0IHN1YnMgKyAxIG1ldGEgZG9jLlxyXG5sZXQgX2ZvcmVjYXN0U3RhdERvY3MgPSBudWxsOyAvLyBbe2lkLCBzdWJmYW1pbGlhLCBmb3JlY2FzdFs3XSwgbWV0cmljcywgYmVzdE1vZGVsLCB2ZXJzaW9uSWR9XVxyXG5sZXQgX2ZvcmVjYXN0U3RhdE1ldGEgPSBudWxsOyAvLyB7Z2VuZXJhdGVkQXQsIHZlcnNpb25JZCwgcmVzdW1lbjogey4uLn19XHJcbmxldCBfZm9yZWNhc3RTdGF0SGlzdG9yeUNhY2hlID0gbnVsbDsgLy8geyBbc3ViXTogW3tkcywgeX1dIH0gY2FjaGUgbGF6eSBvbi1kZW1hbmRcclxuXHJcbi8vIHYxMTA5KyAoRmFzZSAzQSk6IFRhYmxhIFJlY29tZW5kYWNpXHUwMEYzbiBkZSBDb21wcmEgXHUyMDE0IGNvbWJpbmEgc2FsZXMgcGxhbnMgK1xyXG4vLyBzdG9ja19zbmFwc2hvdCArIHNrdV92ZW50YXNfc25hcHNob3QgcGFyYSBjb21wdXRhciByZWNvbWVuZGFkbyBwb3IgU0tVLlxyXG5sZXQgX3JlY29TdG9ja1NuYXBzaG90ID0gbnVsbDsgLy8ge3dhcmVob3VzZUJyZWFrZG93bjoge3NrdTp7JzExJzpuLCcxMic6biwuLi59fSwgYmFja29yZGVyQnlTa3U6IHtza3U6bn19XHJcbmxldCBfcmVjb1ZlbnRhc1NuYXBzaG90ID0gbnVsbDsgLy8geyBbU0tVIHVwcGVyXToge21lc2VzOiB7J1lZWVktTU0nOiB7cXR5LGFyc319fSB9XHJcbmxldCBfcmVjb0ZpbHRlck1pblJlYyA9IHRydWU7IC8vIFwic29sbyBtb3N0cmFyIFNLVXMgY29uIHJlY29tZW5kYWRvID4gMFwiXHJcbmxldCBfcmVjb0ZpbHRlckZhbWlsaWEgPSAnYWxsJzsgLy8gJ2FsbCcgfCAncm9kcycgfCAncmVlbHMnXHJcbmxldCBfcmVjb1NlYXJjaFRleHQgPSAnJztcclxuXHJcbi8vIHYxMTEyKyAoRjNCKTogU0tVcyBkZXNjb250aW51YWRvcyBxdWUgTWFyaWFubyBtYXJjYSBwYXJhIGV4Y2x1aXIgZGVsIGZvcmVjYXN0LlxyXG4vLyBQZXJzaXN0ZW4gZW4gRmlyZXN0b3JlIGBmb3JlY2FzdF9jb25maWcvZGlzY29udGludWVkX3NrdXNgIGNvbW8geyBza3VzOiBbU0tVIHVwcGVyXSwgdXBkYXRlZEF0LCB1cGRhdGVkQnkgfS5cclxubGV0IF9kaXNjb250aW51ZWRTa3VzID0gbnVsbDsgLy8gU2V0PHN0cmluZyB1cHBlcj4gbyBudWxsIHNpIG5vIGNhcmdhZG9cclxubGV0IF9kaXNjb250aW51ZWRNZXRhID0gbnVsbDsgLy8ge3VwZGF0ZWRBdCwgdXBkYXRlZEJ5fVxyXG5cclxuLy8gdjExMTQrIChGM0IgbXVsdGlwbGljYWRvciBkaW5cdTAwRTFtaWNvKTogbXVsdGlwbGljYWRvciBhdXRvIHBvciBTS1UgPSB2ZW50YV8ybVxyXG4vLyBkaXZpZGlkbyBwb3IgdmVudGFfNm0sIGNvbiBjYXAuIE92ZXJyaWRlIG1hbnVhbCBwZXJzaXN0aWRvIGVuIEZpcmVzdG9yZVxyXG4vLyBgZm9yZWNhc3RfY29uZmlnL211bHRpcGxpZXJzYCBjb24ge3NrdU92ZXJyaWRlczoge1NLVToge3ZhbHVlLCB1cGRhdGVkQnksIHVwZGF0ZWRBdH19fS5cclxubGV0IF9tdWx0aXBsaWVyT3ZlcnJpZGVzID0gbnVsbDsgLy8geyBbU0tVIHVwcGVyXToge3ZhbHVlLCB1cGRhdGVkQnksIHVwZGF0ZWRBdH0gfVxyXG5jb25zdCBSRUNPX01VTFRfUkVDRU5UX01PTlRIUyA9IDI7XHJcbmNvbnN0IFJFQ09fTVVMVF9CQVNFTElORV9NT05USFMgPSA2O1xyXG5jb25zdCBSRUNPX01VTFRfTUlOID0gMC41O1xyXG5jb25zdCBSRUNPX01VTFRfTUFYID0gMi41O1xyXG5jb25zdCBSRUNPX01VTFRfTUlOX0JBU0VMSU5FID0gMC4xOyAvLyBldml0YSBkaXZpc2lcdTAwRjNuIHBvciBjZXJvXHJcblxyXG5jb25zdCBSRUNPX0hPUklaT05fTU9OVEhTID0gNztcclxuY29uc3QgUkVDT19WRU5UQV9QUk9NRURJT19XSU5ET1cgPSAzOyAvLyBtZXNlcyBoYWNpYSBhdHJcdTAwRTFzIHBhcmEgcHJvbWVkaW8gdmVudGFcclxuY29uc3QgUkVDT19ERUZBVUxUX01VTFRJUExJRVIgPSAxLjA7XHJcblxyXG4vLyBXaGl0ZWxpc3QgZGUgZW1haWxzIGNvbiBhY2Nlc28gYWwgbW9kYWwgRk9SRUNBU1QuIFJlcGxpY2EgZWwgcGF0cm9uIGRlXHJcbi8vIFwiQW5hbGlzaXNcIiAoaW5kZXguaHRtbDoxMjYyNSkuIFNvbG8gTWFyaWFubzsgc2kgb3RybyBhZG1pbiBsbyBuZWNlc2l0YVxyXG4vLyBzZSBhZ3JlZ2EgYWNhIGV4cGxpY2l0by5cclxuY29uc3QgRk9SRUNBU1RfQUxMT1dFRF9FTUFJTFMgPSBbJ21hcmlhbm8uZXJiaW5vQHNoaW1hbm8uY29tLmFyJywgJ2VyYmlub21hcmlhbm9AZ21haWwuY29tJ107XHJcblxyXG5mdW5jdGlvbiBfY2FuRm9yZWNhc3QoKSB7XHJcbiAgdHJ5IHtcclxuICAgIGNvbnN0IGVtYWlsID0gKCh3aW5kb3cuY3VycmVudFVzZXIgJiYgd2luZG93LmN1cnJlbnRVc2VyLmVtYWlsKSB8fCAnJykudG9Mb3dlckNhc2UoKTtcclxuICAgIGlmICghZW1haWwpIHJldHVybiBmYWxzZTtcclxuICAgIHJldHVybiBGT1JFQ0FTVF9BTExPV0VEX0VNQUlMUy5pbmRleE9mKGVtYWlsKSA+PSAwO1xyXG4gIH0gY2F0Y2gge1xyXG4gICAgcmV0dXJuIGZhbHNlO1xyXG4gIH1cclxufVxyXG5cclxuZnVuY3Rpb24gX3JlbmRlck1vZGFsU2hlbGwoKSB7XHJcbiAgY29uc3QgZXhpc3RpbmcgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZm9yZWNhc3QtbW9kYWwnKTtcclxuICBpZiAoZXhpc3RpbmcpIHJldHVybiBleGlzdGluZztcclxuICBjb25zdCBlbCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpO1xyXG4gIGVsLmlkID0gJ2ZvcmVjYXN0LW1vZGFsJztcclxuICBlbC5jbGFzc05hbWUgPSAnbW9kYWwtb3ZlcmxheSc7XHJcbiAgZWwuc3R5bGUuY3NzVGV4dCA9XHJcbiAgICAnZGlzcGxheTpub25lO3Bvc2l0aW9uOmZpeGVkO2luc2V0OjA7YmFja2dyb3VuZDpyZ2JhKDE1LDIzLDQyLC42KTt6LWluZGV4OjIwNTA7JztcclxuICBlbC5vbmNsaWNrID0gZnVuY3Rpb24gKGV2KSB7XHJcbiAgICBpZiAoZXYudGFyZ2V0ID09PSBlbCkgd2luZG93LmNsb3NlRm9yZWNhc3RNb2RhbCgpO1xyXG4gIH07XHJcbiAgLy8gU2hlbGwgKyB0YWJzIGJhciArIDIgY29udGVuZWRvcmVzIGRlIHRhYnMgKFNhbGVzIFBsYW5zIG51ZXZhLCBMZWdhY3kgNm0pLlxyXG4gIC8vIEVsIGNvbnRlbmlkbyBkZSBjYWRhIHRhYiBzZSBwaW50YSBjb24gX3JlbmRlclNhbGVzUGxhbnNUYWIoKSB5IGVsIGxlZ2FjeVxyXG4gIC8vIHVzYSBlbCBmbHVqbyBfcmVuZGVyVGFibGUoKSBkZSBzaWVtcHJlLlxyXG4gIGNvbnN0IHNoZWxsSHRtbCA9IF9idWlsZFNoZWxsSHRtbCgpO1xyXG4gIGVsLmlubmVySFRNTCA9IHNoZWxsSHRtbDtcclxuICBkb2N1bWVudC5ib2R5LmFwcGVuZENoaWxkKGVsKTtcclxuICByZXR1cm4gZWw7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIF9idWlsZFNoZWxsSHRtbCgpIHtcclxuICAvLyBCcm9rZW4tb3V0IHB1cmUgc3RyaW5nIGJ1aWxkZXIgcGFyYSBwYXNhciBlbCBob29rIGRlIGlubmVySFRNTC5cclxuICBjb25zdCBtb2RhbE91dGVyID1cclxuICAgICc8ZGl2IHN0eWxlPVwicG9zaXRpb246YWJzb2x1dGU7aW5zZXQ6MXZoIDF2dztiYWNrZ3JvdW5kOnZhcigtLWJnLWVsZXZhdGVkKTtib3JkZXItcmFkaXVzOjEwcHg7ZGlzcGxheTpmbGV4O2ZsZXgtZGlyZWN0aW9uOmNvbHVtbjtvdmVyZmxvdzpoaWRkZW47Ym94LXNoYWRvdzowIDIwcHggNTBweCByZ2JhKDAsMCwwLC4zNSlcIj4nO1xyXG4gIGNvbnN0IGhlYWRlciA9XHJcbiAgICAnPGRpdiBzdHlsZT1cInBhZGRpbmc6MTJweCAxOHB4O2JhY2tncm91bmQ6IzBmMTcyYTtjb2xvcjojZmZmO2Rpc3BsYXk6ZmxleDthbGlnbi1pdGVtczpjZW50ZXI7Z2FwOjEycHhcIj4nICtcclxuICAgICc8ZGl2IHN0eWxlPVwiZmxleDoxXCI+PGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxNnB4O2ZvbnQtd2VpZ2h0OjgwMDtsZXR0ZXItc3BhY2luZzouNXB4XCI+Rk9SRUNBU1Q8L2Rpdj4nICtcclxuICAgICc8ZGl2IGlkPVwiZm9yZWNhc3Qtc3VidGl0bGVcIiBzdHlsZT1cImZvbnQtc2l6ZToxMXB4O29wYWNpdHk6Ljg7bWFyZ2luLXRvcDoycHhcIj5TYWxlcyBQbGFucyBtZW5zdWFsZXMgKyBwb2xpdGljYSBkZSBpbnZlbnRhcmlvPC9kaXY+PC9kaXY+JyArXHJcbiAgICAnPGJ1dHRvbiBvbmNsaWNrPVwiY2xvc2VGb3JlY2FzdE1vZGFsKClcIiBzdHlsZT1cImJhY2tncm91bmQ6dHJhbnNwYXJlbnQ7Y29sb3I6I2ZmZjtib3JkZXI6MXB4IHNvbGlkIHJnYmEoMjU1LDI1NSwyNTUsLjQpO2JvcmRlci1yYWRpdXM6NnB4O3BhZGRpbmc6NnB4IDEwcHg7Y3Vyc29yOnBvaW50ZXI7Zm9udC13ZWlnaHQ6NzAwXCI+Q2VycmFyPC9idXR0b24+JyArXHJcbiAgICAnPC9kaXY+JztcclxuICAvLyB2MTExMTogdGFiIFwiTGVnYWN5ICg2bSlcIiBlbGltaW5hZGEgXHUyMDE0IGVsIHBpcGVsaW5lIHZpZWpvIChTS1UgKyA2IGNvbHVtbmFzXHJcbiAgLy8gdnMgc2t1X3ZlbnRhc19zbmFwc2hvdCArIHBvbFx1MDBFRHRpY2EgM20pIGZ1ZSByZWVtcGxhemFkbyBwb3IgbGEgdGFibGFcclxuICAvLyBSZWNvbWVuZGFjaVx1MDBGM24gZGUgQ29tcHJhICh2MTEwOSwgRjNBKSBxdWUgdXNhIGRhdG9zIG1cdTAwRTFzIGNvbXBsZXRvcy5cclxuICBjb25zdCB0YWJzQmFyID1cclxuICAgICc8ZGl2IGlkPVwiZm9yZWNhc3QtdGFicy1iYXJcIiBzdHlsZT1cImRpc3BsYXk6ZmxleDtnYXA6MDtiYWNrZ3JvdW5kOnZhcigtLWJnLXNlY29uZGFyeSk7cGFkZGluZzowIDE4cHg7Ym9yZGVyLWJvdHRvbToxcHggc29saWQgdmFyKC0tYm9yZGVyLXN1YnRsZSlcIj4nICtcclxuICAgICc8YnV0dG9uIGRhdGEtdGFiPVwic2FsZXMtcGxhbnNcIiBvbmNsaWNrPVwic3dpdGNoRm9yZWNhc3RUYWIoXFwnc2FsZXMtcGxhbnNcXCcpXCIgY2xhc3M9XCJmb3JlY2FzdC10YWJcIiBzdHlsZT1cInBhZGRpbmc6MTBweCAxNnB4O2JhY2tncm91bmQ6dHJhbnNwYXJlbnQ7Y29sb3I6dmFyKC0tdGV4dC1wcmltYXJ5KTtib3JkZXI6bm9uZTtib3JkZXItYm90dG9tOjNweCBzb2xpZCAjMGQ5NDg4O2N1cnNvcjpwb2ludGVyO2ZvbnQtd2VpZ2h0OjcwMDtmb250LXNpemU6MTJweDtsZXR0ZXItc3BhY2luZzouNHB4O3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZVwiPlNhbGVzIFBsYW5zPC9idXR0b24+JyArXHJcbiAgICAnPGJ1dHRvbiBkYXRhLXRhYj1cInN0YXRcIiBvbmNsaWNrPVwic3dpdGNoRm9yZWNhc3RUYWIoXFwnc3RhdFxcJylcIiBjbGFzcz1cImZvcmVjYXN0LXRhYlwiIHN0eWxlPVwicGFkZGluZzoxMHB4IDE2cHg7YmFja2dyb3VuZDp0cmFuc3BhcmVudDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTtib3JkZXI6bm9uZTtib3JkZXItYm90dG9tOjNweCBzb2xpZCB0cmFuc3BhcmVudDtjdXJzb3I6cG9pbnRlcjtmb250LXdlaWdodDo2MDA7Zm9udC1zaXplOjEycHg7bGV0dGVyLXNwYWNpbmc6LjRweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2VcIj5Gb3JlY2FzdCBFc3RhZFx1MDBFRHN0aWNvPC9idXR0b24+JyArXHJcbiAgICAnPC9kaXY+JztcclxuICBjb25zdCB0YWJTYWxlc1BsYW5zID0gJzxkaXYgaWQ9XCJmb3JlY2FzdC10YWItc2FsZXMtcGxhbnNcIiBzdHlsZT1cImZsZXg6MTtvdmVyZmxvdzphdXRvXCI+PC9kaXY+JztcclxuICBjb25zdCB0YWJTdGF0ID0gJzxkaXYgaWQ9XCJmb3JlY2FzdC10YWItc3RhdFwiIHN0eWxlPVwiZmxleDoxO292ZXJmbG93OmF1dG87ZGlzcGxheTpub25lXCI+PC9kaXY+JztcclxuICByZXR1cm4gbW9kYWxPdXRlciArIGhlYWRlciArIHRhYnNCYXIgKyB0YWJTYWxlc1BsYW5zICsgdGFiU3RhdCArICc8L2Rpdj4nO1xyXG59XHJcblxyXG4vLyB2MTA5OCsgRmFzZSAxICsgdjExMDMrIEZhc2UgMkIgKyB2MTEwNSBmaXggKyB2MTExMSBjbGVhbiBsZWdhY3k6IHN3aXRjaFxyXG4vLyBlbnRyZSB0YWJzIFNhbGVzIFBsYW5zIC8gRm9yZWNhc3QgRXN0YWRcdTAwRURzdGljby5cclxud2luZG93LnN3aXRjaEZvcmVjYXN0VGFiID0gZnVuY3Rpb24gKHRhYklkKSB7XHJcbiAgX2ZvcmVjYXN0QWN0aXZlVGFiID0gdGFiSWQ7XHJcbiAgY29uc3Qgc3AgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZm9yZWNhc3QtdGFiLXNhbGVzLXBsYW5zJyk7XHJcbiAgY29uc3Qgc3QgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZm9yZWNhc3QtdGFiLXN0YXQnKTtcclxuICBpZiAoc3ApIHNwLnN0eWxlLmRpc3BsYXkgPSB0YWJJZCA9PT0gJ3NhbGVzLXBsYW5zJyA/ICdibG9jaycgOiAnbm9uZSc7XHJcbiAgaWYgKHN0KSBzdC5zdHlsZS5kaXNwbGF5ID0gdGFiSWQgPT09ICdzdGF0JyA/ICdibG9jaycgOiAnbm9uZSc7XHJcbiAgY29uc3QgYnRucyA9IGRvY3VtZW50LnF1ZXJ5U2VsZWN0b3JBbGwoJyNmb3JlY2FzdC10YWJzLWJhciAuZm9yZWNhc3QtdGFiJyk7XHJcbiAgYnRucy5mb3JFYWNoKChiKSA9PiB7XHJcbiAgICBjb25zdCBhY3RpdmUgPSBiLmdldEF0dHJpYnV0ZSgnZGF0YS10YWInKSA9PT0gdGFiSWQ7XHJcbiAgICBiLnN0eWxlLmNvbG9yID0gYWN0aXZlID8gJ3ZhcigtLXRleHQtcHJpbWFyeSknIDogJ3ZhcigtLXRleHQtbXV0ZWQpJztcclxuICAgIGIuc3R5bGUuYm9yZGVyQm90dG9tQ29sb3IgPSBhY3RpdmUgPyAnIzBkOTQ4OCcgOiAndHJhbnNwYXJlbnQnO1xyXG4gICAgYi5zdHlsZS5mb250V2VpZ2h0ID0gYWN0aXZlID8gJzcwMCcgOiAnNjAwJztcclxuICB9KTtcclxuICAvLyB2MTEwNSBmaXg6IGFsIGFjdGl2YXIgbGEgdGFiIHN0YXQsIG1vc3RyYXIgcGxhY2Vob2xkZXIgaW5tZWRpYXRvIHBhcmFcclxuICAvLyBxdWUgc2UgdmVhIGFsZ28gbWllbnRyYXMgY2FyZ2EgKG8gc2kgZWwgbG9hZCB5YSB0ZXJtaW5vLCByZS1yZW5kZXIpLlxyXG4gIGlmICh0YWJJZCA9PT0gJ3N0YXQnKSB7XHJcbiAgICBjb25zdCBjb250ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2ZvcmVjYXN0LXRhYi1zdGF0Jyk7XHJcbiAgICBpZiAoY29udCkge1xyXG4gICAgICBpZiAoX2ZvcmVjYXN0U3RhdERvY3MpIHtcclxuICAgICAgICAvLyBZYSBjYXJnYWRvOiByZS1yZW5kZXIgKHBvciBzaSBlbCB1c2VyIHZpZW5lIGRlIG90cmEgdGFiKS5cclxuICAgICAgICBfcmVuZGVyRm9yZWNhc3RTdGF0VGFiKCk7XHJcbiAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgLy8gQVx1MDBGQW4gbm8gY2FyZ2FkbzogcGxhY2Vob2xkZXIgKyBsb2FkLlxyXG4gICAgICAgIGNvbnQuaW5uZXJIVE1MID1cclxuICAgICAgICAgICc8ZGl2IHN0eWxlPVwicGFkZGluZzo2MHB4IDIwcHg7dGV4dC1hbGlnbjpjZW50ZXI7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7Zm9udC1zaXplOjE0cHhcIj4nICtcclxuICAgICAgICAgICc8ZGl2IHN0eWxlPVwiZGlzcGxheTppbmxpbmUtYmxvY2s7d2lkdGg6MjRweDtoZWlnaHQ6MjRweDtib3JkZXI6M3B4IHNvbGlkICMwZDk0ODg7Ym9yZGVyLXRvcC1jb2xvcjp0cmFuc3BhcmVudDtib3JkZXItcmFkaXVzOjUwJTthbmltYXRpb246c3BpbiAwLjhzIGxpbmVhciBpbmZpbml0ZTttYXJnaW4tYm90dG9tOjEycHhcIj48L2Rpdj4nICtcclxuICAgICAgICAgICc8ZGl2PkNhcmdhbmRvIGZvcmVjYXN0X291dHB1dCBkZXNkZSBGaXJlc3RvcmUuLi48L2Rpdj4nICtcclxuICAgICAgICAgICc8c3R5bGU+QGtleWZyYW1lcyBzcGlue3Rve3RyYW5zZm9ybTpyb3RhdGUoMzYwZGVnKX19PC9zdHlsZT4nICtcclxuICAgICAgICAgICc8L2Rpdj4nO1xyXG4gICAgICAgIF9sb2FkRm9yZWNhc3RPdXRwdXQoKVxyXG4gICAgICAgICAgLnRoZW4oX3JlbmRlckZvcmVjYXN0U3RhdFRhYilcclxuICAgICAgICAgIC5jYXRjaCgoZSkgPT4ge1xyXG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKCdbRk9SRUNBU1Qgc3RhdF0gbG9hZCBmYWlsJywgZSk7XHJcbiAgICAgICAgICAgIGNvbnN0IGMgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZm9yZWNhc3QtdGFiLXN0YXQnKTtcclxuICAgICAgICAgICAgaWYgKGMpIHtcclxuICAgICAgICAgICAgICBjLmlubmVySFRNTCA9XHJcbiAgICAgICAgICAgICAgICAnPGRpdiBzdHlsZT1cInBhZGRpbmc6NjBweCAyMHB4O3RleHQtYWxpZ246Y2VudGVyO2NvbG9yOiNkYzI2MjY7bGluZS1oZWlnaHQ6MS42XCI+JyArXHJcbiAgICAgICAgICAgICAgICAnPGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxNnB4O2ZvbnQtd2VpZ2h0OjcwMDttYXJnaW4tYm90dG9tOjEycHhcIj5FcnJvciBjYXJnYW5kbyBmb3JlY2FzdF9vdXRwdXQ8L2Rpdj4nICtcclxuICAgICAgICAgICAgICAgICc8ZGl2IHN0eWxlPVwiZm9udC1zaXplOjEycHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7bWFyZ2luLWJvdHRvbToxNnB4XCI+JyArXHJcbiAgICAgICAgICAgICAgICBlc2NhcGVIdG1sU2FmZShlLm1lc3NhZ2UgfHwgU3RyaW5nKGUpKSArXHJcbiAgICAgICAgICAgICAgICAnPC9kaXY+JyArXHJcbiAgICAgICAgICAgICAgICAnPGJ1dHRvbiBvbmNsaWNrPVwic3dpdGNoRm9yZWNhc3RUYWIoXFwnc3RhdFxcJylcIiBzdHlsZT1cInBhZGRpbmc6OHB4IDE0cHg7YmFja2dyb3VuZDojMGQ5NDg4O2NvbG9yOiNmZmY7Ym9yZGVyOm5vbmU7Ym9yZGVyLXJhZGl1czo2cHg7Zm9udC13ZWlnaHQ6NzAwO2N1cnNvcjpwb2ludGVyXCI+UmVpbnRlbnRhcjwvYnV0dG9uPicgK1xyXG4gICAgICAgICAgICAgICAgJzwvZGl2Pic7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgIH0pO1xyXG4gICAgICB9XHJcbiAgICB9XHJcbiAgfVxyXG59O1xyXG5cclxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcbi8vIEZBU0UgMSBcdTIwMTQgU2FsZXMgUGxhbnMgdXBsb2FkIChSb2RzIC8gUmVlbHMgLyBGRylcclxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblxyXG5mdW5jdGlvbiBfeWVhck1vbnRoTm93KCkge1xyXG4gIGNvbnN0IGQgPSBuZXcgRGF0ZSgpO1xyXG4gIHJldHVybiBkLmdldEZ1bGxZZWFyKCkgKyAnLScgKyBTdHJpbmcoZC5nZXRNb250aCgpICsgMSkucGFkU3RhcnQoMiwgJzAnKTtcclxufVxyXG5cclxuZnVuY3Rpb24gX2ZtdFNpemUoYnl0ZXMpIHtcclxuICBpZiAoIWJ5dGVzKSByZXR1cm4gJyc7XHJcbiAgaWYgKGJ5dGVzIDwgMTAyNCkgcmV0dXJuIGJ5dGVzICsgJyBCJztcclxuICBpZiAoYnl0ZXMgPCAxMDI0ICogMTAyNCkgcmV0dXJuIChieXRlcyAvIDEwMjQpLnRvRml4ZWQoMSkgKyAnIEtCJztcclxuICByZXR1cm4gKGJ5dGVzIC8gKDEwMjQgKiAxMDI0KSkudG9GaXhlZCgyKSArICcgTUInO1xyXG59XHJcblxyXG5mdW5jdGlvbiBfZm10RGF0ZVNob3J0KGlzbykge1xyXG4gIGlmICghaXNvKSByZXR1cm4gJ1x1MjAxNCc7XHJcbiAgdHJ5IHtcclxuICAgIGNvbnN0IGQgPSBpc28udG9EYXRlID8gaXNvLnRvRGF0ZSgpIDogbmV3IERhdGUoaXNvKTtcclxuICAgIHJldHVybiAoXHJcbiAgICAgIGQudG9Mb2NhbGVEYXRlU3RyaW5nKCdlcy1BUicsIHsgZGF5OiAnMi1kaWdpdCcsIG1vbnRoOiAnc2hvcnQnLCB5ZWFyOiAnMi1kaWdpdCcgfSkgK1xyXG4gICAgICAnICcgK1xyXG4gICAgICBkLnRvTG9jYWxlVGltZVN0cmluZygnZXMtQVInLCB7IGhvdXI6ICcyLWRpZ2l0JywgbWludXRlOiAnMi1kaWdpdCcgfSlcclxuICAgICk7XHJcbiAgfSBjYXRjaCB7XHJcbiAgICByZXR1cm4gU3RyaW5nKGlzbyk7XHJcbiAgfVxyXG59XHJcblxyXG5hc3luYyBmdW5jdGlvbiBfbG9hZFNhbGVzUGxhbkNhY2hlcygpIHtcclxuICBpZiAoIXdpbmRvdy5mYkRiKSByZXR1cm47XHJcbiAgYXdhaXQgUHJvbWlzZS5hbGwoXHJcbiAgICBTQUxFU19QTEFOX0ZBTUlMSUFTLm1hcChhc3luYyAoZikgPT4ge1xyXG4gICAgICB0cnkge1xyXG4gICAgICAgIGNvbnN0IGRvYyA9IGF3YWl0IHdpbmRvdy5mYkRiLmNvbGxlY3Rpb24oJ3NhbGVzX3BsYW5fY2FjaGUnKS5kb2MoZi5rZXkpLmdldCgpO1xyXG4gICAgICAgIF9zYWxlc1BsYW5DYWNoZXNbZi5rZXldID0gZG9jLmV4aXN0cyA/IGRvYy5kYXRhKCkgOiBudWxsO1xyXG4gICAgICB9IGNhdGNoIChlKSB7XHJcbiAgICAgICAgY29uc29sZS53YXJuKCdbRk9SRUNBU1RdIGxvYWQgc2FsZXNfcGxhbl9jYWNoZS8nICsgZi5rZXkgKyAnIGZhaWw6JywgZSAmJiBlLm1lc3NhZ2UpO1xyXG4gICAgICAgIF9zYWxlc1BsYW5DYWNoZXNbZi5rZXldID0gbnVsbDtcclxuICAgICAgfVxyXG4gICAgfSlcclxuICApO1xyXG59XHJcblxyXG5mdW5jdGlvbiBlc2NhcGVIdG1sU2FmZShzKSB7XHJcbiAgaWYgKHR5cGVvZiB3aW5kb3cuZXNjYXBlSHRtbCA9PT0gJ2Z1bmN0aW9uJykgcmV0dXJuIHdpbmRvdy5lc2NhcGVIdG1sKHMpO1xyXG4gIHJldHVybiBTdHJpbmcocyA9PSBudWxsID8gJycgOiBzKS5yZXBsYWNlKFxyXG4gICAgL1smPD5cIiddL2csXHJcbiAgICAoY2gpID0+ICh7ICcmJzogJyZhbXA7JywgJzwnOiAnJmx0OycsICc+JzogJyZndDsnLCAnXCInOiAnJnF1b3Q7JywgXCInXCI6ICcmIzM5OycgfSlbY2hdXHJcbiAgKTtcclxufVxyXG5cclxuZnVuY3Rpb24gX2J1aWxkU2FsZXNQbGFuU2xvdEh0bWwoZikge1xyXG4gIGNvbnN0IGNhY2hlID0gX3NhbGVzUGxhbkNhY2hlc1tmLmtleV07XHJcbiAgY29uc3Qgcm93c0NvdW50ID0gY2FjaGUgJiYgTnVtYmVyLmlzRmluaXRlKGNhY2hlLnJvd3NDb3VudCkgPyBjYWNoZS5yb3dzQ291bnQgOiAwO1xyXG4gIGNvbnN0IG1vbnRoc0NvdW50ID1cclxuICAgIGNhY2hlICYmIEFycmF5LmlzQXJyYXkoY2FjaGUuZGV0ZWN0ZWRNb250aHMpID8gY2FjaGUuZGV0ZWN0ZWRNb250aHMubGVuZ3RoIDogMDtcclxuICBjb25zdCBwYXJzZWRBdCA9IGNhY2hlICYmIGNhY2hlLnBhcnNlZEF0ID8gX2ZtdERhdGVTaG9ydChjYWNoZS5wYXJzZWRBdCkgOiAnJztcclxuICBjb25zdCB1cGxvYWRlZEJ5ID0gY2FjaGUgJiYgY2FjaGUudXBsb2FkZWRCeSA/IGNhY2hlLnVwbG9hZGVkQnkgOiAnJztcclxuICBjb25zdCBzb3VyY2VGaWxlbmFtZSA9IGNhY2hlICYmIGNhY2hlLnNvdXJjZUZpbGVuYW1lID8gY2FjaGUuc291cmNlRmlsZW5hbWUgOiAnJztcclxuICBjb25zdCB5ZWFyTW9udGggPSBjYWNoZSAmJiBjYWNoZS55ZWFyTW9udGggPyBjYWNoZS55ZWFyTW9udGggOiAnJztcclxuICBjb25zdCBtb250aHNSYW5nZSA9XHJcbiAgICBjYWNoZSAmJiBjYWNoZS5kZXRlY3RlZE1vbnRocyAmJiBjYWNoZS5kZXRlY3RlZE1vbnRocy5sZW5ndGhcclxuICAgICAgPyBjYWNoZS5kZXRlY3RlZE1vbnRoc1swXSArICcgXHUyMTkyICcgKyBjYWNoZS5kZXRlY3RlZE1vbnRoc1tjYWNoZS5kZXRlY3RlZE1vbnRocy5sZW5ndGggLSAxXVxyXG4gICAgICA6ICdcdTIwMTQnO1xyXG4gIGNvbnN0IGhhc0NhY2hlID0gISFjYWNoZTtcclxuICBjb25zdCBiYWRnZSA9IGhhc0NhY2hlXHJcbiAgICA/ICc8ZGl2IHN0eWxlPVwicGFkZGluZzo0cHggOHB4O2JhY2tncm91bmQ6IzE2YTM0YTtjb2xvcjojZmZmO2JvcmRlci1yYWRpdXM6MTJweDtmb250LXNpemU6MTBweDtmb250LXdlaWdodDo3MDA7bGV0dGVyLXNwYWNpbmc6LjRweFwiPkNBUkdBRE88L2Rpdj4nXHJcbiAgICA6ICc8ZGl2IHN0eWxlPVwicGFkZGluZzo0cHggOHB4O2JhY2tncm91bmQ6I2RjMjYyNjtjb2xvcjojZmZmO2JvcmRlci1yYWRpdXM6MTJweDtmb250LXNpemU6MTBweDtmb250LXdlaWdodDo3MDA7bGV0dGVyLXNwYWNpbmc6LjRweFwiPkZBTFRBPC9kaXY+JztcclxuICBjb25zdCBtZXRhQmxvY2sgPSBoYXNDYWNoZVxyXG4gICAgPyAnPGRpdiBzdHlsZT1cImRpc3BsYXk6Z3JpZDtncmlkLXRlbXBsYXRlLWNvbHVtbnM6YXV0byAxZnI7Z2FwOjZweCAxMnB4O2ZvbnQtc2l6ZToxMXB4O3BhZGRpbmc6MTBweCAxMnB4O2JhY2tncm91bmQ6dmFyKC0tYmctc2Vjb25kYXJ5KTtib3JkZXItcmFkaXVzOjZweFwiPicgK1xyXG4gICAgICAnPGRpdiBzdHlsZT1cImNvbG9yOnZhcigtLXRleHQtbXV0ZWQpO2ZvbnQtd2VpZ2h0OjYwMFwiPkFyY2hpdm88L2Rpdj48ZGl2IHN0eWxlPVwiY29sb3I6dmFyKC0tdGV4dC1wcmltYXJ5KTtmb250LWZhbWlseTptb25vc3BhY2U7d29yZC1icmVhazpicmVhay1hbGxcIj4nICtcclxuICAgICAgZXNjYXBlSHRtbFNhZmUoc291cmNlRmlsZW5hbWUpICtcclxuICAgICAgJzwvZGl2PicgK1xyXG4gICAgICAnPGRpdiBzdHlsZT1cImNvbG9yOnZhcigtLXRleHQtbXV0ZWQpO2ZvbnQtd2VpZ2h0OjYwMFwiPlN1YmlkbzwvZGl2PjxkaXYgc3R5bGU9XCJjb2xvcjp2YXIoLS10ZXh0LXByaW1hcnkpXCI+JyArXHJcbiAgICAgIGVzY2FwZUh0bWxTYWZlKHBhcnNlZEF0KSArXHJcbiAgICAgICc8L2Rpdj4nICtcclxuICAgICAgJzxkaXYgc3R5bGU9XCJjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTtmb250LXdlaWdodDo2MDBcIj5Qb3I8L2Rpdj48ZGl2IHN0eWxlPVwiY29sb3I6dmFyKC0tdGV4dC1wcmltYXJ5KVwiPicgK1xyXG4gICAgICBlc2NhcGVIdG1sU2FmZSh1cGxvYWRlZEJ5KSArXHJcbiAgICAgICc8L2Rpdj4nICtcclxuICAgICAgJzxkaXYgc3R5bGU9XCJjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTtmb250LXdlaWdodDo2MDBcIj5TbmFwc2hvdDwvZGl2PjxkaXYgc3R5bGU9XCJjb2xvcjp2YXIoLS10ZXh0LXByaW1hcnkpO2ZvbnQtZmFtaWx5Om1vbm9zcGFjZVwiPicgK1xyXG4gICAgICBlc2NhcGVIdG1sU2FmZSh5ZWFyTW9udGgpICtcclxuICAgICAgJzwvZGl2PicgK1xyXG4gICAgICAnPGRpdiBzdHlsZT1cImNvbG9yOnZhcigtLXRleHQtbXV0ZWQpO2ZvbnQtd2VpZ2h0OjYwMFwiPlNLVXM8L2Rpdj48ZGl2IHN0eWxlPVwiY29sb3I6dmFyKC0tdGV4dC1wcmltYXJ5KTtmb250LXdlaWdodDo3MDBcIj4nICtcclxuICAgICAgcm93c0NvdW50LnRvTG9jYWxlU3RyaW5nKCdlcy1BUicpICtcclxuICAgICAgJzwvZGl2PicgK1xyXG4gICAgICAnPGRpdiBzdHlsZT1cImNvbG9yOnZhcigtLXRleHQtbXV0ZWQpO2ZvbnQtd2VpZ2h0OjYwMFwiPk1lc2VzPC9kaXY+PGRpdiBzdHlsZT1cImNvbG9yOnZhcigtLXRleHQtcHJpbWFyeSk7Zm9udC13ZWlnaHQ6NzAwXCI+JyArXHJcbiAgICAgIG1vbnRoc0NvdW50ICtcclxuICAgICAgJyA8c3BhbiBzdHlsZT1cImNvbG9yOnZhcigtLXRleHQtbXV0ZWQpO2ZvbnQtd2VpZ2h0OjQwMFwiPignICtcclxuICAgICAgZXNjYXBlSHRtbFNhZmUobW9udGhzUmFuZ2UpICtcclxuICAgICAgJyk8L3NwYW4+PC9kaXY+JyArXHJcbiAgICAgICc8L2Rpdj4nXHJcbiAgICA6ICc8ZGl2IHN0eWxlPVwicGFkZGluZzoxNHB4O3RleHQtYWxpZ246Y2VudGVyO2ZvbnQtc2l6ZToxMnB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO2JhY2tncm91bmQ6dmFyKC0tYmctc2Vjb25kYXJ5KTtib3JkZXItcmFkaXVzOjZweDtib3JkZXI6MXB4IGRhc2hlZCB2YXIoLS1ib3JkZXItc3VidGxlKVwiPkF1biBubyBzdWJpc3RlIGVsIFNhbGVzIFBsYW4gZGUgZXN0YSBmYW1pbGlhLjwvZGl2Pic7XHJcbiAgY29uc3QgdXBsb2FkQnRuID1cclxuICAgICc8bGFiZWwgc3R5bGU9XCJkaXNwbGF5OmlubGluZS1mbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtqdXN0aWZ5LWNvbnRlbnQ6Y2VudGVyO2dhcDo4cHg7cGFkZGluZzoxMHB4IDE0cHg7YmFja2dyb3VuZDonICtcclxuICAgIGYuY29sb3IgK1xyXG4gICAgJztjb2xvcjojZmZmO2JvcmRlci1yYWRpdXM6NnB4O2ZvbnQtd2VpZ2h0OjcwMDtmb250LXNpemU6MTJweDtjdXJzb3I6cG9pbnRlcjtsZXR0ZXItc3BhY2luZzouNHB4XCI+JyArXHJcbiAgICAnPHNwYW4+JyArXHJcbiAgICAoaGFzQ2FjaGUgPyAnXHUyMUJCIFJlZW1wbGF6YXIgRXhjZWwnIDogJ1x1MkIwNiBDYXJnYXIgRXhjZWwnKSArXHJcbiAgICAnPC9zcGFuPicgK1xyXG4gICAgJzxpbnB1dCB0eXBlPVwiZmlsZVwiIGFjY2VwdD1cIi54bHN4LC54bHNcIiBkYXRhLWZhbWlsaWE9XCInICtcclxuICAgIGYua2V5ICtcclxuICAgICdcIiBzdHlsZT1cImRpc3BsYXk6bm9uZVwiIG9uY2hhbmdlPVwib25TYWxlc1BsYW5GaWxlRm9yRmFtaWxpYShldmVudCwgXFwnJyArXHJcbiAgICBmLmtleSArXHJcbiAgICAnXFwnKVwiLz4nICtcclxuICAgICc8L2xhYmVsPic7XHJcbiAgY29uc3QgY2FyZEhlYWQgPVxyXG4gICAgJzxkaXYgc3R5bGU9XCJkaXNwbGF5OmZsZXg7YWxpZ24taXRlbXM6Y2VudGVyO2dhcDoxMHB4XCI+JyArXHJcbiAgICAnPGRpdiBzdHlsZT1cIndpZHRoOjEycHg7aGVpZ2h0OjMycHg7YmFja2dyb3VuZDonICtcclxuICAgIGYuY29sb3IgK1xyXG4gICAgJztib3JkZXItcmFkaXVzOjNweFwiPjwvZGl2PicgK1xyXG4gICAgJzxkaXYgc3R5bGU9XCJmbGV4OjFcIj48ZGl2IHN0eWxlPVwiZm9udC1zaXplOjE0cHg7Zm9udC13ZWlnaHQ6ODAwO2NvbG9yOnZhcigtLXRleHQtcHJpbWFyeSlcIj4nICtcclxuICAgIGVzY2FwZUh0bWxTYWZlKGYubGFiZWwpICtcclxuICAgICc8L2Rpdj4nICtcclxuICAgICc8ZGl2IHN0eWxlPVwiZm9udC1zaXplOjExcHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7bWFyZ2luLXRvcDoycHhcIj5TYWxlcyBQbGFuIG1lbnN1YWwgXHUwMEI3IEhvamEgU0FSPC9kaXY+PC9kaXY+JyArXHJcbiAgICBiYWRnZSArXHJcbiAgICAnPC9kaXY+JztcclxuICByZXR1cm4gKFxyXG4gICAgJzxkaXYgc3R5bGU9XCJiYWNrZ3JvdW5kOnZhcigtLWJnLWVsZXZhdGVkKTtib3JkZXI6MXB4IHNvbGlkIHZhcigtLWJvcmRlci1zdWJ0bGUpO2JvcmRlci1yYWRpdXM6MTBweDtwYWRkaW5nOjE2cHg7ZGlzcGxheTpmbGV4O2ZsZXgtZGlyZWN0aW9uOmNvbHVtbjtnYXA6MTJweFwiPicgK1xyXG4gICAgY2FyZEhlYWQgK1xyXG4gICAgbWV0YUJsb2NrICtcclxuICAgIHVwbG9hZEJ0biArXHJcbiAgICAnPGRpdiBpZD1cInNhbGVzLXBsYW4tc3RhdHVzLScgK1xyXG4gICAgZi5rZXkgK1xyXG4gICAgJ1wiIHN0eWxlPVwiZm9udC1zaXplOjExcHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7bWluLWhlaWdodDoxNHB4XCI+PC9kaXY+JyArXHJcbiAgICAnPC9kaXY+J1xyXG4gICk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIF9yZW5kZXJTYWxlc1BsYW5zVGFiKCkge1xyXG4gIGNvbnN0IGNvbnQgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZm9yZWNhc3QtdGFiLXNhbGVzLXBsYW5zJyk7XHJcbiAgaWYgKCFjb250KSByZXR1cm47XHJcbiAgY29uc3Qgc2xvdHMgPSBTQUxFU19QTEFOX0ZBTUlMSUFTLm1hcChfYnVpbGRTYWxlc1BsYW5TbG90SHRtbCkuam9pbignJyk7XHJcbiAgY29uc3QgaW50cm8gPVxyXG4gICAgJzxkaXYgc3R5bGU9XCJtYXJnaW4tYm90dG9tOjE2cHg7cGFkZGluZzoxMnB4IDE0cHg7YmFja2dyb3VuZDp2YXIoLS1iZy1zZWNvbmRhcnkpO2JvcmRlci1sZWZ0OjNweCBzb2xpZCAjMGQ5NDg4O2JvcmRlci1yYWRpdXM6NnB4O2ZvbnQtc2l6ZToxMnB4O2NvbG9yOnZhcigtLXRleHQtc2Vjb25kYXJ5KTtsaW5lLWhlaWdodDoxLjVcIj4nICtcclxuICAgICc8YiBzdHlsZT1cImNvbG9yOnZhcigtLXRleHQtcHJpbWFyeSlcIj5GYXNlIDE8L2I+IFx1MjAxNCBDYXJnXHUwMEUxIGxvcyBTYWxlcyBQbGFucyBtZW5zdWFsZXMgKFJvZHMgLyBSZWVscykuIFNlIHBhcnNlYSBsYSBob2phIDxiPlNBUjwvYj46IFNLVSwgTU9RIDEyIG1vbnRocywgeSB1bmEgY29sdW1uYSBwb3IgbWVzLiAnICtcclxuICAgICdFbCBFeGNlbCBvcmlnaW5hbCBxdWVkYSBzbmFwc2hvdGFkbyBlbiBTdG9yYWdlIHkgZWwgcGFyc2VvIHF1ZWRhIGVuIEZpcmVzdG9yZSBwYXJhIGVsIGNcdTAwRTFsY3VsbyBkZWJham8uJyArXHJcbiAgICAnPC9kaXY+JztcclxuICBjb25zdCBncmlkID1cclxuICAgICc8ZGl2IHN0eWxlPVwiZGlzcGxheTpncmlkO2dyaWQtdGVtcGxhdGUtY29sdW1uczpyZXBlYXQoYXV0by1maXQsbWlubWF4KDMyMHB4LDFmcikpO2dhcDoxNnB4O21hcmdpbi1ib3R0b206MjRweFwiPicgK1xyXG4gICAgc2xvdHMgK1xyXG4gICAgJzwvZGl2Pic7XHJcbiAgLy8gdjExMDk6IGNvbnRlbmVkb3IgcGFyYSB0YWJsYSBSZWNvbWVuZGFjaVx1MDBGM24gZGUgQ29tcHJhLiBTZSByZWxsZW5hIG9uLWRlbWFuZFxyXG4gIC8vIHZpYSBfcmVuZGVyUmVjb1NlY3Rpb24oKSAobGF6eSBsb2FkIGRlIHN0b2NrX3NuYXBzaG90ICsgc2t1X3ZlbnRhc19zbmFwc2hvdCkuXHJcbiAgY29uc3QgcmVjb1NlY3Rpb24gPSAnPGRpdiBpZD1cInJlY28tc2VjdGlvbi1jb250YWluZXJcIj48L2Rpdj4nO1xyXG4gIGNvbnQuaW5uZXJIVE1MID0gJzxkaXYgc3R5bGU9XCJwYWRkaW5nOjE4cHhcIj4nICsgaW50cm8gKyBncmlkICsgcmVjb1NlY3Rpb24gKyAnPC9kaXY+JztcclxuICBfcmVuZGVyUmVjb1NlY3Rpb24oKTtcclxufVxyXG5cclxud2luZG93Lm9uU2FsZXNQbGFuRmlsZUZvckZhbWlsaWEgPSBhc3luYyBmdW5jdGlvbiAoZXZlbnQsIGZhbWlsaWEpIHtcclxuICBjb25zdCBmaWxlID0gZXZlbnQgJiYgZXZlbnQudGFyZ2V0ICYmIGV2ZW50LnRhcmdldC5maWxlcyAmJiBldmVudC50YXJnZXQuZmlsZXNbMF07XHJcbiAgaWYgKCFmaWxlKSByZXR1cm47XHJcbiAgY29uc3Qgc3RhdHVzRWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnc2FsZXMtcGxhbi1zdGF0dXMtJyArIGZhbWlsaWEpO1xyXG4gIGNvbnN0IHNldFN0YXR1cyA9IChtc2csIGNvbG9yKSA9PiB7XHJcbiAgICBpZiAoIXN0YXR1c0VsKSByZXR1cm47XHJcbiAgICBzdGF0dXNFbC50ZXh0Q29udGVudCA9IG1zZztcclxuICAgIHN0YXR1c0VsLnN0eWxlLmNvbG9yID0gY29sb3IgfHwgJ3ZhcigtLXRleHQtbXV0ZWQpJztcclxuICB9O1xyXG4gIHRyeSB7XHJcbiAgICBpZiAodHlwZW9mIFhMU1ggPT09ICd1bmRlZmluZWQnKSB7XHJcbiAgICAgIGFsZXJ0KCdTaGVldEpTIChYTFNYKSBubyBjYXJnYWRvIFx1MjAxNCByZWNhcmdcdTAwRTEgbGEgYXBwLicpO1xyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcbiAgICBpZiAoIXdpbmRvdy5TYWxlc1BsYW5QYXJzZXIgfHwgIXdpbmRvdy5TYWxlc1BsYW5QYXJzZXIucGFyc2VTYWxlc1BsYW5TaGVldCkge1xyXG4gICAgICBhbGVydCgnUGFyc2VyIFNhbGVzIFBsYW4gbm8gY2FyZ2Fkby4gUmVidWlsZCBidW5kbGUuJyk7XHJcbiAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIGlmICghd2luZG93LmZpcmViYXNlIHx8ICF3aW5kb3cuZmlyZWJhc2Uuc3RvcmFnZSkge1xyXG4gICAgICBhbGVydCgnRmlyZWJhc2UgU3RvcmFnZSBubyBkaXNwb25pYmxlLicpO1xyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcbiAgICBzZXRTdGF0dXMoJ0xleWVuZG8gRXhjZWxcdTIwMjYnKTtcclxuICAgIGNvbnN0IGJ1ZiA9IGF3YWl0IGZpbGUuYXJyYXlCdWZmZXIoKTtcclxuICAgIGNvbnN0IHdiID0gWExTWC5yZWFkKGJ1ZiwgeyB0eXBlOiAnYXJyYXknIH0pO1xyXG4gICAgY29uc3Qgc2FyTmFtZSA9IHdiLlNoZWV0TmFtZXMuZmluZChcclxuICAgICAgKG4pID0+XHJcbiAgICAgICAgU3RyaW5nKG4gfHwgJycpXHJcbiAgICAgICAgICAudHJpbSgpXHJcbiAgICAgICAgICAudG9VcHBlckNhc2UoKSA9PT0gJ1NBUidcclxuICAgICk7XHJcbiAgICBpZiAoIXNhck5hbWUpIHtcclxuICAgICAgc2V0U3RhdHVzKFxyXG4gICAgICAgICdcdTI2QTAgRWwgRXhjZWwgbm8gdGllbmUgaG9qYSBcIlNBUlwiLiBIb2phcyBlbmNvbnRyYWRhczogJyArIHdiLlNoZWV0TmFtZXMuam9pbignLCAnKSxcclxuICAgICAgICAnI2RjMjYyNidcclxuICAgICAgKTtcclxuICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG4gICAgY29uc3Qgc2hlZXQgPSB3Yi5TaGVldHNbc2FyTmFtZV07XHJcbiAgICBjb25zdCByb3dzID0gWExTWC51dGlscy5zaGVldF90b19qc29uKHNoZWV0LCB7IGhlYWRlcjogMSwgZGVmdmFsOiAnJywgcmF3OiB0cnVlIH0pO1xyXG4gICAgc2V0U3RhdHVzKCdQYXJzZWFuZG8gJyArIHJvd3MubGVuZ3RoICsgJyBmaWxhcyBkZSBob2phIFwiJyArIHNhck5hbWUgKyAnXCJcdTIwMjYnKTtcclxuICAgIGNvbnN0IHBhcnNlZCA9IHdpbmRvdy5TYWxlc1BsYW5QYXJzZXIucGFyc2VTYWxlc1BsYW5TaGVldChyb3dzKTtcclxuICAgIGlmICghcGFyc2VkLnJvd3MubGVuZ3RoKSB7XHJcbiAgICAgIHNldFN0YXR1cygnXHUyNkEwIEV4Y2VsIHBhcnNlYWRvIHBlcm8gc2luIFNLVXMgdlx1MDBFMWxpZG9zLicsICcjZGMyNjI2Jyk7XHJcbiAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIGNvbnN0IHllYXJNb250aCA9IF95ZWFyTW9udGhOb3coKTtcclxuICAgIGNvbnN0IHN0b3JhZ2VQYXRoID0gJ2ZvcmVjYXN0c19zbmFwc2hvdHMvJyArIHllYXJNb250aCArICcvJyArIGZhbWlsaWEgKyAnLnhsc3gnO1xyXG4gICAgc2V0U3RhdHVzKCdTdWJpZW5kbyBFeGNlbCBhIFN0b3JhZ2UgKCcgKyBfZm10U2l6ZShmaWxlLnNpemUpICsgJylcdTIwMjYnKTtcclxuICAgIGNvbnN0IHN0b3JhZ2VSZWYgPSB3aW5kb3cuZmlyZWJhc2Uuc3RvcmFnZSgpLnJlZihzdG9yYWdlUGF0aCk7XHJcbiAgICBhd2FpdCBzdG9yYWdlUmVmLnB1dChmaWxlLCB7XHJcbiAgICAgIGNvbnRlbnRUeXBlOiBmaWxlLnR5cGUgfHwgJ2FwcGxpY2F0aW9uL3ZuZC5vcGVueG1sZm9ybWF0cy1vZmZpY2Vkb2N1bWVudC5zcHJlYWRzaGVldG1sLnNoZWV0JyxcclxuICAgICAgY3VzdG9tTWV0YWRhdGE6IHtcclxuICAgICAgICBmYW1pbGlhLFxyXG4gICAgICAgIHVwbG9hZGVkQnk6ICh3aW5kb3cuY3VycmVudFVzZXIgJiYgd2luZG93LmN1cnJlbnRVc2VyLmVtYWlsKSB8fCAnJyxcclxuICAgICAgICBzb3VyY2VGaWxlbmFtZTogZmlsZS5uYW1lIHx8ICcnLFxyXG4gICAgICB9LFxyXG4gICAgfSk7XHJcbiAgICBzZXRTdGF0dXMoJ0d1YXJkYW5kbyBwYXJzZW8gZW4gRmlyZXN0b3JlICgnICsgcGFyc2VkLnJvd3MubGVuZ3RoICsgJyBTS1VzKVx1MjAyNicpO1xyXG4gICAgY29uc3QgdXBsb2FkZWRCeSA9ICh3aW5kb3cuY3VycmVudFVzZXIgJiYgd2luZG93LmN1cnJlbnRVc2VyLmVtYWlsKSB8fCAndW5rbm93bic7XHJcbiAgICBjb25zdCBwYXlsb2FkID0ge1xyXG4gICAgICBmYW1pbGlhLFxyXG4gICAgICBwYXJzZWRBdDpcclxuICAgICAgICB3aW5kb3cuZmlyZWJhc2UgJiYgd2luZG93LmZpcmViYXNlLmZpcmVzdG9yZSAmJiB3aW5kb3cuZmlyZWJhc2UuZmlyZXN0b3JlLkZpZWxkVmFsdWVcclxuICAgICAgICAgID8gd2luZG93LmZpcmViYXNlLmZpcmVzdG9yZS5GaWVsZFZhbHVlLnNlcnZlclRpbWVzdGFtcCgpXHJcbiAgICAgICAgICA6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcclxuICAgICAgdXBsb2FkZWRCeSxcclxuICAgICAgc291cmNlRmlsZW5hbWU6IGZpbGUubmFtZSB8fCAnJyxcclxuICAgICAgc291cmNlU2hlZXQ6IHNhck5hbWUsXHJcbiAgICAgIHllYXJNb250aCxcclxuICAgICAgc3RvcmFnZVBhdGgsXHJcbiAgICAgIHJvd3NDb3VudDogcGFyc2VkLnJvd3MubGVuZ3RoLFxyXG4gICAgICBoZWFkZXJSb3dJbmRleDogcGFyc2VkLmhlYWRlclJvd0luZGV4LFxyXG4gICAgICBkZXRlY3RlZE1vbnRoczogcGFyc2VkLmRldGVjdGVkTW9udGhzLFxyXG4gICAgICByb3dzOiBwYXJzZWQucm93cyxcclxuICAgIH07XHJcbiAgICBhd2FpdCB3aW5kb3cuZmJEYi5jb2xsZWN0aW9uKCdzYWxlc19wbGFuX2NhY2hlJykuZG9jKGZhbWlsaWEpLnNldChwYXlsb2FkKTtcclxuICAgIC8vIHYxMTA3IGZpeDogZ3VhcmRhciBjYWNoZSBsb2NhbCBjb24gRGF0ZSByZWFsIChubyBlbCBTZW50aW5lbFZhbHVlKSBwYXJhXHJcbiAgICAvLyBxdWUgX2ZtdERhdGVTaG9ydCBubyBtdWVzdHJlIFwiSW52YWxpZCBEYXRlXCIuIEVsIHNlcnZlciB0aWVuZSBlbCB0cyBleGFjdG8sXHJcbiAgICAvLyBlbCBsb2NhbCBtdWVzdHJhIGVsIG1vbWVudG8gZGVsIHVwbG9hZCAoYXByb3hpbWFkbyB+MXMgZGUgZGlmZXJlbmNpYSkuXHJcbiAgICBfc2FsZXNQbGFuQ2FjaGVzW2ZhbWlsaWFdID0gT2JqZWN0LmFzc2lnbih7fSwgcGF5bG9hZCwgeyBwYXJzZWRBdDogbmV3IERhdGUoKSB9KTtcclxuICAgIHNldFN0YXR1cyhcclxuICAgICAgJ1x1MjcxMyBPSy4gJyArIHBhcnNlZC5yb3dzLmxlbmd0aCArICcgU0tVcyBcdTAwRDcgJyArIHBhcnNlZC5kZXRlY3RlZE1vbnRocy5sZW5ndGggKyAnIG1lc2VzLicsXHJcbiAgICAgICcjMTZhMzRhJ1xyXG4gICAgKTtcclxuICAgIF9yZW5kZXJTYWxlc1BsYW5zVGFiKCk7XHJcbiAgfSBjYXRjaCAoZSkge1xyXG4gICAgY29uc29sZS5lcnJvcignW0ZPUkVDQVNUXSB1cGxvYWQgc2FsZXMgcGxhbiAnICsgZmFtaWxpYSArICcgZmFpbDonLCBlKTtcclxuICAgIHNldFN0YXR1cygnXHUyNzE3IEVycm9yOiAnICsgKChlICYmIGUubWVzc2FnZSkgfHwgZSksICcjZGMyNjI2Jyk7XHJcbiAgICBpZiAoZSAmJiBlLmNvZGUgPT09ICdNT05USFNfTk9UX0ZPVU5EJykge1xyXG4gICAgICBhbGVydChcclxuICAgICAgICAnRWwgRXhjZWwgbm8gdGllbmUgY29sdW1uYXMgZGUgbWVzZXMgcmVjb25vY2libGVzLlxcblxcbkhlYWRlcnMgZXNwZXJhZG9zOiBcIkphbiAyMDI3XCIsIFwiTWF5IDIwMjdcIiwgXCJFbmUgMjAyN1wiLCBcIjIwMjctMDFcIiwgZXRjLlxcblxcbkRldGFsbGU6ICcgK1xyXG4gICAgICAgICAgZS5tZXNzYWdlXHJcbiAgICAgICk7XHJcbiAgICB9XHJcbiAgfSBmaW5hbGx5IHtcclxuICAgIGlmIChldmVudCAmJiBldmVudC50YXJnZXQpIGV2ZW50LnRhcmdldC52YWx1ZSA9ICcnO1xyXG4gIH1cclxufTtcclxuXHJcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG4vLyBGMkIgXHUyMDE0IEZvcmVjYXN0IEVzdGFkXHUwMEVEc3RpY286IHRhYmxhICsgZGV0YWxsZVxyXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHJcbmFzeW5jIGZ1bmN0aW9uIF9sb2FkRm9yZWNhc3RPdXRwdXQoKSB7XHJcbiAgaWYgKCF3aW5kb3cuZmJEYikgdGhyb3cgbmV3IEVycm9yKCdGaXJlc3RvcmUgbm8gaW5pY2lhbGl6YWRvJyk7XHJcbiAgY29uc29sZS5sb2coJ1tGT1JFQ0FTVCBzdGF0XSBsb2FkaW5nIGZvcmVjYXN0X291dHB1dC4uLicpO1xyXG4gIGNvbnN0IFtzbmFwLCBtZXRhRG9jXSA9IGF3YWl0IFByb21pc2UuYWxsKFtcclxuICAgIHdpbmRvdy5mYkRiLmNvbGxlY3Rpb24oJ2ZvcmVjYXN0X291dHB1dCcpLmdldCgpLFxyXG4gICAgd2luZG93LmZiRGIuY29sbGVjdGlvbignZm9yZWNhc3Rfb3V0cHV0X21ldGEnKS5kb2MoJ2N1cnJlbnQnKS5nZXQoKSxcclxuICBdKTtcclxuICBjb25zdCBkb2NzID0gW107XHJcbiAgc25hcC5mb3JFYWNoKChkKSA9PiBkb2NzLnB1c2goT2JqZWN0LmFzc2lnbih7IGlkOiBkLmlkIH0sIGQuZGF0YSgpKSkpO1xyXG4gIGRvY3Muc29ydCgoYSwgYikgPT4ge1xyXG4gICAgY29uc3Qgd2EgPSAoYS5tZXRyaWNzICYmIGEubWV0cmljcy53YXBlKSB8fCA5OTk7XHJcbiAgICBjb25zdCB3YiA9IChiLm1ldHJpY3MgJiYgYi5tZXRyaWNzLndhcGUpIHx8IDk5OTtcclxuICAgIHJldHVybiB3YSAtIHdiO1xyXG4gIH0pO1xyXG4gIF9mb3JlY2FzdFN0YXREb2NzID0gZG9jcztcclxuICBfZm9yZWNhc3RTdGF0TWV0YSA9IG1ldGFEb2MuZXhpc3RzID8gbWV0YURvYy5kYXRhKCkgOiBudWxsO1xyXG4gIGNvbnNvbGUubG9nKCdbRk9SRUNBU1Qgc3RhdF0gbG9hZGVkJywgZG9jcy5sZW5ndGgsICdkb2NzIFx1MDBCNyBtZXRhOicsICEhX2ZvcmVjYXN0U3RhdE1ldGEpO1xyXG4gIHJldHVybiBkb2NzO1xyXG59XHJcblxyXG5mdW5jdGlvbiBfd2FwZUJhZGdlQ29sb3Iodykge1xyXG4gIGlmICh3ID09IG51bGwpIHJldHVybiAnIzY0NzQ4Yic7XHJcbiAgaWYgKHcgPCAwLjMpIHJldHVybiAnIzE2YTM0YSc7IC8vIHZlcmRlIC0gZXhjZWxlbnRlXHJcbiAgaWYgKHcgPCAwLjUpIHJldHVybiAnIzg0Y2MxNic7IC8vIGxpbWEgLSBidWVub1xyXG4gIGlmICh3IDwgMC43KSByZXR1cm4gJyNlYWIzMDgnOyAvLyBhbWFyaWxsbyAtIGFjZXB0YWJsZVxyXG4gIGlmICh3IDwgMS4wKSByZXR1cm4gJyNmOTczMTYnOyAvLyBuYXJhbmphIC0gcG9icmVcclxuICByZXR1cm4gJyNkYzI2MjYnOyAvLyByb2pvIC0gbXV5IHBvYnJlXHJcbn1cclxuXHJcbmZ1bmN0aW9uIF9mbXROdW0obikge1xyXG4gIGlmIChuID09IG51bGwgfHwgIU51bWJlci5pc0Zpbml0ZShOdW1iZXIobikpKSByZXR1cm4gJ1x1MjAxNCc7XHJcbiAgcmV0dXJuIE51bWJlcihuKS50b0xvY2FsZVN0cmluZygnZXMtQVInLCB7IG1heGltdW1GcmFjdGlvbkRpZ2l0czogMCB9KTtcclxufVxyXG5cclxuZnVuY3Rpb24gX2ZtdFdhcGUodykge1xyXG4gIGlmICh3ID09IG51bGwgfHwgIU51bWJlci5pc0Zpbml0ZShOdW1iZXIodykpKSByZXR1cm4gJ1x1MjAxNCc7XHJcbiAgcmV0dXJuIChOdW1iZXIodykgKiAxMDApLnRvRml4ZWQoMCkgKyAnJSc7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIF9mbXREc1Nob3J0KGlzbykge1xyXG4gIC8vICcyMDI2LTEwLTAxJyAtPiAnb2N0IDI2J1xyXG4gIHRyeSB7XHJcbiAgICBjb25zdCBbeSwgbV0gPSBpc28uc3BsaXQoJy0nKS5tYXAoTnVtYmVyKTtcclxuICAgIGNvbnN0IG5hbWVzID0gW1xyXG4gICAgICAnZW5lJyxcclxuICAgICAgJ2ZlYicsXHJcbiAgICAgICdtYXInLFxyXG4gICAgICAnYWJyJyxcclxuICAgICAgJ21heScsXHJcbiAgICAgICdqdW4nLFxyXG4gICAgICAnanVsJyxcclxuICAgICAgJ2FnbycsXHJcbiAgICAgICdzZXAnLFxyXG4gICAgICAnb2N0JyxcclxuICAgICAgJ25vdicsXHJcbiAgICAgICdkaWMnLFxyXG4gICAgXTtcclxuICAgIHJldHVybiBuYW1lc1ttIC0gMV0gKyAnICcgKyBTdHJpbmcoeSkuc2xpY2UoLTIpO1xyXG4gIH0gY2F0Y2gge1xyXG4gICAgcmV0dXJuIGlzbztcclxuICB9XHJcbn1cclxuXHJcbmZ1bmN0aW9uIF9yZW5kZXJGb3JlY2FzdFN0YXRUYWIoKSB7XHJcbiAgY29uc3QgY29udCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdmb3JlY2FzdC10YWItc3RhdCcpO1xyXG4gIGlmICghY29udCkgcmV0dXJuO1xyXG4gIHRyeSB7XHJcbiAgICBfcmVuZGVyRm9yZWNhc3RTdGF0VGFiSW1wbChjb250KTtcclxuICB9IGNhdGNoIChlKSB7XHJcbiAgICBjb25zb2xlLmVycm9yKCdbRk9SRUNBU1Qgc3RhdF0gcmVuZGVyIGZhaWwnLCBlKTtcclxuICAgIGNvbnQuaW5uZXJIVE1MID1cclxuICAgICAgJzxkaXYgc3R5bGU9XCJwYWRkaW5nOjQwcHggMjBweDtjb2xvcjojZGMyNjI2O2xpbmUtaGVpZ2h0OjEuNlwiPicgK1xyXG4gICAgICAnPGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxNnB4O2ZvbnQtd2VpZ2h0OjcwMDttYXJnaW4tYm90dG9tOjEwcHhcIj5FcnJvciByZW5kZXJpemFuZG8gdGFiIEZvcmVjYXN0IEVzdGFkXHUwMEVEc3RpY288L2Rpdj4nICtcclxuICAgICAgJzxwcmUgc3R5bGU9XCJmb250LXNpemU6MTFweDtiYWNrZ3JvdW5kOiNmZWYyZjI7cGFkZGluZzoxMnB4O2JvcmRlci1yYWRpdXM6NnB4O292ZXJmbG93OmF1dG87d2hpdGUtc3BhY2U6cHJlLXdyYXBcIj4nICtcclxuICAgICAgZXNjYXBlSHRtbFNhZmUoZS5zdGFjayB8fCBlLm1lc3NhZ2UgfHwgU3RyaW5nKGUpKSArXHJcbiAgICAgICc8L3ByZT48L2Rpdj4nO1xyXG4gIH1cclxufVxyXG5cclxuZnVuY3Rpb24gX3JlbmRlckZvcmVjYXN0U3RhdFRhYkltcGwoY29udCkge1xyXG4gIGNvbnN0IGRvY3MgPSBfZm9yZWNhc3RTdGF0RG9jcyB8fCBbXTtcclxuICBjb25zdCBtZXRhID0gX2ZvcmVjYXN0U3RhdE1ldGEgfHwge307XHJcbiAgY29uc3QgcmVzdW1lbiA9IG1ldGEucmVzdW1lbiB8fCB7fTtcclxuICBjb25zb2xlLmxvZygnW0ZPUkVDQVNUIHN0YXRdIHJlbmRlciBcdTIwMTQgZG9jczonLCBkb2NzLmxlbmd0aCwgJ21ldGE6JywgISFtZXRhLmdlbmVyYXRlZEF0KTtcclxuICBpZiAoIWRvY3MubGVuZ3RoKSB7XHJcbiAgICBjb250LmlubmVySFRNTCA9XHJcbiAgICAgICc8ZGl2IHN0eWxlPVwicGFkZGluZzo2MHB4IDIwcHg7dGV4dC1hbGlnbjpjZW50ZXI7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZClcIj4nICtcclxuICAgICAgJ05vIGhheSBmb3JlY2FzdF9vdXRwdXQgcHVibGljYWRvLjxicj48YnI+JyArXHJcbiAgICAgICdDb3JyZXIgPGNvZGU+cHl0aG9uIHNjcmlwdHMvZm9yZWNhc3QvdHJhaW5fcHJvZC5weSAmJiBweXRob24gc2NyaXB0cy9mb3JlY2FzdC9wdWJsaXNoX3RvX2ZpcmVzdG9yZS5weTwvY29kZT4uJyArXHJcbiAgICAgICc8L2Rpdj4nO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuICAvLyBNZXNlcyBkZWwgZm9yZWNhc3QgKGRzIGRlbCBwcmltZXIgZG9jLCBzZSBhc3VtZSBpZ3VhbCBlbiB0b2RvcykuXHJcbiAgY29uc3QgbW9udGhzSXNvID0gKGRvY3NbMF0uZm9yZWNhc3QgfHwgW10pLm1hcCgoZikgPT4gZi5kcyk7XHJcbiAgY29uc3QgbW9udGhIZWFkZXJzID0gbW9udGhzSXNvLm1hcChfZm10RHNTaG9ydCk7XHJcblxyXG4gIC8vIE1ldHJpY3MgY2hpcCBnbG9iYWxcclxuICBjb25zdCBnZW5lcmF0ZWQgPSBtZXRhLmdlbmVyYXRlZEF0XHJcbiAgICA/IG5ldyBEYXRlKG1ldGEuZ2VuZXJhdGVkQXQpLnRvTG9jYWxlU3RyaW5nKCdlcy1BUicsIHtcclxuICAgICAgICBkYXk6ICcyLWRpZ2l0JyxcclxuICAgICAgICBtb250aDogJ3Nob3J0JyxcclxuICAgICAgICB5ZWFyOiAnMi1kaWdpdCcsXHJcbiAgICAgICAgaG91cjogJzItZGlnaXQnLFxyXG4gICAgICAgIG1pbnV0ZTogJzItZGlnaXQnLFxyXG4gICAgICB9KVxyXG4gICAgOiAnXHUyMDE0JztcclxuICBjb25zdCB3YXBlTWVkID1cclxuICAgIHJlc3VtZW4ud2FwZV9tZWRpYW5vX2Jlc3RfcGVyX3NlcmllcyAhPSBudWxsXHJcbiAgICAgID8gX2ZtdFdhcGUocmVzdW1lbi53YXBlX21lZGlhbm9fYmVzdF9wZXJfc2VyaWVzKVxyXG4gICAgICA6ICdcdTIwMTQnO1xyXG4gIGNvbnN0IG5TdWJzID0gcmVzdW1lbi5uX3N1YmZhbWlsaWFzIHx8IGRvY3MubGVuZ3RoO1xyXG4gIGNvbnN0IG5MdDA1ID1cclxuICAgIHJlc3VtZW4ubl9zZXJpZXNfd2FwZV9sdF8wXzUgIT0gbnVsbCA/IHJlc3VtZW4ubl9zZXJpZXNfd2FwZV9sdF8wXzUgKyAnLycgKyBuU3VicyA6ICdcdTIwMTQnO1xyXG4gIGNvbnN0IG5MdDAzID1cclxuICAgIHJlc3VtZW4ubl9zZXJpZXNfd2FwZV9sdF8wXzMgIT0gbnVsbCA/IHJlc3VtZW4ubl9zZXJpZXNfd2FwZV9sdF8wXzMgKyAnLycgKyBuU3VicyA6ICdcdTIwMTQnO1xyXG5cclxuICBjb25zdCBiYW5uZXIgPVxyXG4gICAgJzxkaXYgc3R5bGU9XCJtYXJnaW4tYm90dG9tOjE0cHg7cGFkZGluZzoxMnB4IDE0cHg7YmFja2dyb3VuZDp2YXIoLS1iZy1zZWNvbmRhcnkpO2JvcmRlci1sZWZ0OjNweCBzb2xpZCAjMGQ5NDg4O2JvcmRlci1yYWRpdXM6NnB4O2ZvbnQtc2l6ZToxMnB4O2NvbG9yOnZhcigtLXRleHQtc2Vjb25kYXJ5KTtsaW5lLWhlaWdodDoxLjU7ZGlzcGxheTpncmlkO2dyaWQtdGVtcGxhdGUtY29sdW1uczpyZXBlYXQoYXV0by1maXQsbWlubWF4KDE2MHB4LDFmcikpO2dhcDoxMHB4XCI+JyArXHJcbiAgICAnPGRpdj48ZGl2IHN0eWxlPVwiZm9udC1zaXplOjEwcHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO2xldHRlci1zcGFjaW5nOi40cHhcIj5XQVBFIG1lZGlhbm88L2Rpdj48ZGl2IHN0eWxlPVwiZm9udC1zaXplOjIwcHg7Zm9udC13ZWlnaHQ6ODAwO2NvbG9yOnZhcigtLXRleHQtcHJpbWFyeSlcIj4nICtcclxuICAgIHdhcGVNZWQgK1xyXG4gICAgJzwvZGl2PjwvZGl2PicgK1xyXG4gICAgJzxkaXY+PGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMHB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtsZXR0ZXItc3BhY2luZzouNHB4XCI+U3ViZmFtaWxpYXM8L2Rpdj48ZGl2IHN0eWxlPVwiZm9udC1zaXplOjIwcHg7Zm9udC13ZWlnaHQ6ODAwO2NvbG9yOnZhcigtLXRleHQtcHJpbWFyeSlcIj4nICtcclxuICAgIG5TdWJzICtcclxuICAgICc8L2Rpdj48L2Rpdj4nICtcclxuICAgICc8ZGl2PjxkaXYgc3R5bGU9XCJmb250LXNpemU6MTBweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7bGV0dGVyLXNwYWNpbmc6LjRweFwiPldBUEUgJmx0OyAzMCUgKGV4Y2VsZW50ZSk8L2Rpdj48ZGl2IHN0eWxlPVwiZm9udC1zaXplOjIwcHg7Zm9udC13ZWlnaHQ6ODAwO2NvbG9yOiMxNmEzNGFcIj4nICtcclxuICAgIG5MdDAzICtcclxuICAgICc8L2Rpdj48L2Rpdj4nICtcclxuICAgICc8ZGl2PjxkaXYgc3R5bGU9XCJmb250LXNpemU6MTBweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7bGV0dGVyLXNwYWNpbmc6LjRweFwiPldBUEUgJmx0OyA1MCUgKGJ1ZW5vKTwvZGl2PjxkaXYgc3R5bGU9XCJmb250LXNpemU6MjBweDtmb250LXdlaWdodDo4MDA7Y29sb3I6Izg0Y2MxNlwiPicgK1xyXG4gICAgbkx0MDUgK1xyXG4gICAgJzwvZGl2PjwvZGl2PicgK1xyXG4gICAgJzxkaXY+PGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMHB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtsZXR0ZXItc3BhY2luZzouNHB4XCI+XHUwMERBbHRpbWEgY29ycmlkYTwvZGl2PjxkaXYgc3R5bGU9XCJmb250LXNpemU6MTNweDtmb250LXdlaWdodDo2MDA7Y29sb3I6dmFyKC0tdGV4dC1wcmltYXJ5KTttYXJnaW4tdG9wOjRweFwiPicgK1xyXG4gICAgZXNjYXBlSHRtbFNhZmUoZ2VuZXJhdGVkKSArXHJcbiAgICAnPC9kaXY+PC9kaXY+JyArXHJcbiAgICAnPC9kaXY+JztcclxuXHJcbiAgLy8gVGFibGEgcm93c1xyXG4gIGNvbnN0IHJvd3NIdG1sID0gZG9jc1xyXG4gICAgLm1hcCgoZCkgPT4ge1xyXG4gICAgICBjb25zdCB3YXBlID0gZC5tZXRyaWNzICYmIGQubWV0cmljcy53YXBlICE9IG51bGwgPyBkLm1ldHJpY3Mud2FwZSA6IG51bGw7XHJcbiAgICAgIGNvbnN0IGJlc3RNb2RlbCA9IGQuYmVzdE1vZGVsIHx8ICdcdTIwMTQnO1xyXG4gICAgICBjb25zdCBmb3JlY2FzdE1hcCA9IHt9O1xyXG4gICAgICAoZC5mb3JlY2FzdCB8fCBbXSkuZm9yRWFjaCgoZikgPT4ge1xyXG4gICAgICAgIGZvcmVjYXN0TWFwW2YuZHNdID0gZi55X2hhdDtcclxuICAgICAgfSk7XHJcbiAgICAgIGNvbnN0IG1vbnRoQ2VsbHMgPSBtb250aHNJc29cclxuICAgICAgICAubWFwKFxyXG4gICAgICAgICAgKGRzKSA9PlxyXG4gICAgICAgICAgICAnPHRkIHN0eWxlPVwicGFkZGluZzo4cHggMTBweDt0ZXh0LWFsaWduOnJpZ2h0O2ZvbnQtdmFyaWFudC1udW1lcmljOnRhYnVsYXItbnVtcztmb250LXdlaWdodDo2MDA7Y29sb3I6dmFyKC0tdGV4dC1wcmltYXJ5KVwiPicgK1xyXG4gICAgICAgICAgICBfZm10TnVtKGZvcmVjYXN0TWFwW2RzXSkgK1xyXG4gICAgICAgICAgICAnPC90ZD4nXHJcbiAgICAgICAgKVxyXG4gICAgICAgIC5qb2luKCcnKTtcclxuICAgICAgY29uc3QgdG90YWw3ID0gKGQuZm9yZWNhc3QgfHwgW10pLnJlZHVjZSgocywgZikgPT4gcyArIChOdW1iZXIoZi55X2hhdCkgfHwgMCksIDApO1xyXG4gICAgICByZXR1cm4gKFxyXG4gICAgICAgICc8dHIgb25jbGljaz1cIm9wZW5Gb3JlY2FzdFN0YXREZXRhaWwoXFwnJyArXHJcbiAgICAgICAgZXNjYXBlSHRtbFNhZmUoZC5pZCkgK1xyXG4gICAgICAgICdcXCcpXCIgc3R5bGU9XCJjdXJzb3I6cG9pbnRlcjtib3JkZXItYm90dG9tOjFweCBzb2xpZCB2YXIoLS1ib3JkZXItc3VidGxlKVwiIG9ubW91c2VvdmVyPVwidGhpcy5zdHlsZS5iYWNrZ3JvdW5kPVxcJ3ZhcigtLWJnLXNlY29uZGFyeSlcXCdcIiBvbm1vdXNlb3V0PVwidGhpcy5zdHlsZS5iYWNrZ3JvdW5kPVxcJ3RyYW5zcGFyZW50XFwnXCI+JyArXHJcbiAgICAgICAgJzx0ZCBzdHlsZT1cInBhZGRpbmc6OHB4IDEwcHg7Zm9udC13ZWlnaHQ6NzAwO2NvbG9yOnZhcigtLXRleHQtcHJpbWFyeSlcIj4nICtcclxuICAgICAgICBlc2NhcGVIdG1sU2FmZShkLnN1YmZhbWlsaWEgfHwgZC5pZCkgK1xyXG4gICAgICAgICc8L3RkPicgK1xyXG4gICAgICAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjhweCAxMHB4O2ZvbnQtc2l6ZToxMXB4O2NvbG9yOnZhcigtLXRleHQtc2Vjb25kYXJ5KVwiPicgK1xyXG4gICAgICAgIGVzY2FwZUh0bWxTYWZlKGJlc3RNb2RlbCkgK1xyXG4gICAgICAgICc8L3RkPicgK1xyXG4gICAgICAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjhweCAxMHB4O3RleHQtYWxpZ246Y2VudGVyXCI+PHNwYW4gc3R5bGU9XCJkaXNwbGF5OmlubGluZS1ibG9jaztwYWRkaW5nOjNweCA4cHg7Ym9yZGVyLXJhZGl1czoxMnB4O2JhY2tncm91bmQ6JyArXHJcbiAgICAgICAgX3dhcGVCYWRnZUNvbG9yKHdhcGUpICtcclxuICAgICAgICAnO2NvbG9yOiNmZmY7Zm9udC1zaXplOjExcHg7Zm9udC13ZWlnaHQ6NzAwXCI+JyArXHJcbiAgICAgICAgX2ZtdFdhcGUod2FwZSkgK1xyXG4gICAgICAgICc8L3NwYW4+PC90ZD4nICtcclxuICAgICAgICBtb250aENlbGxzICtcclxuICAgICAgICAnPHRkIHN0eWxlPVwicGFkZGluZzo4cHggMTBweDt0ZXh0LWFsaWduOnJpZ2h0O2ZvbnQtdmFyaWFudC1udW1lcmljOnRhYnVsYXItbnVtcztmb250LXdlaWdodDo3MDA7Y29sb3I6IzBkOTQ4ODtiYWNrZ3JvdW5kOnZhcigtLWJnLXNlY29uZGFyeSlcIj4nICtcclxuICAgICAgICBfZm10TnVtKHRvdGFsNykgK1xyXG4gICAgICAgICc8L3RkPicgK1xyXG4gICAgICAgICc8L3RyPidcclxuICAgICAgKTtcclxuICAgIH0pXHJcbiAgICAuam9pbignJyk7XHJcblxyXG4gIGNvbnN0IG1vbnRoSGVhZGVyc0h0bWwgPSBtb250aEhlYWRlcnNcclxuICAgIC5tYXAoXHJcbiAgICAgIChtKSA9PlxyXG4gICAgICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjhweCAxMHB4O3RleHQtYWxpZ246cmlnaHQ7Zm9udC1zaXplOjEwcHg7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO2xldHRlci1zcGFjaW5nOi40cHg7Y29sb3I6Izk0YTNiOFwiPicgK1xyXG4gICAgICAgIGVzY2FwZUh0bWxTYWZlKG0pICtcclxuICAgICAgICAnPC90aD4nXHJcbiAgICApXHJcbiAgICAuam9pbignJyk7XHJcblxyXG4gIGNvbnN0IHRhYmxlID1cclxuICAgICc8ZGl2IHN0eWxlPVwib3ZlcmZsb3c6YXV0bztib3JkZXI6MXB4IHNvbGlkIHZhcigtLWJvcmRlci1zdWJ0bGUpO2JvcmRlci1yYWRpdXM6OHB4XCI+JyArXHJcbiAgICAnPHRhYmxlIHN0eWxlPVwid2lkdGg6MTAwJTtib3JkZXItY29sbGFwc2U6Y29sbGFwc2U7Zm9udC1zaXplOjEycHhcIj4nICtcclxuICAgICc8dGhlYWQgc3R5bGU9XCJiYWNrZ3JvdW5kOiMwZjE3MmE7Y29sb3I6I2ZmZlwiPjx0cj4nICtcclxuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjhweCAxMHB4O3RleHQtYWxpZ246bGVmdDtmb250LXNpemU6MTBweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7bGV0dGVyLXNwYWNpbmc6LjRweFwiPlN1YmZhbWlsaWE8L3RoPicgK1xyXG4gICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6OHB4IDEwcHg7dGV4dC1hbGlnbjpsZWZ0O2ZvbnQtc2l6ZToxMHB4O3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtsZXR0ZXItc3BhY2luZzouNHB4XCI+TW9kZWxvPC90aD4nICtcclxuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjhweCAxMHB4O3RleHQtYWxpZ246Y2VudGVyO2ZvbnQtc2l6ZToxMHB4O3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtsZXR0ZXItc3BhY2luZzouNHB4XCI+V0FQRTwvdGg+JyArXHJcbiAgICBtb250aEhlYWRlcnNIdG1sICtcclxuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjhweCAxMHB4O3RleHQtYWxpZ246cmlnaHQ7Zm9udC1zaXplOjEwcHg7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO2xldHRlci1zcGFjaW5nOi40cHg7YmFja2dyb3VuZDojMTM0ZTRhXCI+VG90YWwgN208L3RoPicgK1xyXG4gICAgJzwvdHI+PC90aGVhZD4nICtcclxuICAgICc8dGJvZHk+JyArXHJcbiAgICByb3dzSHRtbCArXHJcbiAgICAnPC90Ym9keT48L3RhYmxlPjwvZGl2Pic7XHJcblxyXG4gIGNvbnN0IGZvb3RlciA9XHJcbiAgICAnPGRpdiBzdHlsZT1cIm1hcmdpbi10b3A6MTJweDtmb250LXNpemU6MTFweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTtsaW5lLWhlaWdodDoxLjVcIj4nICtcclxuICAgICc8Yj5DXHUwMEYzbW8gbGVlcjwvYj46IFdBUEUgKFdlaWdodGVkIEFic29sdXRlIFBlcmNlbnRhZ2UgRXJyb3IpIG1pZGUgZWwgZXJyb3IgZGVsIG1vZGVsbyByZWxhdGl2byBhbCB0b3RhbCByZWFsOiAmbHQ7MzAlIGV4Y2VsZW50ZSwgMzAtNTAlIGJ1ZW5vLCA1MC03MCUgYWNlcHRhYmxlLCAmZ3Q7NzAlIHBvYnJlLiBDbGljayBlbiBmaWxhIHBhcmEgZGV0YWxsZSArIGdyXHUwMEUxZmljby4gJyArXHJcbiAgICAnU2UgZWxpZ2UgZWwgbW9kZWxvIGNvbiBtZW5vciBXQVBFIHBvciBzZXJpZSB0cmFzIGJhY2t0ZXN0IHJvbGxpbmctb3JpZ2luIChoPTIsIHZlbnRhbmFzPTMpLicgK1xyXG4gICAgJzwvZGl2Pic7XHJcblxyXG4gIGNvbnQuaW5uZXJIVE1MID0gJzxkaXYgc3R5bGU9XCJwYWRkaW5nOjE4cHhcIj4nICsgYmFubmVyICsgdGFibGUgKyBmb290ZXIgKyAnPC9kaXY+JztcclxufVxyXG5cclxuLy8gQ2FjaGUgaGlzdG9yaWEgYWdyZWdhZGEgcG9yIHN1YmZhbWlsaWEgKHBhcmEgZ3JcdTAwRTFmaWNvIGRldGFsbGUpLlxyXG5hc3luYyBmdW5jdGlvbiBfbG9hZEZvcmVjYXN0U3RhdEhpc3RvcnkoKSB7XHJcbiAgaWYgKF9mb3JlY2FzdFN0YXRIaXN0b3J5Q2FjaGUpIHJldHVybiBfZm9yZWNhc3RTdGF0SGlzdG9yeUNhY2hlO1xyXG4gIC8vIExhIGhpc3RvcmlhIHNvbG8gZXN0XHUwMEUxIGVuIEJRICh+MTAgYVx1MDBGMW9zIEJhcmFsZG8gKyAxMiBtZXNlcyBTaGltYW5vKS4gQ29tb1xyXG4gIC8vIGVsIHBpcGVsaW5lIGxhIGVzY3JpYmUgYSBDU1YgbG9jYWwsIGFjXHUwMEUxIG5vIGxhIHBvZGVtb3MgbGVlci4gQWx0ZXJuYXRpdmE6XHJcbiAgLy8gdXNhciBza3VfdmVudGFzX3NuYXBzaG90IHF1ZSB0aWVuZSB2ZW50YXMgbWVuc3VhbGVzIHBlcm8gc29sbyBncnVwbyBQRVNDQS5cclxuICAvLyBFbiBGMkIuMiBzb2xvIG1vc3RyYW1vcyBmb3JlY2FzdCtJQyAoc2luIG92ZXJsYXkgaGlzdG9yaWEgcG9yIGFob3JhKS5cclxuICBfZm9yZWNhc3RTdGF0SGlzdG9yeUNhY2hlID0ge307XHJcbiAgcmV0dXJuIF9mb3JlY2FzdFN0YXRIaXN0b3J5Q2FjaGU7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIF9idWlsZEZvcmVjYXN0Q2hhcnRTdmcoZG9jKSB7XHJcbiAgY29uc3QgZmMgPSBkb2MuZm9yZWNhc3QgfHwgW107XHJcbiAgaWYgKCFmYy5sZW5ndGgpXHJcbiAgICByZXR1cm4gJzxkaXYgc3R5bGU9XCJwYWRkaW5nOjMwcHg7dGV4dC1hbGlnbjpjZW50ZXI7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZClcIj5TaW4gZGF0b3MgZGUgZm9yZWNhc3Q8L2Rpdj4nO1xyXG4gIC8vIERpbWVuc2lvbmVzXHJcbiAgY29uc3QgVyA9IDY0MCxcclxuICAgIEggPSAyNjA7XHJcbiAgY29uc3QgcGFkTCA9IDUwLFxyXG4gICAgcGFkUiA9IDIwLFxyXG4gICAgcGFkVCA9IDIwLFxyXG4gICAgcGFkQiA9IDQwO1xyXG4gIGNvbnN0IGlubmVyVyA9IFcgLSBwYWRMIC0gcGFkUjtcclxuICBjb25zdCBpbm5lckggPSBIIC0gcGFkVCAtIHBhZEI7XHJcblxyXG4gIC8vIFkgcmFuZ2U6IG1heChoaTgwKSAqIDEuMVxyXG4gIGNvbnN0IG1heFkgPSBNYXRoLm1heCgxLCAuLi5mYy5tYXAoKGYpID0+IE51bWJlcihmLmhpODApIHx8IE51bWJlcihmLnlfaGF0KSB8fCAwKSk7XHJcbiAgY29uc3QgbWluWSA9IDA7XHJcbiAgY29uc3Qgc2NhbGVYID0gKGkpID0+IHBhZEwgKyAoaW5uZXJXICogaSkgLyBNYXRoLm1heCgxLCBmYy5sZW5ndGggLSAxKTtcclxuICBjb25zdCBzY2FsZVkgPSAodikgPT4gcGFkVCArIGlubmVySCAtIChpbm5lckggKiAodiAtIG1pblkpKSAvIChtYXhZIC0gbWluWSk7XHJcblxyXG4gIC8vIEdyaWQgKyBlamUgWVxyXG4gIGNvbnN0IHlUaWNrcyA9IFswLCAwLjI1LCAwLjUsIDAuNzUsIDFdXHJcbiAgICAubWFwKChyKSA9PiB7XHJcbiAgICAgIGNvbnN0IHZhbCA9IG1pblkgKyByICogKG1heFkgLSBtaW5ZKTtcclxuICAgICAgY29uc3QgeXkgPSBzY2FsZVkodmFsKTtcclxuICAgICAgcmV0dXJuIChcclxuICAgICAgICAnPGxpbmUgeDE9XCInICtcclxuICAgICAgICBwYWRMICtcclxuICAgICAgICAnXCIgeTE9XCInICtcclxuICAgICAgICB5eSArXHJcbiAgICAgICAgJ1wiIHgyPVwiJyArXHJcbiAgICAgICAgKFcgLSBwYWRSKSArXHJcbiAgICAgICAgJ1wiIHkyPVwiJyArXHJcbiAgICAgICAgeXkgK1xyXG4gICAgICAgICdcIiBzdHJva2U9XCIjZTJlOGYwXCIgc3Ryb2tlLXdpZHRoPVwiMVwiLz4nICtcclxuICAgICAgICAnPHRleHQgeD1cIicgK1xyXG4gICAgICAgIChwYWRMIC0gNikgK1xyXG4gICAgICAgICdcIiB5PVwiJyArXHJcbiAgICAgICAgKHl5ICsgNCkgK1xyXG4gICAgICAgICdcIiB0ZXh0LWFuY2hvcj1cImVuZFwiIGZvbnQtc2l6ZT1cIjEwXCIgZmlsbD1cIiM2NDc0OGJcIj4nICtcclxuICAgICAgICBfZm10TnVtKHZhbCkgK1xyXG4gICAgICAgICc8L3RleHQ+J1xyXG4gICAgICApO1xyXG4gICAgfSlcclxuICAgIC5qb2luKCcnKTtcclxuXHJcbiAgLy8gRWplIFggKG1lc2VzKVxyXG4gIGNvbnN0IHhMYWJlbHMgPSBmY1xyXG4gICAgLm1hcCgoZiwgaSkgPT4ge1xyXG4gICAgICBjb25zdCB4eCA9IHNjYWxlWChpKTtcclxuICAgICAgcmV0dXJuIChcclxuICAgICAgICAnPHRleHQgeD1cIicgK1xyXG4gICAgICAgIHh4ICtcclxuICAgICAgICAnXCIgeT1cIicgK1xyXG4gICAgICAgIChIIC0gcGFkQiArIDE1KSArXHJcbiAgICAgICAgJ1wiIHRleHQtYW5jaG9yPVwibWlkZGxlXCIgZm9udC1zaXplPVwiMTBcIiBmaWxsPVwiIzY0NzQ4YlwiPicgK1xyXG4gICAgICAgIF9mbXREc1Nob3J0KGYuZHMpICtcclxuICAgICAgICAnPC90ZXh0PidcclxuICAgICAgKTtcclxuICAgIH0pXHJcbiAgICAuam9pbignJyk7XHJcblxyXG4gIC8vIEludGVydmFsbyBjb25maWFuemEgKGJhbmQpXHJcbiAgY29uc3QgYmFuZFBvaW50cyA9XHJcbiAgICBmYy5tYXAoKGYsIGkpID0+IHNjYWxlWChpKSArICcsJyArIHNjYWxlWShOdW1iZXIoZi5oaTgwKSB8fCAwKSkuam9pbignICcpICtcclxuICAgICcgJyArXHJcbiAgICBmY1xyXG4gICAgICAuc2xpY2UoKVxyXG4gICAgICAucmV2ZXJzZSgpXHJcbiAgICAgIC5tYXAoKGYsIGkpID0+IHNjYWxlWChmYy5sZW5ndGggLSAxIC0gaSkgKyAnLCcgKyBzY2FsZVkoTnVtYmVyKGYubG84MCkgfHwgMCkpXHJcbiAgICAgIC5qb2luKCcgJyk7XHJcbiAgY29uc3QgYmFuZCA9ICc8cG9seWdvbiBwb2ludHM9XCInICsgYmFuZFBvaW50cyArICdcIiBmaWxsPVwiIzBkOTQ4ODMzXCIgc3Ryb2tlPVwibm9uZVwiLz4nO1xyXG5cclxuICAvLyBMaW5lIGZvcmVjYXN0ICsgcHVudG9zXHJcbiAgY29uc3QgbGluZVBvaW50cyA9IGZjLm1hcCgoZiwgaSkgPT4gc2NhbGVYKGkpICsgJywnICsgc2NhbGVZKE51bWJlcihmLnlfaGF0KSB8fCAwKSkuam9pbignICcpO1xyXG4gIGNvbnN0IGxpbmUgPVxyXG4gICAgJzxwb2x5bGluZSBwb2ludHM9XCInICtcclxuICAgIGxpbmVQb2ludHMgK1xyXG4gICAgJ1wiIGZpbGw9XCJub25lXCIgc3Ryb2tlPVwiIzBkOTQ4OFwiIHN0cm9rZS13aWR0aD1cIjIuNVwiIHN0cm9rZS1saW5lam9pbj1cInJvdW5kXCIvPic7XHJcbiAgY29uc3QgcG9pbnRzID0gZmNcclxuICAgIC5tYXAoXHJcbiAgICAgIChmLCBpKSA9PlxyXG4gICAgICAgICc8Y2lyY2xlIGN4PVwiJyArXHJcbiAgICAgICAgc2NhbGVYKGkpICtcclxuICAgICAgICAnXCIgY3k9XCInICtcclxuICAgICAgICBzY2FsZVkoTnVtYmVyKGYueV9oYXQpIHx8IDApICtcclxuICAgICAgICAnXCIgcj1cIjRcIiBmaWxsPVwiIzBkOTQ4OFwiIHN0cm9rZT1cIiNmZmZcIiBzdHJva2Utd2lkdGg9XCIyXCIvPidcclxuICAgIClcclxuICAgIC5qb2luKCcnKTtcclxuICAvLyBMYWJlbHMgZGUgdmFsb3JcclxuICBjb25zdCB2YWx1ZUxhYmVscyA9IGZjXHJcbiAgICAubWFwKChmLCBpKSA9PiB7XHJcbiAgICAgIGNvbnN0IHh4ID0gc2NhbGVYKGkpO1xyXG4gICAgICBjb25zdCB5eSA9IHNjYWxlWShOdW1iZXIoZi55X2hhdCkgfHwgMCk7XHJcbiAgICAgIHJldHVybiAoXHJcbiAgICAgICAgJzx0ZXh0IHg9XCInICtcclxuICAgICAgICB4eCArXHJcbiAgICAgICAgJ1wiIHk9XCInICtcclxuICAgICAgICAoeXkgLSA4KSArXHJcbiAgICAgICAgJ1wiIHRleHQtYW5jaG9yPVwibWlkZGxlXCIgZm9udC1zaXplPVwiMTBcIiBmb250LXdlaWdodD1cIjcwMFwiIGZpbGw9XCIjMGY3NjZlXCI+JyArXHJcbiAgICAgICAgX2ZtdE51bShmLnlfaGF0KSArXHJcbiAgICAgICAgJzwvdGV4dD4nXHJcbiAgICAgICk7XHJcbiAgICB9KVxyXG4gICAgLmpvaW4oJycpO1xyXG5cclxuICBjb25zdCBzdmcgPVxyXG4gICAgJzxzdmcgdmlld0JveD1cIjAgMCAnICtcclxuICAgIFcgK1xyXG4gICAgJyAnICtcclxuICAgIEggK1xyXG4gICAgJ1wiIHN0eWxlPVwid2lkdGg6MTAwJTttYXgtd2lkdGg6ODAwcHg7aGVpZ2h0OmF1dG9cIj4nICtcclxuICAgICc8cmVjdCB4PVwiMFwiIHk9XCIwXCIgd2lkdGg9XCInICtcclxuICAgIFcgK1xyXG4gICAgJ1wiIGhlaWdodD1cIicgK1xyXG4gICAgSCArXHJcbiAgICAnXCIgZmlsbD1cIiNmZmZcIi8+JyArXHJcbiAgICB5VGlja3MgK1xyXG4gICAgeExhYmVscyArXHJcbiAgICBiYW5kICtcclxuICAgIGxpbmUgK1xyXG4gICAgcG9pbnRzICtcclxuICAgIHZhbHVlTGFiZWxzICtcclxuICAgICc8L3N2Zz4nO1xyXG4gIHJldHVybiBzdmc7XHJcbn1cclxuXHJcbndpbmRvdy5vcGVuRm9yZWNhc3RTdGF0RGV0YWlsID0gZnVuY3Rpb24gKHN1YklkKSB7XHJcbiAgaWYgKCFfZm9yZWNhc3RTdGF0RG9jcykgcmV0dXJuO1xyXG4gIGNvbnN0IGRvYyA9IF9mb3JlY2FzdFN0YXREb2NzLmZpbmQoKGQpID0+IGQuaWQgPT09IHN1YklkKTtcclxuICBpZiAoIWRvYykge1xyXG4gICAgYWxlcnQoJ05vIHNlIGVuY29udHJcdTAwRjMgZGV0YWxsZSBkZSAnICsgc3ViSWQpO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuICBjb25zdCBleGlzdGluZyA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdmb3JlY2FzdC1zdGF0LWRldGFpbCcpO1xyXG4gIGlmIChleGlzdGluZykgZXhpc3RpbmcucmVtb3ZlKCk7XHJcblxyXG4gIGNvbnN0IGVsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2Jyk7XHJcbiAgZWwuaWQgPSAnZm9yZWNhc3Qtc3RhdC1kZXRhaWwnO1xyXG4gIGVsLnN0eWxlLmNzc1RleHQgPVxyXG4gICAgJ3Bvc2l0aW9uOmZpeGVkO2luc2V0OjA7YmFja2dyb3VuZDpyZ2JhKDE1LDIzLDQyLC42NSk7ei1pbmRleDoyMTAwO2Rpc3BsYXk6ZmxleDthbGlnbi1pdGVtczpjZW50ZXI7anVzdGlmeS1jb250ZW50OmNlbnRlcjtwYWRkaW5nOjJ2aCc7XHJcbiAgZWwub25jbGljayA9IChldikgPT4ge1xyXG4gICAgaWYgKGV2LnRhcmdldCA9PT0gZWwpIGVsLnJlbW92ZSgpO1xyXG4gIH07XHJcblxyXG4gIGNvbnN0IHdhcGUgPSBkb2MubWV0cmljcyAmJiBkb2MubWV0cmljcy53YXBlO1xyXG4gIGNvbnN0IGJpYXMgPSBkb2MubWV0cmljcyAmJiBkb2MubWV0cmljcy5iaWFzO1xyXG4gIGNvbnN0IG1hZSA9IGRvYy5tZXRyaWNzICYmIGRvYy5tZXRyaWNzLm1hZTtcclxuICBjb25zdCBybXNlID0gZG9jLm1ldHJpY3MgJiYgZG9jLm1ldHJpY3Mucm1zZTtcclxuICBjb25zdCBiZXN0TW9kZWwgPSBkb2MuYmVzdE1vZGVsIHx8ICdcdTIwMTQnO1xyXG4gIGNvbnN0IHZlcnNpb25JZCA9IGRvYy52ZXJzaW9uSWQgfHwgJ1x1MjAxNCc7XHJcbiAgY29uc3Qgc3ZnSHRtbCA9IF9idWlsZEZvcmVjYXN0Q2hhcnRTdmcoZG9jKTtcclxuXHJcbiAgY29uc3QgbWV0cmljc0h0bWwgPVxyXG4gICAgJzxkaXYgc3R5bGU9XCJkaXNwbGF5OmdyaWQ7Z3JpZC10ZW1wbGF0ZS1jb2x1bW5zOnJlcGVhdChhdXRvLWZpdCxtaW5tYXgoMTIwcHgsMWZyKSk7Z2FwOjEwcHg7bWFyZ2luOjE0cHggMFwiPicgK1xyXG4gICAgJzxkaXYgc3R5bGU9XCJwYWRkaW5nOjEwcHg7YmFja2dyb3VuZDp2YXIoLS1iZy1zZWNvbmRhcnkpO2JvcmRlci1yYWRpdXM6NnB4XCI+PGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMHB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZVwiPk1vZGVsbzwvZGl2PjxkaXYgc3R5bGU9XCJmb250LXdlaWdodDo3MDBcIj4nICtcclxuICAgIGVzY2FwZUh0bWxTYWZlKGJlc3RNb2RlbCkgK1xyXG4gICAgJzwvZGl2PjwvZGl2PicgK1xyXG4gICAgJzxkaXYgc3R5bGU9XCJwYWRkaW5nOjEwcHg7YmFja2dyb3VuZDp2YXIoLS1iZy1zZWNvbmRhcnkpO2JvcmRlci1yYWRpdXM6NnB4XCI+PGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMHB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZVwiPldBUEU8L2Rpdj48ZGl2IHN0eWxlPVwiZm9udC13ZWlnaHQ6NzAwO2NvbG9yOicgK1xyXG4gICAgX3dhcGVCYWRnZUNvbG9yKHdhcGUpICtcclxuICAgICdcIj4nICtcclxuICAgIF9mbXRXYXBlKHdhcGUpICtcclxuICAgICc8L2Rpdj48L2Rpdj4nICtcclxuICAgICc8ZGl2IHN0eWxlPVwicGFkZGluZzoxMHB4O2JhY2tncm91bmQ6dmFyKC0tYmctc2Vjb25kYXJ5KTtib3JkZXItcmFkaXVzOjZweFwiPjxkaXYgc3R5bGU9XCJmb250LXNpemU6MTBweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2VcIj5CaWFzPC9kaXY+PGRpdiBzdHlsZT1cImZvbnQtd2VpZ2h0OjcwMFwiPicgK1xyXG4gICAgKGJpYXMgIT0gbnVsbCA/IChiaWFzICogMTAwKS50b0ZpeGVkKDApICsgJyUnIDogJ1x1MjAxNCcpICtcclxuICAgICc8L2Rpdj48L2Rpdj4nICtcclxuICAgICc8ZGl2IHN0eWxlPVwicGFkZGluZzoxMHB4O2JhY2tncm91bmQ6dmFyKC0tYmctc2Vjb25kYXJ5KTtib3JkZXItcmFkaXVzOjZweFwiPjxkaXYgc3R5bGU9XCJmb250LXNpemU6MTBweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2VcIj5NQUU8L2Rpdj48ZGl2IHN0eWxlPVwiZm9udC13ZWlnaHQ6NzAwXCI+JyArXHJcbiAgICBfZm10TnVtKG1hZSkgK1xyXG4gICAgJzwvZGl2PjwvZGl2PicgK1xyXG4gICAgJzxkaXYgc3R5bGU9XCJwYWRkaW5nOjEwcHg7YmFja2dyb3VuZDp2YXIoLS1iZy1zZWNvbmRhcnkpO2JvcmRlci1yYWRpdXM6NnB4XCI+PGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMHB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZVwiPlJNU0U8L2Rpdj48ZGl2IHN0eWxlPVwiZm9udC13ZWlnaHQ6NzAwXCI+JyArXHJcbiAgICBfZm10TnVtKHJtc2UpICtcclxuICAgICc8L2Rpdj48L2Rpdj4nICtcclxuICAgICc8L2Rpdj4nO1xyXG5cclxuICBjb25zdCB0YWJsZUh0bWwgPVxyXG4gICAgJzx0YWJsZSBzdHlsZT1cIndpZHRoOjEwMCU7Zm9udC1zaXplOjEycHg7Ym9yZGVyLWNvbGxhcHNlOmNvbGxhcHNlO21hcmdpbi10b3A6MTBweFwiPicgK1xyXG4gICAgJzx0aGVhZCBzdHlsZT1cImJhY2tncm91bmQ6IzBmMTcyYTtjb2xvcjojZmZmXCI+PHRyPicgK1xyXG4gICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6NnB4IDEwcHg7dGV4dC1hbGlnbjpsZWZ0XCI+TWVzPC90aD4nICtcclxuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjZweCAxMHB4O3RleHQtYWxpZ246cmlnaHRcIj5Gb3JlY2FzdDwvdGg+JyArXHJcbiAgICAnPHRoIHN0eWxlPVwicGFkZGluZzo2cHggMTBweDt0ZXh0LWFsaWduOnJpZ2h0XCI+SUMgODAlIGJham88L3RoPicgK1xyXG4gICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6NnB4IDEwcHg7dGV4dC1hbGlnbjpyaWdodFwiPklDIDgwJSBhbHRvPC90aD4nICtcclxuICAgICc8L3RyPjwvdGhlYWQ+PHRib2R5PicgK1xyXG4gICAgKGRvYy5mb3JlY2FzdCB8fCBbXSlcclxuICAgICAgLm1hcChcclxuICAgICAgICAoZikgPT5cclxuICAgICAgICAgICc8dHIgc3R5bGU9XCJib3JkZXItYm90dG9tOjFweCBzb2xpZCB2YXIoLS1ib3JkZXItc3VidGxlKVwiPjx0ZCBzdHlsZT1cInBhZGRpbmc6NnB4IDEwcHhcIj4nICtcclxuICAgICAgICAgIGVzY2FwZUh0bWxTYWZlKF9mbXREc1Nob3J0KGYuZHMpKSArXHJcbiAgICAgICAgICAnPC90ZD4nICtcclxuICAgICAgICAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjZweCAxMHB4O3RleHQtYWxpZ246cmlnaHQ7Zm9udC13ZWlnaHQ6NzAwXCI+JyArXHJcbiAgICAgICAgICBfZm10TnVtKGYueV9oYXQpICtcclxuICAgICAgICAgICc8L3RkPicgK1xyXG4gICAgICAgICAgJzx0ZCBzdHlsZT1cInBhZGRpbmc6NnB4IDEwcHg7dGV4dC1hbGlnbjpyaWdodDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKVwiPicgK1xyXG4gICAgICAgICAgX2ZtdE51bShmLmxvODApICtcclxuICAgICAgICAgICc8L3RkPicgK1xyXG4gICAgICAgICAgJzx0ZCBzdHlsZT1cInBhZGRpbmc6NnB4IDEwcHg7dGV4dC1hbGlnbjpyaWdodDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKVwiPicgK1xyXG4gICAgICAgICAgX2ZtdE51bShmLmhpODApICtcclxuICAgICAgICAgICc8L3RkPjwvdHI+J1xyXG4gICAgICApXHJcbiAgICAgIC5qb2luKCcnKSArXHJcbiAgICAnPC90Ym9keT48L3RhYmxlPic7XHJcblxyXG4gIGNvbnN0IGNvbnRlbnQgPVxyXG4gICAgJzxkaXYgc3R5bGU9XCJiYWNrZ3JvdW5kOnZhcigtLWJnLWVsZXZhdGVkKTtib3JkZXItcmFkaXVzOjEycHg7cGFkZGluZzoyNHB4O21heC13aWR0aDo4MjBweDt3aWR0aDoxMDAlO21heC1oZWlnaHQ6OTZ2aDtvdmVyZmxvdzphdXRvO2JveC1zaGFkb3c6MCAyMHB4IDYwcHggcmdiYSgwLDAsMCwuNClcIj4nICtcclxuICAgICc8ZGl2IHN0eWxlPVwiZGlzcGxheTpmbGV4O2p1c3RpZnktY29udGVudDpzcGFjZS1iZXR3ZWVuO2FsaWduLWl0ZW1zOmNlbnRlcjttYXJnaW4tYm90dG9tOjEwcHhcIj4nICtcclxuICAgICc8ZGl2PjxkaXYgc3R5bGU9XCJmb250LXNpemU6MTFweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7bGV0dGVyLXNwYWNpbmc6LjRweFwiPlN1YmZhbWlsaWE8L2Rpdj48ZGl2IHN0eWxlPVwiZm9udC1zaXplOjIycHg7Zm9udC13ZWlnaHQ6ODAwXCI+JyArXHJcbiAgICBlc2NhcGVIdG1sU2FmZShkb2Muc3ViZmFtaWxpYSB8fCBkb2MuaWQpICtcclxuICAgICc8L2Rpdj48L2Rpdj4nICtcclxuICAgICc8YnV0dG9uIG9uY2xpY2s9XCJkb2N1bWVudC5nZXRFbGVtZW50QnlJZChcXCdmb3JlY2FzdC1zdGF0LWRldGFpbFxcJykucmVtb3ZlKClcIiBzdHlsZT1cImJhY2tncm91bmQ6dHJhbnNwYXJlbnQ7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1ib3JkZXItc3VidGxlKTtib3JkZXItcmFkaXVzOjZweDtwYWRkaW5nOjZweCAxMnB4O2N1cnNvcjpwb2ludGVyO2ZvbnQtd2VpZ2h0OjcwMFwiPkNlcnJhcjwvYnV0dG9uPicgK1xyXG4gICAgJzwvZGl2PicgK1xyXG4gICAgbWV0cmljc0h0bWwgK1xyXG4gICAgJzxkaXYgc3R5bGU9XCJiYWNrZ3JvdW5kOiNmZmY7cGFkZGluZzo4cHg7Ym9yZGVyLXJhZGl1czo4cHg7bWFyZ2luLXRvcDoxMHB4O2JvcmRlcjoxcHggc29saWQgdmFyKC0tYm9yZGVyLXN1YnRsZSlcIj4nICtcclxuICAgIHN2Z0h0bWwgK1xyXG4gICAgJzwvZGl2PicgK1xyXG4gICAgdGFibGVIdG1sICtcclxuICAgICc8ZGl2IHN0eWxlPVwibWFyZ2luLXRvcDoxNHB4O2ZvbnQtc2l6ZToxMXB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpXCI+VmVyc2lvbjogPGNvZGU+JyArXHJcbiAgICBlc2NhcGVIdG1sU2FmZSh2ZXJzaW9uSWQpICtcclxuICAgICc8L2NvZGU+IFx1MDBCNyBBcHByb2FjaDogJyArXHJcbiAgICBlc2NhcGVIdG1sU2FmZSgoZG9jLmNvbmZpZyB8fCB7fSkuYXBwcm9hY2ggfHwgJ1x1MjAxNCcpICtcclxuICAgICc8L2Rpdj4nICtcclxuICAgICc8L2Rpdj4nO1xyXG4gIGVsLmlubmVySFRNTCA9IGNvbnRlbnQ7XHJcbiAgZG9jdW1lbnQuYm9keS5hcHBlbmRDaGlsZChlbCk7XHJcbn07XHJcblxyXG53aW5kb3cub3BlbkZvcmVjYXN0TW9kYWwgPSBhc3luYyBmdW5jdGlvbiAoKSB7XHJcbiAgaWYgKCFfY2FuRm9yZWNhc3QoKSkge1xyXG4gICAgYWxlcnQoJ0ZPUkVDQVNUIGVzIHNvbG8gcGFyYSBNYXJpYW5vIChhZG1pbikuJyk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIGNvbnN0IGVsID0gX3JlbmRlck1vZGFsU2hlbGwoKTtcclxuICBlbC5zdHlsZS5kaXNwbGF5ID0gJ2Jsb2NrJztcclxuICAvLyBGYXNlIDE6IGNhcmdhciBTYWxlcyBQbGFucyBjYWNoZXMgKyByZW5kZXJpemFyIHRhYiBkZWZhdWx0LlxyXG4gIF9yZW5kZXJTYWxlc1BsYW5zVGFiKCk7XHJcbiAgX2xvYWRTYWxlc1BsYW5DYWNoZXMoKVxyXG4gICAgLnRoZW4oX3JlbmRlclNhbGVzUGxhbnNUYWIpXHJcbiAgICAuY2F0Y2goKCkgPT4ge30pO1xyXG59O1xyXG5cclxud2luZG93LmNsb3NlRm9yZWNhc3RNb2RhbCA9IGZ1bmN0aW9uICgpIHtcclxuICBjb25zdCBlbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdmb3JlY2FzdC1tb2RhbCcpO1xyXG4gIGlmIChlbCkgZWwuc3R5bGUuZGlzcGxheSA9ICdub25lJztcclxufTtcclxuXHJcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG4vLyBGM0EgXHUyMDE0IFRhYmxhIFJlY29tZW5kYWNpXHUwMEYzbiBkZSBDb21wcmEgKHRhYiBTYWxlcyBQbGFucylcclxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblxyXG5hc3luYyBmdW5jdGlvbiBfbG9hZE11bHRpcGxpZXJPdmVycmlkZXMoKSB7XHJcbiAgaWYgKCF3aW5kb3cuZmJEYikgcmV0dXJuO1xyXG4gIHRyeSB7XHJcbiAgICBjb25zdCBkb2MgPSBhd2FpdCB3aW5kb3cuZmJEYi5jb2xsZWN0aW9uKCdmb3JlY2FzdF9jb25maWcnKS5kb2MoJ211bHRpcGxpZXJzJykuZ2V0KCk7XHJcbiAgICBpZiAoZG9jLmV4aXN0cykge1xyXG4gICAgICBjb25zdCBkID0gZG9jLmRhdGEoKSB8fCB7fTtcclxuICAgICAgX211bHRpcGxpZXJPdmVycmlkZXMgPSBkLnNrdU92ZXJyaWRlcyB8fCB7fTtcclxuICAgIH0gZWxzZSB7XHJcbiAgICAgIF9tdWx0aXBsaWVyT3ZlcnJpZGVzID0ge307XHJcbiAgICB9XHJcbiAgfSBjYXRjaCAoZSkge1xyXG4gICAgY29uc29sZS53YXJuKCdbRk9SRUNBU1QgcmVjb10gbG9hZCBtdWx0aXBsaWVycyBmYWlsOicsIGUgJiYgZS5tZXNzYWdlKTtcclxuICAgIF9tdWx0aXBsaWVyT3ZlcnJpZGVzID0ge307XHJcbiAgfVxyXG59XHJcblxyXG5hc3luYyBmdW5jdGlvbiBfc2F2ZU11bHRpcGxpZXJPdmVycmlkZShza3VVcHBlciwgdmFsdWUpIHtcclxuICBpZiAoIXdpbmRvdy5mYkRiKSByZXR1cm47XHJcbiAgaWYgKCFfbXVsdGlwbGllck92ZXJyaWRlcykgX211bHRpcGxpZXJPdmVycmlkZXMgPSB7fTtcclxuICBjb25zdCB1aWQgPSAod2luZG93LmN1cnJlbnRVc2VyICYmIHdpbmRvdy5jdXJyZW50VXNlci5lbWFpbCkgfHwgJ3Vua25vd24nO1xyXG4gIF9tdWx0aXBsaWVyT3ZlcnJpZGVzW3NrdVVwcGVyXSA9IHtcclxuICAgIHZhbHVlOiBOdW1iZXIodmFsdWUpLFxyXG4gICAgdXBkYXRlZEF0OiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXHJcbiAgICB1cGRhdGVkQnk6IHVpZCxcclxuICB9O1xyXG4gIGF3YWl0IHdpbmRvdy5mYkRiLmNvbGxlY3Rpb24oJ2ZvcmVjYXN0X2NvbmZpZycpLmRvYygnbXVsdGlwbGllcnMnKS5zZXQoe1xyXG4gICAgc2t1T3ZlcnJpZGVzOiBfbXVsdGlwbGllck92ZXJyaWRlcyxcclxuICAgIHVwZGF0ZWRBdDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxyXG4gICAgdXBkYXRlZEJ5OiB1aWQsXHJcbiAgfSk7XHJcbn1cclxuXHJcbmFzeW5jIGZ1bmN0aW9uIF9yZW1vdmVNdWx0aXBsaWVyT3ZlcnJpZGUoc2t1VXBwZXIpIHtcclxuICBpZiAoIXdpbmRvdy5mYkRiIHx8ICFfbXVsdGlwbGllck92ZXJyaWRlcykgcmV0dXJuO1xyXG4gIGRlbGV0ZSBfbXVsdGlwbGllck92ZXJyaWRlc1tza3VVcHBlcl07XHJcbiAgY29uc3QgdWlkID0gKHdpbmRvdy5jdXJyZW50VXNlciAmJiB3aW5kb3cuY3VycmVudFVzZXIuZW1haWwpIHx8ICd1bmtub3duJztcclxuICBhd2FpdCB3aW5kb3cuZmJEYi5jb2xsZWN0aW9uKCdmb3JlY2FzdF9jb25maWcnKS5kb2MoJ211bHRpcGxpZXJzJykuc2V0KHtcclxuICAgIHNrdU92ZXJyaWRlczogX211bHRpcGxpZXJPdmVycmlkZXMsXHJcbiAgICB1cGRhdGVkQXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcclxuICAgIHVwZGF0ZWRCeTogdWlkLFxyXG4gIH0pO1xyXG59XHJcblxyXG4vLyBBdXRvIG11bHRpcGxpZXI6IHJlY2VudC9iYXNlbGluZSBjb24gY2FwLiBSZXRvcm5hIHt2YWx1ZSwgc291cmNlOiAnYXV0byd8J2ZhbGxiYWNrJ3wnZGVmYXVsdCcsIHJlY2VudCwgYmFzZWxpbmV9LlxyXG5mdW5jdGlvbiBfY29tcHV0ZU11bHRpcGxpZXJBdXRvKHNrdVVwcGVyKSB7XHJcbiAgY29uc3QgcmVjID0gX3JlY29WZW50YXNTbmFwc2hvdCAmJiBfcmVjb1ZlbnRhc1NuYXBzaG90W3NrdVVwcGVyXTtcclxuICBpZiAoIXJlYyB8fCAhcmVjLm1lc2VzKSByZXR1cm4geyB2YWx1ZTogMS4wLCBzb3VyY2U6ICdkZWZhdWx0JywgcmVjZW50OiAwLCBiYXNlbGluZTogMCB9O1xyXG4gIGNvbnN0IGhveSA9IG5ldyBEYXRlKCk7XHJcbiAgY29uc3QgbW9udGhzQmFja0tleSA9IChuKSA9PiB7XHJcbiAgICBjb25zdCBkID0gbmV3IERhdGUoaG95LmdldEZ1bGxZZWFyKCksIGhveS5nZXRNb250aCgpIC0gbiwgMSk7XHJcbiAgICByZXR1cm4gU3RyaW5nKGQuZ2V0RnVsbFllYXIoKSkgKyAnLScgKyBTdHJpbmcoZC5nZXRNb250aCgpICsgMSkucGFkU3RhcnQoMiwgJzAnKTtcclxuICB9O1xyXG4gIGNvbnN0IGNvbGxlY3RBdmcgPSAobikgPT4ge1xyXG4gICAgbGV0IHN1bSA9IDA7XHJcbiAgICBsZXQgY291bnQgPSAwO1xyXG4gICAgZm9yIChsZXQgaSA9IDE7IGkgPD0gbjsgaSsrKSB7XHJcbiAgICAgIGNvbnN0IGsgPSBtb250aHNCYWNrS2V5KGkpO1xyXG4gICAgICBjb25zdCBtID0gcmVjLm1lc2VzW2tdO1xyXG4gICAgICBpZiAobSAmJiBOdW1iZXIuaXNGaW5pdGUoTnVtYmVyKG0ucXR5KSkpIHtcclxuICAgICAgICBzdW0gKz0gTnVtYmVyKG0ucXR5KTtcclxuICAgICAgICBjb3VudCsrO1xyXG4gICAgICB9XHJcbiAgICB9XHJcbiAgICByZXR1cm4gY291bnQgPiAwID8geyBhdmc6IHN1bSAvIGNvdW50LCBuOiBjb3VudCB9IDogeyBhdmc6IDAsIG46IDAgfTtcclxuICB9O1xyXG4gIGNvbnN0IHJlYzIgPSBjb2xsZWN0QXZnKFJFQ09fTVVMVF9SRUNFTlRfTU9OVEhTKTtcclxuICBjb25zdCBiYXM2ID0gY29sbGVjdEF2ZyhSRUNPX01VTFRfQkFTRUxJTkVfTU9OVEhTKTtcclxuICAvLyBOZWNlc2l0YW1vcyBhbCBtZW5vcyAxIG1lcyByZWNpZW50ZSArIDMgbWVzZXMgYmFzZWxpbmUgcGFyYSBjYWxjdWxhciBhdXRvLlxyXG4gIGlmIChyZWMyLm4gPT09IDAgfHwgYmFzNi5uIDwgMyB8fCBiYXM2LmF2ZyA8IFJFQ09fTVVMVF9NSU5fQkFTRUxJTkUpIHtcclxuICAgIHJldHVybiB7IHZhbHVlOiAxLjAsIHNvdXJjZTogJ2RlZmF1bHQnLCByZWNlbnQ6IHJlYzIuYXZnLCBiYXNlbGluZTogYmFzNi5hdmcgfTtcclxuICB9XHJcbiAgbGV0IHJhdGlvID0gcmVjMi5hdmcgLyBiYXM2LmF2ZztcclxuICBpZiAocmF0aW8gPCBSRUNPX01VTFRfTUlOKSByYXRpbyA9IFJFQ09fTVVMVF9NSU47XHJcbiAgaWYgKHJhdGlvID4gUkVDT19NVUxUX01BWCkgcmF0aW8gPSBSRUNPX01VTFRfTUFYO1xyXG4gIHJldHVybiB7XHJcbiAgICB2YWx1ZTogTWF0aC5yb3VuZChyYXRpbyAqIDEwMCkgLyAxMDAsXHJcbiAgICBzb3VyY2U6ICdhdXRvJyxcclxuICAgIHJlY2VudDogTWF0aC5yb3VuZChyZWMyLmF2ZyAqIDEwKSAvIDEwLFxyXG4gICAgYmFzZWxpbmU6IE1hdGgucm91bmQoYmFzNi5hdmcgKiAxMCkgLyAxMCxcclxuICB9O1xyXG59XHJcblxyXG5mdW5jdGlvbiBfZ2V0RWZmZWN0aXZlTXVsdGlwbGllcihza3VVcHBlcikge1xyXG4gIC8vIE92ZXJyaWRlIG1hbnVhbCBnYW5hXHJcbiAgaWYgKF9tdWx0aXBsaWVyT3ZlcnJpZGVzICYmIF9tdWx0aXBsaWVyT3ZlcnJpZGVzW3NrdVVwcGVyXSkge1xyXG4gICAgcmV0dXJuIHtcclxuICAgICAgdmFsdWU6IE51bWJlcihfbXVsdGlwbGllck92ZXJyaWRlc1tza3VVcHBlcl0udmFsdWUpIHx8IDEuMCxcclxuICAgICAgc291cmNlOiAnbWFudWFsJyxcclxuICAgICAgYXV0bzogX2NvbXB1dGVNdWx0aXBsaWVyQXV0byhza3VVcHBlciksXHJcbiAgICB9O1xyXG4gIH1cclxuICBjb25zdCBhdXRvID0gX2NvbXB1dGVNdWx0aXBsaWVyQXV0byhza3VVcHBlcik7XHJcbiAgcmV0dXJuIHsgdmFsdWU6IGF1dG8udmFsdWUsIHNvdXJjZTogYXV0by5zb3VyY2UsIGF1dG8gfTtcclxufVxyXG5cclxuYXN5bmMgZnVuY3Rpb24gX2xvYWREaXNjb250aW51ZWRTa3VzKCkge1xyXG4gIGlmICghd2luZG93LmZiRGIpIHJldHVybjtcclxuICB0cnkge1xyXG4gICAgY29uc3QgZG9jID0gYXdhaXQgd2luZG93LmZiRGIuY29sbGVjdGlvbignZm9yZWNhc3RfY29uZmlnJykuZG9jKCdkaXNjb250aW51ZWRfc2t1cycpLmdldCgpO1xyXG4gICAgaWYgKGRvYy5leGlzdHMpIHtcclxuICAgICAgY29uc3QgZCA9IGRvYy5kYXRhKCkgfHwge307XHJcbiAgICAgIGNvbnN0IGFyciA9IEFycmF5LmlzQXJyYXkoZC5za3VzKSA/IGQuc2t1cyA6IFtdO1xyXG4gICAgICBfZGlzY29udGludWVkU2t1cyA9IG5ldyBTZXQoYXJyLm1hcCgocykgPT4gU3RyaW5nKHMpLnRyaW0oKS50b1VwcGVyQ2FzZSgpKSk7XHJcbiAgICAgIF9kaXNjb250aW51ZWRNZXRhID0geyB1cGRhdGVkQXQ6IGQudXBkYXRlZEF0LCB1cGRhdGVkQnk6IGQudXBkYXRlZEJ5IH07XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICBfZGlzY29udGludWVkU2t1cyA9IG5ldyBTZXQoKTtcclxuICAgICAgX2Rpc2NvbnRpbnVlZE1ldGEgPSBudWxsO1xyXG4gICAgfVxyXG4gIH0gY2F0Y2ggKGUpIHtcclxuICAgIGNvbnNvbGUud2FybignW0ZPUkVDQVNUIHJlY29dIGxvYWQgZGlzY29udGludWVkIGZhaWw6JywgZSAmJiBlLm1lc3NhZ2UpO1xyXG4gICAgX2Rpc2NvbnRpbnVlZFNrdXMgPSBuZXcgU2V0KCk7XHJcbiAgfVxyXG59XHJcblxyXG5hc3luYyBmdW5jdGlvbiBfc2F2ZURpc2NvbnRpbnVlZFNrdXMoKSB7XHJcbiAgaWYgKCF3aW5kb3cuZmJEYiB8fCAhX2Rpc2NvbnRpbnVlZFNrdXMpIHJldHVybjtcclxuICBjb25zdCB1aWQgPSAod2luZG93LmN1cnJlbnRVc2VyICYmIHdpbmRvdy5jdXJyZW50VXNlci5lbWFpbCkgfHwgJ3Vua25vd24nO1xyXG4gIGNvbnN0IHBheWxvYWQgPSB7XHJcbiAgICBza3VzOiBBcnJheS5mcm9tKF9kaXNjb250aW51ZWRTa3VzKS5zb3J0KCksXHJcbiAgICB1cGRhdGVkQXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcclxuICAgIHVwZGF0ZWRCeTogdWlkLFxyXG4gIH07XHJcbiAgYXdhaXQgd2luZG93LmZiRGIuY29sbGVjdGlvbignZm9yZWNhc3RfY29uZmlnJykuZG9jKCdkaXNjb250aW51ZWRfc2t1cycpLnNldChwYXlsb2FkKTtcclxuICBfZGlzY29udGludWVkTWV0YSA9IHsgdXBkYXRlZEF0OiBwYXlsb2FkLnVwZGF0ZWRBdCwgdXBkYXRlZEJ5OiBwYXlsb2FkLnVwZGF0ZWRCeSB9O1xyXG59XHJcblxyXG5hc3luYyBmdW5jdGlvbiBfbG9hZFJlY29EYXRhKCkge1xyXG4gIGlmICghd2luZG93LmZiRGIpIHRocm93IG5ldyBFcnJvcignRmlyZXN0b3JlIG5vIGluaWNpYWxpemFkbycpO1xyXG4gIGNvbnN0IHByb21pc2VzID0gW107XHJcbiAgaWYgKCFfZGlzY29udGludWVkU2t1cykgcHJvbWlzZXMucHVzaChfbG9hZERpc2NvbnRpbnVlZFNrdXMoKSk7XHJcbiAgaWYgKCFfbXVsdGlwbGllck92ZXJyaWRlcykgcHJvbWlzZXMucHVzaChfbG9hZE11bHRpcGxpZXJPdmVycmlkZXMoKSk7XHJcbiAgaWYgKCFfcmVjb1N0b2NrU25hcHNob3QpIHtcclxuICAgIHByb21pc2VzLnB1c2goXHJcbiAgICAgIHdpbmRvdy5mYkRiXHJcbiAgICAgICAgLmNvbGxlY3Rpb24oJ2FwcF9jb25maWcnKVxyXG4gICAgICAgIC5kb2MoJ3N0b2NrX3NuYXBzaG90JylcclxuICAgICAgICAuZ2V0KClcclxuICAgICAgICAudGhlbigoZCkgPT4ge1xyXG4gICAgICAgICAgY29uc3QgZGF0YSA9IGQuZXhpc3RzID8gZC5kYXRhKCkgOiB7fTtcclxuICAgICAgICAgIGxldCB3aCA9IHt9O1xyXG4gICAgICAgICAgbGV0IGJvID0ge307XHJcbiAgICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICB3aCA9IGRhdGEud2FyZWhvdXNlQnJlYWtkb3duID8gSlNPTi5wYXJzZShkYXRhLndhcmVob3VzZUJyZWFrZG93bikgOiB7fTtcclxuICAgICAgICAgIH0gY2F0Y2gge1xyXG4gICAgICAgICAgICB3aCA9IHt9O1xyXG4gICAgICAgICAgfVxyXG4gICAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgYm8gPSBkYXRhLmJhY2tvcmRlckJ5U2t1ID8gSlNPTi5wYXJzZShkYXRhLmJhY2tvcmRlckJ5U2t1KSA6IHt9O1xyXG4gICAgICAgICAgfSBjYXRjaCB7XHJcbiAgICAgICAgICAgIGJvID0ge307XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgICBfcmVjb1N0b2NrU25hcHNob3QgPSB7IHdhcmVob3VzZUJyZWFrZG93bjogd2gsIGJhY2tvcmRlckJ5U2t1OiBibyB9O1xyXG4gICAgICAgIH0pXHJcbiAgICApO1xyXG4gIH1cclxuICBpZiAoIV9yZWNvVmVudGFzU25hcHNob3QpIHtcclxuICAgIHByb21pc2VzLnB1c2goXHJcbiAgICAgIHdpbmRvdy5mYkRiXHJcbiAgICAgICAgLmNvbGxlY3Rpb24oJ3NrdV92ZW50YXNfc25hcHNob3QnKVxyXG4gICAgICAgIC5nZXQoKVxyXG4gICAgICAgIC50aGVuKChzbmFwKSA9PiB7XHJcbiAgICAgICAgICBjb25zdCBtYXAgPSB7fTtcclxuICAgICAgICAgIHNuYXAuZm9yRWFjaCgoZG9jKSA9PiB7XHJcbiAgICAgICAgICAgIGNvbnN0IGQgPSBkb2MuZGF0YSgpO1xyXG4gICAgICAgICAgICBpZiAoIWQgfHwgIWQuc2t1KSByZXR1cm47XHJcbiAgICAgICAgICAgIG1hcFtTdHJpbmcoZC5za3UpLnRyaW0oKS50b1VwcGVyQ2FzZSgpXSA9IHsgbWVzZXM6IGQubWVzZXMgfHwge30gfTtcclxuICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgX3JlY29WZW50YXNTbmFwc2hvdCA9IG1hcDtcclxuICAgICAgICB9KVxyXG4gICAgKTtcclxuICB9XHJcbiAgYXdhaXQgUHJvbWlzZS5hbGwocHJvbWlzZXMpO1xyXG59XHJcblxyXG5mdW5jdGlvbiBfY29tcHV0ZVZlbnRhTWVuc3VhbFByb21lZGlvKHNrdVVwcGVyKSB7XHJcbiAgLy8gUHJvbWVkaW8gZGUgbG9zIFx1MDBGQWx0aW1vcyBSRUNPX1ZFTlRBX1BST01FRElPX1dJTkRPVyBtZXNlcyBjZXJyYWRvc1xyXG4gIC8vIChleGNsdXllIGVsIG1lcyBhY3R1YWwgcGFyY2lhbCkuXHJcbiAgY29uc3QgcmVjID0gX3JlY29WZW50YXNTbmFwc2hvdCAmJiBfcmVjb1ZlbnRhc1NuYXBzaG90W3NrdVVwcGVyXTtcclxuICBpZiAoIXJlYyB8fCAhcmVjLm1lc2VzKSByZXR1cm4gMDtcclxuICBjb25zdCBob3kgPSBuZXcgRGF0ZSgpO1xyXG4gIGNvbnN0IG1vbnRoc0JhY2sgPSBbXTtcclxuICBmb3IgKGxldCBpID0gMTsgaSA8PSBSRUNPX1ZFTlRBX1BST01FRElPX1dJTkRPVzsgaSsrKSB7XHJcbiAgICBjb25zdCBkID0gbmV3IERhdGUoaG95LmdldEZ1bGxZZWFyKCksIGhveS5nZXRNb250aCgpIC0gaSwgMSk7XHJcbiAgICBtb250aHNCYWNrLnB1c2goU3RyaW5nKGQuZ2V0RnVsbFllYXIoKSkgKyAnLScgKyBTdHJpbmcoZC5nZXRNb250aCgpICsgMSkucGFkU3RhcnQoMiwgJzAnKSk7XHJcbiAgfVxyXG4gIGxldCBzdW0gPSAwO1xyXG4gIGxldCBuID0gMDtcclxuICBtb250aHNCYWNrLmZvckVhY2goKGspID0+IHtcclxuICAgIGNvbnN0IG0gPSByZWMubWVzZXNba107XHJcbiAgICBpZiAobSAmJiBOdW1iZXIuaXNGaW5pdGUoTnVtYmVyKG0ucXR5KSkpIHtcclxuICAgICAgc3VtICs9IE51bWJlcihtLnF0eSk7XHJcbiAgICAgIG4rKztcclxuICAgIH1cclxuICB9KTtcclxuICByZXR1cm4gbiA+IDAgPyBzdW0gLyBuIDogMDtcclxufVxyXG5cclxuZnVuY3Rpb24gX2NvbXB1dGVTYWxlc1BsYW5GdXR1cm8ocm93KSB7XHJcbiAgLy8gU3VtYSBsb3MgbWVzZXMgZGUgcm93Lm1vbnRocyBkZXNkZSBlbCBtZXMgYWN0dWFsIChpbmNsdXNpdmUpIGhhc3RhIGVsXHJcbiAgLy8gXHUwMEZBbHRpbW8gbWVzIGRlbCBzYWxlcyBwbGFuLiBMb3MgbWVzZXMgc29uICdZWVlZLU1NJy5cclxuICBpZiAoIXJvdyB8fCAhcm93Lm1vbnRocykgcmV0dXJuIDA7XHJcbiAgY29uc3QgaG95ID0gbmV3IERhdGUoKTtcclxuICBjb25zdCBjdXJyZW50S2V5ID0gU3RyaW5nKGhveS5nZXRGdWxsWWVhcigpKSArICctJyArIFN0cmluZyhob3kuZ2V0TW9udGgoKSArIDEpLnBhZFN0YXJ0KDIsICcwJyk7XHJcbiAgbGV0IHN1bSA9IDA7XHJcbiAgT2JqZWN0LmtleXMocm93Lm1vbnRocykuZm9yRWFjaCgoaykgPT4ge1xyXG4gICAgaWYgKGsgPj0gY3VycmVudEtleSkgc3VtICs9IE51bWJlcihyb3cubW9udGhzW2tdIHx8IDApO1xyXG4gIH0pO1xyXG4gIHJldHVybiBzdW07XHJcbn1cclxuXHJcbmZ1bmN0aW9uIF9jb21wdXRlUmVjb21tZW5kYXRpb25zKCkge1xyXG4gIC8vIENvbWJpbmEgUm9kcyArIFJlZWxzIHNhbGVzIHBsYW5zICsgc3RvY2sgKyBiYWNrb3JkZXIgKyB2ZW50YXMgcHJvbWVkaW8uXHJcbiAgLy8gUmV0b3JuYSBhcnJheSBkZSByb3dzIGNvbiB0b2RvcyBsb3MgY2FtcG9zICsgcmVjb21lbmRhZG8uXHJcbiAgY29uc3Qgcm93cyA9IFtdO1xyXG4gIGNvbnN0IGZhbWlsaWFzID0gWydyb2RzJywgJ3JlZWxzJ107XHJcbiAgZm9yIChjb25zdCBmYW0gb2YgZmFtaWxpYXMpIHtcclxuICAgIGNvbnN0IGNhY2hlID0gX3NhbGVzUGxhbkNhY2hlc1tmYW1dO1xyXG4gICAgaWYgKCFjYWNoZSB8fCAhY2FjaGUucm93cykgY29udGludWU7XHJcbiAgICBmb3IgKGNvbnN0IHNwUm93IG9mIGNhY2hlLnJvd3MpIHtcclxuICAgICAgY29uc3Qgc2t1ID0gU3RyaW5nKHNwUm93LnNrdSB8fCAnJykudHJpbSgpO1xyXG4gICAgICBjb25zdCBza3VVcHBlciA9IHNrdS50b1VwcGVyQ2FzZSgpO1xyXG4gICAgICAvLyB2MTExMjogc2tpcGVhbW9zIFNLVXMgZGVzY29udGludWFkb3MgKE1hcmlhbm8gbG9zIG1hcmNhIGRlc2RlIGxhIFVJKS5cclxuICAgICAgaWYgKF9kaXNjb250aW51ZWRTa3VzICYmIF9kaXNjb250aW51ZWRTa3VzLmhhcyhza3VVcHBlcikpIGNvbnRpbnVlO1xyXG4gICAgICBjb25zdCBzdG9ja1doID1cclxuICAgICAgICAoX3JlY29TdG9ja1NuYXBzaG90ICYmXHJcbiAgICAgICAgICBfcmVjb1N0b2NrU25hcHNob3Qud2FyZWhvdXNlQnJlYWtkb3duICYmXHJcbiAgICAgICAgICBfcmVjb1N0b2NrU25hcHNob3Qud2FyZWhvdXNlQnJlYWtkb3duW3NrdV0pIHx8XHJcbiAgICAgICAge307XHJcbiAgICAgIGNvbnN0IHN0b2NrTGlicmUgPSBOdW1iZXIoc3RvY2tXaFsnMTEnXSB8fCAwKTtcclxuICAgICAgY29uc3QgZW5UcmFuc2l0byA9IE51bWJlcihzdG9ja1doWycxMiddIHx8IDApO1xyXG4gICAgICBjb25zdCBiYWNrb3JkZXIgPSBOdW1iZXIoXHJcbiAgICAgICAgKF9yZWNvU3RvY2tTbmFwc2hvdCAmJlxyXG4gICAgICAgICAgX3JlY29TdG9ja1NuYXBzaG90LmJhY2tvcmRlckJ5U2t1ICYmXHJcbiAgICAgICAgICBfcmVjb1N0b2NrU25hcHNob3QuYmFja29yZGVyQnlTa3Vbc2t1XSkgfHxcclxuICAgICAgICAgIDBcclxuICAgICAgKTtcclxuICAgICAgY29uc3QgdmVudGFNZW5zdWFsID0gX2NvbXB1dGVWZW50YU1lbnN1YWxQcm9tZWRpbyhza3VVcHBlcik7XHJcbiAgICAgIGNvbnN0IHNhbGVzUGxhbkZ1dCA9IF9jb21wdXRlU2FsZXNQbGFuRnV0dXJvKHNwUm93KTtcclxuICAgICAgY29uc3QgbW9xID0gTnVtYmVyKHNwUm93Lm1vcSB8fCAwKTtcclxuICAgICAgLy8gdjExMTQgRjNCOiBtdWx0aXBsaWNhZG9yIGF1dG8gKHJlY2VudC9iYXNlbGluZSkgbyBvdmVycmlkZSBtYW51YWwuXHJcbiAgICAgIGNvbnN0IG11bHRJbmZvID0gX2dldEVmZmVjdGl2ZU11bHRpcGxpZXIoc2t1VXBwZXIpO1xyXG4gICAgICBjb25zdCBtdWx0aXBsaWVyID0gbXVsdEluZm8udmFsdWU7XHJcbiAgICAgIGNvbnN0IGRlbWFuZGFFc3BlcmFkYSA9IHZlbnRhTWVuc3VhbCAqIG11bHRpcGxpZXIgKiBSRUNPX0hPUklaT05fTU9OVEhTO1xyXG4gICAgICBjb25zdCBiYWxhbmNlID0gc3RvY2tMaWJyZSArIGVuVHJhbnNpdG8gKyBzYWxlc1BsYW5GdXQgLSBiYWNrb3JkZXIgLSBkZW1hbmRhRXNwZXJhZGE7XHJcbiAgICAgIGxldCByZWNvbWVuZGFkbyA9IDA7XHJcbiAgICAgIGlmIChiYWxhbmNlIDwgMCkge1xyXG4gICAgICAgIGNvbnN0IGRlZmljaXQgPSAtYmFsYW5jZTtcclxuICAgICAgICByZWNvbWVuZGFkbyA9IG1vcSA+IDAgPyBNYXRoLm1heChtb3EsIE1hdGguY2VpbChkZWZpY2l0IC8gbW9xKSAqIG1vcSkgOiBNYXRoLmNlaWwoZGVmaWNpdCk7XHJcbiAgICAgIH1cclxuICAgICAgcm93cy5wdXNoKHtcclxuICAgICAgICBmYW1pbGlhOiBmYW0sXHJcbiAgICAgICAgc2t1LFxyXG4gICAgICAgIGRlc2NyaXB0aW9uOiBzcFJvdy5kZXNjcmlwdGlvbiB8fCAnJyxcclxuICAgICAgICBtb3EsXHJcbiAgICAgICAgc3RvY2tMaWJyZSxcclxuICAgICAgICBlblRyYW5zaXRvLFxyXG4gICAgICAgIGJhY2tvcmRlcixcclxuICAgICAgICB2ZW50YU1lbnN1YWw6IE1hdGgucm91bmQodmVudGFNZW5zdWFsICogMTApIC8gMTAsXHJcbiAgICAgICAgc2FsZXNQbGFuRnV0LFxyXG4gICAgICAgIG11bHRpcGxpZXIsXHJcbiAgICAgICAgbXVsdFNvdXJjZTogbXVsdEluZm8uc291cmNlLCAvLyAnYXV0bycgfCAnbWFudWFsJyB8ICdkZWZhdWx0JyB8ICdmYWxsYmFjaydcclxuICAgICAgICBtdWx0QXV0bzogbXVsdEluZm8uYXV0byA/IG11bHRJbmZvLmF1dG8udmFsdWUgOiBudWxsLCAvLyBlbCB2YWxvciBhdXRvIHNpIGhheSBvdmVycmlkZSBtYW51YWxcclxuICAgICAgICBkZW1hbmRhRXNwZXJhZGE6IE1hdGgucm91bmQoZGVtYW5kYUVzcGVyYWRhICogMTApIC8gMTAsXHJcbiAgICAgICAgYmFsYW5jZTogTWF0aC5yb3VuZChiYWxhbmNlICogMTApIC8gMTAsXHJcbiAgICAgICAgcmVjb21lbmRhZG8sXHJcbiAgICAgIH0pO1xyXG4gICAgfVxyXG4gIH1cclxuICAvLyBPcmRlbmFyIHBvciByZWNvbWVuZGFkbyBkZXNjZW5kZW50ZVxyXG4gIHJvd3Muc29ydCgoYSwgYikgPT4gYi5yZWNvbWVuZGFkbyAtIGEucmVjb21lbmRhZG8pO1xyXG4gIHJldHVybiByb3dzO1xyXG59XHJcblxyXG5mdW5jdGlvbiBfZm10TnVtU2lnbmVkKG4pIHtcclxuICBpZiAobiA9PSBudWxsIHx8ICFOdW1iZXIuaXNGaW5pdGUoTnVtYmVyKG4pKSkgcmV0dXJuICdcdTIwMTQnO1xyXG4gIGNvbnN0IHYgPSBOdW1iZXIobik7XHJcbiAgY29uc3QgYWJzID0gTWF0aC5hYnModikudG9Mb2NhbGVTdHJpbmcoJ2VzLUFSJywgeyBtYXhpbXVtRnJhY3Rpb25EaWdpdHM6IDAgfSk7XHJcbiAgcmV0dXJuICh2IDwgMCA/ICdcdTIyMTInIDogJycpICsgYWJzO1xyXG59XHJcblxyXG5mdW5jdGlvbiBfZm10SW50KG4pIHtcclxuICBpZiAobiA9PSBudWxsIHx8ICFOdW1iZXIuaXNGaW5pdGUoTnVtYmVyKG4pKSkgcmV0dXJuICdcdTIwMTQnO1xyXG4gIHJldHVybiBNYXRoLnJvdW5kKE51bWJlcihuKSkudG9Mb2NhbGVTdHJpbmcoJ2VzLUFSJyk7XHJcbn1cclxuXHJcbi8vIHYxMTE0IEYzQjogY2VsZGEgbXVsdGlwbGljYWRvciBjb24gY2hpcCBhdXRvL21hbnVhbCArIGlucHV0IGVkaXRhYmxlLlxyXG5mdW5jdGlvbiBfYnVpbGRNdWx0Q2VsbEh0bWwocikge1xyXG4gIGNvbnN0IHNrdVVwcGVyID0gU3RyaW5nKHIuc2t1KS50cmltKCkudG9VcHBlckNhc2UoKTtcclxuICBjb25zdCBpc01hbnVhbCA9IHIubXVsdFNvdXJjZSA9PT0gJ21hbnVhbCc7XHJcbiAgY29uc3QgaXNEZWZhdWx0ID0gci5tdWx0U291cmNlID09PSAnZGVmYXVsdCc7XHJcbiAgY29uc3QgdmFsID0gTnVtYmVyKHIubXVsdGlwbGllciB8fCAxLjApLnRvRml4ZWQoMik7XHJcbiAgLy8gQ29sb3IgcG9yIGRpcmVjY2lcdTAwRjNuOiA+MS4wNSB2ZXJkZSAoY3JlY2llbmRvKSwgPDAuOTUgcm9qbyAoY2F5ZW5kbyksIG1lZGlvIGdyaXMuXHJcbiAgbGV0IGRpckNvbG9yID0gJ3ZhcigtLXRleHQtbXV0ZWQpJztcclxuICBpZiAoci5tdWx0aXBsaWVyID4gMS4wNSkgZGlyQ29sb3IgPSAnIzE2YTM0YSc7XHJcbiAgZWxzZSBpZiAoci5tdWx0aXBsaWVyIDwgMC45NSkgZGlyQ29sb3IgPSAnI2RjMjYyNic7XHJcblxyXG4gIGNvbnN0IGNoaXAgPSBpc01hbnVhbFxyXG4gICAgPyAnPHNwYW4gc3R5bGU9XCJkaXNwbGF5OmlubGluZS1ibG9jaztwYWRkaW5nOjFweCA1cHg7YmFja2dyb3VuZDojZjU5ZTBiO2NvbG9yOiNmZmY7Ym9yZGVyLXJhZGl1czo4cHg7Zm9udC1zaXplOjlweDtmb250LXdlaWdodDo3MDA7bWFyZ2luLWxlZnQ6NHB4XCIgdGl0bGU9XCJPdmVycmlkZSBtYW51YWw6IHBpc2EgZWwgYXV0b1wiPk08L3NwYW4+J1xyXG4gICAgOiBpc0RlZmF1bHRcclxuICAgICAgPyAnPHNwYW4gc3R5bGU9XCJkaXNwbGF5OmlubGluZS1ibG9jaztwYWRkaW5nOjFweCA1cHg7YmFja2dyb3VuZDojOTRhM2I4O2NvbG9yOiNmZmY7Ym9yZGVyLXJhZGl1czo4cHg7Zm9udC1zaXplOjlweDtmb250LXdlaWdodDo3MDA7bWFyZ2luLWxlZnQ6NHB4XCIgdGl0bGU9XCJTaW4gZGF0b3Mgc3VmaWNpZW50ZXM6IHVzYSAxLjBcIj5cdTAwQjc8L3NwYW4+J1xyXG4gICAgICA6ICc8c3BhbiBzdHlsZT1cImRpc3BsYXk6aW5saW5lLWJsb2NrO3BhZGRpbmc6MXB4IDVweDtiYWNrZ3JvdW5kOiMwZDk0ODg7Y29sb3I6I2ZmZjtib3JkZXItcmFkaXVzOjhweDtmb250LXNpemU6OXB4O2ZvbnQtd2VpZ2h0OjcwMDttYXJnaW4tbGVmdDo0cHhcIiB0aXRsZT1cIkF1dG8gPSB2ZW50YSAybSAvIHZlbnRhIDZtXCI+QTwvc3Bhbj4nO1xyXG5cclxuICBjb25zdCByZXNldEJ0biA9IGlzTWFudWFsXHJcbiAgICA/ICc8YnV0dG9uIG9uY2xpY2s9XCJyZXNldE11bHRpcGxpZXIoXFwnJyArXHJcbiAgICAgIGVzY2FwZUh0bWxTYWZlKHNrdVVwcGVyKSArXHJcbiAgICAgICdcXCcpXCIgdGl0bGU9XCJWb2x2ZXIgYWwgYXV0b1wiIHN0eWxlPVwibWFyZ2luLWxlZnQ6NHB4O2JhY2tncm91bmQ6dHJhbnNwYXJlbnQ7Ym9yZGVyOm5vbmU7Y3Vyc29yOnBvaW50ZXI7Zm9udC1zaXplOjEycHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7cGFkZGluZzowXCI+XHUyMUJCPC9idXR0b24+J1xyXG4gICAgOiAnJztcclxuXHJcbiAgY29uc3QgYXV0b0hpbnQgPVxyXG4gICAgaXNNYW51YWwgJiYgci5tdWx0QXV0byAhPSBudWxsXHJcbiAgICAgID8gJyA8c3BhbiBzdHlsZT1cImZvbnQtc2l6ZToxMHB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpXCIgdGl0bGU9XCJWYWxvciBhdXRvIGNhbGN1bGFkb1wiPihhdXRvICcgK1xyXG4gICAgICAgIE51bWJlcihyLm11bHRBdXRvKS50b0ZpeGVkKDIpICtcclxuICAgICAgICAnKTwvc3Bhbj4nXHJcbiAgICAgIDogJyc7XHJcblxyXG4gIHJldHVybiAoXHJcbiAgICAnPHNwYW4gc3R5bGU9XCJkaXNwbGF5OmlubGluZS1mbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtnYXA6MnB4XCI+JyArXHJcbiAgICAnPHNwYW4gb25jbGljaz1cImVkaXRNdWx0aXBsaWVyKHRoaXMsIFxcJycgK1xyXG4gICAgZXNjYXBlSHRtbFNhZmUoc2t1VXBwZXIpICtcclxuICAgICdcXCcpXCIgc3R5bGU9XCJjdXJzb3I6cG9pbnRlcjtwYWRkaW5nOjJweCA2cHg7Ym9yZGVyLXJhZGl1czo0cHg7YmFja2dyb3VuZDp2YXIoLS1iZy1zZWNvbmRhcnkpO2ZvbnQtdmFyaWFudC1udW1lcmljOnRhYnVsYXItbnVtcztmb250LXdlaWdodDo3MDA7Y29sb3I6JyArXHJcbiAgICBkaXJDb2xvciArXHJcbiAgICAnXCIgdGl0bGU9XCJDbGljayBwYXJhIGVkaXRhclwiPicgK1xyXG4gICAgdmFsICtcclxuICAgICc8L3NwYW4+JyArXHJcbiAgICBjaGlwICtcclxuICAgIHJlc2V0QnRuICtcclxuICAgIGF1dG9IaW50ICtcclxuICAgICc8L3NwYW4+J1xyXG4gICk7XHJcbn1cclxuXHJcbndpbmRvdy5lZGl0TXVsdGlwbGllciA9IGZ1bmN0aW9uIChlbCwgc2t1VXBwZXIpIHtcclxuICBjb25zdCBjdXJyZW50VmFsID0gcGFyc2VGbG9hdChlbC50ZXh0Q29udGVudCkgfHwgMS4wO1xyXG4gIGNvbnN0IGlucHV0ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnaW5wdXQnKTtcclxuICBpbnB1dC50eXBlID0gJ251bWJlcic7XHJcbiAgaW5wdXQuc3RlcCA9ICcwLjA1JztcclxuICBpbnB1dC5taW4gPSAnMC4xJztcclxuICBpbnB1dC5tYXggPSAnNSc7XHJcbiAgaW5wdXQudmFsdWUgPSBTdHJpbmcoY3VycmVudFZhbCk7XHJcbiAgaW5wdXQuc3R5bGUuY3NzVGV4dCA9XHJcbiAgICAnd2lkdGg6NjBweDtwYWRkaW5nOjJweCA0cHg7Zm9udC1zaXplOjEycHg7Zm9udC13ZWlnaHQ6NzAwO3RleHQtYWxpZ246Y2VudGVyO2JvcmRlcjoycHggc29saWQgIzBkOTQ4ODtib3JkZXItcmFkaXVzOjRweDtiYWNrZ3JvdW5kOnZhcigtLWJnLWVsZXZhdGVkKTtjb2xvcjp2YXIoLS10ZXh0LXByaW1hcnkpO2ZvbnQtdmFyaWFudC1udW1lcmljOnRhYnVsYXItbnVtcyc7XHJcbiAgY29uc3QgcGFyZW50ID0gZWwucGFyZW50Tm9kZTtcclxuICBwYXJlbnQucmVwbGFjZUNoaWxkKGlucHV0LCBlbCk7XHJcbiAgaW5wdXQuZm9jdXMoKTtcclxuICBpbnB1dC5zZWxlY3QoKTtcclxuXHJcbiAgY29uc3QgY29tbWl0ID0gYXN5bmMgKCkgPT4ge1xyXG4gICAgY29uc3QgdiA9IHBhcnNlRmxvYXQoaW5wdXQudmFsdWUpO1xyXG4gICAgaWYgKGlzTmFOKHYpIHx8IHYgPCAwLjEgfHwgdiA+IDUpIHtcclxuICAgICAgX3JlbmRlclJlY29TZWN0aW9uKCk7XHJcbiAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIGlmIChNYXRoLmFicyh2IC0gY3VycmVudFZhbCkgPCAwLjAwMSkge1xyXG4gICAgICBfcmVuZGVyUmVjb1NlY3Rpb24oKTtcclxuICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG4gICAgdHJ5IHtcclxuICAgICAgYXdhaXQgX3NhdmVNdWx0aXBsaWVyT3ZlcnJpZGUoc2t1VXBwZXIsIHYpO1xyXG4gICAgICBfcmVuZGVyUmVjb1NlY3Rpb24oKTtcclxuICAgIH0gY2F0Y2ggKGUpIHtcclxuICAgICAgYWxlcnQoJ0Vycm9yIGd1YXJkYW5kbzogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xyXG4gICAgICBfcmVuZGVyUmVjb1NlY3Rpb24oKTtcclxuICAgIH1cclxuICB9O1xyXG5cclxuICBjb25zdCBjYW5jZWwgPSAoKSA9PiBfcmVuZGVyUmVjb1NlY3Rpb24oKTtcclxuXHJcbiAgaW5wdXQuYWRkRXZlbnRMaXN0ZW5lcignYmx1cicsIGNvbW1pdCk7XHJcbiAgaW5wdXQuYWRkRXZlbnRMaXN0ZW5lcigna2V5ZG93bicsIChldikgPT4ge1xyXG4gICAgaWYgKGV2LmtleSA9PT0gJ0VudGVyJykge1xyXG4gICAgICBldi5wcmV2ZW50RGVmYXVsdCgpO1xyXG4gICAgICBpbnB1dC5ibHVyKCk7XHJcbiAgICB9IGVsc2UgaWYgKGV2LmtleSA9PT0gJ0VzY2FwZScpIHtcclxuICAgICAgZXYucHJldmVudERlZmF1bHQoKTtcclxuICAgICAgY2FuY2VsKCk7XHJcbiAgICB9XHJcbiAgfSk7XHJcbn07XHJcblxyXG53aW5kb3cucmVzZXRNdWx0aXBsaWVyID0gYXN5bmMgZnVuY3Rpb24gKHNrdVVwcGVyKSB7XHJcbiAgaWYgKCFjb25maXJtKCdWb2x2ZXIgZWwgbXVsdGlwbGljYWRvciBkZSAnICsgc2t1VXBwZXIgKyAnIGFsIGNcdTAwRTFsY3VsbyBhdXRvbVx1MDBFMXRpY28/JykpIHJldHVybjtcclxuICB0cnkge1xyXG4gICAgYXdhaXQgX3JlbW92ZU11bHRpcGxpZXJPdmVycmlkZShza3VVcHBlcik7XHJcbiAgICBfcmVuZGVyUmVjb1NlY3Rpb24oKTtcclxuICB9IGNhdGNoIChlKSB7XHJcbiAgICBhbGVydCgnRXJyb3I6ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcclxuICB9XHJcbn07XHJcblxyXG5mdW5jdGlvbiBfcmVuZGVyUmVjb1NlY3Rpb24oKSB7XHJcbiAgY29uc3QgY29udCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdyZWNvLXNlY3Rpb24tY29udGFpbmVyJyk7XHJcbiAgaWYgKCFjb250KSByZXR1cm47XHJcbiAgdHJ5IHtcclxuICAgIF9yZW5kZXJSZWNvU2VjdGlvbkltcGwoY29udCk7XHJcbiAgfSBjYXRjaCAoZSkge1xyXG4gICAgY29uc29sZS5lcnJvcignW0ZPUkVDQVNUIHJlY29dIHJlbmRlciBmYWlsJywgZSk7XHJcbiAgICBjb250LmlubmVySFRNTCA9XHJcbiAgICAgICc8ZGl2IHN0eWxlPVwicGFkZGluZzoyMHB4O2NvbG9yOiNkYzI2MjZcIj4nICtcclxuICAgICAgJzxkaXYgc3R5bGU9XCJmb250LXdlaWdodDo3MDA7bWFyZ2luLWJvdHRvbTo4cHhcIj5FcnJvciByZW5kZXJpemFuZG8gdGFibGEgcmVjb21lbmRhY2lcdTAwRjNuPC9kaXY+JyArXHJcbiAgICAgICc8cHJlIHN0eWxlPVwiZm9udC1zaXplOjExcHg7YmFja2dyb3VuZDojZmVmMmYyO3BhZGRpbmc6MTBweDtib3JkZXItcmFkaXVzOjZweDtvdmVyZmxvdzphdXRvO3doaXRlLXNwYWNlOnByZS13cmFwXCI+JyArXHJcbiAgICAgIGVzY2FwZUh0bWxTYWZlKGUuc3RhY2sgfHwgZS5tZXNzYWdlIHx8IFN0cmluZyhlKSkgK1xyXG4gICAgICAnPC9wcmU+PC9kaXY+JztcclxuICB9XHJcbn1cclxuXHJcbmZ1bmN0aW9uIF9yZW5kZXJSZWNvU2VjdGlvbkltcGwoY29udCkge1xyXG4gIGNvbnN0IGFueUxvYWRlZCA9ICEhKF9zYWxlc1BsYW5DYWNoZXMucm9kcyB8fCBfc2FsZXNQbGFuQ2FjaGVzLnJlZWxzKTtcclxuICBpZiAoIWFueUxvYWRlZCkge1xyXG4gICAgY29udC5pbm5lckhUTUwgPSAnJztcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgaWYgKCFfcmVjb1N0b2NrU25hcHNob3QgfHwgIV9yZWNvVmVudGFzU25hcHNob3QpIHtcclxuICAgIGNvbnQuaW5uZXJIVE1MID1cclxuICAgICAgJzxkaXYgc3R5bGU9XCJwYWRkaW5nOjQwcHggMThweDt0ZXh0LWFsaWduOmNlbnRlcjtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKVwiPicgK1xyXG4gICAgICAnPGRpdiBzdHlsZT1cImRpc3BsYXk6aW5saW5lLWJsb2NrO3dpZHRoOjI0cHg7aGVpZ2h0OjI0cHg7Ym9yZGVyOjNweCBzb2xpZCAjMGQ5NDg4O2JvcmRlci10b3AtY29sb3I6dHJhbnNwYXJlbnQ7Ym9yZGVyLXJhZGl1czo1MCU7YW5pbWF0aW9uOnNwaW4gMC44cyBsaW5lYXIgaW5maW5pdGU7bWFyZ2luLWJvdHRvbToxMHB4XCI+PC9kaXY+JyArXHJcbiAgICAgICc8ZGl2PkNhcmdhbmRvIHN0b2NrICsgdmVudGFzIGhpc3RcdTAwRjNyaWNhcy4uLjwvZGl2PicgK1xyXG4gICAgICAnPHN0eWxlPkBrZXlmcmFtZXMgc3Bpbnt0b3t0cmFuc2Zvcm06cm90YXRlKDM2MGRlZyl9fTwvc3R5bGU+PC9kaXY+JztcclxuICAgIF9sb2FkUmVjb0RhdGEoKVxyXG4gICAgICAudGhlbihfcmVuZGVyUmVjb1NlY3Rpb24pXHJcbiAgICAgIC5jYXRjaCgoZSkgPT4ge1xyXG4gICAgICAgIGNvbnNvbGUuZXJyb3IoJ1tGT1JFQ0FTVCByZWNvXSBsb2FkIGZhaWwnLCBlKTtcclxuICAgICAgICBjb250LmlubmVySFRNTCA9XHJcbiAgICAgICAgICAnPGRpdiBzdHlsZT1cInBhZGRpbmc6MjBweDtjb2xvcjojZGMyNjI2XCI+RXJyb3IgY2FyZ2FuZG8gZGF0b3M6ICcgK1xyXG4gICAgICAgICAgZXNjYXBlSHRtbFNhZmUoZS5tZXNzYWdlIHx8IFN0cmluZyhlKSkgK1xyXG4gICAgICAgICAgJzwvZGl2Pic7XHJcbiAgICAgIH0pO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuICBjb25zdCBhbGxSb3dzID0gX2NvbXB1dGVSZWNvbW1lbmRhdGlvbnMoKTtcclxuICBjb25zdCBzZWFyY2hMYyA9IF9yZWNvU2VhcmNoVGV4dC50cmltKCkudG9Mb3dlckNhc2UoKTtcclxuICBjb25zdCByb3dzID0gYWxsUm93cy5maWx0ZXIoKHIpID0+IHtcclxuICAgIGlmIChfcmVjb0ZpbHRlckZhbWlsaWEgIT09ICdhbGwnICYmIHIuZmFtaWxpYSAhPT0gX3JlY29GaWx0ZXJGYW1pbGlhKSByZXR1cm4gZmFsc2U7XHJcbiAgICBpZiAoX3JlY29GaWx0ZXJNaW5SZWMgJiYgci5yZWNvbWVuZGFkbyA8PSAwKSByZXR1cm4gZmFsc2U7XHJcbiAgICBpZiAoc2VhcmNoTGMpIHtcclxuICAgICAgY29uc3QgaGF5ID1cclxuICAgICAgICByLnNrdS50b0xvd2VyQ2FzZSgpLmluY2x1ZGVzKHNlYXJjaExjKSB8fCByLmRlc2NyaXB0aW9uLnRvTG93ZXJDYXNlKCkuaW5jbHVkZXMoc2VhcmNoTGMpO1xyXG4gICAgICBpZiAoIWhheSkgcmV0dXJuIGZhbHNlO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuIHRydWU7XHJcbiAgfSk7XHJcbiAgY29uc3QgdG90YWxSZWNvID0gYWxsUm93cy5yZWR1Y2UoKHMsIHIpID0+IHMgKyByLnJlY29tZW5kYWRvLCAwKTtcclxuICBjb25zdCB0b3RhbENvblJlY28gPSBhbGxSb3dzLmZpbHRlcigocikgPT4gci5yZWNvbWVuZGFkbyA+IDApLmxlbmd0aDtcclxuXHJcbiAgY29uc3QgbkRpc2MgPSBfZGlzY29udGludWVkU2t1cyA/IF9kaXNjb250aW51ZWRTa3VzLnNpemUgOiAwO1xyXG4gIGNvbnN0IGRpc2NDaGlwID1cclxuICAgIG5EaXNjID4gMFxyXG4gICAgICA/ICc8YnV0dG9uIG9uY2xpY2s9XCJvcGVuRGlzY29udGludWVkTW9kYWwoKVwiIHN0eWxlPVwicGFkZGluZzo2cHggMTJweDtiYWNrZ3JvdW5kOiM5MzMzZWE7Y29sb3I6I2ZmZjtib3JkZXI6bm9uZTtib3JkZXItcmFkaXVzOjZweDtmb250LXNpemU6MTJweDtmb250LXdlaWdodDo3MDA7Y3Vyc29yOnBvaW50ZXJcIiB0aXRsZT1cIkdlc3Rpb25hciBTS1VzIGRlc2NvbnRpbnVhZG9zXCI+XHVEODNEXHVERUFCICcgK1xyXG4gICAgICAgIF9mbXRJbnQobkRpc2MpICtcclxuICAgICAgICAnIGRlc2NvbnRpbnVhZG9zPC9idXR0b24+J1xyXG4gICAgICA6ICcnO1xyXG5cclxuICBjb25zdCBoZWFkZXIgPVxyXG4gICAgJzxkaXYgc3R5bGU9XCJkaXNwbGF5OmZsZXg7ZmxleC13cmFwOndyYXA7Z2FwOjEwcHg7YWxpZ24taXRlbXM6Y2VudGVyO21hcmdpbi1ib3R0b206MTJweFwiPicgK1xyXG4gICAgJzxkaXYgc3R5bGU9XCJmbGV4OjE7bWluLXdpZHRoOjI4MHB4XCI+PGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxOHB4O2ZvbnQtd2VpZ2h0OjgwMDtjb2xvcjp2YXIoLS10ZXh0LXByaW1hcnkpXCI+UmVjb21lbmRhY2lcdTAwRjNuIGRlIENvbXByYTwvZGl2PicgK1xyXG4gICAgJzxkaXYgc3R5bGU9XCJmb250LXNpemU6MTFweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTttYXJnaW4tdG9wOjJweFwiPkJhbGFuY2UgPSBTdG9jayArIFRyXHUwMEUxbnNpdG8gKyBQbGFuIFx1MjIxMiBCYWNrb3JkZXIgXHUyMjEyIChWZW50YSBtZW5zLiBcdTAwRDcgJyArXHJcbiAgICBSRUNPX0hPUklaT05fTU9OVEhTICtcclxuICAgICdtKTwvZGl2PjwvZGl2PicgK1xyXG4gICAgJzxkaXYgc3R5bGU9XCJwYWRkaW5nOjZweCAxMnB4O2JhY2tncm91bmQ6IzBkOTQ4ODtjb2xvcjojZmZmO2JvcmRlci1yYWRpdXM6NnB4O2ZvbnQtc2l6ZToxMnB4O2ZvbnQtd2VpZ2h0OjcwMFwiPicgK1xyXG4gICAgX2ZtdEludCh0b3RhbENvblJlY28pICtcclxuICAgICcgU0tVcyBjb24gcmVjbzwvZGl2PicgK1xyXG4gICAgJzxkaXYgc3R5bGU9XCJwYWRkaW5nOjZweCAxMnB4O2JhY2tncm91bmQ6IzEzNGU0YTtjb2xvcjojZmZmO2JvcmRlci1yYWRpdXM6NnB4O2ZvbnQtc2l6ZToxMnB4O2ZvbnQtd2VpZ2h0OjcwMFwiPlx1MDNBMyAnICtcclxuICAgIF9mbXRJbnQodG90YWxSZWNvKSArXHJcbiAgICAnIHVuaWRhZGVzPC9kaXY+JyArXHJcbiAgICBkaXNjQ2hpcCArXHJcbiAgICAnPC9kaXY+JztcclxuXHJcbiAgY29uc3QgZmlsdGVycyA9XHJcbiAgICAnPGRpdiBzdHlsZT1cImRpc3BsYXk6ZmxleDtmbGV4LXdyYXA6d3JhcDtnYXA6OHB4O21hcmdpbi1ib3R0b206MTBweDtwYWRkaW5nOjEwcHg7YmFja2dyb3VuZDp2YXIoLS1iZy1zZWNvbmRhcnkpO2JvcmRlci1yYWRpdXM6NnB4XCI+JyArXHJcbiAgICAnPGlucHV0IHR5cGU9XCJ0ZXh0XCIgaWQ9XCJyZWNvLXNlYXJjaFwiIHBsYWNlaG9sZGVyPVwiQnVzY2FyIFNLVSBvIGRlc2NyaXBjaW9uLi4uXCIgdmFsdWU9XCInICtcclxuICAgIGVzY2FwZUh0bWxTYWZlKF9yZWNvU2VhcmNoVGV4dCkgK1xyXG4gICAgJ1wiIG9uaW5wdXQ9XCJvblJlY29TZWFyY2hDaGFuZ2UoZXZlbnQpXCIgc3R5bGU9XCJmbGV4OjE7bWluLXdpZHRoOjIwMHB4O3BhZGRpbmc6NnB4IDEwcHg7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1ib3JkZXItc3VidGxlKTtib3JkZXItcmFkaXVzOjRweDtmb250LXNpemU6MTJweDtiYWNrZ3JvdW5kOnZhcigtLWJnLWVsZXZhdGVkKTtjb2xvcjp2YXIoLS10ZXh0LXByaW1hcnkpXCIvPicgK1xyXG4gICAgJzxzZWxlY3Qgb25jaGFuZ2U9XCJvblJlY29GYW1pbGlhQ2hhbmdlKGV2ZW50KVwiIHN0eWxlPVwicGFkZGluZzo2cHggMTBweDtib3JkZXI6MXB4IHNvbGlkIHZhcigtLWJvcmRlci1zdWJ0bGUpO2JvcmRlci1yYWRpdXM6NHB4O2ZvbnQtc2l6ZToxMnB4O2JhY2tncm91bmQ6dmFyKC0tYmctZWxldmF0ZWQpO2NvbG9yOnZhcigtLXRleHQtcHJpbWFyeSlcIj4nICtcclxuICAgICc8b3B0aW9uIHZhbHVlPVwiYWxsXCInICtcclxuICAgIChfcmVjb0ZpbHRlckZhbWlsaWEgPT09ICdhbGwnID8gJyBzZWxlY3RlZCcgOiAnJykgK1xyXG4gICAgJz5Ub2RhcyBsYXMgZmFtaWxpYXM8L29wdGlvbj4nICtcclxuICAgICc8b3B0aW9uIHZhbHVlPVwicm9kc1wiJyArXHJcbiAgICAoX3JlY29GaWx0ZXJGYW1pbGlhID09PSAncm9kcycgPyAnIHNlbGVjdGVkJyA6ICcnKSArXHJcbiAgICAnPlNvbG8gUm9kcyAoQ2FcdTAwRjFhcyk8L29wdGlvbj4nICtcclxuICAgICc8b3B0aW9uIHZhbHVlPVwicmVlbHNcIicgK1xyXG4gICAgKF9yZWNvRmlsdGVyRmFtaWxpYSA9PT0gJ3JlZWxzJyA/ICcgc2VsZWN0ZWQnIDogJycpICtcclxuICAgICc+U29sbyBSZWVsczwvb3B0aW9uPicgK1xyXG4gICAgJzwvc2VsZWN0PicgK1xyXG4gICAgJzxsYWJlbCBzdHlsZT1cImRpc3BsYXk6aW5saW5lLWZsZXg7YWxpZ24taXRlbXM6Y2VudGVyO2dhcDo2cHg7cGFkZGluZzo2cHggMTBweDtmb250LXNpemU6MTJweDtjb2xvcjp2YXIoLS10ZXh0LXByaW1hcnkpO2N1cnNvcjpwb2ludGVyXCI+JyArXHJcbiAgICAnPGlucHV0IHR5cGU9XCJjaGVja2JveFwiJyArXHJcbiAgICAoX3JlY29GaWx0ZXJNaW5SZWMgPyAnIGNoZWNrZWQnIDogJycpICtcclxuICAgICcgb25jaGFuZ2U9XCJvblJlY29GaWx0ZXJNaW5DaGFuZ2UoZXZlbnQpXCIvPicgK1xyXG4gICAgJ1NvbG8gY29uIHJlY29tZW5kYWRvICZndDsgMDwvbGFiZWw+JyArXHJcbiAgICAnPGJ1dHRvbiBvbmNsaWNrPVwiZXhwb3J0UmVjb0V4Y2VsKClcIiBzdHlsZT1cInBhZGRpbmc6NnB4IDEycHg7YmFja2dyb3VuZDojMTZhMzRhO2NvbG9yOiNmZmY7Ym9yZGVyOm5vbmU7Ym9yZGVyLXJhZGl1czo0cHg7Zm9udC1zaXplOjEycHg7Zm9udC13ZWlnaHQ6NzAwO2N1cnNvcjpwb2ludGVyXCI+XHUyQjA3IEV4Y2VsPC9idXR0b24+JyArXHJcbiAgICAnPC9kaXY+JztcclxuXHJcbiAgY29uc3Qgcm93c0h0bWwgPSByb3dzXHJcbiAgICAubWFwKChyKSA9PiB7XHJcbiAgICAgIGNvbnN0IGJhbENvbG9yID0gci5iYWxhbmNlIDwgMCA/ICcjZGMyNjI2JyA6IHIuYmFsYW5jZSA8IDUwID8gJyNmNTllMGInIDogJyMxNmEzNGEnO1xyXG4gICAgICBjb25zdCByZWNDb2xvciA9IHIucmVjb21lbmRhZG8gPiAwID8gJyNkYzI2MjYnIDogJyM5NGEzYjgnO1xyXG4gICAgICByZXR1cm4gKFxyXG4gICAgICAgICc8dHIgc3R5bGU9XCJib3JkZXItYm90dG9tOjFweCBzb2xpZCB2YXIoLS1ib3JkZXItc3VidGxlKVwiPicgK1xyXG4gICAgICAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjZweCA4cHg7dGV4dC1hbGlnbjpjZW50ZXJcIj48c3BhbiBzdHlsZT1cImRpc3BsYXk6aW5saW5lLWJsb2NrO3BhZGRpbmc6MnB4IDZweDtib3JkZXItcmFkaXVzOjEwcHg7YmFja2dyb3VuZDonICtcclxuICAgICAgICAoci5mYW1pbGlhID09PSAncm9kcycgPyAnIzBlYTVlOScgOiAnIzhiNWNmNicpICtcclxuICAgICAgICAnO2NvbG9yOiNmZmY7Zm9udC1zaXplOjEwcHg7Zm9udC13ZWlnaHQ6NzAwXCI+JyArXHJcbiAgICAgICAgKHIuZmFtaWxpYSA9PT0gJ3JvZHMnID8gJ1JPRCcgOiAnUkVFTCcpICtcclxuICAgICAgICAnPC9zcGFuPjwvdGQ+JyArXHJcbiAgICAgICAgJzx0ZCBzdHlsZT1cInBhZGRpbmc6NnB4IDhweDt0ZXh0LWFsaWduOmNlbnRlcjtmb250LWZhbWlseTptb25vc3BhY2U7Zm9udC1zaXplOjExcHg7Y29sb3I6dmFyKC0tdGV4dC1wcmltYXJ5KTtmb250LXdlaWdodDo3MDBcIj4nICtcclxuICAgICAgICBlc2NhcGVIdG1sU2FmZShyLnNrdSkgK1xyXG4gICAgICAgICc8L3RkPicgK1xyXG4gICAgICAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjZweCA4cHg7Zm9udC1zaXplOjExcHg7Y29sb3I6dmFyKC0tdGV4dC1zZWNvbmRhcnkpO21heC13aWR0aDoyNDBweDtvdmVyZmxvdzpoaWRkZW47dGV4dC1vdmVyZmxvdzplbGxpcHNpczt3aGl0ZS1zcGFjZTpub3dyYXBcIiB0aXRsZT1cIicgK1xyXG4gICAgICAgIGVzY2FwZUh0bWxTYWZlKHIuZGVzY3JpcHRpb24pICtcclxuICAgICAgICAnXCI+JyArXHJcbiAgICAgICAgZXNjYXBlSHRtbFNhZmUoci5kZXNjcmlwdGlvbikgK1xyXG4gICAgICAgICc8L3RkPicgK1xyXG4gICAgICAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjZweCA4cHg7dGV4dC1hbGlnbjpjZW50ZXI7Zm9udC12YXJpYW50LW51bWVyaWM6dGFidWxhci1udW1zO2NvbG9yOnZhcigtLXRleHQtcHJpbWFyeSlcIj4nICtcclxuICAgICAgICBfZm10SW50KHIuc3RvY2tMaWJyZSkgK1xyXG4gICAgICAgICc8L3RkPicgK1xyXG4gICAgICAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjZweCA4cHg7dGV4dC1hbGlnbjpjZW50ZXI7Zm9udC12YXJpYW50LW51bWVyaWM6dGFidWxhci1udW1zO2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpXCI+JyArXHJcbiAgICAgICAgX2ZtdEludChyLmVuVHJhbnNpdG8pICtcclxuICAgICAgICAnPC90ZD4nICtcclxuICAgICAgICAnPHRkIHN0eWxlPVwicGFkZGluZzo2cHggOHB4O3RleHQtYWxpZ246Y2VudGVyO2ZvbnQtdmFyaWFudC1udW1lcmljOnRhYnVsYXItbnVtcztjb2xvcjojZGMyNjI2XCI+JyArXHJcbiAgICAgICAgX2ZtdEludChyLmJhY2tvcmRlcikgK1xyXG4gICAgICAgICc8L3RkPicgK1xyXG4gICAgICAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjZweCA4cHg7dGV4dC1hbGlnbjpjZW50ZXI7Zm9udC12YXJpYW50LW51bWVyaWM6dGFidWxhci1udW1zO2NvbG9yOnZhcigtLXRleHQtc2Vjb25kYXJ5KVwiPicgK1xyXG4gICAgICAgIF9mbXRJbnQoci52ZW50YU1lbnN1YWwpICtcclxuICAgICAgICAnPC90ZD4nICtcclxuICAgICAgICAnPHRkIHN0eWxlPVwicGFkZGluZzo2cHggOHB4O3RleHQtYWxpZ246Y2VudGVyXCI+JyArXHJcbiAgICAgICAgX2J1aWxkTXVsdENlbGxIdG1sKHIpICtcclxuICAgICAgICAnPC90ZD4nICtcclxuICAgICAgICAnPHRkIHN0eWxlPVwicGFkZGluZzo2cHggOHB4O3RleHQtYWxpZ246Y2VudGVyO2ZvbnQtdmFyaWFudC1udW1lcmljOnRhYnVsYXItbnVtcztjb2xvcjp2YXIoLS10ZXh0LXNlY29uZGFyeSlcIj4nICtcclxuICAgICAgICBfZm10SW50KHIuZGVtYW5kYUVzcGVyYWRhKSArXHJcbiAgICAgICAgJzwvdGQ+JyArXHJcbiAgICAgICAgJzx0ZCBzdHlsZT1cInBhZGRpbmc6NnB4IDhweDt0ZXh0LWFsaWduOmNlbnRlcjtmb250LXZhcmlhbnQtbnVtZXJpYzp0YWJ1bGFyLW51bXM7Y29sb3I6dmFyKC0tdGV4dC1wcmltYXJ5KTtmb250LXdlaWdodDo2MDBcIj4nICtcclxuICAgICAgICBfZm10SW50KHIuc2FsZXNQbGFuRnV0KSArXHJcbiAgICAgICAgJzwvdGQ+JyArXHJcbiAgICAgICAgJzx0ZCBzdHlsZT1cInBhZGRpbmc6NnB4IDhweDt0ZXh0LWFsaWduOmNlbnRlcjtmb250LXZhcmlhbnQtbnVtZXJpYzp0YWJ1bGFyLW51bXM7Zm9udC13ZWlnaHQ6NzAwO2NvbG9yOicgK1xyXG4gICAgICAgIGJhbENvbG9yICtcclxuICAgICAgICAnXCI+JyArXHJcbiAgICAgICAgX2ZtdE51bVNpZ25lZChyLmJhbGFuY2UpICtcclxuICAgICAgICAnPC90ZD4nICtcclxuICAgICAgICAnPHRkIHN0eWxlPVwicGFkZGluZzo2cHggOHB4O3RleHQtYWxpZ246Y2VudGVyO2ZvbnQtdmFyaWFudC1udW1lcmljOnRhYnVsYXItbnVtcztjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTtmb250LXNpemU6MTFweFwiPicgK1xyXG4gICAgICAgIF9mbXRJbnQoci5tb3EpICtcclxuICAgICAgICAnPC90ZD4nICtcclxuICAgICAgICAnPHRkIHN0eWxlPVwicGFkZGluZzo2cHggOHB4O3RleHQtYWxpZ246Y2VudGVyXCI+PHNwYW4gc3R5bGU9XCJkaXNwbGF5OmlubGluZS1ibG9jaztwYWRkaW5nOjRweCAxMHB4O2JvcmRlci1yYWRpdXM6MTJweDtiYWNrZ3JvdW5kOicgK1xyXG4gICAgICAgIHJlY0NvbG9yICtcclxuICAgICAgICAnO2NvbG9yOiNmZmY7Zm9udC1zaXplOjEycHg7Zm9udC13ZWlnaHQ6ODAwO21pbi13aWR0aDo1MHB4XCI+JyArXHJcbiAgICAgICAgX2ZtdEludChyLnJlY29tZW5kYWRvKSArXHJcbiAgICAgICAgJzwvc3Bhbj48L3RkPicgK1xyXG4gICAgICAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjZweCA4cHg7dGV4dC1hbGlnbjpjZW50ZXJcIj4nICtcclxuICAgICAgICAnPGJ1dHRvbiBvbmNsaWNrPVwiZGlzY29udGludWVTa3UoXFwnJyArXHJcbiAgICAgICAgZXNjYXBlSHRtbFNhZmUoci5za3UpICtcclxuICAgICAgICBcIicsICdcIiArXHJcbiAgICAgICAgZXNjYXBlSHRtbFNhZmUoci5kZXNjcmlwdGlvbi5yZXBsYWNlKC8nL2csICcnKSkgK1xyXG4gICAgICAgICdcXCcpXCIgdGl0bGU9XCJEZXNjb250aW51YXIgZXN0ZSBTS1VcIiBzdHlsZT1cImJhY2tncm91bmQ6dHJhbnNwYXJlbnQ7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1ib3JkZXItc3VidGxlKTtib3JkZXItcmFkaXVzOjRweDtwYWRkaW5nOjRweCA4cHg7Y3Vyc29yOnBvaW50ZXI7Zm9udC1zaXplOjE0cHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZClcIj5cdUQ4M0RcdURERDE8L2J1dHRvbj4nICtcclxuICAgICAgICAnPC90ZD4nICtcclxuICAgICAgICAnPC90cj4nXHJcbiAgICAgICk7XHJcbiAgICB9KVxyXG4gICAgLmpvaW4oJycpO1xyXG5cclxuICAvLyB2MTExMjogbWluLXdpZHRoIHBhcmEgZm9yemFyIHNjcm9sbCBob3Jpem9udGFsIHNpIG5vIGNhYmUgbGEgY29sdW1uYVxyXG4gIC8vIEFjY2lcdTAwRjNuLiBTaW4gZXN0bywgdGFibGUgd2lkdGg6MTAwJSBjb21wcmltZSB0b2RvIHkgbGEgXHUwMEZBbHRpbWEgY29sdW1uYVxyXG4gIC8vIHF1ZWRhIGZ1ZXJhIGRlbCB2aWV3cG9ydCBzaW4gc2Nyb2xsIHZpc2libGUuXHJcbiAgY29uc3QgdGFibGUgPVxyXG4gICAgJzxkaXYgc3R5bGU9XCJvdmVyZmxvdzphdXRvO21heC1oZWlnaHQ6NjB2aDtib3JkZXI6MXB4IHNvbGlkIHZhcigtLWJvcmRlci1zdWJ0bGUpO2JvcmRlci1yYWRpdXM6OHB4XCI+JyArXHJcbiAgICAnPHRhYmxlIHN0eWxlPVwid2lkdGg6MTAwJTttaW4td2lkdGg6MTQwMHB4O2JvcmRlci1jb2xsYXBzZTpjb2xsYXBzZTtmb250LXNpemU6MTJweFwiPicgK1xyXG4gICAgJzx0aGVhZCBzdHlsZT1cImJhY2tncm91bmQ6IzBmMTcyYTtjb2xvcjojZmZmO3Bvc2l0aW9uOnN0aWNreTt0b3A6MDt6LWluZGV4OjFcIj48dHI+JyArXHJcbiAgICAnPHRoIHN0eWxlPVwicGFkZGluZzo4cHg7dGV4dC1hbGlnbjpjZW50ZXI7Zm9udC1zaXplOjEwcHg7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlXCI+RmFtPC90aD4nICtcclxuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjhweDt0ZXh0LWFsaWduOmNlbnRlcjtmb250LXNpemU6MTBweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2VcIj5TS1U8L3RoPicgK1xyXG4gICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6OHB4O3RleHQtYWxpZ246Y2VudGVyO2ZvbnQtc2l6ZToxMHB4O3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZVwiPkRlc2NyaXBjaVx1MDBGM248L3RoPicgK1xyXG4gICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6OHB4O3RleHQtYWxpZ246Y2VudGVyO2ZvbnQtc2l6ZToxMHB4O3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZVwiIHRpdGxlPVwiV2hzIDExIGRpc3BvbmlibGUgdmVudGFcIj5TdG9jazwvdGg+JyArXHJcbiAgICAnPHRoIHN0eWxlPVwicGFkZGluZzo4cHg7dGV4dC1hbGlnbjpjZW50ZXI7Zm9udC1zaXplOjEwcHg7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlXCIgdGl0bGU9XCJXaHMgMTJcIj5Uclx1MDBFMW5zaXRvPC90aD4nICtcclxuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjhweDt0ZXh0LWFsaWduOmNlbnRlcjtmb250LXNpemU6MTBweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2VcIj5CYWNrb3JkZXI8L3RoPicgK1xyXG4gICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6OHB4O3RleHQtYWxpZ246Y2VudGVyO2ZvbnQtc2l6ZToxMHB4O3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZVwiIHRpdGxlPVwiUHJvbWVkaW8gXHUwMEZBbHRpbW9zIDMgbWVzZXNcIj5WdGEvbWVzPC90aD4nICtcclxuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjhweDt0ZXh0LWFsaWduOmNlbnRlcjtmb250LXNpemU6MTBweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2VcIiB0aXRsZT1cIk11bHRpcGxpY2Fkb3IgZGUgdGVuZGVuY2lhID0gdmVudGEgMm0gLyB2ZW50YSA2bS4gRWRpdGFibGUgKGNsaWNrIHBhcmEgb3ZlcnJpZGUpLlwiPk11bHRpcC48L3RoPicgK1xyXG4gICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6OHB4O3RleHQtYWxpZ246Y2VudGVyO2ZvbnQtc2l6ZToxMHB4O3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZVwiIHRpdGxlPVwiVnRhL21lcyBcdTAwRDcgNyBtZXNlc1wiPkRlbWFuZGEgZXNwLjwvdGg+JyArXHJcbiAgICAnPHRoIHN0eWxlPVwicGFkZGluZzo4cHg7dGV4dC1hbGlnbjpjZW50ZXI7Zm9udC1zaXplOjEwcHg7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlXCIgdGl0bGU9XCJTdW1hIGNvbHVtbmFzIFNhbGVzIFBsYW4gZGVzZGUgbWVzIGFjdHVhbFwiPlBsYW4gZnV0dXJvPC90aD4nICtcclxuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjhweDt0ZXh0LWFsaWduOmNlbnRlcjtmb250LXNpemU6MTBweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2VcIj5CYWxhbmNlPC90aD4nICtcclxuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjhweDt0ZXh0LWFsaWduOmNlbnRlcjtmb250LXNpemU6MTBweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2VcIj5NT1E8L3RoPicgK1xyXG4gICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6OHB4O3RleHQtYWxpZ246Y2VudGVyO2ZvbnQtc2l6ZToxMHB4O3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtiYWNrZ3JvdW5kOiMxMzRlNGFcIj5SZWNvbWVuZGFkbzwvdGg+JyArXHJcbiAgICAnPHRoIHN0eWxlPVwicGFkZGluZzo4cHg7dGV4dC1hbGlnbjpjZW50ZXI7Zm9udC1zaXplOjEwcHg7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlXCIgdGl0bGU9XCJEZXNjb250aW51YXIgU0tVXCI+QWNjaVx1MDBGM248L3RoPicgK1xyXG4gICAgJzwvdHI+PC90aGVhZD48dGJvZHk+JyArXHJcbiAgICAocm93cy5sZW5ndGhcclxuICAgICAgPyByb3dzSHRtbFxyXG4gICAgICA6ICc8dHI+PHRkIGNvbHNwYW49XCIxNFwiIHN0eWxlPVwicGFkZGluZzo0MHB4O3RleHQtYWxpZ246Y2VudGVyO2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpXCI+U2luIHJlc3VsdGFkb3MgY29uIGxvcyBmaWx0cm9zIGFjdHVhbGVzPC90ZD48L3RyPicpICtcclxuICAgICc8L3Rib2R5PjwvdGFibGU+PC9kaXY+JztcclxuXHJcbiAgY29uc3QgZm9vdGVyID1cclxuICAgICc8ZGl2IHN0eWxlPVwibWFyZ2luLXRvcDo4cHg7Zm9udC1zaXplOjEwcHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZClcIj4nICtcclxuICAgICdNb3N0cmFuZG8gJyArXHJcbiAgICBfZm10SW50KHJvd3MubGVuZ3RoKSArXHJcbiAgICAnIGRlICcgK1xyXG4gICAgX2ZtdEludChhbGxSb3dzLmxlbmd0aCkgK1xyXG4gICAgJyBTS1VzIFx1MDBCNyAnICtcclxuICAgICdCYWxhbmNlID0gU3RvY2sgKyBUclx1MDBFMW5zaXRvICsgUGxhbiBcdTIyMTIgQmFja29yZGVyIFx1MjIxMiBEZW1hbmRhLiBSb2pvID0gcXVpZWJyZSBlc3BlcmFkby4gUmVjb21lbmRhZG8gc2UgcmVkb25kZWEgYWwgbVx1MDBGQWx0aXBsbyBkZSBNT1Egc3VwZXJpb3IuJyArXHJcbiAgICAnPC9kaXY+JztcclxuXHJcbiAgY29udC5pbm5lckhUTUwgPVxyXG4gICAgJzxkaXYgc3R5bGU9XCJwYWRkaW5nOjE4cHggMThweCAzMHB4XCI+JyArIGhlYWRlciArIGZpbHRlcnMgKyB0YWJsZSArIGZvb3RlciArICc8L2Rpdj4nO1xyXG59XHJcblxyXG53aW5kb3cub25SZWNvU2VhcmNoQ2hhbmdlID0gZnVuY3Rpb24gKGV2KSB7XHJcbiAgX3JlY29TZWFyY2hUZXh0ID0gZXYudGFyZ2V0LnZhbHVlIHx8ICcnO1xyXG4gIF9yZW5kZXJSZWNvU2VjdGlvbigpO1xyXG4gIC8vIFJlc3RhdXJhciBmb2N1cyArIGNhcmV0IGFsIGlucHV0XHJcbiAgc2V0VGltZW91dCgoKSA9PiB7XHJcbiAgICBjb25zdCBpbnAgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgncmVjby1zZWFyY2gnKTtcclxuICAgIGlmIChpbnApIHtcclxuICAgICAgaW5wLmZvY3VzKCk7XHJcbiAgICAgIGlucC5zZXRTZWxlY3Rpb25SYW5nZShpbnAudmFsdWUubGVuZ3RoLCBpbnAudmFsdWUubGVuZ3RoKTtcclxuICAgIH1cclxuICB9LCAwKTtcclxufTtcclxuXHJcbndpbmRvdy5vblJlY29GYW1pbGlhQ2hhbmdlID0gZnVuY3Rpb24gKGV2KSB7XHJcbiAgX3JlY29GaWx0ZXJGYW1pbGlhID0gZXYudGFyZ2V0LnZhbHVlIHx8ICdhbGwnO1xyXG4gIF9yZW5kZXJSZWNvU2VjdGlvbigpO1xyXG59O1xyXG5cclxud2luZG93Lm9uUmVjb0ZpbHRlck1pbkNoYW5nZSA9IGZ1bmN0aW9uIChldikge1xyXG4gIF9yZWNvRmlsdGVyTWluUmVjID0gISFldi50YXJnZXQuY2hlY2tlZDtcclxuICBfcmVuZGVyUmVjb1NlY3Rpb24oKTtcclxufTtcclxuXHJcbndpbmRvdy5leHBvcnRSZWNvRXhjZWwgPSBmdW5jdGlvbiAoKSB7XHJcbiAgaWYgKHR5cGVvZiBYTFNYID09PSAndW5kZWZpbmVkJykge1xyXG4gICAgYWxlcnQoJ1NoZWV0SlMgKFhMU1gpIG5vIGNhcmdhZG8nKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgY29uc3Qgcm93cyA9IF9jb21wdXRlUmVjb21tZW5kYXRpb25zKCk7XHJcbiAgY29uc3QgYW9hID0gW1xyXG4gICAgW1xyXG4gICAgICAnRmFtaWxpYScsXHJcbiAgICAgICdTS1UnLFxyXG4gICAgICAnRGVzY3JpcGNpXHUwMEYzbicsXHJcbiAgICAgICdTdG9jaycsXHJcbiAgICAgICdUclx1MDBFMW5zaXRvJyxcclxuICAgICAgJ0JhY2tvcmRlcicsXHJcbiAgICAgICdWdGEgcHJvbS9tZXMnLFxyXG4gICAgICAnTXVsdGlwbGljYWRvcicsXHJcbiAgICAgICdPcmlnZW4gbXVsdCcsXHJcbiAgICAgICdEZW1hbmRhIGVzcC4gN20nLFxyXG4gICAgICAnU2FsZXMgUGxhbiBmdXR1cm8nLFxyXG4gICAgICAnQmFsYW5jZScsXHJcbiAgICAgICdNT1EnLFxyXG4gICAgICAnUmVjb21lbmRhZG8nLFxyXG4gICAgXSxcclxuICBdO1xyXG4gIGZvciAoY29uc3QgciBvZiByb3dzKSB7XHJcbiAgICBhb2EucHVzaChbXHJcbiAgICAgIHIuZmFtaWxpYSA9PT0gJ3JvZHMnID8gJ1JvZHMgKENhXHUwMEYxYXMpJyA6ICdSZWVscycsXHJcbiAgICAgIHIuc2t1LFxyXG4gICAgICByLmRlc2NyaXB0aW9uLFxyXG4gICAgICByLnN0b2NrTGlicmUsXHJcbiAgICAgIHIuZW5UcmFuc2l0byxcclxuICAgICAgci5iYWNrb3JkZXIsXHJcbiAgICAgIHIudmVudGFNZW5zdWFsLFxyXG4gICAgICByLm11bHRpcGxpZXIsXHJcbiAgICAgIHIubXVsdFNvdXJjZSB8fCAnYXV0bycsXHJcbiAgICAgIHIuZGVtYW5kYUVzcGVyYWRhLFxyXG4gICAgICByLnNhbGVzUGxhbkZ1dCxcclxuICAgICAgci5iYWxhbmNlLFxyXG4gICAgICByLm1vcSxcclxuICAgICAgci5yZWNvbWVuZGFkbyxcclxuICAgIF0pO1xyXG4gIH1cclxuICBjb25zdCB3cyA9IFhMU1gudXRpbHMuYW9hX3RvX3NoZWV0KGFvYSk7XHJcbiAgd3NbJyFjb2xzJ10gPSBbXHJcbiAgICB7IHdjaDogMTQgfSwgLy8gRmFtaWxpYVxyXG4gICAgeyB3Y2g6IDE4IH0sIC8vIFNLVVxyXG4gICAgeyB3Y2g6IDQwIH0sIC8vIERlc2NyaXBjaVx1MDBGM25cclxuICAgIHsgd2NoOiA4IH0sIC8vIFN0b2NrXHJcbiAgICB7IHdjaDogMTAgfSwgLy8gVHJcdTAwRTFuc2l0b1xyXG4gICAgeyB3Y2g6IDExIH0sIC8vIEJhY2tvcmRlclxyXG4gICAgeyB3Y2g6IDEyIH0sIC8vIFZ0YSBwcm9tL21lc1xyXG4gICAgeyB3Y2g6IDEyIH0sIC8vIE11bHRpcGxpY2Fkb3JcclxuICAgIHsgd2NoOiAxMSB9LCAvLyBPcmlnZW4gbXVsdFxyXG4gICAgeyB3Y2g6IDE1IH0sIC8vIERlbWFuZGEgZXNwIDdtXHJcbiAgICB7IHdjaDogMTYgfSwgLy8gU2FsZXMgUGxhbiBmdXR1cm9cclxuICAgIHsgd2NoOiAxMCB9LCAvLyBCYWxhbmNlXHJcbiAgICB7IHdjaDogOCB9LCAvLyBNT1FcclxuICAgIHsgd2NoOiAxMiB9LCAvLyBSZWNvbWVuZGFkb1xyXG4gIF07XHJcbiAgY29uc3Qgd2IgPSBYTFNYLnV0aWxzLmJvb2tfbmV3KCk7XHJcbiAgWExTWC51dGlscy5ib29rX2FwcGVuZF9zaGVldCh3Yiwgd3MsICdSZWNvbWVuZGFjaVx1MDBGM24nKTtcclxuICBjb25zdCBob3kgPSBuZXcgRGF0ZSgpO1xyXG4gIGNvbnN0IHN0YW1wID1cclxuICAgIGhveS5nZXRGdWxsWWVhcigpICtcclxuICAgICctJyArXHJcbiAgICBTdHJpbmcoaG95LmdldE1vbnRoKCkgKyAxKS5wYWRTdGFydCgyLCAnMCcpICtcclxuICAgICctJyArXHJcbiAgICBTdHJpbmcoaG95LmdldERhdGUoKSkucGFkU3RhcnQoMiwgJzAnKTtcclxuICBYTFNYLndyaXRlRmlsZSh3YiwgJ1JlY29tZW5kYWNpb25fQ29tcHJhXycgKyBzdGFtcCArICcueGxzeCcpO1xyXG59O1xyXG5cclxuLy8gdjExMTIgRjNCOiBkZXNjb250aW51YXIgLyByZWFjdGl2YXIgU0tVcy5cclxud2luZG93LmRpc2NvbnRpbnVlU2t1ID0gYXN5bmMgZnVuY3Rpb24gKHNrdSwgZGVzY3JpcHRpb24pIHtcclxuICBpZiAoIV9kaXNjb250aW51ZWRTa3VzKSBfZGlzY29udGludWVkU2t1cyA9IG5ldyBTZXQoKTtcclxuICBjb25zdCB1cHBlciA9IFN0cmluZyhza3UpLnRyaW0oKS50b1VwcGVyQ2FzZSgpO1xyXG4gIGNvbnN0IGxhYmVsID0gZGVzY3JpcHRpb24gPyBza3UgKyAnIFx1MjAxNCAnICsgZGVzY3JpcHRpb24uc2xpY2UoMCwgNjApIDogc2t1O1xyXG4gIGlmIChcclxuICAgICFjb25maXJtKFxyXG4gICAgICAnRGVzY29udGludWFyICcgK1xyXG4gICAgICAgIGxhYmVsICtcclxuICAgICAgICAnP1xcblxcblF1ZWRhclx1MDBFMSBleGNsdWlkbyBkZWwgY1x1MDBFMWxjdWxvIGRlIHJlY29tZW5kYWNpXHUwMEYzbiBkZSBjb21wcmEgaGFzdGEgcXVlIGxvIHJlYWN0aXZlcyBkZXNkZSBlbCBjaGlwIFwiRGVzY29udGludWFkb3NcIi4nXHJcbiAgICApXHJcbiAgKSB7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIF9kaXNjb250aW51ZWRTa3VzLmFkZCh1cHBlcik7XHJcbiAgdHJ5IHtcclxuICAgIGF3YWl0IF9zYXZlRGlzY29udGludWVkU2t1cygpO1xyXG4gICAgX3JlbmRlclJlY29TZWN0aW9uKCk7XHJcbiAgfSBjYXRjaCAoZSkge1xyXG4gICAgX2Rpc2NvbnRpbnVlZFNrdXMuZGVsZXRlKHVwcGVyKTtcclxuICAgIGFsZXJ0KCdFcnJvciBndWFyZGFuZG86ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcclxuICB9XHJcbn07XHJcblxyXG53aW5kb3cucmVhY3RpdmF0ZVNrdSA9IGFzeW5jIGZ1bmN0aW9uIChza3UpIHtcclxuICBpZiAoIV9kaXNjb250aW51ZWRTa3VzKSByZXR1cm47XHJcbiAgY29uc3QgdXBwZXIgPSBTdHJpbmcoc2t1KS50cmltKCkudG9VcHBlckNhc2UoKTtcclxuICBfZGlzY29udGludWVkU2t1cy5kZWxldGUodXBwZXIpO1xyXG4gIHRyeSB7XHJcbiAgICBhd2FpdCBfc2F2ZURpc2NvbnRpbnVlZFNrdXMoKTtcclxuICAgIF9yZW5kZXJEaXNjb250aW51ZWRNb2RhbCgpO1xyXG4gICAgX3JlbmRlclJlY29TZWN0aW9uKCk7XHJcbiAgfSBjYXRjaCAoZSkge1xyXG4gICAgX2Rpc2NvbnRpbnVlZFNrdXMuYWRkKHVwcGVyKTtcclxuICAgIGFsZXJ0KCdFcnJvciBndWFyZGFuZG86ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcclxuICB9XHJcbn07XHJcblxyXG53aW5kb3cub3BlbkRpc2NvbnRpbnVlZE1vZGFsID0gZnVuY3Rpb24gKCkge1xyXG4gIGNvbnN0IGV4aXN0aW5nID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2Rpc2NvbnRpbnVlZC1za3VzLW1vZGFsJyk7XHJcbiAgaWYgKGV4aXN0aW5nKSBleGlzdGluZy5yZW1vdmUoKTtcclxuICBjb25zdCBlbCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpO1xyXG4gIGVsLmlkID0gJ2Rpc2NvbnRpbnVlZC1za3VzLW1vZGFsJztcclxuICBlbC5zdHlsZS5jc3NUZXh0ID1cclxuICAgICdwb3NpdGlvbjpmaXhlZDtpbnNldDowO2JhY2tncm91bmQ6cmdiYSgxNSwyMyw0MiwuNjUpO3otaW5kZXg6MjEwMDtkaXNwbGF5OmZsZXg7YWxpZ24taXRlbXM6Y2VudGVyO2p1c3RpZnktY29udGVudDpjZW50ZXI7cGFkZGluZzozdmgnO1xyXG4gIGVsLm9uY2xpY2sgPSAoZXYpID0+IHtcclxuICAgIGlmIChldi50YXJnZXQgPT09IGVsKSBlbC5yZW1vdmUoKTtcclxuICB9O1xyXG4gIGVsLmlubmVySFRNTCA9XHJcbiAgICAnPGRpdiBpZD1cImRpc2NvbnRpbnVlZC1tb2RhbC1jb250ZW50XCIgc3R5bGU9XCJiYWNrZ3JvdW5kOnZhcigtLWJnLWVsZXZhdGVkKTtib3JkZXItcmFkaXVzOjEycHg7cGFkZGluZzoyNHB4O21heC13aWR0aDo2NDBweDt3aWR0aDoxMDAlO21heC1oZWlnaHQ6OTB2aDtvdmVyZmxvdzphdXRvO2JveC1zaGFkb3c6MCAyMHB4IDYwcHggcmdiYSgwLDAsMCwuNClcIj48L2Rpdj4nO1xyXG4gIGRvY3VtZW50LmJvZHkuYXBwZW5kQ2hpbGQoZWwpO1xyXG4gIF9yZW5kZXJEaXNjb250aW51ZWRNb2RhbCgpO1xyXG59O1xyXG5cclxuZnVuY3Rpb24gX3JlbmRlckRpc2NvbnRpbnVlZE1vZGFsKCkge1xyXG4gIGNvbnN0IGNvbnQgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZGlzY29udGludWVkLW1vZGFsLWNvbnRlbnQnKTtcclxuICBpZiAoIWNvbnQpIHJldHVybjtcclxuICBjb25zdCBsaXN0ID0gX2Rpc2NvbnRpbnVlZFNrdXMgPyBBcnJheS5mcm9tKF9kaXNjb250aW51ZWRTa3VzKS5zb3J0KCkgOiBbXTtcclxuICAvLyBCdXNjYXIgZGVzY3JpcGNpXHUwMEYzbiBlbiBsb3Mgc2FsZXMgcGxhbnMgY2FjaGVzIHBvciBzaSBlc3RhIGNhcmdhZG9cclxuICBjb25zdCBza3VUb0Rlc2MgPSB7fTtcclxuICBmb3IgKGNvbnN0IGZhbSBvZiBbJ3JvZHMnLCAncmVlbHMnXSkge1xyXG4gICAgY29uc3QgY2FjaGUgPSBfc2FsZXNQbGFuQ2FjaGVzW2ZhbV07XHJcbiAgICBpZiAoY2FjaGUgJiYgY2FjaGUucm93cykge1xyXG4gICAgICBmb3IgKGNvbnN0IHIgb2YgY2FjaGUucm93cykge1xyXG4gICAgICAgIHNrdVRvRGVzY1tTdHJpbmcoci5za3UpLnRyaW0oKS50b1VwcGVyQ2FzZSgpXSA9IHIuZGVzY3JpcHRpb24gfHwgJyc7XHJcbiAgICAgIH1cclxuICAgIH1cclxuICB9XHJcbiAgY29uc3QgaGVhZCA9XHJcbiAgICAnPGRpdiBzdHlsZT1cImRpc3BsYXk6ZmxleDtqdXN0aWZ5LWNvbnRlbnQ6c3BhY2UtYmV0d2VlbjthbGlnbi1pdGVtczpjZW50ZXI7bWFyZ2luLWJvdHRvbToxNHB4XCI+JyArXHJcbiAgICAnPGRpdj48ZGl2IHN0eWxlPVwiZm9udC1zaXplOjE4cHg7Zm9udC13ZWlnaHQ6ODAwO2NvbG9yOnZhcigtLXRleHQtcHJpbWFyeSlcIj5TS1VzIGRlc2NvbnRpbnVhZG9zPC9kaXY+JyArXHJcbiAgICAnPGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMXB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO21hcmdpbi10b3A6MnB4XCI+JyArXHJcbiAgICBsaXN0Lmxlbmd0aCArXHJcbiAgICAnIFNLVXMgZXhjbHVpZG9zIGRlbCBjXHUwMEUxbGN1bG8gZGUgUmVjb21lbmRhY2lcdTAwRjNuIGRlIENvbXByYScgK1xyXG4gICAgJzwvZGl2PjwvZGl2PicgK1xyXG4gICAgJzxidXR0b24gb25jbGljaz1cImRvY3VtZW50LmdldEVsZW1lbnRCeUlkKFxcJ2Rpc2NvbnRpbnVlZC1za3VzLW1vZGFsXFwnKS5yZW1vdmUoKVwiIHN0eWxlPVwiYmFja2dyb3VuZDp0cmFuc3BhcmVudDtib3JkZXI6MXB4IHNvbGlkIHZhcigtLWJvcmRlci1zdWJ0bGUpO2JvcmRlci1yYWRpdXM6NnB4O3BhZGRpbmc6NnB4IDEycHg7Y3Vyc29yOnBvaW50ZXI7Zm9udC13ZWlnaHQ6NzAwXCI+Q2VycmFyPC9idXR0b24+JyArXHJcbiAgICAnPC9kaXY+JztcclxuICBjb25zdCBib2R5ID1cclxuICAgIGxpc3QubGVuZ3RoID09PSAwXHJcbiAgICAgID8gJzxkaXYgc3R5bGU9XCJwYWRkaW5nOjQwcHg7dGV4dC1hbGlnbjpjZW50ZXI7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZClcIj5ObyBoYXkgU0tVcyBkZXNjb250aW51YWRvcy48YnI+PGJyPlBvZFx1MDBFOXMgZGVzY29udGludWFyIFNLVXMgZGVzZGUgZWwgYm90XHUwMEYzbiBcdUQ4M0RcdURERDEgZW4gY2FkYSBmaWxhIGRlIGxhIHRhYmxhIFJlY29tZW5kYWNpXHUwMEYzbiBkZSBDb21wcmEuPC9kaXY+J1xyXG4gICAgICA6ICc8ZGl2IHN0eWxlPVwiZGlzcGxheTpmbGV4O2ZsZXgtZGlyZWN0aW9uOmNvbHVtbjtnYXA6NnB4XCI+JyArXHJcbiAgICAgICAgbGlzdFxyXG4gICAgICAgICAgLm1hcCgoc2t1KSA9PiB7XHJcbiAgICAgICAgICAgIGNvbnN0IGRlc2MgPSBza3VUb0Rlc2Nbc2t1XSB8fCAnJztcclxuICAgICAgICAgICAgcmV0dXJuIChcclxuICAgICAgICAgICAgICAnPGRpdiBzdHlsZT1cImRpc3BsYXk6ZmxleDthbGlnbi1pdGVtczpjZW50ZXI7Z2FwOjEwcHg7cGFkZGluZzoxMHB4IDEycHg7YmFja2dyb3VuZDp2YXIoLS1iZy1zZWNvbmRhcnkpO2JvcmRlci1yYWRpdXM6NnB4XCI+JyArXHJcbiAgICAgICAgICAgICAgJzxkaXYgc3R5bGU9XCJmbGV4OjFcIj48ZGl2IHN0eWxlPVwiZm9udC1mYW1pbHk6bW9ub3NwYWNlO2ZvbnQtd2VpZ2h0OjcwMDtjb2xvcjp2YXIoLS10ZXh0LXByaW1hcnkpXCI+JyArXHJcbiAgICAgICAgICAgICAgZXNjYXBlSHRtbFNhZmUoc2t1KSArXHJcbiAgICAgICAgICAgICAgJzwvZGl2PicgK1xyXG4gICAgICAgICAgICAgIChkZXNjXHJcbiAgICAgICAgICAgICAgICA/ICc8ZGl2IHN0eWxlPVwiZm9udC1zaXplOjExcHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7bWFyZ2luLXRvcDoycHhcIj4nICtcclxuICAgICAgICAgICAgICAgICAgZXNjYXBlSHRtbFNhZmUoZGVzYykgK1xyXG4gICAgICAgICAgICAgICAgICAnPC9kaXY+J1xyXG4gICAgICAgICAgICAgICAgOiAnJykgK1xyXG4gICAgICAgICAgICAgICc8L2Rpdj4nICtcclxuICAgICAgICAgICAgICAnPGJ1dHRvbiBvbmNsaWNrPVwicmVhY3RpdmF0ZVNrdShcXCcnICtcclxuICAgICAgICAgICAgICBlc2NhcGVIdG1sU2FmZShza3UpICtcclxuICAgICAgICAgICAgICAnXFwnKVwiIHN0eWxlPVwicGFkZGluZzo2cHggMTJweDtiYWNrZ3JvdW5kOiMxNmEzNGE7Y29sb3I6I2ZmZjtib3JkZXI6bm9uZTtib3JkZXItcmFkaXVzOjRweDtmb250LXNpemU6MTFweDtmb250LXdlaWdodDo3MDA7Y3Vyc29yOnBvaW50ZXJcIj5cdTIxQkIgUmVhY3RpdmFyPC9idXR0b24+JyArXHJcbiAgICAgICAgICAgICAgJzwvZGl2PidcclxuICAgICAgICAgICAgKTtcclxuICAgICAgICAgIH0pXHJcbiAgICAgICAgICAuam9pbignJykgK1xyXG4gICAgICAgICc8L2Rpdj4nO1xyXG4gIGNvbnQuaW5uZXJIVE1MID0gaGVhZCArIGJvZHk7XHJcbn1cclxuIl0sCiAgIm1hcHBpbmdzIjogIjs7O0FBWUEsTUFBTSxnQkFBZ0I7QUFBQSxJQUNwQixLQUFLO0FBQUEsSUFDTCxTQUFTO0FBQUEsSUFDVCxLQUFLO0FBQUEsSUFDTCxPQUFPO0FBQUEsSUFDUCxLQUFLO0FBQUEsSUFDTCxVQUFVO0FBQUEsSUFDVixTQUFTO0FBQUEsSUFDVCxLQUFLO0FBQUEsSUFDTCxPQUFPO0FBQUEsSUFDUCxPQUFPO0FBQUEsSUFDUCxLQUFLO0FBQUEsSUFDTCxPQUFPO0FBQUEsSUFDUCxLQUFLO0FBQUEsSUFDTCxPQUFPO0FBQUEsSUFDUCxLQUFLO0FBQUEsSUFDTCxNQUFNO0FBQUEsSUFDTixLQUFLO0FBQUEsSUFDTCxNQUFNO0FBQUEsSUFDTixPQUFPO0FBQUEsSUFDUCxLQUFLO0FBQUEsSUFDTCxNQUFNO0FBQUEsSUFDTixPQUFPO0FBQUEsSUFDUCxLQUFLO0FBQUEsSUFDTCxRQUFRO0FBQUEsSUFDUixLQUFLO0FBQUEsSUFDTCxRQUFRO0FBQUEsSUFDUixLQUFLO0FBQUEsSUFDTCxNQUFNO0FBQUEsSUFDTixXQUFXO0FBQUEsSUFDWCxZQUFZO0FBQUEsSUFDWixLQUFLO0FBQUEsSUFDTCxTQUFTO0FBQUEsSUFDVCxTQUFTO0FBQUEsSUFDVCxLQUFLO0FBQUEsSUFDTCxVQUFVO0FBQUEsSUFDVixXQUFXO0FBQUEsSUFDWCxLQUFLO0FBQUEsSUFDTCxVQUFVO0FBQUEsSUFDVixLQUFLO0FBQUEsSUFDTCxXQUFXO0FBQUEsRUFDYjtBQUtBLFdBQVMsb0JBQW9CLE9BQU87QUFDbEMsUUFBSSxTQUFTLEtBQU0sUUFBTztBQUsxQixVQUFNLElBQUksT0FBTyxLQUFLLEVBQUUsUUFBUSxRQUFRLEdBQUcsRUFBRSxLQUFLLEVBQUUsWUFBWTtBQUNoRSxRQUFJLENBQUMsRUFBRyxRQUFPO0FBQ2YsUUFBSTtBQUVKLFFBQUksRUFBRSxNQUFNLHlDQUF5QztBQUNyRCxRQUFJLEdBQUc7QUFDTCxZQUFNLE1BQU0sY0FBYyxFQUFFLENBQUMsQ0FBQyxLQUFLLGNBQWMsRUFBRSxDQUFDLEVBQUUsTUFBTSxHQUFHLENBQUMsQ0FBQztBQUNqRSxVQUFJLEtBQUs7QUFDUCxZQUFJLElBQUksU0FBUyxFQUFFLENBQUMsR0FBRyxFQUFFO0FBQ3pCLFlBQUksSUFBSSxJQUFLLEtBQUksTUFBTztBQUN4QixlQUFPLE9BQU8sQ0FBQyxFQUFFLFNBQVMsR0FBRyxHQUFHLElBQUksTUFBTSxPQUFPLEdBQUcsRUFBRSxTQUFTLEdBQUcsR0FBRztBQUFBLE1BQ3ZFO0FBQUEsSUFDRjtBQUdBLFFBQUksRUFBRSxNQUFNLHVDQUF1QztBQUNuRCxRQUFJLEdBQUc7QUFDTCxZQUFNLElBQUksU0FBUyxFQUFFLENBQUMsR0FBRyxFQUFFO0FBQzNCLFlBQU0sTUFBTSxjQUFjLEVBQUUsQ0FBQyxDQUFDLEtBQUssY0FBYyxFQUFFLENBQUMsRUFBRSxNQUFNLEdBQUcsQ0FBQyxDQUFDO0FBQ2pFLFVBQUksSUFBSyxRQUFPLE9BQU8sQ0FBQyxFQUFFLFNBQVMsR0FBRyxHQUFHLElBQUksTUFBTSxPQUFPLEdBQUcsRUFBRSxTQUFTLEdBQUcsR0FBRztBQUFBLElBQ2hGO0FBRUEsUUFBSSxFQUFFLE1BQU0sd0JBQXdCO0FBQ3BDLFFBQUksR0FBRztBQUNMLFlBQU0sSUFBSSxTQUFTLEVBQUUsQ0FBQyxHQUFHLEVBQUU7QUFDM0IsWUFBTSxNQUFNLFNBQVMsRUFBRSxDQUFDLEdBQUcsRUFBRTtBQUM3QixVQUFJLE9BQU8sS0FBSyxPQUFPO0FBQ3JCLGVBQU8sT0FBTyxDQUFDLEVBQUUsU0FBUyxHQUFHLEdBQUcsSUFBSSxNQUFNLE9BQU8sR0FBRyxFQUFFLFNBQVMsR0FBRyxHQUFHO0FBQUEsSUFDekU7QUFFQSxRQUFJLEVBQUUsTUFBTSx3QkFBd0I7QUFDcEMsUUFBSSxHQUFHO0FBQ0wsWUFBTSxNQUFNLFNBQVMsRUFBRSxDQUFDLEdBQUcsRUFBRTtBQUM3QixZQUFNLElBQUksU0FBUyxFQUFFLENBQUMsR0FBRyxFQUFFO0FBQzNCLFVBQUksT0FBTyxLQUFLLE9BQU87QUFDckIsZUFBTyxPQUFPLENBQUMsRUFBRSxTQUFTLEdBQUcsR0FBRyxJQUFJLE1BQU0sT0FBTyxHQUFHLEVBQUUsU0FBUyxHQUFHLEdBQUc7QUFBQSxJQUN6RTtBQUNBLFdBQU87QUFBQSxFQUNUO0FBR0EsV0FBUyxjQUFjLE1BQU07QUFDM0IsVUFBTSxpQkFBaUI7QUFBQSxNQUNyQjtBQUFBLE1BQ0E7QUFBQSxNQUNBO0FBQUEsTUFDQTtBQUFBLE1BQ0E7QUFBQSxNQUNBO0FBQUEsTUFDQTtBQUFBLE1BQ0E7QUFBQSxNQUNBO0FBQUEsSUFDRjtBQUNBLGFBQVMsSUFBSSxHQUFHLElBQUksS0FBSyxJQUFJLEtBQUssUUFBUSxFQUFFLEdBQUcsS0FBSztBQUNsRCxZQUFNLE1BQU0sS0FBSyxDQUFDLEtBQUssQ0FBQztBQUN4QixpQkFBVyxRQUFRLEtBQUs7QUFHdEIsY0FBTSxJQUFJLE9BQU8sUUFBUSxPQUFPLEtBQUssSUFBSSxFQUN0QyxRQUFRLFFBQVEsR0FBRyxFQUNuQixLQUFLLEVBQ0wsWUFBWTtBQUNmLFlBQUksZUFBZSxRQUFRLENBQUMsS0FBSyxFQUFHLFFBQU87QUFBQSxNQUM3QztBQUFBLElBQ0Y7QUFDQSxXQUFPO0FBQUEsRUFDVDtBQUlBLFdBQVMsY0FBYyxXQUFXLGNBQWM7QUFDOUMsUUFBSSxTQUFTO0FBQ2IsUUFBSSxVQUFVO0FBQ2QsUUFBSSxTQUFTO0FBQ2IsVUFBTSxlQUFlLENBQUM7QUFDdEIsVUFBTSxvQkFBb0Isb0JBQUksSUFBSTtBQUNsQyxhQUFTLElBQUksR0FBRyxJQUFJLFVBQVUsUUFBUSxLQUFLO0FBR3pDLFlBQU0sTUFBTSxPQUFPLFVBQVUsQ0FBQyxLQUFLLE9BQU8sS0FBSyxVQUFVLENBQUMsQ0FBQyxFQUN4RCxRQUFRLFFBQVEsR0FBRyxFQUNuQixLQUFLO0FBQ1IsWUFBTSxJQUFJLElBQUksWUFBWTtBQUMxQixVQUNFLFNBQVMsTUFDUixNQUFNLHNCQUNMLE1BQU0sY0FDTixNQUFNLFNBQ04sTUFBTSxhQUNOLE1BQU0saUJBQ04sTUFBTSxjQUNOLE1BQU0sZUFDTixNQUFNLFlBQ04sTUFBTSxjQUNSO0FBQ0EsaUJBQVM7QUFDVDtBQUFBLE1BQ0Y7QUFDQSxVQUNFLFVBQVUsTUFDVCxNQUFNLGlCQUNMLE1BQU0saUJBQ04sTUFBTSxvQkFDTixNQUFNLGVBQ04sTUFBTSxhQUNSO0FBQ0Esa0JBQVU7QUFDVjtBQUFBLE1BQ0Y7QUFDQSxVQUFJLFNBQVMsTUFBTSxNQUFNLG1CQUFtQixNQUFNLFNBQVMsRUFBRSxRQUFRLEtBQUssTUFBTSxJQUFJO0FBQ2xGLGlCQUFTO0FBQ1Q7QUFBQSxNQUNGO0FBRUEsVUFBSSxXQUFXLG9CQUFvQixHQUFHO0FBQ3RDLFVBQUksQ0FBQyxZQUFZLGdCQUFnQixhQUFhLENBQUMsS0FBSyxNQUFNO0FBQ3hELGNBQU0sT0FBTyxPQUFPLGFBQWEsQ0FBQyxDQUFDLEVBQUUsS0FBSztBQUMxQyxZQUFJLE1BQU07QUFDUixxQkFBVyxvQkFBb0IsTUFBTSxNQUFNLElBQUksS0FBSyxvQkFBb0IsT0FBTyxNQUFNLEdBQUc7QUFBQSxRQUMxRjtBQUFBLE1BQ0Y7QUFDQSxVQUFJLFVBQVU7QUFDWixxQkFBYSxLQUFLLEVBQUUsUUFBUSxHQUFHLFNBQVMsQ0FBQztBQUN6QywwQkFBa0IsSUFBSSxRQUFRO0FBQUEsTUFDaEM7QUFBQSxJQUNGO0FBQ0EsV0FBTztBQUFBLE1BQ0w7QUFBQSxNQUNBO0FBQUEsTUFDQTtBQUFBLE1BQ0E7QUFBQSxNQUNBLGdCQUFnQixNQUFNLEtBQUssaUJBQWlCLEVBQUUsS0FBSztBQUFBLElBQ3JEO0FBQUEsRUFDRjtBQUdBLFdBQVMsb0JBQW9CLE1BQU07QUFDakMsUUFBSSxDQUFDLFFBQVEsQ0FBQyxLQUFLLFFBQVE7QUFDekIsWUFBTSxNQUFNLElBQUksTUFBTSxhQUFhO0FBQ25DLFVBQUksT0FBTztBQUNYLFlBQU07QUFBQSxJQUNSO0FBQ0EsVUFBTSxZQUFZLGNBQWMsSUFBSTtBQUNwQyxRQUFJLFlBQVksR0FBRztBQUNqQixZQUFNLE1BQU0sSUFBSSxNQUFNLHFFQUFxRTtBQUMzRixVQUFJLE9BQU87QUFDWCxZQUFNO0FBQUEsSUFDUjtBQUNBLFVBQU0sWUFBWSxLQUFLLFNBQVMsS0FBSyxDQUFDO0FBQ3RDLFVBQU0sV0FBVyxZQUFZLElBQUksS0FBSyxZQUFZLENBQUMsS0FBSyxDQUFDLElBQUk7QUFDN0QsVUFBTSxPQUFPLGNBQWMsV0FBVyxRQUFRO0FBQzlDLFFBQUksS0FBSyxTQUFTLEdBQUc7QUFDbkIsWUFBTSxNQUFNLElBQUksTUFBTSw4Q0FBOEM7QUFDcEUsVUFBSSxPQUFPO0FBQ1gsWUFBTTtBQUFBLElBQ1I7QUFDQSxRQUFJLENBQUMsS0FBSyxhQUFhLFFBQVE7QUFDN0IsWUFBTSxNQUFNLElBQUk7QUFBQSxRQUNkO0FBQUEsTUFDRjtBQUNBLFVBQUksT0FBTztBQUNYLFlBQU07QUFBQSxJQUNSO0FBQ0EsVUFBTSxhQUFhLENBQUM7QUFDcEIsVUFBTSxVQUFVLG9CQUFJLElBQUk7QUFDeEIsYUFBUyxJQUFJLFlBQVksR0FBRyxJQUFJLEtBQUssUUFBUSxLQUFLO0FBQ2hELFlBQU0sTUFBTSxLQUFLLENBQUMsS0FBSyxDQUFDO0FBQ3hCLFlBQU0sU0FBUyxJQUFJLEtBQUssTUFBTTtBQUM5QixVQUFJLFVBQVUsUUFBUSxPQUFPLE1BQU0sRUFBRSxLQUFLLE1BQU0sR0FBSTtBQUNwRCxZQUFNLE1BQU0sT0FBTyxNQUFNLEVBQUUsS0FBSztBQUNoQyxZQUFNLFFBQVEsSUFBSSxZQUFZO0FBRTlCLFVBQUksVUFBVSxXQUFXLFVBQVUsU0FBUyxVQUFVLGNBQWMsVUFBVTtBQUM1RTtBQUNGLFVBQUksUUFBUSxJQUFJLEtBQUssRUFBRztBQUN4QixjQUFRLElBQUksS0FBSztBQUNqQixZQUFNLGNBQ0osS0FBSyxXQUFXLElBQUksT0FBTyxJQUFJLEtBQUssT0FBTyxLQUFLLE9BQU8sS0FBSyxJQUFJLEtBQUssT0FBTyxDQUFDLEVBQUUsS0FBSyxJQUFJO0FBQzFGLFlBQU0sU0FBUyxLQUFLLFVBQVUsSUFBSSxJQUFJLEtBQUssTUFBTSxJQUFJO0FBQ3JELFlBQU0sU0FBUyxPQUFPLE1BQU07QUFDNUIsWUFBTSxNQUFNLE9BQU8sU0FBUyxNQUFNLEtBQUssU0FBUyxJQUFJLEtBQUssTUFBTSxNQUFNLElBQUk7QUFDekUsWUFBTSxTQUFTLENBQUM7QUFDaEIsaUJBQVcsTUFBTSxLQUFLLGNBQWM7QUFDbEMsY0FBTSxJQUFJLElBQUksR0FBRyxNQUFNO0FBQ3ZCLGNBQU0sSUFBSSxPQUFPLENBQUM7QUFDbEIsWUFBSSxPQUFPLFNBQVMsQ0FBQyxLQUFLLElBQUksR0FBRztBQUMvQixpQkFBTyxHQUFHLFFBQVEsSUFBSSxLQUFLLE1BQU0sQ0FBQztBQUFBLFFBQ3BDO0FBQUEsTUFDRjtBQUNBLGlCQUFXLEtBQUssRUFBRSxLQUFLLGFBQWEsS0FBSyxPQUFPLENBQUM7QUFBQSxJQUNuRDtBQUNBLFdBQU87QUFBQSxNQUNMLGdCQUFnQjtBQUFBLE1BQ2hCLGdCQUFnQixLQUFLO0FBQUEsTUFDckIsV0FBVyxXQUFXO0FBQUEsTUFDdEIsTUFBTTtBQUFBLElBQ1I7QUFBQSxFQUNGO0FBR0EsTUFBSSxPQUFPLFdBQVcsZUFBZSxPQUFPLFNBQVM7QUFDbkQsV0FBTyxVQUFVLEVBQUUscUJBQXFCLHFCQUFxQixlQUFlLGNBQWM7QUFBQSxFQUM1RjtBQUNBLE1BQUksT0FBTyxXQUFXLGFBQWE7QUFDakMsV0FBTyxrQkFBa0I7QUFBQSxNQUN2QjtBQUFBLE1BQ0E7QUFBQSxNQUNBO0FBQUEsTUFDQTtBQUFBLElBQ0Y7QUFBQSxFQUNGOzs7QUN4UEEsTUFBTSxzQkFBc0I7QUFBQSxJQUMxQixFQUFFLEtBQUssUUFBUSxPQUFPLG1CQUFnQixPQUFPLFVBQVU7QUFBQSxJQUN2RCxFQUFFLEtBQUssU0FBUyxPQUFPLFNBQVMsT0FBTyxVQUFVO0FBQUEsRUFDbkQ7QUFDQSxNQUFNLG1CQUFtQixFQUFFLE1BQU0sTUFBTSxPQUFPLEtBQUs7QUFDbkQsTUFBSSxxQkFBcUI7QUFLekIsTUFBSSxvQkFBb0I7QUFDeEIsTUFBSSxvQkFBb0I7QUFLeEIsTUFBSSxxQkFBcUI7QUFDekIsTUFBSSxzQkFBc0I7QUFDMUIsTUFBSSxvQkFBb0I7QUFDeEIsTUFBSSxxQkFBcUI7QUFDekIsTUFBSSxrQkFBa0I7QUFJdEIsTUFBSSxvQkFBb0I7QUFDeEIsTUFBSSxvQkFBb0I7QUFLeEIsTUFBSSx1QkFBdUI7QUFDM0IsTUFBTSwwQkFBMEI7QUFDaEMsTUFBTSw0QkFBNEI7QUFDbEMsTUFBTSxnQkFBZ0I7QUFDdEIsTUFBTSxnQkFBZ0I7QUFDdEIsTUFBTSx5QkFBeUI7QUFFL0IsTUFBTSxzQkFBc0I7QUFDNUIsTUFBTSw2QkFBNkI7QUFNbkMsTUFBTSwwQkFBMEIsQ0FBQyxpQ0FBaUMseUJBQXlCO0FBRTNGLFdBQVMsZUFBZTtBQUN0QixRQUFJO0FBQ0YsWUFBTSxTQUFVLE9BQU8sZUFBZSxPQUFPLFlBQVksU0FBVSxJQUFJLFlBQVk7QUFDbkYsVUFBSSxDQUFDLE1BQU8sUUFBTztBQUNuQixhQUFPLHdCQUF3QixRQUFRLEtBQUssS0FBSztBQUFBLElBQ25ELFFBQVE7QUFDTixhQUFPO0FBQUEsSUFDVDtBQUFBLEVBQ0Y7QUFFQSxXQUFTLG9CQUFvQjtBQUMzQixVQUFNLFdBQVcsU0FBUyxlQUFlLGdCQUFnQjtBQUN6RCxRQUFJLFNBQVUsUUFBTztBQUNyQixVQUFNLEtBQUssU0FBUyxjQUFjLEtBQUs7QUFDdkMsT0FBRyxLQUFLO0FBQ1IsT0FBRyxZQUFZO0FBQ2YsT0FBRyxNQUFNLFVBQ1A7QUFDRixPQUFHLFVBQVUsU0FBVSxJQUFJO0FBQ3pCLFVBQUksR0FBRyxXQUFXLEdBQUksUUFBTyxtQkFBbUI7QUFBQSxJQUNsRDtBQUlBLFVBQU0sWUFBWSxnQkFBZ0I7QUFDbEMsT0FBRyxZQUFZO0FBQ2YsYUFBUyxLQUFLLFlBQVksRUFBRTtBQUM1QixXQUFPO0FBQUEsRUFDVDtBQUVBLFdBQVMsa0JBQWtCO0FBRXpCLFVBQU0sYUFDSjtBQUNGLFVBQU0sU0FDSjtBQVFGLFVBQU0sVUFDSjtBQUlGLFVBQU0sZ0JBQWdCO0FBQ3RCLFVBQU0sVUFBVTtBQUNoQixXQUFPLGFBQWEsU0FBUyxVQUFVLGdCQUFnQixVQUFVO0FBQUEsRUFDbkU7QUFJQSxTQUFPLG9CQUFvQixTQUFVLE9BQU87QUFDMUMseUJBQXFCO0FBQ3JCLFVBQU0sS0FBSyxTQUFTLGVBQWUsMEJBQTBCO0FBQzdELFVBQU0sS0FBSyxTQUFTLGVBQWUsbUJBQW1CO0FBQ3RELFFBQUksR0FBSSxJQUFHLE1BQU0sVUFBVSxVQUFVLGdCQUFnQixVQUFVO0FBQy9ELFFBQUksR0FBSSxJQUFHLE1BQU0sVUFBVSxVQUFVLFNBQVMsVUFBVTtBQUN4RCxVQUFNLE9BQU8sU0FBUyxpQkFBaUIsa0NBQWtDO0FBQ3pFLFNBQUssUUFBUSxDQUFDLE1BQU07QUFDbEIsWUFBTSxTQUFTLEVBQUUsYUFBYSxVQUFVLE1BQU07QUFDOUMsUUFBRSxNQUFNLFFBQVEsU0FBUyx3QkFBd0I7QUFDakQsUUFBRSxNQUFNLG9CQUFvQixTQUFTLFlBQVk7QUFDakQsUUFBRSxNQUFNLGFBQWEsU0FBUyxRQUFRO0FBQUEsSUFDeEMsQ0FBQztBQUdELFFBQUksVUFBVSxRQUFRO0FBQ3BCLFlBQU0sT0FBTyxTQUFTLGVBQWUsbUJBQW1CO0FBQ3hELFVBQUksTUFBTTtBQUNSLFlBQUksbUJBQW1CO0FBRXJCLGlDQUF1QjtBQUFBLFFBQ3pCLE9BQU87QUFFTCxlQUFLLFlBQ0g7QUFLRiw4QkFBb0IsRUFDakIsS0FBSyxzQkFBc0IsRUFDM0IsTUFBTSxDQUFDLE1BQU07QUFDWixvQkFBUSxNQUFNLDZCQUE2QixDQUFDO0FBQzVDLGtCQUFNLElBQUksU0FBUyxlQUFlLG1CQUFtQjtBQUNyRCxnQkFBSSxHQUFHO0FBQ0wsZ0JBQUUsWUFDQSw4UEFHQSxlQUFlLEVBQUUsV0FBVyxPQUFPLENBQUMsQ0FBQyxJQUNyQztBQUFBLFlBR0o7QUFBQSxVQUNGLENBQUM7QUFBQSxRQUNMO0FBQUEsTUFDRjtBQUFBLElBQ0Y7QUFBQSxFQUNGO0FBTUEsV0FBUyxnQkFBZ0I7QUFDdkIsVUFBTSxJQUFJLG9CQUFJLEtBQUs7QUFDbkIsV0FBTyxFQUFFLFlBQVksSUFBSSxNQUFNLE9BQU8sRUFBRSxTQUFTLElBQUksQ0FBQyxFQUFFLFNBQVMsR0FBRyxHQUFHO0FBQUEsRUFDekU7QUFFQSxXQUFTLFNBQVMsT0FBTztBQUN2QixRQUFJLENBQUMsTUFBTyxRQUFPO0FBQ25CLFFBQUksUUFBUSxLQUFNLFFBQU8sUUFBUTtBQUNqQyxRQUFJLFFBQVEsT0FBTyxLQUFNLFNBQVEsUUFBUSxNQUFNLFFBQVEsQ0FBQyxJQUFJO0FBQzVELFlBQVEsU0FBUyxPQUFPLE9BQU8sUUFBUSxDQUFDLElBQUk7QUFBQSxFQUM5QztBQUVBLFdBQVMsY0FBYyxLQUFLO0FBQzFCLFFBQUksQ0FBQyxJQUFLLFFBQU87QUFDakIsUUFBSTtBQUNGLFlBQU0sSUFBSSxJQUFJLFNBQVMsSUFBSSxPQUFPLElBQUksSUFBSSxLQUFLLEdBQUc7QUFDbEQsYUFDRSxFQUFFLG1CQUFtQixTQUFTLEVBQUUsS0FBSyxXQUFXLE9BQU8sU0FBUyxNQUFNLFVBQVUsQ0FBQyxJQUNqRixNQUNBLEVBQUUsbUJBQW1CLFNBQVMsRUFBRSxNQUFNLFdBQVcsUUFBUSxVQUFVLENBQUM7QUFBQSxJQUV4RSxRQUFRO0FBQ04sYUFBTyxPQUFPLEdBQUc7QUFBQSxJQUNuQjtBQUFBLEVBQ0Y7QUFFQSxpQkFBZSx1QkFBdUI7QUFDcEMsUUFBSSxDQUFDLE9BQU8sS0FBTTtBQUNsQixVQUFNLFFBQVE7QUFBQSxNQUNaLG9CQUFvQixJQUFJLE9BQU8sTUFBTTtBQUNuQyxZQUFJO0FBQ0YsZ0JBQU0sTUFBTSxNQUFNLE9BQU8sS0FBSyxXQUFXLGtCQUFrQixFQUFFLElBQUksRUFBRSxHQUFHLEVBQUUsSUFBSTtBQUM1RSwyQkFBaUIsRUFBRSxHQUFHLElBQUksSUFBSSxTQUFTLElBQUksS0FBSyxJQUFJO0FBQUEsUUFDdEQsU0FBUyxHQUFHO0FBQ1Ysa0JBQVEsS0FBSyxzQ0FBc0MsRUFBRSxNQUFNLFVBQVUsS0FBSyxFQUFFLE9BQU87QUFDbkYsMkJBQWlCLEVBQUUsR0FBRyxJQUFJO0FBQUEsUUFDNUI7QUFBQSxNQUNGLENBQUM7QUFBQSxJQUNIO0FBQUEsRUFDRjtBQUVBLFdBQVMsZUFBZSxHQUFHO0FBQ3pCLFFBQUksT0FBTyxPQUFPLGVBQWUsV0FBWSxRQUFPLE9BQU8sV0FBVyxDQUFDO0FBQ3ZFLFdBQU8sT0FBTyxLQUFLLE9BQU8sS0FBSyxDQUFDLEVBQUU7QUFBQSxNQUNoQztBQUFBLE1BQ0EsQ0FBQyxRQUFRLEVBQUUsS0FBSyxTQUFTLEtBQUssUUFBUSxLQUFLLFFBQVEsS0FBSyxVQUFVLEtBQUssUUFBUSxHQUFHLEVBQUU7QUFBQSxJQUN0RjtBQUFBLEVBQ0Y7QUFFQSxXQUFTLHdCQUF3QixHQUFHO0FBQ2xDLFVBQU0sUUFBUSxpQkFBaUIsRUFBRSxHQUFHO0FBQ3BDLFVBQU0sWUFBWSxTQUFTLE9BQU8sU0FBUyxNQUFNLFNBQVMsSUFBSSxNQUFNLFlBQVk7QUFDaEYsVUFBTSxjQUNKLFNBQVMsTUFBTSxRQUFRLE1BQU0sY0FBYyxJQUFJLE1BQU0sZUFBZSxTQUFTO0FBQy9FLFVBQU0sV0FBVyxTQUFTLE1BQU0sV0FBVyxjQUFjLE1BQU0sUUFBUSxJQUFJO0FBQzNFLFVBQU0sYUFBYSxTQUFTLE1BQU0sYUFBYSxNQUFNLGFBQWE7QUFDbEUsVUFBTSxpQkFBaUIsU0FBUyxNQUFNLGlCQUFpQixNQUFNLGlCQUFpQjtBQUM5RSxVQUFNLFlBQVksU0FBUyxNQUFNLFlBQVksTUFBTSxZQUFZO0FBQy9ELFVBQU0sY0FDSixTQUFTLE1BQU0sa0JBQWtCLE1BQU0sZUFBZSxTQUNsRCxNQUFNLGVBQWUsQ0FBQyxJQUFJLGFBQVEsTUFBTSxlQUFlLE1BQU0sZUFBZSxTQUFTLENBQUMsSUFDdEY7QUFDTixVQUFNLFdBQVcsQ0FBQyxDQUFDO0FBQ25CLFVBQU0sUUFBUSxXQUNWLG1KQUNBO0FBQ0osVUFBTSxZQUFZLFdBQ2QsaVRBRUEsZUFBZSxjQUFjLElBQzdCLG1IQUVBLGVBQWUsUUFBUSxJQUN2QixnSEFFQSxlQUFlLFVBQVUsSUFDekIsMklBRUEsZUFBZSxTQUFTLElBQ3hCLGlJQUVBLFVBQVUsZUFBZSxPQUFPLElBQ2hDLGtJQUVBLGNBQ0EsNkRBQ0EsZUFBZSxXQUFXLElBQzFCLHlCQUVBO0FBQ0osVUFBTSxZQUNKLHNIQUNBLEVBQUUsUUFDRiw2R0FFQyxXQUFXLDRCQUF1Qix5QkFDbkMsaUVBRUEsRUFBRSxNQUNGLHdFQUNBLEVBQUUsTUFDRjtBQUVGLFVBQU0sV0FDSix5R0FFQSxFQUFFLFFBQ0YseUhBRUEsZUFBZSxFQUFFLEtBQUssSUFDdEIsMEhBRUEsUUFDQTtBQUNGLFdBQ0Usa0tBQ0EsV0FDQSxZQUNBLFlBQ0EsZ0NBQ0EsRUFBRSxNQUNGO0FBQUEsRUFHSjtBQUVBLFdBQVMsdUJBQXVCO0FBQzlCLFVBQU0sT0FBTyxTQUFTLGVBQWUsMEJBQTBCO0FBQy9ELFFBQUksQ0FBQyxLQUFNO0FBQ1gsVUFBTSxRQUFRLG9CQUFvQixJQUFJLHVCQUF1QixFQUFFLEtBQUssRUFBRTtBQUN0RSxVQUFNLFFBQ0o7QUFJRixVQUFNLE9BQ0osb0hBQ0EsUUFDQTtBQUdGLFVBQU0sY0FBYztBQUNwQixTQUFLLFlBQVksK0JBQStCLFFBQVEsT0FBTyxjQUFjO0FBQzdFLHVCQUFtQjtBQUFBLEVBQ3JCO0FBRUEsU0FBTyw0QkFBNEIsZUFBZ0IsT0FBTyxTQUFTO0FBQ2pFLFVBQU0sT0FBTyxTQUFTLE1BQU0sVUFBVSxNQUFNLE9BQU8sU0FBUyxNQUFNLE9BQU8sTUFBTSxDQUFDO0FBQ2hGLFFBQUksQ0FBQyxLQUFNO0FBQ1gsVUFBTSxXQUFXLFNBQVMsZUFBZSx1QkFBdUIsT0FBTztBQUN2RSxVQUFNLFlBQVksQ0FBQyxLQUFLLFVBQVU7QUFDaEMsVUFBSSxDQUFDLFNBQVU7QUFDZixlQUFTLGNBQWM7QUFDdkIsZUFBUyxNQUFNLFFBQVEsU0FBUztBQUFBLElBQ2xDO0FBQ0EsUUFBSTtBQUNGLFVBQUksT0FBTyxTQUFTLGFBQWE7QUFDL0IsY0FBTSxxREFBNkM7QUFDbkQ7QUFBQSxNQUNGO0FBQ0EsVUFBSSxDQUFDLE9BQU8sbUJBQW1CLENBQUMsT0FBTyxnQkFBZ0IscUJBQXFCO0FBQzFFLGNBQU0sK0NBQStDO0FBQ3JEO0FBQUEsTUFDRjtBQUNBLFVBQUksQ0FBQyxPQUFPLFlBQVksQ0FBQyxPQUFPLFNBQVMsU0FBUztBQUNoRCxjQUFNLGlDQUFpQztBQUN2QztBQUFBLE1BQ0Y7QUFDQSxnQkFBVSxxQkFBZ0I7QUFDMUIsWUFBTSxNQUFNLE1BQU0sS0FBSyxZQUFZO0FBQ25DLFlBQU0sS0FBSyxLQUFLLEtBQUssS0FBSyxFQUFFLE1BQU0sUUFBUSxDQUFDO0FBQzNDLFlBQU0sVUFBVSxHQUFHLFdBQVc7QUFBQSxRQUM1QixDQUFDLE1BQ0MsT0FBTyxLQUFLLEVBQUUsRUFDWCxLQUFLLEVBQ0wsWUFBWSxNQUFNO0FBQUEsTUFDekI7QUFDQSxVQUFJLENBQUMsU0FBUztBQUNaO0FBQUEsVUFDRSw2REFBd0QsR0FBRyxXQUFXLEtBQUssSUFBSTtBQUFBLFVBQy9FO0FBQUEsUUFDRjtBQUNBO0FBQUEsTUFDRjtBQUNBLFlBQU0sUUFBUSxHQUFHLE9BQU8sT0FBTztBQUMvQixZQUFNLE9BQU8sS0FBSyxNQUFNLGNBQWMsT0FBTyxFQUFFLFFBQVEsR0FBRyxRQUFRLElBQUksS0FBSyxLQUFLLENBQUM7QUFDakYsZ0JBQVUsZUFBZSxLQUFLLFNBQVMscUJBQXFCLFVBQVUsU0FBSTtBQUMxRSxZQUFNLFNBQVMsT0FBTyxnQkFBZ0Isb0JBQW9CLElBQUk7QUFDOUQsVUFBSSxDQUFDLE9BQU8sS0FBSyxRQUFRO0FBQ3ZCLGtCQUFVLG1EQUEyQyxTQUFTO0FBQzlEO0FBQUEsTUFDRjtBQUNBLFlBQU0sWUFBWSxjQUFjO0FBQ2hDLFlBQU0sY0FBYyx5QkFBeUIsWUFBWSxNQUFNLFVBQVU7QUFDekUsZ0JBQVUsK0JBQStCLFNBQVMsS0FBSyxJQUFJLElBQUksU0FBSTtBQUNuRSxZQUFNLGFBQWEsT0FBTyxTQUFTLFFBQVEsRUFBRSxJQUFJLFdBQVc7QUFDNUQsWUFBTSxXQUFXLElBQUksTUFBTTtBQUFBLFFBQ3pCLGFBQWEsS0FBSyxRQUFRO0FBQUEsUUFDMUIsZ0JBQWdCO0FBQUEsVUFDZDtBQUFBLFVBQ0EsWUFBYSxPQUFPLGVBQWUsT0FBTyxZQUFZLFNBQVU7QUFBQSxVQUNoRSxnQkFBZ0IsS0FBSyxRQUFRO0FBQUEsUUFDL0I7QUFBQSxNQUNGLENBQUM7QUFDRCxnQkFBVSxvQ0FBb0MsT0FBTyxLQUFLLFNBQVMsY0FBUztBQUM1RSxZQUFNLGFBQWMsT0FBTyxlQUFlLE9BQU8sWUFBWSxTQUFVO0FBQ3ZFLFlBQU0sVUFBVTtBQUFBLFFBQ2Q7QUFBQSxRQUNBLFVBQ0UsT0FBTyxZQUFZLE9BQU8sU0FBUyxhQUFhLE9BQU8sU0FBUyxVQUFVLGFBQ3RFLE9BQU8sU0FBUyxVQUFVLFdBQVcsZ0JBQWdCLEtBQ3JELG9CQUFJLEtBQUssR0FBRSxZQUFZO0FBQUEsUUFDN0I7QUFBQSxRQUNBLGdCQUFnQixLQUFLLFFBQVE7QUFBQSxRQUM3QixhQUFhO0FBQUEsUUFDYjtBQUFBLFFBQ0E7QUFBQSxRQUNBLFdBQVcsT0FBTyxLQUFLO0FBQUEsUUFDdkIsZ0JBQWdCLE9BQU87QUFBQSxRQUN2QixnQkFBZ0IsT0FBTztBQUFBLFFBQ3ZCLE1BQU0sT0FBTztBQUFBLE1BQ2Y7QUFDQSxZQUFNLE9BQU8sS0FBSyxXQUFXLGtCQUFrQixFQUFFLElBQUksT0FBTyxFQUFFLElBQUksT0FBTztBQUl6RSx1QkFBaUIsT0FBTyxJQUFJLE9BQU8sT0FBTyxDQUFDLEdBQUcsU0FBUyxFQUFFLFVBQVUsb0JBQUksS0FBSyxFQUFFLENBQUM7QUFDL0U7QUFBQSxRQUNFLGdCQUFXLE9BQU8sS0FBSyxTQUFTLGdCQUFhLE9BQU8sZUFBZSxTQUFTO0FBQUEsUUFDNUU7QUFBQSxNQUNGO0FBQ0EsMkJBQXFCO0FBQUEsSUFDdkIsU0FBUyxHQUFHO0FBQ1YsY0FBUSxNQUFNLGtDQUFrQyxVQUFVLFVBQVUsQ0FBQztBQUNyRSxnQkFBVSxvQkFBZ0IsS0FBSyxFQUFFLFdBQVksSUFBSSxTQUFTO0FBQzFELFVBQUksS0FBSyxFQUFFLFNBQVMsb0JBQW9CO0FBQ3RDO0FBQUEsVUFDRSw2SUFDRSxFQUFFO0FBQUEsUUFDTjtBQUFBLE1BQ0Y7QUFBQSxJQUNGLFVBQUU7QUFDQSxVQUFJLFNBQVMsTUFBTSxPQUFRLE9BQU0sT0FBTyxRQUFRO0FBQUEsSUFDbEQ7QUFBQSxFQUNGO0FBTUEsaUJBQWUsc0JBQXNCO0FBQ25DLFFBQUksQ0FBQyxPQUFPLEtBQU0sT0FBTSxJQUFJLE1BQU0sMkJBQTJCO0FBQzdELFlBQVEsSUFBSSw0Q0FBNEM7QUFDeEQsVUFBTSxDQUFDLE1BQU0sT0FBTyxJQUFJLE1BQU0sUUFBUSxJQUFJO0FBQUEsTUFDeEMsT0FBTyxLQUFLLFdBQVcsaUJBQWlCLEVBQUUsSUFBSTtBQUFBLE1BQzlDLE9BQU8sS0FBSyxXQUFXLHNCQUFzQixFQUFFLElBQUksU0FBUyxFQUFFLElBQUk7QUFBQSxJQUNwRSxDQUFDO0FBQ0QsVUFBTSxPQUFPLENBQUM7QUFDZCxTQUFLLFFBQVEsQ0FBQyxNQUFNLEtBQUssS0FBSyxPQUFPLE9BQU8sRUFBRSxJQUFJLEVBQUUsR0FBRyxHQUFHLEVBQUUsS0FBSyxDQUFDLENBQUMsQ0FBQztBQUNwRSxTQUFLLEtBQUssQ0FBQyxHQUFHLE1BQU07QUFDbEIsWUFBTSxLQUFNLEVBQUUsV0FBVyxFQUFFLFFBQVEsUUFBUztBQUM1QyxZQUFNLEtBQU0sRUFBRSxXQUFXLEVBQUUsUUFBUSxRQUFTO0FBQzVDLGFBQU8sS0FBSztBQUFBLElBQ2QsQ0FBQztBQUNELHdCQUFvQjtBQUNwQix3QkFBb0IsUUFBUSxTQUFTLFFBQVEsS0FBSyxJQUFJO0FBQ3RELFlBQVEsSUFBSSwwQkFBMEIsS0FBSyxRQUFRLG1CQUFnQixDQUFDLENBQUMsaUJBQWlCO0FBQ3RGLFdBQU87QUFBQSxFQUNUO0FBRUEsV0FBUyxnQkFBZ0IsR0FBRztBQUMxQixRQUFJLEtBQUssS0FBTSxRQUFPO0FBQ3RCLFFBQUksSUFBSSxJQUFLLFFBQU87QUFDcEIsUUFBSSxJQUFJLElBQUssUUFBTztBQUNwQixRQUFJLElBQUksSUFBSyxRQUFPO0FBQ3BCLFFBQUksSUFBSSxFQUFLLFFBQU87QUFDcEIsV0FBTztBQUFBLEVBQ1Q7QUFFQSxXQUFTLFFBQVEsR0FBRztBQUNsQixRQUFJLEtBQUssUUFBUSxDQUFDLE9BQU8sU0FBUyxPQUFPLENBQUMsQ0FBQyxFQUFHLFFBQU87QUFDckQsV0FBTyxPQUFPLENBQUMsRUFBRSxlQUFlLFNBQVMsRUFBRSx1QkFBdUIsRUFBRSxDQUFDO0FBQUEsRUFDdkU7QUFFQSxXQUFTLFNBQVMsR0FBRztBQUNuQixRQUFJLEtBQUssUUFBUSxDQUFDLE9BQU8sU0FBUyxPQUFPLENBQUMsQ0FBQyxFQUFHLFFBQU87QUFDckQsWUFBUSxPQUFPLENBQUMsSUFBSSxLQUFLLFFBQVEsQ0FBQyxJQUFJO0FBQUEsRUFDeEM7QUFFQSxXQUFTLFlBQVksS0FBSztBQUV4QixRQUFJO0FBQ0YsWUFBTSxDQUFDLEdBQUcsQ0FBQyxJQUFJLElBQUksTUFBTSxHQUFHLEVBQUUsSUFBSSxNQUFNO0FBQ3hDLFlBQU0sUUFBUTtBQUFBLFFBQ1o7QUFBQSxRQUNBO0FBQUEsUUFDQTtBQUFBLFFBQ0E7QUFBQSxRQUNBO0FBQUEsUUFDQTtBQUFBLFFBQ0E7QUFBQSxRQUNBO0FBQUEsUUFDQTtBQUFBLFFBQ0E7QUFBQSxRQUNBO0FBQUEsUUFDQTtBQUFBLE1BQ0Y7QUFDQSxhQUFPLE1BQU0sSUFBSSxDQUFDLElBQUksTUFBTSxPQUFPLENBQUMsRUFBRSxNQUFNLEVBQUU7QUFBQSxJQUNoRCxRQUFRO0FBQ04sYUFBTztBQUFBLElBQ1Q7QUFBQSxFQUNGO0FBRUEsV0FBUyx5QkFBeUI7QUFDaEMsVUFBTSxPQUFPLFNBQVMsZUFBZSxtQkFBbUI7QUFDeEQsUUFBSSxDQUFDLEtBQU07QUFDWCxRQUFJO0FBQ0YsaUNBQTJCLElBQUk7QUFBQSxJQUNqQyxTQUFTLEdBQUc7QUFDVixjQUFRLE1BQU0sK0JBQStCLENBQUM7QUFDOUMsV0FBSyxZQUNILHNTQUdBLGVBQWUsRUFBRSxTQUFTLEVBQUUsV0FBVyxPQUFPLENBQUMsQ0FBQyxJQUNoRDtBQUFBLElBQ0o7QUFBQSxFQUNGO0FBRUEsV0FBUywyQkFBMkIsTUFBTTtBQUN4QyxVQUFNLE9BQU8scUJBQXFCLENBQUM7QUFDbkMsVUFBTSxPQUFPLHFCQUFxQixDQUFDO0FBQ25DLFVBQU0sVUFBVSxLQUFLLFdBQVcsQ0FBQztBQUNqQyxZQUFRLElBQUksdUNBQWtDLEtBQUssUUFBUSxTQUFTLENBQUMsQ0FBQyxLQUFLLFdBQVc7QUFDdEYsUUFBSSxDQUFDLEtBQUssUUFBUTtBQUNoQixXQUFLLFlBQ0g7QUFJRjtBQUFBLElBQ0Y7QUFFQSxVQUFNLGFBQWEsS0FBSyxDQUFDLEVBQUUsWUFBWSxDQUFDLEdBQUcsSUFBSSxDQUFDLE1BQU0sRUFBRSxFQUFFO0FBQzFELFVBQU0sZUFBZSxVQUFVLElBQUksV0FBVztBQUc5QyxVQUFNLFlBQVksS0FBSyxjQUNuQixJQUFJLEtBQUssS0FBSyxXQUFXLEVBQUUsZUFBZSxTQUFTO0FBQUEsTUFDakQsS0FBSztBQUFBLE1BQ0wsT0FBTztBQUFBLE1BQ1AsTUFBTTtBQUFBLE1BQ04sTUFBTTtBQUFBLE1BQ04sUUFBUTtBQUFBLElBQ1YsQ0FBQyxJQUNEO0FBQ0osVUFBTSxVQUNKLFFBQVEsZ0NBQWdDLE9BQ3BDLFNBQVMsUUFBUSw0QkFBNEIsSUFDN0M7QUFDTixVQUFNLFFBQVEsUUFBUSxpQkFBaUIsS0FBSztBQUM1QyxVQUFNLFFBQ0osUUFBUSx3QkFBd0IsT0FBTyxRQUFRLHVCQUF1QixNQUFNLFFBQVE7QUFDdEYsVUFBTSxRQUNKLFFBQVEsd0JBQXdCLE9BQU8sUUFBUSx1QkFBdUIsTUFBTSxRQUFRO0FBRXRGLFVBQU0sU0FDSiw4Y0FFQSxVQUNBLDhNQUVBLFFBQ0EsZ05BRUEsUUFDQSw0TUFFQSxRQUNBLG1PQUVBLGVBQWUsU0FBUyxJQUN4QjtBQUlGLFVBQU0sV0FBVyxLQUNkLElBQUksQ0FBQyxNQUFNO0FBQ1YsWUFBTSxPQUFPLEVBQUUsV0FBVyxFQUFFLFFBQVEsUUFBUSxPQUFPLEVBQUUsUUFBUSxPQUFPO0FBQ3BFLFlBQU0sWUFBWSxFQUFFLGFBQWE7QUFDakMsWUFBTSxjQUFjLENBQUM7QUFDckIsT0FBQyxFQUFFLFlBQVksQ0FBQyxHQUFHLFFBQVEsQ0FBQyxNQUFNO0FBQ2hDLG9CQUFZLEVBQUUsRUFBRSxJQUFJLEVBQUU7QUFBQSxNQUN4QixDQUFDO0FBQ0QsWUFBTSxhQUFhLFVBQ2hCO0FBQUEsUUFDQyxDQUFDLE9BQ0MsK0hBQ0EsUUFBUSxZQUFZLEVBQUUsQ0FBQyxJQUN2QjtBQUFBLE1BQ0osRUFDQyxLQUFLLEVBQUU7QUFDVixZQUFNLFVBQVUsRUFBRSxZQUFZLENBQUMsR0FBRyxPQUFPLENBQUMsR0FBRyxNQUFNLEtBQUssT0FBTyxFQUFFLEtBQUssS0FBSyxJQUFJLENBQUM7QUFDaEYsYUFDRSwwQ0FDQSxlQUFlLEVBQUUsRUFBRSxJQUNuQiwrUEFFQSxlQUFlLEVBQUUsY0FBYyxFQUFFLEVBQUUsSUFDbkMsa0ZBRUEsZUFBZSxTQUFTLElBQ3hCLHlJQUVBLGdCQUFnQixJQUFJLElBQ3BCLGlEQUNBLFNBQVMsSUFBSSxJQUNiLGlCQUNBLGFBQ0Esa0pBQ0EsUUFBUSxNQUFNLElBQ2Q7QUFBQSxJQUdKLENBQUMsRUFDQSxLQUFLLEVBQUU7QUFFVixVQUFNLG1CQUFtQixhQUN0QjtBQUFBLE1BQ0MsQ0FBQyxNQUNDLDZIQUNBLGVBQWUsQ0FBQyxJQUNoQjtBQUFBLElBQ0osRUFDQyxLQUFLLEVBQUU7QUFFVixVQUFNLFFBQ0osMmlCQU1BLG1CQUNBLG1LQUdBLFdBQ0E7QUFFRixVQUFNLFNBQ0o7QUFLRixTQUFLLFlBQVksK0JBQStCLFNBQVMsUUFBUSxTQUFTO0FBQUEsRUFDNUU7QUFhQSxXQUFTLHVCQUF1QixLQUFLO0FBQ25DLFVBQU0sS0FBSyxJQUFJLFlBQVksQ0FBQztBQUM1QixRQUFJLENBQUMsR0FBRztBQUNOLGFBQU87QUFFVCxVQUFNLElBQUksS0FDUixJQUFJO0FBQ04sVUFBTSxPQUFPLElBQ1gsT0FBTyxJQUNQLE9BQU8sSUFDUCxPQUFPO0FBQ1QsVUFBTSxTQUFTLElBQUksT0FBTztBQUMxQixVQUFNLFNBQVMsSUFBSSxPQUFPO0FBRzFCLFVBQU0sT0FBTyxLQUFLLElBQUksR0FBRyxHQUFHLEdBQUcsSUFBSSxDQUFDLE1BQU0sT0FBTyxFQUFFLElBQUksS0FBSyxPQUFPLEVBQUUsS0FBSyxLQUFLLENBQUMsQ0FBQztBQUNqRixVQUFNLE9BQU87QUFDYixVQUFNLFNBQVMsQ0FBQyxNQUFNLE9BQVEsU0FBUyxJQUFLLEtBQUssSUFBSSxHQUFHLEdBQUcsU0FBUyxDQUFDO0FBQ3JFLFVBQU0sU0FBUyxDQUFDLE1BQU0sT0FBTyxTQUFVLFVBQVUsSUFBSSxTQUFVLE9BQU87QUFHdEUsVUFBTSxTQUFTLENBQUMsR0FBRyxNQUFNLEtBQUssTUFBTSxDQUFDLEVBQ2xDLElBQUksQ0FBQyxNQUFNO0FBQ1YsWUFBTSxNQUFNLE9BQU8sS0FBSyxPQUFPO0FBQy9CLFlBQU0sS0FBSyxPQUFPLEdBQUc7QUFDckIsYUFDRSxlQUNBLE9BQ0EsV0FDQSxLQUNBLFlBQ0MsSUFBSSxRQUNMLFdBQ0EsS0FDQSxvREFFQyxPQUFPLEtBQ1IsV0FDQyxLQUFLLEtBQ04sdURBQ0EsUUFBUSxHQUFHLElBQ1g7QUFBQSxJQUVKLENBQUMsRUFDQSxLQUFLLEVBQUU7QUFHVixVQUFNLFVBQVUsR0FDYixJQUFJLENBQUMsR0FBRyxNQUFNO0FBQ2IsWUFBTSxLQUFLLE9BQU8sQ0FBQztBQUNuQixhQUNFLGNBQ0EsS0FDQSxXQUNDLElBQUksT0FBTyxNQUNaLDBEQUNBLFlBQVksRUFBRSxFQUFFLElBQ2hCO0FBQUEsSUFFSixDQUFDLEVBQ0EsS0FBSyxFQUFFO0FBR1YsVUFBTSxhQUNKLEdBQUcsSUFBSSxDQUFDLEdBQUcsTUFBTSxPQUFPLENBQUMsSUFBSSxNQUFNLE9BQU8sT0FBTyxFQUFFLElBQUksS0FBSyxDQUFDLENBQUMsRUFBRSxLQUFLLEdBQUcsSUFDeEUsTUFDQSxHQUNHLE1BQU0sRUFDTixRQUFRLEVBQ1IsSUFBSSxDQUFDLEdBQUcsTUFBTSxPQUFPLEdBQUcsU0FBUyxJQUFJLENBQUMsSUFBSSxNQUFNLE9BQU8sT0FBTyxFQUFFLElBQUksS0FBSyxDQUFDLENBQUMsRUFDM0UsS0FBSyxHQUFHO0FBQ2IsVUFBTSxPQUFPLHNCQUFzQixhQUFhO0FBR2hELFVBQU0sYUFBYSxHQUFHLElBQUksQ0FBQyxHQUFHLE1BQU0sT0FBTyxDQUFDLElBQUksTUFBTSxPQUFPLE9BQU8sRUFBRSxLQUFLLEtBQUssQ0FBQyxDQUFDLEVBQUUsS0FBSyxHQUFHO0FBQzVGLFVBQU0sT0FDSix1QkFDQSxhQUNBO0FBQ0YsVUFBTSxTQUFTLEdBQ1o7QUFBQSxNQUNDLENBQUMsR0FBRyxNQUNGLGlCQUNBLE9BQU8sQ0FBQyxJQUNSLFdBQ0EsT0FBTyxPQUFPLEVBQUUsS0FBSyxLQUFLLENBQUMsSUFDM0I7QUFBQSxJQUNKLEVBQ0MsS0FBSyxFQUFFO0FBRVYsVUFBTSxjQUFjLEdBQ2pCLElBQUksQ0FBQyxHQUFHLE1BQU07QUFDYixZQUFNLEtBQUssT0FBTyxDQUFDO0FBQ25CLFlBQU0sS0FBSyxPQUFPLE9BQU8sRUFBRSxLQUFLLEtBQUssQ0FBQztBQUN0QyxhQUNFLGNBQ0EsS0FDQSxXQUNDLEtBQUssS0FDTiw0RUFDQSxRQUFRLEVBQUUsS0FBSyxJQUNmO0FBQUEsSUFFSixDQUFDLEVBQ0EsS0FBSyxFQUFFO0FBRVYsVUFBTSxNQUNKLHVCQUNBLElBQ0EsTUFDQSxJQUNBLCtFQUVBLElBQ0EsZUFDQSxJQUNBLG9CQUNBLFNBQ0EsVUFDQSxPQUNBLE9BQ0EsU0FDQSxjQUNBO0FBQ0YsV0FBTztBQUFBLEVBQ1Q7QUFFQSxTQUFPLHlCQUF5QixTQUFVLE9BQU87QUFDL0MsUUFBSSxDQUFDLGtCQUFtQjtBQUN4QixVQUFNLE1BQU0sa0JBQWtCLEtBQUssQ0FBQyxNQUFNLEVBQUUsT0FBTyxLQUFLO0FBQ3hELFFBQUksQ0FBQyxLQUFLO0FBQ1IsWUFBTSxrQ0FBK0IsS0FBSztBQUMxQztBQUFBLElBQ0Y7QUFDQSxVQUFNLFdBQVcsU0FBUyxlQUFlLHNCQUFzQjtBQUMvRCxRQUFJLFNBQVUsVUFBUyxPQUFPO0FBRTlCLFVBQU0sS0FBSyxTQUFTLGNBQWMsS0FBSztBQUN2QyxPQUFHLEtBQUs7QUFDUixPQUFHLE1BQU0sVUFDUDtBQUNGLE9BQUcsVUFBVSxDQUFDLE9BQU87QUFDbkIsVUFBSSxHQUFHLFdBQVcsR0FBSSxJQUFHLE9BQU87QUFBQSxJQUNsQztBQUVBLFVBQU0sT0FBTyxJQUFJLFdBQVcsSUFBSSxRQUFRO0FBQ3hDLFVBQU0sT0FBTyxJQUFJLFdBQVcsSUFBSSxRQUFRO0FBQ3hDLFVBQU0sTUFBTSxJQUFJLFdBQVcsSUFBSSxRQUFRO0FBQ3ZDLFVBQU0sT0FBTyxJQUFJLFdBQVcsSUFBSSxRQUFRO0FBQ3hDLFVBQU0sWUFBWSxJQUFJLGFBQWE7QUFDbkMsVUFBTSxZQUFZLElBQUksYUFBYTtBQUNuQyxVQUFNLFVBQVUsdUJBQXVCLEdBQUc7QUFFMUMsVUFBTSxjQUNKLGdUQUVBLGVBQWUsU0FBUyxJQUN4QixxTkFFQSxnQkFBZ0IsSUFBSSxJQUNwQixPQUNBLFNBQVMsSUFBSSxJQUNiLGlOQUVDLFFBQVEsUUFBUSxPQUFPLEtBQUssUUFBUSxDQUFDLElBQUksTUFBTSxZQUNoRCwrTUFFQSxRQUFRLEdBQUcsSUFDWCxnTkFFQSxRQUFRLElBQUksSUFDWjtBQUdGLFVBQU0sWUFDSix5WUFPQyxJQUFJLFlBQVksQ0FBQyxHQUNmO0FBQUEsTUFDQyxDQUFDLE1BQ0MsMkZBQ0EsZUFBZSxZQUFZLEVBQUUsRUFBRSxDQUFDLElBQ2hDLHdFQUVBLFFBQVEsRUFBRSxLQUFLLElBQ2YsZ0ZBRUEsUUFBUSxFQUFFLElBQUksSUFDZCxnRkFFQSxRQUFRLEVBQUUsSUFBSSxJQUNkO0FBQUEsSUFDSixFQUNDLEtBQUssRUFBRSxJQUNWO0FBRUYsVUFBTSxVQUNKLCthQUdBLGVBQWUsSUFBSSxjQUFjLElBQUksRUFBRSxJQUN2Qyx3UEFHQSxjQUNBLHNIQUNBLFVBQ0EsV0FDQSxZQUNBLHdGQUNBLGVBQWUsU0FBUyxJQUN4Qiw0QkFDQSxnQkFBZ0IsSUFBSSxVQUFVLENBQUMsR0FBRyxZQUFZLFFBQUcsSUFDakQ7QUFFRixPQUFHLFlBQVk7QUFDZixhQUFTLEtBQUssWUFBWSxFQUFFO0FBQUEsRUFDOUI7QUFFQSxTQUFPLG9CQUFvQixpQkFBa0I7QUFDM0MsUUFBSSxDQUFDLGFBQWEsR0FBRztBQUNuQixZQUFNLHdDQUF3QztBQUM5QztBQUFBLElBQ0Y7QUFDQSxVQUFNLEtBQUssa0JBQWtCO0FBQzdCLE9BQUcsTUFBTSxVQUFVO0FBRW5CLHlCQUFxQjtBQUNyQix5QkFBcUIsRUFDbEIsS0FBSyxvQkFBb0IsRUFDekIsTUFBTSxNQUFNO0FBQUEsSUFBQyxDQUFDO0FBQUEsRUFDbkI7QUFFQSxTQUFPLHFCQUFxQixXQUFZO0FBQ3RDLFVBQU0sS0FBSyxTQUFTLGVBQWUsZ0JBQWdCO0FBQ25ELFFBQUksR0FBSSxJQUFHLE1BQU0sVUFBVTtBQUFBLEVBQzdCO0FBTUEsaUJBQWUsMkJBQTJCO0FBQ3hDLFFBQUksQ0FBQyxPQUFPLEtBQU07QUFDbEIsUUFBSTtBQUNGLFlBQU0sTUFBTSxNQUFNLE9BQU8sS0FBSyxXQUFXLGlCQUFpQixFQUFFLElBQUksYUFBYSxFQUFFLElBQUk7QUFDbkYsVUFBSSxJQUFJLFFBQVE7QUFDZCxjQUFNLElBQUksSUFBSSxLQUFLLEtBQUssQ0FBQztBQUN6QiwrQkFBdUIsRUFBRSxnQkFBZ0IsQ0FBQztBQUFBLE1BQzVDLE9BQU87QUFDTCwrQkFBdUIsQ0FBQztBQUFBLE1BQzFCO0FBQUEsSUFDRixTQUFTLEdBQUc7QUFDVixjQUFRLEtBQUssMENBQTBDLEtBQUssRUFBRSxPQUFPO0FBQ3JFLDZCQUF1QixDQUFDO0FBQUEsSUFDMUI7QUFBQSxFQUNGO0FBRUEsaUJBQWUsd0JBQXdCLFVBQVUsT0FBTztBQUN0RCxRQUFJLENBQUMsT0FBTyxLQUFNO0FBQ2xCLFFBQUksQ0FBQyxxQkFBc0Isd0JBQXVCLENBQUM7QUFDbkQsVUFBTSxNQUFPLE9BQU8sZUFBZSxPQUFPLFlBQVksU0FBVTtBQUNoRSx5QkFBcUIsUUFBUSxJQUFJO0FBQUEsTUFDL0IsT0FBTyxPQUFPLEtBQUs7QUFBQSxNQUNuQixZQUFXLG9CQUFJLEtBQUssR0FBRSxZQUFZO0FBQUEsTUFDbEMsV0FBVztBQUFBLElBQ2I7QUFDQSxVQUFNLE9BQU8sS0FBSyxXQUFXLGlCQUFpQixFQUFFLElBQUksYUFBYSxFQUFFLElBQUk7QUFBQSxNQUNyRSxjQUFjO0FBQUEsTUFDZCxZQUFXLG9CQUFJLEtBQUssR0FBRSxZQUFZO0FBQUEsTUFDbEMsV0FBVztBQUFBLElBQ2IsQ0FBQztBQUFBLEVBQ0g7QUFFQSxpQkFBZSwwQkFBMEIsVUFBVTtBQUNqRCxRQUFJLENBQUMsT0FBTyxRQUFRLENBQUMscUJBQXNCO0FBQzNDLFdBQU8scUJBQXFCLFFBQVE7QUFDcEMsVUFBTSxNQUFPLE9BQU8sZUFBZSxPQUFPLFlBQVksU0FBVTtBQUNoRSxVQUFNLE9BQU8sS0FBSyxXQUFXLGlCQUFpQixFQUFFLElBQUksYUFBYSxFQUFFLElBQUk7QUFBQSxNQUNyRSxjQUFjO0FBQUEsTUFDZCxZQUFXLG9CQUFJLEtBQUssR0FBRSxZQUFZO0FBQUEsTUFDbEMsV0FBVztBQUFBLElBQ2IsQ0FBQztBQUFBLEVBQ0g7QUFHQSxXQUFTLHVCQUF1QixVQUFVO0FBQ3hDLFVBQU0sTUFBTSx1QkFBdUIsb0JBQW9CLFFBQVE7QUFDL0QsUUFBSSxDQUFDLE9BQU8sQ0FBQyxJQUFJLE1BQU8sUUFBTyxFQUFFLE9BQU8sR0FBSyxRQUFRLFdBQVcsUUFBUSxHQUFHLFVBQVUsRUFBRTtBQUN2RixVQUFNLE1BQU0sb0JBQUksS0FBSztBQUNyQixVQUFNLGdCQUFnQixDQUFDLE1BQU07QUFDM0IsWUFBTSxJQUFJLElBQUksS0FBSyxJQUFJLFlBQVksR0FBRyxJQUFJLFNBQVMsSUFBSSxHQUFHLENBQUM7QUFDM0QsYUFBTyxPQUFPLEVBQUUsWUFBWSxDQUFDLElBQUksTUFBTSxPQUFPLEVBQUUsU0FBUyxJQUFJLENBQUMsRUFBRSxTQUFTLEdBQUcsR0FBRztBQUFBLElBQ2pGO0FBQ0EsVUFBTSxhQUFhLENBQUMsTUFBTTtBQUN4QixVQUFJLE1BQU07QUFDVixVQUFJLFFBQVE7QUFDWixlQUFTLElBQUksR0FBRyxLQUFLLEdBQUcsS0FBSztBQUMzQixjQUFNLElBQUksY0FBYyxDQUFDO0FBQ3pCLGNBQU0sSUFBSSxJQUFJLE1BQU0sQ0FBQztBQUNyQixZQUFJLEtBQUssT0FBTyxTQUFTLE9BQU8sRUFBRSxHQUFHLENBQUMsR0FBRztBQUN2QyxpQkFBTyxPQUFPLEVBQUUsR0FBRztBQUNuQjtBQUFBLFFBQ0Y7QUFBQSxNQUNGO0FBQ0EsYUFBTyxRQUFRLElBQUksRUFBRSxLQUFLLE1BQU0sT0FBTyxHQUFHLE1BQU0sSUFBSSxFQUFFLEtBQUssR0FBRyxHQUFHLEVBQUU7QUFBQSxJQUNyRTtBQUNBLFVBQU0sT0FBTyxXQUFXLHVCQUF1QjtBQUMvQyxVQUFNLE9BQU8sV0FBVyx5QkFBeUI7QUFFakQsUUFBSSxLQUFLLE1BQU0sS0FBSyxLQUFLLElBQUksS0FBSyxLQUFLLE1BQU0sd0JBQXdCO0FBQ25FLGFBQU8sRUFBRSxPQUFPLEdBQUssUUFBUSxXQUFXLFFBQVEsS0FBSyxLQUFLLFVBQVUsS0FBSyxJQUFJO0FBQUEsSUFDL0U7QUFDQSxRQUFJLFFBQVEsS0FBSyxNQUFNLEtBQUs7QUFDNUIsUUFBSSxRQUFRLGNBQWUsU0FBUTtBQUNuQyxRQUFJLFFBQVEsY0FBZSxTQUFRO0FBQ25DLFdBQU87QUFBQSxNQUNMLE9BQU8sS0FBSyxNQUFNLFFBQVEsR0FBRyxJQUFJO0FBQUEsTUFDakMsUUFBUTtBQUFBLE1BQ1IsUUFBUSxLQUFLLE1BQU0sS0FBSyxNQUFNLEVBQUUsSUFBSTtBQUFBLE1BQ3BDLFVBQVUsS0FBSyxNQUFNLEtBQUssTUFBTSxFQUFFLElBQUk7QUFBQSxJQUN4QztBQUFBLEVBQ0Y7QUFFQSxXQUFTLHdCQUF3QixVQUFVO0FBRXpDLFFBQUksd0JBQXdCLHFCQUFxQixRQUFRLEdBQUc7QUFDMUQsYUFBTztBQUFBLFFBQ0wsT0FBTyxPQUFPLHFCQUFxQixRQUFRLEVBQUUsS0FBSyxLQUFLO0FBQUEsUUFDdkQsUUFBUTtBQUFBLFFBQ1IsTUFBTSx1QkFBdUIsUUFBUTtBQUFBLE1BQ3ZDO0FBQUEsSUFDRjtBQUNBLFVBQU0sT0FBTyx1QkFBdUIsUUFBUTtBQUM1QyxXQUFPLEVBQUUsT0FBTyxLQUFLLE9BQU8sUUFBUSxLQUFLLFFBQVEsS0FBSztBQUFBLEVBQ3hEO0FBRUEsaUJBQWUsd0JBQXdCO0FBQ3JDLFFBQUksQ0FBQyxPQUFPLEtBQU07QUFDbEIsUUFBSTtBQUNGLFlBQU0sTUFBTSxNQUFNLE9BQU8sS0FBSyxXQUFXLGlCQUFpQixFQUFFLElBQUksbUJBQW1CLEVBQUUsSUFBSTtBQUN6RixVQUFJLElBQUksUUFBUTtBQUNkLGNBQU0sSUFBSSxJQUFJLEtBQUssS0FBSyxDQUFDO0FBQ3pCLGNBQU0sTUFBTSxNQUFNLFFBQVEsRUFBRSxJQUFJLElBQUksRUFBRSxPQUFPLENBQUM7QUFDOUMsNEJBQW9CLElBQUksSUFBSSxJQUFJLElBQUksQ0FBQyxNQUFNLE9BQU8sQ0FBQyxFQUFFLEtBQUssRUFBRSxZQUFZLENBQUMsQ0FBQztBQUMxRSw0QkFBb0IsRUFBRSxXQUFXLEVBQUUsV0FBVyxXQUFXLEVBQUUsVUFBVTtBQUFBLE1BQ3ZFLE9BQU87QUFDTCw0QkFBb0Isb0JBQUksSUFBSTtBQUM1Qiw0QkFBb0I7QUFBQSxNQUN0QjtBQUFBLElBQ0YsU0FBUyxHQUFHO0FBQ1YsY0FBUSxLQUFLLDJDQUEyQyxLQUFLLEVBQUUsT0FBTztBQUN0RSwwQkFBb0Isb0JBQUksSUFBSTtBQUFBLElBQzlCO0FBQUEsRUFDRjtBQUVBLGlCQUFlLHdCQUF3QjtBQUNyQyxRQUFJLENBQUMsT0FBTyxRQUFRLENBQUMsa0JBQW1CO0FBQ3hDLFVBQU0sTUFBTyxPQUFPLGVBQWUsT0FBTyxZQUFZLFNBQVU7QUFDaEUsVUFBTSxVQUFVO0FBQUEsTUFDZCxNQUFNLE1BQU0sS0FBSyxpQkFBaUIsRUFBRSxLQUFLO0FBQUEsTUFDekMsWUFBVyxvQkFBSSxLQUFLLEdBQUUsWUFBWTtBQUFBLE1BQ2xDLFdBQVc7QUFBQSxJQUNiO0FBQ0EsVUFBTSxPQUFPLEtBQUssV0FBVyxpQkFBaUIsRUFBRSxJQUFJLG1CQUFtQixFQUFFLElBQUksT0FBTztBQUNwRix3QkFBb0IsRUFBRSxXQUFXLFFBQVEsV0FBVyxXQUFXLFFBQVEsVUFBVTtBQUFBLEVBQ25GO0FBRUEsaUJBQWUsZ0JBQWdCO0FBQzdCLFFBQUksQ0FBQyxPQUFPLEtBQU0sT0FBTSxJQUFJLE1BQU0sMkJBQTJCO0FBQzdELFVBQU0sV0FBVyxDQUFDO0FBQ2xCLFFBQUksQ0FBQyxrQkFBbUIsVUFBUyxLQUFLLHNCQUFzQixDQUFDO0FBQzdELFFBQUksQ0FBQyxxQkFBc0IsVUFBUyxLQUFLLHlCQUF5QixDQUFDO0FBQ25FLFFBQUksQ0FBQyxvQkFBb0I7QUFDdkIsZUFBUztBQUFBLFFBQ1AsT0FBTyxLQUNKLFdBQVcsWUFBWSxFQUN2QixJQUFJLGdCQUFnQixFQUNwQixJQUFJLEVBQ0osS0FBSyxDQUFDLE1BQU07QUFDWCxnQkFBTSxPQUFPLEVBQUUsU0FBUyxFQUFFLEtBQUssSUFBSSxDQUFDO0FBQ3BDLGNBQUksS0FBSyxDQUFDO0FBQ1YsY0FBSSxLQUFLLENBQUM7QUFDVixjQUFJO0FBQ0YsaUJBQUssS0FBSyxxQkFBcUIsS0FBSyxNQUFNLEtBQUssa0JBQWtCLElBQUksQ0FBQztBQUFBLFVBQ3hFLFFBQVE7QUFDTixpQkFBSyxDQUFDO0FBQUEsVUFDUjtBQUNBLGNBQUk7QUFDRixpQkFBSyxLQUFLLGlCQUFpQixLQUFLLE1BQU0sS0FBSyxjQUFjLElBQUksQ0FBQztBQUFBLFVBQ2hFLFFBQVE7QUFDTixpQkFBSyxDQUFDO0FBQUEsVUFDUjtBQUNBLCtCQUFxQixFQUFFLG9CQUFvQixJQUFJLGdCQUFnQixHQUFHO0FBQUEsUUFDcEUsQ0FBQztBQUFBLE1BQ0w7QUFBQSxJQUNGO0FBQ0EsUUFBSSxDQUFDLHFCQUFxQjtBQUN4QixlQUFTO0FBQUEsUUFDUCxPQUFPLEtBQ0osV0FBVyxxQkFBcUIsRUFDaEMsSUFBSSxFQUNKLEtBQUssQ0FBQyxTQUFTO0FBQ2QsZ0JBQU0sTUFBTSxDQUFDO0FBQ2IsZUFBSyxRQUFRLENBQUMsUUFBUTtBQUNwQixrQkFBTSxJQUFJLElBQUksS0FBSztBQUNuQixnQkFBSSxDQUFDLEtBQUssQ0FBQyxFQUFFLElBQUs7QUFDbEIsZ0JBQUksT0FBTyxFQUFFLEdBQUcsRUFBRSxLQUFLLEVBQUUsWUFBWSxDQUFDLElBQUksRUFBRSxPQUFPLEVBQUUsU0FBUyxDQUFDLEVBQUU7QUFBQSxVQUNuRSxDQUFDO0FBQ0QsZ0NBQXNCO0FBQUEsUUFDeEIsQ0FBQztBQUFBLE1BQ0w7QUFBQSxJQUNGO0FBQ0EsVUFBTSxRQUFRLElBQUksUUFBUTtBQUFBLEVBQzVCO0FBRUEsV0FBUyw2QkFBNkIsVUFBVTtBQUc5QyxVQUFNLE1BQU0sdUJBQXVCLG9CQUFvQixRQUFRO0FBQy9ELFFBQUksQ0FBQyxPQUFPLENBQUMsSUFBSSxNQUFPLFFBQU87QUFDL0IsVUFBTSxNQUFNLG9CQUFJLEtBQUs7QUFDckIsVUFBTSxhQUFhLENBQUM7QUFDcEIsYUFBUyxJQUFJLEdBQUcsS0FBSyw0QkFBNEIsS0FBSztBQUNwRCxZQUFNLElBQUksSUFBSSxLQUFLLElBQUksWUFBWSxHQUFHLElBQUksU0FBUyxJQUFJLEdBQUcsQ0FBQztBQUMzRCxpQkFBVyxLQUFLLE9BQU8sRUFBRSxZQUFZLENBQUMsSUFBSSxNQUFNLE9BQU8sRUFBRSxTQUFTLElBQUksQ0FBQyxFQUFFLFNBQVMsR0FBRyxHQUFHLENBQUM7QUFBQSxJQUMzRjtBQUNBLFFBQUksTUFBTTtBQUNWLFFBQUksSUFBSTtBQUNSLGVBQVcsUUFBUSxDQUFDLE1BQU07QUFDeEIsWUFBTSxJQUFJLElBQUksTUFBTSxDQUFDO0FBQ3JCLFVBQUksS0FBSyxPQUFPLFNBQVMsT0FBTyxFQUFFLEdBQUcsQ0FBQyxHQUFHO0FBQ3ZDLGVBQU8sT0FBTyxFQUFFLEdBQUc7QUFDbkI7QUFBQSxNQUNGO0FBQUEsSUFDRixDQUFDO0FBQ0QsV0FBTyxJQUFJLElBQUksTUFBTSxJQUFJO0FBQUEsRUFDM0I7QUFFQSxXQUFTLHdCQUF3QixLQUFLO0FBR3BDLFFBQUksQ0FBQyxPQUFPLENBQUMsSUFBSSxPQUFRLFFBQU87QUFDaEMsVUFBTSxNQUFNLG9CQUFJLEtBQUs7QUFDckIsVUFBTSxhQUFhLE9BQU8sSUFBSSxZQUFZLENBQUMsSUFBSSxNQUFNLE9BQU8sSUFBSSxTQUFTLElBQUksQ0FBQyxFQUFFLFNBQVMsR0FBRyxHQUFHO0FBQy9GLFFBQUksTUFBTTtBQUNWLFdBQU8sS0FBSyxJQUFJLE1BQU0sRUFBRSxRQUFRLENBQUMsTUFBTTtBQUNyQyxVQUFJLEtBQUssV0FBWSxRQUFPLE9BQU8sSUFBSSxPQUFPLENBQUMsS0FBSyxDQUFDO0FBQUEsSUFDdkQsQ0FBQztBQUNELFdBQU87QUFBQSxFQUNUO0FBRUEsV0FBUywwQkFBMEI7QUFHakMsVUFBTSxPQUFPLENBQUM7QUFDZCxVQUFNLFdBQVcsQ0FBQyxRQUFRLE9BQU87QUFDakMsZUFBVyxPQUFPLFVBQVU7QUFDMUIsWUFBTSxRQUFRLGlCQUFpQixHQUFHO0FBQ2xDLFVBQUksQ0FBQyxTQUFTLENBQUMsTUFBTSxLQUFNO0FBQzNCLGlCQUFXLFNBQVMsTUFBTSxNQUFNO0FBQzlCLGNBQU0sTUFBTSxPQUFPLE1BQU0sT0FBTyxFQUFFLEVBQUUsS0FBSztBQUN6QyxjQUFNLFdBQVcsSUFBSSxZQUFZO0FBRWpDLFlBQUkscUJBQXFCLGtCQUFrQixJQUFJLFFBQVEsRUFBRztBQUMxRCxjQUFNLFVBQ0gsc0JBQ0MsbUJBQW1CLHNCQUNuQixtQkFBbUIsbUJBQW1CLEdBQUcsS0FDM0MsQ0FBQztBQUNILGNBQU0sYUFBYSxPQUFPLFFBQVEsSUFBSSxLQUFLLENBQUM7QUFDNUMsY0FBTSxhQUFhLE9BQU8sUUFBUSxJQUFJLEtBQUssQ0FBQztBQUM1QyxjQUFNLFlBQVk7QUFBQSxVQUNmLHNCQUNDLG1CQUFtQixrQkFDbkIsbUJBQW1CLGVBQWUsR0FBRyxLQUNyQztBQUFBLFFBQ0o7QUFDQSxjQUFNLGVBQWUsNkJBQTZCLFFBQVE7QUFDMUQsY0FBTSxlQUFlLHdCQUF3QixLQUFLO0FBQ2xELGNBQU0sTUFBTSxPQUFPLE1BQU0sT0FBTyxDQUFDO0FBRWpDLGNBQU0sV0FBVyx3QkFBd0IsUUFBUTtBQUNqRCxjQUFNLGFBQWEsU0FBUztBQUM1QixjQUFNLGtCQUFrQixlQUFlLGFBQWE7QUFDcEQsY0FBTSxVQUFVLGFBQWEsYUFBYSxlQUFlLFlBQVk7QUFDckUsWUFBSSxjQUFjO0FBQ2xCLFlBQUksVUFBVSxHQUFHO0FBQ2YsZ0JBQU0sVUFBVSxDQUFDO0FBQ2pCLHdCQUFjLE1BQU0sSUFBSSxLQUFLLElBQUksS0FBSyxLQUFLLEtBQUssVUFBVSxHQUFHLElBQUksR0FBRyxJQUFJLEtBQUssS0FBSyxPQUFPO0FBQUEsUUFDM0Y7QUFDQSxhQUFLLEtBQUs7QUFBQSxVQUNSLFNBQVM7QUFBQSxVQUNUO0FBQUEsVUFDQSxhQUFhLE1BQU0sZUFBZTtBQUFBLFVBQ2xDO0FBQUEsVUFDQTtBQUFBLFVBQ0E7QUFBQSxVQUNBO0FBQUEsVUFDQSxjQUFjLEtBQUssTUFBTSxlQUFlLEVBQUUsSUFBSTtBQUFBLFVBQzlDO0FBQUEsVUFDQTtBQUFBLFVBQ0EsWUFBWSxTQUFTO0FBQUE7QUFBQSxVQUNyQixVQUFVLFNBQVMsT0FBTyxTQUFTLEtBQUssUUFBUTtBQUFBO0FBQUEsVUFDaEQsaUJBQWlCLEtBQUssTUFBTSxrQkFBa0IsRUFBRSxJQUFJO0FBQUEsVUFDcEQsU0FBUyxLQUFLLE1BQU0sVUFBVSxFQUFFLElBQUk7QUFBQSxVQUNwQztBQUFBLFFBQ0YsQ0FBQztBQUFBLE1BQ0g7QUFBQSxJQUNGO0FBRUEsU0FBSyxLQUFLLENBQUMsR0FBRyxNQUFNLEVBQUUsY0FBYyxFQUFFLFdBQVc7QUFDakQsV0FBTztBQUFBLEVBQ1Q7QUFFQSxXQUFTLGNBQWMsR0FBRztBQUN4QixRQUFJLEtBQUssUUFBUSxDQUFDLE9BQU8sU0FBUyxPQUFPLENBQUMsQ0FBQyxFQUFHLFFBQU87QUFDckQsVUFBTSxJQUFJLE9BQU8sQ0FBQztBQUNsQixVQUFNLE1BQU0sS0FBSyxJQUFJLENBQUMsRUFBRSxlQUFlLFNBQVMsRUFBRSx1QkFBdUIsRUFBRSxDQUFDO0FBQzVFLFlBQVEsSUFBSSxJQUFJLFdBQU0sTUFBTTtBQUFBLEVBQzlCO0FBRUEsV0FBUyxRQUFRLEdBQUc7QUFDbEIsUUFBSSxLQUFLLFFBQVEsQ0FBQyxPQUFPLFNBQVMsT0FBTyxDQUFDLENBQUMsRUFBRyxRQUFPO0FBQ3JELFdBQU8sS0FBSyxNQUFNLE9BQU8sQ0FBQyxDQUFDLEVBQUUsZUFBZSxPQUFPO0FBQUEsRUFDckQ7QUFHQSxXQUFTLG1CQUFtQixHQUFHO0FBQzdCLFVBQU0sV0FBVyxPQUFPLEVBQUUsR0FBRyxFQUFFLEtBQUssRUFBRSxZQUFZO0FBQ2xELFVBQU0sV0FBVyxFQUFFLGVBQWU7QUFDbEMsVUFBTSxZQUFZLEVBQUUsZUFBZTtBQUNuQyxVQUFNLE1BQU0sT0FBTyxFQUFFLGNBQWMsQ0FBRyxFQUFFLFFBQVEsQ0FBQztBQUVqRCxRQUFJLFdBQVc7QUFDZixRQUFJLEVBQUUsYUFBYSxLQUFNLFlBQVc7QUFBQSxhQUMzQixFQUFFLGFBQWEsS0FBTSxZQUFXO0FBRXpDLFVBQU0sT0FBTyxXQUNULG9NQUNBLFlBQ0Usd01BQ0E7QUFFTixVQUFNLFdBQVcsV0FDYix1Q0FDQSxlQUFlLFFBQVEsSUFDdkIsMEtBQ0E7QUFFSixVQUFNLFdBQ0osWUFBWSxFQUFFLFlBQVksT0FDdEIsOEZBQ0EsT0FBTyxFQUFFLFFBQVEsRUFBRSxRQUFRLENBQUMsSUFDNUIsYUFDQTtBQUVOLFdBQ0UsdUdBRUEsZUFBZSxRQUFRLElBQ3ZCLHdKQUNBLFdBQ0EsaUNBQ0EsTUFDQSxZQUNBLE9BQ0EsV0FDQSxXQUNBO0FBQUEsRUFFSjtBQUVBLFNBQU8saUJBQWlCLFNBQVUsSUFBSSxVQUFVO0FBQzlDLFVBQU0sYUFBYSxXQUFXLEdBQUcsV0FBVyxLQUFLO0FBQ2pELFVBQU0sUUFBUSxTQUFTLGNBQWMsT0FBTztBQUM1QyxVQUFNLE9BQU87QUFDYixVQUFNLE9BQU87QUFDYixVQUFNLE1BQU07QUFDWixVQUFNLE1BQU07QUFDWixVQUFNLFFBQVEsT0FBTyxVQUFVO0FBQy9CLFVBQU0sTUFBTSxVQUNWO0FBQ0YsVUFBTSxTQUFTLEdBQUc7QUFDbEIsV0FBTyxhQUFhLE9BQU8sRUFBRTtBQUM3QixVQUFNLE1BQU07QUFDWixVQUFNLE9BQU87QUFFYixVQUFNLFNBQVMsWUFBWTtBQUN6QixZQUFNLElBQUksV0FBVyxNQUFNLEtBQUs7QUFDaEMsVUFBSSxNQUFNLENBQUMsS0FBSyxJQUFJLE9BQU8sSUFBSSxHQUFHO0FBQ2hDLDJCQUFtQjtBQUNuQjtBQUFBLE1BQ0Y7QUFDQSxVQUFJLEtBQUssSUFBSSxJQUFJLFVBQVUsSUFBSSxNQUFPO0FBQ3BDLDJCQUFtQjtBQUNuQjtBQUFBLE1BQ0Y7QUFDQSxVQUFJO0FBQ0YsY0FBTSx3QkFBd0IsVUFBVSxDQUFDO0FBQ3pDLDJCQUFtQjtBQUFBLE1BQ3JCLFNBQVMsR0FBRztBQUNWLGNBQU0sdUJBQXVCLEVBQUUsV0FBVyxFQUFFO0FBQzVDLDJCQUFtQjtBQUFBLE1BQ3JCO0FBQUEsSUFDRjtBQUVBLFVBQU0sU0FBUyxNQUFNLG1CQUFtQjtBQUV4QyxVQUFNLGlCQUFpQixRQUFRLE1BQU07QUFDckMsVUFBTSxpQkFBaUIsV0FBVyxDQUFDLE9BQU87QUFDeEMsVUFBSSxHQUFHLFFBQVEsU0FBUztBQUN0QixXQUFHLGVBQWU7QUFDbEIsY0FBTSxLQUFLO0FBQUEsTUFDYixXQUFXLEdBQUcsUUFBUSxVQUFVO0FBQzlCLFdBQUcsZUFBZTtBQUNsQixlQUFPO0FBQUEsTUFDVDtBQUFBLElBQ0YsQ0FBQztBQUFBLEVBQ0g7QUFFQSxTQUFPLGtCQUFrQixlQUFnQixVQUFVO0FBQ2pELFFBQUksQ0FBQyxRQUFRLGdDQUFnQyxXQUFXLCtCQUF5QixFQUFHO0FBQ3BGLFFBQUk7QUFDRixZQUFNLDBCQUEwQixRQUFRO0FBQ3hDLHlCQUFtQjtBQUFBLElBQ3JCLFNBQVMsR0FBRztBQUNWLFlBQU0sYUFBYSxFQUFFLFdBQVcsRUFBRTtBQUFBLElBQ3BDO0FBQUEsRUFDRjtBQUVBLFdBQVMscUJBQXFCO0FBQzVCLFVBQU0sT0FBTyxTQUFTLGVBQWUsd0JBQXdCO0FBQzdELFFBQUksQ0FBQyxLQUFNO0FBQ1gsUUFBSTtBQUNGLDZCQUF1QixJQUFJO0FBQUEsSUFDN0IsU0FBUyxHQUFHO0FBQ1YsY0FBUSxNQUFNLCtCQUErQixDQUFDO0FBQzlDLFdBQUssWUFDSCw0UEFHQSxlQUFlLEVBQUUsU0FBUyxFQUFFLFdBQVcsT0FBTyxDQUFDLENBQUMsSUFDaEQ7QUFBQSxJQUNKO0FBQUEsRUFDRjtBQUVBLFdBQVMsdUJBQXVCLE1BQU07QUFDcEMsVUFBTSxZQUFZLENBQUMsRUFBRSxpQkFBaUIsUUFBUSxpQkFBaUI7QUFDL0QsUUFBSSxDQUFDLFdBQVc7QUFDZCxXQUFLLFlBQVk7QUFDakI7QUFBQSxJQUNGO0FBQ0EsUUFBSSxDQUFDLHNCQUFzQixDQUFDLHFCQUFxQjtBQUMvQyxXQUFLLFlBQ0g7QUFJRixvQkFBYyxFQUNYLEtBQUssa0JBQWtCLEVBQ3ZCLE1BQU0sQ0FBQyxNQUFNO0FBQ1osZ0JBQVEsTUFBTSw2QkFBNkIsQ0FBQztBQUM1QyxhQUFLLFlBQ0gsbUVBQ0EsZUFBZSxFQUFFLFdBQVcsT0FBTyxDQUFDLENBQUMsSUFDckM7QUFBQSxNQUNKLENBQUM7QUFDSDtBQUFBLElBQ0Y7QUFDQSxVQUFNLFVBQVUsd0JBQXdCO0FBQ3hDLFVBQU0sV0FBVyxnQkFBZ0IsS0FBSyxFQUFFLFlBQVk7QUFDcEQsVUFBTSxPQUFPLFFBQVEsT0FBTyxDQUFDLE1BQU07QUFDakMsVUFBSSx1QkFBdUIsU0FBUyxFQUFFLFlBQVksbUJBQW9CLFFBQU87QUFDN0UsVUFBSSxxQkFBcUIsRUFBRSxlQUFlLEVBQUcsUUFBTztBQUNwRCxVQUFJLFVBQVU7QUFDWixjQUFNLE1BQ0osRUFBRSxJQUFJLFlBQVksRUFBRSxTQUFTLFFBQVEsS0FBSyxFQUFFLFlBQVksWUFBWSxFQUFFLFNBQVMsUUFBUTtBQUN6RixZQUFJLENBQUMsSUFBSyxRQUFPO0FBQUEsTUFDbkI7QUFDQSxhQUFPO0FBQUEsSUFDVCxDQUFDO0FBQ0QsVUFBTSxZQUFZLFFBQVEsT0FBTyxDQUFDLEdBQUcsTUFBTSxJQUFJLEVBQUUsYUFBYSxDQUFDO0FBQy9ELFVBQU0sZUFBZSxRQUFRLE9BQU8sQ0FBQyxNQUFNLEVBQUUsY0FBYyxDQUFDLEVBQUU7QUFFOUQsVUFBTSxRQUFRLG9CQUFvQixrQkFBa0IsT0FBTztBQUMzRCxVQUFNLFdBQ0osUUFBUSxJQUNKLGtPQUNBLFFBQVEsS0FBSyxJQUNiLDZCQUNBO0FBRU4sVUFBTSxTQUNKLHlYQUdBLHNCQUNBLGdJQUVBLFFBQVEsWUFBWSxJQUNwQiw2SUFFQSxRQUFRLFNBQVMsSUFDakIsb0JBQ0EsV0FDQTtBQUVGLFVBQU0sVUFDSiw0TkFFQSxlQUFlLGVBQWUsSUFDOUIscWJBR0MsdUJBQXVCLFFBQVEsY0FBYyxNQUM5QyxzREFFQyx1QkFBdUIsU0FBUyxjQUFjLE1BQy9DLHlEQUVDLHVCQUF1QixVQUFVLGNBQWMsTUFDaEQsZ01BSUMsb0JBQW9CLGFBQWEsTUFDbEM7QUFLRixVQUFNLFdBQVcsS0FDZCxJQUFJLENBQUMsTUFBTTtBQUNWLFlBQU0sV0FBVyxFQUFFLFVBQVUsSUFBSSxZQUFZLEVBQUUsVUFBVSxLQUFLLFlBQVk7QUFDMUUsWUFBTSxXQUFXLEVBQUUsY0FBYyxJQUFJLFlBQVk7QUFDakQsYUFDRSw2TEFFQyxFQUFFLFlBQVksU0FBUyxZQUFZLGFBQ3BDLGtEQUNDLEVBQUUsWUFBWSxTQUFTLFFBQVEsVUFDaEMsOElBRUEsZUFBZSxFQUFFLEdBQUcsSUFDcEIsa0tBRUEsZUFBZSxFQUFFLFdBQVcsSUFDNUIsT0FDQSxlQUFlLEVBQUUsV0FBVyxJQUM1QixvSEFFQSxRQUFRLEVBQUUsVUFBVSxJQUNwQixrSEFFQSxRQUFRLEVBQUUsVUFBVSxJQUNwQix3R0FFQSxRQUFRLEVBQUUsU0FBUyxJQUNuQixzSEFFQSxRQUFRLEVBQUUsWUFBWSxJQUN0Qix3REFFQSxtQkFBbUIsQ0FBQyxJQUNwQixzSEFFQSxRQUFRLEVBQUUsZUFBZSxJQUN6QixvSUFFQSxRQUFRLEVBQUUsWUFBWSxJQUN0QiwrR0FFQSxXQUNBLE9BQ0EsY0FBYyxFQUFFLE9BQU8sSUFDdkIsaUlBRUEsUUFBUSxFQUFFLEdBQUcsSUFDYix5SUFFQSxXQUNBLGdFQUNBLFFBQVEsRUFBRSxXQUFXLElBQ3JCLGdHQUdBLGVBQWUsRUFBRSxHQUFHLElBQ3BCLFNBQ0EsZUFBZSxFQUFFLFlBQVksUUFBUSxNQUFNLEVBQUUsQ0FBQyxJQUM5QztBQUFBLElBSUosQ0FBQyxFQUNBLEtBQUssRUFBRTtBQUtWLFVBQU0sUUFDSiwyM0RBa0JDLEtBQUssU0FDRixXQUNBLDJJQUNKO0FBRUYsVUFBTSxTQUNKLGtGQUVBLFFBQVEsS0FBSyxNQUFNLElBQ25CLFNBQ0EsUUFBUSxRQUFRLE1BQU0sSUFDdEI7QUFJRixTQUFLLFlBQ0gseUNBQXlDLFNBQVMsVUFBVSxRQUFRLFNBQVM7QUFBQSxFQUNqRjtBQUVBLFNBQU8scUJBQXFCLFNBQVUsSUFBSTtBQUN4QyxzQkFBa0IsR0FBRyxPQUFPLFNBQVM7QUFDckMsdUJBQW1CO0FBRW5CLGVBQVcsTUFBTTtBQUNmLFlBQU0sTUFBTSxTQUFTLGVBQWUsYUFBYTtBQUNqRCxVQUFJLEtBQUs7QUFDUCxZQUFJLE1BQU07QUFDVixZQUFJLGtCQUFrQixJQUFJLE1BQU0sUUFBUSxJQUFJLE1BQU0sTUFBTTtBQUFBLE1BQzFEO0FBQUEsSUFDRixHQUFHLENBQUM7QUFBQSxFQUNOO0FBRUEsU0FBTyxzQkFBc0IsU0FBVSxJQUFJO0FBQ3pDLHlCQUFxQixHQUFHLE9BQU8sU0FBUztBQUN4Qyx1QkFBbUI7QUFBQSxFQUNyQjtBQUVBLFNBQU8sd0JBQXdCLFNBQVUsSUFBSTtBQUMzQyx3QkFBb0IsQ0FBQyxDQUFDLEdBQUcsT0FBTztBQUNoQyx1QkFBbUI7QUFBQSxFQUNyQjtBQUVBLFNBQU8sa0JBQWtCLFdBQVk7QUFDbkMsUUFBSSxPQUFPLFNBQVMsYUFBYTtBQUMvQixZQUFNLDJCQUEyQjtBQUNqQztBQUFBLElBQ0Y7QUFDQSxVQUFNLE9BQU8sd0JBQXdCO0FBQ3JDLFVBQU0sTUFBTTtBQUFBLE1BQ1Y7QUFBQSxRQUNFO0FBQUEsUUFDQTtBQUFBLFFBQ0E7QUFBQSxRQUNBO0FBQUEsUUFDQTtBQUFBLFFBQ0E7QUFBQSxRQUNBO0FBQUEsUUFDQTtBQUFBLFFBQ0E7QUFBQSxRQUNBO0FBQUEsUUFDQTtBQUFBLFFBQ0E7QUFBQSxRQUNBO0FBQUEsUUFDQTtBQUFBLE1BQ0Y7QUFBQSxJQUNGO0FBQ0EsZUFBVyxLQUFLLE1BQU07QUFDcEIsVUFBSSxLQUFLO0FBQUEsUUFDUCxFQUFFLFlBQVksU0FBUyxvQkFBaUI7QUFBQSxRQUN4QyxFQUFFO0FBQUEsUUFDRixFQUFFO0FBQUEsUUFDRixFQUFFO0FBQUEsUUFDRixFQUFFO0FBQUEsUUFDRixFQUFFO0FBQUEsUUFDRixFQUFFO0FBQUEsUUFDRixFQUFFO0FBQUEsUUFDRixFQUFFLGNBQWM7QUFBQSxRQUNoQixFQUFFO0FBQUEsUUFDRixFQUFFO0FBQUEsUUFDRixFQUFFO0FBQUEsUUFDRixFQUFFO0FBQUEsUUFDRixFQUFFO0FBQUEsTUFDSixDQUFDO0FBQUEsSUFDSDtBQUNBLFVBQU0sS0FBSyxLQUFLLE1BQU0sYUFBYSxHQUFHO0FBQ3RDLE9BQUcsT0FBTyxJQUFJO0FBQUEsTUFDWixFQUFFLEtBQUssR0FBRztBQUFBO0FBQUEsTUFDVixFQUFFLEtBQUssR0FBRztBQUFBO0FBQUEsTUFDVixFQUFFLEtBQUssR0FBRztBQUFBO0FBQUEsTUFDVixFQUFFLEtBQUssRUFBRTtBQUFBO0FBQUEsTUFDVCxFQUFFLEtBQUssR0FBRztBQUFBO0FBQUEsTUFDVixFQUFFLEtBQUssR0FBRztBQUFBO0FBQUEsTUFDVixFQUFFLEtBQUssR0FBRztBQUFBO0FBQUEsTUFDVixFQUFFLEtBQUssR0FBRztBQUFBO0FBQUEsTUFDVixFQUFFLEtBQUssR0FBRztBQUFBO0FBQUEsTUFDVixFQUFFLEtBQUssR0FBRztBQUFBO0FBQUEsTUFDVixFQUFFLEtBQUssR0FBRztBQUFBO0FBQUEsTUFDVixFQUFFLEtBQUssR0FBRztBQUFBO0FBQUEsTUFDVixFQUFFLEtBQUssRUFBRTtBQUFBO0FBQUEsTUFDVCxFQUFFLEtBQUssR0FBRztBQUFBO0FBQUEsSUFDWjtBQUNBLFVBQU0sS0FBSyxLQUFLLE1BQU0sU0FBUztBQUMvQixTQUFLLE1BQU0sa0JBQWtCLElBQUksSUFBSSxrQkFBZTtBQUNwRCxVQUFNLE1BQU0sb0JBQUksS0FBSztBQUNyQixVQUFNLFFBQ0osSUFBSSxZQUFZLElBQ2hCLE1BQ0EsT0FBTyxJQUFJLFNBQVMsSUFBSSxDQUFDLEVBQUUsU0FBUyxHQUFHLEdBQUcsSUFDMUMsTUFDQSxPQUFPLElBQUksUUFBUSxDQUFDLEVBQUUsU0FBUyxHQUFHLEdBQUc7QUFDdkMsU0FBSyxVQUFVLElBQUksMEJBQTBCLFFBQVEsT0FBTztBQUFBLEVBQzlEO0FBR0EsU0FBTyxpQkFBaUIsZUFBZ0IsS0FBSyxhQUFhO0FBQ3hELFFBQUksQ0FBQyxrQkFBbUIscUJBQW9CLG9CQUFJLElBQUk7QUFDcEQsVUFBTSxRQUFRLE9BQU8sR0FBRyxFQUFFLEtBQUssRUFBRSxZQUFZO0FBQzdDLFVBQU0sUUFBUSxjQUFjLE1BQU0sYUFBUSxZQUFZLE1BQU0sR0FBRyxFQUFFLElBQUk7QUFDckUsUUFDRSxDQUFDO0FBQUEsTUFDQyxrQkFDRSxRQUNBO0FBQUEsSUFDSixHQUNBO0FBQ0E7QUFBQSxJQUNGO0FBQ0Esc0JBQWtCLElBQUksS0FBSztBQUMzQixRQUFJO0FBQ0YsWUFBTSxzQkFBc0I7QUFDNUIseUJBQW1CO0FBQUEsSUFDckIsU0FBUyxHQUFHO0FBQ1Ysd0JBQWtCLE9BQU8sS0FBSztBQUM5QixZQUFNLHVCQUF1QixFQUFFLFdBQVcsRUFBRTtBQUFBLElBQzlDO0FBQUEsRUFDRjtBQUVBLFNBQU8sZ0JBQWdCLGVBQWdCLEtBQUs7QUFDMUMsUUFBSSxDQUFDLGtCQUFtQjtBQUN4QixVQUFNLFFBQVEsT0FBTyxHQUFHLEVBQUUsS0FBSyxFQUFFLFlBQVk7QUFDN0Msc0JBQWtCLE9BQU8sS0FBSztBQUM5QixRQUFJO0FBQ0YsWUFBTSxzQkFBc0I7QUFDNUIsK0JBQXlCO0FBQ3pCLHlCQUFtQjtBQUFBLElBQ3JCLFNBQVMsR0FBRztBQUNWLHdCQUFrQixJQUFJLEtBQUs7QUFDM0IsWUFBTSx1QkFBdUIsRUFBRSxXQUFXLEVBQUU7QUFBQSxJQUM5QztBQUFBLEVBQ0Y7QUFFQSxTQUFPLHdCQUF3QixXQUFZO0FBQ3pDLFVBQU0sV0FBVyxTQUFTLGVBQWUseUJBQXlCO0FBQ2xFLFFBQUksU0FBVSxVQUFTLE9BQU87QUFDOUIsVUFBTSxLQUFLLFNBQVMsY0FBYyxLQUFLO0FBQ3ZDLE9BQUcsS0FBSztBQUNSLE9BQUcsTUFBTSxVQUNQO0FBQ0YsT0FBRyxVQUFVLENBQUMsT0FBTztBQUNuQixVQUFJLEdBQUcsV0FBVyxHQUFJLElBQUcsT0FBTztBQUFBLElBQ2xDO0FBQ0EsT0FBRyxZQUNEO0FBQ0YsYUFBUyxLQUFLLFlBQVksRUFBRTtBQUM1Qiw2QkFBeUI7QUFBQSxFQUMzQjtBQUVBLFdBQVMsMkJBQTJCO0FBQ2xDLFVBQU0sT0FBTyxTQUFTLGVBQWUsNEJBQTRCO0FBQ2pFLFFBQUksQ0FBQyxLQUFNO0FBQ1gsVUFBTSxPQUFPLG9CQUFvQixNQUFNLEtBQUssaUJBQWlCLEVBQUUsS0FBSyxJQUFJLENBQUM7QUFFekUsVUFBTSxZQUFZLENBQUM7QUFDbkIsZUFBVyxPQUFPLENBQUMsUUFBUSxPQUFPLEdBQUc7QUFDbkMsWUFBTSxRQUFRLGlCQUFpQixHQUFHO0FBQ2xDLFVBQUksU0FBUyxNQUFNLE1BQU07QUFDdkIsbUJBQVcsS0FBSyxNQUFNLE1BQU07QUFDMUIsb0JBQVUsT0FBTyxFQUFFLEdBQUcsRUFBRSxLQUFLLEVBQUUsWUFBWSxDQUFDLElBQUksRUFBRSxlQUFlO0FBQUEsUUFDbkU7QUFBQSxNQUNGO0FBQUEsSUFDRjtBQUNBLFVBQU0sT0FDSiwwUUFHQSxLQUFLLFNBQ0w7QUFJRixVQUFNLE9BQ0osS0FBSyxXQUFXLElBQ1osNk5BQ0EsNkRBQ0EsS0FDRyxJQUFJLENBQUMsUUFBUTtBQUNaLFlBQU0sT0FBTyxVQUFVLEdBQUcsS0FBSztBQUMvQixhQUNFLCtOQUVBLGVBQWUsR0FBRyxJQUNsQixZQUNDLE9BQ0csd0VBQ0EsZUFBZSxJQUFJLElBQ25CLFdBQ0EsTUFDSiwyQ0FFQSxlQUFlLEdBQUcsSUFDbEI7QUFBQSxJQUdKLENBQUMsRUFDQSxLQUFLLEVBQUUsSUFDVjtBQUNOLFNBQUssWUFBWSxPQUFPO0FBQUEsRUFDMUI7IiwKICAibmFtZXMiOiBbXQp9Cg==
