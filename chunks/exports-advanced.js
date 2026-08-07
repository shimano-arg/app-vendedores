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
      p.clients.forEach(
        (n) => dimC.push({
          cliente: n,
          tipo: "Cliente actual",
          provincia: titleCase(p.province),
          localidad: p.name,
          departamento: p.dept || "",
          vendedor_key: p.vendor || "",
          zona: vm ? vm.zone : ""
        })
      );
      p.prospects.forEach(
        (n) => dimC.push({
          cliente: n,
          tipo: "Prospecto",
          provincia: titleCase(p.province),
          localidad: p.name,
          departamento: p.dept || "",
          vendedor_key: p.vendor || "",
          zona: vm ? vm.zone : ""
        })
      );
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
      p.clients.forEach(
        (n) => universe.push({
          cliente: n,
          tipo: "cliente_actual",
          provincia: titleCase(p.province),
          localidad: p.name,
          departamento: p.dept || "",
          vendedor: titleCase(p.vendor || ""),
          zona: vm ? vm.zone : "",
          lat: p.lat,
          lon: p.lon
        })
      );
      p.prospects.forEach(
        (n) => universe.push({
          cliente: n,
          tipo: "prospecto",
          provincia: titleCase(p.province),
          localidad: p.name,
          departamento: p.dept || "",
          vendedor: titleCase(p.vendor || ""),
          zona: vm ? vm.zone : "",
          lat: p.lat,
          lon: p.lon
        })
      );
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL3B1cmUvY3N2LXNlcmlhbGl6ZXIuanMiLCAiLi4vc3JjL2RvbWFpbnMvZXhwb3J0cy1hZHZhbmNlZC5qcyJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiLy8gQHRzLWNoZWNrXG4vKipcbiAqIENTViBzZXJpYWxpemVyICsgZGF0YXNldCBzY2hlbWFzICsgcm93IGJ1aWxkZXJzIFx1MjAxNCBwYXJhIGV4cG9ydERhdGFzZXRaaXBcbiAqICh2MzcxKykuIEZ1bmNpb25lcyBwdXJhcywgdGVzdGVhYmxlcyBzaW4gZ2xvYmFscyBkZWwgYnVuZGxlLlxuICpcbiAqIDUgY2Fzb3MgZGUgdXNvIE1MIGRvY3VtZW50YWRvcyBlbiBEQVRBU0VUX1VTRV9DQVNFX01BVFJJWDpcbiAqICAgQSkgQ29udmVyc2lvbiB2aXNpdGEtPnBlZGlkbyAocHJpb3JpZGFkIDEsIGNsYXNpZmljYWNpb24pXG4gKiAgIEIpIFJpZXNnbyBkZSBjaHVybiBkZSBjbGllbnRlcyAocHJpb3JpZGFkIDIsIGFsZXJ0YSlcbiAqICAgQykgRm9yZWNhc3QgZGUgZGVtYW5kYSBwb3IgU0tVIChwcmlvcmlkYWQgMywgc2VyaWVzIHRlbXBvcmFsZXMpXG4gKiAgIEQpIEFub21hbGlhcyBlbiByZW5kaWNpb25lcyAoZXhwbG9yYXRvcmlvKVxuICogICBFKSBFc3RhY2lvbmFsaWRhZCBwb3Igem9uYS9jYW1wYW5hIChleHBsb3JhdG9yaW8pXG4gKlxuICogQ29udmVuY2lvbmVzIChSRkMgNDE4MCArIGFkYXB0YWNpb25lcyBwYXJhIE1MIHBpcGVsaW5lcyk6XG4gKiAgIC0gU2VwYXJhdG9yOiBcIixcIlxuICogICAtIFF1b3RlIGNoYXI6IFwiXFxcIlwiXG4gKiAgIC0gRXNjYXBlIHF1b3RlOiBcIlxcXCJcXFwiXCJcbiAqICAgLSBMaW5lIHRlcm1pbmF0b3I6IFwiXFxyXFxuXCJcbiAqICAgLSBFbmNvZGluZzogVVRGLTggKEJPTSBvcGNpb25hbCBhbCBlc2NyaWJpciBlbCBaSVApXG4gKiAgIC0gRmVjaGFzOiBJU08gODYwMSBVVEMgKGNvbiBcIlpcIiBhbCBmaW5hbClcbiAqICAgLSBEZWNpbWFsZXM6IHB1bnRvIChcIi5cIilcbiAqICAgLSBOdWxsL3VuZGVmaW5lZDogY2FtcG8gdmFjaW8gKE5PIFwiTi9BXCIsIFwiLVwiLCBcIm51bGxcIilcbiAqICAgLSBBcnJheXMgLT4gSlNPTi5zdHJpbmdpZnkgZW50cmUgY29taWxsYXMgZG9ibGVzXG4gKiAgIC0gT2JqZXRvcyAoZXhjZXB0byBUaW1lc3RhbXAgeSBEYXRlKSAtPiBKU09OLnN0cmluZ2lmeVxuICogICAtIEZpcmVzdG9yZSBUaW1lc3RhbXBzIC0+IHRvRGF0ZSgpLnRvSVNPU3RyaW5nKClcbiAqL1xuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIEhlbHBlcnMgQ1NWIHB1cm9zXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuLyoqXG4gKiBFc2NhcGEgdW4gdmFsb3Igc3RyaW5nIHBhcmEgQ1NWIFJGQyA0MTgwLiBXcmFwcGVhIGNvbiBcIi4uLlwiIHNpIGNvbnRpZW5lXG4gKiBcIixcIiwgXCJcXFwiXCIsIFwiXFxyXCIgbyBcIlxcblwiLiBFc2NhcGEgXCJcXFwiXCIgLT4gXCJcXFwiXFxcIlwiLlxuICogQHBhcmFtIHtzdHJpbmd9IHNcbiAqIEByZXR1cm5zIHtzdHJpbmd9XG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjc3ZFc2NhcGUocykge1xuICBpZiAocyA9PT0gbnVsbCB8fCBzID09PSB1bmRlZmluZWQpIHJldHVybiAnJztcbiAgY29uc3Qgc3RyID0gU3RyaW5nKHMpO1xuICBpZiAoc3RyID09PSAnJykgcmV0dXJuICcnO1xuICAvLyBOZWNlc2l0YSBxdW90aW5nIHNpIHRpZW5lIGNvbWEsIHF1b3RlLCBvIGxpbmUtYnJlYWtcbiAgaWYgKC9bXCIsXFxyXFxuXS8udGVzdChzdHIpKSB7XG4gICAgcmV0dXJuICdcIicgKyBzdHIucmVwbGFjZSgvXCIvZywgJ1wiXCInKSArICdcIic7XG4gIH1cbiAgcmV0dXJuIHN0cjtcbn1cblxuLyoqXG4gKiBDb252aWVydGUgdW4gYXJyYXkgZGUgdmFsb3JlcyBlbiB1bmEgbGluZWEgQ1NWIChzaW4gdHJhaWxpbmcgbmV3bGluZSkuXG4gKiBBcGxpY2EgY3N2RXNjYXBlIGEgY2FkYSBjYW1wbyBkZXNwdWVzIGRlIGZpcmVzdG9yZVZhbHVlVG9Dc3YuXG4gKiBAcGFyYW0ge3Vua25vd25bXX0gZmllbGRzXG4gKiBAcmV0dXJucyB7c3RyaW5nfVxuICovXG5leHBvcnQgZnVuY3Rpb24gY3N2Um93KGZpZWxkcykge1xuICByZXR1cm4gZmllbGRzLm1hcCgoZikgPT4gY3N2RXNjYXBlKGZpcmVzdG9yZVZhbHVlVG9Dc3YoZikpKS5qb2luKCcsJyk7XG59XG5cbi8qKlxuICogQ29udmllcnRlIHVuIHZhbG9yIGRlIEZpcmVzdG9yZS9KUyBhIHN0cmluZyBhcHRvIHBhcmEgQ1NWLlxuICogUmVnbGEgcG9yIHRpcG86XG4gKiAgIC0gbnVsbCAvIHVuZGVmaW5lZCAtPiAnJ1xuICogICAtIEZpcmVzdG9yZSBUaW1lc3RhbXAgKHRpZW5lIC50b0RhdGUpIC0+IElTTyA4NjAxIFVUQ1xuICogICAtIERhdGUgLT4gSVNPIDg2MDEgVVRDXG4gKiAgIC0gYm9vbGVhbiAtPiAndHJ1ZScgLyAnZmFsc2UnXG4gKiAgIC0gbnVtYmVyIC0+IFN0cmluZyhuKSBjb24gcHVudG8gZGVjaW1hbFxuICogICAtIHN0cmluZyAtPiB0YWwgY3VhbCAoY3N2RXNjYXBlIHdyYXBwZWEgc2kgaGFjZSBmYWx0YSlcbiAqICAgLSBBcnJheSAtPiBKU09OLnN0cmluZ2lmeVxuICogICAtIE9iamVjdCAtPiBKU09OLnN0cmluZ2lmeVxuICogQHBhcmFtIHt1bmtub3dufSB2XG4gKiBAcmV0dXJucyB7c3RyaW5nfVxuICovXG5leHBvcnQgZnVuY3Rpb24gZmlyZXN0b3JlVmFsdWVUb0Nzdih2KSB7XG4gIGlmICh2ID09PSBudWxsIHx8IHYgPT09IHVuZGVmaW5lZCkgcmV0dXJuICcnO1xuICBpZiAodHlwZW9mIHYgPT09ICdzdHJpbmcnKSByZXR1cm4gdjtcbiAgaWYgKHR5cGVvZiB2ID09PSAnbnVtYmVyJykge1xuICAgIGlmICghTnVtYmVyLmlzRmluaXRlKHYpKSByZXR1cm4gJyc7IC8vIE5hTiwgSW5maW5pdHkgLT4gdmFjaW8gKG5vIGNvbmZ1bmRpciBwaXBlbGluZXMpXG4gICAgcmV0dXJuIFN0cmluZyh2KTtcbiAgfVxuICBpZiAodHlwZW9mIHYgPT09ICdib29sZWFuJykgcmV0dXJuIHYgPyAndHJ1ZScgOiAnZmFsc2UnO1xuICAvLyBGaXJlc3RvcmUgVGltZXN0YW1wXG4gIGlmIChcbiAgICB0eXBlb2YgdiA9PT0gJ29iamVjdCcgJiZcbiAgICB2ICE9PSBudWxsICYmXG4gICAgdHlwZW9mICgvKiogQHR5cGUge2FueX0gKi8gKHYpLnRvRGF0ZSkgPT09ICdmdW5jdGlvbidcbiAgKSB7XG4gICAgdHJ5IHtcbiAgICAgIHJldHVybiAvKiogQHR5cGUge2FueX0gKi8gKHYpLnRvRGF0ZSgpLnRvSVNPU3RyaW5nKCk7XG4gICAgfSBjYXRjaCAoXykge1xuICAgICAgcmV0dXJuICcnO1xuICAgIH1cbiAgfVxuICBpZiAodiBpbnN0YW5jZW9mIERhdGUpIHtcbiAgICBpZiAoTnVtYmVyLmlzTmFOKHYuZ2V0VGltZSgpKSkgcmV0dXJuICcnO1xuICAgIHJldHVybiB2LnRvSVNPU3RyaW5nKCk7XG4gIH1cbiAgaWYgKEFycmF5LmlzQXJyYXkodikpIHtcbiAgICAvLyBKU09OLnN0cmluZ2lmeSBkZSBhcnJheS4gY3N2RXNjYXBlIGx1ZWdvIGxvIHdyYXBwZWEgc2kgaGF5IGNvbWFzLlxuICAgIHRyeSB7XG4gICAgICByZXR1cm4gSlNPTi5zdHJpbmdpZnkodik7XG4gICAgfSBjYXRjaCAoXykge1xuICAgICAgcmV0dXJuICcnO1xuICAgIH1cbiAgfVxuICBpZiAodHlwZW9mIHYgPT09ICdvYmplY3QnKSB7XG4gICAgdHJ5IHtcbiAgICAgIHJldHVybiBKU09OLnN0cmluZ2lmeSh2KTtcbiAgICB9IGNhdGNoIChfKSB7XG4gICAgICByZXR1cm4gJyc7XG4gICAgfVxuICB9XG4gIHJldHVybiBTdHJpbmcodik7XG59XG5cbi8qKlxuICogT2J0aWVuZSBlbCB2YWxvciBkZSB1biBwYXRoIGRvdC1ub3RhdGlvbiBlbiB1biBvYmpldG8gYW5pZGFkby5cbiAqIEVqOiBnZXRQYXRoKHthOiB7Yjoge2M6IDF9fX0sICdhLmIuYycpIC0+IDFcbiAqIGdldFBhdGgoe30sICdhLmInKSAtPiB1bmRlZmluZWRcbiAqIEBwYXJhbSB7b2JqZWN0fSBvYmpcbiAqIEBwYXJhbSB7c3RyaW5nfSBwYXRoXG4gKiBAcmV0dXJucyB7dW5rbm93bn1cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGdldFBhdGgob2JqLCBwYXRoKSB7XG4gIGlmICghb2JqIHx8ICFwYXRoKSByZXR1cm4gdW5kZWZpbmVkO1xuICBjb25zdCBwYXJ0cyA9IHBhdGguc3BsaXQoJy4nKTtcbiAgbGV0IGN1ciA9IC8qKiBAdHlwZSB7YW55fSAqLyAob2JqKTtcbiAgZm9yIChjb25zdCBwIG9mIHBhcnRzKSB7XG4gICAgaWYgKGN1ciA9PT0gbnVsbCB8fCBjdXIgPT09IHVuZGVmaW5lZCkgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICBjdXIgPSBjdXJbcF07XG4gIH1cbiAgcmV0dXJuIGN1cjtcbn1cblxuLyoqXG4gKiBDb25zdHJ1eWUgZWwgQ1NWIGNvbXBsZXRvIChoZWFkZXIgKyBOIHJvd3MpIHBhcmEgdW5hIGNvbGVjY2lvbiBzZWd1blxuICogc3Ugc2NoZW1hLiBDYWRhIGJ1aWxkZXIgZGV2dWVsdmUgdW4gYXJyYXkgZGUgZmlsYXMgKGNhZGEgZmlsYSA9IGFycmF5XG4gKiBkZSB2YWxvcmVzIGVuIGVsIG9yZGVuIGRlbCBzY2hlbWEpLlxuICogQHBhcmFtIHt7Y29sdW1uczoge2NvbDogc3RyaW5nfVtdfX0gc2NoZW1hXG4gKiBAcGFyYW0ge3Vua25vd25bXVtdfSByb3dzXG4gKiBAcmV0dXJucyB7c3RyaW5nfSBDU1YgY29tcGxldG8gY29uIFxcclxcbiBjb21vIGxpbmUgc2VwYXJhdG9yXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBidWlsZENzdihzY2hlbWEsIHJvd3MpIHtcbiAgY29uc3QgaGVhZGVyID0gc2NoZW1hLmNvbHVtbnMubWFwKChjKSA9PiBjc3ZFc2NhcGUoYy5jb2wpKS5qb2luKCcsJyk7XG4gIGNvbnN0IGJvZHkgPSByb3dzLm1hcCgocikgPT4gY3N2Um93KHIpKS5qb2luKCdcXHJcXG4nKTtcbiAgcmV0dXJuIGJvZHkubGVuZ3RoID8gaGVhZGVyICsgJ1xcclxcbicgKyBib2R5ICsgJ1xcclxcbicgOiBoZWFkZXIgKyAnXFxyXFxuJztcbn1cblxuLyoqXG4gKiBDdWVudGEgbnVsbCByYXRlIHBvciBjb2x1bW5hIHJlcXVlcmlkYS4gUmV0b3JuYVxuICoge2NvbE5hbWU6IHJhdGUgMC4uMX0uIFVuIHZhbG9yIGVzIFwibnVsbFwiIHNpIGZpcmVzdG9yZVZhbHVlVG9Dc3YgZGV2dWVsdmUgJycuXG4gKiBAcGFyYW0ge3tjb2x1bW5zOiB7Y29sOiBzdHJpbmd9W119fSBzY2hlbWFcbiAqIEBwYXJhbSB7dW5rbm93bltdW119IHJvd3NcbiAqIEBwYXJhbSB7c3RyaW5nW119IHJlcXVpcmVkQ29sc1xuICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIG51bWJlcj59XG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjb21wdXRlTnVsbFJhdGVzKHNjaGVtYSwgcm93cywgcmVxdWlyZWRDb2xzKSB7XG4gIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgbnVtYmVyPn0gKi9cbiAgY29uc3QgcmVzdWx0ID0ge307XG4gIGlmICghcm93cy5sZW5ndGgpIHtcbiAgICAvLyBzaW4gZGF0b3M6IG51bGwgcmF0ZSA9IDEgKDEwMCUgZmFsdGEpIHBhcmEgY2FkYSBjYW1wbyByZXF1ZXJpZG9cbiAgICBmb3IgKGNvbnN0IGMgb2YgcmVxdWlyZWRDb2xzKSByZXN1bHRbY10gPSAxO1xuICAgIHJldHVybiByZXN1bHQ7XG4gIH1cbiAgY29uc3QgY29sSW5kZXggPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIG51bWJlcj59ICovICh7fSk7XG4gIHNjaGVtYS5jb2x1bW5zLmZvckVhY2goKGMsIGkpID0+IHtcbiAgICBjb2xJbmRleFtjLmNvbF0gPSBpO1xuICB9KTtcbiAgZm9yIChjb25zdCByYyBvZiByZXF1aXJlZENvbHMpIHtcbiAgICBjb25zdCBpZHggPSBjb2xJbmRleFtyY107XG4gICAgaWYgKGlkeCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICByZXN1bHRbcmNdID0gMTsgLy8gY29sdW1uYSBubyBleGlzdGUgZW4gc2NoZW1hIC0+IGNvbnNpZGVyYXIgY29tbyAxMDAlIG51bGxcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBsZXQgbnVsbHMgPSAwO1xuICAgIGZvciAoY29uc3Qgcm93IG9mIHJvd3MpIHtcbiAgICAgIGNvbnN0IHYgPSByb3dbaWR4XTtcbiAgICAgIGlmIChmaXJlc3RvcmVWYWx1ZVRvQ3N2KHYpID09PSAnJykgbnVsbHMrKztcbiAgICB9XG4gICAgcmVzdWx0W3JjXSA9IE1hdGgucm91bmQoKG51bGxzIC8gcm93cy5sZW5ndGgpICogMTAwMDApIC8gMTAwMDA7XG4gIH1cbiAgcmV0dXJuIHJlc3VsdDtcbn1cblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBEQVRBU0VUX1NDSEVNQVMgXHUyMDE0IDExIGNvbGVjY2lvbmVzIGNvbiBjb2x1bW5hcyArIHRpcG9zICsgZGVzY3JpcGNpb25lc1xuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbi8qKiBAdHlwZWRlZiB7e2NvbDogc3RyaW5nLCB0eXBlOiBzdHJpbmcsIGRlc2M6IHN0cmluZ319IFNjaGVtYUNvbHVtbiAqL1xuLyoqIEB0eXBlZGVmIHt7bmFtZTogc3RyaW5nLCBzb3VyY2U6ICdmaXJlc3RvcmUnfCdzdG9ja19qc29uJywgY29sbGVjdGlvbj86IHN0cmluZywgcm93TW9kZTogc3RyaW5nLCBjb2x1bW5zOiBTY2hlbWFDb2x1bW5bXX19IERhdGFzZXRTY2hlbWEgKi9cblxuLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBEYXRhc2V0U2NoZW1hPn0gKi9cbmV4cG9ydCBjb25zdCBEQVRBU0VUX1NDSEVNQVMgPSB7XG4gIHBlZGlkb3M6IHtcbiAgICBuYW1lOiAncGVkaWRvcy5jc3YnLFxuICAgIHNvdXJjZTogJ2ZpcmVzdG9yZScsXG4gICAgY29sbGVjdGlvbjogJ3BlZGlkb3MnLFxuICAgIHJvd01vZGU6ICdmbGF0dGVuX2xpbmVzJywgLy8gMSBmaWxhIHBvciAocGVkaWRvLCBsaW5lYSlcbiAgICBjb2x1bW5zOiBbXG4gICAgICB7IGNvbDogJ3BlZGlkb19pZCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnRmlyZXN0b3JlIGRvYyBJRCcgfSxcbiAgICAgIHsgY29sOiAnb3duZXJfdWlkJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdVSUQgZGVsIHZlbmRlZG9yIGR1ZW5pbyBkZWwgcGVkaWRvJyB9LFxuICAgICAgeyBjb2w6ICdvd25lcl9lbWFpbCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnZW1haWwgZGVsIHZlbmRlZG9yJyB9LFxuICAgICAgeyBjb2w6ICdjcmVhdGVkX2J5X3VpZCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAncXVpZW4gY2FyZ28gKFZESSBwdWVkZSBjYXJnYXIgcG9yIFZERSknIH0sXG4gICAgICB7IGNvbDogJ29uX2JlaGFsZl9vZicsIHR5cGU6ICdib29sZWFuJywgZGVzYzogJ3RydWUgc2kgVkRJIGNhcmdvIHBvciBWREUnIH0sXG4gICAgICB7IGNvbDogJ2tleScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnY2xhdmUgY29tcHVlc3RhIHRpcG98cHJvdnxsb2N8Y2xpZW50ZScgfSxcbiAgICAgIHsgY29sOiAnc3RhZ2UnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ3BlbmRpbmcgfCBjb25maXJtZWQgfCBzYXBfaW1wb3J0ZWQnIH0sXG4gICAgICB7IGNvbDogJ3RpcG8nLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ0M9Y2xpZW50ZSB8IFA9cHJvc3BlY3RvJyB9LFxuICAgICAgeyBjb2w6ICdwcm92aW5jZScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAncHJvdmluY2lhJyB9LFxuICAgICAgeyBjb2w6ICdsb2NfbmFtZScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnbG9jYWxpZGFkJyB9LFxuICAgICAgeyBjb2w6ICdjbGllbnRfbmFtZScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnbm9tYnJlIGNsaWVudGUnIH0sXG4gICAgICB7IGNvbDogJ21vbnRoJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdlaiBcIkp1bGlvIDIwMjZcIicgfSxcbiAgICAgIHsgY29sOiAnbW9udGhfaWR4JywgdHlwZTogJ2ludCcsIGRlc2M6ICcwLTExJyB9LFxuICAgICAgeyBjb2w6ICd5ZWFyJywgdHlwZTogJ2ludCcsIGRlc2M6ICdhbm8nIH0sXG4gICAgICB7IGNvbDogJ2NvbmZpcm1lZF9hdCcsIHR5cGU6ICdpc284NjAxJywgZGVzYzogJ3RpbWVzdGFtcCBVVEMgZGUgY29uZmlybWFjaW9uJyB9LFxuICAgICAgeyBjb2w6ICdjb25kaWNpb25fcGFnbycsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnZWogQ1RBIENURScgfSxcbiAgICAgIHsgY29sOiAnZm9ybWFfZW50cmVnYV90aXBvJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdUUkFOU1BPUlRJU1RBIHwgU1VDVVJTQUwnIH0sXG4gICAgICB7IGNvbDogJ2Zvcm1hX2VudHJlZ2FfdHJhbnNwX25vbWJyZScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJyB9LFxuICAgICAgeyBjb2w6ICdmb3JtYV9lbnRyZWdhX3RyYW5zcF9kaXJlY2Npb24nLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcbiAgICAgIHsgY29sOiAnZm9ybWFfZW50cmVnYV9jbGllbnRlX2RpcmVjY2lvbicsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnZGVzdGlubyBmaW5hbCcgfSxcbiAgICAgIHsgY29sOiAnZm9ybWFfZW50cmVnYV9zdWN1cnNhbF9kaXJlY2Npb24nLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcbiAgICAgIHtcbiAgICAgICAgY29sOiAnZGlzY291bnRfcGN0JyxcbiAgICAgICAgdHlwZTogJ251bWJlcicsXG4gICAgICAgIGRlc2M6ICdkZXNjdWVudG8gdG90YWwgZGVsIHBlZGlkbyAoYXBsaWNhZG8gYSBuaXZlbCBoZWFkZXIsIHByb3JyYXRlYXIgZW4gcGlwZWxpbmUpJyxcbiAgICAgIH0sXG4gICAgICB7IGNvbDogJ3N1YnRvdGFsX2FycycsIHR5cGU6ICdudW1iZXInLCBkZXNjOiAnc3VidG90YWwgYnJ1dG8gQVJTJyB9LFxuICAgICAgeyBjb2w6ICduZXRfYW1vdW50X2FycycsIHR5cGU6ICdudW1iZXInLCBkZXNjOiAnbmV0byBBUlMgcG9zdC1kZXNjdWVudG8nIH0sXG4gICAgICB7IGNvbDogJ3RyYW5zZmVyaWRvX3NhcF92aWEnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ2R0d19tYW51YWwgfCBzZXJ2aWNlX2xheWVyJyB9LFxuICAgICAgeyBjb2w6ICd0cmFuc2Zlcmlkb19zYXBfZG9jX251bScsIHR5cGU6ICdpbnQnLCBkZXNjOiAnbnVtZXJvIGRlIFF1b3RhdGlvbiBTQVAnIH0sXG4gICAgICB7IGNvbDogJ3RyYW5zZmVyaWRvX3NhcF9kb2NfZW50cnknLCB0eXBlOiAnaW50JywgZGVzYzogJ2RvYyBlbnRyeSBpbnRlcm5vIFNBUCcgfSxcbiAgICAgIHsgY29sOiAndHJhbnNmZXJpZG9fc2FwX2F0JywgdHlwZTogJ2lzbzg2MDEnLCBkZXNjOiAndGltZXN0YW1wIFVUQycgfSxcbiAgICAgIHsgY29sOiAnY3JlYXRlZF9hdCcsIHR5cGU6ICdpc284NjAxJywgZGVzYzogJ3RpbWVzdGFtcCBVVEMnIH0sXG4gICAgICB7IGNvbDogJ2xpbmVfaW5kZXgnLCB0eXBlOiAnaW50JywgZGVzYzogJ2luZGljZSBkZSBsaW5lYSAwLWJhc2VkJyB9LFxuICAgICAgeyBjb2w6ICdsaW5lX2NvZGUnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ1NLVScgfSxcbiAgICAgIHsgY29sOiAnbGluZV9kZXNjJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdkZXNjcmlwY2lvbiBwcm9kdWN0bycgfSxcbiAgICAgIHsgY29sOiAnbGluZV9xdHknLCB0eXBlOiAnbnVtYmVyJywgZGVzYzogJ2NhbnRpZGFkJyB9LFxuICAgICAgeyBjb2w6ICdsaW5lX3ByZWNpbycsIHR5cGU6ICdudW1iZXInLCBkZXNjOiAncHJlY2lvIHVuaXRhcmlvIEFSUycgfSxcbiAgICAgIHsgY29sOiAnbGluZV9jYXQnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ2NhdGVnb3JpYScgfSxcbiAgICAgIHsgY29sOiAnbGluZV9mYW0nLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ2ZhbWlsaWEnIH0sXG4gICAgICB7IGNvbDogJ2xpbmVfc3ViJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdzdWJmYW1pbGlhJyB9LFxuICAgIF0sXG4gIH0sXG4gIHZpc2l0YXM6IHtcbiAgICBuYW1lOiAndmlzaXRhcy5jc3YnLFxuICAgIHNvdXJjZTogJ2ZpcmVzdG9yZScsXG4gICAgY29sbGVjdGlvbjogJ3Zpc2l0cycsXG4gICAgcm93TW9kZTogJ29uZV9wZXJfZG9jJyxcbiAgICBjb2x1bW5zOiBbXG4gICAgICB7IGNvbDogJ3Zpc2l0X2lkJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdGaXJlc3RvcmUgZG9jIElEJyB9LFxuICAgICAgeyBjb2w6ICdvd25lcl91aWQnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ1VJRCBkZWwgdmVuZGVkb3InIH0sXG4gICAgICB7IGNvbDogJ293bmVyX2VtYWlsJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdlbWFpbCBkZWwgdmVuZGVkb3InIH0sXG4gICAgICB7IGNvbDogJ2ZlY2hhJywgdHlwZTogJ2lzbzg2MDEnLCBkZXNjOiAnWVlZWS1NTS1ERCAoZmVjaGEgZGUgdmlzaXRhLCBubyBVVEMpJyB9LFxuICAgICAgeyBjb2w6ICdtZXMnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ0pVTklPLCBKVUxJTywgZXRjLicgfSxcbiAgICAgIHsgY29sOiAnYW5pbycsIHR5cGU6ICdpbnQnLCBkZXNjOiAnYW5vJyB9LFxuICAgICAgeyBjb2w6ICd2ZW5kb3InLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ25vbWJyZSBjYW5vbmljbyB2ZW5kZWRvcicgfSxcbiAgICAgIHsgY29sOiAncHJvdmluY2lhJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdwcm92aW5jaWEnIH0sXG4gICAgICB7IGNvbDogJ2xvY2FsaWRhZCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnbG9jYWxpZGFkJyB9LFxuICAgICAgeyBjb2w6ICd0aWVuZGEnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ25vbWJyZSB0aWVuZGEnIH0sXG4gICAgICB7IGNvbDogJ3RpcG8nLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ0MgfCBQJyB9LFxuICAgICAgeyBjb2w6ICdsb2NhbCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnZWogUHJvcGlvLCBBbHF1aWxhZG8nIH0sXG4gICAgICB7IGNvbDogJ3RhbWFubycsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnZWogQ2hpY28sIE1lZGlhbm8sIEdyYW5kZScgfSxcbiAgICAgIHsgY29sOiAnZmlkZWxpZGFkJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdBbHRhLCBNZWRpYSwgQmFqYScgfSxcbiAgICAgIHsgY29sOiAncmVsZXZhbmNpYScsIHR5cGU6ICdpbnQnLCBkZXNjOiAnMC01JyB9LFxuICAgICAgeyBjb2w6ICdwb3AnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ2VqIFN0aWNrZXJzIFNoaW1hbm8nIH0sXG4gICAgICB7IGNvbDogJ25lY2VzaWRhZF9wdW50dWFsJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXG4gICAgICB7IGNvbDogJ3RpcG9fdmVudGEnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ2VqIENhc2EgZGUgcGVzY2EgKyBlY29tbWVyY2UnIH0sXG4gICAgICB7IGNvbDogJ3BvbmRlcmFjaW9uX21vc3RyYWRvJywgdHlwZTogJ2ludCcsIGRlc2M6ICcwLTEwMCcgfSxcbiAgICAgIHsgY29sOiAncG9uZGVyYWNpb25fZWNvbW1lcmNlJywgdHlwZTogJ2ludCcsIGRlc2M6ICcwLTEwMCcgfSxcbiAgICAgIHsgY29sOiAnY29tcGV0ZW5jaWEnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcbiAgICAgIHsgY29sOiAnb3BvcnR1bmlkYWQnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcbiAgICAgIHsgY29sOiAnbWFzX3ZlbmRpZG8nLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcbiAgICAgIHsgY29sOiAnbWFzX3ByZWd1bnRhbicsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJyB9LFxuICAgICAgeyBjb2w6ICdheXVkYV90aWVuZGEnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcbiAgICAgIHsgY29sOiAnZ3BzX3N0YXR1cycsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnb2sgfCBvdXRzaWRlIHwgbm9sb2MnIH0sXG4gICAgICB7IGNvbDogJ2dwc19kaXN0YW5jZV9tJywgdHlwZTogJ251bWJlcicsIGRlc2M6ICdtZXRyb3MnIH0sXG4gICAgICB7IGNvbDogJ2ludGVyYWN0aW9uX3R5cGUnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ3Zpc2l0YSB8IGNvbnRhY3RvJyB9LFxuICAgICAge1xuICAgICAgICBjb2w6ICdmb3JtYV9jb250YWN0bycsXG4gICAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgICBkZXNjOiAnTExBTUFEQSBURUxFRk9OSUNBIHwgTUVOU0FKRSBERSBXSEFUU0FQUCB8IE1FTlNBSkUgU01TIChzaSBjb250YWN0byknLFxuICAgICAgfSxcbiAgICAgIHtcbiAgICAgICAgY29sOiAnY29udGFjdG9fcmVzdWx0YWRvJyxcbiAgICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICAgIGRlc2M6ICdyZXNwb25kaW8gfCBub19yZXNwb25kaW8gfCB2YWNpbyAoc2luIG1hcmNhciwgc29sbyBhcGxpY2EgYSBjb250YWN0byknLFxuICAgICAgfSxcbiAgICAgIHsgY29sOiAnY29udGFjdG9fcmVzdWx0YWRvX2F0JywgdHlwZTogJ2lzbzg2MDEnLCBkZXNjOiAndGltZXN0YW1wIFVUQycgfSxcbiAgICAgIHsgY29sOiAnY29udGFjdG9fcmVzdWx0YWRvX2J5JywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdVSUQgZGUgcXVpZW4gbWFyY28nIH0sXG4gICAgICB7IGNvbDogJ2NyZWF0ZWRfYXQnLCB0eXBlOiAnaXNvODYwMScsIGRlc2M6ICd0aW1lc3RhbXAgVVRDJyB9LFxuICAgIF0sXG4gIH0sXG4gIGNsaWVudGVzOiB7XG4gICAgbmFtZTogJ2NsaWVudGVzLmNzdicsXG4gICAgc291cmNlOiAnZmlyZXN0b3JlJyxcbiAgICBjb2xsZWN0aW9uOiAnY2xpZW50X2FwcGxpY2F0aW9ucycsXG4gICAgcm93TW9kZTogJ29uZV9wZXJfZG9jJyxcbiAgICBjb2x1bW5zOiBbXG4gICAgICB7IGNvbDogJ2FwcF9pZCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnRmlyZXN0b3JlIGRvYyBJRCcgfSxcbiAgICAgIHsgY29sOiAnb3duZXJfdWlkJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXG4gICAgICB7IGNvbDogJ293bmVyX2VtYWlsJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXG4gICAgICB7IGNvbDogJ293bmVyX25hbWUnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcbiAgICAgIHsgY29sOiAnY29tZXJjaW8nLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ3Jhem9uIHNvY2lhbCcgfSxcbiAgICAgIHsgY29sOiAnZmFudGFzaWEnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ25vbWJyZSBjb21lcmNpYWwnIH0sXG4gICAgICB7IGNvbDogJ2N1aXQnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ3NvbG8gZGlnaXRvcyBwb3N0LXYyOTQnIH0sXG4gICAgICB7IGNvbDogJ2NvbmRpY2lvbl9maXNjYWwnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcbiAgICAgIHsgY29sOiAnY2FsbGUnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcbiAgICAgIHsgY29sOiAnbnVtZXJvJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXG4gICAgICB7IGNvbDogJ2xvY2FsaWRhZCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJyB9LFxuICAgICAgeyBjb2w6ICdwcm92aW5jaWEnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcbiAgICAgIHsgY29sOiAnbG9jYWxpZGFkX2ZpbmFsJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdvdmVycmlkZSBkZWwgYXByb2JhZG9yJyB9LFxuICAgICAgeyBjb2w6ICdjYXJkX2NvZGVfc2FwJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdDYXJkQ29kZSBTQVAnIH0sXG4gICAgICB7IGNvbDogJ2Fzc2lnbmVkX3ZlbmRvcicsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAndmVuZGVkb3IgYXNpZ25hZG8gKHNvdXJjZSBvZiB0cnV0aCB2MzExKyknIH0sXG4gICAgICB7IGNvbDogJ3N0YXR1cycsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAncGVuZGluZ19hcHByb3ZhbCB8IGFwcHJvdmVkIHwgcmVqZWN0ZWQnIH0sXG4gICAgICB7XG4gICAgICAgIGNvbDogJ3NvdXJjZScsXG4gICAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgICBkZXNjOiAnbWFudWFsIHwgc2FwX2J1bGtfaW1wb3J0IHwgYWx0YV9yYXBpZGEgfCBzYXBfc3luYyB8IHNhcF9zeW5jX21hbnVhbF9saW5rJyxcbiAgICAgIH0sXG4gICAgICB7XG4gICAgICAgIGNvbDogJ21hbnVhbF9zYXBfcGVuZGluZycsXG4gICAgICAgIHR5cGU6ICdib29sZWFuJyxcbiAgICAgICAgZGVzYzogJ3RydWU9cHJvdmlzb3JpbyAoQWx0YSBSYXBpZGEgc2luIENhcmRDb2RlKScsXG4gICAgICB9LFxuICAgICAgeyBjb2w6ICdwcmVjYXVjaW9uJywgdHlwZTogJ2Jvb2xlYW4nLCBkZXNjOiAndHJ1ZT1jbGllbnRlIG1hcmNhZG8gcG9yIGltcGFnbycgfSxcbiAgICAgIHsgY29sOiAnY2F0ZWdvcmlhX2NsaWVudGUnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ1AvQS9CL0MnIH0sXG4gICAgICB7IGNvbDogJ2NsaV90aXBvJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdDIGRlZmF1bHQgcG9zdC12MzQ5JyB9LFxuICAgICAgeyBjb2w6ICdsYXQnLCB0eXBlOiAnbnVtYmVyJywgZGVzYzogJ2dlb2xhdCcgfSxcbiAgICAgIHsgY29sOiAnbG5nJywgdHlwZTogJ251bWJlcicsIGRlc2M6ICdnZW9sbmcnIH0sXG4gICAgICB7IGNvbDogJ2hhc19nZW8nLCB0eXBlOiAnYm9vbGVhbicsIGRlc2M6ICdsYXQvbG5nIG5vIG51bGwnIH0sXG4gICAgICB7IGNvbDogJ2hhc19hZGRyZXNzJywgdHlwZTogJ2Jvb2xlYW4nLCBkZXNjOiAnY2FsbGUgbm8gdmFjaWEnIH0sXG4gICAgICB7IGNvbDogJ3N1Ym1pdHRlZF9ieV9wdWJsaWNfZm9ybScsIHR5cGU6ICdib29sZWFuJywgZGVzYzogJ3ZpYSBhbHRhLWNsaWVudGUuaHRtbCcgfSxcbiAgICAgIHsgY29sOiAnYXBwcm92ZWRfYXQnLCB0eXBlOiAnaXNvODYwMScsIGRlc2M6ICcnIH0sXG4gICAgICB7IGNvbDogJ2NyZWF0ZWRfYXQnLCB0eXBlOiAnaXNvODYwMScsIGRlc2M6ICcnIH0sXG4gICAgICB7IGNvbDogJ3VwZGF0ZWRfYXQnLCB0eXBlOiAnaXNvODYwMScsIGRlc2M6ICcnIH0sXG4gICAgXSxcbiAgfSxcbiAgY2xpZW50X21hc3Rlcjoge1xuICAgIG5hbWU6ICdjbGllbnRfbWFzdGVyLmNzdicsXG4gICAgc291cmNlOiAnZmlyZXN0b3JlJyxcbiAgICBjb2xsZWN0aW9uOiAnY2xpZW50X21hc3RlcicsXG4gICAgcm93TW9kZTogJ29uZV9wZXJfZG9jJyxcbiAgICBjb2x1bW5zOiBbXG4gICAgICB7IGNvbDogJ21hc3Rlcl9pZCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnRmlyZXN0b3JlIGRvYyBJRCcgfSxcbiAgICAgIHsgY29sOiAnY2xpZW50X25hbWUnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcbiAgICAgIHsgY29sOiAncHJvdmluY2lhJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXG4gICAgICB7IGNvbDogJ2xvY2FsaWRhZCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJyB9LFxuICAgICAgeyBjb2w6ICd2ZW5kb3InLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ3ZlbmRlZG9yIGN1cmFkbyBhZG1pbicgfSxcbiAgICAgIHsgY29sOiAnYWRkcmVzcycsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnZGlyZWNjaW9uIGN1cmFkYSBhZG1pbicgfSxcbiAgICAgIHsgY29sOiAnc2FwX2NhcmRfY29kZScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnQ2FyZENvZGUgU0FQJyB9LFxuICAgICAgeyBjb2w6ICdzYXBfYWRkcmVzcycsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnZGlyZWNjaW9uIHJhdyBTQVAnIH0sXG4gICAgICB7IGNvbDogJ3NhcF9jaXR5JywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXG4gICAgICB7IGNvbDogJ3NhcF9zdGF0ZScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJyB9LFxuICAgICAgeyBjb2w6ICdzYXBfaW1wb3J0ZWRfYXQnLCB0eXBlOiAnaXNvODYwMScsIGRlc2M6ICcnIH0sXG4gICAgICB7IGNvbDogJ3NhcF9pbXBvcnRlZF9ieScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJyB9LFxuICAgICAgeyBjb2w6ICdjbGllbnRfbmFtZV9vcmlnaW5hbCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnYmFja3VwIG5vbWJyZSBwcmUtaW1wb3J0JyB9LFxuICAgICAgeyBjb2w6ICdsb2NhbGlkYWRfb3JpZ2luYWwnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ2JhY2t1cCBsb2NhbGlkYWQgcHJlLWltcG9ydCcgfSxcbiAgICAgIHsgY29sOiAnbWF0Y2hfdHlwZScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnZXhhY3QgfCBmdXp6eScgfSxcbiAgICAgIHsgY29sOiAnbWF0Y2hfc2ltaWxhcml0eScsIHR5cGU6ICdudW1iZXInLCBkZXNjOiAnMC0xJyB9LFxuICAgICAgeyBjb2w6ICd1cGRhdGVkX2F0JywgdHlwZTogJ2lzbzg2MDEnLCBkZXNjOiAnJyB9LFxuICAgICAgeyBjb2w6ICd1cGRhdGVkX2J5JywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXG4gICAgXSxcbiAgfSxcbiAgcmVuZGljaW9uZXM6IHtcbiAgICBuYW1lOiAncmVuZGljaW9uZXMuY3N2JyxcbiAgICBzb3VyY2U6ICdmaXJlc3RvcmUnLFxuICAgIGNvbGxlY3Rpb246ICdyZW5kaWNpb25lcycsXG4gICAgcm93TW9kZTogJ29uZV9wZXJfZG9jJyxcbiAgICBjb2x1bW5zOiBbXG4gICAgICB7IGNvbDogJ3JlbmRpY2lvbl9pZCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnRmlyZXN0b3JlIGRvYyBJRCcgfSxcbiAgICAgIHsgY29sOiAnb3duZXJfdWlkJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXG4gICAgICB7IGNvbDogJ293bmVyX2VtYWlsJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXG4gICAgICB7IGNvbDogJ3ZlbmRvcicsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJyB9LFxuICAgICAgeyBjb2w6ICd0aXBvJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdnYXN0byB8IHNvbGljaXR1ZCcgfSxcbiAgICAgIHsgY29sOiAndGlwb19nYXN0bycsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnZWogUEVBSkVTLCBGQUNUVVJBIEEsIEdBU1RPIENPTiBDT01QUk9CQU5URScgfSxcbiAgICAgIHsgY29sOiAnaW1wb3J0ZV9hcnMnLCB0eXBlOiAnbnVtYmVyJywgZGVzYzogJ21vbnRvIEFSUycgfSxcbiAgICAgIHsgY29sOiAnZmVjaGFfZ2FzdG8nLCB0eXBlOiAnaXNvODYwMScsIGRlc2M6ICdZWVlZLU1NLUREIGRlbCBnYXN0bycgfSxcbiAgICAgIHsgY29sOiAnY29uY2VwdG8nLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ2Rlc2NyaXBjaW9uIGxpYnJlJyB9LFxuICAgICAgeyBjb2w6ICdmb3RvX3RpY2tldF91cmwnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ1VSTCBGaXJlYmFzZSBTdG9yYWdlIHYzMDgrIChudW5jYSBiYXNlNjQpJyB9LFxuICAgICAgeyBjb2w6ICdzdGF0dXMnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ3BlbmRpbmdfYXBwcm92YWwgfCBhcHByb3ZlZCB8IHJlamVjdGVkJyB9LFxuICAgICAgeyBjb2w6ICdhcHByb3ZlZF9ieScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnZW1haWwgZGVsIGFwcm9iYWRvciBvIFwic2VsZlwiJyB9LFxuICAgICAgeyBjb2w6ICdhcHByb3ZlZF9hdCcsIHR5cGU6ICdpc284NjAxJywgZGVzYzogJycgfSxcbiAgICAgIHsgY29sOiAncmVqZWN0ZWRfYnlfZW1haWwnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcbiAgICAgIHsgY29sOiAncmVqZWN0ZWRfcmVhc29uJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXG4gICAgICB7IGNvbDogJ2FwcHJvdmVyX3VpZCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnVUlEIHJlc3BvbnNhYmxlIGFzaWduYWRvJyB9LFxuICAgICAgeyBjb2w6ICdjcmVhdGVkX2F0JywgdHlwZTogJ2lzbzg2MDEnLCBkZXNjOiAnJyB9LFxuICAgIF0sXG4gIH0sXG4gIGNhbXBhbmlhczoge1xuICAgIG5hbWU6ICdjYW1wYW5pYXMuY3N2JyxcbiAgICBzb3VyY2U6ICdmaXJlc3RvcmUnLFxuICAgIGNvbGxlY3Rpb246ICdjYW1wYWlnbnMnLFxuICAgIHJvd01vZGU6ICdvbmVfcGVyX2RvYycsXG4gICAgY29sdW1uczogW1xuICAgICAgeyBjb2w6ICdjYW1wYWlnbl9pZCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnRmlyZXN0b3JlIGRvYyBJRCcgfSxcbiAgICAgIHsgY29sOiAnbmFtZScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnbm9tYnJlIGNhbXBhbmEnIH0sXG4gICAgICB7IGNvbDogJ2ZhbWlsaWEnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ2VqIFJFRUxTJyB9LFxuICAgICAgeyBjb2w6ICdzdWJmYW1pbGlhJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdlaiBNVUxUSVBMSUNBRE9SRVMnIH0sXG4gICAgICB7IGNvbDogJ2ZpbHRlcl90eXBlJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdza3UgKGhveSBoYXJkY29kZWQpJyB9LFxuICAgICAgeyBjb2w6ICdmaWx0ZXJfdmFsdWVzX2pzb24nLCB0eXBlOiAnanNvbl9hcnJheScsIGRlc2M6ICdjb3BpYSBkZSBza3VzJyB9LFxuICAgICAgeyBjb2w6ICdza3VzX2pzb24nLCB0eXBlOiAnanNvbl9hcnJheScsIGRlc2M6ICdJdGVtQ29kZXMgaW5jbHVpZG9zJyB9LFxuICAgICAgeyBjb2w6ICdza3VzX2NvdW50JywgdHlwZTogJ2ludCcsIGRlc2M6ICdjYW50aWRhZCBTS1VzJyB9LFxuICAgICAgeyBjb2w6ICd0YXJnZXRfdHlwZScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAndW5pdHMgfCBtb25leScgfSxcbiAgICAgIHsgY29sOiAndGFyZ2V0X2Ftb3VudCcsIHR5cGU6ICdudW1iZXInLCBkZXNjOiAnb2JqZXRpdm8nIH0sXG4gICAgICB7IGNvbDogJ3N0YXJ0X2RhdGUnLCB0eXBlOiAnaXNvODYwMScsIGRlc2M6ICdZWVlZLU1NLUREJyB9LFxuICAgICAgeyBjb2w6ICdlbmRfZGF0ZScsIHR5cGU6ICdpc284NjAxJywgZGVzYzogJ1lZWVktTU0tREQnIH0sXG4gICAgICB7IGNvbDogJ3Njb3BlJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdhbGwgfCBwcm92aW5jZSB8IHZlbmRvcicgfSxcbiAgICAgIHtcbiAgICAgICAgY29sOiAnc2NvcGVfdmFsdWVzX2pzb24nLFxuICAgICAgICB0eXBlOiAnanNvbl9hcnJheScsXG4gICAgICAgIGRlc2M6ICdwcm92aW5jaWFzIG8gdmVuZG9yIGtleXMgc2kgc2NvcGUgIT0gYWxsJyxcbiAgICAgIH0sXG4gICAgICB7IGNvbDogJ2NyZWF0ZWRfYnknLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ1VJRCBhZG1pbi9nZXJlbnRlJyB9LFxuICAgICAgeyBjb2w6ICdjcmVhdGVkX2J5X2VtYWlsJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXG4gICAgICB7IGNvbDogJ2NyZWF0ZWRfYXQnLCB0eXBlOiAnaXNvODYwMScsIGRlc2M6ICcnIH0sXG4gICAgICB7IGNvbDogJ2FyY2hpdmVkX21hbnVhbGx5JywgdHlwZTogJ2Jvb2xlYW4nLCBkZXNjOiAndHJ1ZT1maW5hbGl6YWRhIGFudGVzIGRlIGVuZERhdGUnIH0sXG4gICAgICB7IGNvbDogJ2FyY2hpdmVkX2F0JywgdHlwZTogJ2lzbzg2MDEnLCBkZXNjOiAnJyB9LFxuICAgICAgeyBjb2w6ICdhcmNoaXZlZF9ieScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJyB9LFxuICAgIF0sXG4gIH0sXG4gIHRhcmdldHM6IHtcbiAgICBuYW1lOiAndGFyZ2V0cy5jc3YnLFxuICAgIHNvdXJjZTogJ2ZpcmVzdG9yZScsXG4gICAgY29sbGVjdGlvbjogJ3RhcmdldHMnLFxuICAgIHJvd01vZGU6ICdvbmVfcGVyX2RvYycsXG4gICAgY29sdW1uczogW1xuICAgICAgeyBjb2w6ICd0YXJnZXRfaWQnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ0ZpcmVzdG9yZSBkb2MgSUQgY2Fub25pY28ge3ZlbmRvcn1fe3llYXJ9X3tNTX0nIH0sXG4gICAgICB7IGNvbDogJ3NlbGxlcl9pZCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAndmVuZG9yS2V5IHVwcGVyY2FzZSBlaiBHT05aQUxPIERFIExBIFJPU0EnIH0sXG4gICAgICB7IGNvbDogJ3llYXInLCB0eXBlOiAnaW50JywgZGVzYzogJ2VqIDIwMjYnIH0sXG4gICAgICB7IGNvbDogJ21vbnRoJywgdHlwZTogJ2ludCcsIGRlc2M6ICcwLTExIChpbmRpY2UgZGVsIGFycmF5IE1FU0VTIDAtaW5kZXhlZCknIH0sXG4gICAgICB7IGNvbDogJ3RhcmdldF9hcnMnLCB0eXBlOiAnbnVtYmVyJywgZGVzYzogJ29iamV0aXZvIG1lcyBBUlMgKHN1bWEgZmFtaWxpYXMpJyB9LFxuICAgICAgeyBjb2w6ICd0YXJnZXRfcmVlbF9hcnMnLCB0eXBlOiAnbnVtYmVyJywgZGVzYzogJ3YzMTErIGRlc2dsb3NlJyB9LFxuICAgICAgeyBjb2w6ICd0YXJnZXRfY2FuYXNfYXJzJywgdHlwZTogJ251bWJlcicsIGRlc2M6ICd2MzExKyBkZXNnbG9zZScgfSxcbiAgICAgIHsgY29sOiAndGFyZ2V0X2xpbmVhc19hcnMnLCB0eXBlOiAnbnVtYmVyJywgZGVzYzogJ3YzMTErIGRlc2dsb3NlJyB9LFxuICAgICAgeyBjb2w6ICd1cGRhdGVkX2F0JywgdHlwZTogJ2lzbzg2MDEnLCBkZXNjOiAnJyB9LFxuICAgICAgeyBjb2w6ICd1cGRhdGVkX2J5JywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdVSUQnIH0sXG4gICAgICB7IGNvbDogJ3VwZGF0ZWRfYnlfZW1haWwnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcbiAgICBdLFxuICB9LFxuICBwcm9kdWN0b3M6IHtcbiAgICBuYW1lOiAncHJvZHVjdG9zLmNzdicsXG4gICAgc291cmNlOiAnc3RvY2tfanNvbicsXG4gICAgcm93TW9kZTogJ2Zyb21fc3RvY2tfanNvbicsXG4gICAgY29sdW1uczogW1xuICAgICAgeyBjb2w6ICdza3UnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ1NLVSAoSXRlbUNvZGUgU0FQKScgfSxcbiAgICAgIHsgY29sOiAnaGFzX3N0b2NrJywgdHlwZTogJ2Jvb2xlYW4nLCBkZXNjOiAndHJ1ZT1oYXkgdW5pZGFkZXMgZW4gYWxndW4gd2hzIHZlbmRpYmxlJyB9LFxuICAgICAgeyBjb2w6ICdjYW50aWRhZF90b3RhbCcsIHR5cGU6ICdpbnQnLCBkZXNjOiAnc3VtYSB0b3RhbCB3aHMgdmVuZGlibGVzIChleGNsdXllIDA1IHkgMDYpJyB9LFxuICAgICAge1xuICAgICAgICBjb2w6ICdkaXNwb25pYmxlX3ZlbnRhX3doczExJyxcbiAgICAgICAgdHlwZTogJ2ludCcsXG4gICAgICAgIGRlc2M6ICd2MzY5KyBNZXJjYWRlcmlhIE5VUiBQRVNDQSAodmVudGEgZGlyZWN0YSknLFxuICAgICAgfSxcbiAgICAgIHsgY29sOiAndHJhbnNpdG9fd2hzMTInLCB0eXBlOiAnaW50JywgZGVzYzogJ3YzNjkrIEVuIHRyYW5zaXRvIFBFU0NBIChiYWNrb3JkZXIgZnV0dXJvKScgfSxcbiAgICAgIHtcbiAgICAgICAgY29sOiAnb3Ryb3Nfd2FyZWhvdXNlc19qc29uJyxcbiAgICAgICAgdHlwZTogJ2pzb25fb2JqZWN0JyxcbiAgICAgICAgZGVzYzogJ290cm9zIGNvZGlnb3MgY29uIGNhbnRpZGFkLCBlaiB7XCI5OFwiOiA1fScsXG4gICAgICB9LFxuICAgICAgeyBjb2w6ICdzb3VyY2UnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ3N0b2NrLmpzb24gc25hcHNob3QnIH0sXG4gICAgICB7IGNvbDogJ3NuYXBzaG90X3VwZGF0ZWRfYXQnLCB0eXBlOiAnaXNvODYwMScsIGRlc2M6ICd0aW1lc3RhbXAgZGVsIHVsdGltbyBzeW5jIFNBUCcgfSxcbiAgICBdLFxuICB9LFxuICB2ZW5kb3Jfb3ZlcnJpZGVzOiB7XG4gICAgbmFtZTogJ3ZlbmRvcl9vdmVycmlkZXMuY3N2JyxcbiAgICBzb3VyY2U6ICdmaXJlc3RvcmUnLFxuICAgIGNvbGxlY3Rpb246ICd2ZW5kb3Jfb3ZlcnJpZGVzJyxcbiAgICByb3dNb2RlOiAnb25lX3Blcl9kb2MnLFxuICAgIGNvbHVtbnM6IFtcbiAgICAgIHsgY29sOiAnb3ZlcnJpZGVfaWQnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ0ZpcmVzdG9yZSBkb2MgSUQnIH0sXG4gICAgICB7IGNvbDogJ3Njb3BlJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdzaG9wIHwgbG9jJyB9LFxuICAgICAgeyBjb2w6ICdwcm92aW5jZScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJyB9LFxuICAgICAgeyBjb2w6ICdsb2NhbGl0eV9uYW1lJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXG4gICAgICB7IGNvbDogJ2NsaWVudF9uYW1lJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdzb2xvIHNpIHNjb3BlPXNob3AnIH0sXG4gICAgICB7IGNvbDogJ29yaWdpbmFsX3ZlbmRvcicsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJyB9LFxuICAgICAgeyBjb2w6ICduZXdfdmVuZG9yJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXG4gICAgICB7IGNvbDogJ25ld190eXBlJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdWREUgfCBWREkgfCBESVNUUklCVUlET1IgfCBPVFJPJyB9LFxuICAgICAgeyBjb2w6ICd1cGRhdGVkX2F0JywgdHlwZTogJ2lzbzg2MDEnLCBkZXNjOiAnJyB9LFxuICAgICAgeyBjb2w6ICd1cGRhdGVkX2J5X3VpZCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJyB9LFxuICAgICAgeyBjb2w6ICd1cGRhdGVkX2J5X2VtYWlsJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXG4gICAgICB7IGNvbDogJ3VwZGF0ZWRfYnlfZGlzcGxheV9uYW1lJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXG4gICAgXSxcbiAgfSxcbiAgY3VzdG9tX3JvdXRlczoge1xuICAgIG5hbWU6ICdjdXN0b21fcm91dGVzLmNzdicsXG4gICAgc291cmNlOiAnZmlyZXN0b3JlJyxcbiAgICBjb2xsZWN0aW9uOiAnY3VzdG9tX3JvdXRlcycsXG4gICAgcm93TW9kZTogJ2ZsYXR0ZW5fc3RvcHMnLCAvLyAxIGZpbGEgcG9yIChydXRhLCBzdG9wKVxuICAgIGNvbHVtbnM6IFtcbiAgICAgIHsgY29sOiAncm91dGVfaWQnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ0ZpcmVzdG9yZSBkb2MgSUQnIH0sXG4gICAgICB7IGNvbDogJ293bmVyX3VpZCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnZHVlbmlvIGRlIGxhIHJ1dGEnIH0sXG4gICAgICB7IGNvbDogJ293bmVyX2VtYWlsJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXG4gICAgICB7IGNvbDogJ25hbWUnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ25vbWJyZSBkZSBsYSBydXRhJyB9LFxuICAgICAgeyBjb2w6ICdwbGFubmVkX2RhdGUnLCB0eXBlOiAnaXNvODYwMScsIGRlc2M6ICdZWVlZLU1NLUREJyB9LFxuICAgICAgeyBjb2w6ICdub3RlcycsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnbm90YXMgbGlicmVzJyB9LFxuICAgICAgeyBjb2w6ICdjcmVhdGVkX2F0JywgdHlwZTogJ2lzbzg2MDEnLCBkZXNjOiAnJyB9LFxuICAgICAgeyBjb2w6ICd1cGRhdGVkX2F0JywgdHlwZTogJ2lzbzg2MDEnLCBkZXNjOiAnJyB9LFxuICAgICAgeyBjb2w6ICdzdG9wX29yZGVyJywgdHlwZTogJ2ludCcsIGRlc2M6ICdvcmRlbiAwLWJhc2VkJyB9LFxuICAgICAgeyBjb2w6ICdzdG9wX2tleScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnY2xhdmUgY29tcHVlc3RhIHRpcG98cHJvdnxsb2N8Y2xpZW50ZScgfSxcbiAgICAgIHsgY29sOiAnc3RvcF90aXBvJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdDIHwgUCcgfSxcbiAgICAgIHsgY29sOiAnc3RvcF9wcm92aW5jaWEnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcbiAgICAgIHsgY29sOiAnc3RvcF9sb2NhbGlkYWQnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcbiAgICAgIHsgY29sOiAnc3RvcF9jbGllbnRfbmFtZScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJyB9LFxuICAgICAgeyBjb2w6ICdzdG9wX2lzX3Byb3Zpc29yaW8nLCB0eXBlOiAnYm9vbGVhbicsIGRlc2M6ICd0cnVlPWFsdGEgcmFwaWRhIHNpbiBDYXJkQ29kZScgfSxcbiAgICAgIHsgY29sOiAnc3RvcF9zYXBfYWx0YV9pZCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnSUQgZGVsIGNsaWVudF9hcHBsaWNhdGlvbnMgc2kgYXBsaWNhJyB9LFxuICAgIF0sXG4gIH0sXG4gIHNlZ3VpbWllbnRvX25vdGVzOiB7XG4gICAgbmFtZTogJ3NlZ3VpbWllbnRvX25vdGVzLmNzdicsXG4gICAgc291cmNlOiAnZmlyZXN0b3JlJyxcbiAgICBjb2xsZWN0aW9uOiAnc2VndWltaWVudG9fbm90ZXMnLFxuICAgIHJvd01vZGU6ICdvbmVfcGVyX2RvYycsXG4gICAgY29sdW1uczogW1xuICAgICAgeyBjb2w6ICdub3RlX2lkJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdGaXJlc3RvcmUgZG9jIElEJyB9LFxuICAgICAgeyBjb2w6ICd2ZW5kb3JfZXh0JywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdWREUgYWwgcXVlIGFwbGljYSBsYSBub3RhJyB9LFxuICAgICAgeyBjb2w6ICdjbGllbnRfa2V5JywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdjbGF2ZSBjb21wdWVzdGEgY2xpZW50ZScgfSxcbiAgICAgIHsgY29sOiAnY2xpZW50X25hbWUnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcbiAgICAgIHsgY29sOiAncHJvdmluY2UnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcbiAgICAgIHsgY29sOiAnbG9jYWxpdHknLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcbiAgICAgIHsgY29sOiAndGV4dCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAndGV4dG8gbGlicmUgZGUgbGEgbm90YScgfSxcbiAgICAgIHsgY29sOiAnYXV0aG9yX3VpZCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJyB9LFxuICAgICAgeyBjb2w6ICdhdXRob3JfZW1haWwnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcbiAgICAgIHsgY29sOiAnYXV0aG9yX25hbWUnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcbiAgICAgIHsgY29sOiAnYXV0aG9yX3JvbGUnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ2FkbWluIHwgZ2VyZW50ZSB8IGludGVybm8nIH0sXG4gICAgICB7IGNvbDogJ2NyZWF0ZWRfYXQnLCB0eXBlOiAnaXNvODYwMScsIGRlc2M6ICcnIH0sXG4gICAgXSxcbiAgfSxcbn07XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gREFUQVNFVF9VU0VfQ0FTRV9NQVRSSVggXHUyMDE0IGNhc29zIGRlIHVzbyBNTCBjb24gY2FtcG9zIHJlcXVlcmlkb3Ncbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4vKiogQHR5cGVkZWYge3twcmlvcml0eTogbnVtYmVyfHN0cmluZywgZGVzY3JpcHRpb246IHN0cmluZywgcmVxdWlyZWRGaWVsZHM6IFJlY29yZDxzdHJpbmcsIHN0cmluZ1tdPiwgam9pbk5vdGVzPzogc3RyaW5nfX0gVXNlQ2FzZSAqL1xuXG4vKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFVzZUNhc2U+fSAqL1xuZXhwb3J0IGNvbnN0IERBVEFTRVRfVVNFX0NBU0VfTUFUUklYID0ge1xuICBBX2NvbnZlcnNpb25fdmlzaXRhX3BlZGlkbzoge1xuICAgIHByaW9yaXR5OiAxLFxuICAgIGRlc2NyaXB0aW9uOiAnUHJlZGVjaXIgcXVlIHZpc2l0YXMgdGVybWluYW4gZW4gcGVkaWRvIHBhcmEgcHJpb3JpemFyIGxhIHJ1dGEgZGVsIHZlbmRlZG9yLicsXG4gICAgcmVxdWlyZWRGaWVsZHM6IHtcbiAgICAgICd2aXNpdGFzLmNzdic6IFsnZmVjaGEnLCAnb3duZXJfdWlkJywgJ3Byb3ZpbmNpYScsICdsb2NhbGlkYWQnLCAndGllbmRhJ10sXG4gICAgICAncGVkaWRvcy5jc3YnOiBbJ2NvbmZpcm1lZF9hdCcsICdvd25lcl91aWQnLCAncHJvdmluY2UnLCAnbG9jX25hbWUnLCAnY2xpZW50X25hbWUnXSxcbiAgICB9LFxuICAgIGpvaW5Ob3RlczpcbiAgICAgICdKT0lOIHBvciAocHJvdmluY2lhLCBsb2NhbGlkYWQsIHRpZW5kYX5jbGllbnRfbmFtZSkgZW4gdmVudGFuYSB0ZW1wb3JhbCBmZWNoYV92aXNpdGEuLmNvbmZpcm1lZF9hdC4gTm8gaGF5IGNhcmRDb2RlU2FwIGNvbXVuIGVudHJlIHZpc2l0cyB5IHBlZGlkb3MuJyxcbiAgfSxcbiAgQl9jaHVybl9jbGllbnRlczoge1xuICAgIHByaW9yaXR5OiAyLFxuICAgIGRlc2NyaXB0aW9uOiAnRGV0ZWN0YXIgY2xpZW50ZXMgcXVlIHNlIGVuZnJpYW4gYW50ZXMgZGUgcGVyZGVybG9zLicsXG4gICAgcmVxdWlyZWRGaWVsZHM6IHtcbiAgICAgICdjbGllbnRlcy5jc3YnOiBbJ2NyZWF0ZWRfYXQnLCAnYXNzaWduZWRfdmVuZG9yJywgJ3Byb3ZpbmNpYScsICdzdGF0dXMnLCAnY2FyZF9jb2RlX3NhcCddLFxuICAgICAgJ3BlZGlkb3MuY3N2JzogWydjb25maXJtZWRfYXQnLCAnY2xpZW50X25hbWUnLCAncHJvdmluY2UnLCAnbG9jX25hbWUnXSxcbiAgICB9LFxuICAgIGpvaW5Ob3RlczpcbiAgICAgICdKT0lOIHZpYSBjbGllbnRfYXBwbGljYXRpb25zLmNhcmRfY29kZV9zYXAgdnMgcGVkaWRvcy5rZXkgKHBhcnNlYWRvKS4gRnJhZ2lsIC0gY29uc2lkZXJhciBmdXp6eSBtYXRjaCBwb3Igbm9tYnJlLicsXG4gIH0sXG4gIENfZm9yZWNhc3Rfc2t1OiB7XG4gICAgcHJpb3JpdHk6IDMsXG4gICAgZGVzY3JpcHRpb246ICdBbnRpY2lwYXIgcXVlIHByb2R1Y3RvcyBzZSB2YW4gYSBwZWRpciBwb3IgcGVyaW9kby4nLFxuICAgIHJlcXVpcmVkRmllbGRzOiB7XG4gICAgICAncGVkaWRvcy5jc3YnOiBbJ2xpbmVfY29kZScsICdsaW5lX3F0eScsICdsaW5lX3ByZWNpbycsICdjb25maXJtZWRfYXQnLCAncHJvdmluY2UnXSxcbiAgICAgICdwcm9kdWN0b3MuY3N2JzogWydza3UnXSxcbiAgICB9LFxuICAgIGpvaW5Ob3RlczpcbiAgICAgICdEZXNjdWVudG8gYXBsaWNhZG8gYSBuaXZlbCBoZWFkZXIgKGRpc2NvdW50X3BjdCkgLSBwcm9ycmF0ZWFyIGVuIGVsIHBpcGVsaW5lIGRvd25zdHJlYW0gcHJvcG9yY2lvbmFsIGEgc3VidG90YWxfYnJ1dG8gZGUgY2FkYSBsaW5lYS4gRW5yaXF1ZWNlciBjb24gY2F0YWxvZ28gQlEgKHNhcF9pdGVtc19yYXcpIHNpIGhhY2UgZmFsdGEgY2F0L2ZhbS9zdWIgYWRpY2lvbmFsLicsXG4gIH0sXG4gIERfYW5vbWFsaWFzX3JlbmRpY2lvbmVzOiB7XG4gICAgcHJpb3JpdHk6ICdleHBsb3JhdG9yaW8nLFxuICAgIGRlc2NyaXB0aW9uOiAnRGV0ZWN0YXIgb3V0bGllcnMgZGUgZ2FzdG9zLicsXG4gICAgcmVxdWlyZWRGaWVsZHM6IHtcbiAgICAgICdyZW5kaWNpb25lcy5jc3YnOiBbJ2ltcG9ydGVfYXJzJywgJ3RpcG9fZ2FzdG8nLCAnb3duZXJfdWlkJywgJ2ZlY2hhX2dhc3RvJywgJ3N0YXR1cyddLFxuICAgIH0sXG4gIH0sXG4gIEVfZXN0YWNpb25hbGlkYWRfem9uYV9jYXRlZ29yaWE6IHtcbiAgICBwcmlvcml0eTogJ2V4cGxvcmF0b3JpbycsXG4gICAgZGVzY3JpcHRpb246ICdJbnN1bW8gcGFyYSBhcm1hZG8gZGUgY2FtcGFuaWFzIGVzdGFjaW9uYWxlcy4nLFxuICAgIHJlcXVpcmVkRmllbGRzOiB7XG4gICAgICAncGVkaWRvcy5jc3YnOiBbJ2NvbmZpcm1lZF9hdCcsICdwcm92aW5jZScsICdsaW5lX2NvZGUnLCAnbGluZV9mYW0nLCAnbGluZV9xdHknXSxcbiAgICAgICdjbGllbnRlcy5jc3YnOiBbJ3Byb3ZpbmNpYScsICdhc3NpZ25lZF92ZW5kb3InXSxcbiAgICAgICdjYW1wYW5pYXMuY3N2JzogWydzdGFydF9kYXRlJywgJ2VuZF9kYXRlJywgJ3NrdXNfanNvbicsICdzY29wZSddLFxuICAgICAgJ3RhcmdldHMuY3N2JzogWyd5ZWFyJywgJ21vbnRoJywgJ3RhcmdldF9hcnMnXSxcbiAgICB9LFxuICB9LFxufTtcblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBSb3cgYnVpbGRlcnMgXHUyMDE0IGZ1bmNpb25lcyBwdXJhcyAoZG9jIC0+IGFycmF5IGRlIHJvd3MpXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuLyoqXG4gKiBFeHRyYWUgdmFsb3IgRmlyZXN0b3JlIGRlIGRvYyBjb24gcGF0aCBhbmlkYWRvLiBEZXZ1ZWx2ZSByYXcgKG5vIENTVikuXG4gKiBFajogZ2V0RmllbGQoZG9jLCAndHJhbnNmZXJpZG9TQVAuZG9jTnVtJylcbiAqIEBwYXJhbSB7b2JqZWN0fSBkb2NcbiAqIEBwYXJhbSB7c3RyaW5nfSBwYXRoXG4gKi9cbmZ1bmN0aW9uIGYoZG9jLCBwYXRoKSB7XG4gIHJldHVybiBnZXRQYXRoKGRvYywgcGF0aCk7XG59XG5cbi8qKlxuICogUm93IGJ1aWxkZXIgZ2VuZXJpY286IG1hcGVhIHVuIGRvYyBhIGFycmF5IGRlIHZhbG9yZXMgc2VndW4gdW4gYXJyYXkgZGUgcGF0aHMuXG4gKiBAcGFyYW0ge29iamVjdH0gZG9jXG4gKiBAcGFyYW0ge3N0cmluZ1tdfSBwYXRoc1xuICogQHJldHVybnMge3Vua25vd25bXX1cbiAqL1xuZnVuY3Rpb24gX2J1aWxkUm93KGRvYywgcGF0aHMpIHtcbiAgcmV0dXJuIHBhdGhzLm1hcCgocCkgPT4gKHAgPT09ICdfX2lkX18nID8gLyoqIEB0eXBlIHthbnl9ICovIChkb2MpLl9pZCA6IGYoZG9jLCBwKSkpO1xufVxuXG4vKipcbiAqIFBlZGlkb3M6IGZsYXR0ZW4gMSBmaWxhIHBvciBsaW5lYS4gSGVhZGVyIHBlZGlkbyByZXBsaWNhZG8gZW4gY2FkYS5cbiAqIGRvYy5faWQgZXMgZWwgSUQ7IHNlIGVzcGVyYSBxdWUgZWwgY2FsbGVyIGxvIGFncmVndWUgYW50ZXMgZGUgcGFzYXIuXG4gKiBAcGFyYW0ge2FueX0gZG9jXG4gKiBAcmV0dXJucyB7dW5rbm93bltdW119XG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBidWlsZFBlZGlkb1Jvd3MoZG9jKSB7XG4gIGNvbnN0IGhlYWRlciA9IFtcbiAgICBkb2MuX2lkLFxuICAgIGRvYy5vd25lclVpZCxcbiAgICBkb2Mub3duZXJFbWFpbCxcbiAgICBkb2MuY3JlYXRlZEJ5VWlkLFxuICAgIGRvYy5vbkJlaGFsZk9mLFxuICAgIGRvYy5rZXksXG4gICAgZG9jLnN0YWdlLFxuICAgIGRvYy50aXBvLFxuICAgIGRvYy5wcm92aW5jZSxcbiAgICBkb2MubG9jTmFtZSxcbiAgICBkb2MuY2xpZW50TmFtZSxcbiAgICBkb2MubW9udGgsXG4gICAgZG9jLm1vbnRoSWR4LFxuICAgIGRvYy55ZWFyLFxuICAgIGRvYy5jb25maXJtZWRBdCxcbiAgICBkb2MuY29uZGljaW9uUGFnbyxcbiAgICBkb2MuZm9ybWFFbnRyZWdhID8gZG9jLmZvcm1hRW50cmVnYS50aXBvIDogbnVsbCxcbiAgICBkb2MuZm9ybWFFbnRyZWdhID8gZG9jLmZvcm1hRW50cmVnYS50cmFuc3BOb21icmUgOiBudWxsLFxuICAgIGRvYy5mb3JtYUVudHJlZ2EgPyBkb2MuZm9ybWFFbnRyZWdhLnRyYW5zcERpcmVjY2lvbiA6IG51bGwsXG4gICAgZG9jLmZvcm1hRW50cmVnYSA/IGRvYy5mb3JtYUVudHJlZ2EuY2xpZW50ZURpcmVjY2lvbiA6IG51bGwsXG4gICAgZG9jLmZvcm1hRW50cmVnYSA/IGRvYy5mb3JtYUVudHJlZ2Euc3VjdXJzYWxEaXJlY2Npb24gOiBudWxsLFxuICAgIGRvYy5kaXNjb3VudFBjdCxcbiAgICBkb2Muc3VidG90YWxBcnMsXG4gICAgZG9jLm5ldEFtb3VudEFycyxcbiAgICBkb2MudHJhbnNmZXJpZG9TQVAgPyBkb2MudHJhbnNmZXJpZG9TQVAudmlhIDogbnVsbCxcbiAgICBkb2MudHJhbnNmZXJpZG9TQVAgPyBkb2MudHJhbnNmZXJpZG9TQVAuZG9jTnVtIDogbnVsbCxcbiAgICBkb2MudHJhbnNmZXJpZG9TQVAgPyBkb2MudHJhbnNmZXJpZG9TQVAuZG9jRW50cnkgOiBudWxsLFxuICAgIGRvYy50cmFuc2Zlcmlkb1NBUCA/IGRvYy50cmFuc2Zlcmlkb1NBUC5hdCA6IG51bGwsXG4gICAgZG9jLmNyZWF0ZWRBdCxcbiAgXTtcbiAgY29uc3QgbGluZXMgPSBBcnJheS5pc0FycmF5KGRvYy5saW5lcykgPyBkb2MubGluZXMgOiBbXTtcbiAgaWYgKCFsaW5lcy5sZW5ndGgpIHtcbiAgICAvLyBQZWRpZG8gc2luIGxpbmVhcyAtPiAxIGZpbGEgY29uIGxpbmVfKiB2YWNpb3NcbiAgICByZXR1cm4gW2hlYWRlci5jb25jYXQoW251bGwsIG51bGwsIG51bGwsIG51bGwsIG51bGwsIG51bGwsIG51bGwsIG51bGxdKV07XG4gIH1cbiAgcmV0dXJuIGxpbmVzLm1hcCgoLyoqIEB0eXBlIHthbnl9ICovIGwsIC8qKiBAdHlwZSB7bnVtYmVyfSAqLyBpZHgpID0+XG4gICAgaGVhZGVyLmNvbmNhdChbXG4gICAgICBpZHgsXG4gICAgICBsID8gbC5jb2RlIDogbnVsbCxcbiAgICAgIGwgPyBsLmRlc2MgOiBudWxsLFxuICAgICAgbCA/IGwucXR5IDogbnVsbCxcbiAgICAgIGwgPyBsLnByZWNpbyA6IG51bGwsXG4gICAgICBsID8gbC5jYXQgOiBudWxsLFxuICAgICAgbCA/IGwuZmFtIDogbnVsbCxcbiAgICAgIGwgPyBsLnN1YiA6IG51bGwsXG4gICAgXSlcbiAgKTtcbn1cblxuLyoqIEBwYXJhbSB7YW55fSBkb2MgQHJldHVybnMge3Vua25vd25bXVtdfSAqL1xuZXhwb3J0IGZ1bmN0aW9uIGJ1aWxkVmlzaXRhUm93cyhkb2MpIHtcbiAgcmV0dXJuIFtcbiAgICBbXG4gICAgICBkb2MuX2lkLFxuICAgICAgZG9jLm93bmVyVWlkLFxuICAgICAgZG9jLm93bmVyRW1haWwsXG4gICAgICBkb2MuZmVjaGEsXG4gICAgICBkb2MubWVzLFxuICAgICAgZG9jLmFuaW8sXG4gICAgICBkb2MudmVuZG9yLFxuICAgICAgZG9jLnByb3ZpbmNpYSxcbiAgICAgIGRvYy5sb2NhbGlkYWQsXG4gICAgICBkb2MudGllbmRhLFxuICAgICAgZG9jLnRpcG8sXG4gICAgICBkb2MubG9jYWwsXG4gICAgICBkb2MudGFtYW5vLFxuICAgICAgZG9jLmZpZGVsaWRhZCxcbiAgICAgIGRvYy5yZWxldmFuY2lhLFxuICAgICAgZG9jLnBvcCxcbiAgICAgIGRvYy5uZWNlc2lkYWRQdW50dWFsLFxuICAgICAgZG9jLnRpcG9WZW50YSxcbiAgICAgIGRvYy5wb25kZXJhY2lvbk1vc3RyYWRvLFxuICAgICAgZG9jLnBvbmRlcmFjaW9uRWNvbW1lcmNlLFxuICAgICAgZG9jLmNvbXBldGVuY2lhLFxuICAgICAgZG9jLm9wb3J0dW5pZGFkLFxuICAgICAgZG9jLm1hc1ZlbmRpZG8sXG4gICAgICBkb2MubWFzUHJlZ3VudGFuLFxuICAgICAgZG9jLmF5dWRhVGllbmRhLFxuICAgICAgZG9jLmdwc1N0YXR1cyxcbiAgICAgIGRvYy5ncHNEaXN0YW5jZU0sXG4gICAgICBkb2MuaW50ZXJhY3Rpb25UeXBlLFxuICAgICAgZG9jLmZvcm1hQ29udGFjdG8sXG4gICAgICBkb2MuY29udGFjdG9SZXN1bHRhZG8sXG4gICAgICBkb2MuY29udGFjdG9SZXN1bHRhZG9BdCxcbiAgICAgIGRvYy5jb250YWN0b1Jlc3VsdGFkb0J5LFxuICAgICAgZG9jLmNyZWF0ZWRBdCxcbiAgICBdLFxuICBdO1xufVxuXG4vKiogQHBhcmFtIHthbnl9IGRvYyBAcmV0dXJucyB7dW5rbm93bltdW119ICovXG5leHBvcnQgZnVuY3Rpb24gYnVpbGRDbGllbnRlUm93cyhkb2MpIHtcbiAgcmV0dXJuIFtcbiAgICBbXG4gICAgICBkb2MuX2lkLFxuICAgICAgZG9jLm93bmVyVWlkLFxuICAgICAgZG9jLm93bmVyRW1haWwsXG4gICAgICBkb2Mub3duZXJOYW1lLFxuICAgICAgZG9jLmNvbWVyY2lvLFxuICAgICAgZG9jLmZhbnRhc2lhLFxuICAgICAgZG9jLmN1aXQsXG4gICAgICBkb2MuY29uZGljaW9uRmlzY2FsLFxuICAgICAgZG9jLmNhbGxlLFxuICAgICAgZG9jLm51bWVybyxcbiAgICAgIGRvYy5sb2NhbGlkYWQsXG4gICAgICBkb2MucHJvdmluY2lhLFxuICAgICAgZG9jLmxvY2FsaWRhZEZpbmFsLFxuICAgICAgZG9jLmNhcmRDb2RlU2FwLFxuICAgICAgZG9jLmFzc2lnbmVkVmVuZG9yLFxuICAgICAgZG9jLnN0YXR1cyxcbiAgICAgIGRvYy5zb3VyY2UsXG4gICAgICBkb2MubWFudWFsU2FwUGVuZGluZyxcbiAgICAgIGRvYy5wcmVjYXVjaW9uLFxuICAgICAgZG9jLmNhdGVnb3JpYUNsaWVudGUsXG4gICAgICBkb2MuY2xpVGlwbyxcbiAgICAgIGRvYy5sYXQsXG4gICAgICBkb2MubG5nLFxuICAgICAgZG9jLmxhdCAhPSBudWxsICYmIGRvYy5sbmcgIT0gbnVsbCxcbiAgICAgICEhKGRvYy5jYWxsZSB8fCBkb2MuYWRkcmVzcyksXG4gICAgICBkb2Muc3VibWl0dGVkQnlQdWJsaWNGb3JtLFxuICAgICAgZG9jLmFwcHJvdmVkQXQsXG4gICAgICBkb2MuY3JlYXRlZEF0LFxuICAgICAgZG9jLnVwZGF0ZWRBdCxcbiAgICBdLFxuICBdO1xufVxuXG4vKiogQHBhcmFtIHthbnl9IGRvYyBAcmV0dXJucyB7dW5rbm93bltdW119ICovXG5leHBvcnQgZnVuY3Rpb24gYnVpbGRDbGllbnRNYXN0ZXJSb3dzKGRvYykge1xuICByZXR1cm4gW1xuICAgIFtcbiAgICAgIGRvYy5faWQsXG4gICAgICBkb2MuY2xpZW50TmFtZSxcbiAgICAgIGRvYy5wcm92aW5jaWEsXG4gICAgICBkb2MubG9jYWxpZGFkLFxuICAgICAgZG9jLnZlbmRvcixcbiAgICAgIGRvYy5hZGRyZXNzLFxuICAgICAgZG9jLnNhcENhcmRDb2RlLFxuICAgICAgZG9jLnNhcEFkZHJlc3MsXG4gICAgICBkb2Muc2FwQ2l0eSxcbiAgICAgIGRvYy5zYXBTdGF0ZSxcbiAgICAgIGRvYy5zYXBJbXBvcnRlZEF0LFxuICAgICAgZG9jLnNhcEltcG9ydGVkQnksXG4gICAgICBkb2MuY2xpZW50TmFtZU9yaWdpbmFsLFxuICAgICAgZG9jLmxvY2FsaWRhZE9yaWdpbmFsLFxuICAgICAgZG9jLm1hdGNoVHlwZSxcbiAgICAgIGRvYy5tYXRjaFNpbWlsYXJpdHksXG4gICAgICBkb2MudXBkYXRlZEF0LFxuICAgICAgZG9jLnVwZGF0ZWRCeSxcbiAgICBdLFxuICBdO1xufVxuXG4vKiogQHBhcmFtIHthbnl9IGRvYyBAcmV0dXJucyB7dW5rbm93bltdW119ICovXG5leHBvcnQgZnVuY3Rpb24gYnVpbGRSZW5kaWNpb25Sb3dzKGRvYykge1xuICByZXR1cm4gW1xuICAgIFtcbiAgICAgIGRvYy5faWQsXG4gICAgICBkb2Mub3duZXJVaWQsXG4gICAgICBkb2Mub3duZXJFbWFpbCxcbiAgICAgIGRvYy52ZW5kb3IsXG4gICAgICBkb2MudGlwbyxcbiAgICAgIGRvYy50aXBvR2FzdG8sXG4gICAgICBkb2MuaW1wb3J0ZUFycyAhPSBudWxsID8gZG9jLmltcG9ydGVBcnMgOiBkb2MuaW1wb3J0ZSxcbiAgICAgIGRvYy5mZWNoYUdhc3RvLFxuICAgICAgZG9jLmNvbmNlcHRvLFxuICAgICAgLy8gZm90b1RpY2tldFVybCAodjMwOCspIHByaW9yaWRhZDsgTlVOQ0EgZXhwb3J0YXIgYmFzZTY0IGZvdG9UaWNrZXQgbGVnYWN5XG4gICAgICBkb2MuZm90b1RpY2tldFVybCB8fCBudWxsLFxuICAgICAgZG9jLnN0YXR1cyxcbiAgICAgIGRvYy5hcHByb3ZlZEJ5LFxuICAgICAgZG9jLmFwcHJvdmVkQXQsXG4gICAgICBkb2MucmVqZWN0ZWRCeUVtYWlsLFxuICAgICAgZG9jLnJlamVjdGVkUmVhc29uLFxuICAgICAgZG9jLmFwcHJvdmVyVWlkLFxuICAgICAgZG9jLmNyZWF0ZWRBdCxcbiAgICBdLFxuICBdO1xufVxuXG4vKiogQHBhcmFtIHthbnl9IGRvYyBAcmV0dXJucyB7dW5rbm93bltdW119ICovXG5leHBvcnQgZnVuY3Rpb24gYnVpbGRDYW1wYW5pYVJvd3MoZG9jKSB7XG4gIHJldHVybiBbXG4gICAgW1xuICAgICAgZG9jLl9pZCxcbiAgICAgIGRvYy5uYW1lLFxuICAgICAgZG9jLmZhbWlsaWEsXG4gICAgICBkb2Muc3ViZmFtaWxpYSxcbiAgICAgIGRvYy5maWx0ZXJUeXBlLFxuICAgICAgZG9jLmZpbHRlclZhbHVlcyxcbiAgICAgIGRvYy5za3VzLFxuICAgICAgQXJyYXkuaXNBcnJheShkb2Muc2t1cykgPyBkb2Muc2t1cy5sZW5ndGggOiAwLFxuICAgICAgZG9jLnRhcmdldFR5cGUsXG4gICAgICBkb2MudGFyZ2V0QW1vdW50LFxuICAgICAgZG9jLnN0YXJ0RGF0ZSxcbiAgICAgIGRvYy5lbmREYXRlLFxuICAgICAgZG9jLnNjb3BlLFxuICAgICAgZG9jLnNjb3BlVmFsdWVzLFxuICAgICAgZG9jLmNyZWF0ZWRCeSxcbiAgICAgIGRvYy5jcmVhdGVkQnlFbWFpbCxcbiAgICAgIGRvYy5jcmVhdGVkQXQsXG4gICAgICBkb2MuYXJjaGl2ZWRNYW51YWxseSxcbiAgICAgIGRvYy5hcmNoaXZlZEF0LFxuICAgICAgZG9jLmFyY2hpdmVkQnksXG4gICAgXSxcbiAgXTtcbn1cblxuLyoqIEBwYXJhbSB7YW55fSBkb2MgQHJldHVybnMge3Vua25vd25bXVtdfSAqL1xuZXhwb3J0IGZ1bmN0aW9uIGJ1aWxkVGFyZ2V0Um93cyhkb2MpIHtcbiAgcmV0dXJuIFtcbiAgICBbXG4gICAgICBkb2MuX2lkLFxuICAgICAgZG9jLnNlbGxlcklkLFxuICAgICAgZG9jLnllYXIsXG4gICAgICBkb2MubW9udGgsXG4gICAgICBkb2MudGFyZ2V0QXJzLFxuICAgICAgZG9jLnRhcmdldEJ5RmFtaWx5ID8gZG9jLnRhcmdldEJ5RmFtaWx5LlJFRUwgOiBudWxsLFxuICAgICAgZG9jLnRhcmdldEJ5RmFtaWx5ID8gZG9jLnRhcmdldEJ5RmFtaWx5LkNBTkFTIDogbnVsbCxcbiAgICAgIGRvYy50YXJnZXRCeUZhbWlseSA/IGRvYy50YXJnZXRCeUZhbWlseS5MSU5FQVMgOiBudWxsLFxuICAgICAgZG9jLnVwZGF0ZWRBdCxcbiAgICAgIGRvYy51cGRhdGVkQnksXG4gICAgICBkb2MudXBkYXRlZEJ5RW1haWwsXG4gICAgXSxcbiAgXTtcbn1cblxuLyoqIEBwYXJhbSB7YW55fSBkb2MgQHJldHVybnMge3Vua25vd25bXVtdfSAqL1xuZXhwb3J0IGZ1bmN0aW9uIGJ1aWxkVmVuZG9yT3ZlcnJpZGVSb3dzKGRvYykge1xuICByZXR1cm4gW1xuICAgIFtcbiAgICAgIGRvYy5faWQsXG4gICAgICBkb2Muc2NvcGUsXG4gICAgICBkb2MucHJvdmluY2UsXG4gICAgICBkb2MubG9jYWxpdHlOYW1lLFxuICAgICAgZG9jLmNsaWVudE5hbWUsXG4gICAgICBkb2Mub3JpZ2luYWxWZW5kb3IsXG4gICAgICBkb2MubmV3VmVuZG9yLFxuICAgICAgZG9jLm5ld1R5cGUsXG4gICAgICBkb2MudXBkYXRlZEF0LFxuICAgICAgZG9jLnVwZGF0ZWRCeVVpZCxcbiAgICAgIGRvYy51cGRhdGVkQnlFbWFpbCxcbiAgICAgIGRvYy51cGRhdGVkQnlEaXNwbGF5TmFtZSxcbiAgICBdLFxuICBdO1xufVxuXG4vKiogQHBhcmFtIHthbnl9IGRvYyBAcmV0dXJucyB7dW5rbm93bltdW119ICovXG5leHBvcnQgZnVuY3Rpb24gYnVpbGRDdXN0b21Sb3V0ZVJvd3MoZG9jKSB7XG4gIGNvbnN0IGhlYWRlciA9IFtcbiAgICBkb2MuX2lkLFxuICAgIGRvYy5vd25lclVpZCxcbiAgICBkb2Mub3duZXJFbWFpbCxcbiAgICBkb2MubmFtZSxcbiAgICBkb2MucGxhbm5lZERhdGUsXG4gICAgZG9jLm5vdGVzLFxuICAgIGRvYy5jcmVhdGVkQXQsXG4gICAgZG9jLnVwZGF0ZWRBdCxcbiAgXTtcbiAgY29uc3Qgc3RvcHMgPSBBcnJheS5pc0FycmF5KGRvYy5zdG9wcykgPyBkb2Muc3RvcHMgOiBbXTtcbiAgaWYgKCFzdG9wcy5sZW5ndGgpIHtcbiAgICByZXR1cm4gW2hlYWRlci5jb25jYXQoW251bGwsIG51bGwsIG51bGwsIG51bGwsIG51bGwsIG51bGwsIG51bGwsIG51bGxdKV07XG4gIH1cbiAgcmV0dXJuIHN0b3BzLm1hcCgoLyoqIEB0eXBlIHthbnl9ICovIHMpID0+XG4gICAgaGVhZGVyLmNvbmNhdChbXG4gICAgICBzID8gcy5vcmRlciA6IG51bGwsXG4gICAgICBzID8gcy5rZXkgOiBudWxsLFxuICAgICAgcyA/IHMudGlwbyA6IG51bGwsXG4gICAgICBzID8gcy5wcm92aW5jaWEgOiBudWxsLFxuICAgICAgcyA/IHMubG9jYWxpZGFkIDogbnVsbCxcbiAgICAgIHMgPyBzLmNsaWVudE5hbWUgOiBudWxsLFxuICAgICAgcyA/IHMuaXNQcm92aXNvcmlvIDogbnVsbCxcbiAgICAgIHMgPyBzLnNhcEFsdGFJZCA6IG51bGwsXG4gICAgXSlcbiAgKTtcbn1cblxuLyoqIEBwYXJhbSB7YW55fSBkb2MgQHJldHVybnMge3Vua25vd25bXVtdfSAqL1xuZXhwb3J0IGZ1bmN0aW9uIGJ1aWxkU2VndWltaWVudG9Ob3RlUm93cyhkb2MpIHtcbiAgcmV0dXJuIFtcbiAgICBbXG4gICAgICBkb2MuX2lkLFxuICAgICAgZG9jLnZlbmRvckV4dCxcbiAgICAgIGRvYy5jbGllbnRLZXksXG4gICAgICBkb2MuY2xpZW50TmFtZSxcbiAgICAgIGRvYy5wcm92aW5jZSxcbiAgICAgIGRvYy5sb2NhbGl0eSxcbiAgICAgIGRvYy50ZXh0LFxuICAgICAgZG9jLmF1dGhvclVpZCxcbiAgICAgIGRvYy5hdXRob3JFbWFpbCxcbiAgICAgIGRvYy5hdXRob3JOYW1lLFxuICAgICAgZG9jLmF1dGhvclJvbGUsXG4gICAgICBkb2MuY3JlYXRlZEF0LFxuICAgIF0sXG4gIF07XG59XG5cbi8qKlxuICogUHJvZHVjdG9zIGRlc2RlIHN0b2NrLmpzb24gKGZvcm1hdG8gU2hpbWFubzoge3N0b2NrOiB7U0tVOiBib29sLCAuLi59LFxuICogcXVhbnRpdGllczogSlNPTiBzdHJpbmcsIHdhcmVob3VzZUJyZWFrZG93bjogSlNPTiBzdHJpbmcsIHVwZGF0ZWRBdDogLi4ufSkuXG4gKiBAcGFyYW0ge29iamVjdH0gc3RvY2tKc29uXG4gKiBAcmV0dXJucyB7dW5rbm93bltdW119XG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBidWlsZFByb2R1Y3RvUm93c0Zyb21TdG9ja0pzb24oc3RvY2tKc29uKSB7XG4gIGNvbnN0IHNqID0gLyoqIEB0eXBlIHthbnl9ICovIChzdG9ja0pzb24pIHx8IHt9O1xuICBjb25zdCBzdG9ja01hcCA9IHNqLnN0b2NrIHx8IHt9O1xuICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIG51bWJlcj59ICovXG4gIGxldCBxdWFudGl0aWVzID0ge307XG4gIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmVjb3JkPHN0cmluZywgbnVtYmVyPj59ICovXG4gIGxldCBicmVha2Rvd24gPSB7fTtcbiAgdHJ5IHtcbiAgICBxdWFudGl0aWVzID0gc2oucXVhbnRpdGllcyA/IEpTT04ucGFyc2Uoc2oucXVhbnRpdGllcykgOiBzai5xdWFudGl0aWVzX21hcCB8fCB7fTtcbiAgfSBjYXRjaCAoXykge31cbiAgdHJ5IHtcbiAgICBicmVha2Rvd24gPSBzai53YXJlaG91c2VCcmVha2Rvd25cbiAgICAgID8gSlNPTi5wYXJzZShzai53YXJlaG91c2VCcmVha2Rvd24pXG4gICAgICA6IHNqLndhcmVob3VzZUJyZWFrZG93bl9tYXAgfHwge307XG4gIH0gY2F0Y2ggKF8pIHt9XG4gIGNvbnN0IHJvd3MgPSAvKiogQHR5cGUge3Vua25vd25bXVtdfSAqLyAoW10pO1xuICBjb25zdCBzb3VyY2UgPSAnc3RvY2suanNvbiBzbmFwc2hvdCc7XG4gIGNvbnN0IHVwZGF0ZWRBdCA9IHNqLnVwZGF0ZWRBdCB8fCBzai5zbmFwc2hvdEF0IHx8IG51bGw7XG4gIGZvciAoY29uc3Qgc2t1IG9mIE9iamVjdC5rZXlzKHN0b2NrTWFwKSkge1xuICAgIGNvbnN0IGhhc19zdG9jayA9ICEhc3RvY2tNYXBbc2t1XTtcbiAgICBjb25zdCB0b3RhbCA9IE51bWJlcihxdWFudGl0aWVzW3NrdV0gfHwgMCk7XG4gICAgY29uc3Qgd2JzID0gYnJlYWtkb3duW3NrdV0gfHwge307XG4gICAgY29uc3QgdzExID0gTnVtYmVyKHdic1snMTEnXSB8fCAwKTtcbiAgICBjb25zdCB3MTIgPSBOdW1iZXIod2JzWycxMiddIHx8IDApO1xuICAgIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgbnVtYmVyPn0gKi9cbiAgICBjb25zdCBvdHJvcyA9IHt9O1xuICAgIGZvciAoY29uc3QgayBvZiBPYmplY3Qua2V5cyh3YnMpKSB7XG4gICAgICBpZiAoayAhPT0gJzExJyAmJiBrICE9PSAnMTInKSBvdHJvc1trXSA9IE51bWJlcih3YnNba10gfHwgMCk7XG4gICAgfVxuICAgIHJvd3MucHVzaChbXG4gICAgICBza3UsXG4gICAgICBoYXNfc3RvY2ssXG4gICAgICB0b3RhbCxcbiAgICAgIHcxMSxcbiAgICAgIHcxMixcbiAgICAgIE9iamVjdC5rZXlzKG90cm9zKS5sZW5ndGggPyBvdHJvcyA6IG51bGwsXG4gICAgICBzb3VyY2UsXG4gICAgICB1cGRhdGVkQXQsXG4gICAgXSk7XG4gIH1cbiAgcmV0dXJuIHJvd3M7XG59XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gRGlzcGF0Y2hlcjogbWFwYSBjb2xsZWN0aW9uIC0+IHJvdyBidWlsZGVyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCAoZG9jOiBhbnkpID0+IHVua25vd25bXVtdPn0gKi9cbmV4cG9ydCBjb25zdCBST1dfQlVJTERFUlMgPSB7XG4gIHBlZGlkb3M6IGJ1aWxkUGVkaWRvUm93cyxcbiAgdmlzaXRhczogYnVpbGRWaXNpdGFSb3dzLFxuICBjbGllbnRlczogYnVpbGRDbGllbnRlUm93cyxcbiAgY2xpZW50X21hc3RlcjogYnVpbGRDbGllbnRNYXN0ZXJSb3dzLFxuICByZW5kaWNpb25lczogYnVpbGRSZW5kaWNpb25Sb3dzLFxuICBjYW1wYW5pYXM6IGJ1aWxkQ2FtcGFuaWFSb3dzLFxuICB0YXJnZXRzOiBidWlsZFRhcmdldFJvd3MsXG4gIHZlbmRvcl9vdmVycmlkZXM6IGJ1aWxkVmVuZG9yT3ZlcnJpZGVSb3dzLFxuICBjdXN0b21fcm91dGVzOiBidWlsZEN1c3RvbVJvdXRlUm93cyxcbiAgc2VndWltaWVudG9fbm90ZXM6IGJ1aWxkU2VndWltaWVudG9Ob3RlUm93cyxcbn07XG4iLCAiLy8gQHRzLW5vY2hlY2tcbi8vIEVYUE9SVFMtQURWQU5DRUQ6IHBob3RvIFpJUHMsIGF1ZGl0IFhMU1gsIGV4ZWN1dGl2ZSBzdW1tYXJ5LCB2aXNpdHMgWExTWCxcbi8vIFBvd2VyQkkgZGF0YXNldCwgTUwgZGF0YXNldC4gRXh0cmFcdTAwRURkbyB2ZXJiYXRpbSBkZSBpbmRleC5odG1sICg0IGZyYWdtZW50b3Ncbi8vIGRpc2NvbnRpbnVvcyBzZXBhcmFkb3MgcG9yIEJhY2t1cCArIEF1ZGl0ICsgX2V4cG9ydExlZ2FjeUZ1bGwgcXVlIHF1ZWRhblxuLy8gZW4gZWwgaW5saW5lKSBjb21vIHBhcnRlIGRlIEUyLm4uMiAoZTJiLXBlcmYgMjAyNi0wNy0yOCkuXG4vL1xuLy8gdjM3MSs6IGV4cG9ydERhdGFzZXRaaXAoKSBudWV2byBcdTIwMTQgWklQIGNvbiBDU1ZzIHBvciBlbnRpZGFkIHBhcmEgcGlwZWxpbmVzXG4vLyBNTCBleHRlcm5vcyAoTWljcm9zb2Z0IEZhYnJpYykuIEltcG9ydGEgbG9zIGhlbHBlcnMgcHVyb3MgeSBzY2hlbWFzIGRlbFxuLy8gbW9kdWxvIHNyYy9wdXJlL2Nzdi1zZXJpYWxpemVyLmpzLiBWZXIgcGxhbiBjb3NtaWMtcG9uZGVyaW5nLXN0ZWFybnMubWQuXG5cbmltcG9ydCB7XG4gIGJ1aWxkQ3N2LFxuICBidWlsZFByb2R1Y3RvUm93c0Zyb21TdG9ja0pzb24sXG4gIGNvbXB1dGVOdWxsUmF0ZXMsXG4gIERBVEFTRVRfU0NIRU1BUyxcbiAgREFUQVNFVF9VU0VfQ0FTRV9NQVRSSVgsXG4gIFJPV19CVUlMREVSUyxcbn0gZnJvbSAnLi4vcHVyZS9jc3Ytc2VyaWFsaXplci5qcyc7XG5cbi8vXG4vLyBEZXBzIGRlbCBpbmxpbmU6IEpTWmlwIChDRE4gbGF6eSksIEV4Y2VsSlMgKENETiBsYXp5IHZpYSBsb2FkRXhjZWxKUyksXG4vLyBYTFNYIChkZWZlciBlbiBoZWFkKSwgdmlzaXRzQ2FjaGUsIGNhbXBhaWduc0NhY2hlLCBvcHNMb2dDYWNoZSAoYXVkaXRcbi8vIGlubGluZSksIGF1ZGl0TG9nQ2FjaGUgKGF1ZGl0IGlubGluZSksIGNvbnRhY3RlZCAoZ2xvYmFsIFNldCksIFBPSU5UUyxcbi8vIFBST0RVQ1RTLCBWRU5ET1JTLCBNRVNFUywgdmVuZG9yTG9va3VwLCBlc2NhcGVIdG1sLCBlc2NhcGVBdHRyLCB0aXRsZUNhc2UsXG4vLyBzaG93U3luY1RhZywgY3VycmVudFVzZXIsIHVzZXJSb2xlLCBvcmRlcnMsIGNvbmZpcm1lZCwgcGVuZGluZy5cbi8vXG4vLyBDcm9zcy1zY29wZSBzdGF0ZTogTk9ORSAodG9kb3MgbG9zIGhlbHBlcnMgeSBjb25zdHMgbG9jYWxlcyBhbCBibG9xdWUpLlxuLy8gU2luIGxpc3RlbmVycyBvblNuYXBzaG90LlxuLy9cbi8vIE5PVEE6IGxvcyBoZWxwZXJzIHRvZGF5U3RyL2RhdGFVcmxUb0Jsb2Ivc2FuaXRpemVGb3JQYXRoIHZpdmVuIGVuIGVzdGVcbi8vIG1cdTAwRjNkdWxvIFx1MjAxNCBlbCBpbmxpbmUgcHVlZGUgbGxhbWFybG9zIHZpYSBmcmVlIHJlZmVyZW5jZSBhbCBHbG9iYWwgRW52aXJvbm1lbnRcbi8vIFJlY29yZCBwZXJvIHByZWZlcmltb3MgZXhwb3NpY2lcdTAwRjNuIHdpbmRvdy4qIGV4cGxcdTAwRURjaXRhIGFsIGZpbmFsLlxuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gU0VDQ0lcdTAwRDNOOiBoZWxwZXJzICsgcGhvdG9zIHppcCArIHZpc2l0cyBlbWJlZGRlZCAoaW5saW5lIEw5MjU2LTk0NDUpXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuZnVuY3Rpb24gdG9kYXlTdHIoKSB7XG4gIHJldHVybiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwgMTApO1xufVxuXG4vLyBIZWxwZXI6IGNvbnZlcnRpciBkYXRhVVJMIGJhc2U2NCBhIEJsb2IgcGFyYSBpbmNsdWlyIGVuIFpJUFxuZnVuY3Rpb24gZGF0YVVybFRvQmxvYihkYXRhVXJsKSB7XG4gIGlmICghZGF0YVVybCkgcmV0dXJuIG51bGw7XG4gIGNvbnN0IHBhcnRzID0gZGF0YVVybC5zcGxpdCgnLCcpO1xuICBpZiAocGFydHMubGVuZ3RoIDwgMikgcmV0dXJuIG51bGw7XG4gIGNvbnN0IG1pbWVNYXRjaCA9IHBhcnRzWzBdLm1hdGNoKC86KC4qPyk7Lyk7XG4gIGNvbnN0IG1pbWUgPSBtaW1lTWF0Y2ggPyBtaW1lTWF0Y2hbMV0gOiAnaW1hZ2UvanBlZyc7XG4gIGNvbnN0IGJ5dGVzID0gYXRvYihwYXJ0c1sxXSk7XG4gIGNvbnN0IGFyciA9IG5ldyBVaW50OEFycmF5KGJ5dGVzLmxlbmd0aCk7XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgYnl0ZXMubGVuZ3RoOyBpKyspIGFycltpXSA9IGJ5dGVzLmNoYXJDb2RlQXQoaSk7XG4gIHJldHVybiBuZXcgQmxvYihbYXJyXSwgeyB0eXBlOiBtaW1lIH0pO1xufVxuXG4vLyBTYW5lYXIgbm9tYnJlcyBwYXJhIHF1ZSBzaXJ2YW4gY29tbyBydXRhIGRlIGFyY2hpdm9cbmZ1bmN0aW9uIHNhbml0aXplRm9yUGF0aChzKSB7XG4gIHJldHVybiBTdHJpbmcocyB8fCAnJylcbiAgICAucmVwbGFjZSgvW1xcXFwvKj9bXFxdOnxcIjw+XS9nLCAnXycpXG4gICAgLnJlcGxhY2UoL1xccysvZywgJyAnKVxuICAgIC50cmltKClcbiAgICAuc2xpY2UoMCwgNjApO1xufVxuXG4vLyBEZXNjYXJnYXIgdG9kYXMgbGFzIGZvdG9zIGRlIHZpc2l0YXMgZW4gdW4gWklQIG9yZ2FuaXphZG8gcG9yIHZlbmRlZG9yIC8gdGllbmRhIC8gZmVjaGFcbndpbmRvdy5leHBvcnRQaG90b3NaaXAgPSBhc3luYyBmdW5jdGlvbiAoKSB7XG4gIGlmICh0eXBlb2YgSlNaaXAgPT09ICd1bmRlZmluZWQnKSB7XG4gICAgYWxlcnQoJ0NhcmdhbmRvIGxpYnJlcmlhIFpJUCwgaW50ZW50YSBkZSBudWV2byBlbiA1IHNlZ3VuZG9zLicpO1xuICAgIHJldHVybjtcbiAgfVxuICBpZiAoIXZpc2l0c0NhY2hlIHx8ICF2aXNpdHNDYWNoZS5sZW5ndGgpIHtcbiAgICBhbGVydCgnTm8gaGF5IHZpc2l0YXMgcmVnaXN0cmFkYXMuJyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGxldCBwaG90b0NvdW50ID0gMDtcbiAgY29uc3QgemlwID0gbmV3IEpTWmlwKCk7XG4gIHZpc2l0c0NhY2hlLmZvckVhY2goKHYpID0+IHtcbiAgICBjb25zdCB2ZW5kb3IgPSBzYW5pdGl6ZUZvclBhdGgodGl0bGVDYXNlKHYudmVuZG9yIHx8ICdTSU5fVkVOREVET1InKSk7XG4gICAgY29uc3QgdGllbmRhID0gc2FuaXRpemVGb3JQYXRoKHYudGllbmRhIHx8ICdzaW5fdGllbmRhJyk7XG4gICAgY29uc3QgZmVjaGEgPSAodi5mZWNoYSB8fCAnJykucmVwbGFjZSgvLS9nLCAnJyk7XG4gICAgY29uc3QgZm9sZGVyTmFtZSA9IHZlbmRvciArICcvJyArIHRpZW5kYSArICdfJyArIGZlY2hhO1xuICAgIGNvbnN0IGZvbGRlciA9IHppcC5mb2xkZXIoZm9sZGVyTmFtZSk7XG4gICAgaWYgKHYuZnJlbnRlTG9jYWwpIHtcbiAgICAgIGNvbnN0IGIgPSBkYXRhVXJsVG9CbG9iKHYuZnJlbnRlTG9jYWwpO1xuICAgICAgaWYgKGIpIHtcbiAgICAgICAgZm9sZGVyLmZpbGUoJ2ZyZW50ZS5qcGcnLCBiKTtcbiAgICAgICAgcGhvdG9Db3VudCsrO1xuICAgICAgfVxuICAgIH1cbiAgICAodi5lc3BhY2lvIHx8IFtdKS5mb3JFYWNoKChiNjQsIGkpID0+IHtcbiAgICAgIGNvbnN0IGIgPSBkYXRhVXJsVG9CbG9iKGI2NCk7XG4gICAgICBpZiAoYikge1xuICAgICAgICBmb2xkZXIuZmlsZSgnZXNwYWNpb18nICsgKGkgKyAxKSArICcuanBnJywgYik7XG4gICAgICAgIHBob3RvQ291bnQrKztcbiAgICAgIH1cbiAgICB9KTtcbiAgfSk7XG4gIGlmICghcGhvdG9Db3VudCkge1xuICAgIGFsZXJ0KCdObyBoYXkgZm90b3MgY2FyZ2FkYXMgZW4gbGFzIHZpc2l0YXMuJyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIHNob3dTeW5jVGFnKCdHZW5lcmFuZG8gWklQIGRlICcgKyBwaG90b0NvdW50ICsgJyBmb3Rvcy4uLicsIDMwMDAwKTtcbiAgdHJ5IHtcbiAgICBjb25zdCBibG9iID0gYXdhaXQgemlwLmdlbmVyYXRlQXN5bmMoeyB0eXBlOiAnYmxvYicsIGNvbXByZXNzaW9uOiAnREVGTEFURScgfSk7XG4gICAgY29uc3QgdXJsID0gVVJMLmNyZWF0ZU9iamVjdFVSTChibG9iKTtcbiAgICBjb25zdCBhID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnYScpO1xuICAgIGEuaHJlZiA9IHVybDtcbiAgICBhLmRvd25sb2FkID0gJ1NoaW1hbm9fRm90b3NfVmlzaXRhc18nICsgdG9kYXlTdHIoKSArICcuemlwJztcbiAgICBhLmNsaWNrKCk7XG4gICAgc2V0VGltZW91dCgoKSA9PiBVUkwucmV2b2tlT2JqZWN0VVJMKHVybCksIDUwMDApO1xuICAgIHNob3dTeW5jVGFnKHBob3RvQ291bnQgKyAnIGZvdG9zIGRlc2NhcmdhZGFzJywgMzAwMCk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBjb25zb2xlLmVycm9yKCd6aXAnLCBlKTtcbiAgICBhbGVydCgnRXJyb3IgZ2VuZXJhbmRvIFpJUDogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xuICB9XG59O1xuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIEV4Y2VsIGNvbiBmb3RvcyBkZWwgZnJlbnRlIGVtYmViaWRhcyBlbiBjYWRhIGNlbGRhIChFeGNlbEpTKVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBFeGNlbEpTIHNlIGNhcmdhIGxhenkgKHNvbG8gY3VhbmRvIHNlIHRvY2EgZWwgYm90b24pIHBhcmEgbm8gaW5mbGFyIGVsIGJ1bmRsZS5cbmZ1bmN0aW9uIGxvYWRFeGNlbEpTKCkge1xuICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgIGlmICh0eXBlb2YgRXhjZWxKUyAhPT0gJ3VuZGVmaW5lZCcpIHJldHVybiByZXNvbHZlKCk7XG4gICAgY29uc3QgcyA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3NjcmlwdCcpO1xuICAgIHMuc3JjID0gJ2h0dHBzOi8vY2RuLmpzZGVsaXZyLm5ldC9ucG0vZXhjZWxqc0A0LjQuMC9kaXN0L2V4Y2VsanMubWluLmpzJztcbiAgICBzLm9ubG9hZCA9ICgpID0+IHJlc29sdmUoKTtcbiAgICBzLm9uZXJyb3IgPSAoKSA9PlxuICAgICAgcmVqZWN0KG5ldyBFcnJvcignTm8gc2UgcHVkbyBjYXJnYXIgbGEgbGlicmVyaWEgRXhjZWxKUy4gUmV2aXNhIHR1IGNvbmV4aW9uIGEgaW50ZXJuZXQuJykpO1xuICAgIGRvY3VtZW50LmhlYWQuYXBwZW5kQ2hpbGQocyk7XG4gIH0pO1xufVxuXG53aW5kb3cuZXhwb3J0VmlzaXRzV2l0aEVtYmVkZGVkUGhvdG9zID0gYXN5bmMgZnVuY3Rpb24gKCkge1xuICBpZiAoIXZpc2l0c0NhY2hlIHx8ICF2aXNpdHNDYWNoZS5sZW5ndGgpIHtcbiAgICBhbGVydCgnTm8gaGF5IHZpc2l0YXMgcmVnaXN0cmFkYXMuJyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGNvbnN0IG4gPSB2aXNpdHNDYWNoZS5sZW5ndGg7XG4gIGlmIChuID4gMzAwKSB7XG4gICAgaWYgKFxuICAgICAgIWNvbmZpcm0oXG4gICAgICAgICdIYXkgJyArXG4gICAgICAgICAgbiArXG4gICAgICAgICAgJyB2aXNpdGFzLiBFbCBFeGNlbCBjb24gdG9kYXMgbGFzIGZvdG9zIGVtYmViaWRhcyBwdWVkZSBwZXNhciA1MC0xNTAgTUIgeSB0YXJkYXIgdmFyaW9zIG1pbnV0b3MuIFx1MDBCRkNvbnRpbnVhcj8nXG4gICAgICApXG4gICAgKVxuICAgICAgcmV0dXJuO1xuICB9IGVsc2UgaWYgKG4gPiAxMDApIHtcbiAgICBpZiAoXG4gICAgICAhY29uZmlybShcbiAgICAgICAgJ1ZhcyBhIGdlbmVyYXIgdW4gRXhjZWwgY29uICcgK1xuICAgICAgICAgIG4gK1xuICAgICAgICAgICcgdmlzaXRhcyB5IHN1cyBmb3RvcyBlbWJlYmlkYXMuIFB1ZWRlIHRhcmRhciAzMC02MCBzZWd1bmRvcy4gXHUwMEJGQ29udGludWFyPydcbiAgICAgIClcbiAgICApXG4gICAgICByZXR1cm47XG4gIH1cbiAgc2hvd1N5bmNUYWcoJ0NhcmdhbmRvIEV4Y2VsSlMuLi4nLCAyMDAwKTtcbiAgdHJ5IHtcbiAgICBhd2FpdCBsb2FkRXhjZWxKUygpO1xuICB9IGNhdGNoIChlKSB7XG4gICAgYWxlcnQoZS5tZXNzYWdlIHx8IGUpO1xuICAgIHJldHVybjtcbiAgfVxuXG4gIHNob3dTeW5jVGFnKCdHZW5lcmFuZG8gRXhjZWwgY29uICcgKyBuICsgJyB2aXNpdGFzLi4uJywgMzAwMCk7XG5cbiAgY29uc3Qgd2IgPSBuZXcgRXhjZWxKUy5Xb3JrYm9vaygpO1xuICB3Yi5jcmVhdG9yID0gJ0FwcCBWZW5kZWRvcmVzIFNoaW1hbm8nO1xuICB3Yi5jcmVhdGVkID0gbmV3IERhdGUoKTtcbiAgY29uc3Qgd3MgPSB3Yi5hZGRXb3Jrc2hlZXQoJ1Zpc2l0YXMnLCB7IHZpZXdzOiBbeyBzdGF0ZTogJ2Zyb3plbicsIHlTcGxpdDogMSB9XSB9KTtcblxuICAvLyBEZWZpbmljaW9uIGRlIGNvbHVtbmFzLiBMYSBjb2x1bW5hIGRlIGZvdG8gdmEgYSB0ZW5lciBhbmNobyBleHRyYSBwYXJhIHF1ZSBzZSB2ZWEuXG4gIHdzLmNvbHVtbnMgPSBbXG4gICAgeyBoZWFkZXI6ICdGZWNoYScsIGtleTogJ2ZlY2hhJywgd2lkdGg6IDEyIH0sXG4gICAgeyBoZWFkZXI6ICdNZXMnLCBrZXk6ICdtZXMnLCB3aWR0aDogMTAgfSxcbiAgICB7IGhlYWRlcjogJ1ZlbmRlZG9yJywga2V5OiAndmVuZGVkb3InLCB3aWR0aDogMjIgfSxcbiAgICB7IGhlYWRlcjogJ1RpcG8gY29udGFjdG8nLCBrZXk6ICd0aXBvQ3QnLCB3aWR0aDogMTIgfSxcbiAgICB7IGhlYWRlcjogJ0NvbWVudGFyaW8nLCBrZXk6ICdjb21lbnQnLCB3aWR0aDogMzIgfSxcbiAgICB7IGhlYWRlcjogJ1Byb3ZpbmNpYScsIGtleTogJ3Byb3ZpbmNpYScsIHdpZHRoOiAxNiB9LFxuICAgIHsgaGVhZGVyOiAnTG9jYWxpZGFkJywga2V5OiAnbG9jYWxpZGFkJywgd2lkdGg6IDE4IH0sXG4gICAgeyBoZWFkZXI6ICdUaWVuZGEnLCBrZXk6ICd0aWVuZGEnLCB3aWR0aDogMzAgfSxcbiAgICB7IGhlYWRlcjogJ1RpcG8nLCBrZXk6ICd0aXBvJywgd2lkdGg6IDEyIH0sXG4gICAgeyBoZWFkZXI6ICdMb2NhbCcsIGtleTogJ2xvY2FsJywgd2lkdGg6IDEyIH0sXG4gICAgeyBoZWFkZXI6ICdUYW1hbm8nLCBrZXk6ICd0YW1hbm8nLCB3aWR0aDogMTAgfSxcbiAgICB7IGhlYWRlcjogJ0ZpZGVsaWRhZCcsIGtleTogJ2ZpZGVsaWRhZCcsIHdpZHRoOiAxMCB9LFxuICAgIHsgaGVhZGVyOiAnUmVsZXZhbmNpYScsIGtleTogJ3JlbGV2Jywgd2lkdGg6IDEwIH0sXG4gICAgeyBoZWFkZXI6ICdQT1AnLCBrZXk6ICdwb3AnLCB3aWR0aDogOCB9LFxuICAgIHsgaGVhZGVyOiAnVGlwbyB2ZW50YScsIGtleTogJ3RpcG9WZW50YScsIHdpZHRoOiAxMiB9LFxuICAgIHsgaGVhZGVyOiAnQ29tcGV0ZW5jaWEnLCBrZXk6ICdjb21wZScsIHdpZHRoOiAxNiB9LFxuICAgIHsgaGVhZGVyOiAnT3BvcnR1bmlkYWQnLCBrZXk6ICdvcG9ydHUnLCB3aWR0aDogMzAgfSxcbiAgICB7IGhlYWRlcjogJ0xvIG1hcyB2ZW5kaWRvJywga2V5OiAnbWFzVmUnLCB3aWR0aDogMjggfSxcbiAgICB7IGhlYWRlcjogJ0dQUyBkaXN0IChtKScsIGtleTogJ2dwc0Rpc3QnLCB3aWR0aDogMTIgfSxcbiAgICB7IGhlYWRlcjogJ0ZvdG8gZnJlbnRlJywga2V5OiAnZm90bycsIHdpZHRoOiAyMiB9LCAvLyA8LSBsYSBpbWFnZW4gdmEgYWNhXG4gICAgeyBoZWFkZXI6ICdFbWFpbCB2ZW5kZWRvcicsIGtleTogJ2VtYWlsJywgd2lkdGg6IDI4IH0sXG4gIF07XG5cbiAgLy8gRXN0aWxvIGhlYWRlclxuICB3cy5nZXRSb3coMSkuZm9udCA9IHsgYm9sZDogdHJ1ZSwgY29sb3I6IHsgYXJnYjogJ0ZGRkZGRkZGJyB9IH07XG4gIHdzLmdldFJvdygxKS5maWxsID0geyB0eXBlOiAncGF0dGVybicsIHBhdHRlcm46ICdzb2xpZCcsIGZnQ29sb3I6IHsgYXJnYjogJ0ZGMEM0QTZFJyB9IH07XG4gIHdzLmdldFJvdygxKS5hbGlnbm1lbnQgPSB7IHZlcnRpY2FsOiAnbWlkZGxlJywgaG9yaXpvbnRhbDogJ2NlbnRlcicgfTtcbiAgd3MuZ2V0Um93KDEpLmhlaWdodCA9IDIyO1xuXG4gIGNvbnN0IEZPVE9fQ09MX0lEWCA9IHdzLmdldENvbHVtbignZm90bycpLm51bWJlciAtIDE7IC8vIDAtaW5kZXhlZCBwYXJhIGFkZEltYWdlXG4gIGNvbnN0IFJPV19IID0gMTAwO1xuICBjb25zdCBJTUdfVyA9IDEzMDtcbiAgY29uc3QgSU1HX0ggPSA5MDtcblxuICAvLyBPcmRlbmFyIHZpc2l0YXMgcG9yIGZlY2hhIGRlc2MgKG1hcyByZWNpZW50ZXMgcHJpbWVybylcbiAgY29uc3Qgc29ydGVkID0gdmlzaXRzQ2FjaGUuc2xpY2UoKS5zb3J0KChhLCBiKSA9PiAoYi5mZWNoYSB8fCAnJykubG9jYWxlQ29tcGFyZShhLmZlY2hhIHx8ICcnKSk7XG5cbiAgZm9yIChjb25zdCB2IG9mIHNvcnRlZCkge1xuICAgIGNvbnN0IHRpcG9Db250YWN0b0xibCA9IHYudGlwb0NvbnRhY3RvID09PSAndGVsZWZvbm8nID8gJ1RlbGVmb25vJyA6ICdQcmVzZW5jaWFsJztcbiAgICBjb25zdCByID0gd3MuYWRkUm93KHtcbiAgICAgIGZlY2hhOiB2LmZlY2hhIHx8ICcnLFxuICAgICAgbWVzOiB2Lm1lcyB8fCAnJyxcbiAgICAgIHZlbmRlZG9yOiB0aXRsZUNhc2Uodi52ZW5kb3IgfHwgJycpLFxuICAgICAgdGlwb0N0OiB0aXBvQ29udGFjdG9MYmwsXG4gICAgICBjb21lbnQ6IHYuY29tZW50YXJpbyB8fCAnJyxcbiAgICAgIHByb3ZpbmNpYTogdGl0bGVDYXNlKHYucHJvdmluY2lhIHx8ICcnKSxcbiAgICAgIGxvY2FsaWRhZDogdi5sb2NhbGlkYWQgfHwgJycsXG4gICAgICB0aWVuZGE6IHYudGllbmRhIHx8ICcnLFxuICAgICAgdGlwbzogdi50aXBvIHx8ICcnLFxuICAgICAgbG9jYWw6IHYubG9jYWwgfHwgJycsXG4gICAgICB0YW1hbm86IHYudGFtYW5vIHx8ICcnLFxuICAgICAgZmlkZWxpZGFkOiB2LmZpZGVsaWRhZCB8fCAnJyxcbiAgICAgIHJlbGV2OiB2LnJlbGV2YW5jaWEgfHwgJycsXG4gICAgICBwb3A6IHYucG9wIHx8ICcnLFxuICAgICAgdGlwb1ZlbnRhOiB2LnRpcG9WZW50YSA9PT0gJ01PU1RSQURPJyA/ICdNT1NUUkFET1InIDogdi50aXBvVmVudGEgfHwgJycsXG4gICAgICBjb21wZTogdi5jb21wZXRlbmNpYSB8fCAnJyxcbiAgICAgIG9wb3J0dTogdi5vcG9ydHVuaWRhZCB8fCAnJyxcbiAgICAgIG1hc1ZlOiB2Lm1hc1ZlbmRpZG8gfHwgJycsXG4gICAgICBncHNEaXN0OiB0eXBlb2Ygdi5ncHNEaXN0YW5jZU0gPT09ICdudW1iZXInID8gdi5ncHNEaXN0YW5jZU0gOiAnJyxcbiAgICAgIGZvdG86ICcnLCAvLyBsYSBjZWxkYSBxdWVkYSB2YWNpYTsgZW5jaW1hIHZhIGxhIGltYWdlblxuICAgICAgZW1haWw6IHYub3duZXJFbWFpbCB8fCAnJyxcbiAgICB9KTtcbiAgICByLmhlaWdodCA9IFJPV19IO1xuICAgIHIuYWxpZ25tZW50ID0geyB2ZXJ0aWNhbDogJ21pZGRsZScsIHdyYXBUZXh0OiB0cnVlIH07XG4gICAgaWYgKHYuZnJlbnRlTG9jYWwgJiYgdHlwZW9mIHYuZnJlbnRlTG9jYWwgPT09ICdzdHJpbmcnKSB7XG4gICAgICB0cnkge1xuICAgICAgICAvLyBFbCBjYW1wbyBlcyB1biBkYXRhVVJMOiAnZGF0YTppbWFnZS9qcGVnO2Jhc2U2NCwvOWovNEFBUS4uLidcbiAgICAgICAgbGV0IGI2NCA9IHYuZnJlbnRlTG9jYWw7XG4gICAgICAgIGxldCBleHQgPSAnanBlZyc7XG4gICAgICAgIGNvbnN0IG0gPSAvXmRhdGE6aW1hZ2VcXC8oXFx3Kyk7YmFzZTY0LCguKykkL2kuZXhlYyhiNjQpO1xuICAgICAgICBpZiAobSkge1xuICAgICAgICAgIGV4dCA9IG1bMV0udG9Mb3dlckNhc2UoKTtcbiAgICAgICAgICBiNjQgPSBtWzJdO1xuICAgICAgICB9XG4gICAgICAgIGlmIChleHQgPT09ICdqcGcnKSBleHQgPSAnanBlZyc7XG4gICAgICAgIGNvbnN0IGltYWdlSWQgPSB3Yi5hZGRJbWFnZSh7IGJhc2U2NDogYjY0LCBleHRlbnNpb246IGV4dCB9KTtcbiAgICAgICAgd3MuYWRkSW1hZ2UoaW1hZ2VJZCwge1xuICAgICAgICAgIHRsOiB7IGNvbDogRk9UT19DT0xfSURYICsgMC4xLCByb3c6IHIubnVtYmVyIC0gMSArIDAuMSB9LFxuICAgICAgICAgIGV4dDogeyB3aWR0aDogSU1HX1csIGhlaWdodDogSU1HX0ggfSxcbiAgICAgICAgICBlZGl0QXM6ICdvbmVDZWxsJyxcbiAgICAgICAgfSk7XG4gICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgIGNvbnNvbGUud2FybignZW1iZWJpZW5kbyBmb3RvIGZpbGEnLCByLm51bWJlciwgZSk7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLy8gR2VuZXJhciB5IGRlc2NhcmdhclxuICB0cnkge1xuICAgIGNvbnN0IGJ1ZmZlciA9IGF3YWl0IHdiLnhsc3gud3JpdGVCdWZmZXIoKTtcbiAgICBjb25zdCBibG9iID0gbmV3IEJsb2IoW2J1ZmZlcl0sIHtcbiAgICAgIHR5cGU6ICdhcHBsaWNhdGlvbi92bmQub3BlbnhtbGZvcm1hdHMtb2ZmaWNlZG9jdW1lbnQuc3ByZWFkc2hlZXRtbC5zaGVldCcsXG4gICAgfSk7XG4gICAgY29uc3QgdXJsID0gVVJMLmNyZWF0ZU9iamVjdFVSTChibG9iKTtcbiAgICBjb25zdCBhID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnYScpO1xuICAgIGEuaHJlZiA9IHVybDtcbiAgICBhLmRvd25sb2FkID0gJ1NoaW1hbm9fVmlzaXRhc19jb25fZm90b3NfJyArIHRvZGF5U3RyKCkgKyAnLnhsc3gnO1xuICAgIGRvY3VtZW50LmJvZHkuYXBwZW5kQ2hpbGQoYSk7XG4gICAgYS5jbGljaygpO1xuICAgIGRvY3VtZW50LmJvZHkucmVtb3ZlQ2hpbGQoYSk7XG4gICAgc2V0VGltZW91dCgoKSA9PiBVUkwucmV2b2tlT2JqZWN0VVJMKHVybCksIDUwMDApO1xuICAgIHNob3dTeW5jVGFnKCdFeGNlbCBkZXNjYXJnYWRvOiAnICsgc29ydGVkLmxlbmd0aCArICcgdmlzaXRhcycsIDMwMDApO1xuICB9IGNhdGNoIChlKSB7XG4gICAgY29uc29sZS5lcnJvcignZXhwb3J0VmlzaXRzV2l0aEVtYmVkZGVkUGhvdG9zJywgZSk7XG4gICAgYWxlcnQoJ0Vycm9yIGdlbmVyYW5kbyBlbCBFeGNlbDogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xuICB9XG59O1xuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gU0VDQ0lcdTAwRDNOOiBleHBvcnRBdWRpdEV4Y2VsIChpbmxpbmUgTDEwMDQwLTEwMDY3KVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbndpbmRvdy5leHBvcnRBdWRpdEV4Y2VsID0gZnVuY3Rpb24gKCkge1xuICBpZiAodHlwZW9mIFhMU1ggPT09ICd1bmRlZmluZWQnKSB7XG4gICAgYWxlcnQoJ0xhIGxpYnJlcmlhIGRlIEV4Y2VsIG5vIHNlIGNhcmdvLicpO1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCBpdGVtcyA9IGdldEZpbHRlcmVkQXVkaXRFbnRyaWVzKCk7XG4gIGlmICghaXRlbXMubGVuZ3RoKSB7XG4gICAgYWxlcnQoJ05vIGhheSBldmVudG9zIHBhcmEgZXhwb3J0YXIgY29uIGxvcyBmaWx0cm9zIGFwbGljYWRvcy4nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgY29uc3Qgcm93cyA9IGl0ZW1zLm1hcCgoZSkgPT4ge1xuICAgIGNvbnN0IHRzID0gZS50aW1lc3RhbXAgJiYgZS50aW1lc3RhbXAudG9EYXRlID8gZS50aW1lc3RhbXAudG9EYXRlKCkgOiBudWxsO1xuICAgIHJldHVybiB7XG4gICAgICBGZWNoYV9Ib3JhOiB0cyA/IHRzLnRvSVNPU3RyaW5nKCkucmVwbGFjZSgnVCcsICcgJykuc2xpY2UoMCwgMTkpIDogJycsXG4gICAgICBVc3VhcmlvX0VtYWlsOiBlLnVzZXJFbWFpbCB8fCAnJyxcbiAgICAgIFVzdWFyaW9fVUlEOiBlLnVzZXJVaWQgfHwgJycsXG4gICAgICBSb2w6IGUudXNlclJvbGUgfHwgJycsXG4gICAgICBBY2Npb246IEFVRElUX0FDVElPTl9MQUJFTFNbZS5hY3Rpb25dIHx8IGUuYWN0aW9uIHx8ICcnLFxuICAgICAgQWNjaW9uX1JhdzogZS5hY3Rpb24gfHwgJycsXG4gICAgICBUaXBvX0VudGlkYWQ6IGUuZW50aXR5VHlwZSB8fCAnJyxcbiAgICAgIEVudGlkYWQ6IGUuZW50aXR5TmFtZSB8fCAnJyxcbiAgICAgIERldGFsbGVzX0pTT046IGUuZGV0YWlscyA/IEpTT04uc3RyaW5naWZ5KGUuZGV0YWlscykgOiAnJyxcbiAgICB9O1xuICB9KTtcbiAgY29uc3Qgd2IgPSBYTFNYLnV0aWxzLmJvb2tfbmV3KCk7XG4gIGNvbnN0IHdzID0gWExTWC51dGlscy5qc29uX3RvX3NoZWV0KHJvd3MpO1xuICB3c1snIWNvbHMnXSA9IFtcbiAgICB7IHdjaDogMjAgfSxcbiAgICB7IHdjaDogMzAgfSxcbiAgICB7IHdjaDogMzAgfSxcbiAgICB7IHdjaDogMTAgfSxcbiAgICB7IHdjaDogMjQgfSxcbiAgICB7IHdjaDogMjAgfSxcbiAgICB7IHdjaDogMTQgfSxcbiAgICB7IHdjaDogNDAgfSxcbiAgICB7IHdjaDogNjAgfSxcbiAgXTtcbiAgWExTWC51dGlscy5ib29rX2FwcGVuZF9zaGVldCh3Yiwgd3MsICdBdWRpdG9yaWEnKTtcbiAgY29uc3Qgc3RhbXAgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwgMTApO1xuICBYTFNYLndyaXRlRmlsZSh3YiwgJ1NoaW1hbm9fQXVkaXRvcmlhXycgKyBzdGFtcCArICcueGxzeCcpO1xufTtcblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIFNFQ0NJXHUwMEQzTjogYnVpbGRDb250YWN0YWRvc1Jvd3MvT3BzTG9nL1Zpc2l0IChpbmxpbmUgTDEwMDgxLTEwMTU1KVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbi8vIExpc3RhIGNvbXBsZXRhIGRlIGNvbnRhY3RhZG9zIChjbGllbnRlcy9wcm9zcGVjdG9zIG1hcmNhZG9zIGNvbiBjaGVjaylcbmZ1bmN0aW9uIGJ1aWxkQ29udGFjdGFkb3NSb3dzKCkge1xuICBjb25zdCByb3dzID0gW107XG4gIGNvbnRhY3RlZC5mb3JFYWNoKChrZXkpID0+IHtcbiAgICBjb25zdCBwYXJ0cyA9IGtleS5zcGxpdCgnfCcpO1xuICAgIGNvbnN0IHRpcG8gPSBwYXJ0c1swXSxcbiAgICAgIHByb3ZpbmNlID0gcGFydHNbMV0sXG4gICAgICBsb2NOYW1lID0gcGFydHNbMl0sXG4gICAgICBjbGllbnROYW1lID0gcGFydHNbM107XG4gICAgY29uc3QgcHQgPSBQT0lOVFMuZmluZCgocCkgPT4gcC5wcm92aW5jZSA9PT0gcHJvdmluY2UgJiYgcC5uYW1lID09PSBsb2NOYW1lKTtcbiAgICBjb25zdCB2ZW5kb3IgPSBwdCA/IHB0LnZlbmRvciA6ICcnO1xuICAgIGNvbnN0IHZtID0gdmVuZG9yTG9va3VwW3ZlbmRvcl07XG4gICAgcm93cy5wdXNoKHtcbiAgICAgIFRpcG86IHRpcG8gPT09ICdDJyA/ICdDbGllbnRlIGFjdHVhbCcgOiAnUHJvc3BlY3RvJyxcbiAgICAgIENsaWVudGU6IGNsaWVudE5hbWUsXG4gICAgICBQcm92aW5jaWE6IHRpdGxlQ2FzZShwcm92aW5jZSksXG4gICAgICBMb2NhbGlkYWQ6IGxvY05hbWUsXG4gICAgICBEZXBhcnRhbWVudG86IHB0ID8gcHQuZGVwdCB8fCAnJyA6ICcnLFxuICAgICAgVmVuZGVkb3I6IHRpdGxlQ2FzZSh2ZW5kb3IgfHwgJycpLFxuICAgICAgWm9uYTogdm0gPyB2bS56b25lIDogJycsXG4gICAgICBDb250YWN0YWRvOiAnU2knLFxuICAgIH0pO1xuICB9KTtcbiAgcm93cy5zb3J0KFxuICAgIChhLCBiKSA9PlxuICAgICAgYS5WZW5kZWRvci5sb2NhbGVDb21wYXJlKGIuVmVuZGVkb3IpIHx8XG4gICAgICBhLlByb3ZpbmNpYS5sb2NhbGVDb21wYXJlKGIuUHJvdmluY2lhKSB8fFxuICAgICAgYS5DbGllbnRlLmxvY2FsZUNvbXBhcmUoYi5DbGllbnRlKVxuICApO1xuICByZXR1cm4gcm93cztcbn1cblxuLy8gTG9nIGRlIG9wZXJhY2lvbmVzIChjYW5jZWxhY2lvbmVzLCBlbGltaW5hY2lvbmVzLCB2dWVsdmUtYS1ib3JyYWRvciwgZXRjLilcbmZ1bmN0aW9uIGJ1aWxkT3BzTG9nUm93cygpIHtcbiAgcmV0dXJuIChvcHNMb2dDYWNoZSB8fCBbXSkubWFwKChvKSA9PiAoe1xuICAgIEZlY2hhOiBvLnRpbWVzdGFtcFxuICAgICAgPyBvLnRpbWVzdGFtcC50b0RhdGVcbiAgICAgICAgPyBvLnRpbWVzdGFtcC50b0RhdGUoKS50b0xvY2FsZVN0cmluZygpXG4gICAgICAgIDogbmV3IERhdGUoby50aW1lc3RhbXApLnRvTG9jYWxlU3RyaW5nKClcbiAgICAgIDogJycsXG4gICAgVXN1YXJpbzogby51c2VyRW1haWwgfHwgJycsXG4gICAgUm9sOiBvLnVzZXJSb2xlIHx8ICcnLFxuICAgIEFjY2lvbjogby5hY3Rpb24gfHwgJycsXG4gICAgJ1RpcG8gZW50aWRhZCc6IG8uZW50aXR5VHlwZSB8fCAnJyxcbiAgICBFbnRpZGFkOiBvLmVudGl0eU5hbWUgfHwgJycsXG4gICAgRGV0YWxsZXM6IHR5cGVvZiBvLmRldGFpbHMgPT09ICdvYmplY3QnID8gSlNPTi5zdHJpbmdpZnkoby5kZXRhaWxzKSA6IG8uZGV0YWlscyB8fCAnJyxcbiAgfSkpO1xufVxuXG5mdW5jdGlvbiBidWlsZFZpc2l0Um93cygpIHtcbiAgcmV0dXJuIHZpc2l0c0NhY2hlLm1hcCgodikgPT4gKHtcbiAgICBGZWNoYTogdi5mZWNoYSB8fCAnJyxcbiAgICBNZXM6IHYubWVzIHx8ICcnLFxuICAgIEFubzogdi5hbmlvIHx8ICcnLFxuICAgIFZlbmRlZG9yOiB0aXRsZUNhc2Uodi52ZW5kb3IgfHwgJycpLFxuICAgICdUaXBvIGNvbnRhY3RvJzogdi50aXBvQ29udGFjdG8gPT09ICd0ZWxlZm9ubycgPyAnVGVsZWZvbm8nIDogJ1ByZXNlbmNpYWwnLFxuICAgIENvbWVudGFyaW86IHYuY29tZW50YXJpbyB8fCAnJyxcbiAgICBQcm92aW5jaWE6IHRpdGxlQ2FzZSh2LnByb3ZpbmNpYSB8fCAnJyksXG4gICAgTG9jYWxpZGFkOiB2LmxvY2FsaWRhZCB8fCAnJyxcbiAgICBUaWVuZGE6IHYudGllbmRhIHx8ICcnLFxuICAgICdUaXBvIHRpZW5kYSc6IHYudGlwbyB8fCAnJyxcbiAgICBMb2NhbDogdi5sb2NhbCB8fCAnJyxcbiAgICBUYW1hbm86IHYudGFtYW5vIHx8ICcnLFxuICAgIEZpZGVsaWRhZDogdi5maWRlbGlkYWQgfHwgJycsXG4gICAgJ1JlbGV2YW5jaWEgKDEtNSknOiB2LnJlbGV2YW5jaWEgfHwgJycsXG4gICAgUE9QOiB2LnBvcCB8fCAnJyxcbiAgICAnTmVjZXNpZGFkIHB1bnR1YWwnOiB2Lm5lY2VzaWRhZFB1bnR1YWwgPT09ICdNT1NUUkFETycgPyAnTU9TVFJBRE9SJyA6IHYubmVjZXNpZGFkUHVudHVhbCB8fCAnJyxcbiAgICAnVGlwbyB2ZW50YSc6IHYudGlwb1ZlbnRhID09PSAnTU9TVFJBRE8nID8gJ01PU1RSQURPUicgOiB2LnRpcG9WZW50YSB8fCAnJyxcbiAgICAnJSBNb3N0cmFkb3InOiB2LnBvbmRlcmFjaW9uTW9zdHJhZG8gIT0gbnVsbCA/IHYucG9uZGVyYWNpb25Nb3N0cmFkbyA6ICcnLFxuICAgICclIEVjb21tZXJjZSc6IHYucG9uZGVyYWNpb25FY29tbWVyY2UgIT0gbnVsbCA/IHYucG9uZGVyYWNpb25FY29tbWVyY2UgOiAnJyxcbiAgICBDb21wZXRlbmNpYTogdi5jb21wZXRlbmNpYSB8fCAnJyxcbiAgICAnQ2F0ZWdvcmlhIGNsaWVudGUnOiB2LmNhdGVnb3JpYUNsaWVudGUgfHwgJycsXG4gICAgT3BvcnR1bmlkYWQ6IHYub3BvcnR1bmlkYWQgfHwgJycsXG4gICAgJ0xvIG1hcyB2ZW5kaWRvIFNoaW1hbm8nOiB2Lm1hc1ZlbmRpZG8gfHwgJycsXG4gICAgJ0xvIHF1ZSBtYXMgcHJlZ3VudGFuJzogdi5tYXNQcmVndW50YW4gfHwgJycsXG4gICAgJ0F5dWRhIGEgdGllbmRhJzogdi5heXVkYVRpZW5kYSB8fCAnJyxcbiAgICAnRm90b3MgZXNwYWNpbyAoY2FudCknOiAodi5lc3BhY2lvIHx8IFtdKS5sZW5ndGgsXG4gICAgJ0ZvdG8gZnJlbnRlJzogdi5mcmVudGVMb2NhbCA/ICdTaScgOiAnTm8nLFxuICAgICdHUFMgZXN0YWRvJzogdi5ncHNTdGF0dXMgfHwgJycsXG4gICAgJ0dQUyBkaXN0YW5jaWEgKG0pJzogdHlwZW9mIHYuZ3BzRGlzdGFuY2VNID09PSAnbnVtYmVyJyA/IHYuZ3BzRGlzdGFuY2VNIDogJycsXG4gICAgJ0dQUyBsYXQnOiB2Lmdwc0xhdCAhPSBudWxsID8gdi5ncHNMYXQgOiAnJyxcbiAgICAnR1BTIGxvbic6IHYuZ3BzTG9uICE9IG51bGwgPyB2Lmdwc0xvbiA6ICcnLFxuICAgICdHUFMgcHJlY2lzaW9uIChtKSc6IHYuZ3BzQWNjdXJhY3kgIT0gbnVsbCA/IHYuZ3BzQWNjdXJhY3kgOiAnJyxcbiAgICAnR1BTIGNhcHR1cmFkbyc6IHYuZ3BzQ2FwdHVyZWRBdCB8fCAnJyxcbiAgICBFbWFpbDogdi5vd25lckVtYWlsIHx8ICcnLFxuICB9KSk7XG59XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBTRUNDSVx1MDBEM046IGV4cG9ydEV4ZWN1dGl2ZS9WaXNpdHMvUG93ZXJCSS9NTCAoaW5saW5lIEwxMDE1OC0xMDQyNilcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG53aW5kb3cuZXhwb3J0RXhlY3V0aXZlID0gZnVuY3Rpb24gKCkge1xuICBjb25zdCB3YiA9IFhMU1gudXRpbHMuYm9va19uZXcoKTtcbiAgY29uc3Qgcm93cyA9IGJ1aWxkUGVkaWRvRGV0YWlsUm93cygpO1xuICBjb25zdCBjb25mUm93cyA9IHJvd3MuZmlsdGVyKChyKSA9PiByLmVzdGFkbyA9PT0gJ0NvbmZpcm1hZG8nKTtcblxuICAvLyBDb25zb2xpZGFkbzogdW5hIGZpbGEgcG9yIHZlbmRlZG9yIGNvbiBLUElzXG4gIGNvbnN0IHBlclZlbmRvciA9IHt9O1xuICBjb25mUm93cy5mb3JFYWNoKChyKSA9PiB7XG4gICAgY29uc3QgayA9IHIudmVuZGVkb3IgfHwgJ1NpbiBhc2lnbmFyJztcbiAgICBpZiAoIXBlclZlbmRvcltrXSlcbiAgICAgIHBlclZlbmRvcltrXSA9IHtcbiAgICAgICAgem9uYTogci56b25hLFxuICAgICAgICB1bmlkOiAwLFxuICAgICAgICBhcnM6IDAsXG4gICAgICAgIHVzZDogMCxcbiAgICAgICAgY2xpZW50ZXM6IG5ldyBTZXQoKSxcbiAgICAgICAgcHJvZHM6IG5ldyBTZXQoKSxcbiAgICAgICAgcHJvdnM6IG5ldyBTZXQoKSxcbiAgICAgIH07XG4gICAgcGVyVmVuZG9yW2tdLnVuaWQgKz0gci5jYW50aWRhZDtcbiAgICBwZXJWZW5kb3Jba10uYXJzICs9IHIuc3VidG90YWxfYXJzO1xuICAgIHBlclZlbmRvcltrXS51c2QgKz0gci5zdWJ0b3RhbF91c2Q7XG4gICAgcGVyVmVuZG9yW2tdLmNsaWVudGVzLmFkZChyLmNsaWVudGUpO1xuICAgIHBlclZlbmRvcltrXS5wcm9kcy5hZGQoci5jb2RpZ28pO1xuICAgIHBlclZlbmRvcltrXS5wcm92cy5hZGQoci5wcm92aW5jaWEpO1xuICB9KTtcbiAgY29uc3QgY29uc29sID0gW107XG4gIFZFTkRPUlMuZm9yRWFjaCgodikgPT4ge1xuICAgIGNvbnN0IHRpdGxlViA9IHRpdGxlQ2FzZSh2LmtleSk7XG4gICAgY29uc3QgZCA9IHBlclZlbmRvclt0aXRsZVZdIHx8IHtcbiAgICAgIHpvbmE6IHYuem9uZSxcbiAgICAgIHVuaWQ6IDAsXG4gICAgICBhcnM6IDAsXG4gICAgICB1c2Q6IDAsXG4gICAgICBjbGllbnRlczogbmV3IFNldCgpLFxuICAgICAgcHJvZHM6IG5ldyBTZXQoKSxcbiAgICAgIHByb3ZzOiBuZXcgU2V0KCksXG4gICAgfTtcbiAgICBjb25zdCB0ID0gVEFSR0VUU19CWV9WRU5ET1Jbdi5rZXldIHx8IHsganVsMjAyNl91c2Q6IDAsIGp1bERpYzIwMjZfdXNkOiAwLCBhbnVhbDIwMjdfdXNkOiAwIH07XG4gICAgY29uc29sLnB1c2goe1xuICAgICAgWm9uYTogdi56b25lLFxuICAgICAgVmVuZGVkb3I6IHRpdGxlVixcbiAgICAgIFByb3ZpbmNpYXM6IGQucHJvdnMuc2l6ZSxcbiAgICAgICdDbGllbnRlcyBhY3Rpdm9zJzogZC5jbGllbnRlcy5zaXplLFxuICAgICAgJ1Byb2R1Y3RvcyBkaXN0aW50b3MnOiBkLnByb2RzLnNpemUsXG4gICAgICBVbmlkYWRlczogZC51bmlkLFxuICAgICAgJ0ZhY3R1cmFkbyBBUlMnOiBNYXRoLnJvdW5kKGQuYXJzKSxcbiAgICAgICdGYWN0dXJhZG8gVVNEJzogTWF0aC5yb3VuZChkLnVzZCksXG4gICAgICAnVGFyZ2V0IEp1bCAyMDI2IFVTRCc6IHQuanVsMjAyNl91c2QsXG4gICAgICAnVGFyZ2V0IEp1bC1EaWMgMjAyNiBVU0QnOiB0Lmp1bERpYzIwMjZfdXNkLFxuICAgICAgJ1RhcmdldCAyMDI3IFVTRCc6IHQuYW51YWwyMDI3X3VzZCxcbiAgICB9KTtcbiAgfSk7XG4gIGNvbnN0IHdzQyA9IFhMU1gudXRpbHMuanNvbl90b19zaGVldChjb25zb2wpO1xuICB3c0NbJyFjb2xzJ10gPSBbXG4gICAgeyB3Y2g6IDYgfSxcbiAgICB7IHdjaDogMjQgfSxcbiAgICB7IHdjaDogMTEgfSxcbiAgICB7IHdjaDogMTQgfSxcbiAgICB7IHdjaDogMTYgfSxcbiAgICB7IHdjaDogMTEgfSxcbiAgICB7IHdjaDogMTYgfSxcbiAgICB7IHdjaDogMTYgfSxcbiAgICB7IHdjaDogMTggfSxcbiAgICB7IHdjaDogMjAgfSxcbiAgICB7IHdjaDogMTggfSxcbiAgXTtcbiAgWExTWC51dGlscy5ib29rX2FwcGVuZF9zaGVldCh3Yiwgd3NDLCAnQ29uc29saWRhZG8nKTtcblxuICAvLyBVbmEgaG9qYSBwb3IgdmVuZGVkb3IgY29uIHN1IGRldGFsbGUgZGUgcGVkaWRvcyBjb25maXJtYWRvc1xuICBWRU5ET1JTLmZvckVhY2goKHYpID0+IHtcbiAgICBjb25zdCB0aXRsZVYgPSB0aXRsZUNhc2Uodi5rZXkpO1xuICAgIGNvbnN0IHZyb3dzID0gY29uZlJvd3NcbiAgICAgIC5maWx0ZXIoKHIpID0+IHIudmVuZGVkb3IgPT09IHRpdGxlVilcbiAgICAgIC5tYXAoKHIpID0+ICh7XG4gICAgICAgIEZlY2hhOiByLmZlY2hhLFxuICAgICAgICBNZXM6IHIubWVzX3BlZGlkbyxcbiAgICAgICAgUHJvdmluY2lhOiByLnByb3ZpbmNpYSxcbiAgICAgICAgTG9jYWxpZGFkOiByLmxvY2FsaWRhZCxcbiAgICAgICAgQ2xpZW50ZTogci5jbGllbnRlLFxuICAgICAgICBUaXBvOiByLnRpcG9fY2xpZW50ZSxcbiAgICAgICAgQ29kaWdvOiByLmNvZGlnbyxcbiAgICAgICAgUHJvZHVjdG86IHIucHJvZHVjdG8sXG4gICAgICAgIENhdGVnb3JpYTogci5jYXRlZ29yaWEsXG4gICAgICAgIEZhbWlsaWE6IHIuZmFtaWxpYSxcbiAgICAgICAgU3ViZmFtaWxpYTogci5zdWJmYW1pbGlhLFxuICAgICAgICBDYW50aWRhZDogci5jYW50aWRhZCxcbiAgICAgICAgJ1ByZWNpbyBBUlMnOiByLnByZWNpb191bml0X2FycyxcbiAgICAgICAgJ1N1YnRvdGFsIEFSUyc6IHIuc3VidG90YWxfYXJzLFxuICAgICAgICAnU3VidG90YWwgVVNEJzogci5zdWJ0b3RhbF91c2QsXG4gICAgICB9KSk7XG4gICAgdnJvd3Muc29ydChcbiAgICAgIChhLCBiKSA9PiAoYS5GZWNoYSB8fCAnJykubG9jYWxlQ29tcGFyZShiLkZlY2hhIHx8ICcnKSB8fCBhLkNsaWVudGUubG9jYWxlQ29tcGFyZShiLkNsaWVudGUpXG4gICAgKTtcbiAgICBpZiAoIXZyb3dzLmxlbmd0aClcbiAgICAgIHZyb3dzLnB1c2goe1xuICAgICAgICBGZWNoYTogJycsXG4gICAgICAgIE1lczogJycsXG4gICAgICAgIFByb3ZpbmNpYTogJycsXG4gICAgICAgIExvY2FsaWRhZDogJycsXG4gICAgICAgIENsaWVudGU6ICcoc2luIHBlZGlkb3MgY29uZmlybWFkb3MpJyxcbiAgICAgICAgVGlwbzogJycsXG4gICAgICAgIENvZGlnbzogJycsXG4gICAgICAgIFByb2R1Y3RvOiAnJyxcbiAgICAgICAgQ2F0ZWdvcmlhOiAnJyxcbiAgICAgICAgRmFtaWxpYTogJycsXG4gICAgICAgIFN1YmZhbWlsaWE6ICcnLFxuICAgICAgICBDYW50aWRhZDogMCxcbiAgICAgICAgJ1ByZWNpbyBBUlMnOiAwLFxuICAgICAgICAnU3VidG90YWwgQVJTJzogMCxcbiAgICAgICAgJ1N1YnRvdGFsIFVTRCc6IDAsXG4gICAgICB9KTtcbiAgICBjb25zdCB3cyA9IFhMU1gudXRpbHMuanNvbl90b19zaGVldCh2cm93cyk7XG4gICAgd3NbJyFjb2xzJ10gPSBbXG4gICAgICB7IHdjaDogMTEgfSxcbiAgICAgIHsgd2NoOiAxNCB9LFxuICAgICAgeyB3Y2g6IDE4IH0sXG4gICAgICB7IHdjaDogMjIgfSxcbiAgICAgIHsgd2NoOiAzMCB9LFxuICAgICAgeyB3Y2g6IDExIH0sXG4gICAgICB7IHdjaDogMTQgfSxcbiAgICAgIHsgd2NoOiAzOCB9LFxuICAgICAgeyB3Y2g6IDE0IH0sXG4gICAgICB7IHdjaDogMTggfSxcbiAgICAgIHsgd2NoOiAxOCB9LFxuICAgICAgeyB3Y2g6IDEwIH0sXG4gICAgICB7IHdjaDogMTIgfSxcbiAgICAgIHsgd2NoOiAxNCB9LFxuICAgICAgeyB3Y2g6IDE0IH0sXG4gICAgXTtcbiAgICBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KFxuICAgICAgd2IsXG4gICAgICB3cyxcbiAgICAgICh2LnpvbmUgKyAnICcgKyB0aXRsZVYpLnN1YnN0cmluZygwLCAzMSkucmVwbGFjZSgvW1xcXFwvKj9bXFxdOl0vZywgJycpXG4gICAgKTtcbiAgfSk7XG5cbiAgLy8gVmlzaXRhc1xuICBjb25zdCB2aXNpdFJvd3MgPSBidWlsZFZpc2l0Um93cygpO1xuICBpZiAodmlzaXRSb3dzLmxlbmd0aCkge1xuICAgIGNvbnN0IHdzViA9IFhMU1gudXRpbHMuanNvbl90b19zaGVldCh2aXNpdFJvd3MpO1xuICAgIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQod2IsIHdzViwgJ1Zpc2l0YXMnKTtcbiAgfVxuICAvLyBDb250YWN0YWRvcyAodG9kb3MgbG9zIGNsaWVudGVzL3Byb3NwZWN0b3MgbWFyY2Fkb3MgY29uIGNoZWNrKVxuICBjb25zdCBjb250YWN0Um93cyA9IGJ1aWxkQ29udGFjdGFkb3NSb3dzKCk7XG4gIGlmIChjb250YWN0Um93cy5sZW5ndGgpIHtcbiAgICBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KHdiLCBYTFNYLnV0aWxzLmpzb25fdG9fc2hlZXQoY29udGFjdFJvd3MpLCAnQ29udGFjdGFkb3MnKTtcbiAgfVxuICAvLyBMb2cgZGUgb3BlcmFjaW9uZXMgKGNhbmNlbGFjaW9uZXMsIGVsaW1pbmFjaW9uZXMsIGV0Yy4pXG4gIGNvbnN0IG9wc1Jvd3MgPSBidWlsZE9wc0xvZ1Jvd3MoKTtcbiAgaWYgKG9wc1Jvd3MubGVuZ3RoKSB7XG4gICAgWExTWC51dGlscy5ib29rX2FwcGVuZF9zaGVldCh3YiwgWExTWC51dGlscy5qc29uX3RvX3NoZWV0KG9wc1Jvd3MpLCAnTG9nIE9wZXJhY2lvbmVzJyk7XG4gIH1cblxuICBYTFNYLndyaXRlRmlsZSh3YiwgJ1NoaW1hbm9fRWplY3V0aXZvXycgKyB0b2RheVN0cigpICsgJy54bHN4Jyk7XG59O1xuXG4vLyAtLS0tLS0tLS0tIEV4Y2VsIGRlIFZpc2l0YXMgKGZvcm1hdG8gc3RhbmRhbG9uZSkgLS0tLS0tLS0tLVxud2luZG93LmV4cG9ydFZpc2l0c0V4Y2VsID0gZnVuY3Rpb24gKCkge1xuICBpZiAodHlwZW9mIFhMU1ggPT09ICd1bmRlZmluZWQnKSB7XG4gICAgYWxlcnQoJ0xhIGxpYnJlcmlhIGRlIEV4Y2VsIG5vIHNlIGNhcmdvLiBWZXJpZmlxdWUgc3UgY29uZXhpb24gYSBpbnRlcm5ldCB5IHJlaW50ZW50ZS4nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgY29uc3QgdmlzaXRSb3dzID0gYnVpbGRWaXNpdFJvd3MoKTtcbiAgaWYgKCF2aXNpdFJvd3MubGVuZ3RoKSB7XG4gICAgYWxlcnQoXG4gICAgICAnTm8gaGF5IHZpc2l0YXMgcmVnaXN0cmFkYXMgdG9kYXZpYS4gQ3VhbmRvIHNlIGNhcmd1ZSBhbCBtZW5vcyB1bmEsIHZhcyBhIHBvZGVyIGV4cG9ydGFybGEuJ1xuICAgICk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGNvbnN0IHdiID0gWExTWC51dGlscy5ib29rX25ldygpO1xuXG4gIC8vIEhvamEgcHJpbmNpcGFsOiBWaXNpdGFzICh0b2RhcyBsYXMgZmlsYXMpXG4gIGNvbnN0IHdzID0gWExTWC51dGlscy5qc29uX3RvX3NoZWV0KHZpc2l0Um93cyk7XG4gIHdzWychY29scyddID0gW1xuICAgIHsgd2NoOiAxMiB9LFxuICAgIHsgd2NoOiAxNCB9LFxuICAgIHsgd2NoOiA4IH0sXG4gICAgeyB3Y2g6IDI0IH0sXG4gICAgeyB3Y2g6IDE4IH0sXG4gICAgeyB3Y2g6IDIyIH0sXG4gICAgeyB3Y2g6IDMwIH0sXG4gICAgeyB3Y2g6IDE4IH0sXG4gICAgeyB3Y2g6IDE0IH0sXG4gICAgeyB3Y2g6IDE0IH0sXG4gICAgeyB3Y2g6IDE0IH0sXG4gICAgeyB3Y2g6IDE2IH0sXG4gICAgeyB3Y2g6IDggfSxcbiAgICB7IHdjaDogMjIgfSxcbiAgICB7IHdjaDogMTQgfSxcbiAgICB7IHdjaDogMTQgfSxcbiAgICB7IHdjaDogMTQgfSxcbiAgICB7IHdjaDogMTggfSxcbiAgICB7IHdjaDogMTggfSxcbiAgICB7IHdjaDogMzIgfSxcbiAgICB7IHdjaDogMzIgfSxcbiAgICB7IHdjaDogMzIgfSxcbiAgICB7IHdjaDogMzIgfSxcbiAgICB7IHdjaDogMTggfSxcbiAgICB7IHdjaDogMTQgfSxcbiAgICB7IHdjaDogMjQgfSxcbiAgXTtcbiAgWExTWC51dGlscy5ib29rX2FwcGVuZF9zaGVldCh3Yiwgd3MsICdWaXNpdGFzJyk7XG5cbiAgLy8gSG9qYSByZXN1bWVuIHBvciB2ZW5kZWRvcjogY2FudGlkYWQgZGUgdmlzaXRhcyB5IHRpZW5kYXMgdW5pY2FzXG4gIGNvbnN0IHBlclZlbmRvciA9IHt9O1xuICB2aXNpdHNDYWNoZS5mb3JFYWNoKCh2KSA9PiB7XG4gICAgY29uc3QgayA9IHRpdGxlQ2FzZSh2LnZlbmRvciB8fCAnU2luIGFzaWduYXInKTtcbiAgICBpZiAoIXBlclZlbmRvcltrXSlcbiAgICAgIHBlclZlbmRvcltrXSA9IHtcbiAgICAgICAgdmlzaXRhczogMCxcbiAgICAgICAgdGllbmRhczogbmV3IFNldCgpLFxuICAgICAgICBsb2NhbGlkYWRlczogbmV3IFNldCgpLFxuICAgICAgICBwcm92aW5jaWFzOiBuZXcgU2V0KCksXG4gICAgICB9O1xuICAgIHBlclZlbmRvcltrXS52aXNpdGFzKys7XG4gICAgaWYgKHYudGllbmRhKSBwZXJWZW5kb3Jba10udGllbmRhcy5hZGQodi50aWVuZGEpO1xuICAgIGlmICh2LmxvY2FsaWRhZCkgcGVyVmVuZG9yW2tdLmxvY2FsaWRhZGVzLmFkZCh2LmxvY2FsaWRhZCk7XG4gICAgaWYgKHYucHJvdmluY2lhKSBwZXJWZW5kb3Jba10ucHJvdmluY2lhcy5hZGQodi5wcm92aW5jaWEpO1xuICB9KTtcbiAgY29uc3QgcmVzdW1lbiA9IE9iamVjdC5lbnRyaWVzKHBlclZlbmRvcilcbiAgICAubWFwKChbdmVuZGVkb3IsIGRdKSA9PiAoe1xuICAgICAgVmVuZGVkb3I6IHZlbmRlZG9yLFxuICAgICAgJ1Zpc2l0YXMgdG90YWxlcyc6IGQudmlzaXRhcyxcbiAgICAgICdUaWVuZGFzIGRpc3RpbnRhcyc6IGQudGllbmRhcy5zaXplLFxuICAgICAgJ0xvY2FsaWRhZGVzIGRpc3RpbnRhcyc6IGQubG9jYWxpZGFkZXMuc2l6ZSxcbiAgICAgICdQcm92aW5jaWFzIGRpc3RpbnRhcyc6IGQucHJvdmluY2lhcy5zaXplLFxuICAgIH0pKVxuICAgIC5zb3J0KChhLCBiKSA9PiBiWydWaXNpdGFzIHRvdGFsZXMnXSAtIGFbJ1Zpc2l0YXMgdG90YWxlcyddKTtcbiAgaWYgKHJlc3VtZW4ubGVuZ3RoKSB7XG4gICAgY29uc3Qgd3NSID0gWExTWC51dGlscy5qc29uX3RvX3NoZWV0KHJlc3VtZW4pO1xuICAgIHdzUlsnIWNvbHMnXSA9IFt7IHdjaDogMjQgfSwgeyB3Y2g6IDE2IH0sIHsgd2NoOiAxOCB9LCB7IHdjaDogMjIgfSwgeyB3Y2g6IDIyIH1dO1xuICAgIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQod2IsIHdzUiwgJ1Jlc3VtZW4gcG9yIHZlbmRlZG9yJyk7XG4gIH1cblxuICBYTFNYLndyaXRlRmlsZSh3YiwgJ1NoaW1hbm9fVmlzaXRhc18nICsgdG9kYXlTdHIoKSArICcueGxzeCcpO1xufTtcblxuLy8gLS0tLS0tLS0tLSBPUENJT04gQjogUG93ZXIgQkkgKEZhY3QgKyBEaW0pIC0tLS0tLS0tLS1cbndpbmRvdy5leHBvcnRQb3dlckJJID0gZnVuY3Rpb24gKCkge1xuICBjb25zdCB3YiA9IFhMU1gudXRpbHMuYm9va19uZXcoKTtcbiAgY29uc3Qgcm93cyA9IGJ1aWxkUGVkaWRvRGV0YWlsUm93cygpO1xuXG4gIC8vIEZhY3RfUGVkaWRvc1xuICBjb25zdCBmYWN0Um93cyA9IHJvd3MuZmlsdGVyKChyKSA9PiByLmVzdGFkbyAhPT0gJ0JvcnJhZG9yJyk7XG4gIGNvbnN0IHdzRiA9IFhMU1gudXRpbHMuanNvbl90b19zaGVldChcbiAgICBmYWN0Um93cy5tYXAoKHIpID0+ICh7XG4gICAgICBsaW5lX2lkOiByLmxpbmVfaWQsXG4gICAgICBmZWNoYTogci5mZWNoYSxcbiAgICAgIGVzdGFkbzogci5lc3RhZG8sXG4gICAgICB2ZW5kZWRvcl9rZXk6IHIudmVuZGVkb3Jfa2V5LFxuICAgICAgem9uYTogci56b25hLFxuICAgICAgcHJvdmluY2lhOiByLnByb3ZpbmNpYSxcbiAgICAgIGxvY2FsaWRhZDogci5sb2NhbGlkYWQsXG4gICAgICBjbGllbnRlOiByLmNsaWVudGUsXG4gICAgICB0aXBvX2NsaWVudGU6IHIudGlwb19jbGllbnRlLFxuICAgICAgc2t1OiByLmNvZGlnbyxcbiAgICAgIGNhbnRpZGFkOiByLmNhbnRpZGFkLFxuICAgICAgcHJlY2lvX3VuaXRfYXJzOiByLnByZWNpb191bml0X2FycyxcbiAgICAgIHN1YnRvdGFsX2Fyczogci5zdWJ0b3RhbF9hcnMsXG4gICAgICBzdWJ0b3RhbF91c2Q6IHIuc3VidG90YWxfdXNkLFxuICAgIH0pKVxuICApO1xuICBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KHdiLCB3c0YsICdGYWN0X1BlZGlkb3MnKTtcblxuICAvLyBEaW1fVmVuZGVkb3JcbiAgY29uc3QgZGltViA9IFZFTkRPUlMubWFwKCh2KSA9PiB7XG4gICAgY29uc3QgdCA9IFRBUkdFVFNfQllfVkVORE9SW3Yua2V5XSB8fCB7fTtcbiAgICByZXR1cm4ge1xuICAgICAgdmVuZGVkb3Jfa2V5OiB2LmtleSxcbiAgICAgIHZlbmRlZG9yX25vbWJyZTogdGl0bGVDYXNlKHYua2V5KSxcbiAgICAgIHpvbmE6IHYuem9uZSxcbiAgICAgIHpvbmFfZGVzY3JpcGNpb246IHYubGFiZWwsXG4gICAgICBjb2xvcjogdi5jb2xvcixcbiAgICAgIHRhcmdldF9qdWwyMDI2X3VzZDogdC5qdWwyMDI2X3VzZCB8fCAwLFxuICAgICAgdGFyZ2V0X2p1bERpYzIwMjZfdXNkOiB0Lmp1bERpYzIwMjZfdXNkIHx8IDAsXG4gICAgICB0YXJnZXRfMjAyN191c2Q6IHQuYW51YWwyMDI3X3VzZCB8fCAwLFxuICAgIH07XG4gIH0pO1xuICBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KHdiLCBYTFNYLnV0aWxzLmpzb25fdG9fc2hlZXQoZGltViksICdEaW1fVmVuZGVkb3InKTtcblxuICAvLyBEaW1fUHJvZHVjdG9cbiAgY29uc3QgZGltUCA9IFBST0RVQ1RTLm1hcCgocCkgPT4gKHtcbiAgICBza3U6IHAuY29kZSxcbiAgICBkZXNjcmlwY2lvbjogcC5kZXNjLFxuICAgIGNhdGVnb3JpYTogcC5jYXQsXG4gICAgZmFtaWxpYTogcC5mYW0sXG4gICAgc3ViZmFtaWxpYTogcC5zdWIsXG4gIH0pKTtcbiAgWExTWC51dGlscy5ib29rX2FwcGVuZF9zaGVldCh3YiwgWExTWC51dGlscy5qc29uX3RvX3NoZWV0KGRpbVApLCAnRGltX1Byb2R1Y3RvJyk7XG5cbiAgLy8gRGltX0NsaWVudGUgKHVuaXZlcnNvKVxuICBjb25zdCBkaW1DID0gW107XG4gIFBPSU5UUy5mb3JFYWNoKChwKSA9PiB7XG4gICAgY29uc3Qgdm0gPSB2ZW5kb3JMb29rdXBbcC52ZW5kb3JdO1xuICAgIHAuY2xpZW50cy5mb3JFYWNoKChuKSA9PlxuICAgICAgZGltQy5wdXNoKHtcbiAgICAgICAgY2xpZW50ZTogbixcbiAgICAgICAgdGlwbzogJ0NsaWVudGUgYWN0dWFsJyxcbiAgICAgICAgcHJvdmluY2lhOiB0aXRsZUNhc2UocC5wcm92aW5jZSksXG4gICAgICAgIGxvY2FsaWRhZDogcC5uYW1lLFxuICAgICAgICBkZXBhcnRhbWVudG86IHAuZGVwdCB8fCAnJyxcbiAgICAgICAgdmVuZGVkb3Jfa2V5OiBwLnZlbmRvciB8fCAnJyxcbiAgICAgICAgem9uYTogdm0gPyB2bS56b25lIDogJycsXG4gICAgICB9KVxuICAgICk7XG4gICAgcC5wcm9zcGVjdHMuZm9yRWFjaCgobikgPT5cbiAgICAgIGRpbUMucHVzaCh7XG4gICAgICAgIGNsaWVudGU6IG4sXG4gICAgICAgIHRpcG86ICdQcm9zcGVjdG8nLFxuICAgICAgICBwcm92aW5jaWE6IHRpdGxlQ2FzZShwLnByb3ZpbmNlKSxcbiAgICAgICAgbG9jYWxpZGFkOiBwLm5hbWUsXG4gICAgICAgIGRlcGFydGFtZW50bzogcC5kZXB0IHx8ICcnLFxuICAgICAgICB2ZW5kZWRvcl9rZXk6IHAudmVuZG9yIHx8ICcnLFxuICAgICAgICB6b25hOiB2bSA/IHZtLnpvbmUgOiAnJyxcbiAgICAgIH0pXG4gICAgKTtcbiAgfSk7XG4gIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQod2IsIFhMU1gudXRpbHMuanNvbl90b19zaGVldChkaW1DKSwgJ0RpbV9DbGllbnRlJyk7XG5cbiAgLy8gRGltX0NhbGVuZGFyaW8gKGZlY2hhcyBkaXN0aW50YXMgZW4gbG9zIHBlZGlkb3MgKyBzZXJpZSBjb250aW51YSBkZWwgYVx1MDBGMW8gYWN0dWFsKVxuICBjb25zdCBjYWxTZXQgPSBuZXcgU2V0KCk7XG4gIGZhY3RSb3dzLmZvckVhY2goKHIpID0+IHtcbiAgICBpZiAoci5mZWNoYSkgY2FsU2V0LmFkZChyLmZlY2hhKTtcbiAgfSk7XG4gIC8vIENvbXBsZXRhciBkZXNkZSAyMDI2LTAxLTAxIGhhc3RhIGhveSArIDM2NVxuICBjb25zdCBzdGFydCA9IG5ldyBEYXRlKCcyMDI2LTAxLTAxJyk7XG4gIGNvbnN0IGVuZCA9IG5ldyBEYXRlKCk7XG4gIGVuZC5zZXREYXRlKGVuZC5nZXREYXRlKCkgKyAzNjUpO1xuICBmb3IgKGxldCBkID0gbmV3IERhdGUoc3RhcnQpOyBkIDw9IGVuZDsgZC5zZXREYXRlKGQuZ2V0RGF0ZSgpICsgMSkpXG4gICAgY2FsU2V0LmFkZChkLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwgMTApKTtcbiAgY29uc3QgZGltQ2FsID0gWy4uLmNhbFNldF0uc29ydCgpLm1hcCgoZHQpID0+IHtcbiAgICBjb25zdCBbeSwgbSwgZGFdID0gZHQuc3BsaXQoJy0nKS5tYXAoKHgpID0+IHBhcnNlSW50KHgsIDEwKSk7XG4gICAgY29uc3QgZGF0ZU9iaiA9IG5ldyBEYXRlKHksIG0gLSAxLCBkYSk7XG4gICAgcmV0dXJuIHtcbiAgICAgIGZlY2hhOiBkdCxcbiAgICAgIHllYXI6IHksXG4gICAgICBtb250aDogbSxcbiAgICAgIGRheTogZGEsXG4gICAgICBxdWFydGVyOiAnUScgKyAoTWF0aC5mbG9vcigobSAtIDEpIC8gMykgKyAxKSxcbiAgICAgIG1vbnRoX25hbWU6IE1FU0VTW20gLSAxXSxcbiAgICAgIHllYXJfbW9udGg6IHkgKyAnLScgKyBTdHJpbmcobSkucGFkU3RhcnQoMiwgJzAnKSxcbiAgICAgIGRheV9vZl93ZWVrOiBbJ0RvbScsICdMdW4nLCAnTWFyJywgJ01pZScsICdKdWUnLCAnVmllJywgJ1NhYiddW2RhdGVPYmouZ2V0RGF5KCldLFxuICAgIH07XG4gIH0pO1xuICBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KHdiLCBYTFNYLnV0aWxzLmpzb25fdG9fc2hlZXQoZGltQ2FsKSwgJ0RpbV9DYWxlbmRhcmlvJyk7XG5cbiAgLy8gRGltX0NhbXBhbmlhXG4gIGNvbnN0IGRpbUNtcCA9IGNhbXBhaWduc0NhY2hlLm1hcCgoYykgPT4gKHtcbiAgICBjYW1wYW5pYV9pZDogYy5pZCxcbiAgICBub21icmU6IGMubmFtZSxcbiAgICBmaWx0ZXJfdHlwZTogYy5maWx0ZXJUeXBlLFxuICAgIGZpbHRlcl92YWx1ZXM6IChjLmZpbHRlclZhbHVlcyB8fCBbXSkuam9pbignLCAnKSxcbiAgICB0YXJnZXRfdHlwZTogYy50YXJnZXRUeXBlLFxuICAgIHRhcmdldF9hbW91bnQ6IGMudGFyZ2V0QW1vdW50LFxuICAgIGRlc2RlOiBjLnN0YXJ0RGF0ZSxcbiAgICBoYXN0YTogYy5lbmREYXRlLFxuICB9KSk7XG4gIGlmIChkaW1DbXAubGVuZ3RoKVxuICAgIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQod2IsIFhMU1gudXRpbHMuanNvbl90b19zaGVldChkaW1DbXApLCAnRGltX0NhbXBhbmlhJyk7XG5cbiAgLy8gUGFyYW1zICh0aXBvIGRlIGNhbWJpbywgZmVjaGEgZXhwb3J0LCB2ZXJzaW9uKVxuICBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KFxuICAgIHdiLFxuICAgIFhMU1gudXRpbHMuanNvbl90b19zaGVldChbXG4gICAgICB7IHBhcmFtZXRybzogJ2V4Y2hhbmdlX3JhdGVfYXJzX3VzZCcsIHZhbG9yOiBFWENIQU5HRV9SQVRFIH0sXG4gICAgICB7IHBhcmFtZXRybzogJ2ZlY2hhX2V4cG9ydCcsIHZhbG9yOiB0b2RheVN0cigpIH0sXG4gICAgICB7IHBhcmFtZXRybzogJ3RvdGFsX2ZpbGFzX2ZhY3QnLCB2YWxvcjogZmFjdFJvd3MubGVuZ3RoIH0sXG4gICAgXSksXG4gICAgJ1BhcmFtZXRyb3MnXG4gICk7XG5cbiAgLy8gRmFjdF9WaXNpdGFzXG4gIGNvbnN0IHZpc2l0Um93c0IgPSBidWlsZFZpc2l0Um93cygpO1xuICBpZiAodmlzaXRSb3dzQi5sZW5ndGgpXG4gICAgWExTWC51dGlscy5ib29rX2FwcGVuZF9zaGVldCh3YiwgWExTWC51dGlscy5qc29uX3RvX3NoZWV0KHZpc2l0Um93c0IpLCAnRmFjdF9WaXNpdGFzJyk7XG4gIC8vIENvbnRhY3RhZG9zXG4gIGNvbnN0IGNvbnRhY3RSb3dzQiA9IGJ1aWxkQ29udGFjdGFkb3NSb3dzKCk7XG4gIGlmIChjb250YWN0Um93c0IubGVuZ3RoKVxuICAgIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQod2IsIFhMU1gudXRpbHMuanNvbl90b19zaGVldChjb250YWN0Um93c0IpLCAnQ29udGFjdGFkb3MnKTtcbiAgLy8gTG9nIGRlIG9wZXJhY2lvbmVzXG4gIGNvbnN0IG9wc1Jvd3NCID0gYnVpbGRPcHNMb2dSb3dzKCk7XG4gIGlmIChvcHNSb3dzQi5sZW5ndGgpXG4gICAgWExTWC51dGlscy5ib29rX2FwcGVuZF9zaGVldCh3YiwgWExTWC51dGlscy5qc29uX3RvX3NoZWV0KG9wc1Jvd3NCKSwgJ0xvZ19PcGVyYWNpb25lcycpO1xuXG4gIFhMU1gud3JpdGVGaWxlKHdiLCAnU2hpbWFub19Qb3dlckJJXycgKyB0b2RheVN0cigpICsgJy54bHN4Jyk7XG59O1xuXG4vLyAtLS0tLS0tLS0tIE9QQ0lPTiBDOiBQeXRob24gLyBJQSAvIE1MIChzaW5nbGUgbG9uZy1mb3JtYXQgdGFibGUpIC0tLS0tLS0tLS1cbndpbmRvdy5leHBvcnRNTCA9IGZ1bmN0aW9uICgpIHtcbiAgY29uc3Qgd2IgPSBYTFNYLnV0aWxzLmJvb2tfbmV3KCk7XG4gIGNvbnN0IHJvd3MgPSBidWlsZFBlZGlkb0RldGFpbFJvd3MoKTtcbiAgLy8gbWFzdGVyX21sOiB1bmEgZmlsYSBwb3IgbGluZWEgY29uIFRPREFTIGxhcyBmZWF0dXJlc1xuICBjb25zdCB3cyA9IFhMU1gudXRpbHMuanNvbl90b19zaGVldChyb3dzKTtcbiAgd3NbJyFjb2xzJ10gPSBPYmplY3Qua2V5cyhyb3dzWzBdIHx8IHsgZmVjaGE6ICcnIH0pLm1hcCgoKSA9PiAoeyB3Y2g6IDE0IH0pKTtcbiAgWExTWC51dGlscy5ib29rX2FwcGVuZF9zaGVldCh3Yiwgd3MsICdtYXN0ZXJfbWwnKTtcblxuICAvLyBjYXRhbG9nbyB5IHVuaXZlcnNvIGRlIGNsaWVudGVzIGNvbW8gcmVmZXJlbmNpYXMgcGFyYSBlbnJpcXVlY2VyIGVuIHBhbmRhc1xuICBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KFxuICAgIHdiLFxuICAgIFhMU1gudXRpbHMuanNvbl90b19zaGVldChcbiAgICAgIFBST0RVQ1RTLm1hcCgocCkgPT4gKHsgY29kZTogcC5jb2RlLCBkZXNjOiBwLmRlc2MsIGNhdDogcC5jYXQsIGZhbTogcC5mYW0sIHN1YjogcC5zdWIgfSkpXG4gICAgKSxcbiAgICAncHJvZHVjdG9zX2NhdGFsb2dvJ1xuICApO1xuXG4gIGNvbnN0IHVuaXZlcnNlID0gW107XG4gIFBPSU5UUy5mb3JFYWNoKChwKSA9PiB7XG4gICAgY29uc3Qgdm0gPSB2ZW5kb3JMb29rdXBbcC52ZW5kb3JdO1xuICAgIHAuY2xpZW50cy5mb3JFYWNoKChuKSA9PlxuICAgICAgdW5pdmVyc2UucHVzaCh7XG4gICAgICAgIGNsaWVudGU6IG4sXG4gICAgICAgIHRpcG86ICdjbGllbnRlX2FjdHVhbCcsXG4gICAgICAgIHByb3ZpbmNpYTogdGl0bGVDYXNlKHAucHJvdmluY2UpLFxuICAgICAgICBsb2NhbGlkYWQ6IHAubmFtZSxcbiAgICAgICAgZGVwYXJ0YW1lbnRvOiBwLmRlcHQgfHwgJycsXG4gICAgICAgIHZlbmRlZG9yOiB0aXRsZUNhc2UocC52ZW5kb3IgfHwgJycpLFxuICAgICAgICB6b25hOiB2bSA/IHZtLnpvbmUgOiAnJyxcbiAgICAgICAgbGF0OiBwLmxhdCxcbiAgICAgICAgbG9uOiBwLmxvbixcbiAgICAgIH0pXG4gICAgKTtcbiAgICBwLnByb3NwZWN0cy5mb3JFYWNoKChuKSA9PlxuICAgICAgdW5pdmVyc2UucHVzaCh7XG4gICAgICAgIGNsaWVudGU6IG4sXG4gICAgICAgIHRpcG86ICdwcm9zcGVjdG8nLFxuICAgICAgICBwcm92aW5jaWE6IHRpdGxlQ2FzZShwLnByb3ZpbmNlKSxcbiAgICAgICAgbG9jYWxpZGFkOiBwLm5hbWUsXG4gICAgICAgIGRlcGFydGFtZW50bzogcC5kZXB0IHx8ICcnLFxuICAgICAgICB2ZW5kZWRvcjogdGl0bGVDYXNlKHAudmVuZG9yIHx8ICcnKSxcbiAgICAgICAgem9uYTogdm0gPyB2bS56b25lIDogJycsXG4gICAgICAgIGxhdDogcC5sYXQsXG4gICAgICAgIGxvbjogcC5sb24sXG4gICAgICB9KVxuICAgICk7XG4gIH0pO1xuICBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KHdiLCBYTFNYLnV0aWxzLmpzb25fdG9fc2hlZXQodW5pdmVyc2UpLCAndW5pdmVyc29fY2xpZW50ZXMnKTtcblxuICAvLyB0YXJnZXRzIGNvbW8gdGFibGEgbG9uZ1xuICBjb25zdCB0YXJnZXRzTG9uZyA9IFtdO1xuICBPYmplY3QuZW50cmllcyhUQVJHRVRTX0JZX1ZFTkRPUikuZm9yRWFjaCgoW3ZlbmRvciwgdF0pID0+IHtcbiAgICB0YXJnZXRzTG9uZy5wdXNoKHtcbiAgICAgIHZlbmRlZG9yOiBkaXNwbGF5VmVuZG9yTmFtZSh2ZW5kb3IpLFxuICAgICAgcGVyaW9kbzogJ0p1bCAyMDI2JyxcbiAgICAgIHN0YXJ0X2RhdGU6ICcyMDI2LTA3LTAxJyxcbiAgICAgIGVuZF9kYXRlOiAnMjAyNi0wNy0zMScsXG4gICAgICB0YXJnZXRfdXNkOiB0Lmp1bDIwMjZfdXNkIHx8IDAsXG4gICAgfSk7XG4gICAgdGFyZ2V0c0xvbmcucHVzaCh7XG4gICAgICB2ZW5kZWRvcjogZGlzcGxheVZlbmRvck5hbWUodmVuZG9yKSxcbiAgICAgIHBlcmlvZG86ICdKdWwtRGljIDIwMjYnLFxuICAgICAgc3RhcnRfZGF0ZTogJzIwMjYtMDctMDEnLFxuICAgICAgZW5kX2RhdGU6ICcyMDI2LTEyLTMxJyxcbiAgICAgIHRhcmdldF91c2Q6IHQuanVsRGljMjAyNl91c2QgfHwgMCxcbiAgICB9KTtcbiAgICB0YXJnZXRzTG9uZy5wdXNoKHtcbiAgICAgIHZlbmRlZG9yOiBkaXNwbGF5VmVuZG9yTmFtZSh2ZW5kb3IpLFxuICAgICAgcGVyaW9kbzogJzIwMjcnLFxuICAgICAgc3RhcnRfZGF0ZTogJzIwMjctMDEtMDEnLFxuICAgICAgZW5kX2RhdGU6ICcyMDI3LTEyLTMxJyxcbiAgICAgIHRhcmdldF91c2Q6IHQuYW51YWwyMDI3X3VzZCB8fCAwLFxuICAgIH0pO1xuICB9KTtcbiAgWExTWC51dGlscy5ib29rX2FwcGVuZF9zaGVldCh3YiwgWExTWC51dGlscy5qc29uX3RvX3NoZWV0KHRhcmdldHNMb25nKSwgJ3RhcmdldHNfbG9uZycpO1xuXG4gIC8vIGNhbXBhXHUwMEYxYXNcbiAgaWYgKGNhbXBhaWduc0NhY2hlLmxlbmd0aCkge1xuICAgIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQoXG4gICAgICB3YixcbiAgICAgIFhMU1gudXRpbHMuanNvbl90b19zaGVldChcbiAgICAgICAgY2FtcGFpZ25zQ2FjaGUubWFwKChjKSA9PiAoe1xuICAgICAgICAgIGlkOiBjLmlkLFxuICAgICAgICAgIG5vbWJyZTogYy5uYW1lLFxuICAgICAgICAgIGZpbHRlcl90eXBlOiBjLmZpbHRlclR5cGUsXG4gICAgICAgICAgZmlsdGVyX3ZhbHVlczogKGMuZmlsdGVyVmFsdWVzIHx8IFtdKS5qb2luKCcsJyksXG4gICAgICAgICAgdGFyZ2V0X3R5cGU6IGMudGFyZ2V0VHlwZSxcbiAgICAgICAgICB0YXJnZXRfYW1vdW50OiBjLnRhcmdldEFtb3VudCxcbiAgICAgICAgICBzdGFydF9kYXRlOiBjLnN0YXJ0RGF0ZSxcbiAgICAgICAgICBlbmRfZGF0ZTogYy5lbmREYXRlLFxuICAgICAgICB9KSlcbiAgICAgICksXG4gICAgICAnY2FtcGFuaWFzJ1xuICAgICk7XG4gIH1cblxuICAvLyBwYXJhbWV0cm9zXG4gIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQoXG4gICAgd2IsXG4gICAgWExTWC51dGlscy5qc29uX3RvX3NoZWV0KFtcbiAgICAgIHsgcGFyYW1ldHJvOiAnZXhjaGFuZ2VfcmF0ZV9hcnNfdXNkJywgdmFsb3I6IEVYQ0hBTkdFX1JBVEUgfSxcbiAgICAgIHsgcGFyYW1ldHJvOiAnZmVjaGFfZXhwb3J0JywgdmFsb3I6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSB9LFxuICAgIF0pLFxuICAgICdwYXJhbWV0cm9zJ1xuICApO1xuXG4gIC8vIHZpc2l0YXNcbiAgY29uc3QgdmlzaXRSb3dzQyA9IGJ1aWxkVmlzaXRSb3dzKCk7XG4gIGlmICh2aXNpdFJvd3NDLmxlbmd0aClcbiAgICBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KHdiLCBYTFNYLnV0aWxzLmpzb25fdG9fc2hlZXQodmlzaXRSb3dzQyksICd2aXNpdGFzJyk7XG4gIC8vIGNvbnRhY3RhZG9zXG4gIGNvbnN0IGNvbnRhY3RSb3dzQyA9IGJ1aWxkQ29udGFjdGFkb3NSb3dzKCk7XG4gIGlmIChjb250YWN0Um93c0MubGVuZ3RoKVxuICAgIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQod2IsIFhMU1gudXRpbHMuanNvbl90b19zaGVldChjb250YWN0Um93c0MpLCAnY29udGFjdGFkb3MnKTtcbiAgLy8gbG9nIGRlIG9wZXJhY2lvbmVzXG4gIGNvbnN0IG9wc1Jvd3NDID0gYnVpbGRPcHNMb2dSb3dzKCk7XG4gIGlmIChvcHNSb3dzQy5sZW5ndGgpXG4gICAgWExTWC51dGlscy5ib29rX2FwcGVuZF9zaGVldCh3YiwgWExTWC51dGlscy5qc29uX3RvX3NoZWV0KG9wc1Jvd3NDKSwgJ2xvZ19vcGVyYWNpb25lcycpO1xuXG4gIFhMU1gud3JpdGVGaWxlKHdiLCAnU2hpbWFub19NTF8nICsgdG9kYXlTdHIoKSArICcueGxzeCcpO1xufTtcblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyB2MzcxKzogRXhwb3J0IGRhdGFzZXQgcGFyYSBhblx1MDBFMWxpc2lzIChaSVAgZGUgQ1NWcyBwYXJhIE1MIHBpcGVsaW5lcylcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4vKipcbiAqIEFicmUgZWwgbW9kYWwgY2hpY28gZGlzcGF0Y2hlciBkZWwgYm90b24gXCJFeHBvcnRhciBhIEV4Y2VsXCIuIE11ZXN0cmFcbiAqIDIgdGFyamV0YXM6IFJlcG9ydGVzIEV4Y2VsICh0b2RvcykgdnMgRGF0YXNldCBaSVAgKHNvbG8gYWRtaW4vZ2VyZW50ZSkuXG4gKi9cbndpbmRvdy5vcGVuRXhwb3J0Rm9ybWF0TW9kYWwgPSBmdW5jdGlvbiAoKSB7XG4gIC8vIE9jdWx0YXIvbW9zdHJhciB0YXJqZXRhIERhdGFzZXQgc2VndW4gcm9sLlxuICBjb25zdCBkc09wdCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdleHAtb3B0LWRhdGFzZXQtemlwJyk7XG4gIGlmIChkc09wdCkge1xuICAgIGNvbnN0IGlzQWRtaW5PckdlcmVudGUgPSB1c2VyUm9sZSA9PT0gJ2FkbWluJyB8fCB1c2VyUm9sZSA9PT0gJ2dlcmVudGUnO1xuICAgIGRzT3B0LnN0eWxlLmRpc3BsYXkgPSBpc0FkbWluT3JHZXJlbnRlID8gJycgOiAnbm9uZSc7XG4gIH1cbiAgLy8gT2N1bHRhciBwcm9ncmVzcyBiYXIgKHBvciBzaSBxdWVkbyBhYmllcnRvIGRlIHVuYSBlamVjdWNpb24gYW50ZXJpb3IpXG4gIGNvbnN0IHByb2cgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZXhwb3J0LWRhdGFzZXQtcHJvZ3Jlc3MnKTtcbiAgaWYgKHByb2cpIHByb2cuc3R5bGUuZGlzcGxheSA9ICdub25lJztcbiAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2V4cG9ydC1mb3JtYXQtbW9kYWwnKS5jbGFzc0xpc3QuYWRkKCdvcGVuJyk7XG59O1xuXG53aW5kb3cuY2xvc2VFeHBvcnRGb3JtYXRNb2RhbCA9IGZ1bmN0aW9uICgpIHtcbiAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2V4cG9ydC1mb3JtYXQtbW9kYWwnKS5jbGFzc0xpc3QucmVtb3ZlKCdvcGVuJyk7XG59O1xuXG4vKipcbiAqIEFjdHVhbGl6YSBlbCBzdGF0dXMgKyBiYXJyYSBkZWwgbW9kYWwuIHN0YXR1cyBlcyB0ZXh0byBsaWJyZTsgcGVyY2VudCAwLi4xMDAuXG4gKi9cbmZ1bmN0aW9uIF91cGRhdGVFeHBvcnRQcm9ncmVzcyhzdGF0dXMsIHBlcmNlbnQpIHtcbiAgY29uc3QgcyA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdleHBvcnQtZGF0YXNldC1zdGF0dXMnKTtcbiAgY29uc3QgYiA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdleHBvcnQtZGF0YXNldC1iYXInKTtcbiAgY29uc3Qgd3JhcCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdleHBvcnQtZGF0YXNldC1wcm9ncmVzcycpO1xuICBpZiAod3JhcCkgd3JhcC5zdHlsZS5kaXNwbGF5ID0gJyc7XG4gIGlmIChzKSBzLnRleHRDb250ZW50ID0gc3RhdHVzO1xuICBpZiAoYikgYi5zdHlsZS53aWR0aCA9IE1hdGgubWF4KDAsIE1hdGgubWluKDEwMCwgcGVyY2VudCkpICsgJyUnO1xufVxuXG4vKipcbiAqIEZldGNoIHN0b2NrLmpzb24gZGVsIHJvb3QgZGVsIHNpdGlvICh2MzY5KyB0aWVuZSB3YXJlaG91c2VCcmVha2Rvd24pLlxuICogQ2FjaGUtYnVzdGluZyBjb24gP3Q9IHBhcmEgZXZpdGFyIFNXLlxuICovXG5hc3luYyBmdW5jdGlvbiBfZmV0Y2hTdG9ja0pzb24oKSB7XG4gIHRyeSB7XG4gICAgY29uc3QgciA9IGF3YWl0IGZldGNoKCcuL3N0b2NrLmpzb24/dD0nICsgRGF0ZS5ub3coKSwgeyBjYWNoZTogJ25vLXN0b3JlJyB9KTtcbiAgICBpZiAoIXIub2spIHRocm93IG5ldyBFcnJvcignSFRUUCAnICsgci5zdGF0dXMpO1xuICAgIHJldHVybiBhd2FpdCByLmpzb24oKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGNvbnNvbGUud2FybignW2V4cG9ydERhdGFzZXRaaXBdIHN0b2NrLmpzb24gZmFsbG86JywgZSAmJiBlLm1lc3NhZ2UpO1xuICAgIHJldHVybiBudWxsOyAvLyBubyBibG9xdWVhbnRlIFx1MjAxNCBwcm9kdWN0b3MuY3N2IHF1ZWRhIHZhY2lvXG4gIH1cbn1cblxuLyoqXG4gKiBMYXp5IGxvYWQgSlNaaXAgKHBhdHJvbiB5YSB1c2FkbyBlbiBleHBvcnRQaG90b3NaaXAgbGluZWEgfjQ3KS5cbiAqL1xuYXN5bmMgZnVuY3Rpb24gX2Vuc3VyZUpTWmlwTG9hZGVkKCkge1xuICBpZiAodHlwZW9mIEpTWmlwICE9PSAndW5kZWZpbmVkJykgcmV0dXJuO1xuICBhd2FpdCBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgY29uc3QgcyA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3NjcmlwdCcpO1xuICAgIHMuc3JjID0gJ2h0dHBzOi8vY2RuanMuY2xvdWRmbGFyZS5jb20vYWpheC9saWJzL2pzemlwLzMuMTAuMS9qc3ppcC5taW4uanMnO1xuICAgIHMub25sb2FkID0gcmVzb2x2ZTtcbiAgICBzLm9uZXJyb3IgPSAoKSA9PiByZWplY3QobmV3IEVycm9yKCdObyBzZSBwdWRvIGNhcmdhciBKU1ppcCcpKTtcbiAgICBkb2N1bWVudC5oZWFkLmFwcGVuZENoaWxkKHMpO1xuICB9KTtcbn1cblxuLyoqXG4gKiBEZXNjYXJnYSB1biBCbG9iIGNvbW8gYXJjaGl2by4gUmV1c2EgZWwgcGF0cm9uIGRlIGV4cG9ydFBob3Rvc1ppcC5cbiAqL1xuZnVuY3Rpb24gX2Rvd25sb2FkQmxvYihibG9iLCBmaWxlbmFtZSkge1xuICBjb25zdCB1cmwgPSBVUkwuY3JlYXRlT2JqZWN0VVJMKGJsb2IpO1xuICBjb25zdCBhID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnYScpO1xuICBhLmhyZWYgPSB1cmw7XG4gIGEuZG93bmxvYWQgPSBmaWxlbmFtZTtcbiAgZG9jdW1lbnQuYm9keS5hcHBlbmRDaGlsZChhKTtcbiAgYS5jbGljaygpO1xuICBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICBkb2N1bWVudC5ib2R5LnJlbW92ZUNoaWxkKGEpO1xuICAgIFVSTC5yZXZva2VPYmplY3RVUkwodXJsKTtcbiAgfSwgMTAwKTtcbn1cblxuLyoqXG4gKiBFWFBPUlQgUFJJTkNJUEFMLiBTb2xvIGFkbWluL2dlcmVudGUuIEdlbmVyYSBaSVAgY29uOlxuICogIC0gcGVkaWRvcy5jc3YsIHZpc2l0YXMuY3N2LCBjbGllbnRlcy5jc3YsIGNsaWVudF9tYXN0ZXIuY3N2LCByZW5kaWNpb25lcy5jc3YsXG4gKiAgICBjYW1wYW5pYXMuY3N2LCB0YXJnZXRzLmNzdiwgcHJvZHVjdG9zLmNzdiwgdmVuZG9yX292ZXJyaWRlcy5jc3YsXG4gKiAgICBjdXN0b21fcm91dGVzLmNzdiwgc2VndWltaWVudG9fbm90ZXMuY3N2XG4gKiAgLSBtYW5pZmVzdC5qc29uIChzY2hlbWEgKyB1c2VDYXNlTWF0cml4ICsgcm93Q291bnRzICsgbnVsbFJhdGVCeUZpZWxkICsgbGltaXRhdGlvbnMpXG4gKlxuICogQ2Fzb3MgYm9yZGUgbWFuZWphZG9zOlxuICogIC0gU2kgYWxndW5hIC5nZXQoKSBmYWxsYSAtPiBhbGVydCArIG5vIGRlc2NhcmdhciAobm8gZ2VuZXJhIFpJUCBwYXJjaWFsIHNpbGVuY2lvc28pLlxuICogIC0gU2kgc3RvY2suanNvbiBubyByZXNwb25kZSAtPiBwcm9kdWN0b3MuY3N2IHF1ZWRhIHZhY2lvIGNvbiB3YXJuaW5nIGVuIG1hbmlmZXN0LlxuICogIC0gUHJvZ3Jlc3MgYmFyIGVuIGVsIG1vZGFsIHBhcmEgZmVlZGJhY2sgKH4xMC0zMCBzZWcpLlxuICovXG53aW5kb3cuZXhwb3J0RGF0YXNldFppcCA9IGFzeW5jIGZ1bmN0aW9uICgpIHtcbiAgaWYgKHVzZXJSb2xlICE9PSAnYWRtaW4nICYmIHVzZXJSb2xlICE9PSAnZ2VyZW50ZScpIHtcbiAgICBhbGVydCgnU29sbyBhZG1pbiBvIGdlcmVudGUgcHVlZGVuIGV4cG9ydGFyIGVsIGRhdGFzZXQuJyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGlmICghZmJEYikge1xuICAgIGFsZXJ0KCdGaXJlc3RvcmUgbm8gaW5pY2lhbGl6YWRvLiBSZWNhcmdhIGxhIGFwcC4nKTtcbiAgICByZXR1cm47XG4gIH1cblxuICAvLyBSZS1hYnJpciBtb2RhbCBzaSBlbCB1c3VhcmlvIGNlcnJvIHkgbmF2ZWdhbW9zIHBvciBvdHJvIGZsdWpvLlxuICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZXhwb3J0LWZvcm1hdC1tb2RhbCcpLmNsYXNzTGlzdC5hZGQoJ29wZW4nKTtcbiAgX3VwZGF0ZUV4cG9ydFByb2dyZXNzKCdQcmVwYXJhbmRvLi4uJywgNSk7XG5cbiAgdHJ5IHtcbiAgICBfdXBkYXRlRXhwb3J0UHJvZ3Jlc3MoJ0NhcmdhbmRvIEpTWmlwLi4uJywgMTApO1xuICAgIGF3YWl0IF9lbnN1cmVKU1ppcExvYWRlZCgpO1xuXG4gICAgLy8gMSkgRmV0Y2ggMTAgY29sZWNjaW9uZXMgRmlyZXN0b3JlIGVuIHBhcmFsZWxvICsgc3RvY2suanNvblxuICAgIF91cGRhdGVFeHBvcnRQcm9ncmVzcygnTGV5ZW5kbyBGaXJlc3RvcmUgKDEwIGNvbGVjY2lvbmVzKS4uLicsIDIwKTtcbiAgICBjb25zdCBmaXJlc3RvcmVFbnRyaWVzID0gW1xuICAgICAgWydwZWRpZG9zJywgZmJEYi5jb2xsZWN0aW9uKCdwZWRpZG9zJykuZ2V0KCldLFxuICAgICAgWyd2aXNpdGFzJywgZmJEYi5jb2xsZWN0aW9uKCd2aXNpdHMnKS5nZXQoKV0sXG4gICAgICBbJ2NsaWVudGVzJywgZmJEYi5jb2xsZWN0aW9uKCdjbGllbnRfYXBwbGljYXRpb25zJykuZ2V0KCldLFxuICAgICAgWydjbGllbnRfbWFzdGVyJywgZmJEYi5jb2xsZWN0aW9uKCdjbGllbnRfbWFzdGVyJykuZ2V0KCldLFxuICAgICAgWydyZW5kaWNpb25lcycsIGZiRGIuY29sbGVjdGlvbigncmVuZGljaW9uZXMnKS5nZXQoKV0sXG4gICAgICBbJ2NhbXBhbmlhcycsIGZiRGIuY29sbGVjdGlvbignY2FtcGFpZ25zJykuZ2V0KCldLFxuICAgICAgWyd0YXJnZXRzJywgZmJEYi5jb2xsZWN0aW9uKCd0YXJnZXRzJykuZ2V0KCldLFxuICAgICAgWyd2ZW5kb3Jfb3ZlcnJpZGVzJywgZmJEYi5jb2xsZWN0aW9uKCd2ZW5kb3Jfb3ZlcnJpZGVzJykuZ2V0KCldLFxuICAgICAgWydjdXN0b21fcm91dGVzJywgZmJEYi5jb2xsZWN0aW9uKCdjdXN0b21fcm91dGVzJykuZ2V0KCldLFxuICAgICAgWydzZWd1aW1pZW50b19ub3RlcycsIGZiRGIuY29sbGVjdGlvbignc2VndWltaWVudG9fbm90ZXMnKS5nZXQoKV0sXG4gICAgXTtcbiAgICBjb25zdCBwcm9taXNlcyA9IGZpcmVzdG9yZUVudHJpZXMubWFwKChbLCBwXSkgPT4gcCk7XG4gICAgcHJvbWlzZXMucHVzaChfZmV0Y2hTdG9ja0pzb24oKSk7XG5cbiAgICBjb25zdCBzZXR0bGVkID0gYXdhaXQgUHJvbWlzZS5hbGxTZXR0bGVkKHByb21pc2VzKTtcbiAgICAvLyBTaSBDVUFMUVVJRVIgZ2V0KCkgZGUgRmlyZXN0b3JlIHJlY2hhem8sIGFib3J0YW1vcyAobm8gZXhwb3J0IHBhcmNpYWwgc2lsZW5jaW9zbykuXG4gICAgY29uc3QgZmFpbGVkRmlyZXN0b3JlID0gW107XG4gICAgc2V0dGxlZC5zbGljZSgwLCBmaXJlc3RvcmVFbnRyaWVzLmxlbmd0aCkuZm9yRWFjaCgociwgaSkgPT4ge1xuICAgICAgaWYgKHIuc3RhdHVzID09PSAncmVqZWN0ZWQnKVxuICAgICAgICBmYWlsZWRGaXJlc3RvcmUucHVzaChcbiAgICAgICAgICBmaXJlc3RvcmVFbnRyaWVzW2ldWzBdICsgJzogJyArICgoci5yZWFzb24gJiYgci5yZWFzb24ubWVzc2FnZSkgfHwgci5yZWFzb24pXG4gICAgICAgICk7XG4gICAgfSk7XG4gICAgaWYgKGZhaWxlZEZpcmVzdG9yZS5sZW5ndGgpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgJ0ZpcmVzdG9yZSBmZXRjaCBmYWxsbyBlbiAnICtcbiAgICAgICAgICBmYWlsZWRGaXJlc3RvcmUubGVuZ3RoICtcbiAgICAgICAgICAnIGNvbGVjY2lvbmVzOlxcbicgK1xuICAgICAgICAgIGZhaWxlZEZpcmVzdG9yZS5qb2luKCdcXG4nKVxuICAgICAgKTtcbiAgICB9XG5cbiAgICAvLyAyKSBFeHRyYWVyIHNuYXBzaG90cyArIGRvY3MgY29uIF9pZFxuICAgIGNvbnN0IHNuYXBzaG90cyA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgYW55W10+fSAqLyAoe30pO1xuICAgIGZpcmVzdG9yZUVudHJpZXMuZm9yRWFjaCgoW25hbWVdLCBpKSA9PiB7XG4gICAgICBjb25zdCBzbmFwID0gLyoqIEB0eXBlIHthbnl9ICovIChzZXR0bGVkW2ldKS52YWx1ZTtcbiAgICAgIGNvbnN0IGRvY3MgPSBbXTtcbiAgICAgIHNuYXAuZm9yRWFjaCgoZCkgPT4ge1xuICAgICAgICBjb25zdCBkYXRhID0gZC5kYXRhKCkgfHwge307XG4gICAgICAgIGRhdGEuX2lkID0gZC5pZDtcbiAgICAgICAgZG9jcy5wdXNoKGRhdGEpO1xuICAgICAgfSk7XG4gICAgICBzbmFwc2hvdHNbbmFtZV0gPSBkb2NzO1xuICAgIH0pO1xuICAgIGNvbnN0IHN0b2NrSnNvbiA9IC8qKiBAdHlwZSB7YW55fSAqLyAoc2V0dGxlZFtzZXR0bGVkLmxlbmd0aCAtIDFdKS52YWx1ZTsgLy8gcHVlZGUgc2VyIG51bGxcblxuICAgIC8vIDMpIENvbnN0cnVpciBDU1ZzIGNvbiByb3cgYnVpbGRlcnMgKyBzY2hlbWFzXG4gICAgX3VwZGF0ZUV4cG9ydFByb2dyZXNzKCdTZXJpYWxpemFuZG8gQ1NWcy4uLicsIDU1KTtcbiAgICBjb25zdCBjc3ZzID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+fSAqLyAoe30pO1xuICAgIGNvbnN0IHJvd0NvdW50cyA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgbnVtYmVyPn0gKi8gKHt9KTtcbiAgICBjb25zdCBhbGxSb3dzQnlDc3YgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIGFueVtdW10+fSAqLyAoe30pO1xuXG4gICAgZm9yIChjb25zdCBjb2xsTmFtZSBvZiBPYmplY3Qua2V5cyhzbmFwc2hvdHMpKSB7XG4gICAgICBjb25zdCBzY2hlbWEgPSBEQVRBU0VUX1NDSEVNQVNbY29sbE5hbWVdO1xuICAgICAgaWYgKCFzY2hlbWEpIGNvbnRpbnVlO1xuICAgICAgY29uc3QgYnVpbGRlciA9IFJPV19CVUlMREVSU1tjb2xsTmFtZV07XG4gICAgICBpZiAoIWJ1aWxkZXIpIGNvbnRpbnVlO1xuICAgICAgY29uc3QgYWxsUm93cyA9IC8qKiBAdHlwZSB7YW55W11bXX0gKi8gKFtdKTtcbiAgICAgIGZvciAoY29uc3QgZG9jIG9mIHNuYXBzaG90c1tjb2xsTmFtZV0pIHtcbiAgICAgICAgY29uc3Qgcm93c0ZvckRvYyA9IGJ1aWxkZXIoZG9jKTtcbiAgICAgICAgZm9yIChjb25zdCByIG9mIHJvd3NGb3JEb2MpIGFsbFJvd3MucHVzaChyKTtcbiAgICAgIH1cbiAgICAgIGFsbFJvd3NCeUNzdltzY2hlbWEubmFtZV0gPSBhbGxSb3dzO1xuICAgICAgY3N2c1tzY2hlbWEubmFtZV0gPSBidWlsZENzdihzY2hlbWEsIGFsbFJvd3MpO1xuICAgICAgcm93Q291bnRzW3NjaGVtYS5uYW1lXSA9IGFsbFJvd3MubGVuZ3RoO1xuICAgIH1cblxuICAgIC8vIHByb2R1Y3Rvcy5jc3YgKGRlc2RlIHN0b2NrLmpzb24sIG5vIEZpcmVzdG9yZSlcbiAgICBjb25zdCBwcm9kdWN0b3NTY2hlbWEgPSBEQVRBU0VUX1NDSEVNQVMucHJvZHVjdG9zO1xuICAgIGNvbnN0IHByb2R1Y3Rvc1Jvd3MgPSBzdG9ja0pzb24gPyBidWlsZFByb2R1Y3RvUm93c0Zyb21TdG9ja0pzb24oc3RvY2tKc29uKSA6IFtdO1xuICAgIGFsbFJvd3NCeUNzdltwcm9kdWN0b3NTY2hlbWEubmFtZV0gPSBwcm9kdWN0b3NSb3dzO1xuICAgIGNzdnNbcHJvZHVjdG9zU2NoZW1hLm5hbWVdID0gYnVpbGRDc3YocHJvZHVjdG9zU2NoZW1hLCBwcm9kdWN0b3NSb3dzKTtcbiAgICByb3dDb3VudHNbcHJvZHVjdG9zU2NoZW1hLm5hbWVdID0gcHJvZHVjdG9zUm93cy5sZW5ndGg7XG5cbiAgICAvLyA0KSBDb21wdXRhciBudWxsUmF0ZUJ5RmllbGQgcGFyYSBjYWRhIGNhc28gQS1FXG4gICAgX3VwZGF0ZUV4cG9ydFByb2dyZXNzKCdDYWxjdWxhbmRvIGNhbGlkYWQgZGVsIGRhdGFzZXQuLi4nLCA3NSk7XG4gICAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBhbnk+fSAqL1xuICAgIGNvbnN0IHVzZUNhc2VXaXRoU3RhdHMgPSB7fTtcbiAgICBmb3IgKGNvbnN0IFtjYXNlS2V5LCB1Y10gb2YgT2JqZWN0LmVudHJpZXMoREFUQVNFVF9VU0VfQ0FTRV9NQVRSSVgpKSB7XG4gICAgICBjb25zdCBzdGF0cyA9IC8qKiBAdHlwZSB7YW55fSAqLyAoe1xuICAgICAgICBwcmlvcml0eTogdWMucHJpb3JpdHksXG4gICAgICAgIGRlc2NyaXB0aW9uOiB1Yy5kZXNjcmlwdGlvbixcbiAgICAgICAgcmVxdWlyZWRGaWVsZHM6IHVjLnJlcXVpcmVkRmllbGRzLFxuICAgICAgICBqb2luTm90ZXM6IHVjLmpvaW5Ob3RlcyxcbiAgICAgICAgbnVsbFJhdGVCeUZpZWxkOiB7fSxcbiAgICAgICAgbGltaXRhdGlvbnM6IFtdLFxuICAgICAgfSk7XG4gICAgICBsZXQgaGFzSGlnaE51bGxSYXRlID0gZmFsc2U7XG4gICAgICBsZXQgaGFzRW1wdHlSZXF1aXJlZCA9IGZhbHNlO1xuICAgICAgZm9yIChjb25zdCBbY3N2TmFtZSwgZmllbGRzXSBvZiBPYmplY3QuZW50cmllcyh1Yy5yZXF1aXJlZEZpZWxkcykpIHtcbiAgICAgICAgY29uc3Qgc2NoZW1hRm9yQ3N2ID0gT2JqZWN0LnZhbHVlcyhEQVRBU0VUX1NDSEVNQVMpLmZpbmQoKHMpID0+IHMubmFtZSA9PT0gY3N2TmFtZSk7XG4gICAgICAgIGlmICghc2NoZW1hRm9yQ3N2KSB7XG4gICAgICAgICAgc3RhdHMubGltaXRhdGlvbnMucHVzaCgnU2NoZW1hIG5vIGVuY29udHJhZG8gcGFyYSAnICsgY3N2TmFtZSk7XG4gICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cbiAgICAgICAgY29uc3Qgcm93cyA9IGFsbFJvd3NCeUNzdltjc3ZOYW1lXSB8fCBbXTtcbiAgICAgICAgY29uc3QgcmF0ZXMgPSBjb21wdXRlTnVsbFJhdGVzKHNjaGVtYUZvckNzdiwgcm93cywgZmllbGRzKTtcbiAgICAgICAgZm9yIChjb25zdCBbZiwgcmF0ZV0gb2YgT2JqZWN0LmVudHJpZXMocmF0ZXMpKSB7XG4gICAgICAgICAgc3RhdHMubnVsbFJhdGVCeUZpZWxkW2Nzdk5hbWUgKyAnLicgKyBmXSA9IHJhdGU7XG4gICAgICAgICAgaWYgKHJvd3MubGVuZ3RoID09PSAwKSBoYXNFbXB0eVJlcXVpcmVkID0gdHJ1ZTtcbiAgICAgICAgICBlbHNlIGlmIChyYXRlID4gMC41KSBoYXNIaWdoTnVsbFJhdGUgPSB0cnVlO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICBpZiAoaGFzRW1wdHlSZXF1aXJlZCkge1xuICAgICAgICBzdGF0cy5zdGF0dXMgPSAnRU1QVFknO1xuICAgICAgICBzdGF0cy5saW1pdGF0aW9ucy5wdXNoKFxuICAgICAgICAgICdBbGd1bmEgY29sZWNjaW9uIHJlcXVlcmlkYSBlc3RhIHZhY2lhIFx1MjAxNCBlbCBjYXNvIG5vIHNlIHB1ZWRlIGVudHJlbmFyIGhveSBwZXJvIGVsIHNjaGVtYSBlc3RhIGxpc3RvLidcbiAgICAgICAgKTtcbiAgICAgIH0gZWxzZSBpZiAoaGFzSGlnaE51bGxSYXRlKSB7XG4gICAgICAgIHN0YXRzLnN0YXR1cyA9ICdQQVJUSUFMJztcbiAgICAgICAgc3RhdHMubGltaXRhdGlvbnMucHVzaChcbiAgICAgICAgICAnQWwgbWVub3MgMSBjYW1wbyByZXF1ZXJpZG8gdGllbmUgPjUwJSBkZSBudWxscyBcdTIwMTQgcmV2aXNhciB0YXNhcyBhbnRlcyBkZSB1c2FyLidcbiAgICAgICAgKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHN0YXRzLnN0YXR1cyA9ICdPSyc7XG4gICAgICB9XG4gICAgICB1c2VDYXNlV2l0aFN0YXRzW2Nhc2VLZXldID0gc3RhdHM7XG4gICAgfVxuXG4gICAgLy8gNSkgTWFuaWZlc3QuanNvblxuICAgIGNvbnN0IGV4cG9ydGVkQXQgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCk7XG4gICAgY29uc3QgbWFuaWZlc3QgPSB7XG4gICAgICBleHBvcnRlZEF0LFxuICAgICAgYXBwVmVyc2lvbjogdHlwZW9mIEFQUF9WRVJTSU9OICE9PSAndW5kZWZpbmVkJyA/IEFQUF9WRVJTSU9OIDogJ3Vua25vd24nLFxuICAgICAgc291cmNlUHJvamVjdDogJ2FwcC12ZW5kZWRvcmVzLXNoaW1hbm8nLFxuICAgICAgZXhwb3J0ZWRCeUVtYWlsOiAoY3VycmVudFVzZXIgJiYgY3VycmVudFVzZXIuZW1haWwpIHx8ICd1bmtub3duJyxcbiAgICAgIGV4cG9ydGVkQnlVaWQ6IChjdXJyZW50VXNlciAmJiBjdXJyZW50VXNlci51aWQpIHx8ICd1bmtub3duJyxcbiAgICAgIGNzdkNvbnZlbnRpb25zOiB7XG4gICAgICAgIGVuY29kaW5nOiAnVVRGLTgnLFxuICAgICAgICBzZXBhcmF0b3I6ICcsJyxcbiAgICAgICAgcXVvdGVDaGFyOiAnXCInLFxuICAgICAgICBlc2NhcGVRdW90ZTogJ1wiXCInLFxuICAgICAgICBsaW5lVGVybWluYXRvcjogJ1xcXFxyXFxcXG4nLFxuICAgICAgICBkYXRlRm9ybWF0OiAnSVNPIDg2MDEgVVRDICh3aXRoIFopJyxcbiAgICAgICAgZGVjaW1hbFNlcGFyYXRvcjogJy4nLFxuICAgICAgICBudWxsUmVwcmVzZW50YXRpb246ICcoZW1wdHkgZmllbGQpJyxcbiAgICAgICAgYXJyYXlGb3JtYXQ6ICdKU09OIHN0cmluZ2lmaWVkJyxcbiAgICAgICAgb2JqZWN0Rm9ybWF0OiAnSlNPTiBzdHJpbmdpZmllZCcsXG4gICAgICB9LFxuICAgICAgcm93Q291bnRzLFxuICAgICAgc2NoZW1hOiB7fSxcbiAgICAgIHVzZUNhc2VNYXRyaXg6IHVzZUNhc2VXaXRoU3RhdHMsXG4gICAgICBleGNsdXNpb25zOiB7XG4gICAgICAgIG5vdGU6ICdEYXRvcyBzZW5zaWJsZXMgeSBiaW5hcmlvcyBleGNsdWlkb3MgZGVsIGV4cG9ydC4nLFxuICAgICAgICBleGNsdWRlZENvbGxlY3Rpb25zOiBbXG4gICAgICAgICAgJ3JvbGVzJyxcbiAgICAgICAgICAnYXBwX2NvbmZpZycsXG4gICAgICAgICAgJ3NhcF9zbmFwc2hvdCcsXG4gICAgICAgICAgJ25vdGlmaWNhdGlvbnMnLFxuICAgICAgICAgICdvcGVyYXRpb25zX2xvZycsXG4gICAgICAgIF0sXG4gICAgICAgIGV4Y2x1ZGVkRmllbGRzOiBbXG4gICAgICAgICAgJ3Zpc2l0cy5mcmVudGVMb2NhbCAoZm90b3MgYmFzZTY0KScsXG4gICAgICAgICAgJ3Zpc2l0cy5lc3BhY2lvW10gKGZvdG9zIGJhc2U2NCknLFxuICAgICAgICAgICdjbGllbnRfYXBwbGljYXRpb25zLmNvbnN0YW5jaWFBcmNhIChiYXNlNjQpJyxcbiAgICAgICAgICAnY2xpZW50X2FwcGxpY2F0aW9ucy5jb25zdGFuY2lhSUlCQiAoYmFzZTY0KScsXG4gICAgICAgICAgJ2NsaWVudF9hcHBsaWNhdGlvbnMuZm90b3NMb2NhbFtdIChiYXNlNjQpJyxcbiAgICAgICAgICAncmVuZGljaW9uZXMuZm90b1RpY2tldCAoYmFzZTY0IGxlZ2FjeSBwcmUtdjMwODsgc2UgZXhwb3J0YSBzb2xvIGZvdG9UaWNrZXRVcmwpJyxcbiAgICAgICAgXSxcbiAgICAgICAgc3RvY2tKc29uTG9hZGVkOiBzdG9ja0pzb24gIT09IG51bGwsXG4gICAgICB9LFxuICAgIH07XG4gICAgZm9yIChjb25zdCBbX2NvbGxOYW1lLCBzY2hlbWFdIG9mIE9iamVjdC5lbnRyaWVzKERBVEFTRVRfU0NIRU1BUykpIHtcbiAgICAgIG1hbmlmZXN0LnNjaGVtYVtzY2hlbWEubmFtZV0gPSBzY2hlbWEuY29sdW1ucy5tYXAoKGMpID0+ICh7XG4gICAgICAgIGNvbDogYy5jb2wsXG4gICAgICAgIHR5cGU6IGMudHlwZSxcbiAgICAgICAgZGVzYzogYy5kZXNjLFxuICAgICAgfSkpO1xuICAgIH1cblxuICAgIC8vIDYpIEVtcGFxdWV0YXIgWklQXG4gICAgX3VwZGF0ZUV4cG9ydFByb2dyZXNzKCdFbXBhcXVldGFuZG8gWklQLi4uJywgOTApO1xuICAgIGNvbnN0IHppcCA9IG5ldyBKU1ppcCgpO1xuICAgIGZvciAoY29uc3QgW25hbWUsIGNvbnRlbnRdIG9mIE9iamVjdC5lbnRyaWVzKGNzdnMpKSB7XG4gICAgICB6aXAuZmlsZShuYW1lLCBjb250ZW50KTtcbiAgICB9XG4gICAgemlwLmZpbGUoJ21hbmlmZXN0Lmpzb24nLCBKU09OLnN0cmluZ2lmeShtYW5pZmVzdCwgbnVsbCwgMikpO1xuXG4gICAgY29uc3QgYmxvYiA9IGF3YWl0IHppcC5nZW5lcmF0ZUFzeW5jKHtcbiAgICAgIHR5cGU6ICdibG9iJyxcbiAgICAgIGNvbXByZXNzaW9uOiAnREVGTEFURScsXG4gICAgICBjb21wcmVzc2lvbk9wdGlvbnM6IHsgbGV2ZWw6IDYgfSxcbiAgICB9KTtcbiAgICBjb25zdCBmaWxlbmFtZSA9ICdzaGltYW5vLWRhdGFzZXQtJyArIGV4cG9ydGVkQXQucmVwbGFjZSgvWzouXS9nLCAnLScpICsgJy56aXAnO1xuICAgIF9kb3dubG9hZEJsb2IoYmxvYiwgZmlsZW5hbWUpO1xuXG4gICAgX3VwZGF0ZUV4cG9ydFByb2dyZXNzKFxuICAgICAgJ0RhdGFzZXQgZGVzY2FyZ2FkbzogJyArXG4gICAgICAgIGZpbGVuYW1lICtcbiAgICAgICAgJyAoJyArXG4gICAgICAgIE9iamVjdC5rZXlzKGNzdnMpLmxlbmd0aCArXG4gICAgICAgICcgQ1NWcyArIG1hbmlmZXN0Lmpzb24pJyxcbiAgICAgIDEwMFxuICAgICk7XG4gICAgaWYgKHR5cGVvZiBzaG93U3luY1RhZyA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgY29uc3QgdG90YWxSb3dzID0gT2JqZWN0LnZhbHVlcyhyb3dDb3VudHMpLnJlZHVjZSgoYSwgYikgPT4gYSArIGIsIDApO1xuICAgICAgc2hvd1N5bmNUYWcoXG4gICAgICAgICdEYXRhc2V0IGV4cG9ydGFkbzogJyArIHRvdGFsUm93cyArICcgZmlsYXMgZW4gJyArIE9iamVjdC5rZXlzKGNzdnMpLmxlbmd0aCArICcgQ1NWcydcbiAgICAgICk7XG4gICAgfVxuICAgIHNldFRpbWVvdXQoKCkgPT4gd2luZG93LmNsb3NlRXhwb3J0Rm9ybWF0TW9kYWwoKSwgMzAwMCk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBjb25zb2xlLmVycm9yKCdbZXhwb3J0RGF0YXNldFppcF0gZmF0YWw6JywgZSk7XG4gICAgX3VwZGF0ZUV4cG9ydFByb2dyZXNzKCdFcnJvcjogJyArICgoZSAmJiBlLm1lc3NhZ2UpIHx8IGUpLCAwKTtcbiAgICBhbGVydChcbiAgICAgICdFcnJvciBhbCBleHBvcnRhciBlbCBkYXRhc2V0OlxcblxcbicgK1xuICAgICAgICAoKGUgJiYgZS5tZXNzYWdlKSB8fCBlKSArXG4gICAgICAgICdcXG5cXG5FbCBaSVAgTk8gc2UgZGVzY2FyZ28gKGV2aXRhbW9zIGdlbmVyYXIgdW4gYXJjaGl2byBwYXJjaWFsKS4gUmV2aXNhIGxhIGNvbnNvbGEgcGFyYSBtYXMgZGV0YWxsZXMuJ1xuICAgICk7XG4gIH1cbn07XG5cbi8vID09PSBFeHBvcnRzIGEgd2luZG93ID09PVxuLy8gVG9kYXMgbGFzIGZ1bmNpb25lcyB3aW5kb3cuZm9vID0gZnVuY3Rpb24uLi4geWEgZXN0XHUwMEUxbiB2ZXJiYXRpbS5cbmlmICh0eXBlb2Ygd2luZG93LnRvZGF5U3RyID09PSAndW5kZWZpbmVkJykgd2luZG93LnRvZGF5U3RyID0gdG9kYXlTdHI7XG4vLyBFNiBob3RmaXggMjogZGF0YVVybFRvQmxvYiArIHNhbml0aXplRm9yUGF0aCB1c2Fkb3MgcG9yIGlubGluZSBydW5GdWxsQmFja3VwIChMNzI3OC03Mjg4KS5cbmlmICh0eXBlb2Ygd2luZG93LmRhdGFVcmxUb0Jsb2IgPT09ICd1bmRlZmluZWQnKSB3aW5kb3cuZGF0YVVybFRvQmxvYiA9IGRhdGFVcmxUb0Jsb2I7XG5pZiAodHlwZW9mIHdpbmRvdy5zYW5pdGl6ZUZvclBhdGggPT09ICd1bmRlZmluZWQnKSB3aW5kb3cuc2FuaXRpemVGb3JQYXRoID0gc2FuaXRpemVGb3JQYXRoO1xuLy8gRTYgaG90Zml4IDM6IGNyb3NzLW1vZHVsZSBidWcgKGF1ZGl0IGNyb3NzYnVuZGxlKSBcdTIwMTQgZXhwb3J0cy1jb3JlIGxsYW1hIGxvYWRFeGNlbEpTLlxud2luZG93LmxvYWRFeGNlbEpTID0gbG9hZEV4Y2VsSlM7XG4iXSwKICAibWFwcGluZ3MiOiAiOzs7QUFvQ08sV0FBUyxVQUFVLEdBQUc7QUFDM0IsUUFBSSxNQUFNLFFBQVEsTUFBTSxPQUFXLFFBQU87QUFDMUMsVUFBTSxNQUFNLE9BQU8sQ0FBQztBQUNwQixRQUFJLFFBQVEsR0FBSSxRQUFPO0FBRXZCLFFBQUksV0FBVyxL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
