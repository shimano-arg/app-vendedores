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
    { key: "reels", label: "Reels", color: "#8b5cf6" }
  ];
  var _salesPlanCaches = { rods: null, reels: null };
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL3B1cmUvc2FsZXMtcGxhbi1wYXJzZXIuanMiLCAiLi4vc3JjL2RvbWFpbnMvZm9yZWNhc3QuanMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbIi8vIEB0cy1ub2NoZWNrXHJcbi8vIFB1cmU6IHBhcnNlYSB1biBzaGVldCBTYWxlcyBQbGFuIChmb3JtYXRvIFNVUi9TQVIgZGUgU2hpbWFubykgYSBlc3RydWN0dXJhXHJcbi8vIG5vcm1hbGl6YWRhIHsgc2t1LCBkZXNjcmlwdGlvbiwgbW9xLCBtb250aHM6IHsnWVlZWS1NTSc6IE59IH0uXHJcbi8vIFNpbiBkZXBlbmRlbmNpYXMgXHUyMDE0IHJlY2liZSBlbCBzaGVldCB5YSBkZXNlcmlhbGl6YWRvIHBvciBTaGVldEpTXHJcbi8vIChYTFNYLnV0aWxzLnNoZWV0X3RvX2pzb24oc2hlZXQsIHtoZWFkZXI6MSwgZGVmdmFsOicnfSkpLlxyXG4vLyBUZXN0ZWFibGUgZW4gdml0ZXN0IHNpbiBjYXJnYXIgWExTWC5cclxuLy9cclxuLy8gQ29udGV4dG86IGxvcyBTYWxlcyBQbGFucyBkZSBTaGltYW5vIHZpZW5lbiBjb24gaGVhZGVycyBjb21vXHJcbi8vIFwiU0tVIENvZGUvUGFydCBOb1wiLCBcIkRlc2NyaXB0aW9uXCIsIFwiTU9RIDEyIG1vbnRoc1wiIHkgY29sdW1uYXMgZGUgbWVzZXNcclxuLy8gdGlwbyBcIkphbiAyMDI3XCIsIFwiTWF5IDIwMjdcIiAoYSB2ZWNlcyBjb24gYVx1MDBGMW8gZW4gdW5hIGZpbGEgYXJyaWJhIHkgZWwgbWVzXHJcbi8vIGVuIGxhIGZpbGEgaGVhZGVyKS4gRXN0YSBmbiB0b2xlcmEgYW1ib3MgbGF5b3V0cy5cclxuXHJcbmNvbnN0IE1PTlRIX0FMSUFTRVMgPSB7XHJcbiAgamFuOiAxLFxyXG4gIGphbnVhcnk6IDEsXHJcbiAgZW5lOiAxLFxyXG4gIGVuZXJvOiAxLFxyXG4gIGZlYjogMixcclxuICBmZWJydWFyeTogMixcclxuICBmZWJyZXJvOiAyLFxyXG4gIG1hcjogMyxcclxuICBtYXJjaDogMyxcclxuICBtYXJ6bzogMyxcclxuICBhcHI6IDQsXHJcbiAgYXByaWw6IDQsXHJcbiAgYWJyOiA0LFxyXG4gIGFicmlsOiA0LFxyXG4gIG1heTogNSxcclxuICBtYXlvOiA1LFxyXG4gIGp1bjogNixcclxuICBqdW5lOiA2LFxyXG4gIGp1bmlvOiA2LFxyXG4gIGp1bDogNyxcclxuICBqdWx5OiA3LFxyXG4gIGp1bGlvOiA3LFxyXG4gIGF1ZzogOCxcclxuICBhdWd1c3Q6IDgsXHJcbiAgYWdvOiA4LFxyXG4gIGFnb3N0bzogOCxcclxuICBzZXA6IDksXHJcbiAgc2VwdDogOSxcclxuICBzZXB0ZW1iZXI6IDksXHJcbiAgc2VwdGllbWJyZTogOSxcclxuICBvY3Q6IDEwLFxyXG4gIG9jdG9iZXI6IDEwLFxyXG4gIG9jdHVicmU6IDEwLFxyXG4gIG5vdjogMTEsXHJcbiAgbm92ZW1iZXI6IDExLFxyXG4gIG5vdmllbWJyZTogMTEsXHJcbiAgZGVjOiAxMixcclxuICBkZWNlbWJlcjogMTIsXHJcbiAgZGljOiAxMixcclxuICBkaWNpZW1icmU6IDEyLFxyXG59O1xyXG5cclxuLy8gTm9ybWFsaXphIGxhYmVscyBkZSBtZXNlcyBhICdZWVlZLU1NJy4gUmV0b3JuYSBudWxsIHNpIG5vIG1hdGNoZWEuXHJcbi8vIEZvcm1hdG9zIHNvcG9ydGFkb3M6IFwiSmFuIDIwMjdcIiwgXCJFbmUtMjdcIiwgXCJKYW4vMjAyN1wiLCBcIk1heTI3XCIsXHJcbi8vIFwiMjAyNy0wMVwiLCBcIjAxLzIwMjdcIiwgXCJKYW4uMjAyN1wiLCBcIjIwMjFcXG5KYW5cIiAobXVsdGktbGluZSBFeGNlbCkuXHJcbmZ1bmN0aW9uIG5vcm1hbGl6ZU1vbnRoTGFiZWwobGFiZWwpIHtcclxuICBpZiAobGFiZWwgPT0gbnVsbCkgcmV0dXJuIG51bGw7XHJcbiAgLy8gdjExMDQ6IGNvbGFwc2FyIG5ld2xpbmVzL3RhYnMgYSBlc3BhY2lvIGFudGVzIGRlbCB0cmltLlxyXG4gIC8vIEVsIGZvcm1hdG8gRXhjZWwgXCIyMDIxXFxuSmFuXCIgKGFcdTAwRjFvIGVuIEwxLCBtZXMgZW4gTDIgZGVudHJvIGRlIHVuYSBjZWxkYVxyXG4gIC8vIG11bHRpLXJvdykgZXMgY29tXHUwMEZBbiBlbiBTYWxlcyBQbGFucyBTVVIuIGBcXHMrYCBtYXRjaGVhIHdoaXRlc3BhY2UgaW5jbHV5ZW5kb1xyXG4gIC8vIFxcbiB5IFxcclxcbi5cclxuICBjb25zdCBzID0gU3RyaW5nKGxhYmVsKS5yZXBsYWNlKC9cXHMrL2csICcgJykudHJpbSgpLnRvTG93ZXJDYXNlKCk7XHJcbiAgaWYgKCFzKSByZXR1cm4gbnVsbDtcclxuICBsZXQgbTtcclxuICAvLyBcImphbiAyMDI3XCIgfCBcImphbi0yN1wiIHwgXCJlbmUvMjAyN1wiIHwgXCJtYXkyN1wiIHwgXCJtYXkuMjAyN1wiXHJcbiAgbSA9IHMubWF0Y2goL14oW2Etelx1MDBFMVx1MDBFOVx1MDBFRFx1MDBGM1x1MDBGQV17MywxMH0pW1xcc1xcLS8uX10qKFxcZHsyLDR9KSQvKTtcclxuICBpZiAobSkge1xyXG4gICAgY29uc3QgbW9uID0gTU9OVEhfQUxJQVNFU1ttWzFdXSB8fCBNT05USF9BTElBU0VTW21bMV0uc2xpY2UoMCwgMyldO1xyXG4gICAgaWYgKG1vbikge1xyXG4gICAgICBsZXQgeSA9IHBhcnNlSW50KG1bMl0sIDEwKTtcclxuICAgICAgaWYgKHkgPCAxMDApIHkgPSAyMDAwICsgeTtcclxuICAgICAgcmV0dXJuIFN0cmluZyh5KS5wYWRTdGFydCg0LCAnMCcpICsgJy0nICsgU3RyaW5nKG1vbikucGFkU3RhcnQoMiwgJzAnKTtcclxuICAgIH1cclxuICB9XHJcbiAgLy8gXCIyMDIxIGphblwiIHwgXCIyMDI3IGRpY1wiIChhXHUwMEYxbyBwcmltZXJvICsgbWVzLCBmb3JtYXRvIEV4Y2VsIG11bHRpLWxpbmVcclxuICAvLyBjb2xhcHNhZG8gdHJhcyByZXBsYWNlIFxccyspLlxyXG4gIG0gPSBzLm1hdGNoKC9eKFxcZHs0fSlbXFxzXFwtLy5fXSsoW2Etelx1MDBFMVx1MDBFOVx1MDBFRFx1MDBGM1x1MDBGQV17MywxMH0pJC8pO1xyXG4gIGlmIChtKSB7XHJcbiAgICBjb25zdCB5ID0gcGFyc2VJbnQobVsxXSwgMTApO1xyXG4gICAgY29uc3QgbW9uID0gTU9OVEhfQUxJQVNFU1ttWzJdXSB8fCBNT05USF9BTElBU0VTW21bMl0uc2xpY2UoMCwgMyldO1xyXG4gICAgaWYgKG1vbikgcmV0dXJuIFN0cmluZyh5KS5wYWRTdGFydCg0LCAnMCcpICsgJy0nICsgU3RyaW5nKG1vbikucGFkU3RhcnQoMiwgJzAnKTtcclxuICB9XHJcbiAgLy8gXCIyMDI3LTAxXCIgfCBcIjIwMjcvMDFcIlxyXG4gIG0gPSBzLm1hdGNoKC9eKFxcZHs0fSlbLS9dKFxcZHsxLDJ9KSQvKTtcclxuICBpZiAobSkge1xyXG4gICAgY29uc3QgeSA9IHBhcnNlSW50KG1bMV0sIDEwKTtcclxuICAgIGNvbnN0IG1vbiA9IHBhcnNlSW50KG1bMl0sIDEwKTtcclxuICAgIGlmIChtb24gPj0gMSAmJiBtb24gPD0gMTIpXHJcbiAgICAgIHJldHVybiBTdHJpbmcoeSkucGFkU3RhcnQoNCwgJzAnKSArICctJyArIFN0cmluZyhtb24pLnBhZFN0YXJ0KDIsICcwJyk7XHJcbiAgfVxyXG4gIC8vIFwiMDEvMjAyN1wiIHwgXCIwMS0yMDI3XCJcclxuICBtID0gcy5tYXRjaCgvXihcXGR7MSwyfSlbLS9dKFxcZHs0fSkkLyk7XHJcbiAgaWYgKG0pIHtcclxuICAgIGNvbnN0IG1vbiA9IHBhcnNlSW50KG1bMV0sIDEwKTtcclxuICAgIGNvbnN0IHkgPSBwYXJzZUludChtWzJdLCAxMCk7XHJcbiAgICBpZiAobW9uID49IDEgJiYgbW9uIDw9IDEyKVxyXG4gICAgICByZXR1cm4gU3RyaW5nKHkpLnBhZFN0YXJ0KDQsICcwJykgKyAnLScgKyBTdHJpbmcobW9uKS5wYWRTdGFydCgyLCAnMCcpO1xyXG4gIH1cclxuICByZXR1cm4gbnVsbDtcclxufVxyXG5cclxuLy8gQnVzY2EgbGEgZmlsYSBoZWFkZXIgKDAtYmFzZWQpLiBFc2NhbmVhIGxhcyBwcmltZXJhcyAzMCBmaWxhcy5cclxuZnVuY3Rpb24gZmluZEhlYWRlclJvdyhyb3dzKSB7XHJcbiAgY29uc3QgSEVBREVSX01BUktFUlMgPSBbXHJcbiAgICAnc2t1IGNvZGUvcGFydCBubycsXHJcbiAgICAnc2t1IGNvZGUnLFxyXG4gICAgJ3NrdScsXHJcbiAgICAncGFydCBubycsXHJcbiAgICAncGFydCBudW1iZXInLFxyXG4gICAgJ2l0ZW1jb2RlJyxcclxuICAgICdpdGVtIGNvZGUnLFxyXG4gICAgJ2NvZGlnbycsXHJcbiAgICAnY1x1MDBGM2RpZ28nLFxyXG4gIF07XHJcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBNYXRoLm1pbihyb3dzLmxlbmd0aCwgMzApOyBpKyspIHtcclxuICAgIGNvbnN0IHJvdyA9IHJvd3NbaV0gfHwgW107XHJcbiAgICBmb3IgKGNvbnN0IGNlbGwgb2Ygcm93KSB7XHJcbiAgICAgIC8vIHYxMTA0OiBjb2xhcHNhciBuZXdsaW5lcyBhIGVzcGFjaW8gcGFyYSBtYXRjaGVhciBoZWFkZXJzIGNvbW9cclxuICAgICAgLy8gXCJTS1UgQ29kZS9QYXJ0IE5vXCIgKG9rKSBvIFwiU0tVXFxuQ29kZVwiIChuZWNlc2l0YSBjb2xhcHNhcikuXHJcbiAgICAgIGNvbnN0IHMgPSBTdHJpbmcoY2VsbCA9PSBudWxsID8gJycgOiBjZWxsKVxyXG4gICAgICAgIC5yZXBsYWNlKC9cXHMrL2csICcgJylcclxuICAgICAgICAudHJpbSgpXHJcbiAgICAgICAgLnRvTG93ZXJDYXNlKCk7XHJcbiAgICAgIGlmIChIRUFERVJfTUFSS0VSUy5pbmRleE9mKHMpID49IDApIHJldHVybiBpO1xyXG4gICAgfVxyXG4gIH1cclxuICByZXR1cm4gLTE7XHJcbn1cclxuXHJcbi8vIERldGVjdGEgXHUwMEVEbmRpY2VzIGRlIGNvbHVtbmFzIHkgbWVzZXMuIGBoaW50Um93QWJvdmVgIHBlcm1pdGUgY29tYmluYXIgYVx1MDBGMW8vbWVzXHJcbi8vIGN1YW5kbyBlbCBoZWFkZXIgZXMgbXVsdGktcm93IChhXHUwMEYxbyBhcnJpYmEsIG1lcyBhYmFqbyBvIHZpY2V2ZXJzYSkuXHJcbmZ1bmN0aW9uIGRldGVjdENvbHVtbnMoaGVhZGVyUm93LCBoaW50Um93QWJvdmUpIHtcclxuICBsZXQgc2t1SWR4ID0gLTE7XHJcbiAgbGV0IGRlc2NJZHggPSAtMTtcclxuICBsZXQgbW9xSWR4ID0gLTE7XHJcbiAgY29uc3QgbW9udGhDb2x1bW5zID0gW107XHJcbiAgY29uc3QgZGV0ZWN0ZWRNb250aHNTZXQgPSBuZXcgU2V0KCk7XHJcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBoZWFkZXJSb3cubGVuZ3RoOyBpKyspIHtcclxuICAgIC8vIHYxMTA0OiBjb2xhcHNhciBuZXdsaW5lcyBhIGVzcGFjaW8gYW50ZXMgZGUgY29tcGFyYXIuIExvcyBTYWxlcyBQbGFuXHJcbiAgICAvLyBTVVIgdGllbmVuIGhlYWRlcnMgbXVsdGktbGluZSBjb21vIFwiTU9RXFxuMTIgbW9udGhzXCIgbyBcIkJhc2VcXG5GT0IoVVNEKVwiLlxyXG4gICAgY29uc3QgcmF3ID0gU3RyaW5nKGhlYWRlclJvd1tpXSA9PSBudWxsID8gJycgOiBoZWFkZXJSb3dbaV0pXHJcbiAgICAgIC5yZXBsYWNlKC9cXHMrL2csICcgJylcclxuICAgICAgLnRyaW0oKTtcclxuICAgIGNvbnN0IHMgPSByYXcudG9Mb3dlckNhc2UoKTtcclxuICAgIGlmIChcclxuICAgICAgc2t1SWR4IDwgMCAmJlxyXG4gICAgICAocyA9PT0gJ3NrdSBjb2RlL3BhcnQgbm8nIHx8XHJcbiAgICAgICAgcyA9PT0gJ3NrdSBjb2RlJyB8fFxyXG4gICAgICAgIHMgPT09ICdza3UnIHx8XHJcbiAgICAgICAgcyA9PT0gJ3BhcnQgbm8nIHx8XHJcbiAgICAgICAgcyA9PT0gJ3BhcnQgbnVtYmVyJyB8fFxyXG4gICAgICAgIHMgPT09ICdpdGVtY29kZScgfHxcclxuICAgICAgICBzID09PSAnaXRlbSBjb2RlJyB8fFxyXG4gICAgICAgIHMgPT09ICdjb2RpZ28nIHx8XHJcbiAgICAgICAgcyA9PT0gJ2NcdTAwRjNkaWdvJylcclxuICAgICkge1xyXG4gICAgICBza3VJZHggPSBpO1xyXG4gICAgICBjb250aW51ZTtcclxuICAgIH1cclxuICAgIGlmIChcclxuICAgICAgZGVzY0lkeCA8IDAgJiZcclxuICAgICAgKHMgPT09ICdkZXNjcmlwdGlvbicgfHxcclxuICAgICAgICBzID09PSAnZGVzY3JpcGNpb24nIHx8XHJcbiAgICAgICAgcyA9PT0gJ2Rlc2NyaXBjaVx1MDBGM24nIHx8XHJcbiAgICAgICAgcyA9PT0gJ2l0ZW0gbmFtZScgfHxcclxuICAgICAgICBzID09PSAnaXRlbW5hbWUnKVxyXG4gICAgKSB7XHJcbiAgICAgIGRlc2NJZHggPSBpO1xyXG4gICAgICBjb250aW51ZTtcclxuICAgIH1cclxuICAgIGlmIChtb3FJZHggPCAwICYmIChzID09PSAnbW9xIDEyIG1vbnRocycgfHwgcyA9PT0gJ21vcScgfHwgcy5pbmRleE9mKCdtb3EnKSA9PT0gMCkpIHtcclxuICAgICAgbW9xSWR4ID0gaTtcclxuICAgICAgY29udGludWU7XHJcbiAgICB9XHJcbiAgICAvLyBUcnkgZGlyZWN0IG1vbnRoIHBhcnNlXHJcbiAgICBsZXQgbW9udGhLZXkgPSBub3JtYWxpemVNb250aExhYmVsKHJhdyk7XHJcbiAgICBpZiAoIW1vbnRoS2V5ICYmIGhpbnRSb3dBYm92ZSAmJiBoaW50Um93QWJvdmVbaV0gIT0gbnVsbCkge1xyXG4gICAgICBjb25zdCBoaW50ID0gU3RyaW5nKGhpbnRSb3dBYm92ZVtpXSkudHJpbSgpO1xyXG4gICAgICBpZiAoaGludCkge1xyXG4gICAgICAgIG1vbnRoS2V5ID0gbm9ybWFsaXplTW9udGhMYWJlbChyYXcgKyAnICcgKyBoaW50KSB8fCBub3JtYWxpemVNb250aExhYmVsKGhpbnQgKyAnICcgKyByYXcpO1xyXG4gICAgICB9XHJcbiAgICB9XHJcbiAgICBpZiAobW9udGhLZXkpIHtcclxuICAgICAgbW9udGhDb2x1bW5zLnB1c2goeyBjb2xJZHg6IGksIG1vbnRoS2V5IH0pO1xyXG4gICAgICBkZXRlY3RlZE1vbnRoc1NldC5hZGQobW9udGhLZXkpO1xyXG4gICAgfVxyXG4gIH1cclxuICByZXR1cm4ge1xyXG4gICAgc2t1SWR4LFxyXG4gICAgZGVzY0lkeCxcclxuICAgIG1vcUlkeCxcclxuICAgIG1vbnRoQ29sdW1ucyxcclxuICAgIGRldGVjdGVkTW9udGhzOiBBcnJheS5mcm9tKGRldGVjdGVkTW9udGhzU2V0KS5zb3J0KCksXHJcbiAgfTtcclxufVxyXG5cclxuLy8gUHVibGljOiBwYXJzZSBmdWxsIHNoZWV0LiBUaHJvd3Mgb24gbWlzc2luZyBTS1UgY29sdW1uIC8gbW9udGhzLlxyXG5mdW5jdGlvbiBwYXJzZVNhbGVzUGxhblNoZWV0KHJvd3MpIHtcclxuICBpZiAoIXJvd3MgfHwgIXJvd3MubGVuZ3RoKSB7XHJcbiAgICBjb25zdCBlcnIgPSBuZXcgRXJyb3IoJ0V4Y2VsIHZhY2lvJyk7XHJcbiAgICBlcnIuY29kZSA9ICdFTVBUWV9TSEVFVCc7XHJcbiAgICB0aHJvdyBlcnI7XHJcbiAgfVxyXG4gIGNvbnN0IGhlYWRlcklkeCA9IGZpbmRIZWFkZXJSb3cocm93cyk7XHJcbiAgaWYgKGhlYWRlcklkeCA8IDApIHtcclxuICAgIGNvbnN0IGVyciA9IG5ldyBFcnJvcignTm8gc2UgZW5jb250cm8gZmlsYSBkZSBoZWFkZXJzIChidXNjYWJhIFwiU0tVIENvZGUvUGFydCBOb1wiIG8gXCJTS1VcIiknKTtcclxuICAgIGVyci5jb2RlID0gJ0hFQURFUl9OT1RfRk9VTkQnO1xyXG4gICAgdGhyb3cgZXJyO1xyXG4gIH1cclxuICBjb25zdCBoZWFkZXJSb3cgPSByb3dzW2hlYWRlcklkeF0gfHwgW107XHJcbiAgY29uc3Qgcm93QWJvdmUgPSBoZWFkZXJJZHggPiAwID8gcm93c1toZWFkZXJJZHggLSAxXSB8fCBbXSA6IG51bGw7XHJcbiAgY29uc3QgY29scyA9IGRldGVjdENvbHVtbnMoaGVhZGVyUm93LCByb3dBYm92ZSk7XHJcbiAgaWYgKGNvbHMuc2t1SWR4IDwgMCkge1xyXG4gICAgY29uc3QgZXJyID0gbmV3IEVycm9yKCdObyBzZSBlbmNvbnRybyBjb2x1bW5hIFNLVSBlbiBsYSBmaWxhIGhlYWRlcicpO1xyXG4gICAgZXJyLmNvZGUgPSAnU0tVX0NPTF9NSVNTSU5HJztcclxuICAgIHRocm93IGVycjtcclxuICB9XHJcbiAgaWYgKCFjb2xzLm1vbnRoQ29sdW1ucy5sZW5ndGgpIHtcclxuICAgIGNvbnN0IGVyciA9IG5ldyBFcnJvcihcclxuICAgICAgJ05vIHNlIGRldGVjdGFyb24gY29sdW1uYXMgZGUgbWVzZXMgZW4gZWwgaGVhZGVyIChlajogXCJKYW4gMjAyN1wiLCBcIk1heSAyMDI3XCIpJ1xyXG4gICAgKTtcclxuICAgIGVyci5jb2RlID0gJ01PTlRIU19OT1RfRk9VTkQnO1xyXG4gICAgdGhyb3cgZXJyO1xyXG4gIH1cclxuICBjb25zdCBwYXJzZWRSb3dzID0gW107XHJcbiAgY29uc3Qgc2VlblNrdSA9IG5ldyBTZXQoKTtcclxuICBmb3IgKGxldCByID0gaGVhZGVySWR4ICsgMTsgciA8IHJvd3MubGVuZ3RoOyByKyspIHtcclxuICAgIGNvbnN0IHJvdyA9IHJvd3Nbcl0gfHwgW107XHJcbiAgICBjb25zdCBza3VSYXcgPSByb3dbY29scy5za3VJZHhdO1xyXG4gICAgaWYgKHNrdVJhdyA9PSBudWxsIHx8IFN0cmluZyhza3VSYXcpLnRyaW0oKSA9PT0gJycpIGNvbnRpbnVlO1xyXG4gICAgY29uc3Qgc2t1ID0gU3RyaW5nKHNrdVJhdykudHJpbSgpO1xyXG4gICAgY29uc3QgdXBwZXIgPSBza3UudG9VcHBlckNhc2UoKTtcclxuICAgIC8vIFNraXAgZmlsYXMgVE9UQUwgLyBTVU0gLyBTVUJUT1RBTFxyXG4gICAgaWYgKHVwcGVyID09PSAnVE9UQUwnIHx8IHVwcGVyID09PSAnU1VNJyB8fCB1cHBlciA9PT0gJ1NVQlRPVEFMJyB8fCB1cHBlciA9PT0gJ1RPVEFMRVMnKVxyXG4gICAgICBjb250aW51ZTtcclxuICAgIGlmIChzZWVuU2t1Lmhhcyh1cHBlcikpIGNvbnRpbnVlOyAvLyBkZWR1cGVcclxuICAgIHNlZW5Ta3UuYWRkKHVwcGVyKTtcclxuICAgIGNvbnN0IGRlc2NyaXB0aW9uID1cclxuICAgICAgY29scy5kZXNjSWR4ID49IDAgPyBTdHJpbmcocm93W2NvbHMuZGVzY0lkeF0gPT0gbnVsbCA/ICcnIDogcm93W2NvbHMuZGVzY0lkeF0pLnRyaW0oKSA6ICcnO1xyXG4gICAgY29uc3QgbW9xUmF3ID0gY29scy5tb3FJZHggPj0gMCA/IHJvd1tjb2xzLm1vcUlkeF0gOiBudWxsO1xyXG4gICAgY29uc3QgbW9xTnVtID0gTnVtYmVyKG1vcVJhdyk7XHJcbiAgICBjb25zdCBtb3EgPSBOdW1iZXIuaXNGaW5pdGUobW9xTnVtKSAmJiBtb3FOdW0gPiAwID8gTWF0aC5yb3VuZChtb3FOdW0pIDogMDtcclxuICAgIGNvbnN0IG1vbnRocyA9IHt9O1xyXG4gICAgZm9yIChjb25zdCBtYyBvZiBjb2xzLm1vbnRoQ29sdW1ucykge1xyXG4gICAgICBjb25zdCB2ID0gcm93W21jLmNvbElkeF07XHJcbiAgICAgIGNvbnN0IG4gPSBOdW1iZXIodik7XHJcbiAgICAgIGlmIChOdW1iZXIuaXNGaW5pdGUobikgJiYgbiA+IDApIHtcclxuICAgICAgICBtb250aHNbbWMubW9udGhLZXldID0gTWF0aC5yb3VuZChuKTtcclxuICAgICAgfVxyXG4gICAgfVxyXG4gICAgcGFyc2VkUm93cy5wdXNoKHsgc2t1LCBkZXNjcmlwdGlvbiwgbW9xLCBtb250aHMgfSk7XHJcbiAgfVxyXG4gIHJldHVybiB7XHJcbiAgICBoZWFkZXJSb3dJbmRleDogaGVhZGVySWR4LFxyXG4gICAgZGV0ZWN0ZWRNb250aHM6IGNvbHMuZGV0ZWN0ZWRNb250aHMsXHJcbiAgICByb3dzQ291bnQ6IHBhcnNlZFJvd3MubGVuZ3RoLFxyXG4gICAgcm93czogcGFyc2VkUm93cyxcclxuICB9O1xyXG59XHJcblxyXG4vLyBVTUQtaXNoIGV4cG9ydDogcGFyYSB2aXRlc3QgKG1vZHVsZS5leHBvcnRzKSB5IHBhcmEgYnVuZGxlIGJyb3dzZXIgKHdpbmRvdyBnbG9iYWwpLlxyXG5pZiAodHlwZW9mIG1vZHVsZSAhPT0gJ3VuZGVmaW5lZCcgJiYgbW9kdWxlLmV4cG9ydHMpIHtcclxuICBtb2R1bGUuZXhwb3J0cyA9IHsgcGFyc2VTYWxlc1BsYW5TaGVldCwgbm9ybWFsaXplTW9udGhMYWJlbCwgZmluZEhlYWRlclJvdywgZGV0ZWN0Q29sdW1ucyB9O1xyXG59XHJcbmlmICh0eXBlb2Ygd2luZG93ICE9PSAndW5kZWZpbmVkJykge1xyXG4gIHdpbmRvdy5TYWxlc1BsYW5QYXJzZXIgPSB7XHJcbiAgICBwYXJzZVNhbGVzUGxhblNoZWV0LFxyXG4gICAgbm9ybWFsaXplTW9udGhMYWJlbCxcclxuICAgIGZpbmRIZWFkZXJSb3csXHJcbiAgICBkZXRlY3RDb2x1bW5zLFxyXG4gIH07XHJcbn1cclxuXHJcbmV4cG9ydCB7IGRldGVjdENvbHVtbnMsIGZpbmRIZWFkZXJSb3csIG5vcm1hbGl6ZU1vbnRoTGFiZWwsIHBhcnNlU2FsZXNQbGFuU2hlZXQgfTtcclxuIiwgIi8vIEB0cy1ub2NoZWNrXHJcbi8vIHYxMDk4KyBGYXNlIDE6IGltcG9ydCBkZWwgcGFyc2VyIHB1cm8uIEVsIG1cdTAwRjNkdWxvIGhhY2UgYHdpbmRvdy5TYWxlc1BsYW5QYXJzZXJgXHJcbi8vIGNvbW8gc2lkZS1lZmZlY3QgeSB0YW1iaVx1MDBFOW4gZXhwb3J0YSBsYXMgZm5zIG5vbWJyYWRhczsgdXNhbW9zIHNpZGUtZWZmZWN0XHJcbi8vIHBvcnF1ZSBmb3JlY2FzdC5qcyBjb3JyZSBlbiBlbCBjaHVuayBsYXp5IHkgd2luZG93IHlhIGVzdFx1MDBFMSBkaXNwb25pYmxlLlxyXG5pbXBvcnQgJy4uL3B1cmUvc2FsZXMtcGxhbi1wYXJzZXIuanMnO1xyXG5cclxuLy8gR2xvYmFscyBsZWlkb3MgZGVsIGVudG9ybm8gKGRlY2xhcmFkb3MgZW4gaW5kZXguaHRtbCBpbmxpbmUgbyBidW5kbGUgcHJldmlvKTpcclxuLy8gZmJEYiwgY3VycmVudFVzZXIsIFhMU1ggKGNkbiksIGVzY2FwZUh0bWwuIE1pc21vIHBhdHJvbiBxdWUgb3Ryb3MgZG9taW5pb3MuXHJcbi8vXHJcbi8vIEZPUkVDQVNUIC0gbW9kYWwgYWRtaW4tb25seSAoTWFyaWFubykgcXVlIGNvbXBhcmEgdmVudGFzIGhpc3RvcmljYXNcclxuLy8gKEZpcmVzdG9yZSBza3VfdmVudGFzX3NuYXBzaG90LCBhbGltZW50YWRvIHBvciBzeW5jIEJRIHZfdmVudGFzX2xpbmVhc1xyXG4vLyB2ZW50YW5hIDEzbSkgdnMgU2FsZXMgUGxhbiBjYXJnYWRvIHBvciBlbCB1c2VyIHZpYSBFeGNlbCArIHBvbGl0aWNhIGRlXHJcbi8vIGludmVudGFyaW8gKHByb21lZGlvIFlURCB4IDMgbWVzZXMpLlxyXG4vL1xyXG4vLyBDaHVuayBsYXp5OiBzZSBjYXJnYSBzb2xvIGFsIHByaW1lciBjbGljayBkZWwgYm90b24gRk9SRUNBU1QgZGVsIGhlYWRlci5cclxuLy8gUmVnaXN0cmFkbyBlbiBidWlsZC5qcyBMQVpZX0NIVU5LUyArIHNyYy9tYWluLmpzIGluc3RhbGxDaHVua1N0dWJzICsgc3cuanNcclxuLy8gU1RBVElDX0FTU0VUUy4gVmVyIENMQVVERS5tZCAjMTggKDMgbHVnYXJlcyBzaW5jcm9uaXphZG9zKS5cclxuLy9cclxuLy8gQ29udHJhdG8gZGVsIEV4Y2VsIFNhbGVzIFBsYW4gcXVlIHN1YmUgZWwgdXNlcjpcclxuLy8gICBDb2x1bW5hczogU0tVIHwgTWVzMSB8IE1lczIgfCBNZXMzIHwgTWVzNCB8IE1lczUgfCBNZXM2XHJcbi8vICAgKG5vbWJyZXMgZXhhY3RvcyBkZSBoZWFkZXJzIGNhc2UtaW5zZW5zaXRpdmU7IE1lczEuLjYgc29uIGxvcyBwcm94aW1vc1xyXG4vLyAgIDYgbWVzZXMgZGVzZGUgZWwgbWVzIGFjdHVhbCkuIFVuYSBmaWxhIHBvciBTS1UuXHJcbi8vXHJcbi8vIEZ1ZW50ZSBkZSBkYXRvcyBoaXN0b3JpY2FzOlxyXG4vLyAgIEZpcmVzdG9yZSAvc2t1X3ZlbnRhc19zbmFwc2hvdC97U0tVXzxza3Vfc2FuZWFkbz59XHJcbi8vICAge1xyXG4vLyAgICAgc2t1LCBpdGVtTmFtZSwgZmFtaWxpYSwgc3ViZmFtaWxpYSxcclxuLy8gICAgIG1lc2VzOiB7ICcyMDI1LTA4Jzoge3F0eSwgYXJzfSwgLi4uLCAnMjAyNi0wOCc6IHtxdHksIGFyc30gfVxyXG4vLyAgIH1cclxuLy8gICBSdWxlczogcmVhZCBhZG1pbi1vbmx5IChjb21wZXRpdGl2ZWx5IHNlbnNpdGl2ZSkuIEVzY3JpdG8gcG9yIGNyb25cclxuLy8gICBzeW5jX3NhcF90b19iaWdxdWVyeS5weSBjYWRhIDMwIG1pbi5cclxuXHJcbi8vIEVzdGFkbyBkZWwgbW9kYWwgKGludHJhLWNodW5rLCBubyBjcm9zcy1zY29wZSkuXHJcbmxldCBfZm9yZWNhc3RTbmFwc2hvdCA9IG51bGw7IC8vIHsgU0tVOiB7ZmFtaWxpYSwgc3ViZmFtaWxpYSwgaXRlbU5hbWUsIG1lc2VzfSB9XHJcbmxldCBfZm9yZWNhc3RTYWxlc1BsYW4gPSBudWxsOyAvLyBbeyBza3UsIHBlZGlkb1RvdGFsLCBtZXNlc0FycjogW24xLi5uNl0gfV1cclxubGV0IF9mb3JlY2FzdFJvd3MgPSBudWxsOyAvLyBmaWxhcyBmaW5hbGVzIGNhbGN1bGFkYXMgcGFyYSBwcmV2aWV3ICsgZXhwb3J0XHJcbmxldCBfZm9yZWNhc3RMb2FkaW5nID0gZmFsc2U7XHJcblxyXG4vLyB2MTA5OCsgKEZhc2UgMSBGb3JlY2FzdCB2Mik6IFNhbGVzIFBsYW5zIG1lbnN1YWxlcyBwb3IgZmFtaWxpYSAoUm9kcy9SZWVscy9GRykuXHJcbi8vIFNlIGd1YXJkYW4gZW4gRmlyZXN0b3JlIGBzYWxlc19wbGFuX2NhY2hlL3tmYW1pbGlhfWAgKyBzbmFwc2hvdCBFeGNlbCBvcmlnaW5hbFxyXG4vLyBlbiBTdG9yYWdlIGBmb3JlY2FzdHNfc25hcHNob3RzL3tZWVlZLU1NfS97ZmFtaWxpYX0ueGxzeGAuXHJcbi8vIEVsIHBhcnNlciBwdXJvIHZpdmUgZW4gc3JjL3B1cmUvc2FsZXMtcGxhbi1wYXJzZXIuanMgKGF0dGFjaCBhIHdpbmRvdy5TYWxlc1BsYW5QYXJzZXIpLlxyXG4vLyB2MTEwODogRkcgcmVtb3ZpZG8gZGVsIFVJIChNYXJpYW5vIHBpZGlcdTAwRjMpLiBTb2xvIFJvZHMgKyBSZWVscyBwb3IgYWhvcmEuXHJcbi8vIExhIHJ1bGUgRmlyZXN0b3JlIHNpZ3VlIGFjZXB0YW5kbyAnZmcnIHBvciBzaSBlbiBlbCBmdXR1cm8gc2UgdnVlbHZlIGFcclxuLy8gYWN0aXZhciBcdTIwMTQgbm8gYm9ycmFybGEgZW4gc3RvcmFnZS9maXJlc3RvcmUucnVsZXMgaGFzdGEgY29uZmlybWFyIGRlcHJlY2F0ZS5cclxuY29uc3QgU0FMRVNfUExBTl9GQU1JTElBUyA9IFtcclxuICB7IGtleTogJ3JvZHMnLCBsYWJlbDogJ1JvZHMgKENhXHUwMEYxYXMpJywgY29sb3I6ICcjMGVhNWU5JyB9LFxyXG4gIHsga2V5OiAncmVlbHMnLCBsYWJlbDogJ1JlZWxzJywgY29sb3I6ICcjOGI1Y2Y2JyB9LFxyXG5dO1xyXG5jb25zdCBfc2FsZXNQbGFuQ2FjaGVzID0geyByb2RzOiBudWxsLCByZWVsczogbnVsbCB9OyAvLyBsYXN0IGxvYWRlZCBkb2NcclxubGV0IF9mb3JlY2FzdEFjdGl2ZVRhYiA9ICdzYWxlcy1wbGFucyc7IC8vICdzYWxlcy1wbGFucycgfCAnc3RhdCcgfCAnbGVnYWN5J1xyXG5cclxuLy8gdjExMDMrIChGYXNlIDJCKTogRm9yZWNhc3QgRXN0YWRcdTAwRURzdGljbyBcdTIwMTQgb3V0cHV0IHB1YmxpY2FkbyBwb3JcclxuLy8gc2NyaXB0cy9mb3JlY2FzdC9wdWJsaXNoX3RvX2ZpcmVzdG9yZS5weSBhIGZvcmVjYXN0X291dHB1dC97c3ViX3NsdWd9XHJcbi8vICsgZm9yZWNhc3Rfb3V0cHV0X21ldGEvY3VycmVudC4gMjQgc3VicyArIDEgbWV0YSBkb2MuXHJcbmxldCBfZm9yZWNhc3RTdGF0RG9jcyA9IG51bGw7IC8vIFt7aWQsIHN1YmZhbWlsaWEsIGZvcmVjYXN0WzddLCBtZXRyaWNzLCBiZXN0TW9kZWwsIHZlcnNpb25JZH1dXHJcbmxldCBfZm9yZWNhc3RTdGF0TWV0YSA9IG51bGw7IC8vIHtnZW5lcmF0ZWRBdCwgdmVyc2lvbklkLCByZXN1bWVuOiB7Li4ufX1cclxubGV0IF9mb3JlY2FzdFN0YXRIaXN0b3J5Q2FjaGUgPSBudWxsOyAvLyB7IFtzdWJdOiBbe2RzLCB5fV0gfSBjYWNoZSBsYXp5IG9uLWRlbWFuZFxyXG5cclxuLy8gV2hpdGVsaXN0IGRlIGVtYWlscyBjb24gYWNjZXNvIGFsIG1vZGFsIEZPUkVDQVNULiBSZXBsaWNhIGVsIHBhdHJvbiBkZVxyXG4vLyBcIkFuYWxpc2lzXCIgKGluZGV4Lmh0bWw6MTI2MjUpLiBTb2xvIE1hcmlhbm87IHNpIG90cm8gYWRtaW4gbG8gbmVjZXNpdGFcclxuLy8gc2UgYWdyZWdhIGFjYSBleHBsaWNpdG8uXHJcbmNvbnN0IEZPUkVDQVNUX0FMTE9XRURfRU1BSUxTID0gWydtYXJpYW5vLmVyYmlub0BzaGltYW5vLmNvbS5hcicsICdlcmJpbm9tYXJpYW5vQGdtYWlsLmNvbSddO1xyXG5cclxuZnVuY3Rpb24gX2NhbkZvcmVjYXN0KCkge1xyXG4gIHRyeSB7XHJcbiAgICBjb25zdCBlbWFpbCA9ICgod2luZG93LmN1cnJlbnRVc2VyICYmIHdpbmRvdy5jdXJyZW50VXNlci5lbWFpbCkgfHwgJycpLnRvTG93ZXJDYXNlKCk7XHJcbiAgICBpZiAoIWVtYWlsKSByZXR1cm4gZmFsc2U7XHJcbiAgICByZXR1cm4gRk9SRUNBU1RfQUxMT1dFRF9FTUFJTFMuaW5kZXhPZihlbWFpbCkgPj0gMDtcclxuICB9IGNhdGNoIHtcclxuICAgIHJldHVybiBmYWxzZTtcclxuICB9XHJcbn1cclxuXHJcbi8vIEhlbHBlcnMgZGUgbWVzIGNhbGVuZGFyLlxyXG5mdW5jdGlvbiBfbW9udGhLZXkoeWVhciwgbW9udGhPbmVCYXNlZCkge1xyXG4gIHJldHVybiBTdHJpbmcoeWVhcikucGFkU3RhcnQoNCwgJzAnKSArICctJyArIFN0cmluZyhtb250aE9uZUJhc2VkKS5wYWRTdGFydCgyLCAnMCcpO1xyXG59XHJcbmZ1bmN0aW9uIF9tb250aExhYmVsKGtleSkge1xyXG4gIC8vICcyMDI2LTA4JyAtPiAnYWdvLTI2J1xyXG4gIGNvbnN0IFt5LCBtXSA9IGtleS5zcGxpdCgnLScpLm1hcChOdW1iZXIpO1xyXG4gIGNvbnN0IG5hbWVzID0gW1xyXG4gICAgJ2VuZScsXHJcbiAgICAnZmViJyxcclxuICAgICdtYXInLFxyXG4gICAgJ2FicicsXHJcbiAgICAnbWF5JyxcclxuICAgICdqdW4nLFxyXG4gICAgJ2p1bCcsXHJcbiAgICAnYWdvJyxcclxuICAgICdzZXAnLFxyXG4gICAgJ29jdCcsXHJcbiAgICAnbm92JyxcclxuICAgICdkaWMnLFxyXG4gIF07XHJcbiAgcmV0dXJuIG5hbWVzW20gLSAxXSArICctJyArIFN0cmluZyh5KS5zbGljZSgtMik7XHJcbn1cclxuZnVuY3Rpb24gX2FkZE1vbnRocyh5ZWFyLCBtb250aE9uZUJhc2VkLCBkZWx0YSkge1xyXG4gIGNvbnN0IHRvdGFsTW9udGhzID0geWVhciAqIDEyICsgKG1vbnRoT25lQmFzZWQgLSAxKSArIGRlbHRhO1xyXG4gIGNvbnN0IHkgPSBNYXRoLmZsb29yKHRvdGFsTW9udGhzIC8gMTIpO1xyXG4gIGNvbnN0IG0gPSAodG90YWxNb250aHMgJSAxMikgKyAxO1xyXG4gIHJldHVybiB7IHksIG0gfTtcclxufVxyXG5cclxuLy8gU3VtYSBxdHkgZGVsIFNLVSBlbiBsb3MgdWx0aW1vcyAxMiBNRVNFUyBDT01QTEVUT1MgKGV4Y2x1eWUgZWwgbWVzIGFjdHVhbFxyXG4vLyBwYXJjaWFsIC0gbGEgdmVudGFuYSBtb3ZpbCBcIjEyIG1lc2VzIGNlcnJhZG9zXCIgcXVlIGVsIHVzZXIgcGllbnNhIGNvbW9cclxuLy8gXCJlbCBhXHUwMEYxbyBxdWUgeWEgcGFzb1wiKS4gRWplbXBsbyBlbiBhZ29zdG8gMjAyNjogc3VtYXIgYWdvLTI1IGEganVsLTI2LlxyXG5mdW5jdGlvbiBfc3VtVmVudGFzMTJtQ29tcGxldG9zKG1lc2VzTWFwLCBob3kpIHtcclxuICBpZiAoIW1lc2VzTWFwKSByZXR1cm4gMDtcclxuICBsZXQgc3VtID0gMDtcclxuICBjb25zdCBzdGFydE1vbnRoID0gX2FkZE1vbnRocyhob3kuZ2V0RnVsbFllYXIoKSwgaG95LmdldE1vbnRoKCkgKyAxLCAtMTIpO1xyXG4gIGNvbnN0IGVuZE1vbnRoID0gX2FkZE1vbnRocyhob3kuZ2V0RnVsbFllYXIoKSwgaG95LmdldE1vbnRoKCkgKyAxLCAtMSk7XHJcbiAgY29uc3Qgc3RhcnRLZXkgPSBfbW9udGhLZXkoc3RhcnRNb250aC55LCBzdGFydE1vbnRoLm0pO1xyXG4gIGNvbnN0IGVuZEtleSA9IF9tb250aEtleShlbmRNb250aC55LCBlbmRNb250aC5tKTtcclxuICBmb3IgKGNvbnN0IGsgb2YgT2JqZWN0LmtleXMobWVzZXNNYXApKSB7XHJcbiAgICBpZiAoayA+PSBzdGFydEtleSAmJiBrIDw9IGVuZEtleSkge1xyXG4gICAgICBzdW0gKz0gTnVtYmVyKChtZXNlc01hcFtrXSAmJiBtZXNlc01hcFtrXS5xdHkpIHx8IDApO1xyXG4gICAgfVxyXG4gIH1cclxuICByZXR1cm4gc3VtO1xyXG59XHJcblxyXG4vLyBTdW1hIHF0eSBkZWwgU0tVIFlURCAoZW5lcm8gZGVsIGFcdTAwRjFvIGFjdHVhbCBoYXN0YSBtZXMgYWN0dWFsIElOQ0xVU0lWTyxcclxuLy8gYXVucXVlIGVsIG1lcyBhY3R1YWwgc2VhIHBhcmNpYWwpLiBSZXRvcm5hIHsgdG90YWxZdGQsIG1lc2VzVHJhbnNjdXJyaWRvcyB9LlxyXG4vLyBFamVtcGxvIGFnb3N0byAyMDI2IGNvbiB2ZW50YXMganVsPTEwICsgYWdvPTIwIC0+IHszMCwgOH0sIHByb21lZGlvPTMwLzg9My43NS5cclxuLy8gKFNpIGVsIHVzdWFyaW8gZXNwZXJhYmEgZGl2aWRpciBwb3IgMiBlbiB2ZXogZGUgOCwgcmV2aXNhciBzcGVjLiBFbCBwZWRpZG9cclxuLy8gZGljZSBcImNhbnRpZGFkIGRlIG1lc2VzIHF1ZSB0cmFuc2N1cnJpbW9zXCIgPSBtZXNlcyBkZWwgYVx1MDBGMW8gcGFzYWRvcyBoYXN0YSBob3kuKVxyXG5mdW5jdGlvbiBfc3VtVmVudGFzWVREKG1lc2VzTWFwLCBob3kpIHtcclxuICBjb25zdCB5ZWFyID0gaG95LmdldEZ1bGxZZWFyKCk7XHJcbiAgY29uc3QgbWVzQWN0dWFsID0gaG95LmdldE1vbnRoKCkgKyAxO1xyXG4gIGxldCB0b3RhbCA9IDA7XHJcbiAgaWYgKG1lc2VzTWFwKSB7XHJcbiAgICBmb3IgKGxldCBtID0gMTsgbSA8PSBtZXNBY3R1YWw7IG0rKykge1xyXG4gICAgICBjb25zdCBrID0gX21vbnRoS2V5KHllYXIsIG0pO1xyXG4gICAgICB0b3RhbCArPSBOdW1iZXIoKG1lc2VzTWFwW2tdICYmIG1lc2VzTWFwW2tdLnF0eSkgfHwgMCk7XHJcbiAgICB9XHJcbiAgfVxyXG4gIHJldHVybiB7IHRvdGFsWXRkOiB0b3RhbCwgbWVzZXNUcmFuc2N1cnJpZG9zOiBtZXNBY3R1YWwgfTtcclxufVxyXG5cclxuLy8gQ2FyZ2Egc2t1X3ZlbnRhc19zbmFwc2hvdCBjb21wbGV0byAodW5hIHZleiBwb3Igc2VzaW9uIGRlbCBtb2RhbCkuXHJcbmFzeW5jIGZ1bmN0aW9uIF9sb2FkU25hcHNob3QoKSB7XHJcbiAgaWYgKF9mb3JlY2FzdFNuYXBzaG90KSByZXR1cm4gX2ZvcmVjYXN0U25hcHNob3Q7XHJcbiAgaWYgKCF3aW5kb3cuZmJEYikgdGhyb3cgbmV3IEVycm9yKCdGaXJlc3RvcmUgbm8gaW5pY2lhbGl6YWRvJyk7XHJcbiAgY29uc3Qgc25hcCA9IGF3YWl0IHdpbmRvdy5mYkRiLmNvbGxlY3Rpb24oJ3NrdV92ZW50YXNfc25hcHNob3QnKS5nZXQoKTtcclxuICBjb25zdCBieU9yaWdpbmFsU2t1ID0ge307XHJcbiAgY29uc3QgYnlVcHBlclNrdSA9IHt9O1xyXG4gIHNuYXAuZm9yRWFjaCgoZG9jKSA9PiB7XHJcbiAgICBjb25zdCBkID0gZG9jLmRhdGEoKTtcclxuICAgIGlmICghZCB8fCAhZC5za3UpIHJldHVybjtcclxuICAgIGNvbnN0IHNrdVVwcGVyID0gU3RyaW5nKGQuc2t1KS50cmltKCkudG9VcHBlckNhc2UoKTtcclxuICAgIGNvbnN0IHJlY29yZCA9IHtcclxuICAgICAgc2t1OiBkLnNrdSxcclxuICAgICAgaXRlbU5hbWU6IGQuaXRlbU5hbWUgfHwgJycsXHJcbiAgICAgIGZhbWlsaWE6IGQuZmFtaWxpYSB8fCAnJyxcclxuICAgICAgc3ViZmFtaWxpYTogZC5zdWJmYW1pbGlhIHx8ICcnLFxyXG4gICAgICBtZXNlczogZC5tZXNlcyB8fCB7fSxcclxuICAgIH07XHJcbiAgICBieU9yaWdpbmFsU2t1W2Quc2t1XSA9IHJlY29yZDtcclxuICAgIGJ5VXBwZXJTa3Vbc2t1VXBwZXJdID0gcmVjb3JkO1xyXG4gIH0pO1xyXG4gIF9mb3JlY2FzdFNuYXBzaG90ID0geyBieU9yaWdpbmFsU2t1LCBieVVwcGVyU2t1LCBjb3VudDogc25hcC5zaXplIH07XHJcbiAgcmV0dXJuIF9mb3JlY2FzdFNuYXBzaG90O1xyXG59XHJcblxyXG4vLyBQYXJzZWEgZWwgRXhjZWwgU2FsZXMgUGxhbi4gRXNwZXJhIGNvbHVtbmFzIFNLVSArIDYgY29sdW1uYXMgbnVtZXJpY2FzXHJcbi8vIChub21icmVzIGZsZXhpYmxlczogTWVzMS4uTWVzNiwgbWVzXzEuLm1lc182LCBvIGN1YWxxdWllciBoZWFkZXIgY3VzdG9tXHJcbi8vIG1pZW50cmFzIGxhIHByaW1lcmEgc2VhIFNLVSB5IGhheWEgYWwgbWVub3MgNiBjb2x1bW5hcyBudW1lcmljYXMgbWFzKS5cclxuZnVuY3Rpb24gX3BhcnNlU2FsZXNQbGFuUm93cyhyb3dzUmF3KSB7XHJcbiAgaWYgKCFyb3dzUmF3IHx8ICFyb3dzUmF3Lmxlbmd0aCkgcmV0dXJuIFtdO1xyXG4gIGNvbnN0IGhlYWRlclJvdyA9IHJvd3NSYXdbMF07XHJcbiAgLy8gRGV0ZWN0YXIgaW5kaWNlIGRlIGNvbHVtbmEgU0tVXHJcbiAgbGV0IHNrdUNvbElkeCA9IC0xO1xyXG4gIGZvciAobGV0IGkgPSAwOyBpIDwgaGVhZGVyUm93Lmxlbmd0aDsgaSsrKSB7XHJcbiAgICBjb25zdCBoID0gU3RyaW5nKGhlYWRlclJvd1tpXSB8fCAnJylcclxuICAgICAgLnRyaW0oKVxyXG4gICAgICAudG9VcHBlckNhc2UoKTtcclxuICAgIGlmIChoID09PSAnU0tVJyB8fCBoID09PSAnSVRFTUNPREUnIHx8IGggPT09ICdJVEVNJyB8fCBoID09PSAnSVRFTSBDT0RFJyB8fCBoID09PSAnQ09ESUdPJykge1xyXG4gICAgICBza3VDb2xJZHggPSBpO1xyXG4gICAgICBicmVhaztcclxuICAgIH1cclxuICB9XHJcbiAgaWYgKHNrdUNvbElkeCA8IDApXHJcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ0VsIEV4Y2VsIGRlYmUgdGVuZXIgdW5hIGNvbHVtbmEgbGxhbWFkYSBcIlNLVVwiIChvIENvZGlnbyAvIEl0ZW1Db2RlIC8gSXRlbSknKTtcclxuICAvLyBMYXMgNiBjb2x1bW5hcyBkZSBtZXNlczogbGFzIHByaW1lcmFzIDYgY29sdW1uYXMgcXVlIHNlYW4gIT0gc2t1Q29sSWR4LlxyXG4gIGNvbnN0IG1vbnRoQ29scyA9IFtdO1xyXG4gIGZvciAobGV0IGkgPSAwOyBpIDwgaGVhZGVyUm93Lmxlbmd0aCAmJiBtb250aENvbHMubGVuZ3RoIDwgNjsgaSsrKSB7XHJcbiAgICBpZiAoaSAhPT0gc2t1Q29sSWR4KSBtb250aENvbHMucHVzaChpKTtcclxuICB9XHJcbiAgaWYgKG1vbnRoQ29scy5sZW5ndGggPCA2KVxyXG4gICAgdGhyb3cgbmV3IEVycm9yKFxyXG4gICAgICAnRWwgRXhjZWwgZGViZSB0ZW5lciBhbCBtZW5vcyA2IGNvbHVtbmFzIGRlIG1lc2VzIGFkZW1hcyBkZSBTS1UgKGVuY29udHJhZGFzOiAnICtcclxuICAgICAgICBtb250aENvbHMubGVuZ3RoICtcclxuICAgICAgICAnKSdcclxuICAgICk7XHJcbiAgY29uc3Qgb3V0ID0gW107XHJcbiAgZm9yIChsZXQgciA9IDE7IHIgPCByb3dzUmF3Lmxlbmd0aDsgcisrKSB7XHJcbiAgICBjb25zdCByb3cgPSByb3dzUmF3W3JdO1xyXG4gICAgaWYgKCFyb3cgfHwgIXJvdy5sZW5ndGgpIGNvbnRpbnVlO1xyXG4gICAgY29uc3Qgc2t1UmF3ID0gcm93W3NrdUNvbElkeF07XHJcbiAgICBpZiAoc2t1UmF3ID09PSB1bmRlZmluZWQgfHwgc2t1UmF3ID09PSBudWxsIHx8IFN0cmluZyhza3VSYXcpLnRyaW0oKSA9PT0gJycpIGNvbnRpbnVlO1xyXG4gICAgY29uc3Qgc2t1ID0gU3RyaW5nKHNrdVJhdykudHJpbSgpO1xyXG4gICAgY29uc3QgbWVzZXNBcnIgPSBtb250aENvbHMubWFwKChpKSA9PiB7XHJcbiAgICAgIGNvbnN0IHYgPSByb3dbaV07XHJcbiAgICAgIGNvbnN0IG4gPSBOdW1iZXIodik7XHJcbiAgICAgIHJldHVybiBOdW1iZXIuaXNGaW5pdGUobikgPyBuIDogMDtcclxuICAgIH0pO1xyXG4gICAgY29uc3QgcGVkaWRvVG90YWwgPSBtZXNlc0Fyci5yZWR1Y2UoKGEsIGIpID0+IGEgKyBiLCAwKTtcclxuICAgIG91dC5wdXNoKHsgc2t1LCBtZXNlc0FyciwgcGVkaWRvVG90YWwgfSk7XHJcbiAgfVxyXG4gIHJldHVybiBvdXQ7XHJcbn1cclxuXHJcbi8vIENhbGN1bGEgbGFzIGZpbGFzIGZpbmFsZXMgY3J1emFuZG8gc25hcHNob3QgKyBzYWxlcyBwbGFuLlxyXG5mdW5jdGlvbiBfY29tcHV0ZUZvcmVjYXN0Um93cyhzbmFwc2hvdCwgc2FsZXNQbGFuLCBob3kpIHtcclxuICBjb25zdCByb3dzID0gW107XHJcbiAgZm9yIChjb25zdCBzcCBvZiBzYWxlc1BsYW4pIHtcclxuICAgIGNvbnN0IHNrdVVwcGVyID0gc3Auc2t1LnRvVXBwZXJDYXNlKCk7XHJcbiAgICBjb25zdCBoaXN0ID0gc25hcHNob3QuYnlVcHBlclNrdVtza3VVcHBlcl0gfHwgbnVsbDtcclxuICAgIGNvbnN0IHZlbnRhczEybSA9IGhpc3QgPyBfc3VtVmVudGFzMTJtQ29tcGxldG9zKGhpc3QubWVzZXMsIGhveSkgOiAwO1xyXG4gICAgY29uc3QgeXRkID0gaGlzdFxyXG4gICAgICA/IF9zdW1WZW50YXNZVEQoaGlzdC5tZXNlcywgaG95KVxyXG4gICAgICA6IHsgdG90YWxZdGQ6IDAsIG1lc2VzVHJhbnNjdXJyaWRvczogaG95LmdldE1vbnRoKCkgKyAxIH07XHJcbiAgICBjb25zdCBwcm9tZWRpbyA9IHl0ZC5tZXNlc1RyYW5zY3Vycmlkb3MgPiAwID8geXRkLnRvdGFsWXRkIC8geXRkLm1lc2VzVHJhbnNjdXJyaWRvcyA6IDA7XHJcbiAgICBjb25zdCBwb2xpdGljYSA9IHByb21lZGlvICogMztcclxuICAgIGNvbnN0IHRvdGFsID0gc3AucGVkaWRvVG90YWwgLSBwb2xpdGljYTtcclxuICAgIHJvd3MucHVzaCh7XHJcbiAgICAgIHNrdTogc3Auc2t1LFxyXG4gICAgICBpdGVtTmFtZTogaGlzdCA/IGhpc3QuaXRlbU5hbWUgOiAnJyxcclxuICAgICAgZmFtaWxpYTogaGlzdCA/IGhpc3QuZmFtaWxpYSA6ICcoc2luIG1hdGNoKScsXHJcbiAgICAgIHN1YmZhbWlsaWE6IGhpc3QgPyBoaXN0LnN1YmZhbWlsaWEgOiAnKHNpbiBtYXRjaCknLFxyXG4gICAgICB2ZW50YXMxMm06IHZlbnRhczEybSxcclxuICAgICAgcGVkaWRvNm06IHNwLnBlZGlkb1RvdGFsLFxyXG4gICAgICBwcm9tZWRpbzogcHJvbWVkaW8sXHJcbiAgICAgIHBvbGl0aWNhOiBwb2xpdGljYSxcclxuICAgICAgdG90YWw6IHRvdGFsLFxyXG4gICAgICBoYXNIaXN0b3JpYTogISFoaXN0LFxyXG4gICAgfSk7XHJcbiAgfVxyXG4gIHJldHVybiByb3dzO1xyXG59XHJcblxyXG5mdW5jdGlvbiBfcmVuZGVyTW9kYWxTaGVsbCgpIHtcclxuICBjb25zdCBleGlzdGluZyA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdmb3JlY2FzdC1tb2RhbCcpO1xyXG4gIGlmIChleGlzdGluZykgcmV0dXJuIGV4aXN0aW5nO1xyXG4gIGNvbnN0IGVsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2Jyk7XHJcbiAgZWwuaWQgPSAnZm9yZWNhc3QtbW9kYWwnO1xyXG4gIGVsLmNsYXNzTmFtZSA9ICdtb2RhbC1vdmVybGF5JztcclxuICBlbC5zdHlsZS5jc3NUZXh0ID1cclxuICAgICdkaXNwbGF5Om5vbmU7cG9zaXRpb246Zml4ZWQ7aW5zZXQ6MDtiYWNrZ3JvdW5kOnJnYmEoMTUsMjMsNDIsLjYpO3otaW5kZXg6MjA1MDsnO1xyXG4gIGVsLm9uY2xpY2sgPSBmdW5jdGlvbiAoZXYpIHtcclxuICAgIGlmIChldi50YXJnZXQgPT09IGVsKSB3aW5kb3cuY2xvc2VGb3JlY2FzdE1vZGFsKCk7XHJcbiAgfTtcclxuICAvLyBTaGVsbCArIHRhYnMgYmFyICsgMiBjb250ZW5lZG9yZXMgZGUgdGFicyAoU2FsZXMgUGxhbnMgbnVldmEsIExlZ2FjeSA2bSkuXHJcbiAgLy8gRWwgY29udGVuaWRvIGRlIGNhZGEgdGFiIHNlIHBpbnRhIGNvbiBfcmVuZGVyU2FsZXNQbGFuc1RhYigpIHkgZWwgbGVnYWN5XHJcbiAgLy8gdXNhIGVsIGZsdWpvIF9yZW5kZXJUYWJsZSgpIGRlIHNpZW1wcmUuXHJcbiAgY29uc3Qgc2hlbGxIdG1sID0gX2J1aWxkU2hlbGxIdG1sKCk7XHJcbiAgZWwuaW5uZXJIVE1MID0gc2hlbGxIdG1sO1xyXG4gIGRvY3VtZW50LmJvZHkuYXBwZW5kQ2hpbGQoZWwpO1xyXG4gIHJldHVybiBlbDtcclxufVxyXG5cclxuZnVuY3Rpb24gX2J1aWxkU2hlbGxIdG1sKCkge1xyXG4gIC8vIEJyb2tlbi1vdXQgcHVyZSBzdHJpbmcgYnVpbGRlciBwYXJhIHBhc2FyIGVsIGhvb2sgZGUgaW5uZXJIVE1MLlxyXG4gIGNvbnN0IG1vZGFsT3V0ZXIgPVxyXG4gICAgJzxkaXYgc3R5bGU9XCJwb3NpdGlvbjphYnNvbHV0ZTtpbnNldDoxdmggMXZ3O2JhY2tncm91bmQ6dmFyKC0tYmctZWxldmF0ZWQpO2JvcmRlci1yYWRpdXM6MTBweDtkaXNwbGF5OmZsZXg7ZmxleC1kaXJlY3Rpb246Y29sdW1uO292ZXJmbG93OmhpZGRlbjtib3gtc2hhZG93OjAgMjBweCA1MHB4IHJnYmEoMCwwLDAsLjM1KVwiPic7XHJcbiAgY29uc3QgaGVhZGVyID1cclxuICAgICc8ZGl2IHN0eWxlPVwicGFkZGluZzoxMnB4IDE4cHg7YmFja2dyb3VuZDojMGYxNzJhO2NvbG9yOiNmZmY7ZGlzcGxheTpmbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtnYXA6MTJweFwiPicgK1xyXG4gICAgJzxkaXYgc3R5bGU9XCJmbGV4OjFcIj48ZGl2IHN0eWxlPVwiZm9udC1zaXplOjE2cHg7Zm9udC13ZWlnaHQ6ODAwO2xldHRlci1zcGFjaW5nOi41cHhcIj5GT1JFQ0FTVDwvZGl2PicgK1xyXG4gICAgJzxkaXYgaWQ9XCJmb3JlY2FzdC1zdWJ0aXRsZVwiIHN0eWxlPVwiZm9udC1zaXplOjExcHg7b3BhY2l0eTouODttYXJnaW4tdG9wOjJweFwiPlNhbGVzIFBsYW5zIG1lbnN1YWxlcyArIHBvbGl0aWNhIGRlIGludmVudGFyaW88L2Rpdj48L2Rpdj4nICtcclxuICAgICc8YnV0dG9uIG9uY2xpY2s9XCJjbG9zZUZvcmVjYXN0TW9kYWwoKVwiIHN0eWxlPVwiYmFja2dyb3VuZDp0cmFuc3BhcmVudDtjb2xvcjojZmZmO2JvcmRlcjoxcHggc29saWQgcmdiYSgyNTUsMjU1LDI1NSwuNCk7Ym9yZGVyLXJhZGl1czo2cHg7cGFkZGluZzo2cHggMTBweDtjdXJzb3I6cG9pbnRlcjtmb250LXdlaWdodDo3MDBcIj5DZXJyYXI8L2J1dHRvbj4nICtcclxuICAgICc8L2Rpdj4nO1xyXG4gIGNvbnN0IHRhYnNCYXIgPVxyXG4gICAgJzxkaXYgaWQ9XCJmb3JlY2FzdC10YWJzLWJhclwiIHN0eWxlPVwiZGlzcGxheTpmbGV4O2dhcDowO2JhY2tncm91bmQ6dmFyKC0tYmctc2Vjb25kYXJ5KTtwYWRkaW5nOjAgMThweDtib3JkZXItYm90dG9tOjFweCBzb2xpZCB2YXIoLS1ib3JkZXItc3VidGxlKVwiPicgK1xyXG4gICAgJzxidXR0b24gZGF0YS10YWI9XCJzYWxlcy1wbGFuc1wiIG9uY2xpY2s9XCJzd2l0Y2hGb3JlY2FzdFRhYihcXCdzYWxlcy1wbGFuc1xcJylcIiBjbGFzcz1cImZvcmVjYXN0LXRhYlwiIHN0eWxlPVwicGFkZGluZzoxMHB4IDE2cHg7YmFja2dyb3VuZDp0cmFuc3BhcmVudDtjb2xvcjp2YXIoLS10ZXh0LXByaW1hcnkpO2JvcmRlcjpub25lO2JvcmRlci1ib3R0b206M3B4IHNvbGlkICMwZDk0ODg7Y3Vyc29yOnBvaW50ZXI7Zm9udC13ZWlnaHQ6NzAwO2ZvbnQtc2l6ZToxMnB4O2xldHRlci1zcGFjaW5nOi40cHg7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlXCI+U2FsZXMgUGxhbnM8L2J1dHRvbj4nICtcclxuICAgICc8YnV0dG9uIGRhdGEtdGFiPVwic3RhdFwiIG9uY2xpY2s9XCJzd2l0Y2hGb3JlY2FzdFRhYihcXCdzdGF0XFwnKVwiIGNsYXNzPVwiZm9yZWNhc3QtdGFiXCIgc3R5bGU9XCJwYWRkaW5nOjEwcHggMTZweDtiYWNrZ3JvdW5kOnRyYW5zcGFyZW50O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO2JvcmRlcjpub25lO2JvcmRlci1ib3R0b206M3B4IHNvbGlkIHRyYW5zcGFyZW50O2N1cnNvcjpwb2ludGVyO2ZvbnQtd2VpZ2h0OjYwMDtmb250LXNpemU6MTJweDtsZXR0ZXItc3BhY2luZzouNHB4O3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZVwiPkZvcmVjYXN0IEVzdGFkXHUwMEVEc3RpY288L2J1dHRvbj4nICtcclxuICAgICc8YnV0dG9uIGRhdGEtdGFiPVwibGVnYWN5XCIgb25jbGljaz1cInN3aXRjaEZvcmVjYXN0VGFiKFxcJ2xlZ2FjeVxcJylcIiBjbGFzcz1cImZvcmVjYXN0LXRhYlwiIHN0eWxlPVwicGFkZGluZzoxMHB4IDE2cHg7YmFja2dyb3VuZDp0cmFuc3BhcmVudDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTtib3JkZXI6bm9uZTtib3JkZXItYm90dG9tOjNweCBzb2xpZCB0cmFuc3BhcmVudDtjdXJzb3I6cG9pbnRlcjtmb250LXdlaWdodDo2MDA7Zm9udC1zaXplOjEycHg7bGV0dGVyLXNwYWNpbmc6LjRweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2VcIj5MZWdhY3kgKDZtKTwvYnV0dG9uPicgK1xyXG4gICAgJzwvZGl2Pic7XHJcbiAgY29uc3QgdGFiU2FsZXNQbGFucyA9ICc8ZGl2IGlkPVwiZm9yZWNhc3QtdGFiLXNhbGVzLXBsYW5zXCIgc3R5bGU9XCJmbGV4OjE7b3ZlcmZsb3c6YXV0b1wiPjwvZGl2Pic7XHJcbiAgY29uc3QgdGFiU3RhdCA9ICc8ZGl2IGlkPVwiZm9yZWNhc3QtdGFiLXN0YXRcIiBzdHlsZT1cImZsZXg6MTtvdmVyZmxvdzphdXRvO2Rpc3BsYXk6bm9uZVwiPjwvZGl2Pic7XHJcbiAgY29uc3QgbGVnYWN5QmFyID1cclxuICAgICc8ZGl2IHN0eWxlPVwicGFkZGluZzoxMnB4IDE4cHg7YmFja2dyb3VuZDp2YXIoLS1iZy1zZWNvbmRhcnkpO2JvcmRlci1ib3R0b206MXB4IHNvbGlkIHZhcigtLWJvcmRlci1zdWJ0bGUpO2Rpc3BsYXk6ZmxleDtmbGV4LXdyYXA6d3JhcDtnYXA6MTRweDthbGlnbi1pdGVtczpjZW50ZXJcIj4nICtcclxuICAgICc8bGFiZWwgc3R5bGU9XCJkaXNwbGF5OmlubGluZS1mbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtnYXA6OHB4O3BhZGRpbmc6OHB4IDEycHg7YmFja2dyb3VuZDojMGQ5NDg4O2NvbG9yOiNmZmY7Ym9yZGVyLXJhZGl1czo2cHg7Zm9udC13ZWlnaHQ6NzAwO2ZvbnQtc2l6ZToxMnB4O2N1cnNvcjpwb2ludGVyXCI+JyArXHJcbiAgICAnPHNwYW4+Q2FyZ2FyIFNhbGVzIFBsYW4gKC54bHN4KTwvc3Bhbj4nICtcclxuICAgICc8aW5wdXQgdHlwZT1cImZpbGVcIiBhY2NlcHQ9XCIueGxzeCwueGxzXCIgc3R5bGU9XCJkaXNwbGF5Om5vbmVcIiBvbmNoYW5nZT1cIm9uRm9yZWNhc3RTYWxlc1BsYW5GaWxlKGV2ZW50KVwiLz48L2xhYmVsPicgK1xyXG4gICAgJzxkaXYgaWQ9XCJmb3JlY2FzdC1oaW50XCIgc3R5bGU9XCJmb250LXNpemU6MTFweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTttYXgtd2lkdGg6NTIwcHhcIj5Gb3JtYXRvIGxlZ2FjeTogcHJpbWVyYSBjb2x1bW5hIDxiPlNLVTwvYj4sIGx1ZWdvIDYgY29sdW1uYXMgY29uIGxhcyB1bmlkYWRlcyBwZWRpZGFzIG1lcyBhIG1lcy48L2Rpdj4nICtcclxuICAgICc8YnV0dG9uIGlkPVwiZm9yZWNhc3QtZXhwb3J0LWJ0blwiIG9uY2xpY2s9XCJleHBvcnRGb3JlY2FzdEV4Y2VsKClcIiBkaXNhYmxlZCBzdHlsZT1cInBhZGRpbmc6OHB4IDE0cHg7YmFja2dyb3VuZDp2YXIoLS1jb2xvci1zdWNjZXNzKTtjb2xvcjojZmZmO2JvcmRlcjpub25lO2JvcmRlci1yYWRpdXM6NnB4O2ZvbnQtd2VpZ2h0OjcwMDtjdXJzb3I6cG9pbnRlcjtvcGFjaXR5Oi41XCI+RXhwb3J0YXIgRXhjZWw8L2J1dHRvbj4nICtcclxuICAgICc8ZGl2IGlkPVwiZm9yZWNhc3Qtc3RhdHNcIiBzdHlsZT1cIm1hcmdpbi1sZWZ0OmF1dG87Zm9udC1zaXplOjExcHg7Y29sb3I6dmFyKC0tdGV4dC1zZWNvbmRhcnkpO2ZvbnQtd2VpZ2h0OjYwMFwiPjwvZGl2PicgK1xyXG4gICAgJzwvZGl2Pic7XHJcbiAgY29uc3QgbGVnYWN5Qm9keSA9XHJcbiAgICAnPGRpdiBpZD1cImZvcmVjYXN0LWJvZHlcIiBzdHlsZT1cImZsZXg6MTtvdmVyZmxvdzphdXRvO3BhZGRpbmc6MFwiPjxkaXYgc3R5bGU9XCJwYWRkaW5nOjYwcHggMjBweDt0ZXh0LWFsaWduOmNlbnRlcjtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTtmb250LXNpemU6MTRweFwiPkVzcGVyYW5kbyBhcmNoaXZvIFNhbGVzIFBsYW4uLi48L2Rpdj48L2Rpdj4nO1xyXG4gIGNvbnN0IHRhYkxlZ2FjeSA9XHJcbiAgICAnPGRpdiBpZD1cImZvcmVjYXN0LXRhYi1sZWdhY3lcIiBzdHlsZT1cImZsZXg6MTtvdmVyZmxvdzpoaWRkZW47ZmxleC1kaXJlY3Rpb246Y29sdW1uO2Rpc3BsYXk6bm9uZVwiPicgK1xyXG4gICAgbGVnYWN5QmFyICtcclxuICAgIGxlZ2FjeUJvZHkgK1xyXG4gICAgJzwvZGl2Pic7XHJcbiAgcmV0dXJuIG1vZGFsT3V0ZXIgKyBoZWFkZXIgKyB0YWJzQmFyICsgdGFiU2FsZXNQbGFucyArIHRhYlN0YXQgKyB0YWJMZWdhY3kgKyAnPC9kaXY+JztcclxufVxyXG5cclxuLy8gdjEwOTgrIEZhc2UgMSArIHYxMTAzKyBGYXNlIDJCICsgdjExMDUgZml4OiBzd2l0Y2ggZW50cmUgdGFicyBTYWxlcyBQbGFucyAvIFN0YXQgLyBMZWdhY3kuXHJcbndpbmRvdy5zd2l0Y2hGb3JlY2FzdFRhYiA9IGZ1bmN0aW9uICh0YWJJZCkge1xyXG4gIF9mb3JlY2FzdEFjdGl2ZVRhYiA9IHRhYklkO1xyXG4gIGNvbnN0IHNwID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2ZvcmVjYXN0LXRhYi1zYWxlcy1wbGFucycpO1xyXG4gIGNvbnN0IHN0ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2ZvcmVjYXN0LXRhYi1zdGF0Jyk7XHJcbiAgY29uc3QgbGcgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZm9yZWNhc3QtdGFiLWxlZ2FjeScpO1xyXG4gIGlmIChzcCkgc3Auc3R5bGUuZGlzcGxheSA9IHRhYklkID09PSAnc2FsZXMtcGxhbnMnID8gJ2Jsb2NrJyA6ICdub25lJztcclxuICBpZiAoc3QpIHN0LnN0eWxlLmRpc3BsYXkgPSB0YWJJZCA9PT0gJ3N0YXQnID8gJ2Jsb2NrJyA6ICdub25lJztcclxuICBpZiAobGcpIGxnLnN0eWxlLmRpc3BsYXkgPSB0YWJJZCA9PT0gJ2xlZ2FjeScgPyAnZmxleCcgOiAnbm9uZSc7XHJcbiAgY29uc3QgYnRucyA9IGRvY3VtZW50LnF1ZXJ5U2VsZWN0b3JBbGwoJyNmb3JlY2FzdC10YWJzLWJhciAuZm9yZWNhc3QtdGFiJyk7XHJcbiAgYnRucy5mb3JFYWNoKChiKSA9PiB7XHJcbiAgICBjb25zdCBhY3RpdmUgPSBiLmdldEF0dHJpYnV0ZSgnZGF0YS10YWInKSA9PT0gdGFiSWQ7XHJcbiAgICBiLnN0eWxlLmNvbG9yID0gYWN0aXZlID8gJ3ZhcigtLXRleHQtcHJpbWFyeSknIDogJ3ZhcigtLXRleHQtbXV0ZWQpJztcclxuICAgIGIuc3R5bGUuYm9yZGVyQm90dG9tQ29sb3IgPSBhY3RpdmUgPyAnIzBkOTQ4OCcgOiAndHJhbnNwYXJlbnQnO1xyXG4gICAgYi5zdHlsZS5mb250V2VpZ2h0ID0gYWN0aXZlID8gJzcwMCcgOiAnNjAwJztcclxuICB9KTtcclxuICAvLyB2MTEwNSBmaXg6IGFsIGFjdGl2YXIgbGEgdGFiIHN0YXQsIG1vc3RyYXIgcGxhY2Vob2xkZXIgaW5tZWRpYXRvIHBhcmFcclxuICAvLyBxdWUgc2UgdmVhIGFsZ28gbWllbnRyYXMgY2FyZ2EgKG8gc2kgZWwgbG9hZCB5YSB0ZXJtaW5vLCByZS1yZW5kZXIpLlxyXG4gIGlmICh0YWJJZCA9PT0gJ3N0YXQnKSB7XHJcbiAgICBjb25zdCBjb250ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2ZvcmVjYXN0LXRhYi1zdGF0Jyk7XHJcbiAgICBpZiAoY29udCkge1xyXG4gICAgICBpZiAoX2ZvcmVjYXN0U3RhdERvY3MpIHtcclxuICAgICAgICAvLyBZYSBjYXJnYWRvOiByZS1yZW5kZXIgKHBvciBzaSBlbCB1c2VyIHZpZW5lIGRlIG90cmEgdGFiKS5cclxuICAgICAgICBfcmVuZGVyRm9yZWNhc3RTdGF0VGFiKCk7XHJcbiAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgLy8gQVx1MDBGQW4gbm8gY2FyZ2FkbzogcGxhY2Vob2xkZXIgKyBsb2FkLlxyXG4gICAgICAgIGNvbnQuaW5uZXJIVE1MID1cclxuICAgICAgICAgICc8ZGl2IHN0eWxlPVwicGFkZGluZzo2MHB4IDIwcHg7dGV4dC1hbGlnbjpjZW50ZXI7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7Zm9udC1zaXplOjE0cHhcIj4nICtcclxuICAgICAgICAgICc8ZGl2IHN0eWxlPVwiZGlzcGxheTppbmxpbmUtYmxvY2s7d2lkdGg6MjRweDtoZWlnaHQ6MjRweDtib3JkZXI6M3B4IHNvbGlkICMwZDk0ODg7Ym9yZGVyLXRvcC1jb2xvcjp0cmFuc3BhcmVudDtib3JkZXItcmFkaXVzOjUwJTthbmltYXRpb246c3BpbiAwLjhzIGxpbmVhciBpbmZpbml0ZTttYXJnaW4tYm90dG9tOjEycHhcIj48L2Rpdj4nICtcclxuICAgICAgICAgICc8ZGl2PkNhcmdhbmRvIGZvcmVjYXN0X291dHB1dCBkZXNkZSBGaXJlc3RvcmUuLi48L2Rpdj4nICtcclxuICAgICAgICAgICc8c3R5bGU+QGtleWZyYW1lcyBzcGlue3Rve3RyYW5zZm9ybTpyb3RhdGUoMzYwZGVnKX19PC9zdHlsZT4nICtcclxuICAgICAgICAgICc8L2Rpdj4nO1xyXG4gICAgICAgIF9sb2FkRm9yZWNhc3RPdXRwdXQoKVxyXG4gICAgICAgICAgLnRoZW4oX3JlbmRlckZvcmVjYXN0U3RhdFRhYilcclxuICAgICAgICAgIC5jYXRjaCgoZSkgPT4ge1xyXG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKCdbRk9SRUNBU1Qgc3RhdF0gbG9hZCBmYWlsJywgZSk7XHJcbiAgICAgICAgICAgIGNvbnN0IGMgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZm9yZWNhc3QtdGFiLXN0YXQnKTtcclxuICAgICAgICAgICAgaWYgKGMpIHtcclxuICAgICAgICAgICAgICBjLmlubmVySFRNTCA9XHJcbiAgICAgICAgICAgICAgICAnPGRpdiBzdHlsZT1cInBhZGRpbmc6NjBweCAyMHB4O3RleHQtYWxpZ246Y2VudGVyO2NvbG9yOiNkYzI2MjY7bGluZS1oZWlnaHQ6MS42XCI+JyArXHJcbiAgICAgICAgICAgICAgICAnPGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxNnB4O2ZvbnQtd2VpZ2h0OjcwMDttYXJnaW4tYm90dG9tOjEycHhcIj5FcnJvciBjYXJnYW5kbyBmb3JlY2FzdF9vdXRwdXQ8L2Rpdj4nICtcclxuICAgICAgICAgICAgICAgICc8ZGl2IHN0eWxlPVwiZm9udC1zaXplOjEycHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7bWFyZ2luLWJvdHRvbToxNnB4XCI+JyArXHJcbiAgICAgICAgICAgICAgICBlc2NhcGVIdG1sU2FmZShlLm1lc3NhZ2UgfHwgU3RyaW5nKGUpKSArXHJcbiAgICAgICAgICAgICAgICAnPC9kaXY+JyArXHJcbiAgICAgICAgICAgICAgICAnPGJ1dHRvbiBvbmNsaWNrPVwic3dpdGNoRm9yZWNhc3RUYWIoXFwnc3RhdFxcJylcIiBzdHlsZT1cInBhZGRpbmc6OHB4IDE0cHg7YmFja2dyb3VuZDojMGQ5NDg4O2NvbG9yOiNmZmY7Ym9yZGVyOm5vbmU7Ym9yZGVyLXJhZGl1czo2cHg7Zm9udC13ZWlnaHQ6NzAwO2N1cnNvcjpwb2ludGVyXCI+UmVpbnRlbnRhcjwvYnV0dG9uPicgK1xyXG4gICAgICAgICAgICAgICAgJzwvZGl2Pic7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgIH0pO1xyXG4gICAgICB9XHJcbiAgICB9XHJcbiAgfVxyXG59O1xyXG5cclxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcbi8vIEZBU0UgMSBcdTIwMTQgU2FsZXMgUGxhbnMgdXBsb2FkIChSb2RzIC8gUmVlbHMgLyBGRylcclxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblxyXG5mdW5jdGlvbiBfeWVhck1vbnRoTm93KCkge1xyXG4gIGNvbnN0IGQgPSBuZXcgRGF0ZSgpO1xyXG4gIHJldHVybiBkLmdldEZ1bGxZZWFyKCkgKyAnLScgKyBTdHJpbmcoZC5nZXRNb250aCgpICsgMSkucGFkU3RhcnQoMiwgJzAnKTtcclxufVxyXG5cclxuZnVuY3Rpb24gX2ZtdFNpemUoYnl0ZXMpIHtcclxuICBpZiAoIWJ5dGVzKSByZXR1cm4gJyc7XHJcbiAgaWYgKGJ5dGVzIDwgMTAyNCkgcmV0dXJuIGJ5dGVzICsgJyBCJztcclxuICBpZiAoYnl0ZXMgPCAxMDI0ICogMTAyNCkgcmV0dXJuIChieXRlcyAvIDEwMjQpLnRvRml4ZWQoMSkgKyAnIEtCJztcclxuICByZXR1cm4gKGJ5dGVzIC8gKDEwMjQgKiAxMDI0KSkudG9GaXhlZCgyKSArICcgTUInO1xyXG59XHJcblxyXG5mdW5jdGlvbiBfZm10RGF0ZVNob3J0KGlzbykge1xyXG4gIGlmICghaXNvKSByZXR1cm4gJ1x1MjAxNCc7XHJcbiAgdHJ5IHtcclxuICAgIGNvbnN0IGQgPSBpc28udG9EYXRlID8gaXNvLnRvRGF0ZSgpIDogbmV3IERhdGUoaXNvKTtcclxuICAgIHJldHVybiAoXHJcbiAgICAgIGQudG9Mb2NhbGVEYXRlU3RyaW5nKCdlcy1BUicsIHsgZGF5OiAnMi1kaWdpdCcsIG1vbnRoOiAnc2hvcnQnLCB5ZWFyOiAnMi1kaWdpdCcgfSkgK1xyXG4gICAgICAnICcgK1xyXG4gICAgICBkLnRvTG9jYWxlVGltZVN0cmluZygnZXMtQVInLCB7IGhvdXI6ICcyLWRpZ2l0JywgbWludXRlOiAnMi1kaWdpdCcgfSlcclxuICAgICk7XHJcbiAgfSBjYXRjaCB7XHJcbiAgICByZXR1cm4gU3RyaW5nKGlzbyk7XHJcbiAgfVxyXG59XHJcblxyXG5hc3luYyBmdW5jdGlvbiBfbG9hZFNhbGVzUGxhbkNhY2hlcygpIHtcclxuICBpZiAoIXdpbmRvdy5mYkRiKSByZXR1cm47XHJcbiAgYXdhaXQgUHJvbWlzZS5hbGwoXHJcbiAgICBTQUxFU19QTEFOX0ZBTUlMSUFTLm1hcChhc3luYyAoZikgPT4ge1xyXG4gICAgICB0cnkge1xyXG4gICAgICAgIGNvbnN0IGRvYyA9IGF3YWl0IHdpbmRvdy5mYkRiLmNvbGxlY3Rpb24oJ3NhbGVzX3BsYW5fY2FjaGUnKS5kb2MoZi5rZXkpLmdldCgpO1xyXG4gICAgICAgIF9zYWxlc1BsYW5DYWNoZXNbZi5rZXldID0gZG9jLmV4aXN0cyA/IGRvYy5kYXRhKCkgOiBudWxsO1xyXG4gICAgICB9IGNhdGNoIChlKSB7XHJcbiAgICAgICAgY29uc29sZS53YXJuKCdbRk9SRUNBU1RdIGxvYWQgc2FsZXNfcGxhbl9jYWNoZS8nICsgZi5rZXkgKyAnIGZhaWw6JywgZSAmJiBlLm1lc3NhZ2UpO1xyXG4gICAgICAgIF9zYWxlc1BsYW5DYWNoZXNbZi5rZXldID0gbnVsbDtcclxuICAgICAgfVxyXG4gICAgfSlcclxuICApO1xyXG59XHJcblxyXG5mdW5jdGlvbiBfcmVuZGVyVGFibGUocm93cykge1xyXG4gIGNvbnN0IGJvZHkgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZm9yZWNhc3QtYm9keScpO1xyXG4gIGlmICghYm9keSkgcmV0dXJuO1xyXG4gIGlmICghcm93cyB8fCAhcm93cy5sZW5ndGgpIHtcclxuICAgIGJvZHkuaW5uZXJIVE1MID1cclxuICAgICAgJzxkaXYgc3R5bGU9XCJwYWRkaW5nOjYwcHggMjBweDt0ZXh0LWFsaWduOmNlbnRlcjtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKVwiPlNhbGVzIFBsYW4gdmFjaW8gbyBzaW4gZmlsYXMgdmFsaWRhcy48L2Rpdj4nO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuICBjb25zdCBmbXQgPSAobikgPT5cclxuICAgIG4gPT09IDAgfHwgIU51bWJlci5pc0Zpbml0ZShuKVxyXG4gICAgICA/ICcwJ1xyXG4gICAgICA6IE51bWJlcihuKS50b0xvY2FsZVN0cmluZygnZXMtQVInLCB7IG1heGltdW1GcmFjdGlvbkRpZ2l0czogMSB9KTtcclxuICBjb25zdCBjb2xvckZvclRvdGFsID0gKHQpID0+IHtcclxuICAgIGlmICh0ID4gMCkgcmV0dXJuICcjMTY2NTM0JzsgLy8gc29icmEgKHBlZGlzdGUgbWFzIHF1ZSBsYSBwb2xpdGljYSkgLSB2ZXJkZVxyXG4gICAgaWYgKHQgPCAwKSByZXR1cm4gJyNjMjQxMGMnOyAvLyBmYWx0YSAocGVkaXN0ZSBtZW5vcyBxdWUgbGEgcG9saXRpY2EpIC0gbmFyYW5qYSB1cmdlbnRlXHJcbiAgICByZXR1cm4gJyM0NzU1NjknO1xyXG4gIH07XHJcbiAgY29uc3Qgcm93c0h0bWwgPSByb3dzXHJcbiAgICAubWFwKFxyXG4gICAgICAocikgPT5cclxuICAgICAgICAnJyArXHJcbiAgICAgICAgJzx0cicgK1xyXG4gICAgICAgIChyLmhhc0hpc3RvcmlhID8gJycgOiAnIHN0eWxlPVwiYmFja2dyb3VuZDp2YXIoLS1jb2xvci13YXJuaW5nLWJnKVwiJykgK1xyXG4gICAgICAgICc+JyArXHJcbiAgICAgICAgJzx0ZCBzdHlsZT1cInBhZGRpbmc6NnB4IDEwcHg7Zm9udC1mYW1pbHk6bW9ub3NwYWNlO2ZvbnQtc2l6ZToxMXB4O3doaXRlLXNwYWNlOm5vd3JhcFwiPicgK1xyXG4gICAgICAgIGVzY2FwZUh0bWxTYWZlKHIuc2t1KSArXHJcbiAgICAgICAgJzwvdGQ+JyArXHJcbiAgICAgICAgJzx0ZCBzdHlsZT1cInBhZGRpbmc6NnB4IDEwcHg7Zm9udC1zaXplOjExcHhcIj4nICtcclxuICAgICAgICBlc2NhcGVIdG1sU2FmZShyLmZhbWlsaWEpICtcclxuICAgICAgICAnPC90ZD4nICtcclxuICAgICAgICAnPHRkIHN0eWxlPVwicGFkZGluZzo2cHggMTBweDtmb250LXNpemU6MTFweFwiPicgK1xyXG4gICAgICAgIGVzY2FwZUh0bWxTYWZlKHIuc3ViZmFtaWxpYSkgK1xyXG4gICAgICAgICc8L3RkPicgK1xyXG4gICAgICAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjZweCAxMHB4O3RleHQtYWxpZ246cmlnaHQ7Zm9udC12YXJpYW50LW51bWVyaWM6dGFidWxhci1udW1zXCI+JyArXHJcbiAgICAgICAgZm10KHIudmVudGFzMTJtKSArXHJcbiAgICAgICAgJzwvdGQ+JyArXHJcbiAgICAgICAgJzx0ZCBzdHlsZT1cInBhZGRpbmc6NnB4IDEwcHg7dGV4dC1hbGlnbjpyaWdodDtmb250LXZhcmlhbnQtbnVtZXJpYzp0YWJ1bGFyLW51bXM7Zm9udC13ZWlnaHQ6NjAwXCI+JyArXHJcbiAgICAgICAgZm10KHIucGVkaWRvNm0pICtcclxuICAgICAgICAnPC90ZD4nICtcclxuICAgICAgICAnPHRkIHN0eWxlPVwicGFkZGluZzo2cHggMTBweDt0ZXh0LWFsaWduOnJpZ2h0O2ZvbnQtdmFyaWFudC1udW1lcmljOnRhYnVsYXItbnVtcztjb2xvcjp2YXIoLS10ZXh0LW11dGVkKVwiPicgK1xyXG4gICAgICAgIGZtdChyLnByb21lZGlvKSArXHJcbiAgICAgICAgJzwvdGQ+JyArXHJcbiAgICAgICAgJzx0ZCBzdHlsZT1cInBhZGRpbmc6NnB4IDEwcHg7dGV4dC1hbGlnbjpyaWdodDtmb250LXZhcmlhbnQtbnVtZXJpYzp0YWJ1bGFyLW51bXNcIj4nICtcclxuICAgICAgICBmbXQoci5wb2xpdGljYSkgK1xyXG4gICAgICAgICc8L3RkPicgK1xyXG4gICAgICAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjZweCAxMHB4O3RleHQtYWxpZ246cmlnaHQ7Zm9udC12YXJpYW50LW51bWVyaWM6dGFidWxhci1udW1zO2ZvbnQtd2VpZ2h0OjcwMDtjb2xvcjonICtcclxuICAgICAgICBjb2xvckZvclRvdGFsKHIudG90YWwpICtcclxuICAgICAgICAnXCI+JyArXHJcbiAgICAgICAgZm10KHIudG90YWwpICtcclxuICAgICAgICAnPC90ZD4nICtcclxuICAgICAgICAnPC90cj4nXHJcbiAgICApXHJcbiAgICAuam9pbignJyk7XHJcbiAgY29uc3QgaGVhZGVyID1cclxuICAgICcnICtcclxuICAgICc8dGhlYWQgc3R5bGU9XCJwb3NpdGlvbjpzdGlja3k7dG9wOjA7YmFja2dyb3VuZDojMGYxNzJhO2NvbG9yOiNmZmY7ei1pbmRleDoxXCI+JyArXHJcbiAgICAnPHRyPicgK1xyXG4gICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6OHB4IDEwcHg7dGV4dC1hbGlnbjpsZWZ0O2ZvbnQtc2l6ZToxMXB4O3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtsZXR0ZXItc3BhY2luZzouNHB4XCI+U0tVPC90aD4nICtcclxuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjhweCAxMHB4O3RleHQtYWxpZ246bGVmdDtmb250LXNpemU6MTFweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7bGV0dGVyLXNwYWNpbmc6LjRweFwiPkZhbWlsaWE8L3RoPicgK1xyXG4gICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6OHB4IDEwcHg7dGV4dC1hbGlnbjpsZWZ0O2ZvbnQtc2l6ZToxMXB4O3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtsZXR0ZXItc3BhY2luZzouNHB4XCI+U3ViZmFtaWxpYTwvdGg+JyArXHJcbiAgICAnPHRoIHN0eWxlPVwicGFkZGluZzo4cHggMTBweDt0ZXh0LWFsaWduOnJpZ2h0O2ZvbnQtc2l6ZToxMXB4O3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtsZXR0ZXItc3BhY2luZzouNHB4XCIgdGl0bGU9XCJTdW1hIGRlIHF0eSBmYWN0dXJhZGEgZW4gbG9zIHVsdGltb3MgMTIgbWVzZXMgY29tcGxldG9zXCI+VmVudGFzIDEybTwvdGg+JyArXHJcbiAgICAnPHRoIHN0eWxlPVwicGFkZGluZzo4cHggMTBweDt0ZXh0LWFsaWduOnJpZ2h0O2ZvbnQtc2l6ZToxMXB4O3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtsZXR0ZXItc3BhY2luZzouNHB4XCIgdGl0bGU9XCJTdW1hIGRlIGxhcyA2IGNvbHVtbmFzIGRlbCBFeGNlbCBTYWxlcyBQbGFuXCI+UGVkaWRvIDZtPC90aD4nICtcclxuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjhweCAxMHB4O3RleHQtYWxpZ246cmlnaHQ7Zm9udC1zaXplOjExcHg7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO2xldHRlci1zcGFjaW5nOi40cHhcIiB0aXRsZT1cIlZlbnRhcyBZVEQgLyBtZXNlcyB0cmFuc2N1cnJpZG9zIGRlbCBhXHUwMEYxb1wiPlByb20gLyBNZXM8L3RoPicgK1xyXG4gICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6OHB4IDEwcHg7dGV4dC1hbGlnbjpyaWdodDtmb250LXNpemU6MTFweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7bGV0dGVyLXNwYWNpbmc6LjRweFwiIHRpdGxlPVwiUHJvbWVkaW8geCAzIG1lc2VzIChwb2xpdGljYSBkZSBpbnZlbnRhcmlvKVwiPlBvbGl0aWNhPC90aD4nICtcclxuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjhweCAxMHB4O3RleHQtYWxpZ246cmlnaHQ7Zm9udC1zaXplOjExcHg7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO2xldHRlci1zcGFjaW5nOi40cHhcIiB0aXRsZT1cIlBlZGlkbyA2bSAtIFBvbGl0aWNhLiBOZWdhdGl2byA9IHRlIGZhbHRhIHBlZGlyOyBQb3NpdGl2byA9IHNvYnJlcGVkaWRvXCI+VG90YWw8L3RoPicgK1xyXG4gICAgJzwvdHI+JyArXHJcbiAgICAnPC90aGVhZD4nO1xyXG4gIGJvZHkuaW5uZXJIVE1MID1cclxuICAgICc8dGFibGUgc3R5bGU9XCJ3aWR0aDoxMDAlO2JvcmRlci1jb2xsYXBzZTpjb2xsYXBzZTtmb250LXNpemU6MTJweFwiPicgK1xyXG4gICAgaGVhZGVyICtcclxuICAgICc8dGJvZHk+JyArXHJcbiAgICByb3dzSHRtbCArXHJcbiAgICAnPC90Ym9keT48L3RhYmxlPic7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGVzY2FwZUh0bWxTYWZlKHMpIHtcclxuICBpZiAodHlwZW9mIHdpbmRvdy5lc2NhcGVIdG1sID09PSAnZnVuY3Rpb24nKSByZXR1cm4gd2luZG93LmVzY2FwZUh0bWwocyk7XHJcbiAgcmV0dXJuIFN0cmluZyhzID09IG51bGwgPyAnJyA6IHMpLnJlcGxhY2UoXHJcbiAgICAvWyY8PlwiJ10vZyxcclxuICAgIChjaCkgPT4gKHsgJyYnOiAnJmFtcDsnLCAnPCc6ICcmbHQ7JywgJz4nOiAnJmd0OycsICdcIic6ICcmcXVvdDsnLCBcIidcIjogJyYjMzk7JyB9KVtjaF1cclxuICApO1xyXG59XHJcblxyXG5mdW5jdGlvbiBfYnVpbGRTYWxlc1BsYW5TbG90SHRtbChmKSB7XHJcbiAgY29uc3QgY2FjaGUgPSBfc2FsZXNQbGFuQ2FjaGVzW2Yua2V5XTtcclxuICBjb25zdCByb3dzQ291bnQgPSBjYWNoZSAmJiBOdW1iZXIuaXNGaW5pdGUoY2FjaGUucm93c0NvdW50KSA/IGNhY2hlLnJvd3NDb3VudCA6IDA7XHJcbiAgY29uc3QgbW9udGhzQ291bnQgPVxyXG4gICAgY2FjaGUgJiYgQXJyYXkuaXNBcnJheShjYWNoZS5kZXRlY3RlZE1vbnRocykgPyBjYWNoZS5kZXRlY3RlZE1vbnRocy5sZW5ndGggOiAwO1xyXG4gIGNvbnN0IHBhcnNlZEF0ID0gY2FjaGUgJiYgY2FjaGUucGFyc2VkQXQgPyBfZm10RGF0ZVNob3J0KGNhY2hlLnBhcnNlZEF0KSA6ICcnO1xyXG4gIGNvbnN0IHVwbG9hZGVkQnkgPSBjYWNoZSAmJiBjYWNoZS51cGxvYWRlZEJ5ID8gY2FjaGUudXBsb2FkZWRCeSA6ICcnO1xyXG4gIGNvbnN0IHNvdXJjZUZpbGVuYW1lID0gY2FjaGUgJiYgY2FjaGUuc291cmNlRmlsZW5hbWUgPyBjYWNoZS5zb3VyY2VGaWxlbmFtZSA6ICcnO1xyXG4gIGNvbnN0IHllYXJNb250aCA9IGNhY2hlICYmIGNhY2hlLnllYXJNb250aCA/IGNhY2hlLnllYXJNb250aCA6ICcnO1xyXG4gIGNvbnN0IG1vbnRoc1JhbmdlID1cclxuICAgIGNhY2hlICYmIGNhY2hlLmRldGVjdGVkTW9udGhzICYmIGNhY2hlLmRldGVjdGVkTW9udGhzLmxlbmd0aFxyXG4gICAgICA/IGNhY2hlLmRldGVjdGVkTW9udGhzWzBdICsgJyBcdTIxOTIgJyArIGNhY2hlLmRldGVjdGVkTW9udGhzW2NhY2hlLmRldGVjdGVkTW9udGhzLmxlbmd0aCAtIDFdXHJcbiAgICAgIDogJ1x1MjAxNCc7XHJcbiAgY29uc3QgaGFzQ2FjaGUgPSAhIWNhY2hlO1xyXG4gIGNvbnN0IGJhZGdlID0gaGFzQ2FjaGVcclxuICAgID8gJzxkaXYgc3R5bGU9XCJwYWRkaW5nOjRweCA4cHg7YmFja2dyb3VuZDojMTZhMzRhO2NvbG9yOiNmZmY7Ym9yZGVyLXJhZGl1czoxMnB4O2ZvbnQtc2l6ZToxMHB4O2ZvbnQtd2VpZ2h0OjcwMDtsZXR0ZXItc3BhY2luZzouNHB4XCI+Q0FSR0FETzwvZGl2PidcclxuICAgIDogJzxkaXYgc3R5bGU9XCJwYWRkaW5nOjRweCA4cHg7YmFja2dyb3VuZDojZGMyNjI2O2NvbG9yOiNmZmY7Ym9yZGVyLXJhZGl1czoxMnB4O2ZvbnQtc2l6ZToxMHB4O2ZvbnQtd2VpZ2h0OjcwMDtsZXR0ZXItc3BhY2luZzouNHB4XCI+RkFMVEE8L2Rpdj4nO1xyXG4gIGNvbnN0IG1ldGFCbG9jayA9IGhhc0NhY2hlXHJcbiAgICA/ICc8ZGl2IHN0eWxlPVwiZGlzcGxheTpncmlkO2dyaWQtdGVtcGxhdGUtY29sdW1uczphdXRvIDFmcjtnYXA6NnB4IDEycHg7Zm9udC1zaXplOjExcHg7cGFkZGluZzoxMHB4IDEycHg7YmFja2dyb3VuZDp2YXIoLS1iZy1zZWNvbmRhcnkpO2JvcmRlci1yYWRpdXM6NnB4XCI+JyArXHJcbiAgICAgICc8ZGl2IHN0eWxlPVwiY29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7Zm9udC13ZWlnaHQ6NjAwXCI+QXJjaGl2bzwvZGl2PjxkaXYgc3R5bGU9XCJjb2xvcjp2YXIoLS10ZXh0LXByaW1hcnkpO2ZvbnQtZmFtaWx5Om1vbm9zcGFjZTt3b3JkLWJyZWFrOmJyZWFrLWFsbFwiPicgK1xyXG4gICAgICBlc2NhcGVIdG1sU2FmZShzb3VyY2VGaWxlbmFtZSkgK1xyXG4gICAgICAnPC9kaXY+JyArXHJcbiAgICAgICc8ZGl2IHN0eWxlPVwiY29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7Zm9udC13ZWlnaHQ6NjAwXCI+U3ViaWRvPC9kaXY+PGRpdiBzdHlsZT1cImNvbG9yOnZhcigtLXRleHQtcHJpbWFyeSlcIj4nICtcclxuICAgICAgZXNjYXBlSHRtbFNhZmUocGFyc2VkQXQpICtcclxuICAgICAgJzwvZGl2PicgK1xyXG4gICAgICAnPGRpdiBzdHlsZT1cImNvbG9yOnZhcigtLXRleHQtbXV0ZWQpO2ZvbnQtd2VpZ2h0OjYwMFwiPlBvcjwvZGl2PjxkaXYgc3R5bGU9XCJjb2xvcjp2YXIoLS10ZXh0LXByaW1hcnkpXCI+JyArXHJcbiAgICAgIGVzY2FwZUh0bWxTYWZlKHVwbG9hZGVkQnkpICtcclxuICAgICAgJzwvZGl2PicgK1xyXG4gICAgICAnPGRpdiBzdHlsZT1cImNvbG9yOnZhcigtLXRleHQtbXV0ZWQpO2ZvbnQtd2VpZ2h0OjYwMFwiPlNuYXBzaG90PC9kaXY+PGRpdiBzdHlsZT1cImNvbG9yOnZhcigtLXRleHQtcHJpbWFyeSk7Zm9udC1mYW1pbHk6bW9ub3NwYWNlXCI+JyArXHJcbiAgICAgIGVzY2FwZUh0bWxTYWZlKHllYXJNb250aCkgK1xyXG4gICAgICAnPC9kaXY+JyArXHJcbiAgICAgICc8ZGl2IHN0eWxlPVwiY29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7Zm9udC13ZWlnaHQ6NjAwXCI+U0tVczwvZGl2PjxkaXYgc3R5bGU9XCJjb2xvcjp2YXIoLS10ZXh0LXByaW1hcnkpO2ZvbnQtd2VpZ2h0OjcwMFwiPicgK1xyXG4gICAgICByb3dzQ291bnQudG9Mb2NhbGVTdHJpbmcoJ2VzLUFSJykgK1xyXG4gICAgICAnPC9kaXY+JyArXHJcbiAgICAgICc8ZGl2IHN0eWxlPVwiY29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7Zm9udC13ZWlnaHQ6NjAwXCI+TWVzZXM8L2Rpdj48ZGl2IHN0eWxlPVwiY29sb3I6dmFyKC0tdGV4dC1wcmltYXJ5KTtmb250LXdlaWdodDo3MDBcIj4nICtcclxuICAgICAgbW9udGhzQ291bnQgK1xyXG4gICAgICAnIDxzcGFuIHN0eWxlPVwiY29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7Zm9udC13ZWlnaHQ6NDAwXCI+KCcgK1xyXG4gICAgICBlc2NhcGVIdG1sU2FmZShtb250aHNSYW5nZSkgK1xyXG4gICAgICAnKTwvc3Bhbj48L2Rpdj4nICtcclxuICAgICAgJzwvZGl2PidcclxuICAgIDogJzxkaXYgc3R5bGU9XCJwYWRkaW5nOjE0cHg7dGV4dC1hbGlnbjpjZW50ZXI7Zm9udC1zaXplOjEycHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7YmFja2dyb3VuZDp2YXIoLS1iZy1zZWNvbmRhcnkpO2JvcmRlci1yYWRpdXM6NnB4O2JvcmRlcjoxcHggZGFzaGVkIHZhcigtLWJvcmRlci1zdWJ0bGUpXCI+QXVuIG5vIHN1YmlzdGUgZWwgU2FsZXMgUGxhbiBkZSBlc3RhIGZhbWlsaWEuPC9kaXY+JztcclxuICBjb25zdCB1cGxvYWRCdG4gPVxyXG4gICAgJzxsYWJlbCBzdHlsZT1cImRpc3BsYXk6aW5saW5lLWZsZXg7YWxpZ24taXRlbXM6Y2VudGVyO2p1c3RpZnktY29udGVudDpjZW50ZXI7Z2FwOjhweDtwYWRkaW5nOjEwcHggMTRweDtiYWNrZ3JvdW5kOicgK1xyXG4gICAgZi5jb2xvciArXHJcbiAgICAnO2NvbG9yOiNmZmY7Ym9yZGVyLXJhZGl1czo2cHg7Zm9udC13ZWlnaHQ6NzAwO2ZvbnQtc2l6ZToxMnB4O2N1cnNvcjpwb2ludGVyO2xldHRlci1zcGFjaW5nOi40cHhcIj4nICtcclxuICAgICc8c3Bhbj4nICtcclxuICAgIChoYXNDYWNoZSA/ICdcdTIxQkIgUmVlbXBsYXphciBFeGNlbCcgOiAnXHUyQjA2IENhcmdhciBFeGNlbCcpICtcclxuICAgICc8L3NwYW4+JyArXHJcbiAgICAnPGlucHV0IHR5cGU9XCJmaWxlXCIgYWNjZXB0PVwiLnhsc3gsLnhsc1wiIGRhdGEtZmFtaWxpYT1cIicgK1xyXG4gICAgZi5rZXkgK1xyXG4gICAgJ1wiIHN0eWxlPVwiZGlzcGxheTpub25lXCIgb25jaGFuZ2U9XCJvblNhbGVzUGxhbkZpbGVGb3JGYW1pbGlhKGV2ZW50LCBcXCcnICtcclxuICAgIGYua2V5ICtcclxuICAgICdcXCcpXCIvPicgK1xyXG4gICAgJzwvbGFiZWw+JztcclxuICBjb25zdCBjYXJkSGVhZCA9XHJcbiAgICAnPGRpdiBzdHlsZT1cImRpc3BsYXk6ZmxleDthbGlnbi1pdGVtczpjZW50ZXI7Z2FwOjEwcHhcIj4nICtcclxuICAgICc8ZGl2IHN0eWxlPVwid2lkdGg6MTJweDtoZWlnaHQ6MzJweDtiYWNrZ3JvdW5kOicgK1xyXG4gICAgZi5jb2xvciArXHJcbiAgICAnO2JvcmRlci1yYWRpdXM6M3B4XCI+PC9kaXY+JyArXHJcbiAgICAnPGRpdiBzdHlsZT1cImZsZXg6MVwiPjxkaXYgc3R5bGU9XCJmb250LXNpemU6MTRweDtmb250LXdlaWdodDo4MDA7Y29sb3I6dmFyKC0tdGV4dC1wcmltYXJ5KVwiPicgK1xyXG4gICAgZXNjYXBlSHRtbFNhZmUoZi5sYWJlbCkgK1xyXG4gICAgJzwvZGl2PicgK1xyXG4gICAgJzxkaXYgc3R5bGU9XCJmb250LXNpemU6MTFweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTttYXJnaW4tdG9wOjJweFwiPlNhbGVzIFBsYW4gbWVuc3VhbCBcdTAwQjcgSG9qYSBTQVI8L2Rpdj48L2Rpdj4nICtcclxuICAgIGJhZGdlICtcclxuICAgICc8L2Rpdj4nO1xyXG4gIHJldHVybiAoXHJcbiAgICAnPGRpdiBzdHlsZT1cImJhY2tncm91bmQ6dmFyKC0tYmctZWxldmF0ZWQpO2JvcmRlcjoxcHggc29saWQgdmFyKC0tYm9yZGVyLXN1YnRsZSk7Ym9yZGVyLXJhZGl1czoxMHB4O3BhZGRpbmc6MTZweDtkaXNwbGF5OmZsZXg7ZmxleC1kaXJlY3Rpb246Y29sdW1uO2dhcDoxMnB4XCI+JyArXHJcbiAgICBjYXJkSGVhZCArXHJcbiAgICBtZXRhQmxvY2sgK1xyXG4gICAgdXBsb2FkQnRuICtcclxuICAgICc8ZGl2IGlkPVwic2FsZXMtcGxhbi1zdGF0dXMtJyArXHJcbiAgICBmLmtleSArXHJcbiAgICAnXCIgc3R5bGU9XCJmb250LXNpemU6MTFweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTttaW4taGVpZ2h0OjE0cHhcIj48L2Rpdj4nICtcclxuICAgICc8L2Rpdj4nXHJcbiAgKTtcclxufVxyXG5cclxuZnVuY3Rpb24gX3JlbmRlclNhbGVzUGxhbnNUYWIoKSB7XHJcbiAgY29uc3QgY29udCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdmb3JlY2FzdC10YWItc2FsZXMtcGxhbnMnKTtcclxuICBpZiAoIWNvbnQpIHJldHVybjtcclxuICBjb25zdCBzbG90cyA9IFNBTEVTX1BMQU5fRkFNSUxJQVMubWFwKF9idWlsZFNhbGVzUGxhblNsb3RIdG1sKS5qb2luKCcnKTtcclxuICBjb25zdCBpbnRybyA9XHJcbiAgICAnPGRpdiBzdHlsZT1cIm1hcmdpbi1ib3R0b206MTZweDtwYWRkaW5nOjEycHggMTRweDtiYWNrZ3JvdW5kOnZhcigtLWJnLXNlY29uZGFyeSk7Ym9yZGVyLWxlZnQ6M3B4IHNvbGlkICMwZDk0ODg7Ym9yZGVyLXJhZGl1czo2cHg7Zm9udC1zaXplOjEycHg7Y29sb3I6dmFyKC0tdGV4dC1zZWNvbmRhcnkpO2xpbmUtaGVpZ2h0OjEuNVwiPicgK1xyXG4gICAgJzxiIHN0eWxlPVwiY29sb3I6dmFyKC0tdGV4dC1wcmltYXJ5KVwiPkZhc2UgMTwvYj4gXHUyMDE0IENhcmdcdTAwRTEgbG9zIDMgU2FsZXMgUGxhbnMgbWVuc3VhbGVzIChSb2RzIC8gUmVlbHMgLyBGRykuIFNlIHBhcnNlYSBsYSBob2phIDxiPlNBUjwvYj46IFNLVSwgTU9RIDEyIG1vbnRocywgeSB1bmEgY29sdW1uYSBwb3IgbWVzLiAnICtcclxuICAgICdFbCBFeGNlbCBvcmlnaW5hbCBxdWVkYSBzbmFwc2hvdGFkbyBlbiBTdG9yYWdlIHkgZWwgcGFyc2VvIHF1ZWRhIGVuIEZpcmVzdG9yZSBwYXJhIGVsIGNcdTAwRTFsY3VsbyAocHJcdTAwRjN4aW1hIGZhc2UpLicgK1xyXG4gICAgJzwvZGl2Pic7XHJcbiAgY29uc3QgZ3JpZCA9XHJcbiAgICAnPGRpdiBzdHlsZT1cImRpc3BsYXk6Z3JpZDtncmlkLXRlbXBsYXRlLWNvbHVtbnM6cmVwZWF0KGF1dG8tZml0LG1pbm1heCgzMjBweCwxZnIpKTtnYXA6MTZweFwiPicgK1xyXG4gICAgc2xvdHMgK1xyXG4gICAgJzwvZGl2Pic7XHJcbiAgY29udC5pbm5lckhUTUwgPSAnPGRpdiBzdHlsZT1cInBhZGRpbmc6MThweFwiPicgKyBpbnRybyArIGdyaWQgKyAnPC9kaXY+JztcclxufVxyXG5cclxud2luZG93Lm9uU2FsZXNQbGFuRmlsZUZvckZhbWlsaWEgPSBhc3luYyBmdW5jdGlvbiAoZXZlbnQsIGZhbWlsaWEpIHtcclxuICBjb25zdCBmaWxlID0gZXZlbnQgJiYgZXZlbnQudGFyZ2V0ICYmIGV2ZW50LnRhcmdldC5maWxlcyAmJiBldmVudC50YXJnZXQuZmlsZXNbMF07XHJcbiAgaWYgKCFmaWxlKSByZXR1cm47XHJcbiAgY29uc3Qgc3RhdHVzRWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnc2FsZXMtcGxhbi1zdGF0dXMtJyArIGZhbWlsaWEpO1xyXG4gIGNvbnN0IHNldFN0YXR1cyA9IChtc2csIGNvbG9yKSA9PiB7XHJcbiAgICBpZiAoIXN0YXR1c0VsKSByZXR1cm47XHJcbiAgICBzdGF0dXNFbC50ZXh0Q29udGVudCA9IG1zZztcclxuICAgIHN0YXR1c0VsLnN0eWxlLmNvbG9yID0gY29sb3IgfHwgJ3ZhcigtLXRleHQtbXV0ZWQpJztcclxuICB9O1xyXG4gIHRyeSB7XHJcbiAgICBpZiAodHlwZW9mIFhMU1ggPT09ICd1bmRlZmluZWQnKSB7XHJcbiAgICAgIGFsZXJ0KCdTaGVldEpTIChYTFNYKSBubyBjYXJnYWRvIFx1MjAxNCByZWNhcmdcdTAwRTEgbGEgYXBwLicpO1xyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcbiAgICBpZiAoIXdpbmRvdy5TYWxlc1BsYW5QYXJzZXIgfHwgIXdpbmRvdy5TYWxlc1BsYW5QYXJzZXIucGFyc2VTYWxlc1BsYW5TaGVldCkge1xyXG4gICAgICBhbGVydCgnUGFyc2VyIFNhbGVzIFBsYW4gbm8gY2FyZ2Fkby4gUmVidWlsZCBidW5kbGUuJyk7XHJcbiAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIGlmICghd2luZG93LmZpcmViYXNlIHx8ICF3aW5kb3cuZmlyZWJhc2Uuc3RvcmFnZSkge1xyXG4gICAgICBhbGVydCgnRmlyZWJhc2UgU3RvcmFnZSBubyBkaXNwb25pYmxlLicpO1xyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcbiAgICBzZXRTdGF0dXMoJ0xleWVuZG8gRXhjZWxcdTIwMjYnKTtcclxuICAgIGNvbnN0IGJ1ZiA9IGF3YWl0IGZpbGUuYXJyYXlCdWZmZXIoKTtcclxuICAgIGNvbnN0IHdiID0gWExTWC5yZWFkKGJ1ZiwgeyB0eXBlOiAnYXJyYXknIH0pO1xyXG4gICAgY29uc3Qgc2FyTmFtZSA9IHdiLlNoZWV0TmFtZXMuZmluZChcclxuICAgICAgKG4pID0+XHJcbiAgICAgICAgU3RyaW5nKG4gfHwgJycpXHJcbiAgICAgICAgICAudHJpbSgpXHJcbiAgICAgICAgICAudG9VcHBlckNhc2UoKSA9PT0gJ1NBUidcclxuICAgICk7XHJcbiAgICBpZiAoIXNhck5hbWUpIHtcclxuICAgICAgc2V0U3RhdHVzKFxyXG4gICAgICAgICdcdTI2QTAgRWwgRXhjZWwgbm8gdGllbmUgaG9qYSBcIlNBUlwiLiBIb2phcyBlbmNvbnRyYWRhczogJyArIHdiLlNoZWV0TmFtZXMuam9pbignLCAnKSxcclxuICAgICAgICAnI2RjMjYyNidcclxuICAgICAgKTtcclxuICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG4gICAgY29uc3Qgc2hlZXQgPSB3Yi5TaGVldHNbc2FyTmFtZV07XHJcbiAgICBjb25zdCByb3dzID0gWExTWC51dGlscy5zaGVldF90b19qc29uKHNoZWV0LCB7IGhlYWRlcjogMSwgZGVmdmFsOiAnJywgcmF3OiB0cnVlIH0pO1xyXG4gICAgc2V0U3RhdHVzKCdQYXJzZWFuZG8gJyArIHJvd3MubGVuZ3RoICsgJyBmaWxhcyBkZSBob2phIFwiJyArIHNhck5hbWUgKyAnXCJcdTIwMjYnKTtcclxuICAgIGNvbnN0IHBhcnNlZCA9IHdpbmRvdy5TYWxlc1BsYW5QYXJzZXIucGFyc2VTYWxlc1BsYW5TaGVldChyb3dzKTtcclxuICAgIGlmICghcGFyc2VkLnJvd3MubGVuZ3RoKSB7XHJcbiAgICAgIHNldFN0YXR1cygnXHUyNkEwIEV4Y2VsIHBhcnNlYWRvIHBlcm8gc2luIFNLVXMgdlx1MDBFMWxpZG9zLicsICcjZGMyNjI2Jyk7XHJcbiAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIGNvbnN0IHllYXJNb250aCA9IF95ZWFyTW9udGhOb3coKTtcclxuICAgIGNvbnN0IHN0b3JhZ2VQYXRoID0gJ2ZvcmVjYXN0c19zbmFwc2hvdHMvJyArIHllYXJNb250aCArICcvJyArIGZhbWlsaWEgKyAnLnhsc3gnO1xyXG4gICAgc2V0U3RhdHVzKCdTdWJpZW5kbyBFeGNlbCBhIFN0b3JhZ2UgKCcgKyBfZm10U2l6ZShmaWxlLnNpemUpICsgJylcdTIwMjYnKTtcclxuICAgIGNvbnN0IHN0b3JhZ2VSZWYgPSB3aW5kb3cuZmlyZWJhc2Uuc3RvcmFnZSgpLnJlZihzdG9yYWdlUGF0aCk7XHJcbiAgICBhd2FpdCBzdG9yYWdlUmVmLnB1dChmaWxlLCB7XHJcbiAgICAgIGNvbnRlbnRUeXBlOiBmaWxlLnR5cGUgfHwgJ2FwcGxpY2F0aW9uL3ZuZC5vcGVueG1sZm9ybWF0cy1vZmZpY2Vkb2N1bWVudC5zcHJlYWRzaGVldG1sLnNoZWV0JyxcclxuICAgICAgY3VzdG9tTWV0YWRhdGE6IHtcclxuICAgICAgICBmYW1pbGlhLFxyXG4gICAgICAgIHVwbG9hZGVkQnk6ICh3aW5kb3cuY3VycmVudFVzZXIgJiYgd2luZG93LmN1cnJlbnRVc2VyLmVtYWlsKSB8fCAnJyxcclxuICAgICAgICBzb3VyY2VGaWxlbmFtZTogZmlsZS5uYW1lIHx8ICcnLFxyXG4gICAgICB9LFxyXG4gICAgfSk7XHJcbiAgICBzZXRTdGF0dXMoJ0d1YXJkYW5kbyBwYXJzZW8gZW4gRmlyZXN0b3JlICgnICsgcGFyc2VkLnJvd3MubGVuZ3RoICsgJyBTS1VzKVx1MjAyNicpO1xyXG4gICAgY29uc3QgdXBsb2FkZWRCeSA9ICh3aW5kb3cuY3VycmVudFVzZXIgJiYgd2luZG93LmN1cnJlbnRVc2VyLmVtYWlsKSB8fCAndW5rbm93bic7XHJcbiAgICBjb25zdCBwYXlsb2FkID0ge1xyXG4gICAgICBmYW1pbGlhLFxyXG4gICAgICBwYXJzZWRBdDpcclxuICAgICAgICB3aW5kb3cuZmlyZWJhc2UgJiYgd2luZG93LmZpcmViYXNlLmZpcmVzdG9yZSAmJiB3aW5kb3cuZmlyZWJhc2UuZmlyZXN0b3JlLkZpZWxkVmFsdWVcclxuICAgICAgICAgID8gd2luZG93LmZpcmViYXNlLmZpcmVzdG9yZS5GaWVsZFZhbHVlLnNlcnZlclRpbWVzdGFtcCgpXHJcbiAgICAgICAgICA6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcclxuICAgICAgdXBsb2FkZWRCeSxcclxuICAgICAgc291cmNlRmlsZW5hbWU6IGZpbGUubmFtZSB8fCAnJyxcclxuICAgICAgc291cmNlU2hlZXQ6IHNhck5hbWUsXHJcbiAgICAgIHllYXJNb250aCxcclxuICAgICAgc3RvcmFnZVBhdGgsXHJcbiAgICAgIHJvd3NDb3VudDogcGFyc2VkLnJvd3MubGVuZ3RoLFxyXG4gICAgICBoZWFkZXJSb3dJbmRleDogcGFyc2VkLmhlYWRlclJvd0luZGV4LFxyXG4gICAgICBkZXRlY3RlZE1vbnRoczogcGFyc2VkLmRldGVjdGVkTW9udGhzLFxyXG4gICAgICByb3dzOiBwYXJzZWQucm93cyxcclxuICAgIH07XHJcbiAgICBhd2FpdCB3aW5kb3cuZmJEYi5jb2xsZWN0aW9uKCdzYWxlc19wbGFuX2NhY2hlJykuZG9jKGZhbWlsaWEpLnNldChwYXlsb2FkKTtcclxuICAgIC8vIHYxMTA3IGZpeDogZ3VhcmRhciBjYWNoZSBsb2NhbCBjb24gRGF0ZSByZWFsIChubyBlbCBTZW50aW5lbFZhbHVlKSBwYXJhXHJcbiAgICAvLyBxdWUgX2ZtdERhdGVTaG9ydCBubyBtdWVzdHJlIFwiSW52YWxpZCBEYXRlXCIuIEVsIHNlcnZlciB0aWVuZSBlbCB0cyBleGFjdG8sXHJcbiAgICAvLyBlbCBsb2NhbCBtdWVzdHJhIGVsIG1vbWVudG8gZGVsIHVwbG9hZCAoYXByb3hpbWFkbyB+MXMgZGUgZGlmZXJlbmNpYSkuXHJcbiAgICBfc2FsZXNQbGFuQ2FjaGVzW2ZhbWlsaWFdID0gT2JqZWN0LmFzc2lnbih7fSwgcGF5bG9hZCwgeyBwYXJzZWRBdDogbmV3IERhdGUoKSB9KTtcclxuICAgIHNldFN0YXR1cyhcclxuICAgICAgJ1x1MjcxMyBPSy4gJyArIHBhcnNlZC5yb3dzLmxlbmd0aCArICcgU0tVcyBcdTAwRDcgJyArIHBhcnNlZC5kZXRlY3RlZE1vbnRocy5sZW5ndGggKyAnIG1lc2VzLicsXHJcbiAgICAgICcjMTZhMzRhJ1xyXG4gICAgKTtcclxuICAgIF9yZW5kZXJTYWxlc1BsYW5zVGFiKCk7XHJcbiAgfSBjYXRjaCAoZSkge1xyXG4gICAgY29uc29sZS5lcnJvcignW0ZPUkVDQVNUXSB1cGxvYWQgc2FsZXMgcGxhbiAnICsgZmFtaWxpYSArICcgZmFpbDonLCBlKTtcclxuICAgIHNldFN0YXR1cygnXHUyNzE3IEVycm9yOiAnICsgKChlICYmIGUubWVzc2FnZSkgfHwgZSksICcjZGMyNjI2Jyk7XHJcbiAgICBpZiAoZSAmJiBlLmNvZGUgPT09ICdNT05USFNfTk9UX0ZPVU5EJykge1xyXG4gICAgICBhbGVydChcclxuICAgICAgICAnRWwgRXhjZWwgbm8gdGllbmUgY29sdW1uYXMgZGUgbWVzZXMgcmVjb25vY2libGVzLlxcblxcbkhlYWRlcnMgZXNwZXJhZG9zOiBcIkphbiAyMDI3XCIsIFwiTWF5IDIwMjdcIiwgXCJFbmUgMjAyN1wiLCBcIjIwMjctMDFcIiwgZXRjLlxcblxcbkRldGFsbGU6ICcgK1xyXG4gICAgICAgICAgZS5tZXNzYWdlXHJcbiAgICAgICk7XHJcbiAgICB9XHJcbiAgfSBmaW5hbGx5IHtcclxuICAgIGlmIChldmVudCAmJiBldmVudC50YXJnZXQpIGV2ZW50LnRhcmdldC52YWx1ZSA9ICcnO1xyXG4gIH1cclxufTtcclxuXHJcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG4vLyBGMkIgXHUyMDE0IEZvcmVjYXN0IEVzdGFkXHUwMEVEc3RpY286IHRhYmxhICsgZGV0YWxsZVxyXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHJcbmFzeW5jIGZ1bmN0aW9uIF9sb2FkRm9yZWNhc3RPdXRwdXQoKSB7XHJcbiAgaWYgKCF3aW5kb3cuZmJEYikgdGhyb3cgbmV3IEVycm9yKCdGaXJlc3RvcmUgbm8gaW5pY2lhbGl6YWRvJyk7XHJcbiAgY29uc29sZS5sb2coJ1tGT1JFQ0FTVCBzdGF0XSBsb2FkaW5nIGZvcmVjYXN0X291dHB1dC4uLicpO1xyXG4gIGNvbnN0IFtzbmFwLCBtZXRhRG9jXSA9IGF3YWl0IFByb21pc2UuYWxsKFtcclxuICAgIHdpbmRvdy5mYkRiLmNvbGxlY3Rpb24oJ2ZvcmVjYXN0X291dHB1dCcpLmdldCgpLFxyXG4gICAgd2luZG93LmZiRGIuY29sbGVjdGlvbignZm9yZWNhc3Rfb3V0cHV0X21ldGEnKS5kb2MoJ2N1cnJlbnQnKS5nZXQoKSxcclxuICBdKTtcclxuICBjb25zdCBkb2NzID0gW107XHJcbiAgc25hcC5mb3JFYWNoKChkKSA9PiBkb2NzLnB1c2goT2JqZWN0LmFzc2lnbih7IGlkOiBkLmlkIH0sIGQuZGF0YSgpKSkpO1xyXG4gIGRvY3Muc29ydCgoYSwgYikgPT4ge1xyXG4gICAgY29uc3Qgd2EgPSAoYS5tZXRyaWNzICYmIGEubWV0cmljcy53YXBlKSB8fCA5OTk7XHJcbiAgICBjb25zdCB3YiA9IChiLm1ldHJpY3MgJiYgYi5tZXRyaWNzLndhcGUpIHx8IDk5OTtcclxuICAgIHJldHVybiB3YSAtIHdiO1xyXG4gIH0pO1xyXG4gIF9mb3JlY2FzdFN0YXREb2NzID0gZG9jcztcclxuICBfZm9yZWNhc3RTdGF0TWV0YSA9IG1ldGFEb2MuZXhpc3RzID8gbWV0YURvYy5kYXRhKCkgOiBudWxsO1xyXG4gIGNvbnNvbGUubG9nKCdbRk9SRUNBU1Qgc3RhdF0gbG9hZGVkJywgZG9jcy5sZW5ndGgsICdkb2NzIFx1MDBCNyBtZXRhOicsICEhX2ZvcmVjYXN0U3RhdE1ldGEpO1xyXG4gIHJldHVybiBkb2NzO1xyXG59XHJcblxyXG5mdW5jdGlvbiBfd2FwZUJhZGdlQ29sb3Iodykge1xyXG4gIGlmICh3ID09IG51bGwpIHJldHVybiAnIzY0NzQ4Yic7XHJcbiAgaWYgKHcgPCAwLjMpIHJldHVybiAnIzE2YTM0YSc7IC8vIHZlcmRlIC0gZXhjZWxlbnRlXHJcbiAgaWYgKHcgPCAwLjUpIHJldHVybiAnIzg0Y2MxNic7IC8vIGxpbWEgLSBidWVub1xyXG4gIGlmICh3IDwgMC43KSByZXR1cm4gJyNlYWIzMDgnOyAvLyBhbWFyaWxsbyAtIGFjZXB0YWJsZVxyXG4gIGlmICh3IDwgMS4wKSByZXR1cm4gJyNmOTczMTYnOyAvLyBuYXJhbmphIC0gcG9icmVcclxuICByZXR1cm4gJyNkYzI2MjYnOyAvLyByb2pvIC0gbXV5IHBvYnJlXHJcbn1cclxuXHJcbmZ1bmN0aW9uIF9mbXROdW0obikge1xyXG4gIGlmIChuID09IG51bGwgfHwgIU51bWJlci5pc0Zpbml0ZShOdW1iZXIobikpKSByZXR1cm4gJ1x1MjAxNCc7XHJcbiAgcmV0dXJuIE51bWJlcihuKS50b0xvY2FsZVN0cmluZygnZXMtQVInLCB7IG1heGltdW1GcmFjdGlvbkRpZ2l0czogMCB9KTtcclxufVxyXG5cclxuZnVuY3Rpb24gX2ZtdFdhcGUodykge1xyXG4gIGlmICh3ID09IG51bGwgfHwgIU51bWJlci5pc0Zpbml0ZShOdW1iZXIodykpKSByZXR1cm4gJ1x1MjAxNCc7XHJcbiAgcmV0dXJuIChOdW1iZXIodykgKiAxMDApLnRvRml4ZWQoMCkgKyAnJSc7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIF9mbXREc1Nob3J0KGlzbykge1xyXG4gIC8vICcyMDI2LTEwLTAxJyAtPiAnb2N0IDI2J1xyXG4gIHRyeSB7XHJcbiAgICBjb25zdCBbeSwgbV0gPSBpc28uc3BsaXQoJy0nKS5tYXAoTnVtYmVyKTtcclxuICAgIGNvbnN0IG5hbWVzID0gW1xyXG4gICAgICAnZW5lJyxcclxuICAgICAgJ2ZlYicsXHJcbiAgICAgICdtYXInLFxyXG4gICAgICAnYWJyJyxcclxuICAgICAgJ21heScsXHJcbiAgICAgICdqdW4nLFxyXG4gICAgICAnanVsJyxcclxuICAgICAgJ2FnbycsXHJcbiAgICAgICdzZXAnLFxyXG4gICAgICAnb2N0JyxcclxuICAgICAgJ25vdicsXHJcbiAgICAgICdkaWMnLFxyXG4gICAgXTtcclxuICAgIHJldHVybiBuYW1lc1ttIC0gMV0gKyAnICcgKyBTdHJpbmcoeSkuc2xpY2UoLTIpO1xyXG4gIH0gY2F0Y2gge1xyXG4gICAgcmV0dXJuIGlzbztcclxuICB9XHJcbn1cclxuXHJcbmZ1bmN0aW9uIF9yZW5kZXJGb3JlY2FzdFN0YXRUYWIoKSB7XHJcbiAgY29uc3QgY29udCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdmb3JlY2FzdC10YWItc3RhdCcpO1xyXG4gIGlmICghY29udCkgcmV0dXJuO1xyXG4gIHRyeSB7XHJcbiAgICBfcmVuZGVyRm9yZWNhc3RTdGF0VGFiSW1wbChjb250KTtcclxuICB9IGNhdGNoIChlKSB7XHJcbiAgICBjb25zb2xlLmVycm9yKCdbRk9SRUNBU1Qgc3RhdF0gcmVuZGVyIGZhaWwnLCBlKTtcclxuICAgIGNvbnQuaW5uZXJIVE1MID1cclxuICAgICAgJzxkaXYgc3R5bGU9XCJwYWRkaW5nOjQwcHggMjBweDtjb2xvcjojZGMyNjI2O2xpbmUtaGVpZ2h0OjEuNlwiPicgK1xyXG4gICAgICAnPGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxNnB4O2ZvbnQtd2VpZ2h0OjcwMDttYXJnaW4tYm90dG9tOjEwcHhcIj5FcnJvciByZW5kZXJpemFuZG8gdGFiIEZvcmVjYXN0IEVzdGFkXHUwMEVEc3RpY288L2Rpdj4nICtcclxuICAgICAgJzxwcmUgc3R5bGU9XCJmb250LXNpemU6MTFweDtiYWNrZ3JvdW5kOiNmZWYyZjI7cGFkZGluZzoxMnB4O2JvcmRlci1yYWRpdXM6NnB4O292ZXJmbG93OmF1dG87d2hpdGUtc3BhY2U6cHJlLXdyYXBcIj4nICtcclxuICAgICAgZXNjYXBlSHRtbFNhZmUoZS5zdGFjayB8fCBlLm1lc3NhZ2UgfHwgU3RyaW5nKGUpKSArXHJcbiAgICAgICc8L3ByZT48L2Rpdj4nO1xyXG4gIH1cclxufVxyXG5cclxuZnVuY3Rpb24gX3JlbmRlckZvcmVjYXN0U3RhdFRhYkltcGwoY29udCkge1xyXG4gIGNvbnN0IGRvY3MgPSBfZm9yZWNhc3RTdGF0RG9jcyB8fCBbXTtcclxuICBjb25zdCBtZXRhID0gX2ZvcmVjYXN0U3RhdE1ldGEgfHwge307XHJcbiAgY29uc3QgcmVzdW1lbiA9IG1ldGEucmVzdW1lbiB8fCB7fTtcclxuICBjb25zb2xlLmxvZygnW0ZPUkVDQVNUIHN0YXRdIHJlbmRlciBcdTIwMTQgZG9jczonLCBkb2NzLmxlbmd0aCwgJ21ldGE6JywgISFtZXRhLmdlbmVyYXRlZEF0KTtcclxuICBpZiAoIWRvY3MubGVuZ3RoKSB7XHJcbiAgICBjb250LmlubmVySFRNTCA9XHJcbiAgICAgICc8ZGl2IHN0eWxlPVwicGFkZGluZzo2MHB4IDIwcHg7dGV4dC1hbGlnbjpjZW50ZXI7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZClcIj4nICtcclxuICAgICAgJ05vIGhheSBmb3JlY2FzdF9vdXRwdXQgcHVibGljYWRvLjxicj48YnI+JyArXHJcbiAgICAgICdDb3JyZXIgPGNvZGU+cHl0aG9uIHNjcmlwdHMvZm9yZWNhc3QvdHJhaW5fcHJvZC5weSAmJiBweXRob24gc2NyaXB0cy9mb3JlY2FzdC9wdWJsaXNoX3RvX2ZpcmVzdG9yZS5weTwvY29kZT4uJyArXHJcbiAgICAgICc8L2Rpdj4nO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuICAvLyBNZXNlcyBkZWwgZm9yZWNhc3QgKGRzIGRlbCBwcmltZXIgZG9jLCBzZSBhc3VtZSBpZ3VhbCBlbiB0b2RvcykuXHJcbiAgY29uc3QgbW9udGhzSXNvID0gKGRvY3NbMF0uZm9yZWNhc3QgfHwgW10pLm1hcCgoZikgPT4gZi5kcyk7XHJcbiAgY29uc3QgbW9udGhIZWFkZXJzID0gbW9udGhzSXNvLm1hcChfZm10RHNTaG9ydCk7XHJcblxyXG4gIC8vIE1ldHJpY3MgY2hpcCBnbG9iYWxcclxuICBjb25zdCBnZW5lcmF0ZWQgPSBtZXRhLmdlbmVyYXRlZEF0XHJcbiAgICA/IG5ldyBEYXRlKG1ldGEuZ2VuZXJhdGVkQXQpLnRvTG9jYWxlU3RyaW5nKCdlcy1BUicsIHtcclxuICAgICAgICBkYXk6ICcyLWRpZ2l0JyxcclxuICAgICAgICBtb250aDogJ3Nob3J0JyxcclxuICAgICAgICB5ZWFyOiAnMi1kaWdpdCcsXHJcbiAgICAgICAgaG91cjogJzItZGlnaXQnLFxyXG4gICAgICAgIG1pbnV0ZTogJzItZGlnaXQnLFxyXG4gICAgICB9KVxyXG4gICAgOiAnXHUyMDE0JztcclxuICBjb25zdCB3YXBlTWVkID1cclxuICAgIHJlc3VtZW4ud2FwZV9tZWRpYW5vX2Jlc3RfcGVyX3NlcmllcyAhPSBudWxsXHJcbiAgICAgID8gX2ZtdFdhcGUocmVzdW1lbi53YXBlX21lZGlhbm9fYmVzdF9wZXJfc2VyaWVzKVxyXG4gICAgICA6ICdcdTIwMTQnO1xyXG4gIGNvbnN0IG5TdWJzID0gcmVzdW1lbi5uX3N1YmZhbWlsaWFzIHx8IGRvY3MubGVuZ3RoO1xyXG4gIGNvbnN0IG5MdDA1ID1cclxuICAgIHJlc3VtZW4ubl9zZXJpZXNfd2FwZV9sdF8wXzUgIT0gbnVsbCA/IHJlc3VtZW4ubl9zZXJpZXNfd2FwZV9sdF8wXzUgKyAnLycgKyBuU3VicyA6ICdcdTIwMTQnO1xyXG4gIGNvbnN0IG5MdDAzID1cclxuICAgIHJlc3VtZW4ubl9zZXJpZXNfd2FwZV9sdF8wXzMgIT0gbnVsbCA/IHJlc3VtZW4ubl9zZXJpZXNfd2FwZV9sdF8wXzMgKyAnLycgKyBuU3VicyA6ICdcdTIwMTQnO1xyXG5cclxuICBjb25zdCBiYW5uZXIgPVxyXG4gICAgJzxkaXYgc3R5bGU9XCJtYXJnaW4tYm90dG9tOjE0cHg7cGFkZGluZzoxMnB4IDE0cHg7YmFja2dyb3VuZDp2YXIoLS1iZy1zZWNvbmRhcnkpO2JvcmRlci1sZWZ0OjNweCBzb2xpZCAjMGQ5NDg4O2JvcmRlci1yYWRpdXM6NnB4O2ZvbnQtc2l6ZToxMnB4O2NvbG9yOnZhcigtLXRleHQtc2Vjb25kYXJ5KTtsaW5lLWhlaWdodDoxLjU7ZGlzcGxheTpncmlkO2dyaWQtdGVtcGxhdGUtY29sdW1uczpyZXBlYXQoYXV0by1maXQsbWlubWF4KDE2MHB4LDFmcikpO2dhcDoxMHB4XCI+JyArXHJcbiAgICAnPGRpdj48ZGl2IHN0eWxlPVwiZm9udC1zaXplOjEwcHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO2xldHRlci1zcGFjaW5nOi40cHhcIj5XQVBFIG1lZGlhbm88L2Rpdj48ZGl2IHN0eWxlPVwiZm9udC1zaXplOjIwcHg7Zm9udC13ZWlnaHQ6ODAwO2NvbG9yOnZhcigtLXRleHQtcHJpbWFyeSlcIj4nICtcclxuICAgIHdhcGVNZWQgK1xyXG4gICAgJzwvZGl2PjwvZGl2PicgK1xyXG4gICAgJzxkaXY+PGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMHB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtsZXR0ZXItc3BhY2luZzouNHB4XCI+U3ViZmFtaWxpYXM8L2Rpdj48ZGl2IHN0eWxlPVwiZm9udC1zaXplOjIwcHg7Zm9udC13ZWlnaHQ6ODAwO2NvbG9yOnZhcigtLXRleHQtcHJpbWFyeSlcIj4nICtcclxuICAgIG5TdWJzICtcclxuICAgICc8L2Rpdj48L2Rpdj4nICtcclxuICAgICc8ZGl2PjxkaXYgc3R5bGU9XCJmb250LXNpemU6MTBweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7bGV0dGVyLXNwYWNpbmc6LjRweFwiPldBUEUgJmx0OyAzMCUgKGV4Y2VsZW50ZSk8L2Rpdj48ZGl2IHN0eWxlPVwiZm9udC1zaXplOjIwcHg7Zm9udC13ZWlnaHQ6ODAwO2NvbG9yOiMxNmEzNGFcIj4nICtcclxuICAgIG5MdDAzICtcclxuICAgICc8L2Rpdj48L2Rpdj4nICtcclxuICAgICc8ZGl2PjxkaXYgc3R5bGU9XCJmb250LXNpemU6MTBweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7bGV0dGVyLXNwYWNpbmc6LjRweFwiPldBUEUgJmx0OyA1MCUgKGJ1ZW5vKTwvZGl2PjxkaXYgc3R5bGU9XCJmb250LXNpemU6MjBweDtmb250LXdlaWdodDo4MDA7Y29sb3I6Izg0Y2MxNlwiPicgK1xyXG4gICAgbkx0MDUgK1xyXG4gICAgJzwvZGl2PjwvZGl2PicgK1xyXG4gICAgJzxkaXY+PGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMHB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtsZXR0ZXItc3BhY2luZzouNHB4XCI+XHUwMERBbHRpbWEgY29ycmlkYTwvZGl2PjxkaXYgc3R5bGU9XCJmb250LXNpemU6MTNweDtmb250LXdlaWdodDo2MDA7Y29sb3I6dmFyKC0tdGV4dC1wcmltYXJ5KTttYXJnaW4tdG9wOjRweFwiPicgK1xyXG4gICAgZXNjYXBlSHRtbFNhZmUoZ2VuZXJhdGVkKSArXHJcbiAgICAnPC9kaXY+PC9kaXY+JyArXHJcbiAgICAnPC9kaXY+JztcclxuXHJcbiAgLy8gVGFibGEgcm93c1xyXG4gIGNvbnN0IHJvd3NIdG1sID0gZG9jc1xyXG4gICAgLm1hcCgoZCkgPT4ge1xyXG4gICAgICBjb25zdCB3YXBlID0gZC5tZXRyaWNzICYmIGQubWV0cmljcy53YXBlICE9IG51bGwgPyBkLm1ldHJpY3Mud2FwZSA6IG51bGw7XHJcbiAgICAgIGNvbnN0IGJlc3RNb2RlbCA9IGQuYmVzdE1vZGVsIHx8ICdcdTIwMTQnO1xyXG4gICAgICBjb25zdCBmb3JlY2FzdE1hcCA9IHt9O1xyXG4gICAgICAoZC5mb3JlY2FzdCB8fCBbXSkuZm9yRWFjaCgoZikgPT4ge1xyXG4gICAgICAgIGZvcmVjYXN0TWFwW2YuZHNdID0gZi55X2hhdDtcclxuICAgICAgfSk7XHJcbiAgICAgIGNvbnN0IG1vbnRoQ2VsbHMgPSBtb250aHNJc29cclxuICAgICAgICAubWFwKFxyXG4gICAgICAgICAgKGRzKSA9PlxyXG4gICAgICAgICAgICAnPHRkIHN0eWxlPVwicGFkZGluZzo4cHggMTBweDt0ZXh0LWFsaWduOnJpZ2h0O2ZvbnQtdmFyaWFudC1udW1lcmljOnRhYnVsYXItbnVtcztmb250LXdlaWdodDo2MDA7Y29sb3I6dmFyKC0tdGV4dC1wcmltYXJ5KVwiPicgK1xyXG4gICAgICAgICAgICBfZm10TnVtKGZvcmVjYXN0TWFwW2RzXSkgK1xyXG4gICAgICAgICAgICAnPC90ZD4nXHJcbiAgICAgICAgKVxyXG4gICAgICAgIC5qb2luKCcnKTtcclxuICAgICAgY29uc3QgdG90YWw3ID0gKGQuZm9yZWNhc3QgfHwgW10pLnJlZHVjZSgocywgZikgPT4gcyArIChOdW1iZXIoZi55X2hhdCkgfHwgMCksIDApO1xyXG4gICAgICByZXR1cm4gKFxyXG4gICAgICAgICc8dHIgb25jbGljaz1cIm9wZW5Gb3JlY2FzdFN0YXREZXRhaWwoXFwnJyArXHJcbiAgICAgICAgZXNjYXBlSHRtbFNhZmUoZC5pZCkgK1xyXG4gICAgICAgICdcXCcpXCIgc3R5bGU9XCJjdXJzb3I6cG9pbnRlcjtib3JkZXItYm90dG9tOjFweCBzb2xpZCB2YXIoLS1ib3JkZXItc3VidGxlKVwiIG9ubW91c2VvdmVyPVwidGhpcy5zdHlsZS5iYWNrZ3JvdW5kPVxcJ3ZhcigtLWJnLXNlY29uZGFyeSlcXCdcIiBvbm1vdXNlb3V0PVwidGhpcy5zdHlsZS5iYWNrZ3JvdW5kPVxcJ3RyYW5zcGFyZW50XFwnXCI+JyArXHJcbiAgICAgICAgJzx0ZCBzdHlsZT1cInBhZGRpbmc6OHB4IDEwcHg7Zm9udC13ZWlnaHQ6NzAwO2NvbG9yOnZhcigtLXRleHQtcHJpbWFyeSlcIj4nICtcclxuICAgICAgICBlc2NhcGVIdG1sU2FmZShkLnN1YmZhbWlsaWEgfHwgZC5pZCkgK1xyXG4gICAgICAgICc8L3RkPicgK1xyXG4gICAgICAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjhweCAxMHB4O2ZvbnQtc2l6ZToxMXB4O2NvbG9yOnZhcigtLXRleHQtc2Vjb25kYXJ5KVwiPicgK1xyXG4gICAgICAgIGVzY2FwZUh0bWxTYWZlKGJlc3RNb2RlbCkgK1xyXG4gICAgICAgICc8L3RkPicgK1xyXG4gICAgICAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjhweCAxMHB4O3RleHQtYWxpZ246Y2VudGVyXCI+PHNwYW4gc3R5bGU9XCJkaXNwbGF5OmlubGluZS1ibG9jaztwYWRkaW5nOjNweCA4cHg7Ym9yZGVyLXJhZGl1czoxMnB4O2JhY2tncm91bmQ6JyArXHJcbiAgICAgICAgX3dhcGVCYWRnZUNvbG9yKHdhcGUpICtcclxuICAgICAgICAnO2NvbG9yOiNmZmY7Zm9udC1zaXplOjExcHg7Zm9udC13ZWlnaHQ6NzAwXCI+JyArXHJcbiAgICAgICAgX2ZtdFdhcGUod2FwZSkgK1xyXG4gICAgICAgICc8L3NwYW4+PC90ZD4nICtcclxuICAgICAgICBtb250aENlbGxzICtcclxuICAgICAgICAnPHRkIHN0eWxlPVwicGFkZGluZzo4cHggMTBweDt0ZXh0LWFsaWduOnJpZ2h0O2ZvbnQtdmFyaWFudC1udW1lcmljOnRhYnVsYXItbnVtcztmb250LXdlaWdodDo3MDA7Y29sb3I6IzBkOTQ4ODtiYWNrZ3JvdW5kOnZhcigtLWJnLXNlY29uZGFyeSlcIj4nICtcclxuICAgICAgICBfZm10TnVtKHRvdGFsNykgK1xyXG4gICAgICAgICc8L3RkPicgK1xyXG4gICAgICAgICc8L3RyPidcclxuICAgICAgKTtcclxuICAgIH0pXHJcbiAgICAuam9pbignJyk7XHJcblxyXG4gIGNvbnN0IG1vbnRoSGVhZGVyc0h0bWwgPSBtb250aEhlYWRlcnNcclxuICAgIC5tYXAoXHJcbiAgICAgIChtKSA9PlxyXG4gICAgICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjhweCAxMHB4O3RleHQtYWxpZ246cmlnaHQ7Zm9udC1zaXplOjEwcHg7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO2xldHRlci1zcGFjaW5nOi40cHg7Y29sb3I6Izk0YTNiOFwiPicgK1xyXG4gICAgICAgIGVzY2FwZUh0bWxTYWZlKG0pICtcclxuICAgICAgICAnPC90aD4nXHJcbiAgICApXHJcbiAgICAuam9pbignJyk7XHJcblxyXG4gIGNvbnN0IHRhYmxlID1cclxuICAgICc8ZGl2IHN0eWxlPVwib3ZlcmZsb3c6YXV0bztib3JkZXI6MXB4IHNvbGlkIHZhcigtLWJvcmRlci1zdWJ0bGUpO2JvcmRlci1yYWRpdXM6OHB4XCI+JyArXHJcbiAgICAnPHRhYmxlIHN0eWxlPVwid2lkdGg6MTAwJTtib3JkZXItY29sbGFwc2U6Y29sbGFwc2U7Zm9udC1zaXplOjEycHhcIj4nICtcclxuICAgICc8dGhlYWQgc3R5bGU9XCJiYWNrZ3JvdW5kOiMwZjE3MmE7Y29sb3I6I2ZmZlwiPjx0cj4nICtcclxuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjhweCAxMHB4O3RleHQtYWxpZ246bGVmdDtmb250LXNpemU6MTBweDt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7bGV0dGVyLXNwYWNpbmc6LjRweFwiPlN1YmZhbWlsaWE8L3RoPicgK1xyXG4gICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6OHB4IDEwcHg7dGV4dC1hbGlnbjpsZWZ0O2ZvbnQtc2l6ZToxMHB4O3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtsZXR0ZXItc3BhY2luZzouNHB4XCI+TW9kZWxvPC90aD4nICtcclxuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjhweCAxMHB4O3RleHQtYWxpZ246Y2VudGVyO2ZvbnQtc2l6ZToxMHB4O3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtsZXR0ZXItc3BhY2luZzouNHB4XCI+V0FQRTwvdGg+JyArXHJcbiAgICBtb250aEhlYWRlcnNIdG1sICtcclxuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjhweCAxMHB4O3RleHQtYWxpZ246cmlnaHQ7Zm9udC1zaXplOjEwcHg7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO2xldHRlci1zcGFjaW5nOi40cHg7YmFja2dyb3VuZDojMTM0ZTRhXCI+VG90YWwgN208L3RoPicgK1xyXG4gICAgJzwvdHI+PC90aGVhZD4nICtcclxuICAgICc8dGJvZHk+JyArXHJcbiAgICByb3dzSHRtbCArXHJcbiAgICAnPC90Ym9keT48L3RhYmxlPjwvZGl2Pic7XHJcblxyXG4gIGNvbnN0IGZvb3RlciA9XHJcbiAgICAnPGRpdiBzdHlsZT1cIm1hcmdpbi10b3A6MTJweDtmb250LXNpemU6MTFweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTtsaW5lLWhlaWdodDoxLjVcIj4nICtcclxuICAgICc8Yj5DXHUwMEYzbW8gbGVlcjwvYj46IFdBUEUgKFdlaWdodGVkIEFic29sdXRlIFBlcmNlbnRhZ2UgRXJyb3IpIG1pZGUgZWwgZXJyb3IgZGVsIG1vZGVsbyByZWxhdGl2byBhbCB0b3RhbCByZWFsOiAmbHQ7MzAlIGV4Y2VsZW50ZSwgMzAtNTAlIGJ1ZW5vLCA1MC03MCUgYWNlcHRhYmxlLCAmZ3Q7NzAlIHBvYnJlLiBDbGljayBlbiBmaWxhIHBhcmEgZGV0YWxsZSArIGdyXHUwMEUxZmljby4gJyArXHJcbiAgICAnU2UgZWxpZ2UgZWwgbW9kZWxvIGNvbiBtZW5vciBXQVBFIHBvciBzZXJpZSB0cmFzIGJhY2t0ZXN0IHJvbGxpbmctb3JpZ2luIChoPTIsIHZlbnRhbmFzPTMpLicgK1xyXG4gICAgJzwvZGl2Pic7XHJcblxyXG4gIGNvbnQuaW5uZXJIVE1MID0gJzxkaXYgc3R5bGU9XCJwYWRkaW5nOjE4cHhcIj4nICsgYmFubmVyICsgdGFibGUgKyBmb290ZXIgKyAnPC9kaXY+JztcclxufVxyXG5cclxuLy8gQ2FjaGUgaGlzdG9yaWEgYWdyZWdhZGEgcG9yIHN1YmZhbWlsaWEgKHBhcmEgZ3JcdTAwRTFmaWNvIGRldGFsbGUpLlxyXG5hc3luYyBmdW5jdGlvbiBfbG9hZEZvcmVjYXN0U3RhdEhpc3RvcnkoKSB7XHJcbiAgaWYgKF9mb3JlY2FzdFN0YXRIaXN0b3J5Q2FjaGUpIHJldHVybiBfZm9yZWNhc3RTdGF0SGlzdG9yeUNhY2hlO1xyXG4gIC8vIExhIGhpc3RvcmlhIHNvbG8gZXN0XHUwMEUxIGVuIEJRICh+MTAgYVx1MDBGMW9zIEJhcmFsZG8gKyAxMiBtZXNlcyBTaGltYW5vKS4gQ29tb1xyXG4gIC8vIGVsIHBpcGVsaW5lIGxhIGVzY3JpYmUgYSBDU1YgbG9jYWwsIGFjXHUwMEUxIG5vIGxhIHBvZGVtb3MgbGVlci4gQWx0ZXJuYXRpdmE6XHJcbiAgLy8gdXNhciBza3VfdmVudGFzX3NuYXBzaG90IHF1ZSB0aWVuZSB2ZW50YXMgbWVuc3VhbGVzIHBlcm8gc29sbyBncnVwbyBQRVNDQS5cclxuICAvLyBFbiBGMkIuMiBzb2xvIG1vc3RyYW1vcyBmb3JlY2FzdCtJQyAoc2luIG92ZXJsYXkgaGlzdG9yaWEgcG9yIGFob3JhKS5cclxuICBfZm9yZWNhc3RTdGF0SGlzdG9yeUNhY2hlID0ge307XHJcbiAgcmV0dXJuIF9mb3JlY2FzdFN0YXRIaXN0b3J5Q2FjaGU7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIF9idWlsZEZvcmVjYXN0Q2hhcnRTdmcoZG9jKSB7XHJcbiAgY29uc3QgZmMgPSBkb2MuZm9yZWNhc3QgfHwgW107XHJcbiAgaWYgKCFmYy5sZW5ndGgpXHJcbiAgICByZXR1cm4gJzxkaXYgc3R5bGU9XCJwYWRkaW5nOjMwcHg7dGV4dC1hbGlnbjpjZW50ZXI7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZClcIj5TaW4gZGF0b3MgZGUgZm9yZWNhc3Q8L2Rpdj4nO1xyXG4gIC8vIERpbWVuc2lvbmVzXHJcbiAgY29uc3QgVyA9IDY0MCxcclxuICAgIEggPSAyNjA7XHJcbiAgY29uc3QgcGFkTCA9IDUwLFxyXG4gICAgcGFkUiA9IDIwLFxyXG4gICAgcGFkVCA9IDIwLFxyXG4gICAgcGFkQiA9IDQwO1xyXG4gIGNvbnN0IGlubmVyVyA9IFcgLSBwYWRMIC0gcGFkUjtcclxuICBjb25zdCBpbm5lckggPSBIIC0gcGFkVCAtIHBhZEI7XHJcblxyXG4gIC8vIFkgcmFuZ2U6IG1heChoaTgwKSAqIDEuMVxyXG4gIGNvbnN0IG1heFkgPSBNYXRoLm1heCgxLCAuLi5mYy5tYXAoKGYpID0+IE51bWJlcihmLmhpODApIHx8IE51bWJlcihmLnlfaGF0KSB8fCAwKSk7XHJcbiAgY29uc3QgbWluWSA9IDA7XHJcbiAgY29uc3Qgc2NhbGVYID0gKGkpID0+IHBhZEwgKyAoaW5uZXJXICogaSkgLyBNYXRoLm1heCgxLCBmYy5sZW5ndGggLSAxKTtcclxuICBjb25zdCBzY2FsZVkgPSAodikgPT4gcGFkVCArIGlubmVySCAtIChpbm5lckggKiAodiAtIG1pblkpKSAvIChtYXhZIC0gbWluWSk7XHJcblxyXG4gIC8vIEdyaWQgKyBlamUgWVxyXG4gIGNvbnN0IHlUaWNrcyA9IFswLCAwLjI1LCAwLjUsIDAuNzUsIDFdXHJcbiAgICAubWFwKChyKSA9PiB7XHJcbiAgICAgIGNvbnN0IHZhbCA9IG1pblkgKyByICogKG1heFkgLSBtaW5ZKTtcclxuICAgICAgY29uc3QgeXkgPSBzY2FsZVkodmFsKTtcclxuICAgICAgcmV0dXJuIChcclxuICAgICAgICAnPGxpbmUgeDE9XCInICtcclxuICAgICAgICBwYWRMICtcclxuICAgICAgICAnXCIgeTE9XCInICtcclxuICAgICAgICB5eSArXHJcbiAgICAgICAgJ1wiIHgyPVwiJyArXHJcbiAgICAgICAgKFcgLSBwYWRSKSArXHJcbiAgICAgICAgJ1wiIHkyPVwiJyArXHJcbiAgICAgICAgeXkgK1xyXG4gICAgICAgICdcIiBzdHJva2U9XCIjZTJlOGYwXCIgc3Ryb2tlLXdpZHRoPVwiMVwiLz4nICtcclxuICAgICAgICAnPHRleHQgeD1cIicgK1xyXG4gICAgICAgIChwYWRMIC0gNikgK1xyXG4gICAgICAgICdcIiB5PVwiJyArXHJcbiAgICAgICAgKHl5ICsgNCkgK1xyXG4gICAgICAgICdcIiB0ZXh0LWFuY2hvcj1cImVuZFwiIGZvbnQtc2l6ZT1cIjEwXCIgZmlsbD1cIiM2NDc0OGJcIj4nICtcclxuICAgICAgICBfZm10TnVtKHZhbCkgK1xyXG4gICAgICAgICc8L3RleHQ+J1xyXG4gICAgICApO1xyXG4gICAgfSlcclxuICAgIC5qb2luKCcnKTtcclxuXHJcbiAgLy8gRWplIFggKG1lc2VzKVxyXG4gIGNvbnN0IHhMYWJlbHMgPSBmY1xyXG4gICAgLm1hcCgoZiwgaSkgPT4ge1xyXG4gICAgICBjb25zdCB4eCA9IHNjYWxlWChpKTtcclxuICAgICAgcmV0dXJuIChcclxuICAgICAgICAnPHRleHQgeD1cIicgK1xyXG4gICAgICAgIHh4ICtcclxuICAgICAgICAnXCIgeT1cIicgK1xyXG4gICAgICAgIChIIC0gcGFkQiArIDE1KSArXHJcbiAgICAgICAgJ1wiIHRleHQtYW5jaG9yPVwibWlkZGxlXCIgZm9udC1zaXplPVwiMTBcIiBmaWxsPVwiIzY0NzQ4YlwiPicgK1xyXG4gICAgICAgIF9mbXREc1Nob3J0KGYuZHMpICtcclxuICAgICAgICAnPC90ZXh0PidcclxuICAgICAgKTtcclxuICAgIH0pXHJcbiAgICAuam9pbignJyk7XHJcblxyXG4gIC8vIEludGVydmFsbyBjb25maWFuemEgKGJhbmQpXHJcbiAgY29uc3QgYmFuZFBvaW50cyA9XHJcbiAgICBmYy5tYXAoKGYsIGkpID0+IHNjYWxlWChpKSArICcsJyArIHNjYWxlWShOdW1iZXIoZi5oaTgwKSB8fCAwKSkuam9pbignICcpICtcclxuICAgICcgJyArXHJcbiAgICBmY1xyXG4gICAgICAuc2xpY2UoKVxyXG4gICAgICAucmV2ZXJzZSgpXHJcbiAgICAgIC5tYXAoKGYsIGkpID0+IHNjYWxlWChmYy5sZW5ndGggLSAxIC0gaSkgKyAnLCcgKyBzY2FsZVkoTnVtYmVyKGYubG84MCkgfHwgMCkpXHJcbiAgICAgIC5qb2luKCcgJyk7XHJcbiAgY29uc3QgYmFuZCA9ICc8cG9seWdvbiBwb2ludHM9XCInICsgYmFuZFBvaW50cyArICdcIiBmaWxsPVwiIzBkOTQ4ODMzXCIgc3Ryb2tlPVwibm9uZVwiLz4nO1xyXG5cclxuICAvLyBMaW5lIGZvcmVjYXN0ICsgcHVudG9zXHJcbiAgY29uc3QgbGluZVBvaW50cyA9IGZjLm1hcCgoZiwgaSkgPT4gc2NhbGVYKGkpICsgJywnICsgc2NhbGVZKE51bWJlcihmLnlfaGF0KSB8fCAwKSkuam9pbignICcpO1xyXG4gIGNvbnN0IGxpbmUgPVxyXG4gICAgJzxwb2x5bGluZSBwb2ludHM9XCInICtcclxuICAgIGxpbmVQb2ludHMgK1xyXG4gICAgJ1wiIGZpbGw9XCJub25lXCIgc3Ryb2tlPVwiIzBkOTQ4OFwiIHN0cm9rZS13aWR0aD1cIjIuNVwiIHN0cm9rZS1saW5lam9pbj1cInJvdW5kXCIvPic7XHJcbiAgY29uc3QgcG9pbnRzID0gZmNcclxuICAgIC5tYXAoXHJcbiAgICAgIChmLCBpKSA9PlxyXG4gICAgICAgICc8Y2lyY2xlIGN4PVwiJyArXHJcbiAgICAgICAgc2NhbGVYKGkpICtcclxuICAgICAgICAnXCIgY3k9XCInICtcclxuICAgICAgICBzY2FsZVkoTnVtYmVyKGYueV9oYXQpIHx8IDApICtcclxuICAgICAgICAnXCIgcj1cIjRcIiBmaWxsPVwiIzBkOTQ4OFwiIHN0cm9rZT1cIiNmZmZcIiBzdHJva2Utd2lkdGg9XCIyXCIvPidcclxuICAgIClcclxuICAgIC5qb2luKCcnKTtcclxuICAvLyBMYWJlbHMgZGUgdmFsb3JcclxuICBjb25zdCB2YWx1ZUxhYmVscyA9IGZjXHJcbiAgICAubWFwKChmLCBpKSA9PiB7XHJcbiAgICAgIGNvbnN0IHh4ID0gc2NhbGVYKGkpO1xyXG4gICAgICBjb25zdCB5eSA9IHNjYWxlWShOdW1iZXIoZi55X2hhdCkgfHwgMCk7XHJcbiAgICAgIHJldHVybiAoXHJcbiAgICAgICAgJzx0ZXh0IHg9XCInICtcclxuICAgICAgICB4eCArXHJcbiAgICAgICAgJ1wiIHk9XCInICtcclxuICAgICAgICAoeXkgLSA4KSArXHJcbiAgICAgICAgJ1wiIHRleHQtYW5jaG9yPVwibWlkZGxlXCIgZm9udC1zaXplPVwiMTBcIiBmb250LXdlaWdodD1cIjcwMFwiIGZpbGw9XCIjMGY3NjZlXCI+JyArXHJcbiAgICAgICAgX2ZtdE51bShmLnlfaGF0KSArXHJcbiAgICAgICAgJzwvdGV4dD4nXHJcbiAgICAgICk7XHJcbiAgICB9KVxyXG4gICAgLmpvaW4oJycpO1xyXG5cclxuICBjb25zdCBzdmcgPVxyXG4gICAgJzxzdmcgdmlld0JveD1cIjAgMCAnICtcclxuICAgIFcgK1xyXG4gICAgJyAnICtcclxuICAgIEggK1xyXG4gICAgJ1wiIHN0eWxlPVwid2lkdGg6MTAwJTttYXgtd2lkdGg6ODAwcHg7aGVpZ2h0OmF1dG9cIj4nICtcclxuICAgICc8cmVjdCB4PVwiMFwiIHk9XCIwXCIgd2lkdGg9XCInICtcclxuICAgIFcgK1xyXG4gICAgJ1wiIGhlaWdodD1cIicgK1xyXG4gICAgSCArXHJcbiAgICAnXCIgZmlsbD1cIiNmZmZcIi8+JyArXHJcbiAgICB5VGlja3MgK1xyXG4gICAgeExhYmVscyArXHJcbiAgICBiYW5kICtcclxuICAgIGxpbmUgK1xyXG4gICAgcG9pbnRzICtcclxuICAgIHZhbHVlTGFiZWxzICtcclxuICAgICc8L3N2Zz4nO1xyXG4gIHJldHVybiBzdmc7XHJcbn1cclxuXHJcbndpbmRvdy5vcGVuRm9yZWNhc3RTdGF0RGV0YWlsID0gZnVuY3Rpb24gKHN1YklkKSB7XHJcbiAgaWYgKCFfZm9yZWNhc3RTdGF0RG9jcykgcmV0dXJuO1xyXG4gIGNvbnN0IGRvYyA9IF9mb3JlY2FzdFN0YXREb2NzLmZpbmQoKGQpID0+IGQuaWQgPT09IHN1YklkKTtcclxuICBpZiAoIWRvYykge1xyXG4gICAgYWxlcnQoJ05vIHNlIGVuY29udHJcdTAwRjMgZGV0YWxsZSBkZSAnICsgc3ViSWQpO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuICBjb25zdCBleGlzdGluZyA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdmb3JlY2FzdC1zdGF0LWRldGFpbCcpO1xyXG4gIGlmIChleGlzdGluZykgZXhpc3RpbmcucmVtb3ZlKCk7XHJcblxyXG4gIGNvbnN0IGVsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2Jyk7XHJcbiAgZWwuaWQgPSAnZm9yZWNhc3Qtc3RhdC1kZXRhaWwnO1xyXG4gIGVsLnN0eWxlLmNzc1RleHQgPVxyXG4gICAgJ3Bvc2l0aW9uOmZpeGVkO2luc2V0OjA7YmFja2dyb3VuZDpyZ2JhKDE1LDIzLDQyLC42NSk7ei1pbmRleDoyMTAwO2Rpc3BsYXk6ZmxleDthbGlnbi1pdGVtczpjZW50ZXI7anVzdGlmeS1jb250ZW50OmNlbnRlcjtwYWRkaW5nOjJ2aCc7XHJcbiAgZWwub25jbGljayA9IChldikgPT4ge1xyXG4gICAgaWYgKGV2LnRhcmdldCA9PT0gZWwpIGVsLnJlbW92ZSgpO1xyXG4gIH07XHJcblxyXG4gIGNvbnN0IHdhcGUgPSBkb2MubWV0cmljcyAmJiBkb2MubWV0cmljcy53YXBlO1xyXG4gIGNvbnN0IGJpYXMgPSBkb2MubWV0cmljcyAmJiBkb2MubWV0cmljcy5iaWFzO1xyXG4gIGNvbnN0IG1hZSA9IGRvYy5tZXRyaWNzICYmIGRvYy5tZXRyaWNzLm1hZTtcclxuICBjb25zdCBybXNlID0gZG9jLm1ldHJpY3MgJiYgZG9jLm1ldHJpY3Mucm1zZTtcclxuICBjb25zdCBiZXN0TW9kZWwgPSBkb2MuYmVzdE1vZGVsIHx8ICdcdTIwMTQnO1xyXG4gIGNvbnN0IHZlcnNpb25JZCA9IGRvYy52ZXJzaW9uSWQgfHwgJ1x1MjAxNCc7XHJcbiAgY29uc3Qgc3ZnSHRtbCA9IF9idWlsZEZvcmVjYXN0Q2hhcnRTdmcoZG9jKTtcclxuXHJcbiAgY29uc3QgbWV0cmljc0h0bWwgPVxyXG4gICAgJzxkaXYgc3R5bGU9XCJkaXNwbGF5OmdyaWQ7Z3JpZC10ZW1wbGF0ZS1jb2x1bW5zOnJlcGVhdChhdXRvLWZpdCxtaW5tYXgoMTIwcHgsMWZyKSk7Z2FwOjEwcHg7bWFyZ2luOjE0cHggMFwiPicgK1xyXG4gICAgJzxkaXYgc3R5bGU9XCJwYWRkaW5nOjEwcHg7YmFja2dyb3VuZDp2YXIoLS1iZy1zZWNvbmRhcnkpO2JvcmRlci1yYWRpdXM6NnB4XCI+PGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMHB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZVwiPk1vZGVsbzwvZGl2PjxkaXYgc3R5bGU9XCJmb250LXdlaWdodDo3MDBcIj4nICtcclxuICAgIGVzY2FwZUh0bWxTYWZlKGJlc3RNb2RlbCkgK1xyXG4gICAgJzwvZGl2PjwvZGl2PicgK1xyXG4gICAgJzxkaXYgc3R5bGU9XCJwYWRkaW5nOjEwcHg7YmFja2dyb3VuZDp2YXIoLS1iZy1zZWNvbmRhcnkpO2JvcmRlci1yYWRpdXM6NnB4XCI+PGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMHB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZVwiPldBUEU8L2Rpdj48ZGl2IHN0eWxlPVwiZm9udC13ZWlnaHQ6NzAwO2NvbG9yOicgK1xyXG4gICAgX3dhcGVCYWRnZUNvbG9yKHdhcGUpICtcclxuICAgICdcIj4nICtcclxuICAgIF9mbXRXYXBlKHdhcGUpICtcclxuICAgICc8L2Rpdj48L2Rpdj4nICtcclxuICAgICc8ZGl2IHN0eWxlPVwicGFkZGluZzoxMHB4O2JhY2tncm91bmQ6dmFyKC0tYmctc2Vjb25kYXJ5KTtib3JkZXItcmFkaXVzOjZweFwiPjxkaXYgc3R5bGU9XCJmb250LXNpemU6MTBweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2VcIj5CaWFzPC9kaXY+PGRpdiBzdHlsZT1cImZvbnQtd2VpZ2h0OjcwMFwiPicgK1xyXG4gICAgKGJpYXMgIT0gbnVsbCA/IChiaWFzICogMTAwKS50b0ZpeGVkKDApICsgJyUnIDogJ1x1MjAxNCcpICtcclxuICAgICc8L2Rpdj48L2Rpdj4nICtcclxuICAgICc8ZGl2IHN0eWxlPVwicGFkZGluZzoxMHB4O2JhY2tncm91bmQ6dmFyKC0tYmctc2Vjb25kYXJ5KTtib3JkZXItcmFkaXVzOjZweFwiPjxkaXYgc3R5bGU9XCJmb250LXNpemU6MTBweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2VcIj5NQUU8L2Rpdj48ZGl2IHN0eWxlPVwiZm9udC13ZWlnaHQ6NzAwXCI+JyArXHJcbiAgICBfZm10TnVtKG1hZSkgK1xyXG4gICAgJzwvZGl2PjwvZGl2PicgK1xyXG4gICAgJzxkaXYgc3R5bGU9XCJwYWRkaW5nOjEwcHg7YmFja2dyb3VuZDp2YXIoLS1iZy1zZWNvbmRhcnkpO2JvcmRlci1yYWRpdXM6NnB4XCI+PGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMHB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZVwiPlJNU0U8L2Rpdj48ZGl2IHN0eWxlPVwiZm9udC13ZWlnaHQ6NzAwXCI+JyArXHJcbiAgICBfZm10TnVtKHJtc2UpICtcclxuICAgICc8L2Rpdj48L2Rpdj4nICtcclxuICAgICc8L2Rpdj4nO1xyXG5cclxuICBjb25zdCB0YWJsZUh0bWwgPVxyXG4gICAgJzx0YWJsZSBzdHlsZT1cIndpZHRoOjEwMCU7Zm9udC1zaXplOjEycHg7Ym9yZGVyLWNvbGxhcHNlOmNvbGxhcHNlO21hcmdpbi10b3A6MTBweFwiPicgK1xyXG4gICAgJzx0aGVhZCBzdHlsZT1cImJhY2tncm91bmQ6IzBmMTcyYTtjb2xvcjojZmZmXCI+PHRyPicgK1xyXG4gICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6NnB4IDEwcHg7dGV4dC1hbGlnbjpsZWZ0XCI+TWVzPC90aD4nICtcclxuICAgICc8dGggc3R5bGU9XCJwYWRkaW5nOjZweCAxMHB4O3RleHQtYWxpZ246cmlnaHRcIj5Gb3JlY2FzdDwvdGg+JyArXHJcbiAgICAnPHRoIHN0eWxlPVwicGFkZGluZzo2cHggMTBweDt0ZXh0LWFsaWduOnJpZ2h0XCI+SUMgODAlIGJham88L3RoPicgK1xyXG4gICAgJzx0aCBzdHlsZT1cInBhZGRpbmc6NnB4IDEwcHg7dGV4dC1hbGlnbjpyaWdodFwiPklDIDgwJSBhbHRvPC90aD4nICtcclxuICAgICc8L3RyPjwvdGhlYWQ+PHRib2R5PicgK1xyXG4gICAgKGRvYy5mb3JlY2FzdCB8fCBbXSlcclxuICAgICAgLm1hcChcclxuICAgICAgICAoZikgPT5cclxuICAgICAgICAgICc8dHIgc3R5bGU9XCJib3JkZXItYm90dG9tOjFweCBzb2xpZCB2YXIoLS1ib3JkZXItc3VidGxlKVwiPjx0ZCBzdHlsZT1cInBhZGRpbmc6NnB4IDEwcHhcIj4nICtcclxuICAgICAgICAgIGVzY2FwZUh0bWxTYWZlKF9mbXREc1Nob3J0KGYuZHMpKSArXHJcbiAgICAgICAgICAnPC90ZD4nICtcclxuICAgICAgICAgICc8dGQgc3R5bGU9XCJwYWRkaW5nOjZweCAxMHB4O3RleHQtYWxpZ246cmlnaHQ7Zm9udC13ZWlnaHQ6NzAwXCI+JyArXHJcbiAgICAgICAgICBfZm10TnVtKGYueV9oYXQpICtcclxuICAgICAgICAgICc8L3RkPicgK1xyXG4gICAgICAgICAgJzx0ZCBzdHlsZT1cInBhZGRpbmc6NnB4IDEwcHg7dGV4dC1hbGlnbjpyaWdodDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKVwiPicgK1xyXG4gICAgICAgICAgX2ZtdE51bShmLmxvODApICtcclxuICAgICAgICAgICc8L3RkPicgK1xyXG4gICAgICAgICAgJzx0ZCBzdHlsZT1cInBhZGRpbmc6NnB4IDEwcHg7dGV4dC1hbGlnbjpyaWdodDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKVwiPicgK1xyXG4gICAgICAgICAgX2ZtdE51bShmLmhpODApICtcclxuICAgICAgICAgICc8L3RkPjwvdHI+J1xyXG4gICAgICApXHJcbiAgICAgIC5qb2luKCcnKSArXHJcbiAgICAnPC90Ym9keT48L3RhYmxlPic7XHJcblxyXG4gIGNvbnN0IGNvbnRlbnQgPVxyXG4gICAgJzxkaXYgc3R5bGU9XCJiYWNrZ3JvdW5kOnZhcigtLWJnLWVsZXZhdGVkKTtib3JkZXItcmFkaXVzOjEycHg7cGFkZGluZzoyNHB4O21heC13aWR0aDo4MjBweDt3aWR0aDoxMDAlO21heC1oZWlnaHQ6OTZ2aDtvdmVyZmxvdzphdXRvO2JveC1zaGFkb3c6MCAyMHB4IDYwcHggcmdiYSgwLDAsMCwuNClcIj4nICtcclxuICAgICc8ZGl2IHN0eWxlPVwiZGlzcGxheTpmbGV4O2p1c3RpZnktY29udGVudDpzcGFjZS1iZXR3ZWVuO2FsaWduLWl0ZW1zOmNlbnRlcjttYXJnaW4tYm90dG9tOjEwcHhcIj4nICtcclxuICAgICc8ZGl2PjxkaXYgc3R5bGU9XCJmb250LXNpemU6MTFweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7bGV0dGVyLXNwYWNpbmc6LjRweFwiPlN1YmZhbWlsaWE8L2Rpdj48ZGl2IHN0eWxlPVwiZm9udC1zaXplOjIycHg7Zm9udC13ZWlnaHQ6ODAwXCI+JyArXHJcbiAgICBlc2NhcGVIdG1sU2FmZShkb2Muc3ViZmFtaWxpYSB8fCBkb2MuaWQpICtcclxuICAgICc8L2Rpdj48L2Rpdj4nICtcclxuICAgICc8YnV0dG9uIG9uY2xpY2s9XCJkb2N1bWVudC5nZXRFbGVtZW50QnlJZChcXCdmb3JlY2FzdC1zdGF0LWRldGFpbFxcJykucmVtb3ZlKClcIiBzdHlsZT1cImJhY2tncm91bmQ6dHJhbnNwYXJlbnQ7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1ib3JkZXItc3VidGxlKTtib3JkZXItcmFkaXVzOjZweDtwYWRkaW5nOjZweCAxMnB4O2N1cnNvcjpwb2ludGVyO2ZvbnQtd2VpZ2h0OjcwMFwiPkNlcnJhcjwvYnV0dG9uPicgK1xyXG4gICAgJzwvZGl2PicgK1xyXG4gICAgbWV0cmljc0h0bWwgK1xyXG4gICAgJzxkaXYgc3R5bGU9XCJiYWNrZ3JvdW5kOiNmZmY7cGFkZGluZzo4cHg7Ym9yZGVyLXJhZGl1czo4cHg7bWFyZ2luLXRvcDoxMHB4O2JvcmRlcjoxcHggc29saWQgdmFyKC0tYm9yZGVyLXN1YnRsZSlcIj4nICtcclxuICAgIHN2Z0h0bWwgK1xyXG4gICAgJzwvZGl2PicgK1xyXG4gICAgdGFibGVIdG1sICtcclxuICAgICc8ZGl2IHN0eWxlPVwibWFyZ2luLXRvcDoxNHB4O2ZvbnQtc2l6ZToxMXB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpXCI+VmVyc2lvbjogPGNvZGU+JyArXHJcbiAgICBlc2NhcGVIdG1sU2FmZSh2ZXJzaW9uSWQpICtcclxuICAgICc8L2NvZGU+IFx1MDBCNyBBcHByb2FjaDogJyArXHJcbiAgICBlc2NhcGVIdG1sU2FmZSgoZG9jLmNvbmZpZyB8fCB7fSkuYXBwcm9hY2ggfHwgJ1x1MjAxNCcpICtcclxuICAgICc8L2Rpdj4nICtcclxuICAgICc8L2Rpdj4nO1xyXG4gIGVsLmlubmVySFRNTCA9IGNvbnRlbnQ7XHJcbiAgZG9jdW1lbnQuYm9keS5hcHBlbmRDaGlsZChlbCk7XHJcbn07XHJcblxyXG53aW5kb3cub3BlbkZvcmVjYXN0TW9kYWwgPSBhc3luYyBmdW5jdGlvbiAoKSB7XHJcbiAgaWYgKCFfY2FuRm9yZWNhc3QoKSkge1xyXG4gICAgYWxlcnQoJ0ZPUkVDQVNUIGVzIHNvbG8gcGFyYSBNYXJpYW5vIChhZG1pbikuJyk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIGNvbnN0IGVsID0gX3JlbmRlck1vZGFsU2hlbGwoKTtcclxuICBlbC5zdHlsZS5kaXNwbGF5ID0gJ2Jsb2NrJztcclxuICAvLyB2MTA5OCsgRmFzZSAxOiBjYXJnYXIgU2FsZXMgUGxhbnMgY2FjaGVzICsgcmVuZGVyaXphciB0YWIgZGVmYXVsdC5cclxuICBfcmVuZGVyU2FsZXNQbGFuc1RhYigpO1xyXG4gIF9sb2FkU2FsZXNQbGFuQ2FjaGVzKClcclxuICAgIC50aGVuKF9yZW5kZXJTYWxlc1BsYW5zVGFiKVxyXG4gICAgLmNhdGNoKCgpID0+IHt9KTtcclxuICAvLyBMZWdhY3k6IHNuYXBzaG90IHNvbG8gc2UgY2FyZ2EgbGF6eSBzaSBlbCB1c2VyIGNhbWJpYSBhIHRhYiBMZWdhY3kuXHJcbiAgaWYgKF9mb3JlY2FzdExvYWRpbmcpIHJldHVybjtcclxuICBpZiAoIV9mb3JlY2FzdFNuYXBzaG90KSB7XHJcbiAgICBfZm9yZWNhc3RMb2FkaW5nID0gdHJ1ZTtcclxuICAgIGNvbnN0IHN0YXRzID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2ZvcmVjYXN0LXN0YXRzJyk7XHJcbiAgICBpZiAoc3RhdHMpIHN0YXRzLnRleHRDb250ZW50ID0gJ0NhcmdhbmRvIHNuYXBzaG90IGRlIHZlbnRhcy4uLic7XHJcbiAgICB0cnkge1xyXG4gICAgICBhd2FpdCBfbG9hZFNuYXBzaG90KCk7XHJcbiAgICAgIGlmIChzdGF0cykgc3RhdHMudGV4dENvbnRlbnQgPSBfZm9yZWNhc3RTbmFwc2hvdC5jb3VudCArICcgU0tVcyBlbiBzbmFwc2hvdCBoaXN0b3JpY28nO1xyXG4gICAgfSBjYXRjaCAoZSkge1xyXG4gICAgICBpZiAoc3RhdHMpIHN0YXRzLnRleHRDb250ZW50ID0gJ0Vycm9yIGNhcmdhbmRvIHNuYXBzaG90OiAnICsgKChlICYmIGUubWVzc2FnZSkgfHwgZSk7XHJcbiAgICAgIC8vIE5vIGFsZXJ0IFx1MjAxNCBsZWdhY3kgZXMgb3B0LWluLCBubyBibG9xdWVhIGFsIHVzdWFyaW8gc2kgc29sbyB2YSBhIHN1YmlyIFNhbGVzIFBsYW5zLlxyXG4gICAgICBjb25zb2xlLndhcm4oJ1tGT1JFQ0FTVF0gc25hcHNob3QgbG9hZCBmYWlsIChsZWdhY3kgdGFiKScsIGUpO1xyXG4gICAgfSBmaW5hbGx5IHtcclxuICAgICAgX2ZvcmVjYXN0TG9hZGluZyA9IGZhbHNlO1xyXG4gICAgfVxyXG4gIH0gZWxzZSB7XHJcbiAgICBjb25zdCBzdGF0cyA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdmb3JlY2FzdC1zdGF0cycpO1xyXG4gICAgaWYgKHN0YXRzKSBzdGF0cy50ZXh0Q29udGVudCA9IF9mb3JlY2FzdFNuYXBzaG90LmNvdW50ICsgJyBTS1VzIGVuIHNuYXBzaG90IGhpc3Rvcmljbyc7XHJcbiAgfVxyXG59O1xyXG5cclxud2luZG93LmNsb3NlRm9yZWNhc3RNb2RhbCA9IGZ1bmN0aW9uICgpIHtcclxuICBjb25zdCBlbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdmb3JlY2FzdC1tb2RhbCcpO1xyXG4gIGlmIChlbCkgZWwuc3R5bGUuZGlzcGxheSA9ICdub25lJztcclxufTtcclxuXHJcbndpbmRvdy5vbkZvcmVjYXN0U2FsZXNQbGFuRmlsZSA9IGFzeW5jIGZ1bmN0aW9uIChldmVudCkge1xyXG4gIGNvbnN0IGZpbGUgPSBldmVudCAmJiBldmVudC50YXJnZXQgJiYgZXZlbnQudGFyZ2V0LmZpbGVzICYmIGV2ZW50LnRhcmdldC5maWxlc1swXTtcclxuICBpZiAoIWZpbGUpIHJldHVybjtcclxuICB0cnkge1xyXG4gICAgaWYgKCFfZm9yZWNhc3RTbmFwc2hvdCkgYXdhaXQgX2xvYWRTbmFwc2hvdCgpO1xyXG4gICAgY29uc3QgYnVmID0gYXdhaXQgZmlsZS5hcnJheUJ1ZmZlcigpO1xyXG4gICAgaWYgKHR5cGVvZiBYTFNYID09PSAndW5kZWZpbmVkJykge1xyXG4gICAgICBhbGVydCgnWExTWCBubyBjYXJnYWRvJyk7XHJcbiAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIGNvbnN0IHdiID0gWExTWC5yZWFkKGJ1ZiwgeyB0eXBlOiAnYXJyYXknIH0pO1xyXG4gICAgY29uc3Qgc2hlZXQgPSB3Yi5TaGVldHNbd2IuU2hlZXROYW1lc1swXV07XHJcbiAgICBjb25zdCByb3dzID0gWExTWC51dGlscy5zaGVldF90b19qc29uKHNoZWV0LCB7IGhlYWRlcjogMSwgZGVmdmFsOiBudWxsLCByYXc6IHRydWUgfSk7XHJcbiAgICBjb25zdCBwYXJzZWQgPSBfcGFyc2VTYWxlc1BsYW5Sb3dzKHJvd3MpO1xyXG4gICAgaWYgKCFwYXJzZWQubGVuZ3RoKSB7XHJcbiAgICAgIGFsZXJ0KCdFbCBFeGNlbCBlc3RhIHZhY2lvIG8gbm8gdGllbmUgZmlsYXMgdmFsaWRhcy4nKTtcclxuICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG4gICAgX2ZvcmVjYXN0U2FsZXNQbGFuID0gcGFyc2VkO1xyXG4gICAgY29uc3QgaG95ID0gbmV3IERhdGUoKTtcclxuICAgIF9mb3JlY2FzdFJvd3MgPSBfY29tcHV0ZUZvcmVjYXN0Um93cyhfZm9yZWNhc3RTbmFwc2hvdCwgcGFyc2VkLCBob3kpO1xyXG4gICAgX3JlbmRlclRhYmxlKF9mb3JlY2FzdFJvd3MpO1xyXG4gICAgY29uc3Qgc2luTWF0Y2ggPSBfZm9yZWNhc3RSb3dzLmZpbHRlcigocikgPT4gIXIuaGFzSGlzdG9yaWEpLmxlbmd0aDtcclxuICAgIGNvbnN0IHN0YXRzID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2ZvcmVjYXN0LXN0YXRzJyk7XHJcbiAgICBpZiAoc3RhdHMpIHtcclxuICAgICAgc3RhdHMudGV4dENvbnRlbnQgPVxyXG4gICAgICAgIHBhcnNlZC5sZW5ndGggK1xyXG4gICAgICAgICcgU0tVcyBlbiBTYWxlcyBQbGFuIFx1MDBCNyAnICtcclxuICAgICAgICAocGFyc2VkLmxlbmd0aCAtIHNpbk1hdGNoKSArXHJcbiAgICAgICAgJyBjb24gaGlzdG9yaWEgXHUwMEI3ICcgK1xyXG4gICAgICAgIHNpbk1hdGNoICtcclxuICAgICAgICAnIHNpbiBtYXRjaCAoZm9uZG8gYW1hcmlsbG8pJztcclxuICAgIH1cclxuICAgIGNvbnN0IGJ0biA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdmb3JlY2FzdC1leHBvcnQtYnRuJyk7XHJcbiAgICBpZiAoYnRuKSB7XHJcbiAgICAgIGJ0bi5kaXNhYmxlZCA9IGZhbHNlO1xyXG4gICAgICBidG4uc3R5bGUub3BhY2l0eSA9ICcxJztcclxuICAgIH1cclxuICB9IGNhdGNoIChlKSB7XHJcbiAgICBjb25zb2xlLmVycm9yKCdbRk9SRUNBU1RdIHBhcnNlIGVycm9yOicsIGUpO1xyXG4gICAgYWxlcnQoJ0Vycm9yIHByb2Nlc2FuZG8gZWwgRXhjZWw6XFxuJyArICgoZSAmJiBlLm1lc3NhZ2UpIHx8IGUpKTtcclxuICB9IGZpbmFsbHkge1xyXG4gICAgLy8gUmVzZXQgaW5wdXQgcGFyYSBxdWUgZWwgbWlzbW8gYXJjaGl2byBzZSBwdWVkYSByZS1zdWJpclxyXG4gICAgaWYgKGV2ZW50ICYmIGV2ZW50LnRhcmdldCkgZXZlbnQudGFyZ2V0LnZhbHVlID0gJyc7XHJcbiAgfVxyXG59O1xyXG5cclxud2luZG93LmV4cG9ydEZvcmVjYXN0RXhjZWwgPSBmdW5jdGlvbiAoKSB7XHJcbiAgaWYgKCFfZm9yZWNhc3RSb3dzIHx8ICFfZm9yZWNhc3RSb3dzLmxlbmd0aCkge1xyXG4gICAgYWxlcnQoJ05vIGhheSBkYXRvcyBwYXJhIGV4cG9ydGFyLiBDYXJnYSBwcmltZXJvIGVsIFNhbGVzIFBsYW4uJyk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIGlmICh0eXBlb2YgWExTWCA9PT0gJ3VuZGVmaW5lZCcpIHtcclxuICAgIGFsZXJ0KCdYTFNYIG5vIGNhcmdhZG8nKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgY29uc3Qgcm91bmQxID0gKG4pID0+IE1hdGgucm91bmQoTnVtYmVyKG4gfHwgMCkgKiAxMCkgLyAxMDtcclxuICBjb25zdCBhb2EgPSBbXHJcbiAgICBbXHJcbiAgICAgICdTS1UnLFxyXG4gICAgICAnRkFNSUxJQScsXHJcbiAgICAgICdTVUJGQU1JTElBJyxcclxuICAgICAgJ1ZFTlRBUyAoMTJtKScsXHJcbiAgICAgICdQRURJRE8tU0FMRVMgUExBTlMgKDZtKScsXHJcbiAgICAgICdQUk9NRURJTyBERSBJTlZFTlRBUklPJyxcclxuICAgICAgJ1BPTElUSUNBIERFIElOVkVOVEFSSU8gKDNtKScsXHJcbiAgICAgICdUT1RBTCcsXHJcbiAgICBdLFxyXG4gIF07XHJcbiAgZm9yIChjb25zdCByIG9mIF9mb3JlY2FzdFJvd3MpIHtcclxuICAgIGFvYS5wdXNoKFtcclxuICAgICAgci5za3UsXHJcbiAgICAgIHIuZmFtaWxpYSxcclxuICAgICAgci5zdWJmYW1pbGlhLFxyXG4gICAgICByb3VuZDEoci52ZW50YXMxMm0pLFxyXG4gICAgICByb3VuZDEoci5wZWRpZG82bSksXHJcbiAgICAgIHJvdW5kMShyLnByb21lZGlvKSxcclxuICAgICAgcm91bmQxKHIucG9saXRpY2EpLFxyXG4gICAgICByb3VuZDEoci50b3RhbCksXHJcbiAgICBdKTtcclxuICB9XHJcbiAgY29uc3Qgd3MgPSBYTFNYLnV0aWxzLmFvYV90b19zaGVldChhb2EpO1xyXG4gIC8vIEFuY2hvcyBkZSBjb2x1bW5hXHJcbiAgd3NbJyFjb2xzJ10gPSBbXHJcbiAgICB7IHdjaDogMTggfSxcclxuICAgIHsgd2NoOiAyNCB9LFxyXG4gICAgeyB3Y2g6IDI0IH0sXHJcbiAgICB7IHdjaDogMTQgfSxcclxuICAgIHsgd2NoOiAyMCB9LFxyXG4gICAgeyB3Y2g6IDIwIH0sXHJcbiAgICB7IHdjaDogMjIgfSxcclxuICAgIHsgd2NoOiAxMiB9LFxyXG4gIF07XHJcbiAgY29uc3Qgd2IgPSBYTFNYLnV0aWxzLmJvb2tfbmV3KCk7XHJcbiAgWExTWC51dGlscy5ib29rX2FwcGVuZF9zaGVldCh3Yiwgd3MsICdGT1JFQ0FTVCcpO1xyXG4gIGNvbnN0IGhveSA9IG5ldyBEYXRlKCk7XHJcbiAgY29uc3Qgc3RhbXAgPVxyXG4gICAgaG95LmdldEZ1bGxZZWFyKCkgK1xyXG4gICAgJy0nICtcclxuICAgIFN0cmluZyhob3kuZ2V0TW9udGgoKSArIDEpLnBhZFN0YXJ0KDIsICcwJykgK1xyXG4gICAgJy0nICtcclxuICAgIFN0cmluZyhob3kuZ2V0RGF0ZSgpKS5wYWRTdGFydCgyLCAnMCcpO1xyXG4gIFhMU1gud3JpdGVGaWxlKHdiLCAnRm9yZWNhc3RfU2hpbWFub18nICsgc3RhbXAgKyAnLnhsc3gnKTtcclxufTtcclxuXHJcbi8vIFJlZnJlc2ggcHVibGljbyAocG9yIHNpIGVsIHVzZXIgbmVjZXNpdGEgcmUtZmV0Y2hlYXIgZWwgc25hcHNob3Qgc2luIGNlcnJhclxyXG4vLyBlbCBtb2RhbCwgZWo6IHBhc2Fyb24gMzAgbWluIHkgZWwgY3JvbiBCUSBhY3R1YWxpem8gbGEgY29sZWNjaW9uKS5cclxud2luZG93LnJlbG9hZEZvcmVjYXN0U25hcHNob3QgPSBhc3luYyBmdW5jdGlvbiAoKSB7XHJcbiAgX2ZvcmVjYXN0U25hcHNob3QgPSBudWxsO1xyXG4gIGF3YWl0IF9sb2FkU25hcHNob3QoKTtcclxuICBpZiAoX2ZvcmVjYXN0U2FsZXNQbGFuKSB7XHJcbiAgICBjb25zdCBob3kgPSBuZXcgRGF0ZSgpO1xyXG4gICAgX2ZvcmVjYXN0Um93cyA9IF9jb21wdXRlRm9yZWNhc3RSb3dzKF9mb3JlY2FzdFNuYXBzaG90LCBfZm9yZWNhc3RTYWxlc1BsYW4sIGhveSk7XHJcbiAgICBfcmVuZGVyVGFibGUoX2ZvcmVjYXN0Um93cyk7XHJcbiAgfVxyXG59O1xyXG4iXSwKICAibWFwcGluZ3MiOiAiOzs7QUFZQSxNQUFNLGdCQUFnQjtBQUFBLElBQ3BCLEtBQUs7QUFBQSxJQUNMLFNBQVM7QUFBQSxJQUNULEtBQUs7QUFBQSxJQUNMLE9BQU87QUFBQSxJQUNQLEtBQUs7QUFBQSxJQUNMLFVBQVU7QUFBQSxJQUNWLFNBQVM7QUFBQSxJQUNULEtBQUs7QUFBQSxJQUNMLE9BQU87QUFBQSxJQUNQLE9BQU87QUFBQSxJQUNQLEtBQUs7QUFBQSxJQUNMLE9BQU87QUFBQSxJQUNQLEtBQUs7QUFBQSxJQUNMLE9BQU87QUFBQSxJQUNQLEtBQUs7QUFBQSxJQUNMLE1BQU07QUFBQSxJQUNOLEtBQUs7QUFBQSxJQUNMLE1BQU07QUFBQSxJQUNOLE9BQU87QUFBQSxJQUNQLEtBQUs7QUFBQSxJQUNMLE1BQU07QUFBQSxJQUNOLE9BQU87QUFBQSxJQUNQLEtBQUs7QUFB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LEVBQUUsSUFBSTtBQUN4RCxVQUFNLE1BQU07QUFBQSxNQUNWO0FBQUEsUUFDRTtBQUFBLFFBQ0E7QUFBQSxRQUNBO0FBQUEsUUFDQTtBQUFBLFFBQ0E7QUFBQSxRQUNBO0FBQUEsUUFDQTtBQUFBLFFBQ0E7QUFBQSxNQUNGO0FBQUEsSUFDRjtBQUNBLGVBQVcsS0FBSyxlQUFlO0FBQzdCLFVBQUksS0FBSztBQUFBLFFBQ1AsRUFBRTtBQUFBLFFBQ0YsRUFBRTtBQUFBLFFBQ0YsRUFBRTtBQUFBLFFBQ0YsT0FBTyxFQUFFLFNBQVM7QUFBQSxRQUNsQixPQUFPLEVBQUUsUUFBUTtBQUFBLFFBQ2pCLE9BQU8sRUFBRSxRQUFRO0FBQUEsUUFDakIsT0FBTyxFQUFFLFFBQVE7QUFBQSxRQUNqQixPQUFPLEVBQUUsS0FBSztBQUFBLE1BQ2hCLENBQUM7QUFBQSxJQUNIO0FBQ0EsVUFBTSxLQUFLLEtBQUssTUFBTSxhQUFhLEdBQUc7QUFFdEMsT0FBRyxPQUFPLElBQUk7QUFBQSxNQUNaLEVBQUUsS0FBSyxHQUFHO0FBQUEsTUFDVixFQUFFLEtBQUssR0FBRztBQUFBLE1BQ1YsRUFBRSxLQUFLLEdBQUc7QUFBQSxNQUNWLEVBQUUsS0FBSyxHQUFHO0FBQUEsTUFDVixFQUFFLEtBQUssR0FBRztBQUFBLE1BQ1YsRUFBRSxLQUFLLEdBQUc7QUFBQSxNQUNWLEVBQUUsS0FBSyxHQUFHO0FBQUEsTUFDVixFQUFFLEtBQUssR0FBRztBQUFBLElBQ1o7QUFDQSxVQUFNLEtBQUssS0FBSyxNQUFNLFNBQVM7QUFDL0IsU0FBSyxNQUFNLGtCQUFrQixJQUFJLElBQUksVUFBVTtBQUMvQyxVQUFNLE1BQU0sb0JBQUksS0FBSztBQUNyQixVQUFNLFFBQ0osSUFBSSxZQUFZLElBQ2hCLE1BQ0EsT0FBTyxJQUFJLFNBQVMsSUFBSSxDQUFDLEVBQUUsU0FBUyxHQUFHLEdBQUcsSUFDMUMsTUFDQSxPQUFPLElBQUksUUFBUSxDQUFDLEVBQUUsU0FBUyxHQUFHLEdBQUc7QUFDdkMsU0FBSyxVQUFVLElBQUksc0JBQXNCLFFBQVEsT0FBTztBQUFBLEVBQzFEO0FBSUEsU0FBTyx5QkFBeUIsaUJBQWtCO0FBQ2hELHdCQUFvQjtBQUNwQixVQUFNLGNBQWM7QUFDcEIsUUFBSSxvQkFBb0I7QUFDdEIsWUFBTSxNQUFNLG9CQUFJLEtBQUs7QUFDckIsc0JBQWdCLHFCQUFxQixtQkFBbUIsb0JBQW9CLEdBQUc7QUFDL0UsbUJBQWEsYUFBYTtBQUFBLElBQzVCO0FBQUEsRUFDRjsiLAogICJuYW1lcyI6IFtdCn0K
