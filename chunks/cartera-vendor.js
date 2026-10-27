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

  // src/pure/ficha-cliente-labels.js
  var FICHA_CLASIF_LABELS = Object.freeze({
    cliTipo: Object.freeze({
      P: "P (Premium) - fijo 6% / anticipado 5%",
      A: "A - fijo 3% / anticipado 3%",
      B: "B - sin descuento",
      C: "C - sin descuento"
    }),
    fidelidad: Object.freeze({
      ALTA: "Alta",
      MEDIA: "Media",
      BAJA: "Baja"
    }),
    prefContacto: Object.freeze({
      CALL_CENTER: "Call Center",
      PRESENCIAL: "Presencial",
      AMBOS: "Ambos",
      AUTOGESTION_B2B: "Autogesti\xF3n (B2B)"
    }),
    tamano: Object.freeze({
      GRANDE: "Grande",
      MEDIANO: "Mediano",
      CHICA: "Chica",
      LODGE: "Lodge",
      GUIA_DE_PESCA: "Gu\xEDa de pesca",
      VENTAS_ESPECIALES: "Ventas especiales"
    }),
    especializacion: Object.freeze({
      AGUA_DULCE: "Agua dulce",
      PESCA_DE_MAR: "Pesca de mar",
      ALTA_GAMA: "Alta gama",
      BAJA_GENERAL: "Baja - General"
    }),
    tipoLocal: Object.freeze({
      FISICO: "F\xEDsico",
      ECOMMERCE: "E-commerce"
    })
  });
  function labelForFichaField(field, value) {
    if (value === null || value === void 0 || value === "") return "-";
    const map = (
      /** @type {Record<string, Record<string, string>>} */
      FICHA_CLASIF_LABELS[field]
    );
    if (!map) return "-";
    const key = String(value).toUpperCase();
    return map[key] || "-";
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
    tipoBadge.textContent = labelForFichaField("cliTipo", c.cliTipo);
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
        row.getCell(4).value = labelForFichaField("cliTipo", c.cliTipo);
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL3B1cmUvY2FydGVyYS12ZW5kb3ItZmlsdGVyLmpzIiwgIi4uL3NyYy9wdXJlL2ZpY2hhLWNsaWVudGUtbGFiZWxzLmpzIiwgIi4uL3NyYy9kb21haW5zL2NhcnRlcmEtdmVuZG9yLmpzIl0sCiAgInNvdXJjZXNDb250ZW50IjogWyIvLyBAdHMtY2hlY2tcbi8qKlxuICogY2FydGVyYS12ZW5kb3ItZmlsdGVyLmpzICh2MTI4MywgMjAyNi0xMC0yMClcbiAqXG4gKiBQdXJhcyBwYXJhIGZpbHRyYXIgeSBvcmRlbmFyIGxhIHRhYmxhIGRlbCBkYXNoYm9hcmQgXCJBbmFsaXNpcyBkZSBDYXJ0ZXJhXCIuXG4gKiBJbXBvcnRhZG8gcG9yIHNyYy9kb21haW5zL2NhcnRlcmEtdmVuZG9yLmpzIChidW5kbGUgZnJvbnRlbmQpLlxuICogVGVzdGVhZG8gZW4gdGVzdHMvdW5pdC9jYXJ0ZXJhLXZlbmRvci1maWx0ZXIudGVzdC5qcy5cbiAqL1xuXG4vKipcbiAqIEFwbGljYSB1biBjaGlwIGRlIGZpbHRybyBhbCBhcnJheSBkZSBjbGllbnRlcy5cbiAqIEBwYXJhbSB7QXJyYXk8YW55Pn0gY2xpZW50ZXNcbiAqIEBwYXJhbSB7c3RyaW5nfSBjaGlwXG4gKiBAcmV0dXJucyB7QXJyYXk8YW55Pn1cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGFwcGx5Q2hpcEZpbHRlcihjbGllbnRlcywgY2hpcCkge1xuICBpZiAoIUFycmF5LmlzQXJyYXkoY2xpZW50ZXMpKSByZXR1cm4gW107XG4gIHN3aXRjaCAoY2hpcCkge1xuICAgIGNhc2UgJ2Jhc2VBY3RpdmE5MGQnOlxuICAgICAgcmV0dXJuIGNsaWVudGVzLmZpbHRlcihcbiAgICAgICAgKGMpID0+IGMuZGlhc1NpbkNvbXByYSAhPT0gbnVsbCAmJiBjLmRpYXNTaW5Db21wcmEgIT09IHVuZGVmaW5lZCAmJiBjLmRpYXNTaW5Db21wcmEgPD0gOTBcbiAgICAgICk7XG4gICAgY2FzZSAnZG9ybWlkb3NWaXNpdGEzMGQnOlxuICAgICAgcmV0dXJuIGNsaWVudGVzLmZpbHRlcihcbiAgICAgICAgKGMpID0+XG4gICAgICAgICAgYy5kaWFzU2luVmlzaXRhUHJlc2VuY2lhbCAhPT0gbnVsbCAmJlxuICAgICAgICAgIGMuZGlhc1NpblZpc2l0YVByZXNlbmNpYWwgIT09IHVuZGVmaW5lZCAmJlxuICAgICAgICAgIGMuZGlhc1NpblZpc2l0YVByZXNlbmNpYWwgPiAzMFxuICAgICAgKTtcbiAgICBjYXNlICdkb3JtaWRvc0NvbXByYTkwZCc6XG4gICAgICByZXR1cm4gY2xpZW50ZXMuZmlsdGVyKFxuICAgICAgICAoYykgPT4gYy5kaWFzU2luQ29tcHJhICE9PSBudWxsICYmIGMuZGlhc1NpbkNvbXByYSAhPT0gdW5kZWZpbmVkICYmIGMuZGlhc1NpbkNvbXByYSA+IDkwXG4gICAgICApO1xuICAgIGNhc2UgJ251bmNhVmlzaXRhZG9zJzpcbiAgICAgIHJldHVybiBjbGllbnRlcy5maWx0ZXIoXG4gICAgICAgIChjKSA9PiBjLnVsdGltYVZpc2l0YVByZXNlbmNpYWwgPT09IG51bGwgfHwgYy51bHRpbWFWaXNpdGFQcmVzZW5jaWFsID09PSB1bmRlZmluZWRcbiAgICAgICk7XG4gICAgY2FzZSAnbnVuY2FDb21wcmFyb24nOlxuICAgICAgcmV0dXJuIGNsaWVudGVzLmZpbHRlcigoYykgPT4gYy51bHRpbWFDb21wcmEgPT09IG51bGwgfHwgYy51bHRpbWFDb21wcmEgPT09IHVuZGVmaW5lZCk7XG4gICAgZGVmYXVsdDpcbiAgICAgIHJldHVybiBjbGllbnRlcy5zbGljZSgpO1xuICB9XG59XG5cbi8qKlxuICogT3JkZW5hIHVuYSBjb3BpYSBkZWwgYXJyYXkgcG9yIGNvbHVtbmEuIE51bGxzIHNpZW1wcmUgYWwgZmluYWwuXG4gKiBAcGFyYW0ge0FycmF5PGFueT59IGNsaWVudGVzXG4gKiBAcGFyYW0ge3N0cmluZ30gc29ydEJ5XG4gKiBAcGFyYW0geydhc2MnfCdkZXNjJ30gc29ydERpclxuICogQHJldHVybnMge0FycmF5PGFueT59XG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzb3J0Q2xpZW50ZXMoY2xpZW50ZXMsIHNvcnRCeSwgc29ydERpcikge1xuICBpZiAoIUFycmF5LmlzQXJyYXkoY2xpZW50ZXMpKSByZXR1cm4gW107XG4gIGNvbnN0IGRpciA9IHNvcnREaXIgPT09ICdhc2MnID8gMSA6IC0xO1xuICBjb25zdCBjb3B5ID0gY2xpZW50ZXMuc2xpY2UoKTtcbiAgY29weS5zb3J0KChhLCBiKSA9PiB7XG4gICAgY29uc3QgYXYgPSBhW3NvcnRCeV07XG4gICAgY29uc3QgYnYgPSBiW3NvcnRCeV07XG4gICAgY29uc3QgYU51bGwgPSBhdiA9PT0gbnVsbCB8fCBhdiA9PT0gdW5kZWZpbmVkO1xuICAgIGNvbnN0IGJOdWxsID0gYnYgPT09IG51bGwgfHwgYnYgPT09IHVuZGVmaW5lZDtcbiAgICBpZiAoYU51bGwgJiYgYk51bGwpIHJldHVybiAwO1xuICAgIGlmIChhTnVsbCkgcmV0dXJuIDE7XG4gICAgaWYgKGJOdWxsKSByZXR1cm4gLTE7XG4gICAgaWYgKHR5cGVvZiBhdiA9PT0gJ251bWJlcicgJiYgdHlwZW9mIGJ2ID09PSAnbnVtYmVyJykgcmV0dXJuIChhdiAtIGJ2KSAqIGRpcjtcbiAgICByZXR1cm4gU3RyaW5nKGF2KS5sb2NhbGVDb21wYXJlKFN0cmluZyhidikpICogZGlyO1xuICB9KTtcbiAgcmV0dXJuIGNvcHk7XG59XG4iLCAiLy8gQHRzLWNoZWNrXG4vKipcbiAqIGZpY2hhLWNsaWVudGUtbGFiZWxzICh2MTQ4MiwgMjAyNi0xMC0yNykgXHUyMDE0IGZ1ZW50ZSBcdTAwRkFuaWNhIGRlIGxhYmVscyB5XG4gKiBjb21wb3NlLXJvdyBwYXJhIGxvcyBjYW1wb3MgZGUgbGEgRmljaGEgQ2xpZW50ZSAobW9kYWxcbiAqICNmaWNoYS1jbGllbnRlLW1vZGFsLCBwZXN0YVx1MDBGMWFzIENsYXNpZmljYWNpXHUwMEYzbiArIEJ1eWVyKS5cbiAqXG4gKiBNYXJpYW5vIHYxNDgyOiByZXVzYXIgZW4gTWFzdGVyZmlsZSBleHBvcnQgKyBBblx1MDBFMWxpc2lzIGRlIENhcnRlcmEgcG9yXG4gKiBWZW5kZWRvciBwYXJhIG5vIGR1cGxpY2FyIGVsIG1hcGVvIGRlIGV0aXF1ZXRhcy4gTG9zIGxhYmVscyBzb24gbG9zXG4gKiBFWEFDVE9TIHF1ZSBhcGFyZWNlbiBlbiBsb3MgYDxvcHRpb24+YCBkZWwgbW9kYWwgKHZlciBpbmRleC5odG1sOjU5MTkrKS5cbiAqXG4gKiBSZWdsYSBkZSBsbGVuYWRvOiBzaSBlbCBjbGllbnRlIHRpZW5lIGVsIGRhdG8sIHZhIGVsIHZhbG9yIHRhbCBjdWFsIHNlXG4gKiBtdWVzdHJhIGVuIGxhIEZpY2hhIChcIkIgLSBzaW4gZGVzY3VlbnRvXCIsIG5vIGVsIGNcdTAwRjNkaWdvIFwiQlwiKTsgc2kgbm8gbG9cbiAqIHRpZW5lLCB2YSBcIi1cIi4gTmluZ3VuYSBjZWxkYSBxdWVkYSB2YWNcdTAwRURhLlxuICpcbiAqIEZ1ZW50ZXM6XG4gKiAgIC0gY21EYXRhID0gY2xpZW50X21hc3Rlci97ZG9jSWR9OiBjbGlUaXBvLCBmaWRlbGlkYWQsIHByZWZDb250YWN0byxcbiAqICAgICB0YW1hbm8sIGVzcGVjaWFsaXphY2lvbiwgdGlwb0xvY2FsLCBjcmVkaXRvQ2hlcXVlIChjYW1wb3MgZGUgbGFcbiAqICAgICBwZXN0YVx1MDBGMWEgQ2xhc2lmaWNhY2lcdTAwRjNuIGRlIGxhIEZpY2hhKS5cbiAqICAgLSBidXllclN0YXRzID0gY2xpZW50X2J1eWVyX3N0YXRzL3tjYXJkQ29kZX06IHN0YXRzXzEybSBjb24gbW9udG9Ub3RhbCxcbiAqICAgICBmYWN0dXJhc0NvdW50LCBtb250b1Byb21lZGlvLCBmcmVjdWVuY2lhRGlhcywgZmFjdHVyYXNQb3JNZXMsXG4gKiAgICAgdWx0aW1hQ29tcHJhLCBkaWFzRGVzZGVVbHRpbWEsIHByaW1lcmFDb21wcmEgKHBlc3RhXHUwMEYxYSBCdXllciwgdmVudGFuYVxuICogICAgIHBvciBkZWZhdWx0IDEyIG1lc2VzIFx1MjAxNCBtaXNtYSBxdWUgYXJyYW5jYSBlbCBtb2RhbCkuXG4gKi9cblxuLyoqXG4gKiBMYWJlbHMgZGUgbG9zIHNlbGVjdHMgZGUgbGEgcGVzdGFcdTAwRjFhIENsYXNpZmljYWNpXHUwMEYzbi4gTWFwZWEgY1x1MDBGM2RpZ28gaW50ZXJub1xuICogKGxvIHF1ZSBzZSBwZXJzaXN0ZSBlbiBGaXJlc3RvcmUpIFx1MjE5MiBsYWJlbCBsZWdpYmxlIChsbyBxdWUgbXVlc3RyYSBlbFxuICogbW9kYWwpLiBGdWVudGU6IGluZGV4Lmh0bWw6NTkxOS01OTc3IChvcHRpb24gdmFsdWVzICsgZGlzcGxheSB0ZXh0KS5cbiAqXG4gKiBPcGNpXHUwMEYzbiBcIlwiIChzaW4gY2xhc2lmaWNhcikgTk8gc2UgbWFwZWEgYWNcdTAwRTEgXHUyMDE0IHNlIHRyYXRhIGNvbW8gXCJzaW4gdmFsb3JcIlxuICogZW4gbGFiZWxGb3JGaWNoYUZpZWxkIFx1MjE5MiBkZXZ1ZWx2ZSBcIi1cIi5cbiAqL1xuZXhwb3J0IGNvbnN0IEZJQ0hBX0NMQVNJRl9MQUJFTFMgPSBPYmplY3QuZnJlZXplKHtcbiAgY2xpVGlwbzogT2JqZWN0LmZyZWV6ZSh7XG4gICAgUDogJ1AgKFByZW1pdW0pIC0gZmlqbyA2JSAvIGFudGljaXBhZG8gNSUnLFxuICAgIEE6ICdBIC0gZmlqbyAzJSAvIGFudGljaXBhZG8gMyUnLFxuICAgIEI6ICdCIC0gc2luIGRlc2N1ZW50bycsXG4gICAgQzogJ0MgLSBzaW4gZGVzY3VlbnRvJyxcbiAgfSksXG4gIGZpZGVsaWRhZDogT2JqZWN0LmZyZWV6ZSh7XG4gICAgQUxUQTogJ0FsdGEnLFxuICAgIE1FRElBOiAnTWVkaWEnLFxuICAgIEJBSkE6ICdCYWphJyxcbiAgfSksXG4gIHByZWZDb250YWN0bzogT2JqZWN0LmZyZWV6ZSh7XG4gICAgQ0FMTF9DRU5URVI6ICdDYWxsIENlbnRlcicsXG4gICAgUFJFU0VOQ0lBTDogJ1ByZXNlbmNpYWwnLFxuICAgIEFNQk9TOiAnQW1ib3MnLFxuICAgIEFVVE9HRVNUSU9OX0IyQjogJ0F1dG9nZXN0aVx1MDBGM24gKEIyQiknLFxuICB9KSxcbiAgdGFtYW5vOiBPYmplY3QuZnJlZXplKHtcbiAgICBHUkFOREU6ICdHcmFuZGUnLFxuICAgIE1FRElBTk86ICdNZWRpYW5vJyxcbiAgICBDSElDQTogJ0NoaWNhJyxcbiAgICBMT0RHRTogJ0xvZGdlJyxcbiAgICBHVUlBX0RFX1BFU0NBOiAnR3VcdTAwRURhIGRlIHBlc2NhJyxcbiAgICBWRU5UQVNfRVNQRUNJQUxFUzogJ1ZlbnRhcyBlc3BlY2lhbGVzJyxcbiAgfSksXG4gIGVzcGVjaWFsaXphY2lvbjogT2JqZWN0LmZyZWV6ZSh7XG4gICAgQUdVQV9EVUxDRTogJ0FndWEgZHVsY2UnLFxuICAgIFBFU0NBX0RFX01BUjogJ1Blc2NhIGRlIG1hcicsXG4gICAgQUxUQV9HQU1BOiAnQWx0YSBnYW1hJyxcbiAgICBCQUpBX0dFTkVSQUw6ICdCYWphIC0gR2VuZXJhbCcsXG4gIH0pLFxuICB0aXBvTG9jYWw6IE9iamVjdC5mcmVlemUoe1xuICAgIEZJU0lDTzogJ0ZcdTAwRURzaWNvJyxcbiAgICBFQ09NTUVSQ0U6ICdFLWNvbW1lcmNlJyxcbiAgfSksXG59KTtcblxuLyoqXG4gKiBEZXZ1ZWx2ZSBlbCBsYWJlbCBsZWdpYmxlIGRlIHVuIGNhbXBvIGRlIGxhIEZpY2hhLiBTaSBlbCB2YWx1ZSBlc3RcdTAwRTFcbiAqIHZhY1x1MDBFRG8vbnVsbC91bmRlZmluZWQgbyBubyBtYXBlYWRvLCBkZXZ1ZWx2ZSBcIi1cIi5cbiAqXG4gKiBAcGFyYW0ge3N0cmluZ30gZmllbGQgIG5vbWJyZSBkZWwgY2FtcG8gKGNsaVRpcG8sIGZpZGVsaWRhZCwgLi4uKS5cbiAqIEBwYXJhbSB7c3RyaW5nIHwgbnVsbCB8IHVuZGVmaW5lZH0gdmFsdWUgIHZhbG9yIHBlcnNpc3RpZG8gZW4gRmlyZXN0b3JlLlxuICogQHJldHVybnMge3N0cmluZ31cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGxhYmVsRm9yRmljaGFGaWVsZChmaWVsZCwgdmFsdWUpIHtcbiAgaWYgKHZhbHVlID09PSBudWxsIHx8IHZhbHVlID09PSB1bmRlZmluZWQgfHwgdmFsdWUgPT09ICcnKSByZXR1cm4gJy0nO1xuICBjb25zdCBtYXAgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJlY29yZDxzdHJpbmcsIHN0cmluZz4+fSAqLyAoRklDSEFfQ0xBU0lGX0xBQkVMUylbZmllbGRdO1xuICBpZiAoIW1hcCkgcmV0dXJuICctJztcbiAgY29uc3Qga2V5ID0gU3RyaW5nKHZhbHVlKS50b1VwcGVyQ2FzZSgpO1xuICByZXR1cm4gbWFwW2tleV0gfHwgJy0nO1xufVxuXG4vKipcbiAqIEJ1c2NhIGVsIGRvYyBgY2xpZW50X21hc3RlcmAgcXVlIGNvcnJlc3BvbmRlIGEgdW4gY2FyZENvZGUgU0FQLlxuICogU2NhbiBgY2xpZW50TWFzdGVyQ2FjaGVgIHBvciBgc2FwQ2FyZENvZGVgIE9SIGBjYXJkQ29kZVNhcGAgKGFtYm9zIGFsaWFzZXNcbiAqIGFwYXJlY2VuIGVuIHByb2Qgc2VnXHUwMEZBbiBlbCBmbG93IHF1ZSBjcmVcdTAwRjMgZWwgZG9jKS5cbiAqXG4gKiAqKlBvciBxdVx1MDBFOSBleGlzdGUgKHYxNDg1IFx1MDBBNzg0LCAyMDI2LTEwLTI3IGJ1ZyBmaXgpKio6IGVuIHYxNDgyIGVsIGV4cG9ydFxuICogYnVzY2FiYSBgY2xpZW50TWFzdGVyQ2FjaGUuZ2V0KGNsaWVudExvY0lkKHBvaW50LnByb3ZpbmNlLCBwb2ludC5uYW1lLCBuYW1lKSlgXG4gKiBcdTIwMTQgc2x1ZyBkZXJpdmFkbyBkZWwgcGFkclx1MDBGM24gUE9JTlRTLiBQYXJhIGNsaWVudGVzIGNvbW8gQUxCRVJUTyBNQVhFUkEsIGVsXG4gKiBQT0lOVFMgZGljZSBgbmFtZT1cIlBhbGVybW8gKEMxNClcImAgcGVybyBsYSBGaWNoYSBwZXJzaXN0ZSBjb25cbiAqIGBsb2NhbGlkYWQ9XCJDT0xFR0lBTEVTXCJgIFx1MjE5MiBnZW5lcmEgZG9jSWQgZGlzdGludG8gXHUyMTkyIGNtRGF0YSB1bmRlZmluZWQgXHUyMTkyIGxvc1xuICogNiBjYW1wb3Mgc2FsXHUwMEVEYW4gXCItXCIgYXVucXVlIGxhIEZpY2hhIGVzdGFiYSBjYXJnYWRhLiBgc2FwQ2FyZENvZGVgIGVzIFx1MDBGQW5pY29cbiAqIHkgU0lFTVBSRSBpZGVudGlmaWNhIGVsIGRvYyBjb3JyZWN0by4gUGF0dGVybiB5YSBleGlzdGVudGUgZW5cbiAqIGBpbmRleC5odG1sOl9yZXNvbHZlVmVuZG9yRmFsbGJhY2tgIChsXHUwMEVEbmVhIDE1Nzg4KykuXG4gKlxuICogQHBhcmFtIHtzdHJpbmcgfCBudWxsIHwgdW5kZWZpbmVkfSBjYXJkQ29kZSAgZWouIFwiQzIwMTEwNTYxMDY4XCIuXG4gKiBAcGFyYW0ge01hcDxzdHJpbmcsIGFueT4gfCBudWxsIHwgdW5kZWZpbmVkfSBjbGllbnRNYXN0ZXJDYWNoZVxuICogQHJldHVybnMge2FueSB8IG51bGx9ICBjbURhdGEgbyBudWxsIHNpIG5vIHNlIGVuY3VlbnRyYSAvIGNhcmRDb2RlIHZhY1x1MDBFRG8uXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBmaW5kQ21EYXRhQnlDYXJkQ29kZShjYXJkQ29kZSwgY2xpZW50TWFzdGVyQ2FjaGUpIHtcbiAgY29uc3QgY2MgPSBTdHJpbmcoY2FyZENvZGUgfHwgJycpLnRyaW0oKTtcbiAgaWYgKCFjYyB8fCAhY2xpZW50TWFzdGVyQ2FjaGUgfHwgdHlwZW9mIGNsaWVudE1hc3RlckNhY2hlLmZvckVhY2ggIT09ICdmdW5jdGlvbicpIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuICAvLyBTY2FuIFRPRE9TIGxvcyBkb2NzIGNvbiBlbCBjYXJkQ29kZSAocHVlZGUgaGFiZXIgZHVwbGljYWRvczogdW5vXG4gIC8vIGltcG9ydGFkbyBTQVAgc2luIEZpY2hhICsgb3RybyBjb24gRmljaGEgcG9wdWxhdGVkKS4gUHJlZmVyaXIgZWwgcXVlXG4gIC8vIHRpZW5lIGFsIG1lbm9zIHVuIGNhbXBvIEZpY2hhIHBvcHVsYXRlZC4gQ2FzbyBNQVhFUkE6IGhheSAyIGRvY3M7IGVsXG4gIC8vIHNsdWcgU0FQLWltcG9ydCBubyB0aWVuZSBjYW1wb3MgRmljaGEsIGVsIHNsdWcgRmljaGEgc1x1MDBFRC5cbiAgLyoqIEB0eXBlIHtBcnJheTxhbnk+fSAqL1xuICBjb25zdCBjYW5kaWRhdGVzID0gW107XG4gIGNsaWVudE1hc3RlckNhY2hlLmZvckVhY2goKGNtRGF0YSkgPT4ge1xuICAgIGlmICghY21EYXRhKSByZXR1cm47XG4gICAgY29uc3QgY2MxID0gU3RyaW5nKGNtRGF0YS5zYXBDYXJkQ29kZSB8fCAnJykudHJpbSgpO1xuICAgIGNvbnN0IGNjMiA9IFN0cmluZyhjbURhdGEuY2FyZENvZGVTYXAgfHwgJycpLnRyaW0oKTtcbiAgICBpZiAoY2MxID09PSBjYyB8fCBjYzIgPT09IGNjKSB7XG4gICAgICBjYW5kaWRhdGVzLnB1c2goY21EYXRhKTtcbiAgICB9XG4gIH0pO1xuICBpZiAoY2FuZGlkYXRlcy5sZW5ndGggPT09IDApIHJldHVybiBudWxsO1xuICBpZiAoY2FuZGlkYXRlcy5sZW5ndGggPT09IDEpIHJldHVybiBjYW5kaWRhdGVzWzBdO1xuICAvLyBNXHUwMEZBbHRpcGxlcyBkb2NzOiBwcmVmZXJpciBlbCBxdWUgdGVuZ2EgYWwgbWVub3MgVU4gY2FtcG8gRmljaGEgcG9wdWxhdGVkLlxuICBjb25zdCBGSUNIQV9GSUVMRFMgPSBbJ2NsaVRpcG8nLCAnZmlkZWxpZGFkJywgJ3ByZWZDb250YWN0bycsICd0YW1hbm8nLCAnZXNwZWNpYWxpemFjaW9uJywgJ3RpcG9Mb2NhbCcsICdjcmVkaXRvQ2hlcXVlJ107XG4gIGZvciAoY29uc3QgYyBvZiBjYW5kaWRhdGVzKSB7XG4gICAgZm9yIChjb25zdCBmIG9mIEZJQ0hBX0ZJRUxEUykge1xuICAgICAgaWYgKGNbZl0gIT09IG51bGwgJiYgY1tmXSAhPT0gdW5kZWZpbmVkICYmIGNbZl0gIT09ICcnKSB7XG4gICAgICAgIHJldHVybiBjO1xuICAgICAgfVxuICAgIH1cbiAgfVxuICAvLyBOaW5ndW5vIHRpZW5lIEZpY2hhIHBvcHVsYXRlZCBcdTIxOTIgZGV2b2x2ZXIgZWwgcHJpbWVybyAoYW1ib3MgZXF1aXZhbGVudGVzKS5cbiAgcmV0dXJuIGNhbmRpZGF0ZXNbMF07XG59XG5cbi8qKlxuICogQ29tcG9uZSBsYSBmaWxhIGRlIGNvbHVtbmFzIGRlIGxhIHBlc3RhXHUwMEYxYSBDbGFzaWZpY2FjaVx1MDBGM24gcGFyYSB1biBjbGllbnRlLlxuICogTm9tYnJlcyBkZSBjb2x1bW5hcyBleGFjdG9zIGNvbW8gcGlkZSBNYXJpYW5vIGVuIGVsIHBlZGlkby4gQ2VsZGFzIHZhY1x1MDBFRGFzXG4gKiBzZSBjb21wbGV0YW4gY29uIFwiLVwiLlxuICpcbiAqIEBwYXJhbSB7YW55fSBjbURhdGEgIGNsaWVudF9tYXN0ZXIve2RvY0lkfS5kYXRhKClcbiAqIEByZXR1cm5zIHtPYmplY3Q8c3RyaW5nLCBzdHJpbmcgfCBudW1iZXI+fVxuICovXG5leHBvcnQgZnVuY3Rpb24gZmljaGFDbGllbnRlQ2xhc2lmUm93KGNtRGF0YSkge1xuICBjb25zdCBkID0gY21EYXRhIHx8IHt9O1xuICBjb25zdCBjcmVkaXRvID0gZC5jcmVkaXRvQ2hlcXVlO1xuICBjb25zdCBjcmVkaXRvTnVtID0gY3JlZGl0byAhPSBudWxsICYmIGNyZWRpdG8gIT09ICcnID8gTnVtYmVyKGNyZWRpdG8pIDogbnVsbDtcbiAgcmV0dXJuIHtcbiAgICAnVGlwbyBkZSBjbGllbnRlJzogbGFiZWxGb3JGaWNoYUZpZWxkKCdjbGlUaXBvJywgZC5jbGlUaXBvKSxcbiAgICBGaWRlbGlkYWQ6IGxhYmVsRm9yRmljaGFGaWVsZCgnZmlkZWxpZGFkJywgZC5maWRlbGlkYWQpLFxuICAgICdQcmVmZXJlbmNpYSBkZSBjb250YWN0byc6IGxhYmVsRm9yRmljaGFGaWVsZCgncHJlZkNvbnRhY3RvJywgZC5wcmVmQ29udGFjdG8pLFxuICAgIFRhbWFcdTAwRjFvOiBsYWJlbEZvckZpY2hhRmllbGQoJ3RhbWFubycsIGQudGFtYW5vKSxcbiAgICBFc3BlY2lhbGl6YWNpXHUwMEYzbjogbGFiZWxGb3JGaWNoYUZpZWxkKCdlc3BlY2lhbGl6YWNpb24nLCBkLmVzcGVjaWFsaXphY2lvbiksXG4gICAgJ1RpcG8gZGUgbG9jYWwnOiBsYWJlbEZvckZpY2hhRmllbGQoJ3RpcG9Mb2NhbCcsIGQudGlwb0xvY2FsKSxcbiAgICAnQ3JcdTAwRTlkaXRvIGNoZXF1ZSAoQVJTKSc6XG4gICAgICBjcmVkaXRvTnVtICE9IG51bGwgJiYgTnVtYmVyLmlzRmluaXRlKGNyZWRpdG9OdW0pICYmIGNyZWRpdG9OdW0gPiAwXG4gICAgICAgID8gTWF0aC5yb3VuZChjcmVkaXRvTnVtKVxuICAgICAgICA6ICctJyxcbiAgfTtcbn1cblxuLyoqXG4gKiBDb21wb25lIGxhIGZpbGEgZGUgY29sdW1uYXMgZGUgbGEgcGVzdGFcdTAwRjFhIEJ1eWVyIHBhcmEgdW4gY2xpZW50ZS5cbiAqIFZlbnRhbmEgZGVmYXVsdCAxMm0gKGxhIHF1ZSBhcnJhbmNhIGVsIG1vZGFsOyB2ZXIgX2ZjQnV5ZXJDdXJyZW50UGVyaW9kKS5cbiAqIE1hcmlhbm86IHNpIGVsIHZhbG9yIG5vIGV4aXN0ZSwgdmEgXCItXCIuXG4gKlxuICogQHBhcmFtIHthbnl9IGJ1eWVyU3RhdHMgIGNsaWVudF9idXllcl9zdGF0cy97Y2FyZENvZGV9LmRhdGEoKVxuICogQHBhcmFtIHtzdHJpbmd9IFtwZXJpb2RdICAnM20nIHwgJzZtJyB8ICcxMm0nIHwgJzI0bScuIERlZmF1bHQgJzEybScuXG4gKiBAcmV0dXJucyB7T2JqZWN0PHN0cmluZywgc3RyaW5nIHwgbnVtYmVyPn1cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGZpY2hhQ2xpZW50ZUJ1eWVyUm93KGJ1eWVyU3RhdHMsIHBlcmlvZCkge1xuICBjb25zdCBwID0gcGVyaW9kIHx8ICcxMm0nO1xuICBjb25zdCBicyA9IGJ1eWVyU3RhdHMgfHwge307XG4gIGNvbnN0IHN0YXRzID0gLyoqIEB0eXBlIHthbnl9ICovIChicylbJ3N0YXRzXycgKyBwXSB8fCB7fTtcbiAgY29uc3QgbW9udG8gPSBOdW1iZXIoc3RhdHMubW9udG9Ub3RhbCkgfHwgMDtcbiAgY29uc3QgZmFjdHVyYXMgPSBOdW1iZXIoc3RhdHMuZmFjdHVyYXNDb3VudCkgfHwgMDtcbiAgY29uc3QgcHJvbWVkaW8gPSBOdW1iZXIoc3RhdHMubW9udG9Qcm9tZWRpbykgfHwgMDtcbiAgY29uc3QgZnJlYyA9IHN0YXRzLmZyZWN1ZW5jaWFEaWFzO1xuICBjb25zdCBmYWN4TWVzID0gc3RhdHMuZmFjdHVyYXNQb3JNZXM7XG4gIGNvbnN0IGRpYXMgPSBzdGF0cy5kaWFzRGVzZGVVbHRpbWE7XG4gIHJldHVybiB7XG4gICAgJ01vbnRvIHRvdGFsICgxMm0pJzogbW9udG8gPiAwID8gTWF0aC5yb3VuZChtb250bykgOiAnLScsXG4gICAgJ0ZhY3R1cmFzICgxMm0pJzogZmFjdHVyYXMgPiAwID8gZmFjdHVyYXMgOiAnLScsXG4gICAgJ1Byb21lZGlvIHBvciBmYWN0dXJhICgxMm0pJzogcHJvbWVkaW8gPiAwID8gTWF0aC5yb3VuZChwcm9tZWRpbykgOiAnLScsXG4gICAgJ0ZyZWN1ZW5jaWEgKGRcdTAwRURhcyBlbnRyZSBjb21wcmFzKSc6XG4gICAgICBmcmVjICE9IG51bGwgJiYgTnVtYmVyLmlzRmluaXRlKE51bWJlcihmcmVjKSkgPyBNYXRoLnJvdW5kKE51bWJlcihmcmVjKSkgOiAnLScsXG4gICAgJ0ZhY3R1cmFzIHBvciBtZXMgKDEybSknOlxuICAgICAgZmFjeE1lcyAhPSBudWxsICYmIE51bWJlci5pc0Zpbml0ZShOdW1iZXIoZmFjeE1lcykpXG4gICAgICAgID8gTWF0aC5yb3VuZChOdW1iZXIoZmFjeE1lcykgKiAxMCkgLyAxMFxuICAgICAgICA6ICctJyxcbiAgICAnUHJpbWVyYSBjb21wcmEnOiBzdGF0cy5wcmltZXJhQ29tcHJhIHx8ICctJyxcbiAgICAnXHUwMERBbHRpbWEgY29tcHJhJzogc3RhdHMudWx0aW1hQ29tcHJhIHx8ICctJyxcbiAgICAnRFx1MDBFRGFzIGRlc2RlIFx1MDBGQWx0aW1hIGNvbXByYSc6XG4gICAgICBkaWFzICE9IG51bGwgJiYgTnVtYmVyLmlzRmluaXRlKE51bWJlcihkaWFzKSkgPyBNYXRoLnJvdW5kKE51bWJlcihkaWFzKSkgOiAnLScsXG4gIH07XG59XG5cbi8qKlxuICogUmVlbXBsYXphIGNhZGEgY2VsZGEgdmFjXHUwMEVEYSAobnVsbCAvIHVuZGVmaW5lZCAvICcnIC8gMCBjdWFuZG8gZWwgY2FtcG9cbiAqIHJlcXVpZXJlIHZhbG9yIHNpZ25pZmljYXRpdm8pIHBvciBcIi1cIi4gQ2VudHJhbGl6YSBsYSByZWdsYSBkZSBNYXJpYW5vXG4gKiBcIm5pbmd1bmEgY2VsZGEgcXVlZGEgdmFjXHUwMEVEYSwgZW4gbmluZ3VuYSBjb2x1bW5hLCBpbmNsdWlkYXMgbGFzIHF1ZSB5YVxuICogZXhpc3RlblwiLlxuICpcbiAqIEV4Y2VwY2lcdTAwRjNuOiBjYW1wb3MgbnVtXHUwMEU5cmljb3MgbGlzdGFkb3MgZW4gYG51bWVyaWNaZXJvT2tgIGNvbnNlcnZhbiAwLlxuICogSG95IG5pbmd1bm87IHNlIGRlamEgbGEgaG9vayBwb3Igc2kgZW4gZWwgZnV0dXJvIGFwYXJlY2UgXCJUb3RhbCB2aXNpdGFzXCIuXG4gKlxuICogQHBhcmFtIHthbnl9IHJvd1xuICogQHBhcmFtIHtTZXQ8c3RyaW5nPn0gW251bWVyaWNaZXJvT2tdXG4gKiBAcmV0dXJucyB7T2JqZWN0PHN0cmluZywgYW55Pn1cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGZpbGxEYXNoSW5FbXB0eShyb3csIG51bWVyaWNaZXJvT2spIHtcbiAgY29uc3Qgb2sgPSBudW1lcmljWmVyb09rIGluc3RhbmNlb2YgU2V0ID8gbnVtZXJpY1plcm9PayA6IG5ldyBTZXQoKTtcbiAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBhbnk+fSAqL1xuICBjb25zdCBvdXQgPSB7fTtcbiAgZm9yIChjb25zdCBrIG9mIE9iamVjdC5rZXlzKHJvdyB8fCB7fSkpIHtcbiAgICBjb25zdCB2ID0gcm93W2tdO1xuICAgIGlmICh2ID09PSBudWxsIHx8IHYgPT09IHVuZGVmaW5lZCB8fCB2ID09PSAnJykge1xuICAgICAgb3V0W2tdID0gJy0nO1xuICAgIH0gZWxzZSBpZiAodiA9PT0gMCAmJiAhb2suaGFzKGspKSB7XG4gICAgICBvdXRba10gPSAnLSc7XG4gICAgfSBlbHNlIHtcbiAgICAgIG91dFtrXSA9IHY7XG4gICAgfVxuICB9XG4gIHJldHVybiBvdXQ7XG59XG4iLCAiLy8gQHRzLW5vY2hlY2tcbi8vIE5PVEE6IEB0cy1ub2NoZWNrIGludGVuY2lvbmFsLiBFbCBjaHVuayBlcyBoZWF2eSBET00gKyB3aW5kb3cuKiBoYW5kbGVycyArXG4vLyBGaXJlc3RvcmUgU0RLIGNvbXBhdCB2OC4gQW5vdGFyIHN0cmljdGFtZW50ZSBjYWRhIGhhbmRsZXIgc2VyXHUwMEVEYSBydWlkbyBzaW5cbi8vIHZhbG9yIFx1MjAxNCBsb3MgaGVscGVycyBwdXJvcyBxdWUgaW1wb3J0YW1vcyAoLi4vcHVyZS9jYXJ0ZXJhLXZlbmRvci1maWx0ZXIuanMpXG4vLyB5IGVsIGNvcmUgKGZ1bmN0aW9ucy9jb3JlL2NhcnRlcmEtdmVuZG9yLWNvcmUuanMpIHNcdTAwRUQgdGllbmVuIEB0cy1jaGVjay5cbi8qKlxuICogY2FydGVyYS12ZW5kb3IuanMgKHYxMjgzLCAyMDI2LTEwLTIwKSBcdTIwMTQgYnVuZGxlIGNodW5rIGxhenkuXG4gKlxuICogRGFzaGJvYXJkIFwiQW5hbGlzaXMgZGUgQ2FydGVyYSBwb3IgVmVuZGVkb3JcIi4gUmVlbXBsYXphIHNlZ3VpbWllbnRvLmpzLlxuICogTGVlIGNhcnRlcmFfdmVuZG9yL3t2ZW5kb3JLZXl9IEZpcmVzdG9yZSAoc25hcHNob3QgbmlnaHRseSAwNDowMCBBUlQpLlxuICpcbiAqIFRPRE8gZWwgRE9NIHJlbmRlciB1c2EgY3JlYXRlRWxlbWVudCArIHRleHRDb250ZW50IChwb2xpY3kgYW50aS1YU1MsIG5vIGlubmVySFRNTCkuXG4gKlxuICogU3BlYzogZG9jcy9zdXBlcnBvd2Vycy9zcGVjcy8yMDI2LTEwLTIwLWNhcnRlcmEtdmVuZG9yLWFuYWxpc2lzLWRlc2lnbi5tZFxuICogUGxhbjogZG9jcy9zdXBlcnBvd2Vycy9wbGFucy8yMDI2LTEwLTIwLWNhcnRlcmEtdmVuZG9yLWFuYWxpc2lzLm1kXG4gKi9cblxuaW1wb3J0IHsgYXBwbHlDaGlwRmlsdGVyLCBzb3J0Q2xpZW50ZXMgfSBmcm9tICcuLi9wdXJlL2NhcnRlcmEtdmVuZG9yLWZpbHRlci5qcyc7XG4vLyB2MTQ4MiBcdTAwQTc4MiAoMjAyNi0xMC0yNyk6IGZ1ZW50ZSBcdTAwRkFuaWNhIGRlIGxhYmVscyBGaWNoYSBDbGllbnRlLiBMYSBjb2x1bW5hXG4vLyBUSVBPIGFudGVzIG1vc3RyYWJhIGVsIGNcdTAwRjNkaWdvIChcIkJcIikgZW4gdmV6IGRlbCBsYWJlbCBsZWdpYmxlIChcIkIgLSBzaW5cbi8vIGRlc2N1ZW50b1wiKSBcdTIwMTQgcGVuZGllbnRlIGNvbm9jaWRvIHByZS12MTQ4Mi4gUmV1c2Ftb3MgbGEgcHVyZSBmbiBxdWUgeWFcbi8vIGNvbnN1bWUgTWFzdGVyZmlsZSBleHBvcnQgcGFyYSBubyBkdXBsaWNhciBlbCBtYXBlby5cbmltcG9ydCB7IGxhYmVsRm9yRmljaGFGaWVsZCB9IGZyb20gJy4uL3B1cmUvZmljaGEtY2xpZW50ZS1sYWJlbHMuanMnO1xuXG4vKiogQHR5cGUge01hcDxzdHJpbmcsIGFueT59ICovXG5jb25zdCBjYXJ0ZXJhRG9jQ2FjaGUgPSBuZXcgTWFwKCk7XG4vKiogQHR5cGUge3N0cmluZ3xudWxsfSAqL1xubGV0IHNlbGVjdGVkVmVuZG9yID0gbnVsbDtcbmxldCBhY3RpdmVDaGlwID0gJ3RvZG9zJztcbmxldCBzZWFyY2hRdWVyeSA9ICcnO1xubGV0IHNvcnRCeSA9ICdkaWFzU2luQ29tcHJhJztcbi8qKiBAdHlwZSB7J2FzYyd8J2Rlc2MnfSAqL1xubGV0IHNvcnREaXIgPSAnZGVzYyc7XG5cbmNvbnN0IENISVBTID0gW1xuICB7IGlkOiAndG9kb3MnLCBsYWJlbDogJ1RvZG9zJyB9LFxuICB7IGlkOiAnYmFzZUFjdGl2YTkwZCcsIGxhYmVsOiAnQmFzZSBhY3RpdmEgOTBkJyB9LFxuICB7IGlkOiAnZG9ybWlkb3NWaXNpdGEzMGQnLCBsYWJlbDogJ0Rvcm1pZG9zIHZpc2l0YSAzMGQnIH0sXG4gIHsgaWQ6ICdkb3JtaWRvc0NvbXByYTkwZCcsIGxhYmVsOiAnRG9ybWlkb3MgY29tcHJhIDkwZCcgfSxcbiAgeyBpZDogJ251bmNhVmlzaXRhZG9zJywgbGFiZWw6ICdOdW5jYSB2aXNpdGFkb3MnIH0sXG4gIHsgaWQ6ICdudW5jYUNvbXByYXJvbicsIGxhYmVsOiAnTnVuY2EgY29tcHJhcm9uJyB9LFxuXTtcblxuY29uc3QgS1BJX0NBUkRTID0gW1xuICB7IGNoaXA6ICd0b2RvcycsIGxhYmVsOiAnVG90YWwgY2FydGVyYScsIGNvbG9yOiAnIzY0NzQ4YicgfSxcbiAgeyBjaGlwOiAnYmFzZUFjdGl2YTkwZCcsIGxhYmVsOiAnQmFzZSBhY3RpdmEgOTBkJywgY29sb3I6ICcjMTZhMzRhJyB9LFxuICB7IGNoaXA6ICdkb3JtaWRvc1Zpc2l0YTMwZCcsIGxhYmVsOiAnRG9ybWlkb3MgdmlzIDMwZCcsIGNvbG9yOiAnI2VhNTgwYycgfSxcbiAgeyBjaGlwOiAnZG9ybWlkb3NDb21wcmE5MGQnLCBsYWJlbDogJ0Rvcm1pZG9zIGNvbSA5MGQnLCBjb2xvcjogJyNkYzI2MjYnIH0sXG4gIHsgY2hpcDogJ251bmNhVmlzaXRhZG9zJywgbGFiZWw6ICdOdW5jYSB2aXNpdGFkb3MnLCBjb2xvcjogJyM3YzNhZWQnIH0sXG4gIHsgY2hpcDogJ251bmNhQ29tcHJhcm9uJywgbGFiZWw6ICdOdW5jYSBjb21wcmFyb24nLCBjb2xvcjogJyNiZTE4NWQnIH0sXG5dO1xuXG4vLyB2MTM4NCAoMjAyNi0xMC0yMSk6IHdoaXRlbGlzdCBkZSBsb3MgNiBWREUgcmVhbGVzIG9wZXJhdGl2b3MgKHBlZGlkbyBNYXJpYW5vKS5cbi8vIEZpbHRyYSBlbCBkcm9wZG93biBwYXJhIGV4Y2x1aXIgcnVpZG8gZW4gY2xpZW50X2FwcGxpY2F0aW9ucy5hc3NpZ25lZFZlbmRvcjpcbi8vICdBRE1JTl9MRE9PRzJGNE1XVk1YS1FPRDhZQ0JPSVJVMk8yJyAoYWRtaW4gdWlkIHF1ZSBxdWVkbyBjb21vIHN0cmluZyB2ZW5kb3IpLFxuLy8gJ0VNUExFQURPJyAoYWx0YXMgaW50ZXJuYXMpLCAnRElFR08gVkFMU0knIChleC1WREUgY29uIDEgY2xpZW50ZSBoaXN0b3JpY28pLlxuLy8gU2kgZW4gZWwgZnV0dXJvIHNlIGluY29ycG9yYSB1biBudWV2byBWREUsIGFncmVnYXJsbyBhcXVpICsgdmVyaWZpY2FyIHF1ZSBsYVxuLy8gdmlzdGEgQlEgdl9jYXJ0ZXJhX3ZlbmRvciBsbyBjYW5vbmljYWxpemUgaWd1YWwgKHZlciBiaWdxdWVyeS92aWV3cy5zcWw6MzQ4MCkuXG5jb25zdCBWRU5ET1JTX1dISVRFTElTVCA9IG5ldyBTZXQoW1xuICAnRkVERVJJQ08gQ0FTVEVMQU5FTExJJyxcbiAgJ0dPTlpBTE8gREUgTEEgUk9TQScsXG4gICdJT0FOTklTIFBBTEtPVURBS0lTJyxcbiAgJ01BVVJJQ0lPIEdJTCcsXG4gICdQQUNISScsXG4gICdTQU5USUFHTyBFU1RFQkFOJyxcbl0pO1xuXG4vLyA9PT0gT3BlbiAvIGNsb3NlID09PVxud2luZG93Lm9wZW5DYXJ0ZXJhTW9kYWwgPSBhc3luYyBmdW5jdGlvbiBvcGVuQ2FydGVyYU1vZGFsKCkge1xuICBjb25zdCBtb2RhbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdjYXJ0ZXJhLW1vZGFsJyk7XG4gIGlmICghbW9kYWwpIHJldHVybjtcbiAgbW9kYWwuY2xhc3NMaXN0LmFkZCgnb3BlbicpO1xuICBhd2FpdCBwb3B1bGF0ZVZlbmRvckRyb3Bkb3duKCk7XG59O1xuXG53aW5kb3cuY2xvc2VDYXJ0ZXJhTW9kYWwgPSBmdW5jdGlvbiBjbG9zZUNhcnRlcmFNb2RhbCgpIHtcbiAgY29uc3QgbW9kYWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY2FydGVyYS1tb2RhbCcpO1xuICBpZiAobW9kYWwpIG1vZGFsLmNsYXNzTGlzdC5yZW1vdmUoJ29wZW4nKTtcbn07XG5cbi8vID09PSBEcm9wZG93biBkZSB2ZW5kb3JzID09PVxuYXN5bmMgZnVuY3Rpb24gcG9wdWxhdGVWZW5kb3JEcm9wZG93bigpIHtcbiAgY29uc3Qgc2VsID0gLyoqIEB0eXBlIHtIVE1MU2VsZWN0RWxlbWVudHxudWxsfSAqLyAoXG4gICAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2NhcnRlcmEtdmVuZG9yLXNlbGVjdCcpXG4gICk7XG4gIGlmICghc2VsKSByZXR1cm47XG4gIGlmIChzZWwub3B0aW9ucy5sZW5ndGggPiAxKSByZXR1cm47XG4gIHRyeSB7XG4gICAgLy8gQHRzLWV4cGVjdC1lcnJvclxuICAgIGNvbnN0IHNuYXAgPSBhd2FpdCBmaXJlYmFzZS5maXJlc3RvcmUoKS5jb2xsZWN0aW9uKCdjYXJ0ZXJhX3ZlbmRvcicpLmdldCgpO1xuICAgIC8qKiBAdHlwZSB7c3RyaW5nW119ICovXG4gICAgY29uc3QgdmVuZG9ycyA9IFtdO1xuICAgIHNuYXAuZm9yRWFjaCgoZG9jKSA9PiB7XG4gICAgICAvLyB2MTM4NDogc29sbyBWREUgd2hpdGVsaXN0LiBSZXN0byAoYWRtaW4gdWlkLCBFTVBMRUFETywgZXgtVkRFKSBzZSBvY3VsdGFuLlxuICAgICAgaWYgKFZFTkRPUlNfV0hJVEVMSVNULmhhcyhkb2MuaWQpKSB2ZW5kb3JzLnB1c2goZG9jLmlkKTtcbiAgICB9KTtcbiAgICB2ZW5kb3JzLnNvcnQoKTtcbiAgICBmb3IgKGNvbnN0IHYgb2YgdmVuZG9ycykge1xuICAgICAgY29uc3Qgb3B0ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnb3B0aW9uJyk7XG4gICAgICBvcHQudmFsdWUgPSB2O1xuICAgICAgb3B0LnRleHRDb250ZW50ID0gdjtcbiAgICAgIHNlbC5hcHBlbmRDaGlsZChvcHQpO1xuICAgIH1cbiAgfSBjYXRjaCAoZSkge1xuICAgIGNvbnNvbGUuZXJyb3IoJ3BvcHVsYXRlVmVuZG9yRHJvcGRvd24gZmFpbGVkJywgZSk7XG4gIH1cbn1cblxuLy8gPT09IE9uIHZlbmRvciBjaGFuZ2UgPT09XG53aW5kb3cub25DYXJ0ZXJhVmVuZG9yQ2hhbmdlID0gYXN5bmMgZnVuY3Rpb24gb25DYXJ0ZXJhVmVuZG9yQ2hhbmdlKCkge1xuICBjb25zdCBzZWwgPSAvKiogQHR5cGUge0hUTUxTZWxlY3RFbGVtZW50fG51bGx9ICovIChcbiAgICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY2FydGVyYS12ZW5kb3Itc2VsZWN0JylcbiAgKTtcbiAgaWYgKCFzZWwpIHJldHVybjtcbiAgc2VsZWN0ZWRWZW5kb3IgPSBzZWwudmFsdWUgfHwgbnVsbDtcbiAgYWN0aXZlQ2hpcCA9ICd0b2Rvcyc7XG4gIHNlYXJjaFF1ZXJ5ID0gJyc7XG4gIGNvbnN0IHNlYXJjaElucHV0ID0gLyoqIEB0eXBlIHtIVE1MSW5wdXRFbGVtZW50fG51bGx9ICovIChcbiAgICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY2FydGVyYS1zZWFyY2gnKVxuICApO1xuICBpZiAoc2VhcmNoSW5wdXQpIHNlYXJjaElucHV0LnZhbHVlID0gJyc7XG4gIGlmICghc2VsZWN0ZWRWZW5kb3IpIHtcbiAgICBzaG93RW1wdHkoKTtcbiAgICByZXR1cm47XG4gIH1cbiAgc2hvd0xvYWRpbmcoKTtcbiAgdHJ5IHtcbiAgICBsZXQgZG9jID0gY2FydGVyYURvY0NhY2hlLmdldChzZWxlY3RlZFZlbmRvcik7XG4gICAgaWYgKCFkb2MpIHtcbiAgICAgIC8vIEB0cy1leHBlY3QtZXJyb3JcbiAgICAgIGNvbnN0IHNuYXAgPSBhd2FpdCBmaXJlYmFzZVxuICAgICAgICAuZmlyZXN0b3JlKClcbiAgICAgICAgLmNvbGxlY3Rpb24oJ2NhcnRlcmFfdmVuZG9yJylcbiAgICAgICAgLmRvYyhzZWxlY3RlZFZlbmRvcilcbiAgICAgICAgLmdldCgpO1xuICAgICAgaWYgKCFzbmFwLmV4aXN0cykge1xuICAgICAgICBzaG93Tm9EYXRhKCk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIGRvYyA9IHNuYXAuZGF0YSgpO1xuICAgICAgY2FydGVyYURvY0NhY2hlLnNldChzZWxlY3RlZFZlbmRvciwgZG9jKTtcbiAgICB9XG4gICAgcmVuZGVyRGFzaGJvYXJkKGRvYyk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBjb25zb2xlLmVycm9yKCdvbkNhcnRlcmFWZW5kb3JDaGFuZ2UgZmFpbGVkJywgZSk7XG4gICAgc2hvd0Vycm9yKFN0cmluZyhlKSk7XG4gIH1cbn07XG5cbi8qKiBAdHlwZSB7YW55fSAqLyAod2luZG93KS5vbkNhcnRlcmFDaGlwQ2xpY2sgPSBmdW5jdGlvbiBvbkNhcnRlcmFDaGlwQ2xpY2soY2hpcElkKSB7XG4gIGFjdGl2ZUNoaXAgPSBjaGlwSWQ7XG4gIGlmICghc2VsZWN0ZWRWZW5kb3IpIHJldHVybjtcbiAgY29uc3QgZG9jID0gY2FydGVyYURvY0NhY2hlLmdldChzZWxlY3RlZFZlbmRvcik7XG4gIGlmIChkb2MpIHJlbmRlckRhc2hib2FyZChkb2MpO1xufTtcblxuLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBzZXRUaW1lb3V0PnxudWxsfSAqL1xubGV0IHNlYXJjaERlYm91bmNlVGltZXIgPSBudWxsO1xud2luZG93Lm9uQ2FydGVyYVNlYXJjaENoYW5nZSA9IGZ1bmN0aW9uIG9uQ2FydGVyYVNlYXJjaENoYW5nZSgpIHtcbiAgY29uc3QgaW5wdXQgPSAvKiogQHR5cGUge0hUTUxJbnB1dEVsZW1lbnR8bnVsbH0gKi8gKGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdjYXJ0ZXJhLXNlYXJjaCcpKTtcbiAgaWYgKCFpbnB1dCkgcmV0dXJuO1xuICBpZiAoc2VhcmNoRGVib3VuY2VUaW1lcikgY2xlYXJUaW1lb3V0KHNlYXJjaERlYm91bmNlVGltZXIpO1xuICBzZWFyY2hEZWJvdW5jZVRpbWVyID0gc2V0VGltZW91dCgoKSA9PiB7XG4gICAgc2VhcmNoUXVlcnkgPSAoaW5wdXQudmFsdWUgfHwgJycpLnRyaW0oKS50b0xvd2VyQ2FzZSgpO1xuICAgIGlmICghc2VsZWN0ZWRWZW5kb3IpIHJldHVybjtcbiAgICBjb25zdCBkb2MgPSBjYXJ0ZXJhRG9jQ2FjaGUuZ2V0KHNlbGVjdGVkVmVuZG9yKTtcbiAgICBpZiAoZG9jKSByZW5kZXJEYXNoYm9hcmQoZG9jKTtcbiAgfSwgMzAwKTtcbn07XG5cbi8qKiBAdHlwZSB7YW55fSAqLyAod2luZG93KS5vbkNhcnRlcmFTb3J0Q2xpY2sgPSBmdW5jdGlvbiBvbkNhcnRlcmFTb3J0Q2xpY2soY29sS2V5KSB7XG4gIGlmIChzb3J0QnkgPT09IGNvbEtleSkgc29ydERpciA9IHNvcnREaXIgPT09ICdhc2MnID8gJ2Rlc2MnIDogJ2FzYyc7XG4gIGVsc2Uge1xuICAgIHNvcnRCeSA9IGNvbEtleTtcbiAgICBzb3J0RGlyID0gJ2Rlc2MnO1xuICB9XG4gIGlmICghc2VsZWN0ZWRWZW5kb3IpIHJldHVybjtcbiAgY29uc3QgZG9jID0gY2FydGVyYURvY0NhY2hlLmdldChzZWxlY3RlZFZlbmRvcik7XG4gIGlmIChkb2MpIHJlbmRlckRhc2hib2FyZChkb2MpO1xufTtcblxuLy8gPT09IFJlbmRlciA9PT1cbmZ1bmN0aW9uIHJlbmRlckRhc2hib2FyZChkb2MpIHtcbiAgY29uc3Qgc3VidGl0bGUgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY2FydGVyYS1zdWJ0aXRsZScpO1xuICBpZiAoc3VidGl0bGUpIHN1YnRpdGxlLnRleHRDb250ZW50ID0gYCR7ZG9jLmNvdW50cy50b3RhbH0gY2xpZW50ZXMgZW4gY2FydGVyYS5gO1xuICBjb25zdCBpbmZvID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2NhcnRlcmEtc25hcHNob3QtaW5mbycpO1xuICBpZiAoaW5mbykge1xuICAgIGluZm8udGV4dENvbnRlbnQgPSBgU25hcHNob3QgJHtkb2Muc25hcHNob3REYXRlfWA7XG4gICAgaW5mby5zdHlsZS5kaXNwbGF5ID0gJ2lubGluZS1mbGV4JztcbiAgfVxuICByZW5kZXJLcGlzKGRvYy5jb3VudHMpO1xuICByZW5kZXJDaGlwcyhkb2MuY291bnRzKTtcbiAgcmVuZGVyVGFibGUoZG9jLmNsaWVudGVzKTtcbiAgc2hvd1RhYmxlKCk7XG59XG5cbmZ1bmN0aW9uIHJlbmRlcktwaXMoY291bnRzKSB7XG4gIGNvbnN0IGVsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2NhcnRlcmEta3BpcycpO1xuICBpZiAoIWVsKSByZXR1cm47XG4gIHdoaWxlIChlbC5maXJzdENoaWxkKSBlbC5yZW1vdmVDaGlsZChlbC5maXJzdENoaWxkKTtcbiAgLy8gdjEzODM6IEFwcGxlLXN0eWxlIEtQSSBjYXJkcy4gQ2xhc2VzIC5jYXJ0ZXJhLWtwaSBkZWZpbmlkYXMgZW4gaW5kZXguaHRtbC5cbiAgLy8gQ29sb3Igc2UgYXBsaWNhIHNvbG8gYWwgblx1MDBGQW1lcm8gKyB1bmRlcmxpbmUgKHN1dGlsIGlkZW50aWRhZCBwb3IgY2F0ZWdvclx1MDBFRGEpLlxuICBmb3IgKGNvbnN0IHNwZWMgb2YgS1BJX0NBUkRTKSB7XG4gICAgY29uc3QgY2FyZCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpO1xuICAgIGNhcmQuY2xhc3NOYW1lID0gJ2NhcnRlcmEta3BpJztcbiAgICBpZiAoYWN0aXZlQ2hpcCA9PT0gc3BlYy5jaGlwKSBjYXJkLmNsYXNzTGlzdC5hZGQoJ2FjdGl2ZScpO1xuICAgIGNhcmQuc3R5bGUuY29sb3IgPSBzcGVjLmNvbG9yOyAvLyBjdXJyZW50Q29sb3IgcGFyYSBlbCBudW1iZXIgKyA6OmFmdGVyIHVuZGVybGluZVxuICAgIGNhcmQuYWRkRXZlbnRMaXN0ZW5lcignY2xpY2snLCAoKSA9PiAvKiogQHR5cGUge2FueX0gKi8gKHdpbmRvdykub25DYXJ0ZXJhQ2hpcENsaWNrKHNwZWMuY2hpcCkpO1xuICAgIGNvbnN0IG4gPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKTtcbiAgICBuLmNsYXNzTmFtZSA9ICdjYXJ0ZXJhLWtwaS1udW0nO1xuICAgIG4udGV4dENvbnRlbnQgPSBTdHJpbmcoY291bnRzW3NwZWMuY2hpcCA9PT0gJ3RvZG9zJyA/ICd0b3RhbCcgOiBzcGVjLmNoaXBdKTtcbiAgICBjb25zdCBsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2Jyk7XG4gICAgbC5jbGFzc05hbWUgPSAnY2FydGVyYS1rcGktbGFiZWwnO1xuICAgIGwuc3R5bGUuY29sb3IgPSAnJzsgLy8gcmVzZXQgY3VycmVudENvbG9yIHBhcmEgcXVlIHVzZSBlbCBtdXRlZCBkZWwgQ1NTXG4gICAgbC50ZXh0Q29udGVudCA9IHNwZWMubGFiZWw7XG4gICAgY2FyZC5hcHBlbmRDaGlsZChuKTtcbiAgICBjYXJkLmFwcGVuZENoaWxkKGwpO1xuICAgIGVsLmFwcGVuZENoaWxkKGNhcmQpO1xuICB9XG59XG5cbmZ1bmN0aW9uIHJlbmRlckNoaXBzKGNvdW50cykge1xuICBjb25zdCBlbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdjYXJ0ZXJhLWNoaXBzJyk7XG4gIGlmICghZWwpIHJldHVybjtcbiAgY29uc3QgY291bnRCeUNoaXAgPSB7XG4gICAgdG9kb3M6IGNvdW50cy50b3RhbCxcbiAgICBiYXNlQWN0aXZhOTBkOiBjb3VudHMuYmFzZUFjdGl2YTkwZCxcbiAgICBkb3JtaWRvc1Zpc2l0YTMwZDogY291bnRzLmRvcm1pZG9zVmlzaXRhMzBkLFxuICAgIGRvcm1pZG9zQ29tcHJhOTBkOiBjb3VudHMuZG9ybWlkb3NDb21wcmE5MGQsXG4gICAgbnVuY2FWaXNpdGFkb3M6IGNvdW50cy5udW5jYVZpc2l0YWRvcyxcbiAgICBudW5jYUNvbXByYXJvbjogY291bnRzLm51bmNhQ29tcHJhcm9uLFxuICB9O1xuICB3aGlsZSAoZWwuZmlyc3RDaGlsZCkgZWwucmVtb3ZlQ2hpbGQoZWwuZmlyc3RDaGlsZCk7XG4gIC8vIHYxMzgzOiBzZWdtZW50ZWQgY29udHJvbCBpT1MuIFdyYXBwZXIgLmNhcnRlcmEtY2hpcC13cmFwIGFncnVwYSBwaWxscyBjb24gYmcgZ3Jpcy5cbiAgY29uc3Qgd3JhcCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpO1xuICB3cmFwLmNsYXNzTmFtZSA9ICdjYXJ0ZXJhLWNoaXAtd3JhcCc7XG4gIGZvciAoY29uc3QgY2hpcCBvZiBDSElQUykge1xuICAgIGNvbnN0IGIgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdidXR0b24nKTtcbiAgICBiLmNsYXNzTmFtZSA9ICdjYXJ0ZXJhLWNoaXAnO1xuICAgIGlmIChhY3RpdmVDaGlwID09PSBjaGlwLmlkKSBiLmNsYXNzTGlzdC5hZGQoJ2FjdGl2ZScpO1xuICAgIGIudHlwZSA9ICdidXR0b24nO1xuICAgIGIudGV4dENvbnRlbnQgPSBgJHtjaGlwLmxhYmVsfSAoJHtjb3VudEJ5Q2hpcFtjaGlwLmlkXX0pYDtcbiAgICBiLmFkZEV2ZW50TGlzdGVuZXIoJ2NsaWNrJywgKCkgPT4gLyoqIEB0eXBlIHthbnl9ICovICh3aW5kb3cpLm9uQ2FydGVyYUNoaXBDbGljayhjaGlwLmlkKSk7XG4gICAgd3JhcC5hcHBlbmRDaGlsZChiKTtcbiAgfVxuICBlbC5hcHBlbmRDaGlsZCh3cmFwKTtcbn1cblxuLyoqIEBwYXJhbSB7QXJyYXk8YW55Pn0gY2xpZW50ZXMgKi9cbmZ1bmN0aW9uIHJlbmRlclRhYmxlKGNsaWVudGVzKSB7XG4gIGNvbnN0IHRhYmxlID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2NhcnRlcmEtdGFibGUnKTtcbiAgaWYgKCF0YWJsZSkgcmV0dXJuO1xuICBjb25zdCBmaWx0ZXJlZCA9IGFwcGx5Q2hpcEZpbHRlcihjbGllbnRlcywgYWN0aXZlQ2hpcCk7XG4gIGNvbnN0IHNlYXJjaGVkID0gc2VhcmNoUXVlcnlcbiAgICA/IGZpbHRlcmVkLmZpbHRlcigoYykgPT5cbiAgICAgICAgU3RyaW5nKGMuY2xpZW50TmFtZSB8fCAnJylcbiAgICAgICAgICAudG9Mb3dlckNhc2UoKVxuICAgICAgICAgIC5pbmNsdWRlcyhzZWFyY2hRdWVyeSlcbiAgICAgIClcbiAgICA6IGZpbHRlcmVkO1xuICBjb25zdCBzb3J0ZWQgPSBzb3J0Q2xpZW50ZXMoc2VhcmNoZWQsIHNvcnRCeSwgc29ydERpcik7XG4gIHdoaWxlICh0YWJsZS5maXJzdENoaWxkKSB0YWJsZS5yZW1vdmVDaGlsZCh0YWJsZS5maXJzdENoaWxkKTtcbiAgdGFibGUuYXBwZW5kQ2hpbGQoYnVpbGRUaGVhZCgpKTtcbiAgdGFibGUuYXBwZW5kQ2hpbGQoYnVpbGRUYm9keShzb3J0ZWQpKTtcbn1cblxuZnVuY3Rpb24gYnVpbGRUaGVhZCgpIHtcbiAgLy8gdjEzODM6IEFwcGxlLXN0eWxlIHRoZWFkLiBDbGFzZXMgLmNhcnRlcmEtKiBlbiBpbmRleC5odG1sIGNvbnRyb2xhbiBiZy9jb2xvcnMuXG4gIGNvbnN0IHRoZWFkID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgndGhlYWQnKTtcbiAgY29uc3QgdHIgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCd0cicpO1xuICBjb25zdCBoZWFkZXJzID0gW1xuICAgIHsgbGFiZWw6ICdDbGllbnRlJywgc29ydEtleTogJ2NsaWVudE5hbWUnLCBhbGlnbjogJ2xlZnQnIH0sXG4gICAgeyBsYWJlbDogJ1Byb3YvTG9jJywgc29ydEtleTogbnVsbCwgYWxpZ246ICdsZWZ0JyB9LFxuICAgIHsgbGFiZWw6ICdUaXBvJywgc29ydEtleTogbnVsbCwgYWxpZ246ICdjZW50ZXInIH0sXG4gICAgeyBsYWJlbDogJ1x1MDBEQWx0LiB2aXNpdGEnLCBzb3J0S2V5OiAnZGlhc1NpblZpc2l0YVByZXNlbmNpYWwnLCBhbGlnbjogJ2xlZnQnIH0sXG4gICAgeyBsYWJlbDogJ1x1MDBEQWx0LiBjb250YWN0bycsIHNvcnRLZXk6ICdkaWFzU2luQ29udGFjdG8nLCBhbGlnbjogJ2xlZnQnIH0sXG4gICAgeyBsYWJlbDogJ1x1MDBEQWx0LiBjb21wcmEnLCBzb3J0S2V5OiAnZGlhc1NpbkNvbXByYScsIGFsaWduOiAnbGVmdCcgfSxcbiAgICB7IGxhYmVsOiAnRmFjdCAxMk0nLCBzb3J0S2V5OiAnZmFjdHVyYWRvMTJNJywgYWxpZ246ICdyaWdodCcgfSxcbiAgICB7IGxhYmVsOiAnRGV1ZGEnLCBzb3J0S2V5OiAnZGV1ZGFBYmllcnRhJywgYWxpZ246ICdyaWdodCcgfSxcbiAgXTtcbiAgZm9yIChjb25zdCBoIG9mIGhlYWRlcnMpIHtcbiAgICBjb25zdCB0aCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3RoJyk7XG4gICAgdGguc3R5bGUudGV4dEFsaWduID0gaC5hbGlnbjtcbiAgICB0aC50ZXh0Q29udGVudCA9IGgubGFiZWw7XG4gICAgaWYgKGguc29ydEtleSkge1xuICAgICAgdGguc3R5bGUuY3Vyc29yID0gJ3BvaW50ZXInO1xuICAgICAgY29uc3Qga2V5ID0gaC5zb3J0S2V5O1xuICAgICAgdGguYWRkRXZlbnRMaXN0ZW5lcignY2xpY2snLCAoKSA9PiAvKiogQHR5cGUge2FueX0gKi8gKHdpbmRvdykub25DYXJ0ZXJhU29ydENsaWNrKGtleSkpO1xuICAgIH1cbiAgICB0ci5hcHBlbmRDaGlsZCh0aCk7XG4gIH1cbiAgdGhlYWQuYXBwZW5kQ2hpbGQodHIpO1xuICByZXR1cm4gdGhlYWQ7XG59XG5cbi8qKiBAcGFyYW0ge0FycmF5PGFueT59IHNvcnRlZENsaWVudGVzICovXG5mdW5jdGlvbiBidWlsZFRib2R5KHNvcnRlZENsaWVudGVzKSB7XG4gIGNvbnN0IHRib2R5ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgndGJvZHknKTtcbiAgZm9yIChjb25zdCBjIG9mIHNvcnRlZENsaWVudGVzKSB7XG4gICAgdGJvZHkuYXBwZW5kQ2hpbGQoYnVpbGRDbGllbnRlUm93KGMpKTtcbiAgfVxuICByZXR1cm4gdGJvZHk7XG59XG5cbi8qKiBAcGFyYW0ge2FueX0gYyAqL1xuZnVuY3Rpb24gYnVpbGRDbGllbnRlUm93KGMpIHtcbiAgY29uc3QgdHIgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCd0cicpO1xuICB0ci5zdHlsZS5jc3NUZXh0ID0gJ2N1cnNvcjpwb2ludGVyO2JvcmRlci1ib3R0b206MXB4IHNvbGlkIHZhcigtLWJvcmRlci1saWdodCknO1xuICB0ci5hZGRFdmVudExpc3RlbmVyKCdtb3VzZWVudGVyJywgKCkgPT4ge1xuICAgIHRyLnN0eWxlLmJhY2tncm91bmQgPSAndmFyKC0tYmctaG92ZXIpJztcbiAgfSk7XG4gIHRyLmFkZEV2ZW50TGlzdGVuZXIoJ21vdXNlbGVhdmUnLCAoKSA9PiB7XG4gICAgdHIuc3R5bGUuYmFja2dyb3VuZCA9ICcnO1xuICB9KTtcbiAgdHIuYWRkRXZlbnRMaXN0ZW5lcignY2xpY2snLCAoKSA9PiB7XG4gICAgLy8gQHRzLWV4cGVjdC1lcnJvclxuICAgIGlmICh0eXBlb2Ygd2luZG93Lm9wZW5GaWNoYUNsaWVudGUgPT09ICdmdW5jdGlvbicpIHdpbmRvdy5vcGVuRmljaGFDbGllbnRlKGMuY2xpZW50SWQpO1xuICB9KTtcblxuICBjb25zdCB0ZE5hbWUgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCd0ZCcpO1xuICB0ZE5hbWUuc3R5bGUuY3NzVGV4dCA9ICdwYWRkaW5nOjZweCA4cHg7Zm9udC13ZWlnaHQ6NjAwJztcbiAgdGROYW1lLnRleHRDb250ZW50ID0gYy5jbGllbnROYW1lIHx8ICcnO1xuICB0ci5hcHBlbmRDaGlsZCh0ZE5hbWUpO1xuXG4gIGNvbnN0IHRkTG9jID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgndGQnKTtcbiAgdGRMb2Muc3R5bGUuY3NzVGV4dCA9ICdwYWRkaW5nOjZweCA4cHg7Zm9udC1zaXplOjEycHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCknO1xuICB0ZExvYy50ZXh0Q29udGVudCA9IGAke2MucHJvdmluY2lhIHx8ICcnfS8ke2MubG9jYWxpZGFkIHx8ICcnfWA7XG4gIHRyLmFwcGVuZENoaWxkKHRkTG9jKTtcblxuICBjb25zdCB0ZFRpcG8gPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCd0ZCcpO1xuICB0ZFRpcG8uc3R5bGUuY3NzVGV4dCA9ICdwYWRkaW5nOjZweCA4cHg7dGV4dC1hbGlnbjpjZW50ZXInO1xuICBjb25zdCB0aXBvQmFkZ2UgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdzcGFuJyk7XG4gIHRpcG9CYWRnZS5zdHlsZS5jc3NUZXh0ID1cbiAgICAncGFkZGluZzoycHggNnB4O2JvcmRlci1yYWRpdXM6NHB4O2JhY2tncm91bmQ6dmFyKC0tYmctaW5wdXQpO2ZvbnQtc2l6ZToxMXB4O2ZvbnQtd2VpZ2h0OjcwMCc7XG4gIC8vIHYxNDgyIFx1MDBBNzgyOiBsYWJlbCBkZSBsYSBGaWNoYSAoXCJCIC0gc2luIGRlc2N1ZW50b1wiKSB2cyBjXHUwMEYzZGlnbyAoXCJCXCIpLlxuICB0aXBvQmFkZ2UudGV4dENvbnRlbnQgPSBsYWJlbEZvckZpY2hhRmllbGQoJ2NsaVRpcG8nLCBjLmNsaVRpcG8pO1xuICB0ZFRpcG8uYXBwZW5kQ2hpbGQodGlwb0JhZGdlKTtcbiAgdHIuYXBwZW5kQ2hpbGQodGRUaXBvKTtcblxuICB0ci5hcHBlbmRDaGlsZChidWlsZERhdGVDZWxsKGMudWx0aW1hVmlzaXRhUHJlc2VuY2lhbCwgYy5kaWFzU2luVmlzaXRhUHJlc2VuY2lhbCwgMzApKTtcbiAgdHIuYXBwZW5kQ2hpbGQoYnVpbGREYXRlQ2VsbChjLnVsdGltb0NvbnRhY3RvLCBjLmRpYXNTaW5Db250YWN0bywgbnVsbCkpO1xuICB0ci5hcHBlbmRDaGlsZChidWlsZERhdGVDZWxsKGMudWx0aW1hQ29tcHJhLCBjLmRpYXNTaW5Db21wcmEsIDkwKSk7XG5cbiAgY29uc3QgdGRGYWN0ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgndGQnKTtcbiAgdGRGYWN0LnN0eWxlLmNzc1RleHQgPSAncGFkZGluZzo2cHggOHB4O3RleHQtYWxpZ246cmlnaHQ7Zm9udC12YXJpYW50LW51bWVyaWM6dGFidWxhci1udW1zJztcbiAgdGRGYWN0LnRleHRDb250ZW50ID0gZm10TW9uZXkoYy5mYWN0dXJhZG8xMk0pO1xuICB0ci5hcHBlbmRDaGlsZCh0ZEZhY3QpO1xuXG4gIGNvbnN0IHRkRGV1ZGEgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCd0ZCcpO1xuICB0ZERldWRhLnN0eWxlLmNzc1RleHQgPSBgcGFkZGluZzo2cHggOHB4O3RleHQtYWxpZ246cmlnaHQ7Zm9udC12YXJpYW50LW51bWVyaWM6dGFidWxhci1udW1zO2NvbG9yOiR7Yy5kZXVkYUFiaWVydGEgPiAwID8gJyNkYzI2MjYnIDogJ3ZhcigtLXRleHQtbXV0ZWQpJ31gO1xuICB0ZERldWRhLnRleHRDb250ZW50ID0gZm10TW9uZXkoYy5kZXVkYUFiaWVydGEpO1xuICB0ci5hcHBlbmRDaGlsZCh0ZERldWRhKTtcblxuICByZXR1cm4gdHI7XG59XG5cbi8qKlxuICogQHBhcmFtIHtzdHJpbmd8bnVsbH0gZmVjaGFJc29cbiAqIEBwYXJhbSB7bnVtYmVyfG51bGx9IGRpYXNcbiAqIEBwYXJhbSB7bnVtYmVyfG51bGx9IGRhbmdlclRocmVzaG9sZFxuICovXG5mdW5jdGlvbiBidWlsZERhdGVDZWxsKGZlY2hhSXNvLCBkaWFzLCBkYW5nZXJUaHJlc2hvbGQpIHtcbiAgY29uc3QgdGQgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCd0ZCcpO1xuICBjb25zdCBpc0RhbmdlciA9XG4gICAgZGFuZ2VyVGhyZXNob2xkICE9PSBudWxsICYmIGRpYXMgIT09IG51bGwgJiYgZGlhcyAhPT0gdW5kZWZpbmVkICYmIGRpYXMgPiBkYW5nZXJUaHJlc2hvbGQ7XG4gIHRkLnN0eWxlLmNzc1RleHQgPSBgcGFkZGluZzo2cHggOHB4O2NvbG9yOiR7aXNEYW5nZXIgPyAnI2RjMjYyNicgOiAndmFyKC0tdGV4dC1wcmltYXJ5KSd9YDtcbiAgaWYgKCFmZWNoYUlzbykge1xuICAgIHRkLnRleHRDb250ZW50ID0gJ1x1MjAxNCc7XG4gICAgcmV0dXJuIHRkO1xuICB9XG4gIGNvbnN0IHBhcnRzID0gU3RyaW5nKGZlY2hhSXNvKS5zcGxpdCgnLScpO1xuICBjb25zdCBkID0gcGFydHNbMl0gfHwgJyc7XG4gIGNvbnN0IG0gPSBwYXJ0c1sxXSB8fCAnJztcbiAgdGQudGV4dENvbnRlbnQgPSBgJHtkfS8ke219YDtcbiAgY29uc3QgZGlhc0VsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnc21hbGwnKTtcbiAgZGlhc0VsLnN0eWxlLmNzc1RleHQgPSAnY29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7bWFyZ2luLWxlZnQ6NHB4JztcbiAgZGlhc0VsLnRleHRDb250ZW50ID0gYCR7ZGlhc31kYDtcbiAgdGQuYXBwZW5kQ2hpbGQoZGlhc0VsKTtcbiAgcmV0dXJuIHRkO1xufVxuXG4vKiogQHBhcmFtIHtudW1iZXJ9IG4gKi9cbmZ1bmN0aW9uIGZtdE1vbmV5KG4pIHtcbiAgaWYgKCFuIHx8IG4gPT09IDApIHJldHVybiAnLSc7XG4gIGlmIChuID49IDFfMDAwXzAwMCkgcmV0dXJuIGAkICR7KG4gLyAxXzAwMF8wMDApLnRvRml4ZWQoMSl9TWA7XG4gIGlmIChuID49IDFfMDAwKSByZXR1cm4gYCQgJHsobiAvIDFfMDAwKS50b0ZpeGVkKDApfWtgO1xuICByZXR1cm4gYCQgJHtufWA7XG59XG5cbi8vID09PSBVSSBzdGF0ZSBoZWxwZXJzID09PVxuZnVuY3Rpb24gaGlkZUFsbCgpIHtcbiAgY29uc3QgaWRzID0gW1xuICAgICdjYXJ0ZXJhLWxvYWRpbmcnLFxuICAgICdjYXJ0ZXJhLXRhYmxlJyxcbiAgICAnY2FydGVyYS1rcGlzJyxcbiAgICAnY2FydGVyYS1jaGlwcycsXG4gICAgJ2NhcnRlcmEtZW1wdHknLFxuICBdO1xuICBmb3IgKGNvbnN0IGlkIG9mIGlkcykge1xuICAgIGNvbnN0IGVsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoaWQpO1xuICAgIGlmIChlbCkgZWwuc3R5bGUuZGlzcGxheSA9ICdub25lJztcbiAgfVxufVxuZnVuY3Rpb24gc2hvd0VtcHR5KCkge1xuICBoaWRlQWxsKCk7XG4gIGNvbnN0IGVtcHR5ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2NhcnRlcmEtZW1wdHknKTtcbiAgaWYgKGVtcHR5KSB7XG4gICAgZW1wdHkuc3R5bGUuZGlzcGxheSA9ICdibG9jayc7XG4gICAgZW1wdHkudGV4dENvbnRlbnQgPSAnRWxlZ1x1MDBFRCB1biB2ZW5kZWRvciBwYXJhIHZlciBzdSBjYXJ0ZXJhLic7XG4gIH1cbn1cbmZ1bmN0aW9uIHNob3dMb2FkaW5nKCkge1xuICBoaWRlQWxsKCk7XG4gIGNvbnN0IGxvYWRpbmcgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY2FydGVyYS1sb2FkaW5nJyk7XG4gIGlmIChsb2FkaW5nKSBsb2FkaW5nLnN0eWxlLmRpc3BsYXkgPSAnYmxvY2snO1xufVxuZnVuY3Rpb24gc2hvd05vRGF0YSgpIHtcbiAgaGlkZUFsbCgpO1xuICBjb25zdCBlbXB0eSA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdjYXJ0ZXJhLWVtcHR5Jyk7XG4gIGlmIChlbXB0eSkge1xuICAgIGVtcHR5LnN0eWxlLmRpc3BsYXkgPSAnYmxvY2snO1xuICAgIGVtcHR5LnRleHRDb250ZW50ID1cbiAgICAgICdTaW4gY2FydGVyYSBwYXJhIGVzdGUgdmVuZGVkb3IuIFZlcmlmaWNcdTAwRTEgYXNzaWduZWRWZW5kb3IgZW4gY2xpZW50X21hc3RlciBvIGVzcGVyXHUwMEUxIGFsIHByXHUwMEYzeGltbyBzbmFwc2hvdCAoMDQ6MDAgQVJUKS4nO1xuICB9XG59XG4vKiogQHBhcmFtIHtzdHJpbmd9IG1zZyAqL1xuZnVuY3Rpb24gc2hvd0Vycm9yKG1zZykge1xuICBoaWRlQWxsKCk7XG4gIGNvbnN0IGVtcHR5ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2NhcnRlcmEtZW1wdHknKTtcbiAgaWYgKGVtcHR5KSB7XG4gICAgZW1wdHkuc3R5bGUuZGlzcGxheSA9ICdibG9jayc7XG4gICAgZW1wdHkuc3R5bGUuY29sb3IgPSAnI2RjMjYyNic7XG4gICAgZW1wdHkudGV4dENvbnRlbnQgPSBgRXJyb3IgY2FyZ2FuZG8gY2FydGVyYTogJHttc2d9YDtcbiAgfVxufVxuZnVuY3Rpb24gc2hvd1RhYmxlKCkge1xuICBjb25zdCBlbXB0eSA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdjYXJ0ZXJhLWVtcHR5Jyk7XG4gIGlmIChlbXB0eSkgZW1wdHkuc3R5bGUuZGlzcGxheSA9ICdub25lJztcbiAgY29uc3QgbG9hZGluZyA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdjYXJ0ZXJhLWxvYWRpbmcnKTtcbiAgaWYgKGxvYWRpbmcpIGxvYWRpbmcuc3R5bGUuZGlzcGxheSA9ICdub25lJztcbiAgY29uc3QgdGFibGUgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY2FydGVyYS10YWJsZScpO1xuICBpZiAodGFibGUpIHRhYmxlLnN0eWxlLmRpc3BsYXkgPSAndGFibGUnO1xuICAvLyB2MTM4MzogZGlzcGxheSB2YWNpbyA9IHJlc2V0IGFsIHZhbG9yIGRlbCBDU1MgKGdyaWQgcGFyYSBrcGlzLCBmbGV4IHBhcmEgY2hpcHMpLlxuICBjb25zdCBrcGlzID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2NhcnRlcmEta3BpcycpO1xuICBpZiAoa3Bpcykga3Bpcy5zdHlsZS5kaXNwbGF5ID0gJyc7XG4gIGNvbnN0IGNoaXBzID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2NhcnRlcmEtY2hpcHMnKTtcbiAgaWYgKGNoaXBzKSBjaGlwcy5zdHlsZS5kaXNwbGF5ID0gJyc7XG59XG5cbi8vID09PSBFeHBvcnQgRXhjZWwgPT09XG53aW5kb3cuZXhwb3J0Q2FydGVyYVRvRXhjZWwgPSBhc3luYyBmdW5jdGlvbiBleHBvcnRDYXJ0ZXJhVG9FeGNlbCgpIHtcbiAgaWYgKCFzZWxlY3RlZFZlbmRvcikge1xuICAgIGFsZXJ0KCdFbGVnXHUwMEVEIHVuIHZlbmRlZG9yIHByaW1lcm8uJyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGNvbnN0IGRvYyA9IGNhcnRlcmFEb2NDYWNoZS5nZXQoc2VsZWN0ZWRWZW5kb3IpO1xuICBpZiAoIWRvYykge1xuICAgIGFsZXJ0KCdTaW4gZGF0YSBjYXJnYWRhLicpO1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCBmaWx0ZXJlZCA9IGFwcGx5Q2hpcEZpbHRlcihkb2MuY2xpZW50ZXMsIGFjdGl2ZUNoaXApO1xuICBjb25zdCBzZWFyY2hlZCA9IHNlYXJjaFF1ZXJ5XG4gICAgPyBmaWx0ZXJlZC5maWx0ZXIoKGMpID0+XG4gICAgICAgIFN0cmluZyhjLmNsaWVudE5hbWUgfHwgJycpXG4gICAgICAgICAgLnRvTG93ZXJDYXNlKClcbiAgICAgICAgICAuaW5jbHVkZXMoc2VhcmNoUXVlcnkpXG4gICAgICApXG4gICAgOiBmaWx0ZXJlZDtcbiAgY29uc3Qgc29ydGVkID0gc29ydENsaWVudGVzKHNlYXJjaGVkLCBzb3J0QnksIHNvcnREaXIpO1xuXG4gIGNvbnN0IGNoaXBMYWJlbCA9IChDSElQUy5maW5kKChjKSA9PiBjLmlkID09PSBhY3RpdmVDaGlwKSB8fCB7IGxhYmVsOiAnVG9kb3MnIH0pLmxhYmVsO1xuICBjb25zdCB0aXRsZSA9IGBDYXJ0ZXJhIGRlICR7c2VsZWN0ZWRWZW5kb3J9IFx1MjAxNCAke2NoaXBMYWJlbH0gXHUyMDE0IFNuYXBzaG90ICR7ZG9jLnNuYXBzaG90RGF0ZX1gO1xuXG4gIHRyeSB7XG4gICAgaWYgKHR5cGVvZiB3aW5kb3cubG9hZEV4Y2VsSlMgPT09ICdmdW5jdGlvbicpIHtcbiAgICAgIGF3YWl0IHdpbmRvdy5sb2FkRXhjZWxKUygpO1xuICAgIH1cbiAgICBjb25zdCBFeGNlbEpTID0gd2luZG93LkV4Y2VsSlM7XG4gICAgaWYgKCFFeGNlbEpTKSB0aHJvdyBuZXcgRXJyb3IoJ0V4Y2VsSlMgbm8gZGlzcG9uaWJsZScpO1xuICAgIGNvbnN0IHdiID0gbmV3IEV4Y2VsSlMuV29ya2Jvb2soKTtcbiAgICBjb25zdCB3cyA9IHdiLmFkZFdvcmtzaGVldCgnQ2FydGVyYScpO1xuXG4gICAgLy8gRmlsYSAxOiB0aXR1bG8gYmFuZGEgdmVyZGUgU2hpbWFub1xuICAgIHdzLm1lcmdlQ2VsbHMoJ0ExOkwxJyk7XG4gICAgY29uc3QgdGl0bGVDZWxsID0gd3MuZ2V0Q2VsbCgnQTEnKTtcbiAgICB0aXRsZUNlbGwudmFsdWUgPSB0aXRsZTtcbiAgICB0aXRsZUNlbGwuZmlsbCA9IHsgdHlwZTogJ3BhdHRlcm4nLCBwYXR0ZXJuOiAnc29saWQnLCBmZ0NvbG9yOiB7IGFyZ2I6ICdGRjIyQzU1RScgfSB9O1xuICAgIHRpdGxlQ2VsbC5mb250ID0geyBib2xkOiB0cnVlLCBjb2xvcjogeyBhcmdiOiAnRkZGRkZGRkYnIH0sIHNpemU6IDE0IH07XG4gICAgdGl0bGVDZWxsLmFsaWdubWVudCA9IHsgaG9yaXpvbnRhbDogJ2NlbnRlcicsIHZlcnRpY2FsOiAnbWlkZGxlJyB9O1xuICAgIHdzLmdldFJvdygxKS5oZWlnaHQgPSAzMDtcblxuICAgIC8vIEZpbGEgMjogaGVhZGVyc1xuICAgIGNvbnN0IGhlYWRlcnMgPSBbXG4gICAgICAnQ2xpZW50ZScsXG4gICAgICAnUHJvdmluY2lhJyxcbiAgICAgICdMb2NhbGlkYWQnLFxuICAgICAgJ1RpcG8nLFxuICAgICAgJ1x1MDBEQWx0aW1hIHZpc2l0YSBwcmVzZW5jaWFsJyxcbiAgICAgICdcdTAwREFsdGltbyBjb250YWN0bycsXG4gICAgICAnXHUwMERBbHRpbWEgY29tcHJhJyxcbiAgICAgICdGYWN0IDEyTSAoQVJTKScsXG4gICAgICAnRGV1ZGEgYWJpZXJ0YSAoQVJTKScsXG4gICAgICAnRFx1MDBFRGFzIHNpbiB2aXNpdGEnLFxuICAgICAgJ0RcdTAwRURhcyBzaW4gY29tcHJhJyxcbiAgICAgICdDYXJkQ29kZSBTQVAnLFxuICAgIF07XG4gICAgY29uc3QgaGVhZGVyUm93ID0gd3MuZ2V0Um93KDIpO1xuICAgIGhlYWRlcnMuZm9yRWFjaCgoaCwgaSkgPT4ge1xuICAgICAgY29uc3QgY2VsbCA9IGhlYWRlclJvdy5nZXRDZWxsKGkgKyAxKTtcbiAgICAgIGNlbGwudmFsdWUgPSBoO1xuICAgICAgY2VsbC5maWxsID0geyB0eXBlOiAncGF0dGVybicsIHBhdHRlcm46ICdzb2xpZCcsIGZnQ29sb3I6IHsgYXJnYjogJ0ZGMDc0RjY5JyB9IH07XG4gICAgICBjZWxsLmZvbnQgPSB7IGJvbGQ6IHRydWUsIGNvbG9yOiB7IGFyZ2I6ICdGRkZGRkZGRicgfSB9O1xuICAgICAgY2VsbC5hbGlnbm1lbnQgPSB7IGhvcml6b250YWw6ICdjZW50ZXInIH07XG4gICAgfSk7XG5cbiAgICAvLyBGaWxhcyAzKzogZGF0YVxuICAgIHNvcnRlZC5mb3JFYWNoKChjLCBpKSA9PiB7XG4gICAgICBjb25zdCByb3cgPSB3cy5nZXRSb3coMyArIGkpO1xuICAgICAgcm93LmdldENlbGwoMSkudmFsdWUgPSBjLmNsaWVudE5hbWUgfHwgJyc7XG4gICAgICByb3cuZ2V0Q2VsbCgyKS52YWx1ZSA9IGMucHJvdmluY2lhIHx8ICcnO1xuICAgICAgcm93LmdldENlbGwoMykudmFsdWUgPSBjLmxvY2FsaWRhZCB8fCAnJztcbiAgICAgIHJvdy5nZXRDZWxsKDQpLnZhbHVlID0gbGFiZWxGb3JGaWNoYUZpZWxkKCdjbGlUaXBvJywgYy5jbGlUaXBvKTtcbiAgICAgIHJvdy5nZXRDZWxsKDUpLnZhbHVlID0gYy51bHRpbWFWaXNpdGFQcmVzZW5jaWFsIHx8ICcnO1xuICAgICAgcm93LmdldENlbGwoNikudmFsdWUgPSBjLnVsdGltb0NvbnRhY3RvIHx8ICcnO1xuICAgICAgcm93LmdldENlbGwoNykudmFsdWUgPSBjLnVsdGltYUNvbXByYSB8fCAnJztcbiAgICAgIHJvdy5nZXRDZWxsKDgpLnZhbHVlID0gYy5mYWN0dXJhZG8xMk0gfHwgMDtcbiAgICAgIHJvdy5nZXRDZWxsKDgpLm51bUZtdCA9ICdcIiRcIiMsIyMwJztcbiAgICAgIHJvdy5nZXRDZWxsKDkpLnZhbHVlID0gYy5kZXVkYUFiaWVydGEgfHwgMDtcbiAgICAgIHJvdy5nZXRDZWxsKDkpLm51bUZtdCA9ICdcIiRcIiMsIyMwJztcbiAgICAgIHJvdy5nZXRDZWxsKDEwKS52YWx1ZSA9IGMuZGlhc1NpblZpc2l0YVByZXNlbmNpYWw7XG4gICAgICByb3cuZ2V0Q2VsbCgxMSkudmFsdWUgPSBjLmRpYXNTaW5Db21wcmE7XG4gICAgICByb3cuZ2V0Q2VsbCgxMikudmFsdWUgPSBjLmNhcmRDb2RlIHx8ICcnO1xuICAgIH0pO1xuXG4gICAgd3MuY29sdW1ucy5mb3JFYWNoKChjb2wsIGkpID0+IHtcbiAgICAgIGNvbC53aWR0aCA9IGkgPT09IDAgPyAzMCA6IGkgPT09IDQgfHwgaSA9PT0gNSB8fCBpID09PSA2ID8gMTggOiAxNDtcbiAgICB9KTtcblxuICAgIGNvbnN0IGJ1ZiA9IGF3YWl0IHdiLnhsc3gud3JpdGVCdWZmZXIoKTtcbiAgICBjb25zdCBibG9iID0gbmV3IEJsb2IoW2J1Zl0sIHtcbiAgICAgIHR5cGU6ICdhcHBsaWNhdGlvbi92bmQub3BlbnhtbGZvcm1hdHMtb2ZmaWNlZG9jdW1lbnQuc3ByZWFkc2hlZXRtbC5zaGVldCcsXG4gICAgfSk7XG4gICAgY29uc3QgdXJsID0gVVJMLmNyZWF0ZU9iamVjdFVSTChibG9iKTtcbiAgICBjb25zdCBhID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnYScpO1xuICAgIGEuaHJlZiA9IHVybDtcbiAgICBhLmRvd25sb2FkID0gYENhcnRlcmFfJHtTdHJpbmcoc2VsZWN0ZWRWZW5kb3IpLnJlcGxhY2UoL1xccysvZywgJ18nKX1fJHthY3RpdmVDaGlwfV8ke2RvYy5zbmFwc2hvdERhdGV9Lnhsc3hgO1xuICAgIGRvY3VtZW50LmJvZHkuYXBwZW5kQ2hpbGQoYSk7XG4gICAgYS5jbGljaygpO1xuICAgIGEucmVtb3ZlKCk7XG4gICAgVVJMLnJldm9rZU9iamVjdFVSTCh1cmwpO1xuICB9IGNhdGNoIChlKSB7XG4gICAgY29uc29sZS5lcnJvcignZXhwb3J0Q2FydGVyYVRvRXhjZWwgZmFpbGVkJywgZSk7XG4gICAgYWxlcnQoJ0Vycm9yIGV4cG9ydGFuZG86ICcgKyBTdHJpbmcoZSkpO1xuICB9XG59O1xuIl0sCiAgIm1hcHBpbmdzIjogIjs7O0FBZU8sV0FBUyxnQkFBZ0IsVUFBVSxNQUFNO0FBQzlDLFFBQUksQ0FBQyxNQUFNLFFBQVEsUUFBUSxFQUFHLFFBQU8sQ0FBQztBQUN0QyxZQUFRLE1BQU07QUFBQSxNQUNaLEtBQUs7QUFDSCxl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
