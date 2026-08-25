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
      if (!Number.isFinite(v)) return "";
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
      if (Number.isNaN(v.getTime())) return "";
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
        {
          col: "discount_pct",
          type: "number",
          desc: "descuento total del pedido (aplicado a nivel header, prorratear en pipeline)"
        },
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
        {
          col: "forma_contacto",
          type: "string",
          desc: "LLAMADA TELEFONICA | MENSAJE DE WHATSAPP | MENSAJE SMS (si contacto)"
        },
        {
          col: "contacto_resultado",
          type: "string",
          desc: "respondio | no_respondio | vacio (sin marcar, solo aplica a contacto)"
        },
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
        {
          col: "source",
          type: "string",
          desc: "manual | sap_bulk_import | alta_rapida | sap_sync | sap_sync_manual_link"
        },
        {
          col: "manual_sap_pending",
          type: "boolean",
          desc: "true=provisorio (Alta Rapida sin CardCode)"
        },
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
        {
          col: "scope_values_json",
          type: "json_array",
          desc: "provincias o vendor keys si scope != all"
        },
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
        {
          col: "disponible_venta_whs11",
          type: "int",
          desc: "v369+ Mercaderia NUR PESCA (venta directa)"
        },
        { col: "transito_whs12", type: "int", desc: "v369+ En transito PESCA (backorder futuro)" },
        {
          col: "otros_warehouses_json",
          type: "json_object",
          desc: 'otros codigos con cantidad, ej {"98": 5}'
        },
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
    return lines.map(
      (l, idx) => header.concat([
        idx,
        l ? l.code : null,
        l ? l.desc : null,
        l ? l.qty : null,
        l ? l.precio : null,
        l ? l.cat : null,
        l ? l.fam : null,
        l ? l.sub : null
      ])
    );
  }
  function buildVisitaRows(doc) {
    return [
      [
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
      ]
    ];
  }
  function buildClienteRows(doc) {
    return [
      [
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
      ]
    ];
  }
  function buildClientMasterRows(doc) {
    return [
      [
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
      ]
    ];
  }
  function buildRendicionRows(doc) {
    return [
      [
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
      ]
    ];
  }
  function buildCampaniaRows(doc) {
    return [
      [
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
      ]
    ];
  }
  function buildTargetRows(doc) {
    return [
      [
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
      ]
    ];
  }
  function buildVendorOverrideRows(doc) {
    return [
      [
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
      ]
    ];
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
    return stops.map(
      (s) => header.concat([
        s ? s.order : null,
        s ? s.key : null,
        s ? s.tipo : null,
        s ? s.provincia : null,
        s ? s.localidad : null,
        s ? s.clientName : null,
        s ? s.isProvisorio : null,
        s ? s.sapAltaId : null
      ])
    );
  }
  function buildSeguimientoNoteRows(doc) {
    return [
      [
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
      ]
    ];
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
    return String(s || "").replace(/[\\/*?[\]:|"<>]/g, "_").replace(/\s+/g, " ").trim().slice(0, 60);
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
      if (!confirm(
        "Hay " + n + " visitas. El Excel con todas las fotos embebidas puede pesar 50-150 MB y tardar varios minutos. \xBFContinuar?"
      ))
        return;
    } else if (n > 100) {
      if (!confirm(
        "Vas a generar un Excel con " + n + " visitas y sus fotos embebidas. Puede tardar 30-60 segundos. \xBFContinuar?"
      ))
        return;
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
      const blob = new Blob([buffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      });
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
    ws["!cols"] = [
      { wch: 20 },
      { wch: 30 },
      { wch: 30 },
      { wch: 10 },
      { wch: 24 },
      { wch: 20 },
      { wch: 14 },
      { wch: 40 },
      { wch: 60 }
    ];
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
    rows.sort(
      (a, b) => a.Vendedor.localeCompare(b.Vendedor) || a.Provincia.localeCompare(b.Provincia) || a.Cliente.localeCompare(b.Cliente)
    );
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
      if (!perVendor[k])
        perVendor[k] = {
          zona: r.zona,
          unid: 0,
          ars: 0,
          usd: 0,
          clientes: /* @__PURE__ */ new Set(),
          prods: /* @__PURE__ */ new Set(),
          provs: /* @__PURE__ */ new Set()
        };
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
      const d = perVendor[titleV] || {
        zona: v.zone,
        unid: 0,
        ars: 0,
        usd: 0,
        clientes: /* @__PURE__ */ new Set(),
        prods: /* @__PURE__ */ new Set(),
        provs: /* @__PURE__ */ new Set()
      };
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
    wsC["!cols"] = [
      { wch: 6 },
      { wch: 24 },
      { wch: 11 },
      { wch: 14 },
      { wch: 16 },
      { wch: 11 },
      { wch: 16 },
      { wch: 16 },
      { wch: 18 },
      { wch: 20 },
      { wch: 18 }
    ];
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
      vrows.sort(
        (a, b) => (a.Fecha || "").localeCompare(b.Fecha || "") || a.Cliente.localeCompare(b.Cliente)
      );
      if (!vrows.length)
        vrows.push({
          Fecha: "",
          Mes: "",
          Provincia: "",
          Localidad: "",
          Cliente: "(sin pedidos confirmados)",
          Tipo: "",
          Codigo: "",
          Producto: "",
          Categoria: "",
          Familia: "",
          Subfamilia: "",
          Cantidad: 0,
          "Precio ARS": 0,
          "Subtotal ARS": 0,
          "Subtotal USD": 0
        });
      const ws = XLSX.utils.json_to_sheet(vrows);
      ws["!cols"] = [
        { wch: 11 },
        { wch: 14 },
        { wch: 18 },
        { wch: 22 },
        { wch: 30 },
        { wch: 11 },
        { wch: 14 },
        { wch: 38 },
        { wch: 14 },
        { wch: 18 },
        { wch: 18 },
        { wch: 10 },
        { wch: 12 },
        { wch: 14 },
        { wch: 14 }
      ];
      XLSX.utils.book_append_sheet(
        wb,
        ws,
        (v.zone + " " + titleV).substring(0, 31).replace(/[\\/*?[\]:]/g, "")
      );
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
      alert(
        "No hay visitas registradas todavia. Cuando se cargue al menos una, vas a poder exportarla."
      );
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
      if (!perVendor[k])
        perVendor[k] = {
          visitas: 0,
          tiendas: /* @__PURE__ */ new Set(),
          localidades: /* @__PURE__ */ new Set(),
          provincias: /* @__PURE__ */ new Set()
        };
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
    const wsF = XLSX.utils.json_to_sheet(
      factRows.map((r) => ({
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
      }))
    );
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
    const dimP = PRODUCTS.map((p) => ({
      sku: p.code,
      descripcion: p.desc,
      categoria: p.cat,
      familia: p.fam,
      subfamilia: p.sub
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(dimP), "Dim_Producto");
    const dimC = [];
    POINTS.forEach((p) => {
      const vm = vendorLookup[p.vendor];
      p.clients.forEach((n) => {
        dimC.push({
          cliente: n,
          tipo: "Cliente actual",
          provincia: titleCase(p.province),
          localidad: p.name,
          departamento: p.dept || "",
          vendedor_key: p.vendor || "",
          zona: vm ? vm.zone : ""
        });
      });
      p.prospects.forEach((n) => {
        dimC.push({
          cliente: n,
          tipo: "Prospecto",
          provincia: titleCase(p.province),
          localidad: p.name,
          departamento: p.dept || "",
          vendedor_key: p.vendor || "",
          zona: vm ? vm.zone : ""
        });
      });
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(dimC), "Dim_Cliente");
    const calSet = /* @__PURE__ */ new Set();
    factRows.forEach((r) => {
      if (r.fecha) calSet.add(r.fecha);
    });
    const start = /* @__PURE__ */ new Date("2026-01-01");
    const end = /* @__PURE__ */ new Date();
    end.setDate(end.getDate() + 365);
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1))
      calSet.add(d.toISOString().slice(0, 10));
    const dimCal = [...calSet].sort().map((dt) => {
      const [y, m, da] = dt.split("-").map((x) => parseInt(x, 10));
      const dateObj = new Date(y, m - 1, da);
      return {
        fecha: dt,
        year: y,
        month: m,
        day: da,
        quarter: "Q" + (Math.floor((m - 1) / 3) + 1),
        month_name: MESES[m - 1],
        year_month: y + "-" + String(m).padStart(2, "0"),
        day_of_week: ["Dom", "Lun", "Mar", "Mie", "Jue", "Vie", "Sab"][dateObj.getDay()]
      };
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(dimCal), "Dim_Calendario");
    const dimCmp = campaignsCache.map((c) => ({
      campania_id: c.id,
      nombre: c.name,
      filter_type: c.filterType,
      filter_values: (c.filterValues || []).join(", "),
      target_type: c.targetType,
      target_amount: c.targetAmount,
      desde: c.startDate,
      hasta: c.endDate
    }));
    if (dimCmp.length)
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(dimCmp), "Dim_Campania");
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet([
        { parametro: "exchange_rate_ars_usd", valor: EXCHANGE_RATE },
        { parametro: "fecha_export", valor: todayStr() },
        { parametro: "total_filas_fact", valor: factRows.length }
      ]),
      "Parametros"
    );
    const visitRowsB = buildVisitRows();
    if (visitRowsB.length)
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(visitRowsB), "Fact_Visitas");
    const contactRowsB = buildContactadosRows();
    if (contactRowsB.length)
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(contactRowsB), "Contactados");
    const opsRowsB = buildOpsLogRows();
    if (opsRowsB.length)
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(opsRowsB), "Log_Operaciones");
    XLSX.writeFile(wb, "Shimano_PowerBI_" + todayStr() + ".xlsx");
  };
  window.exportML = function() {
    const wb = XLSX.utils.book_new();
    const rows = buildPedidoDetailRows();
    const ws = XLSX.utils.json_to_sheet(rows);
    ws["!cols"] = Object.keys(rows[0] || { fecha: "" }).map(() => ({ wch: 14 }));
    XLSX.utils.book_append_sheet(wb, ws, "master_ml");
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        PRODUCTS.map((p) => ({ code: p.code, desc: p.desc, cat: p.cat, fam: p.fam, sub: p.sub }))
      ),
      "productos_catalogo"
    );
    const universe = [];
    POINTS.forEach((p) => {
      const vm = vendorLookup[p.vendor];
      p.clients.forEach((n) => {
        universe.push({
          cliente: n,
          tipo: "cliente_actual",
          provincia: titleCase(p.province),
          localidad: p.name,
          departamento: p.dept || "",
          vendedor: titleCase(p.vendor || ""),
          zona: vm ? vm.zone : "",
          lat: p.lat,
          lon: p.lon
        });
      });
      p.prospects.forEach((n) => {
        universe.push({
          cliente: n,
          tipo: "prospecto",
          provincia: titleCase(p.province),
          localidad: p.name,
          departamento: p.dept || "",
          vendedor: titleCase(p.vendor || ""),
          zona: vm ? vm.zone : "",
          lat: p.lat,
          lon: p.lon
        });
      });
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(universe), "universo_clientes");
    const targetsLong = [];
    Object.entries(TARGETS_BY_VENDOR).forEach(([vendor, t]) => {
      targetsLong.push({
        vendedor: displayVendorName(vendor),
        periodo: "Jul 2026",
        start_date: "2026-07-01",
        end_date: "2026-07-31",
        target_usd: t.jul2026_usd || 0
      });
      targetsLong.push({
        vendedor: displayVendorName(vendor),
        periodo: "Jul-Dic 2026",
        start_date: "2026-07-01",
        end_date: "2026-12-31",
        target_usd: t.julDic2026_usd || 0
      });
      targetsLong.push({
        vendedor: displayVendorName(vendor),
        periodo: "2027",
        start_date: "2027-01-01",
        end_date: "2027-12-31",
        target_usd: t.anual2027_usd || 0
      });
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(targetsLong), "targets_long");
    if (campaignsCache.length) {
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.json_to_sheet(
          campaignsCache.map((c) => ({
            id: c.id,
            nombre: c.name,
            filter_type: c.filterType,
            filter_values: (c.filterValues || []).join(","),
            target_type: c.targetType,
            target_amount: c.targetAmount,
            start_date: c.startDate,
            end_date: c.endDate
          }))
        ),
        "campanias"
      );
    }
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet([
        { parametro: "exchange_rate_ars_usd", valor: EXCHANGE_RATE },
        { parametro: "fecha_export", valor: (/* @__PURE__ */ new Date()).toISOString() }
      ]),
      "parametros"
    );
    const visitRowsC = buildVisitRows();
    if (visitRowsC.length)
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(visitRowsC), "visitas");
    const contactRowsC = buildContactadosRows();
    if (contactRowsC.length)
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(contactRowsC), "contactados");
    const opsRowsC = buildOpsLogRows();
    if (opsRowsC.length)
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(opsRowsC), "log_operaciones");
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
        if (r.status === "rejected")
          failedFirestore.push(
            firestoreEntries[i][0] + ": " + (r.reason && r.reason.message || r.reason)
          );
      });
      if (failedFirestore.length) {
        throw new Error(
          "Firestore fetch fallo en " + failedFirestore.length + " colecciones:\n" + failedFirestore.join("\n")
        );
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
          {
            priority: uc.priority,
            description: uc.description,
            requiredFields: uc.requiredFields,
            joinNotes: uc.joinNotes,
            nullRateByField: {},
            limitations: []
          }
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
          stats.limitations.push(
            "Alguna coleccion requerida esta vacia \u2014 el caso no se puede entrenar hoy pero el schema esta listo."
          );
        } else if (hasHighNullRate) {
          stats.status = "PARTIAL";
          stats.limitations.push(
            "Al menos 1 campo requerido tiene >50% de nulls \u2014 revisar tasas antes de usar."
          );
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
          excludedCollections: [
            "roles",
            "app_config",
            "sap_snapshot",
            "notifications",
            "operations_log"
          ],
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
      for (const [_collName, schema] of Object.entries(DATASET_SCHEMAS)) {
        manifest.schema[schema.name] = schema.columns.map((c) => ({
          col: c.col,
          type: c.type,
          desc: c.desc
        }));
      }
      _updateExportProgress("Empaquetando ZIP...", 90);
      const zip = new JSZip();
      for (const [name, content] of Object.entries(csvs)) {
        zip.file(name, content);
      }
      zip.file("manifest.json", JSON.stringify(manifest, null, 2));
      const blob = await zip.generateAsync({
        type: "blob",
        compression: "DEFLATE",
        compressionOptions: { level: 6 }
      });
      const filename = "shimano-dataset-" + exportedAt.replace(/[:.]/g, "-") + ".zip";
      _downloadBlob(blob, filename);
      _updateExportProgress(
        "Dataset descargado: " + filename + " (" + Object.keys(csvs).length + " CSVs + manifest.json)",
        100
      );
      if (typeof showSyncTag === "function") {
        const totalRows = Object.values(rowCounts).reduce((a, b) => a + b, 0);
        showSyncTag(
          "Dataset exportado: " + totalRows + " filas en " + Object.keys(csvs).length + " CSVs"
        );
      }
      setTimeout(() => window.closeExportFormatModal(), 3e3);
    } catch (e) {
      console.error("[exportDatasetZip] fatal:", e);
      _updateExportProgress("Error: " + (e && e.message || e), 0);
      alert(
        "Error al exportar el dataset:\n\n" + (e && e.message || e) + "\n\nEl ZIP NO se descargo (evitamos generar un archivo parcial). Revisa la consola para mas detalles."
      );
    }
  };
  if (typeof window.todayStr === "undefined") window.todayStr = todayStr;
  if (typeof window.dataUrlToBlob === "undefined") window.dataUrlToBlob = dataUrlToBlob;
  if (typeof window.sanitizeForPath === "undefined") window.sanitizeForPath = sanitizeForPath;
  window.loadExcelJS = loadExcelJS;
})();
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL3B1cmUvY3N2LXNlcmlhbGl6ZXIuanMiLCAiLi4vc3JjL2RvbWFpbnMvZXhwb3J0cy1hZHZhbmNlZC5qcyJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiLy8gQHRzLWNoZWNrXG4vKipcbiAqIENTViBzZXJpYWxpemVyICsgZGF0YXNldCBzY2hlbWFzICsgcm93IGJ1aWxkZXJzIFx1MjAxNCBwYXJhIGV4cG9ydERhdGFzZXRaaXBcbiAqICh2MzcxKykuIEZ1bmNpb25lcyBwdXJhcywgdGVzdGVhYmxlcyBzaW4gZ2xvYmFscyBkZWwgYnVuZGxlLlxuICpcbiAqIDUgY2Fzb3MgZGUgdXNvIE1MIGRvY3VtZW50YWRvcyBlbiBEQVRBU0VUX1VTRV9DQVNFX01BVFJJWDpcbiAqICAgQSkgQ29udmVyc2lvbiB2aXNpdGEtPnBlZGlkbyAocHJpb3JpZGFkIDEsIGNsYXNpZmljYWNpb24pXG4gKiAgIEIpIFJpZXNnbyBkZSBjaHVybiBkZSBjbGllbnRlcyAocHJpb3JpZGFkIDIsIGFsZXJ0YSlcbiAqICAgQykgRm9yZWNhc3QgZGUgZGVtYW5kYSBwb3IgU0tVIChwcmlvcmlkYWQgMywgc2VyaWVzIHRlbXBvcmFsZXMpXG4gKiAgIEQpIEFub21hbGlhcyBlbiByZW5kaWNpb25lcyAoZXhwbG9yYXRvcmlvKVxuICogICBFKSBFc3RhY2lvbmFsaWRhZCBwb3Igem9uYS9jYW1wYW5hIChleHBsb3JhdG9yaW8pXG4gKlxuICogQ29udmVuY2lvbmVzIChSRkMgNDE4MCArIGFkYXB0YWNpb25lcyBwYXJhIE1MIHBpcGVsaW5lcyk6XG4gKiAgIC0gU2VwYXJhdG9yOiBcIixcIlxuICogICAtIFF1b3RlIGNoYXI6IFwiXFxcIlwiXG4gKiAgIC0gRXNjYXBlIHF1b3RlOiBcIlxcXCJcXFwiXCJcbiAqICAgLSBMaW5lIHRlcm1pbmF0b3I6IFwiXFxyXFxuXCJcbiAqICAgLSBFbmNvZGluZzogVVRGLTggKEJPTSBvcGNpb25hbCBhbCBlc2NyaWJpciBlbCBaSVApXG4gKiAgIC0gRmVjaGFzOiBJU08gODYwMSBVVEMgKGNvbiBcIlpcIiBhbCBmaW5hbClcbiAqICAgLSBEZWNpbWFsZXM6IHB1bnRvIChcIi5cIilcbiAqICAgLSBOdWxsL3VuZGVmaW5lZDogY2FtcG8gdmFjaW8gKE5PIFwiTi9BXCIsIFwiLVwiLCBcIm51bGxcIilcbiAqICAgLSBBcnJheXMgLT4gSlNPTi5zdHJpbmdpZnkgZW50cmUgY29taWxsYXMgZG9ibGVzXG4gKiAgIC0gT2JqZXRvcyAoZXhjZXB0byBUaW1lc3RhbXAgeSBEYXRlKSAtPiBKU09OLnN0cmluZ2lmeVxuICogICAtIEZpcmVzdG9yZSBUaW1lc3RhbXBzIC0+IHRvRGF0ZSgpLnRvSVNPU3RyaW5nKClcbiAqL1xuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIEhlbHBlcnMgQ1NWIHB1cm9zXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuLyoqXG4gKiBFc2NhcGEgdW4gdmFsb3Igc3RyaW5nIHBhcmEgQ1NWIFJGQyA0MTgwLiBXcmFwcGVhIGNvbiBcIi4uLlwiIHNpIGNvbnRpZW5lXG4gKiBcIixcIiwgXCJcXFwiXCIsIFwiXFxyXCIgbyBcIlxcblwiLiBFc2NhcGEgXCJcXFwiXCIgLT4gXCJcXFwiXFxcIlwiLlxuICogQHBhcmFtIHtzdHJpbmd9IHNcbiAqIEByZXR1cm5zIHtzdHJpbmd9XG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjc3ZFc2NhcGUocykge1xuICBpZiAocyA9PT0gbnVsbCB8fCBzID09PSB1bmRlZmluZWQpIHJldHVybiAnJztcbiAgY29uc3Qgc3RyID0gU3RyaW5nKHMpO1xuICBpZiAoc3RyID09PSAnJykgcmV0dXJuICcnO1xuICAvLyBOZWNlc2l0YSBxdW90aW5nIHNpIHRpZW5lIGNvbWEsIHF1b3RlLCBvIGxpbmUtYnJlYWtcbiAgaWYgKC9bXCIsXFxyXFxuXS8udGVzdChzdHIpKSB7XG4gICAgcmV0dXJuICdcIicgKyBzdHIucmVwbGFjZSgvXCIvZywgJ1wiXCInKSArICdcIic7XG4gIH1cbiAgcmV0dXJuIHN0cjtcbn1cblxuLyoqXG4gKiBDb252aWVydGUgdW4gYXJyYXkgZGUgdmFsb3JlcyBlbiB1bmEgbGluZWEgQ1NWIChzaW4gdHJhaWxpbmcgbmV3bGluZSkuXG4gKiBBcGxpY2EgY3N2RXNjYXBlIGEgY2FkYSBjYW1wbyBkZXNwdWVzIGRlIGZpcmVzdG9yZVZhbHVlVG9Dc3YuXG4gKiBAcGFyYW0ge3Vua25vd25bXX0gZmllbGRzXG4gKiBAcmV0dXJucyB7c3RyaW5nfVxuICovXG5leHBvcnQgZnVuY3Rpb24gY3N2Um93KGZpZWxkcykge1xuICByZXR1cm4gZmllbGRzLm1hcCgoZikgPT4gY3N2RXNjYXBlKGZpcmVzdG9yZVZhbHVlVG9Dc3YoZikpKS5qb2luKCcsJyk7XG59XG5cbi8qKlxuICogQ29udmllcnRlIHVuIHZhbG9yIGRlIEZpcmVzdG9yZS9KUyBhIHN0cmluZyBhcHRvIHBhcmEgQ1NWLlxuICogUmVnbGEgcG9yIHRpcG86XG4gKiAgIC0gbnVsbCAvIHVuZGVmaW5lZCAtPiAnJ1xuICogICAtIEZpcmVzdG9yZSBUaW1lc3RhbXAgKHRpZW5lIC50b0RhdGUpIC0+IElTTyA4NjAxIFVUQ1xuICogICAtIERhdGUgLT4gSVNPIDg2MDEgVVRDXG4gKiAgIC0gYm9vbGVhbiAtPiAndHJ1ZScgLyAnZmFsc2UnXG4gKiAgIC0gbnVtYmVyIC0+IFN0cmluZyhuKSBjb24gcHVudG8gZGVjaW1hbFxuICogICAtIHN0cmluZyAtPiB0YWwgY3VhbCAoY3N2RXNjYXBlIHdyYXBwZWEgc2kgaGFjZSBmYWx0YSlcbiAqICAgLSBBcnJheSAtPiBKU09OLnN0cmluZ2lmeVxuICogICAtIE9iamVjdCAtPiBKU09OLnN0cmluZ2lmeVxuICogQHBhcmFtIHt1bmtub3dufSB2XG4gKiBAcmV0dXJucyB7c3RyaW5nfVxuICovXG5leHBvcnQgZnVuY3Rpb24gZmlyZXN0b3JlVmFsdWVUb0Nzdih2KSB7XG4gIGlmICh2ID09PSBudWxsIHx8IHYgPT09IHVuZGVmaW5lZCkgcmV0dXJuICcnO1xuICBpZiAodHlwZW9mIHYgPT09ICdzdHJpbmcnKSByZXR1cm4gdjtcbiAgaWYgKHR5cGVvZiB2ID09PSAnbnVtYmVyJykge1xuICAgIGlmICghTnVtYmVyLmlzRmluaXRlKHYpKSByZXR1cm4gJyc7IC8vIE5hTiwgSW5maW5pdHkgLT4gdmFjaW8gKG5vIGNvbmZ1bmRpciBwaXBlbGluZXMpXG4gICAgcmV0dXJuIFN0cmluZyh2KTtcbiAgfVxuICBpZiAodHlwZW9mIHYgPT09ICdib29sZWFuJykgcmV0dXJuIHYgPyAndHJ1ZScgOiAnZmFsc2UnO1xuICAvLyBGaXJlc3RvcmUgVGltZXN0YW1wXG4gIGlmIChcbiAgICB0eXBlb2YgdiA9PT0gJ29iamVjdCcgJiZcbiAgICB2ICE9PSBudWxsICYmXG4gICAgdHlwZW9mICgvKiogQHR5cGUge2FueX0gKi8gKHYpLnRvRGF0ZSkgPT09ICdmdW5jdGlvbidcbiAgKSB7XG4gICAgdHJ5IHtcbiAgICAgIHJldHVybiAvKiogQHR5cGUge2FueX0gKi8gKHYpLnRvRGF0ZSgpLnRvSVNPU3RyaW5nKCk7XG4gICAgfSBjYXRjaCAoXykge1xuICAgICAgcmV0dXJuICcnO1xuICAgIH1cbiAgfVxuICBpZiAodiBpbnN0YW5jZW9mIERhdGUpIHtcbiAgICBpZiAoTnVtYmVyLmlzTmFOKHYuZ2V0VGltZSgpKSkgcmV0dXJuICcnO1xuICAgIHJldHVybiB2LnRvSVNPU3RyaW5nKCk7XG4gIH1cbiAgaWYgKEFycmF5LmlzQXJyYXkodikpIHtcbiAgICAvLyBKU09OLnN0cmluZ2lmeSBkZSBhcnJheS4gY3N2RXNjYXBlIGx1ZWdvIGxvIHdyYXBwZWEgc2kgaGF5IGNvbWFzLlxuICAgIHRyeSB7XG4gICAgICByZXR1cm4gSlNPTi5zdHJpbmdpZnkodik7XG4gICAgfSBjYXRjaCAoXykge1xuICAgICAgcmV0dXJuICcnO1xuICAgIH1cbiAgfVxuICBpZiAodHlwZW9mIHYgPT09ICdvYmplY3QnKSB7XG4gICAgdHJ5IHtcbiAgICAgIHJldHVybiBKU09OLnN0cmluZ2lmeSh2KTtcbiAgICB9IGNhdGNoIChfKSB7XG4gICAgICByZXR1cm4gJyc7XG4gICAgfVxuICB9XG4gIHJldHVybiBTdHJpbmcodik7XG59XG5cbi8qKlxuICogT2J0aWVuZSBlbCB2YWxvciBkZSB1biBwYXRoIGRvdC1ub3RhdGlvbiBlbiB1biBvYmpldG8gYW5pZGFkby5cbiAqIEVqOiBnZXRQYXRoKHthOiB7Yjoge2M6IDF9fX0sICdhLmIuYycpIC0+IDFcbiAqIGdldFBhdGgoe30sICdhLmInKSAtPiB1bmRlZmluZWRcbiAqIEBwYXJhbSB7b2JqZWN0fSBvYmpcbiAqIEBwYXJhbSB7c3RyaW5nfSBwYXRoXG4gKiBAcmV0dXJucyB7dW5rbm93bn1cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGdldFBhdGgob2JqLCBwYXRoKSB7XG4gIGlmICghb2JqIHx8ICFwYXRoKSByZXR1cm4gdW5kZWZpbmVkO1xuICBjb25zdCBwYXJ0cyA9IHBhdGguc3BsaXQoJy4nKTtcbiAgbGV0IGN1ciA9IC8qKiBAdHlwZSB7YW55fSAqLyAob2JqKTtcbiAgZm9yIChjb25zdCBwIG9mIHBhcnRzKSB7XG4gICAgaWYgKGN1ciA9PT0gbnVsbCB8fCBjdXIgPT09IHVuZGVmaW5lZCkgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICBjdXIgPSBjdXJbcF07XG4gIH1cbiAgcmV0dXJuIGN1cjtcbn1cblxuLyoqXG4gKiBDb25zdHJ1eWUgZWwgQ1NWIGNvbXBsZXRvIChoZWFkZXIgKyBOIHJvd3MpIHBhcmEgdW5hIGNvbGVjY2lvbiBzZWd1blxuICogc3Ugc2NoZW1hLiBDYWRhIGJ1aWxkZXIgZGV2dWVsdmUgdW4gYXJyYXkgZGUgZmlsYXMgKGNhZGEgZmlsYSA9IGFycmF5XG4gKiBkZSB2YWxvcmVzIGVuIGVsIG9yZGVuIGRlbCBzY2hlbWEpLlxuICogQHBhcmFtIHt7Y29sdW1uczoge2NvbDogc3RyaW5nfVtdfX0gc2NoZW1hXG4gKiBAcGFyYW0ge3Vua25vd25bXVtdfSByb3dzXG4gKiBAcmV0dXJucyB7c3RyaW5nfSBDU1YgY29tcGxldG8gY29uIFxcclxcbiBjb21vIGxpbmUgc2VwYXJhdG9yXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBidWlsZENzdihzY2hlbWEsIHJvd3MpIHtcbiAgY29uc3QgaGVhZGVyID0gc2NoZW1hLmNvbHVtbnMubWFwKChjKSA9PiBjc3ZFc2NhcGUoYy5jb2wpKS5qb2luKCcsJyk7XG4gIGNvbnN0IGJvZHkgPSByb3dzLm1hcCgocikgPT4gY3N2Um93KHIpKS5qb2luKCdcXHJcXG4nKTtcbiAgcmV0dXJuIGJvZHkubGVuZ3RoID8gaGVhZGVyICsgJ1xcclxcbicgKyBib2R5ICsgJ1xcclxcbicgOiBoZWFkZXIgKyAnXFxyXFxuJztcbn1cblxuLyoqXG4gKiBDdWVudGEgbnVsbCByYXRlIHBvciBjb2x1bW5hIHJlcXVlcmlkYS4gUmV0b3JuYVxuICoge2NvbE5hbWU6IHJhdGUgMC4uMX0uIFVuIHZhbG9yIGVzIFwibnVsbFwiIHNpIGZpcmVzdG9yZVZhbHVlVG9Dc3YgZGV2dWVsdmUgJycuXG4gKiBAcGFyYW0ge3tjb2x1bW5zOiB7Y29sOiBzdHJpbmd9W119fSBzY2hlbWFcbiAqIEBwYXJhbSB7dW5rbm93bltdW119IHJvd3NcbiAqIEBwYXJhbSB7c3RyaW5nW119IHJlcXVpcmVkQ29sc1xuICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIG51bWJlcj59XG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjb21wdXRlTnVsbFJhdGVzKHNjaGVtYSwgcm93cywgcmVxdWlyZWRDb2xzKSB7XG4gIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgbnVtYmVyPn0gKi9cbiAgY29uc3QgcmVzdWx0ID0ge307XG4gIGlmICghcm93cy5sZW5ndGgpIHtcbiAgICAvLyBzaW4gZGF0b3M6IG51bGwgcmF0ZSA9IDEgKDEwMCUgZmFsdGEpIHBhcmEgY2FkYSBjYW1wbyByZXF1ZXJpZG9cbiAgICBmb3IgKGNvbnN0IGMgb2YgcmVxdWlyZWRDb2xzKSByZXN1bHRbY10gPSAxO1xuICAgIHJldHVybiByZXN1bHQ7XG4gIH1cbiAgY29uc3QgY29sSW5kZXggPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIG51bWJlcj59ICovICh7fSk7XG4gIHNjaGVtYS5jb2x1bW5zLmZvckVhY2goKGMsIGkpID0+IHtcbiAgICBjb2xJbmRleFtjLmNvbF0gPSBpO1xuICB9KTtcbiAgZm9yIChjb25zdCByYyBvZiByZXF1aXJlZENvbHMpIHtcbiAgICBjb25zdCBpZHggPSBjb2xJbmRleFtyY107XG4gICAgaWYgKGlkeCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICByZXN1bHRbcmNdID0gMTsgLy8gY29sdW1uYSBubyBleGlzdGUgZW4gc2NoZW1hIC0+IGNvbnNpZGVyYXIgY29tbyAxMDAlIG51bGxcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBsZXQgbnVsbHMgPSAwO1xuICAgIGZvciAoY29uc3Qgcm93IG9mIHJvd3MpIHtcbiAgICAgIGNvbnN0IHYgPSByb3dbaWR4XTtcbiAgICAgIGlmIChmaXJlc3RvcmVWYWx1ZVRvQ3N2KHYpID09PSAnJykgbnVsbHMrKztcbiAgICB9XG4gICAgcmVzdWx0W3JjXSA9IE1hdGgucm91bmQoKG51bGxzIC8gcm93cy5sZW5ndGgpICogMTAwMDApIC8gMTAwMDA7XG4gIH1cbiAgcmV0dXJuIHJlc3VsdDtcbn1cblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBEQVRBU0VUX1NDSEVNQVMgXHUyMDE0IDExIGNvbGVjY2lvbmVzIGNvbiBjb2x1bW5hcyArIHRpcG9zICsgZGVzY3JpcGNpb25lc1xuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbi8qKiBAdHlwZWRlZiB7e2NvbDogc3RyaW5nLCB0eXBlOiBzdHJpbmcsIGRlc2M6IHN0cmluZ319IFNjaGVtYUNvbHVtbiAqL1xuLyoqIEB0eXBlZGVmIHt7bmFtZTogc3RyaW5nLCBzb3VyY2U6ICdmaXJlc3RvcmUnfCdzdG9ja19qc29uJywgY29sbGVjdGlvbj86IHN0cmluZywgcm93TW9kZTogc3RyaW5nLCBjb2x1bW5zOiBTY2hlbWFDb2x1bW5bXX19IERhdGFzZXRTY2hlbWEgKi9cblxuLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBEYXRhc2V0U2NoZW1hPn0gKi9cbmV4cG9ydCBjb25zdCBEQVRBU0VUX1NDSEVNQVMgPSB7XG4gIHBlZGlkb3M6IHtcbiAgICBuYW1lOiAncGVkaWRvcy5jc3YnLFxuICAgIHNvdXJjZTogJ2ZpcmVzdG9yZScsXG4gICAgY29sbGVjdGlvbjogJ3BlZGlkb3MnLFxuICAgIHJvd01vZGU6ICdmbGF0dGVuX2xpbmVzJywgLy8gMSBmaWxhIHBvciAocGVkaWRvLCBsaW5lYSlcbiAgICBjb2x1bW5zOiBbXG4gICAgICB7IGNvbDogJ3BlZGlkb19pZCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnRmlyZXN0b3JlIGRvYyBJRCcgfSxcbiAgICAgIHsgY29sOiAnb3duZXJfdWlkJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdVSUQgZGVsIHZlbmRlZG9yIGR1ZW5pbyBkZWwgcGVkaWRvJyB9LFxuICAgICAgeyBjb2w6ICdvd25lcl9lbWFpbCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnZW1haWwgZGVsIHZlbmRlZG9yJyB9LFxuICAgICAgeyBjb2w6ICdjcmVhdGVkX2J5X3VpZCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAncXVpZW4gY2FyZ28gKFZESSBwdWVkZSBjYXJnYXIgcG9yIFZERSknIH0sXG4gICAgICB7IGNvbDogJ29uX2JlaGFsZl9vZicsIHR5cGU6ICdib29sZWFuJywgZGVzYzogJ3RydWUgc2kgVkRJIGNhcmdvIHBvciBWREUnIH0sXG4gICAgICB7IGNvbDogJ2tleScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnY2xhdmUgY29tcHVlc3RhIHRpcG98cHJvdnxsb2N8Y2xpZW50ZScgfSxcbiAgICAgIHsgY29sOiAnc3RhZ2UnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ3BlbmRpbmcgfCBjb25maXJtZWQgfCBzYXBfaW1wb3J0ZWQnIH0sXG4gICAgICB7IGNvbDogJ3RpcG8nLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ0M9Y2xpZW50ZSB8IFA9cHJvc3BlY3RvJyB9LFxuICAgICAgeyBjb2w6ICdwcm92aW5jZScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAncHJvdmluY2lhJyB9LFxuICAgICAgeyBjb2w6ICdsb2NfbmFtZScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnbG9jYWxpZGFkJyB9LFxuICAgICAgeyBjb2w6ICdjbGllbnRfbmFtZScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnbm9tYnJlIGNsaWVudGUnIH0sXG4gICAgICB7IGNvbDogJ21vbnRoJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdlaiBcIkp1bGlvIDIwMjZcIicgfSxcbiAgICAgIHsgY29sOiAnbW9udGhfaWR4JywgdHlwZTogJ2ludCcsIGRlc2M6ICcwLTExJyB9LFxuICAgICAgeyBjb2w6ICd5ZWFyJywgdHlwZTogJ2ludCcsIGRlc2M6ICdhbm8nIH0sXG4gICAgICB7IGNvbDogJ2NvbmZpcm1lZF9hdCcsIHR5cGU6ICdpc284NjAxJywgZGVzYzogJ3RpbWVzdGFtcCBVVEMgZGUgY29uZmlybWFjaW9uJyB9LFxuICAgICAgeyBjb2w6ICdjb25kaWNpb25fcGFnbycsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnZWogQ1RBIENURScgfSxcbiAgICAgIHsgY29sOiAnZm9ybWFfZW50cmVnYV90aXBvJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdUUkFOU1BPUlRJU1RBIHwgU1VDVVJTQUwnIH0sXG4gICAgICB7IGNvbDogJ2Zvcm1hX2VudHJlZ2FfdHJhbnNwX25vbWJyZScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJyB9LFxuICAgICAgeyBjb2w6ICdmb3JtYV9lbnRyZWdhX3RyYW5zcF9kaXJlY2Npb24nLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcbiAgICAgIHsgY29sOiAnZm9ybWFfZW50cmVnYV9jbGllbnRlX2RpcmVjY2lvbicsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnZGVzdGlubyBmaW5hbCcgfSxcbiAgICAgIHsgY29sOiAnZm9ybWFfZW50cmVnYV9zdWN1cnNhbF9kaXJlY2Npb24nLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcbiAgICAgIHtcbiAgICAgICAgY29sOiAnZGlzY291bnRfcGN0JyxcbiAgICAgICAgdHlwZTogJ251bWJlcicsXG4gICAgICAgIGRlc2M6ICdkZXNjdWVudG8gdG90YWwgZGVsIHBlZGlkbyAoYXBsaWNhZG8gYSBuaXZlbCBoZWFkZXIsIHByb3JyYXRlYXIgZW4gcGlwZWxpbmUpJyxcbiAgICAgIH0sXG4gICAgICB7IGNvbDogJ3N1YnRvdGFsX2FycycsIHR5cGU6ICdudW1iZXInLCBkZXNjOiAnc3VidG90YWwgYnJ1dG8gQVJTJyB9LFxuICAgICAgeyBjb2w6ICduZXRfYW1vdW50X2FycycsIHR5cGU6ICdudW1iZXInLCBkZXNjOiAnbmV0byBBUlMgcG9zdC1kZXNjdWVudG8nIH0sXG4gICAgICB7IGNvbDogJ3RyYW5zZmVyaWRvX3NhcF92aWEnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ2R0d19tYW51YWwgfCBzZXJ2aWNlX2xheWVyJyB9LFxuICAgICAgeyBjb2w6ICd0cmFuc2Zlcmlkb19zYXBfZG9jX251bScsIHR5cGU6ICdpbnQnLCBkZXNjOiAnbnVtZXJvIGRlIFF1b3RhdGlvbiBTQVAnIH0sXG4gICAgICB7IGNvbDogJ3RyYW5zZmVyaWRvX3NhcF9kb2NfZW50cnknLCB0eXBlOiAnaW50JywgZGVzYzogJ2RvYyBlbnRyeSBpbnRlcm5vIFNBUCcgfSxcbiAgICAgIHsgY29sOiAndHJhbnNmZXJpZG9fc2FwX2F0JywgdHlwZTogJ2lzbzg2MDEnLCBkZXNjOiAndGltZXN0YW1wIFVUQycgfSxcbiAgICAgIHsgY29sOiAnY3JlYXRlZF9hdCcsIHR5cGU6ICdpc284NjAxJywgZGVzYzogJ3RpbWVzdGFtcCBVVEMnIH0sXG4gICAgICB7IGNvbDogJ2xpbmVfaW5kZXgnLCB0eXBlOiAnaW50JywgZGVzYzogJ2luZGljZSBkZSBsaW5lYSAwLWJhc2VkJyB9LFxuICAgICAgeyBjb2w6ICdsaW5lX2NvZGUnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ1NLVScgfSxcbiAgICAgIHsgY29sOiAnbGluZV9kZXNjJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdkZXNjcmlwY2lvbiBwcm9kdWN0bycgfSxcbiAgICAgIHsgY29sOiAnbGluZV9xdHknLCB0eXBlOiAnbnVtYmVyJywgZGVzYzogJ2NhbnRpZGFkJyB9LFxuICAgICAgeyBjb2w6ICdsaW5lX3ByZWNpbycsIHR5cGU6ICdudW1iZXInLCBkZXNjOiAncHJlY2lvIHVuaXRhcmlvIEFSUycgfSxcbiAgICAgIHsgY29sOiAnbGluZV9jYXQnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ2NhdGVnb3JpYScgfSxcbiAgICAgIHsgY29sOiAnbGluZV9mYW0nLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ2ZhbWlsaWEnIH0sXG4gICAgICB7IGNvbDogJ2xpbmVfc3ViJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdzdWJmYW1pbGlhJyB9LFxuICAgIF0sXG4gIH0sXG4gIHZpc2l0YXM6IHtcbiAgICBuYW1lOiAndmlzaXRhcy5jc3YnLFxuICAgIHNvdXJjZTogJ2ZpcmVzdG9yZScsXG4gICAgY29sbGVjdGlvbjogJ3Zpc2l0cycsXG4gICAgcm93TW9kZTogJ29uZV9wZXJfZG9jJyxcbiAgICBjb2x1bW5zOiBbXG4gICAgICB7IGNvbDogJ3Zpc2l0X2lkJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdGaXJlc3RvcmUgZG9jIElEJyB9LFxuICAgICAgeyBjb2w6ICdvd25lcl91aWQnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ1VJRCBkZWwgdmVuZGVkb3InIH0sXG4gICAgICB7IGNvbDogJ293bmVyX2VtYWlsJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdlbWFpbCBkZWwgdmVuZGVkb3InIH0sXG4gICAgICB7IGNvbDogJ2ZlY2hhJywgdHlwZTogJ2lzbzg2MDEnLCBkZXNjOiAnWVlZWS1NTS1ERCAoZmVjaGEgZGUgdmlzaXRhLCBubyBVVEMpJyB9LFxuICAgICAgeyBjb2w6ICdtZXMnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ0pVTklPLCBKVUxJTywgZXRjLicgfSxcbiAgICAgIHsgY29sOiAnYW5pbycsIHR5cGU6ICdpbnQnLCBkZXNjOiAnYW5vJyB9LFxuICAgICAgeyBjb2w6ICd2ZW5kb3InLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ25vbWJyZSBjYW5vbmljbyB2ZW5kZWRvcicgfSxcbiAgICAgIHsgY29sOiAncHJvdmluY2lhJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdwcm92aW5jaWEnIH0sXG4gICAgICB7IGNvbDogJ2xvY2FsaWRhZCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnbG9jYWxpZGFkJyB9LFxuICAgICAgeyBjb2w6ICd0aWVuZGEnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ25vbWJyZSB0aWVuZGEnIH0sXG4gICAgICB7IGNvbDogJ3RpcG8nLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ0MgfCBQJyB9LFxuICAgICAgeyBjb2w6ICdsb2NhbCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnZWogUHJvcGlvLCBBbHF1aWxhZG8nIH0sXG4gICAgICB7IGNvbDogJ3RhbWFubycsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnZWogQ2hpY28sIE1lZGlhbm8sIEdyYW5kZScgfSxcbiAgICAgIHsgY29sOiAnZmlkZWxpZGFkJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdBbHRhLCBNZWRpYSwgQmFqYScgfSxcbiAgICAgIHsgY29sOiAncmVsZXZhbmNpYScsIHR5cGU6ICdpbnQnLCBkZXNjOiAnMC01JyB9LFxuICAgICAgeyBjb2w6ICdwb3AnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ2VqIFN0aWNrZXJzIFNoaW1hbm8nIH0sXG4gICAgICB7IGNvbDogJ25lY2VzaWRhZF9wdW50dWFsJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXG4gICAgICB7IGNvbDogJ3RpcG9fdmVudGEnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ2VqIENhc2EgZGUgcGVzY2EgKyBlY29tbWVyY2UnIH0sXG4gICAgICB7IGNvbDogJ3BvbmRlcmFjaW9uX21vc3RyYWRvJywgdHlwZTogJ2ludCcsIGRlc2M6ICcwLTEwMCcgfSxcbiAgICAgIHsgY29sOiAncG9uZGVyYWNpb25fZWNvbW1lcmNlJywgdHlwZTogJ2ludCcsIGRlc2M6ICcwLTEwMCcgfSxcbiAgICAgIHsgY29sOiAnY29tcGV0ZW5jaWEnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcbiAgICAgIHsgY29sOiAnb3BvcnR1bmlkYWQnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcbiAgICAgIHsgY29sOiAnbWFzX3ZlbmRpZG8nLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcbiAgICAgIHsgY29sOiAnbWFzX3ByZWd1bnRhbicsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJyB9LFxuICAgICAgeyBjb2w6ICdheXVkYV90aWVuZGEnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcbiAgICAgIHsgY29sOiAnZ3BzX3N0YXR1cycsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnb2sgfCBvdXRzaWRlIHwgbm9sb2MnIH0sXG4gICAgICB7IGNvbDogJ2dwc19kaXN0YW5jZV9tJywgdHlwZTogJ251bWJlcicsIGRlc2M6ICdtZXRyb3MnIH0sXG4gICAgICB7IGNvbDogJ2ludGVyYWN0aW9uX3R5cGUnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ3Zpc2l0YSB8IGNvbnRhY3RvJyB9LFxuICAgICAge1xuICAgICAgICBjb2w6ICdmb3JtYV9jb250YWN0bycsXG4gICAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgICBkZXNjOiAnTExBTUFEQSBURUxFRk9OSUNBIHwgTUVOU0FKRSBERSBXSEFUU0FQUCB8IE1FTlNBSkUgU01TIChzaSBjb250YWN0byknLFxuICAgICAgfSxcbiAgICAgIHtcbiAgICAgICAgY29sOiAnY29udGFjdG9fcmVzdWx0YWRvJyxcbiAgICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICAgIGRlc2M6ICdyZXNwb25kaW8gfCBub19yZXNwb25kaW8gfCB2YWNpbyAoc2luIG1hcmNhciwgc29sbyBhcGxpY2EgYSBjb250YWN0byknLFxuICAgICAgfSxcbiAgICAgIHsgY29sOiAnY29udGFjdG9fcmVzdWx0YWRvX2F0JywgdHlwZTogJ2lzbzg2MDEnLCBkZXNjOiAndGltZXN0YW1wIFVUQycgfSxcbiAgICAgIHsgY29sOiAnY29udGFjdG9fcmVzdWx0YWRvX2J5JywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdVSUQgZGUgcXVpZW4gbWFyY28nIH0sXG4gICAgICB7IGNvbDogJ2NyZWF0ZWRfYXQnLCB0eXBlOiAnaXNvODYwMScsIGRlc2M6ICd0aW1lc3RhbXAgVVRDJyB9LFxuICAgIF0sXG4gIH0sXG4gIGNsaWVudGVzOiB7XG4gICAgbmFtZTogJ2NsaWVudGVzLmNzdicsXG4gICAgc291cmNlOiAnZmlyZXN0b3JlJyxcbiAgICBjb2xsZWN0aW9uOiAnY2xpZW50X2FwcGxpY2F0aW9ucycsXG4gICAgcm93TW9kZTogJ29uZV9wZXJfZG9jJyxcbiAgICBjb2x1bW5zOiBbXG4gICAgICB7IGNvbDogJ2FwcF9pZCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnRmlyZXN0b3JlIGRvYyBJRCcgfSxcbiAgICAgIHsgY29sOiAnb3duZXJfdWlkJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXG4gICAgICB7IGNvbDogJ293bmVyX2VtYWlsJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXG4gICAgICB7IGNvbDogJ293bmVyX25hbWUnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcbiAgICAgIHsgY29sOiAnY29tZXJjaW8nLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ3Jhem9uIHNvY2lhbCcgfSxcbiAgICAgIHsgY29sOiAnZmFudGFzaWEnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ25vbWJyZSBjb21lcmNpYWwnIH0sXG4gICAgICB7IGNvbDogJ2N1aXQnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ3NvbG8gZGlnaXRvcyBwb3N0LXYyOTQnIH0sXG4gICAgICB7IGNvbDogJ2NvbmRpY2lvbl9maXNjYWwnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcbiAgICAgIHsgY29sOiAnY2FsbGUnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcbiAgICAgIHsgY29sOiAnbnVtZXJvJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXG4gICAgICB7IGNvbDogJ2xvY2FsaWRhZCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJyB9LFxuICAgICAgeyBjb2w6ICdwcm92aW5jaWEnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcbiAgICAgIHsgY29sOiAnbG9jYWxpZGFkX2ZpbmFsJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdvdmVycmlkZSBkZWwgYXByb2JhZG9yJyB9LFxuICAgICAgeyBjb2w6ICdjYXJkX2NvZGVfc2FwJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdDYXJkQ29kZSBTQVAnIH0sXG4gICAgICB7IGNvbDogJ2Fzc2lnbmVkX3ZlbmRvcicsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAndmVuZGVkb3IgYXNpZ25hZG8gKHNvdXJjZSBvZiB0cnV0aCB2MzExKyknIH0sXG4gICAgICB7IGNvbDogJ3N0YXR1cycsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAncGVuZGluZ19hcHByb3ZhbCB8IGFwcHJvdmVkIHwgcmVqZWN0ZWQnIH0sXG4gICAgICB7XG4gICAgICAgIGNvbDogJ3NvdXJjZScsXG4gICAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgICBkZXNjOiAnbWFudWFsIHwgc2FwX2J1bGtfaW1wb3J0IHwgYWx0YV9yYXBpZGEgfCBzYXBfc3luYyB8IHNhcF9zeW5jX21hbnVhbF9saW5rJyxcbiAgICAgIH0sXG4gICAgICB7XG4gICAgICAgIGNvbDogJ21hbnVhbF9zYXBfcGVuZGluZycsXG4gICAgICAgIHR5cGU6ICdib29sZWFuJyxcbiAgICAgICAgZGVzYzogJ3RydWU9cHJvdmlzb3JpbyAoQWx0YSBSYXBpZGEgc2luIENhcmRDb2RlKScsXG4gICAgICB9LFxuICAgICAgeyBjb2w6ICdwcmVjYXVjaW9uJywgdHlwZTogJ2Jvb2xlYW4nLCBkZXNjOiAndHJ1ZT1jbGllbnRlIG1hcmNhZG8gcG9yIGltcGFnbycgfSxcbiAgICAgIHsgY29sOiAnY2F0ZWdvcmlhX2NsaWVudGUnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ1AvQS9CL0MnIH0sXG4gICAgICB7IGNvbDogJ2NsaV90aXBvJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdDIGRlZmF1bHQgcG9zdC12MzQ5JyB9LFxuICAgICAgeyBjb2w6ICdsYXQnLCB0eXBlOiAnbnVtYmVyJywgZGVzYzogJ2dlb2xhdCcgfSxcbiAgICAgIHsgY29sOiAnbG5nJywgdHlwZTogJ251bWJlcicsIGRlc2M6ICdnZW9sbmcnIH0sXG4gICAgICB7IGNvbDogJ2hhc19nZW8nLCB0eXBlOiAnYm9vbGVhbicsIGRlc2M6ICdsYXQvbG5nIG5vIG51bGwnIH0sXG4gICAgICB7IGNvbDogJ2hhc19hZGRyZXNzJywgdHlwZTogJ2Jvb2xlYW4nLCBkZXNjOiAnY2FsbGUgbm8gdmFjaWEnIH0sXG4gICAgICB7IGNvbDogJ3N1Ym1pdHRlZF9ieV9wdWJsaWNfZm9ybScsIHR5cGU6ICdib29sZWFuJywgZGVzYzogJ3ZpYSBhbHRhLWNsaWVudGUuaHRtbCcgfSxcbiAgICAgIHsgY29sOiAnYXBwcm92ZWRfYXQnLCB0eXBlOiAnaXNvODYwMScsIGRlc2M6ICcnIH0sXG4gICAgICB7IGNvbDogJ2NyZWF0ZWRfYXQnLCB0eXBlOiAnaXNvODYwMScsIGRlc2M6ICcnIH0sXG4gICAgICB7IGNvbDogJ3VwZGF0ZWRfYXQnLCB0eXBlOiAnaXNvODYwMScsIGRlc2M6ICcnIH0sXG4gICAgXSxcbiAgfSxcbiAgY2xpZW50X21hc3Rlcjoge1xuICAgIG5hbWU6ICdjbGllbnRfbWFzdGVyLmNzdicsXG4gICAgc291cmNlOiAnZmlyZXN0b3JlJyxcbiAgICBjb2xsZWN0aW9uOiAnY2xpZW50X21hc3RlcicsXG4gICAgcm93TW9kZTogJ29uZV9wZXJfZG9jJyxcbiAgICBjb2x1bW5zOiBbXG4gICAgICB7IGNvbDogJ21hc3Rlcl9pZCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnRmlyZXN0b3JlIGRvYyBJRCcgfSxcbiAgICAgIHsgY29sOiAnY2xpZW50X25hbWUnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcbiAgICAgIHsgY29sOiAncHJvdmluY2lhJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXG4gICAgICB7IGNvbDogJ2xvY2FsaWRhZCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJyB9LFxuICAgICAgeyBjb2w6ICd2ZW5kb3InLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ3ZlbmRlZG9yIGN1cmFkbyBhZG1pbicgfSxcbiAgICAgIHsgY29sOiAnYWRkcmVzcycsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnZGlyZWNjaW9uIGN1cmFkYSBhZG1pbicgfSxcbiAgICAgIHsgY29sOiAnc2FwX2NhcmRfY29kZScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnQ2FyZENvZGUgU0FQJyB9LFxuICAgICAgeyBjb2w6ICdzYXBfYWRkcmVzcycsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnZGlyZWNjaW9uIHJhdyBTQVAnIH0sXG4gICAgICB7IGNvbDogJ3NhcF9jaXR5JywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXG4gICAgICB7IGNvbDogJ3NhcF9zdGF0ZScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJyB9LFxuICAgICAgeyBjb2w6ICdzYXBfaW1wb3J0ZWRfYXQnLCB0eXBlOiAnaXNvODYwMScsIGRlc2M6ICcnIH0sXG4gICAgICB7IGNvbDogJ3NhcF9pbXBvcnRlZF9ieScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJyB9LFxuICAgICAgeyBjb2w6ICdjbGllbnRfbmFtZV9vcmlnaW5hbCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnYmFja3VwIG5vbWJyZSBwcmUtaW1wb3J0JyB9LFxuICAgICAgeyBjb2w6ICdsb2NhbGlkYWRfb3JpZ2luYWwnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ2JhY2t1cCBsb2NhbGlkYWQgcHJlLWltcG9ydCcgfSxcbiAgICAgIHsgY29sOiAnbWF0Y2hfdHlwZScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnZXhhY3QgfCBmdXp6eScgfSxcbiAgICAgIHsgY29sOiAnbWF0Y2hfc2ltaWxhcml0eScsIHR5cGU6ICdudW1iZXInLCBkZXNjOiAnMC0xJyB9LFxuICAgICAgeyBjb2w6ICd1cGRhdGVkX2F0JywgdHlwZTogJ2lzbzg2MDEnLCBkZXNjOiAnJyB9LFxuICAgICAgeyBjb2w6ICd1cGRhdGVkX2J5JywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXG4gICAgXSxcbiAgfSxcbiAgcmVuZGljaW9uZXM6IHtcbiAgICBuYW1lOiAncmVuZGljaW9uZXMuY3N2JyxcbiAgICBzb3VyY2U6ICdmaXJlc3RvcmUnLFxuICAgIGNvbGxlY3Rpb246ICdyZW5kaWNpb25lcycsXG4gICAgcm93TW9kZTogJ29uZV9wZXJfZG9jJyxcbiAgICBjb2x1bW5zOiBbXG4gICAgICB7IGNvbDogJ3JlbmRpY2lvbl9pZCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnRmlyZXN0b3JlIGRvYyBJRCcgfSxcbiAgICAgIHsgY29sOiAnb3duZXJfdWlkJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXG4gICAgICB7IGNvbDogJ293bmVyX2VtYWlsJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXG4gICAgICB7IGNvbDogJ3ZlbmRvcicsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJyB9LFxuICAgICAgeyBjb2w6ICd0aXBvJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdnYXN0byB8IHNvbGljaXR1ZCcgfSxcbiAgICAgIHsgY29sOiAndGlwb19nYXN0bycsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnZWogUEVBSkVTLCBGQUNUVVJBIEEsIEdBU1RPIENPTiBDT01QUk9CQU5URScgfSxcbiAgICAgIHsgY29sOiAnaW1wb3J0ZV9hcnMnLCB0eXBlOiAnbnVtYmVyJywgZGVzYzogJ21vbnRvIEFSUycgfSxcbiAgICAgIHsgY29sOiAnZmVjaGFfZ2FzdG8nLCB0eXBlOiAnaXNvODYwMScsIGRlc2M6ICdZWVlZLU1NLUREIGRlbCBnYXN0bycgfSxcbiAgICAgIHsgY29sOiAnY29uY2VwdG8nLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ2Rlc2NyaXBjaW9uIGxpYnJlJyB9LFxuICAgICAgeyBjb2w6ICdmb3RvX3RpY2tldF91cmwnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ1VSTCBGaXJlYmFzZSBTdG9yYWdlIHYzMDgrIChudW5jYSBiYXNlNjQpJyB9LFxuICAgICAgeyBjb2w6ICdzdGF0dXMnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ3BlbmRpbmdfYXBwcm92YWwgfCBhcHByb3ZlZCB8IHJlamVjdGVkJyB9LFxuICAgICAgeyBjb2w6ICdhcHByb3ZlZF9ieScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnZW1haWwgZGVsIGFwcm9iYWRvciBvIFwic2VsZlwiJyB9LFxuICAgICAgeyBjb2w6ICdhcHByb3ZlZF9hdCcsIHR5cGU6ICdpc284NjAxJywgZGVzYzogJycgfSxcbiAgICAgIHsgY29sOiAncmVqZWN0ZWRfYnlfZW1haWwnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcbiAgICAgIHsgY29sOiAncmVqZWN0ZWRfcmVhc29uJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXG4gICAgICB7IGNvbDogJ2FwcHJvdmVyX3VpZCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnVUlEIHJlc3BvbnNhYmxlIGFzaWduYWRvJyB9LFxuICAgICAgeyBjb2w6ICdjcmVhdGVkX2F0JywgdHlwZTogJ2lzbzg2MDEnLCBkZXNjOiAnJyB9LFxuICAgIF0sXG4gIH0sXG4gIGNhbXBhbmlhczoge1xuICAgIG5hbWU6ICdjYW1wYW5pYXMuY3N2JyxcbiAgICBzb3VyY2U6ICdmaXJlc3RvcmUnLFxuICAgIGNvbGxlY3Rpb246ICdjYW1wYWlnbnMnLFxuICAgIHJvd01vZGU6ICdvbmVfcGVyX2RvYycsXG4gICAgY29sdW1uczogW1xuICAgICAgeyBjb2w6ICdjYW1wYWlnbl9pZCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnRmlyZXN0b3JlIGRvYyBJRCcgfSxcbiAgICAgIHsgY29sOiAnbmFtZScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnbm9tYnJlIGNhbXBhbmEnIH0sXG4gICAgICB7IGNvbDogJ2ZhbWlsaWEnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ2VqIFJFRUxTJyB9LFxuICAgICAgeyBjb2w6ICdzdWJmYW1pbGlhJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdlaiBNVUxUSVBMSUNBRE9SRVMnIH0sXG4gICAgICB7IGNvbDogJ2ZpbHRlcl90eXBlJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdza3UgKGhveSBoYXJkY29kZWQpJyB9LFxuICAgICAgeyBjb2w6ICdmaWx0ZXJfdmFsdWVzX2pzb24nLCB0eXBlOiAnanNvbl9hcnJheScsIGRlc2M6ICdjb3BpYSBkZSBza3VzJyB9LFxuICAgICAgeyBjb2w6ICdza3VzX2pzb24nLCB0eXBlOiAnanNvbl9hcnJheScsIGRlc2M6ICdJdGVtQ29kZXMgaW5jbHVpZG9zJyB9LFxuICAgICAgeyBjb2w6ICdza3VzX2NvdW50JywgdHlwZTogJ2ludCcsIGRlc2M6ICdjYW50aWRhZCBTS1VzJyB9LFxuICAgICAgeyBjb2w6ICd0YXJnZXRfdHlwZScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAndW5pdHMgfCBtb25leScgfSxcbiAgICAgIHsgY29sOiAndGFyZ2V0X2Ftb3VudCcsIHR5cGU6ICdudW1iZXInLCBkZXNjOiAnb2JqZXRpdm8nIH0sXG4gICAgICB7IGNvbDogJ3N0YXJ0X2RhdGUnLCB0eXBlOiAnaXNvODYwMScsIGRlc2M6ICdZWVlZLU1NLUREJyB9LFxuICAgICAgeyBjb2w6ICdlbmRfZGF0ZScsIHR5cGU6ICdpc284NjAxJywgZGVzYzogJ1lZWVktTU0tREQnIH0sXG4gICAgICB7IGNvbDogJ3Njb3BlJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdhbGwgfCBwcm92aW5jZSB8IHZlbmRvcicgfSxcbiAgICAgIHtcbiAgICAgICAgY29sOiAnc2NvcGVfdmFsdWVzX2pzb24nLFxuICAgICAgICB0eXBlOiAnanNvbl9hcnJheScsXG4gICAgICAgIGRlc2M6ICdwcm92aW5jaWFzIG8gdmVuZG9yIGtleXMgc2kgc2NvcGUgIT0gYWxsJyxcbiAgICAgIH0sXG4gICAgICB7IGNvbDogJ2NyZWF0ZWRfYnknLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ1VJRCBhZG1pbi9nZXJlbnRlJyB9LFxuICAgICAgeyBjb2w6ICdjcmVhdGVkX2J5X2VtYWlsJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXG4gICAgICB7IGNvbDogJ2NyZWF0ZWRfYXQnLCB0eXBlOiAnaXNvODYwMScsIGRlc2M6ICcnIH0sXG4gICAgICB7IGNvbDogJ2FyY2hpdmVkX21hbnVhbGx5JywgdHlwZTogJ2Jvb2xlYW4nLCBkZXNjOiAndHJ1ZT1maW5hbGl6YWRhIGFudGVzIGRlIGVuZERhdGUnIH0sXG4gICAgICB7IGNvbDogJ2FyY2hpdmVkX2F0JywgdHlwZTogJ2lzbzg2MDEnLCBkZXNjOiAnJyB9LFxuICAgICAgeyBjb2w6ICdhcmNoaXZlZF9ieScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJyB9LFxuICAgIF0sXG4gIH0sXG4gIHRhcmdldHM6IHtcbiAgICBuYW1lOiAndGFyZ2V0cy5jc3YnLFxuICAgIHNvdXJjZTogJ2ZpcmVzdG9yZScsXG4gICAgY29sbGVjdGlvbjogJ3RhcmdldHMnLFxuICAgIHJvd01vZGU6ICdvbmVfcGVyX2RvYycsXG4gICAgY29sdW1uczogW1xuICAgICAgeyBjb2w6ICd0YXJnZXRfaWQnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ0ZpcmVzdG9yZSBkb2MgSUQgY2Fub25pY28ge3ZlbmRvcn1fe3llYXJ9X3tNTX0nIH0sXG4gICAgICB7IGNvbDogJ3NlbGxlcl9pZCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAndmVuZG9yS2V5IHVwcGVyY2FzZSBlaiBHT05aQUxPIERFIExBIFJPU0EnIH0sXG4gICAgICB7IGNvbDogJ3llYXInLCB0eXBlOiAnaW50JywgZGVzYzogJ2VqIDIwMjYnIH0sXG4gICAgICB7IGNvbDogJ21vbnRoJywgdHlwZTogJ2ludCcsIGRlc2M6ICcwLTExIChpbmRpY2UgZGVsIGFycmF5IE1FU0VTIDAtaW5kZXhlZCknIH0sXG4gICAgICB7IGNvbDogJ3RhcmdldF9hcnMnLCB0eXBlOiAnbnVtYmVyJywgZGVzYzogJ29iamV0aXZvIG1lcyBBUlMgKHN1bWEgZmFtaWxpYXMpJyB9LFxuICAgICAgeyBjb2w6ICd0YXJnZXRfcmVlbF9hcnMnLCB0eXBlOiAnbnVtYmVyJywgZGVzYzogJ3YzMTErIGRlc2dsb3NlJyB9LFxuICAgICAgeyBjb2w6ICd0YXJnZXRfY2FuYXNfYXJzJywgdHlwZTogJ251bWJlcicsIGRlc2M6ICd2MzExKyBkZXNnbG9zZScgfSxcbiAgICAgIHsgY29sOiAndGFyZ2V0X2xpbmVhc19hcnMnLCB0eXBlOiAnbnVtYmVyJywgZGVzYzogJ3YzMTErIGRlc2dsb3NlJyB9LFxuICAgICAgeyBjb2w6ICd1cGRhdGVkX2F0JywgdHlwZTogJ2lzbzg2MDEnLCBkZXNjOiAnJyB9LFxuICAgICAgeyBjb2w6ICd1cGRhdGVkX2J5JywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdVSUQnIH0sXG4gICAgICB7IGNvbDogJ3VwZGF0ZWRfYnlfZW1haWwnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcbiAgICBdLFxuICB9LFxuICBwcm9kdWN0b3M6IHtcbiAgICBuYW1lOiAncHJvZHVjdG9zLmNzdicsXG4gICAgc291cmNlOiAnc3RvY2tfanNvbicsXG4gICAgcm93TW9kZTogJ2Zyb21fc3RvY2tfanNvbicsXG4gICAgY29sdW1uczogW1xuICAgICAgeyBjb2w6ICdza3UnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ1NLVSAoSXRlbUNvZGUgU0FQKScgfSxcbiAgICAgIHsgY29sOiAnaGFzX3N0b2NrJywgdHlwZTogJ2Jvb2xlYW4nLCBkZXNjOiAndHJ1ZT1oYXkgdW5pZGFkZXMgZW4gYWxndW4gd2hzIHZlbmRpYmxlJyB9LFxuICAgICAgeyBjb2w6ICdjYW50aWRhZF90b3RhbCcsIHR5cGU6ICdpbnQnLCBkZXNjOiAnc3VtYSB0b3RhbCB3aHMgdmVuZGlibGVzIChleGNsdXllIDA1IHkgMDYpJyB9LFxuICAgICAge1xuICAgICAgICBjb2w6ICdkaXNwb25pYmxlX3ZlbnRhX3doczExJyxcbiAgICAgICAgdHlwZTogJ2ludCcsXG4gICAgICAgIGRlc2M6ICd2MzY5KyBNZXJjYWRlcmlhIE5VUiBQRVNDQSAodmVudGEgZGlyZWN0YSknLFxuICAgICAgfSxcbiAgICAgIHsgY29sOiAndHJhbnNpdG9fd2hzMTInLCB0eXBlOiAnaW50JywgZGVzYzogJ3YzNjkrIEVuIHRyYW5zaXRvIFBFU0NBIChiYWNrb3JkZXIgZnV0dXJvKScgfSxcbiAgICAgIHtcbiAgICAgICAgY29sOiAnb3Ryb3Nfd2FyZWhvdXNlc19qc29uJyxcbiAgICAgICAgdHlwZTogJ2pzb25fb2JqZWN0JyxcbiAgICAgICAgZGVzYzogJ290cm9zIGNvZGlnb3MgY29uIGNhbnRpZGFkLCBlaiB7XCI5OFwiOiA1fScsXG4gICAgICB9LFxuICAgICAgeyBjb2w6ICdzb3VyY2UnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ3N0b2NrLmpzb24gc25hcHNob3QnIH0sXG4gICAgICB7IGNvbDogJ3NuYXBzaG90X3VwZGF0ZWRfYXQnLCB0eXBlOiAnaXNvODYwMScsIGRlc2M6ICd0aW1lc3RhbXAgZGVsIHVsdGltbyBzeW5jIFNBUCcgfSxcbiAgICBdLFxuICB9LFxuICB2ZW5kb3Jfb3ZlcnJpZGVzOiB7XG4gICAgbmFtZTogJ3ZlbmRvcl9vdmVycmlkZXMuY3N2JyxcbiAgICBzb3VyY2U6ICdmaXJlc3RvcmUnLFxuICAgIGNvbGxlY3Rpb246ICd2ZW5kb3Jfb3ZlcnJpZGVzJyxcbiAgICByb3dNb2RlOiAnb25lX3Blcl9kb2MnLFxuICAgIGNvbHVtbnM6IFtcbiAgICAgIHsgY29sOiAnb3ZlcnJpZGVfaWQnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ0ZpcmVzdG9yZSBkb2MgSUQnIH0sXG4gICAgICB7IGNvbDogJ3Njb3BlJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdzaG9wIHwgbG9jJyB9LFxuICAgICAgeyBjb2w6ICdwcm92aW5jZScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJyB9LFxuICAgICAgeyBjb2w6ICdsb2NhbGl0eV9uYW1lJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXG4gICAgICB7IGNvbDogJ2NsaWVudF9uYW1lJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdzb2xvIHNpIHNjb3BlPXNob3AnIH0sXG4gICAgICB7IGNvbDogJ29yaWdpbmFsX3ZlbmRvcicsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJyB9LFxuICAgICAgeyBjb2w6ICduZXdfdmVuZG9yJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXG4gICAgICB7IGNvbDogJ25ld190eXBlJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdWREUgfCBWREkgfCBESVNUUklCVUlET1IgfCBPVFJPJyB9LFxuICAgICAgeyBjb2w6ICd1cGRhdGVkX2F0JywgdHlwZTogJ2lzbzg2MDEnLCBkZXNjOiAnJyB9LFxuICAgICAgeyBjb2w6ICd1cGRhdGVkX2J5X3VpZCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJyB9LFxuICAgICAgeyBjb2w6ICd1cGRhdGVkX2J5X2VtYWlsJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXG4gICAgICB7IGNvbDogJ3VwZGF0ZWRfYnlfZGlzcGxheV9uYW1lJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXG4gICAgXSxcbiAgfSxcbiAgY3VzdG9tX3JvdXRlczoge1xuICAgIG5hbWU6ICdjdXN0b21fcm91dGVzLmNzdicsXG4gICAgc291cmNlOiAnZmlyZXN0b3JlJyxcbiAgICBjb2xsZWN0aW9uOiAnY3VzdG9tX3JvdXRlcycsXG4gICAgcm93TW9kZTogJ2ZsYXR0ZW5fc3RvcHMnLCAvLyAxIGZpbGEgcG9yIChydXRhLCBzdG9wKVxuICAgIGNvbHVtbnM6IFtcbiAgICAgIHsgY29sOiAncm91dGVfaWQnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ0ZpcmVzdG9yZSBkb2MgSUQnIH0sXG4gICAgICB7IGNvbDogJ293bmVyX3VpZCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnZHVlbmlvIGRlIGxhIHJ1dGEnIH0sXG4gICAgICB7IGNvbDogJ293bmVyX2VtYWlsJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXG4gICAgICB7IGNvbDogJ25hbWUnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ25vbWJyZSBkZSBsYSBydXRhJyB9LFxuICAgICAgeyBjb2w6ICdwbGFubmVkX2RhdGUnLCB0eXBlOiAnaXNvODYwMScsIGRlc2M6ICdZWVlZLU1NLUREJyB9LFxuICAgICAgeyBjb2w6ICdub3RlcycsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnbm90YXMgbGlicmVzJyB9LFxuICAgICAgeyBjb2w6ICdjcmVhdGVkX2F0JywgdHlwZTogJ2lzbzg2MDEnLCBkZXNjOiAnJyB9LFxuICAgICAgeyBjb2w6ICd1cGRhdGVkX2F0JywgdHlwZTogJ2lzbzg2MDEnLCBkZXNjOiAnJyB9LFxuICAgICAgeyBjb2w6ICdzdG9wX29yZGVyJywgdHlwZTogJ2ludCcsIGRlc2M6ICdvcmRlbiAwLWJhc2VkJyB9LFxuICAgICAgeyBjb2w6ICdzdG9wX2tleScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnY2xhdmUgY29tcHVlc3RhIHRpcG98cHJvdnxsb2N8Y2xpZW50ZScgfSxcbiAgICAgIHsgY29sOiAnc3RvcF90aXBvJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdDIHwgUCcgfSxcbiAgICAgIHsgY29sOiAnc3RvcF9wcm92aW5jaWEnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcbiAgICAgIHsgY29sOiAnc3RvcF9sb2NhbGlkYWQnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcbiAgICAgIHsgY29sOiAnc3RvcF9jbGllbnRfbmFtZScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJyB9LFxuICAgICAgeyBjb2w6ICdzdG9wX2lzX3Byb3Zpc29yaW8nLCB0eXBlOiAnYm9vbGVhbicsIGRlc2M6ICd0cnVlPWFsdGEgcmFwaWRhIHNpbiBDYXJkQ29kZScgfSxcbiAgICAgIHsgY29sOiAnc3RvcF9zYXBfYWx0YV9pZCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnSUQgZGVsIGNsaWVudF9hcHBsaWNhdGlvbnMgc2kgYXBsaWNhJyB9LFxuICAgIF0sXG4gIH0sXG4gIHNlZ3VpbWllbnRvX25vdGVzOiB7XG4gICAgbmFtZTogJ3NlZ3VpbWllbnRvX25vdGVzLmNzdicsXG4gICAgc291cmNlOiAnZmlyZXN0b3JlJyxcbiAgICBjb2xsZWN0aW9uOiAnc2VndWltaWVudG9fbm90ZXMnLFxuICAgIHJvd01vZGU6ICdvbmVfcGVyX2RvYycsXG4gICAgY29sdW1uczogW1xuICAgICAgeyBjb2w6ICdub3RlX2lkJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdGaXJlc3RvcmUgZG9jIElEJyB9LFxuICAgICAgeyBjb2w6ICd2ZW5kb3JfZXh0JywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdWREUgYWwgcXVlIGFwbGljYSBsYSBub3RhJyB9LFxuICAgICAgeyBjb2w6ICdjbGllbnRfa2V5JywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdjbGF2ZSBjb21wdWVzdGEgY2xpZW50ZScgfSxcbiAgICAgIHsgY29sOiAnY2xpZW50X25hbWUnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcbiAgICAgIHsgY29sOiAncHJvdmluY2UnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcbiAgICAgIHsgY29sOiAnbG9jYWxpdHknLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcbiAgICAgIHsgY29sOiAndGV4dCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAndGV4dG8gbGlicmUgZGUgbGEgbm90YScgfSxcbiAgICAgIHsgY29sOiAnYXV0aG9yX3VpZCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJyB9LFxuICAgICAgeyBjb2w6ICdhdXRob3JfZW1haWwnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcbiAgICAgIHsgY29sOiAnYXV0aG9yX25hbWUnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcbiAgICAgIHsgY29sOiAnYXV0aG9yX3JvbGUnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ2FkbWluIHwgZ2VyZW50ZSB8IGludGVybm8nIH0sXG4gICAgICB7IGNvbDogJ2NyZWF0ZWRfYXQnLCB0eXBlOiAnaXNvODYwMScsIGRlc2M6ICcnIH0sXG4gICAgXSxcbiAgfSxcbn07XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gREFUQVNFVF9VU0VfQ0FTRV9NQVRSSVggXHUyMDE0IGNhc29zIGRlIHVzbyBNTCBjb24gY2FtcG9zIHJlcXVlcmlkb3Ncbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4vKiogQHR5cGVkZWYge3twcmlvcml0eTogbnVtYmVyfHN0cmluZywgZGVzY3JpcHRpb246IHN0cmluZywgcmVxdWlyZWRGaWVsZHM6IFJlY29yZDxzdHJpbmcsIHN0cmluZ1tdPiwgam9pbk5vdGVzPzogc3RyaW5nfX0gVXNlQ2FzZSAqL1xuXG4vKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFVzZUNhc2U+fSAqL1xuZXhwb3J0IGNvbnN0IERBVEFTRVRfVVNFX0NBU0VfTUFUUklYID0ge1xuICBBX2NvbnZlcnNpb25fdmlzaXRhX3BlZGlkbzoge1xuICAgIHByaW9yaXR5OiAxLFxuICAgIGRlc2NyaXB0aW9uOiAnUHJlZGVjaXIgcXVlIHZpc2l0YXMgdGVybWluYW4gZW4gcGVkaWRvIHBhcmEgcHJpb3JpemFyIGxhIHJ1dGEgZGVsIHZlbmRlZG9yLicsXG4gICAgcmVxdWlyZWRGaWVsZHM6IHtcbiAgICAgICd2aXNpdGFzLmNzdic6IFsnZmVjaGEnLCAnb3duZXJfdWlkJywgJ3Byb3ZpbmNpYScsICdsb2NhbGlkYWQnLCAndGllbmRhJ10sXG4gICAgICAncGVkaWRvcy5jc3YnOiBbJ2NvbmZpcm1lZF9hdCcsICdvd25lcl91aWQnLCAncHJvdmluY2UnLCAnbG9jX25hbWUnLCAnY2xpZW50X25hbWUnXSxcbiAgICB9LFxuICAgIGpvaW5Ob3RlczpcbiAgICAgICdKT0lOIHBvciAocHJvdmluY2lhLCBsb2NhbGlkYWQsIHRpZW5kYX5jbGllbnRfbmFtZSkgZW4gdmVudGFuYSB0ZW1wb3JhbCBmZWNoYV92aXNpdGEuLmNvbmZpcm1lZF9hdC4gTm8gaGF5IGNhcmRDb2RlU2FwIGNvbXVuIGVudHJlIHZpc2l0cyB5IHBlZGlkb3MuJyxcbiAgfSxcbiAgQl9jaHVybl9jbGllbnRlczoge1xuICAgIHByaW9yaXR5OiAyLFxuICAgIGRlc2NyaXB0aW9uOiAnRGV0ZWN0YXIgY2xpZW50ZXMgcXVlIHNlIGVuZnJpYW4gYW50ZXMgZGUgcGVyZGVybG9zLicsXG4gICAgcmVxdWlyZWRGaWVsZHM6IHtcbiAgICAgICdjbGllbnRlcy5jc3YnOiBbJ2NyZWF0ZWRfYXQnLCAnYXNzaWduZWRfdmVuZG9yJywgJ3Byb3ZpbmNpYScsICdzdGF0dXMnLCAnY2FyZF9jb2RlX3NhcCddLFxuICAgICAgJ3BlZGlkb3MuY3N2JzogWydjb25maXJtZWRfYXQnLCAnY2xpZW50X25hbWUnLCAncHJvdmluY2UnLCAnbG9jX25hbWUnXSxcbiAgICB9LFxuICAgIGpvaW5Ob3RlczpcbiAgICAgICdKT0lOIHZpYSBjbGllbnRfYXBwbGljYXRpb25zLmNhcmRfY29kZV9zYXAgdnMgcGVkaWRvcy5rZXkgKHBhcnNlYWRvKS4gRnJhZ2lsIC0gY29uc2lkZXJhciBmdXp6eSBtYXRjaCBwb3Igbm9tYnJlLicsXG4gIH0sXG4gIENfZm9yZWNhc3Rfc2t1OiB7XG4gICAgcHJpb3JpdHk6IDMsXG4gICAgZGVzY3JpcHRpb246ICdBbnRpY2lwYXIgcXVlIHByb2R1Y3RvcyBzZSB2YW4gYSBwZWRpciBwb3IgcGVyaW9kby4nLFxuICAgIHJlcXVpcmVkRmllbGRzOiB7XG4gICAgICAncGVkaWRvcy5jc3YnOiBbJ2xpbmVfY29kZScsICdsaW5lX3F0eScsICdsaW5lX3ByZWNpbycsICdjb25maXJtZWRfYXQnLCAncHJvdmluY2UnXSxcbiAgICAgICdwcm9kdWN0b3MuY3N2JzogWydza3UnXSxcbiAgICB9LFxuICAgIGpvaW5Ob3RlczpcbiAgICAgICdEZXNjdWVudG8gYXBsaWNhZG8gYSBuaXZlbCBoZWFkZXIgKGRpc2NvdW50X3BjdCkgLSBwcm9ycmF0ZWFyIGVuIGVsIHBpcGVsaW5lIGRvd25zdHJlYW0gcHJvcG9yY2lvbmFsIGEgc3VidG90YWxfYnJ1dG8gZGUgY2FkYSBsaW5lYS4gRW5yaXF1ZWNlciBjb24gY2F0YWxvZ28gQlEgKHNhcF9pdGVtc19yYXcpIHNpIGhhY2UgZmFsdGEgY2F0L2ZhbS9zdWIgYWRpY2lvbmFsLicsXG4gIH0sXG4gIERfYW5vbWFsaWFzX3JlbmRpY2lvbmVzOiB7XG4gICAgcHJpb3JpdHk6ICdleHBsb3JhdG9yaW8nLFxuICAgIGRlc2NyaXB0aW9uOiAnRGV0ZWN0YXIgb3V0bGllcnMgZGUgZ2FzdG9zLicsXG4gICAgcmVxdWlyZWRGaWVsZHM6IHtcbiAgICAgICdyZW5kaWNpb25lcy5jc3YnOiBbJ2ltcG9ydGVfYXJzJywgJ3RpcG9fZ2FzdG8nLCAnb3duZXJfdWlkJywgJ2ZlY2hhX2dhc3RvJywgJ3N0YXR1cyddLFxuICAgIH0sXG4gIH0sXG4gIEVfZXN0YWNpb25hbGlkYWRfem9uYV9jYXRlZ29yaWE6IHtcbiAgICBwcmlvcml0eTogJ2V4cGxvcmF0b3JpbycsXG4gICAgZGVzY3JpcHRpb246ICdJbnN1bW8gcGFyYSBhcm1hZG8gZGUgY2FtcGFuaWFzIGVzdGFjaW9uYWxlcy4nLFxuICAgIHJlcXVpcmVkRmllbGRzOiB7XG4gICAgICAncGVkaWRvcy5jc3YnOiBbJ2NvbmZpcm1lZF9hdCcsICdwcm92aW5jZScsICdsaW5lX2NvZGUnLCAnbGluZV9mYW0nLCAnbGluZV9xdHknXSxcbiAgICAgICdjbGllbnRlcy5jc3YnOiBbJ3Byb3ZpbmNpYScsICdhc3NpZ25lZF92ZW5kb3InXSxcbiAgICAgICdjYW1wYW5pYXMuY3N2JzogWydzdGFydF9kYXRlJywgJ2VuZF9kYXRlJywgJ3NrdXNfanNvbicsICdzY29wZSddLFxuICAgICAgJ3RhcmdldHMuY3N2JzogWyd5ZWFyJywgJ21vbnRoJywgJ3RhcmdldF9hcnMnXSxcbiAgICB9LFxuICB9LFxufTtcblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBSb3cgYnVpbGRlcnMgXHUyMDE0IGZ1bmNpb25lcyBwdXJhcyAoZG9jIC0+IGFycmF5IGRlIHJvd3MpXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuLyoqXG4gKiBFeHRyYWUgdmFsb3IgRmlyZXN0b3JlIGRlIGRvYyBjb24gcGF0aCBhbmlkYWRvLiBEZXZ1ZWx2ZSByYXcgKG5vIENTVikuXG4gKiBFajogZ2V0RmllbGQoZG9jLCAndHJhbnNmZXJpZG9TQVAuZG9jTnVtJylcbiAqIEBwYXJhbSB7b2JqZWN0fSBkb2NcbiAqIEBwYXJhbSB7c3RyaW5nfSBwYXRoXG4gKi9cbmZ1bmN0aW9uIGYoZG9jLCBwYXRoKSB7XG4gIHJldHVybiBnZXRQYXRoKGRvYywgcGF0aCk7XG59XG5cbi8qKlxuICogUm93IGJ1aWxkZXIgZ2VuZXJpY286IG1hcGVhIHVuIGRvYyBhIGFycmF5IGRlIHZhbG9yZXMgc2VndW4gdW4gYXJyYXkgZGUgcGF0aHMuXG4gKiBAcGFyYW0ge29iamVjdH0gZG9jXG4gKiBAcGFyYW0ge3N0cmluZ1tdfSBwYXRoc1xuICogQHJldHVybnMge3Vua25vd25bXX1cbiAqL1xuZnVuY3Rpb24gX2J1aWxkUm93KGRvYywgcGF0aHMpIHtcbiAgcmV0dXJuIHBhdGhzLm1hcCgocCkgPT4gKHAgPT09ICdfX2lkX18nID8gLyoqIEB0eXBlIHthbnl9ICovIChkb2MpLl9pZCA6IGYoZG9jLCBwKSkpO1xufVxuXG4vKipcbiAqIFBlZGlkb3M6IGZsYXR0ZW4gMSBmaWxhIHBvciBsaW5lYS4gSGVhZGVyIHBlZGlkbyByZXBsaWNhZG8gZW4gY2FkYS5cbiAqIGRvYy5faWQgZXMgZWwgSUQ7IHNlIGVzcGVyYSBxdWUgZWwgY2FsbGVyIGxvIGFncmVndWUgYW50ZXMgZGUgcGFzYXIuXG4gKiBAcGFyYW0ge2FueX0gZG9jXG4gKiBAcmV0dXJucyB7dW5rbm93bltdW119XG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBidWlsZFBlZGlkb1Jvd3MoZG9jKSB7XG4gIGNvbnN0IGhlYWRlciA9IFtcbiAgICBkb2MuX2lkLFxuICAgIGRvYy5vd25lclVpZCxcbiAgICBkb2Mub3duZXJFbWFpbCxcbiAgICBkb2MuY3JlYXRlZEJ5VWlkLFxuICAgIGRvYy5vbkJlaGFsZk9mLFxuICAgIGRvYy5rZXksXG4gICAgZG9jLnN0YWdlLFxuICAgIGRvYy50aXBvLFxuICAgIGRvYy5wcm92aW5jZSxcbiAgICBkb2MubG9jTmFtZSxcbiAgICBkb2MuY2xpZW50TmFtZSxcbiAgICBkb2MubW9udGgsXG4gICAgZG9jLm1vbnRoSWR4LFxuICAgIGRvYy55ZWFyLFxuICAgIGRvYy5jb25maXJtZWRBdCxcbiAgICBkb2MuY29uZGljaW9uUGFnbyxcbiAgICBkb2MuZm9ybWFFbnRyZWdhID8gZG9jLmZvcm1hRW50cmVnYS50aXBvIDogbnVsbCxcbiAgICBkb2MuZm9ybWFFbnRyZWdhID8gZG9jLmZvcm1hRW50cmVnYS50cmFuc3BOb21icmUgOiBudWxsLFxuICAgIGRvYy5mb3JtYUVudHJlZ2EgPyBkb2MuZm9ybWFFbnRyZWdhLnRyYW5zcERpcmVjY2lvbiA6IG51bGwsXG4gICAgZG9jLmZvcm1hRW50cmVnYSA/IGRvYy5mb3JtYUVudHJlZ2EuY2xpZW50ZURpcmVjY2lvbiA6IG51bGwsXG4gICAgZG9jLmZvcm1hRW50cmVnYSA/IGRvYy5mb3JtYUVudHJlZ2Euc3VjdXJzYWxEaXJlY2Npb24gOiBudWxsLFxuICAgIGRvYy5kaXNjb3VudFBjdCxcbiAgICBkb2Muc3VidG90YWxBcnMsXG4gICAgZG9jLm5ldEFtb3VudEFycyxcbiAgICBkb2MudHJhbnNmZXJpZG9TQVAgPyBkb2MudHJhbnNmZXJpZG9TQVAudmlhIDogbnVsbCxcbiAgICBkb2MudHJhbnNmZXJpZG9TQVAgPyBkb2MudHJhbnNmZXJpZG9TQVAuZG9jTnVtIDogbnVsbCxcbiAgICBkb2MudHJhbnNmZXJpZG9TQVAgPyBkb2MudHJhbnNmZXJpZG9TQVAuZG9jRW50cnkgOiBudWxsLFxuICAgIGRvYy50cmFuc2Zlcmlkb1NBUCA/IGRvYy50cmFuc2Zlcmlkb1NBUC5hdCA6IG51bGwsXG4gICAgZG9jLmNyZWF0ZWRBdCxcbiAgXTtcbiAgY29uc3QgbGluZXMgPSBBcnJheS5pc0FycmF5KGRvYy5saW5lcykgPyBkb2MubGluZXMgOiBbXTtcbiAgaWYgKCFsaW5lcy5sZW5ndGgpIHtcbiAgICAvLyBQZWRpZG8gc2luIGxpbmVhcyAtPiAxIGZpbGEgY29uIGxpbmVfKiB2YWNpb3NcbiAgICByZXR1cm4gW2hlYWRlci5jb25jYXQoW251bGwsIG51bGwsIG51bGwsIG51bGwsIG51bGwsIG51bGwsIG51bGwsIG51bGxdKV07XG4gIH1cbiAgcmV0dXJuIGxpbmVzLm1hcCgoLyoqIEB0eXBlIHthbnl9ICovIGwsIC8qKiBAdHlwZSB7bnVtYmVyfSAqLyBpZHgpID0+XG4gICAgaGVhZGVyLmNvbmNhdChbXG4gICAgICBpZHgsXG4gICAgICBsID8gbC5jb2RlIDogbnVsbCxcbiAgICAgIGwgPyBsLmRlc2MgOiBudWxsLFxuICAgICAgbCA/IGwucXR5IDogbnVsbCxcbiAgICAgIGwgPyBsLnByZWNpbyA6IG51bGwsXG4gICAgICBsID8gbC5jYXQgOiBudWxsLFxuICAgICAgbCA/IGwuZmFtIDogbnVsbCxcbiAgICAgIGwgPyBsLnN1YiA6IG51bGwsXG4gICAgXSlcbiAgKTtcbn1cblxuLyoqIEBwYXJhbSB7YW55fSBkb2MgQHJldHVybnMge3Vua25vd25bXVtdfSAqL1xuZXhwb3J0IGZ1bmN0aW9uIGJ1aWxkVmlzaXRhUm93cyhkb2MpIHtcbiAgcmV0dXJuIFtcbiAgICBbXG4gICAgICBkb2MuX2lkLFxuICAgICAgZG9jLm93bmVyVWlkLFxuICAgICAgZG9jLm93bmVyRW1haWwsXG4gICAgICBkb2MuZmVjaGEsXG4gICAgICBkb2MubWVzLFxuICAgICAgZG9jLmFuaW8sXG4gICAgICBkb2MudmVuZG9yLFxuICAgICAgZG9jLnByb3ZpbmNpYSxcbiAgICAgIGRvYy5sb2NhbGlkYWQsXG4gICAgICBkb2MudGllbmRhLFxuICAgICAgZG9jLnRpcG8sXG4gICAgICBkb2MubG9jYWwsXG4gICAgICBkb2MudGFtYW5vLFxuICAgICAgZG9jLmZpZGVsaWRhZCxcbiAgICAgIGRvYy5yZWxldmFuY2lhLFxuICAgICAgZG9jLnBvcCxcbiAgICAgIGRvYy5uZWNlc2lkYWRQdW50dWFsLFxuICAgICAgZG9jLnRpcG9WZW50YSxcbiAgICAgIGRvYy5wb25kZXJhY2lvbk1vc3RyYWRvLFxuICAgICAgZG9jLnBvbmRlcmFjaW9uRWNvbW1lcmNlLFxuICAgICAgZG9jLmNvbXBldGVuY2lhLFxuICAgICAgZG9jLm9wb3J0dW5pZGFkLFxuICAgICAgZG9jLm1hc1ZlbmRpZG8sXG4gICAgICBkb2MubWFzUHJlZ3VudGFuLFxuICAgICAgZG9jLmF5dWRhVGllbmRhLFxuICAgICAgZG9jLmdwc1N0YXR1cyxcbiAgICAgIGRvYy5ncHNEaXN0YW5jZU0sXG4gICAgICBkb2MuaW50ZXJhY3Rpb25UeXBlLFxuICAgICAgZG9jLmZvcm1hQ29udGFjdG8sXG4gICAgICBkb2MuY29udGFjdG9SZXN1bHRhZG8sXG4gICAgICBkb2MuY29udGFjdG9SZXN1bHRhZG9BdCxcbiAgICAgIGRvYy5jb250YWN0b1Jlc3VsdGFkb0J5LFxuICAgICAgZG9jLmNyZWF0ZWRBdCxcbiAgICBdLFxuICBdO1xufVxuXG4vKiogQHBhcmFtIHthbnl9IGRvYyBAcmV0dXJucyB7dW5rbm93bltdW119ICovXG5leHBvcnQgZnVuY3Rpb24gYnVpbGRDbGllbnRlUm93cyhkb2MpIHtcbiAgcmV0dXJuIFtcbiAgICBbXG4gICAgICBkb2MuX2lkLFxuICAgICAgZG9jLm93bmVyVWlkLFxuICAgICAgZG9jLm93bmVyRW1haWwsXG4gICAgICBkb2Mub3duZXJOYW1lLFxuICAgICAgZG9jLmNvbWVyY2lvLFxuICAgICAgZG9jLmZhbnRhc2lhLFxuICAgICAgZG9jLmN1aXQsXG4gICAgICBkb2MuY29uZGljaW9uRmlzY2FsLFxuICAgICAgZG9jLmNhbGxlLFxuICAgICAgZG9jLm51bWVybyxcbiAgICAgIGRvYy5sb2NhbGlkYWQsXG4gICAgICBkb2MucHJvdmluY2lhLFxuICAgICAgZG9jLmxvY2FsaWRhZEZpbmFsLFxuICAgICAgZG9jLmNhcmRDb2RlU2FwLFxuICAgICAgZG9jLmFzc2lnbmVkVmVuZG9yLFxuICAgICAgZG9jLnN0YXR1cyxcbiAgICAgIGRvYy5zb3VyY2UsXG4gICAgICBkb2MubWFudWFsU2FwUGVuZGluZyxcbiAgICAgIGRvYy5wcmVjYXVjaW9uLFxuICAgICAgZG9jLmNhdGVnb3JpYUNsaWVudGUsXG4gICAgICBkb2MuY2xpVGlwbyxcbiAgICAgIGRvYy5sYXQsXG4gICAgICBkb2MubG5nLFxuICAgICAgZG9jLmxhdCAhPSBudWxsICYmIGRvYy5sbmcgIT0gbnVsbCxcbiAgICAgICEhKGRvYy5jYWxsZSB8fCBkb2MuYWRkcmVzcyksXG4gICAgICBkb2Muc3VibWl0dGVkQnlQdWJsaWNGb3JtLFxuICAgICAgZG9jLmFwcHJvdmVkQXQsXG4gICAgICBkb2MuY3JlYXRlZEF0LFxuICAgICAgZG9jLnVwZGF0ZWRBdCxcbiAgICBdLFxuICBdO1xufVxuXG4vKiogQHBhcmFtIHthbnl9IGRvYyBAcmV0dXJucyB7dW5rbm93bltdW119ICovXG5leHBvcnQgZnVuY3Rpb24gYnVpbGRDbGllbnRNYXN0ZXJSb3dzKGRvYykge1xuICByZXR1cm4gW1xuICAgIFtcbiAgICAgIGRvYy5faWQsXG4gICAgICBkb2MuY2xpZW50TmFtZSxcbiAgICAgIGRvYy5wcm92aW5jaWEsXG4gICAgICBkb2MubG9jYWxpZGFkLFxuICAgICAgZG9jLnZlbmRvcixcbiAgICAgIGRvYy5hZGRyZXNzLFxuICAgICAgZG9jLnNhcENhcmRDb2RlLFxuICAgICAgZG9jLnNhcEFkZHJlc3MsXG4gICAgICBkb2Muc2FwQ2l0eSxcbiAgICAgIGRvYy5zYXBTdGF0ZSxcbiAgICAgIGRvYy5zYXBJbXBvcnRlZEF0LFxuICAgICAgZG9jLnNhcEltcG9ydGVkQnksXG4gICAgICBkb2MuY2xpZW50TmFtZU9yaWdpbmFsLFxuICAgICAgZG9jLmxvY2FsaWRhZE9yaWdpbmFsLFxuICAgICAgZG9jLm1hdGNoVHlwZSxcbiAgICAgIGRvYy5tYXRjaFNpbWlsYXJpdHksXG4gICAgICBkb2MudXBkYXRlZEF0LFxuICAgICAgZG9jLnVwZGF0ZWRCeSxcbiAgICBdLFxuICBdO1xufVxuXG4vKiogQHBhcmFtIHthbnl9IGRvYyBAcmV0dXJucyB7dW5rbm93bltdW119ICovXG5leHBvcnQgZnVuY3Rpb24gYnVpbGRSZW5kaWNpb25Sb3dzKGRvYykge1xuICByZXR1cm4gW1xuICAgIFtcbiAgICAgIGRvYy5faWQsXG4gICAgICBkb2Mub3duZXJVaWQsXG4gICAgICBkb2Mub3duZXJFbWFpbCxcbiAgICAgIGRvYy52ZW5kb3IsXG4gICAgICBkb2MudGlwbyxcbiAgICAgIGRvYy50aXBvR2FzdG8sXG4gICAgICBkb2MuaW1wb3J0ZUFycyAhPSBudWxsID8gZG9jLmltcG9ydGVBcnMgOiBkb2MuaW1wb3J0ZSxcbiAgICAgIGRvYy5mZWNoYUdhc3RvLFxuICAgICAgZG9jLmNvbmNlcHRvLFxuICAgICAgLy8gZm90b1RpY2tldFVybCAodjMwOCspIHByaW9yaWRhZDsgTlVOQ0EgZXhwb3J0YXIgYmFzZTY0IGZvdG9UaWNrZXQgbGVnYWN5XG4gICAgICBkb2MuZm90b1RpY2tldFVybCB8fCBudWxsLFxuICAgICAgZG9jLnN0YXR1cyxcbiAgICAgIGRvYy5hcHByb3ZlZEJ5LFxuICAgICAgZG9jLmFwcHJvdmVkQXQsXG4gICAgICBkb2MucmVqZWN0ZWRCeUVtYWlsLFxuICAgICAgZG9jLnJlamVjdGVkUmVhc29uLFxuICAgICAgZG9jLmFwcHJvdmVyVWlkLFxuICAgICAgZG9jLmNyZWF0ZWRBdCxcbiAgICBdLFxuICBdO1xufVxuXG4vKiogQHBhcmFtIHthbnl9IGRvYyBAcmV0dXJucyB7dW5rbm93bltdW119ICovXG5leHBvcnQgZnVuY3Rpb24gYnVpbGRDYW1wYW5pYVJvd3MoZG9jKSB7XG4gIHJldHVybiBbXG4gICAgW1xuICAgICAgZG9jLl9pZCxcbiAgICAgIGRvYy5uYW1lLFxuICAgICAgZG9jLmZhbWlsaWEsXG4gICAgICBkb2Muc3ViZmFtaWxpYSxcbiAgICAgIGRvYy5maWx0ZXJUeXBlLFxuICAgICAgZG9jLmZpbHRlclZhbHVlcyxcbiAgICAgIGRvYy5za3VzLFxuICAgICAgQXJyYXkuaXNBcnJheShkb2Muc2t1cykgPyBkb2Muc2t1cy5sZW5ndGggOiAwLFxuICAgICAgZG9jLnRhcmdldFR5cGUsXG4gICAgICBkb2MudGFyZ2V0QW1vdW50LFxuICAgICAgZG9jLnN0YXJ0RGF0ZSxcbiAgICAgIGRvYy5lbmREYXRlLFxuICAgICAgZG9jLnNjb3BlLFxuICAgICAgZG9jLnNjb3BlVmFsdWVzLFxuICAgICAgZG9jLmNyZWF0ZWRCeSxcbiAgICAgIGRvYy5jcmVhdGVkQnlFbWFpbCxcbiAgICAgIGRvYy5jcmVhdGVkQXQsXG4gICAgICBkb2MuYXJjaGl2ZWRNYW51YWxseSxcbiAgICAgIGRvYy5hcmNoaXZlZEF0LFxuICAgICAgZG9jLmFyY2hpdmVkQnksXG4gICAgXSxcbiAgXTtcbn1cblxuLyoqIEBwYXJhbSB7YW55fSBkb2MgQHJldHVybnMge3Vua25vd25bXVtdfSAqL1xuZXhwb3J0IGZ1bmN0aW9uIGJ1aWxkVGFyZ2V0Um93cyhkb2MpIHtcbiAgcmV0dXJuIFtcbiAgICBbXG4gICAgICBkb2MuX2lkLFxuICAgICAgZG9jLnNlbGxlcklkLFxuICAgICAgZG9jLnllYXIsXG4gICAgICBkb2MubW9udGgsXG4gICAgICBkb2MudGFyZ2V0QXJzLFxuICAgICAgZG9jLnRhcmdldEJ5RmFtaWx5ID8gZG9jLnRhcmdldEJ5RmFtaWx5LlJFRUwgOiBudWxsLFxuICAgICAgZG9jLnRhcmdldEJ5RmFtaWx5ID8gZG9jLnRhcmdldEJ5RmFtaWx5LkNBTkFTIDogbnVsbCxcbiAgICAgIGRvYy50YXJnZXRCeUZhbWlseSA/IGRvYy50YXJnZXRCeUZhbWlseS5MSU5FQVMgOiBudWxsLFxuICAgICAgZG9jLnVwZGF0ZWRBdCxcbiAgICAgIGRvYy51cGRhdGVkQnksXG4gICAgICBkb2MudXBkYXRlZEJ5RW1haWwsXG4gICAgXSxcbiAgXTtcbn1cblxuLyoqIEBwYXJhbSB7YW55fSBkb2MgQHJldHVybnMge3Vua25vd25bXVtdfSAqL1xuZXhwb3J0IGZ1bmN0aW9uIGJ1aWxkVmVuZG9yT3ZlcnJpZGVSb3dzKGRvYykge1xuICByZXR1cm4gW1xuICAgIFtcbiAgICAgIGRvYy5faWQsXG4gICAgICBkb2Muc2NvcGUsXG4gICAgICBkb2MucHJvdmluY2UsXG4gICAgICBkb2MubG9jYWxpdHlOYW1lLFxuICAgICAgZG9jLmNsaWVudE5hbWUsXG4gICAgICBkb2Mub3JpZ2luYWxWZW5kb3IsXG4gICAgICBkb2MubmV3VmVuZG9yLFxuICAgICAgZG9jLm5ld1R5cGUsXG4gICAgICBkb2MudXBkYXRlZEF0LFxuICAgICAgZG9jLnVwZGF0ZWRCeVVpZCxcbiAgICAgIGRvYy51cGRhdGVkQnlFbWFpbCxcbiAgICAgIGRvYy51cGRhdGVkQnlEaXNwbGF5TmFtZSxcbiAgICBdLFxuICBdO1xufVxuXG4vKiogQHBhcmFtIHthbnl9IGRvYyBAcmV0dXJucyB7dW5rbm93bltdW119ICovXG5leHBvcnQgZnVuY3Rpb24gYnVpbGRDdXN0b21Sb3V0ZVJvd3MoZG9jKSB7XG4gIGNvbnN0IGhlYWRlciA9IFtcbiAgICBkb2MuX2lkLFxuICAgIGRvYy5vd25lclVpZCxcbiAgICBkb2Mub3duZXJFbWFpbCxcbiAgICBkb2MubmFtZSxcbiAgICBkb2MucGxhbm5lZERhdGUsXG4gICAgZG9jLm5vdGVzLFxuICAgIGRvYy5jcmVhdGVkQXQsXG4gICAgZG9jLnVwZGF0ZWRBdCxcbiAgXTtcbiAgY29uc3Qgc3RvcHMgPSBBcnJheS5pc0FycmF5KGRvYy5zdG9wcykgPyBkb2Muc3RvcHMgOiBbXTtcbiAgaWYgKCFzdG9wcy5sZW5ndGgpIHtcbiAgICByZXR1cm4gW2hlYWRlci5jb25jYXQoW251bGwsIG51bGwsIG51bGwsIG51bGwsIG51bGwsIG51bGwsIG51bGwsIG51bGxdKV07XG4gIH1cbiAgcmV0dXJuIHN0b3BzLm1hcCgoLyoqIEB0eXBlIHthbnl9ICovIHMpID0+XG4gICAgaGVhZGVyLmNvbmNhdChbXG4gICAgICBzID8gcy5vcmRlciA6IG51bGwsXG4gICAgICBzID8gcy5rZXkgOiBudWxsLFxuICAgICAgcyA/IHMudGlwbyA6IG51bGwsXG4gICAgICBzID8gcy5wcm92aW5jaWEgOiBudWxsLFxuICAgICAgcyA/IHMubG9jYWxpZGFkIDogbnVsbCxcbiAgICAgIHMgPyBzLmNsaWVudE5hbWUgOiBudWxsLFxuICAgICAgcyA/IHMuaXNQcm92aXNvcmlvIDogbnVsbCxcbiAgICAgIHMgPyBzLnNhcEFsdGFJZCA6IG51bGwsXG4gICAgXSlcbiAgKTtcbn1cblxuLyoqIEBwYXJhbSB7YW55fSBkb2MgQHJldHVybnMge3Vua25vd25bXVtdfSAqL1xuZXhwb3J0IGZ1bmN0aW9uIGJ1aWxkU2VndWltaWVudG9Ob3RlUm93cyhkb2MpIHtcbiAgcmV0dXJuIFtcbiAgICBbXG4gICAgICBkb2MuX2lkLFxuICAgICAgZG9jLnZlbmRvckV4dCxcbiAgICAgIGRvYy5jbGllbnRLZXksXG4gICAgICBkb2MuY2xpZW50TmFtZSxcbiAgICAgIGRvYy5wcm92aW5jZSxcbiAgICAgIGRvYy5sb2NhbGl0eSxcbiAgICAgIGRvYy50ZXh0LFxuICAgICAgZG9jLmF1dGhvclVpZCxcbiAgICAgIGRvYy5hdXRob3JFbWFpbCxcbiAgICAgIGRvYy5hdXRob3JOYW1lLFxuICAgICAgZG9jLmF1dGhvclJvbGUsXG4gICAgICBkb2MuY3JlYXRlZEF0LFxuICAgIF0sXG4gIF07XG59XG5cbi8qKlxuICogUHJvZHVjdG9zIGRlc2RlIHN0b2NrLmpzb24gKGZvcm1hdG8gU2hpbWFubzoge3N0b2NrOiB7U0tVOiBib29sLCAuLi59LFxuICogcXVhbnRpdGllczogSlNPTiBzdHJpbmcsIHdhcmVob3VzZUJyZWFrZG93bjogSlNPTiBzdHJpbmcsIHVwZGF0ZWRBdDogLi4ufSkuXG4gKiBAcGFyYW0ge29iamVjdH0gc3RvY2tKc29uXG4gKiBAcmV0dXJucyB7dW5rbm93bltdW119XG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBidWlsZFByb2R1Y3RvUm93c0Zyb21TdG9ja0pzb24oc3RvY2tKc29uKSB7XG4gIGNvbnN0IHNqID0gLyoqIEB0eXBlIHthbnl9ICovIChzdG9ja0pzb24pIHx8IHt9O1xuICBjb25zdCBzdG9ja01hcCA9IHNqLnN0b2NrIHx8IHt9O1xuICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIG51bWJlcj59ICovXG4gIGxldCBxdWFudGl0aWVzID0ge307XG4gIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmVjb3JkPHN0cmluZywgbnVtYmVyPj59ICovXG4gIGxldCBicmVha2Rvd24gPSB7fTtcbiAgdHJ5IHtcbiAgICBxdWFudGl0aWVzID0gc2oucXVhbnRpdGllcyA/IEpTT04ucGFyc2Uoc2oucXVhbnRpdGllcykgOiBzai5xdWFudGl0aWVzX21hcCB8fCB7fTtcbiAgfSBjYXRjaCAoXykge31cbiAgdHJ5IHtcbiAgICBicmVha2Rvd24gPSBzai53YXJlaG91c2VCcmVha2Rvd25cbiAgICAgID8gSlNPTi5wYXJzZShzai53YXJlaG91c2VCcmVha2Rvd24pXG4gICAgICA6IHNqLndhcmVob3VzZUJyZWFrZG93bl9tYXAgfHwge307XG4gIH0gY2F0Y2ggKF8pIHt9XG4gIGNvbnN0IHJvd3MgPSAvKiogQHR5cGUge3Vua25vd25bXVtdfSAqLyAoW10pO1xuICBjb25zdCBzb3VyY2UgPSAnc3RvY2suanNvbiBzbmFwc2hvdCc7XG4gIGNvbnN0IHVwZGF0ZWRBdCA9IHNqLnVwZGF0ZWRBdCB8fCBzai5zbmFwc2hvdEF0IHx8IG51bGw7XG4gIGZvciAoY29uc3Qgc2t1IG9mIE9iamVjdC5rZXlzKHN0b2NrTWFwKSkge1xuICAgIGNvbnN0IGhhc19zdG9jayA9ICEhc3RvY2tNYXBbc2t1XTtcbiAgICBjb25zdCB0b3RhbCA9IE51bWJlcihxdWFudGl0aWVzW3NrdV0gfHwgMCk7XG4gICAgY29uc3Qgd2JzID0gYnJlYWtkb3duW3NrdV0gfHwge307XG4gICAgY29uc3QgdzExID0gTnVtYmVyKHdic1snMTEnXSB8fCAwKTtcbiAgICBjb25zdCB3MTIgPSBOdW1iZXIod2JzWycxMiddIHx8IDApO1xuICAgIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgbnVtYmVyPn0gKi9cbiAgICBjb25zdCBvdHJvcyA9IHt9O1xuICAgIGZvciAoY29uc3QgayBvZiBPYmplY3Qua2V5cyh3YnMpKSB7XG4gICAgICBpZiAoayAhPT0gJzExJyAmJiBrICE9PSAnMTInKSBvdHJvc1trXSA9IE51bWJlcih3YnNba10gfHwgMCk7XG4gICAgfVxuICAgIHJvd3MucHVzaChbXG4gICAgICBza3UsXG4gICAgICBoYXNfc3RvY2ssXG4gICAgICB0b3RhbCxcbiAgICAgIHcxMSxcbiAgICAgIHcxMixcbiAgICAgIE9iamVjdC5rZXlzKG90cm9zKS5sZW5ndGggPyBvdHJvcyA6IG51bGwsXG4gICAgICBzb3VyY2UsXG4gICAgICB1cGRhdGVkQXQsXG4gICAgXSk7XG4gIH1cbiAgcmV0dXJuIHJvd3M7XG59XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gRGlzcGF0Y2hlcjogbWFwYSBjb2xsZWN0aW9uIC0+IHJvdyBidWlsZGVyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCAoZG9jOiBhbnkpID0+IHVua25vd25bXVtdPn0gKi9cbmV4cG9ydCBjb25zdCBST1dfQlVJTERFUlMgPSB7XG4gIHBlZGlkb3M6IGJ1aWxkUGVkaWRvUm93cyxcbiAgdmlzaXRhczogYnVpbGRWaXNpdGFSb3dzLFxuICBjbGllbnRlczogYnVpbGRDbGllbnRlUm93cyxcbiAgY2xpZW50X21hc3RlcjogYnVpbGRDbGllbnRNYXN0ZXJSb3dzLFxuICByZW5kaWNpb25lczogYnVpbGRSZW5kaWNpb25Sb3dzLFxuICBjYW1wYW5pYXM6IGJ1aWxkQ2FtcGFuaWFSb3dzLFxuICB0YXJnZXRzOiBidWlsZFRhcmdldFJvd3MsXG4gIHZlbmRvcl9vdmVycmlkZXM6IGJ1aWxkVmVuZG9yT3ZlcnJpZGVSb3dzLFxuICBjdXN0b21fcm91dGVzOiBidWlsZEN1c3RvbVJvdXRlUm93cyxcbiAgc2VndWltaWVudG9fbm90ZXM6IGJ1aWxkU2VndWltaWVudG9Ob3RlUm93cyxcbn07XG4iLCAiLy8gQHRzLW5vY2hlY2tcbi8vIEVYUE9SVFMtQURWQU5DRUQ6IHBob3RvIFpJUHMsIGF1ZGl0IFhMU1gsIGV4ZWN1dGl2ZSBzdW1tYXJ5LCB2aXNpdHMgWExTWCxcbi8vIFBvd2VyQkkgZGF0YXNldCwgTUwgZGF0YXNldC4gRXh0cmFcdTAwRURkbyB2ZXJiYXRpbSBkZSBpbmRleC5odG1sICg0IGZyYWdtZW50b3Ncbi8vIGRpc2NvbnRpbnVvcyBzZXBhcmFkb3MgcG9yIEJhY2t1cCArIEF1ZGl0ICsgX2V4cG9ydExlZ2FjeUZ1bGwgcXVlIHF1ZWRhblxuLy8gZW4gZWwgaW5saW5lKSBjb21vIHBhcnRlIGRlIEUyLm4uMiAoZTJiLXBlcmYgMjAyNi0wNy0yOCkuXG4vL1xuLy8gdjM3MSs6IGV4cG9ydERhdGFzZXRaaXAoKSBudWV2byBcdTIwMTQgWklQIGNvbiBDU1ZzIHBvciBlbnRpZGFkIHBhcmEgcGlwZWxpbmVzXG4vLyBNTCBleHRlcm5vcyAoTWljcm9zb2Z0IEZhYnJpYykuIEltcG9ydGEgbG9zIGhlbHBlcnMgcHVyb3MgeSBzY2hlbWFzIGRlbFxuLy8gbW9kdWxvIHNyYy9wdXJlL2Nzdi1zZXJpYWxpemVyLmpzLiBWZXIgcGxhbiBjb3NtaWMtcG9uZGVyaW5nLXN0ZWFybnMubWQuXG5cbmltcG9ydCB7XG4gIGJ1aWxkQ3N2LFxuICBidWlsZFByb2R1Y3RvUm93c0Zyb21TdG9ja0pzb24sXG4gIGNvbXB1dGVOdWxsUmF0ZXMsXG4gIERBVEFTRVRfU0NIRU1BUyxcbiAgREFUQVNFVF9VU0VfQ0FTRV9NQVRSSVgsXG4gIFJPV19CVUlMREVSUyxcbn0gZnJvbSAnLi4vcHVyZS9jc3Ytc2VyaWFsaXplci5qcyc7XG5cbi8vXG4vLyBEZXBzIGRlbCBpbmxpbmU6IEpTWmlwIChDRE4gbGF6eSksIEV4Y2VsSlMgKENETiBsYXp5IHZpYSBsb2FkRXhjZWxKUyksXG4vLyBYTFNYIChkZWZlciBlbiBoZWFkKSwgdmlzaXRzQ2FjaGUsIGNhbXBhaWduc0NhY2hlLCBvcHNMb2dDYWNoZSAoYXVkaXRcbi8vIGlubGluZSksIGF1ZGl0TG9nQ2FjaGUgKGF1ZGl0IGlubGluZSksIGNvbnRhY3RlZCAoZ2xvYmFsIFNldCksIFBPSU5UUyxcbi8vIFBST0RVQ1RTLCBWRU5ET1JTLCBNRVNFUywgdmVuZG9yTG9va3VwLCBlc2NhcGVIdG1sLCBlc2NhcGVBdHRyLCB0aXRsZUNhc2UsXG4vLyBzaG93U3luY1RhZywgY3VycmVudFVzZXIsIHVzZXJSb2xlLCBvcmRlcnMsIGNvbmZpcm1lZCwgcGVuZGluZy5cbi8vXG4vLyBDcm9zcy1zY29wZSBzdGF0ZTogTk9ORSAodG9kb3MgbG9zIGhlbHBlcnMgeSBjb25zdHMgbG9jYWxlcyBhbCBibG9xdWUpLlxuLy8gU2luIGxpc3RlbmVycyBvblNuYXBzaG90LlxuLy9cbi8vIE5PVEE6IGxvcyBoZWxwZXJzIHRvZGF5U3RyL2RhdGFVcmxUb0Jsb2Ivc2FuaXRpemVGb3JQYXRoIHZpdmVuIGVuIGVzdGVcbi8vIG1cdTAwRjNkdWxvIFx1MjAxNCBlbCBpbmxpbmUgcHVlZGUgbGxhbWFybG9zIHZpYSBmcmVlIHJlZmVyZW5jZSBhbCBHbG9iYWwgRW52aXJvbm1lbnRcbi8vIFJlY29yZCBwZXJvIHByZWZlcmltb3MgZXhwb3NpY2lcdTAwRjNuIHdpbmRvdy4qIGV4cGxcdTAwRURjaXRhIGFsIGZpbmFsLlxuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gU0VDQ0lcdTAwRDNOOiBoZWxwZXJzICsgcGhvdG9zIHppcCArIHZpc2l0cyBlbWJlZGRlZCAoaW5saW5lIEw5MjU2LTk0NDUpXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuZnVuY3Rpb24gdG9kYXlTdHIoKSB7XG4gIHJldHVybiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwgMTApO1xufVxuXG4vLyBIZWxwZXI6IGNvbnZlcnRpciBkYXRhVVJMIGJhc2U2NCBhIEJsb2IgcGFyYSBpbmNsdWlyIGVuIFpJUFxuZnVuY3Rpb24gZGF0YVVybFRvQmxvYihkYXRhVXJsKSB7XG4gIGlmICghZGF0YVVybCkgcmV0dXJuIG51bGw7XG4gIGNvbnN0IHBhcnRzID0gZGF0YVVybC5zcGxpdCgnLCcpO1xuICBpZiAocGFydHMubGVuZ3RoIDwgMikgcmV0dXJuIG51bGw7XG4gIGNvbnN0IG1pbWVNYXRjaCA9IHBhcnRzWzBdLm1hdGNoKC86KC4qPyk7Lyk7XG4gIGNvbnN0IG1pbWUgPSBtaW1lTWF0Y2ggPyBtaW1lTWF0Y2hbMV0gOiAnaW1hZ2UvanBlZyc7XG4gIGNvbnN0IGJ5dGVzID0gYXRvYihwYXJ0c1sxXSk7XG4gIGNvbnN0IGFyciA9IG5ldyBVaW50OEFycmF5KGJ5dGVzLmxlbmd0aCk7XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgYnl0ZXMubGVuZ3RoOyBpKyspIGFycltpXSA9IGJ5dGVzLmNoYXJDb2RlQXQoaSk7XG4gIHJldHVybiBuZXcgQmxvYihbYXJyXSwgeyB0eXBlOiBtaW1lIH0pO1xufVxuXG4vLyBTYW5lYXIgbm9tYnJlcyBwYXJhIHF1ZSBzaXJ2YW4gY29tbyBydXRhIGRlIGFyY2hpdm9cbmZ1bmN0aW9uIHNhbml0aXplRm9yUGF0aChzKSB7XG4gIHJldHVybiBTdHJpbmcocyB8fCAnJylcbiAgICAucmVwbGFjZSgvW1xcXFwvKj9bXFxdOnxcIjw+XS9nLCAnXycpXG4gICAgLnJlcGxhY2UoL1xccysvZywgJyAnKVxuICAgIC50cmltKClcbiAgICAuc2xpY2UoMCwgNjApO1xufVxuXG4vLyBEZXNjYXJnYXIgdG9kYXMgbGFzIGZvdG9zIGRlIHZpc2l0YXMgZW4gdW4gWklQIG9yZ2FuaXphZG8gcG9yIHZlbmRlZG9yIC8gdGllbmRhIC8gZmVjaGFcbndpbmRvdy5leHBvcnRQaG90b3NaaXAgPSBhc3luYyBmdW5jdGlvbiAoKSB7XG4gIGlmICh0eXBlb2YgSlNaaXAgPT09ICd1bmRlZmluZWQnKSB7XG4gICAgYWxlcnQoJ0NhcmdhbmRvIGxpYnJlcmlhIFpJUCwgaW50ZW50YSBkZSBudWV2byBlbiA1IHNlZ3VuZG9zLicpO1xuICAgIHJldHVybjtcbiAgfVxuICBpZiAoIXZpc2l0c0NhY2hlIHx8ICF2aXNpdHNDYWNoZS5sZW5ndGgpIHtcbiAgICBhbGVydCgnTm8gaGF5IHZpc2l0YXMgcmVnaXN0cmFkYXMuJyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGxldCBwaG90b0NvdW50ID0gMDtcbiAgY29uc3QgemlwID0gbmV3IEpTWmlwKCk7XG4gIHZpc2l0c0NhY2hlLmZvckVhY2goKHYpID0+IHtcbiAgICBjb25zdCB2ZW5kb3IgPSBzYW5pdGl6ZUZvclBhdGgodGl0bGVDYXNlKHYudmVuZG9yIHx8ICdTSU5fVkVOREVET1InKSk7XG4gICAgY29uc3QgdGllbmRhID0gc2FuaXRpemVGb3JQYXRoKHYudGllbmRhIHx8ICdzaW5fdGllbmRhJyk7XG4gICAgY29uc3QgZmVjaGEgPSAodi5mZWNoYSB8fCAnJykucmVwbGFjZSgvLS9nLCAnJyk7XG4gICAgY29uc3QgZm9sZGVyTmFtZSA9IHZlbmRvciArICcvJyArIHRpZW5kYSArICdfJyArIGZlY2hhO1xuICAgIGNvbnN0IGZvbGRlciA9IHppcC5mb2xkZXIoZm9sZGVyTmFtZSk7XG4gICAgaWYgKHYuZnJlbnRlTG9jYWwpIHtcbiAgICAgIGNvbnN0IGIgPSBkYXRhVXJsVG9CbG9iKHYuZnJlbnRlTG9jYWwpO1xuICAgICAgaWYgKGIpIHtcbiAgICAgICAgZm9sZGVyLmZpbGUoJ2ZyZW50ZS5qcGcnLCBiKTtcbiAgICAgICAgcGhvdG9Db3VudCsrO1xuICAgICAgfVxuICAgIH1cbiAgICAodi5lc3BhY2lvIHx8IFtdKS5mb3JFYWNoKChiNjQsIGkpID0+IHtcbiAgICAgIGNvbnN0IGIgPSBkYXRhVXJsVG9CbG9iKGI2NCk7XG4gICAgICBpZiAoYikge1xuICAgICAgICBmb2xkZXIuZmlsZSgnZXNwYWNpb18nICsgKGkgKyAxKSArICcuanBnJywgYik7XG4gICAgICAgIHBob3RvQ291bnQrKztcbiAgICAgIH1cbiAgICB9KTtcbiAgfSk7XG4gIGlmICghcGhvdG9Db3VudCkge1xuICAgIGFsZXJ0KCdObyBoYXkgZm90b3MgY2FyZ2FkYXMgZW4gbGFzIHZpc2l0YXMuJyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIHNob3dTeW5jVGFnKCdHZW5lcmFuZG8gWklQIGRlICcgKyBwaG90b0NvdW50ICsgJyBmb3Rvcy4uLicsIDMwMDAwKTtcbiAgdHJ5IHtcbiAgICBjb25zdCBibG9iID0gYXdhaXQgemlwLmdlbmVyYXRlQXN5bmMoeyB0eXBlOiAnYmxvYicsIGNvbXByZXNzaW9uOiAnREVGTEFURScgfSk7XG4gICAgY29uc3QgdXJsID0gVVJMLmNyZWF0ZU9iamVjdFVSTChibG9iKTtcbiAgICBjb25zdCBhID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnYScpO1xuICAgIGEuaHJlZiA9IHVybDtcbiAgICBhLmRvd25sb2FkID0gJ1NoaW1hbm9fRm90b3NfVmlzaXRhc18nICsgdG9kYXlTdHIoKSArICcuemlwJztcbiAgICBhLmNsaWNrKCk7XG4gICAgc2V0VGltZW91dCgoKSA9PiBVUkwucmV2b2tlT2JqZWN0VVJMKHVybCksIDUwMDApO1xuICAgIHNob3dTeW5jVGFnKHBob3RvQ291bnQgKyAnIGZvdG9zIGRlc2NhcmdhZGFzJywgMzAwMCk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBjb25zb2xlLmVycm9yKCd6aXAnLCBlKTtcbiAgICBhbGVydCgnRXJyb3IgZ2VuZXJhbmRvIFpJUDogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xuICB9XG59O1xuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIEV4Y2VsIGNvbiBmb3RvcyBkZWwgZnJlbnRlIGVtYmViaWRhcyBlbiBjYWRhIGNlbGRhIChFeGNlbEpTKVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBFeGNlbEpTIHNlIGNhcmdhIGxhenkgKHNvbG8gY3VhbmRvIHNlIHRvY2EgZWwgYm90b24pIHBhcmEgbm8gaW5mbGFyIGVsIGJ1bmRsZS5cbmZ1bmN0aW9uIGxvYWRFeGNlbEpTKCkge1xuICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgIGlmICh0eXBlb2YgRXhjZWxKUyAhPT0gJ3VuZGVmaW5lZCcpIHJldHVybiByZXNvbHZlKCk7XG4gICAgY29uc3QgcyA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3NjcmlwdCcpO1xuICAgIHMuc3JjID0gJ2h0dHBzOi8vY2RuLmpzZGVsaXZyLm5ldC9ucG0vZXhjZWxqc0A0LjQuMC9kaXN0L2V4Y2VsanMubWluLmpzJztcbiAgICBzLm9ubG9hZCA9ICgpID0+IHJlc29sdmUoKTtcbiAgICBzLm9uZXJyb3IgPSAoKSA9PlxuICAgICAgcmVqZWN0KG5ldyBFcnJvcignTm8gc2UgcHVkbyBjYXJnYXIgbGEgbGlicmVyaWEgRXhjZWxKUy4gUmV2aXNhIHR1IGNvbmV4aW9uIGEgaW50ZXJuZXQuJykpO1xuICAgIGRvY3VtZW50LmhlYWQuYXBwZW5kQ2hpbGQocyk7XG4gIH0pO1xufVxuXG53aW5kb3cuZXhwb3J0VmlzaXRzV2l0aEVtYmVkZGVkUGhvdG9zID0gYXN5bmMgZnVuY3Rpb24gKCkge1xuICBpZiAoIXZpc2l0c0NhY2hlIHx8ICF2aXNpdHNDYWNoZS5sZW5ndGgpIHtcbiAgICBhbGVydCgnTm8gaGF5IHZpc2l0YXMgcmVnaXN0cmFkYXMuJyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGNvbnN0IG4gPSB2aXNpdHNDYWNoZS5sZW5ndGg7XG4gIGlmIChuID4gMzAwKSB7XG4gICAgaWYgKFxuICAgICAgIWNvbmZpcm0oXG4gICAgICAgICdIYXkgJyArXG4gICAgICAgICAgbiArXG4gICAgICAgICAgJyB2aXNpdGFzLiBFbCBFeGNlbCBjb24gdG9kYXMgbGFzIGZvdG9zIGVtYmViaWRhcyBwdWVkZSBwZXNhciA1MC0xNTAgTUIgeSB0YXJkYXIgdmFyaW9zIG1pbnV0b3MuIFx1MDBCRkNvbnRpbnVhcj8nXG4gICAgICApXG4gICAgKVxuICAgICAgcmV0dXJuO1xuICB9IGVsc2UgaWYgKG4gPiAxMDApIHtcbiAgICBpZiAoXG4gICAgICAhY29uZmlybShcbiAgICAgICAgJ1ZhcyBhIGdlbmVyYXIgdW4gRXhjZWwgY29uICcgK1xuICAgICAgICAgIG4gK1xuICAgICAgICAgICcgdmlzaXRhcyB5IHN1cyBmb3RvcyBlbWJlYmlkYXMuIFB1ZWRlIHRhcmRhciAzMC02MCBzZWd1bmRvcy4gXHUwMEJGQ29udGludWFyPydcbiAgICAgIClcbiAgICApXG4gICAgICByZXR1cm47XG4gIH1cbiAgc2hvd1N5bmNUYWcoJ0NhcmdhbmRvIEV4Y2VsSlMuLi4nLCAyMDAwKTtcbiAgdHJ5IHtcbiAgICBhd2FpdCBsb2FkRXhjZWxKUygpO1xuICB9IGNhdGNoIChlKSB7XG4gICAgYWxlcnQoZS5tZXNzYWdlIHx8IGUpO1xuICAgIHJldHVybjtcbiAgfVxuXG4gIHNob3dTeW5jVGFnKCdHZW5lcmFuZG8gRXhjZWwgY29uICcgKyBuICsgJyB2aXNpdGFzLi4uJywgMzAwMCk7XG5cbiAgY29uc3Qgd2IgPSBuZXcgRXhjZWxKUy5Xb3JrYm9vaygpO1xuICB3Yi5jcmVhdG9yID0gJ0FwcCBWZW5kZWRvcmVzIFNoaW1hbm8nO1xuICB3Yi5jcmVhdGVkID0gbmV3IERhdGUoKTtcbiAgY29uc3Qgd3MgPSB3Yi5hZGRXb3Jrc2hlZXQoJ1Zpc2l0YXMnLCB7IHZpZXdzOiBbeyBzdGF0ZTogJ2Zyb3plbicsIHlTcGxpdDogMSB9XSB9KTtcblxuICAvLyBEZWZpbmljaW9uIGRlIGNvbHVtbmFzLiBMYSBjb2x1bW5hIGRlIGZvdG8gdmEgYSB0ZW5lciBhbmNobyBleHRyYSBwYXJhIHF1ZSBzZSB2ZWEuXG4gIHdzLmNvbHVtbnMgPSBbXG4gICAgeyBoZWFkZXI6ICdGZWNoYScsIGtleTogJ2ZlY2hhJywgd2lkdGg6IDEyIH0sXG4gICAgeyBoZWFkZXI6ICdNZXMnLCBrZXk6ICdtZXMnLCB3aWR0aDogMTAgfSxcbiAgICB7IGhlYWRlcjogJ1ZlbmRlZG9yJywga2V5OiAndmVuZGVkb3InLCB3aWR0aDogMjIgfSxcbiAgICB7IGhlYWRlcjogJ1RpcG8gY29udGFjdG8nLCBrZXk6ICd0aXBvQ3QnLCB3aWR0aDogMTIgfSxcbiAgICB7IGhlYWRlcjogJ0NvbWVudGFyaW8nLCBrZXk6ICdjb21lbnQnLCB3aWR0aDogMzIgfSxcbiAgICB7IGhlYWRlcjogJ1Byb3ZpbmNpYScsIGtleTogJ3Byb3ZpbmNpYScsIHdpZHRoOiAxNiB9LFxuICAgIHsgaGVhZGVyOiAnTG9jYWxpZGFkJywga2V5OiAnbG9jYWxpZGFkJywgd2lkdGg6IDE4IH0sXG4gICAgeyBoZWFkZXI6ICdUaWVuZGEnLCBrZXk6ICd0aWVuZGEnLCB3aWR0aDogMzAgfSxcbiAgICB7IGhlYWRlcjogJ1RpcG8nLCBrZXk6ICd0aXBvJywgd2lkdGg6IDEyIH0sXG4gICAgeyBoZWFkZXI6ICdMb2NhbCcsIGtleTogJ2xvY2FsJywgd2lkdGg6IDEyIH0sXG4gICAgeyBoZWFkZXI6ICdUYW1hbm8nLCBrZXk6ICd0YW1hbm8nLCB3aWR0aDogMTAgfSxcbiAgICB7IGhlYWRlcjogJ0ZpZGVsaWRhZCcsIGtleTogJ2ZpZGVsaWRhZCcsIHdpZHRoOiAxMCB9LFxuICAgIHsgaGVhZGVyOiAnUmVsZXZhbmNpYScsIGtleTogJ3JlbGV2Jywgd2lkdGg6IDEwIH0sXG4gICAgeyBoZWFkZXI6ICdQT1AnLCBrZXk6ICdwb3AnLCB3aWR0aDogOCB9LFxuICAgIHsgaGVhZGVyOiAnVGlwbyB2ZW50YScsIGtleTogJ3RpcG9WZW50YScsIHdpZHRoOiAxMiB9LFxuICAgIHsgaGVhZGVyOiAnQ29tcGV0ZW5jaWEnLCBrZXk6ICdjb21wZScsIHdpZHRoOiAxNiB9LFxuICAgIHsgaGVhZGVyOiAnT3BvcnR1bmlkYWQnLCBrZXk6ICdvcG9ydHUnLCB3aWR0aDogMzAgfSxcbiAgICB7IGhlYWRlcjogJ0xvIG1hcyB2ZW5kaWRvJywga2V5OiAnbWFzVmUnLCB3aWR0aDogMjggfSxcbiAgICB7IGhlYWRlcjogJ0dQUyBkaXN0IChtKScsIGtleTogJ2dwc0Rpc3QnLCB3aWR0aDogMTIgfSxcbiAgICB7IGhlYWRlcjogJ0ZvdG8gZnJlbnRlJywga2V5OiAnZm90bycsIHdpZHRoOiAyMiB9LCAvLyA8LSBsYSBpbWFnZW4gdmEgYWNhXG4gICAgeyBoZWFkZXI6ICdFbWFpbCB2ZW5kZWRvcicsIGtleTogJ2VtYWlsJywgd2lkdGg6IDI4IH0sXG4gIF07XG5cbiAgLy8gRXN0aWxvIGhlYWRlclxuICB3cy5nZXRSb3coMSkuZm9udCA9IHsgYm9sZDogdHJ1ZSwgY29sb3I6IHsgYXJnYjogJ0ZGRkZGRkZGJyB9IH07XG4gIHdzLmdldFJvdygxKS5maWxsID0geyB0eXBlOiAncGF0dGVybicsIHBhdHRlcm46ICdzb2xpZCcsIGZnQ29sb3I6IHsgYXJnYjogJ0ZGMEM0QTZFJyB9IH07XG4gIHdzLmdldFJvdygxKS5hbGlnbm1lbnQgPSB7IHZlcnRpY2FsOiAnbWlkZGxlJywgaG9yaXpvbnRhbDogJ2NlbnRlcicgfTtcbiAgd3MuZ2V0Um93KDEpLmhlaWdodCA9IDIyO1xuXG4gIGNvbnN0IEZPVE9fQ09MX0lEWCA9IHdzLmdldENvbHVtbignZm90bycpLm51bWJlciAtIDE7IC8vIDAtaW5kZXhlZCBwYXJhIGFkZEltYWdlXG4gIGNvbnN0IFJPV19IID0gMTAwO1xuICBjb25zdCBJTUdfVyA9IDEzMDtcbiAgY29uc3QgSU1HX0ggPSA5MDtcblxuICAvLyBPcmRlbmFyIHZpc2l0YXMgcG9yIGZlY2hhIGRlc2MgKG1hcyByZWNpZW50ZXMgcHJpbWVybylcbiAgY29uc3Qgc29ydGVkID0gdmlzaXRzQ2FjaGUuc2xpY2UoKS5zb3J0KChhLCBiKSA9PiAoYi5mZWNoYSB8fCAnJykubG9jYWxlQ29tcGFyZShhLmZlY2hhIHx8ICcnKSk7XG5cbiAgZm9yIChjb25zdCB2IG9mIHNvcnRlZCkge1xuICAgIGNvbnN0IHRpcG9Db250YWN0b0xibCA9IHYudGlwb0NvbnRhY3RvID09PSAndGVsZWZvbm8nID8gJ1RlbGVmb25vJyA6ICdQcmVzZW5jaWFsJztcbiAgICBjb25zdCByID0gd3MuYWRkUm93KHtcbiAgICAgIGZlY2hhOiB2LmZlY2hhIHx8ICcnLFxuICAgICAgbWVzOiB2Lm1lcyB8fCAnJyxcbiAgICAgIHZlbmRlZG9yOiB0aXRsZUNhc2Uodi52ZW5kb3IgfHwgJycpLFxuICAgICAgdGlwb0N0OiB0aXBvQ29udGFjdG9MYmwsXG4gICAgICBjb21lbnQ6IHYuY29tZW50YXJpbyB8fCAnJyxcbiAgICAgIHByb3ZpbmNpYTogdGl0bGVDYXNlKHYucHJvdmluY2lhIHx8ICcnKSxcbiAgICAgIGxvY2FsaWRhZDogdi5sb2NhbGlkYWQgfHwgJycsXG4gICAgICB0aWVuZGE6IHYudGllbmRhIHx8ICcnLFxuICAgICAgdGlwbzogdi50aXBvIHx8ICcnLFxuICAgICAgbG9jYWw6IHYubG9jYWwgfHwgJycsXG4gICAgICB0YW1hbm86IHYudGFtYW5vIHx8ICcnLFxuICAgICAgZmlkZWxpZGFkOiB2LmZpZGVsaWRhZCB8fCAnJyxcbiAgICAgIHJlbGV2OiB2LnJlbGV2YW5jaWEgfHwgJycsXG4gICAgICBwb3A6IHYucG9wIHx8ICcnLFxuICAgICAgdGlwb1ZlbnRhOiB2LnRpcG9WZW50YSA9PT0gJ01PU1RSQURPJyA/ICdNT1NUUkFET1InIDogdi50aXBvVmVudGEgfHwgJycsXG4gICAgICBjb21wZTogdi5jb21wZXRlbmNpYSB8fCAnJyxcbiAgICAgIG9wb3J0dTogdi5vcG9ydHVuaWRhZCB8fCAnJyxcbiAgICAgIG1hc1ZlOiB2Lm1hc1ZlbmRpZG8gfHwgJycsXG4gICAgICBncHNEaXN0OiB0eXBlb2Ygdi5ncHNEaXN0YW5jZU0gPT09ICdudW1iZXInID8gdi5ncHNEaXN0YW5jZU0gOiAnJyxcbiAgICAgIGZvdG86ICcnLCAvLyBsYSBjZWxkYSBxdWVkYSB2YWNpYTsgZW5jaW1hIHZhIGxhIGltYWdlblxuICAgICAgZW1haWw6IHYub3duZXJFbWFpbCB8fCAnJyxcbiAgICB9KTtcbiAgICByLmhlaWdodCA9IFJPV19IO1xuICAgIHIuYWxpZ25tZW50ID0geyB2ZXJ0aWNhbDogJ21pZGRsZScsIHdyYXBUZXh0OiB0cnVlIH07XG4gICAgaWYgKHYuZnJlbnRlTG9jYWwgJiYgdHlwZW9mIHYuZnJlbnRlTG9jYWwgPT09ICdzdHJpbmcnKSB7XG4gICAgICB0cnkge1xuICAgICAgICAvLyBFbCBjYW1wbyBlcyB1biBkYXRhVVJMOiAnZGF0YTppbWFnZS9qcGVnO2Jhc2U2NCwvOWovNEFBUS4uLidcbiAgICAgICAgbGV0IGI2NCA9IHYuZnJlbnRlTG9jYWw7XG4gICAgICAgIGxldCBleHQgPSAnanBlZyc7XG4gICAgICAgIGNvbnN0IG0gPSAvXmRhdGE6aW1hZ2VcXC8oXFx3Kyk7YmFzZTY0LCguKykkL2kuZXhlYyhiNjQpO1xuICAgICAgICBpZiAobSkge1xuICAgICAgICAgIGV4dCA9IG1bMV0udG9Mb3dlckNhc2UoKTtcbiAgICAgICAgICBiNjQgPSBtWzJdO1xuICAgICAgICB9XG4gICAgICAgIGlmIChleHQgPT09ICdqcGcnKSBleHQgPSAnanBlZyc7XG4gICAgICAgIGNvbnN0IGltYWdlSWQgPSB3Yi5hZGRJbWFnZSh7IGJhc2U2NDogYjY0LCBleHRlbnNpb246IGV4dCB9KTtcbiAgICAgICAgd3MuYWRkSW1hZ2UoaW1hZ2VJZCwge1xuICAgICAgICAgIHRsOiB7IGNvbDogRk9UT19DT0xfSURYICsgMC4xLCByb3c6IHIubnVtYmVyIC0gMSArIDAuMSB9LFxuICAgICAgICAgIGV4dDogeyB3aWR0aDogSU1HX1csIGhlaWdodDogSU1HX0ggfSxcbiAgICAgICAgICBlZGl0QXM6ICdvbmVDZWxsJyxcbiAgICAgICAgfSk7XG4gICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgIGNvbnNvbGUud2FybignZW1iZWJpZW5kbyBmb3RvIGZpbGEnLCByLm51bWJlciwgZSk7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLy8gR2VuZXJhciB5IGRlc2NhcmdhclxuICB0cnkge1xuICAgIGNvbnN0IGJ1ZmZlciA9IGF3YWl0IHdiLnhsc3gud3JpdGVCdWZmZXIoKTtcbiAgICBjb25zdCBibG9iID0gbmV3IEJsb2IoW2J1ZmZlcl0sIHtcbiAgICAgIHR5cGU6ICdhcHBsaWNhdGlvbi92bmQub3BlbnhtbGZvcm1hdHMtb2ZmaWNlZG9jdW1lbnQuc3ByZWFkc2hlZXRtbC5zaGVldCcsXG4gICAgfSk7XG4gICAgY29uc3QgdXJsID0gVVJMLmNyZWF0ZU9iamVjdFVSTChibG9iKTtcbiAgICBjb25zdCBhID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnYScpO1xuICAgIGEuaHJlZiA9IHVybDtcbiAgICBhLmRvd25sb2FkID0gJ1NoaW1hbm9fVmlzaXRhc19jb25fZm90b3NfJyArIHRvZGF5U3RyKCkgKyAnLnhsc3gnO1xuICAgIGRvY3VtZW50LmJvZHkuYXBwZW5kQ2hpbGQoYSk7XG4gICAgYS5jbGljaygpO1xuICAgIGRvY3VtZW50LmJvZHkucmVtb3ZlQ2hpbGQoYSk7XG4gICAgc2V0VGltZW91dCgoKSA9PiBVUkwucmV2b2tlT2JqZWN0VVJMKHVybCksIDUwMDApO1xuICAgIHNob3dTeW5jVGFnKCdFeGNlbCBkZXNjYXJnYWRvOiAnICsgc29ydGVkLmxlbmd0aCArICcgdmlzaXRhcycsIDMwMDApO1xuICB9IGNhdGNoIChlKSB7XG4gICAgY29uc29sZS5lcnJvcignZXhwb3J0VmlzaXRzV2l0aEVtYmVkZGVkUGhvdG9zJywgZSk7XG4gICAgYWxlcnQoJ0Vycm9yIGdlbmVyYW5kbyBlbCBFeGNlbDogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xuICB9XG59O1xuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gU0VDQ0lcdTAwRDNOOiBleHBvcnRBdWRpdEV4Y2VsIChpbmxpbmUgTDEwMDQwLTEwMDY3KVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbndpbmRvdy5leHBvcnRBdWRpdEV4Y2VsID0gZnVuY3Rpb24gKCkge1xuICBpZiAodHlwZW9mIFhMU1ggPT09ICd1bmRlZmluZWQnKSB7XG4gICAgYWxlcnQoJ0xhIGxpYnJlcmlhIGRlIEV4Y2VsIG5vIHNlIGNhcmdvLicpO1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCBpdGVtcyA9IGdldEZpbHRlcmVkQXVkaXRFbnRyaWVzKCk7XG4gIGlmICghaXRlbXMubGVuZ3RoKSB7XG4gICAgYWxlcnQoJ05vIGhheSBldmVudG9zIHBhcmEgZXhwb3J0YXIgY29uIGxvcyBmaWx0cm9zIGFwbGljYWRvcy4nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgY29uc3Qgcm93cyA9IGl0ZW1zLm1hcCgoZSkgPT4ge1xuICAgIGNvbnN0IHRzID0gZS50aW1lc3RhbXAgJiYgZS50aW1lc3RhbXAudG9EYXRlID8gZS50aW1lc3RhbXAudG9EYXRlKCkgOiBudWxsO1xuICAgIHJldHVybiB7XG4gICAgICBGZWNoYV9Ib3JhOiB0cyA/IHRzLnRvSVNPU3RyaW5nKCkucmVwbGFjZSgnVCcsICcgJykuc2xpY2UoMCwgMTkpIDogJycsXG4gICAgICBVc3VhcmlvX0VtYWlsOiBlLnVzZXJFbWFpbCB8fCAnJyxcbiAgICAgIFVzdWFyaW9fVUlEOiBlLnVzZXJVaWQgfHwgJycsXG4gICAgICBSb2w6IGUudXNlclJvbGUgfHwgJycsXG4gICAgICBBY2Npb246IEFVRElUX0FDVElPTl9MQUJFTFNbZS5hY3Rpb25dIHx8IGUuYWN0aW9uIHx8ICcnLFxuICAgICAgQWNjaW9uX1JhdzogZS5hY3Rpb24gfHwgJycsXG4gICAgICBUaXBvX0VudGlkYWQ6IGUuZW50aXR5VHlwZSB8fCAnJyxcbiAgICAgIEVudGlkYWQ6IGUuZW50aXR5TmFtZSB8fCAnJyxcbiAgICAgIERldGFsbGVzX0pTT046IGUuZGV0YWlscyA/IEpTT04uc3RyaW5naWZ5KGUuZGV0YWlscykgOiAnJyxcbiAgICB9O1xuICB9KTtcbiAgY29uc3Qgd2IgPSBYTFNYLnV0aWxzLmJvb2tfbmV3KCk7XG4gIGNvbnN0IHdzID0gWExTWC51dGlscy5qc29uX3RvX3NoZWV0KHJvd3MpO1xuICB3c1snIWNvbHMnXSA9IFtcbiAgICB7IHdjaDogMjAgfSxcbiAgICB7IHdjaDogMzAgfSxcbiAgICB7IHdjaDogMzAgfSxcbiAgICB7IHdjaDogMTAgfSxcbiAgICB7IHdjaDogMjQgfSxcbiAgICB7IHdjaDogMjAgfSxcbiAgICB7IHdjaDogMTQgfSxcbiAgICB7IHdjaDogNDAgfSxcbiAgICB7IHdjaDogNjAgfSxcbiAgXTtcbiAgWExTWC51dGlscy5ib29rX2FwcGVuZF9zaGVldCh3Yiwgd3MsICdBdWRpdG9yaWEnKTtcbiAgY29uc3Qgc3RhbXAgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwgMTApO1xuICBYTFNYLndyaXRlRmlsZSh3YiwgJ1NoaW1hbm9fQXVkaXRvcmlhXycgKyBzdGFtcCArICcueGxzeCcpO1xufTtcblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIFNFQ0NJXHUwMEQzTjogYnVpbGRDb250YWN0YWRvc1Jvd3MvT3BzTG9nL1Zpc2l0IChpbmxpbmUgTDEwMDgxLTEwMTU1KVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbi8vIExpc3RhIGNvbXBsZXRhIGRlIGNvbnRhY3RhZG9zIChjbGllbnRlcy9wcm9zcGVjdG9zIG1hcmNhZG9zIGNvbiBjaGVjaylcbmZ1bmN0aW9uIGJ1aWxkQ29udGFjdGFkb3NSb3dzKCkge1xuICBjb25zdCByb3dzID0gW107XG4gIGNvbnRhY3RlZC5mb3JFYWNoKChrZXkpID0+IHtcbiAgICBjb25zdCBwYXJ0cyA9IGtleS5zcGxpdCgnfCcpO1xuICAgIGNvbnN0IHRpcG8gPSBwYXJ0c1swXSxcbiAgICAgIHByb3ZpbmNlID0gcGFydHNbMV0sXG4gICAgICBsb2NOYW1lID0gcGFydHNbMl0sXG4gICAgICBjbGllbnROYW1lID0gcGFydHNbM107XG4gICAgY29uc3QgcHQgPSBQT0lOVFMuZmluZCgocCkgPT4gcC5wcm92aW5jZSA9PT0gcHJvdmluY2UgJiYgcC5uYW1lID09PSBsb2NOYW1lKTtcbiAgICBjb25zdCB2ZW5kb3IgPSBwdCA/IHB0LnZlbmRvciA6ICcnO1xuICAgIGNvbnN0IHZtID0gdmVuZG9yTG9va3VwW3ZlbmRvcl07XG4gICAgcm93cy5wdXNoKHtcbiAgICAgIFRpcG86IHRpcG8gPT09ICdDJyA/ICdDbGllbnRlIGFjdHVhbCcgOiAnUHJvc3BlY3RvJyxcbiAgICAgIENsaWVudGU6IGNsaWVudE5hbWUsXG4gICAgICBQcm92aW5jaWE6IHRpdGxlQ2FzZShwcm92aW5jZSksXG4gICAgICBMb2NhbGlkYWQ6IGxvY05hbWUsXG4gICAgICBEZXBhcnRhbWVudG86IHB0ID8gcHQuZGVwdCB8fCAnJyA6ICcnLFxuICAgICAgVmVuZGVkb3I6IHRpdGxlQ2FzZSh2ZW5kb3IgfHwgJycpLFxuICAgICAgWm9uYTogdm0gPyB2bS56b25lIDogJycsXG4gICAgICBDb250YWN0YWRvOiAnU2knLFxuICAgIH0pO1xuICB9KTtcbiAgcm93cy5zb3J0KFxuICAgIChhLCBiKSA9PlxuICAgICAgYS5WZW5kZWRvci5sb2NhbGVDb21wYXJlKGIuVmVuZGVkb3IpIHx8XG4gICAgICBhLlByb3ZpbmNpYS5sb2NhbGVDb21wYXJlKGIuUHJvdmluY2lhKSB8fFxuICAgICAgYS5DbGllbnRlLmxvY2FsZUNvbXBhcmUoYi5DbGllbnRlKVxuICApO1xuICByZXR1cm4gcm93cztcbn1cblxuLy8gTG9nIGRlIG9wZXJhY2lvbmVzIChjYW5jZWxhY2lvbmVzLCBlbGltaW5hY2lvbmVzLCB2dWVsdmUtYS1ib3JyYWRvciwgZXRjLilcbmZ1bmN0aW9uIGJ1aWxkT3BzTG9nUm93cygpIHtcbiAgcmV0dXJuIChvcHNMb2dDYWNoZSB8fCBbXSkubWFwKChvKSA9PiAoe1xuICAgIEZlY2hhOiBvLnRpbWVzdGFtcFxuICAgICAgPyBvLnRpbWVzdGFtcC50b0RhdGVcbiAgICAgICAgPyBvLnRpbWVzdGFtcC50b0RhdGUoKS50b0xvY2FsZVN0cmluZygpXG4gICAgICAgIDogbmV3IERhdGUoby50aW1lc3RhbXApLnRvTG9jYWxlU3RyaW5nKClcbiAgICAgIDogJycsXG4gICAgVXN1YXJpbzogby51c2VyRW1haWwgfHwgJycsXG4gICAgUm9sOiBvLnVzZXJSb2xlIHx8ICcnLFxuICAgIEFjY2lvbjogby5hY3Rpb24gfHwgJycsXG4gICAgJ1RpcG8gZW50aWRhZCc6IG8uZW50aXR5VHlwZSB8fCAnJyxcbiAgICBFbnRpZGFkOiBvLmVudGl0eU5hbWUgfHwgJycsXG4gICAgRGV0YWxsZXM6IHR5cGVvZiBvLmRldGFpbHMgPT09ICdvYmplY3QnID8gSlNPTi5zdHJpbmdpZnkoby5kZXRhaWxzKSA6IG8uZGV0YWlscyB8fCAnJyxcbiAgfSkpO1xufVxuXG5mdW5jdGlvbiBidWlsZFZpc2l0Um93cygpIHtcbiAgcmV0dXJuIHZpc2l0c0NhY2hlLm1hcCgodikgPT4gKHtcbiAgICBGZWNoYTogdi5mZWNoYSB8fCAnJyxcbiAgICBNZXM6IHYubWVzIHx8ICcnLFxuICAgIEFubzogdi5hbmlvIHx8ICcnLFxuICAgIFZlbmRlZG9yOiB0aXRsZUNhc2Uodi52ZW5kb3IgfHwgJycpLFxuICAgICdUaXBvIGNvbnRhY3RvJzogdi50aXBvQ29udGFjdG8gPT09ICd0ZWxlZm9ubycgPyAnVGVsZWZvbm8nIDogJ1ByZXNlbmNpYWwnLFxuICAgIENvbWVudGFyaW86IHYuY29tZW50YXJpbyB8fCAnJyxcbiAgICBQcm92aW5jaWE6IHRpdGxlQ2FzZSh2LnByb3ZpbmNpYSB8fCAnJyksXG4gICAgTG9jYWxpZGFkOiB2LmxvY2FsaWRhZCB8fCAnJyxcbiAgICBUaWVuZGE6IHYudGllbmRhIHx8ICcnLFxuICAgICdUaXBvIHRpZW5kYSc6IHYudGlwbyB8fCAnJyxcbiAgICBMb2NhbDogdi5sb2NhbCB8fCAnJyxcbiAgICBUYW1hbm86IHYudGFtYW5vIHx8ICcnLFxuICAgIEZpZGVsaWRhZDogdi5maWRlbGlkYWQgfHwgJycsXG4gICAgJ1JlbGV2YW5jaWEgKDEtNSknOiB2LnJlbGV2YW5jaWEgfHwgJycsXG4gICAgUE9QOiB2LnBvcCB8fCAnJyxcbiAgICAnTmVjZXNpZGFkIHB1bnR1YWwnOiB2Lm5lY2VzaWRhZFB1bnR1YWwgPT09ICdNT1NUUkFETycgPyAnTU9TVFJBRE9SJyA6IHYubmVjZXNpZGFkUHVudHVhbCB8fCAnJyxcbiAgICAnVGlwbyB2ZW50YSc6IHYudGlwb1ZlbnRhID09PSAnTU9TVFJBRE8nID8gJ01PU1RSQURPUicgOiB2LnRpcG9WZW50YSB8fCAnJyxcbiAgICAnJSBNb3N0cmFkb3InOiB2LnBvbmRlcmFjaW9uTW9zdHJhZG8gIT0gbnVsbCA/IHYucG9uZGVyYWNpb25Nb3N0cmFkbyA6ICcnLFxuICAgICclIEVjb21tZXJjZSc6IHYucG9uZGVyYWNpb25FY29tbWVyY2UgIT0gbnVsbCA/IHYucG9uZGVyYWNpb25FY29tbWVyY2UgOiAnJyxcbiAgICBDb21wZXRlbmNpYTogdi5jb21wZXRlbmNpYSB8fCAnJyxcbiAgICAnQ2F0ZWdvcmlhIGNsaWVudGUnOiB2LmNhdGVnb3JpYUNsaWVudGUgfHwgJycsXG4gICAgT3BvcnR1bmlkYWQ6IHYub3BvcnR1bmlkYWQgfHwgJycsXG4gICAgJ0xvIG1hcyB2ZW5kaWRvIFNoaW1hbm8nOiB2Lm1hc1ZlbmRpZG8gfHwgJycsXG4gICAgJ0xvIHF1ZSBtYXMgcHJlZ3VudGFuJzogdi5tYXNQcmVndW50YW4gfHwgJycsXG4gICAgJ0F5dWRhIGEgdGllbmRhJzogdi5heXVkYVRpZW5kYSB8fCAnJyxcbiAgICAnRm90b3MgZXNwYWNpbyAoY2FudCknOiAodi5lc3BhY2lvIHx8IFtdKS5sZW5ndGgsXG4gICAgJ0ZvdG8gZnJlbnRlJzogdi5mcmVudGVMb2NhbCA/ICdTaScgOiAnTm8nLFxuICAgICdHUFMgZXN0YWRvJzogdi5ncHNTdGF0dXMgfHwgJycsXG4gICAgJ0dQUyBkaXN0YW5jaWEgKG0pJzogdHlwZW9mIHYuZ3BzRGlzdGFuY2VNID09PSAnbnVtYmVyJyA/IHYuZ3BzRGlzdGFuY2VNIDogJycsXG4gICAgJ0dQUyBsYXQnOiB2Lmdwc0xhdCAhPSBudWxsID8gdi5ncHNMYXQgOiAnJyxcbiAgICAnR1BTIGxvbic6IHYuZ3BzTG9uICE9IG51bGwgPyB2Lmdwc0xvbiA6ICcnLFxuICAgICdHUFMgcHJlY2lzaW9uIChtKSc6IHYuZ3BzQWNjdXJhY3kgIT0gbnVsbCA/IHYuZ3BzQWNjdXJhY3kgOiAnJyxcbiAgICAnR1BTIGNhcHR1cmFkbyc6IHYuZ3BzQ2FwdHVyZWRBdCB8fCAnJyxcbiAgICBFbWFpbDogdi5vd25lckVtYWlsIHx8ICcnLFxuICB9KSk7XG59XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBTRUNDSVx1MDBEM046IGV4cG9ydEV4ZWN1dGl2ZS9WaXNpdHMvUG93ZXJCSS9NTCAoaW5saW5lIEwxMDE1OC0xMDQyNilcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG53aW5kb3cuZXhwb3J0RXhlY3V0aXZlID0gZnVuY3Rpb24gKCkge1xuICBjb25zdCB3YiA9IFhMU1gudXRpbHMuYm9va19uZXcoKTtcbiAgY29uc3Qgcm93cyA9IGJ1aWxkUGVkaWRvRGV0YWlsUm93cygpO1xuICBjb25zdCBjb25mUm93cyA9IHJvd3MuZmlsdGVyKChyKSA9PiByLmVzdGFkbyA9PT0gJ0NvbmZpcm1hZG8nKTtcblxuICAvLyBDb25zb2xpZGFkbzogdW5hIGZpbGEgcG9yIHZlbmRlZG9yIGNvbiBLUElzXG4gIGNvbnN0IHBlclZlbmRvciA9IHt9O1xuICBjb25mUm93cy5mb3JFYWNoKChyKSA9PiB7XG4gICAgY29uc3QgayA9IHIudmVuZGVkb3IgfHwgJ1NpbiBhc2lnbmFyJztcbiAgICBpZiAoIXBlclZlbmRvcltrXSlcbiAgICAgIHBlclZlbmRvcltrXSA9IHtcbiAgICAgICAgem9uYTogci56b25hLFxuICAgICAgICB1bmlkOiAwLFxuICAgICAgICBhcnM6IDAsXG4gICAgICAgIHVzZDogMCxcbiAgICAgICAgY2xpZW50ZXM6IG5ldyBTZXQoKSxcbiAgICAgICAgcHJvZHM6IG5ldyBTZXQoKSxcbiAgICAgICAgcHJvdnM6IG5ldyBTZXQoKSxcbiAgICAgIH07XG4gICAgcGVyVmVuZG9yW2tdLnVuaWQgKz0gci5jYW50aWRhZDtcbiAgICBwZXJWZW5kb3Jba10uYXJzICs9IHIuc3VidG90YWxfYXJzO1xuICAgIHBlclZlbmRvcltrXS51c2QgKz0gci5zdWJ0b3RhbF91c2Q7XG4gICAgcGVyVmVuZG9yW2tdLmNsaWVudGVzLmFkZChyLmNsaWVudGUpO1xuICAgIHBlclZlbmRvcltrXS5wcm9kcy5hZGQoci5jb2RpZ28pO1xuICAgIHBlclZlbmRvcltrXS5wcm92cy5hZGQoci5wcm92aW5jaWEpO1xuICB9KTtcbiAgY29uc3QgY29uc29sID0gW107XG4gIFZFTkRPUlMuZm9yRWFjaCgodikgPT4ge1xuICAgIGNvbnN0IHRpdGxlViA9IHRpdGxlQ2FzZSh2LmtleSk7XG4gICAgY29uc3QgZCA9IHBlclZlbmRvclt0aXRsZVZdIHx8IHtcbiAgICAgIHpvbmE6IHYuem9uZSxcbiAgICAgIHVuaWQ6IDAsXG4gICAgICBhcnM6IDAsXG4gICAgICB1c2Q6IDAsXG4gICAgICBjbGllbnRlczogbmV3IFNldCgpLFxuICAgICAgcHJvZHM6IG5ldyBTZXQoKSxcbiAgICAgIHByb3ZzOiBuZXcgU2V0KCksXG4gICAgfTtcbiAgICBjb25zdCB0ID0gVEFSR0VUU19CWV9WRU5ET1Jbdi5rZXldIHx8IHsganVsMjAyNl91c2Q6IDAsIGp1bERpYzIwMjZfdXNkOiAwLCBhbnVhbDIwMjdfdXNkOiAwIH07XG4gICAgY29uc29sLnB1c2goe1xuICAgICAgWm9uYTogdi56b25lLFxuICAgICAgVmVuZGVkb3I6IHRpdGxlVixcbiAgICAgIFByb3ZpbmNpYXM6IGQucHJvdnMuc2l6ZSxcbiAgICAgICdDbGllbnRlcyBhY3Rpdm9zJzogZC5jbGllbnRlcy5zaXplLFxuICAgICAgJ1Byb2R1Y3RvcyBkaXN0aW50b3MnOiBkLnByb2RzLnNpemUsXG4gICAgICBVbmlkYWRlczogZC51bmlkLFxuICAgICAgJ0ZhY3R1cmFkbyBBUlMnOiBNYXRoLnJvdW5kKGQuYXJzKSxcbiAgICAgICdGYWN0dXJhZG8gVVNEJzogTWF0aC5yb3VuZChkLnVzZCksXG4gICAgICAnVGFyZ2V0IEp1bCAyMDI2IFVTRCc6IHQuanVsMjAyNl91c2QsXG4gICAgICAnVGFyZ2V0IEp1bC1EaWMgMjAyNiBVU0QnOiB0Lmp1bERpYzIwMjZfdXNkLFxuICAgICAgJ1RhcmdldCAyMDI3IFVTRCc6IHQuYW51YWwyMDI3X3VzZCxcbiAgICB9KTtcbiAgfSk7XG4gIGNvbnN0IHdzQyA9IFhMU1gudXRpbHMuanNvbl90b19zaGVldChjb25zb2wpO1xuICB3c0NbJyFjb2xzJ10gPSBbXG4gICAgeyB3Y2g6IDYgfSxcbiAgICB7IHdjaDogMjQgfSxcbiAgICB7IHdjaDogMTEgfSxcbiAgICB7IHdjaDogMTQgfSxcbiAgICB7IHdjaDogMTYgfSxcbiAgICB7IHdjaDogMTEgfSxcbiAgICB7IHdjaDogMTYgfSxcbiAgICB7IHdjaDogMTYgfSxcbiAgICB7IHdjaDogMTggfSxcbiAgICB7IHdjaDogMjAgfSxcbiAgICB7IHdjaDogMTggfSxcbiAgXTtcbiAgWExTWC51dGlscy5ib29rX2FwcGVuZF9zaGVldCh3Yiwgd3NDLCAnQ29uc29saWRhZG8nKTtcblxuICAvLyBVbmEgaG9qYSBwb3IgdmVuZGVkb3IgY29uIHN1IGRldGFsbGUgZGUgcGVkaWRvcyBjb25maXJtYWRvc1xuICBWRU5ET1JTLmZvckVhY2goKHYpID0+IHtcbiAgICBjb25zdCB0aXRsZVYgPSB0aXRsZUNhc2Uodi5rZXkpO1xuICAgIGNvbnN0IHZyb3dzID0gY29uZlJvd3NcbiAgICAgIC5maWx0ZXIoKHIpID0+IHIudmVuZGVkb3IgPT09IHRpdGxlVilcbiAgICAgIC5tYXAoKHIpID0+ICh7XG4gICAgICAgIEZlY2hhOiByLmZlY2hhLFxuICAgICAgICBNZXM6IHIubWVzX3BlZGlkbyxcbiAgICAgICAgUHJvdmluY2lhOiByLnByb3ZpbmNpYSxcbiAgICAgICAgTG9jYWxpZGFkOiByLmxvY2FsaWRhZCxcbiAgICAgICAgQ2xpZW50ZTogci5jbGllbnRlLFxuICAgICAgICBUaXBvOiByLnRpcG9fY2xpZW50ZSxcbiAgICAgICAgQ29kaWdvOiByLmNvZGlnbyxcbiAgICAgICAgUHJvZHVjdG86IHIucHJvZHVjdG8sXG4gICAgICAgIENhdGVnb3JpYTogci5jYXRlZ29yaWEsXG4gICAgICAgIEZhbWlsaWE6IHIuZmFtaWxpYSxcbiAgICAgICAgU3ViZmFtaWxpYTogci5zdWJmYW1pbGlhLFxuICAgICAgICBDYW50aWRhZDogci5jYW50aWRhZCxcbiAgICAgICAgJ1ByZWNpbyBBUlMnOiByLnByZWNpb191bml0X2FycyxcbiAgICAgICAgJ1N1YnRvdGFsIEFSUyc6IHIuc3VidG90YWxfYXJzLFxuICAgICAgICAnU3VidG90YWwgVVNEJzogci5zdWJ0b3RhbF91c2QsXG4gICAgICB9KSk7XG4gICAgdnJvd3Muc29ydChcbiAgICAgIChhLCBiKSA9PiAoYS5GZWNoYSB8fCAnJykubG9jYWxlQ29tcGFyZShiLkZlY2hhIHx8ICcnKSB8fCBhLkNsaWVudGUubG9jYWxlQ29tcGFyZShiLkNsaWVudGUpXG4gICAgKTtcbiAgICBpZiAoIXZyb3dzLmxlbmd0aClcbiAgICAgIHZyb3dzLnB1c2goe1xuICAgICAgICBGZWNoYTogJycsXG4gICAgICAgIE1lczogJycsXG4gICAgICAgIFByb3ZpbmNpYTogJycsXG4gICAgICAgIExvY2FsaWRhZDogJycsXG4gICAgICAgIENsaWVudGU6ICcoc2luIHBlZGlkb3MgY29uZmlybWFkb3MpJyxcbiAgICAgICAgVGlwbzogJycsXG4gICAgICAgIENvZGlnbzogJycsXG4gICAgICAgIFByb2R1Y3RvOiAnJyxcbiAgICAgICAgQ2F0ZWdvcmlhOiAnJyxcbiAgICAgICAgRmFtaWxpYTogJycsXG4gICAgICAgIFN1YmZhbWlsaWE6ICcnLFxuICAgICAgICBDYW50aWRhZDogMCxcbiAgICAgICAgJ1ByZWNpbyBBUlMnOiAwLFxuICAgICAgICAnU3VidG90YWwgQVJTJzogMCxcbiAgICAgICAgJ1N1YnRvdGFsIFVTRCc6IDAsXG4gICAgICB9KTtcbiAgICBjb25zdCB3cyA9IFhMU1gudXRpbHMuanNvbl90b19zaGVldCh2cm93cyk7XG4gICAgd3NbJyFjb2xzJ10gPSBbXG4gICAgICB7IHdjaDogMTEgfSxcbiAgICAgIHsgd2NoOiAxNCB9LFxuICAgICAgeyB3Y2g6IDE4IH0sXG4gICAgICB7IHdjaDogMjIgfSxcbiAgICAgIHsgd2NoOiAzMCB9LFxuICAgICAgeyB3Y2g6IDExIH0sXG4gICAgICB7IHdjaDogMTQgfSxcbiAgICAgIHsgd2NoOiAzOCB9LFxuICAgICAgeyB3Y2g6IDE0IH0sXG4gICAgICB7IHdjaDogMTggfSxcbiAgICAgIHsgd2NoOiAxOCB9LFxuICAgICAgeyB3Y2g6IDEwIH0sXG4gICAgICB7IHdjaDogMTIgfSxcbiAgICAgIHsgd2NoOiAxNCB9LFxuICAgICAgeyB3Y2g6IDE0IH0sXG4gICAgXTtcbiAgICBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KFxuICAgICAgd2IsXG4gICAgICB3cyxcbiAgICAgICh2LnpvbmUgKyAnICcgKyB0aXRsZVYpLnN1YnN0cmluZygwLCAzMSkucmVwbGFjZSgvW1xcXFwvKj9bXFxdOl0vZywgJycpXG4gICAgKTtcbiAgfSk7XG5cbiAgLy8gVmlzaXRhc1xuICBjb25zdCB2aXNpdFJvd3MgPSBidWlsZFZpc2l0Um93cygpO1xuICBpZiAodmlzaXRSb3dzLmxlbmd0aCkge1xuICAgIGNvbnN0IHdzViA9IFhMU1gudXRpbHMuanNvbl90b19zaGVldCh2aXNpdFJvd3MpO1xuICAgIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQod2IsIHdzViwgJ1Zpc2l0YXMnKTtcbiAgfVxuICAvLyBDb250YWN0YWRvcyAodG9kb3MgbG9zIGNsaWVudGVzL3Byb3NwZWN0b3MgbWFyY2Fkb3MgY29uIGNoZWNrKVxuICBjb25zdCBjb250YWN0Um93cyA9IGJ1aWxkQ29udGFjdGFkb3NSb3dzKCk7XG4gIGlmIChjb250YWN0Um93cy5sZW5ndGgpIHtcbiAgICBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KHdiLCBYTFNYLnV0aWxzLmpzb25fdG9fc2hlZXQoY29udGFjdFJvd3MpLCAnQ29udGFjdGFkb3MnKTtcbiAgfVxuICAvLyBMb2cgZGUgb3BlcmFjaW9uZXMgKGNhbmNlbGFjaW9uZXMsIGVsaW1pbmFjaW9uZXMsIGV0Yy4pXG4gIGNvbnN0IG9wc1Jvd3MgPSBidWlsZE9wc0xvZ1Jvd3MoKTtcbiAgaWYgKG9wc1Jvd3MubGVuZ3RoKSB7XG4gICAgWExTWC51dGlscy5ib29rX2FwcGVuZF9zaGVldCh3YiwgWExTWC51dGlscy5qc29uX3RvX3NoZWV0KG9wc1Jvd3MpLCAnTG9nIE9wZXJhY2lvbmVzJyk7XG4gIH1cblxuICBYTFNYLndyaXRlRmlsZSh3YiwgJ1NoaW1hbm9fRWplY3V0aXZvXycgKyB0b2RheVN0cigpICsgJy54bHN4Jyk7XG59O1xuXG4vLyAtLS0tLS0tLS0tIEV4Y2VsIGRlIFZpc2l0YXMgKGZvcm1hdG8gc3RhbmRhbG9uZSkgLS0tLS0tLS0tLVxud2luZG93LmV4cG9ydFZpc2l0c0V4Y2VsID0gZnVuY3Rpb24gKCkge1xuICBpZiAodHlwZW9mIFhMU1ggPT09ICd1bmRlZmluZWQnKSB7XG4gICAgYWxlcnQoJ0xhIGxpYnJlcmlhIGRlIEV4Y2VsIG5vIHNlIGNhcmdvLiBWZXJpZmlxdWUgc3UgY29uZXhpb24gYSBpbnRlcm5ldCB5IHJlaW50ZW50ZS4nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgY29uc3QgdmlzaXRSb3dzID0gYnVpbGRWaXNpdFJvd3MoKTtcbiAgaWYgKCF2aXNpdFJvd3MubGVuZ3RoKSB7XG4gICAgYWxlcnQoXG4gICAgICAnTm8gaGF5IHZpc2l0YXMgcmVnaXN0cmFkYXMgdG9kYXZpYS4gQ3VhbmRvIHNlIGNhcmd1ZSBhbCBtZW5vcyB1bmEsIHZhcyBhIHBvZGVyIGV4cG9ydGFybGEuJ1xuICAgICk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGNvbnN0IHdiID0gWExTWC51dGlscy5ib29rX25ldygpO1xuXG4gIC8vIEhvamEgcHJpbmNpcGFsOiBWaXNpdGFzICh0b2RhcyBsYXMgZmlsYXMpXG4gIGNvbnN0IHdzID0gWExTWC51dGlscy5qc29uX3RvX3NoZWV0KHZpc2l0Um93cyk7XG4gIHdzWychY29scyddID0gW1xuICAgIHsgd2NoOiAxMiB9LFxuICAgIHsgd2NoOiAxNCB9LFxuICAgIHsgd2NoOiA4IH0sXG4gICAgeyB3Y2g6IDI0IH0sXG4gICAgeyB3Y2g6IDE4IH0sXG4gICAgeyB3Y2g6IDIyIH0sXG4gICAgeyB3Y2g6IDMwIH0sXG4gICAgeyB3Y2g6IDE4IH0sXG4gICAgeyB3Y2g6IDE0IH0sXG4gICAgeyB3Y2g6IDE0IH0sXG4gICAgeyB3Y2g6IDE0IH0sXG4gICAgeyB3Y2g6IDE2IH0sXG4gICAgeyB3Y2g6IDggfSxcbiAgICB7IHdjaDogMjIgfSxcbiAgICB7IHdjaDogMTQgfSxcbiAgICB7IHdjaDogMTQgfSxcbiAgICB7IHdjaDogMTQgfSxcbiAgICB7IHdjaDogMTggfSxcbiAgICB7IHdjaDogMTggfSxcbiAgICB7IHdjaDogMzIgfSxcbiAgICB7IHdjaDogMzIgfSxcbiAgICB7IHdjaDogMzIgfSxcbiAgICB7IHdjaDogMzIgfSxcbiAgICB7IHdjaDogMTggfSxcbiAgICB7IHdjaDogMTQgfSxcbiAgICB7IHdjaDogMjQgfSxcbiAgXTtcbiAgWExTWC51dGlscy5ib29rX2FwcGVuZF9zaGVldCh3Yiwgd3MsICdWaXNpdGFzJyk7XG5cbiAgLy8gSG9qYSByZXN1bWVuIHBvciB2ZW5kZWRvcjogY2FudGlkYWQgZGUgdmlzaXRhcyB5IHRpZW5kYXMgdW5pY2FzXG4gIGNvbnN0IHBlclZlbmRvciA9IHt9O1xuICB2aXNpdHNDYWNoZS5mb3JFYWNoKCh2KSA9PiB7XG4gICAgY29uc3QgayA9IHRpdGxlQ2FzZSh2LnZlbmRvciB8fCAnU2luIGFzaWduYXInKTtcbiAgICBpZiAoIXBlclZlbmRvcltrXSlcbiAgICAgIHBlclZlbmRvcltrXSA9IHtcbiAgICAgICAgdmlzaXRhczogMCxcbiAgICAgICAgdGllbmRhczogbmV3IFNldCgpLFxuICAgICAgICBsb2NhbGlkYWRlczogbmV3IFNldCgpLFxuICAgICAgICBwcm92aW5jaWFzOiBuZXcgU2V0KCksXG4gICAgICB9O1xuICAgIHBlclZlbmRvcltrXS52aXNpdGFzKys7XG4gICAgaWYgKHYudGllbmRhKSBwZXJWZW5kb3Jba10udGllbmRhcy5hZGQodi50aWVuZGEpO1xuICAgIGlmICh2LmxvY2FsaWRhZCkgcGVyVmVuZG9yW2tdLmxvY2FsaWRhZGVzLmFkZCh2LmxvY2FsaWRhZCk7XG4gICAgaWYgKHYucHJvdmluY2lhKSBwZXJWZW5kb3Jba10ucHJvdmluY2lhcy5hZGQodi5wcm92aW5jaWEpO1xuICB9KTtcbiAgY29uc3QgcmVzdW1lbiA9IE9iamVjdC5lbnRyaWVzKHBlclZlbmRvcilcbiAgICAubWFwKChbdmVuZGVkb3IsIGRdKSA9PiAoe1xuICAgICAgVmVuZGVkb3I6IHZlbmRlZG9yLFxuICAgICAgJ1Zpc2l0YXMgdG90YWxlcyc6IGQudmlzaXRhcyxcbiAgICAgICdUaWVuZGFzIGRpc3RpbnRhcyc6IGQudGllbmRhcy5zaXplLFxuICAgICAgJ0xvY2FsaWRhZGVzIGRpc3RpbnRhcyc6IGQubG9jYWxpZGFkZXMuc2l6ZSxcbiAgICAgICdQcm92aW5jaWFzIGRpc3RpbnRhcyc6IGQucHJvdmluY2lhcy5zaXplLFxuICAgIH0pKVxuICAgIC5zb3J0KChhLCBiKSA9PiBiWydWaXNpdGFzIHRvdGFsZXMnXSAtIGFbJ1Zpc2l0YXMgdG90YWxlcyddKTtcbiAgaWYgKHJlc3VtZW4ubGVuZ3RoKSB7XG4gICAgY29uc3Qgd3NSID0gWExTWC51dGlscy5qc29uX3RvX3NoZWV0KHJlc3VtZW4pO1xuICAgIHdzUlsnIWNvbHMnXSA9IFt7IHdjaDogMjQgfSwgeyB3Y2g6IDE2IH0sIHsgd2NoOiAxOCB9LCB7IHdjaDogMjIgfSwgeyB3Y2g6IDIyIH1dO1xuICAgIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQod2IsIHdzUiwgJ1Jlc3VtZW4gcG9yIHZlbmRlZG9yJyk7XG4gIH1cblxuICBYTFNYLndyaXRlRmlsZSh3YiwgJ1NoaW1hbm9fVmlzaXRhc18nICsgdG9kYXlTdHIoKSArICcueGxzeCcpO1xufTtcblxuLy8gLS0tLS0tLS0tLSBPUENJT04gQjogUG93ZXIgQkkgKEZhY3QgKyBEaW0pIC0tLS0tLS0tLS1cbndpbmRvdy5leHBvcnRQb3dlckJJID0gZnVuY3Rpb24gKCkge1xuICBjb25zdCB3YiA9IFhMU1gudXRpbHMuYm9va19uZXcoKTtcbiAgY29uc3Qgcm93cyA9IGJ1aWxkUGVkaWRvRGV0YWlsUm93cygpO1xuXG4gIC8vIEZhY3RfUGVkaWRvc1xuICBjb25zdCBmYWN0Um93cyA9IHJvd3MuZmlsdGVyKChyKSA9PiByLmVzdGFkbyAhPT0gJ0JvcnJhZG9yJyk7XG4gIGNvbnN0IHdzRiA9IFhMU1gudXRpbHMuanNvbl90b19zaGVldChcbiAgICBmYWN0Um93cy5tYXAoKHIpID0+ICh7XG4gICAgICBsaW5lX2lkOiByLmxpbmVfaWQsXG4gICAgICBmZWNoYTogci5mZWNoYSxcbiAgICAgIGVzdGFkbzogci5lc3RhZG8sXG4gICAgICB2ZW5kZWRvcl9rZXk6IHIudmVuZGVkb3Jfa2V5LFxuICAgICAgem9uYTogci56b25hLFxuICAgICAgcHJvdmluY2lhOiByLnByb3ZpbmNpYSxcbiAgICAgIGxvY2FsaWRhZDogci5sb2NhbGlkYWQsXG4gICAgICBjbGllbnRlOiByLmNsaWVudGUsXG4gICAgICB0aXBvX2NsaWVudGU6IHIudGlwb19jbGllbnRlLFxuICAgICAgc2t1OiByLmNvZGlnbyxcbiAgICAgIGNhbnRpZGFkOiByLmNhbnRpZGFkLFxuICAgICAgcHJlY2lvX3VuaXRfYXJzOiByLnByZWNpb191bml0X2FycyxcbiAgICAgIHN1YnRvdGFsX2Fyczogci5zdWJ0b3RhbF9hcnMsXG4gICAgICBzdWJ0b3RhbF91c2Q6IHIuc3VidG90YWxfdXNkLFxuICAgIH0pKVxuICApO1xuICBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KHdiLCB3c0YsICdGYWN0X1BlZGlkb3MnKTtcblxuICAvLyBEaW1fVmVuZGVkb3JcbiAgY29uc3QgZGltViA9IFZFTkRPUlMubWFwKCh2KSA9PiB7XG4gICAgY29uc3QgdCA9IFRBUkdFVFNfQllfVkVORE9SW3Yua2V5XSB8fCB7fTtcbiAgICByZXR1cm4ge1xuICAgICAgdmVuZGVkb3Jfa2V5OiB2LmtleSxcbiAgICAgIHZlbmRlZG9yX25vbWJyZTogdGl0bGVDYXNlKHYua2V5KSxcbiAgICAgIHpvbmE6IHYuem9uZSxcbiAgICAgIHpvbmFfZGVzY3JpcGNpb246IHYubGFiZWwsXG4gICAgICBjb2xvcjogdi5jb2xvcixcbiAgICAgIHRhcmdldF9qdWwyMDI2X3VzZDogdC5qdWwyMDI2X3VzZCB8fCAwLFxuICAgICAgdGFyZ2V0X2p1bERpYzIwMjZfdXNkOiB0Lmp1bERpYzIwMjZfdXNkIHx8IDAsXG4gICAgICB0YXJnZXRfMjAyN191c2Q6IHQuYW51YWwyMDI3X3VzZCB8fCAwLFxuICAgIH07XG4gIH0pO1xuICBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KHdiLCBYTFNYLnV0aWxzLmpzb25fdG9fc2hlZXQoZGltViksICdEaW1fVmVuZGVkb3InKTtcblxuICAvLyBEaW1fUHJvZHVjdG9cbiAgY29uc3QgZGltUCA9IFBST0RVQ1RTLm1hcCgocCkgPT4gKHtcbiAgICBza3U6IHAuY29kZSxcbiAgICBkZXNjcmlwY2lvbjogcC5kZXNjLFxuICAgIGNhdGVnb3JpYTogcC5jYXQsXG4gICAgZmFtaWxpYTogcC5mYW0sXG4gICAgc3ViZmFtaWxpYTogcC5zdWIsXG4gIH0pKTtcbiAgWExTWC51dGlscy5ib29rX2FwcGVuZF9zaGVldCh3YiwgWExTWC51dGlscy5qc29uX3RvX3NoZWV0KGRpbVApLCAnRGltX1Byb2R1Y3RvJyk7XG5cbiAgLy8gRGltX0NsaWVudGUgKHVuaXZlcnNvKVxuICBjb25zdCBkaW1DID0gW107XG4gIFBPSU5UUy5mb3JFYWNoKChwKSA9PiB7XG4gICAgY29uc3Qgdm0gPSB2ZW5kb3JMb29rdXBbcC52ZW5kb3JdO1xuICAgIHAuY2xpZW50cy5mb3JFYWNoKChuKSA9PiB7XG4gICAgICBkaW1DLnB1c2goe1xuICAgICAgICBjbGllbnRlOiBuLFxuICAgICAgICB0aXBvOiAnQ2xpZW50ZSBhY3R1YWwnLFxuICAgICAgICBwcm92aW5jaWE6IHRpdGxlQ2FzZShwLnByb3ZpbmNlKSxcbiAgICAgICAgbG9jYWxpZGFkOiBwLm5hbWUsXG4gICAgICAgIGRlcGFydGFtZW50bzogcC5kZXB0IHx8ICcnLFxuICAgICAgICB2ZW5kZWRvcl9rZXk6IHAudmVuZG9yIHx8ICcnLFxuICAgICAgICB6b25hOiB2bSA/IHZtLnpvbmUgOiAnJyxcbiAgICAgIH0pO1xuICAgIH0pO1xuICAgIHAucHJvc3BlY3RzLmZvckVhY2goKG4pID0+IHtcbiAgICAgIGRpbUMucHVzaCh7XG4gICAgICAgIGNsaWVudGU6IG4sXG4gICAgICAgIHRpcG86ICdQcm9zcGVjdG8nLFxuICAgICAgICBwcm92aW5jaWE6IHRpdGxlQ2FzZShwLnByb3ZpbmNlKSxcbiAgICAgICAgbG9jYWxpZGFkOiBwLm5hbWUsXG4gICAgICAgIGRlcGFydGFtZW50bzogcC5kZXB0IHx8ICcnLFxuICAgICAgICB2ZW5kZWRvcl9rZXk6IHAudmVuZG9yIHx8ICcnLFxuICAgICAgICB6b25hOiB2bSA/IHZtLnpvbmUgOiAnJyxcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9KTtcbiAgWExTWC51dGlscy5ib29rX2FwcGVuZF9zaGVldCh3YiwgWExTWC51dGlscy5qc29uX3RvX3NoZWV0KGRpbUMpLCAnRGltX0NsaWVudGUnKTtcblxuICAvLyBEaW1fQ2FsZW5kYXJpbyAoZmVjaGFzIGRpc3RpbnRhcyBlbiBsb3MgcGVkaWRvcyArIHNlcmllIGNvbnRpbnVhIGRlbCBhXHUwMEYxbyBhY3R1YWwpXG4gIGNvbnN0IGNhbFNldCA9IG5ldyBTZXQoKTtcbiAgZmFjdFJvd3MuZm9yRWFjaCgocikgPT4ge1xuICAgIGlmIChyLmZlY2hhKSBjYWxTZXQuYWRkKHIuZmVjaGEpO1xuICB9KTtcbiAgLy8gQ29tcGxldGFyIGRlc2RlIDIwMjYtMDEtMDEgaGFzdGEgaG95ICsgMzY1XG4gIGNvbnN0IHN0YXJ0ID0gbmV3IERhdGUoJzIwMjYtMDEtMDEnKTtcbiAgY29uc3QgZW5kID0gbmV3IERhdGUoKTtcbiAgZW5kLnNldERhdGUoZW5kLmdldERhdGUoKSArIDM2NSk7XG4gIGZvciAobGV0IGQgPSBuZXcgRGF0ZShzdGFydCk7IGQgPD0gZW5kOyBkLnNldERhdGUoZC5nZXREYXRlKCkgKyAxKSlcbiAgICBjYWxTZXQuYWRkKGQudG9JU09TdHJpbmcoKS5zbGljZSgwLCAxMCkpO1xuICBjb25zdCBkaW1DYWwgPSBbLi4uY2FsU2V0XS5zb3J0KCkubWFwKChkdCkgPT4ge1xuICAgIGNvbnN0IFt5LCBtLCBkYV0gPSBkdC5zcGxpdCgnLScpLm1hcCgoeCkgPT4gcGFyc2VJbnQoeCwgMTApKTtcbiAgICBjb25zdCBkYXRlT2JqID0gbmV3IERhdGUoeSwgbSAtIDEsIGRhKTtcbiAgICByZXR1cm4ge1xuICAgICAgZmVjaGE6IGR0LFxuICAgICAgeWVhcjogeSxcbiAgICAgIG1vbnRoOiBtLFxuICAgICAgZGF5OiBkYSxcbiAgICAgIHF1YXJ0ZXI6ICdRJyArIChNYXRoLmZsb29yKChtIC0gMSkgLyAzKSArIDEpLFxuICAgICAgbW9udGhfbmFtZTogTUVTRVNbbSAtIDFdLFxuICAgICAgeWVhcl9tb250aDogeSArICctJyArIFN0cmluZyhtKS5wYWRTdGFydCgyLCAnMCcpLFxuICAgICAgZGF5X29mX3dlZWs6IFsnRG9tJywgJ0x1bicsICdNYXInLCAnTWllJywgJ0p1ZScsICdWaWUnLCAnU2FiJ11bZGF0ZU9iai5nZXREYXkoKV0sXG4gICAgfTtcbiAgfSk7XG4gIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQod2IsIFhMU1gudXRpbHMuanNvbl90b19zaGVldChkaW1DYWwpLCAnRGltX0NhbGVuZGFyaW8nKTtcblxuICAvLyBEaW1fQ2FtcGFuaWFcbiAgY29uc3QgZGltQ21wID0gY2FtcGFpZ25zQ2FjaGUubWFwKChjKSA9PiAoe1xuICAgIGNhbXBhbmlhX2lkOiBjLmlkLFxuICAgIG5vbWJyZTogYy5uYW1lLFxuICAgIGZpbHRlcl90eXBlOiBjLmZpbHRlclR5cGUsXG4gICAgZmlsdGVyX3ZhbHVlczogKGMuZmlsdGVyVmFsdWVzIHx8IFtdKS5qb2luKCcsICcpLFxuICAgIHRhcmdldF90eXBlOiBjLnRhcmdldFR5cGUsXG4gICAgdGFyZ2V0X2Ftb3VudDogYy50YXJnZXRBbW91bnQsXG4gICAgZGVzZGU6IGMuc3RhcnREYXRlLFxuICAgIGhhc3RhOiBjLmVuZERhdGUsXG4gIH0pKTtcbiAgaWYgKGRpbUNtcC5sZW5ndGgpXG4gICAgWExTWC51dGlscy5ib29rX2FwcGVuZF9zaGVldCh3YiwgWExTWC51dGlscy5qc29uX3RvX3NoZWV0KGRpbUNtcCksICdEaW1fQ2FtcGFuaWEnKTtcblxuICAvLyBQYXJhbXMgKHRpcG8gZGUgY2FtYmlvLCBmZWNoYSBleHBvcnQsIHZlcnNpb24pXG4gIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQoXG4gICAgd2IsXG4gICAgWExTWC51dGlscy5qc29uX3RvX3NoZWV0KFtcbiAgICAgIHsgcGFyYW1ldHJvOiAnZXhjaGFuZ2VfcmF0ZV9hcnNfdXNkJywgdmFsb3I6IEVYQ0hBTkdFX1JBVEUgfSxcbiAgICAgIHsgcGFyYW1ldHJvOiAnZmVjaGFfZXhwb3J0JywgdmFsb3I6IHRvZGF5U3RyKCkgfSxcbiAgICAgIHsgcGFyYW1ldHJvOiAndG90YWxfZmlsYXNfZmFjdCcsIHZhbG9yOiBmYWN0Um93cy5sZW5ndGggfSxcbiAgICBdKSxcbiAgICAnUGFyYW1ldHJvcydcbiAgKTtcblxuICAvLyBGYWN0X1Zpc2l0YXNcbiAgY29uc3QgdmlzaXRSb3dzQiA9IGJ1aWxkVmlzaXRSb3dzKCk7XG4gIGlmICh2aXNpdFJvd3NCLmxlbmd0aClcbiAgICBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KHdiLCBYTFNYLnV0aWxzLmpzb25fdG9fc2hlZXQodmlzaXRSb3dzQiksICdGYWN0X1Zpc2l0YXMnKTtcbiAgLy8gQ29udGFjdGFkb3NcbiAgY29uc3QgY29udGFjdFJvd3NCID0gYnVpbGRDb250YWN0YWRvc1Jvd3MoKTtcbiAgaWYgKGNvbnRhY3RSb3dzQi5sZW5ndGgpXG4gICAgWExTWC51dGlscy5ib29rX2FwcGVuZF9zaGVldCh3YiwgWExTWC51dGlscy5qc29uX3RvX3NoZWV0KGNvbnRhY3RSb3dzQiksICdDb250YWN0YWRvcycpO1xuICAvLyBMb2cgZGUgb3BlcmFjaW9uZXNcbiAgY29uc3Qgb3BzUm93c0IgPSBidWlsZE9wc0xvZ1Jvd3MoKTtcbiAgaWYgKG9wc1Jvd3NCLmxlbmd0aClcbiAgICBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KHdiLCBYTFNYLnV0aWxzLmpzb25fdG9fc2hlZXQob3BzUm93c0IpLCAnTG9nX09wZXJhY2lvbmVzJyk7XG5cbiAgWExTWC53cml0ZUZpbGUod2IsICdTaGltYW5vX1Bvd2VyQklfJyArIHRvZGF5U3RyKCkgKyAnLnhsc3gnKTtcbn07XG5cbi8vIC0tLS0tLS0tLS0gT1BDSU9OIEM6IFB5dGhvbiAvIElBIC8gTUwgKHNpbmdsZSBsb25nLWZvcm1hdCB0YWJsZSkgLS0tLS0tLS0tLVxud2luZG93LmV4cG9ydE1MID0gZnVuY3Rpb24gKCkge1xuICBjb25zdCB3YiA9IFhMU1gudXRpbHMuYm9va19uZXcoKTtcbiAgY29uc3Qgcm93cyA9IGJ1aWxkUGVkaWRvRGV0YWlsUm93cygpO1xuICAvLyBtYXN0ZXJfbWw6IHVuYSBmaWxhIHBvciBsaW5lYSBjb24gVE9EQVMgbGFzIGZlYXR1cmVzXG4gIGNvbnN0IHdzID0gWExTWC51dGlscy5qc29uX3RvX3NoZWV0KHJvd3MpO1xuICB3c1snIWNvbHMnXSA9IE9iamVjdC5rZXlzKHJvd3NbMF0gfHwgeyBmZWNoYTogJycgfSkubWFwKCgpID0+ICh7IHdjaDogMTQgfSkpO1xuICBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KHdiLCB3cywgJ21hc3Rlcl9tbCcpO1xuXG4gIC8vIGNhdGFsb2dvIHkgdW5pdmVyc28gZGUgY2xpZW50ZXMgY29tbyByZWZlcmVuY2lhcyBwYXJhIGVucmlxdWVjZXIgZW4gcGFuZGFzXG4gIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQoXG4gICAgd2IsXG4gICAgWExTWC51dGlscy5qc29uX3RvX3NoZWV0KFxuICAgICAgUFJPRFVDVFMubWFwKChwKSA9PiAoeyBjb2RlOiBwLmNvZGUsIGRlc2M6IHAuZGVzYywgY2F0OiBwLmNhdCwgZmFtOiBwLmZhbSwgc3ViOiBwLnN1YiB9KSlcbiAgICApLFxuICAgICdwcm9kdWN0b3NfY2F0YWxvZ28nXG4gICk7XG5cbiAgY29uc3QgdW5pdmVyc2UgPSBbXTtcbiAgUE9JTlRTLmZvckVhY2goKHApID0+IHtcbiAgICBjb25zdCB2bSA9IHZlbmRvckxvb2t1cFtwLnZlbmRvcl07XG4gICAgcC5jbGllbnRzLmZvckVhY2goKG4pID0+IHtcbiAgICAgIHVuaXZlcnNlLnB1c2goe1xuICAgICAgICBjbGllbnRlOiBuLFxuICAgICAgICB0aXBvOiAnY2xpZW50ZV9hY3R1YWwnLFxuICAgICAgICBwcm92aW5jaWE6IHRpdGxlQ2FzZShwLnByb3ZpbmNlKSxcbiAgICAgICAgbG9jYWxpZGFkOiBwLm5hbWUsXG4gICAgICAgIGRlcGFydGFtZW50bzogcC5kZXB0IHx8ICcnLFxuICAgICAgICB2ZW5kZWRvcjogdGl0bGVDYXNlKHAudmVuZG9yIHx8ICcnKSxcbiAgICAgICAgem9uYTogdm0gPyB2bS56b25lIDogJycsXG4gICAgICAgIGxhdDogcC5sYXQsXG4gICAgICAgIGxvbjogcC5sb24sXG4gICAgICB9KTtcbiAgICB9KTtcbiAgICBwLnByb3NwZWN0cy5mb3JFYWNoKChuKSA9PiB7XG4gICAgICB1bml2ZXJzZS5wdXNoKHtcbiAgICAgICAgY2xpZW50ZTogbixcbiAgICAgICAgdGlwbzogJ3Byb3NwZWN0bycsXG4gICAgICAgIHByb3ZpbmNpYTogdGl0bGVDYXNlKHAucHJvdmluY2UpLFxuICAgICAgICBsb2NhbGlkYWQ6IHAubmFtZSxcbiAgICAgICAgZGVwYXJ0YW1lbnRvOiBwLmRlcHQgfHwgJycsXG4gICAgICAgIHZlbmRlZG9yOiB0aXRsZUNhc2UocC52ZW5kb3IgfHwgJycpLFxuICAgICAgICB6b25hOiB2bSA/IHZtLnpvbmUgOiAnJyxcbiAgICAgICAgbGF0OiBwLmxhdCxcbiAgICAgICAgbG9uOiBwLmxvbixcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9KTtcbiAgWExTWC51dGlscy5ib29rX2FwcGVuZF9zaGVldCh3YiwgWExTWC51dGlscy5qc29uX3RvX3NoZWV0KHVuaXZlcnNlKSwgJ3VuaXZlcnNvX2NsaWVudGVzJyk7XG5cbiAgLy8gdGFyZ2V0cyBjb21vIHRhYmxhIGxvbmdcbiAgY29uc3QgdGFyZ2V0c0xvbmcgPSBbXTtcbiAgT2JqZWN0LmVudHJpZXMoVEFSR0VUU19CWV9WRU5ET1IpLmZvckVhY2goKFt2ZW5kb3IsIHRdKSA9PiB7XG4gICAgdGFyZ2V0c0xvbmcucHVzaCh7XG4gICAgICB2ZW5kZWRvcjogZGlzcGxheVZlbmRvck5hbWUodmVuZG9yKSxcbiAgICAgIHBlcmlvZG86ICdKdWwgMjAyNicsXG4gICAgICBzdGFydF9kYXRlOiAnMjAyNi0wNy0wMScsXG4gICAgICBlbmRfZGF0ZTogJzIwMjYtMDctMzEnLFxuICAgICAgdGFyZ2V0X3VzZDogdC5qdWwyMDI2X3VzZCB8fCAwLFxuICAgIH0pO1xuICAgIHRhcmdldHNMb25nLnB1c2goe1xuICAgICAgdmVuZGVkb3I6IGRpc3BsYXlWZW5kb3JOYW1lKHZlbmRvciksXG4gICAgICBwZXJpb2RvOiAnSnVsLURpYyAyMDI2JyxcbiAgICAgIHN0YXJ0X2RhdGU6ICcyMDI2LTA3LTAxJyxcbiAgICAgIGVuZF9kYXRlOiAnMjAyNi0xMi0zMScsXG4gICAgICB0YXJnZXRfdXNkOiB0Lmp1bERpYzIwMjZfdXNkIHx8IDAsXG4gICAgfSk7XG4gICAgdGFyZ2V0c0xvbmcucHVzaCh7XG4gICAgICB2ZW5kZWRvcjogZGlzcGxheVZlbmRvck5hbWUodmVuZG9yKSxcbiAgICAgIHBlcmlvZG86ICcyMDI3JyxcbiAgICAgIHN0YXJ0X2RhdGU6ICcyMDI3LTAxLTAxJyxcbiAgICAgIGVuZF9kYXRlOiAnMjAyNy0xMi0zMScsXG4gICAgICB0YXJnZXRfdXNkOiB0LmFudWFsMjAyN191c2QgfHwgMCxcbiAgICB9KTtcbiAgfSk7XG4gIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQod2IsIFhMU1gudXRpbHMuanNvbl90b19zaGVldCh0YXJnZXRzTG9uZyksICd0YXJnZXRzX2xvbmcnKTtcblxuICAvLyBjYW1wYVx1MDBGMWFzXG4gIGlmIChjYW1wYWlnbnNDYWNoZS5sZW5ndGgpIHtcbiAgICBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KFxuICAgICAgd2IsXG4gICAgICBYTFNYLnV0aWxzLmpzb25fdG9fc2hlZXQoXG4gICAgICAgIGNhbXBhaWduc0NhY2hlLm1hcCgoYykgPT4gKHtcbiAgICAgICAgICBpZDogYy5pZCxcbiAgICAgICAgICBub21icmU6IGMubmFtZSxcbiAgICAgICAgICBmaWx0ZXJfdHlwZTogYy5maWx0ZXJUeXBlLFxuICAgICAgICAgIGZpbHRlcl92YWx1ZXM6IChjLmZpbHRlclZhbHVlcyB8fCBbXSkuam9pbignLCcpLFxuICAgICAgICAgIHRhcmdldF90eXBlOiBjLnRhcmdldFR5cGUsXG4gICAgICAgICAgdGFyZ2V0X2Ftb3VudDogYy50YXJnZXRBbW91bnQsXG4gICAgICAgICAgc3RhcnRfZGF0ZTogYy5zdGFydERhdGUsXG4gICAgICAgICAgZW5kX2RhdGU6IGMuZW5kRGF0ZSxcbiAgICAgICAgfSkpXG4gICAgICApLFxuICAgICAgJ2NhbXBhbmlhcydcbiAgICApO1xuICB9XG5cbiAgLy8gcGFyYW1ldHJvc1xuICBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KFxuICAgIHdiLFxuICAgIFhMU1gudXRpbHMuanNvbl90b19zaGVldChbXG4gICAgICB7IHBhcmFtZXRybzogJ2V4Y2hhbmdlX3JhdGVfYXJzX3VzZCcsIHZhbG9yOiBFWENIQU5HRV9SQVRFIH0sXG4gICAgICB7IHBhcmFtZXRybzogJ2ZlY2hhX2V4cG9ydCcsIHZhbG9yOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCkgfSxcbiAgICBdKSxcbiAgICAncGFyYW1ldHJvcydcbiAgKTtcblxuICAvLyB2aXNpdGFzXG4gIGNvbnN0IHZpc2l0Um93c0MgPSBidWlsZFZpc2l0Um93cygpO1xuICBpZiAodmlzaXRSb3dzQy5sZW5ndGgpXG4gICAgWExTWC51dGlscy5ib29rX2FwcGVuZF9zaGVldCh3YiwgWExTWC51dGlscy5qc29uX3RvX3NoZWV0KHZpc2l0Um93c0MpLCAndmlzaXRhcycpO1xuICAvLyBjb250YWN0YWRvc1xuICBjb25zdCBjb250YWN0Um93c0MgPSBidWlsZENvbnRhY3RhZG9zUm93cygpO1xuICBpZiAoY29udGFjdFJvd3NDLmxlbmd0aClcbiAgICBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KHdiLCBYTFNYLnV0aWxzLmpzb25fdG9fc2hlZXQoY29udGFjdFJvd3NDKSwgJ2NvbnRhY3RhZG9zJyk7XG4gIC8vIGxvZyBkZSBvcGVyYWNpb25lc1xuICBjb25zdCBvcHNSb3dzQyA9IGJ1aWxkT3BzTG9nUm93cygpO1xuICBpZiAob3BzUm93c0MubGVuZ3RoKVxuICAgIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQod2IsIFhMU1gudXRpbHMuanNvbl90b19zaGVldChvcHNSb3dzQyksICdsb2dfb3BlcmFjaW9uZXMnKTtcblxuICBYTFNYLndyaXRlRmlsZSh3YiwgJ1NoaW1hbm9fTUxfJyArIHRvZGF5U3RyKCkgKyAnLnhsc3gnKTtcbn07XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gdjM3MSs6IEV4cG9ydCBkYXRhc2V0IHBhcmEgYW5cdTAwRTFsaXNpcyAoWklQIGRlIENTVnMgcGFyYSBNTCBwaXBlbGluZXMpXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuLyoqXG4gKiBBYnJlIGVsIG1vZGFsIGNoaWNvIGRpc3BhdGNoZXIgZGVsIGJvdG9uIFwiRXhwb3J0YXIgYSBFeGNlbFwiLiBNdWVzdHJhXG4gKiAyIHRhcmpldGFzOiBSZXBvcnRlcyBFeGNlbCAodG9kb3MpIHZzIERhdGFzZXQgWklQIChzb2xvIGFkbWluL2dlcmVudGUpLlxuICovXG53aW5kb3cub3BlbkV4cG9ydEZvcm1hdE1vZGFsID0gZnVuY3Rpb24gKCkge1xuICAvLyBPY3VsdGFyL21vc3RyYXIgdGFyamV0YSBEYXRhc2V0IHNlZ3VuIHJvbC5cbiAgY29uc3QgZHNPcHQgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZXhwLW9wdC1kYXRhc2V0LXppcCcpO1xuICBpZiAoZHNPcHQpIHtcbiAgICBjb25zdCBpc0FkbWluT3JHZXJlbnRlID0gdXNlclJvbGUgPT09ICdhZG1pbicgfHwgdXNlclJvbGUgPT09ICdnZXJlbnRlJztcbiAgICBkc09wdC5zdHlsZS5kaXNwbGF5ID0gaXNBZG1pbk9yR2VyZW50ZSA/ICcnIDogJ25vbmUnO1xuICB9XG4gIC8vIE9jdWx0YXIgcHJvZ3Jlc3MgYmFyIChwb3Igc2kgcXVlZG8gYWJpZXJ0byBkZSB1bmEgZWplY3VjaW9uIGFudGVyaW9yKVxuICBjb25zdCBwcm9nID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2V4cG9ydC1kYXRhc2V0LXByb2dyZXNzJyk7XG4gIGlmIChwcm9nKSBwcm9nLnN0eWxlLmRpc3BsYXkgPSAnbm9uZSc7XG4gIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdleHBvcnQtZm9ybWF0LW1vZGFsJykuY2xhc3NMaXN0LmFkZCgnb3BlbicpO1xufTtcblxud2luZG93LmNsb3NlRXhwb3J0Rm9ybWF0TW9kYWwgPSBmdW5jdGlvbiAoKSB7XG4gIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdleHBvcnQtZm9ybWF0LW1vZGFsJykuY2xhc3NMaXN0LnJlbW92ZSgnb3BlbicpO1xufTtcblxuLyoqXG4gKiBBY3R1YWxpemEgZWwgc3RhdHVzICsgYmFycmEgZGVsIG1vZGFsLiBzdGF0dXMgZXMgdGV4dG8gbGlicmU7IHBlcmNlbnQgMC4uMTAwLlxuICovXG5mdW5jdGlvbiBfdXBkYXRlRXhwb3J0UHJvZ3Jlc3Moc3RhdHVzLCBwZXJjZW50KSB7XG4gIGNvbnN0IHMgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZXhwb3J0LWRhdGFzZXQtc3RhdHVzJyk7XG4gIGNvbnN0IGIgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZXhwb3J0LWRhdGFzZXQtYmFyJyk7XG4gIGNvbnN0IHdyYXAgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZXhwb3J0LWRhdGFzZXQtcHJvZ3Jlc3MnKTtcbiAgaWYgKHdyYXApIHdyYXAuc3R5bGUuZGlzcGxheSA9ICcnO1xuICBpZiAocykgcy50ZXh0Q29udGVudCA9IHN0YXR1cztcbiAgaWYgKGIpIGIuc3R5bGUud2lkdGggPSBNYXRoLm1heCgwLCBNYXRoLm1pbigxMDAsIHBlcmNlbnQpKSArICclJztcbn1cblxuLyoqXG4gKiBGZXRjaCBzdG9jay5qc29uIGRlbCByb290IGRlbCBzaXRpbyAodjM2OSsgdGllbmUgd2FyZWhvdXNlQnJlYWtkb3duKS5cbiAqIENhY2hlLWJ1c3RpbmcgY29uID90PSBwYXJhIGV2aXRhciBTVy5cbiAqL1xuYXN5bmMgZnVuY3Rpb24gX2ZldGNoU3RvY2tKc29uKCkge1xuICB0cnkge1xuICAgIGNvbnN0IHIgPSBhd2FpdCBmZXRjaCgnLi9zdG9jay5qc29uP3Q9JyArIERhdGUubm93KCksIHsgY2FjaGU6ICduby1zdG9yZScgfSk7XG4gICAgaWYgKCFyLm9rKSB0aHJvdyBuZXcgRXJyb3IoJ0hUVFAgJyArIHIuc3RhdHVzKTtcbiAgICByZXR1cm4gYXdhaXQgci5qc29uKCk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBjb25zb2xlLndhcm4oJ1tleHBvcnREYXRhc2V0WmlwXSBzdG9jay5qc29uIGZhbGxvOicsIGUgJiYgZS5tZXNzYWdlKTtcbiAgICByZXR1cm4gbnVsbDsgLy8gbm8gYmxvcXVlYW50ZSBcdTIwMTQgcHJvZHVjdG9zLmNzdiBxdWVkYSB2YWNpb1xuICB9XG59XG5cbi8qKlxuICogTGF6eSBsb2FkIEpTWmlwIChwYXRyb24geWEgdXNhZG8gZW4gZXhwb3J0UGhvdG9zWmlwIGxpbmVhIH40NykuXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIF9lbnN1cmVKU1ppcExvYWRlZCgpIHtcbiAgaWYgKHR5cGVvZiBKU1ppcCAhPT0gJ3VuZGVmaW5lZCcpIHJldHVybjtcbiAgYXdhaXQgbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgIGNvbnN0IHMgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdzY3JpcHQnKTtcbiAgICBzLnNyYyA9ICdodHRwczovL2NkbmpzLmNsb3VkZmxhcmUuY29tL2FqYXgvbGlicy9qc3ppcC8zLjEwLjEvanN6aXAubWluLmpzJztcbiAgICBzLm9ubG9hZCA9IHJlc29sdmU7XG4gICAgcy5vbmVycm9yID0gKCkgPT4gcmVqZWN0KG5ldyBFcnJvcignTm8gc2UgcHVkbyBjYXJnYXIgSlNaaXAnKSk7XG4gICAgZG9jdW1lbnQuaGVhZC5hcHBlbmRDaGlsZChzKTtcbiAgfSk7XG59XG5cbi8qKlxuICogRGVzY2FyZ2EgdW4gQmxvYiBjb21vIGFyY2hpdm8uIFJldXNhIGVsIHBhdHJvbiBkZSBleHBvcnRQaG90b3NaaXAuXG4gKi9cbmZ1bmN0aW9uIF9kb3dubG9hZEJsb2IoYmxvYiwgZmlsZW5hbWUpIHtcbiAgY29uc3QgdXJsID0gVVJMLmNyZWF0ZU9iamVjdFVSTChibG9iKTtcbiAgY29uc3QgYSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2EnKTtcbiAgYS5ocmVmID0gdXJsO1xuICBhLmRvd25sb2FkID0gZmlsZW5hbWU7XG4gIGRvY3VtZW50LmJvZHkuYXBwZW5kQ2hpbGQoYSk7XG4gIGEuY2xpY2soKTtcbiAgc2V0VGltZW91dCgoKSA9PiB7XG4gICAgZG9jdW1lbnQuYm9keS5yZW1vdmVDaGlsZChhKTtcbiAgICBVUkwucmV2b2tlT2JqZWN0VVJMKHVybCk7XG4gIH0sIDEwMCk7XG59XG5cbi8qKlxuICogRVhQT1JUIFBSSU5DSVBBTC4gU29sbyBhZG1pbi9nZXJlbnRlLiBHZW5lcmEgWklQIGNvbjpcbiAqICAtIHBlZGlkb3MuY3N2LCB2aXNpdGFzLmNzdiwgY2xpZW50ZXMuY3N2LCBjbGllbnRfbWFzdGVyLmNzdiwgcmVuZGljaW9uZXMuY3N2LFxuICogICAgY2FtcGFuaWFzLmNzdiwgdGFyZ2V0cy5jc3YsIHByb2R1Y3Rvcy5jc3YsIHZlbmRvcl9vdmVycmlkZXMuY3N2LFxuICogICAgY3VzdG9tX3JvdXRlcy5jc3YsIHNlZ3VpbWllbnRvX25vdGVzLmNzdlxuICogIC0gbWFuaWZlc3QuanNvbiAoc2NoZW1hICsgdXNlQ2FzZU1hdHJpeCArIHJvd0NvdW50cyArIG51bGxSYXRlQnlGaWVsZCArIGxpbWl0YXRpb25zKVxuICpcbiAqIENhc29zIGJvcmRlIG1hbmVqYWRvczpcbiAqICAtIFNpIGFsZ3VuYSAuZ2V0KCkgZmFsbGEgLT4gYWxlcnQgKyBubyBkZXNjYXJnYXIgKG5vIGdlbmVyYSBaSVAgcGFyY2lhbCBzaWxlbmNpb3NvKS5cbiAqICAtIFNpIHN0b2NrLmpzb24gbm8gcmVzcG9uZGUgLT4gcHJvZHVjdG9zLmNzdiBxdWVkYSB2YWNpbyBjb24gd2FybmluZyBlbiBtYW5pZmVzdC5cbiAqICAtIFByb2dyZXNzIGJhciBlbiBlbCBtb2RhbCBwYXJhIGZlZWRiYWNrICh+MTAtMzAgc2VnKS5cbiAqL1xud2luZG93LmV4cG9ydERhdGFzZXRaaXAgPSBhc3luYyBmdW5jdGlvbiAoKSB7XG4gIGlmICh1c2VyUm9sZSAhPT0gJ2FkbWluJyAmJiB1c2VyUm9sZSAhPT0gJ2dlcmVudGUnKSB7XG4gICAgYWxlcnQoJ1NvbG8gYWRtaW4gbyBnZXJlbnRlIHB1ZWRlbiBleHBvcnRhciBlbCBkYXRhc2V0LicpO1xuICAgIHJldHVybjtcbiAgfVxuICBpZiAoIWZiRGIpIHtcbiAgICBhbGVydCgnRmlyZXN0b3JlIG5vIGluaWNpYWxpemFkby4gUmVjYXJnYSBsYSBhcHAuJyk7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgLy8gUmUtYWJyaXIgbW9kYWwgc2kgZWwgdXN1YXJpbyBjZXJybyB5IG5hdmVnYW1vcyBwb3Igb3RybyBmbHVqby5cbiAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2V4cG9ydC1mb3JtYXQtbW9kYWwnKS5jbGFzc0xpc3QuYWRkKCdvcGVuJyk7XG4gIF91cGRhdGVFeHBvcnRQcm9ncmVzcygnUHJlcGFyYW5kby4uLicsIDUpO1xuXG4gIHRyeSB7XG4gICAgX3VwZGF0ZUV4cG9ydFByb2dyZXNzKCdDYXJnYW5kbyBKU1ppcC4uLicsIDEwKTtcbiAgICBhd2FpdCBfZW5zdXJlSlNaaXBMb2FkZWQoKTtcblxuICAgIC8vIDEpIEZldGNoIDEwIGNvbGVjY2lvbmVzIEZpcmVzdG9yZSBlbiBwYXJhbGVsbyArIHN0b2NrLmpzb25cbiAgICBfdXBkYXRlRXhwb3J0UHJvZ3Jlc3MoJ0xleWVuZG8gRmlyZXN0b3JlICgxMCBjb2xlY2Npb25lcykuLi4nLCAyMCk7XG4gICAgY29uc3QgZmlyZXN0b3JlRW50cmllcyA9IFtcbiAgICAgIFsncGVkaWRvcycsIGZiRGIuY29sbGVjdGlvbigncGVkaWRvcycpLmdldCgpXSxcbiAgICAgIFsndmlzaXRhcycsIGZiRGIuY29sbGVjdGlvbigndmlzaXRzJykuZ2V0KCldLFxuICAgICAgWydjbGllbnRlcycsIGZiRGIuY29sbGVjdGlvbignY2xpZW50X2FwcGxpY2F0aW9ucycpLmdldCgpXSxcbiAgICAgIFsnY2xpZW50X21hc3RlcicsIGZiRGIuY29sbGVjdGlvbignY2xpZW50X21hc3RlcicpLmdldCgpXSxcbiAgICAgIFsncmVuZGljaW9uZXMnLCBmYkRiLmNvbGxlY3Rpb24oJ3JlbmRpY2lvbmVzJykuZ2V0KCldLFxuICAgICAgWydjYW1wYW5pYXMnLCBmYkRiLmNvbGxlY3Rpb24oJ2NhbXBhaWducycpLmdldCgpXSxcbiAgICAgIFsndGFyZ2V0cycsIGZiRGIuY29sbGVjdGlvbigndGFyZ2V0cycpLmdldCgpXSxcbiAgICAgIFsndmVuZG9yX292ZXJyaWRlcycsIGZiRGIuY29sbGVjdGlvbigndmVuZG9yX292ZXJyaWRlcycpLmdldCgpXSxcbiAgICAgIFsnY3VzdG9tX3JvdXRlcycsIGZiRGIuY29sbGVjdGlvbignY3VzdG9tX3JvdXRlcycpLmdldCgpXSxcbiAgICAgIFsnc2VndWltaWVudG9fbm90ZXMnLCBmYkRiLmNvbGxlY3Rpb24oJ3NlZ3VpbWllbnRvX25vdGVzJykuZ2V0KCldLFxuICAgIF07XG4gICAgY29uc3QgcHJvbWlzZXMgPSBmaXJlc3RvcmVFbnRyaWVzLm1hcCgoWywgcF0pID0+IHApO1xuICAgIHByb21pc2VzLnB1c2goX2ZldGNoU3RvY2tKc29uKCkpO1xuXG4gICAgY29uc3Qgc2V0dGxlZCA9IGF3YWl0IFByb21pc2UuYWxsU2V0dGxlZChwcm9taXNlcyk7XG4gICAgLy8gU2kgQ1VBTFFVSUVSIGdldCgpIGRlIEZpcmVzdG9yZSByZWNoYXpvLCBhYm9ydGFtb3MgKG5vIGV4cG9ydCBwYXJjaWFsIHNpbGVuY2lvc28pLlxuICAgIGNvbnN0IGZhaWxlZEZpcmVzdG9yZSA9IFtdO1xuICAgIHNldHRsZWQuc2xpY2UoMCwgZmlyZXN0b3JlRW50cmllcy5sZW5ndGgpLmZvckVhY2goKHIsIGkpID0+IHtcbiAgICAgIGlmIChyLnN0YXR1cyA9PT0gJ3JlamVjdGVkJylcbiAgICAgICAgZmFpbGVkRmlyZXN0b3JlLnB1c2goXG4gICAgICAgICAgZmlyZXN0b3JlRW50cmllc1tpXVswXSArICc6ICcgKyAoKHIucmVhc29uICYmIHIucmVhc29uLm1lc3NhZ2UpIHx8IHIucmVhc29uKVxuICAgICAgICApO1xuICAgIH0pO1xuICAgIGlmIChmYWlsZWRGaXJlc3RvcmUubGVuZ3RoKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAgICdGaXJlc3RvcmUgZmV0Y2ggZmFsbG8gZW4gJyArXG4gICAgICAgICAgZmFpbGVkRmlyZXN0b3JlLmxlbmd0aCArXG4gICAgICAgICAgJyBjb2xlY2Npb25lczpcXG4nICtcbiAgICAgICAgICBmYWlsZWRGaXJlc3RvcmUuam9pbignXFxuJylcbiAgICAgICk7XG4gICAgfVxuXG4gICAgLy8gMikgRXh0cmFlciBzbmFwc2hvdHMgKyBkb2NzIGNvbiBfaWRcbiAgICBjb25zdCBzbmFwc2hvdHMgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIGFueVtdPn0gKi8gKHt9KTtcbiAgICBmaXJlc3RvcmVFbnRyaWVzLmZvckVhY2goKFtuYW1lXSwgaSkgPT4ge1xuICAgICAgY29uc3Qgc25hcCA9IC8qKiBAdHlwZSB7YW55fSAqLyAoc2V0dGxlZFtpXSkudmFsdWU7XG4gICAgICBjb25zdCBkb2NzID0gW107XG4gICAgICBzbmFwLmZvckVhY2goKGQpID0+IHtcbiAgICAgICAgY29uc3QgZGF0YSA9IGQuZGF0YSgpIHx8IHt9O1xuICAgICAgICBkYXRhLl9pZCA9IGQuaWQ7XG4gICAgICAgIGRvY3MucHVzaChkYXRhKTtcbiAgICAgIH0pO1xuICAgICAgc25hcHNob3RzW25hbWVdID0gZG9jcztcbiAgICB9KTtcbiAgICBjb25zdCBzdG9ja0pzb24gPSAvKiogQHR5cGUge2FueX0gKi8gKHNldHRsZWRbc2V0dGxlZC5sZW5ndGggLSAxXSkudmFsdWU7IC8vIHB1ZWRlIHNlciBudWxsXG5cbiAgICAvLyAzKSBDb25zdHJ1aXIgQ1NWcyBjb24gcm93IGJ1aWxkZXJzICsgc2NoZW1hc1xuICAgIF91cGRhdGVFeHBvcnRQcm9ncmVzcygnU2VyaWFsaXphbmRvIENTVnMuLi4nLCA1NSk7XG4gICAgY29uc3QgY3N2cyA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgc3RyaW5nPn0gKi8gKHt9KTtcbiAgICBjb25zdCByb3dDb3VudHMgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIG51bWJlcj59ICovICh7fSk7XG4gICAgY29uc3QgYWxsUm93c0J5Q3N2ID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBhbnlbXVtdPn0gKi8gKHt9KTtcblxuICAgIGZvciAoY29uc3QgY29sbE5hbWUgb2YgT2JqZWN0LmtleXMoc25hcHNob3RzKSkge1xuICAgICAgY29uc3Qgc2NoZW1hID0gREFUQVNFVF9TQ0hFTUFTW2NvbGxOYW1lXTtcbiAgICAgIGlmICghc2NoZW1hKSBjb250aW51ZTtcbiAgICAgIGNvbnN0IGJ1aWxkZXIgPSBST1dfQlVJTERFUlNbY29sbE5hbWVdO1xuICAgICAgaWYgKCFidWlsZGVyKSBjb250aW51ZTtcbiAgICAgIGNvbnN0IGFsbFJvd3MgPSAvKiogQHR5cGUge2FueVtdW119ICovIChbXSk7XG4gICAgICBmb3IgKGNvbnN0IGRvYyBvZiBzbmFwc2hvdHNbY29sbE5hbWVdKSB7XG4gICAgICAgIGNvbnN0IHJvd3NGb3JEb2MgPSBidWlsZGVyKGRvYyk7XG4gICAgICAgIGZvciAoY29uc3QgciBvZiByb3dzRm9yRG9jKSBhbGxSb3dzLnB1c2gocik7XG4gICAgICB9XG4gICAgICBhbGxSb3dzQnlDc3Zbc2NoZW1hLm5hbWVdID0gYWxsUm93cztcbiAgICAgIGNzdnNbc2NoZW1hLm5hbWVdID0gYnVpbGRDc3Yoc2NoZW1hLCBhbGxSb3dzKTtcbiAgICAgIHJvd0NvdW50c1tzY2hlbWEubmFtZV0gPSBhbGxSb3dzLmxlbmd0aDtcbiAgICB9XG5cbiAgICAvLyBwcm9kdWN0b3MuY3N2IChkZXNkZSBzdG9jay5qc29uLCBubyBGaXJlc3RvcmUpXG4gICAgY29uc3QgcHJvZHVjdG9zU2NoZW1hID0gREFUQVNFVF9TQ0hFTUFTLnByb2R1Y3RvcztcbiAgICBjb25zdCBwcm9kdWN0b3NSb3dzID0gc3RvY2tKc29uID8gYnVpbGRQcm9kdWN0b1Jvd3NGcm9tU3RvY2tKc29uKHN0b2NrSnNvbikgOiBbXTtcbiAgICBhbGxSb3dzQnlDc3ZbcHJvZHVjdG9zU2NoZW1hLm5hbWVdID0gcHJvZHVjdG9zUm93cztcbiAgICBjc3ZzW3Byb2R1Y3Rvc1NjaGVtYS5uYW1lXSA9IGJ1aWxkQ3N2KHByb2R1Y3Rvc1NjaGVtYSwgcHJvZHVjdG9zUm93cyk7XG4gICAgcm93Q291bnRzW3Byb2R1Y3Rvc1NjaGVtYS5uYW1lXSA9IHByb2R1Y3Rvc1Jvd3MubGVuZ3RoO1xuXG4gICAgLy8gNCkgQ29tcHV0YXIgbnVsbFJhdGVCeUZpZWxkIHBhcmEgY2FkYSBjYXNvIEEtRVxuICAgIF91cGRhdGVFeHBvcnRQcm9ncmVzcygnQ2FsY3VsYW5kbyBjYWxpZGFkIGRlbCBkYXRhc2V0Li4uJywgNzUpO1xuICAgIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgYW55Pn0gKi9cbiAgICBjb25zdCB1c2VDYXNlV2l0aFN0YXRzID0ge307XG4gICAgZm9yIChjb25zdCBbY2FzZUtleSwgdWNdIG9mIE9iamVjdC5lbnRyaWVzKERBVEFTRVRfVVNFX0NBU0VfTUFUUklYKSkge1xuICAgICAgY29uc3Qgc3RhdHMgPSAvKiogQHR5cGUge2FueX0gKi8gKHtcbiAgICAgICAgcHJpb3JpdHk6IHVjLnByaW9yaXR5LFxuICAgICAgICBkZXNjcmlwdGlvbjogdWMuZGVzY3JpcHRpb24sXG4gICAgICAgIHJlcXVpcmVkRmllbGRzOiB1Yy5yZXF1aXJlZEZpZWxkcyxcbiAgICAgICAgam9pbk5vdGVzOiB1Yy5qb2luTm90ZXMsXG4gICAgICAgIG51bGxSYXRlQnlGaWVsZDoge30sXG4gICAgICAgIGxpbWl0YXRpb25zOiBbXSxcbiAgICAgIH0pO1xuICAgICAgbGV0IGhhc0hpZ2hOdWxsUmF0ZSA9IGZhbHNlO1xuICAgICAgbGV0IGhhc0VtcHR5UmVxdWlyZWQgPSBmYWxzZTtcbiAgICAgIGZvciAoY29uc3QgW2Nzdk5hbWUsIGZpZWxkc10gb2YgT2JqZWN0LmVudHJpZXModWMucmVxdWlyZWRGaWVsZHMpKSB7XG4gICAgICAgIGNvbnN0IHNjaGVtYUZvckNzdiA9IE9iamVjdC52YWx1ZXMoREFUQVNFVF9TQ0hFTUFTKS5maW5kKChzKSA9PiBzLm5hbWUgPT09IGNzdk5hbWUpO1xuICAgICAgICBpZiAoIXNjaGVtYUZvckNzdikge1xuICAgICAgICAgIHN0YXRzLmxpbWl0YXRpb25zLnB1c2goJ1NjaGVtYSBubyBlbmNvbnRyYWRvIHBhcmEgJyArIGNzdk5hbWUpO1xuICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG4gICAgICAgIGNvbnN0IHJvd3MgPSBhbGxSb3dzQnlDc3ZbY3N2TmFtZV0gfHwgW107XG4gICAgICAgIGNvbnN0IHJhdGVzID0gY29tcHV0ZU51bGxSYXRlcyhzY2hlbWFGb3JDc3YsIHJvd3MsIGZpZWxkcyk7XG4gICAgICAgIGZvciAoY29uc3QgW2YsIHJhdGVdIG9mIE9iamVjdC5lbnRyaWVzKHJhdGVzKSkge1xuICAgICAgICAgIHN0YXRzLm51bGxSYXRlQnlGaWVsZFtjc3ZOYW1lICsgJy4nICsgZl0gPSByYXRlO1xuICAgICAgICAgIGlmIChyb3dzLmxlbmd0aCA9PT0gMCkgaGFzRW1wdHlSZXF1aXJlZCA9IHRydWU7XG4gICAgICAgICAgZWxzZSBpZiAocmF0ZSA+IDAuNSkgaGFzSGlnaE51bGxSYXRlID0gdHJ1ZTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgaWYgKGhhc0VtcHR5UmVxdWlyZWQpIHtcbiAgICAgICAgc3RhdHMuc3RhdHVzID0gJ0VNUFRZJztcbiAgICAgICAgc3RhdHMubGltaXRhdGlvbnMucHVzaChcbiAgICAgICAgICAnQWxndW5hIGNvbGVjY2lvbiByZXF1ZXJpZGEgZXN0YSB2YWNpYSBcdTIwMTQgZWwgY2FzbyBubyBzZSBwdWVkZSBlbnRyZW5hciBob3kgcGVybyBlbCBzY2hlbWEgZXN0YSBsaXN0by4nXG4gICAgICAgICk7XG4gICAgICB9IGVsc2UgaWYgKGhhc0hpZ2hOdWxsUmF0ZSkge1xuICAgICAgICBzdGF0cy5zdGF0dXMgPSAnUEFSVElBTCc7XG4gICAgICAgIHN0YXRzLmxpbWl0YXRpb25zLnB1c2goXG4gICAgICAgICAgJ0FsIG1lbm9zIDEgY2FtcG8gcmVxdWVyaWRvIHRpZW5lID41MCUgZGUgbnVsbHMgXHUyMDE0IHJldmlzYXIgdGFzYXMgYW50ZXMgZGUgdXNhci4nXG4gICAgICAgICk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBzdGF0cy5zdGF0dXMgPSAnT0snO1xuICAgICAgfVxuICAgICAgdXNlQ2FzZVdpdGhTdGF0c1tjYXNlS2V5XSA9IHN0YXRzO1xuICAgIH1cblxuICAgIC8vIDUpIE1hbmlmZXN0Lmpzb25cbiAgICBjb25zdCBleHBvcnRlZEF0ID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpO1xuICAgIGNvbnN0IG1hbmlmZXN0ID0ge1xuICAgICAgZXhwb3J0ZWRBdCxcbiAgICAgIGFwcFZlcnNpb246IHR5cGVvZiBBUFBfVkVSU0lPTiAhPT0gJ3VuZGVmaW5lZCcgPyBBUFBfVkVSU0lPTiA6ICd1bmtub3duJyxcbiAgICAgIHNvdXJjZVByb2plY3Q6ICdhcHAtdmVuZGVkb3Jlcy1zaGltYW5vJyxcbiAgICAgIGV4cG9ydGVkQnlFbWFpbDogKGN1cnJlbnRVc2VyICYmIGN1cnJlbnRVc2VyLmVtYWlsKSB8fCAndW5rbm93bicsXG4gICAgICBleHBvcnRlZEJ5VWlkOiAoY3VycmVudFVzZXIgJiYgY3VycmVudFVzZXIudWlkKSB8fCAndW5rbm93bicsXG4gICAgICBjc3ZDb252ZW50aW9uczoge1xuICAgICAgICBlbmNvZGluZzogJ1VURi04JyxcbiAgICAgICAgc2VwYXJhdG9yOiAnLCcsXG4gICAgICAgIHF1b3RlQ2hhcjogJ1wiJyxcbiAgICAgICAgZXNjYXBlUXVvdGU6ICdcIlwiJyxcbiAgICAgICAgbGluZVRlcm1pbmF0b3I6ICdcXFxcclxcXFxuJyxcbiAgICAgICAgZGF0ZUZvcm1hdDogJ0lTTyA4NjAxIFVUQyAod2l0aCBaKScsXG4gICAgICAgIGRlY2ltYWxTZXBhcmF0b3I6ICcuJyxcbiAgICAgICAgbnVsbFJlcHJlc2VudGF0aW9uOiAnKGVtcHR5IGZpZWxkKScsXG4gICAgICAgIGFycmF5Rm9ybWF0OiAnSlNPTiBzdHJpbmdpZmllZCcsXG4gICAgICAgIG9iamVjdEZvcm1hdDogJ0pTT04gc3RyaW5naWZpZWQnLFxuICAgICAgfSxcbiAgICAgIHJvd0NvdW50cyxcbiAgICAgIHNjaGVtYToge30sXG4gICAgICB1c2VDYXNlTWF0cml4OiB1c2VDYXNlV2l0aFN0YXRzLFxuICAgICAgZXhjbHVzaW9uczoge1xuICAgICAgICBub3RlOiAnRGF0b3Mgc2Vuc2libGVzIHkgYmluYXJpb3MgZXhjbHVpZG9zIGRlbCBleHBvcnQuJyxcbiAgICAgICAgZXhjbHVkZWRDb2xsZWN0aW9uczogW1xuICAgICAgICAgICdyb2xlcycsXG4gICAgICAgICAgJ2FwcF9jb25maWcnLFxuICAgICAgICAgICdzYXBfc25hcHNob3QnLFxuICAgICAgICAgICdub3RpZmljYXRpb25zJyxcbiAgICAgICAgICAnb3BlcmF0aW9uc19sb2cnLFxuICAgICAgICBdLFxuICAgICAgICBleGNsdWRlZEZpZWxkczogW1xuICAgICAgICAgICd2aXNpdHMuZnJlbnRlTG9jYWwgKGZvdG9zIGJhc2U2NCknLFxuICAgICAgICAgICd2aXNpdHMuZXNwYWNpb1tdIChmb3RvcyBiYXNlNjQpJyxcbiAgICAgICAgICAnY2xpZW50X2FwcGxpY2F0aW9ucy5jb25zdGFuY2lhQXJjYSAoYmFzZTY0KScsXG4gICAgICAgICAgJ2NsaWVudF9hcHBsaWNhdGlvbnMuY29uc3RhbmNpYUlJQkIgKGJhc2U2NCknLFxuICAgICAgICAgICdjbGllbnRfYXBwbGljYXRpb25zLmZvdG9zTG9jYWxbXSAoYmFzZTY0KScsXG4gICAgICAgICAgJ3JlbmRpY2lvbmVzLmZvdG9UaWNrZXQgKGJhc2U2NCBsZWdhY3kgcHJlLXYzMDg7IHNlIGV4cG9ydGEgc29sbyBmb3RvVGlja2V0VXJsKScsXG4gICAgICAgIF0sXG4gICAgICAgIHN0b2NrSnNvbkxvYWRlZDogc3RvY2tKc29uICE9PSBudWxsLFxuICAgICAgfSxcbiAgICB9O1xuICAgIGZvciAoY29uc3QgW19jb2xsTmFtZSwgc2NoZW1hXSBvZiBPYmplY3QuZW50cmllcyhEQVRBU0VUX1NDSEVNQVMpKSB7XG4gICAgICBtYW5pZmVzdC5zY2hlbWFbc2NoZW1hLm5hbWVdID0gc2NoZW1hLmNvbHVtbnMubWFwKChjKSA9PiAoe1xuICAgICAgICBjb2w6IGMuY29sLFxuICAgICAgICB0eXBlOiBjLnR5cGUsXG4gICAgICAgIGRlc2M6IGMuZGVzYyxcbiAgICAgIH0pKTtcbiAgICB9XG5cbiAgICAvLyA2KSBFbXBhcXVldGFyIFpJUFxuICAgIF91cGRhdGVFeHBvcnRQcm9ncmVzcygnRW1wYXF1ZXRhbmRvIFpJUC4uLicsIDkwKTtcbiAgICBjb25zdCB6aXAgPSBuZXcgSlNaaXAoKTtcbiAgICBmb3IgKGNvbnN0IFtuYW1lLCBjb250ZW50XSBvZiBPYmplY3QuZW50cmllcyhjc3ZzKSkge1xuICAgICAgemlwLmZpbGUobmFtZSwgY29udGVudCk7XG4gICAgfVxuICAgIHppcC5maWxlKCdtYW5pZmVzdC5qc29uJywgSlNPTi5zdHJpbmdpZnkobWFuaWZlc3QsIG51bGwsIDIpKTtcblxuICAgIGNvbnN0IGJsb2IgPSBhd2FpdCB6aXAuZ2VuZXJhdGVBc3luYyh7XG4gICAgICB0eXBlOiAnYmxvYicsXG4gICAgICBjb21wcmVzc2lvbjogJ0RFRkxBVEUnLFxuICAgICAgY29tcHJlc3Npb25PcHRpb25zOiB7IGxldmVsOiA2IH0sXG4gICAgfSk7XG4gICAgY29uc3QgZmlsZW5hbWUgPSAnc2hpbWFuby1kYXRhc2V0LScgKyBleHBvcnRlZEF0LnJlcGxhY2UoL1s6Ll0vZywgJy0nKSArICcuemlwJztcbiAgICBfZG93bmxvYWRCbG9iKGJsb2IsIGZpbGVuYW1lKTtcblxuICAgIF91cGRhdGVFeHBvcnRQcm9ncmVzcyhcbiAgICAgICdEYXRhc2V0IGRlc2NhcmdhZG86ICcgK1xuICAgICAgICBmaWxlbmFtZSArXG4gICAgICAgICcgKCcgK1xuICAgICAgICBPYmplY3Qua2V5cyhjc3ZzKS5sZW5ndGggK1xuICAgICAgICAnIENTVnMgKyBtYW5pZmVzdC5qc29uKScsXG4gICAgICAxMDBcbiAgICApO1xuICAgIGlmICh0eXBlb2Ygc2hvd1N5bmNUYWcgPT09ICdmdW5jdGlvbicpIHtcbiAgICAgIGNvbnN0IHRvdGFsUm93cyA9IE9iamVjdC52YWx1ZXMocm93Q291bnRzKS5yZWR1Y2UoKGEsIGIpID0+IGEgKyBiLCAwKTtcbiAgICAgIHNob3dTeW5jVGFnKFxuICAgICAgICAnRGF0YXNldCBleHBvcnRhZG86ICcgKyB0b3RhbFJvd3MgKyAnIGZpbGFzIGVuICcgKyBPYmplY3Qua2V5cyhjc3ZzKS5sZW5ndGggKyAnIENTVnMnXG4gICAgICApO1xuICAgIH1cbiAgICBzZXRUaW1lb3V0KCgpID0+IHdpbmRvdy5jbG9zZUV4cG9ydEZvcm1hdE1vZGFsKCksIDMwMDApO1xuICB9IGNhdGNoIChlKSB7XG4gICAgY29uc29sZS5lcnJvcignW2V4cG9ydERhdGFzZXRaaXBdIGZhdGFsOicsIGUpO1xuICAgIF91cGRhdGVFeHBvcnRQcm9ncmVzcygnRXJyb3I6ICcgKyAoKGUgJiYgZS5tZXNzYWdlKSB8fCBlKSwgMCk7XG4gICAgYWxlcnQoXG4gICAgICAnRXJyb3IgYWwgZXhwb3J0YXIgZWwgZGF0YXNldDpcXG5cXG4nICtcbiAgICAgICAgKChlICYmIGUubWVzc2FnZSkgfHwgZSkgK1xuICAgICAgICAnXFxuXFxuRWwgWklQIE5PIHNlIGRlc2NhcmdvIChldml0YW1vcyBnZW5lcmFyIHVuIGFyY2hpdm8gcGFyY2lhbCkuIFJldmlzYSBsYSBjb25zb2xhIHBhcmEgbWFzIGRldGFsbGVzLidcbiAgICApO1xuICB9XG59O1xuXG4vLyA9PT0gRXhwb3J0cyBhIHdpbmRvdyA9PT1cbi8vIFRvZGFzIGxhcyBmdW5jaW9uZXMgd2luZG93LmZvbyA9IGZ1bmN0aW9uLi4uIHlhIGVzdFx1MDBFMW4gdmVyYmF0aW0uXG5pZiAodHlwZW9mIHdpbmRvdy50b2RheVN0ciA9PT0gJ3VuZGVmaW5lZCcpIHdpbmRvdy50b2RheVN0ciA9IHRvZGF5U3RyO1xuLy8gRTYgaG90Zml4IDI6IGRhdGFVcmxUb0Jsb2IgKyBzYW5pdGl6ZUZvclBhdGggdXNhZG9zIHBvciBpbmxpbmUgcnVuRnVsbEJhY2t1cCAoTDcyNzgtNzI4OCkuXG5pZiAodHlwZW9mIHdpbmRvdy5kYXRhVXJsVG9CbG9iID09PSAndW5kZWZpbmVkJykgd2luZG93LmRhdGFVcmxUb0Jsb2IgPSBkYXRhVXJsVG9CbG9iO1xuaWYgKHR5cGVvZiB3aW5kb3cuc2FuaXRpemVGb3JQYXRoID09PSAndW5kZWZpbmVkJykgd2luZG93LnNhbml0aXplRm9yUGF0aCA9IHNhbml0aXplRm9yUGF0aDtcbi8vIEU2IGhvdGZpeCAzOiBjcm9zcy1tb2R1bGUgYnVnIChhdWRpdCBjcm9zc2J1bmRsZSkgXHUyMDE0IGV4cG9ydHMtY29yZSBsbGFtYSBsb2FkRXhjZWxKUy5cbndpbmRvdy5sb2FkRXhjZWxKUyA9IGxvYWRFeGNlbEpTO1xuIl0sCiAgIm1hcHBpbmdzIjogIjs7O0FBb0NPLFdBQVMsVUFBVSxHQUFHO0FBQzNCLFFBQUksTUFBTSxRQUFRLE1BQU0sT0FBVyxRQUFPO0FBQzFDLFVBQU0sTUFBTSxPQUFPLENBQUM7QUFDcEIsUUFBSSxRQUFRLEdBQUksUUFBTztB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
