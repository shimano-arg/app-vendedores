"use strict";
(() => {
  // src/pure/cartera-vendor-filter.js
  function applyChipFilter(clientes, chip) {
    if (!Array.isArray(clientes)) return [];
    switch (chip) {
      case "baseActiva90d":
        return clientes.filter(
          (c) => c.diasSinCompra !== null && c.diasSinCompra !== void 0 && c.diasSinCompra <= 90
        );
      case "dormidosVisita30d":
        return clientes.filter(
          (c) => c.diasSinVisitaPresencial !== null && c.diasSinVisitaPresencial !== void 0 && c.diasSinVisitaPresencial > 30
        );
      case "dormidosCompra90d":
        return clientes.filter(
          (c) => c.diasSinCompra !== null && c.diasSinCompra !== void 0 && c.diasSinCompra > 90
        );
      case "nuncaVisitados":
        return clientes.filter(
          (c) => c.ultimaVisitaPresencial === null || c.ultimaVisitaPresencial === void 0
        );
      case "nuncaCompraron":
        return clientes.filter((c) => c.ultimaCompra === null || c.ultimaCompra === void 0);
      default:
        return clientes.slice();
    }
  }
  function sortClientes(clientes, sortBy2, sortDir2) {
    if (!Array.isArray(clientes)) return [];
    const dir = sortDir2 === "asc" ? 1 : -1;
    const copy = clientes.slice();
    copy.sort((a, b) => {
      const av = a[sortBy2];
      const bv = b[sortBy2];
      const aNull = av === null || av === void 0;
      const bNull = bv === null || bv === void 0;
      if (aNull && bNull) return 0;
      if (aNull) return 1;
      if (bNull) return -1;
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
    return copy;
  }

  // src/domains/cartera-vendor.js
  var carteraDocCache = /* @__PURE__ */ new Map();
  var selectedVendor = null;
  var activeChip = "todos";
  var searchQuery = "";
  var sortBy = "diasSinCompra";
  var sortDir = "desc";
  var CHIPS = [
    { id: "todos", label: "Todos" },
    { id: "baseActiva90d", label: "Base activa 90d" },
    { id: "dormidosVisita30d", label: "Dormidos visita 30d" },
    { id: "dormidosCompra90d", label: "Dormidos compra 90d" },
    { id: "nuncaVisitados", label: "Nunca visitados" },
    { id: "nuncaCompraron", label: "Nunca compraron" }
  ];
  var KPI_CARDS = [
    { chip: "todos", label: "Total cartera", color: "#64748b" },
    { chip: "baseActiva90d", label: "Base activa 90d", color: "#16a34a" },
    { chip: "dormidosVisita30d", label: "Dormidos vis 30d", color: "#ea580c" },
    { chip: "dormidosCompra90d", label: "Dormidos com 90d", color: "#dc2626" },
    { chip: "nuncaVisitados", label: "Nunca visitados", color: "#7c3aed" },
    { chip: "nuncaCompraron", label: "Nunca compraron", color: "#be185d" }
  ];
  var VENDORS_WHITELIST = /* @__PURE__ */ new Set([
    "FEDERICO CASTELANELLI",
    "GONZALO DE LA ROSA",
    "IOANNIS PALKOUDAKIS",
    "MAURICIO GIL",
    "PACHI",
    "SANTIAGO ESTEBAN"
  ]);
  window.openCarteraModal = async function openCarteraModal() {
    const modal = document.getElementById("cartera-modal");
    if (!modal) return;
    modal.classList.add("open");
    await populateVendorDropdown();
  };
  window.closeCarteraModal = function closeCarteraModal() {
    const modal = document.getElementById("cartera-modal");
    if (modal) modal.classList.remove("open");
  };
  async function populateVendorDropdown() {
    const sel = (
      /** @type {HTMLSelectElement|null} */
      document.getElementById("cartera-vendor-select")
    );
    if (!sel) return;
    if (sel.options.length > 1) return;
    try {
      const snap = await firebase.firestore().collection("cartera_vendor").get();
      const vendors = [];
      snap.forEach((doc) => {
        if (VENDORS_WHITELIST.has(doc.id)) vendors.push(doc.id);
      });
      vendors.sort();
      for (const v of vendors) {
        const opt = document.createElement("option");
        opt.value = v;
        opt.textContent = v;
        sel.appendChild(opt);
      }
    } catch (e) {
      console.error("populateVendorDropdown failed", e);
    }
  }
  window.onCarteraVendorChange = async function onCarteraVendorChange() {
    const sel = (
      /** @type {HTMLSelectElement|null} */
      document.getElementById("cartera-vendor-select")
    );
    if (!sel) return;
    selectedVendor = sel.value || null;
    activeChip = "todos";
    searchQuery = "";
    const searchInput = (
      /** @type {HTMLInputElement|null} */
      document.getElementById("cartera-search")
    );
    if (searchInput) searchInput.value = "";
    if (!selectedVendor) {
      showEmpty();
      return;
    }
    showLoading();
    try {
      let doc = carteraDocCache.get(selectedVendor);
      if (!doc) {
        const snap = await firebase.firestore().collection("cartera_vendor").doc(selectedVendor).get();
        if (!snap.exists) {
          showNoData();
          return;
        }
        doc = snap.data();
        carteraDocCache.set(selectedVendor, doc);
      }
      renderDashboard(doc);
    } catch (e) {
      console.error("onCarteraVendorChange failed", e);
      showError(String(e));
    }
  };
  window.onCarteraChipClick = function onCarteraChipClick(chipId) {
    activeChip = chipId;
    if (!selectedVendor) return;
    const doc = carteraDocCache.get(selectedVendor);
    if (doc) renderDashboard(doc);
  };
  var searchDebounceTimer = null;
  window.onCarteraSearchChange = function onCarteraSearchChange() {
    const input = (
      /** @type {HTMLInputElement|null} */
      document.getElementById("cartera-search")
    );
    if (!input) return;
    if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
      searchQuery = (input.value || "").trim().toLowerCase();
      if (!selectedVendor) return;
      const doc = carteraDocCache.get(selectedVendor);
      if (doc) renderDashboard(doc);
    }, 300);
  };
  window.onCarteraSortClick = function onCarteraSortClick(colKey) {
    if (sortBy === colKey) sortDir = sortDir === "asc" ? "desc" : "asc";
    else {
      sortBy = colKey;
      sortDir = "desc";
    }
    if (!selectedVendor) return;
    const doc = carteraDocCache.get(selectedVendor);
    if (doc) renderDashboard(doc);
  };
  function renderDashboard(doc) {
    const subtitle = document.getElementById("cartera-subtitle");
    if (subtitle) subtitle.textContent = `${doc.counts.total} clientes en cartera.`;
    const info = document.getElementById("cartera-snapshot-info");
    if (info) {
      info.textContent = `Snapshot ${doc.snapshotDate}`;
      info.style.display = "inline-flex";
    }
    renderKpis(doc.counts);
    renderChips(doc.counts);
    renderTable(doc.clientes);
    showTable();
  }
  function renderKpis(counts) {
    const el = document.getElementById("cartera-kpis");
    if (!el) return;
    while (el.firstChild) el.removeChild(el.firstChild);
    for (const spec of KPI_CARDS) {
      const card = document.createElement("div");
      card.className = "cartera-kpi";
      if (activeChip === spec.chip) card.classList.add("active");
      card.style.color = spec.color;
      card.addEventListener("click", () => (
        /** @type {any} */
        window.onCarteraChipClick(spec.chip)
      ));
      const n = document.createElement("div");
      n.className = "cartera-kpi-num";
      n.textContent = String(counts[spec.chip === "todos" ? "total" : spec.chip]);
      const l = document.createElement("div");
      l.className = "cartera-kpi-label";
      l.style.color = "";
      l.textContent = spec.label;
      card.appendChild(n);
      card.appendChild(l);
      el.appendChild(card);
    }
  }
  function renderChips(counts) {
    const el = document.getElementById("cartera-chips");
    if (!el) return;
    const countByChip = {
      todos: counts.total,
      baseActiva90d: counts.baseActiva90d,
      dormidosVisita30d: counts.dormidosVisita30d,
      dormidosCompra90d: counts.dormidosCompra90d,
      nuncaVisitados: counts.nuncaVisitados,
      nuncaCompraron: counts.nuncaCompraron
    };
    while (el.firstChild) el.removeChild(el.firstChild);
    const wrap = document.createElement("div");
    wrap.className = "cartera-chip-wrap";
    for (const chip of CHIPS) {
      const b = document.createElement("button");
      b.className = "cartera-chip";
      if (activeChip === chip.id) b.classList.add("active");
      b.type = "button";
      b.textContent = `${chip.label} (${countByChip[chip.id]})`;
      b.addEventListener("click", () => (
        /** @type {any} */
        window.onCarteraChipClick(chip.id)
      ));
      wrap.appendChild(b);
    }
    el.appendChild(wrap);
  }
  function renderTable(clientes) {
    const table = document.getElementById("cartera-table");
    if (!table) return;
    const filtered = applyChipFilter(clientes, activeChip);
    const searched = searchQuery ? filtered.filter(
      (c) => String(c.clientName || "").toLowerCase().includes(searchQuery)
    ) : filtered;
    const sorted = sortClientes(searched, sortBy, sortDir);
    while (table.firstChild) table.removeChild(table.firstChild);
    table.appendChild(buildThead());
    table.appendChild(buildTbody(sorted));
  }
  function buildThead() {
    const thead = document.createElement("thead");
    const tr = document.createElement("tr");
    const headers = [
      { label: "Cliente", sortKey: "clientName", align: "left" },
      { label: "Prov/Loc", sortKey: null, align: "left" },
      { label: "Tipo", sortKey: null, align: "center" },
      { label: "\xDAlt. visita", sortKey: "diasSinVisitaPresencial", align: "left" },
      { label: "\xDAlt. contacto", sortKey: "diasSinContacto", align: "left" },
      { label: "\xDAlt. compra", sortKey: "diasSinCompra", align: "left" },
      { label: "Fact 12M", sortKey: "facturado12M", align: "right" },
      { label: "Deuda", sortKey: "deudaAbierta", align: "right" }
    ];
    for (const h of headers) {
      const th = document.createElement("th");
      th.style.textAlign = h.align;
      th.textContent = h.label;
      if (h.sortKey) {
        th.style.cursor = "pointer";
        const key = h.sortKey;
        th.addEventListener("click", () => (
          /** @type {any} */
          window.onCarteraSortClick(key)
        ));
      }
      tr.appendChild(th);
    }
    thead.appendChild(tr);
    return thead;
  }
  function buildTbody(sortedClientes) {
    const tbody = document.createElement("tbody");
    for (const c of sortedClientes) {
      tbody.appendChild(buildClienteRow(c));
    }
    return tbody;
  }
  function buildClienteRow(c) {
    const tr = document.createElement("tr");
    tr.style.cssText = "cursor:pointer;border-bottom:1px solid var(--border-light)";
    tr.addEventListener("mouseenter", () => {
      tr.style.background = "var(--bg-hover)";
    });
    tr.addEventListener("mouseleave", () => {
      tr.style.background = "";
    });
    tr.addEventListener("click", () => {
      if (typeof window.openFichaCliente === "function") window.openFichaCliente(c.clientId);
    });
    const tdName = document.createElement("td");
    tdName.style.cssText = "padding:6px 8px;font-weight:600";
    tdName.textContent = c.clientName || "";
    tr.appendChild(tdName);
    const tdLoc = document.createElement("td");
    tdLoc.style.cssText = "padding:6px 8px;font-size:12px;color:var(--text-muted)";
    tdLoc.textContent = `${c.provincia || ""}/${c.localidad || ""}`;
    tr.appendChild(tdLoc);
    const tdTipo = document.createElement("td");
    tdTipo.style.cssText = "padding:6px 8px;text-align:center";
    const tipoBadge = document.createElement("span");
    tipoBadge.style.cssText = "padding:2px 6px;border-radius:4px;background:var(--bg-input);font-size:11px;font-weight:700";
    tipoBadge.textContent = c.cliTipo || "-";
    tdTipo.appendChild(tipoBadge);
    tr.appendChild(tdTipo);
    tr.appendChild(buildDateCell(c.ultimaVisitaPresencial, c.diasSinVisitaPresencial, 30));
    tr.appendChild(buildDateCell(c.ultimoContacto, c.diasSinContacto, null));
    tr.appendChild(buildDateCell(c.ultimaCompra, c.diasSinCompra, 90));
    const tdFact = document.createElement("td");
    tdFact.style.cssText = "padding:6px 8px;text-align:right;font-variant-numeric:tabular-nums";
    tdFact.textContent = fmtMoney(c.facturado12M);
    tr.appendChild(tdFact);
    const tdDeuda = document.createElement("td");
    tdDeuda.style.cssText = `padding:6px 8px;text-align:right;font-variant-numeric:tabular-nums;color:${c.deudaAbierta > 0 ? "#dc2626" : "var(--text-muted)"}`;
    tdDeuda.textContent = fmtMoney(c.deudaAbierta);
    tr.appendChild(tdDeuda);
    return tr;
  }
  function buildDateCell(fechaIso, dias, dangerThreshold) {
    const td = document.createElement("td");
    const isDanger = dangerThreshold !== null && dias !== null && dias !== void 0 && dias > dangerThreshold;
    td.style.cssText = `padding:6px 8px;color:${isDanger ? "#dc2626" : "var(--text-primary)"}`;
    if (!fechaIso) {
      td.textContent = "\u2014";
      return td;
    }
    const parts = String(fechaIso).split("-");
    const d = parts[2] || "";
    const m = parts[1] || "";
    td.textContent = `${d}/${m}`;
    const diasEl = document.createElement("small");
    diasEl.style.cssText = "color:var(--text-muted);margin-left:4px";
    diasEl.textContent = `${dias}d`;
    td.appendChild(diasEl);
    return td;
  }
  function fmtMoney(n) {
    if (!n || n === 0) return "-";
    if (n >= 1e6) return `$ ${(n / 1e6).toFixed(1)}M`;
    if (n >= 1e3) return `$ ${(n / 1e3).toFixed(0)}k`;
    return `$ ${n}`;
  }
  function hideAll() {
    const ids = [
      "cartera-loading",
      "cartera-table",
      "cartera-kpis",
      "cartera-chips",
      "cartera-empty"
    ];
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) el.style.display = "none";
    }
  }
  function showEmpty() {
    hideAll();
    const empty = document.getElementById("cartera-empty");
    if (empty) {
      empty.style.display = "block";
      empty.textContent = "Eleg\xED un vendedor para ver su cartera.";
    }
  }
  function showLoading() {
    hideAll();
    const loading = document.getElementById("cartera-loading");
    if (loading) loading.style.display = "block";
  }
  function showNoData() {
    hideAll();
    const empty = document.getElementById("cartera-empty");
    if (empty) {
      empty.style.display = "block";
      empty.textContent = "Sin cartera para este vendedor. Verific\xE1 assignedVendor en client_master o esper\xE1 al pr\xF3ximo snapshot (04:00 ART).";
    }
  }
  function showError(msg) {
    hideAll();
    const empty = document.getElementById("cartera-empty");
    if (empty) {
      empty.style.display = "block";
      empty.style.color = "#dc2626";
      empty.textContent = `Error cargando cartera: ${msg}`;
    }
  }
  function showTable() {
    const empty = document.getElementById("cartera-empty");
    if (empty) empty.style.display = "none";
    const loading = document.getElementById("cartera-loading");
    if (loading) loading.style.display = "none";
    const table = document.getElementById("cartera-table");
    if (table) table.style.display = "table";
    const kpis = document.getElementById("cartera-kpis");
    if (kpis) kpis.style.display = "";
    const chips = document.getElementById("cartera-chips");
    if (chips) chips.style.display = "";
  }
  window.exportCarteraToExcel = async function exportCarteraToExcel() {
    if (!selectedVendor) {
      alert("Eleg\xED un vendedor primero.");
      return;
    }
    const doc = carteraDocCache.get(selectedVendor);
    if (!doc) {
      alert("Sin data cargada.");
      return;
    }
    const filtered = applyChipFilter(doc.clientes, activeChip);
    const searched = searchQuery ? filtered.filter(
      (c) => String(c.clientName || "").toLowerCase().includes(searchQuery)
    ) : filtered;
    const sorted = sortClientes(searched, sortBy, sortDir);
    const chipLabel = (CHIPS.find((c) => c.id === activeChip) || { label: "Todos" }).label;
    const title = `Cartera de ${selectedVendor} \u2014 ${chipLabel} \u2014 Snapshot ${doc.snapshotDate}`;
    try {
      if (typeof window.loadExcelJS === "function") {
        await window.loadExcelJS();
      }
      const ExcelJS = window.ExcelJS;
      if (!ExcelJS) throw new Error("ExcelJS no disponible");
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet("Cartera");
      ws.mergeCells("A1:L1");
      const titleCell = ws.getCell("A1");
      titleCell.value = title;
      titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF22C55E" } };
      titleCell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 14 };
      titleCell.alignment = { horizontal: "center", vertical: "middle" };
      ws.getRow(1).height = 30;
      const headers = [
        "Cliente",
        "Provincia",
        "Localidad",
        "Tipo",
        "\xDAltima visita presencial",
        "\xDAltimo contacto",
        "\xDAltima compra",
        "Fact 12M (ARS)",
        "Deuda abierta (ARS)",
        "D\xEDas sin visita",
        "D\xEDas sin compra",
        "CardCode SAP"
      ];
      const headerRow = ws.getRow(2);
      headers.forEach((h, i) => {
        const cell = headerRow.getCell(i + 1);
        cell.value = h;
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF074F69" } };
        cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
        cell.alignment = { horizontal: "center" };
      });
      sorted.forEach((c, i) => {
        const row = ws.getRow(3 + i);
        row.getCell(1).value = c.clientName || "";
        row.getCell(2).value = c.provincia || "";
        row.getCell(3).value = c.localidad || "";
        row.getCell(4).value = c.cliTipo || "";
        row.getCell(5).value = c.ultimaVisitaPresencial || "";
        row.getCell(6).value = c.ultimoContacto || "";
        row.getCell(7).value = c.ultimaCompra || "";
        row.getCell(8).value = c.facturado12M || 0;
        row.getCell(8).numFmt = '"$"#,##0';
        row.getCell(9).value = c.deudaAbierta || 0;
        row.getCell(9).numFmt = '"$"#,##0';
        row.getCell(10).value = c.diasSinVisitaPresencial;
        row.getCell(11).value = c.diasSinCompra;
        row.getCell(12).value = c.cardCode || "";
      });
      ws.columns.forEach((col, i) => {
        col.width = i === 0 ? 30 : i === 4 || i === 5 || i === 6 ? 18 : 14;
      });
      const buf = await wb.xlsx.writeBuffer();
      const blob = new Blob([buf], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Cartera_${String(selectedVendor).replace(/\s+/g, "_")}_${activeChip}_${doc.snapshotDate}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("exportCarteraToExcel failed", e);
      alert("Error exportando: " + String(e));
    }
  };
})();
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL3B1cmUvY2FydGVyYS12ZW5kb3ItZmlsdGVyLmpzIiwgIi4uL3NyYy9kb21haW5zL2NhcnRlcmEtdmVuZG9yLmpzIl0sCiAgInNvdXJjZXNDb250ZW50IjogWyIvLyBAdHMtY2hlY2tcclxuLyoqXHJcbiAqIGNhcnRlcmEtdmVuZG9yLWZpbHRlci5qcyAodjEyODMsIDIwMjYtMTAtMjApXHJcbiAqXHJcbiAqIFB1cmFzIHBhcmEgZmlsdHJhciB5IG9yZGVuYXIgbGEgdGFibGEgZGVsIGRhc2hib2FyZCBcIkFuYWxpc2lzIGRlIENhcnRlcmFcIi5cclxuICogSW1wb3J0YWRvIHBvciBzcmMvZG9tYWlucy9jYXJ0ZXJhLXZlbmRvci5qcyAoYnVuZGxlIGZyb250ZW5kKS5cclxuICogVGVzdGVhZG8gZW4gdGVzdHMvdW5pdC9jYXJ0ZXJhLXZlbmRvci1maWx0ZXIudGVzdC5qcy5cclxuICovXHJcblxyXG4vKipcclxuICogQXBsaWNhIHVuIGNoaXAgZGUgZmlsdHJvIGFsIGFycmF5IGRlIGNsaWVudGVzLlxyXG4gKiBAcGFyYW0ge0FycmF5PGFueT59IGNsaWVudGVzXHJcbiAqIEBwYXJhbSB7c3RyaW5nfSBjaGlwXHJcbiAqIEByZXR1cm5zIHtBcnJheTxhbnk+fVxyXG4gKi9cclxuZXhwb3J0IGZ1bmN0aW9uIGFwcGx5Q2hpcEZpbHRlcihjbGllbnRlcywgY2hpcCkge1xyXG4gIGlmICghQXJyYXkuaXNBcnJheShjbGllbnRlcykpIHJldHVybiBbXTtcclxuICBzd2l0Y2ggKGNoaXApIHtcclxuICAgIGNhc2UgJ2Jhc2VBY3RpdmE5MGQnOlxyXG4gICAgICByZXR1cm4gY2xpZW50ZXMuZmlsdGVyKFxyXG4gICAgICAgIChjKSA9PiBjLmRpYXNTaW5Db21wcmEgIT09IG51bGwgJiYgYy5kaWFzU2luQ29tcHJhICE9PSB1bmRlZmluZWQgJiYgYy5kaWFzU2luQ29tcHJhIDw9IDkwXHJcbiAgICAgICk7XHJcbiAgICBjYXNlICdkb3JtaWRvc1Zpc2l0YTMwZCc6XHJcbiAgICAgIHJldHVybiBjbGllbnRlcy5maWx0ZXIoXHJcbiAgICAgICAgKGMpID0+XHJcbiAgICAgICAgICBjLmRpYXNTaW5WaXNpdGFQcmVzZW5jaWFsICE9PSBudWxsICYmXHJcbiAgICAgICAgICBjLmRpYXNTaW5WaXNpdGFQcmVzZW5jaWFsICE9PSB1bmRlZmluZWQgJiZcclxuICAgICAgICAgIGMuZGlhc1NpblZpc2l0YVByZXNlbmNpYWwgPiAzMFxyXG4gICAgICApO1xyXG4gICAgY2FzZSAnZG9ybWlkb3NDb21wcmE5MGQnOlxyXG4gICAgICByZXR1cm4gY2xpZW50ZXMuZmlsdGVyKFxyXG4gICAgICAgIChjKSA9PiBjLmRpYXNTaW5Db21wcmEgIT09IG51bGwgJiYgYy5kaWFzU2luQ29tcHJhICE9PSB1bmRlZmluZWQgJiYgYy5kaWFzU2luQ29tcHJhID4gOTBcclxuICAgICAgKTtcclxuICAgIGNhc2UgJ251bmNhVmlzaXRhZG9zJzpcclxuICAgICAgcmV0dXJuIGNsaWVudGVzLmZpbHRlcihcclxuICAgICAgICAoYykgPT4gYy51bHRpbWFWaXNpdGFQcmVzZW5jaWFsID09PSBudWxsIHx8IGMudWx0aW1hVmlzaXRhUHJlc2VuY2lhbCA9PT0gdW5kZWZpbmVkXHJcbiAgICAgICk7XHJcbiAgICBjYXNlICdudW5jYUNvbXByYXJvbic6XHJcbiAgICAgIHJldHVybiBjbGllbnRlcy5maWx0ZXIoKGMpID0+IGMudWx0aW1hQ29tcHJhID09PSBudWxsIHx8IGMudWx0aW1hQ29tcHJhID09PSB1bmRlZmluZWQpO1xyXG4gICAgZGVmYXVsdDpcclxuICAgICAgcmV0dXJuIGNsaWVudGVzLnNsaWNlKCk7XHJcbiAgfVxyXG59XHJcblxyXG4vKipcclxuICogT3JkZW5hIHVuYSBjb3BpYSBkZWwgYXJyYXkgcG9yIGNvbHVtbmEuIE51bGxzIHNpZW1wcmUgYWwgZmluYWwuXHJcbiAqIEBwYXJhbSB7QXJyYXk8YW55Pn0gY2xpZW50ZXNcclxuICogQHBhcmFtIHtzdHJpbmd9IHNvcnRCeVxyXG4gKiBAcGFyYW0geydhc2MnfCdkZXNjJ30gc29ydERpclxyXG4gKiBAcmV0dXJucyB7QXJyYXk8YW55Pn1cclxuICovXHJcbmV4cG9ydCBmdW5jdGlvbiBzb3J0Q2xpZW50ZXMoY2xpZW50ZXMsIHNvcnRCeSwgc29ydERpcikge1xyXG4gIGlmICghQXJyYXkuaXNBcnJheShjbGllbnRlcykpIHJldHVybiBbXTtcclxuICBjb25zdCBkaXIgPSBzb3J0RGlyID09PSAnYXNjJyA/IDEgOiAtMTtcclxuICBjb25zdCBjb3B5ID0gY2xpZW50ZXMuc2xpY2UoKTtcclxuICBjb3B5LnNvcnQoKGEsIGIpID0+IHtcclxuICAgIGNvbnN0IGF2ID0gYVtzb3J0QnldO1xyXG4gICAgY29uc3QgYnYgPSBiW3NvcnRCeV07XHJcbiAgICBjb25zdCBhTnVsbCA9IGF2ID09PSBudWxsIHx8IGF2ID09PSB1bmRlZmluZWQ7XHJcbiAgICBjb25zdCBiTnVsbCA9IGJ2ID09PSBudWxsIHx8IGJ2ID09PSB1bmRlZmluZWQ7XHJcbiAgICBpZiAoYU51bGwgJiYgYk51bGwpIHJldHVybiAwO1xyXG4gICAgaWYgKGFOdWxsKSByZXR1cm4gMTtcclxuICAgIGlmIChiTnVsbCkgcmV0dXJuIC0xO1xyXG4gICAgaWYgKHR5cGVvZiBhdiA9PT0gJ251bWJlcicgJiYgdHlwZW9mIGJ2ID09PSAnbnVtYmVyJykgcmV0dXJuIChhdiAtIGJ2KSAqIGRpcjtcclxuICAgIHJldHVybiBTdHJpbmcoYXYpLmxvY2FsZUNvbXBhcmUoU3RyaW5nKGJ2KSkgKiBkaXI7XHJcbiAgfSk7XHJcbiAgcmV0dXJuIGNvcHk7XHJcbn1cclxuIiwgIi8vIEB0cy1ub2NoZWNrXHJcbi8vIE5PVEE6IEB0cy1ub2NoZWNrIGludGVuY2lvbmFsLiBFbCBjaHVuayBlcyBoZWF2eSBET00gKyB3aW5kb3cuKiBoYW5kbGVycyArXHJcbi8vIEZpcmVzdG9yZSBTREsgY29tcGF0IHY4LiBBbm90YXIgc3RyaWN0YW1lbnRlIGNhZGEgaGFuZGxlciBzZXJcdTAwRURhIHJ1aWRvIHNpblxyXG4vLyB2YWxvciBcdTIwMTQgbG9zIGhlbHBlcnMgcHVyb3MgcXVlIGltcG9ydGFtb3MgKC4uL3B1cmUvY2FydGVyYS12ZW5kb3ItZmlsdGVyLmpzKVxyXG4vLyB5IGVsIGNvcmUgKGZ1bmN0aW9ucy9jb3JlL2NhcnRlcmEtdmVuZG9yLWNvcmUuanMpIHNcdTAwRUQgdGllbmVuIEB0cy1jaGVjay5cclxuLyoqXHJcbiAqIGNhcnRlcmEtdmVuZG9yLmpzICh2MTI4MywgMjAyNi0xMC0yMCkgXHUyMDE0IGJ1bmRsZSBjaHVuayBsYXp5LlxyXG4gKlxyXG4gKiBEYXNoYm9hcmQgXCJBbmFsaXNpcyBkZSBDYXJ0ZXJhIHBvciBWZW5kZWRvclwiLiBSZWVtcGxhemEgc2VndWltaWVudG8uanMuXHJcbiAqIExlZSBjYXJ0ZXJhX3ZlbmRvci97dmVuZG9yS2V5fSBGaXJlc3RvcmUgKHNuYXBzaG90IG5pZ2h0bHkgMDQ6MDAgQVJUKS5cclxuICpcclxuICogVE9ETyBlbCBET00gcmVuZGVyIHVzYSBjcmVhdGVFbGVtZW50ICsgdGV4dENvbnRlbnQgKHBvbGljeSBhbnRpLVhTUywgbm8gaW5uZXJIVE1MKS5cclxuICpcclxuICogU3BlYzogZG9jcy9zdXBlcnBvd2Vycy9zcGVjcy8yMDI2LTEwLTIwLWNhcnRlcmEtdmVuZG9yLWFuYWxpc2lzLWRlc2lnbi5tZFxyXG4gKiBQbGFuOiBkb2NzL3N1cGVycG93ZXJzL3BsYW5zLzIwMjYtMTAtMjAtY2FydGVyYS12ZW5kb3ItYW5hbGlzaXMubWRcclxuICovXHJcblxyXG5pbXBvcnQgeyBhcHBseUNoaXBGaWx0ZXIsIHNvcnRDbGllbnRlcyB9IGZyb20gJy4uL3B1cmUvY2FydGVyYS12ZW5kb3ItZmlsdGVyLmpzJztcclxuXHJcbi8qKiBAdHlwZSB7TWFwPHN0cmluZywgYW55Pn0gKi9cclxuY29uc3QgY2FydGVyYURvY0NhY2hlID0gbmV3IE1hcCgpO1xyXG4vKiogQHR5cGUge3N0cmluZ3xudWxsfSAqL1xyXG5sZXQgc2VsZWN0ZWRWZW5kb3IgPSBudWxsO1xyXG5sZXQgYWN0aXZlQ2hpcCA9ICd0b2Rvcyc7XHJcbmxldCBzZWFyY2hRdWVyeSA9ICcnO1xyXG5sZXQgc29ydEJ5ID0gJ2RpYXNTaW5Db21wcmEnO1xyXG4vKiogQHR5cGUgeydhc2MnfCdkZXNjJ30gKi9cclxubGV0IHNvcnREaXIgPSAnZGVzYyc7XHJcblxyXG5jb25zdCBDSElQUyA9IFtcclxuICB7IGlkOiAndG9kb3MnLCBsYWJlbDogJ1RvZG9zJyB9LFxyXG4gIHsgaWQ6ICdiYXNlQWN0aXZhOTBkJywgbGFiZWw6ICdCYXNlIGFjdGl2YSA5MGQnIH0sXHJcbiAgeyBpZDogJ2Rvcm1pZG9zVmlzaXRhMzBkJywgbGFiZWw6ICdEb3JtaWRvcyB2aXNpdGEgMzBkJyB9LFxyXG4gIHsgaWQ6ICdkb3JtaWRvc0NvbXByYTkwZCcsIGxhYmVsOiAnRG9ybWlkb3MgY29tcHJhIDkwZCcgfSxcclxuICB7IGlkOiAnbnVuY2FWaXNpdGFkb3MnLCBsYWJlbDogJ051bmNhIHZpc2l0YWRvcycgfSxcclxuICB7IGlkOiAnbnVuY2FDb21wcmFyb24nLCBsYWJlbDogJ051bmNhIGNvbXByYXJvbicgfSxcclxuXTtcclxuXHJcbmNvbnN0IEtQSV9DQVJEUyA9IFtcclxuICB7IGNoaXA6ICd0b2RvcycsIGxhYmVsOiAnVG90YWwgY2FydGVyYScsIGNvbG9yOiAnIzY0NzQ4YicgfSxcclxuICB7IGNoaXA6ICdiYXNlQWN0aXZhOTBkJywgbGFiZWw6ICdCYXNlIGFjdGl2YSA5MGQnLCBjb2xvcjogJyMxNmEzNGEnIH0sXHJcbiAgeyBjaGlwOiAnZG9ybWlkb3NWaXNpdGEzMGQnLCBsYWJlbDogJ0Rvcm1pZG9zIHZpcyAzMGQnLCBjb2xvcjogJyNlYTU4MGMnIH0sXHJcbiAgeyBjaGlwOiAnZG9ybWlkb3NDb21wcmE5MGQnLCBsYWJlbDogJ0Rvcm1pZG9zIGNvbSA5MGQnLCBjb2xvcjogJyNkYzI2MjYnIH0sXHJcbiAgeyBjaGlwOiAnbnVuY2FWaXNpdGFkb3MnLCBsYWJlbDogJ051bmNhIHZpc2l0YWRvcycsIGNvbG9yOiAnIzdjM2FlZCcgfSxcclxuICB7IGNoaXA6ICdudW5jYUNvbXByYXJvbicsIGxhYmVsOiAnTnVuY2EgY29tcHJhcm9uJywgY29sb3I6ICcjYmUxODVkJyB9LFxyXG5dO1xyXG5cclxuLy8gdjEzODQgKDIwMjYtMTAtMjEpOiB3aGl0ZWxpc3QgZGUgbG9zIDYgVkRFIHJlYWxlcyBvcGVyYXRpdm9zIChwZWRpZG8gTWFyaWFubykuXHJcbi8vIEZpbHRyYSBlbCBkcm9wZG93biBwYXJhIGV4Y2x1aXIgcnVpZG8gZW4gY2xpZW50X2FwcGxpY2F0aW9ucy5hc3NpZ25lZFZlbmRvcjpcclxuLy8gJ0FETUlOX0xET09HMkY0TVdWTVhLUU9EOFlDQk9JUlUyTzInIChhZG1pbiB1aWQgcXVlIHF1ZWRvIGNvbW8gc3RyaW5nIHZlbmRvciksXHJcbi8vICdFTVBMRUFETycgKGFsdGFzIGludGVybmFzKSwgJ0RJRUdPIFZBTFNJJyAoZXgtVkRFIGNvbiAxIGNsaWVudGUgaGlzdG9yaWNvKS5cclxuLy8gU2kgZW4gZWwgZnV0dXJvIHNlIGluY29ycG9yYSB1biBudWV2byBWREUsIGFncmVnYXJsbyBhcXVpICsgdmVyaWZpY2FyIHF1ZSBsYVxyXG4vLyB2aXN0YSBCUSB2X2NhcnRlcmFfdmVuZG9yIGxvIGNhbm9uaWNhbGl6ZSBpZ3VhbCAodmVyIGJpZ3F1ZXJ5L3ZpZXdzLnNxbDozNDgwKS5cclxuY29uc3QgVkVORE9SU19XSElURUxJU1QgPSBuZXcgU2V0KFtcclxuICAnRkVERVJJQ08gQ0FTVEVMQU5FTExJJyxcclxuICAnR09OWkFMTyBERSBMQSBST1NBJyxcclxuICAnSU9BTk5JUyBQQUxLT1VEQUtJUycsXHJcbiAgJ01BVVJJQ0lPIEdJTCcsXHJcbiAgJ1BBQ0hJJyxcclxuICAnU0FOVElBR08gRVNURUJBTicsXHJcbl0pO1xyXG5cclxuLy8gPT09IE9wZW4gLyBjbG9zZSA9PT1cclxud2luZG93Lm9wZW5DYXJ0ZXJhTW9kYWwgPSBhc3luYyBmdW5jdGlvbiBvcGVuQ2FydGVyYU1vZGFsKCkge1xyXG4gIGNvbnN0IG1vZGFsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2NhcnRlcmEtbW9kYWwnKTtcclxuICBpZiAoIW1vZGFsKSByZXR1cm47XHJcbiAgbW9kYWwuY2xhc3NMaXN0LmFkZCgnb3BlbicpO1xyXG4gIGF3YWl0IHBvcHVsYXRlVmVuZG9yRHJvcGRvd24oKTtcclxufTtcclxuXHJcbndpbmRvdy5jbG9zZUNhcnRlcmFNb2RhbCA9IGZ1bmN0aW9uIGNsb3NlQ2FydGVyYU1vZGFsKCkge1xyXG4gIGNvbnN0IG1vZGFsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2NhcnRlcmEtbW9kYWwnKTtcclxuICBpZiAobW9kYWwpIG1vZGFsLmNsYXNzTGlzdC5yZW1vdmUoJ29wZW4nKTtcclxufTtcclxuXHJcbi8vID09PSBEcm9wZG93biBkZSB2ZW5kb3JzID09PVxyXG5hc3luYyBmdW5jdGlvbiBwb3B1bGF0ZVZlbmRvckRyb3Bkb3duKCkge1xyXG4gIGNvbnN0IHNlbCA9IC8qKiBAdHlwZSB7SFRNTFNlbGVjdEVsZW1lbnR8bnVsbH0gKi8gKFxyXG4gICAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2NhcnRlcmEtdmVuZG9yLXNlbGVjdCcpXHJcbiAgKTtcclxuICBpZiAoIXNlbCkgcmV0dXJuO1xyXG4gIGlmIChzZWwub3B0aW9ucy5sZW5ndGggPiAxKSByZXR1cm47XHJcbiAgdHJ5IHtcclxuICAgIC8vIEB0cy1leHBlY3QtZXJyb3JcclxuICAgIGNvbnN0IHNuYXAgPSBhd2FpdCBmaXJlYmFzZS5maXJlc3RvcmUoKS5jb2xsZWN0aW9uKCdjYXJ0ZXJhX3ZlbmRvcicpLmdldCgpO1xyXG4gICAgLyoqIEB0eXBlIHtzdHJpbmdbXX0gKi9cclxuICAgIGNvbnN0IHZlbmRvcnMgPSBbXTtcclxuICAgIHNuYXAuZm9yRWFjaCgoZG9jKSA9PiB7XHJcbiAgICAgIC8vIHYxMzg0OiBzb2xvIFZERSB3aGl0ZWxpc3QuIFJlc3RvIChhZG1pbiB1aWQsIEVNUExFQURPLCBleC1WREUpIHNlIG9jdWx0YW4uXHJcbiAgICAgIGlmIChWRU5ET1JTX1dISVRFTElTVC5oYXMoZG9jLmlkKSkgdmVuZG9ycy5wdXNoKGRvYy5pZCk7XHJcbiAgICB9KTtcclxuICAgIHZlbmRvcnMuc29ydCgpO1xyXG4gICAgZm9yIChjb25zdCB2IG9mIHZlbmRvcnMpIHtcclxuICAgICAgY29uc3Qgb3B0ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnb3B0aW9uJyk7XHJcbiAgICAgIG9wdC52YWx1ZSA9IHY7XHJcbiAgICAgIG9wdC50ZXh0Q29udGVudCA9IHY7XHJcbiAgICAgIHNlbC5hcHBlbmRDaGlsZChvcHQpO1xyXG4gICAgfVxyXG4gIH0gY2F0Y2ggKGUpIHtcclxuICAgIGNvbnNvbGUuZXJyb3IoJ3BvcHVsYXRlVmVuZG9yRHJvcGRvd24gZmFpbGVkJywgZSk7XHJcbiAgfVxyXG59XHJcblxyXG4vLyA9PT0gT24gdmVuZG9yIGNoYW5nZSA9PT1cclxud2luZG93Lm9uQ2FydGVyYVZlbmRvckNoYW5nZSA9IGFzeW5jIGZ1bmN0aW9uIG9uQ2FydGVyYVZlbmRvckNoYW5nZSgpIHtcclxuICBjb25zdCBzZWwgPSAvKiogQHR5cGUge0hUTUxTZWxlY3RFbGVtZW50fG51bGx9ICovIChcclxuICAgIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdjYXJ0ZXJhLXZlbmRvci1zZWxlY3QnKVxyXG4gICk7XHJcbiAgaWYgKCFzZWwpIHJldHVybjtcclxuICBzZWxlY3RlZFZlbmRvciA9IHNlbC52YWx1ZSB8fCBudWxsO1xyXG4gIGFjdGl2ZUNoaXAgPSAndG9kb3MnO1xyXG4gIHNlYXJjaFF1ZXJ5ID0gJyc7XHJcbiAgY29uc3Qgc2VhcmNoSW5wdXQgPSAvKiogQHR5cGUge0hUTUxJbnB1dEVsZW1lbnR8bnVsbH0gKi8gKFxyXG4gICAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2NhcnRlcmEtc2VhcmNoJylcclxuICApO1xyXG4gIGlmIChzZWFyY2hJbnB1dCkgc2VhcmNoSW5wdXQudmFsdWUgPSAnJztcclxuICBpZiAoIXNlbGVjdGVkVmVuZG9yKSB7XHJcbiAgICBzaG93RW1wdHkoKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgc2hvd0xvYWRpbmcoKTtcclxuICB0cnkge1xyXG4gICAgbGV0IGRvYyA9IGNhcnRlcmFEb2NDYWNoZS5nZXQoc2VsZWN0ZWRWZW5kb3IpO1xyXG4gICAgaWYgKCFkb2MpIHtcclxuICAgICAgLy8gQHRzLWV4cGVjdC1lcnJvclxyXG4gICAgICBjb25zdCBzbmFwID0gYXdhaXQgZmlyZWJhc2VcclxuICAgICAgICAuZmlyZXN0b3JlKClcclxuICAgICAgICAuY29sbGVjdGlvbignY2FydGVyYV92ZW5kb3InKVxyXG4gICAgICAgIC5kb2Moc2VsZWN0ZWRWZW5kb3IpXHJcbiAgICAgICAgLmdldCgpO1xyXG4gICAgICBpZiAoIXNuYXAuZXhpc3RzKSB7XHJcbiAgICAgICAgc2hvd05vRGF0YSgpO1xyXG4gICAgICAgIHJldHVybjtcclxuICAgICAgfVxyXG4gICAgICBkb2MgPSBzbmFwLmRhdGEoKTtcclxuICAgICAgY2FydGVyYURvY0NhY2hlLnNldChzZWxlY3RlZFZlbmRvciwgZG9jKTtcclxuICAgIH1cclxuICAgIHJlbmRlckRhc2hib2FyZChkb2MpO1xyXG4gIH0gY2F0Y2ggKGUpIHtcclxuICAgIGNvbnNvbGUuZXJyb3IoJ29uQ2FydGVyYVZlbmRvckNoYW5nZSBmYWlsZWQnLCBlKTtcclxuICAgIHNob3dFcnJvcihTdHJpbmcoZSkpO1xyXG4gIH1cclxufTtcclxuXHJcbi8qKiBAdHlwZSB7YW55fSAqLyAod2luZG93KS5vbkNhcnRlcmFDaGlwQ2xpY2sgPSBmdW5jdGlvbiBvbkNhcnRlcmFDaGlwQ2xpY2soY2hpcElkKSB7XHJcbiAgYWN0aXZlQ2hpcCA9IGNoaXBJZDtcclxuICBpZiAoIXNlbGVjdGVkVmVuZG9yKSByZXR1cm47XHJcbiAgY29uc3QgZG9jID0gY2FydGVyYURvY0NhY2hlLmdldChzZWxlY3RlZFZlbmRvcik7XHJcbiAgaWYgKGRvYykgcmVuZGVyRGFzaGJvYXJkKGRvYyk7XHJcbn07XHJcblxyXG4vKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIHNldFRpbWVvdXQ+fG51bGx9ICovXHJcbmxldCBzZWFyY2hEZWJvdW5jZVRpbWVyID0gbnVsbDtcclxud2luZG93Lm9uQ2FydGVyYVNlYXJjaENoYW5nZSA9IGZ1bmN0aW9uIG9uQ2FydGVyYVNlYXJjaENoYW5nZSgpIHtcclxuICBjb25zdCBpbnB1dCA9IC8qKiBAdHlwZSB7SFRNTElucHV0RWxlbWVudHxudWxsfSAqLyAoZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2NhcnRlcmEtc2VhcmNoJykpO1xyXG4gIGlmICghaW5wdXQpIHJldHVybjtcclxuICBpZiAoc2VhcmNoRGVib3VuY2VUaW1lcikgY2xlYXJUaW1lb3V0KHNlYXJjaERlYm91bmNlVGltZXIpO1xyXG4gIHNlYXJjaERlYm91bmNlVGltZXIgPSBzZXRUaW1lb3V0KCgpID0+IHtcclxuICAgIHNlYXJjaFF1ZXJ5ID0gKGlucHV0LnZhbHVlIHx8ICcnKS50cmltKCkudG9Mb3dlckNhc2UoKTtcclxuICAgIGlmICghc2VsZWN0ZWRWZW5kb3IpIHJldHVybjtcclxuICAgIGNvbnN0IGRvYyA9IGNhcnRlcmFEb2NDYWNoZS5nZXQoc2VsZWN0ZWRWZW5kb3IpO1xyXG4gICAgaWYgKGRvYykgcmVuZGVyRGFzaGJvYXJkKGRvYyk7XHJcbiAgfSwgMzAwKTtcclxufTtcclxuXHJcbi8qKiBAdHlwZSB7YW55fSAqLyAod2luZG93KS5vbkNhcnRlcmFTb3J0Q2xpY2sgPSBmdW5jdGlvbiBvbkNhcnRlcmFTb3J0Q2xpY2soY29sS2V5KSB7XHJcbiAgaWYgKHNvcnRCeSA9PT0gY29sS2V5KSBzb3J0RGlyID0gc29ydERpciA9PT0gJ2FzYycgPyAnZGVzYycgOiAnYXNjJztcclxuICBlbHNlIHtcclxuICAgIHNvcnRCeSA9IGNvbEtleTtcclxuICAgIHNvcnREaXIgPSAnZGVzYyc7XHJcbiAgfVxyXG4gIGlmICghc2VsZWN0ZWRWZW5kb3IpIHJldHVybjtcclxuICBjb25zdCBkb2MgPSBjYXJ0ZXJhRG9jQ2FjaGUuZ2V0KHNlbGVjdGVkVmVuZG9yKTtcclxuICBpZiAoZG9jKSByZW5kZXJEYXNoYm9hcmQoZG9jKTtcclxufTtcclxuXHJcbi8vID09PSBSZW5kZXIgPT09XHJcbmZ1bmN0aW9uIHJlbmRlckRhc2hib2FyZChkb2MpIHtcclxuICBjb25zdCBzdWJ0aXRsZSA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdjYXJ0ZXJhLXN1YnRpdGxlJyk7XHJcbiAgaWYgKHN1YnRpdGxlKSBzdWJ0aXRsZS50ZXh0Q29udGVudCA9IGAke2RvYy5jb3VudHMudG90YWx9IGNsaWVudGVzIGVuIGNhcnRlcmEuYDtcclxuICBjb25zdCBpbmZvID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2NhcnRlcmEtc25hcHNob3QtaW5mbycpO1xyXG4gIGlmIChpbmZvKSB7XHJcbiAgICBpbmZvLnRleHRDb250ZW50ID0gYFNuYXBzaG90ICR7ZG9jLnNuYXBzaG90RGF0ZX1gO1xyXG4gICAgaW5mby5zdHlsZS5kaXNwbGF5ID0gJ2lubGluZS1mbGV4JztcclxuICB9XHJcbiAgcmVuZGVyS3Bpcyhkb2MuY291bnRzKTtcclxuICByZW5kZXJDaGlwcyhkb2MuY291bnRzKTtcclxuICByZW5kZXJUYWJsZShkb2MuY2xpZW50ZXMpO1xyXG4gIHNob3dUYWJsZSgpO1xyXG59XHJcblxyXG5mdW5jdGlvbiByZW5kZXJLcGlzKGNvdW50cykge1xyXG4gIGNvbnN0IGVsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2NhcnRlcmEta3BpcycpO1xyXG4gIGlmICghZWwpIHJldHVybjtcclxuICB3aGlsZSAoZWwuZmlyc3RDaGlsZCkgZWwucmVtb3ZlQ2hpbGQoZWwuZmlyc3RDaGlsZCk7XHJcbiAgLy8gdjEzODM6IEFwcGxlLXN0eWxlIEtQSSBjYXJkcy4gQ2xhc2VzIC5jYXJ0ZXJhLWtwaSBkZWZpbmlkYXMgZW4gaW5kZXguaHRtbC5cclxuICAvLyBDb2xvciBzZSBhcGxpY2Egc29sbyBhbCBuXHUwMEZBbWVybyArIHVuZGVybGluZSAoc3V0aWwgaWRlbnRpZGFkIHBvciBjYXRlZ29yXHUwMEVEYSkuXHJcbiAgZm9yIChjb25zdCBzcGVjIG9mIEtQSV9DQVJEUykge1xyXG4gICAgY29uc3QgY2FyZCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpO1xyXG4gICAgY2FyZC5jbGFzc05hbWUgPSAnY2FydGVyYS1rcGknO1xyXG4gICAgaWYgKGFjdGl2ZUNoaXAgPT09IHNwZWMuY2hpcCkgY2FyZC5jbGFzc0xpc3QuYWRkKCdhY3RpdmUnKTtcclxuICAgIGNhcmQuc3R5bGUuY29sb3IgPSBzcGVjLmNvbG9yOyAvLyBjdXJyZW50Q29sb3IgcGFyYSBlbCBudW1iZXIgKyA6OmFmdGVyIHVuZGVybGluZVxyXG4gICAgY2FyZC5hZGRFdmVudExpc3RlbmVyKCdjbGljaycsICgpID0+IC8qKiBAdHlwZSB7YW55fSAqLyAod2luZG93KS5vbkNhcnRlcmFDaGlwQ2xpY2soc3BlYy5jaGlwKSk7XHJcbiAgICBjb25zdCBuID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2Jyk7XHJcbiAgICBuLmNsYXNzTmFtZSA9ICdjYXJ0ZXJhLWtwaS1udW0nO1xyXG4gICAgbi50ZXh0Q29udGVudCA9IFN0cmluZyhjb3VudHNbc3BlYy5jaGlwID09PSAndG9kb3MnID8gJ3RvdGFsJyA6IHNwZWMuY2hpcF0pO1xyXG4gICAgY29uc3QgbCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpO1xyXG4gICAgbC5jbGFzc05hbWUgPSAnY2FydGVyYS1rcGktbGFiZWwnO1xyXG4gICAgbC5zdHlsZS5jb2xvciA9ICcnOyAvLyByZXNldCBjdXJyZW50Q29sb3IgcGFyYSBxdWUgdXNlIGVsIG11dGVkIGRlbCBDU1NcclxuICAgIGwudGV4dENvbnRlbnQgPSBzcGVjLmxhYmVsO1xyXG4gICAgY2FyZC5hcHBlbmRDaGlsZChuKTtcclxuICAgIGNhcmQuYXBwZW5kQ2hpbGQobCk7XHJcbiAgICBlbC5hcHBlbmRDaGlsZChjYXJkKTtcclxuICB9XHJcbn1cclxuXHJcbmZ1bmN0aW9uIHJlbmRlckNoaXBzKGNvdW50cykge1xyXG4gIGNvbnN0IGVsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2NhcnRlcmEtY2hpcHMnKTtcclxuICBpZiAoIWVsKSByZXR1cm47XHJcbiAgY29uc3QgY291bnRCeUNoaXAgPSB7XHJcbiAgICB0b2RvczogY291bnRzLnRvdGFsLFxyXG4gICAgYmFzZUFjdGl2YTkwZDogY291bnRzLmJhc2VBY3RpdmE5MGQsXHJcbiAgICBkb3JtaWRvc1Zpc2l0YTMwZDogY291bnRzLmRvcm1pZG9zVmlzaXRhMzBkLFxyXG4gICAgZG9ybWlkb3NDb21wcmE5MGQ6IGNvdW50cy5kb3JtaWRvc0NvbXByYTkwZCxcclxuICAgIG51bmNhVmlzaXRhZG9zOiBjb3VudHMubnVuY2FWaXNpdGFkb3MsXHJcbiAgICBudW5jYUNvbXByYXJvbjogY291bnRzLm51bmNhQ29tcHJhcm9uLFxyXG4gIH07XHJcbiAgd2hpbGUgKGVsLmZpcnN0Q2hpbGQpIGVsLnJlbW92ZUNoaWxkKGVsLmZpcnN0Q2hpbGQpO1xyXG4gIC8vIHYxMzgzOiBzZWdtZW50ZWQgY29udHJvbCBpT1MuIFdyYXBwZXIgLmNhcnRlcmEtY2hpcC13cmFwIGFncnVwYSBwaWxscyBjb24gYmcgZ3Jpcy5cclxuICBjb25zdCB3cmFwID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2Jyk7XHJcbiAgd3JhcC5jbGFzc05hbWUgPSAnY2FydGVyYS1jaGlwLXdyYXAnO1xyXG4gIGZvciAoY29uc3QgY2hpcCBvZiBDSElQUykge1xyXG4gICAgY29uc3QgYiA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2J1dHRvbicpO1xyXG4gICAgYi5jbGFzc05hbWUgPSAnY2FydGVyYS1jaGlwJztcclxuICAgIGlmIChhY3RpdmVDaGlwID09PSBjaGlwLmlkKSBiLmNsYXNzTGlzdC5hZGQoJ2FjdGl2ZScpO1xyXG4gICAgYi50eXBlID0gJ2J1dHRvbic7XHJcbiAgICBiLnRleHRDb250ZW50ID0gYCR7Y2hpcC5sYWJlbH0gKCR7Y291bnRCeUNoaXBbY2hpcC5pZF19KWA7XHJcbiAgICBiLmFkZEV2ZW50TGlzdGVuZXIoJ2NsaWNrJywgKCkgPT4gLyoqIEB0eXBlIHthbnl9ICovICh3aW5kb3cpLm9uQ2FydGVyYUNoaXBDbGljayhjaGlwLmlkKSk7XHJcbiAgICB3cmFwLmFwcGVuZENoaWxkKGIpO1xyXG4gIH1cclxuICBlbC5hcHBlbmRDaGlsZCh3cmFwKTtcclxufVxyXG5cclxuLyoqIEBwYXJhbSB7QXJyYXk8YW55Pn0gY2xpZW50ZXMgKi9cclxuZnVuY3Rpb24gcmVuZGVyVGFibGUoY2xpZW50ZXMpIHtcclxuICBjb25zdCB0YWJsZSA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdjYXJ0ZXJhLXRhYmxlJyk7XHJcbiAgaWYgKCF0YWJsZSkgcmV0dXJuO1xyXG4gIGNvbnN0IGZpbHRlcmVkID0gYXBwbHlDaGlwRmlsdGVyKGNsaWVudGVzLCBhY3RpdmVDaGlwKTtcclxuICBjb25zdCBzZWFyY2hlZCA9IHNlYXJjaFF1ZXJ5XHJcbiAgICA/IGZpbHRlcmVkLmZpbHRlcigoYykgPT5cclxuICAgICAgICBTdHJpbmcoYy5jbGllbnROYW1lIHx8ICcnKVxyXG4gICAgICAgICAgLnRvTG93ZXJDYXNlKClcclxuICAgICAgICAgIC5pbmNsdWRlcyhzZWFyY2hRdWVyeSlcclxuICAgICAgKVxyXG4gICAgOiBmaWx0ZXJlZDtcclxuICBjb25zdCBzb3J0ZWQgPSBzb3J0Q2xpZW50ZXMoc2VhcmNoZWQsIHNvcnRCeSwgc29ydERpcik7XHJcbiAgd2hpbGUgKHRhYmxlLmZpcnN0Q2hpbGQpIHRhYmxlLnJlbW92ZUNoaWxkKHRhYmxlLmZpcnN0Q2hpbGQpO1xyXG4gIHRhYmxlLmFwcGVuZENoaWxkKGJ1aWxkVGhlYWQoKSk7XHJcbiAgdGFibGUuYXBwZW5kQ2hpbGQoYnVpbGRUYm9keShzb3J0ZWQpKTtcclxufVxyXG5cclxuZnVuY3Rpb24gYnVpbGRUaGVhZCgpIHtcclxuICAvLyB2MTM4MzogQXBwbGUtc3R5bGUgdGhlYWQuIENsYXNlcyAuY2FydGVyYS0qIGVuIGluZGV4Lmh0bWwgY29udHJvbGFuIGJnL2NvbG9ycy5cclxuICBjb25zdCB0aGVhZCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3RoZWFkJyk7XHJcbiAgY29uc3QgdHIgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCd0cicpO1xyXG4gIGNvbnN0IGhlYWRlcnMgPSBbXHJcbiAgICB7IGxhYmVsOiAnQ2xpZW50ZScsIHNvcnRLZXk6ICdjbGllbnROYW1lJywgYWxpZ246ICdsZWZ0JyB9LFxyXG4gICAgeyBsYWJlbDogJ1Byb3YvTG9jJywgc29ydEtleTogbnVsbCwgYWxpZ246ICdsZWZ0JyB9LFxyXG4gICAgeyBsYWJlbDogJ1RpcG8nLCBzb3J0S2V5OiBudWxsLCBhbGlnbjogJ2NlbnRlcicgfSxcclxuICAgIHsgbGFiZWw6ICdcdTAwREFsdC4gdmlzaXRhJywgc29ydEtleTogJ2RpYXNTaW5WaXNpdGFQcmVzZW5jaWFsJywgYWxpZ246ICdsZWZ0JyB9LFxyXG4gICAgeyBsYWJlbDogJ1x1MDBEQWx0LiBjb250YWN0bycsIHNvcnRLZXk6ICdkaWFzU2luQ29udGFjdG8nLCBhbGlnbjogJ2xlZnQnIH0sXHJcbiAgICB7IGxhYmVsOiAnXHUwMERBbHQuIGNvbXByYScsIHNvcnRLZXk6ICdkaWFzU2luQ29tcHJhJywgYWxpZ246ICdsZWZ0JyB9LFxyXG4gICAgeyBsYWJlbDogJ0ZhY3QgMTJNJywgc29ydEtleTogJ2ZhY3R1cmFkbzEyTScsIGFsaWduOiAncmlnaHQnIH0sXHJcbiAgICB7IGxhYmVsOiAnRGV1ZGEnLCBzb3J0S2V5OiAnZGV1ZGFBYmllcnRhJywgYWxpZ246ICdyaWdodCcgfSxcclxuICBdO1xyXG4gIGZvciAoY29uc3QgaCBvZiBoZWFkZXJzKSB7XHJcbiAgICBjb25zdCB0aCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3RoJyk7XHJcbiAgICB0aC5zdHlsZS50ZXh0QWxpZ24gPSBoLmFsaWduO1xyXG4gICAgdGgudGV4dENvbnRlbnQgPSBoLmxhYmVsO1xyXG4gICAgaWYgKGguc29ydEtleSkge1xyXG4gICAgICB0aC5zdHlsZS5jdXJzb3IgPSAncG9pbnRlcic7XHJcbiAgICAgIGNvbnN0IGtleSA9IGguc29ydEtleTtcclxuICAgICAgdGguYWRkRXZlbnRMaXN0ZW5lcignY2xpY2snLCAoKSA9PiAvKiogQHR5cGUge2FueX0gKi8gKHdpbmRvdykub25DYXJ0ZXJhU29ydENsaWNrKGtleSkpO1xyXG4gICAgfVxyXG4gICAgdHIuYXBwZW5kQ2hpbGQodGgpO1xyXG4gIH1cclxuICB0aGVhZC5hcHBlbmRDaGlsZCh0cik7XHJcbiAgcmV0dXJuIHRoZWFkO1xyXG59XHJcblxyXG4vKiogQHBhcmFtIHtBcnJheTxhbnk+fSBzb3J0ZWRDbGllbnRlcyAqL1xyXG5mdW5jdGlvbiBidWlsZFRib2R5KHNvcnRlZENsaWVudGVzKSB7XHJcbiAgY29uc3QgdGJvZHkgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCd0Ym9keScpO1xyXG4gIGZvciAoY29uc3QgYyBvZiBzb3J0ZWRDbGllbnRlcykge1xyXG4gICAgdGJvZHkuYXBwZW5kQ2hpbGQoYnVpbGRDbGllbnRlUm93KGMpKTtcclxuICB9XHJcbiAgcmV0dXJuIHRib2R5O1xyXG59XHJcblxyXG4vKiogQHBhcmFtIHthbnl9IGMgKi9cclxuZnVuY3Rpb24gYnVpbGRDbGllbnRlUm93KGMpIHtcclxuICBjb25zdCB0ciA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3RyJyk7XHJcbiAgdHIuc3R5bGUuY3NzVGV4dCA9ICdjdXJzb3I6cG9pbnRlcjtib3JkZXItYm90dG9tOjFweCBzb2xpZCB2YXIoLS1ib3JkZXItbGlnaHQpJztcclxuICB0ci5hZGRFdmVudExpc3RlbmVyKCdtb3VzZWVudGVyJywgKCkgPT4ge1xyXG4gICAgdHIuc3R5bGUuYmFja2dyb3VuZCA9ICd2YXIoLS1iZy1ob3ZlciknO1xyXG4gIH0pO1xyXG4gIHRyLmFkZEV2ZW50TGlzdGVuZXIoJ21vdXNlbGVhdmUnLCAoKSA9PiB7XHJcbiAgICB0ci5zdHlsZS5iYWNrZ3JvdW5kID0gJyc7XHJcbiAgfSk7XHJcbiAgdHIuYWRkRXZlbnRMaXN0ZW5lcignY2xpY2snLCAoKSA9PiB7XHJcbiAgICAvLyBAdHMtZXhwZWN0LWVycm9yXHJcbiAgICBpZiAodHlwZW9mIHdpbmRvdy5vcGVuRmljaGFDbGllbnRlID09PSAnZnVuY3Rpb24nKSB3aW5kb3cub3BlbkZpY2hhQ2xpZW50ZShjLmNsaWVudElkKTtcclxuICB9KTtcclxuXHJcbiAgY29uc3QgdGROYW1lID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgndGQnKTtcclxuICB0ZE5hbWUuc3R5bGUuY3NzVGV4dCA9ICdwYWRkaW5nOjZweCA4cHg7Zm9udC13ZWlnaHQ6NjAwJztcclxuICB0ZE5hbWUudGV4dENvbnRlbnQgPSBjLmNsaWVudE5hbWUgfHwgJyc7XHJcbiAgdHIuYXBwZW5kQ2hpbGQodGROYW1lKTtcclxuXHJcbiAgY29uc3QgdGRMb2MgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCd0ZCcpO1xyXG4gIHRkTG9jLnN0eWxlLmNzc1RleHQgPSAncGFkZGluZzo2cHggOHB4O2ZvbnQtc2l6ZToxMnB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpJztcclxuICB0ZExvYy50ZXh0Q29udGVudCA9IGAke2MucHJvdmluY2lhIHx8ICcnfS8ke2MubG9jYWxpZGFkIHx8ICcnfWA7XHJcbiAgdHIuYXBwZW5kQ2hpbGQodGRMb2MpO1xyXG5cclxuICBjb25zdCB0ZFRpcG8gPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCd0ZCcpO1xyXG4gIHRkVGlwby5zdHlsZS5jc3NUZXh0ID0gJ3BhZGRpbmc6NnB4IDhweDt0ZXh0LWFsaWduOmNlbnRlcic7XHJcbiAgY29uc3QgdGlwb0JhZGdlID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnc3BhbicpO1xyXG4gIHRpcG9CYWRnZS5zdHlsZS5jc3NUZXh0ID1cclxuICAgICdwYWRkaW5nOjJweCA2cHg7Ym9yZGVyLXJhZGl1czo0cHg7YmFja2dyb3VuZDp2YXIoLS1iZy1pbnB1dCk7Zm9udC1zaXplOjExcHg7Zm9udC13ZWlnaHQ6NzAwJztcclxuICB0aXBvQmFkZ2UudGV4dENvbnRlbnQgPSBjLmNsaVRpcG8gfHwgJy0nO1xyXG4gIHRkVGlwby5hcHBlbmRDaGlsZCh0aXBvQmFkZ2UpO1xyXG4gIHRyLmFwcGVuZENoaWxkKHRkVGlwbyk7XHJcblxyXG4gIHRyLmFwcGVuZENoaWxkKGJ1aWxkRGF0ZUNlbGwoYy51bHRpbWFWaXNpdGFQcmVzZW5jaWFsLCBjLmRpYXNTaW5WaXNpdGFQcmVzZW5jaWFsLCAzMCkpO1xyXG4gIHRyLmFwcGVuZENoaWxkKGJ1aWxkRGF0ZUNlbGwoYy51bHRpbW9Db250YWN0bywgYy5kaWFzU2luQ29udGFjdG8sIG51bGwpKTtcclxuICB0ci5hcHBlbmRDaGlsZChidWlsZERhdGVDZWxsKGMudWx0aW1hQ29tcHJhLCBjLmRpYXNTaW5Db21wcmEsIDkwKSk7XHJcblxyXG4gIGNvbnN0IHRkRmFjdCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3RkJyk7XHJcbiAgdGRGYWN0LnN0eWxlLmNzc1RleHQgPSAncGFkZGluZzo2cHggOHB4O3RleHQtYWxpZ246cmlnaHQ7Zm9udC12YXJpYW50LW51bWVyaWM6dGFidWxhci1udW1zJztcclxuICB0ZEZhY3QudGV4dENvbnRlbnQgPSBmbXRNb25leShjLmZhY3R1cmFkbzEyTSk7XHJcbiAgdHIuYXBwZW5kQ2hpbGQodGRGYWN0KTtcclxuXHJcbiAgY29uc3QgdGREZXVkYSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3RkJyk7XHJcbiAgdGREZXVkYS5zdHlsZS5jc3NUZXh0ID0gYHBhZGRpbmc6NnB4IDhweDt0ZXh0LWFsaWduOnJpZ2h0O2ZvbnQtdmFyaWFudC1udW1lcmljOnRhYnVsYXItbnVtcztjb2xvcjoke2MuZGV1ZGFBYmllcnRhID4gMCA/ICcjZGMyNjI2JyA6ICd2YXIoLS10ZXh0LW11dGVkKSd9YDtcclxuICB0ZERldWRhLnRleHRDb250ZW50ID0gZm10TW9uZXkoYy5kZXVkYUFiaWVydGEpO1xyXG4gIHRyLmFwcGVuZENoaWxkKHRkRGV1ZGEpO1xyXG5cclxuICByZXR1cm4gdHI7XHJcbn1cclxuXHJcbi8qKlxyXG4gKiBAcGFyYW0ge3N0cmluZ3xudWxsfSBmZWNoYUlzb1xyXG4gKiBAcGFyYW0ge251bWJlcnxudWxsfSBkaWFzXHJcbiAqIEBwYXJhbSB7bnVtYmVyfG51bGx9IGRhbmdlclRocmVzaG9sZFxyXG4gKi9cclxuZnVuY3Rpb24gYnVpbGREYXRlQ2VsbChmZWNoYUlzbywgZGlhcywgZGFuZ2VyVGhyZXNob2xkKSB7XHJcbiAgY29uc3QgdGQgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCd0ZCcpO1xyXG4gIGNvbnN0IGlzRGFuZ2VyID1cclxuICAgIGRhbmdlclRocmVzaG9sZCAhPT0gbnVsbCAmJiBkaWFzICE9PSBudWxsICYmIGRpYXMgIT09IHVuZGVmaW5lZCAmJiBkaWFzID4gZGFuZ2VyVGhyZXNob2xkO1xyXG4gIHRkLnN0eWxlLmNzc1RleHQgPSBgcGFkZGluZzo2cHggOHB4O2NvbG9yOiR7aXNEYW5nZXIgPyAnI2RjMjYyNicgOiAndmFyKC0tdGV4dC1wcmltYXJ5KSd9YDtcclxuICBpZiAoIWZlY2hhSXNvKSB7XHJcbiAgICB0ZC50ZXh0Q29udGVudCA9ICdcdTIwMTQnO1xyXG4gICAgcmV0dXJuIHRkO1xyXG4gIH1cclxuICBjb25zdCBwYXJ0cyA9IFN0cmluZyhmZWNoYUlzbykuc3BsaXQoJy0nKTtcclxuICBjb25zdCBkID0gcGFydHNbMl0gfHwgJyc7XHJcbiAgY29uc3QgbSA9IHBhcnRzWzFdIHx8ICcnO1xyXG4gIHRkLnRleHRDb250ZW50ID0gYCR7ZH0vJHttfWA7XHJcbiAgY29uc3QgZGlhc0VsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnc21hbGwnKTtcclxuICBkaWFzRWwuc3R5bGUuY3NzVGV4dCA9ICdjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTttYXJnaW4tbGVmdDo0cHgnO1xyXG4gIGRpYXNFbC50ZXh0Q29udGVudCA9IGAke2RpYXN9ZGA7XHJcbiAgdGQuYXBwZW5kQ2hpbGQoZGlhc0VsKTtcclxuICByZXR1cm4gdGQ7XHJcbn1cclxuXHJcbi8qKiBAcGFyYW0ge251bWJlcn0gbiAqL1xyXG5mdW5jdGlvbiBmbXRNb25leShuKSB7XHJcbiAgaWYgKCFuIHx8IG4gPT09IDApIHJldHVybiAnLSc7XHJcbiAgaWYgKG4gPj0gMV8wMDBfMDAwKSByZXR1cm4gYCQgJHsobiAvIDFfMDAwXzAwMCkudG9GaXhlZCgxKX1NYDtcclxuICBpZiAobiA+PSAxXzAwMCkgcmV0dXJuIGAkICR7KG4gLyAxXzAwMCkudG9GaXhlZCgwKX1rYDtcclxuICByZXR1cm4gYCQgJHtufWA7XHJcbn1cclxuXHJcbi8vID09PSBVSSBzdGF0ZSBoZWxwZXJzID09PVxyXG5mdW5jdGlvbiBoaWRlQWxsKCkge1xyXG4gIGNvbnN0IGlkcyA9IFtcclxuICAgICdjYXJ0ZXJhLWxvYWRpbmcnLFxyXG4gICAgJ2NhcnRlcmEtdGFibGUnLFxyXG4gICAgJ2NhcnRlcmEta3BpcycsXHJcbiAgICAnY2FydGVyYS1jaGlwcycsXHJcbiAgICAnY2FydGVyYS1lbXB0eScsXHJcbiAgXTtcclxuICBmb3IgKGNvbnN0IGlkIG9mIGlkcykge1xyXG4gICAgY29uc3QgZWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZChpZCk7XHJcbiAgICBpZiAoZWwpIGVsLnN0eWxlLmRpc3BsYXkgPSAnbm9uZSc7XHJcbiAgfVxyXG59XHJcbmZ1bmN0aW9uIHNob3dFbXB0eSgpIHtcclxuICBoaWRlQWxsKCk7XHJcbiAgY29uc3QgZW1wdHkgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY2FydGVyYS1lbXB0eScpO1xyXG4gIGlmIChlbXB0eSkge1xyXG4gICAgZW1wdHkuc3R5bGUuZGlzcGxheSA9ICdibG9jayc7XHJcbiAgICBlbXB0eS50ZXh0Q29udGVudCA9ICdFbGVnXHUwMEVEIHVuIHZlbmRlZG9yIHBhcmEgdmVyIHN1IGNhcnRlcmEuJztcclxuICB9XHJcbn1cclxuZnVuY3Rpb24gc2hvd0xvYWRpbmcoKSB7XHJcbiAgaGlkZUFsbCgpO1xyXG4gIGNvbnN0IGxvYWRpbmcgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY2FydGVyYS1sb2FkaW5nJyk7XHJcbiAgaWYgKGxvYWRpbmcpIGxvYWRpbmcuc3R5bGUuZGlzcGxheSA9ICdibG9jayc7XHJcbn1cclxuZnVuY3Rpb24gc2hvd05vRGF0YSgpIHtcclxuICBoaWRlQWxsKCk7XHJcbiAgY29uc3QgZW1wdHkgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY2FydGVyYS1lbXB0eScpO1xyXG4gIGlmIChlbXB0eSkge1xyXG4gICAgZW1wdHkuc3R5bGUuZGlzcGxheSA9ICdibG9jayc7XHJcbiAgICBlbXB0eS50ZXh0Q29udGVudCA9XHJcbiAgICAgICdTaW4gY2FydGVyYSBwYXJhIGVzdGUgdmVuZGVkb3IuIFZlcmlmaWNcdTAwRTEgYXNzaWduZWRWZW5kb3IgZW4gY2xpZW50X21hc3RlciBvIGVzcGVyXHUwMEUxIGFsIHByXHUwMEYzeGltbyBzbmFwc2hvdCAoMDQ6MDAgQVJUKS4nO1xyXG4gIH1cclxufVxyXG4vKiogQHBhcmFtIHtzdHJpbmd9IG1zZyAqL1xyXG5mdW5jdGlvbiBzaG93RXJyb3IobXNnKSB7XHJcbiAgaGlkZUFsbCgpO1xyXG4gIGNvbnN0IGVtcHR5ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2NhcnRlcmEtZW1wdHknKTtcclxuICBpZiAoZW1wdHkpIHtcclxuICAgIGVtcHR5LnN0eWxlLmRpc3BsYXkgPSAnYmxvY2snO1xyXG4gICAgZW1wdHkuc3R5bGUuY29sb3IgPSAnI2RjMjYyNic7XHJcbiAgICBlbXB0eS50ZXh0Q29udGVudCA9IGBFcnJvciBjYXJnYW5kbyBjYXJ0ZXJhOiAke21zZ31gO1xyXG4gIH1cclxufVxyXG5mdW5jdGlvbiBzaG93VGFibGUoKSB7XHJcbiAgY29uc3QgZW1wdHkgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY2FydGVyYS1lbXB0eScpO1xyXG4gIGlmIChlbXB0eSkgZW1wdHkuc3R5bGUuZGlzcGxheSA9ICdub25lJztcclxuICBjb25zdCBsb2FkaW5nID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2NhcnRlcmEtbG9hZGluZycpO1xyXG4gIGlmIChsb2FkaW5nKSBsb2FkaW5nLnN0eWxlLmRpc3BsYXkgPSAnbm9uZSc7XHJcbiAgY29uc3QgdGFibGUgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY2FydGVyYS10YWJsZScpO1xyXG4gIGlmICh0YWJsZSkgdGFibGUuc3R5bGUuZGlzcGxheSA9ICd0YWJsZSc7XHJcbiAgLy8gdjEzODM6IGRpc3BsYXkgdmFjaW8gPSByZXNldCBhbCB2YWxvciBkZWwgQ1NTIChncmlkIHBhcmEga3BpcywgZmxleCBwYXJhIGNoaXBzKS5cclxuICBjb25zdCBrcGlzID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2NhcnRlcmEta3BpcycpO1xyXG4gIGlmIChrcGlzKSBrcGlzLnN0eWxlLmRpc3BsYXkgPSAnJztcclxuICBjb25zdCBjaGlwcyA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdjYXJ0ZXJhLWNoaXBzJyk7XHJcbiAgaWYgKGNoaXBzKSBjaGlwcy5zdHlsZS5kaXNwbGF5ID0gJyc7XHJcbn1cclxuXHJcbi8vID09PSBFeHBvcnQgRXhjZWwgPT09XHJcbndpbmRvdy5leHBvcnRDYXJ0ZXJhVG9FeGNlbCA9IGFzeW5jIGZ1bmN0aW9uIGV4cG9ydENhcnRlcmFUb0V4Y2VsKCkge1xyXG4gIGlmICghc2VsZWN0ZWRWZW5kb3IpIHtcclxuICAgIGFsZXJ0KCdFbGVnXHUwMEVEIHVuIHZlbmRlZG9yIHByaW1lcm8uJyk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIGNvbnN0IGRvYyA9IGNhcnRlcmFEb2NDYWNoZS5nZXQoc2VsZWN0ZWRWZW5kb3IpO1xyXG4gIGlmICghZG9jKSB7XHJcbiAgICBhbGVydCgnU2luIGRhdGEgY2FyZ2FkYS4nKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgY29uc3QgZmlsdGVyZWQgPSBhcHBseUNoaXBGaWx0ZXIoZG9jLmNsaWVudGVzLCBhY3RpdmVDaGlwKTtcclxuICBjb25zdCBzZWFyY2hlZCA9IHNlYXJjaFF1ZXJ5XHJcbiAgICA/IGZpbHRlcmVkLmZpbHRlcigoYykgPT5cclxuICAgICAgICBTdHJpbmcoYy5jbGllbnROYW1lIHx8ICcnKVxyXG4gICAgICAgICAgLnRvTG93ZXJDYXNlKClcclxuICAgICAgICAgIC5pbmNsdWRlcyhzZWFyY2hRdWVyeSlcclxuICAgICAgKVxyXG4gICAgOiBmaWx0ZXJlZDtcclxuICBjb25zdCBzb3J0ZWQgPSBzb3J0Q2xpZW50ZXMoc2VhcmNoZWQsIHNvcnRCeSwgc29ydERpcik7XHJcblxyXG4gIGNvbnN0IGNoaXBMYWJlbCA9IChDSElQUy5maW5kKChjKSA9PiBjLmlkID09PSBhY3RpdmVDaGlwKSB8fCB7IGxhYmVsOiAnVG9kb3MnIH0pLmxhYmVsO1xyXG4gIGNvbnN0IHRpdGxlID0gYENhcnRlcmEgZGUgJHtzZWxlY3RlZFZlbmRvcn0gXHUyMDE0ICR7Y2hpcExhYmVsfSBcdTIwMTQgU25hcHNob3QgJHtkb2Muc25hcHNob3REYXRlfWA7XHJcblxyXG4gIHRyeSB7XHJcbiAgICBpZiAodHlwZW9mIHdpbmRvdy5sb2FkRXhjZWxKUyA9PT0gJ2Z1bmN0aW9uJykge1xyXG4gICAgICBhd2FpdCB3aW5kb3cubG9hZEV4Y2VsSlMoKTtcclxuICAgIH1cclxuICAgIGNvbnN0IEV4Y2VsSlMgPSB3aW5kb3cuRXhjZWxKUztcclxuICAgIGlmICghRXhjZWxKUykgdGhyb3cgbmV3IEVycm9yKCdFeGNlbEpTIG5vIGRpc3BvbmlibGUnKTtcclxuICAgIGNvbnN0IHdiID0gbmV3IEV4Y2VsSlMuV29ya2Jvb2soKTtcclxuICAgIGNvbnN0IHdzID0gd2IuYWRkV29ya3NoZWV0KCdDYXJ0ZXJhJyk7XHJcblxyXG4gICAgLy8gRmlsYSAxOiB0aXR1bG8gYmFuZGEgdmVyZGUgU2hpbWFub1xyXG4gICAgd3MubWVyZ2VDZWxscygnQTE6TDEnKTtcclxuICAgIGNvbnN0IHRpdGxlQ2VsbCA9IHdzLmdldENlbGwoJ0ExJyk7XHJcbiAgICB0aXRsZUNlbGwudmFsdWUgPSB0aXRsZTtcclxuICAgIHRpdGxlQ2VsbC5maWxsID0geyB0eXBlOiAncGF0dGVybicsIHBhdHRlcm46ICdzb2xpZCcsIGZnQ29sb3I6IHsgYXJnYjogJ0ZGMjJDNTVFJyB9IH07XHJcbiAgICB0aXRsZUNlbGwuZm9udCA9IHsgYm9sZDogdHJ1ZSwgY29sb3I6IHsgYXJnYjogJ0ZGRkZGRkZGJyB9LCBzaXplOiAxNCB9O1xyXG4gICAgdGl0bGVDZWxsLmFsaWdubWVudCA9IHsgaG9yaXpvbnRhbDogJ2NlbnRlcicsIHZlcnRpY2FsOiAnbWlkZGxlJyB9O1xyXG4gICAgd3MuZ2V0Um93KDEpLmhlaWdodCA9IDMwO1xyXG5cclxuICAgIC8vIEZpbGEgMjogaGVhZGVyc1xyXG4gICAgY29uc3QgaGVhZGVycyA9IFtcclxuICAgICAgJ0NsaWVudGUnLFxyXG4gICAgICAnUHJvdmluY2lhJyxcclxuICAgICAgJ0xvY2FsaWRhZCcsXHJcbiAgICAgICdUaXBvJyxcclxuICAgICAgJ1x1MDBEQWx0aW1hIHZpc2l0YSBwcmVzZW5jaWFsJyxcclxuICAgICAgJ1x1MDBEQWx0aW1vIGNvbnRhY3RvJyxcclxuICAgICAgJ1x1MDBEQWx0aW1hIGNvbXByYScsXHJcbiAgICAgICdGYWN0IDEyTSAoQVJTKScsXHJcbiAgICAgICdEZXVkYSBhYmllcnRhIChBUlMpJyxcclxuICAgICAgJ0RcdTAwRURhcyBzaW4gdmlzaXRhJyxcclxuICAgICAgJ0RcdTAwRURhcyBzaW4gY29tcHJhJyxcclxuICAgICAgJ0NhcmRDb2RlIFNBUCcsXHJcbiAgICBdO1xyXG4gICAgY29uc3QgaGVhZGVyUm93ID0gd3MuZ2V0Um93KDIpO1xyXG4gICAgaGVhZGVycy5mb3JFYWNoKChoLCBpKSA9PiB7XHJcbiAgICAgIGNvbnN0IGNlbGwgPSBoZWFkZXJSb3cuZ2V0Q2VsbChpICsgMSk7XHJcbiAgICAgIGNlbGwudmFsdWUgPSBoO1xyXG4gICAgICBjZWxsLmZpbGwgPSB7IHR5cGU6ICdwYXR0ZXJuJywgcGF0dGVybjogJ3NvbGlkJywgZmdDb2xvcjogeyBhcmdiOiAnRkYwNzRGNjknIH0gfTtcclxuICAgICAgY2VsbC5mb250ID0geyBib2xkOiB0cnVlLCBjb2xvcjogeyBhcmdiOiAnRkZGRkZGRkYnIH0gfTtcclxuICAgICAgY2VsbC5hbGlnbm1lbnQgPSB7IGhvcml6b250YWw6ICdjZW50ZXInIH07XHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBGaWxhcyAzKzogZGF0YVxyXG4gICAgc29ydGVkLmZvckVhY2goKGMsIGkpID0+IHtcclxuICAgICAgY29uc3Qgcm93ID0gd3MuZ2V0Um93KDMgKyBpKTtcclxuICAgICAgcm93LmdldENlbGwoMSkudmFsdWUgPSBjLmNsaWVudE5hbWUgfHwgJyc7XHJcbiAgICAgIHJvdy5nZXRDZWxsKDIpLnZhbHVlID0gYy5wcm92aW5jaWEgfHwgJyc7XHJcbiAgICAgIHJvdy5nZXRDZWxsKDMpLnZhbHVlID0gYy5sb2NhbGlkYWQgfHwgJyc7XHJcbiAgICAgIHJvdy5nZXRDZWxsKDQpLnZhbHVlID0gYy5jbGlUaXBvIHx8ICcnO1xyXG4gICAgICByb3cuZ2V0Q2VsbCg1KS52YWx1ZSA9IGMudWx0aW1hVmlzaXRhUHJlc2VuY2lhbCB8fCAnJztcclxuICAgICAgcm93LmdldENlbGwoNikudmFsdWUgPSBjLnVsdGltb0NvbnRhY3RvIHx8ICcnO1xyXG4gICAgICByb3cuZ2V0Q2VsbCg3KS52YWx1ZSA9IGMudWx0aW1hQ29tcHJhIHx8ICcnO1xyXG4gICAgICByb3cuZ2V0Q2VsbCg4KS52YWx1ZSA9IGMuZmFjdHVyYWRvMTJNIHx8IDA7XHJcbiAgICAgIHJvdy5nZXRDZWxsKDgpLm51bUZtdCA9ICdcIiRcIiMsIyMwJztcclxuICAgICAgcm93LmdldENlbGwoOSkudmFsdWUgPSBjLmRldWRhQWJpZXJ0YSB8fCAwO1xyXG4gICAgICByb3cuZ2V0Q2VsbCg5KS5udW1GbXQgPSAnXCIkXCIjLCMjMCc7XHJcbiAgICAgIHJvdy5nZXRDZWxsKDEwKS52YWx1ZSA9IGMuZGlhc1NpblZpc2l0YVByZXNlbmNpYWw7XHJcbiAgICAgIHJvdy5nZXRDZWxsKDExKS52YWx1ZSA9IGMuZGlhc1NpbkNvbXByYTtcclxuICAgICAgcm93LmdldENlbGwoMTIpLnZhbHVlID0gYy5jYXJkQ29kZSB8fCAnJztcclxuICAgIH0pO1xyXG5cclxuICAgIHdzLmNvbHVtbnMuZm9yRWFjaCgoY29sLCBpKSA9PiB7XHJcbiAgICAgIGNvbC53aWR0aCA9IGkgPT09IDAgPyAzMCA6IGkgPT09IDQgfHwgaSA9PT0gNSB8fCBpID09PSA2ID8gMTggOiAxNDtcclxuICAgIH0pO1xyXG5cclxuICAgIGNvbnN0IGJ1ZiA9IGF3YWl0IHdiLnhsc3gud3JpdGVCdWZmZXIoKTtcclxuICAgIGNvbnN0IGJsb2IgPSBuZXcgQmxvYihbYnVmXSwge1xyXG4gICAgICB0eXBlOiAnYXBwbGljYXRpb24vdm5kLm9wZW54bWxmb3JtYXRzLW9mZmljZWRvY3VtZW50LnNwcmVhZHNoZWV0bWwuc2hlZXQnLFxyXG4gICAgfSk7XHJcbiAgICBjb25zdCB1cmwgPSBVUkwuY3JlYXRlT2JqZWN0VVJMKGJsb2IpO1xyXG4gICAgY29uc3QgYSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2EnKTtcclxuICAgIGEuaHJlZiA9IHVybDtcclxuICAgIGEuZG93bmxvYWQgPSBgQ2FydGVyYV8ke1N0cmluZyhzZWxlY3RlZFZlbmRvcikucmVwbGFjZSgvXFxzKy9nLCAnXycpfV8ke2FjdGl2ZUNoaXB9XyR7ZG9jLnNuYXBzaG90RGF0ZX0ueGxzeGA7XHJcbiAgICBkb2N1bWVudC5ib2R5LmFwcGVuZENoaWxkKGEpO1xyXG4gICAgYS5jbGljaygpO1xyXG4gICAgYS5yZW1vdmUoKTtcclxuICAgIFVSTC5yZXZva2VPYmplY3RVUkwodXJsKTtcclxuICB9IGNhdGNoIChlKSB7XHJcbiAgICBjb25zb2xlLmVycm9yKCdleHBvcnRDYXJ0ZXJhVG9FeGNlbCBmYWlsZWQnLCBlKTtcclxuICAgIGFsZXJ0KCdFcnJvciBleHBvcnRhbmRvOiAnICsgU3RyaW5nKGUpKTtcclxuICB9XHJcbn07XHJcbiJdLAogICJtYXBwaW5ncyI6ICI7OztBQWVPLFdBQVMsZ0JBQWdCLFVBQVUsTUFBTTtBQUM5QyxRQUFJLENBQUMsTUFBTSxRQUFRLFFBQVEsRUFBRyxRQUFPLENBQUM7QUFDdEMsWUFBUSxNQUFNO0FBQUEsTUFDWixLQUFLO0FBQ0gsZUFBTyxTQUFTO0FBQUEsVUFDZCxDQUFDLE1BQU0sRUFBRSxrQkFBa0IsUUFBUSxFQUFFLGtCQUFrQixVQUFhLEVBQUUsaUJBQWlCO0FBQUEsUUFDekY7QUFBQSxNQUNGLEtBQUs7QUFDSCxlQUFPLFNBQVM7QUFBQSxVQUNkLENBQUMsTUFDQyxFQUFFLDRCQUE0QixRQUM5QixFQUFFLDRCQUE0QixVQUM5QixFQUFFLDBCQUEwQjtBQUFBLFFBQ2hDO0FBQUEsTUFDRixLQUFLO0FBQ0gsZUFBTyxTQUFTO0FBQUEsVUFDZCxDQUFDLE1BQU0sRUFBRSxrQkFBa0IsUUFBUSxFQUFFLGtCQUFrQixVQUFhLEVBQUUsZ0JBQWdCO0FBQUEsUUFDeEY7QUFBQSxNQUNGLEtBQUs7QUFDSCxlQUFPLFNBQVM7QUFBQSxVQUNkLENBQUMsTUFBTSxFQUFFLDJCQUEyQixRQUFRLEVBQUUsMkJBQTJCO0FBQUEsUUFDM0U7QUFBQSxNQUNGLEtBQUs7QUFDSCxlQUFPLFNBQVMsT0FBTyxDQUFDLE1BQU0sRUFBRSxpQkFBaUIsUUFBUSxFQUFFLGlCQUFpQixNQUFTO0FBQUEsTUFDdkY7QUFDRSxlQUFPLFNBQVMsTUFBTTtBQUFBLElBQzFCO0FBQUEsRUFDRjtBQVNPLFdBQVMsYUFBYSxVQUFVQSxTQUFRQyxVQUFTO0FBQ3RELFFBQUksQ0FBQyxNQUFNLFFBQVEsUUFBUSxFQUFHLFFBQU8sQ0FBQztBQUN0QyxVQUFNLE1BQU1BLGFBQVksUUFBUSxJQUFJO0FBQ3BDLFVBQU0sT0FBTyxTQUFTLE1BQU07QUFD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
