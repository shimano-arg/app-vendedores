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
      snap.forEach((doc) => vendors.push(doc.id));
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
    if (info) info.textContent = `Snapshot: ${doc.snapshotDate}`;
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
      const isActive = activeChip === spec.chip;
      card.style.cssText = `padding:10px 14px;border:2px solid ${isActive ? spec.color : "var(--border-light)"};border-radius:8px;cursor:pointer;background:${isActive ? `${spec.color}15` : "var(--bg-card)"};min-width:120px;flex:1;max-width:200px`;
      card.addEventListener("click", () => (
        /** @type {any} */
        window.onCarteraChipClick(spec.chip)
      ));
      const n = document.createElement("div");
      n.style.cssText = `font-size:22px;font-weight:800;color:${spec.color}`;
      n.textContent = String(counts[spec.chip === "todos" ? "total" : spec.chip]);
      const l = document.createElement("div");
      l.style.cssText = "font-size:11px;color:var(--text-muted);margin-top:2px";
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
    for (const chip of CHIPS) {
      const b = document.createElement("button");
      const isActive = activeChip === chip.id;
      b.style.cssText = `padding:4px 10px;border-radius:999px;border:1px solid ${isActive ? "#1e3a8a" : "var(--border)"};background:${isActive ? "#1e3a8a" : "var(--bg-card)"};color:${isActive ? "white" : "var(--text-primary)"};font-size:12px;cursor:pointer;font-weight:${isActive ? "700" : "500"}`;
      b.textContent = `${chip.label} (${countByChip[chip.id]})`;
      b.addEventListener("click", () => (
        /** @type {any} */
        window.onCarteraChipClick(chip.id)
      ));
      el.appendChild(b);
    }
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
    tr.style.cssText = "position:sticky;top:0;background:var(--bg-card);border-bottom:2px solid var(--border);font-weight:700;font-size:12px;text-align:left";
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
      th.style.padding = "8px";
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
    if (kpis) kpis.style.display = "flex";
    const chips = document.getElementById("cartera-chips");
    if (chips) chips.style.display = "flex";
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL3B1cmUvY2FydGVyYS12ZW5kb3ItZmlsdGVyLmpzIiwgIi4uL3NyYy9kb21haW5zL2NhcnRlcmEtdmVuZG9yLmpzIl0sCiAgInNvdXJjZXNDb250ZW50IjogWyIvLyBAdHMtY2hlY2tcbi8qKlxuICogY2FydGVyYS12ZW5kb3ItZmlsdGVyLmpzICh2MTI4MywgMjAyNi0xMC0yMClcbiAqXG4gKiBQdXJhcyBwYXJhIGZpbHRyYXIgeSBvcmRlbmFyIGxhIHRhYmxhIGRlbCBkYXNoYm9hcmQgXCJBbmFsaXNpcyBkZSBDYXJ0ZXJhXCIuXG4gKiBJbXBvcnRhZG8gcG9yIHNyYy9kb21haW5zL2NhcnRlcmEtdmVuZG9yLmpzIChidW5kbGUgZnJvbnRlbmQpLlxuICogVGVzdGVhZG8gZW4gdGVzdHMvdW5pdC9jYXJ0ZXJhLXZlbmRvci1maWx0ZXIudGVzdC5qcy5cbiAqL1xuXG4vKipcbiAqIEFwbGljYSB1biBjaGlwIGRlIGZpbHRybyBhbCBhcnJheSBkZSBjbGllbnRlcy5cbiAqIEBwYXJhbSB7QXJyYXk8YW55Pn0gY2xpZW50ZXNcbiAqIEBwYXJhbSB7c3RyaW5nfSBjaGlwXG4gKiBAcmV0dXJucyB7QXJyYXk8YW55Pn1cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGFwcGx5Q2hpcEZpbHRlcihjbGllbnRlcywgY2hpcCkge1xuICBpZiAoIUFycmF5LmlzQXJyYXkoY2xpZW50ZXMpKSByZXR1cm4gW107XG4gIHN3aXRjaCAoY2hpcCkge1xuICAgIGNhc2UgJ2Jhc2VBY3RpdmE5MGQnOlxuICAgICAgcmV0dXJuIGNsaWVudGVzLmZpbHRlcihcbiAgICAgICAgKGMpID0+IGMuZGlhc1NpbkNvbXByYSAhPT0gbnVsbCAmJiBjLmRpYXNTaW5Db21wcmEgIT09IHVuZGVmaW5lZCAmJiBjLmRpYXNTaW5Db21wcmEgPD0gOTBcbiAgICAgICk7XG4gICAgY2FzZSAnZG9ybWlkb3NWaXNpdGEzMGQnOlxuICAgICAgcmV0dXJuIGNsaWVudGVzLmZpbHRlcihcbiAgICAgICAgKGMpID0+XG4gICAgICAgICAgYy5kaWFzU2luVmlzaXRhUHJlc2VuY2lhbCAhPT0gbnVsbCAmJlxuICAgICAgICAgIGMuZGlhc1NpblZpc2l0YVByZXNlbmNpYWwgIT09IHVuZGVmaW5lZCAmJlxuICAgICAgICAgIGMuZGlhc1NpblZpc2l0YVByZXNlbmNpYWwgPiAzMFxuICAgICAgKTtcbiAgICBjYXNlICdkb3JtaWRvc0NvbXByYTkwZCc6XG4gICAgICByZXR1cm4gY2xpZW50ZXMuZmlsdGVyKFxuICAgICAgICAoYykgPT4gYy5kaWFzU2luQ29tcHJhICE9PSBudWxsICYmIGMuZGlhc1NpbkNvbXByYSAhPT0gdW5kZWZpbmVkICYmIGMuZGlhc1NpbkNvbXByYSA+IDkwXG4gICAgICApO1xuICAgIGNhc2UgJ251bmNhVmlzaXRhZG9zJzpcbiAgICAgIHJldHVybiBjbGllbnRlcy5maWx0ZXIoXG4gICAgICAgIChjKSA9PiBjLnVsdGltYVZpc2l0YVByZXNlbmNpYWwgPT09IG51bGwgfHwgYy51bHRpbWFWaXNpdGFQcmVzZW5jaWFsID09PSB1bmRlZmluZWRcbiAgICAgICk7XG4gICAgY2FzZSAnbnVuY2FDb21wcmFyb24nOlxuICAgICAgcmV0dXJuIGNsaWVudGVzLmZpbHRlcigoYykgPT4gYy51bHRpbWFDb21wcmEgPT09IG51bGwgfHwgYy51bHRpbWFDb21wcmEgPT09IHVuZGVmaW5lZCk7XG4gICAgZGVmYXVsdDpcbiAgICAgIHJldHVybiBjbGllbnRlcy5zbGljZSgpO1xuICB9XG59XG5cbi8qKlxuICogT3JkZW5hIHVuYSBjb3BpYSBkZWwgYXJyYXkgcG9yIGNvbHVtbmEuIE51bGxzIHNpZW1wcmUgYWwgZmluYWwuXG4gKiBAcGFyYW0ge0FycmF5PGFueT59IGNsaWVudGVzXG4gKiBAcGFyYW0ge3N0cmluZ30gc29ydEJ5XG4gKiBAcGFyYW0geydhc2MnfCdkZXNjJ30gc29ydERpclxuICogQHJldHVybnMge0FycmF5PGFueT59XG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzb3J0Q2xpZW50ZXMoY2xpZW50ZXMsIHNvcnRCeSwgc29ydERpcikge1xuICBpZiAoIUFycmF5LmlzQXJyYXkoY2xpZW50ZXMpKSByZXR1cm4gW107XG4gIGNvbnN0IGRpciA9IHNvcnREaXIgPT09ICdhc2MnID8gMSA6IC0xO1xuICBjb25zdCBjb3B5ID0gY2xpZW50ZXMuc2xpY2UoKTtcbiAgY29weS5zb3J0KChhLCBiKSA9PiB7XG4gICAgY29uc3QgYXYgPSBhW3NvcnRCeV07XG4gICAgY29uc3QgYnYgPSBiW3NvcnRCeV07XG4gICAgY29uc3QgYU51bGwgPSBhdiA9PT0gbnVsbCB8fCBhdiA9PT0gdW5kZWZpbmVkO1xuICAgIGNvbnN0IGJOdWxsID0gYnYgPT09IG51bGwgfHwgYnYgPT09IHVuZGVmaW5lZDtcbiAgICBpZiAoYU51bGwgJiYgYk51bGwpIHJldHVybiAwO1xuICAgIGlmIChhTnVsbCkgcmV0dXJuIDE7XG4gICAgaWYgKGJOdWxsKSByZXR1cm4gLTE7XG4gICAgaWYgKHR5cGVvZiBhdiA9PT0gJ251bWJlcicgJiYgdHlwZW9mIGJ2ID09PSAnbnVtYmVyJykgcmV0dXJuIChhdiAtIGJ2KSAqIGRpcjtcbiAgICByZXR1cm4gU3RyaW5nKGF2KS5sb2NhbGVDb21wYXJlKFN0cmluZyhidikpICogZGlyO1xuICB9KTtcbiAgcmV0dXJuIGNvcHk7XG59XG4iLCAiLy8gQHRzLW5vY2hlY2tcclxuLy8gTk9UQTogQHRzLW5vY2hlY2sgaW50ZW5jaW9uYWwuIEVsIGNodW5rIGVzIGhlYXZ5IERPTSArIHdpbmRvdy4qIGhhbmRsZXJzICtcclxuLy8gRmlyZXN0b3JlIFNESyBjb21wYXQgdjguIEFub3RhciBzdHJpY3RhbWVudGUgY2FkYSBoYW5kbGVyIHNlclx1MDBFRGEgcnVpZG8gc2luXHJcbi8vIHZhbG9yIFx1MjAxNCBsb3MgaGVscGVycyBwdXJvcyBxdWUgaW1wb3J0YW1vcyAoLi4vcHVyZS9jYXJ0ZXJhLXZlbmRvci1maWx0ZXIuanMpXHJcbi8vIHkgZWwgY29yZSAoZnVuY3Rpb25zL2NvcmUvY2FydGVyYS12ZW5kb3ItY29yZS5qcykgc1x1MDBFRCB0aWVuZW4gQHRzLWNoZWNrLlxyXG4vKipcclxuICogY2FydGVyYS12ZW5kb3IuanMgKHYxMjgzLCAyMDI2LTEwLTIwKSBcdTIwMTQgYnVuZGxlIGNodW5rIGxhenkuXHJcbiAqXHJcbiAqIERhc2hib2FyZCBcIkFuYWxpc2lzIGRlIENhcnRlcmEgcG9yIFZlbmRlZG9yXCIuIFJlZW1wbGF6YSBzZWd1aW1pZW50by5qcy5cclxuICogTGVlIGNhcnRlcmFfdmVuZG9yL3t2ZW5kb3JLZXl9IEZpcmVzdG9yZSAoc25hcHNob3QgbmlnaHRseSAwNDowMCBBUlQpLlxyXG4gKlxyXG4gKiBUT0RPIGVsIERPTSByZW5kZXIgdXNhIGNyZWF0ZUVsZW1lbnQgKyB0ZXh0Q29udGVudCAocG9saWN5IGFudGktWFNTLCBubyBpbm5lckhUTUwpLlxyXG4gKlxyXG4gKiBTcGVjOiBkb2NzL3N1cGVycG93ZXJzL3NwZWNzLzIwMjYtMTAtMjAtY2FydGVyYS12ZW5kb3ItYW5hbGlzaXMtZGVzaWduLm1kXHJcbiAqIFBsYW46IGRvY3Mvc3VwZXJwb3dlcnMvcGxhbnMvMjAyNi0xMC0yMC1jYXJ0ZXJhLXZlbmRvci1hbmFsaXNpcy5tZFxyXG4gKi9cclxuXHJcbmltcG9ydCB7IGFwcGx5Q2hpcEZpbHRlciwgc29ydENsaWVudGVzIH0gZnJvbSAnLi4vcHVyZS9jYXJ0ZXJhLXZlbmRvci1maWx0ZXIuanMnO1xyXG5cclxuLyoqIEB0eXBlIHtNYXA8c3RyaW5nLCBhbnk+fSAqL1xyXG5jb25zdCBjYXJ0ZXJhRG9jQ2FjaGUgPSBuZXcgTWFwKCk7XHJcbi8qKiBAdHlwZSB7c3RyaW5nfG51bGx9ICovXHJcbmxldCBzZWxlY3RlZFZlbmRvciA9IG51bGw7XHJcbmxldCBhY3RpdmVDaGlwID0gJ3RvZG9zJztcclxubGV0IHNlYXJjaFF1ZXJ5ID0gJyc7XHJcbmxldCBzb3J0QnkgPSAnZGlhc1NpbkNvbXByYSc7XHJcbi8qKiBAdHlwZSB7J2FzYyd8J2Rlc2MnfSAqL1xyXG5sZXQgc29ydERpciA9ICdkZXNjJztcclxuXHJcbmNvbnN0IENISVBTID0gW1xyXG4gIHsgaWQ6ICd0b2RvcycsIGxhYmVsOiAnVG9kb3MnIH0sXHJcbiAgeyBpZDogJ2Jhc2VBY3RpdmE5MGQnLCBsYWJlbDogJ0Jhc2UgYWN0aXZhIDkwZCcgfSxcclxuICB7IGlkOiAnZG9ybWlkb3NWaXNpdGEzMGQnLCBsYWJlbDogJ0Rvcm1pZG9zIHZpc2l0YSAzMGQnIH0sXHJcbiAgeyBpZDogJ2Rvcm1pZG9zQ29tcHJhOTBkJywgbGFiZWw6ICdEb3JtaWRvcyBjb21wcmEgOTBkJyB9LFxyXG4gIHsgaWQ6ICdudW5jYVZpc2l0YWRvcycsIGxhYmVsOiAnTnVuY2EgdmlzaXRhZG9zJyB9LFxyXG4gIHsgaWQ6ICdudW5jYUNvbXByYXJvbicsIGxhYmVsOiAnTnVuY2EgY29tcHJhcm9uJyB9LFxyXG5dO1xyXG5cclxuY29uc3QgS1BJX0NBUkRTID0gW1xyXG4gIHsgY2hpcDogJ3RvZG9zJywgbGFiZWw6ICdUb3RhbCBjYXJ0ZXJhJywgY29sb3I6ICcjNjQ3NDhiJyB9LFxyXG4gIHsgY2hpcDogJ2Jhc2VBY3RpdmE5MGQnLCBsYWJlbDogJ0Jhc2UgYWN0aXZhIDkwZCcsIGNvbG9yOiAnIzE2YTM0YScgfSxcclxuICB7IGNoaXA6ICdkb3JtaWRvc1Zpc2l0YTMwZCcsIGxhYmVsOiAnRG9ybWlkb3MgdmlzIDMwZCcsIGNvbG9yOiAnI2VhNTgwYycgfSxcclxuICB7IGNoaXA6ICdkb3JtaWRvc0NvbXByYTkwZCcsIGxhYmVsOiAnRG9ybWlkb3MgY29tIDkwZCcsIGNvbG9yOiAnI2RjMjYyNicgfSxcclxuICB7IGNoaXA6ICdudW5jYVZpc2l0YWRvcycsIGxhYmVsOiAnTnVuY2EgdmlzaXRhZG9zJywgY29sb3I6ICcjN2MzYWVkJyB9LFxyXG4gIHsgY2hpcDogJ251bmNhQ29tcHJhcm9uJywgbGFiZWw6ICdOdW5jYSBjb21wcmFyb24nLCBjb2xvcjogJyNiZTE4NWQnIH0sXHJcbl07XHJcblxyXG4vLyA9PT0gT3BlbiAvIGNsb3NlID09PVxyXG53aW5kb3cub3BlbkNhcnRlcmFNb2RhbCA9IGFzeW5jIGZ1bmN0aW9uIG9wZW5DYXJ0ZXJhTW9kYWwoKSB7XHJcbiAgY29uc3QgbW9kYWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY2FydGVyYS1tb2RhbCcpO1xyXG4gIGlmICghbW9kYWwpIHJldHVybjtcclxuICBtb2RhbC5jbGFzc0xpc3QuYWRkKCdvcGVuJyk7XHJcbiAgYXdhaXQgcG9wdWxhdGVWZW5kb3JEcm9wZG93bigpO1xyXG59O1xyXG5cclxud2luZG93LmNsb3NlQ2FydGVyYU1vZGFsID0gZnVuY3Rpb24gY2xvc2VDYXJ0ZXJhTW9kYWwoKSB7XHJcbiAgY29uc3QgbW9kYWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY2FydGVyYS1tb2RhbCcpO1xyXG4gIGlmIChtb2RhbCkgbW9kYWwuY2xhc3NMaXN0LnJlbW92ZSgnb3BlbicpO1xyXG59O1xyXG5cclxuLy8gPT09IERyb3Bkb3duIGRlIHZlbmRvcnMgPT09XHJcbmFzeW5jIGZ1bmN0aW9uIHBvcHVsYXRlVmVuZG9yRHJvcGRvd24oKSB7XHJcbiAgY29uc3Qgc2VsID0gLyoqIEB0eXBlIHtIVE1MU2VsZWN0RWxlbWVudHxudWxsfSAqLyAoXHJcbiAgICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY2FydGVyYS12ZW5kb3Itc2VsZWN0JylcclxuICApO1xyXG4gIGlmICghc2VsKSByZXR1cm47XHJcbiAgaWYgKHNlbC5vcHRpb25zLmxlbmd0aCA+IDEpIHJldHVybjtcclxuICB0cnkge1xyXG4gICAgLy8gQHRzLWV4cGVjdC1lcnJvclxyXG4gICAgY29uc3Qgc25hcCA9IGF3YWl0IGZpcmViYXNlLmZpcmVzdG9yZSgpLmNvbGxlY3Rpb24oJ2NhcnRlcmFfdmVuZG9yJykuZ2V0KCk7XHJcbiAgICAvKiogQHR5cGUge3N0cmluZ1tdfSAqL1xyXG4gICAgY29uc3QgdmVuZG9ycyA9IFtdO1xyXG4gICAgc25hcC5mb3JFYWNoKChkb2MpID0+IHZlbmRvcnMucHVzaChkb2MuaWQpKTtcclxuICAgIHZlbmRvcnMuc29ydCgpO1xyXG4gICAgZm9yIChjb25zdCB2IG9mIHZlbmRvcnMpIHtcclxuICAgICAgY29uc3Qgb3B0ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnb3B0aW9uJyk7XHJcbiAgICAgIG9wdC52YWx1ZSA9IHY7XHJcbiAgICAgIG9wdC50ZXh0Q29udGVudCA9IHY7XHJcbiAgICAgIHNlbC5hcHBlbmRDaGlsZChvcHQpO1xyXG4gICAgfVxyXG4gIH0gY2F0Y2ggKGUpIHtcclxuICAgIGNvbnNvbGUuZXJyb3IoJ3BvcHVsYXRlVmVuZG9yRHJvcGRvd24gZmFpbGVkJywgZSk7XHJcbiAgfVxyXG59XHJcblxyXG4vLyA9PT0gT24gdmVuZG9yIGNoYW5nZSA9PT1cclxud2luZG93Lm9uQ2FydGVyYVZlbmRvckNoYW5nZSA9IGFzeW5jIGZ1bmN0aW9uIG9uQ2FydGVyYVZlbmRvckNoYW5nZSgpIHtcclxuICBjb25zdCBzZWwgPSAvKiogQHR5cGUge0hUTUxTZWxlY3RFbGVtZW50fG51bGx9ICovIChcclxuICAgIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdjYXJ0ZXJhLXZlbmRvci1zZWxlY3QnKVxyXG4gICk7XHJcbiAgaWYgKCFzZWwpIHJldHVybjtcclxuICBzZWxlY3RlZFZlbmRvciA9IHNlbC52YWx1ZSB8fCBudWxsO1xyXG4gIGFjdGl2ZUNoaXAgPSAndG9kb3MnO1xyXG4gIHNlYXJjaFF1ZXJ5ID0gJyc7XHJcbiAgY29uc3Qgc2VhcmNoSW5wdXQgPSAvKiogQHR5cGUge0hUTUxJbnB1dEVsZW1lbnR8bnVsbH0gKi8gKFxyXG4gICAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2NhcnRlcmEtc2VhcmNoJylcclxuICApO1xyXG4gIGlmIChzZWFyY2hJbnB1dCkgc2VhcmNoSW5wdXQudmFsdWUgPSAnJztcclxuICBpZiAoIXNlbGVjdGVkVmVuZG9yKSB7XHJcbiAgICBzaG93RW1wdHkoKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgc2hvd0xvYWRpbmcoKTtcclxuICB0cnkge1xyXG4gICAgbGV0IGRvYyA9IGNhcnRlcmFEb2NDYWNoZS5nZXQoc2VsZWN0ZWRWZW5kb3IpO1xyXG4gICAgaWYgKCFkb2MpIHtcclxuICAgICAgLy8gQHRzLWV4cGVjdC1lcnJvclxyXG4gICAgICBjb25zdCBzbmFwID0gYXdhaXQgZmlyZWJhc2VcclxuICAgICAgICAuZmlyZXN0b3JlKClcclxuICAgICAgICAuY29sbGVjdGlvbignY2FydGVyYV92ZW5kb3InKVxyXG4gICAgICAgIC5kb2Moc2VsZWN0ZWRWZW5kb3IpXHJcbiAgICAgICAgLmdldCgpO1xyXG4gICAgICBpZiAoIXNuYXAuZXhpc3RzKSB7XHJcbiAgICAgICAgc2hvd05vRGF0YSgpO1xyXG4gICAgICAgIHJldHVybjtcclxuICAgICAgfVxyXG4gICAgICBkb2MgPSBzbmFwLmRhdGEoKTtcclxuICAgICAgY2FydGVyYURvY0NhY2hlLnNldChzZWxlY3RlZFZlbmRvciwgZG9jKTtcclxuICAgIH1cclxuICAgIHJlbmRlckRhc2hib2FyZChkb2MpO1xyXG4gIH0gY2F0Y2ggKGUpIHtcclxuICAgIGNvbnNvbGUuZXJyb3IoJ29uQ2FydGVyYVZlbmRvckNoYW5nZSBmYWlsZWQnLCBlKTtcclxuICAgIHNob3dFcnJvcihTdHJpbmcoZSkpO1xyXG4gIH1cclxufTtcclxuXHJcbi8qKiBAdHlwZSB7YW55fSAqLyAod2luZG93KS5vbkNhcnRlcmFDaGlwQ2xpY2sgPSBmdW5jdGlvbiBvbkNhcnRlcmFDaGlwQ2xpY2soY2hpcElkKSB7XHJcbiAgYWN0aXZlQ2hpcCA9IGNoaXBJZDtcclxuICBpZiAoIXNlbGVjdGVkVmVuZG9yKSByZXR1cm47XHJcbiAgY29uc3QgZG9jID0gY2FydGVyYURvY0NhY2hlLmdldChzZWxlY3RlZFZlbmRvcik7XHJcbiAgaWYgKGRvYykgcmVuZGVyRGFzaGJvYXJkKGRvYyk7XHJcbn07XHJcblxyXG4vKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIHNldFRpbWVvdXQ+fG51bGx9ICovXHJcbmxldCBzZWFyY2hEZWJvdW5jZVRpbWVyID0gbnVsbDtcclxud2luZG93Lm9uQ2FydGVyYVNlYXJjaENoYW5nZSA9IGZ1bmN0aW9uIG9uQ2FydGVyYVNlYXJjaENoYW5nZSgpIHtcclxuICBjb25zdCBpbnB1dCA9IC8qKiBAdHlwZSB7SFRNTElucHV0RWxlbWVudHxudWxsfSAqLyAoZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2NhcnRlcmEtc2VhcmNoJykpO1xyXG4gIGlmICghaW5wdXQpIHJldHVybjtcclxuICBpZiAoc2VhcmNoRGVib3VuY2VUaW1lcikgY2xlYXJUaW1lb3V0KHNlYXJjaERlYm91bmNlVGltZXIpO1xyXG4gIHNlYXJjaERlYm91bmNlVGltZXIgPSBzZXRUaW1lb3V0KCgpID0+IHtcclxuICAgIHNlYXJjaFF1ZXJ5ID0gKGlucHV0LnZhbHVlIHx8ICcnKS50cmltKCkudG9Mb3dlckNhc2UoKTtcclxuICAgIGlmICghc2VsZWN0ZWRWZW5kb3IpIHJldHVybjtcclxuICAgIGNvbnN0IGRvYyA9IGNhcnRlcmFEb2NDYWNoZS5nZXQoc2VsZWN0ZWRWZW5kb3IpO1xyXG4gICAgaWYgKGRvYykgcmVuZGVyRGFzaGJvYXJkKGRvYyk7XHJcbiAgfSwgMzAwKTtcclxufTtcclxuXHJcbi8qKiBAdHlwZSB7YW55fSAqLyAod2luZG93KS5vbkNhcnRlcmFTb3J0Q2xpY2sgPSBmdW5jdGlvbiBvbkNhcnRlcmFTb3J0Q2xpY2soY29sS2V5KSB7XHJcbiAgaWYgKHNvcnRCeSA9PT0gY29sS2V5KSBzb3J0RGlyID0gc29ydERpciA9PT0gJ2FzYycgPyAnZGVzYycgOiAnYXNjJztcclxuICBlbHNlIHtcclxuICAgIHNvcnRCeSA9IGNvbEtleTtcclxuICAgIHNvcnREaXIgPSAnZGVzYyc7XHJcbiAgfVxyXG4gIGlmICghc2VsZWN0ZWRWZW5kb3IpIHJldHVybjtcclxuICBjb25zdCBkb2MgPSBjYXJ0ZXJhRG9jQ2FjaGUuZ2V0KHNlbGVjdGVkVmVuZG9yKTtcclxuICBpZiAoZG9jKSByZW5kZXJEYXNoYm9hcmQoZG9jKTtcclxufTtcclxuXHJcbi8vID09PSBSZW5kZXIgPT09XHJcbmZ1bmN0aW9uIHJlbmRlckRhc2hib2FyZChkb2MpIHtcclxuICBjb25zdCBzdWJ0aXRsZSA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdjYXJ0ZXJhLXN1YnRpdGxlJyk7XHJcbiAgaWYgKHN1YnRpdGxlKSBzdWJ0aXRsZS50ZXh0Q29udGVudCA9IGAke2RvYy5jb3VudHMudG90YWx9IGNsaWVudGVzIGVuIGNhcnRlcmEuYDtcclxuICBjb25zdCBpbmZvID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2NhcnRlcmEtc25hcHNob3QtaW5mbycpO1xyXG4gIGlmIChpbmZvKSBpbmZvLnRleHRDb250ZW50ID0gYFNuYXBzaG90OiAke2RvYy5zbmFwc2hvdERhdGV9YDtcclxuICByZW5kZXJLcGlzKGRvYy5jb3VudHMpO1xyXG4gIHJlbmRlckNoaXBzKGRvYy5jb3VudHMpO1xyXG4gIHJlbmRlclRhYmxlKGRvYy5jbGllbnRlcyk7XHJcbiAgc2hvd1RhYmxlKCk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIHJlbmRlcktwaXMoY291bnRzKSB7XHJcbiAgY29uc3QgZWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY2FydGVyYS1rcGlzJyk7XHJcbiAgaWYgKCFlbCkgcmV0dXJuO1xyXG4gIHdoaWxlIChlbC5maXJzdENoaWxkKSBlbC5yZW1vdmVDaGlsZChlbC5maXJzdENoaWxkKTtcclxuICBmb3IgKGNvbnN0IHNwZWMgb2YgS1BJX0NBUkRTKSB7XHJcbiAgICBjb25zdCBjYXJkID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2Jyk7XHJcbiAgICBjb25zdCBpc0FjdGl2ZSA9IGFjdGl2ZUNoaXAgPT09IHNwZWMuY2hpcDtcclxuICAgIGNhcmQuc3R5bGUuY3NzVGV4dCA9IGBwYWRkaW5nOjEwcHggMTRweDtib3JkZXI6MnB4IHNvbGlkICR7aXNBY3RpdmUgPyBzcGVjLmNvbG9yIDogJ3ZhcigtLWJvcmRlci1saWdodCknfTtib3JkZXItcmFkaXVzOjhweDtjdXJzb3I6cG9pbnRlcjtiYWNrZ3JvdW5kOiR7aXNBY3RpdmUgPyBgJHtzcGVjLmNvbG9yfTE1YCA6ICd2YXIoLS1iZy1jYXJkKSd9O21pbi13aWR0aDoxMjBweDtmbGV4OjE7bWF4LXdpZHRoOjIwMHB4YDtcclxuICAgIGNhcmQuYWRkRXZlbnRMaXN0ZW5lcignY2xpY2snLCAoKSA9PiAvKiogQHR5cGUge2FueX0gKi8gKHdpbmRvdykub25DYXJ0ZXJhQ2hpcENsaWNrKHNwZWMuY2hpcCkpO1xyXG4gICAgY29uc3QgbiA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpO1xyXG4gICAgbi5zdHlsZS5jc3NUZXh0ID0gYGZvbnQtc2l6ZToyMnB4O2ZvbnQtd2VpZ2h0OjgwMDtjb2xvcjoke3NwZWMuY29sb3J9YDtcclxuICAgIG4udGV4dENvbnRlbnQgPSBTdHJpbmcoY291bnRzW3NwZWMuY2hpcCA9PT0gJ3RvZG9zJyA/ICd0b3RhbCcgOiBzcGVjLmNoaXBdKTtcclxuICAgIGNvbnN0IGwgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKTtcclxuICAgIGwuc3R5bGUuY3NzVGV4dCA9ICdmb250LXNpemU6MTFweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTttYXJnaW4tdG9wOjJweCc7XHJcbiAgICBsLnRleHRDb250ZW50ID0gc3BlYy5sYWJlbDtcclxuICAgIGNhcmQuYXBwZW5kQ2hpbGQobik7XHJcbiAgICBjYXJkLmFwcGVuZENoaWxkKGwpO1xyXG4gICAgZWwuYXBwZW5kQ2hpbGQoY2FyZCk7XHJcbiAgfVxyXG59XHJcblxyXG5mdW5jdGlvbiByZW5kZXJDaGlwcyhjb3VudHMpIHtcclxuICBjb25zdCBlbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdjYXJ0ZXJhLWNoaXBzJyk7XHJcbiAgaWYgKCFlbCkgcmV0dXJuO1xyXG4gIGNvbnN0IGNvdW50QnlDaGlwID0ge1xyXG4gICAgdG9kb3M6IGNvdW50cy50b3RhbCxcclxuICAgIGJhc2VBY3RpdmE5MGQ6IGNvdW50cy5iYXNlQWN0aXZhOTBkLFxyXG4gICAgZG9ybWlkb3NWaXNpdGEzMGQ6IGNvdW50cy5kb3JtaWRvc1Zpc2l0YTMwZCxcclxuICAgIGRvcm1pZG9zQ29tcHJhOTBkOiBjb3VudHMuZG9ybWlkb3NDb21wcmE5MGQsXHJcbiAgICBudW5jYVZpc2l0YWRvczogY291bnRzLm51bmNhVmlzaXRhZG9zLFxyXG4gICAgbnVuY2FDb21wcmFyb246IGNvdW50cy5udW5jYUNvbXByYXJvbixcclxuICB9O1xyXG4gIHdoaWxlIChlbC5maXJzdENoaWxkKSBlbC5yZW1vdmVDaGlsZChlbC5maXJzdENoaWxkKTtcclxuICBmb3IgKGNvbnN0IGNoaXAgb2YgQ0hJUFMpIHtcclxuICAgIGNvbnN0IGIgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdidXR0b24nKTtcclxuICAgIGNvbnN0IGlzQWN0aXZlID0gYWN0aXZlQ2hpcCA9PT0gY2hpcC5pZDtcclxuICAgIGIuc3R5bGUuY3NzVGV4dCA9IGBwYWRkaW5nOjRweCAxMHB4O2JvcmRlci1yYWRpdXM6OTk5cHg7Ym9yZGVyOjFweCBzb2xpZCAke2lzQWN0aXZlID8gJyMxZTNhOGEnIDogJ3ZhcigtLWJvcmRlciknfTtiYWNrZ3JvdW5kOiR7aXNBY3RpdmUgPyAnIzFlM2E4YScgOiAndmFyKC0tYmctY2FyZCknfTtjb2xvcjoke2lzQWN0aXZlID8gJ3doaXRlJyA6ICd2YXIoLS10ZXh0LXByaW1hcnkpJ307Zm9udC1zaXplOjEycHg7Y3Vyc29yOnBvaW50ZXI7Zm9udC13ZWlnaHQ6JHtpc0FjdGl2ZSA/ICc3MDAnIDogJzUwMCd9YDtcclxuICAgIGIudGV4dENvbnRlbnQgPSBgJHtjaGlwLmxhYmVsfSAoJHtjb3VudEJ5Q2hpcFtjaGlwLmlkXX0pYDtcclxuICAgIGIuYWRkRXZlbnRMaXN0ZW5lcignY2xpY2snLCAoKSA9PiAvKiogQHR5cGUge2FueX0gKi8gKHdpbmRvdykub25DYXJ0ZXJhQ2hpcENsaWNrKGNoaXAuaWQpKTtcclxuICAgIGVsLmFwcGVuZENoaWxkKGIpO1xyXG4gIH1cclxufVxyXG5cclxuLyoqIEBwYXJhbSB7QXJyYXk8YW55Pn0gY2xpZW50ZXMgKi9cclxuZnVuY3Rpb24gcmVuZGVyVGFibGUoY2xpZW50ZXMpIHtcclxuICBjb25zdCB0YWJsZSA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdjYXJ0ZXJhLXRhYmxlJyk7XHJcbiAgaWYgKCF0YWJsZSkgcmV0dXJuO1xyXG4gIGNvbnN0IGZpbHRlcmVkID0gYXBwbHlDaGlwRmlsdGVyKGNsaWVudGVzLCBhY3RpdmVDaGlwKTtcclxuICBjb25zdCBzZWFyY2hlZCA9IHNlYXJjaFF1ZXJ5XHJcbiAgICA/IGZpbHRlcmVkLmZpbHRlcigoYykgPT5cclxuICAgICAgICBTdHJpbmcoYy5jbGllbnROYW1lIHx8ICcnKVxyXG4gICAgICAgICAgLnRvTG93ZXJDYXNlKClcclxuICAgICAgICAgIC5pbmNsdWRlcyhzZWFyY2hRdWVyeSlcclxuICAgICAgKVxyXG4gICAgOiBmaWx0ZXJlZDtcclxuICBjb25zdCBzb3J0ZWQgPSBzb3J0Q2xpZW50ZXMoc2VhcmNoZWQsIHNvcnRCeSwgc29ydERpcik7XHJcbiAgd2hpbGUgKHRhYmxlLmZpcnN0Q2hpbGQpIHRhYmxlLnJlbW92ZUNoaWxkKHRhYmxlLmZpcnN0Q2hpbGQpO1xyXG4gIHRhYmxlLmFwcGVuZENoaWxkKGJ1aWxkVGhlYWQoKSk7XHJcbiAgdGFibGUuYXBwZW5kQ2hpbGQoYnVpbGRUYm9keShzb3J0ZWQpKTtcclxufVxyXG5cclxuZnVuY3Rpb24gYnVpbGRUaGVhZCgpIHtcclxuICBjb25zdCB0aGVhZCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3RoZWFkJyk7XHJcbiAgY29uc3QgdHIgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCd0cicpO1xyXG4gIHRyLnN0eWxlLmNzc1RleHQgPVxyXG4gICAgJ3Bvc2l0aW9uOnN0aWNreTt0b3A6MDtiYWNrZ3JvdW5kOnZhcigtLWJnLWNhcmQpO2JvcmRlci1ib3R0b206MnB4IHNvbGlkIHZhcigtLWJvcmRlcik7Zm9udC13ZWlnaHQ6NzAwO2ZvbnQtc2l6ZToxMnB4O3RleHQtYWxpZ246bGVmdCc7XHJcbiAgY29uc3QgaGVhZGVycyA9IFtcclxuICAgIHsgbGFiZWw6ICdDbGllbnRlJywgc29ydEtleTogJ2NsaWVudE5hbWUnLCBhbGlnbjogJ2xlZnQnIH0sXHJcbiAgICB7IGxhYmVsOiAnUHJvdi9Mb2MnLCBzb3J0S2V5OiBudWxsLCBhbGlnbjogJ2xlZnQnIH0sXHJcbiAgICB7IGxhYmVsOiAnVGlwbycsIHNvcnRLZXk6IG51bGwsIGFsaWduOiAnY2VudGVyJyB9LFxyXG4gICAgeyBsYWJlbDogJ1x1MDBEQWx0LiB2aXNpdGEnLCBzb3J0S2V5OiAnZGlhc1NpblZpc2l0YVByZXNlbmNpYWwnLCBhbGlnbjogJ2xlZnQnIH0sXHJcbiAgICB7IGxhYmVsOiAnXHUwMERBbHQuIGNvbnRhY3RvJywgc29ydEtleTogJ2RpYXNTaW5Db250YWN0bycsIGFsaWduOiAnbGVmdCcgfSxcclxuICAgIHsgbGFiZWw6ICdcdTAwREFsdC4gY29tcHJhJywgc29ydEtleTogJ2RpYXNTaW5Db21wcmEnLCBhbGlnbjogJ2xlZnQnIH0sXHJcbiAgICB7IGxhYmVsOiAnRmFjdCAxMk0nLCBzb3J0S2V5OiAnZmFjdHVyYWRvMTJNJywgYWxpZ246ICdyaWdodCcgfSxcclxuICAgIHsgbGFiZWw6ICdEZXVkYScsIHNvcnRLZXk6ICdkZXVkYUFiaWVydGEnLCBhbGlnbjogJ3JpZ2h0JyB9LFxyXG4gIF07XHJcbiAgZm9yIChjb25zdCBoIG9mIGhlYWRlcnMpIHtcclxuICAgIGNvbnN0IHRoID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgndGgnKTtcclxuICAgIHRoLnN0eWxlLnBhZGRpbmcgPSAnOHB4JztcclxuICAgIHRoLnN0eWxlLnRleHRBbGlnbiA9IGguYWxpZ247XHJcbiAgICB0aC50ZXh0Q29udGVudCA9IGgubGFiZWw7XHJcbiAgICBpZiAoaC5zb3J0S2V5KSB7XHJcbiAgICAgIHRoLnN0eWxlLmN1cnNvciA9ICdwb2ludGVyJztcclxuICAgICAgY29uc3Qga2V5ID0gaC5zb3J0S2V5O1xyXG4gICAgICB0aC5hZGRFdmVudExpc3RlbmVyKCdjbGljaycsICgpID0+IC8qKiBAdHlwZSB7YW55fSAqLyAod2luZG93KS5vbkNhcnRlcmFTb3J0Q2xpY2soa2V5KSk7XHJcbiAgICB9XHJcbiAgICB0ci5hcHBlbmRDaGlsZCh0aCk7XHJcbiAgfVxyXG4gIHRoZWFkLmFwcGVuZENoaWxkKHRyKTtcclxuICByZXR1cm4gdGhlYWQ7XHJcbn1cclxuXHJcbi8qKiBAcGFyYW0ge0FycmF5PGFueT59IHNvcnRlZENsaWVudGVzICovXHJcbmZ1bmN0aW9uIGJ1aWxkVGJvZHkoc29ydGVkQ2xpZW50ZXMpIHtcclxuICBjb25zdCB0Ym9keSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3Rib2R5Jyk7XHJcbiAgZm9yIChjb25zdCBjIG9mIHNvcnRlZENsaWVudGVzKSB7XHJcbiAgICB0Ym9keS5hcHBlbmRDaGlsZChidWlsZENsaWVudGVSb3coYykpO1xyXG4gIH1cclxuICByZXR1cm4gdGJvZHk7XHJcbn1cclxuXHJcbi8qKiBAcGFyYW0ge2FueX0gYyAqL1xyXG5mdW5jdGlvbiBidWlsZENsaWVudGVSb3coYykge1xyXG4gIGNvbnN0IHRyID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgndHInKTtcclxuICB0ci5zdHlsZS5jc3NUZXh0ID0gJ2N1cnNvcjpwb2ludGVyO2JvcmRlci1ib3R0b206MXB4IHNvbGlkIHZhcigtLWJvcmRlci1saWdodCknO1xyXG4gIHRyLmFkZEV2ZW50TGlzdGVuZXIoJ21vdXNlZW50ZXInLCAoKSA9PiB7XHJcbiAgICB0ci5zdHlsZS5iYWNrZ3JvdW5kID0gJ3ZhcigtLWJnLWhvdmVyKSc7XHJcbiAgfSk7XHJcbiAgdHIuYWRkRXZlbnRMaXN0ZW5lcignbW91c2VsZWF2ZScsICgpID0+IHtcclxuICAgIHRyLnN0eWxlLmJhY2tncm91bmQgPSAnJztcclxuICB9KTtcclxuICB0ci5hZGRFdmVudExpc3RlbmVyKCdjbGljaycsICgpID0+IHtcclxuICAgIC8vIEB0cy1leHBlY3QtZXJyb3JcclxuICAgIGlmICh0eXBlb2Ygd2luZG93Lm9wZW5GaWNoYUNsaWVudGUgPT09ICdmdW5jdGlvbicpIHdpbmRvdy5vcGVuRmljaGFDbGllbnRlKGMuY2xpZW50SWQpO1xyXG4gIH0pO1xyXG5cclxuICBjb25zdCB0ZE5hbWUgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCd0ZCcpO1xyXG4gIHRkTmFtZS5zdHlsZS5jc3NUZXh0ID0gJ3BhZGRpbmc6NnB4IDhweDtmb250LXdlaWdodDo2MDAnO1xyXG4gIHRkTmFtZS50ZXh0Q29udGVudCA9IGMuY2xpZW50TmFtZSB8fCAnJztcclxuICB0ci5hcHBlbmRDaGlsZCh0ZE5hbWUpO1xyXG5cclxuICBjb25zdCB0ZExvYyA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3RkJyk7XHJcbiAgdGRMb2Muc3R5bGUuY3NzVGV4dCA9ICdwYWRkaW5nOjZweCA4cHg7Zm9udC1zaXplOjEycHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCknO1xyXG4gIHRkTG9jLnRleHRDb250ZW50ID0gYCR7Yy5wcm92aW5jaWEgfHwgJyd9LyR7Yy5sb2NhbGlkYWQgfHwgJyd9YDtcclxuICB0ci5hcHBlbmRDaGlsZCh0ZExvYyk7XHJcblxyXG4gIGNvbnN0IHRkVGlwbyA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3RkJyk7XHJcbiAgdGRUaXBvLnN0eWxlLmNzc1RleHQgPSAncGFkZGluZzo2cHggOHB4O3RleHQtYWxpZ246Y2VudGVyJztcclxuICBjb25zdCB0aXBvQmFkZ2UgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdzcGFuJyk7XHJcbiAgdGlwb0JhZGdlLnN0eWxlLmNzc1RleHQgPVxyXG4gICAgJ3BhZGRpbmc6MnB4IDZweDtib3JkZXItcmFkaXVzOjRweDtiYWNrZ3JvdW5kOnZhcigtLWJnLWlucHV0KTtmb250LXNpemU6MTFweDtmb250LXdlaWdodDo3MDAnO1xyXG4gIHRpcG9CYWRnZS50ZXh0Q29udGVudCA9IGMuY2xpVGlwbyB8fCAnLSc7XHJcbiAgdGRUaXBvLmFwcGVuZENoaWxkKHRpcG9CYWRnZSk7XHJcbiAgdHIuYXBwZW5kQ2hpbGQodGRUaXBvKTtcclxuXHJcbiAgdHIuYXBwZW5kQ2hpbGQoYnVpbGREYXRlQ2VsbChjLnVsdGltYVZpc2l0YVByZXNlbmNpYWwsIGMuZGlhc1NpblZpc2l0YVByZXNlbmNpYWwsIDMwKSk7XHJcbiAgdHIuYXBwZW5kQ2hpbGQoYnVpbGREYXRlQ2VsbChjLnVsdGltb0NvbnRhY3RvLCBjLmRpYXNTaW5Db250YWN0bywgbnVsbCkpO1xyXG4gIHRyLmFwcGVuZENoaWxkKGJ1aWxkRGF0ZUNlbGwoYy51bHRpbWFDb21wcmEsIGMuZGlhc1NpbkNvbXByYSwgOTApKTtcclxuXHJcbiAgY29uc3QgdGRGYWN0ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgndGQnKTtcclxuICB0ZEZhY3Quc3R5bGUuY3NzVGV4dCA9ICdwYWRkaW5nOjZweCA4cHg7dGV4dC1hbGlnbjpyaWdodDtmb250LXZhcmlhbnQtbnVtZXJpYzp0YWJ1bGFyLW51bXMnO1xyXG4gIHRkRmFjdC50ZXh0Q29udGVudCA9IGZtdE1vbmV5KGMuZmFjdHVyYWRvMTJNKTtcclxuICB0ci5hcHBlbmRDaGlsZCh0ZEZhY3QpO1xyXG5cclxuICBjb25zdCB0ZERldWRhID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgndGQnKTtcclxuICB0ZERldWRhLnN0eWxlLmNzc1RleHQgPSBgcGFkZGluZzo2cHggOHB4O3RleHQtYWxpZ246cmlnaHQ7Zm9udC12YXJpYW50LW51bWVyaWM6dGFidWxhci1udW1zO2NvbG9yOiR7Yy5kZXVkYUFiaWVydGEgPiAwID8gJyNkYzI2MjYnIDogJ3ZhcigtLXRleHQtbXV0ZWQpJ31gO1xyXG4gIHRkRGV1ZGEudGV4dENvbnRlbnQgPSBmbXRNb25leShjLmRldWRhQWJpZXJ0YSk7XHJcbiAgdHIuYXBwZW5kQ2hpbGQodGREZXVkYSk7XHJcblxyXG4gIHJldHVybiB0cjtcclxufVxyXG5cclxuLyoqXHJcbiAqIEBwYXJhbSB7c3RyaW5nfG51bGx9IGZlY2hhSXNvXHJcbiAqIEBwYXJhbSB7bnVtYmVyfG51bGx9IGRpYXNcclxuICogQHBhcmFtIHtudW1iZXJ8bnVsbH0gZGFuZ2VyVGhyZXNob2xkXHJcbiAqL1xyXG5mdW5jdGlvbiBidWlsZERhdGVDZWxsKGZlY2hhSXNvLCBkaWFzLCBkYW5nZXJUaHJlc2hvbGQpIHtcclxuICBjb25zdCB0ZCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3RkJyk7XHJcbiAgY29uc3QgaXNEYW5nZXIgPVxyXG4gICAgZGFuZ2VyVGhyZXNob2xkICE9PSBudWxsICYmIGRpYXMgIT09IG51bGwgJiYgZGlhcyAhPT0gdW5kZWZpbmVkICYmIGRpYXMgPiBkYW5nZXJUaHJlc2hvbGQ7XHJcbiAgdGQuc3R5bGUuY3NzVGV4dCA9IGBwYWRkaW5nOjZweCA4cHg7Y29sb3I6JHtpc0RhbmdlciA/ICcjZGMyNjI2JyA6ICd2YXIoLS10ZXh0LXByaW1hcnkpJ31gO1xyXG4gIGlmICghZmVjaGFJc28pIHtcclxuICAgIHRkLnRleHRDb250ZW50ID0gJ1x1MjAxNCc7XHJcbiAgICByZXR1cm4gdGQ7XHJcbiAgfVxyXG4gIGNvbnN0IHBhcnRzID0gU3RyaW5nKGZlY2hhSXNvKS5zcGxpdCgnLScpO1xyXG4gIGNvbnN0IGQgPSBwYXJ0c1syXSB8fCAnJztcclxuICBjb25zdCBtID0gcGFydHNbMV0gfHwgJyc7XHJcbiAgdGQudGV4dENvbnRlbnQgPSBgJHtkfS8ke219YDtcclxuICBjb25zdCBkaWFzRWwgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdzbWFsbCcpO1xyXG4gIGRpYXNFbC5zdHlsZS5jc3NUZXh0ID0gJ2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO21hcmdpbi1sZWZ0OjRweCc7XHJcbiAgZGlhc0VsLnRleHRDb250ZW50ID0gYCR7ZGlhc31kYDtcclxuICB0ZC5hcHBlbmRDaGlsZChkaWFzRWwpO1xyXG4gIHJldHVybiB0ZDtcclxufVxyXG5cclxuLyoqIEBwYXJhbSB7bnVtYmVyfSBuICovXHJcbmZ1bmN0aW9uIGZtdE1vbmV5KG4pIHtcclxuICBpZiAoIW4gfHwgbiA9PT0gMCkgcmV0dXJuICctJztcclxuICBpZiAobiA+PSAxXzAwMF8wMDApIHJldHVybiBgJCAkeyhuIC8gMV8wMDBfMDAwKS50b0ZpeGVkKDEpfU1gO1xyXG4gIGlmIChuID49IDFfMDAwKSByZXR1cm4gYCQgJHsobiAvIDFfMDAwKS50b0ZpeGVkKDApfWtgO1xyXG4gIHJldHVybiBgJCAke259YDtcclxufVxyXG5cclxuLy8gPT09IFVJIHN0YXRlIGhlbHBlcnMgPT09XHJcbmZ1bmN0aW9uIGhpZGVBbGwoKSB7XHJcbiAgY29uc3QgaWRzID0gW1xyXG4gICAgJ2NhcnRlcmEtbG9hZGluZycsXHJcbiAgICAnY2FydGVyYS10YWJsZScsXHJcbiAgICAnY2FydGVyYS1rcGlzJyxcclxuICAgICdjYXJ0ZXJhLWNoaXBzJyxcclxuICAgICdjYXJ0ZXJhLWVtcHR5JyxcclxuICBdO1xyXG4gIGZvciAoY29uc3QgaWQgb2YgaWRzKSB7XHJcbiAgICBjb25zdCBlbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKGlkKTtcclxuICAgIGlmIChlbCkgZWwuc3R5bGUuZGlzcGxheSA9ICdub25lJztcclxuICB9XHJcbn1cclxuZnVuY3Rpb24gc2hvd0VtcHR5KCkge1xyXG4gIGhpZGVBbGwoKTtcclxuICBjb25zdCBlbXB0eSA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdjYXJ0ZXJhLWVtcHR5Jyk7XHJcbiAgaWYgKGVtcHR5KSB7XHJcbiAgICBlbXB0eS5zdHlsZS5kaXNwbGF5ID0gJ2Jsb2NrJztcclxuICAgIGVtcHR5LnRleHRDb250ZW50ID0gJ0VsZWdcdTAwRUQgdW4gdmVuZGVkb3IgcGFyYSB2ZXIgc3UgY2FydGVyYS4nO1xyXG4gIH1cclxufVxyXG5mdW5jdGlvbiBzaG93TG9hZGluZygpIHtcclxuICBoaWRlQWxsKCk7XHJcbiAgY29uc3QgbG9hZGluZyA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdjYXJ0ZXJhLWxvYWRpbmcnKTtcclxuICBpZiAobG9hZGluZykgbG9hZGluZy5zdHlsZS5kaXNwbGF5ID0gJ2Jsb2NrJztcclxufVxyXG5mdW5jdGlvbiBzaG93Tm9EYXRhKCkge1xyXG4gIGhpZGVBbGwoKTtcclxuICBjb25zdCBlbXB0eSA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdjYXJ0ZXJhLWVtcHR5Jyk7XHJcbiAgaWYgKGVtcHR5KSB7XHJcbiAgICBlbXB0eS5zdHlsZS5kaXNwbGF5ID0gJ2Jsb2NrJztcclxuICAgIGVtcHR5LnRleHRDb250ZW50ID1cclxuICAgICAgJ1NpbiBjYXJ0ZXJhIHBhcmEgZXN0ZSB2ZW5kZWRvci4gVmVyaWZpY1x1MDBFMSBhc3NpZ25lZFZlbmRvciBlbiBjbGllbnRfbWFzdGVyIG8gZXNwZXJcdTAwRTEgYWwgcHJcdTAwRjN4aW1vIHNuYXBzaG90ICgwNDowMCBBUlQpLic7XHJcbiAgfVxyXG59XHJcbi8qKiBAcGFyYW0ge3N0cmluZ30gbXNnICovXHJcbmZ1bmN0aW9uIHNob3dFcnJvcihtc2cpIHtcclxuICBoaWRlQWxsKCk7XHJcbiAgY29uc3QgZW1wdHkgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY2FydGVyYS1lbXB0eScpO1xyXG4gIGlmIChlbXB0eSkge1xyXG4gICAgZW1wdHkuc3R5bGUuZGlzcGxheSA9ICdibG9jayc7XHJcbiAgICBlbXB0eS5zdHlsZS5jb2xvciA9ICcjZGMyNjI2JztcclxuICAgIGVtcHR5LnRleHRDb250ZW50ID0gYEVycm9yIGNhcmdhbmRvIGNhcnRlcmE6ICR7bXNnfWA7XHJcbiAgfVxyXG59XHJcbmZ1bmN0aW9uIHNob3dUYWJsZSgpIHtcclxuICBjb25zdCBlbXB0eSA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdjYXJ0ZXJhLWVtcHR5Jyk7XHJcbiAgaWYgKGVtcHR5KSBlbXB0eS5zdHlsZS5kaXNwbGF5ID0gJ25vbmUnO1xyXG4gIGNvbnN0IGxvYWRpbmcgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY2FydGVyYS1sb2FkaW5nJyk7XHJcbiAgaWYgKGxvYWRpbmcpIGxvYWRpbmcuc3R5bGUuZGlzcGxheSA9ICdub25lJztcclxuICBjb25zdCB0YWJsZSA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdjYXJ0ZXJhLXRhYmxlJyk7XHJcbiAgaWYgKHRhYmxlKSB0YWJsZS5zdHlsZS5kaXNwbGF5ID0gJ3RhYmxlJztcclxuICBjb25zdCBrcGlzID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2NhcnRlcmEta3BpcycpO1xyXG4gIGlmIChrcGlzKSBrcGlzLnN0eWxlLmRpc3BsYXkgPSAnZmxleCc7XHJcbiAgY29uc3QgY2hpcHMgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY2FydGVyYS1jaGlwcycpO1xyXG4gIGlmIChjaGlwcykgY2hpcHMuc3R5bGUuZGlzcGxheSA9ICdmbGV4JztcclxufVxyXG5cclxuLy8gPT09IEV4cG9ydCBFeGNlbCA9PT1cclxud2luZG93LmV4cG9ydENhcnRlcmFUb0V4Y2VsID0gYXN5bmMgZnVuY3Rpb24gZXhwb3J0Q2FydGVyYVRvRXhjZWwoKSB7XHJcbiAgaWYgKCFzZWxlY3RlZFZlbmRvcikge1xyXG4gICAgYWxlcnQoJ0VsZWdcdTAwRUQgdW4gdmVuZGVkb3IgcHJpbWVyby4nKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgY29uc3QgZG9jID0gY2FydGVyYURvY0NhY2hlLmdldChzZWxlY3RlZFZlbmRvcik7XHJcbiAgaWYgKCFkb2MpIHtcclxuICAgIGFsZXJ0KCdTaW4gZGF0YSBjYXJnYWRhLicpO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuICBjb25zdCBmaWx0ZXJlZCA9IGFwcGx5Q2hpcEZpbHRlcihkb2MuY2xpZW50ZXMsIGFjdGl2ZUNoaXApO1xyXG4gIGNvbnN0IHNlYXJjaGVkID0gc2VhcmNoUXVlcnlcclxuICAgID8gZmlsdGVyZWQuZmlsdGVyKChjKSA9PlxyXG4gICAgICAgIFN0cmluZyhjLmNsaWVudE5hbWUgfHwgJycpXHJcbiAgICAgICAgICAudG9Mb3dlckNhc2UoKVxyXG4gICAgICAgICAgLmluY2x1ZGVzKHNlYXJjaFF1ZXJ5KVxyXG4gICAgICApXHJcbiAgICA6IGZpbHRlcmVkO1xyXG4gIGNvbnN0IHNvcnRlZCA9IHNvcnRDbGllbnRlcyhzZWFyY2hlZCwgc29ydEJ5LCBzb3J0RGlyKTtcclxuXHJcbiAgY29uc3QgY2hpcExhYmVsID0gKENISVBTLmZpbmQoKGMpID0+IGMuaWQgPT09IGFjdGl2ZUNoaXApIHx8IHsgbGFiZWw6ICdUb2RvcycgfSkubGFiZWw7XHJcbiAgY29uc3QgdGl0bGUgPSBgQ2FydGVyYSBkZSAke3NlbGVjdGVkVmVuZG9yfSBcdTIwMTQgJHtjaGlwTGFiZWx9IFx1MjAxNCBTbmFwc2hvdCAke2RvYy5zbmFwc2hvdERhdGV9YDtcclxuXHJcbiAgdHJ5IHtcclxuICAgIGlmICh0eXBlb2Ygd2luZG93LmxvYWRFeGNlbEpTID09PSAnZnVuY3Rpb24nKSB7XHJcbiAgICAgIGF3YWl0IHdpbmRvdy5sb2FkRXhjZWxKUygpO1xyXG4gICAgfVxyXG4gICAgY29uc3QgRXhjZWxKUyA9IHdpbmRvdy5FeGNlbEpTO1xyXG4gICAgaWYgKCFFeGNlbEpTKSB0aHJvdyBuZXcgRXJyb3IoJ0V4Y2VsSlMgbm8gZGlzcG9uaWJsZScpO1xyXG4gICAgY29uc3Qgd2IgPSBuZXcgRXhjZWxKUy5Xb3JrYm9vaygpO1xyXG4gICAgY29uc3Qgd3MgPSB3Yi5hZGRXb3Jrc2hlZXQoJ0NhcnRlcmEnKTtcclxuXHJcbiAgICAvLyBGaWxhIDE6IHRpdHVsbyBiYW5kYSB2ZXJkZSBTaGltYW5vXHJcbiAgICB3cy5tZXJnZUNlbGxzKCdBMTpMMScpO1xyXG4gICAgY29uc3QgdGl0bGVDZWxsID0gd3MuZ2V0Q2VsbCgnQTEnKTtcclxuICAgIHRpdGxlQ2VsbC52YWx1ZSA9IHRpdGxlO1xyXG4gICAgdGl0bGVDZWxsLmZpbGwgPSB7IHR5cGU6ICdwYXR0ZXJuJywgcGF0dGVybjogJ3NvbGlkJywgZmdDb2xvcjogeyBhcmdiOiAnRkYyMkM1NUUnIH0gfTtcclxuICAgIHRpdGxlQ2VsbC5mb250ID0geyBib2xkOiB0cnVlLCBjb2xvcjogeyBhcmdiOiAnRkZGRkZGRkYnIH0sIHNpemU6IDE0IH07XHJcbiAgICB0aXRsZUNlbGwuYWxpZ25tZW50ID0geyBob3Jpem9udGFsOiAnY2VudGVyJywgdmVydGljYWw6ICdtaWRkbGUnIH07XHJcbiAgICB3cy5nZXRSb3coMSkuaGVpZ2h0ID0gMzA7XHJcblxyXG4gICAgLy8gRmlsYSAyOiBoZWFkZXJzXHJcbiAgICBjb25zdCBoZWFkZXJzID0gW1xyXG4gICAgICAnQ2xpZW50ZScsXHJcbiAgICAgICdQcm92aW5jaWEnLFxyXG4gICAgICAnTG9jYWxpZGFkJyxcclxuICAgICAgJ1RpcG8nLFxyXG4gICAgICAnXHUwMERBbHRpbWEgdmlzaXRhIHByZXNlbmNpYWwnLFxyXG4gICAgICAnXHUwMERBbHRpbW8gY29udGFjdG8nLFxyXG4gICAgICAnXHUwMERBbHRpbWEgY29tcHJhJyxcclxuICAgICAgJ0ZhY3QgMTJNIChBUlMpJyxcclxuICAgICAgJ0RldWRhIGFiaWVydGEgKEFSUyknLFxyXG4gICAgICAnRFx1MDBFRGFzIHNpbiB2aXNpdGEnLFxyXG4gICAgICAnRFx1MDBFRGFzIHNpbiBjb21wcmEnLFxyXG4gICAgICAnQ2FyZENvZGUgU0FQJyxcclxuICAgIF07XHJcbiAgICBjb25zdCBoZWFkZXJSb3cgPSB3cy5nZXRSb3coMik7XHJcbiAgICBoZWFkZXJzLmZvckVhY2goKGgsIGkpID0+IHtcclxuICAgICAgY29uc3QgY2VsbCA9IGhlYWRlclJvdy5nZXRDZWxsKGkgKyAxKTtcclxuICAgICAgY2VsbC52YWx1ZSA9IGg7XHJcbiAgICAgIGNlbGwuZmlsbCA9IHsgdHlwZTogJ3BhdHRlcm4nLCBwYXR0ZXJuOiAnc29saWQnLCBmZ0NvbG9yOiB7IGFyZ2I6ICdGRjA3NEY2OScgfSB9O1xyXG4gICAgICBjZWxsLmZvbnQgPSB7IGJvbGQ6IHRydWUsIGNvbG9yOiB7IGFyZ2I6ICdGRkZGRkZGRicgfSB9O1xyXG4gICAgICBjZWxsLmFsaWdubWVudCA9IHsgaG9yaXpvbnRhbDogJ2NlbnRlcicgfTtcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIEZpbGFzIDMrOiBkYXRhXHJcbiAgICBzb3J0ZWQuZm9yRWFjaCgoYywgaSkgPT4ge1xyXG4gICAgICBjb25zdCByb3cgPSB3cy5nZXRSb3coMyArIGkpO1xyXG4gICAgICByb3cuZ2V0Q2VsbCgxKS52YWx1ZSA9IGMuY2xpZW50TmFtZSB8fCAnJztcclxuICAgICAgcm93LmdldENlbGwoMikudmFsdWUgPSBjLnByb3ZpbmNpYSB8fCAnJztcclxuICAgICAgcm93LmdldENlbGwoMykudmFsdWUgPSBjLmxvY2FsaWRhZCB8fCAnJztcclxuICAgICAgcm93LmdldENlbGwoNCkudmFsdWUgPSBjLmNsaVRpcG8gfHwgJyc7XHJcbiAgICAgIHJvdy5nZXRDZWxsKDUpLnZhbHVlID0gYy51bHRpbWFWaXNpdGFQcmVzZW5jaWFsIHx8ICcnO1xyXG4gICAgICByb3cuZ2V0Q2VsbCg2KS52YWx1ZSA9IGMudWx0aW1vQ29udGFjdG8gfHwgJyc7XHJcbiAgICAgIHJvdy5nZXRDZWxsKDcpLnZhbHVlID0gYy51bHRpbWFDb21wcmEgfHwgJyc7XHJcbiAgICAgIHJvdy5nZXRDZWxsKDgpLnZhbHVlID0gYy5mYWN0dXJhZG8xMk0gfHwgMDtcclxuICAgICAgcm93LmdldENlbGwoOCkubnVtRm10ID0gJ1wiJFwiIywjIzAnO1xyXG4gICAgICByb3cuZ2V0Q2VsbCg5KS52YWx1ZSA9IGMuZGV1ZGFBYmllcnRhIHx8IDA7XHJcbiAgICAgIHJvdy5nZXRDZWxsKDkpLm51bUZtdCA9ICdcIiRcIiMsIyMwJztcclxuICAgICAgcm93LmdldENlbGwoMTApLnZhbHVlID0gYy5kaWFzU2luVmlzaXRhUHJlc2VuY2lhbDtcclxuICAgICAgcm93LmdldENlbGwoMTEpLnZhbHVlID0gYy5kaWFzU2luQ29tcHJhO1xyXG4gICAgICByb3cuZ2V0Q2VsbCgxMikudmFsdWUgPSBjLmNhcmRDb2RlIHx8ICcnO1xyXG4gICAgfSk7XHJcblxyXG4gICAgd3MuY29sdW1ucy5mb3JFYWNoKChjb2wsIGkpID0+IHtcclxuICAgICAgY29sLndpZHRoID0gaSA9PT0gMCA/IDMwIDogaSA9PT0gNCB8fCBpID09PSA1IHx8IGkgPT09IDYgPyAxOCA6IDE0O1xyXG4gICAgfSk7XHJcblxyXG4gICAgY29uc3QgYnVmID0gYXdhaXQgd2IueGxzeC53cml0ZUJ1ZmZlcigpO1xyXG4gICAgY29uc3QgYmxvYiA9IG5ldyBCbG9iKFtidWZdLCB7XHJcbiAgICAgIHR5cGU6ICdhcHBsaWNhdGlvbi92bmQub3BlbnhtbGZvcm1hdHMtb2ZmaWNlZG9jdW1lbnQuc3ByZWFkc2hlZXRtbC5zaGVldCcsXHJcbiAgICB9KTtcclxuICAgIGNvbnN0IHVybCA9IFVSTC5jcmVhdGVPYmplY3RVUkwoYmxvYik7XHJcbiAgICBjb25zdCBhID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnYScpO1xyXG4gICAgYS5ocmVmID0gdXJsO1xyXG4gICAgYS5kb3dubG9hZCA9IGBDYXJ0ZXJhXyR7U3RyaW5nKHNlbGVjdGVkVmVuZG9yKS5yZXBsYWNlKC9cXHMrL2csICdfJyl9XyR7YWN0aXZlQ2hpcH1fJHtkb2Muc25hcHNob3REYXRlfS54bHN4YDtcclxuICAgIGRvY3VtZW50LmJvZHkuYXBwZW5kQ2hpbGQoYSk7XHJcbiAgICBhLmNsaWNrKCk7XHJcbiAgICBhLnJlbW92ZSgpO1xyXG4gICAgVVJMLnJldm9rZU9iamVjdFVSTCh1cmwpO1xyXG4gIH0gY2F0Y2ggKGUpIHtcclxuICAgIGNvbnNvbGUuZXJyb3IoJ2V4cG9ydENhcnRlcmFUb0V4Y2VsIGZhaWxlZCcsIGUpO1xyXG4gICAgYWxlcnQoJ0Vycm9yIGV4cG9ydGFuZG86ICcgKyBTdHJpbmcoZSkpO1xyXG4gIH1cclxufTtcclxuIl0sCiAgIm1hcHBpbmdzIjogIjs7O0FBZU8sV0FBUyxnQkFBZ0IsVUFBVSxNQUFNO0FBQzlDLFFBQUks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
