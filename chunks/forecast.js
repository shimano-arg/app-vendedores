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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL3B1cmUvc2FsZXMtcGxhbi1wYXJzZXIuanMiLCAiLi4vc3JjL2RvbWFpbnMvZm9yZWNhc3QuanMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbIi8vIEB0cy1ub2NoZWNrXHJcbi8vIFB1cmU6IHBhcnNlYSB1biBzaGVldCBTYWxlcyBQbGFuIChmb3JtYXRvIFNVUi9TQVIgZGUgU2hpbWFubykgYSBlc3RydWN0dXJhXHJcbi8vIG5vcm1hbGl6YWRhIHsgc2t1LCBkZXNjcmlwdGlvbiwgbW9xLCBtb250aHM6IHsnWVlZWS1NTSc6IE59IH0uXHJcbi8vIFNpbiBkZXBlbmRlbmNpYXMgXHUyMDE0IHJlY2liZSBlbCBzaGVldCB5YSBkZXNlcmlhbGl6YWRvIHBvciBTaGVldEpTXHJcbi8vIChYTFNYLnV0aWxzLnNoZWV0X3RvX2pzb24oc2hlZXQsIHtoZWFkZXI6MSwgZGVmdmFsOicnfSkpLlxyXG4vLyBUZXN0ZWFibGUgZW4gdml0ZXN0IHNpbiBjYXJnYXIgWExTWC5cclxuLy9cclxuLy8gQ29udGV4dG86IGxvcyBTYWxlcyBQbGFucyBkZSBTaGltYW5vIHZpZW5lbiBjb24gaGVhZGVycyBjb21vXHJcbi8vIFwiU0tVIENvZGUvUGFydCBOb1wiLCBcIkRlc2NyaXB0aW9uXCIsIFwiTU9RIDEyIG1vbnRoc1wiIHkgY29sdW1uYXMgZGUgbWVzZXNcclxuLy8gdGlwbyBcIkphbiAyMDI3XCIsIFwiTWF5IDIwMjdcIiAoYSB2ZWNlcyBjb24gYVx1MDBGMW8gZW4gdW5hIGZpbGEgYXJyaWJhIHkgZWwgbWVzXHJcbi8vIGVuIGxhIGZpbGEgaGVhZGVyKS4gRXN0YSBmbiB0b2xlcmEgYW1ib3MgbGF5b3V0cy5cclxuXHJcbmNvbnN0IE1PTlRIX0FMSUFTRVMgPSB7XHJcbiAgamFuOiAxLFxyXG4gIGphbnVhcnk6IDEsXHJcbiAgZW5lOiAxLFxyXG4gIGVuZXJvOiAxLFxyXG4gIGZlYjogMixcclxuICBmZWJydWFyeTogMixcclxuICBmZWJyZXJvOiAyLFxyXG4gIG1hcjogMyxcclxuICBtYXJjaDogMyxcclxuICBtYXJ6bzogMyxcclxuICBhcHI6IDQsXHJcbiAgYXByaWw6IDQsXHJcbiAgYWJyOiA0LFxyXG4gIGFicmlsOiA0LFxyXG4gIG1heTogNSxcclxuICBtYXlvOiA1LFxyXG4gIGp1bjogNixcclxuICBqdW5lOiA2LFxyXG4gIGp1bmlvOiA2LFxyXG4gIGp1bDogNyxcclxuICBqdWx5OiA3LFxyXG4gIGp1bGlvOiA3LFxyXG4gIGF1ZzogOCxcclxuICBhdWd1c3Q6IDgsXHJcbiAgYWdvOiA4LFxyXG4gIGFnb3N0bzogOCxcclxuICBzZXA6IDksXHJcbiAgc2VwdDogOSxcclxuICBzZXB0ZW1iZXI6IDksXHJcbiAgc2VwdGllbWJyZTogOSxcclxuICBvY3Q6IDEwLFxyXG4gIG9jdG9iZXI6IDEwLFxyXG4gIG9jdHVicmU6IDEwLFxyXG4gIG5vdjogMTEsXHJcbiAgbm92ZW1iZXI6IDExLFxyXG4gIG5vdmllbWJyZTogMTEsXHJcbiAgZGVjOiAxMixcclxuICBkZWNlbWJlcjogMTIsXHJcbiAgZGljOiAxMixcclxuICBkaWNpZW1icmU6IDEyLFxyXG59O1xyXG5cclxuLy8gTm9ybWFsaXphIGxhYmVscyBkZSBtZXNlcyBhICdZWVlZLU1NJy4gUmV0b3JuYSBudWxsIHNpIG5vIG1hdGNoZWEuXHJcbi8vIEZvcm1hdG9zIHNvcG9ydGFkb3M6IFwiSmFuIDIwMjdcIiwgXCJFbmUtMjdcIiwgXCJKYW4vMjAyN1wiLCBcIk1heTI3XCIsXHJcbi8vIFwiMjAyNy0wMVwiLCBcIjAxLzIwMjdcIiwgXCJKYW4uMjAyN1wiLCBcIjIwMjFcXG5KYW5cIiAobXVsdGktbGluZSBFeGNlbCkuXHJcbmZ1bmN0aW9uIG5vcm1hbGl6ZU1vbnRoTGFiZWwobGFiZWwpIHtcclxuICBpZiAobGFiZWwgPT0gbnVsbCkgcmV0dXJuIG51bGw7XHJcbiAgLy8gdjExMDQ6IGNvbGFwc2FyIG5ld2xpbmVzL3RhYnMgYSBlc3BhY2lvIGFudGVzIGRlbCB0cmltLlxyXG4gIC8vIEVsIGZvcm1hdG8gRXhjZWwgXCIyMDIxXFxuSmFuXCIgKGFcdTAwRjFvIGVuIEwxLCBtZXMgZW4gTDIgZGVudHJvIGRlIHVuYSBjZWxkYVxyXG4gIC8vIG11bHRpLXJvdykgZXMgY29tXHUwMEZBbiBlbiBTYWxlcyBQbGFucyBTVVIuIGBcXHMrYCBtYXRjaGVhIHdoaXRlc3BhY2UgaW5jbHV5ZW5kb1xyXG4gIC8vIFxcbiB5IFxcclxcbi5cclxuICBjb25zdCBzID0gU3RyaW5nKGxhYmVsKS5yZXBsYWNlKC9cXHMrL2csICcgJykudHJpbSgpLnRvTG93ZXJDYXNlKCk7XHJcbiAgaWYgKCFzKSByZXR1cm4gbnVsbDtcclxuICBsZXQgbTtcclxuICAvLyBcImphbiAyMDI3XCIgfCBcImphbi0yN1wiIHwgXCJlbmUvMjAyN1wiIHwgXCJtYXkyN1wiIHwgXCJtYXkuMjAyN1wiXHJcbiAgbSA9IHMubWF0Y2goL14oW2Etelx1MDBFMVx1MDBFOVx1MDBFRFx1MDBGM1x1MDBGQV17MywxMH0pW1xcc1xcLS8uX10qKFxcZHsyLDR9KSQvKTtcclxuICBpZiAobSkge1xyXG4gICAgY29uc3QgbW9uID0gTU9OVEhfQUxJQVNFU1ttWzFdXSB8fCBNT05USF9BTElBU0VTW21bMV0uc2xpY2UoMCwgMyldO1xyXG4gICAgaWYgKG1vbikge1xyXG4gICAgICBsZXQgeSA9IHBhcnNlSW50KG1bMl0sIDEwKTtcclxuICAgICAgaWYgKHkgPCAxMDApIHkgPSAyMDAwICsgeTtcclxuICAgICAgcmV0dXJuIFN0cmluZyh5KS5wYWRTdGFydCg0LCAnMCcpICsgJy0nICsgU3RyaW5nKG1vbikucGFkU3RhcnQoMiwgJzAnKTtcclxuICAgIH1cclxuICB9XHJcbiAgLy8gXCIyMDIxIGphblwiIHwgXCIyMDI3IGRpY1wiIChhXHUwMEYxbyBwcmltZXJvICsgbWVzLCBmb3JtYXRvIEV4Y2VsIG11bHRpLWxpbmVcclxuICAvLyBjb2xhcHNhZG8gdHJhcyByZXBsYWNlIFxccyspLlxyXG4gIG0gPSBzLm1hdGNoKC9eKFxcZHs0fSlbXFxzXFwtLy5fXSsoW2Etelx1MDBFMVx1MDBFOVx1MDBFRFx1MDBGM1x1MDBGQV17MywxMH0pJC8pO1xyXG4gIGlmIChtKSB7XHJcbiAgICBjb25zdCB5ID0gcGFyc2VJbnQobVsxXSwgMTApO1xyXG4gICAgY29uc3QgbW9uID0gTU9OVEhfQUxJQVNFU1ttWzJdXSB8fCBNT05USF9BTElBU0VTW21bMl0uc2xpY2UoMCwgMyldO1xyXG4gICAgaWYgKG1vbikgcmV0dXJuIFN0cmluZyh5KS5wYWRTdGFydCg0LCAnMCcpICsgJy0nICsgU3RyaW5nKG1vbikucGFkU3RhcnQoMiwgJzAnKTtcclxuICB9XHJcbiAgLy8gXCIyMDI3LTAxXCIgfCBcIjIwMjcvMDFcIlxyXG4gIG0gPSBzLm1hdGNoKC9eKFxcZHs0fSlbLS9dKFxcZHsxLDJ9KSQvKTtcclxuICBpZiAobSkge1xyXG4gICAgY29uc3QgeSA9IHBhcnNlSW50KG1bMV0sIDEwKTtcclxuICAgIGNvbnN0IG1vbiA9IHBhcnNlSW50KG1bMl0sIDEwKTtcclxuICAgIGlmIChtb24gPj0gMSAmJiBtb24gPD0gMTIpXHJcbiAgICAgIHJldHVybiBTdHJpbmcoeSkucGFkU3RhcnQoNCwgJzAnKSArICctJyArIFN0cmluZyhtb24pLnBhZFN0YXJ0KDIsICcwJyk7XHJcbiAgfVxyXG4gIC8vIFwiMDEvMjAyN1wiIHwgXCIwMS0yMDI3XCJcclxuICBtID0gcy5tYXRjaCgvXihcXGR7MSwyfSlbLS9dKFxcZHs0fSkkLyk7XHJcbiAgaWYgKG0pIHtcclxuICAgIGNvbnN0IG1vbiA9IHBhcnNlSW50KG1bMV0sIDEwKTtcclxuICAgIGNvbnN0IHkgPSBwYXJzZUludChtWzJdLCAxMCk7XHJcbiAgICBpZiAobW9uID49IDEgJiYgbW9uIDw9IDEyKVxyXG4gICAgICByZXR1cm4gU3RyaW5nKHkpLnBhZFN0YXJ0KDQsICcwJykgKyAnLScgKyBTdHJpbmcobW9uKS5wYWRTdGFydCgyLCAnMCcpO1xyXG4gIH1cclxuICByZXR1cm4gbnVsbDtcclxufVxyXG5cclxuLy8gQnVzY2EgbGEgZmlsYSBoZWFkZXIgKDAtYmFzZWQpLiBFc2NhbmVhIGxhcyBwcmltZXJhcyAzMCBmaWxhcy5cclxuZnVuY3Rpb24gZmluZEhlYWRlclJvdyhyb3dzKSB7XHJcbiAgY29uc3QgSEVBREVSX01BUktFUlMgPSBbXHJcbiAgICAnc2t1IGNvZGUvcGFydCBubycsXHJcbiAgICAnc2t1IGNvZGUnLFxyXG4gICAgJ3NrdScsXHJcbiAgICAncGFydCBubycsXHJcbiAgICAncGFydCBudW1iZXInLFxyXG4gICAgJ2l0ZW1jb2RlJyxcclxuICAgICdpdGVtIGNvZGUnLFxyXG4gICAgJ2NvZGlnbycsXHJcbiAgICAnY1x1MDBGM2RpZ28nLFxyXG4gIF07XHJcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBNYXRoLm1pbihyb3dzLmxlbmd0aCwgMzApOyBpKyspIHtcclxuICAgIGNvbnN0IHJvdyA9IHJvd3NbaV0gfHwgW107XHJcbiAgICBmb3IgKGNvbnN0IGNlbGwgb2Ygcm93KSB7XHJcbiAgICAgIC8vIHYxMTA0OiBjb2xhcHNhciBuZXdsaW5lcyBhIGVzcGFjaW8gcGFyYSBtYXRjaGVhciBoZWFkZXJzIGNvbW9cclxuICAgICAgLy8gXCJTS1UgQ29kZS9QYXJ0IE5vXCIgKG9rKSBvIFwiU0tVXFxuQ29kZVwiIChuZWNlc2l0YSBjb2xhcHNhcikuXHJcbiAgICAgIGNvbnN0IHMgPSBTdHJpbmcoY2VsbCA9PSBudWxsID8gJycgOiBjZWxsKVxyXG4gICAgICAgIC5yZXBsYWNlKC9cXHMrL2csICcgJylcclxuICAgICAgICAudHJpbSgpXHJcbiAgICAgICAgLnRvTG93ZXJDYXNlKCk7XHJcbiAgICAgIGlmIChIRUFERVJfTUFSS0VSUy5pbmRleE9mKHMpID49IDApIHJldHVybiBpO1xyXG4gICAgfVxyXG4gIH1cclxuICByZXR1cm4gLTE7XHJcbn1cclxuXHJcbi8vIERldGVjdGEgXHUwMEVEbmRpY2VzIGRlIGNvbHVtbmFzIHkgbWVzZXMuIGBoaW50Um93QWJvdmVgIHBlcm1pdGUgY29tYmluYXIgYVx1MDBGMW8vbWVzXHJcbi8vIGN1YW5kbyBlbCBoZWFkZXIgZXMgbXVsdGktcm93IChhXHUwMEYxbyBhcnJpYmEsIG1lcyBhYmFqbyBvIHZpY2V2ZXJzYSkuXHJcbmZ1bmN0aW9uIGRldGVjdENvbHVtbnMoaGVhZGVyUm93LCBoaW50Um93QWJvdmUpIHtcclxuICBsZXQgc2t1SWR4ID0gLTE7XHJcbiAgbGV0IGRlc2NJZHggPSAtMTtcclxuICBsZXQgbW9xSWR4ID0gLTE7XHJcbiAgY29uc3QgbW9udGhDb2x1bW5zID0gW107XHJcbiAgY29uc3QgZGV0ZWN0ZWRNb250aHNTZXQgPSBuZXcgU2V0KCk7XHJcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBoZWFkZXJSb3cubGVuZ3RoOyBpKyspIHtcclxuICAgIC8vIHYxMTA0OiBjb2xhcHNhciBuZXdsaW5lcyBhIGVzcGFjaW8gYW50ZXMgZGUgY29tcGFyYXIuIExvcyBTYWxlcyBQbGFuXHJcbiAgICAvLyBTVVIgdGllbmVuIGhlYWRlcnMgbXVsdGktbGluZSBjb21vIFwiTU9RXFxuMTIgbW9udGhzXCIgbyBcIkJhc2VcXG5GT0IoVVNEKVwiLlxyXG4gICAgY29uc3QgcmF3ID0gU3RyaW5nKGhlYWRlclJvd1tpXSA9PSBudWxsID8gJycgOiBoZWFkZXJSb3dbaV0pXHJcbiAgICAgIC5yZXBsYWNlKC9cXHMrL2csICcgJylcclxuICAgICAgLnRyaW0oKTtcclxuICAgIGNvbnN0IHMgPSByYXcudG9Mb3dlckNhc2UoKTtcclxuICAgIGlmIChcclxuICAgICAgc2t1SWR4IDwgMCAmJlxyXG4gICAgICAocyA9PT0gJ3NrdSBjb2RlL3BhcnQgbm8nIHx8XHJcbiAgICAgICAgcyA9PT0gJ3NrdSBjb2RlJyB8fFxyXG4gICAgICAgIHMgPT09ICdza3UnIHx8XHJcbiAgICAgICAgcyA9PT0gJ3BhcnQgbm8nIHx8XHJcbiAgICAgICAgcyA9PT0gJ3BhcnQgbnVtYmVyJyB8fFxyXG4gICAgICAgIHMgPT09ICdpdGVtY29kZScgfHxcclxuICAgICAgICBzID09PSAnaXRlbSBjb2RlJyB8fFxyXG4gICAgICAgIHMgPT09ICdjb2RpZ28nIHx8XHJcbiAgICAgICAgcyA9PT0gJ2NcdTAwRjNkaWdvJylcclxuICAgICkge1xyXG4gICAgICBza3VJZHggPSBpO1xyXG4gICAgICBjb250aW51ZTtcclxuICAgIH1cclxuICAgIGlmIChcclxuICAgICAgZGVzY0lkeCA8IDAgJiZcclxuICAgICAgKHMgPT09ICdkZXNjcmlwdGlvbicgfHxcclxuICAgICAgICBzID09PSAnZGVzY3JpcGNpb24nIHx8XHJcbiAgICAgICAgcyA9PT0gJ2Rlc2NyaXBjaVx1MDBGM24nIHx8XHJcbiAgICAgICAgcyA9PT0gJ2l0ZW0gbmFtZScgfHxcclxuICAgICAgICBzID09PSAnaXRlbW5hbWUnKVxyXG4gICAgKSB7XHJcbiAgICAgIGRlc2NJZHggPSBpO1xyXG4gICAgICBjb250aW51ZTtcclxuICAgIH1cclxuICAgIGlmIChtb3FJZHggPCAwICYmIChzID09PSAnbW9xIDEyIG1vbnRocycgfHwgcyA9PT0gJ21vcScgfHwgcy5pbmRleE9mKCdtb3EnKSA9PT0gMCkpIHtcclxuICAgICAgbW9xSWR4ID0gaTtcclxuICAgICAgY29udGludWU7XHJcbiAgICB9XHJcbiAgICAvLyBUcnkgZGlyZWN0IG1vbnRoIHBhcnNlXHJcbiAgICBsZXQgbW9udGhLZXkgPSBub3JtYWxpemVNb250aExhYmVsKHJhdyk7XHJcbiAgICBpZiAoIW1vbnRoS2V5ICYmIGhpbnRSb3dBYm92ZSAmJiBoaW50Um93QWJvdmVbaV0gIT0gbnVsbCkge1xyXG4gICAgICBjb25zdCBoaW50ID0gU3RyaW5nKGhpbnRSb3dBYm92ZVtpXSkudHJpbSgpO1xyXG4gICAgICBpZiAoaGludCkge1xyXG4gICAgICAgIG1vbnRoS2V5ID0gbm9ybWFsaXplTW9udGhMYWJlbChyYXcgKyAnICcgKyBoaW50KSB8fCBub3JtYWxpemVNb250aExhYmVsKGhpbnQgKyAnICcgKyByYXcpO1xyXG4gICAgICB9XHJcbiAgICB9XHJcbiAgICBpZiAobW9udGhLZXkpIHtcclxuICAgICAgbW9udGhDb2x1bW5zLnB1c2goeyBjb2xJZHg6IGksIG1vbnRoS2V5IH0pO1xyXG4gICAgICBkZXRlY3RlZE1vbnRoc1NldC5hZGQobW9udGhLZXkpO1xyXG4gICAgfVxyXG4gIH1cclxuICByZXR1cm4ge1xyXG4gICAgc2t1SWR4LFxyXG4gICAgZGVzY0lkeCxcclxuICAgIG1vcUlkeCxcclxuICAgIG1vbnRoQ29sdW1ucyxcclxuICAgIGRldGVjdGVkTW9udGhzOiBBcnJheS5mcm9tKGRldGVjdGVkTW9udGhzU2V0KS5zb3J0KCksXHJcbiAgfTtcclxufVxyXG5cclxuLy8gUHVibGljOiBwYXJzZSBmdWxsIHNoZWV0LiBUaHJvd3Mgb24gbWlzc2luZyBTS1UgY29sdW1uIC8gbW9udGhzLlxyXG5mdW5jdGlvbiBwYXJzZVNhbGVzUGxhblNoZWV0KHJvd3MpIHtcclxuICBpZiAoIXJvd3MgfHwgIXJvd3MubGVuZ3RoKSB7XHJcbiAgICBjb25zdCBlcnIgPSBuZXcgRXJyb3IoJ0V4Y2VsIHZhY2lvJyk7XHJcbiAgICBlcnIuY29kZSA9ICdFTVBUWV9TSEVFVCc7XHJcbiAgICB0aHJvdyBlcnI7XHJcbiAgfVxyXG4gIGNvbnN0IGhlYWRlcklkeCA9IGZpbmRIZWFkZXJSb3cocm93cyk7XHJcbiAgaWYgKGhlYWRlcklkeCA8IDApIHtcclxuICAgIGNvbnN0IGVyciA9IG5ldyBFcnJvcignTm8gc2UgZW5jb250cm8gZmlsYSBkZSBoZWFkZXJzIChidXNjYWJhIFwiU0tVIENvZGUvUGFydCBOb1wiIG8gXCJTS1VcIiknKTtcclxuICAgIGVyci5jb2RlID0gJ0hFQURFUl9OT1RfRk9VTkQnO1xyXG4gICAgdGhyb3cgZXJyO1xyXG4gIH1cclxuICBjb25zdCBoZWFkZXJSb3cgPSByb3dzW2hlYWRlcklkeF0gfHwgW107XHJcbiAgY29uc3Qgcm93QWJvdmUgPSBoZWFkZXJJZHggPiAwID8gcm93c1toZWFkZXJJZHggLSAxXSB8fCBbXSA6IG51bGw7XHJcbiAgY29uc3QgY29scyA9IGRldGVjdENvbHVtbnMoaGVhZGVyUm93LCByb3dBYm92ZSk7XHJcbiAgaWYgKGNvbHMuc2t1SWR4IDwgMCkge1xyXG4gICAgY29uc3QgZXJyID0gbmV3IEVycm9yKCdObyBzZSBlbmNvbnRybyBjb2x1bW5hIFNLVSBlbiBsYSBmaWxhIGhlYWRlcicpO1xyXG4gICAgZXJyLmNvZGUgPSAnU0tVX0NPTF9NSVNTSU5HJztcclxuICAgIHRocm93IGVycjtcclxuICB9XHJcbiAgaWYgKCFjb2xzLm1vbnRoQ29sdW1ucy5sZW5ndGgpIHtcclxuICAgIGNvbnN0IGVyciA9IG5ldyBFcnJvcihcclxuICAgICAgJ05vIHNlIGRldGVjdGFyb24gY29sdW1uYXMgZGUgbWVzZXMgZW4gZWwgaGVhZGVyIChlajogXCJKYW4gMjAyN1wiLCBcIk1heSAyMDI3XCIpJ1xyXG4gICAgKTtcclxuICAgIGVyci5jb2RlID0gJ01PTlRIU19OT1RfRk9VTkQnO1xyXG4gICAgdGhyb3cgZXJyO1xyXG4gIH1cclxuICBjb25zdCBwYXJzZWRSb3dzID0gW107XHJcbiAgY29uc3Qgc2VlblNrdSA9IG5ldyBTZXQoKTtcclxuICBmb3IgKGxldCByID0gaGVhZGVySWR4ICsgMTsgciA8IHJvd3MubGVuZ3RoOyByKyspIHtcclxuICAgIGNvbnN0IHJvdyA9IHJvd3Nbcl0gfHwgW107XHJcbiAgICBjb25zdCBza3VSYXcgPSByb3dbY29scy5za3VJZHhdO1xyXG4gICAgaWYgKHNrdVJhdyA9PSBudWxsIHx8IFN0cmluZyhza3VSYXcpLnRyaW0oKSA9PT0gJycpIGNvbnRpbnVlO1xyXG4gICAgY29uc3Qgc2t1ID0gU3RyaW5nKHNrdVJhdykudHJpbSgpO1xyXG4gICAgY29uc3QgdXBwZXIgPSBza3UudG9VcHBlckNhc2UoKTtcclxuICAgIC8vIFNraXAgZmlsYXMgVE9UQUwgLyBTVU0gLyBTVUJUT1RBTFxyXG4gICAgaWYgKHVwcGVyID09PSAnVE9UQUwnIHx8IHVwcGVyID09PSAnU1VNJyB8fCB1cHBlciA9PT0gJ1NVQlRPVEFMJyB8fCB1cHBlciA9PT0gJ1RPVEFMRVMnKVxyXG4gICAgICBjb250aW51ZTtcclxuICAgIGlmIChzZWVuU2t1Lmhhcyh1cHBlcikpIGNvbnRpbnVlOyAvLyBkZWR1cGVcclxuICAgIHNlZW5Ta3UuYWRkKHVwcGVyKTtcclxuICAgIGNvbnN0IGRlc2NyaXB0aW9uID1cclxuICAgICAgY29scy5kZXNjSWR4ID49IDAgPyBTdHJpbmcocm93W2NvbHMuZGVzY0lkeF0gPT0gbnVsbCA/ICcnIDogcm93W2NvbHMuZGVzY0lkeF0pLnRyaW0oKSA6ICcnO1xyXG4gICAgY29uc3QgbW9xUmF3ID0gY29scy5tb3FJZHggPj0gMCA/IHJvd1tjb2xzLm1vcUlkeF0gOiBudWxsO1xyXG4gICAgY29uc3QgbW9xTnVtID0gTnVtYmVyKG1vcVJhdyk7XHJcbiAgICBjb25zdCBtb3EgPSBOdW1iZXIuaXNGaW5pdGUobW9xTnVtKSAmJiBtb3FOdW0gPiAwID8gTWF0aC5yb3VuZChtb3FOdW0pIDogMDtcclxuICAgIGNvbnN0IG1vbnRocyA9IHt9O1xyXG4gICAgZm9yIChjb25zdCBtYyBvZiBjb2xzLm1vbnRoQ29sdW1ucykge1xyXG4gICAgICBjb25zdCB2ID0gcm93W21jLmNvbElkeF07XHJcbiAgICAgIGNvbnN0IG4gPSBOdW1iZXIodik7XHJcbiAgICAgIGlmIChOdW1iZXIuaXNGaW5pdGUobikgJiYgbiA+IDApIHtcclxuICAgICAgICBtb250aHNbbWMubW9udGhLZXldID0gTWF0aC5yb3VuZChuKTtcclxuICAgICAgfVxyXG4gICAgfVxyXG4gICAgcGFyc2VkUm93cy5wdXNoKHsgc2t1LCBkZXNjcmlwdGlvbiwgbW9xLCBtb250aHMgfSk7XHJcbiAgfVxyXG4gIHJldHVybiB7XHJcbiAgICBoZWFkZXJSb3dJbmRleDogaGVhZGVySWR4LFxyXG4gICAgZGV0ZWN0ZWRNb250aHM6IGNvbHMuZGV0ZWN0ZWRNb250aHMsXHJcbiAgICByb3dzQ291bnQ6IHBhcnNlZFJvd3MubGVuZ3RoLFxyXG4gICAgcm93czogcGFyc2VkUm93cyxcclxuICB9O1xyXG59XHJcblxyXG4vLyBVTUQtaXNoIGV4cG9ydDogcGFyYSB2aXRlc3QgKG1vZHVsZS5leHBvcnRzKSB5IHBhcmEgYnVuZGxlIGJyb3dzZXIgKHdpbmRvdyBnbG9iYWwpLlxyXG5pZiAodHlwZW9mIG1vZHVsZSAhPT0gJ3VuZGVmaW5lZCcgJiYgbW9kdWxlLmV4cG9ydHMpIHtcclxuICBtb2R1bGUuZXhwb3J0cyA9IHsgcGFyc2VTYWxlc1BsYW5TaGVldCwgbm9ybWFsaXplTW9udGhMYWJlbCwgZmluZEhlYWRlclJvdywgZGV0ZWN0Q29sdW1ucyB9O1xyXG59XHJcbmlmICh0eXBlb2Ygd2luZG93ICE9PSAndW5kZWZpbmVkJykge1xyXG4gIHdpbmRvdy5TYWxlc1BsYW5QYXJzZXIgPSB7XHJcbiAgICBwYXJzZVNhbGVzUGxhblNoZWV0LFxyXG4gICAgbm9ybWFsaXplTW9udGhMYWJlbCxcclxuICAgIGZpbmRIZWFkZXJSb3csXHJcbiAgICBkZXRlY3RDb2x1bW5zLFxyXG4gIH07XHJcbn1cclxuXHJcbmV4cG9ydCB7IGRldGVjdENvbHVtbnMsIGZpbmRIZWFkZXJSb3csIG5vcm1hbGl6ZU1vbnRoTGFiZWwsIHBhcnNlU2FsZXNQbGFuU2hlZXQgfTtcclxuIiwgIi8vIEB0cy1ub2NoZWNrXG4vLyB2MTA5OCsgRmFzZSAxOiBpbXBvcnQgZGVsIHBhcnNlciBwdXJvLiBFbCBtXHUwMEYzZHVsbyBoYWNlIGB3aW5kb3cuU2FsZXNQbGFuUGFyc2VyYFxuLy8gY29tbyBzaWRlLWVmZmVjdCB5IHRhbWJpXHUwMEU5biBleHBvcnRhIGxhcyBmbnMgbm9tYnJhZGFzOyB1c2Ftb3Mgc2lkZS1lZmZlY3Rcbi8vIHBvcnF1ZSBmb3JlY2FzdC5qcyBjb3JyZSBlbiBlbCBjaHVuayBsYXp5IHkgd2luZG93IHlhIGVzdFx1MDBFMSBkaXNwb25pYmxlLlxuaW1wb3J0ICcuLi9wdXJlL3NhbGVzLXBsYW4tcGFyc2VyLmpzJztcblxuLy8gR2xvYmFscyBsZWlkb3MgZGVsIGVudG9ybm8gKGRlY2xhcmFkb3MgZW4gaW5kZXguaHRtbCBpbmxpbmUgbyBidW5kbGUgcHJldmlvKTpcbi8vIGZiRGIsIGN1cnJlbnRVc2VyLCBYTFNYIChjZG4pLCBlc2NhcGVIdG1sLiBNaXNtbyBwYXRyb24gcXVlIG90cm9zIGRvbWluaW9zLlxuLy9cbi8vIEZPUkVDQVNUIC0gbW9kYWwgYWRtaW4tb25seSAoTWFyaWFubykuIENodW5rIGxhenk6IHNlIGNhcmdhIHNvbG8gYWwgcHJpbWVyXG4vLyBjbGljayBkZWwgYm90b24gRk9SRUNBU1QgZGVsIGhlYWRlci4gUmVnaXN0cmFkbyBlbiBidWlsZC5qcyBMQVpZX0NIVU5LUyArXG4vLyBzcmMvbWFpbi5qcyBpbnN0YWxsQ2h1bmtTdHVicyArIHN3LmpzIFNUQVRJQ19BU1NFVFMuIFZlciBDTEFVREUubWQgIzE4LlxuLy9cbi8vIHYxMTExIGNsZWFuOiBwaXBlbGluZSBsZWdhY3kgKFNLVSArIDYgY29sdW1uYXMgKyBwb2xpdGljYSAzbSkgcmVtb3ZpZG8uXG4vLyBSZWVtcGxhemFkbyBwb3I6XG4vLyAgIC0gRmFzZSAxICh2MTA5OCk6IFNhbGVzIFBsYW5zIG1lbnN1YWxlcyBSb2RzL1JlZWxzIGNvbiBmb3JtYXRvIFNVUi5cbi8vICAgLSBGYXNlIDJCICh2MTEwMyk6IEZvcmVjYXN0IEVzdGFkaXN0aWNvIChzdGF0c2ZvcmVjYXN0IHBpcGVsaW5lIG9mZmxpbmUpLlxuLy8gICAtIEZhc2UgM0EgKHYxMTA5KTogVGFibGEgUmVjb21lbmRhY2lvbiBkZSBDb21wcmEuXG5cbi8vIHYxMDk4KyAoRmFzZSAxIEZvcmVjYXN0IHYyKTogU2FsZXMgUGxhbnMgbWVuc3VhbGVzIHBvciBmYW1pbGlhIChSb2RzL1JlZWxzL0ZHKS5cbi8vIFNlIGd1YXJkYW4gZW4gRmlyZXN0b3JlIGBzYWxlc19wbGFuX2NhY2hlL3tmYW1pbGlhfWAgKyBzbmFwc2hvdCBFeGNlbCBvcmlnaW5hbFxuLy8gZW4gU3RvcmFnZSBgZm9yZWNhc3RzX3NuYXBzaG90cy97WVlZWS1NTX0ve2ZhbWlsaWF9Lnhsc3hgLlxuLy8gRWwgcGFyc2VyIHB1cm8gdml2ZSBlbiBzcmMvcHVyZS9zYWxlcy1wbGFuLXBhcnNlci5qcyAoYXR0YWNoIGEgd2luZG93LlNhbGVzUGxhblBhcnNlcikuXG4vLyB2MTEwODogRkcgcmVtb3ZpZG8gZGVsIFVJIChNYXJpYW5vIHBpZGlcdTAwRjMpLiBTb2xvIFJvZHMgKyBSZWVscyBwb3IgYWhvcmEuXG4vLyBMYSBydWxlIEZpcmVzdG9yZSBzaWd1ZSBhY2VwdGFuZG8gJ2ZnJyBwb3Igc2kgZW4gZWwgZnV0dXJvIHNlIHZ1ZWx2ZSBhXG4vLyBhY3RpdmFyIFx1MjAxNCBubyBib3JyYXJsYSBlbiBzdG9yYWdlL2ZpcmVzdG9yZS5ydWxlcyBoYXN0YSBjb25maXJtYXIgZGVwcmVjYXRlLlxuY29uc3QgU0FMRVNfUExBTl9GQU1JTElBUyA9IFtcbiAgeyBrZXk6ICdyb2RzJywgbGFiZWw6ICdSb2RzIChDYVx1MDBGMWFzKScsIGNvbG9yOiAnIzBlYTVlOScgfSxcbiAgeyBrZXk6ICdyZWVscycsIGxhYmVsOiAnUmVlbHMnLCBjb2xvcjogJyM4YjVjZjYnIH0sXG5dO1xuY29uc3QgX3NhbGVzUGxhbkNhY2hlcyA9IHsgcm9kczogbnVsbCwgcmVlbHM6IG51bGwgfTsgLy8gbGFzdCBsb2FkZWQgZG9jXG5sZXQgX2ZvcmVjYXN0QWN0aXZlVGFiID0gJ3NhbGVzLXBsYW5zJzsgLy8gJ3NhbGVzLXBsYW5zJyB8ICdzdGF0JyB8ICdsZWdhY3knXG5cbi8vIHYxMTAzKyAoRmFzZSAyQik6IEZvcmVjYXN0IEVzdGFkXHUwMEVEc3RpY28gXHUyMDE0IG91dHB1dCBwdWJsaWNhZG8gcG9yXG4vLyBzY3JpcHRzL2ZvcmVjYXN0L3B1Ymxpc2hfdG9fZmlyZXN0b3JlLnB5IGEgZm9yZWNhc3Rfb3V0cHV0L3tzdWJfc2x1Z31cbi8vICsgZm9yZWNhc3Rfb3V0cHV0X21ldGEvY3VycmVudC4gMjQgc3VicyArIDEgbWV0YSBkb2MuXG5sZXQgX2ZvcmVjYXN0U3RhdERvY3MgPSBudWxsOyAvLyBbe2lkLCBzdWJmYW1pbGlhLCBmb3JlY2FzdFs3XSwgbWV0cmljcywgYmVzdE1vZGVsLCB2ZXJzaW9uSWR9XVxubGV0IF9mb3JlY2FzdFN0YXRNZXRhID0gbnVsbDsgLy8ge2dlbmVyYXRlZEF0LCB2ZXJzaW9uSWQsIHJlc3VtZW46IHsuLi59fVxubGV0IF9mb3JlY2FzdFN0YXRIaXN0b3J5Q2FjaGUgPSBudWxsOyAvLyB7IFtzdWJdOiBbe2RzLCB5fV0gfSBjYWNoZSBsYXp5IG9uLWRlbWFuZFxuXG4vLyB2MTEwOSsgKEZhc2UgM0EpOiBUYWJsYSBSZWNvbWVuZGFjaVx1MDBGM24gZGUgQ29tcHJhIFx1MjAxNCBjb21iaW5hIHNhbGVzIHBsYW5zICtcbi8vIHN0b2NrX3NuYXBzaG90ICsgc2t1X3ZlbnRhc19zbmFwc2hvdCBwYXJhIGNvbXB1dGFyIHJlY29tZW5kYWRvIHBvciBTS1UuXG5sZXQgX3JlY29TdG9ja1NuYXBzaG90ID0gbnVsbDsgLy8ge3dhcmVob3VzZUJyZWFrZG93bjoge3NrdTp7JzExJzpuLCcxMic6biwuLi59fSwgYmFja29yZGVyQnlTa3U6IHtza3U6bn19XG5sZXQgX3JlY29WZW50YXNTbmFwc2hvdCA9IG51bGw7IC8vIHsgW1NLVSB1cHBlcl06IHttZXNlczogeydZWVlZLU1NJzoge3F0eSxhcnN9fX0gfVxubGV0IF9yZWNvRmlsdGVyTWluUmVjID0gdHJ1ZTsgLy8gXCJzb2xvIG1vc3RyYXIgU0tVcyBjb24gcmVjb21lbmRhZG8gPiAwXCJcbmxldCBfcmVjb0ZpbHRlckZhbWlsaWEgPSAnYWxsJzsgLy8gJ2FsbCcgfCAncm9kcycgfCAncmVlbHMnXG5sZXQgX3JlY29TZWFyY2hUZXh0ID0gJyc7XG5cbmNvbnN0IFJFQ09fSE9SSVpPTl9NT05USFMgPSA3O1xuY29uc3QgUkVDT19WRU5UQV9QUk9NRURJT19XSU5ET1cgPSAzOyAvLyBtZXNlcyBoYWNpYSBhdHJcdTAwRTFzIHBhcmEgcHJvbWVkaW8gdmVudGFcbmNvbnN0IFJFQ09fREVGQVVMVF9NVUxUSVBMSUVSID0gMS4wO1xuXG4vLyBXaGl0ZWxpc3QgZGUgZW1haWxzIGNvbiBhY2Nlc28gYWwgbW9kYWwgRk9SRUNBU1QuIFJlcGxpY2EgZWwgcGF0cm9uIGRlXG4vLyBcIkFuYWxpc2lzXCIgKGluZGV4Lmh0bWw6MTI2MjUpLiBTb2xvIE1hcmlhbm87IHNpIG90cm8gYWRtaW4gbG8gbmVjZXNpdGFcbi8vIHNlIGFncmVnYSBhY2EgZXhwbGljaXRvLlxuY29uc3QgRk9SRUNBU1RfQUxMT1dFRF9FTUFJTFMgPSBbJ21hcmlhbm8uZXJiaW5vQHNoaW1hbm8uY29tLmFyJywgJ2VyYmlub21hcmlhbm9AZ21haWwuY29tJ107XG5cbmZ1bmN0aW9uIF9jYW5Gb3JlY2FzdCgpIHtcbiAgdHJ5IHtcbiAgICBjb25zdCBlbWFpbCA9ICgod2luZG93LmN1cnJlbnRVc2VyICYmIHdpbmRvdy5jdXJyZW50VXNlci5lbWFpbCkgfHwgJycpLnRvTG93ZXJDYXNlKCk7XG4gICAgaWYgKCFlbWFpbCkgcmV0dXJuIGZhbHNlO1xuICAgIHJldHVybiBGT1JFQ0FTVF9BTExPV0VEX0VNQUlMUy5pbmRleE9mKGVtYWlsKSA+PSAwO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbn1cblxuZnVuY3Rpb24gX3JlbmRlck1vZGFsU2hlbGwoKSB7XG4gIGNvbnN0IGV4aXN0aW5nID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2ZvcmVjYXN0LW1vZGFsJyk7XG4gIGlmIChleGlzdGluZykgcmV0dXJuIGV4aXN0aW5nO1xuICBjb25zdCBlbCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpO1xuICBlbC5pZCA9ICdmb3JlY2FzdC1tb2RhbCc7XG4gIGVsLmNsYXNzTmFtZSA9ICdtb2RhbC1vdmVybGF5JztcbiAgZWwuc3R5bGUuY3NzVGV4dCA9XG4gICAgJ2Rpc3BsYXk6bm9uZTtwb3NpdGlvbjpmaXhlZDtpbnNldDowO2JhY2tncm91bmQ6cmdiYSgxNSwyMyw0MiwuNik7ei1pbmRleDoyMDUwOyc7XG4gIGVsLm9uY2xpY2sgPSBmdW5jdGlvbiAoZXYpIHtcbiAgICBpZiAoZXYudGFyZ2V0ID09PSBlbCkgd2luZG93LmNsb3NlRm9yZWNhc3RNb2RhbCgpO1xuICB9O1xuICAvLyBTaGVsbCArIHRhYnMgYmFyICsgMiBjb250ZW5lZG9yZXMgZGUgdGFicyAoU2FsZXMgUGxhbnMgbnVldmEsIExlZ2FjeSA2bSkuXG4gIC8vIEVsIGNvbnRlbmlkbyBkZSBjYWRhIHRhYiBzZSBwaW50YSBjb24gX3JlbmRlclNhbGVzUGxhbnNUYWIoKSB5IGVsIGxlZ2FjeVxuICAvLyB1c2EgZWwgZmx1am8gX3JlbmRlclRhYmxlKCkgZGUgc2llbXByZS5cbiAgY29uc3Qgc2hlbGxIdG1sID0gX2J1aWxkU2hlbGxIdG1sKCk7XG4gIGVsLmlubmVySFRNTCA9IHNoZWxsSHRtbDtcbiAgZG9jdW1lbnQuYm9keS5hcHBlbmRDaGlsZChlbCk7XG4gIHJldHVybiBlbDtcbn1cblxuZnVuY3Rpb24gX2J1aWxkU2hlbGxIdG1sKCkge1xuICAvLyBCcm9rZW4tb3V0IHB1cmUgc3RyaW5nIGJ1aWxkZXIgcGFyYSBwYXNhciBlbCBob29rIGRlIGlubmVySFRNTC5cbiAgY29uc3QgbW9kYWxPdXRlciA9XG4gICAgJzxkaXYgc3R5bGU9XCJwb3NpdGlvbjphYnNvbHV0ZTtpbnNldDoxdmggMXZ3O2JhY2tncm91bmQ6dmFyKC0tYmctZWxldmF0ZWQpO2JvcmRlci1yYWRpdXM6MTBweDtkaXNwbGF5OmZsZXg7ZmxleC1kaXJlY3Rpb246Y29sdW1uO292ZXJmbG93OmhpZGRlbjtib3gtc2hhZG93OjAgMjBweCA1MHB4IHJnYmEoMCwwLDAsLjM1KVwiPic7XG4gIGNvbnN0IGhlYWRlciA9XG4gICAgJzxkaXYgc3R5bGU9XCJwYWRkaW5nOjEycHggMThweDtiYWNrZ3JvdW5kOiMwZjE3MmE7Y29sb3I6I2ZmZjtkaXNwbGF5OmZsZXg7YWxpZ24taXRlbXM6Y2VudGVyO2dhcDoxMnB4XCI+JyArXG4gICAgJzxkaXYgc3R5bGU9XCJmbGV4OjFcIj48ZGl2IHN0eWxlPVwiZm9udC1zaXplOjE2cHg7Zm9udC13ZWlnaHQ6ODAwO2xldHRlci1zcGFjaW5nOi41cHhcIj5GT1JFQ0FTVDwvZGl2PicgK1xuICAgICc8ZGl2IGlkPVwiZm9yZWNhc3Qtc3VidGl0bGVcIiBzdHlsZT1cImZvbnQtc2l6ZToxMXB4O29wYWNpdHk6Ljg7bWFyZ2luLXRvcDoycHhcIj5TYWxlcyBQbGFucyBtZW5zdWFsZXMgKyBwb2xpdGljYSBkZSBpbnZlbnRhcmlvPC9kaXY+PC9kaXY+JyArXG4gICAgJzxidXR0b24gb25jbGljaz1cImNsb3NlRm9yZWNhc3RNb2RhbCgpXCIgc3R5bGU9XCJiYWNrZ3JvdW5kOnRyYW5zcGFyZW50O2NvbG9yOiNmZmY7Ym9yZGVyOjFweCBzb2xpZCByZ2JhKDI1NSwyNTUsMjU1LC40KTtib3JkZXItcmFkaXVzOjZweDtwYWRkaW5nOjZweCAxMHB4O2N1cnNvcjpwb2ludGVyO2ZvbnQtd2VpZ2h0OjcwMFwiPkNlcnJhcjwvYnV0dG9uPicgK1xuICAgICc8L2Rpdj4nO1xuICAvLyB2MTExMTogdGFiIFwiTGVnYWN5ICg2bSlcIiBlbGltaW5hZGEgXHUyMDE0IGVsIHBpcGVsaW5lIHZpZWpvIChTS1UgKyA2IGNvbHVtbmFzXG4gIC8vIHZzIHNrdV92ZW50YXNfc25hcHNob3QgKyBwb2xcdTAwRUR0aWNhIDNtKSBmdWUgcmVlbXBsYXphZG8gcG9yIGxhIHRhYmxhXG4gIC8vIFJlY29tZW5kYWNpXHUwMEYzbiBkZSBDb21wcmEgKHYxMTA5LCBGM0EpIHF1ZSB1c2EgZGF0b3MgbVx1MDBFMXMgY29tcGxldG9zLlxuICBjb25zdCB0YWJzQmFyID1cbiAgICAnPGRpdiBpZD1cImZvcmVjYXN0LXRhYnMtYmFyXCIgc3R5bGU9XCJkaXNwbGF5OmZsZXg7Z2FwOjA7YmFja2dyb3VuZDp2YXIoLS1iZy1zZWNvbmRhcnkpO3BhZGRpbmc6MCAxOHB4O2JvcmRlci1ib3R0b206MXB4IHNvbGlkIHZhcigtLWJvcmRlci1zdWJ0bGUpXCI+JyArXG4gICAgJzxidXR0b24gZGF0YS10YWI9XCJzYWxlcy1wbGFuc1wiIG9uY2xpY2s9XCJzd2l0Y2hGb3JlY2FzdFRhYihcXCdzYWxlcy1wbGFuc1xcJylcIiBjbGFzcz1cImZvcmVjYXN0LXRhYlwiIHN0eWxlPVwicGFkZGluZzoxMHB4IDE2cHg7YmFja2dyb3VuZDp0cmFuc3BhcmVudDtjb2xvcjp2YXIoLS10ZXh0LXByaW1hcnkpO2JvcmRlcjpub25lO2JvcmRlci1ib3R0b206M3B4IHNvbGlkICMwZDk0ODg7Y3Vyc29yOnBvaW50ZXI7Zm9udC13ZWlnaHQ6NzAwO2ZvbnQtc2l6ZToxMnB4O2xldHRlci1zcGFjaW5nOi40cHg7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlXCI+U2FsZXMgUGxhbnM8L2J1dHRvbj4nICtcbiAgICAnPGJ1dHRvbiBkYXRhLXRhYj1cInN0YXRcIiBvbmNsaWNrPVwic3dpdGNoRm9yZWNhc3RUYWIoXFwnc3RhdFxcJylcIiBjbGFzcz1cImZvcmVjYXN0LXRhYlwiIHN0eWxlPVwicGFkZGluZzoxMHB4IDE2cHg7YmFja2dyb3VuZDp0cmFuc3BhcmVudDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTtib3JkZXI6bm9uZTtib3JkZXItYm90dG9tOjNweCBzb2xpZCB0cmFuc3BhcmVudDtjdXJzb3I6cG9pbnRlcjtmb250LXdlaWdodDo2MDA7Zm9udC1zaXplOjEycHg7bGV0dGVyLXNwYWNpbmc6LjRweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2VcIj5Gb3JlY2FzdCBFc3RhZFx1MDBFRHN0aWNvPC9idXR0b24+JyArXG4gICAgJzwvZGl2Pic7XG4gIGNvbnN0IHRhYlNhbGVzUGxhbnMgPSAnPGRpdiBpZD1cImZvcmVjYXN0LXRhYi1zYWxlcy1wbGFuc1wiIHN0eWxlPVwiZmxleDoxO292ZXJmbG93OmF1dG9cIj48L2Rpdj4nO1xuICBjb25zdCB0YWJTdGF0ID0gJzxkaXYgaWQ9XCJmb3JlY2FzdC10YWItc3RhdFwiIHN0eWxlPVwiZmxleDoxO292ZXJmbG93OmF1dG87ZGlzcGxheTpub25lXCI+PC9kaXY+JztcbiAgcmV0dXJuIG1vZGFsT3V0ZXIgKyBoZWFkZXIgKyB0YWJzQmFyICsgdGFiU2FsZXNQbGFucyArIHRhYlN0YXQgKyAnPC9kaXY+Jztcbn1cblxuLy8gdjEwOTgrIEZhc2UgMSArIHYxMTAzKyBGYXNlIDJCICsgdjExMDUgZml4ICsgdjExMTEgY2xlYW4gbGVnYWN5OiBzd2l0Y2hcbi8vIGVudHJlIHRhYnMgU2FsZXMgUGxhbnMgLyBGb3JlY2FzdCBFc3RhZFx1MDBFRHN0aWNvLlxud2luZG93LnN3aXRjaEZvcmVjYXN0VGFiID0gZnVuY3Rpb24gKHRhYklkKSB7XG4gIF9mb3JlY2FzdEFjdGl2ZVRhYiA9IHRhYklkO1xuICBjb25zdCBzcCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdmb3JlY2FzdC10YWItc2FsZXMtcGxhbnMnKTtcbiAgY29uc3Qgc3QgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZm9yZWNhc3QtdGFiLXN0YXQnKTtcbiAgaWYgKHNwKSBzcC5zdHlsZS5kaXNwbGF5ID0gdGFiSWQgPT09ICdzYWxlcy1wbGFucycgPyAnYmxvY2snIDogJ25vbmUnO1xuICBpZiAoc3QpIHN0LnN0eWxlLmRpc3BsYXkgPSB0YWJJZCA9PT0gJ3N0YXQnID8gJ2Jsb2NrJyA6ICdub25lJztcbiAgY29uc3QgYnRucyA9IGRvY3VtZW50LnF1ZXJ5U2VsZWN0b3JBbGwoJyNmb3JlY2FzdC10YWJzLWJhciAuZm9yZWNhc3QtdGFiJyk7XG4gIGJ0bnMuZm9yRWFjaCgoYikgPT4ge1xuICAgIGNvbnN0IGFjdGl2ZSA9IGIuZ2V0QXR0cmlidXRlKCdkYXRhLXRhYicpID09PSB0YWJJZDtcbiAgICBiLnN0eWxlLmNvbG9yID0gYWN0aXZlID8gJ3ZhcigtLXRleHQtcHJpbWFyeSknIDogJ3ZhcigtLXRleHQtbXV0ZWQpJztcbiAgICBiLnN0eWxlLmJvcmRlckJvdHRvbUNvbG9yID0gYWN0aXZlID8gJyMwZDk0ODgnIDogJ3RyYW5zcGFyZW50JztcbiAgICBiLnN0eWxlLmZvbnRXZWlnaHQgPSBhY3RpdmUgPyAnNzAwJyA6ICc2MDAnO1xuICB9KTtcbiAgLy8gdjExMDUgZml4OiBhbCBhY3RpdmFyIGxhIHRhYiBzdGF0LCBtb3N0cmFyIHBsYWNlaG9sZGVyIGlubWVkaWF0byBwYXJhXG4gIC8vIHF1ZSBzZSB2ZWEgYWxnbyBtaWVudHJhcyBjYXJnYSAobyBzaSBlbCBsb2FkIHlhIHRlcm1pbm8sIHJlLXJlbmRlcikuXG4gIGlmICh0YWJJZCA9PT0gJ3N0YXQnKSB7XG4gICAgY29uc3QgY29udCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdmb3JlY2FzdC10YWItc3RhdCcpO1xuICAgIGlmIChjb250KSB7XG4gICAgICBpZiAoX2ZvcmVjYXN0U3RhdERvY3MpIHtcbiAgICAgICAgLy8gWWEgY2FyZ2FkbzogcmUtcmVuZGVyIChwb3Igc2kgZWwgdXNlciB2aWVuZSBkZSBvdHJhIHRhYikuXG4gICAgICAgIF9yZW5kZXJGb3JlY2FzdFN0YXRUYWIoKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIC8vIEFcdTAwRkFuIG5vIGNhcmdhZG86IHBsYWNlaG9sZGVyICsgbG9hZC5cbiAgICAgICAgY29udC5pbm5lckhUTUwgPVxuICAgICAgICAgICc8ZGl2IHN0eWxlPVwicGFkZGluZzo2MHB4IDIwcHg7dGV4dC1hbGlnbjpjZW50ZXI7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7Zm9udC1zaXplOjE0cHhcIj4nICtcbiAgICAgICAgICAnPGRpdiBzdHlsZT1cImRpc3BsYXk6aW5saW5lLWJsb2NrO3dpZHRoOjI0cHg7aGVpZ2h0OjI0cHg7Ym9yZGVyOjNweCBzb2xpZCAjMGQ5NDg4O2JvcmRlci10b3AtY29sb3I6dHJhbnNwYXJlbnQ7Ym9yZGVyLXJhZGl1czo1MCU7YW5pbWF0aW9uOnNwaW4gMC44cyBsaW5lYXIgaW5maW5pdGU7bWFyZ2luLWJvdHRvbToxMnB4XCI+PC9kaXY+JyArXG4gICAgICAgICAgJzxkaXY+Q2FyZ2FuZG8gZm9yZWNhc3Rfb3V0cHV0IGRlc2RlIEZpcmVzdG9yZS4uLjwvZGl2PicgK1xuICAgICAgICAgICc8c3R5bGU+QGtleWZyYW1lcyBzcGlue3Rve3RyYW5zZm9ybTpyb3RhdGUoMzYwZGVnKX19PC9zdHlsZT4nICtcbiAgICAgICAgICAnPC9kaXY+JztcbiAgICAgICAgX2xvYWRGb3JlY2FzdE91dHB1dCgpXG4gICAgICAgICAgLnRoZW4oX3JlbmRlckZvcmVjYXN0U3RhdFRhYilcbiAgICAgICAgICAuY2F0Y2goKGUpID0+IHtcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ1tGT1JFQ0FTVCBzdGF0XSBsb2FkIGZhaWwnLCBlKTtcbiAgICAgICAgICAgIGNvbnN0IGMgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZm9yZWNhc3QtdGFiLXN0YXQnKTtcbiAgICAgICAgICAgIGlmIChjKSB7XG4gICAgICAgICAgICAgIGMuaW5uZXJIVE1MID1cbiAgICAgICAgICAgICAgICAnPGRpdiBzdHlsZT1cInBhZGRpbmc6NjBweCAyMHB4O3RleHQtYWxpZ246Y2VudGVyO2NvbG9yOiNkYzI2MjY7bGluZS1oZWlnaHQ6MS42XCI+JyArXG4gICAgICAgICAgICAgICAgJzxkaXYgc3R5bGU9XCJmb250LXNpemU6MTZweDtmb250LXdlaWdodDo3MDA7bWFyZ2luLWJvdHRvbToxMnB4XCI+RXJyb3IgY2FyZ2FuZG8gZm9yZWNhc3Rfb3V0cHV0PC9kaXY+JyArXG4gICAgICAgICAgICAgICAgJzxkaXYgc3R5bGU9XCJmb250LXNpemU6MTJweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTttYXJnaW4tYm90dG9tOjE2cHhcIj4nICtcbiAgICAgICAgICAgICAgICBlc2NhcGVIdG1sU2FmZShlLm1lc3NhZ2UgfHwgU3RyaW5nKGUpKSArXG4gICAgICAgICAgICAgICAgJzwvZGl2PicgK1xuICAgICAgICAgICAgICAgICc8YnV0dG9uIG9uY2xpY2s9XCJzd2l0Y2hGb3JlY2FzdFRhYihcXCdzdGF0XFwnKVwiIHN0eWxlPVwicGFkZGluZzo4cHggMTRweDtiYWNrZ3JvdW5kOiMwZDk0ODg7Y29sb3I6I2ZmZjtib3JkZXI6bm9uZTtib3JkZXItcmFkaXVzOjZweDtmb250LXdlaWdodDo3MDA7Y3Vyc29yOnBvaW50ZXJcIj5SZWludGVudGFyPC9idXR0b24+JyArXG4gICAgICAgICAgICAgICAgJzwvZGl2Pic7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfSk7XG4gICAgICB9XG4gICAgfVxuICB9XG59O1xuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIEZBU0UgMSBcdTIwMTQgU2FsZXMgUGxhbnMgdXBsb2FkIChSb2RzIC8gUmVlbHMgLyBGRylcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5mdW5jdGlvbiBfeWVhck1vbnRoTm93KCkge1xuICBjb25zdCBkID0gbmV3IERhdGUoKTtcbiAgcmV0dXJuIGQuZ2V0RnVsbFllYXIoKSArICctJyArIFN0cmluZyhkLmdldE1vbnRoKCkgKyAxKS5wYWRTdGFydCgyLCAnMCcpO1xufVxuXG5mdW5jdGlvbiBfZm10U2l6ZShieXRlcykge1xuICBpZiAoIWJ5dGVzKSByZXR1cm4gJyc7XG4gIGlmIChieXRlcyA8IDEwMjQpIHJldHVybiBieXRlcyArICcgQic7XG4gIGlmIChieXRlcyA8IDEwMjQgKiAxMDI0KSByZXR1cm4gKGJ5dGVzIC8gMTAyNCkudG9GaXhlZCgxKSArICcgS0InO1xuICByZXR1cm4gKGJ5dGVzIC8gKDEwMjQgKiAxMDI0KSkudG9GaXhlZCgyKSArICcgTUInO1xufVxuXG5mdW5jdGlvbiBfZm10RGF0ZVNob3J0KGlzbykge1xuICBpZiAoIWlzbykgcmV0dXJuICdcdTIwMTQnO1xuICB0cnkge1xuICAgIGNvbnN0IGQgPSBpc28udG9EYXRlID8gaXNvLnRvRGF0ZSgpIDogbmV3IERhdGUoaXNvKTtcbiAgICByZXR1cm4gKFxuICAgICAgZC50b0xvY2FsZURhdGVTdHJpbmcoJ2VzLUFSJywgeyBkYXk6ICcyLWRpZ2l0JywgbW9udGg6ICdzaG9ydCcsIHllYXI6ICcyLWRpZ2l0JyB9KSArXG4gICAgICAnICcgK1xuICAgICAgZC50b0xvY2FsZVRpbWVTdHJpbmcoJ2VzLUFSJywgeyBob3VyOiAnMi1kaWdpdCcsIG1pbnV0ZTogJzItZGlnaXQnIH0pXG4gICAgKTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIFN0cmluZyhpc28pO1xuICB9XG59XG5cbmFzeW5jIGZ1bmN0aW9uIF9sb2FkU2FsZXNQbGFuQ2FjaGVzKCkge1xuICBpZiAoIXdpbmRvdy5mYkRiKSByZXR1cm47XG4gIGF3YWl0IFByb21pc2UuYWxsKFxuICAgIFNBTEVTX1BMQU5fRkFNSUxJQVMubWFwKGFzeW5jIChmKSA9PiB7XG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCBkb2MgPSBhd2FpdCB3aW5kb3cuZmJEYi5jb2xsZWN0aW9uKCdzYWxlc19wbGFuX2NhY2hlJykuZG9jKGYua2V5KS5nZXQoKTtcbiAgICAgICAgX3NhbGVzUGxhbkNhY2hlc1tmLmtleV0gPSBkb2MuZXhpc3RzID8gZG9jLmRhdGEoKSA6IG51bGw7XG4gICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgIGNvbnNvbGUud2FybignW0ZPUkVDQVNUXSBsb2FkIHNhbGVzX3BsYW5fY2FjaGUvJyArIGYua2V5ICsgJyBmYWlsOicsIGUgJiYgZS5tZXNzYWdlKTtcbiAgICAgICAgX3NhbGVzUGxhbkNhY2hlc1tmLmtleV0gPSBudWxsO1xuICAgICAgfVxuICAgIH0pXG4gICk7XG59XG5cbmZ1bmN0aW9uIGVzY2FwZUh0bWxTYWZlKHMpIHtcbiAgaWYgKHR5cGVvZiB3aW5kb3cuZXNjYXBlSHRtbCA9PT0gJ2Z1bmN0aW9uJykgcmV0dXJuIHdpbmRvdy5lc2NhcGVIdG1sKHMpO1xuICByZXR1cm4gU3RyaW5nKHMgPT0gbnVsbCA/ICcnIDogcykucmVwbGFjZShcbiAgICAvWyY8PlwiJ10vZyxcbiAgICAoY2gpID0+ICh7ICcmJzogJyZhbXA7JywgJzwnOiAnJmx0OycsICc+JzogJyZndDsnLCAnXCInOiAnJnF1b3Q7JywgXCInXCI6ICcmIzM5OycgfSlbY2hdXG4gICk7XG59XG5cbmZ1bmN0aW9uIF9idWlsZFNhbGVzUGxhblNsb3RIdG1sKGYpIHtcbiAgY29uc3QgY2FjaGUgPSBfc2FsZXNQbGFuQ2FjaGVzW2Yua2V5XTtcbiAgY29uc3Qgcm93c0NvdW50ID0gY2FjaGUgJiYgTnVtYmVyLmlzRmluaXRlKGNhY2hlLnJvd3NDb3VudCkgPyBjYWNoZS5yb3dzQ291bnQgOiAwO1xuICBjb25zdCBtb250aHNDb3VudCA9XG4gICAgY2FjaGUgJiYgQXJyYXkuaXNBcnJheShjYWNoZS5kZXRlY3RlZE1vbnRocykgPyBjYWNoZS5kZXRlY3RlZE1vbnRocy5sZW5ndGggOiAwO1xuICBjb25zdCBwYXJzZWRBdCA9IGNhY2hlICYmIGNhY2hlLnBhcnNlZEF0ID8gX2ZtdERhdGVTaG9ydChjYWNoZS5wYXJzZWRBdCkgOiAnJztcbiAgY29uc3QgdXBsb2FkZWRCeSA9IGNhY2hlICYmIGNhY2hlLnVwbG9hZGVkQnkgPyBjYWNoZS51cGxvYWRlZEJ5IDogJyc7XG4gIGNvbnN0IHNvdXJjZUZpbGVuYW1lID0gY2FjaGUgJiYgY2FjaGUuc291cmNlRmlsZW5hbWUgPyBjYWNoZS5zb3VyY2VGaWxlbmFtZSA6ICcnO1xuICBjb25zdCB5ZWFyTW9udGggPSBjYWNoZSAmJiBjYWNoZS55ZWFyTW9udGggPyBjYWNoZS55ZWFyTW9udGggOiAnJztcbiAgY29uc3QgbW9udGhzUmFuZ2UgPVxuICAgIGNhY2hlICYmIGNhY2hlLmRldGVjdGVkTW9udGhzICYmIGNhY2hlLmRldGVjdGVkTW9udGhzLmxlbmd0aFxuICAgICAgPyBjYWNoZS5kZXRlY3RlZE1vbnRoc1swXSArICcgXHUyMTkyICcgKyBjYWNoZS5kZXRlY3RlZE1vbnRoc1tjYWNoZS5kZXRlY3RlZE1vbnRocy5sZW5ndGggLSAxXVxuICAgICAgOiAnXHUyMDE0JztcbiAgY29uc3QgaGFzQ2FjaGUgPSAhIWNhY2hlO1xuICBjb25zdCBiYWRnZSA9IGhhc0NhY2hlXG4gICAgPyAnPGRpdiBzdHlsZT1cInBhZGRpbmc6NHB4IDhweDtiYWNrZ3JvdW5kOiMxNmEzNGE7Y29sb3I6I2ZmZjtib3JkZXItcmFkaXVzOjEycHg7Zm9udC1zaXplOjEwcHg7Zm9udC13ZWlnaHQ6NzAwO2xldHRlci1zcGFjaW5nOi40cHhcIj5DQVJHQURPPC9kaXY+J1xuICAgIDogJzxkaXYgc3R5bGU9XCJwYWRkaW5nOjRweCA4cHg7YmFja2dyb3VuZDojZGMyNjI2O2NvbG9yOiNmZmY7Ym9yZGVyLXJhZGl1czoxMnB4O2ZvbnQtc2l6ZToxMHB4O2ZvbnQtd2VpZ2h0OjcwMDtsZXR0ZXItc3BhY2luZzouNHB4XCI+RkFMVEE8L2Rpdj4nO1xuICBjb25zdCBtZXRhQmxvY2sgPSBoYXNDYWNoZVxuICAgID8gJzxkaXYgc3R5bGU9XCJkaXNwbGF5OmdyaWQ7Z3JpZC10ZW1wbGF0ZS1jb2x1bW5zOmF1dG8gMWZyO2dhcDo2cHggMTJweDtmb250LXNpemU6MTFweDtwYWRkaW5nOjEwcHggMTJweDtiYWNrZ3JvdW5kOnZhcigtLWJnLXNlY29uZGFyeSk7Ym9yZGVyLXJhZGl1czo2cHhcIj4nICtcbiAgICAgICc8ZGl2IHN0eWxlPVwiY29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7Zm9udC13ZWlnaHQ6NjAwXCI+QXJjaGl2bzwvZGl2PjxkaXYgc3R5bGU9XCJjb2xvcjp2YXIoLS10ZXh0LXByaW1hcnkpO2ZvbnQtZmFtaWx5Om1vbm9zcGFjZTt3b3JkLWJyZWFrOmJyZWFrLWFsbFwiPicgK1xuICAgICAgZXNjYXBlSHRtbFNhZmUoc291cmNlRmlsZW5hbWUpICtcbiAgICAgICc8L2Rpdj4nICtcbiAgICAgICc8ZGl2IHN0eWxlPVwiY29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7Zm9udC13ZWlnaHQ6NjAwXCI+U3ViaWRvPC9kaXY+PGRpdiBzdHlsZT1cImNvbG9yOnZhcigtLXRleHQtcHJpbWFyeSlcIj4nICtcbiAgICAgIGVzY2FwZUh0bWxTYWZlKHBhcnNlZEF0KSArXG4gICAgICAnPC9kaXY+JyArXG4gICAgICAnPGRpdiBzdHlsZT1cImNvbG9yOnZhcigtLXRleHQtbXV0ZWQpO2ZvbnQtd2VpZ2h0OjYwMFwiPlBvcjwvZGl2PjxkaXYgc3R5bGU9XCJjb2xvcjp2YXIoLS10ZXh0LXByaW1hcnkpXCI+JyArXG4gICAgICBlc2NhcGVIdG1sU2FmZSh1cGxvYWRlZEJ5KSArXG4gICAgICAnPC9kaXY+JyArXG4gICAgICAnPGRpdiBzdHlsZT1cImNvbG9yOnZhcigtLXRleHQtbXV0ZWQpO2ZvbnQtd2VpZ2h0OjYwMFwiPlNuYXBzaG90PC9kaXY+PGRpdiBzdHlsZT1cImNvbG9yOnZhcigtLXRleHQtcHJpbWFyeSk7Zm9udC1mYW1pbHk6bW9ub3NwYWNlXCI+JyArXG4gICAgICBlc2NhcGVIdG1sU2FmZSh5ZWFyTW9udGgpICtcbiAgICAgICc8L2Rpdj4nICtcbiAgICAgICc8ZGl2IHN0eWxlPVwiY29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7Zm9udC13ZWlnaHQ6NjAwXCI+U0tVczwvZGl2PjxkaXYgc3R5bGU9XCJjb2xvcjp2YXIoLS10ZXh0LXByaW1hcnkpO2ZvbnQtd2VpZ2h0OjcwMFwiPicgK1xuICAgICAgcm93c0NvdW50LnRvTG9jYWxlU3RyaW5nKCdlcy1BUicpICtcbiAgICAgICc8L2Rpdj4nICtcbiAgICAgICc8ZGl2IHN0eWxlPVwiY29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7Zm9udC13ZWlnaHQ6NjAwXCI+TWVzZXM8L2Rpdj48ZGl2IHN0eWxlPVwiY29sb3I6dmFyKC0tdGV4dC1wcmltYXJ5KTtmb250LXdlaWdodDo3MDBcIj4nICtcbiAgICAgIG1vbnRoc0NvdW50ICtcbiAgICAgICcgPHNwYW4gc3R5bGU9XCJjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTtmb250LXdlaWdodDo0MDBcIj4oJyArXG4gICAgICBlc2NhcGVIdG1sU2FmZShtb250aHNSYW5nZSkgK1xuICAgICAgJyk8L3NwYW4+PC9kaXY+JyArXG4gICAgICAnPC9kaXY+J1xuICAgIDogJzxkaXYgc3R5bGU9XCJwYWRkaW5nOjE0cHg7dGV4dC1hbGlnbjpjZW50ZXI7Zm9udC1zaXplOjEycHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7YmFja2dyb3VuZDp2YXIoLS1iZy1zZWNvbmRhcnkpO2JvcmRlci1yYWRpdXM6NnB4O2JvcmRlcjoxcHggZGFzaGVkIHZhcigtLWJvcmRlci1zdWJ0bGUpXCI+QXVuIG5vIHN1YmlzdGUgZWwgU2FsZXMgUGxhbiBkZSBlc3RhIGZhbWlsaWEuPC9kaXY+JztcbiAgY29uc3QgdXBsb2FkQnRuID1cbiAgICAnPGxhYmVsIHN0eWxlPVwiZGlzcGxheTppbmxpbmUtZmxleDthbGlnbi1pdGVtczpjZW50ZXI7anVzdGlmeS1jb250ZW50OmNlbnRlcjtnYXA6OHB4O3BhZGRpbmc6MTBweCAxNHB4O2JhY2tncm91bmQ6JyArXG4gICAgZi5jb2xvciArXG4gICAgJztjb2xvcjojZmZmO2JvcmRlci1yYWRpdXM6NnB4O2ZvbnQtd2VpZ2h0OjcwMDtmb250LXNpemU6MTJweDtjdXJzb3I6cG9pbnRlcjtsZXR0ZXItc3BhY2luZzouNHB4XCI+JyArXG4gICAgJzxzcGFuPicgK1xuICAgIChoYXNDYWNoZSA/ICdcdTIxQkIgUmVlbXBsYXphciBFeGNlbCcgOiAnXHUyQjA2IENhcmdhciBFeGNlbCcpICtcbiAgICAnPC9zcGFuPicgK1xuICAgICc8aW5wdXQgdHlwZT1cImZpbGVcIiBhY2NlcHQ9XCIueGxzeCwueGxzXCIgZGF0YS1mYW1pbGlhPVwiJyArXG4gICAgZi5rZXkgK1xuICAgICdcIiBzdHlsZT1cImRpc3BsYXk6bm9uZVwiIG9uY2hhbmdlPVwib25TYWxlc1BsYW5GaWxlRm9yRmFtaWxpYShldmVudCwgXFwnJyArXG4gICAgZi5rZXkgK1xuICAgICdcXCcpXCIvPicgK1xuICAgICc8L2xhYmVsPic7XG4gIGNvbnN0IGNhcmRIZWFkID1cbiAgICAnPGRpdiBzdHlsZT1cImRpc3BsYXk6ZmxleDthbGlnbi1pdGVtczpjZW50ZXI7Z2FwOjEwcHhcIj4nICtcbiAgICAnPGRpdiBzdHlsZT1cIndpZHRoOjEycHg7aGVpZ2h0OjMycHg7YmFja2dyb3VuZDonICtcbiAgICBmLmNvbG9yICtcbiAgICAnO2JvcmRlci1yYWRpdXM6M3B4XCI+PC9kaXY+JyArXG4gICAgJzxkaXYgc3R5bGU9XCJmbGV4OjFcIj48ZGl2IHN0eWxlPVwiZm9udC1zaXplOjE0cHg7Zm9udC13ZWlnaHQ6ODAwO2NvbG9yOnZhcigtLXRleHQtcHJpbWFyeSlcIj4nICtcbiAgICBlc2NhcGVIdG1sU2FmZShmLmxhYmVsKSArXG4gICAgJzwvZGl2PicgK1xuICAgICc8ZGl2IHN0eWxlPVwiZm9udC1zaXplOjExcHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7bWFyZ2luLXRvcDoycHhcIj5TYWxlcyBQbGFuIG1lbnN1YWwgXHUwMEI3IEhvamEgU0FSPC9kaXY+PC9kaXY+JyArXG4gICAgYmFkZ2UgK1xuICAgICc8L2Rpdj4nO1xuICByZXR1cm4gKFxuICAgICc8ZGl2IHN0eWxlPVwiYmFja2dyb3VuZDp2YXIoLS1iZy1lbGV2YXRlZCk7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1ib3JkZXItc3VidGxlKTtib3JkZXItcmFkaXVzOjEwcHg7cGFkZGluZzoxNnB4O2Rpc3BsYXk6ZmxleDtmbGV4LWRpcmVjdGlvbjpjb2x1bW47Z2FwOjEycHhcIj4nICtcbiAgICBjYXJkSGVhZCArXG4gICAgbWV0YUJsb2NrICtcbiAgICB1cGxvYWRCdG4gK1xuICAgICc8ZGl2IGlkPVwic2FsZXMtcGxhbi1zdGF0dXMtJyArXG4gICAgZi5rZXkgK1xuICAgICdcIiBzdHlsZT1cImZvbnQtc2l6ZToxMXB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO21pbi1oZWlnaHQ6MTRweFwiPjwvZGl2PicgK1xuICAgICc8L2Rpdj4nXG4gICk7XG59XG5cbmZ1bmN0aW9uIF9yZW5kZXJTYWxlc1BsYW5zVGFiKCkge1xuICBjb25zdCBjb250ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2ZvcmVjYXN0LXRhYi1zYWxlcy1wbGFucycpO1xuICBpZiAoIWNvbnQpIHJldHVybjtcbiAgY29uc3Qgc2xvdHMgPSBTQUxFU19QTEFOX0ZBTUlMSUFTLm1hcChfYnVpbGRTYWxlc1BsYW5TbG90SHRtbCkuam9pbignJyk7XG4gIGNvbnN0IGludHJvID1cbiAgICAnPGRpdiBzdHlsZT1cIm1hcmdpbi1ib3R0b206MTZweDtwYWRkaW5nOjEycHggMTRweDtiYWNrZ3JvdW5kOnZhcigtLWJnLXNlY29uZGFyeSk7Ym9yZGVyLWxlZnQ6M3B4IHNvbGlkICMwZDk0ODg7Ym9yZGVyLXJhZGl1czo2cHg7Zm9udC1zaXplOjEycHg7Y29sb3I6dmFyKC0tdGV4dC1zZWNvbmRhcnkpO2xpbmUtaGVpZ2h0OjEuNVwiPicgK1xuICAgICc8YiBzdHlsZT1cImNvbG9yOnZhcigtLXRleHQtcHJpbWFyeSlcIj5GYXNlIDE8L2I+IFx1MjAxNCBDYXJnXHUwMEUxIGxvcyBTYWxlcyBQbGFucyBtZW5zdWFsZXMgKFJvZHMgLyBSZWVscykuIFNlIHBhcnNlYSBsYSBob2phIDxiPlNBUjwvYj46IFNLVSwgTU9RIDEyIG1vbnRocywgeSB1bmEgY29sdW1uYSBwb3IgbWVzLiAnICtcbiAgICAnRWwgRXhjZWwgb3JpZ2luYWwgcXVlZGEgc25hcHNob3RhZG8gZW4gU3RvcmFnZSB5IGVsIHBhcnNlbyBxdWVkYSBlbiBGaXJlc3RvcmUgcGFyYSBlbCBjXHUwMEUxbGN1bG8gZGViYWpvLicgK1xuICAgICc8L2Rpdj4nO1xuICBjb25zdCBncmlkID1cbiAgICAnPGRpdiBzdHlsZT1cImRpc3BsYXk6Z3JpZDtncmlkLXRlbXBsYXRlLWNvbHVtbnM6cmVwZWF0KGF1dG8tZml0LG1pbm1heCgzMjBweCwxZnIpKTtnYXA6MTZweDttYXJnaW4tYm90dG9tOjI0cHhcIj4nICtcbiAgICBzbG90cyArXG4gICAgJzwvZGl2Pic7XG4gIC8vIHYxMTA5OiBjb250ZW5lZG9yIHBhcmEgdGFibGEgUmVjb21lbmRhY2lcdTAwRjNuIGRlIENvbXByYS4gU2UgcmVsbGVuYSBvbi1kZW1hbmRcbiAgLy8gdmlhIF9yZW5kZXJSZWNvU2VjdGlvbigpIChsYXp5IGxvYWQgZGUgc3RvY2tfc25hcHNob3QgKyBza3VfdmVudGFzX3NuYXBzaG90KS5cbiAgY29uc3QgcmVjb1NlY3Rpb24gPSAnPGRpdiBpZD1cInJlY28tc2VjdGlvbi1jb250YWluZXJcIj48L2Rpdj4nO1xuICBjb250LmlubmVySFRNTCA9ICc8ZGl2IHN0eWxlPVwicGFkZGluZzoxOHB4XCI+JyArIGludHJvICsgZ3JpZCArIHJlY29TZWN0aW9uICsgJzwvZGl2Pic7XG4gIF9yZW5kZXJSZWNvU2VjdGlvbigpO1xufVxuXG53aW5kb3cub25TYWxlc1BsYW5GaWxlRm9yRmFtaWxpYSA9IGFzeW5jIGZ1bmN0aW9uIChldmVudCwgZmFtaWxpYSkge1xuICBjb25zdCBmaWxlID0gZXZlbnQgJiYgZXZlbnQudGFyZ2V0ICYmIGV2ZW50LnRhcmdldC5maWxlcyAmJiBldmVudC50YXJnZXQuZmlsZXNbMF07XG4gIGlmICghZmlsZSkgcmV0dXJuO1xuICBjb25zdCBzdGF0dXNFbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdzYWxlcy1wbGFuLXN0YXR1cy0nICsgZmFtaWxpYSk7XG4gIGNvbnN0IHNldFN0YXR1cyA9IChtc2csIGNvbG9yKSA9PiB7XG4gICAgaWYgKCFzdGF0dXNFbCkgcmV0dXJuO1xuICAgIHN0YXR1c0VsLnRleHRDb250ZW50ID0gbXNnO1xuICAgIHN0YXR1c0VsLnN0eWxlLmNvbG9yID0gY29sb3IgfHwgJ3ZhcigtLXRleHQtbXV0ZWQpJztcbiAgfTtcbiAgdHJ5IHtcbiAgICBpZiAodHlwZW9mIFhMU1ggPT09ICd1bmRlZmluZWQnKSB7XG4gICAgICBhbGVydCgnU2hlZXRKUyAoWExTWCkgbm8gY2FyZ2FkbyBcdTIwMTQgcmVjYXJnXHUwMEUxIGxhIGFwcC4nKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgaWYgKCF3aW5kb3cuU2FsZXNQbGFuUGFyc2VyIHx8ICF3aW5kb3cuU2FsZXNQbGFuUGFyc2VyLnBhcnNlU2FsZXNQbGFuU2hlZXQpIHtcbiAgICAgIGFsZXJ0KCdQYXJzZXIgU2FsZXMgUGxhbiBubyBjYXJnYWRvLiBSZWJ1aWxkIGJ1bmRsZS4nKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgaWYgKCF3aW5kb3cuZmlyZWJhc2UgfHwgIXdpbmRvdy5maXJlYmFzZS5zdG9yYWdlKSB7XG4gICAgICBhbGVydCgnRmlyZWJhc2UgU3RvcmFnZSBubyBkaXNwb25pYmxlLicpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBzZXRTdGF0dXMoJ0xleWVuZG8gRXhjZWxcdTIwMjYnKTtcbiAgICBjb25zdCBidWYgPSBhd2FpdCBmaWxlLmFycmF5QnVmZmVyKCk7XG4gICAgY29uc3Qgd2IgPSBYTFNYLnJlYWQoYnVmLCB7IHR5cGU6ICdhcnJheScgfSk7XG4gICAgY29uc3Qgc2FyTmFtZSA9IHdiLlNoZWV0TmFtZXMuZmluZChcbiAgICAgIChuKSA9PlxuICAgICAgICBTdHJpbmcobiB8fCAnJylcbiAgICAgICAgICAudHJpbSgpXG4gICAgICAgICAgLnRvVXBwZXJDYXNlKCkgPT09ICdTQVInXG4gICAgKTtcbiAgICBpZiAoIXNhck5hbWUpIHtcbiAgICAgIHNldFN0YXR1cyhcbiAgICAgICAgJ1x1MjZBMCBFbCBFeGNlbCBubyB0aWVuZSBob2phIFwiU0FSXCIuIEhvamFzIGVuY29udHJhZGFzOiAnICsgd2IuU2hlZXROYW1lcy5qb2luKCcsICcpLFxuICAgICAgICAnI2RjMjYyNidcbiAgICAgICk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGNvbnN0IHNoZWV0ID0gd2IuU2hlZXRzW3Nhck5hbWVdO1xuICAgIGNvbnN0IHJvd3MgPSBYTFNYLnV0aWxzLnNoZWV0X3RvX2pzb24oc2hlZXQsIHsgaGVhZGVyOiAxLCBkZWZ2YWw6ICcnLCByYXc6IHRydWUgfSk7XG4gICAgc2V0U3RhdHVzKCdQYXJzZWFuZG8gJyArIHJvd3MubGVuZ3RoICsgJyBmaWxhcyBkZSBob2phIFwiJyArIHNhck5hbWUgKyAnXCJcdTIwMjYnKTtcbiAgICBjb25zdCBwYXJzZWQgPSB3aW5kb3cuU2FsZXNQbGFuUGFyc2VyLnBhcnNlU2FsZXNQbGFuU2hlZXQocm93cyk7XG4gICAgaWYgKCFwYXJzZWQucm93cy5sZW5ndGgpIHtcbiAgICAgIHNldFN0YXR1cygnXHUyNkEwIEV4Y2VsIHBhcnNlYWRvIHBlcm8gc2luIFNLVXMgdlx1MDBFMWxpZG9zLicsICcjZGMyNjI2Jyk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGNvbnN0IHllYXJNb250aCA9IF95ZWFyTW9udGhOb3coKTtcbiAgICBjb25zdCBzdG9yYWdlUGF0aCA9ICdmb3JlY2FzdHNfc25hcHNob3RzLycgKyB5ZWFyTW9udGggKyAnLycgKyBmYW1pbGlhICsgJy54bHN4JztcbiAgICBzZXRTdGF0dXMoJ1N1YmllbmRvIEV4Y2VsIGEgU3RvcmFnZSAoJyArIF9mbXRTaXplKGZpbGUuc2l6ZSkgKyAnKVx1MjAyNicpO1xuICAgIGNvbnN0IHN0b3JhZ2VSZWYgPSB3aW5kb3cuZmlyZWJhc2Uuc3RvcmFnZSgpLnJlZihzdG9yYWdlUGF0aCk7XG4gICAgYXdhaXQgc3RvcmFnZVJlZi5wdXQoZmlsZSwge1xuICAgICAgY29udGVudFR5cGU6IGZpbGUudHlwZSB8fCAnYXBwbGljYXRpb24vdm5kLm9wZW54bWxmb3JtYXRzLW9mZmljZWRvY3VtZW50LnNwcmVhZHNoZWV0bWwuc2hlZXQnLFxuICAgICAgY3VzdG9tTWV0YWRhdGE6IHtcbiAgICAgICAgZmFtaWxpYSxcbiAgICAgICAgdXBsb2FkZWRCeTogKHdpbmRvdy5jdXJyZW50VXNlciAmJiB3aW5kb3cuY3VycmVudFVzZXIuZW1haWwpIHx8ICcnLFxuICAgICAgICBzb3VyY2VGaWxlbmFtZTogZmlsZS5uYW1lIHx8ICcnLFxuICAgICAgfSxcbiAgICB9KTtcbiAgICBzZXRTdGF0dXMoJ0d1YXJkYW5kbyBwYXJzZW8gZW4gRmlyZXN0b3JlICgnICsgcGFyc2VkLnJvd3MubGVuZ3RoICsgJyBTS1VzKVx1MjAyNicpO1xuICAgIGNvbnN0IHVwbG9hZGVkQnkgPSAod2luZG93LmN1cnJlbnRVc2VyICYmIHdpbmRvdy5jdXJyZW50VXNlci5lbWFpbCkgfHwgJ3Vua25vd24nO1xuICAgIGNvbnN0IHBheWxvYWQgPSB7XG4gICAgICBmYW1pbGlhLFxuICAgICAgcGFyc2VkQXQ6XG4gICAgICAgIHdpbmRvdy5maXJlYmFzZSAmJiB3aW5kb3cuZmlyZWJhc2UuZmlyZXN0b3JlICYmIHdpbmRvdy5maXJlYmFzZS5maXJlc3RvcmUuRmllbGRWYWx1ZVxuICAgICAgICAgID8gd2luZG93LmZpcmViYXNlLmZpcmVzdG9yZS5GaWVsZFZhbHVlLnNlcnZlclRpbWVzdGFtcCgpXG4gICAgICAgICAgOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICB1cGxvYWRlZEJ5LFxuICAgICAgc291cmNlRmlsZW5hbWU6IGZpbGUubmFtZSB8fCAnJyxcbiAgICAgIHNvdXJjZVNoZWV0OiBzYXJOYW1lLFxuICAgICAgeWVhck1vbnRoLFxuICAgICAgc3RvcmFnZVBhdGgsXG4gICAgICByb3dzQ291bnQ6IHBhcnNlZC5yb3dzLmxlbmd0aCxcbiAgICAgIGhlYWRlclJvd0luZGV4OiBwYXJzZWQuaGVhZGVyUm93SW5kZXgsXG4gICAgICBkZXRlY3RlZE1vbnRoczogcGFyc2VkLmRldGVjdGVkTW9udGhzLFxuICAgICAgcm93czogcGFyc2VkLnJvd3MsXG4gICAgfTtcbiAgICBhd2FpdCB3aW5kb3cuZmJEYi5jb2xsZWN0aW9uKCdzYWxlc19wbGFuX2NhY2hlJykuZG9jKGZhbWlsaWEpLnNldChwYXlsb2FkKTtcbiAgICAvLyB2MTEwNyBmaXg6IGd1YXJkYXIgY2FjaGUgbG9jYWwgY29uIERhdGUgcmVhbCAobm8gZWwgU2VudGluZWxWYWx1ZSkgcGFyYVxuICAgIC8vIHF1ZSBfZm10RGF0ZVNob3J0IG5vIG11ZXN0cmUgXCJJbnZhbGlkIERhdGVcIi4gRWwgc2VydmVyIHRpZW5lIGVsIHRzIGV4YWN0byxcbiAgICAvLyBlbCBsb2NhbCBtdWVzdHJhIGVsIG1vbWVudG8gZGVsIHVwbG9hZCAoYXByb3hpbWFkbyB+MXMgZGUgZGlmZXJlbmNpYSkuXG4gICAgX3NhbGVzUGxhbkNhY2hlc1tmYW1pbGlhXSA9IE9iamVjdC5hc3NpZ24oe30sIHBheWxvYWQsIHsgcGFyc2VkQXQ6IG5ldyBEYXRlKCkgfSk7XG4gICAgc2V0U3RhdHVzKFxuICAgICAgJ1x1MjcxMyBPSy4gJyArIHBhcnNlZC5yb3dzLmxlbmd0aCArICcgU0tVcyBcdTAwRDcgJyArIHBhcnNlZC5kZXRlY3RlZE1vbnRocy5sZW5ndGggKyAnIG1lc2VzLicsXG4gICAgICAnIzE2YTM0YSdcbiAgICApO1xuICAgIF9yZW5kZXJTYWxlc1BsYW5zVGFiKCk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBjb25zb2xlLmVycm9yKCdbRk9SRUNBU1RdIHVwbG9hZCBzYWxlcyBwbGFuICcgKyBmYW1pbGlhICsgJyBmYWlsOicsIGUpO1xuICAgIHNldFN0YXR1cygnXHUyNzE3IEVycm9yOiAnICsgKChlICYmIGUubWVzc2FnZSkgfHwgZSksICcjZGMyNjI2Jyk7XG4gICAgaWYgKGUgJiYgZS5jb2RlID09PSAnTU9OVEhTX05PVF9GT1VORCcpIHtcbiAgICAgIGFsZXJ0KFxuICAgICAgICAnRWwgRXhjZWwgbm8gdGllbmUgY29sdW1uYXMgZGUgbWVzZXMgcmVjb25vY2libGVzLlxcblxcbkhlYWRlcnMgZXNwZXJhZG9zOiBcIkphbiAyMDI3XCIsIFwiTWF5IDIwMjdcIiwgXCJFbmUgMjAyN1wiLCBcIjIwMjctMDFcIiwgZXRjLlxcblxcbkRldGFsbGU6ICcgK1xuICAgICAgICAgIGUubWVzc2FnZVxuICAgICAgKTtcbiAgICB9XG4gIH0gZmluYWxseSB7XG4gICAgaWYgKGV2ZW50ICYmIGV2ZW50LnRhcmdldCkgZXZlbnQudGFyZ2V0LnZhbHVlID0gJyc7XG4gIH1cbn07XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gRjJCIFx1MjAxNCBGb3JlY2FzdCBFc3RhZFx1MDBFRHN0aWNvOiB0YWJsYSArIGRldGFsbGVcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5hc3luYyBmdW5jdGlvbiBfbG9hZEZvcmVjYXN0T3V0cHV0KCkge1xuICBpZiAoIXdpbmRvdy5mYkRiKSB0aHJvdyBuZXcgRXJyb3IoJ0ZpcmVzdG9yZSBubyBpbmljaWFsaXphZG8nKTtcbiAgY29uc29sZS5sb2coJ1tGT1JFQ0FTVCBzdGF0XSBsb2FkaW5nIGZvcmVjYXN0X291dHB1dC4uLicpO1xuICBjb25zdCBbc25hcCwgbWV0YURvY10gPSBhd2FpdCBQcm9taXNlLmFsbChbXG4gICAgd2luZG93LmZiRGIuY29sbGVjdGlvbignZm9yZWNhc3Rfb3V0cHV0JykuZ2V0KCksXG4gICAgd2luZG93LmZiRGIuY29sbGVjdGlvbignZm9yZWNhc3Rfb3V0cHV0X21ldGEnKS5kb2MoJ2N1cnJlbnQnKS5nZXQoKSxcbiAgXSk7XG4gIGNvbnN0IGRvY3MgPSBbXTtcbiAgc25hcC5mb3JFYWNoKChkKSA9PiBkb2NzLnB1c2goT2JqZWN0LmFzc2lnbih7IGlkOiBkLmlkIH0sIGQuZGF0YSgpKSkpO1xuICBkb2NzLnNvcnQoKGEsIGIpID0+IHtcbiAgICBjb25zdCB3YSA9IChhLm1ldHJpY3MgJiYgYS5tZXRyaWNzLndhcGUpIHx8IDk5OTtcbiAgICBjb25zdCB3YiA9IChiLm1ldHJpY3MgJiYgYi5tZXRyaWNzLndhcGUpIHx8IDk5OTtcbiAgICByZXR1cm4gd2EgLSB3YjtcbiAgfSk7XG4gIF9mb3JlY2FzdFN0YXREb2NzID0gZG9jcztcbiAgX2ZvcmVjYXN0U3RhdE1ldGEgPSBtZXRhRG9jLmV4aXN0cyA/IG1ldGFEb2MuZGF0YSgpIDogbnVsbDtcbiAgY29uc29sZS5sb2coJ1tGT1JFQ0FTVCBzdGF0XSBsb2FkZWQnLCBkb2NzLmxlbmd0aCwgJ2RvY3MgXHUwMEI3IG1ldGE6JywgISFfZm9yZWNhc3RTdGF0TWV0YSk7XG4gIHJldHVybiBkb2NzO1xufVxuXG5mdW5jdGlvbiBfd2FwZUJhZGdlQ29sb3Iodykge1xuICBpZiAodyA9PSBudWxsKSByZXR1cm4gJyM2NDc0OGInO1xuICBpZiAodyA8IDAuMykgcmV0dXJuICcjMTZhMzRhJzsgLy8gdmVyZGUgLSBleGNlbGVudGVcbiAgaWYgKHcgPCAwLjUpIHJldHVybiAnIzg0Y2MxNic7IC8vIGxpbWEgLSBidWVub1xuICBpZiAodyA8IDAuNykgcmV0dXJuICcjZWFiMzA4JzsgLy8gYW1hcmlsbG8gLSBhY2VwdGFibGVcbiAgaWYgKHcgPCAxLjApIHJldHVybiAnI2Y5NzMxNic7IC8vIG5hcmFuamEgLSBwb2JyZVxuICByZXR1cm4gJyNkYzI2MjYnOyAvLyByb2pvIC0gbXV5IHBvYnJlXG59XG5cbmZ1bmN0aW9uIF9mbXROdW0obikge1xuICBpZiAobiA9PSBudWxsIHx8ICFOdW1iZXIuaXNGaW5pdGUoTnVtYmVyKG4pKSkgcmV0dXJuICdcdTIwMTQnO1xuICByZXR1cm4gTnVtYmVyKG4pLnRvTG9jYWxlU3RyaW5nKCdlcy1BUicsIHsgbWF4aW11bUZyYWN0aW9uRGlnaXRzOiAwIH0pO1xufVxuXG5mdW5jdGlvbiBfZm10V2FwZSh3KSB7XG4gIGlmICh3ID09IG51bGwgfHwgIU51bWJlci5pc0Zpbml0ZShOdW1iZXIodykpKSByZXR1cm4gJ1x1MjAxNCc7XG4gIHJldHVybiAoTnVtYmVyKHcpICogMTAwKS50b0ZpeGVkKDApICsgJyUnO1xufVxuXG5mdW5jdGlvbiBfZm10RHNTaG9ydChpc28pIHtcbiAgLy8gJzIwMjYtMTAtMDEnIC0+ICdvY3QgMjYnXG4gIHRyeSB7XG4gICAgY29uc3QgW3ksIG1dID0gaXNvLnNwbGl0KCctJykubWFwKE51bWJlcik7XG4gICAgY29uc3QgbmFtZXMgPSBbXG4gICAgICAnZW5lJyxcbiAgICAgICdmZWInLFxuICAgICAgJ21hcicsXG4gICAgICAnYWJyJyxcbiAgICAgICdtYXknLFxuICAgICAgJ2p1bicsXG4gICAgICAnanVsJyxcbiAgICAgICdhZ28nLFxuICAgICAgJ3NlcCcsXG4gICAgICAnb2N0JyxcbiAgICAgICdub3YnLFxuICAgICAgJ2RpYycsXG4gICAgXTtcbiAgICByZXR1cm4gbmFtZXNbbSAtIDFdICsgJyAnICsgU3RyaW5nKHkpLnNsaWNlKC0yKTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIGlzbztcbiAgfVxufVxuXG5mdW5jdGlvbiBfcmVuZGVyRm9yZWNhc3RTdGF0VGFiKCkge1xuICBjb25zdCBjb250ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2ZvcmVjYXN0LXRhYi1zdGF0Jyk7XG4gIGlmICghY29udCkgcmV0dXJuO1xuICB0cnkge1xuICAgIF9yZW5kZXJGb3JlY2FzdFN0YXRUYWJJbXBsKGNvbnQpO1xuICB9IGNhdGNoIChlKSB7XG4gICAgY29uc29sZS5lcnJvcignW0ZPUkVDQVNUIHN0YXRdIHJlbmRlciBmYWlsJywgZSk7XG4gICAgY29udC5pbm5lckhUTUwgPVxuICAgICAgJzxkaXYgc3R5bGU9XCJwYWRkaW5nOjQwcHggMjBweDtjb2xvcjojZGMyNjI2O2xpbmUtaGVpZ2h0OjEuNlwiPicgK1xuICAgICAgJzxkaXYgc3R5bGU9XCJmb250LXNpemU6MTZweDtmb250LXdlaWdodDo3MDA7bWFyZ2luLWJvdHRvbToxMHB4XCI+RXJyb3IgcmVuZGVyaXphbmRvIHRhYiBGb3JlY2FzdCBFc3RhZFx1MDBFRHN0aWNvPC9kaXY+JyArXG4gICAgICAnPHByZSBzdHlsZT1cImZvbnQtc2l6ZToxMXB4O2JhY2tncm91bmQ6I2ZlZjJmMjtwYWRkaW5nOjEycHg7Ym9yZGVyLXJhZGl1czo2cHg7b3ZlcmZsb3c6YXV0bzt3aGl0ZS1zcGFjZTpwcmUtd3JhcFwiPicgK1xuICAgICAgZXNjYXBlSHRtbFNhZmUoZS5zdGFjayB8fCBlLm1lc3NhZ2UgfHwgU3RyaW5nKGUpKSArXG4gICAgICAnPC9wcmU+PC9kaXY+JztcbiAgfVxufVxuXG5mdW5jdGlvbiBfcmVuZGVyRm9yZWNhc3RTdGF0VGFiSW1wbChjb250KSB7XG4gIGNvbnN0IGRvY3MgPSBfZm9yZWNhc3RTdGF0RG9jcyB8fCBbXTtcbiAgY29uc3QgbWV0YSA9IF9mb3JlY2FzdFN0YXRNZXRhIHx8IHt9O1xuICBjb25zdCByZXN1bWVuID0gbWV0YS5yZXN1bWVuIHx8IHt9O1xuICBjb25zb2xlLmxvZygnW0ZPUkVDQVNUIHN0YXRdIHJlbmRlciBcdTIwMTQgZG9jczonLCBkb2NzLmxlbmd0aCwgJ21ldGE6JywgISFtZXRhLmdlbmVyYXRlZEF0KTtcbiAgaWYgKCFkb2NzLmxlbmd0aCkge1xuICAgIGNvbnQuaW5uZXJIVE1MID1cbiAgICAgICc8ZGl2IHN0eWxlPVwicGFkZGluZzo2MHB4IDIwcHg7dGV4dC1hbGlnbjpjZW50ZXI7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZClcIj4nICtcbiAgICAgICdObyBoYXkgZm9yZWNhc3Rfb3V0cHV0IHB1YmxpY2Fkby48YnI+PGJyPicgK1xuICAgICAgJ0NvcnJlciA8Y29kZT5weXRob24gc2NyaXB0cy9mb3JlY2FzdC90cmFpbl9wcm9kLnB5ICYmIHB5dGhvbiBzY3JpcHRzL2ZvcmVjYXN0L3B1Ymxpc2hfdG9fZmlyZXN0b3JlLnB5PC9jb2RlPi4nICtcbiAgICAgICc8L2Rpdj4nO1xuICAgIHJldHVybjtcbiAgfVxuICAvLyBNZXNlcyBkZWwgZm9yZWNhc3QgKGRzIGRlbCBwcmltZXIgZG9jLCBzZSBhc3VtZSBpZ3VhbCBlbiB0b2RvcykuXG4gIGNvbnN0IG1vbnRoc0lzbyA9IChkb2NzWzBdLmZvcmVjYXN0IHx8IFtdKS5tYXAoKGYpID0+IGYuZHMpO1xuICBjb25zdCBtb250aEhlYWRlcnMgPSBtb250aHNJc28ubWFwKF9mbXREc1Nob3J0KTtcblxuICAvLyBNZXRyaWNzIGNoaXAgZ2xvYmFsXG4gIGNvbnN0IGdlbmVyYXRlZCA9IG1ldGEuZ2VuZXJhdGVkQXRcbiAgICA/IG5ldyBEYXRlKG1ldGEuZ2VuZXJhdGVkQXQpLnRvTG9jYWxlU3RyaW5nKCdlcy1BUicsIHtcbiAgICAgICAgZGF5OiAnMi1kaWdpdCcsXG4gICAgICAgIG1vbnRoOiAnc2hvcnQnLFxuICAgICAgICB5ZWFyOiAnMi1kaWdpdCcsXG4gICAgICAgIGhvdXI6ICcyLWRpZ2l0JyxcbiAgICAgICAgbWludXRlOiAnMi1kaWdpdCcsXG4gICAgICB9KVxuICAgIDogJ1x1MjAxNCc7XG4gIGNvbnN0IHdhcGVNZWQgPVxuICAgIHJlc3VtZW4ud2FwZV9tZWRpYW5vX2Jlc3RfcGVyX3NlcmllcyAhPSBudWxsXG4gICAgICA/IF9mbXRXYXBlKHJlc3VtZW4ud2FwZV9tZWRpYW5vX2Jlc3RfcGVyX3NlcmllcylcbiAgICAgIDogJ1x1MjAxNCc7XG4gIGNvbnN0IG5TdWJzID0gcmVzdW1lbi5uX3N1YmZhbWlsaWFzIHx8IGRvY3MubGVuZ3RoO1xuICBjb25zdCBuTHQwNSA9XG4gICAgcmVzdW1lbi5uX3Nlcmllc193YXBlX2x0XzBfNSAhPSBudWxsID8gcmVzdW1lbi5uX3Nlcmllc193YXBlX2x0XzBfNSArICcvJyArIG5TdWJzIDogJ1x1MjAxNCc7XG4gIGNvbnN0IG5MdDAzID1cbiAgICByZXN1bWVuLm5fc2VyaWVzX3dhcGVfbHRfMF8zICE9IG51bGwgPyByZXN1bWVuLm5fc2VyaWVzX3dhcGVfbHRfMF8zICsgJy8nICsgblN1YnMgOiAnXHUyMDE0JztcblxuICBjb25zdCBiYW5uZXIgPVxuICAgICc8ZGl2IHN0eWxlPVwibWFyZ2luLWJvdHRvbToxNHB4O3BhZGRpbmc6MTJweCAxNHB4O2JhY2tncm91bmQ6dmFyKC0tYmctc2Vjb25kYXJ5KTtib3JkZXItbGVmdDozcHggc29saWQgIzBkOTQ4ODtib3JkZXItcmFkaXVzOjZweDtmb250LXNpemU6MTJweDtjb2xvcjp2YXIoLS10ZXh0LXNlY29uZGFyeSk7bGluZS1oZWlnaHQ6MS41O2Rpc3BsYXk6Z3JpZDtncmlkLXRlbXBsYXRlLWNvbHVtbnM6cmVwZWF0KGF1dG8tZml0LG1pbm1heCgxNjBweCwxZnIpKTtnYXA6MTBweFwiPicgK1xuICAgICc8ZGl2PjxkaXYgc3R5bGU9XCJmb250LXNpemU6MTBweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7bGV0dGVyLXNwYWNpbmc6LjRweFwiPldBUEUgbWVkaWFubzwvZGl2PjxkaXYgc3R5bGU9XCJmb250LXNpemU6MjBweDtmb250LXdlaWdodDo4MDA7Y29sb3I6dmFyKC0tdGV4dC1wcmltYXJ5KVwiPicgK1xuICAgIHdhcGVNZWQgK1xuICAgICc8L2Rpdj48L2Rpdj4nICtcbiAgICAnPGRpdj48ZGl2IHN0eWxlPVwiZm9udC1zaXplOjEwcHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO2xldHRlci1zcGFjaW5nOi40cHhcIj5TdWJmYW1pbGlhczwvZGl2PjxkaXYgc3R5bGU9XCJmb250LXNpemU6MjBweDtmb250LXdlaWdodDo4MDA7Y29sb3I6dmFyKC0tdGV4dC1wcmltYXJ5KVwiPicgK1xuICAgIG5TdWJzICtcbiAgICAnPC9kaXY+PC9kaXY+JyArXG4gICAgJzxkaXY+PGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMHB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtsZXR0ZXItc3BhY2luZzouNHB4XCI+V0FQRSAmbHQ7IDMwJSAoZXhjZWxlbnRlKTwvZGl2PjxkaXYgc3R5bGU9XCJmb250LXNpemU6MjBweDtmb250LXdlaWdodDo4MDA7Y29sb3I6IzE2YTM0YVwiPicgK1xuICAgIG5MdDAzICtcbiAgICAnPC9kaXY+PC9kaXY+JyArXG4gICAgJzxkaXY+PGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMHB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtsZXR0ZXItc3BhY2luZzouNHB4XCI+V0FQRSAmbHQ7IDUwJSAoYnVlbm8pPC9kaXY+PGRpdiBzdHlsZT1cImZvbnQtc2l6ZToyMHB4O2ZvbnQtd2VpZ2h0OjgwMDtjb2xvcjojODRjYzE2XCI+JyArXG4gICAgbkx0MDUgK1xuICAgICc8L2Rpdj48L2Rpdj4nICtcbiAgICAnPGRpdj48ZGl2IHN0eWxlPVwiZm9udC1zaXplOjEwcHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO2xldHRlci1zcGFjaW5nOi40cHhcIj5cdTAwREFsdGltYSBjb3JyaWRhPC9kaXY+PGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxM3B4O2ZvbnQtd2VpZ2h0OjYwMDtjb2xvcjp2YXIoLS10ZXh0LXByaW1hcnkpO21hcmdpbi10b3A6NHB4XCI+JyArXG4gICAgZXNjYXBlSHRtbFNhZmUoZ2VuZXJhdGVkKSArXG4gICAgJzwvZGl2PjwvZGl2PicgK1xuICAgICc8L2Rpdj4nO1xuXG4gIC8vIFRhYmxhIHJvd3NcbiAgY29uc3Qgcm93c0h0bWwgPSBkb2NzXG4gICAgLm1hcCgoZCkgPT4ge1xuICAgICAgY29uc3Qgd2FwZSA9IGQubWV0cmljcyAmJiBkLm1ldHJpY3Mud2FwZSAhPSBudWxsID8gZC5tZXRyaWNzLndhcGUgOiBudWxsO1xuICAgICAgY29uc3QgYmVzdE1vZGVsID0gZC5iZXN0TW9kZWwgfHwgJ1x1MjAxNCc7XG4gICAgICBjb25zdCBmb3JlY2FzdE1hcCA9IHt9O1xuICAgICAgKGQuZm9yZWNhc3QgfHwgW10pLmZvckVhY2goKGYpID0+IHtcbiAgICAgICAgZm9yZWNhc3RNYXBbZi5kc10gPSBmLnlfaGF0O1xuICAgICAgfSk7XG4gICAgICBjb25zdCBtb250aENlbGxzID0gbW9udGhzSXNvXG4gICAgICAgIC5tYXAoXG4gICAgICAgICAgKGRzKSA9PlxuICAgICAgICAgICAgJzx0ZCBzdHlsZT1cInBhZGRpbmc6OHB4IDEwcHg7dGV4dC1hbGlnbjpyaWdodDtmb250LXZhcmlhbnQtbnVtZXJpYzp0YWJ1bGFyLW51bXM7Zm9udC13ZWlnaHQ6NjAwO2NvbG9yOnZhcigtLXRleHQtcHJpbWFyeSlcIj4nICtcbiAgICAgICAgICAgIF9mbXROdW0oZm9yZWNhc3RNYXBbZHNdKSArXG4gICAgICAgICAgICAnPC90ZD4nXG4gICAgICAgIClcbiAgICAgICAgLmpvaW4oJycpO1xuICAgICAgY29uc3QgdG90YWw3ID0gKGQuZm9yZWNhc3QgfHwgW10pLnJlZHVjZSgocywgZikgPT4gcyArIChOdW1iZXIoZi55X2hhdCkgfHwgMCksIDApO1xuICAgICAgcmV0dXJuIChcbiAgICAgICAgJzx0ciBvbmNsaWNrPVwib3BlbkZvcmVjYXN0U3RhdERldGFpbChcXCcnICtcbiAgICAgICAgZXNjYXBlSHRtbFNhZmUoZC5pZCkgK1xuICAgICAgICAnXFwnKVwiIHN0eWxlPVwiY3Vyc29yOnBvaW50ZXI7Ym9yZGVyLWJvdHRvbToxcHggc29saWQgdmFyKC0tYm9yZGVyLXN1YnRsZSlcIiBvbm1vdXNlb3Zlcj1cInRoaXMuc3R5bGUuYmFja2dyb3VuZD1cXCd2YXIoLS1iZy1zZWNvbmRhcnkpXFwnXCIgb25tb3VzZW91dD1cInRoaXMuc3R5bGUuYmFja2dyb3VuZD1cXCd0cmFuc3BhcmVudFxcJ1wiPicgK1xuICAgICAgICAnPHRkIHN0eWxlPVwicGFkZGluZzo4cHggMTBweDtmb250LXdlaWdodDo3MDA7Y29sb3I6dmFyKC0tdGV4dC1wcmltYXJ5KVwiPicgK1xuICAgICAgICBlc2NhcGVIdG1sU2FmZShkLnN1YmZhbWlsaWEgfHwgZC5pZCkgK1xuICAgICAgICAnPC90ZD4nICtcbiAgICAgICAgJzx0ZCBzdHlsZT1cInBhZGRpbmc6OHB4IDEwcHg7Zm9udC1zaXplOjExcHg7Y29sb3I6dmFyKC0tdGV4dC1zZWNvbmRhcnkpXCI+JyArXG4gICAgICAgIGVzY2FwZUh0bWxTYWZlKGJlc3RNb2RlbCkgK1xuICAgICAgICAnPC90ZD4nICtcbiAgICAgICAgJzx0ZCBzdHlsZT1cInBhZGRpbmc6OHB4IDEwcHg7dGV4dC1hbGlnbjpjZW50ZXJcIj48c3BhbiBzdHlsZT1cImRpc3BsYXk6aW5saW5lLWJsb2NrO3BhZGRpbmc6M3B4IDhweDtib3JkZXItcmFkaXVzOjEycHg7YmFja2dyb3VuZDonICtcbiAgICAgICAgX3dhcGVCYWRnZUNvbG9yKHdhcGUpICtcbiAgICAgICAgJztjb2xvcjojZmZmO2ZvbnQtc2l6ZToxMXB4O2ZvbnQtd2VpZ2h0OjcwMFwiPicgK1xuICAgICAgICBfZm10V2FwZSh3YXBlKSArXG4gICAgICAgICc8L3NwYW4+PC90ZD4nICtcbiAgICAgICAgbW9udGhDZWxscyArXG4gICAgICAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjhweCAxMHB4O3RleHQtYWxpZ246cmlnaHQ7Zm9udC12YXJpYW50LW51bWVyaWM6dGFidWxhci1udW1zO2ZvbnQtd2VpZ2h0OjcwMDtjb2xvcjojMGQ5NDg4O2JhY2tncm91bmQ6dmFyKC0tYmctc2Vjb25kYXJ5KVwiPicgK1xuICAgICAgICBfZm10TnVtKHRvdGFsNykgK1xuICAgICAgICAnPC90ZD4nICtcbiAgICAgICAgJzwvdHI+J1xuICAgICAgKTtcbiAgICB9KVxuICAgIC5qb2luKCcnKTtcblxuICBjb25zdCBtb250aEhlYWRlcnNIdG1sID0gbW9udGhIZWFkZXJzXG4gICAgLm1hcChcbiAgICAgIChtKSA9PlxuICAgICAgICAnPHRoIHN0eWxlPVwicGFkZGluZzo4cHggMTBweDt0ZXh0LWFsaWduOnJpZ2h0O2ZvbnQtc2l6ZToxMHB4O3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtsZXR0ZXItc3BhY2luZzouNHB4O2NvbG9yOiM5NGEzYjhcIj4nICtcbiAgICAgICAgZXNjYXBlSHRtbFNhZmUobSkgK1xuICAgICAgICAnPC90aD4nXG4gICAgKVxuICAgIC5qb2luKCcnKTtcblxuICBjb25zdCB0YWJsZSA9XG4gICAgJzxkaXYgc3R5bGU9XCJvdmVyZmxvdzphdXRvO2JvcmRlcjoxcHggc29saWQgdmFyKC0tYm9yZGVyLXN1YnRsZSk7Ym9yZGVyLXJhZGl1czo4cHhcIj4nICtcbiAgICAnPHRhYmxlIHN0eWxlPVwid2lkdGg6MTAwJTtib3JkZXItY29sbGFwc2U6Y29sbGFwc2U7Zm9udC1zaXplOjEycHhcIj4nICtcbiAgICAnPHRoZWFkIHN0eWxlPVwiYmFja2dyb3VuZDojMGYxNzJhO2NvbG9yOiNmZmZcIj48dHI+JyArXG4gICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6OHB4IDEwcHg7dGV4dC1hbGlnbjpsZWZ0O2ZvbnQtc2l6ZToxMHB4O3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtsZXR0ZXItc3BhY2luZzouNHB4XCI+U3ViZmFtaWxpYTwvdGg+JyArXG4gICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6OHB4IDEwcHg7dGV4dC1hbGlnbjpsZWZ0O2ZvbnQtc2l6ZToxMHB4O3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtsZXR0ZXItc3BhY2luZzouNHB4XCI+TW9kZWxvPC90aD4nICtcbiAgICAnPHRoIHN0eWxlPVwicGFkZGluZzo4cHggMTBweDt0ZXh0LWFsaWduOmNlbnRlcjtmb250LXNpemU6MTBweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7bGV0dGVyLXNwYWNpbmc6LjRweFwiPldBUEU8L3RoPicgK1xuICAgIG1vbnRoSGVhZGVyc0h0bWwgK1xuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjhweCAxMHB4O3RleHQtYWxpZ246cmlnaHQ7Zm9udC1zaXplOjEwcHg7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO2xldHRlci1zcGFjaW5nOi40cHg7YmFja2dyb3VuZDojMTM0ZTRhXCI+VG90YWwgN208L3RoPicgK1xuICAgICc8L3RyPjwvdGhlYWQ+JyArXG4gICAgJzx0Ym9keT4nICtcbiAgICByb3dzSHRtbCArXG4gICAgJzwvdGJvZHk+PC90YWJsZT48L2Rpdj4nO1xuXG4gIGNvbnN0IGZvb3RlciA9XG4gICAgJzxkaXYgc3R5bGU9XCJtYXJnaW4tdG9wOjEycHg7Zm9udC1zaXplOjExcHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7bGluZS1oZWlnaHQ6MS41XCI+JyArXG4gICAgJzxiPkNcdTAwRjNtbyBsZWVyPC9iPjogV0FQRSAoV2VpZ2h0ZWQgQWJzb2x1dGUgUGVyY2VudGFnZSBFcnJvcikgbWlkZSBlbCBlcnJvciBkZWwgbW9kZWxvIHJlbGF0aXZvIGFsIHRvdGFsIHJlYWw6ICZsdDszMCUgZXhjZWxlbnRlLCAzMC01MCUgYnVlbm8sIDUwLTcwJSBhY2VwdGFibGUsICZndDs3MCUgcG9icmUuIENsaWNrIGVuIGZpbGEgcGFyYSBkZXRhbGxlICsgZ3JcdTAwRTFmaWNvLiAnICtcbiAgICAnU2UgZWxpZ2UgZWwgbW9kZWxvIGNvbiBtZW5vciBXQVBFIHBvciBzZXJpZSB0cmFzIGJhY2t0ZXN0IHJvbGxpbmctb3JpZ2luIChoPTIsIHZlbnRhbmFzPTMpLicgK1xuICAgICc8L2Rpdj4nO1xuXG4gIGNvbnQuaW5uZXJIVE1MID0gJzxkaXYgc3R5bGU9XCJwYWRkaW5nOjE4cHhcIj4nICsgYmFubmVyICsgdGFibGUgKyBmb290ZXIgKyAnPC9kaXY+Jztcbn1cblxuLy8gQ2FjaGUgaGlzdG9yaWEgYWdyZWdhZGEgcG9yIHN1YmZhbWlsaWEgKHBhcmEgZ3JcdTAwRTFmaWNvIGRldGFsbGUpLlxuYXN5bmMgZnVuY3Rpb24gX2xvYWRGb3JlY2FzdFN0YXRIaXN0b3J5KCkge1xuICBpZiAoX2ZvcmVjYXN0U3RhdEhpc3RvcnlDYWNoZSkgcmV0dXJuIF9mb3JlY2FzdFN0YXRIaXN0b3J5Q2FjaGU7XG4gIC8vIExhIGhpc3RvcmlhIHNvbG8gZXN0XHUwMEUxIGVuIEJRICh+MTAgYVx1MDBGMW9zIEJhcmFsZG8gKyAxMiBtZXNlcyBTaGltYW5vKS4gQ29tb1xuICAvLyBlbCBwaXBlbGluZSBsYSBlc2NyaWJlIGEgQ1NWIGxvY2FsLCBhY1x1MDBFMSBubyBsYSBwb2RlbW9zIGxlZXIuIEFsdGVybmF0aXZhOlxuICAvLyB1c2FyIHNrdV92ZW50YXNfc25hcHNob3QgcXVlIHRpZW5lIHZlbnRhcyBtZW5zdWFsZXMgcGVybyBzb2xvIGdydXBvIFBFU0NBLlxuICAvLyBFbiBGMkIuMiBzb2xvIG1vc3RyYW1vcyBmb3JlY2FzdCtJQyAoc2luIG92ZXJsYXkgaGlzdG9yaWEgcG9yIGFob3JhKS5cbiAgX2ZvcmVjYXN0U3RhdEhpc3RvcnlDYWNoZSA9IHt9O1xuICByZXR1cm4gX2ZvcmVjYXN0U3RhdEhpc3RvcnlDYWNoZTtcbn1cblxuZnVuY3Rpb24gX2J1aWxkRm9yZWNhc3RDaGFydFN2Zyhkb2MpIHtcbiAgY29uc3QgZmMgPSBkb2MuZm9yZWNhc3QgfHwgW107XG4gIGlmICghZmMubGVuZ3RoKVxuICAgIHJldHVybiAnPGRpdiBzdHlsZT1cInBhZGRpbmc6MzBweDt0ZXh0LWFsaWduOmNlbnRlcjtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKVwiPlNpbiBkYXRvcyBkZSBmb3JlY2FzdDwvZGl2Pic7XG4gIC8vIERpbWVuc2lvbmVzXG4gIGNvbnN0IFcgPSA2NDAsXG4gICAgSCA9IDI2MDtcbiAgY29uc3QgcGFkTCA9IDUwLFxuICAgIHBhZFIgPSAyMCxcbiAgICBwYWRUID0gMjAsXG4gICAgcGFkQiA9IDQwO1xuICBjb25zdCBpbm5lclcgPSBXIC0gcGFkTCAtIHBhZFI7XG4gIGNvbnN0IGlubmVySCA9IEggLSBwYWRUIC0gcGFkQjtcblxuICAvLyBZIHJhbmdlOiBtYXgoaGk4MCkgKiAxLjFcbiAgY29uc3QgbWF4WSA9IE1hdGgubWF4KDEsIC4uLmZjLm1hcCgoZikgPT4gTnVtYmVyKGYuaGk4MCkgfHwgTnVtYmVyKGYueV9oYXQpIHx8IDApKTtcbiAgY29uc3QgbWluWSA9IDA7XG4gIGNvbnN0IHNjYWxlWCA9IChpKSA9PiBwYWRMICsgKGlubmVyVyAqIGkpIC8gTWF0aC5tYXgoMSwgZmMubGVuZ3RoIC0gMSk7XG4gIGNvbnN0IHNjYWxlWSA9ICh2KSA9PiBwYWRUICsgaW5uZXJIIC0gKGlubmVySCAqICh2IC0gbWluWSkpIC8gKG1heFkgLSBtaW5ZKTtcblxuICAvLyBHcmlkICsgZWplIFlcbiAgY29uc3QgeVRpY2tzID0gWzAsIDAuMjUsIDAuNSwgMC43NSwgMV1cbiAgICAubWFwKChyKSA9PiB7XG4gICAgICBjb25zdCB2YWwgPSBtaW5ZICsgciAqIChtYXhZIC0gbWluWSk7XG4gICAgICBjb25zdCB5eSA9IHNjYWxlWSh2YWwpO1xuICAgICAgcmV0dXJuIChcbiAgICAgICAgJzxsaW5lIHgxPVwiJyArXG4gICAgICAgIHBhZEwgK1xuICAgICAgICAnXCIgeTE9XCInICtcbiAgICAgICAgeXkgK1xuICAgICAgICAnXCIgeDI9XCInICtcbiAgICAgICAgKFcgLSBwYWRSKSArXG4gICAgICAgICdcIiB5Mj1cIicgK1xuICAgICAgICB5eSArXG4gICAgICAgICdcIiBzdHJva2U9XCIjZTJlOGYwXCIgc3Ryb2tlLXdpZHRoPVwiMVwiLz4nICtcbiAgICAgICAgJzx0ZXh0IHg9XCInICtcbiAgICAgICAgKHBhZEwgLSA2KSArXG4gICAgICAgICdcIiB5PVwiJyArXG4gICAgICAgICh5eSArIDQpICtcbiAgICAgICAgJ1wiIHRleHQtYW5jaG9yPVwiZW5kXCIgZm9udC1zaXplPVwiMTBcIiBmaWxsPVwiIzY0NzQ4YlwiPicgK1xuICAgICAgICBfZm10TnVtKHZhbCkgK1xuICAgICAgICAnPC90ZXh0PidcbiAgICAgICk7XG4gICAgfSlcbiAgICAuam9pbignJyk7XG5cbiAgLy8gRWplIFggKG1lc2VzKVxuICBjb25zdCB4TGFiZWxzID0gZmNcbiAgICAubWFwKChmLCBpKSA9PiB7XG4gICAgICBjb25zdCB4eCA9IHNjYWxlWChpKTtcbiAgICAgIHJldHVybiAoXG4gICAgICAgICc8dGV4dCB4PVwiJyArXG4gICAgICAgIHh4ICtcbiAgICAgICAgJ1wiIHk9XCInICtcbiAgICAgICAgKEggLSBwYWRCICsgMTUpICtcbiAgICAgICAgJ1wiIHRleHQtYW5jaG9yPVwibWlkZGxlXCIgZm9udC1zaXplPVwiMTBcIiBmaWxsPVwiIzY0NzQ4YlwiPicgK1xuICAgICAgICBfZm10RHNTaG9ydChmLmRzKSArXG4gICAgICAgICc8L3RleHQ+J1xuICAgICAgKTtcbiAgICB9KVxuICAgIC5qb2luKCcnKTtcblxuICAvLyBJbnRlcnZhbG8gY29uZmlhbnphIChiYW5kKVxuICBjb25zdCBiYW5kUG9pbnRzID1cbiAgICBmYy5tYXAoKGYsIGkpID0+IHNjYWxlWChpKSArICcsJyArIHNjYWxlWShOdW1iZXIoZi5oaTgwKSB8fCAwKSkuam9pbignICcpICtcbiAgICAnICcgK1xuICAgIGZjXG4gICAgICAuc2xpY2UoKVxuICAgICAgLnJldmVyc2UoKVxuICAgICAgLm1hcCgoZiwgaSkgPT4gc2NhbGVYKGZjLmxlbmd0aCAtIDEgLSBpKSArICcsJyArIHNjYWxlWShOdW1iZXIoZi5sbzgwKSB8fCAwKSlcbiAgICAgIC5qb2luKCcgJyk7XG4gIGNvbnN0IGJhbmQgPSAnPHBvbHlnb24gcG9pbnRzPVwiJyArIGJhbmRQb2ludHMgKyAnXCIgZmlsbD1cIiMwZDk0ODgzM1wiIHN0cm9rZT1cIm5vbmVcIi8+JztcblxuICAvLyBMaW5lIGZvcmVjYXN0ICsgcHVudG9zXG4gIGNvbnN0IGxpbmVQb2ludHMgPSBmYy5tYXAoKGYsIGkpID0+IHNjYWxlWChpKSArICcsJyArIHNjYWxlWShOdW1iZXIoZi55X2hhdCkgfHwgMCkpLmpvaW4oJyAnKTtcbiAgY29uc3QgbGluZSA9XG4gICAgJzxwb2x5bGluZSBwb2ludHM9XCInICtcbiAgICBsaW5lUG9pbnRzICtcbiAgICAnXCIgZmlsbD1cIm5vbmVcIiBzdHJva2U9XCIjMGQ5NDg4XCIgc3Ryb2tlLXdpZHRoPVwiMi41XCIgc3Ryb2tlLWxpbmVqb2luPVwicm91bmRcIi8+JztcbiAgY29uc3QgcG9pbnRzID0gZmNcbiAgICAubWFwKFxuICAgICAgKGYsIGkpID0+XG4gICAgICAgICc8Y2lyY2xlIGN4PVwiJyArXG4gICAgICAgIHNjYWxlWChpKSArXG4gICAgICAgICdcIiBjeT1cIicgK1xuICAgICAgICBzY2FsZVkoTnVtYmVyKGYueV9oYXQpIHx8IDApICtcbiAgICAgICAgJ1wiIHI9XCI0XCIgZmlsbD1cIiMwZDk0ODhcIiBzdHJva2U9XCIjZmZmXCIgc3Ryb2tlLXdpZHRoPVwiMlwiLz4nXG4gICAgKVxuICAgIC5qb2luKCcnKTtcbiAgLy8gTGFiZWxzIGRlIHZhbG9yXG4gIGNvbnN0IHZhbHVlTGFiZWxzID0gZmNcbiAgICAubWFwKChmLCBpKSA9PiB7XG4gICAgICBjb25zdCB4eCA9IHNjYWxlWChpKTtcbiAgICAgIGNvbnN0IHl5ID0gc2NhbGVZKE51bWJlcihmLnlfaGF0KSB8fCAwKTtcbiAgICAgIHJldHVybiAoXG4gICAgICAgICc8dGV4dCB4PVwiJyArXG4gICAgICAgIHh4ICtcbiAgICAgICAgJ1wiIHk9XCInICtcbiAgICAgICAgKHl5IC0gOCkgK1xuICAgICAgICAnXCIgdGV4dC1hbmNob3I9XCJtaWRkbGVcIiBmb250LXNpemU9XCIxMFwiIGZvbnQtd2VpZ2h0PVwiNzAwXCIgZmlsbD1cIiMwZjc2NmVcIj4nICtcbiAgICAgICAgX2ZtdE51bShmLnlfaGF0KSArXG4gICAgICAgICc8L3RleHQ+J1xuICAgICAgKTtcbiAgICB9KVxuICAgIC5qb2luKCcnKTtcblxuICBjb25zdCBzdmcgPVxuICAgICc8c3ZnIHZpZXdCb3g9XCIwIDAgJyArXG4gICAgVyArXG4gICAgJyAnICtcbiAgICBIICtcbiAgICAnXCIgc3R5bGU9XCJ3aWR0aDoxMDAlO21heC13aWR0aDo4MDBweDtoZWlnaHQ6YXV0b1wiPicgK1xuICAgICc8cmVjdCB4PVwiMFwiIHk9XCIwXCIgd2lkdGg9XCInICtcbiAgICBXICtcbiAgICAnXCIgaGVpZ2h0PVwiJyArXG4gICAgSCArXG4gICAgJ1wiIGZpbGw9XCIjZmZmXCIvPicgK1xuICAgIHlUaWNrcyArXG4gICAgeExhYmVscyArXG4gICAgYmFuZCArXG4gICAgbGluZSArXG4gICAgcG9pbnRzICtcbiAgICB2YWx1ZUxhYmVscyArXG4gICAgJzwvc3ZnPic7XG4gIHJldHVybiBzdmc7XG59XG5cbndpbmRvdy5vcGVuRm9yZWNhc3RTdGF0RGV0YWlsID0gZnVuY3Rpb24gKHN1YklkKSB7XG4gIGlmICghX2ZvcmVjYXN0U3RhdERvY3MpIHJldHVybjtcbiAgY29uc3QgZG9jID0gX2ZvcmVjYXN0U3RhdERvY3MuZmluZCgoZCkgPT4gZC5pZCA9PT0gc3ViSWQpO1xuICBpZiAoIWRvYykge1xuICAgIGFsZXJ0KCdObyBzZSBlbmNvbnRyXHUwMEYzIGRldGFsbGUgZGUgJyArIHN1YklkKTtcbiAgICByZXR1cm47XG4gIH1cbiAgY29uc3QgZXhpc3RpbmcgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZm9yZWNhc3Qtc3RhdC1kZXRhaWwnKTtcbiAgaWYgKGV4aXN0aW5nKSBleGlzdGluZy5yZW1vdmUoKTtcblxuICBjb25zdCBlbCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpO1xuICBlbC5pZCA9ICdmb3JlY2FzdC1zdGF0LWRldGFpbCc7XG4gIGVsLnN0eWxlLmNzc1RleHQgPVxuICAgICdwb3NpdGlvbjpmaXhlZDtpbnNldDowO2JhY2tncm91bmQ6cmdiYSgxNSwyMyw0MiwuNjUpO3otaW5kZXg6MjEwMDtkaXNwbGF5OmZsZXg7YWxpZ24taXRlbXM6Y2VudGVyO2p1c3RpZnktY29udGVudDpjZW50ZXI7cGFkZGluZzoydmgnO1xuICBlbC5vbmNsaWNrID0gKGV2KSA9PiB7XG4gICAgaWYgKGV2LnRhcmdldCA9PT0gZWwpIGVsLnJlbW92ZSgpO1xuICB9O1xuXG4gIGNvbnN0IHdhcGUgPSBkb2MubWV0cmljcyAmJiBkb2MubWV0cmljcy53YXBlO1xuICBjb25zdCBiaWFzID0gZG9jLm1ldHJpY3MgJiYgZG9jLm1ldHJpY3MuYmlhcztcbiAgY29uc3QgbWFlID0gZG9jLm1ldHJpY3MgJiYgZG9jLm1ldHJpY3MubWFlO1xuICBjb25zdCBybXNlID0gZG9jLm1ldHJpY3MgJiYgZG9jLm1ldHJpY3Mucm1zZTtcbiAgY29uc3QgYmVzdE1vZGVsID0gZG9jLmJlc3RNb2RlbCB8fCAnXHUyMDE0JztcbiAgY29uc3QgdmVyc2lvbklkID0gZG9jLnZlcnNpb25JZCB8fCAnXHUyMDE0JztcbiAgY29uc3Qgc3ZnSHRtbCA9IF9idWlsZEZvcmVjYXN0Q2hhcnRTdmcoZG9jKTtcblxuICBjb25zdCBtZXRyaWNzSHRtbCA9XG4gICAgJzxkaXYgc3R5bGU9XCJkaXNwbGF5OmdyaWQ7Z3JpZC10ZW1wbGF0ZS1jb2x1bW5zOnJlcGVhdChhdXRvLWZpdCxtaW5tYXgoMTIwcHgsMWZyKSk7Z2FwOjEwcHg7bWFyZ2luOjE0cHggMFwiPicgK1xuICAgICc8ZGl2IHN0eWxlPVwicGFkZGluZzoxMHB4O2JhY2tncm91bmQ6dmFyKC0tYmctc2Vjb25kYXJ5KTtib3JkZXItcmFkaXVzOjZweFwiPjxkaXYgc3R5bGU9XCJmb250LXNpemU6MTBweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2VcIj5Nb2RlbG88L2Rpdj48ZGl2IHN0eWxlPVwiZm9udC13ZWlnaHQ6NzAwXCI+JyArXG4gICAgZXNjYXBlSHRtbFNhZmUoYmVzdE1vZGVsKSArXG4gICAgJzwvZGl2PjwvZGl2PicgK1xuICAgICc8ZGl2IHN0eWxlPVwicGFkZGluZzoxMHB4O2JhY2tncm91bmQ6dmFyKC0tYmctc2Vjb25kYXJ5KTtib3JkZXItcmFkaXVzOjZweFwiPjxkaXYgc3R5bGU9XCJmb250LXNpemU6MTBweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2VcIj5XQVBFPC9kaXY+PGRpdiBzdHlsZT1cImZvbnQtd2VpZ2h0OjcwMDtjb2xvcjonICtcbiAgICBfd2FwZUJhZGdlQ29sb3Iod2FwZSkgK1xuICAgICdcIj4nICtcbiAgICBfZm10V2FwZSh3YXBlKSArXG4gICAgJzwvZGl2PjwvZGl2PicgK1xuICAgICc8ZGl2IHN0eWxlPVwicGFkZGluZzoxMHB4O2JhY2tncm91bmQ6dmFyKC0tYmctc2Vjb25kYXJ5KTtib3JkZXItcmFkaXVzOjZweFwiPjxkaXYgc3R5bGU9XCJmb250LXNpemU6MTBweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2VcIj5CaWFzPC9kaXY+PGRpdiBzdHlsZT1cImZvbnQtd2VpZ2h0OjcwMFwiPicgK1xuICAgIChiaWFzICE9IG51bGwgPyAoYmlhcyAqIDEwMCkudG9GaXhlZCgwKSArICclJyA6ICdcdTIwMTQnKSArXG4gICAgJzwvZGl2PjwvZGl2PicgK1xuICAgICc8ZGl2IHN0eWxlPVwicGFkZGluZzoxMHB4O2JhY2tncm91bmQ6dmFyKC0tYmctc2Vjb25kYXJ5KTtib3JkZXItcmFkaXVzOjZweFwiPjxkaXYgc3R5bGU9XCJmb250LXNpemU6MTBweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2VcIj5NQUU8L2Rpdj48ZGl2IHN0eWxlPVwiZm9udC13ZWlnaHQ6NzAwXCI+JyArXG4gICAgX2ZtdE51bShtYWUpICtcbiAgICAnPC9kaXY+PC9kaXY+JyArXG4gICAgJzxkaXYgc3R5bGU9XCJwYWRkaW5nOjEwcHg7YmFja2dyb3VuZDp2YXIoLS1iZy1zZWNvbmRhcnkpO2JvcmRlci1yYWRpdXM6NnB4XCI+PGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMHB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZVwiPlJNU0U8L2Rpdj48ZGl2IHN0eWxlPVwiZm9udC13ZWlnaHQ6NzAwXCI+JyArXG4gICAgX2ZtdE51bShybXNlKSArXG4gICAgJzwvZGl2PjwvZGl2PicgK1xuICAgICc8L2Rpdj4nO1xuXG4gIGNvbnN0IHRhYmxlSHRtbCA9XG4gICAgJzx0YWJsZSBzdHlsZT1cIndpZHRoOjEwMCU7Zm9udC1zaXplOjEycHg7Ym9yZGVyLWNvbGxhcHNlOmNvbGxhcHNlO21hcmdpbi10b3A6MTBweFwiPicgK1xuICAgICc8dGhlYWQgc3R5bGU9XCJiYWNrZ3JvdW5kOiMwZjE3MmE7Y29sb3I6I2ZmZlwiPjx0cj4nICtcbiAgICAnPHRoIHN0eWxlPVwicGFkZGluZzo2cHggMTBweDt0ZXh0LWFsaWduOmxlZnRcIj5NZXM8L3RoPicgK1xuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjZweCAxMHB4O3RleHQtYWxpZ246cmlnaHRcIj5Gb3JlY2FzdDwvdGg+JyArXG4gICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6NnB4IDEwcHg7dGV4dC1hbGlnbjpyaWdodFwiPklDIDgwJSBiYWpvPC90aD4nICtcbiAgICAnPHRoIHN0eWxlPVwicGFkZGluZzo2cHggMTBweDt0ZXh0LWFsaWduOnJpZ2h0XCI+SUMgODAlIGFsdG88L3RoPicgK1xuICAgICc8L3RyPjwvdGhlYWQ+PHRib2R5PicgK1xuICAgIChkb2MuZm9yZWNhc3QgfHwgW10pXG4gICAgICAubWFwKFxuICAgICAgICAoZikgPT5cbiAgICAgICAgICAnPHRyIHN0eWxlPVwiYm9yZGVyLWJvdHRvbToxcHggc29saWQgdmFyKC0tYm9yZGVyLXN1YnRsZSlcIj48dGQgc3R5bGU9XCJwYWRkaW5nOjZweCAxMHB4XCI+JyArXG4gICAgICAgICAgZXNjYXBlSHRtbFNhZmUoX2ZtdERzU2hvcnQoZi5kcykpICtcbiAgICAgICAgICAnPC90ZD4nICtcbiAgICAgICAgICAnPHRkIHN0eWxlPVwicGFkZGluZzo2cHggMTBweDt0ZXh0LWFsaWduOnJpZ2h0O2ZvbnQtd2VpZ2h0OjcwMFwiPicgK1xuICAgICAgICAgIF9mbXROdW0oZi55X2hhdCkgK1xuICAgICAgICAgICc8L3RkPicgK1xuICAgICAgICAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjZweCAxMHB4O3RleHQtYWxpZ246cmlnaHQ7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZClcIj4nICtcbiAgICAgICAgICBfZm10TnVtKGYubG84MCkgK1xuICAgICAgICAgICc8L3RkPicgK1xuICAgICAgICAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjZweCAxMHB4O3RleHQtYWxpZ246cmlnaHQ7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZClcIj4nICtcbiAgICAgICAgICBfZm10TnVtKGYuaGk4MCkgK1xuICAgICAgICAgICc8L3RkPjwvdHI+J1xuICAgICAgKVxuICAgICAgLmpvaW4oJycpICtcbiAgICAnPC90Ym9keT48L3RhYmxlPic7XG5cbiAgY29uc3QgY29udGVudCA9XG4gICAgJzxkaXYgc3R5bGU9XCJiYWNrZ3JvdW5kOnZhcigtLWJnLWVsZXZhdGVkKTtib3JkZXItcmFkaXVzOjEycHg7cGFkZGluZzoyNHB4O21heC13aWR0aDo4MjBweDt3aWR0aDoxMDAlO21heC1oZWlnaHQ6OTZ2aDtvdmVyZmxvdzphdXRvO2JveC1zaGFkb3c6MCAyMHB4IDYwcHggcmdiYSgwLDAsMCwuNClcIj4nICtcbiAgICAnPGRpdiBzdHlsZT1cImRpc3BsYXk6ZmxleDtqdXN0aWZ5LWNvbnRlbnQ6c3BhY2UtYmV0d2VlbjthbGlnbi1pdGVtczpjZW50ZXI7bWFyZ2luLWJvdHRvbToxMHB4XCI+JyArXG4gICAgJzxkaXY+PGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMXB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtsZXR0ZXItc3BhY2luZzouNHB4XCI+U3ViZmFtaWxpYTwvZGl2PjxkaXYgc3R5bGU9XCJmb250LXNpemU6MjJweDtmb250LXdlaWdodDo4MDBcIj4nICtcbiAgICBlc2NhcGVIdG1sU2FmZShkb2Muc3ViZmFtaWxpYSB8fCBkb2MuaWQpICtcbiAgICAnPC9kaXY+PC9kaXY+JyArXG4gICAgJzxidXR0b24gb25jbGljaz1cImRvY3VtZW50LmdldEVsZW1lbnRCeUlkKFxcJ2ZvcmVjYXN0LXN0YXQtZGV0YWlsXFwnKS5yZW1vdmUoKVwiIHN0eWxlPVwiYmFja2dyb3VuZDp0cmFuc3BhcmVudDtib3JkZXI6MXB4IHNvbGlkIHZhcigtLWJvcmRlci1zdWJ0bGUpO2JvcmRlci1yYWRpdXM6NnB4O3BhZGRpbmc6NnB4IDEycHg7Y3Vyc29yOnBvaW50ZXI7Zm9udC13ZWlnaHQ6NzAwXCI+Q2VycmFyPC9idXR0b24+JyArXG4gICAgJzwvZGl2PicgK1xuICAgIG1ldHJpY3NIdG1sICtcbiAgICAnPGRpdiBzdHlsZT1cImJhY2tncm91bmQ6I2ZmZjtwYWRkaW5nOjhweDtib3JkZXItcmFkaXVzOjhweDttYXJnaW4tdG9wOjEwcHg7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1ib3JkZXItc3VidGxlKVwiPicgK1xuICAgIHN2Z0h0bWwgK1xuICAgICc8L2Rpdj4nICtcbiAgICB0YWJsZUh0bWwgK1xuICAgICc8ZGl2IHN0eWxlPVwibWFyZ2luLXRvcDoxNHB4O2ZvbnQtc2l6ZToxMXB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpXCI+VmVyc2lvbjogPGNvZGU+JyArXG4gICAgZXNjYXBlSHRtbFNhZmUodmVyc2lvbklkKSArXG4gICAgJzwvY29kZT4gXHUwMEI3IEFwcHJvYWNoOiAnICtcbiAgICBlc2NhcGVIdG1sU2FmZSgoZG9jLmNvbmZpZyB8fCB7fSkuYXBwcm9hY2ggfHwgJ1x1MjAxNCcpICtcbiAgICAnPC9kaXY+JyArXG4gICAgJzwvZGl2Pic7XG4gIGVsLmlubmVySFRNTCA9IGNvbnRlbnQ7XG4gIGRvY3VtZW50LmJvZHkuYXBwZW5kQ2hpbGQoZWwpO1xufTtcblxud2luZG93Lm9wZW5Gb3JlY2FzdE1vZGFsID0gYXN5bmMgZnVuY3Rpb24gKCkge1xuICBpZiAoIV9jYW5Gb3JlY2FzdCgpKSB7XG4gICAgYWxlcnQoJ0ZPUkVDQVNUIGVzIHNvbG8gcGFyYSBNYXJpYW5vIChhZG1pbikuJyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGNvbnN0IGVsID0gX3JlbmRlck1vZGFsU2hlbGwoKTtcbiAgZWwuc3R5bGUuZGlzcGxheSA9ICdibG9jayc7XG4gIC8vIEZhc2UgMTogY2FyZ2FyIFNhbGVzIFBsYW5zIGNhY2hlcyArIHJlbmRlcml6YXIgdGFiIGRlZmF1bHQuXG4gIF9yZW5kZXJTYWxlc1BsYW5zVGFiKCk7XG4gIF9sb2FkU2FsZXNQbGFuQ2FjaGVzKClcbiAgICAudGhlbihfcmVuZGVyU2FsZXNQbGFuc1RhYilcbiAgICAuY2F0Y2goKCkgPT4ge30pO1xufTtcblxud2luZG93LmNsb3NlRm9yZWNhc3RNb2RhbCA9IGZ1bmN0aW9uICgpIHtcbiAgY29uc3QgZWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZm9yZWNhc3QtbW9kYWwnKTtcbiAgaWYgKGVsKSBlbC5zdHlsZS5kaXNwbGF5ID0gJ25vbmUnO1xufTtcblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBGM0EgXHUyMDE0IFRhYmxhIFJlY29tZW5kYWNpXHUwMEYzbiBkZSBDb21wcmEgKHRhYiBTYWxlcyBQbGFucylcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5hc3luYyBmdW5jdGlvbiBfbG9hZFJlY29EYXRhKCkge1xuICBpZiAoIXdpbmRvdy5mYkRiKSB0aHJvdyBuZXcgRXJyb3IoJ0ZpcmVzdG9yZSBubyBpbmljaWFsaXphZG8nKTtcbiAgY29uc3QgcHJvbWlzZXMgPSBbXTtcbiAgaWYgKCFfcmVjb1N0b2NrU25hcHNob3QpIHtcbiAgICBwcm9taXNlcy5wdXNoKFxuICAgICAgd2luZG93LmZiRGJcbiAgICAgICAgLmNvbGxlY3Rpb24oJ2FwcF9jb25maWcnKVxuICAgICAgICAuZG9jKCdzdG9ja19zbmFwc2hvdCcpXG4gICAgICAgIC5nZXQoKVxuICAgICAgICAudGhlbigoZCkgPT4ge1xuICAgICAgICAgIGNvbnN0IGRhdGEgPSBkLmV4aXN0cyA/IGQuZGF0YSgpIDoge307XG4gICAgICAgICAgbGV0IHdoID0ge307XG4gICAgICAgICAgbGV0IGJvID0ge307XG4gICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIHdoID0gZGF0YS53YXJlaG91c2VCcmVha2Rvd24gPyBKU09OLnBhcnNlKGRhdGEud2FyZWhvdXNlQnJlYWtkb3duKSA6IHt9O1xuICAgICAgICAgIH0gY2F0Y2gge1xuICAgICAgICAgICAgd2ggPSB7fTtcbiAgICAgICAgICB9XG4gICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGJvID0gZGF0YS5iYWNrb3JkZXJCeVNrdSA/IEpTT04ucGFyc2UoZGF0YS5iYWNrb3JkZXJCeVNrdSkgOiB7fTtcbiAgICAgICAgICB9IGNhdGNoIHtcbiAgICAgICAgICAgIGJvID0ge307XG4gICAgICAgICAgfVxuICAgICAgICAgIF9yZWNvU3RvY2tTbmFwc2hvdCA9IHsgd2FyZWhvdXNlQnJlYWtkb3duOiB3aCwgYmFja29yZGVyQnlTa3U6IGJvIH07XG4gICAgICAgIH0pXG4gICAgKTtcbiAgfVxuICBpZiAoIV9yZWNvVmVudGFzU25hcHNob3QpIHtcbiAgICBwcm9taXNlcy5wdXNoKFxuICAgICAgd2luZG93LmZiRGJcbiAgICAgICAgLmNvbGxlY3Rpb24oJ3NrdV92ZW50YXNfc25hcHNob3QnKVxuICAgICAgICAuZ2V0KClcbiAgICAgICAgLnRoZW4oKHNuYXApID0+IHtcbiAgICAgICAgICBjb25zdCBtYXAgPSB7fTtcbiAgICAgICAgICBzbmFwLmZvckVhY2goKGRvYykgPT4ge1xuICAgICAgICAgICAgY29uc3QgZCA9IGRvYy5kYXRhKCk7XG4gICAgICAgICAgICBpZiAoIWQgfHwgIWQuc2t1KSByZXR1cm47XG4gICAgICAgICAgICBtYXBbU3RyaW5nKGQuc2t1KS50cmltKCkudG9VcHBlckNhc2UoKV0gPSB7IG1lc2VzOiBkLm1lc2VzIHx8IHt9IH07XG4gICAgICAgICAgfSk7XG4gICAgICAgICAgX3JlY29WZW50YXNTbmFwc2hvdCA9IG1hcDtcbiAgICAgICAgfSlcbiAgICApO1xuICB9XG4gIGF3YWl0IFByb21pc2UuYWxsKHByb21pc2VzKTtcbn1cblxuZnVuY3Rpb24gX2NvbXB1dGVWZW50YU1lbnN1YWxQcm9tZWRpbyhza3VVcHBlcikge1xuICAvLyBQcm9tZWRpbyBkZSBsb3MgXHUwMEZBbHRpbW9zIFJFQ09fVkVOVEFfUFJPTUVESU9fV0lORE9XIG1lc2VzIGNlcnJhZG9zXG4gIC8vIChleGNsdXllIGVsIG1lcyBhY3R1YWwgcGFyY2lhbCkuXG4gIGNvbnN0IHJlYyA9IF9yZWNvVmVudGFzU25hcHNob3QgJiYgX3JlY29WZW50YXNTbmFwc2hvdFtza3VVcHBlcl07XG4gIGlmICghcmVjIHx8ICFyZWMubWVzZXMpIHJldHVybiAwO1xuICBjb25zdCBob3kgPSBuZXcgRGF0ZSgpO1xuICBjb25zdCBtb250aHNCYWNrID0gW107XG4gIGZvciAobGV0IGkgPSAxOyBpIDw9IFJFQ09fVkVOVEFfUFJPTUVESU9fV0lORE9XOyBpKyspIHtcbiAgICBjb25zdCBkID0gbmV3IERhdGUoaG95LmdldEZ1bGxZZWFyKCksIGhveS5nZXRNb250aCgpIC0gaSwgMSk7XG4gICAgbW9udGhzQmFjay5wdXNoKFN0cmluZyhkLmdldEZ1bGxZZWFyKCkpICsgJy0nICsgU3RyaW5nKGQuZ2V0TW9udGgoKSArIDEpLnBhZFN0YXJ0KDIsICcwJykpO1xuICB9XG4gIGxldCBzdW0gPSAwO1xuICBsZXQgbiA9IDA7XG4gIG1vbnRoc0JhY2suZm9yRWFjaCgoaykgPT4ge1xuICAgIGNvbnN0IG0gPSByZWMubWVzZXNba107XG4gICAgaWYgKG0gJiYgTnVtYmVyLmlzRmluaXRlKE51bWJlcihtLnF0eSkpKSB7XG4gICAgICBzdW0gKz0gTnVtYmVyKG0ucXR5KTtcbiAgICAgIG4rKztcbiAgICB9XG4gIH0pO1xuICByZXR1cm4gbiA+IDAgPyBzdW0gLyBuIDogMDtcbn1cblxuZnVuY3Rpb24gX2NvbXB1dGVTYWxlc1BsYW5GdXR1cm8ocm93KSB7XG4gIC8vIFN1bWEgbG9zIG1lc2VzIGRlIHJvdy5tb250aHMgZGVzZGUgZWwgbWVzIGFjdHVhbCAoaW5jbHVzaXZlKSBoYXN0YSBlbFxuICAvLyBcdTAwRkFsdGltbyBtZXMgZGVsIHNhbGVzIHBsYW4uIExvcyBtZXNlcyBzb24gJ1lZWVktTU0nLlxuICBpZiAoIXJvdyB8fCAhcm93Lm1vbnRocykgcmV0dXJuIDA7XG4gIGNvbnN0IGhveSA9IG5ldyBEYXRlKCk7XG4gIGNvbnN0IGN1cnJlbnRLZXkgPSBTdHJpbmcoaG95LmdldEZ1bGxZZWFyKCkpICsgJy0nICsgU3RyaW5nKGhveS5nZXRNb250aCgpICsgMSkucGFkU3RhcnQoMiwgJzAnKTtcbiAgbGV0IHN1bSA9IDA7XG4gIE9iamVjdC5rZXlzKHJvdy5tb250aHMpLmZvckVhY2goKGspID0+IHtcbiAgICBpZiAoayA+PSBjdXJyZW50S2V5KSBzdW0gKz0gTnVtYmVyKHJvdy5tb250aHNba10gfHwgMCk7XG4gIH0pO1xuICByZXR1cm4gc3VtO1xufVxuXG5mdW5jdGlvbiBfY29tcHV0ZVJlY29tbWVuZGF0aW9ucygpIHtcbiAgLy8gQ29tYmluYSBSb2RzICsgUmVlbHMgc2FsZXMgcGxhbnMgKyBzdG9jayArIGJhY2tvcmRlciArIHZlbnRhcyBwcm9tZWRpby5cbiAgLy8gUmV0b3JuYSBhcnJheSBkZSByb3dzIGNvbiB0b2RvcyBsb3MgY2FtcG9zICsgcmVjb21lbmRhZG8uXG4gIGNvbnN0IHJvd3MgPSBbXTtcbiAgY29uc3QgZmFtaWxpYXMgPSBbJ3JvZHMnLCAncmVlbHMnXTtcbiAgZm9yIChjb25zdCBmYW0gb2YgZmFtaWxpYXMpIHtcbiAgICBjb25zdCBjYWNoZSA9IF9zYWxlc1BsYW5DYWNoZXNbZmFtXTtcbiAgICBpZiAoIWNhY2hlIHx8ICFjYWNoZS5yb3dzKSBjb250aW51ZTtcbiAgICBmb3IgKGNvbnN0IHNwUm93IG9mIGNhY2hlLnJvd3MpIHtcbiAgICAgIGNvbnN0IHNrdSA9IFN0cmluZyhzcFJvdy5za3UgfHwgJycpLnRyaW0oKTtcbiAgICAgIGNvbnN0IHNrdVVwcGVyID0gc2t1LnRvVXBwZXJDYXNlKCk7XG4gICAgICBjb25zdCBzdG9ja1doID1cbiAgICAgICAgKF9yZWNvU3RvY2tTbmFwc2hvdCAmJlxuICAgICAgICAgIF9yZWNvU3RvY2tTbmFwc2hvdC53YXJlaG91c2VCcmVha2Rvd24gJiZcbiAgICAgICAgICBfcmVjb1N0b2NrU25hcHNob3Qud2FyZWhvdXNlQnJlYWtkb3duW3NrdV0pIHx8XG4gICAgICAgIHt9O1xuICAgICAgY29uc3Qgc3RvY2tMaWJyZSA9IE51bWJlcihzdG9ja1doWycxMSddIHx8IDApO1xuICAgICAgY29uc3QgZW5UcmFuc2l0byA9IE51bWJlcihzdG9ja1doWycxMiddIHx8IDApO1xuICAgICAgY29uc3QgYmFja29yZGVyID0gTnVtYmVyKFxuICAgICAgICAoX3JlY29TdG9ja1NuYXBzaG90ICYmXG4gICAgICAgICAgX3JlY29TdG9ja1NuYXBzaG90LmJhY2tvcmRlckJ5U2t1ICYmXG4gICAgICAgICAgX3JlY29TdG9ja1NuYXBzaG90LmJhY2tvcmRlckJ5U2t1W3NrdV0pIHx8XG4gICAgICAgICAgMFxuICAgICAgKTtcbiAgICAgIGNvbnN0IHZlbnRhTWVuc3VhbCA9IF9jb21wdXRlVmVudGFNZW5zdWFsUHJvbWVkaW8oc2t1VXBwZXIpO1xuICAgICAgY29uc3Qgc2FsZXNQbGFuRnV0ID0gX2NvbXB1dGVTYWxlc1BsYW5GdXR1cm8oc3BSb3cpO1xuICAgICAgY29uc3QgbW9xID0gTnVtYmVyKHNwUm93Lm1vcSB8fCAwKTtcbiAgICAgIGNvbnN0IG11bHRpcGxpZXIgPSBSRUNPX0RFRkFVTFRfTVVMVElQTElFUjsgLy8gdjExMDk6IGZpam8gMS4wOyBGM0IgbG8gaGFjZSBlZGl0YWJsZSBwb3Igc3ViZmFtaWxpYVxuICAgICAgY29uc3QgZGVtYW5kYUVzcGVyYWRhID0gdmVudGFNZW5zdWFsICogbXVsdGlwbGllciAqIFJFQ09fSE9SSVpPTl9NT05USFM7XG4gICAgICBjb25zdCBiYWxhbmNlID0gc3RvY2tMaWJyZSArIGVuVHJhbnNpdG8gKyBzYWxlc1BsYW5GdXQgLSBiYWNrb3JkZXIgLSBkZW1hbmRhRXNwZXJhZGE7XG4gICAgICBsZXQgcmVjb21lbmRhZG8gPSAwO1xuICAgICAgaWYgKGJhbGFuY2UgPCAwKSB7XG4gICAgICAgIGNvbnN0IGRlZmljaXQgPSAtYmFsYW5jZTtcbiAgICAgICAgcmVjb21lbmRhZG8gPSBtb3EgPiAwID8gTWF0aC5tYXgobW9xLCBNYXRoLmNlaWwoZGVmaWNpdCAvIG1vcSkgKiBtb3EpIDogTWF0aC5jZWlsKGRlZmljaXQpO1xuICAgICAgfVxuICAgICAgcm93cy5wdXNoKHtcbiAgICAgICAgZmFtaWxpYTogZmFtLFxuICAgICAgICBza3UsXG4gICAgICAgIGRlc2NyaXB0aW9uOiBzcFJvdy5kZXNjcmlwdGlvbiB8fCAnJyxcbiAgICAgICAgbW9xLFxuICAgICAgICBzdG9ja0xpYnJlLFxuICAgICAgICBlblRyYW5zaXRvLFxuICAgICAgICBiYWNrb3JkZXIsXG4gICAgICAgIHZlbnRhTWVuc3VhbDogTWF0aC5yb3VuZCh2ZW50YU1lbnN1YWwgKiAxMCkgLyAxMCxcbiAgICAgICAgc2FsZXNQbGFuRnV0LFxuICAgICAgICBtdWx0aXBsaWVyLFxuICAgICAgICBkZW1hbmRhRXNwZXJhZGE6IE1hdGgucm91bmQoZGVtYW5kYUVzcGVyYWRhICogMTApIC8gMTAsXG4gICAgICAgIGJhbGFuY2U6IE1hdGgucm91bmQoYmFsYW5jZSAqIDEwKSAvIDEwLFxuICAgICAgICByZWNvbWVuZGFkbyxcbiAgICAgIH0pO1xuICAgIH1cbiAgfVxuICAvLyBPcmRlbmFyIHBvciByZWNvbWVuZGFkbyBkZXNjZW5kZW50ZVxuICByb3dzLnNvcnQoKGEsIGIpID0+IGIucmVjb21lbmRhZG8gLSBhLnJlY29tZW5kYWRvKTtcbiAgcmV0dXJuIHJvd3M7XG59XG5cbmZ1bmN0aW9uIF9mbXROdW1TaWduZWQobikge1xuICBpZiAobiA9PSBudWxsIHx8ICFOdW1iZXIuaXNGaW5pdGUoTnVtYmVyKG4pKSkgcmV0dXJuICdcdTIwMTQnO1xuICBjb25zdCB2ID0gTnVtYmVyKG4pO1xuICBjb25zdCBhYnMgPSBNYXRoLmFicyh2KS50b0xvY2FsZVN0cmluZygnZXMtQVInLCB7IG1heGltdW1GcmFjdGlvbkRpZ2l0czogMCB9KTtcbiAgcmV0dXJuICh2IDwgMCA/ICdcdTIyMTInIDogJycpICsgYWJzO1xufVxuXG5mdW5jdGlvbiBfZm10SW50KG4pIHtcbiAgaWYgKG4gPT0gbnVsbCB8fCAhTnVtYmVyLmlzRmluaXRlKE51bWJlcihuKSkpIHJldHVybiAnXHUyMDE0JztcbiAgcmV0dXJuIE1hdGgucm91bmQoTnVtYmVyKG4pKS50b0xvY2FsZVN0cmluZygnZXMtQVInKTtcbn1cblxuZnVuY3Rpb24gX3JlbmRlclJlY29TZWN0aW9uKCkge1xuICBjb25zdCBjb250ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3JlY28tc2VjdGlvbi1jb250YWluZXInKTtcbiAgaWYgKCFjb250KSByZXR1cm47XG4gIHRyeSB7XG4gICAgX3JlbmRlclJlY29TZWN0aW9uSW1wbChjb250KTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGNvbnNvbGUuZXJyb3IoJ1tGT1JFQ0FTVCByZWNvXSByZW5kZXIgZmFpbCcsIGUpO1xuICAgIGNvbnQuaW5uZXJIVE1MID1cbiAgICAgICc8ZGl2IHN0eWxlPVwicGFkZGluZzoyMHB4O2NvbG9yOiNkYzI2MjZcIj4nICtcbiAgICAgICc8ZGl2IHN0eWxlPVwiZm9udC13ZWlnaHQ6NzAwO21hcmdpbi1ib3R0b206OHB4XCI+RXJyb3IgcmVuZGVyaXphbmRvIHRhYmxhIHJlY29tZW5kYWNpXHUwMEYzbjwvZGl2PicgK1xuICAgICAgJzxwcmUgc3R5bGU9XCJmb250LXNpemU6MTFweDtiYWNrZ3JvdW5kOiNmZWYyZjI7cGFkZGluZzoxMHB4O2JvcmRlci1yYWRpdXM6NnB4O292ZXJmbG93OmF1dG87d2hpdGUtc3BhY2U6cHJlLXdyYXBcIj4nICtcbiAgICAgIGVzY2FwZUh0bWxTYWZlKGUuc3RhY2sgfHwgZS5tZXNzYWdlIHx8IFN0cmluZyhlKSkgK1xuICAgICAgJzwvcHJlPjwvZGl2Pic7XG4gIH1cbn1cblxuZnVuY3Rpb24gX3JlbmRlclJlY29TZWN0aW9uSW1wbChjb250KSB7XG4gIGNvbnN0IGFueUxvYWRlZCA9ICEhKF9zYWxlc1BsYW5DYWNoZXMucm9kcyB8fCBfc2FsZXNQbGFuQ2FjaGVzLnJlZWxzKTtcbiAgaWYgKCFhbnlMb2FkZWQpIHtcbiAgICBjb250LmlubmVySFRNTCA9ICcnO1xuICAgIHJldHVybjtcbiAgfVxuICBpZiAoIV9yZWNvU3RvY2tTbmFwc2hvdCB8fCAhX3JlY29WZW50YXNTbmFwc2hvdCkge1xuICAgIGNvbnQuaW5uZXJIVE1MID1cbiAgICAgICc8ZGl2IHN0eWxlPVwicGFkZGluZzo0MHB4IDE4cHg7dGV4dC1hbGlnbjpjZW50ZXI7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZClcIj4nICtcbiAgICAgICc8ZGl2IHN0eWxlPVwiZGlzcGxheTppbmxpbmUtYmxvY2s7d2lkdGg6MjRweDtoZWlnaHQ6MjRweDtib3JkZXI6M3B4IHNvbGlkICMwZDk0ODg7Ym9yZGVyLXRvcC1jb2xvcjp0cmFuc3BhcmVudDtib3JkZXItcmFkaXVzOjUwJTthbmltYXRpb246c3BpbiAwLjhzIGxpbmVhciBpbmZpbml0ZTttYXJnaW4tYm90dG9tOjEwcHhcIj48L2Rpdj4nICtcbiAgICAgICc8ZGl2PkNhcmdhbmRvIHN0b2NrICsgdmVudGFzIGhpc3RcdTAwRjNyaWNhcy4uLjwvZGl2PicgK1xuICAgICAgJzxzdHlsZT5Aa2V5ZnJhbWVzIHNwaW57dG97dHJhbnNmb3JtOnJvdGF0ZSgzNjBkZWcpfX08L3N0eWxlPjwvZGl2Pic7XG4gICAgX2xvYWRSZWNvRGF0YSgpXG4gICAgICAudGhlbihfcmVuZGVyUmVjb1NlY3Rpb24pXG4gICAgICAuY2F0Y2goKGUpID0+IHtcbiAgICAgICAgY29uc29sZS5lcnJvcignW0ZPUkVDQVNUIHJlY29dIGxvYWQgZmFpbCcsIGUpO1xuICAgICAgICBjb250LmlubmVySFRNTCA9XG4gICAgICAgICAgJzxkaXYgc3R5bGU9XCJwYWRkaW5nOjIwcHg7Y29sb3I6I2RjMjYyNlwiPkVycm9yIGNhcmdhbmRvIGRhdG9zOiAnICtcbiAgICAgICAgICBlc2NhcGVIdG1sU2FmZShlLm1lc3NhZ2UgfHwgU3RyaW5nKGUpKSArXG4gICAgICAgICAgJzwvZGl2Pic7XG4gICAgICB9KTtcbiAgICByZXR1cm47XG4gIH1cbiAgY29uc3QgYWxsUm93cyA9IF9jb21wdXRlUmVjb21tZW5kYXRpb25zKCk7XG4gIGNvbnN0IHNlYXJjaExjID0gX3JlY29TZWFyY2hUZXh0LnRyaW0oKS50b0xvd2VyQ2FzZSgpO1xuICBjb25zdCByb3dzID0gYWxsUm93cy5maWx0ZXIoKHIpID0+IHtcbiAgICBpZiAoX3JlY29GaWx0ZXJGYW1pbGlhICE9PSAnYWxsJyAmJiByLmZhbWlsaWEgIT09IF9yZWNvRmlsdGVyRmFtaWxpYSkgcmV0dXJuIGZhbHNlO1xuICAgIGlmIChfcmVjb0ZpbHRlck1pblJlYyAmJiByLnJlY29tZW5kYWRvIDw9IDApIHJldHVybiBmYWxzZTtcbiAgICBpZiAoc2VhcmNoTGMpIHtcbiAgICAgIGNvbnN0IGhheSA9XG4gICAgICAgIHIuc2t1LnRvTG93ZXJDYXNlKCkuaW5jbHVkZXMoc2VhcmNoTGMpIHx8IHIuZGVzY3JpcHRpb24udG9Mb3dlckNhc2UoKS5pbmNsdWRlcyhzZWFyY2hMYyk7XG4gICAgICBpZiAoIWhheSkgcmV0dXJuIGZhbHNlO1xuICAgIH1cbiAgICByZXR1cm4gdHJ1ZTtcbiAgfSk7XG4gIGNvbnN0IHRvdGFsUmVjbyA9IGFsbFJvd3MucmVkdWNlKChzLCByKSA9PiBzICsgci5yZWNvbWVuZGFkbywgMCk7XG4gIGNvbnN0IHRvdGFsQ29uUmVjbyA9IGFsbFJvd3MuZmlsdGVyKChyKSA9PiByLnJlY29tZW5kYWRvID4gMCkubGVuZ3RoO1xuXG4gIGNvbnN0IGhlYWRlciA9XG4gICAgJzxkaXYgc3R5bGU9XCJkaXNwbGF5OmZsZXg7ZmxleC13cmFwOndyYXA7Z2FwOjEwcHg7YWxpZ24taXRlbXM6Y2VudGVyO21hcmdpbi1ib3R0b206MTJweFwiPicgK1xuICAgICc8ZGl2IHN0eWxlPVwiZmxleDoxO21pbi13aWR0aDoyODBweFwiPjxkaXYgc3R5bGU9XCJmb250LXNpemU6MThweDtmb250LXdlaWdodDo4MDA7Y29sb3I6dmFyKC0tdGV4dC1wcmltYXJ5KVwiPlJlY29tZW5kYWNpXHUwMEYzbiBkZSBDb21wcmE8L2Rpdj4nICtcbiAgICAnPGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMXB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO21hcmdpbi10b3A6MnB4XCI+QmFsYW5jZSA9IFN0b2NrICsgVHJcdTAwRTFuc2l0byArIFBsYW4gXHUyMjEyIEJhY2tvcmRlciBcdTIyMTIgKFZlbnRhIG1lbnMuIFx1MDBENyAnICtcbiAgICBSRUNPX0hPUklaT05fTU9OVEhTICtcbiAgICAnbSk8L2Rpdj48L2Rpdj4nICtcbiAgICAnPGRpdiBzdHlsZT1cInBhZGRpbmc6NnB4IDEycHg7YmFja2dyb3VuZDojMGQ5NDg4O2NvbG9yOiNmZmY7Ym9yZGVyLXJhZGl1czo2cHg7Zm9udC1zaXplOjEycHg7Zm9udC13ZWlnaHQ6NzAwXCI+JyArXG4gICAgX2ZtdEludCh0b3RhbENvblJlY28pICtcbiAgICAnIFNLVXMgY29uIHJlY288L2Rpdj4nICtcbiAgICAnPGRpdiBzdHlsZT1cInBhZGRpbmc6NnB4IDEycHg7YmFja2dyb3VuZDojMTM0ZTRhO2NvbG9yOiNmZmY7Ym9yZGVyLXJhZGl1czo2cHg7Zm9udC1zaXplOjEycHg7Zm9udC13ZWlnaHQ6NzAwXCI+XHUwM0EzICcgK1xuICAgIF9mbXRJbnQodG90YWxSZWNvKSArXG4gICAgJyB1bmlkYWRlczwvZGl2PicgK1xuICAgICc8L2Rpdj4nO1xuXG4gIGNvbnN0IGZpbHRlcnMgPVxuICAgICc8ZGl2IHN0eWxlPVwiZGlzcGxheTpmbGV4O2ZsZXgtd3JhcDp3cmFwO2dhcDo4cHg7bWFyZ2luLWJvdHRvbToxMHB4O3BhZGRpbmc6MTBweDtiYWNrZ3JvdW5kOnZhcigtLWJnLXNlY29uZGFyeSk7Ym9yZGVyLXJhZGl1czo2cHhcIj4nICtcbiAgICAnPGlucHV0IHR5cGU9XCJ0ZXh0XCIgaWQ9XCJyZWNvLXNlYXJjaFwiIHBsYWNlaG9sZGVyPVwiQnVzY2FyIFNLVSBvIGRlc2NyaXBjaW9uLi4uXCIgdmFsdWU9XCInICtcbiAgICBlc2NhcGVIdG1sU2FmZShfcmVjb1NlYXJjaFRleHQpICtcbiAgICAnXCIgb25pbnB1dD1cIm9uUmVjb1NlYXJjaENoYW5nZShldmVudClcIiBzdHlsZT1cImZsZXg6MTttaW4td2lkdGg6MjAwcHg7cGFkZGluZzo2cHggMTBweDtib3JkZXI6MXB4IHNvbGlkIHZhcigtLWJvcmRlci1zdWJ0bGUpO2JvcmRlci1yYWRpdXM6NHB4O2ZvbnQtc2l6ZToxMnB4O2JhY2tncm91bmQ6dmFyKC0tYmctZWxldmF0ZWQpO2NvbG9yOnZhcigtLXRleHQtcHJpbWFyeSlcIi8+JyArXG4gICAgJzxzZWxlY3Qgb25jaGFuZ2U9XCJvblJlY29GYW1pbGlhQ2hhbmdlKGV2ZW50KVwiIHN0eWxlPVwicGFkZGluZzo2cHggMTBweDtib3JkZXI6MXB4IHNvbGlkIHZhcigtLWJvcmRlci1zdWJ0bGUpO2JvcmRlci1yYWRpdXM6NHB4O2ZvbnQtc2l6ZToxMnB4O2JhY2tncm91bmQ6dmFyKC0tYmctZWxldmF0ZWQpO2NvbG9yOnZhcigtLXRleHQtcHJpbWFyeSlcIj4nICtcbiAgICAnPG9wdGlvbiB2YWx1ZT1cImFsbFwiJyArXG4gICAgKF9yZWNvRmlsdGVyRmFtaWxpYSA9PT0gJ2FsbCcgPyAnIHNlbGVjdGVkJyA6ICcnKSArXG4gICAgJz5Ub2RhcyBsYXMgZmFtaWxpYXM8L29wdGlvbj4nICtcbiAgICAnPG9wdGlvbiB2YWx1ZT1cInJvZHNcIicgK1xuICAgIChfcmVjb0ZpbHRlckZhbWlsaWEgPT09ICdyb2RzJyA/ICcgc2VsZWN0ZWQnIDogJycpICtcbiAgICAnPlNvbG8gUm9kcyAoQ2FcdTAwRjFhcyk8L29wdGlvbj4nICtcbiAgICAnPG9wdGlvbiB2YWx1ZT1cInJlZWxzXCInICtcbiAgICAoX3JlY29GaWx0ZXJGYW1pbGlhID09PSAncmVlbHMnID8gJyBzZWxlY3RlZCcgOiAnJykgK1xuICAgICc+U29sbyBSZWVsczwvb3B0aW9uPicgK1xuICAgICc8L3NlbGVjdD4nICtcbiAgICAnPGxhYmVsIHN0eWxlPVwiZGlzcGxheTppbmxpbmUtZmxleDthbGlnbi1pdGVtczpjZW50ZXI7Z2FwOjZweDtwYWRkaW5nOjZweCAxMHB4O2ZvbnQtc2l6ZToxMnB4O2NvbG9yOnZhcigtLXRleHQtcHJpbWFyeSk7Y3Vyc29yOnBvaW50ZXJcIj4nICtcbiAgICAnPGlucHV0IHR5cGU9XCJjaGVja2JveFwiJyArXG4gICAgKF9yZWNvRmlsdGVyTWluUmVjID8gJyBjaGVja2VkJyA6ICcnKSArXG4gICAgJyBvbmNoYW5nZT1cIm9uUmVjb0ZpbHRlck1pbkNoYW5nZShldmVudClcIi8+JyArXG4gICAgJ1NvbG8gY29uIHJlY29tZW5kYWRvICZndDsgMDwvbGFiZWw+JyArXG4gICAgJzxidXR0b24gb25jbGljaz1cImV4cG9ydFJlY29FeGNlbCgpXCIgc3R5bGU9XCJwYWRkaW5nOjZweCAxMnB4O2JhY2tncm91bmQ6IzE2YTM0YTtjb2xvcjojZmZmO2JvcmRlcjpub25lO2JvcmRlci1yYWRpdXM6NHB4O2ZvbnQtc2l6ZToxMnB4O2ZvbnQtd2VpZ2h0OjcwMDtjdXJzb3I6cG9pbnRlclwiPlx1MkIwNyBFeGNlbDwvYnV0dG9uPicgK1xuICAgICc8L2Rpdj4nO1xuXG4gIGNvbnN0IHJvd3NIdG1sID0gcm93c1xuICAgIC5tYXAoKHIpID0+IHtcbiAgICAgIGNvbnN0IGJhbENvbG9yID0gci5iYWxhbmNlIDwgMCA/ICcjZGMyNjI2JyA6IHIuYmFsYW5jZSA8IDUwID8gJyNmNTllMGInIDogJyMxNmEzNGEnO1xuICAgICAgY29uc3QgcmVjQ29sb3IgPSByLnJlY29tZW5kYWRvID4gMCA/ICcjZGMyNjI2JyA6ICcjOTRhM2I4JztcbiAgICAgIHJldHVybiAoXG4gICAgICAgICc8dHIgc3R5bGU9XCJib3JkZXItYm90dG9tOjFweCBzb2xpZCB2YXIoLS1ib3JkZXItc3VidGxlKVwiPicgK1xuICAgICAgICAnPHRkIHN0eWxlPVwicGFkZGluZzo2cHggOHB4O3RleHQtYWxpZ246Y2VudGVyXCI+PHNwYW4gc3R5bGU9XCJkaXNwbGF5OmlubGluZS1ibG9jaztwYWRkaW5nOjJweCA2cHg7Ym9yZGVyLXJhZGl1czoxMHB4O2JhY2tncm91bmQ6JyArXG4gICAgICAgIChyLmZhbWlsaWEgPT09ICdyb2RzJyA/ICcjMGVhNWU5JyA6ICcjOGI1Y2Y2JykgK1xuICAgICAgICAnO2NvbG9yOiNmZmY7Zm9udC1zaXplOjEwcHg7Zm9udC13ZWlnaHQ6NzAwXCI+JyArXG4gICAgICAgIChyLmZhbWlsaWEgPT09ICdyb2RzJyA/ICdST0QnIDogJ1JFRUwnKSArXG4gICAgICAgICc8L3NwYW4+PC90ZD4nICtcbiAgICAgICAgJzx0ZCBzdHlsZT1cInBhZGRpbmc6NnB4IDhweDt0ZXh0LWFsaWduOmNlbnRlcjtmb250LWZhbWlseTptb25vc3BhY2U7Zm9udC1zaXplOjExcHg7Y29sb3I6dmFyKC0tdGV4dC1wcmltYXJ5KTtmb250LXdlaWdodDo3MDBcIj4nICtcbiAgICAgICAgZXNjYXBlSHRtbFNhZmUoci5za3UpICtcbiAgICAgICAgJzwvdGQ+JyArXG4gICAgICAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjZweCA4cHg7Zm9udC1zaXplOjExcHg7Y29sb3I6dmFyKC0tdGV4dC1zZWNvbmRhcnkpO21heC13aWR0aDoyNDBweDtvdmVyZmxvdzpoaWRkZW47dGV4dC1vdmVyZmxvdzplbGxpcHNpczt3aGl0ZS1zcGFjZTpub3dyYXBcIiB0aXRsZT1cIicgK1xuICAgICAgICBlc2NhcGVIdG1sU2FmZShyLmRlc2NyaXB0aW9uKSArXG4gICAgICAgICdcIj4nICtcbiAgICAgICAgZXNjYXBlSHRtbFNhZmUoci5kZXNjcmlwdGlvbikgK1xuICAgICAgICAnPC90ZD4nICtcbiAgICAgICAgJzx0ZCBzdHlsZT1cInBhZGRpbmc6NnB4IDhweDt0ZXh0LWFsaWduOmNlbnRlcjtmb250LXZhcmlhbnQtbnVtZXJpYzp0YWJ1bGFyLW51bXM7Y29sb3I6dmFyKC0tdGV4dC1wcmltYXJ5KVwiPicgK1xuICAgICAgICBfZm10SW50KHIuc3RvY2tMaWJyZSkgK1xuICAgICAgICAnPC90ZD4nICtcbiAgICAgICAgJzx0ZCBzdHlsZT1cInBhZGRpbmc6NnB4IDhweDt0ZXh0LWFsaWduOmNlbnRlcjtmb250LXZhcmlhbnQtbnVtZXJpYzp0YWJ1bGFyLW51bXM7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZClcIj4nICtcbiAgICAgICAgX2ZtdEludChyLmVuVHJhbnNpdG8pICtcbiAgICAgICAgJzwvdGQ+JyArXG4gICAgICAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjZweCA4cHg7dGV4dC1hbGlnbjpjZW50ZXI7Zm9udC12YXJpYW50LW51bWVyaWM6dGFidWxhci1udW1zO2NvbG9yOiNkYzI2MjZcIj4nICtcbiAgICAgICAgX2ZtdEludChyLmJhY2tvcmRlcikgK1xuICAgICAgICAnPC90ZD4nICtcbiAgICAgICAgJzx0ZCBzdHlsZT1cInBhZGRpbmc6NnB4IDhweDt0ZXh0LWFsaWduOmNlbnRlcjtmb250LXZhcmlhbnQtbnVtZXJpYzp0YWJ1bGFyLW51bXM7Y29sb3I6dmFyKC0tdGV4dC1zZWNvbmRhcnkpXCI+JyArXG4gICAgICAgIF9mbXRJbnQoci52ZW50YU1lbnN1YWwpICtcbiAgICAgICAgJzwvdGQ+JyArXG4gICAgICAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjZweCA4cHg7dGV4dC1hbGlnbjpjZW50ZXI7Zm9udC12YXJpYW50LW51bWVyaWM6dGFidWxhci1udW1zO2NvbG9yOnZhcigtLXRleHQtc2Vjb25kYXJ5KVwiPicgK1xuICAgICAgICBfZm10SW50KHIuZGVtYW5kYUVzcGVyYWRhKSArXG4gICAgICAgICc8L3RkPicgK1xuICAgICAgICAnPHRkIHN0eWxlPVwicGFkZGluZzo2cHggOHB4O3RleHQtYWxpZ246Y2VudGVyO2ZvbnQtdmFyaWFudC1udW1lcmljOnRhYnVsYXItbnVtcztjb2xvcjp2YXIoLS10ZXh0LXByaW1hcnkpO2ZvbnQtd2VpZ2h0OjYwMFwiPicgK1xuICAgICAgICBfZm10SW50KHIuc2FsZXNQbGFuRnV0KSArXG4gICAgICAgICc8L3RkPicgK1xuICAgICAgICAnPHRkIHN0eWxlPVwicGFkZGluZzo2cHggOHB4O3RleHQtYWxpZ246Y2VudGVyO2ZvbnQtdmFyaWFudC1udW1lcmljOnRhYnVsYXItbnVtcztmb250LXdlaWdodDo3MDA7Y29sb3I6JyArXG4gICAgICAgIGJhbENvbG9yICtcbiAgICAgICAgJ1wiPicgK1xuICAgICAgICBfZm10TnVtU2lnbmVkKHIuYmFsYW5jZSkgK1xuICAgICAgICAnPC90ZD4nICtcbiAgICAgICAgJzx0ZCBzdHlsZT1cInBhZGRpbmc6NnB4IDhweDt0ZXh0LWFsaWduOmNlbnRlcjtmb250LXZhcmlhbnQtbnVtZXJpYzp0YWJ1bGFyLW51bXM7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7Zm9udC1zaXplOjExcHhcIj4nICtcbiAgICAgICAgX2ZtdEludChyLm1vcSkgK1xuICAgICAgICAnPC90ZD4nICtcbiAgICAgICAgJzx0ZCBzdHlsZT1cInBhZGRpbmc6NnB4IDhweDt0ZXh0LWFsaWduOmNlbnRlclwiPjxzcGFuIHN0eWxlPVwiZGlzcGxheTppbmxpbmUtYmxvY2s7cGFkZGluZzo0cHggMTBweDtib3JkZXItcmFkaXVzOjEycHg7YmFja2dyb3VuZDonICtcbiAgICAgICAgcmVjQ29sb3IgK1xuICAgICAgICAnO2NvbG9yOiNmZmY7Zm9udC1zaXplOjEycHg7Zm9udC13ZWlnaHQ6ODAwO21pbi13aWR0aDo1MHB4XCI+JyArXG4gICAgICAgIF9mbXRJbnQoci5yZWNvbWVuZGFkbykgK1xuICAgICAgICAnPC9zcGFuPjwvdGQ+JyArXG4gICAgICAgICc8L3RyPidcbiAgICAgICk7XG4gICAgfSlcbiAgICAuam9pbignJyk7XG5cbiAgY29uc3QgdGFibGUgPVxuICAgICc8ZGl2IHN0eWxlPVwib3ZlcmZsb3c6YXV0bzttYXgtaGVpZ2h0OjYwdmg7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1ib3JkZXItc3VidGxlKTtib3JkZXItcmFkaXVzOjhweFwiPicgK1xuICAgICc8dGFibGUgc3R5bGU9XCJ3aWR0aDoxMDAlO2JvcmRlci1jb2xsYXBzZTpjb2xsYXBzZTtmb250LXNpemU6MTJweFwiPicgK1xuICAgICc8dGhlYWQgc3R5bGU9XCJiYWNrZ3JvdW5kOiMwZjE3MmE7Y29sb3I6I2ZmZjtwb3NpdGlvbjpzdGlja3k7dG9wOjA7ei1pbmRleDoxXCI+PHRyPicgK1xuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjhweDt0ZXh0LWFsaWduOmNlbnRlcjtmb250LXNpemU6MTBweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2VcIj5GYW08L3RoPicgK1xuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjhweDt0ZXh0LWFsaWduOmNlbnRlcjtmb250LXNpemU6MTBweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2VcIj5TS1U8L3RoPicgK1xuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjhweDt0ZXh0LWFsaWduOmNlbnRlcjtmb250LXNpemU6MTBweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2VcIj5EZXNjcmlwY2lcdTAwRjNuPC90aD4nICtcbiAgICAnPHRoIHN0eWxlPVwicGFkZGluZzo4cHg7dGV4dC1hbGlnbjpjZW50ZXI7Zm9udC1zaXplOjEwcHg7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlXCIgdGl0bGU9XCJXaHMgMTEgZGlzcG9uaWJsZSB2ZW50YVwiPlN0b2NrPC90aD4nICtcbiAgICAnPHRoIHN0eWxlPVwicGFkZGluZzo4cHg7dGV4dC1hbGlnbjpjZW50ZXI7Zm9udC1zaXplOjEwcHg7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlXCIgdGl0bGU9XCJXaHMgMTJcIj5Uclx1MDBFMW5zaXRvPC90aD4nICtcbiAgICAnPHRoIHN0eWxlPVwicGFkZGluZzo4cHg7dGV4dC1hbGlnbjpjZW50ZXI7Zm9udC1zaXplOjEwcHg7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlXCI+QmFja29yZGVyPC90aD4nICtcbiAgICAnPHRoIHN0eWxlPVwicGFkZGluZzo4cHg7dGV4dC1hbGlnbjpjZW50ZXI7Zm9udC1zaXplOjEwcHg7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlXCIgdGl0bGU9XCJQcm9tZWRpbyBcdTAwRkFsdGltb3MgMyBtZXNlc1wiPlZ0YS9tZXM8L3RoPicgK1xuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjhweDt0ZXh0LWFsaWduOmNlbnRlcjtmb250LXNpemU6MTBweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2VcIiB0aXRsZT1cIlZ0YS9tZXMgXHUwMEQ3IDcgbWVzZXNcIj5EZW1hbmRhIGVzcC48L3RoPicgK1xuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjhweDt0ZXh0LWFsaWduOmNlbnRlcjtmb250LXNpemU6MTBweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2VcIiB0aXRsZT1cIlN1bWEgY29sdW1uYXMgU2FsZXMgUGxhbiBkZXNkZSBtZXMgYWN0dWFsXCI+UGxhbiBmdXR1cm88L3RoPicgK1xuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjhweDt0ZXh0LWFsaWduOmNlbnRlcjtmb250LXNpemU6MTBweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2VcIj5CYWxhbmNlPC90aD4nICtcbiAgICAnPHRoIHN0eWxlPVwicGFkZGluZzo4cHg7dGV4dC1hbGlnbjpjZW50ZXI7Zm9udC1zaXplOjEwcHg7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlXCI+TU9RPC90aD4nICtcbiAgICAnPHRoIHN0eWxlPVwicGFkZGluZzo4cHg7dGV4dC1hbGlnbjpjZW50ZXI7Zm9udC1zaXplOjEwcHg7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO2JhY2tncm91bmQ6IzEzNGU0YVwiPlJlY29tZW5kYWRvPC90aD4nICtcbiAgICAnPC90cj48L3RoZWFkPjx0Ym9keT4nICtcbiAgICAocm93cy5sZW5ndGhcbiAgICAgID8gcm93c0h0bWxcbiAgICAgIDogJzx0cj48dGQgY29sc3Bhbj1cIjEyXCIgc3R5bGU9XCJwYWRkaW5nOjQwcHg7dGV4dC1hbGlnbjpjZW50ZXI7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZClcIj5TaW4gcmVzdWx0YWRvcyBjb24gbG9zIGZpbHRyb3MgYWN0dWFsZXM8L3RkPjwvdHI+JykgK1xuICAgICc8L3Rib2R5PjwvdGFibGU+PC9kaXY+JztcblxuICBjb25zdCBmb290ZXIgPVxuICAgICc8ZGl2IHN0eWxlPVwibWFyZ2luLXRvcDo4cHg7Zm9udC1zaXplOjEwcHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZClcIj4nICtcbiAgICAnTW9zdHJhbmRvICcgK1xuICAgIF9mbXRJbnQocm93cy5sZW5ndGgpICtcbiAgICAnIGRlICcgK1xuICAgIF9mbXRJbnQoYWxsUm93cy5sZW5ndGgpICtcbiAgICAnIFNLVXMgXHUwMEI3ICcgK1xuICAgICdCYWxhbmNlID0gU3RvY2sgKyBUclx1MDBFMW5zaXRvICsgUGxhbiBcdTIyMTIgQmFja29yZGVyIFx1MjIxMiBEZW1hbmRhLiBSb2pvID0gcXVpZWJyZSBlc3BlcmFkby4gUmVjb21lbmRhZG8gc2UgcmVkb25kZWEgYWwgbVx1MDBGQWx0aXBsbyBkZSBNT1Egc3VwZXJpb3IuJyArXG4gICAgJzwvZGl2Pic7XG5cbiAgY29udC5pbm5lckhUTUwgPVxuICAgICc8ZGl2IHN0eWxlPVwicGFkZGluZzoxOHB4IDE4cHggMzBweFwiPicgKyBoZWFkZXIgKyBmaWx0ZXJzICsgdGFibGUgKyBmb290ZXIgKyAnPC9kaXY+Jztcbn1cblxud2luZG93Lm9uUmVjb1NlYXJjaENoYW5nZSA9IGZ1bmN0aW9uIChldikge1xuICBfcmVjb1NlYXJjaFRleHQgPSBldi50YXJnZXQudmFsdWUgfHwgJyc7XG4gIF9yZW5kZXJSZWNvU2VjdGlvbigpO1xuICAvLyBSZXN0YXVyYXIgZm9jdXMgKyBjYXJldCBhbCBpbnB1dFxuICBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICBjb25zdCBpbnAgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgncmVjby1zZWFyY2gnKTtcbiAgICBpZiAoaW5wKSB7XG4gICAgICBpbnAuZm9jdXMoKTtcbiAgICAgIGlucC5zZXRTZWxlY3Rpb25SYW5nZShpbnAudmFsdWUubGVuZ3RoLCBpbnAudmFsdWUubGVuZ3RoKTtcbiAgICB9XG4gIH0sIDApO1xufTtcblxud2luZG93Lm9uUmVjb0ZhbWlsaWFDaGFuZ2UgPSBmdW5jdGlvbiAoZXYpIHtcbiAgX3JlY29GaWx0ZXJGYW1pbGlhID0gZXYudGFyZ2V0LnZhbHVlIHx8ICdhbGwnO1xuICBfcmVuZGVyUmVjb1NlY3Rpb24oKTtcbn07XG5cbndpbmRvdy5vblJlY29GaWx0ZXJNaW5DaGFuZ2UgPSBmdW5jdGlvbiAoZXYpIHtcbiAgX3JlY29GaWx0ZXJNaW5SZWMgPSAhIWV2LnRhcmdldC5jaGVja2VkO1xuICBfcmVuZGVyUmVjb1NlY3Rpb24oKTtcbn07XG5cbndpbmRvdy5leHBvcnRSZWNvRXhjZWwgPSBmdW5jdGlvbiAoKSB7XG4gIGlmICh0eXBlb2YgWExTWCA9PT0gJ3VuZGVmaW5lZCcpIHtcbiAgICBhbGVydCgnU2hlZXRKUyAoWExTWCkgbm8gY2FyZ2FkbycpO1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCByb3dzID0gX2NvbXB1dGVSZWNvbW1lbmRhdGlvbnMoKTtcbiAgY29uc3QgYW9hID0gW1xuICAgIFtcbiAgICAgICdGYW1pbGlhJyxcbiAgICAgICdTS1UnLFxuICAgICAgJ0Rlc2NyaXBjaVx1MDBGM24nLFxuICAgICAgJ1N0b2NrJyxcbiAgICAgICdUclx1MDBFMW5zaXRvJyxcbiAgICAgICdCYWNrb3JkZXInLFxuICAgICAgJ1Z0YSBwcm9tL21lcycsXG4gICAgICAnRGVtYW5kYSBlc3AuIDdtJyxcbiAgICAgICdTYWxlcyBQbGFuIGZ1dHVybycsXG4gICAgICAnQmFsYW5jZScsXG4gICAgICAnTU9RJyxcbiAgICAgICdSZWNvbWVuZGFkbycsXG4gICAgXSxcbiAgXTtcbiAgZm9yIChjb25zdCByIG9mIHJvd3MpIHtcbiAgICBhb2EucHVzaChbXG4gICAgICByLmZhbWlsaWEgPT09ICdyb2RzJyA/ICdSb2RzIChDYVx1MDBGMWFzKScgOiAnUmVlbHMnLFxuICAgICAgci5za3UsXG4gICAgICByLmRlc2NyaXB0aW9uLFxuICAgICAgci5zdG9ja0xpYnJlLFxuICAgICAgci5lblRyYW5zaXRvLFxuICAgICAgci5iYWNrb3JkZXIsXG4gICAgICByLnZlbnRhTWVuc3VhbCxcbiAgICAgIHIuZGVtYW5kYUVzcGVyYWRhLFxuICAgICAgci5zYWxlc1BsYW5GdXQsXG4gICAgICByLmJhbGFuY2UsXG4gICAgICByLm1vcSxcbiAgICAgIHIucmVjb21lbmRhZG8sXG4gICAgXSk7XG4gIH1cbiAgY29uc3Qgd3MgPSBYTFNYLnV0aWxzLmFvYV90b19zaGVldChhb2EpO1xuICB3c1snIWNvbHMnXSA9IFtcbiAgICB7IHdjaDogMTQgfSxcbiAgICB7IHdjaDogMTggfSxcbiAgICB7IHdjaDogNDAgfSxcbiAgICB7IHdjaDogOCB9LFxuICAgIHsgd2NoOiAxMCB9LFxuICAgIHsgd2NoOiAxMSB9LFxuICAgIHsgd2NoOiAxMiB9LFxuICAgIHsgd2NoOiAxNSB9LFxuICAgIHsgd2NoOiAxNiB9LFxuICAgIHsgd2NoOiAxMCB9LFxuICAgIHsgd2NoOiA4IH0sXG4gICAgeyB3Y2g6IDEyIH0sXG4gIF07XG4gIGNvbnN0IHdiID0gWExTWC51dGlscy5ib29rX25ldygpO1xuICBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KHdiLCB3cywgJ1JlY29tZW5kYWNpXHUwMEYzbicpO1xuICBjb25zdCBob3kgPSBuZXcgRGF0ZSgpO1xuICBjb25zdCBzdGFtcCA9XG4gICAgaG95LmdldEZ1bGxZZWFyKCkgK1xuICAgICctJyArXG4gICAgU3RyaW5nKGhveS5nZXRNb250aCgpICsgMSkucGFkU3RhcnQoMiwgJzAnKSArXG4gICAgJy0nICtcbiAgICBTdHJpbmcoaG95LmdldERhdGUoKSkucGFkU3RhcnQoMiwgJzAnKTtcbiAgWExTWC53cml0ZUZpbGUod2IsICdSZWNvbWVuZGFjaW9uX0NvbXByYV8nICsgc3RhbXAgKyAnLnhsc3gnKTtcbn07XG4iXSwKICAibWFwcGluZ3MiOiAiOzs7QUFZQSxNQUFNLGdCQUFnQjtBQUFBLElBQ3BCLEtBQUs7QUFBQSxJQUNMLFNBQVM7QUFBQSxJQUNULEtBQUs7QUFBQSxJQUNMLE9BQU87QUFBQSxJQUNQLEtBQUs7QUFBQSxJQUNMLFVBQVU7QUFBQSxJQUNWLFNBQVM7QUFBQSxJQUNULEtBQUs7QUFBQSxJQUNMLE9BQU87QUFBQSxJQUNQLE9BQU87QUFBQSxJQUNQLEtBQUs7QUFBQSxJQUNMLE9BQU87QUFBQSxJQUNQLEtBQUs7QUFBQSxJQUNMLE9BQU87QUFBQSxJQUNQLEtBQUs7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
