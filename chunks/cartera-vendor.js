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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL3B1cmUvY2FydGVyYS12ZW5kb3ItZmlsdGVyLmpzIiwgIi4uL3NyYy9kb21haW5zL2NhcnRlcmEtdmVuZG9yLmpzIl0sCiAgInNvdXJjZXNDb250ZW50IjogWyIvLyBAdHMtY2hlY2tcbi8qKlxuICogY2FydGVyYS12ZW5kb3ItZmlsdGVyLmpzICh2MTI4MywgMjAyNi0xMC0yMClcbiAqXG4gKiBQdXJhcyBwYXJhIGZpbHRyYXIgeSBvcmRlbmFyIGxhIHRhYmxhIGRlbCBkYXNoYm9hcmQgXCJBbmFsaXNpcyBkZSBDYXJ0ZXJhXCIuXG4gKiBJbXBvcnRhZG8gcG9yIHNyYy9kb21haW5zL2NhcnRlcmEtdmVuZG9yLmpzIChidW5kbGUgZnJvbnRlbmQpLlxuICogVGVzdGVhZG8gZW4gdGVzdHMvdW5pdC9jYXJ0ZXJhLXZlbmRvci1maWx0ZXIudGVzdC5qcy5cbiAqL1xuXG4vKipcbiAqIEFwbGljYSB1biBjaGlwIGRlIGZpbHRybyBhbCBhcnJheSBkZSBjbGllbnRlcy5cbiAqIEBwYXJhbSB7QXJyYXk8YW55Pn0gY2xpZW50ZXNcbiAqIEBwYXJhbSB7c3RyaW5nfSBjaGlwXG4gKiBAcmV0dXJucyB7QXJyYXk8YW55Pn1cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGFwcGx5Q2hpcEZpbHRlcihjbGllbnRlcywgY2hpcCkge1xuICBpZiAoIUFycmF5LmlzQXJyYXkoY2xpZW50ZXMpKSByZXR1cm4gW107XG4gIHN3aXRjaCAoY2hpcCkge1xuICAgIGNhc2UgJ2Jhc2VBY3RpdmE5MGQnOlxuICAgICAgcmV0dXJuIGNsaWVudGVzLmZpbHRlcihcbiAgICAgICAgKGMpID0+IGMuZGlhc1NpbkNvbXByYSAhPT0gbnVsbCAmJiBjLmRpYXNTaW5Db21wcmEgIT09IHVuZGVmaW5lZCAmJiBjLmRpYXNTaW5Db21wcmEgPD0gOTBcbiAgICAgICk7XG4gICAgY2FzZSAnZG9ybWlkb3NWaXNpdGEzMGQnOlxuICAgICAgcmV0dXJuIGNsaWVudGVzLmZpbHRlcihcbiAgICAgICAgKGMpID0+XG4gICAgICAgICAgYy5kaWFzU2luVmlzaXRhUHJlc2VuY2lhbCAhPT0gbnVsbCAmJlxuICAgICAgICAgIGMuZGlhc1NpblZpc2l0YVByZXNlbmNpYWwgIT09IHVuZGVmaW5lZCAmJlxuICAgICAgICAgIGMuZGlhc1NpblZpc2l0YVByZXNlbmNpYWwgPiAzMFxuICAgICAgKTtcbiAgICBjYXNlICdkb3JtaWRvc0NvbXByYTkwZCc6XG4gICAgICByZXR1cm4gY2xpZW50ZXMuZmlsdGVyKFxuICAgICAgICAoYykgPT4gYy5kaWFzU2luQ29tcHJhICE9PSBudWxsICYmIGMuZGlhc1NpbkNvbXByYSAhPT0gdW5kZWZpbmVkICYmIGMuZGlhc1NpbkNvbXByYSA+IDkwXG4gICAgICApO1xuICAgIGNhc2UgJ251bmNhVmlzaXRhZG9zJzpcbiAgICAgIHJldHVybiBjbGllbnRlcy5maWx0ZXIoXG4gICAgICAgIChjKSA9PiBjLnVsdGltYVZpc2l0YVByZXNlbmNpYWwgPT09IG51bGwgfHwgYy51bHRpbWFWaXNpdGFQcmVzZW5jaWFsID09PSB1bmRlZmluZWRcbiAgICAgICk7XG4gICAgY2FzZSAnbnVuY2FDb21wcmFyb24nOlxuICAgICAgcmV0dXJuIGNsaWVudGVzLmZpbHRlcigoYykgPT4gYy51bHRpbWFDb21wcmEgPT09IG51bGwgfHwgYy51bHRpbWFDb21wcmEgPT09IHVuZGVmaW5lZCk7XG4gICAgZGVmYXVsdDpcbiAgICAgIHJldHVybiBjbGllbnRlcy5zbGljZSgpO1xuICB9XG59XG5cbi8qKlxuICogT3JkZW5hIHVuYSBjb3BpYSBkZWwgYXJyYXkgcG9yIGNvbHVtbmEuIE51bGxzIHNpZW1wcmUgYWwgZmluYWwuXG4gKiBAcGFyYW0ge0FycmF5PGFueT59IGNsaWVudGVzXG4gKiBAcGFyYW0ge3N0cmluZ30gc29ydEJ5XG4gKiBAcGFyYW0geydhc2MnfCdkZXNjJ30gc29ydERpclxuICogQHJldHVybnMge0FycmF5PGFueT59XG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzb3J0Q2xpZW50ZXMoY2xpZW50ZXMsIHNvcnRCeSwgc29ydERpcikge1xuICBpZiAoIUFycmF5LmlzQXJyYXkoY2xpZW50ZXMpKSByZXR1cm4gW107XG4gIGNvbnN0IGRpciA9IHNvcnREaXIgPT09ICdhc2MnID8gMSA6IC0xO1xuICBjb25zdCBjb3B5ID0gY2xpZW50ZXMuc2xpY2UoKTtcbiAgY29weS5zb3J0KChhLCBiKSA9PiB7XG4gICAgY29uc3QgYXYgPSBhW3NvcnRCeV07XG4gICAgY29uc3QgYnYgPSBiW3NvcnRCeV07XG4gICAgY29uc3QgYU51bGwgPSBhdiA9PT0gbnVsbCB8fCBhdiA9PT0gdW5kZWZpbmVkO1xuICAgIGNvbnN0IGJOdWxsID0gYnYgPT09IG51bGwgfHwgYnYgPT09IHVuZGVmaW5lZDtcbiAgICBpZiAoYU51bGwgJiYgYk51bGwpIHJldHVybiAwO1xuICAgIGlmIChhTnVsbCkgcmV0dXJuIDE7XG4gICAgaWYgKGJOdWxsKSByZXR1cm4gLTE7XG4gICAgaWYgKHR5cGVvZiBhdiA9PT0gJ251bWJlcicgJiYgdHlwZW9mIGJ2ID09PSAnbnVtYmVyJykgcmV0dXJuIChhdiAtIGJ2KSAqIGRpcjtcbiAgICByZXR1cm4gU3RyaW5nKGF2KS5sb2NhbGVDb21wYXJlKFN0cmluZyhidikpICogZGlyO1xuICB9KTtcbiAgcmV0dXJuIGNvcHk7XG59XG4iLCAiLy8gQHRzLW5vY2hlY2tcclxuLy8gTk9UQTogQHRzLW5vY2hlY2sgaW50ZW5jaW9uYWwuIEVsIGNodW5rIGVzIGhlYXZ5IERPTSArIHdpbmRvdy4qIGhhbmRsZXJzICtcclxuLy8gRmlyZXN0b3JlIFNESyBjb21wYXQgdjguIEFub3RhciBzdHJpY3RhbWVudGUgY2FkYSBoYW5kbGVyIHNlclx1MDBFRGEgcnVpZG8gc2luXHJcbi8vIHZhbG9yIFx1MjAxNCBsb3MgaGVscGVycyBwdXJvcyBxdWUgaW1wb3J0YW1vcyAoLi4vcHVyZS9jYXJ0ZXJhLXZlbmRvci1maWx0ZXIuanMpXHJcbi8vIHkgZWwgY29yZSAoZnVuY3Rpb25zL2NvcmUvY2FydGVyYS12ZW5kb3ItY29yZS5qcykgc1x1MDBFRCB0aWVuZW4gQHRzLWNoZWNrLlxyXG4vKipcclxuICogY2FydGVyYS12ZW5kb3IuanMgKHYxMjgzLCAyMDI2LTEwLTIwKSBcdTIwMTQgYnVuZGxlIGNodW5rIGxhenkuXHJcbiAqXHJcbiAqIERhc2hib2FyZCBcIkFuYWxpc2lzIGRlIENhcnRlcmEgcG9yIFZlbmRlZG9yXCIuIFJlZW1wbGF6YSBzZWd1aW1pZW50by5qcy5cclxuICogTGVlIGNhcnRlcmFfdmVuZG9yL3t2ZW5kb3JLZXl9IEZpcmVzdG9yZSAoc25hcHNob3QgbmlnaHRseSAwNDowMCBBUlQpLlxyXG4gKlxyXG4gKiBUT0RPIGVsIERPTSByZW5kZXIgdXNhIGNyZWF0ZUVsZW1lbnQgKyB0ZXh0Q29udGVudCAocG9saWN5IGFudGktWFNTLCBubyBpbm5lckhUTUwpLlxyXG4gKlxyXG4gKiBTcGVjOiBkb2NzL3N1cGVycG93ZXJzL3NwZWNzLzIwMjYtMTAtMjAtY2FydGVyYS12ZW5kb3ItYW5hbGlzaXMtZGVzaWduLm1kXHJcbiAqIFBsYW46IGRvY3Mvc3VwZXJwb3dlcnMvcGxhbnMvMjAyNi0xMC0yMC1jYXJ0ZXJhLXZlbmRvci1hbmFsaXNpcy5tZFxyXG4gKi9cclxuXHJcbmltcG9ydCB7IGFwcGx5Q2hpcEZpbHRlciwgc29ydENsaWVudGVzIH0gZnJvbSAnLi4vcHVyZS9jYXJ0ZXJhLXZlbmRvci1maWx0ZXIuanMnO1xyXG5cclxuLyoqIEB0eXBlIHtNYXA8c3RyaW5nLCBhbnk+fSAqL1xyXG5jb25zdCBjYXJ0ZXJhRG9jQ2FjaGUgPSBuZXcgTWFwKCk7XHJcbi8qKiBAdHlwZSB7c3RyaW5nfG51bGx9ICovXHJcbmxldCBzZWxlY3RlZFZlbmRvciA9IG51bGw7XHJcbmxldCBhY3RpdmVDaGlwID0gJ3RvZG9zJztcclxubGV0IHNlYXJjaFF1ZXJ5ID0gJyc7XHJcbmxldCBzb3J0QnkgPSAnZGlhc1NpbkNvbXByYSc7XHJcbi8qKiBAdHlwZSB7J2FzYyd8J2Rlc2MnfSAqL1xyXG5sZXQgc29ydERpciA9ICdkZXNjJztcclxuXHJcbmNvbnN0IENISVBTID0gW1xyXG4gIHsgaWQ6ICd0b2RvcycsIGxhYmVsOiAnVG9kb3MnIH0sXHJcbiAgeyBpZDogJ2Jhc2VBY3RpdmE5MGQnLCBsYWJlbDogJ0Jhc2UgYWN0aXZhIDkwZCcgfSxcclxuICB7IGlkOiAnZG9ybWlkb3NWaXNpdGEzMGQnLCBsYWJlbDogJ0Rvcm1pZG9zIHZpc2l0YSAzMGQnIH0sXHJcbiAgeyBpZDogJ2Rvcm1pZG9zQ29tcHJhOTBkJywgbGFiZWw6ICdEb3JtaWRvcyBjb21wcmEgOTBkJyB9LFxyXG4gIHsgaWQ6ICdudW5jYVZpc2l0YWRvcycsIGxhYmVsOiAnTnVuY2EgdmlzaXRhZG9zJyB9LFxyXG4gIHsgaWQ6ICdudW5jYUNvbXByYXJvbicsIGxhYmVsOiAnTnVuY2EgY29tcHJhcm9uJyB9LFxyXG5dO1xyXG5cclxuY29uc3QgS1BJX0NBUkRTID0gW1xyXG4gIHsgY2hpcDogJ3RvZG9zJywgbGFiZWw6ICdUb3RhbCBjYXJ0ZXJhJywgY29sb3I6ICcjNjQ3NDhiJyB9LFxyXG4gIHsgY2hpcDogJ2Jhc2VBY3RpdmE5MGQnLCBsYWJlbDogJ0Jhc2UgYWN0aXZhIDkwZCcsIGNvbG9yOiAnIzE2YTM0YScgfSxcclxuICB7IGNoaXA6ICdkb3JtaWRvc1Zpc2l0YTMwZCcsIGxhYmVsOiAnRG9ybWlkb3MgdmlzIDMwZCcsIGNvbG9yOiAnI2VhNTgwYycgfSxcclxuICB7IGNoaXA6ICdkb3JtaWRvc0NvbXByYTkwZCcsIGxhYmVsOiAnRG9ybWlkb3MgY29tIDkwZCcsIGNvbG9yOiAnI2RjMjYyNicgfSxcclxuICB7IGNoaXA6ICdudW5jYVZpc2l0YWRvcycsIGxhYmVsOiAnTnVuY2EgdmlzaXRhZG9zJywgY29sb3I6ICcjN2MzYWVkJyB9LFxyXG4gIHsgY2hpcDogJ251bmNhQ29tcHJhcm9uJywgbGFiZWw6ICdOdW5jYSBjb21wcmFyb24nLCBjb2xvcjogJyNiZTE4NWQnIH0sXHJcbl07XHJcblxyXG4vLyB2MTM4NCAoMjAyNi0xMC0yMSk6IHdoaXRlbGlzdCBkZSBsb3MgNiBWREUgcmVhbGVzIG9wZXJhdGl2b3MgKHBlZGlkbyBNYXJpYW5vKS5cclxuLy8gRmlsdHJhIGVsIGRyb3Bkb3duIHBhcmEgZXhjbHVpciBydWlkbyBlbiBjbGllbnRfYXBwbGljYXRpb25zLmFzc2lnbmVkVmVuZG9yOlxyXG4vLyAnQURNSU5fTERPT0cyRjRNV1ZNWEtRT0Q4WUNCT0lSVTJPMicgKGFkbWluIHVpZCBxdWUgcXVlZG8gY29tbyBzdHJpbmcgdmVuZG9yKSxcclxuLy8gJ0VNUExFQURPJyAoYWx0YXMgaW50ZXJuYXMpLCAnRElFR08gVkFMU0knIChleC1WREUgY29uIDEgY2xpZW50ZSBoaXN0b3JpY28pLlxyXG4vLyBTaSBlbiBlbCBmdXR1cm8gc2UgaW5jb3Jwb3JhIHVuIG51ZXZvIFZERSwgYWdyZWdhcmxvIGFxdWkgKyB2ZXJpZmljYXIgcXVlIGxhXHJcbi8vIHZpc3RhIEJRIHZfY2FydGVyYV92ZW5kb3IgbG8gY2Fub25pY2FsaXplIGlndWFsICh2ZXIgYmlncXVlcnkvdmlld3Muc3FsOjM0ODApLlxyXG5jb25zdCBWRU5ET1JTX1dISVRFTElTVCA9IG5ldyBTZXQoW1xyXG4gICdGRURFUklDTyBDQVNURUxBTkVMTEknLFxyXG4gICdHT05aQUxPIERFIExBIFJPU0EnLFxyXG4gICdJT0FOTklTIFBBTEtPVURBS0lTJyxcclxuICAnTUFVUklDSU8gR0lMJyxcclxuICAnUEFDSEknLFxyXG4gICdTQU5USUFHTyBFU1RFQkFOJyxcclxuXSk7XHJcblxyXG4vLyA9PT0gT3BlbiAvIGNsb3NlID09PVxyXG53aW5kb3cub3BlbkNhcnRlcmFNb2RhbCA9IGFzeW5jIGZ1bmN0aW9uIG9wZW5DYXJ0ZXJhTW9kYWwoKSB7XHJcbiAgY29uc3QgbW9kYWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY2FydGVyYS1tb2RhbCcpO1xyXG4gIGlmICghbW9kYWwpIHJldHVybjtcclxuICBtb2RhbC5jbGFzc0xpc3QuYWRkKCdvcGVuJyk7XHJcbiAgYXdhaXQgcG9wdWxhdGVWZW5kb3JEcm9wZG93bigpO1xyXG59O1xyXG5cclxud2luZG93LmNsb3NlQ2FydGVyYU1vZGFsID0gZnVuY3Rpb24gY2xvc2VDYXJ0ZXJhTW9kYWwoKSB7XHJcbiAgY29uc3QgbW9kYWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY2FydGVyYS1tb2RhbCcpO1xyXG4gIGlmIChtb2RhbCkgbW9kYWwuY2xhc3NMaXN0LnJlbW92ZSgnb3BlbicpO1xyXG59O1xyXG5cclxuLy8gPT09IERyb3Bkb3duIGRlIHZlbmRvcnMgPT09XHJcbmFzeW5jIGZ1bmN0aW9uIHBvcHVsYXRlVmVuZG9yRHJvcGRvd24oKSB7XHJcbiAgY29uc3Qgc2VsID0gLyoqIEB0eXBlIHtIVE1MU2VsZWN0RWxlbWVudHxudWxsfSAqLyAoXHJcbiAgICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY2FydGVyYS12ZW5kb3Itc2VsZWN0JylcclxuICApO1xyXG4gIGlmICghc2VsKSByZXR1cm47XHJcbiAgaWYgKHNlbC5vcHRpb25zLmxlbmd0aCA+IDEpIHJldHVybjtcclxuICB0cnkge1xyXG4gICAgLy8gQHRzLWV4cGVjdC1lcnJvclxyXG4gICAgY29uc3Qgc25hcCA9IGF3YWl0IGZpcmViYXNlLmZpcmVzdG9yZSgpLmNvbGxlY3Rpb24oJ2NhcnRlcmFfdmVuZG9yJykuZ2V0KCk7XHJcbiAgICAvKiogQHR5cGUge3N0cmluZ1tdfSAqL1xyXG4gICAgY29uc3QgdmVuZG9ycyA9IFtdO1xyXG4gICAgc25hcC5mb3JFYWNoKChkb2MpID0+IHtcclxuICAgICAgLy8gdjEzODQ6IHNvbG8gVkRFIHdoaXRlbGlzdC4gUmVzdG8gKGFkbWluIHVpZCwgRU1QTEVBRE8sIGV4LVZERSkgc2Ugb2N1bHRhbi5cclxuICAgICAgaWYgKFZFTkRPUlNfV0hJVEVMSVNULmhhcyhkb2MuaWQpKSB2ZW5kb3JzLnB1c2goZG9jLmlkKTtcclxuICAgIH0pO1xyXG4gICAgdmVuZG9ycy5zb3J0KCk7XHJcbiAgICBmb3IgKGNvbnN0IHYgb2YgdmVuZG9ycykge1xyXG4gICAgICBjb25zdCBvcHQgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdvcHRpb24nKTtcclxuICAgICAgb3B0LnZhbHVlID0gdjtcclxuICAgICAgb3B0LnRleHRDb250ZW50ID0gdjtcclxuICAgICAgc2VsLmFwcGVuZENoaWxkKG9wdCk7XHJcbiAgICB9XHJcbiAgfSBjYXRjaCAoZSkge1xyXG4gICAgY29uc29sZS5lcnJvcigncG9wdWxhdGVWZW5kb3JEcm9wZG93biBmYWlsZWQnLCBlKTtcclxuICB9XHJcbn1cclxuXHJcbi8vID09PSBPbiB2ZW5kb3IgY2hhbmdlID09PVxyXG53aW5kb3cub25DYXJ0ZXJhVmVuZG9yQ2hhbmdlID0gYXN5bmMgZnVuY3Rpb24gb25DYXJ0ZXJhVmVuZG9yQ2hhbmdlKCkge1xyXG4gIGNvbnN0IHNlbCA9IC8qKiBAdHlwZSB7SFRNTFNlbGVjdEVsZW1lbnR8bnVsbH0gKi8gKFxyXG4gICAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2NhcnRlcmEtdmVuZG9yLXNlbGVjdCcpXHJcbiAgKTtcclxuICBpZiAoIXNlbCkgcmV0dXJuO1xyXG4gIHNlbGVjdGVkVmVuZG9yID0gc2VsLnZhbHVlIHx8IG51bGw7XHJcbiAgYWN0aXZlQ2hpcCA9ICd0b2Rvcyc7XHJcbiAgc2VhcmNoUXVlcnkgPSAnJztcclxuICBjb25zdCBzZWFyY2hJbnB1dCA9IC8qKiBAdHlwZSB7SFRNTElucHV0RWxlbWVudHxudWxsfSAqLyAoXHJcbiAgICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY2FydGVyYS1zZWFyY2gnKVxyXG4gICk7XHJcbiAgaWYgKHNlYXJjaElucHV0KSBzZWFyY2hJbnB1dC52YWx1ZSA9ICcnO1xyXG4gIGlmICghc2VsZWN0ZWRWZW5kb3IpIHtcclxuICAgIHNob3dFbXB0eSgpO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuICBzaG93TG9hZGluZygpO1xyXG4gIHRyeSB7XHJcbiAgICBsZXQgZG9jID0gY2FydGVyYURvY0NhY2hlLmdldChzZWxlY3RlZFZlbmRvcik7XHJcbiAgICBpZiAoIWRvYykge1xyXG4gICAgICAvLyBAdHMtZXhwZWN0LWVycm9yXHJcbiAgICAgIGNvbnN0IHNuYXAgPSBhd2FpdCBmaXJlYmFzZVxyXG4gICAgICAgIC5maXJlc3RvcmUoKVxyXG4gICAgICAgIC5jb2xsZWN0aW9uKCdjYXJ0ZXJhX3ZlbmRvcicpXHJcbiAgICAgICAgLmRvYyhzZWxlY3RlZFZlbmRvcilcclxuICAgICAgICAuZ2V0KCk7XHJcbiAgICAgIGlmICghc25hcC5leGlzdHMpIHtcclxuICAgICAgICBzaG93Tm9EYXRhKCk7XHJcbiAgICAgICAgcmV0dXJuO1xyXG4gICAgICB9XHJcbiAgICAgIGRvYyA9IHNuYXAuZGF0YSgpO1xyXG4gICAgICBjYXJ0ZXJhRG9jQ2FjaGUuc2V0KHNlbGVjdGVkVmVuZG9yLCBkb2MpO1xyXG4gICAgfVxyXG4gICAgcmVuZGVyRGFzaGJvYXJkKGRvYyk7XHJcbiAgfSBjYXRjaCAoZSkge1xyXG4gICAgY29uc29sZS5lcnJvcignb25DYXJ0ZXJhVmVuZG9yQ2hhbmdlIGZhaWxlZCcsIGUpO1xyXG4gICAgc2hvd0Vycm9yKFN0cmluZyhlKSk7XHJcbiAgfVxyXG59O1xyXG5cclxuLyoqIEB0eXBlIHthbnl9ICovICh3aW5kb3cpLm9uQ2FydGVyYUNoaXBDbGljayA9IGZ1bmN0aW9uIG9uQ2FydGVyYUNoaXBDbGljayhjaGlwSWQpIHtcclxuICBhY3RpdmVDaGlwID0gY2hpcElkO1xyXG4gIGlmICghc2VsZWN0ZWRWZW5kb3IpIHJldHVybjtcclxuICBjb25zdCBkb2MgPSBjYXJ0ZXJhRG9jQ2FjaGUuZ2V0KHNlbGVjdGVkVmVuZG9yKTtcclxuICBpZiAoZG9jKSByZW5kZXJEYXNoYm9hcmQoZG9jKTtcclxufTtcclxuXHJcbi8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2Ygc2V0VGltZW91dD58bnVsbH0gKi9cclxubGV0IHNlYXJjaERlYm91bmNlVGltZXIgPSBudWxsO1xyXG53aW5kb3cub25DYXJ0ZXJhU2VhcmNoQ2hhbmdlID0gZnVuY3Rpb24gb25DYXJ0ZXJhU2VhcmNoQ2hhbmdlKCkge1xyXG4gIGNvbnN0IGlucHV0ID0gLyoqIEB0eXBlIHtIVE1MSW5wdXRFbGVtZW50fG51bGx9ICovIChkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY2FydGVyYS1zZWFyY2gnKSk7XHJcbiAgaWYgKCFpbnB1dCkgcmV0dXJuO1xyXG4gIGlmIChzZWFyY2hEZWJvdW5jZVRpbWVyKSBjbGVhclRpbWVvdXQoc2VhcmNoRGVib3VuY2VUaW1lcik7XHJcbiAgc2VhcmNoRGVib3VuY2VUaW1lciA9IHNldFRpbWVvdXQoKCkgPT4ge1xyXG4gICAgc2VhcmNoUXVlcnkgPSAoaW5wdXQudmFsdWUgfHwgJycpLnRyaW0oKS50b0xvd2VyQ2FzZSgpO1xyXG4gICAgaWYgKCFzZWxlY3RlZFZlbmRvcikgcmV0dXJuO1xyXG4gICAgY29uc3QgZG9jID0gY2FydGVyYURvY0NhY2hlLmdldChzZWxlY3RlZFZlbmRvcik7XHJcbiAgICBpZiAoZG9jKSByZW5kZXJEYXNoYm9hcmQoZG9jKTtcclxuICB9LCAzMDApO1xyXG59O1xyXG5cclxuLyoqIEB0eXBlIHthbnl9ICovICh3aW5kb3cpLm9uQ2FydGVyYVNvcnRDbGljayA9IGZ1bmN0aW9uIG9uQ2FydGVyYVNvcnRDbGljayhjb2xLZXkpIHtcclxuICBpZiAoc29ydEJ5ID09PSBjb2xLZXkpIHNvcnREaXIgPSBzb3J0RGlyID09PSAnYXNjJyA/ICdkZXNjJyA6ICdhc2MnO1xyXG4gIGVsc2Uge1xyXG4gICAgc29ydEJ5ID0gY29sS2V5O1xyXG4gICAgc29ydERpciA9ICdkZXNjJztcclxuICB9XHJcbiAgaWYgKCFzZWxlY3RlZFZlbmRvcikgcmV0dXJuO1xyXG4gIGNvbnN0IGRvYyA9IGNhcnRlcmFEb2NDYWNoZS5nZXQoc2VsZWN0ZWRWZW5kb3IpO1xyXG4gIGlmIChkb2MpIHJlbmRlckRhc2hib2FyZChkb2MpO1xyXG59O1xyXG5cclxuLy8gPT09IFJlbmRlciA9PT1cclxuZnVuY3Rpb24gcmVuZGVyRGFzaGJvYXJkKGRvYykge1xyXG4gIGNvbnN0IHN1YnRpdGxlID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2NhcnRlcmEtc3VidGl0bGUnKTtcclxuICBpZiAoc3VidGl0bGUpIHN1YnRpdGxlLnRleHRDb250ZW50ID0gYCR7ZG9jLmNvdW50cy50b3RhbH0gY2xpZW50ZXMgZW4gY2FydGVyYS5gO1xyXG4gIGNvbnN0IGluZm8gPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY2FydGVyYS1zbmFwc2hvdC1pbmZvJyk7XHJcbiAgaWYgKGluZm8pIHtcclxuICAgIGluZm8udGV4dENvbnRlbnQgPSBgU25hcHNob3QgJHtkb2Muc25hcHNob3REYXRlfWA7XHJcbiAgICBpbmZvLnN0eWxlLmRpc3BsYXkgPSAnaW5saW5lLWZsZXgnO1xyXG4gIH1cclxuICByZW5kZXJLcGlzKGRvYy5jb3VudHMpO1xyXG4gIHJlbmRlckNoaXBzKGRvYy5jb3VudHMpO1xyXG4gIHJlbmRlclRhYmxlKGRvYy5jbGllbnRlcyk7XHJcbiAgc2hvd1RhYmxlKCk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIHJlbmRlcktwaXMoY291bnRzKSB7XHJcbiAgY29uc3QgZWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY2FydGVyYS1rcGlzJyk7XHJcbiAgaWYgKCFlbCkgcmV0dXJuO1xyXG4gIHdoaWxlIChlbC5maXJzdENoaWxkKSBlbC5yZW1vdmVDaGlsZChlbC5maXJzdENoaWxkKTtcclxuICAvLyB2MTM4MzogQXBwbGUtc3R5bGUgS1BJIGNhcmRzLiBDbGFzZXMgLmNhcnRlcmEta3BpIGRlZmluaWRhcyBlbiBpbmRleC5odG1sLlxyXG4gIC8vIENvbG9yIHNlIGFwbGljYSBzb2xvIGFsIG5cdTAwRkFtZXJvICsgdW5kZXJsaW5lIChzdXRpbCBpZGVudGlkYWQgcG9yIGNhdGVnb3JcdTAwRURhKS5cclxuICBmb3IgKGNvbnN0IHNwZWMgb2YgS1BJX0NBUkRTKSB7XHJcbiAgICBjb25zdCBjYXJkID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2Jyk7XHJcbiAgICBjYXJkLmNsYXNzTmFtZSA9ICdjYXJ0ZXJhLWtwaSc7XHJcbiAgICBpZiAoYWN0aXZlQ2hpcCA9PT0gc3BlYy5jaGlwKSBjYXJkLmNsYXNzTGlzdC5hZGQoJ2FjdGl2ZScpO1xyXG4gICAgY2FyZC5zdHlsZS5jb2xvciA9IHNwZWMuY29sb3I7IC8vIGN1cnJlbnRDb2xvciBwYXJhIGVsIG51bWJlciArIDo6YWZ0ZXIgdW5kZXJsaW5lXHJcbiAgICBjYXJkLmFkZEV2ZW50TGlzdGVuZXIoJ2NsaWNrJywgKCkgPT4gLyoqIEB0eXBlIHthbnl9ICovICh3aW5kb3cpLm9uQ2FydGVyYUNoaXBDbGljayhzcGVjLmNoaXApKTtcclxuICAgIGNvbnN0IG4gPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKTtcclxuICAgIG4uY2xhc3NOYW1lID0gJ2NhcnRlcmEta3BpLW51bSc7XHJcbiAgICBuLnRleHRDb250ZW50ID0gU3RyaW5nKGNvdW50c1tzcGVjLmNoaXAgPT09ICd0b2RvcycgPyAndG90YWwnIDogc3BlYy5jaGlwXSk7XHJcbiAgICBjb25zdCBsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2Jyk7XHJcbiAgICBsLmNsYXNzTmFtZSA9ICdjYXJ0ZXJhLWtwaS1sYWJlbCc7XHJcbiAgICBsLnN0eWxlLmNvbG9yID0gJyc7IC8vIHJlc2V0IGN1cnJlbnRDb2xvciBwYXJhIHF1ZSB1c2UgZWwgbXV0ZWQgZGVsIENTU1xyXG4gICAgbC50ZXh0Q29udGVudCA9IHNwZWMubGFiZWw7XHJcbiAgICBjYXJkLmFwcGVuZENoaWxkKG4pO1xyXG4gICAgY2FyZC5hcHBlbmRDaGlsZChsKTtcclxuICAgIGVsLmFwcGVuZENoaWxkKGNhcmQpO1xyXG4gIH1cclxufVxyXG5cclxuZnVuY3Rpb24gcmVuZGVyQ2hpcHMoY291bnRzKSB7XHJcbiAgY29uc3QgZWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY2FydGVyYS1jaGlwcycpO1xyXG4gIGlmICghZWwpIHJldHVybjtcclxuICBjb25zdCBjb3VudEJ5Q2hpcCA9IHtcclxuICAgIHRvZG9zOiBjb3VudHMudG90YWwsXHJcbiAgICBiYXNlQWN0aXZhOTBkOiBjb3VudHMuYmFzZUFjdGl2YTkwZCxcclxuICAgIGRvcm1pZG9zVmlzaXRhMzBkOiBjb3VudHMuZG9ybWlkb3NWaXNpdGEzMGQsXHJcbiAgICBkb3JtaWRvc0NvbXByYTkwZDogY291bnRzLmRvcm1pZG9zQ29tcHJhOTBkLFxyXG4gICAgbnVuY2FWaXNpdGFkb3M6IGNvdW50cy5udW5jYVZpc2l0YWRvcyxcclxuICAgIG51bmNhQ29tcHJhcm9uOiBjb3VudHMubnVuY2FDb21wcmFyb24sXHJcbiAgfTtcclxuICB3aGlsZSAoZWwuZmlyc3RDaGlsZCkgZWwucmVtb3ZlQ2hpbGQoZWwuZmlyc3RDaGlsZCk7XHJcbiAgLy8gdjEzODM6IHNlZ21lbnRlZCBjb250cm9sIGlPUy4gV3JhcHBlciAuY2FydGVyYS1jaGlwLXdyYXAgYWdydXBhIHBpbGxzIGNvbiBiZyBncmlzLlxyXG4gIGNvbnN0IHdyYXAgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKTtcclxuICB3cmFwLmNsYXNzTmFtZSA9ICdjYXJ0ZXJhLWNoaXAtd3JhcCc7XHJcbiAgZm9yIChjb25zdCBjaGlwIG9mIENISVBTKSB7XHJcbiAgICBjb25zdCBiID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnYnV0dG9uJyk7XHJcbiAgICBiLmNsYXNzTmFtZSA9ICdjYXJ0ZXJhLWNoaXAnO1xyXG4gICAgaWYgKGFjdGl2ZUNoaXAgPT09IGNoaXAuaWQpIGIuY2xhc3NMaXN0LmFkZCgnYWN0aXZlJyk7XHJcbiAgICBiLnR5cGUgPSAnYnV0dG9uJztcclxuICAgIGIudGV4dENvbnRlbnQgPSBgJHtjaGlwLmxhYmVsfSAoJHtjb3VudEJ5Q2hpcFtjaGlwLmlkXX0pYDtcclxuICAgIGIuYWRkRXZlbnRMaXN0ZW5lcignY2xpY2snLCAoKSA9PiAvKiogQHR5cGUge2FueX0gKi8gKHdpbmRvdykub25DYXJ0ZXJhQ2hpcENsaWNrKGNoaXAuaWQpKTtcclxuICAgIHdyYXAuYXBwZW5kQ2hpbGQoYik7XHJcbiAgfVxyXG4gIGVsLmFwcGVuZENoaWxkKHdyYXApO1xyXG59XHJcblxyXG4vKiogQHBhcmFtIHtBcnJheTxhbnk+fSBjbGllbnRlcyAqL1xyXG5mdW5jdGlvbiByZW5kZXJUYWJsZShjbGllbnRlcykge1xyXG4gIGNvbnN0IHRhYmxlID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2NhcnRlcmEtdGFibGUnKTtcclxuICBpZiAoIXRhYmxlKSByZXR1cm47XHJcbiAgY29uc3QgZmlsdGVyZWQgPSBhcHBseUNoaXBGaWx0ZXIoY2xpZW50ZXMsIGFjdGl2ZUNoaXApO1xyXG4gIGNvbnN0IHNlYXJjaGVkID0gc2VhcmNoUXVlcnlcclxuICAgID8gZmlsdGVyZWQuZmlsdGVyKChjKSA9PlxyXG4gICAgICAgIFN0cmluZyhjLmNsaWVudE5hbWUgfHwgJycpXHJcbiAgICAgICAgICAudG9Mb3dlckNhc2UoKVxyXG4gICAgICAgICAgLmluY2x1ZGVzKHNlYXJjaFF1ZXJ5KVxyXG4gICAgICApXHJcbiAgICA6IGZpbHRlcmVkO1xyXG4gIGNvbnN0IHNvcnRlZCA9IHNvcnRDbGllbnRlcyhzZWFyY2hlZCwgc29ydEJ5LCBzb3J0RGlyKTtcclxuICB3aGlsZSAodGFibGUuZmlyc3RDaGlsZCkgdGFibGUucmVtb3ZlQ2hpbGQodGFibGUuZmlyc3RDaGlsZCk7XHJcbiAgdGFibGUuYXBwZW5kQ2hpbGQoYnVpbGRUaGVhZCgpKTtcclxuICB0YWJsZS5hcHBlbmRDaGlsZChidWlsZFRib2R5KHNvcnRlZCkpO1xyXG59XHJcblxyXG5mdW5jdGlvbiBidWlsZFRoZWFkKCkge1xyXG4gIC8vIHYxMzgzOiBBcHBsZS1zdHlsZSB0aGVhZC4gQ2xhc2VzIC5jYXJ0ZXJhLSogZW4gaW5kZXguaHRtbCBjb250cm9sYW4gYmcvY29sb3JzLlxyXG4gIGNvbnN0IHRoZWFkID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgndGhlYWQnKTtcclxuICBjb25zdCB0ciA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3RyJyk7XHJcbiAgY29uc3QgaGVhZGVycyA9IFtcclxuICAgIHsgbGFiZWw6ICdDbGllbnRlJywgc29ydEtleTogJ2NsaWVudE5hbWUnLCBhbGlnbjogJ2xlZnQnIH0sXHJcbiAgICB7IGxhYmVsOiAnUHJvdi9Mb2MnLCBzb3J0S2V5OiBudWxsLCBhbGlnbjogJ2xlZnQnIH0sXHJcbiAgICB7IGxhYmVsOiAnVGlwbycsIHNvcnRLZXk6IG51bGwsIGFsaWduOiAnY2VudGVyJyB9LFxyXG4gICAgeyBsYWJlbDogJ1x1MDBEQWx0LiB2aXNpdGEnLCBzb3J0S2V5OiAnZGlhc1NpblZpc2l0YVByZXNlbmNpYWwnLCBhbGlnbjogJ2xlZnQnIH0sXHJcbiAgICB7IGxhYmVsOiAnXHUwMERBbHQuIGNvbnRhY3RvJywgc29ydEtleTogJ2RpYXNTaW5Db250YWN0bycsIGFsaWduOiAnbGVmdCcgfSxcclxuICAgIHsgbGFiZWw6ICdcdTAwREFsdC4gY29tcHJhJywgc29ydEtleTogJ2RpYXNTaW5Db21wcmEnLCBhbGlnbjogJ2xlZnQnIH0sXHJcbiAgICB7IGxhYmVsOiAnRmFjdCAxMk0nLCBzb3J0S2V5OiAnZmFjdHVyYWRvMTJNJywgYWxpZ246ICdyaWdodCcgfSxcclxuICAgIHsgbGFiZWw6ICdEZXVkYScsIHNvcnRLZXk6ICdkZXVkYUFiaWVydGEnLCBhbGlnbjogJ3JpZ2h0JyB9LFxyXG4gIF07XHJcbiAgZm9yIChjb25zdCBoIG9mIGhlYWRlcnMpIHtcclxuICAgIGNvbnN0IHRoID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgndGgnKTtcclxuICAgIHRoLnN0eWxlLnRleHRBbGlnbiA9IGguYWxpZ247XHJcbiAgICB0aC50ZXh0Q29udGVudCA9IGgubGFiZWw7XHJcbiAgICBpZiAoaC5zb3J0S2V5KSB7XHJcbiAgICAgIHRoLnN0eWxlLmN1cnNvciA9ICdwb2ludGVyJztcclxuICAgICAgY29uc3Qga2V5ID0gaC5zb3J0S2V5O1xyXG4gICAgICB0aC5hZGRFdmVudExpc3RlbmVyKCdjbGljaycsICgpID0+IC8qKiBAdHlwZSB7YW55fSAqLyAod2luZG93KS5vbkNhcnRlcmFTb3J0Q2xpY2soa2V5KSk7XHJcbiAgICB9XHJcbiAgICB0ci5hcHBlbmRDaGlsZCh0aCk7XHJcbiAgfVxyXG4gIHRoZWFkLmFwcGVuZENoaWxkKHRyKTtcclxuICByZXR1cm4gdGhlYWQ7XHJcbn1cclxuXHJcbi8qKiBAcGFyYW0ge0FycmF5PGFueT59IHNvcnRlZENsaWVudGVzICovXHJcbmZ1bmN0aW9uIGJ1aWxkVGJvZHkoc29ydGVkQ2xpZW50ZXMpIHtcclxuICBjb25zdCB0Ym9keSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3Rib2R5Jyk7XHJcbiAgZm9yIChjb25zdCBjIG9mIHNvcnRlZENsaWVudGVzKSB7XHJcbiAgICB0Ym9keS5hcHBlbmRDaGlsZChidWlsZENsaWVudGVSb3coYykpO1xyXG4gIH1cclxuICByZXR1cm4gdGJvZHk7XHJcbn1cclxuXHJcbi8qKiBAcGFyYW0ge2FueX0gYyAqL1xyXG5mdW5jdGlvbiBidWlsZENsaWVudGVSb3coYykge1xyXG4gIGNvbnN0IHRyID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgndHInKTtcclxuICB0ci5zdHlsZS5jc3NUZXh0ID0gJ2N1cnNvcjpwb2ludGVyO2JvcmRlci1ib3R0b206MXB4IHNvbGlkIHZhcigtLWJvcmRlci1saWdodCknO1xyXG4gIHRyLmFkZEV2ZW50TGlzdGVuZXIoJ21vdXNlZW50ZXInLCAoKSA9PiB7XHJcbiAgICB0ci5zdHlsZS5iYWNrZ3JvdW5kID0gJ3ZhcigtLWJnLWhvdmVyKSc7XHJcbiAgfSk7XHJcbiAgdHIuYWRkRXZlbnRMaXN0ZW5lcignbW91c2VsZWF2ZScsICgpID0+IHtcclxuICAgIHRyLnN0eWxlLmJhY2tncm91bmQgPSAnJztcclxuICB9KTtcclxuICB0ci5hZGRFdmVudExpc3RlbmVyKCdjbGljaycsICgpID0+IHtcclxuICAgIC8vIEB0cy1leHBlY3QtZXJyb3JcclxuICAgIGlmICh0eXBlb2Ygd2luZG93Lm9wZW5GaWNoYUNsaWVudGUgPT09ICdmdW5jdGlvbicpIHdpbmRvdy5vcGVuRmljaGFDbGllbnRlKGMuY2xpZW50SWQpO1xyXG4gIH0pO1xyXG5cclxuICBjb25zdCB0ZE5hbWUgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCd0ZCcpO1xyXG4gIHRkTmFtZS5zdHlsZS5jc3NUZXh0ID0gJ3BhZGRpbmc6NnB4IDhweDtmb250LXdlaWdodDo2MDAnO1xyXG4gIHRkTmFtZS50ZXh0Q29udGVudCA9IGMuY2xpZW50TmFtZSB8fCAnJztcclxuICB0ci5hcHBlbmRDaGlsZCh0ZE5hbWUpO1xyXG5cclxuICBjb25zdCB0ZExvYyA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3RkJyk7XHJcbiAgdGRMb2Muc3R5bGUuY3NzVGV4dCA9ICdwYWRkaW5nOjZweCA4cHg7Zm9udC1zaXplOjEycHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCknO1xyXG4gIHRkTG9jLnRleHRDb250ZW50ID0gYCR7Yy5wcm92aW5jaWEgfHwgJyd9LyR7Yy5sb2NhbGlkYWQgfHwgJyd9YDtcclxuICB0ci5hcHBlbmRDaGlsZCh0ZExvYyk7XHJcblxyXG4gIGNvbnN0IHRkVGlwbyA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3RkJyk7XHJcbiAgdGRUaXBvLnN0eWxlLmNzc1RleHQgPSAncGFkZGluZzo2cHggOHB4O3RleHQtYWxpZ246Y2VudGVyJztcclxuICBjb25zdCB0aXBvQmFkZ2UgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdzcGFuJyk7XHJcbiAgdGlwb0JhZGdlLnN0eWxlLmNzc1RleHQgPVxyXG4gICAgJ3BhZGRpbmc6MnB4IDZweDtib3JkZXItcmFkaXVzOjRweDtiYWNrZ3JvdW5kOnZhcigtLWJnLWlucHV0KTtmb250LXNpemU6MTFweDtmb250LXdlaWdodDo3MDAnO1xyXG4gIHRpcG9CYWRnZS50ZXh0Q29udGVudCA9IGMuY2xpVGlwbyB8fCAnLSc7XHJcbiAgdGRUaXBvLmFwcGVuZENoaWxkKHRpcG9CYWRnZSk7XHJcbiAgdHIuYXBwZW5kQ2hpbGQodGRUaXBvKTtcclxuXHJcbiAgdHIuYXBwZW5kQ2hpbGQoYnVpbGREYXRlQ2VsbChjLnVsdGltYVZpc2l0YVByZXNlbmNpYWwsIGMuZGlhc1NpblZpc2l0YVByZXNlbmNpYWwsIDMwKSk7XHJcbiAgdHIuYXBwZW5kQ2hpbGQoYnVpbGREYXRlQ2VsbChjLnVsdGltb0NvbnRhY3RvLCBjLmRpYXNTaW5Db250YWN0bywgbnVsbCkpO1xyXG4gIHRyLmFwcGVuZENoaWxkKGJ1aWxkRGF0ZUNlbGwoYy51bHRpbWFDb21wcmEsIGMuZGlhc1NpbkNvbXByYSwgOTApKTtcclxuXHJcbiAgY29uc3QgdGRGYWN0ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgndGQnKTtcclxuICB0ZEZhY3Quc3R5bGUuY3NzVGV4dCA9ICdwYWRkaW5nOjZweCA4cHg7dGV4dC1hbGlnbjpyaWdodDtmb250LXZhcmlhbnQtbnVtZXJpYzp0YWJ1bGFyLW51bXMnO1xyXG4gIHRkRmFjdC50ZXh0Q29udGVudCA9IGZtdE1vbmV5KGMuZmFjdHVyYWRvMTJNKTtcclxuICB0ci5hcHBlbmRDaGlsZCh0ZEZhY3QpO1xyXG5cclxuICBjb25zdCB0ZERldWRhID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgndGQnKTtcclxuICB0ZERldWRhLnN0eWxlLmNzc1RleHQgPSBgcGFkZGluZzo2cHggOHB4O3RleHQtYWxpZ246cmlnaHQ7Zm9udC12YXJpYW50LW51bWVyaWM6dGFidWxhci1udW1zO2NvbG9yOiR7Yy5kZXVkYUFiaWVydGEgPiAwID8gJyNkYzI2MjYnIDogJ3ZhcigtLXRleHQtbXV0ZWQpJ31gO1xyXG4gIHRkRGV1ZGEudGV4dENvbnRlbnQgPSBmbXRNb25leShjLmRldWRhQWJpZXJ0YSk7XHJcbiAgdHIuYXBwZW5kQ2hpbGQodGREZXVkYSk7XHJcblxyXG4gIHJldHVybiB0cjtcclxufVxyXG5cclxuLyoqXHJcbiAqIEBwYXJhbSB7c3RyaW5nfG51bGx9IGZlY2hhSXNvXHJcbiAqIEBwYXJhbSB7bnVtYmVyfG51bGx9IGRpYXNcclxuICogQHBhcmFtIHtudW1iZXJ8bnVsbH0gZGFuZ2VyVGhyZXNob2xkXHJcbiAqL1xyXG5mdW5jdGlvbiBidWlsZERhdGVDZWxsKGZlY2hhSXNvLCBkaWFzLCBkYW5nZXJUaHJlc2hvbGQpIHtcclxuICBjb25zdCB0ZCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3RkJyk7XHJcbiAgY29uc3QgaXNEYW5nZXIgPVxyXG4gICAgZGFuZ2VyVGhyZXNob2xkICE9PSBudWxsICYmIGRpYXMgIT09IG51bGwgJiYgZGlhcyAhPT0gdW5kZWZpbmVkICYmIGRpYXMgPiBkYW5nZXJUaHJlc2hvbGQ7XHJcbiAgdGQuc3R5bGUuY3NzVGV4dCA9IGBwYWRkaW5nOjZweCA4cHg7Y29sb3I6JHtpc0RhbmdlciA/ICcjZGMyNjI2JyA6ICd2YXIoLS10ZXh0LXByaW1hcnkpJ31gO1xyXG4gIGlmICghZmVjaGFJc28pIHtcclxuICAgIHRkLnRleHRDb250ZW50ID0gJ1x1MjAxNCc7XHJcbiAgICByZXR1cm4gdGQ7XHJcbiAgfVxyXG4gIGNvbnN0IHBhcnRzID0gU3RyaW5nKGZlY2hhSXNvKS5zcGxpdCgnLScpO1xyXG4gIGNvbnN0IGQgPSBwYXJ0c1syXSB8fCAnJztcclxuICBjb25zdCBtID0gcGFydHNbMV0gfHwgJyc7XHJcbiAgdGQudGV4dENvbnRlbnQgPSBgJHtkfS8ke219YDtcclxuICBjb25zdCBkaWFzRWwgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdzbWFsbCcpO1xyXG4gIGRpYXNFbC5zdHlsZS5jc3NUZXh0ID0gJ2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO21hcmdpbi1sZWZ0OjRweCc7XHJcbiAgZGlhc0VsLnRleHRDb250ZW50ID0gYCR7ZGlhc31kYDtcclxuICB0ZC5hcHBlbmRDaGlsZChkaWFzRWwpO1xyXG4gIHJldHVybiB0ZDtcclxufVxyXG5cclxuLyoqIEBwYXJhbSB7bnVtYmVyfSBuICovXHJcbmZ1bmN0aW9uIGZtdE1vbmV5KG4pIHtcclxuICBpZiAoIW4gfHwgbiA9PT0gMCkgcmV0dXJuICctJztcclxuICBpZiAobiA+PSAxXzAwMF8wMDApIHJldHVybiBgJCAkeyhuIC8gMV8wMDBfMDAwKS50b0ZpeGVkKDEpfU1gO1xyXG4gIGlmIChuID49IDFfMDAwKSByZXR1cm4gYCQgJHsobiAvIDFfMDAwKS50b0ZpeGVkKDApfWtgO1xyXG4gIHJldHVybiBgJCAke259YDtcclxufVxyXG5cclxuLy8gPT09IFVJIHN0YXRlIGhlbHBlcnMgPT09XHJcbmZ1bmN0aW9uIGhpZGVBbGwoKSB7XHJcbiAgY29uc3QgaWRzID0gW1xyXG4gICAgJ2NhcnRlcmEtbG9hZGluZycsXHJcbiAgICAnY2FydGVyYS10YWJsZScsXHJcbiAgICAnY2FydGVyYS1rcGlzJyxcclxuICAgICdjYXJ0ZXJhLWNoaXBzJyxcclxuICAgICdjYXJ0ZXJhLWVtcHR5JyxcclxuICBdO1xyXG4gIGZvciAoY29uc3QgaWQgb2YgaWRzKSB7XHJcbiAgICBjb25zdCBlbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKGlkKTtcclxuICAgIGlmIChlbCkgZWwuc3R5bGUuZGlzcGxheSA9ICdub25lJztcclxuICB9XHJcbn1cclxuZnVuY3Rpb24gc2hvd0VtcHR5KCkge1xyXG4gIGhpZGVBbGwoKTtcclxuICBjb25zdCBlbXB0eSA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdjYXJ0ZXJhLWVtcHR5Jyk7XHJcbiAgaWYgKGVtcHR5KSB7XHJcbiAgICBlbXB0eS5zdHlsZS5kaXNwbGF5ID0gJ2Jsb2NrJztcclxuICAgIGVtcHR5LnRleHRDb250ZW50ID0gJ0VsZWdcdTAwRUQgdW4gdmVuZGVkb3IgcGFyYSB2ZXIgc3UgY2FydGVyYS4nO1xyXG4gIH1cclxufVxyXG5mdW5jdGlvbiBzaG93TG9hZGluZygpIHtcclxuICBoaWRlQWxsKCk7XHJcbiAgY29uc3QgbG9hZGluZyA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdjYXJ0ZXJhLWxvYWRpbmcnKTtcclxuICBpZiAobG9hZGluZykgbG9hZGluZy5zdHlsZS5kaXNwbGF5ID0gJ2Jsb2NrJztcclxufVxyXG5mdW5jdGlvbiBzaG93Tm9EYXRhKCkge1xyXG4gIGhpZGVBbGwoKTtcclxuICBjb25zdCBlbXB0eSA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdjYXJ0ZXJhLWVtcHR5Jyk7XHJcbiAgaWYgKGVtcHR5KSB7XHJcbiAgICBlbXB0eS5zdHlsZS5kaXNwbGF5ID0gJ2Jsb2NrJztcclxuICAgIGVtcHR5LnRleHRDb250ZW50ID1cclxuICAgICAgJ1NpbiBjYXJ0ZXJhIHBhcmEgZXN0ZSB2ZW5kZWRvci4gVmVyaWZpY1x1MDBFMSBhc3NpZ25lZFZlbmRvciBlbiBjbGllbnRfbWFzdGVyIG8gZXNwZXJcdTAwRTEgYWwgcHJcdTAwRjN4aW1vIHNuYXBzaG90ICgwNDowMCBBUlQpLic7XHJcbiAgfVxyXG59XHJcbi8qKiBAcGFyYW0ge3N0cmluZ30gbXNnICovXHJcbmZ1bmN0aW9uIHNob3dFcnJvcihtc2cpIHtcclxuICBoaWRlQWxsKCk7XHJcbiAgY29uc3QgZW1wdHkgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY2FydGVyYS1lbXB0eScpO1xyXG4gIGlmIChlbXB0eSkge1xyXG4gICAgZW1wdHkuc3R5bGUuZGlzcGxheSA9ICdibG9jayc7XHJcbiAgICBlbXB0eS5zdHlsZS5jb2xvciA9ICcjZGMyNjI2JztcclxuICAgIGVtcHR5LnRleHRDb250ZW50ID0gYEVycm9yIGNhcmdhbmRvIGNhcnRlcmE6ICR7bXNnfWA7XHJcbiAgfVxyXG59XHJcbmZ1bmN0aW9uIHNob3dUYWJsZSgpIHtcclxuICBjb25zdCBlbXB0eSA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdjYXJ0ZXJhLWVtcHR5Jyk7XHJcbiAgaWYgKGVtcHR5KSBlbXB0eS5zdHlsZS5kaXNwbGF5ID0gJ25vbmUnO1xyXG4gIGNvbnN0IGxvYWRpbmcgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY2FydGVyYS1sb2FkaW5nJyk7XHJcbiAgaWYgKGxvYWRpbmcpIGxvYWRpbmcuc3R5bGUuZGlzcGxheSA9ICdub25lJztcclxuICBjb25zdCB0YWJsZSA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdjYXJ0ZXJhLXRhYmxlJyk7XHJcbiAgaWYgKHRhYmxlKSB0YWJsZS5zdHlsZS5kaXNwbGF5ID0gJ3RhYmxlJztcclxuICAvLyB2MTM4MzogZGlzcGxheSB2YWNpbyA9IHJlc2V0IGFsIHZhbG9yIGRlbCBDU1MgKGdyaWQgcGFyYSBrcGlzLCBmbGV4IHBhcmEgY2hpcHMpLlxyXG4gIGNvbnN0IGtwaXMgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY2FydGVyYS1rcGlzJyk7XHJcbiAgaWYgKGtwaXMpIGtwaXMuc3R5bGUuZGlzcGxheSA9ICcnO1xyXG4gIGNvbnN0IGNoaXBzID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2NhcnRlcmEtY2hpcHMnKTtcclxuICBpZiAoY2hpcHMpIGNoaXBzLnN0eWxlLmRpc3BsYXkgPSAnJztcclxufVxyXG5cclxuLy8gPT09IEV4cG9ydCBFeGNlbCA9PT1cclxud2luZG93LmV4cG9ydENhcnRlcmFUb0V4Y2VsID0gYXN5bmMgZnVuY3Rpb24gZXhwb3J0Q2FydGVyYVRvRXhjZWwoKSB7XHJcbiAgaWYgKCFzZWxlY3RlZFZlbmRvcikge1xyXG4gICAgYWxlcnQoJ0VsZWdcdTAwRUQgdW4gdmVuZGVkb3IgcHJpbWVyby4nKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgY29uc3QgZG9jID0gY2FydGVyYURvY0NhY2hlLmdldChzZWxlY3RlZFZlbmRvcik7XHJcbiAgaWYgKCFkb2MpIHtcclxuICAgIGFsZXJ0KCdTaW4gZGF0YSBjYXJnYWRhLicpO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuICBjb25zdCBmaWx0ZXJlZCA9IGFwcGx5Q2hpcEZpbHRlcihkb2MuY2xpZW50ZXMsIGFjdGl2ZUNoaXApO1xyXG4gIGNvbnN0IHNlYXJjaGVkID0gc2VhcmNoUXVlcnlcclxuICAgID8gZmlsdGVyZWQuZmlsdGVyKChjKSA9PlxyXG4gICAgICAgIFN0cmluZyhjLmNsaWVudE5hbWUgfHwgJycpXHJcbiAgICAgICAgICAudG9Mb3dlckNhc2UoKVxyXG4gICAgICAgICAgLmluY2x1ZGVzKHNlYXJjaFF1ZXJ5KVxyXG4gICAgICApXHJcbiAgICA6IGZpbHRlcmVkO1xyXG4gIGNvbnN0IHNvcnRlZCA9IHNvcnRDbGllbnRlcyhzZWFyY2hlZCwgc29ydEJ5LCBzb3J0RGlyKTtcclxuXHJcbiAgY29uc3QgY2hpcExhYmVsID0gKENISVBTLmZpbmQoKGMpID0+IGMuaWQgPT09IGFjdGl2ZUNoaXApIHx8IHsgbGFiZWw6ICdUb2RvcycgfSkubGFiZWw7XHJcbiAgY29uc3QgdGl0bGUgPSBgQ2FydGVyYSBkZSAke3NlbGVjdGVkVmVuZG9yfSBcdTIwMTQgJHtjaGlwTGFiZWx9IFx1MjAxNCBTbmFwc2hvdCAke2RvYy5zbmFwc2hvdERhdGV9YDtcclxuXHJcbiAgdHJ5IHtcclxuICAgIGlmICh0eXBlb2Ygd2luZG93LmxvYWRFeGNlbEpTID09PSAnZnVuY3Rpb24nKSB7XHJcbiAgICAgIGF3YWl0IHdpbmRvdy5sb2FkRXhjZWxKUygpO1xyXG4gICAgfVxyXG4gICAgY29uc3QgRXhjZWxKUyA9IHdpbmRvdy5FeGNlbEpTO1xyXG4gICAgaWYgKCFFeGNlbEpTKSB0aHJvdyBuZXcgRXJyb3IoJ0V4Y2VsSlMgbm8gZGlzcG9uaWJsZScpO1xyXG4gICAgY29uc3Qgd2IgPSBuZXcgRXhjZWxKUy5Xb3JrYm9vaygpO1xyXG4gICAgY29uc3Qgd3MgPSB3Yi5hZGRXb3Jrc2hlZXQoJ0NhcnRlcmEnKTtcclxuXHJcbiAgICAvLyBGaWxhIDE6IHRpdHVsbyBiYW5kYSB2ZXJkZSBTaGltYW5vXHJcbiAgICB3cy5tZXJnZUNlbGxzKCdBMTpMMScpO1xyXG4gICAgY29uc3QgdGl0bGVDZWxsID0gd3MuZ2V0Q2VsbCgnQTEnKTtcclxuICAgIHRpdGxlQ2VsbC52YWx1ZSA9IHRpdGxlO1xyXG4gICAgdGl0bGVDZWxsLmZpbGwgPSB7IHR5cGU6ICdwYXR0ZXJuJywgcGF0dGVybjogJ3NvbGlkJywgZmdDb2xvcjogeyBhcmdiOiAnRkYyMkM1NUUnIH0gfTtcclxuICAgIHRpdGxlQ2VsbC5mb250ID0geyBib2xkOiB0cnVlLCBjb2xvcjogeyBhcmdiOiAnRkZGRkZGRkYnIH0sIHNpemU6IDE0IH07XHJcbiAgICB0aXRsZUNlbGwuYWxpZ25tZW50ID0geyBob3Jpem9udGFsOiAnY2VudGVyJywgdmVydGljYWw6ICdtaWRkbGUnIH07XHJcbiAgICB3cy5nZXRSb3coMSkuaGVpZ2h0ID0gMzA7XHJcblxyXG4gICAgLy8gRmlsYSAyOiBoZWFkZXJzXHJcbiAgICBjb25zdCBoZWFkZXJzID0gW1xyXG4gICAgICAnQ2xpZW50ZScsXHJcbiAgICAgICdQcm92aW5jaWEnLFxyXG4gICAgICAnTG9jYWxpZGFkJyxcclxuICAgICAgJ1RpcG8nLFxyXG4gICAgICAnXHUwMERBbHRpbWEgdmlzaXRhIHByZXNlbmNpYWwnLFxyXG4gICAgICAnXHUwMERBbHRpbW8gY29udGFjdG8nLFxyXG4gICAgICAnXHUwMERBbHRpbWEgY29tcHJhJyxcclxuICAgICAgJ0ZhY3QgMTJNIChBUlMpJyxcclxuICAgICAgJ0RldWRhIGFiaWVydGEgKEFSUyknLFxyXG4gICAgICAnRFx1MDBFRGFzIHNpbiB2aXNpdGEnLFxyXG4gICAgICAnRFx1MDBFRGFzIHNpbiBjb21wcmEnLFxyXG4gICAgICAnQ2FyZENvZGUgU0FQJyxcclxuICAgIF07XHJcbiAgICBjb25zdCBoZWFkZXJSb3cgPSB3cy5nZXRSb3coMik7XHJcbiAgICBoZWFkZXJzLmZvckVhY2goKGgsIGkpID0+IHtcclxuICAgICAgY29uc3QgY2VsbCA9IGhlYWRlclJvdy5nZXRDZWxsKGkgKyAxKTtcclxuICAgICAgY2VsbC52YWx1ZSA9IGg7XHJcbiAgICAgIGNlbGwuZmlsbCA9IHsgdHlwZTogJ3BhdHRlcm4nLCBwYXR0ZXJuOiAnc29saWQnLCBmZ0NvbG9yOiB7IGFyZ2I6ICdGRjA3NEY2OScgfSB9O1xyXG4gICAgICBjZWxsLmZvbnQgPSB7IGJvbGQ6IHRydWUsIGNvbG9yOiB7IGFyZ2I6ICdGRkZGRkZGRicgfSB9O1xyXG4gICAgICBjZWxsLmFsaWdubWVudCA9IHsgaG9yaXpvbnRhbDogJ2NlbnRlcicgfTtcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIEZpbGFzIDMrOiBkYXRhXHJcbiAgICBzb3J0ZWQuZm9yRWFjaCgoYywgaSkgPT4ge1xyXG4gICAgICBjb25zdCByb3cgPSB3cy5nZXRSb3coMyArIGkpO1xyXG4gICAgICByb3cuZ2V0Q2VsbCgxKS52YWx1ZSA9IGMuY2xpZW50TmFtZSB8fCAnJztcclxuICAgICAgcm93LmdldENlbGwoMikudmFsdWUgPSBjLnByb3ZpbmNpYSB8fCAnJztcclxuICAgICAgcm93LmdldENlbGwoMykudmFsdWUgPSBjLmxvY2FsaWRhZCB8fCAnJztcclxuICAgICAgcm93LmdldENlbGwoNCkudmFsdWUgPSBjLmNsaVRpcG8gfHwgJyc7XHJcbiAgICAgIHJvdy5nZXRDZWxsKDUpLnZhbHVlID0gYy51bHRpbWFWaXNpdGFQcmVzZW5jaWFsIHx8ICcnO1xyXG4gICAgICByb3cuZ2V0Q2VsbCg2KS52YWx1ZSA9IGMudWx0aW1vQ29udGFjdG8gfHwgJyc7XHJcbiAgICAgIHJvdy5nZXRDZWxsKDcpLnZhbHVlID0gYy51bHRpbWFDb21wcmEgfHwgJyc7XHJcbiAgICAgIHJvdy5nZXRDZWxsKDgpLnZhbHVlID0gYy5mYWN0dXJhZG8xMk0gfHwgMDtcclxuICAgICAgcm93LmdldENlbGwoOCkubnVtRm10ID0gJ1wiJFwiIywjIzAnO1xyXG4gICAgICByb3cuZ2V0Q2VsbCg5KS52YWx1ZSA9IGMuZGV1ZGFBYmllcnRhIHx8IDA7XHJcbiAgICAgIHJvdy5nZXRDZWxsKDkpLm51bUZtdCA9ICdcIiRcIiMsIyMwJztcclxuICAgICAgcm93LmdldENlbGwoMTApLnZhbHVlID0gYy5kaWFzU2luVmlzaXRhUHJlc2VuY2lhbDtcclxuICAgICAgcm93LmdldENlbGwoMTEpLnZhbHVlID0gYy5kaWFzU2luQ29tcHJhO1xyXG4gICAgICByb3cuZ2V0Q2VsbCgxMikudmFsdWUgPSBjLmNhcmRDb2RlIHx8ICcnO1xyXG4gICAgfSk7XHJcblxyXG4gICAgd3MuY29sdW1ucy5mb3JFYWNoKChjb2wsIGkpID0+IHtcclxuICAgICAgY29sLndpZHRoID0gaSA9PT0gMCA/IDMwIDogaSA9PT0gNCB8fCBpID09PSA1IHx8IGkgPT09IDYgPyAxOCA6IDE0O1xyXG4gICAgfSk7XHJcblxyXG4gICAgY29uc3QgYnVmID0gYXdhaXQgd2IueGxzeC53cml0ZUJ1ZmZlcigpO1xyXG4gICAgY29uc3QgYmxvYiA9IG5ldyBCbG9iKFtidWZdLCB7XHJcbiAgICAgIHR5cGU6ICdhcHBsaWNhdGlvbi92bmQub3BlbnhtbGZvcm1hdHMtb2ZmaWNlZG9jdW1lbnQuc3ByZWFkc2hlZXRtbC5zaGVldCcsXHJcbiAgICB9KTtcclxuICAgIGNvbnN0IHVybCA9IFVSTC5jcmVhdGVPYmplY3RVUkwoYmxvYik7XHJcbiAgICBjb25zdCBhID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnYScpO1xyXG4gICAgYS5ocmVmID0gdXJsO1xyXG4gICAgYS5kb3dubG9hZCA9IGBDYXJ0ZXJhXyR7U3RyaW5nKHNlbGVjdGVkVmVuZG9yKS5yZXBsYWNlKC9cXHMrL2csICdfJyl9XyR7YWN0aXZlQ2hpcH1fJHtkb2Muc25hcHNob3REYXRlfS54bHN4YDtcclxuICAgIGRvY3VtZW50LmJvZHkuYXBwZW5kQ2hpbGQoYSk7XHJcbiAgICBhLmNsaWNrKCk7XHJcbiAgICBhLnJlbW92ZSgpO1xyXG4gICAgVVJMLnJldm9rZU9iamVjdFVSTCh1cmwpO1xyXG4gIH0gY2F0Y2ggKGUpIHtcclxuICAgIGNvbnNvbGUuZXJyb3IoJ2V4cG9ydENhcnRlcmFUb0V4Y2VsIGZhaWxlZCcsIGUpO1xyXG4gICAgYWxlcnQoJ0Vycm9yIGV4cG9ydGFuZG86ICcgKyBTdHJpbmcoZSkpO1xyXG4gIH1cclxufTtcclxuIl0sCiAgIm1hcHBpbmdzIjogIjs7O0FBZU8sV0FB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
