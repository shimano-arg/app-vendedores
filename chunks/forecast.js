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
  var _forecastSnapshot = null;
  var _forecastSalesPlan = null;
  var _forecastRows = null;
  var _forecastLoading = false;
  var SALES_PLAN_FAMILIAS = [
    { key: "rods", label: "Rods (Ca\xF1as)", color: "#0ea5e9" },
    { key: "reels", label: "Reels", color: "#8b5cf6" },
    { key: "fg", label: "FG (resto)", color: "#f59e0b" }
  ];
  var _salesPlanCaches = { rods: null, reels: null, fg: null };
  var _forecastActiveTab = "sales-plans";
  var _forecastStatDocs = null;
  var _forecastStatMeta = null;
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
  function _monthKey(year, monthOneBased) {
    return String(year).padStart(4, "0") + "-" + String(monthOneBased).padStart(2, "0");
  }
  function _addMonths(year, monthOneBased, delta) {
    const totalMonths = year * 12 + (monthOneBased - 1) + delta;
    const y = Math.floor(totalMonths / 12);
    const m = totalMonths % 12 + 1;
    return { y, m };
  }
  function _sumVentas12mCompletos(mesesMap, hoy) {
    if (!mesesMap) return 0;
    let sum = 0;
    const startMonth = _addMonths(hoy.getFullYear(), hoy.getMonth() + 1, -12);
    const endMonth = _addMonths(hoy.getFullYear(), hoy.getMonth() + 1, -1);
    const startKey = _monthKey(startMonth.y, startMonth.m);
    const endKey = _monthKey(endMonth.y, endMonth.m);
    for (const k of Object.keys(mesesMap)) {
      if (k >= startKey && k <= endKey) {
        sum += Number(mesesMap[k] && mesesMap[k].qty || 0);
      }
    }
    return sum;
  }
  function _sumVentasYTD(mesesMap, hoy) {
    const year = hoy.getFullYear();
    const mesActual = hoy.getMonth() + 1;
    let total = 0;
    if (mesesMap) {
      for (let m = 1; m <= mesActual; m++) {
        const k = _monthKey(year, m);
        total += Number(mesesMap[k] && mesesMap[k].qty || 0);
      }
    }
    return { totalYtd: total, mesesTranscurridos: mesActual };
  }
  async function _loadSnapshot() {
    if (_forecastSnapshot) return _forecastSnapshot;
    if (!window.fbDb) throw new Error("Firestore no inicializado");
    const snap = await window.fbDb.collection("sku_ventas_snapshot").get();
    const byOriginalSku = {};
    const byUpperSku = {};
    snap.forEach((doc) => {
      const d = doc.data();
      if (!d || !d.sku) return;
      const skuUpper = String(d.sku).trim().toUpperCase();
      const record = {
        sku: d.sku,
        itemName: d.itemName || "",
        familia: d.familia || "",
        subfamilia: d.subfamilia || "",
        meses: d.meses || {}
      };
      byOriginalSku[d.sku] = record;
      byUpperSku[skuUpper] = record;
    });
    _forecastSnapshot = { byOriginalSku, byUpperSku, count: snap.size };
    return _forecastSnapshot;
  }
  function _parseSalesPlanRows(rowsRaw) {
    if (!rowsRaw || !rowsRaw.length) return [];
    const headerRow = rowsRaw[0];
    let skuColIdx = -1;
    for (let i = 0; i < headerRow.length; i++) {
      const h = String(headerRow[i] || "").trim().toUpperCase();
      if (h === "SKU" || h === "ITEMCODE" || h === "ITEM" || h === "ITEM CODE" || h === "CODIGO") {
        skuColIdx = i;
        break;
      }
    }
    if (skuColIdx < 0)
      throw new Error('El Excel debe tener una columna llamada "SKU" (o Codigo / ItemCode / Item)');
    const monthCols = [];
    for (let i = 0; i < headerRow.length && monthCols.length < 6; i++) {
      if (i !== skuColIdx) monthCols.push(i);
    }
    if (monthCols.length < 6)
      throw new Error(
        "El Excel debe tener al menos 6 columnas de meses ademas de SKU (encontradas: " + monthCols.length + ")"
      );
    const out = [];
    for (let r = 1; r < rowsRaw.length; r++) {
      const row = rowsRaw[r];
      if (!row || !row.length) continue;
      const skuRaw = row[skuColIdx];
      if (skuRaw === void 0 || skuRaw === null || String(skuRaw).trim() === "") continue;
      const sku = String(skuRaw).trim();
      const mesesArr = monthCols.map((i) => {
        const v = row[i];
        const n = Number(v);
        return Number.isFinite(n) ? n : 0;
      });
      const pedidoTotal = mesesArr.reduce((a, b) => a + b, 0);
      out.push({ sku, mesesArr, pedidoTotal });
    }
    return out;
  }
  function _computeForecastRows(snapshot, salesPlan, hoy) {
    const rows = [];
    for (const sp of salesPlan) {
      const skuUpper = sp.sku.toUpperCase();
      const hist = snapshot.byUpperSku[skuUpper] || null;
      const ventas12m = hist ? _sumVentas12mCompletos(hist.meses, hoy) : 0;
      const ytd = hist ? _sumVentasYTD(hist.meses, hoy) : { totalYtd: 0, mesesTranscurridos: hoy.getMonth() + 1 };
      const promedio = ytd.mesesTranscurridos > 0 ? ytd.totalYtd / ytd.mesesTranscurridos : 0;
      const politica = promedio * 3;
      const total = sp.pedidoTotal - politica;
      rows.push({
        sku: sp.sku,
        itemName: hist ? hist.itemName : "",
        familia: hist ? hist.familia : "(sin match)",
        subfamilia: hist ? hist.subfamilia : "(sin match)",
        ventas12m,
        pedido6m: sp.pedidoTotal,
        promedio,
        politica,
        total,
        hasHistoria: !!hist
      });
    }
    return rows;
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
    const tabsBar = `<div id="forecast-tabs-bar" style="display:flex;gap:0;background:var(--bg-secondary);padding:0 18px;border-bottom:1px solid var(--border-subtle)"><button data-tab="sales-plans" onclick="switchForecastTab('sales-plans')" class="forecast-tab" style="padding:10px 16px;background:transparent;color:var(--text-primary);border:none;border-bottom:3px solid #0d9488;cursor:pointer;font-weight:700;font-size:12px;letter-spacing:.4px;text-transform:uppercase">Sales Plans</button><button data-tab="stat" onclick="switchForecastTab('stat')" class="forecast-tab" style="padding:10px 16px;background:transparent;color:var(--text-muted);border:none;border-bottom:3px solid transparent;cursor:pointer;font-weight:600;font-size:12px;letter-spacing:.4px;text-transform:uppercase">Forecast Estad\xEDstico</button><button data-tab="legacy" onclick="switchForecastTab('legacy')" class="forecast-tab" style="padding:10px 16px;background:transparent;color:var(--text-muted);border:none;border-bottom:3px solid transparent;cursor:pointer;font-weight:600;font-size:12px;letter-spacing:.4px;text-transform:uppercase">Legacy (6m)</button></div>`;
    const tabSalesPlans = '<div id="forecast-tab-sales-plans" style="flex:1;overflow:auto"></div>';
    const tabStat = '<div id="forecast-tab-stat" style="flex:1;overflow:auto;display:none"></div>';
    const legacyBar = '<div style="padding:12px 18px;background:var(--bg-secondary);border-bottom:1px solid var(--border-subtle);display:flex;flex-wrap:wrap;gap:14px;align-items:center"><label style="display:inline-flex;align-items:center;gap:8px;padding:8px 12px;background:#0d9488;color:#fff;border-radius:6px;font-weight:700;font-size:12px;cursor:pointer"><span>Cargar Sales Plan (.xlsx)</span><input type="file" accept=".xlsx,.xls" style="display:none" onchange="onForecastSalesPlanFile(event)"/></label><div id="forecast-hint" style="font-size:11px;color:var(--text-muted);max-width:520px">Formato legacy: primera columna <b>SKU</b>, luego 6 columnas con las unidades pedidas mes a mes.</div><button id="forecast-export-btn" onclick="exportForecastExcel()" disabled style="padding:8px 14px;background:var(--color-success);color:#fff;border:none;border-radius:6px;font-weight:700;cursor:pointer;opacity:.5">Exportar Excel</button><div id="forecast-stats" style="margin-left:auto;font-size:11px;color:var(--text-secondary);font-weight:600"></div></div>';
    const legacyBody = '<div id="forecast-body" style="flex:1;overflow:auto;padding:0"><div style="padding:60px 20px;text-align:center;color:var(--text-muted);font-size:14px">Esperando archivo Sales Plan...</div></div>';
    const tabLegacy = '<div id="forecast-tab-legacy" style="flex:1;overflow:hidden;flex-direction:column;display:none">' + legacyBar + legacyBody + "</div>";
    return modalOuter + header + tabsBar + tabSalesPlans + tabStat + tabLegacy + "</div>";
  }
  window.switchForecastTab = function(tabId) {
    _forecastActiveTab = tabId;
    const sp = document.getElementById("forecast-tab-sales-plans");
    const st = document.getElementById("forecast-tab-stat");
    const lg = document.getElementById("forecast-tab-legacy");
    if (sp) sp.style.display = tabId === "sales-plans" ? "block" : "none";
    if (st) st.style.display = tabId === "stat" ? "block" : "none";
    if (lg) lg.style.display = tabId === "legacy" ? "flex" : "none";
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
  function _renderTable(rows) {
    const body = document.getElementById("forecast-body");
    if (!body) return;
    if (!rows || !rows.length) {
      body.innerHTML = '<div style="padding:60px 20px;text-align:center;color:var(--text-muted)">Sales Plan vacio o sin filas validas.</div>';
      return;
    }
    const fmt = (n) => n === 0 || !Number.isFinite(n) ? "0" : Number(n).toLocaleString("es-AR", { maximumFractionDigits: 1 });
    const colorForTotal = (t) => {
      if (t > 0) return "#166534";
      if (t < 0) return "#c2410c";
      return "#475569";
    };
    const rowsHtml = rows.map(
      (r) => "<tr" + (r.hasHistoria ? "" : ' style="background:var(--color-warning-bg)"') + '><td style="padding:6px 10px;font-family:monospace;font-size:11px;white-space:nowrap">' + escapeHtmlSafe(r.sku) + '</td><td style="padding:6px 10px;font-size:11px">' + escapeHtmlSafe(r.familia) + '</td><td style="padding:6px 10px;font-size:11px">' + escapeHtmlSafe(r.subfamilia) + '</td><td style="padding:6px 10px;text-align:right;font-variant-numeric:tabular-nums">' + fmt(r.ventas12m) + '</td><td style="padding:6px 10px;text-align:right;font-variant-numeric:tabular-nums;font-weight:600">' + fmt(r.pedido6m) + '</td><td style="padding:6px 10px;text-align:right;font-variant-numeric:tabular-nums;color:var(--text-muted)">' + fmt(r.promedio) + '</td><td style="padding:6px 10px;text-align:right;font-variant-numeric:tabular-nums">' + fmt(r.politica) + '</td><td style="padding:6px 10px;text-align:right;font-variant-numeric:tabular-nums;font-weight:700;color:' + colorForTotal(r.total) + '">' + fmt(r.total) + "</td></tr>"
    ).join("");
    const header = '<thead style="position:sticky;top:0;background:#0f172a;color:#fff;z-index:1"><tr><th style="padding:8px 10px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.4px">SKU</th><th style="padding:8px 10px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.4px">Familia</th><th style="padding:8px 10px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.4px">Subfamilia</th><th style="padding:8px 10px;text-align:right;font-size:11px;text-transform:uppercase;letter-spacing:.4px" title="Suma de qty facturada en los ultimos 12 meses completos">Ventas 12m</th><th style="padding:8px 10px;text-align:right;font-size:11px;text-transform:uppercase;letter-spacing:.4px" title="Suma de las 6 columnas del Excel Sales Plan">Pedido 6m</th><th style="padding:8px 10px;text-align:right;font-size:11px;text-transform:uppercase;letter-spacing:.4px" title="Ventas YTD / meses transcurridos del a\xF1o">Prom / Mes</th><th style="padding:8px 10px;text-align:right;font-size:11px;text-transform:uppercase;letter-spacing:.4px" title="Promedio x 3 meses (politica de inventario)">Politica</th><th style="padding:8px 10px;text-align:right;font-size:11px;text-transform:uppercase;letter-spacing:.4px" title="Pedido 6m - Politica. Negativo = te falta pedir; Positivo = sobrepedido">Total</th></tr></thead>';
    body.innerHTML = '<table style="width:100%;border-collapse:collapse;font-size:12px">' + header + "<tbody>" + rowsHtml + "</tbody></table>";
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
    const intro = '<div style="margin-bottom:16px;padding:12px 14px;background:var(--bg-secondary);border-left:3px solid #0d9488;border-radius:6px;font-size:12px;color:var(--text-secondary);line-height:1.5"><b style="color:var(--text-primary)">Fase 1</b> \u2014 Carg\xE1 los 3 Sales Plans mensuales (Rods / Reels / FG). Se parsea la hoja <b>SAR</b>: SKU, MOQ 12 months, y una columna por mes. El Excel original queda snapshotado en Storage y el parseo queda en Firestore para el c\xE1lculo (pr\xF3xima fase).</div>';
    const grid = '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px">' + slots + "</div>";
    cont.innerHTML = '<div style="padding:18px">' + intro + grid + "</div>";
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
      _salesPlanCaches[familia] = payload;
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
    if (_forecastLoading) return;
    if (!_forecastSnapshot) {
      _forecastLoading = true;
      const stats = document.getElementById("forecast-stats");
      if (stats) stats.textContent = "Cargando snapshot de ventas...";
      try {
        await _loadSnapshot();
        if (stats) stats.textContent = _forecastSnapshot.count + " SKUs en snapshot historico";
      } catch (e) {
        if (stats) stats.textContent = "Error cargando snapshot: " + (e && e.message || e);
        console.warn("[FORECAST] snapshot load fail (legacy tab)", e);
      } finally {
        _forecastLoading = false;
      }
    } else {
      const stats = document.getElementById("forecast-stats");
      if (stats) stats.textContent = _forecastSnapshot.count + " SKUs en snapshot historico";
    }
  };
  window.closeForecastModal = function() {
    const el = document.getElementById("forecast-modal");
    if (el) el.style.display = "none";
  };
  window.onForecastSalesPlanFile = async function(event) {
    const file = event && event.target && event.target.files && event.target.files[0];
    if (!file) return;
    try {
      if (!_forecastSnapshot) await _loadSnapshot();
      const buf = await file.arrayBuffer();
      if (typeof XLSX === "undefined") {
        alert("XLSX no cargado");
        return;
      }
      const wb = XLSX.read(buf, { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true });
      const parsed = _parseSalesPlanRows(rows);
      if (!parsed.length) {
        alert("El Excel esta vacio o no tiene filas validas.");
        return;
      }
      _forecastSalesPlan = parsed;
      const hoy = /* @__PURE__ */ new Date();
      _forecastRows = _computeForecastRows(_forecastSnapshot, parsed, hoy);
      _renderTable(_forecastRows);
      const sinMatch = _forecastRows.filter((r) => !r.hasHistoria).length;
      const stats = document.getElementById("forecast-stats");
      if (stats) {
        stats.textContent = parsed.length + " SKUs en Sales Plan \xB7 " + (parsed.length - sinMatch) + " con historia \xB7 " + sinMatch + " sin match (fondo amarillo)";
      }
      const btn = document.getElementById("forecast-export-btn");
      if (btn) {
        btn.disabled = false;
        btn.style.opacity = "1";
      }
    } catch (e) {
      console.error("[FORECAST] parse error:", e);
      alert("Error procesando el Excel:\n" + (e && e.message || e));
    } finally {
      if (event && event.target) event.target.value = "";
    }
  };
  window.exportForecastExcel = function() {
    if (!_forecastRows || !_forecastRows.length) {
      alert("No hay datos para exportar. Carga primero el Sales Plan.");
      return;
    }
    if (typeof XLSX === "undefined") {
      alert("XLSX no cargado");
      return;
    }
    const round1 = (n) => Math.round(Number(n || 0) * 10) / 10;
    const aoa = [
      [
        "SKU",
        "FAMILIA",
        "SUBFAMILIA",
        "VENTAS (12m)",
        "PEDIDO-SALES PLANS (6m)",
        "PROMEDIO DE INVENTARIO",
        "POLITICA DE INVENTARIO (3m)",
        "TOTAL"
      ]
    ];
    for (const r of _forecastRows) {
      aoa.push([
        r.sku,
        r.familia,
        r.subfamilia,
        round1(r.ventas12m),
        round1(r.pedido6m),
        round1(r.promedio),
        round1(r.politica),
        round1(r.total)
      ]);
    }
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = [
      { wch: 18 },
      { wch: 24 },
      { wch: 24 },
      { wch: 14 },
      { wch: 20 },
      { wch: 20 },
      { wch: 22 },
      { wch: 12 }
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "FORECAST");
    const hoy = /* @__PURE__ */ new Date();
    const stamp = hoy.getFullYear() + "-" + String(hoy.getMonth() + 1).padStart(2, "0") + "-" + String(hoy.getDate()).padStart(2, "0");
    XLSX.writeFile(wb, "Forecast_Shimano_" + stamp + ".xlsx");
  };
  window.reloadForecastSnapshot = async function() {
    _forecastSnapshot = null;
    await _loadSnapshot();
    if (_forecastSalesPlan) {
      const hoy = /* @__PURE__ */ new Date();
      _forecastRows = _computeForecastRows(_forecastSnapshot, _forecastSalesPlan, hoy);
      _renderTable(_forecastRows);
    }
  };
})();
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL3B1cmUvc2FsZXMtcGxhbi1wYXJzZXIuanMiLCAiLi4vc3JjL2RvbWFpbnMvZm9yZWNhc3QuanMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbIi8vIEB0cy1ub2NoZWNrXHJcbi8vIFB1cmU6IHBhcnNlYSB1biBzaGVldCBTYWxlcyBQbGFuIChmb3JtYXRvIFNVUi9TQVIgZGUgU2hpbWFubykgYSBlc3RydWN0dXJhXHJcbi8vIG5vcm1hbGl6YWRhIHsgc2t1LCBkZXNjcmlwdGlvbiwgbW9xLCBtb250aHM6IHsnWVlZWS1NTSc6IE59IH0uXHJcbi8vIFNpbiBkZXBlbmRlbmNpYXMgXHUyMDE0IHJlY2liZSBlbCBzaGVldCB5YSBkZXNlcmlhbGl6YWRvIHBvciBTaGVldEpTXHJcbi8vIChYTFNYLnV0aWxzLnNoZWV0X3RvX2pzb24oc2hlZXQsIHtoZWFkZXI6MSwgZGVmdmFsOicnfSkpLlxyXG4vLyBUZXN0ZWFibGUgZW4gdml0ZXN0IHNpbiBjYXJnYXIgWExTWC5cclxuLy9cclxuLy8gQ29udGV4dG86IGxvcyBTYWxlcyBQbGFucyBkZSBTaGltYW5vIHZpZW5lbiBjb24gaGVhZGVycyBjb21vXHJcbi8vIFwiU0tVIENvZGUvUGFydCBOb1wiLCBcIkRlc2NyaXB0aW9uXCIsIFwiTU9RIDEyIG1vbnRoc1wiIHkgY29sdW1uYXMgZGUgbWVzZXNcclxuLy8gdGlwbyBcIkphbiAyMDI3XCIsIFwiTWF5IDIwMjdcIiAoYSB2ZWNlcyBjb24gYVx1MDBGMW8gZW4gdW5hIGZpbGEgYXJyaWJhIHkgZWwgbWVzXHJcbi8vIGVuIGxhIGZpbGEgaGVhZGVyKS4gRXN0YSBmbiB0b2xlcmEgYW1ib3MgbGF5b3V0cy5cclxuXHJcbmNvbnN0IE1PTlRIX0FMSUFTRVMgPSB7XHJcbiAgamFuOiAxLFxyXG4gIGphbnVhcnk6IDEsXHJcbiAgZW5lOiAxLFxyXG4gIGVuZXJvOiAxLFxyXG4gIGZlYjogMixcclxuICBmZWJydWFyeTogMixcclxuICBmZWJyZXJvOiAyLFxyXG4gIG1hcjogMyxcclxuICBtYXJjaDogMyxcclxuICBtYXJ6bzogMyxcclxuICBhcHI6IDQsXHJcbiAgYXByaWw6IDQsXHJcbiAgYWJyOiA0LFxyXG4gIGFicmlsOiA0LFxyXG4gIG1heTogNSxcclxuICBtYXlvOiA1LFxyXG4gIGp1bjogNixcclxuICBqdW5lOiA2LFxyXG4gIGp1bmlvOiA2LFxyXG4gIGp1bDogNyxcclxuICBqdWx5OiA3LFxyXG4gIGp1bGlvOiA3LFxyXG4gIGF1ZzogOCxcclxuICBhdWd1c3Q6IDgsXHJcbiAgYWdvOiA4LFxyXG4gIGFnb3N0bzogOCxcclxuICBzZXA6IDksXHJcbiAgc2VwdDogOSxcclxuICBzZXB0ZW1iZXI6IDksXHJcbiAgc2VwdGllbWJyZTogOSxcclxuICBvY3Q6IDEwLFxyXG4gIG9jdG9iZXI6IDEwLFxyXG4gIG9jdHVicmU6IDEwLFxyXG4gIG5vdjogMTEsXHJcbiAgbm92ZW1iZXI6IDExLFxyXG4gIG5vdmllbWJyZTogMTEsXHJcbiAgZGVjOiAxMixcclxuICBkZWNlbWJlcjogMTIsXHJcbiAgZGljOiAxMixcclxuICBkaWNpZW1icmU6IDEyLFxyXG59O1xyXG5cclxuLy8gTm9ybWFsaXphIGxhYmVscyBkZSBtZXNlcyBhICdZWVlZLU1NJy4gUmV0b3JuYSBudWxsIHNpIG5vIG1hdGNoZWEuXHJcbi8vIEZvcm1hdG9zIHNvcG9ydGFkb3M6IFwiSmFuIDIwMjdcIiwgXCJFbmUtMjdcIiwgXCJKYW4vMjAyN1wiLCBcIk1heTI3XCIsXHJcbi8vIFwiMjAyNy0wMVwiLCBcIjAxLzIwMjdcIiwgXCJKYW4uMjAyN1wiLCBcIjIwMjFcXG5KYW5cIiAobXVsdGktbGluZSBFeGNlbCkuXHJcbmZ1bmN0aW9uIG5vcm1hbGl6ZU1vbnRoTGFiZWwobGFiZWwpIHtcclxuICBpZiAobGFiZWwgPT0gbnVsbCkgcmV0dXJuIG51bGw7XHJcbiAgLy8gdjExMDQ6IGNvbGFwc2FyIG5ld2xpbmVzL3RhYnMgYSBlc3BhY2lvIGFudGVzIGRlbCB0cmltLlxyXG4gIC8vIEVsIGZvcm1hdG8gRXhjZWwgXCIyMDIxXFxuSmFuXCIgKGFcdTAwRjFvIGVuIEwxLCBtZXMgZW4gTDIgZGVudHJvIGRlIHVuYSBjZWxkYVxyXG4gIC8vIG11bHRpLXJvdykgZXMgY29tXHUwMEZBbiBlbiBTYWxlcyBQbGFucyBTVVIuIGBcXHMrYCBtYXRjaGVhIHdoaXRlc3BhY2UgaW5jbHV5ZW5kb1xyXG4gIC8vIFxcbiB5IFxcclxcbi5cclxuICBjb25zdCBzID0gU3RyaW5nKGxhYmVsKS5yZXBsYWNlKC9cXHMrL2csICcgJykudHJpbSgpLnRvTG93ZXJDYXNlKCk7XHJcbiAgaWYgKCFzKSByZXR1cm4gbnVsbDtcclxuICBsZXQgbTtcclxuICAvLyBcImphbiAyMDI3XCIgfCBcImphbi0yN1wiIHwgXCJlbmUvMjAyN1wiIHwgXCJtYXkyN1wiIHwgXCJtYXkuMjAyN1wiXHJcbiAgbSA9IHMubWF0Y2goL14oW2Etelx1MDBFMVx1MDBFOVx1MDBFRFx1MDBGM1x1MDBGQV17MywxMH0pW1xcc1xcLS8uX10qKFxcZHsyLDR9KSQvKTtcclxuICBpZiAobSkge1xyXG4gICAgY29uc3QgbW9uID0gTU9OVEhfQUxJQVNFU1ttWzFdXSB8fCBNT05USF9BTElBU0VTW21bMV0uc2xpY2UoMCwgMyldO1xyXG4gICAgaWYgKG1vbikge1xyXG4gICAgICBsZXQgeSA9IHBhcnNlSW50KG1bMl0sIDEwKTtcclxuICAgICAgaWYgKHkgPCAxMDApIHkgPSAyMDAwICsgeTtcclxuICAgICAgcmV0dXJuIFN0cmluZyh5KS5wYWRTdGFydCg0LCAnMCcpICsgJy0nICsgU3RyaW5nKG1vbikucGFkU3RhcnQoMiwgJzAnKTtcclxuICAgIH1cclxuICB9XHJcbiAgLy8gXCIyMDIxIGphblwiIHwgXCIyMDI3IGRpY1wiIChhXHUwMEYxbyBwcmltZXJvICsgbWVzLCBmb3JtYXRvIEV4Y2VsIG11bHRpLWxpbmVcclxuICAvLyBjb2xhcHNhZG8gdHJhcyByZXBsYWNlIFxccyspLlxyXG4gIG0gPSBzLm1hdGNoKC9eKFxcZHs0fSlbXFxzXFwtLy5fXSsoW2Etelx1MDBFMVx1MDBFOVx1MDBFRFx1MDBGM1x1MDBGQV17MywxMH0pJC8pO1xyXG4gIGlmIChtKSB7XHJcbiAgICBjb25zdCB5ID0gcGFyc2VJbnQobVsxXSwgMTApO1xyXG4gICAgY29uc3QgbW9uID0gTU9OVEhfQUxJQVNFU1ttWzJdXSB8fCBNT05USF9BTElBU0VTW21bMl0uc2xpY2UoMCwgMyldO1xyXG4gICAgaWYgKG1vbikgcmV0dXJuIFN0cmluZyh5KS5wYWRTdGFydCg0LCAnMCcpICsgJy0nICsgU3RyaW5nKG1vbikucGFkU3RhcnQoMiwgJzAnKTtcclxuICB9XHJcbiAgLy8gXCIyMDI3LTAxXCIgfCBcIjIwMjcvMDFcIlxyXG4gIG0gPSBzLm1hdGNoKC9eKFxcZHs0fSlbLS9dKFxcZHsxLDJ9KSQvKTtcclxuICBpZiAobSkge1xyXG4gICAgY29uc3QgeSA9IHBhcnNlSW50KG1bMV0sIDEwKTtcclxuICAgIGNvbnN0IG1vbiA9IHBhcnNlSW50KG1bMl0sIDEwKTtcclxuICAgIGlmIChtb24gPj0gMSAmJiBtb24gPD0gMTIpXHJcbiAgICAgIHJldHVybiBTdHJpbmcoeSkucGFkU3RhcnQoNCwgJzAnKSArICctJyArIFN0cmluZyhtb24pLnBhZFN0YXJ0KDIsICcwJyk7XHJcbiAgfVxyXG4gIC8vIFwiMDEvMjAyN1wiIHwgXCIwMS0yMDI3XCJcclxuICBtID0gcy5tYXRjaCgvXihcXGR7MSwyfSlbLS9dKFxcZHs0fSkkLyk7XHJcbiAgaWYgKG0pIHtcclxuICAgIGNvbnN0IG1vbiA9IHBhcnNlSW50KG1bMV0sIDEwKTtcclxuICAgIGNvbnN0IHkgPSBwYXJzZUludChtWzJdLCAxMCk7XHJcbiAgICBpZiAobW9uID49IDEgJiYgbW9uIDw9IDEyKVxyXG4gICAgICByZXR1cm4gU3RyaW5nKHkpLnBhZFN0YXJ0KDQsICcwJykgKyAnLScgKyBTdHJpbmcobW9uKS5wYWRTdGFydCgyLCAnMCcpO1xyXG4gIH1cclxuICByZXR1cm4gbnVsbDtcclxufVxyXG5cclxuLy8gQnVzY2EgbGEgZmlsYSBoZWFkZXIgKDAtYmFzZWQpLiBFc2NhbmVhIGxhcyBwcmltZXJhcyAzMCBmaWxhcy5cclxuZnVuY3Rpb24gZmluZEhlYWRlclJvdyhyb3dzKSB7XHJcbiAgY29uc3QgSEVBREVSX01BUktFUlMgPSBbXHJcbiAgICAnc2t1IGNvZGUvcGFydCBubycsXHJcbiAgICAnc2t1IGNvZGUnLFxyXG4gICAgJ3NrdScsXHJcbiAgICAncGFydCBubycsXHJcbiAgICAncGFydCBudW1iZXInLFxyXG4gICAgJ2l0ZW1jb2RlJyxcclxuICAgICdpdGVtIGNvZGUnLFxyXG4gICAgJ2NvZGlnbycsXHJcbiAgICAnY1x1MDBGM2RpZ28nLFxyXG4gIF07XHJcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBNYXRoLm1pbihyb3dzLmxlbmd0aCwgMzApOyBpKyspIHtcclxuICAgIGNvbnN0IHJvdyA9IHJvd3NbaV0gfHwgW107XHJcbiAgICBmb3IgKGNvbnN0IGNlbGwgb2Ygcm93KSB7XHJcbiAgICAgIC8vIHYxMTA0OiBjb2xhcHNhciBuZXdsaW5lcyBhIGVzcGFjaW8gcGFyYSBtYXRjaGVhciBoZWFkZXJzIGNvbW9cclxuICAgICAgLy8gXCJTS1UgQ29kZS9QYXJ0IE5vXCIgKG9rKSBvIFwiU0tVXFxuQ29kZVwiIChuZWNlc2l0YSBjb2xhcHNhcikuXHJcbiAgICAgIGNvbnN0IHMgPSBTdHJpbmcoY2VsbCA9PSBudWxsID8gJycgOiBjZWxsKVxyXG4gICAgICAgIC5yZXBsYWNlKC9cXHMrL2csICcgJylcclxuICAgICAgICAudHJpbSgpXHJcbiAgICAgICAgLnRvTG93ZXJDYXNlKCk7XHJcbiAgICAgIGlmIChIRUFERVJfTUFSS0VSUy5pbmRleE9mKHMpID49IDApIHJldHVybiBpO1xyXG4gICAgfVxyXG4gIH1cclxuICByZXR1cm4gLTE7XHJcbn1cclxuXHJcbi8vIERldGVjdGEgXHUwMEVEbmRpY2VzIGRlIGNvbHVtbmFzIHkgbWVzZXMuIGBoaW50Um93QWJvdmVgIHBlcm1pdGUgY29tYmluYXIgYVx1MDBGMW8vbWVzXHJcbi8vIGN1YW5kbyBlbCBoZWFkZXIgZXMgbXVsdGktcm93IChhXHUwMEYxbyBhcnJpYmEsIG1lcyBhYmFqbyBvIHZpY2V2ZXJzYSkuXHJcbmZ1bmN0aW9uIGRldGVjdENvbHVtbnMoaGVhZGVyUm93LCBoaW50Um93QWJvdmUpIHtcclxuICBsZXQgc2t1SWR4ID0gLTE7XHJcbiAgbGV0IGRlc2NJZHggPSAtMTtcclxuICBsZXQgbW9xSWR4ID0gLTE7XHJcbiAgY29uc3QgbW9udGhDb2x1bW5zID0gW107XHJcbiAgY29uc3QgZGV0ZWN0ZWRNb250aHNTZXQgPSBuZXcgU2V0KCk7XHJcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBoZWFkZXJSb3cubGVuZ3RoOyBpKyspIHtcclxuICAgIC8vIHYxMTA0OiBjb2xhcHNhciBuZXdsaW5lcyBhIGVzcGFjaW8gYW50ZXMgZGUgY29tcGFyYXIuIExvcyBTYWxlcyBQbGFuXHJcbiAgICAvLyBTVVIgdGllbmVuIGhlYWRlcnMgbXVsdGktbGluZSBjb21vIFwiTU9RXFxuMTIgbW9udGhzXCIgbyBcIkJhc2VcXG5GT0IoVVNEKVwiLlxyXG4gICAgY29uc3QgcmF3ID0gU3RyaW5nKGhlYWRlclJvd1tpXSA9PSBudWxsID8gJycgOiBoZWFkZXJSb3dbaV0pXHJcbiAgICAgIC5yZXBsYWNlKC9cXHMrL2csICcgJylcclxuICAgICAgLnRyaW0oKTtcclxuICAgIGNvbnN0IHMgPSByYXcudG9Mb3dlckNhc2UoKTtcclxuICAgIGlmIChcclxuICAgICAgc2t1SWR4IDwgMCAmJlxyXG4gICAgICAocyA9PT0gJ3NrdSBjb2RlL3BhcnQgbm8nIHx8XHJcbiAgICAgICAgcyA9PT0gJ3NrdSBjb2RlJyB8fFxyXG4gICAgICAgIHMgPT09ICdza3UnIHx8XHJcbiAgICAgICAgcyA9PT0gJ3BhcnQgbm8nIHx8XHJcbiAgICAgICAgcyA9PT0gJ3BhcnQgbnVtYmVyJyB8fFxyXG4gICAgICAgIHMgPT09ICdpdGVtY29kZScgfHxcclxuICAgICAgICBzID09PSAnaXRlbSBjb2RlJyB8fFxyXG4gICAgICAgIHMgPT09ICdjb2RpZ28nIHx8XHJcbiAgICAgICAgcyA9PT0gJ2NcdTAwRjNkaWdvJylcclxuICAgICkge1xyXG4gICAgICBza3VJZHggPSBpO1xyXG4gICAgICBjb250aW51ZTtcclxuICAgIH1cclxuICAgIGlmIChcclxuICAgICAgZGVzY0lkeCA8IDAgJiZcclxuICAgICAgKHMgPT09ICdkZXNjcmlwdGlvbicgfHxcclxuICAgICAgICBzID09PSAnZGVzY3JpcGNpb24nIHx8XHJcbiAgICAgICAgcyA9PT0gJ2Rlc2NyaXBjaVx1MDBGM24nIHx8XHJcbiAgICAgICAgcyA9PT0gJ2l0ZW0gbmFtZScgfHxcclxuICAgICAgICBzID09PSAnaXRlbW5hbWUnKVxyXG4gICAgKSB7XHJcbiAgICAgIGRlc2NJZHggPSBpO1xyXG4gICAgICBjb250aW51ZTtcclxuICAgIH1cclxuICAgIGlmIChtb3FJZHggPCAwICYmIChzID09PSAnbW9xIDEyIG1vbnRocycgfHwgcyA9PT0gJ21vcScgfHwgcy5pbmRleE9mKCdtb3EnKSA9PT0gMCkpIHtcclxuICAgICAgbW9xSWR4ID0gaTtcclxuICAgICAgY29udGludWU7XHJcbiAgICB9XHJcbiAgICAvLyBUcnkgZGlyZWN0IG1vbnRoIHBhcnNlXHJcbiAgICBsZXQgbW9udGhLZXkgPSBub3JtYWxpemVNb250aExhYmVsKHJhdyk7XHJcbiAgICBpZiAoIW1vbnRoS2V5ICYmIGhpbnRSb3dBYm92ZSAmJiBoaW50Um93QWJvdmVbaV0gIT0gbnVsbCkge1xyXG4gICAgICBjb25zdCBoaW50ID0gU3RyaW5nKGhpbnRSb3dBYm92ZVtpXSkudHJpbSgpO1xyXG4gICAgICBpZiAoaGludCkge1xyXG4gICAgICAgIG1vbnRoS2V5ID0gbm9ybWFsaXplTW9udGhMYWJlbChyYXcgKyAnICcgKyBoaW50KSB8fCBub3JtYWxpemVNb250aExhYmVsKGhpbnQgKyAnICcgKyByYXcpO1xyXG4gICAgICB9XHJcbiAgICB9XHJcbiAgICBpZiAobW9udGhLZXkpIHtcclxuICAgICAgbW9udGhDb2x1bW5zLnB1c2goeyBjb2xJZHg6IGksIG1vbnRoS2V5IH0pO1xyXG4gICAgICBkZXRlY3RlZE1vbnRoc1NldC5hZGQobW9udGhLZXkpO1xyXG4gICAgfVxyXG4gIH1cclxuICByZXR1cm4ge1xyXG4gICAgc2t1SWR4LFxyXG4gICAgZGVzY0lkeCxcclxuICAgIG1vcUlkeCxcclxuICAgIG1vbnRoQ29sdW1ucyxcclxuICAgIGRldGVjdGVkTW9udGhzOiBBcnJheS5mcm9tKGRldGVjdGVkTW9udGhzU2V0KS5zb3J0KCksXHJcbiAgfTtcclxufVxyXG5cclxuLy8gUHVibGljOiBwYXJzZSBmdWxsIHNoZWV0LiBUaHJvd3Mgb24gbWlzc2luZyBTS1UgY29sdW1uIC8gbW9udGhzLlxyXG5mdW5jdGlvbiBwYXJzZVNhbGVzUGxhblNoZWV0KHJvd3MpIHtcclxuICBpZiAoIXJvd3MgfHwgIXJvd3MubGVuZ3RoKSB7XHJcbiAgICBjb25zdCBlcnIgPSBuZXcgRXJyb3IoJ0V4Y2VsIHZhY2lvJyk7XHJcbiAgICBlcnIuY29kZSA9ICdFTVBUWV9TSEVFVCc7XHJcbiAgICB0aHJvdyBlcnI7XHJcbiAgfVxyXG4gIGNvbnN0IGhlYWRlcklkeCA9IGZpbmRIZWFkZXJSb3cocm93cyk7XHJcbiAgaWYgKGhlYWRlcklkeCA8IDApIHtcclxuICAgIGNvbnN0IGVyciA9IG5ldyBFcnJvcignTm8gc2UgZW5jb250cm8gZmlsYSBkZSBoZWFkZXJzIChidXNjYWJhIFwiU0tVIENvZGUvUGFydCBOb1wiIG8gXCJTS1VcIiknKTtcclxuICAgIGVyci5jb2RlID0gJ0hFQURFUl9OT1RfRk9VTkQnO1xyXG4gICAgdGhyb3cgZXJyO1xyXG4gIH1cclxuICBjb25zdCBoZWFkZXJSb3cgPSByb3dzW2hlYWRlcklkeF0gfHwgW107XHJcbiAgY29uc3Qgcm93QWJvdmUgPSBoZWFkZXJJZHggPiAwID8gcm93c1toZWFkZXJJZHggLSAxXSB8fCBbXSA6IG51bGw7XHJcbiAgY29uc3QgY29scyA9IGRldGVjdENvbHVtbnMoaGVhZGVyUm93LCByb3dBYm92ZSk7XHJcbiAgaWYgKGNvbHMuc2t1SWR4IDwgMCkge1xyXG4gICAgY29uc3QgZXJyID0gbmV3IEVycm9yKCdObyBzZSBlbmNvbnRybyBjb2x1bW5hIFNLVSBlbiBsYSBmaWxhIGhlYWRlcicpO1xyXG4gICAgZXJyLmNvZGUgPSAnU0tVX0NPTF9NSVNTSU5HJztcclxuICAgIHRocm93IGVycjtcclxuICB9XHJcbiAgaWYgKCFjb2xzLm1vbnRoQ29sdW1ucy5sZW5ndGgpIHtcclxuICAgIGNvbnN0IGVyciA9IG5ldyBFcnJvcihcclxuICAgICAgJ05vIHNlIGRldGVjdGFyb24gY29sdW1uYXMgZGUgbWVzZXMgZW4gZWwgaGVhZGVyIChlajogXCJKYW4gMjAyN1wiLCBcIk1heSAyMDI3XCIpJ1xyXG4gICAgKTtcclxuICAgIGVyci5jb2RlID0gJ01PTlRIU19OT1RfRk9VTkQnO1xyXG4gICAgdGhyb3cgZXJyO1xyXG4gIH1cclxuICBjb25zdCBwYXJzZWRSb3dzID0gW107XHJcbiAgY29uc3Qgc2VlblNrdSA9IG5ldyBTZXQoKTtcclxuICBmb3IgKGxldCByID0gaGVhZGVySWR4ICsgMTsgciA8IHJvd3MubGVuZ3RoOyByKyspIHtcclxuICAgIGNvbnN0IHJvdyA9IHJvd3Nbcl0gfHwgW107XHJcbiAgICBjb25zdCBza3VSYXcgPSByb3dbY29scy5za3VJZHhdO1xyXG4gICAgaWYgKHNrdVJhdyA9PSBudWxsIHx8IFN0cmluZyhza3VSYXcpLnRyaW0oKSA9PT0gJycpIGNvbnRpbnVlO1xyXG4gICAgY29uc3Qgc2t1ID0gU3RyaW5nKHNrdVJhdykudHJpbSgpO1xyXG4gICAgY29uc3QgdXBwZXIgPSBza3UudG9VcHBlckNhc2UoKTtcclxuICAgIC8vIFNraXAgZmlsYXMgVE9UQUwgLyBTVU0gLyBTVUJUT1RBTFxyXG4gICAgaWYgKHVwcGVyID09PSAnVE9UQUwnIHx8IHVwcGVyID09PSAnU1VNJyB8fCB1cHBlciA9PT0gJ1NVQlRPVEFMJyB8fCB1cHBlciA9PT0gJ1RPVEFMRVMnKVxyXG4gICAgICBjb250aW51ZTtcclxuICAgIGlmIChzZWVuU2t1Lmhhcyh1cHBlcikpIGNvbnRpbnVlOyAvLyBkZWR1cGVcclxuICAgIHNlZW5Ta3UuYWRkKHVwcGVyKTtcclxuICAgIGNvbnN0IGRlc2NyaXB0aW9uID1cclxuICAgICAgY29scy5kZXNjSWR4ID49IDAgPyBTdHJpbmcocm93W2NvbHMuZGVzY0lkeF0gPT0gbnVsbCA/ICcnIDogcm93W2NvbHMuZGVzY0lkeF0pLnRyaW0oKSA6ICcnO1xyXG4gICAgY29uc3QgbW9xUmF3ID0gY29scy5tb3FJZHggPj0gMCA/IHJvd1tjb2xzLm1vcUlkeF0gOiBudWxsO1xyXG4gICAgY29uc3QgbW9xTnVtID0gTnVtYmVyKG1vcVJhdyk7XHJcbiAgICBjb25zdCBtb3EgPSBOdW1iZXIuaXNGaW5pdGUobW9xTnVtKSAmJiBtb3FOdW0gPiAwID8gTWF0aC5yb3VuZChtb3FOdW0pIDogMDtcclxuICAgIGNvbnN0IG1vbnRocyA9IHt9O1xyXG4gICAgZm9yIChjb25zdCBtYyBvZiBjb2xzLm1vbnRoQ29sdW1ucykge1xyXG4gICAgICBjb25zdCB2ID0gcm93W21jLmNvbElkeF07XHJcbiAgICAgIGNvbnN0IG4gPSBOdW1iZXIodik7XHJcbiAgICAgIGlmIChOdW1iZXIuaXNGaW5pdGUobikgJiYgbiA+IDApIHtcclxuICAgICAgICBtb250aHNbbWMubW9udGhLZXldID0gTWF0aC5yb3VuZChuKTtcclxuICAgICAgfVxyXG4gICAgfVxyXG4gICAgcGFyc2VkUm93cy5wdXNoKHsgc2t1LCBkZXNjcmlwdGlvbiwgbW9xLCBtb250aHMgfSk7XHJcbiAgfVxyXG4gIHJldHVybiB7XHJcbiAgICBoZWFkZXJSb3dJbmRleDogaGVhZGVySWR4LFxyXG4gICAgZGV0ZWN0ZWRNb250aHM6IGNvbHMuZGV0ZWN0ZWRNb250aHMsXHJcbiAgICByb3dzQ291bnQ6IHBhcnNlZFJvd3MubGVuZ3RoLFxyXG4gICAgcm93czogcGFyc2VkUm93cyxcclxuICB9O1xyXG59XHJcblxyXG4vLyBVTUQtaXNoIGV4cG9ydDogcGFyYSB2aXRlc3QgKG1vZHVsZS5leHBvcnRzKSB5IHBhcmEgYnVuZGxlIGJyb3dzZXIgKHdpbmRvdyBnbG9iYWwpLlxyXG5pZiAodHlwZW9mIG1vZHVsZSAhPT0gJ3VuZGVmaW5lZCcgJiYgbW9kdWxlLmV4cG9ydHMpIHtcclxuICBtb2R1bGUuZXhwb3J0cyA9IHsgcGFyc2VTYWxlc1BsYW5TaGVldCwgbm9ybWFsaXplTW9udGhMYWJlbCwgZmluZEhlYWRlclJvdywgZGV0ZWN0Q29sdW1ucyB9O1xyXG59XHJcbmlmICh0eXBlb2Ygd2luZG93ICE9PSAndW5kZWZpbmVkJykge1xyXG4gIHdpbmRvdy5TYWxlc1BsYW5QYXJzZXIgPSB7XHJcbiAgICBwYXJzZVNhbGVzUGxhblNoZWV0LFxyXG4gICAgbm9ybWFsaXplTW9udGhMYWJlbCxcclxuICAgIGZpbmRIZWFkZXJSb3csXHJcbiAgICBkZXRlY3RDb2x1bW5zLFxyXG4gIH07XHJcbn1cclxuXHJcbmV4cG9ydCB7IGRldGVjdENvbHVtbnMsIGZpbmRIZWFkZXJSb3csIG5vcm1hbGl6ZU1vbnRoTGFiZWwsIHBhcnNlU2FsZXNQbGFuU2hlZXQgfTtcclxuIiwgIi8vIEB0cy1ub2NoZWNrXHJcbi8vIHYxMDk4KyBGYXNlIDE6IGltcG9ydCBkZWwgcGFyc2VyIHB1cm8uIEVsIG1cdTAwRjNkdWxvIGhhY2UgYHdpbmRvdy5TYWxlc1BsYW5QYXJzZXJgXHJcbi8vIGNvbW8gc2lkZS1lZmZlY3QgeSB0YW1iaVx1MDBFOW4gZXhwb3J0YSBsYXMgZm5zIG5vbWJyYWRhczsgdXNhbW9zIHNpZGUtZWZmZWN0XHJcbi8vIHBvcnF1ZSBmb3JlY2FzdC5qcyBjb3JyZSBlbiBlbCBjaHVuayBsYXp5IHkgd2luZG93IHlhIGVzdFx1MDBFMSBkaXNwb25pYmxlLlxyXG5pbXBvcnQgJy4uL3B1cmUvc2FsZXMtcGxhbi1wYXJzZXIuanMnO1xyXG5cclxuLy8gR2xvYmFscyBsZWlkb3MgZGVsIGVudG9ybm8gKGRlY2xhcmFkb3MgZW4gaW5kZXguaHRtbCBpbmxpbmUgbyBidW5kbGUgcHJldmlvKTpcclxuLy8gZmJEYiwgY3VycmVudFVzZXIsIFhMU1ggKGNkbiksIGVzY2FwZUh0bWwuIE1pc21vIHBhdHJvbiBxdWUgb3Ryb3MgZG9taW5pb3MuXHJcbi8vXHJcbi8vIEZPUkVDQVNUIC0gbW9kYWwgYWRtaW4tb25seSAoTWFyaWFubykgcXVlIGNvbXBhcmEgdmVudGFzIGhpc3RvcmljYXNcclxuLy8gKEZpcmVzdG9yZSBza3VfdmVudGFzX3NuYXBzaG90LCBhbGltZW50YWRvIHBvciBzeW5jIEJRIHZfdmVudGFzX2xpbmVhc1xyXG4vLyB2ZW50YW5hIDEzbSkgdnMgU2FsZXMgUGxhbiBjYXJnYWRvIHBvciBlbCB1c2VyIHZpYSBFeGNlbCArIHBvbGl0aWNhIGRlXHJcbi8vIGludmVudGFyaW8gKHByb21lZGlvIFlURCB4IDMgbWVzZXMpLlxyXG4vL1xyXG4vLyBDaHVuayBsYXp5OiBzZSBjYXJnYSBzb2xvIGFsIHByaW1lciBjbGljayBkZWwgYm90b24gRk9SRUNBU1QgZGVsIGhlYWRlci5cclxuLy8gUmVnaXN0cmFkbyBlbiBidWlsZC5qcyBMQVpZX0NIVU5LUyArIHNyYy9tYWluLmpzIGluc3RhbGxDaHVua1N0dWJzICsgc3cuanNcclxuLy8gU1RBVElDX0FTU0VUUy4gVmVyIENMQVVERS5tZCAjMTggKDMgbHVnYXJlcyBzaW5jcm9uaXphZG9zKS5cclxuLy9cclxuLy8gQ29udHJhdG8gZGVsIEV4Y2VsIFNhbGVzIFBsYW4gcXVlIHN1YmUgZWwgdXNlcjpcclxuLy8gICBDb2x1bW5hczogU0tVIHwgTWVzMSB8IE1lczIgfCBNZXMzIHwgTWVzNCB8IE1lczUgfCBNZXM2XHJcbi8vICAgKG5vbWJyZXMgZXhhY3RvcyBkZSBoZWFkZXJzIGNhc2UtaW5zZW5zaXRpdmU7IE1lczEuLjYgc29uIGxvcyBwcm94aW1vc1xyXG4vLyAgIDYgbWVzZXMgZGVzZGUgZWwgbWVzIGFjdHVhbCkuIFVuYSBmaWxhIHBvciBTS1UuXHJcbi8vXHJcbi8vIEZ1ZW50ZSBkZSBkYXRvcyBoaXN0b3JpY2FzOlxyXG4vLyAgIEZpcmVzdG9yZSAvc2t1X3ZlbnRhc19zbmFwc2hvdC97U0tVXzxza3Vfc2FuZWFkbz59XHJcbi8vICAge1xyXG4vLyAgICAgc2t1LCBpdGVtTmFtZSwgZmFtaWxpYSwgc3ViZmFtaWxpYSxcclxuLy8gICAgIG1lc2VzOiB7ICcyMDI1LTA4Jzoge3F0eSwgYXJzfSwgLi4uLCAnMjAyNi0wOCc6IHtxdHksIGFyc30gfVxyXG4vLyAgIH1cclxuLy8gICBSdWxlczogcmVhZCBhZG1pbi1vbmx5IChjb21wZXRpdGl2ZWx5IHNlbnNpdGl2ZSkuIEVzY3JpdG8gcG9yIGNyb25cclxuLy8gICBzeW5jX3NhcF90b19iaWdxdWVyeS5weSBjYWRhIDMwIG1pbi5cclxuXHJcbi8vIEVzdGFkbyBkZWwgbW9kYWwgKGludHJhLWNodW5rLCBubyBjcm9zcy1zY29wZSkuXHJcbmxldCBfZm9yZWNhc3RTbmFwc2hvdCA9IG51bGw7IC8vIHsgU0tVOiB7ZmFtaWxpYSwgc3ViZmFtaWxpYSwgaXRlbU5hbWUsIG1lc2VzfSB9XHJcbmxldCBfZm9yZWNhc3RTYWxlc1BsYW4gPSBudWxsOyAvLyBbeyBza3UsIHBlZGlkb1RvdGFsLCBtZXNlc0FycjogW24xLi5uNl0gfV1cclxubGV0IF9mb3JlY2FzdFJvd3MgPSBudWxsOyAvLyBmaWxhcyBmaW5hbGVzIGNhbGN1bGFkYXMgcGFyYSBwcmV2aWV3ICsgZXhwb3J0XHJcbmxldCBfZm9yZWNhc3RMb2FkaW5nID0gZmFsc2U7XHJcblxyXG4vLyB2MTA5OCsgKEZhc2UgMSBGb3JlY2FzdCB2Mik6IFNhbGVzIFBsYW5zIG1lbnN1YWxlcyBwb3IgZmFtaWxpYSAoUm9kcy9SZWVscy9GRykuXHJcbi8vIFNlIGd1YXJkYW4gZW4gRmlyZXN0b3JlIGBzYWxlc19wbGFuX2NhY2hlL3tmYW1pbGlhfWAgKyBzbmFwc2hvdCBFeGNlbCBvcmlnaW5hbFxyXG4vLyBlbiBTdG9yYWdlIGBmb3JlY2FzdHNfc25hcHNob3RzL3tZWVlZLU1NfS97ZmFtaWxpYX0ueGxzeGAuXHJcbi8vIEVsIHBhcnNlciBwdXJvIHZpdmUgZW4gc3JjL3B1cmUvc2FsZXMtcGxhbi1wYXJzZXIuanMgKGF0dGFjaCBhIHdpbmRvdy5TYWxlc1BsYW5QYXJzZXIpLlxyXG5jb25zdCBTQUxFU19QTEFOX0ZBTUlMSUFTID0gW1xyXG4gIHsga2V5OiAncm9kcycsIGxhYmVsOiAnUm9kcyAoQ2FcdTAwRjFhcyknLCBjb2xvcjogJyMwZWE1ZTknIH0sXHJcbiAgeyBrZXk6ICdyZWVscycsIGxhYmVsOiAnUmVlbHMnLCBjb2xvcjogJyM4YjVjZjYnIH0sXHJcbiAgeyBrZXk6ICdmZycsIGxhYmVsOiAnRkcgKHJlc3RvKScsIGNvbG9yOiAnI2Y1OWUwYicgfSxcclxuXTtcclxuY29uc3QgX3NhbGVzUGxhbkNhY2hlcyA9IHsgcm9kczogbnVsbCwgcmVlbHM6IG51bGwsIGZnOiBudWxsIH07IC8vIGxhc3QgbG9hZGVkIGRvY1xyXG5sZXQgX2ZvcmVjYXN0QWN0aXZlVGFiID0gJ3NhbGVzLXBsYW5zJzsgLy8gJ3NhbGVzLXBsYW5zJyB8ICdzdGF0JyB8ICdsZWdhY3knXHJcblxyXG4vLyB2MTEwMysgKEZhc2UgMkIpOiBGb3JlY2FzdCBFc3RhZFx1MDBFRHN0aWNvIFx1MjAxNCBvdXRwdXQgcHVibGljYWRvIHBvclxyXG4vLyBzY3JpcHRzL2ZvcmVjYXN0L3B1Ymxpc2hfdG9fZmlyZXN0b3JlLnB5IGEgZm9yZWNhc3Rfb3V0cHV0L3tzdWJfc2x1Z31cclxuLy8gKyBmb3JlY2FzdF9vdXRwdXRfbWV0YS9jdXJyZW50LiAyNCBzdWJzICsgMSBtZXRhIGRvYy5cclxubGV0IF9mb3JlY2FzdFN0YXREb2NzID0gbnVsbDsgLy8gW3tpZCwgc3ViZmFtaWxpYSwgZm9yZWNhc3RbN10sIG1ldHJpY3MsIGJlc3RNb2RlbCwgdmVyc2lvbklkfV1cclxubGV0IF9mb3JlY2FzdFN0YXRNZXRhID0gbnVsbDsgLy8ge2dlbmVyYXRlZEF0LCB2ZXJzaW9uSWQsIHJlc3VtZW46IHsuLi59fVxyXG5sZXQgX2ZvcmVjYXN0U3RhdEhpc3RvcnlDYWNoZSA9IG51bGw7IC8vIHsgW3N1Yl06IFt7ZHMsIHl9XSB9IGNhY2hlIGxhenkgb24tZGVtYW5kXHJcblxyXG4vLyBXaGl0ZWxpc3QgZGUgZW1haWxzIGNvbiBhY2Nlc28gYWwgbW9kYWwgRk9SRUNBU1QuIFJlcGxpY2EgZWwgcGF0cm9uIGRlXHJcbi8vIFwiQW5hbGlzaXNcIiAoaW5kZXguaHRtbDoxMjYyNSkuIFNvbG8gTWFyaWFubzsgc2kgb3RybyBhZG1pbiBsbyBuZWNlc2l0YVxyXG4vLyBzZSBhZ3JlZ2EgYWNhIGV4cGxpY2l0by5cclxuY29uc3QgRk9SRUNBU1RfQUxMT1dFRF9FTUFJTFMgPSBbJ21hcmlhbm8uZXJiaW5vQHNoaW1hbm8uY29tLmFyJywgJ2VyYmlub21hcmlhbm9AZ21haWwuY29tJ107XHJcblxyXG5mdW5jdGlvbiBfY2FuRm9yZWNhc3QoKSB7XHJcbiAgdHJ5IHtcclxuICAgIGNvbnN0IGVtYWlsID0gKCh3aW5kb3cuY3VycmVudFVzZXIgJiYgd2luZG93LmN1cnJlbnRVc2VyLmVtYWlsKSB8fCAnJykudG9Mb3dlckNhc2UoKTtcclxuICAgIGlmICghZW1haWwpIHJldHVybiBmYWxzZTtcclxuICAgIHJldHVybiBGT1JFQ0FTVF9BTExPV0VEX0VNQUlMUy5pbmRleE9mKGVtYWlsKSA+PSAwO1xyXG4gIH0gY2F0Y2gge1xyXG4gICAgcmV0dXJuIGZhbHNlO1xyXG4gIH1cclxufVxyXG5cclxuLy8gSGVscGVycyBkZSBtZXMgY2FsZW5kYXIuXHJcbmZ1bmN0aW9uIF9tb250aEtleSh5ZWFyLCBtb250aE9uZUJhc2VkKSB7XHJcbiAgcmV0dXJuIFN0cmluZyh5ZWFyKS5wYWRTdGFydCg0LCAnMCcpICsgJy0nICsgU3RyaW5nKG1vbnRoT25lQmFzZWQpLnBhZFN0YXJ0KDIsICcwJyk7XHJcbn1cclxuZnVuY3Rpb24gX21vbnRoTGFiZWwoa2V5KSB7XHJcbiAgLy8gJzIwMjYtMDgnIC0+ICdhZ28tMjYnXHJcbiAgY29uc3QgW3ksIG1dID0ga2V5LnNwbGl0KCctJykubWFwKE51bWJlcik7XHJcbiAgY29uc3QgbmFtZXMgPSBbXHJcbiAgICAnZW5lJyxcclxuICAgICdmZWInLFxyXG4gICAgJ21hcicsXHJcbiAgICAnYWJyJyxcclxuICAgICdtYXknLFxyXG4gICAgJ2p1bicsXHJcbiAgICAnanVsJyxcclxuICAgICdhZ28nLFxyXG4gICAgJ3NlcCcsXHJcbiAgICAnb2N0JyxcclxuICAgICdub3YnLFxyXG4gICAgJ2RpYycsXHJcbiAgXTtcclxuICByZXR1cm4gbmFtZXNbbSAtIDFdICsgJy0nICsgU3RyaW5nKHkpLnNsaWNlKC0yKTtcclxufVxyXG5mdW5jdGlvbiBfYWRkTW9udGhzKHllYXIsIG1vbnRoT25lQmFzZWQsIGRlbHRhKSB7XHJcbiAgY29uc3QgdG90YWxNb250aHMgPSB5ZWFyICogMTIgKyAobW9udGhPbmVCYXNlZCAtIDEpICsgZGVsdGE7XHJcbiAgY29uc3QgeSA9IE1hdGguZmxvb3IodG90YWxNb250aHMgLyAxMik7XHJcbiAgY29uc3QgbSA9ICh0b3RhbE1vbnRocyAlIDEyKSArIDE7XHJcbiAgcmV0dXJuIHsgeSwgbSB9O1xyXG59XHJcblxyXG4vLyBTdW1hIHF0eSBkZWwgU0tVIGVuIGxvcyB1bHRpbW9zIDEyIE1FU0VTIENPTVBMRVRPUyAoZXhjbHV5ZSBlbCBtZXMgYWN0dWFsXHJcbi8vIHBhcmNpYWwgLSBsYSB2ZW50YW5hIG1vdmlsIFwiMTIgbWVzZXMgY2VycmFkb3NcIiBxdWUgZWwgdXNlciBwaWVuc2EgY29tb1xyXG4vLyBcImVsIGFcdTAwRjFvIHF1ZSB5YSBwYXNvXCIpLiBFamVtcGxvIGVuIGFnb3N0byAyMDI2OiBzdW1hciBhZ28tMjUgYSBqdWwtMjYuXHJcbmZ1bmN0aW9uIF9zdW1WZW50YXMxMm1Db21wbGV0b3MobWVzZXNNYXAsIGhveSkge1xyXG4gIGlmICghbWVzZXNNYXApIHJldHVybiAwO1xyXG4gIGxldCBzdW0gPSAwO1xyXG4gIGNvbnN0IHN0YXJ0TW9udGggPSBfYWRkTW9udGhzKGhveS5nZXRGdWxsWWVhcigpLCBob3kuZ2V0TW9udGgoKSArIDEsIC0xMik7XHJcbiAgY29uc3QgZW5kTW9udGggPSBfYWRkTW9udGhzKGhveS5nZXRGdWxsWWVhcigpLCBob3kuZ2V0TW9udGgoKSArIDEsIC0xKTtcclxuICBjb25zdCBzdGFydEtleSA9IF9tb250aEtleShzdGFydE1vbnRoLnksIHN0YXJ0TW9udGgubSk7XHJcbiAgY29uc3QgZW5kS2V5ID0gX21vbnRoS2V5KGVuZE1vbnRoLnksIGVuZE1vbnRoLm0pO1xyXG4gIGZvciAoY29uc3QgayBvZiBPYmplY3Qua2V5cyhtZXNlc01hcCkpIHtcclxuICAgIGlmIChrID49IHN0YXJ0S2V5ICYmIGsgPD0gZW5kS2V5KSB7XHJcbiAgICAgIHN1bSArPSBOdW1iZXIoKG1lc2VzTWFwW2tdICYmIG1lc2VzTWFwW2tdLnF0eSkgfHwgMCk7XHJcbiAgICB9XHJcbiAgfVxyXG4gIHJldHVybiBzdW07XHJcbn1cclxuXHJcbi8vIFN1bWEgcXR5IGRlbCBTS1UgWVREIChlbmVybyBkZWwgYVx1MDBGMW8gYWN0dWFsIGhhc3RhIG1lcyBhY3R1YWwgSU5DTFVTSVZPLFxyXG4vLyBhdW5xdWUgZWwgbWVzIGFjdHVhbCBzZWEgcGFyY2lhbCkuIFJldG9ybmEgeyB0b3RhbFl0ZCwgbWVzZXNUcmFuc2N1cnJpZG9zIH0uXHJcbi8vIEVqZW1wbG8gYWdvc3RvIDIwMjYgY29uIHZlbnRhcyBqdWw9MTAgKyBhZ289MjAgLT4gezMwLCA4fSwgcHJvbWVkaW89MzAvOD0zLjc1LlxyXG4vLyAoU2kgZWwgdXN1YXJpbyBlc3BlcmFiYSBkaXZpZGlyIHBvciAyIGVuIHZleiBkZSA4LCByZXZpc2FyIHNwZWMuIEVsIHBlZGlkb1xyXG4vLyBkaWNlIFwiY2FudGlkYWQgZGUgbWVzZXMgcXVlIHRyYW5zY3Vycmltb3NcIiA9IG1lc2VzIGRlbCBhXHUwMEYxbyBwYXNhZG9zIGhhc3RhIGhveS4pXHJcbmZ1bmN0aW9uIF9zdW1WZW50YXNZVEQobWVzZXNNYXAsIGhveSkge1xyXG4gIGNvbnN0IHllYXIgPSBob3kuZ2V0RnVsbFllYXIoKTtcclxuICBjb25zdCBtZXNBY3R1YWwgPSBob3kuZ2V0TW9udGgoKSArIDE7XHJcbiAgbGV0IHRvdGFsID0gMDtcclxuICBpZiAobWVzZXNNYXApIHtcclxuICAgIGZvciAobGV0IG0gPSAxOyBtIDw9IG1lc0FjdHVhbDsgbSsrKSB7XHJcbiAgICAgIGNvbnN0IGsgPSBfbW9udGhLZXkoeWVhciwgbSk7XHJcbiAgICAgIHRvdGFsICs9IE51bWJlcigobWVzZXNNYXBba10gJiYgbWVzZXNNYXBba10ucXR5KSB8fCAwKTtcclxuICAgIH1cclxuICB9XHJcbiAgcmV0dXJuIHsgdG90YWxZdGQ6IHRvdGFsLCBtZXNlc1RyYW5zY3Vycmlkb3M6IG1lc0FjdHVhbCB9O1xyXG59XHJcblxyXG4vLyBDYXJnYSBza3VfdmVudGFzX3NuYXBzaG90IGNvbXBsZXRvICh1bmEgdmV6IHBvciBzZXNpb24gZGVsIG1vZGFsKS5cclxuYXN5bmMgZnVuY3Rpb24gX2xvYWRTbmFwc2hvdCgpIHtcclxuICBpZiAoX2ZvcmVjYXN0U25hcHNob3QpIHJldHVybiBfZm9yZWNhc3RTbmFwc2hvdDtcclxuICBpZiAoIXdpbmRvdy5mYkRiKSB0aHJvdyBuZXcgRXJyb3IoJ0ZpcmVzdG9yZSBubyBpbmljaWFsaXphZG8nKTtcclxuICBjb25zdCBzbmFwID0gYXdhaXQgd2luZG93LmZiRGIuY29sbGVjdGlvbignc2t1X3ZlbnRhc19zbmFwc2hvdCcpLmdldCgpO1xyXG4gIGNvbnN0IGJ5T3JpZ2luYWxTa3UgPSB7fTtcclxuICBjb25zdCBieVVwcGVyU2t1ID0ge307XHJcbiAgc25hcC5mb3JFYWNoKChkb2MpID0+IHtcclxuICAgIGNvbnN0IGQgPSBkb2MuZGF0YSgpO1xyXG4gICAgaWYgKCFkIHx8ICFkLnNrdSkgcmV0dXJuO1xyXG4gICAgY29uc3Qgc2t1VXBwZXIgPSBTdHJpbmcoZC5za3UpLnRyaW0oKS50b1VwcGVyQ2FzZSgpO1xyXG4gICAgY29uc3QgcmVjb3JkID0ge1xyXG4gICAgICBza3U6IGQuc2t1LFxyXG4gICAgICBpdGVtTmFtZTogZC5pdGVtTmFtZSB8fCAnJyxcclxuICAgICAgZmFtaWxpYTogZC5mYW1pbGlhIHx8ICcnLFxyXG4gICAgICBzdWJmYW1pbGlhOiBkLnN1YmZhbWlsaWEgfHwgJycsXHJcbiAgICAgIG1lc2VzOiBkLm1lc2VzIHx8IHt9LFxyXG4gICAgfTtcclxuICAgIGJ5T3JpZ2luYWxTa3VbZC5za3VdID0gcmVjb3JkO1xyXG4gICAgYnlVcHBlclNrdVtza3VVcHBlcl0gPSByZWNvcmQ7XHJcbiAgfSk7XHJcbiAgX2ZvcmVjYXN0U25hcHNob3QgPSB7IGJ5T3JpZ2luYWxTa3UsIGJ5VXBwZXJTa3UsIGNvdW50OiBzbmFwLnNpemUgfTtcclxuICByZXR1cm4gX2ZvcmVjYXN0U25hcHNob3Q7XHJcbn1cclxuXHJcbi8vIFBhcnNlYSBlbCBFeGNlbCBTYWxlcyBQbGFuLiBFc3BlcmEgY29sdW1uYXMgU0tVICsgNiBjb2x1bW5hcyBudW1lcmljYXNcclxuLy8gKG5vbWJyZXMgZmxleGlibGVzOiBNZXMxLi5NZXM2LCBtZXNfMS4ubWVzXzYsIG8gY3VhbHF1aWVyIGhlYWRlciBjdXN0b21cclxuLy8gbWllbnRyYXMgbGEgcHJpbWVyYSBzZWEgU0tVIHkgaGF5YSBhbCBtZW5vcyA2IGNvbHVtbmFzIG51bWVyaWNhcyBtYXMpLlxyXG5mdW5jdGlvbiBfcGFyc2VTYWxlc1BsYW5Sb3dzKHJvd3NSYXcpIHtcclxuICBpZiAoIXJvd3NSYXcgfHwgIXJvd3NSYXcubGVuZ3RoKSByZXR1cm4gW107XHJcbiAgY29uc3QgaGVhZGVyUm93ID0gcm93c1Jhd1swXTtcclxuICAvLyBEZXRlY3RhciBpbmRpY2UgZGUgY29sdW1uYSBTS1VcclxuICBsZXQgc2t1Q29sSWR4ID0gLTE7XHJcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBoZWFkZXJSb3cubGVuZ3RoOyBpKyspIHtcclxuICAgIGNvbnN0IGggPSBTdHJpbmcoaGVhZGVyUm93W2ldIHx8ICcnKVxyXG4gICAgICAudHJpbSgpXHJcbiAgICAgIC50b1VwcGVyQ2FzZSgpO1xyXG4gICAgaWYgKGggPT09ICdTS1UnIHx8IGggPT09ICdJVEVNQ09ERScgfHwgaCA9PT0gJ0lURU0nIHx8IGggPT09ICdJVEVNIENPREUnIHx8IGggPT09ICdDT0RJR08nKSB7XHJcbiAgICAgIHNrdUNvbElkeCA9IGk7XHJcbiAgICAgIGJyZWFrO1xyXG4gICAgfVxyXG4gIH1cclxuICBpZiAoc2t1Q29sSWR4IDwgMClcclxuICAgIHRocm93IG5ldyBFcnJvcignRWwgRXhjZWwgZGViZSB0ZW5lciB1bmEgY29sdW1uYSBsbGFtYWRhIFwiU0tVXCIgKG8gQ29kaWdvIC8gSXRlbUNvZGUgLyBJdGVtKScpO1xyXG4gIC8vIExhcyA2IGNvbHVtbmFzIGRlIG1lc2VzOiBsYXMgcHJpbWVyYXMgNiBjb2x1bW5hcyBxdWUgc2VhbiAhPSBza3VDb2xJZHguXHJcbiAgY29uc3QgbW9udGhDb2xzID0gW107XHJcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBoZWFkZXJSb3cubGVuZ3RoICYmIG1vbnRoQ29scy5sZW5ndGggPCA2OyBpKyspIHtcclxuICAgIGlmIChpICE9PSBza3VDb2xJZHgpIG1vbnRoQ29scy5wdXNoKGkpO1xyXG4gIH1cclxuICBpZiAobW9udGhDb2xzLmxlbmd0aCA8IDYpXHJcbiAgICB0aHJvdyBuZXcgRXJyb3IoXHJcbiAgICAgICdFbCBFeGNlbCBkZWJlIHRlbmVyIGFsIG1lbm9zIDYgY29sdW1uYXMgZGUgbWVzZXMgYWRlbWFzIGRlIFNLVSAoZW5jb250cmFkYXM6ICcgK1xyXG4gICAgICAgIG1vbnRoQ29scy5sZW5ndGggK1xyXG4gICAgICAgICcpJ1xyXG4gICAgKTtcclxuICBjb25zdCBvdXQgPSBbXTtcclxuICBmb3IgKGxldCByID0gMTsgciA8IHJvd3NSYXcubGVuZ3RoOyByKyspIHtcclxuICAgIGNvbnN0IHJvdyA9IHJvd3NSYXdbcl07XHJcbiAgICBpZiAoIXJvdyB8fCAhcm93Lmxlbmd0aCkgY29udGludWU7XHJcbiAgICBjb25zdCBza3VSYXcgPSByb3dbc2t1Q29sSWR4XTtcclxuICAgIGlmIChza3VSYXcgPT09IHVuZGVmaW5lZCB8fCBza3VSYXcgPT09IG51bGwgfHwgU3RyaW5nKHNrdVJhdykudHJpbSgpID09PSAnJykgY29udGludWU7XHJcbiAgICBjb25zdCBza3UgPSBTdHJpbmcoc2t1UmF3KS50cmltKCk7XHJcbiAgICBjb25zdCBtZXNlc0FyciA9IG1vbnRoQ29scy5tYXAoKGkpID0+IHtcclxuICAgICAgY29uc3QgdiA9IHJvd1tpXTtcclxuICAgICAgY29uc3QgbiA9IE51bWJlcih2KTtcclxuICAgICAgcmV0dXJuIE51bWJlci5pc0Zpbml0ZShuKSA/IG4gOiAwO1xyXG4gICAgfSk7XHJcbiAgICBjb25zdCBwZWRpZG9Ub3RhbCA9IG1lc2VzQXJyLnJlZHVjZSgoYSwgYikgPT4gYSArIGIsIDApO1xyXG4gICAgb3V0LnB1c2goeyBza3UsIG1lc2VzQXJyLCBwZWRpZG9Ub3RhbCB9KTtcclxuICB9XHJcbiAgcmV0dXJuIG91dDtcclxufVxyXG5cclxuLy8gQ2FsY3VsYSBsYXMgZmlsYXMgZmluYWxlcyBjcnV6YW5kbyBzbmFwc2hvdCArIHNhbGVzIHBsYW4uXHJcbmZ1bmN0aW9uIF9jb21wdXRlRm9yZWNhc3RSb3dzKHNuYXBzaG90LCBzYWxlc1BsYW4sIGhveSkge1xyXG4gIGNvbnN0IHJvd3MgPSBbXTtcclxuICBmb3IgKGNvbnN0IHNwIG9mIHNhbGVzUGxhbikge1xyXG4gICAgY29uc3Qgc2t1VXBwZXIgPSBzcC5za3UudG9VcHBlckNhc2UoKTtcclxuICAgIGNvbnN0IGhpc3QgPSBzbmFwc2hvdC5ieVVwcGVyU2t1W3NrdVVwcGVyXSB8fCBudWxsO1xyXG4gICAgY29uc3QgdmVudGFzMTJtID0gaGlzdCA/IF9zdW1WZW50YXMxMm1Db21wbGV0b3MoaGlzdC5tZXNlcywgaG95KSA6IDA7XHJcbiAgICBjb25zdCB5dGQgPSBoaXN0XHJcbiAgICAgID8gX3N1bVZlbnRhc1lURChoaXN0Lm1lc2VzLCBob3kpXHJcbiAgICAgIDogeyB0b3RhbFl0ZDogMCwgbWVzZXNUcmFuc2N1cnJpZG9zOiBob3kuZ2V0TW9udGgoKSArIDEgfTtcclxuICAgIGNvbnN0IHByb21lZGlvID0geXRkLm1lc2VzVHJhbnNjdXJyaWRvcyA+IDAgPyB5dGQudG90YWxZdGQgLyB5dGQubWVzZXNUcmFuc2N1cnJpZG9zIDogMDtcclxuICAgIGNvbnN0IHBvbGl0aWNhID0gcHJvbWVkaW8gKiAzO1xyXG4gICAgY29uc3QgdG90YWwgPSBzcC5wZWRpZG9Ub3RhbCAtIHBvbGl0aWNhO1xyXG4gICAgcm93cy5wdXNoKHtcclxuICAgICAgc2t1OiBzcC5za3UsXHJcbiAgICAgIGl0ZW1OYW1lOiBoaXN0ID8gaGlzdC5pdGVtTmFtZSA6ICcnLFxyXG4gICAgICBmYW1pbGlhOiBoaXN0ID8gaGlzdC5mYW1pbGlhIDogJyhzaW4gbWF0Y2gpJyxcclxuICAgICAgc3ViZmFtaWxpYTogaGlzdCA/IGhpc3Quc3ViZmFtaWxpYSA6ICcoc2luIG1hdGNoKScsXHJcbiAgICAgIHZlbnRhczEybTogdmVudGFzMTJtLFxyXG4gICAgICBwZWRpZG82bTogc3AucGVkaWRvVG90YWwsXHJcbiAgICAgIHByb21lZGlvOiBwcm9tZWRpbyxcclxuICAgICAgcG9saXRpY2E6IHBvbGl0aWNhLFxyXG4gICAgICB0b3RhbDogdG90YWwsXHJcbiAgICAgIGhhc0hpc3RvcmlhOiAhIWhpc3QsXHJcbiAgICB9KTtcclxuICB9XHJcbiAgcmV0dXJuIHJvd3M7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIF9yZW5kZXJNb2RhbFNoZWxsKCkge1xyXG4gIGNvbnN0IGV4aXN0aW5nID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2ZvcmVjYXN0LW1vZGFsJyk7XHJcbiAgaWYgKGV4aXN0aW5nKSByZXR1cm4gZXhpc3Rpbmc7XHJcbiAgY29uc3QgZWwgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKTtcclxuICBlbC5pZCA9ICdmb3JlY2FzdC1tb2RhbCc7XHJcbiAgZWwuY2xhc3NOYW1lID0gJ21vZGFsLW92ZXJsYXknO1xyXG4gIGVsLnN0eWxlLmNzc1RleHQgPVxyXG4gICAgJ2Rpc3BsYXk6bm9uZTtwb3NpdGlvbjpmaXhlZDtpbnNldDowO2JhY2tncm91bmQ6cmdiYSgxNSwyMyw0MiwuNik7ei1pbmRleDoyMDUwOyc7XHJcbiAgZWwub25jbGljayA9IGZ1bmN0aW9uIChldikge1xyXG4gICAgaWYgKGV2LnRhcmdldCA9PT0gZWwpIHdpbmRvdy5jbG9zZUZvcmVjYXN0TW9kYWwoKTtcclxuICB9O1xyXG4gIC8vIFNoZWxsICsgdGFicyBiYXIgKyAyIGNvbnRlbmVkb3JlcyBkZSB0YWJzIChTYWxlcyBQbGFucyBudWV2YSwgTGVnYWN5IDZtKS5cclxuICAvLyBFbCBjb250ZW5pZG8gZGUgY2FkYSB0YWIgc2UgcGludGEgY29uIF9yZW5kZXJTYWxlc1BsYW5zVGFiKCkgeSBlbCBsZWdhY3lcclxuICAvLyB1c2EgZWwgZmx1am8gX3JlbmRlclRhYmxlKCkgZGUgc2llbXByZS5cclxuICBjb25zdCBzaGVsbEh0bWwgPSBfYnVpbGRTaGVsbEh0bWwoKTtcclxuICBlbC5pbm5lckhUTUwgPSBzaGVsbEh0bWw7XHJcbiAgZG9jdW1lbnQuYm9keS5hcHBlbmRDaGlsZChlbCk7XHJcbiAgcmV0dXJuIGVsO1xyXG59XHJcblxyXG5mdW5jdGlvbiBfYnVpbGRTaGVsbEh0bWwoKSB7XHJcbiAgLy8gQnJva2VuLW91dCBwdXJlIHN0cmluZyBidWlsZGVyIHBhcmEgcGFzYXIgZWwgaG9vayBkZSBpbm5lckhUTUwuXHJcbiAgY29uc3QgbW9kYWxPdXRlciA9XHJcbiAgICAnPGRpdiBzdHlsZT1cInBvc2l0aW9uOmFic29sdXRlO2luc2V0OjF2aCAxdnc7YmFja2dyb3VuZDp2YXIoLS1iZy1lbGV2YXRlZCk7Ym9yZGVyLXJhZGl1czoxMHB4O2Rpc3BsYXk6ZmxleDtmbGV4LWRpcmVjdGlvbjpjb2x1bW47b3ZlcmZsb3c6aGlkZGVuO2JveC1zaGFkb3c6MCAyMHB4IDUwcHggcmdiYSgwLDAsMCwuMzUpXCI+JztcclxuICBjb25zdCBoZWFkZXIgPVxyXG4gICAgJzxkaXYgc3R5bGU9XCJwYWRkaW5nOjEycHggMThweDtiYWNrZ3JvdW5kOiMwZjE3MmE7Y29sb3I6I2ZmZjtkaXNwbGF5OmZsZXg7YWxpZ24taXRlbXM6Y2VudGVyO2dhcDoxMnB4XCI+JyArXHJcbiAgICAnPGRpdiBzdHlsZT1cImZsZXg6MVwiPjxkaXYgc3R5bGU9XCJmb250LXNpemU6MTZweDtmb250LXdlaWdodDo4MDA7bGV0dGVyLXNwYWNpbmc6LjVweFwiPkZPUkVDQVNUPC9kaXY+JyArXHJcbiAgICAnPGRpdiBpZD1cImZvcmVjYXN0LXN1YnRpdGxlXCIgc3R5bGU9XCJmb250LXNpemU6MTFweDtvcGFjaXR5Oi44O21hcmdpbi10b3A6MnB4XCI+U2FsZXMgUGxhbnMgbWVuc3VhbGVzICsgcG9saXRpY2EgZGUgaW52ZW50YXJpbzwvZGl2PjwvZGl2PicgK1xyXG4gICAgJzxidXR0b24gb25jbGljaz1cImNsb3NlRm9yZWNhc3RNb2RhbCgpXCIgc3R5bGU9XCJiYWNrZ3JvdW5kOnRyYW5zcGFyZW50O2NvbG9yOiNmZmY7Ym9yZGVyOjFweCBzb2xpZCByZ2JhKDI1NSwyNTUsMjU1LC40KTtib3JkZXItcmFkaXVzOjZweDtwYWRkaW5nOjZweCAxMHB4O2N1cnNvcjpwb2ludGVyO2ZvbnQtd2VpZ2h0OjcwMFwiPkNlcnJhcjwvYnV0dG9uPicgK1xyXG4gICAgJzwvZGl2Pic7XHJcbiAgY29uc3QgdGFic0JhciA9XHJcbiAgICAnPGRpdiBpZD1cImZvcmVjYXN0LXRhYnMtYmFyXCIgc3R5bGU9XCJkaXNwbGF5OmZsZXg7Z2FwOjA7YmFja2dyb3VuZDp2YXIoLS1iZy1zZWNvbmRhcnkpO3BhZGRpbmc6MCAxOHB4O2JvcmRlci1ib3R0b206MXB4IHNvbGlkIHZhcigtLWJvcmRlci1zdWJ0bGUpXCI+JyArXHJcbiAgICAnPGJ1dHRvbiBkYXRhLXRhYj1cInNhbGVzLXBsYW5zXCIgb25jbGljaz1cInN3aXRjaEZvcmVjYXN0VGFiKFxcJ3NhbGVzLXBsYW5zXFwnKVwiIGNsYXNzPVwiZm9yZWNhc3QtdGFiXCIgc3R5bGU9XCJwYWRkaW5nOjEwcHggMTZweDtiYWNrZ3JvdW5kOnRyYW5zcGFyZW50O2NvbG9yOnZhcigtLXRleHQtcHJpbWFyeSk7Ym9yZGVyOm5vbmU7Ym9yZGVyLWJvdHRvbTozcHggc29saWQgIzBkOTQ4ODtjdXJzb3I6cG9pbnRlcjtmb250LXdlaWdodDo3MDA7Zm9udC1zaXplOjEycHg7bGV0dGVyLXNwYWNpbmc6LjRweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2VcIj5TYWxlcyBQbGFuczwvYnV0dG9uPicgK1xyXG4gICAgJzxidXR0b24gZGF0YS10YWI9XCJzdGF0XCIgb25jbGljaz1cInN3aXRjaEZvcmVjYXN0VGFiKFxcJ3N0YXRcXCcpXCIgY2xhc3M9XCJmb3JlY2FzdC10YWJcIiBzdHlsZT1cInBhZGRpbmc6MTBweCAxNnB4O2JhY2tncm91bmQ6dHJhbnNwYXJlbnQ7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7Ym9yZGVyOm5vbmU7Ym9yZGVyLWJvdHRvbTozcHggc29saWQgdHJhbnNwYXJlbnQ7Y3Vyc29yOnBvaW50ZXI7Zm9udC13ZWlnaHQ6NjAwO2ZvbnQtc2l6ZToxMnB4O2xldHRlci1zcGFjaW5nOi40cHg7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlXCI+Rm9yZWNhc3QgRXN0YWRcdTAwRURzdGljbzwvYnV0dG9uPicgK1xyXG4gICAgJzxidXR0b24gZGF0YS10YWI9XCJsZWdhY3lcIiBvbmNsaWNrPVwic3dpdGNoRm9yZWNhc3RUYWIoXFwnbGVnYWN5XFwnKVwiIGNsYXNzPVwiZm9yZWNhc3QtdGFiXCIgc3R5bGU9XCJwYWRkaW5nOjEwcHggMTZweDtiYWNrZ3JvdW5kOnRyYW5zcGFyZW50O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO2JvcmRlcjpub25lO2JvcmRlci1ib3R0b206M3B4IHNvbGlkIHRyYW5zcGFyZW50O2N1cnNvcjpwb2ludGVyO2ZvbnQtd2VpZ2h0OjYwMDtmb250LXNpemU6MTJweDtsZXR0ZXItc3BhY2luZzouNHB4O3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZVwiPkxlZ2FjeSAoNm0pPC9idXR0b24+JyArXHJcbiAgICAnPC9kaXY+JztcclxuICBjb25zdCB0YWJTYWxlc1BsYW5zID0gJzxkaXYgaWQ9XCJmb3JlY2FzdC10YWItc2FsZXMtcGxhbnNcIiBzdHlsZT1cImZsZXg6MTtvdmVyZmxvdzphdXRvXCI+PC9kaXY+JztcclxuICBjb25zdCB0YWJTdGF0ID0gJzxkaXYgaWQ9XCJmb3JlY2FzdC10YWItc3RhdFwiIHN0eWxlPVwiZmxleDoxO292ZXJmbG93OmF1dG87ZGlzcGxheTpub25lXCI+PC9kaXY+JztcclxuICBjb25zdCBsZWdhY3lCYXIgPVxyXG4gICAgJzxkaXYgc3R5bGU9XCJwYWRkaW5nOjEycHggMThweDtiYWNrZ3JvdW5kOnZhcigtLWJnLXNlY29uZGFyeSk7Ym9yZGVyLWJvdHRvbToxcHggc29saWQgdmFyKC0tYm9yZGVyLXN1YnRsZSk7ZGlzcGxheTpmbGV4O2ZsZXgtd3JhcDp3cmFwO2dhcDoxNHB4O2FsaWduLWl0ZW1zOmNlbnRlclwiPicgK1xyXG4gICAgJzxsYWJlbCBzdHlsZT1cImRpc3BsYXk6aW5saW5lLWZsZXg7YWxpZ24taXRlbXM6Y2VudGVyO2dhcDo4cHg7cGFkZGluZzo4cHggMTJweDtiYWNrZ3JvdW5kOiMwZDk0ODg7Y29sb3I6I2ZmZjtib3JkZXItcmFkaXVzOjZweDtmb250LXdlaWdodDo3MDA7Zm9udC1zaXplOjEycHg7Y3Vyc29yOnBvaW50ZXJcIj4nICtcclxuICAgICc8c3Bhbj5DYXJnYXIgU2FsZXMgUGxhbiAoLnhsc3gpPC9zcGFuPicgK1xyXG4gICAgJzxpbnB1dCB0eXBlPVwiZmlsZVwiIGFjY2VwdD1cIi54bHN4LC54bHNcIiBzdHlsZT1cImRpc3BsYXk6bm9uZVwiIG9uY2hhbmdlPVwib25Gb3JlY2FzdFNhbGVzUGxhbkZpbGUoZXZlbnQpXCIvPjwvbGFiZWw+JyArXHJcbiAgICAnPGRpdiBpZD1cImZvcmVjYXN0LWhpbnRcIiBzdHlsZT1cImZvbnQtc2l6ZToxMXB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO21heC13aWR0aDo1MjBweFwiPkZvcm1hdG8gbGVnYWN5OiBwcmltZXJhIGNvbHVtbmEgPGI+U0tVPC9iPiwgbHVlZ28gNiBjb2x1bW5hcyBjb24gbGFzIHVuaWRhZGVzIHBlZGlkYXMgbWVzIGEgbWVzLjwvZGl2PicgK1xyXG4gICAgJzxidXR0b24gaWQ9XCJmb3JlY2FzdC1leHBvcnQtYnRuXCIgb25jbGljaz1cImV4cG9ydEZvcmVjYXN0RXhjZWwoKVwiIGRpc2FibGVkIHN0eWxlPVwicGFkZGluZzo4cHggMTRweDtiYWNrZ3JvdW5kOnZhcigtLWNvbG9yLXN1Y2Nlc3MpO2NvbG9yOiNmZmY7Ym9yZGVyOm5vbmU7Ym9yZGVyLXJhZGl1czo2cHg7Zm9udC13ZWlnaHQ6NzAwO2N1cnNvcjpwb2ludGVyO29wYWNpdHk6LjVcIj5FeHBvcnRhciBFeGNlbDwvYnV0dG9uPicgK1xyXG4gICAgJzxkaXYgaWQ9XCJmb3JlY2FzdC1zdGF0c1wiIHN0eWxlPVwibWFyZ2luLWxlZnQ6YXV0bztmb250LXNpemU6MTFweDtjb2xvcjp2YXIoLS10ZXh0LXNlY29uZGFyeSk7Zm9udC13ZWlnaHQ6NjAwXCI+PC9kaXY+JyArXHJcbiAgICAnPC9kaXY+JztcclxuICBjb25zdCBsZWdhY3lCb2R5ID1cclxuICAgICc8ZGl2IGlkPVwiZm9yZWNhc3QtYm9keVwiIHN0eWxlPVwiZmxleDoxO292ZXJmbG93OmF1dG87cGFkZGluZzowXCI+PGRpdiBzdHlsZT1cInBhZGRpbmc6NjBweCAyMHB4O3RleHQtYWxpZ246Y2VudGVyO2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO2ZvbnQtc2l6ZToxNHB4XCI+RXNwZXJhbmRvIGFyY2hpdm8gU2FsZXMgUGxhbi4uLjwvZGl2PjwvZGl2Pic7XHJcbiAgY29uc3QgdGFiTGVnYWN5ID1cclxuICAgICc8ZGl2IGlkPVwiZm9yZWNhc3QtdGFiLWxlZ2FjeVwiIHN0eWxlPVwiZmxleDoxO292ZXJmbG93OmhpZGRlbjtmbGV4LWRpcmVjdGlvbjpjb2x1bW47ZGlzcGxheTpub25lXCI+JyArXHJcbiAgICBsZWdhY3lCYXIgK1xyXG4gICAgbGVnYWN5Qm9keSArXHJcbiAgICAnPC9kaXY+JztcclxuICByZXR1cm4gbW9kYWxPdXRlciArIGhlYWRlciArIHRhYnNCYXIgKyB0YWJTYWxlc1BsYW5zICsgdGFiU3RhdCArIHRhYkxlZ2FjeSArICc8L2Rpdj4nO1xyXG59XHJcblxyXG4vLyB2MTA5OCsgRmFzZSAxICsgdjExMDMrIEZhc2UgMkIgKyB2MTEwNSBmaXg6IHN3aXRjaCBlbnRyZSB0YWJzIFNhbGVzIFBsYW5zIC8gU3RhdCAvIExlZ2FjeS5cclxud2luZG93LnN3aXRjaEZvcmVjYXN0VGFiID0gZnVuY3Rpb24gKHRhYklkKSB7XHJcbiAgX2ZvcmVjYXN0QWN0aXZlVGFiID0gdGFiSWQ7XHJcbiAgY29uc3Qgc3AgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZm9yZWNhc3QtdGFiLXNhbGVzLXBsYW5zJyk7XHJcbiAgY29uc3Qgc3QgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZm9yZWNhc3QtdGFiLXN0YXQnKTtcclxuICBjb25zdCBsZyA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdmb3JlY2FzdC10YWItbGVnYWN5Jyk7XHJcbiAgaWYgKHNwKSBzcC5zdHlsZS5kaXNwbGF5ID0gdGFiSWQgPT09ICdzYWxlcy1wbGFucycgPyAnYmxvY2snIDogJ25vbmUnO1xyXG4gIGlmIChzdCkgc3Quc3R5bGUuZGlzcGxheSA9IHRhYklkID09PSAnc3RhdCcgPyAnYmxvY2snIDogJ25vbmUnO1xyXG4gIGlmIChsZykgbGcuc3R5bGUuZGlzcGxheSA9IHRhYklkID09PSAnbGVnYWN5JyA/ICdmbGV4JyA6ICdub25lJztcclxuICBjb25zdCBidG5zID0gZG9jdW1lbnQucXVlcnlTZWxlY3RvckFsbCgnI2ZvcmVjYXN0LXRhYnMtYmFyIC5mb3JlY2FzdC10YWInKTtcclxuICBidG5zLmZvckVhY2goKGIpID0+IHtcclxuICAgIGNvbnN0IGFjdGl2ZSA9IGIuZ2V0QXR0cmlidXRlKCdkYXRhLXRhYicpID09PSB0YWJJZDtcclxuICAgIGIuc3R5bGUuY29sb3IgPSBhY3RpdmUgPyAndmFyKC0tdGV4dC1wcmltYXJ5KScgOiAndmFyKC0tdGV4dC1tdXRlZCknO1xyXG4gICAgYi5zdHlsZS5ib3JkZXJCb3R0b21Db2xvciA9IGFjdGl2ZSA/ICcjMGQ5NDg4JyA6ICd0cmFuc3BhcmVudCc7XHJcbiAgICBiLnN0eWxlLmZvbnRXZWlnaHQgPSBhY3RpdmUgPyAnNzAwJyA6ICc2MDAnO1xyXG4gIH0pO1xyXG4gIC8vIHYxMTA1IGZpeDogYWwgYWN0aXZhciBsYSB0YWIgc3RhdCwgbW9zdHJhciBwbGFjZWhvbGRlciBpbm1lZGlhdG8gcGFyYVxyXG4gIC8vIHF1ZSBzZSB2ZWEgYWxnbyBtaWVudHJhcyBjYXJnYSAobyBzaSBlbCBsb2FkIHlhIHRlcm1pbm8sIHJlLXJlbmRlcikuXHJcbiAgaWYgKHRhYklkID09PSAnc3RhdCcpIHtcclxuICAgIGNvbnN0IGNvbnQgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZm9yZWNhc3QtdGFiLXN0YXQnKTtcclxuICAgIGlmIChjb250KSB7XHJcbiAgICAgIGlmIChfZm9yZWNhc3RTdGF0RG9jcykge1xyXG4gICAgICAgIC8vIFlhIGNhcmdhZG86IHJlLXJlbmRlciAocG9yIHNpIGVsIHVzZXIgdmllbmUgZGUgb3RyYSB0YWIpLlxyXG4gICAgICAgIF9yZW5kZXJGb3JlY2FzdFN0YXRUYWIoKTtcclxuICAgICAgfSBlbHNlIHtcclxuICAgICAgICAvLyBBXHUwMEZBbiBubyBjYXJnYWRvOiBwbGFjZWhvbGRlciArIGxvYWQuXHJcbiAgICAgICAgY29udC5pbm5lckhUTUwgPVxyXG4gICAgICAgICAgJzxkaXYgc3R5bGU9XCJwYWRkaW5nOjYwcHggMjBweDt0ZXh0LWFsaWduOmNlbnRlcjtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTtmb250LXNpemU6MTRweFwiPicgK1xyXG4gICAgICAgICAgJzxkaXYgc3R5bGU9XCJkaXNwbGF5OmlubGluZS1ibG9jazt3aWR0aDoyNHB4O2hlaWdodDoyNHB4O2JvcmRlcjozcHggc29saWQgIzBkOTQ4ODtib3JkZXItdG9wLWNvbG9yOnRyYW5zcGFyZW50O2JvcmRlci1yYWRpdXM6NTAlO2FuaW1hdGlvbjpzcGluIDAuOHMgbGluZWFyIGluZmluaXRlO21hcmdpbi1ib3R0b206MTJweFwiPjwvZGl2PicgK1xyXG4gICAgICAgICAgJzxkaXY+Q2FyZ2FuZG8gZm9yZWNhc3Rfb3V0cHV0IGRlc2RlIEZpcmVzdG9yZS4uLjwvZGl2PicgK1xyXG4gICAgICAgICAgJzxzdHlsZT5Aa2V5ZnJhbWVzIHNwaW57dG97dHJhbnNmb3JtOnJvdGF0ZSgzNjBkZWcpfX08L3N0eWxlPicgK1xyXG4gICAgICAgICAgJzwvZGl2Pic7XHJcbiAgICAgICAgX2xvYWRGb3JlY2FzdE91dHB1dCgpXHJcbiAgICAgICAgICAudGhlbihfcmVuZGVyRm9yZWNhc3RTdGF0VGFiKVxyXG4gICAgICAgICAgLmNhdGNoKChlKSA9PiB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ1tGT1JFQ0FTVCBzdGF0XSBsb2FkIGZhaWwnLCBlKTtcclxuICAgICAgICAgICAgY29uc3QgYyA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdmb3JlY2FzdC10YWItc3RhdCcpO1xyXG4gICAgICAgICAgICBpZiAoYykge1xyXG4gICAgICAgICAgICAgIGMuaW5uZXJIVE1MID1cclxuICAgICAgICAgICAgICAgICc8ZGl2IHN0eWxlPVwicGFkZGluZzo2MHB4IDIwcHg7dGV4dC1hbGlnbjpjZW50ZXI7Y29sb3I6I2RjMjYyNjtsaW5lLWhlaWdodDoxLjZcIj4nICtcclxuICAgICAgICAgICAgICAgICc8ZGl2IHN0eWxlPVwiZm9udC1zaXplOjE2cHg7Zm9udC13ZWlnaHQ6NzAwO21hcmdpbi1ib3R0b206MTJweFwiPkVycm9yIGNhcmdhbmRvIGZvcmVjYXN0X291dHB1dDwvZGl2PicgK1xyXG4gICAgICAgICAgICAgICAgJzxkaXYgc3R5bGU9XCJmb250LXNpemU6MTJweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTttYXJnaW4tYm90dG9tOjE2cHhcIj4nICtcclxuICAgICAgICAgICAgICAgIGVzY2FwZUh0bWxTYWZlKGUubWVzc2FnZSB8fCBTdHJpbmcoZSkpICtcclxuICAgICAgICAgICAgICAgICc8L2Rpdj4nICtcclxuICAgICAgICAgICAgICAgICc8YnV0dG9uIG9uY2xpY2s9XCJzd2l0Y2hGb3JlY2FzdFRhYihcXCdzdGF0XFwnKVwiIHN0eWxlPVwicGFkZGluZzo4cHggMTRweDtiYWNrZ3JvdW5kOiMwZDk0ODg7Y29sb3I6I2ZmZjtib3JkZXI6bm9uZTtib3JkZXItcmFkaXVzOjZweDtmb250LXdlaWdodDo3MDA7Y3Vyc29yOnBvaW50ZXJcIj5SZWludGVudGFyPC9idXR0b24+JyArXHJcbiAgICAgICAgICAgICAgICAnPC9kaXY+JztcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgfSk7XHJcbiAgICAgIH1cclxuICAgIH1cclxuICB9XHJcbn07XHJcblxyXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuLy8gRkFTRSAxIFx1MjAxNCBTYWxlcyBQbGFucyB1cGxvYWQgKFJvZHMgLyBSZWVscyAvIEZHKVxyXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHJcbmZ1bmN0aW9uIF95ZWFyTW9udGhOb3coKSB7XHJcbiAgY29uc3QgZCA9IG5ldyBEYXRlKCk7XHJcbiAgcmV0dXJuIGQuZ2V0RnVsbFllYXIoKSArICctJyArIFN0cmluZyhkLmdldE1vbnRoKCkgKyAxKS5wYWRTdGFydCgyLCAnMCcpO1xyXG59XHJcblxyXG5mdW5jdGlvbiBfZm10U2l6ZShieXRlcykge1xyXG4gIGlmICghYnl0ZXMpIHJldHVybiAnJztcclxuICBpZiAoYnl0ZXMgPCAxMDI0KSByZXR1cm4gYnl0ZXMgKyAnIEInO1xyXG4gIGlmIChieXRlcyA8IDEwMjQgKiAxMDI0KSByZXR1cm4gKGJ5dGVzIC8gMTAyNCkudG9GaXhlZCgxKSArICcgS0InO1xyXG4gIHJldHVybiAoYnl0ZXMgLyAoMTAyNCAqIDEwMjQpKS50b0ZpeGVkKDIpICsgJyBNQic7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIF9mbXREYXRlU2hvcnQoaXNvKSB7XHJcbiAgaWYgKCFpc28pIHJldHVybiAnXHUyMDE0JztcclxuICB0cnkge1xyXG4gICAgY29uc3QgZCA9IGlzby50b0RhdGUgPyBpc28udG9EYXRlKCkgOiBuZXcgRGF0ZShpc28pO1xyXG4gICAgcmV0dXJuIChcclxuICAgICAgZC50b0xvY2FsZURhdGVTdHJpbmcoJ2VzLUFSJywgeyBkYXk6ICcyLWRpZ2l0JywgbW9udGg6ICdzaG9ydCcsIHllYXI6ICcyLWRpZ2l0JyB9KSArXHJcbiAgICAgICcgJyArXHJcbiAgICAgIGQudG9Mb2NhbGVUaW1lU3RyaW5nKCdlcy1BUicsIHsgaG91cjogJzItZGlnaXQnLCBtaW51dGU6ICcyLWRpZ2l0JyB9KVxyXG4gICAgKTtcclxuICB9IGNhdGNoIHtcclxuICAgIHJldHVybiBTdHJpbmcoaXNvKTtcclxuICB9XHJcbn1cclxuXHJcbmFzeW5jIGZ1bmN0aW9uIF9sb2FkU2FsZXNQbGFuQ2FjaGVzKCkge1xyXG4gIGlmICghd2luZG93LmZiRGIpIHJldHVybjtcclxuICBhd2FpdCBQcm9taXNlLmFsbChcclxuICAgIFNBTEVTX1BMQU5fRkFNSUxJQVMubWFwKGFzeW5jIChmKSA9PiB7XHJcbiAgICAgIHRyeSB7XHJcbiAgICAgICAgY29uc3QgZG9jID0gYXdhaXQgd2luZG93LmZiRGIuY29sbGVjdGlvbignc2FsZXNfcGxhbl9jYWNoZScpLmRvYyhmLmtleSkuZ2V0KCk7XHJcbiAgICAgICAgX3NhbGVzUGxhbkNhY2hlc1tmLmtleV0gPSBkb2MuZXhpc3RzID8gZG9jLmRhdGEoKSA6IG51bGw7XHJcbiAgICAgIH0gY2F0Y2ggKGUpIHtcclxuICAgICAgICBjb25zb2xlLndhcm4oJ1tGT1JFQ0FTVF0gbG9hZCBzYWxlc19wbGFuX2NhY2hlLycgKyBmLmtleSArICcgZmFpbDonLCBlICYmIGUubWVzc2FnZSk7XHJcbiAgICAgICAgX3NhbGVzUGxhbkNhY2hlc1tmLmtleV0gPSBudWxsO1xyXG4gICAgICB9XHJcbiAgICB9KVxyXG4gICk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIF9yZW5kZXJUYWJsZShyb3dzKSB7XHJcbiAgY29uc3QgYm9keSA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdmb3JlY2FzdC1ib2R5Jyk7XHJcbiAgaWYgKCFib2R5KSByZXR1cm47XHJcbiAgaWYgKCFyb3dzIHx8ICFyb3dzLmxlbmd0aCkge1xyXG4gICAgYm9keS5pbm5lckhUTUwgPVxyXG4gICAgICAnPGRpdiBzdHlsZT1cInBhZGRpbmc6NjBweCAyMHB4O3RleHQtYWxpZ246Y2VudGVyO2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpXCI+U2FsZXMgUGxhbiB2YWNpbyBvIHNpbiBmaWxhcyB2YWxpZGFzLjwvZGl2Pic7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIGNvbnN0IGZtdCA9IChuKSA9PlxyXG4gICAgbiA9PT0gMCB8fCAhTnVtYmVyLmlzRmluaXRlKG4pXHJcbiAgICAgID8gJzAnXHJcbiAgICAgIDogTnVtYmVyKG4pLnRvTG9jYWxlU3RyaW5nKCdlcy1BUicsIHsgbWF4aW11bUZyYWN0aW9uRGlnaXRzOiAxIH0pO1xyXG4gIGNvbnN0IGNvbG9yRm9yVG90YWwgPSAodCkgPT4ge1xyXG4gICAgaWYgKHQgPiAwKSByZXR1cm4gJyMxNjY1MzQnOyAvLyBzb2JyYSAocGVkaXN0ZSBtYXMgcXVlIGxhIHBvbGl0aWNhKSAtIHZlcmRlXHJcbiAgICBpZiAodCA8IDApIHJldHVybiAnI2MyNDEwYyc7IC8vIGZhbHRhIChwZWRpc3RlIG1lbm9zIHF1ZSBsYSBwb2xpdGljYSkgLSBuYXJhbmphIHVyZ2VudGVcclxuICAgIHJldHVybiAnIzQ3NTU2OSc7XHJcbiAgfTtcclxuICBjb25zdCByb3dzSHRtbCA9IHJvd3NcclxuICAgIC5tYXAoXHJcbiAgICAgIChyKSA9PlxyXG4gICAgICAgICcnICtcclxuICAgICAgICAnPHRyJyArXHJcbiAgICAgICAgKHIuaGFzSGlzdG9yaWEgPyAnJyA6ICcgc3R5bGU9XCJiYWNrZ3JvdW5kOnZhcigtLWNvbG9yLXdhcm5pbmctYmcpXCInKSArXHJcbiAgICAgICAgJz4nICtcclxuICAgICAgICAnPHRkIHN0eWxlPVwicGFkZGluZzo2cHggMTBweDtmb250LWZhbWlseTptb25vc3BhY2U7Zm9udC1zaXplOjExcHg7d2hpdGUtc3BhY2U6bm93cmFwXCI+JyArXHJcbiAgICAgICAgZXNjYXBlSHRtbFNhZmUoci5za3UpICtcclxuICAgICAgICAnPC90ZD4nICtcclxuICAgICAgICAnPHRkIHN0eWxlPVwicGFkZGluZzo2cHggMTBweDtmb250LXNpemU6MTFweFwiPicgK1xyXG4gICAgICAgIGVzY2FwZUh0bWxTYWZlKHIuZmFtaWxpYSkgK1xyXG4gICAgICAgICc8L3RkPicgK1xyXG4gICAgICAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjZweCAxMHB4O2ZvbnQtc2l6ZToxMXB4XCI+JyArXHJcbiAgICAgICAgZXNjYXBlSHRtbFNhZmUoci5zdWJmYW1pbGlhKSArXHJcbiAgICAgICAgJzwvdGQ+JyArXHJcbiAgICAgICAgJzx0ZCBzdHlsZT1cInBhZGRpbmc6NnB4IDEwcHg7dGV4dC1hbGlnbjpyaWdodDtmb250LXZhcmlhbnQtbnVtZXJpYzp0YWJ1bGFyLW51bXNcIj4nICtcclxuICAgICAgICBmbXQoci52ZW50YXMxMm0pICtcclxuICAgICAgICAnPC90ZD4nICtcclxuICAgICAgICAnPHRkIHN0eWxlPVwicGFkZGluZzo2cHggMTBweDt0ZXh0LWFsaWduOnJpZ2h0O2ZvbnQtdmFyaWFudC1udW1lcmljOnRhYnVsYXItbnVtcztmb250LXdlaWdodDo2MDBcIj4nICtcclxuICAgICAgICBmbXQoci5wZWRpZG82bSkgK1xyXG4gICAgICAgICc8L3RkPicgK1xyXG4gICAgICAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjZweCAxMHB4O3RleHQtYWxpZ246cmlnaHQ7Zm9udC12YXJpYW50LW51bWVyaWM6dGFidWxhci1udW1zO2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpXCI+JyArXHJcbiAgICAgICAgZm10KHIucHJvbWVkaW8pICtcclxuICAgICAgICAnPC90ZD4nICtcclxuICAgICAgICAnPHRkIHN0eWxlPVwicGFkZGluZzo2cHggMTBweDt0ZXh0LWFsaWduOnJpZ2h0O2ZvbnQtdmFyaWFudC1udW1lcmljOnRhYnVsYXItbnVtc1wiPicgK1xyXG4gICAgICAgIGZtdChyLnBvbGl0aWNhKSArXHJcbiAgICAgICAgJzwvdGQ+JyArXHJcbiAgICAgICAgJzx0ZCBzdHlsZT1cInBhZGRpbmc6NnB4IDEwcHg7dGV4dC1hbGlnbjpyaWdodDtmb250LXZhcmlhbnQtbnVtZXJpYzp0YWJ1bGFyLW51bXM7Zm9udC13ZWlnaHQ6NzAwO2NvbG9yOicgK1xyXG4gICAgICAgIGNvbG9yRm9yVG90YWwoci50b3RhbCkgK1xyXG4gICAgICAgICdcIj4nICtcclxuICAgICAgICBmbXQoci50b3RhbCkgK1xyXG4gICAgICAgICc8L3RkPicgK1xyXG4gICAgICAgICc8L3RyPidcclxuICAgIClcclxuICAgIC5qb2luKCcnKTtcclxuICBjb25zdCBoZWFkZXIgPVxyXG4gICAgJycgK1xyXG4gICAgJzx0aGVhZCBzdHlsZT1cInBvc2l0aW9uOnN0aWNreTt0b3A6MDtiYWNrZ3JvdW5kOiMwZjE3MmE7Y29sb3I6I2ZmZjt6LWluZGV4OjFcIj4nICtcclxuICAgICc8dHI+JyArXHJcbiAgICAnPHRoIHN0eWxlPVwicGFkZGluZzo4cHggMTBweDt0ZXh0LWFsaWduOmxlZnQ7Zm9udC1zaXplOjExcHg7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO2xldHRlci1zcGFjaW5nOi40cHhcIj5TS1U8L3RoPicgK1xyXG4gICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6OHB4IDEwcHg7dGV4dC1hbGlnbjpsZWZ0O2ZvbnQtc2l6ZToxMXB4O3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtsZXR0ZXItc3BhY2luZzouNHB4XCI+RmFtaWxpYTwvdGg+JyArXHJcbiAgICAnPHRoIHN0eWxlPVwicGFkZGluZzo4cHggMTBweDt0ZXh0LWFsaWduOmxlZnQ7Zm9udC1zaXplOjExcHg7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO2xldHRlci1zcGFjaW5nOi40cHhcIj5TdWJmYW1pbGlhPC90aD4nICtcclxuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjhweCAxMHB4O3RleHQtYWxpZ246cmlnaHQ7Zm9udC1zaXplOjExcHg7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO2xldHRlci1zcGFjaW5nOi40cHhcIiB0aXRsZT1cIlN1bWEgZGUgcXR5IGZhY3R1cmFkYSBlbiBsb3MgdWx0aW1vcyAxMiBtZXNlcyBjb21wbGV0b3NcIj5WZW50YXMgMTJtPC90aD4nICtcclxuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjhweCAxMHB4O3RleHQtYWxpZ246cmlnaHQ7Zm9udC1zaXplOjExcHg7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO2xldHRlci1zcGFjaW5nOi40cHhcIiB0aXRsZT1cIlN1bWEgZGUgbGFzIDYgY29sdW1uYXMgZGVsIEV4Y2VsIFNhbGVzIFBsYW5cIj5QZWRpZG8gNm08L3RoPicgK1xyXG4gICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6OHB4IDEwcHg7dGV4dC1hbGlnbjpyaWdodDtmb250LXNpemU6MTFweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7bGV0dGVyLXNwYWNpbmc6LjRweFwiIHRpdGxlPVwiVmVudGFzIFlURCAvIG1lc2VzIHRyYW5zY3Vycmlkb3MgZGVsIGFcdTAwRjFvXCI+UHJvbSAvIE1lczwvdGg+JyArXHJcbiAgICAnPHRoIHN0eWxlPVwicGFkZGluZzo4cHggMTBweDt0ZXh0LWFsaWduOnJpZ2h0O2ZvbnQtc2l6ZToxMXB4O3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtsZXR0ZXItc3BhY2luZzouNHB4XCIgdGl0bGU9XCJQcm9tZWRpbyB4IDMgbWVzZXMgKHBvbGl0aWNhIGRlIGludmVudGFyaW8pXCI+UG9saXRpY2E8L3RoPicgK1xyXG4gICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6OHB4IDEwcHg7dGV4dC1hbGlnbjpyaWdodDtmb250LXNpemU6MTFweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7bGV0dGVyLXNwYWNpbmc6LjRweFwiIHRpdGxlPVwiUGVkaWRvIDZtIC0gUG9saXRpY2EuIE5lZ2F0aXZvID0gdGUgZmFsdGEgcGVkaXI7IFBvc2l0aXZvID0gc29icmVwZWRpZG9cIj5Ub3RhbDwvdGg+JyArXHJcbiAgICAnPC90cj4nICtcclxuICAgICc8L3RoZWFkPic7XHJcbiAgYm9keS5pbm5lckhUTUwgPVxyXG4gICAgJzx0YWJsZSBzdHlsZT1cIndpZHRoOjEwMCU7Ym9yZGVyLWNvbGxhcHNlOmNvbGxhcHNlO2ZvbnQtc2l6ZToxMnB4XCI+JyArXHJcbiAgICBoZWFkZXIgK1xyXG4gICAgJzx0Ym9keT4nICtcclxuICAgIHJvd3NIdG1sICtcclxuICAgICc8L3Rib2R5PjwvdGFibGU+JztcclxufVxyXG5cclxuZnVuY3Rpb24gZXNjYXBlSHRtbFNhZmUocykge1xyXG4gIGlmICh0eXBlb2Ygd2luZG93LmVzY2FwZUh0bWwgPT09ICdmdW5jdGlvbicpIHJldHVybiB3aW5kb3cuZXNjYXBlSHRtbChzKTtcclxuICByZXR1cm4gU3RyaW5nKHMgPT0gbnVsbCA/ICcnIDogcykucmVwbGFjZShcclxuICAgIC9bJjw+XCInXS9nLFxyXG4gICAgKGNoKSA9PiAoeyAnJic6ICcmYW1wOycsICc8JzogJyZsdDsnLCAnPic6ICcmZ3Q7JywgJ1wiJzogJyZxdW90OycsIFwiJ1wiOiAnJiMzOTsnIH0pW2NoXVxyXG4gICk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIF9idWlsZFNhbGVzUGxhblNsb3RIdG1sKGYpIHtcclxuICBjb25zdCBjYWNoZSA9IF9zYWxlc1BsYW5DYWNoZXNbZi5rZXldO1xyXG4gIGNvbnN0IHJvd3NDb3VudCA9IGNhY2hlICYmIE51bWJlci5pc0Zpbml0ZShjYWNoZS5yb3dzQ291bnQpID8gY2FjaGUucm93c0NvdW50IDogMDtcclxuICBjb25zdCBtb250aHNDb3VudCA9XHJcbiAgICBjYWNoZSAmJiBBcnJheS5pc0FycmF5KGNhY2hlLmRldGVjdGVkTW9udGhzKSA/IGNhY2hlLmRldGVjdGVkTW9udGhzLmxlbmd0aCA6IDA7XHJcbiAgY29uc3QgcGFyc2VkQXQgPSBjYWNoZSAmJiBjYWNoZS5wYXJzZWRBdCA/IF9mbXREYXRlU2hvcnQoY2FjaGUucGFyc2VkQXQpIDogJyc7XHJcbiAgY29uc3QgdXBsb2FkZWRCeSA9IGNhY2hlICYmIGNhY2hlLnVwbG9hZGVkQnkgPyBjYWNoZS51cGxvYWRlZEJ5IDogJyc7XHJcbiAgY29uc3Qgc291cmNlRmlsZW5hbWUgPSBjYWNoZSAmJiBjYWNoZS5zb3VyY2VGaWxlbmFtZSA/IGNhY2hlLnNvdXJjZUZpbGVuYW1lIDogJyc7XHJcbiAgY29uc3QgeWVhck1vbnRoID0gY2FjaGUgJiYgY2FjaGUueWVhck1vbnRoID8gY2FjaGUueWVhck1vbnRoIDogJyc7XHJcbiAgY29uc3QgbW9udGhzUmFuZ2UgPVxyXG4gICAgY2FjaGUgJiYgY2FjaGUuZGV0ZWN0ZWRNb250aHMgJiYgY2FjaGUuZGV0ZWN0ZWRNb250aHMubGVuZ3RoXHJcbiAgICAgID8gY2FjaGUuZGV0ZWN0ZWRNb250aHNbMF0gKyAnIFx1MjE5MiAnICsgY2FjaGUuZGV0ZWN0ZWRNb250aHNbY2FjaGUuZGV0ZWN0ZWRNb250aHMubGVuZ3RoIC0gMV1cclxuICAgICAgOiAnXHUyMDE0JztcclxuICBjb25zdCBoYXNDYWNoZSA9ICEhY2FjaGU7XHJcbiAgY29uc3QgYmFkZ2UgPSBoYXNDYWNoZVxyXG4gICAgPyAnPGRpdiBzdHlsZT1cInBhZGRpbmc6NHB4IDhweDtiYWNrZ3JvdW5kOiMxNmEzNGE7Y29sb3I6I2ZmZjtib3JkZXItcmFkaXVzOjEycHg7Zm9udC1zaXplOjEwcHg7Zm9udC13ZWlnaHQ6NzAwO2xldHRlci1zcGFjaW5nOi40cHhcIj5DQVJHQURPPC9kaXY+J1xyXG4gICAgOiAnPGRpdiBzdHlsZT1cInBhZGRpbmc6NHB4IDhweDtiYWNrZ3JvdW5kOiNkYzI2MjY7Y29sb3I6I2ZmZjtib3JkZXItcmFkaXVzOjEycHg7Zm9udC1zaXplOjEwcHg7Zm9udC13ZWlnaHQ6NzAwO2xldHRlci1zcGFjaW5nOi40cHhcIj5GQUxUQTwvZGl2Pic7XHJcbiAgY29uc3QgbWV0YUJsb2NrID0gaGFzQ2FjaGVcclxuICAgID8gJzxkaXYgc3R5bGU9XCJkaXNwbGF5OmdyaWQ7Z3JpZC10ZW1wbGF0ZS1jb2x1bW5zOmF1dG8gMWZyO2dhcDo2cHggMTJweDtmb250LXNpemU6MTFweDtwYWRkaW5nOjEwcHggMTJweDtiYWNrZ3JvdW5kOnZhcigtLWJnLXNlY29uZGFyeSk7Ym9yZGVyLXJhZGl1czo2cHhcIj4nICtcclxuICAgICAgJzxkaXYgc3R5bGU9XCJjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTtmb250LXdlaWdodDo2MDBcIj5BcmNoaXZvPC9kaXY+PGRpdiBzdHlsZT1cImNvbG9yOnZhcigtLXRleHQtcHJpbWFyeSk7Zm9udC1mYW1pbHk6bW9ub3NwYWNlO3dvcmQtYnJlYWs6YnJlYWstYWxsXCI+JyArXHJcbiAgICAgIGVzY2FwZUh0bWxTYWZlKHNvdXJjZUZpbGVuYW1lKSArXHJcbiAgICAgICc8L2Rpdj4nICtcclxuICAgICAgJzxkaXYgc3R5bGU9XCJjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTtmb250LXdlaWdodDo2MDBcIj5TdWJpZG88L2Rpdj48ZGl2IHN0eWxlPVwiY29sb3I6dmFyKC0tdGV4dC1wcmltYXJ5KVwiPicgK1xyXG4gICAgICBlc2NhcGVIdG1sU2FmZShwYXJzZWRBdCkgK1xyXG4gICAgICAnPC9kaXY+JyArXHJcbiAgICAgICc8ZGl2IHN0eWxlPVwiY29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7Zm9udC13ZWlnaHQ6NjAwXCI+UG9yPC9kaXY+PGRpdiBzdHlsZT1cImNvbG9yOnZhcigtLXRleHQtcHJpbWFyeSlcIj4nICtcclxuICAgICAgZXNjYXBlSHRtbFNhZmUodXBsb2FkZWRCeSkgK1xyXG4gICAgICAnPC9kaXY+JyArXHJcbiAgICAgICc8ZGl2IHN0eWxlPVwiY29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7Zm9udC13ZWlnaHQ6NjAwXCI+U25hcHNob3Q8L2Rpdj48ZGl2IHN0eWxlPVwiY29sb3I6dmFyKC0tdGV4dC1wcmltYXJ5KTtmb250LWZhbWlseTptb25vc3BhY2VcIj4nICtcclxuICAgICAgZXNjYXBlSHRtbFNhZmUoeWVhck1vbnRoKSArXHJcbiAgICAgICc8L2Rpdj4nICtcclxuICAgICAgJzxkaXYgc3R5bGU9XCJjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTtmb250LXdlaWdodDo2MDBcIj5TS1VzPC9kaXY+PGRpdiBzdHlsZT1cImNvbG9yOnZhcigtLXRleHQtcHJpbWFyeSk7Zm9udC13ZWlnaHQ6NzAwXCI+JyArXHJcbiAgICAgIHJvd3NDb3VudC50b0xvY2FsZVN0cmluZygnZXMtQVInKSArXHJcbiAgICAgICc8L2Rpdj4nICtcclxuICAgICAgJzxkaXYgc3R5bGU9XCJjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTtmb250LXdlaWdodDo2MDBcIj5NZXNlczwvZGl2PjxkaXYgc3R5bGU9XCJjb2xvcjp2YXIoLS10ZXh0LXByaW1hcnkpO2ZvbnQtd2VpZ2h0OjcwMFwiPicgK1xyXG4gICAgICBtb250aHNDb3VudCArXHJcbiAgICAgICcgPHNwYW4gc3R5bGU9XCJjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTtmb250LXdlaWdodDo0MDBcIj4oJyArXHJcbiAgICAgIGVzY2FwZUh0bWxTYWZlKG1vbnRoc1JhbmdlKSArXHJcbiAgICAgICcpPC9zcGFuPjwvZGl2PicgK1xyXG4gICAgICAnPC9kaXY+J1xyXG4gICAgOiAnPGRpdiBzdHlsZT1cInBhZGRpbmc6MTRweDt0ZXh0LWFsaWduOmNlbnRlcjtmb250LXNpemU6MTJweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTtiYWNrZ3JvdW5kOnZhcigtLWJnLXNlY29uZGFyeSk7Ym9yZGVyLXJhZGl1czo2cHg7Ym9yZGVyOjFweCBkYXNoZWQgdmFyKC0tYm9yZGVyLXN1YnRsZSlcIj5BdW4gbm8gc3ViaXN0ZSBlbCBTYWxlcyBQbGFuIGRlIGVzdGEgZmFtaWxpYS48L2Rpdj4nO1xyXG4gIGNvbnN0IHVwbG9hZEJ0biA9XHJcbiAgICAnPGxhYmVsIHN0eWxlPVwiZGlzcGxheTppbmxpbmUtZmxleDthbGlnbi1pdGVtczpjZW50ZXI7anVzdGlmeS1jb250ZW50OmNlbnRlcjtnYXA6OHB4O3BhZGRpbmc6MTBweCAxNHB4O2JhY2tncm91bmQ6JyArXHJcbiAgICBmLmNvbG9yICtcclxuICAgICc7Y29sb3I6I2ZmZjtib3JkZXItcmFkaXVzOjZweDtmb250LXdlaWdodDo3MDA7Zm9udC1zaXplOjEycHg7Y3Vyc29yOnBvaW50ZXI7bGV0dGVyLXNwYWNpbmc6LjRweFwiPicgK1xyXG4gICAgJzxzcGFuPicgK1xyXG4gICAgKGhhc0NhY2hlID8gJ1x1MjFCQiBSZWVtcGxhemFyIEV4Y2VsJyA6ICdcdTJCMDYgQ2FyZ2FyIEV4Y2VsJykgK1xyXG4gICAgJzwvc3Bhbj4nICtcclxuICAgICc8aW5wdXQgdHlwZT1cImZpbGVcIiBhY2NlcHQ9XCIueGxzeCwueGxzXCIgZGF0YS1mYW1pbGlhPVwiJyArXHJcbiAgICBmLmtleSArXHJcbiAgICAnXCIgc3R5bGU9XCJkaXNwbGF5Om5vbmVcIiBvbmNoYW5nZT1cIm9uU2FsZXNQbGFuRmlsZUZvckZhbWlsaWEoZXZlbnQsIFxcJycgK1xyXG4gICAgZi5rZXkgK1xyXG4gICAgJ1xcJylcIi8+JyArXHJcbiAgICAnPC9sYWJlbD4nO1xyXG4gIGNvbnN0IGNhcmRIZWFkID1cclxuICAgICc8ZGl2IHN0eWxlPVwiZGlzcGxheTpmbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtnYXA6MTBweFwiPicgK1xyXG4gICAgJzxkaXYgc3R5bGU9XCJ3aWR0aDoxMnB4O2hlaWdodDozMnB4O2JhY2tncm91bmQ6JyArXHJcbiAgICBmLmNvbG9yICtcclxuICAgICc7Ym9yZGVyLXJhZGl1czozcHhcIj48L2Rpdj4nICtcclxuICAgICc8ZGl2IHN0eWxlPVwiZmxleDoxXCI+PGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxNHB4O2ZvbnQtd2VpZ2h0OjgwMDtjb2xvcjp2YXIoLS10ZXh0LXByaW1hcnkpXCI+JyArXHJcbiAgICBlc2NhcGVIdG1sU2FmZShmLmxhYmVsKSArXHJcbiAgICAnPC9kaXY+JyArXHJcbiAgICAnPGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMXB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO21hcmdpbi10b3A6MnB4XCI+U2FsZXMgUGxhbiBtZW5zdWFsIFx1MDBCNyBIb2phIFNBUjwvZGl2PjwvZGl2PicgK1xyXG4gICAgYmFkZ2UgK1xyXG4gICAgJzwvZGl2Pic7XHJcbiAgcmV0dXJuIChcclxuICAgICc8ZGl2IHN0eWxlPVwiYmFja2dyb3VuZDp2YXIoLS1iZy1lbGV2YXRlZCk7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1ib3JkZXItc3VidGxlKTtib3JkZXItcmFkaXVzOjEwcHg7cGFkZGluZzoxNnB4O2Rpc3BsYXk6ZmxleDtmbGV4LWRpcmVjdGlvbjpjb2x1bW47Z2FwOjEycHhcIj4nICtcclxuICAgIGNhcmRIZWFkICtcclxuICAgIG1ldGFCbG9jayArXHJcbiAgICB1cGxvYWRCdG4gK1xyXG4gICAgJzxkaXYgaWQ9XCJzYWxlcy1wbGFuLXN0YXR1cy0nICtcclxuICAgIGYua2V5ICtcclxuICAgICdcIiBzdHlsZT1cImZvbnQtc2l6ZToxMXB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO21pbi1oZWlnaHQ6MTRweFwiPjwvZGl2PicgK1xyXG4gICAgJzwvZGl2PidcclxuICApO1xyXG59XHJcblxyXG5mdW5jdGlvbiBfcmVuZGVyU2FsZXNQbGFuc1RhYigpIHtcclxuICBjb25zdCBjb250ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2ZvcmVjYXN0LXRhYi1zYWxlcy1wbGFucycpO1xyXG4gIGlmICghY29udCkgcmV0dXJuO1xyXG4gIGNvbnN0IHNsb3RzID0gU0FMRVNfUExBTl9GQU1JTElBUy5tYXAoX2J1aWxkU2FsZXNQbGFuU2xvdEh0bWwpLmpvaW4oJycpO1xyXG4gIGNvbnN0IGludHJvID1cclxuICAgICc8ZGl2IHN0eWxlPVwibWFyZ2luLWJvdHRvbToxNnB4O3BhZGRpbmc6MTJweCAxNHB4O2JhY2tncm91bmQ6dmFyKC0tYmctc2Vjb25kYXJ5KTtib3JkZXItbGVmdDozcHggc29saWQgIzBkOTQ4ODtib3JkZXItcmFkaXVzOjZweDtmb250LXNpemU6MTJweDtjb2xvcjp2YXIoLS10ZXh0LXNlY29uZGFyeSk7bGluZS1oZWlnaHQ6MS41XCI+JyArXHJcbiAgICAnPGIgc3R5bGU9XCJjb2xvcjp2YXIoLS10ZXh0LXByaW1hcnkpXCI+RmFzZSAxPC9iPiBcdTIwMTQgQ2FyZ1x1MDBFMSBsb3MgMyBTYWxlcyBQbGFucyBtZW5zdWFsZXMgKFJvZHMgLyBSZWVscyAvIEZHKS4gU2UgcGFyc2VhIGxhIGhvamEgPGI+U0FSPC9iPjogU0tVLCBNT1EgMTIgbW9udGhzLCB5IHVuYSBjb2x1bW5hIHBvciBtZXMuICcgK1xyXG4gICAgJ0VsIEV4Y2VsIG9yaWdpbmFsIHF1ZWRhIHNuYXBzaG90YWRvIGVuIFN0b3JhZ2UgeSBlbCBwYXJzZW8gcXVlZGEgZW4gRmlyZXN0b3JlIHBhcmEgZWwgY1x1MDBFMWxjdWxvIChwclx1MDBGM3hpbWEgZmFzZSkuJyArXHJcbiAgICAnPC9kaXY+JztcclxuICBjb25zdCBncmlkID1cclxuICAgICc8ZGl2IHN0eWxlPVwiZGlzcGxheTpncmlkO2dyaWQtdGVtcGxhdGUtY29sdW1uczpyZXBlYXQoYXV0by1maXQsbWlubWF4KDMyMHB4LDFmcikpO2dhcDoxNnB4XCI+JyArXHJcbiAgICBzbG90cyArXHJcbiAgICAnPC9kaXY+JztcclxuICBjb250LmlubmVySFRNTCA9ICc8ZGl2IHN0eWxlPVwicGFkZGluZzoxOHB4XCI+JyArIGludHJvICsgZ3JpZCArICc8L2Rpdj4nO1xyXG59XHJcblxyXG53aW5kb3cub25TYWxlc1BsYW5GaWxlRm9yRmFtaWxpYSA9IGFzeW5jIGZ1bmN0aW9uIChldmVudCwgZmFtaWxpYSkge1xyXG4gIGNvbnN0IGZpbGUgPSBldmVudCAmJiBldmVudC50YXJnZXQgJiYgZXZlbnQudGFyZ2V0LmZpbGVzICYmIGV2ZW50LnRhcmdldC5maWxlc1swXTtcclxuICBpZiAoIWZpbGUpIHJldHVybjtcclxuICBjb25zdCBzdGF0dXNFbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdzYWxlcy1wbGFuLXN0YXR1cy0nICsgZmFtaWxpYSk7XHJcbiAgY29uc3Qgc2V0U3RhdHVzID0gKG1zZywgY29sb3IpID0+IHtcclxuICAgIGlmICghc3RhdHVzRWwpIHJldHVybjtcclxuICAgIHN0YXR1c0VsLnRleHRDb250ZW50ID0gbXNnO1xyXG4gICAgc3RhdHVzRWwuc3R5bGUuY29sb3IgPSBjb2xvciB8fCAndmFyKC0tdGV4dC1tdXRlZCknO1xyXG4gIH07XHJcbiAgdHJ5IHtcclxuICAgIGlmICh0eXBlb2YgWExTWCA9PT0gJ3VuZGVmaW5lZCcpIHtcclxuICAgICAgYWxlcnQoJ1NoZWV0SlMgKFhMU1gpIG5vIGNhcmdhZG8gXHUyMDE0IHJlY2FyZ1x1MDBFMSBsYSBhcHAuJyk7XHJcbiAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIGlmICghd2luZG93LlNhbGVzUGxhblBhcnNlciB8fCAhd2luZG93LlNhbGVzUGxhblBhcnNlci5wYXJzZVNhbGVzUGxhblNoZWV0KSB7XHJcbiAgICAgIGFsZXJ0KCdQYXJzZXIgU2FsZXMgUGxhbiBubyBjYXJnYWRvLiBSZWJ1aWxkIGJ1bmRsZS4nKTtcclxuICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG4gICAgaWYgKCF3aW5kb3cuZmlyZWJhc2UgfHwgIXdpbmRvdy5maXJlYmFzZS5zdG9yYWdlKSB7XHJcbiAgICAgIGFsZXJ0KCdGaXJlYmFzZSBTdG9yYWdlIG5vIGRpc3BvbmlibGUuJyk7XHJcbiAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIHNldFN0YXR1cygnTGV5ZW5kbyBFeGNlbFx1MjAyNicpO1xyXG4gICAgY29uc3QgYnVmID0gYXdhaXQgZmlsZS5hcnJheUJ1ZmZlcigpO1xyXG4gICAgY29uc3Qgd2IgPSBYTFNYLnJlYWQoYnVmLCB7IHR5cGU6ICdhcnJheScgfSk7XHJcbiAgICBjb25zdCBzYXJOYW1lID0gd2IuU2hlZXROYW1lcy5maW5kKFxyXG4gICAgICAobikgPT5cclxuICAgICAgICBTdHJpbmcobiB8fCAnJylcclxuICAgICAgICAgIC50cmltKClcclxuICAgICAgICAgIC50b1VwcGVyQ2FzZSgpID09PSAnU0FSJ1xyXG4gICAgKTtcclxuICAgIGlmICghc2FyTmFtZSkge1xyXG4gICAgICBzZXRTdGF0dXMoXHJcbiAgICAgICAgJ1x1MjZBMCBFbCBFeGNlbCBubyB0aWVuZSBob2phIFwiU0FSXCIuIEhvamFzIGVuY29udHJhZGFzOiAnICsgd2IuU2hlZXROYW1lcy5qb2luKCcsICcpLFxyXG4gICAgICAgICcjZGMyNjI2J1xyXG4gICAgICApO1xyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcbiAgICBjb25zdCBzaGVldCA9IHdiLlNoZWV0c1tzYXJOYW1lXTtcclxuICAgIGNvbnN0IHJvd3MgPSBYTFNYLnV0aWxzLnNoZWV0X3RvX2pzb24oc2hlZXQsIHsgaGVhZGVyOiAxLCBkZWZ2YWw6ICcnLCByYXc6IHRydWUgfSk7XHJcbiAgICBzZXRTdGF0dXMoJ1BhcnNlYW5kbyAnICsgcm93cy5sZW5ndGggKyAnIGZpbGFzIGRlIGhvamEgXCInICsgc2FyTmFtZSArICdcIlx1MjAyNicpO1xyXG4gICAgY29uc3QgcGFyc2VkID0gd2luZG93LlNhbGVzUGxhblBhcnNlci5wYXJzZVNhbGVzUGxhblNoZWV0KHJvd3MpO1xyXG4gICAgaWYgKCFwYXJzZWQucm93cy5sZW5ndGgpIHtcclxuICAgICAgc2V0U3RhdHVzKCdcdTI2QTAgRXhjZWwgcGFyc2VhZG8gcGVybyBzaW4gU0tVcyB2XHUwMEUxbGlkb3MuJywgJyNkYzI2MjYnKTtcclxuICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG4gICAgY29uc3QgeWVhck1vbnRoID0gX3llYXJNb250aE5vdygpO1xyXG4gICAgY29uc3Qgc3RvcmFnZVBhdGggPSAnZm9yZWNhc3RzX3NuYXBzaG90cy8nICsgeWVhck1vbnRoICsgJy8nICsgZmFtaWxpYSArICcueGxzeCc7XHJcbiAgICBzZXRTdGF0dXMoJ1N1YmllbmRvIEV4Y2VsIGEgU3RvcmFnZSAoJyArIF9mbXRTaXplKGZpbGUuc2l6ZSkgKyAnKVx1MjAyNicpO1xyXG4gICAgY29uc3Qgc3RvcmFnZVJlZiA9IHdpbmRvdy5maXJlYmFzZS5zdG9yYWdlKCkucmVmKHN0b3JhZ2VQYXRoKTtcclxuICAgIGF3YWl0IHN0b3JhZ2VSZWYucHV0KGZpbGUsIHtcclxuICAgICAgY29udGVudFR5cGU6IGZpbGUudHlwZSB8fCAnYXBwbGljYXRpb24vdm5kLm9wZW54bWxmb3JtYXRzLW9mZmljZWRvY3VtZW50LnNwcmVhZHNoZWV0bWwuc2hlZXQnLFxyXG4gICAgICBjdXN0b21NZXRhZGF0YToge1xyXG4gICAgICAgIGZhbWlsaWEsXHJcbiAgICAgICAgdXBsb2FkZWRCeTogKHdpbmRvdy5jdXJyZW50VXNlciAmJiB3aW5kb3cuY3VycmVudFVzZXIuZW1haWwpIHx8ICcnLFxyXG4gICAgICAgIHNvdXJjZUZpbGVuYW1lOiBmaWxlLm5hbWUgfHwgJycsXHJcbiAgICAgIH0sXHJcbiAgICB9KTtcclxuICAgIHNldFN0YXR1cygnR3VhcmRhbmRvIHBhcnNlbyBlbiBGaXJlc3RvcmUgKCcgKyBwYXJzZWQucm93cy5sZW5ndGggKyAnIFNLVXMpXHUyMDI2Jyk7XHJcbiAgICBjb25zdCB1cGxvYWRlZEJ5ID0gKHdpbmRvdy5jdXJyZW50VXNlciAmJiB3aW5kb3cuY3VycmVudFVzZXIuZW1haWwpIHx8ICd1bmtub3duJztcclxuICAgIGNvbnN0IHBheWxvYWQgPSB7XHJcbiAgICAgIGZhbWlsaWEsXHJcbiAgICAgIHBhcnNlZEF0OlxyXG4gICAgICAgIHdpbmRvdy5maXJlYmFzZSAmJiB3aW5kb3cuZmlyZWJhc2UuZmlyZXN0b3JlICYmIHdpbmRvdy5maXJlYmFzZS5maXJlc3RvcmUuRmllbGRWYWx1ZVxyXG4gICAgICAgICAgPyB3aW5kb3cuZmlyZWJhc2UuZmlyZXN0b3JlLkZpZWxkVmFsdWUuc2VydmVyVGltZXN0YW1wKClcclxuICAgICAgICAgIDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxyXG4gICAgICB1cGxvYWRlZEJ5LFxyXG4gICAgICBzb3VyY2VGaWxlbmFtZTogZmlsZS5uYW1lIHx8ICcnLFxyXG4gICAgICBzb3VyY2VTaGVldDogc2FyTmFtZSxcclxuICAgICAgeWVhck1vbnRoLFxyXG4gICAgICBzdG9yYWdlUGF0aCxcclxuICAgICAgcm93c0NvdW50OiBwYXJzZWQucm93cy5sZW5ndGgsXHJcbiAgICAgIGhlYWRlclJvd0luZGV4OiBwYXJzZWQuaGVhZGVyUm93SW5kZXgsXHJcbiAgICAgIGRldGVjdGVkTW9udGhzOiBwYXJzZWQuZGV0ZWN0ZWRNb250aHMsXHJcbiAgICAgIHJvd3M6IHBhcnNlZC5yb3dzLFxyXG4gICAgfTtcclxuICAgIGF3YWl0IHdpbmRvdy5mYkRiLmNvbGxlY3Rpb24oJ3NhbGVzX3BsYW5fY2FjaGUnKS5kb2MoZmFtaWxpYSkuc2V0KHBheWxvYWQpO1xyXG4gICAgX3NhbGVzUGxhbkNhY2hlc1tmYW1pbGlhXSA9IHBheWxvYWQ7XHJcbiAgICBzZXRTdGF0dXMoXHJcbiAgICAgICdcdTI3MTMgT0suICcgKyBwYXJzZWQucm93cy5sZW5ndGggKyAnIFNLVXMgXHUwMEQ3ICcgKyBwYXJzZWQuZGV0ZWN0ZWRNb250aHMubGVuZ3RoICsgJyBtZXNlcy4nLFxyXG4gICAgICAnIzE2YTM0YSdcclxuICAgICk7XHJcbiAgICBfcmVuZGVyU2FsZXNQbGFuc1RhYigpO1xyXG4gIH0gY2F0Y2ggKGUpIHtcclxuICAgIGNvbnNvbGUuZXJyb3IoJ1tGT1JFQ0FTVF0gdXBsb2FkIHNhbGVzIHBsYW4gJyArIGZhbWlsaWEgKyAnIGZhaWw6JywgZSk7XHJcbiAgICBzZXRTdGF0dXMoJ1x1MjcxNyBFcnJvcjogJyArICgoZSAmJiBlLm1lc3NhZ2UpIHx8IGUpLCAnI2RjMjYyNicpO1xyXG4gICAgaWYgKGUgJiYgZS5jb2RlID09PSAnTU9OVEhTX05PVF9GT1VORCcpIHtcclxuICAgICAgYWxlcnQoXHJcbiAgICAgICAgJ0VsIEV4Y2VsIG5vIHRpZW5lIGNvbHVtbmFzIGRlIG1lc2VzIHJlY29ub2NpYmxlcy5cXG5cXG5IZWFkZXJzIGVzcGVyYWRvczogXCJKYW4gMjAyN1wiLCBcIk1heSAyMDI3XCIsIFwiRW5lIDIwMjdcIiwgXCIyMDI3LTAxXCIsIGV0Yy5cXG5cXG5EZXRhbGxlOiAnICtcclxuICAgICAgICAgIGUubWVzc2FnZVxyXG4gICAgICApO1xyXG4gICAgfVxyXG4gIH0gZmluYWxseSB7XHJcbiAgICBpZiAoZXZlbnQgJiYgZXZlbnQudGFyZ2V0KSBldmVudC50YXJnZXQudmFsdWUgPSAnJztcclxuICB9XHJcbn07XHJcblxyXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuLy8gRjJCIFx1MjAxNCBGb3JlY2FzdCBFc3RhZFx1MDBFRHN0aWNvOiB0YWJsYSArIGRldGFsbGVcclxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblxyXG5hc3luYyBmdW5jdGlvbiBfbG9hZEZvcmVjYXN0T3V0cHV0KCkge1xyXG4gIGlmICghd2luZG93LmZiRGIpIHRocm93IG5ldyBFcnJvcignRmlyZXN0b3JlIG5vIGluaWNpYWxpemFkbycpO1xyXG4gIGNvbnNvbGUubG9nKCdbRk9SRUNBU1Qgc3RhdF0gbG9hZGluZyBmb3JlY2FzdF9vdXRwdXQuLi4nKTtcclxuICBjb25zdCBbc25hcCwgbWV0YURvY10gPSBhd2FpdCBQcm9taXNlLmFsbChbXHJcbiAgICB3aW5kb3cuZmJEYi5jb2xsZWN0aW9uKCdmb3JlY2FzdF9vdXRwdXQnKS5nZXQoKSxcclxuICAgIHdpbmRvdy5mYkRiLmNvbGxlY3Rpb24oJ2ZvcmVjYXN0X291dHB1dF9tZXRhJykuZG9jKCdjdXJyZW50JykuZ2V0KCksXHJcbiAgXSk7XHJcbiAgY29uc3QgZG9jcyA9IFtdO1xyXG4gIHNuYXAuZm9yRWFjaCgoZCkgPT4gZG9jcy5wdXNoKE9iamVjdC5hc3NpZ24oeyBpZDogZC5pZCB9LCBkLmRhdGEoKSkpKTtcclxuICBkb2NzLnNvcnQoKGEsIGIpID0+IHtcclxuICAgIGNvbnN0IHdhID0gKGEubWV0cmljcyAmJiBhLm1ldHJpY3Mud2FwZSkgfHwgOTk5O1xyXG4gICAgY29uc3Qgd2IgPSAoYi5tZXRyaWNzICYmIGIubWV0cmljcy53YXBlKSB8fCA5OTk7XHJcbiAgICByZXR1cm4gd2EgLSB3YjtcclxuICB9KTtcclxuICBfZm9yZWNhc3RTdGF0RG9jcyA9IGRvY3M7XHJcbiAgX2ZvcmVjYXN0U3RhdE1ldGEgPSBtZXRhRG9jLmV4aXN0cyA/IG1ldGFEb2MuZGF0YSgpIDogbnVsbDtcclxuICBjb25zb2xlLmxvZygnW0ZPUkVDQVNUIHN0YXRdIGxvYWRlZCcsIGRvY3MubGVuZ3RoLCAnZG9jcyBcdTAwQjcgbWV0YTonLCAhIV9mb3JlY2FzdFN0YXRNZXRhKTtcclxuICByZXR1cm4gZG9jcztcclxufVxyXG5cclxuZnVuY3Rpb24gX3dhcGVCYWRnZUNvbG9yKHcpIHtcclxuICBpZiAodyA9PSBudWxsKSByZXR1cm4gJyM2NDc0OGInO1xyXG4gIGlmICh3IDwgMC4zKSByZXR1cm4gJyMxNmEzNGEnOyAvLyB2ZXJkZSAtIGV4Y2VsZW50ZVxyXG4gIGlmICh3IDwgMC41KSByZXR1cm4gJyM4NGNjMTYnOyAvLyBsaW1hIC0gYnVlbm9cclxuICBpZiAodyA8IDAuNykgcmV0dXJuICcjZWFiMzA4JzsgLy8gYW1hcmlsbG8gLSBhY2VwdGFibGVcclxuICBpZiAodyA8IDEuMCkgcmV0dXJuICcjZjk3MzE2JzsgLy8gbmFyYW5qYSAtIHBvYnJlXHJcbiAgcmV0dXJuICcjZGMyNjI2JzsgLy8gcm9qbyAtIG11eSBwb2JyZVxyXG59XHJcblxyXG5mdW5jdGlvbiBfZm10TnVtKG4pIHtcclxuICBpZiAobiA9PSBudWxsIHx8ICFOdW1iZXIuaXNGaW5pdGUoTnVtYmVyKG4pKSkgcmV0dXJuICdcdTIwMTQnO1xyXG4gIHJldHVybiBOdW1iZXIobikudG9Mb2NhbGVTdHJpbmcoJ2VzLUFSJywgeyBtYXhpbXVtRnJhY3Rpb25EaWdpdHM6IDAgfSk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIF9mbXRXYXBlKHcpIHtcclxuICBpZiAodyA9PSBudWxsIHx8ICFOdW1iZXIuaXNGaW5pdGUoTnVtYmVyKHcpKSkgcmV0dXJuICdcdTIwMTQnO1xyXG4gIHJldHVybiAoTnVtYmVyKHcpICogMTAwKS50b0ZpeGVkKDApICsgJyUnO1xyXG59XHJcblxyXG5mdW5jdGlvbiBfZm10RHNTaG9ydChpc28pIHtcclxuICAvLyAnMjAyNi0xMC0wMScgLT4gJ29jdCAyNidcclxuICB0cnkge1xyXG4gICAgY29uc3QgW3ksIG1dID0gaXNvLnNwbGl0KCctJykubWFwKE51bWJlcik7XHJcbiAgICBjb25zdCBuYW1lcyA9IFtcclxuICAgICAgJ2VuZScsXHJcbiAgICAgICdmZWInLFxyXG4gICAgICAnbWFyJyxcclxuICAgICAgJ2FicicsXHJcbiAgICAgICdtYXknLFxyXG4gICAgICAnanVuJyxcclxuICAgICAgJ2p1bCcsXHJcbiAgICAgICdhZ28nLFxyXG4gICAgICAnc2VwJyxcclxuICAgICAgJ29jdCcsXHJcbiAgICAgICdub3YnLFxyXG4gICAgICAnZGljJyxcclxuICAgIF07XHJcbiAgICByZXR1cm4gbmFtZXNbbSAtIDFdICsgJyAnICsgU3RyaW5nKHkpLnNsaWNlKC0yKTtcclxuICB9IGNhdGNoIHtcclxuICAgIHJldHVybiBpc287XHJcbiAgfVxyXG59XHJcblxyXG5mdW5jdGlvbiBfcmVuZGVyRm9yZWNhc3RTdGF0VGFiKCkge1xyXG4gIGNvbnN0IGNvbnQgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZm9yZWNhc3QtdGFiLXN0YXQnKTtcclxuICBpZiAoIWNvbnQpIHJldHVybjtcclxuICB0cnkge1xyXG4gICAgX3JlbmRlckZvcmVjYXN0U3RhdFRhYkltcGwoY29udCk7XHJcbiAgfSBjYXRjaCAoZSkge1xyXG4gICAgY29uc29sZS5lcnJvcignW0ZPUkVDQVNUIHN0YXRdIHJlbmRlciBmYWlsJywgZSk7XHJcbiAgICBjb250LmlubmVySFRNTCA9XHJcbiAgICAgICc8ZGl2IHN0eWxlPVwicGFkZGluZzo0MHB4IDIwcHg7Y29sb3I6I2RjMjYyNjtsaW5lLWhlaWdodDoxLjZcIj4nICtcclxuICAgICAgJzxkaXYgc3R5bGU9XCJmb250LXNpemU6MTZweDtmb250LXdlaWdodDo3MDA7bWFyZ2luLWJvdHRvbToxMHB4XCI+RXJyb3IgcmVuZGVyaXphbmRvIHRhYiBGb3JlY2FzdCBFc3RhZFx1MDBFRHN0aWNvPC9kaXY+JyArXHJcbiAgICAgICc8cHJlIHN0eWxlPVwiZm9udC1zaXplOjExcHg7YmFja2dyb3VuZDojZmVmMmYyO3BhZGRpbmc6MTJweDtib3JkZXItcmFkaXVzOjZweDtvdmVyZmxvdzphdXRvO3doaXRlLXNwYWNlOnByZS13cmFwXCI+JyArXHJcbiAgICAgIGVzY2FwZUh0bWxTYWZlKGUuc3RhY2sgfHwgZS5tZXNzYWdlIHx8IFN0cmluZyhlKSkgK1xyXG4gICAgICAnPC9wcmU+PC9kaXY+JztcclxuICB9XHJcbn1cclxuXHJcbmZ1bmN0aW9uIF9yZW5kZXJGb3JlY2FzdFN0YXRUYWJJbXBsKGNvbnQpIHtcclxuICBjb25zdCBkb2NzID0gX2ZvcmVjYXN0U3RhdERvY3MgfHwgW107XHJcbiAgY29uc3QgbWV0YSA9IF9mb3JlY2FzdFN0YXRNZXRhIHx8IHt9O1xyXG4gIGNvbnN0IHJlc3VtZW4gPSBtZXRhLnJlc3VtZW4gfHwge307XHJcbiAgY29uc29sZS5sb2coJ1tGT1JFQ0FTVCBzdGF0XSByZW5kZXIgXHUyMDE0IGRvY3M6JywgZG9jcy5sZW5ndGgsICdtZXRhOicsICEhbWV0YS5nZW5lcmF0ZWRBdCk7XHJcbiAgaWYgKCFkb2NzLmxlbmd0aCkge1xyXG4gICAgY29udC5pbm5lckhUTUwgPVxyXG4gICAgICAnPGRpdiBzdHlsZT1cInBhZGRpbmc6NjBweCAyMHB4O3RleHQtYWxpZ246Y2VudGVyO2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpXCI+JyArXHJcbiAgICAgICdObyBoYXkgZm9yZWNhc3Rfb3V0cHV0IHB1YmxpY2Fkby48YnI+PGJyPicgK1xyXG4gICAgICAnQ29ycmVyIDxjb2RlPnB5dGhvbiBzY3JpcHRzL2ZvcmVjYXN0L3RyYWluX3Byb2QucHkgJiYgcHl0aG9uIHNjcmlwdHMvZm9yZWNhc3QvcHVibGlzaF90b19maXJlc3RvcmUucHk8L2NvZGU+LicgK1xyXG4gICAgICAnPC9kaXY+JztcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgLy8gTWVzZXMgZGVsIGZvcmVjYXN0IChkcyBkZWwgcHJpbWVyIGRvYywgc2UgYXN1bWUgaWd1YWwgZW4gdG9kb3MpLlxyXG4gIGNvbnN0IG1vbnRoc0lzbyA9IChkb2NzWzBdLmZvcmVjYXN0IHx8IFtdKS5tYXAoKGYpID0+IGYuZHMpO1xyXG4gIGNvbnN0IG1vbnRoSGVhZGVycyA9IG1vbnRoc0lzby5tYXAoX2ZtdERzU2hvcnQpO1xyXG5cclxuICAvLyBNZXRyaWNzIGNoaXAgZ2xvYmFsXHJcbiAgY29uc3QgZ2VuZXJhdGVkID0gbWV0YS5nZW5lcmF0ZWRBdFxyXG4gICAgPyBuZXcgRGF0ZShtZXRhLmdlbmVyYXRlZEF0KS50b0xvY2FsZVN0cmluZygnZXMtQVInLCB7XHJcbiAgICAgICAgZGF5OiAnMi1kaWdpdCcsXHJcbiAgICAgICAgbW9udGg6ICdzaG9ydCcsXHJcbiAgICAgICAgeWVhcjogJzItZGlnaXQnLFxyXG4gICAgICAgIGhvdXI6ICcyLWRpZ2l0JyxcclxuICAgICAgICBtaW51dGU6ICcyLWRpZ2l0JyxcclxuICAgICAgfSlcclxuICAgIDogJ1x1MjAxNCc7XHJcbiAgY29uc3Qgd2FwZU1lZCA9XHJcbiAgICByZXN1bWVuLndhcGVfbWVkaWFub19iZXN0X3Blcl9zZXJpZXMgIT0gbnVsbFxyXG4gICAgICA/IF9mbXRXYXBlKHJlc3VtZW4ud2FwZV9tZWRpYW5vX2Jlc3RfcGVyX3NlcmllcylcclxuICAgICAgOiAnXHUyMDE0JztcclxuICBjb25zdCBuU3VicyA9IHJlc3VtZW4ubl9zdWJmYW1pbGlhcyB8fCBkb2NzLmxlbmd0aDtcclxuICBjb25zdCBuTHQwNSA9XHJcbiAgICByZXN1bWVuLm5fc2VyaWVzX3dhcGVfbHRfMF81ICE9IG51bGwgPyByZXN1bWVuLm5fc2VyaWVzX3dhcGVfbHRfMF81ICsgJy8nICsgblN1YnMgOiAnXHUyMDE0JztcclxuICBjb25zdCBuTHQwMyA9XHJcbiAgICByZXN1bWVuLm5fc2VyaWVzX3dhcGVfbHRfMF8zICE9IG51bGwgPyByZXN1bWVuLm5fc2VyaWVzX3dhcGVfbHRfMF8zICsgJy8nICsgblN1YnMgOiAnXHUyMDE0JztcclxuXHJcbiAgY29uc3QgYmFubmVyID1cclxuICAgICc8ZGl2IHN0eWxlPVwibWFyZ2luLWJvdHRvbToxNHB4O3BhZGRpbmc6MTJweCAxNHB4O2JhY2tncm91bmQ6dmFyKC0tYmctc2Vjb25kYXJ5KTtib3JkZXItbGVmdDozcHggc29saWQgIzBkOTQ4ODtib3JkZXItcmFkaXVzOjZweDtmb250LXNpemU6MTJweDtjb2xvcjp2YXIoLS10ZXh0LXNlY29uZGFyeSk7bGluZS1oZWlnaHQ6MS41O2Rpc3BsYXk6Z3JpZDtncmlkLXRlbXBsYXRlLWNvbHVtbnM6cmVwZWF0KGF1dG8tZml0LG1pbm1heCgxNjBweCwxZnIpKTtnYXA6MTBweFwiPicgK1xyXG4gICAgJzxkaXY+PGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMHB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtsZXR0ZXItc3BhY2luZzouNHB4XCI+V0FQRSBtZWRpYW5vPC9kaXY+PGRpdiBzdHlsZT1cImZvbnQtc2l6ZToyMHB4O2ZvbnQtd2VpZ2h0OjgwMDtjb2xvcjp2YXIoLS10ZXh0LXByaW1hcnkpXCI+JyArXHJcbiAgICB3YXBlTWVkICtcclxuICAgICc8L2Rpdj48L2Rpdj4nICtcclxuICAgICc8ZGl2PjxkaXYgc3R5bGU9XCJmb250LXNpemU6MTBweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7bGV0dGVyLXNwYWNpbmc6LjRweFwiPlN1YmZhbWlsaWFzPC9kaXY+PGRpdiBzdHlsZT1cImZvbnQtc2l6ZToyMHB4O2ZvbnQtd2VpZ2h0OjgwMDtjb2xvcjp2YXIoLS10ZXh0LXByaW1hcnkpXCI+JyArXHJcbiAgICBuU3VicyArXHJcbiAgICAnPC9kaXY+PC9kaXY+JyArXHJcbiAgICAnPGRpdj48ZGl2IHN0eWxlPVwiZm9udC1zaXplOjEwcHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO2xldHRlci1zcGFjaW5nOi40cHhcIj5XQVBFICZsdDsgMzAlIChleGNlbGVudGUpPC9kaXY+PGRpdiBzdHlsZT1cImZvbnQtc2l6ZToyMHB4O2ZvbnQtd2VpZ2h0OjgwMDtjb2xvcjojMTZhMzRhXCI+JyArXHJcbiAgICBuTHQwMyArXHJcbiAgICAnPC9kaXY+PC9kaXY+JyArXHJcbiAgICAnPGRpdj48ZGl2IHN0eWxlPVwiZm9udC1zaXplOjEwcHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO2xldHRlci1zcGFjaW5nOi40cHhcIj5XQVBFICZsdDsgNTAlIChidWVubyk8L2Rpdj48ZGl2IHN0eWxlPVwiZm9udC1zaXplOjIwcHg7Zm9udC13ZWlnaHQ6ODAwO2NvbG9yOiM4NGNjMTZcIj4nICtcclxuICAgIG5MdDA1ICtcclxuICAgICc8L2Rpdj48L2Rpdj4nICtcclxuICAgICc8ZGl2PjxkaXYgc3R5bGU9XCJmb250LXNpemU6MTBweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7bGV0dGVyLXNwYWNpbmc6LjRweFwiPlx1MDBEQWx0aW1hIGNvcnJpZGE8L2Rpdj48ZGl2IHN0eWxlPVwiZm9udC1zaXplOjEzcHg7Zm9udC13ZWlnaHQ6NjAwO2NvbG9yOnZhcigtLXRleHQtcHJpbWFyeSk7bWFyZ2luLXRvcDo0cHhcIj4nICtcclxuICAgIGVzY2FwZUh0bWxTYWZlKGdlbmVyYXRlZCkgK1xyXG4gICAgJzwvZGl2PjwvZGl2PicgK1xyXG4gICAgJzwvZGl2Pic7XHJcblxyXG4gIC8vIFRhYmxhIHJvd3NcclxuICBjb25zdCByb3dzSHRtbCA9IGRvY3NcclxuICAgIC5tYXAoKGQpID0+IHtcclxuICAgICAgY29uc3Qgd2FwZSA9IGQubWV0cmljcyAmJiBkLm1ldHJpY3Mud2FwZSAhPSBudWxsID8gZC5tZXRyaWNzLndhcGUgOiBudWxsO1xyXG4gICAgICBjb25zdCBiZXN0TW9kZWwgPSBkLmJlc3RNb2RlbCB8fCAnXHUyMDE0JztcclxuICAgICAgY29uc3QgZm9yZWNhc3RNYXAgPSB7fTtcclxuICAgICAgKGQuZm9yZWNhc3QgfHwgW10pLmZvckVhY2goKGYpID0+IHtcclxuICAgICAgICBmb3JlY2FzdE1hcFtmLmRzXSA9IGYueV9oYXQ7XHJcbiAgICAgIH0pO1xyXG4gICAgICBjb25zdCBtb250aENlbGxzID0gbW9udGhzSXNvXHJcbiAgICAgICAgLm1hcChcclxuICAgICAgICAgIChkcykgPT5cclxuICAgICAgICAgICAgJzx0ZCBzdHlsZT1cInBhZGRpbmc6OHB4IDEwcHg7dGV4dC1hbGlnbjpyaWdodDtmb250LXZhcmlhbnQtbnVtZXJpYzp0YWJ1bGFyLW51bXM7Zm9udC13ZWlnaHQ6NjAwO2NvbG9yOnZhcigtLXRleHQtcHJpbWFyeSlcIj4nICtcclxuICAgICAgICAgICAgX2ZtdE51bShmb3JlY2FzdE1hcFtkc10pICtcclxuICAgICAgICAgICAgJzwvdGQ+J1xyXG4gICAgICAgIClcclxuICAgICAgICAuam9pbignJyk7XHJcbiAgICAgIGNvbnN0IHRvdGFsNyA9IChkLmZvcmVjYXN0IHx8IFtdKS5yZWR1Y2UoKHMsIGYpID0+IHMgKyAoTnVtYmVyKGYueV9oYXQpIHx8IDApLCAwKTtcclxuICAgICAgcmV0dXJuIChcclxuICAgICAgICAnPHRyIG9uY2xpY2s9XCJvcGVuRm9yZWNhc3RTdGF0RGV0YWlsKFxcJycgK1xyXG4gICAgICAgIGVzY2FwZUh0bWxTYWZlKGQuaWQpICtcclxuICAgICAgICAnXFwnKVwiIHN0eWxlPVwiY3Vyc29yOnBvaW50ZXI7Ym9yZGVyLWJvdHRvbToxcHggc29saWQgdmFyKC0tYm9yZGVyLXN1YnRsZSlcIiBvbm1vdXNlb3Zlcj1cInRoaXMuc3R5bGUuYmFja2dyb3VuZD1cXCd2YXIoLS1iZy1zZWNvbmRhcnkpXFwnXCIgb25tb3VzZW91dD1cInRoaXMuc3R5bGUuYmFja2dyb3VuZD1cXCd0cmFuc3BhcmVudFxcJ1wiPicgK1xyXG4gICAgICAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjhweCAxMHB4O2ZvbnQtd2VpZ2h0OjcwMDtjb2xvcjp2YXIoLS10ZXh0LXByaW1hcnkpXCI+JyArXHJcbiAgICAgICAgZXNjYXBlSHRtbFNhZmUoZC5zdWJmYW1pbGlhIHx8IGQuaWQpICtcclxuICAgICAgICAnPC90ZD4nICtcclxuICAgICAgICAnPHRkIHN0eWxlPVwicGFkZGluZzo4cHggMTBweDtmb250LXNpemU6MTFweDtjb2xvcjp2YXIoLS10ZXh0LXNlY29uZGFyeSlcIj4nICtcclxuICAgICAgICBlc2NhcGVIdG1sU2FmZShiZXN0TW9kZWwpICtcclxuICAgICAgICAnPC90ZD4nICtcclxuICAgICAgICAnPHRkIHN0eWxlPVwicGFkZGluZzo4cHggMTBweDt0ZXh0LWFsaWduOmNlbnRlclwiPjxzcGFuIHN0eWxlPVwiZGlzcGxheTppbmxpbmUtYmxvY2s7cGFkZGluZzozcHggOHB4O2JvcmRlci1yYWRpdXM6MTJweDtiYWNrZ3JvdW5kOicgK1xyXG4gICAgICAgIF93YXBlQmFkZ2VDb2xvcih3YXBlKSArXHJcbiAgICAgICAgJztjb2xvcjojZmZmO2ZvbnQtc2l6ZToxMXB4O2ZvbnQtd2VpZ2h0OjcwMFwiPicgK1xyXG4gICAgICAgIF9mbXRXYXBlKHdhcGUpICtcclxuICAgICAgICAnPC9zcGFuPjwvdGQ+JyArXHJcbiAgICAgICAgbW9udGhDZWxscyArXHJcbiAgICAgICAgJzx0ZCBzdHlsZT1cInBhZGRpbmc6OHB4IDEwcHg7dGV4dC1hbGlnbjpyaWdodDtmb250LXZhcmlhbnQtbnVtZXJpYzp0YWJ1bGFyLW51bXM7Zm9udC13ZWlnaHQ6NzAwO2NvbG9yOiMwZDk0ODg7YmFja2dyb3VuZDp2YXIoLS1iZy1zZWNvbmRhcnkpXCI+JyArXHJcbiAgICAgICAgX2ZtdE51bSh0b3RhbDcpICtcclxuICAgICAgICAnPC90ZD4nICtcclxuICAgICAgICAnPC90cj4nXHJcbiAgICAgICk7XHJcbiAgICB9KVxyXG4gICAgLmpvaW4oJycpO1xyXG5cclxuICBjb25zdCBtb250aEhlYWRlcnNIdG1sID0gbW9udGhIZWFkZXJzXHJcbiAgICAubWFwKFxyXG4gICAgICAobSkgPT5cclxuICAgICAgICAnPHRoIHN0eWxlPVwicGFkZGluZzo4cHggMTBweDt0ZXh0LWFsaWduOnJpZ2h0O2ZvbnQtc2l6ZToxMHB4O3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtsZXR0ZXItc3BhY2luZzouNHB4O2NvbG9yOiM5NGEzYjhcIj4nICtcclxuICAgICAgICBlc2NhcGVIdG1sU2FmZShtKSArXHJcbiAgICAgICAgJzwvdGg+J1xyXG4gICAgKVxyXG4gICAgLmpvaW4oJycpO1xyXG5cclxuICBjb25zdCB0YWJsZSA9XHJcbiAgICAnPGRpdiBzdHlsZT1cIm92ZXJmbG93OmF1dG87Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1ib3JkZXItc3VidGxlKTtib3JkZXItcmFkaXVzOjhweFwiPicgK1xyXG4gICAgJzx0YWJsZSBzdHlsZT1cIndpZHRoOjEwMCU7Ym9yZGVyLWNvbGxhcHNlOmNvbGxhcHNlO2ZvbnQtc2l6ZToxMnB4XCI+JyArXHJcbiAgICAnPHRoZWFkIHN0eWxlPVwiYmFja2dyb3VuZDojMGYxNzJhO2NvbG9yOiNmZmZcIj48dHI+JyArXHJcbiAgICAnPHRoIHN0eWxlPVwicGFkZGluZzo4cHggMTBweDt0ZXh0LWFsaWduOmxlZnQ7Zm9udC1zaXplOjEwcHg7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO2xldHRlci1zcGFjaW5nOi40cHhcIj5TdWJmYW1pbGlhPC90aD4nICtcclxuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjhweCAxMHB4O3RleHQtYWxpZ246bGVmdDtmb250LXNpemU6MTBweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7bGV0dGVyLXNwYWNpbmc6LjRweFwiPk1vZGVsbzwvdGg+JyArXHJcbiAgICAnPHRoIHN0eWxlPVwicGFkZGluZzo4cHggMTBweDt0ZXh0LWFsaWduOmNlbnRlcjtmb250LXNpemU6MTBweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7bGV0dGVyLXNwYWNpbmc6LjRweFwiPldBUEU8L3RoPicgK1xyXG4gICAgbW9udGhIZWFkZXJzSHRtbCArXHJcbiAgICAnPHRoIHN0eWxlPVwicGFkZGluZzo4cHggMTBweDt0ZXh0LWFsaWduOnJpZ2h0O2ZvbnQtc2l6ZToxMHB4O3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtsZXR0ZXItc3BhY2luZzouNHB4O2JhY2tncm91bmQ6IzEzNGU0YVwiPlRvdGFsIDdtPC90aD4nICtcclxuICAgICc8L3RyPjwvdGhlYWQ+JyArXHJcbiAgICAnPHRib2R5PicgK1xyXG4gICAgcm93c0h0bWwgK1xyXG4gICAgJzwvdGJvZHk+PC90YWJsZT48L2Rpdj4nO1xyXG5cclxuICBjb25zdCBmb290ZXIgPVxyXG4gICAgJzxkaXYgc3R5bGU9XCJtYXJnaW4tdG9wOjEycHg7Zm9udC1zaXplOjExcHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7bGluZS1oZWlnaHQ6MS41XCI+JyArXHJcbiAgICAnPGI+Q1x1MDBGM21vIGxlZXI8L2I+OiBXQVBFIChXZWlnaHRlZCBBYnNvbHV0ZSBQZXJjZW50YWdlIEVycm9yKSBtaWRlIGVsIGVycm9yIGRlbCBtb2RlbG8gcmVsYXRpdm8gYWwgdG90YWwgcmVhbDogJmx0OzMwJSBleGNlbGVudGUsIDMwLTUwJSBidWVubywgNTAtNzAlIGFjZXB0YWJsZSwgJmd0OzcwJSBwb2JyZS4gQ2xpY2sgZW4gZmlsYSBwYXJhIGRldGFsbGUgKyBnclx1MDBFMWZpY28uICcgK1xyXG4gICAgJ1NlIGVsaWdlIGVsIG1vZGVsbyBjb24gbWVub3IgV0FQRSBwb3Igc2VyaWUgdHJhcyBiYWNrdGVzdCByb2xsaW5nLW9yaWdpbiAoaD0yLCB2ZW50YW5hcz0zKS4nICtcclxuICAgICc8L2Rpdj4nO1xyXG5cclxuICBjb250LmlubmVySFRNTCA9ICc8ZGl2IHN0eWxlPVwicGFkZGluZzoxOHB4XCI+JyArIGJhbm5lciArIHRhYmxlICsgZm9vdGVyICsgJzwvZGl2Pic7XHJcbn1cclxuXHJcbi8vIENhY2hlIGhpc3RvcmlhIGFncmVnYWRhIHBvciBzdWJmYW1pbGlhIChwYXJhIGdyXHUwMEUxZmljbyBkZXRhbGxlKS5cclxuYXN5bmMgZnVuY3Rpb24gX2xvYWRGb3JlY2FzdFN0YXRIaXN0b3J5KCkge1xyXG4gIGlmIChfZm9yZWNhc3RTdGF0SGlzdG9yeUNhY2hlKSByZXR1cm4gX2ZvcmVjYXN0U3RhdEhpc3RvcnlDYWNoZTtcclxuICAvLyBMYSBoaXN0b3JpYSBzb2xvIGVzdFx1MDBFMSBlbiBCUSAofjEwIGFcdTAwRjFvcyBCYXJhbGRvICsgMTIgbWVzZXMgU2hpbWFubykuIENvbW9cclxuICAvLyBlbCBwaXBlbGluZSBsYSBlc2NyaWJlIGEgQ1NWIGxvY2FsLCBhY1x1MDBFMSBubyBsYSBwb2RlbW9zIGxlZXIuIEFsdGVybmF0aXZhOlxyXG4gIC8vIHVzYXIgc2t1X3ZlbnRhc19zbmFwc2hvdCBxdWUgdGllbmUgdmVudGFzIG1lbnN1YWxlcyBwZXJvIHNvbG8gZ3J1cG8gUEVTQ0EuXHJcbiAgLy8gRW4gRjJCLjIgc29sbyBtb3N0cmFtb3MgZm9yZWNhc3QrSUMgKHNpbiBvdmVybGF5IGhpc3RvcmlhIHBvciBhaG9yYSkuXHJcbiAgX2ZvcmVjYXN0U3RhdEhpc3RvcnlDYWNoZSA9IHt9O1xyXG4gIHJldHVybiBfZm9yZWNhc3RTdGF0SGlzdG9yeUNhY2hlO1xyXG59XHJcblxyXG5mdW5jdGlvbiBfYnVpbGRGb3JlY2FzdENoYXJ0U3ZnKGRvYykge1xyXG4gIGNvbnN0IGZjID0gZG9jLmZvcmVjYXN0IHx8IFtdO1xyXG4gIGlmICghZmMubGVuZ3RoKVxyXG4gICAgcmV0dXJuICc8ZGl2IHN0eWxlPVwicGFkZGluZzozMHB4O3RleHQtYWxpZ246Y2VudGVyO2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpXCI+U2luIGRhdG9zIGRlIGZvcmVjYXN0PC9kaXY+JztcclxuICAvLyBEaW1lbnNpb25lc1xyXG4gIGNvbnN0IFcgPSA2NDAsXHJcbiAgICBIID0gMjYwO1xyXG4gIGNvbnN0IHBhZEwgPSA1MCxcclxuICAgIHBhZFIgPSAyMCxcclxuICAgIHBhZFQgPSAyMCxcclxuICAgIHBhZEIgPSA0MDtcclxuICBjb25zdCBpbm5lclcgPSBXIC0gcGFkTCAtIHBhZFI7XHJcbiAgY29uc3QgaW5uZXJIID0gSCAtIHBhZFQgLSBwYWRCO1xyXG5cclxuICAvLyBZIHJhbmdlOiBtYXgoaGk4MCkgKiAxLjFcclxuICBjb25zdCBtYXhZID0gTWF0aC5tYXgoMSwgLi4uZmMubWFwKChmKSA9PiBOdW1iZXIoZi5oaTgwKSB8fCBOdW1iZXIoZi55X2hhdCkgfHwgMCkpO1xyXG4gIGNvbnN0IG1pblkgPSAwO1xyXG4gIGNvbnN0IHNjYWxlWCA9IChpKSA9PiBwYWRMICsgKGlubmVyVyAqIGkpIC8gTWF0aC5tYXgoMSwgZmMubGVuZ3RoIC0gMSk7XHJcbiAgY29uc3Qgc2NhbGVZID0gKHYpID0+IHBhZFQgKyBpbm5lckggLSAoaW5uZXJIICogKHYgLSBtaW5ZKSkgLyAobWF4WSAtIG1pblkpO1xyXG5cclxuICAvLyBHcmlkICsgZWplIFlcclxuICBjb25zdCB5VGlja3MgPSBbMCwgMC4yNSwgMC41LCAwLjc1LCAxXVxyXG4gICAgLm1hcCgocikgPT4ge1xyXG4gICAgICBjb25zdCB2YWwgPSBtaW5ZICsgciAqIChtYXhZIC0gbWluWSk7XHJcbiAgICAgIGNvbnN0IHl5ID0gc2NhbGVZKHZhbCk7XHJcbiAgICAgIHJldHVybiAoXHJcbiAgICAgICAgJzxsaW5lIHgxPVwiJyArXHJcbiAgICAgICAgcGFkTCArXHJcbiAgICAgICAgJ1wiIHkxPVwiJyArXHJcbiAgICAgICAgeXkgK1xyXG4gICAgICAgICdcIiB4Mj1cIicgK1xyXG4gICAgICAgIChXIC0gcGFkUikgK1xyXG4gICAgICAgICdcIiB5Mj1cIicgK1xyXG4gICAgICAgIHl5ICtcclxuICAgICAgICAnXCIgc3Ryb2tlPVwiI2UyZThmMFwiIHN0cm9rZS13aWR0aD1cIjFcIi8+JyArXHJcbiAgICAgICAgJzx0ZXh0IHg9XCInICtcclxuICAgICAgICAocGFkTCAtIDYpICtcclxuICAgICAgICAnXCIgeT1cIicgK1xyXG4gICAgICAgICh5eSArIDQpICtcclxuICAgICAgICAnXCIgdGV4dC1hbmNob3I9XCJlbmRcIiBmb250LXNpemU9XCIxMFwiIGZpbGw9XCIjNjQ3NDhiXCI+JyArXHJcbiAgICAgICAgX2ZtdE51bSh2YWwpICtcclxuICAgICAgICAnPC90ZXh0PidcclxuICAgICAgKTtcclxuICAgIH0pXHJcbiAgICAuam9pbignJyk7XHJcblxyXG4gIC8vIEVqZSBYIChtZXNlcylcclxuICBjb25zdCB4TGFiZWxzID0gZmNcclxuICAgIC5tYXAoKGYsIGkpID0+IHtcclxuICAgICAgY29uc3QgeHggPSBzY2FsZVgoaSk7XHJcbiAgICAgIHJldHVybiAoXHJcbiAgICAgICAgJzx0ZXh0IHg9XCInICtcclxuICAgICAgICB4eCArXHJcbiAgICAgICAgJ1wiIHk9XCInICtcclxuICAgICAgICAoSCAtIHBhZEIgKyAxNSkgK1xyXG4gICAgICAgICdcIiB0ZXh0LWFuY2hvcj1cIm1pZGRsZVwiIGZvbnQtc2l6ZT1cIjEwXCIgZmlsbD1cIiM2NDc0OGJcIj4nICtcclxuICAgICAgICBfZm10RHNTaG9ydChmLmRzKSArXHJcbiAgICAgICAgJzwvdGV4dD4nXHJcbiAgICAgICk7XHJcbiAgICB9KVxyXG4gICAgLmpvaW4oJycpO1xyXG5cclxuICAvLyBJbnRlcnZhbG8gY29uZmlhbnphIChiYW5kKVxyXG4gIGNvbnN0IGJhbmRQb2ludHMgPVxyXG4gICAgZmMubWFwKChmLCBpKSA9PiBzY2FsZVgoaSkgKyAnLCcgKyBzY2FsZVkoTnVtYmVyKGYuaGk4MCkgfHwgMCkpLmpvaW4oJyAnKSArXHJcbiAgICAnICcgK1xyXG4gICAgZmNcclxuICAgICAgLnNsaWNlKClcclxuICAgICAgLnJldmVyc2UoKVxyXG4gICAgICAubWFwKChmLCBpKSA9PiBzY2FsZVgoZmMubGVuZ3RoIC0gMSAtIGkpICsgJywnICsgc2NhbGVZKE51bWJlcihmLmxvODApIHx8IDApKVxyXG4gICAgICAuam9pbignICcpO1xyXG4gIGNvbnN0IGJhbmQgPSAnPHBvbHlnb24gcG9pbnRzPVwiJyArIGJhbmRQb2ludHMgKyAnXCIgZmlsbD1cIiMwZDk0ODgzM1wiIHN0cm9rZT1cIm5vbmVcIi8+JztcclxuXHJcbiAgLy8gTGluZSBmb3JlY2FzdCArIHB1bnRvc1xyXG4gIGNvbnN0IGxpbmVQb2ludHMgPSBmYy5tYXAoKGYsIGkpID0+IHNjYWxlWChpKSArICcsJyArIHNjYWxlWShOdW1iZXIoZi55X2hhdCkgfHwgMCkpLmpvaW4oJyAnKTtcclxuICBjb25zdCBsaW5lID1cclxuICAgICc8cG9seWxpbmUgcG9pbnRzPVwiJyArXHJcbiAgICBsaW5lUG9pbnRzICtcclxuICAgICdcIiBmaWxsPVwibm9uZVwiIHN0cm9rZT1cIiMwZDk0ODhcIiBzdHJva2Utd2lkdGg9XCIyLjVcIiBzdHJva2UtbGluZWpvaW49XCJyb3VuZFwiLz4nO1xyXG4gIGNvbnN0IHBvaW50cyA9IGZjXHJcbiAgICAubWFwKFxyXG4gICAgICAoZiwgaSkgPT5cclxuICAgICAgICAnPGNpcmNsZSBjeD1cIicgK1xyXG4gICAgICAgIHNjYWxlWChpKSArXHJcbiAgICAgICAgJ1wiIGN5PVwiJyArXHJcbiAgICAgICAgc2NhbGVZKE51bWJlcihmLnlfaGF0KSB8fCAwKSArXHJcbiAgICAgICAgJ1wiIHI9XCI0XCIgZmlsbD1cIiMwZDk0ODhcIiBzdHJva2U9XCIjZmZmXCIgc3Ryb2tlLXdpZHRoPVwiMlwiLz4nXHJcbiAgICApXHJcbiAgICAuam9pbignJyk7XHJcbiAgLy8gTGFiZWxzIGRlIHZhbG9yXHJcbiAgY29uc3QgdmFsdWVMYWJlbHMgPSBmY1xyXG4gICAgLm1hcCgoZiwgaSkgPT4ge1xyXG4gICAgICBjb25zdCB4eCA9IHNjYWxlWChpKTtcclxuICAgICAgY29uc3QgeXkgPSBzY2FsZVkoTnVtYmVyKGYueV9oYXQpIHx8IDApO1xyXG4gICAgICByZXR1cm4gKFxyXG4gICAgICAgICc8dGV4dCB4PVwiJyArXHJcbiAgICAgICAgeHggK1xyXG4gICAgICAgICdcIiB5PVwiJyArXHJcbiAgICAgICAgKHl5IC0gOCkgK1xyXG4gICAgICAgICdcIiB0ZXh0LWFuY2hvcj1cIm1pZGRsZVwiIGZvbnQtc2l6ZT1cIjEwXCIgZm9udC13ZWlnaHQ9XCI3MDBcIiBmaWxsPVwiIzBmNzY2ZVwiPicgK1xyXG4gICAgICAgIF9mbXROdW0oZi55X2hhdCkgK1xyXG4gICAgICAgICc8L3RleHQ+J1xyXG4gICAgICApO1xyXG4gICAgfSlcclxuICAgIC5qb2luKCcnKTtcclxuXHJcbiAgY29uc3Qgc3ZnID1cclxuICAgICc8c3ZnIHZpZXdCb3g9XCIwIDAgJyArXHJcbiAgICBXICtcclxuICAgICcgJyArXHJcbiAgICBIICtcclxuICAgICdcIiBzdHlsZT1cIndpZHRoOjEwMCU7bWF4LXdpZHRoOjgwMHB4O2hlaWdodDphdXRvXCI+JyArXHJcbiAgICAnPHJlY3QgeD1cIjBcIiB5PVwiMFwiIHdpZHRoPVwiJyArXHJcbiAgICBXICtcclxuICAgICdcIiBoZWlnaHQ9XCInICtcclxuICAgIEggK1xyXG4gICAgJ1wiIGZpbGw9XCIjZmZmXCIvPicgK1xyXG4gICAgeVRpY2tzICtcclxuICAgIHhMYWJlbHMgK1xyXG4gICAgYmFuZCArXHJcbiAgICBsaW5lICtcclxuICAgIHBvaW50cyArXHJcbiAgICB2YWx1ZUxhYmVscyArXHJcbiAgICAnPC9zdmc+JztcclxuICByZXR1cm4gc3ZnO1xyXG59XHJcblxyXG53aW5kb3cub3BlbkZvcmVjYXN0U3RhdERldGFpbCA9IGZ1bmN0aW9uIChzdWJJZCkge1xyXG4gIGlmICghX2ZvcmVjYXN0U3RhdERvY3MpIHJldHVybjtcclxuICBjb25zdCBkb2MgPSBfZm9yZWNhc3RTdGF0RG9jcy5maW5kKChkKSA9PiBkLmlkID09PSBzdWJJZCk7XHJcbiAgaWYgKCFkb2MpIHtcclxuICAgIGFsZXJ0KCdObyBzZSBlbmNvbnRyXHUwMEYzIGRldGFsbGUgZGUgJyArIHN1YklkKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgY29uc3QgZXhpc3RpbmcgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZm9yZWNhc3Qtc3RhdC1kZXRhaWwnKTtcclxuICBpZiAoZXhpc3RpbmcpIGV4aXN0aW5nLnJlbW92ZSgpO1xyXG5cclxuICBjb25zdCBlbCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpO1xyXG4gIGVsLmlkID0gJ2ZvcmVjYXN0LXN0YXQtZGV0YWlsJztcclxuICBlbC5zdHlsZS5jc3NUZXh0ID1cclxuICAgICdwb3NpdGlvbjpmaXhlZDtpbnNldDowO2JhY2tncm91bmQ6cmdiYSgxNSwyMyw0MiwuNjUpO3otaW5kZXg6MjEwMDtkaXNwbGF5OmZsZXg7YWxpZ24taXRlbXM6Y2VudGVyO2p1c3RpZnktY29udGVudDpjZW50ZXI7cGFkZGluZzoydmgnO1xyXG4gIGVsLm9uY2xpY2sgPSAoZXYpID0+IHtcclxuICAgIGlmIChldi50YXJnZXQgPT09IGVsKSBlbC5yZW1vdmUoKTtcclxuICB9O1xyXG5cclxuICBjb25zdCB3YXBlID0gZG9jLm1ldHJpY3MgJiYgZG9jLm1ldHJpY3Mud2FwZTtcclxuICBjb25zdCBiaWFzID0gZG9jLm1ldHJpY3MgJiYgZG9jLm1ldHJpY3MuYmlhcztcclxuICBjb25zdCBtYWUgPSBkb2MubWV0cmljcyAmJiBkb2MubWV0cmljcy5tYWU7XHJcbiAgY29uc3Qgcm1zZSA9IGRvYy5tZXRyaWNzICYmIGRvYy5tZXRyaWNzLnJtc2U7XHJcbiAgY29uc3QgYmVzdE1vZGVsID0gZG9jLmJlc3RNb2RlbCB8fCAnXHUyMDE0JztcclxuICBjb25zdCB2ZXJzaW9uSWQgPSBkb2MudmVyc2lvbklkIHx8ICdcdTIwMTQnO1xyXG4gIGNvbnN0IHN2Z0h0bWwgPSBfYnVpbGRGb3JlY2FzdENoYXJ0U3ZnKGRvYyk7XHJcblxyXG4gIGNvbnN0IG1ldHJpY3NIdG1sID1cclxuICAgICc8ZGl2IHN0eWxlPVwiZGlzcGxheTpncmlkO2dyaWQtdGVtcGxhdGUtY29sdW1uczpyZXBlYXQoYXV0by1maXQsbWlubWF4KDEyMHB4LDFmcikpO2dhcDoxMHB4O21hcmdpbjoxNHB4IDBcIj4nICtcclxuICAgICc8ZGl2IHN0eWxlPVwicGFkZGluZzoxMHB4O2JhY2tncm91bmQ6dmFyKC0tYmctc2Vjb25kYXJ5KTtib3JkZXItcmFkaXVzOjZweFwiPjxkaXYgc3R5bGU9XCJmb250LXNpemU6MTBweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2VcIj5Nb2RlbG88L2Rpdj48ZGl2IHN0eWxlPVwiZm9udC13ZWlnaHQ6NzAwXCI+JyArXHJcbiAgICBlc2NhcGVIdG1sU2FmZShiZXN0TW9kZWwpICtcclxuICAgICc8L2Rpdj48L2Rpdj4nICtcclxuICAgICc8ZGl2IHN0eWxlPVwicGFkZGluZzoxMHB4O2JhY2tncm91bmQ6dmFyKC0tYmctc2Vjb25kYXJ5KTtib3JkZXItcmFkaXVzOjZweFwiPjxkaXYgc3R5bGU9XCJmb250LXNpemU6MTBweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2VcIj5XQVBFPC9kaXY+PGRpdiBzdHlsZT1cImZvbnQtd2VpZ2h0OjcwMDtjb2xvcjonICtcclxuICAgIF93YXBlQmFkZ2VDb2xvcih3YXBlKSArXHJcbiAgICAnXCI+JyArXHJcbiAgICBfZm10V2FwZSh3YXBlKSArXHJcbiAgICAnPC9kaXY+PC9kaXY+JyArXHJcbiAgICAnPGRpdiBzdHlsZT1cInBhZGRpbmc6MTBweDtiYWNrZ3JvdW5kOnZhcigtLWJnLXNlY29uZGFyeSk7Ym9yZGVyLXJhZGl1czo2cHhcIj48ZGl2IHN0eWxlPVwiZm9udC1zaXplOjEwcHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlXCI+QmlhczwvZGl2PjxkaXYgc3R5bGU9XCJmb250LXdlaWdodDo3MDBcIj4nICtcclxuICAgIChiaWFzICE9IG51bGwgPyAoYmlhcyAqIDEwMCkudG9GaXhlZCgwKSArICclJyA6ICdcdTIwMTQnKSArXHJcbiAgICAnPC9kaXY+PC9kaXY+JyArXHJcbiAgICAnPGRpdiBzdHlsZT1cInBhZGRpbmc6MTBweDtiYWNrZ3JvdW5kOnZhcigtLWJnLXNlY29uZGFyeSk7Ym9yZGVyLXJhZGl1czo2cHhcIj48ZGl2IHN0eWxlPVwiZm9udC1zaXplOjEwcHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlXCI+TUFFPC9kaXY+PGRpdiBzdHlsZT1cImZvbnQtd2VpZ2h0OjcwMFwiPicgK1xyXG4gICAgX2ZtdE51bShtYWUpICtcclxuICAgICc8L2Rpdj48L2Rpdj4nICtcclxuICAgICc8ZGl2IHN0eWxlPVwicGFkZGluZzoxMHB4O2JhY2tncm91bmQ6dmFyKC0tYmctc2Vjb25kYXJ5KTtib3JkZXItcmFkaXVzOjZweFwiPjxkaXYgc3R5bGU9XCJmb250LXNpemU6MTBweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2VcIj5STVNFPC9kaXY+PGRpdiBzdHlsZT1cImZvbnQtd2VpZ2h0OjcwMFwiPicgK1xyXG4gICAgX2ZtdE51bShybXNlKSArXHJcbiAgICAnPC9kaXY+PC9kaXY+JyArXHJcbiAgICAnPC9kaXY+JztcclxuXHJcbiAgY29uc3QgdGFibGVIdG1sID1cclxuICAgICc8dGFibGUgc3R5bGU9XCJ3aWR0aDoxMDAlO2ZvbnQtc2l6ZToxMnB4O2JvcmRlci1jb2xsYXBzZTpjb2xsYXBzZTttYXJnaW4tdG9wOjEwcHhcIj4nICtcclxuICAgICc8dGhlYWQgc3R5bGU9XCJiYWNrZ3JvdW5kOiMwZjE3MmE7Y29sb3I6I2ZmZlwiPjx0cj4nICtcclxuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjZweCAxMHB4O3RleHQtYWxpZ246bGVmdFwiPk1lczwvdGg+JyArXHJcbiAgICAnPHRoIHN0eWxlPVwicGFkZGluZzo2cHggMTBweDt0ZXh0LWFsaWduOnJpZ2h0XCI+Rm9yZWNhc3Q8L3RoPicgK1xyXG4gICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6NnB4IDEwcHg7dGV4dC1hbGlnbjpyaWdodFwiPklDIDgwJSBiYWpvPC90aD4nICtcclxuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjZweCAxMHB4O3RleHQtYWxpZ246cmlnaHRcIj5JQyA4MCUgYWx0bzwvdGg+JyArXHJcbiAgICAnPC90cj48L3RoZWFkPjx0Ym9keT4nICtcclxuICAgIChkb2MuZm9yZWNhc3QgfHwgW10pXHJcbiAgICAgIC5tYXAoXHJcbiAgICAgICAgKGYpID0+XHJcbiAgICAgICAgICAnPHRyIHN0eWxlPVwiYm9yZGVyLWJvdHRvbToxcHggc29saWQgdmFyKC0tYm9yZGVyLXN1YnRsZSlcIj48dGQgc3R5bGU9XCJwYWRkaW5nOjZweCAxMHB4XCI+JyArXHJcbiAgICAgICAgICBlc2NhcGVIdG1sU2FmZShfZm10RHNTaG9ydChmLmRzKSkgK1xyXG4gICAgICAgICAgJzwvdGQ+JyArXHJcbiAgICAgICAgICAnPHRkIHN0eWxlPVwicGFkZGluZzo2cHggMTBweDt0ZXh0LWFsaWduOnJpZ2h0O2ZvbnQtd2VpZ2h0OjcwMFwiPicgK1xyXG4gICAgICAgICAgX2ZtdE51bShmLnlfaGF0KSArXHJcbiAgICAgICAgICAnPC90ZD4nICtcclxuICAgICAgICAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjZweCAxMHB4O3RleHQtYWxpZ246cmlnaHQ7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZClcIj4nICtcclxuICAgICAgICAgIF9mbXROdW0oZi5sbzgwKSArXHJcbiAgICAgICAgICAnPC90ZD4nICtcclxuICAgICAgICAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjZweCAxMHB4O3RleHQtYWxpZ246cmlnaHQ7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZClcIj4nICtcclxuICAgICAgICAgIF9mbXROdW0oZi5oaTgwKSArXHJcbiAgICAgICAgICAnPC90ZD48L3RyPidcclxuICAgICAgKVxyXG4gICAgICAuam9pbignJykgK1xyXG4gICAgJzwvdGJvZHk+PC90YWJsZT4nO1xyXG5cclxuICBjb25zdCBjb250ZW50ID1cclxuICAgICc8ZGl2IHN0eWxlPVwiYmFja2dyb3VuZDp2YXIoLS1iZy1lbGV2YXRlZCk7Ym9yZGVyLXJhZGl1czoxMnB4O3BhZGRpbmc6MjRweDttYXgtd2lkdGg6ODIwcHg7d2lkdGg6MTAwJTttYXgtaGVpZ2h0Ojk2dmg7b3ZlcmZsb3c6YXV0bztib3gtc2hhZG93OjAgMjBweCA2MHB4IHJnYmEoMCwwLDAsLjQpXCI+JyArXHJcbiAgICAnPGRpdiBzdHlsZT1cImRpc3BsYXk6ZmxleDtqdXN0aWZ5LWNvbnRlbnQ6c3BhY2UtYmV0d2VlbjthbGlnbi1pdGVtczpjZW50ZXI7bWFyZ2luLWJvdHRvbToxMHB4XCI+JyArXHJcbiAgICAnPGRpdj48ZGl2IHN0eWxlPVwiZm9udC1zaXplOjExcHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO2xldHRlci1zcGFjaW5nOi40cHhcIj5TdWJmYW1pbGlhPC9kaXY+PGRpdiBzdHlsZT1cImZvbnQtc2l6ZToyMnB4O2ZvbnQtd2VpZ2h0OjgwMFwiPicgK1xyXG4gICAgZXNjYXBlSHRtbFNhZmUoZG9jLnN1YmZhbWlsaWEgfHwgZG9jLmlkKSArXHJcbiAgICAnPC9kaXY+PC9kaXY+JyArXHJcbiAgICAnPGJ1dHRvbiBvbmNsaWNrPVwiZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoXFwnZm9yZWNhc3Qtc3RhdC1kZXRhaWxcXCcpLnJlbW92ZSgpXCIgc3R5bGU9XCJiYWNrZ3JvdW5kOnRyYW5zcGFyZW50O2JvcmRlcjoxcHggc29saWQgdmFyKC0tYm9yZGVyLXN1YnRsZSk7Ym9yZGVyLXJhZGl1czo2cHg7cGFkZGluZzo2cHggMTJweDtjdXJzb3I6cG9pbnRlcjtmb250LXdlaWdodDo3MDBcIj5DZXJyYXI8L2J1dHRvbj4nICtcclxuICAgICc8L2Rpdj4nICtcclxuICAgIG1ldHJpY3NIdG1sICtcclxuICAgICc8ZGl2IHN0eWxlPVwiYmFja2dyb3VuZDojZmZmO3BhZGRpbmc6OHB4O2JvcmRlci1yYWRpdXM6OHB4O21hcmdpbi10b3A6MTBweDtib3JkZXI6MXB4IHNvbGlkIHZhcigtLWJvcmRlci1zdWJ0bGUpXCI+JyArXHJcbiAgICBzdmdIdG1sICtcclxuICAgICc8L2Rpdj4nICtcclxuICAgIHRhYmxlSHRtbCArXHJcbiAgICAnPGRpdiBzdHlsZT1cIm1hcmdpbi10b3A6MTRweDtmb250LXNpemU6MTFweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKVwiPlZlcnNpb246IDxjb2RlPicgK1xyXG4gICAgZXNjYXBlSHRtbFNhZmUodmVyc2lvbklkKSArXHJcbiAgICAnPC9jb2RlPiBcdTAwQjcgQXBwcm9hY2g6ICcgK1xyXG4gICAgZXNjYXBlSHRtbFNhZmUoKGRvYy5jb25maWcgfHwge30pLmFwcHJvYWNoIHx8ICdcdTIwMTQnKSArXHJcbiAgICAnPC9kaXY+JyArXHJcbiAgICAnPC9kaXY+JztcclxuICBlbC5pbm5lckhUTUwgPSBjb250ZW50O1xyXG4gIGRvY3VtZW50LmJvZHkuYXBwZW5kQ2hpbGQoZWwpO1xyXG59O1xyXG5cclxud2luZG93Lm9wZW5Gb3JlY2FzdE1vZGFsID0gYXN5bmMgZnVuY3Rpb24gKCkge1xyXG4gIGlmICghX2NhbkZvcmVjYXN0KCkpIHtcclxuICAgIGFsZXJ0KCdGT1JFQ0FTVCBlcyBzb2xvIHBhcmEgTWFyaWFubyAoYWRtaW4pLicpO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuICBjb25zdCBlbCA9IF9yZW5kZXJNb2RhbFNoZWxsKCk7XHJcbiAgZWwuc3R5bGUuZGlzcGxheSA9ICdibG9jayc7XHJcbiAgLy8gdjEwOTgrIEZhc2UgMTogY2FyZ2FyIFNhbGVzIFBsYW5zIGNhY2hlcyArIHJlbmRlcml6YXIgdGFiIGRlZmF1bHQuXHJcbiAgX3JlbmRlclNhbGVzUGxhbnNUYWIoKTtcclxuICBfbG9hZFNhbGVzUGxhbkNhY2hlcygpXHJcbiAgICAudGhlbihfcmVuZGVyU2FsZXNQbGFuc1RhYilcclxuICAgIC5jYXRjaCgoKSA9PiB7fSk7XHJcbiAgLy8gTGVnYWN5OiBzbmFwc2hvdCBzb2xvIHNlIGNhcmdhIGxhenkgc2kgZWwgdXNlciBjYW1iaWEgYSB0YWIgTGVnYWN5LlxyXG4gIGlmIChfZm9yZWNhc3RMb2FkaW5nKSByZXR1cm47XHJcbiAgaWYgKCFfZm9yZWNhc3RTbmFwc2hvdCkge1xyXG4gICAgX2ZvcmVjYXN0TG9hZGluZyA9IHRydWU7XHJcbiAgICBjb25zdCBzdGF0cyA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdmb3JlY2FzdC1zdGF0cycpO1xyXG4gICAgaWYgKHN0YXRzKSBzdGF0cy50ZXh0Q29udGVudCA9ICdDYXJnYW5kbyBzbmFwc2hvdCBkZSB2ZW50YXMuLi4nO1xyXG4gICAgdHJ5IHtcclxuICAgICAgYXdhaXQgX2xvYWRTbmFwc2hvdCgpO1xyXG4gICAgICBpZiAoc3RhdHMpIHN0YXRzLnRleHRDb250ZW50ID0gX2ZvcmVjYXN0U25hcHNob3QuY291bnQgKyAnIFNLVXMgZW4gc25hcHNob3QgaGlzdG9yaWNvJztcclxuICAgIH0gY2F0Y2ggKGUpIHtcclxuICAgICAgaWYgKHN0YXRzKSBzdGF0cy50ZXh0Q29udGVudCA9ICdFcnJvciBjYXJnYW5kbyBzbmFwc2hvdDogJyArICgoZSAmJiBlLm1lc3NhZ2UpIHx8IGUpO1xyXG4gICAgICAvLyBObyBhbGVydCBcdTIwMTQgbGVnYWN5IGVzIG9wdC1pbiwgbm8gYmxvcXVlYSBhbCB1c3VhcmlvIHNpIHNvbG8gdmEgYSBzdWJpciBTYWxlcyBQbGFucy5cclxuICAgICAgY29uc29sZS53YXJuKCdbRk9SRUNBU1RdIHNuYXBzaG90IGxvYWQgZmFpbCAobGVnYWN5IHRhYiknLCBlKTtcclxuICAgIH0gZmluYWxseSB7XHJcbiAgICAgIF9mb3JlY2FzdExvYWRpbmcgPSBmYWxzZTtcclxuICAgIH1cclxuICB9IGVsc2Uge1xyXG4gICAgY29uc3Qgc3RhdHMgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZm9yZWNhc3Qtc3RhdHMnKTtcclxuICAgIGlmIChzdGF0cykgc3RhdHMudGV4dENvbnRlbnQgPSBfZm9yZWNhc3RTbmFwc2hvdC5jb3VudCArICcgU0tVcyBlbiBzbmFwc2hvdCBoaXN0b3JpY28nO1xyXG4gIH1cclxufTtcclxuXHJcbndpbmRvdy5jbG9zZUZvcmVjYXN0TW9kYWwgPSBmdW5jdGlvbiAoKSB7XHJcbiAgY29uc3QgZWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZm9yZWNhc3QtbW9kYWwnKTtcclxuICBpZiAoZWwpIGVsLnN0eWxlLmRpc3BsYXkgPSAnbm9uZSc7XHJcbn07XHJcblxyXG53aW5kb3cub25Gb3JlY2FzdFNhbGVzUGxhbkZpbGUgPSBhc3luYyBmdW5jdGlvbiAoZXZlbnQpIHtcclxuICBjb25zdCBmaWxlID0gZXZlbnQgJiYgZXZlbnQudGFyZ2V0ICYmIGV2ZW50LnRhcmdldC5maWxlcyAmJiBldmVudC50YXJnZXQuZmlsZXNbMF07XHJcbiAgaWYgKCFmaWxlKSByZXR1cm47XHJcbiAgdHJ5IHtcclxuICAgIGlmICghX2ZvcmVjYXN0U25hcHNob3QpIGF3YWl0IF9sb2FkU25hcHNob3QoKTtcclxuICAgIGNvbnN0IGJ1ZiA9IGF3YWl0IGZpbGUuYXJyYXlCdWZmZXIoKTtcclxuICAgIGlmICh0eXBlb2YgWExTWCA9PT0gJ3VuZGVmaW5lZCcpIHtcclxuICAgICAgYWxlcnQoJ1hMU1ggbm8gY2FyZ2FkbycpO1xyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcbiAgICBjb25zdCB3YiA9IFhMU1gucmVhZChidWYsIHsgdHlwZTogJ2FycmF5JyB9KTtcclxuICAgIGNvbnN0IHNoZWV0ID0gd2IuU2hlZXRzW3diLlNoZWV0TmFtZXNbMF1dO1xyXG4gICAgY29uc3Qgcm93cyA9IFhMU1gudXRpbHMuc2hlZXRfdG9fanNvbihzaGVldCwgeyBoZWFkZXI6IDEsIGRlZnZhbDogbnVsbCwgcmF3OiB0cnVlIH0pO1xyXG4gICAgY29uc3QgcGFyc2VkID0gX3BhcnNlU2FsZXNQbGFuUm93cyhyb3dzKTtcclxuICAgIGlmICghcGFyc2VkLmxlbmd0aCkge1xyXG4gICAgICBhbGVydCgnRWwgRXhjZWwgZXN0YSB2YWNpbyBvIG5vIHRpZW5lIGZpbGFzIHZhbGlkYXMuJyk7XHJcbiAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIF9mb3JlY2FzdFNhbGVzUGxhbiA9IHBhcnNlZDtcclxuICAgIGNvbnN0IGhveSA9IG5ldyBEYXRlKCk7XHJcbiAgICBfZm9yZWNhc3RSb3dzID0gX2NvbXB1dGVGb3JlY2FzdFJvd3MoX2ZvcmVjYXN0U25hcHNob3QsIHBhcnNlZCwgaG95KTtcclxuICAgIF9yZW5kZXJUYWJsZShfZm9yZWNhc3RSb3dzKTtcclxuICAgIGNvbnN0IHNpbk1hdGNoID0gX2ZvcmVjYXN0Um93cy5maWx0ZXIoKHIpID0+ICFyLmhhc0hpc3RvcmlhKS5sZW5ndGg7XHJcbiAgICBjb25zdCBzdGF0cyA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdmb3JlY2FzdC1zdGF0cycpO1xyXG4gICAgaWYgKHN0YXRzKSB7XHJcbiAgICAgIHN0YXRzLnRleHRDb250ZW50ID1cclxuICAgICAgICBwYXJzZWQubGVuZ3RoICtcclxuICAgICAgICAnIFNLVXMgZW4gU2FsZXMgUGxhbiBcdTAwQjcgJyArXHJcbiAgICAgICAgKHBhcnNlZC5sZW5ndGggLSBzaW5NYXRjaCkgK1xyXG4gICAgICAgICcgY29uIGhpc3RvcmlhIFx1MDBCNyAnICtcclxuICAgICAgICBzaW5NYXRjaCArXHJcbiAgICAgICAgJyBzaW4gbWF0Y2ggKGZvbmRvIGFtYXJpbGxvKSc7XHJcbiAgICB9XHJcbiAgICBjb25zdCBidG4gPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZm9yZWNhc3QtZXhwb3J0LWJ0bicpO1xyXG4gICAgaWYgKGJ0bikge1xyXG4gICAgICBidG4uZGlzYWJsZWQgPSBmYWxzZTtcclxuICAgICAgYnRuLnN0eWxlLm9wYWNpdHkgPSAnMSc7XHJcbiAgICB9XHJcbiAgfSBjYXRjaCAoZSkge1xyXG4gICAgY29uc29sZS5lcnJvcignW0ZPUkVDQVNUXSBwYXJzZSBlcnJvcjonLCBlKTtcclxuICAgIGFsZXJ0KCdFcnJvciBwcm9jZXNhbmRvIGVsIEV4Y2VsOlxcbicgKyAoKGUgJiYgZS5tZXNzYWdlKSB8fCBlKSk7XHJcbiAgfSBmaW5hbGx5IHtcclxuICAgIC8vIFJlc2V0IGlucHV0IHBhcmEgcXVlIGVsIG1pc21vIGFyY2hpdm8gc2UgcHVlZGEgcmUtc3ViaXJcclxuICAgIGlmIChldmVudCAmJiBldmVudC50YXJnZXQpIGV2ZW50LnRhcmdldC52YWx1ZSA9ICcnO1xyXG4gIH1cclxufTtcclxuXHJcbndpbmRvdy5leHBvcnRGb3JlY2FzdEV4Y2VsID0gZnVuY3Rpb24gKCkge1xyXG4gIGlmICghX2ZvcmVjYXN0Um93cyB8fCAhX2ZvcmVjYXN0Um93cy5sZW5ndGgpIHtcclxuICAgIGFsZXJ0KCdObyBoYXkgZGF0b3MgcGFyYSBleHBvcnRhci4gQ2FyZ2EgcHJpbWVybyBlbCBTYWxlcyBQbGFuLicpO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuICBpZiAodHlwZW9mIFhMU1ggPT09ICd1bmRlZmluZWQnKSB7XHJcbiAgICBhbGVydCgnWExTWCBubyBjYXJnYWRvJyk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIGNvbnN0IHJvdW5kMSA9IChuKSA9PiBNYXRoLnJvdW5kKE51bWJlcihuIHx8IDApICogMTApIC8gMTA7XHJcbiAgY29uc3QgYW9hID0gW1xyXG4gICAgW1xyXG4gICAgICAnU0tVJyxcclxuICAgICAgJ0ZBTUlMSUEnLFxyXG4gICAgICAnU1VCRkFNSUxJQScsXHJcbiAgICAgICdWRU5UQVMgKDEybSknLFxyXG4gICAgICAnUEVESURPLVNBTEVTIFBMQU5TICg2bSknLFxyXG4gICAgICAnUFJPTUVESU8gREUgSU5WRU5UQVJJTycsXHJcbiAgICAgICdQT0xJVElDQSBERSBJTlZFTlRBUklPICgzbSknLFxyXG4gICAgICAnVE9UQUwnLFxyXG4gICAgXSxcclxuICBdO1xyXG4gIGZvciAoY29uc3QgciBvZiBfZm9yZWNhc3RSb3dzKSB7XHJcbiAgICBhb2EucHVzaChbXHJcbiAgICAgIHIuc2t1LFxyXG4gICAgICByLmZhbWlsaWEsXHJcbiAgICAgIHIuc3ViZmFtaWxpYSxcclxuICAgICAgcm91bmQxKHIudmVudGFzMTJtKSxcclxuICAgICAgcm91bmQxKHIucGVkaWRvNm0pLFxyXG4gICAgICByb3VuZDEoci5wcm9tZWRpbyksXHJcbiAgICAgIHJvdW5kMShyLnBvbGl0aWNhKSxcclxuICAgICAgcm91bmQxKHIudG90YWwpLFxyXG4gICAgXSk7XHJcbiAgfVxyXG4gIGNvbnN0IHdzID0gWExTWC51dGlscy5hb2FfdG9fc2hlZXQoYW9hKTtcclxuICAvLyBBbmNob3MgZGUgY29sdW1uYVxyXG4gIHdzWychY29scyddID0gW1xyXG4gICAgeyB3Y2g6IDE4IH0sXHJcbiAgICB7IHdjaDogMjQgfSxcclxuICAgIHsgd2NoOiAyNCB9LFxyXG4gICAgeyB3Y2g6IDE0IH0sXHJcbiAgICB7IHdjaDogMjAgfSxcclxuICAgIHsgd2NoOiAyMCB9LFxyXG4gICAgeyB3Y2g6IDIyIH0sXHJcbiAgICB7IHdjaDogMTIgfSxcclxuICBdO1xyXG4gIGNvbnN0IHdiID0gWExTWC51dGlscy5ib29rX25ldygpO1xyXG4gIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQod2IsIHdzLCAnRk9SRUNBU1QnKTtcclxuICBjb25zdCBob3kgPSBuZXcgRGF0ZSgpO1xyXG4gIGNvbnN0IHN0YW1wID1cclxuICAgIGhveS5nZXRGdWxsWWVhcigpICtcclxuICAgICctJyArXHJcbiAgICBTdHJpbmcoaG95LmdldE1vbnRoKCkgKyAxKS5wYWRTdGFydCgyLCAnMCcpICtcclxuICAgICctJyArXHJcbiAgICBTdHJpbmcoaG95LmdldERhdGUoKSkucGFkU3RhcnQoMiwgJzAnKTtcclxuICBYTFNYLndyaXRlRmlsZSh3YiwgJ0ZvcmVjYXN0X1NoaW1hbm9fJyArIHN0YW1wICsgJy54bHN4Jyk7XHJcbn07XHJcblxyXG4vLyBSZWZyZXNoIHB1YmxpY28gKHBvciBzaSBlbCB1c2VyIG5lY2VzaXRhIHJlLWZldGNoZWFyIGVsIHNuYXBzaG90IHNpbiBjZXJyYXJcclxuLy8gZWwgbW9kYWwsIGVqOiBwYXNhcm9uIDMwIG1pbiB5IGVsIGNyb24gQlEgYWN0dWFsaXpvIGxhIGNvbGVjY2lvbikuXHJcbndpbmRvdy5yZWxvYWRGb3JlY2FzdFNuYXBzaG90ID0gYXN5bmMgZnVuY3Rpb24gKCkge1xyXG4gIF9mb3JlY2FzdFNuYXBzaG90ID0gbnVsbDtcclxuICBhd2FpdCBfbG9hZFNuYXBzaG90KCk7XHJcbiAgaWYgKF9mb3JlY2FzdFNhbGVzUGxhbikge1xyXG4gICAgY29uc3QgaG95ID0gbmV3IERhdGUoKTtcclxuICAgIF9mb3JlY2FzdFJvd3MgPSBfY29tcHV0ZUZvcmVjYXN0Um93cyhfZm9yZWNhc3RTbmFwc2hvdCwgX2ZvcmVjYXN0U2FsZXNQbGFuLCBob3kpO1xyXG4gICAgX3JlbmRl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
