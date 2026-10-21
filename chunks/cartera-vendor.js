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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL3B1cmUvY2FydGVyYS12ZW5kb3ItZmlsdGVyLmpzIiwgIi4uL3NyYy9kb21haW5zL2NhcnRlcmEtdmVuZG9yLmpzIl0sCiAgInNvdXJjZXNDb250ZW50IjogWyIvLyBAdHMtY2hlY2tcbi8qKlxuICogY2FydGVyYS12ZW5kb3ItZmlsdGVyLmpzICh2MTI4MywgMjAyNi0xMC0yMClcbiAqXG4gKiBQdXJhcyBwYXJhIGZpbHRyYXIgeSBvcmRlbmFyIGxhIHRhYmxhIGRlbCBkYXNoYm9hcmQgXCJBbmFsaXNpcyBkZSBDYXJ0ZXJhXCIuXG4gKiBJbXBvcnRhZG8gcG9yIHNyYy9kb21haW5zL2NhcnRlcmEtdmVuZG9yLmpzIChidW5kbGUgZnJvbnRlbmQpLlxuICogVGVzdGVhZG8gZW4gdGVzdHMvdW5pdC9jYXJ0ZXJhLXZlbmRvci1maWx0ZXIudGVzdC5qcy5cbiAqL1xuXG4vKipcbiAqIEFwbGljYSB1biBjaGlwIGRlIGZpbHRybyBhbCBhcnJheSBkZSBjbGllbnRlcy5cbiAqIEBwYXJhbSB7QXJyYXk8YW55Pn0gY2xpZW50ZXNcbiAqIEBwYXJhbSB7c3RyaW5nfSBjaGlwXG4gKiBAcmV0dXJucyB7QXJyYXk8YW55Pn1cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGFwcGx5Q2hpcEZpbHRlcihjbGllbnRlcywgY2hpcCkge1xuICBpZiAoIUFycmF5LmlzQXJyYXkoY2xpZW50ZXMpKSByZXR1cm4gW107XG4gIHN3aXRjaCAoY2hpcCkge1xuICAgIGNhc2UgJ2Jhc2VBY3RpdmE5MGQnOlxuICAgICAgcmV0dXJuIGNsaWVudGVzLmZpbHRlcihcbiAgICAgICAgKGMpID0+IGMuZGlhc1NpbkNvbXByYSAhPT0gbnVsbCAmJiBjLmRpYXNTaW5Db21wcmEgIT09IHVuZGVmaW5lZCAmJiBjLmRpYXNTaW5Db21wcmEgPD0gOTBcbiAgICAgICk7XG4gICAgY2FzZSAnZG9ybWlkb3NWaXNpdGEzMGQnOlxuICAgICAgcmV0dXJuIGNsaWVudGVzLmZpbHRlcihcbiAgICAgICAgKGMpID0+XG4gICAgICAgICAgYy5kaWFzU2luVmlzaXRhUHJlc2VuY2lhbCAhPT0gbnVsbCAmJlxuICAgICAgICAgIGMuZGlhc1NpblZpc2l0YVByZXNlbmNpYWwgIT09IHVuZGVmaW5lZCAmJlxuICAgICAgICAgIGMuZGlhc1NpblZpc2l0YVByZXNlbmNpYWwgPiAzMFxuICAgICAgKTtcbiAgICBjYXNlICdkb3JtaWRvc0NvbXByYTkwZCc6XG4gICAgICByZXR1cm4gY2xpZW50ZXMuZmlsdGVyKFxuICAgICAgICAoYykgPT4gYy5kaWFzU2luQ29tcHJhICE9PSBudWxsICYmIGMuZGlhc1NpbkNvbXByYSAhPT0gdW5kZWZpbmVkICYmIGMuZGlhc1NpbkNvbXByYSA+IDkwXG4gICAgICApO1xuICAgIGNhc2UgJ251bmNhVmlzaXRhZG9zJzpcbiAgICAgIHJldHVybiBjbGllbnRlcy5maWx0ZXIoXG4gICAgICAgIChjKSA9PiBjLnVsdGltYVZpc2l0YVByZXNlbmNpYWwgPT09IG51bGwgfHwgYy51bHRpbWFWaXNpdGFQcmVzZW5jaWFsID09PSB1bmRlZmluZWRcbiAgICAgICk7XG4gICAgY2FzZSAnbnVuY2FDb21wcmFyb24nOlxuICAgICAgcmV0dXJuIGNsaWVudGVzLmZpbHRlcigoYykgPT4gYy51bHRpbWFDb21wcmEgPT09IG51bGwgfHwgYy51bHRpbWFDb21wcmEgPT09IHVuZGVmaW5lZCk7XG4gICAgZGVmYXVsdDpcbiAgICAgIHJldHVybiBjbGllbnRlcy5zbGljZSgpO1xuICB9XG59XG5cbi8qKlxuICogT3JkZW5hIHVuYSBjb3BpYSBkZWwgYXJyYXkgcG9yIGNvbHVtbmEuIE51bGxzIHNpZW1wcmUgYWwgZmluYWwuXG4gKiBAcGFyYW0ge0FycmF5PGFueT59IGNsaWVudGVzXG4gKiBAcGFyYW0ge3N0cmluZ30gc29ydEJ5XG4gKiBAcGFyYW0geydhc2MnfCdkZXNjJ30gc29ydERpclxuICogQHJldHVybnMge0FycmF5PGFueT59XG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzb3J0Q2xpZW50ZXMoY2xpZW50ZXMsIHNvcnRCeSwgc29ydERpcikge1xuICBpZiAoIUFycmF5LmlzQXJyYXkoY2xpZW50ZXMpKSByZXR1cm4gW107XG4gIGNvbnN0IGRpciA9IHNvcnREaXIgPT09ICdhc2MnID8gMSA6IC0xO1xuICBjb25zdCBjb3B5ID0gY2xpZW50ZXMuc2xpY2UoKTtcbiAgY29weS5zb3J0KChhLCBiKSA9PiB7XG4gICAgY29uc3QgYXYgPSBhW3NvcnRCeV07XG4gICAgY29uc3QgYnYgPSBiW3NvcnRCeV07XG4gICAgY29uc3QgYU51bGwgPSBhdiA9PT0gbnVsbCB8fCBhdiA9PT0gdW5kZWZpbmVkO1xuICAgIGNvbnN0IGJOdWxsID0gYnYgPT09IG51bGwgfHwgYnYgPT09IHVuZGVmaW5lZDtcbiAgICBpZiAoYU51bGwgJiYgYk51bGwpIHJldHVybiAwO1xuICAgIGlmIChhTnVsbCkgcmV0dXJuIDE7XG4gICAgaWYgKGJOdWxsKSByZXR1cm4gLTE7XG4gICAgaWYgKHR5cGVvZiBhdiA9PT0gJ251bWJlcicgJiYgdHlwZW9mIGJ2ID09PSAnbnVtYmVyJykgcmV0dXJuIChhdiAtIGJ2KSAqIGRpcjtcbiAgICByZXR1cm4gU3RyaW5nKGF2KS5sb2NhbGVDb21wYXJlKFN0cmluZyhidikpICogZGlyO1xuICB9KTtcbiAgcmV0dXJuIGNvcHk7XG59XG4iLCAiLy8gQHRzLW5vY2hlY2tcbi8vIE5PVEE6IEB0cy1ub2NoZWNrIGludGVuY2lvbmFsLiBFbCBjaHVuayBlcyBoZWF2eSBET00gKyB3aW5kb3cuKiBoYW5kbGVycyArXG4vLyBGaXJlc3RvcmUgU0RLIGNvbXBhdCB2OC4gQW5vdGFyIHN0cmljdGFtZW50ZSBjYWRhIGhhbmRsZXIgc2VyXHUwMEVEYSBydWlkbyBzaW5cbi8vIHZhbG9yIFx1MjAxNCBsb3MgaGVscGVycyBwdXJvcyBxdWUgaW1wb3J0YW1vcyAoLi4vcHVyZS9jYXJ0ZXJhLXZlbmRvci1maWx0ZXIuanMpXG4vLyB5IGVsIGNvcmUgKGZ1bmN0aW9ucy9jb3JlL2NhcnRlcmEtdmVuZG9yLWNvcmUuanMpIHNcdTAwRUQgdGllbmVuIEB0cy1jaGVjay5cbi8qKlxuICogY2FydGVyYS12ZW5kb3IuanMgKHYxMjgzLCAyMDI2LTEwLTIwKSBcdTIwMTQgYnVuZGxlIGNodW5rIGxhenkuXG4gKlxuICogRGFzaGJvYXJkIFwiQW5hbGlzaXMgZGUgQ2FydGVyYSBwb3IgVmVuZGVkb3JcIi4gUmVlbXBsYXphIHNlZ3VpbWllbnRvLmpzLlxuICogTGVlIGNhcnRlcmFfdmVuZG9yL3t2ZW5kb3JLZXl9IEZpcmVzdG9yZSAoc25hcHNob3QgbmlnaHRseSAwNDowMCBBUlQpLlxuICpcbiAqIFRPRE8gZWwgRE9NIHJlbmRlciB1c2EgY3JlYXRlRWxlbWVudCArIHRleHRDb250ZW50IChwb2xpY3kgYW50aS1YU1MsIG5vIGlubmVySFRNTCkuXG4gKlxuICogU3BlYzogZG9jcy9zdXBlcnBvd2Vycy9zcGVjcy8yMDI2LTEwLTIwLWNhcnRlcmEtdmVuZG9yLWFuYWxpc2lzLWRlc2lnbi5tZFxuICogUGxhbjogZG9jcy9zdXBlcnBvd2Vycy9wbGFucy8yMDI2LTEwLTIwLWNhcnRlcmEtdmVuZG9yLWFuYWxpc2lzLm1kXG4gKi9cblxuaW1wb3J0IHsgYXBwbHlDaGlwRmlsdGVyLCBzb3J0Q2xpZW50ZXMgfSBmcm9tICcuLi9wdXJlL2NhcnRlcmEtdmVuZG9yLWZpbHRlci5qcyc7XG5cbi8qKiBAdHlwZSB7TWFwPHN0cmluZywgYW55Pn0gKi9cbmNvbnN0IGNhcnRlcmFEb2NDYWNoZSA9IG5ldyBNYXAoKTtcbi8qKiBAdHlwZSB7c3RyaW5nfG51bGx9ICovXG5sZXQgc2VsZWN0ZWRWZW5kb3IgPSBudWxsO1xubGV0IGFjdGl2ZUNoaXAgPSAndG9kb3MnO1xubGV0IHNlYXJjaFF1ZXJ5ID0gJyc7XG5sZXQgc29ydEJ5ID0gJ2RpYXNTaW5Db21wcmEnO1xuLyoqIEB0eXBlIHsnYXNjJ3wnZGVzYyd9ICovXG5sZXQgc29ydERpciA9ICdkZXNjJztcblxuY29uc3QgQ0hJUFMgPSBbXG4gIHsgaWQ6ICd0b2RvcycsIGxhYmVsOiAnVG9kb3MnIH0sXG4gIHsgaWQ6ICdiYXNlQWN0aXZhOTBkJywgbGFiZWw6ICdCYXNlIGFjdGl2YSA5MGQnIH0sXG4gIHsgaWQ6ICdkb3JtaWRvc1Zpc2l0YTMwZCcsIGxhYmVsOiAnRG9ybWlkb3MgdmlzaXRhIDMwZCcgfSxcbiAgeyBpZDogJ2Rvcm1pZG9zQ29tcHJhOTBkJywgbGFiZWw6ICdEb3JtaWRvcyBjb21wcmEgOTBkJyB9LFxuICB7IGlkOiAnbnVuY2FWaXNpdGFkb3MnLCBsYWJlbDogJ051bmNhIHZpc2l0YWRvcycgfSxcbiAgeyBpZDogJ251bmNhQ29tcHJhcm9uJywgbGFiZWw6ICdOdW5jYSBjb21wcmFyb24nIH0sXG5dO1xuXG5jb25zdCBLUElfQ0FSRFMgPSBbXG4gIHsgY2hpcDogJ3RvZG9zJywgbGFiZWw6ICdUb3RhbCBjYXJ0ZXJhJywgY29sb3I6ICcjNjQ3NDhiJyB9LFxuICB7IGNoaXA6ICdiYXNlQWN0aXZhOTBkJywgbGFiZWw6ICdCYXNlIGFjdGl2YSA5MGQnLCBjb2xvcjogJyMxNmEzNGEnIH0sXG4gIHsgY2hpcDogJ2Rvcm1pZG9zVmlzaXRhMzBkJywgbGFiZWw6ICdEb3JtaWRvcyB2aXMgMzBkJywgY29sb3I6ICcjZWE1ODBjJyB9LFxuICB7IGNoaXA6ICdkb3JtaWRvc0NvbXByYTkwZCcsIGxhYmVsOiAnRG9ybWlkb3MgY29tIDkwZCcsIGNvbG9yOiAnI2RjMjYyNicgfSxcbiAgeyBjaGlwOiAnbnVuY2FWaXNpdGFkb3MnLCBsYWJlbDogJ051bmNhIHZpc2l0YWRvcycsIGNvbG9yOiAnIzdjM2FlZCcgfSxcbiAgeyBjaGlwOiAnbnVuY2FDb21wcmFyb24nLCBsYWJlbDogJ051bmNhIGNvbXByYXJvbicsIGNvbG9yOiAnI2JlMTg1ZCcgfSxcbl07XG5cbi8vIHYxMzg0ICgyMDI2LTEwLTIxKTogd2hpdGVsaXN0IGRlIGxvcyA2IFZERSByZWFsZXMgb3BlcmF0aXZvcyAocGVkaWRvIE1hcmlhbm8pLlxuLy8gRmlsdHJhIGVsIGRyb3Bkb3duIHBhcmEgZXhjbHVpciBydWlkbyBlbiBjbGllbnRfYXBwbGljYXRpb25zLmFzc2lnbmVkVmVuZG9yOlxuLy8gJ0FETUlOX0xET09HMkY0TVdWTVhLUU9EOFlDQk9JUlUyTzInIChhZG1pbiB1aWQgcXVlIHF1ZWRvIGNvbW8gc3RyaW5nIHZlbmRvciksXG4vLyAnRU1QTEVBRE8nIChhbHRhcyBpbnRlcm5hcyksICdESUVHTyBWQUxTSScgKGV4LVZERSBjb24gMSBjbGllbnRlIGhpc3RvcmljbykuXG4vLyBTaSBlbiBlbCBmdXR1cm8gc2UgaW5jb3Jwb3JhIHVuIG51ZXZvIFZERSwgYWdyZWdhcmxvIGFxdWkgKyB2ZXJpZmljYXIgcXVlIGxhXG4vLyB2aXN0YSBCUSB2X2NhcnRlcmFfdmVuZG9yIGxvIGNhbm9uaWNhbGl6ZSBpZ3VhbCAodmVyIGJpZ3F1ZXJ5L3ZpZXdzLnNxbDozNDgwKS5cbmNvbnN0IFZFTkRPUlNfV0hJVEVMSVNUID0gbmV3IFNldChbXG4gICdGRURFUklDTyBDQVNURUxBTkVMTEknLFxuICAnR09OWkFMTyBERSBMQSBST1NBJyxcbiAgJ0lPQU5OSVMgUEFMS09VREFLSVMnLFxuICAnTUFVUklDSU8gR0lMJyxcbiAgJ1BBQ0hJJyxcbiAgJ1NBTlRJQUdPIEVTVEVCQU4nLFxuXSk7XG5cbi8vID09PSBPcGVuIC8gY2xvc2UgPT09XG53aW5kb3cub3BlbkNhcnRlcmFNb2RhbCA9IGFzeW5jIGZ1bmN0aW9uIG9wZW5DYXJ0ZXJhTW9kYWwoKSB7XG4gIGNvbnN0IG1vZGFsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2NhcnRlcmEtbW9kYWwnKTtcbiAgaWYgKCFtb2RhbCkgcmV0dXJuO1xuICBtb2RhbC5jbGFzc0xpc3QuYWRkKCdvcGVuJyk7XG4gIGF3YWl0IHBvcHVsYXRlVmVuZG9yRHJvcGRvd24oKTtcbn07XG5cbndpbmRvdy5jbG9zZUNhcnRlcmFNb2RhbCA9IGZ1bmN0aW9uIGNsb3NlQ2FydGVyYU1vZGFsKCkge1xuICBjb25zdCBtb2RhbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdjYXJ0ZXJhLW1vZGFsJyk7XG4gIGlmIChtb2RhbCkgbW9kYWwuY2xhc3NMaXN0LnJlbW92ZSgnb3BlbicpO1xufTtcblxuLy8gPT09IERyb3Bkb3duIGRlIHZlbmRvcnMgPT09XG5hc3luYyBmdW5jdGlvbiBwb3B1bGF0ZVZlbmRvckRyb3Bkb3duKCkge1xuICBjb25zdCBzZWwgPSAvKiogQHR5cGUge0hUTUxTZWxlY3RFbGVtZW50fG51bGx9ICovIChcbiAgICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY2FydGVyYS12ZW5kb3Itc2VsZWN0JylcbiAgKTtcbiAgaWYgKCFzZWwpIHJldHVybjtcbiAgaWYgKHNlbC5vcHRpb25zLmxlbmd0aCA+IDEpIHJldHVybjtcbiAgdHJ5IHtcbiAgICAvLyBAdHMtZXhwZWN0LWVycm9yXG4gICAgY29uc3Qgc25hcCA9IGF3YWl0IGZpcmViYXNlLmZpcmVzdG9yZSgpLmNvbGxlY3Rpb24oJ2NhcnRlcmFfdmVuZG9yJykuZ2V0KCk7XG4gICAgLyoqIEB0eXBlIHtzdHJpbmdbXX0gKi9cbiAgICBjb25zdCB2ZW5kb3JzID0gW107XG4gICAgc25hcC5mb3JFYWNoKChkb2MpID0+IHtcbiAgICAgIC8vIHYxMzg0OiBzb2xvIFZERSB3aGl0ZWxpc3QuIFJlc3RvIChhZG1pbiB1aWQsIEVNUExFQURPLCBleC1WREUpIHNlIG9jdWx0YW4uXG4gICAgICBpZiAoVkVORE9SU19XSElURUxJU1QuaGFzKGRvYy5pZCkpIHZlbmRvcnMucHVzaChkb2MuaWQpO1xuICAgIH0pO1xuICAgIHZlbmRvcnMuc29ydCgpO1xuICAgIGZvciAoY29uc3QgdiBvZiB2ZW5kb3JzKSB7XG4gICAgICBjb25zdCBvcHQgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdvcHRpb24nKTtcbiAgICAgIG9wdC52YWx1ZSA9IHY7XG4gICAgICBvcHQudGV4dENvbnRlbnQgPSB2O1xuICAgICAgc2VsLmFwcGVuZENoaWxkKG9wdCk7XG4gICAgfVxuICB9IGNhdGNoIChlKSB7XG4gICAgY29uc29sZS5lcnJvcigncG9wdWxhdGVWZW5kb3JEcm9wZG93biBmYWlsZWQnLCBlKTtcbiAgfVxufVxuXG4vLyA9PT0gT24gdmVuZG9yIGNoYW5nZSA9PT1cbndpbmRvdy5vbkNhcnRlcmFWZW5kb3JDaGFuZ2UgPSBhc3luYyBmdW5jdGlvbiBvbkNhcnRlcmFWZW5kb3JDaGFuZ2UoKSB7XG4gIGNvbnN0IHNlbCA9IC8qKiBAdHlwZSB7SFRNTFNlbGVjdEVsZW1lbnR8bnVsbH0gKi8gKFxuICAgIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdjYXJ0ZXJhLXZlbmRvci1zZWxlY3QnKVxuICApO1xuICBpZiAoIXNlbCkgcmV0dXJuO1xuICBzZWxlY3RlZFZlbmRvciA9IHNlbC52YWx1ZSB8fCBudWxsO1xuICBhY3RpdmVDaGlwID0gJ3RvZG9zJztcbiAgc2VhcmNoUXVlcnkgPSAnJztcbiAgY29uc3Qgc2VhcmNoSW5wdXQgPSAvKiogQHR5cGUge0hUTUxJbnB1dEVsZW1lbnR8bnVsbH0gKi8gKFxuICAgIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdjYXJ0ZXJhLXNlYXJjaCcpXG4gICk7XG4gIGlmIChzZWFyY2hJbnB1dCkgc2VhcmNoSW5wdXQudmFsdWUgPSAnJztcbiAgaWYgKCFzZWxlY3RlZFZlbmRvcikge1xuICAgIHNob3dFbXB0eSgpO1xuICAgIHJldHVybjtcbiAgfVxuICBzaG93TG9hZGluZygpO1xuICB0cnkge1xuICAgIGxldCBkb2MgPSBjYXJ0ZXJhRG9jQ2FjaGUuZ2V0KHNlbGVjdGVkVmVuZG9yKTtcbiAgICBpZiAoIWRvYykge1xuICAgICAgLy8gQHRzLWV4cGVjdC1lcnJvclxuICAgICAgY29uc3Qgc25hcCA9IGF3YWl0IGZpcmViYXNlXG4gICAgICAgIC5maXJlc3RvcmUoKVxuICAgICAgICAuY29sbGVjdGlvbignY2FydGVyYV92ZW5kb3InKVxuICAgICAgICAuZG9jKHNlbGVjdGVkVmVuZG9yKVxuICAgICAgICAuZ2V0KCk7XG4gICAgICBpZiAoIXNuYXAuZXhpc3RzKSB7XG4gICAgICAgIHNob3dOb0RhdGEoKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgZG9jID0gc25hcC5kYXRhKCk7XG4gICAgICBjYXJ0ZXJhRG9jQ2FjaGUuc2V0KHNlbGVjdGVkVmVuZG9yLCBkb2MpO1xuICAgIH1cbiAgICByZW5kZXJEYXNoYm9hcmQoZG9jKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGNvbnNvbGUuZXJyb3IoJ29uQ2FydGVyYVZlbmRvckNoYW5nZSBmYWlsZWQnLCBlKTtcbiAgICBzaG93RXJyb3IoU3RyaW5nKGUpKTtcbiAgfVxufTtcblxuLyoqIEB0eXBlIHthbnl9ICovICh3aW5kb3cpLm9uQ2FydGVyYUNoaXBDbGljayA9IGZ1bmN0aW9uIG9uQ2FydGVyYUNoaXBDbGljayhjaGlwSWQpIHtcbiAgYWN0aXZlQ2hpcCA9IGNoaXBJZDtcbiAgaWYgKCFzZWxlY3RlZFZlbmRvcikgcmV0dXJuO1xuICBjb25zdCBkb2MgPSBjYXJ0ZXJhRG9jQ2FjaGUuZ2V0KHNlbGVjdGVkVmVuZG9yKTtcbiAgaWYgKGRvYykgcmVuZGVyRGFzaGJvYXJkKGRvYyk7XG59O1xuXG4vKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIHNldFRpbWVvdXQ+fG51bGx9ICovXG5sZXQgc2VhcmNoRGVib3VuY2VUaW1lciA9IG51bGw7XG53aW5kb3cub25DYXJ0ZXJhU2VhcmNoQ2hhbmdlID0gZnVuY3Rpb24gb25DYXJ0ZXJhU2VhcmNoQ2hhbmdlKCkge1xuICBjb25zdCBpbnB1dCA9IC8qKiBAdHlwZSB7SFRNTElucHV0RWxlbWVudHxudWxsfSAqLyAoZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2NhcnRlcmEtc2VhcmNoJykpO1xuICBpZiAoIWlucHV0KSByZXR1cm47XG4gIGlmIChzZWFyY2hEZWJvdW5jZVRpbWVyKSBjbGVhclRpbWVvdXQoc2VhcmNoRGVib3VuY2VUaW1lcik7XG4gIHNlYXJjaERlYm91bmNlVGltZXIgPSBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICBzZWFyY2hRdWVyeSA9IChpbnB1dC52YWx1ZSB8fCAnJykudHJpbSgpLnRvTG93ZXJDYXNlKCk7XG4gICAgaWYgKCFzZWxlY3RlZFZlbmRvcikgcmV0dXJuO1xuICAgIGNvbnN0IGRvYyA9IGNhcnRlcmFEb2NDYWNoZS5nZXQoc2VsZWN0ZWRWZW5kb3IpO1xuICAgIGlmIChkb2MpIHJlbmRlckRhc2hib2FyZChkb2MpO1xuICB9LCAzMDApO1xufTtcblxuLyoqIEB0eXBlIHthbnl9ICovICh3aW5kb3cpLm9uQ2FydGVyYVNvcnRDbGljayA9IGZ1bmN0aW9uIG9uQ2FydGVyYVNvcnRDbGljayhjb2xLZXkpIHtcbiAgaWYgKHNvcnRCeSA9PT0gY29sS2V5KSBzb3J0RGlyID0gc29ydERpciA9PT0gJ2FzYycgPyAnZGVzYycgOiAnYXNjJztcbiAgZWxzZSB7XG4gICAgc29ydEJ5ID0gY29sS2V5O1xuICAgIHNvcnREaXIgPSAnZGVzYyc7XG4gIH1cbiAgaWYgKCFzZWxlY3RlZFZlbmRvcikgcmV0dXJuO1xuICBjb25zdCBkb2MgPSBjYXJ0ZXJhRG9jQ2FjaGUuZ2V0KHNlbGVjdGVkVmVuZG9yKTtcbiAgaWYgKGRvYykgcmVuZGVyRGFzaGJvYXJkKGRvYyk7XG59O1xuXG4vLyA9PT0gUmVuZGVyID09PVxuZnVuY3Rpb24gcmVuZGVyRGFzaGJvYXJkKGRvYykge1xuICBjb25zdCBzdWJ0aXRsZSA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdjYXJ0ZXJhLXN1YnRpdGxlJyk7XG4gIGlmIChzdWJ0aXRsZSkgc3VidGl0bGUudGV4dENvbnRlbnQgPSBgJHtkb2MuY291bnRzLnRvdGFsfSBjbGllbnRlcyBlbiBjYXJ0ZXJhLmA7XG4gIGNvbnN0IGluZm8gPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY2FydGVyYS1zbmFwc2hvdC1pbmZvJyk7XG4gIGlmIChpbmZvKSB7XG4gICAgaW5mby50ZXh0Q29udGVudCA9IGBTbmFwc2hvdCAke2RvYy5zbmFwc2hvdERhdGV9YDtcbiAgICBpbmZvLnN0eWxlLmRpc3BsYXkgPSAnaW5saW5lLWZsZXgnO1xuICB9XG4gIHJlbmRlcktwaXMoZG9jLmNvdW50cyk7XG4gIHJlbmRlckNoaXBzKGRvYy5jb3VudHMpO1xuICByZW5kZXJUYWJsZShkb2MuY2xpZW50ZXMpO1xuICBzaG93VGFibGUoKTtcbn1cblxuZnVuY3Rpb24gcmVuZGVyS3Bpcyhjb3VudHMpIHtcbiAgY29uc3QgZWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY2FydGVyYS1rcGlzJyk7XG4gIGlmICghZWwpIHJldHVybjtcbiAgd2hpbGUgKGVsLmZpcnN0Q2hpbGQpIGVsLnJlbW92ZUNoaWxkKGVsLmZpcnN0Q2hpbGQpO1xuICAvLyB2MTM4MzogQXBwbGUtc3R5bGUgS1BJIGNhcmRzLiBDbGFzZXMgLmNhcnRlcmEta3BpIGRlZmluaWRhcyBlbiBpbmRleC5odG1sLlxuICAvLyBDb2xvciBzZSBhcGxpY2Egc29sbyBhbCBuXHUwMEZBbWVybyArIHVuZGVybGluZSAoc3V0aWwgaWRlbnRpZGFkIHBvciBjYXRlZ29yXHUwMEVEYSkuXG4gIGZvciAoY29uc3Qgc3BlYyBvZiBLUElfQ0FSRFMpIHtcbiAgICBjb25zdCBjYXJkID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2Jyk7XG4gICAgY2FyZC5jbGFzc05hbWUgPSAnY2FydGVyYS1rcGknO1xuICAgIGlmIChhY3RpdmVDaGlwID09PSBzcGVjLmNoaXApIGNhcmQuY2xhc3NMaXN0LmFkZCgnYWN0aXZlJyk7XG4gICAgY2FyZC5zdHlsZS5jb2xvciA9IHNwZWMuY29sb3I7IC8vIGN1cnJlbnRDb2xvciBwYXJhIGVsIG51bWJlciArIDo6YWZ0ZXIgdW5kZXJsaW5lXG4gICAgY2FyZC5hZGRFdmVudExpc3RlbmVyKCdjbGljaycsICgpID0+IC8qKiBAdHlwZSB7YW55fSAqLyAod2luZG93KS5vbkNhcnRlcmFDaGlwQ2xpY2soc3BlYy5jaGlwKSk7XG4gICAgY29uc3QgbiA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpO1xuICAgIG4uY2xhc3NOYW1lID0gJ2NhcnRlcmEta3BpLW51bSc7XG4gICAgbi50ZXh0Q29udGVudCA9IFN0cmluZyhjb3VudHNbc3BlYy5jaGlwID09PSAndG9kb3MnID8gJ3RvdGFsJyA6IHNwZWMuY2hpcF0pO1xuICAgIGNvbnN0IGwgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKTtcbiAgICBsLmNsYXNzTmFtZSA9ICdjYXJ0ZXJhLWtwaS1sYWJlbCc7XG4gICAgbC5zdHlsZS5jb2xvciA9ICcnOyAvLyByZXNldCBjdXJyZW50Q29sb3IgcGFyYSBxdWUgdXNlIGVsIG11dGVkIGRlbCBDU1NcbiAgICBsLnRleHRDb250ZW50ID0gc3BlYy5sYWJlbDtcbiAgICBjYXJkLmFwcGVuZENoaWxkKG4pO1xuICAgIGNhcmQuYXBwZW5kQ2hpbGQobCk7XG4gICAgZWwuYXBwZW5kQ2hpbGQoY2FyZCk7XG4gIH1cbn1cblxuZnVuY3Rpb24gcmVuZGVyQ2hpcHMoY291bnRzKSB7XG4gIGNvbnN0IGVsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2NhcnRlcmEtY2hpcHMnKTtcbiAgaWYgKCFlbCkgcmV0dXJuO1xuICBjb25zdCBjb3VudEJ5Q2hpcCA9IHtcbiAgICB0b2RvczogY291bnRzLnRvdGFsLFxuICAgIGJhc2VBY3RpdmE5MGQ6IGNvdW50cy5iYXNlQWN0aXZhOTBkLFxuICAgIGRvcm1pZG9zVmlzaXRhMzBkOiBjb3VudHMuZG9ybWlkb3NWaXNpdGEzMGQsXG4gICAgZG9ybWlkb3NDb21wcmE5MGQ6IGNvdW50cy5kb3JtaWRvc0NvbXByYTkwZCxcbiAgICBudW5jYVZpc2l0YWRvczogY291bnRzLm51bmNhVmlzaXRhZG9zLFxuICAgIG51bmNhQ29tcHJhcm9uOiBjb3VudHMubnVuY2FDb21wcmFyb24sXG4gIH07XG4gIHdoaWxlIChlbC5maXJzdENoaWxkKSBlbC5yZW1vdmVDaGlsZChlbC5maXJzdENoaWxkKTtcbiAgLy8gdjEzODM6IHNlZ21lbnRlZCBjb250cm9sIGlPUy4gV3JhcHBlciAuY2FydGVyYS1jaGlwLXdyYXAgYWdydXBhIHBpbGxzIGNvbiBiZyBncmlzLlxuICBjb25zdCB3cmFwID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2Jyk7XG4gIHdyYXAuY2xhc3NOYW1lID0gJ2NhcnRlcmEtY2hpcC13cmFwJztcbiAgZm9yIChjb25zdCBjaGlwIG9mIENISVBTKSB7XG4gICAgY29uc3QgYiA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2J1dHRvbicpO1xuICAgIGIuY2xhc3NOYW1lID0gJ2NhcnRlcmEtY2hpcCc7XG4gICAgaWYgKGFjdGl2ZUNoaXAgPT09IGNoaXAuaWQpIGIuY2xhc3NMaXN0LmFkZCgnYWN0aXZlJyk7XG4gICAgYi50eXBlID0gJ2J1dHRvbic7XG4gICAgYi50ZXh0Q29udGVudCA9IGAke2NoaXAubGFiZWx9ICgke2NvdW50QnlDaGlwW2NoaXAuaWRdfSlgO1xuICAgIGIuYWRkRXZlbnRMaXN0ZW5lcignY2xpY2snLCAoKSA9PiAvKiogQHR5cGUge2FueX0gKi8gKHdpbmRvdykub25DYXJ0ZXJhQ2hpcENsaWNrKGNoaXAuaWQpKTtcbiAgICB3cmFwLmFwcGVuZENoaWxkKGIpO1xuICB9XG4gIGVsLmFwcGVuZENoaWxkKHdyYXApO1xufVxuXG4vKiogQHBhcmFtIHtBcnJheTxhbnk+fSBjbGllbnRlcyAqL1xuZnVuY3Rpb24gcmVuZGVyVGFibGUoY2xpZW50ZXMpIHtcbiAgY29uc3QgdGFibGUgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY2FydGVyYS10YWJsZScpO1xuICBpZiAoIXRhYmxlKSByZXR1cm47XG4gIGNvbnN0IGZpbHRlcmVkID0gYXBwbHlDaGlwRmlsdGVyKGNsaWVudGVzLCBhY3RpdmVDaGlwKTtcbiAgY29uc3Qgc2VhcmNoZWQgPSBzZWFyY2hRdWVyeVxuICAgID8gZmlsdGVyZWQuZmlsdGVyKChjKSA9PlxuICAgICAgICBTdHJpbmcoYy5jbGllbnROYW1lIHx8ICcnKVxuICAgICAgICAgIC50b0xvd2VyQ2FzZSgpXG4gICAgICAgICAgLmluY2x1ZGVzKHNlYXJjaFF1ZXJ5KVxuICAgICAgKVxuICAgIDogZmlsdGVyZWQ7XG4gIGNvbnN0IHNvcnRlZCA9IHNvcnRDbGllbnRlcyhzZWFyY2hlZCwgc29ydEJ5LCBzb3J0RGlyKTtcbiAgd2hpbGUgKHRhYmxlLmZpcnN0Q2hpbGQpIHRhYmxlLnJlbW92ZUNoaWxkKHRhYmxlLmZpcnN0Q2hpbGQpO1xuICB0YWJsZS5hcHBlbmRDaGlsZChidWlsZFRoZWFkKCkpO1xuICB0YWJsZS5hcHBlbmRDaGlsZChidWlsZFRib2R5KHNvcnRlZCkpO1xufVxuXG5mdW5jdGlvbiBidWlsZFRoZWFkKCkge1xuICAvLyB2MTM4MzogQXBwbGUtc3R5bGUgdGhlYWQuIENsYXNlcyAuY2FydGVyYS0qIGVuIGluZGV4Lmh0bWwgY29udHJvbGFuIGJnL2NvbG9ycy5cbiAgY29uc3QgdGhlYWQgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCd0aGVhZCcpO1xuICBjb25zdCB0ciA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3RyJyk7XG4gIGNvbnN0IGhlYWRlcnMgPSBbXG4gICAgeyBsYWJlbDogJ0NsaWVudGUnLCBzb3J0S2V5OiAnY2xpZW50TmFtZScsIGFsaWduOiAnbGVmdCcgfSxcbiAgICB7IGxhYmVsOiAnUHJvdi9Mb2MnLCBzb3J0S2V5OiBudWxsLCBhbGlnbjogJ2xlZnQnIH0sXG4gICAgeyBsYWJlbDogJ1RpcG8nLCBzb3J0S2V5OiBudWxsLCBhbGlnbjogJ2NlbnRlcicgfSxcbiAgICB7IGxhYmVsOiAnXHUwMERBbHQuIHZpc2l0YScsIHNvcnRLZXk6ICdkaWFzU2luVmlzaXRhUHJlc2VuY2lhbCcsIGFsaWduOiAnbGVmdCcgfSxcbiAgICB7IGxhYmVsOiAnXHUwMERBbHQuIGNvbnRhY3RvJywgc29ydEtleTogJ2RpYXNTaW5Db250YWN0bycsIGFsaWduOiAnbGVmdCcgfSxcbiAgICB7IGxhYmVsOiAnXHUwMERBbHQuIGNvbXByYScsIHNvcnRLZXk6ICdkaWFzU2luQ29tcHJhJywgYWxpZ246ICdsZWZ0JyB9LFxuICAgIHsgbGFiZWw6ICdGYWN0IDEyTScsIHNvcnRLZXk6ICdmYWN0dXJhZG8xMk0nLCBhbGlnbjogJ3JpZ2h0JyB9LFxuICAgIHsgbGFiZWw6ICdEZXVkYScsIHNvcnRLZXk6ICdkZXVkYUFiaWVydGEnLCBhbGlnbjogJ3JpZ2h0JyB9LFxuICBdO1xuICBmb3IgKGNvbnN0IGggb2YgaGVhZGVycykge1xuICAgIGNvbnN0IHRoID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgndGgnKTtcbiAgICB0aC5zdHlsZS50ZXh0QWxpZ24gPSBoLmFsaWduO1xuICAgIHRoLnRleHRDb250ZW50ID0gaC5sYWJlbDtcbiAgICBpZiAoaC5zb3J0S2V5KSB7XG4gICAgICB0aC5zdHlsZS5jdXJzb3IgPSAncG9pbnRlcic7XG4gICAgICBjb25zdCBrZXkgPSBoLnNvcnRLZXk7XG4gICAgICB0aC5hZGRFdmVudExpc3RlbmVyKCdjbGljaycsICgpID0+IC8qKiBAdHlwZSB7YW55fSAqLyAod2luZG93KS5vbkNhcnRlcmFTb3J0Q2xpY2soa2V5KSk7XG4gICAgfVxuICAgIHRyLmFwcGVuZENoaWxkKHRoKTtcbiAgfVxuICB0aGVhZC5hcHBlbmRDaGlsZCh0cik7XG4gIHJldHVybiB0aGVhZDtcbn1cblxuLyoqIEBwYXJhbSB7QXJyYXk8YW55Pn0gc29ydGVkQ2xpZW50ZXMgKi9cbmZ1bmN0aW9uIGJ1aWxkVGJvZHkoc29ydGVkQ2xpZW50ZXMpIHtcbiAgY29uc3QgdGJvZHkgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCd0Ym9keScpO1xuICBmb3IgKGNvbnN0IGMgb2Ygc29ydGVkQ2xpZW50ZXMpIHtcbiAgICB0Ym9keS5hcHBlbmRDaGlsZChidWlsZENsaWVudGVSb3coYykpO1xuICB9XG4gIHJldHVybiB0Ym9keTtcbn1cblxuLyoqIEBwYXJhbSB7YW55fSBjICovXG5mdW5jdGlvbiBidWlsZENsaWVudGVSb3coYykge1xuICBjb25zdCB0ciA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3RyJyk7XG4gIHRyLnN0eWxlLmNzc1RleHQgPSAnY3Vyc29yOnBvaW50ZXI7Ym9yZGVyLWJvdHRvbToxcHggc29saWQgdmFyKC0tYm9yZGVyLWxpZ2h0KSc7XG4gIHRyLmFkZEV2ZW50TGlzdGVuZXIoJ21vdXNlZW50ZXInLCAoKSA9PiB7XG4gICAgdHIuc3R5bGUuYmFja2dyb3VuZCA9ICd2YXIoLS1iZy1ob3ZlciknO1xuICB9KTtcbiAgdHIuYWRkRXZlbnRMaXN0ZW5lcignbW91c2VsZWF2ZScsICgpID0+IHtcbiAgICB0ci5zdHlsZS5iYWNrZ3JvdW5kID0gJyc7XG4gIH0pO1xuICB0ci5hZGRFdmVudExpc3RlbmVyKCdjbGljaycsICgpID0+IHtcbiAgICAvLyBAdHMtZXhwZWN0LWVycm9yXG4gICAgaWYgKHR5cGVvZiB3aW5kb3cub3BlbkZpY2hhQ2xpZW50ZSA9PT0gJ2Z1bmN0aW9uJykgd2luZG93Lm9wZW5GaWNoYUNsaWVudGUoYy5jbGllbnRJZCk7XG4gIH0pO1xuXG4gIGNvbnN0IHRkTmFtZSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3RkJyk7XG4gIHRkTmFtZS5zdHlsZS5jc3NUZXh0ID0gJ3BhZGRpbmc6NnB4IDhweDtmb250LXdlaWdodDo2MDAnO1xuICB0ZE5hbWUudGV4dENvbnRlbnQgPSBjLmNsaWVudE5hbWUgfHwgJyc7XG4gIHRyLmFwcGVuZENoaWxkKHRkTmFtZSk7XG5cbiAgY29uc3QgdGRMb2MgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCd0ZCcpO1xuICB0ZExvYy5zdHlsZS5jc3NUZXh0ID0gJ3BhZGRpbmc6NnB4IDhweDtmb250LXNpemU6MTJweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKSc7XG4gIHRkTG9jLnRleHRDb250ZW50ID0gYCR7Yy5wcm92aW5jaWEgfHwgJyd9LyR7Yy5sb2NhbGlkYWQgfHwgJyd9YDtcbiAgdHIuYXBwZW5kQ2hpbGQodGRMb2MpO1xuXG4gIGNvbnN0IHRkVGlwbyA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3RkJyk7XG4gIHRkVGlwby5zdHlsZS5jc3NUZXh0ID0gJ3BhZGRpbmc6NnB4IDhweDt0ZXh0LWFsaWduOmNlbnRlcic7XG4gIGNvbnN0IHRpcG9CYWRnZSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3NwYW4nKTtcbiAgdGlwb0JhZGdlLnN0eWxlLmNzc1RleHQgPVxuICAgICdwYWRkaW5nOjJweCA2cHg7Ym9yZGVyLXJhZGl1czo0cHg7YmFja2dyb3VuZDp2YXIoLS1iZy1pbnB1dCk7Zm9udC1zaXplOjExcHg7Zm9udC13ZWlnaHQ6NzAwJztcbiAgdGlwb0JhZGdlLnRleHRDb250ZW50ID0gYy5jbGlUaXBvIHx8ICctJztcbiAgdGRUaXBvLmFwcGVuZENoaWxkKHRpcG9CYWRnZSk7XG4gIHRyLmFwcGVuZENoaWxkKHRkVGlwbyk7XG5cbiAgdHIuYXBwZW5kQ2hpbGQoYnVpbGREYXRlQ2VsbChjLnVsdGltYVZpc2l0YVByZXNlbmNpYWwsIGMuZGlhc1NpblZpc2l0YVByZXNlbmNpYWwsIDMwKSk7XG4gIHRyLmFwcGVuZENoaWxkKGJ1aWxkRGF0ZUNlbGwoYy51bHRpbW9Db250YWN0bywgYy5kaWFzU2luQ29udGFjdG8sIG51bGwpKTtcbiAgdHIuYXBwZW5kQ2hpbGQoYnVpbGREYXRlQ2VsbChjLnVsdGltYUNvbXByYSwgYy5kaWFzU2luQ29tcHJhLCA5MCkpO1xuXG4gIGNvbnN0IHRkRmFjdCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3RkJyk7XG4gIHRkRmFjdC5zdHlsZS5jc3NUZXh0ID0gJ3BhZGRpbmc6NnB4IDhweDt0ZXh0LWFsaWduOnJpZ2h0O2ZvbnQtdmFyaWFudC1udW1lcmljOnRhYnVsYXItbnVtcyc7XG4gIHRkRmFjdC50ZXh0Q29udGVudCA9IGZtdE1vbmV5KGMuZmFjdHVyYWRvMTJNKTtcbiAgdHIuYXBwZW5kQ2hpbGQodGRGYWN0KTtcblxuICBjb25zdCB0ZERldWRhID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgndGQnKTtcbiAgdGREZXVkYS5zdHlsZS5jc3NUZXh0ID0gYHBhZGRpbmc6NnB4IDhweDt0ZXh0LWFsaWduOnJpZ2h0O2ZvbnQtdmFyaWFudC1udW1lcmljOnRhYnVsYXItbnVtcztjb2xvcjoke2MuZGV1ZGFBYmllcnRhID4gMCA/ICcjZGMyNjI2JyA6ICd2YXIoLS10ZXh0LW11dGVkKSd9YDtcbiAgdGREZXVkYS50ZXh0Q29udGVudCA9IGZtdE1vbmV5KGMuZGV1ZGFBYmllcnRhKTtcbiAgdHIuYXBwZW5kQ2hpbGQodGREZXVkYSk7XG5cbiAgcmV0dXJuIHRyO1xufVxuXG4vKipcbiAqIEBwYXJhbSB7c3RyaW5nfG51bGx9IGZlY2hhSXNvXG4gKiBAcGFyYW0ge251bWJlcnxudWxsfSBkaWFzXG4gKiBAcGFyYW0ge251bWJlcnxudWxsfSBkYW5nZXJUaHJlc2hvbGRcbiAqL1xuZnVuY3Rpb24gYnVpbGREYXRlQ2VsbChmZWNoYUlzbywgZGlhcywgZGFuZ2VyVGhyZXNob2xkKSB7XG4gIGNvbnN0IHRkID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgndGQnKTtcbiAgY29uc3QgaXNEYW5nZXIgPVxuICAgIGRhbmdlclRocmVzaG9sZCAhPT0gbnVsbCAmJiBkaWFzICE9PSBudWxsICYmIGRpYXMgIT09IHVuZGVmaW5lZCAmJiBkaWFzID4gZGFuZ2VyVGhyZXNob2xkO1xuICB0ZC5zdHlsZS5jc3NUZXh0ID0gYHBhZGRpbmc6NnB4IDhweDtjb2xvcjoke2lzRGFuZ2VyID8gJyNkYzI2MjYnIDogJ3ZhcigtLXRleHQtcHJpbWFyeSknfWA7XG4gIGlmICghZmVjaGFJc28pIHtcbiAgICB0ZC50ZXh0Q29udGVudCA9ICdcdTIwMTQnO1xuICAgIHJldHVybiB0ZDtcbiAgfVxuICBjb25zdCBwYXJ0cyA9IFN0cmluZyhmZWNoYUlzbykuc3BsaXQoJy0nKTtcbiAgY29uc3QgZCA9IHBhcnRzWzJdIHx8ICcnO1xuICBjb25zdCBtID0gcGFydHNbMV0gfHwgJyc7XG4gIHRkLnRleHRDb250ZW50ID0gYCR7ZH0vJHttfWA7XG4gIGNvbnN0IGRpYXNFbCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3NtYWxsJyk7XG4gIGRpYXNFbC5zdHlsZS5jc3NUZXh0ID0gJ2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO21hcmdpbi1sZWZ0OjRweCc7XG4gIGRpYXNFbC50ZXh0Q29udGVudCA9IGAke2RpYXN9ZGA7XG4gIHRkLmFwcGVuZENoaWxkKGRpYXNFbCk7XG4gIHJldHVybiB0ZDtcbn1cblxuLyoqIEBwYXJhbSB7bnVtYmVyfSBuICovXG5mdW5jdGlvbiBmbXRNb25leShuKSB7XG4gIGlmICghbiB8fCBuID09PSAwKSByZXR1cm4gJy0nO1xuICBpZiAobiA+PSAxXzAwMF8wMDApIHJldHVybiBgJCAkeyhuIC8gMV8wMDBfMDAwKS50b0ZpeGVkKDEpfU1gO1xuICBpZiAobiA+PSAxXzAwMCkgcmV0dXJuIGAkICR7KG4gLyAxXzAwMCkudG9GaXhlZCgwKX1rYDtcbiAgcmV0dXJuIGAkICR7bn1gO1xufVxuXG4vLyA9PT0gVUkgc3RhdGUgaGVscGVycyA9PT1cbmZ1bmN0aW9uIGhpZGVBbGwoKSB7XG4gIGNvbnN0IGlkcyA9IFtcbiAgICAnY2FydGVyYS1sb2FkaW5nJyxcbiAgICAnY2FydGVyYS10YWJsZScsXG4gICAgJ2NhcnRlcmEta3BpcycsXG4gICAgJ2NhcnRlcmEtY2hpcHMnLFxuICAgICdjYXJ0ZXJhLWVtcHR5JyxcbiAgXTtcbiAgZm9yIChjb25zdCBpZCBvZiBpZHMpIHtcbiAgICBjb25zdCBlbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKGlkKTtcbiAgICBpZiAoZWwpIGVsLnN0eWxlLmRpc3BsYXkgPSAnbm9uZSc7XG4gIH1cbn1cbmZ1bmN0aW9uIHNob3dFbXB0eSgpIHtcbiAgaGlkZUFsbCgpO1xuICBjb25zdCBlbXB0eSA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdjYXJ0ZXJhLWVtcHR5Jyk7XG4gIGlmIChlbXB0eSkge1xuICAgIGVtcHR5LnN0eWxlLmRpc3BsYXkgPSAnYmxvY2snO1xuICAgIGVtcHR5LnRleHRDb250ZW50ID0gJ0VsZWdcdTAwRUQgdW4gdmVuZGVkb3IgcGFyYSB2ZXIgc3UgY2FydGVyYS4nO1xuICB9XG59XG5mdW5jdGlvbiBzaG93TG9hZGluZygpIHtcbiAgaGlkZUFsbCgpO1xuICBjb25zdCBsb2FkaW5nID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2NhcnRlcmEtbG9hZGluZycpO1xuICBpZiAobG9hZGluZykgbG9hZGluZy5zdHlsZS5kaXNwbGF5ID0gJ2Jsb2NrJztcbn1cbmZ1bmN0aW9uIHNob3dOb0RhdGEoKSB7XG4gIGhpZGVBbGwoKTtcbiAgY29uc3QgZW1wdHkgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY2FydGVyYS1lbXB0eScpO1xuICBpZiAoZW1wdHkpIHtcbiAgICBlbXB0eS5zdHlsZS5kaXNwbGF5ID0gJ2Jsb2NrJztcbiAgICBlbXB0eS50ZXh0Q29udGVudCA9XG4gICAgICAnU2luIGNhcnRlcmEgcGFyYSBlc3RlIHZlbmRlZG9yLiBWZXJpZmljXHUwMEUxIGFzc2lnbmVkVmVuZG9yIGVuIGNsaWVudF9tYXN0ZXIgbyBlc3Blclx1MDBFMSBhbCBwclx1MDBGM3hpbW8gc25hcHNob3QgKDA0OjAwIEFSVCkuJztcbiAgfVxufVxuLyoqIEBwYXJhbSB7c3RyaW5nfSBtc2cgKi9cbmZ1bmN0aW9uIHNob3dFcnJvcihtc2cpIHtcbiAgaGlkZUFsbCgpO1xuICBjb25zdCBlbXB0eSA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdjYXJ0ZXJhLWVtcHR5Jyk7XG4gIGlmIChlbXB0eSkge1xuICAgIGVtcHR5LnN0eWxlLmRpc3BsYXkgPSAnYmxvY2snO1xuICAgIGVtcHR5LnN0eWxlLmNvbG9yID0gJyNkYzI2MjYnO1xuICAgIGVtcHR5LnRleHRDb250ZW50ID0gYEVycm9yIGNhcmdhbmRvIGNhcnRlcmE6ICR7bXNnfWA7XG4gIH1cbn1cbmZ1bmN0aW9uIHNob3dUYWJsZSgpIHtcbiAgY29uc3QgZW1wdHkgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY2FydGVyYS1lbXB0eScpO1xuICBpZiAoZW1wdHkpIGVtcHR5LnN0eWxlLmRpc3BsYXkgPSAnbm9uZSc7XG4gIGNvbnN0IGxvYWRpbmcgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY2FydGVyYS1sb2FkaW5nJyk7XG4gIGlmIChsb2FkaW5nKSBsb2FkaW5nLnN0eWxlLmRpc3BsYXkgPSAnbm9uZSc7XG4gIGNvbnN0IHRhYmxlID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2NhcnRlcmEtdGFibGUnKTtcbiAgaWYgKHRhYmxlKSB0YWJsZS5zdHlsZS5kaXNwbGF5ID0gJ3RhYmxlJztcbiAgLy8gdjEzODM6IGRpc3BsYXkgdmFjaW8gPSByZXNldCBhbCB2YWxvciBkZWwgQ1NTIChncmlkIHBhcmEga3BpcywgZmxleCBwYXJhIGNoaXBzKS5cbiAgY29uc3Qga3BpcyA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdjYXJ0ZXJhLWtwaXMnKTtcbiAgaWYgKGtwaXMpIGtwaXMuc3R5bGUuZGlzcGxheSA9ICcnO1xuICBjb25zdCBjaGlwcyA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdjYXJ0ZXJhLWNoaXBzJyk7XG4gIGlmIChjaGlwcykgY2hpcHMuc3R5bGUuZGlzcGxheSA9ICcnO1xufVxuXG4vLyA9PT0gRXhwb3J0IEV4Y2VsID09PVxud2luZG93LmV4cG9ydENhcnRlcmFUb0V4Y2VsID0gYXN5bmMgZnVuY3Rpb24gZXhwb3J0Q2FydGVyYVRvRXhjZWwoKSB7XG4gIGlmICghc2VsZWN0ZWRWZW5kb3IpIHtcbiAgICBhbGVydCgnRWxlZ1x1MDBFRCB1biB2ZW5kZWRvciBwcmltZXJvLicpO1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCBkb2MgPSBjYXJ0ZXJhRG9jQ2FjaGUuZ2V0KHNlbGVjdGVkVmVuZG9yKTtcbiAgaWYgKCFkb2MpIHtcbiAgICBhbGVydCgnU2luIGRhdGEgY2FyZ2FkYS4nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgY29uc3QgZmlsdGVyZWQgPSBhcHBseUNoaXBGaWx0ZXIoZG9jLmNsaWVudGVzLCBhY3RpdmVDaGlwKTtcbiAgY29uc3Qgc2VhcmNoZWQgPSBzZWFyY2hRdWVyeVxuICAgID8gZmlsdGVyZWQuZmlsdGVyKChjKSA9PlxuICAgICAgICBTdHJpbmcoYy5jbGllbnROYW1lIHx8ICcnKVxuICAgICAgICAgIC50b0xvd2VyQ2FzZSgpXG4gICAgICAgICAgLmluY2x1ZGVzKHNlYXJjaFF1ZXJ5KVxuICAgICAgKVxuICAgIDogZmlsdGVyZWQ7XG4gIGNvbnN0IHNvcnRlZCA9IHNvcnRDbGllbnRlcyhzZWFyY2hlZCwgc29ydEJ5LCBzb3J0RGlyKTtcblxuICBjb25zdCBjaGlwTGFiZWwgPSAoQ0hJUFMuZmluZCgoYykgPT4gYy5pZCA9PT0gYWN0aXZlQ2hpcCkgfHwgeyBsYWJlbDogJ1RvZG9zJyB9KS5sYWJlbDtcbiAgY29uc3QgdGl0bGUgPSBgQ2FydGVyYSBkZSAke3NlbGVjdGVkVmVuZG9yfSBcdTIwMTQgJHtjaGlwTGFiZWx9IFx1MjAxNCBTbmFwc2hvdCAke2RvYy5zbmFwc2hvdERhdGV9YDtcblxuICB0cnkge1xuICAgIGlmICh0eXBlb2Ygd2luZG93LmxvYWRFeGNlbEpTID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICBhd2FpdCB3aW5kb3cubG9hZEV4Y2VsSlMoKTtcbiAgICB9XG4gICAgY29uc3QgRXhjZWxKUyA9IHdpbmRvdy5FeGNlbEpTO1xuICAgIGlmICghRXhjZWxKUykgdGhyb3cgbmV3IEVycm9yKCdFeGNlbEpTIG5vIGRpc3BvbmlibGUnKTtcbiAgICBjb25zdCB3YiA9IG5ldyBFeGNlbEpTLldvcmtib29rKCk7XG4gICAgY29uc3Qgd3MgPSB3Yi5hZGRXb3Jrc2hlZXQoJ0NhcnRlcmEnKTtcblxuICAgIC8vIEZpbGEgMTogdGl0dWxvIGJhbmRhIHZlcmRlIFNoaW1hbm9cbiAgICB3cy5tZXJnZUNlbGxzKCdBMTpMMScpO1xuICAgIGNvbnN0IHRpdGxlQ2VsbCA9IHdzLmdldENlbGwoJ0ExJyk7XG4gICAgdGl0bGVDZWxsLnZhbHVlID0gdGl0bGU7XG4gICAgdGl0bGVDZWxsLmZpbGwgPSB7IHR5cGU6ICdwYXR0ZXJuJywgcGF0dGVybjogJ3NvbGlkJywgZmdDb2xvcjogeyBhcmdiOiAnRkYyMkM1NUUnIH0gfTtcbiAgICB0aXRsZUNlbGwuZm9udCA9IHsgYm9sZDogdHJ1ZSwgY29sb3I6IHsgYXJnYjogJ0ZGRkZGRkZGJyB9LCBzaXplOiAxNCB9O1xuICAgIHRpdGxlQ2VsbC5hbGlnbm1lbnQgPSB7IGhvcml6b250YWw6ICdjZW50ZXInLCB2ZXJ0aWNhbDogJ21pZGRsZScgfTtcbiAgICB3cy5nZXRSb3coMSkuaGVpZ2h0ID0gMzA7XG5cbiAgICAvLyBGaWxhIDI6IGhlYWRlcnNcbiAgICBjb25zdCBoZWFkZXJzID0gW1xuICAgICAgJ0NsaWVudGUnLFxuICAgICAgJ1Byb3ZpbmNpYScsXG4gICAgICAnTG9jYWxpZGFkJyxcbiAgICAgICdUaXBvJyxcbiAgICAgICdcdTAwREFsdGltYSB2aXNpdGEgcHJlc2VuY2lhbCcsXG4gICAgICAnXHUwMERBbHRpbW8gY29udGFjdG8nLFxuICAgICAgJ1x1MDBEQWx0aW1hIGNvbXByYScsXG4gICAgICAnRmFjdCAxMk0gKEFSUyknLFxuICAgICAgJ0RldWRhIGFiaWVydGEgKEFSUyknLFxuICAgICAgJ0RcdTAwRURhcyBzaW4gdmlzaXRhJyxcbiAgICAgICdEXHUwMEVEYXMgc2luIGNvbXByYScsXG4gICAgICAnQ2FyZENvZGUgU0FQJyxcbiAgICBdO1xuICAgIGNvbnN0IGhlYWRlclJvdyA9IHdzLmdldFJvdygyKTtcbiAgICBoZWFkZXJzLmZvckVhY2goKGgsIGkpID0+IHtcbiAgICAgIGNvbnN0IGNlbGwgPSBoZWFkZXJSb3cuZ2V0Q2VsbChpICsgMSk7XG4gICAgICBjZWxsLnZhbHVlID0gaDtcbiAgICAgIGNlbGwuZmlsbCA9IHsgdHlwZTogJ3BhdHRlcm4nLCBwYXR0ZXJuOiAnc29saWQnLCBmZ0NvbG9yOiB7IGFyZ2I6ICdGRjA3NEY2OScgfSB9O1xuICAgICAgY2VsbC5mb250ID0geyBib2xkOiB0cnVlLCBjb2xvcjogeyBhcmdiOiAnRkZGRkZGRkYnIH0gfTtcbiAgICAgIGNlbGwuYWxpZ25tZW50ID0geyBob3Jpem9udGFsOiAnY2VudGVyJyB9O1xuICAgIH0pO1xuXG4gICAgLy8gRmlsYXMgMys6IGRhdGFcbiAgICBzb3J0ZWQuZm9yRWFjaCgoYywgaSkgPT4ge1xuICAgICAgY29uc3Qgcm93ID0gd3MuZ2V0Um93KDMgKyBpKTtcbiAgICAgIHJvdy5nZXRDZWxsKDEpLnZhbHVlID0gYy5jbGllbnROYW1lIHx8ICcnO1xuICAgICAgcm93LmdldENlbGwoMikudmFsdWUgPSBjLnByb3ZpbmNpYSB8fCAnJztcbiAgICAgIHJvdy5nZXRDZWxsKDMpLnZhbHVlID0gYy5sb2NhbGlkYWQgfHwgJyc7XG4gICAgICByb3cuZ2V0Q2VsbCg0KS52YWx1ZSA9IGMuY2xpVGlwbyB8fCAnJztcbiAgICAgIHJvdy5nZXRDZWxsKDUpLnZhbHVlID0gYy51bHRpbWFWaXNpdGFQcmVzZW5jaWFsIHx8ICcnO1xuICAgICAgcm93LmdldENlbGwoNikudmFsdWUgPSBjLnVsdGltb0NvbnRhY3RvIHx8ICcnO1xuICAgICAgcm93LmdldENlbGwoNykudmFsdWUgPSBjLnVsdGltYUNvbXByYSB8fCAnJztcbiAgICAgIHJvdy5nZXRDZWxsKDgpLnZhbHVlID0gYy5mYWN0dXJhZG8xMk0gfHwgMDtcbiAgICAgIHJvdy5nZXRDZWxsKDgpLm51bUZtdCA9ICdcIiRcIiMsIyMwJztcbiAgICAgIHJvdy5nZXRDZWxsKDkpLnZhbHVlID0gYy5kZXVkYUFiaWVydGEgfHwgMDtcbiAgICAgIHJvdy5nZXRDZWxsKDkpLm51bUZtdCA9ICdcIiRcIiMsIyMwJztcbiAgICAgIHJvdy5nZXRDZWxsKDEwKS52YWx1ZSA9IGMuZGlhc1NpblZpc2l0YVByZXNlbmNpYWw7XG4gICAgICByb3cuZ2V0Q2VsbCgxMSkudmFsdWUgPSBjLmRpYXNTaW5Db21wcmE7XG4gICAgICByb3cuZ2V0Q2VsbCgxMikudmFsdWUgPSBjLmNhcmRDb2RlIHx8ICcnO1xuICAgIH0pO1xuXG4gICAgd3MuY29sdW1ucy5mb3JFYWNoKChjb2wsIGkpID0+IHtcbiAgICAgIGNvbC53aWR0aCA9IGkgPT09IDAgPyAzMCA6IGkgPT09IDQgfHwgaSA9PT0gNSB8fCBpID09PSA2ID8gMTggOiAxNDtcbiAgICB9KTtcblxuICAgIGNvbnN0IGJ1ZiA9IGF3YWl0IHdiLnhsc3gud3JpdGVCdWZmZXIoKTtcbiAgICBjb25zdCBibG9iID0gbmV3IEJsb2IoW2J1Zl0sIHtcbiAgICAgIHR5cGU6ICdhcHBsaWNhdGlvbi92bmQub3BlbnhtbGZvcm1hdHMtb2ZmaWNlZG9jdW1lbnQuc3ByZWFkc2hlZXRtbC5zaGVldCcsXG4gICAgfSk7XG4gICAgY29uc3QgdXJsID0gVVJMLmNyZWF0ZU9iamVjdFVSTChibG9iKTtcbiAgICBjb25zdCBhID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnYScpO1xuICAgIGEuaHJlZiA9IHVybDtcbiAgICBhLmRvd25sb2FkID0gYENhcnRlcmFfJHtTdHJpbmcoc2VsZWN0ZWRWZW5kb3IpLnJlcGxhY2UoL1xccysvZywgJ18nKX1fJHthY3RpdmVDaGlwfV8ke2RvYy5zbmFwc2hvdERhdGV9Lnhsc3hgO1xuICAgIGRvY3VtZW50LmJvZHkuYXBwZW5kQ2hpbGQoYSk7XG4gICAgYS5jbGljaygpO1xuICAgIGEucmVtb3ZlKCk7XG4gICAgVVJMLnJldm9rZU9iamVjdFVSTCh1cmwpO1xuICB9IGNhdGNoIChlKSB7XG4gICAgY29uc29sZS5lcnJvcignZXhwb3J0Q2FydGVyYVRvRXhjZWwgZmFpbGVkJywgZSk7XG4gICAgYWxlcnQoJ0Vycm9yIGV4cG9ydGFuZG86ICcgKyBTdHJpbmcoZSkpO1xuICB9XG59O1xuIl0sCiAgIm1hcHBpbmdzIjogIjs7O0FBZU8sV0FBUyxnQkFBZ0IsVUFBVSxNQUFNO0FBQzlDLFFBQUksQ0FBQyxNQUFNLFFBQVEsUUFBUSxFQUFHLFFBQU8sQ0FBQztBQUN0QyxZQUFRLE1BQU07QUFBQSxNQUNaLEtBQUs7QUFDSCxlQUFPLFNBQVM7QUFBQSxVQUNkLENBQUMsTUFBTSxFQUFFLGtCQUFrQixRQUFRLEVBQUUsa0JBQWtCLFVBQWEsRUFBRSxpQkFBaUI7QUFBQSxRQUN6RjtBQUFBLE1BQ0Ys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QUFXLEVBQUU7QUFDdEQsYUFBSyxZQUFZLEVBQUUsWUFBWSxTQUFTO0FBQUEsTUFDMUMsQ0FBQztBQUdELGFBQU8sUUFBUSxDQUFDLEdBQUcsTUFBTTtBQUN2QixjQUFNLE1BQU0sR0FBRyxPQUFPLElBQUksQ0FBQztBQUMzQixZQUFJLFFBQVEsQ0FBQyxFQUFFLFFBQVEsRUFBRSxjQUFjO0FBQ3ZDLFlBQUksUUFBUSxDQUFDLEVBQUUsUUFBUSxFQUFFLGFBQWE7QUFDdEMsWUFBSSxRQUFRLENBQUMsRUFBRSxRQUFRLEVBQUUsYUFBYTtBQUN0QyxZQUFJLFFBQVEsQ0FBQyxFQUFFLFFBQVEsRUFBRSxXQUFXO0FBQ3BDLFlBQUksUUFBUSxDQUFDLEVBQUUsUUFBUSxFQUFFLDBCQUEwQjtBQUNuRCxZQUFJLFFBQVEsQ0FBQyxFQUFFLFFBQVEsRUFBRSxrQkFBa0I7QUFDM0MsWUFBSSxRQUFRLENBQUMsRUFBRSxRQUFRLEVBQUUsZ0JBQWdCO0FBQ3pDLFlBQUksUUFBUSxDQUFDLEVBQUUsUUFBUSxFQUFFLGdCQUFnQjtBQUN6QyxZQUFJLFFBQVEsQ0FBQyxFQUFFLFNBQVM7QUFDeEIsWUFBSSxRQUFRLENBQUMsRUFBRSxRQUFRLEVBQUUsZ0JBQWdCO0FBQ3pDLFlBQUksUUFBUSxDQUFDLEVBQUUsU0FBUztBQUN4QixZQUFJLFFBQVEsRUFBRSxFQUFFLFFBQVEsRUFBRTtBQUMxQixZQUFJLFFBQVEsRUFBRSxFQUFFLFFBQVEsRUFBRTtBQUMxQixZQUFJLFFBQVEsRUFBRSxFQUFFLFFBQVEsRUFBRSxZQUFZO0FBQUEsTUFDeEMsQ0FBQztBQUVELFNBQUcsUUFBUSxRQUFRLENBQUMsS0FBSyxNQUFNO0FBQzdCLFlBQUksUUFBUSxNQUFNLElBQUksS0FBSyxNQUFNLEtBQUssTUFBTSxLQUFLLE1BQU0sSUFBSSxLQUFLO0FBQUEsTUFDbEUsQ0FBQztBQUVELFlBQU0sTUFBTSxNQUFNLEdBQUcsS0FBSyxZQUFZO0FBQ3RDLFlBQU0sT0FBTyxJQUFJLEtBQUssQ0FBQyxHQUFHLEdBQUc7QUFBQSxRQUMzQixNQUFNO0FBQUEsTUFDUixDQUFDO0FBQ0QsWUFBTSxNQUFNLElBQUksZ0JBQWdCLElBQUk7QUFDcEMsWUFBTSxJQUFJLFNBQVMsY0FBYyxHQUFHO0FBQ3BDLFFBQUUsT0FBTztBQUNULFFBQUUsV0FBVyxXQUFXLE9BQU8sY0FBYyxFQUFFLFFBQVEsUUFBUSxHQUFHLENBQUMsSUFBSSxVQUFVLElBQUksSUFBSSxZQUFZO0FBQ3JHLGVBQVMsS0FBSyxZQUFZLENBQUM7QUFDM0IsUUFBRSxNQUFNO0FBQ1IsUUFBRSxPQUFPO0FBQ1QsVUFBSSxnQkFBZ0IsR0FBRztBQUFBLElBQ3pCLFNBQVMsR0FBRztBQUNWLGNBQVEsTUFBTSwrQkFBK0IsQ0FBQztBQUM5QyxZQUFNLHVCQUF1QixPQUFPLENBQUMsQ0FBQztBQUFBLElBQ3hDO0FBQUEsRUFDRjsiLAogICJuYW1lcyI6IFsic29ydEJ5IiwgInNvcnREaXIiXQp9Cg==
