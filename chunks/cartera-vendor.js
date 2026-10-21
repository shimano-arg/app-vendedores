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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL3B1cmUvY2FydGVyYS12ZW5kb3ItZmlsdGVyLmpzIiwgIi4uL3NyYy9kb21haW5zL2NhcnRlcmEtdmVuZG9yLmpzIl0sCiAgInNvdXJjZXNDb250ZW50IjogWyIvLyBAdHMtY2hlY2tcbi8qKlxuICogY2FydGVyYS12ZW5kb3ItZmlsdGVyLmpzICh2MTI4MywgMjAyNi0xMC0yMClcbiAqXG4gKiBQdXJhcyBwYXJhIGZpbHRyYXIgeSBvcmRlbmFyIGxhIHRhYmxhIGRlbCBkYXNoYm9hcmQgXCJBbmFsaXNpcyBkZSBDYXJ0ZXJhXCIuXG4gKiBJbXBvcnRhZG8gcG9yIHNyYy9kb21haW5zL2NhcnRlcmEtdmVuZG9yLmpzIChidW5kbGUgZnJvbnRlbmQpLlxuICogVGVzdGVhZG8gZW4gdGVzdHMvdW5pdC9jYXJ0ZXJhLXZlbmRvci1maWx0ZXIudGVzdC5qcy5cbiAqL1xuXG4vKipcbiAqIEFwbGljYSB1biBjaGlwIGRlIGZpbHRybyBhbCBhcnJheSBkZSBjbGllbnRlcy5cbiAqIEBwYXJhbSB7QXJyYXk8YW55Pn0gY2xpZW50ZXNcbiAqIEBwYXJhbSB7c3RyaW5nfSBjaGlwXG4gKiBAcmV0dXJucyB7QXJyYXk8YW55Pn1cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGFwcGx5Q2hpcEZpbHRlcihjbGllbnRlcywgY2hpcCkge1xuICBpZiAoIUFycmF5LmlzQXJyYXkoY2xpZW50ZXMpKSByZXR1cm4gW107XG4gIHN3aXRjaCAoY2hpcCkge1xuICAgIGNhc2UgJ2Jhc2VBY3RpdmE5MGQnOlxuICAgICAgcmV0dXJuIGNsaWVudGVzLmZpbHRlcihcbiAgICAgICAgKGMpID0+IGMuZGlhc1NpbkNvbXByYSAhPT0gbnVsbCAmJiBjLmRpYXNTaW5Db21wcmEgIT09IHVuZGVmaW5lZCAmJiBjLmRpYXNTaW5Db21wcmEgPD0gOTBcbiAgICAgICk7XG4gICAgY2FzZSAnZG9ybWlkb3NWaXNpdGEzMGQnOlxuICAgICAgcmV0dXJuIGNsaWVudGVzLmZpbHRlcihcbiAgICAgICAgKGMpID0+XG4gICAgICAgICAgYy5kaWFzU2luVmlzaXRhUHJlc2VuY2lhbCAhPT0gbnVsbCAmJlxuICAgICAgICAgIGMuZGlhc1NpblZpc2l0YVByZXNlbmNpYWwgIT09IHVuZGVmaW5lZCAmJlxuICAgICAgICAgIGMuZGlhc1NpblZpc2l0YVByZXNlbmNpYWwgPiAzMFxuICAgICAgKTtcbiAgICBjYXNlICdkb3JtaWRvc0NvbXByYTkwZCc6XG4gICAgICByZXR1cm4gY2xpZW50ZXMuZmlsdGVyKFxuICAgICAgICAoYykgPT4gYy5kaWFzU2luQ29tcHJhICE9PSBudWxsICYmIGMuZGlhc1NpbkNvbXByYSAhPT0gdW5kZWZpbmVkICYmIGMuZGlhc1NpbkNvbXByYSA+IDkwXG4gICAgICApO1xuICAgIGNhc2UgJ251bmNhVmlzaXRhZG9zJzpcbiAgICAgIHJldHVybiBjbGllbnRlcy5maWx0ZXIoXG4gICAgICAgIChjKSA9PiBjLnVsdGltYVZpc2l0YVByZXNlbmNpYWwgPT09IG51bGwgfHwgYy51bHRpbWFWaXNpdGFQcmVzZW5jaWFsID09PSB1bmRlZmluZWRcbiAgICAgICk7XG4gICAgY2FzZSAnbnVuY2FDb21wcmFyb24nOlxuICAgICAgcmV0dXJuIGNsaWVudGVzLmZpbHRlcigoYykgPT4gYy51bHRpbWFDb21wcmEgPT09IG51bGwgfHwgYy51bHRpbWFDb21wcmEgPT09IHVuZGVmaW5lZCk7XG4gICAgZGVmYXVsdDpcbiAgICAgIHJldHVybiBjbGllbnRlcy5zbGljZSgpO1xuICB9XG59XG5cbi8qKlxuICogT3JkZW5hIHVuYSBjb3BpYSBkZWwgYXJyYXkgcG9yIGNvbHVtbmEuIE51bGxzIHNpZW1wcmUgYWwgZmluYWwuXG4gKiBAcGFyYW0ge0FycmF5PGFueT59IGNsaWVudGVzXG4gKiBAcGFyYW0ge3N0cmluZ30gc29ydEJ5XG4gKiBAcGFyYW0geydhc2MnfCdkZXNjJ30gc29ydERpclxuICogQHJldHVybnMge0FycmF5PGFueT59XG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzb3J0Q2xpZW50ZXMoY2xpZW50ZXMsIHNvcnRCeSwgc29ydERpcikge1xuICBpZiAoIUFycmF5LmlzQXJyYXkoY2xpZW50ZXMpKSByZXR1cm4gW107XG4gIGNvbnN0IGRpciA9IHNvcnREaXIgPT09ICdhc2MnID8gMSA6IC0xO1xuICBjb25zdCBjb3B5ID0gY2xpZW50ZXMuc2xpY2UoKTtcbiAgY29weS5zb3J0KChhLCBiKSA9PiB7XG4gICAgY29uc3QgYXYgPSBhW3NvcnRCeV07XG4gICAgY29uc3QgYnYgPSBiW3NvcnRCeV07XG4gICAgY29uc3QgYU51bGwgPSBhdiA9PT0gbnVsbCB8fCBhdiA9PT0gdW5kZWZpbmVkO1xuICAgIGNvbnN0IGJOdWxsID0gYnYgPT09IG51bGwgfHwgYnYgPT09IHVuZGVmaW5lZDtcbiAgICBpZiAoYU51bGwgJiYgYk51bGwpIHJldHVybiAwO1xuICAgIGlmIChhTnVsbCkgcmV0dXJuIDE7XG4gICAgaWYgKGJOdWxsKSByZXR1cm4gLTE7XG4gICAgaWYgKHR5cGVvZiBhdiA9PT0gJ251bWJlcicgJiYgdHlwZW9mIGJ2ID09PSAnbnVtYmVyJykgcmV0dXJuIChhdiAtIGJ2KSAqIGRpcjtcbiAgICByZXR1cm4gU3RyaW5nKGF2KS5sb2NhbGVDb21wYXJlKFN0cmluZyhidikpICogZGlyO1xuICB9KTtcbiAgcmV0dXJuIGNvcHk7XG59XG4iLCAiLy8gQHRzLW5vY2hlY2tcbi8vIE5PVEE6IEB0cy1ub2NoZWNrIGludGVuY2lvbmFsLiBFbCBjaHVuayBlcyBoZWF2eSBET00gKyB3aW5kb3cuKiBoYW5kbGVycyArXG4vLyBGaXJlc3RvcmUgU0RLIGNvbXBhdCB2OC4gQW5vdGFyIHN0cmljdGFtZW50ZSBjYWRhIGhhbmRsZXIgc2VyXHUwMEVEYSBydWlkbyBzaW5cbi8vIHZhbG9yIFx1MjAxNCBsb3MgaGVscGVycyBwdXJvcyBxdWUgaW1wb3J0YW1vcyAoLi4vcHVyZS9jYXJ0ZXJhLXZlbmRvci1maWx0ZXIuanMpXG4vLyB5IGVsIGNvcmUgKGZ1bmN0aW9ucy9jb3JlL2NhcnRlcmEtdmVuZG9yLWNvcmUuanMpIHNcdTAwRUQgdGllbmVuIEB0cy1jaGVjay5cbi8qKlxuICogY2FydGVyYS12ZW5kb3IuanMgKHYxMjgzLCAyMDI2LTEwLTIwKSBcdTIwMTQgYnVuZGxlIGNodW5rIGxhenkuXG4gKlxuICogRGFzaGJvYXJkIFwiQW5hbGlzaXMgZGUgQ2FydGVyYSBwb3IgVmVuZGVkb3JcIi4gUmVlbXBsYXphIHNlZ3VpbWllbnRvLmpzLlxuICogTGVlIGNhcnRlcmFfdmVuZG9yL3t2ZW5kb3JLZXl9IEZpcmVzdG9yZSAoc25hcHNob3QgbmlnaHRseSAwNDowMCBBUlQpLlxuICpcbiAqIFRPRE8gZWwgRE9NIHJlbmRlciB1c2EgY3JlYXRlRWxlbWVudCArIHRleHRDb250ZW50IChwb2xpY3kgYW50aS1YU1MsIG5vIGlubmVySFRNTCkuXG4gKlxuICogU3BlYzogZG9jcy9zdXBlcnBvd2Vycy9zcGVjcy8yMDI2LTEwLTIwLWNhcnRlcmEtdmVuZG9yLWFuYWxpc2lzLWRlc2lnbi5tZFxuICogUGxhbjogZG9jcy9zdXBlcnBvd2Vycy9wbGFucy8yMDI2LTEwLTIwLWNhcnRlcmEtdmVuZG9yLWFuYWxpc2lzLm1kXG4gKi9cblxuaW1wb3J0IHsgYXBwbHlDaGlwRmlsdGVyLCBzb3J0Q2xpZW50ZXMgfSBmcm9tICcuLi9wdXJlL2NhcnRlcmEtdmVuZG9yLWZpbHRlci5qcyc7XG5cbi8qKiBAdHlwZSB7TWFwPHN0cmluZywgYW55Pn0gKi9cbmNvbnN0IGNhcnRlcmFEb2NDYWNoZSA9IG5ldyBNYXAoKTtcbi8qKiBAdHlwZSB7c3RyaW5nfG51bGx9ICovXG5sZXQgc2VsZWN0ZWRWZW5kb3IgPSBudWxsO1xubGV0IGFjdGl2ZUNoaXAgPSAndG9kb3MnO1xubGV0IHNlYXJjaFF1ZXJ5ID0gJyc7XG5sZXQgc29ydEJ5ID0gJ2RpYXNTaW5Db21wcmEnO1xuLyoqIEB0eXBlIHsnYXNjJ3wnZGVzYyd9ICovXG5sZXQgc29ydERpciA9ICdkZXNjJztcblxuY29uc3QgQ0hJUFMgPSBbXG4gIHsgaWQ6ICd0b2RvcycsIGxhYmVsOiAnVG9kb3MnIH0sXG4gIHsgaWQ6ICdiYXNlQWN0aXZhOTBkJywgbGFiZWw6ICdCYXNlIGFjdGl2YSA5MGQnIH0sXG4gIHsgaWQ6ICdkb3JtaWRvc1Zpc2l0YTMwZCcsIGxhYmVsOiAnRG9ybWlkb3MgdmlzaXRhIDMwZCcgfSxcbiAgeyBpZDogJ2Rvcm1pZG9zQ29tcHJhOTBkJywgbGFiZWw6ICdEb3JtaWRvcyBjb21wcmEgOTBkJyB9LFxuICB7IGlkOiAnbnVuY2FWaXNpdGFkb3MnLCBsYWJlbDogJ051bmNhIHZpc2l0YWRvcycgfSxcbiAgeyBpZDogJ251bmNhQ29tcHJhcm9uJywgbGFiZWw6ICdOdW5jYSBjb21wcmFyb24nIH0sXG5dO1xuXG5jb25zdCBLUElfQ0FSRFMgPSBbXG4gIHsgY2hpcDogJ3RvZG9zJywgbGFiZWw6ICdUb3RhbCBjYXJ0ZXJhJywgY29sb3I6ICcjNjQ3NDhiJyB9LFxuICB7IGNoaXA6ICdiYXNlQWN0aXZhOTBkJywgbGFiZWw6ICdCYXNlIGFjdGl2YSA5MGQnLCBjb2xvcjogJyMxNmEzNGEnIH0sXG4gIHsgY2hpcDogJ2Rvcm1pZG9zVmlzaXRhMzBkJywgbGFiZWw6ICdEb3JtaWRvcyB2aXMgMzBkJywgY29sb3I6ICcjZWE1ODBjJyB9LFxuICB7IGNoaXA6ICdkb3JtaWRvc0NvbXByYTkwZCcsIGxhYmVsOiAnRG9ybWlkb3MgY29tIDkwZCcsIGNvbG9yOiAnI2RjMjYyNicgfSxcbiAgeyBjaGlwOiAnbnVuY2FWaXNpdGFkb3MnLCBsYWJlbDogJ051bmNhIHZpc2l0YWRvcycsIGNvbG9yOiAnIzdjM2FlZCcgfSxcbiAgeyBjaGlwOiAnbnVuY2FDb21wcmFyb24nLCBsYWJlbDogJ051bmNhIGNvbXByYXJvbicsIGNvbG9yOiAnI2JlMTg1ZCcgfSxcbl07XG5cbi8vID09PSBPcGVuIC8gY2xvc2UgPT09XG53aW5kb3cub3BlbkNhcnRlcmFNb2RhbCA9IGFzeW5jIGZ1bmN0aW9uIG9wZW5DYXJ0ZXJhTW9kYWwoKSB7XG4gIGNvbnN0IG1vZGFsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2NhcnRlcmEtbW9kYWwnKTtcbiAgaWYgKCFtb2RhbCkgcmV0dXJuO1xuICBtb2RhbC5jbGFzc0xpc3QuYWRkKCdvcGVuJyk7XG4gIGF3YWl0IHBvcHVsYXRlVmVuZG9yRHJvcGRvd24oKTtcbn07XG5cbndpbmRvdy5jbG9zZUNhcnRlcmFNb2RhbCA9IGZ1bmN0aW9uIGNsb3NlQ2FydGVyYU1vZGFsKCkge1xuICBjb25zdCBtb2RhbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdjYXJ0ZXJhLW1vZGFsJyk7XG4gIGlmIChtb2RhbCkgbW9kYWwuY2xhc3NMaXN0LnJlbW92ZSgnb3BlbicpO1xufTtcblxuLy8gPT09IERyb3Bkb3duIGRlIHZlbmRvcnMgPT09XG5hc3luYyBmdW5jdGlvbiBwb3B1bGF0ZVZlbmRvckRyb3Bkb3duKCkge1xuICBjb25zdCBzZWwgPSAvKiogQHR5cGUge0hUTUxTZWxlY3RFbGVtZW50fG51bGx9ICovIChcbiAgICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY2FydGVyYS12ZW5kb3Itc2VsZWN0JylcbiAgKTtcbiAgaWYgKCFzZWwpIHJldHVybjtcbiAgaWYgKHNlbC5vcHRpb25zLmxlbmd0aCA+IDEpIHJldHVybjtcbiAgdHJ5IHtcbiAgICAvLyBAdHMtZXhwZWN0LWVycm9yXG4gICAgY29uc3Qgc25hcCA9IGF3YWl0IGZpcmViYXNlLmZpcmVzdG9yZSgpLmNvbGxlY3Rpb24oJ2NhcnRlcmFfdmVuZG9yJykuZ2V0KCk7XG4gICAgLyoqIEB0eXBlIHtzdHJpbmdbXX0gKi9cbiAgICBjb25zdCB2ZW5kb3JzID0gW107XG4gICAgc25hcC5mb3JFYWNoKChkb2MpID0+IHZlbmRvcnMucHVzaChkb2MuaWQpKTtcbiAgICB2ZW5kb3JzLnNvcnQoKTtcbiAgICBmb3IgKGNvbnN0IHYgb2YgdmVuZG9ycykge1xuICAgICAgY29uc3Qgb3B0ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnb3B0aW9uJyk7XG4gICAgICBvcHQudmFsdWUgPSB2O1xuICAgICAgb3B0LnRleHRDb250ZW50ID0gdjtcbiAgICAgIHNlbC5hcHBlbmRDaGlsZChvcHQpO1xuICAgIH1cbiAgfSBjYXRjaCAoZSkge1xuICAgIGNvbnNvbGUuZXJyb3IoJ3BvcHVsYXRlVmVuZG9yRHJvcGRvd24gZmFpbGVkJywgZSk7XG4gIH1cbn1cblxuLy8gPT09IE9uIHZlbmRvciBjaGFuZ2UgPT09XG53aW5kb3cub25DYXJ0ZXJhVmVuZG9yQ2hhbmdlID0gYXN5bmMgZnVuY3Rpb24gb25DYXJ0ZXJhVmVuZG9yQ2hhbmdlKCkge1xuICBjb25zdCBzZWwgPSAvKiogQHR5cGUge0hUTUxTZWxlY3RFbGVtZW50fG51bGx9ICovIChcbiAgICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY2FydGVyYS12ZW5kb3Itc2VsZWN0JylcbiAgKTtcbiAgaWYgKCFzZWwpIHJldHVybjtcbiAgc2VsZWN0ZWRWZW5kb3IgPSBzZWwudmFsdWUgfHwgbnVsbDtcbiAgYWN0aXZlQ2hpcCA9ICd0b2Rvcyc7XG4gIHNlYXJjaFF1ZXJ5ID0gJyc7XG4gIGNvbnN0IHNlYXJjaElucHV0ID0gLyoqIEB0eXBlIHtIVE1MSW5wdXRFbGVtZW50fG51bGx9ICovIChcbiAgICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY2FydGVyYS1zZWFyY2gnKVxuICApO1xuICBpZiAoc2VhcmNoSW5wdXQpIHNlYXJjaElucHV0LnZhbHVlID0gJyc7XG4gIGlmICghc2VsZWN0ZWRWZW5kb3IpIHtcbiAgICBzaG93RW1wdHkoKTtcbiAgICByZXR1cm47XG4gIH1cbiAgc2hvd0xvYWRpbmcoKTtcbiAgdHJ5IHtcbiAgICBsZXQgZG9jID0gY2FydGVyYURvY0NhY2hlLmdldChzZWxlY3RlZFZlbmRvcik7XG4gICAgaWYgKCFkb2MpIHtcbiAgICAgIC8vIEB0cy1leHBlY3QtZXJyb3JcbiAgICAgIGNvbnN0IHNuYXAgPSBhd2FpdCBmaXJlYmFzZVxuICAgICAgICAuZmlyZXN0b3JlKClcbiAgICAgICAgLmNvbGxlY3Rpb24oJ2NhcnRlcmFfdmVuZG9yJylcbiAgICAgICAgLmRvYyhzZWxlY3RlZFZlbmRvcilcbiAgICAgICAgLmdldCgpO1xuICAgICAgaWYgKCFzbmFwLmV4aXN0cykge1xuICAgICAgICBzaG93Tm9EYXRhKCk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIGRvYyA9IHNuYXAuZGF0YSgpO1xuICAgICAgY2FydGVyYURvY0NhY2hlLnNldChzZWxlY3RlZFZlbmRvciwgZG9jKTtcbiAgICB9XG4gICAgcmVuZGVyRGFzaGJvYXJkKGRvYyk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBjb25zb2xlLmVycm9yKCdvbkNhcnRlcmFWZW5kb3JDaGFuZ2UgZmFpbGVkJywgZSk7XG4gICAgc2hvd0Vycm9yKFN0cmluZyhlKSk7XG4gIH1cbn07XG5cbi8qKiBAdHlwZSB7YW55fSAqLyAod2luZG93KS5vbkNhcnRlcmFDaGlwQ2xpY2sgPSBmdW5jdGlvbiBvbkNhcnRlcmFDaGlwQ2xpY2soY2hpcElkKSB7XG4gIGFjdGl2ZUNoaXAgPSBjaGlwSWQ7XG4gIGlmICghc2VsZWN0ZWRWZW5kb3IpIHJldHVybjtcbiAgY29uc3QgZG9jID0gY2FydGVyYURvY0NhY2hlLmdldChzZWxlY3RlZFZlbmRvcik7XG4gIGlmIChkb2MpIHJlbmRlckRhc2hib2FyZChkb2MpO1xufTtcblxuLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBzZXRUaW1lb3V0PnxudWxsfSAqL1xubGV0IHNlYXJjaERlYm91bmNlVGltZXIgPSBudWxsO1xud2luZG93Lm9uQ2FydGVyYVNlYXJjaENoYW5nZSA9IGZ1bmN0aW9uIG9uQ2FydGVyYVNlYXJjaENoYW5nZSgpIHtcbiAgY29uc3QgaW5wdXQgPSAvKiogQHR5cGUge0hUTUxJbnB1dEVsZW1lbnR8bnVsbH0gKi8gKGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdjYXJ0ZXJhLXNlYXJjaCcpKTtcbiAgaWYgKCFpbnB1dCkgcmV0dXJuO1xuICBpZiAoc2VhcmNoRGVib3VuY2VUaW1lcikgY2xlYXJUaW1lb3V0KHNlYXJjaERlYm91bmNlVGltZXIpO1xuICBzZWFyY2hEZWJvdW5jZVRpbWVyID0gc2V0VGltZW91dCgoKSA9PiB7XG4gICAgc2VhcmNoUXVlcnkgPSAoaW5wdXQudmFsdWUgfHwgJycpLnRyaW0oKS50b0xvd2VyQ2FzZSgpO1xuICAgIGlmICghc2VsZWN0ZWRWZW5kb3IpIHJldHVybjtcbiAgICBjb25zdCBkb2MgPSBjYXJ0ZXJhRG9jQ2FjaGUuZ2V0KHNlbGVjdGVkVmVuZG9yKTtcbiAgICBpZiAoZG9jKSByZW5kZXJEYXNoYm9hcmQoZG9jKTtcbiAgfSwgMzAwKTtcbn07XG5cbi8qKiBAdHlwZSB7YW55fSAqLyAod2luZG93KS5vbkNhcnRlcmFTb3J0Q2xpY2sgPSBmdW5jdGlvbiBvbkNhcnRlcmFTb3J0Q2xpY2soY29sS2V5KSB7XG4gIGlmIChzb3J0QnkgPT09IGNvbEtleSkgc29ydERpciA9IHNvcnREaXIgPT09ICdhc2MnID8gJ2Rlc2MnIDogJ2FzYyc7XG4gIGVsc2Uge1xuICAgIHNvcnRCeSA9IGNvbEtleTtcbiAgICBzb3J0RGlyID0gJ2Rlc2MnO1xuICB9XG4gIGlmICghc2VsZWN0ZWRWZW5kb3IpIHJldHVybjtcbiAgY29uc3QgZG9jID0gY2FydGVyYURvY0NhY2hlLmdldChzZWxlY3RlZFZlbmRvcik7XG4gIGlmIChkb2MpIHJlbmRlckRhc2hib2FyZChkb2MpO1xufTtcblxuLy8gPT09IFJlbmRlciA9PT1cbmZ1bmN0aW9uIHJlbmRlckRhc2hib2FyZChkb2MpIHtcbiAgY29uc3Qgc3VidGl0bGUgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY2FydGVyYS1zdWJ0aXRsZScpO1xuICBpZiAoc3VidGl0bGUpIHN1YnRpdGxlLnRleHRDb250ZW50ID0gYCR7ZG9jLmNvdW50cy50b3RhbH0gY2xpZW50ZXMgZW4gY2FydGVyYS5gO1xuICBjb25zdCBpbmZvID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2NhcnRlcmEtc25hcHNob3QtaW5mbycpO1xuICBpZiAoaW5mbykge1xuICAgIGluZm8udGV4dENvbnRlbnQgPSBgU25hcHNob3QgJHtkb2Muc25hcHNob3REYXRlfWA7XG4gICAgaW5mby5zdHlsZS5kaXNwbGF5ID0gJ2lubGluZS1mbGV4JztcbiAgfVxuICByZW5kZXJLcGlzKGRvYy5jb3VudHMpO1xuICByZW5kZXJDaGlwcyhkb2MuY291bnRzKTtcbiAgcmVuZGVyVGFibGUoZG9jLmNsaWVudGVzKTtcbiAgc2hvd1RhYmxlKCk7XG59XG5cbmZ1bmN0aW9uIHJlbmRlcktwaXMoY291bnRzKSB7XG4gIGNvbnN0IGVsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2NhcnRlcmEta3BpcycpO1xuICBpZiAoIWVsKSByZXR1cm47XG4gIHdoaWxlIChlbC5maXJzdENoaWxkKSBlbC5yZW1vdmVDaGlsZChlbC5maXJzdENoaWxkKTtcbiAgLy8gdjEzODM6IEFwcGxlLXN0eWxlIEtQSSBjYXJkcy4gQ2xhc2VzIC5jYXJ0ZXJhLWtwaSBkZWZpbmlkYXMgZW4gaW5kZXguaHRtbC5cbiAgLy8gQ29sb3Igc2UgYXBsaWNhIHNvbG8gYWwgblx1MDBGQW1lcm8gKyB1bmRlcmxpbmUgKHN1dGlsIGlkZW50aWRhZCBwb3IgY2F0ZWdvclx1MDBFRGEpLlxuICBmb3IgKGNvbnN0IHNwZWMgb2YgS1BJX0NBUkRTKSB7XG4gICAgY29uc3QgY2FyZCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpO1xuICAgIGNhcmQuY2xhc3NOYW1lID0gJ2NhcnRlcmEta3BpJztcbiAgICBpZiAoYWN0aXZlQ2hpcCA9PT0gc3BlYy5jaGlwKSBjYXJkLmNsYXNzTGlzdC5hZGQoJ2FjdGl2ZScpO1xuICAgIGNhcmQuc3R5bGUuY29sb3IgPSBzcGVjLmNvbG9yOyAvLyBjdXJyZW50Q29sb3IgcGFyYSBlbCBudW1iZXIgKyA6OmFmdGVyIHVuZGVybGluZVxuICAgIGNhcmQuYWRkRXZlbnRMaXN0ZW5lcignY2xpY2snLCAoKSA9PiAvKiogQHR5cGUge2FueX0gKi8gKHdpbmRvdykub25DYXJ0ZXJhQ2hpcENsaWNrKHNwZWMuY2hpcCkpO1xuICAgIGNvbnN0IG4gPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKTtcbiAgICBuLmNsYXNzTmFtZSA9ICdjYXJ0ZXJhLWtwaS1udW0nO1xuICAgIG4udGV4dENvbnRlbnQgPSBTdHJpbmcoY291bnRzW3NwZWMuY2hpcCA9PT0gJ3RvZG9zJyA/ICd0b3RhbCcgOiBzcGVjLmNoaXBdKTtcbiAgICBjb25zdCBsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2Jyk7XG4gICAgbC5jbGFzc05hbWUgPSAnY2FydGVyYS1rcGktbGFiZWwnO1xuICAgIGwuc3R5bGUuY29sb3IgPSAnJzsgLy8gcmVzZXQgY3VycmVudENvbG9yIHBhcmEgcXVlIHVzZSBlbCBtdXRlZCBkZWwgQ1NTXG4gICAgbC50ZXh0Q29udGVudCA9IHNwZWMubGFiZWw7XG4gICAgY2FyZC5hcHBlbmRDaGlsZChuKTtcbiAgICBjYXJkLmFwcGVuZENoaWxkKGwpO1xuICAgIGVsLmFwcGVuZENoaWxkKGNhcmQpO1xuICB9XG59XG5cbmZ1bmN0aW9uIHJlbmRlckNoaXBzKGNvdW50cykge1xuICBjb25zdCBlbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdjYXJ0ZXJhLWNoaXBzJyk7XG4gIGlmICghZWwpIHJldHVybjtcbiAgY29uc3QgY291bnRCeUNoaXAgPSB7XG4gICAgdG9kb3M6IGNvdW50cy50b3RhbCxcbiAgICBiYXNlQWN0aXZhOTBkOiBjb3VudHMuYmFzZUFjdGl2YTkwZCxcbiAgICBkb3JtaWRvc1Zpc2l0YTMwZDogY291bnRzLmRvcm1pZG9zVmlzaXRhMzBkLFxuICAgIGRvcm1pZG9zQ29tcHJhOTBkOiBjb3VudHMuZG9ybWlkb3NDb21wcmE5MGQsXG4gICAgbnVuY2FWaXNpdGFkb3M6IGNvdW50cy5udW5jYVZpc2l0YWRvcyxcbiAgICBudW5jYUNvbXByYXJvbjogY291bnRzLm51bmNhQ29tcHJhcm9uLFxuICB9O1xuICB3aGlsZSAoZWwuZmlyc3RDaGlsZCkgZWwucmVtb3ZlQ2hpbGQoZWwuZmlyc3RDaGlsZCk7XG4gIC8vIHYxMzgzOiBzZWdtZW50ZWQgY29udHJvbCBpT1MuIFdyYXBwZXIgLmNhcnRlcmEtY2hpcC13cmFwIGFncnVwYSBwaWxscyBjb24gYmcgZ3Jpcy5cbiAgY29uc3Qgd3JhcCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpO1xuICB3cmFwLmNsYXNzTmFtZSA9ICdjYXJ0ZXJhLWNoaXAtd3JhcCc7XG4gIGZvciAoY29uc3QgY2hpcCBvZiBDSElQUykge1xuICAgIGNvbnN0IGIgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdidXR0b24nKTtcbiAgICBiLmNsYXNzTmFtZSA9ICdjYXJ0ZXJhLWNoaXAnO1xuICAgIGlmIChhY3RpdmVDaGlwID09PSBjaGlwLmlkKSBiLmNsYXNzTGlzdC5hZGQoJ2FjdGl2ZScpO1xuICAgIGIudHlwZSA9ICdidXR0b24nO1xuICAgIGIudGV4dENvbnRlbnQgPSBgJHtjaGlwLmxhYmVsfSAoJHtjb3VudEJ5Q2hpcFtjaGlwLmlkXX0pYDtcbiAgICBiLmFkZEV2ZW50TGlzdGVuZXIoJ2NsaWNrJywgKCkgPT4gLyoqIEB0eXBlIHthbnl9ICovICh3aW5kb3cpLm9uQ2FydGVyYUNoaXBDbGljayhjaGlwLmlkKSk7XG4gICAgd3JhcC5hcHBlbmRDaGlsZChiKTtcbiAgfVxuICBlbC5hcHBlbmRDaGlsZCh3cmFwKTtcbn1cblxuLyoqIEBwYXJhbSB7QXJyYXk8YW55Pn0gY2xpZW50ZXMgKi9cbmZ1bmN0aW9uIHJlbmRlclRhYmxlKGNsaWVudGVzKSB7XG4gIGNvbnN0IHRhYmxlID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2NhcnRlcmEtdGFibGUnKTtcbiAgaWYgKCF0YWJsZSkgcmV0dXJuO1xuICBjb25zdCBmaWx0ZXJlZCA9IGFwcGx5Q2hpcEZpbHRlcihjbGllbnRlcywgYWN0aXZlQ2hpcCk7XG4gIGNvbnN0IHNlYXJjaGVkID0gc2VhcmNoUXVlcnlcbiAgICA/IGZpbHRlcmVkLmZpbHRlcigoYykgPT5cbiAgICAgICAgU3RyaW5nKGMuY2xpZW50TmFtZSB8fCAnJylcbiAgICAgICAgICAudG9Mb3dlckNhc2UoKVxuICAgICAgICAgIC5pbmNsdWRlcyhzZWFyY2hRdWVyeSlcbiAgICAgIClcbiAgICA6IGZpbHRlcmVkO1xuICBjb25zdCBzb3J0ZWQgPSBzb3J0Q2xpZW50ZXMoc2VhcmNoZWQsIHNvcnRCeSwgc29ydERpcik7XG4gIHdoaWxlICh0YWJsZS5maXJzdENoaWxkKSB0YWJsZS5yZW1vdmVDaGlsZCh0YWJsZS5maXJzdENoaWxkKTtcbiAgdGFibGUuYXBwZW5kQ2hpbGQoYnVpbGRUaGVhZCgpKTtcbiAgdGFibGUuYXBwZW5kQ2hpbGQoYnVpbGRUYm9keShzb3J0ZWQpKTtcbn1cblxuZnVuY3Rpb24gYnVpbGRUaGVhZCgpIHtcbiAgLy8gdjEzODM6IEFwcGxlLXN0eWxlIHRoZWFkLiBDbGFzZXMgLmNhcnRlcmEtKiBlbiBpbmRleC5odG1sIGNvbnRyb2xhbiBiZy9jb2xvcnMuXG4gIGNvbnN0IHRoZWFkID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgndGhlYWQnKTtcbiAgY29uc3QgdHIgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCd0cicpO1xuICBjb25zdCBoZWFkZXJzID0gW1xuICAgIHsgbGFiZWw6ICdDbGllbnRlJywgc29ydEtleTogJ2NsaWVudE5hbWUnLCBhbGlnbjogJ2xlZnQnIH0sXG4gICAgeyBsYWJlbDogJ1Byb3YvTG9jJywgc29ydEtleTogbnVsbCwgYWxpZ246ICdsZWZ0JyB9LFxuICAgIHsgbGFiZWw6ICdUaXBvJywgc29ydEtleTogbnVsbCwgYWxpZ246ICdjZW50ZXInIH0sXG4gICAgeyBsYWJlbDogJ1x1MDBEQWx0LiB2aXNpdGEnLCBzb3J0S2V5OiAnZGlhc1NpblZpc2l0YVByZXNlbmNpYWwnLCBhbGlnbjogJ2xlZnQnIH0sXG4gICAgeyBsYWJlbDogJ1x1MDBEQWx0LiBjb250YWN0bycsIHNvcnRLZXk6ICdkaWFzU2luQ29udGFjdG8nLCBhbGlnbjogJ2xlZnQnIH0sXG4gICAgeyBsYWJlbDogJ1x1MDBEQWx0LiBjb21wcmEnLCBzb3J0S2V5OiAnZGlhc1NpbkNvbXByYScsIGFsaWduOiAnbGVmdCcgfSxcbiAgICB7IGxhYmVsOiAnRmFjdCAxMk0nLCBzb3J0S2V5OiAnZmFjdHVyYWRvMTJNJywgYWxpZ246ICdyaWdodCcgfSxcbiAgICB7IGxhYmVsOiAnRGV1ZGEnLCBzb3J0S2V5OiAnZGV1ZGFBYmllcnRhJywgYWxpZ246ICdyaWdodCcgfSxcbiAgXTtcbiAgZm9yIChjb25zdCBoIG9mIGhlYWRlcnMpIHtcbiAgICBjb25zdCB0aCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3RoJyk7XG4gICAgdGguc3R5bGUudGV4dEFsaWduID0gaC5hbGlnbjtcbiAgICB0aC50ZXh0Q29udGVudCA9IGgubGFiZWw7XG4gICAgaWYgKGguc29ydEtleSkge1xuICAgICAgdGguc3R5bGUuY3Vyc29yID0gJ3BvaW50ZXInO1xuICAgICAgY29uc3Qga2V5ID0gaC5zb3J0S2V5O1xuICAgICAgdGguYWRkRXZlbnRMaXN0ZW5lcignY2xpY2snLCAoKSA9PiAvKiogQHR5cGUge2FueX0gKi8gKHdpbmRvdykub25DYXJ0ZXJhU29ydENsaWNrKGtleSkpO1xuICAgIH1cbiAgICB0ci5hcHBlbmRDaGlsZCh0aCk7XG4gIH1cbiAgdGhlYWQuYXBwZW5kQ2hpbGQodHIpO1xuICByZXR1cm4gdGhlYWQ7XG59XG5cbi8qKiBAcGFyYW0ge0FycmF5PGFueT59IHNvcnRlZENsaWVudGVzICovXG5mdW5jdGlvbiBidWlsZFRib2R5KHNvcnRlZENsaWVudGVzKSB7XG4gIGNvbnN0IHRib2R5ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgndGJvZHknKTtcbiAgZm9yIChjb25zdCBjIG9mIHNvcnRlZENsaWVudGVzKSB7XG4gICAgdGJvZHkuYXBwZW5kQ2hpbGQoYnVpbGRDbGllbnRlUm93KGMpKTtcbiAgfVxuICByZXR1cm4gdGJvZHk7XG59XG5cbi8qKiBAcGFyYW0ge2FueX0gYyAqL1xuZnVuY3Rpb24gYnVpbGRDbGllbnRlUm93KGMpIHtcbiAgY29uc3QgdHIgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCd0cicpO1xuICB0ci5zdHlsZS5jc3NUZXh0ID0gJ2N1cnNvcjpwb2ludGVyO2JvcmRlci1ib3R0b206MXB4IHNvbGlkIHZhcigtLWJvcmRlci1saWdodCknO1xuICB0ci5hZGRFdmVudExpc3RlbmVyKCdtb3VzZWVudGVyJywgKCkgPT4ge1xuICAgIHRyLnN0eWxlLmJhY2tncm91bmQgPSAndmFyKC0tYmctaG92ZXIpJztcbiAgfSk7XG4gIHRyLmFkZEV2ZW50TGlzdGVuZXIoJ21vdXNlbGVhdmUnLCAoKSA9PiB7XG4gICAgdHIuc3R5bGUuYmFja2dyb3VuZCA9ICcnO1xuICB9KTtcbiAgdHIuYWRkRXZlbnRMaXN0ZW5lcignY2xpY2snLCAoKSA9PiB7XG4gICAgLy8gQHRzLWV4cGVjdC1lcnJvclxuICAgIGlmICh0eXBlb2Ygd2luZG93Lm9wZW5GaWNoYUNsaWVudGUgPT09ICdmdW5jdGlvbicpIHdpbmRvdy5vcGVuRmljaGFDbGllbnRlKGMuY2xpZW50SWQpO1xuICB9KTtcblxuICBjb25zdCB0ZE5hbWUgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCd0ZCcpO1xuICB0ZE5hbWUuc3R5bGUuY3NzVGV4dCA9ICdwYWRkaW5nOjZweCA4cHg7Zm9udC13ZWlnaHQ6NjAwJztcbiAgdGROYW1lLnRleHRDb250ZW50ID0gYy5jbGllbnROYW1lIHx8ICcnO1xuICB0ci5hcHBlbmRDaGlsZCh0ZE5hbWUpO1xuXG4gIGNvbnN0IHRkTG9jID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgndGQnKTtcbiAgdGRMb2Muc3R5bGUuY3NzVGV4dCA9ICdwYWRkaW5nOjZweCA4cHg7Zm9udC1zaXplOjEycHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCknO1xuICB0ZExvYy50ZXh0Q29udGVudCA9IGAke2MucHJvdmluY2lhIHx8ICcnfS8ke2MubG9jYWxpZGFkIHx8ICcnfWA7XG4gIHRyLmFwcGVuZENoaWxkKHRkTG9jKTtcblxuICBjb25zdCB0ZFRpcG8gPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCd0ZCcpO1xuICB0ZFRpcG8uc3R5bGUuY3NzVGV4dCA9ICdwYWRkaW5nOjZweCA4cHg7dGV4dC1hbGlnbjpjZW50ZXInO1xuICBjb25zdCB0aXBvQmFkZ2UgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdzcGFuJyk7XG4gIHRpcG9CYWRnZS5zdHlsZS5jc3NUZXh0ID1cbiAgICAncGFkZGluZzoycHggNnB4O2JvcmRlci1yYWRpdXM6NHB4O2JhY2tncm91bmQ6dmFyKC0tYmctaW5wdXQpO2ZvbnQtc2l6ZToxMXB4O2ZvbnQtd2VpZ2h0OjcwMCc7XG4gIHRpcG9CYWRnZS50ZXh0Q29udGVudCA9IGMuY2xpVGlwbyB8fCAnLSc7XG4gIHRkVGlwby5hcHBlbmRDaGlsZCh0aXBvQmFkZ2UpO1xuICB0ci5hcHBlbmRDaGlsZCh0ZFRpcG8pO1xuXG4gIHRyLmFwcGVuZENoaWxkKGJ1aWxkRGF0ZUNlbGwoYy51bHRpbWFWaXNpdGFQcmVzZW5jaWFsLCBjLmRpYXNTaW5WaXNpdGFQcmVzZW5jaWFsLCAzMCkpO1xuICB0ci5hcHBlbmRDaGlsZChidWlsZERhdGVDZWxsKGMudWx0aW1vQ29udGFjdG8sIGMuZGlhc1NpbkNvbnRhY3RvLCBudWxsKSk7XG4gIHRyLmFwcGVuZENoaWxkKGJ1aWxkRGF0ZUNlbGwoYy51bHRpbWFDb21wcmEsIGMuZGlhc1NpbkNvbXByYSwgOTApKTtcblxuICBjb25zdCB0ZEZhY3QgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCd0ZCcpO1xuICB0ZEZhY3Quc3R5bGUuY3NzVGV4dCA9ICdwYWRkaW5nOjZweCA4cHg7dGV4dC1hbGlnbjpyaWdodDtmb250LXZhcmlhbnQtbnVtZXJpYzp0YWJ1bGFyLW51bXMnO1xuICB0ZEZhY3QudGV4dENvbnRlbnQgPSBmbXRNb25leShjLmZhY3R1cmFkbzEyTSk7XG4gIHRyLmFwcGVuZENoaWxkKHRkRmFjdCk7XG5cbiAgY29uc3QgdGREZXVkYSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3RkJyk7XG4gIHRkRGV1ZGEuc3R5bGUuY3NzVGV4dCA9IGBwYWRkaW5nOjZweCA4cHg7dGV4dC1hbGlnbjpyaWdodDtmb250LXZhcmlhbnQtbnVtZXJpYzp0YWJ1bGFyLW51bXM7Y29sb3I6JHtjLmRldWRhQWJpZXJ0YSA+IDAgPyAnI2RjMjYyNicgOiAndmFyKC0tdGV4dC1tdXRlZCknfWA7XG4gIHRkRGV1ZGEudGV4dENvbnRlbnQgPSBmbXRNb25leShjLmRldWRhQWJpZXJ0YSk7XG4gIHRyLmFwcGVuZENoaWxkKHRkRGV1ZGEpO1xuXG4gIHJldHVybiB0cjtcbn1cblxuLyoqXG4gKiBAcGFyYW0ge3N0cmluZ3xudWxsfSBmZWNoYUlzb1xuICogQHBhcmFtIHtudW1iZXJ8bnVsbH0gZGlhc1xuICogQHBhcmFtIHtudW1iZXJ8bnVsbH0gZGFuZ2VyVGhyZXNob2xkXG4gKi9cbmZ1bmN0aW9uIGJ1aWxkRGF0ZUNlbGwoZmVjaGFJc28sIGRpYXMsIGRhbmdlclRocmVzaG9sZCkge1xuICBjb25zdCB0ZCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3RkJyk7XG4gIGNvbnN0IGlzRGFuZ2VyID1cbiAgICBkYW5nZXJUaHJlc2hvbGQgIT09IG51bGwgJiYgZGlhcyAhPT0gbnVsbCAmJiBkaWFzICE9PSB1bmRlZmluZWQgJiYgZGlhcyA+IGRhbmdlclRocmVzaG9sZDtcbiAgdGQuc3R5bGUuY3NzVGV4dCA9IGBwYWRkaW5nOjZweCA4cHg7Y29sb3I6JHtpc0RhbmdlciA/ICcjZGMyNjI2JyA6ICd2YXIoLS10ZXh0LXByaW1hcnkpJ31gO1xuICBpZiAoIWZlY2hhSXNvKSB7XG4gICAgdGQudGV4dENvbnRlbnQgPSAnXHUyMDE0JztcbiAgICByZXR1cm4gdGQ7XG4gIH1cbiAgY29uc3QgcGFydHMgPSBTdHJpbmcoZmVjaGFJc28pLnNwbGl0KCctJyk7XG4gIGNvbnN0IGQgPSBwYXJ0c1syXSB8fCAnJztcbiAgY29uc3QgbSA9IHBhcnRzWzFdIHx8ICcnO1xuICB0ZC50ZXh0Q29udGVudCA9IGAke2R9LyR7bX1gO1xuICBjb25zdCBkaWFzRWwgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdzbWFsbCcpO1xuICBkaWFzRWwuc3R5bGUuY3NzVGV4dCA9ICdjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTttYXJnaW4tbGVmdDo0cHgnO1xuICBkaWFzRWwudGV4dENvbnRlbnQgPSBgJHtkaWFzfWRgO1xuICB0ZC5hcHBlbmRDaGlsZChkaWFzRWwpO1xuICByZXR1cm4gdGQ7XG59XG5cbi8qKiBAcGFyYW0ge251bWJlcn0gbiAqL1xuZnVuY3Rpb24gZm10TW9uZXkobikge1xuICBpZiAoIW4gfHwgbiA9PT0gMCkgcmV0dXJuICctJztcbiAgaWYgKG4gPj0gMV8wMDBfMDAwKSByZXR1cm4gYCQgJHsobiAvIDFfMDAwXzAwMCkudG9GaXhlZCgxKX1NYDtcbiAgaWYgKG4gPj0gMV8wMDApIHJldHVybiBgJCAkeyhuIC8gMV8wMDApLnRvRml4ZWQoMCl9a2A7XG4gIHJldHVybiBgJCAke259YDtcbn1cblxuLy8gPT09IFVJIHN0YXRlIGhlbHBlcnMgPT09XG5mdW5jdGlvbiBoaWRlQWxsKCkge1xuICBjb25zdCBpZHMgPSBbXG4gICAgJ2NhcnRlcmEtbG9hZGluZycsXG4gICAgJ2NhcnRlcmEtdGFibGUnLFxuICAgICdjYXJ0ZXJhLWtwaXMnLFxuICAgICdjYXJ0ZXJhLWNoaXBzJyxcbiAgICAnY2FydGVyYS1lbXB0eScsXG4gIF07XG4gIGZvciAoY29uc3QgaWQgb2YgaWRzKSB7XG4gICAgY29uc3QgZWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZChpZCk7XG4gICAgaWYgKGVsKSBlbC5zdHlsZS5kaXNwbGF5ID0gJ25vbmUnO1xuICB9XG59XG5mdW5jdGlvbiBzaG93RW1wdHkoKSB7XG4gIGhpZGVBbGwoKTtcbiAgY29uc3QgZW1wdHkgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY2FydGVyYS1lbXB0eScpO1xuICBpZiAoZW1wdHkpIHtcbiAgICBlbXB0eS5zdHlsZS5kaXNwbGF5ID0gJ2Jsb2NrJztcbiAgICBlbXB0eS50ZXh0Q29udGVudCA9ICdFbGVnXHUwMEVEIHVuIHZlbmRlZG9yIHBhcmEgdmVyIHN1IGNhcnRlcmEuJztcbiAgfVxufVxuZnVuY3Rpb24gc2hvd0xvYWRpbmcoKSB7XG4gIGhpZGVBbGwoKTtcbiAgY29uc3QgbG9hZGluZyA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdjYXJ0ZXJhLWxvYWRpbmcnKTtcbiAgaWYgKGxvYWRpbmcpIGxvYWRpbmcuc3R5bGUuZGlzcGxheSA9ICdibG9jayc7XG59XG5mdW5jdGlvbiBzaG93Tm9EYXRhKCkge1xuICBoaWRlQWxsKCk7XG4gIGNvbnN0IGVtcHR5ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2NhcnRlcmEtZW1wdHknKTtcbiAgaWYgKGVtcHR5KSB7XG4gICAgZW1wdHkuc3R5bGUuZGlzcGxheSA9ICdibG9jayc7XG4gICAgZW1wdHkudGV4dENvbnRlbnQgPVxuICAgICAgJ1NpbiBjYXJ0ZXJhIHBhcmEgZXN0ZSB2ZW5kZWRvci4gVmVyaWZpY1x1MDBFMSBhc3NpZ25lZFZlbmRvciBlbiBjbGllbnRfbWFzdGVyIG8gZXNwZXJcdTAwRTEgYWwgcHJcdTAwRjN4aW1vIHNuYXBzaG90ICgwNDowMCBBUlQpLic7XG4gIH1cbn1cbi8qKiBAcGFyYW0ge3N0cmluZ30gbXNnICovXG5mdW5jdGlvbiBzaG93RXJyb3IobXNnKSB7XG4gIGhpZGVBbGwoKTtcbiAgY29uc3QgZW1wdHkgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY2FydGVyYS1lbXB0eScpO1xuICBpZiAoZW1wdHkpIHtcbiAgICBlbXB0eS5zdHlsZS5kaXNwbGF5ID0gJ2Jsb2NrJztcbiAgICBlbXB0eS5zdHlsZS5jb2xvciA9ICcjZGMyNjI2JztcbiAgICBlbXB0eS50ZXh0Q29udGVudCA9IGBFcnJvciBjYXJnYW5kbyBjYXJ0ZXJhOiAke21zZ31gO1xuICB9XG59XG5mdW5jdGlvbiBzaG93VGFibGUoKSB7XG4gIGNvbnN0IGVtcHR5ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2NhcnRlcmEtZW1wdHknKTtcbiAgaWYgKGVtcHR5KSBlbXB0eS5zdHlsZS5kaXNwbGF5ID0gJ25vbmUnO1xuICBjb25zdCBsb2FkaW5nID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2NhcnRlcmEtbG9hZGluZycpO1xuICBpZiAobG9hZGluZykgbG9hZGluZy5zdHlsZS5kaXNwbGF5ID0gJ25vbmUnO1xuICBjb25zdCB0YWJsZSA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdjYXJ0ZXJhLXRhYmxlJyk7XG4gIGlmICh0YWJsZSkgdGFibGUuc3R5bGUuZGlzcGxheSA9ICd0YWJsZSc7XG4gIC8vIHYxMzgzOiBkaXNwbGF5IHZhY2lvID0gcmVzZXQgYWwgdmFsb3IgZGVsIENTUyAoZ3JpZCBwYXJhIGtwaXMsIGZsZXggcGFyYSBjaGlwcykuXG4gIGNvbnN0IGtwaXMgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY2FydGVyYS1rcGlzJyk7XG4gIGlmIChrcGlzKSBrcGlzLnN0eWxlLmRpc3BsYXkgPSAnJztcbiAgY29uc3QgY2hpcHMgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY2FydGVyYS1jaGlwcycpO1xuICBpZiAoY2hpcHMpIGNoaXBzLnN0eWxlLmRpc3BsYXkgPSAnJztcbn1cblxuLy8gPT09IEV4cG9ydCBFeGNlbCA9PT1cbndpbmRvdy5leHBvcnRDYXJ0ZXJhVG9FeGNlbCA9IGFzeW5jIGZ1bmN0aW9uIGV4cG9ydENhcnRlcmFUb0V4Y2VsKCkge1xuICBpZiAoIXNlbGVjdGVkVmVuZG9yKSB7XG4gICAgYWxlcnQoJ0VsZWdcdTAwRUQgdW4gdmVuZGVkb3IgcHJpbWVyby4nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgY29uc3QgZG9jID0gY2FydGVyYURvY0NhY2hlLmdldChzZWxlY3RlZFZlbmRvcik7XG4gIGlmICghZG9jKSB7XG4gICAgYWxlcnQoJ1NpbiBkYXRhIGNhcmdhZGEuJyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGNvbnN0IGZpbHRlcmVkID0gYXBwbHlDaGlwRmlsdGVyKGRvYy5jbGllbnRlcywgYWN0aXZlQ2hpcCk7XG4gIGNvbnN0IHNlYXJjaGVkID0gc2VhcmNoUXVlcnlcbiAgICA/IGZpbHRlcmVkLmZpbHRlcigoYykgPT5cbiAgICAgICAgU3RyaW5nKGMuY2xpZW50TmFtZSB8fCAnJylcbiAgICAgICAgICAudG9Mb3dlckNhc2UoKVxuICAgICAgICAgIC5pbmNsdWRlcyhzZWFyY2hRdWVyeSlcbiAgICAgIClcbiAgICA6IGZpbHRlcmVkO1xuICBjb25zdCBzb3J0ZWQgPSBzb3J0Q2xpZW50ZXMoc2VhcmNoZWQsIHNvcnRCeSwgc29ydERpcik7XG5cbiAgY29uc3QgY2hpcExhYmVsID0gKENISVBTLmZpbmQoKGMpID0+IGMuaWQgPT09IGFjdGl2ZUNoaXApIHx8IHsgbGFiZWw6ICdUb2RvcycgfSkubGFiZWw7XG4gIGNvbnN0IHRpdGxlID0gYENhcnRlcmEgZGUgJHtzZWxlY3RlZFZlbmRvcn0gXHUyMDE0ICR7Y2hpcExhYmVsfSBcdTIwMTQgU25hcHNob3QgJHtkb2Muc25hcHNob3REYXRlfWA7XG5cbiAgdHJ5IHtcbiAgICBpZiAodHlwZW9mIHdpbmRvdy5sb2FkRXhjZWxKUyA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgYXdhaXQgd2luZG93LmxvYWRFeGNlbEpTKCk7XG4gICAgfVxuICAgIGNvbnN0IEV4Y2VsSlMgPSB3aW5kb3cuRXhjZWxKUztcbiAgICBpZiAoIUV4Y2VsSlMpIHRocm93IG5ldyBFcnJvcignRXhjZWxKUyBubyBkaXNwb25pYmxlJyk7XG4gICAgY29uc3Qgd2IgPSBuZXcgRXhjZWxKUy5Xb3JrYm9vaygpO1xuICAgIGNvbnN0IHdzID0gd2IuYWRkV29ya3NoZWV0KCdDYXJ0ZXJhJyk7XG5cbiAgICAvLyBGaWxhIDE6IHRpdHVsbyBiYW5kYSB2ZXJkZSBTaGltYW5vXG4gICAgd3MubWVyZ2VDZWxscygnQTE6TDEnKTtcbiAgICBjb25zdCB0aXRsZUNlbGwgPSB3cy5nZXRDZWxsKCdBMScpO1xuICAgIHRpdGxlQ2VsbC52YWx1ZSA9IHRpdGxlO1xuICAgIHRpdGxlQ2VsbC5maWxsID0geyB0eXBlOiAncGF0dGVybicsIHBhdHRlcm46ICdzb2xpZCcsIGZnQ29sb3I6IHsgYXJnYjogJ0ZGMjJDNTVFJyB9IH07XG4gICAgdGl0bGVDZWxsLmZvbnQgPSB7IGJvbGQ6IHRydWUsIGNvbG9yOiB7IGFyZ2I6ICdGRkZGRkZGRicgfSwgc2l6ZTogMTQgfTtcbiAgICB0aXRsZUNlbGwuYWxpZ25tZW50ID0geyBob3Jpem9udGFsOiAnY2VudGVyJywgdmVydGljYWw6ICdtaWRkbGUnIH07XG4gICAgd3MuZ2V0Um93KDEpLmhlaWdodCA9IDMwO1xuXG4gICAgLy8gRmlsYSAyOiBoZWFkZXJzXG4gICAgY29uc3QgaGVhZGVycyA9IFtcbiAgICAgICdDbGllbnRlJyxcbiAgICAgICdQcm92aW5jaWEnLFxuICAgICAgJ0xvY2FsaWRhZCcsXG4gICAgICAnVGlwbycsXG4gICAgICAnXHUwMERBbHRpbWEgdmlzaXRhIHByZXNlbmNpYWwnLFxuICAgICAgJ1x1MDBEQWx0aW1vIGNvbnRhY3RvJyxcbiAgICAgICdcdTAwREFsdGltYSBjb21wcmEnLFxuICAgICAgJ0ZhY3QgMTJNIChBUlMpJyxcbiAgICAgICdEZXVkYSBhYmllcnRhIChBUlMpJyxcbiAgICAgICdEXHUwMEVEYXMgc2luIHZpc2l0YScsXG4gICAgICAnRFx1MDBFRGFzIHNpbiBjb21wcmEnLFxuICAgICAgJ0NhcmRDb2RlIFNBUCcsXG4gICAgXTtcbiAgICBjb25zdCBoZWFkZXJSb3cgPSB3cy5nZXRSb3coMik7XG4gICAgaGVhZGVycy5mb3JFYWNoKChoLCBpKSA9PiB7XG4gICAgICBjb25zdCBjZWxsID0gaGVhZGVyUm93LmdldENlbGwoaSArIDEpO1xuICAgICAgY2VsbC52YWx1ZSA9IGg7XG4gICAgICBjZWxsLmZpbGwgPSB7IHR5cGU6ICdwYXR0ZXJuJywgcGF0dGVybjogJ3NvbGlkJywgZmdDb2xvcjogeyBhcmdiOiAnRkYwNzRGNjknIH0gfTtcbiAgICAgIGNlbGwuZm9udCA9IHsgYm9sZDogdHJ1ZSwgY29sb3I6IHsgYXJnYjogJ0ZGRkZGRkZGJyB9IH07XG4gICAgICBjZWxsLmFsaWdubWVudCA9IHsgaG9yaXpvbnRhbDogJ2NlbnRlcicgfTtcbiAgICB9KTtcblxuICAgIC8vIEZpbGFzIDMrOiBkYXRhXG4gICAgc29ydGVkLmZvckVhY2goKGMsIGkpID0+IHtcbiAgICAgIGNvbnN0IHJvdyA9IHdzLmdldFJvdygzICsgaSk7XG4gICAgICByb3cuZ2V0Q2VsbCgxKS52YWx1ZSA9IGMuY2xpZW50TmFtZSB8fCAnJztcbiAgICAgIHJvdy5nZXRDZWxsKDIpLnZhbHVlID0gYy5wcm92aW5jaWEgfHwgJyc7XG4gICAgICByb3cuZ2V0Q2VsbCgzKS52YWx1ZSA9IGMubG9jYWxpZGFkIHx8ICcnO1xuICAgICAgcm93LmdldENlbGwoNCkudmFsdWUgPSBjLmNsaVRpcG8gfHwgJyc7XG4gICAgICByb3cuZ2V0Q2VsbCg1KS52YWx1ZSA9IGMudWx0aW1hVmlzaXRhUHJlc2VuY2lhbCB8fCAnJztcbiAgICAgIHJvdy5nZXRDZWxsKDYpLnZhbHVlID0gYy51bHRpbW9Db250YWN0byB8fCAnJztcbiAgICAgIHJvdy5nZXRDZWxsKDcpLnZhbHVlID0gYy51bHRpbWFDb21wcmEgfHwgJyc7XG4gICAgICByb3cuZ2V0Q2VsbCg4KS52YWx1ZSA9IGMuZmFjdHVyYWRvMTJNIHx8IDA7XG4gICAgICByb3cuZ2V0Q2VsbCg4KS5udW1GbXQgPSAnXCIkXCIjLCMjMCc7XG4gICAgICByb3cuZ2V0Q2VsbCg5KS52YWx1ZSA9IGMuZGV1ZGFBYmllcnRhIHx8IDA7XG4gICAgICByb3cuZ2V0Q2VsbCg5KS5udW1GbXQgPSAnXCIkXCIjLCMjMCc7XG4gICAgICByb3cuZ2V0Q2VsbCgxMCkudmFsdWUgPSBjLmRpYXNTaW5WaXNpdGFQcmVzZW5jaWFsO1xuICAgICAgcm93LmdldENlbGwoMTEpLnZhbHVlID0gYy5kaWFzU2luQ29tcHJhO1xuICAgICAgcm93LmdldENlbGwoMTIpLnZhbHVlID0gYy5jYXJkQ29kZSB8fCAnJztcbiAgICB9KTtcblxuICAgIHdzLmNvbHVtbnMuZm9yRWFjaCgoY29sLCBpKSA9PiB7XG4gICAgICBjb2wud2lkdGggPSBpID09PSAwID8gMzAgOiBpID09PSA0IHx8IGkgPT09IDUgfHwgaSA9PT0gNiA/IDE4IDogMTQ7XG4gICAgfSk7XG5cbiAgICBjb25zdCBidWYgPSBhd2FpdCB3Yi54bHN4LndyaXRlQnVmZmVyKCk7XG4gICAgY29uc3QgYmxvYiA9IG5ldyBCbG9iKFtidWZdLCB7XG4gICAgICB0eXBlOiAnYXBwbGljYXRpb24vdm5kLm9wZW54bWxmb3JtYXRzLW9mZmljZWRvY3VtZW50LnNwcmVhZHNoZWV0bWwuc2hlZXQnLFxuICAgIH0pO1xuICAgIGNvbnN0IHVybCA9IFVSTC5jcmVhdGVPYmplY3RVUkwoYmxvYik7XG4gICAgY29uc3QgYSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2EnKTtcbiAgICBhLmhyZWYgPSB1cmw7XG4gICAgYS5kb3dubG9hZCA9IGBDYXJ0ZXJhXyR7U3RyaW5nKHNlbGVjdGVkVmVuZG9yKS5yZXBsYWNlKC9cXHMrL2csICdfJyl9XyR7YWN0aXZlQ2hpcH1fJHtkb2Muc25hcHNob3REYXRlfS54bHN4YDtcbiAgICBkb2N1bWVudC5ib2R5LmFwcGVuZENoaWxkKGEpO1xuICAgIGEuY2xpY2soKTtcbiAgICBhLnJlbW92ZSgpO1xuICAgIFVSTC5yZXZva2VPYmplY3RVUkwodXJsKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGNvbnNvbGUuZXJyb3IoJ2V4cG9ydENhcnRlcmFUb0V4Y2VsIGZhaWxlZCcsIGUpO1xuICAgIGFsZXJ0KCdFcnJvciBleHBvcnRhbmRvOiAnICsgU3RyaW5nKGUpKTtcbiAgfVxufTtcbiJdLAogICJtYXBwaW5ncyI6ICI7OztBQWVPLFdBQVMsZ0JBQWdCLFVBQVUsTUFBTTtBQUM5QyxRQUFJLENBQUMsTUFBTSxRQUFRLFFBQVEsRUFBRyxRQUFPLENBQUM7QUFDdEMsWUFBUSxNQUFNO0FBQUEsTUFDWixLQUFLO0FBQ0gsZUFB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R0QsYUFBTyxRQUFRLENBQUMsR0FBRyxNQUFNO0FBQ3ZCLGNBQU0sTUFBTSxHQUFHLE9BQU8sSUFBSSxDQUFDO0FBQzNCLFlBQUksUUFBUSxDQUFDLEVBQUUsUUFBUSxFQUFFLGNBQWM7QUFDdkMsWUFBSSxRQUFRLENBQUMsRUFBRSxRQUFRLEVBQUUsYUFBYTtBQUN0QyxZQUFJLFFBQVEsQ0FBQyxFQUFFLFFBQVEsRUFBRSxhQUFhO0FBQ3RDLFlBQUksUUFBUSxDQUFDLEVBQUUsUUFBUSxFQUFFLFdBQVc7QUFDcEMsWUFBSSxRQUFRLENBQUMsRUFBRSxRQUFRLEVBQUUsMEJBQTBCO0FBQ25ELFlBQUksUUFBUSxDQUFDLEVBQUUsUUFBUSxFQUFFLGtCQUFrQjtBQUMzQyxZQUFJLFFBQVEsQ0FBQyxFQUFFLFFBQVEsRUFBRSxnQkFBZ0I7QUFDekMsWUFBSSxRQUFRLENBQUMsRUFBRSxRQUFRLEVBQUUsZ0JBQWdCO0FBQ3pDLFlBQUksUUFBUSxDQUFDLEVBQUUsU0FBUztBQUN4QixZQUFJLFFBQVEsQ0FBQyxFQUFFLFFBQVEsRUFBRSxnQkFBZ0I7QUFDekMsWUFBSSxRQUFRLENBQUMsRUFBRSxTQUFTO0FBQ3hCLFlBQUksUUFBUSxFQUFFLEVBQUUsUUFBUSxFQUFFO0FBQzFCLFlBQUksUUFBUSxFQUFFLEVBQUUsUUFBUSxFQUFFO0FBQzFCLFlBQUksUUFBUSxFQUFFLEVBQUUsUUFBUSxFQUFFLFlBQVk7QUFBQSxNQUN4QyxDQUFDO0FBRUQsU0FBRyxRQUFRLFFBQVEsQ0FBQyxLQUFLLE1BQU07QUFDN0IsWUFBSSxRQUFRLE1BQU0sSUFBSSxLQUFLLE1BQU0sS0FBSyxNQUFNLEtBQUssTUFBTSxJQUFJLEtBQUs7QUFBQSxNQUNsRSxDQUFDO0FBRUQsWUFBTSxNQUFNLE1BQU0sR0FBRyxLQUFLLFlBQVk7QUFDdEMsWUFBTSxPQUFPLElBQUksS0FBSyxDQUFDLEdBQUcsR0FBRztBQUFBLFFBQzNCLE1BQU07QUFBQSxNQUNSLENBQUM7QUFDRCxZQUFNLE1BQU0sSUFBSSxnQkFBZ0IsSUFBSTtBQUNwQyxZQUFNLElBQUksU0FBUyxjQUFjLEdBQUc7QUFDcEMsUUFBRSxPQUFPO0FBQ1QsUUFBRSxXQUFXLFdBQVcsT0FBTyxjQUFjLEVBQUUsUUFBUSxRQUFRLEdBQUcsQ0FBQyxJQUFJLFVBQVUsSUFBSSxJQUFJLFlBQVk7QUFDckcsZUFBUyxLQUFLLFlBQVksQ0FBQztBQUMzQixRQUFFLE1BQU07QUFDUixRQUFFLE9BQU87QUFDVCxVQUFJLGdCQUFnQixHQUFHO0FBQUEsSUFDekIsU0FBUyxHQUFHO0FBQ1YsY0FBUSxNQUFNLCtCQUErQixDQUFDO0FBQzlDLFlBQU0sdUJBQXVCLE9BQU8sQ0FBQyxDQUFDO0FBQUEsSUFDeEM7QUFBQSxFQUNGOyIsCiAgIm5hbWVzIjogWyJzb3J0QnkiLCAic29ydERpciJdCn0K
