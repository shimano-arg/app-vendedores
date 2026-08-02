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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL3B1cmUvY3N2LXNlcmlhbGl6ZXIuanMiLCAiLi4vc3JjL2RvbWFpbnMvZXhwb3J0cy1hZHZhbmNlZC5qcyJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiLy8gQHRzLWNoZWNrXHJcbi8qKlxyXG4gKiBDU1Ygc2VyaWFsaXplciArIGRhdGFzZXQgc2NoZW1hcyArIHJvdyBidWlsZGVycyBcdTIwMTQgcGFyYSBleHBvcnREYXRhc2V0WmlwXHJcbiAqICh2MzcxKykuIEZ1bmNpb25lcyBwdXJhcywgdGVzdGVhYmxlcyBzaW4gZ2xvYmFscyBkZWwgYnVuZGxlLlxyXG4gKlxyXG4gKiA1IGNhc29zIGRlIHVzbyBNTCBkb2N1bWVudGFkb3MgZW4gREFUQVNFVF9VU0VfQ0FTRV9NQVRSSVg6XHJcbiAqICAgQSkgQ29udmVyc2lvbiB2aXNpdGEtPnBlZGlkbyAocHJpb3JpZGFkIDEsIGNsYXNpZmljYWNpb24pXHJcbiAqICAgQikgUmllc2dvIGRlIGNodXJuIGRlIGNsaWVudGVzIChwcmlvcmlkYWQgMiwgYWxlcnRhKVxyXG4gKiAgIEMpIEZvcmVjYXN0IGRlIGRlbWFuZGEgcG9yIFNLVSAocHJpb3JpZGFkIDMsIHNlcmllcyB0ZW1wb3JhbGVzKVxyXG4gKiAgIEQpIEFub21hbGlhcyBlbiByZW5kaWNpb25lcyAoZXhwbG9yYXRvcmlvKVxyXG4gKiAgIEUpIEVzdGFjaW9uYWxpZGFkIHBvciB6b25hL2NhbXBhbmEgKGV4cGxvcmF0b3JpbylcclxuICpcclxuICogQ29udmVuY2lvbmVzIChSRkMgNDE4MCArIGFkYXB0YWNpb25lcyBwYXJhIE1MIHBpcGVsaW5lcyk6XHJcbiAqICAgLSBTZXBhcmF0b3I6IFwiLFwiXHJcbiAqICAgLSBRdW90ZSBjaGFyOiBcIlxcXCJcIlxyXG4gKiAgIC0gRXNjYXBlIHF1b3RlOiBcIlxcXCJcXFwiXCJcclxuICogICAtIExpbmUgdGVybWluYXRvcjogXCJcXHJcXG5cIlxyXG4gKiAgIC0gRW5jb2Rpbmc6IFVURi04IChCT00gb3BjaW9uYWwgYWwgZXNjcmliaXIgZWwgWklQKVxyXG4gKiAgIC0gRmVjaGFzOiBJU08gODYwMSBVVEMgKGNvbiBcIlpcIiBhbCBmaW5hbClcclxuICogICAtIERlY2ltYWxlczogcHVudG8gKFwiLlwiKVxyXG4gKiAgIC0gTnVsbC91bmRlZmluZWQ6IGNhbXBvIHZhY2lvIChOTyBcIk4vQVwiLCBcIi1cIiwgXCJudWxsXCIpXHJcbiAqICAgLSBBcnJheXMgLT4gSlNPTi5zdHJpbmdpZnkgZW50cmUgY29taWxsYXMgZG9ibGVzXHJcbiAqICAgLSBPYmpldG9zIChleGNlcHRvIFRpbWVzdGFtcCB5IERhdGUpIC0+IEpTT04uc3RyaW5naWZ5XHJcbiAqICAgLSBGaXJlc3RvcmUgVGltZXN0YW1wcyAtPiB0b0RhdGUoKS50b0lTT1N0cmluZygpXHJcbiAqL1xyXG5cclxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XHJcbi8vIEhlbHBlcnMgQ1NWIHB1cm9zXHJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG5cclxuLyoqXHJcbiAqIEVzY2FwYSB1biB2YWxvciBzdHJpbmcgcGFyYSBDU1YgUkZDIDQxODAuIFdyYXBwZWEgY29uIFwiLi4uXCIgc2kgY29udGllbmVcclxuICogXCIsXCIsIFwiXFxcIlwiLCBcIlxcclwiIG8gXCJcXG5cIi4gRXNjYXBhIFwiXFxcIlwiIC0+IFwiXFxcIlxcXCJcIi5cclxuICogQHBhcmFtIHtzdHJpbmd9IHNcclxuICogQHJldHVybnMge3N0cmluZ31cclxuICovXHJcbmV4cG9ydCBmdW5jdGlvbiBjc3ZFc2NhcGUocykge1xyXG4gIGlmIChzID09PSBudWxsIHx8IHMgPT09IHVuZGVmaW5lZCkgcmV0dXJuICcnO1xyXG4gIGNvbnN0IHN0ciA9IFN0cmluZyhzKTtcclxuICBpZiAoc3RyID09PSAnJykgcmV0dXJuICcnO1xyXG4gIC8vIE5lY2VzaXRhIHF1b3Rpbmcgc2kgdGllbmUgY29tYSwgcXVvdGUsIG8gbGluZS1icmVha1xyXG4gIGlmICgvW1wiLFxcclxcbl0vLnRlc3Qoc3RyKSkge1xyXG4gICAgcmV0dXJuICdcIicgKyBzdHIucmVwbGFjZSgvXCIvZywgJ1wiXCInKSArICdcIic7XHJcbiAgfVxyXG4gIHJldHVybiBzdHI7XHJcbn1cclxuXHJcbi8qKlxyXG4gKiBDb252aWVydGUgdW4gYXJyYXkgZGUgdmFsb3JlcyBlbiB1bmEgbGluZWEgQ1NWIChzaW4gdHJhaWxpbmcgbmV3bGluZSkuXHJcbiAqIEFwbGljYSBjc3ZFc2NhcGUgYSBjYWRhIGNhbXBvIGRlc3B1ZXMgZGUgZmlyZXN0b3JlVmFsdWVUb0Nzdi5cclxuICogQHBhcmFtIHt1bmtub3duW119IGZpZWxkc1xyXG4gKiBAcmV0dXJucyB7c3RyaW5nfVxyXG4gKi9cclxuZXhwb3J0IGZ1bmN0aW9uIGNzdlJvdyhmaWVsZHMpIHtcclxuICByZXR1cm4gZmllbGRzLm1hcCgoZikgPT4gY3N2RXNjYXBlKGZpcmVzdG9yZVZhbHVlVG9Dc3YoZikpKS5qb2luKCcsJyk7XHJcbn1cclxuXHJcbi8qKlxyXG4gKiBDb252aWVydGUgdW4gdmFsb3IgZGUgRmlyZXN0b3JlL0pTIGEgc3RyaW5nIGFwdG8gcGFyYSBDU1YuXHJcbiAqIFJlZ2xhIHBvciB0aXBvOlxyXG4gKiAgIC0gbnVsbCAvIHVuZGVmaW5lZCAtPiAnJ1xyXG4gKiAgIC0gRmlyZXN0b3JlIFRpbWVzdGFtcCAodGllbmUgLnRvRGF0ZSkgLT4gSVNPIDg2MDEgVVRDXHJcbiAqICAgLSBEYXRlIC0+IElTTyA4NjAxIFVUQ1xyXG4gKiAgIC0gYm9vbGVhbiAtPiAndHJ1ZScgLyAnZmFsc2UnXHJcbiAqICAgLSBudW1iZXIgLT4gU3RyaW5nKG4pIGNvbiBwdW50byBkZWNpbWFsXHJcbiAqICAgLSBzdHJpbmcgLT4gdGFsIGN1YWwgKGNzdkVzY2FwZSB3cmFwcGVhIHNpIGhhY2UgZmFsdGEpXHJcbiAqICAgLSBBcnJheSAtPiBKU09OLnN0cmluZ2lmeVxyXG4gKiAgIC0gT2JqZWN0IC0+IEpTT04uc3RyaW5naWZ5XHJcbiAqIEBwYXJhbSB7dW5rbm93bn0gdlxyXG4gKiBAcmV0dXJucyB7c3RyaW5nfVxyXG4gKi9cclxuZXhwb3J0IGZ1bmN0aW9uIGZpcmVzdG9yZVZhbHVlVG9Dc3Yodikge1xyXG4gIGlmICh2ID09PSBudWxsIHx8IHYgPT09IHVuZGVmaW5lZCkgcmV0dXJuICcnO1xyXG4gIGlmICh0eXBlb2YgdiA9PT0gJ3N0cmluZycpIHJldHVybiB2O1xyXG4gIGlmICh0eXBlb2YgdiA9PT0gJ251bWJlcicpIHtcclxuICAgIGlmICghaXNGaW5pdGUodikpIHJldHVybiAnJzsgLy8gTmFOLCBJbmZpbml0eSAtPiB2YWNpbyAobm8gY29uZnVuZGlyIHBpcGVsaW5lcylcclxuICAgIHJldHVybiBTdHJpbmcodik7XHJcbiAgfVxyXG4gIGlmICh0eXBlb2YgdiA9PT0gJ2Jvb2xlYW4nKSByZXR1cm4gdiA/ICd0cnVlJyA6ICdmYWxzZSc7XHJcbiAgLy8gRmlyZXN0b3JlIFRpbWVzdGFtcFxyXG4gIGlmICh0eXBlb2YgdiA9PT0gJ29iamVjdCcgJiYgdiAhPT0gbnVsbCAmJiB0eXBlb2YgKC8qKiBAdHlwZSB7YW55fSAqLyh2KSkudG9EYXRlID09PSAnZnVuY3Rpb24nKSB7XHJcbiAgICB0cnkge1xyXG4gICAgICByZXR1cm4gKC8qKiBAdHlwZSB7YW55fSAqLyh2KSkudG9EYXRlKCkudG9JU09TdHJpbmcoKTtcclxuICAgIH0gY2F0Y2ggKF8pIHtcclxuICAgICAgcmV0dXJuICcnO1xyXG4gICAgfVxyXG4gIH1cclxuICBpZiAodiBpbnN0YW5jZW9mIERhdGUpIHtcclxuICAgIGlmIChpc05hTih2LmdldFRpbWUoKSkpIHJldHVybiAnJztcclxuICAgIHJldHVybiB2LnRvSVNPU3RyaW5nKCk7XHJcbiAgfVxyXG4gIGlmIChBcnJheS5pc0FycmF5KHYpKSB7XHJcbiAgICAvLyBKU09OLnN0cmluZ2lmeSBkZSBhcnJheS4gY3N2RXNjYXBlIGx1ZWdvIGxvIHdyYXBwZWEgc2kgaGF5IGNvbWFzLlxyXG4gICAgdHJ5IHsgcmV0dXJuIEpTT04uc3RyaW5naWZ5KHYpOyB9IGNhdGNoIChfKSB7IHJldHVybiAnJzsgfVxyXG4gIH1cclxuICBpZiAodHlwZW9mIHYgPT09ICdvYmplY3QnKSB7XHJcbiAgICB0cnkgeyByZXR1cm4gSlNPTi5zdHJpbmdpZnkodik7IH0gY2F0Y2ggKF8pIHsgcmV0dXJuICcnOyB9XHJcbiAgfVxyXG4gIHJldHVybiBTdHJpbmcodik7XHJcbn1cclxuXHJcbi8qKlxyXG4gKiBPYnRpZW5lIGVsIHZhbG9yIGRlIHVuIHBhdGggZG90LW5vdGF0aW9uIGVuIHVuIG9iamV0byBhbmlkYWRvLlxyXG4gKiBFajogZ2V0UGF0aCh7YToge2I6IHtjOiAxfX19LCAnYS5iLmMnKSAtPiAxXHJcbiAqIGdldFBhdGgoe30sICdhLmInKSAtPiB1bmRlZmluZWRcclxuICogQHBhcmFtIHtvYmplY3R9IG9ialxyXG4gKiBAcGFyYW0ge3N0cmluZ30gcGF0aFxyXG4gKiBAcmV0dXJucyB7dW5rbm93bn1cclxuICovXHJcbmV4cG9ydCBmdW5jdGlvbiBnZXRQYXRoKG9iaiwgcGF0aCkge1xyXG4gIGlmICghb2JqIHx8ICFwYXRoKSByZXR1cm4gdW5kZWZpbmVkO1xyXG4gIGNvbnN0IHBhcnRzID0gcGF0aC5zcGxpdCgnLicpO1xyXG4gIGxldCBjdXIgPSAvKiogQHR5cGUge2FueX0gKi8ob2JqKTtcclxuICBmb3IgKGNvbnN0IHAgb2YgcGFydHMpIHtcclxuICAgIGlmIChjdXIgPT09IG51bGwgfHwgY3VyID09PSB1bmRlZmluZWQpIHJldHVybiB1bmRlZmluZWQ7XHJcbiAgICBjdXIgPSBjdXJbcF07XHJcbiAgfVxyXG4gIHJldHVybiBjdXI7XHJcbn1cclxuXHJcbi8qKlxyXG4gKiBDb25zdHJ1eWUgZWwgQ1NWIGNvbXBsZXRvIChoZWFkZXIgKyBOIHJvd3MpIHBhcmEgdW5hIGNvbGVjY2lvbiBzZWd1blxyXG4gKiBzdSBzY2hlbWEuIENhZGEgYnVpbGRlciBkZXZ1ZWx2ZSB1biBhcnJheSBkZSBmaWxhcyAoY2FkYSBmaWxhID0gYXJyYXlcclxuICogZGUgdmFsb3JlcyBlbiBlbCBvcmRlbiBkZWwgc2NoZW1hKS5cclxuICogQHBhcmFtIHt7Y29sdW1uczoge2NvbDogc3RyaW5nfVtdfX0gc2NoZW1hXHJcbiAqIEBwYXJhbSB7dW5rbm93bltdW119IHJvd3NcclxuICogQHJldHVybnMge3N0cmluZ30gQ1NWIGNvbXBsZXRvIGNvbiBcXHJcXG4gY29tbyBsaW5lIHNlcGFyYXRvclxyXG4gKi9cclxuZXhwb3J0IGZ1bmN0aW9uIGJ1aWxkQ3N2KHNjaGVtYSwgcm93cykge1xyXG4gIGNvbnN0IGhlYWRlciA9IHNjaGVtYS5jb2x1bW5zLm1hcCgoYykgPT4gY3N2RXNjYXBlKGMuY29sKSkuam9pbignLCcpO1xyXG4gIGNvbnN0IGJvZHkgPSByb3dzLm1hcCgocikgPT4gY3N2Um93KHIpKS5qb2luKCdcXHJcXG4nKTtcclxuICByZXR1cm4gYm9keS5sZW5ndGggPyBoZWFkZXIgKyAnXFxyXFxuJyArIGJvZHkgKyAnXFxyXFxuJyA6IGhlYWRlciArICdcXHJcXG4nO1xyXG59XHJcblxyXG4vKipcclxuICogQ3VlbnRhIG51bGwgcmF0ZSBwb3IgY29sdW1uYSByZXF1ZXJpZGEuIFJldG9ybmFcclxuICoge2NvbE5hbWU6IHJhdGUgMC4uMX0uIFVuIHZhbG9yIGVzIFwibnVsbFwiIHNpIGZpcmVzdG9yZVZhbHVlVG9Dc3YgZGV2dWVsdmUgJycuXHJcbiAqIEBwYXJhbSB7e2NvbHVtbnM6IHtjb2w6IHN0cmluZ31bXX19IHNjaGVtYVxyXG4gKiBAcGFyYW0ge3Vua25vd25bXVtdfSByb3dzXHJcbiAqIEBwYXJhbSB7c3RyaW5nW119IHJlcXVpcmVkQ29sc1xyXG4gKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgbnVtYmVyPn1cclxuICovXHJcbmV4cG9ydCBmdW5jdGlvbiBjb21wdXRlTnVsbFJhdGVzKHNjaGVtYSwgcm93cywgcmVxdWlyZWRDb2xzKSB7XHJcbiAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBudW1iZXI+fSAqL1xyXG4gIGNvbnN0IHJlc3VsdCA9IHt9O1xyXG4gIGlmICghcm93cy5sZW5ndGgpIHtcclxuICAgIC8vIHNpbiBkYXRvczogbnVsbCByYXRlID0gMSAoMTAwJSBmYWx0YSkgcGFyYSBjYWRhIGNhbXBvIHJlcXVlcmlkb1xyXG4gICAgZm9yIChjb25zdCBjIG9mIHJlcXVpcmVkQ29scykgcmVzdWx0W2NdID0gMTtcclxuICAgIHJldHVybiByZXN1bHQ7XHJcbiAgfVxyXG4gIGNvbnN0IGNvbEluZGV4ID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBudW1iZXI+fSAqLyh7fSk7XHJcbiAgc2NoZW1hLmNvbHVtbnMuZm9yRWFjaCgoYywgaSkgPT4geyBjb2xJbmRleFtjLmNvbF0gPSBpOyB9KTtcclxuICBmb3IgKGNvbnN0IHJjIG9mIHJlcXVpcmVkQ29scykge1xyXG4gICAgY29uc3QgaWR4ID0gY29sSW5kZXhbcmNdO1xyXG4gICAgaWYgKGlkeCA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgIHJlc3VsdFtyY10gPSAxOyAvLyBjb2x1bW5hIG5vIGV4aXN0ZSBlbiBzY2hlbWEgLT4gY29uc2lkZXJhciBjb21vIDEwMCUgbnVsbFxyXG4gICAgICBjb250aW51ZTtcclxuICAgIH1cclxuICAgIGxldCBudWxscyA9IDA7XHJcbiAgICBmb3IgKGNvbnN0IHJvdyBvZiByb3dzKSB7XHJcbiAgICAgIGNvbnN0IHYgPSByb3dbaWR4XTtcclxuICAgICAgaWYgKGZpcmVzdG9yZVZhbHVlVG9Dc3YodikgPT09ICcnKSBudWxscysrO1xyXG4gICAgfVxyXG4gICAgcmVzdWx0W3JjXSA9IE1hdGgucm91bmQoKG51bGxzIC8gcm93cy5sZW5ndGgpICogMTAwMDApIC8gMTAwMDA7XHJcbiAgfVxyXG4gIHJldHVybiByZXN1bHQ7XHJcbn1cclxuXHJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG4vLyBEQVRBU0VUX1NDSEVNQVMgXHUyMDE0IDExIGNvbGVjY2lvbmVzIGNvbiBjb2x1bW5hcyArIHRpcG9zICsgZGVzY3JpcGNpb25lc1xyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxuXHJcbi8qKiBAdHlwZWRlZiB7e2NvbDogc3RyaW5nLCB0eXBlOiBzdHJpbmcsIGRlc2M6IHN0cmluZ319IFNjaGVtYUNvbHVtbiAqL1xyXG4vKiogQHR5cGVkZWYge3tuYW1lOiBzdHJpbmcsIHNvdXJjZTogJ2ZpcmVzdG9yZSd8J3N0b2NrX2pzb24nLCBjb2xsZWN0aW9uPzogc3RyaW5nLCByb3dNb2RlOiBzdHJpbmcsIGNvbHVtbnM6IFNjaGVtYUNvbHVtbltdfX0gRGF0YXNldFNjaGVtYSAqL1xyXG5cclxuLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBEYXRhc2V0U2NoZW1hPn0gKi9cclxuZXhwb3J0IGNvbnN0IERBVEFTRVRfU0NIRU1BUyA9IHtcclxuICBwZWRpZG9zOiB7XHJcbiAgICBuYW1lOiAncGVkaWRvcy5jc3YnLFxyXG4gICAgc291cmNlOiAnZmlyZXN0b3JlJyxcclxuICAgIGNvbGxlY3Rpb246ICdwZWRpZG9zJyxcclxuICAgIHJvd01vZGU6ICdmbGF0dGVuX2xpbmVzJywgLy8gMSBmaWxhIHBvciAocGVkaWRvLCBsaW5lYSlcclxuICAgIGNvbHVtbnM6IFtcclxuICAgICAge2NvbDogJ3BlZGlkb19pZCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnRmlyZXN0b3JlIGRvYyBJRCd9LFxyXG4gICAgICB7Y29sOiAnb3duZXJfdWlkJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdVSUQgZGVsIHZlbmRlZG9yIGR1ZW5pbyBkZWwgcGVkaWRvJ30sXHJcbiAgICAgIHtjb2w6ICdvd25lcl9lbWFpbCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnZW1haWwgZGVsIHZlbmRlZG9yJ30sXHJcbiAgICAgIHtjb2w6ICdjcmVhdGVkX2J5X3VpZCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAncXVpZW4gY2FyZ28gKFZESSBwdWVkZSBjYXJnYXIgcG9yIFZERSknfSxcclxuICAgICAge2NvbDogJ29uX2JlaGFsZl9vZicsIHR5cGU6ICdib29sZWFuJywgZGVzYzogJ3RydWUgc2kgVkRJIGNhcmdvIHBvciBWREUnfSxcclxuICAgICAge2NvbDogJ2tleScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnY2xhdmUgY29tcHVlc3RhIHRpcG98cHJvdnxsb2N8Y2xpZW50ZSd9LFxyXG4gICAgICB7Y29sOiAnc3RhZ2UnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ3BlbmRpbmcgfCBjb25maXJtZWQgfCBzYXBfaW1wb3J0ZWQnfSxcclxuICAgICAge2NvbDogJ3RpcG8nLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ0M9Y2xpZW50ZSB8IFA9cHJvc3BlY3RvJ30sXHJcbiAgICAgIHtjb2w6ICdwcm92aW5jZScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAncHJvdmluY2lhJ30sXHJcbiAgICAgIHtjb2w6ICdsb2NfbmFtZScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnbG9jYWxpZGFkJ30sXHJcbiAgICAgIHtjb2w6ICdjbGllbnRfbmFtZScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnbm9tYnJlIGNsaWVudGUnfSxcclxuICAgICAge2NvbDogJ21vbnRoJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdlaiBcIkp1bGlvIDIwMjZcIid9LFxyXG4gICAgICB7Y29sOiAnbW9udGhfaWR4JywgdHlwZTogJ2ludCcsIGRlc2M6ICcwLTExJ30sXHJcbiAgICAgIHtjb2w6ICd5ZWFyJywgdHlwZTogJ2ludCcsIGRlc2M6ICdhbm8nfSxcclxuICAgICAge2NvbDogJ2NvbmZpcm1lZF9hdCcsIHR5cGU6ICdpc284NjAxJywgZGVzYzogJ3RpbWVzdGFtcCBVVEMgZGUgY29uZmlybWFjaW9uJ30sXHJcbiAgICAgIHtjb2w6ICdjb25kaWNpb25fcGFnbycsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnZWogQ1RBIENURSd9LFxyXG4gICAgICB7Y29sOiAnZm9ybWFfZW50cmVnYV90aXBvJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdUUkFOU1BPUlRJU1RBIHwgU1VDVVJTQUwnfSxcclxuICAgICAge2NvbDogJ2Zvcm1hX2VudHJlZ2FfdHJhbnNwX25vbWJyZScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJ30sXHJcbiAgICAgIHtjb2w6ICdmb3JtYV9lbnRyZWdhX3RyYW5zcF9kaXJlY2Npb24nLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJyd9LFxyXG4gICAgICB7Y29sOiAnZm9ybWFfZW50cmVnYV9jbGllbnRlX2RpcmVjY2lvbicsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnZGVzdGlubyBmaW5hbCd9LFxyXG4gICAgICB7Y29sOiAnZm9ybWFfZW50cmVnYV9zdWN1cnNhbF9kaXJlY2Npb24nLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJyd9LFxyXG4gICAgICB7Y29sOiAnZGlzY291bnRfcGN0JywgdHlwZTogJ251bWJlcicsIGRlc2M6ICdkZXNjdWVudG8gdG90YWwgZGVsIHBlZGlkbyAoYXBsaWNhZG8gYSBuaXZlbCBoZWFkZXIsIHByb3JyYXRlYXIgZW4gcGlwZWxpbmUpJ30sXHJcbiAgICAgIHtjb2w6ICdzdWJ0b3RhbF9hcnMnLCB0eXBlOiAnbnVtYmVyJywgZGVzYzogJ3N1YnRvdGFsIGJydXRvIEFSUyd9LFxyXG4gICAgICB7Y29sOiAnbmV0X2Ftb3VudF9hcnMnLCB0eXBlOiAnbnVtYmVyJywgZGVzYzogJ25ldG8gQVJTIHBvc3QtZGVzY3VlbnRvJ30sXHJcbiAgICAgIHtjb2w6ICd0cmFuc2Zlcmlkb19zYXBfdmlhJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdkdHdfbWFudWFsIHwgc2VydmljZV9sYXllcid9LFxyXG4gICAgICB7Y29sOiAndHJhbnNmZXJpZG9fc2FwX2RvY19udW0nLCB0eXBlOiAnaW50JywgZGVzYzogJ251bWVybyBkZSBRdW90YXRpb24gU0FQJ30sXHJcbiAgICAgIHtjb2w6ICd0cmFuc2Zlcmlkb19zYXBfZG9jX2VudHJ5JywgdHlwZTogJ2ludCcsIGRlc2M6ICdkb2MgZW50cnkgaW50ZXJubyBTQVAnfSxcclxuICAgICAge2NvbDogJ3RyYW5zZmVyaWRvX3NhcF9hdCcsIHR5cGU6ICdpc284NjAxJywgZGVzYzogJ3RpbWVzdGFtcCBVVEMnfSxcclxuICAgICAge2NvbDogJ2NyZWF0ZWRfYXQnLCB0eXBlOiAnaXNvODYwMScsIGRlc2M6ICd0aW1lc3RhbXAgVVRDJ30sXHJcbiAgICAgIHtjb2w6ICdsaW5lX2luZGV4JywgdHlwZTogJ2ludCcsIGRlc2M6ICdpbmRpY2UgZGUgbGluZWEgMC1iYXNlZCd9LFxyXG4gICAgICB7Y29sOiAnbGluZV9jb2RlJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdTS1UnfSxcclxuICAgICAge2NvbDogJ2xpbmVfZGVzYycsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnZGVzY3JpcGNpb24gcHJvZHVjdG8nfSxcclxuICAgICAge2NvbDogJ2xpbmVfcXR5JywgdHlwZTogJ251bWJlcicsIGRlc2M6ICdjYW50aWRhZCd9LFxyXG4gICAgICB7Y29sOiAnbGluZV9wcmVjaW8nLCB0eXBlOiAnbnVtYmVyJywgZGVzYzogJ3ByZWNpbyB1bml0YXJpbyBBUlMnfSxcclxuICAgICAge2NvbDogJ2xpbmVfY2F0JywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdjYXRlZ29yaWEnfSxcclxuICAgICAge2NvbDogJ2xpbmVfZmFtJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdmYW1pbGlhJ30sXHJcbiAgICAgIHtjb2w6ICdsaW5lX3N1YicsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnc3ViZmFtaWxpYSd9LFxyXG4gICAgXSxcclxuICB9LFxyXG4gIHZpc2l0YXM6IHtcclxuICAgIG5hbWU6ICd2aXNpdGFzLmNzdicsXHJcbiAgICBzb3VyY2U6ICdmaXJlc3RvcmUnLFxyXG4gICAgY29sbGVjdGlvbjogJ3Zpc2l0cycsXHJcbiAgICByb3dNb2RlOiAnb25lX3Blcl9kb2MnLFxyXG4gICAgY29sdW1uczogW1xyXG4gICAgICB7Y29sOiAndmlzaXRfaWQnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ0ZpcmVzdG9yZSBkb2MgSUQnfSxcclxuICAgICAge2NvbDogJ293bmVyX3VpZCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnVUlEIGRlbCB2ZW5kZWRvcid9LFxyXG4gICAgICB7Y29sOiAnb3duZXJfZW1haWwnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ2VtYWlsIGRlbCB2ZW5kZWRvcid9LFxyXG4gICAgICB7Y29sOiAnZmVjaGEnLCB0eXBlOiAnaXNvODYwMScsIGRlc2M6ICdZWVlZLU1NLUREIChmZWNoYSBkZSB2aXNpdGEsIG5vIFVUQyknfSxcclxuICAgICAge2NvbDogJ21lcycsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnSlVOSU8sIEpVTElPLCBldGMuJ30sXHJcbiAgICAgIHtjb2w6ICdhbmlvJywgdHlwZTogJ2ludCcsIGRlc2M6ICdhbm8nfSxcclxuICAgICAge2NvbDogJ3ZlbmRvcicsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnbm9tYnJlIGNhbm9uaWNvIHZlbmRlZG9yJ30sXHJcbiAgICAgIHtjb2w6ICdwcm92aW5jaWEnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ3Byb3ZpbmNpYSd9LFxyXG4gICAgICB7Y29sOiAnbG9jYWxpZGFkJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdsb2NhbGlkYWQnfSxcclxuICAgICAge2NvbDogJ3RpZW5kYScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnbm9tYnJlIHRpZW5kYSd9LFxyXG4gICAgICB7Y29sOiAndGlwbycsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnQyB8IFAnfSxcclxuICAgICAge2NvbDogJ2xvY2FsJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdlaiBQcm9waW8sIEFscXVpbGFkbyd9LFxyXG4gICAgICB7Y29sOiAndGFtYW5vJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdlaiBDaGljbywgTWVkaWFubywgR3JhbmRlJ30sXHJcbiAgICAgIHtjb2w6ICdmaWRlbGlkYWQnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ0FsdGEsIE1lZGlhLCBCYWphJ30sXHJcbiAgICAgIHtjb2w6ICdyZWxldmFuY2lhJywgdHlwZTogJ2ludCcsIGRlc2M6ICcwLTUnfSxcclxuICAgICAge2NvbDogJ3BvcCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnZWogU3RpY2tlcnMgU2hpbWFubyd9LFxyXG4gICAgICB7Y29sOiAnbmVjZXNpZGFkX3B1bnR1YWwnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJyd9LFxyXG4gICAgICB7Y29sOiAndGlwb192ZW50YScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnZWogQ2FzYSBkZSBwZXNjYSArIGVjb21tZXJjZSd9LFxyXG4gICAgICB7Y29sOiAncG9uZGVyYWNpb25fbW9zdHJhZG8nLCB0eXBlOiAnaW50JywgZGVzYzogJzAtMTAwJ30sXHJcbiAgICAgIHtjb2w6ICdwb25kZXJhY2lvbl9lY29tbWVyY2UnLCB0eXBlOiAnaW50JywgZGVzYzogJzAtMTAwJ30sXHJcbiAgICAgIHtjb2w6ICdjb21wZXRlbmNpYScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJ30sXHJcbiAgICAgIHtjb2w6ICdvcG9ydHVuaWRhZCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJ30sXHJcbiAgICAgIHtjb2w6ICdtYXNfdmVuZGlkbycsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJ30sXHJcbiAgICAgIHtjb2w6ICdtYXNfcHJlZ3VudGFuJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnfSxcclxuICAgICAge2NvbDogJ2F5dWRhX3RpZW5kYScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJ30sXHJcbiAgICAgIHtjb2w6ICdncHNfc3RhdHVzJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdvayB8IG91dHNpZGUgfCBub2xvYyd9LFxyXG4gICAgICB7Y29sOiAnZ3BzX2Rpc3RhbmNlX20nLCB0eXBlOiAnbnVtYmVyJywgZGVzYzogJ21ldHJvcyd9LFxyXG4gICAgICB7Y29sOiAnaW50ZXJhY3Rpb25fdHlwZScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAndmlzaXRhIHwgY29udGFjdG8nfSxcclxuICAgICAge2NvbDogJ2Zvcm1hX2NvbnRhY3RvJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdMTEFNQURBIFRFTEVGT05JQ0EgfCBNRU5TQUpFIERFIFdIQVRTQVBQIHwgTUVOU0FKRSBTTVMgKHNpIGNvbnRhY3RvKSd9LFxyXG4gICAgICB7Y29sOiAnY29udGFjdG9fcmVzdWx0YWRvJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdyZXNwb25kaW8gfCBub19yZXNwb25kaW8gfCB2YWNpbyAoc2luIG1hcmNhciwgc29sbyBhcGxpY2EgYSBjb250YWN0byknfSxcclxuICAgICAge2NvbDogJ2NvbnRhY3RvX3Jlc3VsdGFkb19hdCcsIHR5cGU6ICdpc284NjAxJywgZGVzYzogJ3RpbWVzdGFtcCBVVEMnfSxcclxuICAgICAge2NvbDogJ2NvbnRhY3RvX3Jlc3VsdGFkb19ieScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnVUlEIGRlIHF1aWVuIG1hcmNvJ30sXHJcbiAgICAgIHtjb2w6ICdjcmVhdGVkX2F0JywgdHlwZTogJ2lzbzg2MDEnLCBkZXNjOiAndGltZXN0YW1wIFVUQyd9LFxyXG4gICAgXSxcclxuICB9LFxyXG4gIGNsaWVudGVzOiB7XHJcbiAgICBuYW1lOiAnY2xpZW50ZXMuY3N2JyxcclxuICAgIHNvdXJjZTogJ2ZpcmVzdG9yZScsXHJcbiAgICBjb2xsZWN0aW9uOiAnY2xpZW50X2FwcGxpY2F0aW9ucycsXHJcbiAgICByb3dNb2RlOiAnb25lX3Blcl9kb2MnLFxyXG4gICAgY29sdW1uczogW1xyXG4gICAgICB7Y29sOiAnYXBwX2lkJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdGaXJlc3RvcmUgZG9jIElEJ30sXHJcbiAgICAgIHtjb2w6ICdvd25lcl91aWQnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJyd9LFxyXG4gICAgICB7Y29sOiAnb3duZXJfZW1haWwnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJyd9LFxyXG4gICAgICB7Y29sOiAnb3duZXJfbmFtZScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJ30sXHJcbiAgICAgIHtjb2w6ICdjb21lcmNpbycsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAncmF6b24gc29jaWFsJ30sXHJcbiAgICAgIHtjb2w6ICdmYW50YXNpYScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnbm9tYnJlIGNvbWVyY2lhbCd9LFxyXG4gICAgICB7Y29sOiAnY3VpdCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnc29sbyBkaWdpdG9zIHBvc3QtdjI5NCd9LFxyXG4gICAgICB7Y29sOiAnY29uZGljaW9uX2Zpc2NhbCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJ30sXHJcbiAgICAgIHtjb2w6ICdjYWxsZScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJ30sXHJcbiAgICAgIHtjb2w6ICdudW1lcm8nLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJyd9LFxyXG4gICAgICB7Y29sOiAnbG9jYWxpZGFkJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnfSxcclxuICAgICAge2NvbDogJ3Byb3ZpbmNpYScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJ30sXHJcbiAgICAgIHtjb2w6ICdsb2NhbGlkYWRfZmluYWwnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ292ZXJyaWRlIGRlbCBhcHJvYmFkb3InfSxcclxuICAgICAge2NvbDogJ2NhcmRfY29kZV9zYXAnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ0NhcmRDb2RlIFNBUCd9LFxyXG4gICAgICB7Y29sOiAnYXNzaWduZWRfdmVuZG9yJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICd2ZW5kZWRvciBhc2lnbmFkbyAoc291cmNlIG9mIHRydXRoIHYzMTErKSd9LFxyXG4gICAgICB7Y29sOiAnc3RhdHVzJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdwZW5kaW5nX2FwcHJvdmFsIHwgYXBwcm92ZWQgfCByZWplY3RlZCd9LFxyXG4gICAgICB7Y29sOiAnc291cmNlJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdtYW51YWwgfCBzYXBfYnVsa19pbXBvcnQgfCBhbHRhX3JhcGlkYSB8IHNhcF9zeW5jIHwgc2FwX3N5bmNfbWFudWFsX2xpbmsnfSxcclxuICAgICAge2NvbDogJ21hbnVhbF9zYXBfcGVuZGluZycsIHR5cGU6ICdib29sZWFuJywgZGVzYzogJ3RydWU9cHJvdmlzb3JpbyAoQWx0YSBSYXBpZGEgc2luIENhcmRDb2RlKSd9LFxyXG4gICAgICB7Y29sOiAncHJlY2F1Y2lvbicsIHR5cGU6ICdib29sZWFuJywgZGVzYzogJ3RydWU9Y2xpZW50ZSBtYXJjYWRvIHBvciBpbXBhZ28nfSxcclxuICAgICAge2NvbDogJ2NhdGVnb3JpYV9jbGllbnRlJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdQL0EvQi9DJ30sXHJcbiAgICAgIHtjb2w6ICdjbGlfdGlwbycsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnQyBkZWZhdWx0IHBvc3QtdjM0OSd9LFxyXG4gICAgICB7Y29sOiAnbGF0JywgdHlwZTogJ251bWJlcicsIGRlc2M6ICdnZW9sYXQnfSxcclxuICAgICAge2NvbDogJ2xuZycsIHR5cGU6ICdudW1iZXInLCBkZXNjOiAnZ2VvbG5nJ30sXHJcbiAgICAgIHtjb2w6ICdoYXNfZ2VvJywgdHlwZTogJ2Jvb2xlYW4nLCBkZXNjOiAnbGF0L2xuZyBubyBudWxsJ30sXHJcbiAgICAgIHtjb2w6ICdoYXNfYWRkcmVzcycsIHR5cGU6ICdib29sZWFuJywgZGVzYzogJ2NhbGxlIG5vIHZhY2lhJ30sXHJcbiAgICAgIHtjb2w6ICdzdWJtaXR0ZWRfYnlfcHVibGljX2Zvcm0nLCB0eXBlOiAnYm9vbGVhbicsIGRlc2M6ICd2aWEgYWx0YS1jbGllbnRlLmh0bWwnfSxcclxuICAgICAge2NvbDogJ2FwcHJvdmVkX2F0JywgdHlwZTogJ2lzbzg2MDEnLCBkZXNjOiAnJ30sXHJcbiAgICAgIHtjb2w6ICdjcmVhdGVkX2F0JywgdHlwZTogJ2lzbzg2MDEnLCBkZXNjOiAnJ30sXHJcbiAgICAgIHtjb2w6ICd1cGRhdGVkX2F0JywgdHlwZTogJ2lzbzg2MDEnLCBkZXNjOiAnJ30sXHJcbiAgICBdLFxyXG4gIH0sXHJcbiAgY2xpZW50X21hc3Rlcjoge1xyXG4gICAgbmFtZTogJ2NsaWVudF9tYXN0ZXIuY3N2JyxcclxuICAgIHNvdXJjZTogJ2ZpcmVzdG9yZScsXHJcbiAgICBjb2xsZWN0aW9uOiAnY2xpZW50X21hc3RlcicsXHJcbiAgICByb3dNb2RlOiAnb25lX3Blcl9kb2MnLFxyXG4gICAgY29sdW1uczogW1xyXG4gICAgICB7Y29sOiAnbWFzdGVyX2lkJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdGaXJlc3RvcmUgZG9jIElEJ30sXHJcbiAgICAgIHtjb2w6ICdjbGllbnRfbmFtZScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJ30sXHJcbiAgICAgIHtjb2w6ICdwcm92aW5jaWEnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJyd9LFxyXG4gICAgICB7Y29sOiAnbG9jYWxpZGFkJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnfSxcclxuICAgICAge2NvbDogJ3ZlbmRvcicsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAndmVuZGVkb3IgY3VyYWRvIGFkbWluJ30sXHJcbiAgICAgIHtjb2w6ICdhZGRyZXNzJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdkaXJlY2Npb24gY3VyYWRhIGFkbWluJ30sXHJcbiAgICAgIHtjb2w6ICdzYXBfY2FyZF9jb2RlJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdDYXJkQ29kZSBTQVAnfSxcclxuICAgICAge2NvbDogJ3NhcF9hZGRyZXNzJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdkaXJlY2Npb24gcmF3IFNBUCd9LFxyXG4gICAgICB7Y29sOiAnc2FwX2NpdHknLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJyd9LFxyXG4gICAgICB7Y29sOiAnc2FwX3N0YXRlJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnfSxcclxuICAgICAge2NvbDogJ3NhcF9pbXBvcnRlZF9hdCcsIHR5cGU6ICdpc284NjAxJywgZGVzYzogJyd9LFxyXG4gICAgICB7Y29sOiAnc2FwX2ltcG9ydGVkX2J5JywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnfSxcclxuICAgICAge2NvbDogJ2NsaWVudF9uYW1lX29yaWdpbmFsJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdiYWNrdXAgbm9tYnJlIHByZS1pbXBvcnQnfSxcclxuICAgICAge2NvbDogJ2xvY2FsaWRhZF9vcmlnaW5hbCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnYmFja3VwIGxvY2FsaWRhZCBwcmUtaW1wb3J0J30sXHJcbiAgICAgIHtjb2w6ICdtYXRjaF90eXBlJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdleGFjdCB8IGZ1enp5J30sXHJcbiAgICAgIHtjb2w6ICdtYXRjaF9zaW1pbGFyaXR5JywgdHlwZTogJ251bWJlcicsIGRlc2M6ICcwLTEnfSxcclxuICAgICAge2NvbDogJ3VwZGF0ZWRfYXQnLCB0eXBlOiAnaXNvODYwMScsIGRlc2M6ICcnfSxcclxuICAgICAge2NvbDogJ3VwZGF0ZWRfYnknLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJyd9LFxyXG4gICAgXSxcclxuICB9LFxyXG4gIHJlbmRpY2lvbmVzOiB7XHJcbiAgICBuYW1lOiAncmVuZGljaW9uZXMuY3N2JyxcclxuICAgIHNvdXJjZTogJ2ZpcmVzdG9yZScsXHJcbiAgICBjb2xsZWN0aW9uOiAncmVuZGljaW9uZXMnLFxyXG4gICAgcm93TW9kZTogJ29uZV9wZXJfZG9jJyxcclxuICAgIGNvbHVtbnM6IFtcclxuICAgICAge2NvbDogJ3JlbmRpY2lvbl9pZCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnRmlyZXN0b3JlIGRvYyBJRCd9LFxyXG4gICAgICB7Y29sOiAnb3duZXJfdWlkJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnfSxcclxuICAgICAge2NvbDogJ293bmVyX2VtYWlsJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnfSxcclxuICAgICAge2NvbDogJ3ZlbmRvcicsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJ30sXHJcbiAgICAgIHtjb2w6ICd0aXBvJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdnYXN0byB8IHNvbGljaXR1ZCd9LFxyXG4gICAgICB7Y29sOiAndGlwb19nYXN0bycsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnZWogUEVBSkVTLCBGQUNUVVJBIEEsIEdBU1RPIENPTiBDT01QUk9CQU5URSd9LFxyXG4gICAgICB7Y29sOiAnaW1wb3J0ZV9hcnMnLCB0eXBlOiAnbnVtYmVyJywgZGVzYzogJ21vbnRvIEFSUyd9LFxyXG4gICAgICB7Y29sOiAnZmVjaGFfZ2FzdG8nLCB0eXBlOiAnaXNvODYwMScsIGRlc2M6ICdZWVlZLU1NLUREIGRlbCBnYXN0byd9LFxyXG4gICAgICB7Y29sOiAnY29uY2VwdG8nLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ2Rlc2NyaXBjaW9uIGxpYnJlJ30sXHJcbiAgICAgIHtjb2w6ICdmb3RvX3RpY2tldF91cmwnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ1VSTCBGaXJlYmFzZSBTdG9yYWdlIHYzMDgrIChudW5jYSBiYXNlNjQpJ30sXHJcbiAgICAgIHtjb2w6ICdzdGF0dXMnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ3BlbmRpbmdfYXBwcm92YWwgfCBhcHByb3ZlZCB8IHJlamVjdGVkJ30sXHJcbiAgICAgIHtjb2w6ICdhcHByb3ZlZF9ieScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnZW1haWwgZGVsIGFwcm9iYWRvciBvIFwic2VsZlwiJ30sXHJcbiAgICAgIHtjb2w6ICdhcHByb3ZlZF9hdCcsIHR5cGU6ICdpc284NjAxJywgZGVzYzogJyd9LFxyXG4gICAgICB7Y29sOiAncmVqZWN0ZWRfYnlfZW1haWwnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJyd9LFxyXG4gICAgICB7Y29sOiAncmVqZWN0ZWRfcmVhc29uJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnfSxcclxuICAgICAge2NvbDogJ2FwcHJvdmVyX3VpZCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnVUlEIHJlc3BvbnNhYmxlIGFzaWduYWRvJ30sXHJcbiAgICAgIHtjb2w6ICdjcmVhdGVkX2F0JywgdHlwZTogJ2lzbzg2MDEnLCBkZXNjOiAnJ30sXHJcbiAgICBdLFxyXG4gIH0sXHJcbiAgY2FtcGFuaWFzOiB7XHJcbiAgICBuYW1lOiAnY2FtcGFuaWFzLmNzdicsXHJcbiAgICBzb3VyY2U6ICdmaXJlc3RvcmUnLFxyXG4gICAgY29sbGVjdGlvbjogJ2NhbXBhaWducycsXHJcbiAgICByb3dNb2RlOiAnb25lX3Blcl9kb2MnLFxyXG4gICAgY29sdW1uczogW1xyXG4gICAgICB7Y29sOiAnY2FtcGFpZ25faWQnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ0ZpcmVzdG9yZSBkb2MgSUQnfSxcclxuICAgICAge2NvbDogJ25hbWUnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ25vbWJyZSBjYW1wYW5hJ30sXHJcbiAgICAgIHtjb2w6ICdmYW1pbGlhJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdlaiBSRUVMUyd9LFxyXG4gICAgICB7Y29sOiAnc3ViZmFtaWxpYScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnZWogTVVMVElQTElDQURPUkVTJ30sXHJcbiAgICAgIHtjb2w6ICdmaWx0ZXJfdHlwZScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnc2t1IChob3kgaGFyZGNvZGVkKSd9LFxyXG4gICAgICB7Y29sOiAnZmlsdGVyX3ZhbHVlc19qc29uJywgdHlwZTogJ2pzb25fYXJyYXknLCBkZXNjOiAnY29waWEgZGUgc2t1cyd9LFxyXG4gICAgICB7Y29sOiAnc2t1c19qc29uJywgdHlwZTogJ2pzb25fYXJyYXknLCBkZXNjOiAnSXRlbUNvZGVzIGluY2x1aWRvcyd9LFxyXG4gICAgICB7Y29sOiAnc2t1c19jb3VudCcsIHR5cGU6ICdpbnQnLCBkZXNjOiAnY2FudGlkYWQgU0tVcyd9LFxyXG4gICAgICB7Y29sOiAndGFyZ2V0X3R5cGUnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ3VuaXRzIHwgbW9uZXknfSxcclxuICAgICAge2NvbDogJ3RhcmdldF9hbW91bnQnLCB0eXBlOiAnbnVtYmVyJywgZGVzYzogJ29iamV0aXZvJ30sXHJcbiAgICAgIHtjb2w6ICdzdGFydF9kYXRlJywgdHlwZTogJ2lzbzg2MDEnLCBkZXNjOiAnWVlZWS1NTS1ERCd9LFxyXG4gICAgICB7Y29sOiAnZW5kX2RhdGUnLCB0eXBlOiAnaXNvODYwMScsIGRlc2M6ICdZWVlZLU1NLUREJ30sXHJcbiAgICAgIHtjb2w6ICdzY29wZScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnYWxsIHwgcHJvdmluY2UgfCB2ZW5kb3InfSxcclxuICAgICAge2NvbDogJ3Njb3BlX3ZhbHVlc19qc29uJywgdHlwZTogJ2pzb25fYXJyYXknLCBkZXNjOiAncHJvdmluY2lhcyBvIHZlbmRvciBrZXlzIHNpIHNjb3BlICE9IGFsbCd9LFxyXG4gICAgICB7Y29sOiAnY3JlYXRlZF9ieScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnVUlEIGFkbWluL2dlcmVudGUnfSxcclxuICAgICAge2NvbDogJ2NyZWF0ZWRfYnlfZW1haWwnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJyd9LFxyXG4gICAgICB7Y29sOiAnY3JlYXRlZF9hdCcsIHR5cGU6ICdpc284NjAxJywgZGVzYzogJyd9LFxyXG4gICAgICB7Y29sOiAnYXJjaGl2ZWRfbWFudWFsbHknLCB0eXBlOiAnYm9vbGVhbicsIGRlc2M6ICd0cnVlPWZpbmFsaXphZGEgYW50ZXMgZGUgZW5kRGF0ZSd9LFxyXG4gICAgICB7Y29sOiAnYXJjaGl2ZWRfYXQnLCB0eXBlOiAnaXNvODYwMScsIGRlc2M6ICcnfSxcclxuICAgICAge2NvbDogJ2FyY2hpdmVkX2J5JywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnfSxcclxuICAgIF0sXHJcbiAgfSxcclxuICB0YXJnZXRzOiB7XHJcbiAgICBuYW1lOiAndGFyZ2V0cy5jc3YnLFxyXG4gICAgc291cmNlOiAnZmlyZXN0b3JlJyxcclxuICAgIGNvbGxlY3Rpb246ICd0YXJnZXRzJyxcclxuICAgIHJvd01vZGU6ICdvbmVfcGVyX2RvYycsXHJcbiAgICBjb2x1bW5zOiBbXHJcbiAgICAgIHtjb2w6ICd0YXJnZXRfaWQnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ0ZpcmVzdG9yZSBkb2MgSUQgY2Fub25pY28ge3ZlbmRvcn1fe3llYXJ9X3tNTX0nfSxcclxuICAgICAge2NvbDogJ3NlbGxlcl9pZCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAndmVuZG9yS2V5IHVwcGVyY2FzZSBlaiBHT05aQUxPIERFIExBIFJPU0EnfSxcclxuICAgICAge2NvbDogJ3llYXInLCB0eXBlOiAnaW50JywgZGVzYzogJ2VqIDIwMjYnfSxcclxuICAgICAge2NvbDogJ21vbnRoJywgdHlwZTogJ2ludCcsIGRlc2M6ICcwLTExIChpbmRpY2UgZGVsIGFycmF5IE1FU0VTIDAtaW5kZXhlZCknfSxcclxuICAgICAge2NvbDogJ3RhcmdldF9hcnMnLCB0eXBlOiAnbnVtYmVyJywgZGVzYzogJ29iamV0aXZvIG1lcyBBUlMgKHN1bWEgZmFtaWxpYXMpJ30sXHJcbiAgICAgIHtjb2w6ICd0YXJnZXRfcmVlbF9hcnMnLCB0eXBlOiAnbnVtYmVyJywgZGVzYzogJ3YzMTErIGRlc2dsb3NlJ30sXHJcbiAgICAgIHtjb2w6ICd0YXJnZXRfY2FuYXNfYXJzJywgdHlwZTogJ251bWJlcicsIGRlc2M6ICd2MzExKyBkZXNnbG9zZSd9LFxyXG4gICAgICB7Y29sOiAndGFyZ2V0X2xpbmVhc19hcnMnLCB0eXBlOiAnbnVtYmVyJywgZGVzYzogJ3YzMTErIGRlc2dsb3NlJ30sXHJcbiAgICAgIHtjb2w6ICd1cGRhdGVkX2F0JywgdHlwZTogJ2lzbzg2MDEnLCBkZXNjOiAnJ30sXHJcbiAgICAgIHtjb2w6ICd1cGRhdGVkX2J5JywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdVSUQnfSxcclxuICAgICAge2NvbDogJ3VwZGF0ZWRfYnlfZW1haWwnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJyd9LFxyXG4gICAgXSxcclxuICB9LFxyXG4gIHByb2R1Y3Rvczoge1xyXG4gICAgbmFtZTogJ3Byb2R1Y3Rvcy5jc3YnLFxyXG4gICAgc291cmNlOiAnc3RvY2tfanNvbicsXHJcbiAgICByb3dNb2RlOiAnZnJvbV9zdG9ja19qc29uJyxcclxuICAgIGNvbHVtbnM6IFtcclxuICAgICAge2NvbDogJ3NrdScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnU0tVIChJdGVtQ29kZSBTQVApJ30sXHJcbiAgICAgIHtjb2w6ICdoYXNfc3RvY2snLCB0eXBlOiAnYm9vbGVhbicsIGRlc2M6ICd0cnVlPWhheSB1bmlkYWRlcyBlbiBhbGd1biB3aHMgdmVuZGlibGUnfSxcclxuICAgICAge2NvbDogJ2NhbnRpZGFkX3RvdGFsJywgdHlwZTogJ2ludCcsIGRlc2M6ICdzdW1hIHRvdGFsIHdocyB2ZW5kaWJsZXMgKGV4Y2x1eWUgMDUgeSAwNiknfSxcclxuICAgICAge2NvbDogJ2Rpc3BvbmlibGVfdmVudGFfd2hzMTEnLCB0eXBlOiAnaW50JywgZGVzYzogJ3YzNjkrIE1lcmNhZGVyaWEgTlVSIFBFU0NBICh2ZW50YSBkaXJlY3RhKSd9LFxyXG4gICAgICB7Y29sOiAndHJhbnNpdG9fd2hzMTInLCB0eXBlOiAnaW50JywgZGVzYzogJ3YzNjkrIEVuIHRyYW5zaXRvIFBFU0NBIChiYWNrb3JkZXIgZnV0dXJvKSd9LFxyXG4gICAgICB7Y29sOiAnb3Ryb3Nfd2FyZWhvdXNlc19qc29uJywgdHlwZTogJ2pzb25fb2JqZWN0JywgZGVzYzogJ290cm9zIGNvZGlnb3MgY29uIGNhbnRpZGFkLCBlaiB7XCI5OFwiOiA1fSd9LFxyXG4gICAgICB7Y29sOiAnc291cmNlJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdzdG9jay5qc29uIHNuYXBzaG90J30sXHJcbiAgICAgIHtjb2w6ICdzbmFwc2hvdF91cGRhdGVkX2F0JywgdHlwZTogJ2lzbzg2MDEnLCBkZXNjOiAndGltZXN0YW1wIGRlbCB1bHRpbW8gc3luYyBTQVAnfSxcclxuICAgIF0sXHJcbiAgfSxcclxuICB2ZW5kb3Jfb3ZlcnJpZGVzOiB7XHJcbiAgICBuYW1lOiAndmVuZG9yX292ZXJyaWRlcy5jc3YnLFxyXG4gICAgc291cmNlOiAnZmlyZXN0b3JlJyxcclxuICAgIGNvbGxlY3Rpb246ICd2ZW5kb3Jfb3ZlcnJpZGVzJyxcclxuICAgIHJvd01vZGU6ICdvbmVfcGVyX2RvYycsXHJcbiAgICBjb2x1bW5zOiBbXHJcbiAgICAgIHtjb2w6ICdvdmVycmlkZV9pZCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnRmlyZXN0b3JlIGRvYyBJRCd9LFxyXG4gICAgICB7Y29sOiAnc2NvcGUnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ3Nob3AgfCBsb2MnfSxcclxuICAgICAge2NvbDogJ3Byb3ZpbmNlJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnfSxcclxuICAgICAge2NvbDogJ2xvY2FsaXR5X25hbWUnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJyd9LFxyXG4gICAgICB7Y29sOiAnY2xpZW50X25hbWUnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ3NvbG8gc2kgc2NvcGU9c2hvcCd9LFxyXG4gICAgICB7Y29sOiAnb3JpZ2luYWxfdmVuZG9yJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnfSxcclxuICAgICAge2NvbDogJ25ld192ZW5kb3InLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJyd9LFxyXG4gICAgICB7Y29sOiAnbmV3X3R5cGUnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ1ZERSB8IFZESSB8IERJU1RSSUJVSURPUiB8IE9UUk8nfSxcclxuICAgICAge2NvbDogJ3VwZGF0ZWRfYXQnLCB0eXBlOiAnaXNvODYwMScsIGRlc2M6ICcnfSxcclxuICAgICAge2NvbDogJ3VwZGF0ZWRfYnlfdWlkJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnfSxcclxuICAgICAge2NvbDogJ3VwZGF0ZWRfYnlfZW1haWwnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJyd9LFxyXG4gICAgICB7Y29sOiAndXBkYXRlZF9ieV9kaXNwbGF5X25hbWUnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJyd9LFxyXG4gICAgXSxcclxuICB9LFxyXG4gIGN1c3RvbV9yb3V0ZXM6IHtcclxuICAgIG5hbWU6ICdjdXN0b21fcm91dGVzLmNzdicsXHJcbiAgICBzb3VyY2U6ICdmaXJlc3RvcmUnLFxyXG4gICAgY29sbGVjdGlvbjogJ2N1c3RvbV9yb3V0ZXMnLFxyXG4gICAgcm93TW9kZTogJ2ZsYXR0ZW5fc3RvcHMnLCAvLyAxIGZpbGEgcG9yIChydXRhLCBzdG9wKVxyXG4gICAgY29sdW1uczogW1xyXG4gICAgICB7Y29sOiAncm91dGVfaWQnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ0ZpcmVzdG9yZSBkb2MgSUQnfSxcclxuICAgICAge2NvbDogJ293bmVyX3VpZCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnZHVlbmlvIGRlIGxhIHJ1dGEnfSxcclxuICAgICAge2NvbDogJ293bmVyX2VtYWlsJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnfSxcclxuICAgICAge2NvbDogJ25hbWUnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ25vbWJyZSBkZSBsYSBydXRhJ30sXHJcbiAgICAgIHtjb2w6ICdwbGFubmVkX2RhdGUnLCB0eXBlOiAnaXNvODYwMScsIGRlc2M6ICdZWVlZLU1NLUREJ30sXHJcbiAgICAgIHtjb2w6ICdub3RlcycsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnbm90YXMgbGlicmVzJ30sXHJcbiAgICAgIHtjb2w6ICdjcmVhdGVkX2F0JywgdHlwZTogJ2lzbzg2MDEnLCBkZXNjOiAnJ30sXHJcbiAgICAgIHtjb2w6ICd1cGRhdGVkX2F0JywgdHlwZTogJ2lzbzg2MDEnLCBkZXNjOiAnJ30sXHJcbiAgICAgIHtjb2w6ICdzdG9wX29yZGVyJywgdHlwZTogJ2ludCcsIGRlc2M6ICdvcmRlbiAwLWJhc2VkJ30sXHJcbiAgICAgIHtjb2w6ICdzdG9wX2tleScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnY2xhdmUgY29tcHVlc3RhIHRpcG98cHJvdnxsb2N8Y2xpZW50ZSd9LFxyXG4gICAgICB7Y29sOiAnc3RvcF90aXBvJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdDIHwgUCd9LFxyXG4gICAgICB7Y29sOiAnc3RvcF9wcm92aW5jaWEnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJyd9LFxyXG4gICAgICB7Y29sOiAnc3RvcF9sb2NhbGlkYWQnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJyd9LFxyXG4gICAgICB7Y29sOiAnc3RvcF9jbGllbnRfbmFtZScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJ30sXHJcbiAgICAgIHtjb2w6ICdzdG9wX2lzX3Byb3Zpc29yaW8nLCB0eXBlOiAnYm9vbGVhbicsIGRlc2M6ICd0cnVlPWFsdGEgcmFwaWRhIHNpbiBDYXJkQ29kZSd9LFxyXG4gICAgICB7Y29sOiAnc3RvcF9zYXBfYWx0YV9pZCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnSUQgZGVsIGNsaWVudF9hcHBsaWNhdGlvbnMgc2kgYXBsaWNhJ30sXHJcbiAgICBdLFxyXG4gIH0sXHJcbiAgc2VndWltaWVudG9fbm90ZXM6IHtcclxuICAgIG5hbWU6ICdzZWd1aW1pZW50b19ub3Rlcy5jc3YnLFxyXG4gICAgc291cmNlOiAnZmlyZXN0b3JlJyxcclxuICAgIGNvbGxlY3Rpb246ICdzZWd1aW1pZW50b19ub3RlcycsXHJcbiAgICByb3dNb2RlOiAnb25lX3Blcl9kb2MnLFxyXG4gICAgY29sdW1uczogW1xyXG4gICAgICB7Y29sOiAnbm90ZV9pZCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnRmlyZXN0b3JlIGRvYyBJRCd9LFxyXG4gICAgICB7Y29sOiAndmVuZG9yX2V4dCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnVkRFIGFsIHF1ZSBhcGxpY2EgbGEgbm90YSd9LFxyXG4gICAgICB7Y29sOiAnY2xpZW50X2tleScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnY2xhdmUgY29tcHVlc3RhIGNsaWVudGUnfSxcclxuICAgICAge2NvbDogJ2NsaWVudF9uYW1lJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnfSxcclxuICAgICAge2NvbDogJ3Byb3ZpbmNlJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnfSxcclxuICAgICAge2NvbDogJ2xvY2FsaXR5JywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnfSxcclxuICAgICAge2NvbDogJ3RleHQnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ3RleHRvIGxpYnJlIGRlIGxhIG5vdGEnfSxcclxuICAgICAge2NvbDogJ2F1dGhvcl91aWQnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJyd9LFxyXG4gICAgICB7Y29sOiAnYXV0aG9yX2VtYWlsJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnfSxcclxuICAgICAge2NvbDogJ2F1dGhvcl9uYW1lJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnfSxcclxuICAgICAge2NvbDogJ2F1dGhvcl9yb2xlJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdhZG1pbiB8IGdlcmVudGUgfCBpbnRlcm5vJ30sXHJcbiAgICAgIHtjb2w6ICdjcmVhdGVkX2F0JywgdHlwZTogJ2lzbzg2MDEnLCBkZXNjOiAnJ30sXHJcbiAgICBdLFxyXG4gIH0sXHJcbn07XHJcblxyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxuLy8gREFUQVNFVF9VU0VfQ0FTRV9NQVRSSVggXHUyMDE0IGNhc29zIGRlIHVzbyBNTCBjb24gY2FtcG9zIHJlcXVlcmlkb3NcclxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XHJcblxyXG4vKiogQHR5cGVkZWYge3twcmlvcml0eTogbnVtYmVyfHN0cmluZywgZGVzY3JpcHRpb246IHN0cmluZywgcmVxdWlyZWRGaWVsZHM6IFJlY29yZDxzdHJpbmcsIHN0cmluZ1tdPiwgam9pbk5vdGVzPzogc3RyaW5nfX0gVXNlQ2FzZSAqL1xyXG5cclxuLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBVc2VDYXNlPn0gKi9cclxuZXhwb3J0IGNvbnN0IERBVEFTRVRfVVNFX0NBU0VfTUFUUklYID0ge1xyXG4gIEFfY29udmVyc2lvbl92aXNpdGFfcGVkaWRvOiB7XHJcbiAgICBwcmlvcml0eTogMSxcclxuICAgIGRlc2NyaXB0aW9uOiAnUHJlZGVjaXIgcXVlIHZpc2l0YXMgdGVybWluYW4gZW4gcGVkaWRvIHBhcmEgcHJpb3JpemFyIGxhIHJ1dGEgZGVsIHZlbmRlZG9yLicsXHJcbiAgICByZXF1aXJlZEZpZWxkczoge1xyXG4gICAgICAndmlzaXRhcy5jc3YnOiBbJ2ZlY2hhJywgJ293bmVyX3VpZCcsICdwcm92aW5jaWEnLCAnbG9jYWxpZGFkJywgJ3RpZW5kYSddLFxyXG4gICAgICAncGVkaWRvcy5jc3YnOiBbJ2NvbmZpcm1lZF9hdCcsICdvd25lcl91aWQnLCAncHJvdmluY2UnLCAnbG9jX25hbWUnLCAnY2xpZW50X25hbWUnXSxcclxuICAgIH0sXHJcbiAgICBqb2luTm90ZXM6ICdKT0lOIHBvciAocHJvdmluY2lhLCBsb2NhbGlkYWQsIHRpZW5kYX5jbGllbnRfbmFtZSkgZW4gdmVudGFuYSB0ZW1wb3JhbCBmZWNoYV92aXNpdGEuLmNvbmZpcm1lZF9hdC4gTm8gaGF5IGNhcmRDb2RlU2FwIGNvbXVuIGVudHJlIHZpc2l0cyB5IHBlZGlkb3MuJyxcclxuICB9LFxyXG4gIEJfY2h1cm5fY2xpZW50ZXM6IHtcclxuICAgIHByaW9yaXR5OiAyLFxyXG4gICAgZGVzY3JpcHRpb246ICdEZXRlY3RhciBjbGllbnRlcyBxdWUgc2UgZW5mcmlhbiBhbnRlcyBkZSBwZXJkZXJsb3MuJyxcclxuICAgIHJlcXVpcmVkRmllbGRzOiB7XHJcbiAgICAgICdjbGllbnRlcy5jc3YnOiBbJ2NyZWF0ZWRfYXQnLCAnYXNzaWduZWRfdmVuZG9yJywgJ3Byb3ZpbmNpYScsICdzdGF0dXMnLCAnY2FyZF9jb2RlX3NhcCddLFxyXG4gICAgICAncGVkaWRvcy5jc3YnOiBbJ2NvbmZpcm1lZF9hdCcsICdjbGllbnRfbmFtZScsICdwcm92aW5jZScsICdsb2NfbmFtZSddLFxyXG4gICAgfSxcclxuICAgIGpvaW5Ob3RlczogJ0pPSU4gdmlhIGNsaWVudF9hcHBsaWNhdGlvbnMuY2FyZF9jb2RlX3NhcCB2cyBwZWRpZG9zLmtleSAocGFyc2VhZG8pLiBGcmFnaWwgLSBjb25zaWRlcmFyIGZ1enp5IG1hdGNoIHBvciBub21icmUuJyxcclxuICB9LFxyXG4gIENfZm9yZWNhc3Rfc2t1OiB7XHJcbiAgICBwcmlvcml0eTogMyxcclxuICAgIGRlc2NyaXB0aW9uOiAnQW50aWNpcGFyIHF1ZSBwcm9kdWN0b3Mgc2UgdmFuIGEgcGVkaXIgcG9yIHBlcmlvZG8uJyxcclxuICAgIHJlcXVpcmVkRmllbGRzOiB7XHJcbiAgICAgICdwZWRpZG9zLmNzdic6IFsnbGluZV9jb2RlJywgJ2xpbmVfcXR5JywgJ2xpbmVfcHJlY2lvJywgJ2NvbmZpcm1lZF9hdCcsICdwcm92aW5jZSddLFxyXG4gICAgICAncHJvZHVjdG9zLmNzdic6IFsnc2t1J10sXHJcbiAgICB9LFxyXG4gICAgam9pbk5vdGVzOiAnRGVzY3VlbnRvIGFwbGljYWRvIGEgbml2ZWwgaGVhZGVyIChkaXNjb3VudF9wY3QpIC0gcHJvcnJhdGVhciBlbiBlbCBwaXBlbGluZSBkb3duc3RyZWFtIHByb3BvcmNpb25hbCBhIHN1YnRvdGFsX2JydXRvIGRlIGNhZGEgbGluZWEuIEVucmlxdWVjZXIgY29uIGNhdGFsb2dvIEJRIChzYXBfaXRlbXNfcmF3KSBzaSBoYWNlIGZhbHRhIGNhdC9mYW0vc3ViIGFkaWNpb25hbC4nLFxyXG4gIH0sXHJcbiAgRF9hbm9tYWxpYXNfcmVuZGljaW9uZXM6IHtcclxuICAgIHByaW9yaXR5OiAnZXhwbG9yYXRvcmlvJyxcclxuICAgIGRlc2NyaXB0aW9uOiAnRGV0ZWN0YXIgb3V0bGllcnMgZGUgZ2FzdG9zLicsXHJcbiAgICByZXF1aXJlZEZpZWxkczoge1xyXG4gICAgICAncmVuZGljaW9uZXMuY3N2JzogWydpbXBvcnRlX2FycycsICd0aXBvX2dhc3RvJywgJ293bmVyX3VpZCcsICdmZWNoYV9nYXN0bycsICdzdGF0dXMnXSxcclxuICAgIH0sXHJcbiAgfSxcclxuICBFX2VzdGFjaW9uYWxpZGFkX3pvbmFfY2F0ZWdvcmlhOiB7XHJcbiAgICBwcmlvcml0eTogJ2V4cGxvcmF0b3JpbycsXHJcbiAgICBkZXNjcmlwdGlvbjogJ0luc3VtbyBwYXJhIGFybWFkbyBkZSBjYW1wYW5pYXMgZXN0YWNpb25hbGVzLicsXHJcbiAgICByZXF1aXJlZEZpZWxkczoge1xyXG4gICAgICAncGVkaWRvcy5jc3YnOiBbJ2NvbmZpcm1lZF9hdCcsICdwcm92aW5jZScsICdsaW5lX2NvZGUnLCAnbGluZV9mYW0nLCAnbGluZV9xdHknXSxcclxuICAgICAgJ2NsaWVudGVzLmNzdic6IFsncHJvdmluY2lhJywgJ2Fzc2lnbmVkX3ZlbmRvciddLFxyXG4gICAgICAnY2FtcGFuaWFzLmNzdic6IFsnc3RhcnRfZGF0ZScsICdlbmRfZGF0ZScsICdza3VzX2pzb24nLCAnc2NvcGUnXSxcclxuICAgICAgJ3RhcmdldHMuY3N2JzogWyd5ZWFyJywgJ21vbnRoJywgJ3RhcmdldF9hcnMnXSxcclxuICAgIH0sXHJcbiAgfSxcclxufTtcclxuXHJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG4vLyBSb3cgYnVpbGRlcnMgXHUyMDE0IGZ1bmNpb25lcyBwdXJhcyAoZG9jIC0+IGFycmF5IGRlIHJvd3MpXHJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG5cclxuLyoqXHJcbiAqIEV4dHJhZSB2YWxvciBGaXJlc3RvcmUgZGUgZG9jIGNvbiBwYXRoIGFuaWRhZG8uIERldnVlbHZlIHJhdyAobm8gQ1NWKS5cclxuICogRWo6IGdldEZpZWxkKGRvYywgJ3RyYW5zZmVyaWRvU0FQLmRvY051bScpXHJcbiAqIEBwYXJhbSB7b2JqZWN0fSBkb2NcclxuICogQHBhcmFtIHtzdHJpbmd9IHBhdGhcclxuICovXHJcbmZ1bmN0aW9uIGYoZG9jLCBwYXRoKSB7XHJcbiAgcmV0dXJuIGdldFBhdGgoZG9jLCBwYXRoKTtcclxufVxyXG5cclxuLyoqXHJcbiAqIFJvdyBidWlsZGVyIGdlbmVyaWNvOiBtYXBlYSB1biBkb2MgYSBhcnJheSBkZSB2YWxvcmVzIHNlZ3VuIHVuIGFycmF5IGRlIHBhdGhzLlxyXG4gKiBAcGFyYW0ge29iamVjdH0gZG9jXHJcbiAqIEBwYXJhbSB7c3RyaW5nW119IHBhdGhzXHJcbiAqIEByZXR1cm5zIHt1bmtub3duW119XHJcbiAqL1xyXG5mdW5jdGlvbiBidWlsZFJvdyhkb2MsIHBhdGhzKSB7XHJcbiAgcmV0dXJuIHBhdGhzLm1hcCgocCkgPT4gKHAgPT09ICdfX2lkX18nID8gLyoqIEB0eXBlIHthbnl9ICovKGRvYykuX2lkIDogZihkb2MsIHApKSk7XHJcbn1cclxuXHJcbi8qKlxyXG4gKiBQZWRpZG9zOiBmbGF0dGVuIDEgZmlsYSBwb3IgbGluZWEuIEhlYWRlciBwZWRpZG8gcmVwbGljYWRvIGVuIGNhZGEuXHJcbiAqIGRvYy5faWQgZXMgZWwgSUQ7IHNlIGVzcGVyYSBxdWUgZWwgY2FsbGVyIGxvIGFncmVndWUgYW50ZXMgZGUgcGFzYXIuXHJcbiAqIEBwYXJhbSB7YW55fSBkb2NcclxuICogQHJldHVybnMge3Vua25vd25bXVtdfVxyXG4gKi9cclxuZXhwb3J0IGZ1bmN0aW9uIGJ1aWxkUGVkaWRvUm93cyhkb2MpIHtcclxuICBjb25zdCBoZWFkZXIgPSBbXHJcbiAgICBkb2MuX2lkLFxyXG4gICAgZG9jLm93bmVyVWlkLFxyXG4gICAgZG9jLm93bmVyRW1haWwsXHJcbiAgICBkb2MuY3JlYXRlZEJ5VWlkLFxyXG4gICAgZG9jLm9uQmVoYWxmT2YsXHJcbiAgICBkb2Mua2V5LFxyXG4gICAgZG9jLnN0YWdlLFxyXG4gICAgZG9jLnRpcG8sXHJcbiAgICBkb2MucHJvdmluY2UsXHJcbiAgICBkb2MubG9jTmFtZSxcclxuICAgIGRvYy5jbGllbnROYW1lLFxyXG4gICAgZG9jLm1vbnRoLFxyXG4gICAgZG9jLm1vbnRoSWR4LFxyXG4gICAgZG9jLnllYXIsXHJcbiAgICBkb2MuY29uZmlybWVkQXQsXHJcbiAgICBkb2MuY29uZGljaW9uUGFnbyxcclxuICAgIGRvYy5mb3JtYUVudHJlZ2EgPyBkb2MuZm9ybWFFbnRyZWdhLnRpcG8gOiBudWxsLFxyXG4gICAgZG9jLmZvcm1hRW50cmVnYSA/IGRvYy5mb3JtYUVudHJlZ2EudHJhbnNwTm9tYnJlIDogbnVsbCxcclxuICAgIGRvYy5mb3JtYUVudHJlZ2EgPyBkb2MuZm9ybWFFbnRyZWdhLnRyYW5zcERpcmVjY2lvbiA6IG51bGwsXHJcbiAgICBkb2MuZm9ybWFFbnRyZWdhID8gZG9jLmZvcm1hRW50cmVnYS5jbGllbnRlRGlyZWNjaW9uIDogbnVsbCxcclxuICAgIGRvYy5mb3JtYUVudHJlZ2EgPyBkb2MuZm9ybWFFbnRyZWdhLnN1Y3Vyc2FsRGlyZWNjaW9uIDogbnVsbCxcclxuICAgIGRvYy5kaXNjb3VudFBjdCxcclxuICAgIGRvYy5zdWJ0b3RhbEFycyxcclxuICAgIGRvYy5uZXRBbW91bnRBcnMsXHJcbiAgICBkb2MudHJhbnNmZXJpZG9TQVAgPyBkb2MudHJhbnNmZXJpZG9TQVAudmlhIDogbnVsbCxcclxuICAgIGRvYy50cmFuc2Zlcmlkb1NBUCA/IGRvYy50cmFuc2Zlcmlkb1NBUC5kb2NOdW0gOiBudWxsLFxyXG4gICAgZG9jLnRyYW5zZmVyaWRvU0FQID8gZG9jLnRyYW5zZmVyaWRvU0FQLmRvY0VudHJ5IDogbnVsbCxcclxuICAgIGRvYy50cmFuc2Zlcmlkb1NBUCA/IGRvYy50cmFuc2Zlcmlkb1NBUC5hdCA6IG51bGwsXHJcbiAgICBkb2MuY3JlYXRlZEF0LFxyXG4gIF07XHJcbiAgY29uc3QgbGluZXMgPSBBcnJheS5pc0FycmF5KGRvYy5saW5lcykgPyBkb2MubGluZXMgOiBbXTtcclxuICBpZiAoIWxpbmVzLmxlbmd0aCkge1xyXG4gICAgLy8gUGVkaWRvIHNpbiBsaW5lYXMgLT4gMSBmaWxhIGNvbiBsaW5lXyogdmFjaW9zXHJcbiAgICByZXR1cm4gW2hlYWRlci5jb25jYXQoW251bGwsIG51bGwsIG51bGwsIG51bGwsIG51bGwsIG51bGwsIG51bGwsIG51bGxdKV07XHJcbiAgfVxyXG4gIHJldHVybiBsaW5lcy5tYXAoKC8qKiBAdHlwZSB7YW55fSAqL2wsIC8qKiBAdHlwZSB7bnVtYmVyfSAqL2lkeCkgPT4gaGVhZGVyLmNvbmNhdChbXHJcbiAgICBpZHgsXHJcbiAgICBsID8gbC5jb2RlIDogbnVsbCxcclxuICAgIGwgPyBsLmRlc2MgOiBudWxsLFxyXG4gICAgbCA/IGwucXR5IDogbnVsbCxcclxuICAgIGwgPyBsLnByZWNpbyA6IG51bGwsXHJcbiAgICBsID8gbC5jYXQgOiBudWxsLFxyXG4gICAgbCA/IGwuZmFtIDogbnVsbCxcclxuICAgIGwgPyBsLnN1YiA6IG51bGwsXHJcbiAgXSkpO1xyXG59XHJcblxyXG4vKiogQHBhcmFtIHthbnl9IGRvYyBAcmV0dXJucyB7dW5rbm93bltdW119ICovXHJcbmV4cG9ydCBmdW5jdGlvbiBidWlsZFZpc2l0YVJvd3MoZG9jKSB7XHJcbiAgcmV0dXJuIFtbXHJcbiAgICBkb2MuX2lkLFxyXG4gICAgZG9jLm93bmVyVWlkLFxyXG4gICAgZG9jLm93bmVyRW1haWwsXHJcbiAgICBkb2MuZmVjaGEsXHJcbiAgICBkb2MubWVzLFxyXG4gICAgZG9jLmFuaW8sXHJcbiAgICBkb2MudmVuZG9yLFxyXG4gICAgZG9jLnByb3ZpbmNpYSxcclxuICAgIGRvYy5sb2NhbGlkYWQsXHJcbiAgICBkb2MudGllbmRhLFxyXG4gICAgZG9jLnRpcG8sXHJcbiAgICBkb2MubG9jYWwsXHJcbiAgICBkb2MudGFtYW5vLFxyXG4gICAgZG9jLmZpZGVsaWRhZCxcclxuICAgIGRvYy5yZWxldmFuY2lhLFxyXG4gICAgZG9jLnBvcCxcclxuICAgIGRvYy5uZWNlc2lkYWRQdW50dWFsLFxyXG4gICAgZG9jLnRpcG9WZW50YSxcclxuICAgIGRvYy5wb25kZXJhY2lvbk1vc3RyYWRvLFxyXG4gICAgZG9jLnBvbmRlcmFjaW9uRWNvbW1lcmNlLFxyXG4gICAgZG9jLmNvbXBldGVuY2lhLFxyXG4gICAgZG9jLm9wb3J0dW5pZGFkLFxyXG4gICAgZG9jLm1hc1ZlbmRpZG8sXHJcbiAgICBkb2MubWFzUHJlZ3VudGFuLFxyXG4gICAgZG9jLmF5dWRhVGllbmRhLFxyXG4gICAgZG9jLmdwc1N0YXR1cyxcclxuICAgIGRvYy5ncHNEaXN0YW5jZU0sXHJcbiAgICBkb2MuaW50ZXJhY3Rpb25UeXBlLFxyXG4gICAgZG9jLmZvcm1hQ29udGFjdG8sXHJcbiAgICBkb2MuY29udGFjdG9SZXN1bHRhZG8sXHJcbiAgICBkb2MuY29udGFjdG9SZXN1bHRhZG9BdCxcclxuICAgIGRvYy5jb250YWN0b1Jlc3VsdGFkb0J5LFxyXG4gICAgZG9jLmNyZWF0ZWRBdCxcclxuICBdXTtcclxufVxyXG5cclxuLyoqIEBwYXJhbSB7YW55fSBkb2MgQHJldHVybnMge3Vua25vd25bXVtdfSAqL1xyXG5leHBvcnQgZnVuY3Rpb24gYnVpbGRDbGllbnRlUm93cyhkb2MpIHtcclxuICByZXR1cm4gW1tcclxuICAgIGRvYy5faWQsXHJcbiAgICBkb2Mub3duZXJVaWQsXHJcbiAgICBkb2Mub3duZXJFbWFpbCxcclxuICAgIGRvYy5vd25lck5hbWUsXHJcbiAgICBkb2MuY29tZXJjaW8sXHJcbiAgICBkb2MuZmFudGFzaWEsXHJcbiAgICBkb2MuY3VpdCxcclxuICAgIGRvYy5jb25kaWNpb25GaXNjYWwsXHJcbiAgICBkb2MuY2FsbGUsXHJcbiAgICBkb2MubnVtZXJvLFxyXG4gICAgZG9jLmxvY2FsaWRhZCxcclxuICAgIGRvYy5wcm92aW5jaWEsXHJcbiAgICBkb2MubG9jYWxpZGFkRmluYWwsXHJcbiAgICBkb2MuY2FyZENvZGVTYXAsXHJcbiAgICBkb2MuYXNzaWduZWRWZW5kb3IsXHJcbiAgICBkb2Muc3RhdHVzLFxyXG4gICAgZG9jLnNvdXJjZSxcclxuICAgIGRvYy5tYW51YWxTYXBQZW5kaW5nLFxyXG4gICAgZG9jLnByZWNhdWNpb24sXHJcbiAgICBkb2MuY2F0ZWdvcmlhQ2xpZW50ZSxcclxuICAgIGRvYy5jbGlUaXBvLFxyXG4gICAgZG9jLmxhdCxcclxuICAgIGRvYy5sbmcsXHJcbiAgICBkb2MubGF0ICE9IG51bGwgJiYgZG9jLmxuZyAhPSBudWxsLFxyXG4gICAgISEoZG9jLmNhbGxlIHx8IGRvYy5hZGRyZXNzKSxcclxuICAgIGRvYy5zdWJtaXR0ZWRCeVB1YmxpY0Zvcm0sXHJcbiAgICBkb2MuYXBwcm92ZWRBdCxcclxuICAgIGRvYy5jcmVhdGVkQXQsXHJcbiAgICBkb2MudXBkYXRlZEF0LFxyXG4gIF1dO1xyXG59XHJcblxyXG4vKiogQHBhcmFtIHthbnl9IGRvYyBAcmV0dXJucyB7dW5rbm93bltdW119ICovXHJcbmV4cG9ydCBmdW5jdGlvbiBidWlsZENsaWVudE1hc3RlclJvd3MoZG9jKSB7XHJcbiAgcmV0dXJuIFtbXHJcbiAgICBkb2MuX2lkLFxyXG4gICAgZG9jLmNsaWVudE5hbWUsXHJcbiAgICBkb2MucHJvdmluY2lhLFxyXG4gICAgZG9jLmxvY2FsaWRhZCxcclxuICAgIGRvYy52ZW5kb3IsXHJcbiAgICBkb2MuYWRkcmVzcyxcclxuICAgIGRvYy5zYXBDYXJkQ29kZSxcclxuICAgIGRvYy5zYXBBZGRyZXNzLFxyXG4gICAgZG9jLnNhcENpdHksXHJcbiAgICBkb2Muc2FwU3RhdGUsXHJcbiAgICBkb2Muc2FwSW1wb3J0ZWRBdCxcclxuICAgIGRvYy5zYXBJbXBvcnRlZEJ5LFxyXG4gICAgZG9jLmNsaWVudE5hbWVPcmlnaW5hbCxcclxuICAgIGRvYy5sb2NhbGlkYWRPcmlnaW5hbCxcclxuICAgIGRvYy5tYXRjaFR5cGUsXHJcbiAgICBkb2MubWF0Y2hTaW1pbGFyaXR5LFxyXG4gICAgZG9jLnVwZGF0ZWRBdCxcclxuICAgIGRvYy51cGRhdGVkQnksXHJcbiAgXV07XHJcbn1cclxuXHJcbi8qKiBAcGFyYW0ge2FueX0gZG9jIEByZXR1cm5zIHt1bmtub3duW11bXX0gKi9cclxuZXhwb3J0IGZ1bmN0aW9uIGJ1aWxkUmVuZGljaW9uUm93cyhkb2MpIHtcclxuICByZXR1cm4gW1tcclxuICAgIGRvYy5faWQsXHJcbiAgICBkb2Mub3duZXJVaWQsXHJcbiAgICBkb2Mub3duZXJFbWFpbCxcclxuICAgIGRvYy52ZW5kb3IsXHJcbiAgICBkb2MudGlwbyxcclxuICAgIGRvYy50aXBvR2FzdG8sXHJcbiAgICBkb2MuaW1wb3J0ZUFycyAhPSBudWxsID8gZG9jLmltcG9ydGVBcnMgOiBkb2MuaW1wb3J0ZSxcclxuICAgIGRvYy5mZWNoYUdhc3RvLFxyXG4gICAgZG9jLmNvbmNlcHRvLFxyXG4gICAgLy8gZm90b1RpY2tldFVybCAodjMwOCspIHByaW9yaWRhZDsgTlVOQ0EgZXhwb3J0YXIgYmFzZTY0IGZvdG9UaWNrZXQgbGVnYWN5XHJcbiAgICBkb2MuZm90b1RpY2tldFVybCB8fCBudWxsLFxyXG4gICAgZG9jLnN0YXR1cyxcclxuICAgIGRvYy5hcHByb3ZlZEJ5LFxyXG4gICAgZG9jLmFwcHJvdmVkQXQsXHJcbiAgICBkb2MucmVqZWN0ZWRCeUVtYWlsLFxyXG4gICAgZG9jLnJlamVjdGVkUmVhc29uLFxyXG4gICAgZG9jLmFwcHJvdmVyVWlkLFxyXG4gICAgZG9jLmNyZWF0ZWRBdCxcclxuICBdXTtcclxufVxyXG5cclxuLyoqIEBwYXJhbSB7YW55fSBkb2MgQHJldHVybnMge3Vua25vd25bXVtdfSAqL1xyXG5leHBvcnQgZnVuY3Rpb24gYnVpbGRDYW1wYW5pYVJvd3MoZG9jKSB7XHJcbiAgcmV0dXJuIFtbXHJcbiAgICBkb2MuX2lkLFxyXG4gICAgZG9jLm5hbWUsXHJcbiAgICBkb2MuZmFtaWxpYSxcclxuICAgIGRvYy5zdWJmYW1pbGlhLFxyXG4gICAgZG9jLmZpbHRlclR5cGUsXHJcbiAgICBkb2MuZmlsdGVyVmFsdWVzLFxyXG4gICAgZG9jLnNrdXMsXHJcbiAgICBBcnJheS5pc0FycmF5KGRvYy5za3VzKSA/IGRvYy5za3VzLmxlbmd0aCA6IDAsXHJcbiAgICBkb2MudGFyZ2V0VHlwZSxcclxuICAgIGRvYy50YXJnZXRBbW91bnQsXHJcbiAgICBkb2Muc3RhcnREYXRlLFxyXG4gICAgZG9jLmVuZERhdGUsXHJcbiAgICBkb2Muc2NvcGUsXHJcbiAgICBkb2Muc2NvcGVWYWx1ZXMsXHJcbiAgICBkb2MuY3JlYXRlZEJ5LFxyXG4gICAgZG9jLmNyZWF0ZWRCeUVtYWlsLFxyXG4gICAgZG9jLmNyZWF0ZWRBdCxcclxuICAgIGRvYy5hcmNoaXZlZE1hbnVhbGx5LFxyXG4gICAgZG9jLmFyY2hpdmVkQXQsXHJcbiAgICBkb2MuYXJjaGl2ZWRCeSxcclxuICBdXTtcclxufVxyXG5cclxuLyoqIEBwYXJhbSB7YW55fSBkb2MgQHJldHVybnMge3Vua25vd25bXVtdfSAqL1xyXG5leHBvcnQgZnVuY3Rpb24gYnVpbGRUYXJnZXRSb3dzKGRvYykge1xyXG4gIHJldHVybiBbW1xyXG4gICAgZG9jLl9pZCxcclxuICAgIGRvYy5zZWxsZXJJZCxcclxuICAgIGRvYy55ZWFyLFxyXG4gICAgZG9jLm1vbnRoLFxyXG4gICAgZG9jLnRhcmdldEFycyxcclxuICAgIGRvYy50YXJnZXRCeUZhbWlseSA/IGRvYy50YXJnZXRCeUZhbWlseS5SRUVMIDogbnVsbCxcclxuICAgIGRvYy50YXJnZXRCeUZhbWlseSA/IGRvYy50YXJnZXRCeUZhbWlseS5DQU5BUyA6IG51bGwsXHJcbiAgICBkb2MudGFyZ2V0QnlGYW1pbHkgPyBkb2MudGFyZ2V0QnlGYW1pbHkuTElORUFTIDogbnVsbCxcclxuICAgIGRvYy51cGRhdGVkQXQsXHJcbiAgICBkb2MudXBkYXRlZEJ5LFxyXG4gICAgZG9jLnVwZGF0ZWRCeUVtYWlsLFxyXG4gIF1dO1xyXG59XHJcblxyXG4vKiogQHBhcmFtIHthbnl9IGRvYyBAcmV0dXJucyB7dW5rbm93bltdW119ICovXHJcbmV4cG9ydCBmdW5jdGlvbiBidWlsZFZlbmRvck92ZXJyaWRlUm93cyhkb2MpIHtcclxuICByZXR1cm4gW1tcclxuICAgIGRvYy5faWQsXHJcbiAgICBkb2Muc2NvcGUsXHJcbiAgICBkb2MucHJvdmluY2UsXHJcbiAgICBkb2MubG9jYWxpdHlOYW1lLFxyXG4gICAgZG9jLmNsaWVudE5hbWUsXHJcbiAgICBkb2Mub3JpZ2luYWxWZW5kb3IsXHJcbiAgICBkb2MubmV3VmVuZG9yLFxyXG4gICAgZG9jLm5ld1R5cGUsXHJcbiAgICBkb2MudXBkYXRlZEF0LFxyXG4gICAgZG9jLnVwZGF0ZWRCeVVpZCxcclxuICAgIGRvYy51cGRhdGVkQnlFbWFpbCxcclxuICAgIGRvYy51cGRhdGVkQnlEaXNwbGF5TmFtZSxcclxuICBdXTtcclxufVxyXG5cclxuLyoqIEBwYXJhbSB7YW55fSBkb2MgQHJldHVybnMge3Vua25vd25bXVtdfSAqL1xyXG5leHBvcnQgZnVuY3Rpb24gYnVpbGRDdXN0b21Sb3V0ZVJvd3MoZG9jKSB7XHJcbiAgY29uc3QgaGVhZGVyID0gW1xyXG4gICAgZG9jLl9pZCxcclxuICAgIGRvYy5vd25lclVpZCxcclxuICAgIGRvYy5vd25lckVtYWlsLFxyXG4gICAgZG9jLm5hbWUsXHJcbiAgICBkb2MucGxhbm5lZERhdGUsXHJcbiAgICBkb2Mubm90ZXMsXHJcbiAgICBkb2MuY3JlYXRlZEF0LFxyXG4gICAgZG9jLnVwZGF0ZWRBdCxcclxuICBdO1xyXG4gIGNvbnN0IHN0b3BzID0gQXJyYXkuaXNBcnJheShkb2Muc3RvcHMpID8gZG9jLnN0b3BzIDogW107XHJcbiAgaWYgKCFzdG9wcy5sZW5ndGgpIHtcclxuICAgIHJldHVybiBbaGVhZGVyLmNvbmNhdChbbnVsbCwgbnVsbCwgbnVsbCwgbnVsbCwgbnVsbCwgbnVsbCwgbnVsbCwgbnVsbF0pXTtcclxuICB9XHJcbiAgcmV0dXJuIHN0b3BzLm1hcCgoLyoqIEB0eXBlIHthbnl9ICovcykgPT4gaGVhZGVyLmNvbmNhdChbXHJcbiAgICBzID8gcy5vcmRlciA6IG51bGwsXHJcbiAgICBzID8gcy5rZXkgOiBudWxsLFxyXG4gICAgcyA/IHMudGlwbyA6IG51bGwsXHJcbiAgICBzID8gcy5wcm92aW5jaWEgOiBudWxsLFxyXG4gICAgcyA/IHMubG9jYWxpZGFkIDogbnVsbCxcclxuICAgIHMgPyBzLmNsaWVudE5hbWUgOiBudWxsLFxyXG4gICAgcyA/IHMuaXNQcm92aXNvcmlvIDogbnVsbCxcclxuICAgIHMgPyBzLnNhcEFsdGFJZCA6IG51bGwsXHJcbiAgXSkpO1xyXG59XHJcblxyXG4vKiogQHBhcmFtIHthbnl9IGRvYyBAcmV0dXJucyB7dW5rbm93bltdW119ICovXHJcbmV4cG9ydCBmdW5jdGlvbiBidWlsZFNlZ3VpbWllbnRvTm90ZVJvd3MoZG9jKSB7XHJcbiAgcmV0dXJuIFtbXHJcbiAgICBkb2MuX2lkLFxyXG4gICAgZG9jLnZlbmRvckV4dCxcclxuICAgIGRvYy5jbGllbnRLZXksXHJcbiAgICBkb2MuY2xpZW50TmFtZSxcclxuICAgIGRvYy5wcm92aW5jZSxcclxuICAgIGRvYy5sb2NhbGl0eSxcclxuICAgIGRvYy50ZXh0LFxyXG4gICAgZG9jLmF1dGhvclVpZCxcclxuICAgIGRvYy5hdXRob3JFbWFpbCxcclxuICAgIGRvYy5hdXRob3JOYW1lLFxyXG4gICAgZG9jLmF1dGhvclJvbGUsXHJcbiAgICBkb2MuY3JlYXRlZEF0LFxyXG4gIF1dO1xyXG59XHJcblxyXG4vKipcclxuICogUHJvZHVjdG9zIGRlc2RlIHN0b2NrLmpzb24gKGZvcm1hdG8gU2hpbWFubzoge3N0b2NrOiB7U0tVOiBib29sLCAuLi59LFxyXG4gKiBxdWFudGl0aWVzOiBKU09OIHN0cmluZywgd2FyZWhvdXNlQnJlYWtkb3duOiBKU09OIHN0cmluZywgdXBkYXRlZEF0OiAuLi59KS5cclxuICogQHBhcmFtIHtvYmplY3R9IHN0b2NrSnNvblxyXG4gKiBAcmV0dXJucyB7dW5rbm93bltdW119XHJcbiAqL1xyXG5leHBvcnQgZnVuY3Rpb24gYnVpbGRQcm9kdWN0b1Jvd3NGcm9tU3RvY2tKc29uKHN0b2NrSnNvbikge1xyXG4gIGNvbnN0IHNqID0gLyoqIEB0eXBlIHthbnl9ICovKHN0b2NrSnNvbikgfHwge307XHJcbiAgY29uc3Qgc3RvY2tNYXAgPSBzai5zdG9jayB8fCB7fTtcclxuICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIG51bWJlcj59ICovXHJcbiAgbGV0IHF1YW50aXRpZXMgPSB7fTtcclxuICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJlY29yZDxzdHJpbmcsIG51bWJlcj4+fSAqL1xyXG4gIGxldCBicmVha2Rvd24gPSB7fTtcclxuICB0cnkgeyBxdWFudGl0aWVzID0gc2oucXVhbnRpdGllcyA/IEpTT04ucGFyc2Uoc2oucXVhbnRpdGllcykgOiAoc2oucXVhbnRpdGllc19tYXAgfHwge30pOyB9IGNhdGNoIChfKSB7fVxyXG4gIHRyeSB7IGJyZWFrZG93biA9IHNqLndhcmVob3VzZUJyZWFrZG93biA/IEpTT04ucGFyc2Uoc2oud2FyZWhvdXNlQnJlYWtkb3duKSA6IChzai53YXJlaG91c2VCcmVha2Rvd25fbWFwIHx8IHt9KTsgfSBjYXRjaCAoXykge31cclxuICBjb25zdCByb3dzID0gLyoqIEB0eXBlIHt1bmtub3duW11bXX0gKi8oW10pO1xyXG4gIGNvbnN0IHNvdXJjZSA9ICdzdG9jay5qc29uIHNuYXBzaG90JztcclxuICBjb25zdCB1cGRhdGVkQXQgPSBzai51cGRhdGVkQXQgfHwgc2ouc25hcHNob3RBdCB8fCBudWxsO1xyXG4gIGZvciAoY29uc3Qgc2t1IG9mIE9iamVjdC5rZXlzKHN0b2NrTWFwKSkge1xyXG4gICAgY29uc3QgaGFzX3N0b2NrID0gISFzdG9ja01hcFtza3VdO1xyXG4gICAgY29uc3QgdG90YWwgPSBOdW1iZXIocXVhbnRpdGllc1tza3VdIHx8IDApO1xyXG4gICAgY29uc3Qgd2JzID0gYnJlYWtkb3duW3NrdV0gfHwge307XHJcbiAgICBjb25zdCB3MTEgPSBOdW1iZXIod2JzWycxMSddIHx8IDApO1xyXG4gICAgY29uc3QgdzEyID0gTnVtYmVyKHdic1snMTInXSB8fCAwKTtcclxuICAgIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgbnVtYmVyPn0gKi9cclxuICAgIGNvbnN0IG90cm9zID0ge307XHJcbiAgICBmb3IgKGNvbnN0IGsgb2YgT2JqZWN0LmtleXMod2JzKSkge1xyXG4gICAgICBpZiAoayAhPT0gJzExJyAmJiBrICE9PSAnMTInKSBvdHJvc1trXSA9IE51bWJlcih3YnNba10gfHwgMCk7XHJcbiAgICB9XHJcbiAgICByb3dzLnB1c2goW1xyXG4gICAgICBza3UsXHJcbiAgICAgIGhhc19zdG9jayxcclxuICAgICAgdG90YWwsXHJcbiAgICAgIHcxMSxcclxuICAgICAgdzEyLFxyXG4gICAgICBPYmplY3Qua2V5cyhvdHJvcykubGVuZ3RoID8gb3Ryb3MgOiBudWxsLFxyXG4gICAgICBzb3VyY2UsXHJcbiAgICAgIHVwZGF0ZWRBdCxcclxuICAgIF0pO1xyXG4gIH1cclxuICByZXR1cm4gcm93cztcclxufVxyXG5cclxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XHJcbi8vIERpc3BhdGNoZXI6IG1hcGEgY29sbGVjdGlvbiAtPiByb3cgYnVpbGRlclxyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxuXHJcbi8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgKGRvYzogYW55KSA9PiB1bmtub3duW11bXT59ICovXHJcbmV4cG9ydCBjb25zdCBST1dfQlVJTERFUlMgPSB7XHJcbiAgcGVkaWRvczogYnVpbGRQZWRpZG9Sb3dzLFxyXG4gIHZpc2l0YXM6IGJ1aWxkVmlzaXRhUm93cyxcclxuICBjbGllbnRlczogYnVpbGRDbGllbnRlUm93cyxcclxuICBjbGllbnRfbWFzdGVyOiBidWlsZENsaWVudE1hc3RlclJvd3MsXHJcbiAgcmVuZGljaW9uZXM6IGJ1aWxkUmVuZGljaW9uUm93cyxcclxuICBjYW1wYW5pYXM6IGJ1aWxkQ2FtcGFuaWFSb3dzLFxyXG4gIHRhcmdldHM6IGJ1aWxkVGFyZ2V0Um93cyxcclxuICB2ZW5kb3Jfb3ZlcnJpZGVzOiBidWlsZFZlbmRvck92ZXJyaWRlUm93cyxcclxuICBjdXN0b21fcm91dGVzOiBidWlsZEN1c3RvbVJvdXRlUm93cyxcclxuICBzZWd1aW1pZW50b19ub3RlczogYnVpbGRTZWd1aW1pZW50b05vdGVSb3dzLFxyXG59O1xyXG4iLCAiLy8gQHRzLW5vY2hlY2tcclxuLy8gRVhQT1JUUy1BRFZBTkNFRDogcGhvdG8gWklQcywgYXVkaXQgWExTWCwgZXhlY3V0aXZlIHN1bW1hcnksIHZpc2l0cyBYTFNYLFxyXG4vLyBQb3dlckJJIGRhdGFzZXQsIE1MIGRhdGFzZXQuIEV4dHJhXHUwMEVEZG8gdmVyYmF0aW0gZGUgaW5kZXguaHRtbCAoNCBmcmFnbWVudG9zXHJcbi8vIGRpc2NvbnRpbnVvcyBzZXBhcmFkb3MgcG9yIEJhY2t1cCArIEF1ZGl0ICsgX2V4cG9ydExlZ2FjeUZ1bGwgcXVlIHF1ZWRhblxyXG4vLyBlbiBlbCBpbmxpbmUpIGNvbW8gcGFydGUgZGUgRTIubi4yIChlMmItcGVyZiAyMDI2LTA3LTI4KS5cclxuLy9cclxuLy8gdjM3MSs6IGV4cG9ydERhdGFzZXRaaXAoKSBudWV2byBcdTIwMTQgWklQIGNvbiBDU1ZzIHBvciBlbnRpZGFkIHBhcmEgcGlwZWxpbmVzXHJcbi8vIE1MIGV4dGVybm9zIChNaWNyb3NvZnQgRmFicmljKS4gSW1wb3J0YSBsb3MgaGVscGVycyBwdXJvcyB5IHNjaGVtYXMgZGVsXHJcbi8vIG1vZHVsbyBzcmMvcHVyZS9jc3Ytc2VyaWFsaXplci5qcy4gVmVyIHBsYW4gY29zbWljLXBvbmRlcmluZy1zdGVhcm5zLm1kLlxyXG5cclxuaW1wb3J0IHtcclxuICBidWlsZENzdixcclxuICBjb21wdXRlTnVsbFJhdGVzLFxyXG4gIGZpcmVzdG9yZVZhbHVlVG9Dc3YsXHJcbiAgREFUQVNFVF9TQ0hFTUFTLFxyXG4gIERBVEFTRVRfVVNFX0NBU0VfTUFUUklYLFxyXG4gIFJPV19CVUlMREVSUyxcclxuICBidWlsZFByb2R1Y3RvUm93c0Zyb21TdG9ja0pzb24sXHJcbn0gZnJvbSAnLi4vcHVyZS9jc3Ytc2VyaWFsaXplci5qcyc7XHJcbi8vXHJcbi8vIERlcHMgZGVsIGlubGluZTogSlNaaXAgKENETiBsYXp5KSwgRXhjZWxKUyAoQ0ROIGxhenkgdmlhIGxvYWRFeGNlbEpTKSxcclxuLy8gWExTWCAoZGVmZXIgZW4gaGVhZCksIHZpc2l0c0NhY2hlLCBjYW1wYWlnbnNDYWNoZSwgb3BzTG9nQ2FjaGUgKGF1ZGl0XHJcbi8vIGlubGluZSksIGF1ZGl0TG9nQ2FjaGUgKGF1ZGl0IGlubGluZSksIGNvbnRhY3RlZCAoZ2xvYmFsIFNldCksIFBPSU5UUyxcclxuLy8gUFJPRFVDVFMsIFZFTkRPUlMsIE1FU0VTLCB2ZW5kb3JMb29rdXAsIGVzY2FwZUh0bWwsIGVzY2FwZUF0dHIsIHRpdGxlQ2FzZSxcclxuLy8gc2hvd1N5bmNUYWcsIGN1cnJlbnRVc2VyLCB1c2VyUm9sZSwgb3JkZXJzLCBjb25maXJtZWQsIHBlbmRpbmcuXHJcbi8vXHJcbi8vIENyb3NzLXNjb3BlIHN0YXRlOiBOT05FICh0b2RvcyBsb3MgaGVscGVycyB5IGNvbnN0cyBsb2NhbGVzIGFsIGJsb3F1ZSkuXHJcbi8vIFNpbiBsaXN0ZW5lcnMgb25TbmFwc2hvdC5cclxuLy9cclxuLy8gTk9UQTogbG9zIGhlbHBlcnMgdG9kYXlTdHIvZGF0YVVybFRvQmxvYi9zYW5pdGl6ZUZvclBhdGggdml2ZW4gZW4gZXN0ZVxyXG4vLyBtXHUwMEYzZHVsbyBcdTIwMTQgZWwgaW5saW5lIHB1ZWRlIGxsYW1hcmxvcyB2aWEgZnJlZSByZWZlcmVuY2UgYWwgR2xvYmFsIEVudmlyb25tZW50XHJcbi8vIFJlY29yZCBwZXJvIHByZWZlcmltb3MgZXhwb3NpY2lcdTAwRjNuIHdpbmRvdy4qIGV4cGxcdTAwRURjaXRhIGFsIGZpbmFsLlxyXG5cclxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XHJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG4vLyBTRUNDSVx1MDBEM046IGhlbHBlcnMgKyBwaG90b3MgemlwICsgdmlzaXRzIGVtYmVkZGVkIChpbmxpbmUgTDkyNTYtOTQ0NSlcclxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XHJcblxyXG5mdW5jdGlvbiB0b2RheVN0cigpeyByZXR1cm4gbmV3IERhdGUoKS50b0lTT1N0cmluZygpLnNsaWNlKDAsMTApOyB9XHJcblxyXG4vLyBIZWxwZXI6IGNvbnZlcnRpciBkYXRhVVJMIGJhc2U2NCBhIEJsb2IgcGFyYSBpbmNsdWlyIGVuIFpJUFxyXG5mdW5jdGlvbiBkYXRhVXJsVG9CbG9iKGRhdGFVcmwpe1xyXG4gIGlmICghZGF0YVVybCkgcmV0dXJuIG51bGw7XHJcbiAgY29uc3QgcGFydHMgPSBkYXRhVXJsLnNwbGl0KCcsJyk7XHJcbiAgaWYgKHBhcnRzLmxlbmd0aCA8IDIpIHJldHVybiBudWxsO1xyXG4gIGNvbnN0IG1pbWVNYXRjaCA9IHBhcnRzWzBdLm1hdGNoKC86KC4qPyk7Lyk7XHJcbiAgY29uc3QgbWltZSA9IG1pbWVNYXRjaCA/IG1pbWVNYXRjaFsxXSA6ICdpbWFnZS9qcGVnJztcclxuICBjb25zdCBieXRlcyA9IGF0b2IocGFydHNbMV0pO1xyXG4gIGNvbnN0IGFyciA9IG5ldyBVaW50OEFycmF5KGJ5dGVzLmxlbmd0aCk7XHJcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBieXRlcy5sZW5ndGg7IGkrKykgYXJyW2ldID0gYnl0ZXMuY2hhckNvZGVBdChpKTtcclxuICByZXR1cm4gbmV3IEJsb2IoW2Fycl0sIHt0eXBlOiBtaW1lfSk7XHJcbn1cclxuXHJcbi8vIFNhbmVhciBub21icmVzIHBhcmEgcXVlIHNpcnZhbiBjb21vIHJ1dGEgZGUgYXJjaGl2b1xyXG5mdW5jdGlvbiBzYW5pdGl6ZUZvclBhdGgocyl7XHJcbiAgcmV0dXJuIFN0cmluZyhzIHx8ICcnKS5yZXBsYWNlKC9bXFxcXC8qP1xcW1xcXTp8XCI8Pl0vZywgJ18nKS5yZXBsYWNlKC9cXHMrL2csICcgJykudHJpbSgpLnNsaWNlKDAsIDYwKTtcclxufVxyXG5cclxuLy8gRGVzY2FyZ2FyIHRvZGFzIGxhcyBmb3RvcyBkZSB2aXNpdGFzIGVuIHVuIFpJUCBvcmdhbml6YWRvIHBvciB2ZW5kZWRvciAvIHRpZW5kYSAvIGZlY2hhXHJcbndpbmRvdy5leHBvcnRQaG90b3NaaXAgPSBhc3luYyBmdW5jdGlvbigpe1xyXG4gIGlmICh0eXBlb2YgSlNaaXAgPT09ICd1bmRlZmluZWQnKSB7IGFsZXJ0KCdDYXJnYW5kbyBsaWJyZXJpYSBaSVAsIGludGVudGEgZGUgbnVldm8gZW4gNSBzZWd1bmRvcy4nKTsgcmV0dXJuOyB9XHJcbiAgaWYgKCF2aXNpdHNDYWNoZSB8fCAhdmlzaXRzQ2FjaGUubGVuZ3RoKSB7IGFsZXJ0KCdObyBoYXkgdmlzaXRhcyByZWdpc3RyYWRhcy4nKTsgcmV0dXJuOyB9XHJcbiAgbGV0IHBob3RvQ291bnQgPSAwO1xyXG4gIGNvbnN0IHppcCA9IG5ldyBKU1ppcCgpO1xyXG4gIHZpc2l0c0NhY2hlLmZvckVhY2godiA9PiB7XHJcbiAgICBjb25zdCB2ZW5kb3IgPSBzYW5pdGl6ZUZvclBhdGgodGl0bGVDYXNlKHYudmVuZG9yIHx8ICdTSU5fVkVOREVET1InKSk7XHJcbiAgICBjb25zdCB0aWVuZGEgPSBzYW5pdGl6ZUZvclBhdGgodi50aWVuZGEgfHwgJ3Npbl90aWVuZGEnKTtcclxuICAgIGNvbnN0IGZlY2hhID0gKHYuZmVjaGEgfHwgJycpLnJlcGxhY2UoLy0vZywgJycpO1xyXG4gICAgY29uc3QgZm9sZGVyTmFtZSA9IHZlbmRvciArICcvJyArIHRpZW5kYSArICdfJyArIGZlY2hhO1xyXG4gICAgY29uc3QgZm9sZGVyID0gemlwLmZvbGRlcihmb2xkZXJOYW1lKTtcclxuICAgIGlmICh2LmZyZW50ZUxvY2FsKSB7XHJcbiAgICAgIGNvbnN0IGIgPSBkYXRhVXJsVG9CbG9iKHYuZnJlbnRlTG9jYWwpO1xyXG4gICAgICBpZiAoYikgeyBmb2xkZXIuZmlsZSgnZnJlbnRlLmpwZycsIGIpOyBwaG90b0NvdW50Kys7IH1cclxuICAgIH1cclxuICAgICh2LmVzcGFjaW8gfHwgW10pLmZvckVhY2goKGI2NCwgaSkgPT4ge1xyXG4gICAgICBjb25zdCBiID0gZGF0YVVybFRvQmxvYihiNjQpO1xyXG4gICAgICBpZiAoYikgeyBmb2xkZXIuZmlsZSgnZXNwYWNpb18nICsgKGkgKyAxKSArICcuanBnJywgYik7IHBob3RvQ291bnQrKzsgfVxyXG4gICAgfSk7XHJcbiAgfSk7XHJcbiAgaWYgKCFwaG90b0NvdW50KSB7IGFsZXJ0KCdObyBoYXkgZm90b3MgY2FyZ2FkYXMgZW4gbGFzIHZpc2l0YXMuJyk7IHJldHVybjsgfVxyXG4gIHNob3dTeW5jVGFnKCdHZW5lcmFuZG8gWklQIGRlICcgKyBwaG90b0NvdW50ICsgJyBmb3Rvcy4uLicsIDMwMDAwKTtcclxuICB0cnkge1xyXG4gICAgY29uc3QgYmxvYiA9IGF3YWl0IHppcC5nZW5lcmF0ZUFzeW5jKHt0eXBlOiAnYmxvYicsIGNvbXByZXNzaW9uOiAnREVGTEFURSd9KTtcclxuICAgIGNvbnN0IHVybCA9IFVSTC5jcmVhdGVPYmplY3RVUkwoYmxvYik7XHJcbiAgICBjb25zdCBhID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnYScpO1xyXG4gICAgYS5ocmVmID0gdXJsO1xyXG4gICAgYS5kb3dubG9hZCA9ICdTaGltYW5vX0ZvdG9zX1Zpc2l0YXNfJyArIHRvZGF5U3RyKCkgKyAnLnppcCc7XHJcbiAgICBhLmNsaWNrKCk7XHJcbiAgICBzZXRUaW1lb3V0KCgpID0+IFVSTC5yZXZva2VPYmplY3RVUkwodXJsKSwgNTAwMCk7XHJcbiAgICBzaG93U3luY1RhZyhwaG90b0NvdW50ICsgJyBmb3RvcyBkZXNjYXJnYWRhcycsIDMwMDApO1xyXG4gIH0gY2F0Y2goZSkgeyBjb25zb2xlLmVycm9yKCd6aXAnLCBlKTsgYWxlcnQoJ0Vycm9yIGdlbmVyYW5kbyBaSVA6ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTsgfVxyXG59O1xyXG5cclxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XHJcbi8vIEV4Y2VsIGNvbiBmb3RvcyBkZWwgZnJlbnRlIGVtYmViaWRhcyBlbiBjYWRhIGNlbGRhIChFeGNlbEpTKVxyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxuLy8gRXhjZWxKUyBzZSBjYXJnYSBsYXp5IChzb2xvIGN1YW5kbyBzZSB0b2NhIGVsIGJvdG9uKSBwYXJhIG5vIGluZmxhciBlbCBidW5kbGUuXHJcbmZ1bmN0aW9uIGxvYWRFeGNlbEpTKCl7XHJcbiAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcclxuICAgIGlmICh0eXBlb2YgRXhjZWxKUyAhPT0gJ3VuZGVmaW5lZCcpIHJldHVybiByZXNvbHZlKCk7XHJcbiAgICBjb25zdCBzID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnc2NyaXB0Jyk7XHJcbiAgICBzLnNyYyA9ICdodHRwczovL2Nkbi5qc2RlbGl2ci5uZXQvbnBtL2V4Y2VsanNANC40LjAvZGlzdC9leGNlbGpzLm1pbi5qcyc7XHJcbiAgICBzLm9ubG9hZCA9ICgpID0+IHJlc29sdmUoKTtcclxuICAgIHMub25lcnJvciA9ICgpID0+IHJlamVjdChuZXcgRXJyb3IoJ05vIHNlIHB1ZG8gY2FyZ2FyIGxhIGxpYnJlcmlhIEV4Y2VsSlMuIFJldmlzYSB0dSBjb25leGlvbiBhIGludGVybmV0LicpKTtcclxuICAgIGRvY3VtZW50LmhlYWQuYXBwZW5kQ2hpbGQocyk7XHJcbiAgfSk7XHJcbn1cclxuXHJcbndpbmRvdy5leHBvcnRWaXNpdHNXaXRoRW1iZWRkZWRQaG90b3MgPSBhc3luYyBmdW5jdGlvbigpe1xyXG4gIGlmICghdmlzaXRzQ2FjaGUgfHwgIXZpc2l0c0NhY2hlLmxlbmd0aCkgeyBhbGVydCgnTm8gaGF5IHZpc2l0YXMgcmVnaXN0cmFkYXMuJyk7IHJldHVybjsgfVxyXG4gIGNvbnN0IG4gPSB2aXNpdHNDYWNoZS5sZW5ndGg7XHJcbiAgaWYgKG4gPiAzMDApIHtcclxuICAgIGlmICghY29uZmlybSgnSGF5ICcgKyBuICsgJyB2aXNpdGFzLiBFbCBFeGNlbCBjb24gdG9kYXMgbGFzIGZvdG9zIGVtYmViaWRhcyBwdWVkZSBwZXNhciA1MC0xNTAgTUIgeSB0YXJkYXIgdmFyaW9zIG1pbnV0b3MuIFx1MDBCRkNvbnRpbnVhcj8nKSkgcmV0dXJuO1xyXG4gIH0gZWxzZSBpZiAobiA+IDEwMCkge1xyXG4gICAgaWYgKCFjb25maXJtKCdWYXMgYSBnZW5lcmFyIHVuIEV4Y2VsIGNvbiAnICsgbiArICcgdmlzaXRhcyB5IHN1cyBmb3RvcyBlbWJlYmlkYXMuIFB1ZWRlIHRhcmRhciAzMC02MCBzZWd1bmRvcy4gXHUwMEJGQ29udGludWFyPycpKSByZXR1cm47XHJcbiAgfVxyXG4gIHNob3dTeW5jVGFnKCdDYXJnYW5kbyBFeGNlbEpTLi4uJywgMjAwMCk7XHJcbiAgdHJ5IHtcclxuICAgIGF3YWl0IGxvYWRFeGNlbEpTKCk7XHJcbiAgfSBjYXRjaChlKSB7IGFsZXJ0KGUubWVzc2FnZSB8fCBlKTsgcmV0dXJuOyB9XHJcblxyXG4gIHNob3dTeW5jVGFnKCdHZW5lcmFuZG8gRXhjZWwgY29uICcgKyBuICsgJyB2aXNpdGFzLi4uJywgMzAwMCk7XHJcblxyXG4gIGNvbnN0IHdiID0gbmV3IEV4Y2VsSlMuV29ya2Jvb2soKTtcclxuICB3Yi5jcmVhdG9yID0gJ0FwcCBWZW5kZWRvcmVzIFNoaW1hbm8nO1xyXG4gIHdiLmNyZWF0ZWQgPSBuZXcgRGF0ZSgpO1xyXG4gIGNvbnN0IHdzID0gd2IuYWRkV29ya3NoZWV0KCdWaXNpdGFzJywge3ZpZXdzOiBbe3N0YXRlOiAnZnJvemVuJywgeVNwbGl0OiAxfV19KTtcclxuXHJcbiAgLy8gRGVmaW5pY2lvbiBkZSBjb2x1bW5hcy4gTGEgY29sdW1uYSBkZSBmb3RvIHZhIGEgdGVuZXIgYW5jaG8gZXh0cmEgcGFyYSBxdWUgc2UgdmVhLlxyXG4gIHdzLmNvbHVtbnMgPSBbXHJcbiAgICB7aGVhZGVyOiAnRmVjaGEnLCAgICAgICAgIGtleTogJ2ZlY2hhJywgICAgIHdpZHRoOiAxMn0sXHJcbiAgICB7aGVhZGVyOiAnTWVzJywgICAgICAgICAgIGtleTogJ21lcycsICAgICAgIHdpZHRoOiAxMH0sXHJcbiAgICB7aGVhZGVyOiAnVmVuZGVkb3InLCAgICAgIGtleTogJ3ZlbmRlZG9yJywgIHdpZHRoOiAyMn0sXHJcbiAgICB7aGVhZGVyOiAnVGlwbyBjb250YWN0bycsIGtleTogJ3RpcG9DdCcsICAgIHdpZHRoOiAxMn0sXHJcbiAgICB7aGVhZGVyOiAnQ29tZW50YXJpbycsICAgIGtleTogJ2NvbWVudCcsICAgIHdpZHRoOiAzMn0sXHJcbiAgICB7aGVhZGVyOiAnUHJvdmluY2lhJywgICAgIGtleTogJ3Byb3ZpbmNpYScsIHdpZHRoOiAxNn0sXHJcbiAgICB7aGVhZGVyOiAnTG9jYWxpZGFkJywgICAgIGtleTogJ2xvY2FsaWRhZCcsIHdpZHRoOiAxOH0sXHJcbiAgICB7aGVhZGVyOiAnVGllbmRhJywgICAgICAgIGtleTogJ3RpZW5kYScsICAgIHdpZHRoOiAzMH0sXHJcbiAgICB7aGVhZGVyOiAnVGlwbycsICAgICAgICAgIGtleTogJ3RpcG8nLCAgICAgIHdpZHRoOiAxMn0sXHJcbiAgICB7aGVhZGVyOiAnTG9jYWwnLCAgICAgICAgIGtleTogJ2xvY2FsJywgICAgIHdpZHRoOiAxMn0sXHJcbiAgICB7aGVhZGVyOiAnVGFtYW5vJywgICAgICAgIGtleTogJ3RhbWFubycsICAgIHdpZHRoOiAxMH0sXHJcbiAgICB7aGVhZGVyOiAnRmlkZWxpZGFkJywgICAgIGtleTogJ2ZpZGVsaWRhZCcsIHdpZHRoOiAxMH0sXHJcbiAgICB7aGVhZGVyOiAnUmVsZXZhbmNpYScsICAgIGtleTogJ3JlbGV2JywgICAgIHdpZHRoOiAxMH0sXHJcbiAgICB7aGVhZGVyOiAnUE9QJywgICAgICAgICAgIGtleTogJ3BvcCcsICAgICAgIHdpZHRoOiA4fSxcclxuICAgIHtoZWFkZXI6ICdUaXBvIHZlbnRhJywgICAga2V5OiAndGlwb1ZlbnRhJywgd2lkdGg6IDEyfSxcclxuICAgIHtoZWFkZXI6ICdDb21wZXRlbmNpYScsICAga2V5OiAnY29tcGUnLCAgICAgd2lkdGg6IDE2fSxcclxuICAgIHtoZWFkZXI6ICdPcG9ydHVuaWRhZCcsICAga2V5OiAnb3BvcnR1JywgICAgd2lkdGg6IDMwfSxcclxuICAgIHtoZWFkZXI6ICdMbyBtYXMgdmVuZGlkbycsIGtleTogJ21hc1ZlJywgICAgd2lkdGg6IDI4fSxcclxuICAgIHtoZWFkZXI6ICdHUFMgZGlzdCAobSknLCAga2V5OiAnZ3BzRGlzdCcsICAgd2lkdGg6IDEyfSxcclxuICAgIHtoZWFkZXI6ICdGb3RvIGZyZW50ZScsICAga2V5OiAnZm90bycsICAgICAgd2lkdGg6IDIyfSwgLy8gPC0gbGEgaW1hZ2VuIHZhIGFjYVxyXG4gICAge2hlYWRlcjogJ0VtYWlsIHZlbmRlZG9yJyxrZXk6ICdlbWFpbCcsICAgICB3aWR0aDogMjh9LFxyXG4gIF07XHJcblxyXG4gIC8vIEVzdGlsbyBoZWFkZXJcclxuICB3cy5nZXRSb3coMSkuZm9udCA9IHtib2xkOiB0cnVlLCBjb2xvcjoge2FyZ2I6ICdGRkZGRkZGRid9fTtcclxuICB3cy5nZXRSb3coMSkuZmlsbCA9IHt0eXBlOiAncGF0dGVybicsIHBhdHRlcm46ICdzb2xpZCcsIGZnQ29sb3I6IHthcmdiOiAnRkYwQzRBNkUnfX07XHJcbiAgd3MuZ2V0Um93KDEpLmFsaWdubWVudCA9IHt2ZXJ0aWNhbDogJ21pZGRsZScsIGhvcml6b250YWw6ICdjZW50ZXInfTtcclxuICB3cy5nZXRSb3coMSkuaGVpZ2h0ID0gMjI7XHJcblxyXG4gIGNvbnN0IEZPVE9fQ09MX0lEWCA9IHdzLmdldENvbHVtbignZm90bycpLm51bWJlciAtIDE7IC8vIDAtaW5kZXhlZCBwYXJhIGFkZEltYWdlXHJcbiAgY29uc3QgUk9XX0ggPSAxMDA7XHJcbiAgY29uc3QgSU1HX1cgPSAxMzA7XHJcbiAgY29uc3QgSU1HX0ggPSA5MDtcclxuXHJcbiAgLy8gT3JkZW5hciB2aXNpdGFzIHBvciBmZWNoYSBkZXNjIChtYXMgcmVjaWVudGVzIHByaW1lcm8pXHJcbiAgY29uc3Qgc29ydGVkID0gdmlzaXRzQ2FjaGUuc2xpY2UoKS5zb3J0KChhLCBiKSA9PiAoYi5mZWNoYSB8fCAnJykubG9jYWxlQ29tcGFyZShhLmZlY2hhIHx8ICcnKSk7XHJcblxyXG4gIGZvciAoY29uc3QgdiBvZiBzb3J0ZWQpIHtcclxuICAgIGNvbnN0IHRpcG9Db250YWN0b0xibCA9ICh2LnRpcG9Db250YWN0byA9PT0gJ3RlbGVmb25vJykgPyAnVGVsZWZvbm8nIDogJ1ByZXNlbmNpYWwnO1xyXG4gICAgY29uc3QgciA9IHdzLmFkZFJvdyh7XHJcbiAgICAgIGZlY2hhOiAgICAgdi5mZWNoYSB8fCAnJyxcclxuICAgICAgbWVzOiAgICAgICB2Lm1lcyB8fCAnJyxcclxuICAgICAgdmVuZGVkb3I6ICB0aXRsZUNhc2Uodi52ZW5kb3IgfHwgJycpLFxyXG4gICAgICB0aXBvQ3Q6ICAgIHRpcG9Db250YWN0b0xibCxcclxuICAgICAgY29tZW50OiAgICB2LmNvbWVudGFyaW8gfHwgJycsXHJcbiAgICAgIHByb3ZpbmNpYTogdGl0bGVDYXNlKHYucHJvdmluY2lhIHx8ICcnKSxcclxuICAgICAgbG9jYWxpZGFkOiB2LmxvY2FsaWRhZCB8fCAnJyxcclxuICAgICAgdGllbmRhOiAgICB2LnRpZW5kYSB8fCAnJyxcclxuICAgICAgdGlwbzogICAgICB2LnRpcG8gfHwgJycsXHJcbiAgICAgIGxvY2FsOiAgICAgdi5sb2NhbCB8fCAnJyxcclxuICAgICAgdGFtYW5vOiAgICB2LnRhbWFubyB8fCAnJyxcclxuICAgICAgZmlkZWxpZGFkOiB2LmZpZGVsaWRhZCB8fCAnJyxcclxuICAgICAgcmVsZXY6ICAgICB2LnJlbGV2YW5jaWEgfHwgJycsXHJcbiAgICAgIHBvcDogICAgICAgdi5wb3AgfHwgJycsXHJcbiAgICAgIHRpcG9WZW50YTogKHYudGlwb1ZlbnRhID09PSAnTU9TVFJBRE8nID8gJ01PU1RSQURPUicgOiAodi50aXBvVmVudGEgfHwgJycpKSxcclxuICAgICAgY29tcGU6ICAgICB2LmNvbXBldGVuY2lhIHx8ICcnLFxyXG4gICAgICBvcG9ydHU6ICAgIHYub3BvcnR1bmlkYWQgfHwgJycsXHJcbiAgICAgIG1hc1ZlOiAgICAgdi5tYXNWZW5kaWRvIHx8ICcnLFxyXG4gICAgICBncHNEaXN0OiAgICh0eXBlb2Ygdi5ncHNEaXN0YW5jZU0gPT09ICdudW1iZXInKSA/IHYuZ3BzRGlzdGFuY2VNIDogJycsXHJcbiAgICAgIGZvdG86ICAgICAgJycsIC8vIGxhIGNlbGRhIHF1ZWRhIHZhY2lhOyBlbmNpbWEgdmEgbGEgaW1hZ2VuXHJcbiAgICAgIGVtYWlsOiAgICAgdi5vd25lckVtYWlsIHx8ICcnLFxyXG4gICAgfSk7XHJcbiAgICByLmhlaWdodCA9IFJPV19IO1xyXG4gICAgci5hbGlnbm1lbnQgPSB7dmVydGljYWw6ICdtaWRkbGUnLCB3cmFwVGV4dDogdHJ1ZX07XHJcbiAgICBpZiAodi5mcmVudGVMb2NhbCAmJiB0eXBlb2Ygdi5mcmVudGVMb2NhbCA9PT0gJ3N0cmluZycpIHtcclxuICAgICAgdHJ5IHtcclxuICAgICAgICAvLyBFbCBjYW1wbyBlcyB1biBkYXRhVVJMOiAnZGF0YTppbWFnZS9qcGVnO2Jhc2U2NCwvOWovNEFBUS4uLidcclxuICAgICAgICBsZXQgYjY0ID0gdi5mcmVudGVMb2NhbDtcclxuICAgICAgICBsZXQgZXh0ID0gJ2pwZWcnO1xyXG4gICAgICAgIGNvbnN0IG0gPSAvXmRhdGE6aW1hZ2VcXC8oXFx3Kyk7YmFzZTY0LCguKykkL2kuZXhlYyhiNjQpO1xyXG4gICAgICAgIGlmIChtKSB7IGV4dCA9IG1bMV0udG9Mb3dlckNhc2UoKTsgYjY0ID0gbVsyXTsgfVxyXG4gICAgICAgIGlmIChleHQgPT09ICdqcGcnKSBleHQgPSAnanBlZyc7XHJcbiAgICAgICAgY29uc3QgaW1hZ2VJZCA9IHdiLmFkZEltYWdlKHtiYXNlNjQ6IGI2NCwgZXh0ZW5zaW9uOiBleHR9KTtcclxuICAgICAgICB3cy5hZGRJbWFnZShpbWFnZUlkLCB7XHJcbiAgICAgICAgICB0bDoge2NvbDogRk9UT19DT0xfSURYICsgMC4xLCByb3c6IHIubnVtYmVyIC0gMSArIDAuMX0sXHJcbiAgICAgICAgICBleHQ6IHt3aWR0aDogSU1HX1csIGhlaWdodDogSU1HX0h9LFxyXG4gICAgICAgICAgZWRpdEFzOiAnb25lQ2VsbCcsXHJcbiAgICAgICAgfSk7XHJcbiAgICAgIH0gY2F0Y2goZSkgeyBjb25zb2xlLndhcm4oJ2VtYmViaWVuZG8gZm90byBmaWxhJywgci5udW1iZXIsIGUpOyB9XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICAvLyBHZW5lcmFyIHkgZGVzY2FyZ2FyXHJcbiAgdHJ5IHtcclxuICAgIGNvbnN0IGJ1ZmZlciA9IGF3YWl0IHdiLnhsc3gud3JpdGVCdWZmZXIoKTtcclxuICAgIGNvbnN0IGJsb2IgPSBuZXcgQmxvYihbYnVmZmVyXSwge3R5cGU6ICdhcHBsaWNhdGlvbi92bmQub3BlbnhtbGZvcm1hdHMtb2ZmaWNlZG9jdW1lbnQuc3ByZWFkc2hlZXRtbC5zaGVldCd9KTtcclxuICAgIGNvbnN0IHVybCA9IFVSTC5jcmVhdGVPYmplY3RVUkwoYmxvYik7XHJcbiAgICBjb25zdCBhID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnYScpO1xyXG4gICAgYS5ocmVmID0gdXJsO1xyXG4gICAgYS5kb3dubG9hZCA9ICdTaGltYW5vX1Zpc2l0YXNfY29uX2ZvdG9zXycgKyB0b2RheVN0cigpICsgJy54bHN4JztcclxuICAgIGRvY3VtZW50LmJvZHkuYXBwZW5kQ2hpbGQoYSk7IGEuY2xpY2soKTsgZG9jdW1lbnQuYm9keS5yZW1vdmVDaGlsZChhKTtcclxuICAgIHNldFRpbWVvdXQoKCkgPT4gVVJMLnJldm9rZU9iamVjdFVSTCh1cmwpLCA1MDAwKTtcclxuICAgIHNob3dTeW5jVGFnKCdFeGNlbCBkZXNjYXJnYWRvOiAnICsgc29ydGVkLmxlbmd0aCArICcgdmlzaXRhcycsIDMwMDApO1xyXG4gIH0gY2F0Y2goZSkge1xyXG4gICAgY29uc29sZS5lcnJvcignZXhwb3J0VmlzaXRzV2l0aEVtYmVkZGVkUGhvdG9zJywgZSk7XHJcbiAgICBhbGVydCgnRXJyb3IgZ2VuZXJhbmRvIGVsIEV4Y2VsOiAnICsgKGUubWVzc2FnZSB8fCBlKSk7XHJcbiAgfVxyXG59O1xyXG5cclxuXHJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxuLy8gU0VDQ0lcdTAwRDNOOiBleHBvcnRBdWRpdEV4Y2VsIChpbmxpbmUgTDEwMDQwLTEwMDY3KVxyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxuXHJcbndpbmRvdy5leHBvcnRBdWRpdEV4Y2VsID0gZnVuY3Rpb24oKXtcclxuICBpZiAodHlwZW9mIFhMU1ggPT09ICd1bmRlZmluZWQnKSB7XHJcbiAgICBhbGVydCgnTGEgbGlicmVyaWEgZGUgRXhjZWwgbm8gc2UgY2FyZ28uJyk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIGNvbnN0IGl0ZW1zID0gZ2V0RmlsdGVyZWRBdWRpdEVudHJpZXMoKTtcclxuICBpZiAoIWl0ZW1zLmxlbmd0aCkgeyBhbGVydCgnTm8gaGF5IGV2ZW50b3MgcGFyYSBleHBvcnRhciBjb24gbG9zIGZpbHRyb3MgYXBsaWNhZG9zLicpOyByZXR1cm47IH1cclxuICBjb25zdCByb3dzID0gaXRlbXMubWFwKGUgPT4ge1xyXG4gICAgY29uc3QgdHMgPSBlLnRpbWVzdGFtcCAmJiBlLnRpbWVzdGFtcC50b0RhdGUgPyBlLnRpbWVzdGFtcC50b0RhdGUoKSA6IG51bGw7XHJcbiAgICByZXR1cm4ge1xyXG4gICAgICBGZWNoYV9Ib3JhOiB0cyA/IHRzLnRvSVNPU3RyaW5nKCkucmVwbGFjZSgnVCcsICcgJykuc2xpY2UoMCwgMTkpIDogJycsXHJcbiAgICAgIFVzdWFyaW9fRW1haWw6IGUudXNlckVtYWlsIHx8ICcnLFxyXG4gICAgICBVc3VhcmlvX1VJRDogZS51c2VyVWlkIHx8ICcnLFxyXG4gICAgICBSb2w6IGUudXNlclJvbGUgfHwgJycsXHJcbiAgICAgIEFjY2lvbjogQVVESVRfQUNUSU9OX0xBQkVMU1tlLmFjdGlvbl0gfHwgZS5hY3Rpb24gfHwgJycsXHJcbiAgICAgIEFjY2lvbl9SYXc6IGUuYWN0aW9uIHx8ICcnLFxyXG4gICAgICBUaXBvX0VudGlkYWQ6IGUuZW50aXR5VHlwZSB8fCAnJyxcclxuICAgICAgRW50aWRhZDogZS5lbnRpdHlOYW1lIHx8ICcnLFxyXG4gICAgICBEZXRhbGxlc19KU09OOiBlLmRldGFpbHMgPyBKU09OLnN0cmluZ2lmeShlLmRldGFpbHMpIDogJycsXHJcbiAgICB9O1xyXG4gIH0pO1xyXG4gIGNvbnN0IHdiID0gWExTWC51dGlscy5ib29rX25ldygpO1xyXG4gIGNvbnN0IHdzID0gWExTWC51dGlscy5qc29uX3RvX3NoZWV0KHJvd3MpO1xyXG4gIHdzWychY29scyddID0gW3t3Y2g6MjB9LHt3Y2g6MzB9LHt3Y2g6MzB9LHt3Y2g6MTB9LHt3Y2g6MjR9LHt3Y2g6MjB9LHt3Y2g6MTR9LHt3Y2g6NDB9LHt3Y2g6NjB9XTtcclxuICBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KHdiLCB3cywgJ0F1ZGl0b3JpYScpO1xyXG4gIGNvbnN0IHN0YW1wID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpLnNsaWNlKDAsIDEwKTtcclxuICBYTFNYLndyaXRlRmlsZSh3YiwgJ1NoaW1hbm9fQXVkaXRvcmlhXycgKyBzdGFtcCArICcueGxzeCcpO1xyXG59O1xyXG5cclxuXHJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxuLy8gU0VDQ0lcdTAwRDNOOiBidWlsZENvbnRhY3RhZG9zUm93cy9PcHNMb2cvVmlzaXQgKGlubGluZSBMMTAwODEtMTAxNTUpXHJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG5cclxuLy8gTGlzdGEgY29tcGxldGEgZGUgY29udGFjdGFkb3MgKGNsaWVudGVzL3Byb3NwZWN0b3MgbWFyY2Fkb3MgY29uIGNoZWNrKVxyXG5mdW5jdGlvbiBidWlsZENvbnRhY3RhZG9zUm93cygpe1xyXG4gIGNvbnN0IHJvd3MgPSBbXTtcclxuICBjb250YWN0ZWQuZm9yRWFjaChrZXkgPT4ge1xyXG4gICAgY29uc3QgcGFydHMgPSBrZXkuc3BsaXQoJ3wnKTtcclxuICAgIGNvbnN0IHRpcG8gPSBwYXJ0c1swXSwgcHJvdmluY2UgPSBwYXJ0c1sxXSwgbG9jTmFtZSA9IHBhcnRzWzJdLCBjbGllbnROYW1lID0gcGFydHNbM107XHJcbiAgICBjb25zdCBwdCA9IFBPSU5UUy5maW5kKHAgPT4gcC5wcm92aW5jZSA9PT0gcHJvdmluY2UgJiYgcC5uYW1lID09PSBsb2NOYW1lKTtcclxuICAgIGNvbnN0IHZlbmRvciA9IHB0ID8gcHQudmVuZG9yIDogJyc7XHJcbiAgICBjb25zdCB2bSA9IHZlbmRvckxvb2t1cFt2ZW5kb3JdO1xyXG4gICAgcm93cy5wdXNoKHtcclxuICAgICAgVGlwbzogdGlwbyA9PT0gJ0MnID8gJ0NsaWVudGUgYWN0dWFsJyA6ICdQcm9zcGVjdG8nLFxyXG4gICAgICBDbGllbnRlOiBjbGllbnROYW1lLFxyXG4gICAgICBQcm92aW5jaWE6IHRpdGxlQ2FzZShwcm92aW5jZSksXHJcbiAgICAgIExvY2FsaWRhZDogbG9jTmFtZSxcclxuICAgICAgRGVwYXJ0YW1lbnRvOiBwdCA/IChwdC5kZXB0IHx8ICcnKSA6ICcnLFxyXG4gICAgICBWZW5kZWRvcjogdGl0bGVDYXNlKHZlbmRvciB8fCAnJyksXHJcbiAgICAgIFpvbmE6IHZtID8gdm0uem9uZSA6ICcnLFxyXG4gICAgICBDb250YWN0YWRvOiAnU2knLFxyXG4gICAgfSk7XHJcbiAgfSk7XHJcbiAgcm93cy5zb3J0KChhLCBiKSA9PiBhLlZlbmRlZG9yLmxvY2FsZUNvbXBhcmUoYi5WZW5kZWRvcikgfHwgYS5Qcm92aW5jaWEubG9jYWxlQ29tcGFyZShiLlByb3ZpbmNpYSkgfHwgYS5DbGllbnRlLmxvY2FsZUNvbXBhcmUoYi5DbGllbnRlKSk7XHJcbiAgcmV0dXJuIHJvd3M7XHJcbn1cclxuXHJcbi8vIExvZyBkZSBvcGVyYWNpb25lcyAoY2FuY2VsYWNpb25lcywgZWxpbWluYWNpb25lcywgdnVlbHZlLWEtYm9ycmFkb3IsIGV0Yy4pXHJcbmZ1bmN0aW9uIGJ1aWxkT3BzTG9nUm93cygpe1xyXG4gIHJldHVybiAob3BzTG9nQ2FjaGUgfHwgW10pLm1hcChvID0+ICh7XHJcbiAgICBGZWNoYTogby50aW1lc3RhbXAgPyAoby50aW1lc3RhbXAudG9EYXRlID8gby50aW1lc3RhbXAudG9EYXRlKCkudG9Mb2NhbGVTdHJpbmcoKSA6IG5ldyBEYXRlKG8udGltZXN0YW1wKS50b0xvY2FsZVN0cmluZygpKSA6ICcnLFxyXG4gICAgVXN1YXJpbzogby51c2VyRW1haWwgfHwgJycsXHJcbiAgICBSb2w6IG8udXNlclJvbGUgfHwgJycsXHJcbiAgICBBY2Npb246IG8uYWN0aW9uIHx8ICcnLFxyXG4gICAgJ1RpcG8gZW50aWRhZCc6IG8uZW50aXR5VHlwZSB8fCAnJyxcclxuICAgIEVudGlkYWQ6IG8uZW50aXR5TmFtZSB8fCAnJyxcclxuICAgIERldGFsbGVzOiB0eXBlb2Ygby5kZXRhaWxzID09PSAnb2JqZWN0JyA/IEpTT04uc3RyaW5naWZ5KG8uZGV0YWlscykgOiAoby5kZXRhaWxzIHx8ICcnKSxcclxuICB9KSk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGJ1aWxkVmlzaXRSb3dzKCl7XHJcbiAgcmV0dXJuIHZpc2l0c0NhY2hlLm1hcCh2ID0+ICh7XHJcbiAgICBGZWNoYTogdi5mZWNoYSB8fCAnJyxcclxuICAgIE1lczogdi5tZXMgfHwgJycsXHJcbiAgICBBbm86IHYuYW5pbyB8fCAnJyxcclxuICAgIFZlbmRlZG9yOiB0aXRsZUNhc2Uodi52ZW5kb3IgfHwgJycpLFxyXG4gICAgJ1RpcG8gY29udGFjdG8nOiAodi50aXBvQ29udGFjdG8gPT09ICd0ZWxlZm9ubycpID8gJ1RlbGVmb25vJyA6ICdQcmVzZW5jaWFsJyxcclxuICAgIENvbWVudGFyaW86IHYuY29tZW50YXJpbyB8fCAnJyxcclxuICAgIFByb3ZpbmNpYTogdGl0bGVDYXNlKHYucHJvdmluY2lhIHx8ICcnKSxcclxuICAgIExvY2FsaWRhZDogdi5sb2NhbGlkYWQgfHwgJycsXHJcbiAgICBUaWVuZGE6IHYudGllbmRhIHx8ICcnLFxyXG4gICAgJ1RpcG8gdGllbmRhJzogdi50aXBvIHx8ICcnLFxyXG4gICAgTG9jYWw6IHYubG9jYWwgfHwgJycsXHJcbiAgICBUYW1hbm86IHYudGFtYW5vIHx8ICcnLFxyXG4gICAgRmlkZWxpZGFkOiB2LmZpZGVsaWRhZCB8fCAnJyxcclxuICAgICdSZWxldmFuY2lhICgxLTUpJzogdi5yZWxldmFuY2lhIHx8ICcnLFxyXG4gICAgUE9QOiB2LnBvcCB8fCAnJyxcclxuICAgICdOZWNlc2lkYWQgcHVudHVhbCc6ICh2Lm5lY2VzaWRhZFB1bnR1YWwgPT09ICdNT1NUUkFETycgPyAnTU9TVFJBRE9SJyA6ICh2Lm5lY2VzaWRhZFB1bnR1YWwgfHwgJycpKSxcclxuICAgICdUaXBvIHZlbnRhJzogKHYudGlwb1ZlbnRhID09PSAnTU9TVFJBRE8nID8gJ01PU1RSQURPUicgOiAodi50aXBvVmVudGEgfHwgJycpKSxcclxuICAgICclIE1vc3RyYWRvcic6IHYucG9uZGVyYWNpb25Nb3N0cmFkbyAhPSBudWxsID8gdi5wb25kZXJhY2lvbk1vc3RyYWRvIDogJycsXHJcbiAgICAnJSBFY29tbWVyY2UnOiB2LnBvbmRlcmFjaW9uRWNvbW1lcmNlICE9IG51bGwgPyB2LnBvbmRlcmFjaW9uRWNvbW1lcmNlIDogJycsXHJcbiAgICBDb21wZXRlbmNpYTogdi5jb21wZXRlbmNpYSB8fCAnJyxcclxuICAgICdDYXRlZ29yaWEgY2xpZW50ZSc6IHYuY2F0ZWdvcmlhQ2xpZW50ZSB8fCAnJyxcclxuICAgIE9wb3J0dW5pZGFkOiB2Lm9wb3J0dW5pZGFkIHx8ICcnLFxyXG4gICAgJ0xvIG1hcyB2ZW5kaWRvIFNoaW1hbm8nOiB2Lm1hc1ZlbmRpZG8gfHwgJycsXHJcbiAgICAnTG8gcXVlIG1hcyBwcmVndW50YW4nOiB2Lm1hc1ByZWd1bnRhbiB8fCAnJyxcclxuICAgICdBeXVkYSBhIHRpZW5kYSc6IHYuYXl1ZGFUaWVuZGEgfHwgJycsXHJcbiAgICAnRm90b3MgZXNwYWNpbyAoY2FudCknOiAodi5lc3BhY2lvIHx8IFtdKS5sZW5ndGgsXHJcbiAgICAnRm90byBmcmVudGUnOiB2LmZyZW50ZUxvY2FsID8gJ1NpJyA6ICdObycsXHJcbiAgICAnR1BTIGVzdGFkbyc6IHYuZ3BzU3RhdHVzIHx8ICcnLFxyXG4gICAgJ0dQUyBkaXN0YW5jaWEgKG0pJzogKHR5cGVvZiB2Lmdwc0Rpc3RhbmNlTSA9PT0gJ251bWJlcicpID8gdi5ncHNEaXN0YW5jZU0gOiAnJyxcclxuICAgICdHUFMgbGF0Jzogdi5ncHNMYXQgIT0gbnVsbCA/IHYuZ3BzTGF0IDogJycsXHJcbiAgICAnR1BTIGxvbic6IHYuZ3BzTG9uICE9IG51bGwgPyB2Lmdwc0xvbiA6ICcnLFxyXG4gICAgJ0dQUyBwcmVjaXNpb24gKG0pJzogdi5ncHNBY2N1cmFjeSAhPSBudWxsID8gdi5ncHNBY2N1cmFjeSA6ICcnLFxyXG4gICAgJ0dQUyBjYXB0dXJhZG8nOiB2Lmdwc0NhcHR1cmVkQXQgfHwgJycsXHJcbiAgICBFbWFpbDogdi5vd25lckVtYWlsIHx8ICcnLFxyXG4gIH0pKTtcclxufVxyXG5cclxuXHJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxuLy8gU0VDQ0lcdTAwRDNOOiBleHBvcnRFeGVjdXRpdmUvVmlzaXRzL1Bvd2VyQkkvTUwgKGlubGluZSBMMTAxNTgtMTA0MjYpXHJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG5cclxud2luZG93LmV4cG9ydEV4ZWN1dGl2ZSA9IGZ1bmN0aW9uKCl7XHJcbiAgY29uc3Qgd2IgPSBYTFNYLnV0aWxzLmJvb2tfbmV3KCk7XHJcbiAgY29uc3Qgcm93cyA9IGJ1aWxkUGVkaWRvRGV0YWlsUm93cygpO1xyXG4gIGNvbnN0IGNvbmZSb3dzID0gcm93cy5maWx0ZXIociA9PiByLmVzdGFkbyA9PT0gJ0NvbmZpcm1hZG8nKTtcclxuXHJcbiAgLy8gQ29uc29saWRhZG86IHVuYSBmaWxhIHBvciB2ZW5kZWRvciBjb24gS1BJc1xyXG4gIGNvbnN0IHBlclZlbmRvciA9IHt9O1xyXG4gIGNvbmZSb3dzLmZvckVhY2gociA9PiB7XHJcbiAgICBjb25zdCBrID0gci52ZW5kZWRvciB8fCAnU2luIGFzaWduYXInO1xyXG4gICAgaWYgKCFwZXJWZW5kb3Jba10pIHBlclZlbmRvcltrXSA9IHt6b25hOiByLnpvbmEsIHVuaWQ6MCwgYXJzOjAsIHVzZDowLCBjbGllbnRlczpuZXcgU2V0KCksIHByb2RzOm5ldyBTZXQoKSwgcHJvdnM6bmV3IFNldCgpfTtcclxuICAgIHBlclZlbmRvcltrXS51bmlkICs9IHIuY2FudGlkYWQ7XHJcbiAgICBwZXJWZW5kb3Jba10uYXJzICs9IHIuc3VidG90YWxfYXJzO1xyXG4gICAgcGVyVmVuZG9yW2tdLnVzZCArPSByLnN1YnRvdGFsX3VzZDtcclxuICAgIHBlclZlbmRvcltrXS5jbGllbnRlcy5hZGQoci5jbGllbnRlKTtcclxuICAgIHBlclZlbmRvcltrXS5wcm9kcy5hZGQoci5jb2RpZ28pO1xyXG4gICAgcGVyVmVuZG9yW2tdLnByb3ZzLmFkZChyLnByb3ZpbmNpYSk7XHJcbiAgfSk7XHJcbiAgY29uc3QgY29uc29sID0gW107XHJcbiAgVkVORE9SUy5mb3JFYWNoKHYgPT4ge1xyXG4gICAgY29uc3QgdGl0bGVWID0gdGl0bGVDYXNlKHYua2V5KTtcclxuICAgIGNvbnN0IGQgPSBwZXJWZW5kb3JbdGl0bGVWXSB8fCB7em9uYTogdi56b25lLCB1bmlkOjAsIGFyczowLCB1c2Q6MCwgY2xpZW50ZXM6bmV3IFNldCgpLCBwcm9kczpuZXcgU2V0KCksIHByb3ZzOm5ldyBTZXQoKX07XHJcbiAgICBjb25zdCB0ID0gVEFSR0VUU19CWV9WRU5ET1Jbdi5rZXldIHx8IHtqdWwyMDI2X3VzZDowLCBqdWxEaWMyMDI2X3VzZDowLCBhbnVhbDIwMjdfdXNkOjB9O1xyXG4gICAgY29uc29sLnB1c2goe1xyXG4gICAgICBab25hOiB2LnpvbmUsXHJcbiAgICAgIFZlbmRlZG9yOiB0aXRsZVYsXHJcbiAgICAgIFByb3ZpbmNpYXM6IGQucHJvdnMuc2l6ZSxcclxuICAgICAgJ0NsaWVudGVzIGFjdGl2b3MnOiBkLmNsaWVudGVzLnNpemUsXHJcbiAgICAgICdQcm9kdWN0b3MgZGlzdGludG9zJzogZC5wcm9kcy5zaXplLFxyXG4gICAgICBVbmlkYWRlczogZC51bmlkLFxyXG4gICAgICAnRmFjdHVyYWRvIEFSUyc6IE1hdGgucm91bmQoZC5hcnMpLFxyXG4gICAgICAnRmFjdHVyYWRvIFVTRCc6IE1hdGgucm91bmQoZC51c2QpLFxyXG4gICAgICAnVGFyZ2V0IEp1bCAyMDI2IFVTRCc6IHQuanVsMjAyNl91c2QsXHJcbiAgICAgICdUYXJnZXQgSnVsLURpYyAyMDI2IFVTRCc6IHQuanVsRGljMjAyNl91c2QsXHJcbiAgICAgICdUYXJnZXQgMjAyNyBVU0QnOiB0LmFudWFsMjAyN191c2QsXHJcbiAgICB9KTtcclxuICB9KTtcclxuICBjb25zdCB3c0MgPSBYTFNYLnV0aWxzLmpzb25fdG9fc2hlZXQoY29uc29sKTtcclxuICB3c0NbJyFjb2xzJ10gPSBbe3djaDo2fSx7d2NoOjI0fSx7d2NoOjExfSx7d2NoOjE0fSx7d2NoOjE2fSx7d2NoOjExfSx7d2NoOjE2fSx7d2NoOjE2fSx7d2NoOjE4fSx7d2NoOjIwfSx7d2NoOjE4fV07XHJcbiAgWExTWC51dGlscy5ib29rX2FwcGVuZF9zaGVldCh3Yiwgd3NDLCAnQ29uc29saWRhZG8nKTtcclxuXHJcbiAgLy8gVW5hIGhvamEgcG9yIHZlbmRlZG9yIGNvbiBzdSBkZXRhbGxlIGRlIHBlZGlkb3MgY29uZmlybWFkb3NcclxuICBWRU5ET1JTLmZvckVhY2godiA9PiB7XHJcbiAgICBjb25zdCB0aXRsZVYgPSB0aXRsZUNhc2Uodi5rZXkpO1xyXG4gICAgY29uc3QgdnJvd3MgPSBjb25mUm93cy5maWx0ZXIociA9PiByLnZlbmRlZG9yID09PSB0aXRsZVYpLm1hcChyID0+ICh7XHJcbiAgICAgIEZlY2hhOiByLmZlY2hhLCBNZXM6IHIubWVzX3BlZGlkbywgUHJvdmluY2lhOiByLnByb3ZpbmNpYSwgTG9jYWxpZGFkOiByLmxvY2FsaWRhZCxcclxuICAgICAgQ2xpZW50ZTogci5jbGllbnRlLCBUaXBvOiByLnRpcG9fY2xpZW50ZSxcclxuICAgICAgQ29kaWdvOiByLmNvZGlnbywgUHJvZHVjdG86IHIucHJvZHVjdG8sIENhdGVnb3JpYTogci5jYXRlZ29yaWEsIEZhbWlsaWE6IHIuZmFtaWxpYSwgU3ViZmFtaWxpYTogci5zdWJmYW1pbGlhLFxyXG4gICAgICBDYW50aWRhZDogci5jYW50aWRhZCwgJ1ByZWNpbyBBUlMnOiByLnByZWNpb191bml0X2FycywgJ1N1YnRvdGFsIEFSUyc6IHIuc3VidG90YWxfYXJzLCAnU3VidG90YWwgVVNEJzogci5zdWJ0b3RhbF91c2QsXHJcbiAgICB9KSk7XHJcbiAgICB2cm93cy5zb3J0KChhLGIpID0+IChhLkZlY2hhfHwnJykubG9jYWxlQ29tcGFyZShiLkZlY2hhfHwnJykgfHwgYS5DbGllbnRlLmxvY2FsZUNvbXBhcmUoYi5DbGllbnRlKSk7XHJcbiAgICBpZiAoIXZyb3dzLmxlbmd0aCkgdnJvd3MucHVzaCh7RmVjaGE6JycsIE1lczonJywgUHJvdmluY2lhOicnLCBMb2NhbGlkYWQ6JycsIENsaWVudGU6JyhzaW4gcGVkaWRvcyBjb25maXJtYWRvcyknLCBUaXBvOicnLCBDb2RpZ286JycsIFByb2R1Y3RvOicnLCBDYXRlZ29yaWE6JycsIEZhbWlsaWE6JycsIFN1YmZhbWlsaWE6JycsIENhbnRpZGFkOjAsICdQcmVjaW8gQVJTJzowLCAnU3VidG90YWwgQVJTJzowLCAnU3VidG90YWwgVVNEJzowfSk7XHJcbiAgICBjb25zdCB3cyA9IFhMU1gudXRpbHMuanNvbl90b19zaGVldCh2cm93cyk7XHJcbiAgICB3c1snIWNvbHMnXSA9IFt7d2NoOjExfSx7d2NoOjE0fSx7d2NoOjE4fSx7d2NoOjIyfSx7d2NoOjMwfSx7d2NoOjExfSx7d2NoOjE0fSx7d2NoOjM4fSx7d2NoOjE0fSx7d2NoOjE4fSx7d2NoOjE4fSx7d2NoOjEwfSx7d2NoOjEyfSx7d2NoOjE0fSx7d2NoOjE0fV07XHJcbiAgICBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KHdiLCB3cywgKHYuem9uZSArICcgJyArIHRpdGxlVikuc3Vic3RyaW5nKDAsIDMxKS5yZXBsYWNlKC9bXFxcXC9cXCpcXD9cXFtcXF06XS9nLCcnKSk7XHJcbiAgfSk7XHJcblxyXG4gIC8vIFZpc2l0YXNcclxuICBjb25zdCB2aXNpdFJvd3MgPSBidWlsZFZpc2l0Um93cygpO1xyXG4gIGlmICh2aXNpdFJvd3MubGVuZ3RoKSB7XHJcbiAgICBjb25zdCB3c1YgPSBYTFNYLnV0aWxzLmpzb25fdG9fc2hlZXQodmlzaXRSb3dzKTtcclxuICAgIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQod2IsIHdzViwgJ1Zpc2l0YXMnKTtcclxuICB9XHJcbiAgLy8gQ29udGFjdGFkb3MgKHRvZG9zIGxvcyBjbGllbnRlcy9wcm9zcGVjdG9zIG1hcmNhZG9zIGNvbiBjaGVjaylcclxuICBjb25zdCBjb250YWN0Um93cyA9IGJ1aWxkQ29udGFjdGFkb3NSb3dzKCk7XHJcbiAgaWYgKGNvbnRhY3RSb3dzLmxlbmd0aCkge1xyXG4gICAgWExTWC51dGlscy5ib29rX2FwcGVuZF9zaGVldCh3YiwgWExTWC51dGlscy5qc29uX3RvX3NoZWV0KGNvbnRhY3RSb3dzKSwgJ0NvbnRhY3RhZG9zJyk7XHJcbiAgfVxyXG4gIC8vIExvZyBkZSBvcGVyYWNpb25lcyAoY2FuY2VsYWNpb25lcywgZWxpbWluYWNpb25lcywgZXRjLilcclxuICBjb25zdCBvcHNSb3dzID0gYnVpbGRPcHNMb2dSb3dzKCk7XHJcbiAgaWYgKG9wc1Jvd3MubGVuZ3RoKSB7XHJcbiAgICBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KHdiLCBYTFNYLnV0aWxzLmpzb25fdG9fc2hlZXQob3BzUm93cyksICdMb2cgT3BlcmFjaW9uZXMnKTtcclxuICB9XHJcblxyXG4gIFhMU1gud3JpdGVGaWxlKHdiLCAnU2hpbWFub19FamVjdXRpdm9fJyArIHRvZGF5U3RyKCkgKyAnLnhsc3gnKTtcclxufTtcclxuXHJcbi8vIC0tLS0tLS0tLS0gRXhjZWwgZGUgVmlzaXRhcyAoZm9ybWF0byBzdGFuZGFsb25lKSAtLS0tLS0tLS0tXHJcbndpbmRvdy5leHBvcnRWaXNpdHNFeGNlbCA9IGZ1bmN0aW9uKCl7XHJcbiAgaWYgKHR5cGVvZiBYTFNYID09PSAndW5kZWZpbmVkJykge1xyXG4gICAgYWxlcnQoJ0xhIGxpYnJlcmlhIGRlIEV4Y2VsIG5vIHNlIGNhcmdvLiBWZXJpZmlxdWUgc3UgY29uZXhpb24gYSBpbnRlcm5ldCB5IHJlaW50ZW50ZS4nKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgY29uc3QgdmlzaXRSb3dzID0gYnVpbGRWaXNpdFJvd3MoKTtcclxuICBpZiAoIXZpc2l0Um93cy5sZW5ndGgpIHtcclxuICAgIGFsZXJ0KCdObyBoYXkgdmlzaXRhcyByZWdpc3RyYWRhcyB0b2RhdmlhLiBDdWFuZG8gc2UgY2FyZ3VlIGFsIG1lbm9zIHVuYSwgdmFzIGEgcG9kZXIgZXhwb3J0YXJsYS4nKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgY29uc3Qgd2IgPSBYTFNYLnV0aWxzLmJvb2tfbmV3KCk7XHJcblxyXG4gIC8vIEhvamEgcHJpbmNpcGFsOiBWaXNpdGFzICh0b2RhcyBsYXMgZmlsYXMpXHJcbiAgY29uc3Qgd3MgPSBYTFNYLnV0aWxzLmpzb25fdG9fc2hlZXQodmlzaXRSb3dzKTtcclxuICB3c1snIWNvbHMnXSA9IFtcclxuICAgIHt3Y2g6MTJ9LHt3Y2g6MTR9LHt3Y2g6OH0se3djaDoyNH0se3djaDoxOH0se3djaDoyMn0se3djaDozMH0se3djaDoxOH0sXHJcbiAgICB7d2NoOjE0fSx7d2NoOjE0fSx7d2NoOjE0fSx7d2NoOjE2fSx7d2NoOjh9LHt3Y2g6MjJ9LHt3Y2g6MTR9LFxyXG4gICAge3djaDoxNH0se3djaDoxNH0se3djaDoxOH0se3djaDoxOH0se3djaDozMn0se3djaDozMn0se3djaDozMn0se3djaDozMn0sXHJcbiAgICB7d2NoOjE4fSx7d2NoOjE0fSx7d2NoOjI0fSxcclxuICBdO1xyXG4gIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQod2IsIHdzLCAnVmlzaXRhcycpO1xyXG5cclxuICAvLyBIb2phIHJlc3VtZW4gcG9yIHZlbmRlZG9yOiBjYW50aWRhZCBkZSB2aXNpdGFzIHkgdGllbmRhcyB1bmljYXNcclxuICBjb25zdCBwZXJWZW5kb3IgPSB7fTtcclxuICB2aXNpdHNDYWNoZS5mb3JFYWNoKHYgPT4ge1xyXG4gICAgY29uc3QgayA9IHRpdGxlQ2FzZSh2LnZlbmRvciB8fCAnU2luIGFzaWduYXInKTtcclxuICAgIGlmICghcGVyVmVuZG9yW2tdKSBwZXJWZW5kb3Jba10gPSB7dmlzaXRhczogMCwgdGllbmRhczogbmV3IFNldCgpLCBsb2NhbGlkYWRlczogbmV3IFNldCgpLCBwcm92aW5jaWFzOiBuZXcgU2V0KCl9O1xyXG4gICAgcGVyVmVuZG9yW2tdLnZpc2l0YXMrKztcclxuICAgIGlmICh2LnRpZW5kYSkgcGVyVmVuZG9yW2tdLnRpZW5kYXMuYWRkKHYudGllbmRhKTtcclxuICAgIGlmICh2LmxvY2FsaWRhZCkgcGVyVmVuZG9yW2tdLmxvY2FsaWRhZGVzLmFkZCh2LmxvY2FsaWRhZCk7XHJcbiAgICBpZiAodi5wcm92aW5jaWEpIHBlclZlbmRvcltrXS5wcm92aW5jaWFzLmFkZCh2LnByb3ZpbmNpYSk7XHJcbiAgfSk7XHJcbiAgY29uc3QgcmVzdW1lbiA9IE9iamVjdC5lbnRyaWVzKHBlclZlbmRvcikubWFwKChbdmVuZGVkb3IsIGRdKSA9PiAoe1xyXG4gICAgVmVuZGVkb3I6IHZlbmRlZG9yLFxyXG4gICAgJ1Zpc2l0YXMgdG90YWxlcyc6IGQudmlzaXRhcyxcclxuICAgICdUaWVuZGFzIGRpc3RpbnRhcyc6IGQudGllbmRhcy5zaXplLFxyXG4gICAgJ0xvY2FsaWRhZGVzIGRpc3RpbnRhcyc6IGQubG9jYWxpZGFkZXMuc2l6ZSxcclxuICAgICdQcm92aW5jaWFzIGRpc3RpbnRhcyc6IGQucHJvdmluY2lhcy5zaXplLFxyXG4gIH0pKS5zb3J0KChhLCBiKSA9PiBiWydWaXNpdGFzIHRvdGFsZXMnXSAtIGFbJ1Zpc2l0YXMgdG90YWxlcyddKTtcclxuICBpZiAocmVzdW1lbi5sZW5ndGgpIHtcclxuICAgIGNvbnN0IHdzUiA9IFhMU1gudXRpbHMuanNvbl90b19zaGVldChyZXN1bWVuKTtcclxuICAgIHdzUlsnIWNvbHMnXSA9IFt7d2NoOjI0fSx7d2NoOjE2fSx7d2NoOjE4fSx7d2NoOjIyfSx7d2NoOjIyfV07XHJcbiAgICBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KHdiLCB3c1IsICdSZXN1bWVuIHBvciB2ZW5kZWRvcicpO1xyXG4gIH1cclxuXHJcbiAgWExTWC53cml0ZUZpbGUod2IsICdTaGltYW5vX1Zpc2l0YXNfJyArIHRvZGF5U3RyKCkgKyAnLnhsc3gnKTtcclxufTtcclxuXHJcbi8vIC0tLS0tLS0tLS0gT1BDSU9OIEI6IFBvd2VyIEJJIChGYWN0ICsgRGltKSAtLS0tLS0tLS0tXHJcbndpbmRvdy5leHBvcnRQb3dlckJJID0gZnVuY3Rpb24oKXtcclxuICBjb25zdCB3YiA9IFhMU1gudXRpbHMuYm9va19uZXcoKTtcclxuICBjb25zdCByb3dzID0gYnVpbGRQZWRpZG9EZXRhaWxSb3dzKCk7XHJcblxyXG4gIC8vIEZhY3RfUGVkaWRvc1xyXG4gIGNvbnN0IGZhY3RSb3dzID0gcm93cy5maWx0ZXIociA9PiByLmVzdGFkbyAhPT0gJ0JvcnJhZG9yJyk7XHJcbiAgY29uc3Qgd3NGID0gWExTWC51dGlscy5qc29uX3RvX3NoZWV0KGZhY3RSb3dzLm1hcChyID0+ICh7XHJcbiAgICBsaW5lX2lkOiByLmxpbmVfaWQsXHJcbiAgICBmZWNoYTogci5mZWNoYSxcclxuICAgIGVzdGFkbzogci5lc3RhZG8sXHJcbiAgICB2ZW5kZWRvcl9rZXk6IHIudmVuZGVkb3Jfa2V5LFxyXG4gICAgem9uYTogci56b25hLFxyXG4gICAgcHJvdmluY2lhOiByLnByb3ZpbmNpYSxcclxuICAgIGxvY2FsaWRhZDogci5sb2NhbGlkYWQsXHJcbiAgICBjbGllbnRlOiByLmNsaWVudGUsXHJcbiAgICB0aXBvX2NsaWVudGU6IHIudGlwb19jbGllbnRlLFxyXG4gICAgc2t1OiByLmNvZGlnbyxcclxuICAgIGNhbnRpZGFkOiByLmNhbnRpZGFkLFxyXG4gICAgcHJlY2lvX3VuaXRfYXJzOiByLnByZWNpb191bml0X2FycyxcclxuICAgIHN1YnRvdGFsX2Fyczogci5zdWJ0b3RhbF9hcnMsXHJcbiAgICBzdWJ0b3RhbF91c2Q6IHIuc3VidG90YWxfdXNkLFxyXG4gIH0pKSk7XHJcbiAgWExTWC51dGlscy5ib29rX2FwcGVuZF9zaGVldCh3Yiwgd3NGLCAnRmFjdF9QZWRpZG9zJyk7XHJcblxyXG4gIC8vIERpbV9WZW5kZWRvclxyXG4gIGNvbnN0IGRpbVYgPSBWRU5ET1JTLm1hcCh2ID0+IHtcclxuICAgIGNvbnN0IHQgPSBUQVJHRVRTX0JZX1ZFTkRPUlt2LmtleV0gfHwge307XHJcbiAgICByZXR1cm4ge1xyXG4gICAgICB2ZW5kZWRvcl9rZXk6IHYua2V5LFxyXG4gICAgICB2ZW5kZWRvcl9ub21icmU6IHRpdGxlQ2FzZSh2LmtleSksXHJcbiAgICAgIHpvbmE6IHYuem9uZSxcclxuICAgICAgem9uYV9kZXNjcmlwY2lvbjogdi5sYWJlbCxcclxuICAgICAgY29sb3I6IHYuY29sb3IsXHJcbiAgICAgIHRhcmdldF9qdWwyMDI2X3VzZDogdC5qdWwyMDI2X3VzZCB8fCAwLFxyXG4gICAgICB0YXJnZXRfanVsRGljMjAyNl91c2Q6IHQuanVsRGljMjAyNl91c2QgfHwgMCxcclxuICAgICAgdGFyZ2V0XzIwMjdfdXNkOiB0LmFudWFsMjAyN191c2QgfHwgMCxcclxuICAgIH07XHJcbiAgfSk7XHJcbiAgWExTWC51dGlscy5ib29rX2FwcGVuZF9zaGVldCh3YiwgWExTWC51dGlscy5qc29uX3RvX3NoZWV0KGRpbVYpLCAnRGltX1ZlbmRlZG9yJyk7XHJcblxyXG4gIC8vIERpbV9Qcm9kdWN0b1xyXG4gIGNvbnN0IGRpbVAgPSBQUk9EVUNUUy5tYXAocCA9PiAoe3NrdTogcC5jb2RlLCBkZXNjcmlwY2lvbjogcC5kZXNjLCBjYXRlZ29yaWE6IHAuY2F0LCBmYW1pbGlhOiBwLmZhbSwgc3ViZmFtaWxpYTogcC5zdWJ9KSk7XHJcbiAgWExTWC51dGlscy5ib29rX2FwcGVuZF9zaGVldCh3YiwgWExTWC51dGlscy5qc29uX3RvX3NoZWV0KGRpbVApLCAnRGltX1Byb2R1Y3RvJyk7XHJcblxyXG4gIC8vIERpbV9DbGllbnRlICh1bml2ZXJzbylcclxuICBjb25zdCBkaW1DID0gW107XHJcbiAgUE9JTlRTLmZvckVhY2gocCA9PiB7XHJcbiAgICBjb25zdCB2bSA9IHZlbmRvckxvb2t1cFtwLnZlbmRvcl07XHJcbiAgICBwLmNsaWVudHMuZm9yRWFjaChuID0+IGRpbUMucHVzaCh7Y2xpZW50ZTogbiwgdGlwbzogJ0NsaWVudGUgYWN0dWFsJywgcHJvdmluY2lhOiB0aXRsZUNhc2UocC5wcm92aW5jZSksIGxvY2FsaWRhZDogcC5uYW1lLCBkZXBhcnRhbWVudG86IHAuZGVwdCB8fCAnJywgdmVuZGVkb3Jfa2V5OiBwLnZlbmRvciB8fCAnJywgem9uYTogdm0gPyB2bS56b25lIDogJyd9KSk7XHJcbiAgICBwLnByb3NwZWN0cy5mb3JFYWNoKG4gPT4gZGltQy5wdXNoKHtjbGllbnRlOiBuLCB0aXBvOiAnUHJvc3BlY3RvJywgcHJvdmluY2lhOiB0aXRsZUNhc2UocC5wcm92aW5jZSksIGxvY2FsaWRhZDogcC5uYW1lLCBkZXBhcnRhbWVudG86IHAuZGVwdCB8fCAnJywgdmVuZGVkb3Jfa2V5OiBwLnZlbmRvciB8fCAnJywgem9uYTogdm0gPyB2bS56b25lIDogJyd9KSk7XHJcbiAgfSk7XHJcbiAgWExTWC51dGlscy5ib29rX2FwcGVuZF9zaGVldCh3YiwgWExTWC51dGlscy5qc29uX3RvX3NoZWV0KGRpbUMpLCAnRGltX0NsaWVudGUnKTtcclxuXHJcbiAgLy8gRGltX0NhbGVuZGFyaW8gKGZlY2hhcyBkaXN0aW50YXMgZW4gbG9zIHBlZGlkb3MgKyBzZXJpZSBjb250aW51YSBkZWwgYVx1MDBGMW8gYWN0dWFsKVxyXG4gIGNvbnN0IGNhbFNldCA9IG5ldyBTZXQoKTtcclxuICBmYWN0Um93cy5mb3JFYWNoKHIgPT4geyBpZiAoci5mZWNoYSkgY2FsU2V0LmFkZChyLmZlY2hhKTsgfSk7XHJcbiAgLy8gQ29tcGxldGFyIGRlc2RlIDIwMjYtMDEtMDEgaGFzdGEgaG95ICsgMzY1XHJcbiAgY29uc3Qgc3RhcnQgPSBuZXcgRGF0ZSgnMjAyNi0wMS0wMScpO1xyXG4gIGNvbnN0IGVuZCA9IG5ldyBEYXRlKCk7IGVuZC5zZXREYXRlKGVuZC5nZXREYXRlKCkgKyAzNjUpO1xyXG4gIGZvciAobGV0IGQgPSBuZXcgRGF0ZShzdGFydCk7IGQgPD0gZW5kOyBkLnNldERhdGUoZC5nZXREYXRlKCkrMSkpIGNhbFNldC5hZGQoZC50b0lTT1N0cmluZygpLnNsaWNlKDAsMTApKTtcclxuICBjb25zdCBkaW1DYWwgPSBbLi4uY2FsU2V0XS5zb3J0KCkubWFwKGR0ID0+IHtcclxuICAgIGNvbnN0IFt5LG0sZGFdID0gZHQuc3BsaXQoJy0nKS5tYXAoeCA9PiBwYXJzZUludCh4KSk7XHJcbiAgICBjb25zdCBkYXRlT2JqID0gbmV3IERhdGUoeSwgbS0xLCBkYSk7XHJcbiAgICByZXR1cm4ge2ZlY2hhOiBkdCwgeWVhcjogeSwgbW9udGg6IG0sIGRheTogZGEsIHF1YXJ0ZXI6ICdRJyArIChNYXRoLmZsb29yKChtLTEpLzMpKzEpLCBtb250aF9uYW1lOiBNRVNFU1ttLTFdLCB5ZWFyX21vbnRoOiB5ICsgJy0nICsgU3RyaW5nKG0pLnBhZFN0YXJ0KDIsJzAnKSwgZGF5X29mX3dlZWs6IFsnRG9tJywnTHVuJywnTWFyJywnTWllJywnSnVlJywnVmllJywnU2FiJ11bZGF0ZU9iai5nZXREYXkoKV19O1xyXG4gIH0pO1xyXG4gIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQod2IsIFhMU1gudXRpbHMuanNvbl90b19zaGVldChkaW1DYWwpLCAnRGltX0NhbGVuZGFyaW8nKTtcclxuXHJcbiAgLy8gRGltX0NhbXBhbmlhXHJcbiAgY29uc3QgZGltQ21wID0gY2FtcGFpZ25zQ2FjaGUubWFwKGMgPT4gKHtjYW1wYW5pYV9pZDogYy5pZCwgbm9tYnJlOiBjLm5hbWUsIGZpbHRlcl90eXBlOiBjLmZpbHRlclR5cGUsIGZpbHRlcl92YWx1ZXM6IChjLmZpbHRlclZhbHVlc3x8W10pLmpvaW4oJywgJyksIHRhcmdldF90eXBlOiBjLnRhcmdldFR5cGUsIHRhcmdldF9hbW91bnQ6IGMudGFyZ2V0QW1vdW50LCBkZXNkZTogYy5zdGFydERhdGUsIGhhc3RhOiBjLmVuZERhdGV9KSk7XHJcbiAgaWYgKGRpbUNtcC5sZW5ndGgpIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQod2IsIFhMU1gudXRpbHMuanNvbl90b19zaGVldChkaW1DbXApLCAnRGltX0NhbXBhbmlhJyk7XHJcblxyXG4gIC8vIFBhcmFtcyAodGlwbyBkZSBjYW1iaW8sIGZlY2hhIGV4cG9ydCwgdmVyc2lvbilcclxuICBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KHdiLCBYTFNYLnV0aWxzLmpzb25fdG9fc2hlZXQoW1xyXG4gICAge3BhcmFtZXRybzogJ2V4Y2hhbmdlX3JhdGVfYXJzX3VzZCcsIHZhbG9yOiBFWENIQU5HRV9SQVRFfSxcclxuICAgIHtwYXJhbWV0cm86ICdmZWNoYV9leHBvcnQnLCB2YWxvcjogdG9kYXlTdHIoKX0sXHJcbiAgICB7cGFyYW1ldHJvOiAndG90YWxfZmlsYXNfZmFjdCcsIHZhbG9yOiBmYWN0Um93cy5sZW5ndGh9LFxyXG4gIF0pLCAnUGFyYW1ldHJvcycpO1xyXG5cclxuICAvLyBGYWN0X1Zpc2l0YXNcclxuICBjb25zdCB2aXNpdFJvd3NCID0gYnVpbGRWaXNpdFJvd3MoKTtcclxuICBpZiAodmlzaXRSb3dzQi5sZW5ndGgpIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQod2IsIFhMU1gudXRpbHMuanNvbl90b19zaGVldCh2aXNpdFJvd3NCKSwgJ0ZhY3RfVmlzaXRhcycpO1xyXG4gIC8vIENvbnRhY3RhZG9zXHJcbiAgY29uc3QgY29udGFjdFJvd3NCID0gYnVpbGRDb250YWN0YWRvc1Jvd3MoKTtcclxuICBpZiAoY29udGFjdFJvd3NCLmxlbmd0aCkgWExTWC51dGlscy5ib29rX2FwcGVuZF9zaGVldCh3YiwgWExTWC51dGlscy5qc29uX3RvX3NoZWV0KGNvbnRhY3RSb3dzQiksICdDb250YWN0YWRvcycpO1xyXG4gIC8vIExvZyBkZSBvcGVyYWNpb25lc1xyXG4gIGNvbnN0IG9wc1Jvd3NCID0gYnVpbGRPcHNMb2dSb3dzKCk7XHJcbiAgaWYgKG9wc1Jvd3NCLmxlbmd0aCkgWExTWC51dGlscy5ib29rX2FwcGVuZF9zaGVldCh3YiwgWExTWC51dGlscy5qc29uX3RvX3NoZWV0KG9wc1Jvd3NCKSwgJ0xvZ19PcGVyYWNpb25lcycpO1xyXG5cclxuICBYTFNYLndyaXRlRmlsZSh3YiwgJ1NoaW1hbm9fUG93ZXJCSV8nICsgdG9kYXlTdHIoKSArICcueGxzeCcpO1xyXG59O1xyXG5cclxuLy8gLS0tLS0tLS0tLSBPUENJT04gQzogUHl0aG9uIC8gSUEgLyBNTCAoc2luZ2xlIGxvbmctZm9ybWF0IHRhYmxlKSAtLS0tLS0tLS0tXHJcbndpbmRvdy5leHBvcnRNTCA9IGZ1bmN0aW9uKCl7XHJcbiAgY29uc3Qgd2IgPSBYTFNYLnV0aWxzLmJvb2tfbmV3KCk7XHJcbiAgY29uc3Qgcm93cyA9IGJ1aWxkUGVkaWRvRGV0YWlsUm93cygpO1xyXG4gIC8vIG1hc3Rlcl9tbDogdW5hIGZpbGEgcG9yIGxpbmVhIGNvbiBUT0RBUyBsYXMgZmVhdHVyZXNcclxuICBjb25zdCB3cyA9IFhMU1gudXRpbHMuanNvbl90b19zaGVldChyb3dzKTtcclxuICB3c1snIWNvbHMnXSA9IE9iamVjdC5rZXlzKHJvd3NbMF0gfHwge2ZlY2hhOicnfSkubWFwKCgpID0+ICh7d2NoOjE0fSkpO1xyXG4gIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQod2IsIHdzLCAnbWFzdGVyX21sJyk7XHJcblxyXG4gIC8vIGNhdGFsb2dvIHkgdW5pdmVyc28gZGUgY2xpZW50ZXMgY29tbyByZWZlcmVuY2lhcyBwYXJhIGVucmlxdWVjZXIgZW4gcGFuZGFzXHJcbiAgWExTWC51dGlscy5ib29rX2FwcGVuZF9zaGVldCh3YiwgWExTWC51dGlscy5qc29uX3RvX3NoZWV0KFBST0RVQ1RTLm1hcChwID0+ICh7Y29kZTogcC5jb2RlLCBkZXNjOiBwLmRlc2MsIGNhdDogcC5jYXQsIGZhbTogcC5mYW0sIHN1YjogcC5zdWJ9KSkpLCAncHJvZHVjdG9zX2NhdGFsb2dvJyk7XHJcblxyXG4gIGNvbnN0IHVuaXZlcnNlID0gW107XHJcbiAgUE9JTlRTLmZvckVhY2gocCA9PiB7XHJcbiAgICBjb25zdCB2bSA9IHZlbmRvckxvb2t1cFtwLnZlbmRvcl07XHJcbiAgICBwLmNsaWVudHMuZm9yRWFjaChuID0+IHVuaXZlcnNlLnB1c2goe2NsaWVudGU6IG4sIHRpcG86ICdjbGllbnRlX2FjdHVhbCcsIHByb3ZpbmNpYTogdGl0bGVDYXNlKHAucHJvdmluY2UpLCBsb2NhbGlkYWQ6IHAubmFtZSwgZGVwYXJ0YW1lbnRvOiBwLmRlcHQgfHwgJycsIHZlbmRlZG9yOiB0aXRsZUNhc2UocC52ZW5kb3IgfHwgJycpLCB6b25hOiB2bSA/IHZtLnpvbmUgOiAnJywgbGF0OiBwLmxhdCwgbG9uOiBwLmxvbn0pKTtcclxuICAgIHAucHJvc3BlY3RzLmZvckVhY2gobiA9PiB1bml2ZXJzZS5wdXNoKHtjbGllbnRlOiBuLCB0aXBvOiAncHJvc3BlY3RvJywgcHJvdmluY2lhOiB0aXRsZUNhc2UocC5wcm92aW5jZSksIGxvY2FsaWRhZDogcC5uYW1lLCBkZXBhcnRhbWVudG86IHAuZGVwdCB8fCAnJywgdmVuZGVkb3I6IHRpdGxlQ2FzZShwLnZlbmRvciB8fCAnJyksIHpvbmE6IHZtID8gdm0uem9uZSA6ICcnLCBsYXQ6IHAubGF0LCBsb246IHAubG9ufSkpO1xyXG4gIH0pO1xyXG4gIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQod2IsIFhMU1gudXRpbHMuanNvbl90b19zaGVldCh1bml2ZXJzZSksICd1bml2ZXJzb19jbGllbnRlcycpO1xyXG5cclxuICAvLyB0YXJnZXRzIGNvbW8gdGFibGEgbG9uZ1xyXG4gIGNvbnN0IHRhcmdldHNMb25nID0gW107XHJcbiAgT2JqZWN0LmVudHJpZXMoVEFSR0VUU19CWV9WRU5ET1IpLmZvckVhY2goKFt2ZW5kb3IsIHRdKSA9PiB7XHJcbiAgICB0YXJnZXRzTG9uZy5wdXNoKHt2ZW5kZWRvcjogdGl0bGVDYXNlKHZlbmRvciksIHBlcmlvZG86ICdKdWwgMjAyNicsIHN0YXJ0X2RhdGU6ICcyMDI2LTA3LTAxJywgZW5kX2RhdGU6ICcyMDI2LTA3LTMxJywgdGFyZ2V0X3VzZDogdC5qdWwyMDI2X3VzZCB8fCAwfSk7XHJcbiAgICB0YXJnZXRzTG9uZy5wdXNoKHt2ZW5kZWRvcjogdGl0bGVDYXNlKHZlbmRvciksIHBlcmlvZG86ICdKdWwtRGljIDIwMjYnLCBzdGFydF9kYXRlOiAnMjAyNi0wNy0wMScsIGVuZF9kYXRlOiAnMjAyNi0xMi0zMScsIHRhcmdldF91c2Q6IHQuanVsRGljMjAyNl91c2QgfHwgMH0pO1xyXG4gICAgdGFyZ2V0c0xvbmcucHVzaCh7dmVuZGVkb3I6IHRpdGxlQ2FzZSh2ZW5kb3IpLCBwZXJpb2RvOiAnMjAyNycsIHN0YXJ0X2RhdGU6ICcyMDI3LTAxLTAxJywgZW5kX2RhdGU6ICcyMDI3LTEyLTMxJywgdGFyZ2V0X3VzZDogdC5hbnVhbDIwMjdfdXNkIHx8IDB9KTtcclxuICB9KTtcclxuICBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KHdiLCBYTFNYLnV0aWxzLmpzb25fdG9fc2hlZXQodGFyZ2V0c0xvbmcpLCAndGFyZ2V0c19sb25nJyk7XHJcblxyXG4gIC8vIGNhbXBhXHUwMEYxYXNcclxuICBpZiAoY2FtcGFpZ25zQ2FjaGUubGVuZ3RoKSB7XHJcbiAgICBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KHdiLCBYTFNYLnV0aWxzLmpzb25fdG9fc2hlZXQoY2FtcGFpZ25zQ2FjaGUubWFwKGMgPT4gKHtpZDogYy5pZCwgbm9tYnJlOiBjLm5hbWUsIGZpbHRlcl90eXBlOiBjLmZpbHRlclR5cGUsIGZpbHRlcl92YWx1ZXM6IChjLmZpbHRlclZhbHVlc3x8W10pLmpvaW4oJywnKSwgdGFyZ2V0X3R5cGU6IGMudGFyZ2V0VHlwZSwgdGFyZ2V0X2Ftb3VudDogYy50YXJnZXRBbW91bnQsIHN0YXJ0X2RhdGU6IGMuc3RhcnREYXRlLCBlbmRfZGF0ZTogYy5lbmREYXRlfSkpKSwgJ2NhbXBhbmlhcycpO1xyXG4gIH1cclxuXHJcbiAgLy8gcGFyYW1ldHJvc1xyXG4gIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQod2IsIFhMU1gudXRpbHMuanNvbl90b19zaGVldChbXHJcbiAgICB7cGFyYW1ldHJvOiAnZXhjaGFuZ2VfcmF0ZV9hcnNfdXNkJywgdmFsb3I6IEVYQ0hBTkdFX1JBVEV9LFxyXG4gICAge3BhcmFtZXRybzogJ2ZlY2hhX2V4cG9ydCcsIHZhbG9yOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCl9LFxyXG4gIF0pLCAncGFyYW1ldHJvcycpO1xyXG5cclxuICAvLyB2aXNpdGFzXHJcbiAgY29uc3QgdmlzaXRSb3dzQyA9IGJ1aWxkVmlzaXRSb3dzKCk7XHJcbiAgaWYgKHZpc2l0Um93c0MubGVuZ3RoKSBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KHdiLCBYTFNYLnV0aWxzLmpzb25fdG9fc2hlZXQodmlzaXRSb3dzQyksICd2aXNpdGFzJyk7XHJcbiAgLy8gY29udGFjdGFkb3NcclxuICBjb25zdCBjb250YWN0Um93c0MgPSBidWlsZENvbnRhY3RhZG9zUm93cygpO1xyXG4gIGlmIChjb250YWN0Um93c0MubGVuZ3RoKSBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KHdiLCBYTFNYLnV0aWxzLmpzb25fdG9fc2hlZXQoY29udGFjdFJvd3NDKSwgJ2NvbnRhY3RhZG9zJyk7XHJcbiAgLy8gbG9nIGRlIG9wZXJhY2lvbmVzXHJcbiAgY29uc3Qgb3BzUm93c0MgPSBidWlsZE9wc0xvZ1Jvd3MoKTtcclxuICBpZiAob3BzUm93c0MubGVuZ3RoKSBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KHdiLCBYTFNYLnV0aWxzLmpzb25fdG9fc2hlZXQob3BzUm93c0MpLCAnbG9nX29wZXJhY2lvbmVzJyk7XHJcblxyXG4gIFhMU1gud3JpdGVGaWxlKHdiLCAnU2hpbWFub19NTF8nICsgdG9kYXlTdHIoKSArICcueGxzeCcpO1xyXG59O1xyXG5cclxuXHJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG4vLyB2MzcxKzogRXhwb3J0IGRhdGFzZXQgcGFyYSBhblx1MDBFMWxpc2lzIChaSVAgZGUgQ1NWcyBwYXJhIE1MIHBpcGVsaW5lcylcclxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XHJcblxyXG4vKipcclxuICogQWJyZSBlbCBtb2RhbCBjaGljbyBkaXNwYXRjaGVyIGRlbCBib3RvbiBcIkV4cG9ydGFyIGEgRXhjZWxcIi4gTXVlc3RyYVxyXG4gKiAyIHRhcmpldGFzOiBSZXBvcnRlcyBFeGNlbCAodG9kb3MpIHZzIERhdGFzZXQgWklQIChzb2xvIGFkbWluL2dlcmVudGUpLlxyXG4gKi9cclxud2luZG93Lm9wZW5FeHBvcnRGb3JtYXRNb2RhbCA9IGZ1bmN0aW9uKCl7XHJcbiAgLy8gT2N1bHRhci9tb3N0cmFyIHRhcmpldGEgRGF0YXNldCBzZWd1biByb2wuXHJcbiAgY29uc3QgZHNPcHQgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZXhwLW9wdC1kYXRhc2V0LXppcCcpO1xyXG4gIGlmIChkc09wdCkge1xyXG4gICAgY29uc3QgaXNBZG1pbk9yR2VyZW50ZSA9ICh1c2VyUm9sZSA9PT0gJ2FkbWluJyB8fCB1c2VyUm9sZSA9PT0gJ2dlcmVudGUnKTtcclxuICAgIGRzT3B0LnN0eWxlLmRpc3BsYXkgPSBpc0FkbWluT3JHZXJlbnRlID8gJycgOiAnbm9uZSc7XHJcbiAgfVxyXG4gIC8vIE9jdWx0YXIgcHJvZ3Jlc3MgYmFyIChwb3Igc2kgcXVlZG8gYWJpZXJ0byBkZSB1bmEgZWplY3VjaW9uIGFudGVyaW9yKVxyXG4gIGNvbnN0IHByb2cgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZXhwb3J0LWRhdGFzZXQtcHJvZ3Jlc3MnKTtcclxuICBpZiAocHJvZykgcHJvZy5zdHlsZS5kaXNwbGF5ID0gJ25vbmUnO1xyXG4gIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdleHBvcnQtZm9ybWF0LW1vZGFsJykuY2xhc3NMaXN0LmFkZCgnb3BlbicpO1xyXG59O1xyXG5cclxud2luZG93LmNsb3NlRXhwb3J0Rm9ybWF0TW9kYWwgPSBmdW5jdGlvbigpe1xyXG4gIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdleHBvcnQtZm9ybWF0LW1vZGFsJykuY2xhc3NMaXN0LnJlbW92ZSgnb3BlbicpO1xyXG59O1xyXG5cclxuLyoqXHJcbiAqIEFjdHVhbGl6YSBlbCBzdGF0dXMgKyBiYXJyYSBkZWwgbW9kYWwuIHN0YXR1cyBlcyB0ZXh0byBsaWJyZTsgcGVyY2VudCAwLi4xMDAuXHJcbiAqL1xyXG5mdW5jdGlvbiBfdXBkYXRlRXhwb3J0UHJvZ3Jlc3Moc3RhdHVzLCBwZXJjZW50KXtcclxuICBjb25zdCBzID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2V4cG9ydC1kYXRhc2V0LXN0YXR1cycpO1xyXG4gIGNvbnN0IGIgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZXhwb3J0LWRhdGFzZXQtYmFyJyk7XHJcbiAgY29uc3Qgd3JhcCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdleHBvcnQtZGF0YXNldC1wcm9ncmVzcycpO1xyXG4gIGlmICh3cmFwKSB3cmFwLnN0eWxlLmRpc3BsYXkgPSAnJztcclxuICBpZiAocykgcy50ZXh0Q29udGVudCA9IHN0YXR1cztcclxuICBpZiAoYikgYi5zdHlsZS53aWR0aCA9IE1hdGgubWF4KDAsIE1hdGgubWluKDEwMCwgcGVyY2VudCkpICsgJyUnO1xyXG59XHJcblxyXG4vKipcclxuICogRmV0Y2ggc3RvY2suanNvbiBkZWwgcm9vdCBkZWwgc2l0aW8gKHYzNjkrIHRpZW5lIHdhcmVob3VzZUJyZWFrZG93bikuXHJcbiAqIENhY2hlLWJ1c3RpbmcgY29uID90PSBwYXJhIGV2aXRhciBTVy5cclxuICovXHJcbmFzeW5jIGZ1bmN0aW9uIF9mZXRjaFN0b2NrSnNvbigpe1xyXG4gIHRyeSB7XHJcbiAgICBjb25zdCByID0gYXdhaXQgZmV0Y2goJy4vc3RvY2suanNvbj90PScgKyBEYXRlLm5vdygpLCB7Y2FjaGU6ICduby1zdG9yZSd9KTtcclxuICAgIGlmICghci5vaykgdGhyb3cgbmV3IEVycm9yKCdIVFRQICcgKyByLnN0YXR1cyk7XHJcbiAgICByZXR1cm4gYXdhaXQgci5qc29uKCk7XHJcbiAgfSBjYXRjaCAoZSkge1xyXG4gICAgY29uc29sZS53YXJuKCdbZXhwb3J0RGF0YXNldFppcF0gc3RvY2suanNvbiBmYWxsbzonLCBlICYmIGUubWVzc2FnZSk7XHJcbiAgICByZXR1cm4gbnVsbDsgLy8gbm8gYmxvcXVlYW50ZSBcdTIwMTQgcHJvZHVjdG9zLmNzdiBxdWVkYSB2YWNpb1xyXG4gIH1cclxufVxyXG5cclxuLyoqXHJcbiAqIExhenkgbG9hZCBKU1ppcCAocGF0cm9uIHlhIHVzYWRvIGVuIGV4cG9ydFBob3Rvc1ppcCBsaW5lYSB+NDcpLlxyXG4gKi9cclxuYXN5bmMgZnVuY3Rpb24gX2Vuc3VyZUpTWmlwTG9hZGVkKCl7XHJcbiAgaWYgKHR5cGVvZiBKU1ppcCAhPT0gJ3VuZGVmaW5lZCcpIHJldHVybjtcclxuICBhd2FpdCBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XHJcbiAgICBjb25zdCBzID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnc2NyaXB0Jyk7XHJcbiAgICBzLnNyYyA9ICdodHRwczovL2NkbmpzLmNsb3VkZmxhcmUuY29tL2FqYXgvbGlicy9qc3ppcC8zLjEwLjEvanN6aXAubWluLmpzJztcclxuICAgIHMub25sb2FkID0gcmVzb2x2ZTtcclxuICAgIHMub25lcnJvciA9ICgpID0+IHJlamVjdChuZXcgRXJyb3IoJ05vIHNlIHB1ZG8gY2FyZ2FyIEpTWmlwJykpO1xyXG4gICAgZG9jdW1lbnQuaGVhZC5hcHBlbmRDaGlsZChzKTtcclxuICB9KTtcclxufVxyXG5cclxuLyoqXHJcbiAqIERlc2NhcmdhIHVuIEJsb2IgY29tbyBhcmNoaXZvLiBSZXVzYSBlbCBwYXRyb24gZGUgZXhwb3J0UGhvdG9zWmlwLlxyXG4gKi9cclxuZnVuY3Rpb24gX2Rvd25sb2FkQmxvYihibG9iLCBmaWxlbmFtZSl7XHJcbiAgY29uc3QgdXJsID0gVVJMLmNyZWF0ZU9iamVjdFVSTChibG9iKTtcclxuICBjb25zdCBhID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnYScpO1xyXG4gIGEuaHJlZiA9IHVybDtcclxuICBhLmRvd25sb2FkID0gZmlsZW5hbWU7XHJcbiAgZG9jdW1lbnQuYm9keS5hcHBlbmRDaGlsZChhKTtcclxuICBhLmNsaWNrKCk7XHJcbiAgc2V0VGltZW91dCgoKSA9PiB7XHJcbiAgICBkb2N1bWVudC5ib2R5LnJlbW92ZUNoaWxkKGEpO1xyXG4gICAgVVJMLnJldm9rZU9iamVjdFVSTCh1cmwpO1xyXG4gIH0sIDEwMCk7XHJcbn1cclxuXHJcbi8qKlxyXG4gKiBFWFBPUlQgUFJJTkNJUEFMLiBTb2xvIGFkbWluL2dlcmVudGUuIEdlbmVyYSBaSVAgY29uOlxyXG4gKiAgLSBwZWRpZG9zLmNzdiwgdmlzaXRhcy5jc3YsIGNsaWVudGVzLmNzdiwgY2xpZW50X21hc3Rlci5jc3YsIHJlbmRpY2lvbmVzLmNzdixcclxuICogICAgY2FtcGFuaWFzLmNzdiwgdGFyZ2V0cy5jc3YsIHByb2R1Y3Rvcy5jc3YsIHZlbmRvcl9vdmVycmlkZXMuY3N2LFxyXG4gKiAgICBjdXN0b21fcm91dGVzLmNzdiwgc2VndWltaWVudG9fbm90ZXMuY3N2XHJcbiAqICAtIG1hbmlmZXN0Lmpzb24gKHNjaGVtYSArIHVzZUNhc2VNYXRyaXggKyByb3dDb3VudHMgKyBudWxsUmF0ZUJ5RmllbGQgKyBsaW1pdGF0aW9ucylcclxuICpcclxuICogQ2Fzb3MgYm9yZGUgbWFuZWphZG9zOlxyXG4gKiAgLSBTaSBhbGd1bmEgLmdldCgpIGZhbGxhIC0+IGFsZXJ0ICsgbm8gZGVzY2FyZ2FyIChubyBnZW5lcmEgWklQIHBhcmNpYWwgc2lsZW5jaW9zbykuXHJcbiAqICAtIFNpIHN0b2NrLmpzb24gbm8gcmVzcG9uZGUgLT4gcHJvZHVjdG9zLmNzdiBxdWVkYSB2YWNpbyBjb24gd2FybmluZyBlbiBtYW5pZmVzdC5cclxuICogIC0gUHJvZ3Jlc3MgYmFyIGVuIGVsIG1vZGFsIHBhcmEgZmVlZGJhY2sgKH4xMC0zMCBzZWcpLlxyXG4gKi9cclxud2luZG93LmV4cG9ydERhdGFzZXRaaXAgPSBhc3luYyBmdW5jdGlvbigpe1xyXG4gIGlmICh1c2VyUm9sZSAhPT0gJ2FkbWluJyAmJiB1c2VyUm9sZSAhPT0gJ2dlcmVudGUnKSB7XHJcbiAgICBhbGVydCgnU29sbyBhZG1pbiBvIGdlcmVudGUgcHVlZGVuIGV4cG9ydGFyIGVsIGRhdGFzZXQuJyk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIGlmICghZmJEYikge1xyXG4gICAgYWxlcnQoJ0ZpcmVzdG9yZSBubyBpbmljaWFsaXphZG8uIFJlY2FyZ2EgbGEgYXBwLicpO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuXHJcbiAgLy8gUmUtYWJyaXIgbW9kYWwgc2kgZWwgdXN1YXJpbyBjZXJybyB5IG5hdmVnYW1vcyBwb3Igb3RybyBmbHVqby5cclxuICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZXhwb3J0LWZvcm1hdC1tb2RhbCcpLmNsYXNzTGlzdC5hZGQoJ29wZW4nKTtcclxuICBfdXBkYXRlRXhwb3J0UHJvZ3Jlc3MoJ1ByZXBhcmFuZG8uLi4nLCA1KTtcclxuXHJcbiAgdHJ5IHtcclxuICAgIF91cGRhdGVFeHBvcnRQcm9ncmVzcygnQ2FyZ2FuZG8gSlNaaXAuLi4nLCAxMCk7XHJcbiAgICBhd2FpdCBfZW5zdXJlSlNaaXBMb2FkZWQoKTtcclxuXHJcbiAgICAvLyAxKSBGZXRjaCAxMCBjb2xlY2Npb25lcyBGaXJlc3RvcmUgZW4gcGFyYWxlbG8gKyBzdG9jay5qc29uXHJcbiAgICBfdXBkYXRlRXhwb3J0UHJvZ3Jlc3MoJ0xleWVuZG8gRmlyZXN0b3JlICgxMCBjb2xlY2Npb25lcykuLi4nLCAyMCk7XHJcbiAgICBjb25zdCBmaXJlc3RvcmVFbnRyaWVzID0gW1xyXG4gICAgICBbJ3BlZGlkb3MnLCAgICAgICAgICAgZmJEYi5jb2xsZWN0aW9uKCdwZWRpZG9zJykuZ2V0KCldLFxyXG4gICAgICBbJ3Zpc2l0YXMnLCAgICAgICAgICAgZmJEYi5jb2xsZWN0aW9uKCd2aXNpdHMnKS5nZXQoKV0sXHJcbiAgICAgIFsnY2xpZW50ZXMnLCAgICAgICAgICBmYkRiLmNvbGxlY3Rpb24oJ2NsaWVudF9hcHBsaWNhdGlvbnMnKS5nZXQoKV0sXHJcbiAgICAgIFsnY2xpZW50X21hc3RlcicsICAgICBmYkRiLmNvbGxlY3Rpb24oJ2NsaWVudF9tYXN0ZXInKS5nZXQoKV0sXHJcbiAgICAgIFsncmVuZGljaW9uZXMnLCAgICAgICBmYkRiLmNvbGxlY3Rpb24oJ3JlbmRpY2lvbmVzJykuZ2V0KCldLFxyXG4gICAgICBbJ2NhbXBhbmlhcycsICAgICAgICAgZmJEYi5jb2xsZWN0aW9uKCdjYW1wYWlnbnMnKS5nZXQoKV0sXHJcbiAgICAgIFsndGFyZ2V0cycsICAgICAgICAgICBmYkRiLmNvbGxlY3Rpb24oJ3RhcmdldHMnKS5nZXQoKV0sXHJcbiAgICAgIFsndmVuZG9yX292ZXJyaWRlcycsICBmYkRiLmNvbGxlY3Rpb24oJ3ZlbmRvcl9vdmVycmlkZXMnKS5nZXQoKV0sXHJcbiAgICAgIFsnY3VzdG9tX3JvdXRlcycsICAgICBmYkRiLmNvbGxlY3Rpb24oJ2N1c3RvbV9yb3V0ZXMnKS5nZXQoKV0sXHJcbiAgICAgIFsnc2VndWltaWVudG9fbm90ZXMnLCBmYkRiLmNvbGxlY3Rpb24oJ3NlZ3VpbWllbnRvX25vdGVzJykuZ2V0KCldLFxyXG4gICAgXTtcclxuICAgIGNvbnN0IHByb21pc2VzID0gZmlyZXN0b3JlRW50cmllcy5tYXAoKFssIHBdKSA9PiBwKTtcclxuICAgIHByb21pc2VzLnB1c2goX2ZldGNoU3RvY2tKc29uKCkpO1xyXG5cclxuICAgIGNvbnN0IHNldHRsZWQgPSBhd2FpdCBQcm9taXNlLmFsbFNldHRsZWQocHJvbWlzZXMpO1xyXG4gICAgLy8gU2kgQ1VBTFFVSUVSIGdldCgpIGRlIEZpcmVzdG9yZSByZWNoYXpvLCBhYm9ydGFtb3MgKG5vIGV4cG9ydCBwYXJjaWFsIHNpbGVuY2lvc28pLlxyXG4gICAgY29uc3QgZmFpbGVkRmlyZXN0b3JlID0gW107XHJcbiAgICBzZXR0bGVkLnNsaWNlKDAsIGZpcmVzdG9yZUVudHJpZXMubGVuZ3RoKS5mb3JFYWNoKChyLCBpKSA9PiB7XHJcbiAgICAgIGlmIChyLnN0YXR1cyA9PT0gJ3JlamVjdGVkJykgZmFpbGVkRmlyZXN0b3JlLnB1c2goZmlyZXN0b3JlRW50cmllc1tpXVswXSArICc6ICcgKyAoci5yZWFzb24gJiYgci5yZWFzb24ubWVzc2FnZSB8fCByLnJlYXNvbikpO1xyXG4gICAgfSk7XHJcbiAgICBpZiAoZmFpbGVkRmlyZXN0b3JlLmxlbmd0aCkge1xyXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ0ZpcmVzdG9yZSBmZXRjaCBmYWxsbyBlbiAnICsgZmFpbGVkRmlyZXN0b3JlLmxlbmd0aCArICcgY29sZWNjaW9uZXM6XFxuJyArIGZhaWxlZEZpcmVzdG9yZS5qb2luKCdcXG4nKSk7XHJcbiAgICB9XHJcblxyXG4gICAgLy8gMikgRXh0cmFlciBzbmFwc2hvdHMgKyBkb2NzIGNvbiBfaWRcclxuICAgIGNvbnN0IHNuYXBzaG90cyA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgYW55W10+fSAqLyh7fSk7XHJcbiAgICBmaXJlc3RvcmVFbnRyaWVzLmZvckVhY2goKFtuYW1lXSwgaSkgPT4ge1xyXG4gICAgICBjb25zdCBzbmFwID0gLyoqIEB0eXBlIHthbnl9ICovKHNldHRsZWRbaV0pLnZhbHVlO1xyXG4gICAgICBjb25zdCBkb2NzID0gW107XHJcbiAgICAgIHNuYXAuZm9yRWFjaCgoZCkgPT4ge1xyXG4gICAgICAgIGNvbnN0IGRhdGEgPSBkLmRhdGEoKSB8fCB7fTtcclxuICAgICAgICBkYXRhLl9pZCA9IGQuaWQ7XHJcbiAgICAgICAgZG9jcy5wdXNoKGRhdGEpO1xyXG4gICAgICB9KTtcclxuICAgICAgc25hcHNob3RzW25hbWVdID0gZG9jcztcclxuICAgIH0pO1xyXG4gICAgY29uc3Qgc3RvY2tKc29uID0gLyoqIEB0eXBlIHthbnl9ICovKHNldHRsZWRbc2V0dGxlZC5sZW5ndGggLSAxXSkudmFsdWU7IC8vIHB1ZWRlIHNlciBudWxsXHJcblxyXG4gICAgLy8gMykgQ29uc3RydWlyIENTVnMgY29uIHJvdyBidWlsZGVycyArIHNjaGVtYXNcclxuICAgIF91cGRhdGVFeHBvcnRQcm9ncmVzcygnU2VyaWFsaXphbmRvIENTVnMuLi4nLCA1NSk7XHJcbiAgICBjb25zdCBjc3ZzID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+fSAqLyh7fSk7XHJcbiAgICBjb25zdCByb3dDb3VudHMgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIG51bWJlcj59ICovKHt9KTtcclxuICAgIGNvbnN0IGFsbFJvd3NCeUNzdiA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgYW55W11bXT59ICovKHt9KTtcclxuXHJcbiAgICBmb3IgKGNvbnN0IGNvbGxOYW1lIG9mIE9iamVjdC5rZXlzKHNuYXBzaG90cykpIHtcclxuICAgICAgY29uc3Qgc2NoZW1hID0gREFUQVNFVF9TQ0hFTUFTW2NvbGxOYW1lXTtcclxuICAgICAgaWYgKCFzY2hlbWEpIGNvbnRpbnVlO1xyXG4gICAgICBjb25zdCBidWlsZGVyID0gUk9XX0JVSUxERVJTW2NvbGxOYW1lXTtcclxuICAgICAgaWYgKCFidWlsZGVyKSBjb250aW51ZTtcclxuICAgICAgY29uc3QgYWxsUm93cyA9IC8qKiBAdHlwZSB7YW55W11bXX0gKi8oW10pO1xyXG4gICAgICBmb3IgKGNvbnN0IGRvYyBvZiBzbmFwc2hvdHNbY29sbE5hbWVdKSB7XHJcbiAgICAgICAgY29uc3Qgcm93c0ZvckRvYyA9IGJ1aWxkZXIoZG9jKTtcclxuICAgICAgICBmb3IgKGNvbnN0IHIgb2Ygcm93c0ZvckRvYykgYWxsUm93cy5wdXNoKHIpO1xyXG4gICAgICB9XHJcbiAgICAgIGFsbFJvd3NCeUNzdltzY2hlbWEubmFtZV0gPSBhbGxSb3dzO1xyXG4gICAgICBjc3ZzW3NjaGVtYS5uYW1lXSA9IGJ1aWxkQ3N2KHNjaGVtYSwgYWxsUm93cyk7XHJcbiAgICAgIHJvd0NvdW50c1tzY2hlbWEubmFtZV0gPSBhbGxSb3dzLmxlbmd0aDtcclxuICAgIH1cclxuXHJcbiAgICAvLyBwcm9kdWN0b3MuY3N2IChkZXNkZSBzdG9jay5qc29uLCBubyBGaXJlc3RvcmUpXHJcbiAgICBjb25zdCBwcm9kdWN0b3NTY2hlbWEgPSBEQVRBU0VUX1NDSEVNQVMucHJvZHVjdG9zO1xyXG4gICAgY29uc3QgcHJvZHVjdG9zUm93cyA9IHN0b2NrSnNvbiA/IGJ1aWxkUHJvZHVjdG9Sb3dzRnJvbVN0b2NrSnNvbihzdG9ja0pzb24pIDogW107XHJcbiAgICBhbGxSb3dzQnlDc3ZbcHJvZHVjdG9zU2NoZW1hLm5hbWVdID0gcHJvZHVjdG9zUm93cztcclxuICAgIGNzdnNbcHJvZHVjdG9zU2NoZW1hLm5hbWVdID0gYnVpbGRDc3YocHJvZHVjdG9zU2NoZW1hLCBwcm9kdWN0b3NSb3dzKTtcclxuICAgIHJvd0NvdW50c1twcm9kdWN0b3NTY2hlbWEubmFtZV0gPSBwcm9kdWN0b3NSb3dzLmxlbmd0aDtcclxuXHJcbiAgICAvLyA0KSBDb21wdXRhciBudWxsUmF0ZUJ5RmllbGQgcGFyYSBjYWRhIGNhc28gQS1FXHJcbiAgICBfdXBkYXRlRXhwb3J0UHJvZ3Jlc3MoJ0NhbGN1bGFuZG8gY2FsaWRhZCBkZWwgZGF0YXNldC4uLicsIDc1KTtcclxuICAgIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgYW55Pn0gKi9cclxuICAgIGNvbnN0IHVzZUNhc2VXaXRoU3RhdHMgPSB7fTtcclxuICAgIGZvciAoY29uc3QgW2Nhc2VLZXksIHVjXSBvZiBPYmplY3QuZW50cmllcyhEQVRBU0VUX1VTRV9DQVNFX01BVFJJWCkpIHtcclxuICAgICAgY29uc3Qgc3RhdHMgPSAvKiogQHR5cGUge2FueX0gKi8oe3ByaW9yaXR5OiB1Yy5wcmlvcml0eSwgZGVzY3JpcHRpb246IHVjLmRlc2NyaXB0aW9uLCByZXF1aXJlZEZpZWxkczogdWMucmVxdWlyZWRGaWVsZHMsIGpvaW5Ob3RlczogdWMuam9pbk5vdGVzLCBudWxsUmF0ZUJ5RmllbGQ6IHt9LCBsaW1pdGF0aW9uczogW119KTtcclxuICAgICAgbGV0IGhhc0hpZ2hOdWxsUmF0ZSA9IGZhbHNlO1xyXG4gICAgICBsZXQgaGFzRW1wdHlSZXF1aXJlZCA9IGZhbHNlO1xyXG4gICAgICBmb3IgKGNvbnN0IFtjc3ZOYW1lLCBmaWVsZHNdIG9mIE9iamVjdC5lbnRyaWVzKHVjLnJlcXVpcmVkRmllbGRzKSkge1xyXG4gICAgICAgIGNvbnN0IHNjaGVtYUZvckNzdiA9IE9iamVjdC52YWx1ZXMoREFUQVNFVF9TQ0hFTUFTKS5maW5kKChzKSA9PiBzLm5hbWUgPT09IGNzdk5hbWUpO1xyXG4gICAgICAgIGlmICghc2NoZW1hRm9yQ3N2KSB7IHN0YXRzLmxpbWl0YXRpb25zLnB1c2goJ1NjaGVtYSBubyBlbmNvbnRyYWRvIHBhcmEgJyArIGNzdk5hbWUpOyBjb250aW51ZTsgfVxyXG4gICAgICAgIGNvbnN0IHJvd3MgPSBhbGxSb3dzQnlDc3ZbY3N2TmFtZV0gfHwgW107XHJcbiAgICAgICAgY29uc3QgcmF0ZXMgPSBjb21wdXRlTnVsbFJhdGVzKHNjaGVtYUZvckNzdiwgcm93cywgZmllbGRzKTtcclxuICAgICAgICBmb3IgKGNvbnN0IFtmLCByYXRlXSBvZiBPYmplY3QuZW50cmllcyhyYXRlcykpIHtcclxuICAgICAgICAgIHN0YXRzLm51bGxSYXRlQnlGaWVsZFtjc3ZOYW1lICsgJy4nICsgZl0gPSByYXRlO1xyXG4gICAgICAgICAgaWYgKHJvd3MubGVuZ3RoID09PSAwKSBoYXNFbXB0eVJlcXVpcmVkID0gdHJ1ZTtcclxuICAgICAgICAgIGVsc2UgaWYgKHJhdGUgPiAwLjUpIGhhc0hpZ2hOdWxsUmF0ZSA9IHRydWU7XHJcbiAgICAgICAgfVxyXG4gICAgICB9XHJcbiAgICAgIGlmIChoYXNFbXB0eVJlcXVpcmVkKSB7XHJcbiAgICAgICAgc3RhdHMuc3RhdHVzID0gJ0VNUFRZJztcclxuICAgICAgICBzdGF0cy5saW1pdGF0aW9ucy5wdXNoKCdBbGd1bmEgY29sZWNjaW9uIHJlcXVlcmlkYSBlc3RhIHZhY2lhIFx1MjAxNCBlbCBjYXNvIG5vIHNlIHB1ZWRlIGVudHJlbmFyIGhveSBwZXJvIGVsIHNjaGVtYSBlc3RhIGxpc3RvLicpO1xyXG4gICAgICB9IGVsc2UgaWYgKGhhc0hpZ2hOdWxsUmF0ZSkge1xyXG4gICAgICAgIHN0YXRzLnN0YXR1cyA9ICdQQVJUSUFMJztcclxuICAgICAgICBzdGF0cy5saW1pdGF0aW9ucy5wdXNoKCdBbCBtZW5vcyAxIGNhbXBvIHJlcXVlcmlkbyB0aWVuZSA+NTAlIGRlIG51bGxzIFx1MjAxNCByZXZpc2FyIHRhc2FzIGFudGVzIGRlIHVzYXIuJyk7XHJcbiAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgc3RhdHMuc3RhdHVzID0gJ09LJztcclxuICAgICAgfVxyXG4gICAgICB1c2VDYXNlV2l0aFN0YXRzW2Nhc2VLZXldID0gc3RhdHM7XHJcbiAgICB9XHJcblxyXG4gICAgLy8gNSkgTWFuaWZlc3QuanNvblxyXG4gICAgY29uc3QgZXhwb3J0ZWRBdCA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKTtcclxuICAgIGNvbnN0IG1hbmlmZXN0ID0ge1xyXG4gICAgICBleHBvcnRlZEF0LFxyXG4gICAgICBhcHBWZXJzaW9uOiAodHlwZW9mIEFQUF9WRVJTSU9OICE9PSAndW5kZWZpbmVkJyA/IEFQUF9WRVJTSU9OIDogJ3Vua25vd24nKSxcclxuICAgICAgc291cmNlUHJvamVjdDogJ2FwcC12ZW5kZWRvcmVzLXNoaW1hbm8nLFxyXG4gICAgICBleHBvcnRlZEJ5RW1haWw6IChjdXJyZW50VXNlciAmJiBjdXJyZW50VXNlci5lbWFpbCkgfHwgJ3Vua25vd24nLFxyXG4gICAgICBleHBvcnRlZEJ5VWlkOiAoY3VycmVudFVzZXIgJiYgY3VycmVudFVzZXIudWlkKSB8fCAndW5rbm93bicsXHJcbiAgICAgIGNzdkNvbnZlbnRpb25zOiB7XHJcbiAgICAgICAgZW5jb2Rpbmc6ICdVVEYtOCcsXHJcbiAgICAgICAgc2VwYXJhdG9yOiAnLCcsXHJcbiAgICAgICAgcXVvdGVDaGFyOiAnXCInLFxyXG4gICAgICAgIGVzY2FwZVF1b3RlOiAnXCJcIicsXHJcbiAgICAgICAgbGluZVRlcm1pbmF0b3I6ICdcXFxcclxcXFxuJyxcclxuICAgICAgICBkYXRlRm9ybWF0OiAnSVNPIDg2MDEgVVRDICh3aXRoIFopJyxcclxuICAgICAgICBkZWNpbWFsU2VwYXJhdG9yOiAnLicsXHJcbiAgICAgICAgbnVsbFJlcHJlc2VudGF0aW9uOiAnKGVtcHR5IGZpZWxkKScsXHJcbiAgICAgICAgYXJyYXlGb3JtYXQ6ICdKU09OIHN0cmluZ2lmaWVkJyxcclxuICAgICAgICBvYmplY3RGb3JtYXQ6ICdKU09OIHN0cmluZ2lmaWVkJyxcclxuICAgICAgfSxcclxuICAgICAgcm93Q291bnRzLFxyXG4gICAgICBzY2hlbWE6IHt9LFxyXG4gICAgICB1c2VDYXNlTWF0cml4OiB1c2VDYXNlV2l0aFN0YXRzLFxyXG4gICAgICBleGNsdXNpb25zOiB7XHJcbiAgICAgICAgbm90ZTogJ0RhdG9zIHNlbnNpYmxlcyB5IGJpbmFyaW9zIGV4Y2x1aWRvcyBkZWwgZXhwb3J0LicsXHJcbiAgICAgICAgZXhjbHVkZWRDb2xsZWN0aW9uczogWydyb2xlcycsICdhcHBfY29uZmlnJywgJ3NhcF9zbmFwc2hvdCcsICdub3RpZmljYXRpb25zJywgJ29wZXJhdGlvbnNfbG9nJ10sXHJcbiAgICAgICAgZXhjbHVkZWRGaWVsZHM6IFtcclxuICAgICAgICAgICd2aXNpdHMuZnJlbnRlTG9jYWwgKGZvdG9zIGJhc2U2NCknLFxyXG4gICAgICAgICAgJ3Zpc2l0cy5lc3BhY2lvW10gKGZvdG9zIGJhc2U2NCknLFxyXG4gICAgICAgICAgJ2NsaWVudF9hcHBsaWNhdGlvbnMuY29uc3RhbmNpYUFyY2EgKGJhc2U2NCknLFxyXG4gICAgICAgICAgJ2NsaWVudF9hcHBsaWNhdGlvbnMuY29uc3RhbmNpYUlJQkIgKGJhc2U2NCknLFxyXG4gICAgICAgICAgJ2NsaWVudF9hcHBsaWNhdGlvbnMuZm90b3NMb2NhbFtdIChiYXNlNjQpJyxcclxuICAgICAgICAgICdyZW5kaWNpb25lcy5mb3RvVGlja2V0IChiYXNlNjQgbGVnYWN5IHByZS12MzA4OyBzZSBleHBvcnRhIHNvbG8gZm90b1RpY2tldFVybCknLFxyXG4gICAgICAgIF0sXHJcbiAgICAgICAgc3RvY2tKc29uTG9hZGVkOiBzdG9ja0pzb24gIT09IG51bGwsXHJcbiAgICAgIH0sXHJcbiAgICB9O1xyXG4gICAgZm9yIChjb25zdCBbY29sbE5hbWUsIHNjaGVtYV0gb2YgT2JqZWN0LmVudHJpZXMoREFUQVNFVF9TQ0hFTUFTKSkge1xyXG4gICAgICBtYW5pZmVzdC5zY2hlbWFbc2NoZW1hLm5hbWVdID0gc2NoZW1hLmNvbHVtbnMubWFwKChjKSA9PiAoe2NvbDogYy5jb2wsIHR5cGU6IGMudHlwZSwgZGVzYzogYy5kZXNjfSkpO1xyXG4gICAgfVxyXG5cclxuICAgIC8vIDYpIEVtcGFxdWV0YXIgWklQXHJcbiAgICBfdXBkYXRlRXhwb3J0UHJvZ3Jlc3MoJ0VtcGFxdWV0YW5kbyBaSVAuLi4nLCA5MCk7XHJcbiAgICBjb25zdCB6aXAgPSBuZXcgSlNaaXAoKTtcclxuICAgIGZvciAoY29uc3QgW25hbWUsIGNvbnRlbnRdIG9mIE9iamVjdC5lbnRyaWVzKGNzdnMpKSB7XHJcbiAgICAgIHppcC5maWxlKG5hbWUsIGNvbnRlbnQpO1xyXG4gICAgfVxyXG4gICAgemlwLmZpbGUoJ21hbmlmZXN0Lmpzb24nLCBKU09OLnN0cmluZ2lmeShtYW5pZmVzdCwgbnVsbCwgMikpO1xyXG5cclxuICAgIGNvbnN0IGJsb2IgPSBhd2FpdCB6aXAuZ2VuZXJhdGVBc3luYyh7dHlwZTogJ2Jsb2InLCBjb21wcmVzc2lvbjogJ0RFRkxBVEUnLCBjb21wcmVzc2lvbk9wdGlvbnM6IHtsZXZlbDogNn19KTtcclxuICAgIGNvbnN0IGZpbGVuYW1lID0gJ3NoaW1hbm8tZGF0YXNldC0nICsgZXhwb3J0ZWRBdC5yZXBsYWNlKC9bOi5dL2csICctJykgKyAnLnppcCc7XHJcbiAgICBfZG93bmxvYWRCbG9iKGJsb2IsIGZpbGVuYW1lKTtcclxuXHJcbiAgICBfdXBkYXRlRXhwb3J0UHJvZ3Jlc3MoJ0RhdGFzZXQgZGVzY2FyZ2FkbzogJyArIGZpbGVuYW1lICsgJyAoJyArIE9iamVjdC5rZXlzKGNzdnMpLmxlbmd0aCArICcgQ1NWcyArIG1hbmlmZXN0Lmpzb24pJywgMTAwKTtcclxuICAgIGlmICh0eXBlb2Ygc2hvd1N5bmNUYWcgPT09ICdmdW5jdGlvbicpIHtcclxuICAgICAgY29uc3QgdG90YWxSb3dzID0gT2JqZWN0LnZhbHVlcyhyb3dDb3VudHMpLnJlZHVjZSgoYSwgYikgPT4gYSArIGIsIDApO1xyXG4gICAgICBzaG93U3luY1RhZygnRGF0YXNldCBleHBvcnRhZG86ICcgKyB0b3RhbFJvd3MgKyAnIGZpbGFzIGVuICcgKyBPYmplY3Qua2V5cyhjc3ZzKS5sZW5ndGggKyAnIENTVnMnKTtcclxuICAgIH1cclxuICAgIHNldFRpbWVvdXQoKCkgPT4gd2luZG93LmNsb3NlRXhwb3J0Rm9ybWF0TW9kYWwoKSwgMzAwMCk7XHJcbiAgfSBjYXRjaCAoZSkge1xyXG4gICAgY29uc29sZS5lcnJvcignW2V4cG9ydERhdGFzZXRaaXBdIGZhdGFsOicsIGUpO1xyXG4gICAgX3VwZGF0ZUV4cG9ydFByb2dyZXNzKCdFcnJvcjogJyArIChlICYmIGUubWVzc2FnZSB8fCBlKSwgMCk7XHJcbiAgICBhbGVydCgnRXJyb3IgYWwgZXhwb3J0YXIgZWwgZGF0YXNldDpcXG5cXG4nICsgKGUgJiYgZS5tZXNzYWdlIHx8IGUpICsgJ1xcblxcbkVsIFpJUCBOTyBzZSBkZXNjYXJnbyAoZXZpdGFtb3MgZ2VuZXJhciB1biBhcmNoaXZvIHBhcmNpYWwpLiBSZXZpc2EgbGEgY29uc29sYSBwYXJhIG1hcyBkZXRhbGxlcy4nKTtcclxuICB9XHJcbn07XHJcblxyXG5cclxuLy8gPT09IEV4cG9ydHMgYSB3aW5kb3cgPT09XHJcbi8vIFRvZGFzIGxhcyBmdW5jaW9uZXMgd2luZG93LmZvbyA9IGZ1bmN0aW9uLi4uIHlhIGVzdFx1MDBFMW4gdmVyYmF0aW0uXHJcbmlmICh0eXBlb2Ygd2luZG93LnRvZGF5U3RyID09PSBcInVuZGVmaW5lZFwiKSB3aW5kb3cudG9kYXlTdHIgPSB0b2RheVN0cjtcclxuLy8gRTYgaG90Zml4IDI6IGRhdGFVcmxUb0Jsb2IgKyBzYW5pdGl6ZUZvclBhdGggdXNhZG9zIHBvciBpbmxpbmUgcnVuRnVsbEJhY2t1cCAoTDcyNzgtNzI4OCkuXHJcbmlmICh0eXBlb2Ygd2luZG93LmRhdGFVcmxUb0Jsb2IgPT09IFwidW5kZWZpbmVkXCIpIHdpbmRvdy5kYXRhVXJsVG9CbG9iID0gZGF0YVVybFRvQmxvYjtcclxuaWYgKHR5cGVvZiB3aW5kb3cuc2FuaXRpemVGb3JQYXRoID09PSBcInVuZGVmaW5lZFwiKSB3aW5kb3cuc2FuaXRpemVGb3JQYXRoID0gc2FuaXRpemVGb3JQYXRoO1xyXG4vLyBFNiBob3RmaXggMzogY3Jvc3MtbW9kdWxlIGJ1ZyAoYXVkaXQgY3Jvc3NidW5kbGUpIFx1MjAxNCBleHBvcnRzLWNvcmUgbGxhbWEgbG9hZEV4Y2VsSlMuXHJcbndpbmRvdy5sb2FkRXhjZWxKUyA9IGxvYWRFeGNlbEpTO1xyXG4iXSwKICAibWFwcGluZ3MiOiAiOzs7QUFvQ08sV0FBUyxVQUFVLEdBQUc7QUFDM0IsUUFBSSxNQUFNLFFBQVEsTUFBTSxPQUFXLFFBQU87QUFDMUMsVUFBTSxNQUFNLE9BQU8sQ0FBQztBQUNwQixRQUFJLFFBQVEsR0FBSSxRQUFPO0FBRXZCLFFBQUksV0FBVyxLQUFLLEdBQUcsR0FBRztBQUN4QixhQUFPLE1BQU0sSUFBSSxRQUFRLE1BQU0sSUFBSSxJQUFJO0FBQUEsSUFDekM7QUFDQSxXQUFPO0FBQUEsRUFDVDtBQVFPLFdBQVMsT0FBTyxRQUFRO0FBQzdCLFdBQU8sT0FBTyxJQUFJLENBQUMsTUFBTSxVQUFVLG9CQUFvQixDQUFDLENBQUMsQ0FBQyxFQUFFLEtBQUssR0FBRztBQUFBLEVBQ3RFO0FBZ0JPLFdBQVMsb0JBQW9CLEdBQUc7QUFDckMsUUFBSSxNQUFNLFFBQVEsTUFBTSxPQUFXLFFBQU87QUFDMUMsUUFBSSxPQUFPLE1BQU0sU0FBVSxRQUFPO0FBQ2xDLFFBQUksT0FBTyxNQUFNLFVBQVU7QUFDekIsVUFBSSxDQUFDLFNBQVMsQ0FBQyxFQUFHLFFBQU87QUFDekIsYUFBTyxPQUFPLENBQUM7QUFBQSxJQUNqQjtBQUNBLFFBQUksT0FBTyxNQUFNLFVBQVcsUUFBTyxJQUFJLFNBQVM7QUFFaEQsUUFBSSxPQUFPLE1BQU0sWUFBWSxNQUFNLFFBQVE7QUFBQSxJQUEyQixFQUFJLFdBQVcsWUFBWTtBQUMvRixVQUFJO0FBQ0Y7QUFBQTtBQUFBLFVBQTJCLEVBQUksT0FBTyxFQUFFLFlBQVk7QUFBQTtBQUFBLE1BQ3RELFNBQVMsR0FBRztBQUNWLGVBQU87QUFBQSxNQUNUO0FBQUEsSUFDRjtBQUNBLFFBQUksYUFBYSxNQUFNO0FBQ3JCLFVBQUksTUFBTSxFQUFFLFFBQVEsQ0FBQyxFQUFHLFFBQU87QUFDL0IsYUFBTyxF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QUFFLE1BQU07QUFBQSxNQUNaLElBQUksRUFBRSxTQUFTO0FBQUEsTUFDZixJQUFJLEVBQUUsTUFBTTtBQUFBLE1BQ1osSUFBSSxFQUFFLE1BQU07QUFBQSxNQUNaLElBQUksRUFBRSxNQUFNO0FBQUEsSUFDZCxDQUFDLENBQUM7QUFBQSxFQUNKO0FBR08sV0FBUyxnQkFBZ0IsS0FBSztBQUNuQyxXQUFPLENBQUM7QUFBQSxNQUNOLElBQUk7QUFBQSxNQUNKLElBQUk7QUFBQSxNQUNKLElBQUk7QUFBQSxNQUNKLElBQUk7QUFBQSxNQUNKLElBQUk7QUFBQSxNQUNKLElBQUk7QUFBQSxNQUNKLElBQUk7QUFBQSxNQUNKLElBQUk7QUFBQSxNQUNKLElBQUk7QUFBQSxNQUNKLElBQUk7QUFBQSxNQUNKLElBQUk7QUFBQSxNQUNKLElBQUk7QUFBQSxNQUNKLElBQUk7QUFBQSxNQUNKLElBQUk7QUFBQSxNQUNKLElBQUk7QUFBQSxNQUNKLElBQUk7QUFBQSxNQUNKLElBQUk7QUFBQSxNQUNKLElBQUk7QUFBQSxNQUNKLElBQUk7QUFBQSxNQUNKLElBQUk7QUFBQSxNQUNKLElBQUk7QUFBQSxNQUNKLElBQUk7QUFBQSxNQUNKLElBQUk7QUFBQSxNQUNKLElBQUk7QUFBQSxNQUNKLElBQUk7QUFBQSxNQUNKLElBQUk7QUFBQSxNQUNKLElBQUk7QUFBQSxNQUNKLElBQUk7QUFBQSxNQUNKLElBQUk7QUFBQSxNQUNKLElBQUk7QUFBQSxNQUNKLElBQUk7QUFBQSxNQUNKLElBQUk7QUFBQSxNQUNKLElBQUk7QUFBQSxJQUNOLENBQUM7QUFBQSxFQUNIO0FBR08sV0FBUyxpQkFBaUIsS0FBSztBQUNwQyxXQUFPLENBQUM7QUFBQSxNQUNOLElBQUk7QUFBQSxNQUNKLElBQUk7QUFBQSxNQUNKLElBQUk7QUFBQSxNQUNKLElBQUk7QUFBQSxNQUNKLElBQUk7QUFBQSxNQUNKLElBQUk7QUFBQSxNQUNKLElBQUk7QUFBQSxNQUNKLElBQUk7QUFBQSxNQUNKLElBQUk7QUFBQSxNQUNKLElBQUk7QUFBQSxNQUNKLElBQUk7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
