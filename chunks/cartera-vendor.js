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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL3B1cmUvY2FydGVyYS12ZW5kb3ItZmlsdGVyLmpzIiwgIi4uL3NyYy9wdXJlL2ZpY2hhLWNsaWVudGUtbGFiZWxzLmpzIiwgIi4uL3NyYy9kb21haW5zL2NhcnRlcmEtdmVuZG9yLmpzIl0sCiAgInNvdXJjZXNDb250ZW50IjogWyIvLyBAdHMtY2hlY2tcbi8qKlxuICogY2FydGVyYS12ZW5kb3ItZmlsdGVyLmpzICh2MTI4MywgMjAyNi0xMC0yMClcbiAqXG4gKiBQdXJhcyBwYXJhIGZpbHRyYXIgeSBvcmRlbmFyIGxhIHRhYmxhIGRlbCBkYXNoYm9hcmQgXCJBbmFsaXNpcyBkZSBDYXJ0ZXJhXCIuXG4gKiBJbXBvcnRhZG8gcG9yIHNyYy9kb21haW5zL2NhcnRlcmEtdmVuZG9yLmpzIChidW5kbGUgZnJvbnRlbmQpLlxuICogVGVzdGVhZG8gZW4gdGVzdHMvdW5pdC9jYXJ0ZXJhLXZlbmRvci1maWx0ZXIudGVzdC5qcy5cbiAqL1xuXG4vKipcbiAqIEFwbGljYSB1biBjaGlwIGRlIGZpbHRybyBhbCBhcnJheSBkZSBjbGllbnRlcy5cbiAqIEBwYXJhbSB7QXJyYXk8YW55Pn0gY2xpZW50ZXNcbiAqIEBwYXJhbSB7c3RyaW5nfSBjaGlwXG4gKiBAcmV0dXJucyB7QXJyYXk8YW55Pn1cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGFwcGx5Q2hpcEZpbHRlcihjbGllbnRlcywgY2hpcCkge1xuICBpZiAoIUFycmF5LmlzQXJyYXkoY2xpZW50ZXMpKSByZXR1cm4gW107XG4gIHN3aXRjaCAoY2hpcCkge1xuICAgIGNhc2UgJ2Jhc2VBY3RpdmE5MGQnOlxuICAgICAgcmV0dXJuIGNsaWVudGVzLmZpbHRlcihcbiAgICAgICAgKGMpID0+IGMuZGlhc1NpbkNvbXByYSAhPT0gbnVsbCAmJiBjLmRpYXNTaW5Db21wcmEgIT09IHVuZGVmaW5lZCAmJiBjLmRpYXNTaW5Db21wcmEgPD0gOTBcbiAgICAgICk7XG4gICAgY2FzZSAnZG9ybWlkb3NWaXNpdGEzMGQnOlxuICAgICAgcmV0dXJuIGNsaWVudGVzLmZpbHRlcihcbiAgICAgICAgKGMpID0+XG4gICAgICAgICAgYy5kaWFzU2luVmlzaXRhUHJlc2VuY2lhbCAhPT0gbnVsbCAmJlxuICAgICAgICAgIGMuZGlhc1NpblZpc2l0YVByZXNlbmNpYWwgIT09IHVuZGVmaW5lZCAmJlxuICAgICAgICAgIGMuZGlhc1NpblZpc2l0YVByZXNlbmNpYWwgPiAzMFxuICAgICAgKTtcbiAgICBjYXNlICdkb3JtaWRvc0NvbXByYTkwZCc6XG4gICAgICByZXR1cm4gY2xpZW50ZXMuZmlsdGVyKFxuICAgICAgICAoYykgPT4gYy5kaWFzU2luQ29tcHJhICE9PSBudWxsICYmIGMuZGlhc1NpbkNvbXByYSAhPT0gdW5kZWZpbmVkICYmIGMuZGlhc1NpbkNvbXByYSA+IDkwXG4gICAgICApO1xuICAgIGNhc2UgJ251bmNhVmlzaXRhZG9zJzpcbiAgICAgIHJldHVybiBjbGllbnRlcy5maWx0ZXIoXG4gICAgICAgIChjKSA9PiBjLnVsdGltYVZpc2l0YVByZXNlbmNpYWwgPT09IG51bGwgfHwgYy51bHRpbWFWaXNpdGFQcmVzZW5jaWFsID09PSB1bmRlZmluZWRcbiAgICAgICk7XG4gICAgY2FzZSAnbnVuY2FDb21wcmFyb24nOlxuICAgICAgcmV0dXJuIGNsaWVudGVzLmZpbHRlcigoYykgPT4gYy51bHRpbWFDb21wcmEgPT09IG51bGwgfHwgYy51bHRpbWFDb21wcmEgPT09IHVuZGVmaW5lZCk7XG4gICAgZGVmYXVsdDpcbiAgICAgIHJldHVybiBjbGllbnRlcy5zbGljZSgpO1xuICB9XG59XG5cbi8qKlxuICogT3JkZW5hIHVuYSBjb3BpYSBkZWwgYXJyYXkgcG9yIGNvbHVtbmEuIE51bGxzIHNpZW1wcmUgYWwgZmluYWwuXG4gKiBAcGFyYW0ge0FycmF5PGFueT59IGNsaWVudGVzXG4gKiBAcGFyYW0ge3N0cmluZ30gc29ydEJ5XG4gKiBAcGFyYW0geydhc2MnfCdkZXNjJ30gc29ydERpclxuICogQHJldHVybnMge0FycmF5PGFueT59XG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzb3J0Q2xpZW50ZXMoY2xpZW50ZXMsIHNvcnRCeSwgc29ydERpcikge1xuICBpZiAoIUFycmF5LmlzQXJyYXkoY2xpZW50ZXMpKSByZXR1cm4gW107XG4gIGNvbnN0IGRpciA9IHNvcnREaXIgPT09ICdhc2MnID8gMSA6IC0xO1xuICBjb25zdCBjb3B5ID0gY2xpZW50ZXMuc2xpY2UoKTtcbiAgY29weS5zb3J0KChhLCBiKSA9PiB7XG4gICAgY29uc3QgYXYgPSBhW3NvcnRCeV07XG4gICAgY29uc3QgYnYgPSBiW3NvcnRCeV07XG4gICAgY29uc3QgYU51bGwgPSBhdiA9PT0gbnVsbCB8fCBhdiA9PT0gdW5kZWZpbmVkO1xuICAgIGNvbnN0IGJOdWxsID0gYnYgPT09IG51bGwgfHwgYnYgPT09IHVuZGVmaW5lZDtcbiAgICBpZiAoYU51bGwgJiYgYk51bGwpIHJldHVybiAwO1xuICAgIGlmIChhTnVsbCkgcmV0dXJuIDE7XG4gICAgaWYgKGJOdWxsKSByZXR1cm4gLTE7XG4gICAgaWYgKHR5cGVvZiBhdiA9PT0gJ251bWJlcicgJiYgdHlwZW9mIGJ2ID09PSAnbnVtYmVyJykgcmV0dXJuIChhdiAtIGJ2KSAqIGRpcjtcbiAgICByZXR1cm4gU3RyaW5nKGF2KS5sb2NhbGVDb21wYXJlKFN0cmluZyhidikpICogZGlyO1xuICB9KTtcbiAgcmV0dXJuIGNvcHk7XG59XG4iLCAiLy8gQHRzLWNoZWNrXG4vKipcbiAqIGZpY2hhLWNsaWVudGUtbGFiZWxzICh2MTQ4MiwgMjAyNi0xMC0yNykgXHUyMDE0IGZ1ZW50ZSBcdTAwRkFuaWNhIGRlIGxhYmVscyB5XG4gKiBjb21wb3NlLXJvdyBwYXJhIGxvcyBjYW1wb3MgZGUgbGEgRmljaGEgQ2xpZW50ZSAobW9kYWxcbiAqICNmaWNoYS1jbGllbnRlLW1vZGFsLCBwZXN0YVx1MDBGMWFzIENsYXNpZmljYWNpXHUwMEYzbiArIEJ1eWVyKS5cbiAqXG4gKiBNYXJpYW5vIHYxNDgyOiByZXVzYXIgZW4gTWFzdGVyZmlsZSBleHBvcnQgKyBBblx1MDBFMWxpc2lzIGRlIENhcnRlcmEgcG9yXG4gKiBWZW5kZWRvciBwYXJhIG5vIGR1cGxpY2FyIGVsIG1hcGVvIGRlIGV0aXF1ZXRhcy4gTG9zIGxhYmVscyBzb24gbG9zXG4gKiBFWEFDVE9TIHF1ZSBhcGFyZWNlbiBlbiBsb3MgYDxvcHRpb24+YCBkZWwgbW9kYWwgKHZlciBpbmRleC5odG1sOjU5MTkrKS5cbiAqXG4gKiBSZWdsYSBkZSBsbGVuYWRvOiBzaSBlbCBjbGllbnRlIHRpZW5lIGVsIGRhdG8sIHZhIGVsIHZhbG9yIHRhbCBjdWFsIHNlXG4gKiBtdWVzdHJhIGVuIGxhIEZpY2hhIChcIkIgLSBzaW4gZGVzY3VlbnRvXCIsIG5vIGVsIGNcdTAwRjNkaWdvIFwiQlwiKTsgc2kgbm8gbG9cbiAqIHRpZW5lLCB2YSBcIi1cIi4gTmluZ3VuYSBjZWxkYSBxdWVkYSB2YWNcdTAwRURhLlxuICpcbiAqIEZ1ZW50ZXM6XG4gKiAgIC0gY21EYXRhID0gY2xpZW50X21hc3Rlci97ZG9jSWR9OiBjbGlUaXBvLCBmaWRlbGlkYWQsIHByZWZDb250YWN0byxcbiAqICAgICB0YW1hbm8sIGVzcGVjaWFsaXphY2lvbiwgdGlwb0xvY2FsLCBjcmVkaXRvQ2hlcXVlIChjYW1wb3MgZGUgbGFcbiAqICAgICBwZXN0YVx1MDBGMWEgQ2xhc2lmaWNhY2lcdTAwRjNuIGRlIGxhIEZpY2hhKS5cbiAqICAgLSBidXllclN0YXRzID0gY2xpZW50X2J1eWVyX3N0YXRzL3tjYXJkQ29kZX06IHN0YXRzXzEybSBjb24gbW9udG9Ub3RhbCxcbiAqICAgICBmYWN0dXJhc0NvdW50LCBtb250b1Byb21lZGlvLCBmcmVjdWVuY2lhRGlhcywgZmFjdHVyYXNQb3JNZXMsXG4gKiAgICAgdWx0aW1hQ29tcHJhLCBkaWFzRGVzZGVVbHRpbWEsIHByaW1lcmFDb21wcmEgKHBlc3RhXHUwMEYxYSBCdXllciwgdmVudGFuYVxuICogICAgIHBvciBkZWZhdWx0IDEyIG1lc2VzIFx1MjAxNCBtaXNtYSBxdWUgYXJyYW5jYSBlbCBtb2RhbCkuXG4gKi9cblxuLyoqXG4gKiBMYWJlbHMgZGUgbG9zIHNlbGVjdHMgZGUgbGEgcGVzdGFcdTAwRjFhIENsYXNpZmljYWNpXHUwMEYzbi4gTWFwZWEgY1x1MDBGM2RpZ28gaW50ZXJub1xuICogKGxvIHF1ZSBzZSBwZXJzaXN0ZSBlbiBGaXJlc3RvcmUpIFx1MjE5MiBsYWJlbCBsZWdpYmxlIChsbyBxdWUgbXVlc3RyYSBlbFxuICogbW9kYWwpLiBGdWVudGU6IGluZGV4Lmh0bWw6NTkxOS01OTc3IChvcHRpb24gdmFsdWVzICsgZGlzcGxheSB0ZXh0KS5cbiAqXG4gKiBPcGNpXHUwMEYzbiBcIlwiIChzaW4gY2xhc2lmaWNhcikgTk8gc2UgbWFwZWEgYWNcdTAwRTEgXHUyMDE0IHNlIHRyYXRhIGNvbW8gXCJzaW4gdmFsb3JcIlxuICogZW4gbGFiZWxGb3JGaWNoYUZpZWxkIFx1MjE5MiBkZXZ1ZWx2ZSBcIi1cIi5cbiAqL1xuZXhwb3J0IGNvbnN0IEZJQ0hBX0NMQVNJRl9MQUJFTFMgPSBPYmplY3QuZnJlZXplKHtcbiAgY2xpVGlwbzogT2JqZWN0LmZyZWV6ZSh7XG4gICAgUDogJ1AgKFByZW1pdW0pIC0gZmlqbyA2JSAvIGFudGljaXBhZG8gNSUnLFxuICAgIEE6ICdBIC0gZmlqbyAzJSAvIGFudGljaXBhZG8gMyUnLFxuICAgIEI6ICdCIC0gc2luIGRlc2N1ZW50bycsXG4gICAgQzogJ0MgLSBzaW4gZGVzY3VlbnRvJyxcbiAgfSksXG4gIGZpZGVsaWRhZDogT2JqZWN0LmZyZWV6ZSh7XG4gICAgQUxUQTogJ0FsdGEnLFxuICAgIE1FRElBOiAnTWVkaWEnLFxuICAgIEJBSkE6ICdCYWphJyxcbiAgfSksXG4gIHByZWZDb250YWN0bzogT2JqZWN0LmZyZWV6ZSh7XG4gICAgQ0FMTF9DRU5URVI6ICdDYWxsIENlbnRlcicsXG4gICAgUFJFU0VOQ0lBTDogJ1ByZXNlbmNpYWwnLFxuICAgIEFNQk9TOiAnQW1ib3MnLFxuICAgIEFVVE9HRVNUSU9OX0IyQjogJ0F1dG9nZXN0aVx1MDBGM24gKEIyQiknLFxuICB9KSxcbiAgdGFtYW5vOiBPYmplY3QuZnJlZXplKHtcbiAgICBHUkFOREU6ICdHcmFuZGUnLFxuICAgIE1FRElBTk86ICdNZWRpYW5vJyxcbiAgICBDSElDQTogJ0NoaWNhJyxcbiAgICBMT0RHRTogJ0xvZGdlJyxcbiAgICBHVUlBX0RFX1BFU0NBOiAnR3VcdTAwRURhIGRlIHBlc2NhJyxcbiAgICBWRU5UQVNfRVNQRUNJQUxFUzogJ1ZlbnRhcyBlc3BlY2lhbGVzJyxcbiAgfSksXG4gIGVzcGVjaWFsaXphY2lvbjogT2JqZWN0LmZyZWV6ZSh7XG4gICAgQUdVQV9EVUxDRTogJ0FndWEgZHVsY2UnLFxuICAgIFBFU0NBX0RFX01BUjogJ1Blc2NhIGRlIG1hcicsXG4gICAgQUxUQV9HQU1BOiAnQWx0YSBnYW1hJyxcbiAgICBCQUpBX0dFTkVSQUw6ICdCYWphIC0gR2VuZXJhbCcsXG4gIH0pLFxuICB0aXBvTG9jYWw6IE9iamVjdC5mcmVlemUoe1xuICAgIEZJU0lDTzogJ0ZcdTAwRURzaWNvJyxcbiAgICBFQ09NTUVSQ0U6ICdFLWNvbW1lcmNlJyxcbiAgfSksXG59KTtcblxuLyoqXG4gKiBEZXZ1ZWx2ZSBlbCBsYWJlbCBsZWdpYmxlIGRlIHVuIGNhbXBvIGRlIGxhIEZpY2hhLiBTaSBlbCB2YWx1ZSBlc3RcdTAwRTFcbiAqIHZhY1x1MDBFRG8vbnVsbC91bmRlZmluZWQgbyBubyBtYXBlYWRvLCBkZXZ1ZWx2ZSBcIi1cIi5cbiAqXG4gKiBAcGFyYW0ge3N0cmluZ30gZmllbGQgIG5vbWJyZSBkZWwgY2FtcG8gKGNsaVRpcG8sIGZpZGVsaWRhZCwgLi4uKS5cbiAqIEBwYXJhbSB7c3RyaW5nIHwgbnVsbCB8IHVuZGVmaW5lZH0gdmFsdWUgIHZhbG9yIHBlcnNpc3RpZG8gZW4gRmlyZXN0b3JlLlxuICogQHJldHVybnMge3N0cmluZ31cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGxhYmVsRm9yRmljaGFGaWVsZChmaWVsZCwgdmFsdWUpIHtcbiAgaWYgKHZhbHVlID09PSBudWxsIHx8IHZhbHVlID09PSB1bmRlZmluZWQgfHwgdmFsdWUgPT09ICcnKSByZXR1cm4gJy0nO1xuICBjb25zdCBtYXAgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJlY29yZDxzdHJpbmcsIHN0cmluZz4+fSAqLyAoRklDSEFfQ0xBU0lGX0xBQkVMUylbZmllbGRdO1xuICBpZiAoIW1hcCkgcmV0dXJuICctJztcbiAgY29uc3Qga2V5ID0gU3RyaW5nKHZhbHVlKS50b1VwcGVyQ2FzZSgpO1xuICByZXR1cm4gbWFwW2tleV0gfHwgJy0nO1xufVxuXG4vKipcbiAqIEJ1c2NhIGVsIGRvYyBgY2xpZW50X21hc3RlcmAgcXVlIGNvcnJlc3BvbmRlIGEgdW4gY2FyZENvZGUgU0FQLlxuICogU2NhbiBgY2xpZW50TWFzdGVyQ2FjaGVgIHBvciBgc2FwQ2FyZENvZGVgIE9SIGBjYXJkQ29kZVNhcGAgKGFtYm9zIGFsaWFzZXNcbiAqIGFwYXJlY2VuIGVuIHByb2Qgc2VnXHUwMEZBbiBlbCBmbG93IHF1ZSBjcmVcdTAwRjMgZWwgZG9jKS5cbiAqXG4gKiAqKlBvciBxdVx1MDBFOSBleGlzdGUgKHYxNDg1IFx1MDBBNzg0LCAyMDI2LTEwLTI3IGJ1ZyBmaXgpKio6IGVuIHYxNDgyIGVsIGV4cG9ydFxuICogYnVzY2FiYSBgY2xpZW50TWFzdGVyQ2FjaGUuZ2V0KGNsaWVudExvY0lkKHBvaW50LnByb3ZpbmNlLCBwb2ludC5uYW1lLCBuYW1lKSlgXG4gKiBcdTIwMTQgc2x1ZyBkZXJpdmFkbyBkZWwgcGFkclx1MDBGM24gUE9JTlRTLiBQYXJhIGNsaWVudGVzIGNvbW8gQUxCRVJUTyBNQVhFUkEsIGVsXG4gKiBQT0lOVFMgZGljZSBgbmFtZT1cIlBhbGVybW8gKEMxNClcImAgcGVybyBsYSBGaWNoYSBwZXJzaXN0ZSBjb25cbiAqIGBsb2NhbGlkYWQ9XCJDT0xFR0lBTEVTXCJgIFx1MjE5MiBnZW5lcmEgZG9jSWQgZGlzdGludG8gXHUyMTkyIGNtRGF0YSB1bmRlZmluZWQgXHUyMTkyIGxvc1xuICogNiBjYW1wb3Mgc2FsXHUwMEVEYW4gXCItXCIgYXVucXVlIGxhIEZpY2hhIGVzdGFiYSBjYXJnYWRhLiBgc2FwQ2FyZENvZGVgIGVzIFx1MDBGQW5pY29cbiAqIHkgU0lFTVBSRSBpZGVudGlmaWNhIGVsIGRvYyBjb3JyZWN0by4gUGF0dGVybiB5YSBleGlzdGVudGUgZW5cbiAqIGBpbmRleC5odG1sOl9yZXNvbHZlVmVuZG9yRmFsbGJhY2tgIChsXHUwMEVEbmVhIDE1Nzg4KykuXG4gKlxuICogQHBhcmFtIHtzdHJpbmcgfCBudWxsIHwgdW5kZWZpbmVkfSBjYXJkQ29kZSAgZWouIFwiQzIwMTEwNTYxMDY4XCIuXG4gKiBAcGFyYW0ge01hcDxzdHJpbmcsIGFueT4gfCBudWxsIHwgdW5kZWZpbmVkfSBjbGllbnRNYXN0ZXJDYWNoZVxuICogQHJldHVybnMge2FueSB8IG51bGx9ICBjbURhdGEgbyBudWxsIHNpIG5vIHNlIGVuY3VlbnRyYSAvIGNhcmRDb2RlIHZhY1x1MDBFRG8uXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBmaW5kQ21EYXRhQnlDYXJkQ29kZShjYXJkQ29kZSwgY2xpZW50TWFzdGVyQ2FjaGUpIHtcbiAgY29uc3QgY2MgPSBTdHJpbmcoY2FyZENvZGUgfHwgJycpLnRyaW0oKTtcbiAgaWYgKCFjYyB8fCAhY2xpZW50TWFzdGVyQ2FjaGUgfHwgdHlwZW9mIGNsaWVudE1hc3RlckNhY2hlLmZvckVhY2ggIT09ICdmdW5jdGlvbicpIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuICAvLyBTY2FuIFRPRE9TIGxvcyBkb2NzIGNvbiBlbCBjYXJkQ29kZSAocHVlZGUgaGFiZXIgZHVwbGljYWRvczogdW5vXG4gIC8vIGltcG9ydGFkbyBTQVAgc2luIEZpY2hhICsgb3RybyBjb24gRmljaGEgcG9wdWxhdGVkKS4gUHJlZmVyaXIgZWwgcXVlXG4gIC8vIHRpZW5lIGFsIG1lbm9zIHVuIGNhbXBvIEZpY2hhIHBvcHVsYXRlZC4gQ2FzbyBNQVhFUkE6IGhheSAyIGRvY3M7IGVsXG4gIC8vIHNsdWcgU0FQLWltcG9ydCBubyB0aWVuZSBjYW1wb3MgRmljaGEsIGVsIHNsdWcgRmljaGEgc1x1MDBFRC5cbiAgLyoqIEB0eXBlIHtBcnJheTxhbnk+fSAqL1xuICBjb25zdCBjYW5kaWRhdGVzID0gW107XG4gIGNsaWVudE1hc3RlckNhY2hlLmZvckVhY2goKGNtRGF0YSkgPT4ge1xuICAgIGlmICghY21EYXRhKSByZXR1cm47XG4gICAgY29uc3QgY2MxID0gU3RyaW5nKGNtRGF0YS5zYXBDYXJkQ29kZSB8fCAnJykudHJpbSgpO1xuICAgIGNvbnN0IGNjMiA9IFN0cmluZyhjbURhdGEuY2FyZENvZGVTYXAgfHwgJycpLnRyaW0oKTtcbiAgICBpZiAoY2MxID09PSBjYyB8fCBjYzIgPT09IGNjKSB7XG4gICAgICBjYW5kaWRhdGVzLnB1c2goY21EYXRhKTtcbiAgICB9XG4gIH0pO1xuICBpZiAoY2FuZGlkYXRlcy5sZW5ndGggPT09IDApIHJldHVybiBudWxsO1xuICBpZiAoY2FuZGlkYXRlcy5sZW5ndGggPT09IDEpIHJldHVybiBjYW5kaWRhdGVzWzBdO1xuICAvLyBNXHUwMEZBbHRpcGxlcyBkb2NzOiBwcmVmZXJpciBlbCBxdWUgdGVuZ2EgYWwgbWVub3MgVU4gY2FtcG8gRmljaGEgcG9wdWxhdGVkLlxuICBjb25zdCBGSUNIQV9GSUVMRFMgPSBbXG4gICAgJ2NsaVRpcG8nLFxuICAgICdmaWRlbGlkYWQnLFxuICAgICdwcmVmQ29udGFjdG8nLFxuICAgICd0YW1hbm8nLFxuICAgICdlc3BlY2lhbGl6YWNpb24nLFxuICAgICd0aXBvTG9jYWwnLFxuICAgICdjcmVkaXRvQ2hlcXVlJyxcbiAgXTtcbiAgZm9yIChjb25zdCBjIG9mIGNhbmRpZGF0ZXMpIHtcbiAgICBmb3IgKGNvbnN0IGYgb2YgRklDSEFfRklFTERTKSB7XG4gICAgICBpZiAoY1tmXSAhPT0gbnVsbCAmJiBjW2ZdICE9PSB1bmRlZmluZWQgJiYgY1tmXSAhPT0gJycpIHtcbiAgICAgICAgcmV0dXJuIGM7XG4gICAgICB9XG4gICAgfVxuICB9XG4gIC8vIE5pbmd1bm8gdGllbmUgRmljaGEgcG9wdWxhdGVkIFx1MjE5MiBkZXZvbHZlciBlbCBwcmltZXJvIChhbWJvcyBlcXVpdmFsZW50ZXMpLlxuICByZXR1cm4gY2FuZGlkYXRlc1swXTtcbn1cblxuLyoqXG4gKiBDb21wb25lIGxhIGZpbGEgZGUgY29sdW1uYXMgZGUgbGEgcGVzdGFcdTAwRjFhIENsYXNpZmljYWNpXHUwMEYzbiBwYXJhIHVuIGNsaWVudGUuXG4gKiBOb21icmVzIGRlIGNvbHVtbmFzIGV4YWN0b3MgY29tbyBwaWRlIE1hcmlhbm8gZW4gZWwgcGVkaWRvLiBDZWxkYXMgdmFjXHUwMEVEYXNcbiAqIHNlIGNvbXBsZXRhbiBjb24gXCItXCIuXG4gKlxuICogQHBhcmFtIHthbnl9IGNtRGF0YSAgY2xpZW50X21hc3Rlci97ZG9jSWR9LmRhdGEoKVxuICogQHJldHVybnMge09iamVjdDxzdHJpbmcsIHN0cmluZyB8IG51bWJlcj59XG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBmaWNoYUNsaWVudGVDbGFzaWZSb3coY21EYXRhKSB7XG4gIGNvbnN0IGQgPSBjbURhdGEgfHwge307XG4gIGNvbnN0IGNyZWRpdG8gPSBkLmNyZWRpdG9DaGVxdWU7XG4gIGNvbnN0IGNyZWRpdG9OdW0gPSBjcmVkaXRvICE9IG51bGwgJiYgY3JlZGl0byAhPT0gJycgPyBOdW1iZXIoY3JlZGl0bykgOiBudWxsO1xuICByZXR1cm4ge1xuICAgICdUaXBvIGRlIGNsaWVudGUnOiBsYWJlbEZvckZpY2hhRmllbGQoJ2NsaVRpcG8nLCBkLmNsaVRpcG8pLFxuICAgIEZpZGVsaWRhZDogbGFiZWxGb3JGaWNoYUZpZWxkKCdmaWRlbGlkYWQnLCBkLmZpZGVsaWRhZCksXG4gICAgJ1ByZWZlcmVuY2lhIGRlIGNvbnRhY3RvJzogbGFiZWxGb3JGaWNoYUZpZWxkKCdwcmVmQ29udGFjdG8nLCBkLnByZWZDb250YWN0byksXG4gICAgVGFtYVx1MDBGMW86IGxhYmVsRm9yRmljaGFGaWVsZCgndGFtYW5vJywgZC50YW1hbm8pLFxuICAgIEVzcGVjaWFsaXphY2lcdTAwRjNuOiBsYWJlbEZvckZpY2hhRmllbGQoJ2VzcGVjaWFsaXphY2lvbicsIGQuZXNwZWNpYWxpemFjaW9uKSxcbiAgICAnVGlwbyBkZSBsb2NhbCc6IGxhYmVsRm9yRmljaGFGaWVsZCgndGlwb0xvY2FsJywgZC50aXBvTG9jYWwpLFxuICAgICdDclx1MDBFOWRpdG8gY2hlcXVlIChBUlMpJzpcbiAgICAgIGNyZWRpdG9OdW0gIT0gbnVsbCAmJiBOdW1iZXIuaXNGaW5pdGUoY3JlZGl0b051bSkgJiYgY3JlZGl0b051bSA+IDBcbiAgICAgICAgPyBNYXRoLnJvdW5kKGNyZWRpdG9OdW0pXG4gICAgICAgIDogJy0nLFxuICB9O1xufVxuXG4vKipcbiAqIENvbXBvbmUgbGEgZmlsYSBkZSBjb2x1bW5hcyBkZSBsYSBwZXN0YVx1MDBGMWEgQnV5ZXIgcGFyYSB1biBjbGllbnRlLlxuICogVmVudGFuYSBkZWZhdWx0IDEybSAobGEgcXVlIGFycmFuY2EgZWwgbW9kYWw7IHZlciBfZmNCdXllckN1cnJlbnRQZXJpb2QpLlxuICogTWFyaWFubzogc2kgZWwgdmFsb3Igbm8gZXhpc3RlLCB2YSBcIi1cIi5cbiAqXG4gKiBAcGFyYW0ge2FueX0gYnV5ZXJTdGF0cyAgY2xpZW50X2J1eWVyX3N0YXRzL3tjYXJkQ29kZX0uZGF0YSgpXG4gKiBAcGFyYW0ge3N0cmluZ30gW3BlcmlvZF0gICczbScgfCAnNm0nIHwgJzEybScgfCAnMjRtJy4gRGVmYXVsdCAnMTJtJy5cbiAqIEByZXR1cm5zIHtPYmplY3Q8c3RyaW5nLCBzdHJpbmcgfCBudW1iZXI+fVxuICovXG5leHBvcnQgZnVuY3Rpb24gZmljaGFDbGllbnRlQnV5ZXJSb3coYnV5ZXJTdGF0cywgcGVyaW9kKSB7XG4gIGNvbnN0IHAgPSBwZXJpb2QgfHwgJzEybSc7XG4gIGNvbnN0IGJzID0gYnV5ZXJTdGF0cyB8fCB7fTtcbiAgY29uc3Qgc3RhdHMgPSAvKiogQHR5cGUge2FueX0gKi8gKGJzKVsnc3RhdHNfJyArIHBdIHx8IHt9O1xuICBjb25zdCBtb250byA9IE51bWJlcihzdGF0cy5tb250b1RvdGFsKSB8fCAwO1xuICBjb25zdCBmYWN0dXJhcyA9IE51bWJlcihzdGF0cy5mYWN0dXJhc0NvdW50KSB8fCAwO1xuICBjb25zdCBwcm9tZWRpbyA9IE51bWJlcihzdGF0cy5tb250b1Byb21lZGlvKSB8fCAwO1xuICBjb25zdCBmcmVjID0gc3RhdHMuZnJlY3VlbmNpYURpYXM7XG4gIGNvbnN0IGZhY3hNZXMgPSBzdGF0cy5mYWN0dXJhc1Bvck1lcztcbiAgY29uc3QgZGlhcyA9IHN0YXRzLmRpYXNEZXNkZVVsdGltYTtcbiAgcmV0dXJuIHtcbiAgICAnTW9udG8gdG90YWwgKDEybSknOiBtb250byA+IDAgPyBNYXRoLnJvdW5kKG1vbnRvKSA6ICctJyxcbiAgICAnRmFjdHVyYXMgKDEybSknOiBmYWN0dXJhcyA+IDAgPyBmYWN0dXJhcyA6ICctJyxcbiAgICAnUHJvbWVkaW8gcG9yIGZhY3R1cmEgKDEybSknOiBwcm9tZWRpbyA+IDAgPyBNYXRoLnJvdW5kKHByb21lZGlvKSA6ICctJyxcbiAgICAnRnJlY3VlbmNpYSAoZFx1MDBFRGFzIGVudHJlIGNvbXByYXMpJzpcbiAgICAgIGZyZWMgIT0gbnVsbCAmJiBOdW1iZXIuaXNGaW5pdGUoTnVtYmVyKGZyZWMpKSA/IE1hdGgucm91bmQoTnVtYmVyKGZyZWMpKSA6ICctJyxcbiAgICAnRmFjdHVyYXMgcG9yIG1lcyAoMTJtKSc6XG4gICAgICBmYWN4TWVzICE9IG51bGwgJiYgTnVtYmVyLmlzRmluaXRlKE51bWJlcihmYWN4TWVzKSlcbiAgICAgICAgPyBNYXRoLnJvdW5kKE51bWJlcihmYWN4TWVzKSAqIDEwKSAvIDEwXG4gICAgICAgIDogJy0nLFxuICAgICdQcmltZXJhIGNvbXByYSc6IHN0YXRzLnByaW1lcmFDb21wcmEgfHwgJy0nLFxuICAgICdcdTAwREFsdGltYSBjb21wcmEnOiBzdGF0cy51bHRpbWFDb21wcmEgfHwgJy0nLFxuICAgICdEXHUwMEVEYXMgZGVzZGUgXHUwMEZBbHRpbWEgY29tcHJhJzpcbiAgICAgIGRpYXMgIT0gbnVsbCAmJiBOdW1iZXIuaXNGaW5pdGUoTnVtYmVyKGRpYXMpKSA/IE1hdGgucm91bmQoTnVtYmVyKGRpYXMpKSA6ICctJyxcbiAgfTtcbn1cblxuLyoqXG4gKiBSZWVtcGxhemEgY2FkYSBjZWxkYSB2YWNcdTAwRURhIChudWxsIC8gdW5kZWZpbmVkIC8gJycgLyAwIGN1YW5kbyBlbCBjYW1wb1xuICogcmVxdWllcmUgdmFsb3Igc2lnbmlmaWNhdGl2bykgcG9yIFwiLVwiLiBDZW50cmFsaXphIGxhIHJlZ2xhIGRlIE1hcmlhbm9cbiAqIFwibmluZ3VuYSBjZWxkYSBxdWVkYSB2YWNcdTAwRURhLCBlbiBuaW5ndW5hIGNvbHVtbmEsIGluY2x1aWRhcyBsYXMgcXVlIHlhXG4gKiBleGlzdGVuXCIuXG4gKlxuICogRXhjZXBjaVx1MDBGM246IGNhbXBvcyBudW1cdTAwRTlyaWNvcyBsaXN0YWRvcyBlbiBgbnVtZXJpY1plcm9Pa2AgY29uc2VydmFuIDAuXG4gKiBIb3kgbmluZ3Vubzsgc2UgZGVqYSBsYSBob29rIHBvciBzaSBlbiBlbCBmdXR1cm8gYXBhcmVjZSBcIlRvdGFsIHZpc2l0YXNcIi5cbiAqXG4gKiBAcGFyYW0ge2FueX0gcm93XG4gKiBAcGFyYW0ge1NldDxzdHJpbmc+fSBbbnVtZXJpY1plcm9Pa11cbiAqIEByZXR1cm5zIHtPYmplY3Q8c3RyaW5nLCBhbnk+fVxuICovXG5leHBvcnQgZnVuY3Rpb24gZmlsbERhc2hJbkVtcHR5KHJvdywgbnVtZXJpY1plcm9Paykge1xuICBjb25zdCBvayA9IG51bWVyaWNaZXJvT2sgaW5zdGFuY2VvZiBTZXQgPyBudW1lcmljWmVyb09rIDogbmV3IFNldCgpO1xuICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIGFueT59ICovXG4gIGNvbnN0IG91dCA9IHt9O1xuICBmb3IgKGNvbnN0IGsgb2YgT2JqZWN0LmtleXMocm93IHx8IHt9KSkge1xuICAgIGNvbnN0IHYgPSByb3dba107XG4gICAgaWYgKHYgPT09IG51bGwgfHwgdiA9PT0gdW5kZWZpbmVkIHx8IHYgPT09ICcnKSB7XG4gICAgICBvdXRba10gPSAnLSc7XG4gICAgfSBlbHNlIGlmICh2ID09PSAwICYmICFvay5oYXMoaykpIHtcbiAgICAgIG91dFtrXSA9ICctJztcbiAgICB9IGVsc2Uge1xuICAgICAgb3V0W2tdID0gdjtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIG91dDtcbn1cbiIsICIvLyBAdHMtbm9jaGVja1xuLy8gTk9UQTogQHRzLW5vY2hlY2sgaW50ZW5jaW9uYWwuIEVsIGNodW5rIGVzIGhlYXZ5IERPTSArIHdpbmRvdy4qIGhhbmRsZXJzICtcbi8vIEZpcmVzdG9yZSBTREsgY29tcGF0IHY4LiBBbm90YXIgc3RyaWN0YW1lbnRlIGNhZGEgaGFuZGxlciBzZXJcdTAwRURhIHJ1aWRvIHNpblxuLy8gdmFsb3IgXHUyMDE0IGxvcyBoZWxwZXJzIHB1cm9zIHF1ZSBpbXBvcnRhbW9zICguLi9wdXJlL2NhcnRlcmEtdmVuZG9yLWZpbHRlci5qcylcbi8vIHkgZWwgY29yZSAoZnVuY3Rpb25zL2NvcmUvY2FydGVyYS12ZW5kb3ItY29yZS5qcykgc1x1MDBFRCB0aWVuZW4gQHRzLWNoZWNrLlxuLyoqXG4gKiBjYXJ0ZXJhLXZlbmRvci5qcyAodjEyODMsIDIwMjYtMTAtMjApIFx1MjAxNCBidW5kbGUgY2h1bmsgbGF6eS5cbiAqXG4gKiBEYXNoYm9hcmQgXCJBbmFsaXNpcyBkZSBDYXJ0ZXJhIHBvciBWZW5kZWRvclwiLiBSZWVtcGxhemEgc2VndWltaWVudG8uanMuXG4gKiBMZWUgY2FydGVyYV92ZW5kb3Ive3ZlbmRvcktleX0gRmlyZXN0b3JlIChzbmFwc2hvdCBuaWdodGx5IDA0OjAwIEFSVCkuXG4gKlxuICogVE9ETyBlbCBET00gcmVuZGVyIHVzYSBjcmVhdGVFbGVtZW50ICsgdGV4dENvbnRlbnQgKHBvbGljeSBhbnRpLVhTUywgbm8gaW5uZXJIVE1MKS5cbiAqXG4gKiBTcGVjOiBkb2NzL3N1cGVycG93ZXJzL3NwZWNzLzIwMjYtMTAtMjAtY2FydGVyYS12ZW5kb3ItYW5hbGlzaXMtZGVzaWduLm1kXG4gKiBQbGFuOiBkb2NzL3N1cGVycG93ZXJzL3BsYW5zLzIwMjYtMTAtMjAtY2FydGVyYS12ZW5kb3ItYW5hbGlzaXMubWRcbiAqL1xuXG5pbXBvcnQgeyBhcHBseUNoaXBGaWx0ZXIsIHNvcnRDbGllbnRlcyB9IGZyb20gJy4uL3B1cmUvY2FydGVyYS12ZW5kb3ItZmlsdGVyLmpzJztcbi8vIHYxNDgyIFx1MDBBNzgyICgyMDI2LTEwLTI3KTogZnVlbnRlIFx1MDBGQW5pY2EgZGUgbGFiZWxzIEZpY2hhIENsaWVudGUuIExhIGNvbHVtbmFcbi8vIFRJUE8gYW50ZXMgbW9zdHJhYmEgZWwgY1x1MDBGM2RpZ28gKFwiQlwiKSBlbiB2ZXogZGVsIGxhYmVsIGxlZ2libGUgKFwiQiAtIHNpblxuLy8gZGVzY3VlbnRvXCIpIFx1MjAxNCBwZW5kaWVudGUgY29ub2NpZG8gcHJlLXYxNDgyLiBSZXVzYW1vcyBsYSBwdXJlIGZuIHF1ZSB5YVxuLy8gY29uc3VtZSBNYXN0ZXJmaWxlIGV4cG9ydCBwYXJhIG5vIGR1cGxpY2FyIGVsIG1hcGVvLlxuaW1wb3J0IHsgbGFiZWxGb3JGaWNoYUZpZWxkIH0gZnJvbSAnLi4vcHVyZS9maWNoYS1jbGllbnRlLWxhYmVscy5qcyc7XG5cbi8qKiBAdHlwZSB7TWFwPHN0cmluZywgYW55Pn0gKi9cbmNvbnN0IGNhcnRlcmFEb2NDYWNoZSA9IG5ldyBNYXAoKTtcbi8qKiBAdHlwZSB7c3RyaW5nfG51bGx9ICovXG5sZXQgc2VsZWN0ZWRWZW5kb3IgPSBudWxsO1xubGV0IGFjdGl2ZUNoaXAgPSAndG9kb3MnO1xubGV0IHNlYXJjaFF1ZXJ5ID0gJyc7XG5sZXQgc29ydEJ5ID0gJ2RpYXNTaW5Db21wcmEnO1xuLyoqIEB0eXBlIHsnYXNjJ3wnZGVzYyd9ICovXG5sZXQgc29ydERpciA9ICdkZXNjJztcblxuY29uc3QgQ0hJUFMgPSBbXG4gIHsgaWQ6ICd0b2RvcycsIGxhYmVsOiAnVG9kb3MnIH0sXG4gIHsgaWQ6ICdiYXNlQWN0aXZhOTBkJywgbGFiZWw6ICdCYXNlIGFjdGl2YSA5MGQnIH0sXG4gIHsgaWQ6ICdkb3JtaWRvc1Zpc2l0YTMwZCcsIGxhYmVsOiAnRG9ybWlkb3MgdmlzaXRhIDMwZCcgfSxcbiAgeyBpZDogJ2Rvcm1pZG9zQ29tcHJhOTBkJywgbGFiZWw6ICdEb3JtaWRvcyBjb21wcmEgOTBkJyB9LFxuICB7IGlkOiAnbnVuY2FWaXNpdGFkb3MnLCBsYWJlbDogJ051bmNhIHZpc2l0YWRvcycgfSxcbiAgeyBpZDogJ251bmNhQ29tcHJhcm9uJywgbGFiZWw6ICdOdW5jYSBjb21wcmFyb24nIH0sXG5dO1xuXG5jb25zdCBLUElfQ0FSRFMgPSBbXG4gIHsgY2hpcDogJ3RvZG9zJywgbGFiZWw6ICdUb3RhbCBjYXJ0ZXJhJywgY29sb3I6ICcjNjQ3NDhiJyB9LFxuICB7IGNoaXA6ICdiYXNlQWN0aXZhOTBkJywgbGFiZWw6ICdCYXNlIGFjdGl2YSA5MGQnLCBjb2xvcjogJyMxNmEzNGEnIH0sXG4gIHsgY2hpcDogJ2Rvcm1pZG9zVmlzaXRhMzBkJywgbGFiZWw6ICdEb3JtaWRvcyB2aXMgMzBkJywgY29sb3I6ICcjZWE1ODBjJyB9LFxuICB7IGNoaXA6ICdkb3JtaWRvc0NvbXByYTkwZCcsIGxhYmVsOiAnRG9ybWlkb3MgY29tIDkwZCcsIGNvbG9yOiAnI2RjMjYyNicgfSxcbiAgeyBjaGlwOiAnbnVuY2FWaXNpdGFkb3MnLCBsYWJlbDogJ051bmNhIHZpc2l0YWRvcycsIGNvbG9yOiAnIzdjM2FlZCcgfSxcbiAgeyBjaGlwOiAnbnVuY2FDb21wcmFyb24nLCBsYWJlbDogJ051bmNhIGNvbXByYXJvbicsIGNvbG9yOiAnI2JlMTg1ZCcgfSxcbl07XG5cbi8vIHYxMzg0ICgyMDI2LTEwLTIxKTogd2hpdGVsaXN0IGRlIGxvcyA2IFZERSByZWFsZXMgb3BlcmF0aXZvcyAocGVkaWRvIE1hcmlhbm8pLlxuLy8gRmlsdHJhIGVsIGRyb3Bkb3duIHBhcmEgZXhjbHVpciBydWlkbyBlbiBjbGllbnRfYXBwbGljYXRpb25zLmFzc2lnbmVkVmVuZG9yOlxuLy8gJ0FETUlOX0xET09HMkY0TVdWTVhLUU9EOFlDQk9JUlUyTzInIChhZG1pbiB1aWQgcXVlIHF1ZWRvIGNvbW8gc3RyaW5nIHZlbmRvciksXG4vLyAnRU1QTEVBRE8nIChhbHRhcyBpbnRlcm5hcyksICdESUVHTyBWQUxTSScgKGV4LVZERSBjb24gMSBjbGllbnRlIGhpc3RvcmljbykuXG4vLyBTaSBlbiBlbCBmdXR1cm8gc2UgaW5jb3Jwb3JhIHVuIG51ZXZvIFZERSwgYWdyZWdhcmxvIGFxdWkgKyB2ZXJpZmljYXIgcXVlIGxhXG4vLyB2aXN0YSBCUSB2X2NhcnRlcmFfdmVuZG9yIGxvIGNhbm9uaWNhbGl6ZSBpZ3VhbCAodmVyIGJpZ3F1ZXJ5L3ZpZXdzLnNxbDozNDgwKS5cbmNvbnN0IFZFTkRPUlNfV0hJVEVMSVNUID0gbmV3IFNldChbXG4gICdGRURFUklDTyBDQVNURUxBTkVMTEknLFxuICAnR09OWkFMTyBERSBMQSBST1NBJyxcbiAgJ0lPQU5OSVMgUEFMS09VREFLSVMnLFxuICAnTUFVUklDSU8gR0lMJyxcbiAgJ1BBQ0hJJyxcbiAgJ1NBTlRJQUdPIEVTVEVCQU4nLFxuXSk7XG5cbi8vID09PSBPcGVuIC8gY2xvc2UgPT09XG53aW5kb3cub3BlbkNhcnRlcmFNb2RhbCA9IGFzeW5jIGZ1bmN0aW9uIG9wZW5DYXJ0ZXJhTW9kYWwoKSB7XG4gIGNvbnN0IG1vZGFsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2NhcnRlcmEtbW9kYWwnKTtcbiAgaWYgKCFtb2RhbCkgcmV0dXJuO1xuICBtb2RhbC5jbGFzc0xpc3QuYWRkKCdvcGVuJyk7XG4gIGF3YWl0IHBvcHVsYXRlVmVuZG9yRHJvcGRvd24oKTtcbn07XG5cbndpbmRvdy5jbG9zZUNhcnRlcmFNb2RhbCA9IGZ1bmN0aW9uIGNsb3NlQ2FydGVyYU1vZGFsKCkge1xuICBjb25zdCBtb2RhbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdjYXJ0ZXJhLW1vZGFsJyk7XG4gIGlmIChtb2RhbCkgbW9kYWwuY2xhc3NMaXN0LnJlbW92ZSgnb3BlbicpO1xufTtcblxuLy8gPT09IERyb3Bkb3duIGRlIHZlbmRvcnMgPT09XG5hc3luYyBmdW5jdGlvbiBwb3B1bGF0ZVZlbmRvckRyb3Bkb3duKCkge1xuICBjb25zdCBzZWwgPSAvKiogQHR5cGUge0hUTUxTZWxlY3RFbGVtZW50fG51bGx9ICovIChcbiAgICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY2FydGVyYS12ZW5kb3Itc2VsZWN0JylcbiAgKTtcbiAgaWYgKCFzZWwpIHJldHVybjtcbiAgaWYgKHNlbC5vcHRpb25zLmxlbmd0aCA+IDEpIHJldHVybjtcbiAgdHJ5IHtcbiAgICAvLyBAdHMtZXhwZWN0LWVycm9yXG4gICAgY29uc3Qgc25hcCA9IGF3YWl0IGZpcmViYXNlLmZpcmVzdG9yZSgpLmNvbGxlY3Rpb24oJ2NhcnRlcmFfdmVuZG9yJykuZ2V0KCk7XG4gICAgLyoqIEB0eXBlIHtzdHJpbmdbXX0gKi9cbiAgICBjb25zdCB2ZW5kb3JzID0gW107XG4gICAgc25hcC5mb3JFYWNoKChkb2MpID0+IHtcbiAgICAgIC8vIHYxMzg0OiBzb2xvIFZERSB3aGl0ZWxpc3QuIFJlc3RvIChhZG1pbiB1aWQsIEVNUExFQURPLCBleC1WREUpIHNlIG9jdWx0YW4uXG4gICAgICBpZiAoVkVORE9SU19XSElURUxJU1QuaGFzKGRvYy5pZCkpIHZlbmRvcnMucHVzaChkb2MuaWQpO1xuICAgIH0pO1xuICAgIHZlbmRvcnMuc29ydCgpO1xuICAgIGZvciAoY29uc3QgdiBvZiB2ZW5kb3JzKSB7XG4gICAgICBjb25zdCBvcHQgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdvcHRpb24nKTtcbiAgICAgIG9wdC52YWx1ZSA9IHY7XG4gICAgICBvcHQudGV4dENvbnRlbnQgPSB2O1xuICAgICAgc2VsLmFwcGVuZENoaWxkKG9wdCk7XG4gICAgfVxuICB9IGNhdGNoIChlKSB7XG4gICAgY29uc29sZS5lcnJvcigncG9wdWxhdGVWZW5kb3JEcm9wZG93biBmYWlsZWQnLCBlKTtcbiAgfVxufVxuXG4vLyA9PT0gT24gdmVuZG9yIGNoYW5nZSA9PT1cbndpbmRvdy5vbkNhcnRlcmFWZW5kb3JDaGFuZ2UgPSBhc3luYyBmdW5jdGlvbiBvbkNhcnRlcmFWZW5kb3JDaGFuZ2UoKSB7XG4gIGNvbnN0IHNlbCA9IC8qKiBAdHlwZSB7SFRNTFNlbGVjdEVsZW1lbnR8bnVsbH0gKi8gKFxuICAgIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdjYXJ0ZXJhLXZlbmRvci1zZWxlY3QnKVxuICApO1xuICBpZiAoIXNlbCkgcmV0dXJuO1xuICBzZWxlY3RlZFZlbmRvciA9IHNlbC52YWx1ZSB8fCBudWxsO1xuICBhY3RpdmVDaGlwID0gJ3RvZG9zJztcbiAgc2VhcmNoUXVlcnkgPSAnJztcbiAgY29uc3Qgc2VhcmNoSW5wdXQgPSAvKiogQHR5cGUge0hUTUxJbnB1dEVsZW1lbnR8bnVsbH0gKi8gKFxuICAgIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdjYXJ0ZXJhLXNlYXJjaCcpXG4gICk7XG4gIGlmIChzZWFyY2hJbnB1dCkgc2VhcmNoSW5wdXQudmFsdWUgPSAnJztcbiAgaWYgKCFzZWxlY3RlZFZlbmRvcikge1xuICAgIHNob3dFbXB0eSgpO1xuICAgIHJldHVybjtcbiAgfVxuICBzaG93TG9hZGluZygpO1xuICB0cnkge1xuICAgIGxldCBkb2MgPSBjYXJ0ZXJhRG9jQ2FjaGUuZ2V0KHNlbGVjdGVkVmVuZG9yKTtcbiAgICBpZiAoIWRvYykge1xuICAgICAgLy8gQHRzLWV4cGVjdC1lcnJvclxuICAgICAgY29uc3Qgc25hcCA9IGF3YWl0IGZpcmViYXNlXG4gICAgICAgIC5maXJlc3RvcmUoKVxuICAgICAgICAuY29sbGVjdGlvbignY2FydGVyYV92ZW5kb3InKVxuICAgICAgICAuZG9jKHNlbGVjdGVkVmVuZG9yKVxuICAgICAgICAuZ2V0KCk7XG4gICAgICBpZiAoIXNuYXAuZXhpc3RzKSB7XG4gICAgICAgIHNob3dOb0RhdGEoKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgZG9jID0gc25hcC5kYXRhKCk7XG4gICAgICBjYXJ0ZXJhRG9jQ2FjaGUuc2V0KHNlbGVjdGVkVmVuZG9yLCBkb2MpO1xuICAgIH1cbiAgICByZW5kZXJEYXNoYm9hcmQoZG9jKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGNvbnNvbGUuZXJyb3IoJ29uQ2FydGVyYVZlbmRvckNoYW5nZSBmYWlsZWQnLCBlKTtcbiAgICBzaG93RXJyb3IoU3RyaW5nKGUpKTtcbiAgfVxufTtcblxuLyoqIEB0eXBlIHthbnl9ICovICh3aW5kb3cpLm9uQ2FydGVyYUNoaXBDbGljayA9IGZ1bmN0aW9uIG9uQ2FydGVyYUNoaXBDbGljayhjaGlwSWQpIHtcbiAgYWN0aXZlQ2hpcCA9IGNoaXBJZDtcbiAgaWYgKCFzZWxlY3RlZFZlbmRvcikgcmV0dXJuO1xuICBjb25zdCBkb2MgPSBjYXJ0ZXJhRG9jQ2FjaGUuZ2V0KHNlbGVjdGVkVmVuZG9yKTtcbiAgaWYgKGRvYykgcmVuZGVyRGFzaGJvYXJkKGRvYyk7XG59O1xuXG4vKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIHNldFRpbWVvdXQ+fG51bGx9ICovXG5sZXQgc2VhcmNoRGVib3VuY2VUaW1lciA9IG51bGw7XG53aW5kb3cub25DYXJ0ZXJhU2VhcmNoQ2hhbmdlID0gZnVuY3Rpb24gb25DYXJ0ZXJhU2VhcmNoQ2hhbmdlKCkge1xuICBjb25zdCBpbnB1dCA9IC8qKiBAdHlwZSB7SFRNTElucHV0RWxlbWVudHxudWxsfSAqLyAoZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2NhcnRlcmEtc2VhcmNoJykpO1xuICBpZiAoIWlucHV0KSByZXR1cm47XG4gIGlmIChzZWFyY2hEZWJvdW5jZVRpbWVyKSBjbGVhclRpbWVvdXQoc2VhcmNoRGVib3VuY2VUaW1lcik7XG4gIHNlYXJjaERlYm91bmNlVGltZXIgPSBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICBzZWFyY2hRdWVyeSA9IChpbnB1dC52YWx1ZSB8fCAnJykudHJpbSgpLnRvTG93ZXJDYXNlKCk7XG4gICAgaWYgKCFzZWxlY3RlZFZlbmRvcikgcmV0dXJuO1xuICAgIGNvbnN0IGRvYyA9IGNhcnRlcmFEb2NDYWNoZS5nZXQoc2VsZWN0ZWRWZW5kb3IpO1xuICAgIGlmIChkb2MpIHJlbmRlckRhc2hib2FyZChkb2MpO1xuICB9LCAzMDApO1xufTtcblxuLyoqIEB0eXBlIHthbnl9ICovICh3aW5kb3cpLm9uQ2FydGVyYVNvcnRDbGljayA9IGZ1bmN0aW9uIG9uQ2FydGVyYVNvcnRDbGljayhjb2xLZXkpIHtcbiAgaWYgKHNvcnRCeSA9PT0gY29sS2V5KSBzb3J0RGlyID0gc29ydERpciA9PT0gJ2FzYycgPyAnZGVzYycgOiAnYXNjJztcbiAgZWxzZSB7XG4gICAgc29ydEJ5ID0gY29sS2V5O1xuICAgIHNvcnREaXIgPSAnZGVzYyc7XG4gIH1cbiAgaWYgKCFzZWxlY3RlZFZlbmRvcikgcmV0dXJuO1xuICBjb25zdCBkb2MgPSBjYXJ0ZXJhRG9jQ2FjaGUuZ2V0KHNlbGVjdGVkVmVuZG9yKTtcbiAgaWYgKGRvYykgcmVuZGVyRGFzaGJvYXJkKGRvYyk7XG59O1xuXG4vLyA9PT0gUmVuZGVyID09PVxuZnVuY3Rpb24gcmVuZGVyRGFzaGJvYXJkKGRvYykge1xuICBjb25zdCBzdWJ0aXRsZSA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdjYXJ0ZXJhLXN1YnRpdGxlJyk7XG4gIGlmIChzdWJ0aXRsZSkgc3VidGl0bGUudGV4dENvbnRlbnQgPSBgJHtkb2MuY291bnRzLnRvdGFsfSBjbGllbnRlcyBlbiBjYXJ0ZXJhLmA7XG4gIGNvbnN0IGluZm8gPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY2FydGVyYS1zbmFwc2hvdC1pbmZvJyk7XG4gIGlmIChpbmZvKSB7XG4gICAgaW5mby50ZXh0Q29udGVudCA9IGBTbmFwc2hvdCAke2RvYy5zbmFwc2hvdERhdGV9YDtcbiAgICBpbmZvLnN0eWxlLmRpc3BsYXkgPSAnaW5saW5lLWZsZXgnO1xuICB9XG4gIHJlbmRlcktwaXMoZG9jLmNvdW50cyk7XG4gIHJlbmRlckNoaXBzKGRvYy5jb3VudHMpO1xuICByZW5kZXJUYWJsZShkb2MuY2xpZW50ZXMpO1xuICBzaG93VGFibGUoKTtcbn1cblxuZnVuY3Rpb24gcmVuZGVyS3Bpcyhjb3VudHMpIHtcbiAgY29uc3QgZWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY2FydGVyYS1rcGlzJyk7XG4gIGlmICghZWwpIHJldHVybjtcbiAgd2hpbGUgKGVsLmZpcnN0Q2hpbGQpIGVsLnJlbW92ZUNoaWxkKGVsLmZpcnN0Q2hpbGQpO1xuICAvLyB2MTM4MzogQXBwbGUtc3R5bGUgS1BJIGNhcmRzLiBDbGFzZXMgLmNhcnRlcmEta3BpIGRlZmluaWRhcyBlbiBpbmRleC5odG1sLlxuICAvLyBDb2xvciBzZSBhcGxpY2Egc29sbyBhbCBuXHUwMEZBbWVybyArIHVuZGVybGluZSAoc3V0aWwgaWRlbnRpZGFkIHBvciBjYXRlZ29yXHUwMEVEYSkuXG4gIGZvciAoY29uc3Qgc3BlYyBvZiBLUElfQ0FSRFMpIHtcbiAgICBjb25zdCBjYXJkID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2Jyk7XG4gICAgY2FyZC5jbGFzc05hbWUgPSAnY2FydGVyYS1rcGknO1xuICAgIGlmIChhY3RpdmVDaGlwID09PSBzcGVjLmNoaXApIGNhcmQuY2xhc3NMaXN0LmFkZCgnYWN0aXZlJyk7XG4gICAgY2FyZC5zdHlsZS5jb2xvciA9IHNwZWMuY29sb3I7IC8vIGN1cnJlbnRDb2xvciBwYXJhIGVsIG51bWJlciArIDo6YWZ0ZXIgdW5kZXJsaW5lXG4gICAgY2FyZC5hZGRFdmVudExpc3RlbmVyKCdjbGljaycsICgpID0+IC8qKiBAdHlwZSB7YW55fSAqLyAod2luZG93KS5vbkNhcnRlcmFDaGlwQ2xpY2soc3BlYy5jaGlwKSk7XG4gICAgY29uc3QgbiA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpO1xuICAgIG4uY2xhc3NOYW1lID0gJ2NhcnRlcmEta3BpLW51bSc7XG4gICAgbi50ZXh0Q29udGVudCA9IFN0cmluZyhjb3VudHNbc3BlYy5jaGlwID09PSAndG9kb3MnID8gJ3RvdGFsJyA6IHNwZWMuY2hpcF0pO1xuICAgIGNvbnN0IGwgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKTtcbiAgICBsLmNsYXNzTmFtZSA9ICdjYXJ0ZXJhLWtwaS1sYWJlbCc7XG4gICAgbC5zdHlsZS5jb2xvciA9ICcnOyAvLyByZXNldCBjdXJyZW50Q29sb3IgcGFyYSBxdWUgdXNlIGVsIG11dGVkIGRlbCBDU1NcbiAgICBsLnRleHRDb250ZW50ID0gc3BlYy5sYWJlbDtcbiAgICBjYXJkLmFwcGVuZENoaWxkKG4pO1xuICAgIGNhcmQuYXBwZW5kQ2hpbGQobCk7XG4gICAgZWwuYXBwZW5kQ2hpbGQoY2FyZCk7XG4gIH1cbn1cblxuZnVuY3Rpb24gcmVuZGVyQ2hpcHMoY291bnRzKSB7XG4gIGNvbnN0IGVsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2NhcnRlcmEtY2hpcHMnKTtcbiAgaWYgKCFlbCkgcmV0dXJuO1xuICBjb25zdCBjb3VudEJ5Q2hpcCA9IHtcbiAgICB0b2RvczogY291bnRzLnRvdGFsLFxuICAgIGJhc2VBY3RpdmE5MGQ6IGNvdW50cy5iYXNlQWN0aXZhOTBkLFxuICAgIGRvcm1pZG9zVmlzaXRhMzBkOiBjb3VudHMuZG9ybWlkb3NWaXNpdGEzMGQsXG4gICAgZG9ybWlkb3NDb21wcmE5MGQ6IGNvdW50cy5kb3JtaWRvc0NvbXByYTkwZCxcbiAgICBudW5jYVZpc2l0YWRvczogY291bnRzLm51bmNhVmlzaXRhZG9zLFxuICAgIG51bmNhQ29tcHJhcm9uOiBjb3VudHMubnVuY2FDb21wcmFyb24sXG4gIH07XG4gIHdoaWxlIChlbC5maXJzdENoaWxkKSBlbC5yZW1vdmVDaGlsZChlbC5maXJzdENoaWxkKTtcbiAgLy8gdjEzODM6IHNlZ21lbnRlZCBjb250cm9sIGlPUy4gV3JhcHBlciAuY2FydGVyYS1jaGlwLXdyYXAgYWdydXBhIHBpbGxzIGNvbiBiZyBncmlzLlxuICBjb25zdCB3cmFwID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2Jyk7XG4gIHdyYXAuY2xhc3NOYW1lID0gJ2NhcnRlcmEtY2hpcC13cmFwJztcbiAgZm9yIChjb25zdCBjaGlwIG9mIENISVBTKSB7XG4gICAgY29uc3QgYiA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2J1dHRvbicpO1xuICAgIGIuY2xhc3NOYW1lID0gJ2NhcnRlcmEtY2hpcCc7XG4gICAgaWYgKGFjdGl2ZUNoaXAgPT09IGNoaXAuaWQpIGIuY2xhc3NMaXN0LmFkZCgnYWN0aXZlJyk7XG4gICAgYi50eXBlID0gJ2J1dHRvbic7XG4gICAgYi50ZXh0Q29udGVudCA9IGAke2NoaXAubGFiZWx9ICgke2NvdW50QnlDaGlwW2NoaXAuaWRdfSlgO1xuICAgIGIuYWRkRXZlbnRMaXN0ZW5lcignY2xpY2snLCAoKSA9PiAvKiogQHR5cGUge2FueX0gKi8gKHdpbmRvdykub25DYXJ0ZXJhQ2hpcENsaWNrKGNoaXAuaWQpKTtcbiAgICB3cmFwLmFwcGVuZENoaWxkKGIpO1xuICB9XG4gIGVsLmFwcGVuZENoaWxkKHdyYXApO1xufVxuXG4vKiogQHBhcmFtIHtBcnJheTxhbnk+fSBjbGllbnRlcyAqL1xuZnVuY3Rpb24gcmVuZGVyVGFibGUoY2xpZW50ZXMpIHtcbiAgY29uc3QgdGFibGUgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY2FydGVyYS10YWJsZScpO1xuICBpZiAoIXRhYmxlKSByZXR1cm47XG4gIGNvbnN0IGZpbHRlcmVkID0gYXBwbHlDaGlwRmlsdGVyKGNsaWVudGVzLCBhY3RpdmVDaGlwKTtcbiAgY29uc3Qgc2VhcmNoZWQgPSBzZWFyY2hRdWVyeVxuICAgID8gZmlsdGVyZWQuZmlsdGVyKChjKSA9PlxuICAgICAgICBTdHJpbmcoYy5jbGllbnROYW1lIHx8ICcnKVxuICAgICAgICAgIC50b0xvd2VyQ2FzZSgpXG4gICAgICAgICAgLmluY2x1ZGVzKHNlYXJjaFF1ZXJ5KVxuICAgICAgKVxuICAgIDogZmlsdGVyZWQ7XG4gIGNvbnN0IHNvcnRlZCA9IHNvcnRDbGllbnRlcyhzZWFyY2hlZCwgc29ydEJ5LCBzb3J0RGlyKTtcbiAgd2hpbGUgKHRhYmxlLmZpcnN0Q2hpbGQpIHRhYmxlLnJlbW92ZUNoaWxkKHRhYmxlLmZpcnN0Q2hpbGQpO1xuICB0YWJsZS5hcHBlbmRDaGlsZChidWlsZFRoZWFkKCkpO1xuICB0YWJsZS5hcHBlbmRDaGlsZChidWlsZFRib2R5KHNvcnRlZCkpO1xufVxuXG5mdW5jdGlvbiBidWlsZFRoZWFkKCkge1xuICAvLyB2MTM4MzogQXBwbGUtc3R5bGUgdGhlYWQuIENsYXNlcyAuY2FydGVyYS0qIGVuIGluZGV4Lmh0bWwgY29udHJvbGFuIGJnL2NvbG9ycy5cbiAgY29uc3QgdGhlYWQgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCd0aGVhZCcpO1xuICBjb25zdCB0ciA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3RyJyk7XG4gIGNvbnN0IGhlYWRlcnMgPSBbXG4gICAgeyBsYWJlbDogJ0NsaWVudGUnLCBzb3J0S2V5OiAnY2xpZW50TmFtZScsIGFsaWduOiAnbGVmdCcgfSxcbiAgICB7IGxhYmVsOiAnUHJvdi9Mb2MnLCBzb3J0S2V5OiBudWxsLCBhbGlnbjogJ2xlZnQnIH0sXG4gICAgeyBsYWJlbDogJ1RpcG8nLCBzb3J0S2V5OiBudWxsLCBhbGlnbjogJ2NlbnRlcicgfSxcbiAgICB7IGxhYmVsOiAnXHUwMERBbHQuIHZpc2l0YScsIHNvcnRLZXk6ICdkaWFzU2luVmlzaXRhUHJlc2VuY2lhbCcsIGFsaWduOiAnbGVmdCcgfSxcbiAgICB7IGxhYmVsOiAnXHUwMERBbHQuIGNvbnRhY3RvJywgc29ydEtleTogJ2RpYXNTaW5Db250YWN0bycsIGFsaWduOiAnbGVmdCcgfSxcbiAgICB7IGxhYmVsOiAnXHUwMERBbHQuIGNvbXByYScsIHNvcnRLZXk6ICdkaWFzU2luQ29tcHJhJywgYWxpZ246ICdsZWZ0JyB9LFxuICAgIHsgbGFiZWw6ICdGYWN0IDEyTScsIHNvcnRLZXk6ICdmYWN0dXJhZG8xMk0nLCBhbGlnbjogJ3JpZ2h0JyB9LFxuICAgIHsgbGFiZWw6ICdEZXVkYScsIHNvcnRLZXk6ICdkZXVkYUFiaWVydGEnLCBhbGlnbjogJ3JpZ2h0JyB9LFxuICBdO1xuICBmb3IgKGNvbnN0IGggb2YgaGVhZGVycykge1xuICAgIGNvbnN0IHRoID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgndGgnKTtcbiAgICB0aC5zdHlsZS50ZXh0QWxpZ24gPSBoLmFsaWduO1xuICAgIHRoLnRleHRDb250ZW50ID0gaC5sYWJlbDtcbiAgICBpZiAoaC5zb3J0S2V5KSB7XG4gICAgICB0aC5zdHlsZS5jdXJzb3IgPSAncG9pbnRlcic7XG4gICAgICBjb25zdCBrZXkgPSBoLnNvcnRLZXk7XG4gICAgICB0aC5hZGRFdmVudExpc3RlbmVyKCdjbGljaycsICgpID0+IC8qKiBAdHlwZSB7YW55fSAqLyAod2luZG93KS5vbkNhcnRlcmFTb3J0Q2xpY2soa2V5KSk7XG4gICAgfVxuICAgIHRyLmFwcGVuZENoaWxkKHRoKTtcbiAgfVxuICB0aGVhZC5hcHBlbmRDaGlsZCh0cik7XG4gIHJldHVybiB0aGVhZDtcbn1cblxuLyoqIEBwYXJhbSB7QXJyYXk8YW55Pn0gc29ydGVkQ2xpZW50ZXMgKi9cbmZ1bmN0aW9uIGJ1aWxkVGJvZHkoc29ydGVkQ2xpZW50ZXMpIHtcbiAgY29uc3QgdGJvZHkgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCd0Ym9keScpO1xuICBmb3IgKGNvbnN0IGMgb2Ygc29ydGVkQ2xpZW50ZXMpIHtcbiAgICB0Ym9keS5hcHBlbmRDaGlsZChidWlsZENsaWVudGVSb3coYykpO1xuICB9XG4gIHJldHVybiB0Ym9keTtcbn1cblxuLyoqIEBwYXJhbSB7YW55fSBjICovXG5mdW5jdGlvbiBidWlsZENsaWVudGVSb3coYykge1xuICBjb25zdCB0ciA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3RyJyk7XG4gIHRyLnN0eWxlLmNzc1RleHQgPSAnY3Vyc29yOnBvaW50ZXI7Ym9yZGVyLWJvdHRvbToxcHggc29saWQgdmFyKC0tYm9yZGVyLWxpZ2h0KSc7XG4gIHRyLmFkZEV2ZW50TGlzdGVuZXIoJ21vdXNlZW50ZXInLCAoKSA9PiB7XG4gICAgdHIuc3R5bGUuYmFja2dyb3VuZCA9ICd2YXIoLS1iZy1ob3ZlciknO1xuICB9KTtcbiAgdHIuYWRkRXZlbnRMaXN0ZW5lcignbW91c2VsZWF2ZScsICgpID0+IHtcbiAgICB0ci5zdHlsZS5iYWNrZ3JvdW5kID0gJyc7XG4gIH0pO1xuICB0ci5hZGRFdmVudExpc3RlbmVyKCdjbGljaycsICgpID0+IHtcbiAgICAvLyBAdHMtZXhwZWN0LWVycm9yXG4gICAgaWYgKHR5cGVvZiB3aW5kb3cub3BlbkZpY2hhQ2xpZW50ZSA9PT0gJ2Z1bmN0aW9uJykgd2luZG93Lm9wZW5GaWNoYUNsaWVudGUoYy5jbGllbnRJZCk7XG4gIH0pO1xuXG4gIGNvbnN0IHRkTmFtZSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3RkJyk7XG4gIHRkTmFtZS5zdHlsZS5jc3NUZXh0ID0gJ3BhZGRpbmc6NnB4IDhweDtmb250LXdlaWdodDo2MDAnO1xuICB0ZE5hbWUudGV4dENvbnRlbnQgPSBjLmNsaWVudE5hbWUgfHwgJyc7XG4gIHRyLmFwcGVuZENoaWxkKHRkTmFtZSk7XG5cbiAgY29uc3QgdGRMb2MgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCd0ZCcpO1xuICB0ZExvYy5zdHlsZS5jc3NUZXh0ID0gJ3BhZGRpbmc6NnB4IDhweDtmb250LXNpemU6MTJweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKSc7XG4gIHRkTG9jLnRleHRDb250ZW50ID0gYCR7Yy5wcm92aW5jaWEgfHwgJyd9LyR7Yy5sb2NhbGlkYWQgfHwgJyd9YDtcbiAgdHIuYXBwZW5kQ2hpbGQodGRMb2MpO1xuXG4gIGNvbnN0IHRkVGlwbyA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3RkJyk7XG4gIHRkVGlwby5zdHlsZS5jc3NUZXh0ID0gJ3BhZGRpbmc6NnB4IDhweDt0ZXh0LWFsaWduOmNlbnRlcic7XG4gIGNvbnN0IHRpcG9CYWRnZSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3NwYW4nKTtcbiAgdGlwb0JhZGdlLnN0eWxlLmNzc1RleHQgPVxuICAgICdwYWRkaW5nOjJweCA2cHg7Ym9yZGVyLXJhZGl1czo0cHg7YmFja2dyb3VuZDp2YXIoLS1iZy1pbnB1dCk7Zm9udC1zaXplOjExcHg7Zm9udC13ZWlnaHQ6NzAwJztcbiAgLy8gdjE0ODIgXHUwMEE3ODI6IGxhYmVsIGRlIGxhIEZpY2hhIChcIkIgLSBzaW4gZGVzY3VlbnRvXCIpIHZzIGNcdTAwRjNkaWdvIChcIkJcIikuXG4gIHRpcG9CYWRnZS50ZXh0Q29udGVudCA9IGxhYmVsRm9yRmljaGFGaWVsZCgnY2xpVGlwbycsIGMuY2xpVGlwbyk7XG4gIHRkVGlwby5hcHBlbmRDaGlsZCh0aXBvQmFkZ2UpO1xuICB0ci5hcHBlbmRDaGlsZCh0ZFRpcG8pO1xuXG4gIHRyLmFwcGVuZENoaWxkKGJ1aWxkRGF0ZUNlbGwoYy51bHRpbWFWaXNpdGFQcmVzZW5jaWFsLCBjLmRpYXNTaW5WaXNpdGFQcmVzZW5jaWFsLCAzMCkpO1xuICB0ci5hcHBlbmRDaGlsZChidWlsZERhdGVDZWxsKGMudWx0aW1vQ29udGFjdG8sIGMuZGlhc1NpbkNvbnRhY3RvLCBudWxsKSk7XG4gIHRyLmFwcGVuZENoaWxkKGJ1aWxkRGF0ZUNlbGwoYy51bHRpbWFDb21wcmEsIGMuZGlhc1NpbkNvbXByYSwgOTApKTtcblxuICBjb25zdCB0ZEZhY3QgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCd0ZCcpO1xuICB0ZEZhY3Quc3R5bGUuY3NzVGV4dCA9ICdwYWRkaW5nOjZweCA4cHg7dGV4dC1hbGlnbjpyaWdodDtmb250LXZhcmlhbnQtbnVtZXJpYzp0YWJ1bGFyLW51bXMnO1xuICB0ZEZhY3QudGV4dENvbnRlbnQgPSBmbXRNb25leShjLmZhY3R1cmFkbzEyTSk7XG4gIHRyLmFwcGVuZENoaWxkKHRkRmFjdCk7XG5cbiAgY29uc3QgdGREZXVkYSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3RkJyk7XG4gIHRkRGV1ZGEuc3R5bGUuY3NzVGV4dCA9IGBwYWRkaW5nOjZweCA4cHg7dGV4dC1hbGlnbjpyaWdodDtmb250LXZhcmlhbnQtbnVtZXJpYzp0YWJ1bGFyLW51bXM7Y29sb3I6JHtjLmRldWRhQWJpZXJ0YSA+IDAgPyAnI2RjMjYyNicgOiAndmFyKC0tdGV4dC1tdXRlZCknfWA7XG4gIHRkRGV1ZGEudGV4dENvbnRlbnQgPSBmbXRNb25leShjLmRldWRhQWJpZXJ0YSk7XG4gIHRyLmFwcGVuZENoaWxkKHRkRGV1ZGEpO1xuXG4gIHJldHVybiB0cjtcbn1cblxuLyoqXG4gKiBAcGFyYW0ge3N0cmluZ3xudWxsfSBmZWNoYUlzb1xuICogQHBhcmFtIHtudW1iZXJ8bnVsbH0gZGlhc1xuICogQHBhcmFtIHtudW1iZXJ8bnVsbH0gZGFuZ2VyVGhyZXNob2xkXG4gKi9cbmZ1bmN0aW9uIGJ1aWxkRGF0ZUNlbGwoZmVjaGFJc28sIGRpYXMsIGRhbmdlclRocmVzaG9sZCkge1xuICBjb25zdCB0ZCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3RkJyk7XG4gIGNvbnN0IGlzRGFuZ2VyID1cbiAgICBkYW5nZXJUaHJlc2hvbGQgIT09IG51bGwgJiYgZGlhcyAhPT0gbnVsbCAmJiBkaWFzICE9PSB1bmRlZmluZWQgJiYgZGlhcyA+IGRhbmdlclRocmVzaG9sZDtcbiAgdGQuc3R5bGUuY3NzVGV4dCA9IGBwYWRkaW5nOjZweCA4cHg7Y29sb3I6JHtpc0RhbmdlciA/ICcjZGMyNjI2JyA6ICd2YXIoLS10ZXh0LXByaW1hcnkpJ31gO1xuICBpZiAoIWZlY2hhSXNvKSB7XG4gICAgdGQudGV4dENvbnRlbnQgPSAnXHUyMDE0JztcbiAgICByZXR1cm4gdGQ7XG4gIH1cbiAgY29uc3QgcGFydHMgPSBTdHJpbmcoZmVjaGFJc28pLnNwbGl0KCctJyk7XG4gIGNvbnN0IGQgPSBwYXJ0c1syXSB8fCAnJztcbiAgY29uc3QgbSA9IHBhcnRzWzFdIHx8ICcnO1xuICB0ZC50ZXh0Q29udGVudCA9IGAke2R9LyR7bX1gO1xuICBjb25zdCBkaWFzRWwgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdzbWFsbCcpO1xuICBkaWFzRWwuc3R5bGUuY3NzVGV4dCA9ICdjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTttYXJnaW4tbGVmdDo0cHgnO1xuICBkaWFzRWwudGV4dENvbnRlbnQgPSBgJHtkaWFzfWRgO1xuICB0ZC5hcHBlbmRDaGlsZChkaWFzRWwpO1xuICByZXR1cm4gdGQ7XG59XG5cbi8qKiBAcGFyYW0ge251bWJlcn0gbiAqL1xuZnVuY3Rpb24gZm10TW9uZXkobikge1xuICBpZiAoIW4gfHwgbiA9PT0gMCkgcmV0dXJuICctJztcbiAgaWYgKG4gPj0gMV8wMDBfMDAwKSByZXR1cm4gYCQgJHsobiAvIDFfMDAwXzAwMCkudG9GaXhlZCgxKX1NYDtcbiAgaWYgKG4gPj0gMV8wMDApIHJldHVybiBgJCAkeyhuIC8gMV8wMDApLnRvRml4ZWQoMCl9a2A7XG4gIHJldHVybiBgJCAke259YDtcbn1cblxuLy8gPT09IFVJIHN0YXRlIGhlbHBlcnMgPT09XG5mdW5jdGlvbiBoaWRlQWxsKCkge1xuICBjb25zdCBpZHMgPSBbXG4gICAgJ2NhcnRlcmEtbG9hZGluZycsXG4gICAgJ2NhcnRlcmEtdGFibGUnLFxuICAgICdjYXJ0ZXJhLWtwaXMnLFxuICAgICdjYXJ0ZXJhLWNoaXBzJyxcbiAgICAnY2FydGVyYS1lbXB0eScsXG4gIF07XG4gIGZvciAoY29uc3QgaWQgb2YgaWRzKSB7XG4gICAgY29uc3QgZWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZChpZCk7XG4gICAgaWYgKGVsKSBlbC5zdHlsZS5kaXNwbGF5ID0gJ25vbmUnO1xuICB9XG59XG5mdW5jdGlvbiBzaG93RW1wdHkoKSB7XG4gIGhpZGVBbGwoKTtcbiAgY29uc3QgZW1wdHkgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY2FydGVyYS1lbXB0eScpO1xuICBpZiAoZW1wdHkpIHtcbiAgICBlbXB0eS5zdHlsZS5kaXNwbGF5ID0gJ2Jsb2NrJztcbiAgICBlbXB0eS50ZXh0Q29udGVudCA9ICdFbGVnXHUwMEVEIHVuIHZlbmRlZG9yIHBhcmEgdmVyIHN1IGNhcnRlcmEuJztcbiAgfVxufVxuZnVuY3Rpb24gc2hvd0xvYWRpbmcoKSB7XG4gIGhpZGVBbGwoKTtcbiAgY29uc3QgbG9hZGluZyA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdjYXJ0ZXJhLWxvYWRpbmcnKTtcbiAgaWYgKGxvYWRpbmcpIGxvYWRpbmcuc3R5bGUuZGlzcGxheSA9ICdibG9jayc7XG59XG5mdW5jdGlvbiBzaG93Tm9EYXRhKCkge1xuICBoaWRlQWxsKCk7XG4gIGNvbnN0IGVtcHR5ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2NhcnRlcmEtZW1wdHknKTtcbiAgaWYgKGVtcHR5KSB7XG4gICAgZW1wdHkuc3R5bGUuZGlzcGxheSA9ICdibG9jayc7XG4gICAgZW1wdHkudGV4dENvbnRlbnQgPVxuICAgICAgJ1NpbiBjYXJ0ZXJhIHBhcmEgZXN0ZSB2ZW5kZWRvci4gVmVyaWZpY1x1MDBFMSBhc3NpZ25lZFZlbmRvciBlbiBjbGllbnRfbWFzdGVyIG8gZXNwZXJcdTAwRTEgYWwgcHJcdTAwRjN4aW1vIHNuYXBzaG90ICgwNDowMCBBUlQpLic7XG4gIH1cbn1cbi8qKiBAcGFyYW0ge3N0cmluZ30gbXNnICovXG5mdW5jdGlvbiBzaG93RXJyb3IobXNnKSB7XG4gIGhpZGVBbGwoKTtcbiAgY29uc3QgZW1wdHkgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY2FydGVyYS1lbXB0eScpO1xuICBpZiAoZW1wdHkpIHtcbiAgICBlbXB0eS5zdHlsZS5kaXNwbGF5ID0gJ2Jsb2NrJztcbiAgICBlbXB0eS5zdHlsZS5jb2xvciA9ICcjZGMyNjI2JztcbiAgICBlbXB0eS50ZXh0Q29udGVudCA9IGBFcnJvciBjYXJnYW5kbyBjYXJ0ZXJhOiAke21zZ31gO1xuICB9XG59XG5mdW5jdGlvbiBzaG93VGFibGUoKSB7XG4gIGNvbnN0IGVtcHR5ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2NhcnRlcmEtZW1wdHknKTtcbiAgaWYgKGVtcHR5KSBlbXB0eS5zdHlsZS5kaXNwbGF5ID0gJ25vbmUnO1xuICBjb25zdCBsb2FkaW5nID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2NhcnRlcmEtbG9hZGluZycpO1xuICBpZiAobG9hZGluZykgbG9hZGluZy5zdHlsZS5kaXNwbGF5ID0gJ25vbmUnO1xuICBjb25zdCB0YWJsZSA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdjYXJ0ZXJhLXRhYmxlJyk7XG4gIGlmICh0YWJsZSkgdGFibGUuc3R5bGUuZGlzcGxheSA9ICd0YWJsZSc7XG4gIC8vIHYxMzgzOiBkaXNwbGF5IHZhY2lvID0gcmVzZXQgYWwgdmFsb3IgZGVsIENTUyAoZ3JpZCBwYXJhIGtwaXMsIGZsZXggcGFyYSBjaGlwcykuXG4gIGNvbnN0IGtwaXMgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY2FydGVyYS1rcGlzJyk7XG4gIGlmIChrcGlzKSBrcGlzLnN0eWxlLmRpc3BsYXkgPSAnJztcbiAgY29uc3QgY2hpcHMgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY2FydGVyYS1jaGlwcycpO1xuICBpZiAoY2hpcHMpIGNoaXBzLnN0eWxlLmRpc3BsYXkgPSAnJztcbn1cblxuLy8gPT09IEV4cG9ydCBFeGNlbCA9PT1cbndpbmRvdy5leHBvcnRDYXJ0ZXJhVG9FeGNlbCA9IGFzeW5jIGZ1bmN0aW9uIGV4cG9ydENhcnRlcmFUb0V4Y2VsKCkge1xuICBpZiAoIXNlbGVjdGVkVmVuZG9yKSB7XG4gICAgYWxlcnQoJ0VsZWdcdTAwRUQgdW4gdmVuZGVkb3IgcHJpbWVyby4nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgY29uc3QgZG9jID0gY2FydGVyYURvY0NhY2hlLmdldChzZWxlY3RlZFZlbmRvcik7XG4gIGlmICghZG9jKSB7XG4gICAgYWxlcnQoJ1NpbiBkYXRhIGNhcmdhZGEuJyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGNvbnN0IGZpbHRlcmVkID0gYXBwbHlDaGlwRmlsdGVyKGRvYy5jbGllbnRlcywgYWN0aXZlQ2hpcCk7XG4gIGNvbnN0IHNlYXJjaGVkID0gc2VhcmNoUXVlcnlcbiAgICA/IGZpbHRlcmVkLmZpbHRlcigoYykgPT5cbiAgICAgICAgU3RyaW5nKGMuY2xpZW50TmFtZSB8fCAnJylcbiAgICAgICAgICAudG9Mb3dlckNhc2UoKVxuICAgICAgICAgIC5pbmNsdWRlcyhzZWFyY2hRdWVyeSlcbiAgICAgIClcbiAgICA6IGZpbHRlcmVkO1xuICBjb25zdCBzb3J0ZWQgPSBzb3J0Q2xpZW50ZXMoc2VhcmNoZWQsIHNvcnRCeSwgc29ydERpcik7XG5cbiAgY29uc3QgY2hpcExhYmVsID0gKENISVBTLmZpbmQoKGMpID0+IGMuaWQgPT09IGFjdGl2ZUNoaXApIHx8IHsgbGFiZWw6ICdUb2RvcycgfSkubGFiZWw7XG4gIGNvbnN0IHRpdGxlID0gYENhcnRlcmEgZGUgJHtzZWxlY3RlZFZlbmRvcn0gXHUyMDE0ICR7Y2hpcExhYmVsfSBcdTIwMTQgU25hcHNob3QgJHtkb2Muc25hcHNob3REYXRlfWA7XG5cbiAgdHJ5IHtcbiAgICBpZiAodHlwZW9mIHdpbmRvdy5sb2FkRXhjZWxKUyA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgYXdhaXQgd2luZG93LmxvYWRFeGNlbEpTKCk7XG4gICAgfVxuICAgIGNvbnN0IEV4Y2VsSlMgPSB3aW5kb3cuRXhjZWxKUztcbiAgICBpZiAoIUV4Y2VsSlMpIHRocm93IG5ldyBFcnJvcignRXhjZWxKUyBubyBkaXNwb25pYmxlJyk7XG4gICAgY29uc3Qgd2IgPSBuZXcgRXhjZWxKUy5Xb3JrYm9vaygpO1xuICAgIGNvbnN0IHdzID0gd2IuYWRkV29ya3NoZWV0KCdDYXJ0ZXJhJyk7XG5cbiAgICAvLyBGaWxhIDE6IHRpdHVsbyBiYW5kYSB2ZXJkZSBTaGltYW5vXG4gICAgd3MubWVyZ2VDZWxscygnQTE6TDEnKTtcbiAgICBjb25zdCB0aXRsZUNlbGwgPSB3cy5nZXRDZWxsKCdBMScpO1xuICAgIHRpdGxlQ2VsbC52YWx1ZSA9IHRpdGxlO1xuICAgIHRpdGxlQ2VsbC5maWxsID0geyB0eXBlOiAncGF0dGVybicsIHBhdHRlcm46ICdzb2xpZCcsIGZnQ29sb3I6IHsgYXJnYjogJ0ZGMjJDNTVFJyB9IH07XG4gICAgdGl0bGVDZWxsLmZvbnQgPSB7IGJvbGQ6IHRydWUsIGNvbG9yOiB7IGFyZ2I6ICdGRkZGRkZGRicgfSwgc2l6ZTogMTQgfTtcbiAgICB0aXRsZUNlbGwuYWxpZ25tZW50ID0geyBob3Jpem9udGFsOiAnY2VudGVyJywgdmVydGljYWw6ICdtaWRkbGUnIH07XG4gICAgd3MuZ2V0Um93KDEpLmhlaWdodCA9IDMwO1xuXG4gICAgLy8gRmlsYSAyOiBoZWFkZXJzXG4gICAgY29uc3QgaGVhZGVycyA9IFtcbiAgICAgICdDbGllbnRlJyxcbiAgICAgICdQcm92aW5jaWEnLFxuICAgICAgJ0xvY2FsaWRhZCcsXG4gICAgICAnVGlwbycsXG4gICAgICAnXHUwMERBbHRpbWEgdmlzaXRhIHByZXNlbmNpYWwnLFxuICAgICAgJ1x1MDBEQWx0aW1vIGNvbnRhY3RvJyxcbiAgICAgICdcdTAwREFsdGltYSBjb21wcmEnLFxuICAgICAgJ0ZhY3QgMTJNIChBUlMpJyxcbiAgICAgICdEZXVkYSBhYmllcnRhIChBUlMpJyxcbiAgICAgICdEXHUwMEVEYXMgc2luIHZpc2l0YScsXG4gICAgICAnRFx1MDBFRGFzIHNpbiBjb21wcmEnLFxuICAgICAgJ0NhcmRDb2RlIFNBUCcsXG4gICAgXTtcbiAgICBjb25zdCBoZWFkZXJSb3cgPSB3cy5nZXRSb3coMik7XG4gICAgaGVhZGVycy5mb3JFYWNoKChoLCBpKSA9PiB7XG4gICAgICBjb25zdCBjZWxsID0gaGVhZGVyUm93LmdldENlbGwoaSArIDEpO1xuICAgICAgY2VsbC52YWx1ZSA9IGg7XG4gICAgICBjZWxsLmZpbGwgPSB7IHR5cGU6ICdwYXR0ZXJuJywgcGF0dGVybjogJ3NvbGlkJywgZmdDb2xvcjogeyBhcmdiOiAnRkYwNzRGNjknIH0gfTtcbiAgICAgIGNlbGwuZm9udCA9IHsgYm9sZDogdHJ1ZSwgY29sb3I6IHsgYXJnYjogJ0ZGRkZGRkZGJyB9IH07XG4gICAgICBjZWxsLmFsaWdubWVudCA9IHsgaG9yaXpvbnRhbDogJ2NlbnRlcicgfTtcbiAgICB9KTtcblxuICAgIC8vIEZpbGFzIDMrOiBkYXRhXG4gICAgc29ydGVkLmZvckVhY2goKGMsIGkpID0+IHtcbiAgICAgIGNvbnN0IHJvdyA9IHdzLmdldFJvdygzICsgaSk7XG4gICAgICByb3cuZ2V0Q2VsbCgxKS52YWx1ZSA9IGMuY2xpZW50TmFtZSB8fCAnJztcbiAgICAgIHJvdy5nZXRDZWxsKDIpLnZhbHVlID0gYy5wcm92aW5jaWEgfHwgJyc7XG4gICAgICByb3cuZ2V0Q2VsbCgzKS52YWx1ZSA9IGMubG9jYWxpZGFkIHx8ICcnO1xuICAgICAgcm93LmdldENlbGwoNCkudmFsdWUgPSBsYWJlbEZvckZpY2hhRmllbGQoJ2NsaVRpcG8nLCBjLmNsaVRpcG8pO1xuICAgICAgcm93LmdldENlbGwoNSkudmFsdWUgPSBjLnVsdGltYVZpc2l0YVByZXNlbmNpYWwgfHwgJyc7XG4gICAgICByb3cuZ2V0Q2VsbCg2KS52YWx1ZSA9IGMudWx0aW1vQ29udGFjdG8gfHwgJyc7XG4gICAgICByb3cuZ2V0Q2VsbCg3KS52YWx1ZSA9IGMudWx0aW1hQ29tcHJhIHx8ICcnO1xuICAgICAgcm93LmdldENlbGwoOCkudmFsdWUgPSBjLmZhY3R1cmFkbzEyTSB8fCAwO1xuICAgICAgcm93LmdldENlbGwoOCkubnVtRm10ID0gJ1wiJFwiIywjIzAnO1xuICAgICAgcm93LmdldENlbGwoOSkudmFsdWUgPSBjLmRldWRhQWJpZXJ0YSB8fCAwO1xuICAgICAgcm93LmdldENlbGwoOSkubnVtRm10ID0gJ1wiJFwiIywjIzAnO1xuICAgICAgcm93LmdldENlbGwoMTApLnZhbHVlID0gYy5kaWFzU2luVmlzaXRhUHJlc2VuY2lhbDtcbiAgICAgIHJvdy5nZXRDZWxsKDExKS52YWx1ZSA9IGMuZGlhc1NpbkNvbXByYTtcbiAgICAgIHJvdy5nZXRDZWxsKDEyKS52YWx1ZSA9IGMuY2FyZENvZGUgfHwgJyc7XG4gICAgfSk7XG5cbiAgICB3cy5jb2x1bW5zLmZvckVhY2goKGNvbCwgaSkgPT4ge1xuICAgICAgY29sLndpZHRoID0gaSA9PT0gMCA/IDMwIDogaSA9PT0gNCB8fCBpID09PSA1IHx8IGkgPT09IDYgPyAxOCA6IDE0O1xuICAgIH0pO1xuXG4gICAgY29uc3QgYnVmID0gYXdhaXQgd2IueGxzeC53cml0ZUJ1ZmZlcigpO1xuICAgIGNvbnN0IGJsb2IgPSBuZXcgQmxvYihbYnVmXSwge1xuICAgICAgdHlwZTogJ2FwcGxpY2F0aW9uL3ZuZC5vcGVueG1sZm9ybWF0cy1vZmZpY2Vkb2N1bWVudC5zcHJlYWRzaGVldG1sLnNoZWV0JyxcbiAgICB9KTtcbiAgICBjb25zdCB1cmwgPSBVUkwuY3JlYXRlT2JqZWN0VVJMKGJsb2IpO1xuICAgIGNvbnN0IGEgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdhJyk7XG4gICAgYS5ocmVmID0gdXJsO1xuICAgIGEuZG93bmxvYWQgPSBgQ2FydGVyYV8ke1N0cmluZyhzZWxlY3RlZFZlbmRvcikucmVwbGFjZSgvXFxzKy9nLCAnXycpfV8ke2FjdGl2ZUNoaXB9XyR7ZG9jLnNuYXBzaG90RGF0ZX0ueGxzeGA7XG4gICAgZG9jdW1lbnQuYm9keS5hcHBlbmRDaGlsZChhKTtcbiAgICBhLmNsaWNrKCk7XG4gICAgYS5yZW1vdmUoKTtcbiAgICBVUkwucmV2b2tlT2JqZWN0VVJMKHVybCk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBjb25zb2xlLmVycm9yKCdleHBvcnRDYXJ0ZXJhVG9FeGNlbCBmYWlsZWQnLCBlKTtcbiAgICBhbGVydCgnRXJyb3IgZXhwb3J0YW5kbzogJyArIFN0cmluZyhlKSk7XG4gIH1cbn07XG4iXSwKICAibWFwcGluZ3MiOiAiOzs7QUFlTyxXQUFTLGdCQUFnQixVQUFVLE1BQU07QUFDOUMsUUFBSSxDQUFDLE1BQU0sUUFBUSxRQUFRLEVBQUcsUUFBTyxD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
