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
    const nDisc = _discontinuedSkus ? _discontinuedSkus.size : 0;
    const discChip = nDisc > 0 ? '<button onclick="openDiscontinuedModal()" style="padding:6px 12px;background:#9333ea;color:#fff;border:none;border-radius:6px;font-size:12px;font-weight:700;cursor:pointer" title="Gestionar SKUs descontinuados">\u{1F6AB} ' + _fmtInt(nDisc) + " descontinuados</button>" : "";
    const header = '<div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-bottom:12px"><div style="flex:1;min-width:280px"><div style="font-size:18px;font-weight:800;color:var(--text-primary)">Recomendaci\xF3n de Compra</div><div style="font-size:11px;color:var(--text-muted);margin-top:2px">Balance = Stock + Tr\xE1nsito + Plan \u2212 Backorder \u2212 (Venta mens. \xD7 ' + RECO_HORIZON_MONTHS + 'm)</div></div><div style="padding:6px 12px;background:#0d9488;color:#fff;border-radius:6px;font-size:12px;font-weight:700">' + _fmtInt(totalConReco) + ' SKUs con reco</div><div style="padding:6px 12px;background:#134e4a;color:#fff;border-radius:6px;font-size:12px;font-weight:700">\u03A3 ' + _fmtInt(totalReco) + " unidades</div>" + discChip + "</div>";
    const filters = '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:10px;padding:10px;background:var(--bg-secondary);border-radius:6px"><input type="text" id="reco-search" placeholder="Buscar SKU o descripcion..." value="' + escapeHtmlSafe(_recoSearchText) + '" oninput="onRecoSearchChange(event)" style="flex:1;min-width:200px;padding:6px 10px;border:1px solid var(--border-subtle);border-radius:4px;font-size:12px;background:var(--bg-elevated);color:var(--text-primary)"/><select onchange="onRecoFamiliaChange(event)" style="padding:6px 10px;border:1px solid var(--border-subtle);border-radius:4px;font-size:12px;background:var(--bg-elevated);color:var(--text-primary)"><option value="all"' + (_recoFilterFamilia === "all" ? " selected" : "") + '>Todas las familias</option><option value="rods"' + (_recoFilterFamilia === "rods" ? " selected" : "") + '>Solo Rods (Ca\xF1as)</option><option value="reels"' + (_recoFilterFamilia === "reels" ? " selected" : "") + '>Solo Reels</option></select><label style="display:inline-flex;align-items:center;gap:6px;padding:6px 10px;font-size:12px;color:var(--text-primary);cursor:pointer"><input type="checkbox"' + (_recoFilterMinRec ? " checked" : "") + ' onchange="onRecoFilterMinChange(event)"/>Solo con recomendado &gt; 0</label><button onclick="exportRecoExcel()" style="padding:6px 12px;background:#16a34a;color:#fff;border:none;border-radius:4px;font-size:12px;font-weight:700;cursor:pointer">\u2B07 Excel</button></div>';
    const rowsHtml = rows.map((r) => {
      const balColor = r.balance < 0 ? "#dc2626" : r.balance < 50 ? "#f59e0b" : "#16a34a";
      const recColor = r.recomendado > 0 ? "#dc2626" : "#94a3b8";
      return '<tr style="border-bottom:1px solid var(--border-subtle)"><td style="padding:6px 8px;text-align:center"><span style="display:inline-block;padding:2px 6px;border-radius:10px;background:' + (r.familia === "rods" ? "#0ea5e9" : "#8b5cf6") + ';color:#fff;font-size:10px;font-weight:700">' + (r.familia === "rods" ? "ROD" : "REEL") + '</span></td><td style="padding:6px 8px;text-align:center;font-family:monospace;font-size:11px;color:var(--text-primary);font-weight:700">' + escapeHtmlSafe(r.sku) + '</td><td style="padding:6px 8px;font-size:11px;color:var(--text-secondary);max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + escapeHtmlSafe(r.description) + '">' + escapeHtmlSafe(r.description) + '</td><td style="padding:6px 8px;text-align:center;font-variant-numeric:tabular-nums;color:var(--text-primary)">' + _fmtInt(r.stockLibre) + '</td><td style="padding:6px 8px;text-align:center;font-variant-numeric:tabular-nums;color:var(--text-muted)">' + _fmtInt(r.enTransito) + '</td><td style="padding:6px 8px;text-align:center;font-variant-numeric:tabular-nums;color:#dc2626">' + _fmtInt(r.backorder) + '</td><td style="padding:6px 8px;text-align:center;font-variant-numeric:tabular-nums;color:var(--text-secondary)">' + _fmtInt(r.ventaMensual) + '</td><td style="padding:6px 8px;text-align:center;font-variant-numeric:tabular-nums;color:var(--text-secondary)">' + _fmtInt(r.demandaEsperada) + '</td><td style="padding:6px 8px;text-align:center;font-variant-numeric:tabular-nums;color:var(--text-primary);font-weight:600">' + _fmtInt(r.salesPlanFut) + '</td><td style="padding:6px 8px;text-align:center;font-variant-numeric:tabular-nums;font-weight:700;color:' + balColor + '">' + _fmtNumSigned(r.balance) + '</td><td style="padding:6px 8px;text-align:center;font-variant-numeric:tabular-nums;color:var(--text-muted);font-size:11px">' + _fmtInt(r.moq) + '</td><td style="padding:6px 8px;text-align:center"><span style="display:inline-block;padding:4px 10px;border-radius:12px;background:' + recColor + ';color:#fff;font-size:12px;font-weight:800;min-width:50px">' + _fmtInt(r.recomendado) + `</span></td><td style="padding:6px 8px;text-align:center"><button onclick="discontinueSku('` + escapeHtmlSafe(r.sku) + "', '" + escapeHtmlSafe(r.description.replace(/'/g, "")) + `')" title="Descontinuar este SKU" style="background:transparent;border:1px solid var(--border-subtle);border-radius:4px;padding:4px 8px;cursor:pointer;font-size:14px;color:var(--text-muted)">\u{1F5D1}</button></td></tr>`;
    }).join("");
    const table = '<div style="overflow:auto;max-height:60vh;border:1px solid var(--border-subtle);border-radius:8px"><table style="width:100%;border-collapse:collapse;font-size:12px"><thead style="background:#0f172a;color:#fff;position:sticky;top:0;z-index:1"><tr><th style="padding:8px;text-align:center;font-size:10px;text-transform:uppercase">Fam</th><th style="padding:8px;text-align:center;font-size:10px;text-transform:uppercase">SKU</th><th style="padding:8px;text-align:center;font-size:10px;text-transform:uppercase">Descripci\xF3n</th><th style="padding:8px;text-align:center;font-size:10px;text-transform:uppercase" title="Whs 11 disponible venta">Stock</th><th style="padding:8px;text-align:center;font-size:10px;text-transform:uppercase" title="Whs 12">Tr\xE1nsito</th><th style="padding:8px;text-align:center;font-size:10px;text-transform:uppercase">Backorder</th><th style="padding:8px;text-align:center;font-size:10px;text-transform:uppercase" title="Promedio \xFAltimos 3 meses">Vta/mes</th><th style="padding:8px;text-align:center;font-size:10px;text-transform:uppercase" title="Vta/mes \xD7 7 meses">Demanda esp.</th><th style="padding:8px;text-align:center;font-size:10px;text-transform:uppercase" title="Suma columnas Sales Plan desde mes actual">Plan futuro</th><th style="padding:8px;text-align:center;font-size:10px;text-transform:uppercase">Balance</th><th style="padding:8px;text-align:center;font-size:10px;text-transform:uppercase">MOQ</th><th style="padding:8px;text-align:center;font-size:10px;text-transform:uppercase;background:#134e4a">Recomendado</th><th style="padding:8px;text-align:center;font-size:10px;text-transform:uppercase" title="Descontinuar SKU">Acci\xF3n</th></tr></thead><tbody>' + (rows.length ? rowsHtml : '<tr><td colspan="13" style="padding:40px;text-align:center;color:var(--text-muted)">Sin resultados con los filtros actuales</td></tr>') + "</tbody></table></div>";
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL3B1cmUvc2FsZXMtcGxhbi1wYXJzZXIuanMiLCAiLi4vc3JjL2RvbWFpbnMvZm9yZWNhc3QuanMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbIi8vIEB0cy1ub2NoZWNrXHJcbi8vIFB1cmU6IHBhcnNlYSB1biBzaGVldCBTYWxlcyBQbGFuIChmb3JtYXRvIFNVUi9TQVIgZGUgU2hpbWFubykgYSBlc3RydWN0dXJhXHJcbi8vIG5vcm1hbGl6YWRhIHsgc2t1LCBkZXNjcmlwdGlvbiwgbW9xLCBtb250aHM6IHsnWVlZWS1NTSc6IE59IH0uXHJcbi8vIFNpbiBkZXBlbmRlbmNpYXMgXHUyMDE0IHJlY2liZSBlbCBzaGVldCB5YSBkZXNlcmlhbGl6YWRvIHBvciBTaGVldEpTXHJcbi8vIChYTFNYLnV0aWxzLnNoZWV0X3RvX2pzb24oc2hlZXQsIHtoZWFkZXI6MSwgZGVmdmFsOicnfSkpLlxyXG4vLyBUZXN0ZWFibGUgZW4gdml0ZXN0IHNpbiBjYXJnYXIgWExTWC5cclxuLy9cclxuLy8gQ29udGV4dG86IGxvcyBTYWxlcyBQbGFucyBkZSBTaGltYW5vIHZpZW5lbiBjb24gaGVhZGVycyBjb21vXHJcbi8vIFwiU0tVIENvZGUvUGFydCBOb1wiLCBcIkRlc2NyaXB0aW9uXCIsIFwiTU9RIDEyIG1vbnRoc1wiIHkgY29sdW1uYXMgZGUgbWVzZXNcclxuLy8gdGlwbyBcIkphbiAyMDI3XCIsIFwiTWF5IDIwMjdcIiAoYSB2ZWNlcyBjb24gYVx1MDBGMW8gZW4gdW5hIGZpbGEgYXJyaWJhIHkgZWwgbWVzXHJcbi8vIGVuIGxhIGZpbGEgaGVhZGVyKS4gRXN0YSBmbiB0b2xlcmEgYW1ib3MgbGF5b3V0cy5cclxuXHJcbmNvbnN0IE1PTlRIX0FMSUFTRVMgPSB7XHJcbiAgamFuOiAxLFxyXG4gIGphbnVhcnk6IDEsXHJcbiAgZW5lOiAxLFxyXG4gIGVuZXJvOiAxLFxyXG4gIGZlYjogMixcclxuICBmZWJydWFyeTogMixcclxuICBmZWJyZXJvOiAyLFxyXG4gIG1hcjogMyxcclxuICBtYXJjaDogMyxcclxuICBtYXJ6bzogMyxcclxuICBhcHI6IDQsXHJcbiAgYXByaWw6IDQsXHJcbiAgYWJyOiA0LFxyXG4gIGFicmlsOiA0LFxyXG4gIG1heTogNSxcclxuICBtYXlvOiA1LFxyXG4gIGp1bjogNixcclxuICBqdW5lOiA2LFxyXG4gIGp1bmlvOiA2LFxyXG4gIGp1bDogNyxcclxuICBqdWx5OiA3LFxyXG4gIGp1bGlvOiA3LFxyXG4gIGF1ZzogOCxcclxuICBhdWd1c3Q6IDgsXHJcbiAgYWdvOiA4LFxyXG4gIGFnb3N0bzogOCxcclxuICBzZXA6IDksXHJcbiAgc2VwdDogOSxcclxuICBzZXB0ZW1iZXI6IDksXHJcbiAgc2VwdGllbWJyZTogOSxcclxuICBvY3Q6IDEwLFxyXG4gIG9jdG9iZXI6IDEwLFxyXG4gIG9jdHVicmU6IDEwLFxyXG4gIG5vdjogMTEsXHJcbiAgbm92ZW1iZXI6IDExLFxyXG4gIG5vdmllbWJyZTogMTEsXHJcbiAgZGVjOiAxMixcclxuICBkZWNlbWJlcjogMTIsXHJcbiAgZGljOiAxMixcclxuICBkaWNpZW1icmU6IDEyLFxyXG59O1xyXG5cclxuLy8gTm9ybWFsaXphIGxhYmVscyBkZSBtZXNlcyBhICdZWVlZLU1NJy4gUmV0b3JuYSBudWxsIHNpIG5vIG1hdGNoZWEuXHJcbi8vIEZvcm1hdG9zIHNvcG9ydGFkb3M6IFwiSmFuIDIwMjdcIiwgXCJFbmUtMjdcIiwgXCJKYW4vMjAyN1wiLCBcIk1heTI3XCIsXHJcbi8vIFwiMjAyNy0wMVwiLCBcIjAxLzIwMjdcIiwgXCJKYW4uMjAyN1wiLCBcIjIwMjFcXG5KYW5cIiAobXVsdGktbGluZSBFeGNlbCkuXHJcbmZ1bmN0aW9uIG5vcm1hbGl6ZU1vbnRoTGFiZWwobGFiZWwpIHtcclxuICBpZiAobGFiZWwgPT0gbnVsbCkgcmV0dXJuIG51bGw7XHJcbiAgLy8gdjExMDQ6IGNvbGFwc2FyIG5ld2xpbmVzL3RhYnMgYSBlc3BhY2lvIGFudGVzIGRlbCB0cmltLlxyXG4gIC8vIEVsIGZvcm1hdG8gRXhjZWwgXCIyMDIxXFxuSmFuXCIgKGFcdTAwRjFvIGVuIEwxLCBtZXMgZW4gTDIgZGVudHJvIGRlIHVuYSBjZWxkYVxyXG4gIC8vIG11bHRpLXJvdykgZXMgY29tXHUwMEZBbiBlbiBTYWxlcyBQbGFucyBTVVIuIGBcXHMrYCBtYXRjaGVhIHdoaXRlc3BhY2UgaW5jbHV5ZW5kb1xyXG4gIC8vIFxcbiB5IFxcclxcbi5cclxuICBjb25zdCBzID0gU3RyaW5nKGxhYmVsKS5yZXBsYWNlKC9cXHMrL2csICcgJykudHJpbSgpLnRvTG93ZXJDYXNlKCk7XHJcbiAgaWYgKCFzKSByZXR1cm4gbnVsbDtcclxuICBsZXQgbTtcclxuICAvLyBcImphbiAyMDI3XCIgfCBcImphbi0yN1wiIHwgXCJlbmUvMjAyN1wiIHwgXCJtYXkyN1wiIHwgXCJtYXkuMjAyN1wiXHJcbiAgbSA9IHMubWF0Y2goL14oW2Etelx1MDBFMVx1MDBFOVx1MDBFRFx1MDBGM1x1MDBGQV17MywxMH0pW1xcc1xcLS8uX10qKFxcZHsyLDR9KSQvKTtcclxuICBpZiAobSkge1xyXG4gICAgY29uc3QgbW9uID0gTU9OVEhfQUxJQVNFU1ttWzFdXSB8fCBNT05USF9BTElBU0VTW21bMV0uc2xpY2UoMCwgMyldO1xyXG4gICAgaWYgKG1vbikge1xyXG4gICAgICBsZXQgeSA9IHBhcnNlSW50KG1bMl0sIDEwKTtcclxuICAgICAgaWYgKHkgPCAxMDApIHkgPSAyMDAwICsgeTtcclxuICAgICAgcmV0dXJuIFN0cmluZyh5KS5wYWRTdGFydCg0LCAnMCcpICsgJy0nICsgU3RyaW5nKG1vbikucGFkU3RhcnQoMiwgJzAnKTtcclxuICAgIH1cclxuICB9XHJcbiAgLy8gXCIyMDIxIGphblwiIHwgXCIyMDI3IGRpY1wiIChhXHUwMEYxbyBwcmltZXJvICsgbWVzLCBmb3JtYXRvIEV4Y2VsIG11bHRpLWxpbmVcclxuICAvLyBjb2xhcHNhZG8gdHJhcyByZXBsYWNlIFxccyspLlxyXG4gIG0gPSBzLm1hdGNoKC9eKFxcZHs0fSlbXFxzXFwtLy5fXSsoW2Etelx1MDBFMVx1MDBFOVx1MDBFRFx1MDBGM1x1MDBGQV17MywxMH0pJC8pO1xyXG4gIGlmIChtKSB7XHJcbiAgICBjb25zdCB5ID0gcGFyc2VJbnQobVsxXSwgMTApO1xyXG4gICAgY29uc3QgbW9uID0gTU9OVEhfQUxJQVNFU1ttWzJdXSB8fCBNT05USF9BTElBU0VTW21bMl0uc2xpY2UoMCwgMyldO1xyXG4gICAgaWYgKG1vbikgcmV0dXJuIFN0cmluZyh5KS5wYWRTdGFydCg0LCAnMCcpICsgJy0nICsgU3RyaW5nKG1vbikucGFkU3RhcnQoMiwgJzAnKTtcclxuICB9XHJcbiAgLy8gXCIyMDI3LTAxXCIgfCBcIjIwMjcvMDFcIlxyXG4gIG0gPSBzLm1hdGNoKC9eKFxcZHs0fSlbLS9dKFxcZHsxLDJ9KSQvKTtcclxuICBpZiAobSkge1xyXG4gICAgY29uc3QgeSA9IHBhcnNlSW50KG1bMV0sIDEwKTtcclxuICAgIGNvbnN0IG1vbiA9IHBhcnNlSW50KG1bMl0sIDEwKTtcclxuICAgIGlmIChtb24gPj0gMSAmJiBtb24gPD0gMTIpXHJcbiAgICAgIHJldHVybiBTdHJpbmcoeSkucGFkU3RhcnQoNCwgJzAnKSArICctJyArIFN0cmluZyhtb24pLnBhZFN0YXJ0KDIsICcwJyk7XHJcbiAgfVxyXG4gIC8vIFwiMDEvMjAyN1wiIHwgXCIwMS0yMDI3XCJcclxuICBtID0gcy5tYXRjaCgvXihcXGR7MSwyfSlbLS9dKFxcZHs0fSkkLyk7XHJcbiAgaWYgKG0pIHtcclxuICAgIGNvbnN0IG1vbiA9IHBhcnNlSW50KG1bMV0sIDEwKTtcclxuICAgIGNvbnN0IHkgPSBwYXJzZUludChtWzJdLCAxMCk7XHJcbiAgICBpZiAobW9uID49IDEgJiYgbW9uIDw9IDEyKVxyXG4gICAgICByZXR1cm4gU3RyaW5nKHkpLnBhZFN0YXJ0KDQsICcwJykgKyAnLScgKyBTdHJpbmcobW9uKS5wYWRTdGFydCgyLCAnMCcpO1xyXG4gIH1cclxuICByZXR1cm4gbnVsbDtcclxufVxyXG5cclxuLy8gQnVzY2EgbGEgZmlsYSBoZWFkZXIgKDAtYmFzZWQpLiBFc2NhbmVhIGxhcyBwcmltZXJhcyAzMCBmaWxhcy5cclxuZnVuY3Rpb24gZmluZEhlYWRlclJvdyhyb3dzKSB7XHJcbiAgY29uc3QgSEVBREVSX01BUktFUlMgPSBbXHJcbiAgICAnc2t1IGNvZGUvcGFydCBubycsXHJcbiAgICAnc2t1IGNvZGUnLFxyXG4gICAgJ3NrdScsXHJcbiAgICAncGFydCBubycsXHJcbiAgICAncGFydCBudW1iZXInLFxyXG4gICAgJ2l0ZW1jb2RlJyxcclxuICAgICdpdGVtIGNvZGUnLFxyXG4gICAgJ2NvZGlnbycsXHJcbiAgICAnY1x1MDBGM2RpZ28nLFxyXG4gIF07XHJcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBNYXRoLm1pbihyb3dzLmxlbmd0aCwgMzApOyBpKyspIHtcclxuICAgIGNvbnN0IHJvdyA9IHJvd3NbaV0gfHwgW107XHJcbiAgICBmb3IgKGNvbnN0IGNlbGwgb2Ygcm93KSB7XHJcbiAgICAgIC8vIHYxMTA0OiBjb2xhcHNhciBuZXdsaW5lcyBhIGVzcGFjaW8gcGFyYSBtYXRjaGVhciBoZWFkZXJzIGNvbW9cclxuICAgICAgLy8gXCJTS1UgQ29kZS9QYXJ0IE5vXCIgKG9rKSBvIFwiU0tVXFxuQ29kZVwiIChuZWNlc2l0YSBjb2xhcHNhcikuXHJcbiAgICAgIGNvbnN0IHMgPSBTdHJpbmcoY2VsbCA9PSBudWxsID8gJycgOiBjZWxsKVxyXG4gICAgICAgIC5yZXBsYWNlKC9cXHMrL2csICcgJylcclxuICAgICAgICAudHJpbSgpXHJcbiAgICAgICAgLnRvTG93ZXJDYXNlKCk7XHJcbiAgICAgIGlmIChIRUFERVJfTUFSS0VSUy5pbmRleE9mKHMpID49IDApIHJldHVybiBpO1xyXG4gICAgfVxyXG4gIH1cclxuICByZXR1cm4gLTE7XHJcbn1cclxuXHJcbi8vIERldGVjdGEgXHUwMEVEbmRpY2VzIGRlIGNvbHVtbmFzIHkgbWVzZXMuIGBoaW50Um93QWJvdmVgIHBlcm1pdGUgY29tYmluYXIgYVx1MDBGMW8vbWVzXHJcbi8vIGN1YW5kbyBlbCBoZWFkZXIgZXMgbXVsdGktcm93IChhXHUwMEYxbyBhcnJpYmEsIG1lcyBhYmFqbyBvIHZpY2V2ZXJzYSkuXHJcbmZ1bmN0aW9uIGRldGVjdENvbHVtbnMoaGVhZGVyUm93LCBoaW50Um93QWJvdmUpIHtcclxuICBsZXQgc2t1SWR4ID0gLTE7XHJcbiAgbGV0IGRlc2NJZHggPSAtMTtcclxuICBsZXQgbW9xSWR4ID0gLTE7XHJcbiAgY29uc3QgbW9udGhDb2x1bW5zID0gW107XHJcbiAgY29uc3QgZGV0ZWN0ZWRNb250aHNTZXQgPSBuZXcgU2V0KCk7XHJcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBoZWFkZXJSb3cubGVuZ3RoOyBpKyspIHtcclxuICAgIC8vIHYxMTA0OiBjb2xhcHNhciBuZXdsaW5lcyBhIGVzcGFjaW8gYW50ZXMgZGUgY29tcGFyYXIuIExvcyBTYWxlcyBQbGFuXHJcbiAgICAvLyBTVVIgdGllbmVuIGhlYWRlcnMgbXVsdGktbGluZSBjb21vIFwiTU9RXFxuMTIgbW9udGhzXCIgbyBcIkJhc2VcXG5GT0IoVVNEKVwiLlxyXG4gICAgY29uc3QgcmF3ID0gU3RyaW5nKGhlYWRlclJvd1tpXSA9PSBudWxsID8gJycgOiBoZWFkZXJSb3dbaV0pXHJcbiAgICAgIC5yZXBsYWNlKC9cXHMrL2csICcgJylcclxuICAgICAgLnRyaW0oKTtcclxuICAgIGNvbnN0IHMgPSByYXcudG9Mb3dlckNhc2UoKTtcclxuICAgIGlmIChcclxuICAgICAgc2t1SWR4IDwgMCAmJlxyXG4gICAgICAocyA9PT0gJ3NrdSBjb2RlL3BhcnQgbm8nIHx8XHJcbiAgICAgICAgcyA9PT0gJ3NrdSBjb2RlJyB8fFxyXG4gICAgICAgIHMgPT09ICdza3UnIHx8XHJcbiAgICAgICAgcyA9PT0gJ3BhcnQgbm8nIHx8XHJcbiAgICAgICAgcyA9PT0gJ3BhcnQgbnVtYmVyJyB8fFxyXG4gICAgICAgIHMgPT09ICdpdGVtY29kZScgfHxcclxuICAgICAgICBzID09PSAnaXRlbSBjb2RlJyB8fFxyXG4gICAgICAgIHMgPT09ICdjb2RpZ28nIHx8XHJcbiAgICAgICAgcyA9PT0gJ2NcdTAwRjNkaWdvJylcclxuICAgICkge1xyXG4gICAgICBza3VJZHggPSBpO1xyXG4gICAgICBjb250aW51ZTtcclxuICAgIH1cclxuICAgIGlmIChcclxuICAgICAgZGVzY0lkeCA8IDAgJiZcclxuICAgICAgKHMgPT09ICdkZXNjcmlwdGlvbicgfHxcclxuICAgICAgICBzID09PSAnZGVzY3JpcGNpb24nIHx8XHJcbiAgICAgICAgcyA9PT0gJ2Rlc2NyaXBjaVx1MDBGM24nIHx8XHJcbiAgICAgICAgcyA9PT0gJ2l0ZW0gbmFtZScgfHxcclxuICAgICAgICBzID09PSAnaXRlbW5hbWUnKVxyXG4gICAgKSB7XHJcbiAgICAgIGRlc2NJZHggPSBpO1xyXG4gICAgICBjb250aW51ZTtcclxuICAgIH1cclxuICAgIGlmIChtb3FJZHggPCAwICYmIChzID09PSAnbW9xIDEyIG1vbnRocycgfHwgcyA9PT0gJ21vcScgfHwgcy5pbmRleE9mKCdtb3EnKSA9PT0gMCkpIHtcclxuICAgICAgbW9xSWR4ID0gaTtcclxuICAgICAgY29udGludWU7XHJcbiAgICB9XHJcbiAgICAvLyBUcnkgZGlyZWN0IG1vbnRoIHBhcnNlXHJcbiAgICBsZXQgbW9udGhLZXkgPSBub3JtYWxpemVNb250aExhYmVsKHJhdyk7XHJcbiAgICBpZiAoIW1vbnRoS2V5ICYmIGhpbnRSb3dBYm92ZSAmJiBoaW50Um93QWJvdmVbaV0gIT0gbnVsbCkge1xyXG4gICAgICBjb25zdCBoaW50ID0gU3RyaW5nKGhpbnRSb3dBYm92ZVtpXSkudHJpbSgpO1xyXG4gICAgICBpZiAoaGludCkge1xyXG4gICAgICAgIG1vbnRoS2V5ID0gbm9ybWFsaXplTW9udGhMYWJlbChyYXcgKyAnICcgKyBoaW50KSB8fCBub3JtYWxpemVNb250aExhYmVsKGhpbnQgKyAnICcgKyByYXcpO1xyXG4gICAgICB9XHJcbiAgICB9XHJcbiAgICBpZiAobW9udGhLZXkpIHtcclxuICAgICAgbW9udGhDb2x1bW5zLnB1c2goeyBjb2xJZHg6IGksIG1vbnRoS2V5IH0pO1xyXG4gICAgICBkZXRlY3RlZE1vbnRoc1NldC5hZGQobW9udGhLZXkpO1xyXG4gICAgfVxyXG4gIH1cclxuICByZXR1cm4ge1xyXG4gICAgc2t1SWR4LFxyXG4gICAgZGVzY0lkeCxcclxuICAgIG1vcUlkeCxcclxuICAgIG1vbnRoQ29sdW1ucyxcclxuICAgIGRldGVjdGVkTW9udGhzOiBBcnJheS5mcm9tKGRldGVjdGVkTW9udGhzU2V0KS5zb3J0KCksXHJcbiAgfTtcclxufVxyXG5cclxuLy8gUHVibGljOiBwYXJzZSBmdWxsIHNoZWV0LiBUaHJvd3Mgb24gbWlzc2luZyBTS1UgY29sdW1uIC8gbW9udGhzLlxyXG5mdW5jdGlvbiBwYXJzZVNhbGVzUGxhblNoZWV0KHJvd3MpIHtcclxuICBpZiAoIXJvd3MgfHwgIXJvd3MubGVuZ3RoKSB7XHJcbiAgICBjb25zdCBlcnIgPSBuZXcgRXJyb3IoJ0V4Y2VsIHZhY2lvJyk7XHJcbiAgICBlcnIuY29kZSA9ICdFTVBUWV9TSEVFVCc7XHJcbiAgICB0aHJvdyBlcnI7XHJcbiAgfVxyXG4gIGNvbnN0IGhlYWRlcklkeCA9IGZpbmRIZWFkZXJSb3cocm93cyk7XHJcbiAgaWYgKGhlYWRlcklkeCA8IDApIHtcclxuICAgIGNvbnN0IGVyciA9IG5ldyBFcnJvcignTm8gc2UgZW5jb250cm8gZmlsYSBkZSBoZWFkZXJzIChidXNjYWJhIFwiU0tVIENvZGUvUGFydCBOb1wiIG8gXCJTS1VcIiknKTtcclxuICAgIGVyci5jb2RlID0gJ0hFQURFUl9OT1RfRk9VTkQnO1xyXG4gICAgdGhyb3cgZXJyO1xyXG4gIH1cclxuICBjb25zdCBoZWFkZXJSb3cgPSByb3dzW2hlYWRlcklkeF0gfHwgW107XHJcbiAgY29uc3Qgcm93QWJvdmUgPSBoZWFkZXJJZHggPiAwID8gcm93c1toZWFkZXJJZHggLSAxXSB8fCBbXSA6IG51bGw7XHJcbiAgY29uc3QgY29scyA9IGRldGVjdENvbHVtbnMoaGVhZGVyUm93LCByb3dBYm92ZSk7XHJcbiAgaWYgKGNvbHMuc2t1SWR4IDwgMCkge1xyXG4gICAgY29uc3QgZXJyID0gbmV3IEVycm9yKCdObyBzZSBlbmNvbnRybyBjb2x1bW5hIFNLVSBlbiBsYSBmaWxhIGhlYWRlcicpO1xyXG4gICAgZXJyLmNvZGUgPSAnU0tVX0NPTF9NSVNTSU5HJztcclxuICAgIHRocm93IGVycjtcclxuICB9XHJcbiAgaWYgKCFjb2xzLm1vbnRoQ29sdW1ucy5sZW5ndGgpIHtcclxuICAgIGNvbnN0IGVyciA9IG5ldyBFcnJvcihcclxuICAgICAgJ05vIHNlIGRldGVjdGFyb24gY29sdW1uYXMgZGUgbWVzZXMgZW4gZWwgaGVhZGVyIChlajogXCJKYW4gMjAyN1wiLCBcIk1heSAyMDI3XCIpJ1xyXG4gICAgKTtcclxuICAgIGVyci5jb2RlID0gJ01PTlRIU19OT1RfRk9VTkQnO1xyXG4gICAgdGhyb3cgZXJyO1xyXG4gIH1cclxuICBjb25zdCBwYXJzZWRSb3dzID0gW107XHJcbiAgY29uc3Qgc2VlblNrdSA9IG5ldyBTZXQoKTtcclxuICBmb3IgKGxldCByID0gaGVhZGVySWR4ICsgMTsgciA8IHJvd3MubGVuZ3RoOyByKyspIHtcclxuICAgIGNvbnN0IHJvdyA9IHJvd3Nbcl0gfHwgW107XHJcbiAgICBjb25zdCBza3VSYXcgPSByb3dbY29scy5za3VJZHhdO1xyXG4gICAgaWYgKHNrdVJhdyA9PSBudWxsIHx8IFN0cmluZyhza3VSYXcpLnRyaW0oKSA9PT0gJycpIGNvbnRpbnVlO1xyXG4gICAgY29uc3Qgc2t1ID0gU3RyaW5nKHNrdVJhdykudHJpbSgpO1xyXG4gICAgY29uc3QgdXBwZXIgPSBza3UudG9VcHBlckNhc2UoKTtcclxuICAgIC8vIFNraXAgZmlsYXMgVE9UQUwgLyBTVU0gLyBTVUJUT1RBTFxyXG4gICAgaWYgKHVwcGVyID09PSAnVE9UQUwnIHx8IHVwcGVyID09PSAnU1VNJyB8fCB1cHBlciA9PT0gJ1NVQlRPVEFMJyB8fCB1cHBlciA9PT0gJ1RPVEFMRVMnKVxyXG4gICAgICBjb250aW51ZTtcclxuICAgIGlmIChzZWVuU2t1Lmhhcyh1cHBlcikpIGNvbnRpbnVlOyAvLyBkZWR1cGVcclxuICAgIHNlZW5Ta3UuYWRkKHVwcGVyKTtcclxuICAgIGNvbnN0IGRlc2NyaXB0aW9uID1cclxuICAgICAgY29scy5kZXNjSWR4ID49IDAgPyBTdHJpbmcocm93W2NvbHMuZGVzY0lkeF0gPT0gbnVsbCA/ICcnIDogcm93W2NvbHMuZGVzY0lkeF0pLnRyaW0oKSA6ICcnO1xyXG4gICAgY29uc3QgbW9xUmF3ID0gY29scy5tb3FJZHggPj0gMCA/IHJvd1tjb2xzLm1vcUlkeF0gOiBudWxsO1xyXG4gICAgY29uc3QgbW9xTnVtID0gTnVtYmVyKG1vcVJhdyk7XHJcbiAgICBjb25zdCBtb3EgPSBOdW1iZXIuaXNGaW5pdGUobW9xTnVtKSAmJiBtb3FOdW0gPiAwID8gTWF0aC5yb3VuZChtb3FOdW0pIDogMDtcclxuICAgIGNvbnN0IG1vbnRocyA9IHt9O1xyXG4gICAgZm9yIChjb25zdCBtYyBvZiBjb2xzLm1vbnRoQ29sdW1ucykge1xyXG4gICAgICBjb25zdCB2ID0gcm93W21jLmNvbElkeF07XHJcbiAgICAgIGNvbnN0IG4gPSBOdW1iZXIodik7XHJcbiAgICAgIGlmIChOdW1iZXIuaXNGaW5pdGUobikgJiYgbiA+IDApIHtcclxuICAgICAgICBtb250aHNbbWMubW9udGhLZXldID0gTWF0aC5yb3VuZChuKTtcclxuICAgICAgfVxyXG4gICAgfVxyXG4gICAgcGFyc2VkUm93cy5wdXNoKHsgc2t1LCBkZXNjcmlwdGlvbiwgbW9xLCBtb250aHMgfSk7XHJcbiAgfVxyXG4gIHJldHVybiB7XHJcbiAgICBoZWFkZXJSb3dJbmRleDogaGVhZGVySWR4LFxyXG4gICAgZGV0ZWN0ZWRNb250aHM6IGNvbHMuZGV0ZWN0ZWRNb250aHMsXHJcbiAgICByb3dzQ291bnQ6IHBhcnNlZFJvd3MubGVuZ3RoLFxyXG4gICAgcm93czogcGFyc2VkUm93cyxcclxuICB9O1xyXG59XHJcblxyXG4vLyBVTUQtaXNoIGV4cG9ydDogcGFyYSB2aXRlc3QgKG1vZHVsZS5leHBvcnRzKSB5IHBhcmEgYnVuZGxlIGJyb3dzZXIgKHdpbmRvdyBnbG9iYWwpLlxyXG5pZiAodHlwZW9mIG1vZHVsZSAhPT0gJ3VuZGVmaW5lZCcgJiYgbW9kdWxlLmV4cG9ydHMpIHtcclxuICBtb2R1bGUuZXhwb3J0cyA9IHsgcGFyc2VTYWxlc1BsYW5TaGVldCwgbm9ybWFsaXplTW9udGhMYWJlbCwgZmluZEhlYWRlclJvdywgZGV0ZWN0Q29sdW1ucyB9O1xyXG59XHJcbmlmICh0eXBlb2Ygd2luZG93ICE9PSAndW5kZWZpbmVkJykge1xyXG4gIHdpbmRvdy5TYWxlc1BsYW5QYXJzZXIgPSB7XHJcbiAgICBwYXJzZVNhbGVzUGxhblNoZWV0LFxyXG4gICAgbm9ybWFsaXplTW9udGhMYWJlbCxcclxuICAgIGZpbmRIZWFkZXJSb3csXHJcbiAgICBkZXRlY3RDb2x1bW5zLFxyXG4gIH07XHJcbn1cclxuXHJcbmV4cG9ydCB7IGRldGVjdENvbHVtbnMsIGZpbmRIZWFkZXJSb3csIG5vcm1hbGl6ZU1vbnRoTGFiZWwsIHBhcnNlU2FsZXNQbGFuU2hlZXQgfTtcclxuIiwgIi8vIEB0cy1ub2NoZWNrXG4vLyB2MTA5OCsgRmFzZSAxOiBpbXBvcnQgZGVsIHBhcnNlciBwdXJvLiBFbCBtXHUwMEYzZHVsbyBoYWNlIGB3aW5kb3cuU2FsZXNQbGFuUGFyc2VyYFxuLy8gY29tbyBzaWRlLWVmZmVjdCB5IHRhbWJpXHUwMEU5biBleHBvcnRhIGxhcyBmbnMgbm9tYnJhZGFzOyB1c2Ftb3Mgc2lkZS1lZmZlY3Rcbi8vIHBvcnF1ZSBmb3JlY2FzdC5qcyBjb3JyZSBlbiBlbCBjaHVuayBsYXp5IHkgd2luZG93IHlhIGVzdFx1MDBFMSBkaXNwb25pYmxlLlxuaW1wb3J0ICcuLi9wdXJlL3NhbGVzLXBsYW4tcGFyc2VyLmpzJztcblxuLy8gR2xvYmFscyBsZWlkb3MgZGVsIGVudG9ybm8gKGRlY2xhcmFkb3MgZW4gaW5kZXguaHRtbCBpbmxpbmUgbyBidW5kbGUgcHJldmlvKTpcbi8vIGZiRGIsIGN1cnJlbnRVc2VyLCBYTFNYIChjZG4pLCBlc2NhcGVIdG1sLiBNaXNtbyBwYXRyb24gcXVlIG90cm9zIGRvbWluaW9zLlxuLy9cbi8vIEZPUkVDQVNUIC0gbW9kYWwgYWRtaW4tb25seSAoTWFyaWFubykuIENodW5rIGxhenk6IHNlIGNhcmdhIHNvbG8gYWwgcHJpbWVyXG4vLyBjbGljayBkZWwgYm90b24gRk9SRUNBU1QgZGVsIGhlYWRlci4gUmVnaXN0cmFkbyBlbiBidWlsZC5qcyBMQVpZX0NIVU5LUyArXG4vLyBzcmMvbWFpbi5qcyBpbnN0YWxsQ2h1bmtTdHVicyArIHN3LmpzIFNUQVRJQ19BU1NFVFMuIFZlciBDTEFVREUubWQgIzE4LlxuLy9cbi8vIHYxMTExIGNsZWFuOiBwaXBlbGluZSBsZWdhY3kgKFNLVSArIDYgY29sdW1uYXMgKyBwb2xpdGljYSAzbSkgcmVtb3ZpZG8uXG4vLyBSZWVtcGxhemFkbyBwb3I6XG4vLyAgIC0gRmFzZSAxICh2MTA5OCk6IFNhbGVzIFBsYW5zIG1lbnN1YWxlcyBSb2RzL1JlZWxzIGNvbiBmb3JtYXRvIFNVUi5cbi8vICAgLSBGYXNlIDJCICh2MTEwMyk6IEZvcmVjYXN0IEVzdGFkaXN0aWNvIChzdGF0c2ZvcmVjYXN0IHBpcGVsaW5lIG9mZmxpbmUpLlxuLy8gICAtIEZhc2UgM0EgKHYxMTA5KTogVGFibGEgUmVjb21lbmRhY2lvbiBkZSBDb21wcmEuXG5cbi8vIHYxMDk4KyAoRmFzZSAxIEZvcmVjYXN0IHYyKTogU2FsZXMgUGxhbnMgbWVuc3VhbGVzIHBvciBmYW1pbGlhIChSb2RzL1JlZWxzL0ZHKS5cbi8vIFNlIGd1YXJkYW4gZW4gRmlyZXN0b3JlIGBzYWxlc19wbGFuX2NhY2hlL3tmYW1pbGlhfWAgKyBzbmFwc2hvdCBFeGNlbCBvcmlnaW5hbFxuLy8gZW4gU3RvcmFnZSBgZm9yZWNhc3RzX3NuYXBzaG90cy97WVlZWS1NTX0ve2ZhbWlsaWF9Lnhsc3hgLlxuLy8gRWwgcGFyc2VyIHB1cm8gdml2ZSBlbiBzcmMvcHVyZS9zYWxlcy1wbGFuLXBhcnNlci5qcyAoYXR0YWNoIGEgd2luZG93LlNhbGVzUGxhblBhcnNlcikuXG4vLyB2MTEwODogRkcgcmVtb3ZpZG8gZGVsIFVJIChNYXJpYW5vIHBpZGlcdTAwRjMpLiBTb2xvIFJvZHMgKyBSZWVscyBwb3IgYWhvcmEuXG4vLyBMYSBydWxlIEZpcmVzdG9yZSBzaWd1ZSBhY2VwdGFuZG8gJ2ZnJyBwb3Igc2kgZW4gZWwgZnV0dXJvIHNlIHZ1ZWx2ZSBhXG4vLyBhY3RpdmFyIFx1MjAxNCBubyBib3JyYXJsYSBlbiBzdG9yYWdlL2ZpcmVzdG9yZS5ydWxlcyBoYXN0YSBjb25maXJtYXIgZGVwcmVjYXRlLlxuY29uc3QgU0FMRVNfUExBTl9GQU1JTElBUyA9IFtcbiAgeyBrZXk6ICdyb2RzJywgbGFiZWw6ICdSb2RzIChDYVx1MDBGMWFzKScsIGNvbG9yOiAnIzBlYTVlOScgfSxcbiAgeyBrZXk6ICdyZWVscycsIGxhYmVsOiAnUmVlbHMnLCBjb2xvcjogJyM4YjVjZjYnIH0sXG5dO1xuY29uc3QgX3NhbGVzUGxhbkNhY2hlcyA9IHsgcm9kczogbnVsbCwgcmVlbHM6IG51bGwgfTsgLy8gbGFzdCBsb2FkZWQgZG9jXG5sZXQgX2ZvcmVjYXN0QWN0aXZlVGFiID0gJ3NhbGVzLXBsYW5zJzsgLy8gJ3NhbGVzLXBsYW5zJyB8ICdzdGF0JyB8ICdsZWdhY3knXG5cbi8vIHYxMTAzKyAoRmFzZSAyQik6IEZvcmVjYXN0IEVzdGFkXHUwMEVEc3RpY28gXHUyMDE0IG91dHB1dCBwdWJsaWNhZG8gcG9yXG4vLyBzY3JpcHRzL2ZvcmVjYXN0L3B1Ymxpc2hfdG9fZmlyZXN0b3JlLnB5IGEgZm9yZWNhc3Rfb3V0cHV0L3tzdWJfc2x1Z31cbi8vICsgZm9yZWNhc3Rfb3V0cHV0X21ldGEvY3VycmVudC4gMjQgc3VicyArIDEgbWV0YSBkb2MuXG5sZXQgX2ZvcmVjYXN0U3RhdERvY3MgPSBudWxsOyAvLyBbe2lkLCBzdWJmYW1pbGlhLCBmb3JlY2FzdFs3XSwgbWV0cmljcywgYmVzdE1vZGVsLCB2ZXJzaW9uSWR9XVxubGV0IF9mb3JlY2FzdFN0YXRNZXRhID0gbnVsbDsgLy8ge2dlbmVyYXRlZEF0LCB2ZXJzaW9uSWQsIHJlc3VtZW46IHsuLi59fVxubGV0IF9mb3JlY2FzdFN0YXRIaXN0b3J5Q2FjaGUgPSBudWxsOyAvLyB7IFtzdWJdOiBbe2RzLCB5fV0gfSBjYWNoZSBsYXp5IG9uLWRlbWFuZFxuXG4vLyB2MTEwOSsgKEZhc2UgM0EpOiBUYWJsYSBSZWNvbWVuZGFjaVx1MDBGM24gZGUgQ29tcHJhIFx1MjAxNCBjb21iaW5hIHNhbGVzIHBsYW5zICtcbi8vIHN0b2NrX3NuYXBzaG90ICsgc2t1X3ZlbnRhc19zbmFwc2hvdCBwYXJhIGNvbXB1dGFyIHJlY29tZW5kYWRvIHBvciBTS1UuXG5sZXQgX3JlY29TdG9ja1NuYXBzaG90ID0gbnVsbDsgLy8ge3dhcmVob3VzZUJyZWFrZG93bjoge3NrdTp7JzExJzpuLCcxMic6biwuLi59fSwgYmFja29yZGVyQnlTa3U6IHtza3U6bn19XG5sZXQgX3JlY29WZW50YXNTbmFwc2hvdCA9IG51bGw7IC8vIHsgW1NLVSB1cHBlcl06IHttZXNlczogeydZWVlZLU1NJzoge3F0eSxhcnN9fX0gfVxubGV0IF9yZWNvRmlsdGVyTWluUmVjID0gdHJ1ZTsgLy8gXCJzb2xvIG1vc3RyYXIgU0tVcyBjb24gcmVjb21lbmRhZG8gPiAwXCJcbmxldCBfcmVjb0ZpbHRlckZhbWlsaWEgPSAnYWxsJzsgLy8gJ2FsbCcgfCAncm9kcycgfCAncmVlbHMnXG5sZXQgX3JlY29TZWFyY2hUZXh0ID0gJyc7XG5cbi8vIHYxMTEyKyAoRjNCKTogU0tVcyBkZXNjb250aW51YWRvcyBxdWUgTWFyaWFubyBtYXJjYSBwYXJhIGV4Y2x1aXIgZGVsIGZvcmVjYXN0LlxuLy8gUGVyc2lzdGVuIGVuIEZpcmVzdG9yZSBgZm9yZWNhc3RfY29uZmlnL2Rpc2NvbnRpbnVlZF9za3VzYCBjb21vIHsgc2t1czogW1NLVSB1cHBlcl0sIHVwZGF0ZWRBdCwgdXBkYXRlZEJ5IH0uXG5sZXQgX2Rpc2NvbnRpbnVlZFNrdXMgPSBudWxsOyAvLyBTZXQ8c3RyaW5nIHVwcGVyPiBvIG51bGwgc2kgbm8gY2FyZ2Fkb1xubGV0IF9kaXNjb250aW51ZWRNZXRhID0gbnVsbDsgLy8ge3VwZGF0ZWRBdCwgdXBkYXRlZEJ5fVxuXG5jb25zdCBSRUNPX0hPUklaT05fTU9OVEhTID0gNztcbmNvbnN0IFJFQ09fVkVOVEFfUFJPTUVESU9fV0lORE9XID0gMzsgLy8gbWVzZXMgaGFjaWEgYXRyXHUwMEUxcyBwYXJhIHByb21lZGlvIHZlbnRhXG5jb25zdCBSRUNPX0RFRkFVTFRfTVVMVElQTElFUiA9IDEuMDtcblxuLy8gV2hpdGVsaXN0IGRlIGVtYWlscyBjb24gYWNjZXNvIGFsIG1vZGFsIEZPUkVDQVNULiBSZXBsaWNhIGVsIHBhdHJvbiBkZVxuLy8gXCJBbmFsaXNpc1wiIChpbmRleC5odG1sOjEyNjI1KS4gU29sbyBNYXJpYW5vOyBzaSBvdHJvIGFkbWluIGxvIG5lY2VzaXRhXG4vLyBzZSBhZ3JlZ2EgYWNhIGV4cGxpY2l0by5cbmNvbnN0IEZPUkVDQVNUX0FMTE9XRURfRU1BSUxTID0gWydtYXJpYW5vLmVyYmlub0BzaGltYW5vLmNvbS5hcicsICdlcmJpbm9tYXJpYW5vQGdtYWlsLmNvbSddO1xuXG5mdW5jdGlvbiBfY2FuRm9yZWNhc3QoKSB7XG4gIHRyeSB7XG4gICAgY29uc3QgZW1haWwgPSAoKHdpbmRvdy5jdXJyZW50VXNlciAmJiB3aW5kb3cuY3VycmVudFVzZXIuZW1haWwpIHx8ICcnKS50b0xvd2VyQ2FzZSgpO1xuICAgIGlmICghZW1haWwpIHJldHVybiBmYWxzZTtcbiAgICByZXR1cm4gRk9SRUNBU1RfQUxMT1dFRF9FTUFJTFMuaW5kZXhPZihlbWFpbCkgPj0gMDtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG59XG5cbmZ1bmN0aW9uIF9yZW5kZXJNb2RhbFNoZWxsKCkge1xuICBjb25zdCBleGlzdGluZyA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdmb3JlY2FzdC1tb2RhbCcpO1xuICBpZiAoZXhpc3RpbmcpIHJldHVybiBleGlzdGluZztcbiAgY29uc3QgZWwgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKTtcbiAgZWwuaWQgPSAnZm9yZWNhc3QtbW9kYWwnO1xuICBlbC5jbGFzc05hbWUgPSAnbW9kYWwtb3ZlcmxheSc7XG4gIGVsLnN0eWxlLmNzc1RleHQgPVxuICAgICdkaXNwbGF5Om5vbmU7cG9zaXRpb246Zml4ZWQ7aW5zZXQ6MDtiYWNrZ3JvdW5kOnJnYmEoMTUsMjMsNDIsLjYpO3otaW5kZXg6MjA1MDsnO1xuICBlbC5vbmNsaWNrID0gZnVuY3Rpb24gKGV2KSB7XG4gICAgaWYgKGV2LnRhcmdldCA9PT0gZWwpIHdpbmRvdy5jbG9zZUZvcmVjYXN0TW9kYWwoKTtcbiAgfTtcbiAgLy8gU2hlbGwgKyB0YWJzIGJhciArIDIgY29udGVuZWRvcmVzIGRlIHRhYnMgKFNhbGVzIFBsYW5zIG51ZXZhLCBMZWdhY3kgNm0pLlxuICAvLyBFbCBjb250ZW5pZG8gZGUgY2FkYSB0YWIgc2UgcGludGEgY29uIF9yZW5kZXJTYWxlc1BsYW5zVGFiKCkgeSBlbCBsZWdhY3lcbiAgLy8gdXNhIGVsIGZsdWpvIF9yZW5kZXJUYWJsZSgpIGRlIHNpZW1wcmUuXG4gIGNvbnN0IHNoZWxsSHRtbCA9IF9idWlsZFNoZWxsSHRtbCgpO1xuICBlbC5pbm5lckhUTUwgPSBzaGVsbEh0bWw7XG4gIGRvY3VtZW50LmJvZHkuYXBwZW5kQ2hpbGQoZWwpO1xuICByZXR1cm4gZWw7XG59XG5cbmZ1bmN0aW9uIF9idWlsZFNoZWxsSHRtbCgpIHtcbiAgLy8gQnJva2VuLW91dCBwdXJlIHN0cmluZyBidWlsZGVyIHBhcmEgcGFzYXIgZWwgaG9vayBkZSBpbm5lckhUTUwuXG4gIGNvbnN0IG1vZGFsT3V0ZXIgPVxuICAgICc8ZGl2IHN0eWxlPVwicG9zaXRpb246YWJzb2x1dGU7aW5zZXQ6MXZoIDF2dztiYWNrZ3JvdW5kOnZhcigtLWJnLWVsZXZhdGVkKTtib3JkZXItcmFkaXVzOjEwcHg7ZGlzcGxheTpmbGV4O2ZsZXgtZGlyZWN0aW9uOmNvbHVtbjtvdmVyZmxvdzpoaWRkZW47Ym94LXNoYWRvdzowIDIwcHggNTBweCByZ2JhKDAsMCwwLC4zNSlcIj4nO1xuICBjb25zdCBoZWFkZXIgPVxuICAgICc8ZGl2IHN0eWxlPVwicGFkZGluZzoxMnB4IDE4cHg7YmFja2dyb3VuZDojMGYxNzJhO2NvbG9yOiNmZmY7ZGlzcGxheTpmbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtnYXA6MTJweFwiPicgK1xuICAgICc8ZGl2IHN0eWxlPVwiZmxleDoxXCI+PGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxNnB4O2ZvbnQtd2VpZ2h0OjgwMDtsZXR0ZXItc3BhY2luZzouNXB4XCI+Rk9SRUNBU1Q8L2Rpdj4nICtcbiAgICAnPGRpdiBpZD1cImZvcmVjYXN0LXN1YnRpdGxlXCIgc3R5bGU9XCJmb250LXNpemU6MTFweDtvcGFjaXR5Oi44O21hcmdpbi10b3A6MnB4XCI+U2FsZXMgUGxhbnMgbWVuc3VhbGVzICsgcG9saXRpY2EgZGUgaW52ZW50YXJpbzwvZGl2PjwvZGl2PicgK1xuICAgICc8YnV0dG9uIG9uY2xpY2s9XCJjbG9zZUZvcmVjYXN0TW9kYWwoKVwiIHN0eWxlPVwiYmFja2dyb3VuZDp0cmFuc3BhcmVudDtjb2xvcjojZmZmO2JvcmRlcjoxcHggc29saWQgcmdiYSgyNTUsMjU1LDI1NSwuNCk7Ym9yZGVyLXJhZGl1czo2cHg7cGFkZGluZzo2cHggMTBweDtjdXJzb3I6cG9pbnRlcjtmb250LXdlaWdodDo3MDBcIj5DZXJyYXI8L2J1dHRvbj4nICtcbiAgICAnPC9kaXY+JztcbiAgLy8gdjExMTE6IHRhYiBcIkxlZ2FjeSAoNm0pXCIgZWxpbWluYWRhIFx1MjAxNCBlbCBwaXBlbGluZSB2aWVqbyAoU0tVICsgNiBjb2x1bW5hc1xuICAvLyB2cyBza3VfdmVudGFzX3NuYXBzaG90ICsgcG9sXHUwMEVEdGljYSAzbSkgZnVlIHJlZW1wbGF6YWRvIHBvciBsYSB0YWJsYVxuICAvLyBSZWNvbWVuZGFjaVx1MDBGM24gZGUgQ29tcHJhICh2MTEwOSwgRjNBKSBxdWUgdXNhIGRhdG9zIG1cdTAwRTFzIGNvbXBsZXRvcy5cbiAgY29uc3QgdGFic0JhciA9XG4gICAgJzxkaXYgaWQ9XCJmb3JlY2FzdC10YWJzLWJhclwiIHN0eWxlPVwiZGlzcGxheTpmbGV4O2dhcDowO2JhY2tncm91bmQ6dmFyKC0tYmctc2Vjb25kYXJ5KTtwYWRkaW5nOjAgMThweDtib3JkZXItYm90dG9tOjFweCBzb2xpZCB2YXIoLS1ib3JkZXItc3VidGxlKVwiPicgK1xuICAgICc8YnV0dG9uIGRhdGEtdGFiPVwic2FsZXMtcGxhbnNcIiBvbmNsaWNrPVwic3dpdGNoRm9yZWNhc3RUYWIoXFwnc2FsZXMtcGxhbnNcXCcpXCIgY2xhc3M9XCJmb3JlY2FzdC10YWJcIiBzdHlsZT1cInBhZGRpbmc6MTBweCAxNnB4O2JhY2tncm91bmQ6dHJhbnNwYXJlbnQ7Y29sb3I6dmFyKC0tdGV4dC1wcmltYXJ5KTtib3JkZXI6bm9uZTtib3JkZXItYm90dG9tOjNweCBzb2xpZCAjMGQ5NDg4O2N1cnNvcjpwb2ludGVyO2ZvbnQtd2VpZ2h0OjcwMDtmb250LXNpemU6MTJweDtsZXR0ZXItc3BhY2luZzouNHB4O3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZVwiPlNhbGVzIFBsYW5zPC9idXR0b24+JyArXG4gICAgJzxidXR0b24gZGF0YS10YWI9XCJzdGF0XCIgb25jbGljaz1cInN3aXRjaEZvcmVjYXN0VGFiKFxcJ3N0YXRcXCcpXCIgY2xhc3M9XCJmb3JlY2FzdC10YWJcIiBzdHlsZT1cInBhZGRpbmc6MTBweCAxNnB4O2JhY2tncm91bmQ6dHJhbnNwYXJlbnQ7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7Ym9yZGVyOm5vbmU7Ym9yZGVyLWJvdHRvbTozcHggc29saWQgdHJhbnNwYXJlbnQ7Y3Vyc29yOnBvaW50ZXI7Zm9udC13ZWlnaHQ6NjAwO2ZvbnQtc2l6ZToxMnB4O2xldHRlci1zcGFjaW5nOi40cHg7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlXCI+Rm9yZWNhc3QgRXN0YWRcdTAwRURzdGljbzwvYnV0dG9uPicgK1xuICAgICc8L2Rpdj4nO1xuICBjb25zdCB0YWJTYWxlc1BsYW5zID0gJzxkaXYgaWQ9XCJmb3JlY2FzdC10YWItc2FsZXMtcGxhbnNcIiBzdHlsZT1cImZsZXg6MTtvdmVyZmxvdzphdXRvXCI+PC9kaXY+JztcbiAgY29uc3QgdGFiU3RhdCA9ICc8ZGl2IGlkPVwiZm9yZWNhc3QtdGFiLXN0YXRcIiBzdHlsZT1cImZsZXg6MTtvdmVyZmxvdzphdXRvO2Rpc3BsYXk6bm9uZVwiPjwvZGl2Pic7XG4gIHJldHVybiBtb2RhbE91dGVyICsgaGVhZGVyICsgdGFic0JhciArIHRhYlNhbGVzUGxhbnMgKyB0YWJTdGF0ICsgJzwvZGl2Pic7XG59XG5cbi8vIHYxMDk4KyBGYXNlIDEgKyB2MTEwMysgRmFzZSAyQiArIHYxMTA1IGZpeCArIHYxMTExIGNsZWFuIGxlZ2FjeTogc3dpdGNoXG4vLyBlbnRyZSB0YWJzIFNhbGVzIFBsYW5zIC8gRm9yZWNhc3QgRXN0YWRcdTAwRURzdGljby5cbndpbmRvdy5zd2l0Y2hGb3JlY2FzdFRhYiA9IGZ1bmN0aW9uICh0YWJJZCkge1xuICBfZm9yZWNhc3RBY3RpdmVUYWIgPSB0YWJJZDtcbiAgY29uc3Qgc3AgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZm9yZWNhc3QtdGFiLXNhbGVzLXBsYW5zJyk7XG4gIGNvbnN0IHN0ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2ZvcmVjYXN0LXRhYi1zdGF0Jyk7XG4gIGlmIChzcCkgc3Auc3R5bGUuZGlzcGxheSA9IHRhYklkID09PSAnc2FsZXMtcGxhbnMnID8gJ2Jsb2NrJyA6ICdub25lJztcbiAgaWYgKHN0KSBzdC5zdHlsZS5kaXNwbGF5ID0gdGFiSWQgPT09ICdzdGF0JyA/ICdibG9jaycgOiAnbm9uZSc7XG4gIGNvbnN0IGJ0bnMgPSBkb2N1bWVudC5xdWVyeVNlbGVjdG9yQWxsKCcjZm9yZWNhc3QtdGFicy1iYXIgLmZvcmVjYXN0LXRhYicpO1xuICBidG5zLmZvckVhY2goKGIpID0+IHtcbiAgICBjb25zdCBhY3RpdmUgPSBiLmdldEF0dHJpYnV0ZSgnZGF0YS10YWInKSA9PT0gdGFiSWQ7XG4gICAgYi5zdHlsZS5jb2xvciA9IGFjdGl2ZSA/ICd2YXIoLS10ZXh0LXByaW1hcnkpJyA6ICd2YXIoLS10ZXh0LW11dGVkKSc7XG4gICAgYi5zdHlsZS5ib3JkZXJCb3R0b21Db2xvciA9IGFjdGl2ZSA/ICcjMGQ5NDg4JyA6ICd0cmFuc3BhcmVudCc7XG4gICAgYi5zdHlsZS5mb250V2VpZ2h0ID0gYWN0aXZlID8gJzcwMCcgOiAnNjAwJztcbiAgfSk7XG4gIC8vIHYxMTA1IGZpeDogYWwgYWN0aXZhciBsYSB0YWIgc3RhdCwgbW9zdHJhciBwbGFjZWhvbGRlciBpbm1lZGlhdG8gcGFyYVxuICAvLyBxdWUgc2UgdmVhIGFsZ28gbWllbnRyYXMgY2FyZ2EgKG8gc2kgZWwgbG9hZCB5YSB0ZXJtaW5vLCByZS1yZW5kZXIpLlxuICBpZiAodGFiSWQgPT09ICdzdGF0Jykge1xuICAgIGNvbnN0IGNvbnQgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZm9yZWNhc3QtdGFiLXN0YXQnKTtcbiAgICBpZiAoY29udCkge1xuICAgICAgaWYgKF9mb3JlY2FzdFN0YXREb2NzKSB7XG4gICAgICAgIC8vIFlhIGNhcmdhZG86IHJlLXJlbmRlciAocG9yIHNpIGVsIHVzZXIgdmllbmUgZGUgb3RyYSB0YWIpLlxuICAgICAgICBfcmVuZGVyRm9yZWNhc3RTdGF0VGFiKCk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICAvLyBBXHUwMEZBbiBubyBjYXJnYWRvOiBwbGFjZWhvbGRlciArIGxvYWQuXG4gICAgICAgIGNvbnQuaW5uZXJIVE1MID1cbiAgICAgICAgICAnPGRpdiBzdHlsZT1cInBhZGRpbmc6NjBweCAyMHB4O3RleHQtYWxpZ246Y2VudGVyO2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO2ZvbnQtc2l6ZToxNHB4XCI+JyArXG4gICAgICAgICAgJzxkaXYgc3R5bGU9XCJkaXNwbGF5OmlubGluZS1ibG9jazt3aWR0aDoyNHB4O2hlaWdodDoyNHB4O2JvcmRlcjozcHggc29saWQgIzBkOTQ4ODtib3JkZXItdG9wLWNvbG9yOnRyYW5zcGFyZW50O2JvcmRlci1yYWRpdXM6NTAlO2FuaW1hdGlvbjpzcGluIDAuOHMgbGluZWFyIGluZmluaXRlO21hcmdpbi1ib3R0b206MTJweFwiPjwvZGl2PicgK1xuICAgICAgICAgICc8ZGl2PkNhcmdhbmRvIGZvcmVjYXN0X291dHB1dCBkZXNkZSBGaXJlc3RvcmUuLi48L2Rpdj4nICtcbiAgICAgICAgICAnPHN0eWxlPkBrZXlmcmFtZXMgc3Bpbnt0b3t0cmFuc2Zvcm06cm90YXRlKDM2MGRlZyl9fTwvc3R5bGU+JyArXG4gICAgICAgICAgJzwvZGl2Pic7XG4gICAgICAgIF9sb2FkRm9yZWNhc3RPdXRwdXQoKVxuICAgICAgICAgIC50aGVuKF9yZW5kZXJGb3JlY2FzdFN0YXRUYWIpXG4gICAgICAgICAgLmNhdGNoKChlKSA9PiB7XG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKCdbRk9SRUNBU1Qgc3RhdF0gbG9hZCBmYWlsJywgZSk7XG4gICAgICAgICAgICBjb25zdCBjID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2ZvcmVjYXN0LXRhYi1zdGF0Jyk7XG4gICAgICAgICAgICBpZiAoYykge1xuICAgICAgICAgICAgICBjLmlubmVySFRNTCA9XG4gICAgICAgICAgICAgICAgJzxkaXYgc3R5bGU9XCJwYWRkaW5nOjYwcHggMjBweDt0ZXh0LWFsaWduOmNlbnRlcjtjb2xvcjojZGMyNjI2O2xpbmUtaGVpZ2h0OjEuNlwiPicgK1xuICAgICAgICAgICAgICAgICc8ZGl2IHN0eWxlPVwiZm9udC1zaXplOjE2cHg7Zm9udC13ZWlnaHQ6NzAwO21hcmdpbi1ib3R0b206MTJweFwiPkVycm9yIGNhcmdhbmRvIGZvcmVjYXN0X291dHB1dDwvZGl2PicgK1xuICAgICAgICAgICAgICAgICc8ZGl2IHN0eWxlPVwiZm9udC1zaXplOjEycHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7bWFyZ2luLWJvdHRvbToxNnB4XCI+JyArXG4gICAgICAgICAgICAgICAgZXNjYXBlSHRtbFNhZmUoZS5tZXNzYWdlIHx8IFN0cmluZyhlKSkgK1xuICAgICAgICAgICAgICAgICc8L2Rpdj4nICtcbiAgICAgICAgICAgICAgICAnPGJ1dHRvbiBvbmNsaWNrPVwic3dpdGNoRm9yZWNhc3RUYWIoXFwnc3RhdFxcJylcIiBzdHlsZT1cInBhZGRpbmc6OHB4IDE0cHg7YmFja2dyb3VuZDojMGQ5NDg4O2NvbG9yOiNmZmY7Ym9yZGVyOm5vbmU7Ym9yZGVyLXJhZGl1czo2cHg7Zm9udC13ZWlnaHQ6NzAwO2N1cnNvcjpwb2ludGVyXCI+UmVpbnRlbnRhcjwvYnV0dG9uPicgK1xuICAgICAgICAgICAgICAgICc8L2Rpdj4nO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH0pO1xuICAgICAgfVxuICAgIH1cbiAgfVxufTtcblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBGQVNFIDEgXHUyMDE0IFNhbGVzIFBsYW5zIHVwbG9hZCAoUm9kcyAvIFJlZWxzIC8gRkcpXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuZnVuY3Rpb24gX3llYXJNb250aE5vdygpIHtcbiAgY29uc3QgZCA9IG5ldyBEYXRlKCk7XG4gIHJldHVybiBkLmdldEZ1bGxZZWFyKCkgKyAnLScgKyBTdHJpbmcoZC5nZXRNb250aCgpICsgMSkucGFkU3RhcnQoMiwgJzAnKTtcbn1cblxuZnVuY3Rpb24gX2ZtdFNpemUoYnl0ZXMpIHtcbiAgaWYgKCFieXRlcykgcmV0dXJuICcnO1xuICBpZiAoYnl0ZXMgPCAxMDI0KSByZXR1cm4gYnl0ZXMgKyAnIEInO1xuICBpZiAoYnl0ZXMgPCAxMDI0ICogMTAyNCkgcmV0dXJuIChieXRlcyAvIDEwMjQpLnRvRml4ZWQoMSkgKyAnIEtCJztcbiAgcmV0dXJuIChieXRlcyAvICgxMDI0ICogMTAyNCkpLnRvRml4ZWQoMikgKyAnIE1CJztcbn1cblxuZnVuY3Rpb24gX2ZtdERhdGVTaG9ydChpc28pIHtcbiAgaWYgKCFpc28pIHJldHVybiAnXHUyMDE0JztcbiAgdHJ5IHtcbiAgICBjb25zdCBkID0gaXNvLnRvRGF0ZSA/IGlzby50b0RhdGUoKSA6IG5ldyBEYXRlKGlzbyk7XG4gICAgcmV0dXJuIChcbiAgICAgIGQudG9Mb2NhbGVEYXRlU3RyaW5nKCdlcy1BUicsIHsgZGF5OiAnMi1kaWdpdCcsIG1vbnRoOiAnc2hvcnQnLCB5ZWFyOiAnMi1kaWdpdCcgfSkgK1xuICAgICAgJyAnICtcbiAgICAgIGQudG9Mb2NhbGVUaW1lU3RyaW5nKCdlcy1BUicsIHsgaG91cjogJzItZGlnaXQnLCBtaW51dGU6ICcyLWRpZ2l0JyB9KVxuICAgICk7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiBTdHJpbmcoaXNvKTtcbiAgfVxufVxuXG5hc3luYyBmdW5jdGlvbiBfbG9hZFNhbGVzUGxhbkNhY2hlcygpIHtcbiAgaWYgKCF3aW5kb3cuZmJEYikgcmV0dXJuO1xuICBhd2FpdCBQcm9taXNlLmFsbChcbiAgICBTQUxFU19QTEFOX0ZBTUlMSUFTLm1hcChhc3luYyAoZikgPT4ge1xuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3QgZG9jID0gYXdhaXQgd2luZG93LmZiRGIuY29sbGVjdGlvbignc2FsZXNfcGxhbl9jYWNoZScpLmRvYyhmLmtleSkuZ2V0KCk7XG4gICAgICAgIF9zYWxlc1BsYW5DYWNoZXNbZi5rZXldID0gZG9jLmV4aXN0cyA/IGRvYy5kYXRhKCkgOiBudWxsO1xuICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICBjb25zb2xlLndhcm4oJ1tGT1JFQ0FTVF0gbG9hZCBzYWxlc19wbGFuX2NhY2hlLycgKyBmLmtleSArICcgZmFpbDonLCBlICYmIGUubWVzc2FnZSk7XG4gICAgICAgIF9zYWxlc1BsYW5DYWNoZXNbZi5rZXldID0gbnVsbDtcbiAgICAgIH1cbiAgICB9KVxuICApO1xufVxuXG5mdW5jdGlvbiBlc2NhcGVIdG1sU2FmZShzKSB7XG4gIGlmICh0eXBlb2Ygd2luZG93LmVzY2FwZUh0bWwgPT09ICdmdW5jdGlvbicpIHJldHVybiB3aW5kb3cuZXNjYXBlSHRtbChzKTtcbiAgcmV0dXJuIFN0cmluZyhzID09IG51bGwgPyAnJyA6IHMpLnJlcGxhY2UoXG4gICAgL1smPD5cIiddL2csXG4gICAgKGNoKSA9PiAoeyAnJic6ICcmYW1wOycsICc8JzogJyZsdDsnLCAnPic6ICcmZ3Q7JywgJ1wiJzogJyZxdW90OycsIFwiJ1wiOiAnJiMzOTsnIH0pW2NoXVxuICApO1xufVxuXG5mdW5jdGlvbiBfYnVpbGRTYWxlc1BsYW5TbG90SHRtbChmKSB7XG4gIGNvbnN0IGNhY2hlID0gX3NhbGVzUGxhbkNhY2hlc1tmLmtleV07XG4gIGNvbnN0IHJvd3NDb3VudCA9IGNhY2hlICYmIE51bWJlci5pc0Zpbml0ZShjYWNoZS5yb3dzQ291bnQpID8gY2FjaGUucm93c0NvdW50IDogMDtcbiAgY29uc3QgbW9udGhzQ291bnQgPVxuICAgIGNhY2hlICYmIEFycmF5LmlzQXJyYXkoY2FjaGUuZGV0ZWN0ZWRNb250aHMpID8gY2FjaGUuZGV0ZWN0ZWRNb250aHMubGVuZ3RoIDogMDtcbiAgY29uc3QgcGFyc2VkQXQgPSBjYWNoZSAmJiBjYWNoZS5wYXJzZWRBdCA/IF9mbXREYXRlU2hvcnQoY2FjaGUucGFyc2VkQXQpIDogJyc7XG4gIGNvbnN0IHVwbG9hZGVkQnkgPSBjYWNoZSAmJiBjYWNoZS51cGxvYWRlZEJ5ID8gY2FjaGUudXBsb2FkZWRCeSA6ICcnO1xuICBjb25zdCBzb3VyY2VGaWxlbmFtZSA9IGNhY2hlICYmIGNhY2hlLnNvdXJjZUZpbGVuYW1lID8gY2FjaGUuc291cmNlRmlsZW5hbWUgOiAnJztcbiAgY29uc3QgeWVhck1vbnRoID0gY2FjaGUgJiYgY2FjaGUueWVhck1vbnRoID8gY2FjaGUueWVhck1vbnRoIDogJyc7XG4gIGNvbnN0IG1vbnRoc1JhbmdlID1cbiAgICBjYWNoZSAmJiBjYWNoZS5kZXRlY3RlZE1vbnRocyAmJiBjYWNoZS5kZXRlY3RlZE1vbnRocy5sZW5ndGhcbiAgICAgID8gY2FjaGUuZGV0ZWN0ZWRNb250aHNbMF0gKyAnIFx1MjE5MiAnICsgY2FjaGUuZGV0ZWN0ZWRNb250aHNbY2FjaGUuZGV0ZWN0ZWRNb250aHMubGVuZ3RoIC0gMV1cbiAgICAgIDogJ1x1MjAxNCc7XG4gIGNvbnN0IGhhc0NhY2hlID0gISFjYWNoZTtcbiAgY29uc3QgYmFkZ2UgPSBoYXNDYWNoZVxuICAgID8gJzxkaXYgc3R5bGU9XCJwYWRkaW5nOjRweCA4cHg7YmFja2dyb3VuZDojMTZhMzRhO2NvbG9yOiNmZmY7Ym9yZGVyLXJhZGl1czoxMnB4O2ZvbnQtc2l6ZToxMHB4O2ZvbnQtd2VpZ2h0OjcwMDtsZXR0ZXItc3BhY2luZzouNHB4XCI+Q0FSR0FETzwvZGl2PidcbiAgICA6ICc8ZGl2IHN0eWxlPVwicGFkZGluZzo0cHggOHB4O2JhY2tncm91bmQ6I2RjMjYyNjtjb2xvcjojZmZmO2JvcmRlci1yYWRpdXM6MTJweDtmb250LXNpemU6MTBweDtmb250LXdlaWdodDo3MDA7bGV0dGVyLXNwYWNpbmc6LjRweFwiPkZBTFRBPC9kaXY+JztcbiAgY29uc3QgbWV0YUJsb2NrID0gaGFzQ2FjaGVcbiAgICA/ICc8ZGl2IHN0eWxlPVwiZGlzcGxheTpncmlkO2dyaWQtdGVtcGxhdGUtY29sdW1uczphdXRvIDFmcjtnYXA6NnB4IDEycHg7Zm9udC1zaXplOjExcHg7cGFkZGluZzoxMHB4IDEycHg7YmFja2dyb3VuZDp2YXIoLS1iZy1zZWNvbmRhcnkpO2JvcmRlci1yYWRpdXM6NnB4XCI+JyArXG4gICAgICAnPGRpdiBzdHlsZT1cImNvbG9yOnZhcigtLXRleHQtbXV0ZWQpO2ZvbnQtd2VpZ2h0OjYwMFwiPkFyY2hpdm88L2Rpdj48ZGl2IHN0eWxlPVwiY29sb3I6dmFyKC0tdGV4dC1wcmltYXJ5KTtmb250LWZhbWlseTptb25vc3BhY2U7d29yZC1icmVhazpicmVhay1hbGxcIj4nICtcbiAgICAgIGVzY2FwZUh0bWxTYWZlKHNvdXJjZUZpbGVuYW1lKSArXG4gICAgICAnPC9kaXY+JyArXG4gICAgICAnPGRpdiBzdHlsZT1cImNvbG9yOnZhcigtLXRleHQtbXV0ZWQpO2ZvbnQtd2VpZ2h0OjYwMFwiPlN1YmlkbzwvZGl2PjxkaXYgc3R5bGU9XCJjb2xvcjp2YXIoLS10ZXh0LXByaW1hcnkpXCI+JyArXG4gICAgICBlc2NhcGVIdG1sU2FmZShwYXJzZWRBdCkgK1xuICAgICAgJzwvZGl2PicgK1xuICAgICAgJzxkaXYgc3R5bGU9XCJjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTtmb250LXdlaWdodDo2MDBcIj5Qb3I8L2Rpdj48ZGl2IHN0eWxlPVwiY29sb3I6dmFyKC0tdGV4dC1wcmltYXJ5KVwiPicgK1xuICAgICAgZXNjYXBlSHRtbFNhZmUodXBsb2FkZWRCeSkgK1xuICAgICAgJzwvZGl2PicgK1xuICAgICAgJzxkaXYgc3R5bGU9XCJjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTtmb250LXdlaWdodDo2MDBcIj5TbmFwc2hvdDwvZGl2PjxkaXYgc3R5bGU9XCJjb2xvcjp2YXIoLS10ZXh0LXByaW1hcnkpO2ZvbnQtZmFtaWx5Om1vbm9zcGFjZVwiPicgK1xuICAgICAgZXNjYXBlSHRtbFNhZmUoeWVhck1vbnRoKSArXG4gICAgICAnPC9kaXY+JyArXG4gICAgICAnPGRpdiBzdHlsZT1cImNvbG9yOnZhcigtLXRleHQtbXV0ZWQpO2ZvbnQtd2VpZ2h0OjYwMFwiPlNLVXM8L2Rpdj48ZGl2IHN0eWxlPVwiY29sb3I6dmFyKC0tdGV4dC1wcmltYXJ5KTtmb250LXdlaWdodDo3MDBcIj4nICtcbiAgICAgIHJvd3NDb3VudC50b0xvY2FsZVN0cmluZygnZXMtQVInKSArXG4gICAgICAnPC9kaXY+JyArXG4gICAgICAnPGRpdiBzdHlsZT1cImNvbG9yOnZhcigtLXRleHQtbXV0ZWQpO2ZvbnQtd2VpZ2h0OjYwMFwiPk1lc2VzPC9kaXY+PGRpdiBzdHlsZT1cImNvbG9yOnZhcigtLXRleHQtcHJpbWFyeSk7Zm9udC13ZWlnaHQ6NzAwXCI+JyArXG4gICAgICBtb250aHNDb3VudCArXG4gICAgICAnIDxzcGFuIHN0eWxlPVwiY29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7Zm9udC13ZWlnaHQ6NDAwXCI+KCcgK1xuICAgICAgZXNjYXBlSHRtbFNhZmUobW9udGhzUmFuZ2UpICtcbiAgICAgICcpPC9zcGFuPjwvZGl2PicgK1xuICAgICAgJzwvZGl2PidcbiAgICA6ICc8ZGl2IHN0eWxlPVwicGFkZGluZzoxNHB4O3RleHQtYWxpZ246Y2VudGVyO2ZvbnQtc2l6ZToxMnB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO2JhY2tncm91bmQ6dmFyKC0tYmctc2Vjb25kYXJ5KTtib3JkZXItcmFkaXVzOjZweDtib3JkZXI6MXB4IGRhc2hlZCB2YXIoLS1ib3JkZXItc3VidGxlKVwiPkF1biBubyBzdWJpc3RlIGVsIFNhbGVzIFBsYW4gZGUgZXN0YSBmYW1pbGlhLjwvZGl2Pic7XG4gIGNvbnN0IHVwbG9hZEJ0biA9XG4gICAgJzxsYWJlbCBzdHlsZT1cImRpc3BsYXk6aW5saW5lLWZsZXg7YWxpZ24taXRlbXM6Y2VudGVyO2p1c3RpZnktY29udGVudDpjZW50ZXI7Z2FwOjhweDtwYWRkaW5nOjEwcHggMTRweDtiYWNrZ3JvdW5kOicgK1xuICAgIGYuY29sb3IgK1xuICAgICc7Y29sb3I6I2ZmZjtib3JkZXItcmFkaXVzOjZweDtmb250LXdlaWdodDo3MDA7Zm9udC1zaXplOjEycHg7Y3Vyc29yOnBvaW50ZXI7bGV0dGVyLXNwYWNpbmc6LjRweFwiPicgK1xuICAgICc8c3Bhbj4nICtcbiAgICAoaGFzQ2FjaGUgPyAnXHUyMUJCIFJlZW1wbGF6YXIgRXhjZWwnIDogJ1x1MkIwNiBDYXJnYXIgRXhjZWwnKSArXG4gICAgJzwvc3Bhbj4nICtcbiAgICAnPGlucHV0IHR5cGU9XCJmaWxlXCIgYWNjZXB0PVwiLnhsc3gsLnhsc1wiIGRhdGEtZmFtaWxpYT1cIicgK1xuICAgIGYua2V5ICtcbiAgICAnXCIgc3R5bGU9XCJkaXNwbGF5Om5vbmVcIiBvbmNoYW5nZT1cIm9uU2FsZXNQbGFuRmlsZUZvckZhbWlsaWEoZXZlbnQsIFxcJycgK1xuICAgIGYua2V5ICtcbiAgICAnXFwnKVwiLz4nICtcbiAgICAnPC9sYWJlbD4nO1xuICBjb25zdCBjYXJkSGVhZCA9XG4gICAgJzxkaXYgc3R5bGU9XCJkaXNwbGF5OmZsZXg7YWxpZ24taXRlbXM6Y2VudGVyO2dhcDoxMHB4XCI+JyArXG4gICAgJzxkaXYgc3R5bGU9XCJ3aWR0aDoxMnB4O2hlaWdodDozMnB4O2JhY2tncm91bmQ6JyArXG4gICAgZi5jb2xvciArXG4gICAgJztib3JkZXItcmFkaXVzOjNweFwiPjwvZGl2PicgK1xuICAgICc8ZGl2IHN0eWxlPVwiZmxleDoxXCI+PGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxNHB4O2ZvbnQtd2VpZ2h0OjgwMDtjb2xvcjp2YXIoLS10ZXh0LXByaW1hcnkpXCI+JyArXG4gICAgZXNjYXBlSHRtbFNhZmUoZi5sYWJlbCkgK1xuICAgICc8L2Rpdj4nICtcbiAgICAnPGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMXB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO21hcmdpbi10b3A6MnB4XCI+U2FsZXMgUGxhbiBtZW5zdWFsIFx1MDBCNyBIb2phIFNBUjwvZGl2PjwvZGl2PicgK1xuICAgIGJhZGdlICtcbiAgICAnPC9kaXY+JztcbiAgcmV0dXJuIChcbiAgICAnPGRpdiBzdHlsZT1cImJhY2tncm91bmQ6dmFyKC0tYmctZWxldmF0ZWQpO2JvcmRlcjoxcHggc29saWQgdmFyKC0tYm9yZGVyLXN1YnRsZSk7Ym9yZGVyLXJhZGl1czoxMHB4O3BhZGRpbmc6MTZweDtkaXNwbGF5OmZsZXg7ZmxleC1kaXJlY3Rpb246Y29sdW1uO2dhcDoxMnB4XCI+JyArXG4gICAgY2FyZEhlYWQgK1xuICAgIG1ldGFCbG9jayArXG4gICAgdXBsb2FkQnRuICtcbiAgICAnPGRpdiBpZD1cInNhbGVzLXBsYW4tc3RhdHVzLScgK1xuICAgIGYua2V5ICtcbiAgICAnXCIgc3R5bGU9XCJmb250LXNpemU6MTFweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTttaW4taGVpZ2h0OjE0cHhcIj48L2Rpdj4nICtcbiAgICAnPC9kaXY+J1xuICApO1xufVxuXG5mdW5jdGlvbiBfcmVuZGVyU2FsZXNQbGFuc1RhYigpIHtcbiAgY29uc3QgY29udCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdmb3JlY2FzdC10YWItc2FsZXMtcGxhbnMnKTtcbiAgaWYgKCFjb250KSByZXR1cm47XG4gIGNvbnN0IHNsb3RzID0gU0FMRVNfUExBTl9GQU1JTElBUy5tYXAoX2J1aWxkU2FsZXNQbGFuU2xvdEh0bWwpLmpvaW4oJycpO1xuICBjb25zdCBpbnRybyA9XG4gICAgJzxkaXYgc3R5bGU9XCJtYXJnaW4tYm90dG9tOjE2cHg7cGFkZGluZzoxMnB4IDE0cHg7YmFja2dyb3VuZDp2YXIoLS1iZy1zZWNvbmRhcnkpO2JvcmRlci1sZWZ0OjNweCBzb2xpZCAjMGQ5NDg4O2JvcmRlci1yYWRpdXM6NnB4O2ZvbnQtc2l6ZToxMnB4O2NvbG9yOnZhcigtLXRleHQtc2Vjb25kYXJ5KTtsaW5lLWhlaWdodDoxLjVcIj4nICtcbiAgICAnPGIgc3R5bGU9XCJjb2xvcjp2YXIoLS10ZXh0LXByaW1hcnkpXCI+RmFzZSAxPC9iPiBcdTIwMTQgQ2FyZ1x1MDBFMSBsb3MgU2FsZXMgUGxhbnMgbWVuc3VhbGVzIChSb2RzIC8gUmVlbHMpLiBTZSBwYXJzZWEgbGEgaG9qYSA8Yj5TQVI8L2I+OiBTS1UsIE1PUSAxMiBtb250aHMsIHkgdW5hIGNvbHVtbmEgcG9yIG1lcy4gJyArXG4gICAgJ0VsIEV4Y2VsIG9yaWdpbmFsIHF1ZWRhIHNuYXBzaG90YWRvIGVuIFN0b3JhZ2UgeSBlbCBwYXJzZW8gcXVlZGEgZW4gRmlyZXN0b3JlIHBhcmEgZWwgY1x1MDBFMWxjdWxvIGRlYmFqby4nICtcbiAgICAnPC9kaXY+JztcbiAgY29uc3QgZ3JpZCA9XG4gICAgJzxkaXYgc3R5bGU9XCJkaXNwbGF5OmdyaWQ7Z3JpZC10ZW1wbGF0ZS1jb2x1bW5zOnJlcGVhdChhdXRvLWZpdCxtaW5tYXgoMzIwcHgsMWZyKSk7Z2FwOjE2cHg7bWFyZ2luLWJvdHRvbToyNHB4XCI+JyArXG4gICAgc2xvdHMgK1xuICAgICc8L2Rpdj4nO1xuICAvLyB2MTEwOTogY29udGVuZWRvciBwYXJhIHRhYmxhIFJlY29tZW5kYWNpXHUwMEYzbiBkZSBDb21wcmEuIFNlIHJlbGxlbmEgb24tZGVtYW5kXG4gIC8vIHZpYSBfcmVuZGVyUmVjb1NlY3Rpb24oKSAobGF6eSBsb2FkIGRlIHN0b2NrX3NuYXBzaG90ICsgc2t1X3ZlbnRhc19zbmFwc2hvdCkuXG4gIGNvbnN0IHJlY29TZWN0aW9uID0gJzxkaXYgaWQ9XCJyZWNvLXNlY3Rpb24tY29udGFpbmVyXCI+PC9kaXY+JztcbiAgY29udC5pbm5lckhUTUwgPSAnPGRpdiBzdHlsZT1cInBhZGRpbmc6MThweFwiPicgKyBpbnRybyArIGdyaWQgKyByZWNvU2VjdGlvbiArICc8L2Rpdj4nO1xuICBfcmVuZGVyUmVjb1NlY3Rpb24oKTtcbn1cblxud2luZG93Lm9uU2FsZXNQbGFuRmlsZUZvckZhbWlsaWEgPSBhc3luYyBmdW5jdGlvbiAoZXZlbnQsIGZhbWlsaWEpIHtcbiAgY29uc3QgZmlsZSA9IGV2ZW50ICYmIGV2ZW50LnRhcmdldCAmJiBldmVudC50YXJnZXQuZmlsZXMgJiYgZXZlbnQudGFyZ2V0LmZpbGVzWzBdO1xuICBpZiAoIWZpbGUpIHJldHVybjtcbiAgY29uc3Qgc3RhdHVzRWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnc2FsZXMtcGxhbi1zdGF0dXMtJyArIGZhbWlsaWEpO1xuICBjb25zdCBzZXRTdGF0dXMgPSAobXNnLCBjb2xvcikgPT4ge1xuICAgIGlmICghc3RhdHVzRWwpIHJldHVybjtcbiAgICBzdGF0dXNFbC50ZXh0Q29udGVudCA9IG1zZztcbiAgICBzdGF0dXNFbC5zdHlsZS5jb2xvciA9IGNvbG9yIHx8ICd2YXIoLS10ZXh0LW11dGVkKSc7XG4gIH07XG4gIHRyeSB7XG4gICAgaWYgKHR5cGVvZiBYTFNYID09PSAndW5kZWZpbmVkJykge1xuICAgICAgYWxlcnQoJ1NoZWV0SlMgKFhMU1gpIG5vIGNhcmdhZG8gXHUyMDE0IHJlY2FyZ1x1MDBFMSBsYSBhcHAuJyk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGlmICghd2luZG93LlNhbGVzUGxhblBhcnNlciB8fCAhd2luZG93LlNhbGVzUGxhblBhcnNlci5wYXJzZVNhbGVzUGxhblNoZWV0KSB7XG4gICAgICBhbGVydCgnUGFyc2VyIFNhbGVzIFBsYW4gbm8gY2FyZ2Fkby4gUmVidWlsZCBidW5kbGUuJyk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGlmICghd2luZG93LmZpcmViYXNlIHx8ICF3aW5kb3cuZmlyZWJhc2Uuc3RvcmFnZSkge1xuICAgICAgYWxlcnQoJ0ZpcmViYXNlIFN0b3JhZ2Ugbm8gZGlzcG9uaWJsZS4nKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgc2V0U3RhdHVzKCdMZXllbmRvIEV4Y2VsXHUyMDI2Jyk7XG4gICAgY29uc3QgYnVmID0gYXdhaXQgZmlsZS5hcnJheUJ1ZmZlcigpO1xuICAgIGNvbnN0IHdiID0gWExTWC5yZWFkKGJ1ZiwgeyB0eXBlOiAnYXJyYXknIH0pO1xuICAgIGNvbnN0IHNhck5hbWUgPSB3Yi5TaGVldE5hbWVzLmZpbmQoXG4gICAgICAobikgPT5cbiAgICAgICAgU3RyaW5nKG4gfHwgJycpXG4gICAgICAgICAgLnRyaW0oKVxuICAgICAgICAgIC50b1VwcGVyQ2FzZSgpID09PSAnU0FSJ1xuICAgICk7XG4gICAgaWYgKCFzYXJOYW1lKSB7XG4gICAgICBzZXRTdGF0dXMoXG4gICAgICAgICdcdTI2QTAgRWwgRXhjZWwgbm8gdGllbmUgaG9qYSBcIlNBUlwiLiBIb2phcyBlbmNvbnRyYWRhczogJyArIHdiLlNoZWV0TmFtZXMuam9pbignLCAnKSxcbiAgICAgICAgJyNkYzI2MjYnXG4gICAgICApO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBjb25zdCBzaGVldCA9IHdiLlNoZWV0c1tzYXJOYW1lXTtcbiAgICBjb25zdCByb3dzID0gWExTWC51dGlscy5zaGVldF90b19qc29uKHNoZWV0LCB7IGhlYWRlcjogMSwgZGVmdmFsOiAnJywgcmF3OiB0cnVlIH0pO1xuICAgIHNldFN0YXR1cygnUGFyc2VhbmRvICcgKyByb3dzLmxlbmd0aCArICcgZmlsYXMgZGUgaG9qYSBcIicgKyBzYXJOYW1lICsgJ1wiXHUyMDI2Jyk7XG4gICAgY29uc3QgcGFyc2VkID0gd2luZG93LlNhbGVzUGxhblBhcnNlci5wYXJzZVNhbGVzUGxhblNoZWV0KHJvd3MpO1xuICAgIGlmICghcGFyc2VkLnJvd3MubGVuZ3RoKSB7XG4gICAgICBzZXRTdGF0dXMoJ1x1MjZBMCBFeGNlbCBwYXJzZWFkbyBwZXJvIHNpbiBTS1VzIHZcdTAwRTFsaWRvcy4nLCAnI2RjMjYyNicpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBjb25zdCB5ZWFyTW9udGggPSBfeWVhck1vbnRoTm93KCk7XG4gICAgY29uc3Qgc3RvcmFnZVBhdGggPSAnZm9yZWNhc3RzX3NuYXBzaG90cy8nICsgeWVhck1vbnRoICsgJy8nICsgZmFtaWxpYSArICcueGxzeCc7XG4gICAgc2V0U3RhdHVzKCdTdWJpZW5kbyBFeGNlbCBhIFN0b3JhZ2UgKCcgKyBfZm10U2l6ZShmaWxlLnNpemUpICsgJylcdTIwMjYnKTtcbiAgICBjb25zdCBzdG9yYWdlUmVmID0gd2luZG93LmZpcmViYXNlLnN0b3JhZ2UoKS5yZWYoc3RvcmFnZVBhdGgpO1xuICAgIGF3YWl0IHN0b3JhZ2VSZWYucHV0KGZpbGUsIHtcbiAgICAgIGNvbnRlbnRUeXBlOiBmaWxlLnR5cGUgfHwgJ2FwcGxpY2F0aW9uL3ZuZC5vcGVueG1sZm9ybWF0cy1vZmZpY2Vkb2N1bWVudC5zcHJlYWRzaGVldG1sLnNoZWV0JyxcbiAgICAgIGN1c3RvbU1ldGFkYXRhOiB7XG4gICAgICAgIGZhbWlsaWEsXG4gICAgICAgIHVwbG9hZGVkQnk6ICh3aW5kb3cuY3VycmVudFVzZXIgJiYgd2luZG93LmN1cnJlbnRVc2VyLmVtYWlsKSB8fCAnJyxcbiAgICAgICAgc291cmNlRmlsZW5hbWU6IGZpbGUubmFtZSB8fCAnJyxcbiAgICAgIH0sXG4gICAgfSk7XG4gICAgc2V0U3RhdHVzKCdHdWFyZGFuZG8gcGFyc2VvIGVuIEZpcmVzdG9yZSAoJyArIHBhcnNlZC5yb3dzLmxlbmd0aCArICcgU0tVcylcdTIwMjYnKTtcbiAgICBjb25zdCB1cGxvYWRlZEJ5ID0gKHdpbmRvdy5jdXJyZW50VXNlciAmJiB3aW5kb3cuY3VycmVudFVzZXIuZW1haWwpIHx8ICd1bmtub3duJztcbiAgICBjb25zdCBwYXlsb2FkID0ge1xuICAgICAgZmFtaWxpYSxcbiAgICAgIHBhcnNlZEF0OlxuICAgICAgICB3aW5kb3cuZmlyZWJhc2UgJiYgd2luZG93LmZpcmViYXNlLmZpcmVzdG9yZSAmJiB3aW5kb3cuZmlyZWJhc2UuZmlyZXN0b3JlLkZpZWxkVmFsdWVcbiAgICAgICAgICA/IHdpbmRvdy5maXJlYmFzZS5maXJlc3RvcmUuRmllbGRWYWx1ZS5zZXJ2ZXJUaW1lc3RhbXAoKVxuICAgICAgICAgIDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgICAgdXBsb2FkZWRCeSxcbiAgICAgIHNvdXJjZUZpbGVuYW1lOiBmaWxlLm5hbWUgfHwgJycsXG4gICAgICBzb3VyY2VTaGVldDogc2FyTmFtZSxcbiAgICAgIHllYXJNb250aCxcbiAgICAgIHN0b3JhZ2VQYXRoLFxuICAgICAgcm93c0NvdW50OiBwYXJzZWQucm93cy5sZW5ndGgsXG4gICAgICBoZWFkZXJSb3dJbmRleDogcGFyc2VkLmhlYWRlclJvd0luZGV4LFxuICAgICAgZGV0ZWN0ZWRNb250aHM6IHBhcnNlZC5kZXRlY3RlZE1vbnRocyxcbiAgICAgIHJvd3M6IHBhcnNlZC5yb3dzLFxuICAgIH07XG4gICAgYXdhaXQgd2luZG93LmZiRGIuY29sbGVjdGlvbignc2FsZXNfcGxhbl9jYWNoZScpLmRvYyhmYW1pbGlhKS5zZXQocGF5bG9hZCk7XG4gICAgLy8gdjExMDcgZml4OiBndWFyZGFyIGNhY2hlIGxvY2FsIGNvbiBEYXRlIHJlYWwgKG5vIGVsIFNlbnRpbmVsVmFsdWUpIHBhcmFcbiAgICAvLyBxdWUgX2ZtdERhdGVTaG9ydCBubyBtdWVzdHJlIFwiSW52YWxpZCBEYXRlXCIuIEVsIHNlcnZlciB0aWVuZSBlbCB0cyBleGFjdG8sXG4gICAgLy8gZWwgbG9jYWwgbXVlc3RyYSBlbCBtb21lbnRvIGRlbCB1cGxvYWQgKGFwcm94aW1hZG8gfjFzIGRlIGRpZmVyZW5jaWEpLlxuICAgIF9zYWxlc1BsYW5DYWNoZXNbZmFtaWxpYV0gPSBPYmplY3QuYXNzaWduKHt9LCBwYXlsb2FkLCB7IHBhcnNlZEF0OiBuZXcgRGF0ZSgpIH0pO1xuICAgIHNldFN0YXR1cyhcbiAgICAgICdcdTI3MTMgT0suICcgKyBwYXJzZWQucm93cy5sZW5ndGggKyAnIFNLVXMgXHUwMEQ3ICcgKyBwYXJzZWQuZGV0ZWN0ZWRNb250aHMubGVuZ3RoICsgJyBtZXNlcy4nLFxuICAgICAgJyMxNmEzNGEnXG4gICAgKTtcbiAgICBfcmVuZGVyU2FsZXNQbGFuc1RhYigpO1xuICB9IGNhdGNoIChlKSB7XG4gICAgY29uc29sZS5lcnJvcignW0ZPUkVDQVNUXSB1cGxvYWQgc2FsZXMgcGxhbiAnICsgZmFtaWxpYSArICcgZmFpbDonLCBlKTtcbiAgICBzZXRTdGF0dXMoJ1x1MjcxNyBFcnJvcjogJyArICgoZSAmJiBlLm1lc3NhZ2UpIHx8IGUpLCAnI2RjMjYyNicpO1xuICAgIGlmIChlICYmIGUuY29kZSA9PT0gJ01PTlRIU19OT1RfRk9VTkQnKSB7XG4gICAgICBhbGVydChcbiAgICAgICAgJ0VsIEV4Y2VsIG5vIHRpZW5lIGNvbHVtbmFzIGRlIG1lc2VzIHJlY29ub2NpYmxlcy5cXG5cXG5IZWFkZXJzIGVzcGVyYWRvczogXCJKYW4gMjAyN1wiLCBcIk1heSAyMDI3XCIsIFwiRW5lIDIwMjdcIiwgXCIyMDI3LTAxXCIsIGV0Yy5cXG5cXG5EZXRhbGxlOiAnICtcbiAgICAgICAgICBlLm1lc3NhZ2VcbiAgICAgICk7XG4gICAgfVxuICB9IGZpbmFsbHkge1xuICAgIGlmIChldmVudCAmJiBldmVudC50YXJnZXQpIGV2ZW50LnRhcmdldC52YWx1ZSA9ICcnO1xuICB9XG59O1xuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIEYyQiBcdTIwMTQgRm9yZWNhc3QgRXN0YWRcdTAwRURzdGljbzogdGFibGEgKyBkZXRhbGxlXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuYXN5bmMgZnVuY3Rpb24gX2xvYWRGb3JlY2FzdE91dHB1dCgpIHtcbiAgaWYgKCF3aW5kb3cuZmJEYikgdGhyb3cgbmV3IEVycm9yKCdGaXJlc3RvcmUgbm8gaW5pY2lhbGl6YWRvJyk7XG4gIGNvbnNvbGUubG9nKCdbRk9SRUNBU1Qgc3RhdF0gbG9hZGluZyBmb3JlY2FzdF9vdXRwdXQuLi4nKTtcbiAgY29uc3QgW3NuYXAsIG1ldGFEb2NdID0gYXdhaXQgUHJvbWlzZS5hbGwoW1xuICAgIHdpbmRvdy5mYkRiLmNvbGxlY3Rpb24oJ2ZvcmVjYXN0X291dHB1dCcpLmdldCgpLFxuICAgIHdpbmRvdy5mYkRiLmNvbGxlY3Rpb24oJ2ZvcmVjYXN0X291dHB1dF9tZXRhJykuZG9jKCdjdXJyZW50JykuZ2V0KCksXG4gIF0pO1xuICBjb25zdCBkb2NzID0gW107XG4gIHNuYXAuZm9yRWFjaCgoZCkgPT4gZG9jcy5wdXNoKE9iamVjdC5hc3NpZ24oeyBpZDogZC5pZCB9LCBkLmRhdGEoKSkpKTtcbiAgZG9jcy5zb3J0KChhLCBiKSA9PiB7XG4gICAgY29uc3Qgd2EgPSAoYS5tZXRyaWNzICYmIGEubWV0cmljcy53YXBlKSB8fCA5OTk7XG4gICAgY29uc3Qgd2IgPSAoYi5tZXRyaWNzICYmIGIubWV0cmljcy53YXBlKSB8fCA5OTk7XG4gICAgcmV0dXJuIHdhIC0gd2I7XG4gIH0pO1xuICBfZm9yZWNhc3RTdGF0RG9jcyA9IGRvY3M7XG4gIF9mb3JlY2FzdFN0YXRNZXRhID0gbWV0YURvYy5leGlzdHMgPyBtZXRhRG9jLmRhdGEoKSA6IG51bGw7XG4gIGNvbnNvbGUubG9nKCdbRk9SRUNBU1Qgc3RhdF0gbG9hZGVkJywgZG9jcy5sZW5ndGgsICdkb2NzIFx1MDBCNyBtZXRhOicsICEhX2ZvcmVjYXN0U3RhdE1ldGEpO1xuICByZXR1cm4gZG9jcztcbn1cblxuZnVuY3Rpb24gX3dhcGVCYWRnZUNvbG9yKHcpIHtcbiAgaWYgKHcgPT0gbnVsbCkgcmV0dXJuICcjNjQ3NDhiJztcbiAgaWYgKHcgPCAwLjMpIHJldHVybiAnIzE2YTM0YSc7IC8vIHZlcmRlIC0gZXhjZWxlbnRlXG4gIGlmICh3IDwgMC41KSByZXR1cm4gJyM4NGNjMTYnOyAvLyBsaW1hIC0gYnVlbm9cbiAgaWYgKHcgPCAwLjcpIHJldHVybiAnI2VhYjMwOCc7IC8vIGFtYXJpbGxvIC0gYWNlcHRhYmxlXG4gIGlmICh3IDwgMS4wKSByZXR1cm4gJyNmOTczMTYnOyAvLyBuYXJhbmphIC0gcG9icmVcbiAgcmV0dXJuICcjZGMyNjI2JzsgLy8gcm9qbyAtIG11eSBwb2JyZVxufVxuXG5mdW5jdGlvbiBfZm10TnVtKG4pIHtcbiAgaWYgKG4gPT0gbnVsbCB8fCAhTnVtYmVyLmlzRmluaXRlKE51bWJlcihuKSkpIHJldHVybiAnXHUyMDE0JztcbiAgcmV0dXJuIE51bWJlcihuKS50b0xvY2FsZVN0cmluZygnZXMtQVInLCB7IG1heGltdW1GcmFjdGlvbkRpZ2l0czogMCB9KTtcbn1cblxuZnVuY3Rpb24gX2ZtdFdhcGUodykge1xuICBpZiAodyA9PSBudWxsIHx8ICFOdW1iZXIuaXNGaW5pdGUoTnVtYmVyKHcpKSkgcmV0dXJuICdcdTIwMTQnO1xuICByZXR1cm4gKE51bWJlcih3KSAqIDEwMCkudG9GaXhlZCgwKSArICclJztcbn1cblxuZnVuY3Rpb24gX2ZtdERzU2hvcnQoaXNvKSB7XG4gIC8vICcyMDI2LTEwLTAxJyAtPiAnb2N0IDI2J1xuICB0cnkge1xuICAgIGNvbnN0IFt5LCBtXSA9IGlzby5zcGxpdCgnLScpLm1hcChOdW1iZXIpO1xuICAgIGNvbnN0IG5hbWVzID0gW1xuICAgICAgJ2VuZScsXG4gICAgICAnZmViJyxcbiAgICAgICdtYXInLFxuICAgICAgJ2FicicsXG4gICAgICAnbWF5JyxcbiAgICAgICdqdW4nLFxuICAgICAgJ2p1bCcsXG4gICAgICAnYWdvJyxcbiAgICAgICdzZXAnLFxuICAgICAgJ29jdCcsXG4gICAgICAnbm92JyxcbiAgICAgICdkaWMnLFxuICAgIF07XG4gICAgcmV0dXJuIG5hbWVzW20gLSAxXSArICcgJyArIFN0cmluZyh5KS5zbGljZSgtMik7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiBpc287XG4gIH1cbn1cblxuZnVuY3Rpb24gX3JlbmRlckZvcmVjYXN0U3RhdFRhYigpIHtcbiAgY29uc3QgY29udCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdmb3JlY2FzdC10YWItc3RhdCcpO1xuICBpZiAoIWNvbnQpIHJldHVybjtcbiAgdHJ5IHtcbiAgICBfcmVuZGVyRm9yZWNhc3RTdGF0VGFiSW1wbChjb250KTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGNvbnNvbGUuZXJyb3IoJ1tGT1JFQ0FTVCBzdGF0XSByZW5kZXIgZmFpbCcsIGUpO1xuICAgIGNvbnQuaW5uZXJIVE1MID1cbiAgICAgICc8ZGl2IHN0eWxlPVwicGFkZGluZzo0MHB4IDIwcHg7Y29sb3I6I2RjMjYyNjtsaW5lLWhlaWdodDoxLjZcIj4nICtcbiAgICAgICc8ZGl2IHN0eWxlPVwiZm9udC1zaXplOjE2cHg7Zm9udC13ZWlnaHQ6NzAwO21hcmdpbi1ib3R0b206MTBweFwiPkVycm9yIHJlbmRlcml6YW5kbyB0YWIgRm9yZWNhc3QgRXN0YWRcdTAwRURzdGljbzwvZGl2PicgK1xuICAgICAgJzxwcmUgc3R5bGU9XCJmb250LXNpemU6MTFweDtiYWNrZ3JvdW5kOiNmZWYyZjI7cGFkZGluZzoxMnB4O2JvcmRlci1yYWRpdXM6NnB4O292ZXJmbG93OmF1dG87d2hpdGUtc3BhY2U6cHJlLXdyYXBcIj4nICtcbiAgICAgIGVzY2FwZUh0bWxTYWZlKGUuc3RhY2sgfHwgZS5tZXNzYWdlIHx8IFN0cmluZyhlKSkgK1xuICAgICAgJzwvcHJlPjwvZGl2Pic7XG4gIH1cbn1cblxuZnVuY3Rpb24gX3JlbmRlckZvcmVjYXN0U3RhdFRhYkltcGwoY29udCkge1xuICBjb25zdCBkb2NzID0gX2ZvcmVjYXN0U3RhdERvY3MgfHwgW107XG4gIGNvbnN0IG1ldGEgPSBfZm9yZWNhc3RTdGF0TWV0YSB8fCB7fTtcbiAgY29uc3QgcmVzdW1lbiA9IG1ldGEucmVzdW1lbiB8fCB7fTtcbiAgY29uc29sZS5sb2coJ1tGT1JFQ0FTVCBzdGF0XSByZW5kZXIgXHUyMDE0IGRvY3M6JywgZG9jcy5sZW5ndGgsICdtZXRhOicsICEhbWV0YS5nZW5lcmF0ZWRBdCk7XG4gIGlmICghZG9jcy5sZW5ndGgpIHtcbiAgICBjb250LmlubmVySFRNTCA9XG4gICAgICAnPGRpdiBzdHlsZT1cInBhZGRpbmc6NjBweCAyMHB4O3RleHQtYWxpZ246Y2VudGVyO2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpXCI+JyArXG4gICAgICAnTm8gaGF5IGZvcmVjYXN0X291dHB1dCBwdWJsaWNhZG8uPGJyPjxicj4nICtcbiAgICAgICdDb3JyZXIgPGNvZGU+cHl0aG9uIHNjcmlwdHMvZm9yZWNhc3QvdHJhaW5fcHJvZC5weSAmJiBweXRob24gc2NyaXB0cy9mb3JlY2FzdC9wdWJsaXNoX3RvX2ZpcmVzdG9yZS5weTwvY29kZT4uJyArXG4gICAgICAnPC9kaXY+JztcbiAgICByZXR1cm47XG4gIH1cbiAgLy8gTWVzZXMgZGVsIGZvcmVjYXN0IChkcyBkZWwgcHJpbWVyIGRvYywgc2UgYXN1bWUgaWd1YWwgZW4gdG9kb3MpLlxuICBjb25zdCBtb250aHNJc28gPSAoZG9jc1swXS5mb3JlY2FzdCB8fCBbXSkubWFwKChmKSA9PiBmLmRzKTtcbiAgY29uc3QgbW9udGhIZWFkZXJzID0gbW9udGhzSXNvLm1hcChfZm10RHNTaG9ydCk7XG5cbiAgLy8gTWV0cmljcyBjaGlwIGdsb2JhbFxuICBjb25zdCBnZW5lcmF0ZWQgPSBtZXRhLmdlbmVyYXRlZEF0XG4gICAgPyBuZXcgRGF0ZShtZXRhLmdlbmVyYXRlZEF0KS50b0xvY2FsZVN0cmluZygnZXMtQVInLCB7XG4gICAgICAgIGRheTogJzItZGlnaXQnLFxuICAgICAgICBtb250aDogJ3Nob3J0JyxcbiAgICAgICAgeWVhcjogJzItZGlnaXQnLFxuICAgICAgICBob3VyOiAnMi1kaWdpdCcsXG4gICAgICAgIG1pbnV0ZTogJzItZGlnaXQnLFxuICAgICAgfSlcbiAgICA6ICdcdTIwMTQnO1xuICBjb25zdCB3YXBlTWVkID1cbiAgICByZXN1bWVuLndhcGVfbWVkaWFub19iZXN0X3Blcl9zZXJpZXMgIT0gbnVsbFxuICAgICAgPyBfZm10V2FwZShyZXN1bWVuLndhcGVfbWVkaWFub19iZXN0X3Blcl9zZXJpZXMpXG4gICAgICA6ICdcdTIwMTQnO1xuICBjb25zdCBuU3VicyA9IHJlc3VtZW4ubl9zdWJmYW1pbGlhcyB8fCBkb2NzLmxlbmd0aDtcbiAgY29uc3Qgbkx0MDUgPVxuICAgIHJlc3VtZW4ubl9zZXJpZXNfd2FwZV9sdF8wXzUgIT0gbnVsbCA/IHJlc3VtZW4ubl9zZXJpZXNfd2FwZV9sdF8wXzUgKyAnLycgKyBuU3VicyA6ICdcdTIwMTQnO1xuICBjb25zdCBuTHQwMyA9XG4gICAgcmVzdW1lbi5uX3Nlcmllc193YXBlX2x0XzBfMyAhPSBudWxsID8gcmVzdW1lbi5uX3Nlcmllc193YXBlX2x0XzBfMyArICcvJyArIG5TdWJzIDogJ1x1MjAxNCc7XG5cbiAgY29uc3QgYmFubmVyID1cbiAgICAnPGRpdiBzdHlsZT1cIm1hcmdpbi1ib3R0b206MTRweDtwYWRkaW5nOjEycHggMTRweDtiYWNrZ3JvdW5kOnZhcigtLWJnLXNlY29uZGFyeSk7Ym9yZGVyLWxlZnQ6M3B4IHNvbGlkICMwZDk0ODg7Ym9yZGVyLXJhZGl1czo2cHg7Zm9udC1zaXplOjEycHg7Y29sb3I6dmFyKC0tdGV4dC1zZWNvbmRhcnkpO2xpbmUtaGVpZ2h0OjEuNTtkaXNwbGF5OmdyaWQ7Z3JpZC10ZW1wbGF0ZS1jb2x1bW5zOnJlcGVhdChhdXRvLWZpdCxtaW5tYXgoMTYwcHgsMWZyKSk7Z2FwOjEwcHhcIj4nICtcbiAgICAnPGRpdj48ZGl2IHN0eWxlPVwiZm9udC1zaXplOjEwcHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO2xldHRlci1zcGFjaW5nOi40cHhcIj5XQVBFIG1lZGlhbm88L2Rpdj48ZGl2IHN0eWxlPVwiZm9udC1zaXplOjIwcHg7Zm9udC13ZWlnaHQ6ODAwO2NvbG9yOnZhcigtLXRleHQtcHJpbWFyeSlcIj4nICtcbiAgICB3YXBlTWVkICtcbiAgICAnPC9kaXY+PC9kaXY+JyArXG4gICAgJzxkaXY+PGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMHB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtsZXR0ZXItc3BhY2luZzouNHB4XCI+U3ViZmFtaWxpYXM8L2Rpdj48ZGl2IHN0eWxlPVwiZm9udC1zaXplOjIwcHg7Zm9udC13ZWlnaHQ6ODAwO2NvbG9yOnZhcigtLXRleHQtcHJpbWFyeSlcIj4nICtcbiAgICBuU3VicyArXG4gICAgJzwvZGl2PjwvZGl2PicgK1xuICAgICc8ZGl2PjxkaXYgc3R5bGU9XCJmb250LXNpemU6MTBweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7bGV0dGVyLXNwYWNpbmc6LjRweFwiPldBUEUgJmx0OyAzMCUgKGV4Y2VsZW50ZSk8L2Rpdj48ZGl2IHN0eWxlPVwiZm9udC1zaXplOjIwcHg7Zm9udC13ZWlnaHQ6ODAwO2NvbG9yOiMxNmEzNGFcIj4nICtcbiAgICBuTHQwMyArXG4gICAgJzwvZGl2PjwvZGl2PicgK1xuICAgICc8ZGl2PjxkaXYgc3R5bGU9XCJmb250LXNpemU6MTBweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7bGV0dGVyLXNwYWNpbmc6LjRweFwiPldBUEUgJmx0OyA1MCUgKGJ1ZW5vKTwvZGl2PjxkaXYgc3R5bGU9XCJmb250LXNpemU6MjBweDtmb250LXdlaWdodDo4MDA7Y29sb3I6Izg0Y2MxNlwiPicgK1xuICAgIG5MdDA1ICtcbiAgICAnPC9kaXY+PC9kaXY+JyArXG4gICAgJzxkaXY+PGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMHB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtsZXR0ZXItc3BhY2luZzouNHB4XCI+XHUwMERBbHRpbWEgY29ycmlkYTwvZGl2PjxkaXYgc3R5bGU9XCJmb250LXNpemU6MTNweDtmb250LXdlaWdodDo2MDA7Y29sb3I6dmFyKC0tdGV4dC1wcmltYXJ5KTttYXJnaW4tdG9wOjRweFwiPicgK1xuICAgIGVzY2FwZUh0bWxTYWZlKGdlbmVyYXRlZCkgK1xuICAgICc8L2Rpdj48L2Rpdj4nICtcbiAgICAnPC9kaXY+JztcblxuICAvLyBUYWJsYSByb3dzXG4gIGNvbnN0IHJvd3NIdG1sID0gZG9jc1xuICAgIC5tYXAoKGQpID0+IHtcbiAgICAgIGNvbnN0IHdhcGUgPSBkLm1ldHJpY3MgJiYgZC5tZXRyaWNzLndhcGUgIT0gbnVsbCA/IGQubWV0cmljcy53YXBlIDogbnVsbDtcbiAgICAgIGNvbnN0IGJlc3RNb2RlbCA9IGQuYmVzdE1vZGVsIHx8ICdcdTIwMTQnO1xuICAgICAgY29uc3QgZm9yZWNhc3RNYXAgPSB7fTtcbiAgICAgIChkLmZvcmVjYXN0IHx8IFtdKS5mb3JFYWNoKChmKSA9PiB7XG4gICAgICAgIGZvcmVjYXN0TWFwW2YuZHNdID0gZi55X2hhdDtcbiAgICAgIH0pO1xuICAgICAgY29uc3QgbW9udGhDZWxscyA9IG1vbnRoc0lzb1xuICAgICAgICAubWFwKFxuICAgICAgICAgIChkcykgPT5cbiAgICAgICAgICAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjhweCAxMHB4O3RleHQtYWxpZ246cmlnaHQ7Zm9udC12YXJpYW50LW51bWVyaWM6dGFidWxhci1udW1zO2ZvbnQtd2VpZ2h0OjYwMDtjb2xvcjp2YXIoLS10ZXh0LXByaW1hcnkpXCI+JyArXG4gICAgICAgICAgICBfZm10TnVtKGZvcmVjYXN0TWFwW2RzXSkgK1xuICAgICAgICAgICAgJzwvdGQ+J1xuICAgICAgICApXG4gICAgICAgIC5qb2luKCcnKTtcbiAgICAgIGNvbnN0IHRvdGFsNyA9IChkLmZvcmVjYXN0IHx8IFtdKS5yZWR1Y2UoKHMsIGYpID0+IHMgKyAoTnVtYmVyKGYueV9oYXQpIHx8IDApLCAwKTtcbiAgICAgIHJldHVybiAoXG4gICAgICAgICc8dHIgb25jbGljaz1cIm9wZW5Gb3JlY2FzdFN0YXREZXRhaWwoXFwnJyArXG4gICAgICAgIGVzY2FwZUh0bWxTYWZlKGQuaWQpICtcbiAgICAgICAgJ1xcJylcIiBzdHlsZT1cImN1cnNvcjpwb2ludGVyO2JvcmRlci1ib3R0b206MXB4IHNvbGlkIHZhcigtLWJvcmRlci1zdWJ0bGUpXCIgb25tb3VzZW92ZXI9XCJ0aGlzLnN0eWxlLmJhY2tncm91bmQ9XFwndmFyKC0tYmctc2Vjb25kYXJ5KVxcJ1wiIG9ubW91c2VvdXQ9XCJ0aGlzLnN0eWxlLmJhY2tncm91bmQ9XFwndHJhbnNwYXJlbnRcXCdcIj4nICtcbiAgICAgICAgJzx0ZCBzdHlsZT1cInBhZGRpbmc6OHB4IDEwcHg7Zm9udC13ZWlnaHQ6NzAwO2NvbG9yOnZhcigtLXRleHQtcHJpbWFyeSlcIj4nICtcbiAgICAgICAgZXNjYXBlSHRtbFNhZmUoZC5zdWJmYW1pbGlhIHx8IGQuaWQpICtcbiAgICAgICAgJzwvdGQ+JyArXG4gICAgICAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjhweCAxMHB4O2ZvbnQtc2l6ZToxMXB4O2NvbG9yOnZhcigtLXRleHQtc2Vjb25kYXJ5KVwiPicgK1xuICAgICAgICBlc2NhcGVIdG1sU2FmZShiZXN0TW9kZWwpICtcbiAgICAgICAgJzwvdGQ+JyArXG4gICAgICAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjhweCAxMHB4O3RleHQtYWxpZ246Y2VudGVyXCI+PHNwYW4gc3R5bGU9XCJkaXNwbGF5OmlubGluZS1ibG9jaztwYWRkaW5nOjNweCA4cHg7Ym9yZGVyLXJhZGl1czoxMnB4O2JhY2tncm91bmQ6JyArXG4gICAgICAgIF93YXBlQmFkZ2VDb2xvcih3YXBlKSArXG4gICAgICAgICc7Y29sb3I6I2ZmZjtmb250LXNpemU6MTFweDtmb250LXdlaWdodDo3MDBcIj4nICtcbiAgICAgICAgX2ZtdFdhcGUod2FwZSkgK1xuICAgICAgICAnPC9zcGFuPjwvdGQ+JyArXG4gICAgICAgIG1vbnRoQ2VsbHMgK1xuICAgICAgICAnPHRkIHN0eWxlPVwicGFkZGluZzo4cHggMTBweDt0ZXh0LWFsaWduOnJpZ2h0O2ZvbnQtdmFyaWFudC1udW1lcmljOnRhYnVsYXItbnVtcztmb250LXdlaWdodDo3MDA7Y29sb3I6IzBkOTQ4ODtiYWNrZ3JvdW5kOnZhcigtLWJnLXNlY29uZGFyeSlcIj4nICtcbiAgICAgICAgX2ZtdE51bSh0b3RhbDcpICtcbiAgICAgICAgJzwvdGQ+JyArXG4gICAgICAgICc8L3RyPidcbiAgICAgICk7XG4gICAgfSlcbiAgICAuam9pbignJyk7XG5cbiAgY29uc3QgbW9udGhIZWFkZXJzSHRtbCA9IG1vbnRoSGVhZGVyc1xuICAgIC5tYXAoXG4gICAgICAobSkgPT5cbiAgICAgICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6OHB4IDEwcHg7dGV4dC1hbGlnbjpyaWdodDtmb250LXNpemU6MTBweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7bGV0dGVyLXNwYWNpbmc6LjRweDtjb2xvcjojOTRhM2I4XCI+JyArXG4gICAgICAgIGVzY2FwZUh0bWxTYWZlKG0pICtcbiAgICAgICAgJzwvdGg+J1xuICAgIClcbiAgICAuam9pbignJyk7XG5cbiAgY29uc3QgdGFibGUgPVxuICAgICc8ZGl2IHN0eWxlPVwib3ZlcmZsb3c6YXV0bztib3JkZXI6MXB4IHNvbGlkIHZhcigtLWJvcmRlci1zdWJ0bGUpO2JvcmRlci1yYWRpdXM6OHB4XCI+JyArXG4gICAgJzx0YWJsZSBzdHlsZT1cIndpZHRoOjEwMCU7Ym9yZGVyLWNvbGxhcHNlOmNvbGxhcHNlO2ZvbnQtc2l6ZToxMnB4XCI+JyArXG4gICAgJzx0aGVhZCBzdHlsZT1cImJhY2tncm91bmQ6IzBmMTcyYTtjb2xvcjojZmZmXCI+PHRyPicgK1xuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjhweCAxMHB4O3RleHQtYWxpZ246bGVmdDtmb250LXNpemU6MTBweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7bGV0dGVyLXNwYWNpbmc6LjRweFwiPlN1YmZhbWlsaWE8L3RoPicgK1xuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjhweCAxMHB4O3RleHQtYWxpZ246bGVmdDtmb250LXNpemU6MTBweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7bGV0dGVyLXNwYWNpbmc6LjRweFwiPk1vZGVsbzwvdGg+JyArXG4gICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6OHB4IDEwcHg7dGV4dC1hbGlnbjpjZW50ZXI7Zm9udC1zaXplOjEwcHg7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO2xldHRlci1zcGFjaW5nOi40cHhcIj5XQVBFPC90aD4nICtcbiAgICBtb250aEhlYWRlcnNIdG1sICtcbiAgICAnPHRoIHN0eWxlPVwicGFkZGluZzo4cHggMTBweDt0ZXh0LWFsaWduOnJpZ2h0O2ZvbnQtc2l6ZToxMHB4O3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtsZXR0ZXItc3BhY2luZzouNHB4O2JhY2tncm91bmQ6IzEzNGU0YVwiPlRvdGFsIDdtPC90aD4nICtcbiAgICAnPC90cj48L3RoZWFkPicgK1xuICAgICc8dGJvZHk+JyArXG4gICAgcm93c0h0bWwgK1xuICAgICc8L3Rib2R5PjwvdGFibGU+PC9kaXY+JztcblxuICBjb25zdCBmb290ZXIgPVxuICAgICc8ZGl2IHN0eWxlPVwibWFyZ2luLXRvcDoxMnB4O2ZvbnQtc2l6ZToxMXB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO2xpbmUtaGVpZ2h0OjEuNVwiPicgK1xuICAgICc8Yj5DXHUwMEYzbW8gbGVlcjwvYj46IFdBUEUgKFdlaWdodGVkIEFic29sdXRlIFBlcmNlbnRhZ2UgRXJyb3IpIG1pZGUgZWwgZXJyb3IgZGVsIG1vZGVsbyByZWxhdGl2byBhbCB0b3RhbCByZWFsOiAmbHQ7MzAlIGV4Y2VsZW50ZSwgMzAtNTAlIGJ1ZW5vLCA1MC03MCUgYWNlcHRhYmxlLCAmZ3Q7NzAlIHBvYnJlLiBDbGljayBlbiBmaWxhIHBhcmEgZGV0YWxsZSArIGdyXHUwMEUxZmljby4gJyArXG4gICAgJ1NlIGVsaWdlIGVsIG1vZGVsbyBjb24gbWVub3IgV0FQRSBwb3Igc2VyaWUgdHJhcyBiYWNrdGVzdCByb2xsaW5nLW9yaWdpbiAoaD0yLCB2ZW50YW5hcz0zKS4nICtcbiAgICAnPC9kaXY+JztcblxuICBjb250LmlubmVySFRNTCA9ICc8ZGl2IHN0eWxlPVwicGFkZGluZzoxOHB4XCI+JyArIGJhbm5lciArIHRhYmxlICsgZm9vdGVyICsgJzwvZGl2Pic7XG59XG5cbi8vIENhY2hlIGhpc3RvcmlhIGFncmVnYWRhIHBvciBzdWJmYW1pbGlhIChwYXJhIGdyXHUwMEUxZmljbyBkZXRhbGxlKS5cbmFzeW5jIGZ1bmN0aW9uIF9sb2FkRm9yZWNhc3RTdGF0SGlzdG9yeSgpIHtcbiAgaWYgKF9mb3JlY2FzdFN0YXRIaXN0b3J5Q2FjaGUpIHJldHVybiBfZm9yZWNhc3RTdGF0SGlzdG9yeUNhY2hlO1xuICAvLyBMYSBoaXN0b3JpYSBzb2xvIGVzdFx1MDBFMSBlbiBCUSAofjEwIGFcdTAwRjFvcyBCYXJhbGRvICsgMTIgbWVzZXMgU2hpbWFubykuIENvbW9cbiAgLy8gZWwgcGlwZWxpbmUgbGEgZXNjcmliZSBhIENTViBsb2NhbCwgYWNcdTAwRTEgbm8gbGEgcG9kZW1vcyBsZWVyLiBBbHRlcm5hdGl2YTpcbiAgLy8gdXNhciBza3VfdmVudGFzX3NuYXBzaG90IHF1ZSB0aWVuZSB2ZW50YXMgbWVuc3VhbGVzIHBlcm8gc29sbyBncnVwbyBQRVNDQS5cbiAgLy8gRW4gRjJCLjIgc29sbyBtb3N0cmFtb3MgZm9yZWNhc3QrSUMgKHNpbiBvdmVybGF5IGhpc3RvcmlhIHBvciBhaG9yYSkuXG4gIF9mb3JlY2FzdFN0YXRIaXN0b3J5Q2FjaGUgPSB7fTtcbiAgcmV0dXJuIF9mb3JlY2FzdFN0YXRIaXN0b3J5Q2FjaGU7XG59XG5cbmZ1bmN0aW9uIF9idWlsZEZvcmVjYXN0Q2hhcnRTdmcoZG9jKSB7XG4gIGNvbnN0IGZjID0gZG9jLmZvcmVjYXN0IHx8IFtdO1xuICBpZiAoIWZjLmxlbmd0aClcbiAgICByZXR1cm4gJzxkaXYgc3R5bGU9XCJwYWRkaW5nOjMwcHg7dGV4dC1hbGlnbjpjZW50ZXI7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZClcIj5TaW4gZGF0b3MgZGUgZm9yZWNhc3Q8L2Rpdj4nO1xuICAvLyBEaW1lbnNpb25lc1xuICBjb25zdCBXID0gNjQwLFxuICAgIEggPSAyNjA7XG4gIGNvbnN0IHBhZEwgPSA1MCxcbiAgICBwYWRSID0gMjAsXG4gICAgcGFkVCA9IDIwLFxuICAgIHBhZEIgPSA0MDtcbiAgY29uc3QgaW5uZXJXID0gVyAtIHBhZEwgLSBwYWRSO1xuICBjb25zdCBpbm5lckggPSBIIC0gcGFkVCAtIHBhZEI7XG5cbiAgLy8gWSByYW5nZTogbWF4KGhpODApICogMS4xXG4gIGNvbnN0IG1heFkgPSBNYXRoLm1heCgxLCAuLi5mYy5tYXAoKGYpID0+IE51bWJlcihmLmhpODApIHx8IE51bWJlcihmLnlfaGF0KSB8fCAwKSk7XG4gIGNvbnN0IG1pblkgPSAwO1xuICBjb25zdCBzY2FsZVggPSAoaSkgPT4gcGFkTCArIChpbm5lclcgKiBpKSAvIE1hdGgubWF4KDEsIGZjLmxlbmd0aCAtIDEpO1xuICBjb25zdCBzY2FsZVkgPSAodikgPT4gcGFkVCArIGlubmVySCAtIChpbm5lckggKiAodiAtIG1pblkpKSAvIChtYXhZIC0gbWluWSk7XG5cbiAgLy8gR3JpZCArIGVqZSBZXG4gIGNvbnN0IHlUaWNrcyA9IFswLCAwLjI1LCAwLjUsIDAuNzUsIDFdXG4gICAgLm1hcCgocikgPT4ge1xuICAgICAgY29uc3QgdmFsID0gbWluWSArIHIgKiAobWF4WSAtIG1pblkpO1xuICAgICAgY29uc3QgeXkgPSBzY2FsZVkodmFsKTtcbiAgICAgIHJldHVybiAoXG4gICAgICAgICc8bGluZSB4MT1cIicgK1xuICAgICAgICBwYWRMICtcbiAgICAgICAgJ1wiIHkxPVwiJyArXG4gICAgICAgIHl5ICtcbiAgICAgICAgJ1wiIHgyPVwiJyArXG4gICAgICAgIChXIC0gcGFkUikgK1xuICAgICAgICAnXCIgeTI9XCInICtcbiAgICAgICAgeXkgK1xuICAgICAgICAnXCIgc3Ryb2tlPVwiI2UyZThmMFwiIHN0cm9rZS13aWR0aD1cIjFcIi8+JyArXG4gICAgICAgICc8dGV4dCB4PVwiJyArXG4gICAgICAgIChwYWRMIC0gNikgK1xuICAgICAgICAnXCIgeT1cIicgK1xuICAgICAgICAoeXkgKyA0KSArXG4gICAgICAgICdcIiB0ZXh0LWFuY2hvcj1cImVuZFwiIGZvbnQtc2l6ZT1cIjEwXCIgZmlsbD1cIiM2NDc0OGJcIj4nICtcbiAgICAgICAgX2ZtdE51bSh2YWwpICtcbiAgICAgICAgJzwvdGV4dD4nXG4gICAgICApO1xuICAgIH0pXG4gICAgLmpvaW4oJycpO1xuXG4gIC8vIEVqZSBYIChtZXNlcylcbiAgY29uc3QgeExhYmVscyA9IGZjXG4gICAgLm1hcCgoZiwgaSkgPT4ge1xuICAgICAgY29uc3QgeHggPSBzY2FsZVgoaSk7XG4gICAgICByZXR1cm4gKFxuICAgICAgICAnPHRleHQgeD1cIicgK1xuICAgICAgICB4eCArXG4gICAgICAgICdcIiB5PVwiJyArXG4gICAgICAgIChIIC0gcGFkQiArIDE1KSArXG4gICAgICAgICdcIiB0ZXh0LWFuY2hvcj1cIm1pZGRsZVwiIGZvbnQtc2l6ZT1cIjEwXCIgZmlsbD1cIiM2NDc0OGJcIj4nICtcbiAgICAgICAgX2ZtdERzU2hvcnQoZi5kcykgK1xuICAgICAgICAnPC90ZXh0PidcbiAgICAgICk7XG4gICAgfSlcbiAgICAuam9pbignJyk7XG5cbiAgLy8gSW50ZXJ2YWxvIGNvbmZpYW56YSAoYmFuZClcbiAgY29uc3QgYmFuZFBvaW50cyA9XG4gICAgZmMubWFwKChmLCBpKSA9PiBzY2FsZVgoaSkgKyAnLCcgKyBzY2FsZVkoTnVtYmVyKGYuaGk4MCkgfHwgMCkpLmpvaW4oJyAnKSArXG4gICAgJyAnICtcbiAgICBmY1xuICAgICAgLnNsaWNlKClcbiAgICAgIC5yZXZlcnNlKClcbiAgICAgIC5tYXAoKGYsIGkpID0+IHNjYWxlWChmYy5sZW5ndGggLSAxIC0gaSkgKyAnLCcgKyBzY2FsZVkoTnVtYmVyKGYubG84MCkgfHwgMCkpXG4gICAgICAuam9pbignICcpO1xuICBjb25zdCBiYW5kID0gJzxwb2x5Z29uIHBvaW50cz1cIicgKyBiYW5kUG9pbnRzICsgJ1wiIGZpbGw9XCIjMGQ5NDg4MzNcIiBzdHJva2U9XCJub25lXCIvPic7XG5cbiAgLy8gTGluZSBmb3JlY2FzdCArIHB1bnRvc1xuICBjb25zdCBsaW5lUG9pbnRzID0gZmMubWFwKChmLCBpKSA9PiBzY2FsZVgoaSkgKyAnLCcgKyBzY2FsZVkoTnVtYmVyKGYueV9oYXQpIHx8IDApKS5qb2luKCcgJyk7XG4gIGNvbnN0IGxpbmUgPVxuICAgICc8cG9seWxpbmUgcG9pbnRzPVwiJyArXG4gICAgbGluZVBvaW50cyArXG4gICAgJ1wiIGZpbGw9XCJub25lXCIgc3Ryb2tlPVwiIzBkOTQ4OFwiIHN0cm9rZS13aWR0aD1cIjIuNVwiIHN0cm9rZS1saW5lam9pbj1cInJvdW5kXCIvPic7XG4gIGNvbnN0IHBvaW50cyA9IGZjXG4gICAgLm1hcChcbiAgICAgIChmLCBpKSA9PlxuICAgICAgICAnPGNpcmNsZSBjeD1cIicgK1xuICAgICAgICBzY2FsZVgoaSkgK1xuICAgICAgICAnXCIgY3k9XCInICtcbiAgICAgICAgc2NhbGVZKE51bWJlcihmLnlfaGF0KSB8fCAwKSArXG4gICAgICAgICdcIiByPVwiNFwiIGZpbGw9XCIjMGQ5NDg4XCIgc3Ryb2tlPVwiI2ZmZlwiIHN0cm9rZS13aWR0aD1cIjJcIi8+J1xuICAgIClcbiAgICAuam9pbignJyk7XG4gIC8vIExhYmVscyBkZSB2YWxvclxuICBjb25zdCB2YWx1ZUxhYmVscyA9IGZjXG4gICAgLm1hcCgoZiwgaSkgPT4ge1xuICAgICAgY29uc3QgeHggPSBzY2FsZVgoaSk7XG4gICAgICBjb25zdCB5eSA9IHNjYWxlWShOdW1iZXIoZi55X2hhdCkgfHwgMCk7XG4gICAgICByZXR1cm4gKFxuICAgICAgICAnPHRleHQgeD1cIicgK1xuICAgICAgICB4eCArXG4gICAgICAgICdcIiB5PVwiJyArXG4gICAgICAgICh5eSAtIDgpICtcbiAgICAgICAgJ1wiIHRleHQtYW5jaG9yPVwibWlkZGxlXCIgZm9udC1zaXplPVwiMTBcIiBmb250LXdlaWdodD1cIjcwMFwiIGZpbGw9XCIjMGY3NjZlXCI+JyArXG4gICAgICAgIF9mbXROdW0oZi55X2hhdCkgK1xuICAgICAgICAnPC90ZXh0PidcbiAgICAgICk7XG4gICAgfSlcbiAgICAuam9pbignJyk7XG5cbiAgY29uc3Qgc3ZnID1cbiAgICAnPHN2ZyB2aWV3Qm94PVwiMCAwICcgK1xuICAgIFcgK1xuICAgICcgJyArXG4gICAgSCArXG4gICAgJ1wiIHN0eWxlPVwid2lkdGg6MTAwJTttYXgtd2lkdGg6ODAwcHg7aGVpZ2h0OmF1dG9cIj4nICtcbiAgICAnPHJlY3QgeD1cIjBcIiB5PVwiMFwiIHdpZHRoPVwiJyArXG4gICAgVyArXG4gICAgJ1wiIGhlaWdodD1cIicgK1xuICAgIEggK1xuICAgICdcIiBmaWxsPVwiI2ZmZlwiLz4nICtcbiAgICB5VGlja3MgK1xuICAgIHhMYWJlbHMgK1xuICAgIGJhbmQgK1xuICAgIGxpbmUgK1xuICAgIHBvaW50cyArXG4gICAgdmFsdWVMYWJlbHMgK1xuICAgICc8L3N2Zz4nO1xuICByZXR1cm4gc3ZnO1xufVxuXG53aW5kb3cub3BlbkZvcmVjYXN0U3RhdERldGFpbCA9IGZ1bmN0aW9uIChzdWJJZCkge1xuICBpZiAoIV9mb3JlY2FzdFN0YXREb2NzKSByZXR1cm47XG4gIGNvbnN0IGRvYyA9IF9mb3JlY2FzdFN0YXREb2NzLmZpbmQoKGQpID0+IGQuaWQgPT09IHN1YklkKTtcbiAgaWYgKCFkb2MpIHtcbiAgICBhbGVydCgnTm8gc2UgZW5jb250clx1MDBGMyBkZXRhbGxlIGRlICcgKyBzdWJJZCk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGNvbnN0IGV4aXN0aW5nID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2ZvcmVjYXN0LXN0YXQtZGV0YWlsJyk7XG4gIGlmIChleGlzdGluZykgZXhpc3RpbmcucmVtb3ZlKCk7XG5cbiAgY29uc3QgZWwgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKTtcbiAgZWwuaWQgPSAnZm9yZWNhc3Qtc3RhdC1kZXRhaWwnO1xuICBlbC5zdHlsZS5jc3NUZXh0ID1cbiAgICAncG9zaXRpb246Zml4ZWQ7aW5zZXQ6MDtiYWNrZ3JvdW5kOnJnYmEoMTUsMjMsNDIsLjY1KTt6LWluZGV4OjIxMDA7ZGlzcGxheTpmbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtqdXN0aWZ5LWNvbnRlbnQ6Y2VudGVyO3BhZGRpbmc6MnZoJztcbiAgZWwub25jbGljayA9IChldikgPT4ge1xuICAgIGlmIChldi50YXJnZXQgPT09IGVsKSBlbC5yZW1vdmUoKTtcbiAgfTtcblxuICBjb25zdCB3YXBlID0gZG9jLm1ldHJpY3MgJiYgZG9jLm1ldHJpY3Mud2FwZTtcbiAgY29uc3QgYmlhcyA9IGRvYy5tZXRyaWNzICYmIGRvYy5tZXRyaWNzLmJpYXM7XG4gIGNvbnN0IG1hZSA9IGRvYy5tZXRyaWNzICYmIGRvYy5tZXRyaWNzLm1hZTtcbiAgY29uc3Qgcm1zZSA9IGRvYy5tZXRyaWNzICYmIGRvYy5tZXRyaWNzLnJtc2U7XG4gIGNvbnN0IGJlc3RNb2RlbCA9IGRvYy5iZXN0TW9kZWwgfHwgJ1x1MjAxNCc7XG4gIGNvbnN0IHZlcnNpb25JZCA9IGRvYy52ZXJzaW9uSWQgfHwgJ1x1MjAxNCc7XG4gIGNvbnN0IHN2Z0h0bWwgPSBfYnVpbGRGb3JlY2FzdENoYXJ0U3ZnKGRvYyk7XG5cbiAgY29uc3QgbWV0cmljc0h0bWwgPVxuICAgICc8ZGl2IHN0eWxlPVwiZGlzcGxheTpncmlkO2dyaWQtdGVtcGxhdGUtY29sdW1uczpyZXBlYXQoYXV0by1maXQsbWlubWF4KDEyMHB4LDFmcikpO2dhcDoxMHB4O21hcmdpbjoxNHB4IDBcIj4nICtcbiAgICAnPGRpdiBzdHlsZT1cInBhZGRpbmc6MTBweDtiYWNrZ3JvdW5kOnZhcigtLWJnLXNlY29uZGFyeSk7Ym9yZGVyLXJhZGl1czo2cHhcIj48ZGl2IHN0eWxlPVwiZm9udC1zaXplOjEwcHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlXCI+TW9kZWxvPC9kaXY+PGRpdiBzdHlsZT1cImZvbnQtd2VpZ2h0OjcwMFwiPicgK1xuICAgIGVzY2FwZUh0bWxTYWZlKGJlc3RNb2RlbCkgK1xuICAgICc8L2Rpdj48L2Rpdj4nICtcbiAgICAnPGRpdiBzdHlsZT1cInBhZGRpbmc6MTBweDtiYWNrZ3JvdW5kOnZhcigtLWJnLXNlY29uZGFyeSk7Ym9yZGVyLXJhZGl1czo2cHhcIj48ZGl2IHN0eWxlPVwiZm9udC1zaXplOjEwcHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlXCI+V0FQRTwvZGl2PjxkaXYgc3R5bGU9XCJmb250LXdlaWdodDo3MDA7Y29sb3I6JyArXG4gICAgX3dhcGVCYWRnZUNvbG9yKHdhcGUpICtcbiAgICAnXCI+JyArXG4gICAgX2ZtdFdhcGUod2FwZSkgK1xuICAgICc8L2Rpdj48L2Rpdj4nICtcbiAgICAnPGRpdiBzdHlsZT1cInBhZGRpbmc6MTBweDtiYWNrZ3JvdW5kOnZhcigtLWJnLXNlY29uZGFyeSk7Ym9yZGVyLXJhZGl1czo2cHhcIj48ZGl2IHN0eWxlPVwiZm9udC1zaXplOjEwcHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlXCI+QmlhczwvZGl2PjxkaXYgc3R5bGU9XCJmb250LXdlaWdodDo3MDBcIj4nICtcbiAgICAoYmlhcyAhPSBudWxsID8gKGJpYXMgKiAxMDApLnRvRml4ZWQoMCkgKyAnJScgOiAnXHUyMDE0JykgK1xuICAgICc8L2Rpdj48L2Rpdj4nICtcbiAgICAnPGRpdiBzdHlsZT1cInBhZGRpbmc6MTBweDtiYWNrZ3JvdW5kOnZhcigtLWJnLXNlY29uZGFyeSk7Ym9yZGVyLXJhZGl1czo2cHhcIj48ZGl2IHN0eWxlPVwiZm9udC1zaXplOjEwcHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlXCI+TUFFPC9kaXY+PGRpdiBzdHlsZT1cImZvbnQtd2VpZ2h0OjcwMFwiPicgK1xuICAgIF9mbXROdW0obWFlKSArXG4gICAgJzwvZGl2PjwvZGl2PicgK1xuICAgICc8ZGl2IHN0eWxlPVwicGFkZGluZzoxMHB4O2JhY2tncm91bmQ6dmFyKC0tYmctc2Vjb25kYXJ5KTtib3JkZXItcmFkaXVzOjZweFwiPjxkaXYgc3R5bGU9XCJmb250LXNpemU6MTBweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2VcIj5STVNFPC9kaXY+PGRpdiBzdHlsZT1cImZvbnQtd2VpZ2h0OjcwMFwiPicgK1xuICAgIF9mbXROdW0ocm1zZSkgK1xuICAgICc8L2Rpdj48L2Rpdj4nICtcbiAgICAnPC9kaXY+JztcblxuICBjb25zdCB0YWJsZUh0bWwgPVxuICAgICc8dGFibGUgc3R5bGU9XCJ3aWR0aDoxMDAlO2ZvbnQtc2l6ZToxMnB4O2JvcmRlci1jb2xsYXBzZTpjb2xsYXBzZTttYXJnaW4tdG9wOjEwcHhcIj4nICtcbiAgICAnPHRoZWFkIHN0eWxlPVwiYmFja2dyb3VuZDojMGYxNzJhO2NvbG9yOiNmZmZcIj48dHI+JyArXG4gICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6NnB4IDEwcHg7dGV4dC1hbGlnbjpsZWZ0XCI+TWVzPC90aD4nICtcbiAgICAnPHRoIHN0eWxlPVwicGFkZGluZzo2cHggMTBweDt0ZXh0LWFsaWduOnJpZ2h0XCI+Rm9yZWNhc3Q8L3RoPicgK1xuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjZweCAxMHB4O3RleHQtYWxpZ246cmlnaHRcIj5JQyA4MCUgYmFqbzwvdGg+JyArXG4gICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6NnB4IDEwcHg7dGV4dC1hbGlnbjpyaWdodFwiPklDIDgwJSBhbHRvPC90aD4nICtcbiAgICAnPC90cj48L3RoZWFkPjx0Ym9keT4nICtcbiAgICAoZG9jLmZvcmVjYXN0IHx8IFtdKVxuICAgICAgLm1hcChcbiAgICAgICAgKGYpID0+XG4gICAgICAgICAgJzx0ciBzdHlsZT1cImJvcmRlci1ib3R0b206MXB4IHNvbGlkIHZhcigtLWJvcmRlci1zdWJ0bGUpXCI+PHRkIHN0eWxlPVwicGFkZGluZzo2cHggMTBweFwiPicgK1xuICAgICAgICAgIGVzY2FwZUh0bWxTYWZlKF9mbXREc1Nob3J0KGYuZHMpKSArXG4gICAgICAgICAgJzwvdGQ+JyArXG4gICAgICAgICAgJzx0ZCBzdHlsZT1cInBhZGRpbmc6NnB4IDEwcHg7dGV4dC1hbGlnbjpyaWdodDtmb250LXdlaWdodDo3MDBcIj4nICtcbiAgICAgICAgICBfZm10TnVtKGYueV9oYXQpICtcbiAgICAgICAgICAnPC90ZD4nICtcbiAgICAgICAgICAnPHRkIHN0eWxlPVwicGFkZGluZzo2cHggMTBweDt0ZXh0LWFsaWduOnJpZ2h0O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpXCI+JyArXG4gICAgICAgICAgX2ZtdE51bShmLmxvODApICtcbiAgICAgICAgICAnPC90ZD4nICtcbiAgICAgICAgICAnPHRkIHN0eWxlPVwicGFkZGluZzo2cHggMTBweDt0ZXh0LWFsaWduOnJpZ2h0O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpXCI+JyArXG4gICAgICAgICAgX2ZtdE51bShmLmhpODApICtcbiAgICAgICAgICAnPC90ZD48L3RyPidcbiAgICAgIClcbiAgICAgIC5qb2luKCcnKSArXG4gICAgJzwvdGJvZHk+PC90YWJsZT4nO1xuXG4gIGNvbnN0IGNvbnRlbnQgPVxuICAgICc8ZGl2IHN0eWxlPVwiYmFja2dyb3VuZDp2YXIoLS1iZy1lbGV2YXRlZCk7Ym9yZGVyLXJhZGl1czoxMnB4O3BhZGRpbmc6MjRweDttYXgtd2lkdGg6ODIwcHg7d2lkdGg6MTAwJTttYXgtaGVpZ2h0Ojk2dmg7b3ZlcmZsb3c6YXV0bztib3gtc2hhZG93OjAgMjBweCA2MHB4IHJnYmEoMCwwLDAsLjQpXCI+JyArXG4gICAgJzxkaXYgc3R5bGU9XCJkaXNwbGF5OmZsZXg7anVzdGlmeS1jb250ZW50OnNwYWNlLWJldHdlZW47YWxpZ24taXRlbXM6Y2VudGVyO21hcmdpbi1ib3R0b206MTBweFwiPicgK1xuICAgICc8ZGl2PjxkaXYgc3R5bGU9XCJmb250LXNpemU6MTFweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7bGV0dGVyLXNwYWNpbmc6LjRweFwiPlN1YmZhbWlsaWE8L2Rpdj48ZGl2IHN0eWxlPVwiZm9udC1zaXplOjIycHg7Zm9udC13ZWlnaHQ6ODAwXCI+JyArXG4gICAgZXNjYXBlSHRtbFNhZmUoZG9jLnN1YmZhbWlsaWEgfHwgZG9jLmlkKSArXG4gICAgJzwvZGl2PjwvZGl2PicgK1xuICAgICc8YnV0dG9uIG9uY2xpY2s9XCJkb2N1bWVudC5nZXRFbGVtZW50QnlJZChcXCdmb3JlY2FzdC1zdGF0LWRldGFpbFxcJykucmVtb3ZlKClcIiBzdHlsZT1cImJhY2tncm91bmQ6dHJhbnNwYXJlbnQ7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1ib3JkZXItc3VidGxlKTtib3JkZXItcmFkaXVzOjZweDtwYWRkaW5nOjZweCAxMnB4O2N1cnNvcjpwb2ludGVyO2ZvbnQtd2VpZ2h0OjcwMFwiPkNlcnJhcjwvYnV0dG9uPicgK1xuICAgICc8L2Rpdj4nICtcbiAgICBtZXRyaWNzSHRtbCArXG4gICAgJzxkaXYgc3R5bGU9XCJiYWNrZ3JvdW5kOiNmZmY7cGFkZGluZzo4cHg7Ym9yZGVyLXJhZGl1czo4cHg7bWFyZ2luLXRvcDoxMHB4O2JvcmRlcjoxcHggc29saWQgdmFyKC0tYm9yZGVyLXN1YnRsZSlcIj4nICtcbiAgICBzdmdIdG1sICtcbiAgICAnPC9kaXY+JyArXG4gICAgdGFibGVIdG1sICtcbiAgICAnPGRpdiBzdHlsZT1cIm1hcmdpbi10b3A6MTRweDtmb250LXNpemU6MTFweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKVwiPlZlcnNpb246IDxjb2RlPicgK1xuICAgIGVzY2FwZUh0bWxTYWZlKHZlcnNpb25JZCkgK1xuICAgICc8L2NvZGU+IFx1MDBCNyBBcHByb2FjaDogJyArXG4gICAgZXNjYXBlSHRtbFNhZmUoKGRvYy5jb25maWcgfHwge30pLmFwcHJvYWNoIHx8ICdcdTIwMTQnKSArXG4gICAgJzwvZGl2PicgK1xuICAgICc8L2Rpdj4nO1xuICBlbC5pbm5lckhUTUwgPSBjb250ZW50O1xuICBkb2N1bWVudC5ib2R5LmFwcGVuZENoaWxkKGVsKTtcbn07XG5cbndpbmRvdy5vcGVuRm9yZWNhc3RNb2RhbCA9IGFzeW5jIGZ1bmN0aW9uICgpIHtcbiAgaWYgKCFfY2FuRm9yZWNhc3QoKSkge1xuICAgIGFsZXJ0KCdGT1JFQ0FTVCBlcyBzb2xvIHBhcmEgTWFyaWFubyAoYWRtaW4pLicpO1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCBlbCA9IF9yZW5kZXJNb2RhbFNoZWxsKCk7XG4gIGVsLnN0eWxlLmRpc3BsYXkgPSAnYmxvY2snO1xuICAvLyBGYXNlIDE6IGNhcmdhciBTYWxlcyBQbGFucyBjYWNoZXMgKyByZW5kZXJpemFyIHRhYiBkZWZhdWx0LlxuICBfcmVuZGVyU2FsZXNQbGFuc1RhYigpO1xuICBfbG9hZFNhbGVzUGxhbkNhY2hlcygpXG4gICAgLnRoZW4oX3JlbmRlclNhbGVzUGxhbnNUYWIpXG4gICAgLmNhdGNoKCgpID0+IHt9KTtcbn07XG5cbndpbmRvdy5jbG9zZUZvcmVjYXN0TW9kYWwgPSBmdW5jdGlvbiAoKSB7XG4gIGNvbnN0IGVsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2ZvcmVjYXN0LW1vZGFsJyk7XG4gIGlmIChlbCkgZWwuc3R5bGUuZGlzcGxheSA9ICdub25lJztcbn07XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gRjNBIFx1MjAxNCBUYWJsYSBSZWNvbWVuZGFjaVx1MDBGM24gZGUgQ29tcHJhICh0YWIgU2FsZXMgUGxhbnMpXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuYXN5bmMgZnVuY3Rpb24gX2xvYWREaXNjb250aW51ZWRTa3VzKCkge1xuICBpZiAoIXdpbmRvdy5mYkRiKSByZXR1cm47XG4gIHRyeSB7XG4gICAgY29uc3QgZG9jID0gYXdhaXQgd2luZG93LmZiRGIuY29sbGVjdGlvbignZm9yZWNhc3RfY29uZmlnJykuZG9jKCdkaXNjb250aW51ZWRfc2t1cycpLmdldCgpO1xuICAgIGlmIChkb2MuZXhpc3RzKSB7XG4gICAgICBjb25zdCBkID0gZG9jLmRhdGEoKSB8fCB7fTtcbiAgICAgIGNvbnN0IGFyciA9IEFycmF5LmlzQXJyYXkoZC5za3VzKSA/IGQuc2t1cyA6IFtdO1xuICAgICAgX2Rpc2NvbnRpbnVlZFNrdXMgPSBuZXcgU2V0KGFyci5tYXAoKHMpID0+IFN0cmluZyhzKS50cmltKCkudG9VcHBlckNhc2UoKSkpO1xuICAgICAgX2Rpc2NvbnRpbnVlZE1ldGEgPSB7IHVwZGF0ZWRBdDogZC51cGRhdGVkQXQsIHVwZGF0ZWRCeTogZC51cGRhdGVkQnkgfTtcbiAgICB9IGVsc2Uge1xuICAgICAgX2Rpc2NvbnRpbnVlZFNrdXMgPSBuZXcgU2V0KCk7XG4gICAgICBfZGlzY29udGludWVkTWV0YSA9IG51bGw7XG4gICAgfVxuICB9IGNhdGNoIChlKSB7XG4gICAgY29uc29sZS53YXJuKCdbRk9SRUNBU1QgcmVjb10gbG9hZCBkaXNjb250aW51ZWQgZmFpbDonLCBlICYmIGUubWVzc2FnZSk7XG4gICAgX2Rpc2NvbnRpbnVlZFNrdXMgPSBuZXcgU2V0KCk7XG4gIH1cbn1cblxuYXN5bmMgZnVuY3Rpb24gX3NhdmVEaXNjb250aW51ZWRTa3VzKCkge1xuICBpZiAoIXdpbmRvdy5mYkRiIHx8ICFfZGlzY29udGludWVkU2t1cykgcmV0dXJuO1xuICBjb25zdCB1aWQgPSAod2luZG93LmN1cnJlbnRVc2VyICYmIHdpbmRvdy5jdXJyZW50VXNlci5lbWFpbCkgfHwgJ3Vua25vd24nO1xuICBjb25zdCBwYXlsb2FkID0ge1xuICAgIHNrdXM6IEFycmF5LmZyb20oX2Rpc2NvbnRpbnVlZFNrdXMpLnNvcnQoKSxcbiAgICB1cGRhdGVkQXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICB1cGRhdGVkQnk6IHVpZCxcbiAgfTtcbiAgYXdhaXQgd2luZG93LmZiRGIuY29sbGVjdGlvbignZm9yZWNhc3RfY29uZmlnJykuZG9jKCdkaXNjb250aW51ZWRfc2t1cycpLnNldChwYXlsb2FkKTtcbiAgX2Rpc2NvbnRpbnVlZE1ldGEgPSB7IHVwZGF0ZWRBdDogcGF5bG9hZC51cGRhdGVkQXQsIHVwZGF0ZWRCeTogcGF5bG9hZC51cGRhdGVkQnkgfTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gX2xvYWRSZWNvRGF0YSgpIHtcbiAgaWYgKCF3aW5kb3cuZmJEYikgdGhyb3cgbmV3IEVycm9yKCdGaXJlc3RvcmUgbm8gaW5pY2lhbGl6YWRvJyk7XG4gIGNvbnN0IHByb21pc2VzID0gW107XG4gIGlmICghX2Rpc2NvbnRpbnVlZFNrdXMpIHByb21pc2VzLnB1c2goX2xvYWREaXNjb250aW51ZWRTa3VzKCkpO1xuICBpZiAoIV9yZWNvU3RvY2tTbmFwc2hvdCkge1xuICAgIHByb21pc2VzLnB1c2goXG4gICAgICB3aW5kb3cuZmJEYlxuICAgICAgICAuY29sbGVjdGlvbignYXBwX2NvbmZpZycpXG4gICAgICAgIC5kb2MoJ3N0b2NrX3NuYXBzaG90JylcbiAgICAgICAgLmdldCgpXG4gICAgICAgIC50aGVuKChkKSA9PiB7XG4gICAgICAgICAgY29uc3QgZGF0YSA9IGQuZXhpc3RzID8gZC5kYXRhKCkgOiB7fTtcbiAgICAgICAgICBsZXQgd2ggPSB7fTtcbiAgICAgICAgICBsZXQgYm8gPSB7fTtcbiAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgd2ggPSBkYXRhLndhcmVob3VzZUJyZWFrZG93biA/IEpTT04ucGFyc2UoZGF0YS53YXJlaG91c2VCcmVha2Rvd24pIDoge307XG4gICAgICAgICAgfSBjYXRjaCB7XG4gICAgICAgICAgICB3aCA9IHt9O1xuICAgICAgICAgIH1cbiAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgYm8gPSBkYXRhLmJhY2tvcmRlckJ5U2t1ID8gSlNPTi5wYXJzZShkYXRhLmJhY2tvcmRlckJ5U2t1KSA6IHt9O1xuICAgICAgICAgIH0gY2F0Y2gge1xuICAgICAgICAgICAgYm8gPSB7fTtcbiAgICAgICAgICB9XG4gICAgICAgICAgX3JlY29TdG9ja1NuYXBzaG90ID0geyB3YXJlaG91c2VCcmVha2Rvd246IHdoLCBiYWNrb3JkZXJCeVNrdTogYm8gfTtcbiAgICAgICAgfSlcbiAgICApO1xuICB9XG4gIGlmICghX3JlY29WZW50YXNTbmFwc2hvdCkge1xuICAgIHByb21pc2VzLnB1c2goXG4gICAgICB3aW5kb3cuZmJEYlxuICAgICAgICAuY29sbGVjdGlvbignc2t1X3ZlbnRhc19zbmFwc2hvdCcpXG4gICAgICAgIC5nZXQoKVxuICAgICAgICAudGhlbigoc25hcCkgPT4ge1xuICAgICAgICAgIGNvbnN0IG1hcCA9IHt9O1xuICAgICAgICAgIHNuYXAuZm9yRWFjaCgoZG9jKSA9PiB7XG4gICAgICAgICAgICBjb25zdCBkID0gZG9jLmRhdGEoKTtcbiAgICAgICAgICAgIGlmICghZCB8fCAhZC5za3UpIHJldHVybjtcbiAgICAgICAgICAgIG1hcFtTdHJpbmcoZC5za3UpLnRyaW0oKS50b1VwcGVyQ2FzZSgpXSA9IHsgbWVzZXM6IGQubWVzZXMgfHwge30gfTtcbiAgICAgICAgICB9KTtcbiAgICAgICAgICBfcmVjb1ZlbnRhc1NuYXBzaG90ID0gbWFwO1xuICAgICAgICB9KVxuICAgICk7XG4gIH1cbiAgYXdhaXQgUHJvbWlzZS5hbGwocHJvbWlzZXMpO1xufVxuXG5mdW5jdGlvbiBfY29tcHV0ZVZlbnRhTWVuc3VhbFByb21lZGlvKHNrdVVwcGVyKSB7XG4gIC8vIFByb21lZGlvIGRlIGxvcyBcdTAwRkFsdGltb3MgUkVDT19WRU5UQV9QUk9NRURJT19XSU5ET1cgbWVzZXMgY2VycmFkb3NcbiAgLy8gKGV4Y2x1eWUgZWwgbWVzIGFjdHVhbCBwYXJjaWFsKS5cbiAgY29uc3QgcmVjID0gX3JlY29WZW50YXNTbmFwc2hvdCAmJiBfcmVjb1ZlbnRhc1NuYXBzaG90W3NrdVVwcGVyXTtcbiAgaWYgKCFyZWMgfHwgIXJlYy5tZXNlcykgcmV0dXJuIDA7XG4gIGNvbnN0IGhveSA9IG5ldyBEYXRlKCk7XG4gIGNvbnN0IG1vbnRoc0JhY2sgPSBbXTtcbiAgZm9yIChsZXQgaSA9IDE7IGkgPD0gUkVDT19WRU5UQV9QUk9NRURJT19XSU5ET1c7IGkrKykge1xuICAgIGNvbnN0IGQgPSBuZXcgRGF0ZShob3kuZ2V0RnVsbFllYXIoKSwgaG95LmdldE1vbnRoKCkgLSBpLCAxKTtcbiAgICBtb250aHNCYWNrLnB1c2goU3RyaW5nKGQuZ2V0RnVsbFllYXIoKSkgKyAnLScgKyBTdHJpbmcoZC5nZXRNb250aCgpICsgMSkucGFkU3RhcnQoMiwgJzAnKSk7XG4gIH1cbiAgbGV0IHN1bSA9IDA7XG4gIGxldCBuID0gMDtcbiAgbW9udGhzQmFjay5mb3JFYWNoKChrKSA9PiB7XG4gICAgY29uc3QgbSA9IHJlYy5tZXNlc1trXTtcbiAgICBpZiAobSAmJiBOdW1iZXIuaXNGaW5pdGUoTnVtYmVyKG0ucXR5KSkpIHtcbiAgICAgIHN1bSArPSBOdW1iZXIobS5xdHkpO1xuICAgICAgbisrO1xuICAgIH1cbiAgfSk7XG4gIHJldHVybiBuID4gMCA/IHN1bSAvIG4gOiAwO1xufVxuXG5mdW5jdGlvbiBfY29tcHV0ZVNhbGVzUGxhbkZ1dHVybyhyb3cpIHtcbiAgLy8gU3VtYSBsb3MgbWVzZXMgZGUgcm93Lm1vbnRocyBkZXNkZSBlbCBtZXMgYWN0dWFsIChpbmNsdXNpdmUpIGhhc3RhIGVsXG4gIC8vIFx1MDBGQWx0aW1vIG1lcyBkZWwgc2FsZXMgcGxhbi4gTG9zIG1lc2VzIHNvbiAnWVlZWS1NTScuXG4gIGlmICghcm93IHx8ICFyb3cubW9udGhzKSByZXR1cm4gMDtcbiAgY29uc3QgaG95ID0gbmV3IERhdGUoKTtcbiAgY29uc3QgY3VycmVudEtleSA9IFN0cmluZyhob3kuZ2V0RnVsbFllYXIoKSkgKyAnLScgKyBTdHJpbmcoaG95LmdldE1vbnRoKCkgKyAxKS5wYWRTdGFydCgyLCAnMCcpO1xuICBsZXQgc3VtID0gMDtcbiAgT2JqZWN0LmtleXMocm93Lm1vbnRocykuZm9yRWFjaCgoaykgPT4ge1xuICAgIGlmIChrID49IGN1cnJlbnRLZXkpIHN1bSArPSBOdW1iZXIocm93Lm1vbnRoc1trXSB8fCAwKTtcbiAgfSk7XG4gIHJldHVybiBzdW07XG59XG5cbmZ1bmN0aW9uIF9jb21wdXRlUmVjb21tZW5kYXRpb25zKCkge1xuICAvLyBDb21iaW5hIFJvZHMgKyBSZWVscyBzYWxlcyBwbGFucyArIHN0b2NrICsgYmFja29yZGVyICsgdmVudGFzIHByb21lZGlvLlxuICAvLyBSZXRvcm5hIGFycmF5IGRlIHJvd3MgY29uIHRvZG9zIGxvcyBjYW1wb3MgKyByZWNvbWVuZGFkby5cbiAgY29uc3Qgcm93cyA9IFtdO1xuICBjb25zdCBmYW1pbGlhcyA9IFsncm9kcycsICdyZWVscyddO1xuICBmb3IgKGNvbnN0IGZhbSBvZiBmYW1pbGlhcykge1xuICAgIGNvbnN0IGNhY2hlID0gX3NhbGVzUGxhbkNhY2hlc1tmYW1dO1xuICAgIGlmICghY2FjaGUgfHwgIWNhY2hlLnJvd3MpIGNvbnRpbnVlO1xuICAgIGZvciAoY29uc3Qgc3BSb3cgb2YgY2FjaGUucm93cykge1xuICAgICAgY29uc3Qgc2t1ID0gU3RyaW5nKHNwUm93LnNrdSB8fCAnJykudHJpbSgpO1xuICAgICAgY29uc3Qgc2t1VXBwZXIgPSBza3UudG9VcHBlckNhc2UoKTtcbiAgICAgIC8vIHYxMTEyOiBza2lwZWFtb3MgU0tVcyBkZXNjb250aW51YWRvcyAoTWFyaWFubyBsb3MgbWFyY2EgZGVzZGUgbGEgVUkpLlxuICAgICAgaWYgKF9kaXNjb250aW51ZWRTa3VzICYmIF9kaXNjb250aW51ZWRTa3VzLmhhcyhza3VVcHBlcikpIGNvbnRpbnVlO1xuICAgICAgY29uc3Qgc3RvY2tXaCA9XG4gICAgICAgIChfcmVjb1N0b2NrU25hcHNob3QgJiZcbiAgICAgICAgICBfcmVjb1N0b2NrU25hcHNob3Qud2FyZWhvdXNlQnJlYWtkb3duICYmXG4gICAgICAgICAgX3JlY29TdG9ja1NuYXBzaG90LndhcmVob3VzZUJyZWFrZG93bltza3VdKSB8fFxuICAgICAgICB7fTtcbiAgICAgIGNvbnN0IHN0b2NrTGlicmUgPSBOdW1iZXIoc3RvY2tXaFsnMTEnXSB8fCAwKTtcbiAgICAgIGNvbnN0IGVuVHJhbnNpdG8gPSBOdW1iZXIoc3RvY2tXaFsnMTInXSB8fCAwKTtcbiAgICAgIGNvbnN0IGJhY2tvcmRlciA9IE51bWJlcihcbiAgICAgICAgKF9yZWNvU3RvY2tTbmFwc2hvdCAmJlxuICAgICAgICAgIF9yZWNvU3RvY2tTbmFwc2hvdC5iYWNrb3JkZXJCeVNrdSAmJlxuICAgICAgICAgIF9yZWNvU3RvY2tTbmFwc2hvdC5iYWNrb3JkZXJCeVNrdVtza3VdKSB8fFxuICAgICAgICAgIDBcbiAgICAgICk7XG4gICAgICBjb25zdCB2ZW50YU1lbnN1YWwgPSBfY29tcHV0ZVZlbnRhTWVuc3VhbFByb21lZGlvKHNrdVVwcGVyKTtcbiAgICAgIGNvbnN0IHNhbGVzUGxhbkZ1dCA9IF9jb21wdXRlU2FsZXNQbGFuRnV0dXJvKHNwUm93KTtcbiAgICAgIGNvbnN0IG1vcSA9IE51bWJlcihzcFJvdy5tb3EgfHwgMCk7XG4gICAgICBjb25zdCBtdWx0aXBsaWVyID0gUkVDT19ERUZBVUxUX01VTFRJUExJRVI7IC8vIHYxMTA5OiBmaWpvIDEuMDsgRjNCIGxvIGhhY2UgZWRpdGFibGUgcG9yIHN1YmZhbWlsaWFcbiAgICAgIGNvbnN0IGRlbWFuZGFFc3BlcmFkYSA9IHZlbnRhTWVuc3VhbCAqIG11bHRpcGxpZXIgKiBSRUNPX0hPUklaT05fTU9OVEhTO1xuICAgICAgY29uc3QgYmFsYW5jZSA9IHN0b2NrTGlicmUgKyBlblRyYW5zaXRvICsgc2FsZXNQbGFuRnV0IC0gYmFja29yZGVyIC0gZGVtYW5kYUVzcGVyYWRhO1xuICAgICAgbGV0IHJlY29tZW5kYWRvID0gMDtcbiAgICAgIGlmIChiYWxhbmNlIDwgMCkge1xuICAgICAgICBjb25zdCBkZWZpY2l0ID0gLWJhbGFuY2U7XG4gICAgICAgIHJlY29tZW5kYWRvID0gbW9xID4gMCA/IE1hdGgubWF4KG1vcSwgTWF0aC5jZWlsKGRlZmljaXQgLyBtb3EpICogbW9xKSA6IE1hdGguY2VpbChkZWZpY2l0KTtcbiAgICAgIH1cbiAgICAgIHJvd3MucHVzaCh7XG4gICAgICAgIGZhbWlsaWE6IGZhbSxcbiAgICAgICAgc2t1LFxuICAgICAgICBkZXNjcmlwdGlvbjogc3BSb3cuZGVzY3JpcHRpb24gfHwgJycsXG4gICAgICAgIG1vcSxcbiAgICAgICAgc3RvY2tMaWJyZSxcbiAgICAgICAgZW5UcmFuc2l0byxcbiAgICAgICAgYmFja29yZGVyLFxuICAgICAgICB2ZW50YU1lbnN1YWw6IE1hdGgucm91bmQodmVudGFNZW5zdWFsICogMTApIC8gMTAsXG4gICAgICAgIHNhbGVzUGxhbkZ1dCxcbiAgICAgICAgbXVsdGlwbGllcixcbiAgICAgICAgZGVtYW5kYUVzcGVyYWRhOiBNYXRoLnJvdW5kKGRlbWFuZGFFc3BlcmFkYSAqIDEwKSAvIDEwLFxuICAgICAgICBiYWxhbmNlOiBNYXRoLnJvdW5kKGJhbGFuY2UgKiAxMCkgLyAxMCxcbiAgICAgICAgcmVjb21lbmRhZG8sXG4gICAgICB9KTtcbiAgICB9XG4gIH1cbiAgLy8gT3JkZW5hciBwb3IgcmVjb21lbmRhZG8gZGVzY2VuZGVudGVcbiAgcm93cy5zb3J0KChhLCBiKSA9PiBiLnJlY29tZW5kYWRvIC0gYS5yZWNvbWVuZGFkbyk7XG4gIHJldHVybiByb3dzO1xufVxuXG5mdW5jdGlvbiBfZm10TnVtU2lnbmVkKG4pIHtcbiAgaWYgKG4gPT0gbnVsbCB8fCAhTnVtYmVyLmlzRmluaXRlKE51bWJlcihuKSkpIHJldHVybiAnXHUyMDE0JztcbiAgY29uc3QgdiA9IE51bWJlcihuKTtcbiAgY29uc3QgYWJzID0gTWF0aC5hYnModikudG9Mb2NhbGVTdHJpbmcoJ2VzLUFSJywgeyBtYXhpbXVtRnJhY3Rpb25EaWdpdHM6IDAgfSk7XG4gIHJldHVybiAodiA8IDAgPyAnXHUyMjEyJyA6ICcnKSArIGFicztcbn1cblxuZnVuY3Rpb24gX2ZtdEludChuKSB7XG4gIGlmIChuID09IG51bGwgfHwgIU51bWJlci5pc0Zpbml0ZShOdW1iZXIobikpKSByZXR1cm4gJ1x1MjAxNCc7XG4gIHJldHVybiBNYXRoLnJvdW5kKE51bWJlcihuKSkudG9Mb2NhbGVTdHJpbmcoJ2VzLUFSJyk7XG59XG5cbmZ1bmN0aW9uIF9yZW5kZXJSZWNvU2VjdGlvbigpIHtcbiAgY29uc3QgY29udCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdyZWNvLXNlY3Rpb24tY29udGFpbmVyJyk7XG4gIGlmICghY29udCkgcmV0dXJuO1xuICB0cnkge1xuICAgIF9yZW5kZXJSZWNvU2VjdGlvbkltcGwoY29udCk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBjb25zb2xlLmVycm9yKCdbRk9SRUNBU1QgcmVjb10gcmVuZGVyIGZhaWwnLCBlKTtcbiAgICBjb250LmlubmVySFRNTCA9XG4gICAgICAnPGRpdiBzdHlsZT1cInBhZGRpbmc6MjBweDtjb2xvcjojZGMyNjI2XCI+JyArXG4gICAgICAnPGRpdiBzdHlsZT1cImZvbnQtd2VpZ2h0OjcwMDttYXJnaW4tYm90dG9tOjhweFwiPkVycm9yIHJlbmRlcml6YW5kbyB0YWJsYSByZWNvbWVuZGFjaVx1MDBGM248L2Rpdj4nICtcbiAgICAgICc8cHJlIHN0eWxlPVwiZm9udC1zaXplOjExcHg7YmFja2dyb3VuZDojZmVmMmYyO3BhZGRpbmc6MTBweDtib3JkZXItcmFkaXVzOjZweDtvdmVyZmxvdzphdXRvO3doaXRlLXNwYWNlOnByZS13cmFwXCI+JyArXG4gICAgICBlc2NhcGVIdG1sU2FmZShlLnN0YWNrIHx8IGUubWVzc2FnZSB8fCBTdHJpbmcoZSkpICtcbiAgICAgICc8L3ByZT48L2Rpdj4nO1xuICB9XG59XG5cbmZ1bmN0aW9uIF9yZW5kZXJSZWNvU2VjdGlvbkltcGwoY29udCkge1xuICBjb25zdCBhbnlMb2FkZWQgPSAhIShfc2FsZXNQbGFuQ2FjaGVzLnJvZHMgfHwgX3NhbGVzUGxhbkNhY2hlcy5yZWVscyk7XG4gIGlmICghYW55TG9hZGVkKSB7XG4gICAgY29udC5pbm5lckhUTUwgPSAnJztcbiAgICByZXR1cm47XG4gIH1cbiAgaWYgKCFfcmVjb1N0b2NrU25hcHNob3QgfHwgIV9yZWNvVmVudGFzU25hcHNob3QpIHtcbiAgICBjb250LmlubmVySFRNTCA9XG4gICAgICAnPGRpdiBzdHlsZT1cInBhZGRpbmc6NDBweCAxOHB4O3RleHQtYWxpZ246Y2VudGVyO2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpXCI+JyArXG4gICAgICAnPGRpdiBzdHlsZT1cImRpc3BsYXk6aW5saW5lLWJsb2NrO3dpZHRoOjI0cHg7aGVpZ2h0OjI0cHg7Ym9yZGVyOjNweCBzb2xpZCAjMGQ5NDg4O2JvcmRlci10b3AtY29sb3I6dHJhbnNwYXJlbnQ7Ym9yZGVyLXJhZGl1czo1MCU7YW5pbWF0aW9uOnNwaW4gMC44cyBsaW5lYXIgaW5maW5pdGU7bWFyZ2luLWJvdHRvbToxMHB4XCI+PC9kaXY+JyArXG4gICAgICAnPGRpdj5DYXJnYW5kbyBzdG9jayArIHZlbnRhcyBoaXN0XHUwMEYzcmljYXMuLi48L2Rpdj4nICtcbiAgICAgICc8c3R5bGU+QGtleWZyYW1lcyBzcGlue3Rve3RyYW5zZm9ybTpyb3RhdGUoMzYwZGVnKX19PC9zdHlsZT48L2Rpdj4nO1xuICAgIF9sb2FkUmVjb0RhdGEoKVxuICAgICAgLnRoZW4oX3JlbmRlclJlY29TZWN0aW9uKVxuICAgICAgLmNhdGNoKChlKSA9PiB7XG4gICAgICAgIGNvbnNvbGUuZXJyb3IoJ1tGT1JFQ0FTVCByZWNvXSBsb2FkIGZhaWwnLCBlKTtcbiAgICAgICAgY29udC5pbm5lckhUTUwgPVxuICAgICAgICAgICc8ZGl2IHN0eWxlPVwicGFkZGluZzoyMHB4O2NvbG9yOiNkYzI2MjZcIj5FcnJvciBjYXJnYW5kbyBkYXRvczogJyArXG4gICAgICAgICAgZXNjYXBlSHRtbFNhZmUoZS5tZXNzYWdlIHx8IFN0cmluZyhlKSkgK1xuICAgICAgICAgICc8L2Rpdj4nO1xuICAgICAgfSk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGNvbnN0IGFsbFJvd3MgPSBfY29tcHV0ZVJlY29tbWVuZGF0aW9ucygpO1xuICBjb25zdCBzZWFyY2hMYyA9IF9yZWNvU2VhcmNoVGV4dC50cmltKCkudG9Mb3dlckNhc2UoKTtcbiAgY29uc3Qgcm93cyA9IGFsbFJvd3MuZmlsdGVyKChyKSA9PiB7XG4gICAgaWYgKF9yZWNvRmlsdGVyRmFtaWxpYSAhPT0gJ2FsbCcgJiYgci5mYW1pbGlhICE9PSBfcmVjb0ZpbHRlckZhbWlsaWEpIHJldHVybiBmYWxzZTtcbiAgICBpZiAoX3JlY29GaWx0ZXJNaW5SZWMgJiYgci5yZWNvbWVuZGFkbyA8PSAwKSByZXR1cm4gZmFsc2U7XG4gICAgaWYgKHNlYXJjaExjKSB7XG4gICAgICBjb25zdCBoYXkgPVxuICAgICAgICByLnNrdS50b0xvd2VyQ2FzZSgpLmluY2x1ZGVzKHNlYXJjaExjKSB8fCByLmRlc2NyaXB0aW9uLnRvTG93ZXJDYXNlKCkuaW5jbHVkZXMoc2VhcmNoTGMpO1xuICAgICAgaWYgKCFoYXkpIHJldHVybiBmYWxzZTtcbiAgICB9XG4gICAgcmV0dXJuIHRydWU7XG4gIH0pO1xuICBjb25zdCB0b3RhbFJlY28gPSBhbGxSb3dzLnJlZHVjZSgocywgcikgPT4gcyArIHIucmVjb21lbmRhZG8sIDApO1xuICBjb25zdCB0b3RhbENvblJlY28gPSBhbGxSb3dzLmZpbHRlcigocikgPT4gci5yZWNvbWVuZGFkbyA+IDApLmxlbmd0aDtcblxuICBjb25zdCBuRGlzYyA9IF9kaXNjb250aW51ZWRTa3VzID8gX2Rpc2NvbnRpbnVlZFNrdXMuc2l6ZSA6IDA7XG4gIGNvbnN0IGRpc2NDaGlwID1cbiAgICBuRGlzYyA+IDBcbiAgICAgID8gJzxidXR0b24gb25jbGljaz1cIm9wZW5EaXNjb250aW51ZWRNb2RhbCgpXCIgc3R5bGU9XCJwYWRkaW5nOjZweCAxMnB4O2JhY2tncm91bmQ6IzkzMzNlYTtjb2xvcjojZmZmO2JvcmRlcjpub25lO2JvcmRlci1yYWRpdXM6NnB4O2ZvbnQtc2l6ZToxMnB4O2ZvbnQtd2VpZ2h0OjcwMDtjdXJzb3I6cG9pbnRlclwiIHRpdGxlPVwiR2VzdGlvbmFyIFNLVXMgZGVzY29udGludWFkb3NcIj5cdUQ4M0RcdURFQUIgJyArXG4gICAgICAgIF9mbXRJbnQobkRpc2MpICtcbiAgICAgICAgJyBkZXNjb250aW51YWRvczwvYnV0dG9uPidcbiAgICAgIDogJyc7XG5cbiAgY29uc3QgaGVhZGVyID1cbiAgICAnPGRpdiBzdHlsZT1cImRpc3BsYXk6ZmxleDtmbGV4LXdyYXA6d3JhcDtnYXA6MTBweDthbGlnbi1pdGVtczpjZW50ZXI7bWFyZ2luLWJvdHRvbToxMnB4XCI+JyArXG4gICAgJzxkaXYgc3R5bGU9XCJmbGV4OjE7bWluLXdpZHRoOjI4MHB4XCI+PGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxOHB4O2ZvbnQtd2VpZ2h0OjgwMDtjb2xvcjp2YXIoLS10ZXh0LXByaW1hcnkpXCI+UmVjb21lbmRhY2lcdTAwRjNuIGRlIENvbXByYTwvZGl2PicgK1xuICAgICc8ZGl2IHN0eWxlPVwiZm9udC1zaXplOjExcHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7bWFyZ2luLXRvcDoycHhcIj5CYWxhbmNlID0gU3RvY2sgKyBUclx1MDBFMW5zaXRvICsgUGxhbiBcdTIyMTIgQmFja29yZGVyIFx1MjIxMiAoVmVudGEgbWVucy4gXHUwMEQ3ICcgK1xuICAgIFJFQ09fSE9SSVpPTl9NT05USFMgK1xuICAgICdtKTwvZGl2PjwvZGl2PicgK1xuICAgICc8ZGl2IHN0eWxlPVwicGFkZGluZzo2cHggMTJweDtiYWNrZ3JvdW5kOiMwZDk0ODg7Y29sb3I6I2ZmZjtib3JkZXItcmFkaXVzOjZweDtmb250LXNpemU6MTJweDtmb250LXdlaWdodDo3MDBcIj4nICtcbiAgICBfZm10SW50KHRvdGFsQ29uUmVjbykgK1xuICAgICcgU0tVcyBjb24gcmVjbzwvZGl2PicgK1xuICAgICc8ZGl2IHN0eWxlPVwicGFkZGluZzo2cHggMTJweDtiYWNrZ3JvdW5kOiMxMzRlNGE7Y29sb3I6I2ZmZjtib3JkZXItcmFkaXVzOjZweDtmb250LXNpemU6MTJweDtmb250LXdlaWdodDo3MDBcIj5cdTAzQTMgJyArXG4gICAgX2ZtdEludCh0b3RhbFJlY28pICtcbiAgICAnIHVuaWRhZGVzPC9kaXY+JyArXG4gICAgZGlzY0NoaXAgK1xuICAgICc8L2Rpdj4nO1xuXG4gIGNvbnN0IGZpbHRlcnMgPVxuICAgICc8ZGl2IHN0eWxlPVwiZGlzcGxheTpmbGV4O2ZsZXgtd3JhcDp3cmFwO2dhcDo4cHg7bWFyZ2luLWJvdHRvbToxMHB4O3BhZGRpbmc6MTBweDtiYWNrZ3JvdW5kOnZhcigtLWJnLXNlY29uZGFyeSk7Ym9yZGVyLXJhZGl1czo2cHhcIj4nICtcbiAgICAnPGlucHV0IHR5cGU9XCJ0ZXh0XCIgaWQ9XCJyZWNvLXNlYXJjaFwiIHBsYWNlaG9sZGVyPVwiQnVzY2FyIFNLVSBvIGRlc2NyaXBjaW9uLi4uXCIgdmFsdWU9XCInICtcbiAgICBlc2NhcGVIdG1sU2FmZShfcmVjb1NlYXJjaFRleHQpICtcbiAgICAnXCIgb25pbnB1dD1cIm9uUmVjb1NlYXJjaENoYW5nZShldmVudClcIiBzdHlsZT1cImZsZXg6MTttaW4td2lkdGg6MjAwcHg7cGFkZGluZzo2cHggMTBweDtib3JkZXI6MXB4IHNvbGlkIHZhcigtLWJvcmRlci1zdWJ0bGUpO2JvcmRlci1yYWRpdXM6NHB4O2ZvbnQtc2l6ZToxMnB4O2JhY2tncm91bmQ6dmFyKC0tYmctZWxldmF0ZWQpO2NvbG9yOnZhcigtLXRleHQtcHJpbWFyeSlcIi8+JyArXG4gICAgJzxzZWxlY3Qgb25jaGFuZ2U9XCJvblJlY29GYW1pbGlhQ2hhbmdlKGV2ZW50KVwiIHN0eWxlPVwicGFkZGluZzo2cHggMTBweDtib3JkZXI6MXB4IHNvbGlkIHZhcigtLWJvcmRlci1zdWJ0bGUpO2JvcmRlci1yYWRpdXM6NHB4O2ZvbnQtc2l6ZToxMnB4O2JhY2tncm91bmQ6dmFyKC0tYmctZWxldmF0ZWQpO2NvbG9yOnZhcigtLXRleHQtcHJpbWFyeSlcIj4nICtcbiAgICAnPG9wdGlvbiB2YWx1ZT1cImFsbFwiJyArXG4gICAgKF9yZWNvRmlsdGVyRmFtaWxpYSA9PT0gJ2FsbCcgPyAnIHNlbGVjdGVkJyA6ICcnKSArXG4gICAgJz5Ub2RhcyBsYXMgZmFtaWxpYXM8L29wdGlvbj4nICtcbiAgICAnPG9wdGlvbiB2YWx1ZT1cInJvZHNcIicgK1xuICAgIChfcmVjb0ZpbHRlckZhbWlsaWEgPT09ICdyb2RzJyA/ICcgc2VsZWN0ZWQnIDogJycpICtcbiAgICAnPlNvbG8gUm9kcyAoQ2FcdTAwRjFhcyk8L29wdGlvbj4nICtcbiAgICAnPG9wdGlvbiB2YWx1ZT1cInJlZWxzXCInICtcbiAgICAoX3JlY29GaWx0ZXJGYW1pbGlhID09PSAncmVlbHMnID8gJyBzZWxlY3RlZCcgOiAnJykgK1xuICAgICc+U29sbyBSZWVsczwvb3B0aW9uPicgK1xuICAgICc8L3NlbGVjdD4nICtcbiAgICAnPGxhYmVsIHN0eWxlPVwiZGlzcGxheTppbmxpbmUtZmxleDthbGlnbi1pdGVtczpjZW50ZXI7Z2FwOjZweDtwYWRkaW5nOjZweCAxMHB4O2ZvbnQtc2l6ZToxMnB4O2NvbG9yOnZhcigtLXRleHQtcHJpbWFyeSk7Y3Vyc29yOnBvaW50ZXJcIj4nICtcbiAgICAnPGlucHV0IHR5cGU9XCJjaGVja2JveFwiJyArXG4gICAgKF9yZWNvRmlsdGVyTWluUmVjID8gJyBjaGVja2VkJyA6ICcnKSArXG4gICAgJyBvbmNoYW5nZT1cIm9uUmVjb0ZpbHRlck1pbkNoYW5nZShldmVudClcIi8+JyArXG4gICAgJ1NvbG8gY29uIHJlY29tZW5kYWRvICZndDsgMDwvbGFiZWw+JyArXG4gICAgJzxidXR0b24gb25jbGljaz1cImV4cG9ydFJlY29FeGNlbCgpXCIgc3R5bGU9XCJwYWRkaW5nOjZweCAxMnB4O2JhY2tncm91bmQ6IzE2YTM0YTtjb2xvcjojZmZmO2JvcmRlcjpub25lO2JvcmRlci1yYWRpdXM6NHB4O2ZvbnQtc2l6ZToxMnB4O2ZvbnQtd2VpZ2h0OjcwMDtjdXJzb3I6cG9pbnRlclwiPlx1MkIwNyBFeGNlbDwvYnV0dG9uPicgK1xuICAgICc8L2Rpdj4nO1xuXG4gIGNvbnN0IHJvd3NIdG1sID0gcm93c1xuICAgIC5tYXAoKHIpID0+IHtcbiAgICAgIGNvbnN0IGJhbENvbG9yID0gci5iYWxhbmNlIDwgMCA/ICcjZGMyNjI2JyA6IHIuYmFsYW5jZSA8IDUwID8gJyNmNTllMGInIDogJyMxNmEzNGEnO1xuICAgICAgY29uc3QgcmVjQ29sb3IgPSByLnJlY29tZW5kYWRvID4gMCA/ICcjZGMyNjI2JyA6ICcjOTRhM2I4JztcbiAgICAgIHJldHVybiAoXG4gICAgICAgICc8dHIgc3R5bGU9XCJib3JkZXItYm90dG9tOjFweCBzb2xpZCB2YXIoLS1ib3JkZXItc3VidGxlKVwiPicgK1xuICAgICAgICAnPHRkIHN0eWxlPVwicGFkZGluZzo2cHggOHB4O3RleHQtYWxpZ246Y2VudGVyXCI+PHNwYW4gc3R5bGU9XCJkaXNwbGF5OmlubGluZS1ibG9jaztwYWRkaW5nOjJweCA2cHg7Ym9yZGVyLXJhZGl1czoxMHB4O2JhY2tncm91bmQ6JyArXG4gICAgICAgIChyLmZhbWlsaWEgPT09ICdyb2RzJyA/ICcjMGVhNWU5JyA6ICcjOGI1Y2Y2JykgK1xuICAgICAgICAnO2NvbG9yOiNmZmY7Zm9udC1zaXplOjEwcHg7Zm9udC13ZWlnaHQ6NzAwXCI+JyArXG4gICAgICAgIChyLmZhbWlsaWEgPT09ICdyb2RzJyA/ICdST0QnIDogJ1JFRUwnKSArXG4gICAgICAgICc8L3NwYW4+PC90ZD4nICtcbiAgICAgICAgJzx0ZCBzdHlsZT1cInBhZGRpbmc6NnB4IDhweDt0ZXh0LWFsaWduOmNlbnRlcjtmb250LWZhbWlseTptb25vc3BhY2U7Zm9udC1zaXplOjExcHg7Y29sb3I6dmFyKC0tdGV4dC1wcmltYXJ5KTtmb250LXdlaWdodDo3MDBcIj4nICtcbiAgICAgICAgZXNjYXBlSHRtbFNhZmUoci5za3UpICtcbiAgICAgICAgJzwvdGQ+JyArXG4gICAgICAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjZweCA4cHg7Zm9udC1zaXplOjExcHg7Y29sb3I6dmFyKC0tdGV4dC1zZWNvbmRhcnkpO21heC13aWR0aDoyNDBweDtvdmVyZmxvdzpoaWRkZW47dGV4dC1vdmVyZmxvdzplbGxpcHNpczt3aGl0ZS1zcGFjZTpub3dyYXBcIiB0aXRsZT1cIicgK1xuICAgICAgICBlc2NhcGVIdG1sU2FmZShyLmRlc2NyaXB0aW9uKSArXG4gICAgICAgICdcIj4nICtcbiAgICAgICAgZXNjYXBlSHRtbFNhZmUoci5kZXNjcmlwdGlvbikgK1xuICAgICAgICAnPC90ZD4nICtcbiAgICAgICAgJzx0ZCBzdHlsZT1cInBhZGRpbmc6NnB4IDhweDt0ZXh0LWFsaWduOmNlbnRlcjtmb250LXZhcmlhbnQtbnVtZXJpYzp0YWJ1bGFyLW51bXM7Y29sb3I6dmFyKC0tdGV4dC1wcmltYXJ5KVwiPicgK1xuICAgICAgICBfZm10SW50KHIuc3RvY2tMaWJyZSkgK1xuICAgICAgICAnPC90ZD4nICtcbiAgICAgICAgJzx0ZCBzdHlsZT1cInBhZGRpbmc6NnB4IDhweDt0ZXh0LWFsaWduOmNlbnRlcjtmb250LXZhcmlhbnQtbnVtZXJpYzp0YWJ1bGFyLW51bXM7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZClcIj4nICtcbiAgICAgICAgX2ZtdEludChyLmVuVHJhbnNpdG8pICtcbiAgICAgICAgJzwvdGQ+JyArXG4gICAgICAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjZweCA4cHg7dGV4dC1hbGlnbjpjZW50ZXI7Zm9udC12YXJpYW50LW51bWVyaWM6dGFidWxhci1udW1zO2NvbG9yOiNkYzI2MjZcIj4nICtcbiAgICAgICAgX2ZtdEludChyLmJhY2tvcmRlcikgK1xuICAgICAgICAnPC90ZD4nICtcbiAgICAgICAgJzx0ZCBzdHlsZT1cInBhZGRpbmc6NnB4IDhweDt0ZXh0LWFsaWduOmNlbnRlcjtmb250LXZhcmlhbnQtbnVtZXJpYzp0YWJ1bGFyLW51bXM7Y29sb3I6dmFyKC0tdGV4dC1zZWNvbmRhcnkpXCI+JyArXG4gICAgICAgIF9mbXRJbnQoci52ZW50YU1lbnN1YWwpICtcbiAgICAgICAgJzwvdGQ+JyArXG4gICAgICAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjZweCA4cHg7dGV4dC1hbGlnbjpjZW50ZXI7Zm9udC12YXJpYW50LW51bWVyaWM6dGFidWxhci1udW1zO2NvbG9yOnZhcigtLXRleHQtc2Vjb25kYXJ5KVwiPicgK1xuICAgICAgICBfZm10SW50KHIuZGVtYW5kYUVzcGVyYWRhKSArXG4gICAgICAgICc8L3RkPicgK1xuICAgICAgICAnPHRkIHN0eWxlPVwicGFkZGluZzo2cHggOHB4O3RleHQtYWxpZ246Y2VudGVyO2ZvbnQtdmFyaWFudC1udW1lcmljOnRhYnVsYXItbnVtcztjb2xvcjp2YXIoLS10ZXh0LXByaW1hcnkpO2ZvbnQtd2VpZ2h0OjYwMFwiPicgK1xuICAgICAgICBfZm10SW50KHIuc2FsZXNQbGFuRnV0KSArXG4gICAgICAgICc8L3RkPicgK1xuICAgICAgICAnPHRkIHN0eWxlPVwicGFkZGluZzo2cHggOHB4O3RleHQtYWxpZ246Y2VudGVyO2ZvbnQtdmFyaWFudC1udW1lcmljOnRhYnVsYXItbnVtcztmb250LXdlaWdodDo3MDA7Y29sb3I6JyArXG4gICAgICAgIGJhbENvbG9yICtcbiAgICAgICAgJ1wiPicgK1xuICAgICAgICBfZm10TnVtU2lnbmVkKHIuYmFsYW5jZSkgK1xuICAgICAgICAnPC90ZD4nICtcbiAgICAgICAgJzx0ZCBzdHlsZT1cInBhZGRpbmc6NnB4IDhweDt0ZXh0LWFsaWduOmNlbnRlcjtmb250LXZhcmlhbnQtbnVtZXJpYzp0YWJ1bGFyLW51bXM7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7Zm9udC1zaXplOjExcHhcIj4nICtcbiAgICAgICAgX2ZtdEludChyLm1vcSkgK1xuICAgICAgICAnPC90ZD4nICtcbiAgICAgICAgJzx0ZCBzdHlsZT1cInBhZGRpbmc6NnB4IDhweDt0ZXh0LWFsaWduOmNlbnRlclwiPjxzcGFuIHN0eWxlPVwiZGlzcGxheTppbmxpbmUtYmxvY2s7cGFkZGluZzo0cHggMTBweDtib3JkZXItcmFkaXVzOjEycHg7YmFja2dyb3VuZDonICtcbiAgICAgICAgcmVjQ29sb3IgK1xuICAgICAgICAnO2NvbG9yOiNmZmY7Zm9udC1zaXplOjEycHg7Zm9udC13ZWlnaHQ6ODAwO21pbi13aWR0aDo1MHB4XCI+JyArXG4gICAgICAgIF9mbXRJbnQoci5yZWNvbWVuZGFkbykgK1xuICAgICAgICAnPC9zcGFuPjwvdGQ+JyArXG4gICAgICAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjZweCA4cHg7dGV4dC1hbGlnbjpjZW50ZXJcIj4nICtcbiAgICAgICAgJzxidXR0b24gb25jbGljaz1cImRpc2NvbnRpbnVlU2t1KFxcJycgK1xuICAgICAgICBlc2NhcGVIdG1sU2FmZShyLnNrdSkgK1xuICAgICAgICBcIicsICdcIiArXG4gICAgICAgIGVzY2FwZUh0bWxTYWZlKHIuZGVzY3JpcHRpb24ucmVwbGFjZSgvJy9nLCAnJykpICtcbiAgICAgICAgJ1xcJylcIiB0aXRsZT1cIkRlc2NvbnRpbnVhciBlc3RlIFNLVVwiIHN0eWxlPVwiYmFja2dyb3VuZDp0cmFuc3BhcmVudDtib3JkZXI6MXB4IHNvbGlkIHZhcigtLWJvcmRlci1zdWJ0bGUpO2JvcmRlci1yYWRpdXM6NHB4O3BhZGRpbmc6NHB4IDhweDtjdXJzb3I6cG9pbnRlcjtmb250LXNpemU6MTRweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKVwiPlx1RDgzRFx1REREMTwvYnV0dG9uPicgK1xuICAgICAgICAnPC90ZD4nICtcbiAgICAgICAgJzwvdHI+J1xuICAgICAgKTtcbiAgICB9KVxuICAgIC5qb2luKCcnKTtcblxuICBjb25zdCB0YWJsZSA9XG4gICAgJzxkaXYgc3R5bGU9XCJvdmVyZmxvdzphdXRvO21heC1oZWlnaHQ6NjB2aDtib3JkZXI6MXB4IHNvbGlkIHZhcigtLWJvcmRlci1zdWJ0bGUpO2JvcmRlci1yYWRpdXM6OHB4XCI+JyArXG4gICAgJzx0YWJsZSBzdHlsZT1cIndpZHRoOjEwMCU7Ym9yZGVyLWNvbGxhcHNlOmNvbGxhcHNlO2ZvbnQtc2l6ZToxMnB4XCI+JyArXG4gICAgJzx0aGVhZCBzdHlsZT1cImJhY2tncm91bmQ6IzBmMTcyYTtjb2xvcjojZmZmO3Bvc2l0aW9uOnN0aWNreTt0b3A6MDt6LWluZGV4OjFcIj48dHI+JyArXG4gICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6OHB4O3RleHQtYWxpZ246Y2VudGVyO2ZvbnQtc2l6ZToxMHB4O3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZVwiPkZhbTwvdGg+JyArXG4gICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6OHB4O3RleHQtYWxpZ246Y2VudGVyO2ZvbnQtc2l6ZToxMHB4O3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZVwiPlNLVTwvdGg+JyArXG4gICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6OHB4O3RleHQtYWxpZ246Y2VudGVyO2ZvbnQtc2l6ZToxMHB4O3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZVwiPkRlc2NyaXBjaVx1MDBGM248L3RoPicgK1xuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjhweDt0ZXh0LWFsaWduOmNlbnRlcjtmb250LXNpemU6MTBweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2VcIiB0aXRsZT1cIldocyAxMSBkaXNwb25pYmxlIHZlbnRhXCI+U3RvY2s8L3RoPicgK1xuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjhweDt0ZXh0LWFsaWduOmNlbnRlcjtmb250LXNpemU6MTBweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2VcIiB0aXRsZT1cIldocyAxMlwiPlRyXHUwMEUxbnNpdG88L3RoPicgK1xuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjhweDt0ZXh0LWFsaWduOmNlbnRlcjtmb250LXNpemU6MTBweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2VcIj5CYWNrb3JkZXI8L3RoPicgK1xuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjhweDt0ZXh0LWFsaWduOmNlbnRlcjtmb250LXNpemU6MTBweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2VcIiB0aXRsZT1cIlByb21lZGlvIFx1MDBGQWx0aW1vcyAzIG1lc2VzXCI+VnRhL21lczwvdGg+JyArXG4gICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6OHB4O3RleHQtYWxpZ246Y2VudGVyO2ZvbnQtc2l6ZToxMHB4O3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZVwiIHRpdGxlPVwiVnRhL21lcyBcdTAwRDcgNyBtZXNlc1wiPkRlbWFuZGEgZXNwLjwvdGg+JyArXG4gICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6OHB4O3RleHQtYWxpZ246Y2VudGVyO2ZvbnQtc2l6ZToxMHB4O3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZVwiIHRpdGxlPVwiU3VtYSBjb2x1bW5hcyBTYWxlcyBQbGFuIGRlc2RlIG1lcyBhY3R1YWxcIj5QbGFuIGZ1dHVybzwvdGg+JyArXG4gICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6OHB4O3RleHQtYWxpZ246Y2VudGVyO2ZvbnQtc2l6ZToxMHB4O3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZVwiPkJhbGFuY2U8L3RoPicgK1xuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjhweDt0ZXh0LWFsaWduOmNlbnRlcjtmb250LXNpemU6MTBweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2VcIj5NT1E8L3RoPicgK1xuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjhweDt0ZXh0LWFsaWduOmNlbnRlcjtmb250LXNpemU6MTBweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7YmFja2dyb3VuZDojMTM0ZTRhXCI+UmVjb21lbmRhZG88L3RoPicgK1xuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjhweDt0ZXh0LWFsaWduOmNlbnRlcjtmb250LXNpemU6MTBweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2VcIiB0aXRsZT1cIkRlc2NvbnRpbnVhciBTS1VcIj5BY2NpXHUwMEYzbjwvdGg+JyArXG4gICAgJzwvdHI+PC90aGVhZD48dGJvZHk+JyArXG4gICAgKHJvd3MubGVuZ3RoXG4gICAgICA/IHJvd3NIdG1sXG4gICAgICA6ICc8dHI+PHRkIGNvbHNwYW49XCIxM1wiIHN0eWxlPVwicGFkZGluZzo0MHB4O3RleHQtYWxpZ246Y2VudGVyO2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpXCI+U2luIHJlc3VsdGFkb3MgY29uIGxvcyBmaWx0cm9zIGFjdHVhbGVzPC90ZD48L3RyPicpICtcbiAgICAnPC90Ym9keT48L3RhYmxlPjwvZGl2Pic7XG5cbiAgY29uc3QgZm9vdGVyID1cbiAgICAnPGRpdiBzdHlsZT1cIm1hcmdpbi10b3A6OHB4O2ZvbnQtc2l6ZToxMHB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpXCI+JyArXG4gICAgJ01vc3RyYW5kbyAnICtcbiAgICBfZm10SW50KHJvd3MubGVuZ3RoKSArXG4gICAgJyBkZSAnICtcbiAgICBfZm10SW50KGFsbFJvd3MubGVuZ3RoKSArXG4gICAgJyBTS1VzIFx1MDBCNyAnICtcbiAgICAnQmFsYW5jZSA9IFN0b2NrICsgVHJcdTAwRTFuc2l0byArIFBsYW4gXHUyMjEyIEJhY2tvcmRlciBcdTIyMTIgRGVtYW5kYS4gUm9qbyA9IHF1aWVicmUgZXNwZXJhZG8uIFJlY29tZW5kYWRvIHNlIHJlZG9uZGVhIGFsIG1cdTAwRkFsdGlwbG8gZGUgTU9RIHN1cGVyaW9yLicgK1xuICAgICc8L2Rpdj4nO1xuXG4gIGNvbnQuaW5uZXJIVE1MID1cbiAgICAnPGRpdiBzdHlsZT1cInBhZGRpbmc6MThweCAxOHB4IDMwcHhcIj4nICsgaGVhZGVyICsgZmlsdGVycyArIHRhYmxlICsgZm9vdGVyICsgJzwvZGl2Pic7XG59XG5cbndpbmRvdy5vblJlY29TZWFyY2hDaGFuZ2UgPSBmdW5jdGlvbiAoZXYpIHtcbiAgX3JlY29TZWFyY2hUZXh0ID0gZXYudGFyZ2V0LnZhbHVlIHx8ICcnO1xuICBfcmVuZGVyUmVjb1NlY3Rpb24oKTtcbiAgLy8gUmVzdGF1cmFyIGZvY3VzICsgY2FyZXQgYWwgaW5wdXRcbiAgc2V0VGltZW91dCgoKSA9PiB7XG4gICAgY29uc3QgaW5wID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3JlY28tc2VhcmNoJyk7XG4gICAgaWYgKGlucCkge1xuICAgICAgaW5wLmZvY3VzKCk7XG4gICAgICBpbnAuc2V0U2VsZWN0aW9uUmFuZ2UoaW5wLnZhbHVlLmxlbmd0aCwgaW5wLnZhbHVlLmxlbmd0aCk7XG4gICAgfVxuICB9LCAwKTtcbn07XG5cbndpbmRvdy5vblJlY29GYW1pbGlhQ2hhbmdlID0gZnVuY3Rpb24gKGV2KSB7XG4gIF9yZWNvRmlsdGVyRmFtaWxpYSA9IGV2LnRhcmdldC52YWx1ZSB8fCAnYWxsJztcbiAgX3JlbmRlclJlY29TZWN0aW9uKCk7XG59O1xuXG53aW5kb3cub25SZWNvRmlsdGVyTWluQ2hhbmdlID0gZnVuY3Rpb24gKGV2KSB7XG4gIF9yZWNvRmlsdGVyTWluUmVjID0gISFldi50YXJnZXQuY2hlY2tlZDtcbiAgX3JlbmRlclJlY29TZWN0aW9uKCk7XG59O1xuXG53aW5kb3cuZXhwb3J0UmVjb0V4Y2VsID0gZnVuY3Rpb24gKCkge1xuICBpZiAodHlwZW9mIFhMU1ggPT09ICd1bmRlZmluZWQnKSB7XG4gICAgYWxlcnQoJ1NoZWV0SlMgKFhMU1gpIG5vIGNhcmdhZG8nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgY29uc3Qgcm93cyA9IF9jb21wdXRlUmVjb21tZW5kYXRpb25zKCk7XG4gIGNvbnN0IGFvYSA9IFtcbiAgICBbXG4gICAgICAnRmFtaWxpYScsXG4gICAgICAnU0tVJyxcbiAgICAgICdEZXNjcmlwY2lcdTAwRjNuJyxcbiAgICAgICdTdG9jaycsXG4gICAgICAnVHJcdTAwRTFuc2l0bycsXG4gICAgICAnQmFja29yZGVyJyxcbiAgICAgICdWdGEgcHJvbS9tZXMnLFxuICAgICAgJ0RlbWFuZGEgZXNwLiA3bScsXG4gICAgICAnU2FsZXMgUGxhbiBmdXR1cm8nLFxuICAgICAgJ0JhbGFuY2UnLFxuICAgICAgJ01PUScsXG4gICAgICAnUmVjb21lbmRhZG8nLFxuICAgIF0sXG4gIF07XG4gIGZvciAoY29uc3QgciBvZiByb3dzKSB7XG4gICAgYW9hLnB1c2goW1xuICAgICAgci5mYW1pbGlhID09PSAncm9kcycgPyAnUm9kcyAoQ2FcdTAwRjFhcyknIDogJ1JlZWxzJyxcbiAgICAgIHIuc2t1LFxuICAgICAgci5kZXNjcmlwdGlvbixcbiAgICAgIHIuc3RvY2tMaWJyZSxcbiAgICAgIHIuZW5UcmFuc2l0byxcbiAgICAgIHIuYmFja29yZGVyLFxuICAgICAgci52ZW50YU1lbnN1YWwsXG4gICAgICByLmRlbWFuZGFFc3BlcmFkYSxcbiAgICAgIHIuc2FsZXNQbGFuRnV0LFxuICAgICAgci5iYWxhbmNlLFxuICAgICAgci5tb3EsXG4gICAgICByLnJlY29tZW5kYWRvLFxuICAgIF0pO1xuICB9XG4gIGNvbnN0IHdzID0gWExTWC51dGlscy5hb2FfdG9fc2hlZXQoYW9hKTtcbiAgd3NbJyFjb2xzJ10gPSBbXG4gICAgeyB3Y2g6IDE0IH0sXG4gICAgeyB3Y2g6IDE4IH0sXG4gICAgeyB3Y2g6IDQwIH0sXG4gICAgeyB3Y2g6IDggfSxcbiAgICB7IHdjaDogMTAgfSxcbiAgICB7IHdjaDogMTEgfSxcbiAgICB7IHdjaDogMTIgfSxcbiAgICB7IHdjaDogMTUgfSxcbiAgICB7IHdjaDogMTYgfSxcbiAgICB7IHdjaDogMTAgfSxcbiAgICB7IHdjaDogOCB9LFxuICAgIHsgd2NoOiAxMiB9LFxuICBdO1xuICBjb25zdCB3YiA9IFhMU1gudXRpbHMuYm9va19uZXcoKTtcbiAgWExTWC51dGlscy5ib29rX2FwcGVuZF9zaGVldCh3Yiwgd3MsICdSZWNvbWVuZGFjaVx1MDBGM24nKTtcbiAgY29uc3QgaG95ID0gbmV3IERhdGUoKTtcbiAgY29uc3Qgc3RhbXAgPVxuICAgIGhveS5nZXRGdWxsWWVhcigpICtcbiAgICAnLScgK1xuICAgIFN0cmluZyhob3kuZ2V0TW9udGgoKSArIDEpLnBhZFN0YXJ0KDIsICcwJykgK1xuICAgICctJyArXG4gICAgU3RyaW5nKGhveS5nZXREYXRlKCkpLnBhZFN0YXJ0KDIsICcwJyk7XG4gIFhMU1gud3JpdGVGaWxlKHdiLCAnUmVjb21lbmRhY2lvbl9Db21wcmFfJyArIHN0YW1wICsgJy54bHN4Jyk7XG59O1xuXG4vLyB2MTExMiBGM0I6IGRlc2NvbnRpbnVhciAvIHJlYWN0aXZhciBTS1VzLlxud2luZG93LmRpc2NvbnRpbnVlU2t1ID0gYXN5bmMgZnVuY3Rpb24gKHNrdSwgZGVzY3JpcHRpb24pIHtcbiAgaWYgKCFfZGlzY29udGludWVkU2t1cykgX2Rpc2NvbnRpbnVlZFNrdXMgPSBuZXcgU2V0KCk7XG4gIGNvbnN0IHVwcGVyID0gU3RyaW5nKHNrdSkudHJpbSgpLnRvVXBwZXJDYXNlKCk7XG4gIGNvbnN0IGxhYmVsID0gZGVzY3JpcHRpb24gPyBza3UgKyAnIFx1MjAxNCAnICsgZGVzY3JpcHRpb24uc2xpY2UoMCwgNjApIDogc2t1O1xuICBpZiAoXG4gICAgIWNvbmZpcm0oXG4gICAgICAnRGVzY29udGludWFyICcgK1xuICAgICAgICBsYWJlbCArXG4gICAgICAgICc/XFxuXFxuUXVlZGFyXHUwMEUxIGV4Y2x1aWRvIGRlbCBjXHUwMEUxbGN1bG8gZGUgcmVjb21lbmRhY2lcdTAwRjNuIGRlIGNvbXByYSBoYXN0YSBxdWUgbG8gcmVhY3RpdmVzIGRlc2RlIGVsIGNoaXAgXCJEZXNjb250aW51YWRvc1wiLidcbiAgICApXG4gICkge1xuICAgIHJldHVybjtcbiAgfVxuICBfZGlzY29udGludWVkU2t1cy5hZGQodXBwZXIpO1xuICB0cnkge1xuICAgIGF3YWl0IF9zYXZlRGlzY29udGludWVkU2t1cygpO1xuICAgIF9yZW5kZXJSZWNvU2VjdGlvbigpO1xuICB9IGNhdGNoIChlKSB7XG4gICAgX2Rpc2NvbnRpbnVlZFNrdXMuZGVsZXRlKHVwcGVyKTtcbiAgICBhbGVydCgnRXJyb3IgZ3VhcmRhbmRvOiAnICsgKGUubWVzc2FnZSB8fCBlKSk7XG4gIH1cbn07XG5cbndpbmRvdy5yZWFjdGl2YXRlU2t1ID0gYXN5bmMgZnVuY3Rpb24gKHNrdSkge1xuICBpZiAoIV9kaXNjb250aW51ZWRTa3VzKSByZXR1cm47XG4gIGNvbnN0IHVwcGVyID0gU3RyaW5nKHNrdSkudHJpbSgpLnRvVXBwZXJDYXNlKCk7XG4gIF9kaXNjb250aW51ZWRTa3VzLmRlbGV0ZSh1cHBlcik7XG4gIHRyeSB7XG4gICAgYXdhaXQgX3NhdmVEaXNjb250aW51ZWRTa3VzKCk7XG4gICAgX3JlbmRlckRpc2NvbnRpbnVlZE1vZGFsKCk7XG4gICAgX3JlbmRlclJlY29TZWN0aW9uKCk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBfZGlzY29udGludWVkU2t1cy5hZGQodXBwZXIpO1xuICAgIGFsZXJ0KCdFcnJvciBndWFyZGFuZG86ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcbiAgfVxufTtcblxud2luZG93Lm9wZW5EaXNjb250aW51ZWRNb2RhbCA9IGZ1bmN0aW9uICgpIHtcbiAgY29uc3QgZXhpc3RpbmcgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZGlzY29udGludWVkLXNrdXMtbW9kYWwnKTtcbiAgaWYgKGV4aXN0aW5nKSBleGlzdGluZy5yZW1vdmUoKTtcbiAgY29uc3QgZWwgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKTtcbiAgZWwuaWQgPSAnZGlzY29udGludWVkLXNrdXMtbW9kYWwnO1xuICBlbC5zdHlsZS5jc3NUZXh0ID1cbiAgICAncG9zaXRpb246Zml4ZWQ7aW5zZXQ6MDtiYWNrZ3JvdW5kOnJnYmEoMTUsMjMsNDIsLjY1KTt6LWluZGV4OjIxMDA7ZGlzcGxheTpmbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtqdXN0aWZ5LWNvbnRlbnQ6Y2VudGVyO3BhZGRpbmc6M3ZoJztcbiAgZWwub25jbGljayA9IChldikgPT4ge1xuICAgIGlmIChldi50YXJnZXQgPT09IGVsKSBlbC5yZW1vdmUoKTtcbiAgfTtcbiAgZWwuaW5uZXJIVE1MID1cbiAgICAnPGRpdiBpZD1cImRpc2NvbnRpbnVlZC1tb2RhbC1jb250ZW50XCIgc3R5bGU9XCJiYWNrZ3JvdW5kOnZhcigtLWJnLWVsZXZhdGVkKTtib3JkZXItcmFkaXVzOjEycHg7cGFkZGluZzoyNHB4O21heC13aWR0aDo2NDBweDt3aWR0aDoxMDAlO21heC1oZWlnaHQ6OTB2aDtvdmVyZmxvdzphdXRvO2JveC1zaGFkb3c6MCAyMHB4IDYwcHggcmdiYSgwLDAsMCwuNClcIj48L2Rpdj4nO1xuICBkb2N1bWVudC5ib2R5LmFwcGVuZENoaWxkKGVsKTtcbiAgX3JlbmRlckRpc2NvbnRpbnVlZE1vZGFsKCk7XG59O1xuXG5mdW5jdGlvbiBfcmVuZGVyRGlzY29udGludWVkTW9kYWwoKSB7XG4gIGNvbnN0IGNvbnQgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZGlzY29udGludWVkLW1vZGFsLWNvbnRlbnQnKTtcbiAgaWYgKCFjb250KSByZXR1cm47XG4gIGNvbnN0IGxpc3QgPSBfZGlzY29udGludWVkU2t1cyA/IEFycmF5LmZyb20oX2Rpc2NvbnRpbnVlZFNrdXMpLnNvcnQoKSA6IFtdO1xuICAvLyBCdXNjYXIgZGVzY3JpcGNpXHUwMEYzbiBlbiBsb3Mgc2FsZXMgcGxhbnMgY2FjaGVzIHBvciBzaSBlc3RhIGNhcmdhZG9cbiAgY29uc3Qgc2t1VG9EZXNjID0ge307XG4gIGZvciAoY29uc3QgZmFtIG9mIFsncm9kcycsICdyZWVscyddKSB7XG4gICAgY29uc3QgY2FjaGUgPSBfc2FsZXNQbGFuQ2FjaGVzW2ZhbV07XG4gICAgaWYgKGNhY2hlICYmIGNhY2hlLnJvd3MpIHtcbiAgICAgIGZvciAoY29uc3QgciBvZiBjYWNoZS5yb3dzKSB7XG4gICAgICAgIHNrdVRvRGVzY1tTdHJpbmcoci5za3UpLnRyaW0oKS50b1VwcGVyQ2FzZSgpXSA9IHIuZGVzY3JpcHRpb24gfHwgJyc7XG4gICAgICB9XG4gICAgfVxuICB9XG4gIGNvbnN0IGhlYWQgPVxuICAgICc8ZGl2IHN0eWxlPVwiZGlzcGxheTpmbGV4O2p1c3RpZnktY29udGVudDpzcGFjZS1iZXR3ZWVuO2FsaWduLWl0ZW1zOmNlbnRlcjttYXJnaW4tYm90dG9tOjE0cHhcIj4nICtcbiAgICAnPGRpdj48ZGl2IHN0eWxlPVwiZm9udC1zaXplOjE4cHg7Zm9udC13ZWlnaHQ6ODAwO2NvbG9yOnZhcigtLXRleHQtcHJpbWFyeSlcIj5TS1VzIGRlc2NvbnRpbnVhZG9zPC9kaXY+JyArXG4gICAgJzxkaXYgc3R5bGU9XCJmb250LXNpemU6MTFweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTttYXJnaW4tdG9wOjJweFwiPicgK1xuICAgIGxpc3QubGVuZ3RoICtcbiAgICAnIFNLVXMgZXhjbHVpZG9zIGRlbCBjXHUwMEUxbGN1bG8gZGUgUmVjb21lbmRhY2lcdTAwRjNuIGRlIENvbXByYScgK1xuICAgICc8L2Rpdj48L2Rpdj4nICtcbiAgICAnPGJ1dHRvbiBvbmNsaWNrPVwiZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoXFwnZGlzY29udGludWVkLXNrdXMtbW9kYWxcXCcpLnJlbW92ZSgpXCIgc3R5bGU9XCJiYWNrZ3JvdW5kOnRyYW5zcGFyZW50O2JvcmRlcjoxcHggc29saWQgdmFyKC0tYm9yZGVyLXN1YnRsZSk7Ym9yZGVyLXJhZGl1czo2cHg7cGFkZGluZzo2cHggMTJweDtjdXJzb3I6cG9pbnRlcjtmb250LXdlaWdodDo3MDBcIj5DZXJyYXI8L2J1dHRvbj4nICtcbiAgICAnPC9kaXY+JztcbiAgY29uc3QgYm9keSA9XG4gICAgbGlzdC5sZW5ndGggPT09IDBcbiAgICAgID8gJzxkaXYgc3R5bGU9XCJwYWRkaW5nOjQwcHg7dGV4dC1hbGlnbjpjZW50ZXI7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZClcIj5ObyBoYXkgU0tVcyBkZXNjb250aW51YWRvcy48YnI+PGJyPlBvZFx1MDBFOXMgZGVzY29udGludWFyIFNLVXMgZGVzZGUgZWwgYm90XHUwMEYzbiBcdUQ4M0RcdURERDEgZW4gY2FkYSBmaWxhIGRlIGxhIHRhYmxhIFJlY29tZW5kYWNpXHUwMEYzbiBkZSBDb21wcmEuPC9kaXY+J1xuICAgICAgOiAnPGRpdiBzdHlsZT1cImRpc3BsYXk6ZmxleDtmbGV4LWRpcmVjdGlvbjpjb2x1bW47Z2FwOjZweFwiPicgK1xuICAgICAgICBsaXN0XG4gICAgICAgICAgLm1hcCgoc2t1KSA9PiB7XG4gICAgICAgICAgICBjb25zdCBkZXNjID0gc2t1VG9EZXNjW3NrdV0gfHwgJyc7XG4gICAgICAgICAgICByZXR1cm4gKFxuICAgICAgICAgICAgICAnPGRpdiBzdHlsZT1cImRpc3BsYXk6ZmxleDthbGlnbi1pdGVtczpjZW50ZXI7Z2FwOjEwcHg7cGFkZGluZzoxMHB4IDEycHg7YmFja2dyb3VuZDp2YXIoLS1iZy1zZWNvbmRhcnkpO2JvcmRlci1yYWRpdXM6NnB4XCI+JyArXG4gICAgICAgICAgICAgICc8ZGl2IHN0eWxlPVwiZmxleDoxXCI+PGRpdiBzdHlsZT1cImZvbnQtZmFtaWx5Om1vbm9zcGFjZTtmb250LXdlaWdodDo3MDA7Y29sb3I6dmFyKC0tdGV4dC1wcmltYXJ5KVwiPicgK1xuICAgICAgICAgICAgICBlc2NhcGVIdG1sU2FmZShza3UpICtcbiAgICAgICAgICAgICAgJzwvZGl2PicgK1xuICAgICAgICAgICAgICAoZGVzY1xuICAgICAgICAgICAgICAgID8gJzxkaXYgc3R5bGU9XCJmb250LXNpemU6MTFweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTttYXJnaW4tdG9wOjJweFwiPicgK1xuICAgICAgICAgICAgICAgICAgZXNjYXBlSHRtbFNhZmUoZGVzYykgK1xuICAgICAgICAgICAgICAgICAgJzwvZGl2PidcbiAgICAgICAgICAgICAgICA6ICcnKSArXG4gICAgICAgICAgICAgICc8L2Rpdj4nICtcbiAgICAgICAgICAgICAgJzxidXR0b24gb25jbGljaz1cInJlYWN0aXZhdGVTa3UoXFwnJyArXG4gICAgICAgICAgICAgIGVzY2FwZUh0bWxTYWZlKHNrdSkgK1xuICAgICAgICAgICAgICAnXFwnKVwiIHN0eWxlPVwicGFkZGluZzo2cHggMTJweDtiYWNrZ3JvdW5kOiMxNmEzNGE7Y29sb3I6I2ZmZjtib3JkZXI6bm9uZTtib3JkZXItcmFkaXVzOjRweDtmb250LXNpemU6MTFweDtmb250LXdlaWdodDo3MDA7Y3Vyc29yOnBvaW50ZXJcIj5cdTIxQkIgUmVhY3RpdmFyPC9idXR0b24+JyArXG4gICAgICAgICAgICAgICc8L2Rpdj4nXG4gICAgICAgICAgICApO1xuICAgICAgICAgIH0pXG4gICAgICAgICAgLmpvaW4oJycpICtcbiAgICAgICAgJzwvZGl2Pic7XG4gIGNvbnQuaW5uZXJIVE1MID0gaGVhZCArIGJvZHk7XG59XG4iXSwKICAibWFwcGluZ3MiOiAiOzs7QUFZQSxNQUFNLGdCQUFnQjtBQUFBLElBQ3BCLEtBQUs7QUFBQSxJQUNM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
