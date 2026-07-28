"use strict";
(() => {
  // src/domains/exports-advanced.js
  function todayStr() {
    return (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  }
  function dataUrlToBlob(dataUrl) {
    if (!dataUrl) return null;
    const parts = dataUrl.split(",");
    if (parts.length < 2) return null;
    const mimeMatch = parts[0].match(/:(.*?);/);
    const mime = mimeMatch ? mimeMatch[1] : "image/jpeg";
    const bytes = atob(parts[1]);
    const arr = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }
  function sanitizeForPath(s) {
    return String(s || "").replace(/[\\/*?\[\]:|"<>]/g, "_").replace(/\s+/g, " ").trim().slice(0, 60);
  }
  window.exportPhotosZip = async function() {
    if (typeof JSZip === "undefined") {
      alert("Cargando libreria ZIP, intenta de nuevo en 5 segundos.");
      return;
    }
    if (!visitsCache || !visitsCache.length) {
      alert("No hay visitas registradas.");
      return;
    }
    let photoCount = 0;
    const zip = new JSZip();
    visitsCache.forEach((v) => {
      const vendor = sanitizeForPath(titleCase(v.vendor || "SIN_VENDEDOR"));
      const tienda = sanitizeForPath(v.tienda || "sin_tienda");
      const fecha = (v.fecha || "").replace(/-/g, "");
      const folderName = vendor + "/" + tienda + "_" + fecha;
      const folder = zip.folder(folderName);
      if (v.frenteLocal) {
        const b = dataUrlToBlob(v.frenteLocal);
        if (b) {
          folder.file("frente.jpg", b);
          photoCount++;
        }
      }
      (v.espacio || []).forEach((b64, i) => {
        const b = dataUrlToBlob(b64);
        if (b) {
          folder.file("espacio_" + (i + 1) + ".jpg", b);
          photoCount++;
        }
      });
    });
    if (!photoCount) {
      alert("No hay fotos cargadas en las visitas.");
      return;
    }
    showSyncTag("Generando ZIP de " + photoCount + " fotos...", 3e4);
    try {
      const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "Shimano_Fotos_Visitas_" + todayStr() + ".zip";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5e3);
      showSyncTag(photoCount + " fotos descargadas", 3e3);
    } catch (e) {
      console.error("zip", e);
      alert("Error generando ZIP: " + (e.message || e));
    }
  };
  function loadExcelJS() {
    return new Promise((resolve, reject) => {
      if (typeof ExcelJS !== "undefined") return resolve();
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js";
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("No se pudo cargar la libreria ExcelJS. Revisa tu conexion a internet."));
      document.head.appendChild(s);
    });
  }
  window.exportVisitsWithEmbeddedPhotos = async function() {
    if (!visitsCache || !visitsCache.length) {
      alert("No hay visitas registradas.");
      return;
    }
    const n = visitsCache.length;
    if (n > 300) {
      if (!confirm("Hay " + n + " visitas. El Excel con todas las fotos embebidas puede pesar 50-150 MB y tardar varios minutos. \xBFContinuar?")) return;
    } else if (n > 100) {
      if (!confirm("Vas a generar un Excel con " + n + " visitas y sus fotos embebidas. Puede tardar 30-60 segundos. \xBFContinuar?")) return;
    }
    showSyncTag("Cargando ExcelJS...", 2e3);
    try {
      await loadExcelJS();
    } catch (e) {
      alert(e.message || e);
      return;
    }
    showSyncTag("Generando Excel con " + n + " visitas...", 3e3);
    const wb = new ExcelJS.Workbook();
    wb.creator = "App Vendedores Shimano";
    wb.created = /* @__PURE__ */ new Date();
    const ws = wb.addWorksheet("Visitas", { views: [{ state: "frozen", ySplit: 1 }] });
    ws.columns = [
      { header: "Fecha", key: "fecha", width: 12 },
      { header: "Mes", key: "mes", width: 10 },
      { header: "Vendedor", key: "vendedor", width: 22 },
      { header: "Tipo contacto", key: "tipoCt", width: 12 },
      { header: "Comentario", key: "coment", width: 32 },
      { header: "Provincia", key: "provincia", width: 16 },
      { header: "Localidad", key: "localidad", width: 18 },
      { header: "Tienda", key: "tienda", width: 30 },
      { header: "Tipo", key: "tipo", width: 12 },
      { header: "Local", key: "local", width: 12 },
      { header: "Tamano", key: "tamano", width: 10 },
      { header: "Fidelidad", key: "fidelidad", width: 10 },
      { header: "Relevancia", key: "relev", width: 10 },
      { header: "POP", key: "pop", width: 8 },
      { header: "Tipo venta", key: "tipoVenta", width: 12 },
      { header: "Competencia", key: "compe", width: 16 },
      { header: "Oportunidad", key: "oportu", width: 30 },
      { header: "Lo mas vendido", key: "masVe", width: 28 },
      { header: "GPS dist (m)", key: "gpsDist", width: 12 },
      { header: "Foto frente", key: "foto", width: 22 },
      // <- la imagen va aca
      { header: "Email vendedor", key: "email", width: 28 }
    ];
    ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0C4A6E" } };
    ws.getRow(1).alignment = { vertical: "middle", horizontal: "center" };
    ws.getRow(1).height = 22;
    const FOTO_COL_IDX = ws.getColumn("foto").number - 1;
    const ROW_H = 100;
    const IMG_W = 130;
    const IMG_H = 90;
    const sorted = visitsCache.slice().sort((a, b) => (b.fecha || "").localeCompare(a.fecha || ""));
    for (const v of sorted) {
      const tipoContactoLbl = v.tipoContacto === "telefono" ? "Telefono" : "Presencial";
      const r = ws.addRow({
        fecha: v.fecha || "",
        mes: v.mes || "",
        vendedor: titleCase(v.vendor || ""),
        tipoCt: tipoContactoLbl,
        coment: v.comentario || "",
        provincia: titleCase(v.provincia || ""),
        localidad: v.localidad || "",
        tienda: v.tienda || "",
        tipo: v.tipo || "",
        local: v.local || "",
        tamano: v.tamano || "",
        fidelidad: v.fidelidad || "",
        relev: v.relevancia || "",
        pop: v.pop || "",
        tipoVenta: v.tipoVenta === "MOSTRADO" ? "MOSTRADOR" : v.tipoVenta || "",
        compe: v.competencia || "",
        oportu: v.oportunidad || "",
        masVe: v.masVendido || "",
        gpsDist: typeof v.gpsDistanceM === "number" ? v.gpsDistanceM : "",
        foto: "",
        // la celda queda vacia; encima va la imagen
        email: v.ownerEmail || ""
      });
      r.height = ROW_H;
      r.alignment = { vertical: "middle", wrapText: true };
      if (v.frenteLocal && typeof v.frenteLocal === "string") {
        try {
          let b64 = v.frenteLocal;
          let ext = "jpeg";
          const m = /^data:image\/(\w+);base64,(.+)$/i.exec(b64);
          if (m) {
            ext = m[1].toLowerCase();
            b64 = m[2];
          }
          if (ext === "jpg") ext = "jpeg";
          const imageId = wb.addImage({ base64: b64, extension: ext });
          ws.addImage(imageId, {
            tl: { col: FOTO_COL_IDX + 0.1, row: r.number - 1 + 0.1 },
            ext: { width: IMG_W, height: IMG_H },
            editAs: "oneCell"
          });
        } catch (e) {
          console.warn("embebiendo foto fila", r.number, e);
        }
      }
    }
    try {
      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "Shimano_Visitas_con_fotos_" + todayStr() + ".xlsx";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 5e3);
      showSyncTag("Excel descargado: " + sorted.length + " visitas", 3e3);
    } catch (e) {
      console.error("exportVisitsWithEmbeddedPhotos", e);
      alert("Error generando el Excel: " + (e.message || e));
    }
  };
  window.exportAuditExcel = function() {
    if (typeof XLSX === "undefined") {
      alert("La libreria de Excel no se cargo.");
      return;
    }
    const items = getFilteredAuditEntries();
    if (!items.length) {
      alert("No hay eventos para exportar con los filtros aplicados.");
      return;
    }
    const rows = items.map((e) => {
      const ts = e.timestamp && e.timestamp.toDate ? e.timestamp.toDate() : null;
      return {
        Fecha_Hora: ts ? ts.toISOString().replace("T", " ").slice(0, 19) : "",
        Usuario_Email: e.userEmail || "",
        Usuario_UID: e.userUid || "",
        Rol: e.userRole || "",
        Accion: AUDIT_ACTION_LABELS[e.action] || e.action || "",
        Accion_Raw: e.action || "",
        Tipo_Entidad: e.entityType || "",
        Entidad: e.entityName || "",
        Detalles_JSON: e.details ? JSON.stringify(e.details) : ""
      };
    });
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);
    ws["!cols"] = [{ wch: 20 }, { wch: 30 }, { wch: 30 }, { wch: 10 }, { wch: 24 }, { wch: 20 }, { wch: 14 }, { wch: 40 }, { wch: 60 }];
    XLSX.utils.book_append_sheet(wb, ws, "Auditoria");
    const stamp = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    XLSX.writeFile(wb, "Shimano_Auditoria_" + stamp + ".xlsx");
  };
  function buildContactadosRows() {
    const rows = [];
    contacted.forEach((key) => {
      const parts = key.split("|");
      const tipo = parts[0], province = parts[1], locName = parts[2], clientName = parts[3];
      const pt = POINTS.find((p) => p.province === province && p.name === locName);
      const vendor = pt ? pt.vendor : "";
      const vm = vendorLookup[vendor];
      rows.push({
        Tipo: tipo === "C" ? "Cliente actual" : "Prospecto",
        Cliente: clientName,
        Provincia: titleCase(province),
        Localidad: locName,
        Departamento: pt ? pt.dept || "" : "",
        Vendedor: titleCase(vendor || ""),
        Zona: vm ? vm.zone : "",
        Contactado: "Si"
      });
    });
    rows.sort((a, b) => a.Vendedor.localeCompare(b.Vendedor) || a.Provincia.localeCompare(b.Provincia) || a.Cliente.localeCompare(b.Cliente));
    return rows;
  }
  function buildOpsLogRows() {
    return (opsLogCache || []).map((o) => ({
      Fecha: o.timestamp ? o.timestamp.toDate ? o.timestamp.toDate().toLocaleString() : new Date(o.timestamp).toLocaleString() : "",
      Usuario: o.userEmail || "",
      Rol: o.userRole || "",
      Accion: o.action || "",
      "Tipo entidad": o.entityType || "",
      Entidad: o.entityName || "",
      Detalles: typeof o.details === "object" ? JSON.stringify(o.details) : o.details || ""
    }));
  }
  function buildVisitRows() {
    return visitsCache.map((v) => ({
      Fecha: v.fecha || "",
      Mes: v.mes || "",
      Ano: v.anio || "",
      Vendedor: titleCase(v.vendor || ""),
      "Tipo contacto": v.tipoContacto === "telefono" ? "Telefono" : "Presencial",
      Comentario: v.comentario || "",
      Provincia: titleCase(v.provincia || ""),
      Localidad: v.localidad || "",
      Tienda: v.tienda || "",
      "Tipo tienda": v.tipo || "",
      Local: v.local || "",
      Tamano: v.tamano || "",
      Fidelidad: v.fidelidad || "",
      "Relevancia (1-5)": v.relevancia || "",
      POP: v.pop || "",
      "Necesidad puntual": v.necesidadPuntual === "MOSTRADO" ? "MOSTRADOR" : v.necesidadPuntual || "",
      "Tipo venta": v.tipoVenta === "MOSTRADO" ? "MOSTRADOR" : v.tipoVenta || "",
      "% Mostrador": v.ponderacionMostrado != null ? v.ponderacionMostrado : "",
      "% Ecommerce": v.ponderacionEcommerce != null ? v.ponderacionEcommerce : "",
      Competencia: v.competencia || "",
      "Categoria cliente": v.categoriaCliente || "",
      Oportunidad: v.oportunidad || "",
      "Lo mas vendido Shimano": v.masVendido || "",
      "Lo que mas preguntan": v.masPreguntan || "",
      "Ayuda a tienda": v.ayudaTienda || "",
      "Fotos espacio (cant)": (v.espacio || []).length,
      "Foto frente": v.frenteLocal ? "Si" : "No",
      "GPS estado": v.gpsStatus || "",
      "GPS distancia (m)": typeof v.gpsDistanceM === "number" ? v.gpsDistanceM : "",
      "GPS lat": v.gpsLat != null ? v.gpsLat : "",
      "GPS lon": v.gpsLon != null ? v.gpsLon : "",
      "GPS precision (m)": v.gpsAccuracy != null ? v.gpsAccuracy : "",
      "GPS capturado": v.gpsCapturedAt || "",
      Email: v.ownerEmail || ""
    }));
  }
  window.exportExecutive = function() {
    const wb = XLSX.utils.book_new();
    const rows = buildPedidoDetailRows();
    const confRows = rows.filter((r) => r.estado === "Confirmado");
    const perVendor = {};
    confRows.forEach((r) => {
      const k = r.vendedor || "Sin asignar";
      if (!perVendor[k]) perVendor[k] = { zona: r.zona, unid: 0, ars: 0, usd: 0, clientes: /* @__PURE__ */ new Set(), prods: /* @__PURE__ */ new Set(), provs: /* @__PURE__ */ new Set() };
      perVendor[k].unid += r.cantidad;
      perVendor[k].ars += r.subtotal_ars;
      perVendor[k].usd += r.subtotal_usd;
      perVendor[k].clientes.add(r.cliente);
      perVendor[k].prods.add(r.codigo);
      perVendor[k].provs.add(r.provincia);
    });
    const consol = [];
    VENDORS.forEach((v) => {
      const titleV = titleCase(v.key);
      const d = perVendor[titleV] || { zona: v.zone, unid: 0, ars: 0, usd: 0, clientes: /* @__PURE__ */ new Set(), prods: /* @__PURE__ */ new Set(), provs: /* @__PURE__ */ new Set() };
      const t = TARGETS_BY_VENDOR[v.key] || { jul2026_usd: 0, julDic2026_usd: 0, anual2027_usd: 0 };
      consol.push({
        Zona: v.zone,
        Vendedor: titleV,
        Provincias: d.provs.size,
        "Clientes activos": d.clientes.size,
        "Productos distintos": d.prods.size,
        Unidades: d.unid,
        "Facturado ARS": Math.round(d.ars),
        "Facturado USD": Math.round(d.usd),
        "Target Jul 2026 USD": t.jul2026_usd,
        "Target Jul-Dic 2026 USD": t.julDic2026_usd,
        "Target 2027 USD": t.anual2027_usd
      });
    });
    const wsC = XLSX.utils.json_to_sheet(consol);
    wsC["!cols"] = [{ wch: 6 }, { wch: 24 }, { wch: 11 }, { wch: 14 }, { wch: 16 }, { wch: 11 }, { wch: 16 }, { wch: 16 }, { wch: 18 }, { wch: 20 }, { wch: 18 }];
    XLSX.utils.book_append_sheet(wb, wsC, "Consolidado");
    VENDORS.forEach((v) => {
      const titleV = titleCase(v.key);
      const vrows = confRows.filter((r) => r.vendedor === titleV).map((r) => ({
        Fecha: r.fecha,
        Mes: r.mes_pedido,
        Provincia: r.provincia,
        Localidad: r.localidad,
        Cliente: r.cliente,
        Tipo: r.tipo_cliente,
        Codigo: r.codigo,
        Producto: r.producto,
        Categoria: r.categoria,
        Familia: r.familia,
        Subfamilia: r.subfamilia,
        Cantidad: r.cantidad,
        "Precio ARS": r.precio_unit_ars,
        "Subtotal ARS": r.subtotal_ars,
        "Subtotal USD": r.subtotal_usd
      }));
      vrows.sort((a, b) => (a.Fecha || "").localeCompare(b.Fecha || "") || a.Cliente.localeCompare(b.Cliente));
      if (!vrows.length) vrows.push({ Fecha: "", Mes: "", Provincia: "", Localidad: "", Cliente: "(sin pedidos confirmados)", Tipo: "", Codigo: "", Producto: "", Categoria: "", Familia: "", Subfamilia: "", Cantidad: 0, "Precio ARS": 0, "Subtotal ARS": 0, "Subtotal USD": 0 });
      const ws = XLSX.utils.json_to_sheet(vrows);
      ws["!cols"] = [{ wch: 11 }, { wch: 14 }, { wch: 18 }, { wch: 22 }, { wch: 30 }, { wch: 11 }, { wch: 14 }, { wch: 38 }, { wch: 14 }, { wch: 18 }, { wch: 18 }, { wch: 10 }, { wch: 12 }, { wch: 14 }, { wch: 14 }];
      XLSX.utils.book_append_sheet(wb, ws, (v.zone + " " + titleV).substring(0, 31).replace(/[\\/\*\?\[\]:]/g, ""));
    });
    const visitRows = buildVisitRows();
    if (visitRows.length) {
      const wsV = XLSX.utils.json_to_sheet(visitRows);
      XLSX.utils.book_append_sheet(wb, wsV, "Visitas");
    }
    const contactRows = buildContactadosRows();
    if (contactRows.length) {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(contactRows), "Contactados");
    }
    const opsRows = buildOpsLogRows();
    if (opsRows.length) {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(opsRows), "Log Operaciones");
    }
    XLSX.writeFile(wb, "Shimano_Ejecutivo_" + todayStr() + ".xlsx");
  };
  window.exportVisitsExcel = function() {
    if (typeof XLSX === "undefined") {
      alert("La libreria de Excel no se cargo. Verifique su conexion a internet y reintente.");
      return;
    }
    const visitRows = buildVisitRows();
    if (!visitRows.length) {
      alert("No hay visitas registradas todavia. Cuando se cargue al menos una, vas a poder exportarla.");
      return;
    }
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(visitRows);
    ws["!cols"] = [
      { wch: 12 },
      { wch: 14 },
      { wch: 8 },
      { wch: 24 },
      { wch: 18 },
      { wch: 22 },
      { wch: 30 },
      { wch: 18 },
      { wch: 14 },
      { wch: 14 },
      { wch: 14 },
      { wch: 16 },
      { wch: 8 },
      { wch: 22 },
      { wch: 14 },
      { wch: 14 },
      { wch: 14 },
      { wch: 18 },
      { wch: 18 },
      { wch: 32 },
      { wch: 32 },
      { wch: 32 },
      { wch: 32 },
      { wch: 18 },
      { wch: 14 },
      { wch: 24 }
    ];
    XLSX.utils.book_append_sheet(wb, ws, "Visitas");
    const perVendor = {};
    visitsCache.forEach((v) => {
      const k = titleCase(v.vendor || "Sin asignar");
      if (!perVendor[k]) perVendor[k] = { visitas: 0, tiendas: /* @__PURE__ */ new Set(), localidades: /* @__PURE__ */ new Set(), provincias: /* @__PURE__ */ new Set() };
      perVendor[k].visitas++;
      if (v.tienda) perVendor[k].tiendas.add(v.tienda);
      if (v.localidad) perVendor[k].localidades.add(v.localidad);
      if (v.provincia) perVendor[k].provincias.add(v.provincia);
    });
    const resumen = Object.entries(perVendor).map(([vendedor, d]) => ({
      Vendedor: vendedor,
      "Visitas totales": d.visitas,
      "Tiendas distintas": d.tiendas.size,
      "Localidades distintas": d.localidades.size,
      "Provincias distintas": d.provincias.size
    })).sort((a, b) => b["Visitas totales"] - a["Visitas totales"]);
    if (resumen.length) {
      const wsR = XLSX.utils.json_to_sheet(resumen);
      wsR["!cols"] = [{ wch: 24 }, { wch: 16 }, { wch: 18 }, { wch: 22 }, { wch: 22 }];
      XLSX.utils.book_append_sheet(wb, wsR, "Resumen por vendedor");
    }
    XLSX.writeFile(wb, "Shimano_Visitas_" + todayStr() + ".xlsx");
  };
  window.exportPowerBI = function() {
    const wb = XLSX.utils.book_new();
    const rows = buildPedidoDetailRows();
    const factRows = rows.filter((r) => r.estado !== "Borrador");
    const wsF = XLSX.utils.json_to_sheet(factRows.map((r) => ({
      line_id: r.line_id,
      fecha: r.fecha,
      estado: r.estado,
      vendedor_key: r.vendedor_key,
      zona: r.zona,
      provincia: r.provincia,
      localidad: r.localidad,
      cliente: r.cliente,
      tipo_cliente: r.tipo_cliente,
      sku: r.codigo,
      cantidad: r.cantidad,
      precio_unit_ars: r.precio_unit_ars,
      subtotal_ars: r.subtotal_ars,
      subtotal_usd: r.subtotal_usd
    })));
    XLSX.utils.book_append_sheet(wb, wsF, "Fact_Pedidos");
    const dimV = VENDORS.map((v) => {
      const t = TARGETS_BY_VENDOR[v.key] || {};
      return {
        vendedor_key: v.key,
        vendedor_nombre: titleCase(v.key),
        zona: v.zone,
        zona_descripcion: v.label,
        color: v.color,
        target_jul2026_usd: t.jul2026_usd || 0,
        target_julDic2026_usd: t.julDic2026_usd || 0,
        target_2027_usd: t.anual2027_usd || 0
      };
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(dimV), "Dim_Vendedor");
    const dimP = PRODUCTS.map((p) => ({ sku: p.code, descripcion: p.desc, categoria: p.cat, familia: p.fam, subfamilia: p.sub }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(dimP), "Dim_Producto");
    const dimC = [];
    POINTS.forEach((p) => {
      const vm = vendorLookup[p.vendor];
      p.clients.forEach((n) => dimC.push({ cliente: n, tipo: "Cliente actual", provincia: titleCase(p.province), localidad: p.name, departamento: p.dept || "", vendedor_key: p.vendor || "", zona: vm ? vm.zone : "" }));
      p.prospects.forEach((n) => dimC.push({ cliente: n, tipo: "Prospecto", provincia: titleCase(p.province), localidad: p.name, departamento: p.dept || "", vendedor_key: p.vendor || "", zona: vm ? vm.zone : "" }));
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(dimC), "Dim_Cliente");
    const calSet = /* @__PURE__ */ new Set();
    factRows.forEach((r) => {
      if (r.fecha) calSet.add(r.fecha);
    });
    const start = /* @__PURE__ */ new Date("2026-01-01");
    const end = /* @__PURE__ */ new Date();
    end.setDate(end.getDate() + 365);
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) calSet.add(d.toISOString().slice(0, 10));
    const dimCal = [...calSet].sort().map((dt) => {
      const [y, m, da] = dt.split("-").map((x) => parseInt(x));
      const dateObj = new Date(y, m - 1, da);
      return { fecha: dt, year: y, month: m, day: da, quarter: "Q" + (Math.floor((m - 1) / 3) + 1), month_name: MESES[m - 1], year_month: y + "-" + String(m).padStart(2, "0"), day_of_week: ["Dom", "Lun", "Mar", "Mie", "Jue", "Vie", "Sab"][dateObj.getDay()] };
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(dimCal), "Dim_Calendario");
    const dimCmp = campaignsCache.map((c) => ({ campania_id: c.id, nombre: c.name, filter_type: c.filterType, filter_values: (c.filterValues || []).join(", "), target_type: c.targetType, target_amount: c.targetAmount, desde: c.startDate, hasta: c.endDate }));
    if (dimCmp.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(dimCmp), "Dim_Campania");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([
      { parametro: "exchange_rate_ars_usd", valor: EXCHANGE_RATE },
      { parametro: "fecha_export", valor: todayStr() },
      { parametro: "total_filas_fact", valor: factRows.length }
    ]), "Parametros");
    const visitRowsB = buildVisitRows();
    if (visitRowsB.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(visitRowsB), "Fact_Visitas");
    const contactRowsB = buildContactadosRows();
    if (contactRowsB.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(contactRowsB), "Contactados");
    const opsRowsB = buildOpsLogRows();
    if (opsRowsB.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(opsRowsB), "Log_Operaciones");
    XLSX.writeFile(wb, "Shimano_PowerBI_" + todayStr() + ".xlsx");
  };
  window.exportML = function() {
    const wb = XLSX.utils.book_new();
    const rows = buildPedidoDetailRows();
    const ws = XLSX.utils.json_to_sheet(rows);
    ws["!cols"] = Object.keys(rows[0] || { fecha: "" }).map(() => ({ wch: 14 }));
    XLSX.utils.book_append_sheet(wb, ws, "master_ml");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(PRODUCTS.map((p) => ({ code: p.code, desc: p.desc, cat: p.cat, fam: p.fam, sub: p.sub }))), "productos_catalogo");
    const universe = [];
    POINTS.forEach((p) => {
      const vm = vendorLookup[p.vendor];
      p.clients.forEach((n) => universe.push({ cliente: n, tipo: "cliente_actual", provincia: titleCase(p.province), localidad: p.name, departamento: p.dept || "", vendedor: titleCase(p.vendor || ""), zona: vm ? vm.zone : "", lat: p.lat, lon: p.lon }));
      p.prospects.forEach((n) => universe.push({ cliente: n, tipo: "prospecto", provincia: titleCase(p.province), localidad: p.name, departamento: p.dept || "", vendedor: titleCase(p.vendor || ""), zona: vm ? vm.zone : "", lat: p.lat, lon: p.lon }));
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(universe), "universo_clientes");
    const targetsLong = [];
    Object.entries(TARGETS_BY_VENDOR).forEach(([vendor, t]) => {
      targetsLong.push({ vendedor: titleCase(vendor), periodo: "Jul 2026", start_date: "2026-07-01", end_date: "2026-07-31", target_usd: t.jul2026_usd || 0 });
      targetsLong.push({ vendedor: titleCase(vendor), periodo: "Jul-Dic 2026", start_date: "2026-07-01", end_date: "2026-12-31", target_usd: t.julDic2026_usd || 0 });
      targetsLong.push({ vendedor: titleCase(vendor), periodo: "2027", start_date: "2027-01-01", end_date: "2027-12-31", target_usd: t.anual2027_usd || 0 });
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(targetsLong), "targets_long");
    if (campaignsCache.length) {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(campaignsCache.map((c) => ({ id: c.id, nombre: c.name, filter_type: c.filterType, filter_values: (c.filterValues || []).join(","), target_type: c.targetType, target_amount: c.targetAmount, start_date: c.startDate, end_date: c.endDate }))), "campanias");
    }
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([
      { parametro: "exchange_rate_ars_usd", valor: EXCHANGE_RATE },
      { parametro: "fecha_export", valor: (/* @__PURE__ */ new Date()).toISOString() }
    ]), "parametros");
    const visitRowsC = buildVisitRows();
    if (visitRowsC.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(visitRowsC), "visitas");
    const contactRowsC = buildContactadosRows();
    if (contactRowsC.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(contactRowsC), "contactados");
    const opsRowsC = buildOpsLogRows();
    if (opsRowsC.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(opsRowsC), "log_operaciones");
    XLSX.writeFile(wb, "Shimano_ML_" + todayStr() + ".xlsx");
  };
  if (typeof window.todayStr === "undefined") window.todayStr = todayStr;
  if (typeof window.dataUrlToBlob === "undefined") window.dataUrlToBlob = dataUrlToBlob;
  if (typeof window.sanitizeForPath === "undefined") window.sanitizeForPath = sanitizeForPath;
  window.loadExcelJS = loadExcelJS;
})();
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL2RvbWFpbnMvZXhwb3J0cy1hZHZhbmNlZC5qcyJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiLy8gQHRzLW5vY2hlY2tcclxuLy8gRVhQT1JUUy1BRFZBTkNFRDogcGhvdG8gWklQcywgYXVkaXQgWExTWCwgZXhlY3V0aXZlIHN1bW1hcnksIHZpc2l0cyBYTFNYLFxyXG4vLyBQb3dlckJJIGRhdGFzZXQsIE1MIGRhdGFzZXQuIEV4dHJhXHUwMEVEZG8gdmVyYmF0aW0gZGUgaW5kZXguaHRtbCAoNCBmcmFnbWVudG9zXHJcbi8vIGRpc2NvbnRpbnVvcyBzZXBhcmFkb3MgcG9yIEJhY2t1cCArIEF1ZGl0ICsgX2V4cG9ydExlZ2FjeUZ1bGwgcXVlIHF1ZWRhblxyXG4vLyBlbiBlbCBpbmxpbmUpIGNvbW8gcGFydGUgZGUgRTIubi4yIChlMmItcGVyZiAyMDI2LTA3LTI4KS5cclxuLy9cclxuLy8gRGVwcyBkZWwgaW5saW5lOiBKU1ppcCAoQ0ROIGxhenkpLCBFeGNlbEpTIChDRE4gbGF6eSB2aWEgbG9hZEV4Y2VsSlMpLFxyXG4vLyBYTFNYIChkZWZlciBlbiBoZWFkKSwgdmlzaXRzQ2FjaGUsIGNhbXBhaWduc0NhY2hlLCBvcHNMb2dDYWNoZSAoYXVkaXRcclxuLy8gaW5saW5lKSwgYXVkaXRMb2dDYWNoZSAoYXVkaXQgaW5saW5lKSwgY29udGFjdGVkIChnbG9iYWwgU2V0KSwgUE9JTlRTLFxyXG4vLyBQUk9EVUNUUywgVkVORE9SUywgTUVTRVMsIHZlbmRvckxvb2t1cCwgZXNjYXBlSHRtbCwgZXNjYXBlQXR0ciwgdGl0bGVDYXNlLFxyXG4vLyBzaG93U3luY1RhZywgY3VycmVudFVzZXIsIHVzZXJSb2xlLCBvcmRlcnMsIGNvbmZpcm1lZCwgcGVuZGluZy5cclxuLy9cclxuLy8gQ3Jvc3Mtc2NvcGUgc3RhdGU6IE5PTkUgKHRvZG9zIGxvcyBoZWxwZXJzIHkgY29uc3RzIGxvY2FsZXMgYWwgYmxvcXVlKS5cclxuLy8gU2luIGxpc3RlbmVycyBvblNuYXBzaG90LlxyXG4vL1xyXG4vLyBOT1RBOiBsb3MgaGVscGVycyB0b2RheVN0ci9kYXRhVXJsVG9CbG9iL3Nhbml0aXplRm9yUGF0aCB2aXZlbiBlbiBlc3RlXHJcbi8vIG1cdTAwRjNkdWxvIFx1MjAxNCBlbCBpbmxpbmUgcHVlZGUgbGxhbWFybG9zIHZpYSBmcmVlIHJlZmVyZW5jZSBhbCBHbG9iYWwgRW52aXJvbm1lbnRcclxuLy8gUmVjb3JkIHBlcm8gcHJlZmVyaW1vcyBleHBvc2ljaVx1MDBGM24gd2luZG93LiogZXhwbFx1MDBFRGNpdGEgYWwgZmluYWwuXHJcblxyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XHJcbi8vIFNFQ0NJXHUwMEQzTjogaGVscGVycyArIHBob3RvcyB6aXAgKyB2aXNpdHMgZW1iZWRkZWQgKGlubGluZSBMOTI1Ni05NDQ1KVxyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxuXHJcbmZ1bmN0aW9uIHRvZGF5U3RyKCl7IHJldHVybiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwxMCk7IH1cclxuXHJcbi8vIEhlbHBlcjogY29udmVydGlyIGRhdGFVUkwgYmFzZTY0IGEgQmxvYiBwYXJhIGluY2x1aXIgZW4gWklQXHJcbmZ1bmN0aW9uIGRhdGFVcmxUb0Jsb2IoZGF0YVVybCl7XHJcbiAgaWYgKCFkYXRhVXJsKSByZXR1cm4gbnVsbDtcclxuICBjb25zdCBwYXJ0cyA9IGRhdGFVcmwuc3BsaXQoJywnKTtcclxuICBpZiAocGFydHMubGVuZ3RoIDwgMikgcmV0dXJuIG51bGw7XHJcbiAgY29uc3QgbWltZU1hdGNoID0gcGFydHNbMF0ubWF0Y2goLzooLio/KTsvKTtcclxuICBjb25zdCBtaW1lID0gbWltZU1hdGNoID8gbWltZU1hdGNoWzFdIDogJ2ltYWdlL2pwZWcnO1xyXG4gIGNvbnN0IGJ5dGVzID0gYXRvYihwYXJ0c1sxXSk7XHJcbiAgY29uc3QgYXJyID0gbmV3IFVpbnQ4QXJyYXkoYnl0ZXMubGVuZ3RoKTtcclxuICBmb3IgKGxldCBpID0gMDsgaSA8IGJ5dGVzLmxlbmd0aDsgaSsrKSBhcnJbaV0gPSBieXRlcy5jaGFyQ29kZUF0KGkpO1xyXG4gIHJldHVybiBuZXcgQmxvYihbYXJyXSwge3R5cGU6IG1pbWV9KTtcclxufVxyXG5cclxuLy8gU2FuZWFyIG5vbWJyZXMgcGFyYSBxdWUgc2lydmFuIGNvbW8gcnV0YSBkZSBhcmNoaXZvXHJcbmZ1bmN0aW9uIHNhbml0aXplRm9yUGF0aChzKXtcclxuICByZXR1cm4gU3RyaW5nKHMgfHwgJycpLnJlcGxhY2UoL1tcXFxcLyo/XFxbXFxdOnxcIjw+XS9nLCAnXycpLnJlcGxhY2UoL1xccysvZywgJyAnKS50cmltKCkuc2xpY2UoMCwgNjApO1xyXG59XHJcblxyXG4vLyBEZXNjYXJnYXIgdG9kYXMgbGFzIGZvdG9zIGRlIHZpc2l0YXMgZW4gdW4gWklQIG9yZ2FuaXphZG8gcG9yIHZlbmRlZG9yIC8gdGllbmRhIC8gZmVjaGFcclxud2luZG93LmV4cG9ydFBob3Rvc1ppcCA9IGFzeW5jIGZ1bmN0aW9uKCl7XHJcbiAgaWYgKHR5cGVvZiBKU1ppcCA9PT0gJ3VuZGVmaW5lZCcpIHsgYWxlcnQoJ0NhcmdhbmRvIGxpYnJlcmlhIFpJUCwgaW50ZW50YSBkZSBudWV2byBlbiA1IHNlZ3VuZG9zLicpOyByZXR1cm47IH1cclxuICBpZiAoIXZpc2l0c0NhY2hlIHx8ICF2aXNpdHNDYWNoZS5sZW5ndGgpIHsgYWxlcnQoJ05vIGhheSB2aXNpdGFzIHJlZ2lzdHJhZGFzLicpOyByZXR1cm47IH1cclxuICBsZXQgcGhvdG9Db3VudCA9IDA7XHJcbiAgY29uc3QgemlwID0gbmV3IEpTWmlwKCk7XHJcbiAgdmlzaXRzQ2FjaGUuZm9yRWFjaCh2ID0+IHtcclxuICAgIGNvbnN0IHZlbmRvciA9IHNhbml0aXplRm9yUGF0aCh0aXRsZUNhc2Uodi52ZW5kb3IgfHwgJ1NJTl9WRU5ERURPUicpKTtcclxuICAgIGNvbnN0IHRpZW5kYSA9IHNhbml0aXplRm9yUGF0aCh2LnRpZW5kYSB8fCAnc2luX3RpZW5kYScpO1xyXG4gICAgY29uc3QgZmVjaGEgPSAodi5mZWNoYSB8fCAnJykucmVwbGFjZSgvLS9nLCAnJyk7XHJcbiAgICBjb25zdCBmb2xkZXJOYW1lID0gdmVuZG9yICsgJy8nICsgdGllbmRhICsgJ18nICsgZmVjaGE7XHJcbiAgICBjb25zdCBmb2xkZXIgPSB6aXAuZm9sZGVyKGZvbGRlck5hbWUpO1xyXG4gICAgaWYgKHYuZnJlbnRlTG9jYWwpIHtcclxuICAgICAgY29uc3QgYiA9IGRhdGFVcmxUb0Jsb2Iodi5mcmVudGVMb2NhbCk7XHJcbiAgICAgIGlmIChiKSB7IGZvbGRlci5maWxlKCdmcmVudGUuanBnJywgYik7IHBob3RvQ291bnQrKzsgfVxyXG4gICAgfVxyXG4gICAgKHYuZXNwYWNpbyB8fCBbXSkuZm9yRWFjaCgoYjY0LCBpKSA9PiB7XHJcbiAgICAgIGNvbnN0IGIgPSBkYXRhVXJsVG9CbG9iKGI2NCk7XHJcbiAgICAgIGlmIChiKSB7IGZvbGRlci5maWxlKCdlc3BhY2lvXycgKyAoaSArIDEpICsgJy5qcGcnLCBiKTsgcGhvdG9Db3VudCsrOyB9XHJcbiAgICB9KTtcclxuICB9KTtcclxuICBpZiAoIXBob3RvQ291bnQpIHsgYWxlcnQoJ05vIGhheSBmb3RvcyBjYXJnYWRhcyBlbiBsYXMgdmlzaXRhcy4nKTsgcmV0dXJuOyB9XHJcbiAgc2hvd1N5bmNUYWcoJ0dlbmVyYW5kbyBaSVAgZGUgJyArIHBob3RvQ291bnQgKyAnIGZvdG9zLi4uJywgMzAwMDApO1xyXG4gIHRyeSB7XHJcbiAgICBjb25zdCBibG9iID0gYXdhaXQgemlwLmdlbmVyYXRlQXN5bmMoe3R5cGU6ICdibG9iJywgY29tcHJlc3Npb246ICdERUZMQVRFJ30pO1xyXG4gICAgY29uc3QgdXJsID0gVVJMLmNyZWF0ZU9iamVjdFVSTChibG9iKTtcclxuICAgIGNvbnN0IGEgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdhJyk7XHJcbiAgICBhLmhyZWYgPSB1cmw7XHJcbiAgICBhLmRvd25sb2FkID0gJ1NoaW1hbm9fRm90b3NfVmlzaXRhc18nICsgdG9kYXlTdHIoKSArICcuemlwJztcclxuICAgIGEuY2xpY2soKTtcclxuICAgIHNldFRpbWVvdXQoKCkgPT4gVVJMLnJldm9rZU9iamVjdFVSTCh1cmwpLCA1MDAwKTtcclxuICAgIHNob3dTeW5jVGFnKHBob3RvQ291bnQgKyAnIGZvdG9zIGRlc2NhcmdhZGFzJywgMzAwMCk7XHJcbiAgfSBjYXRjaChlKSB7IGNvbnNvbGUuZXJyb3IoJ3ppcCcsIGUpOyBhbGVydCgnRXJyb3IgZ2VuZXJhbmRvIFpJUDogJyArIChlLm1lc3NhZ2UgfHwgZSkpOyB9XHJcbn07XHJcblxyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxuLy8gRXhjZWwgY29uIGZvdG9zIGRlbCBmcmVudGUgZW1iZWJpZGFzIGVuIGNhZGEgY2VsZGEgKEV4Y2VsSlMpXHJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG4vLyBFeGNlbEpTIHNlIGNhcmdhIGxhenkgKHNvbG8gY3VhbmRvIHNlIHRvY2EgZWwgYm90b24pIHBhcmEgbm8gaW5mbGFyIGVsIGJ1bmRsZS5cclxuZnVuY3Rpb24gbG9hZEV4Y2VsSlMoKXtcclxuICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xyXG4gICAgaWYgKHR5cGVvZiBFeGNlbEpTICE9PSAndW5kZWZpbmVkJykgcmV0dXJuIHJlc29sdmUoKTtcclxuICAgIGNvbnN0IHMgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdzY3JpcHQnKTtcclxuICAgIHMuc3JjID0gJ2h0dHBzOi8vY2RuLmpzZGVsaXZyLm5ldC9ucG0vZXhjZWxqc0A0LjQuMC9kaXN0L2V4Y2VsanMubWluLmpzJztcclxuICAgIHMub25sb2FkID0gKCkgPT4gcmVzb2x2ZSgpO1xyXG4gICAgcy5vbmVycm9yID0gKCkgPT4gcmVqZWN0KG5ldyBFcnJvcignTm8gc2UgcHVkbyBjYXJnYXIgbGEgbGlicmVyaWEgRXhjZWxKUy4gUmV2aXNhIHR1IGNvbmV4aW9uIGEgaW50ZXJuZXQuJykpO1xyXG4gICAgZG9jdW1lbnQuaGVhZC5hcHBlbmRDaGlsZChzKTtcclxuICB9KTtcclxufVxyXG5cclxud2luZG93LmV4cG9ydFZpc2l0c1dpdGhFbWJlZGRlZFBob3RvcyA9IGFzeW5jIGZ1bmN0aW9uKCl7XHJcbiAgaWYgKCF2aXNpdHNDYWNoZSB8fCAhdmlzaXRzQ2FjaGUubGVuZ3RoKSB7IGFsZXJ0KCdObyBoYXkgdmlzaXRhcyByZWdpc3RyYWRhcy4nKTsgcmV0dXJuOyB9XHJcbiAgY29uc3QgbiA9IHZpc2l0c0NhY2hlLmxlbmd0aDtcclxuICBpZiAobiA+IDMwMCkge1xyXG4gICAgaWYgKCFjb25maXJtKCdIYXkgJyArIG4gKyAnIHZpc2l0YXMuIEVsIEV4Y2VsIGNvbiB0b2RhcyBsYXMgZm90b3MgZW1iZWJpZGFzIHB1ZWRlIHBlc2FyIDUwLTE1MCBNQiB5IHRhcmRhciB2YXJpb3MgbWludXRvcy4gXHUwMEJGQ29udGludWFyPycpKSByZXR1cm47XHJcbiAgfSBlbHNlIGlmIChuID4gMTAwKSB7XHJcbiAgICBpZiAoIWNvbmZpcm0oJ1ZhcyBhIGdlbmVyYXIgdW4gRXhjZWwgY29uICcgKyBuICsgJyB2aXNpdGFzIHkgc3VzIGZvdG9zIGVtYmViaWRhcy4gUHVlZGUgdGFyZGFyIDMwLTYwIHNlZ3VuZG9zLiBcdTAwQkZDb250aW51YXI/JykpIHJldHVybjtcclxuICB9XHJcbiAgc2hvd1N5bmNUYWcoJ0NhcmdhbmRvIEV4Y2VsSlMuLi4nLCAyMDAwKTtcclxuICB0cnkge1xyXG4gICAgYXdhaXQgbG9hZEV4Y2VsSlMoKTtcclxuICB9IGNhdGNoKGUpIHsgYWxlcnQoZS5tZXNzYWdlIHx8IGUpOyByZXR1cm47IH1cclxuXHJcbiAgc2hvd1N5bmNUYWcoJ0dlbmVyYW5kbyBFeGNlbCBjb24gJyArIG4gKyAnIHZpc2l0YXMuLi4nLCAzMDAwKTtcclxuXHJcbiAgY29uc3Qgd2IgPSBuZXcgRXhjZWxKUy5Xb3JrYm9vaygpO1xyXG4gIHdiLmNyZWF0b3IgPSAnQXBwIFZlbmRlZG9yZXMgU2hpbWFubyc7XHJcbiAgd2IuY3JlYXRlZCA9IG5ldyBEYXRlKCk7XHJcbiAgY29uc3Qgd3MgPSB3Yi5hZGRXb3Jrc2hlZXQoJ1Zpc2l0YXMnLCB7dmlld3M6IFt7c3RhdGU6ICdmcm96ZW4nLCB5U3BsaXQ6IDF9XX0pO1xyXG5cclxuICAvLyBEZWZpbmljaW9uIGRlIGNvbHVtbmFzLiBMYSBjb2x1bW5hIGRlIGZvdG8gdmEgYSB0ZW5lciBhbmNobyBleHRyYSBwYXJhIHF1ZSBzZSB2ZWEuXHJcbiAgd3MuY29sdW1ucyA9IFtcclxuICAgIHtoZWFkZXI6ICdGZWNoYScsICAgICAgICAga2V5OiAnZmVjaGEnLCAgICAgd2lkdGg6IDEyfSxcclxuICAgIHtoZWFkZXI6ICdNZXMnLCAgICAgICAgICAga2V5OiAnbWVzJywgICAgICAgd2lkdGg6IDEwfSxcclxuICAgIHtoZWFkZXI6ICdWZW5kZWRvcicsICAgICAga2V5OiAndmVuZGVkb3InLCAgd2lkdGg6IDIyfSxcclxuICAgIHtoZWFkZXI6ICdUaXBvIGNvbnRhY3RvJywga2V5OiAndGlwb0N0JywgICAgd2lkdGg6IDEyfSxcclxuICAgIHtoZWFkZXI6ICdDb21lbnRhcmlvJywgICAga2V5OiAnY29tZW50JywgICAgd2lkdGg6IDMyfSxcclxuICAgIHtoZWFkZXI6ICdQcm92aW5jaWEnLCAgICAga2V5OiAncHJvdmluY2lhJywgd2lkdGg6IDE2fSxcclxuICAgIHtoZWFkZXI6ICdMb2NhbGlkYWQnLCAgICAga2V5OiAnbG9jYWxpZGFkJywgd2lkdGg6IDE4fSxcclxuICAgIHtoZWFkZXI6ICdUaWVuZGEnLCAgICAgICAga2V5OiAndGllbmRhJywgICAgd2lkdGg6IDMwfSxcclxuICAgIHtoZWFkZXI6ICdUaXBvJywgICAgICAgICAga2V5OiAndGlwbycsICAgICAgd2lkdGg6IDEyfSxcclxuICAgIHtoZWFkZXI6ICdMb2NhbCcsICAgICAgICAga2V5OiAnbG9jYWwnLCAgICAgd2lkdGg6IDEyfSxcclxuICAgIHtoZWFkZXI6ICdUYW1hbm8nLCAgICAgICAga2V5OiAndGFtYW5vJywgICAgd2lkdGg6IDEwfSxcclxuICAgIHtoZWFkZXI6ICdGaWRlbGlkYWQnLCAgICAga2V5OiAnZmlkZWxpZGFkJywgd2lkdGg6IDEwfSxcclxuICAgIHtoZWFkZXI6ICdSZWxldmFuY2lhJywgICAga2V5OiAncmVsZXYnLCAgICAgd2lkdGg6IDEwfSxcclxuICAgIHtoZWFkZXI6ICdQT1AnLCAgICAgICAgICAga2V5OiAncG9wJywgICAgICAgd2lkdGg6IDh9LFxyXG4gICAge2hlYWRlcjogJ1RpcG8gdmVudGEnLCAgICBrZXk6ICd0aXBvVmVudGEnLCB3aWR0aDogMTJ9LFxyXG4gICAge2hlYWRlcjogJ0NvbXBldGVuY2lhJywgICBrZXk6ICdjb21wZScsICAgICB3aWR0aDogMTZ9LFxyXG4gICAge2hlYWRlcjogJ09wb3J0dW5pZGFkJywgICBrZXk6ICdvcG9ydHUnLCAgICB3aWR0aDogMzB9LFxyXG4gICAge2hlYWRlcjogJ0xvIG1hcyB2ZW5kaWRvJywga2V5OiAnbWFzVmUnLCAgICB3aWR0aDogMjh9LFxyXG4gICAge2hlYWRlcjogJ0dQUyBkaXN0IChtKScsICBrZXk6ICdncHNEaXN0JywgICB3aWR0aDogMTJ9LFxyXG4gICAge2hlYWRlcjogJ0ZvdG8gZnJlbnRlJywgICBrZXk6ICdmb3RvJywgICAgICB3aWR0aDogMjJ9LCAvLyA8LSBsYSBpbWFnZW4gdmEgYWNhXHJcbiAgICB7aGVhZGVyOiAnRW1haWwgdmVuZGVkb3InLGtleTogJ2VtYWlsJywgICAgIHdpZHRoOiAyOH0sXHJcbiAgXTtcclxuXHJcbiAgLy8gRXN0aWxvIGhlYWRlclxyXG4gIHdzLmdldFJvdygxKS5mb250ID0ge2JvbGQ6IHRydWUsIGNvbG9yOiB7YXJnYjogJ0ZGRkZGRkZGJ319O1xyXG4gIHdzLmdldFJvdygxKS5maWxsID0ge3R5cGU6ICdwYXR0ZXJuJywgcGF0dGVybjogJ3NvbGlkJywgZmdDb2xvcjoge2FyZ2I6ICdGRjBDNEE2RSd9fTtcclxuICB3cy5nZXRSb3coMSkuYWxpZ25tZW50ID0ge3ZlcnRpY2FsOiAnbWlkZGxlJywgaG9yaXpvbnRhbDogJ2NlbnRlcid9O1xyXG4gIHdzLmdldFJvdygxKS5oZWlnaHQgPSAyMjtcclxuXHJcbiAgY29uc3QgRk9UT19DT0xfSURYID0gd3MuZ2V0Q29sdW1uKCdmb3RvJykubnVtYmVyIC0gMTsgLy8gMC1pbmRleGVkIHBhcmEgYWRkSW1hZ2VcclxuICBjb25zdCBST1dfSCA9IDEwMDtcclxuICBjb25zdCBJTUdfVyA9IDEzMDtcclxuICBjb25zdCBJTUdfSCA9IDkwO1xyXG5cclxuICAvLyBPcmRlbmFyIHZpc2l0YXMgcG9yIGZlY2hhIGRlc2MgKG1hcyByZWNpZW50ZXMgcHJpbWVybylcclxuICBjb25zdCBzb3J0ZWQgPSB2aXNpdHNDYWNoZS5zbGljZSgpLnNvcnQoKGEsIGIpID0+IChiLmZlY2hhIHx8ICcnKS5sb2NhbGVDb21wYXJlKGEuZmVjaGEgfHwgJycpKTtcclxuXHJcbiAgZm9yIChjb25zdCB2IG9mIHNvcnRlZCkge1xyXG4gICAgY29uc3QgdGlwb0NvbnRhY3RvTGJsID0gKHYudGlwb0NvbnRhY3RvID09PSAndGVsZWZvbm8nKSA/ICdUZWxlZm9ubycgOiAnUHJlc2VuY2lhbCc7XHJcbiAgICBjb25zdCByID0gd3MuYWRkUm93KHtcclxuICAgICAgZmVjaGE6ICAgICB2LmZlY2hhIHx8ICcnLFxyXG4gICAgICBtZXM6ICAgICAgIHYubWVzIHx8ICcnLFxyXG4gICAgICB2ZW5kZWRvcjogIHRpdGxlQ2FzZSh2LnZlbmRvciB8fCAnJyksXHJcbiAgICAgIHRpcG9DdDogICAgdGlwb0NvbnRhY3RvTGJsLFxyXG4gICAgICBjb21lbnQ6ICAgIHYuY29tZW50YXJpbyB8fCAnJyxcclxuICAgICAgcHJvdmluY2lhOiB0aXRsZUNhc2Uodi5wcm92aW5jaWEgfHwgJycpLFxyXG4gICAgICBsb2NhbGlkYWQ6IHYubG9jYWxpZGFkIHx8ICcnLFxyXG4gICAgICB0aWVuZGE6ICAgIHYudGllbmRhIHx8ICcnLFxyXG4gICAgICB0aXBvOiAgICAgIHYudGlwbyB8fCAnJyxcclxuICAgICAgbG9jYWw6ICAgICB2LmxvY2FsIHx8ICcnLFxyXG4gICAgICB0YW1hbm86ICAgIHYudGFtYW5vIHx8ICcnLFxyXG4gICAgICBmaWRlbGlkYWQ6IHYuZmlkZWxpZGFkIHx8ICcnLFxyXG4gICAgICByZWxldjogICAgIHYucmVsZXZhbmNpYSB8fCAnJyxcclxuICAgICAgcG9wOiAgICAgICB2LnBvcCB8fCAnJyxcclxuICAgICAgdGlwb1ZlbnRhOiAodi50aXBvVmVudGEgPT09ICdNT1NUUkFETycgPyAnTU9TVFJBRE9SJyA6ICh2LnRpcG9WZW50YSB8fCAnJykpLFxyXG4gICAgICBjb21wZTogICAgIHYuY29tcGV0ZW5jaWEgfHwgJycsXHJcbiAgICAgIG9wb3J0dTogICAgdi5vcG9ydHVuaWRhZCB8fCAnJyxcclxuICAgICAgbWFzVmU6ICAgICB2Lm1hc1ZlbmRpZG8gfHwgJycsXHJcbiAgICAgIGdwc0Rpc3Q6ICAgKHR5cGVvZiB2Lmdwc0Rpc3RhbmNlTSA9PT0gJ251bWJlcicpID8gdi5ncHNEaXN0YW5jZU0gOiAnJyxcclxuICAgICAgZm90bzogICAgICAnJywgLy8gbGEgY2VsZGEgcXVlZGEgdmFjaWE7IGVuY2ltYSB2YSBsYSBpbWFnZW5cclxuICAgICAgZW1haWw6ICAgICB2Lm93bmVyRW1haWwgfHwgJycsXHJcbiAgICB9KTtcclxuICAgIHIuaGVpZ2h0ID0gUk9XX0g7XHJcbiAgICByLmFsaWdubWVudCA9IHt2ZXJ0aWNhbDogJ21pZGRsZScsIHdyYXBUZXh0OiB0cnVlfTtcclxuICAgIGlmICh2LmZyZW50ZUxvY2FsICYmIHR5cGVvZiB2LmZyZW50ZUxvY2FsID09PSAnc3RyaW5nJykge1xyXG4gICAgICB0cnkge1xyXG4gICAgICAgIC8vIEVsIGNhbXBvIGVzIHVuIGRhdGFVUkw6ICdkYXRhOmltYWdlL2pwZWc7YmFzZTY0LC85ai80QUFRLi4uJ1xyXG4gICAgICAgIGxldCBiNjQgPSB2LmZyZW50ZUxvY2FsO1xyXG4gICAgICAgIGxldCBleHQgPSAnanBlZyc7XHJcbiAgICAgICAgY29uc3QgbSA9IC9eZGF0YTppbWFnZVxcLyhcXHcrKTtiYXNlNjQsKC4rKSQvaS5leGVjKGI2NCk7XHJcbiAgICAgICAgaWYgKG0pIHsgZXh0ID0gbVsxXS50b0xvd2VyQ2FzZSgpOyBiNjQgPSBtWzJdOyB9XHJcbiAgICAgICAgaWYgKGV4dCA9PT0gJ2pwZycpIGV4dCA9ICdqcGVnJztcclxuICAgICAgICBjb25zdCBpbWFnZUlkID0gd2IuYWRkSW1hZ2Uoe2Jhc2U2NDogYjY0LCBleHRlbnNpb246IGV4dH0pO1xyXG4gICAgICAgIHdzLmFkZEltYWdlKGltYWdlSWQsIHtcclxuICAgICAgICAgIHRsOiB7Y29sOiBGT1RPX0NPTF9JRFggKyAwLjEsIHJvdzogci5udW1iZXIgLSAxICsgMC4xfSxcclxuICAgICAgICAgIGV4dDoge3dpZHRoOiBJTUdfVywgaGVpZ2h0OiBJTUdfSH0sXHJcbiAgICAgICAgICBlZGl0QXM6ICdvbmVDZWxsJyxcclxuICAgICAgICB9KTtcclxuICAgICAgfSBjYXRjaChlKSB7IGNvbnNvbGUud2FybignZW1iZWJpZW5kbyBmb3RvIGZpbGEnLCByLm51bWJlciwgZSk7IH1cclxuICAgIH1cclxuICB9XHJcblxyXG4gIC8vIEdlbmVyYXIgeSBkZXNjYXJnYXJcclxuICB0cnkge1xyXG4gICAgY29uc3QgYnVmZmVyID0gYXdhaXQgd2IueGxzeC53cml0ZUJ1ZmZlcigpO1xyXG4gICAgY29uc3QgYmxvYiA9IG5ldyBCbG9iKFtidWZmZXJdLCB7dHlwZTogJ2FwcGxpY2F0aW9uL3ZuZC5vcGVueG1sZm9ybWF0cy1vZmZpY2Vkb2N1bWVudC5zcHJlYWRzaGVldG1sLnNoZWV0J30pO1xyXG4gICAgY29uc3QgdXJsID0gVVJMLmNyZWF0ZU9iamVjdFVSTChibG9iKTtcclxuICAgIGNvbnN0IGEgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdhJyk7XHJcbiAgICBhLmhyZWYgPSB1cmw7XHJcbiAgICBhLmRvd25sb2FkID0gJ1NoaW1hbm9fVmlzaXRhc19jb25fZm90b3NfJyArIHRvZGF5U3RyKCkgKyAnLnhsc3gnO1xyXG4gICAgZG9jdW1lbnQuYm9keS5hcHBlbmRDaGlsZChhKTsgYS5jbGljaygpOyBkb2N1bWVudC5ib2R5LnJlbW92ZUNoaWxkKGEpO1xyXG4gICAgc2V0VGltZW91dCgoKSA9PiBVUkwucmV2b2tlT2JqZWN0VVJMKHVybCksIDUwMDApO1xyXG4gICAgc2hvd1N5bmNUYWcoJ0V4Y2VsIGRlc2NhcmdhZG86ICcgKyBzb3J0ZWQubGVuZ3RoICsgJyB2aXNpdGFzJywgMzAwMCk7XHJcbiAgfSBjYXRjaChlKSB7XHJcbiAgICBjb25zb2xlLmVycm9yKCdleHBvcnRWaXNpdHNXaXRoRW1iZWRkZWRQaG90b3MnLCBlKTtcclxuICAgIGFsZXJ0KCdFcnJvciBnZW5lcmFuZG8gZWwgRXhjZWw6ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcclxuICB9XHJcbn07XHJcblxyXG5cclxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XHJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG4vLyBTRUNDSVx1MDBEM046IGV4cG9ydEF1ZGl0RXhjZWwgKGlubGluZSBMMTAwNDAtMTAwNjcpXHJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG5cclxud2luZG93LmV4cG9ydEF1ZGl0RXhjZWwgPSBmdW5jdGlvbigpe1xyXG4gIGlmICh0eXBlb2YgWExTWCA9PT0gJ3VuZGVmaW5lZCcpIHtcclxuICAgIGFsZXJ0KCdMYSBsaWJyZXJpYSBkZSBFeGNlbCBubyBzZSBjYXJnby4nKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgY29uc3QgaXRlbXMgPSBnZXRGaWx0ZXJlZEF1ZGl0RW50cmllcygpO1xyXG4gIGlmICghaXRlbXMubGVuZ3RoKSB7IGFsZXJ0KCdObyBoYXkgZXZlbnRvcyBwYXJhIGV4cG9ydGFyIGNvbiBsb3MgZmlsdHJvcyBhcGxpY2Fkb3MuJyk7IHJldHVybjsgfVxyXG4gIGNvbnN0IHJvd3MgPSBpdGVtcy5tYXAoZSA9PiB7XHJcbiAgICBjb25zdCB0cyA9IGUudGltZXN0YW1wICYmIGUudGltZXN0YW1wLnRvRGF0ZSA/IGUudGltZXN0YW1wLnRvRGF0ZSgpIDogbnVsbDtcclxuICAgIHJldHVybiB7XHJcbiAgICAgIEZlY2hhX0hvcmE6IHRzID8gdHMudG9JU09TdHJpbmcoKS5yZXBsYWNlKCdUJywgJyAnKS5zbGljZSgwLCAxOSkgOiAnJyxcclxuICAgICAgVXN1YXJpb19FbWFpbDogZS51c2VyRW1haWwgfHwgJycsXHJcbiAgICAgIFVzdWFyaW9fVUlEOiBlLnVzZXJVaWQgfHwgJycsXHJcbiAgICAgIFJvbDogZS51c2VyUm9sZSB8fCAnJyxcclxuICAgICAgQWNjaW9uOiBBVURJVF9BQ1RJT05fTEFCRUxTW2UuYWN0aW9uXSB8fCBlLmFjdGlvbiB8fCAnJyxcclxuICAgICAgQWNjaW9uX1JhdzogZS5hY3Rpb24gfHwgJycsXHJcbiAgICAgIFRpcG9fRW50aWRhZDogZS5lbnRpdHlUeXBlIHx8ICcnLFxyXG4gICAgICBFbnRpZGFkOiBlLmVudGl0eU5hbWUgfHwgJycsXHJcbiAgICAgIERldGFsbGVzX0pTT046IGUuZGV0YWlscyA/IEpTT04uc3RyaW5naWZ5KGUuZGV0YWlscykgOiAnJyxcclxuICAgIH07XHJcbiAgfSk7XHJcbiAgY29uc3Qgd2IgPSBYTFNYLnV0aWxzLmJvb2tfbmV3KCk7XHJcbiAgY29uc3Qgd3MgPSBYTFNYLnV0aWxzLmpzb25fdG9fc2hlZXQocm93cyk7XHJcbiAgd3NbJyFjb2xzJ10gPSBbe3djaDoyMH0se3djaDozMH0se3djaDozMH0se3djaDoxMH0se3djaDoyNH0se3djaDoyMH0se3djaDoxNH0se3djaDo0MH0se3djaDo2MH1dO1xyXG4gIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQod2IsIHdzLCAnQXVkaXRvcmlhJyk7XHJcbiAgY29uc3Qgc3RhbXAgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwgMTApO1xyXG4gIFhMU1gud3JpdGVGaWxlKHdiLCAnU2hpbWFub19BdWRpdG9yaWFfJyArIHN0YW1wICsgJy54bHN4Jyk7XHJcbn07XHJcblxyXG5cclxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XHJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG4vLyBTRUNDSVx1MDBEM046IGJ1aWxkQ29udGFjdGFkb3NSb3dzL09wc0xvZy9WaXNpdCAoaW5saW5lIEwxMDA4MS0xMDE1NSlcclxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XHJcblxyXG4vLyBMaXN0YSBjb21wbGV0YSBkZSBjb250YWN0YWRvcyAoY2xpZW50ZXMvcHJvc3BlY3RvcyBtYXJjYWRvcyBjb24gY2hlY2spXHJcbmZ1bmN0aW9uIGJ1aWxkQ29udGFjdGFkb3NSb3dzKCl7XHJcbiAgY29uc3Qgcm93cyA9IFtdO1xyXG4gIGNvbnRhY3RlZC5mb3JFYWNoKGtleSA9PiB7XHJcbiAgICBjb25zdCBwYXJ0cyA9IGtleS5zcGxpdCgnfCcpO1xyXG4gICAgY29uc3QgdGlwbyA9IHBhcnRzWzBdLCBwcm92aW5jZSA9IHBhcnRzWzFdLCBsb2NOYW1lID0gcGFydHNbMl0sIGNsaWVudE5hbWUgPSBwYXJ0c1szXTtcclxuICAgIGNvbnN0IHB0ID0gUE9JTlRTLmZpbmQocCA9PiBwLnByb3ZpbmNlID09PSBwcm92aW5jZSAmJiBwLm5hbWUgPT09IGxvY05hbWUpO1xyXG4gICAgY29uc3QgdmVuZG9yID0gcHQgPyBwdC52ZW5kb3IgOiAnJztcclxuICAgIGNvbnN0IHZtID0gdmVuZG9yTG9va3VwW3ZlbmRvcl07XHJcbiAgICByb3dzLnB1c2goe1xyXG4gICAgICBUaXBvOiB0aXBvID09PSAnQycgPyAnQ2xpZW50ZSBhY3R1YWwnIDogJ1Byb3NwZWN0bycsXHJcbiAgICAgIENsaWVudGU6IGNsaWVudE5hbWUsXHJcbiAgICAgIFByb3ZpbmNpYTogdGl0bGVDYXNlKHByb3ZpbmNlKSxcclxuICAgICAgTG9jYWxpZGFkOiBsb2NOYW1lLFxyXG4gICAgICBEZXBhcnRhbWVudG86IHB0ID8gKHB0LmRlcHQgfHwgJycpIDogJycsXHJcbiAgICAgIFZlbmRlZG9yOiB0aXRsZUNhc2UodmVuZG9yIHx8ICcnKSxcclxuICAgICAgWm9uYTogdm0gPyB2bS56b25lIDogJycsXHJcbiAgICAgIENvbnRhY3RhZG86ICdTaScsXHJcbiAgICB9KTtcclxuICB9KTtcclxuICByb3dzLnNvcnQoKGEsIGIpID0+IGEuVmVuZGVkb3IubG9jYWxlQ29tcGFyZShiLlZlbmRlZG9yKSB8fCBhLlByb3ZpbmNpYS5sb2NhbGVDb21wYXJlKGIuUHJvdmluY2lhKSB8fCBhLkNsaWVudGUubG9jYWxlQ29tcGFyZShiLkNsaWVudGUpKTtcclxuICByZXR1cm4gcm93cztcclxufVxyXG5cclxuLy8gTG9nIGRlIG9wZXJhY2lvbmVzIChjYW5jZWxhY2lvbmVzLCBlbGltaW5hY2lvbmVzLCB2dWVsdmUtYS1ib3JyYWRvciwgZXRjLilcclxuZnVuY3Rpb24gYnVpbGRPcHNMb2dSb3dzKCl7XHJcbiAgcmV0dXJuIChvcHNMb2dDYWNoZSB8fCBbXSkubWFwKG8gPT4gKHtcclxuICAgIEZlY2hhOiBvLnRpbWVzdGFtcCA/IChvLnRpbWVzdGFtcC50b0RhdGUgPyBvLnRpbWVzdGFtcC50b0RhdGUoKS50b0xvY2FsZVN0cmluZygpIDogbmV3IERhdGUoby50aW1lc3RhbXApLnRvTG9jYWxlU3RyaW5nKCkpIDogJycsXHJcbiAgICBVc3VhcmlvOiBvLnVzZXJFbWFpbCB8fCAnJyxcclxuICAgIFJvbDogby51c2VyUm9sZSB8fCAnJyxcclxuICAgIEFjY2lvbjogby5hY3Rpb24gfHwgJycsXHJcbiAgICAnVGlwbyBlbnRpZGFkJzogby5lbnRpdHlUeXBlIHx8ICcnLFxyXG4gICAgRW50aWRhZDogby5lbnRpdHlOYW1lIHx8ICcnLFxyXG4gICAgRGV0YWxsZXM6IHR5cGVvZiBvLmRldGFpbHMgPT09ICdvYmplY3QnID8gSlNPTi5zdHJpbmdpZnkoby5kZXRhaWxzKSA6IChvLmRldGFpbHMgfHwgJycpLFxyXG4gIH0pKTtcclxufVxyXG5cclxuZnVuY3Rpb24gYnVpbGRWaXNpdFJvd3MoKXtcclxuICByZXR1cm4gdmlzaXRzQ2FjaGUubWFwKHYgPT4gKHtcclxuICAgIEZlY2hhOiB2LmZlY2hhIHx8ICcnLFxyXG4gICAgTWVzOiB2Lm1lcyB8fCAnJyxcclxuICAgIEFubzogdi5hbmlvIHx8ICcnLFxyXG4gICAgVmVuZGVkb3I6IHRpdGxlQ2FzZSh2LnZlbmRvciB8fCAnJyksXHJcbiAgICAnVGlwbyBjb250YWN0byc6ICh2LnRpcG9Db250YWN0byA9PT0gJ3RlbGVmb25vJykgPyAnVGVsZWZvbm8nIDogJ1ByZXNlbmNpYWwnLFxyXG4gICAgQ29tZW50YXJpbzogdi5jb21lbnRhcmlvIHx8ICcnLFxyXG4gICAgUHJvdmluY2lhOiB0aXRsZUNhc2Uodi5wcm92aW5jaWEgfHwgJycpLFxyXG4gICAgTG9jYWxpZGFkOiB2LmxvY2FsaWRhZCB8fCAnJyxcclxuICAgIFRpZW5kYTogdi50aWVuZGEgfHwgJycsXHJcbiAgICAnVGlwbyB0aWVuZGEnOiB2LnRpcG8gfHwgJycsXHJcbiAgICBMb2NhbDogdi5sb2NhbCB8fCAnJyxcclxuICAgIFRhbWFubzogdi50YW1hbm8gfHwgJycsXHJcbiAgICBGaWRlbGlkYWQ6IHYuZmlkZWxpZGFkIHx8ICcnLFxyXG4gICAgJ1JlbGV2YW5jaWEgKDEtNSknOiB2LnJlbGV2YW5jaWEgfHwgJycsXHJcbiAgICBQT1A6IHYucG9wIHx8ICcnLFxyXG4gICAgJ05lY2VzaWRhZCBwdW50dWFsJzogKHYubmVjZXNpZGFkUHVudHVhbCA9PT0gJ01PU1RSQURPJyA/ICdNT1NUUkFET1InIDogKHYubmVjZXNpZGFkUHVudHVhbCB8fCAnJykpLFxyXG4gICAgJ1RpcG8gdmVudGEnOiAodi50aXBvVmVudGEgPT09ICdNT1NUUkFETycgPyAnTU9TVFJBRE9SJyA6ICh2LnRpcG9WZW50YSB8fCAnJykpLFxyXG4gICAgJyUgTW9zdHJhZG9yJzogdi5wb25kZXJhY2lvbk1vc3RyYWRvICE9IG51bGwgPyB2LnBvbmRlcmFjaW9uTW9zdHJhZG8gOiAnJyxcclxuICAgICclIEVjb21tZXJjZSc6IHYucG9uZGVyYWNpb25FY29tbWVyY2UgIT0gbnVsbCA/IHYucG9uZGVyYWNpb25FY29tbWVyY2UgOiAnJyxcclxuICAgIENvbXBldGVuY2lhOiB2LmNvbXBldGVuY2lhIHx8ICcnLFxyXG4gICAgJ0NhdGVnb3JpYSBjbGllbnRlJzogdi5jYXRlZ29yaWFDbGllbnRlIHx8ICcnLFxyXG4gICAgT3BvcnR1bmlkYWQ6IHYub3BvcnR1bmlkYWQgfHwgJycsXHJcbiAgICAnTG8gbWFzIHZlbmRpZG8gU2hpbWFubyc6IHYubWFzVmVuZGlkbyB8fCAnJyxcclxuICAgICdMbyBxdWUgbWFzIHByZWd1bnRhbic6IHYubWFzUHJlZ3VudGFuIHx8ICcnLFxyXG4gICAgJ0F5dWRhIGEgdGllbmRhJzogdi5heXVkYVRpZW5kYSB8fCAnJyxcclxuICAgICdGb3RvcyBlc3BhY2lvIChjYW50KSc6ICh2LmVzcGFjaW8gfHwgW10pLmxlbmd0aCxcclxuICAgICdGb3RvIGZyZW50ZSc6IHYuZnJlbnRlTG9jYWwgPyAnU2knIDogJ05vJyxcclxuICAgICdHUFMgZXN0YWRvJzogdi5ncHNTdGF0dXMgfHwgJycsXHJcbiAgICAnR1BTIGRpc3RhbmNpYSAobSknOiAodHlwZW9mIHYuZ3BzRGlzdGFuY2VNID09PSAnbnVtYmVyJykgPyB2Lmdwc0Rpc3RhbmNlTSA6ICcnLFxyXG4gICAgJ0dQUyBsYXQnOiB2Lmdwc0xhdCAhPSBudWxsID8gdi5ncHNMYXQgOiAnJyxcclxuICAgICdHUFMgbG9uJzogdi5ncHNMb24gIT0gbnVsbCA/IHYuZ3BzTG9uIDogJycsXHJcbiAgICAnR1BTIHByZWNpc2lvbiAobSknOiB2Lmdwc0FjY3VyYWN5ICE9IG51bGwgPyB2Lmdwc0FjY3VyYWN5IDogJycsXHJcbiAgICAnR1BTIGNhcHR1cmFkbyc6IHYuZ3BzQ2FwdHVyZWRBdCB8fCAnJyxcclxuICAgIEVtYWlsOiB2Lm93bmVyRW1haWwgfHwgJycsXHJcbiAgfSkpO1xyXG59XHJcblxyXG5cclxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XHJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG4vLyBTRUNDSVx1MDBEM046IGV4cG9ydEV4ZWN1dGl2ZS9WaXNpdHMvUG93ZXJCSS9NTCAoaW5saW5lIEwxMDE1OC0xMDQyNilcclxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XHJcblxyXG53aW5kb3cuZXhwb3J0RXhlY3V0aXZlID0gZnVuY3Rpb24oKXtcclxuICBjb25zdCB3YiA9IFhMU1gudXRpbHMuYm9va19uZXcoKTtcclxuICBjb25zdCByb3dzID0gYnVpbGRQZWRpZG9EZXRhaWxSb3dzKCk7XHJcbiAgY29uc3QgY29uZlJvd3MgPSByb3dzLmZpbHRlcihyID0+IHIuZXN0YWRvID09PSAnQ29uZmlybWFkbycpO1xyXG5cclxuICAvLyBDb25zb2xpZGFkbzogdW5hIGZpbGEgcG9yIHZlbmRlZG9yIGNvbiBLUElzXHJcbiAgY29uc3QgcGVyVmVuZG9yID0ge307XHJcbiAgY29uZlJvd3MuZm9yRWFjaChyID0+IHtcclxuICAgIGNvbnN0IGsgPSByLnZlbmRlZG9yIHx8ICdTaW4gYXNpZ25hcic7XHJcbiAgICBpZiAoIXBlclZlbmRvcltrXSkgcGVyVmVuZG9yW2tdID0ge3pvbmE6IHIuem9uYSwgdW5pZDowLCBhcnM6MCwgdXNkOjAsIGNsaWVudGVzOm5ldyBTZXQoKSwgcHJvZHM6bmV3IFNldCgpLCBwcm92czpuZXcgU2V0KCl9O1xyXG4gICAgcGVyVmVuZG9yW2tdLnVuaWQgKz0gci5jYW50aWRhZDtcclxuICAgIHBlclZlbmRvcltrXS5hcnMgKz0gci5zdWJ0b3RhbF9hcnM7XHJcbiAgICBwZXJWZW5kb3Jba10udXNkICs9IHIuc3VidG90YWxfdXNkO1xyXG4gICAgcGVyVmVuZG9yW2tdLmNsaWVudGVzLmFkZChyLmNsaWVudGUpO1xyXG4gICAgcGVyVmVuZG9yW2tdLnByb2RzLmFkZChyLmNvZGlnbyk7XHJcbiAgICBwZXJWZW5kb3Jba10ucHJvdnMuYWRkKHIucHJvdmluY2lhKTtcclxuICB9KTtcclxuICBjb25zdCBjb25zb2wgPSBbXTtcclxuICBWRU5ET1JTLmZvckVhY2godiA9PiB7XHJcbiAgICBjb25zdCB0aXRsZVYgPSB0aXRsZUNhc2Uodi5rZXkpO1xyXG4gICAgY29uc3QgZCA9IHBlclZlbmRvclt0aXRsZVZdIHx8IHt6b25hOiB2LnpvbmUsIHVuaWQ6MCwgYXJzOjAsIHVzZDowLCBjbGllbnRlczpuZXcgU2V0KCksIHByb2RzOm5ldyBTZXQoKSwgcHJvdnM6bmV3IFNldCgpfTtcclxuICAgIGNvbnN0IHQgPSBUQVJHRVRTX0JZX1ZFTkRPUlt2LmtleV0gfHwge2p1bDIwMjZfdXNkOjAsIGp1bERpYzIwMjZfdXNkOjAsIGFudWFsMjAyN191c2Q6MH07XHJcbiAgICBjb25zb2wucHVzaCh7XHJcbiAgICAgIFpvbmE6IHYuem9uZSxcclxuICAgICAgVmVuZGVkb3I6IHRpdGxlVixcclxuICAgICAgUHJvdmluY2lhczogZC5wcm92cy5zaXplLFxyXG4gICAgICAnQ2xpZW50ZXMgYWN0aXZvcyc6IGQuY2xpZW50ZXMuc2l6ZSxcclxuICAgICAgJ1Byb2R1Y3RvcyBkaXN0aW50b3MnOiBkLnByb2RzLnNpemUsXHJcbiAgICAgIFVuaWRhZGVzOiBkLnVuaWQsXHJcbiAgICAgICdGYWN0dXJhZG8gQVJTJzogTWF0aC5yb3VuZChkLmFycyksXHJcbiAgICAgICdGYWN0dXJhZG8gVVNEJzogTWF0aC5yb3VuZChkLnVzZCksXHJcbiAgICAgICdUYXJnZXQgSnVsIDIwMjYgVVNEJzogdC5qdWwyMDI2X3VzZCxcclxuICAgICAgJ1RhcmdldCBKdWwtRGljIDIwMjYgVVNEJzogdC5qdWxEaWMyMDI2X3VzZCxcclxuICAgICAgJ1RhcmdldCAyMDI3IFVTRCc6IHQuYW51YWwyMDI3X3VzZCxcclxuICAgIH0pO1xyXG4gIH0pO1xyXG4gIGNvbnN0IHdzQyA9IFhMU1gudXRpbHMuanNvbl90b19zaGVldChjb25zb2wpO1xyXG4gIHdzQ1snIWNvbHMnXSA9IFt7d2NoOjZ9LHt3Y2g6MjR9LHt3Y2g6MTF9LHt3Y2g6MTR9LHt3Y2g6MTZ9LHt3Y2g6MTF9LHt3Y2g6MTZ9LHt3Y2g6MTZ9LHt3Y2g6MTh9LHt3Y2g6MjB9LHt3Y2g6MTh9XTtcclxuICBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KHdiLCB3c0MsICdDb25zb2xpZGFkbycpO1xyXG5cclxuICAvLyBVbmEgaG9qYSBwb3IgdmVuZGVkb3IgY29uIHN1IGRldGFsbGUgZGUgcGVkaWRvcyBjb25maXJtYWRvc1xyXG4gIFZFTkRPUlMuZm9yRWFjaCh2ID0+IHtcclxuICAgIGNvbnN0IHRpdGxlViA9IHRpdGxlQ2FzZSh2LmtleSk7XHJcbiAgICBjb25zdCB2cm93cyA9IGNvbmZSb3dzLmZpbHRlcihyID0+IHIudmVuZGVkb3IgPT09IHRpdGxlVikubWFwKHIgPT4gKHtcclxuICAgICAgRmVjaGE6IHIuZmVjaGEsIE1lczogci5tZXNfcGVkaWRvLCBQcm92aW5jaWE6IHIucHJvdmluY2lhLCBMb2NhbGlkYWQ6IHIubG9jYWxpZGFkLFxyXG4gICAgICBDbGllbnRlOiByLmNsaWVudGUsIFRpcG86IHIudGlwb19jbGllbnRlLFxyXG4gICAgICBDb2RpZ286IHIuY29kaWdvLCBQcm9kdWN0bzogci5wcm9kdWN0bywgQ2F0ZWdvcmlhOiByLmNhdGVnb3JpYSwgRmFtaWxpYTogci5mYW1pbGlhLCBTdWJmYW1pbGlhOiByLnN1YmZhbWlsaWEsXHJcbiAgICAgIENhbnRpZGFkOiByLmNhbnRpZGFkLCAnUHJlY2lvIEFSUyc6IHIucHJlY2lvX3VuaXRfYXJzLCAnU3VidG90YWwgQVJTJzogci5zdWJ0b3RhbF9hcnMsICdTdWJ0b3RhbCBVU0QnOiByLnN1YnRvdGFsX3VzZCxcclxuICAgIH0pKTtcclxuICAgIHZyb3dzLnNvcnQoKGEsYikgPT4gKGEuRmVjaGF8fCcnKS5sb2NhbGVDb21wYXJlKGIuRmVjaGF8fCcnKSB8fCBhLkNsaWVudGUubG9jYWxlQ29tcGFyZShiLkNsaWVudGUpKTtcclxuICAgIGlmICghdnJvd3MubGVuZ3RoKSB2cm93cy5wdXNoKHtGZWNoYTonJywgTWVzOicnLCBQcm92aW5jaWE6JycsIExvY2FsaWRhZDonJywgQ2xpZW50ZTonKHNpbiBwZWRpZG9zIGNvbmZpcm1hZG9zKScsIFRpcG86JycsIENvZGlnbzonJywgUHJvZHVjdG86JycsIENhdGVnb3JpYTonJywgRmFtaWxpYTonJywgU3ViZmFtaWxpYTonJywgQ2FudGlkYWQ6MCwgJ1ByZWNpbyBBUlMnOjAsICdTdWJ0b3RhbCBBUlMnOjAsICdTdWJ0b3RhbCBVU0QnOjB9KTtcclxuICAgIGNvbnN0IHdzID0gWExTWC51dGlscy5qc29uX3RvX3NoZWV0KHZyb3dzKTtcclxuICAgIHdzWychY29scyddID0gW3t3Y2g6MTF9LHt3Y2g6MTR9LHt3Y2g6MTh9LHt3Y2g6MjJ9LHt3Y2g6MzB9LHt3Y2g6MTF9LHt3Y2g6MTR9LHt3Y2g6Mzh9LHt3Y2g6MTR9LHt3Y2g6MTh9LHt3Y2g6MTh9LHt3Y2g6MTB9LHt3Y2g6MTJ9LHt3Y2g6MTR9LHt3Y2g6MTR9XTtcclxuICAgIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQod2IsIHdzLCAodi56b25lICsgJyAnICsgdGl0bGVWKS5zdWJzdHJpbmcoMCwgMzEpLnJlcGxhY2UoL1tcXFxcL1xcKlxcP1xcW1xcXTpdL2csJycpKTtcclxuICB9KTtcclxuXHJcbiAgLy8gVmlzaXRhc1xyXG4gIGNvbnN0IHZpc2l0Um93cyA9IGJ1aWxkVmlzaXRSb3dzKCk7XHJcbiAgaWYgKHZpc2l0Um93cy5sZW5ndGgpIHtcclxuICAgIGNvbnN0IHdzViA9IFhMU1gudXRpbHMuanNvbl90b19zaGVldCh2aXNpdFJvd3MpO1xyXG4gICAgWExTWC51dGlscy5ib29rX2FwcGVuZF9zaGVldCh3Yiwgd3NWLCAnVmlzaXRhcycpO1xyXG4gIH1cclxuICAvLyBDb250YWN0YWRvcyAodG9kb3MgbG9zIGNsaWVudGVzL3Byb3NwZWN0b3MgbWFyY2Fkb3MgY29uIGNoZWNrKVxyXG4gIGNvbnN0IGNvbnRhY3RSb3dzID0gYnVpbGRDb250YWN0YWRvc1Jvd3MoKTtcclxuICBpZiAoY29udGFjdFJvd3MubGVuZ3RoKSB7XHJcbiAgICBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KHdiLCBYTFNYLnV0aWxzLmpzb25fdG9fc2hlZXQoY29udGFjdFJvd3MpLCAnQ29udGFjdGFkb3MnKTtcclxuICB9XHJcbiAgLy8gTG9nIGRlIG9wZXJhY2lvbmVzIChjYW5jZWxhY2lvbmVzLCBlbGltaW5hY2lvbmVzLCBldGMuKVxyXG4gIGNvbnN0IG9wc1Jvd3MgPSBidWlsZE9wc0xvZ1Jvd3MoKTtcclxuICBpZiAob3BzUm93cy5sZW5ndGgpIHtcclxuICAgIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQod2IsIFhMU1gudXRpbHMuanNvbl90b19zaGVldChvcHNSb3dzKSwgJ0xvZyBPcGVyYWNpb25lcycpO1xyXG4gIH1cclxuXHJcbiAgWExTWC53cml0ZUZpbGUod2IsICdTaGltYW5vX0VqZWN1dGl2b18nICsgdG9kYXlTdHIoKSArICcueGxzeCcpO1xyXG59O1xyXG5cclxuLy8gLS0tLS0tLS0tLSBFeGNlbCBkZSBWaXNpdGFzIChmb3JtYXRvIHN0YW5kYWxvbmUpIC0tLS0tLS0tLS1cclxud2luZG93LmV4cG9ydFZpc2l0c0V4Y2VsID0gZnVuY3Rpb24oKXtcclxuICBpZiAodHlwZW9mIFhMU1ggPT09ICd1bmRlZmluZWQnKSB7XHJcbiAgICBhbGVydCgnTGEgbGlicmVyaWEgZGUgRXhjZWwgbm8gc2UgY2FyZ28uIFZlcmlmaXF1ZSBzdSBjb25leGlvbiBhIGludGVybmV0IHkgcmVpbnRlbnRlLicpO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuICBjb25zdCB2aXNpdFJvd3MgPSBidWlsZFZpc2l0Um93cygpO1xyXG4gIGlmICghdmlzaXRSb3dzLmxlbmd0aCkge1xyXG4gICAgYWxlcnQoJ05vIGhheSB2aXNpdGFzIHJlZ2lzdHJhZGFzIHRvZGF2aWEuIEN1YW5kbyBzZSBjYXJndWUgYWwgbWVub3MgdW5hLCB2YXMgYSBwb2RlciBleHBvcnRhcmxhLicpO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuICBjb25zdCB3YiA9IFhMU1gudXRpbHMuYm9va19uZXcoKTtcclxuXHJcbiAgLy8gSG9qYSBwcmluY2lwYWw6IFZpc2l0YXMgKHRvZGFzIGxhcyBmaWxhcylcclxuICBjb25zdCB3cyA9IFhMU1gudXRpbHMuanNvbl90b19zaGVldCh2aXNpdFJvd3MpO1xyXG4gIHdzWychY29scyddID0gW1xyXG4gICAge3djaDoxMn0se3djaDoxNH0se3djaDo4fSx7d2NoOjI0fSx7d2NoOjE4fSx7d2NoOjIyfSx7d2NoOjMwfSx7d2NoOjE4fSxcclxuICAgIHt3Y2g6MTR9LHt3Y2g6MTR9LHt3Y2g6MTR9LHt3Y2g6MTZ9LHt3Y2g6OH0se3djaDoyMn0se3djaDoxNH0sXHJcbiAgICB7d2NoOjE0fSx7d2NoOjE0fSx7d2NoOjE4fSx7d2NoOjE4fSx7d2NoOjMyfSx7d2NoOjMyfSx7d2NoOjMyfSx7d2NoOjMyfSxcclxuICAgIHt3Y2g6MTh9LHt3Y2g6MTR9LHt3Y2g6MjR9LFxyXG4gIF07XHJcbiAgWExTWC51dGlscy5ib29rX2FwcGVuZF9zaGVldCh3Yiwgd3MsICdWaXNpdGFzJyk7XHJcblxyXG4gIC8vIEhvamEgcmVzdW1lbiBwb3IgdmVuZGVkb3I6IGNhbnRpZGFkIGRlIHZpc2l0YXMgeSB0aWVuZGFzIHVuaWNhc1xyXG4gIGNvbnN0IHBlclZlbmRvciA9IHt9O1xyXG4gIHZpc2l0c0NhY2hlLmZvckVhY2godiA9PiB7XHJcbiAgICBjb25zdCBrID0gdGl0bGVDYXNlKHYudmVuZG9yIHx8ICdTaW4gYXNpZ25hcicpO1xyXG4gICAgaWYgKCFwZXJWZW5kb3Jba10pIHBlclZlbmRvcltrXSA9IHt2aXNpdGFzOiAwLCB0aWVuZGFzOiBuZXcgU2V0KCksIGxvY2FsaWRhZGVzOiBuZXcgU2V0KCksIHByb3ZpbmNpYXM6IG5ldyBTZXQoKX07XHJcbiAgICBwZXJWZW5kb3Jba10udmlzaXRhcysrO1xyXG4gICAgaWYgKHYudGllbmRhKSBwZXJWZW5kb3Jba10udGllbmRhcy5hZGQodi50aWVuZGEpO1xyXG4gICAgaWYgKHYubG9jYWxpZGFkKSBwZXJWZW5kb3Jba10ubG9jYWxpZGFkZXMuYWRkKHYubG9jYWxpZGFkKTtcclxuICAgIGlmICh2LnByb3ZpbmNpYSkgcGVyVmVuZG9yW2tdLnByb3ZpbmNpYXMuYWRkKHYucHJvdmluY2lhKTtcclxuICB9KTtcclxuICBjb25zdCByZXN1bWVuID0gT2JqZWN0LmVudHJpZXMocGVyVmVuZG9yKS5tYXAoKFt2ZW5kZWRvciwgZF0pID0+ICh7XHJcbiAgICBWZW5kZWRvcjogdmVuZGVkb3IsXHJcbiAgICAnVmlzaXRhcyB0b3RhbGVzJzogZC52aXNpdGFzLFxyXG4gICAgJ1RpZW5kYXMgZGlzdGludGFzJzogZC50aWVuZGFzLnNpemUsXHJcbiAgICAnTG9jYWxpZGFkZXMgZGlzdGludGFzJzogZC5sb2NhbGlkYWRlcy5zaXplLFxyXG4gICAgJ1Byb3ZpbmNpYXMgZGlzdGludGFzJzogZC5wcm92aW5jaWFzLnNpemUsXHJcbiAgfSkpLnNvcnQoKGEsIGIpID0+IGJbJ1Zpc2l0YXMgdG90YWxlcyddIC0gYVsnVmlzaXRhcyB0b3RhbGVzJ10pO1xyXG4gIGlmIChyZXN1bWVuLmxlbmd0aCkge1xyXG4gICAgY29uc3Qgd3NSID0gWExTWC51dGlscy5qc29uX3RvX3NoZWV0KHJlc3VtZW4pO1xyXG4gICAgd3NSWychY29scyddID0gW3t3Y2g6MjR9LHt3Y2g6MTZ9LHt3Y2g6MTh9LHt3Y2g6MjJ9LHt3Y2g6MjJ9XTtcclxuICAgIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQod2IsIHdzUiwgJ1Jlc3VtZW4gcG9yIHZlbmRlZG9yJyk7XHJcbiAgfVxyXG5cclxuICBYTFNYLndyaXRlRmlsZSh3YiwgJ1NoaW1hbm9fVmlzaXRhc18nICsgdG9kYXlTdHIoKSArICcueGxzeCcpO1xyXG59O1xyXG5cclxuLy8gLS0tLS0tLS0tLSBPUENJT04gQjogUG93ZXIgQkkgKEZhY3QgKyBEaW0pIC0tLS0tLS0tLS1cclxud2luZG93LmV4cG9ydFBvd2VyQkkgPSBmdW5jdGlvbigpe1xyXG4gIGNvbnN0IHdiID0gWExTWC51dGlscy5ib29rX25ldygpO1xyXG4gIGNvbnN0IHJvd3MgPSBidWlsZFBlZGlkb0RldGFpbFJvd3MoKTtcclxuXHJcbiAgLy8gRmFjdF9QZWRpZG9zXHJcbiAgY29uc3QgZmFjdFJvd3MgPSByb3dzLmZpbHRlcihyID0+IHIuZXN0YWRvICE9PSAnQm9ycmFkb3InKTtcclxuICBjb25zdCB3c0YgPSBYTFNYLnV0aWxzLmpzb25fdG9fc2hlZXQoZmFjdFJvd3MubWFwKHIgPT4gKHtcclxuICAgIGxpbmVfaWQ6IHIubGluZV9pZCxcclxuICAgIGZlY2hhOiByLmZlY2hhLFxyXG4gICAgZXN0YWRvOiByLmVzdGFkbyxcclxuICAgIHZlbmRlZG9yX2tleTogci52ZW5kZWRvcl9rZXksXHJcbiAgICB6b25hOiByLnpvbmEsXHJcbiAgICBwcm92aW5jaWE6IHIucHJvdmluY2lhLFxyXG4gICAgbG9jYWxpZGFkOiByLmxvY2FsaWRhZCxcclxuICAgIGNsaWVudGU6IHIuY2xpZW50ZSxcclxuICAgIHRpcG9fY2xpZW50ZTogci50aXBvX2NsaWVudGUsXHJcbiAgICBza3U6IHIuY29kaWdvLFxyXG4gICAgY2FudGlkYWQ6IHIuY2FudGlkYWQsXHJcbiAgICBwcmVjaW9fdW5pdF9hcnM6IHIucHJlY2lvX3VuaXRfYXJzLFxyXG4gICAgc3VidG90YWxfYXJzOiByLnN1YnRvdGFsX2FycyxcclxuICAgIHN1YnRvdGFsX3VzZDogci5zdWJ0b3RhbF91c2QsXHJcbiAgfSkpKTtcclxuICBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KHdiLCB3c0YsICdGYWN0X1BlZGlkb3MnKTtcclxuXHJcbiAgLy8gRGltX1ZlbmRlZG9yXHJcbiAgY29uc3QgZGltViA9IFZFTkRPUlMubWFwKHYgPT4ge1xyXG4gICAgY29uc3QgdCA9IFRBUkdFVFNfQllfVkVORE9SW3Yua2V5XSB8fCB7fTtcclxuICAgIHJldHVybiB7XHJcbiAgICAgIHZlbmRlZG9yX2tleTogdi5rZXksXHJcbiAgICAgIHZlbmRlZG9yX25vbWJyZTogdGl0bGVDYXNlKHYua2V5KSxcclxuICAgICAgem9uYTogdi56b25lLFxyXG4gICAgICB6b25hX2Rlc2NyaXBjaW9uOiB2LmxhYmVsLFxyXG4gICAgICBjb2xvcjogdi5jb2xvcixcclxuICAgICAgdGFyZ2V0X2p1bDIwMjZfdXNkOiB0Lmp1bDIwMjZfdXNkIHx8IDAsXHJcbiAgICAgIHRhcmdldF9qdWxEaWMyMDI2X3VzZDogdC5qdWxEaWMyMDI2X3VzZCB8fCAwLFxyXG4gICAgICB0YXJnZXRfMjAyN191c2Q6IHQuYW51YWwyMDI3X3VzZCB8fCAwLFxyXG4gICAgfTtcclxuICB9KTtcclxuICBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KHdiLCBYTFNYLnV0aWxzLmpzb25fdG9fc2hlZXQoZGltViksICdEaW1fVmVuZGVkb3InKTtcclxuXHJcbiAgLy8gRGltX1Byb2R1Y3RvXHJcbiAgY29uc3QgZGltUCA9IFBST0RVQ1RTLm1hcChwID0+ICh7c2t1OiBwLmNvZGUsIGRlc2NyaXBjaW9uOiBwLmRlc2MsIGNhdGVnb3JpYTogcC5jYXQsIGZhbWlsaWE6IHAuZmFtLCBzdWJmYW1pbGlhOiBwLnN1Yn0pKTtcclxuICBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KHdiLCBYTFNYLnV0aWxzLmpzb25fdG9fc2hlZXQoZGltUCksICdEaW1fUHJvZHVjdG8nKTtcclxuXHJcbiAgLy8gRGltX0NsaWVudGUgKHVuaXZlcnNvKVxyXG4gIGNvbnN0IGRpbUMgPSBbXTtcclxuICBQT0lOVFMuZm9yRWFjaChwID0+IHtcclxuICAgIGNvbnN0IHZtID0gdmVuZG9yTG9va3VwW3AudmVuZG9yXTtcclxuICAgIHAuY2xpZW50cy5mb3JFYWNoKG4gPT4gZGltQy5wdXNoKHtjbGllbnRlOiBuLCB0aXBvOiAnQ2xpZW50ZSBhY3R1YWwnLCBwcm92aW5jaWE6IHRpdGxlQ2FzZShwLnByb3ZpbmNlKSwgbG9jYWxpZGFkOiBwLm5hbWUsIGRlcGFydGFtZW50bzogcC5kZXB0IHx8ICcnLCB2ZW5kZWRvcl9rZXk6IHAudmVuZG9yIHx8ICcnLCB6b25hOiB2bSA/IHZtLnpvbmUgOiAnJ30pKTtcclxuICAgIHAucHJvc3BlY3RzLmZvckVhY2gobiA9PiBkaW1DLnB1c2goe2NsaWVudGU6IG4sIHRpcG86ICdQcm9zcGVjdG8nLCBwcm92aW5jaWE6IHRpdGxlQ2FzZShwLnByb3ZpbmNlKSwgbG9jYWxpZGFkOiBwLm5hbWUsIGRlcGFydGFtZW50bzogcC5kZXB0IHx8ICcnLCB2ZW5kZWRvcl9rZXk6IHAudmVuZG9yIHx8ICcnLCB6b25hOiB2bSA/IHZtLnpvbmUgOiAnJ30pKTtcclxuICB9KTtcclxuICBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KHdiLCBYTFNYLnV0aWxzLmpzb25fdG9fc2hlZXQoZGltQyksICdEaW1fQ2xpZW50ZScpO1xyXG5cclxuICAvLyBEaW1fQ2FsZW5kYXJpbyAoZmVjaGFzIGRpc3RpbnRhcyBlbiBsb3MgcGVkaWRvcyArIHNlcmllIGNvbnRpbnVhIGRlbCBhXHUwMEYxbyBhY3R1YWwpXHJcbiAgY29uc3QgY2FsU2V0ID0gbmV3IFNldCgpO1xyXG4gIGZhY3RSb3dzLmZvckVhY2gociA9PiB7IGlmIChyLmZlY2hhKSBjYWxTZXQuYWRkKHIuZmVjaGEpOyB9KTtcclxuICAvLyBDb21wbGV0YXIgZGVzZGUgMjAyNi0wMS0wMSBoYXN0YSBob3kgKyAzNjVcclxuICBjb25zdCBzdGFydCA9IG5ldyBEYXRlKCcyMDI2LTAxLTAxJyk7XHJcbiAgY29uc3QgZW5kID0gbmV3IERhdGUoKTsgZW5kLnNldERhdGUoZW5kLmdldERhdGUoKSArIDM2NSk7XHJcbiAgZm9yIChsZXQgZCA9IG5ldyBEYXRlKHN0YXJ0KTsgZCA8PSBlbmQ7IGQuc2V0RGF0ZShkLmdldERhdGUoKSsxKSkgY2FsU2V0LmFkZChkLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwxMCkpO1xyXG4gIGNvbnN0IGRpbUNhbCA9IFsuLi5jYWxTZXRdLnNvcnQoKS5tYXAoZHQgPT4ge1xyXG4gICAgY29uc3QgW3ksbSxkYV0gPSBkdC5zcGxpdCgnLScpLm1hcCh4ID0+IHBhcnNlSW50KHgpKTtcclxuICAgIGNvbnN0IGRhdGVPYmogPSBuZXcgRGF0ZSh5LCBtLTEsIGRhKTtcclxuICAgIHJldHVybiB7ZmVjaGE6IGR0LCB5ZWFyOiB5LCBtb250aDogbSwgZGF5OiBkYSwgcXVhcnRlcjogJ1EnICsgKE1hdGguZmxvb3IoKG0tMSkvMykrMSksIG1vbnRoX25hbWU6IE1FU0VTW20tMV0sIHllYXJfbW9udGg6IHkgKyAnLScgKyBTdHJpbmcobSkucGFkU3RhcnQoMiwnMCcpLCBkYXlfb2Zfd2VlazogWydEb20nLCdMdW4nLCdNYXInLCdNaWUnLCdKdWUnLCdWaWUnLCdTYWInXVtkYXRlT2JqLmdldERheSgpXX07XHJcbiAgfSk7XHJcbiAgWExTWC51dGlscy5ib29rX2FwcGVuZF9zaGVldCh3YiwgWExTWC51dGlscy5qc29uX3RvX3NoZWV0KGRpbUNhbCksICdEaW1fQ2FsZW5kYXJpbycpO1xyXG5cclxuICAvLyBEaW1fQ2FtcGFuaWFcclxuICBjb25zdCBkaW1DbXAgPSBjYW1wYWlnbnNDYWNoZS5tYXAoYyA9PiAoe2NhbXBhbmlhX2lkOiBjLmlkLCBub21icmU6IGMubmFtZSwgZmlsdGVyX3R5cGU6IGMuZmlsdGVyVHlwZSwgZmlsdGVyX3ZhbHVlczogKGMuZmlsdGVyVmFsdWVzfHxbXSkuam9pbignLCAnKSwgdGFyZ2V0X3R5cGU6IGMudGFyZ2V0VHlwZSwgdGFyZ2V0X2Ftb3VudDogYy50YXJnZXRBbW91bnQsIGRlc2RlOiBjLnN0YXJ0RGF0ZSwgaGFzdGE6IGMuZW5kRGF0ZX0pKTtcclxuICBpZiAoZGltQ21wLmxlbmd0aCkgWExTWC51dGlscy5ib29rX2FwcGVuZF9zaGVldCh3YiwgWExTWC51dGlscy5qc29uX3RvX3NoZWV0KGRpbUNtcCksICdEaW1fQ2FtcGFuaWEnKTtcclxuXHJcbiAgLy8gUGFyYW1zICh0aXBvIGRlIGNhbWJpbywgZmVjaGEgZXhwb3J0LCB2ZXJzaW9uKVxyXG4gIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQod2IsIFhMU1gudXRpbHMuanNvbl90b19zaGVldChbXHJcbiAgICB7cGFyYW1ldHJvOiAnZXhjaGFuZ2VfcmF0ZV9hcnNfdXNkJywgdmFsb3I6IEVYQ0hBTkdFX1JBVEV9LFxyXG4gICAge3BhcmFtZXRybzogJ2ZlY2hhX2V4cG9ydCcsIHZhbG9yOiB0b2RheVN0cigpfSxcclxuICAgIHtwYXJhbWV0cm86ICd0b3RhbF9maWxhc19mYWN0JywgdmFsb3I6IGZhY3RSb3dzLmxlbmd0aH0sXHJcbiAgXSksICdQYXJhbWV0cm9zJyk7XHJcblxyXG4gIC8vIEZhY3RfVmlzaXRhc1xyXG4gIGNvbnN0IHZpc2l0Um93c0IgPSBidWlsZFZpc2l0Um93cygpO1xyXG4gIGlmICh2aXNpdFJvd3NCLmxlbmd0aCkgWExTWC51dGlscy5ib29rX2FwcGVuZF9zaGVldCh3YiwgWExTWC51dGlscy5qc29uX3RvX3NoZWV0KHZpc2l0Um93c0IpLCAnRmFjdF9WaXNpdGFzJyk7XHJcbiAgLy8gQ29udGFjdGFkb3NcclxuICBjb25zdCBjb250YWN0Um93c0IgPSBidWlsZENvbnRhY3RhZG9zUm93cygpO1xyXG4gIGlmIChjb250YWN0Um93c0IubGVuZ3RoKSBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KHdiLCBYTFNYLnV0aWxzLmpzb25fdG9fc2hlZXQoY29udGFjdFJvd3NCKSwgJ0NvbnRhY3RhZG9zJyk7XHJcbiAgLy8gTG9nIGRlIG9wZXJhY2lvbmVzXHJcbiAgY29uc3Qgb3BzUm93c0IgPSBidWlsZE9wc0xvZ1Jvd3MoKTtcclxuICBpZiAob3BzUm93c0IubGVuZ3RoKSBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KHdiLCBYTFNYLnV0aWxzLmpzb25fdG9fc2hlZXQob3BzUm93c0IpLCAnTG9nX09wZXJhY2lvbmVzJyk7XHJcblxyXG4gIFhMU1gud3JpdGVGaWxlKHdiLCAnU2hpbWFub19Qb3dlckJJXycgKyB0b2RheVN0cigpICsgJy54bHN4Jyk7XHJcbn07XHJcblxyXG4vLyAtLS0tLS0tLS0tIE9QQ0lPTiBDOiBQeXRob24gLyBJQSAvIE1MIChzaW5nbGUgbG9uZy1mb3JtYXQgdGFibGUpIC0tLS0tLS0tLS1cclxud2luZG93LmV4cG9ydE1MID0gZnVuY3Rpb24oKXtcclxuICBjb25zdCB3YiA9IFhMU1gudXRpbHMuYm9va19uZXcoKTtcclxuICBjb25zdCByb3dzID0gYnVpbGRQZWRpZG9EZXRhaWxSb3dzKCk7XHJcbiAgLy8gbWFzdGVyX21sOiB1bmEgZmlsYSBwb3IgbGluZWEgY29uIFRPREFTIGxhcyBmZWF0dXJlc1xyXG4gIGNvbnN0IHdzID0gWExTWC51dGlscy5qc29uX3RvX3NoZWV0KHJvd3MpO1xyXG4gIHdzWychY29scyddID0gT2JqZWN0LmtleXMocm93c1swXSB8fCB7ZmVjaGE6Jyd9KS5tYXAoKCkgPT4gKHt3Y2g6MTR9KSk7XHJcbiAgWExTWC51dGlscy5ib29rX2FwcGVuZF9zaGVldCh3Yiwgd3MsICdtYXN0ZXJfbWwnKTtcclxuXHJcbiAgLy8gY2F0YWxvZ28geSB1bml2ZXJzbyBkZSBjbGllbnRlcyBjb21vIHJlZmVyZW5jaWFzIHBhcmEgZW5yaXF1ZWNlciBlbiBwYW5kYXNcclxuICBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KHdiLCBYTFNYLnV0aWxzLmpzb25fdG9fc2hlZXQoUFJPRFVDVFMubWFwKHAgPT4gKHtjb2RlOiBwLmNvZGUsIGRlc2M6IHAuZGVzYywgY2F0OiBwLmNhdCwgZmFtOiBwLmZhbSwgc3ViOiBwLnN1Yn0pKSksICdwcm9kdWN0b3NfY2F0YWxvZ28nKTtcclxuXHJcbiAgY29uc3QgdW5pdmVyc2UgPSBbXTtcclxuICBQT0lOVFMuZm9yRWFjaChwID0+IHtcclxuICAgIGNvbnN0IHZtID0gdmVuZG9yTG9va3VwW3AudmVuZG9yXTtcclxuICAgIHAuY2xpZW50cy5mb3JFYWNoKG4gPT4gdW5pdmVyc2UucHVzaCh7Y2xpZW50ZTogbiwgdGlwbzogJ2NsaWVudGVfYWN0dWFsJywgcHJvdmluY2lhOiB0aXRsZUNhc2UocC5wcm92aW5jZSksIGxvY2FsaWRhZDogcC5uYW1lLCBkZXBhcnRhbWVudG86IHAuZGVwdCB8fCAnJywgdmVuZGVkb3I6IHRpdGxlQ2FzZShwLnZlbmRvciB8fCAnJyksIHpvbmE6IHZtID8gdm0uem9uZSA6ICcnLCBsYXQ6IHAubGF0LCBsb246IHAubG9ufSkpO1xyXG4gICAgcC5wcm9zcGVjdHMuZm9yRWFjaChuID0+IHVuaXZlcnNlLnB1c2goe2NsaWVudGU6IG4sIHRpcG86ICdwcm9zcGVjdG8nLCBwcm92aW5jaWE6IHRpdGxlQ2FzZShwLnByb3ZpbmNlKSwgbG9jYWxpZGFkOiBwLm5hbWUsIGRlcGFydGFtZW50bzogcC5kZXB0IHx8ICcnLCB2ZW5kZWRvcjogdGl0bGVDYXNlKHAudmVuZG9yIHx8ICcnKSwgem9uYTogdm0gPyB2bS56b25lIDogJycsIGxhdDogcC5sYXQsIGxvbjogcC5sb259KSk7XHJcbiAgfSk7XHJcbiAgWExTWC51dGlscy5ib29rX2FwcGVuZF9zaGVldCh3YiwgWExTWC51dGlscy5qc29uX3RvX3NoZWV0KHVuaXZlcnNlKSwgJ3VuaXZlcnNvX2NsaWVudGVzJyk7XHJcblxyXG4gIC8vIHRhcmdldHMgY29tbyB0YWJsYSBsb25nXHJcbiAgY29uc3QgdGFyZ2V0c0xvbmcgPSBbXTtcclxuICBPYmplY3QuZW50cmllcyhUQVJHRVRTX0JZX1ZFTkRPUikuZm9yRWFjaCgoW3ZlbmRvciwgdF0pID0+IHtcclxuICAgIHRhcmdldHNMb25nLnB1c2goe3ZlbmRlZG9yOiB0aXRsZUNhc2UodmVuZG9yKSwgcGVyaW9kbzogJ0p1bCAyMDI2Jywgc3RhcnRfZGF0ZTogJzIwMjYtMDctMDEnLCBlbmRfZGF0ZTogJzIwMjYtMDctMzEnLCB0YXJnZXRfdXNkOiB0Lmp1bDIwMjZfdXNkIHx8IDB9KTtcclxuICAgIHRhcmdldHNMb25nLnB1c2goe3ZlbmRlZG9yOiB0aXRsZUNhc2UodmVuZG9yKSwgcGVyaW9kbzogJ0p1bC1EaWMgMjAyNicsIHN0YXJ0X2RhdGU6ICcyMDI2LTA3LTAxJywgZW5kX2RhdGU6ICcyMDI2LTEyLTMxJywgdGFyZ2V0X3VzZDogdC5qdWxEaWMyMDI2X3VzZCB8fCAwfSk7XHJcbiAgICB0YXJnZXRzTG9uZy5wdXNoKHt2ZW5kZWRvcjogdGl0bGVDYXNlKHZlbmRvciksIHBlcmlvZG86ICcyMDI3Jywgc3RhcnRfZGF0ZTogJzIwMjctMDEtMDEnLCBlbmRfZGF0ZTogJzIwMjctMTItMzEnLCB0YXJnZXRfdXNkOiB0LmFudWFsMjAyN191c2QgfHwgMH0pO1xyXG4gIH0pO1xyXG4gIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQod2IsIFhMU1gudXRpbHMuanNvbl90b19zaGVldCh0YXJnZXRzTG9uZyksICd0YXJnZXRzX2xvbmcnKTtcclxuXHJcbiAgLy8gY2FtcGFcdTAwRjFhc1xyXG4gIGlmIChjYW1wYWlnbnNDYWNoZS5sZW5ndGgpIHtcclxuICAgIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQod2IsIFhMU1gudXRpbHMuanNvbl90b19zaGVldChjYW1wYWlnbnNDYWNoZS5tYXAoYyA9PiAoe2lkOiBjLmlkLCBub21icmU6IGMubmFtZSwgZmlsdGVyX3R5cGU6IGMuZmlsdGVyVHlwZSwgZmlsdGVyX3ZhbHVlczogKGMuZmlsdGVyVmFsdWVzfHxbXSkuam9pbignLCcpLCB0YXJnZXRfdHlwZTogYy50YXJnZXRUeXBlLCB0YXJnZXRfYW1vdW50OiBjLnRhcmdldEFtb3VudCwgc3RhcnRfZGF0ZTogYy5zdGFydERhdGUsIGVuZF9kYXRlOiBjLmVuZERhdGV9KSkpLCAnY2FtcGFuaWFzJyk7XHJcbiAgfVxyXG5cclxuICAvLyBwYXJhbWV0cm9zXHJcbiAgWExTWC51dGlscy5ib29rX2FwcGVuZF9zaGVldCh3YiwgWExTWC51dGlscy5qc29uX3RvX3NoZWV0KFtcclxuICAgIHtwYXJhbWV0cm86ICdleGNoYW5nZV9yYXRlX2Fyc191c2QnLCB2YWxvcjogRVhDSEFOR0VfUkFURX0sXHJcbiAgICB7cGFyYW1ldHJvOiAnZmVjaGFfZXhwb3J0JywgdmFsb3I6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKX0sXHJcbiAgXSksICdwYXJhbWV0cm9zJyk7XHJcblxyXG4gIC8vIHZpc2l0YXNcclxuICBjb25zdCB2aXNpdFJvd3NDID0gYnVpbGRWaXNpdFJvd3MoKTtcclxuICBpZiAodmlzaXRSb3dzQy5sZW5ndGgpIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQod2IsIFhMU1gudXRpbHMuanNvbl90b19zaGVldCh2aXNpdFJvd3NDKSwgJ3Zpc2l0YXMnKTtcclxuICAvLyBjb250YWN0YWRvc1xyXG4gIGNvbnN0IGNvbnRhY3RSb3dzQyA9IGJ1aWxkQ29udGFjdGFkb3NSb3dzKCk7XHJcbiAgaWYgKGNvbnRhY3RSb3dzQy5sZW5ndGgpIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQod2IsIFhMU1gudXRpbHMuanNvbl90b19zaGVldChjb250YWN0Um93c0MpLCAnY29udGFjdGFkb3MnKTtcclxuICAvLyBsb2cgZGUgb3BlcmFjaW9uZXNcclxuICBjb25zdCBvcHNSb3dzQyA9IGJ1aWxkT3BzTG9nUm93cygpO1xyXG4gIGlmIChvcHNSb3dzQy5sZW5ndGgpIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQod2IsIFhMU1gudXRpbHMuanNvbl90b19zaGVldChvcHNSb3dzQyksICdsb2dfb3BlcmFjaW9uZXMnKTtcclxuXHJcbiAgWExTWC53cml0ZUZpbGUod2IsICdTaGltYW5vX01MXycgKyB0b2RheVN0cigpICsgJy54bHN4Jyk7XHJcbn07XHJcblxyXG5cclxuLy8gPT09IEV4cG9ydHMgYSB3aW5kb3cgPT09XHJcbi8vIFRvZGFzIGxhcyBmdW5jaW9uZXMgd2luZG93LmZvbyA9IGZ1bmN0aW9uLi4uIHlhIGVzdFx1MDBFMW4gdmVyYmF0aW0uXHJcbmlmICh0eXBlb2Ygd2luZG93LnRvZGF5U3RyID09PSBcInVuZGVmaW5lZFwiKSB3aW5kb3cudG9kYXlTdHIgPSB0b2RheVN0cjtcclxuLy8gRTYgaG90Zml4IDI6IGRhdGFVcmxUb0Jsb2IgKyBzYW5pdGl6ZUZvclBhdGggdXNhZG9zIHBvciBpbmxpbmUgcnVuRnVsbEJhY2t1cCAoTDcyNzgtNzI4OCkuXHJcbmlmICh0eXBlb2Ygd2luZG93LmRhdGFVcmxUb0Jsb2IgPT09IFwidW5kZWZpbmVkXCIpIHdpbmRvdy5kYXRhVXJsVG9CbG9iID0gZGF0YVVybFRvQmxvYjtcclxuaWYgKHR5cGVvZiB3aW5kb3cuc2FuaXRpemVGb3JQYXRoID09PSBcInVuZGVmaW5lZFwiKSB3aW5kb3cuc2FuaXRpemVGb3JQYXRoID0gc2FuaXRpemVGb3JQYXRoO1xyXG4vLyBFNiBob3RmaXggMzogY3Jvc3MtbW9kdWxlIGJ1ZyAoYXVkaXQgY3Jvc3NidW5kbGUpIFx1MjAxNCBleHBvcnRzLWNvcmUgbGxhbWEgbG9hZEV4Y2VsSlMuXHJcbndpbmRvdy5sb2FkRXhjZWxKUyA9IGxvYWRFeGNlbEpTO1xyXG4iXSwKICAibWFwcGluZ3MiOiAiOzs7QUF3QkEsV0FBUyxXQUFVO0FBQUUsWUFBTyxvQkFBSSxLQUFLLEdBQUUsWUFBWSxFQUFFLE1BQU0sR0FBRSxFQUFFO0FBQUEsRUFBRztBQUdsRSxXQUFTLGNBQWMsU0FBUTtBQUM3QixRQUFJLENBQUMsUUFBUyxRQUFPO0FBQ3JCLFVBQU0sUUFBUSxRQUFRLE1BQU0sR0FBRztBQUMvQixRQUFJLE1BQU0sU0FBUyxFQUFHLFFBQU87QUFDN0IsVUFBTSxZQUFZLE1BQU0sQ0FBQyxFQUFFLE1BQU0sU0FBUztBQUMxQyxVQUFNLE9BQU8sWUFBWSxVQUFVLENBQUMsSUFBSTtBQUN4QyxVQUFNLFFBQVEsS0FBSyxNQUFNLENBQUMsQ0FBQztBQUMzQixVQUFNLE1BQU0sSUFBSSxXQUFXLE1BQU0sTUFBTTtBQUN2QyxhQUFTLElBQUksR0FBRyxJQUFJLE1BQU0sUUFBUSxJQUFLLEtBQUksQ0FBQyxJQUFJLE1BQU0sV0FBVyxDQUFDO0FBQ2xFLFdBQU8sSUFBSSxLQUFLLENBQUMsR0FBRyxHQUFHLEVBQUMsTUFBTSxLQUFJLENBQUM7QUFBQSxFQUNyQztBQUdBLFdBQVMsZ0JBQWdCLEdBQUU7QUFDekIsV0FBTyxPQUFPLEtBQUssRUFBRSxFQUFFLFFBQVEscUJBQXFCLEdBQUcsRUFBRSxRQUFRLFFBQVEsR0FBRyxFQUFFLEtBQUssRUFBRSxNQUFNLEdBQUcsRUFBRTtBQUFBLEVBQ2xHO0FBR0EsU0FBTyxrQkFBa0IsaUJBQWdCO0FBQ3ZDLFFBQUksT0FBTyxVQUFVLGFBQWE7QUFBRSxZQUFNLHdEQUF3RDtBQUFHO0FBQUEsSUFBUTtBQUM3RyxRQUFJLENBQUMsZUFBZSxDQUFDLFlBQVksUUFBUTtBQUFFLFlBQU0sNkJBQTZCO0FBQUc7QUFBQSxJQUFRO0FB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
