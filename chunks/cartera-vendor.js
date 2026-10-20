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
    const searched = searchQuery ? filtered.filter((c) => String(c.clientName || "").toLowerCase().includes(searchQuery)) : filtered;
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
    const ids = ["cartera-loading", "cartera-table", "cartera-kpis", "cartera-chips", "cartera-empty"];
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
  window.exportCarteraToExcel = function exportCarteraToExcel() {
    alert("Exportar: pendiente de implementaci\xF3n en Task 12.");
  };
})();
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL3B1cmUvY2FydGVyYS12ZW5kb3ItZmlsdGVyLmpzIiwgIi4uL3NyYy9kb21haW5zL2NhcnRlcmEtdmVuZG9yLmpzIl0sCiAgInNvdXJjZXNDb250ZW50IjogWyIvLyBAdHMtY2hlY2tcbi8qKlxuICogY2FydGVyYS12ZW5kb3ItZmlsdGVyLmpzICh2MTI4MywgMjAyNi0xMC0yMClcbiAqXG4gKiBQdXJhcyBwYXJhIGZpbHRyYXIgeSBvcmRlbmFyIGxhIHRhYmxhIGRlbCBkYXNoYm9hcmQgXCJBbmFsaXNpcyBkZSBDYXJ0ZXJhXCIuXG4gKiBJbXBvcnRhZG8gcG9yIHNyYy9kb21haW5zL2NhcnRlcmEtdmVuZG9yLmpzIChidW5kbGUgZnJvbnRlbmQpLlxuICogVGVzdGVhZG8gZW4gdGVzdHMvdW5pdC9jYXJ0ZXJhLXZlbmRvci1maWx0ZXIudGVzdC5qcy5cbiAqL1xuXG4vKipcbiAqIEFwbGljYSB1biBjaGlwIGRlIGZpbHRybyBhbCBhcnJheSBkZSBjbGllbnRlcy5cbiAqIEBwYXJhbSB7QXJyYXk8YW55Pn0gY2xpZW50ZXNcbiAqIEBwYXJhbSB7c3RyaW5nfSBjaGlwXG4gKiBAcmV0dXJucyB7QXJyYXk8YW55Pn1cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGFwcGx5Q2hpcEZpbHRlcihjbGllbnRlcywgY2hpcCkge1xuICBpZiAoIUFycmF5LmlzQXJyYXkoY2xpZW50ZXMpKSByZXR1cm4gW107XG4gIHN3aXRjaCAoY2hpcCkge1xuICAgIGNhc2UgJ2Jhc2VBY3RpdmE5MGQnOlxuICAgICAgcmV0dXJuIGNsaWVudGVzLmZpbHRlcihcbiAgICAgICAgKGMpID0+XG4gICAgICAgICAgYy5kaWFzU2luQ29tcHJhICE9PSBudWxsICYmIGMuZGlhc1NpbkNvbXByYSAhPT0gdW5kZWZpbmVkICYmIGMuZGlhc1NpbkNvbXByYSA8PSA5MFxuICAgICAgKTtcbiAgICBjYXNlICdkb3JtaWRvc1Zpc2l0YTMwZCc6XG4gICAgICByZXR1cm4gY2xpZW50ZXMuZmlsdGVyKFxuICAgICAgICAoYykgPT5cbiAgICAgICAgICBjLmRpYXNTaW5WaXNpdGFQcmVzZW5jaWFsICE9PSBudWxsICYmXG4gICAgICAgICAgYy5kaWFzU2luVmlzaXRhUHJlc2VuY2lhbCAhPT0gdW5kZWZpbmVkICYmXG4gICAgICAgICAgYy5kaWFzU2luVmlzaXRhUHJlc2VuY2lhbCA+IDMwXG4gICAgICApO1xuICAgIGNhc2UgJ2Rvcm1pZG9zQ29tcHJhOTBkJzpcbiAgICAgIHJldHVybiBjbGllbnRlcy5maWx0ZXIoXG4gICAgICAgIChjKSA9PiBjLmRpYXNTaW5Db21wcmEgIT09IG51bGwgJiYgYy5kaWFzU2luQ29tcHJhICE9PSB1bmRlZmluZWQgJiYgYy5kaWFzU2luQ29tcHJhID4gOTBcbiAgICAgICk7XG4gICAgY2FzZSAnbnVuY2FWaXNpdGFkb3MnOlxuICAgICAgcmV0dXJuIGNsaWVudGVzLmZpbHRlcihcbiAgICAgICAgKGMpID0+IGMudWx0aW1hVmlzaXRhUHJlc2VuY2lhbCA9PT0gbnVsbCB8fCBjLnVsdGltYVZpc2l0YVByZXNlbmNpYWwgPT09IHVuZGVmaW5lZFxuICAgICAgKTtcbiAgICBjYXNlICdudW5jYUNvbXByYXJvbic6XG4gICAgICByZXR1cm4gY2xpZW50ZXMuZmlsdGVyKChjKSA9PiBjLnVsdGltYUNvbXByYSA9PT0gbnVsbCB8fCBjLnVsdGltYUNvbXByYSA9PT0gdW5kZWZpbmVkKTtcbiAgICBkZWZhdWx0OlxuICAgICAgcmV0dXJuIGNsaWVudGVzLnNsaWNlKCk7XG4gIH1cbn1cblxuLyoqXG4gKiBPcmRlbmEgdW5hIGNvcGlhIGRlbCBhcnJheSBwb3IgY29sdW1uYS4gTnVsbHMgc2llbXByZSBhbCBmaW5hbC5cbiAqIEBwYXJhbSB7QXJyYXk8YW55Pn0gY2xpZW50ZXNcbiAqIEBwYXJhbSB7c3RyaW5nfSBzb3J0QnlcbiAqIEBwYXJhbSB7J2FzYyd8J2Rlc2MnfSBzb3J0RGlyXG4gKiBAcmV0dXJucyB7QXJyYXk8YW55Pn1cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHNvcnRDbGllbnRlcyhjbGllbnRlcywgc29ydEJ5LCBzb3J0RGlyKSB7XG4gIGlmICghQXJyYXkuaXNBcnJheShjbGllbnRlcykpIHJldHVybiBbXTtcbiAgY29uc3QgZGlyID0gc29ydERpciA9PT0gJ2FzYycgPyAxIDogLTE7XG4gIGNvbnN0IGNvcHkgPSBjbGllbnRlcy5zbGljZSgpO1xuICBjb3B5LnNvcnQoKGEsIGIpID0+IHtcbiAgICBjb25zdCBhdiA9IGFbc29ydEJ5XTtcbiAgICBjb25zdCBidiA9IGJbc29ydEJ5XTtcbiAgICBjb25zdCBhTnVsbCA9IGF2ID09PSBudWxsIHx8IGF2ID09PSB1bmRlZmluZWQ7XG4gICAgY29uc3QgYk51bGwgPSBidiA9PT0gbnVsbCB8fCBidiA9PT0gdW5kZWZpbmVkO1xuICAgIGlmIChhTnVsbCAmJiBiTnVsbCkgcmV0dXJuIDA7XG4gICAgaWYgKGFOdWxsKSByZXR1cm4gMTtcbiAgICBpZiAoYk51bGwpIHJldHVybiAtMTtcbiAgICBpZiAodHlwZW9mIGF2ID09PSAnbnVtYmVyJyAmJiB0eXBlb2YgYnYgPT09ICdudW1iZXInKSByZXR1cm4gKGF2IC0gYnYpICogZGlyO1xuICAgIHJldHVybiBTdHJpbmcoYXYpLmxvY2FsZUNvbXBhcmUoU3RyaW5nKGJ2KSkgKiBkaXI7XG4gIH0pO1xuICByZXR1cm4gY29weTtcbn1cbiIsICIvLyBAdHMtbm9jaGVja1xuLy8gTk9UQTogQHRzLW5vY2hlY2sgaW50ZW5jaW9uYWwuIEVsIGNodW5rIGVzIGhlYXZ5IERPTSArIHdpbmRvdy4qIGhhbmRsZXJzICtcbi8vIEZpcmVzdG9yZSBTREsgY29tcGF0IHY4LiBBbm90YXIgc3RyaWN0YW1lbnRlIGNhZGEgaGFuZGxlciBzZXJcdTAwRURhIHJ1aWRvIHNpblxuLy8gdmFsb3IgXHUyMDE0IGxvcyBoZWxwZXJzIHB1cm9zIHF1ZSBpbXBvcnRhbW9zICguLi9wdXJlL2NhcnRlcmEtdmVuZG9yLWZpbHRlci5qcylcbi8vIHkgZWwgY29yZSAoZnVuY3Rpb25zL2NvcmUvY2FydGVyYS12ZW5kb3ItY29yZS5qcykgc1x1MDBFRCB0aWVuZW4gQHRzLWNoZWNrLlxuLyoqXG4gKiBjYXJ0ZXJhLXZlbmRvci5qcyAodjEyODMsIDIwMjYtMTAtMjApIFx1MjAxNCBidW5kbGUgY2h1bmsgbGF6eS5cbiAqXG4gKiBEYXNoYm9hcmQgXCJBbmFsaXNpcyBkZSBDYXJ0ZXJhIHBvciBWZW5kZWRvclwiLiBSZWVtcGxhemEgc2VndWltaWVudG8uanMuXG4gKiBMZWUgY2FydGVyYV92ZW5kb3Ive3ZlbmRvcktleX0gRmlyZXN0b3JlIChzbmFwc2hvdCBuaWdodGx5IDA0OjAwIEFSVCkuXG4gKlxuICogVE9ETyBlbCBET00gcmVuZGVyIHVzYSBjcmVhdGVFbGVtZW50ICsgdGV4dENvbnRlbnQgKHBvbGljeSBhbnRpLVhTUywgbm8gaW5uZXJIVE1MKS5cbiAqXG4gKiBTcGVjOiBkb2NzL3N1cGVycG93ZXJzL3NwZWNzLzIwMjYtMTAtMjAtY2FydGVyYS12ZW5kb3ItYW5hbGlzaXMtZGVzaWduLm1kXG4gKiBQbGFuOiBkb2NzL3N1cGVycG93ZXJzL3BsYW5zLzIwMjYtMTAtMjAtY2FydGVyYS12ZW5kb3ItYW5hbGlzaXMubWRcbiAqL1xuXG5pbXBvcnQgeyBhcHBseUNoaXBGaWx0ZXIsIHNvcnRDbGllbnRlcyB9IGZyb20gJy4uL3B1cmUvY2FydGVyYS12ZW5kb3ItZmlsdGVyLmpzJztcblxuLyoqIEB0eXBlIHtNYXA8c3RyaW5nLCBhbnk+fSAqL1xuY29uc3QgY2FydGVyYURvY0NhY2hlID0gbmV3IE1hcCgpO1xuLyoqIEB0eXBlIHtzdHJpbmd8bnVsbH0gKi9cbmxldCBzZWxlY3RlZFZlbmRvciA9IG51bGw7XG5sZXQgYWN0aXZlQ2hpcCA9ICd0b2Rvcyc7XG5sZXQgc2VhcmNoUXVlcnkgPSAnJztcbmxldCBzb3J0QnkgPSAnZGlhc1NpbkNvbXByYSc7XG4vKiogQHR5cGUgeydhc2MnfCdkZXNjJ30gKi9cbmxldCBzb3J0RGlyID0gJ2Rlc2MnO1xuXG5jb25zdCBDSElQUyA9IFtcbiAgeyBpZDogJ3RvZG9zJywgbGFiZWw6ICdUb2RvcycgfSxcbiAgeyBpZDogJ2Jhc2VBY3RpdmE5MGQnLCBsYWJlbDogJ0Jhc2UgYWN0aXZhIDkwZCcgfSxcbiAgeyBpZDogJ2Rvcm1pZG9zVmlzaXRhMzBkJywgbGFiZWw6ICdEb3JtaWRvcyB2aXNpdGEgMzBkJyB9LFxuICB7IGlkOiAnZG9ybWlkb3NDb21wcmE5MGQnLCBsYWJlbDogJ0Rvcm1pZG9zIGNvbXByYSA5MGQnIH0sXG4gIHsgaWQ6ICdudW5jYVZpc2l0YWRvcycsIGxhYmVsOiAnTnVuY2EgdmlzaXRhZG9zJyB9LFxuICB7IGlkOiAnbnVuY2FDb21wcmFyb24nLCBsYWJlbDogJ051bmNhIGNvbXByYXJvbicgfSxcbl07XG5cbmNvbnN0IEtQSV9DQVJEUyA9IFtcbiAgeyBjaGlwOiAndG9kb3MnLCBsYWJlbDogJ1RvdGFsIGNhcnRlcmEnLCBjb2xvcjogJyM2NDc0OGInIH0sXG4gIHsgY2hpcDogJ2Jhc2VBY3RpdmE5MGQnLCBsYWJlbDogJ0Jhc2UgYWN0aXZhIDkwZCcsIGNvbG9yOiAnIzE2YTM0YScgfSxcbiAgeyBjaGlwOiAnZG9ybWlkb3NWaXNpdGEzMGQnLCBsYWJlbDogJ0Rvcm1pZG9zIHZpcyAzMGQnLCBjb2xvcjogJyNlYTU4MGMnIH0sXG4gIHsgY2hpcDogJ2Rvcm1pZG9zQ29tcHJhOTBkJywgbGFiZWw6ICdEb3JtaWRvcyBjb20gOTBkJywgY29sb3I6ICcjZGMyNjI2JyB9LFxuICB7IGNoaXA6ICdudW5jYVZpc2l0YWRvcycsIGxhYmVsOiAnTnVuY2EgdmlzaXRhZG9zJywgY29sb3I6ICcjN2MzYWVkJyB9LFxuICB7IGNoaXA6ICdudW5jYUNvbXByYXJvbicsIGxhYmVsOiAnTnVuY2EgY29tcHJhcm9uJywgY29sb3I6ICcjYmUxODVkJyB9LFxuXTtcblxuLy8gPT09IE9wZW4gLyBjbG9zZSA9PT1cbndpbmRvdy5vcGVuQ2FydGVyYU1vZGFsID0gYXN5bmMgZnVuY3Rpb24gb3BlbkNhcnRlcmFNb2RhbCgpIHtcbiAgY29uc3QgbW9kYWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY2FydGVyYS1tb2RhbCcpO1xuICBpZiAoIW1vZGFsKSByZXR1cm47XG4gIG1vZGFsLmNsYXNzTGlzdC5hZGQoJ29wZW4nKTtcbiAgYXdhaXQgcG9wdWxhdGVWZW5kb3JEcm9wZG93bigpO1xufTtcblxud2luZG93LmNsb3NlQ2FydGVyYU1vZGFsID0gZnVuY3Rpb24gY2xvc2VDYXJ0ZXJhTW9kYWwoKSB7XG4gIGNvbnN0IG1vZGFsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2NhcnRlcmEtbW9kYWwnKTtcbiAgaWYgKG1vZGFsKSBtb2RhbC5jbGFzc0xpc3QucmVtb3ZlKCdvcGVuJyk7XG59O1xuXG4vLyA9PT0gRHJvcGRvd24gZGUgdmVuZG9ycyA9PT1cbmFzeW5jIGZ1bmN0aW9uIHBvcHVsYXRlVmVuZG9yRHJvcGRvd24oKSB7XG4gIGNvbnN0IHNlbCA9IC8qKiBAdHlwZSB7SFRNTFNlbGVjdEVsZW1lbnR8bnVsbH0gKi8gKFxuICAgIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdjYXJ0ZXJhLXZlbmRvci1zZWxlY3QnKVxuICApO1xuICBpZiAoIXNlbCkgcmV0dXJuO1xuICBpZiAoc2VsLm9wdGlvbnMubGVuZ3RoID4gMSkgcmV0dXJuO1xuICB0cnkge1xuICAgIC8vIEB0cy1pZ25vcmVcbiAgICBjb25zdCBzbmFwID0gYXdhaXQgZmlyZWJhc2UuZmlyZXN0b3JlKCkuY29sbGVjdGlvbignY2FydGVyYV92ZW5kb3InKS5nZXQoKTtcbiAgICAvKiogQHR5cGUge3N0cmluZ1tdfSAqL1xuICAgIGNvbnN0IHZlbmRvcnMgPSBbXTtcbiAgICBzbmFwLmZvckVhY2goKGRvYykgPT4gdmVuZG9ycy5wdXNoKGRvYy5pZCkpO1xuICAgIHZlbmRvcnMuc29ydCgpO1xuICAgIGZvciAoY29uc3QgdiBvZiB2ZW5kb3JzKSB7XG4gICAgICBjb25zdCBvcHQgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdvcHRpb24nKTtcbiAgICAgIG9wdC52YWx1ZSA9IHY7XG4gICAgICBvcHQudGV4dENvbnRlbnQgPSB2O1xuICAgICAgc2VsLmFwcGVuZENoaWxkKG9wdCk7XG4gICAgfVxuICB9IGNhdGNoIChlKSB7XG4gICAgY29uc29sZS5lcnJvcigncG9wdWxhdGVWZW5kb3JEcm9wZG93biBmYWlsZWQnLCBlKTtcbiAgfVxufVxuXG4vLyA9PT0gT24gdmVuZG9yIGNoYW5nZSA9PT1cbndpbmRvdy5vbkNhcnRlcmFWZW5kb3JDaGFuZ2UgPSBhc3luYyBmdW5jdGlvbiBvbkNhcnRlcmFWZW5kb3JDaGFuZ2UoKSB7XG4gIGNvbnN0IHNlbCA9IC8qKiBAdHlwZSB7SFRNTFNlbGVjdEVsZW1lbnR8bnVsbH0gKi8gKFxuICAgIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdjYXJ0ZXJhLXZlbmRvci1zZWxlY3QnKVxuICApO1xuICBpZiAoIXNlbCkgcmV0dXJuO1xuICBzZWxlY3RlZFZlbmRvciA9IHNlbC52YWx1ZSB8fCBudWxsO1xuICBhY3RpdmVDaGlwID0gJ3RvZG9zJztcbiAgc2VhcmNoUXVlcnkgPSAnJztcbiAgY29uc3Qgc2VhcmNoSW5wdXQgPSAvKiogQHR5cGUge0hUTUxJbnB1dEVsZW1lbnR8bnVsbH0gKi8gKFxuICAgIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdjYXJ0ZXJhLXNlYXJjaCcpXG4gICk7XG4gIGlmIChzZWFyY2hJbnB1dCkgc2VhcmNoSW5wdXQudmFsdWUgPSAnJztcbiAgaWYgKCFzZWxlY3RlZFZlbmRvcikge1xuICAgIHNob3dFbXB0eSgpO1xuICAgIHJldHVybjtcbiAgfVxuICBzaG93TG9hZGluZygpO1xuICB0cnkge1xuICAgIGxldCBkb2MgPSBjYXJ0ZXJhRG9jQ2FjaGUuZ2V0KHNlbGVjdGVkVmVuZG9yKTtcbiAgICBpZiAoIWRvYykge1xuICAgICAgLy8gQHRzLWlnbm9yZVxuICAgICAgY29uc3Qgc25hcCA9IGF3YWl0IGZpcmViYXNlXG4gICAgICAgIC5maXJlc3RvcmUoKVxuICAgICAgICAuY29sbGVjdGlvbignY2FydGVyYV92ZW5kb3InKVxuICAgICAgICAuZG9jKHNlbGVjdGVkVmVuZG9yKVxuICAgICAgICAuZ2V0KCk7XG4gICAgICBpZiAoIXNuYXAuZXhpc3RzKSB7XG4gICAgICAgIHNob3dOb0RhdGEoKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgZG9jID0gc25hcC5kYXRhKCk7XG4gICAgICBjYXJ0ZXJhRG9jQ2FjaGUuc2V0KHNlbGVjdGVkVmVuZG9yLCBkb2MpO1xuICAgIH1cbiAgICByZW5kZXJEYXNoYm9hcmQoZG9jKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGNvbnNvbGUuZXJyb3IoJ29uQ2FydGVyYVZlbmRvckNoYW5nZSBmYWlsZWQnLCBlKTtcbiAgICBzaG93RXJyb3IoU3RyaW5nKGUpKTtcbiAgfVxufTtcblxuLyoqIEB0eXBlIHthbnl9ICovICh3aW5kb3cpLm9uQ2FydGVyYUNoaXBDbGljayA9IGZ1bmN0aW9uIG9uQ2FydGVyYUNoaXBDbGljayhjaGlwSWQpIHtcbiAgYWN0aXZlQ2hpcCA9IGNoaXBJZDtcbiAgaWYgKCFzZWxlY3RlZFZlbmRvcikgcmV0dXJuO1xuICBjb25zdCBkb2MgPSBjYXJ0ZXJhRG9jQ2FjaGUuZ2V0KHNlbGVjdGVkVmVuZG9yKTtcbiAgaWYgKGRvYykgcmVuZGVyRGFzaGJvYXJkKGRvYyk7XG59O1xuXG4vKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIHNldFRpbWVvdXQ+fG51bGx9ICovXG5sZXQgc2VhcmNoRGVib3VuY2VUaW1lciA9IG51bGw7XG53aW5kb3cub25DYXJ0ZXJhU2VhcmNoQ2hhbmdlID0gZnVuY3Rpb24gb25DYXJ0ZXJhU2VhcmNoQ2hhbmdlKCkge1xuICBjb25zdCBpbnB1dCA9IC8qKiBAdHlwZSB7SFRNTElucHV0RWxlbWVudHxudWxsfSAqLyAoZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2NhcnRlcmEtc2VhcmNoJykpO1xuICBpZiAoIWlucHV0KSByZXR1cm47XG4gIGlmIChzZWFyY2hEZWJvdW5jZVRpbWVyKSBjbGVhclRpbWVvdXQoc2VhcmNoRGVib3VuY2VUaW1lcik7XG4gIHNlYXJjaERlYm91bmNlVGltZXIgPSBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICBzZWFyY2hRdWVyeSA9IChpbnB1dC52YWx1ZSB8fCAnJykudHJpbSgpLnRvTG93ZXJDYXNlKCk7XG4gICAgaWYgKCFzZWxlY3RlZFZlbmRvcikgcmV0dXJuO1xuICAgIGNvbnN0IGRvYyA9IGNhcnRlcmFEb2NDYWNoZS5nZXQoc2VsZWN0ZWRWZW5kb3IpO1xuICAgIGlmIChkb2MpIHJlbmRlckRhc2hib2FyZChkb2MpO1xuICB9LCAzMDApO1xufTtcblxuLyoqIEB0eXBlIHthbnl9ICovICh3aW5kb3cpLm9uQ2FydGVyYVNvcnRDbGljayA9IGZ1bmN0aW9uIG9uQ2FydGVyYVNvcnRDbGljayhjb2xLZXkpIHtcbiAgaWYgKHNvcnRCeSA9PT0gY29sS2V5KSBzb3J0RGlyID0gc29ydERpciA9PT0gJ2FzYycgPyAnZGVzYycgOiAnYXNjJztcbiAgZWxzZSB7XG4gICAgc29ydEJ5ID0gY29sS2V5O1xuICAgIHNvcnREaXIgPSAnZGVzYyc7XG4gIH1cbiAgaWYgKCFzZWxlY3RlZFZlbmRvcikgcmV0dXJuO1xuICBjb25zdCBkb2MgPSBjYXJ0ZXJhRG9jQ2FjaGUuZ2V0KHNlbGVjdGVkVmVuZG9yKTtcbiAgaWYgKGRvYykgcmVuZGVyRGFzaGJvYXJkKGRvYyk7XG59O1xuXG4vLyA9PT0gUmVuZGVyID09PVxuZnVuY3Rpb24gcmVuZGVyRGFzaGJvYXJkKGRvYykge1xuICBjb25zdCBzdWJ0aXRsZSA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdjYXJ0ZXJhLXN1YnRpdGxlJyk7XG4gIGlmIChzdWJ0aXRsZSkgc3VidGl0bGUudGV4dENvbnRlbnQgPSBgJHtkb2MuY291bnRzLnRvdGFsfSBjbGllbnRlcyBlbiBjYXJ0ZXJhLmA7XG4gIGNvbnN0IGluZm8gPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY2FydGVyYS1zbmFwc2hvdC1pbmZvJyk7XG4gIGlmIChpbmZvKSBpbmZvLnRleHRDb250ZW50ID0gYFNuYXBzaG90OiAke2RvYy5zbmFwc2hvdERhdGV9YDtcbiAgcmVuZGVyS3Bpcyhkb2MuY291bnRzKTtcbiAgcmVuZGVyQ2hpcHMoZG9jLmNvdW50cyk7XG4gIHJlbmRlclRhYmxlKGRvYy5jbGllbnRlcyk7XG4gIHNob3dUYWJsZSgpO1xufVxuXG5mdW5jdGlvbiByZW5kZXJLcGlzKGNvdW50cykge1xuICBjb25zdCBlbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdjYXJ0ZXJhLWtwaXMnKTtcbiAgaWYgKCFlbCkgcmV0dXJuO1xuICB3aGlsZSAoZWwuZmlyc3RDaGlsZCkgZWwucmVtb3ZlQ2hpbGQoZWwuZmlyc3RDaGlsZCk7XG4gIGZvciAoY29uc3Qgc3BlYyBvZiBLUElfQ0FSRFMpIHtcbiAgICBjb25zdCBjYXJkID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2Jyk7XG4gICAgY29uc3QgaXNBY3RpdmUgPSBhY3RpdmVDaGlwID09PSBzcGVjLmNoaXA7XG4gICAgY2FyZC5zdHlsZS5jc3NUZXh0ID0gYHBhZGRpbmc6MTBweCAxNHB4O2JvcmRlcjoycHggc29saWQgJHtpc0FjdGl2ZSA/IHNwZWMuY29sb3IgOiAndmFyKC0tYm9yZGVyLWxpZ2h0KSd9O2JvcmRlci1yYWRpdXM6OHB4O2N1cnNvcjpwb2ludGVyO2JhY2tncm91bmQ6JHtpc0FjdGl2ZSA/IGAke3NwZWMuY29sb3J9MTVgIDogJ3ZhcigtLWJnLWNhcmQpJ307bWluLXdpZHRoOjEyMHB4O2ZsZXg6MTttYXgtd2lkdGg6MjAwcHhgO1xuICAgIGNhcmQuYWRkRXZlbnRMaXN0ZW5lcignY2xpY2snLCAoKSA9PiAvKiogQHR5cGUge2FueX0gKi8gKHdpbmRvdykub25DYXJ0ZXJhQ2hpcENsaWNrKHNwZWMuY2hpcCkpO1xuICAgIGNvbnN0IG4gPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKTtcbiAgICBuLnN0eWxlLmNzc1RleHQgPSBgZm9udC1zaXplOjIycHg7Zm9udC13ZWlnaHQ6ODAwO2NvbG9yOiR7c3BlYy5jb2xvcn1gO1xuICAgIG4udGV4dENvbnRlbnQgPSBTdHJpbmcoY291bnRzW3NwZWMuY2hpcCA9PT0gJ3RvZG9zJyA/ICd0b3RhbCcgOiBzcGVjLmNoaXBdKTtcbiAgICBjb25zdCBsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2Jyk7XG4gICAgbC5zdHlsZS5jc3NUZXh0ID0gJ2ZvbnQtc2l6ZToxMXB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO21hcmdpbi10b3A6MnB4JztcbiAgICBsLnRleHRDb250ZW50ID0gc3BlYy5sYWJlbDtcbiAgICBjYXJkLmFwcGVuZENoaWxkKG4pO1xuICAgIGNhcmQuYXBwZW5kQ2hpbGQobCk7XG4gICAgZWwuYXBwZW5kQ2hpbGQoY2FyZCk7XG4gIH1cbn1cblxuZnVuY3Rpb24gcmVuZGVyQ2hpcHMoY291bnRzKSB7XG4gIGNvbnN0IGVsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2NhcnRlcmEtY2hpcHMnKTtcbiAgaWYgKCFlbCkgcmV0dXJuO1xuICBjb25zdCBjb3VudEJ5Q2hpcCA9IHtcbiAgICB0b2RvczogY291bnRzLnRvdGFsLFxuICAgIGJhc2VBY3RpdmE5MGQ6IGNvdW50cy5iYXNlQWN0aXZhOTBkLFxuICAgIGRvcm1pZG9zVmlzaXRhMzBkOiBjb3VudHMuZG9ybWlkb3NWaXNpdGEzMGQsXG4gICAgZG9ybWlkb3NDb21wcmE5MGQ6IGNvdW50cy5kb3JtaWRvc0NvbXByYTkwZCxcbiAgICBudW5jYVZpc2l0YWRvczogY291bnRzLm51bmNhVmlzaXRhZG9zLFxuICAgIG51bmNhQ29tcHJhcm9uOiBjb3VudHMubnVuY2FDb21wcmFyb24sXG4gIH07XG4gIHdoaWxlIChlbC5maXJzdENoaWxkKSBlbC5yZW1vdmVDaGlsZChlbC5maXJzdENoaWxkKTtcbiAgZm9yIChjb25zdCBjaGlwIG9mIENISVBTKSB7XG4gICAgY29uc3QgYiA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2J1dHRvbicpO1xuICAgIGNvbnN0IGlzQWN0aXZlID0gYWN0aXZlQ2hpcCA9PT0gY2hpcC5pZDtcbiAgICBiLnN0eWxlLmNzc1RleHQgPSBgcGFkZGluZzo0cHggMTBweDtib3JkZXItcmFkaXVzOjk5OXB4O2JvcmRlcjoxcHggc29saWQgJHtpc0FjdGl2ZSA/ICcjMWUzYThhJyA6ICd2YXIoLS1ib3JkZXIpJ307YmFja2dyb3VuZDoke2lzQWN0aXZlID8gJyMxZTNhOGEnIDogJ3ZhcigtLWJnLWNhcmQpJ307Y29sb3I6JHtpc0FjdGl2ZSA/ICd3aGl0ZScgOiAndmFyKC0tdGV4dC1wcmltYXJ5KSd9O2ZvbnQtc2l6ZToxMnB4O2N1cnNvcjpwb2ludGVyO2ZvbnQtd2VpZ2h0OiR7aXNBY3RpdmUgPyAnNzAwJyA6ICc1MDAnfWA7XG4gICAgYi50ZXh0Q29udGVudCA9IGAke2NoaXAubGFiZWx9ICgke2NvdW50QnlDaGlwW2NoaXAuaWRdfSlgO1xuICAgIGIuYWRkRXZlbnRMaXN0ZW5lcignY2xpY2snLCAoKSA9PiAvKiogQHR5cGUge2FueX0gKi8gKHdpbmRvdykub25DYXJ0ZXJhQ2hpcENsaWNrKGNoaXAuaWQpKTtcbiAgICBlbC5hcHBlbmRDaGlsZChiKTtcbiAgfVxufVxuXG4vKiogQHBhcmFtIHtBcnJheTxhbnk+fSBjbGllbnRlcyAqL1xuZnVuY3Rpb24gcmVuZGVyVGFibGUoY2xpZW50ZXMpIHtcbiAgY29uc3QgdGFibGUgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY2FydGVyYS10YWJsZScpO1xuICBpZiAoIXRhYmxlKSByZXR1cm47XG4gIGNvbnN0IGZpbHRlcmVkID0gYXBwbHlDaGlwRmlsdGVyKGNsaWVudGVzLCBhY3RpdmVDaGlwKTtcbiAgY29uc3Qgc2VhcmNoZWQgPSBzZWFyY2hRdWVyeVxuICAgID8gZmlsdGVyZWQuZmlsdGVyKChjKSA9PiBTdHJpbmcoYy5jbGllbnROYW1lIHx8ICcnKS50b0xvd2VyQ2FzZSgpLmluY2x1ZGVzKHNlYXJjaFF1ZXJ5KSlcbiAgICA6IGZpbHRlcmVkO1xuICBjb25zdCBzb3J0ZWQgPSBzb3J0Q2xpZW50ZXMoc2VhcmNoZWQsIHNvcnRCeSwgc29ydERpcik7XG4gIHdoaWxlICh0YWJsZS5maXJzdENoaWxkKSB0YWJsZS5yZW1vdmVDaGlsZCh0YWJsZS5maXJzdENoaWxkKTtcbiAgdGFibGUuYXBwZW5kQ2hpbGQoYnVpbGRUaGVhZCgpKTtcbiAgdGFibGUuYXBwZW5kQ2hpbGQoYnVpbGRUYm9keShzb3J0ZWQpKTtcbn1cblxuZnVuY3Rpb24gYnVpbGRUaGVhZCgpIHtcbiAgY29uc3QgdGhlYWQgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCd0aGVhZCcpO1xuICBjb25zdCB0ciA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3RyJyk7XG4gIHRyLnN0eWxlLmNzc1RleHQgPVxuICAgICdwb3NpdGlvbjpzdGlja3k7dG9wOjA7YmFja2dyb3VuZDp2YXIoLS1iZy1jYXJkKTtib3JkZXItYm90dG9tOjJweCBzb2xpZCB2YXIoLS1ib3JkZXIpO2ZvbnQtd2VpZ2h0OjcwMDtmb250LXNpemU6MTJweDt0ZXh0LWFsaWduOmxlZnQnO1xuICBjb25zdCBoZWFkZXJzID0gW1xuICAgIHsgbGFiZWw6ICdDbGllbnRlJywgc29ydEtleTogJ2NsaWVudE5hbWUnLCBhbGlnbjogJ2xlZnQnIH0sXG4gICAgeyBsYWJlbDogJ1Byb3YvTG9jJywgc29ydEtleTogbnVsbCwgYWxpZ246ICdsZWZ0JyB9LFxuICAgIHsgbGFiZWw6ICdUaXBvJywgc29ydEtleTogbnVsbCwgYWxpZ246ICdjZW50ZXInIH0sXG4gICAgeyBsYWJlbDogJ1x1MDBEQWx0LiB2aXNpdGEnLCBzb3J0S2V5OiAnZGlhc1NpblZpc2l0YVByZXNlbmNpYWwnLCBhbGlnbjogJ2xlZnQnIH0sXG4gICAgeyBsYWJlbDogJ1x1MDBEQWx0LiBjb250YWN0bycsIHNvcnRLZXk6ICdkaWFzU2luQ29udGFjdG8nLCBhbGlnbjogJ2xlZnQnIH0sXG4gICAgeyBsYWJlbDogJ1x1MDBEQWx0LiBjb21wcmEnLCBzb3J0S2V5OiAnZGlhc1NpbkNvbXByYScsIGFsaWduOiAnbGVmdCcgfSxcbiAgICB7IGxhYmVsOiAnRmFjdCAxMk0nLCBzb3J0S2V5OiAnZmFjdHVyYWRvMTJNJywgYWxpZ246ICdyaWdodCcgfSxcbiAgICB7IGxhYmVsOiAnRGV1ZGEnLCBzb3J0S2V5OiAnZGV1ZGFBYmllcnRhJywgYWxpZ246ICdyaWdodCcgfSxcbiAgXTtcbiAgZm9yIChjb25zdCBoIG9mIGhlYWRlcnMpIHtcbiAgICBjb25zdCB0aCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3RoJyk7XG4gICAgdGguc3R5bGUucGFkZGluZyA9ICc4cHgnO1xuICAgIHRoLnN0eWxlLnRleHRBbGlnbiA9IGguYWxpZ247XG4gICAgdGgudGV4dENvbnRlbnQgPSBoLmxhYmVsO1xuICAgIGlmIChoLnNvcnRLZXkpIHtcbiAgICAgIHRoLnN0eWxlLmN1cnNvciA9ICdwb2ludGVyJztcbiAgICAgIGNvbnN0IGtleSA9IGguc29ydEtleTtcbiAgICAgIHRoLmFkZEV2ZW50TGlzdGVuZXIoJ2NsaWNrJywgKCkgPT4gLyoqIEB0eXBlIHthbnl9ICovICh3aW5kb3cpLm9uQ2FydGVyYVNvcnRDbGljayhrZXkpKTtcbiAgICB9XG4gICAgdHIuYXBwZW5kQ2hpbGQodGgpO1xuICB9XG4gIHRoZWFkLmFwcGVuZENoaWxkKHRyKTtcbiAgcmV0dXJuIHRoZWFkO1xufVxuXG4vKiogQHBhcmFtIHtBcnJheTxhbnk+fSBzb3J0ZWRDbGllbnRlcyAqL1xuZnVuY3Rpb24gYnVpbGRUYm9keShzb3J0ZWRDbGllbnRlcykge1xuICBjb25zdCB0Ym9keSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3Rib2R5Jyk7XG4gIGZvciAoY29uc3QgYyBvZiBzb3J0ZWRDbGllbnRlcykge1xuICAgIHRib2R5LmFwcGVuZENoaWxkKGJ1aWxkQ2xpZW50ZVJvdyhjKSk7XG4gIH1cbiAgcmV0dXJuIHRib2R5O1xufVxuXG4vKiogQHBhcmFtIHthbnl9IGMgKi9cbmZ1bmN0aW9uIGJ1aWxkQ2xpZW50ZVJvdyhjKSB7XG4gIGNvbnN0IHRyID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgndHInKTtcbiAgdHIuc3R5bGUuY3NzVGV4dCA9ICdjdXJzb3I6cG9pbnRlcjtib3JkZXItYm90dG9tOjFweCBzb2xpZCB2YXIoLS1ib3JkZXItbGlnaHQpJztcbiAgdHIuYWRkRXZlbnRMaXN0ZW5lcignbW91c2VlbnRlcicsICgpID0+IHtcbiAgICB0ci5zdHlsZS5iYWNrZ3JvdW5kID0gJ3ZhcigtLWJnLWhvdmVyKSc7XG4gIH0pO1xuICB0ci5hZGRFdmVudExpc3RlbmVyKCdtb3VzZWxlYXZlJywgKCkgPT4ge1xuICAgIHRyLnN0eWxlLmJhY2tncm91bmQgPSAnJztcbiAgfSk7XG4gIHRyLmFkZEV2ZW50TGlzdGVuZXIoJ2NsaWNrJywgKCkgPT4ge1xuICAgIC8vIEB0cy1pZ25vcmVcbiAgICBpZiAodHlwZW9mIHdpbmRvdy5vcGVuRmljaGFDbGllbnRlID09PSAnZnVuY3Rpb24nKSB3aW5kb3cub3BlbkZpY2hhQ2xpZW50ZShjLmNsaWVudElkKTtcbiAgfSk7XG5cbiAgY29uc3QgdGROYW1lID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgndGQnKTtcbiAgdGROYW1lLnN0eWxlLmNzc1RleHQgPSAncGFkZGluZzo2cHggOHB4O2ZvbnQtd2VpZ2h0OjYwMCc7XG4gIHRkTmFtZS50ZXh0Q29udGVudCA9IGMuY2xpZW50TmFtZSB8fCAnJztcbiAgdHIuYXBwZW5kQ2hpbGQodGROYW1lKTtcblxuICBjb25zdCB0ZExvYyA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3RkJyk7XG4gIHRkTG9jLnN0eWxlLmNzc1RleHQgPSAncGFkZGluZzo2cHggOHB4O2ZvbnQtc2l6ZToxMnB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpJztcbiAgdGRMb2MudGV4dENvbnRlbnQgPSBgJHtjLnByb3ZpbmNpYSB8fCAnJ30vJHtjLmxvY2FsaWRhZCB8fCAnJ31gO1xuICB0ci5hcHBlbmRDaGlsZCh0ZExvYyk7XG5cbiAgY29uc3QgdGRUaXBvID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgndGQnKTtcbiAgdGRUaXBvLnN0eWxlLmNzc1RleHQgPSAncGFkZGluZzo2cHggOHB4O3RleHQtYWxpZ246Y2VudGVyJztcbiAgY29uc3QgdGlwb0JhZGdlID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnc3BhbicpO1xuICB0aXBvQmFkZ2Uuc3R5bGUuY3NzVGV4dCA9XG4gICAgJ3BhZGRpbmc6MnB4IDZweDtib3JkZXItcmFkaXVzOjRweDtiYWNrZ3JvdW5kOnZhcigtLWJnLWlucHV0KTtmb250LXNpemU6MTFweDtmb250LXdlaWdodDo3MDAnO1xuICB0aXBvQmFkZ2UudGV4dENvbnRlbnQgPSBjLmNsaVRpcG8gfHwgJy0nO1xuICB0ZFRpcG8uYXBwZW5kQ2hpbGQodGlwb0JhZGdlKTtcbiAgdHIuYXBwZW5kQ2hpbGQodGRUaXBvKTtcblxuICB0ci5hcHBlbmRDaGlsZChidWlsZERhdGVDZWxsKGMudWx0aW1hVmlzaXRhUHJlc2VuY2lhbCwgYy5kaWFzU2luVmlzaXRhUHJlc2VuY2lhbCwgMzApKTtcbiAgdHIuYXBwZW5kQ2hpbGQoYnVpbGREYXRlQ2VsbChjLnVsdGltb0NvbnRhY3RvLCBjLmRpYXNTaW5Db250YWN0bywgbnVsbCkpO1xuICB0ci5hcHBlbmRDaGlsZChidWlsZERhdGVDZWxsKGMudWx0aW1hQ29tcHJhLCBjLmRpYXNTaW5Db21wcmEsIDkwKSk7XG5cbiAgY29uc3QgdGRGYWN0ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgndGQnKTtcbiAgdGRGYWN0LnN0eWxlLmNzc1RleHQgPSAncGFkZGluZzo2cHggOHB4O3RleHQtYWxpZ246cmlnaHQ7Zm9udC12YXJpYW50LW51bWVyaWM6dGFidWxhci1udW1zJztcbiAgdGRGYWN0LnRleHRDb250ZW50ID0gZm10TW9uZXkoYy5mYWN0dXJhZG8xMk0pO1xuICB0ci5hcHBlbmRDaGlsZCh0ZEZhY3QpO1xuXG4gIGNvbnN0IHRkRGV1ZGEgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCd0ZCcpO1xuICB0ZERldWRhLnN0eWxlLmNzc1RleHQgPSBgcGFkZGluZzo2cHggOHB4O3RleHQtYWxpZ246cmlnaHQ7Zm9udC12YXJpYW50LW51bWVyaWM6dGFidWxhci1udW1zO2NvbG9yOiR7Yy5kZXVkYUFiaWVydGEgPiAwID8gJyNkYzI2MjYnIDogJ3ZhcigtLXRleHQtbXV0ZWQpJ31gO1xuICB0ZERldWRhLnRleHRDb250ZW50ID0gZm10TW9uZXkoYy5kZXVkYUFiaWVydGEpO1xuICB0ci5hcHBlbmRDaGlsZCh0ZERldWRhKTtcblxuICByZXR1cm4gdHI7XG59XG5cbi8qKlxuICogQHBhcmFtIHtzdHJpbmd8bnVsbH0gZmVjaGFJc29cbiAqIEBwYXJhbSB7bnVtYmVyfG51bGx9IGRpYXNcbiAqIEBwYXJhbSB7bnVtYmVyfG51bGx9IGRhbmdlclRocmVzaG9sZFxuICovXG5mdW5jdGlvbiBidWlsZERhdGVDZWxsKGZlY2hhSXNvLCBkaWFzLCBkYW5nZXJUaHJlc2hvbGQpIHtcbiAgY29uc3QgdGQgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCd0ZCcpO1xuICBjb25zdCBpc0RhbmdlciA9XG4gICAgZGFuZ2VyVGhyZXNob2xkICE9PSBudWxsICYmIGRpYXMgIT09IG51bGwgJiYgZGlhcyAhPT0gdW5kZWZpbmVkICYmIGRpYXMgPiBkYW5nZXJUaHJlc2hvbGQ7XG4gIHRkLnN0eWxlLmNzc1RleHQgPSBgcGFkZGluZzo2cHggOHB4O2NvbG9yOiR7aXNEYW5nZXIgPyAnI2RjMjYyNicgOiAndmFyKC0tdGV4dC1wcmltYXJ5KSd9YDtcbiAgaWYgKCFmZWNoYUlzbykge1xuICAgIHRkLnRleHRDb250ZW50ID0gJ1x1MjAxNCc7XG4gICAgcmV0dXJuIHRkO1xuICB9XG4gIGNvbnN0IHBhcnRzID0gU3RyaW5nKGZlY2hhSXNvKS5zcGxpdCgnLScpO1xuICBjb25zdCBkID0gcGFydHNbMl0gfHwgJyc7XG4gIGNvbnN0IG0gPSBwYXJ0c1sxXSB8fCAnJztcbiAgdGQudGV4dENvbnRlbnQgPSBgJHtkfS8ke219YDtcbiAgY29uc3QgZGlhc0VsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnc21hbGwnKTtcbiAgZGlhc0VsLnN0eWxlLmNzc1RleHQgPSAnY29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7bWFyZ2luLWxlZnQ6NHB4JztcbiAgZGlhc0VsLnRleHRDb250ZW50ID0gYCR7ZGlhc31kYDtcbiAgdGQuYXBwZW5kQ2hpbGQoZGlhc0VsKTtcbiAgcmV0dXJuIHRkO1xufVxuXG4vKiogQHBhcmFtIHtudW1iZXJ9IG4gKi9cbmZ1bmN0aW9uIGZtdE1vbmV5KG4pIHtcbiAgaWYgKCFuIHx8IG4gPT09IDApIHJldHVybiAnLSc7XG4gIGlmIChuID49IDFfMDAwXzAwMCkgcmV0dXJuIGAkICR7KG4gLyAxXzAwMF8wMDApLnRvRml4ZWQoMSl9TWA7XG4gIGlmIChuID49IDFfMDAwKSByZXR1cm4gYCQgJHsobiAvIDFfMDAwKS50b0ZpeGVkKDApfWtgO1xuICByZXR1cm4gYCQgJHtufWA7XG59XG5cbi8vID09PSBVSSBzdGF0ZSBoZWxwZXJzID09PVxuZnVuY3Rpb24gaGlkZUFsbCgpIHtcbiAgY29uc3QgaWRzID0gWydjYXJ0ZXJhLWxvYWRpbmcnLCAnY2FydGVyYS10YWJsZScsICdjYXJ0ZXJhLWtwaXMnLCAnY2FydGVyYS1jaGlwcycsICdjYXJ0ZXJhLWVtcHR5J107XG4gIGZvciAoY29uc3QgaWQgb2YgaWRzKSB7XG4gICAgY29uc3QgZWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZChpZCk7XG4gICAgaWYgKGVsKSBlbC5zdHlsZS5kaXNwbGF5ID0gJ25vbmUnO1xuICB9XG59XG5mdW5jdGlvbiBzaG93RW1wdHkoKSB7XG4gIGhpZGVBbGwoKTtcbiAgY29uc3QgZW1wdHkgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY2FydGVyYS1lbXB0eScpO1xuICBpZiAoZW1wdHkpIHtcbiAgICBlbXB0eS5zdHlsZS5kaXNwbGF5ID0gJ2Jsb2NrJztcbiAgICBlbXB0eS50ZXh0Q29udGVudCA9ICdFbGVnXHUwMEVEIHVuIHZlbmRlZG9yIHBhcmEgdmVyIHN1IGNhcnRlcmEuJztcbiAgfVxufVxuZnVuY3Rpb24gc2hvd0xvYWRpbmcoKSB7XG4gIGhpZGVBbGwoKTtcbiAgY29uc3QgbG9hZGluZyA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdjYXJ0ZXJhLWxvYWRpbmcnKTtcbiAgaWYgKGxvYWRpbmcpIGxvYWRpbmcuc3R5bGUuZGlzcGxheSA9ICdibG9jayc7XG59XG5mdW5jdGlvbiBzaG93Tm9EYXRhKCkge1xuICBoaWRlQWxsKCk7XG4gIGNvbnN0IGVtcHR5ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2NhcnRlcmEtZW1wdHknKTtcbiAgaWYgKGVtcHR5KSB7XG4gICAgZW1wdHkuc3R5bGUuZGlzcGxheSA9ICdibG9jayc7XG4gICAgZW1wdHkudGV4dENvbnRlbnQgPVxuICAgICAgJ1NpbiBjYXJ0ZXJhIHBhcmEgZXN0ZSB2ZW5kZWRvci4gVmVyaWZpY1x1MDBFMSBhc3NpZ25lZFZlbmRvciBlbiBjbGllbnRfbWFzdGVyIG8gZXNwZXJcdTAwRTEgYWwgcHJcdTAwRjN4aW1vIHNuYXBzaG90ICgwNDowMCBBUlQpLic7XG4gIH1cbn1cbi8qKiBAcGFyYW0ge3N0cmluZ30gbXNnICovXG5mdW5jdGlvbiBzaG93RXJyb3IobXNnKSB7XG4gIGhpZGVBbGwoKTtcbiAgY29uc3QgZW1wdHkgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY2FydGVyYS1lbXB0eScpO1xuICBpZiAoZW1wdHkpIHtcbiAgICBlbXB0eS5zdHlsZS5kaXNwbGF5ID0gJ2Jsb2NrJztcbiAgICBlbXB0eS5zdHlsZS5jb2xvciA9ICcjZGMyNjI2JztcbiAgICBlbXB0eS50ZXh0Q29udGVudCA9IGBFcnJvciBjYXJnYW5kbyBjYXJ0ZXJhOiAke21zZ31gO1xuICB9XG59XG5mdW5jdGlvbiBzaG93VGFibGUoKSB7XG4gIGNvbnN0IGVtcHR5ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2NhcnRlcmEtZW1wdHknKTtcbiAgaWYgKGVtcHR5KSBlbXB0eS5zdHlsZS5kaXNwbGF5ID0gJ25vbmUnO1xuICBjb25zdCBsb2FkaW5nID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2NhcnRlcmEtbG9hZGluZycpO1xuICBpZiAobG9hZGluZykgbG9hZGluZy5zdHlsZS5kaXNwbGF5ID0gJ25vbmUnO1xuICBjb25zdCB0YWJsZSA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdjYXJ0ZXJhLXRhYmxlJyk7XG4gIGlmICh0YWJsZSkgdGFibGUuc3R5bGUuZGlzcGxheSA9ICd0YWJsZSc7XG4gIGNvbnN0IGtwaXMgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY2FydGVyYS1rcGlzJyk7XG4gIGlmIChrcGlzKSBrcGlzLnN0eWxlLmRpc3BsYXkgPSAnZmxleCc7XG4gIGNvbnN0IGNoaXBzID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2NhcnRlcmEtY2hpcHMnKTtcbiAgaWYgKGNoaXBzKSBjaGlwcy5zdHlsZS5kaXNwbGF5ID0gJ2ZsZXgnO1xufVxuXG4vLyA9PT0gRXhwb3J0IEV4Y2VsIChzdHViIFx1MjAxNCBUYXNrIDEyIGNvbXBsZXRhKSA9PT1cbi8vIEB0cy1pZ25vcmVcbndpbmRvdy5leHBvcnRDYXJ0ZXJhVG9FeGNlbCA9IGZ1bmN0aW9uIGV4cG9ydENhcnRlcmFUb0V4Y2VsKCkge1xuICBhbGVydCgnRXhwb3J0YXI6IHBlbmRpZW50ZSBkZSBpbXBsZW1lbnRhY2lcdTAwRjNuIGVuIFRhc2sgMTIuJyk7XG59O1xuIl0sCiAgIm1hcHBpbmdzIjogIjs7O0FBZU8sV0FBUyxnQkFBZ0IsVUFBVSxNQUFNO0FBQzlDLFFBQUksQ0FBQyxNQUFNLFFBQVEsUUFBUSxFQUFHLFFBQU8sQ0FBQztBQUN0QyxZQUFRLE1BQU07QUFBQSxNQUNaLEtBQUs7QUFDSCxlQUFPLFNBQVM7QUFBQSxVQUNkLENBQUMsTUFDQyxFQUFFLGtCQUFrQixRQUFRLEVBQUUsa0JBQWtCLFVBQWEsRUFBRSxpQkFBaUI7QUFBQSxRQUNwRjtBQUFBLE1BQ0YsS0FBSztBQUNILGVBQU8sU0FBUztBQUFBLFVBQ2QsQ0FBQyxNQUND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QU87QUFDMUIsUUFBSSxLQUFLLElBQVcsUUFBTyxNQUFNLElBQUksS0FBVyxRQUFRLENBQUMsQ0FBQztBQUMxRCxRQUFJLEtBQUssSUFBTyxRQUFPLE1BQU0sSUFBSSxLQUFPLFFBQVEsQ0FBQyxDQUFDO0FBQ2xELFdBQU8sS0FBSyxDQUFDO0FBQUEsRUFDZjtBQUdBLFdBQVMsVUFBVTtBQUNqQixVQUFNLE1BQU0sQ0FBQyxtQkFBbUIsaUJBQWlCLGdCQUFnQixpQkFBaUIsZUFBZTtBQUNqRyxlQUFXLE1BQU0sS0FBSztBQUNwQixZQUFNLEtBQUssU0FBUyxlQUFlLEVBQUU7QUFDckMsVUFBSSxHQUFJLElBQUcsTUFBTSxVQUFVO0FBQUEsSUFDN0I7QUFBQSxFQUNGO0FBQ0EsV0FBUyxZQUFZO0FBQ25CLFlBQVE7QUFDUixVQUFNLFFBQVEsU0FBUyxlQUFlLGVBQWU7QUFDckQsUUFBSSxPQUFPO0FBQ1QsWUFBTSxNQUFNLFVBQVU7QUFDdEIsWUFBTSxjQUFjO0FBQUEsSUFDdEI7QUFBQSxFQUNGO0FBQ0EsV0FBUyxjQUFjO0FBQ3JCLFlBQVE7QUFDUixVQUFNLFVBQVUsU0FBUyxlQUFlLGlCQUFpQjtBQUN6RCxRQUFJLFFBQVMsU0FBUSxNQUFNLFVBQVU7QUFBQSxFQUN2QztBQUNBLFdBQVMsYUFBYTtBQUNwQixZQUFRO0FBQ1IsVUFBTSxRQUFRLFNBQVMsZUFBZSxlQUFlO0FBQ3JELFFBQUksT0FBTztBQUNULFlBQU0sTUFBTSxVQUFVO0FBQ3RCLFlBQU0sY0FDSjtBQUFBLElBQ0o7QUFBQSxFQUNGO0FBRUEsV0FBUyxVQUFVLEtBQUs7QUFDdEIsWUFBUTtBQUNSLFVBQU0sUUFBUSxTQUFTLGVBQWUsZUFBZTtBQUNyRCxRQUFJLE9BQU87QUFDVCxZQUFNLE1BQU0sVUFBVTtBQUN0QixZQUFNLE1BQU0sUUFBUTtBQUNwQixZQUFNLGNBQWMsMkJBQTJCLEdBQUc7QUFBQSxJQUNwRDtBQUFBLEVBQ0Y7QUFDQSxXQUFTLFlBQVk7QUFDbkIsVUFBTSxRQUFRLFNBQVMsZUFBZSxlQUFlO0FBQ3JELFFBQUksTUFBTyxPQUFNLE1BQU0sVUFBVTtBQUNqQyxVQUFNLFVBQVUsU0FBUyxlQUFlLGlCQUFpQjtBQUN6RCxRQUFJLFFBQVMsU0FBUSxNQUFNLFVBQVU7QUFDckMsVUFBTSxRQUFRLFNBQVMsZUFBZSxlQUFlO0FBQ3JELFFBQUksTUFBTyxPQUFNLE1BQU0sVUFBVTtBQUNqQyxVQUFNLE9BQU8sU0FBUyxlQUFlLGNBQWM7QUFDbkQsUUFBSSxLQUFNLE1BQUssTUFBTSxVQUFVO0FBQy9CLFVBQU0sUUFBUSxTQUFTLGVBQWUsZUFBZTtBQUNyRCxRQUFJLE1BQU8sT0FBTSxNQUFNLFVBQVU7QUFBQSxFQUNuQztBQUlBLFNBQU8sdUJBQXVCLFNBQVMsdUJBQXVCO0FBQzVELFVBQU0sc0RBQW1EO0FBQUEsRUFDM0Q7IiwKICAibmFtZXMiOiBbInNvcnRCeSIsICJzb3J0RGlyIl0KfQo=
