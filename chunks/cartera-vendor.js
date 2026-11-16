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
    const userRole = typeof window !== "undefined" ? window.userRole : null;
    const assignedVendor = typeof window !== "undefined" ? window.assignedVendor : null;
    if (userRole === "vendedor") {
      if (!assignedVendor || !VENDORS_WHITELIST.has(assignedVendor)) {
        sel.disabled = true;
        return;
      }
      const opt = document.createElement("option");
      opt.value = assignedVendor;
      opt.textContent = assignedVendor;
      sel.appendChild(opt);
      sel.value = assignedVendor;
      sel.disabled = true;
      if (typeof window.onCarteraVendorChange === "function") {
        setTimeout(() => {
          try {
            window.onCarteraVendorChange();
          } catch (_e) {
          }
        }, 0);
      }
      return;
    }
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL3B1cmUvY2FydGVyYS12ZW5kb3ItZmlsdGVyLmpzIiwgIi4uL3NyYy9wdXJlL2ZpY2hhLWNsaWVudGUtbGFiZWxzLmpzIiwgIi4uL3NyYy9kb21haW5zL2NhcnRlcmEtdmVuZG9yLmpzIl0sCiAgInNvdXJjZXNDb250ZW50IjogWyIvLyBAdHMtY2hlY2tcbi8qKlxuICogY2FydGVyYS12ZW5kb3ItZmlsdGVyLmpzICh2MTI4MywgMjAyNi0xMC0yMClcbiAqXG4gKiBQdXJhcyBwYXJhIGZpbHRyYXIgeSBvcmRlbmFyIGxhIHRhYmxhIGRlbCBkYXNoYm9hcmQgXCJBbmFsaXNpcyBkZSBDYXJ0ZXJhXCIuXG4gKiBJbXBvcnRhZG8gcG9yIHNyYy9kb21haW5zL2NhcnRlcmEtdmVuZG9yLmpzIChidW5kbGUgZnJvbnRlbmQpLlxuICogVGVzdGVhZG8gZW4gdGVzdHMvdW5pdC9jYXJ0ZXJhLXZlbmRvci1maWx0ZXIudGVzdC5qcy5cbiAqL1xuXG4vKipcbiAqIEFwbGljYSB1biBjaGlwIGRlIGZpbHRybyBhbCBhcnJheSBkZSBjbGllbnRlcy5cbiAqIEBwYXJhbSB7QXJyYXk8YW55Pn0gY2xpZW50ZXNcbiAqIEBwYXJhbSB7c3RyaW5nfSBjaGlwXG4gKiBAcmV0dXJucyB7QXJyYXk8YW55Pn1cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGFwcGx5Q2hpcEZpbHRlcihjbGllbnRlcywgY2hpcCkge1xuICBpZiAoIUFycmF5LmlzQXJyYXkoY2xpZW50ZXMpKSByZXR1cm4gW107XG4gIHN3aXRjaCAoY2hpcCkge1xuICAgIGNhc2UgJ2Jhc2VBY3RpdmE5MGQnOlxuICAgICAgcmV0dXJuIGNsaWVudGVzLmZpbHRlcihcbiAgICAgICAgKGMpID0+IGMuZGlhc1NpbkNvbXByYSAhPT0gbnVsbCAmJiBjLmRpYXNTaW5Db21wcmEgIT09IHVuZGVmaW5lZCAmJiBjLmRpYXNTaW5Db21wcmEgPD0gOTBcbiAgICAgICk7XG4gICAgY2FzZSAnZG9ybWlkb3NWaXNpdGEzMGQnOlxuICAgICAgcmV0dXJuIGNsaWVudGVzLmZpbHRlcihcbiAgICAgICAgKGMpID0+XG4gICAgICAgICAgYy5kaWFzU2luVmlzaXRhUHJlc2VuY2lhbCAhPT0gbnVsbCAmJlxuICAgICAgICAgIGMuZGlhc1NpblZpc2l0YVByZXNlbmNpYWwgIT09IHVuZGVmaW5lZCAmJlxuICAgICAgICAgIGMuZGlhc1NpblZpc2l0YVByZXNlbmNpYWwgPiAzMFxuICAgICAgKTtcbiAgICBjYXNlICdkb3JtaWRvc0NvbXByYTkwZCc6XG4gICAgICByZXR1cm4gY2xpZW50ZXMuZmlsdGVyKFxuICAgICAgICAoYykgPT4gYy5kaWFzU2luQ29tcHJhICE9PSBudWxsICYmIGMuZGlhc1NpbkNvbXByYSAhPT0gdW5kZWZpbmVkICYmIGMuZGlhc1NpbkNvbXByYSA+IDkwXG4gICAgICApO1xuICAgIGNhc2UgJ251bmNhVmlzaXRhZG9zJzpcbiAgICAgIHJldHVybiBjbGllbnRlcy5maWx0ZXIoXG4gICAgICAgIChjKSA9PiBjLnVsdGltYVZpc2l0YVByZXNlbmNpYWwgPT09IG51bGwgfHwgYy51bHRpbWFWaXNpdGFQcmVzZW5jaWFsID09PSB1bmRlZmluZWRcbiAgICAgICk7XG4gICAgY2FzZSAnbnVuY2FDb21wcmFyb24nOlxuICAgICAgcmV0dXJuIGNsaWVudGVzLmZpbHRlcigoYykgPT4gYy51bHRpbWFDb21wcmEgPT09IG51bGwgfHwgYy51bHRpbWFDb21wcmEgPT09IHVuZGVmaW5lZCk7XG4gICAgZGVmYXVsdDpcbiAgICAgIHJldHVybiBjbGllbnRlcy5zbGljZSgpO1xuICB9XG59XG5cbi8qKlxuICogT3JkZW5hIHVuYSBjb3BpYSBkZWwgYXJyYXkgcG9yIGNvbHVtbmEuIE51bGxzIHNpZW1wcmUgYWwgZmluYWwuXG4gKiBAcGFyYW0ge0FycmF5PGFueT59IGNsaWVudGVzXG4gKiBAcGFyYW0ge3N0cmluZ30gc29ydEJ5XG4gKiBAcGFyYW0geydhc2MnfCdkZXNjJ30gc29ydERpclxuICogQHJldHVybnMge0FycmF5PGFueT59XG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzb3J0Q2xpZW50ZXMoY2xpZW50ZXMsIHNvcnRCeSwgc29ydERpcikge1xuICBpZiAoIUFycmF5LmlzQXJyYXkoY2xpZW50ZXMpKSByZXR1cm4gW107XG4gIGNvbnN0IGRpciA9IHNvcnREaXIgPT09ICdhc2MnID8gMSA6IC0xO1xuICBjb25zdCBjb3B5ID0gY2xpZW50ZXMuc2xpY2UoKTtcbiAgY29weS5zb3J0KChhLCBiKSA9PiB7XG4gICAgY29uc3QgYXYgPSBhW3NvcnRCeV07XG4gICAgY29uc3QgYnYgPSBiW3NvcnRCeV07XG4gICAgY29uc3QgYU51bGwgPSBhdiA9PT0gbnVsbCB8fCBhdiA9PT0gdW5kZWZpbmVkO1xuICAgIGNvbnN0IGJOdWxsID0gYnYgPT09IG51bGwgfHwgYnYgPT09IHVuZGVmaW5lZDtcbiAgICBpZiAoYU51bGwgJiYgYk51bGwpIHJldHVybiAwO1xuICAgIGlmIChhTnVsbCkgcmV0dXJuIDE7XG4gICAgaWYgKGJOdWxsKSByZXR1cm4gLTE7XG4gICAgaWYgKHR5cGVvZiBhdiA9PT0gJ251bWJlcicgJiYgdHlwZW9mIGJ2ID09PSAnbnVtYmVyJykgcmV0dXJuIChhdiAtIGJ2KSAqIGRpcjtcbiAgICByZXR1cm4gU3RyaW5nKGF2KS5sb2NhbGVDb21wYXJlKFN0cmluZyhidikpICogZGlyO1xuICB9KTtcbiAgcmV0dXJuIGNvcHk7XG59XG4iLCAiLy8gQHRzLWNoZWNrXG4vKipcbiAqIGZpY2hhLWNsaWVudGUtbGFiZWxzICh2MTQ4MiwgMjAyNi0xMC0yNykgXHUyMDE0IGZ1ZW50ZSBcdTAwRkFuaWNhIGRlIGxhYmVscyB5XG4gKiBjb21wb3NlLXJvdyBwYXJhIGxvcyBjYW1wb3MgZGUgbGEgRmljaGEgQ2xpZW50ZSAobW9kYWxcbiAqICNmaWNoYS1jbGllbnRlLW1vZGFsLCBwZXN0YVx1MDBGMWFzIENsYXNpZmljYWNpXHUwMEYzbiArIEJ1eWVyKS5cbiAqXG4gKiBNYXJpYW5vIHYxNDgyOiByZXVzYXIgZW4gTWFzdGVyZmlsZSBleHBvcnQgKyBBblx1MDBFMWxpc2lzIGRlIENhcnRlcmEgcG9yXG4gKiBWZW5kZWRvciBwYXJhIG5vIGR1cGxpY2FyIGVsIG1hcGVvIGRlIGV0aXF1ZXRhcy4gTG9zIGxhYmVscyBzb24gbG9zXG4gKiBFWEFDVE9TIHF1ZSBhcGFyZWNlbiBlbiBsb3MgYDxvcHRpb24+YCBkZWwgbW9kYWwgKHZlciBpbmRleC5odG1sOjU5MTkrKS5cbiAqXG4gKiBSZWdsYSBkZSBsbGVuYWRvOiBzaSBlbCBjbGllbnRlIHRpZW5lIGVsIGRhdG8sIHZhIGVsIHZhbG9yIHRhbCBjdWFsIHNlXG4gKiBtdWVzdHJhIGVuIGxhIEZpY2hhIChcIkIgLSBzaW4gZGVzY3VlbnRvXCIsIG5vIGVsIGNcdTAwRjNkaWdvIFwiQlwiKTsgc2kgbm8gbG9cbiAqIHRpZW5lLCB2YSBcIi1cIi4gTmluZ3VuYSBjZWxkYSBxdWVkYSB2YWNcdTAwRURhLlxuICpcbiAqIEZ1ZW50ZXM6XG4gKiAgIC0gY21EYXRhID0gY2xpZW50X21hc3Rlci97ZG9jSWR9OiBjbGlUaXBvLCBmaWRlbGlkYWQsIHByZWZDb250YWN0byxcbiAqICAgICB0YW1hbm8sIGVzcGVjaWFsaXphY2lvbiwgdGlwb0xvY2FsLCBjcmVkaXRvQ2hlcXVlIChjYW1wb3MgZGUgbGFcbiAqICAgICBwZXN0YVx1MDBGMWEgQ2xhc2lmaWNhY2lcdTAwRjNuIGRlIGxhIEZpY2hhKS5cbiAqICAgLSBidXllclN0YXRzID0gY2xpZW50X2J1eWVyX3N0YXRzL3tjYXJkQ29kZX06IHN0YXRzXzEybSBjb24gbW9udG9Ub3RhbCxcbiAqICAgICBmYWN0dXJhc0NvdW50LCBtb250b1Byb21lZGlvLCBmcmVjdWVuY2lhRGlhcywgZmFjdHVyYXNQb3JNZXMsXG4gKiAgICAgdWx0aW1hQ29tcHJhLCBkaWFzRGVzZGVVbHRpbWEsIHByaW1lcmFDb21wcmEgKHBlc3RhXHUwMEYxYSBCdXllciwgdmVudGFuYVxuICogICAgIHBvciBkZWZhdWx0IDEyIG1lc2VzIFx1MjAxNCBtaXNtYSBxdWUgYXJyYW5jYSBlbCBtb2RhbCkuXG4gKi9cblxuLyoqXG4gKiBMYWJlbHMgZGUgbG9zIHNlbGVjdHMgZGUgbGEgcGVzdGFcdTAwRjFhIENsYXNpZmljYWNpXHUwMEYzbi4gTWFwZWEgY1x1MDBGM2RpZ28gaW50ZXJub1xuICogKGxvIHF1ZSBzZSBwZXJzaXN0ZSBlbiBGaXJlc3RvcmUpIFx1MjE5MiBsYWJlbCBsZWdpYmxlIChsbyBxdWUgbXVlc3RyYSBlbFxuICogbW9kYWwpLiBGdWVudGU6IGluZGV4Lmh0bWw6NTkxOS01OTc3IChvcHRpb24gdmFsdWVzICsgZGlzcGxheSB0ZXh0KS5cbiAqXG4gKiBPcGNpXHUwMEYzbiBcIlwiIChzaW4gY2xhc2lmaWNhcikgTk8gc2UgbWFwZWEgYWNcdTAwRTEgXHUyMDE0IHNlIHRyYXRhIGNvbW8gXCJzaW4gdmFsb3JcIlxuICogZW4gbGFiZWxGb3JGaWNoYUZpZWxkIFx1MjE5MiBkZXZ1ZWx2ZSBcIi1cIi5cbiAqL1xuZXhwb3J0IGNvbnN0IEZJQ0hBX0NMQVNJRl9MQUJFTFMgPSBPYmplY3QuZnJlZXplKHtcbiAgY2xpVGlwbzogT2JqZWN0LmZyZWV6ZSh7XG4gICAgUDogJ1AgKFByZW1pdW0pIC0gZmlqbyA2JSAvIGFudGljaXBhZG8gNSUnLFxuICAgIEE6ICdBIC0gZmlqbyAzJSAvIGFudGljaXBhZG8gMyUnLFxuICAgIEI6ICdCIC0gc2luIGRlc2N1ZW50bycsXG4gICAgQzogJ0MgLSBzaW4gZGVzY3VlbnRvJyxcbiAgfSksXG4gIGZpZGVsaWRhZDogT2JqZWN0LmZyZWV6ZSh7XG4gICAgQUxUQTogJ0FsdGEnLFxuICAgIE1FRElBOiAnTWVkaWEnLFxuICAgIEJBSkE6ICdCYWphJyxcbiAgfSksXG4gIHByZWZDb250YWN0bzogT2JqZWN0LmZyZWV6ZSh7XG4gICAgQ0FMTF9DRU5URVI6ICdDYWxsIENlbnRlcicsXG4gICAgUFJFU0VOQ0lBTDogJ1ByZXNlbmNpYWwnLFxuICAgIEFNQk9TOiAnQW1ib3MnLFxuICAgIEFVVE9HRVNUSU9OX0IyQjogJ0F1dG9nZXN0aVx1MDBGM24gKEIyQiknLFxuICB9KSxcbiAgdGFtYW5vOiBPYmplY3QuZnJlZXplKHtcbiAgICBHUkFOREU6ICdHcmFuZGUnLFxuICAgIE1FRElBTk86ICdNZWRpYW5vJyxcbiAgICBDSElDQTogJ0NoaWNhJyxcbiAgICBMT0RHRTogJ0xvZGdlJyxcbiAgICBHVUlBX0RFX1BFU0NBOiAnR3VcdTAwRURhIGRlIHBlc2NhJyxcbiAgICBWRU5UQVNfRVNQRUNJQUxFUzogJ1ZlbnRhcyBlc3BlY2lhbGVzJyxcbiAgfSksXG4gIGVzcGVjaWFsaXphY2lvbjogT2JqZWN0LmZyZWV6ZSh7XG4gICAgQUdVQV9EVUxDRTogJ0FndWEgZHVsY2UnLFxuICAgIFBFU0NBX0RFX01BUjogJ1Blc2NhIGRlIG1hcicsXG4gICAgQUxUQV9HQU1BOiAnQWx0YSBnYW1hJyxcbiAgICBCQUpBX0dFTkVSQUw6ICdCYWphIC0gR2VuZXJhbCcsXG4gIH0pLFxuICB0aXBvTG9jYWw6IE9iamVjdC5mcmVlemUoe1xuICAgIEZJU0lDTzogJ0ZcdTAwRURzaWNvJyxcbiAgICBFQ09NTUVSQ0U6ICdFLWNvbW1lcmNlJyxcbiAgfSksXG59KTtcblxuLyoqXG4gKiBEZXZ1ZWx2ZSBlbCBsYWJlbCBsZWdpYmxlIGRlIHVuIGNhbXBvIGRlIGxhIEZpY2hhLiBTaSBlbCB2YWx1ZSBlc3RcdTAwRTFcbiAqIHZhY1x1MDBFRG8vbnVsbC91bmRlZmluZWQgbyBubyBtYXBlYWRvLCBkZXZ1ZWx2ZSBcIi1cIi5cbiAqXG4gKiBAcGFyYW0ge3N0cmluZ30gZmllbGQgIG5vbWJyZSBkZWwgY2FtcG8gKGNsaVRpcG8sIGZpZGVsaWRhZCwgLi4uKS5cbiAqIEBwYXJhbSB7c3RyaW5nIHwgbnVsbCB8IHVuZGVmaW5lZH0gdmFsdWUgIHZhbG9yIHBlcnNpc3RpZG8gZW4gRmlyZXN0b3JlLlxuICogQHJldHVybnMge3N0cmluZ31cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGxhYmVsRm9yRmljaGFGaWVsZChmaWVsZCwgdmFsdWUpIHtcbiAgaWYgKHZhbHVlID09PSBudWxsIHx8IHZhbHVlID09PSB1bmRlZmluZWQgfHwgdmFsdWUgPT09ICcnKSByZXR1cm4gJy0nO1xuICBjb25zdCBtYXAgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJlY29yZDxzdHJpbmcsIHN0cmluZz4+fSAqLyAoRklDSEFfQ0xBU0lGX0xBQkVMUylbZmllbGRdO1xuICBpZiAoIW1hcCkgcmV0dXJuICctJztcbiAgY29uc3Qga2V5ID0gU3RyaW5nKHZhbHVlKS50b1VwcGVyQ2FzZSgpO1xuICByZXR1cm4gbWFwW2tleV0gfHwgJy0nO1xufVxuXG4vKipcbiAqIEJ1c2NhIGVsIGRvYyBgY2xpZW50X21hc3RlcmAgcXVlIGNvcnJlc3BvbmRlIGEgdW4gY2FyZENvZGUgU0FQLlxuICogU2NhbiBgY2xpZW50TWFzdGVyQ2FjaGVgIHBvciBgc2FwQ2FyZENvZGVgIE9SIGBjYXJkQ29kZVNhcGAgKGFtYm9zIGFsaWFzZXNcbiAqIGFwYXJlY2VuIGVuIHByb2Qgc2VnXHUwMEZBbiBlbCBmbG93IHF1ZSBjcmVcdTAwRjMgZWwgZG9jKS5cbiAqXG4gKiAqKlBvciBxdVx1MDBFOSBleGlzdGUgKHYxNDg1IFx1MDBBNzg0LCAyMDI2LTEwLTI3IGJ1ZyBmaXgpKio6IGVuIHYxNDgyIGVsIGV4cG9ydFxuICogYnVzY2FiYSBgY2xpZW50TWFzdGVyQ2FjaGUuZ2V0KGNsaWVudExvY0lkKHBvaW50LnByb3ZpbmNlLCBwb2ludC5uYW1lLCBuYW1lKSlgXG4gKiBcdTIwMTQgc2x1ZyBkZXJpdmFkbyBkZWwgcGFkclx1MDBGM24gUE9JTlRTLiBQYXJhIGNsaWVudGVzIGNvbW8gQUxCRVJUTyBNQVhFUkEsIGVsXG4gKiBQT0lOVFMgZGljZSBgbmFtZT1cIlBhbGVybW8gKEMxNClcImAgcGVybyBsYSBGaWNoYSBwZXJzaXN0ZSBjb25cbiAqIGBsb2NhbGlkYWQ9XCJDT0xFR0lBTEVTXCJgIFx1MjE5MiBnZW5lcmEgZG9jSWQgZGlzdGludG8gXHUyMTkyIGNtRGF0YSB1bmRlZmluZWQgXHUyMTkyIGxvc1xuICogNiBjYW1wb3Mgc2FsXHUwMEVEYW4gXCItXCIgYXVucXVlIGxhIEZpY2hhIGVzdGFiYSBjYXJnYWRhLiBgc2FwQ2FyZENvZGVgIGVzIFx1MDBGQW5pY29cbiAqIHkgU0lFTVBSRSBpZGVudGlmaWNhIGVsIGRvYyBjb3JyZWN0by4gUGF0dGVybiB5YSBleGlzdGVudGUgZW5cbiAqIGBpbmRleC5odG1sOl9yZXNvbHZlVmVuZG9yRmFsbGJhY2tgIChsXHUwMEVEbmVhIDE1Nzg4KykuXG4gKlxuICogQHBhcmFtIHtzdHJpbmcgfCBudWxsIHwgdW5kZWZpbmVkfSBjYXJkQ29kZSAgZWouIFwiQzIwMTEwNTYxMDY4XCIuXG4gKiBAcGFyYW0ge01hcDxzdHJpbmcsIGFueT4gfCBudWxsIHwgdW5kZWZpbmVkfSBjbGllbnRNYXN0ZXJDYWNoZVxuICogQHJldHVybnMge2FueSB8IG51bGx9ICBjbURhdGEgbyBudWxsIHNpIG5vIHNlIGVuY3VlbnRyYSAvIGNhcmRDb2RlIHZhY1x1MDBFRG8uXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBmaW5kQ21EYXRhQnlDYXJkQ29kZShjYXJkQ29kZSwgY2xpZW50TWFzdGVyQ2FjaGUpIHtcbiAgY29uc3QgY2MgPSBTdHJpbmcoY2FyZENvZGUgfHwgJycpLnRyaW0oKTtcbiAgaWYgKCFjYyB8fCAhY2xpZW50TWFzdGVyQ2FjaGUgfHwgdHlwZW9mIGNsaWVudE1hc3RlckNhY2hlLmZvckVhY2ggIT09ICdmdW5jdGlvbicpIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuICAvLyBTY2FuIFRPRE9TIGxvcyBkb2NzIGNvbiBlbCBjYXJkQ29kZSAocHVlZGUgaGFiZXIgZHVwbGljYWRvczogdW5vXG4gIC8vIGltcG9ydGFkbyBTQVAgc2luIEZpY2hhICsgb3RybyBjb24gRmljaGEgcG9wdWxhdGVkKS4gUHJlZmVyaXIgZWwgcXVlXG4gIC8vIHRpZW5lIGFsIG1lbm9zIHVuIGNhbXBvIEZpY2hhIHBvcHVsYXRlZC4gQ2FzbyBNQVhFUkE6IGhheSAyIGRvY3M7IGVsXG4gIC8vIHNsdWcgU0FQLWltcG9ydCBubyB0aWVuZSBjYW1wb3MgRmljaGEsIGVsIHNsdWcgRmljaGEgc1x1MDBFRC5cbiAgLyoqIEB0eXBlIHtBcnJheTxhbnk+fSAqL1xuICBjb25zdCBjYW5kaWRhdGVzID0gW107XG4gIGNsaWVudE1hc3RlckNhY2hlLmZvckVhY2goKGNtRGF0YSkgPT4ge1xuICAgIGlmICghY21EYXRhKSByZXR1cm47XG4gICAgY29uc3QgY2MxID0gU3RyaW5nKGNtRGF0YS5zYXBDYXJkQ29kZSB8fCAnJykudHJpbSgpO1xuICAgIGNvbnN0IGNjMiA9IFN0cmluZyhjbURhdGEuY2FyZENvZGVTYXAgfHwgJycpLnRyaW0oKTtcbiAgICBpZiAoY2MxID09PSBjYyB8fCBjYzIgPT09IGNjKSB7XG4gICAgICBjYW5kaWRhdGVzLnB1c2goY21EYXRhKTtcbiAgICB9XG4gIH0pO1xuICBpZiAoY2FuZGlkYXRlcy5sZW5ndGggPT09IDApIHJldHVybiBudWxsO1xuICBpZiAoY2FuZGlkYXRlcy5sZW5ndGggPT09IDEpIHJldHVybiBjYW5kaWRhdGVzWzBdO1xuICAvLyBNXHUwMEZBbHRpcGxlcyBkb2NzOiBwcmVmZXJpciBlbCBxdWUgdGVuZ2EgYWwgbWVub3MgVU4gY2FtcG8gRmljaGEgcG9wdWxhdGVkLlxuICBjb25zdCBGSUNIQV9GSUVMRFMgPSBbXG4gICAgJ2NsaVRpcG8nLFxuICAgICdmaWRlbGlkYWQnLFxuICAgICdwcmVmQ29udGFjdG8nLFxuICAgICd0YW1hbm8nLFxuICAgICdlc3BlY2lhbGl6YWNpb24nLFxuICAgICd0aXBvTG9jYWwnLFxuICAgICdjcmVkaXRvQ2hlcXVlJyxcbiAgXTtcbiAgZm9yIChjb25zdCBjIG9mIGNhbmRpZGF0ZXMpIHtcbiAgICBmb3IgKGNvbnN0IGYgb2YgRklDSEFfRklFTERTKSB7XG4gICAgICBpZiAoY1tmXSAhPT0gbnVsbCAmJiBjW2ZdICE9PSB1bmRlZmluZWQgJiYgY1tmXSAhPT0gJycpIHtcbiAgICAgICAgcmV0dXJuIGM7XG4gICAgICB9XG4gICAgfVxuICB9XG4gIC8vIE5pbmd1bm8gdGllbmUgRmljaGEgcG9wdWxhdGVkIFx1MjE5MiBkZXZvbHZlciBlbCBwcmltZXJvIChhbWJvcyBlcXVpdmFsZW50ZXMpLlxuICByZXR1cm4gY2FuZGlkYXRlc1swXTtcbn1cblxuLyoqXG4gKiBDb21wb25lIGxhIGZpbGEgZGUgY29sdW1uYXMgZGUgbGEgcGVzdGFcdTAwRjFhIENsYXNpZmljYWNpXHUwMEYzbiBwYXJhIHVuIGNsaWVudGUuXG4gKiBOb21icmVzIGRlIGNvbHVtbmFzIGV4YWN0b3MgY29tbyBwaWRlIE1hcmlhbm8gZW4gZWwgcGVkaWRvLiBDZWxkYXMgdmFjXHUwMEVEYXNcbiAqIHNlIGNvbXBsZXRhbiBjb24gXCItXCIuXG4gKlxuICogQHBhcmFtIHthbnl9IGNtRGF0YSAgY2xpZW50X21hc3Rlci97ZG9jSWR9LmRhdGEoKVxuICogQHJldHVybnMge09iamVjdDxzdHJpbmcsIHN0cmluZyB8IG51bWJlcj59XG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBmaWNoYUNsaWVudGVDbGFzaWZSb3coY21EYXRhKSB7XG4gIGNvbnN0IGQgPSBjbURhdGEgfHwge307XG4gIGNvbnN0IGNyZWRpdG8gPSBkLmNyZWRpdG9DaGVxdWU7XG4gIGNvbnN0IGNyZWRpdG9OdW0gPSBjcmVkaXRvICE9IG51bGwgJiYgY3JlZGl0byAhPT0gJycgPyBOdW1iZXIoY3JlZGl0bykgOiBudWxsO1xuICByZXR1cm4ge1xuICAgICdUaXBvIGRlIGNsaWVudGUnOiBsYWJlbEZvckZpY2hhRmllbGQoJ2NsaVRpcG8nLCBkLmNsaVRpcG8pLFxuICAgIEZpZGVsaWRhZDogbGFiZWxGb3JGaWNoYUZpZWxkKCdmaWRlbGlkYWQnLCBkLmZpZGVsaWRhZCksXG4gICAgJ1ByZWZlcmVuY2lhIGRlIGNvbnRhY3RvJzogbGFiZWxGb3JGaWNoYUZpZWxkKCdwcmVmQ29udGFjdG8nLCBkLnByZWZDb250YWN0byksXG4gICAgVGFtYVx1MDBGMW86IGxhYmVsRm9yRmljaGFGaWVsZCgndGFtYW5vJywgZC50YW1hbm8pLFxuICAgIEVzcGVjaWFsaXphY2lcdTAwRjNuOiBsYWJlbEZvckZpY2hhRmllbGQoJ2VzcGVjaWFsaXphY2lvbicsIGQuZXNwZWNpYWxpemFjaW9uKSxcbiAgICAnVGlwbyBkZSBsb2NhbCc6IGxhYmVsRm9yRmljaGFGaWVsZCgndGlwb0xvY2FsJywgZC50aXBvTG9jYWwpLFxuICAgICdDclx1MDBFOWRpdG8gY2hlcXVlIChBUlMpJzpcbiAgICAgIGNyZWRpdG9OdW0gIT0gbnVsbCAmJiBOdW1iZXIuaXNGaW5pdGUoY3JlZGl0b051bSkgJiYgY3JlZGl0b051bSA+IDBcbiAgICAgICAgPyBNYXRoLnJvdW5kKGNyZWRpdG9OdW0pXG4gICAgICAgIDogJy0nLFxuICB9O1xufVxuXG4vKipcbiAqIENvbXBvbmUgbGEgZmlsYSBkZSBjb2x1bW5hcyBkZSBsYSBwZXN0YVx1MDBGMWEgQnV5ZXIgcGFyYSB1biBjbGllbnRlLlxuICogVmVudGFuYSBkZWZhdWx0IDEybSAobGEgcXVlIGFycmFuY2EgZWwgbW9kYWw7IHZlciBfZmNCdXllckN1cnJlbnRQZXJpb2QpLlxuICogTWFyaWFubzogc2kgZWwgdmFsb3Igbm8gZXhpc3RlLCB2YSBcIi1cIi5cbiAqXG4gKiBAcGFyYW0ge2FueX0gYnV5ZXJTdGF0cyAgY2xpZW50X2J1eWVyX3N0YXRzL3tjYXJkQ29kZX0uZGF0YSgpXG4gKiBAcGFyYW0ge3N0cmluZ30gW3BlcmlvZF0gICczbScgfCAnNm0nIHwgJzEybScgfCAnMjRtJy4gRGVmYXVsdCAnMTJtJy5cbiAqIEByZXR1cm5zIHtPYmplY3Q8c3RyaW5nLCBzdHJpbmcgfCBudW1iZXI+fVxuICovXG5leHBvcnQgZnVuY3Rpb24gZmljaGFDbGllbnRlQnV5ZXJSb3coYnV5ZXJTdGF0cywgcGVyaW9kKSB7XG4gIGNvbnN0IHAgPSBwZXJpb2QgfHwgJzEybSc7XG4gIGNvbnN0IGJzID0gYnV5ZXJTdGF0cyB8fCB7fTtcbiAgY29uc3Qgc3RhdHMgPSAvKiogQHR5cGUge2FueX0gKi8gKGJzKVsnc3RhdHNfJyArIHBdIHx8IHt9O1xuICBjb25zdCBtb250byA9IE51bWJlcihzdGF0cy5tb250b1RvdGFsKSB8fCAwO1xuICBjb25zdCBmYWN0dXJhcyA9IE51bWJlcihzdGF0cy5mYWN0dXJhc0NvdW50KSB8fCAwO1xuICBjb25zdCBwcm9tZWRpbyA9IE51bWJlcihzdGF0cy5tb250b1Byb21lZGlvKSB8fCAwO1xuICBjb25zdCBmcmVjID0gc3RhdHMuZnJlY3VlbmNpYURpYXM7XG4gIGNvbnN0IGZhY3hNZXMgPSBzdGF0cy5mYWN0dXJhc1Bvck1lcztcbiAgY29uc3QgZGlhcyA9IHN0YXRzLmRpYXNEZXNkZVVsdGltYTtcbiAgcmV0dXJuIHtcbiAgICAnTW9udG8gdG90YWwgKDEybSknOiBtb250byA+IDAgPyBNYXRoLnJvdW5kKG1vbnRvKSA6ICctJyxcbiAgICAnRmFjdHVyYXMgKDEybSknOiBmYWN0dXJhcyA+IDAgPyBmYWN0dXJhcyA6ICctJyxcbiAgICAnUHJvbWVkaW8gcG9yIGZhY3R1cmEgKDEybSknOiBwcm9tZWRpbyA+IDAgPyBNYXRoLnJvdW5kKHByb21lZGlvKSA6ICctJyxcbiAgICAnRnJlY3VlbmNpYSAoZFx1MDBFRGFzIGVudHJlIGNvbXByYXMpJzpcbiAgICAgIGZyZWMgIT0gbnVsbCAmJiBOdW1iZXIuaXNGaW5pdGUoTnVtYmVyKGZyZWMpKSA/IE1hdGgucm91bmQoTnVtYmVyKGZyZWMpKSA6ICctJyxcbiAgICAnRmFjdHVyYXMgcG9yIG1lcyAoMTJtKSc6XG4gICAgICBmYWN4TWVzICE9IG51bGwgJiYgTnVtYmVyLmlzRmluaXRlKE51bWJlcihmYWN4TWVzKSlcbiAgICAgICAgPyBNYXRoLnJvdW5kKE51bWJlcihmYWN4TWVzKSAqIDEwKSAvIDEwXG4gICAgICAgIDogJy0nLFxuICAgICdQcmltZXJhIGNvbXByYSc6IHN0YXRzLnByaW1lcmFDb21wcmEgfHwgJy0nLFxuICAgICdcdTAwREFsdGltYSBjb21wcmEnOiBzdGF0cy51bHRpbWFDb21wcmEgfHwgJy0nLFxuICAgICdEXHUwMEVEYXMgZGVzZGUgXHUwMEZBbHRpbWEgY29tcHJhJzpcbiAgICAgIGRpYXMgIT0gbnVsbCAmJiBOdW1iZXIuaXNGaW5pdGUoTnVtYmVyKGRpYXMpKSA/IE1hdGgucm91bmQoTnVtYmVyKGRpYXMpKSA6ICctJyxcbiAgfTtcbn1cblxuLyoqXG4gKiBSZWVtcGxhemEgY2FkYSBjZWxkYSB2YWNcdTAwRURhIChudWxsIC8gdW5kZWZpbmVkIC8gJycgLyAwIGN1YW5kbyBlbCBjYW1wb1xuICogcmVxdWllcmUgdmFsb3Igc2lnbmlmaWNhdGl2bykgcG9yIFwiLVwiLiBDZW50cmFsaXphIGxhIHJlZ2xhIGRlIE1hcmlhbm9cbiAqIFwibmluZ3VuYSBjZWxkYSBxdWVkYSB2YWNcdTAwRURhLCBlbiBuaW5ndW5hIGNvbHVtbmEsIGluY2x1aWRhcyBsYXMgcXVlIHlhXG4gKiBleGlzdGVuXCIuXG4gKlxuICogRXhjZXBjaVx1MDBGM246IGNhbXBvcyBudW1cdTAwRTlyaWNvcyBsaXN0YWRvcyBlbiBgbnVtZXJpY1plcm9Pa2AgY29uc2VydmFuIDAuXG4gKiBIb3kgbmluZ3Vubzsgc2UgZGVqYSBsYSBob29rIHBvciBzaSBlbiBlbCBmdXR1cm8gYXBhcmVjZSBcIlRvdGFsIHZpc2l0YXNcIi5cbiAqXG4gKiBAcGFyYW0ge2FueX0gcm93XG4gKiBAcGFyYW0ge1NldDxzdHJpbmc+fSBbbnVtZXJpY1plcm9Pa11cbiAqIEByZXR1cm5zIHtPYmplY3Q8c3RyaW5nLCBhbnk+fVxuICovXG5leHBvcnQgZnVuY3Rpb24gZmlsbERhc2hJbkVtcHR5KHJvdywgbnVtZXJpY1plcm9Paykge1xuICBjb25zdCBvayA9IG51bWVyaWNaZXJvT2sgaW5zdGFuY2VvZiBTZXQgPyBudW1lcmljWmVyb09rIDogbmV3IFNldCgpO1xuICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIGFueT59ICovXG4gIGNvbnN0IG91dCA9IHt9O1xuICBmb3IgKGNvbnN0IGsgb2YgT2JqZWN0LmtleXMocm93IHx8IHt9KSkge1xuICAgIGNvbnN0IHYgPSByb3dba107XG4gICAgaWYgKHYgPT09IG51bGwgfHwgdiA9PT0gdW5kZWZpbmVkIHx8IHYgPT09ICcnKSB7XG4gICAgICBvdXRba10gPSAnLSc7XG4gICAgfSBlbHNlIGlmICh2ID09PSAwICYmICFvay5oYXMoaykpIHtcbiAgICAgIG91dFtrXSA9ICctJztcbiAgICB9IGVsc2Uge1xuICAgICAgb3V0W2tdID0gdjtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIG91dDtcbn1cbiIsICIvLyBAdHMtbm9jaGVja1xuLy8gTk9UQTogQHRzLW5vY2hlY2sgaW50ZW5jaW9uYWwuIEVsIGNodW5rIGVzIGhlYXZ5IERPTSArIHdpbmRvdy4qIGhhbmRsZXJzICtcbi8vIEZpcmVzdG9yZSBTREsgY29tcGF0IHY4LiBBbm90YXIgc3RyaWN0YW1lbnRlIGNhZGEgaGFuZGxlciBzZXJcdTAwRURhIHJ1aWRvIHNpblxuLy8gdmFsb3IgXHUyMDE0IGxvcyBoZWxwZXJzIHB1cm9zIHF1ZSBpbXBvcnRhbW9zICguLi9wdXJlL2NhcnRlcmEtdmVuZG9yLWZpbHRlci5qcylcbi8vIHkgZWwgY29yZSAoZnVuY3Rpb25zL2NvcmUvY2FydGVyYS12ZW5kb3ItY29yZS5qcykgc1x1MDBFRCB0aWVuZW4gQHRzLWNoZWNrLlxuLyoqXG4gKiBjYXJ0ZXJhLXZlbmRvci5qcyAodjEyODMsIDIwMjYtMTAtMjApIFx1MjAxNCBidW5kbGUgY2h1bmsgbGF6eS5cbiAqXG4gKiBEYXNoYm9hcmQgXCJBbmFsaXNpcyBkZSBDYXJ0ZXJhIHBvciBWZW5kZWRvclwiLiBSZWVtcGxhemEgc2VndWltaWVudG8uanMuXG4gKiBMZWUgY2FydGVyYV92ZW5kb3Ive3ZlbmRvcktleX0gRmlyZXN0b3JlIChzbmFwc2hvdCBuaWdodGx5IDA0OjAwIEFSVCkuXG4gKlxuICogVE9ETyBlbCBET00gcmVuZGVyIHVzYSBjcmVhdGVFbGVtZW50ICsgdGV4dENvbnRlbnQgKHBvbGljeSBhbnRpLVhTUywgbm8gaW5uZXJIVE1MKS5cbiAqXG4gKiBTcGVjOiBkb2NzL3N1cGVycG93ZXJzL3NwZWNzLzIwMjYtMTAtMjAtY2FydGVyYS12ZW5kb3ItYW5hbGlzaXMtZGVzaWduLm1kXG4gKiBQbGFuOiBkb2NzL3N1cGVycG93ZXJzL3BsYW5zLzIwMjYtMTAtMjAtY2FydGVyYS12ZW5kb3ItYW5hbGlzaXMubWRcbiAqL1xuXG5pbXBvcnQgeyBhcHBseUNoaXBGaWx0ZXIsIHNvcnRDbGllbnRlcyB9IGZyb20gJy4uL3B1cmUvY2FydGVyYS12ZW5kb3ItZmlsdGVyLmpzJztcbi8vIHYxNDgyIFx1MDBBNzgyICgyMDI2LTEwLTI3KTogZnVlbnRlIFx1MDBGQW5pY2EgZGUgbGFiZWxzIEZpY2hhIENsaWVudGUuIExhIGNvbHVtbmFcbi8vIFRJUE8gYW50ZXMgbW9zdHJhYmEgZWwgY1x1MDBGM2RpZ28gKFwiQlwiKSBlbiB2ZXogZGVsIGxhYmVsIGxlZ2libGUgKFwiQiAtIHNpblxuLy8gZGVzY3VlbnRvXCIpIFx1MjAxNCBwZW5kaWVudGUgY29ub2NpZG8gcHJlLXYxNDgyLiBSZXVzYW1vcyBsYSBwdXJlIGZuIHF1ZSB5YVxuLy8gY29uc3VtZSBNYXN0ZXJmaWxlIGV4cG9ydCBwYXJhIG5vIGR1cGxpY2FyIGVsIG1hcGVvLlxuaW1wb3J0IHsgbGFiZWxGb3JGaWNoYUZpZWxkIH0gZnJvbSAnLi4vcHVyZS9maWNoYS1jbGllbnRlLWxhYmVscy5qcyc7XG5cbi8qKiBAdHlwZSB7TWFwPHN0cmluZywgYW55Pn0gKi9cbmNvbnN0IGNhcnRlcmFEb2NDYWNoZSA9IG5ldyBNYXAoKTtcbi8qKiBAdHlwZSB7c3RyaW5nfG51bGx9ICovXG5sZXQgc2VsZWN0ZWRWZW5kb3IgPSBudWxsO1xubGV0IGFjdGl2ZUNoaXAgPSAndG9kb3MnO1xubGV0IHNlYXJjaFF1ZXJ5ID0gJyc7XG5sZXQgc29ydEJ5ID0gJ2RpYXNTaW5Db21wcmEnO1xuLyoqIEB0eXBlIHsnYXNjJ3wnZGVzYyd9ICovXG5sZXQgc29ydERpciA9ICdkZXNjJztcblxuY29uc3QgQ0hJUFMgPSBbXG4gIHsgaWQ6ICd0b2RvcycsIGxhYmVsOiAnVG9kb3MnIH0sXG4gIHsgaWQ6ICdiYXNlQWN0aXZhOTBkJywgbGFiZWw6ICdCYXNlIGFjdGl2YSA5MGQnIH0sXG4gIHsgaWQ6ICdkb3JtaWRvc1Zpc2l0YTMwZCcsIGxhYmVsOiAnRG9ybWlkb3MgdmlzaXRhIDMwZCcgfSxcbiAgeyBpZDogJ2Rvcm1pZG9zQ29tcHJhOTBkJywgbGFiZWw6ICdEb3JtaWRvcyBjb21wcmEgOTBkJyB9LFxuICB7IGlkOiAnbnVuY2FWaXNpdGFkb3MnLCBsYWJlbDogJ051bmNhIHZpc2l0YWRvcycgfSxcbiAgeyBpZDogJ251bmNhQ29tcHJhcm9uJywgbGFiZWw6ICdOdW5jYSBjb21wcmFyb24nIH0sXG5dO1xuXG5jb25zdCBLUElfQ0FSRFMgPSBbXG4gIHsgY2hpcDogJ3RvZG9zJywgbGFiZWw6ICdUb3RhbCBjYXJ0ZXJhJywgY29sb3I6ICcjNjQ3NDhiJyB9LFxuICB7IGNoaXA6ICdiYXNlQWN0aXZhOTBkJywgbGFiZWw6ICdCYXNlIGFjdGl2YSA5MGQnLCBjb2xvcjogJyMxNmEzNGEnIH0sXG4gIHsgY2hpcDogJ2Rvcm1pZG9zVmlzaXRhMzBkJywgbGFiZWw6ICdEb3JtaWRvcyB2aXMgMzBkJywgY29sb3I6ICcjZWE1ODBjJyB9LFxuICB7IGNoaXA6ICdkb3JtaWRvc0NvbXByYTkwZCcsIGxhYmVsOiAnRG9ybWlkb3MgY29tIDkwZCcsIGNvbG9yOiAnI2RjMjYyNicgfSxcbiAgeyBjaGlwOiAnbnVuY2FWaXNpdGFkb3MnLCBsYWJlbDogJ051bmNhIHZpc2l0YWRvcycsIGNvbG9yOiAnIzdjM2FlZCcgfSxcbiAgeyBjaGlwOiAnbnVuY2FDb21wcmFyb24nLCBsYWJlbDogJ051bmNhIGNvbXByYXJvbicsIGNvbG9yOiAnI2JlMTg1ZCcgfSxcbl07XG5cbi8vIHYxMzg0ICgyMDI2LTEwLTIxKTogd2hpdGVsaXN0IGRlIGxvcyA2IFZERSByZWFsZXMgb3BlcmF0aXZvcyAocGVkaWRvIE1hcmlhbm8pLlxuLy8gRmlsdHJhIGVsIGRyb3Bkb3duIHBhcmEgZXhjbHVpciBydWlkbyBlbiBjbGllbnRfYXBwbGljYXRpb25zLmFzc2lnbmVkVmVuZG9yOlxuLy8gJ0FETUlOX0xET09HMkY0TVdWTVhLUU9EOFlDQk9JUlUyTzInIChhZG1pbiB1aWQgcXVlIHF1ZWRvIGNvbW8gc3RyaW5nIHZlbmRvciksXG4vLyAnRU1QTEVBRE8nIChhbHRhcyBpbnRlcm5hcyksICdESUVHTyBWQUxTSScgKGV4LVZERSBjb24gMSBjbGllbnRlIGhpc3RvcmljbykuXG4vLyBTaSBlbiBlbCBmdXR1cm8gc2UgaW5jb3Jwb3JhIHVuIG51ZXZvIFZERSwgYWdyZWdhcmxvIGFxdWkgKyB2ZXJpZmljYXIgcXVlIGxhXG4vLyB2aXN0YSBCUSB2X2NhcnRlcmFfdmVuZG9yIGxvIGNhbm9uaWNhbGl6ZSBpZ3VhbCAodmVyIGJpZ3F1ZXJ5L3ZpZXdzLnNxbDozNDgwKS5cbmNvbnN0IFZFTkRPUlNfV0hJVEVMSVNUID0gbmV3IFNldChbXG4gICdGRURFUklDTyBDQVNURUxBTkVMTEknLFxuICAnR09OWkFMTyBERSBMQSBST1NBJyxcbiAgJ0lPQU5OSVMgUEFMS09VREFLSVMnLFxuICAnTUFVUklDSU8gR0lMJyxcbiAgJ1BBQ0hJJyxcbiAgJ1NBTlRJQUdPIEVTVEVCQU4nLFxuXSk7XG5cbi8vID09PSBPcGVuIC8gY2xvc2UgPT09XG53aW5kb3cub3BlbkNhcnRlcmFNb2RhbCA9IGFzeW5jIGZ1bmN0aW9uIG9wZW5DYXJ0ZXJhTW9kYWwoKSB7XG4gIGNvbnN0IG1vZGFsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2NhcnRlcmEtbW9kYWwnKTtcbiAgaWYgKCFtb2RhbCkgcmV0dXJuO1xuICBtb2RhbC5jbGFzc0xpc3QuYWRkKCdvcGVuJyk7XG4gIGF3YWl0IHBvcHVsYXRlVmVuZG9yRHJvcGRvd24oKTtcbn07XG5cbndpbmRvdy5jbG9zZUNhcnRlcmFNb2RhbCA9IGZ1bmN0aW9uIGNsb3NlQ2FydGVyYU1vZGFsKCkge1xuICBjb25zdCBtb2RhbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdjYXJ0ZXJhLW1vZGFsJyk7XG4gIGlmIChtb2RhbCkgbW9kYWwuY2xhc3NMaXN0LnJlbW92ZSgnb3BlbicpO1xufTtcblxuLy8gPT09IERyb3Bkb3duIGRlIHZlbmRvcnMgPT09XG4vLyB2MTU1NiAoMjAyNi0xMS0xNik6IGZpbHRybyBwb3Igcm9sIGRlbCB1c2VyIGFjdHVhbC5cbi8vIC0gYWRtaW4vZ2VyZW50ZS92aWV3ZXI6IGxpc3RhIGNvbXBsZXRhIChsb3MgNiBWREVzIHdoaXRlbGlzdCkuXG4vLyAtIGludGVybm86IGZhbGxiYWNrIGEgbGlzdGFyIHRvZG9zIChlbCBzZXJ2ZXIgcmVjaGF6YXJhIHZlbmRvcnMgZnVlcmEgZGUgcGFyZWphcyxcbi8vICAgcGVybyBlbCBkcm9wZG93biBtdWVzdHJhIHRvZG8gcGFyYSBwcmVzZXJ2YXIgZWwgY29tcG9ydGFtaWVudG8gaGlzdG9yaWNvKS5cbi8vIC0gdmVuZGVkb3I6IFNPTE8gc3UgcHJvcGlvIGFzc2lnbmVkVmVuZG9yLCBhdXRvLXNlbGVjY2lvbmFkbyArIGJsb3F1ZWFkby5cbi8vIFBhdHJvbiBcdTAwQTc0NC9cdTAwQTc0Ni9cdTAwQTc1OTogY2FkYSBWREUgdmUgU1VTIGNsaWVudGVzLCBudW5jYSBjcm9zcy12ZW5kb3IuXG5hc3luYyBmdW5jdGlvbiBwb3B1bGF0ZVZlbmRvckRyb3Bkb3duKCkge1xuICBjb25zdCBzZWwgPSAvKiogQHR5cGUge0hUTUxTZWxlY3RFbGVtZW50fG51bGx9ICovIChcbiAgICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY2FydGVyYS12ZW5kb3Itc2VsZWN0JylcbiAgKTtcbiAgaWYgKCFzZWwpIHJldHVybjtcbiAgaWYgKHNlbC5vcHRpb25zLmxlbmd0aCA+IDEpIHJldHVybjtcblxuICAvLyBSZXNvbHZlbW9zIGVsIHJvbCArIGFzc2lnbmVkVmVuZG9yIGRlbCB3aW5kb3cgKHNldGVhZG9zIHBvciBhcHBseVJvbGVWaXNpYmlsaXR5KS5cbiAgY29uc3QgdXNlclJvbGUgPSB0eXBlb2Ygd2luZG93ICE9PSAndW5kZWZpbmVkJyA/IHdpbmRvdy51c2VyUm9sZSA6IG51bGw7XG4gIGNvbnN0IGFzc2lnbmVkVmVuZG9yID0gdHlwZW9mIHdpbmRvdyAhPT0gJ3VuZGVmaW5lZCcgPyB3aW5kb3cuYXNzaWduZWRWZW5kb3IgOiBudWxsO1xuXG4gIC8vIENhc28gVkRFOiBmb3J6YXIgZWwgZHJvcGRvd24gYSBVTiBzb2xvIHZlbmRvciArIGJsb3F1ZWFyLlxuICBpZiAodXNlclJvbGUgPT09ICd2ZW5kZWRvcicpIHtcbiAgICBpZiAoIWFzc2lnbmVkVmVuZG9yIHx8ICFWRU5ET1JTX1dISVRFTElTVC5oYXMoYXNzaWduZWRWZW5kb3IpKSB7XG4gICAgICAvLyBTaW4gdmVuZG9yIGNhbm9uaWNvIG8gZnVlcmEgZGUgd2hpdGVsaXN0OiBubyBtb3N0cmFyIG9wY2lvbmVzIChmYWlsLXNhZmUpLlxuICAgICAgc2VsLmRpc2FibGVkID0gdHJ1ZTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgY29uc3Qgb3B0ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnb3B0aW9uJyk7XG4gICAgb3B0LnZhbHVlID0gYXNzaWduZWRWZW5kb3I7XG4gICAgb3B0LnRleHRDb250ZW50ID0gYXNzaWduZWRWZW5kb3I7XG4gICAgc2VsLmFwcGVuZENoaWxkKG9wdCk7XG4gICAgc2VsLnZhbHVlID0gYXNzaWduZWRWZW5kb3I7XG4gICAgc2VsLmRpc2FibGVkID0gdHJ1ZTtcbiAgICAvLyBEaXNwYXJhciBlbCBjaGFuZ2UgdW5hIHZleiBwYXJhIGNhcmdhciBlbCBkYXNoYm9hcmQgZGlyZWN0by5cbiAgICBpZiAodHlwZW9mIHdpbmRvdy5vbkNhcnRlcmFWZW5kb3JDaGFuZ2UgPT09ICdmdW5jdGlvbicpIHtcbiAgICAgIC8vIHNldFRpbWVvdXQgcGFyYSBxdWUgZWwgRE9NIGRlbCBtb2RhbCB0ZXJtaW5lIGRlIG1vbnRhcnNlIGFudGVzIGRlbCBmZXRjaC5cbiAgICAgIHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgICB0cnkge1xuICAgICAgICAgIHdpbmRvdy5vbkNhcnRlcmFWZW5kb3JDaGFuZ2UoKTtcbiAgICAgICAgfSBjYXRjaCAoX2UpIHtcbiAgICAgICAgICAvKiBpZ25vcmUgKi9cbiAgICAgICAgfVxuICAgICAgfSwgMCk7XG4gICAgfVxuICAgIHJldHVybjtcbiAgfVxuXG4gIC8vIEFkbWluL2dlcmVudGUvaW50ZXJuby92aWV3ZXI6IGNvbXBvcnRhbWllbnRvIGhpc3RvcmljbyAobGlzdGEgY29tcGxldGEpLlxuICB0cnkge1xuICAgIC8vIEB0cy1leHBlY3QtZXJyb3JcbiAgICBjb25zdCBzbmFwID0gYXdhaXQgZmlyZWJhc2UuZmlyZXN0b3JlKCkuY29sbGVjdGlvbignY2FydGVyYV92ZW5kb3InKS5nZXQoKTtcbiAgICAvKiogQHR5cGUge3N0cmluZ1tdfSAqL1xuICAgIGNvbnN0IHZlbmRvcnMgPSBbXTtcbiAgICBzbmFwLmZvckVhY2goKGRvYykgPT4ge1xuICAgICAgLy8gdjEzODQ6IHNvbG8gVkRFIHdoaXRlbGlzdC4gUmVzdG8gKGFkbWluIHVpZCwgRU1QTEVBRE8sIGV4LVZERSkgc2Ugb2N1bHRhbi5cbiAgICAgIGlmIChWRU5ET1JTX1dISVRFTElTVC5oYXMoZG9jLmlkKSkgdmVuZG9ycy5wdXNoKGRvYy5pZCk7XG4gICAgfSk7XG4gICAgdmVuZG9ycy5zb3J0KCk7XG4gICAgZm9yIChjb25zdCB2IG9mIHZlbmRvcnMpIHtcbiAgICAgIGNvbnN0IG9wdCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ29wdGlvbicpO1xuICAgICAgb3B0LnZhbHVlID0gdjtcbiAgICAgIG9wdC50ZXh0Q29udGVudCA9IHY7XG4gICAgICBzZWwuYXBwZW5kQ2hpbGQob3B0KTtcbiAgICB9XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBjb25zb2xlLmVycm9yKCdwb3B1bGF0ZVZlbmRvckRyb3Bkb3duIGZhaWxlZCcsIGUpO1xuICB9XG59XG5cbi8vID09PSBPbiB2ZW5kb3IgY2hhbmdlID09PVxud2luZG93Lm9uQ2FydGVyYVZlbmRvckNoYW5nZSA9IGFzeW5jIGZ1bmN0aW9uIG9uQ2FydGVyYVZlbmRvckNoYW5nZSgpIHtcbiAgY29uc3Qgc2VsID0gLyoqIEB0eXBlIHtIVE1MU2VsZWN0RWxlbWVudHxudWxsfSAqLyAoXG4gICAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2NhcnRlcmEtdmVuZG9yLXNlbGVjdCcpXG4gICk7XG4gIGlmICghc2VsKSByZXR1cm47XG4gIHNlbGVjdGVkVmVuZG9yID0gc2VsLnZhbHVlIHx8IG51bGw7XG4gIGFjdGl2ZUNoaXAgPSAndG9kb3MnO1xuICBzZWFyY2hRdWVyeSA9ICcnO1xuICBjb25zdCBzZWFyY2hJbnB1dCA9IC8qKiBAdHlwZSB7SFRNTElucHV0RWxlbWVudHxudWxsfSAqLyAoXG4gICAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2NhcnRlcmEtc2VhcmNoJylcbiAgKTtcbiAgaWYgKHNlYXJjaElucHV0KSBzZWFyY2hJbnB1dC52YWx1ZSA9ICcnO1xuICBpZiAoIXNlbGVjdGVkVmVuZG9yKSB7XG4gICAgc2hvd0VtcHR5KCk7XG4gICAgcmV0dXJuO1xuICB9XG4gIHNob3dMb2FkaW5nKCk7XG4gIHRyeSB7XG4gICAgbGV0IGRvYyA9IGNhcnRlcmFEb2NDYWNoZS5nZXQoc2VsZWN0ZWRWZW5kb3IpO1xuICAgIGlmICghZG9jKSB7XG4gICAgICAvLyBAdHMtZXhwZWN0LWVycm9yXG4gICAgICBjb25zdCBzbmFwID0gYXdhaXQgZmlyZWJhc2VcbiAgICAgICAgLmZpcmVzdG9yZSgpXG4gICAgICAgIC5jb2xsZWN0aW9uKCdjYXJ0ZXJhX3ZlbmRvcicpXG4gICAgICAgIC5kb2Moc2VsZWN0ZWRWZW5kb3IpXG4gICAgICAgIC5nZXQoKTtcbiAgICAgIGlmICghc25hcC5leGlzdHMpIHtcbiAgICAgICAgc2hvd05vRGF0YSgpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICBkb2MgPSBzbmFwLmRhdGEoKTtcbiAgICAgIGNhcnRlcmFEb2NDYWNoZS5zZXQoc2VsZWN0ZWRWZW5kb3IsIGRvYyk7XG4gICAgfVxuICAgIHJlbmRlckRhc2hib2FyZChkb2MpO1xuICB9IGNhdGNoIChlKSB7XG4gICAgY29uc29sZS5lcnJvcignb25DYXJ0ZXJhVmVuZG9yQ2hhbmdlIGZhaWxlZCcsIGUpO1xuICAgIHNob3dFcnJvcihTdHJpbmcoZSkpO1xuICB9XG59O1xuXG4vKiogQHR5cGUge2FueX0gKi8gKHdpbmRvdykub25DYXJ0ZXJhQ2hpcENsaWNrID0gZnVuY3Rpb24gb25DYXJ0ZXJhQ2hpcENsaWNrKGNoaXBJZCkge1xuICBhY3RpdmVDaGlwID0gY2hpcElkO1xuICBpZiAoIXNlbGVjdGVkVmVuZG9yKSByZXR1cm47XG4gIGNvbnN0IGRvYyA9IGNhcnRlcmFEb2NDYWNoZS5nZXQoc2VsZWN0ZWRWZW5kb3IpO1xuICBpZiAoZG9jKSByZW5kZXJEYXNoYm9hcmQoZG9jKTtcbn07XG5cbi8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2Ygc2V0VGltZW91dD58bnVsbH0gKi9cbmxldCBzZWFyY2hEZWJvdW5jZVRpbWVyID0gbnVsbDtcbndpbmRvdy5vbkNhcnRlcmFTZWFyY2hDaGFuZ2UgPSBmdW5jdGlvbiBvbkNhcnRlcmFTZWFyY2hDaGFuZ2UoKSB7XG4gIGNvbnN0IGlucHV0ID0gLyoqIEB0eXBlIHtIVE1MSW5wdXRFbGVtZW50fG51bGx9ICovIChkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY2FydGVyYS1zZWFyY2gnKSk7XG4gIGlmICghaW5wdXQpIHJldHVybjtcbiAgaWYgKHNlYXJjaERlYm91bmNlVGltZXIpIGNsZWFyVGltZW91dChzZWFyY2hEZWJvdW5jZVRpbWVyKTtcbiAgc2VhcmNoRGVib3VuY2VUaW1lciA9IHNldFRpbWVvdXQoKCkgPT4ge1xuICAgIHNlYXJjaFF1ZXJ5ID0gKGlucHV0LnZhbHVlIHx8ICcnKS50cmltKCkudG9Mb3dlckNhc2UoKTtcbiAgICBpZiAoIXNlbGVjdGVkVmVuZG9yKSByZXR1cm47XG4gICAgY29uc3QgZG9jID0gY2FydGVyYURvY0NhY2hlLmdldChzZWxlY3RlZFZlbmRvcik7XG4gICAgaWYgKGRvYykgcmVuZGVyRGFzaGJvYXJkKGRvYyk7XG4gIH0sIDMwMCk7XG59O1xuXG4vKiogQHR5cGUge2FueX0gKi8gKHdpbmRvdykub25DYXJ0ZXJhU29ydENsaWNrID0gZnVuY3Rpb24gb25DYXJ0ZXJhU29ydENsaWNrKGNvbEtleSkge1xuICBpZiAoc29ydEJ5ID09PSBjb2xLZXkpIHNvcnREaXIgPSBzb3J0RGlyID09PSAnYXNjJyA/ICdkZXNjJyA6ICdhc2MnO1xuICBlbHNlIHtcbiAgICBzb3J0QnkgPSBjb2xLZXk7XG4gICAgc29ydERpciA9ICdkZXNjJztcbiAgfVxuICBpZiAoIXNlbGVjdGVkVmVuZG9yKSByZXR1cm47XG4gIGNvbnN0IGRvYyA9IGNhcnRlcmFEb2NDYWNoZS5nZXQoc2VsZWN0ZWRWZW5kb3IpO1xuICBpZiAoZG9jKSByZW5kZXJEYXNoYm9hcmQoZG9jKTtcbn07XG5cbi8vID09PSBSZW5kZXIgPT09XG5mdW5jdGlvbiByZW5kZXJEYXNoYm9hcmQoZG9jKSB7XG4gIGNvbnN0IHN1YnRpdGxlID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2NhcnRlcmEtc3VidGl0bGUnKTtcbiAgaWYgKHN1YnRpdGxlKSBzdWJ0aXRsZS50ZXh0Q29udGVudCA9IGAke2RvYy5jb3VudHMudG90YWx9IGNsaWVudGVzIGVuIGNhcnRlcmEuYDtcbiAgY29uc3QgaW5mbyA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdjYXJ0ZXJhLXNuYXBzaG90LWluZm8nKTtcbiAgaWYgKGluZm8pIHtcbiAgICBpbmZvLnRleHRDb250ZW50ID0gYFNuYXBzaG90ICR7ZG9jLnNuYXBzaG90RGF0ZX1gO1xuICAgIGluZm8uc3R5bGUuZGlzcGxheSA9ICdpbmxpbmUtZmxleCc7XG4gIH1cbiAgcmVuZGVyS3Bpcyhkb2MuY291bnRzKTtcbiAgcmVuZGVyQ2hpcHMoZG9jLmNvdW50cyk7XG4gIHJlbmRlclRhYmxlKGRvYy5jbGllbnRlcyk7XG4gIHNob3dUYWJsZSgpO1xufVxuXG5mdW5jdGlvbiByZW5kZXJLcGlzKGNvdW50cykge1xuICBjb25zdCBlbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdjYXJ0ZXJhLWtwaXMnKTtcbiAgaWYgKCFlbCkgcmV0dXJuO1xuICB3aGlsZSAoZWwuZmlyc3RDaGlsZCkgZWwucmVtb3ZlQ2hpbGQoZWwuZmlyc3RDaGlsZCk7XG4gIC8vIHYxMzgzOiBBcHBsZS1zdHlsZSBLUEkgY2FyZHMuIENsYXNlcyAuY2FydGVyYS1rcGkgZGVmaW5pZGFzIGVuIGluZGV4Lmh0bWwuXG4gIC8vIENvbG9yIHNlIGFwbGljYSBzb2xvIGFsIG5cdTAwRkFtZXJvICsgdW5kZXJsaW5lIChzdXRpbCBpZGVudGlkYWQgcG9yIGNhdGVnb3JcdTAwRURhKS5cbiAgZm9yIChjb25zdCBzcGVjIG9mIEtQSV9DQVJEUykge1xuICAgIGNvbnN0IGNhcmQgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKTtcbiAgICBjYXJkLmNsYXNzTmFtZSA9ICdjYXJ0ZXJhLWtwaSc7XG4gICAgaWYgKGFjdGl2ZUNoaXAgPT09IHNwZWMuY2hpcCkgY2FyZC5jbGFzc0xpc3QuYWRkKCdhY3RpdmUnKTtcbiAgICBjYXJkLnN0eWxlLmNvbG9yID0gc3BlYy5jb2xvcjsgLy8gY3VycmVudENvbG9yIHBhcmEgZWwgbnVtYmVyICsgOjphZnRlciB1bmRlcmxpbmVcbiAgICBjYXJkLmFkZEV2ZW50TGlzdGVuZXIoJ2NsaWNrJywgKCkgPT4gLyoqIEB0eXBlIHthbnl9ICovICh3aW5kb3cpLm9uQ2FydGVyYUNoaXBDbGljayhzcGVjLmNoaXApKTtcbiAgICBjb25zdCBuID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2Jyk7XG4gICAgbi5jbGFzc05hbWUgPSAnY2FydGVyYS1rcGktbnVtJztcbiAgICBuLnRleHRDb250ZW50ID0gU3RyaW5nKGNvdW50c1tzcGVjLmNoaXAgPT09ICd0b2RvcycgPyAndG90YWwnIDogc3BlYy5jaGlwXSk7XG4gICAgY29uc3QgbCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpO1xuICAgIGwuY2xhc3NOYW1lID0gJ2NhcnRlcmEta3BpLWxhYmVsJztcbiAgICBsLnN0eWxlLmNvbG9yID0gJyc7IC8vIHJlc2V0IGN1cnJlbnRDb2xvciBwYXJhIHF1ZSB1c2UgZWwgbXV0ZWQgZGVsIENTU1xuICAgIGwudGV4dENvbnRlbnQgPSBzcGVjLmxhYmVsO1xuICAgIGNhcmQuYXBwZW5kQ2hpbGQobik7XG4gICAgY2FyZC5hcHBlbmRDaGlsZChsKTtcbiAgICBlbC5hcHBlbmRDaGlsZChjYXJkKTtcbiAgfVxufVxuXG5mdW5jdGlvbiByZW5kZXJDaGlwcyhjb3VudHMpIHtcbiAgY29uc3QgZWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY2FydGVyYS1jaGlwcycpO1xuICBpZiAoIWVsKSByZXR1cm47XG4gIGNvbnN0IGNvdW50QnlDaGlwID0ge1xuICAgIHRvZG9zOiBjb3VudHMudG90YWwsXG4gICAgYmFzZUFjdGl2YTkwZDogY291bnRzLmJhc2VBY3RpdmE5MGQsXG4gICAgZG9ybWlkb3NWaXNpdGEzMGQ6IGNvdW50cy5kb3JtaWRvc1Zpc2l0YTMwZCxcbiAgICBkb3JtaWRvc0NvbXByYTkwZDogY291bnRzLmRvcm1pZG9zQ29tcHJhOTBkLFxuICAgIG51bmNhVmlzaXRhZG9zOiBjb3VudHMubnVuY2FWaXNpdGFkb3MsXG4gICAgbnVuY2FDb21wcmFyb246IGNvdW50cy5udW5jYUNvbXByYXJvbixcbiAgfTtcbiAgd2hpbGUgKGVsLmZpcnN0Q2hpbGQpIGVsLnJlbW92ZUNoaWxkKGVsLmZpcnN0Q2hpbGQpO1xuICAvLyB2MTM4Mzogc2VnbWVudGVkIGNvbnRyb2wgaU9TLiBXcmFwcGVyIC5jYXJ0ZXJhLWNoaXAtd3JhcCBhZ3J1cGEgcGlsbHMgY29uIGJnIGdyaXMuXG4gIGNvbnN0IHdyYXAgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKTtcbiAgd3JhcC5jbGFzc05hbWUgPSAnY2FydGVyYS1jaGlwLXdyYXAnO1xuICBmb3IgKGNvbnN0IGNoaXAgb2YgQ0hJUFMpIHtcbiAgICBjb25zdCBiID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnYnV0dG9uJyk7XG4gICAgYi5jbGFzc05hbWUgPSAnY2FydGVyYS1jaGlwJztcbiAgICBpZiAoYWN0aXZlQ2hpcCA9PT0gY2hpcC5pZCkgYi5jbGFzc0xpc3QuYWRkKCdhY3RpdmUnKTtcbiAgICBiLnR5cGUgPSAnYnV0dG9uJztcbiAgICBiLnRleHRDb250ZW50ID0gYCR7Y2hpcC5sYWJlbH0gKCR7Y291bnRCeUNoaXBbY2hpcC5pZF19KWA7XG4gICAgYi5hZGRFdmVudExpc3RlbmVyKCdjbGljaycsICgpID0+IC8qKiBAdHlwZSB7YW55fSAqLyAod2luZG93KS5vbkNhcnRlcmFDaGlwQ2xpY2soY2hpcC5pZCkpO1xuICAgIHdyYXAuYXBwZW5kQ2hpbGQoYik7XG4gIH1cbiAgZWwuYXBwZW5kQ2hpbGQod3JhcCk7XG59XG5cbi8qKiBAcGFyYW0ge0FycmF5PGFueT59IGNsaWVudGVzICovXG5mdW5jdGlvbiByZW5kZXJUYWJsZShjbGllbnRlcykge1xuICBjb25zdCB0YWJsZSA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdjYXJ0ZXJhLXRhYmxlJyk7XG4gIGlmICghdGFibGUpIHJldHVybjtcbiAgY29uc3QgZmlsdGVyZWQgPSBhcHBseUNoaXBGaWx0ZXIoY2xpZW50ZXMsIGFjdGl2ZUNoaXApO1xuICBjb25zdCBzZWFyY2hlZCA9IHNlYXJjaFF1ZXJ5XG4gICAgPyBmaWx0ZXJlZC5maWx0ZXIoKGMpID0+XG4gICAgICAgIFN0cmluZyhjLmNsaWVudE5hbWUgfHwgJycpXG4gICAgICAgICAgLnRvTG93ZXJDYXNlKClcbiAgICAgICAgICAuaW5jbHVkZXMoc2VhcmNoUXVlcnkpXG4gICAgICApXG4gICAgOiBmaWx0ZXJlZDtcbiAgY29uc3Qgc29ydGVkID0gc29ydENsaWVudGVzKHNlYXJjaGVkLCBzb3J0QnksIHNvcnREaXIpO1xuICB3aGlsZSAodGFibGUuZmlyc3RDaGlsZCkgdGFibGUucmVtb3ZlQ2hpbGQodGFibGUuZmlyc3RDaGlsZCk7XG4gIHRhYmxlLmFwcGVuZENoaWxkKGJ1aWxkVGhlYWQoKSk7XG4gIHRhYmxlLmFwcGVuZENoaWxkKGJ1aWxkVGJvZHkoc29ydGVkKSk7XG59XG5cbmZ1bmN0aW9uIGJ1aWxkVGhlYWQoKSB7XG4gIC8vIHYxMzgzOiBBcHBsZS1zdHlsZSB0aGVhZC4gQ2xhc2VzIC5jYXJ0ZXJhLSogZW4gaW5kZXguaHRtbCBjb250cm9sYW4gYmcvY29sb3JzLlxuICBjb25zdCB0aGVhZCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3RoZWFkJyk7XG4gIGNvbnN0IHRyID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgndHInKTtcbiAgY29uc3QgaGVhZGVycyA9IFtcbiAgICB7IGxhYmVsOiAnQ2xpZW50ZScsIHNvcnRLZXk6ICdjbGllbnROYW1lJywgYWxpZ246ICdsZWZ0JyB9LFxuICAgIHsgbGFiZWw6ICdQcm92L0xvYycsIHNvcnRLZXk6IG51bGwsIGFsaWduOiAnbGVmdCcgfSxcbiAgICB7IGxhYmVsOiAnVGlwbycsIHNvcnRLZXk6IG51bGwsIGFsaWduOiAnY2VudGVyJyB9LFxuICAgIHsgbGFiZWw6ICdcdTAwREFsdC4gdmlzaXRhJywgc29ydEtleTogJ2RpYXNTaW5WaXNpdGFQcmVzZW5jaWFsJywgYWxpZ246ICdsZWZ0JyB9LFxuICAgIHsgbGFiZWw6ICdcdTAwREFsdC4gY29udGFjdG8nLCBzb3J0S2V5OiAnZGlhc1NpbkNvbnRhY3RvJywgYWxpZ246ICdsZWZ0JyB9LFxuICAgIHsgbGFiZWw6ICdcdTAwREFsdC4gY29tcHJhJywgc29ydEtleTogJ2RpYXNTaW5Db21wcmEnLCBhbGlnbjogJ2xlZnQnIH0sXG4gICAgeyBsYWJlbDogJ0ZhY3QgMTJNJywgc29ydEtleTogJ2ZhY3R1cmFkbzEyTScsIGFsaWduOiAncmlnaHQnIH0sXG4gICAgeyBsYWJlbDogJ0RldWRhJywgc29ydEtleTogJ2RldWRhQWJpZXJ0YScsIGFsaWduOiAncmlnaHQnIH0sXG4gIF07XG4gIGZvciAoY29uc3QgaCBvZiBoZWFkZXJzKSB7XG4gICAgY29uc3QgdGggPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCd0aCcpO1xuICAgIHRoLnN0eWxlLnRleHRBbGlnbiA9IGguYWxpZ247XG4gICAgdGgudGV4dENvbnRlbnQgPSBoLmxhYmVsO1xuICAgIGlmIChoLnNvcnRLZXkpIHtcbiAgICAgIHRoLnN0eWxlLmN1cnNvciA9ICdwb2ludGVyJztcbiAgICAgIGNvbnN0IGtleSA9IGguc29ydEtleTtcbiAgICAgIHRoLmFkZEV2ZW50TGlzdGVuZXIoJ2NsaWNrJywgKCkgPT4gLyoqIEB0eXBlIHthbnl9ICovICh3aW5kb3cpLm9uQ2FydGVyYVNvcnRDbGljayhrZXkpKTtcbiAgICB9XG4gICAgdHIuYXBwZW5kQ2hpbGQodGgpO1xuICB9XG4gIHRoZWFkLmFwcGVuZENoaWxkKHRyKTtcbiAgcmV0dXJuIHRoZWFkO1xufVxuXG4vKiogQHBhcmFtIHtBcnJheTxhbnk+fSBzb3J0ZWRDbGllbnRlcyAqL1xuZnVuY3Rpb24gYnVpbGRUYm9keShzb3J0ZWRDbGllbnRlcykge1xuICBjb25zdCB0Ym9keSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3Rib2R5Jyk7XG4gIGZvciAoY29uc3QgYyBvZiBzb3J0ZWRDbGllbnRlcykge1xuICAgIHRib2R5LmFwcGVuZENoaWxkKGJ1aWxkQ2xpZW50ZVJvdyhjKSk7XG4gIH1cbiAgcmV0dXJuIHRib2R5O1xufVxuXG4vKiogQHBhcmFtIHthbnl9IGMgKi9cbmZ1bmN0aW9uIGJ1aWxkQ2xpZW50ZVJvdyhjKSB7XG4gIGNvbnN0IHRyID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgndHInKTtcbiAgdHIuc3R5bGUuY3NzVGV4dCA9ICdjdXJzb3I6cG9pbnRlcjtib3JkZXItYm90dG9tOjFweCBzb2xpZCB2YXIoLS1ib3JkZXItbGlnaHQpJztcbiAgdHIuYWRkRXZlbnRMaXN0ZW5lcignbW91c2VlbnRlcicsICgpID0+IHtcbiAgICB0ci5zdHlsZS5iYWNrZ3JvdW5kID0gJ3ZhcigtLWJnLWhvdmVyKSc7XG4gIH0pO1xuICB0ci5hZGRFdmVudExpc3RlbmVyKCdtb3VzZWxlYXZlJywgKCkgPT4ge1xuICAgIHRyLnN0eWxlLmJhY2tncm91bmQgPSAnJztcbiAgfSk7XG4gIHRyLmFkZEV2ZW50TGlzdGVuZXIoJ2NsaWNrJywgKCkgPT4ge1xuICAgIC8vIEB0cy1leHBlY3QtZXJyb3JcbiAgICBpZiAodHlwZW9mIHdpbmRvdy5vcGVuRmljaGFDbGllbnRlID09PSAnZnVuY3Rpb24nKSB3aW5kb3cub3BlbkZpY2hhQ2xpZW50ZShjLmNsaWVudElkKTtcbiAgfSk7XG5cbiAgY29uc3QgdGROYW1lID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgndGQnKTtcbiAgdGROYW1lLnN0eWxlLmNzc1RleHQgPSAncGFkZGluZzo2cHggOHB4O2ZvbnQtd2VpZ2h0OjYwMCc7XG4gIHRkTmFtZS50ZXh0Q29udGVudCA9IGMuY2xpZW50TmFtZSB8fCAnJztcbiAgdHIuYXBwZW5kQ2hpbGQodGROYW1lKTtcblxuICBjb25zdCB0ZExvYyA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3RkJyk7XG4gIHRkTG9jLnN0eWxlLmNzc1RleHQgPSAncGFkZGluZzo2cHggOHB4O2ZvbnQtc2l6ZToxMnB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpJztcbiAgdGRMb2MudGV4dENvbnRlbnQgPSBgJHtjLnByb3ZpbmNpYSB8fCAnJ30vJHtjLmxvY2FsaWRhZCB8fCAnJ31gO1xuICB0ci5hcHBlbmRDaGlsZCh0ZExvYyk7XG5cbiAgY29uc3QgdGRUaXBvID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgndGQnKTtcbiAgdGRUaXBvLnN0eWxlLmNzc1RleHQgPSAncGFkZGluZzo2cHggOHB4O3RleHQtYWxpZ246Y2VudGVyJztcbiAgY29uc3QgdGlwb0JhZGdlID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnc3BhbicpO1xuICB0aXBvQmFkZ2Uuc3R5bGUuY3NzVGV4dCA9XG4gICAgJ3BhZGRpbmc6MnB4IDZweDtib3JkZXItcmFkaXVzOjRweDtiYWNrZ3JvdW5kOnZhcigtLWJnLWlucHV0KTtmb250LXNpemU6MTFweDtmb250LXdlaWdodDo3MDAnO1xuICAvLyB2MTQ4MiBcdTAwQTc4MjogbGFiZWwgZGUgbGEgRmljaGEgKFwiQiAtIHNpbiBkZXNjdWVudG9cIikgdnMgY1x1MDBGM2RpZ28gKFwiQlwiKS5cbiAgdGlwb0JhZGdlLnRleHRDb250ZW50ID0gbGFiZWxGb3JGaWNoYUZpZWxkKCdjbGlUaXBvJywgYy5jbGlUaXBvKTtcbiAgdGRUaXBvLmFwcGVuZENoaWxkKHRpcG9CYWRnZSk7XG4gIHRyLmFwcGVuZENoaWxkKHRkVGlwbyk7XG5cbiAgdHIuYXBwZW5kQ2hpbGQoYnVpbGREYXRlQ2VsbChjLnVsdGltYVZpc2l0YVByZXNlbmNpYWwsIGMuZGlhc1NpblZpc2l0YVByZXNlbmNpYWwsIDMwKSk7XG4gIHRyLmFwcGVuZENoaWxkKGJ1aWxkRGF0ZUNlbGwoYy51bHRpbW9Db250YWN0bywgYy5kaWFzU2luQ29udGFjdG8sIG51bGwpKTtcbiAgdHIuYXBwZW5kQ2hpbGQoYnVpbGREYXRlQ2VsbChjLnVsdGltYUNvbXByYSwgYy5kaWFzU2luQ29tcHJhLCA5MCkpO1xuXG4gIGNvbnN0IHRkRmFjdCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3RkJyk7XG4gIHRkRmFjdC5zdHlsZS5jc3NUZXh0ID0gJ3BhZGRpbmc6NnB4IDhweDt0ZXh0LWFsaWduOnJpZ2h0O2ZvbnQtdmFyaWFudC1udW1lcmljOnRhYnVsYXItbnVtcyc7XG4gIHRkRmFjdC50ZXh0Q29udGVudCA9IGZtdE1vbmV5KGMuZmFjdHVyYWRvMTJNKTtcbiAgdHIuYXBwZW5kQ2hpbGQodGRGYWN0KTtcblxuICBjb25zdCB0ZERldWRhID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgndGQnKTtcbiAgdGREZXVkYS5zdHlsZS5jc3NUZXh0ID0gYHBhZGRpbmc6NnB4IDhweDt0ZXh0LWFsaWduOnJpZ2h0O2ZvbnQtdmFyaWFudC1udW1lcmljOnRhYnVsYXItbnVtcztjb2xvcjoke2MuZGV1ZGFBYmllcnRhID4gMCA/ICcjZGMyNjI2JyA6ICd2YXIoLS10ZXh0LW11dGVkKSd9YDtcbiAgdGREZXVkYS50ZXh0Q29udGVudCA9IGZtdE1vbmV5KGMuZGV1ZGFBYmllcnRhKTtcbiAgdHIuYXBwZW5kQ2hpbGQodGREZXVkYSk7XG5cbiAgcmV0dXJuIHRyO1xufVxuXG4vKipcbiAqIEBwYXJhbSB7c3RyaW5nfG51bGx9IGZlY2hhSXNvXG4gKiBAcGFyYW0ge251bWJlcnxudWxsfSBkaWFzXG4gKiBAcGFyYW0ge251bWJlcnxudWxsfSBkYW5nZXJUaHJlc2hvbGRcbiAqL1xuZnVuY3Rpb24gYnVpbGREYXRlQ2VsbChmZWNoYUlzbywgZGlhcywgZGFuZ2VyVGhyZXNob2xkKSB7XG4gIGNvbnN0IHRkID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgndGQnKTtcbiAgY29uc3QgaXNEYW5nZXIgPVxuICAgIGRhbmdlclRocmVzaG9sZCAhPT0gbnVsbCAmJiBkaWFzICE9PSBudWxsICYmIGRpYXMgIT09IHVuZGVmaW5lZCAmJiBkaWFzID4gZGFuZ2VyVGhyZXNob2xkO1xuICB0ZC5zdHlsZS5jc3NUZXh0ID0gYHBhZGRpbmc6NnB4IDhweDtjb2xvcjoke2lzRGFuZ2VyID8gJyNkYzI2MjYnIDogJ3ZhcigtLXRleHQtcHJpbWFyeSknfWA7XG4gIGlmICghZmVjaGFJc28pIHtcbiAgICB0ZC50ZXh0Q29udGVudCA9ICdcdTIwMTQnO1xuICAgIHJldHVybiB0ZDtcbiAgfVxuICBjb25zdCBwYXJ0cyA9IFN0cmluZyhmZWNoYUlzbykuc3BsaXQoJy0nKTtcbiAgY29uc3QgZCA9IHBhcnRzWzJdIHx8ICcnO1xuICBjb25zdCBtID0gcGFydHNbMV0gfHwgJyc7XG4gIHRkLnRleHRDb250ZW50ID0gYCR7ZH0vJHttfWA7XG4gIGNvbnN0IGRpYXNFbCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3NtYWxsJyk7XG4gIGRpYXNFbC5zdHlsZS5jc3NUZXh0ID0gJ2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO21hcmdpbi1sZWZ0OjRweCc7XG4gIGRpYXNFbC50ZXh0Q29udGVudCA9IGAke2RpYXN9ZGA7XG4gIHRkLmFwcGVuZENoaWxkKGRpYXNFbCk7XG4gIHJldHVybiB0ZDtcbn1cblxuLyoqIEBwYXJhbSB7bnVtYmVyfSBuICovXG5mdW5jdGlvbiBmbXRNb25leShuKSB7XG4gIGlmICghbiB8fCBuID09PSAwKSByZXR1cm4gJy0nO1xuICBpZiAobiA+PSAxXzAwMF8wMDApIHJldHVybiBgJCAkeyhuIC8gMV8wMDBfMDAwKS50b0ZpeGVkKDEpfU1gO1xuICBpZiAobiA+PSAxXzAwMCkgcmV0dXJuIGAkICR7KG4gLyAxXzAwMCkudG9GaXhlZCgwKX1rYDtcbiAgcmV0dXJuIGAkICR7bn1gO1xufVxuXG4vLyA9PT0gVUkgc3RhdGUgaGVscGVycyA9PT1cbmZ1bmN0aW9uIGhpZGVBbGwoKSB7XG4gIGNvbnN0IGlkcyA9IFtcbiAgICAnY2FydGVyYS1sb2FkaW5nJyxcbiAgICAnY2FydGVyYS10YWJsZScsXG4gICAgJ2NhcnRlcmEta3BpcycsXG4gICAgJ2NhcnRlcmEtY2hpcHMnLFxuICAgICdjYXJ0ZXJhLWVtcHR5JyxcbiAgXTtcbiAgZm9yIChjb25zdCBpZCBvZiBpZHMpIHtcbiAgICBjb25zdCBlbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKGlkKTtcbiAgICBpZiAoZWwpIGVsLnN0eWxlLmRpc3BsYXkgPSAnbm9uZSc7XG4gIH1cbn1cbmZ1bmN0aW9uIHNob3dFbXB0eSgpIHtcbiAgaGlkZUFsbCgpO1xuICBjb25zdCBlbXB0eSA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdjYXJ0ZXJhLWVtcHR5Jyk7XG4gIGlmIChlbXB0eSkge1xuICAgIGVtcHR5LnN0eWxlLmRpc3BsYXkgPSAnYmxvY2snO1xuICAgIGVtcHR5LnRleHRDb250ZW50ID0gJ0VsZWdcdTAwRUQgdW4gdmVuZGVkb3IgcGFyYSB2ZXIgc3UgY2FydGVyYS4nO1xuICB9XG59XG5mdW5jdGlvbiBzaG93TG9hZGluZygpIHtcbiAgaGlkZUFsbCgpO1xuICBjb25zdCBsb2FkaW5nID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2NhcnRlcmEtbG9hZGluZycpO1xuICBpZiAobG9hZGluZykgbG9hZGluZy5zdHlsZS5kaXNwbGF5ID0gJ2Jsb2NrJztcbn1cbmZ1bmN0aW9uIHNob3dOb0RhdGEoKSB7XG4gIGhpZGVBbGwoKTtcbiAgY29uc3QgZW1wdHkgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY2FydGVyYS1lbXB0eScpO1xuICBpZiAoZW1wdHkpIHtcbiAgICBlbXB0eS5zdHlsZS5kaXNwbGF5ID0gJ2Jsb2NrJztcbiAgICBlbXB0eS50ZXh0Q29udGVudCA9XG4gICAgICAnU2luIGNhcnRlcmEgcGFyYSBlc3RlIHZlbmRlZG9yLiBWZXJpZmljXHUwMEUxIGFzc2lnbmVkVmVuZG9yIGVuIGNsaWVudF9tYXN0ZXIgbyBlc3Blclx1MDBFMSBhbCBwclx1MDBGM3hpbW8gc25hcHNob3QgKDA0OjAwIEFSVCkuJztcbiAgfVxufVxuLyoqIEBwYXJhbSB7c3RyaW5nfSBtc2cgKi9cbmZ1bmN0aW9uIHNob3dFcnJvcihtc2cpIHtcbiAgaGlkZUFsbCgpO1xuICBjb25zdCBlbXB0eSA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdjYXJ0ZXJhLWVtcHR5Jyk7XG4gIGlmIChlbXB0eSkge1xuICAgIGVtcHR5LnN0eWxlLmRpc3BsYXkgPSAnYmxvY2snO1xuICAgIGVtcHR5LnN0eWxlLmNvbG9yID0gJyNkYzI2MjYnO1xuICAgIGVtcHR5LnRleHRDb250ZW50ID0gYEVycm9yIGNhcmdhbmRvIGNhcnRlcmE6ICR7bXNnfWA7XG4gIH1cbn1cbmZ1bmN0aW9uIHNob3dUYWJsZSgpIHtcbiAgY29uc3QgZW1wdHkgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY2FydGVyYS1lbXB0eScpO1xuICBpZiAoZW1wdHkpIGVtcHR5LnN0eWxlLmRpc3BsYXkgPSAnbm9uZSc7XG4gIGNvbnN0IGxvYWRpbmcgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY2FydGVyYS1sb2FkaW5nJyk7XG4gIGlmIChsb2FkaW5nKSBsb2FkaW5nLnN0eWxlLmRpc3BsYXkgPSAnbm9uZSc7XG4gIGNvbnN0IHRhYmxlID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2NhcnRlcmEtdGFibGUnKTtcbiAgaWYgKHRhYmxlKSB0YWJsZS5zdHlsZS5kaXNwbGF5ID0gJ3RhYmxlJztcbiAgLy8gdjEzODM6IGRpc3BsYXkgdmFjaW8gPSByZXNldCBhbCB2YWxvciBkZWwgQ1NTIChncmlkIHBhcmEga3BpcywgZmxleCBwYXJhIGNoaXBzKS5cbiAgY29uc3Qga3BpcyA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdjYXJ0ZXJhLWtwaXMnKTtcbiAgaWYgKGtwaXMpIGtwaXMuc3R5bGUuZGlzcGxheSA9ICcnO1xuICBjb25zdCBjaGlwcyA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdjYXJ0ZXJhLWNoaXBzJyk7XG4gIGlmIChjaGlwcykgY2hpcHMuc3R5bGUuZGlzcGxheSA9ICcnO1xufVxuXG4vLyA9PT0gRXhwb3J0IEV4Y2VsID09PVxud2luZG93LmV4cG9ydENhcnRlcmFUb0V4Y2VsID0gYXN5bmMgZnVuY3Rpb24gZXhwb3J0Q2FydGVyYVRvRXhjZWwoKSB7XG4gIGlmICghc2VsZWN0ZWRWZW5kb3IpIHtcbiAgICBhbGVydCgnRWxlZ1x1MDBFRCB1biB2ZW5kZWRvciBwcmltZXJvLicpO1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCBkb2MgPSBjYXJ0ZXJhRG9jQ2FjaGUuZ2V0KHNlbGVjdGVkVmVuZG9yKTtcbiAgaWYgKCFkb2MpIHtcbiAgICBhbGVydCgnU2luIGRhdGEgY2FyZ2FkYS4nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgY29uc3QgZmlsdGVyZWQgPSBhcHBseUNoaXBGaWx0ZXIoZG9jLmNsaWVudGVzLCBhY3RpdmVDaGlwKTtcbiAgY29uc3Qgc2VhcmNoZWQgPSBzZWFyY2hRdWVyeVxuICAgID8gZmlsdGVyZWQuZmlsdGVyKChjKSA9PlxuICAgICAgICBTdHJpbmcoYy5jbGllbnROYW1lIHx8ICcnKVxuICAgICAgICAgIC50b0xvd2VyQ2FzZSgpXG4gICAgICAgICAgLmluY2x1ZGVzKHNlYXJjaFF1ZXJ5KVxuICAgICAgKVxuICAgIDogZmlsdGVyZWQ7XG4gIGNvbnN0IHNvcnRlZCA9IHNvcnRDbGllbnRlcyhzZWFyY2hlZCwgc29ydEJ5LCBzb3J0RGlyKTtcblxuICBjb25zdCBjaGlwTGFiZWwgPSAoQ0hJUFMuZmluZCgoYykgPT4gYy5pZCA9PT0gYWN0aXZlQ2hpcCkgfHwgeyBsYWJlbDogJ1RvZG9zJyB9KS5sYWJlbDtcbiAgY29uc3QgdGl0bGUgPSBgQ2FydGVyYSBkZSAke3NlbGVjdGVkVmVuZG9yfSBcdTIwMTQgJHtjaGlwTGFiZWx9IFx1MjAxNCBTbmFwc2hvdCAke2RvYy5zbmFwc2hvdERhdGV9YDtcblxuICB0cnkge1xuICAgIGlmICh0eXBlb2Ygd2luZG93LmxvYWRFeGNlbEpTID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICBhd2FpdCB3aW5kb3cubG9hZEV4Y2VsSlMoKTtcbiAgICB9XG4gICAgY29uc3QgRXhjZWxKUyA9IHdpbmRvdy5FeGNlbEpTO1xuICAgIGlmICghRXhjZWxKUykgdGhyb3cgbmV3IEVycm9yKCdFeGNlbEpTIG5vIGRpc3BvbmlibGUnKTtcbiAgICBjb25zdCB3YiA9IG5ldyBFeGNlbEpTLldvcmtib29rKCk7XG4gICAgY29uc3Qgd3MgPSB3Yi5hZGRXb3Jrc2hlZXQoJ0NhcnRlcmEnKTtcblxuICAgIC8vIEZpbGEgMTogdGl0dWxvIGJhbmRhIHZlcmRlIFNoaW1hbm9cbiAgICB3cy5tZXJnZUNlbGxzKCdBMTpMMScpO1xuICAgIGNvbnN0IHRpdGxlQ2VsbCA9IHdzLmdldENlbGwoJ0ExJyk7XG4gICAgdGl0bGVDZWxsLnZhbHVlID0gdGl0bGU7XG4gICAgdGl0bGVDZWxsLmZpbGwgPSB7IHR5cGU6ICdwYXR0ZXJuJywgcGF0dGVybjogJ3NvbGlkJywgZmdDb2xvcjogeyBhcmdiOiAnRkYyMkM1NUUnIH0gfTtcbiAgICB0aXRsZUNlbGwuZm9udCA9IHsgYm9sZDogdHJ1ZSwgY29sb3I6IHsgYXJnYjogJ0ZGRkZGRkZGJyB9LCBzaXplOiAxNCB9O1xuICAgIHRpdGxlQ2VsbC5hbGlnbm1lbnQgPSB7IGhvcml6b250YWw6ICdjZW50ZXInLCB2ZXJ0aWNhbDogJ21pZGRsZScgfTtcbiAgICB3cy5nZXRSb3coMSkuaGVpZ2h0ID0gMzA7XG5cbiAgICAvLyBGaWxhIDI6IGhlYWRlcnNcbiAgICBjb25zdCBoZWFkZXJzID0gW1xuICAgICAgJ0NsaWVudGUnLFxuICAgICAgJ1Byb3ZpbmNpYScsXG4gICAgICAnTG9jYWxpZGFkJyxcbiAgICAgICdUaXBvJyxcbiAgICAgICdcdTAwREFsdGltYSB2aXNpdGEgcHJlc2VuY2lhbCcsXG4gICAgICAnXHUwMERBbHRpbW8gY29udGFjdG8nLFxuICAgICAgJ1x1MDBEQWx0aW1hIGNvbXByYScsXG4gICAgICAnRmFjdCAxMk0gKEFSUyknLFxuICAgICAgJ0RldWRhIGFiaWVydGEgKEFSUyknLFxuICAgICAgJ0RcdTAwRURhcyBzaW4gdmlzaXRhJyxcbiAgICAgICdEXHUwMEVEYXMgc2luIGNvbXByYScsXG4gICAgICAnQ2FyZENvZGUgU0FQJyxcbiAgICBdO1xuICAgIGNvbnN0IGhlYWRlclJvdyA9IHdzLmdldFJvdygyKTtcbiAgICBoZWFkZXJzLmZvckVhY2goKGgsIGkpID0+IHtcbiAgICAgIGNvbnN0IGNlbGwgPSBoZWFkZXJSb3cuZ2V0Q2VsbChpICsgMSk7XG4gICAgICBjZWxsLnZhbHVlID0gaDtcbiAgICAgIGNlbGwuZmlsbCA9IHsgdHlwZTogJ3BhdHRlcm4nLCBwYXR0ZXJuOiAnc29saWQnLCBmZ0NvbG9yOiB7IGFyZ2I6ICdGRjA3NEY2OScgfSB9O1xuICAgICAgY2VsbC5mb250ID0geyBib2xkOiB0cnVlLCBjb2xvcjogeyBhcmdiOiAnRkZGRkZGRkYnIH0gfTtcbiAgICAgIGNlbGwuYWxpZ25tZW50ID0geyBob3Jpem9udGFsOiAnY2VudGVyJyB9O1xuICAgIH0pO1xuXG4gICAgLy8gRmlsYXMgMys6IGRhdGFcbiAgICBzb3J0ZWQuZm9yRWFjaCgoYywgaSkgPT4ge1xuICAgICAgY29uc3Qgcm93ID0gd3MuZ2V0Um93KDMgKyBpKTtcbiAgICAgIHJvdy5nZXRDZWxsKDEpLnZhbHVlID0gYy5jbGllbnROYW1lIHx8ICcnO1xuICAgICAgcm93LmdldENlbGwoMikudmFsdWUgPSBjLnByb3ZpbmNpYSB8fCAnJztcbiAgICAgIHJvdy5nZXRDZWxsKDMpLnZhbHVlID0gYy5sb2NhbGlkYWQgfHwgJyc7XG4gICAgICByb3cuZ2V0Q2VsbCg0KS52YWx1ZSA9IGxhYmVsRm9yRmljaGFGaWVsZCgnY2xpVGlwbycsIGMuY2xpVGlwbyk7XG4gICAgICByb3cuZ2V0Q2VsbCg1KS52YWx1ZSA9IGMudWx0aW1hVmlzaXRhUHJlc2VuY2lhbCB8fCAnJztcbiAgICAgIHJvdy5nZXRDZWxsKDYpLnZhbHVlID0gYy51bHRpbW9Db250YWN0byB8fCAnJztcbiAgICAgIHJvdy5nZXRDZWxsKDcpLnZhbHVlID0gYy51bHRpbWFDb21wcmEgfHwgJyc7XG4gICAgICByb3cuZ2V0Q2VsbCg4KS52YWx1ZSA9IGMuZmFjdHVyYWRvMTJNIHx8IDA7XG4gICAgICByb3cuZ2V0Q2VsbCg4KS5udW1GbXQgPSAnXCIkXCIjLCMjMCc7XG4gICAgICByb3cuZ2V0Q2VsbCg5KS52YWx1ZSA9IGMuZGV1ZGFBYmllcnRhIHx8IDA7XG4gICAgICByb3cuZ2V0Q2VsbCg5KS5udW1GbXQgPSAnXCIkXCIjLCMjMCc7XG4gICAgICByb3cuZ2V0Q2VsbCgxMCkudmFsdWUgPSBjLmRpYXNTaW5WaXNpdGFQcmVzZW5jaWFsO1xuICAgICAgcm93LmdldENlbGwoMTEpLnZhbHVlID0gYy5kaWFzU2luQ29tcHJhO1xuICAgICAgcm93LmdldENlbGwoMTIpLnZhbHVlID0gYy5jYXJkQ29kZSB8fCAnJztcbiAgICB9KTtcblxuICAgIHdzLmNvbHVtbnMuZm9yRWFjaCgoY29sLCBpKSA9PiB7XG4gICAgICBjb2wud2lkdGggPSBpID09PSAwID8gMzAgOiBpID09PSA0IHx8IGkgPT09IDUgfHwgaSA9PT0gNiA/IDE4IDogMTQ7XG4gICAgfSk7XG5cbiAgICBjb25zdCBidWYgPSBhd2FpdCB3Yi54bHN4LndyaXRlQnVmZmVyKCk7XG4gICAgY29uc3QgYmxvYiA9IG5ldyBCbG9iKFtidWZdLCB7XG4gICAgICB0eXBlOiAnYXBwbGljYXRpb24vdm5kLm9wZW54bWxmb3JtYXRzLW9mZmljZWRvY3VtZW50LnNwcmVhZHNoZWV0bWwuc2hlZXQnLFxuICAgIH0pO1xuICAgIGNvbnN0IHVybCA9IFVSTC5jcmVhdGVPYmplY3RVUkwoYmxvYik7XG4gICAgY29uc3QgYSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2EnKTtcbiAgICBhLmhyZWYgPSB1cmw7XG4gICAgYS5kb3dubG9hZCA9IGBDYXJ0ZXJhXyR7U3RyaW5nKHNlbGVjdGVkVmVuZG9yKS5yZXBsYWNlKC9cXHMrL2csICdfJyl9XyR7YWN0aXZlQ2hpcH1fJHtkb2Muc25hcHNob3REYXRlfS54bHN4YDtcbiAgICBkb2N1bWVudC5ib2R5LmFwcGVuZENoaWxkKGEpO1xuICAgIGEuY2xpY2soKTtcbiAgICBhLnJlbW92ZSgpO1xuICAgIFVSTC5yZXZva2VPYmplY3RVUkwodXJsKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGNvbnNvbGUuZXJyb3IoJ2V4cG9ydENhcnRlcmFUb0V4Y2VsIGZhaWxlZCcsIGUpO1xuICAgIGFsZXJ0KCdFcnJvciBleHBvcnRhbmRvOiAnICsgU3RyaW5nKGUpKTtcbiAgfVxufTtcbiJdLAogICJtYXBwaW5ncyI6ICI7OztBQWVPLFdBQVMsZ0JBQWdCLFVBQVUsTUFBTTtBQUM5QyxRQUFJLENBQUMsTUFBTSxRQUFRLFFBQVEsRUFBRyxRQUFPLENBQUM7QUFDdEMsWUFBUSxNQUFNO0FBQUEsTUFDWixLQUFLO0FBQ0gsZUFBTyxTQUFTO0FBQUEsVUFDZCxDQUFDLE1BQU0sRUFBRSxrQkFBa0IsUUFBUSxFQUFFLGtCQUFrQixV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
