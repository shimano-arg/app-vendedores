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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL3B1cmUvY2FydGVyYS12ZW5kb3ItZmlsdGVyLmpzIiwgIi4uL3NyYy9kb21haW5zL2NhcnRlcmEtdmVuZG9yLmpzIl0sCiAgInNvdXJjZXNDb250ZW50IjogWyIvLyBAdHMtY2hlY2tcclxuLyoqXHJcbiAqIGNhcnRlcmEtdmVuZG9yLWZpbHRlci5qcyAodjEyODMsIDIwMjYtMTAtMjApXHJcbiAqXHJcbiAqIFB1cmFzIHBhcmEgZmlsdHJhciB5IG9yZGVuYXIgbGEgdGFibGEgZGVsIGRhc2hib2FyZCBcIkFuYWxpc2lzIGRlIENhcnRlcmFcIi5cclxuICogSW1wb3J0YWRvIHBvciBzcmMvZG9tYWlucy9jYXJ0ZXJhLXZlbmRvci5qcyAoYnVuZGxlIGZyb250ZW5kKS5cclxuICogVGVzdGVhZG8gZW4gdGVzdHMvdW5pdC9jYXJ0ZXJhLXZlbmRvci1maWx0ZXIudGVzdC5qcy5cclxuICovXHJcblxyXG4vKipcclxuICogQXBsaWNhIHVuIGNoaXAgZGUgZmlsdHJvIGFsIGFycmF5IGRlIGNsaWVudGVzLlxyXG4gKiBAcGFyYW0ge0FycmF5PGFueT59IGNsaWVudGVzXHJcbiAqIEBwYXJhbSB7c3RyaW5nfSBjaGlwXHJcbiAqIEByZXR1cm5zIHtBcnJheTxhbnk+fVxyXG4gKi9cclxuZXhwb3J0IGZ1bmN0aW9uIGFwcGx5Q2hpcEZpbHRlcihjbGllbnRlcywgY2hpcCkge1xyXG4gIGlmICghQXJyYXkuaXNBcnJheShjbGllbnRlcykpIHJldHVybiBbXTtcclxuICBzd2l0Y2ggKGNoaXApIHtcclxuICAgIGNhc2UgJ2Jhc2VBY3RpdmE5MGQnOlxyXG4gICAgICByZXR1cm4gY2xpZW50ZXMuZmlsdGVyKFxyXG4gICAgICAgIChjKSA9PiBjLmRpYXNTaW5Db21wcmEgIT09IG51bGwgJiYgYy5kaWFzU2luQ29tcHJhICE9PSB1bmRlZmluZWQgJiYgYy5kaWFzU2luQ29tcHJhIDw9IDkwXHJcbiAgICAgICk7XHJcbiAgICBjYXNlICdkb3JtaWRvc1Zpc2l0YTMwZCc6XHJcbiAgICAgIHJldHVybiBjbGllbnRlcy5maWx0ZXIoXHJcbiAgICAgICAgKGMpID0+XHJcbiAgICAgICAgICBjLmRpYXNTaW5WaXNpdGFQcmVzZW5jaWFsICE9PSBudWxsICYmXHJcbiAgICAgICAgICBjLmRpYXNTaW5WaXNpdGFQcmVzZW5jaWFsICE9PSB1bmRlZmluZWQgJiZcclxuICAgICAgICAgIGMuZGlhc1NpblZpc2l0YVByZXNlbmNpYWwgPiAzMFxyXG4gICAgICApO1xyXG4gICAgY2FzZSAnZG9ybWlkb3NDb21wcmE5MGQnOlxyXG4gICAgICByZXR1cm4gY2xpZW50ZXMuZmlsdGVyKFxyXG4gICAgICAgIChjKSA9PiBjLmRpYXNTaW5Db21wcmEgIT09IG51bGwgJiYgYy5kaWFzU2luQ29tcHJhICE9PSB1bmRlZmluZWQgJiYgYy5kaWFzU2luQ29tcHJhID4gOTBcclxuICAgICAgKTtcclxuICAgIGNhc2UgJ251bmNhVmlzaXRhZG9zJzpcclxuICAgICAgcmV0dXJuIGNsaWVudGVzLmZpbHRlcihcclxuICAgICAgICAoYykgPT4gYy51bHRpbWFWaXNpdGFQcmVzZW5jaWFsID09PSBudWxsIHx8IGMudWx0aW1hVmlzaXRhUHJlc2VuY2lhbCA9PT0gdW5kZWZpbmVkXHJcbiAgICAgICk7XHJcbiAgICBjYXNlICdudW5jYUNvbXByYXJvbic6XHJcbiAgICAgIHJldHVybiBjbGllbnRlcy5maWx0ZXIoKGMpID0+IGMudWx0aW1hQ29tcHJhID09PSBudWxsIHx8IGMudWx0aW1hQ29tcHJhID09PSB1bmRlZmluZWQpO1xyXG4gICAgZGVmYXVsdDpcclxuICAgICAgcmV0dXJuIGNsaWVudGVzLnNsaWNlKCk7XHJcbiAgfVxyXG59XHJcblxyXG4vKipcclxuICogT3JkZW5hIHVuYSBjb3BpYSBkZWwgYXJyYXkgcG9yIGNvbHVtbmEuIE51bGxzIHNpZW1wcmUgYWwgZmluYWwuXHJcbiAqIEBwYXJhbSB7QXJyYXk8YW55Pn0gY2xpZW50ZXNcclxuICogQHBhcmFtIHtzdHJpbmd9IHNvcnRCeVxyXG4gKiBAcGFyYW0geydhc2MnfCdkZXNjJ30gc29ydERpclxyXG4gKiBAcmV0dXJucyB7QXJyYXk8YW55Pn1cclxuICovXHJcbmV4cG9ydCBmdW5jdGlvbiBzb3J0Q2xpZW50ZXMoY2xpZW50ZXMsIHNvcnRCeSwgc29ydERpcikge1xyXG4gIGlmICghQXJyYXkuaXNBcnJheShjbGllbnRlcykpIHJldHVybiBbXTtcclxuICBjb25zdCBkaXIgPSBzb3J0RGlyID09PSAnYXNjJyA/IDEgOiAtMTtcclxuICBjb25zdCBjb3B5ID0gY2xpZW50ZXMuc2xpY2UoKTtcclxuICBjb3B5LnNvcnQoKGEsIGIpID0+IHtcclxuICAgIGNvbnN0IGF2ID0gYVtzb3J0QnldO1xyXG4gICAgY29uc3QgYnYgPSBiW3NvcnRCeV07XHJcbiAgICBjb25zdCBhTnVsbCA9IGF2ID09PSBudWxsIHx8IGF2ID09PSB1bmRlZmluZWQ7XHJcbiAgICBjb25zdCBiTnVsbCA9IGJ2ID09PSBudWxsIHx8IGJ2ID09PSB1bmRlZmluZWQ7XHJcbiAgICBpZiAoYU51bGwgJiYgYk51bGwpIHJldHVybiAwO1xyXG4gICAgaWYgKGFOdWxsKSByZXR1cm4gMTtcclxuICAgIGlmIChiTnVsbCkgcmV0dXJuIC0xO1xyXG4gICAgaWYgKHR5cGVvZiBhdiA9PT0gJ251bWJlcicgJiYgdHlwZW9mIGJ2ID09PSAnbnVtYmVyJykgcmV0dXJuIChhdiAtIGJ2KSAqIGRpcjtcclxuICAgIHJldHVybiBTdHJpbmcoYXYpLmxvY2FsZUNvbXBhcmUoU3RyaW5nKGJ2KSkgKiBkaXI7XHJcbiAgfSk7XHJcbiAgcmV0dXJuIGNvcHk7XHJcbn1cclxuIiwgIi8vIEB0cy1ub2NoZWNrXHJcbi8vIE5PVEE6IEB0cy1ub2NoZWNrIGludGVuY2lvbmFsLiBFbCBjaHVuayBlcyBoZWF2eSBET00gKyB3aW5kb3cuKiBoYW5kbGVycyArXHJcbi8vIEZpcmVzdG9yZSBTREsgY29tcGF0IHY4LiBBbm90YXIgc3RyaWN0YW1lbnRlIGNhZGEgaGFuZGxlciBzZXJcdTAwRURhIHJ1aWRvIHNpblxyXG4vLyB2YWxvciBcdTIwMTQgbG9zIGhlbHBlcnMgcHVyb3MgcXVlIGltcG9ydGFtb3MgKC4uL3B1cmUvY2FydGVyYS12ZW5kb3ItZmlsdGVyLmpzKVxyXG4vLyB5IGVsIGNvcmUgKGZ1bmN0aW9ucy9jb3JlL2NhcnRlcmEtdmVuZG9yLWNvcmUuanMpIHNcdTAwRUQgdGllbmVuIEB0cy1jaGVjay5cclxuLyoqXHJcbiAqIGNhcnRlcmEtdmVuZG9yLmpzICh2MTI4MywgMjAyNi0xMC0yMCkgXHUyMDE0IGJ1bmRsZSBjaHVuayBsYXp5LlxyXG4gKlxyXG4gKiBEYXNoYm9hcmQgXCJBbmFsaXNpcyBkZSBDYXJ0ZXJhIHBvciBWZW5kZWRvclwiLiBSZWVtcGxhemEgc2VndWltaWVudG8uanMuXHJcbiAqIExlZSBjYXJ0ZXJhX3ZlbmRvci97dmVuZG9yS2V5fSBGaXJlc3RvcmUgKHNuYXBzaG90IG5pZ2h0bHkgMDQ6MDAgQVJUKS5cclxuICpcclxuICogVE9ETyBlbCBET00gcmVuZGVyIHVzYSBjcmVhdGVFbGVtZW50ICsgdGV4dENvbnRlbnQgKHBvbGljeSBhbnRpLVhTUywgbm8gaW5uZXJIVE1MKS5cclxuICpcclxuICogU3BlYzogZG9jcy9zdXBlcnBvd2Vycy9zcGVjcy8yMDI2LTEwLTIwLWNhcnRlcmEtdmVuZG9yLWFuYWxpc2lzLWRlc2lnbi5tZFxyXG4gKiBQbGFuOiBkb2NzL3N1cGVycG93ZXJzL3BsYW5zLzIwMjYtMTAtMjAtY2FydGVyYS12ZW5kb3ItYW5hbGlzaXMubWRcclxuICovXHJcblxyXG5pbXBvcnQgeyBhcHBseUNoaXBGaWx0ZXIsIHNvcnRDbGllbnRlcyB9IGZyb20gJy4uL3B1cmUvY2FydGVyYS12ZW5kb3ItZmlsdGVyLmpzJztcclxuXHJcbi8qKiBAdHlwZSB7TWFwPHN0cmluZywgYW55Pn0gKi9cclxuY29uc3QgY2FydGVyYURvY0NhY2hlID0gbmV3IE1hcCgpO1xyXG4vKiogQHR5cGUge3N0cmluZ3xudWxsfSAqL1xyXG5sZXQgc2VsZWN0ZWRWZW5kb3IgPSBudWxsO1xyXG5sZXQgYWN0aXZlQ2hpcCA9ICd0b2Rvcyc7XHJcbmxldCBzZWFyY2hRdWVyeSA9ICcnO1xyXG5sZXQgc29ydEJ5ID0gJ2RpYXNTaW5Db21wcmEnO1xyXG4vKiogQHR5cGUgeydhc2MnfCdkZXNjJ30gKi9cclxubGV0IHNvcnREaXIgPSAnZGVzYyc7XHJcblxyXG5jb25zdCBDSElQUyA9IFtcclxuICB7IGlkOiAndG9kb3MnLCBsYWJlbDogJ1RvZG9zJyB9LFxyXG4gIHsgaWQ6ICdiYXNlQWN0aXZhOTBkJywgbGFiZWw6ICdCYXNlIGFjdGl2YSA5MGQnIH0sXHJcbiAgeyBpZDogJ2Rvcm1pZG9zVmlzaXRhMzBkJywgbGFiZWw6ICdEb3JtaWRvcyB2aXNpdGEgMzBkJyB9LFxyXG4gIHsgaWQ6ICdkb3JtaWRvc0NvbXByYTkwZCcsIGxhYmVsOiAnRG9ybWlkb3MgY29tcHJhIDkwZCcgfSxcclxuICB7IGlkOiAnbnVuY2FWaXNpdGFkb3MnLCBsYWJlbDogJ051bmNhIHZpc2l0YWRvcycgfSxcclxuICB7IGlkOiAnbnVuY2FDb21wcmFyb24nLCBsYWJlbDogJ051bmNhIGNvbXByYXJvbicgfSxcclxuXTtcclxuXHJcbmNvbnN0IEtQSV9DQVJEUyA9IFtcclxuICB7IGNoaXA6ICd0b2RvcycsIGxhYmVsOiAnVG90YWwgY2FydGVyYScsIGNvbG9yOiAnIzY0NzQ4YicgfSxcclxuICB7IGNoaXA6ICdiYXNlQWN0aXZhOTBkJywgbGFiZWw6ICdCYXNlIGFjdGl2YSA5MGQnLCBjb2xvcjogJyMxNmEzNGEnIH0sXHJcbiAgeyBjaGlwOiAnZG9ybWlkb3NWaXNpdGEzMGQnLCBsYWJlbDogJ0Rvcm1pZG9zIHZpcyAzMGQnLCBjb2xvcjogJyNlYTU4MGMnIH0sXHJcbiAgeyBjaGlwOiAnZG9ybWlkb3NDb21wcmE5MGQnLCBsYWJlbDogJ0Rvcm1pZG9zIGNvbSA5MGQnLCBjb2xvcjogJyNkYzI2MjYnIH0sXHJcbiAgeyBjaGlwOiAnbnVuY2FWaXNpdGFkb3MnLCBsYWJlbDogJ051bmNhIHZpc2l0YWRvcycsIGNvbG9yOiAnIzdjM2FlZCcgfSxcclxuICB7IGNoaXA6ICdudW5jYUNvbXByYXJvbicsIGxhYmVsOiAnTnVuY2EgY29tcHJhcm9uJywgY29sb3I6ICcjYmUxODVkJyB9LFxyXG5dO1xyXG5cclxuLy8gPT09IE9wZW4gLyBjbG9zZSA9PT1cclxud2luZG93Lm9wZW5DYXJ0ZXJhTW9kYWwgPSBhc3luYyBmdW5jdGlvbiBvcGVuQ2FydGVyYU1vZGFsKCkge1xyXG4gIGNvbnN0IG1vZGFsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2NhcnRlcmEtbW9kYWwnKTtcclxuICBpZiAoIW1vZGFsKSByZXR1cm47XHJcbiAgbW9kYWwuY2xhc3NMaXN0LmFkZCgnb3BlbicpO1xyXG4gIGF3YWl0IHBvcHVsYXRlVmVuZG9yRHJvcGRvd24oKTtcclxufTtcclxuXHJcbndpbmRvdy5jbG9zZUNhcnRlcmFNb2RhbCA9IGZ1bmN0aW9uIGNsb3NlQ2FydGVyYU1vZGFsKCkge1xyXG4gIGNvbnN0IG1vZGFsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2NhcnRlcmEtbW9kYWwnKTtcclxuICBpZiAobW9kYWwpIG1vZGFsLmNsYXNzTGlzdC5yZW1vdmUoJ29wZW4nKTtcclxufTtcclxuXHJcbi8vID09PSBEcm9wZG93biBkZSB2ZW5kb3JzID09PVxyXG5hc3luYyBmdW5jdGlvbiBwb3B1bGF0ZVZlbmRvckRyb3Bkb3duKCkge1xyXG4gIGNvbnN0IHNlbCA9IC8qKiBAdHlwZSB7SFRNTFNlbGVjdEVsZW1lbnR8bnVsbH0gKi8gKFxyXG4gICAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2NhcnRlcmEtdmVuZG9yLXNlbGVjdCcpXHJcbiAgKTtcclxuICBpZiAoIXNlbCkgcmV0dXJuO1xyXG4gIGlmIChzZWwub3B0aW9ucy5sZW5ndGggPiAxKSByZXR1cm47XHJcbiAgdHJ5IHtcclxuICAgIC8vIEB0cy1leHBlY3QtZXJyb3JcclxuICAgIGNvbnN0IHNuYXAgPSBhd2FpdCBmaXJlYmFzZS5maXJlc3RvcmUoKS5jb2xsZWN0aW9uKCdjYXJ0ZXJhX3ZlbmRvcicpLmdldCgpO1xyXG4gICAgLyoqIEB0eXBlIHtzdHJpbmdbXX0gKi9cclxuICAgIGNvbnN0IHZlbmRvcnMgPSBbXTtcclxuICAgIHNuYXAuZm9yRWFjaCgoZG9jKSA9PiB2ZW5kb3JzLnB1c2goZG9jLmlkKSk7XHJcbiAgICB2ZW5kb3JzLnNvcnQoKTtcclxuICAgIGZvciAoY29uc3QgdiBvZiB2ZW5kb3JzKSB7XHJcbiAgICAgIGNvbnN0IG9wdCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ29wdGlvbicpO1xyXG4gICAgICBvcHQudmFsdWUgPSB2O1xyXG4gICAgICBvcHQudGV4dENvbnRlbnQgPSB2O1xyXG4gICAgICBzZWwuYXBwZW5kQ2hpbGQob3B0KTtcclxuICAgIH1cclxuICB9IGNhdGNoIChlKSB7XHJcbiAgICBjb25zb2xlLmVycm9yKCdwb3B1bGF0ZVZlbmRvckRyb3Bkb3duIGZhaWxlZCcsIGUpO1xyXG4gIH1cclxufVxyXG5cclxuLy8gPT09IE9uIHZlbmRvciBjaGFuZ2UgPT09XHJcbndpbmRvdy5vbkNhcnRlcmFWZW5kb3JDaGFuZ2UgPSBhc3luYyBmdW5jdGlvbiBvbkNhcnRlcmFWZW5kb3JDaGFuZ2UoKSB7XHJcbiAgY29uc3Qgc2VsID0gLyoqIEB0eXBlIHtIVE1MU2VsZWN0RWxlbWVudHxudWxsfSAqLyAoXHJcbiAgICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY2FydGVyYS12ZW5kb3Itc2VsZWN0JylcclxuICApO1xyXG4gIGlmICghc2VsKSByZXR1cm47XHJcbiAgc2VsZWN0ZWRWZW5kb3IgPSBzZWwudmFsdWUgfHwgbnVsbDtcclxuICBhY3RpdmVDaGlwID0gJ3RvZG9zJztcclxuICBzZWFyY2hRdWVyeSA9ICcnO1xyXG4gIGNvbnN0IHNlYXJjaElucHV0ID0gLyoqIEB0eXBlIHtIVE1MSW5wdXRFbGVtZW50fG51bGx9ICovIChcclxuICAgIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdjYXJ0ZXJhLXNlYXJjaCcpXHJcbiAgKTtcclxuICBpZiAoc2VhcmNoSW5wdXQpIHNlYXJjaElucHV0LnZhbHVlID0gJyc7XHJcbiAgaWYgKCFzZWxlY3RlZFZlbmRvcikge1xyXG4gICAgc2hvd0VtcHR5KCk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIHNob3dMb2FkaW5nKCk7XHJcbiAgdHJ5IHtcclxuICAgIGxldCBkb2MgPSBjYXJ0ZXJhRG9jQ2FjaGUuZ2V0KHNlbGVjdGVkVmVuZG9yKTtcclxuICAgIGlmICghZG9jKSB7XHJcbiAgICAgIC8vIEB0cy1leHBlY3QtZXJyb3JcclxuICAgICAgY29uc3Qgc25hcCA9IGF3YWl0IGZpcmViYXNlXHJcbiAgICAgICAgLmZpcmVzdG9yZSgpXHJcbiAgICAgICAgLmNvbGxlY3Rpb24oJ2NhcnRlcmFfdmVuZG9yJylcclxuICAgICAgICAuZG9jKHNlbGVjdGVkVmVuZG9yKVxyXG4gICAgICAgIC5nZXQoKTtcclxuICAgICAgaWYgKCFzbmFwLmV4aXN0cykge1xyXG4gICAgICAgIHNob3dOb0RhdGEoKTtcclxuICAgICAgICByZXR1cm47XHJcbiAgICAgIH1cclxuICAgICAgZG9jID0gc25hcC5kYXRhKCk7XHJcbiAgICAgIGNhcnRlcmFEb2NDYWNoZS5zZXQoc2VsZWN0ZWRWZW5kb3IsIGRvYyk7XHJcbiAgICB9XHJcbiAgICByZW5kZXJEYXNoYm9hcmQoZG9jKTtcclxuICB9IGNhdGNoIChlKSB7XHJcbiAgICBjb25zb2xlLmVycm9yKCdvbkNhcnRlcmFWZW5kb3JDaGFuZ2UgZmFpbGVkJywgZSk7XHJcbiAgICBzaG93RXJyb3IoU3RyaW5nKGUpKTtcclxuICB9XHJcbn07XHJcblxyXG4vKiogQHR5cGUge2FueX0gKi8gKHdpbmRvdykub25DYXJ0ZXJhQ2hpcENsaWNrID0gZnVuY3Rpb24gb25DYXJ0ZXJhQ2hpcENsaWNrKGNoaXBJZCkge1xyXG4gIGFjdGl2ZUNoaXAgPSBjaGlwSWQ7XHJcbiAgaWYgKCFzZWxlY3RlZFZlbmRvcikgcmV0dXJuO1xyXG4gIGNvbnN0IGRvYyA9IGNhcnRlcmFEb2NDYWNoZS5nZXQoc2VsZWN0ZWRWZW5kb3IpO1xyXG4gIGlmIChkb2MpIHJlbmRlckRhc2hib2FyZChkb2MpO1xyXG59O1xyXG5cclxuLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBzZXRUaW1lb3V0PnxudWxsfSAqL1xyXG5sZXQgc2VhcmNoRGVib3VuY2VUaW1lciA9IG51bGw7XHJcbndpbmRvdy5vbkNhcnRlcmFTZWFyY2hDaGFuZ2UgPSBmdW5jdGlvbiBvbkNhcnRlcmFTZWFyY2hDaGFuZ2UoKSB7XHJcbiAgY29uc3QgaW5wdXQgPSAvKiogQHR5cGUge0hUTUxJbnB1dEVsZW1lbnR8bnVsbH0gKi8gKGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdjYXJ0ZXJhLXNlYXJjaCcpKTtcclxuICBpZiAoIWlucHV0KSByZXR1cm47XHJcbiAgaWYgKHNlYXJjaERlYm91bmNlVGltZXIpIGNsZWFyVGltZW91dChzZWFyY2hEZWJvdW5jZVRpbWVyKTtcclxuICBzZWFyY2hEZWJvdW5jZVRpbWVyID0gc2V0VGltZW91dCgoKSA9PiB7XHJcbiAgICBzZWFyY2hRdWVyeSA9IChpbnB1dC52YWx1ZSB8fCAnJykudHJpbSgpLnRvTG93ZXJDYXNlKCk7XHJcbiAgICBpZiAoIXNlbGVjdGVkVmVuZG9yKSByZXR1cm47XHJcbiAgICBjb25zdCBkb2MgPSBjYXJ0ZXJhRG9jQ2FjaGUuZ2V0KHNlbGVjdGVkVmVuZG9yKTtcclxuICAgIGlmIChkb2MpIHJlbmRlckRhc2hib2FyZChkb2MpO1xyXG4gIH0sIDMwMCk7XHJcbn07XHJcblxyXG4vKiogQHR5cGUge2FueX0gKi8gKHdpbmRvdykub25DYXJ0ZXJhU29ydENsaWNrID0gZnVuY3Rpb24gb25DYXJ0ZXJhU29ydENsaWNrKGNvbEtleSkge1xyXG4gIGlmIChzb3J0QnkgPT09IGNvbEtleSkgc29ydERpciA9IHNvcnREaXIgPT09ICdhc2MnID8gJ2Rlc2MnIDogJ2FzYyc7XHJcbiAgZWxzZSB7XHJcbiAgICBzb3J0QnkgPSBjb2xLZXk7XHJcbiAgICBzb3J0RGlyID0gJ2Rlc2MnO1xyXG4gIH1cclxuICBpZiAoIXNlbGVjdGVkVmVuZG9yKSByZXR1cm47XHJcbiAgY29uc3QgZG9jID0gY2FydGVyYURvY0NhY2hlLmdldChzZWxlY3RlZFZlbmRvcik7XHJcbiAgaWYgKGRvYykgcmVuZGVyRGFzaGJvYXJkKGRvYyk7XHJcbn07XHJcblxyXG4vLyA9PT0gUmVuZGVyID09PVxyXG5mdW5jdGlvbiByZW5kZXJEYXNoYm9hcmQoZG9jKSB7XHJcbiAgY29uc3Qgc3VidGl0bGUgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY2FydGVyYS1zdWJ0aXRsZScpO1xyXG4gIGlmIChzdWJ0aXRsZSkgc3VidGl0bGUudGV4dENvbnRlbnQgPSBgJHtkb2MuY291bnRzLnRvdGFsfSBjbGllbnRlcyBlbiBjYXJ0ZXJhLmA7XHJcbiAgY29uc3QgaW5mbyA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdjYXJ0ZXJhLXNuYXBzaG90LWluZm8nKTtcclxuICBpZiAoaW5mbykgaW5mby50ZXh0Q29udGVudCA9IGBTbmFwc2hvdDogJHtkb2Muc25hcHNob3REYXRlfWA7XHJcbiAgcmVuZGVyS3Bpcyhkb2MuY291bnRzKTtcclxuICByZW5kZXJDaGlwcyhkb2MuY291bnRzKTtcclxuICByZW5kZXJUYWJsZShkb2MuY2xpZW50ZXMpO1xyXG4gIHNob3dUYWJsZSgpO1xyXG59XHJcblxyXG5mdW5jdGlvbiByZW5kZXJLcGlzKGNvdW50cykge1xyXG4gIGNvbnN0IGVsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2NhcnRlcmEta3BpcycpO1xyXG4gIGlmICghZWwpIHJldHVybjtcclxuICB3aGlsZSAoZWwuZmlyc3RDaGlsZCkgZWwucmVtb3ZlQ2hpbGQoZWwuZmlyc3RDaGlsZCk7XHJcbiAgZm9yIChjb25zdCBzcGVjIG9mIEtQSV9DQVJEUykge1xyXG4gICAgY29uc3QgY2FyZCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpO1xyXG4gICAgY29uc3QgaXNBY3RpdmUgPSBhY3RpdmVDaGlwID09PSBzcGVjLmNoaXA7XHJcbiAgICBjYXJkLnN0eWxlLmNzc1RleHQgPSBgcGFkZGluZzoxMHB4IDE0cHg7Ym9yZGVyOjJweCBzb2xpZCAke2lzQWN0aXZlID8gc3BlYy5jb2xvciA6ICd2YXIoLS1ib3JkZXItbGlnaHQpJ307Ym9yZGVyLXJhZGl1czo4cHg7Y3Vyc29yOnBvaW50ZXI7YmFja2dyb3VuZDoke2lzQWN0aXZlID8gYCR7c3BlYy5jb2xvcn0xNWAgOiAndmFyKC0tYmctY2FyZCknfTttaW4td2lkdGg6MTIwcHg7ZmxleDoxO21heC13aWR0aDoyMDBweGA7XHJcbiAgICBjYXJkLmFkZEV2ZW50TGlzdGVuZXIoJ2NsaWNrJywgKCkgPT4gLyoqIEB0eXBlIHthbnl9ICovICh3aW5kb3cpLm9uQ2FydGVyYUNoaXBDbGljayhzcGVjLmNoaXApKTtcclxuICAgIGNvbnN0IG4gPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKTtcclxuICAgIG4uc3R5bGUuY3NzVGV4dCA9IGBmb250LXNpemU6MjJweDtmb250LXdlaWdodDo4MDA7Y29sb3I6JHtzcGVjLmNvbG9yfWA7XHJcbiAgICBuLnRleHRDb250ZW50ID0gU3RyaW5nKGNvdW50c1tzcGVjLmNoaXAgPT09ICd0b2RvcycgPyAndG90YWwnIDogc3BlYy5jaGlwXSk7XHJcbiAgICBjb25zdCBsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2Jyk7XHJcbiAgICBsLnN0eWxlLmNzc1RleHQgPSAnZm9udC1zaXplOjExcHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7bWFyZ2luLXRvcDoycHgnO1xyXG4gICAgbC50ZXh0Q29udGVudCA9IHNwZWMubGFiZWw7XHJcbiAgICBjYXJkLmFwcGVuZENoaWxkKG4pO1xyXG4gICAgY2FyZC5hcHBlbmRDaGlsZChsKTtcclxuICAgIGVsLmFwcGVuZENoaWxkKGNhcmQpO1xyXG4gIH1cclxufVxyXG5cclxuZnVuY3Rpb24gcmVuZGVyQ2hpcHMoY291bnRzKSB7XHJcbiAgY29uc3QgZWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY2FydGVyYS1jaGlwcycpO1xyXG4gIGlmICghZWwpIHJldHVybjtcclxuICBjb25zdCBjb3VudEJ5Q2hpcCA9IHtcclxuICAgIHRvZG9zOiBjb3VudHMudG90YWwsXHJcbiAgICBiYXNlQWN0aXZhOTBkOiBjb3VudHMuYmFzZUFjdGl2YTkwZCxcclxuICAgIGRvcm1pZG9zVmlzaXRhMzBkOiBjb3VudHMuZG9ybWlkb3NWaXNpdGEzMGQsXHJcbiAgICBkb3JtaWRvc0NvbXByYTkwZDogY291bnRzLmRvcm1pZG9zQ29tcHJhOTBkLFxyXG4gICAgbnVuY2FWaXNpdGFkb3M6IGNvdW50cy5udW5jYVZpc2l0YWRvcyxcclxuICAgIG51bmNhQ29tcHJhcm9uOiBjb3VudHMubnVuY2FDb21wcmFyb24sXHJcbiAgfTtcclxuICB3aGlsZSAoZWwuZmlyc3RDaGlsZCkgZWwucmVtb3ZlQ2hpbGQoZWwuZmlyc3RDaGlsZCk7XHJcbiAgZm9yIChjb25zdCBjaGlwIG9mIENISVBTKSB7XHJcbiAgICBjb25zdCBiID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnYnV0dG9uJyk7XHJcbiAgICBjb25zdCBpc0FjdGl2ZSA9IGFjdGl2ZUNoaXAgPT09IGNoaXAuaWQ7XHJcbiAgICBiLnN0eWxlLmNzc1RleHQgPSBgcGFkZGluZzo0cHggMTBweDtib3JkZXItcmFkaXVzOjk5OXB4O2JvcmRlcjoxcHggc29saWQgJHtpc0FjdGl2ZSA/ICcjMWUzYThhJyA6ICd2YXIoLS1ib3JkZXIpJ307YmFja2dyb3VuZDoke2lzQWN0aXZlID8gJyMxZTNhOGEnIDogJ3ZhcigtLWJnLWNhcmQpJ307Y29sb3I6JHtpc0FjdGl2ZSA/ICd3aGl0ZScgOiAndmFyKC0tdGV4dC1wcmltYXJ5KSd9O2ZvbnQtc2l6ZToxMnB4O2N1cnNvcjpwb2ludGVyO2ZvbnQtd2VpZ2h0OiR7aXNBY3RpdmUgPyAnNzAwJyA6ICc1MDAnfWA7XHJcbiAgICBiLnRleHRDb250ZW50ID0gYCR7Y2hpcC5sYWJlbH0gKCR7Y291bnRCeUNoaXBbY2hpcC5pZF19KWA7XHJcbiAgICBiLmFkZEV2ZW50TGlzdGVuZXIoJ2NsaWNrJywgKCkgPT4gLyoqIEB0eXBlIHthbnl9ICovICh3aW5kb3cpLm9uQ2FydGVyYUNoaXBDbGljayhjaGlwLmlkKSk7XHJcbiAgICBlbC5hcHBlbmRDaGlsZChiKTtcclxuICB9XHJcbn1cclxuXHJcbi8qKiBAcGFyYW0ge0FycmF5PGFueT59IGNsaWVudGVzICovXHJcbmZ1bmN0aW9uIHJlbmRlclRhYmxlKGNsaWVudGVzKSB7XHJcbiAgY29uc3QgdGFibGUgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY2FydGVyYS10YWJsZScpO1xyXG4gIGlmICghdGFibGUpIHJldHVybjtcclxuICBjb25zdCBmaWx0ZXJlZCA9IGFwcGx5Q2hpcEZpbHRlcihjbGllbnRlcywgYWN0aXZlQ2hpcCk7XHJcbiAgY29uc3Qgc2VhcmNoZWQgPSBzZWFyY2hRdWVyeVxyXG4gICAgPyBmaWx0ZXJlZC5maWx0ZXIoKGMpID0+XHJcbiAgICAgICAgU3RyaW5nKGMuY2xpZW50TmFtZSB8fCAnJylcclxuICAgICAgICAgIC50b0xvd2VyQ2FzZSgpXHJcbiAgICAgICAgICAuaW5jbHVkZXMoc2VhcmNoUXVlcnkpXHJcbiAgICAgIClcclxuICAgIDogZmlsdGVyZWQ7XHJcbiAgY29uc3Qgc29ydGVkID0gc29ydENsaWVudGVzKHNlYXJjaGVkLCBzb3J0QnksIHNvcnREaXIpO1xyXG4gIHdoaWxlICh0YWJsZS5maXJzdENoaWxkKSB0YWJsZS5yZW1vdmVDaGlsZCh0YWJsZS5maXJzdENoaWxkKTtcclxuICB0YWJsZS5hcHBlbmRDaGlsZChidWlsZFRoZWFkKCkpO1xyXG4gIHRhYmxlLmFwcGVuZENoaWxkKGJ1aWxkVGJvZHkoc29ydGVkKSk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGJ1aWxkVGhlYWQoKSB7XHJcbiAgY29uc3QgdGhlYWQgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCd0aGVhZCcpO1xyXG4gIGNvbnN0IHRyID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgndHInKTtcclxuICB0ci5zdHlsZS5jc3NUZXh0ID1cclxuICAgICdwb3NpdGlvbjpzdGlja3k7dG9wOjA7YmFja2dyb3VuZDp2YXIoLS1iZy1jYXJkKTtib3JkZXItYm90dG9tOjJweCBzb2xpZCB2YXIoLS1ib3JkZXIpO2ZvbnQtd2VpZ2h0OjcwMDtmb250LXNpemU6MTJweDt0ZXh0LWFsaWduOmxlZnQnO1xyXG4gIGNvbnN0IGhlYWRlcnMgPSBbXHJcbiAgICB7IGxhYmVsOiAnQ2xpZW50ZScsIHNvcnRLZXk6ICdjbGllbnROYW1lJywgYWxpZ246ICdsZWZ0JyB9LFxyXG4gICAgeyBsYWJlbDogJ1Byb3YvTG9jJywgc29ydEtleTogbnVsbCwgYWxpZ246ICdsZWZ0JyB9LFxyXG4gICAgeyBsYWJlbDogJ1RpcG8nLCBzb3J0S2V5OiBudWxsLCBhbGlnbjogJ2NlbnRlcicgfSxcclxuICAgIHsgbGFiZWw6ICdcdTAwREFsdC4gdmlzaXRhJywgc29ydEtleTogJ2RpYXNTaW5WaXNpdGFQcmVzZW5jaWFsJywgYWxpZ246ICdsZWZ0JyB9LFxyXG4gICAgeyBsYWJlbDogJ1x1MDBEQWx0LiBjb250YWN0bycsIHNvcnRLZXk6ICdkaWFzU2luQ29udGFjdG8nLCBhbGlnbjogJ2xlZnQnIH0sXHJcbiAgICB7IGxhYmVsOiAnXHUwMERBbHQuIGNvbXByYScsIHNvcnRLZXk6ICdkaWFzU2luQ29tcHJhJywgYWxpZ246ICdsZWZ0JyB9LFxyXG4gICAgeyBsYWJlbDogJ0ZhY3QgMTJNJywgc29ydEtleTogJ2ZhY3R1cmFkbzEyTScsIGFsaWduOiAncmlnaHQnIH0sXHJcbiAgICB7IGxhYmVsOiAnRGV1ZGEnLCBzb3J0S2V5OiAnZGV1ZGFBYmllcnRhJywgYWxpZ246ICdyaWdodCcgfSxcclxuICBdO1xyXG4gIGZvciAoY29uc3QgaCBvZiBoZWFkZXJzKSB7XHJcbiAgICBjb25zdCB0aCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3RoJyk7XHJcbiAgICB0aC5zdHlsZS5wYWRkaW5nID0gJzhweCc7XHJcbiAgICB0aC5zdHlsZS50ZXh0QWxpZ24gPSBoLmFsaWduO1xyXG4gICAgdGgudGV4dENvbnRlbnQgPSBoLmxhYmVsO1xyXG4gICAgaWYgKGguc29ydEtleSkge1xyXG4gICAgICB0aC5zdHlsZS5jdXJzb3IgPSAncG9pbnRlcic7XHJcbiAgICAgIGNvbnN0IGtleSA9IGguc29ydEtleTtcclxuICAgICAgdGguYWRkRXZlbnRMaXN0ZW5lcignY2xpY2snLCAoKSA9PiAvKiogQHR5cGUge2FueX0gKi8gKHdpbmRvdykub25DYXJ0ZXJhU29ydENsaWNrKGtleSkpO1xyXG4gICAgfVxyXG4gICAgdHIuYXBwZW5kQ2hpbGQodGgpO1xyXG4gIH1cclxuICB0aGVhZC5hcHBlbmRDaGlsZCh0cik7XHJcbiAgcmV0dXJuIHRoZWFkO1xyXG59XHJcblxyXG4vKiogQHBhcmFtIHtBcnJheTxhbnk+fSBzb3J0ZWRDbGllbnRlcyAqL1xyXG5mdW5jdGlvbiBidWlsZFRib2R5KHNvcnRlZENsaWVudGVzKSB7XHJcbiAgY29uc3QgdGJvZHkgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCd0Ym9keScpO1xyXG4gIGZvciAoY29uc3QgYyBvZiBzb3J0ZWRDbGllbnRlcykge1xyXG4gICAgdGJvZHkuYXBwZW5kQ2hpbGQoYnVpbGRDbGllbnRlUm93KGMpKTtcclxuICB9XHJcbiAgcmV0dXJuIHRib2R5O1xyXG59XHJcblxyXG4vKiogQHBhcmFtIHthbnl9IGMgKi9cclxuZnVuY3Rpb24gYnVpbGRDbGllbnRlUm93KGMpIHtcclxuICBjb25zdCB0ciA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3RyJyk7XHJcbiAgdHIuc3R5bGUuY3NzVGV4dCA9ICdjdXJzb3I6cG9pbnRlcjtib3JkZXItYm90dG9tOjFweCBzb2xpZCB2YXIoLS1ib3JkZXItbGlnaHQpJztcclxuICB0ci5hZGRFdmVudExpc3RlbmVyKCdtb3VzZWVudGVyJywgKCkgPT4ge1xyXG4gICAgdHIuc3R5bGUuYmFja2dyb3VuZCA9ICd2YXIoLS1iZy1ob3ZlciknO1xyXG4gIH0pO1xyXG4gIHRyLmFkZEV2ZW50TGlzdGVuZXIoJ21vdXNlbGVhdmUnLCAoKSA9PiB7XHJcbiAgICB0ci5zdHlsZS5iYWNrZ3JvdW5kID0gJyc7XHJcbiAgfSk7XHJcbiAgdHIuYWRkRXZlbnRMaXN0ZW5lcignY2xpY2snLCAoKSA9PiB7XHJcbiAgICAvLyBAdHMtZXhwZWN0LWVycm9yXHJcbiAgICBpZiAodHlwZW9mIHdpbmRvdy5vcGVuRmljaGFDbGllbnRlID09PSAnZnVuY3Rpb24nKSB3aW5kb3cub3BlbkZpY2hhQ2xpZW50ZShjLmNsaWVudElkKTtcclxuICB9KTtcclxuXHJcbiAgY29uc3QgdGROYW1lID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgndGQnKTtcclxuICB0ZE5hbWUuc3R5bGUuY3NzVGV4dCA9ICdwYWRkaW5nOjZweCA4cHg7Zm9udC13ZWlnaHQ6NjAwJztcclxuICB0ZE5hbWUudGV4dENvbnRlbnQgPSBjLmNsaWVudE5hbWUgfHwgJyc7XHJcbiAgdHIuYXBwZW5kQ2hpbGQodGROYW1lKTtcclxuXHJcbiAgY29uc3QgdGRMb2MgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCd0ZCcpO1xyXG4gIHRkTG9jLnN0eWxlLmNzc1RleHQgPSAncGFkZGluZzo2cHggOHB4O2ZvbnQtc2l6ZToxMnB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpJztcclxuICB0ZExvYy50ZXh0Q29udGVudCA9IGAke2MucHJvdmluY2lhIHx8ICcnfS8ke2MubG9jYWxpZGFkIHx8ICcnfWA7XHJcbiAgdHIuYXBwZW5kQ2hpbGQodGRMb2MpO1xyXG5cclxuICBjb25zdCB0ZFRpcG8gPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCd0ZCcpO1xyXG4gIHRkVGlwby5zdHlsZS5jc3NUZXh0ID0gJ3BhZGRpbmc6NnB4IDhweDt0ZXh0LWFsaWduOmNlbnRlcic7XHJcbiAgY29uc3QgdGlwb0JhZGdlID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnc3BhbicpO1xyXG4gIHRpcG9CYWRnZS5zdHlsZS5jc3NUZXh0ID1cclxuICAgICdwYWRkaW5nOjJweCA2cHg7Ym9yZGVyLXJhZGl1czo0cHg7YmFja2dyb3VuZDp2YXIoLS1iZy1pbnB1dCk7Zm9udC1zaXplOjExcHg7Zm9udC13ZWlnaHQ6NzAwJztcclxuICB0aXBvQmFkZ2UudGV4dENvbnRlbnQgPSBjLmNsaVRpcG8gfHwgJy0nO1xyXG4gIHRkVGlwby5hcHBlbmRDaGlsZCh0aXBvQmFkZ2UpO1xyXG4gIHRyLmFwcGVuZENoaWxkKHRkVGlwbyk7XHJcblxyXG4gIHRyLmFwcGVuZENoaWxkKGJ1aWxkRGF0ZUNlbGwoYy51bHRpbWFWaXNpdGFQcmVzZW5jaWFsLCBjLmRpYXNTaW5WaXNpdGFQcmVzZW5jaWFsLCAzMCkpO1xyXG4gIHRyLmFwcGVuZENoaWxkKGJ1aWxkRGF0ZUNlbGwoYy51bHRpbW9Db250YWN0bywgYy5kaWFzU2luQ29udGFjdG8sIG51bGwpKTtcclxuICB0ci5hcHBlbmRDaGlsZChidWlsZERhdGVDZWxsKGMudWx0aW1hQ29tcHJhLCBjLmRpYXNTaW5Db21wcmEsIDkwKSk7XHJcblxyXG4gIGNvbnN0IHRkRmFjdCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3RkJyk7XHJcbiAgdGRGYWN0LnN0eWxlLmNzc1RleHQgPSAncGFkZGluZzo2cHggOHB4O3RleHQtYWxpZ246cmlnaHQ7Zm9udC12YXJpYW50LW51bWVyaWM6dGFidWxhci1udW1zJztcclxuICB0ZEZhY3QudGV4dENvbnRlbnQgPSBmbXRNb25leShjLmZhY3R1cmFkbzEyTSk7XHJcbiAgdHIuYXBwZW5kQ2hpbGQodGRGYWN0KTtcclxuXHJcbiAgY29uc3QgdGREZXVkYSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3RkJyk7XHJcbiAgdGREZXVkYS5zdHlsZS5jc3NUZXh0ID0gYHBhZGRpbmc6NnB4IDhweDt0ZXh0LWFsaWduOnJpZ2h0O2ZvbnQtdmFyaWFudC1udW1lcmljOnRhYnVsYXItbnVtcztjb2xvcjoke2MuZGV1ZGFBYmllcnRhID4gMCA/ICcjZGMyNjI2JyA6ICd2YXIoLS10ZXh0LW11dGVkKSd9YDtcclxuICB0ZERldWRhLnRleHRDb250ZW50ID0gZm10TW9uZXkoYy5kZXVkYUFiaWVydGEpO1xyXG4gIHRyLmFwcGVuZENoaWxkKHRkRGV1ZGEpO1xyXG5cclxuICByZXR1cm4gdHI7XHJcbn1cclxuXHJcbi8qKlxyXG4gKiBAcGFyYW0ge3N0cmluZ3xudWxsfSBmZWNoYUlzb1xyXG4gKiBAcGFyYW0ge251bWJlcnxudWxsfSBkaWFzXHJcbiAqIEBwYXJhbSB7bnVtYmVyfG51bGx9IGRhbmdlclRocmVzaG9sZFxyXG4gKi9cclxuZnVuY3Rpb24gYnVpbGREYXRlQ2VsbChmZWNoYUlzbywgZGlhcywgZGFuZ2VyVGhyZXNob2xkKSB7XHJcbiAgY29uc3QgdGQgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCd0ZCcpO1xyXG4gIGNvbnN0IGlzRGFuZ2VyID1cclxuICAgIGRhbmdlclRocmVzaG9sZCAhPT0gbnVsbCAmJiBkaWFzICE9PSBudWxsICYmIGRpYXMgIT09IHVuZGVmaW5lZCAmJiBkaWFzID4gZGFuZ2VyVGhyZXNob2xkO1xyXG4gIHRkLnN0eWxlLmNzc1RleHQgPSBgcGFkZGluZzo2cHggOHB4O2NvbG9yOiR7aXNEYW5nZXIgPyAnI2RjMjYyNicgOiAndmFyKC0tdGV4dC1wcmltYXJ5KSd9YDtcclxuICBpZiAoIWZlY2hhSXNvKSB7XHJcbiAgICB0ZC50ZXh0Q29udGVudCA9ICdcdTIwMTQnO1xyXG4gICAgcmV0dXJuIHRkO1xyXG4gIH1cclxuICBjb25zdCBwYXJ0cyA9IFN0cmluZyhmZWNoYUlzbykuc3BsaXQoJy0nKTtcclxuICBjb25zdCBkID0gcGFydHNbMl0gfHwgJyc7XHJcbiAgY29uc3QgbSA9IHBhcnRzWzFdIHx8ICcnO1xyXG4gIHRkLnRleHRDb250ZW50ID0gYCR7ZH0vJHttfWA7XHJcbiAgY29uc3QgZGlhc0VsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnc21hbGwnKTtcclxuICBkaWFzRWwuc3R5bGUuY3NzVGV4dCA9ICdjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTttYXJnaW4tbGVmdDo0cHgnO1xyXG4gIGRpYXNFbC50ZXh0Q29udGVudCA9IGAke2RpYXN9ZGA7XHJcbiAgdGQuYXBwZW5kQ2hpbGQoZGlhc0VsKTtcclxuICByZXR1cm4gdGQ7XHJcbn1cclxuXHJcbi8qKiBAcGFyYW0ge251bWJlcn0gbiAqL1xyXG5mdW5jdGlvbiBmbXRNb25leShuKSB7XHJcbiAgaWYgKCFuIHx8IG4gPT09IDApIHJldHVybiAnLSc7XHJcbiAgaWYgKG4gPj0gMV8wMDBfMDAwKSByZXR1cm4gYCQgJHsobiAvIDFfMDAwXzAwMCkudG9GaXhlZCgxKX1NYDtcclxuICBpZiAobiA+PSAxXzAwMCkgcmV0dXJuIGAkICR7KG4gLyAxXzAwMCkudG9GaXhlZCgwKX1rYDtcclxuICByZXR1cm4gYCQgJHtufWA7XHJcbn1cclxuXHJcbi8vID09PSBVSSBzdGF0ZSBoZWxwZXJzID09PVxyXG5mdW5jdGlvbiBoaWRlQWxsKCkge1xyXG4gIGNvbnN0IGlkcyA9IFtcclxuICAgICdjYXJ0ZXJhLWxvYWRpbmcnLFxyXG4gICAgJ2NhcnRlcmEtdGFibGUnLFxyXG4gICAgJ2NhcnRlcmEta3BpcycsXHJcbiAgICAnY2FydGVyYS1jaGlwcycsXHJcbiAgICAnY2FydGVyYS1lbXB0eScsXHJcbiAgXTtcclxuICBmb3IgKGNvbnN0IGlkIG9mIGlkcykge1xyXG4gICAgY29uc3QgZWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZChpZCk7XHJcbiAgICBpZiAoZWwpIGVsLnN0eWxlLmRpc3BsYXkgPSAnbm9uZSc7XHJcbiAgfVxyXG59XHJcbmZ1bmN0aW9uIHNob3dFbXB0eSgpIHtcclxuICBoaWRlQWxsKCk7XHJcbiAgY29uc3QgZW1wdHkgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY2FydGVyYS1lbXB0eScpO1xyXG4gIGlmIChlbXB0eSkge1xyXG4gICAgZW1wdHkuc3R5bGUuZGlzcGxheSA9ICdibG9jayc7XHJcbiAgICBlbXB0eS50ZXh0Q29udGVudCA9ICdFbGVnXHUwMEVEIHVuIHZlbmRlZG9yIHBhcmEgdmVyIHN1IGNhcnRlcmEuJztcclxuICB9XHJcbn1cclxuZnVuY3Rpb24gc2hvd0xvYWRpbmcoKSB7XHJcbiAgaGlkZUFsbCgpO1xyXG4gIGNvbnN0IGxvYWRpbmcgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY2FydGVyYS1sb2FkaW5nJyk7XHJcbiAgaWYgKGxvYWRpbmcpIGxvYWRpbmcuc3R5bGUuZGlzcGxheSA9ICdibG9jayc7XHJcbn1cclxuZnVuY3Rpb24gc2hvd05vRGF0YSgpIHtcclxuICBoaWRlQWxsKCk7XHJcbiAgY29uc3QgZW1wdHkgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY2FydGVyYS1lbXB0eScpO1xyXG4gIGlmIChlbXB0eSkge1xyXG4gICAgZW1wdHkuc3R5bGUuZGlzcGxheSA9ICdibG9jayc7XHJcbiAgICBlbXB0eS50ZXh0Q29udGVudCA9XHJcbiAgICAgICdTaW4gY2FydGVyYSBwYXJhIGVzdGUgdmVuZGVkb3IuIFZlcmlmaWNcdTAwRTEgYXNzaWduZWRWZW5kb3IgZW4gY2xpZW50X21hc3RlciBvIGVzcGVyXHUwMEUxIGFsIHByXHUwMEYzeGltbyBzbmFwc2hvdCAoMDQ6MDAgQVJUKS4nO1xyXG4gIH1cclxufVxyXG4vKiogQHBhcmFtIHtzdHJpbmd9IG1zZyAqL1xyXG5mdW5jdGlvbiBzaG93RXJyb3IobXNnKSB7XHJcbiAgaGlkZUFsbCgpO1xyXG4gIGNvbnN0IGVtcHR5ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2NhcnRlcmEtZW1wdHknKTtcclxuICBpZiAoZW1wdHkpIHtcclxuICAgIGVtcHR5LnN0eWxlLmRpc3BsYXkgPSAnYmxvY2snO1xyXG4gICAgZW1wdHkuc3R5bGUuY29sb3IgPSAnI2RjMjYyNic7XHJcbiAgICBlbXB0eS50ZXh0Q29udGVudCA9IGBFcnJvciBjYXJnYW5kbyBjYXJ0ZXJhOiAke21zZ31gO1xyXG4gIH1cclxufVxyXG5mdW5jdGlvbiBzaG93VGFibGUoKSB7XHJcbiAgY29uc3QgZW1wdHkgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY2FydGVyYS1lbXB0eScpO1xyXG4gIGlmIChlbXB0eSkgZW1wdHkuc3R5bGUuZGlzcGxheSA9ICdub25lJztcclxuICBjb25zdCBsb2FkaW5nID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2NhcnRlcmEtbG9hZGluZycpO1xyXG4gIGlmIChsb2FkaW5nKSBsb2FkaW5nLnN0eWxlLmRpc3BsYXkgPSAnbm9uZSc7XHJcbiAgY29uc3QgdGFibGUgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY2FydGVyYS10YWJsZScpO1xyXG4gIGlmICh0YWJsZSkgdGFibGUuc3R5bGUuZGlzcGxheSA9ICd0YWJsZSc7XHJcbiAgY29uc3Qga3BpcyA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdjYXJ0ZXJhLWtwaXMnKTtcclxuICBpZiAoa3Bpcykga3Bpcy5zdHlsZS5kaXNwbGF5ID0gJ2ZsZXgnO1xyXG4gIGNvbnN0IGNoaXBzID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2NhcnRlcmEtY2hpcHMnKTtcclxuICBpZiAoY2hpcHMpIGNoaXBzLnN0eWxlLmRpc3BsYXkgPSAnZmxleCc7XHJcbn1cclxuXHJcbi8vID09PSBFeHBvcnQgRXhjZWwgPT09XHJcbndpbmRvdy5leHBvcnRDYXJ0ZXJhVG9FeGNlbCA9IGFzeW5jIGZ1bmN0aW9uIGV4cG9ydENhcnRlcmFUb0V4Y2VsKCkge1xyXG4gIGlmICghc2VsZWN0ZWRWZW5kb3IpIHtcclxuICAgIGFsZXJ0KCdFbGVnXHUwMEVEIHVuIHZlbmRlZG9yIHByaW1lcm8uJyk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIGNvbnN0IGRvYyA9IGNhcnRlcmFEb2NDYWNoZS5nZXQoc2VsZWN0ZWRWZW5kb3IpO1xyXG4gIGlmICghZG9jKSB7XHJcbiAgICBhbGVydCgnU2luIGRhdGEgY2FyZ2FkYS4nKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgY29uc3QgZmlsdGVyZWQgPSBhcHBseUNoaXBGaWx0ZXIoZG9jLmNsaWVudGVzLCBhY3RpdmVDaGlwKTtcclxuICBjb25zdCBzZWFyY2hlZCA9IHNlYXJjaFF1ZXJ5XHJcbiAgICA/IGZpbHRlcmVkLmZpbHRlcigoYykgPT5cclxuICAgICAgICBTdHJpbmcoYy5jbGllbnROYW1lIHx8ICcnKVxyXG4gICAgICAgICAgLnRvTG93ZXJDYXNlKClcclxuICAgICAgICAgIC5pbmNsdWRlcyhzZWFyY2hRdWVyeSlcclxuICAgICAgKVxyXG4gICAgOiBmaWx0ZXJlZDtcclxuICBjb25zdCBzb3J0ZWQgPSBzb3J0Q2xpZW50ZXMoc2VhcmNoZWQsIHNvcnRCeSwgc29ydERpcik7XHJcblxyXG4gIGNvbnN0IGNoaXBMYWJlbCA9IChDSElQUy5maW5kKChjKSA9PiBjLmlkID09PSBhY3RpdmVDaGlwKSB8fCB7IGxhYmVsOiAnVG9kb3MnIH0pLmxhYmVsO1xyXG4gIGNvbnN0IHRpdGxlID0gYENhcnRlcmEgZGUgJHtzZWxlY3RlZFZlbmRvcn0gXHUyMDE0ICR7Y2hpcExhYmVsfSBcdTIwMTQgU25hcHNob3QgJHtkb2Muc25hcHNob3REYXRlfWA7XHJcblxyXG4gIHRyeSB7XHJcbiAgICBpZiAodHlwZW9mIHdpbmRvdy5sb2FkRXhjZWxKUyA9PT0gJ2Z1bmN0aW9uJykge1xyXG4gICAgICBhd2FpdCB3aW5kb3cubG9hZEV4Y2VsSlMoKTtcclxuICAgIH1cclxuICAgIGNvbnN0IEV4Y2VsSlMgPSB3aW5kb3cuRXhjZWxKUztcclxuICAgIGlmICghRXhjZWxKUykgdGhyb3cgbmV3IEVycm9yKCdFeGNlbEpTIG5vIGRpc3BvbmlibGUnKTtcclxuICAgIGNvbnN0IHdiID0gbmV3IEV4Y2VsSlMuV29ya2Jvb2soKTtcclxuICAgIGNvbnN0IHdzID0gd2IuYWRkV29ya3NoZWV0KCdDYXJ0ZXJhJyk7XHJcblxyXG4gICAgLy8gRmlsYSAxOiB0aXR1bG8gYmFuZGEgdmVyZGUgU2hpbWFub1xyXG4gICAgd3MubWVyZ2VDZWxscygnQTE6TDEnKTtcclxuICAgIGNvbnN0IHRpdGxlQ2VsbCA9IHdzLmdldENlbGwoJ0ExJyk7XHJcbiAgICB0aXRsZUNlbGwudmFsdWUgPSB0aXRsZTtcclxuICAgIHRpdGxlQ2VsbC5maWxsID0geyB0eXBlOiAncGF0dGVybicsIHBhdHRlcm46ICdzb2xpZCcsIGZnQ29sb3I6IHsgYXJnYjogJ0ZGMjJDNTVFJyB9IH07XHJcbiAgICB0aXRsZUNlbGwuZm9udCA9IHsgYm9sZDogdHJ1ZSwgY29sb3I6IHsgYXJnYjogJ0ZGRkZGRkZGJyB9LCBzaXplOiAxNCB9O1xyXG4gICAgdGl0bGVDZWxsLmFsaWdubWVudCA9IHsgaG9yaXpvbnRhbDogJ2NlbnRlcicsIHZlcnRpY2FsOiAnbWlkZGxlJyB9O1xyXG4gICAgd3MuZ2V0Um93KDEpLmhlaWdodCA9IDMwO1xyXG5cclxuICAgIC8vIEZpbGEgMjogaGVhZGVyc1xyXG4gICAgY29uc3QgaGVhZGVycyA9IFtcclxuICAgICAgJ0NsaWVudGUnLFxyXG4gICAgICAnUHJvdmluY2lhJyxcclxuICAgICAgJ0xvY2FsaWRhZCcsXHJcbiAgICAgICdUaXBvJyxcclxuICAgICAgJ1x1MDBEQWx0aW1hIHZpc2l0YSBwcmVzZW5jaWFsJyxcclxuICAgICAgJ1x1MDBEQWx0aW1vIGNvbnRhY3RvJyxcclxuICAgICAgJ1x1MDBEQWx0aW1hIGNvbXByYScsXHJcbiAgICAgICdGYWN0IDEyTSAoQVJTKScsXHJcbiAgICAgICdEZXVkYSBhYmllcnRhIChBUlMpJyxcclxuICAgICAgJ0RcdTAwRURhcyBzaW4gdmlzaXRhJyxcclxuICAgICAgJ0RcdTAwRURhcyBzaW4gY29tcHJhJyxcclxuICAgICAgJ0NhcmRDb2RlIFNBUCcsXHJcbiAgICBdO1xyXG4gICAgY29uc3QgaGVhZGVyUm93ID0gd3MuZ2V0Um93KDIpO1xyXG4gICAgaGVhZGVycy5mb3JFYWNoKChoLCBpKSA9PiB7XHJcbiAgICAgIGNvbnN0IGNlbGwgPSBoZWFkZXJSb3cuZ2V0Q2VsbChpICsgMSk7XHJcbiAgICAgIGNlbGwudmFsdWUgPSBoO1xyXG4gICAgICBjZWxsLmZpbGwgPSB7IHR5cGU6ICdwYXR0ZXJuJywgcGF0dGVybjogJ3NvbGlkJywgZmdDb2xvcjogeyBhcmdiOiAnRkYwNzRGNjknIH0gfTtcclxuICAgICAgY2VsbC5mb250ID0geyBib2xkOiB0cnVlLCBjb2xvcjogeyBhcmdiOiAnRkZGRkZGRkYnIH0gfTtcclxuICAgICAgY2VsbC5hbGlnbm1lbnQgPSB7IGhvcml6b250YWw6ICdjZW50ZXInIH07XHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBGaWxhcyAzKzogZGF0YVxyXG4gICAgc29ydGVkLmZvckVhY2goKGMsIGkpID0+IHtcclxuICAgICAgY29uc3Qgcm93ID0gd3MuZ2V0Um93KDMgKyBpKTtcclxuICAgICAgcm93LmdldENlbGwoMSkudmFsdWUgPSBjLmNsaWVudE5hbWUgfHwgJyc7XHJcbiAgICAgIHJvdy5nZXRDZWxsKDIpLnZhbHVlID0gYy5wcm92aW5jaWEgfHwgJyc7XHJcbiAgICAgIHJvdy5nZXRDZWxsKDMpLnZhbHVlID0gYy5sb2NhbGlkYWQgfHwgJyc7XHJcbiAgICAgIHJvdy5nZXRDZWxsKDQpLnZhbHVlID0gYy5jbGlUaXBvIHx8ICcnO1xyXG4gICAgICByb3cuZ2V0Q2VsbCg1KS52YWx1ZSA9IGMudWx0aW1hVmlzaXRhUHJlc2VuY2lhbCB8fCAnJztcclxuICAgICAgcm93LmdldENlbGwoNikudmFsdWUgPSBjLnVsdGltb0NvbnRhY3RvIHx8ICcnO1xyXG4gICAgICByb3cuZ2V0Q2VsbCg3KS52YWx1ZSA9IGMudWx0aW1hQ29tcHJhIHx8ICcnO1xyXG4gICAgICByb3cuZ2V0Q2VsbCg4KS52YWx1ZSA9IGMuZmFjdHVyYWRvMTJNIHx8IDA7XHJcbiAgICAgIHJvdy5nZXRDZWxsKDgpLm51bUZtdCA9ICdcIiRcIiMsIyMwJztcclxuICAgICAgcm93LmdldENlbGwoOSkudmFsdWUgPSBjLmRldWRhQWJpZXJ0YSB8fCAwO1xyXG4gICAgICByb3cuZ2V0Q2VsbCg5KS5udW1GbXQgPSAnXCIkXCIjLCMjMCc7XHJcbiAgICAgIHJvdy5nZXRDZWxsKDEwKS52YWx1ZSA9IGMuZGlhc1NpblZpc2l0YVByZXNlbmNpYWw7XHJcbiAgICAgIHJvdy5nZXRDZWxsKDExKS52YWx1ZSA9IGMuZGlhc1NpbkNvbXByYTtcclxuICAgICAgcm93LmdldENlbGwoMTIpLnZhbHVlID0gYy5jYXJkQ29kZSB8fCAnJztcclxuICAgIH0pO1xyXG5cclxuICAgIHdzLmNvbHVtbnMuZm9yRWFjaCgoY29sLCBpKSA9PiB7XHJcbiAgICAgIGNvbC53aWR0aCA9IGkgPT09IDAgPyAzMCA6IGkgPT09IDQgfHwgaSA9PT0gNSB8fCBpID09PSA2ID8gMTggOiAxNDtcclxuICAgIH0pO1xyXG5cclxuICAgIGNvbnN0IGJ1ZiA9IGF3YWl0IHdiLnhsc3gud3JpdGVCdWZmZXIoKTtcclxuICAgIGNvbnN0IGJsb2IgPSBuZXcgQmxvYihbYnVmXSwge1xyXG4gICAgICB0eXBlOiAnYXBwbGljYXRpb24vdm5kLm9wZW54bWxmb3JtYXRzLW9mZmljZWRvY3VtZW50LnNwcmVhZHNoZWV0bWwuc2hlZXQnLFxyXG4gICAgfSk7XHJcbiAgICBjb25zdCB1cmwgPSBVUkwuY3JlYXRlT2JqZWN0VVJMKGJsb2IpO1xyXG4gICAgY29uc3QgYSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2EnKTtcclxuICAgIGEuaHJlZiA9IHVybDtcclxuICAgIGEuZG93bmxvYWQgPSBgQ2FydGVyYV8ke1N0cmluZyhzZWxlY3RlZFZlbmRvcikucmVwbGFjZSgvXFxzKy9nLCAnXycpfV8ke2FjdGl2ZUNoaXB9XyR7ZG9jLnNuYXBzaG90RGF0ZX0ueGxzeGA7XHJcbiAgICBkb2N1bWVudC5ib2R5LmFwcGVuZENoaWxkKGEpO1xyXG4gICAgYS5jbGljaygpO1xyXG4gICAgYS5yZW1vdmUoKTtcclxuICAgIFVSTC5yZXZva2VPYmplY3RVUkwodXJsKTtcclxuICB9IGNhdGNoIChlKSB7XHJcbiAgICBjb25zb2xlLmVycm9yKCdleHBvcnRDYXJ0ZXJhVG9FeGNlbCBmYWlsZWQnLCBlKTtcclxuICAgIGFsZXJ0KCdFcnJvciBleHBvcnRhbmRvOiAnICsgU3RyaW5nKGUpKTtcclxuICB9XHJcbn07XHJcbiJdLAogICJtYXBwaW5ncyI6ICI7OztBQWVPLFdBQVMsZ0JBQWdCLFVBQVUsTUFBTTtBQUM5QyxRQUFJLENBQUMsTUFBTSxRQUFRLFFBQVEsRUFBRyxRQUFPLENBQUM7QUFDdEMsWUFBUSxNQUFNO0FBQUEsTUFDWixLQUFLO0FBQ0gsZUFBTyxTQUFTO0FBQUEsVUFDZCxDQUFDLE1BQU0sRUFBRSxrQkFBa0IsUUFBUSxFQUFFLGtCQUFrQixVQUFhLEVBQUUsaUJBQWlCO0FBQUEsUUFDekY7QUFBQSxNQUNGLEtBQUs7QUFDSCxlQUFPLFNBQVM7QUFBQSxVQUNkLENBQUMsTUFDQyxFQUFFLDRCQUE0QixRQUM5QixFQUFFLDRCQUE0QixVQUM5QixFQUFFLDBCQUEwQjtBQUFBLFFBQ2hDO0FBQUEsTUFDRixLQUFLO0FBQ0gsZUFBTyxTQUFTO0FBQUEsVUFDZCxDQUFDLE1BQU0sRUFBRSxrQkFBa0IsUUFBUSxFQUFFLGtCQUFrQixVQUFhLEVBQUUsZ0JBQWdCO0FBQUEsUUFDeEY7QUFBQSxNQUNGLEtBQUs7QUFDSCxlQUFPLFNBQVM7QUFBQSxVQUNkLENBQUMsTUFBTSxFQUFFLDJCQUEyQixRQUFRLEVBQUUsMkJBQTJCO0FBQUEsUUFDM0U7QUFBQSxNQUNGLEtBQUs7QUFDSCxlQUFPLFNBQVMsT0FBTyxDQUFDLE1BQU0sRUFBRSxpQkFBaUIsUUFBUSxFQUFFLGlCQUFpQixNQUFTO0FBQUEsTUFDdkY7QUFDRSxlQUFPLFNBQVMsTUFBTTtBQUFBLElBQzFCO0FBQUEsRUFDRjtBQVNPLFdBQVMsYUFBYSxVQUFVQSxTQUFRQyxVQUFTO0FBQ3RELFFBQUksQ0FBQyxNQUFNLFFBQVEsUUFBUSxFQUFHLFFBQU8sQ0FBQztBQUN0QyxVQUFNLE1BQU1BLGFBQVksUUFBUSxJQUFJO0FBQ3BDLFVBQU0sT0FBTyxTQUFTLE1BQU07QUFDNUIsU0FBSyxLQUFLLENBQUMsR0FBRyxNQUFNO0FB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
