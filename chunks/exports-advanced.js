"use strict";
(() => {
  // src/pure/csv-serializer.js
  function csvEscape(s) {
    if (s === null || s === void 0) return "";
    const str = String(s);
    if (str === "") return "";
    if (/[",\r\n]/.test(str)) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  }
  function csvRow(fields) {
    return fields.map((f) => csvEscape(firestoreValueToCsv(f))).join(",");
  }
  function firestoreValueToCsv(v) {
    if (v === null || v === void 0) return "";
    if (typeof v === "string") return v;
    if (typeof v === "number") {
      if (!isFinite(v)) return "";
      return String(v);
    }
    if (typeof v === "boolean") return v ? "true" : "false";
    if (typeof v === "object" && v !== null && typeof /** @type {any} */
    v.toDate === "function") {
      try {
        return (
          /** @type {any} */
          v.toDate().toISOString()
        );
      } catch (_) {
        return "";
      }
    }
    if (v instanceof Date) {
      if (isNaN(v.getTime())) return "";
      return v.toISOString();
    }
    if (Array.isArray(v)) {
      try {
        return JSON.stringify(v);
      } catch (_) {
        return "";
      }
    }
    if (typeof v === "object") {
      try {
        return JSON.stringify(v);
      } catch (_) {
        return "";
      }
    }
    return String(v);
  }
  function buildCsv(schema, rows) {
    const header = schema.columns.map((c) => csvEscape(c.col)).join(",");
    const body = rows.map((r) => csvRow(r)).join("\r\n");
    return body.length ? header + "\r\n" + body + "\r\n" : header + "\r\n";
  }
  function computeNullRates(schema, rows, requiredCols) {
    const result = {};
    if (!rows.length) {
      for (const c of requiredCols) result[c] = 1;
      return result;
    }
    const colIndex = (
      /** @type {Record<string, number>} */
      {}
    );
    schema.columns.forEach((c, i) => {
      colIndex[c.col] = i;
    });
    for (const rc of requiredCols) {
      const idx = colIndex[rc];
      if (idx === void 0) {
        result[rc] = 1;
        continue;
      }
      let nulls = 0;
      for (const row of rows) {
        const v = row[idx];
        if (firestoreValueToCsv(v) === "") nulls++;
      }
      result[rc] = Math.round(nulls / rows.length * 1e4) / 1e4;
    }
    return result;
  }
  var DATASET_SCHEMAS = {
    pedidos: {
      name: "pedidos.csv",
      source: "firestore",
      collection: "pedidos",
      rowMode: "flatten_lines",
      // 1 fila por (pedido, linea)
      columns: [
        { col: "pedido_id", type: "string", desc: "Firestore doc ID" },
        { col: "owner_uid", type: "string", desc: "UID del vendedor duenio del pedido" },
        { col: "owner_email", type: "string", desc: "email del vendedor" },
        { col: "created_by_uid", type: "string", desc: "quien cargo (VDI puede cargar por VDE)" },
        { col: "on_behalf_of", type: "boolean", desc: "true si VDI cargo por VDE" },
        { col: "key", type: "string", desc: "clave compuesta tipo|prov|loc|cliente" },
        { col: "stage", type: "string", desc: "pending | confirmed | sap_imported" },
        { col: "tipo", type: "string", desc: "C=cliente | P=prospecto" },
        { col: "province", type: "string", desc: "provincia" },
        { col: "loc_name", type: "string", desc: "localidad" },
        { col: "client_name", type: "string", desc: "nombre cliente" },
        { col: "month", type: "string", desc: 'ej "Julio 2026"' },
        { col: "month_idx", type: "int", desc: "0-11" },
        { col: "year", type: "int", desc: "ano" },
        { col: "confirmed_at", type: "iso8601", desc: "timestamp UTC de confirmacion" },
        { col: "condicion_pago", type: "string", desc: "ej CTA CTE" },
        { col: "forma_entrega_tipo", type: "string", desc: "TRANSPORTISTA | SUCURSAL" },
        { col: "forma_entrega_transp_nombre", type: "string", desc: "" },
        { col: "forma_entrega_transp_direccion", type: "string", desc: "" },
        { col: "forma_entrega_cliente_direccion", type: "string", desc: "destino final" },
        { col: "forma_entrega_sucursal_direccion", type: "string", desc: "" },
        { col: "discount_pct", type: "number", desc: "descuento total del pedido (aplicado a nivel header, prorratear en pipeline)" },
        { col: "subtotal_ars", type: "number", desc: "subtotal bruto ARS" },
        { col: "net_amount_ars", type: "number", desc: "neto ARS post-descuento" },
        { col: "transferido_sap_via", type: "string", desc: "dtw_manual | service_layer" },
        { col: "transferido_sap_doc_num", type: "int", desc: "numero de Quotation SAP" },
        { col: "transferido_sap_doc_entry", type: "int", desc: "doc entry interno SAP" },
        { col: "transferido_sap_at", type: "iso8601", desc: "timestamp UTC" },
        { col: "created_at", type: "iso8601", desc: "timestamp UTC" },
        { col: "line_index", type: "int", desc: "indice de linea 0-based" },
        { col: "line_code", type: "string", desc: "SKU" },
        { col: "line_desc", type: "string", desc: "descripcion producto" },
        { col: "line_qty", type: "number", desc: "cantidad" },
        { col: "line_precio", type: "number", desc: "precio unitario ARS" },
        { col: "line_cat", type: "string", desc: "categoria" },
        { col: "line_fam", type: "string", desc: "familia" },
        { col: "line_sub", type: "string", desc: "subfamilia" }
      ]
    },
    visitas: {
      name: "visitas.csv",
      source: "firestore",
      collection: "visits",
      rowMode: "one_per_doc",
      columns: [
        { col: "visit_id", type: "string", desc: "Firestore doc ID" },
        { col: "owner_uid", type: "string", desc: "UID del vendedor" },
        { col: "owner_email", type: "string", desc: "email del vendedor" },
        { col: "fecha", type: "iso8601", desc: "YYYY-MM-DD (fecha de visita, no UTC)" },
        { col: "mes", type: "string", desc: "JUNIO, JULIO, etc." },
        { col: "anio", type: "int", desc: "ano" },
        { col: "vendor", type: "string", desc: "nombre canonico vendedor" },
        { col: "provincia", type: "string", desc: "provincia" },
        { col: "localidad", type: "string", desc: "localidad" },
        { col: "tienda", type: "string", desc: "nombre tienda" },
        { col: "tipo", type: "string", desc: "C | P" },
        { col: "local", type: "string", desc: "ej Propio, Alquilado" },
        { col: "tamano", type: "string", desc: "ej Chico, Mediano, Grande" },
        { col: "fidelidad", type: "string", desc: "Alta, Media, Baja" },
        { col: "relevancia", type: "int", desc: "0-5" },
        { col: "pop", type: "string", desc: "ej Stickers Shimano" },
        { col: "necesidad_puntual", type: "string", desc: "" },
        { col: "tipo_venta", type: "string", desc: "ej Casa de pesca + ecommerce" },
        { col: "ponderacion_mostrado", type: "int", desc: "0-100" },
        { col: "ponderacion_ecommerce", type: "int", desc: "0-100" },
        { col: "competencia", type: "string", desc: "" },
        { col: "oportunidad", type: "string", desc: "" },
        { col: "mas_vendido", type: "string", desc: "" },
        { col: "mas_preguntan", type: "string", desc: "" },
        { col: "ayuda_tienda", type: "string", desc: "" },
        { col: "gps_status", type: "string", desc: "ok | outside | noloc" },
        { col: "gps_distance_m", type: "number", desc: "metros" },
        { col: "interaction_type", type: "string", desc: "visita | contacto" },
        { col: "forma_contacto", type: "string", desc: "LLAMADA TELEFONICA | MENSAJE DE WHATSAPP | MENSAJE SMS (si contacto)" },
        { col: "contacto_resultado", type: "string", desc: "respondio | no_respondio | vacio (sin marcar, solo aplica a contacto)" },
        { col: "contacto_resultado_at", type: "iso8601", desc: "timestamp UTC" },
        { col: "contacto_resultado_by", type: "string", desc: "UID de quien marco" },
        { col: "created_at", type: "iso8601", desc: "timestamp UTC" }
      ]
    },
    clientes: {
      name: "clientes.csv",
      source: "firestore",
      collection: "client_applications",
      rowMode: "one_per_doc",
      columns: [
        { col: "app_id", type: "string", desc: "Firestore doc ID" },
        { col: "owner_uid", type: "string", desc: "" },
        { col: "owner_email", type: "string", desc: "" },
        { col: "owner_name", type: "string", desc: "" },
        { col: "comercio", type: "string", desc: "razon social" },
        { col: "fantasia", type: "string", desc: "nombre comercial" },
        { col: "cuit", type: "string", desc: "solo digitos post-v294" },
        { col: "condicion_fiscal", type: "string", desc: "" },
        { col: "calle", type: "string", desc: "" },
        { col: "numero", type: "string", desc: "" },
        { col: "localidad", type: "string", desc: "" },
        { col: "provincia", type: "string", desc: "" },
        { col: "localidad_final", type: "string", desc: "override del aprobador" },
        { col: "card_code_sap", type: "string", desc: "CardCode SAP" },
        { col: "assigned_vendor", type: "string", desc: "vendedor asignado (source of truth v311+)" },
        { col: "status", type: "string", desc: "pending_approval | approved | rejected" },
        { col: "source", type: "string", desc: "manual | sap_bulk_import | alta_rapida | sap_sync | sap_sync_manual_link" },
        { col: "manual_sap_pending", type: "boolean", desc: "true=provisorio (Alta Rapida sin CardCode)" },
        { col: "precaucion", type: "boolean", desc: "true=cliente marcado por impago" },
        { col: "categoria_cliente", type: "string", desc: "P/A/B/C" },
        { col: "cli_tipo", type: "string", desc: "C default post-v349" },
        { col: "lat", type: "number", desc: "geolat" },
        { col: "lng", type: "number", desc: "geolng" },
        { col: "has_geo", type: "boolean", desc: "lat/lng no null" },
        { col: "has_address", type: "boolean", desc: "calle no vacia" },
        { col: "submitted_by_public_form", type: "boolean", desc: "via alta-cliente.html" },
        { col: "approved_at", type: "iso8601", desc: "" },
        { col: "created_at", type: "iso8601", desc: "" },
        { col: "updated_at", type: "iso8601", desc: "" }
      ]
    },
    client_master: {
      name: "client_master.csv",
      source: "firestore",
      collection: "client_master",
      rowMode: "one_per_doc",
      columns: [
        { col: "master_id", type: "string", desc: "Firestore doc ID" },
        { col: "client_name", type: "string", desc: "" },
        { col: "provincia", type: "string", desc: "" },
        { col: "localidad", type: "string", desc: "" },
        { col: "vendor", type: "string", desc: "vendedor curado admin" },
        { col: "address", type: "string", desc: "direccion curada admin" },
        { col: "sap_card_code", type: "string", desc: "CardCode SAP" },
        { col: "sap_address", type: "string", desc: "direccion raw SAP" },
        { col: "sap_city", type: "string", desc: "" },
        { col: "sap_state", type: "string", desc: "" },
        { col: "sap_imported_at", type: "iso8601", desc: "" },
        { col: "sap_imported_by", type: "string", desc: "" },
        { col: "client_name_original", type: "string", desc: "backup nombre pre-import" },
        { col: "localidad_original", type: "string", desc: "backup localidad pre-import" },
        { col: "match_type", type: "string", desc: "exact | fuzzy" },
        { col: "match_similarity", type: "number", desc: "0-1" },
        { col: "updated_at", type: "iso8601", desc: "" },
        { col: "updated_by", type: "string", desc: "" }
      ]
    },
    rendiciones: {
      name: "rendiciones.csv",
      source: "firestore",
      collection: "rendiciones",
      rowMode: "one_per_doc",
      columns: [
        { col: "rendicion_id", type: "string", desc: "Firestore doc ID" },
        { col: "owner_uid", type: "string", desc: "" },
        { col: "owner_email", type: "string", desc: "" },
        { col: "vendor", type: "string", desc: "" },
        { col: "tipo", type: "string", desc: "gasto | solicitud" },
        { col: "tipo_gasto", type: "string", desc: "ej PEAJES, FACTURA A, GASTO CON COMPROBANTE" },
        { col: "importe_ars", type: "number", desc: "monto ARS" },
        { col: "fecha_gasto", type: "iso8601", desc: "YYYY-MM-DD del gasto" },
        { col: "concepto", type: "string", desc: "descripcion libre" },
        { col: "foto_ticket_url", type: "string", desc: "URL Firebase Storage v308+ (nunca base64)" },
        { col: "status", type: "string", desc: "pending_approval | approved | rejected" },
        { col: "approved_by", type: "string", desc: 'email del aprobador o "self"' },
        { col: "approved_at", type: "iso8601", desc: "" },
        { col: "rejected_by_email", type: "string", desc: "" },
        { col: "rejected_reason", type: "string", desc: "" },
        { col: "approver_uid", type: "string", desc: "UID responsable asignado" },
        { col: "created_at", type: "iso8601", desc: "" }
      ]
    },
    campanias: {
      name: "campanias.csv",
      source: "firestore",
      collection: "campaigns",
      rowMode: "one_per_doc",
      columns: [
        { col: "campaign_id", type: "string", desc: "Firestore doc ID" },
        { col: "name", type: "string", desc: "nombre campana" },
        { col: "familia", type: "string", desc: "ej REELS" },
        { col: "subfamilia", type: "string", desc: "ej MULTIPLICADORES" },
        { col: "filter_type", type: "string", desc: "sku (hoy hardcoded)" },
        { col: "filter_values_json", type: "json_array", desc: "copia de skus" },
        { col: "skus_json", type: "json_array", desc: "ItemCodes incluidos" },
        { col: "skus_count", type: "int", desc: "cantidad SKUs" },
        { col: "target_type", type: "string", desc: "units | money" },
        { col: "target_amount", type: "number", desc: "objetivo" },
        { col: "start_date", type: "iso8601", desc: "YYYY-MM-DD" },
        { col: "end_date", type: "iso8601", desc: "YYYY-MM-DD" },
        { col: "scope", type: "string", desc: "all | province | vendor" },
        { col: "scope_values_json", type: "json_array", desc: "provincias o vendor keys si scope != all" },
        { col: "created_by", type: "string", desc: "UID admin/gerente" },
        { col: "created_by_email", type: "string", desc: "" },
        { col: "created_at", type: "iso8601", desc: "" },
        { col: "archived_manually", type: "boolean", desc: "true=finalizada antes de endDate" },
        { col: "archived_at", type: "iso8601", desc: "" },
        { col: "archived_by", type: "string", desc: "" }
      ]
    },
    targets: {
      name: "targets.csv",
      source: "firestore",
      collection: "targets",
      rowMode: "one_per_doc",
      columns: [
        { col: "target_id", type: "string", desc: "Firestore doc ID canonico {vendor}_{year}_{MM}" },
        { col: "seller_id", type: "string", desc: "vendorKey uppercase ej GONZALO DE LA ROSA" },
        { col: "year", type: "int", desc: "ej 2026" },
        { col: "month", type: "int", desc: "0-11 (indice del array MESES 0-indexed)" },
        { col: "target_ars", type: "number", desc: "objetivo mes ARS (suma familias)" },
        { col: "target_reel_ars", type: "number", desc: "v311+ desglose" },
        { col: "target_canas_ars", type: "number", desc: "v311+ desglose" },
        { col: "target_lineas_ars", type: "number", desc: "v311+ desglose" },
        { col: "updated_at", type: "iso8601", desc: "" },
        { col: "updated_by", type: "string", desc: "UID" },
        { col: "updated_by_email", type: "string", desc: "" }
      ]
    },
    productos: {
      name: "productos.csv",
      source: "stock_json",
      rowMode: "from_stock_json",
      columns: [
        { col: "sku", type: "string", desc: "SKU (ItemCode SAP)" },
        { col: "has_stock", type: "boolean", desc: "true=hay unidades en algun whs vendible" },
        { col: "cantidad_total", type: "int", desc: "suma total whs vendibles (excluye 05 y 06)" },
        { col: "disponible_venta_whs11", type: "int", desc: "v369+ Mercaderia NUR PESCA (venta directa)" },
        { col: "transito_whs12", type: "int", desc: "v369+ En transito PESCA (backorder futuro)" },
        { col: "otros_warehouses_json", type: "json_object", desc: 'otros codigos con cantidad, ej {"98": 5}' },
        { col: "source", type: "string", desc: "stock.json snapshot" },
        { col: "snapshot_updated_at", type: "iso8601", desc: "timestamp del ultimo sync SAP" }
      ]
    },
    vendor_overrides: {
      name: "vendor_overrides.csv",
      source: "firestore",
      collection: "vendor_overrides",
      rowMode: "one_per_doc",
      columns: [
        { col: "override_id", type: "string", desc: "Firestore doc ID" },
        { col: "scope", type: "string", desc: "shop | loc" },
        { col: "province", type: "string", desc: "" },
        { col: "locality_name", type: "string", desc: "" },
        { col: "client_name", type: "string", desc: "solo si scope=shop" },
        { col: "original_vendor", type: "string", desc: "" },
        { col: "new_vendor", type: "string", desc: "" },
        { col: "new_type", type: "string", desc: "VDE | VDI | DISTRIBUIDOR | OTRO" },
        { col: "updated_at", type: "iso8601", desc: "" },
        { col: "updated_by_uid", type: "string", desc: "" },
        { col: "updated_by_email", type: "string", desc: "" },
        { col: "updated_by_display_name", type: "string", desc: "" }
      ]
    },
    custom_routes: {
      name: "custom_routes.csv",
      source: "firestore",
      collection: "custom_routes",
      rowMode: "flatten_stops",
      // 1 fila por (ruta, stop)
      columns: [
        { col: "route_id", type: "string", desc: "Firestore doc ID" },
        { col: "owner_uid", type: "string", desc: "duenio de la ruta" },
        { col: "owner_email", type: "string", desc: "" },
        { col: "name", type: "string", desc: "nombre de la ruta" },
        { col: "planned_date", type: "iso8601", desc: "YYYY-MM-DD" },
        { col: "notes", type: "string", desc: "notas libres" },
        { col: "created_at", type: "iso8601", desc: "" },
        { col: "updated_at", type: "iso8601", desc: "" },
        { col: "stop_order", type: "int", desc: "orden 0-based" },
        { col: "stop_key", type: "string", desc: "clave compuesta tipo|prov|loc|cliente" },
        { col: "stop_tipo", type: "string", desc: "C | P" },
        { col: "stop_provincia", type: "string", desc: "" },
        { col: "stop_localidad", type: "string", desc: "" },
        { col: "stop_client_name", type: "string", desc: "" },
        { col: "stop_is_provisorio", type: "boolean", desc: "true=alta rapida sin CardCode" },
        { col: "stop_sap_alta_id", type: "string", desc: "ID del client_applications si aplica" }
      ]
    },
    seguimiento_notes: {
      name: "seguimiento_notes.csv",
      source: "firestore",
      collection: "seguimiento_notes",
      rowMode: "one_per_doc",
      columns: [
        { col: "note_id", type: "string", desc: "Firestore doc ID" },
        { col: "vendor_ext", type: "string", desc: "VDE al que aplica la nota" },
        { col: "client_key", type: "string", desc: "clave compuesta cliente" },
        { col: "client_name", type: "string", desc: "" },
        { col: "province", type: "string", desc: "" },
        { col: "locality", type: "string", desc: "" },
        { col: "text", type: "string", desc: "texto libre de la nota" },
        { col: "author_uid", type: "string", desc: "" },
        { col: "author_email", type: "string", desc: "" },
        { col: "author_name", type: "string", desc: "" },
        { col: "author_role", type: "string", desc: "admin | gerente | interno" },
        { col: "created_at", type: "iso8601", desc: "" }
      ]
    }
  };
  var DATASET_USE_CASE_MATRIX = {
    A_conversion_visita_pedido: {
      priority: 1,
      description: "Predecir que visitas terminan en pedido para priorizar la ruta del vendedor.",
      requiredFields: {
        "visitas.csv": ["fecha", "owner_uid", "provincia", "localidad", "tienda"],
        "pedidos.csv": ["confirmed_at", "owner_uid", "province", "loc_name", "client_name"]
      },
      joinNotes: "JOIN por (provincia, localidad, tienda~client_name) en ventana temporal fecha_visita..confirmed_at. No hay cardCodeSap comun entre visits y pedidos."
    },
    B_churn_clientes: {
      priority: 2,
      description: "Detectar clientes que se enfrian antes de perderlos.",
      requiredFields: {
        "clientes.csv": ["created_at", "assigned_vendor", "provincia", "status", "card_code_sap"],
        "pedidos.csv": ["confirmed_at", "client_name", "province", "loc_name"]
      },
      joinNotes: "JOIN via client_applications.card_code_sap vs pedidos.key (parseado). Fragil - considerar fuzzy match por nombre."
    },
    C_forecast_sku: {
      priority: 3,
      description: "Anticipar que productos se van a pedir por periodo.",
      requiredFields: {
        "pedidos.csv": ["line_code", "line_qty", "line_precio", "confirmed_at", "province"],
        "productos.csv": ["sku"]
      },
      joinNotes: "Descuento aplicado a nivel header (discount_pct) - prorratear en el pipeline downstream proporcional a subtotal_bruto de cada linea. Enriquecer con catalogo BQ (sap_items_raw) si hace falta cat/fam/sub adicional."
    },
    D_anomalias_rendiciones: {
      priority: "exploratorio",
      description: "Detectar outliers de gastos.",
      requiredFields: {
        "rendiciones.csv": ["importe_ars", "tipo_gasto", "owner_uid", "fecha_gasto", "status"]
      }
    },
    E_estacionalidad_zona_categoria: {
      priority: "exploratorio",
      description: "Insumo para armado de campanias estacionales.",
      requiredFields: {
        "pedidos.csv": ["confirmed_at", "province", "line_code", "line_fam", "line_qty"],
        "clientes.csv": ["provincia", "assigned_vendor"],
        "campanias.csv": ["start_date", "end_date", "skus_json", "scope"],
        "targets.csv": ["year", "month", "target_ars"]
      }
    }
  };
  function buildPedidoRows(doc) {
    const header = [
      doc._id,
      doc.ownerUid,
      doc.ownerEmail,
      doc.createdByUid,
      doc.onBehalfOf,
      doc.key,
      doc.stage,
      doc.tipo,
      doc.province,
      doc.locName,
      doc.clientName,
      doc.month,
      doc.monthIdx,
      doc.year,
      doc.confirmedAt,
      doc.condicionPago,
      doc.formaEntrega ? doc.formaEntrega.tipo : null,
      doc.formaEntrega ? doc.formaEntrega.transpNombre : null,
      doc.formaEntrega ? doc.formaEntrega.transpDireccion : null,
      doc.formaEntrega ? doc.formaEntrega.clienteDireccion : null,
      doc.formaEntrega ? doc.formaEntrega.sucursalDireccion : null,
      doc.discountPct,
      doc.subtotalArs,
      doc.netAmountArs,
      doc.transferidoSAP ? doc.transferidoSAP.via : null,
      doc.transferidoSAP ? doc.transferidoSAP.docNum : null,
      doc.transferidoSAP ? doc.transferidoSAP.docEntry : null,
      doc.transferidoSAP ? doc.transferidoSAP.at : null,
      doc.createdAt
    ];
    const lines = Array.isArray(doc.lines) ? doc.lines : [];
    if (!lines.length) {
      return [header.concat([null, null, null, null, null, null, null, null])];
    }
    return lines.map((l, idx) => header.concat([
      idx,
      l ? l.code : null,
      l ? l.desc : null,
      l ? l.qty : null,
      l ? l.precio : null,
      l ? l.cat : null,
      l ? l.fam : null,
      l ? l.sub : null
    ]));
  }
  function buildVisitaRows(doc) {
    return [[
      doc._id,
      doc.ownerUid,
      doc.ownerEmail,
      doc.fecha,
      doc.mes,
      doc.anio,
      doc.vendor,
      doc.provincia,
      doc.localidad,
      doc.tienda,
      doc.tipo,
      doc.local,
      doc.tamano,
      doc.fidelidad,
      doc.relevancia,
      doc.pop,
      doc.necesidadPuntual,
      doc.tipoVenta,
      doc.ponderacionMostrado,
      doc.ponderacionEcommerce,
      doc.competencia,
      doc.oportunidad,
      doc.masVendido,
      doc.masPreguntan,
      doc.ayudaTienda,
      doc.gpsStatus,
      doc.gpsDistanceM,
      doc.interactionType,
      doc.formaContacto,
      doc.contactoResultado,
      doc.contactoResultadoAt,
      doc.contactoResultadoBy,
      doc.createdAt
    ]];
  }
  function buildClienteRows(doc) {
    return [[
      doc._id,
      doc.ownerUid,
      doc.ownerEmail,
      doc.ownerName,
      doc.comercio,
      doc.fantasia,
      doc.cuit,
      doc.condicionFiscal,
      doc.calle,
      doc.numero,
      doc.localidad,
      doc.provincia,
      doc.localidadFinal,
      doc.cardCodeSap,
      doc.assignedVendor,
      doc.status,
      doc.source,
      doc.manualSapPending,
      doc.precaucion,
      doc.categoriaCliente,
      doc.cliTipo,
      doc.lat,
      doc.lng,
      doc.lat != null && doc.lng != null,
      !!(doc.calle || doc.address),
      doc.submittedByPublicForm,
      doc.approvedAt,
      doc.createdAt,
      doc.updatedAt
    ]];
  }
  function buildClientMasterRows(doc) {
    return [[
      doc._id,
      doc.clientName,
      doc.provincia,
      doc.localidad,
      doc.vendor,
      doc.address,
      doc.sapCardCode,
      doc.sapAddress,
      doc.sapCity,
      doc.sapState,
      doc.sapImportedAt,
      doc.sapImportedBy,
      doc.clientNameOriginal,
      doc.localidadOriginal,
      doc.matchType,
      doc.matchSimilarity,
      doc.updatedAt,
      doc.updatedBy
    ]];
  }
  function buildRendicionRows(doc) {
    return [[
      doc._id,
      doc.ownerUid,
      doc.ownerEmail,
      doc.vendor,
      doc.tipo,
      doc.tipoGasto,
      doc.importeArs != null ? doc.importeArs : doc.importe,
      doc.fechaGasto,
      doc.concepto,
      // fotoTicketUrl (v308+) prioridad; NUNCA exportar base64 fotoTicket legacy
      doc.fotoTicketUrl || null,
      doc.status,
      doc.approvedBy,
      doc.approvedAt,
      doc.rejectedByEmail,
      doc.rejectedReason,
      doc.approverUid,
      doc.createdAt
    ]];
  }
  function buildCampaniaRows(doc) {
    return [[
      doc._id,
      doc.name,
      doc.familia,
      doc.subfamilia,
      doc.filterType,
      doc.filterValues,
      doc.skus,
      Array.isArray(doc.skus) ? doc.skus.length : 0,
      doc.targetType,
      doc.targetAmount,
      doc.startDate,
      doc.endDate,
      doc.scope,
      doc.scopeValues,
      doc.createdBy,
      doc.createdByEmail,
      doc.createdAt,
      doc.archivedManually,
      doc.archivedAt,
      doc.archivedBy
    ]];
  }
  function buildTargetRows(doc) {
    return [[
      doc._id,
      doc.sellerId,
      doc.year,
      doc.month,
      doc.targetArs,
      doc.targetByFamily ? doc.targetByFamily.REEL : null,
      doc.targetByFamily ? doc.targetByFamily.CANAS : null,
      doc.targetByFamily ? doc.targetByFamily.LINEAS : null,
      doc.updatedAt,
      doc.updatedBy,
      doc.updatedByEmail
    ]];
  }
  function buildVendorOverrideRows(doc) {
    return [[
      doc._id,
      doc.scope,
      doc.province,
      doc.localityName,
      doc.clientName,
      doc.originalVendor,
      doc.newVendor,
      doc.newType,
      doc.updatedAt,
      doc.updatedByUid,
      doc.updatedByEmail,
      doc.updatedByDisplayName
    ]];
  }
  function buildCustomRouteRows(doc) {
    const header = [
      doc._id,
      doc.ownerUid,
      doc.ownerEmail,
      doc.name,
      doc.plannedDate,
      doc.notes,
      doc.createdAt,
      doc.updatedAt
    ];
    const stops = Array.isArray(doc.stops) ? doc.stops : [];
    if (!stops.length) {
      return [header.concat([null, null, null, null, null, null, null, null])];
    }
    return stops.map((s) => header.concat([
      s ? s.order : null,
      s ? s.key : null,
      s ? s.tipo : null,
      s ? s.provincia : null,
      s ? s.localidad : null,
      s ? s.clientName : null,
      s ? s.isProvisorio : null,
      s ? s.sapAltaId : null
    ]));
  }
  function buildSeguimientoNoteRows(doc) {
    return [[
      doc._id,
      doc.vendorExt,
      doc.clientKey,
      doc.clientName,
      doc.province,
      doc.locality,
      doc.text,
      doc.authorUid,
      doc.authorEmail,
      doc.authorName,
      doc.authorRole,
      doc.createdAt
    ]];
  }
  function buildProductoRowsFromStockJson(stockJson) {
    const sj = (
      /** @type {any} */
      stockJson || {}
    );
    const stockMap = sj.stock || {};
    let quantities = {};
    let breakdown = {};
    try {
      quantities = sj.quantities ? JSON.parse(sj.quantities) : sj.quantities_map || {};
    } catch (_) {
    }
    try {
      breakdown = sj.warehouseBreakdown ? JSON.parse(sj.warehouseBreakdown) : sj.warehouseBreakdown_map || {};
    } catch (_) {
    }
    const rows = (
      /** @type {unknown[][]} */
      []
    );
    const source = "stock.json snapshot";
    const updatedAt = sj.updatedAt || sj.snapshotAt || null;
    for (const sku of Object.keys(stockMap)) {
      const has_stock = !!stockMap[sku];
      const total = Number(quantities[sku] || 0);
      const wbs = breakdown[sku] || {};
      const w11 = Number(wbs["11"] || 0);
      const w12 = Number(wbs["12"] || 0);
      const otros = {};
      for (const k of Object.keys(wbs)) {
        if (k !== "11" && k !== "12") otros[k] = Number(wbs[k] || 0);
      }
      rows.push([
        sku,
        has_stock,
        total,
        w11,
        w12,
        Object.keys(otros).length ? otros : null,
        source,
        updatedAt
      ]);
    }
    return rows;
  }
  var ROW_BUILDERS = {
    pedidos: buildPedidoRows,
    visitas: buildVisitaRows,
    clientes: buildClienteRows,
    client_master: buildClientMasterRows,
    rendiciones: buildRendicionRows,
    campanias: buildCampaniaRows,
    targets: buildTargetRows,
    vendor_overrides: buildVendorOverrideRows,
    custom_routes: buildCustomRouteRows,
    seguimiento_notes: buildSeguimientoNoteRows
  };

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
  window.openExportFormatModal = function() {
    const dsOpt = document.getElementById("exp-opt-dataset-zip");
    if (dsOpt) {
      const isAdminOrGerente = userRole === "admin" || userRole === "gerente";
      dsOpt.style.display = isAdminOrGerente ? "" : "none";
    }
    const prog = document.getElementById("export-dataset-progress");
    if (prog) prog.style.display = "none";
    document.getElementById("export-format-modal").classList.add("open");
  };
  window.closeExportFormatModal = function() {
    document.getElementById("export-format-modal").classList.remove("open");
  };
  function _updateExportProgress(status, percent) {
    const s = document.getElementById("export-dataset-status");
    const b = document.getElementById("export-dataset-bar");
    const wrap = document.getElementById("export-dataset-progress");
    if (wrap) wrap.style.display = "";
    if (s) s.textContent = status;
    if (b) b.style.width = Math.max(0, Math.min(100, percent)) + "%";
  }
  async function _fetchStockJson() {
    try {
      const r = await fetch("./stock.json?t=" + Date.now(), { cache: "no-store" });
      if (!r.ok) throw new Error("HTTP " + r.status);
      return await r.json();
    } catch (e) {
      console.warn("[exportDatasetZip] stock.json fallo:", e && e.message);
      return null;
    }
  }
  async function _ensureJSZipLoaded() {
    if (typeof JSZip !== "undefined") return;
    await new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";
      s.onload = resolve;
      s.onerror = () => reject(new Error("No se pudo cargar JSZip"));
      document.head.appendChild(s);
    });
  }
  function _downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
  }
  window.exportDatasetZip = async function() {
    if (userRole !== "admin" && userRole !== "gerente") {
      alert("Solo admin o gerente pueden exportar el dataset.");
      return;
    }
    if (!fbDb) {
      alert("Firestore no inicializado. Recarga la app.");
      return;
    }
    document.getElementById("export-format-modal").classList.add("open");
    _updateExportProgress("Preparando...", 5);
    try {
      _updateExportProgress("Cargando JSZip...", 10);
      await _ensureJSZipLoaded();
      _updateExportProgress("Leyendo Firestore (10 colecciones)...", 20);
      const firestoreEntries = [
        ["pedidos", fbDb.collection("pedidos").get()],
        ["visitas", fbDb.collection("visits").get()],
        ["clientes", fbDb.collection("client_applications").get()],
        ["client_master", fbDb.collection("client_master").get()],
        ["rendiciones", fbDb.collection("rendiciones").get()],
        ["campanias", fbDb.collection("campaigns").get()],
        ["targets", fbDb.collection("targets").get()],
        ["vendor_overrides", fbDb.collection("vendor_overrides").get()],
        ["custom_routes", fbDb.collection("custom_routes").get()],
        ["seguimiento_notes", fbDb.collection("seguimiento_notes").get()]
      ];
      const promises = firestoreEntries.map(([, p]) => p);
      promises.push(_fetchStockJson());
      const settled = await Promise.allSettled(promises);
      const failedFirestore = [];
      settled.slice(0, firestoreEntries.length).forEach((r, i) => {
        if (r.status === "rejected") failedFirestore.push(firestoreEntries[i][0] + ": " + (r.reason && r.reason.message || r.reason));
      });
      if (failedFirestore.length) {
        throw new Error("Firestore fetch fallo en " + failedFirestore.length + " colecciones:\n" + failedFirestore.join("\n"));
      }
      const snapshots = (
        /** @type {Record<string, any[]>} */
        {}
      );
      firestoreEntries.forEach(([name], i) => {
        const snap = (
          /** @type {any} */
          settled[i].value
        );
        const docs = [];
        snap.forEach((d) => {
          const data = d.data() || {};
          data._id = d.id;
          docs.push(data);
        });
        snapshots[name] = docs;
      });
      const stockJson = (
        /** @type {any} */
        settled[settled.length - 1].value
      );
      _updateExportProgress("Serializando CSVs...", 55);
      const csvs = (
        /** @type {Record<string, string>} */
        {}
      );
      const rowCounts = (
        /** @type {Record<string, number>} */
        {}
      );
      const allRowsByCsv = (
        /** @type {Record<string, any[][]>} */
        {}
      );
      for (const collName of Object.keys(snapshots)) {
        const schema = DATASET_SCHEMAS[collName];
        if (!schema) continue;
        const builder = ROW_BUILDERS[collName];
        if (!builder) continue;
        const allRows = (
          /** @type {any[][]} */
          []
        );
        for (const doc of snapshots[collName]) {
          const rowsForDoc = builder(doc);
          for (const r of rowsForDoc) allRows.push(r);
        }
        allRowsByCsv[schema.name] = allRows;
        csvs[schema.name] = buildCsv(schema, allRows);
        rowCounts[schema.name] = allRows.length;
      }
      const productosSchema = DATASET_SCHEMAS.productos;
      const productosRows = stockJson ? buildProductoRowsFromStockJson(stockJson) : [];
      allRowsByCsv[productosSchema.name] = productosRows;
      csvs[productosSchema.name] = buildCsv(productosSchema, productosRows);
      rowCounts[productosSchema.name] = productosRows.length;
      _updateExportProgress("Calculando calidad del dataset...", 75);
      const useCaseWithStats = {};
      for (const [caseKey, uc] of Object.entries(DATASET_USE_CASE_MATRIX)) {
        const stats = (
          /** @type {any} */
          { priority: uc.priority, description: uc.description, requiredFields: uc.requiredFields, joinNotes: uc.joinNotes, nullRateByField: {}, limitations: [] }
        );
        let hasHighNullRate = false;
        let hasEmptyRequired = false;
        for (const [csvName, fields] of Object.entries(uc.requiredFields)) {
          const schemaForCsv = Object.values(DATASET_SCHEMAS).find((s) => s.name === csvName);
          if (!schemaForCsv) {
            stats.limitations.push("Schema no encontrado para " + csvName);
            continue;
          }
          const rows = allRowsByCsv[csvName] || [];
          const rates = computeNullRates(schemaForCsv, rows, fields);
          for (const [f, rate] of Object.entries(rates)) {
            stats.nullRateByField[csvName + "." + f] = rate;
            if (rows.length === 0) hasEmptyRequired = true;
            else if (rate > 0.5) hasHighNullRate = true;
          }
        }
        if (hasEmptyRequired) {
          stats.status = "EMPTY";
          stats.limitations.push("Alguna coleccion requerida esta vacia \u2014 el caso no se puede entrenar hoy pero el schema esta listo.");
        } else if (hasHighNullRate) {
          stats.status = "PARTIAL";
          stats.limitations.push("Al menos 1 campo requerido tiene >50% de nulls \u2014 revisar tasas antes de usar.");
        } else {
          stats.status = "OK";
        }
        useCaseWithStats[caseKey] = stats;
      }
      const exportedAt = (/* @__PURE__ */ new Date()).toISOString();
      const manifest = {
        exportedAt,
        appVersion: typeof APP_VERSION !== "undefined" ? APP_VERSION : "unknown",
        sourceProject: "app-vendedores-shimano",
        exportedByEmail: currentUser && currentUser.email || "unknown",
        exportedByUid: currentUser && currentUser.uid || "unknown",
        csvConventions: {
          encoding: "UTF-8",
          separator: ",",
          quoteChar: '"',
          escapeQuote: '""',
          lineTerminator: "\\r\\n",
          dateFormat: "ISO 8601 UTC (with Z)",
          decimalSeparator: ".",
          nullRepresentation: "(empty field)",
          arrayFormat: "JSON stringified",
          objectFormat: "JSON stringified"
        },
        rowCounts,
        schema: {},
        useCaseMatrix: useCaseWithStats,
        exclusions: {
          note: "Datos sensibles y binarios excluidos del export.",
          excludedCollections: ["roles", "app_config", "sap_snapshot", "notifications", "operations_log"],
          excludedFields: [
            "visits.frenteLocal (fotos base64)",
            "visits.espacio[] (fotos base64)",
            "client_applications.constanciaArca (base64)",
            "client_applications.constanciaIIBB (base64)",
            "client_applications.fotosLocal[] (base64)",
            "rendiciones.fotoTicket (base64 legacy pre-v308; se exporta solo fotoTicketUrl)"
          ],
          stockJsonLoaded: stockJson !== null
        }
      };
      for (const [collName, schema] of Object.entries(DATASET_SCHEMAS)) {
        manifest.schema[schema.name] = schema.columns.map((c) => ({ col: c.col, type: c.type, desc: c.desc }));
      }
      _updateExportProgress("Empaquetando ZIP...", 90);
      const zip = new JSZip();
      for (const [name, content] of Object.entries(csvs)) {
        zip.file(name, content);
      }
      zip.file("manifest.json", JSON.stringify(manifest, null, 2));
      const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
      const filename = "shimano-dataset-" + exportedAt.replace(/[:.]/g, "-") + ".zip";
      _downloadBlob(blob, filename);
      _updateExportProgress("Dataset descargado: " + filename + " (" + Object.keys(csvs).length + " CSVs + manifest.json)", 100);
      if (typeof showSyncTag === "function") {
        const totalRows = Object.values(rowCounts).reduce((a, b) => a + b, 0);
        showSyncTag("Dataset exportado: " + totalRows + " filas en " + Object.keys(csvs).length + " CSVs");
      }
      setTimeout(() => window.closeExportFormatModal(), 3e3);
    } catch (e) {
      console.error("[exportDatasetZip] fatal:", e);
      _updateExportProgress("Error: " + (e && e.message || e), 0);
      alert("Error al exportar el dataset:\n\n" + (e && e.message || e) + "\n\nEl ZIP NO se descargo (evitamos generar un archivo parcial). Revisa la consola para mas detalles.");
    }
  };
  if (typeof window.todayStr === "undefined") window.todayStr = todayStr;
  if (typeof window.dataUrlToBlob === "undefined") window.dataUrlToBlob = dataUrlToBlob;
  if (typeof window.sanitizeForPath === "undefined") window.sanitizeForPath = sanitizeForPath;
  window.loadExcelJS = loadExcelJS;
})();
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL3B1cmUvY3N2LXNlcmlhbGl6ZXIuanMiLCAiLi4vc3JjL2RvbWFpbnMvZXhwb3J0cy1hZHZhbmNlZC5qcyJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiLy8gQHRzLWNoZWNrXG4vKipcbiAqIENTViBzZXJpYWxpemVyICsgZGF0YXNldCBzY2hlbWFzICsgcm93IGJ1aWxkZXJzIFx1MjAxNCBwYXJhIGV4cG9ydERhdGFzZXRaaXBcbiAqICh2MzcxKykuIEZ1bmNpb25lcyBwdXJhcywgdGVzdGVhYmxlcyBzaW4gZ2xvYmFscyBkZWwgYnVuZGxlLlxuICpcbiAqIDUgY2Fzb3MgZGUgdXNvIE1MIGRvY3VtZW50YWRvcyBlbiBEQVRBU0VUX1VTRV9DQVNFX01BVFJJWDpcbiAqICAgQSkgQ29udmVyc2lvbiB2aXNpdGEtPnBlZGlkbyAocHJpb3JpZGFkIDEsIGNsYXNpZmljYWNpb24pXG4gKiAgIEIpIFJpZXNnbyBkZSBjaHVybiBkZSBjbGllbnRlcyAocHJpb3JpZGFkIDIsIGFsZXJ0YSlcbiAqICAgQykgRm9yZWNhc3QgZGUgZGVtYW5kYSBwb3IgU0tVIChwcmlvcmlkYWQgMywgc2VyaWVzIHRlbXBvcmFsZXMpXG4gKiAgIEQpIEFub21hbGlhcyBlbiByZW5kaWNpb25lcyAoZXhwbG9yYXRvcmlvKVxuICogICBFKSBFc3RhY2lvbmFsaWRhZCBwb3Igem9uYS9jYW1wYW5hIChleHBsb3JhdG9yaW8pXG4gKlxuICogQ29udmVuY2lvbmVzIChSRkMgNDE4MCArIGFkYXB0YWNpb25lcyBwYXJhIE1MIHBpcGVsaW5lcyk6XG4gKiAgIC0gU2VwYXJhdG9yOiBcIixcIlxuICogICAtIFF1b3RlIGNoYXI6IFwiXFxcIlwiXG4gKiAgIC0gRXNjYXBlIHF1b3RlOiBcIlxcXCJcXFwiXCJcbiAqICAgLSBMaW5lIHRlcm1pbmF0b3I6IFwiXFxyXFxuXCJcbiAqICAgLSBFbmNvZGluZzogVVRGLTggKEJPTSBvcGNpb25hbCBhbCBlc2NyaWJpciBlbCBaSVApXG4gKiAgIC0gRmVjaGFzOiBJU08gODYwMSBVVEMgKGNvbiBcIlpcIiBhbCBmaW5hbClcbiAqICAgLSBEZWNpbWFsZXM6IHB1bnRvIChcIi5cIilcbiAqICAgLSBOdWxsL3VuZGVmaW5lZDogY2FtcG8gdmFjaW8gKE5PIFwiTi9BXCIsIFwiLVwiLCBcIm51bGxcIilcbiAqICAgLSBBcnJheXMgLT4gSlNPTi5zdHJpbmdpZnkgZW50cmUgY29taWxsYXMgZG9ibGVzXG4gKiAgIC0gT2JqZXRvcyAoZXhjZXB0byBUaW1lc3RhbXAgeSBEYXRlKSAtPiBKU09OLnN0cmluZ2lmeVxuICogICAtIEZpcmVzdG9yZSBUaW1lc3RhbXBzIC0+IHRvRGF0ZSgpLnRvSVNPU3RyaW5nKClcbiAqL1xuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIEhlbHBlcnMgQ1NWIHB1cm9zXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuLyoqXG4gKiBFc2NhcGEgdW4gdmFsb3Igc3RyaW5nIHBhcmEgQ1NWIFJGQyA0MTgwLiBXcmFwcGVhIGNvbiBcIi4uLlwiIHNpIGNvbnRpZW5lXG4gKiBcIixcIiwgXCJcXFwiXCIsIFwiXFxyXCIgbyBcIlxcblwiLiBFc2NhcGEgXCJcXFwiXCIgLT4gXCJcXFwiXFxcIlwiLlxuICogQHBhcmFtIHtzdHJpbmd9IHNcbiAqIEByZXR1cm5zIHtzdHJpbmd9XG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjc3ZFc2NhcGUocykge1xuICBpZiAocyA9PT0gbnVsbCB8fCBzID09PSB1bmRlZmluZWQpIHJldHVybiAnJztcbiAgY29uc3Qgc3RyID0gU3RyaW5nKHMpO1xuICBpZiAoc3RyID09PSAnJykgcmV0dXJuICcnO1xuICAvLyBOZWNlc2l0YSBxdW90aW5nIHNpIHRpZW5lIGNvbWEsIHF1b3RlLCBvIGxpbmUtYnJlYWtcbiAgaWYgKC9bXCIsXFxyXFxuXS8udGVzdChzdHIpKSB7XG4gICAgcmV0dXJuICdcIicgKyBzdHIucmVwbGFjZSgvXCIvZywgJ1wiXCInKSArICdcIic7XG4gIH1cbiAgcmV0dXJuIHN0cjtcbn1cblxuLyoqXG4gKiBDb252aWVydGUgdW4gYXJyYXkgZGUgdmFsb3JlcyBlbiB1bmEgbGluZWEgQ1NWIChzaW4gdHJhaWxpbmcgbmV3bGluZSkuXG4gKiBBcGxpY2EgY3N2RXNjYXBlIGEgY2FkYSBjYW1wbyBkZXNwdWVzIGRlIGZpcmVzdG9yZVZhbHVlVG9Dc3YuXG4gKiBAcGFyYW0ge3Vua25vd25bXX0gZmllbGRzXG4gKiBAcmV0dXJucyB7c3RyaW5nfVxuICovXG5leHBvcnQgZnVuY3Rpb24gY3N2Um93KGZpZWxkcykge1xuICByZXR1cm4gZmllbGRzLm1hcCgoZikgPT4gY3N2RXNjYXBlKGZpcmVzdG9yZVZhbHVlVG9Dc3YoZikpKS5qb2luKCcsJyk7XG59XG5cbi8qKlxuICogQ29udmllcnRlIHVuIHZhbG9yIGRlIEZpcmVzdG9yZS9KUyBhIHN0cmluZyBhcHRvIHBhcmEgQ1NWLlxuICogUmVnbGEgcG9yIHRpcG86XG4gKiAgIC0gbnVsbCAvIHVuZGVmaW5lZCAtPiAnJ1xuICogICAtIEZpcmVzdG9yZSBUaW1lc3RhbXAgKHRpZW5lIC50b0RhdGUpIC0+IElTTyA4NjAxIFVUQ1xuICogICAtIERhdGUgLT4gSVNPIDg2MDEgVVRDXG4gKiAgIC0gYm9vbGVhbiAtPiAndHJ1ZScgLyAnZmFsc2UnXG4gKiAgIC0gbnVtYmVyIC0+IFN0cmluZyhuKSBjb24gcHVudG8gZGVjaW1hbFxuICogICAtIHN0cmluZyAtPiB0YWwgY3VhbCAoY3N2RXNjYXBlIHdyYXBwZWEgc2kgaGFjZSBmYWx0YSlcbiAqICAgLSBBcnJheSAtPiBKU09OLnN0cmluZ2lmeVxuICogICAtIE9iamVjdCAtPiBKU09OLnN0cmluZ2lmeVxuICogQHBhcmFtIHt1bmtub3dufSB2XG4gKiBAcmV0dXJucyB7c3RyaW5nfVxuICovXG5leHBvcnQgZnVuY3Rpb24gZmlyZXN0b3JlVmFsdWVUb0Nzdih2KSB7XG4gIGlmICh2ID09PSBudWxsIHx8IHYgPT09IHVuZGVmaW5lZCkgcmV0dXJuICcnO1xuICBpZiAodHlwZW9mIHYgPT09ICdzdHJpbmcnKSByZXR1cm4gdjtcbiAgaWYgKHR5cGVvZiB2ID09PSAnbnVtYmVyJykge1xuICAgIGlmICghaXNGaW5pdGUodikpIHJldHVybiAnJzsgLy8gTmFOLCBJbmZpbml0eSAtPiB2YWNpbyAobm8gY29uZnVuZGlyIHBpcGVsaW5lcylcbiAgICByZXR1cm4gU3RyaW5nKHYpO1xuICB9XG4gIGlmICh0eXBlb2YgdiA9PT0gJ2Jvb2xlYW4nKSByZXR1cm4gdiA/ICd0cnVlJyA6ICdmYWxzZSc7XG4gIC8vIEZpcmVzdG9yZSBUaW1lc3RhbXBcbiAgaWYgKHR5cGVvZiB2ID09PSAnb2JqZWN0JyAmJiB2ICE9PSBudWxsICYmIHR5cGVvZiAoLyoqIEB0eXBlIHthbnl9ICovKHYpKS50b0RhdGUgPT09ICdmdW5jdGlvbicpIHtcbiAgICB0cnkge1xuICAgICAgcmV0dXJuICgvKiogQHR5cGUge2FueX0gKi8odikpLnRvRGF0ZSgpLnRvSVNPU3RyaW5nKCk7XG4gICAgfSBjYXRjaCAoXykge1xuICAgICAgcmV0dXJuICcnO1xuICAgIH1cbiAgfVxuICBpZiAodiBpbnN0YW5jZW9mIERhdGUpIHtcbiAgICBpZiAoaXNOYU4odi5nZXRUaW1lKCkpKSByZXR1cm4gJyc7XG4gICAgcmV0dXJuIHYudG9JU09TdHJpbmcoKTtcbiAgfVxuICBpZiAoQXJyYXkuaXNBcnJheSh2KSkge1xuICAgIC8vIEpTT04uc3RyaW5naWZ5IGRlIGFycmF5LiBjc3ZFc2NhcGUgbHVlZ28gbG8gd3JhcHBlYSBzaSBoYXkgY29tYXMuXG4gICAgdHJ5IHsgcmV0dXJuIEpTT04uc3RyaW5naWZ5KHYpOyB9IGNhdGNoIChfKSB7IHJldHVybiAnJzsgfVxuICB9XG4gIGlmICh0eXBlb2YgdiA9PT0gJ29iamVjdCcpIHtcbiAgICB0cnkgeyByZXR1cm4gSlNPTi5zdHJpbmdpZnkodik7IH0gY2F0Y2ggKF8pIHsgcmV0dXJuICcnOyB9XG4gIH1cbiAgcmV0dXJuIFN0cmluZyh2KTtcbn1cblxuLyoqXG4gKiBPYnRpZW5lIGVsIHZhbG9yIGRlIHVuIHBhdGggZG90LW5vdGF0aW9uIGVuIHVuIG9iamV0byBhbmlkYWRvLlxuICogRWo6IGdldFBhdGgoe2E6IHtiOiB7YzogMX19fSwgJ2EuYi5jJykgLT4gMVxuICogZ2V0UGF0aCh7fSwgJ2EuYicpIC0+IHVuZGVmaW5lZFxuICogQHBhcmFtIHtvYmplY3R9IG9ialxuICogQHBhcmFtIHtzdHJpbmd9IHBhdGhcbiAqIEByZXR1cm5zIHt1bmtub3dufVxuICovXG5leHBvcnQgZnVuY3Rpb24gZ2V0UGF0aChvYmosIHBhdGgpIHtcbiAgaWYgKCFvYmogfHwgIXBhdGgpIHJldHVybiB1bmRlZmluZWQ7XG4gIGNvbnN0IHBhcnRzID0gcGF0aC5zcGxpdCgnLicpO1xuICBsZXQgY3VyID0gLyoqIEB0eXBlIHthbnl9ICovKG9iaik7XG4gIGZvciAoY29uc3QgcCBvZiBwYXJ0cykge1xuICAgIGlmIChjdXIgPT09IG51bGwgfHwgY3VyID09PSB1bmRlZmluZWQpIHJldHVybiB1bmRlZmluZWQ7XG4gICAgY3VyID0gY3VyW3BdO1xuICB9XG4gIHJldHVybiBjdXI7XG59XG5cbi8qKlxuICogQ29uc3RydXllIGVsIENTViBjb21wbGV0byAoaGVhZGVyICsgTiByb3dzKSBwYXJhIHVuYSBjb2xlY2Npb24gc2VndW5cbiAqIHN1IHNjaGVtYS4gQ2FkYSBidWlsZGVyIGRldnVlbHZlIHVuIGFycmF5IGRlIGZpbGFzIChjYWRhIGZpbGEgPSBhcnJheVxuICogZGUgdmFsb3JlcyBlbiBlbCBvcmRlbiBkZWwgc2NoZW1hKS5cbiAqIEBwYXJhbSB7e2NvbHVtbnM6IHtjb2w6IHN0cmluZ31bXX19IHNjaGVtYVxuICogQHBhcmFtIHt1bmtub3duW11bXX0gcm93c1xuICogQHJldHVybnMge3N0cmluZ30gQ1NWIGNvbXBsZXRvIGNvbiBcXHJcXG4gY29tbyBsaW5lIHNlcGFyYXRvclxuICovXG5leHBvcnQgZnVuY3Rpb24gYnVpbGRDc3Yoc2NoZW1hLCByb3dzKSB7XG4gIGNvbnN0IGhlYWRlciA9IHNjaGVtYS5jb2x1bW5zLm1hcCgoYykgPT4gY3N2RXNjYXBlKGMuY29sKSkuam9pbignLCcpO1xuICBjb25zdCBib2R5ID0gcm93cy5tYXAoKHIpID0+IGNzdlJvdyhyKSkuam9pbignXFxyXFxuJyk7XG4gIHJldHVybiBib2R5Lmxlbmd0aCA/IGhlYWRlciArICdcXHJcXG4nICsgYm9keSArICdcXHJcXG4nIDogaGVhZGVyICsgJ1xcclxcbic7XG59XG5cbi8qKlxuICogQ3VlbnRhIG51bGwgcmF0ZSBwb3IgY29sdW1uYSByZXF1ZXJpZGEuIFJldG9ybmFcbiAqIHtjb2xOYW1lOiByYXRlIDAuLjF9LiBVbiB2YWxvciBlcyBcIm51bGxcIiBzaSBmaXJlc3RvcmVWYWx1ZVRvQ3N2IGRldnVlbHZlICcnLlxuICogQHBhcmFtIHt7Y29sdW1uczoge2NvbDogc3RyaW5nfVtdfX0gc2NoZW1hXG4gKiBAcGFyYW0ge3Vua25vd25bXVtdfSByb3dzXG4gKiBAcGFyYW0ge3N0cmluZ1tdfSByZXF1aXJlZENvbHNcbiAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBudW1iZXI+fVxuICovXG5leHBvcnQgZnVuY3Rpb24gY29tcHV0ZU51bGxSYXRlcyhzY2hlbWEsIHJvd3MsIHJlcXVpcmVkQ29scykge1xuICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIG51bWJlcj59ICovXG4gIGNvbnN0IHJlc3VsdCA9IHt9O1xuICBpZiAoIXJvd3MubGVuZ3RoKSB7XG4gICAgLy8gc2luIGRhdG9zOiBudWxsIHJhdGUgPSAxICgxMDAlIGZhbHRhKSBwYXJhIGNhZGEgY2FtcG8gcmVxdWVyaWRvXG4gICAgZm9yIChjb25zdCBjIG9mIHJlcXVpcmVkQ29scykgcmVzdWx0W2NdID0gMTtcbiAgICByZXR1cm4gcmVzdWx0O1xuICB9XG4gIGNvbnN0IGNvbEluZGV4ID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBudW1iZXI+fSAqLyh7fSk7XG4gIHNjaGVtYS5jb2x1bW5zLmZvckVhY2goKGMsIGkpID0+IHsgY29sSW5kZXhbYy5jb2xdID0gaTsgfSk7XG4gIGZvciAoY29uc3QgcmMgb2YgcmVxdWlyZWRDb2xzKSB7XG4gICAgY29uc3QgaWR4ID0gY29sSW5kZXhbcmNdO1xuICAgIGlmIChpZHggPT09IHVuZGVmaW5lZCkge1xuICAgICAgcmVzdWx0W3JjXSA9IDE7IC8vIGNvbHVtbmEgbm8gZXhpc3RlIGVuIHNjaGVtYSAtPiBjb25zaWRlcmFyIGNvbW8gMTAwJSBudWxsXG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgbGV0IG51bGxzID0gMDtcbiAgICBmb3IgKGNvbnN0IHJvdyBvZiByb3dzKSB7XG4gICAgICBjb25zdCB2ID0gcm93W2lkeF07XG4gICAgICBpZiAoZmlyZXN0b3JlVmFsdWVUb0Nzdih2KSA9PT0gJycpIG51bGxzKys7XG4gICAgfVxuICAgIHJlc3VsdFtyY10gPSBNYXRoLnJvdW5kKChudWxscyAvIHJvd3MubGVuZ3RoKSAqIDEwMDAwKSAvIDEwMDAwO1xuICB9XG4gIHJldHVybiByZXN1bHQ7XG59XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gREFUQVNFVF9TQ0hFTUFTIFx1MjAxNCAxMSBjb2xlY2Npb25lcyBjb24gY29sdW1uYXMgKyB0aXBvcyArIGRlc2NyaXBjaW9uZXNcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4vKiogQHR5cGVkZWYge3tjb2w6IHN0cmluZywgdHlwZTogc3RyaW5nLCBkZXNjOiBzdHJpbmd9fSBTY2hlbWFDb2x1bW4gKi9cbi8qKiBAdHlwZWRlZiB7e25hbWU6IHN0cmluZywgc291cmNlOiAnZmlyZXN0b3JlJ3wnc3RvY2tfanNvbicsIGNvbGxlY3Rpb24/OiBzdHJpbmcsIHJvd01vZGU6IHN0cmluZywgY29sdW1uczogU2NoZW1hQ29sdW1uW119fSBEYXRhc2V0U2NoZW1hICovXG5cbi8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgRGF0YXNldFNjaGVtYT59ICovXG5leHBvcnQgY29uc3QgREFUQVNFVF9TQ0hFTUFTID0ge1xuICBwZWRpZG9zOiB7XG4gICAgbmFtZTogJ3BlZGlkb3MuY3N2JyxcbiAgICBzb3VyY2U6ICdmaXJlc3RvcmUnLFxuICAgIGNvbGxlY3Rpb246ICdwZWRpZG9zJyxcbiAgICByb3dNb2RlOiAnZmxhdHRlbl9saW5lcycsIC8vIDEgZmlsYSBwb3IgKHBlZGlkbywgbGluZWEpXG4gICAgY29sdW1uczogW1xuICAgICAge2NvbDogJ3BlZGlkb19pZCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnRmlyZXN0b3JlIGRvYyBJRCd9LFxuICAgICAge2NvbDogJ293bmVyX3VpZCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnVUlEIGRlbCB2ZW5kZWRvciBkdWVuaW8gZGVsIHBlZGlkbyd9LFxuICAgICAge2NvbDogJ293bmVyX2VtYWlsJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdlbWFpbCBkZWwgdmVuZGVkb3InfSxcbiAgICAgIHtjb2w6ICdjcmVhdGVkX2J5X3VpZCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAncXVpZW4gY2FyZ28gKFZESSBwdWVkZSBjYXJnYXIgcG9yIFZERSknfSxcbiAgICAgIHtjb2w6ICdvbl9iZWhhbGZfb2YnLCB0eXBlOiAnYm9vbGVhbicsIGRlc2M6ICd0cnVlIHNpIFZESSBjYXJnbyBwb3IgVkRFJ30sXG4gICAgICB7Y29sOiAna2V5JywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdjbGF2ZSBjb21wdWVzdGEgdGlwb3xwcm92fGxvY3xjbGllbnRlJ30sXG4gICAgICB7Y29sOiAnc3RhZ2UnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ3BlbmRpbmcgfCBjb25maXJtZWQgfCBzYXBfaW1wb3J0ZWQnfSxcbiAgICAgIHtjb2w6ICd0aXBvJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdDPWNsaWVudGUgfCBQPXByb3NwZWN0byd9LFxuICAgICAge2NvbDogJ3Byb3ZpbmNlJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdwcm92aW5jaWEnfSxcbiAgICAgIHtjb2w6ICdsb2NfbmFtZScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnbG9jYWxpZGFkJ30sXG4gICAgICB7Y29sOiAnY2xpZW50X25hbWUnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ25vbWJyZSBjbGllbnRlJ30sXG4gICAgICB7Y29sOiAnbW9udGgnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ2VqIFwiSnVsaW8gMjAyNlwiJ30sXG4gICAgICB7Y29sOiAnbW9udGhfaWR4JywgdHlwZTogJ2ludCcsIGRlc2M6ICcwLTExJ30sXG4gICAgICB7Y29sOiAneWVhcicsIHR5cGU6ICdpbnQnLCBkZXNjOiAnYW5vJ30sXG4gICAgICB7Y29sOiAnY29uZmlybWVkX2F0JywgdHlwZTogJ2lzbzg2MDEnLCBkZXNjOiAndGltZXN0YW1wIFVUQyBkZSBjb25maXJtYWNpb24nfSxcbiAgICAgIHtjb2w6ICdjb25kaWNpb25fcGFnbycsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnZWogQ1RBIENURSd9LFxuICAgICAge2NvbDogJ2Zvcm1hX2VudHJlZ2FfdGlwbycsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnVFJBTlNQT1JUSVNUQSB8IFNVQ1VSU0FMJ30sXG4gICAgICB7Y29sOiAnZm9ybWFfZW50cmVnYV90cmFuc3Bfbm9tYnJlJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnfSxcbiAgICAgIHtjb2w6ICdmb3JtYV9lbnRyZWdhX3RyYW5zcF9kaXJlY2Npb24nLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJyd9LFxuICAgICAge2NvbDogJ2Zvcm1hX2VudHJlZ2FfY2xpZW50ZV9kaXJlY2Npb24nLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ2Rlc3Rpbm8gZmluYWwnfSxcbiAgICAgIHtjb2w6ICdmb3JtYV9lbnRyZWdhX3N1Y3Vyc2FsX2RpcmVjY2lvbicsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJ30sXG4gICAgICB7Y29sOiAnZGlzY291bnRfcGN0JywgdHlwZTogJ251bWJlcicsIGRlc2M6ICdkZXNjdWVudG8gdG90YWwgZGVsIHBlZGlkbyAoYXBsaWNhZG8gYSBuaXZlbCBoZWFkZXIsIHByb3JyYXRlYXIgZW4gcGlwZWxpbmUpJ30sXG4gICAgICB7Y29sOiAnc3VidG90YWxfYXJzJywgdHlwZTogJ251bWJlcicsIGRlc2M6ICdzdWJ0b3RhbCBicnV0byBBUlMnfSxcbiAgICAgIHtjb2w6ICduZXRfYW1vdW50X2FycycsIHR5cGU6ICdudW1iZXInLCBkZXNjOiAnbmV0byBBUlMgcG9zdC1kZXNjdWVudG8nfSxcbiAgICAgIHtjb2w6ICd0cmFuc2Zlcmlkb19zYXBfdmlhJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdkdHdfbWFudWFsIHwgc2VydmljZV9sYXllcid9LFxuICAgICAge2NvbDogJ3RyYW5zZmVyaWRvX3NhcF9kb2NfbnVtJywgdHlwZTogJ2ludCcsIGRlc2M6ICdudW1lcm8gZGUgUXVvdGF0aW9uIFNBUCd9LFxuICAgICAge2NvbDogJ3RyYW5zZmVyaWRvX3NhcF9kb2NfZW50cnknLCB0eXBlOiAnaW50JywgZGVzYzogJ2RvYyBlbnRyeSBpbnRlcm5vIFNBUCd9LFxuICAgICAge2NvbDogJ3RyYW5zZmVyaWRvX3NhcF9hdCcsIHR5cGU6ICdpc284NjAxJywgZGVzYzogJ3RpbWVzdGFtcCBVVEMnfSxcbiAgICAgIHtjb2w6ICdjcmVhdGVkX2F0JywgdHlwZTogJ2lzbzg2MDEnLCBkZXNjOiAndGltZXN0YW1wIFVUQyd9LFxuICAgICAge2NvbDogJ2xpbmVfaW5kZXgnLCB0eXBlOiAnaW50JywgZGVzYzogJ2luZGljZSBkZSBsaW5lYSAwLWJhc2VkJ30sXG4gICAgICB7Y29sOiAnbGluZV9jb2RlJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdTS1UnfSxcbiAgICAgIHtjb2w6ICdsaW5lX2Rlc2MnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ2Rlc2NyaXBjaW9uIHByb2R1Y3RvJ30sXG4gICAgICB7Y29sOiAnbGluZV9xdHknLCB0eXBlOiAnbnVtYmVyJywgZGVzYzogJ2NhbnRpZGFkJ30sXG4gICAgICB7Y29sOiAnbGluZV9wcmVjaW8nLCB0eXBlOiAnbnVtYmVyJywgZGVzYzogJ3ByZWNpbyB1bml0YXJpbyBBUlMnfSxcbiAgICAgIHtjb2w6ICdsaW5lX2NhdCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnY2F0ZWdvcmlhJ30sXG4gICAgICB7Y29sOiAnbGluZV9mYW0nLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ2ZhbWlsaWEnfSxcbiAgICAgIHtjb2w6ICdsaW5lX3N1YicsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnc3ViZmFtaWxpYSd9LFxuICAgIF0sXG4gIH0sXG4gIHZpc2l0YXM6IHtcbiAgICBuYW1lOiAndmlzaXRhcy5jc3YnLFxuICAgIHNvdXJjZTogJ2ZpcmVzdG9yZScsXG4gICAgY29sbGVjdGlvbjogJ3Zpc2l0cycsXG4gICAgcm93TW9kZTogJ29uZV9wZXJfZG9jJyxcbiAgICBjb2x1bW5zOiBbXG4gICAgICB7Y29sOiAndmlzaXRfaWQnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ0ZpcmVzdG9yZSBkb2MgSUQnfSxcbiAgICAgIHtjb2w6ICdvd25lcl91aWQnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ1VJRCBkZWwgdmVuZGVkb3InfSxcbiAgICAgIHtjb2w6ICdvd25lcl9lbWFpbCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnZW1haWwgZGVsIHZlbmRlZG9yJ30sXG4gICAgICB7Y29sOiAnZmVjaGEnLCB0eXBlOiAnaXNvODYwMScsIGRlc2M6ICdZWVlZLU1NLUREIChmZWNoYSBkZSB2aXNpdGEsIG5vIFVUQyknfSxcbiAgICAgIHtjb2w6ICdtZXMnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ0pVTklPLCBKVUxJTywgZXRjLid9LFxuICAgICAge2NvbDogJ2FuaW8nLCB0eXBlOiAnaW50JywgZGVzYzogJ2Fubyd9LFxuICAgICAge2NvbDogJ3ZlbmRvcicsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnbm9tYnJlIGNhbm9uaWNvIHZlbmRlZG9yJ30sXG4gICAgICB7Y29sOiAncHJvdmluY2lhJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdwcm92aW5jaWEnfSxcbiAgICAgIHtjb2w6ICdsb2NhbGlkYWQnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ2xvY2FsaWRhZCd9LFxuICAgICAge2NvbDogJ3RpZW5kYScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnbm9tYnJlIHRpZW5kYSd9LFxuICAgICAge2NvbDogJ3RpcG8nLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ0MgfCBQJ30sXG4gICAgICB7Y29sOiAnbG9jYWwnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ2VqIFByb3BpbywgQWxxdWlsYWRvJ30sXG4gICAgICB7Y29sOiAndGFtYW5vJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdlaiBDaGljbywgTWVkaWFubywgR3JhbmRlJ30sXG4gICAgICB7Y29sOiAnZmlkZWxpZGFkJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdBbHRhLCBNZWRpYSwgQmFqYSd9LFxuICAgICAge2NvbDogJ3JlbGV2YW5jaWEnLCB0eXBlOiAnaW50JywgZGVzYzogJzAtNSd9LFxuICAgICAge2NvbDogJ3BvcCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnZWogU3RpY2tlcnMgU2hpbWFubyd9LFxuICAgICAge2NvbDogJ25lY2VzaWRhZF9wdW50dWFsJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnfSxcbiAgICAgIHtjb2w6ICd0aXBvX3ZlbnRhJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdlaiBDYXNhIGRlIHBlc2NhICsgZWNvbW1lcmNlJ30sXG4gICAgICB7Y29sOiAncG9uZGVyYWNpb25fbW9zdHJhZG8nLCB0eXBlOiAnaW50JywgZGVzYzogJzAtMTAwJ30sXG4gICAgICB7Y29sOiAncG9uZGVyYWNpb25fZWNvbW1lcmNlJywgdHlwZTogJ2ludCcsIGRlc2M6ICcwLTEwMCd9LFxuICAgICAge2NvbDogJ2NvbXBldGVuY2lhJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnfSxcbiAgICAgIHtjb2w6ICdvcG9ydHVuaWRhZCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJ30sXG4gICAgICB7Y29sOiAnbWFzX3ZlbmRpZG8nLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJyd9LFxuICAgICAge2NvbDogJ21hc19wcmVndW50YW4nLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJyd9LFxuICAgICAge2NvbDogJ2F5dWRhX3RpZW5kYScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJ30sXG4gICAgICB7Y29sOiAnZ3BzX3N0YXR1cycsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnb2sgfCBvdXRzaWRlIHwgbm9sb2MnfSxcbiAgICAgIHtjb2w6ICdncHNfZGlzdGFuY2VfbScsIHR5cGU6ICdudW1iZXInLCBkZXNjOiAnbWV0cm9zJ30sXG4gICAgICB7Y29sOiAnaW50ZXJhY3Rpb25fdHlwZScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAndmlzaXRhIHwgY29udGFjdG8nfSxcbiAgICAgIHtjb2w6ICdmb3JtYV9jb250YWN0bycsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnTExBTUFEQSBURUxFRk9OSUNBIHwgTUVOU0FKRSBERSBXSEFUU0FQUCB8IE1FTlNBSkUgU01TIChzaSBjb250YWN0byknfSxcbiAgICAgIHtjb2w6ICdjb250YWN0b19yZXN1bHRhZG8nLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ3Jlc3BvbmRpbyB8IG5vX3Jlc3BvbmRpbyB8IHZhY2lvIChzaW4gbWFyY2FyLCBzb2xvIGFwbGljYSBhIGNvbnRhY3RvKSd9LFxuICAgICAge2NvbDogJ2NvbnRhY3RvX3Jlc3VsdGFkb19hdCcsIHR5cGU6ICdpc284NjAxJywgZGVzYzogJ3RpbWVzdGFtcCBVVEMnfSxcbiAgICAgIHtjb2w6ICdjb250YWN0b19yZXN1bHRhZG9fYnknLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ1VJRCBkZSBxdWllbiBtYXJjbyd9LFxuICAgICAge2NvbDogJ2NyZWF0ZWRfYXQnLCB0eXBlOiAnaXNvODYwMScsIGRlc2M6ICd0aW1lc3RhbXAgVVRDJ30sXG4gICAgXSxcbiAgfSxcbiAgY2xpZW50ZXM6IHtcbiAgICBuYW1lOiAnY2xpZW50ZXMuY3N2JyxcbiAgICBzb3VyY2U6ICdmaXJlc3RvcmUnLFxuICAgIGNvbGxlY3Rpb246ICdjbGllbnRfYXBwbGljYXRpb25zJyxcbiAgICByb3dNb2RlOiAnb25lX3Blcl9kb2MnLFxuICAgIGNvbHVtbnM6IFtcbiAgICAgIHtjb2w6ICdhcHBfaWQnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ0ZpcmVzdG9yZSBkb2MgSUQnfSxcbiAgICAgIHtjb2w6ICdvd25lcl91aWQnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJyd9LFxuICAgICAge2NvbDogJ293bmVyX2VtYWlsJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnfSxcbiAgICAgIHtjb2w6ICdvd25lcl9uYW1lJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnfSxcbiAgICAgIHtjb2w6ICdjb21lcmNpbycsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAncmF6b24gc29jaWFsJ30sXG4gICAgICB7Y29sOiAnZmFudGFzaWEnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ25vbWJyZSBjb21lcmNpYWwnfSxcbiAgICAgIHtjb2w6ICdjdWl0JywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdzb2xvIGRpZ2l0b3MgcG9zdC12Mjk0J30sXG4gICAgICB7Y29sOiAnY29uZGljaW9uX2Zpc2NhbCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJ30sXG4gICAgICB7Y29sOiAnY2FsbGUnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJyd9LFxuICAgICAge2NvbDogJ251bWVybycsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJ30sXG4gICAgICB7Y29sOiAnbG9jYWxpZGFkJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnfSxcbiAgICAgIHtjb2w6ICdwcm92aW5jaWEnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJyd9LFxuICAgICAge2NvbDogJ2xvY2FsaWRhZF9maW5hbCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnb3ZlcnJpZGUgZGVsIGFwcm9iYWRvcid9LFxuICAgICAge2NvbDogJ2NhcmRfY29kZV9zYXAnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ0NhcmRDb2RlIFNBUCd9LFxuICAgICAge2NvbDogJ2Fzc2lnbmVkX3ZlbmRvcicsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAndmVuZGVkb3IgYXNpZ25hZG8gKHNvdXJjZSBvZiB0cnV0aCB2MzExKyknfSxcbiAgICAgIHtjb2w6ICdzdGF0dXMnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ3BlbmRpbmdfYXBwcm92YWwgfCBhcHByb3ZlZCB8IHJlamVjdGVkJ30sXG4gICAgICB7Y29sOiAnc291cmNlJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdtYW51YWwgfCBzYXBfYnVsa19pbXBvcnQgfCBhbHRhX3JhcGlkYSB8IHNhcF9zeW5jIHwgc2FwX3N5bmNfbWFudWFsX2xpbmsnfSxcbiAgICAgIHtjb2w6ICdtYW51YWxfc2FwX3BlbmRpbmcnLCB0eXBlOiAnYm9vbGVhbicsIGRlc2M6ICd0cnVlPXByb3Zpc29yaW8gKEFsdGEgUmFwaWRhIHNpbiBDYXJkQ29kZSknfSxcbiAgICAgIHtjb2w6ICdwcmVjYXVjaW9uJywgdHlwZTogJ2Jvb2xlYW4nLCBkZXNjOiAndHJ1ZT1jbGllbnRlIG1hcmNhZG8gcG9yIGltcGFnbyd9LFxuICAgICAge2NvbDogJ2NhdGVnb3JpYV9jbGllbnRlJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdQL0EvQi9DJ30sXG4gICAgICB7Y29sOiAnY2xpX3RpcG8nLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ0MgZGVmYXVsdCBwb3N0LXYzNDknfSxcbiAgICAgIHtjb2w6ICdsYXQnLCB0eXBlOiAnbnVtYmVyJywgZGVzYzogJ2dlb2xhdCd9LFxuICAgICAge2NvbDogJ2xuZycsIHR5cGU6ICdudW1iZXInLCBkZXNjOiAnZ2VvbG5nJ30sXG4gICAgICB7Y29sOiAnaGFzX2dlbycsIHR5cGU6ICdib29sZWFuJywgZGVzYzogJ2xhdC9sbmcgbm8gbnVsbCd9LFxuICAgICAge2NvbDogJ2hhc19hZGRyZXNzJywgdHlwZTogJ2Jvb2xlYW4nLCBkZXNjOiAnY2FsbGUgbm8gdmFjaWEnfSxcbiAgICAgIHtjb2w6ICdzdWJtaXR0ZWRfYnlfcHVibGljX2Zvcm0nLCB0eXBlOiAnYm9vbGVhbicsIGRlc2M6ICd2aWEgYWx0YS1jbGllbnRlLmh0bWwnfSxcbiAgICAgIHtjb2w6ICdhcHByb3ZlZF9hdCcsIHR5cGU6ICdpc284NjAxJywgZGVzYzogJyd9LFxuICAgICAge2NvbDogJ2NyZWF0ZWRfYXQnLCB0eXBlOiAnaXNvODYwMScsIGRlc2M6ICcnfSxcbiAgICAgIHtjb2w6ICd1cGRhdGVkX2F0JywgdHlwZTogJ2lzbzg2MDEnLCBkZXNjOiAnJ30sXG4gICAgXSxcbiAgfSxcbiAgY2xpZW50X21hc3Rlcjoge1xuICAgIG5hbWU6ICdjbGllbnRfbWFzdGVyLmNzdicsXG4gICAgc291cmNlOiAnZmlyZXN0b3JlJyxcbiAgICBjb2xsZWN0aW9uOiAnY2xpZW50X21hc3RlcicsXG4gICAgcm93TW9kZTogJ29uZV9wZXJfZG9jJyxcbiAgICBjb2x1bW5zOiBbXG4gICAgICB7Y29sOiAnbWFzdGVyX2lkJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdGaXJlc3RvcmUgZG9jIElEJ30sXG4gICAgICB7Y29sOiAnY2xpZW50X25hbWUnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJyd9LFxuICAgICAge2NvbDogJ3Byb3ZpbmNpYScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJ30sXG4gICAgICB7Y29sOiAnbG9jYWxpZGFkJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnfSxcbiAgICAgIHtjb2w6ICd2ZW5kb3InLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ3ZlbmRlZG9yIGN1cmFkbyBhZG1pbid9LFxuICAgICAge2NvbDogJ2FkZHJlc3MnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ2RpcmVjY2lvbiBjdXJhZGEgYWRtaW4nfSxcbiAgICAgIHtjb2w6ICdzYXBfY2FyZF9jb2RlJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdDYXJkQ29kZSBTQVAnfSxcbiAgICAgIHtjb2w6ICdzYXBfYWRkcmVzcycsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnZGlyZWNjaW9uIHJhdyBTQVAnfSxcbiAgICAgIHtjb2w6ICdzYXBfY2l0eScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJ30sXG4gICAgICB7Y29sOiAnc2FwX3N0YXRlJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnfSxcbiAgICAgIHtjb2w6ICdzYXBfaW1wb3J0ZWRfYXQnLCB0eXBlOiAnaXNvODYwMScsIGRlc2M6ICcnfSxcbiAgICAgIHtjb2w6ICdzYXBfaW1wb3J0ZWRfYnknLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJyd9LFxuICAgICAge2NvbDogJ2NsaWVudF9uYW1lX29yaWdpbmFsJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdiYWNrdXAgbm9tYnJlIHByZS1pbXBvcnQnfSxcbiAgICAgIHtjb2w6ICdsb2NhbGlkYWRfb3JpZ2luYWwnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ2JhY2t1cCBsb2NhbGlkYWQgcHJlLWltcG9ydCd9LFxuICAgICAge2NvbDogJ21hdGNoX3R5cGUnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ2V4YWN0IHwgZnV6enknfSxcbiAgICAgIHtjb2w6ICdtYXRjaF9zaW1pbGFyaXR5JywgdHlwZTogJ251bWJlcicsIGRlc2M6ICcwLTEnfSxcbiAgICAgIHtjb2w6ICd1cGRhdGVkX2F0JywgdHlwZTogJ2lzbzg2MDEnLCBkZXNjOiAnJ30sXG4gICAgICB7Y29sOiAndXBkYXRlZF9ieScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJ30sXG4gICAgXSxcbiAgfSxcbiAgcmVuZGljaW9uZXM6IHtcbiAgICBuYW1lOiAncmVuZGljaW9uZXMuY3N2JyxcbiAgICBzb3VyY2U6ICdmaXJlc3RvcmUnLFxuICAgIGNvbGxlY3Rpb246ICdyZW5kaWNpb25lcycsXG4gICAgcm93TW9kZTogJ29uZV9wZXJfZG9jJyxcbiAgICBjb2x1bW5zOiBbXG4gICAgICB7Y29sOiAncmVuZGljaW9uX2lkJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdGaXJlc3RvcmUgZG9jIElEJ30sXG4gICAgICB7Y29sOiAnb3duZXJfdWlkJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnfSxcbiAgICAgIHtjb2w6ICdvd25lcl9lbWFpbCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJ30sXG4gICAgICB7Y29sOiAndmVuZG9yJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnfSxcbiAgICAgIHtjb2w6ICd0aXBvJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdnYXN0byB8IHNvbGljaXR1ZCd9LFxuICAgICAge2NvbDogJ3RpcG9fZ2FzdG8nLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ2VqIFBFQUpFUywgRkFDVFVSQSBBLCBHQVNUTyBDT04gQ09NUFJPQkFOVEUnfSxcbiAgICAgIHtjb2w6ICdpbXBvcnRlX2FycycsIHR5cGU6ICdudW1iZXInLCBkZXNjOiAnbW9udG8gQVJTJ30sXG4gICAgICB7Y29sOiAnZmVjaGFfZ2FzdG8nLCB0eXBlOiAnaXNvODYwMScsIGRlc2M6ICdZWVlZLU1NLUREIGRlbCBnYXN0byd9LFxuICAgICAge2NvbDogJ2NvbmNlcHRvJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdkZXNjcmlwY2lvbiBsaWJyZSd9LFxuICAgICAge2NvbDogJ2ZvdG9fdGlja2V0X3VybCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnVVJMIEZpcmViYXNlIFN0b3JhZ2UgdjMwOCsgKG51bmNhIGJhc2U2NCknfSxcbiAgICAgIHtjb2w6ICdzdGF0dXMnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ3BlbmRpbmdfYXBwcm92YWwgfCBhcHByb3ZlZCB8IHJlamVjdGVkJ30sXG4gICAgICB7Y29sOiAnYXBwcm92ZWRfYnknLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ2VtYWlsIGRlbCBhcHJvYmFkb3IgbyBcInNlbGZcIid9LFxuICAgICAge2NvbDogJ2FwcHJvdmVkX2F0JywgdHlwZTogJ2lzbzg2MDEnLCBkZXNjOiAnJ30sXG4gICAgICB7Y29sOiAncmVqZWN0ZWRfYnlfZW1haWwnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJyd9LFxuICAgICAge2NvbDogJ3JlamVjdGVkX3JlYXNvbicsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJ30sXG4gICAgICB7Y29sOiAnYXBwcm92ZXJfdWlkJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdVSUQgcmVzcG9uc2FibGUgYXNpZ25hZG8nfSxcbiAgICAgIHtjb2w6ICdjcmVhdGVkX2F0JywgdHlwZTogJ2lzbzg2MDEnLCBkZXNjOiAnJ30sXG4gICAgXSxcbiAgfSxcbiAgY2FtcGFuaWFzOiB7XG4gICAgbmFtZTogJ2NhbXBhbmlhcy5jc3YnLFxuICAgIHNvdXJjZTogJ2ZpcmVzdG9yZScsXG4gICAgY29sbGVjdGlvbjogJ2NhbXBhaWducycsXG4gICAgcm93TW9kZTogJ29uZV9wZXJfZG9jJyxcbiAgICBjb2x1bW5zOiBbXG4gICAgICB7Y29sOiAnY2FtcGFpZ25faWQnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ0ZpcmVzdG9yZSBkb2MgSUQnfSxcbiAgICAgIHtjb2w6ICduYW1lJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdub21icmUgY2FtcGFuYSd9LFxuICAgICAge2NvbDogJ2ZhbWlsaWEnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ2VqIFJFRUxTJ30sXG4gICAgICB7Y29sOiAnc3ViZmFtaWxpYScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnZWogTVVMVElQTElDQURPUkVTJ30sXG4gICAgICB7Y29sOiAnZmlsdGVyX3R5cGUnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ3NrdSAoaG95IGhhcmRjb2RlZCknfSxcbiAgICAgIHtjb2w6ICdmaWx0ZXJfdmFsdWVzX2pzb24nLCB0eXBlOiAnanNvbl9hcnJheScsIGRlc2M6ICdjb3BpYSBkZSBza3VzJ30sXG4gICAgICB7Y29sOiAnc2t1c19qc29uJywgdHlwZTogJ2pzb25fYXJyYXknLCBkZXNjOiAnSXRlbUNvZGVzIGluY2x1aWRvcyd9LFxuICAgICAge2NvbDogJ3NrdXNfY291bnQnLCB0eXBlOiAnaW50JywgZGVzYzogJ2NhbnRpZGFkIFNLVXMnfSxcbiAgICAgIHtjb2w6ICd0YXJnZXRfdHlwZScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAndW5pdHMgfCBtb25leSd9LFxuICAgICAge2NvbDogJ3RhcmdldF9hbW91bnQnLCB0eXBlOiAnbnVtYmVyJywgZGVzYzogJ29iamV0aXZvJ30sXG4gICAgICB7Y29sOiAnc3RhcnRfZGF0ZScsIHR5cGU6ICdpc284NjAxJywgZGVzYzogJ1lZWVktTU0tREQnfSxcbiAgICAgIHtjb2w6ICdlbmRfZGF0ZScsIHR5cGU6ICdpc284NjAxJywgZGVzYzogJ1lZWVktTU0tREQnfSxcbiAgICAgIHtjb2w6ICdzY29wZScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnYWxsIHwgcHJvdmluY2UgfCB2ZW5kb3InfSxcbiAgICAgIHtjb2w6ICdzY29wZV92YWx1ZXNfanNvbicsIHR5cGU6ICdqc29uX2FycmF5JywgZGVzYzogJ3Byb3ZpbmNpYXMgbyB2ZW5kb3Iga2V5cyBzaSBzY29wZSAhPSBhbGwnfSxcbiAgICAgIHtjb2w6ICdjcmVhdGVkX2J5JywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdVSUQgYWRtaW4vZ2VyZW50ZSd9LFxuICAgICAge2NvbDogJ2NyZWF0ZWRfYnlfZW1haWwnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJyd9LFxuICAgICAge2NvbDogJ2NyZWF0ZWRfYXQnLCB0eXBlOiAnaXNvODYwMScsIGRlc2M6ICcnfSxcbiAgICAgIHtjb2w6ICdhcmNoaXZlZF9tYW51YWxseScsIHR5cGU6ICdib29sZWFuJywgZGVzYzogJ3RydWU9ZmluYWxpemFkYSBhbnRlcyBkZSBlbmREYXRlJ30sXG4gICAgICB7Y29sOiAnYXJjaGl2ZWRfYXQnLCB0eXBlOiAnaXNvODYwMScsIGRlc2M6ICcnfSxcbiAgICAgIHtjb2w6ICdhcmNoaXZlZF9ieScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJ30sXG4gICAgXSxcbiAgfSxcbiAgdGFyZ2V0czoge1xuICAgIG5hbWU6ICd0YXJnZXRzLmNzdicsXG4gICAgc291cmNlOiAnZmlyZXN0b3JlJyxcbiAgICBjb2xsZWN0aW9uOiAndGFyZ2V0cycsXG4gICAgcm93TW9kZTogJ29uZV9wZXJfZG9jJyxcbiAgICBjb2x1bW5zOiBbXG4gICAgICB7Y29sOiAndGFyZ2V0X2lkJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdGaXJlc3RvcmUgZG9jIElEIGNhbm9uaWNvIHt2ZW5kb3J9X3t5ZWFyfV97TU19J30sXG4gICAgICB7Y29sOiAnc2VsbGVyX2lkJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICd2ZW5kb3JLZXkgdXBwZXJjYXNlIGVqIEdPTlpBTE8gREUgTEEgUk9TQSd9LFxuICAgICAge2NvbDogJ3llYXInLCB0eXBlOiAnaW50JywgZGVzYzogJ2VqIDIwMjYnfSxcbiAgICAgIHtjb2w6ICdtb250aCcsIHR5cGU6ICdpbnQnLCBkZXNjOiAnMC0xMSAoaW5kaWNlIGRlbCBhcnJheSBNRVNFUyAwLWluZGV4ZWQpJ30sXG4gICAgICB7Y29sOiAndGFyZ2V0X2FycycsIHR5cGU6ICdudW1iZXInLCBkZXNjOiAnb2JqZXRpdm8gbWVzIEFSUyAoc3VtYSBmYW1pbGlhcyknfSxcbiAgICAgIHtjb2w6ICd0YXJnZXRfcmVlbF9hcnMnLCB0eXBlOiAnbnVtYmVyJywgZGVzYzogJ3YzMTErIGRlc2dsb3NlJ30sXG4gICAgICB7Y29sOiAndGFyZ2V0X2NhbmFzX2FycycsIHR5cGU6ICdudW1iZXInLCBkZXNjOiAndjMxMSsgZGVzZ2xvc2UnfSxcbiAgICAgIHtjb2w6ICd0YXJnZXRfbGluZWFzX2FycycsIHR5cGU6ICdudW1iZXInLCBkZXNjOiAndjMxMSsgZGVzZ2xvc2UnfSxcbiAgICAgIHtjb2w6ICd1cGRhdGVkX2F0JywgdHlwZTogJ2lzbzg2MDEnLCBkZXNjOiAnJ30sXG4gICAgICB7Y29sOiAndXBkYXRlZF9ieScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnVUlEJ30sXG4gICAgICB7Y29sOiAndXBkYXRlZF9ieV9lbWFpbCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJ30sXG4gICAgXSxcbiAgfSxcbiAgcHJvZHVjdG9zOiB7XG4gICAgbmFtZTogJ3Byb2R1Y3Rvcy5jc3YnLFxuICAgIHNvdXJjZTogJ3N0b2NrX2pzb24nLFxuICAgIHJvd01vZGU6ICdmcm9tX3N0b2NrX2pzb24nLFxuICAgIGNvbHVtbnM6IFtcbiAgICAgIHtjb2w6ICdza3UnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ1NLVSAoSXRlbUNvZGUgU0FQKSd9LFxuICAgICAge2NvbDogJ2hhc19zdG9jaycsIHR5cGU6ICdib29sZWFuJywgZGVzYzogJ3RydWU9aGF5IHVuaWRhZGVzIGVuIGFsZ3VuIHdocyB2ZW5kaWJsZSd9LFxuICAgICAge2NvbDogJ2NhbnRpZGFkX3RvdGFsJywgdHlwZTogJ2ludCcsIGRlc2M6ICdzdW1hIHRvdGFsIHdocyB2ZW5kaWJsZXMgKGV4Y2x1eWUgMDUgeSAwNiknfSxcbiAgICAgIHtjb2w6ICdkaXNwb25pYmxlX3ZlbnRhX3doczExJywgdHlwZTogJ2ludCcsIGRlc2M6ICd2MzY5KyBNZXJjYWRlcmlhIE5VUiBQRVNDQSAodmVudGEgZGlyZWN0YSknfSxcbiAgICAgIHtjb2w6ICd0cmFuc2l0b193aHMxMicsIHR5cGU6ICdpbnQnLCBkZXNjOiAndjM2OSsgRW4gdHJhbnNpdG8gUEVTQ0EgKGJhY2tvcmRlciBmdXR1cm8pJ30sXG4gICAgICB7Y29sOiAnb3Ryb3Nfd2FyZWhvdXNlc19qc29uJywgdHlwZTogJ2pzb25fb2JqZWN0JywgZGVzYzogJ290cm9zIGNvZGlnb3MgY29uIGNhbnRpZGFkLCBlaiB7XCI5OFwiOiA1fSd9LFxuICAgICAge2NvbDogJ3NvdXJjZScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnc3RvY2suanNvbiBzbmFwc2hvdCd9LFxuICAgICAge2NvbDogJ3NuYXBzaG90X3VwZGF0ZWRfYXQnLCB0eXBlOiAnaXNvODYwMScsIGRlc2M6ICd0aW1lc3RhbXAgZGVsIHVsdGltbyBzeW5jIFNBUCd9LFxuICAgIF0sXG4gIH0sXG4gIHZlbmRvcl9vdmVycmlkZXM6IHtcbiAgICBuYW1lOiAndmVuZG9yX292ZXJyaWRlcy5jc3YnLFxuICAgIHNvdXJjZTogJ2ZpcmVzdG9yZScsXG4gICAgY29sbGVjdGlvbjogJ3ZlbmRvcl9vdmVycmlkZXMnLFxuICAgIHJvd01vZGU6ICdvbmVfcGVyX2RvYycsXG4gICAgY29sdW1uczogW1xuICAgICAge2NvbDogJ292ZXJyaWRlX2lkJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdGaXJlc3RvcmUgZG9jIElEJ30sXG4gICAgICB7Y29sOiAnc2NvcGUnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ3Nob3AgfCBsb2MnfSxcbiAgICAgIHtjb2w6ICdwcm92aW5jZScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJ30sXG4gICAgICB7Y29sOiAnbG9jYWxpdHlfbmFtZScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJ30sXG4gICAgICB7Y29sOiAnY2xpZW50X25hbWUnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ3NvbG8gc2kgc2NvcGU9c2hvcCd9LFxuICAgICAge2NvbDogJ29yaWdpbmFsX3ZlbmRvcicsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJ30sXG4gICAgICB7Y29sOiAnbmV3X3ZlbmRvcicsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJ30sXG4gICAgICB7Y29sOiAnbmV3X3R5cGUnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ1ZERSB8IFZESSB8IERJU1RSSUJVSURPUiB8IE9UUk8nfSxcbiAgICAgIHtjb2w6ICd1cGRhdGVkX2F0JywgdHlwZTogJ2lzbzg2MDEnLCBkZXNjOiAnJ30sXG4gICAgICB7Y29sOiAndXBkYXRlZF9ieV91aWQnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJyd9LFxuICAgICAge2NvbDogJ3VwZGF0ZWRfYnlfZW1haWwnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJyd9LFxuICAgICAge2NvbDogJ3VwZGF0ZWRfYnlfZGlzcGxheV9uYW1lJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnfSxcbiAgICBdLFxuICB9LFxuICBjdXN0b21fcm91dGVzOiB7XG4gICAgbmFtZTogJ2N1c3RvbV9yb3V0ZXMuY3N2JyxcbiAgICBzb3VyY2U6ICdmaXJlc3RvcmUnLFxuICAgIGNvbGxlY3Rpb246ICdjdXN0b21fcm91dGVzJyxcbiAgICByb3dNb2RlOiAnZmxhdHRlbl9zdG9wcycsIC8vIDEgZmlsYSBwb3IgKHJ1dGEsIHN0b3ApXG4gICAgY29sdW1uczogW1xuICAgICAge2NvbDogJ3JvdXRlX2lkJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdGaXJlc3RvcmUgZG9jIElEJ30sXG4gICAgICB7Y29sOiAnb3duZXJfdWlkJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdkdWVuaW8gZGUgbGEgcnV0YSd9LFxuICAgICAge2NvbDogJ293bmVyX2VtYWlsJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnfSxcbiAgICAgIHtjb2w6ICduYW1lJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdub21icmUgZGUgbGEgcnV0YSd9LFxuICAgICAge2NvbDogJ3BsYW5uZWRfZGF0ZScsIHR5cGU6ICdpc284NjAxJywgZGVzYzogJ1lZWVktTU0tREQnfSxcbiAgICAgIHtjb2w6ICdub3RlcycsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnbm90YXMgbGlicmVzJ30sXG4gICAgICB7Y29sOiAnY3JlYXRlZF9hdCcsIHR5cGU6ICdpc284NjAxJywgZGVzYzogJyd9LFxuICAgICAge2NvbDogJ3VwZGF0ZWRfYXQnLCB0eXBlOiAnaXNvODYwMScsIGRlc2M6ICcnfSxcbiAgICAgIHtjb2w6ICdzdG9wX29yZGVyJywgdHlwZTogJ2ludCcsIGRlc2M6ICdvcmRlbiAwLWJhc2VkJ30sXG4gICAgICB7Y29sOiAnc3RvcF9rZXknLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ2NsYXZlIGNvbXB1ZXN0YSB0aXBvfHByb3Z8bG9jfGNsaWVudGUnfSxcbiAgICAgIHtjb2w6ICdzdG9wX3RpcG8nLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ0MgfCBQJ30sXG4gICAgICB7Y29sOiAnc3RvcF9wcm92aW5jaWEnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJyd9LFxuICAgICAge2NvbDogJ3N0b3BfbG9jYWxpZGFkJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnfSxcbiAgICAgIHtjb2w6ICdzdG9wX2NsaWVudF9uYW1lJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnfSxcbiAgICAgIHtjb2w6ICdzdG9wX2lzX3Byb3Zpc29yaW8nLCB0eXBlOiAnYm9vbGVhbicsIGRlc2M6ICd0cnVlPWFsdGEgcmFwaWRhIHNpbiBDYXJkQ29kZSd9LFxuICAgICAge2NvbDogJ3N0b3Bfc2FwX2FsdGFfaWQnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ0lEIGRlbCBjbGllbnRfYXBwbGljYXRpb25zIHNpIGFwbGljYSd9LFxuICAgIF0sXG4gIH0sXG4gIHNlZ3VpbWllbnRvX25vdGVzOiB7XG4gICAgbmFtZTogJ3NlZ3VpbWllbnRvX25vdGVzLmNzdicsXG4gICAgc291cmNlOiAnZmlyZXN0b3JlJyxcbiAgICBjb2xsZWN0aW9uOiAnc2VndWltaWVudG9fbm90ZXMnLFxuICAgIHJvd01vZGU6ICdvbmVfcGVyX2RvYycsXG4gICAgY29sdW1uczogW1xuICAgICAge2NvbDogJ25vdGVfaWQnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ0ZpcmVzdG9yZSBkb2MgSUQnfSxcbiAgICAgIHtjb2w6ICd2ZW5kb3JfZXh0JywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdWREUgYWwgcXVlIGFwbGljYSBsYSBub3RhJ30sXG4gICAgICB7Y29sOiAnY2xpZW50X2tleScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnY2xhdmUgY29tcHVlc3RhIGNsaWVudGUnfSxcbiAgICAgIHtjb2w6ICdjbGllbnRfbmFtZScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJ30sXG4gICAgICB7Y29sOiAncHJvdmluY2UnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJyd9LFxuICAgICAge2NvbDogJ2xvY2FsaXR5JywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnfSxcbiAgICAgIHtjb2w6ICd0ZXh0JywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICd0ZXh0byBsaWJyZSBkZSBsYSBub3RhJ30sXG4gICAgICB7Y29sOiAnYXV0aG9yX3VpZCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJ30sXG4gICAgICB7Y29sOiAnYXV0aG9yX2VtYWlsJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnfSxcbiAgICAgIHtjb2w6ICdhdXRob3JfbmFtZScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJ30sXG4gICAgICB7Y29sOiAnYXV0aG9yX3JvbGUnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ2FkbWluIHwgZ2VyZW50ZSB8IGludGVybm8nfSxcbiAgICAgIHtjb2w6ICdjcmVhdGVkX2F0JywgdHlwZTogJ2lzbzg2MDEnLCBkZXNjOiAnJ30sXG4gICAgXSxcbiAgfSxcbn07XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gREFUQVNFVF9VU0VfQ0FTRV9NQVRSSVggXHUyMDE0IGNhc29zIGRlIHVzbyBNTCBjb24gY2FtcG9zIHJlcXVlcmlkb3Ncbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4vKiogQHR5cGVkZWYge3twcmlvcml0eTogbnVtYmVyfHN0cmluZywgZGVzY3JpcHRpb246IHN0cmluZywgcmVxdWlyZWRGaWVsZHM6IFJlY29yZDxzdHJpbmcsIHN0cmluZ1tdPiwgam9pbk5vdGVzPzogc3RyaW5nfX0gVXNlQ2FzZSAqL1xuXG4vKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFVzZUNhc2U+fSAqL1xuZXhwb3J0IGNvbnN0IERBVEFTRVRfVVNFX0NBU0VfTUFUUklYID0ge1xuICBBX2NvbnZlcnNpb25fdmlzaXRhX3BlZGlkbzoge1xuICAgIHByaW9yaXR5OiAxLFxuICAgIGRlc2NyaXB0aW9uOiAnUHJlZGVjaXIgcXVlIHZpc2l0YXMgdGVybWluYW4gZW4gcGVkaWRvIHBhcmEgcHJpb3JpemFyIGxhIHJ1dGEgZGVsIHZlbmRlZG9yLicsXG4gICAgcmVxdWlyZWRGaWVsZHM6IHtcbiAgICAgICd2aXNpdGFzLmNzdic6IFsnZmVjaGEnLCAnb3duZXJfdWlkJywgJ3Byb3ZpbmNpYScsICdsb2NhbGlkYWQnLCAndGllbmRhJ10sXG4gICAgICAncGVkaWRvcy5jc3YnOiBbJ2NvbmZpcm1lZF9hdCcsICdvd25lcl91aWQnLCAncHJvdmluY2UnLCAnbG9jX25hbWUnLCAnY2xpZW50X25hbWUnXSxcbiAgICB9LFxuICAgIGpvaW5Ob3RlczogJ0pPSU4gcG9yIChwcm92aW5jaWEsIGxvY2FsaWRhZCwgdGllbmRhfmNsaWVudF9uYW1lKSBlbiB2ZW50YW5hIHRlbXBvcmFsIGZlY2hhX3Zpc2l0YS4uY29uZmlybWVkX2F0LiBObyBoYXkgY2FyZENvZGVTYXAgY29tdW4gZW50cmUgdmlzaXRzIHkgcGVkaWRvcy4nLFxuICB9LFxuICBCX2NodXJuX2NsaWVudGVzOiB7XG4gICAgcHJpb3JpdHk6IDIsXG4gICAgZGVzY3JpcHRpb246ICdEZXRlY3RhciBjbGllbnRlcyBxdWUgc2UgZW5mcmlhbiBhbnRlcyBkZSBwZXJkZXJsb3MuJyxcbiAgICByZXF1aXJlZEZpZWxkczoge1xuICAgICAgJ2NsaWVudGVzLmNzdic6IFsnY3JlYXRlZF9hdCcsICdhc3NpZ25lZF92ZW5kb3InLCAncHJvdmluY2lhJywgJ3N0YXR1cycsICdjYXJkX2NvZGVfc2FwJ10sXG4gICAgICAncGVkaWRvcy5jc3YnOiBbJ2NvbmZpcm1lZF9hdCcsICdjbGllbnRfbmFtZScsICdwcm92aW5jZScsICdsb2NfbmFtZSddLFxuICAgIH0sXG4gICAgam9pbk5vdGVzOiAnSk9JTiB2aWEgY2xpZW50X2FwcGxpY2F0aW9ucy5jYXJkX2NvZGVfc2FwIHZzIHBlZGlkb3Mua2V5IChwYXJzZWFkbykuIEZyYWdpbCAtIGNvbnNpZGVyYXIgZnV6enkgbWF0Y2ggcG9yIG5vbWJyZS4nLFxuICB9LFxuICBDX2ZvcmVjYXN0X3NrdToge1xuICAgIHByaW9yaXR5OiAzLFxuICAgIGRlc2NyaXB0aW9uOiAnQW50aWNpcGFyIHF1ZSBwcm9kdWN0b3Mgc2UgdmFuIGEgcGVkaXIgcG9yIHBlcmlvZG8uJyxcbiAgICByZXF1aXJlZEZpZWxkczoge1xuICAgICAgJ3BlZGlkb3MuY3N2JzogWydsaW5lX2NvZGUnLCAnbGluZV9xdHknLCAnbGluZV9wcmVjaW8nLCAnY29uZmlybWVkX2F0JywgJ3Byb3ZpbmNlJ10sXG4gICAgICAncHJvZHVjdG9zLmNzdic6IFsnc2t1J10sXG4gICAgfSxcbiAgICBqb2luTm90ZXM6ICdEZXNjdWVudG8gYXBsaWNhZG8gYSBuaXZlbCBoZWFkZXIgKGRpc2NvdW50X3BjdCkgLSBwcm9ycmF0ZWFyIGVuIGVsIHBpcGVsaW5lIGRvd25zdHJlYW0gcHJvcG9yY2lvbmFsIGEgc3VidG90YWxfYnJ1dG8gZGUgY2FkYSBsaW5lYS4gRW5yaXF1ZWNlciBjb24gY2F0YWxvZ28gQlEgKHNhcF9pdGVtc19yYXcpIHNpIGhhY2UgZmFsdGEgY2F0L2ZhbS9zdWIgYWRpY2lvbmFsLicsXG4gIH0sXG4gIERfYW5vbWFsaWFzX3JlbmRpY2lvbmVzOiB7XG4gICAgcHJpb3JpdHk6ICdleHBsb3JhdG9yaW8nLFxuICAgIGRlc2NyaXB0aW9uOiAnRGV0ZWN0YXIgb3V0bGllcnMgZGUgZ2FzdG9zLicsXG4gICAgcmVxdWlyZWRGaWVsZHM6IHtcbiAgICAgICdyZW5kaWNpb25lcy5jc3YnOiBbJ2ltcG9ydGVfYXJzJywgJ3RpcG9fZ2FzdG8nLCAnb3duZXJfdWlkJywgJ2ZlY2hhX2dhc3RvJywgJ3N0YXR1cyddLFxuICAgIH0sXG4gIH0sXG4gIEVfZXN0YWNpb25hbGlkYWRfem9uYV9jYXRlZ29yaWE6IHtcbiAgICBwcmlvcml0eTogJ2V4cGxvcmF0b3JpbycsXG4gICAgZGVzY3JpcHRpb246ICdJbnN1bW8gcGFyYSBhcm1hZG8gZGUgY2FtcGFuaWFzIGVzdGFjaW9uYWxlcy4nLFxuICAgIHJlcXVpcmVkRmllbGRzOiB7XG4gICAgICAncGVkaWRvcy5jc3YnOiBbJ2NvbmZpcm1lZF9hdCcsICdwcm92aW5jZScsICdsaW5lX2NvZGUnLCAnbGluZV9mYW0nLCAnbGluZV9xdHknXSxcbiAgICAgICdjbGllbnRlcy5jc3YnOiBbJ3Byb3ZpbmNpYScsICdhc3NpZ25lZF92ZW5kb3InXSxcbiAgICAgICdjYW1wYW5pYXMuY3N2JzogWydzdGFydF9kYXRlJywgJ2VuZF9kYXRlJywgJ3NrdXNfanNvbicsICdzY29wZSddLFxuICAgICAgJ3RhcmdldHMuY3N2JzogWyd5ZWFyJywgJ21vbnRoJywgJ3RhcmdldF9hcnMnXSxcbiAgICB9LFxuICB9LFxufTtcblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBSb3cgYnVpbGRlcnMgXHUyMDE0IGZ1bmNpb25lcyBwdXJhcyAoZG9jIC0+IGFycmF5IGRlIHJvd3MpXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuLyoqXG4gKiBFeHRyYWUgdmFsb3IgRmlyZXN0b3JlIGRlIGRvYyBjb24gcGF0aCBhbmlkYWRvLiBEZXZ1ZWx2ZSByYXcgKG5vIENTVikuXG4gKiBFajogZ2V0RmllbGQoZG9jLCAndHJhbnNmZXJpZG9TQVAuZG9jTnVtJylcbiAqIEBwYXJhbSB7b2JqZWN0fSBkb2NcbiAqIEBwYXJhbSB7c3RyaW5nfSBwYXRoXG4gKi9cbmZ1bmN0aW9uIGYoZG9jLCBwYXRoKSB7XG4gIHJldHVybiBnZXRQYXRoKGRvYywgcGF0aCk7XG59XG5cbi8qKlxuICogUm93IGJ1aWxkZXIgZ2VuZXJpY286IG1hcGVhIHVuIGRvYyBhIGFycmF5IGRlIHZhbG9yZXMgc2VndW4gdW4gYXJyYXkgZGUgcGF0aHMuXG4gKiBAcGFyYW0ge29iamVjdH0gZG9jXG4gKiBAcGFyYW0ge3N0cmluZ1tdfSBwYXRoc1xuICogQHJldHVybnMge3Vua25vd25bXX1cbiAqL1xuZnVuY3Rpb24gYnVpbGRSb3coZG9jLCBwYXRocykge1xuICByZXR1cm4gcGF0aHMubWFwKChwKSA9PiAocCA9PT0gJ19faWRfXycgPyAvKiogQHR5cGUge2FueX0gKi8oZG9jKS5faWQgOiBmKGRvYywgcCkpKTtcbn1cblxuLyoqXG4gKiBQZWRpZG9zOiBmbGF0dGVuIDEgZmlsYSBwb3IgbGluZWEuIEhlYWRlciBwZWRpZG8gcmVwbGljYWRvIGVuIGNhZGEuXG4gKiBkb2MuX2lkIGVzIGVsIElEOyBzZSBlc3BlcmEgcXVlIGVsIGNhbGxlciBsbyBhZ3JlZ3VlIGFudGVzIGRlIHBhc2FyLlxuICogQHBhcmFtIHthbnl9IGRvY1xuICogQHJldHVybnMge3Vua25vd25bXVtdfVxuICovXG5leHBvcnQgZnVuY3Rpb24gYnVpbGRQZWRpZG9Sb3dzKGRvYykge1xuICBjb25zdCBoZWFkZXIgPSBbXG4gICAgZG9jLl9pZCxcbiAgICBkb2Mub3duZXJVaWQsXG4gICAgZG9jLm93bmVyRW1haWwsXG4gICAgZG9jLmNyZWF0ZWRCeVVpZCxcbiAgICBkb2Mub25CZWhhbGZPZixcbiAgICBkb2Mua2V5LFxuICAgIGRvYy5zdGFnZSxcbiAgICBkb2MudGlwbyxcbiAgICBkb2MucHJvdmluY2UsXG4gICAgZG9jLmxvY05hbWUsXG4gICAgZG9jLmNsaWVudE5hbWUsXG4gICAgZG9jLm1vbnRoLFxuICAgIGRvYy5tb250aElkeCxcbiAgICBkb2MueWVhcixcbiAgICBkb2MuY29uZmlybWVkQXQsXG4gICAgZG9jLmNvbmRpY2lvblBhZ28sXG4gICAgZG9jLmZvcm1hRW50cmVnYSA/IGRvYy5mb3JtYUVudHJlZ2EudGlwbyA6IG51bGwsXG4gICAgZG9jLmZvcm1hRW50cmVnYSA/IGRvYy5mb3JtYUVudHJlZ2EudHJhbnNwTm9tYnJlIDogbnVsbCxcbiAgICBkb2MuZm9ybWFFbnRyZWdhID8gZG9jLmZvcm1hRW50cmVnYS50cmFuc3BEaXJlY2Npb24gOiBudWxsLFxuICAgIGRvYy5mb3JtYUVudHJlZ2EgPyBkb2MuZm9ybWFFbnRyZWdhLmNsaWVudGVEaXJlY2Npb24gOiBudWxsLFxuICAgIGRvYy5mb3JtYUVudHJlZ2EgPyBkb2MuZm9ybWFFbnRyZWdhLnN1Y3Vyc2FsRGlyZWNjaW9uIDogbnVsbCxcbiAgICBkb2MuZGlzY291bnRQY3QsXG4gICAgZG9jLnN1YnRvdGFsQXJzLFxuICAgIGRvYy5uZXRBbW91bnRBcnMsXG4gICAgZG9jLnRyYW5zZmVyaWRvU0FQID8gZG9jLnRyYW5zZmVyaWRvU0FQLnZpYSA6IG51bGwsXG4gICAgZG9jLnRyYW5zZmVyaWRvU0FQID8gZG9jLnRyYW5zZmVyaWRvU0FQLmRvY051bSA6IG51bGwsXG4gICAgZG9jLnRyYW5zZmVyaWRvU0FQID8gZG9jLnRyYW5zZmVyaWRvU0FQLmRvY0VudHJ5IDogbnVsbCxcbiAgICBkb2MudHJhbnNmZXJpZG9TQVAgPyBkb2MudHJhbnNmZXJpZG9TQVAuYXQgOiBudWxsLFxuICAgIGRvYy5jcmVhdGVkQXQsXG4gIF07XG4gIGNvbnN0IGxpbmVzID0gQXJyYXkuaXNBcnJheShkb2MubGluZXMpID8gZG9jLmxpbmVzIDogW107XG4gIGlmICghbGluZXMubGVuZ3RoKSB7XG4gICAgLy8gUGVkaWRvIHNpbiBsaW5lYXMgLT4gMSBmaWxhIGNvbiBsaW5lXyogdmFjaW9zXG4gICAgcmV0dXJuIFtoZWFkZXIuY29uY2F0KFtudWxsLCBudWxsLCBudWxsLCBudWxsLCBudWxsLCBudWxsLCBudWxsLCBudWxsXSldO1xuICB9XG4gIHJldHVybiBsaW5lcy5tYXAoKC8qKiBAdHlwZSB7YW55fSAqL2wsIC8qKiBAdHlwZSB7bnVtYmVyfSAqL2lkeCkgPT4gaGVhZGVyLmNvbmNhdChbXG4gICAgaWR4LFxuICAgIGwgPyBsLmNvZGUgOiBudWxsLFxuICAgIGwgPyBsLmRlc2MgOiBudWxsLFxuICAgIGwgPyBsLnF0eSA6IG51bGwsXG4gICAgbCA/IGwucHJlY2lvIDogbnVsbCxcbiAgICBsID8gbC5jYXQgOiBudWxsLFxuICAgIGwgPyBsLmZhbSA6IG51bGwsXG4gICAgbCA/IGwuc3ViIDogbnVsbCxcbiAgXSkpO1xufVxuXG4vKiogQHBhcmFtIHthbnl9IGRvYyBAcmV0dXJucyB7dW5rbm93bltdW119ICovXG5leHBvcnQgZnVuY3Rpb24gYnVpbGRWaXNpdGFSb3dzKGRvYykge1xuICByZXR1cm4gW1tcbiAgICBkb2MuX2lkLFxuICAgIGRvYy5vd25lclVpZCxcbiAgICBkb2Mub3duZXJFbWFpbCxcbiAgICBkb2MuZmVjaGEsXG4gICAgZG9jLm1lcyxcbiAgICBkb2MuYW5pbyxcbiAgICBkb2MudmVuZG9yLFxuICAgIGRvYy5wcm92aW5jaWEsXG4gICAgZG9jLmxvY2FsaWRhZCxcbiAgICBkb2MudGllbmRhLFxuICAgIGRvYy50aXBvLFxuICAgIGRvYy5sb2NhbCxcbiAgICBkb2MudGFtYW5vLFxuICAgIGRvYy5maWRlbGlkYWQsXG4gICAgZG9jLnJlbGV2YW5jaWEsXG4gICAgZG9jLnBvcCxcbiAgICBkb2MubmVjZXNpZGFkUHVudHVhbCxcbiAgICBkb2MudGlwb1ZlbnRhLFxuICAgIGRvYy5wb25kZXJhY2lvbk1vc3RyYWRvLFxuICAgIGRvYy5wb25kZXJhY2lvbkVjb21tZXJjZSxcbiAgICBkb2MuY29tcGV0ZW5jaWEsXG4gICAgZG9jLm9wb3J0dW5pZGFkLFxuICAgIGRvYy5tYXNWZW5kaWRvLFxuICAgIGRvYy5tYXNQcmVndW50YW4sXG4gICAgZG9jLmF5dWRhVGllbmRhLFxuICAgIGRvYy5ncHNTdGF0dXMsXG4gICAgZG9jLmdwc0Rpc3RhbmNlTSxcbiAgICBkb2MuaW50ZXJhY3Rpb25UeXBlLFxuICAgIGRvYy5mb3JtYUNvbnRhY3RvLFxuICAgIGRvYy5jb250YWN0b1Jlc3VsdGFkbyxcbiAgICBkb2MuY29udGFjdG9SZXN1bHRhZG9BdCxcbiAgICBkb2MuY29udGFjdG9SZXN1bHRhZG9CeSxcbiAgICBkb2MuY3JlYXRlZEF0LFxuICBdXTtcbn1cblxuLyoqIEBwYXJhbSB7YW55fSBkb2MgQHJldHVybnMge3Vua25vd25bXVtdfSAqL1xuZXhwb3J0IGZ1bmN0aW9uIGJ1aWxkQ2xpZW50ZVJvd3MoZG9jKSB7XG4gIHJldHVybiBbW1xuICAgIGRvYy5faWQsXG4gICAgZG9jLm93bmVyVWlkLFxuICAgIGRvYy5vd25lckVtYWlsLFxuICAgIGRvYy5vd25lck5hbWUsXG4gICAgZG9jLmNvbWVyY2lvLFxuICAgIGRvYy5mYW50YXNpYSxcbiAgICBkb2MuY3VpdCxcbiAgICBkb2MuY29uZGljaW9uRmlzY2FsLFxuICAgIGRvYy5jYWxsZSxcbiAgICBkb2MubnVtZXJvLFxuICAgIGRvYy5sb2NhbGlkYWQsXG4gICAgZG9jLnByb3ZpbmNpYSxcbiAgICBkb2MubG9jYWxpZGFkRmluYWwsXG4gICAgZG9jLmNhcmRDb2RlU2FwLFxuICAgIGRvYy5hc3NpZ25lZFZlbmRvcixcbiAgICBkb2Muc3RhdHVzLFxuICAgIGRvYy5zb3VyY2UsXG4gICAgZG9jLm1hbnVhbFNhcFBlbmRpbmcsXG4gICAgZG9jLnByZWNhdWNpb24sXG4gICAgZG9jLmNhdGVnb3JpYUNsaWVudGUsXG4gICAgZG9jLmNsaVRpcG8sXG4gICAgZG9jLmxhdCxcbiAgICBkb2MubG5nLFxuICAgIGRvYy5sYXQgIT0gbnVsbCAmJiBkb2MubG5nICE9IG51bGwsXG4gICAgISEoZG9jLmNhbGxlIHx8IGRvYy5hZGRyZXNzKSxcbiAgICBkb2Muc3VibWl0dGVkQnlQdWJsaWNGb3JtLFxuICAgIGRvYy5hcHByb3ZlZEF0LFxuICAgIGRvYy5jcmVhdGVkQXQsXG4gICAgZG9jLnVwZGF0ZWRBdCxcbiAgXV07XG59XG5cbi8qKiBAcGFyYW0ge2FueX0gZG9jIEByZXR1cm5zIHt1bmtub3duW11bXX0gKi9cbmV4cG9ydCBmdW5jdGlvbiBidWlsZENsaWVudE1hc3RlclJvd3MoZG9jKSB7XG4gIHJldHVybiBbW1xuICAgIGRvYy5faWQsXG4gICAgZG9jLmNsaWVudE5hbWUsXG4gICAgZG9jLnByb3ZpbmNpYSxcbiAgICBkb2MubG9jYWxpZGFkLFxuICAgIGRvYy52ZW5kb3IsXG4gICAgZG9jLmFkZHJlc3MsXG4gICAgZG9jLnNhcENhcmRDb2RlLFxuICAgIGRvYy5zYXBBZGRyZXNzLFxuICAgIGRvYy5zYXBDaXR5LFxuICAgIGRvYy5zYXBTdGF0ZSxcbiAgICBkb2Muc2FwSW1wb3J0ZWRBdCxcbiAgICBkb2Muc2FwSW1wb3J0ZWRCeSxcbiAgICBkb2MuY2xpZW50TmFtZU9yaWdpbmFsLFxuICAgIGRvYy5sb2NhbGlkYWRPcmlnaW5hbCxcbiAgICBkb2MubWF0Y2hUeXBlLFxuICAgIGRvYy5tYXRjaFNpbWlsYXJpdHksXG4gICAgZG9jLnVwZGF0ZWRBdCxcbiAgICBkb2MudXBkYXRlZEJ5LFxuICBdXTtcbn1cblxuLyoqIEBwYXJhbSB7YW55fSBkb2MgQHJldHVybnMge3Vua25vd25bXVtdfSAqL1xuZXhwb3J0IGZ1bmN0aW9uIGJ1aWxkUmVuZGljaW9uUm93cyhkb2MpIHtcbiAgcmV0dXJuIFtbXG4gICAgZG9jLl9pZCxcbiAgICBkb2Mub3duZXJVaWQsXG4gICAgZG9jLm93bmVyRW1haWwsXG4gICAgZG9jLnZlbmRvcixcbiAgICBkb2MudGlwbyxcbiAgICBkb2MudGlwb0dhc3RvLFxuICAgIGRvYy5pbXBvcnRlQXJzICE9IG51bGwgPyBkb2MuaW1wb3J0ZUFycyA6IGRvYy5pbXBvcnRlLFxuICAgIGRvYy5mZWNoYUdhc3RvLFxuICAgIGRvYy5jb25jZXB0byxcbiAgICAvLyBmb3RvVGlja2V0VXJsICh2MzA4KykgcHJpb3JpZGFkOyBOVU5DQSBleHBvcnRhciBiYXNlNjQgZm90b1RpY2tldCBsZWdhY3lcbiAgICBkb2MuZm90b1RpY2tldFVybCB8fCBudWxsLFxuICAgIGRvYy5zdGF0dXMsXG4gICAgZG9jLmFwcHJvdmVkQnksXG4gICAgZG9jLmFwcHJvdmVkQXQsXG4gICAgZG9jLnJlamVjdGVkQnlFbWFpbCxcbiAgICBkb2MucmVqZWN0ZWRSZWFzb24sXG4gICAgZG9jLmFwcHJvdmVyVWlkLFxuICAgIGRvYy5jcmVhdGVkQXQsXG4gIF1dO1xufVxuXG4vKiogQHBhcmFtIHthbnl9IGRvYyBAcmV0dXJucyB7dW5rbm93bltdW119ICovXG5leHBvcnQgZnVuY3Rpb24gYnVpbGRDYW1wYW5pYVJvd3MoZG9jKSB7XG4gIHJldHVybiBbW1xuICAgIGRvYy5faWQsXG4gICAgZG9jLm5hbWUsXG4gICAgZG9jLmZhbWlsaWEsXG4gICAgZG9jLnN1YmZhbWlsaWEsXG4gICAgZG9jLmZpbHRlclR5cGUsXG4gICAgZG9jLmZpbHRlclZhbHVlcyxcbiAgICBkb2Muc2t1cyxcbiAgICBBcnJheS5pc0FycmF5KGRvYy5za3VzKSA/IGRvYy5za3VzLmxlbmd0aCA6IDAsXG4gICAgZG9jLnRhcmdldFR5cGUsXG4gICAgZG9jLnRhcmdldEFtb3VudCxcbiAgICBkb2Muc3RhcnREYXRlLFxuICAgIGRvYy5lbmREYXRlLFxuICAgIGRvYy5zY29wZSxcbiAgICBkb2Muc2NvcGVWYWx1ZXMsXG4gICAgZG9jLmNyZWF0ZWRCeSxcbiAgICBkb2MuY3JlYXRlZEJ5RW1haWwsXG4gICAgZG9jLmNyZWF0ZWRBdCxcbiAgICBkb2MuYXJjaGl2ZWRNYW51YWxseSxcbiAgICBkb2MuYXJjaGl2ZWRBdCxcbiAgICBkb2MuYXJjaGl2ZWRCeSxcbiAgXV07XG59XG5cbi8qKiBAcGFyYW0ge2FueX0gZG9jIEByZXR1cm5zIHt1bmtub3duW11bXX0gKi9cbmV4cG9ydCBmdW5jdGlvbiBidWlsZFRhcmdldFJvd3MoZG9jKSB7XG4gIHJldHVybiBbW1xuICAgIGRvYy5faWQsXG4gICAgZG9jLnNlbGxlcklkLFxuICAgIGRvYy55ZWFyLFxuICAgIGRvYy5tb250aCxcbiAgICBkb2MudGFyZ2V0QXJzLFxuICAgIGRvYy50YXJnZXRCeUZhbWlseSA/IGRvYy50YXJnZXRCeUZhbWlseS5SRUVMIDogbnVsbCxcbiAgICBkb2MudGFyZ2V0QnlGYW1pbHkgPyBkb2MudGFyZ2V0QnlGYW1pbHkuQ0FOQVMgOiBudWxsLFxuICAgIGRvYy50YXJnZXRCeUZhbWlseSA/IGRvYy50YXJnZXRCeUZhbWlseS5MSU5FQVMgOiBudWxsLFxuICAgIGRvYy51cGRhdGVkQXQsXG4gICAgZG9jLnVwZGF0ZWRCeSxcbiAgICBkb2MudXBkYXRlZEJ5RW1haWwsXG4gIF1dO1xufVxuXG4vKiogQHBhcmFtIHthbnl9IGRvYyBAcmV0dXJucyB7dW5rbm93bltdW119ICovXG5leHBvcnQgZnVuY3Rpb24gYnVpbGRWZW5kb3JPdmVycmlkZVJvd3MoZG9jKSB7XG4gIHJldHVybiBbW1xuICAgIGRvYy5faWQsXG4gICAgZG9jLnNjb3BlLFxuICAgIGRvYy5wcm92aW5jZSxcbiAgICBkb2MubG9jYWxpdHlOYW1lLFxuICAgIGRvYy5jbGllbnROYW1lLFxuICAgIGRvYy5vcmlnaW5hbFZlbmRvcixcbiAgICBkb2MubmV3VmVuZG9yLFxuICAgIGRvYy5uZXdUeXBlLFxuICAgIGRvYy51cGRhdGVkQXQsXG4gICAgZG9jLnVwZGF0ZWRCeVVpZCxcbiAgICBkb2MudXBkYXRlZEJ5RW1haWwsXG4gICAgZG9jLnVwZGF0ZWRCeURpc3BsYXlOYW1lLFxuICBdXTtcbn1cblxuLyoqIEBwYXJhbSB7YW55fSBkb2MgQHJldHVybnMge3Vua25vd25bXVtdfSAqL1xuZXhwb3J0IGZ1bmN0aW9uIGJ1aWxkQ3VzdG9tUm91dGVSb3dzKGRvYykge1xuICBjb25zdCBoZWFkZXIgPSBbXG4gICAgZG9jLl9pZCxcbiAgICBkb2Mub3duZXJVaWQsXG4gICAgZG9jLm93bmVyRW1haWwsXG4gICAgZG9jLm5hbWUsXG4gICAgZG9jLnBsYW5uZWREYXRlLFxuICAgIGRvYy5ub3RlcyxcbiAgICBkb2MuY3JlYXRlZEF0LFxuICAgIGRvYy51cGRhdGVkQXQsXG4gIF07XG4gIGNvbnN0IHN0b3BzID0gQXJyYXkuaXNBcnJheShkb2Muc3RvcHMpID8gZG9jLnN0b3BzIDogW107XG4gIGlmICghc3RvcHMubGVuZ3RoKSB7XG4gICAgcmV0dXJuIFtoZWFkZXIuY29uY2F0KFtudWxsLCBudWxsLCBudWxsLCBudWxsLCBudWxsLCBudWxsLCBudWxsLCBudWxsXSldO1xuICB9XG4gIHJldHVybiBzdG9wcy5tYXAoKC8qKiBAdHlwZSB7YW55fSAqL3MpID0+IGhlYWRlci5jb25jYXQoW1xuICAgIHMgPyBzLm9yZGVyIDogbnVsbCxcbiAgICBzID8gcy5rZXkgOiBudWxsLFxuICAgIHMgPyBzLnRpcG8gOiBudWxsLFxuICAgIHMgPyBzLnByb3ZpbmNpYSA6IG51bGwsXG4gICAgcyA/IHMubG9jYWxpZGFkIDogbnVsbCxcbiAgICBzID8gcy5jbGllbnROYW1lIDogbnVsbCxcbiAgICBzID8gcy5pc1Byb3Zpc29yaW8gOiBudWxsLFxuICAgIHMgPyBzLnNhcEFsdGFJZCA6IG51bGwsXG4gIF0pKTtcbn1cblxuLyoqIEBwYXJhbSB7YW55fSBkb2MgQHJldHVybnMge3Vua25vd25bXVtdfSAqL1xuZXhwb3J0IGZ1bmN0aW9uIGJ1aWxkU2VndWltaWVudG9Ob3RlUm93cyhkb2MpIHtcbiAgcmV0dXJuIFtbXG4gICAgZG9jLl9pZCxcbiAgICBkb2MudmVuZG9yRXh0LFxuICAgIGRvYy5jbGllbnRLZXksXG4gICAgZG9jLmNsaWVudE5hbWUsXG4gICAgZG9jLnByb3ZpbmNlLFxuICAgIGRvYy5sb2NhbGl0eSxcbiAgICBkb2MudGV4dCxcbiAgICBkb2MuYXV0aG9yVWlkLFxuICAgIGRvYy5hdXRob3JFbWFpbCxcbiAgICBkb2MuYXV0aG9yTmFtZSxcbiAgICBkb2MuYXV0aG9yUm9sZSxcbiAgICBkb2MuY3JlYXRlZEF0LFxuICBdXTtcbn1cblxuLyoqXG4gKiBQcm9kdWN0b3MgZGVzZGUgc3RvY2suanNvbiAoZm9ybWF0byBTaGltYW5vOiB7c3RvY2s6IHtTS1U6IGJvb2wsIC4uLn0sXG4gKiBxdWFudGl0aWVzOiBKU09OIHN0cmluZywgd2FyZWhvdXNlQnJlYWtkb3duOiBKU09OIHN0cmluZywgdXBkYXRlZEF0OiAuLi59KS5cbiAqIEBwYXJhbSB7b2JqZWN0fSBzdG9ja0pzb25cbiAqIEByZXR1cm5zIHt1bmtub3duW11bXX1cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGJ1aWxkUHJvZHVjdG9Sb3dzRnJvbVN0b2NrSnNvbihzdG9ja0pzb24pIHtcbiAgY29uc3Qgc2ogPSAvKiogQHR5cGUge2FueX0gKi8oc3RvY2tKc29uKSB8fCB7fTtcbiAgY29uc3Qgc3RvY2tNYXAgPSBzai5zdG9jayB8fCB7fTtcbiAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBudW1iZXI+fSAqL1xuICBsZXQgcXVhbnRpdGllcyA9IHt9O1xuICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJlY29yZDxzdHJpbmcsIG51bWJlcj4+fSAqL1xuICBsZXQgYnJlYWtkb3duID0ge307XG4gIHRyeSB7IHF1YW50aXRpZXMgPSBzai5xdWFudGl0aWVzID8gSlNPTi5wYXJzZShzai5xdWFudGl0aWVzKSA6IChzai5xdWFudGl0aWVzX21hcCB8fCB7fSk7IH0gY2F0Y2ggKF8pIHt9XG4gIHRyeSB7IGJyZWFrZG93biA9IHNqLndhcmVob3VzZUJyZWFrZG93biA/IEpTT04ucGFyc2Uoc2oud2FyZWhvdXNlQnJlYWtkb3duKSA6IChzai53YXJlaG91c2VCcmVha2Rvd25fbWFwIHx8IHt9KTsgfSBjYXRjaCAoXykge31cbiAgY29uc3Qgcm93cyA9IC8qKiBAdHlwZSB7dW5rbm93bltdW119ICovKFtdKTtcbiAgY29uc3Qgc291cmNlID0gJ3N0b2NrLmpzb24gc25hcHNob3QnO1xuICBjb25zdCB1cGRhdGVkQXQgPSBzai51cGRhdGVkQXQgfHwgc2ouc25hcHNob3RBdCB8fCBudWxsO1xuICBmb3IgKGNvbnN0IHNrdSBvZiBPYmplY3Qua2V5cyhzdG9ja01hcCkpIHtcbiAgICBjb25zdCBoYXNfc3RvY2sgPSAhIXN0b2NrTWFwW3NrdV07XG4gICAgY29uc3QgdG90YWwgPSBOdW1iZXIocXVhbnRpdGllc1tza3VdIHx8IDApO1xuICAgIGNvbnN0IHdicyA9IGJyZWFrZG93bltza3VdIHx8IHt9O1xuICAgIGNvbnN0IHcxMSA9IE51bWJlcih3YnNbJzExJ10gfHwgMCk7XG4gICAgY29uc3QgdzEyID0gTnVtYmVyKHdic1snMTInXSB8fCAwKTtcbiAgICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIG51bWJlcj59ICovXG4gICAgY29uc3Qgb3Ryb3MgPSB7fTtcbiAgICBmb3IgKGNvbnN0IGsgb2YgT2JqZWN0LmtleXMod2JzKSkge1xuICAgICAgaWYgKGsgIT09ICcxMScgJiYgayAhPT0gJzEyJykgb3Ryb3Nba10gPSBOdW1iZXIod2JzW2tdIHx8IDApO1xuICAgIH1cbiAgICByb3dzLnB1c2goW1xuICAgICAgc2t1LFxuICAgICAgaGFzX3N0b2NrLFxuICAgICAgdG90YWwsXG4gICAgICB3MTEsXG4gICAgICB3MTIsXG4gICAgICBPYmplY3Qua2V5cyhvdHJvcykubGVuZ3RoID8gb3Ryb3MgOiBudWxsLFxuICAgICAgc291cmNlLFxuICAgICAgdXBkYXRlZEF0LFxuICAgIF0pO1xuICB9XG4gIHJldHVybiByb3dzO1xufVxuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIERpc3BhdGNoZXI6IG1hcGEgY29sbGVjdGlvbiAtPiByb3cgYnVpbGRlclxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbi8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgKGRvYzogYW55KSA9PiB1bmtub3duW11bXT59ICovXG5leHBvcnQgY29uc3QgUk9XX0JVSUxERVJTID0ge1xuICBwZWRpZG9zOiBidWlsZFBlZGlkb1Jvd3MsXG4gIHZpc2l0YXM6IGJ1aWxkVmlzaXRhUm93cyxcbiAgY2xpZW50ZXM6IGJ1aWxkQ2xpZW50ZVJvd3MsXG4gIGNsaWVudF9tYXN0ZXI6IGJ1aWxkQ2xpZW50TWFzdGVyUm93cyxcbiAgcmVuZGljaW9uZXM6IGJ1aWxkUmVuZGljaW9uUm93cyxcbiAgY2FtcGFuaWFzOiBidWlsZENhbXBhbmlhUm93cyxcbiAgdGFyZ2V0czogYnVpbGRUYXJnZXRSb3dzLFxuICB2ZW5kb3Jfb3ZlcnJpZGVzOiBidWlsZFZlbmRvck92ZXJyaWRlUm93cyxcbiAgY3VzdG9tX3JvdXRlczogYnVpbGRDdXN0b21Sb3V0ZVJvd3MsXG4gIHNlZ3VpbWllbnRvX25vdGVzOiBidWlsZFNlZ3VpbWllbnRvTm90ZVJvd3MsXG59O1xuIiwgIi8vIEB0cy1ub2NoZWNrXHJcbi8vIEVYUE9SVFMtQURWQU5DRUQ6IHBob3RvIFpJUHMsIGF1ZGl0IFhMU1gsIGV4ZWN1dGl2ZSBzdW1tYXJ5LCB2aXNpdHMgWExTWCxcclxuLy8gUG93ZXJCSSBkYXRhc2V0LCBNTCBkYXRhc2V0LiBFeHRyYVx1MDBFRGRvIHZlcmJhdGltIGRlIGluZGV4Lmh0bWwgKDQgZnJhZ21lbnRvc1xyXG4vLyBkaXNjb250aW51b3Mgc2VwYXJhZG9zIHBvciBCYWNrdXAgKyBBdWRpdCArIF9leHBvcnRMZWdhY3lGdWxsIHF1ZSBxdWVkYW5cclxuLy8gZW4gZWwgaW5saW5lKSBjb21vIHBhcnRlIGRlIEUyLm4uMiAoZTJiLXBlcmYgMjAyNi0wNy0yOCkuXHJcbi8vXHJcbi8vIHYzNzErOiBleHBvcnREYXRhc2V0WmlwKCkgbnVldm8gXHUyMDE0IFpJUCBjb24gQ1NWcyBwb3IgZW50aWRhZCBwYXJhIHBpcGVsaW5lc1xyXG4vLyBNTCBleHRlcm5vcyAoTWljcm9zb2Z0IEZhYnJpYykuIEltcG9ydGEgbG9zIGhlbHBlcnMgcHVyb3MgeSBzY2hlbWFzIGRlbFxyXG4vLyBtb2R1bG8gc3JjL3B1cmUvY3N2LXNlcmlhbGl6ZXIuanMuIFZlciBwbGFuIGNvc21pYy1wb25kZXJpbmctc3RlYXJucy5tZC5cclxuXHJcbmltcG9ydCB7XHJcbiAgYnVpbGRDc3YsXHJcbiAgY29tcHV0ZU51bGxSYXRlcyxcclxuICBmaXJlc3RvcmVWYWx1ZVRvQ3N2LFxyXG4gIERBVEFTRVRfU0NIRU1BUyxcclxuICBEQVRBU0VUX1VTRV9DQVNFX01BVFJJWCxcclxuICBST1dfQlVJTERFUlMsXHJcbiAgYnVpbGRQcm9kdWN0b1Jvd3NGcm9tU3RvY2tKc29uLFxyXG59IGZyb20gJy4uL3B1cmUvY3N2LXNlcmlhbGl6ZXIuanMnO1xyXG4vL1xyXG4vLyBEZXBzIGRlbCBpbmxpbmU6IEpTWmlwIChDRE4gbGF6eSksIEV4Y2VsSlMgKENETiBsYXp5IHZpYSBsb2FkRXhjZWxKUyksXHJcbi8vIFhMU1ggKGRlZmVyIGVuIGhlYWQpLCB2aXNpdHNDYWNoZSwgY2FtcGFpZ25zQ2FjaGUsIG9wc0xvZ0NhY2hlIChhdWRpdFxyXG4vLyBpbmxpbmUpLCBhdWRpdExvZ0NhY2hlIChhdWRpdCBpbmxpbmUpLCBjb250YWN0ZWQgKGdsb2JhbCBTZXQpLCBQT0lOVFMsXHJcbi8vIFBST0RVQ1RTLCBWRU5ET1JTLCBNRVNFUywgdmVuZG9yTG9va3VwLCBlc2NhcGVIdG1sLCBlc2NhcGVBdHRyLCB0aXRsZUNhc2UsXHJcbi8vIHNob3dTeW5jVGFnLCBjdXJyZW50VXNlciwgdXNlclJvbGUsIG9yZGVycywgY29uZmlybWVkLCBwZW5kaW5nLlxyXG4vL1xyXG4vLyBDcm9zcy1zY29wZSBzdGF0ZTogTk9ORSAodG9kb3MgbG9zIGhlbHBlcnMgeSBjb25zdHMgbG9jYWxlcyBhbCBibG9xdWUpLlxyXG4vLyBTaW4gbGlzdGVuZXJzIG9uU25hcHNob3QuXHJcbi8vXHJcbi8vIE5PVEE6IGxvcyBoZWxwZXJzIHRvZGF5U3RyL2RhdGFVcmxUb0Jsb2Ivc2FuaXRpemVGb3JQYXRoIHZpdmVuIGVuIGVzdGVcclxuLy8gbVx1MDBGM2R1bG8gXHUyMDE0IGVsIGlubGluZSBwdWVkZSBsbGFtYXJsb3MgdmlhIGZyZWUgcmVmZXJlbmNlIGFsIEdsb2JhbCBFbnZpcm9ubWVudFxyXG4vLyBSZWNvcmQgcGVybyBwcmVmZXJpbW9zIGV4cG9zaWNpXHUwMEYzbiB3aW5kb3cuKiBleHBsXHUwMEVEY2l0YSBhbCBmaW5hbC5cclxuXHJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxuLy8gU0VDQ0lcdTAwRDNOOiBoZWxwZXJzICsgcGhvdG9zIHppcCArIHZpc2l0cyBlbWJlZGRlZCAoaW5saW5lIEw5MjU2LTk0NDUpXHJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG5cclxuZnVuY3Rpb24gdG9kYXlTdHIoKXsgcmV0dXJuIG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKS5zbGljZSgwLDEwKTsgfVxyXG5cclxuLy8gSGVscGVyOiBjb252ZXJ0aXIgZGF0YVVSTCBiYXNlNjQgYSBCbG9iIHBhcmEgaW5jbHVpciBlbiBaSVBcclxuZnVuY3Rpb24gZGF0YVVybFRvQmxvYihkYXRhVXJsKXtcclxuICBpZiAoIWRhdGFVcmwpIHJldHVybiBudWxsO1xyXG4gIGNvbnN0IHBhcnRzID0gZGF0YVVybC5zcGxpdCgnLCcpO1xyXG4gIGlmIChwYXJ0cy5sZW5ndGggPCAyKSByZXR1cm4gbnVsbDtcclxuICBjb25zdCBtaW1lTWF0Y2ggPSBwYXJ0c1swXS5tYXRjaCgvOiguKj8pOy8pO1xyXG4gIGNvbnN0IG1pbWUgPSBtaW1lTWF0Y2ggPyBtaW1lTWF0Y2hbMV0gOiAnaW1hZ2UvanBlZyc7XHJcbiAgY29uc3QgYnl0ZXMgPSBhdG9iKHBhcnRzWzFdKTtcclxuICBjb25zdCBhcnIgPSBuZXcgVWludDhBcnJheShieXRlcy5sZW5ndGgpO1xyXG4gIGZvciAobGV0IGkgPSAwOyBpIDwgYnl0ZXMubGVuZ3RoOyBpKyspIGFycltpXSA9IGJ5dGVzLmNoYXJDb2RlQXQoaSk7XHJcbiAgcmV0dXJuIG5ldyBCbG9iKFthcnJdLCB7dHlwZTogbWltZX0pO1xyXG59XHJcblxyXG4vLyBTYW5lYXIgbm9tYnJlcyBwYXJhIHF1ZSBzaXJ2YW4gY29tbyBydXRhIGRlIGFyY2hpdm9cclxuZnVuY3Rpb24gc2FuaXRpemVGb3JQYXRoKHMpe1xyXG4gIHJldHVybiBTdHJpbmcocyB8fCAnJykucmVwbGFjZSgvW1xcXFwvKj9cXFtcXF06fFwiPD5dL2csICdfJykucmVwbGFjZSgvXFxzKy9nLCAnICcpLnRyaW0oKS5zbGljZSgwLCA2MCk7XHJcbn1cclxuXHJcbi8vIERlc2NhcmdhciB0b2RhcyBsYXMgZm90b3MgZGUgdmlzaXRhcyBlbiB1biBaSVAgb3JnYW5pemFkbyBwb3IgdmVuZGVkb3IgLyB0aWVuZGEgLyBmZWNoYVxyXG53aW5kb3cuZXhwb3J0UGhvdG9zWmlwID0gYXN5bmMgZnVuY3Rpb24oKXtcclxuICBpZiAodHlwZW9mIEpTWmlwID09PSAndW5kZWZpbmVkJykgeyBhbGVydCgnQ2FyZ2FuZG8gbGlicmVyaWEgWklQLCBpbnRlbnRhIGRlIG51ZXZvIGVuIDUgc2VndW5kb3MuJyk7IHJldHVybjsgfVxyXG4gIGlmICghdmlzaXRzQ2FjaGUgfHwgIXZpc2l0c0NhY2hlLmxlbmd0aCkgeyBhbGVydCgnTm8gaGF5IHZpc2l0YXMgcmVnaXN0cmFkYXMuJyk7IHJldHVybjsgfVxyXG4gIGxldCBwaG90b0NvdW50ID0gMDtcclxuICBjb25zdCB6aXAgPSBuZXcgSlNaaXAoKTtcclxuICB2aXNpdHNDYWNoZS5mb3JFYWNoKHYgPT4ge1xyXG4gICAgY29uc3QgdmVuZG9yID0gc2FuaXRpemVGb3JQYXRoKHRpdGxlQ2FzZSh2LnZlbmRvciB8fCAnU0lOX1ZFTkRFRE9SJykpO1xyXG4gICAgY29uc3QgdGllbmRhID0gc2FuaXRpemVGb3JQYXRoKHYudGllbmRhIHx8ICdzaW5fdGllbmRhJyk7XHJcbiAgICBjb25zdCBmZWNoYSA9ICh2LmZlY2hhIHx8ICcnKS5yZXBsYWNlKC8tL2csICcnKTtcclxuICAgIGNvbnN0IGZvbGRlck5hbWUgPSB2ZW5kb3IgKyAnLycgKyB0aWVuZGEgKyAnXycgKyBmZWNoYTtcclxuICAgIGNvbnN0IGZvbGRlciA9IHppcC5mb2xkZXIoZm9sZGVyTmFtZSk7XHJcbiAgICBpZiAodi5mcmVudGVMb2NhbCkge1xyXG4gICAgICBjb25zdCBiID0gZGF0YVVybFRvQmxvYih2LmZyZW50ZUxvY2FsKTtcclxuICAgICAgaWYgKGIpIHsgZm9sZGVyLmZpbGUoJ2ZyZW50ZS5qcGcnLCBiKTsgcGhvdG9Db3VudCsrOyB9XHJcbiAgICB9XHJcbiAgICAodi5lc3BhY2lvIHx8IFtdKS5mb3JFYWNoKChiNjQsIGkpID0+IHtcclxuICAgICAgY29uc3QgYiA9IGRhdGFVcmxUb0Jsb2IoYjY0KTtcclxuICAgICAgaWYgKGIpIHsgZm9sZGVyLmZpbGUoJ2VzcGFjaW9fJyArIChpICsgMSkgKyAnLmpwZycsIGIpOyBwaG90b0NvdW50Kys7IH1cclxuICAgIH0pO1xyXG4gIH0pO1xyXG4gIGlmICghcGhvdG9Db3VudCkgeyBhbGVydCgnTm8gaGF5IGZvdG9zIGNhcmdhZGFzIGVuIGxhcyB2aXNpdGFzLicpOyByZXR1cm47IH1cclxuICBzaG93U3luY1RhZygnR2VuZXJhbmRvIFpJUCBkZSAnICsgcGhvdG9Db3VudCArICcgZm90b3MuLi4nLCAzMDAwMCk7XHJcbiAgdHJ5IHtcclxuICAgIGNvbnN0IGJsb2IgPSBhd2FpdCB6aXAuZ2VuZXJhdGVBc3luYyh7dHlwZTogJ2Jsb2InLCBjb21wcmVzc2lvbjogJ0RFRkxBVEUnfSk7XHJcbiAgICBjb25zdCB1cmwgPSBVUkwuY3JlYXRlT2JqZWN0VVJMKGJsb2IpO1xyXG4gICAgY29uc3QgYSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2EnKTtcclxuICAgIGEuaHJlZiA9IHVybDtcclxuICAgIGEuZG93bmxvYWQgPSAnU2hpbWFub19Gb3Rvc19WaXNpdGFzXycgKyB0b2RheVN0cigpICsgJy56aXAnO1xyXG4gICAgYS5jbGljaygpO1xyXG4gICAgc2V0VGltZW91dCgoKSA9PiBVUkwucmV2b2tlT2JqZWN0VVJMKHVybCksIDUwMDApO1xyXG4gICAgc2hvd1N5bmNUYWcocGhvdG9Db3VudCArICcgZm90b3MgZGVzY2FyZ2FkYXMnLCAzMDAwKTtcclxuICB9IGNhdGNoKGUpIHsgY29uc29sZS5lcnJvcignemlwJywgZSk7IGFsZXJ0KCdFcnJvciBnZW5lcmFuZG8gWklQOiAnICsgKGUubWVzc2FnZSB8fCBlKSk7IH1cclxufTtcclxuXHJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG4vLyBFeGNlbCBjb24gZm90b3MgZGVsIGZyZW50ZSBlbWJlYmlkYXMgZW4gY2FkYSBjZWxkYSAoRXhjZWxKUylcclxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XHJcbi8vIEV4Y2VsSlMgc2UgY2FyZ2EgbGF6eSAoc29sbyBjdWFuZG8gc2UgdG9jYSBlbCBib3RvbikgcGFyYSBubyBpbmZsYXIgZWwgYnVuZGxlLlxyXG5mdW5jdGlvbiBsb2FkRXhjZWxKUygpe1xyXG4gIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XHJcbiAgICBpZiAodHlwZW9mIEV4Y2VsSlMgIT09ICd1bmRlZmluZWQnKSByZXR1cm4gcmVzb2x2ZSgpO1xyXG4gICAgY29uc3QgcyA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3NjcmlwdCcpO1xyXG4gICAgcy5zcmMgPSAnaHR0cHM6Ly9jZG4uanNkZWxpdnIubmV0L25wbS9leGNlbGpzQDQuNC4wL2Rpc3QvZXhjZWxqcy5taW4uanMnO1xyXG4gICAgcy5vbmxvYWQgPSAoKSA9PiByZXNvbHZlKCk7XHJcbiAgICBzLm9uZXJyb3IgPSAoKSA9PiByZWplY3QobmV3IEVycm9yKCdObyBzZSBwdWRvIGNhcmdhciBsYSBsaWJyZXJpYSBFeGNlbEpTLiBSZXZpc2EgdHUgY29uZXhpb24gYSBpbnRlcm5ldC4nKSk7XHJcbiAgICBkb2N1bWVudC5oZWFkLmFwcGVuZENoaWxkKHMpO1xyXG4gIH0pO1xyXG59XHJcblxyXG53aW5kb3cuZXhwb3J0VmlzaXRzV2l0aEVtYmVkZGVkUGhvdG9zID0gYXN5bmMgZnVuY3Rpb24oKXtcclxuICBpZiAoIXZpc2l0c0NhY2hlIHx8ICF2aXNpdHNDYWNoZS5sZW5ndGgpIHsgYWxlcnQoJ05vIGhheSB2aXNpdGFzIHJlZ2lzdHJhZGFzLicpOyByZXR1cm47IH1cclxuICBjb25zdCBuID0gdmlzaXRzQ2FjaGUubGVuZ3RoO1xyXG4gIGlmIChuID4gMzAwKSB7XHJcbiAgICBpZiAoIWNvbmZpcm0oJ0hheSAnICsgbiArICcgdmlzaXRhcy4gRWwgRXhjZWwgY29uIHRvZGFzIGxhcyBmb3RvcyBlbWJlYmlkYXMgcHVlZGUgcGVzYXIgNTAtMTUwIE1CIHkgdGFyZGFyIHZhcmlvcyBtaW51dG9zLiBcdTAwQkZDb250aW51YXI/JykpIHJldHVybjtcclxuICB9IGVsc2UgaWYgKG4gPiAxMDApIHtcclxuICAgIGlmICghY29uZmlybSgnVmFzIGEgZ2VuZXJhciB1biBFeGNlbCBjb24gJyArIG4gKyAnIHZpc2l0YXMgeSBzdXMgZm90b3MgZW1iZWJpZGFzLiBQdWVkZSB0YXJkYXIgMzAtNjAgc2VndW5kb3MuIFx1MDBCRkNvbnRpbnVhcj8nKSkgcmV0dXJuO1xyXG4gIH1cclxuICBzaG93U3luY1RhZygnQ2FyZ2FuZG8gRXhjZWxKUy4uLicsIDIwMDApO1xyXG4gIHRyeSB7XHJcbiAgICBhd2FpdCBsb2FkRXhjZWxKUygpO1xyXG4gIH0gY2F0Y2goZSkgeyBhbGVydChlLm1lc3NhZ2UgfHwgZSk7IHJldHVybjsgfVxyXG5cclxuICBzaG93U3luY1RhZygnR2VuZXJhbmRvIEV4Y2VsIGNvbiAnICsgbiArICcgdmlzaXRhcy4uLicsIDMwMDApO1xyXG5cclxuICBjb25zdCB3YiA9IG5ldyBFeGNlbEpTLldvcmtib29rKCk7XHJcbiAgd2IuY3JlYXRvciA9ICdBcHAgVmVuZGVkb3JlcyBTaGltYW5vJztcclxuICB3Yi5jcmVhdGVkID0gbmV3IERhdGUoKTtcclxuICBjb25zdCB3cyA9IHdiLmFkZFdvcmtzaGVldCgnVmlzaXRhcycsIHt2aWV3czogW3tzdGF0ZTogJ2Zyb3plbicsIHlTcGxpdDogMX1dfSk7XHJcblxyXG4gIC8vIERlZmluaWNpb24gZGUgY29sdW1uYXMuIExhIGNvbHVtbmEgZGUgZm90byB2YSBhIHRlbmVyIGFuY2hvIGV4dHJhIHBhcmEgcXVlIHNlIHZlYS5cclxuICB3cy5jb2x1bW5zID0gW1xyXG4gICAge2hlYWRlcjogJ0ZlY2hhJywgICAgICAgICBrZXk6ICdmZWNoYScsICAgICB3aWR0aDogMTJ9LFxyXG4gICAge2hlYWRlcjogJ01lcycsICAgICAgICAgICBrZXk6ICdtZXMnLCAgICAgICB3aWR0aDogMTB9LFxyXG4gICAge2hlYWRlcjogJ1ZlbmRlZG9yJywgICAgICBrZXk6ICd2ZW5kZWRvcicsICB3aWR0aDogMjJ9LFxyXG4gICAge2hlYWRlcjogJ1RpcG8gY29udGFjdG8nLCBrZXk6ICd0aXBvQ3QnLCAgICB3aWR0aDogMTJ9LFxyXG4gICAge2hlYWRlcjogJ0NvbWVudGFyaW8nLCAgICBrZXk6ICdjb21lbnQnLCAgICB3aWR0aDogMzJ9LFxyXG4gICAge2hlYWRlcjogJ1Byb3ZpbmNpYScsICAgICBrZXk6ICdwcm92aW5jaWEnLCB3aWR0aDogMTZ9LFxyXG4gICAge2hlYWRlcjogJ0xvY2FsaWRhZCcsICAgICBrZXk6ICdsb2NhbGlkYWQnLCB3aWR0aDogMTh9LFxyXG4gICAge2hlYWRlcjogJ1RpZW5kYScsICAgICAgICBrZXk6ICd0aWVuZGEnLCAgICB3aWR0aDogMzB9LFxyXG4gICAge2hlYWRlcjogJ1RpcG8nLCAgICAgICAgICBrZXk6ICd0aXBvJywgICAgICB3aWR0aDogMTJ9LFxyXG4gICAge2hlYWRlcjogJ0xvY2FsJywgICAgICAgICBrZXk6ICdsb2NhbCcsICAgICB3aWR0aDogMTJ9LFxyXG4gICAge2hlYWRlcjogJ1RhbWFubycsICAgICAgICBrZXk6ICd0YW1hbm8nLCAgICB3aWR0aDogMTB9LFxyXG4gICAge2hlYWRlcjogJ0ZpZGVsaWRhZCcsICAgICBrZXk6ICdmaWRlbGlkYWQnLCB3aWR0aDogMTB9LFxyXG4gICAge2hlYWRlcjogJ1JlbGV2YW5jaWEnLCAgICBrZXk6ICdyZWxldicsICAgICB3aWR0aDogMTB9LFxyXG4gICAge2hlYWRlcjogJ1BPUCcsICAgICAgICAgICBrZXk6ICdwb3AnLCAgICAgICB3aWR0aDogOH0sXHJcbiAgICB7aGVhZGVyOiAnVGlwbyB2ZW50YScsICAgIGtleTogJ3RpcG9WZW50YScsIHdpZHRoOiAxMn0sXHJcbiAgICB7aGVhZGVyOiAnQ29tcGV0ZW5jaWEnLCAgIGtleTogJ2NvbXBlJywgICAgIHdpZHRoOiAxNn0sXHJcbiAgICB7aGVhZGVyOiAnT3BvcnR1bmlkYWQnLCAgIGtleTogJ29wb3J0dScsICAgIHdpZHRoOiAzMH0sXHJcbiAgICB7aGVhZGVyOiAnTG8gbWFzIHZlbmRpZG8nLCBrZXk6ICdtYXNWZScsICAgIHdpZHRoOiAyOH0sXHJcbiAgICB7aGVhZGVyOiAnR1BTIGRpc3QgKG0pJywgIGtleTogJ2dwc0Rpc3QnLCAgIHdpZHRoOiAxMn0sXHJcbiAgICB7aGVhZGVyOiAnRm90byBmcmVudGUnLCAgIGtleTogJ2ZvdG8nLCAgICAgIHdpZHRoOiAyMn0sIC8vIDwtIGxhIGltYWdlbiB2YSBhY2FcclxuICAgIHtoZWFkZXI6ICdFbWFpbCB2ZW5kZWRvcicsa2V5OiAnZW1haWwnLCAgICAgd2lkdGg6IDI4fSxcclxuICBdO1xyXG5cclxuICAvLyBFc3RpbG8gaGVhZGVyXHJcbiAgd3MuZ2V0Um93KDEpLmZvbnQgPSB7Ym9sZDogdHJ1ZSwgY29sb3I6IHthcmdiOiAnRkZGRkZGRkYnfX07XHJcbiAgd3MuZ2V0Um93KDEpLmZpbGwgPSB7dHlwZTogJ3BhdHRlcm4nLCBwYXR0ZXJuOiAnc29saWQnLCBmZ0NvbG9yOiB7YXJnYjogJ0ZGMEM0QTZFJ319O1xyXG4gIHdzLmdldFJvdygxKS5hbGlnbm1lbnQgPSB7dmVydGljYWw6ICdtaWRkbGUnLCBob3Jpem9udGFsOiAnY2VudGVyJ307XHJcbiAgd3MuZ2V0Um93KDEpLmhlaWdodCA9IDIyO1xyXG5cclxuICBjb25zdCBGT1RPX0NPTF9JRFggPSB3cy5nZXRDb2x1bW4oJ2ZvdG8nKS5udW1iZXIgLSAxOyAvLyAwLWluZGV4ZWQgcGFyYSBhZGRJbWFnZVxyXG4gIGNvbnN0IFJPV19IID0gMTAwO1xyXG4gIGNvbnN0IElNR19XID0gMTMwO1xyXG4gIGNvbnN0IElNR19IID0gOTA7XHJcblxyXG4gIC8vIE9yZGVuYXIgdmlzaXRhcyBwb3IgZmVjaGEgZGVzYyAobWFzIHJlY2llbnRlcyBwcmltZXJvKVxyXG4gIGNvbnN0IHNvcnRlZCA9IHZpc2l0c0NhY2hlLnNsaWNlKCkuc29ydCgoYSwgYikgPT4gKGIuZmVjaGEgfHwgJycpLmxvY2FsZUNvbXBhcmUoYS5mZWNoYSB8fCAnJykpO1xyXG5cclxuICBmb3IgKGNvbnN0IHYgb2Ygc29ydGVkKSB7XHJcbiAgICBjb25zdCB0aXBvQ29udGFjdG9MYmwgPSAodi50aXBvQ29udGFjdG8gPT09ICd0ZWxlZm9ubycpID8gJ1RlbGVmb25vJyA6ICdQcmVzZW5jaWFsJztcclxuICAgIGNvbnN0IHIgPSB3cy5hZGRSb3coe1xyXG4gICAgICBmZWNoYTogICAgIHYuZmVjaGEgfHwgJycsXHJcbiAgICAgIG1lczogICAgICAgdi5tZXMgfHwgJycsXHJcbiAgICAgIHZlbmRlZG9yOiAgdGl0bGVDYXNlKHYudmVuZG9yIHx8ICcnKSxcclxuICAgICAgdGlwb0N0OiAgICB0aXBvQ29udGFjdG9MYmwsXHJcbiAgICAgIGNvbWVudDogICAgdi5jb21lbnRhcmlvIHx8ICcnLFxyXG4gICAgICBwcm92aW5jaWE6IHRpdGxlQ2FzZSh2LnByb3ZpbmNpYSB8fCAnJyksXHJcbiAgICAgIGxvY2FsaWRhZDogdi5sb2NhbGlkYWQgfHwgJycsXHJcbiAgICAgIHRpZW5kYTogICAgdi50aWVuZGEgfHwgJycsXHJcbiAgICAgIHRpcG86ICAgICAgdi50aXBvIHx8ICcnLFxyXG4gICAgICBsb2NhbDogICAgIHYubG9jYWwgfHwgJycsXHJcbiAgICAgIHRhbWFubzogICAgdi50YW1hbm8gfHwgJycsXHJcbiAgICAgIGZpZGVsaWRhZDogdi5maWRlbGlkYWQgfHwgJycsXHJcbiAgICAgIHJlbGV2OiAgICAgdi5yZWxldmFuY2lhIHx8ICcnLFxyXG4gICAgICBwb3A6ICAgICAgIHYucG9wIHx8ICcnLFxyXG4gICAgICB0aXBvVmVudGE6ICh2LnRpcG9WZW50YSA9PT0gJ01PU1RSQURPJyA/ICdNT1NUUkFET1InIDogKHYudGlwb1ZlbnRhIHx8ICcnKSksXHJcbiAgICAgIGNvbXBlOiAgICAgdi5jb21wZXRlbmNpYSB8fCAnJyxcclxuICAgICAgb3BvcnR1OiAgICB2Lm9wb3J0dW5pZGFkIHx8ICcnLFxyXG4gICAgICBtYXNWZTogICAgIHYubWFzVmVuZGlkbyB8fCAnJyxcclxuICAgICAgZ3BzRGlzdDogICAodHlwZW9mIHYuZ3BzRGlzdGFuY2VNID09PSAnbnVtYmVyJykgPyB2Lmdwc0Rpc3RhbmNlTSA6ICcnLFxyXG4gICAgICBmb3RvOiAgICAgICcnLCAvLyBsYSBjZWxkYSBxdWVkYSB2YWNpYTsgZW5jaW1hIHZhIGxhIGltYWdlblxyXG4gICAgICBlbWFpbDogICAgIHYub3duZXJFbWFpbCB8fCAnJyxcclxuICAgIH0pO1xyXG4gICAgci5oZWlnaHQgPSBST1dfSDtcclxuICAgIHIuYWxpZ25tZW50ID0ge3ZlcnRpY2FsOiAnbWlkZGxlJywgd3JhcFRleHQ6IHRydWV9O1xyXG4gICAgaWYgKHYuZnJlbnRlTG9jYWwgJiYgdHlwZW9mIHYuZnJlbnRlTG9jYWwgPT09ICdzdHJpbmcnKSB7XHJcbiAgICAgIHRyeSB7XHJcbiAgICAgICAgLy8gRWwgY2FtcG8gZXMgdW4gZGF0YVVSTDogJ2RhdGE6aW1hZ2UvanBlZztiYXNlNjQsLzlqLzRBQVEuLi4nXHJcbiAgICAgICAgbGV0IGI2NCA9IHYuZnJlbnRlTG9jYWw7XHJcbiAgICAgICAgbGV0IGV4dCA9ICdqcGVnJztcclxuICAgICAgICBjb25zdCBtID0gL15kYXRhOmltYWdlXFwvKFxcdyspO2Jhc2U2NCwoLispJC9pLmV4ZWMoYjY0KTtcclxuICAgICAgICBpZiAobSkgeyBleHQgPSBtWzFdLnRvTG93ZXJDYXNlKCk7IGI2NCA9IG1bMl07IH1cclxuICAgICAgICBpZiAoZXh0ID09PSAnanBnJykgZXh0ID0gJ2pwZWcnO1xyXG4gICAgICAgIGNvbnN0IGltYWdlSWQgPSB3Yi5hZGRJbWFnZSh7YmFzZTY0OiBiNjQsIGV4dGVuc2lvbjogZXh0fSk7XHJcbiAgICAgICAgd3MuYWRkSW1hZ2UoaW1hZ2VJZCwge1xyXG4gICAgICAgICAgdGw6IHtjb2w6IEZPVE9fQ09MX0lEWCArIDAuMSwgcm93OiByLm51bWJlciAtIDEgKyAwLjF9LFxyXG4gICAgICAgICAgZXh0OiB7d2lkdGg6IElNR19XLCBoZWlnaHQ6IElNR19IfSxcclxuICAgICAgICAgIGVkaXRBczogJ29uZUNlbGwnLFxyXG4gICAgICAgIH0pO1xyXG4gICAgICB9IGNhdGNoKGUpIHsgY29uc29sZS53YXJuKCdlbWJlYmllbmRvIGZvdG8gZmlsYScsIHIubnVtYmVyLCBlKTsgfVxyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgLy8gR2VuZXJhciB5IGRlc2NhcmdhclxyXG4gIHRyeSB7XHJcbiAgICBjb25zdCBidWZmZXIgPSBhd2FpdCB3Yi54bHN4LndyaXRlQnVmZmVyKCk7XHJcbiAgICBjb25zdCBibG9iID0gbmV3IEJsb2IoW2J1ZmZlcl0sIHt0eXBlOiAnYXBwbGljYXRpb24vdm5kLm9wZW54bWxmb3JtYXRzLW9mZmljZWRvY3VtZW50LnNwcmVhZHNoZWV0bWwuc2hlZXQnfSk7XHJcbiAgICBjb25zdCB1cmwgPSBVUkwuY3JlYXRlT2JqZWN0VVJMKGJsb2IpO1xyXG4gICAgY29uc3QgYSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2EnKTtcclxuICAgIGEuaHJlZiA9IHVybDtcclxuICAgIGEuZG93bmxvYWQgPSAnU2hpbWFub19WaXNpdGFzX2Nvbl9mb3Rvc18nICsgdG9kYXlTdHIoKSArICcueGxzeCc7XHJcbiAgICBkb2N1bWVudC5ib2R5LmFwcGVuZENoaWxkKGEpOyBhLmNsaWNrKCk7IGRvY3VtZW50LmJvZHkucmVtb3ZlQ2hpbGQoYSk7XHJcbiAgICBzZXRUaW1lb3V0KCgpID0+IFVSTC5yZXZva2VPYmplY3RVUkwodXJsKSwgNTAwMCk7XHJcbiAgICBzaG93U3luY1RhZygnRXhjZWwgZGVzY2FyZ2FkbzogJyArIHNvcnRlZC5sZW5ndGggKyAnIHZpc2l0YXMnLCAzMDAwKTtcclxuICB9IGNhdGNoKGUpIHtcclxuICAgIGNvbnNvbGUuZXJyb3IoJ2V4cG9ydFZpc2l0c1dpdGhFbWJlZGRlZFBob3RvcycsIGUpO1xyXG4gICAgYWxlcnQoJ0Vycm9yIGdlbmVyYW5kbyBlbCBFeGNlbDogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xyXG4gIH1cclxufTtcclxuXHJcblxyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XHJcbi8vIFNFQ0NJXHUwMEQzTjogZXhwb3J0QXVkaXRFeGNlbCAoaW5saW5lIEwxMDA0MC0xMDA2NylcclxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XHJcblxyXG53aW5kb3cuZXhwb3J0QXVkaXRFeGNlbCA9IGZ1bmN0aW9uKCl7XHJcbiAgaWYgKHR5cGVvZiBYTFNYID09PSAndW5kZWZpbmVkJykge1xyXG4gICAgYWxlcnQoJ0xhIGxpYnJlcmlhIGRlIEV4Y2VsIG5vIHNlIGNhcmdvLicpO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuICBjb25zdCBpdGVtcyA9IGdldEZpbHRlcmVkQXVkaXRFbnRyaWVzKCk7XHJcbiAgaWYgKCFpdGVtcy5sZW5ndGgpIHsgYWxlcnQoJ05vIGhheSBldmVudG9zIHBhcmEgZXhwb3J0YXIgY29uIGxvcyBmaWx0cm9zIGFwbGljYWRvcy4nKTsgcmV0dXJuOyB9XHJcbiAgY29uc3Qgcm93cyA9IGl0ZW1zLm1hcChlID0+IHtcclxuICAgIGNvbnN0IHRzID0gZS50aW1lc3RhbXAgJiYgZS50aW1lc3RhbXAudG9EYXRlID8gZS50aW1lc3RhbXAudG9EYXRlKCkgOiBudWxsO1xyXG4gICAgcmV0dXJuIHtcclxuICAgICAgRmVjaGFfSG9yYTogdHMgPyB0cy50b0lTT1N0cmluZygpLnJlcGxhY2UoJ1QnLCAnICcpLnNsaWNlKDAsIDE5KSA6ICcnLFxyXG4gICAgICBVc3VhcmlvX0VtYWlsOiBlLnVzZXJFbWFpbCB8fCAnJyxcclxuICAgICAgVXN1YXJpb19VSUQ6IGUudXNlclVpZCB8fCAnJyxcclxuICAgICAgUm9sOiBlLnVzZXJSb2xlIHx8ICcnLFxyXG4gICAgICBBY2Npb246IEFVRElUX0FDVElPTl9MQUJFTFNbZS5hY3Rpb25dIHx8IGUuYWN0aW9uIHx8ICcnLFxyXG4gICAgICBBY2Npb25fUmF3OiBlLmFjdGlvbiB8fCAnJyxcclxuICAgICAgVGlwb19FbnRpZGFkOiBlLmVudGl0eVR5cGUgfHwgJycsXHJcbiAgICAgIEVudGlkYWQ6IGUuZW50aXR5TmFtZSB8fCAnJyxcclxuICAgICAgRGV0YWxsZXNfSlNPTjogZS5kZXRhaWxzID8gSlNPTi5zdHJpbmdpZnkoZS5kZXRhaWxzKSA6ICcnLFxyXG4gICAgfTtcclxuICB9KTtcclxuICBjb25zdCB3YiA9IFhMU1gudXRpbHMuYm9va19uZXcoKTtcclxuICBjb25zdCB3cyA9IFhMU1gudXRpbHMuanNvbl90b19zaGVldChyb3dzKTtcclxuICB3c1snIWNvbHMnXSA9IFt7d2NoOjIwfSx7d2NoOjMwfSx7d2NoOjMwfSx7d2NoOjEwfSx7d2NoOjI0fSx7d2NoOjIwfSx7d2NoOjE0fSx7d2NoOjQwfSx7d2NoOjYwfV07XHJcbiAgWExTWC51dGlscy5ib29rX2FwcGVuZF9zaGVldCh3Yiwgd3MsICdBdWRpdG9yaWEnKTtcclxuICBjb25zdCBzdGFtcCA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKS5zbGljZSgwLCAxMCk7XHJcbiAgWExTWC53cml0ZUZpbGUod2IsICdTaGltYW5vX0F1ZGl0b3JpYV8nICsgc3RhbXAgKyAnLnhsc3gnKTtcclxufTtcclxuXHJcblxyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XHJcbi8vIFNFQ0NJXHUwMEQzTjogYnVpbGRDb250YWN0YWRvc1Jvd3MvT3BzTG9nL1Zpc2l0IChpbmxpbmUgTDEwMDgxLTEwMTU1KVxyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxuXHJcbi8vIExpc3RhIGNvbXBsZXRhIGRlIGNvbnRhY3RhZG9zIChjbGllbnRlcy9wcm9zcGVjdG9zIG1hcmNhZG9zIGNvbiBjaGVjaylcclxuZnVuY3Rpb24gYnVpbGRDb250YWN0YWRvc1Jvd3MoKXtcclxuICBjb25zdCByb3dzID0gW107XHJcbiAgY29udGFjdGVkLmZvckVhY2goa2V5ID0+IHtcclxuICAgIGNvbnN0IHBhcnRzID0ga2V5LnNwbGl0KCd8Jyk7XHJcbiAgICBjb25zdCB0aXBvID0gcGFydHNbMF0sIHByb3ZpbmNlID0gcGFydHNbMV0sIGxvY05hbWUgPSBwYXJ0c1syXSwgY2xpZW50TmFtZSA9IHBhcnRzWzNdO1xyXG4gICAgY29uc3QgcHQgPSBQT0lOVFMuZmluZChwID0+IHAucHJvdmluY2UgPT09IHByb3ZpbmNlICYmIHAubmFtZSA9PT0gbG9jTmFtZSk7XHJcbiAgICBjb25zdCB2ZW5kb3IgPSBwdCA/IHB0LnZlbmRvciA6ICcnO1xyXG4gICAgY29uc3Qgdm0gPSB2ZW5kb3JMb29rdXBbdmVuZG9yXTtcclxuICAgIHJvd3MucHVzaCh7XHJcbiAgICAgIFRpcG86IHRpcG8gPT09ICdDJyA/ICdDbGllbnRlIGFjdHVhbCcgOiAnUHJvc3BlY3RvJyxcclxuICAgICAgQ2xpZW50ZTogY2xpZW50TmFtZSxcclxuICAgICAgUHJvdmluY2lhOiB0aXRsZUNhc2UocHJvdmluY2UpLFxyXG4gICAgICBMb2NhbGlkYWQ6IGxvY05hbWUsXHJcbiAgICAgIERlcGFydGFtZW50bzogcHQgPyAocHQuZGVwdCB8fCAnJykgOiAnJyxcclxuICAgICAgVmVuZGVkb3I6IHRpdGxlQ2FzZSh2ZW5kb3IgfHwgJycpLFxyXG4gICAgICBab25hOiB2bSA/IHZtLnpvbmUgOiAnJyxcclxuICAgICAgQ29udGFjdGFkbzogJ1NpJyxcclxuICAgIH0pO1xyXG4gIH0pO1xyXG4gIHJvd3Muc29ydCgoYSwgYikgPT4gYS5WZW5kZWRvci5sb2NhbGVDb21wYXJlKGIuVmVuZGVkb3IpIHx8IGEuUHJvdmluY2lhLmxvY2FsZUNvbXBhcmUoYi5Qcm92aW5jaWEpIHx8IGEuQ2xpZW50ZS5sb2NhbGVDb21wYXJlKGIuQ2xpZW50ZSkpO1xyXG4gIHJldHVybiByb3dzO1xyXG59XHJcblxyXG4vLyBMb2cgZGUgb3BlcmFjaW9uZXMgKGNhbmNlbGFjaW9uZXMsIGVsaW1pbmFjaW9uZXMsIHZ1ZWx2ZS1hLWJvcnJhZG9yLCBldGMuKVxyXG5mdW5jdGlvbiBidWlsZE9wc0xvZ1Jvd3MoKXtcclxuICByZXR1cm4gKG9wc0xvZ0NhY2hlIHx8IFtdKS5tYXAobyA9PiAoe1xyXG4gICAgRmVjaGE6IG8udGltZXN0YW1wID8gKG8udGltZXN0YW1wLnRvRGF0ZSA/IG8udGltZXN0YW1wLnRvRGF0ZSgpLnRvTG9jYWxlU3RyaW5nKCkgOiBuZXcgRGF0ZShvLnRpbWVzdGFtcCkudG9Mb2NhbGVTdHJpbmcoKSkgOiAnJyxcclxuICAgIFVzdWFyaW86IG8udXNlckVtYWlsIHx8ICcnLFxyXG4gICAgUm9sOiBvLnVzZXJSb2xlIHx8ICcnLFxyXG4gICAgQWNjaW9uOiBvLmFjdGlvbiB8fCAnJyxcclxuICAgICdUaXBvIGVudGlkYWQnOiBvLmVudGl0eVR5cGUgfHwgJycsXHJcbiAgICBFbnRpZGFkOiBvLmVudGl0eU5hbWUgfHwgJycsXHJcbiAgICBEZXRhbGxlczogdHlwZW9mIG8uZGV0YWlscyA9PT0gJ29iamVjdCcgPyBKU09OLnN0cmluZ2lmeShvLmRldGFpbHMpIDogKG8uZGV0YWlscyB8fCAnJyksXHJcbiAgfSkpO1xyXG59XHJcblxyXG5mdW5jdGlvbiBidWlsZFZpc2l0Um93cygpe1xyXG4gIHJldHVybiB2aXNpdHNDYWNoZS5tYXAodiA9PiAoe1xyXG4gICAgRmVjaGE6IHYuZmVjaGEgfHwgJycsXHJcbiAgICBNZXM6IHYubWVzIHx8ICcnLFxyXG4gICAgQW5vOiB2LmFuaW8gfHwgJycsXHJcbiAgICBWZW5kZWRvcjogdGl0bGVDYXNlKHYudmVuZG9yIHx8ICcnKSxcclxuICAgICdUaXBvIGNvbnRhY3RvJzogKHYudGlwb0NvbnRhY3RvID09PSAndGVsZWZvbm8nKSA/ICdUZWxlZm9ubycgOiAnUHJlc2VuY2lhbCcsXHJcbiAgICBDb21lbnRhcmlvOiB2LmNvbWVudGFyaW8gfHwgJycsXHJcbiAgICBQcm92aW5jaWE6IHRpdGxlQ2FzZSh2LnByb3ZpbmNpYSB8fCAnJyksXHJcbiAgICBMb2NhbGlkYWQ6IHYubG9jYWxpZGFkIHx8ICcnLFxyXG4gICAgVGllbmRhOiB2LnRpZW5kYSB8fCAnJyxcclxuICAgICdUaXBvIHRpZW5kYSc6IHYudGlwbyB8fCAnJyxcclxuICAgIExvY2FsOiB2LmxvY2FsIHx8ICcnLFxyXG4gICAgVGFtYW5vOiB2LnRhbWFubyB8fCAnJyxcclxuICAgIEZpZGVsaWRhZDogdi5maWRlbGlkYWQgfHwgJycsXHJcbiAgICAnUmVsZXZhbmNpYSAoMS01KSc6IHYucmVsZXZhbmNpYSB8fCAnJyxcclxuICAgIFBPUDogdi5wb3AgfHwgJycsXHJcbiAgICAnTmVjZXNpZGFkIHB1bnR1YWwnOiAodi5uZWNlc2lkYWRQdW50dWFsID09PSAnTU9TVFJBRE8nID8gJ01PU1RSQURPUicgOiAodi5uZWNlc2lkYWRQdW50dWFsIHx8ICcnKSksXHJcbiAgICAnVGlwbyB2ZW50YSc6ICh2LnRpcG9WZW50YSA9PT0gJ01PU1RSQURPJyA/ICdNT1NUUkFET1InIDogKHYudGlwb1ZlbnRhIHx8ICcnKSksXHJcbiAgICAnJSBNb3N0cmFkb3InOiB2LnBvbmRlcmFjaW9uTW9zdHJhZG8gIT0gbnVsbCA/IHYucG9uZGVyYWNpb25Nb3N0cmFkbyA6ICcnLFxyXG4gICAgJyUgRWNvbW1lcmNlJzogdi5wb25kZXJhY2lvbkVjb21tZXJjZSAhPSBudWxsID8gdi5wb25kZXJhY2lvbkVjb21tZXJjZSA6ICcnLFxyXG4gICAgQ29tcGV0ZW5jaWE6IHYuY29tcGV0ZW5jaWEgfHwgJycsXHJcbiAgICAnQ2F0ZWdvcmlhIGNsaWVudGUnOiB2LmNhdGVnb3JpYUNsaWVudGUgfHwgJycsXHJcbiAgICBPcG9ydHVuaWRhZDogdi5vcG9ydHVuaWRhZCB8fCAnJyxcclxuICAgICdMbyBtYXMgdmVuZGlkbyBTaGltYW5vJzogdi5tYXNWZW5kaWRvIHx8ICcnLFxyXG4gICAgJ0xvIHF1ZSBtYXMgcHJlZ3VudGFuJzogdi5tYXNQcmVndW50YW4gfHwgJycsXHJcbiAgICAnQXl1ZGEgYSB0aWVuZGEnOiB2LmF5dWRhVGllbmRhIHx8ICcnLFxyXG4gICAgJ0ZvdG9zIGVzcGFjaW8gKGNhbnQpJzogKHYuZXNwYWNpbyB8fCBbXSkubGVuZ3RoLFxyXG4gICAgJ0ZvdG8gZnJlbnRlJzogdi5mcmVudGVMb2NhbCA/ICdTaScgOiAnTm8nLFxyXG4gICAgJ0dQUyBlc3RhZG8nOiB2Lmdwc1N0YXR1cyB8fCAnJyxcclxuICAgICdHUFMgZGlzdGFuY2lhIChtKSc6ICh0eXBlb2Ygdi5ncHNEaXN0YW5jZU0gPT09ICdudW1iZXInKSA/IHYuZ3BzRGlzdGFuY2VNIDogJycsXHJcbiAgICAnR1BTIGxhdCc6IHYuZ3BzTGF0ICE9IG51bGwgPyB2Lmdwc0xhdCA6ICcnLFxyXG4gICAgJ0dQUyBsb24nOiB2Lmdwc0xvbiAhPSBudWxsID8gdi5ncHNMb24gOiAnJyxcclxuICAgICdHUFMgcHJlY2lzaW9uIChtKSc6IHYuZ3BzQWNjdXJhY3kgIT0gbnVsbCA/IHYuZ3BzQWNjdXJhY3kgOiAnJyxcclxuICAgICdHUFMgY2FwdHVyYWRvJzogdi5ncHNDYXB0dXJlZEF0IHx8ICcnLFxyXG4gICAgRW1haWw6IHYub3duZXJFbWFpbCB8fCAnJyxcclxuICB9KSk7XHJcbn1cclxuXHJcblxyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XHJcbi8vIFNFQ0NJXHUwMEQzTjogZXhwb3J0RXhlY3V0aXZlL1Zpc2l0cy9Qb3dlckJJL01MIChpbmxpbmUgTDEwMTU4LTEwNDI2KVxyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxuXHJcbndpbmRvdy5leHBvcnRFeGVjdXRpdmUgPSBmdW5jdGlvbigpe1xyXG4gIGNvbnN0IHdiID0gWExTWC51dGlscy5ib29rX25ldygpO1xyXG4gIGNvbnN0IHJvd3MgPSBidWlsZFBlZGlkb0RldGFpbFJvd3MoKTtcclxuICBjb25zdCBjb25mUm93cyA9IHJvd3MuZmlsdGVyKHIgPT4gci5lc3RhZG8gPT09ICdDb25maXJtYWRvJyk7XHJcblxyXG4gIC8vIENvbnNvbGlkYWRvOiB1bmEgZmlsYSBwb3IgdmVuZGVkb3IgY29uIEtQSXNcclxuICBjb25zdCBwZXJWZW5kb3IgPSB7fTtcclxuICBjb25mUm93cy5mb3JFYWNoKHIgPT4ge1xyXG4gICAgY29uc3QgayA9IHIudmVuZGVkb3IgfHwgJ1NpbiBhc2lnbmFyJztcclxuICAgIGlmICghcGVyVmVuZG9yW2tdKSBwZXJWZW5kb3Jba10gPSB7em9uYTogci56b25hLCB1bmlkOjAsIGFyczowLCB1c2Q6MCwgY2xpZW50ZXM6bmV3IFNldCgpLCBwcm9kczpuZXcgU2V0KCksIHByb3ZzOm5ldyBTZXQoKX07XHJcbiAgICBwZXJWZW5kb3Jba10udW5pZCArPSByLmNhbnRpZGFkO1xyXG4gICAgcGVyVmVuZG9yW2tdLmFycyArPSByLnN1YnRvdGFsX2FycztcclxuICAgIHBlclZlbmRvcltrXS51c2QgKz0gci5zdWJ0b3RhbF91c2Q7XHJcbiAgICBwZXJWZW5kb3Jba10uY2xpZW50ZXMuYWRkKHIuY2xpZW50ZSk7XHJcbiAgICBwZXJWZW5kb3Jba10ucHJvZHMuYWRkKHIuY29kaWdvKTtcclxuICAgIHBlclZlbmRvcltrXS5wcm92cy5hZGQoci5wcm92aW5jaWEpO1xyXG4gIH0pO1xyXG4gIGNvbnN0IGNvbnNvbCA9IFtdO1xyXG4gIFZFTkRPUlMuZm9yRWFjaCh2ID0+IHtcclxuICAgIGNvbnN0IHRpdGxlViA9IHRpdGxlQ2FzZSh2LmtleSk7XHJcbiAgICBjb25zdCBkID0gcGVyVmVuZG9yW3RpdGxlVl0gfHwge3pvbmE6IHYuem9uZSwgdW5pZDowLCBhcnM6MCwgdXNkOjAsIGNsaWVudGVzOm5ldyBTZXQoKSwgcHJvZHM6bmV3IFNldCgpLCBwcm92czpuZXcgU2V0KCl9O1xyXG4gICAgY29uc3QgdCA9IFRBUkdFVFNfQllfVkVORE9SW3Yua2V5XSB8fCB7anVsMjAyNl91c2Q6MCwganVsRGljMjAyNl91c2Q6MCwgYW51YWwyMDI3X3VzZDowfTtcclxuICAgIGNvbnNvbC5wdXNoKHtcclxuICAgICAgWm9uYTogdi56b25lLFxyXG4gICAgICBWZW5kZWRvcjogdGl0bGVWLFxyXG4gICAgICBQcm92aW5jaWFzOiBkLnByb3ZzLnNpemUsXHJcbiAgICAgICdDbGllbnRlcyBhY3Rpdm9zJzogZC5jbGllbnRlcy5zaXplLFxyXG4gICAgICAnUHJvZHVjdG9zIGRpc3RpbnRvcyc6IGQucHJvZHMuc2l6ZSxcclxuICAgICAgVW5pZGFkZXM6IGQudW5pZCxcclxuICAgICAgJ0ZhY3R1cmFkbyBBUlMnOiBNYXRoLnJvdW5kKGQuYXJzKSxcclxuICAgICAgJ0ZhY3R1cmFkbyBVU0QnOiBNYXRoLnJvdW5kKGQudXNkKSxcclxuICAgICAgJ1RhcmdldCBKdWwgMjAyNiBVU0QnOiB0Lmp1bDIwMjZfdXNkLFxyXG4gICAgICAnVGFyZ2V0IEp1bC1EaWMgMjAyNiBVU0QnOiB0Lmp1bERpYzIwMjZfdXNkLFxyXG4gICAgICAnVGFyZ2V0IDIwMjcgVVNEJzogdC5hbnVhbDIwMjdfdXNkLFxyXG4gICAgfSk7XHJcbiAgfSk7XHJcbiAgY29uc3Qgd3NDID0gWExTWC51dGlscy5qc29uX3RvX3NoZWV0KGNvbnNvbCk7XHJcbiAgd3NDWychY29scyddID0gW3t3Y2g6Nn0se3djaDoyNH0se3djaDoxMX0se3djaDoxNH0se3djaDoxNn0se3djaDoxMX0se3djaDoxNn0se3djaDoxNn0se3djaDoxOH0se3djaDoyMH0se3djaDoxOH1dO1xyXG4gIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQod2IsIHdzQywgJ0NvbnNvbGlkYWRvJyk7XHJcblxyXG4gIC8vIFVuYSBob2phIHBvciB2ZW5kZWRvciBjb24gc3UgZGV0YWxsZSBkZSBwZWRpZG9zIGNvbmZpcm1hZG9zXHJcbiAgVkVORE9SUy5mb3JFYWNoKHYgPT4ge1xyXG4gICAgY29uc3QgdGl0bGVWID0gdGl0bGVDYXNlKHYua2V5KTtcclxuICAgIGNvbnN0IHZyb3dzID0gY29uZlJvd3MuZmlsdGVyKHIgPT4gci52ZW5kZWRvciA9PT0gdGl0bGVWKS5tYXAociA9PiAoe1xyXG4gICAgICBGZWNoYTogci5mZWNoYSwgTWVzOiByLm1lc19wZWRpZG8sIFByb3ZpbmNpYTogci5wcm92aW5jaWEsIExvY2FsaWRhZDogci5sb2NhbGlkYWQsXHJcbiAgICAgIENsaWVudGU6IHIuY2xpZW50ZSwgVGlwbzogci50aXBvX2NsaWVudGUsXHJcbiAgICAgIENvZGlnbzogci5jb2RpZ28sIFByb2R1Y3RvOiByLnByb2R1Y3RvLCBDYXRlZ29yaWE6IHIuY2F0ZWdvcmlhLCBGYW1pbGlhOiByLmZhbWlsaWEsIFN1YmZhbWlsaWE6IHIuc3ViZmFtaWxpYSxcclxuICAgICAgQ2FudGlkYWQ6IHIuY2FudGlkYWQsICdQcmVjaW8gQVJTJzogci5wcmVjaW9fdW5pdF9hcnMsICdTdWJ0b3RhbCBBUlMnOiByLnN1YnRvdGFsX2FycywgJ1N1YnRvdGFsIFVTRCc6IHIuc3VidG90YWxfdXNkLFxyXG4gICAgfSkpO1xyXG4gICAgdnJvd3Muc29ydCgoYSxiKSA9PiAoYS5GZWNoYXx8JycpLmxvY2FsZUNvbXBhcmUoYi5GZWNoYXx8JycpIHx8IGEuQ2xpZW50ZS5sb2NhbGVDb21wYXJlKGIuQ2xpZW50ZSkpO1xyXG4gICAgaWYgKCF2cm93cy5sZW5ndGgpIHZyb3dzLnB1c2goe0ZlY2hhOicnLCBNZXM6JycsIFByb3ZpbmNpYTonJywgTG9jYWxpZGFkOicnLCBDbGllbnRlOicoc2luIHBlZGlkb3MgY29uZmlybWFkb3MpJywgVGlwbzonJywgQ29kaWdvOicnLCBQcm9kdWN0bzonJywgQ2F0ZWdvcmlhOicnLCBGYW1pbGlhOicnLCBTdWJmYW1pbGlhOicnLCBDYW50aWRhZDowLCAnUHJlY2lvIEFSUyc6MCwgJ1N1YnRvdGFsIEFSUyc6MCwgJ1N1YnRvdGFsIFVTRCc6MH0pO1xyXG4gICAgY29uc3Qgd3MgPSBYTFNYLnV0aWxzLmpzb25fdG9fc2hlZXQodnJvd3MpO1xyXG4gICAgd3NbJyFjb2xzJ10gPSBbe3djaDoxMX0se3djaDoxNH0se3djaDoxOH0se3djaDoyMn0se3djaDozMH0se3djaDoxMX0se3djaDoxNH0se3djaDozOH0se3djaDoxNH0se3djaDoxOH0se3djaDoxOH0se3djaDoxMH0se3djaDoxMn0se3djaDoxNH0se3djaDoxNH1dO1xyXG4gICAgWExTWC51dGlscy5ib29rX2FwcGVuZF9zaGVldCh3Yiwgd3MsICh2LnpvbmUgKyAnICcgKyB0aXRsZVYpLnN1YnN0cmluZygwLCAzMSkucmVwbGFjZSgvW1xcXFwvXFwqXFw/XFxbXFxdOl0vZywnJykpO1xyXG4gIH0pO1xyXG5cclxuICAvLyBWaXNpdGFzXHJcbiAgY29uc3QgdmlzaXRSb3dzID0gYnVpbGRWaXNpdFJvd3MoKTtcclxuICBpZiAodmlzaXRSb3dzLmxlbmd0aCkge1xyXG4gICAgY29uc3Qgd3NWID0gWExTWC51dGlscy5qc29uX3RvX3NoZWV0KHZpc2l0Um93cyk7XHJcbiAgICBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KHdiLCB3c1YsICdWaXNpdGFzJyk7XHJcbiAgfVxyXG4gIC8vIENvbnRhY3RhZG9zICh0b2RvcyBsb3MgY2xpZW50ZXMvcHJvc3BlY3RvcyBtYXJjYWRvcyBjb24gY2hlY2spXHJcbiAgY29uc3QgY29udGFjdFJvd3MgPSBidWlsZENvbnRhY3RhZG9zUm93cygpO1xyXG4gIGlmIChjb250YWN0Um93cy5sZW5ndGgpIHtcclxuICAgIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQod2IsIFhMU1gudXRpbHMuanNvbl90b19zaGVldChjb250YWN0Um93cyksICdDb250YWN0YWRvcycpO1xyXG4gIH1cclxuICAvLyBMb2cgZGUgb3BlcmFjaW9uZXMgKGNhbmNlbGFjaW9uZXMsIGVsaW1pbmFjaW9uZXMsIGV0Yy4pXHJcbiAgY29uc3Qgb3BzUm93cyA9IGJ1aWxkT3BzTG9nUm93cygpO1xyXG4gIGlmIChvcHNSb3dzLmxlbmd0aCkge1xyXG4gICAgWExTWC51dGlscy5ib29rX2FwcGVuZF9zaGVldCh3YiwgWExTWC51dGlscy5qc29uX3RvX3NoZWV0KG9wc1Jvd3MpLCAnTG9nIE9wZXJhY2lvbmVzJyk7XHJcbiAgfVxyXG5cclxuICBYTFNYLndyaXRlRmlsZSh3YiwgJ1NoaW1hbm9fRWplY3V0aXZvXycgKyB0b2RheVN0cigpICsgJy54bHN4Jyk7XHJcbn07XHJcblxyXG4vLyAtLS0tLS0tLS0tIEV4Y2VsIGRlIFZpc2l0YXMgKGZvcm1hdG8gc3RhbmRhbG9uZSkgLS0tLS0tLS0tLVxyXG53aW5kb3cuZXhwb3J0VmlzaXRzRXhjZWwgPSBmdW5jdGlvbigpe1xyXG4gIGlmICh0eXBlb2YgWExTWCA9PT0gJ3VuZGVmaW5lZCcpIHtcclxuICAgIGFsZXJ0KCdMYSBsaWJyZXJpYSBkZSBFeGNlbCBubyBzZSBjYXJnby4gVmVyaWZpcXVlIHN1IGNvbmV4aW9uIGEgaW50ZXJuZXQgeSByZWludGVudGUuJyk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIGNvbnN0IHZpc2l0Um93cyA9IGJ1aWxkVmlzaXRSb3dzKCk7XHJcbiAgaWYgKCF2aXNpdFJvd3MubGVuZ3RoKSB7XHJcbiAgICBhbGVydCgnTm8gaGF5IHZpc2l0YXMgcmVnaXN0cmFkYXMgdG9kYXZpYS4gQ3VhbmRvIHNlIGNhcmd1ZSBhbCBtZW5vcyB1bmEsIHZhcyBhIHBvZGVyIGV4cG9ydGFybGEuJyk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIGNvbnN0IHdiID0gWExTWC51dGlscy5ib29rX25ldygpO1xyXG5cclxuICAvLyBIb2phIHByaW5jaXBhbDogVmlzaXRhcyAodG9kYXMgbGFzIGZpbGFzKVxyXG4gIGNvbnN0IHdzID0gWExTWC51dGlscy5qc29uX3RvX3NoZWV0KHZpc2l0Um93cyk7XHJcbiAgd3NbJyFjb2xzJ10gPSBbXHJcbiAgICB7d2NoOjEyfSx7d2NoOjE0fSx7d2NoOjh9LHt3Y2g6MjR9LHt3Y2g6MTh9LHt3Y2g6MjJ9LHt3Y2g6MzB9LHt3Y2g6MTh9LFxyXG4gICAge3djaDoxNH0se3djaDoxNH0se3djaDoxNH0se3djaDoxNn0se3djaDo4fSx7d2NoOjIyfSx7d2NoOjE0fSxcclxuICAgIHt3Y2g6MTR9LHt3Y2g6MTR9LHt3Y2g6MTh9LHt3Y2g6MTh9LHt3Y2g6MzJ9LHt3Y2g6MzJ9LHt3Y2g6MzJ9LHt3Y2g6MzJ9LFxyXG4gICAge3djaDoxOH0se3djaDoxNH0se3djaDoyNH0sXHJcbiAgXTtcclxuICBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KHdiLCB3cywgJ1Zpc2l0YXMnKTtcclxuXHJcbiAgLy8gSG9qYSByZXN1bWVuIHBvciB2ZW5kZWRvcjogY2FudGlkYWQgZGUgdmlzaXRhcyB5IHRpZW5kYXMgdW5pY2FzXHJcbiAgY29uc3QgcGVyVmVuZG9yID0ge307XHJcbiAgdmlzaXRzQ2FjaGUuZm9yRWFjaCh2ID0+IHtcclxuICAgIGNvbnN0IGsgPSB0aXRsZUNhc2Uodi52ZW5kb3IgfHwgJ1NpbiBhc2lnbmFyJyk7XHJcbiAgICBpZiAoIXBlclZlbmRvcltrXSkgcGVyVmVuZG9yW2tdID0ge3Zpc2l0YXM6IDAsIHRpZW5kYXM6IG5ldyBTZXQoKSwgbG9jYWxpZGFkZXM6IG5ldyBTZXQoKSwgcHJvdmluY2lhczogbmV3IFNldCgpfTtcclxuICAgIHBlclZlbmRvcltrXS52aXNpdGFzKys7XHJcbiAgICBpZiAodi50aWVuZGEpIHBlclZlbmRvcltrXS50aWVuZGFzLmFkZCh2LnRpZW5kYSk7XHJcbiAgICBpZiAodi5sb2NhbGlkYWQpIHBlclZlbmRvcltrXS5sb2NhbGlkYWRlcy5hZGQodi5sb2NhbGlkYWQpO1xyXG4gICAgaWYgKHYucHJvdmluY2lhKSBwZXJWZW5kb3Jba10ucHJvdmluY2lhcy5hZGQodi5wcm92aW5jaWEpO1xyXG4gIH0pO1xyXG4gIGNvbnN0IHJlc3VtZW4gPSBPYmplY3QuZW50cmllcyhwZXJWZW5kb3IpLm1hcCgoW3ZlbmRlZG9yLCBkXSkgPT4gKHtcclxuICAgIFZlbmRlZG9yOiB2ZW5kZWRvcixcclxuICAgICdWaXNpdGFzIHRvdGFsZXMnOiBkLnZpc2l0YXMsXHJcbiAgICAnVGllbmRhcyBkaXN0aW50YXMnOiBkLnRpZW5kYXMuc2l6ZSxcclxuICAgICdMb2NhbGlkYWRlcyBkaXN0aW50YXMnOiBkLmxvY2FsaWRhZGVzLnNpemUsXHJcbiAgICAnUHJvdmluY2lhcyBkaXN0aW50YXMnOiBkLnByb3ZpbmNpYXMuc2l6ZSxcclxuICB9KSkuc29ydCgoYSwgYikgPT4gYlsnVmlzaXRhcyB0b3RhbGVzJ10gLSBhWydWaXNpdGFzIHRvdGFsZXMnXSk7XHJcbiAgaWYgKHJlc3VtZW4ubGVuZ3RoKSB7XHJcbiAgICBjb25zdCB3c1IgPSBYTFNYLnV0aWxzLmpzb25fdG9fc2hlZXQocmVzdW1lbik7XHJcbiAgICB3c1JbJyFjb2xzJ10gPSBbe3djaDoyNH0se3djaDoxNn0se3djaDoxOH0se3djaDoyMn0se3djaDoyMn1dO1xyXG4gICAgWExTWC51dGlscy5ib29rX2FwcGVuZF9zaGVldCh3Yiwgd3NSLCAnUmVzdW1lbiBwb3IgdmVuZGVkb3InKTtcclxuICB9XHJcblxyXG4gIFhMU1gud3JpdGVGaWxlKHdiLCAnU2hpbWFub19WaXNpdGFzXycgKyB0b2RheVN0cigpICsgJy54bHN4Jyk7XHJcbn07XHJcblxyXG4vLyAtLS0tLS0tLS0tIE9QQ0lPTiBCOiBQb3dlciBCSSAoRmFjdCArIERpbSkgLS0tLS0tLS0tLVxyXG53aW5kb3cuZXhwb3J0UG93ZXJCSSA9IGZ1bmN0aW9uKCl7XHJcbiAgY29uc3Qgd2IgPSBYTFNYLnV0aWxzLmJvb2tfbmV3KCk7XHJcbiAgY29uc3Qgcm93cyA9IGJ1aWxkUGVkaWRvRGV0YWlsUm93cygpO1xyXG5cclxuICAvLyBGYWN0X1BlZGlkb3NcclxuICBjb25zdCBmYWN0Um93cyA9IHJvd3MuZmlsdGVyKHIgPT4gci5lc3RhZG8gIT09ICdCb3JyYWRvcicpO1xyXG4gIGNvbnN0IHdzRiA9IFhMU1gudXRpbHMuanNvbl90b19zaGVldChmYWN0Um93cy5tYXAociA9PiAoe1xyXG4gICAgbGluZV9pZDogci5saW5lX2lkLFxyXG4gICAgZmVjaGE6IHIuZmVjaGEsXHJcbiAgICBlc3RhZG86IHIuZXN0YWRvLFxyXG4gICAgdmVuZGVkb3Jfa2V5OiByLnZlbmRlZG9yX2tleSxcclxuICAgIHpvbmE6IHIuem9uYSxcclxuICAgIHByb3ZpbmNpYTogci5wcm92aW5jaWEsXHJcbiAgICBsb2NhbGlkYWQ6IHIubG9jYWxpZGFkLFxyXG4gICAgY2xpZW50ZTogci5jbGllbnRlLFxyXG4gICAgdGlwb19jbGllbnRlOiByLnRpcG9fY2xpZW50ZSxcclxuICAgIHNrdTogci5jb2RpZ28sXHJcbiAgICBjYW50aWRhZDogci5jYW50aWRhZCxcclxuICAgIHByZWNpb191bml0X2Fyczogci5wcmVjaW9fdW5pdF9hcnMsXHJcbiAgICBzdWJ0b3RhbF9hcnM6IHIuc3VidG90YWxfYXJzLFxyXG4gICAgc3VidG90YWxfdXNkOiByLnN1YnRvdGFsX3VzZCxcclxuICB9KSkpO1xyXG4gIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQod2IsIHdzRiwgJ0ZhY3RfUGVkaWRvcycpO1xyXG5cclxuICAvLyBEaW1fVmVuZGVkb3JcclxuICBjb25zdCBkaW1WID0gVkVORE9SUy5tYXAodiA9PiB7XHJcbiAgICBjb25zdCB0ID0gVEFSR0VUU19CWV9WRU5ET1Jbdi5rZXldIHx8IHt9O1xyXG4gICAgcmV0dXJuIHtcclxuICAgICAgdmVuZGVkb3Jfa2V5OiB2LmtleSxcclxuICAgICAgdmVuZGVkb3Jfbm9tYnJlOiB0aXRsZUNhc2Uodi5rZXkpLFxyXG4gICAgICB6b25hOiB2LnpvbmUsXHJcbiAgICAgIHpvbmFfZGVzY3JpcGNpb246IHYubGFiZWwsXHJcbiAgICAgIGNvbG9yOiB2LmNvbG9yLFxyXG4gICAgICB0YXJnZXRfanVsMjAyNl91c2Q6IHQuanVsMjAyNl91c2QgfHwgMCxcclxuICAgICAgdGFyZ2V0X2p1bERpYzIwMjZfdXNkOiB0Lmp1bERpYzIwMjZfdXNkIHx8IDAsXHJcbiAgICAgIHRhcmdldF8yMDI3X3VzZDogdC5hbnVhbDIwMjdfdXNkIHx8IDAsXHJcbiAgICB9O1xyXG4gIH0pO1xyXG4gIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQod2IsIFhMU1gudXRpbHMuanNvbl90b19zaGVldChkaW1WKSwgJ0RpbV9WZW5kZWRvcicpO1xyXG5cclxuICAvLyBEaW1fUHJvZHVjdG9cclxuICBjb25zdCBkaW1QID0gUFJPRFVDVFMubWFwKHAgPT4gKHtza3U6IHAuY29kZSwgZGVzY3JpcGNpb246IHAuZGVzYywgY2F0ZWdvcmlhOiBwLmNhdCwgZmFtaWxpYTogcC5mYW0sIHN1YmZhbWlsaWE6IHAuc3VifSkpO1xyXG4gIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQod2IsIFhMU1gudXRpbHMuanNvbl90b19zaGVldChkaW1QKSwgJ0RpbV9Qcm9kdWN0bycpO1xyXG5cclxuICAvLyBEaW1fQ2xpZW50ZSAodW5pdmVyc28pXHJcbiAgY29uc3QgZGltQyA9IFtdO1xyXG4gIFBPSU5UUy5mb3JFYWNoKHAgPT4ge1xyXG4gICAgY29uc3Qgdm0gPSB2ZW5kb3JMb29rdXBbcC52ZW5kb3JdO1xyXG4gICAgcC5jbGllbnRzLmZvckVhY2gobiA9PiBkaW1DLnB1c2goe2NsaWVudGU6IG4sIHRpcG86ICdDbGllbnRlIGFjdHVhbCcsIHByb3ZpbmNpYTogdGl0bGVDYXNlKHAucHJvdmluY2UpLCBsb2NhbGlkYWQ6IHAubmFtZSwgZGVwYXJ0YW1lbnRvOiBwLmRlcHQgfHwgJycsIHZlbmRlZG9yX2tleTogcC52ZW5kb3IgfHwgJycsIHpvbmE6IHZtID8gdm0uem9uZSA6ICcnfSkpO1xyXG4gICAgcC5wcm9zcGVjdHMuZm9yRWFjaChuID0+IGRpbUMucHVzaCh7Y2xpZW50ZTogbiwgdGlwbzogJ1Byb3NwZWN0bycsIHByb3ZpbmNpYTogdGl0bGVDYXNlKHAucHJvdmluY2UpLCBsb2NhbGlkYWQ6IHAubmFtZSwgZGVwYXJ0YW1lbnRvOiBwLmRlcHQgfHwgJycsIHZlbmRlZG9yX2tleTogcC52ZW5kb3IgfHwgJycsIHpvbmE6IHZtID8gdm0uem9uZSA6ICcnfSkpO1xyXG4gIH0pO1xyXG4gIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQod2IsIFhMU1gudXRpbHMuanNvbl90b19zaGVldChkaW1DKSwgJ0RpbV9DbGllbnRlJyk7XHJcblxyXG4gIC8vIERpbV9DYWxlbmRhcmlvIChmZWNoYXMgZGlzdGludGFzIGVuIGxvcyBwZWRpZG9zICsgc2VyaWUgY29udGludWEgZGVsIGFcdTAwRjFvIGFjdHVhbClcclxuICBjb25zdCBjYWxTZXQgPSBuZXcgU2V0KCk7XHJcbiAgZmFjdFJvd3MuZm9yRWFjaChyID0+IHsgaWYgKHIuZmVjaGEpIGNhbFNldC5hZGQoci5mZWNoYSk7IH0pO1xyXG4gIC8vIENvbXBsZXRhciBkZXNkZSAyMDI2LTAxLTAxIGhhc3RhIGhveSArIDM2NVxyXG4gIGNvbnN0IHN0YXJ0ID0gbmV3IERhdGUoJzIwMjYtMDEtMDEnKTtcclxuICBjb25zdCBlbmQgPSBuZXcgRGF0ZSgpOyBlbmQuc2V0RGF0ZShlbmQuZ2V0RGF0ZSgpICsgMzY1KTtcclxuICBmb3IgKGxldCBkID0gbmV3IERhdGUoc3RhcnQpOyBkIDw9IGVuZDsgZC5zZXREYXRlKGQuZ2V0RGF0ZSgpKzEpKSBjYWxTZXQuYWRkKGQudG9JU09TdHJpbmcoKS5zbGljZSgwLDEwKSk7XHJcbiAgY29uc3QgZGltQ2FsID0gWy4uLmNhbFNldF0uc29ydCgpLm1hcChkdCA9PiB7XHJcbiAgICBjb25zdCBbeSxtLGRhXSA9IGR0LnNwbGl0KCctJykubWFwKHggPT4gcGFyc2VJbnQoeCkpO1xyXG4gICAgY29uc3QgZGF0ZU9iaiA9IG5ldyBEYXRlKHksIG0tMSwgZGEpO1xyXG4gICAgcmV0dXJuIHtmZWNoYTogZHQsIHllYXI6IHksIG1vbnRoOiBtLCBkYXk6IGRhLCBxdWFydGVyOiAnUScgKyAoTWF0aC5mbG9vcigobS0xKS8zKSsxKSwgbW9udGhfbmFtZTogTUVTRVNbbS0xXSwgeWVhcl9tb250aDogeSArICctJyArIFN0cmluZyhtKS5wYWRTdGFydCgyLCcwJyksIGRheV9vZl93ZWVrOiBbJ0RvbScsJ0x1bicsJ01hcicsJ01pZScsJ0p1ZScsJ1ZpZScsJ1NhYiddW2RhdGVPYmouZ2V0RGF5KCldfTtcclxuICB9KTtcclxuICBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KHdiLCBYTFNYLnV0aWxzLmpzb25fdG9fc2hlZXQoZGltQ2FsKSwgJ0RpbV9DYWxlbmRhcmlvJyk7XHJcblxyXG4gIC8vIERpbV9DYW1wYW5pYVxyXG4gIGNvbnN0IGRpbUNtcCA9IGNhbXBhaWduc0NhY2hlLm1hcChjID0+ICh7Y2FtcGFuaWFfaWQ6IGMuaWQsIG5vbWJyZTogYy5uYW1lLCBmaWx0ZXJfdHlwZTogYy5maWx0ZXJUeXBlLCBmaWx0ZXJfdmFsdWVzOiAoYy5maWx0ZXJWYWx1ZXN8fFtdKS5qb2luKCcsICcpLCB0YXJnZXRfdHlwZTogYy50YXJnZXRUeXBlLCB0YXJnZXRfYW1vdW50OiBjLnRhcmdldEFtb3VudCwgZGVzZGU6IGMuc3RhcnREYXRlLCBoYXN0YTogYy5lbmREYXRlfSkpO1xyXG4gIGlmIChkaW1DbXAubGVuZ3RoKSBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KHdiLCBYTFNYLnV0aWxzLmpzb25fdG9fc2hlZXQoZGltQ21wKSwgJ0RpbV9DYW1wYW5pYScpO1xyXG5cclxuICAvLyBQYXJhbXMgKHRpcG8gZGUgY2FtYmlvLCBmZWNoYSBleHBvcnQsIHZlcnNpb24pXHJcbiAgWExTWC51dGlscy5ib29rX2FwcGVuZF9zaGVldCh3YiwgWExTWC51dGlscy5qc29uX3RvX3NoZWV0KFtcclxuICAgIHtwYXJhbWV0cm86ICdleGNoYW5nZV9yYXRlX2Fyc191c2QnLCB2YWxvcjogRVhDSEFOR0VfUkFURX0sXHJcbiAgICB7cGFyYW1ldHJvOiAnZmVjaGFfZXhwb3J0JywgdmFsb3I6IHRvZGF5U3RyKCl9LFxyXG4gICAge3BhcmFtZXRybzogJ3RvdGFsX2ZpbGFzX2ZhY3QnLCB2YWxvcjogZmFjdFJvd3MubGVuZ3RofSxcclxuICBdKSwgJ1BhcmFtZXRyb3MnKTtcclxuXHJcbiAgLy8gRmFjdF9WaXNpdGFzXHJcbiAgY29uc3QgdmlzaXRSb3dzQiA9IGJ1aWxkVmlzaXRSb3dzKCk7XHJcbiAgaWYgKHZpc2l0Um93c0IubGVuZ3RoKSBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KHdiLCBYTFNYLnV0aWxzLmpzb25fdG9fc2hlZXQodmlzaXRSb3dzQiksICdGYWN0X1Zpc2l0YXMnKTtcclxuICAvLyBDb250YWN0YWRvc1xyXG4gIGNvbnN0IGNvbnRhY3RSb3dzQiA9IGJ1aWxkQ29udGFjdGFkb3NSb3dzKCk7XHJcbiAgaWYgKGNvbnRhY3RSb3dzQi5sZW5ndGgpIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQod2IsIFhMU1gudXRpbHMuanNvbl90b19zaGVldChjb250YWN0Um93c0IpLCAnQ29udGFjdGFkb3MnKTtcclxuICAvLyBMb2cgZGUgb3BlcmFjaW9uZXNcclxuICBjb25zdCBvcHNSb3dzQiA9IGJ1aWxkT3BzTG9nUm93cygpO1xyXG4gIGlmIChvcHNSb3dzQi5sZW5ndGgpIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQod2IsIFhMU1gudXRpbHMuanNvbl90b19zaGVldChvcHNSb3dzQiksICdMb2dfT3BlcmFjaW9uZXMnKTtcclxuXHJcbiAgWExTWC53cml0ZUZpbGUod2IsICdTaGltYW5vX1Bvd2VyQklfJyArIHRvZGF5U3RyKCkgKyAnLnhsc3gnKTtcclxufTtcclxuXHJcbi8vIC0tLS0tLS0tLS0gT1BDSU9OIEM6IFB5dGhvbiAvIElBIC8gTUwgKHNpbmdsZSBsb25nLWZvcm1hdCB0YWJsZSkgLS0tLS0tLS0tLVxyXG53aW5kb3cuZXhwb3J0TUwgPSBmdW5jdGlvbigpe1xyXG4gIGNvbnN0IHdiID0gWExTWC51dGlscy5ib29rX25ldygpO1xyXG4gIGNvbnN0IHJvd3MgPSBidWlsZFBlZGlkb0RldGFpbFJvd3MoKTtcclxuICAvLyBtYXN0ZXJfbWw6IHVuYSBmaWxhIHBvciBsaW5lYSBjb24gVE9EQVMgbGFzIGZlYXR1cmVzXHJcbiAgY29uc3Qgd3MgPSBYTFNYLnV0aWxzLmpzb25fdG9fc2hlZXQocm93cyk7XHJcbiAgd3NbJyFjb2xzJ10gPSBPYmplY3Qua2V5cyhyb3dzWzBdIHx8IHtmZWNoYTonJ30pLm1hcCgoKSA9PiAoe3djaDoxNH0pKTtcclxuICBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KHdiLCB3cywgJ21hc3Rlcl9tbCcpO1xyXG5cclxuICAvLyBjYXRhbG9nbyB5IHVuaXZlcnNvIGRlIGNsaWVudGVzIGNvbW8gcmVmZXJlbmNpYXMgcGFyYSBlbnJpcXVlY2VyIGVuIHBhbmRhc1xyXG4gIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQod2IsIFhMU1gudXRpbHMuanNvbl90b19zaGVldChQUk9EVUNUUy5tYXAocCA9PiAoe2NvZGU6IHAuY29kZSwgZGVzYzogcC5kZXNjLCBjYXQ6IHAuY2F0LCBmYW06IHAuZmFtLCBzdWI6IHAuc3VifSkpKSwgJ3Byb2R1Y3Rvc19jYXRhbG9nbycpO1xyXG5cclxuICBjb25zdCB1bml2ZXJzZSA9IFtdO1xyXG4gIFBPSU5UUy5mb3JFYWNoKHAgPT4ge1xyXG4gICAgY29uc3Qgdm0gPSB2ZW5kb3JMb29rdXBbcC52ZW5kb3JdO1xyXG4gICAgcC5jbGllbnRzLmZvckVhY2gobiA9PiB1bml2ZXJzZS5wdXNoKHtjbGllbnRlOiBuLCB0aXBvOiAnY2xpZW50ZV9hY3R1YWwnLCBwcm92aW5jaWE6IHRpdGxlQ2FzZShwLnByb3ZpbmNlKSwgbG9jYWxpZGFkOiBwLm5hbWUsIGRlcGFydGFtZW50bzogcC5kZXB0IHx8ICcnLCB2ZW5kZWRvcjogdGl0bGVDYXNlKHAudmVuZG9yIHx8ICcnKSwgem9uYTogdm0gPyB2bS56b25lIDogJycsIGxhdDogcC5sYXQsIGxvbjogcC5sb259KSk7XHJcbiAgICBwLnByb3NwZWN0cy5mb3JFYWNoKG4gPT4gdW5pdmVyc2UucHVzaCh7Y2xpZW50ZTogbiwgdGlwbzogJ3Byb3NwZWN0bycsIHByb3ZpbmNpYTogdGl0bGVDYXNlKHAucHJvdmluY2UpLCBsb2NhbGlkYWQ6IHAubmFtZSwgZGVwYXJ0YW1lbnRvOiBwLmRlcHQgfHwgJycsIHZlbmRlZG9yOiB0aXRsZUNhc2UocC52ZW5kb3IgfHwgJycpLCB6b25hOiB2bSA/IHZtLnpvbmUgOiAnJywgbGF0OiBwLmxhdCwgbG9uOiBwLmxvbn0pKTtcclxuICB9KTtcclxuICBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KHdiLCBYTFNYLnV0aWxzLmpzb25fdG9fc2hlZXQodW5pdmVyc2UpLCAndW5pdmVyc29fY2xpZW50ZXMnKTtcclxuXHJcbiAgLy8gdGFyZ2V0cyBjb21vIHRhYmxhIGxvbmdcclxuICBjb25zdCB0YXJnZXRzTG9uZyA9IFtdO1xyXG4gIE9iamVjdC5lbnRyaWVzKFRBUkdFVFNfQllfVkVORE9SKS5mb3JFYWNoKChbdmVuZG9yLCB0XSkgPT4ge1xyXG4gICAgdGFyZ2V0c0xvbmcucHVzaCh7dmVuZGVkb3I6IHRpdGxlQ2FzZSh2ZW5kb3IpLCBwZXJpb2RvOiAnSnVsIDIwMjYnLCBzdGFydF9kYXRlOiAnMjAyNi0wNy0wMScsIGVuZF9kYXRlOiAnMjAyNi0wNy0zMScsIHRhcmdldF91c2Q6IHQuanVsMjAyNl91c2QgfHwgMH0pO1xyXG4gICAgdGFyZ2V0c0xvbmcucHVzaCh7dmVuZGVkb3I6IHRpdGxlQ2FzZSh2ZW5kb3IpLCBwZXJpb2RvOiAnSnVsLURpYyAyMDI2Jywgc3RhcnRfZGF0ZTogJzIwMjYtMDctMDEnLCBlbmRfZGF0ZTogJzIwMjYtMTItMzEnLCB0YXJnZXRfdXNkOiB0Lmp1bERpYzIwMjZfdXNkIHx8IDB9KTtcclxuICAgIHRhcmdldHNMb25nLnB1c2goe3ZlbmRlZG9yOiB0aXRsZUNhc2UodmVuZG9yKSwgcGVyaW9kbzogJzIwMjcnLCBzdGFydF9kYXRlOiAnMjAyNy0wMS0wMScsIGVuZF9kYXRlOiAnMjAyNy0xMi0zMScsIHRhcmdldF91c2Q6IHQuYW51YWwyMDI3X3VzZCB8fCAwfSk7XHJcbiAgfSk7XHJcbiAgWExTWC51dGlscy5ib29rX2FwcGVuZF9zaGVldCh3YiwgWExTWC51dGlscy5qc29uX3RvX3NoZWV0KHRhcmdldHNMb25nKSwgJ3RhcmdldHNfbG9uZycpO1xyXG5cclxuICAvLyBjYW1wYVx1MDBGMWFzXHJcbiAgaWYgKGNhbXBhaWduc0NhY2hlLmxlbmd0aCkge1xyXG4gICAgWExTWC51dGlscy5ib29rX2FwcGVuZF9zaGVldCh3YiwgWExTWC51dGlscy5qc29uX3RvX3NoZWV0KGNhbXBhaWduc0NhY2hlLm1hcChjID0+ICh7aWQ6IGMuaWQsIG5vbWJyZTogYy5uYW1lLCBmaWx0ZXJfdHlwZTogYy5maWx0ZXJUeXBlLCBmaWx0ZXJfdmFsdWVzOiAoYy5maWx0ZXJWYWx1ZXN8fFtdKS5qb2luKCcsJyksIHRhcmdldF90eXBlOiBjLnRhcmdldFR5cGUsIHRhcmdldF9hbW91bnQ6IGMudGFyZ2V0QW1vdW50LCBzdGFydF9kYXRlOiBjLnN0YXJ0RGF0ZSwgZW5kX2RhdGU6IGMuZW5kRGF0ZX0pKSksICdjYW1wYW5pYXMnKTtcclxuICB9XHJcblxyXG4gIC8vIHBhcmFtZXRyb3NcclxuICBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KHdiLCBYTFNYLnV0aWxzLmpzb25fdG9fc2hlZXQoW1xyXG4gICAge3BhcmFtZXRybzogJ2V4Y2hhbmdlX3JhdGVfYXJzX3VzZCcsIHZhbG9yOiBFWENIQU5HRV9SQVRFfSxcclxuICAgIHtwYXJhbWV0cm86ICdmZWNoYV9leHBvcnQnLCB2YWxvcjogbmV3IERhdGUoKS50b0lTT1N0cmluZygpfSxcclxuICBdKSwgJ3BhcmFtZXRyb3MnKTtcclxuXHJcbiAgLy8gdmlzaXRhc1xyXG4gIGNvbnN0IHZpc2l0Um93c0MgPSBidWlsZFZpc2l0Um93cygpO1xyXG4gIGlmICh2aXNpdFJvd3NDLmxlbmd0aCkgWExTWC51dGlscy5ib29rX2FwcGVuZF9zaGVldCh3YiwgWExTWC51dGlscy5qc29uX3RvX3NoZWV0KHZpc2l0Um93c0MpLCAndmlzaXRhcycpO1xyXG4gIC8vIGNvbnRhY3RhZG9zXHJcbiAgY29uc3QgY29udGFjdFJvd3NDID0gYnVpbGRDb250YWN0YWRvc1Jvd3MoKTtcclxuICBpZiAoY29udGFjdFJvd3NDLmxlbmd0aCkgWExTWC51dGlscy5ib29rX2FwcGVuZF9zaGVldCh3YiwgWExTWC51dGlscy5qc29uX3RvX3NoZWV0KGNvbnRhY3RSb3dzQyksICdjb250YWN0YWRvcycpO1xyXG4gIC8vIGxvZyBkZSBvcGVyYWNpb25lc1xyXG4gIGNvbnN0IG9wc1Jvd3NDID0gYnVpbGRPcHNMb2dSb3dzKCk7XHJcbiAgaWYgKG9wc1Jvd3NDLmxlbmd0aCkgWExTWC51dGlscy5ib29rX2FwcGVuZF9zaGVldCh3YiwgWExTWC51dGlscy5qc29uX3RvX3NoZWV0KG9wc1Jvd3NDKSwgJ2xvZ19vcGVyYWNpb25lcycpO1xyXG5cclxuICBYTFNYLndyaXRlRmlsZSh3YiwgJ1NoaW1hbm9fTUxfJyArIHRvZGF5U3RyKCkgKyAnLnhsc3gnKTtcclxufTtcclxuXHJcblxyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxuLy8gdjM3MSs6IEV4cG9ydCBkYXRhc2V0IHBhcmEgYW5cdTAwRTFsaXNpcyAoWklQIGRlIENTVnMgcGFyYSBNTCBwaXBlbGluZXMpXHJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG5cclxuLyoqXHJcbiAqIEFicmUgZWwgbW9kYWwgY2hpY28gZGlzcGF0Y2hlciBkZWwgYm90b24gXCJFeHBvcnRhciBhIEV4Y2VsXCIuIE11ZXN0cmFcclxuICogMiB0YXJqZXRhczogUmVwb3J0ZXMgRXhjZWwgKHRvZG9zKSB2cyBEYXRhc2V0IFpJUCAoc29sbyBhZG1pbi9nZXJlbnRlKS5cclxuICovXHJcbndpbmRvdy5vcGVuRXhwb3J0Rm9ybWF0TW9kYWwgPSBmdW5jdGlvbigpe1xyXG4gIC8vIE9jdWx0YXIvbW9zdHJhciB0YXJqZXRhIERhdGFzZXQgc2VndW4gcm9sLlxyXG4gIGNvbnN0IGRzT3B0ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2V4cC1vcHQtZGF0YXNldC16aXAnKTtcclxuICBpZiAoZHNPcHQpIHtcclxuICAgIGNvbnN0IGlzQWRtaW5PckdlcmVudGUgPSAodXNlclJvbGUgPT09ICdhZG1pbicgfHwgdXNlclJvbGUgPT09ICdnZXJlbnRlJyk7XHJcbiAgICBkc09wdC5zdHlsZS5kaXNwbGF5ID0gaXNBZG1pbk9yR2VyZW50ZSA/ICcnIDogJ25vbmUnO1xyXG4gIH1cclxuICAvLyBPY3VsdGFyIHByb2dyZXNzIGJhciAocG9yIHNpIHF1ZWRvIGFiaWVydG8gZGUgdW5hIGVqZWN1Y2lvbiBhbnRlcmlvcilcclxuICBjb25zdCBwcm9nID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2V4cG9ydC1kYXRhc2V0LXByb2dyZXNzJyk7XHJcbiAgaWYgKHByb2cpIHByb2cuc3R5bGUuZGlzcGxheSA9ICdub25lJztcclxuICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZXhwb3J0LWZvcm1hdC1tb2RhbCcpLmNsYXNzTGlzdC5hZGQoJ29wZW4nKTtcclxufTtcclxuXHJcbndpbmRvdy5jbG9zZUV4cG9ydEZvcm1hdE1vZGFsID0gZnVuY3Rpb24oKXtcclxuICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZXhwb3J0LWZvcm1hdC1tb2RhbCcpLmNsYXNzTGlzdC5yZW1vdmUoJ29wZW4nKTtcclxufTtcclxuXHJcbi8qKlxyXG4gKiBBY3R1YWxpemEgZWwgc3RhdHVzICsgYmFycmEgZGVsIG1vZGFsLiBzdGF0dXMgZXMgdGV4dG8gbGlicmU7IHBlcmNlbnQgMC4uMTAwLlxyXG4gKi9cclxuZnVuY3Rpb24gX3VwZGF0ZUV4cG9ydFByb2dyZXNzKHN0YXR1cywgcGVyY2VudCl7XHJcbiAgY29uc3QgcyA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdleHBvcnQtZGF0YXNldC1zdGF0dXMnKTtcclxuICBjb25zdCBiID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2V4cG9ydC1kYXRhc2V0LWJhcicpO1xyXG4gIGNvbnN0IHdyYXAgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZXhwb3J0LWRhdGFzZXQtcHJvZ3Jlc3MnKTtcclxuICBpZiAod3JhcCkgd3JhcC5zdHlsZS5kaXNwbGF5ID0gJyc7XHJcbiAgaWYgKHMpIHMudGV4dENvbnRlbnQgPSBzdGF0dXM7XHJcbiAgaWYgKGIpIGIuc3R5bGUud2lkdGggPSBNYXRoLm1heCgwLCBNYXRoLm1pbigxMDAsIHBlcmNlbnQpKSArICclJztcclxufVxyXG5cclxuLyoqXHJcbiAqIEZldGNoIHN0b2NrLmpzb24gZGVsIHJvb3QgZGVsIHNpdGlvICh2MzY5KyB0aWVuZSB3YXJlaG91c2VCcmVha2Rvd24pLlxyXG4gKiBDYWNoZS1idXN0aW5nIGNvbiA/dD0gcGFyYSBldml0YXIgU1cuXHJcbiAqL1xyXG5hc3luYyBmdW5jdGlvbiBfZmV0Y2hTdG9ja0pzb24oKXtcclxuICB0cnkge1xyXG4gICAgY29uc3QgciA9IGF3YWl0IGZldGNoKCcuL3N0b2NrLmpzb24/dD0nICsgRGF0ZS5ub3coKSwge2NhY2hlOiAnbm8tc3RvcmUnfSk7XHJcbiAgICBpZiAoIXIub2spIHRocm93IG5ldyBFcnJvcignSFRUUCAnICsgci5zdGF0dXMpO1xyXG4gICAgcmV0dXJuIGF3YWl0IHIuanNvbigpO1xyXG4gIH0gY2F0Y2ggKGUpIHtcclxuICAgIGNvbnNvbGUud2FybignW2V4cG9ydERhdGFzZXRaaXBdIHN0b2NrLmpzb24gZmFsbG86JywgZSAmJiBlLm1lc3NhZ2UpO1xyXG4gICAgcmV0dXJuIG51bGw7IC8vIG5vIGJsb3F1ZWFudGUgXHUyMDE0IHByb2R1Y3Rvcy5jc3YgcXVlZGEgdmFjaW9cclxuICB9XHJcbn1cclxuXHJcbi8qKlxyXG4gKiBMYXp5IGxvYWQgSlNaaXAgKHBhdHJvbiB5YSB1c2FkbyBlbiBleHBvcnRQaG90b3NaaXAgbGluZWEgfjQ3KS5cclxuICovXHJcbmFzeW5jIGZ1bmN0aW9uIF9lbnN1cmVKU1ppcExvYWRlZCgpe1xyXG4gIGlmICh0eXBlb2YgSlNaaXAgIT09ICd1bmRlZmluZWQnKSByZXR1cm47XHJcbiAgYXdhaXQgbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xyXG4gICAgY29uc3QgcyA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3NjcmlwdCcpO1xyXG4gICAgcy5zcmMgPSAnaHR0cHM6Ly9jZG5qcy5jbG91ZGZsYXJlLmNvbS9hamF4L2xpYnMvanN6aXAvMy4xMC4xL2pzemlwLm1pbi5qcyc7XHJcbiAgICBzLm9ubG9hZCA9IHJlc29sdmU7XHJcbiAgICBzLm9uZXJyb3IgPSAoKSA9PiByZWplY3QobmV3IEVycm9yKCdObyBzZSBwdWRvIGNhcmdhciBKU1ppcCcpKTtcclxuICAgIGRvY3VtZW50LmhlYWQuYXBwZW5kQ2hpbGQocyk7XHJcbiAgfSk7XHJcbn1cclxuXHJcbi8qKlxyXG4gKiBEZXNjYXJnYSB1biBCbG9iIGNvbW8gYXJjaGl2by4gUmV1c2EgZWwgcGF0cm9uIGRlIGV4cG9ydFBob3Rvc1ppcC5cclxuICovXHJcbmZ1bmN0aW9uIF9kb3dubG9hZEJsb2IoYmxvYiwgZmlsZW5hbWUpe1xyXG4gIGNvbnN0IHVybCA9IFVSTC5jcmVhdGVPYmplY3RVUkwoYmxvYik7XHJcbiAgY29uc3QgYSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2EnKTtcclxuICBhLmhyZWYgPSB1cmw7XHJcbiAgYS5kb3dubG9hZCA9IGZpbGVuYW1lO1xyXG4gIGRvY3VtZW50LmJvZHkuYXBwZW5kQ2hpbGQoYSk7XHJcbiAgYS5jbGljaygpO1xyXG4gIHNldFRpbWVvdXQoKCkgPT4ge1xyXG4gICAgZG9jdW1lbnQuYm9keS5yZW1vdmVDaGlsZChhKTtcclxuICAgIFVSTC5yZXZva2VPYmplY3RVUkwodXJsKTtcclxuICB9LCAxMDApO1xyXG59XHJcblxyXG4vKipcclxuICogRVhQT1JUIFBSSU5DSVBBTC4gU29sbyBhZG1pbi9nZXJlbnRlLiBHZW5lcmEgWklQIGNvbjpcclxuICogIC0gcGVkaWRvcy5jc3YsIHZpc2l0YXMuY3N2LCBjbGllbnRlcy5jc3YsIGNsaWVudF9tYXN0ZXIuY3N2LCByZW5kaWNpb25lcy5jc3YsXHJcbiAqICAgIGNhbXBhbmlhcy5jc3YsIHRhcmdldHMuY3N2LCBwcm9kdWN0b3MuY3N2LCB2ZW5kb3Jfb3ZlcnJpZGVzLmNzdixcclxuICogICAgY3VzdG9tX3JvdXRlcy5jc3YsIHNlZ3VpbWllbnRvX25vdGVzLmNzdlxyXG4gKiAgLSBtYW5pZmVzdC5qc29uIChzY2hlbWEgKyB1c2VDYXNlTWF0cml4ICsgcm93Q291bnRzICsgbnVsbFJhdGVCeUZpZWxkICsgbGltaXRhdGlvbnMpXHJcbiAqXHJcbiAqIENhc29zIGJvcmRlIG1hbmVqYWRvczpcclxuICogIC0gU2kgYWxndW5hIC5nZXQoKSBmYWxsYSAtPiBhbGVydCArIG5vIGRlc2NhcmdhciAobm8gZ2VuZXJhIFpJUCBwYXJjaWFsIHNpbGVuY2lvc28pLlxyXG4gKiAgLSBTaSBzdG9jay5qc29uIG5vIHJlc3BvbmRlIC0+IHByb2R1Y3Rvcy5jc3YgcXVlZGEgdmFjaW8gY29uIHdhcm5pbmcgZW4gbWFuaWZlc3QuXHJcbiAqICAtIFByb2dyZXNzIGJhciBlbiBlbCBtb2RhbCBwYXJhIGZlZWRiYWNrICh+MTAtMzAgc2VnKS5cclxuICovXHJcbndpbmRvdy5leHBvcnREYXRhc2V0WmlwID0gYXN5bmMgZnVuY3Rpb24oKXtcclxuICBpZiAodXNlclJvbGUgIT09ICdhZG1pbicgJiYgdXNlclJvbGUgIT09ICdnZXJlbnRlJykge1xyXG4gICAgYWxlcnQoJ1NvbG8gYWRtaW4gbyBnZXJlbnRlIHB1ZWRlbiBleHBvcnRhciBlbCBkYXRhc2V0LicpO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuICBpZiAoIWZiRGIpIHtcclxuICAgIGFsZXJ0KCdGaXJlc3RvcmUgbm8gaW5pY2lhbGl6YWRvLiBSZWNhcmdhIGxhIGFwcC4nKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcblxyXG4gIC8vIFJlLWFicmlyIG1vZGFsIHNpIGVsIHVzdWFyaW8gY2Vycm8geSBuYXZlZ2Ftb3MgcG9yIG90cm8gZmx1am8uXHJcbiAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2V4cG9ydC1mb3JtYXQtbW9kYWwnKS5jbGFzc0xpc3QuYWRkKCdvcGVuJyk7XHJcbiAgX3VwZGF0ZUV4cG9ydFByb2dyZXNzKCdQcmVwYXJhbmRvLi4uJywgNSk7XHJcblxyXG4gIHRyeSB7XHJcbiAgICBfdXBkYXRlRXhwb3J0UHJvZ3Jlc3MoJ0NhcmdhbmRvIEpTWmlwLi4uJywgMTApO1xyXG4gICAgYXdhaXQgX2Vuc3VyZUpTWmlwTG9hZGVkKCk7XHJcblxyXG4gICAgLy8gMSkgRmV0Y2ggMTAgY29sZWNjaW9uZXMgRmlyZXN0b3JlIGVuIHBhcmFsZWxvICsgc3RvY2suanNvblxyXG4gICAgX3VwZGF0ZUV4cG9ydFByb2dyZXNzKCdMZXllbmRvIEZpcmVzdG9yZSAoMTAgY29sZWNjaW9uZXMpLi4uJywgMjApO1xyXG4gICAgY29uc3QgZmlyZXN0b3JlRW50cmllcyA9IFtcclxuICAgICAgWydwZWRpZG9zJywgICAgICAgICAgIGZiRGIuY29sbGVjdGlvbigncGVkaWRvcycpLmdldCgpXSxcclxuICAgICAgWyd2aXNpdGFzJywgICAgICAgICAgIGZiRGIuY29sbGVjdGlvbigndmlzaXRzJykuZ2V0KCldLFxyXG4gICAgICBbJ2NsaWVudGVzJywgICAgICAgICAgZmJEYi5jb2xsZWN0aW9uKCdjbGllbnRfYXBwbGljYXRpb25zJykuZ2V0KCldLFxyXG4gICAgICBbJ2NsaWVudF9tYXN0ZXInLCAgICAgZmJEYi5jb2xsZWN0aW9uKCdjbGllbnRfbWFzdGVyJykuZ2V0KCldLFxyXG4gICAgICBbJ3JlbmRpY2lvbmVzJywgICAgICAgZmJEYi5jb2xsZWN0aW9uKCdyZW5kaWNpb25lcycpLmdldCgpXSxcclxuICAgICAgWydjYW1wYW5pYXMnLCAgICAgICAgIGZiRGIuY29sbGVjdGlvbignY2FtcGFpZ25zJykuZ2V0KCldLFxyXG4gICAgICBbJ3RhcmdldHMnLCAgICAgICAgICAgZmJEYi5jb2xsZWN0aW9uKCd0YXJnZXRzJykuZ2V0KCldLFxyXG4gICAgICBbJ3ZlbmRvcl9vdmVycmlkZXMnLCAgZmJEYi5jb2xsZWN0aW9uKCd2ZW5kb3Jfb3ZlcnJpZGVzJykuZ2V0KCldLFxyXG4gICAgICBbJ2N1c3RvbV9yb3V0ZXMnLCAgICAgZmJEYi5jb2xsZWN0aW9uKCdjdXN0b21fcm91dGVzJykuZ2V0KCldLFxyXG4gICAgICBbJ3NlZ3VpbWllbnRvX25vdGVzJywgZmJEYi5jb2xsZWN0aW9uKCdzZWd1aW1pZW50b19ub3RlcycpLmdldCgpXSxcclxuICAgIF07XHJcbiAgICBjb25zdCBwcm9taXNlcyA9IGZpcmVzdG9yZUVudHJpZXMubWFwKChbLCBwXSkgPT4gcCk7XHJcbiAgICBwcm9taXNlcy5wdXNoKF9mZXRjaFN0b2NrSnNvbigpKTtcclxuXHJcbiAgICBjb25zdCBzZXR0bGVkID0gYXdhaXQgUHJvbWlzZS5hbGxTZXR0bGVkKHByb21pc2VzKTtcclxuICAgIC8vIFNpIENVQUxRVUlFUiBnZXQoKSBkZSBGaXJlc3RvcmUgcmVjaGF6bywgYWJvcnRhbW9zIChubyBleHBvcnQgcGFyY2lhbCBzaWxlbmNpb3NvKS5cclxuICAgIGNvbnN0IGZhaWxlZEZpcmVzdG9yZSA9IFtdO1xyXG4gICAgc2V0dGxlZC5zbGljZSgwLCBmaXJlc3RvcmVFbnRyaWVzLmxlbmd0aCkuZm9yRWFjaCgociwgaSkgPT4ge1xyXG4gICAgICBpZiAoci5zdGF0dXMgPT09ICdyZWplY3RlZCcpIGZhaWxlZEZpcmVzdG9yZS5wdXNoKGZpcmVzdG9yZUVudHJpZXNbaV1bMF0gKyAnOiAnICsgKHIucmVhc29uICYmIHIucmVhc29uLm1lc3NhZ2UgfHwgci5yZWFzb24pKTtcclxuICAgIH0pO1xyXG4gICAgaWYgKGZhaWxlZEZpcmVzdG9yZS5sZW5ndGgpIHtcclxuICAgICAgdGhyb3cgbmV3IEVycm9yKCdGaXJlc3RvcmUgZmV0Y2ggZmFsbG8gZW4gJyArIGZhaWxlZEZpcmVzdG9yZS5sZW5ndGggKyAnIGNvbGVjY2lvbmVzOlxcbicgKyBmYWlsZWRGaXJlc3RvcmUuam9pbignXFxuJykpO1xyXG4gICAgfVxyXG5cclxuICAgIC8vIDIpIEV4dHJhZXIgc25hcHNob3RzICsgZG9jcyBjb24gX2lkXHJcbiAgICBjb25zdCBzbmFwc2hvdHMgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIGFueVtdPn0gKi8oe30pO1xyXG4gICAgZmlyZXN0b3JlRW50cmllcy5mb3JFYWNoKChbbmFtZV0sIGkpID0+IHtcclxuICAgICAgY29uc3Qgc25hcCA9IC8qKiBAdHlwZSB7YW55fSAqLyhzZXR0bGVkW2ldKS52YWx1ZTtcclxuICAgICAgY29uc3QgZG9jcyA9IFtdO1xyXG4gICAgICBzbmFwLmZvckVhY2goKGQpID0+IHtcclxuICAgICAgICBjb25zdCBkYXRhID0gZC5kYXRhKCkgfHwge307XHJcbiAgICAgICAgZGF0YS5faWQgPSBkLmlkO1xyXG4gICAgICAgIGRvY3MucHVzaChkYXRhKTtcclxuICAgICAgfSk7XHJcbiAgICAgIHNuYXBzaG90c1tuYW1lXSA9IGRvY3M7XHJcbiAgICB9KTtcclxuICAgIGNvbnN0IHN0b2NrSnNvbiA9IC8qKiBAdHlwZSB7YW55fSAqLyhzZXR0bGVkW3NldHRsZWQubGVuZ3RoIC0gMV0pLnZhbHVlOyAvLyBwdWVkZSBzZXIgbnVsbFxyXG5cclxuICAgIC8vIDMpIENvbnN0cnVpciBDU1ZzIGNvbiByb3cgYnVpbGRlcnMgKyBzY2hlbWFzXHJcbiAgICBfdXBkYXRlRXhwb3J0UHJvZ3Jlc3MoJ1NlcmlhbGl6YW5kbyBDU1ZzLi4uJywgNTUpO1xyXG4gICAgY29uc3QgY3N2cyA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgc3RyaW5nPn0gKi8oe30pO1xyXG4gICAgY29uc3Qgcm93Q291bnRzID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBudW1iZXI+fSAqLyh7fSk7XHJcbiAgICBjb25zdCBhbGxSb3dzQnlDc3YgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIGFueVtdW10+fSAqLyh7fSk7XHJcblxyXG4gICAgZm9yIChjb25zdCBjb2xsTmFtZSBvZiBPYmplY3Qua2V5cyhzbmFwc2hvdHMpKSB7XHJcbiAgICAgIGNvbnN0IHNjaGVtYSA9IERBVEFTRVRfU0NIRU1BU1tjb2xsTmFtZV07XHJcbiAgICAgIGlmICghc2NoZW1hKSBjb250aW51ZTtcclxuICAgICAgY29uc3QgYnVpbGRlciA9IFJPV19CVUlMREVSU1tjb2xsTmFtZV07XHJcbiAgICAgIGlmICghYnVpbGRlcikgY29udGludWU7XHJcbiAgICAgIGNvbnN0IGFsbFJvd3MgPSAvKiogQHR5cGUge2FueVtdW119ICovKFtdKTtcclxuICAgICAgZm9yIChjb25zdCBkb2Mgb2Ygc25hcHNob3RzW2NvbGxOYW1lXSkge1xyXG4gICAgICAgIGNvbnN0IHJvd3NGb3JEb2MgPSBidWlsZGVyKGRvYyk7XHJcbiAgICAgICAgZm9yIChjb25zdCByIG9mIHJvd3NGb3JEb2MpIGFsbFJvd3MucHVzaChyKTtcclxuICAgICAgfVxyXG4gICAgICBhbGxSb3dzQnlDc3Zbc2NoZW1hLm5hbWVdID0gYWxsUm93cztcclxuICAgICAgY3N2c1tzY2hlbWEubmFtZV0gPSBidWlsZENzdihzY2hlbWEsIGFsbFJvd3MpO1xyXG4gICAgICByb3dDb3VudHNbc2NoZW1hLm5hbWVdID0gYWxsUm93cy5sZW5ndGg7XHJcbiAgICB9XHJcblxyXG4gICAgLy8gcHJvZHVjdG9zLmNzdiAoZGVzZGUgc3RvY2suanNvbiwgbm8gRmlyZXN0b3JlKVxyXG4gICAgY29uc3QgcHJvZHVjdG9zU2NoZW1hID0gREFUQVNFVF9TQ0hFTUFTLnByb2R1Y3RvcztcclxuICAgIGNvbnN0IHByb2R1Y3Rvc1Jvd3MgPSBzdG9ja0pzb24gPyBidWlsZFByb2R1Y3RvUm93c0Zyb21TdG9ja0pzb24oc3RvY2tKc29uKSA6IFtdO1xyXG4gICAgYWxsUm93c0J5Q3N2W3Byb2R1Y3Rvc1NjaGVtYS5uYW1lXSA9IHByb2R1Y3Rvc1Jvd3M7XHJcbiAgICBjc3ZzW3Byb2R1Y3Rvc1NjaGVtYS5uYW1lXSA9IGJ1aWxkQ3N2KHByb2R1Y3Rvc1NjaGVtYSwgcHJvZHVjdG9zUm93cyk7XHJcbiAgICByb3dDb3VudHNbcHJvZHVjdG9zU2NoZW1hLm5hbWVdID0gcHJvZHVjdG9zUm93cy5sZW5ndGg7XHJcblxyXG4gICAgLy8gNCkgQ29tcHV0YXIgbnVsbFJhdGVCeUZpZWxkIHBhcmEgY2FkYSBjYXNvIEEtRVxyXG4gICAgX3VwZGF0ZUV4cG9ydFByb2dyZXNzKCdDYWxjdWxhbmRvIGNhbGlkYWQgZGVsIGRhdGFzZXQuLi4nLCA3NSk7XHJcbiAgICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIGFueT59ICovXHJcbiAgICBjb25zdCB1c2VDYXNlV2l0aFN0YXRzID0ge307XHJcbiAgICBmb3IgKGNvbnN0IFtjYXNlS2V5LCB1Y10gb2YgT2JqZWN0LmVudHJpZXMoREFUQVNFVF9VU0VfQ0FTRV9NQVRSSVgpKSB7XHJcbiAgICAgIGNvbnN0IHN0YXRzID0gLyoqIEB0eXBlIHthbnl9ICovKHtwcmlvcml0eTogdWMucHJpb3JpdHksIGRlc2NyaXB0aW9uOiB1Yy5kZXNjcmlwdGlvbiwgcmVxdWlyZWRGaWVsZHM6IHVjLnJlcXVpcmVkRmllbGRzLCBqb2luTm90ZXM6IHVjLmpvaW5Ob3RlcywgbnVsbFJhdGVCeUZpZWxkOiB7fSwgbGltaXRhdGlvbnM6IFtdfSk7XHJcbiAgICAgIGxldCBoYXNIaWdoTnVsbFJhdGUgPSBmYWxzZTtcclxuICAgICAgbGV0IGhhc0VtcHR5UmVxdWlyZWQgPSBmYWxzZTtcclxuICAgICAgZm9yIChjb25zdCBbY3N2TmFtZSwgZmllbGRzXSBvZiBPYmplY3QuZW50cmllcyh1Yy5yZXF1aXJlZEZpZWxkcykpIHtcclxuICAgICAgICBjb25zdCBzY2hlbWFGb3JDc3YgPSBPYmplY3QudmFsdWVzKERBVEFTRVRfU0NIRU1BUykuZmluZCgocykgPT4gcy5uYW1lID09PSBjc3ZOYW1lKTtcclxuICAgICAgICBpZiAoIXNjaGVtYUZvckNzdikgeyBzdGF0cy5saW1pdGF0aW9ucy5wdXNoKCdTY2hlbWEgbm8gZW5jb250cmFkbyBwYXJhICcgKyBjc3ZOYW1lKTsgY29udGludWU7IH1cclxuICAgICAgICBjb25zdCByb3dzID0gYWxsUm93c0J5Q3N2W2Nzdk5hbWVdIHx8IFtdO1xyXG4gICAgICAgIGNvbnN0IHJhdGVzID0gY29tcHV0ZU51bGxSYXRlcyhzY2hlbWFGb3JDc3YsIHJvd3MsIGZpZWxkcyk7XHJcbiAgICAgICAgZm9yIChjb25zdCBbZiwgcmF0ZV0gb2YgT2JqZWN0LmVudHJpZXMocmF0ZXMpKSB7XHJcbiAgICAgICAgICBzdGF0cy5udWxsUmF0ZUJ5RmllbGRbY3N2TmFtZSArICcuJyArIGZdID0gcmF0ZTtcclxuICAgICAgICAgIGlmIChyb3dzLmxlbmd0aCA9PT0gMCkgaGFzRW1wdHlSZXF1aXJlZCA9IHRydWU7XHJcbiAgICAgICAgICBlbHNlIGlmIChyYXRlID4gMC41KSBoYXNIaWdoTnVsbFJhdGUgPSB0cnVlO1xyXG4gICAgICAgIH1cclxuICAgICAgfVxyXG4gICAgICBpZiAoaGFzRW1wdHlSZXF1aXJlZCkge1xyXG4gICAgICAgIHN0YXRzLnN0YXR1cyA9ICdFTVBUWSc7XHJcbiAgICAgICAgc3RhdHMubGltaXRhdGlvbnMucHVzaCgnQWxndW5hIGNvbGVjY2lvbiByZXF1ZXJpZGEgZXN0YSB2YWNpYSBcdTIwMTQgZWwgY2FzbyBubyBzZSBwdWVkZSBlbnRyZW5hciBob3kgcGVybyBlbCBzY2hlbWEgZXN0YSBsaXN0by4nKTtcclxuICAgICAgfSBlbHNlIGlmIChoYXNIaWdoTnVsbFJhdGUpIHtcclxuICAgICAgICBzdGF0cy5zdGF0dXMgPSAnUEFSVElBTCc7XHJcbiAgICAgICAgc3RhdHMubGltaXRhdGlvbnMucHVzaCgnQWwgbWVub3MgMSBjYW1wbyByZXF1ZXJpZG8gdGllbmUgPjUwJSBkZSBudWxscyBcdTIwMTQgcmV2aXNhciB0YXNhcyBhbnRlcyBkZSB1c2FyLicpO1xyXG4gICAgICB9IGVsc2Uge1xyXG4gICAgICAgIHN0YXRzLnN0YXR1cyA9ICdPSyc7XHJcbiAgICAgIH1cclxuICAgICAgdXNlQ2FzZVdpdGhTdGF0c1tjYXNlS2V5XSA9IHN0YXRzO1xyXG4gICAgfVxyXG5cclxuICAgIC8vIDUpIE1hbmlmZXN0Lmpzb25cclxuICAgIGNvbnN0IGV4cG9ydGVkQXQgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCk7XHJcbiAgICBjb25zdCBtYW5pZmVzdCA9IHtcclxuICAgICAgZXhwb3J0ZWRBdCxcclxuICAgICAgYXBwVmVyc2lvbjogKHR5cGVvZiBBUFBfVkVSU0lPTiAhPT0gJ3VuZGVmaW5lZCcgPyBBUFBfVkVSU0lPTiA6ICd1bmtub3duJyksXHJcbiAgICAgIHNvdXJjZVByb2plY3Q6ICdhcHAtdmVuZGVkb3Jlcy1zaGltYW5vJyxcclxuICAgICAgZXhwb3J0ZWRCeUVtYWlsOiAoY3VycmVudFVzZXIgJiYgY3VycmVudFVzZXIuZW1haWwpIHx8ICd1bmtub3duJyxcclxuICAgICAgZXhwb3J0ZWRCeVVpZDogKGN1cnJlbnRVc2VyICYmIGN1cnJlbnRVc2VyLnVpZCkgfHwgJ3Vua25vd24nLFxyXG4gICAgICBjc3ZDb252ZW50aW9uczoge1xyXG4gICAgICAgIGVuY29kaW5nOiAnVVRGLTgnLFxyXG4gICAgICAgIHNlcGFyYXRvcjogJywnLFxyXG4gICAgICAgIHF1b3RlQ2hhcjogJ1wiJyxcclxuICAgICAgICBlc2NhcGVRdW90ZTogJ1wiXCInLFxyXG4gICAgICAgIGxpbmVUZXJtaW5hdG9yOiAnXFxcXHJcXFxcbicsXHJcbiAgICAgICAgZGF0ZUZvcm1hdDogJ0lTTyA4NjAxIFVUQyAod2l0aCBaKScsXHJcbiAgICAgICAgZGVjaW1hbFNlcGFyYXRvcjogJy4nLFxyXG4gICAgICAgIG51bGxSZXByZXNlbnRhdGlvbjogJyhlbXB0eSBmaWVsZCknLFxyXG4gICAgICAgIGFycmF5Rm9ybWF0OiAnSlNPTiBzdHJpbmdpZmllZCcsXHJcbiAgICAgICAgb2JqZWN0Rm9ybWF0OiAnSlNPTiBzdHJpbmdpZmllZCcsXHJcbiAgICAgIH0sXHJcbiAgICAgIHJvd0NvdW50cyxcclxuICAgICAgc2NoZW1hOiB7fSxcclxuICAgICAgdXNlQ2FzZU1hdHJpeDogdXNlQ2FzZVdpdGhTdGF0cyxcclxuICAgICAgZXhjbHVzaW9uczoge1xyXG4gICAgICAgIG5vdGU6ICdEYXRvcyBzZW5zaWJsZXMgeSBiaW5hcmlvcyBleGNsdWlkb3MgZGVsIGV4cG9ydC4nLFxyXG4gICAgICAgIGV4Y2x1ZGVkQ29sbGVjdGlvbnM6IFsncm9sZXMnLCAnYXBwX2NvbmZpZycsICdzYXBfc25hcHNob3QnLCAnbm90aWZpY2F0aW9ucycsICdvcGVyYXRpb25zX2xvZyddLFxyXG4gICAgICAgIGV4Y2x1ZGVkRmllbGRzOiBbXHJcbiAgICAgICAgICAndmlzaXRzLmZyZW50ZUxvY2FsIChmb3RvcyBiYXNlNjQpJyxcclxuICAgICAgICAgICd2aXNpdHMuZXNwYWNpb1tdIChmb3RvcyBiYXNlNjQpJyxcclxuICAgICAgICAgICdjbGllbnRfYXBwbGljYXRpb25zLmNvbnN0YW5jaWFBcmNhIChiYXNlNjQpJyxcclxuICAgICAgICAgICdjbGllbnRfYXBwbGljYXRpb25zLmNvbnN0YW5jaWFJSUJCIChiYXNlNjQpJyxcclxuICAgICAgICAgICdjbGllbnRfYXBwbGljYXRpb25zLmZvdG9zTG9jYWxbXSAoYmFzZTY0KScsXHJcbiAgICAgICAgICAncmVuZGljaW9uZXMuZm90b1RpY2tldCAoYmFzZTY0IGxlZ2FjeSBwcmUtdjMwODsgc2UgZXhwb3J0YSBzb2xvIGZvdG9UaWNrZXRVcmwpJyxcclxuICAgICAgICBdLFxyXG4gICAgICAgIHN0b2NrSnNvbkxvYWRlZDogc3RvY2tKc29uICE9PSBudWxsLFxyXG4gICAgICB9LFxyXG4gICAgfTtcclxuICAgIGZvciAoY29uc3QgW2NvbGxOYW1lLCBzY2hlbWFdIG9mIE9iamVjdC5lbnRyaWVzKERBVEFTRVRfU0NIRU1BUykpIHtcclxuICAgICAgbWFuaWZlc3Quc2NoZW1hW3NjaGVtYS5uYW1lXSA9IHNjaGVtYS5jb2x1bW5zLm1hcCgoYykgPT4gKHtjb2w6IGMuY29sLCB0eXBlOiBjLnR5cGUsIGRlc2M6IGMuZGVzY30pKTtcclxuICAgIH1cclxuXHJcbiAgICAvLyA2KSBFbXBhcXVldGFyIFpJUFxyXG4gICAgX3VwZGF0ZUV4cG9ydFByb2dyZXNzKCdFbXBhcXVldGFuZG8gWklQLi4uJywgOTApO1xyXG4gICAgY29uc3QgemlwID0gbmV3IEpTWmlwKCk7XHJcbiAgICBmb3IgKGNvbnN0IFtuYW1lLCBjb250ZW50XSBvZiBPYmplY3QuZW50cmllcyhjc3ZzKSkge1xyXG4gICAgICB6aXAuZmlsZShuYW1lLCBjb250ZW50KTtcclxuICAgIH1cclxuICAgIHppcC5maWxlKCdtYW5pZmVzdC5qc29uJywgSlNPTi5zdHJpbmdpZnkobWFuaWZlc3QsIG51bGwsIDIpKTtcclxuXHJcbiAgICBjb25zdCBibG9iID0gYXdhaXQgemlwLmdlbmVyYXRlQXN5bmMoe3R5cGU6ICdibG9iJywgY29tcHJlc3Npb246ICdERUZMQVRFJywgY29tcHJlc3Npb25PcHRpb25zOiB7bGV2ZWw6IDZ9fSk7XHJcbiAgICBjb25zdCBmaWxlbmFtZSA9ICdzaGltYW5vLWRhdGFzZXQtJyArIGV4cG9ydGVkQXQucmVwbGFjZSgvWzouXS9nLCAnLScpICsgJy56aXAnO1xyXG4gICAgX2Rvd25sb2FkQmxvYihibG9iLCBmaWxlbmFtZSk7XHJcblxyXG4gICAgX3VwZGF0ZUV4cG9ydFByb2dyZXNzKCdEYXRhc2V0IGRlc2NhcmdhZG86ICcgKyBmaWxlbmFtZSArICcgKCcgKyBPYmplY3Qua2V5cyhjc3ZzKS5sZW5ndGggKyAnIENTVnMgKyBtYW5pZmVzdC5qc29uKScsIDEwMCk7XHJcbiAgICBpZiAodHlwZW9mIHNob3dTeW5jVGFnID09PSAnZnVuY3Rpb24nKSB7XHJcbiAgICAgIGNvbnN0IHRvdGFsUm93cyA9IE9iamVjdC52YWx1ZXMocm93Q291bnRzKS5yZWR1Y2UoKGEsIGIpID0+IGEgKyBiLCAwKTtcclxuICAgICAgc2hvd1N5bmNUYWcoJ0RhdGFzZXQgZXhwb3J0YWRvOiAnICsgdG90YWxSb3dzICsgJyBmaWxhcyBlbiAnICsgT2JqZWN0LmtleXMoY3N2cykubGVuZ3RoICsgJyBDU1ZzJyk7XHJcbiAgICB9XHJcbiAgICBzZXRUaW1lb3V0KCgpID0+IHdpbmRvdy5jbG9zZUV4cG9ydEZvcm1hdE1vZGFsKCksIDMwMDApO1xyXG4gIH0gY2F0Y2ggKGUpIHtcclxuICAgIGNvbnNvbGUuZXJyb3IoJ1tleHBvcnREYXRhc2V0WmlwXSBmYXRhbDonLCBlKTtcclxuICAgIF91cGRhdGVFeHBvcnRQcm9ncmVzcygnRXJyb3I6ICcgKyAoZSAmJiBlLm1lc3NhZ2UgfHwgZSksIDApO1xyXG4gICAgYWxlcnQoJ0Vycm9yIGFsIGV4cG9ydGFyIGVsIGRhdGFzZXQ6XFxuXFxuJyArIChlICYmIGUubWVzc2FnZSB8fCBlKSArICdcXG5cXG5FbCBaSVAgTk8gc2UgZGVzY2FyZ28gKGV2aXRhbW9zIGdlbmVyYXIgdW4gYXJjaGl2byBwYXJjaWFsKS4gUmV2aXNhIGxhIGNvbnNvbGEgcGFyYSBtYXMgZGV0YWxsZXMuJyk7XHJcbiAgfVxyXG59O1xyXG5cclxuXHJcbi8vID09PSBFeHBvcnRzIGEgd2luZG93ID09PVxyXG4vLyBUb2RhcyBsYXMgZnVuY2lvbmVzIHdpbmRvdy5mb28gPSBmdW5jdGlvbi4uLiB5YSBlc3RcdTAwRTFuIHZlcmJhdGltLlxyXG5pZiAodHlwZW9mIHdpbmRvdy50b2RheVN0ciA9PT0gXCJ1bmRlZmluZWRcIikgd2luZG93LnRvZGF5U3RyID0gdG9kYXlTdHI7XHJcbi8vIEU2IGhvdGZpeCAyOiBkYXRhVXJsVG9CbG9iICsgc2FuaXRpemVGb3JQYXRoIHVzYWRvcyBwb3IgaW5saW5lIHJ1bkZ1bGxCYWNrdXAgKEw3Mjc4LTcyODgpLlxyXG5pZiAodHlwZW9mIHdpbmRvdy5kYXRhVXJsVG9CbG9iID09PSBcInVuZGVmaW5lZFwiKSB3aW5kb3cuZGF0YVVybFRvQmxvYiA9IGRhdGFVcmxUb0Jsb2I7XHJcbmlmICh0eXBlb2Ygd2luZG93LnNhbml0aXplRm9yUGF0aCA9PT0gXCJ1bmRlZmluZWRcIikgd2luZG93LnNhbml0aXplRm9yUGF0aCA9IHNhbml0aXplRm9yUGF0aDtcclxuLy8gRTYgaG90Zml4IDM6IGNyb3NzLW1vZHVsZSBidWcgKGF1ZGl0IGNyb3NzYnVuZGxlKSBcdTIwMTQgZXhwb3J0cy1jb3JlIGxsYW1hIGxvYWRFeGNlbEpTLlxyXG53aW5kb3cubG9hZEV4Y2VsSlMgPSBsb2FkRXhjZWxKUztcclxuIl0sCiAgIm1hcHBpbmdzIjogIjs7O0FBb0NPLFdBQVMsVUFBVSxHQUFHO0FBQzNCLFFBQUksTUFBTSxRQUFRLE1BQU0sT0FBVyxRQUFPO0FBQzFDLFVBQU0sTUFBTSxPQUFPLENBQUM7QUFDcEIsUUFBSSxRQUFRLEdBQUksUUFBTztBQUV2QixRQUFJLFdBQVcsS0FBSyxHQUFHLEdBQUc7QUFDeEIsYUFBTyxNQUFNLElBQUksUUFBUSxNQUFNLElBQUksSUFBSTtBQUFBLElBQ3pDO0FBQ0EsV0FBTztBQUFBLEVBQ1Q7QUFRTyxXQUFTLE9BQU8sUUFBUTtBQUM3QixXQUFPLE9BQU8sSUFBSSxDQUFDLE1BQU0sVUFBVSxvQkFBb0IsQ0FBQyxDQUFDLENBQUMsRUFBRSxLQUFLLEdBQUc7QUFBQSxFQUN0RTtBQWdCTyxXQUFTLG9CQUFvQixHQUFHO0FBQ3JDLFFBQUksTUFBTSxRQUFRLE1BQU0sT0FBVyxRQUFPO0FBQzFDLFFBQUksT0FBTyxNQUFNLFNBQVUsUUFBTztBQUNsQyxRQUFJLE9BQU8sTUFBTSxVQUFVO0FBQ3pCLFVBQUksQ0FBQyxTQUFTLENBQUMsRUFBRyxRQUFPO0FBQ3pCLGFBQU8sT0FBTyxDQUFDO0FBQUEsSUFDakI7QUFDQSxRQUFJLE9BQU8sTUFBTSxVQUFXLFFBQU8sSUFBSSxTQUFTO0FBRWhELFFBQUksT0FBTyxNQUFNLFlBQVksTUFBTSxRQUFRO0FBQUEsSUFBMkIsRUFBSSxXQUFXLFlBQVk7QUFDL0YsVUFBSTtBQUNGO0FBQUE7QUFBQSxVQUEyQixFQUFJLE9BQU8sRUFBRSxZQUFZO0FBQUE7QUFBQSxNQUN0RCxTQUFTLEdBQUc7QUFDVixlQUFPO0FBQUEsTUFDVDtBQUFBLElBQ0Y7QUFDQSxRQUFJLGFBQWEsTUFBTTtBQUNyQixVQUFJLE1BQU0sRUFBRSxRQUFRLENBQUMsRUFBRyxRQUFPO0FBQy9CLGFBQU8sRUFB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RSxNQUFNO0FBQUEsTUFDWixJQUFJLEVBQUUsU0FBUztBQUFBLE1BQ2YsSUFBSSxFQUFFLE1BQU07QUFBQSxNQUNaLElBQUksRUFBRSxNQUFNO0FBQUEsTUFDWixJQUFJLEVBQUUsTUFBTTtBQUFBLElBQ2QsQ0FBQyxDQUFDO0FBQUEsRUFDSjtBQUdPLFdBQVMsZ0JBQWdCLEtBQUs7QUFDbkMsV0FBTyxDQUFDO0FBQUEsTUFDTixJQUFJO0FBQUEsTUFDSixJQUFJO0FBQUEsTUFDSixJQUFJO0FBQUEsTUFDSixJQUFJO0FBQUEsTUFDSixJQUFJO0FBQUEsTUFDSixJQUFJO0FBQUEsTUFDSixJQUFJO0FBQUEsTUFDSixJQUFJO0FBQUEsTUFDSixJQUFJO0FBQUEsTUFDSixJQUFJO0FBQUEsTUFDSixJQUFJO0FBQUEsTUFDSixJQUFJO0FBQUEsTUFDSixJQUFJO0FBQUEsTUFDSixJQUFJO0FBQUEsTUFDSixJQUFJO0FBQUEsTUFDSixJQUFJO0FBQUEsTUFDSixJQUFJO0FBQUEsTUFDSixJQUFJO0FBQUEsTUFDSixJQUFJO0FBQUEsTUFDSixJQUFJO0FBQUEsTUFDSixJQUFJO0FBQUEsTUFDSixJQUFJO0FBQUEsTUFDSixJQUFJO0FBQUEsTUFDSixJQUFJO0FBQUEsTUFDSixJQUFJO0FBQUEsTUFDSixJQUFJO0FBQUEsTUFDSixJQUFJO0FBQUEsTUFDSixJQUFJO0FBQUEsTUFDSixJQUFJO0FBQUEsTUFDSixJQUFJO0FBQUEsTUFDSixJQUFJO0FBQUEsTUFDSixJQUFJO0FBQUEsTUFDSixJQUFJO0FBQUEsSUFDTixDQUFDO0FBQUEsRUFDSDtBQUdPLFdBQVMsaUJBQWlCLEtBQUs7QUFDcEMsV0FBTyxDQUFDO0FBQUEsTUFDTixJQUFJO0FBQUEsTUFDSixJQUFJO0FBQUEsTUFDSixJQUFJO0FBQUEsTUFDSixJQUFJO0FBQUEsTUFDSixJQUFJO0FBQUEsTUFDSixJQUFJO0FBQUEsTUFDSixJQUFJO0FBQUEsTUFDSixJQUFJO0FBQUEsTUFDSixJQUFJO0FBQUEsTUFDSixJQUFJO0FBQUEsTUFDSixJQUFJO0FB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
