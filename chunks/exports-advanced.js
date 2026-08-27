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
    try {
      await window.loadJSZip();
    } catch (e) {
      alert("No se pudo cargar JSZip: " + e.message);
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL3B1cmUvY3N2LXNlcmlhbGl6ZXIuanMiLCAiLi4vc3JjL2RvbWFpbnMvZXhwb3J0cy1hZHZhbmNlZC5qcyJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiLy8gQHRzLWNoZWNrXG4vKipcbiAqIENTViBzZXJpYWxpemVyICsgZGF0YXNldCBzY2hlbWFzICsgcm93IGJ1aWxkZXJzIFx1MjAxNCBwYXJhIGV4cG9ydERhdGFzZXRaaXBcbiAqICh2MzcxKykuIEZ1bmNpb25lcyBwdXJhcywgdGVzdGVhYmxlcyBzaW4gZ2xvYmFscyBkZWwgYnVuZGxlLlxuICpcbiAqIDUgY2Fzb3MgZGUgdXNvIE1MIGRvY3VtZW50YWRvcyBlbiBEQVRBU0VUX1VTRV9DQVNFX01BVFJJWDpcbiAqICAgQSkgQ29udmVyc2lvbiB2aXNpdGEtPnBlZGlkbyAocHJpb3JpZGFkIDEsIGNsYXNpZmljYWNpb24pXG4gKiAgIEIpIFJpZXNnbyBkZSBjaHVybiBkZSBjbGllbnRlcyAocHJpb3JpZGFkIDIsIGFsZXJ0YSlcbiAqICAgQykgRm9yZWNhc3QgZGUgZGVtYW5kYSBwb3IgU0tVIChwcmlvcmlkYWQgMywgc2VyaWVzIHRlbXBvcmFsZXMpXG4gKiAgIEQpIEFub21hbGlhcyBlbiByZW5kaWNpb25lcyAoZXhwbG9yYXRvcmlvKVxuICogICBFKSBFc3RhY2lvbmFsaWRhZCBwb3Igem9uYS9jYW1wYW5hIChleHBsb3JhdG9yaW8pXG4gKlxuICogQ29udmVuY2lvbmVzIChSRkMgNDE4MCArIGFkYXB0YWNpb25lcyBwYXJhIE1MIHBpcGVsaW5lcyk6XG4gKiAgIC0gU2VwYXJhdG9yOiBcIixcIlxuICogICAtIFF1b3RlIGNoYXI6IFwiXFxcIlwiXG4gKiAgIC0gRXNjYXBlIHF1b3RlOiBcIlxcXCJcXFwiXCJcbiAqICAgLSBMaW5lIHRlcm1pbmF0b3I6IFwiXFxyXFxuXCJcbiAqICAgLSBFbmNvZGluZzogVVRGLTggKEJPTSBvcGNpb25hbCBhbCBlc2NyaWJpciBlbCBaSVApXG4gKiAgIC0gRmVjaGFzOiBJU08gODYwMSBVVEMgKGNvbiBcIlpcIiBhbCBmaW5hbClcbiAqICAgLSBEZWNpbWFsZXM6IHB1bnRvIChcIi5cIilcbiAqICAgLSBOdWxsL3VuZGVmaW5lZDogY2FtcG8gdmFjaW8gKE5PIFwiTi9BXCIsIFwiLVwiLCBcIm51bGxcIilcbiAqICAgLSBBcnJheXMgLT4gSlNPTi5zdHJpbmdpZnkgZW50cmUgY29taWxsYXMgZG9ibGVzXG4gKiAgIC0gT2JqZXRvcyAoZXhjZXB0byBUaW1lc3RhbXAgeSBEYXRlKSAtPiBKU09OLnN0cmluZ2lmeVxuICogICAtIEZpcmVzdG9yZSBUaW1lc3RhbXBzIC0+IHRvRGF0ZSgpLnRvSVNPU3RyaW5nKClcbiAqL1xuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIEhlbHBlcnMgQ1NWIHB1cm9zXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuLyoqXG4gKiBFc2NhcGEgdW4gdmFsb3Igc3RyaW5nIHBhcmEgQ1NWIFJGQyA0MTgwLiBXcmFwcGVhIGNvbiBcIi4uLlwiIHNpIGNvbnRpZW5lXG4gKiBcIixcIiwgXCJcXFwiXCIsIFwiXFxyXCIgbyBcIlxcblwiLiBFc2NhcGEgXCJcXFwiXCIgLT4gXCJcXFwiXFxcIlwiLlxuICogQHBhcmFtIHtzdHJpbmd9IHNcbiAqIEByZXR1cm5zIHtzdHJpbmd9XG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjc3ZFc2NhcGUocykge1xuICBpZiAocyA9PT0gbnVsbCB8fCBzID09PSB1bmRlZmluZWQpIHJldHVybiAnJztcbiAgY29uc3Qgc3RyID0gU3RyaW5nKHMpO1xuICBpZiAoc3RyID09PSAnJykgcmV0dXJuICcnO1xuICAvLyBOZWNlc2l0YSBxdW90aW5nIHNpIHRpZW5lIGNvbWEsIHF1b3RlLCBvIGxpbmUtYnJlYWtcbiAgaWYgKC9bXCIsXFxyXFxuXS8udGVzdChzdHIpKSB7XG4gICAgcmV0dXJuICdcIicgKyBzdHIucmVwbGFjZSgvXCIvZywgJ1wiXCInKSArICdcIic7XG4gIH1cbiAgcmV0dXJuIHN0cjtcbn1cblxuLyoqXG4gKiBDb252aWVydGUgdW4gYXJyYXkgZGUgdmFsb3JlcyBlbiB1bmEgbGluZWEgQ1NWIChzaW4gdHJhaWxpbmcgbmV3bGluZSkuXG4gKiBBcGxpY2EgY3N2RXNjYXBlIGEgY2FkYSBjYW1wbyBkZXNwdWVzIGRlIGZpcmVzdG9yZVZhbHVlVG9Dc3YuXG4gKiBAcGFyYW0ge3Vua25vd25bXX0gZmllbGRzXG4gKiBAcmV0dXJucyB7c3RyaW5nfVxuICovXG5leHBvcnQgZnVuY3Rpb24gY3N2Um93KGZpZWxkcykge1xuICByZXR1cm4gZmllbGRzLm1hcCgoZikgPT4gY3N2RXNjYXBlKGZpcmVzdG9yZVZhbHVlVG9Dc3YoZikpKS5qb2luKCcsJyk7XG59XG5cbi8qKlxuICogQ29udmllcnRlIHVuIHZhbG9yIGRlIEZpcmVzdG9yZS9KUyBhIHN0cmluZyBhcHRvIHBhcmEgQ1NWLlxuICogUmVnbGEgcG9yIHRpcG86XG4gKiAgIC0gbnVsbCAvIHVuZGVmaW5lZCAtPiAnJ1xuICogICAtIEZpcmVzdG9yZSBUaW1lc3RhbXAgKHRpZW5lIC50b0RhdGUpIC0+IElTTyA4NjAxIFVUQ1xuICogICAtIERhdGUgLT4gSVNPIDg2MDEgVVRDXG4gKiAgIC0gYm9vbGVhbiAtPiAndHJ1ZScgLyAnZmFsc2UnXG4gKiAgIC0gbnVtYmVyIC0+IFN0cmluZyhuKSBjb24gcHVudG8gZGVjaW1hbFxuICogICAtIHN0cmluZyAtPiB0YWwgY3VhbCAoY3N2RXNjYXBlIHdyYXBwZWEgc2kgaGFjZSBmYWx0YSlcbiAqICAgLSBBcnJheSAtPiBKU09OLnN0cmluZ2lmeVxuICogICAtIE9iamVjdCAtPiBKU09OLnN0cmluZ2lmeVxuICogQHBhcmFtIHt1bmtub3dufSB2XG4gKiBAcmV0dXJucyB7c3RyaW5nfVxuICovXG5leHBvcnQgZnVuY3Rpb24gZmlyZXN0b3JlVmFsdWVUb0Nzdih2KSB7XG4gIGlmICh2ID09PSBudWxsIHx8IHYgPT09IHVuZGVmaW5lZCkgcmV0dXJuICcnO1xuICBpZiAodHlwZW9mIHYgPT09ICdzdHJpbmcnKSByZXR1cm4gdjtcbiAgaWYgKHR5cGVvZiB2ID09PSAnbnVtYmVyJykge1xuICAgIGlmICghTnVtYmVyLmlzRmluaXRlKHYpKSByZXR1cm4gJyc7IC8vIE5hTiwgSW5maW5pdHkgLT4gdmFjaW8gKG5vIGNvbmZ1bmRpciBwaXBlbGluZXMpXG4gICAgcmV0dXJuIFN0cmluZyh2KTtcbiAgfVxuICBpZiAodHlwZW9mIHYgPT09ICdib29sZWFuJykgcmV0dXJuIHYgPyAndHJ1ZScgOiAnZmFsc2UnO1xuICAvLyBGaXJlc3RvcmUgVGltZXN0YW1wXG4gIGlmIChcbiAgICB0eXBlb2YgdiA9PT0gJ29iamVjdCcgJiZcbiAgICB2ICE9PSBudWxsICYmXG4gICAgdHlwZW9mICgvKiogQHR5cGUge2FueX0gKi8gKHYpLnRvRGF0ZSkgPT09ICdmdW5jdGlvbidcbiAgKSB7XG4gICAgdHJ5IHtcbiAgICAgIHJldHVybiAvKiogQHR5cGUge2FueX0gKi8gKHYpLnRvRGF0ZSgpLnRvSVNPU3RyaW5nKCk7XG4gICAgfSBjYXRjaCAoXykge1xuICAgICAgcmV0dXJuICcnO1xuICAgIH1cbiAgfVxuICBpZiAodiBpbnN0YW5jZW9mIERhdGUpIHtcbiAgICBpZiAoTnVtYmVyLmlzTmFOKHYuZ2V0VGltZSgpKSkgcmV0dXJuICcnO1xuICAgIHJldHVybiB2LnRvSVNPU3RyaW5nKCk7XG4gIH1cbiAgaWYgKEFycmF5LmlzQXJyYXkodikpIHtcbiAgICAvLyBKU09OLnN0cmluZ2lmeSBkZSBhcnJheS4gY3N2RXNjYXBlIGx1ZWdvIGxvIHdyYXBwZWEgc2kgaGF5IGNvbWFzLlxuICAgIHRyeSB7XG4gICAgICByZXR1cm4gSlNPTi5zdHJpbmdpZnkodik7XG4gICAgfSBjYXRjaCAoXykge1xuICAgICAgcmV0dXJuICcnO1xuICAgIH1cbiAgfVxuICBpZiAodHlwZW9mIHYgPT09ICdvYmplY3QnKSB7XG4gICAgdHJ5IHtcbiAgICAgIHJldHVybiBKU09OLnN0cmluZ2lmeSh2KTtcbiAgICB9IGNhdGNoIChfKSB7XG4gICAgICByZXR1cm4gJyc7XG4gICAgfVxuICB9XG4gIHJldHVybiBTdHJpbmcodik7XG59XG5cbi8qKlxuICogT2J0aWVuZSBlbCB2YWxvciBkZSB1biBwYXRoIGRvdC1ub3RhdGlvbiBlbiB1biBvYmpldG8gYW5pZGFkby5cbiAqIEVqOiBnZXRQYXRoKHthOiB7Yjoge2M6IDF9fX0sICdhLmIuYycpIC0+IDFcbiAqIGdldFBhdGgoe30sICdhLmInKSAtPiB1bmRlZmluZWRcbiAqIEBwYXJhbSB7b2JqZWN0fSBvYmpcbiAqIEBwYXJhbSB7c3RyaW5nfSBwYXRoXG4gKiBAcmV0dXJucyB7dW5rbm93bn1cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGdldFBhdGgob2JqLCBwYXRoKSB7XG4gIGlmICghb2JqIHx8ICFwYXRoKSByZXR1cm4gdW5kZWZpbmVkO1xuICBjb25zdCBwYXJ0cyA9IHBhdGguc3BsaXQoJy4nKTtcbiAgbGV0IGN1ciA9IC8qKiBAdHlwZSB7YW55fSAqLyAob2JqKTtcbiAgZm9yIChjb25zdCBwIG9mIHBhcnRzKSB7XG4gICAgaWYgKGN1ciA9PT0gbnVsbCB8fCBjdXIgPT09IHVuZGVmaW5lZCkgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICBjdXIgPSBjdXJbcF07XG4gIH1cbiAgcmV0dXJuIGN1cjtcbn1cblxuLyoqXG4gKiBDb25zdHJ1eWUgZWwgQ1NWIGNvbXBsZXRvIChoZWFkZXIgKyBOIHJvd3MpIHBhcmEgdW5hIGNvbGVjY2lvbiBzZWd1blxuICogc3Ugc2NoZW1hLiBDYWRhIGJ1aWxkZXIgZGV2dWVsdmUgdW4gYXJyYXkgZGUgZmlsYXMgKGNhZGEgZmlsYSA9IGFycmF5XG4gKiBkZSB2YWxvcmVzIGVuIGVsIG9yZGVuIGRlbCBzY2hlbWEpLlxuICogQHBhcmFtIHt7Y29sdW1uczoge2NvbDogc3RyaW5nfVtdfX0gc2NoZW1hXG4gKiBAcGFyYW0ge3Vua25vd25bXVtdfSByb3dzXG4gKiBAcmV0dXJucyB7c3RyaW5nfSBDU1YgY29tcGxldG8gY29uIFxcclxcbiBjb21vIGxpbmUgc2VwYXJhdG9yXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBidWlsZENzdihzY2hlbWEsIHJvd3MpIHtcbiAgY29uc3QgaGVhZGVyID0gc2NoZW1hLmNvbHVtbnMubWFwKChjKSA9PiBjc3ZFc2NhcGUoYy5jb2wpKS5qb2luKCcsJyk7XG4gIGNvbnN0IGJvZHkgPSByb3dzLm1hcCgocikgPT4gY3N2Um93KHIpKS5qb2luKCdcXHJcXG4nKTtcbiAgcmV0dXJuIGJvZHkubGVuZ3RoID8gaGVhZGVyICsgJ1xcclxcbicgKyBib2R5ICsgJ1xcclxcbicgOiBoZWFkZXIgKyAnXFxyXFxuJztcbn1cblxuLyoqXG4gKiBDdWVudGEgbnVsbCByYXRlIHBvciBjb2x1bW5hIHJlcXVlcmlkYS4gUmV0b3JuYVxuICoge2NvbE5hbWU6IHJhdGUgMC4uMX0uIFVuIHZhbG9yIGVzIFwibnVsbFwiIHNpIGZpcmVzdG9yZVZhbHVlVG9Dc3YgZGV2dWVsdmUgJycuXG4gKiBAcGFyYW0ge3tjb2x1bW5zOiB7Y29sOiBzdHJpbmd9W119fSBzY2hlbWFcbiAqIEBwYXJhbSB7dW5rbm93bltdW119IHJvd3NcbiAqIEBwYXJhbSB7c3RyaW5nW119IHJlcXVpcmVkQ29sc1xuICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIG51bWJlcj59XG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjb21wdXRlTnVsbFJhdGVzKHNjaGVtYSwgcm93cywgcmVxdWlyZWRDb2xzKSB7XG4gIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgbnVtYmVyPn0gKi9cbiAgY29uc3QgcmVzdWx0ID0ge307XG4gIGlmICghcm93cy5sZW5ndGgpIHtcbiAgICAvLyBzaW4gZGF0b3M6IG51bGwgcmF0ZSA9IDEgKDEwMCUgZmFsdGEpIHBhcmEgY2FkYSBjYW1wbyByZXF1ZXJpZG9cbiAgICBmb3IgKGNvbnN0IGMgb2YgcmVxdWlyZWRDb2xzKSByZXN1bHRbY10gPSAxO1xuICAgIHJldHVybiByZXN1bHQ7XG4gIH1cbiAgY29uc3QgY29sSW5kZXggPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIG51bWJlcj59ICovICh7fSk7XG4gIHNjaGVtYS5jb2x1bW5zLmZvckVhY2goKGMsIGkpID0+IHtcbiAgICBjb2xJbmRleFtjLmNvbF0gPSBpO1xuICB9KTtcbiAgZm9yIChjb25zdCByYyBvZiByZXF1aXJlZENvbHMpIHtcbiAgICBjb25zdCBpZHggPSBjb2xJbmRleFtyY107XG4gICAgaWYgKGlkeCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICByZXN1bHRbcmNdID0gMTsgLy8gY29sdW1uYSBubyBleGlzdGUgZW4gc2NoZW1hIC0+IGNvbnNpZGVyYXIgY29tbyAxMDAlIG51bGxcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBsZXQgbnVsbHMgPSAwO1xuICAgIGZvciAoY29uc3Qgcm93IG9mIHJvd3MpIHtcbiAgICAgIGNvbnN0IHYgPSByb3dbaWR4XTtcbiAgICAgIGlmIChmaXJlc3RvcmVWYWx1ZVRvQ3N2KHYpID09PSAnJykgbnVsbHMrKztcbiAgICB9XG4gICAgcmVzdWx0W3JjXSA9IE1hdGgucm91bmQoKG51bGxzIC8gcm93cy5sZW5ndGgpICogMTAwMDApIC8gMTAwMDA7XG4gIH1cbiAgcmV0dXJuIHJlc3VsdDtcbn1cblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBEQVRBU0VUX1NDSEVNQVMgXHUyMDE0IDExIGNvbGVjY2lvbmVzIGNvbiBjb2x1bW5hcyArIHRpcG9zICsgZGVzY3JpcGNpb25lc1xuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbi8qKiBAdHlwZWRlZiB7e2NvbDogc3RyaW5nLCB0eXBlOiBzdHJpbmcsIGRlc2M6IHN0cmluZ319IFNjaGVtYUNvbHVtbiAqL1xuLyoqIEB0eXBlZGVmIHt7bmFtZTogc3RyaW5nLCBzb3VyY2U6ICdmaXJlc3RvcmUnfCdzdG9ja19qc29uJywgY29sbGVjdGlvbj86IHN0cmluZywgcm93TW9kZTogc3RyaW5nLCBjb2x1bW5zOiBTY2hlbWFDb2x1bW5bXX19IERhdGFzZXRTY2hlbWEgKi9cblxuLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBEYXRhc2V0U2NoZW1hPn0gKi9cbmV4cG9ydCBjb25zdCBEQVRBU0VUX1NDSEVNQVMgPSB7XG4gIHBlZGlkb3M6IHtcbiAgICBuYW1lOiAncGVkaWRvcy5jc3YnLFxuICAgIHNvdXJjZTogJ2ZpcmVzdG9yZScsXG4gICAgY29sbGVjdGlvbjogJ3BlZGlkb3MnLFxuICAgIHJvd01vZGU6ICdmbGF0dGVuX2xpbmVzJywgLy8gMSBmaWxhIHBvciAocGVkaWRvLCBsaW5lYSlcbiAgICBjb2x1bW5zOiBbXG4gICAgICB7IGNvbDogJ3BlZGlkb19pZCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnRmlyZXN0b3JlIGRvYyBJRCcgfSxcbiAgICAgIHsgY29sOiAnb3duZXJfdWlkJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdVSUQgZGVsIHZlbmRlZG9yIGR1ZW5pbyBkZWwgcGVkaWRvJyB9LFxuICAgICAgeyBjb2w6ICdvd25lcl9lbWFpbCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnZW1haWwgZGVsIHZlbmRlZG9yJyB9LFxuICAgICAgeyBjb2w6ICdjcmVhdGVkX2J5X3VpZCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAncXVpZW4gY2FyZ28gKFZESSBwdWVkZSBjYXJnYXIgcG9yIFZERSknIH0sXG4gICAgICB7IGNvbDogJ29uX2JlaGFsZl9vZicsIHR5cGU6ICdib29sZWFuJywgZGVzYzogJ3RydWUgc2kgVkRJIGNhcmdvIHBvciBWREUnIH0sXG4gICAgICB7IGNvbDogJ2tleScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnY2xhdmUgY29tcHVlc3RhIHRpcG98cHJvdnxsb2N8Y2xpZW50ZScgfSxcbiAgICAgIHsgY29sOiAnc3RhZ2UnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ3BlbmRpbmcgfCBjb25maXJtZWQgfCBzYXBfaW1wb3J0ZWQnIH0sXG4gICAgICB7IGNvbDogJ3RpcG8nLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ0M9Y2xpZW50ZSB8IFA9cHJvc3BlY3RvJyB9LFxuICAgICAgeyBjb2w6ICdwcm92aW5jZScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAncHJvdmluY2lhJyB9LFxuICAgICAgeyBjb2w6ICdsb2NfbmFtZScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnbG9jYWxpZGFkJyB9LFxuICAgICAgeyBjb2w6ICdjbGllbnRfbmFtZScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnbm9tYnJlIGNsaWVudGUnIH0sXG4gICAgICB7IGNvbDogJ21vbnRoJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdlaiBcIkp1bGlvIDIwMjZcIicgfSxcbiAgICAgIHsgY29sOiAnbW9udGhfaWR4JywgdHlwZTogJ2ludCcsIGRlc2M6ICcwLTExJyB9LFxuICAgICAgeyBjb2w6ICd5ZWFyJywgdHlwZTogJ2ludCcsIGRlc2M6ICdhbm8nIH0sXG4gICAgICB7IGNvbDogJ2NvbmZpcm1lZF9hdCcsIHR5cGU6ICdpc284NjAxJywgZGVzYzogJ3RpbWVzdGFtcCBVVEMgZGUgY29uZmlybWFjaW9uJyB9LFxuICAgICAgeyBjb2w6ICdjb25kaWNpb25fcGFnbycsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnZWogQ1RBIENURScgfSxcbiAgICAgIHsgY29sOiAnZm9ybWFfZW50cmVnYV90aXBvJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdUUkFOU1BPUlRJU1RBIHwgU1VDVVJTQUwnIH0sXG4gICAgICB7IGNvbDogJ2Zvcm1hX2VudHJlZ2FfdHJhbnNwX25vbWJyZScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJyB9LFxuICAgICAgeyBjb2w6ICdmb3JtYV9lbnRyZWdhX3RyYW5zcF9kaXJlY2Npb24nLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcbiAgICAgIHsgY29sOiAnZm9ybWFfZW50cmVnYV9jbGllbnRlX2RpcmVjY2lvbicsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnZGVzdGlubyBmaW5hbCcgfSxcbiAgICAgIHsgY29sOiAnZm9ybWFfZW50cmVnYV9zdWN1cnNhbF9kaXJlY2Npb24nLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcbiAgICAgIHtcbiAgICAgICAgY29sOiAnZGlzY291bnRfcGN0JyxcbiAgICAgICAgdHlwZTogJ251bWJlcicsXG4gICAgICAgIGRlc2M6ICdkZXNjdWVudG8gdG90YWwgZGVsIHBlZGlkbyAoYXBsaWNhZG8gYSBuaXZlbCBoZWFkZXIsIHByb3JyYXRlYXIgZW4gcGlwZWxpbmUpJyxcbiAgICAgIH0sXG4gICAgICB7IGNvbDogJ3N1YnRvdGFsX2FycycsIHR5cGU6ICdudW1iZXInLCBkZXNjOiAnc3VidG90YWwgYnJ1dG8gQVJTJyB9LFxuICAgICAgeyBjb2w6ICduZXRfYW1vdW50X2FycycsIHR5cGU6ICdudW1iZXInLCBkZXNjOiAnbmV0byBBUlMgcG9zdC1kZXNjdWVudG8nIH0sXG4gICAgICB7IGNvbDogJ3RyYW5zZmVyaWRvX3NhcF92aWEnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ2R0d19tYW51YWwgfCBzZXJ2aWNlX2xheWVyJyB9LFxuICAgICAgeyBjb2w6ICd0cmFuc2Zlcmlkb19zYXBfZG9jX251bScsIHR5cGU6ICdpbnQnLCBkZXNjOiAnbnVtZXJvIGRlIFF1b3RhdGlvbiBTQVAnIH0sXG4gICAgICB7IGNvbDogJ3RyYW5zZmVyaWRvX3NhcF9kb2NfZW50cnknLCB0eXBlOiAnaW50JywgZGVzYzogJ2RvYyBlbnRyeSBpbnRlcm5vIFNBUCcgfSxcbiAgICAgIHsgY29sOiAndHJhbnNmZXJpZG9fc2FwX2F0JywgdHlwZTogJ2lzbzg2MDEnLCBkZXNjOiAndGltZXN0YW1wIFVUQycgfSxcbiAgICAgIHsgY29sOiAnY3JlYXRlZF9hdCcsIHR5cGU6ICdpc284NjAxJywgZGVzYzogJ3RpbWVzdGFtcCBVVEMnIH0sXG4gICAgICB7IGNvbDogJ2xpbmVfaW5kZXgnLCB0eXBlOiAnaW50JywgZGVzYzogJ2luZGljZSBkZSBsaW5lYSAwLWJhc2VkJyB9LFxuICAgICAgeyBjb2w6ICdsaW5lX2NvZGUnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ1NLVScgfSxcbiAgICAgIHsgY29sOiAnbGluZV9kZXNjJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdkZXNjcmlwY2lvbiBwcm9kdWN0bycgfSxcbiAgICAgIHsgY29sOiAnbGluZV9xdHknLCB0eXBlOiAnbnVtYmVyJywgZGVzYzogJ2NhbnRpZGFkJyB9LFxuICAgICAgeyBjb2w6ICdsaW5lX3ByZWNpbycsIHR5cGU6ICdudW1iZXInLCBkZXNjOiAncHJlY2lvIHVuaXRhcmlvIEFSUycgfSxcbiAgICAgIHsgY29sOiAnbGluZV9jYXQnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ2NhdGVnb3JpYScgfSxcbiAgICAgIHsgY29sOiAnbGluZV9mYW0nLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ2ZhbWlsaWEnIH0sXG4gICAgICB7IGNvbDogJ2xpbmVfc3ViJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdzdWJmYW1pbGlhJyB9LFxuICAgIF0sXG4gIH0sXG4gIHZpc2l0YXM6IHtcbiAgICBuYW1lOiAndmlzaXRhcy5jc3YnLFxuICAgIHNvdXJjZTogJ2ZpcmVzdG9yZScsXG4gICAgY29sbGVjdGlvbjogJ3Zpc2l0cycsXG4gICAgcm93TW9kZTogJ29uZV9wZXJfZG9jJyxcbiAgICBjb2x1bW5zOiBbXG4gICAgICB7IGNvbDogJ3Zpc2l0X2lkJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdGaXJlc3RvcmUgZG9jIElEJyB9LFxuICAgICAgeyBjb2w6ICdvd25lcl91aWQnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ1VJRCBkZWwgdmVuZGVkb3InIH0sXG4gICAgICB7IGNvbDogJ293bmVyX2VtYWlsJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdlbWFpbCBkZWwgdmVuZGVkb3InIH0sXG4gICAgICB7IGNvbDogJ2ZlY2hhJywgdHlwZTogJ2lzbzg2MDEnLCBkZXNjOiAnWVlZWS1NTS1ERCAoZmVjaGEgZGUgdmlzaXRhLCBubyBVVEMpJyB9LFxuICAgICAgeyBjb2w6ICdtZXMnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ0pVTklPLCBKVUxJTywgZXRjLicgfSxcbiAgICAgIHsgY29sOiAnYW5pbycsIHR5cGU6ICdpbnQnLCBkZXNjOiAnYW5vJyB9LFxuICAgICAgeyBjb2w6ICd2ZW5kb3InLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ25vbWJyZSBjYW5vbmljbyB2ZW5kZWRvcicgfSxcbiAgICAgIHsgY29sOiAncHJvdmluY2lhJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdwcm92aW5jaWEnIH0sXG4gICAgICB7IGNvbDogJ2xvY2FsaWRhZCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnbG9jYWxpZGFkJyB9LFxuICAgICAgeyBjb2w6ICd0aWVuZGEnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ25vbWJyZSB0aWVuZGEnIH0sXG4gICAgICB7IGNvbDogJ3RpcG8nLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ0MgfCBQJyB9LFxuICAgICAgeyBjb2w6ICdsb2NhbCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnZWogUHJvcGlvLCBBbHF1aWxhZG8nIH0sXG4gICAgICB7IGNvbDogJ3RhbWFubycsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnZWogQ2hpY28sIE1lZGlhbm8sIEdyYW5kZScgfSxcbiAgICAgIHsgY29sOiAnZmlkZWxpZGFkJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdBbHRhLCBNZWRpYSwgQmFqYScgfSxcbiAgICAgIHsgY29sOiAncmVsZXZhbmNpYScsIHR5cGU6ICdpbnQnLCBkZXNjOiAnMC01JyB9LFxuICAgICAgeyBjb2w6ICdwb3AnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ2VqIFN0aWNrZXJzIFNoaW1hbm8nIH0sXG4gICAgICB7IGNvbDogJ25lY2VzaWRhZF9wdW50dWFsJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXG4gICAgICB7IGNvbDogJ3RpcG9fdmVudGEnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ2VqIENhc2EgZGUgcGVzY2EgKyBlY29tbWVyY2UnIH0sXG4gICAgICB7IGNvbDogJ3BvbmRlcmFjaW9uX21vc3RyYWRvJywgdHlwZTogJ2ludCcsIGRlc2M6ICcwLTEwMCcgfSxcbiAgICAgIHsgY29sOiAncG9uZGVyYWNpb25fZWNvbW1lcmNlJywgdHlwZTogJ2ludCcsIGRlc2M6ICcwLTEwMCcgfSxcbiAgICAgIHsgY29sOiAnY29tcGV0ZW5jaWEnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcbiAgICAgIHsgY29sOiAnb3BvcnR1bmlkYWQnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcbiAgICAgIHsgY29sOiAnbWFzX3ZlbmRpZG8nLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcbiAgICAgIHsgY29sOiAnbWFzX3ByZWd1bnRhbicsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJyB9LFxuICAgICAgeyBjb2w6ICdheXVkYV90aWVuZGEnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcbiAgICAgIHsgY29sOiAnZ3BzX3N0YXR1cycsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnb2sgfCBvdXRzaWRlIHwgbm9sb2MnIH0sXG4gICAgICB7IGNvbDogJ2dwc19kaXN0YW5jZV9tJywgdHlwZTogJ251bWJlcicsIGRlc2M6ICdtZXRyb3MnIH0sXG4gICAgICB7IGNvbDogJ2ludGVyYWN0aW9uX3R5cGUnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ3Zpc2l0YSB8IGNvbnRhY3RvJyB9LFxuICAgICAge1xuICAgICAgICBjb2w6ICdmb3JtYV9jb250YWN0bycsXG4gICAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgICBkZXNjOiAnTExBTUFEQSBURUxFRk9OSUNBIHwgTUVOU0FKRSBERSBXSEFUU0FQUCB8IE1FTlNBSkUgU01TIChzaSBjb250YWN0byknLFxuICAgICAgfSxcbiAgICAgIHtcbiAgICAgICAgY29sOiAnY29udGFjdG9fcmVzdWx0YWRvJyxcbiAgICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICAgIGRlc2M6ICdyZXNwb25kaW8gfCBub19yZXNwb25kaW8gfCB2YWNpbyAoc2luIG1hcmNhciwgc29sbyBhcGxpY2EgYSBjb250YWN0byknLFxuICAgICAgfSxcbiAgICAgIHsgY29sOiAnY29udGFjdG9fcmVzdWx0YWRvX2F0JywgdHlwZTogJ2lzbzg2MDEnLCBkZXNjOiAndGltZXN0YW1wIFVUQycgfSxcbiAgICAgIHsgY29sOiAnY29udGFjdG9fcmVzdWx0YWRvX2J5JywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdVSUQgZGUgcXVpZW4gbWFyY28nIH0sXG4gICAgICB7IGNvbDogJ2NyZWF0ZWRfYXQnLCB0eXBlOiAnaXNvODYwMScsIGRlc2M6ICd0aW1lc3RhbXAgVVRDJyB9LFxuICAgIF0sXG4gIH0sXG4gIGNsaWVudGVzOiB7XG4gICAgbmFtZTogJ2NsaWVudGVzLmNzdicsXG4gICAgc291cmNlOiAnZmlyZXN0b3JlJyxcbiAgICBjb2xsZWN0aW9uOiAnY2xpZW50X2FwcGxpY2F0aW9ucycsXG4gICAgcm93TW9kZTogJ29uZV9wZXJfZG9jJyxcbiAgICBjb2x1bW5zOiBbXG4gICAgICB7IGNvbDogJ2FwcF9pZCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnRmlyZXN0b3JlIGRvYyBJRCcgfSxcbiAgICAgIHsgY29sOiAnb3duZXJfdWlkJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXG4gICAgICB7IGNvbDogJ293bmVyX2VtYWlsJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXG4gICAgICB7IGNvbDogJ293bmVyX25hbWUnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcbiAgICAgIHsgY29sOiAnY29tZXJjaW8nLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ3Jhem9uIHNvY2lhbCcgfSxcbiAgICAgIHsgY29sOiAnZmFudGFzaWEnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ25vbWJyZSBjb21lcmNpYWwnIH0sXG4gICAgICB7IGNvbDogJ2N1aXQnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ3NvbG8gZGlnaXRvcyBwb3N0LXYyOTQnIH0sXG4gICAgICB7IGNvbDogJ2NvbmRpY2lvbl9maXNjYWwnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcbiAgICAgIHsgY29sOiAnY2FsbGUnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcbiAgICAgIHsgY29sOiAnbnVtZXJvJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXG4gICAgICB7IGNvbDogJ2xvY2FsaWRhZCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJyB9LFxuICAgICAgeyBjb2w6ICdwcm92aW5jaWEnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcbiAgICAgIHsgY29sOiAnbG9jYWxpZGFkX2ZpbmFsJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdvdmVycmlkZSBkZWwgYXByb2JhZG9yJyB9LFxuICAgICAgeyBjb2w6ICdjYXJkX2NvZGVfc2FwJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdDYXJkQ29kZSBTQVAnIH0sXG4gICAgICB7IGNvbDogJ2Fzc2lnbmVkX3ZlbmRvcicsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAndmVuZGVkb3IgYXNpZ25hZG8gKHNvdXJjZSBvZiB0cnV0aCB2MzExKyknIH0sXG4gICAgICB7IGNvbDogJ3N0YXR1cycsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAncGVuZGluZ19hcHByb3ZhbCB8IGFwcHJvdmVkIHwgcmVqZWN0ZWQnIH0sXG4gICAgICB7XG4gICAgICAgIGNvbDogJ3NvdXJjZScsXG4gICAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgICBkZXNjOiAnbWFudWFsIHwgc2FwX2J1bGtfaW1wb3J0IHwgYWx0YV9yYXBpZGEgfCBzYXBfc3luYyB8IHNhcF9zeW5jX21hbnVhbF9saW5rJyxcbiAgICAgIH0sXG4gICAgICB7XG4gICAgICAgIGNvbDogJ21hbnVhbF9zYXBfcGVuZGluZycsXG4gICAgICAgIHR5cGU6ICdib29sZWFuJyxcbiAgICAgICAgZGVzYzogJ3RydWU9cHJvdmlzb3JpbyAoQWx0YSBSYXBpZGEgc2luIENhcmRDb2RlKScsXG4gICAgICB9LFxuICAgICAgeyBjb2w6ICdwcmVjYXVjaW9uJywgdHlwZTogJ2Jvb2xlYW4nLCBkZXNjOiAndHJ1ZT1jbGllbnRlIG1hcmNhZG8gcG9yIGltcGFnbycgfSxcbiAgICAgIHsgY29sOiAnY2F0ZWdvcmlhX2NsaWVudGUnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ1AvQS9CL0MnIH0sXG4gICAgICB7IGNvbDogJ2NsaV90aXBvJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdDIGRlZmF1bHQgcG9zdC12MzQ5JyB9LFxuICAgICAgeyBjb2w6ICdsYXQnLCB0eXBlOiAnbnVtYmVyJywgZGVzYzogJ2dlb2xhdCcgfSxcbiAgICAgIHsgY29sOiAnbG5nJywgdHlwZTogJ251bWJlcicsIGRlc2M6ICdnZW9sbmcnIH0sXG4gICAgICB7IGNvbDogJ2hhc19nZW8nLCB0eXBlOiAnYm9vbGVhbicsIGRlc2M6ICdsYXQvbG5nIG5vIG51bGwnIH0sXG4gICAgICB7IGNvbDogJ2hhc19hZGRyZXNzJywgdHlwZTogJ2Jvb2xlYW4nLCBkZXNjOiAnY2FsbGUgbm8gdmFjaWEnIH0sXG4gICAgICB7IGNvbDogJ3N1Ym1pdHRlZF9ieV9wdWJsaWNfZm9ybScsIHR5cGU6ICdib29sZWFuJywgZGVzYzogJ3ZpYSBhbHRhLWNsaWVudGUuaHRtbCcgfSxcbiAgICAgIHsgY29sOiAnYXBwcm92ZWRfYXQnLCB0eXBlOiAnaXNvODYwMScsIGRlc2M6ICcnIH0sXG4gICAgICB7IGNvbDogJ2NyZWF0ZWRfYXQnLCB0eXBlOiAnaXNvODYwMScsIGRlc2M6ICcnIH0sXG4gICAgICB7IGNvbDogJ3VwZGF0ZWRfYXQnLCB0eXBlOiAnaXNvODYwMScsIGRlc2M6ICcnIH0sXG4gICAgXSxcbiAgfSxcbiAgY2xpZW50X21hc3Rlcjoge1xuICAgIG5hbWU6ICdjbGllbnRfbWFzdGVyLmNzdicsXG4gICAgc291cmNlOiAnZmlyZXN0b3JlJyxcbiAgICBjb2xsZWN0aW9uOiAnY2xpZW50X21hc3RlcicsXG4gICAgcm93TW9kZTogJ29uZV9wZXJfZG9jJyxcbiAgICBjb2x1bW5zOiBbXG4gICAgICB7IGNvbDogJ21hc3Rlcl9pZCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnRmlyZXN0b3JlIGRvYyBJRCcgfSxcbiAgICAgIHsgY29sOiAnY2xpZW50X25hbWUnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcbiAgICAgIHsgY29sOiAncHJvdmluY2lhJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXG4gICAgICB7IGNvbDogJ2xvY2FsaWRhZCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJyB9LFxuICAgICAgeyBjb2w6ICd2ZW5kb3InLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ3ZlbmRlZG9yIGN1cmFkbyBhZG1pbicgfSxcbiAgICAgIHsgY29sOiAnYWRkcmVzcycsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnZGlyZWNjaW9uIGN1cmFkYSBhZG1pbicgfSxcbiAgICAgIHsgY29sOiAnc2FwX2NhcmRfY29kZScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnQ2FyZENvZGUgU0FQJyB9LFxuICAgICAgeyBjb2w6ICdzYXBfYWRkcmVzcycsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnZGlyZWNjaW9uIHJhdyBTQVAnIH0sXG4gICAgICB7IGNvbDogJ3NhcF9jaXR5JywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXG4gICAgICB7IGNvbDogJ3NhcF9zdGF0ZScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJyB9LFxuICAgICAgeyBjb2w6ICdzYXBfaW1wb3J0ZWRfYXQnLCB0eXBlOiAnaXNvODYwMScsIGRlc2M6ICcnIH0sXG4gICAgICB7IGNvbDogJ3NhcF9pbXBvcnRlZF9ieScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJyB9LFxuICAgICAgeyBjb2w6ICdjbGllbnRfbmFtZV9vcmlnaW5hbCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnYmFja3VwIG5vbWJyZSBwcmUtaW1wb3J0JyB9LFxuICAgICAgeyBjb2w6ICdsb2NhbGlkYWRfb3JpZ2luYWwnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ2JhY2t1cCBsb2NhbGlkYWQgcHJlLWltcG9ydCcgfSxcbiAgICAgIHsgY29sOiAnbWF0Y2hfdHlwZScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnZXhhY3QgfCBmdXp6eScgfSxcbiAgICAgIHsgY29sOiAnbWF0Y2hfc2ltaWxhcml0eScsIHR5cGU6ICdudW1iZXInLCBkZXNjOiAnMC0xJyB9LFxuICAgICAgeyBjb2w6ICd1cGRhdGVkX2F0JywgdHlwZTogJ2lzbzg2MDEnLCBkZXNjOiAnJyB9LFxuICAgICAgeyBjb2w6ICd1cGRhdGVkX2J5JywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXG4gICAgXSxcbiAgfSxcbiAgcmVuZGljaW9uZXM6IHtcbiAgICBuYW1lOiAncmVuZGljaW9uZXMuY3N2JyxcbiAgICBzb3VyY2U6ICdmaXJlc3RvcmUnLFxuICAgIGNvbGxlY3Rpb246ICdyZW5kaWNpb25lcycsXG4gICAgcm93TW9kZTogJ29uZV9wZXJfZG9jJyxcbiAgICBjb2x1bW5zOiBbXG4gICAgICB7IGNvbDogJ3JlbmRpY2lvbl9pZCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnRmlyZXN0b3JlIGRvYyBJRCcgfSxcbiAgICAgIHsgY29sOiAnb3duZXJfdWlkJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXG4gICAgICB7IGNvbDogJ293bmVyX2VtYWlsJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXG4gICAgICB7IGNvbDogJ3ZlbmRvcicsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJyB9LFxuICAgICAgeyBjb2w6ICd0aXBvJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdnYXN0byB8IHNvbGljaXR1ZCcgfSxcbiAgICAgIHsgY29sOiAndGlwb19nYXN0bycsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnZWogUEVBSkVTLCBGQUNUVVJBIEEsIEdBU1RPIENPTiBDT01QUk9CQU5URScgfSxcbiAgICAgIHsgY29sOiAnaW1wb3J0ZV9hcnMnLCB0eXBlOiAnbnVtYmVyJywgZGVzYzogJ21vbnRvIEFSUycgfSxcbiAgICAgIHsgY29sOiAnZmVjaGFfZ2FzdG8nLCB0eXBlOiAnaXNvODYwMScsIGRlc2M6ICdZWVlZLU1NLUREIGRlbCBnYXN0bycgfSxcbiAgICAgIHsgY29sOiAnY29uY2VwdG8nLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ2Rlc2NyaXBjaW9uIGxpYnJlJyB9LFxuICAgICAgeyBjb2w6ICdmb3RvX3RpY2tldF91cmwnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ1VSTCBGaXJlYmFzZSBTdG9yYWdlIHYzMDgrIChudW5jYSBiYXNlNjQpJyB9LFxuICAgICAgeyBjb2w6ICdzdGF0dXMnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ3BlbmRpbmdfYXBwcm92YWwgfCBhcHByb3ZlZCB8IHJlamVjdGVkJyB9LFxuICAgICAgeyBjb2w6ICdhcHByb3ZlZF9ieScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnZW1haWwgZGVsIGFwcm9iYWRvciBvIFwic2VsZlwiJyB9LFxuICAgICAgeyBjb2w6ICdhcHByb3ZlZF9hdCcsIHR5cGU6ICdpc284NjAxJywgZGVzYzogJycgfSxcbiAgICAgIHsgY29sOiAncmVqZWN0ZWRfYnlfZW1haWwnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcbiAgICAgIHsgY29sOiAncmVqZWN0ZWRfcmVhc29uJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXG4gICAgICB7IGNvbDogJ2FwcHJvdmVyX3VpZCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnVUlEIHJlc3BvbnNhYmxlIGFzaWduYWRvJyB9LFxuICAgICAgeyBjb2w6ICdjcmVhdGVkX2F0JywgdHlwZTogJ2lzbzg2MDEnLCBkZXNjOiAnJyB9LFxuICAgIF0sXG4gIH0sXG4gIGNhbXBhbmlhczoge1xuICAgIG5hbWU6ICdjYW1wYW5pYXMuY3N2JyxcbiAgICBzb3VyY2U6ICdmaXJlc3RvcmUnLFxuICAgIGNvbGxlY3Rpb246ICdjYW1wYWlnbnMnLFxuICAgIHJvd01vZGU6ICdvbmVfcGVyX2RvYycsXG4gICAgY29sdW1uczogW1xuICAgICAgeyBjb2w6ICdjYW1wYWlnbl9pZCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnRmlyZXN0b3JlIGRvYyBJRCcgfSxcbiAgICAgIHsgY29sOiAnbmFtZScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnbm9tYnJlIGNhbXBhbmEnIH0sXG4gICAgICB7IGNvbDogJ2ZhbWlsaWEnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ2VqIFJFRUxTJyB9LFxuICAgICAgeyBjb2w6ICdzdWJmYW1pbGlhJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdlaiBNVUxUSVBMSUNBRE9SRVMnIH0sXG4gICAgICB7IGNvbDogJ2ZpbHRlcl90eXBlJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdza3UgKGhveSBoYXJkY29kZWQpJyB9LFxuICAgICAgeyBjb2w6ICdmaWx0ZXJfdmFsdWVzX2pzb24nLCB0eXBlOiAnanNvbl9hcnJheScsIGRlc2M6ICdjb3BpYSBkZSBza3VzJyB9LFxuICAgICAgeyBjb2w6ICdza3VzX2pzb24nLCB0eXBlOiAnanNvbl9hcnJheScsIGRlc2M6ICdJdGVtQ29kZXMgaW5jbHVpZG9zJyB9LFxuICAgICAgeyBjb2w6ICdza3VzX2NvdW50JywgdHlwZTogJ2ludCcsIGRlc2M6ICdjYW50aWRhZCBTS1VzJyB9LFxuICAgICAgeyBjb2w6ICd0YXJnZXRfdHlwZScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAndW5pdHMgfCBtb25leScgfSxcbiAgICAgIHsgY29sOiAndGFyZ2V0X2Ftb3VudCcsIHR5cGU6ICdudW1iZXInLCBkZXNjOiAnb2JqZXRpdm8nIH0sXG4gICAgICB7IGNvbDogJ3N0YXJ0X2RhdGUnLCB0eXBlOiAnaXNvODYwMScsIGRlc2M6ICdZWVlZLU1NLUREJyB9LFxuICAgICAgeyBjb2w6ICdlbmRfZGF0ZScsIHR5cGU6ICdpc284NjAxJywgZGVzYzogJ1lZWVktTU0tREQnIH0sXG4gICAgICB7IGNvbDogJ3Njb3BlJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdhbGwgfCBwcm92aW5jZSB8IHZlbmRvcicgfSxcbiAgICAgIHtcbiAgICAgICAgY29sOiAnc2NvcGVfdmFsdWVzX2pzb24nLFxuICAgICAgICB0eXBlOiAnanNvbl9hcnJheScsXG4gICAgICAgIGRlc2M6ICdwcm92aW5jaWFzIG8gdmVuZG9yIGtleXMgc2kgc2NvcGUgIT0gYWxsJyxcbiAgICAgIH0sXG4gICAgICB7IGNvbDogJ2NyZWF0ZWRfYnknLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ1VJRCBhZG1pbi9nZXJlbnRlJyB9LFxuICAgICAgeyBjb2w6ICdjcmVhdGVkX2J5X2VtYWlsJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXG4gICAgICB7IGNvbDogJ2NyZWF0ZWRfYXQnLCB0eXBlOiAnaXNvODYwMScsIGRlc2M6ICcnIH0sXG4gICAgICB7IGNvbDogJ2FyY2hpdmVkX21hbnVhbGx5JywgdHlwZTogJ2Jvb2xlYW4nLCBkZXNjOiAndHJ1ZT1maW5hbGl6YWRhIGFudGVzIGRlIGVuZERhdGUnIH0sXG4gICAgICB7IGNvbDogJ2FyY2hpdmVkX2F0JywgdHlwZTogJ2lzbzg2MDEnLCBkZXNjOiAnJyB9LFxuICAgICAgeyBjb2w6ICdhcmNoaXZlZF9ieScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJyB9LFxuICAgIF0sXG4gIH0sXG4gIHRhcmdldHM6IHtcbiAgICBuYW1lOiAndGFyZ2V0cy5jc3YnLFxuICAgIHNvdXJjZTogJ2ZpcmVzdG9yZScsXG4gICAgY29sbGVjdGlvbjogJ3RhcmdldHMnLFxuICAgIHJvd01vZGU6ICdvbmVfcGVyX2RvYycsXG4gICAgY29sdW1uczogW1xuICAgICAgeyBjb2w6ICd0YXJnZXRfaWQnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ0ZpcmVzdG9yZSBkb2MgSUQgY2Fub25pY28ge3ZlbmRvcn1fe3llYXJ9X3tNTX0nIH0sXG4gICAgICB7IGNvbDogJ3NlbGxlcl9pZCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAndmVuZG9yS2V5IHVwcGVyY2FzZSBlaiBHT05aQUxPIERFIExBIFJPU0EnIH0sXG4gICAgICB7IGNvbDogJ3llYXInLCB0eXBlOiAnaW50JywgZGVzYzogJ2VqIDIwMjYnIH0sXG4gICAgICB7IGNvbDogJ21vbnRoJywgdHlwZTogJ2ludCcsIGRlc2M6ICcwLTExIChpbmRpY2UgZGVsIGFycmF5IE1FU0VTIDAtaW5kZXhlZCknIH0sXG4gICAgICB7IGNvbDogJ3RhcmdldF9hcnMnLCB0eXBlOiAnbnVtYmVyJywgZGVzYzogJ29iamV0aXZvIG1lcyBBUlMgKHN1bWEgZmFtaWxpYXMpJyB9LFxuICAgICAgeyBjb2w6ICd0YXJnZXRfcmVlbF9hcnMnLCB0eXBlOiAnbnVtYmVyJywgZGVzYzogJ3YzMTErIGRlc2dsb3NlJyB9LFxuICAgICAgeyBjb2w6ICd0YXJnZXRfY2FuYXNfYXJzJywgdHlwZTogJ251bWJlcicsIGRlc2M6ICd2MzExKyBkZXNnbG9zZScgfSxcbiAgICAgIHsgY29sOiAndGFyZ2V0X2xpbmVhc19hcnMnLCB0eXBlOiAnbnVtYmVyJywgZGVzYzogJ3YzMTErIGRlc2dsb3NlJyB9LFxuICAgICAgeyBjb2w6ICd1cGRhdGVkX2F0JywgdHlwZTogJ2lzbzg2MDEnLCBkZXNjOiAnJyB9LFxuICAgICAgeyBjb2w6ICd1cGRhdGVkX2J5JywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdVSUQnIH0sXG4gICAgICB7IGNvbDogJ3VwZGF0ZWRfYnlfZW1haWwnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcbiAgICBdLFxuICB9LFxuICBwcm9kdWN0b3M6IHtcbiAgICBuYW1lOiAncHJvZHVjdG9zLmNzdicsXG4gICAgc291cmNlOiAnc3RvY2tfanNvbicsXG4gICAgcm93TW9kZTogJ2Zyb21fc3RvY2tfanNvbicsXG4gICAgY29sdW1uczogW1xuICAgICAgeyBjb2w6ICdza3UnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ1NLVSAoSXRlbUNvZGUgU0FQKScgfSxcbiAgICAgIHsgY29sOiAnaGFzX3N0b2NrJywgdHlwZTogJ2Jvb2xlYW4nLCBkZXNjOiAndHJ1ZT1oYXkgdW5pZGFkZXMgZW4gYWxndW4gd2hzIHZlbmRpYmxlJyB9LFxuICAgICAgeyBjb2w6ICdjYW50aWRhZF90b3RhbCcsIHR5cGU6ICdpbnQnLCBkZXNjOiAnc3VtYSB0b3RhbCB3aHMgdmVuZGlibGVzIChleGNsdXllIDA1IHkgMDYpJyB9LFxuICAgICAge1xuICAgICAgICBjb2w6ICdkaXNwb25pYmxlX3ZlbnRhX3doczExJyxcbiAgICAgICAgdHlwZTogJ2ludCcsXG4gICAgICAgIGRlc2M6ICd2MzY5KyBNZXJjYWRlcmlhIE5VUiBQRVNDQSAodmVudGEgZGlyZWN0YSknLFxuICAgICAgfSxcbiAgICAgIHsgY29sOiAndHJhbnNpdG9fd2hzMTInLCB0eXBlOiAnaW50JywgZGVzYzogJ3YzNjkrIEVuIHRyYW5zaXRvIFBFU0NBIChiYWNrb3JkZXIgZnV0dXJvKScgfSxcbiAgICAgIHtcbiAgICAgICAgY29sOiAnb3Ryb3Nfd2FyZWhvdXNlc19qc29uJyxcbiAgICAgICAgdHlwZTogJ2pzb25fb2JqZWN0JyxcbiAgICAgICAgZGVzYzogJ290cm9zIGNvZGlnb3MgY29uIGNhbnRpZGFkLCBlaiB7XCI5OFwiOiA1fScsXG4gICAgICB9LFxuICAgICAgeyBjb2w6ICdzb3VyY2UnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ3N0b2NrLmpzb24gc25hcHNob3QnIH0sXG4gICAgICB7IGNvbDogJ3NuYXBzaG90X3VwZGF0ZWRfYXQnLCB0eXBlOiAnaXNvODYwMScsIGRlc2M6ICd0aW1lc3RhbXAgZGVsIHVsdGltbyBzeW5jIFNBUCcgfSxcbiAgICBdLFxuICB9LFxuICB2ZW5kb3Jfb3ZlcnJpZGVzOiB7XG4gICAgbmFtZTogJ3ZlbmRvcl9vdmVycmlkZXMuY3N2JyxcbiAgICBzb3VyY2U6ICdmaXJlc3RvcmUnLFxuICAgIGNvbGxlY3Rpb246ICd2ZW5kb3Jfb3ZlcnJpZGVzJyxcbiAgICByb3dNb2RlOiAnb25lX3Blcl9kb2MnLFxuICAgIGNvbHVtbnM6IFtcbiAgICAgIHsgY29sOiAnb3ZlcnJpZGVfaWQnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ0ZpcmVzdG9yZSBkb2MgSUQnIH0sXG4gICAgICB7IGNvbDogJ3Njb3BlJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdzaG9wIHwgbG9jJyB9LFxuICAgICAgeyBjb2w6ICdwcm92aW5jZScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJyB9LFxuICAgICAgeyBjb2w6ICdsb2NhbGl0eV9uYW1lJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXG4gICAgICB7IGNvbDogJ2NsaWVudF9uYW1lJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdzb2xvIHNpIHNjb3BlPXNob3AnIH0sXG4gICAgICB7IGNvbDogJ29yaWdpbmFsX3ZlbmRvcicsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJyB9LFxuICAgICAgeyBjb2w6ICduZXdfdmVuZG9yJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXG4gICAgICB7IGNvbDogJ25ld190eXBlJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdWREUgfCBWREkgfCBESVNUUklCVUlET1IgfCBPVFJPJyB9LFxuICAgICAgeyBjb2w6ICd1cGRhdGVkX2F0JywgdHlwZTogJ2lzbzg2MDEnLCBkZXNjOiAnJyB9LFxuICAgICAgeyBjb2w6ICd1cGRhdGVkX2J5X3VpZCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJyB9LFxuICAgICAgeyBjb2w6ICd1cGRhdGVkX2J5X2VtYWlsJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXG4gICAgICB7IGNvbDogJ3VwZGF0ZWRfYnlfZGlzcGxheV9uYW1lJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXG4gICAgXSxcbiAgfSxcbiAgY3VzdG9tX3JvdXRlczoge1xuICAgIG5hbWU6ICdjdXN0b21fcm91dGVzLmNzdicsXG4gICAgc291cmNlOiAnZmlyZXN0b3JlJyxcbiAgICBjb2xsZWN0aW9uOiAnY3VzdG9tX3JvdXRlcycsXG4gICAgcm93TW9kZTogJ2ZsYXR0ZW5fc3RvcHMnLCAvLyAxIGZpbGEgcG9yIChydXRhLCBzdG9wKVxuICAgIGNvbHVtbnM6IFtcbiAgICAgIHsgY29sOiAncm91dGVfaWQnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ0ZpcmVzdG9yZSBkb2MgSUQnIH0sXG4gICAgICB7IGNvbDogJ293bmVyX3VpZCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnZHVlbmlvIGRlIGxhIHJ1dGEnIH0sXG4gICAgICB7IGNvbDogJ293bmVyX2VtYWlsJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXG4gICAgICB7IGNvbDogJ25hbWUnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ25vbWJyZSBkZSBsYSBydXRhJyB9LFxuICAgICAgeyBjb2w6ICdwbGFubmVkX2RhdGUnLCB0eXBlOiAnaXNvODYwMScsIGRlc2M6ICdZWVlZLU1NLUREJyB9LFxuICAgICAgeyBjb2w6ICdub3RlcycsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnbm90YXMgbGlicmVzJyB9LFxuICAgICAgeyBjb2w6ICdjcmVhdGVkX2F0JywgdHlwZTogJ2lzbzg2MDEnLCBkZXNjOiAnJyB9LFxuICAgICAgeyBjb2w6ICd1cGRhdGVkX2F0JywgdHlwZTogJ2lzbzg2MDEnLCBkZXNjOiAnJyB9LFxuICAgICAgeyBjb2w6ICdzdG9wX29yZGVyJywgdHlwZTogJ2ludCcsIGRlc2M6ICdvcmRlbiAwLWJhc2VkJyB9LFxuICAgICAgeyBjb2w6ICdzdG9wX2tleScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnY2xhdmUgY29tcHVlc3RhIHRpcG98cHJvdnxsb2N8Y2xpZW50ZScgfSxcbiAgICAgIHsgY29sOiAnc3RvcF90aXBvJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdDIHwgUCcgfSxcbiAgICAgIHsgY29sOiAnc3RvcF9wcm92aW5jaWEnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcbiAgICAgIHsgY29sOiAnc3RvcF9sb2NhbGlkYWQnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcbiAgICAgIHsgY29sOiAnc3RvcF9jbGllbnRfbmFtZScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJyB9LFxuICAgICAgeyBjb2w6ICdzdG9wX2lzX3Byb3Zpc29yaW8nLCB0eXBlOiAnYm9vbGVhbicsIGRlc2M6ICd0cnVlPWFsdGEgcmFwaWRhIHNpbiBDYXJkQ29kZScgfSxcbiAgICAgIHsgY29sOiAnc3RvcF9zYXBfYWx0YV9pZCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnSUQgZGVsIGNsaWVudF9hcHBsaWNhdGlvbnMgc2kgYXBsaWNhJyB9LFxuICAgIF0sXG4gIH0sXG4gIHNlZ3VpbWllbnRvX25vdGVzOiB7XG4gICAgbmFtZTogJ3NlZ3VpbWllbnRvX25vdGVzLmNzdicsXG4gICAgc291cmNlOiAnZmlyZXN0b3JlJyxcbiAgICBjb2xsZWN0aW9uOiAnc2VndWltaWVudG9fbm90ZXMnLFxuICAgIHJvd01vZGU6ICdvbmVfcGVyX2RvYycsXG4gICAgY29sdW1uczogW1xuICAgICAgeyBjb2w6ICdub3RlX2lkJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdGaXJlc3RvcmUgZG9jIElEJyB9LFxuICAgICAgeyBjb2w6ICd2ZW5kb3JfZXh0JywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdWREUgYWwgcXVlIGFwbGljYSBsYSBub3RhJyB9LFxuICAgICAgeyBjb2w6ICdjbGllbnRfa2V5JywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdjbGF2ZSBjb21wdWVzdGEgY2xpZW50ZScgfSxcbiAgICAgIHsgY29sOiAnY2xpZW50X25hbWUnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcbiAgICAgIHsgY29sOiAncHJvdmluY2UnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcbiAgICAgIHsgY29sOiAnbG9jYWxpdHknLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcbiAgICAgIHsgY29sOiAndGV4dCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAndGV4dG8gbGlicmUgZGUgbGEgbm90YScgfSxcbiAgICAgIHsgY29sOiAnYXV0aG9yX3VpZCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJyB9LFxuICAgICAgeyBjb2w6ICdhdXRob3JfZW1haWwnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcbiAgICAgIHsgY29sOiAnYXV0aG9yX25hbWUnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcbiAgICAgIHsgY29sOiAnYXV0aG9yX3JvbGUnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ2FkbWluIHwgZ2VyZW50ZSB8IGludGVybm8nIH0sXG4gICAgICB7IGNvbDogJ2NyZWF0ZWRfYXQnLCB0eXBlOiAnaXNvODYwMScsIGRlc2M6ICcnIH0sXG4gICAgXSxcbiAgfSxcbn07XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gREFUQVNFVF9VU0VfQ0FTRV9NQVRSSVggXHUyMDE0IGNhc29zIGRlIHVzbyBNTCBjb24gY2FtcG9zIHJlcXVlcmlkb3Ncbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4vKiogQHR5cGVkZWYge3twcmlvcml0eTogbnVtYmVyfHN0cmluZywgZGVzY3JpcHRpb246IHN0cmluZywgcmVxdWlyZWRGaWVsZHM6IFJlY29yZDxzdHJpbmcsIHN0cmluZ1tdPiwgam9pbk5vdGVzPzogc3RyaW5nfX0gVXNlQ2FzZSAqL1xuXG4vKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFVzZUNhc2U+fSAqL1xuZXhwb3J0IGNvbnN0IERBVEFTRVRfVVNFX0NBU0VfTUFUUklYID0ge1xuICBBX2NvbnZlcnNpb25fdmlzaXRhX3BlZGlkbzoge1xuICAgIHByaW9yaXR5OiAxLFxuICAgIGRlc2NyaXB0aW9uOiAnUHJlZGVjaXIgcXVlIHZpc2l0YXMgdGVybWluYW4gZW4gcGVkaWRvIHBhcmEgcHJpb3JpemFyIGxhIHJ1dGEgZGVsIHZlbmRlZG9yLicsXG4gICAgcmVxdWlyZWRGaWVsZHM6IHtcbiAgICAgICd2aXNpdGFzLmNzdic6IFsnZmVjaGEnLCAnb3duZXJfdWlkJywgJ3Byb3ZpbmNpYScsICdsb2NhbGlkYWQnLCAndGllbmRhJ10sXG4gICAgICAncGVkaWRvcy5jc3YnOiBbJ2NvbmZpcm1lZF9hdCcsICdvd25lcl91aWQnLCAncHJvdmluY2UnLCAnbG9jX25hbWUnLCAnY2xpZW50X25hbWUnXSxcbiAgICB9LFxuICAgIGpvaW5Ob3RlczpcbiAgICAgICdKT0lOIHBvciAocHJvdmluY2lhLCBsb2NhbGlkYWQsIHRpZW5kYX5jbGllbnRfbmFtZSkgZW4gdmVudGFuYSB0ZW1wb3JhbCBmZWNoYV92aXNpdGEuLmNvbmZpcm1lZF9hdC4gTm8gaGF5IGNhcmRDb2RlU2FwIGNvbXVuIGVudHJlIHZpc2l0cyB5IHBlZGlkb3MuJyxcbiAgfSxcbiAgQl9jaHVybl9jbGllbnRlczoge1xuICAgIHByaW9yaXR5OiAyLFxuICAgIGRlc2NyaXB0aW9uOiAnRGV0ZWN0YXIgY2xpZW50ZXMgcXVlIHNlIGVuZnJpYW4gYW50ZXMgZGUgcGVyZGVybG9zLicsXG4gICAgcmVxdWlyZWRGaWVsZHM6IHtcbiAgICAgICdjbGllbnRlcy5jc3YnOiBbJ2NyZWF0ZWRfYXQnLCAnYXNzaWduZWRfdmVuZG9yJywgJ3Byb3ZpbmNpYScsICdzdGF0dXMnLCAnY2FyZF9jb2RlX3NhcCddLFxuICAgICAgJ3BlZGlkb3MuY3N2JzogWydjb25maXJtZWRfYXQnLCAnY2xpZW50X25hbWUnLCAncHJvdmluY2UnLCAnbG9jX25hbWUnXSxcbiAgICB9LFxuICAgIGpvaW5Ob3RlczpcbiAgICAgICdKT0lOIHZpYSBjbGllbnRfYXBwbGljYXRpb25zLmNhcmRfY29kZV9zYXAgdnMgcGVkaWRvcy5rZXkgKHBhcnNlYWRvKS4gRnJhZ2lsIC0gY29uc2lkZXJhciBmdXp6eSBtYXRjaCBwb3Igbm9tYnJlLicsXG4gIH0sXG4gIENfZm9yZWNhc3Rfc2t1OiB7XG4gICAgcHJpb3JpdHk6IDMsXG4gICAgZGVzY3JpcHRpb246ICdBbnRpY2lwYXIgcXVlIHByb2R1Y3RvcyBzZSB2YW4gYSBwZWRpciBwb3IgcGVyaW9kby4nLFxuICAgIHJlcXVpcmVkRmllbGRzOiB7XG4gICAgICAncGVkaWRvcy5jc3YnOiBbJ2xpbmVfY29kZScsICdsaW5lX3F0eScsICdsaW5lX3ByZWNpbycsICdjb25maXJtZWRfYXQnLCAncHJvdmluY2UnXSxcbiAgICAgICdwcm9kdWN0b3MuY3N2JzogWydza3UnXSxcbiAgICB9LFxuICAgIGpvaW5Ob3RlczpcbiAgICAgICdEZXNjdWVudG8gYXBsaWNhZG8gYSBuaXZlbCBoZWFkZXIgKGRpc2NvdW50X3BjdCkgLSBwcm9ycmF0ZWFyIGVuIGVsIHBpcGVsaW5lIGRvd25zdHJlYW0gcHJvcG9yY2lvbmFsIGEgc3VidG90YWxfYnJ1dG8gZGUgY2FkYSBsaW5lYS4gRW5yaXF1ZWNlciBjb24gY2F0YWxvZ28gQlEgKHNhcF9pdGVtc19yYXcpIHNpIGhhY2UgZmFsdGEgY2F0L2ZhbS9zdWIgYWRpY2lvbmFsLicsXG4gIH0sXG4gIERfYW5vbWFsaWFzX3JlbmRpY2lvbmVzOiB7XG4gICAgcHJpb3JpdHk6ICdleHBsb3JhdG9yaW8nLFxuICAgIGRlc2NyaXB0aW9uOiAnRGV0ZWN0YXIgb3V0bGllcnMgZGUgZ2FzdG9zLicsXG4gICAgcmVxdWlyZWRGaWVsZHM6IHtcbiAgICAgICdyZW5kaWNpb25lcy5jc3YnOiBbJ2ltcG9ydGVfYXJzJywgJ3RpcG9fZ2FzdG8nLCAnb3duZXJfdWlkJywgJ2ZlY2hhX2dhc3RvJywgJ3N0YXR1cyddLFxuICAgIH0sXG4gIH0sXG4gIEVfZXN0YWNpb25hbGlkYWRfem9uYV9jYXRlZ29yaWE6IHtcbiAgICBwcmlvcml0eTogJ2V4cGxvcmF0b3JpbycsXG4gICAgZGVzY3JpcHRpb246ICdJbnN1bW8gcGFyYSBhcm1hZG8gZGUgY2FtcGFuaWFzIGVzdGFjaW9uYWxlcy4nLFxuICAgIHJlcXVpcmVkRmllbGRzOiB7XG4gICAgICAncGVkaWRvcy5jc3YnOiBbJ2NvbmZpcm1lZF9hdCcsICdwcm92aW5jZScsICdsaW5lX2NvZGUnLCAnbGluZV9mYW0nLCAnbGluZV9xdHknXSxcbiAgICAgICdjbGllbnRlcy5jc3YnOiBbJ3Byb3ZpbmNpYScsICdhc3NpZ25lZF92ZW5kb3InXSxcbiAgICAgICdjYW1wYW5pYXMuY3N2JzogWydzdGFydF9kYXRlJywgJ2VuZF9kYXRlJywgJ3NrdXNfanNvbicsICdzY29wZSddLFxuICAgICAgJ3RhcmdldHMuY3N2JzogWyd5ZWFyJywgJ21vbnRoJywgJ3RhcmdldF9hcnMnXSxcbiAgICB9LFxuICB9LFxufTtcblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBSb3cgYnVpbGRlcnMgXHUyMDE0IGZ1bmNpb25lcyBwdXJhcyAoZG9jIC0+IGFycmF5IGRlIHJvd3MpXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuLyoqXG4gKiBFeHRyYWUgdmFsb3IgRmlyZXN0b3JlIGRlIGRvYyBjb24gcGF0aCBhbmlkYWRvLiBEZXZ1ZWx2ZSByYXcgKG5vIENTVikuXG4gKiBFajogZ2V0RmllbGQoZG9jLCAndHJhbnNmZXJpZG9TQVAuZG9jTnVtJylcbiAqIEBwYXJhbSB7b2JqZWN0fSBkb2NcbiAqIEBwYXJhbSB7c3RyaW5nfSBwYXRoXG4gKi9cbmZ1bmN0aW9uIGYoZG9jLCBwYXRoKSB7XG4gIHJldHVybiBnZXRQYXRoKGRvYywgcGF0aCk7XG59XG5cbi8qKlxuICogUm93IGJ1aWxkZXIgZ2VuZXJpY286IG1hcGVhIHVuIGRvYyBhIGFycmF5IGRlIHZhbG9yZXMgc2VndW4gdW4gYXJyYXkgZGUgcGF0aHMuXG4gKiBAcGFyYW0ge29iamVjdH0gZG9jXG4gKiBAcGFyYW0ge3N0cmluZ1tdfSBwYXRoc1xuICogQHJldHVybnMge3Vua25vd25bXX1cbiAqL1xuZnVuY3Rpb24gX2J1aWxkUm93KGRvYywgcGF0aHMpIHtcbiAgcmV0dXJuIHBhdGhzLm1hcCgocCkgPT4gKHAgPT09ICdfX2lkX18nID8gLyoqIEB0eXBlIHthbnl9ICovIChkb2MpLl9pZCA6IGYoZG9jLCBwKSkpO1xufVxuXG4vKipcbiAqIFBlZGlkb3M6IGZsYXR0ZW4gMSBmaWxhIHBvciBsaW5lYS4gSGVhZGVyIHBlZGlkbyByZXBsaWNhZG8gZW4gY2FkYS5cbiAqIGRvYy5faWQgZXMgZWwgSUQ7IHNlIGVzcGVyYSBxdWUgZWwgY2FsbGVyIGxvIGFncmVndWUgYW50ZXMgZGUgcGFzYXIuXG4gKiBAcGFyYW0ge2FueX0gZG9jXG4gKiBAcmV0dXJucyB7dW5rbm93bltdW119XG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBidWlsZFBlZGlkb1Jvd3MoZG9jKSB7XG4gIGNvbnN0IGhlYWRlciA9IFtcbiAgICBkb2MuX2lkLFxuICAgIGRvYy5vd25lclVpZCxcbiAgICBkb2Mub3duZXJFbWFpbCxcbiAgICBkb2MuY3JlYXRlZEJ5VWlkLFxuICAgIGRvYy5vbkJlaGFsZk9mLFxuICAgIGRvYy5rZXksXG4gICAgZG9jLnN0YWdlLFxuICAgIGRvYy50aXBvLFxuICAgIGRvYy5wcm92aW5jZSxcbiAgICBkb2MubG9jTmFtZSxcbiAgICBkb2MuY2xpZW50TmFtZSxcbiAgICBkb2MubW9udGgsXG4gICAgZG9jLm1vbnRoSWR4LFxuICAgIGRvYy55ZWFyLFxuICAgIGRvYy5jb25maXJtZWRBdCxcbiAgICBkb2MuY29uZGljaW9uUGFnbyxcbiAgICBkb2MuZm9ybWFFbnRyZWdhID8gZG9jLmZvcm1hRW50cmVnYS50aXBvIDogbnVsbCxcbiAgICBkb2MuZm9ybWFFbnRyZWdhID8gZG9jLmZvcm1hRW50cmVnYS50cmFuc3BOb21icmUgOiBudWxsLFxuICAgIGRvYy5mb3JtYUVudHJlZ2EgPyBkb2MuZm9ybWFFbnRyZWdhLnRyYW5zcERpcmVjY2lvbiA6IG51bGwsXG4gICAgZG9jLmZvcm1hRW50cmVnYSA/IGRvYy5mb3JtYUVudHJlZ2EuY2xpZW50ZURpcmVjY2lvbiA6IG51bGwsXG4gICAgZG9jLmZvcm1hRW50cmVnYSA/IGRvYy5mb3JtYUVudHJlZ2Euc3VjdXJzYWxEaXJlY2Npb24gOiBudWxsLFxuICAgIGRvYy5kaXNjb3VudFBjdCxcbiAgICBkb2Muc3VidG90YWxBcnMsXG4gICAgZG9jLm5ldEFtb3VudEFycyxcbiAgICBkb2MudHJhbnNmZXJpZG9TQVAgPyBkb2MudHJhbnNmZXJpZG9TQVAudmlhIDogbnVsbCxcbiAgICBkb2MudHJhbnNmZXJpZG9TQVAgPyBkb2MudHJhbnNmZXJpZG9TQVAuZG9jTnVtIDogbnVsbCxcbiAgICBkb2MudHJhbnNmZXJpZG9TQVAgPyBkb2MudHJhbnNmZXJpZG9TQVAuZG9jRW50cnkgOiBudWxsLFxuICAgIGRvYy50cmFuc2Zlcmlkb1NBUCA/IGRvYy50cmFuc2Zlcmlkb1NBUC5hdCA6IG51bGwsXG4gICAgZG9jLmNyZWF0ZWRBdCxcbiAgXTtcbiAgY29uc3QgbGluZXMgPSBBcnJheS5pc0FycmF5KGRvYy5saW5lcykgPyBkb2MubGluZXMgOiBbXTtcbiAgaWYgKCFsaW5lcy5sZW5ndGgpIHtcbiAgICAvLyBQZWRpZG8gc2luIGxpbmVhcyAtPiAxIGZpbGEgY29uIGxpbmVfKiB2YWNpb3NcbiAgICByZXR1cm4gW2hlYWRlci5jb25jYXQoW251bGwsIG51bGwsIG51bGwsIG51bGwsIG51bGwsIG51bGwsIG51bGwsIG51bGxdKV07XG4gIH1cbiAgcmV0dXJuIGxpbmVzLm1hcCgoLyoqIEB0eXBlIHthbnl9ICovIGwsIC8qKiBAdHlwZSB7bnVtYmVyfSAqLyBpZHgpID0+XG4gICAgaGVhZGVyLmNvbmNhdChbXG4gICAgICBpZHgsXG4gICAgICBsID8gbC5jb2RlIDogbnVsbCxcbiAgICAgIGwgPyBsLmRlc2MgOiBudWxsLFxuICAgICAgbCA/IGwucXR5IDogbnVsbCxcbiAgICAgIGwgPyBsLnByZWNpbyA6IG51bGwsXG4gICAgICBsID8gbC5jYXQgOiBudWxsLFxuICAgICAgbCA/IGwuZmFtIDogbnVsbCxcbiAgICAgIGwgPyBsLnN1YiA6IG51bGwsXG4gICAgXSlcbiAgKTtcbn1cblxuLyoqIEBwYXJhbSB7YW55fSBkb2MgQHJldHVybnMge3Vua25vd25bXVtdfSAqL1xuZXhwb3J0IGZ1bmN0aW9uIGJ1aWxkVmlzaXRhUm93cyhkb2MpIHtcbiAgcmV0dXJuIFtcbiAgICBbXG4gICAgICBkb2MuX2lkLFxuICAgICAgZG9jLm93bmVyVWlkLFxuICAgICAgZG9jLm93bmVyRW1haWwsXG4gICAgICBkb2MuZmVjaGEsXG4gICAgICBkb2MubWVzLFxuICAgICAgZG9jLmFuaW8sXG4gICAgICBkb2MudmVuZG9yLFxuICAgICAgZG9jLnByb3ZpbmNpYSxcbiAgICAgIGRvYy5sb2NhbGlkYWQsXG4gICAgICBkb2MudGllbmRhLFxuICAgICAgZG9jLnRpcG8sXG4gICAgICBkb2MubG9jYWwsXG4gICAgICBkb2MudGFtYW5vLFxuICAgICAgZG9jLmZpZGVsaWRhZCxcbiAgICAgIGRvYy5yZWxldmFuY2lhLFxuICAgICAgZG9jLnBvcCxcbiAgICAgIGRvYy5uZWNlc2lkYWRQdW50dWFsLFxuICAgICAgZG9jLnRpcG9WZW50YSxcbiAgICAgIGRvYy5wb25kZXJhY2lvbk1vc3RyYWRvLFxuICAgICAgZG9jLnBvbmRlcmFjaW9uRWNvbW1lcmNlLFxuICAgICAgZG9jLmNvbXBldGVuY2lhLFxuICAgICAgZG9jLm9wb3J0dW5pZGFkLFxuICAgICAgZG9jLm1hc1ZlbmRpZG8sXG4gICAgICBkb2MubWFzUHJlZ3VudGFuLFxuICAgICAgZG9jLmF5dWRhVGllbmRhLFxuICAgICAgZG9jLmdwc1N0YXR1cyxcbiAgICAgIGRvYy5ncHNEaXN0YW5jZU0sXG4gICAgICBkb2MuaW50ZXJhY3Rpb25UeXBlLFxuICAgICAgZG9jLmZvcm1hQ29udGFjdG8sXG4gICAgICBkb2MuY29udGFjdG9SZXN1bHRhZG8sXG4gICAgICBkb2MuY29udGFjdG9SZXN1bHRhZG9BdCxcbiAgICAgIGRvYy5jb250YWN0b1Jlc3VsdGFkb0J5LFxuICAgICAgZG9jLmNyZWF0ZWRBdCxcbiAgICBdLFxuICBdO1xufVxuXG4vKiogQHBhcmFtIHthbnl9IGRvYyBAcmV0dXJucyB7dW5rbm93bltdW119ICovXG5leHBvcnQgZnVuY3Rpb24gYnVpbGRDbGllbnRlUm93cyhkb2MpIHtcbiAgcmV0dXJuIFtcbiAgICBbXG4gICAgICBkb2MuX2lkLFxuICAgICAgZG9jLm93bmVyVWlkLFxuICAgICAgZG9jLm93bmVyRW1haWwsXG4gICAgICBkb2Mub3duZXJOYW1lLFxuICAgICAgZG9jLmNvbWVyY2lvLFxuICAgICAgZG9jLmZhbnRhc2lhLFxuICAgICAgZG9jLmN1aXQsXG4gICAgICBkb2MuY29uZGljaW9uRmlzY2FsLFxuICAgICAgZG9jLmNhbGxlLFxuICAgICAgZG9jLm51bWVybyxcbiAgICAgIGRvYy5sb2NhbGlkYWQsXG4gICAgICBkb2MucHJvdmluY2lhLFxuICAgICAgZG9jLmxvY2FsaWRhZEZpbmFsLFxuICAgICAgZG9jLmNhcmRDb2RlU2FwLFxuICAgICAgZG9jLmFzc2lnbmVkVmVuZG9yLFxuICAgICAgZG9jLnN0YXR1cyxcbiAgICAgIGRvYy5zb3VyY2UsXG4gICAgICBkb2MubWFudWFsU2FwUGVuZGluZyxcbiAgICAgIGRvYy5wcmVjYXVjaW9uLFxuICAgICAgZG9jLmNhdGVnb3JpYUNsaWVudGUsXG4gICAgICBkb2MuY2xpVGlwbyxcbiAgICAgIGRvYy5sYXQsXG4gICAgICBkb2MubG5nLFxuICAgICAgZG9jLmxhdCAhPSBudWxsICYmIGRvYy5sbmcgIT0gbnVsbCxcbiAgICAgICEhKGRvYy5jYWxsZSB8fCBkb2MuYWRkcmVzcyksXG4gICAgICBkb2Muc3VibWl0dGVkQnlQdWJsaWNGb3JtLFxuICAgICAgZG9jLmFwcHJvdmVkQXQsXG4gICAgICBkb2MuY3JlYXRlZEF0LFxuICAgICAgZG9jLnVwZGF0ZWRBdCxcbiAgICBdLFxuICBdO1xufVxuXG4vKiogQHBhcmFtIHthbnl9IGRvYyBAcmV0dXJucyB7dW5rbm93bltdW119ICovXG5leHBvcnQgZnVuY3Rpb24gYnVpbGRDbGllbnRNYXN0ZXJSb3dzKGRvYykge1xuICByZXR1cm4gW1xuICAgIFtcbiAgICAgIGRvYy5faWQsXG4gICAgICBkb2MuY2xpZW50TmFtZSxcbiAgICAgIGRvYy5wcm92aW5jaWEsXG4gICAgICBkb2MubG9jYWxpZGFkLFxuICAgICAgZG9jLnZlbmRvcixcbiAgICAgIGRvYy5hZGRyZXNzLFxuICAgICAgZG9jLnNhcENhcmRDb2RlLFxuICAgICAgZG9jLnNhcEFkZHJlc3MsXG4gICAgICBkb2Muc2FwQ2l0eSxcbiAgICAgIGRvYy5zYXBTdGF0ZSxcbiAgICAgIGRvYy5zYXBJbXBvcnRlZEF0LFxuICAgICAgZG9jLnNhcEltcG9ydGVkQnksXG4gICAgICBkb2MuY2xpZW50TmFtZU9yaWdpbmFsLFxuICAgICAgZG9jLmxvY2FsaWRhZE9yaWdpbmFsLFxuICAgICAgZG9jLm1hdGNoVHlwZSxcbiAgICAgIGRvYy5tYXRjaFNpbWlsYXJpdHksXG4gICAgICBkb2MudXBkYXRlZEF0LFxuICAgICAgZG9jLnVwZGF0ZWRCeSxcbiAgICBdLFxuICBdO1xufVxuXG4vKiogQHBhcmFtIHthbnl9IGRvYyBAcmV0dXJucyB7dW5rbm93bltdW119ICovXG5leHBvcnQgZnVuY3Rpb24gYnVpbGRSZW5kaWNpb25Sb3dzKGRvYykge1xuICByZXR1cm4gW1xuICAgIFtcbiAgICAgIGRvYy5faWQsXG4gICAgICBkb2Mub3duZXJVaWQsXG4gICAgICBkb2Mub3duZXJFbWFpbCxcbiAgICAgIGRvYy52ZW5kb3IsXG4gICAgICBkb2MudGlwbyxcbiAgICAgIGRvYy50aXBvR2FzdG8sXG4gICAgICBkb2MuaW1wb3J0ZUFycyAhPSBudWxsID8gZG9jLmltcG9ydGVBcnMgOiBkb2MuaW1wb3J0ZSxcbiAgICAgIGRvYy5mZWNoYUdhc3RvLFxuICAgICAgZG9jLmNvbmNlcHRvLFxuICAgICAgLy8gZm90b1RpY2tldFVybCAodjMwOCspIHByaW9yaWRhZDsgTlVOQ0EgZXhwb3J0YXIgYmFzZTY0IGZvdG9UaWNrZXQgbGVnYWN5XG4gICAgICBkb2MuZm90b1RpY2tldFVybCB8fCBudWxsLFxuICAgICAgZG9jLnN0YXR1cyxcbiAgICAgIGRvYy5hcHByb3ZlZEJ5LFxuICAgICAgZG9jLmFwcHJvdmVkQXQsXG4gICAgICBkb2MucmVqZWN0ZWRCeUVtYWlsLFxuICAgICAgZG9jLnJlamVjdGVkUmVhc29uLFxuICAgICAgZG9jLmFwcHJvdmVyVWlkLFxuICAgICAgZG9jLmNyZWF0ZWRBdCxcbiAgICBdLFxuICBdO1xufVxuXG4vKiogQHBhcmFtIHthbnl9IGRvYyBAcmV0dXJucyB7dW5rbm93bltdW119ICovXG5leHBvcnQgZnVuY3Rpb24gYnVpbGRDYW1wYW5pYVJvd3MoZG9jKSB7XG4gIHJldHVybiBbXG4gICAgW1xuICAgICAgZG9jLl9pZCxcbiAgICAgIGRvYy5uYW1lLFxuICAgICAgZG9jLmZhbWlsaWEsXG4gICAgICBkb2Muc3ViZmFtaWxpYSxcbiAgICAgIGRvYy5maWx0ZXJUeXBlLFxuICAgICAgZG9jLmZpbHRlclZhbHVlcyxcbiAgICAgIGRvYy5za3VzLFxuICAgICAgQXJyYXkuaXNBcnJheShkb2Muc2t1cykgPyBkb2Muc2t1cy5sZW5ndGggOiAwLFxuICAgICAgZG9jLnRhcmdldFR5cGUsXG4gICAgICBkb2MudGFyZ2V0QW1vdW50LFxuICAgICAgZG9jLnN0YXJ0RGF0ZSxcbiAgICAgIGRvYy5lbmREYXRlLFxuICAgICAgZG9jLnNjb3BlLFxuICAgICAgZG9jLnNjb3BlVmFsdWVzLFxuICAgICAgZG9jLmNyZWF0ZWRCeSxcbiAgICAgIGRvYy5jcmVhdGVkQnlFbWFpbCxcbiAgICAgIGRvYy5jcmVhdGVkQXQsXG4gICAgICBkb2MuYXJjaGl2ZWRNYW51YWxseSxcbiAgICAgIGRvYy5hcmNoaXZlZEF0LFxuICAgICAgZG9jLmFyY2hpdmVkQnksXG4gICAgXSxcbiAgXTtcbn1cblxuLyoqIEBwYXJhbSB7YW55fSBkb2MgQHJldHVybnMge3Vua25vd25bXVtdfSAqL1xuZXhwb3J0IGZ1bmN0aW9uIGJ1aWxkVGFyZ2V0Um93cyhkb2MpIHtcbiAgcmV0dXJuIFtcbiAgICBbXG4gICAgICBkb2MuX2lkLFxuICAgICAgZG9jLnNlbGxlcklkLFxuICAgICAgZG9jLnllYXIsXG4gICAgICBkb2MubW9udGgsXG4gICAgICBkb2MudGFyZ2V0QXJzLFxuICAgICAgZG9jLnRhcmdldEJ5RmFtaWx5ID8gZG9jLnRhcmdldEJ5RmFtaWx5LlJFRUwgOiBudWxsLFxuICAgICAgZG9jLnRhcmdldEJ5RmFtaWx5ID8gZG9jLnRhcmdldEJ5RmFtaWx5LkNBTkFTIDogbnVsbCxcbiAgICAgIGRvYy50YXJnZXRCeUZhbWlseSA/IGRvYy50YXJnZXRCeUZhbWlseS5MSU5FQVMgOiBudWxsLFxuICAgICAgZG9jLnVwZGF0ZWRBdCxcbiAgICAgIGRvYy51cGRhdGVkQnksXG4gICAgICBkb2MudXBkYXRlZEJ5RW1haWwsXG4gICAgXSxcbiAgXTtcbn1cblxuLyoqIEBwYXJhbSB7YW55fSBkb2MgQHJldHVybnMge3Vua25vd25bXVtdfSAqL1xuZXhwb3J0IGZ1bmN0aW9uIGJ1aWxkVmVuZG9yT3ZlcnJpZGVSb3dzKGRvYykge1xuICByZXR1cm4gW1xuICAgIFtcbiAgICAgIGRvYy5faWQsXG4gICAgICBkb2Muc2NvcGUsXG4gICAgICBkb2MucHJvdmluY2UsXG4gICAgICBkb2MubG9jYWxpdHlOYW1lLFxuICAgICAgZG9jLmNsaWVudE5hbWUsXG4gICAgICBkb2Mub3JpZ2luYWxWZW5kb3IsXG4gICAgICBkb2MubmV3VmVuZG9yLFxuICAgICAgZG9jLm5ld1R5cGUsXG4gICAgICBkb2MudXBkYXRlZEF0LFxuICAgICAgZG9jLnVwZGF0ZWRCeVVpZCxcbiAgICAgIGRvYy51cGRhdGVkQnlFbWFpbCxcbiAgICAgIGRvYy51cGRhdGVkQnlEaXNwbGF5TmFtZSxcbiAgICBdLFxuICBdO1xufVxuXG4vKiogQHBhcmFtIHthbnl9IGRvYyBAcmV0dXJucyB7dW5rbm93bltdW119ICovXG5leHBvcnQgZnVuY3Rpb24gYnVpbGRDdXN0b21Sb3V0ZVJvd3MoZG9jKSB7XG4gIGNvbnN0IGhlYWRlciA9IFtcbiAgICBkb2MuX2lkLFxuICAgIGRvYy5vd25lclVpZCxcbiAgICBkb2Mub3duZXJFbWFpbCxcbiAgICBkb2MubmFtZSxcbiAgICBkb2MucGxhbm5lZERhdGUsXG4gICAgZG9jLm5vdGVzLFxuICAgIGRvYy5jcmVhdGVkQXQsXG4gICAgZG9jLnVwZGF0ZWRBdCxcbiAgXTtcbiAgY29uc3Qgc3RvcHMgPSBBcnJheS5pc0FycmF5KGRvYy5zdG9wcykgPyBkb2Muc3RvcHMgOiBbXTtcbiAgaWYgKCFzdG9wcy5sZW5ndGgpIHtcbiAgICByZXR1cm4gW2hlYWRlci5jb25jYXQoW251bGwsIG51bGwsIG51bGwsIG51bGwsIG51bGwsIG51bGwsIG51bGwsIG51bGxdKV07XG4gIH1cbiAgcmV0dXJuIHN0b3BzLm1hcCgoLyoqIEB0eXBlIHthbnl9ICovIHMpID0+XG4gICAgaGVhZGVyLmNvbmNhdChbXG4gICAgICBzID8gcy5vcmRlciA6IG51bGwsXG4gICAgICBzID8gcy5rZXkgOiBudWxsLFxuICAgICAgcyA/IHMudGlwbyA6IG51bGwsXG4gICAgICBzID8gcy5wcm92aW5jaWEgOiBudWxsLFxuICAgICAgcyA/IHMubG9jYWxpZGFkIDogbnVsbCxcbiAgICAgIHMgPyBzLmNsaWVudE5hbWUgOiBudWxsLFxuICAgICAgcyA/IHMuaXNQcm92aXNvcmlvIDogbnVsbCxcbiAgICAgIHMgPyBzLnNhcEFsdGFJZCA6IG51bGwsXG4gICAgXSlcbiAgKTtcbn1cblxuLyoqIEBwYXJhbSB7YW55fSBkb2MgQHJldHVybnMge3Vua25vd25bXVtdfSAqL1xuZXhwb3J0IGZ1bmN0aW9uIGJ1aWxkU2VndWltaWVudG9Ob3RlUm93cyhkb2MpIHtcbiAgcmV0dXJuIFtcbiAgICBbXG4gICAgICBkb2MuX2lkLFxuICAgICAgZG9jLnZlbmRvckV4dCxcbiAgICAgIGRvYy5jbGllbnRLZXksXG4gICAgICBkb2MuY2xpZW50TmFtZSxcbiAgICAgIGRvYy5wcm92aW5jZSxcbiAgICAgIGRvYy5sb2NhbGl0eSxcbiAgICAgIGRvYy50ZXh0LFxuICAgICAgZG9jLmF1dGhvclVpZCxcbiAgICAgIGRvYy5hdXRob3JFbWFpbCxcbiAgICAgIGRvYy5hdXRob3JOYW1lLFxuICAgICAgZG9jLmF1dGhvclJvbGUsXG4gICAgICBkb2MuY3JlYXRlZEF0LFxuICAgIF0sXG4gIF07XG59XG5cbi8qKlxuICogUHJvZHVjdG9zIGRlc2RlIHN0b2NrLmpzb24gKGZvcm1hdG8gU2hpbWFubzoge3N0b2NrOiB7U0tVOiBib29sLCAuLi59LFxuICogcXVhbnRpdGllczogSlNPTiBzdHJpbmcsIHdhcmVob3VzZUJyZWFrZG93bjogSlNPTiBzdHJpbmcsIHVwZGF0ZWRBdDogLi4ufSkuXG4gKiBAcGFyYW0ge29iamVjdH0gc3RvY2tKc29uXG4gKiBAcmV0dXJucyB7dW5rbm93bltdW119XG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBidWlsZFByb2R1Y3RvUm93c0Zyb21TdG9ja0pzb24oc3RvY2tKc29uKSB7XG4gIGNvbnN0IHNqID0gLyoqIEB0eXBlIHthbnl9ICovIChzdG9ja0pzb24pIHx8IHt9O1xuICBjb25zdCBzdG9ja01hcCA9IHNqLnN0b2NrIHx8IHt9O1xuICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIG51bWJlcj59ICovXG4gIGxldCBxdWFudGl0aWVzID0ge307XG4gIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmVjb3JkPHN0cmluZywgbnVtYmVyPj59ICovXG4gIGxldCBicmVha2Rvd24gPSB7fTtcbiAgdHJ5IHtcbiAgICBxdWFudGl0aWVzID0gc2oucXVhbnRpdGllcyA/IEpTT04ucGFyc2Uoc2oucXVhbnRpdGllcykgOiBzai5xdWFudGl0aWVzX21hcCB8fCB7fTtcbiAgfSBjYXRjaCAoXykge31cbiAgdHJ5IHtcbiAgICBicmVha2Rvd24gPSBzai53YXJlaG91c2VCcmVha2Rvd25cbiAgICAgID8gSlNPTi5wYXJzZShzai53YXJlaG91c2VCcmVha2Rvd24pXG4gICAgICA6IHNqLndhcmVob3VzZUJyZWFrZG93bl9tYXAgfHwge307XG4gIH0gY2F0Y2ggKF8pIHt9XG4gIGNvbnN0IHJvd3MgPSAvKiogQHR5cGUge3Vua25vd25bXVtdfSAqLyAoW10pO1xuICBjb25zdCBzb3VyY2UgPSAnc3RvY2suanNvbiBzbmFwc2hvdCc7XG4gIGNvbnN0IHVwZGF0ZWRBdCA9IHNqLnVwZGF0ZWRBdCB8fCBzai5zbmFwc2hvdEF0IHx8IG51bGw7XG4gIGZvciAoY29uc3Qgc2t1IG9mIE9iamVjdC5rZXlzKHN0b2NrTWFwKSkge1xuICAgIGNvbnN0IGhhc19zdG9jayA9ICEhc3RvY2tNYXBbc2t1XTtcbiAgICBjb25zdCB0b3RhbCA9IE51bWJlcihxdWFudGl0aWVzW3NrdV0gfHwgMCk7XG4gICAgY29uc3Qgd2JzID0gYnJlYWtkb3duW3NrdV0gfHwge307XG4gICAgY29uc3QgdzExID0gTnVtYmVyKHdic1snMTEnXSB8fCAwKTtcbiAgICBjb25zdCB3MTIgPSBOdW1iZXIod2JzWycxMiddIHx8IDApO1xuICAgIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgbnVtYmVyPn0gKi9cbiAgICBjb25zdCBvdHJvcyA9IHt9O1xuICAgIGZvciAoY29uc3QgayBvZiBPYmplY3Qua2V5cyh3YnMpKSB7XG4gICAgICBpZiAoayAhPT0gJzExJyAmJiBrICE9PSAnMTInKSBvdHJvc1trXSA9IE51bWJlcih3YnNba10gfHwgMCk7XG4gICAgfVxuICAgIHJvd3MucHVzaChbXG4gICAgICBza3UsXG4gICAgICBoYXNfc3RvY2ssXG4gICAgICB0b3RhbCxcbiAgICAgIHcxMSxcbiAgICAgIHcxMixcbiAgICAgIE9iamVjdC5rZXlzKG90cm9zKS5sZW5ndGggPyBvdHJvcyA6IG51bGwsXG4gICAgICBzb3VyY2UsXG4gICAgICB1cGRhdGVkQXQsXG4gICAgXSk7XG4gIH1cbiAgcmV0dXJuIHJvd3M7XG59XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gRGlzcGF0Y2hlcjogbWFwYSBjb2xsZWN0aW9uIC0+IHJvdyBidWlsZGVyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCAoZG9jOiBhbnkpID0+IHVua25vd25bXVtdPn0gKi9cbmV4cG9ydCBjb25zdCBST1dfQlVJTERFUlMgPSB7XG4gIHBlZGlkb3M6IGJ1aWxkUGVkaWRvUm93cyxcbiAgdmlzaXRhczogYnVpbGRWaXNpdGFSb3dzLFxuICBjbGllbnRlczogYnVpbGRDbGllbnRlUm93cyxcbiAgY2xpZW50X21hc3RlcjogYnVpbGRDbGllbnRNYXN0ZXJSb3dzLFxuICByZW5kaWNpb25lczogYnVpbGRSZW5kaWNpb25Sb3dzLFxuICBjYW1wYW5pYXM6IGJ1aWxkQ2FtcGFuaWFSb3dzLFxuICB0YXJnZXRzOiBidWlsZFRhcmdldFJvd3MsXG4gIHZlbmRvcl9vdmVycmlkZXM6IGJ1aWxkVmVuZG9yT3ZlcnJpZGVSb3dzLFxuICBjdXN0b21fcm91dGVzOiBidWlsZEN1c3RvbVJvdXRlUm93cyxcbiAgc2VndWltaWVudG9fbm90ZXM6IGJ1aWxkU2VndWltaWVudG9Ob3RlUm93cyxcbn07XG4iLCAiLy8gQHRzLW5vY2hlY2tcclxuLy8gRVhQT1JUUy1BRFZBTkNFRDogcGhvdG8gWklQcywgYXVkaXQgWExTWCwgZXhlY3V0aXZlIHN1bW1hcnksIHZpc2l0cyBYTFNYLFxyXG4vLyBQb3dlckJJIGRhdGFzZXQsIE1MIGRhdGFzZXQuIEV4dHJhXHUwMEVEZG8gdmVyYmF0aW0gZGUgaW5kZXguaHRtbCAoNCBmcmFnbWVudG9zXHJcbi8vIGRpc2NvbnRpbnVvcyBzZXBhcmFkb3MgcG9yIEJhY2t1cCArIEF1ZGl0ICsgX2V4cG9ydExlZ2FjeUZ1bGwgcXVlIHF1ZWRhblxyXG4vLyBlbiBlbCBpbmxpbmUpIGNvbW8gcGFydGUgZGUgRTIubi4yIChlMmItcGVyZiAyMDI2LTA3LTI4KS5cclxuLy9cclxuLy8gdjM3MSs6IGV4cG9ydERhdGFzZXRaaXAoKSBudWV2byBcdTIwMTQgWklQIGNvbiBDU1ZzIHBvciBlbnRpZGFkIHBhcmEgcGlwZWxpbmVzXHJcbi8vIE1MIGV4dGVybm9zIChNaWNyb3NvZnQgRmFicmljKS4gSW1wb3J0YSBsb3MgaGVscGVycyBwdXJvcyB5IHNjaGVtYXMgZGVsXHJcbi8vIG1vZHVsbyBzcmMvcHVyZS9jc3Ytc2VyaWFsaXplci5qcy4gVmVyIHBsYW4gY29zbWljLXBvbmRlcmluZy1zdGVhcm5zLm1kLlxyXG5cclxuaW1wb3J0IHtcclxuICBidWlsZENzdixcclxuICBidWlsZFByb2R1Y3RvUm93c0Zyb21TdG9ja0pzb24sXHJcbiAgY29tcHV0ZU51bGxSYXRlcyxcclxuICBEQVRBU0VUX1NDSEVNQVMsXHJcbiAgREFUQVNFVF9VU0VfQ0FTRV9NQVRSSVgsXHJcbiAgUk9XX0JVSUxERVJTLFxyXG59IGZyb20gJy4uL3B1cmUvY3N2LXNlcmlhbGl6ZXIuanMnO1xyXG5cclxuLy9cclxuLy8gRGVwcyBkZWwgaW5saW5lOiBKU1ppcCAoQ0ROIGxhenkpLCBFeGNlbEpTIChDRE4gbGF6eSB2aWEgbG9hZEV4Y2VsSlMpLFxyXG4vLyBYTFNYIChkZWZlciBlbiBoZWFkKSwgdmlzaXRzQ2FjaGUsIGNhbXBhaWduc0NhY2hlLCBvcHNMb2dDYWNoZSAoYXVkaXRcclxuLy8gaW5saW5lKSwgYXVkaXRMb2dDYWNoZSAoYXVkaXQgaW5saW5lKSwgY29udGFjdGVkIChnbG9iYWwgU2V0KSwgUE9JTlRTLFxyXG4vLyBQUk9EVUNUUywgVkVORE9SUywgTUVTRVMsIHZlbmRvckxvb2t1cCwgZXNjYXBlSHRtbCwgZXNjYXBlQXR0ciwgdGl0bGVDYXNlLFxyXG4vLyBzaG93U3luY1RhZywgY3VycmVudFVzZXIsIHVzZXJSb2xlLCBvcmRlcnMsIGNvbmZpcm1lZCwgcGVuZGluZy5cclxuLy9cclxuLy8gQ3Jvc3Mtc2NvcGUgc3RhdGU6IE5PTkUgKHRvZG9zIGxvcyBoZWxwZXJzIHkgY29uc3RzIGxvY2FsZXMgYWwgYmxvcXVlKS5cclxuLy8gU2luIGxpc3RlbmVycyBvblNuYXBzaG90LlxyXG4vL1xyXG4vLyBOT1RBOiBsb3MgaGVscGVycyB0b2RheVN0ci9kYXRhVXJsVG9CbG9iL3Nhbml0aXplRm9yUGF0aCB2aXZlbiBlbiBlc3RlXHJcbi8vIG1cdTAwRjNkdWxvIFx1MjAxNCBlbCBpbmxpbmUgcHVlZGUgbGxhbWFybG9zIHZpYSBmcmVlIHJlZmVyZW5jZSBhbCBHbG9iYWwgRW52aXJvbm1lbnRcclxuLy8gUmVjb3JkIHBlcm8gcHJlZmVyaW1vcyBleHBvc2ljaVx1MDBGM24gd2luZG93LiogZXhwbFx1MDBFRGNpdGEgYWwgZmluYWwuXHJcblxyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XHJcbi8vIFNFQ0NJXHUwMEQzTjogaGVscGVycyArIHBob3RvcyB6aXAgKyB2aXNpdHMgZW1iZWRkZWQgKGlubGluZSBMOTI1Ni05NDQ1KVxyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxuXHJcbmZ1bmN0aW9uIHRvZGF5U3RyKCkge1xyXG4gIHJldHVybiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwgMTApO1xyXG59XHJcblxyXG4vLyBIZWxwZXI6IGNvbnZlcnRpciBkYXRhVVJMIGJhc2U2NCBhIEJsb2IgcGFyYSBpbmNsdWlyIGVuIFpJUFxyXG5mdW5jdGlvbiBkYXRhVXJsVG9CbG9iKGRhdGFVcmwpIHtcclxuICBpZiAoIWRhdGFVcmwpIHJldHVybiBudWxsO1xyXG4gIGNvbnN0IHBhcnRzID0gZGF0YVVybC5zcGxpdCgnLCcpO1xyXG4gIGlmIChwYXJ0cy5sZW5ndGggPCAyKSByZXR1cm4gbnVsbDtcclxuICBjb25zdCBtaW1lTWF0Y2ggPSBwYXJ0c1swXS5tYXRjaCgvOiguKj8pOy8pO1xyXG4gIGNvbnN0IG1pbWUgPSBtaW1lTWF0Y2ggPyBtaW1lTWF0Y2hbMV0gOiAnaW1hZ2UvanBlZyc7XHJcbiAgY29uc3QgYnl0ZXMgPSBhdG9iKHBhcnRzWzFdKTtcclxuICBjb25zdCBhcnIgPSBuZXcgVWludDhBcnJheShieXRlcy5sZW5ndGgpO1xyXG4gIGZvciAobGV0IGkgPSAwOyBpIDwgYnl0ZXMubGVuZ3RoOyBpKyspIGFycltpXSA9IGJ5dGVzLmNoYXJDb2RlQXQoaSk7XHJcbiAgcmV0dXJuIG5ldyBCbG9iKFthcnJdLCB7IHR5cGU6IG1pbWUgfSk7XHJcbn1cclxuXHJcbi8vIFNhbmVhciBub21icmVzIHBhcmEgcXVlIHNpcnZhbiBjb21vIHJ1dGEgZGUgYXJjaGl2b1xyXG5mdW5jdGlvbiBzYW5pdGl6ZUZvclBhdGgocykge1xyXG4gIHJldHVybiBTdHJpbmcocyB8fCAnJylcclxuICAgIC5yZXBsYWNlKC9bXFxcXC8qP1tcXF06fFwiPD5dL2csICdfJylcclxuICAgIC5yZXBsYWNlKC9cXHMrL2csICcgJylcclxuICAgIC50cmltKClcclxuICAgIC5zbGljZSgwLCA2MCk7XHJcbn1cclxuXHJcbi8vIERlc2NhcmdhciB0b2RhcyBsYXMgZm90b3MgZGUgdmlzaXRhcyBlbiB1biBaSVAgb3JnYW5pemFkbyBwb3IgdmVuZGVkb3IgLyB0aWVuZGEgLyBmZWNoYVxyXG53aW5kb3cuZXhwb3J0UGhvdG9zWmlwID0gYXN5bmMgZnVuY3Rpb24gKCkge1xyXG4gIC8vIHY2NzkgUEVSRiBGYXNlIDM6IEpTWmlwIGxhenkgb24tZGVtYW5kXHJcbiAgdHJ5IHtcclxuICAgIGF3YWl0IHdpbmRvdy5sb2FkSlNaaXAoKTtcclxuICB9IGNhdGNoIChlKSB7XHJcbiAgICBhbGVydCgnTm8gc2UgcHVkbyBjYXJnYXIgSlNaaXA6ICcgKyBlLm1lc3NhZ2UpO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuICBpZiAoIXZpc2l0c0NhY2hlIHx8ICF2aXNpdHNDYWNoZS5sZW5ndGgpIHtcclxuICAgIGFsZXJ0KCdObyBoYXkgdmlzaXRhcyByZWdpc3RyYWRhcy4nKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgbGV0IHBob3RvQ291bnQgPSAwO1xyXG4gIGNvbnN0IHppcCA9IG5ldyBKU1ppcCgpO1xyXG4gIHZpc2l0c0NhY2hlLmZvckVhY2goKHYpID0+IHtcclxuICAgIGNvbnN0IHZlbmRvciA9IHNhbml0aXplRm9yUGF0aCh0aXRsZUNhc2Uodi52ZW5kb3IgfHwgJ1NJTl9WRU5ERURPUicpKTtcclxuICAgIGNvbnN0IHRpZW5kYSA9IHNhbml0aXplRm9yUGF0aCh2LnRpZW5kYSB8fCAnc2luX3RpZW5kYScpO1xyXG4gICAgY29uc3QgZmVjaGEgPSAodi5mZWNoYSB8fCAnJykucmVwbGFjZSgvLS9nLCAnJyk7XHJcbiAgICBjb25zdCBmb2xkZXJOYW1lID0gdmVuZG9yICsgJy8nICsgdGllbmRhICsgJ18nICsgZmVjaGE7XHJcbiAgICBjb25zdCBmb2xkZXIgPSB6aXAuZm9sZGVyKGZvbGRlck5hbWUpO1xyXG4gICAgaWYgKHYuZnJlbnRlTG9jYWwpIHtcclxuICAgICAgY29uc3QgYiA9IGRhdGFVcmxUb0Jsb2Iodi5mcmVudGVMb2NhbCk7XHJcbiAgICAgIGlmIChiKSB7XHJcbiAgICAgICAgZm9sZGVyLmZpbGUoJ2ZyZW50ZS5qcGcnLCBiKTtcclxuICAgICAgICBwaG90b0NvdW50Kys7XHJcbiAgICAgIH1cclxuICAgIH1cclxuICAgICh2LmVzcGFjaW8gfHwgW10pLmZvckVhY2goKGI2NCwgaSkgPT4ge1xyXG4gICAgICBjb25zdCBiID0gZGF0YVVybFRvQmxvYihiNjQpO1xyXG4gICAgICBpZiAoYikge1xyXG4gICAgICAgIGZvbGRlci5maWxlKCdlc3BhY2lvXycgKyAoaSArIDEpICsgJy5qcGcnLCBiKTtcclxuICAgICAgICBwaG90b0NvdW50Kys7XHJcbiAgICAgIH1cclxuICAgIH0pO1xyXG4gIH0pO1xyXG4gIGlmICghcGhvdG9Db3VudCkge1xyXG4gICAgYWxlcnQoJ05vIGhheSBmb3RvcyBjYXJnYWRhcyBlbiBsYXMgdmlzaXRhcy4nKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgc2hvd1N5bmNUYWcoJ0dlbmVyYW5kbyBaSVAgZGUgJyArIHBob3RvQ291bnQgKyAnIGZvdG9zLi4uJywgMzAwMDApO1xyXG4gIHRyeSB7XHJcbiAgICBjb25zdCBibG9iID0gYXdhaXQgemlwLmdlbmVyYXRlQXN5bmMoeyB0eXBlOiAnYmxvYicsIGNvbXByZXNzaW9uOiAnREVGTEFURScgfSk7XHJcbiAgICBjb25zdCB1cmwgPSBVUkwuY3JlYXRlT2JqZWN0VVJMKGJsb2IpO1xyXG4gICAgY29uc3QgYSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2EnKTtcclxuICAgIGEuaHJlZiA9IHVybDtcclxuICAgIGEuZG93bmxvYWQgPSAnU2hpbWFub19Gb3Rvc19WaXNpdGFzXycgKyB0b2RheVN0cigpICsgJy56aXAnO1xyXG4gICAgYS5jbGljaygpO1xyXG4gICAgc2V0VGltZW91dCgoKSA9PiBVUkwucmV2b2tlT2JqZWN0VVJMKHVybCksIDUwMDApO1xyXG4gICAgc2hvd1N5bmNUYWcocGhvdG9Db3VudCArICcgZm90b3MgZGVzY2FyZ2FkYXMnLCAzMDAwKTtcclxuICB9IGNhdGNoIChlKSB7XHJcbiAgICBjb25zb2xlLmVycm9yKCd6aXAnLCBlKTtcclxuICAgIGFsZXJ0KCdFcnJvciBnZW5lcmFuZG8gWklQOiAnICsgKGUubWVzc2FnZSB8fCBlKSk7XHJcbiAgfVxyXG59O1xyXG5cclxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XHJcbi8vIEV4Y2VsIGNvbiBmb3RvcyBkZWwgZnJlbnRlIGVtYmViaWRhcyBlbiBjYWRhIGNlbGRhIChFeGNlbEpTKVxyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxuLy8gRXhjZWxKUyBzZSBjYXJnYSBsYXp5IChzb2xvIGN1YW5kbyBzZSB0b2NhIGVsIGJvdG9uKSBwYXJhIG5vIGluZmxhciBlbCBidW5kbGUuXHJcbmZ1bmN0aW9uIGxvYWRFeGNlbEpTKCkge1xyXG4gIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XHJcbiAgICBpZiAodHlwZW9mIEV4Y2VsSlMgIT09ICd1bmRlZmluZWQnKSByZXR1cm4gcmVzb2x2ZSgpO1xyXG4gICAgY29uc3QgcyA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3NjcmlwdCcpO1xyXG4gICAgcy5zcmMgPSAnaHR0cHM6Ly9jZG4uanNkZWxpdnIubmV0L25wbS9leGNlbGpzQDQuNC4wL2Rpc3QvZXhjZWxqcy5taW4uanMnO1xyXG4gICAgcy5vbmxvYWQgPSAoKSA9PiByZXNvbHZlKCk7XHJcbiAgICBzLm9uZXJyb3IgPSAoKSA9PlxyXG4gICAgICByZWplY3QobmV3IEVycm9yKCdObyBzZSBwdWRvIGNhcmdhciBsYSBsaWJyZXJpYSBFeGNlbEpTLiBSZXZpc2EgdHUgY29uZXhpb24gYSBpbnRlcm5ldC4nKSk7XHJcbiAgICBkb2N1bWVudC5oZWFkLmFwcGVuZENoaWxkKHMpO1xyXG4gIH0pO1xyXG59XHJcblxyXG53aW5kb3cuZXhwb3J0VmlzaXRzV2l0aEVtYmVkZGVkUGhvdG9zID0gYXN5bmMgZnVuY3Rpb24gKCkge1xyXG4gIGlmICghdmlzaXRzQ2FjaGUgfHwgIXZpc2l0c0NhY2hlLmxlbmd0aCkge1xyXG4gICAgYWxlcnQoJ05vIGhheSB2aXNpdGFzIHJlZ2lzdHJhZGFzLicpO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuICBjb25zdCBuID0gdmlzaXRzQ2FjaGUubGVuZ3RoO1xyXG4gIGlmIChuID4gMzAwKSB7XHJcbiAgICBpZiAoXHJcbiAgICAgICFjb25maXJtKFxyXG4gICAgICAgICdIYXkgJyArXHJcbiAgICAgICAgICBuICtcclxuICAgICAgICAgICcgdmlzaXRhcy4gRWwgRXhjZWwgY29uIHRvZGFzIGxhcyBmb3RvcyBlbWJlYmlkYXMgcHVlZGUgcGVzYXIgNTAtMTUwIE1CIHkgdGFyZGFyIHZhcmlvcyBtaW51dG9zLiBcdTAwQkZDb250aW51YXI/J1xyXG4gICAgICApXHJcbiAgICApXHJcbiAgICAgIHJldHVybjtcclxuICB9IGVsc2UgaWYgKG4gPiAxMDApIHtcclxuICAgIGlmIChcclxuICAgICAgIWNvbmZpcm0oXHJcbiAgICAgICAgJ1ZhcyBhIGdlbmVyYXIgdW4gRXhjZWwgY29uICcgK1xyXG4gICAgICAgICAgbiArXHJcbiAgICAgICAgICAnIHZpc2l0YXMgeSBzdXMgZm90b3MgZW1iZWJpZGFzLiBQdWVkZSB0YXJkYXIgMzAtNjAgc2VndW5kb3MuIFx1MDBCRkNvbnRpbnVhcj8nXHJcbiAgICAgIClcclxuICAgIClcclxuICAgICAgcmV0dXJuO1xyXG4gIH1cclxuICBzaG93U3luY1RhZygnQ2FyZ2FuZG8gRXhjZWxKUy4uLicsIDIwMDApO1xyXG4gIHRyeSB7XHJcbiAgICBhd2FpdCBsb2FkRXhjZWxKUygpO1xyXG4gIH0gY2F0Y2ggKGUpIHtcclxuICAgIGFsZXJ0KGUubWVzc2FnZSB8fCBlKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcblxyXG4gIHNob3dTeW5jVGFnKCdHZW5lcmFuZG8gRXhjZWwgY29uICcgKyBuICsgJyB2aXNpdGFzLi4uJywgMzAwMCk7XHJcblxyXG4gIGNvbnN0IHdiID0gbmV3IEV4Y2VsSlMuV29ya2Jvb2soKTtcclxuICB3Yi5jcmVhdG9yID0gJ0FwcCBWZW5kZWRvcmVzIFNoaW1hbm8nO1xyXG4gIHdiLmNyZWF0ZWQgPSBuZXcgRGF0ZSgpO1xyXG4gIGNvbnN0IHdzID0gd2IuYWRkV29ya3NoZWV0KCdWaXNpdGFzJywgeyB2aWV3czogW3sgc3RhdGU6ICdmcm96ZW4nLCB5U3BsaXQ6IDEgfV0gfSk7XHJcblxyXG4gIC8vIERlZmluaWNpb24gZGUgY29sdW1uYXMuIExhIGNvbHVtbmEgZGUgZm90byB2YSBhIHRlbmVyIGFuY2hvIGV4dHJhIHBhcmEgcXVlIHNlIHZlYS5cclxuICB3cy5jb2x1bW5zID0gW1xyXG4gICAgeyBoZWFkZXI6ICdGZWNoYScsIGtleTogJ2ZlY2hhJywgd2lkdGg6IDEyIH0sXHJcbiAgICB7IGhlYWRlcjogJ01lcycsIGtleTogJ21lcycsIHdpZHRoOiAxMCB9LFxyXG4gICAgeyBoZWFkZXI6ICdWZW5kZWRvcicsIGtleTogJ3ZlbmRlZG9yJywgd2lkdGg6IDIyIH0sXHJcbiAgICB7IGhlYWRlcjogJ1RpcG8gY29udGFjdG8nLCBrZXk6ICd0aXBvQ3QnLCB3aWR0aDogMTIgfSxcclxuICAgIHsgaGVhZGVyOiAnQ29tZW50YXJpbycsIGtleTogJ2NvbWVudCcsIHdpZHRoOiAzMiB9LFxyXG4gICAgeyBoZWFkZXI6ICdQcm92aW5jaWEnLCBrZXk6ICdwcm92aW5jaWEnLCB3aWR0aDogMTYgfSxcclxuICAgIHsgaGVhZGVyOiAnTG9jYWxpZGFkJywga2V5OiAnbG9jYWxpZGFkJywgd2lkdGg6IDE4IH0sXHJcbiAgICB7IGhlYWRlcjogJ1RpZW5kYScsIGtleTogJ3RpZW5kYScsIHdpZHRoOiAzMCB9LFxyXG4gICAgeyBoZWFkZXI6ICdUaXBvJywga2V5OiAndGlwbycsIHdpZHRoOiAxMiB9LFxyXG4gICAgeyBoZWFkZXI6ICdMb2NhbCcsIGtleTogJ2xvY2FsJywgd2lkdGg6IDEyIH0sXHJcbiAgICB7IGhlYWRlcjogJ1RhbWFubycsIGtleTogJ3RhbWFubycsIHdpZHRoOiAxMCB9LFxyXG4gICAgeyBoZWFkZXI6ICdGaWRlbGlkYWQnLCBrZXk6ICdmaWRlbGlkYWQnLCB3aWR0aDogMTAgfSxcclxuICAgIHsgaGVhZGVyOiAnUmVsZXZhbmNpYScsIGtleTogJ3JlbGV2Jywgd2lkdGg6IDEwIH0sXHJcbiAgICB7IGhlYWRlcjogJ1BPUCcsIGtleTogJ3BvcCcsIHdpZHRoOiA4IH0sXHJcbiAgICB7IGhlYWRlcjogJ1RpcG8gdmVudGEnLCBrZXk6ICd0aXBvVmVudGEnLCB3aWR0aDogMTIgfSxcclxuICAgIHsgaGVhZGVyOiAnQ29tcGV0ZW5jaWEnLCBrZXk6ICdjb21wZScsIHdpZHRoOiAxNiB9LFxyXG4gICAgeyBoZWFkZXI6ICdPcG9ydHVuaWRhZCcsIGtleTogJ29wb3J0dScsIHdpZHRoOiAzMCB9LFxyXG4gICAgeyBoZWFkZXI6ICdMbyBtYXMgdmVuZGlkbycsIGtleTogJ21hc1ZlJywgd2lkdGg6IDI4IH0sXHJcbiAgICB7IGhlYWRlcjogJ0dQUyBkaXN0IChtKScsIGtleTogJ2dwc0Rpc3QnLCB3aWR0aDogMTIgfSxcclxuICAgIHsgaGVhZGVyOiAnRm90byBmcmVudGUnLCBrZXk6ICdmb3RvJywgd2lkdGg6IDIyIH0sIC8vIDwtIGxhIGltYWdlbiB2YSBhY2FcclxuICAgIHsgaGVhZGVyOiAnRW1haWwgdmVuZGVkb3InLCBrZXk6ICdlbWFpbCcsIHdpZHRoOiAyOCB9LFxyXG4gIF07XHJcblxyXG4gIC8vIEVzdGlsbyBoZWFkZXJcclxuICB3cy5nZXRSb3coMSkuZm9udCA9IHsgYm9sZDogdHJ1ZSwgY29sb3I6IHsgYXJnYjogJ0ZGRkZGRkZGJyB9IH07XHJcbiAgd3MuZ2V0Um93KDEpLmZpbGwgPSB7IHR5cGU6ICdwYXR0ZXJuJywgcGF0dGVybjogJ3NvbGlkJywgZmdDb2xvcjogeyBhcmdiOiAnRkYwQzRBNkUnIH0gfTtcclxuICB3cy5nZXRSb3coMSkuYWxpZ25tZW50ID0geyB2ZXJ0aWNhbDogJ21pZGRsZScsIGhvcml6b250YWw6ICdjZW50ZXInIH07XHJcbiAgd3MuZ2V0Um93KDEpLmhlaWdodCA9IDIyO1xyXG5cclxuICBjb25zdCBGT1RPX0NPTF9JRFggPSB3cy5nZXRDb2x1bW4oJ2ZvdG8nKS5udW1iZXIgLSAxOyAvLyAwLWluZGV4ZWQgcGFyYSBhZGRJbWFnZVxyXG4gIGNvbnN0IFJPV19IID0gMTAwO1xyXG4gIGNvbnN0IElNR19XID0gMTMwO1xyXG4gIGNvbnN0IElNR19IID0gOTA7XHJcblxyXG4gIC8vIE9yZGVuYXIgdmlzaXRhcyBwb3IgZmVjaGEgZGVzYyAobWFzIHJlY2llbnRlcyBwcmltZXJvKVxyXG4gIGNvbnN0IHNvcnRlZCA9IHZpc2l0c0NhY2hlLnNsaWNlKCkuc29ydCgoYSwgYikgPT4gKGIuZmVjaGEgfHwgJycpLmxvY2FsZUNvbXBhcmUoYS5mZWNoYSB8fCAnJykpO1xyXG5cclxuICBmb3IgKGNvbnN0IHYgb2Ygc29ydGVkKSB7XHJcbiAgICBjb25zdCB0aXBvQ29udGFjdG9MYmwgPSB2LnRpcG9Db250YWN0byA9PT0gJ3RlbGVmb25vJyA/ICdUZWxlZm9ubycgOiAnUHJlc2VuY2lhbCc7XHJcbiAgICBjb25zdCByID0gd3MuYWRkUm93KHtcclxuICAgICAgZmVjaGE6IHYuZmVjaGEgfHwgJycsXHJcbiAgICAgIG1lczogdi5tZXMgfHwgJycsXHJcbiAgICAgIHZlbmRlZG9yOiB0aXRsZUNhc2Uodi52ZW5kb3IgfHwgJycpLFxyXG4gICAgICB0aXBvQ3Q6IHRpcG9Db250YWN0b0xibCxcclxuICAgICAgY29tZW50OiB2LmNvbWVudGFyaW8gfHwgJycsXHJcbiAgICAgIHByb3ZpbmNpYTogdGl0bGVDYXNlKHYucHJvdmluY2lhIHx8ICcnKSxcclxuICAgICAgbG9jYWxpZGFkOiB2LmxvY2FsaWRhZCB8fCAnJyxcclxuICAgICAgdGllbmRhOiB2LnRpZW5kYSB8fCAnJyxcclxuICAgICAgdGlwbzogdi50aXBvIHx8ICcnLFxyXG4gICAgICBsb2NhbDogdi5sb2NhbCB8fCAnJyxcclxuICAgICAgdGFtYW5vOiB2LnRhbWFubyB8fCAnJyxcclxuICAgICAgZmlkZWxpZGFkOiB2LmZpZGVsaWRhZCB8fCAnJyxcclxuICAgICAgcmVsZXY6IHYucmVsZXZhbmNpYSB8fCAnJyxcclxuICAgICAgcG9wOiB2LnBvcCB8fCAnJyxcclxuICAgICAgdGlwb1ZlbnRhOiB2LnRpcG9WZW50YSA9PT0gJ01PU1RSQURPJyA/ICdNT1NUUkFET1InIDogdi50aXBvVmVudGEgfHwgJycsXHJcbiAgICAgIGNvbXBlOiB2LmNvbXBldGVuY2lhIHx8ICcnLFxyXG4gICAgICBvcG9ydHU6IHYub3BvcnR1bmlkYWQgfHwgJycsXHJcbiAgICAgIG1hc1ZlOiB2Lm1hc1ZlbmRpZG8gfHwgJycsXHJcbiAgICAgIGdwc0Rpc3Q6IHR5cGVvZiB2Lmdwc0Rpc3RhbmNlTSA9PT0gJ251bWJlcicgPyB2Lmdwc0Rpc3RhbmNlTSA6ICcnLFxyXG4gICAgICBmb3RvOiAnJywgLy8gbGEgY2VsZGEgcXVlZGEgdmFjaWE7IGVuY2ltYSB2YSBsYSBpbWFnZW5cclxuICAgICAgZW1haWw6IHYub3duZXJFbWFpbCB8fCAnJyxcclxuICAgIH0pO1xyXG4gICAgci5oZWlnaHQgPSBST1dfSDtcclxuICAgIHIuYWxpZ25tZW50ID0geyB2ZXJ0aWNhbDogJ21pZGRsZScsIHdyYXBUZXh0OiB0cnVlIH07XHJcbiAgICBpZiAodi5mcmVudGVMb2NhbCAmJiB0eXBlb2Ygdi5mcmVudGVMb2NhbCA9PT0gJ3N0cmluZycpIHtcclxuICAgICAgdHJ5IHtcclxuICAgICAgICAvLyBFbCBjYW1wbyBlcyB1biBkYXRhVVJMOiAnZGF0YTppbWFnZS9qcGVnO2Jhc2U2NCwvOWovNEFBUS4uLidcclxuICAgICAgICBsZXQgYjY0ID0gdi5mcmVudGVMb2NhbDtcclxuICAgICAgICBsZXQgZXh0ID0gJ2pwZWcnO1xyXG4gICAgICAgIGNvbnN0IG0gPSAvXmRhdGE6aW1hZ2VcXC8oXFx3Kyk7YmFzZTY0LCguKykkL2kuZXhlYyhiNjQpO1xyXG4gICAgICAgIGlmIChtKSB7XHJcbiAgICAgICAgICBleHQgPSBtWzFdLnRvTG93ZXJDYXNlKCk7XHJcbiAgICAgICAgICBiNjQgPSBtWzJdO1xyXG4gICAgICAgIH1cclxuICAgICAgICBpZiAoZXh0ID09PSAnanBnJykgZXh0ID0gJ2pwZWcnO1xyXG4gICAgICAgIGNvbnN0IGltYWdlSWQgPSB3Yi5hZGRJbWFnZSh7IGJhc2U2NDogYjY0LCBleHRlbnNpb246IGV4dCB9KTtcclxuICAgICAgICB3cy5hZGRJbWFnZShpbWFnZUlkLCB7XHJcbiAgICAgICAgICB0bDogeyBjb2w6IEZPVE9fQ09MX0lEWCArIDAuMSwgcm93OiByLm51bWJlciAtIDEgKyAwLjEgfSxcclxuICAgICAgICAgIGV4dDogeyB3aWR0aDogSU1HX1csIGhlaWdodDogSU1HX0ggfSxcclxuICAgICAgICAgIGVkaXRBczogJ29uZUNlbGwnLFxyXG4gICAgICAgIH0pO1xyXG4gICAgICB9IGNhdGNoIChlKSB7XHJcbiAgICAgICAgY29uc29sZS53YXJuKCdlbWJlYmllbmRvIGZvdG8gZmlsYScsIHIubnVtYmVyLCBlKTtcclxuICAgICAgfVxyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgLy8gR2VuZXJhciB5IGRlc2NhcmdhclxyXG4gIHRyeSB7XHJcbiAgICBjb25zdCBidWZmZXIgPSBhd2FpdCB3Yi54bHN4LndyaXRlQnVmZmVyKCk7XHJcbiAgICBjb25zdCBibG9iID0gbmV3IEJsb2IoW2J1ZmZlcl0sIHtcclxuICAgICAgdHlwZTogJ2FwcGxpY2F0aW9uL3ZuZC5vcGVueG1sZm9ybWF0cy1vZmZpY2Vkb2N1bWVudC5zcHJlYWRzaGVldG1sLnNoZWV0JyxcclxuICAgIH0pO1xyXG4gICAgY29uc3QgdXJsID0gVVJMLmNyZWF0ZU9iamVjdFVSTChibG9iKTtcclxuICAgIGNvbnN0IGEgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdhJyk7XHJcbiAgICBhLmhyZWYgPSB1cmw7XHJcbiAgICBhLmRvd25sb2FkID0gJ1NoaW1hbm9fVmlzaXRhc19jb25fZm90b3NfJyArIHRvZGF5U3RyKCkgKyAnLnhsc3gnO1xyXG4gICAgZG9jdW1lbnQuYm9keS5hcHBlbmRDaGlsZChhKTtcclxuICAgIGEuY2xpY2soKTtcclxuICAgIGRvY3VtZW50LmJvZHkucmVtb3ZlQ2hpbGQoYSk7XHJcbiAgICBzZXRUaW1lb3V0KCgpID0+IFVSTC5yZXZva2VPYmplY3RVUkwodXJsKSwgNTAwMCk7XHJcbiAgICBzaG93U3luY1RhZygnRXhjZWwgZGVzY2FyZ2FkbzogJyArIHNvcnRlZC5sZW5ndGggKyAnIHZpc2l0YXMnLCAzMDAwKTtcclxuICB9IGNhdGNoIChlKSB7XHJcbiAgICBjb25zb2xlLmVycm9yKCdleHBvcnRWaXNpdHNXaXRoRW1iZWRkZWRQaG90b3MnLCBlKTtcclxuICAgIGFsZXJ0KCdFcnJvciBnZW5lcmFuZG8gZWwgRXhjZWw6ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcclxuICB9XHJcbn07XHJcblxyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XHJcbi8vIFNFQ0NJXHUwMEQzTjogZXhwb3J0QXVkaXRFeGNlbCAoaW5saW5lIEwxMDA0MC0xMDA2NylcclxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XHJcblxyXG53aW5kb3cuZXhwb3J0QXVkaXRFeGNlbCA9IGZ1bmN0aW9uICgpIHtcclxuICBpZiAodHlwZW9mIFhMU1ggPT09ICd1bmRlZmluZWQnKSB7XHJcbiAgICBhbGVydCgnTGEgbGlicmVyaWEgZGUgRXhjZWwgbm8gc2UgY2FyZ28uJyk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIGNvbnN0IGl0ZW1zID0gZ2V0RmlsdGVyZWRBdWRpdEVudHJpZXMoKTtcclxuICBpZiAoIWl0ZW1zLmxlbmd0aCkge1xyXG4gICAgYWxlcnQoJ05vIGhheSBldmVudG9zIHBhcmEgZXhwb3J0YXIgY29uIGxvcyBmaWx0cm9zIGFwbGljYWRvcy4nKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgY29uc3Qgcm93cyA9IGl0ZW1zLm1hcCgoZSkgPT4ge1xyXG4gICAgY29uc3QgdHMgPSBlLnRpbWVzdGFtcCAmJiBlLnRpbWVzdGFtcC50b0RhdGUgPyBlLnRpbWVzdGFtcC50b0RhdGUoKSA6IG51bGw7XHJcbiAgICByZXR1cm4ge1xyXG4gICAgICBGZWNoYV9Ib3JhOiB0cyA/IHRzLnRvSVNPU3RyaW5nKCkucmVwbGFjZSgnVCcsICcgJykuc2xpY2UoMCwgMTkpIDogJycsXHJcbiAgICAgIFVzdWFyaW9fRW1haWw6IGUudXNlckVtYWlsIHx8ICcnLFxyXG4gICAgICBVc3VhcmlvX1VJRDogZS51c2VyVWlkIHx8ICcnLFxyXG4gICAgICBSb2w6IGUudXNlclJvbGUgfHwgJycsXHJcbiAgICAgIEFjY2lvbjogQVVESVRfQUNUSU9OX0xBQkVMU1tlLmFjdGlvbl0gfHwgZS5hY3Rpb24gfHwgJycsXHJcbiAgICAgIEFjY2lvbl9SYXc6IGUuYWN0aW9uIHx8ICcnLFxyXG4gICAgICBUaXBvX0VudGlkYWQ6IGUuZW50aXR5VHlwZSB8fCAnJyxcclxuICAgICAgRW50aWRhZDogZS5lbnRpdHlOYW1lIHx8ICcnLFxyXG4gICAgICBEZXRhbGxlc19KU09OOiBlLmRldGFpbHMgPyBKU09OLnN0cmluZ2lmeShlLmRldGFpbHMpIDogJycsXHJcbiAgICB9O1xyXG4gIH0pO1xyXG4gIGNvbnN0IHdiID0gWExTWC51dGlscy5ib29rX25ldygpO1xyXG4gIGNvbnN0IHdzID0gWExTWC51dGlscy5qc29uX3RvX3NoZWV0KHJvd3MpO1xyXG4gIHdzWychY29scyddID0gW1xyXG4gICAgeyB3Y2g6IDIwIH0sXHJcbiAgICB7IHdjaDogMzAgfSxcclxuICAgIHsgd2NoOiAzMCB9LFxyXG4gICAgeyB3Y2g6IDEwIH0sXHJcbiAgICB7IHdjaDogMjQgfSxcclxuICAgIHsgd2NoOiAyMCB9LFxyXG4gICAgeyB3Y2g6IDE0IH0sXHJcbiAgICB7IHdjaDogNDAgfSxcclxuICAgIHsgd2NoOiA2MCB9LFxyXG4gIF07XHJcbiAgWExTWC51dGlscy5ib29rX2FwcGVuZF9zaGVldCh3Yiwgd3MsICdBdWRpdG9yaWEnKTtcclxuICBjb25zdCBzdGFtcCA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKS5zbGljZSgwLCAxMCk7XHJcbiAgWExTWC53cml0ZUZpbGUod2IsICdTaGltYW5vX0F1ZGl0b3JpYV8nICsgc3RhbXAgKyAnLnhsc3gnKTtcclxufTtcclxuXHJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxuLy8gU0VDQ0lcdTAwRDNOOiBidWlsZENvbnRhY3RhZG9zUm93cy9PcHNMb2cvVmlzaXQgKGlubGluZSBMMTAwODEtMTAxNTUpXHJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG5cclxuLy8gTGlzdGEgY29tcGxldGEgZGUgY29udGFjdGFkb3MgKGNsaWVudGVzL3Byb3NwZWN0b3MgbWFyY2Fkb3MgY29uIGNoZWNrKVxyXG5mdW5jdGlvbiBidWlsZENvbnRhY3RhZG9zUm93cygpIHtcclxuICBjb25zdCByb3dzID0gW107XHJcbiAgY29udGFjdGVkLmZvckVhY2goKGtleSkgPT4ge1xyXG4gICAgY29uc3QgcGFydHMgPSBrZXkuc3BsaXQoJ3wnKTtcclxuICAgIGNvbnN0IHRpcG8gPSBwYXJ0c1swXSxcclxuICAgICAgcHJvdmluY2UgPSBwYXJ0c1sxXSxcclxuICAgICAgbG9jTmFtZSA9IHBhcnRzWzJdLFxyXG4gICAgICBjbGllbnROYW1lID0gcGFydHNbM107XHJcbiAgICBjb25zdCBwdCA9IFBPSU5UUy5maW5kKChwKSA9PiBwLnByb3ZpbmNlID09PSBwcm92aW5jZSAmJiBwLm5hbWUgPT09IGxvY05hbWUpO1xyXG4gICAgY29uc3QgdmVuZG9yID0gcHQgPyBwdC52ZW5kb3IgOiAnJztcclxuICAgIGNvbnN0IHZtID0gdmVuZG9yTG9va3VwW3ZlbmRvcl07XHJcbiAgICByb3dzLnB1c2goe1xyXG4gICAgICBUaXBvOiB0aXBvID09PSAnQycgPyAnQ2xpZW50ZSBhY3R1YWwnIDogJ1Byb3NwZWN0bycsXHJcbiAgICAgIENsaWVudGU6IGNsaWVudE5hbWUsXHJcbiAgICAgIFByb3ZpbmNpYTogdGl0bGVDYXNlKHByb3ZpbmNlKSxcclxuICAgICAgTG9jYWxpZGFkOiBsb2NOYW1lLFxyXG4gICAgICBEZXBhcnRhbWVudG86IHB0ID8gcHQuZGVwdCB8fCAnJyA6ICcnLFxyXG4gICAgICBWZW5kZWRvcjogdGl0bGVDYXNlKHZlbmRvciB8fCAnJyksXHJcbiAgICAgIFpvbmE6IHZtID8gdm0uem9uZSA6ICcnLFxyXG4gICAgICBDb250YWN0YWRvOiAnU2knLFxyXG4gICAgfSk7XHJcbiAgfSk7XHJcbiAgcm93cy5zb3J0KFxyXG4gICAgKGEsIGIpID0+XHJcbiAgICAgIGEuVmVuZGVkb3IubG9jYWxlQ29tcGFyZShiLlZlbmRlZG9yKSB8fFxyXG4gICAgICBhLlByb3ZpbmNpYS5sb2NhbGVDb21wYXJlKGIuUHJvdmluY2lhKSB8fFxyXG4gICAgICBhLkNsaWVudGUubG9jYWxlQ29tcGFyZShiLkNsaWVudGUpXHJcbiAgKTtcclxuICByZXR1cm4gcm93cztcclxufVxyXG5cclxuLy8gTG9nIGRlIG9wZXJhY2lvbmVzIChjYW5jZWxhY2lvbmVzLCBlbGltaW5hY2lvbmVzLCB2dWVsdmUtYS1ib3JyYWRvciwgZXRjLilcclxuZnVuY3Rpb24gYnVpbGRPcHNMb2dSb3dzKCkge1xyXG4gIHJldHVybiAob3BzTG9nQ2FjaGUgfHwgW10pLm1hcCgobykgPT4gKHtcclxuICAgIEZlY2hhOiBvLnRpbWVzdGFtcFxyXG4gICAgICA/IG8udGltZXN0YW1wLnRvRGF0ZVxyXG4gICAgICAgID8gby50aW1lc3RhbXAudG9EYXRlKCkudG9Mb2NhbGVTdHJpbmcoKVxyXG4gICAgICAgIDogbmV3IERhdGUoby50aW1lc3RhbXApLnRvTG9jYWxlU3RyaW5nKClcclxuICAgICAgOiAnJyxcclxuICAgIFVzdWFyaW86IG8udXNlckVtYWlsIHx8ICcnLFxyXG4gICAgUm9sOiBvLnVzZXJSb2xlIHx8ICcnLFxyXG4gICAgQWNjaW9uOiBvLmFjdGlvbiB8fCAnJyxcclxuICAgICdUaXBvIGVudGlkYWQnOiBvLmVudGl0eVR5cGUgfHwgJycsXHJcbiAgICBFbnRpZGFkOiBvLmVudGl0eU5hbWUgfHwgJycsXHJcbiAgICBEZXRhbGxlczogdHlwZW9mIG8uZGV0YWlscyA9PT0gJ29iamVjdCcgPyBKU09OLnN0cmluZ2lmeShvLmRldGFpbHMpIDogby5kZXRhaWxzIHx8ICcnLFxyXG4gIH0pKTtcclxufVxyXG5cclxuZnVuY3Rpb24gYnVpbGRWaXNpdFJvd3MoKSB7XHJcbiAgcmV0dXJuIHZpc2l0c0NhY2hlLm1hcCgodikgPT4gKHtcclxuICAgIEZlY2hhOiB2LmZlY2hhIHx8ICcnLFxyXG4gICAgTWVzOiB2Lm1lcyB8fCAnJyxcclxuICAgIEFubzogdi5hbmlvIHx8ICcnLFxyXG4gICAgVmVuZGVkb3I6IHRpdGxlQ2FzZSh2LnZlbmRvciB8fCAnJyksXHJcbiAgICAnVGlwbyBjb250YWN0byc6IHYudGlwb0NvbnRhY3RvID09PSAndGVsZWZvbm8nID8gJ1RlbGVmb25vJyA6ICdQcmVzZW5jaWFsJyxcclxuICAgIENvbWVudGFyaW86IHYuY29tZW50YXJpbyB8fCAnJyxcclxuICAgIFByb3ZpbmNpYTogdGl0bGVDYXNlKHYucHJvdmluY2lhIHx8ICcnKSxcclxuICAgIExvY2FsaWRhZDogdi5sb2NhbGlkYWQgfHwgJycsXHJcbiAgICBUaWVuZGE6IHYudGllbmRhIHx8ICcnLFxyXG4gICAgJ1RpcG8gdGllbmRhJzogdi50aXBvIHx8ICcnLFxyXG4gICAgTG9jYWw6IHYubG9jYWwgfHwgJycsXHJcbiAgICBUYW1hbm86IHYudGFtYW5vIHx8ICcnLFxyXG4gICAgRmlkZWxpZGFkOiB2LmZpZGVsaWRhZCB8fCAnJyxcclxuICAgICdSZWxldmFuY2lhICgxLTUpJzogdi5yZWxldmFuY2lhIHx8ICcnLFxyXG4gICAgUE9QOiB2LnBvcCB8fCAnJyxcclxuICAgICdOZWNlc2lkYWQgcHVudHVhbCc6IHYubmVjZXNpZGFkUHVudHVhbCA9PT0gJ01PU1RSQURPJyA/ICdNT1NUUkFET1InIDogdi5uZWNlc2lkYWRQdW50dWFsIHx8ICcnLFxyXG4gICAgJ1RpcG8gdmVudGEnOiB2LnRpcG9WZW50YSA9PT0gJ01PU1RSQURPJyA/ICdNT1NUUkFET1InIDogdi50aXBvVmVudGEgfHwgJycsXHJcbiAgICAnJSBNb3N0cmFkb3InOiB2LnBvbmRlcmFjaW9uTW9zdHJhZG8gIT0gbnVsbCA/IHYucG9uZGVyYWNpb25Nb3N0cmFkbyA6ICcnLFxyXG4gICAgJyUgRWNvbW1lcmNlJzogdi5wb25kZXJhY2lvbkVjb21tZXJjZSAhPSBudWxsID8gdi5wb25kZXJhY2lvbkVjb21tZXJjZSA6ICcnLFxyXG4gICAgQ29tcGV0ZW5jaWE6IHYuY29tcGV0ZW5jaWEgfHwgJycsXHJcbiAgICAnQ2F0ZWdvcmlhIGNsaWVudGUnOiB2LmNhdGVnb3JpYUNsaWVudGUgfHwgJycsXHJcbiAgICBPcG9ydHVuaWRhZDogdi5vcG9ydHVuaWRhZCB8fCAnJyxcclxuICAgICdMbyBtYXMgdmVuZGlkbyBTaGltYW5vJzogdi5tYXNWZW5kaWRvIHx8ICcnLFxyXG4gICAgJ0xvIHF1ZSBtYXMgcHJlZ3VudGFuJzogdi5tYXNQcmVndW50YW4gfHwgJycsXHJcbiAgICAnQXl1ZGEgYSB0aWVuZGEnOiB2LmF5dWRhVGllbmRhIHx8ICcnLFxyXG4gICAgJ0ZvdG9zIGVzcGFjaW8gKGNhbnQpJzogKHYuZXNwYWNpbyB8fCBbXSkubGVuZ3RoLFxyXG4gICAgJ0ZvdG8gZnJlbnRlJzogdi5mcmVudGVMb2NhbCA/ICdTaScgOiAnTm8nLFxyXG4gICAgJ0dQUyBlc3RhZG8nOiB2Lmdwc1N0YXR1cyB8fCAnJyxcclxuICAgICdHUFMgZGlzdGFuY2lhIChtKSc6IHR5cGVvZiB2Lmdwc0Rpc3RhbmNlTSA9PT0gJ251bWJlcicgPyB2Lmdwc0Rpc3RhbmNlTSA6ICcnLFxyXG4gICAgJ0dQUyBsYXQnOiB2Lmdwc0xhdCAhPSBudWxsID8gdi5ncHNMYXQgOiAnJyxcclxuICAgICdHUFMgbG9uJzogdi5ncHNMb24gIT0gbnVsbCA/IHYuZ3BzTG9uIDogJycsXHJcbiAgICAnR1BTIHByZWNpc2lvbiAobSknOiB2Lmdwc0FjY3VyYWN5ICE9IG51bGwgPyB2Lmdwc0FjY3VyYWN5IDogJycsXHJcbiAgICAnR1BTIGNhcHR1cmFkbyc6IHYuZ3BzQ2FwdHVyZWRBdCB8fCAnJyxcclxuICAgIEVtYWlsOiB2Lm93bmVyRW1haWwgfHwgJycsXHJcbiAgfSkpO1xyXG59XHJcblxyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XHJcbi8vIFNFQ0NJXHUwMEQzTjogZXhwb3J0RXhlY3V0aXZlL1Zpc2l0cy9Qb3dlckJJL01MIChpbmxpbmUgTDEwMTU4LTEwNDI2KVxyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxuXHJcbndpbmRvdy5leHBvcnRFeGVjdXRpdmUgPSBmdW5jdGlvbiAoKSB7XHJcbiAgY29uc3Qgd2IgPSBYTFNYLnV0aWxzLmJvb2tfbmV3KCk7XHJcbiAgY29uc3Qgcm93cyA9IGJ1aWxkUGVkaWRvRGV0YWlsUm93cygpO1xyXG4gIGNvbnN0IGNvbmZSb3dzID0gcm93cy5maWx0ZXIoKHIpID0+IHIuZXN0YWRvID09PSAnQ29uZmlybWFkbycpO1xyXG5cclxuICAvLyBDb25zb2xpZGFkbzogdW5hIGZpbGEgcG9yIHZlbmRlZG9yIGNvbiBLUElzXHJcbiAgY29uc3QgcGVyVmVuZG9yID0ge307XHJcbiAgY29uZlJvd3MuZm9yRWFjaCgocikgPT4ge1xyXG4gICAgY29uc3QgayA9IHIudmVuZGVkb3IgfHwgJ1NpbiBhc2lnbmFyJztcclxuICAgIGlmICghcGVyVmVuZG9yW2tdKVxyXG4gICAgICBwZXJWZW5kb3Jba10gPSB7XHJcbiAgICAgICAgem9uYTogci56b25hLFxyXG4gICAgICAgIHVuaWQ6IDAsXHJcbiAgICAgICAgYXJzOiAwLFxyXG4gICAgICAgIHVzZDogMCxcclxuICAgICAgICBjbGllbnRlczogbmV3IFNldCgpLFxyXG4gICAgICAgIHByb2RzOiBuZXcgU2V0KCksXHJcbiAgICAgICAgcHJvdnM6IG5ldyBTZXQoKSxcclxuICAgICAgfTtcclxuICAgIHBlclZlbmRvcltrXS51bmlkICs9IHIuY2FudGlkYWQ7XHJcbiAgICBwZXJWZW5kb3Jba10uYXJzICs9IHIuc3VidG90YWxfYXJzO1xyXG4gICAgcGVyVmVuZG9yW2tdLnVzZCArPSByLnN1YnRvdGFsX3VzZDtcclxuICAgIHBlclZlbmRvcltrXS5jbGllbnRlcy5hZGQoci5jbGllbnRlKTtcclxuICAgIHBlclZlbmRvcltrXS5wcm9kcy5hZGQoci5jb2RpZ28pO1xyXG4gICAgcGVyVmVuZG9yW2tdLnByb3ZzLmFkZChyLnByb3ZpbmNpYSk7XHJcbiAgfSk7XHJcbiAgY29uc3QgY29uc29sID0gW107XHJcbiAgVkVORE9SUy5mb3JFYWNoKCh2KSA9PiB7XHJcbiAgICBjb25zdCB0aXRsZVYgPSB0aXRsZUNhc2Uodi5rZXkpO1xyXG4gICAgY29uc3QgZCA9IHBlclZlbmRvclt0aXRsZVZdIHx8IHtcclxuICAgICAgem9uYTogdi56b25lLFxyXG4gICAgICB1bmlkOiAwLFxyXG4gICAgICBhcnM6IDAsXHJcbiAgICAgIHVzZDogMCxcclxuICAgICAgY2xpZW50ZXM6IG5ldyBTZXQoKSxcclxuICAgICAgcHJvZHM6IG5ldyBTZXQoKSxcclxuICAgICAgcHJvdnM6IG5ldyBTZXQoKSxcclxuICAgIH07XHJcbiAgICBjb25zdCB0ID0gVEFSR0VUU19CWV9WRU5ET1Jbdi5rZXldIHx8IHsganVsMjAyNl91c2Q6IDAsIGp1bERpYzIwMjZfdXNkOiAwLCBhbnVhbDIwMjdfdXNkOiAwIH07XHJcbiAgICBjb25zb2wucHVzaCh7XHJcbiAgICAgIFpvbmE6IHYuem9uZSxcclxuICAgICAgVmVuZGVkb3I6IHRpdGxlVixcclxuICAgICAgUHJvdmluY2lhczogZC5wcm92cy5zaXplLFxyXG4gICAgICAnQ2xpZW50ZXMgYWN0aXZvcyc6IGQuY2xpZW50ZXMuc2l6ZSxcclxuICAgICAgJ1Byb2R1Y3RvcyBkaXN0aW50b3MnOiBkLnByb2RzLnNpemUsXHJcbiAgICAgIFVuaWRhZGVzOiBkLnVuaWQsXHJcbiAgICAgICdGYWN0dXJhZG8gQVJTJzogTWF0aC5yb3VuZChkLmFycyksXHJcbiAgICAgICdGYWN0dXJhZG8gVVNEJzogTWF0aC5yb3VuZChkLnVzZCksXHJcbiAgICAgICdUYXJnZXQgSnVsIDIwMjYgVVNEJzogdC5qdWwyMDI2X3VzZCxcclxuICAgICAgJ1RhcmdldCBKdWwtRGljIDIwMjYgVVNEJzogdC5qdWxEaWMyMDI2X3VzZCxcclxuICAgICAgJ1RhcmdldCAyMDI3IFVTRCc6IHQuYW51YWwyMDI3X3VzZCxcclxuICAgIH0pO1xyXG4gIH0pO1xyXG4gIGNvbnN0IHdzQyA9IFhMU1gudXRpbHMuanNvbl90b19zaGVldChjb25zb2wpO1xyXG4gIHdzQ1snIWNvbHMnXSA9IFtcclxuICAgIHsgd2NoOiA2IH0sXHJcbiAgICB7IHdjaDogMjQgfSxcclxuICAgIHsgd2NoOiAxMSB9LFxyXG4gICAgeyB3Y2g6IDE0IH0sXHJcbiAgICB7IHdjaDogMTYgfSxcclxuICAgIHsgd2NoOiAxMSB9LFxyXG4gICAgeyB3Y2g6IDE2IH0sXHJcbiAgICB7IHdjaDogMTYgfSxcclxuICAgIHsgd2NoOiAxOCB9LFxyXG4gICAgeyB3Y2g6IDIwIH0sXHJcbiAgICB7IHdjaDogMTggfSxcclxuICBdO1xyXG4gIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQod2IsIHdzQywgJ0NvbnNvbGlkYWRvJyk7XHJcblxyXG4gIC8vIFVuYSBob2phIHBvciB2ZW5kZWRvciBjb24gc3UgZGV0YWxsZSBkZSBwZWRpZG9zIGNvbmZpcm1hZG9zXHJcbiAgVkVORE9SUy5mb3JFYWNoKCh2KSA9PiB7XHJcbiAgICBjb25zdCB0aXRsZVYgPSB0aXRsZUNhc2Uodi5rZXkpO1xyXG4gICAgY29uc3QgdnJvd3MgPSBjb25mUm93c1xyXG4gICAgICAuZmlsdGVyKChyKSA9PiByLnZlbmRlZG9yID09PSB0aXRsZVYpXHJcbiAgICAgIC5tYXAoKHIpID0+ICh7XHJcbiAgICAgICAgRmVjaGE6IHIuZmVjaGEsXHJcbiAgICAgICAgTWVzOiByLm1lc19wZWRpZG8sXHJcbiAgICAgICAgUHJvdmluY2lhOiByLnByb3ZpbmNpYSxcclxuICAgICAgICBMb2NhbGlkYWQ6IHIubG9jYWxpZGFkLFxyXG4gICAgICAgIENsaWVudGU6IHIuY2xpZW50ZSxcclxuICAgICAgICBUaXBvOiByLnRpcG9fY2xpZW50ZSxcclxuICAgICAgICBDb2RpZ286IHIuY29kaWdvLFxyXG4gICAgICAgIFByb2R1Y3RvOiByLnByb2R1Y3RvLFxyXG4gICAgICAgIENhdGVnb3JpYTogci5jYXRlZ29yaWEsXHJcbiAgICAgICAgRmFtaWxpYTogci5mYW1pbGlhLFxyXG4gICAgICAgIFN1YmZhbWlsaWE6IHIuc3ViZmFtaWxpYSxcclxuICAgICAgICBDYW50aWRhZDogci5jYW50aWRhZCxcclxuICAgICAgICAnUHJlY2lvIEFSUyc6IHIucHJlY2lvX3VuaXRfYXJzLFxyXG4gICAgICAgICdTdWJ0b3RhbCBBUlMnOiByLnN1YnRvdGFsX2FycyxcclxuICAgICAgICAnU3VidG90YWwgVVNEJzogci5zdWJ0b3RhbF91c2QsXHJcbiAgICAgIH0pKTtcclxuICAgIHZyb3dzLnNvcnQoXHJcbiAgICAgIChhLCBiKSA9PiAoYS5GZWNoYSB8fCAnJykubG9jYWxlQ29tcGFyZShiLkZlY2hhIHx8ICcnKSB8fCBhLkNsaWVudGUubG9jYWxlQ29tcGFyZShiLkNsaWVudGUpXHJcbiAgICApO1xyXG4gICAgaWYgKCF2cm93cy5sZW5ndGgpXHJcbiAgICAgIHZyb3dzLnB1c2goe1xyXG4gICAgICAgIEZlY2hhOiAnJyxcclxuICAgICAgICBNZXM6ICcnLFxyXG4gICAgICAgIFByb3ZpbmNpYTogJycsXHJcbiAgICAgICAgTG9jYWxpZGFkOiAnJyxcclxuICAgICAgICBDbGllbnRlOiAnKHNpbiBwZWRpZG9zIGNvbmZpcm1hZG9zKScsXHJcbiAgICAgICAgVGlwbzogJycsXHJcbiAgICAgICAgQ29kaWdvOiAnJyxcclxuICAgICAgICBQcm9kdWN0bzogJycsXHJcbiAgICAgICAgQ2F0ZWdvcmlhOiAnJyxcclxuICAgICAgICBGYW1pbGlhOiAnJyxcclxuICAgICAgICBTdWJmYW1pbGlhOiAnJyxcclxuICAgICAgICBDYW50aWRhZDogMCxcclxuICAgICAgICAnUHJlY2lvIEFSUyc6IDAsXHJcbiAgICAgICAgJ1N1YnRvdGFsIEFSUyc6IDAsXHJcbiAgICAgICAgJ1N1YnRvdGFsIFVTRCc6IDAsXHJcbiAgICAgIH0pO1xyXG4gICAgY29uc3Qgd3MgPSBYTFNYLnV0aWxzLmpzb25fdG9fc2hlZXQodnJvd3MpO1xyXG4gICAgd3NbJyFjb2xzJ10gPSBbXHJcbiAgICAgIHsgd2NoOiAxMSB9LFxyXG4gICAgICB7IHdjaDogMTQgfSxcclxuICAgICAgeyB3Y2g6IDE4IH0sXHJcbiAgICAgIHsgd2NoOiAyMiB9LFxyXG4gICAgICB7IHdjaDogMzAgfSxcclxuICAgICAgeyB3Y2g6IDExIH0sXHJcbiAgICAgIHsgd2NoOiAxNCB9LFxyXG4gICAgICB7IHdjaDogMzggfSxcclxuICAgICAgeyB3Y2g6IDE0IH0sXHJcbiAgICAgIHsgd2NoOiAxOCB9LFxyXG4gICAgICB7IHdjaDogMTggfSxcclxuICAgICAgeyB3Y2g6IDEwIH0sXHJcbiAgICAgIHsgd2NoOiAxMiB9LFxyXG4gICAgICB7IHdjaDogMTQgfSxcclxuICAgICAgeyB3Y2g6IDE0IH0sXHJcbiAgICBdO1xyXG4gICAgWExTWC51dGlscy5ib29rX2FwcGVuZF9zaGVldChcclxuICAgICAgd2IsXHJcbiAgICAgIHdzLFxyXG4gICAgICAodi56b25lICsgJyAnICsgdGl0bGVWKS5zdWJzdHJpbmcoMCwgMzEpLnJlcGxhY2UoL1tcXFxcLyo/W1xcXTpdL2csICcnKVxyXG4gICAgKTtcclxuICB9KTtcclxuXHJcbiAgLy8gVmlzaXRhc1xyXG4gIGNvbnN0IHZpc2l0Um93cyA9IGJ1aWxkVmlzaXRSb3dzKCk7XHJcbiAgaWYgKHZpc2l0Um93cy5sZW5ndGgpIHtcclxuICAgIGNvbnN0IHdzViA9IFhMU1gudXRpbHMuanNvbl90b19zaGVldCh2aXNpdFJvd3MpO1xyXG4gICAgWExTWC51dGlscy5ib29rX2FwcGVuZF9zaGVldCh3Yiwgd3NWLCAnVmlzaXRhcycpO1xyXG4gIH1cclxuICAvLyBDb250YWN0YWRvcyAodG9kb3MgbG9zIGNsaWVudGVzL3Byb3NwZWN0b3MgbWFyY2Fkb3MgY29uIGNoZWNrKVxyXG4gIGNvbnN0IGNvbnRhY3RSb3dzID0gYnVpbGRDb250YWN0YWRvc1Jvd3MoKTtcclxuICBpZiAoY29udGFjdFJvd3MubGVuZ3RoKSB7XHJcbiAgICBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KHdiLCBYTFNYLnV0aWxzLmpzb25fdG9fc2hlZXQoY29udGFjdFJvd3MpLCAnQ29udGFjdGFkb3MnKTtcclxuICB9XHJcbiAgLy8gTG9nIGRlIG9wZXJhY2lvbmVzIChjYW5jZWxhY2lvbmVzLCBlbGltaW5hY2lvbmVzLCBldGMuKVxyXG4gIGNvbnN0IG9wc1Jvd3MgPSBidWlsZE9wc0xvZ1Jvd3MoKTtcclxuICBpZiAob3BzUm93cy5sZW5ndGgpIHtcclxuICAgIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQod2IsIFhMU1gudXRpbHMuanNvbl90b19zaGVldChvcHNSb3dzKSwgJ0xvZyBPcGVyYWNpb25lcycpO1xyXG4gIH1cclxuXHJcbiAgWExTWC53cml0ZUZpbGUod2IsICdTaGltYW5vX0VqZWN1dGl2b18nICsgdG9kYXlTdHIoKSArICcueGxzeCcpO1xyXG59O1xyXG5cclxuLy8gLS0tLS0tLS0tLSBFeGNlbCBkZSBWaXNpdGFzIChmb3JtYXRvIHN0YW5kYWxvbmUpIC0tLS0tLS0tLS1cclxud2luZG93LmV4cG9ydFZpc2l0c0V4Y2VsID0gZnVuY3Rpb24gKCkge1xyXG4gIGlmICh0eXBlb2YgWExTWCA9PT0gJ3VuZGVmaW5lZCcpIHtcclxuICAgIGFsZXJ0KCdMYSBsaWJyZXJpYSBkZSBFeGNlbCBubyBzZSBjYXJnby4gVmVyaWZpcXVlIHN1IGNvbmV4aW9uIGEgaW50ZXJuZXQgeSByZWludGVudGUuJyk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIGNvbnN0IHZpc2l0Um93cyA9IGJ1aWxkVmlzaXRSb3dzKCk7XHJcbiAgaWYgKCF2aXNpdFJvd3MubGVuZ3RoKSB7XHJcbiAgICBhbGVydChcclxuICAgICAgJ05vIGhheSB2aXNpdGFzIHJlZ2lzdHJhZGFzIHRvZGF2aWEuIEN1YW5kbyBzZSBjYXJndWUgYWwgbWVub3MgdW5hLCB2YXMgYSBwb2RlciBleHBvcnRhcmxhLidcclxuICAgICk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIGNvbnN0IHdiID0gWExTWC51dGlscy5ib29rX25ldygpO1xyXG5cclxuICAvLyBIb2phIHByaW5jaXBhbDogVmlzaXRhcyAodG9kYXMgbGFzIGZpbGFzKVxyXG4gIGNvbnN0IHdzID0gWExTWC51dGlscy5qc29uX3RvX3NoZWV0KHZpc2l0Um93cyk7XHJcbiAgd3NbJyFjb2xzJ10gPSBbXHJcbiAgICB7IHdjaDogMTIgfSxcclxuICAgIHsgd2NoOiAxNCB9LFxyXG4gICAgeyB3Y2g6IDggfSxcclxuICAgIHsgd2NoOiAyNCB9LFxyXG4gICAgeyB3Y2g6IDE4IH0sXHJcbiAgICB7IHdjaDogMjIgfSxcclxuICAgIHsgd2NoOiAzMCB9LFxyXG4gICAgeyB3Y2g6IDE4IH0sXHJcbiAgICB7IHdjaDogMTQgfSxcclxuICAgIHsgd2NoOiAxNCB9LFxyXG4gICAgeyB3Y2g6IDE0IH0sXHJcbiAgICB7IHdjaDogMTYgfSxcclxuICAgIHsgd2NoOiA4IH0sXHJcbiAgICB7IHdjaDogMjIgfSxcclxuICAgIHsgd2NoOiAxNCB9LFxyXG4gICAgeyB3Y2g6IDE0IH0sXHJcbiAgICB7IHdjaDogMTQgfSxcclxuICAgIHsgd2NoOiAxOCB9LFxyXG4gICAgeyB3Y2g6IDE4IH0sXHJcbiAgICB7IHdjaDogMzIgfSxcclxuICAgIHsgd2NoOiAzMiB9LFxyXG4gICAgeyB3Y2g6IDMyIH0sXHJcbiAgICB7IHdjaDogMzIgfSxcclxuICAgIHsgd2NoOiAxOCB9LFxyXG4gICAgeyB3Y2g6IDE0IH0sXHJcbiAgICB7IHdjaDogMjQgfSxcclxuICBdO1xyXG4gIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQod2IsIHdzLCAnVmlzaXRhcycpO1xyXG5cclxuICAvLyBIb2phIHJlc3VtZW4gcG9yIHZlbmRlZG9yOiBjYW50aWRhZCBkZSB2aXNpdGFzIHkgdGllbmRhcyB1bmljYXNcclxuICBjb25zdCBwZXJWZW5kb3IgPSB7fTtcclxuICB2aXNpdHNDYWNoZS5mb3JFYWNoKCh2KSA9PiB7XHJcbiAgICBjb25zdCBrID0gdGl0bGVDYXNlKHYudmVuZG9yIHx8ICdTaW4gYXNpZ25hcicpO1xyXG4gICAgaWYgKCFwZXJWZW5kb3Jba10pXHJcbiAgICAgIHBlclZlbmRvcltrXSA9IHtcclxuICAgICAgICB2aXNpdGFzOiAwLFxyXG4gICAgICAgIHRpZW5kYXM6IG5ldyBTZXQoKSxcclxuICAgICAgICBsb2NhbGlkYWRlczogbmV3IFNldCgpLFxyXG4gICAgICAgIHByb3ZpbmNpYXM6IG5ldyBTZXQoKSxcclxuICAgICAgfTtcclxuICAgIHBlclZlbmRvcltrXS52aXNpdGFzKys7XHJcbiAgICBpZiAodi50aWVuZGEpIHBlclZlbmRvcltrXS50aWVuZGFzLmFkZCh2LnRpZW5kYSk7XHJcbiAgICBpZiAodi5sb2NhbGlkYWQpIHBlclZlbmRvcltrXS5sb2NhbGlkYWRlcy5hZGQodi5sb2NhbGlkYWQpO1xyXG4gICAgaWYgKHYucHJvdmluY2lhKSBwZXJWZW5kb3Jba10ucHJvdmluY2lhcy5hZGQodi5wcm92aW5jaWEpO1xyXG4gIH0pO1xyXG4gIGNvbnN0IHJlc3VtZW4gPSBPYmplY3QuZW50cmllcyhwZXJWZW5kb3IpXHJcbiAgICAubWFwKChbdmVuZGVkb3IsIGRdKSA9PiAoe1xyXG4gICAgICBWZW5kZWRvcjogdmVuZGVkb3IsXHJcbiAgICAgICdWaXNpdGFzIHRvdGFsZXMnOiBkLnZpc2l0YXMsXHJcbiAgICAgICdUaWVuZGFzIGRpc3RpbnRhcyc6IGQudGllbmRhcy5zaXplLFxyXG4gICAgICAnTG9jYWxpZGFkZXMgZGlzdGludGFzJzogZC5sb2NhbGlkYWRlcy5zaXplLFxyXG4gICAgICAnUHJvdmluY2lhcyBkaXN0aW50YXMnOiBkLnByb3ZpbmNpYXMuc2l6ZSxcclxuICAgIH0pKVxyXG4gICAgLnNvcnQoKGEsIGIpID0+IGJbJ1Zpc2l0YXMgdG90YWxlcyddIC0gYVsnVmlzaXRhcyB0b3RhbGVzJ10pO1xyXG4gIGlmIChyZXN1bWVuLmxlbmd0aCkge1xyXG4gICAgY29uc3Qgd3NSID0gWExTWC51dGlscy5qc29uX3RvX3NoZWV0KHJlc3VtZW4pO1xyXG4gICAgd3NSWychY29scyddID0gW3sgd2NoOiAyNCB9LCB7IHdjaDogMTYgfSwgeyB3Y2g6IDE4IH0sIHsgd2NoOiAyMiB9LCB7IHdjaDogMjIgfV07XHJcbiAgICBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KHdiLCB3c1IsICdSZXN1bWVuIHBvciB2ZW5kZWRvcicpO1xyXG4gIH1cclxuXHJcbiAgWExTWC53cml0ZUZpbGUod2IsICdTaGltYW5vX1Zpc2l0YXNfJyArIHRvZGF5U3RyKCkgKyAnLnhsc3gnKTtcclxufTtcclxuXHJcbi8vIC0tLS0tLS0tLS0gT1BDSU9OIEI6IFBvd2VyIEJJIChGYWN0ICsgRGltKSAtLS0tLS0tLS0tXHJcbndpbmRvdy5leHBvcnRQb3dlckJJID0gZnVuY3Rpb24gKCkge1xyXG4gIGNvbnN0IHdiID0gWExTWC51dGlscy5ib29rX25ldygpO1xyXG4gIGNvbnN0IHJvd3MgPSBidWlsZFBlZGlkb0RldGFpbFJvd3MoKTtcclxuXHJcbiAgLy8gRmFjdF9QZWRpZG9zXHJcbiAgY29uc3QgZmFjdFJvd3MgPSByb3dzLmZpbHRlcigocikgPT4gci5lc3RhZG8gIT09ICdCb3JyYWRvcicpO1xyXG4gIGNvbnN0IHdzRiA9IFhMU1gudXRpbHMuanNvbl90b19zaGVldChcclxuICAgIGZhY3RSb3dzLm1hcCgocikgPT4gKHtcclxuICAgICAgbGluZV9pZDogci5saW5lX2lkLFxyXG4gICAgICBmZWNoYTogci5mZWNoYSxcclxuICAgICAgZXN0YWRvOiByLmVzdGFkbyxcclxuICAgICAgdmVuZGVkb3Jfa2V5OiByLnZlbmRlZG9yX2tleSxcclxuICAgICAgem9uYTogci56b25hLFxyXG4gICAgICBwcm92aW5jaWE6IHIucHJvdmluY2lhLFxyXG4gICAgICBsb2NhbGlkYWQ6IHIubG9jYWxpZGFkLFxyXG4gICAgICBjbGllbnRlOiByLmNsaWVudGUsXHJcbiAgICAgIHRpcG9fY2xpZW50ZTogci50aXBvX2NsaWVudGUsXHJcbiAgICAgIHNrdTogci5jb2RpZ28sXHJcbiAgICAgIGNhbnRpZGFkOiByLmNhbnRpZGFkLFxyXG4gICAgICBwcmVjaW9fdW5pdF9hcnM6IHIucHJlY2lvX3VuaXRfYXJzLFxyXG4gICAgICBzdWJ0b3RhbF9hcnM6IHIuc3VidG90YWxfYXJzLFxyXG4gICAgICBzdWJ0b3RhbF91c2Q6IHIuc3VidG90YWxfdXNkLFxyXG4gICAgfSkpXHJcbiAgKTtcclxuICBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KHdiLCB3c0YsICdGYWN0X1BlZGlkb3MnKTtcclxuXHJcbiAgLy8gRGltX1ZlbmRlZG9yXHJcbiAgY29uc3QgZGltViA9IFZFTkRPUlMubWFwKCh2KSA9PiB7XHJcbiAgICBjb25zdCB0ID0gVEFSR0VUU19CWV9WRU5ET1Jbdi5rZXldIHx8IHt9O1xyXG4gICAgcmV0dXJuIHtcclxuICAgICAgdmVuZGVkb3Jfa2V5OiB2LmtleSxcclxuICAgICAgdmVuZGVkb3Jfbm9tYnJlOiB0aXRsZUNhc2Uodi5rZXkpLFxyXG4gICAgICB6b25hOiB2LnpvbmUsXHJcbiAgICAgIHpvbmFfZGVzY3JpcGNpb246IHYubGFiZWwsXHJcbiAgICAgIGNvbG9yOiB2LmNvbG9yLFxyXG4gICAgICB0YXJnZXRfanVsMjAyNl91c2Q6IHQuanVsMjAyNl91c2QgfHwgMCxcclxuICAgICAgdGFyZ2V0X2p1bERpYzIwMjZfdXNkOiB0Lmp1bERpYzIwMjZfdXNkIHx8IDAsXHJcbiAgICAgIHRhcmdldF8yMDI3X3VzZDogdC5hbnVhbDIwMjdfdXNkIHx8IDAsXHJcbiAgICB9O1xyXG4gIH0pO1xyXG4gIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQod2IsIFhMU1gudXRpbHMuanNvbl90b19zaGVldChkaW1WKSwgJ0RpbV9WZW5kZWRvcicpO1xyXG5cclxuICAvLyBEaW1fUHJvZHVjdG9cclxuICBjb25zdCBkaW1QID0gUFJPRFVDVFMubWFwKChwKSA9PiAoe1xyXG4gICAgc2t1OiBwLmNvZGUsXHJcbiAgICBkZXNjcmlwY2lvbjogcC5kZXNjLFxyXG4gICAgY2F0ZWdvcmlhOiBwLmNhdCxcclxuICAgIGZhbWlsaWE6IHAuZmFtLFxyXG4gICAgc3ViZmFtaWxpYTogcC5zdWIsXHJcbiAgfSkpO1xyXG4gIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQod2IsIFhMU1gudXRpbHMuanNvbl90b19zaGVldChkaW1QKSwgJ0RpbV9Qcm9kdWN0bycpO1xyXG5cclxuICAvLyBEaW1fQ2xpZW50ZSAodW5pdmVyc28pXHJcbiAgY29uc3QgZGltQyA9IFtdO1xyXG4gIFBPSU5UUy5mb3JFYWNoKChwKSA9PiB7XHJcbiAgICBjb25zdCB2bSA9IHZlbmRvckxvb2t1cFtwLnZlbmRvcl07XHJcbiAgICBwLmNsaWVudHMuZm9yRWFjaCgobikgPT4ge1xyXG4gICAgICBkaW1DLnB1c2goe1xyXG4gICAgICAgIGNsaWVudGU6IG4sXHJcbiAgICAgICAgdGlwbzogJ0NsaWVudGUgYWN0dWFsJyxcclxuICAgICAgICBwcm92aW5jaWE6IHRpdGxlQ2FzZShwLnByb3ZpbmNlKSxcclxuICAgICAgICBsb2NhbGlkYWQ6IHAubmFtZSxcclxuICAgICAgICBkZXBhcnRhbWVudG86IHAuZGVwdCB8fCAnJyxcclxuICAgICAgICB2ZW5kZWRvcl9rZXk6IHAudmVuZG9yIHx8ICcnLFxyXG4gICAgICAgIHpvbmE6IHZtID8gdm0uem9uZSA6ICcnLFxyXG4gICAgICB9KTtcclxuICAgIH0pO1xyXG4gICAgcC5wcm9zcGVjdHMuZm9yRWFjaCgobikgPT4ge1xyXG4gICAgICBkaW1DLnB1c2goe1xyXG4gICAgICAgIGNsaWVudGU6IG4sXHJcbiAgICAgICAgdGlwbzogJ1Byb3NwZWN0bycsXHJcbiAgICAgICAgcHJvdmluY2lhOiB0aXRsZUNhc2UocC5wcm92aW5jZSksXHJcbiAgICAgICAgbG9jYWxpZGFkOiBwLm5hbWUsXHJcbiAgICAgICAgZGVwYXJ0YW1lbnRvOiBwLmRlcHQgfHwgJycsXHJcbiAgICAgICAgdmVuZGVkb3Jfa2V5OiBwLnZlbmRvciB8fCAnJyxcclxuICAgICAgICB6b25hOiB2bSA/IHZtLnpvbmUgOiAnJyxcclxuICAgICAgfSk7XHJcbiAgICB9KTtcclxuICB9KTtcclxuICBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KHdiLCBYTFNYLnV0aWxzLmpzb25fdG9fc2hlZXQoZGltQyksICdEaW1fQ2xpZW50ZScpO1xyXG5cclxuICAvLyBEaW1fQ2FsZW5kYXJpbyAoZmVjaGFzIGRpc3RpbnRhcyBlbiBsb3MgcGVkaWRvcyArIHNlcmllIGNvbnRpbnVhIGRlbCBhXHUwMEYxbyBhY3R1YWwpXHJcbiAgY29uc3QgY2FsU2V0ID0gbmV3IFNldCgpO1xyXG4gIGZhY3RSb3dzLmZvckVhY2goKHIpID0+IHtcclxuICAgIGlmIChyLmZlY2hhKSBjYWxTZXQuYWRkKHIuZmVjaGEpO1xyXG4gIH0pO1xyXG4gIC8vIENvbXBsZXRhciBkZXNkZSAyMDI2LTAxLTAxIGhhc3RhIGhveSArIDM2NVxyXG4gIGNvbnN0IHN0YXJ0ID0gbmV3IERhdGUoJzIwMjYtMDEtMDEnKTtcclxuICBjb25zdCBlbmQgPSBuZXcgRGF0ZSgpO1xyXG4gIGVuZC5zZXREYXRlKGVuZC5nZXREYXRlKCkgKyAzNjUpO1xyXG4gIGZvciAobGV0IGQgPSBuZXcgRGF0ZShzdGFydCk7IGQgPD0gZW5kOyBkLnNldERhdGUoZC5nZXREYXRlKCkgKyAxKSlcclxuICAgIGNhbFNldC5hZGQoZC50b0lTT1N0cmluZygpLnNsaWNlKDAsIDEwKSk7XHJcbiAgY29uc3QgZGltQ2FsID0gWy4uLmNhbFNldF0uc29ydCgpLm1hcCgoZHQpID0+IHtcclxuICAgIGNvbnN0IFt5LCBtLCBkYV0gPSBkdC5zcGxpdCgnLScpLm1hcCgoeCkgPT4gcGFyc2VJbnQoeCwgMTApKTtcclxuICAgIGNvbnN0IGRhdGVPYmogPSBuZXcgRGF0ZSh5LCBtIC0gMSwgZGEpO1xyXG4gICAgcmV0dXJuIHtcclxuICAgICAgZmVjaGE6IGR0LFxyXG4gICAgICB5ZWFyOiB5LFxyXG4gICAgICBtb250aDogbSxcclxuICAgICAgZGF5OiBkYSxcclxuICAgICAgcXVhcnRlcjogJ1EnICsgKE1hdGguZmxvb3IoKG0gLSAxKSAvIDMpICsgMSksXHJcbiAgICAgIG1vbnRoX25hbWU6IE1FU0VTW20gLSAxXSxcclxuICAgICAgeWVhcl9tb250aDogeSArICctJyArIFN0cmluZyhtKS5wYWRTdGFydCgyLCAnMCcpLFxyXG4gICAgICBkYXlfb2Zfd2VlazogWydEb20nLCAnTHVuJywgJ01hcicsICdNaWUnLCAnSnVlJywgJ1ZpZScsICdTYWInXVtkYXRlT2JqLmdldERheSgpXSxcclxuICAgIH07XHJcbiAgfSk7XHJcbiAgWExTWC51dGlscy5ib29rX2FwcGVuZF9zaGVldCh3YiwgWExTWC51dGlscy5qc29uX3RvX3NoZWV0KGRpbUNhbCksICdEaW1fQ2FsZW5kYXJpbycpO1xyXG5cclxuICAvLyBEaW1fQ2FtcGFuaWFcclxuICBjb25zdCBkaW1DbXAgPSBjYW1wYWlnbnNDYWNoZS5tYXAoKGMpID0+ICh7XHJcbiAgICBjYW1wYW5pYV9pZDogYy5pZCxcclxuICAgIG5vbWJyZTogYy5uYW1lLFxyXG4gICAgZmlsdGVyX3R5cGU6IGMuZmlsdGVyVHlwZSxcclxuICAgIGZpbHRlcl92YWx1ZXM6IChjLmZpbHRlclZhbHVlcyB8fCBbXSkuam9pbignLCAnKSxcclxuICAgIHRhcmdldF90eXBlOiBjLnRhcmdldFR5cGUsXHJcbiAgICB0YXJnZXRfYW1vdW50OiBjLnRhcmdldEFtb3VudCxcclxuICAgIGRlc2RlOiBjLnN0YXJ0RGF0ZSxcclxuICAgIGhhc3RhOiBjLmVuZERhdGUsXHJcbiAgfSkpO1xyXG4gIGlmIChkaW1DbXAubGVuZ3RoKVxyXG4gICAgWExTWC51dGlscy5ib29rX2FwcGVuZF9zaGVldCh3YiwgWExTWC51dGlscy5qc29uX3RvX3NoZWV0KGRpbUNtcCksICdEaW1fQ2FtcGFuaWEnKTtcclxuXHJcbiAgLy8gUGFyYW1zICh0aXBvIGRlIGNhbWJpbywgZmVjaGEgZXhwb3J0LCB2ZXJzaW9uKVxyXG4gIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQoXHJcbiAgICB3YixcclxuICAgIFhMU1gudXRpbHMuanNvbl90b19zaGVldChbXHJcbiAgICAgIHsgcGFyYW1ldHJvOiAnZXhjaGFuZ2VfcmF0ZV9hcnNfdXNkJywgdmFsb3I6IEVYQ0hBTkdFX1JBVEUgfSxcclxuICAgICAgeyBwYXJhbWV0cm86ICdmZWNoYV9leHBvcnQnLCB2YWxvcjogdG9kYXlTdHIoKSB9LFxyXG4gICAgICB7IHBhcmFtZXRybzogJ3RvdGFsX2ZpbGFzX2ZhY3QnLCB2YWxvcjogZmFjdFJvd3MubGVuZ3RoIH0sXHJcbiAgICBdKSxcclxuICAgICdQYXJhbWV0cm9zJ1xyXG4gICk7XHJcblxyXG4gIC8vIEZhY3RfVmlzaXRhc1xyXG4gIGNvbnN0IHZpc2l0Um93c0IgPSBidWlsZFZpc2l0Um93cygpO1xyXG4gIGlmICh2aXNpdFJvd3NCLmxlbmd0aClcclxuICAgIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQod2IsIFhMU1gudXRpbHMuanNvbl90b19zaGVldCh2aXNpdFJvd3NCKSwgJ0ZhY3RfVmlzaXRhcycpO1xyXG4gIC8vIENvbnRhY3RhZG9zXHJcbiAgY29uc3QgY29udGFjdFJvd3NCID0gYnVpbGRDb250YWN0YWRvc1Jvd3MoKTtcclxuICBpZiAoY29udGFjdFJvd3NCLmxlbmd0aClcclxuICAgIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQod2IsIFhMU1gudXRpbHMuanNvbl90b19zaGVldChjb250YWN0Um93c0IpLCAnQ29udGFjdGFkb3MnKTtcclxuICAvLyBMb2cgZGUgb3BlcmFjaW9uZXNcclxuICBjb25zdCBvcHNSb3dzQiA9IGJ1aWxkT3BzTG9nUm93cygpO1xyXG4gIGlmIChvcHNSb3dzQi5sZW5ndGgpXHJcbiAgICBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KHdiLCBYTFNYLnV0aWxzLmpzb25fdG9fc2hlZXQob3BzUm93c0IpLCAnTG9nX09wZXJhY2lvbmVzJyk7XHJcblxyXG4gIFhMU1gud3JpdGVGaWxlKHdiLCAnU2hpbWFub19Qb3dlckJJXycgKyB0b2RheVN0cigpICsgJy54bHN4Jyk7XHJcbn07XHJcblxyXG4vLyAtLS0tLS0tLS0tIE9QQ0lPTiBDOiBQeXRob24gLyBJQSAvIE1MIChzaW5nbGUgbG9uZy1mb3JtYXQgdGFibGUpIC0tLS0tLS0tLS1cclxud2luZG93LmV4cG9ydE1MID0gZnVuY3Rpb24gKCkge1xyXG4gIGNvbnN0IHdiID0gWExTWC51dGlscy5ib29rX25ldygpO1xyXG4gIGNvbnN0IHJvd3MgPSBidWlsZFBlZGlkb0RldGFpbFJvd3MoKTtcclxuICAvLyBtYXN0ZXJfbWw6IHVuYSBmaWxhIHBvciBsaW5lYSBjb24gVE9EQVMgbGFzIGZlYXR1cmVzXHJcbiAgY29uc3Qgd3MgPSBYTFNYLnV0aWxzLmpzb25fdG9fc2hlZXQocm93cyk7XHJcbiAgd3NbJyFjb2xzJ10gPSBPYmplY3Qua2V5cyhyb3dzWzBdIHx8IHsgZmVjaGE6ICcnIH0pLm1hcCgoKSA9PiAoeyB3Y2g6IDE0IH0pKTtcclxuICBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KHdiLCB3cywgJ21hc3Rlcl9tbCcpO1xyXG5cclxuICAvLyBjYXRhbG9nbyB5IHVuaXZlcnNvIGRlIGNsaWVudGVzIGNvbW8gcmVmZXJlbmNpYXMgcGFyYSBlbnJpcXVlY2VyIGVuIHBhbmRhc1xyXG4gIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQoXHJcbiAgICB3YixcclxuICAgIFhMU1gudXRpbHMuanNvbl90b19zaGVldChcclxuICAgICAgUFJPRFVDVFMubWFwKChwKSA9PiAoeyBjb2RlOiBwLmNvZGUsIGRlc2M6IHAuZGVzYywgY2F0OiBwLmNhdCwgZmFtOiBwLmZhbSwgc3ViOiBwLnN1YiB9KSlcclxuICAgICksXHJcbiAgICAncHJvZHVjdG9zX2NhdGFsb2dvJ1xyXG4gICk7XHJcblxyXG4gIGNvbnN0IHVuaXZlcnNlID0gW107XHJcbiAgUE9JTlRTLmZvckVhY2goKHApID0+IHtcclxuICAgIGNvbnN0IHZtID0gdmVuZG9yTG9va3VwW3AudmVuZG9yXTtcclxuICAgIHAuY2xpZW50cy5mb3JFYWNoKChuKSA9PiB7XHJcbiAgICAgIHVuaXZlcnNlLnB1c2goe1xyXG4gICAgICAgIGNsaWVudGU6IG4sXHJcbiAgICAgICAgdGlwbzogJ2NsaWVudGVfYWN0dWFsJyxcclxuICAgICAgICBwcm92aW5jaWE6IHRpdGxlQ2FzZShwLnByb3ZpbmNlKSxcclxuICAgICAgICBsb2NhbGlkYWQ6IHAubmFtZSxcclxuICAgICAgICBkZXBhcnRhbWVudG86IHAuZGVwdCB8fCAnJyxcclxuICAgICAgICB2ZW5kZWRvcjogdGl0bGVDYXNlKHAudmVuZG9yIHx8ICcnKSxcclxuICAgICAgICB6b25hOiB2bSA/IHZtLnpvbmUgOiAnJyxcclxuICAgICAgICBsYXQ6IHAubGF0LFxyXG4gICAgICAgIGxvbjogcC5sb24sXHJcbiAgICAgIH0pO1xyXG4gICAgfSk7XHJcbiAgICBwLnByb3NwZWN0cy5mb3JFYWNoKChuKSA9PiB7XHJcbiAgICAgIHVuaXZlcnNlLnB1c2goe1xyXG4gICAgICAgIGNsaWVudGU6IG4sXHJcbiAgICAgICAgdGlwbzogJ3Byb3NwZWN0bycsXHJcbiAgICAgICAgcHJvdmluY2lhOiB0aXRsZUNhc2UocC5wcm92aW5jZSksXHJcbiAgICAgICAgbG9jYWxpZGFkOiBwLm5hbWUsXHJcbiAgICAgICAgZGVwYXJ0YW1lbnRvOiBwLmRlcHQgfHwgJycsXHJcbiAgICAgICAgdmVuZGVkb3I6IHRpdGxlQ2FzZShwLnZlbmRvciB8fCAnJyksXHJcbiAgICAgICAgem9uYTogdm0gPyB2bS56b25lIDogJycsXHJcbiAgICAgICAgbGF0OiBwLmxhdCxcclxuICAgICAgICBsb246IHAubG9uLFxyXG4gICAgICB9KTtcclxuICAgIH0pO1xyXG4gIH0pO1xyXG4gIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQod2IsIFhMU1gudXRpbHMuanNvbl90b19zaGVldCh1bml2ZXJzZSksICd1bml2ZXJzb19jbGllbnRlcycpO1xyXG5cclxuICAvLyB0YXJnZXRzIGNvbW8gdGFibGEgbG9uZ1xyXG4gIGNvbnN0IHRhcmdldHNMb25nID0gW107XHJcbiAgT2JqZWN0LmVudHJpZXMoVEFSR0VUU19CWV9WRU5ET1IpLmZvckVhY2goKFt2ZW5kb3IsIHRdKSA9PiB7XHJcbiAgICB0YXJnZXRzTG9uZy5wdXNoKHtcclxuICAgICAgdmVuZGVkb3I6IGRpc3BsYXlWZW5kb3JOYW1lKHZlbmRvciksXHJcbiAgICAgIHBlcmlvZG86ICdKdWwgMjAyNicsXHJcbiAgICAgIHN0YXJ0X2RhdGU6ICcyMDI2LTA3LTAxJyxcclxuICAgICAgZW5kX2RhdGU6ICcyMDI2LTA3LTMxJyxcclxuICAgICAgdGFyZ2V0X3VzZDogdC5qdWwyMDI2X3VzZCB8fCAwLFxyXG4gICAgfSk7XHJcbiAgICB0YXJnZXRzTG9uZy5wdXNoKHtcclxuICAgICAgdmVuZGVkb3I6IGRpc3BsYXlWZW5kb3JOYW1lKHZlbmRvciksXHJcbiAgICAgIHBlcmlvZG86ICdKdWwtRGljIDIwMjYnLFxyXG4gICAgICBzdGFydF9kYXRlOiAnMjAyNi0wNy0wMScsXHJcbiAgICAgIGVuZF9kYXRlOiAnMjAyNi0xMi0zMScsXHJcbiAgICAgIHRhcmdldF91c2Q6IHQuanVsRGljMjAyNl91c2QgfHwgMCxcclxuICAgIH0pO1xyXG4gICAgdGFyZ2V0c0xvbmcucHVzaCh7XHJcbiAgICAgIHZlbmRlZG9yOiBkaXNwbGF5VmVuZG9yTmFtZSh2ZW5kb3IpLFxyXG4gICAgICBwZXJpb2RvOiAnMjAyNycsXHJcbiAgICAgIHN0YXJ0X2RhdGU6ICcyMDI3LTAxLTAxJyxcclxuICAgICAgZW5kX2RhdGU6ICcyMDI3LTEyLTMxJyxcclxuICAgICAgdGFyZ2V0X3VzZDogdC5hbnVhbDIwMjdfdXNkIHx8IDAsXHJcbiAgICB9KTtcclxuICB9KTtcclxuICBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KHdiLCBYTFNYLnV0aWxzLmpzb25fdG9fc2hlZXQodGFyZ2V0c0xvbmcpLCAndGFyZ2V0c19sb25nJyk7XHJcblxyXG4gIC8vIGNhbXBhXHUwMEYxYXNcclxuICBpZiAoY2FtcGFpZ25zQ2FjaGUubGVuZ3RoKSB7XHJcbiAgICBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KFxyXG4gICAgICB3YixcclxuICAgICAgWExTWC51dGlscy5qc29uX3RvX3NoZWV0KFxyXG4gICAgICAgIGNhbXBhaWduc0NhY2hlLm1hcCgoYykgPT4gKHtcclxuICAgICAgICAgIGlkOiBjLmlkLFxyXG4gICAgICAgICAgbm9tYnJlOiBjLm5hbWUsXHJcbiAgICAgICAgICBmaWx0ZXJfdHlwZTogYy5maWx0ZXJUeXBlLFxyXG4gICAgICAgICAgZmlsdGVyX3ZhbHVlczogKGMuZmlsdGVyVmFsdWVzIHx8IFtdKS5qb2luKCcsJyksXHJcbiAgICAgICAgICB0YXJnZXRfdHlwZTogYy50YXJnZXRUeXBlLFxyXG4gICAgICAgICAgdGFyZ2V0X2Ftb3VudDogYy50YXJnZXRBbW91bnQsXHJcbiAgICAgICAgICBzdGFydF9kYXRlOiBjLnN0YXJ0RGF0ZSxcclxuICAgICAgICAgIGVuZF9kYXRlOiBjLmVuZERhdGUsXHJcbiAgICAgICAgfSkpXHJcbiAgICAgICksXHJcbiAgICAgICdjYW1wYW5pYXMnXHJcbiAgICApO1xyXG4gIH1cclxuXHJcbiAgLy8gcGFyYW1ldHJvc1xyXG4gIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQoXHJcbiAgICB3YixcclxuICAgIFhMU1gudXRpbHMuanNvbl90b19zaGVldChbXHJcbiAgICAgIHsgcGFyYW1ldHJvOiAnZXhjaGFuZ2VfcmF0ZV9hcnNfdXNkJywgdmFsb3I6IEVYQ0hBTkdFX1JBVEUgfSxcclxuICAgICAgeyBwYXJhbWV0cm86ICdmZWNoYV9leHBvcnQnLCB2YWxvcjogbmV3IERhdGUoKS50b0lTT1N0cmluZygpIH0sXHJcbiAgICBdKSxcclxuICAgICdwYXJhbWV0cm9zJ1xyXG4gICk7XHJcblxyXG4gIC8vIHZpc2l0YXNcclxuICBjb25zdCB2aXNpdFJvd3NDID0gYnVpbGRWaXNpdFJvd3MoKTtcclxuICBpZiAodmlzaXRSb3dzQy5sZW5ndGgpXHJcbiAgICBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KHdiLCBYTFNYLnV0aWxzLmpzb25fdG9fc2hlZXQodmlzaXRSb3dzQyksICd2aXNpdGFzJyk7XHJcbiAgLy8gY29udGFjdGFkb3NcclxuICBjb25zdCBjb250YWN0Um93c0MgPSBidWlsZENvbnRhY3RhZG9zUm93cygpO1xyXG4gIGlmIChjb250YWN0Um93c0MubGVuZ3RoKVxyXG4gICAgWExTWC51dGlscy5ib29rX2FwcGVuZF9zaGVldCh3YiwgWExTWC51dGlscy5qc29uX3RvX3NoZWV0KGNvbnRhY3RSb3dzQyksICdjb250YWN0YWRvcycpO1xyXG4gIC8vIGxvZyBkZSBvcGVyYWNpb25lc1xyXG4gIGNvbnN0IG9wc1Jvd3NDID0gYnVpbGRPcHNMb2dSb3dzKCk7XHJcbiAgaWYgKG9wc1Jvd3NDLmxlbmd0aClcclxuICAgIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQod2IsIFhMU1gudXRpbHMuanNvbl90b19zaGVldChvcHNSb3dzQyksICdsb2dfb3BlcmFjaW9uZXMnKTtcclxuXHJcbiAgWExTWC53cml0ZUZpbGUod2IsICdTaGltYW5vX01MXycgKyB0b2RheVN0cigpICsgJy54bHN4Jyk7XHJcbn07XHJcblxyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxuLy8gdjM3MSs6IEV4cG9ydCBkYXRhc2V0IHBhcmEgYW5cdTAwRTFsaXNpcyAoWklQIGRlIENTVnMgcGFyYSBNTCBwaXBlbGluZXMpXHJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG5cclxuLyoqXHJcbiAqIEFicmUgZWwgbW9kYWwgY2hpY28gZGlzcGF0Y2hlciBkZWwgYm90b24gXCJFeHBvcnRhciBhIEV4Y2VsXCIuIE11ZXN0cmFcclxuICogMiB0YXJqZXRhczogUmVwb3J0ZXMgRXhjZWwgKHRvZG9zKSB2cyBEYXRhc2V0IFpJUCAoc29sbyBhZG1pbi9nZXJlbnRlKS5cclxuICovXHJcbndpbmRvdy5vcGVuRXhwb3J0Rm9ybWF0TW9kYWwgPSBmdW5jdGlvbiAoKSB7XHJcbiAgLy8gT2N1bHRhci9tb3N0cmFyIHRhcmpldGEgRGF0YXNldCBzZWd1biByb2wuXHJcbiAgY29uc3QgZHNPcHQgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZXhwLW9wdC1kYXRhc2V0LXppcCcpO1xyXG4gIGlmIChkc09wdCkge1xyXG4gICAgY29uc3QgaXNBZG1pbk9yR2VyZW50ZSA9IHVzZXJSb2xlID09PSAnYWRtaW4nIHx8IHVzZXJSb2xlID09PSAnZ2VyZW50ZSc7XHJcbiAgICBkc09wdC5zdHlsZS5kaXNwbGF5ID0gaXNBZG1pbk9yR2VyZW50ZSA/ICcnIDogJ25vbmUnO1xyXG4gIH1cclxuICAvLyBPY3VsdGFyIHByb2dyZXNzIGJhciAocG9yIHNpIHF1ZWRvIGFiaWVydG8gZGUgdW5hIGVqZWN1Y2lvbiBhbnRlcmlvcilcclxuICBjb25zdCBwcm9nID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2V4cG9ydC1kYXRhc2V0LXByb2dyZXNzJyk7XHJcbiAgaWYgKHByb2cpIHByb2cuc3R5bGUuZGlzcGxheSA9ICdub25lJztcclxuICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZXhwb3J0LWZvcm1hdC1tb2RhbCcpLmNsYXNzTGlzdC5hZGQoJ29wZW4nKTtcclxufTtcclxuXHJcbndpbmRvdy5jbG9zZUV4cG9ydEZvcm1hdE1vZGFsID0gZnVuY3Rpb24gKCkge1xyXG4gIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdleHBvcnQtZm9ybWF0LW1vZGFsJykuY2xhc3NMaXN0LnJlbW92ZSgnb3BlbicpO1xyXG59O1xyXG5cclxuLyoqXHJcbiAqIEFjdHVhbGl6YSBlbCBzdGF0dXMgKyBiYXJyYSBkZWwgbW9kYWwuIHN0YXR1cyBlcyB0ZXh0byBsaWJyZTsgcGVyY2VudCAwLi4xMDAuXHJcbiAqL1xyXG5mdW5jdGlvbiBfdXBkYXRlRXhwb3J0UHJvZ3Jlc3Moc3RhdHVzLCBwZXJjZW50KSB7XHJcbiAgY29uc3QgcyA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdleHBvcnQtZGF0YXNldC1zdGF0dXMnKTtcclxuICBjb25zdCBiID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2V4cG9ydC1kYXRhc2V0LWJhcicpO1xyXG4gIGNvbnN0IHdyYXAgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZXhwb3J0LWRhdGFzZXQtcHJvZ3Jlc3MnKTtcclxuICBpZiAod3JhcCkgd3JhcC5zdHlsZS5kaXNwbGF5ID0gJyc7XHJcbiAgaWYgKHMpIHMudGV4dENvbnRlbnQgPSBzdGF0dXM7XHJcbiAgaWYgKGIpIGIuc3R5bGUud2lkdGggPSBNYXRoLm1heCgwLCBNYXRoLm1pbigxMDAsIHBlcmNlbnQpKSArICclJztcclxufVxyXG5cclxuLyoqXHJcbiAqIEZldGNoIHN0b2NrLmpzb24gZGVsIHJvb3QgZGVsIHNpdGlvICh2MzY5KyB0aWVuZSB3YXJlaG91c2VCcmVha2Rvd24pLlxyXG4gKiBDYWNoZS1idXN0aW5nIGNvbiA/dD0gcGFyYSBldml0YXIgU1cuXHJcbiAqL1xyXG5hc3luYyBmdW5jdGlvbiBfZmV0Y2hTdG9ja0pzb24oKSB7XHJcbiAgdHJ5IHtcclxuICAgIGNvbnN0IHIgPSBhd2FpdCBmZXRjaCgnLi9zdG9jay5qc29uP3Q9JyArIERhdGUubm93KCksIHsgY2FjaGU6ICduby1zdG9yZScgfSk7XHJcbiAgICBpZiAoIXIub2spIHRocm93IG5ldyBFcnJvcignSFRUUCAnICsgci5zdGF0dXMpO1xyXG4gICAgcmV0dXJuIGF3YWl0IHIuanNvbigpO1xyXG4gIH0gY2F0Y2ggKGUpIHtcclxuICAgIGNvbnNvbGUud2FybignW2V4cG9ydERhdGFzZXRaaXBdIHN0b2NrLmpzb24gZmFsbG86JywgZSAmJiBlLm1lc3NhZ2UpO1xyXG4gICAgcmV0dXJuIG51bGw7IC8vIG5vIGJsb3F1ZWFudGUgXHUyMDE0IHByb2R1Y3Rvcy5jc3YgcXVlZGEgdmFjaW9cclxuICB9XHJcbn1cclxuXHJcbi8qKlxyXG4gKiBMYXp5IGxvYWQgSlNaaXAgKHBhdHJvbiB5YSB1c2FkbyBlbiBleHBvcnRQaG90b3NaaXAgbGluZWEgfjQ3KS5cclxuICovXHJcbmFzeW5jIGZ1bmN0aW9uIF9lbnN1cmVKU1ppcExvYWRlZCgpIHtcclxuICBpZiAodHlwZW9mIEpTWmlwICE9PSAndW5kZWZpbmVkJykgcmV0dXJuO1xyXG4gIGF3YWl0IG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcclxuICAgIGNvbnN0IHMgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdzY3JpcHQnKTtcclxuICAgIHMuc3JjID0gJ2h0dHBzOi8vY2RuanMuY2xvdWRmbGFyZS5jb20vYWpheC9saWJzL2pzemlwLzMuMTAuMS9qc3ppcC5taW4uanMnO1xyXG4gICAgcy5vbmxvYWQgPSByZXNvbHZlO1xyXG4gICAgcy5vbmVycm9yID0gKCkgPT4gcmVqZWN0KG5ldyBFcnJvcignTm8gc2UgcHVkbyBjYXJnYXIgSlNaaXAnKSk7XHJcbiAgICBkb2N1bWVudC5oZWFkLmFwcGVuZENoaWxkKHMpO1xyXG4gIH0pO1xyXG59XHJcblxyXG4vKipcclxuICogRGVzY2FyZ2EgdW4gQmxvYiBjb21vIGFyY2hpdm8uIFJldXNhIGVsIHBhdHJvbiBkZSBleHBvcnRQaG90b3NaaXAuXHJcbiAqL1xyXG5mdW5jdGlvbiBfZG93bmxvYWRCbG9iKGJsb2IsIGZpbGVuYW1lKSB7XHJcbiAgY29uc3QgdXJsID0gVVJMLmNyZWF0ZU9iamVjdFVSTChibG9iKTtcclxuICBjb25zdCBhID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnYScpO1xyXG4gIGEuaHJlZiA9IHVybDtcclxuICBhLmRvd25sb2FkID0gZmlsZW5hbWU7XHJcbiAgZG9jdW1lbnQuYm9keS5hcHBlbmRDaGlsZChhKTtcclxuICBhLmNsaWNrKCk7XHJcbiAgc2V0VGltZW91dCgoKSA9PiB7XHJcbiAgICBkb2N1bWVudC5ib2R5LnJlbW92ZUNoaWxkKGEpO1xyXG4gICAgVVJMLnJldm9rZU9iamVjdFVSTCh1cmwpO1xyXG4gIH0sIDEwMCk7XHJcbn1cclxuXHJcbi8qKlxyXG4gKiBFWFBPUlQgUFJJTkNJUEFMLiBTb2xvIGFkbWluL2dlcmVudGUuIEdlbmVyYSBaSVAgY29uOlxyXG4gKiAgLSBwZWRpZG9zLmNzdiwgdmlzaXRhcy5jc3YsIGNsaWVudGVzLmNzdiwgY2xpZW50X21hc3Rlci5jc3YsIHJlbmRpY2lvbmVzLmNzdixcclxuICogICAgY2FtcGFuaWFzLmNzdiwgdGFyZ2V0cy5jc3YsIHByb2R1Y3Rvcy5jc3YsIHZlbmRvcl9vdmVycmlkZXMuY3N2LFxyXG4gKiAgICBjdXN0b21fcm91dGVzLmNzdiwgc2VndWltaWVudG9fbm90ZXMuY3N2XHJcbiAqICAtIG1hbmlmZXN0Lmpzb24gKHNjaGVtYSArIHVzZUNhc2VNYXRyaXggKyByb3dDb3VudHMgKyBudWxsUmF0ZUJ5RmllbGQgKyBsaW1pdGF0aW9ucylcclxuICpcclxuICogQ2Fzb3MgYm9yZGUgbWFuZWphZG9zOlxyXG4gKiAgLSBTaSBhbGd1bmEgLmdldCgpIGZhbGxhIC0+IGFsZXJ0ICsgbm8gZGVzY2FyZ2FyIChubyBnZW5lcmEgWklQIHBhcmNpYWwgc2lsZW5jaW9zbykuXHJcbiAqICAtIFNpIHN0b2NrLmpzb24gbm8gcmVzcG9uZGUgLT4gcHJvZHVjdG9zLmNzdiBxdWVkYSB2YWNpbyBjb24gd2FybmluZyBlbiBtYW5pZmVzdC5cclxuICogIC0gUHJvZ3Jlc3MgYmFyIGVuIGVsIG1vZGFsIHBhcmEgZmVlZGJhY2sgKH4xMC0zMCBzZWcpLlxyXG4gKi9cclxud2luZG93LmV4cG9ydERhdGFzZXRaaXAgPSBhc3luYyBmdW5jdGlvbiAoKSB7XHJcbiAgaWYgKHVzZXJSb2xlICE9PSAnYWRtaW4nICYmIHVzZXJSb2xlICE9PSAnZ2VyZW50ZScpIHtcclxuICAgIGFsZXJ0KCdTb2xvIGFkbWluIG8gZ2VyZW50ZSBwdWVkZW4gZXhwb3J0YXIgZWwgZGF0YXNldC4nKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgaWYgKCFmYkRiKSB7XHJcbiAgICBhbGVydCgnRmlyZXN0b3JlIG5vIGluaWNpYWxpemFkby4gUmVjYXJnYSBsYSBhcHAuJyk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG5cclxuICAvLyBSZS1hYnJpciBtb2RhbCBzaSBlbCB1c3VhcmlvIGNlcnJvIHkgbmF2ZWdhbW9zIHBvciBvdHJvIGZsdWpvLlxyXG4gIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdleHBvcnQtZm9ybWF0LW1vZGFsJykuY2xhc3NMaXN0LmFkZCgnb3BlbicpO1xyXG4gIF91cGRhdGVFeHBvcnRQcm9ncmVzcygnUHJlcGFyYW5kby4uLicsIDUpO1xyXG5cclxuICB0cnkge1xyXG4gICAgX3VwZGF0ZUV4cG9ydFByb2dyZXNzKCdDYXJnYW5kbyBKU1ppcC4uLicsIDEwKTtcclxuICAgIGF3YWl0IF9lbnN1cmVKU1ppcExvYWRlZCgpO1xyXG5cclxuICAgIC8vIDEpIEZldGNoIDEwIGNvbGVjY2lvbmVzIEZpcmVzdG9yZSBlbiBwYXJhbGVsbyArIHN0b2NrLmpzb25cclxuICAgIF91cGRhdGVFeHBvcnRQcm9ncmVzcygnTGV5ZW5kbyBGaXJlc3RvcmUgKDEwIGNvbGVjY2lvbmVzKS4uLicsIDIwKTtcclxuICAgIGNvbnN0IGZpcmVzdG9yZUVudHJpZXMgPSBbXHJcbiAgICAgIFsncGVkaWRvcycsIGZiRGIuY29sbGVjdGlvbigncGVkaWRvcycpLmdldCgpXSxcclxuICAgICAgWyd2aXNpdGFzJywgZmJEYi5jb2xsZWN0aW9uKCd2aXNpdHMnKS5nZXQoKV0sXHJcbiAgICAgIFsnY2xpZW50ZXMnLCBmYkRiLmNvbGxlY3Rpb24oJ2NsaWVudF9hcHBsaWNhdGlvbnMnKS5nZXQoKV0sXHJcbiAgICAgIFsnY2xpZW50X21hc3RlcicsIGZiRGIuY29sbGVjdGlvbignY2xpZW50X21hc3RlcicpLmdldCgpXSxcclxuICAgICAgWydyZW5kaWNpb25lcycsIGZiRGIuY29sbGVjdGlvbigncmVuZGljaW9uZXMnKS5nZXQoKV0sXHJcbiAgICAgIFsnY2FtcGFuaWFzJywgZmJEYi5jb2xsZWN0aW9uKCdjYW1wYWlnbnMnKS5nZXQoKV0sXHJcbiAgICAgIFsndGFyZ2V0cycsIGZiRGIuY29sbGVjdGlvbigndGFyZ2V0cycpLmdldCgpXSxcclxuICAgICAgWyd2ZW5kb3Jfb3ZlcnJpZGVzJywgZmJEYi5jb2xsZWN0aW9uKCd2ZW5kb3Jfb3ZlcnJpZGVzJykuZ2V0KCldLFxyXG4gICAgICBbJ2N1c3RvbV9yb3V0ZXMnLCBmYkRiLmNvbGxlY3Rpb24oJ2N1c3RvbV9yb3V0ZXMnKS5nZXQoKV0sXHJcbiAgICAgIFsnc2VndWltaWVudG9fbm90ZXMnLCBmYkRiLmNvbGxlY3Rpb24oJ3NlZ3VpbWllbnRvX25vdGVzJykuZ2V0KCldLFxyXG4gICAgXTtcclxuICAgIGNvbnN0IHByb21pc2VzID0gZmlyZXN0b3JlRW50cmllcy5tYXAoKFssIHBdKSA9PiBwKTtcclxuICAgIHByb21pc2VzLnB1c2goX2ZldGNoU3RvY2tKc29uKCkpO1xyXG5cclxuICAgIGNvbnN0IHNldHRsZWQgPSBhd2FpdCBQcm9taXNlLmFsbFNldHRsZWQocHJvbWlzZXMpO1xyXG4gICAgLy8gU2kgQ1VBTFFVSUVSIGdldCgpIGRlIEZpcmVzdG9yZSByZWNoYXpvLCBhYm9ydGFtb3MgKG5vIGV4cG9ydCBwYXJjaWFsIHNpbGVuY2lvc28pLlxyXG4gICAgY29uc3QgZmFpbGVkRmlyZXN0b3JlID0gW107XHJcbiAgICBzZXR0bGVkLnNsaWNlKDAsIGZpcmVzdG9yZUVudHJpZXMubGVuZ3RoKS5mb3JFYWNoKChyLCBpKSA9PiB7XHJcbiAgICAgIGlmIChyLnN0YXR1cyA9PT0gJ3JlamVjdGVkJylcclxuICAgICAgICBmYWlsZWRGaXJlc3RvcmUucHVzaChcclxuICAgICAgICAgIGZpcmVzdG9yZUVudHJpZXNbaV1bMF0gKyAnOiAnICsgKChyLnJlYXNvbiAmJiByLnJlYXNvbi5tZXNzYWdlKSB8fCByLnJlYXNvbilcclxuICAgICAgICApO1xyXG4gICAgfSk7XHJcbiAgICBpZiAoZmFpbGVkRmlyZXN0b3JlLmxlbmd0aCkge1xyXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXHJcbiAgICAgICAgJ0ZpcmVzdG9yZSBmZXRjaCBmYWxsbyBlbiAnICtcclxuICAgICAgICAgIGZhaWxlZEZpcmVzdG9yZS5sZW5ndGggK1xyXG4gICAgICAgICAgJyBjb2xlY2Npb25lczpcXG4nICtcclxuICAgICAgICAgIGZhaWxlZEZpcmVzdG9yZS5qb2luKCdcXG4nKVxyXG4gICAgICApO1xyXG4gICAgfVxyXG5cclxuICAgIC8vIDIpIEV4dHJhZXIgc25hcHNob3RzICsgZG9jcyBjb24gX2lkXHJcbiAgICBjb25zdCBzbmFwc2hvdHMgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIGFueVtdPn0gKi8gKHt9KTtcclxuICAgIGZpcmVzdG9yZUVudHJpZXMuZm9yRWFjaCgoW25hbWVdLCBpKSA9PiB7XHJcbiAgICAgIGNvbnN0IHNuYXAgPSAvKiogQHR5cGUge2FueX0gKi8gKHNldHRsZWRbaV0pLnZhbHVlO1xyXG4gICAgICBjb25zdCBkb2NzID0gW107XHJcbiAgICAgIHNuYXAuZm9yRWFjaCgoZCkgPT4ge1xyXG4gICAgICAgIGNvbnN0IGRhdGEgPSBkLmRhdGEoKSB8fCB7fTtcclxuICAgICAgICBkYXRhLl9pZCA9IGQuaWQ7XHJcbiAgICAgICAgZG9jcy5wdXNoKGRhdGEpO1xyXG4gICAgICB9KTtcclxuICAgICAgc25hcHNob3RzW25hbWVdID0gZG9jcztcclxuICAgIH0pO1xyXG4gICAgY29uc3Qgc3RvY2tKc29uID0gLyoqIEB0eXBlIHthbnl9ICovIChzZXR0bGVkW3NldHRsZWQubGVuZ3RoIC0gMV0pLnZhbHVlOyAvLyBwdWVkZSBzZXIgbnVsbFxyXG5cclxuICAgIC8vIDMpIENvbnN0cnVpciBDU1ZzIGNvbiByb3cgYnVpbGRlcnMgKyBzY2hlbWFzXHJcbiAgICBfdXBkYXRlRXhwb3J0UHJvZ3Jlc3MoJ1NlcmlhbGl6YW5kbyBDU1ZzLi4uJywgNTUpO1xyXG4gICAgY29uc3QgY3N2cyA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgc3RyaW5nPn0gKi8gKHt9KTtcclxuICAgIGNvbnN0IHJvd0NvdW50cyA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgbnVtYmVyPn0gKi8gKHt9KTtcclxuICAgIGNvbnN0IGFsbFJvd3NCeUNzdiA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgYW55W11bXT59ICovICh7fSk7XHJcblxyXG4gICAgZm9yIChjb25zdCBjb2xsTmFtZSBvZiBPYmplY3Qua2V5cyhzbmFwc2hvdHMpKSB7XHJcbiAgICAgIGNvbnN0IHNjaGVtYSA9IERBVEFTRVRfU0NIRU1BU1tjb2xsTmFtZV07XHJcbiAgICAgIGlmICghc2NoZW1hKSBjb250aW51ZTtcclxuICAgICAgY29uc3QgYnVpbGRlciA9IFJPV19CVUlMREVSU1tjb2xsTmFtZV07XHJcbiAgICAgIGlmICghYnVpbGRlcikgY29udGludWU7XHJcbiAgICAgIGNvbnN0IGFsbFJvd3MgPSAvKiogQHR5cGUge2FueVtdW119ICovIChbXSk7XHJcbiAgICAgIGZvciAoY29uc3QgZG9jIG9mIHNuYXBzaG90c1tjb2xsTmFtZV0pIHtcclxuICAgICAgICBjb25zdCByb3dzRm9yRG9jID0gYnVpbGRlcihkb2MpO1xyXG4gICAgICAgIGZvciAoY29uc3QgciBvZiByb3dzRm9yRG9jKSBhbGxSb3dzLnB1c2gocik7XHJcbiAgICAgIH1cclxuICAgICAgYWxsUm93c0J5Q3N2W3NjaGVtYS5uYW1lXSA9IGFsbFJvd3M7XHJcbiAgICAgIGNzdnNbc2NoZW1hLm5hbWVdID0gYnVpbGRDc3Yoc2NoZW1hLCBhbGxSb3dzKTtcclxuICAgICAgcm93Q291bnRzW3NjaGVtYS5uYW1lXSA9IGFsbFJvd3MubGVuZ3RoO1xyXG4gICAgfVxyXG5cclxuICAgIC8vIHByb2R1Y3Rvcy5jc3YgKGRlc2RlIHN0b2NrLmpzb24sIG5vIEZpcmVzdG9yZSlcclxuICAgIGNvbnN0IHByb2R1Y3Rvc1NjaGVtYSA9IERBVEFTRVRfU0NIRU1BUy5wcm9kdWN0b3M7XHJcbiAgICBjb25zdCBwcm9kdWN0b3NSb3dzID0gc3RvY2tKc29uID8gYnVpbGRQcm9kdWN0b1Jvd3NGcm9tU3RvY2tKc29uKHN0b2NrSnNvbikgOiBbXTtcclxuICAgIGFsbFJvd3NCeUNzdltwcm9kdWN0b3NTY2hlbWEubmFtZV0gPSBwcm9kdWN0b3NSb3dzO1xyXG4gICAgY3N2c1twcm9kdWN0b3NTY2hlbWEubmFtZV0gPSBidWlsZENzdihwcm9kdWN0b3NTY2hlbWEsIHByb2R1Y3Rvc1Jvd3MpO1xyXG4gICAgcm93Q291bnRzW3Byb2R1Y3Rvc1NjaGVtYS5uYW1lXSA9IHByb2R1Y3Rvc1Jvd3MubGVuZ3RoO1xyXG5cclxuICAgIC8vIDQpIENvbXB1dGFyIG51bGxSYXRlQnlGaWVsZCBwYXJhIGNhZGEgY2FzbyBBLUVcclxuICAgIF91cGRhdGVFeHBvcnRQcm9ncmVzcygnQ2FsY3VsYW5kbyBjYWxpZGFkIGRlbCBkYXRhc2V0Li4uJywgNzUpO1xyXG4gICAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBhbnk+fSAqL1xyXG4gICAgY29uc3QgdXNlQ2FzZVdpdGhTdGF0cyA9IHt9O1xyXG4gICAgZm9yIChjb25zdCBbY2FzZUtleSwgdWNdIG9mIE9iamVjdC5lbnRyaWVzKERBVEFTRVRfVVNFX0NBU0VfTUFUUklYKSkge1xyXG4gICAgICBjb25zdCBzdGF0cyA9IC8qKiBAdHlwZSB7YW55fSAqLyAoe1xyXG4gICAgICAgIHByaW9yaXR5OiB1Yy5wcmlvcml0eSxcclxuICAgICAgICBkZXNjcmlwdGlvbjogdWMuZGVzY3JpcHRpb24sXHJcbiAgICAgICAgcmVxdWlyZWRGaWVsZHM6IHVjLnJlcXVpcmVkRmllbGRzLFxyXG4gICAgICAgIGpvaW5Ob3RlczogdWMuam9pbk5vdGVzLFxyXG4gICAgICAgIG51bGxSYXRlQnlGaWVsZDoge30sXHJcbiAgICAgICAgbGltaXRhdGlvbnM6IFtdLFxyXG4gICAgICB9KTtcclxuICAgICAgbGV0IGhhc0hpZ2hOdWxsUmF0ZSA9IGZhbHNlO1xyXG4gICAgICBsZXQgaGFzRW1wdHlSZXF1aXJlZCA9IGZhbHNlO1xyXG4gICAgICBmb3IgKGNvbnN0IFtjc3ZOYW1lLCBmaWVsZHNdIG9mIE9iamVjdC5lbnRyaWVzKHVjLnJlcXVpcmVkRmllbGRzKSkge1xyXG4gICAgICAgIGNvbnN0IHNjaGVtYUZvckNzdiA9IE9iamVjdC52YWx1ZXMoREFUQVNFVF9TQ0hFTUFTKS5maW5kKChzKSA9PiBzLm5hbWUgPT09IGNzdk5hbWUpO1xyXG4gICAgICAgIGlmICghc2NoZW1hRm9yQ3N2KSB7XHJcbiAgICAgICAgICBzdGF0cy5saW1pdGF0aW9ucy5wdXNoKCdTY2hlbWEgbm8gZW5jb250cmFkbyBwYXJhICcgKyBjc3ZOYW1lKTtcclxuICAgICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICAgIH1cclxuICAgICAgICBjb25zdCByb3dzID0gYWxsUm93c0J5Q3N2W2Nzdk5hbWVdIHx8IFtdO1xyXG4gICAgICAgIGNvbnN0IHJhdGVzID0gY29tcHV0ZU51bGxSYXRlcyhzY2hlbWFGb3JDc3YsIHJvd3MsIGZpZWxkcyk7XHJcbiAgICAgICAgZm9yIChjb25zdCBbZiwgcmF0ZV0gb2YgT2JqZWN0LmVudHJpZXMocmF0ZXMpKSB7XHJcbiAgICAgICAgICBzdGF0cy5udWxsUmF0ZUJ5RmllbGRbY3N2TmFtZSArICcuJyArIGZdID0gcmF0ZTtcclxuICAgICAgICAgIGlmIChyb3dzLmxlbmd0aCA9PT0gMCkgaGFzRW1wdHlSZXF1aXJlZCA9IHRydWU7XHJcbiAgICAgICAgICBlbHNlIGlmIChyYXRlID4gMC41KSBoYXNIaWdoTnVsbFJhdGUgPSB0cnVlO1xyXG4gICAgICAgIH1cclxuICAgICAgfVxyXG4gICAgICBpZiAoaGFzRW1wdHlSZXF1aXJlZCkge1xyXG4gICAgICAgIHN0YXRzLnN0YXR1cyA9ICdFTVBUWSc7XHJcbiAgICAgICAgc3RhdHMubGltaXRhdGlvbnMucHVzaChcclxuICAgICAgICAgICdBbGd1bmEgY29sZWNjaW9uIHJlcXVlcmlkYSBlc3RhIHZhY2lhIFx1MjAxNCBlbCBjYXNvIG5vIHNlIHB1ZWRlIGVudHJlbmFyIGhveSBwZXJvIGVsIHNjaGVtYSBlc3RhIGxpc3RvLidcclxuICAgICAgICApO1xyXG4gICAgICB9IGVsc2UgaWYgKGhhc0hpZ2hOdWxsUmF0ZSkge1xyXG4gICAgICAgIHN0YXRzLnN0YXR1cyA9ICdQQVJUSUFMJztcclxuICAgICAgICBzdGF0cy5saW1pdGF0aW9ucy5wdXNoKFxyXG4gICAgICAgICAgJ0FsIG1lbm9zIDEgY2FtcG8gcmVxdWVyaWRvIHRpZW5lID41MCUgZGUgbnVsbHMgXHUyMDE0IHJldmlzYXIgdGFzYXMgYW50ZXMgZGUgdXNhci4nXHJcbiAgICAgICAgKTtcclxuICAgICAgfSBlbHNlIHtcclxuICAgICAgICBzdGF0cy5zdGF0dXMgPSAnT0snO1xyXG4gICAgICB9XHJcbiAgICAgIHVzZUNhc2VXaXRoU3RhdHNbY2FzZUtleV0gPSBzdGF0cztcclxuICAgIH1cclxuXHJcbiAgICAvLyA1KSBNYW5pZmVzdC5qc29uXHJcbiAgICBjb25zdCBleHBvcnRlZEF0ID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpO1xyXG4gICAgY29uc3QgbWFuaWZlc3QgPSB7XHJcbiAgICAgIGV4cG9ydGVkQXQsXHJcbiAgICAgIGFwcFZlcnNpb246IHR5cGVvZiBBUFBfVkVSU0lPTiAhPT0gJ3VuZGVmaW5lZCcgPyBBUFBfVkVSU0lPTiA6ICd1bmtub3duJyxcclxuICAgICAgc291cmNlUHJvamVjdDogJ2FwcC12ZW5kZWRvcmVzLXNoaW1hbm8nLFxyXG4gICAgICBleHBvcnRlZEJ5RW1haWw6IChjdXJyZW50VXNlciAmJiBjdXJyZW50VXNlci5lbWFpbCkgfHwgJ3Vua25vd24nLFxyXG4gICAgICBleHBvcnRlZEJ5VWlkOiAoY3VycmVudFVzZXIgJiYgY3VycmVudFVzZXIudWlkKSB8fCAndW5rbm93bicsXHJcbiAgICAgIGNzdkNvbnZlbnRpb25zOiB7XHJcbiAgICAgICAgZW5jb2Rpbmc6ICdVVEYtOCcsXHJcbiAgICAgICAgc2VwYXJhdG9yOiAnLCcsXHJcbiAgICAgICAgcXVvdGVDaGFyOiAnXCInLFxyXG4gICAgICAgIGVzY2FwZVF1b3RlOiAnXCJcIicsXHJcbiAgICAgICAgbGluZVRlcm1pbmF0b3I6ICdcXFxcclxcXFxuJyxcclxuICAgICAgICBkYXRlRm9ybWF0OiAnSVNPIDg2MDEgVVRDICh3aXRoIFopJyxcclxuICAgICAgICBkZWNpbWFsU2VwYXJhdG9yOiAnLicsXHJcbiAgICAgICAgbnVsbFJlcHJlc2VudGF0aW9uOiAnKGVtcHR5IGZpZWxkKScsXHJcbiAgICAgICAgYXJyYXlGb3JtYXQ6ICdKU09OIHN0cmluZ2lmaWVkJyxcclxuICAgICAgICBvYmplY3RGb3JtYXQ6ICdKU09OIHN0cmluZ2lmaWVkJyxcclxuICAgICAgfSxcclxuICAgICAgcm93Q291bnRzLFxyXG4gICAgICBzY2hlbWE6IHt9LFxyXG4gICAgICB1c2VDYXNlTWF0cml4OiB1c2VDYXNlV2l0aFN0YXRzLFxyXG4gICAgICBleGNsdXNpb25zOiB7XHJcbiAgICAgICAgbm90ZTogJ0RhdG9zIHNlbnNpYmxlcyB5IGJpbmFyaW9zIGV4Y2x1aWRvcyBkZWwgZXhwb3J0LicsXHJcbiAgICAgICAgZXhjbHVkZWRDb2xsZWN0aW9uczogW1xyXG4gICAgICAgICAgJ3JvbGVzJyxcclxuICAgICAgICAgICdhcHBfY29uZmlnJyxcclxuICAgICAgICAgICdzYXBfc25hcHNob3QnLFxyXG4gICAgICAgICAgJ25vdGlmaWNhdGlvbnMnLFxyXG4gICAgICAgICAgJ29wZXJhdGlvbnNfbG9nJyxcclxuICAgICAgICBdLFxyXG4gICAgICAgIGV4Y2x1ZGVkRmllbGRzOiBbXHJcbiAgICAgICAgICAndmlzaXRzLmZyZW50ZUxvY2FsIChmb3RvcyBiYXNlNjQpJyxcclxuICAgICAgICAgICd2aXNpdHMuZXNwYWNpb1tdIChmb3RvcyBiYXNlNjQpJyxcclxuICAgICAgICAgICdjbGllbnRfYXBwbGljYXRpb25zLmNvbnN0YW5jaWFBcmNhIChiYXNlNjQpJyxcclxuICAgICAgICAgICdjbGllbnRfYXBwbGljYXRpb25zLmNvbnN0YW5jaWFJSUJCIChiYXNlNjQpJyxcclxuICAgICAgICAgICdjbGllbnRfYXBwbGljYXRpb25zLmZvdG9zTG9jYWxbXSAoYmFzZTY0KScsXHJcbiAgICAgICAgICAncmVuZGljaW9uZXMuZm90b1RpY2tldCAoYmFzZTY0IGxlZ2FjeSBwcmUtdjMwODsgc2UgZXhwb3J0YSBzb2xvIGZvdG9UaWNrZXRVcmwpJyxcclxuICAgICAgICBdLFxyXG4gICAgICAgIHN0b2NrSnNvbkxvYWRlZDogc3RvY2tKc29uICE9PSBudWxsLFxyXG4gICAgICB9LFxyXG4gICAgfTtcclxuICAgIGZvciAoY29uc3QgW19jb2xsTmFtZSwgc2NoZW1hXSBvZiBPYmplY3QuZW50cmllcyhEQVRBU0VUX1NDSEVNQVMpKSB7XHJcbiAgICAgIG1hbmlmZXN0LnNjaGVtYVtzY2hlbWEubmFtZV0gPSBzY2hlbWEuY29sdW1ucy5tYXAoKGMpID0+ICh7XHJcbiAgICAgICAgY29sOiBjLmNvbCxcclxuICAgICAgICB0eXBlOiBjLnR5cGUsXHJcbiAgICAgICAgZGVzYzogYy5kZXNjLFxyXG4gICAgICB9KSk7XHJcbiAgICB9XHJcblxyXG4gICAgLy8gNikgRW1wYXF1ZXRhciBaSVBcclxuICAgIF91cGRhdGVFeHBvcnRQcm9ncmVzcygnRW1wYXF1ZXRhbmRvIFpJUC4uLicsIDkwKTtcclxuICAgIGNvbnN0IHppcCA9IG5ldyBKU1ppcCgpO1xyXG4gICAgZm9yIChjb25zdCBbbmFtZSwgY29udGVudF0gb2YgT2JqZWN0LmVudHJpZXMoY3N2cykpIHtcclxuICAgICAgemlwLmZpbGUobmFtZSwgY29udGVudCk7XHJcbiAgICB9XHJcbiAgICB6aXAuZmlsZSgnbWFuaWZlc3QuanNvbicsIEpTT04uc3RyaW5naWZ5KG1hbmlmZXN0LCBudWxsLCAyKSk7XHJcblxyXG4gICAgY29uc3QgYmxvYiA9IGF3YWl0IHppcC5nZW5lcmF0ZUFzeW5jKHtcclxuICAgICAgdHlwZTogJ2Jsb2InLFxyXG4gICAgICBjb21wcmVzc2lvbjogJ0RFRkxBVEUnLFxyXG4gICAgICBjb21wcmVzc2lvbk9wdGlvbnM6IHsgbGV2ZWw6IDYgfSxcclxuICAgIH0pO1xyXG4gICAgY29uc3QgZmlsZW5hbWUgPSAnc2hpbWFuby1kYXRhc2V0LScgKyBleHBvcnRlZEF0LnJlcGxhY2UoL1s6Ll0vZywgJy0nKSArICcuemlwJztcclxuICAgIF9kb3dubG9hZEJsb2IoYmxvYiwgZmlsZW5hbWUpO1xyXG5cclxuICAgIF91cGRhdGVFeHBvcnRQcm9ncmVzcyhcclxuICAgICAgJ0RhdGFzZXQgZGVzY2FyZ2FkbzogJyArXHJcbiAgICAgICAgZmlsZW5hbWUgK1xyXG4gICAgICAgICcgKCcgK1xyXG4gICAgICAgIE9iamVjdC5rZXlzKGNzdnMpLmxlbmd0aCArXHJcbiAgICAgICAgJyBDU1ZzICsgbWFuaWZlc3QuanNvbiknLFxyXG4gICAgICAxMDBcclxuICAgICk7XHJcbiAgICBpZiAodHlwZW9mIHNob3dTeW5jVGFnID09PSAnZnVuY3Rpb24nKSB7XHJcbiAgICAgIGNvbnN0IHRvdGFsUm93cyA9IE9iamVjdC52YWx1ZXMocm93Q291bnRzKS5yZWR1Y2UoKGEsIGIpID0+IGEgKyBiLCAwKTtcclxuICAgICAgc2hvd1N5bmNUYWcoXHJcbiAgICAgICAgJ0RhdGFzZXQgZXhwb3J0YWRvOiAnICsgdG90YWxSb3dzICsgJyBmaWxhcyBlbiAnICsgT2JqZWN0LmtleXMoY3N2cykubGVuZ3RoICsgJyBDU1ZzJ1xyXG4gICAgICApO1xyXG4gICAgfVxyXG4gICAgc2V0VGltZW91dCgoKSA9PiB3aW5kb3cuY2xvc2VFeHBvcnRGb3JtYXRNb2RhbCgpLCAzMDAwKTtcclxuICB9IGNhdGNoIChlKSB7XHJcbiAgICBjb25zb2xlLmVycm9yKCdbZXhwb3J0RGF0YXNldFppcF0gZmF0YWw6JywgZSk7XHJcbiAgICBfdXBkYXRlRXhwb3J0UHJvZ3Jlc3MoJ0Vycm9yOiAnICsgKChlICYmIGUubWVzc2FnZSkgfHwgZSksIDApO1xyXG4gICAgYWxlcnQoXHJcbiAgICAgICdFcnJvciBhbCBleHBvcnRhciBlbCBkYXRhc2V0OlxcblxcbicgK1xyXG4gICAgICAgICgoZSAmJiBlLm1lc3NhZ2UpIHx8IGUpICtcclxuICAgICAgICAnXFxuXFxuRWwgWklQIE5PIHNlIGRlc2NhcmdvIChldml0YW1vcyBnZW5lcmFyIHVuIGFyY2hpdm8gcGFyY2lhbCkuIFJldmlzYSBsYSBjb25zb2xhIHBhcmEgbWFzIGRldGFsbGVzLidcclxuICAgICk7XHJcbiAgfVxyXG59O1xyXG5cclxuLy8gPT09IEV4cG9ydHMgYSB3aW5kb3cgPT09XHJcbi8vIFRvZGFzIGxhcyBmdW5jaW9uZXMgd2luZG93LmZvbyA9IGZ1bmN0aW9uLi4uIHlhIGVzdFx1MDBFMW4gdmVyYmF0aW0uXHJcbmlmICh0eXBlb2Ygd2luZG93LnRvZGF5U3RyID09PSAndW5kZWZpbmVkJykgd2luZG93LnRvZGF5U3RyID0gdG9kYXlTdHI7XHJcbi8vIEU2IGhvdGZpeCAyOiBkYXRhVXJsVG9CbG9iICsgc2FuaXRpemVGb3JQYXRoIHVzYWRvcyBwb3IgaW5saW5lIHJ1bkZ1bGxCYWNrdXAgKEw3Mjc4LTcyODgpLlxyXG5pZiAodHlwZW9mIHdpbmRvdy5kYXRhVXJsVG9CbG9iID09PSAndW5kZWZpbmVkJykgd2luZG93LmRhdGFVcmxUb0Jsb2IgPSBkYXRhVXJsVG9CbG9iO1xyXG5pZiAodHlwZW9mIHdpbmRvdy5zYW5pdGl6ZUZvclBhdGggPT09ICd1bmRlZmluZWQnKSB3aW5kb3cuc2FuaXRpemVGb3JQYXRoID0gc2FuaXRpemVGb3JQYXRoO1xyXG4vLyBFNiBob3RmaXggMzogY3Jvc3MtbW9kdWxlIGJ1ZyAoYXVkaXQgY3Jvc3NidW5kbGUpIFx1MjAxNCBleHBvcnRzLWNvcmUgbGxhbWEgbG9hZEV4Y2VsSlMuXHJcbndpbmRvdy5sb2FkRXhjZWxKUyA9IGxvYWRFeGNlbEpTO1xyXG4iXSwKICAibWFwcGluZ3MiOiAiOzs7QUFvQ08sV0FBUyxVQUFVLEdBQUc7QUFDM0IsUUFBSSxNQUFNLFFBQVEsTUFBTSxPQUFXLFFBQU87QUFDMUMsVUFBTSxNQUFNLE9BQU8sQ0FBQztBQUNwQixRQUFJLFFBQVEsR0FBSSxRQUFPO0FBRXZCLFFBQUksV0FBVyxLQUFLLEdBQUcsR0FBRztBQUN4QixhQUFPLE1BQU0sSUFBSSxRQUFRLE1BQU0sSUFBSSxJQUFJO0FBQUEsSUFDekM7QUFDQSxXQUFPO0FBQUEsRUFD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QUFBLE1BQ0w7QUFBQSxRQUNFLElBQUk7QUFBQSxRQUNKLElBQUk7QUFBQSxRQUNKLElBQUk7QUFBQSxRQUNKLElBQUk7QUFBQSxRQUNKLElBQUk7QUFBQSxRQUNKLElBQUk7QUFBQSxRQUNKLElBQUk7QUFBQSxRQUNKLElBQUk7QUFBQSxRQUNKLElBQUk7QUFBQSxRQUNKLElBQUk7QUFBQSxRQUNKLElBQUk7QUFBQSxRQUNKLElBQUk7QUFBQSxRQUNKLElBQUk7QUFBQSxRQUNKLElBQUk7QUFBQSxRQUNKLElBQUk7QUFBQSxRQUNKLElBQUk7QUFBQSxRQUNKLElBQUk7QUFBQSxRQUNKLElBQUk7QUFBQSxRQUNKLElBQUk7QUFBQSxRQUNKLElBQUk7QUFBQSxRQUNKLElBQUk7QUFBQSxRQUNKLElBQUk7QUFBQSxRQUNKLElBQUk7QUFBQSxRQUNKLElBQUk7QUFBQSxRQUNKLElBQUk7QUFBQSxRQUNKLElBQUk7QUFBQSxRQUNKLElBQUk7QUFBQSxRQUNKLElBQUk7QUFBQSxRQUNKLElBQUk7QUFBQSxRQUNKLElBQUk7QUFBQSxRQUNKLElBQUk7QUFBQSxRQUNKLElBQUk7QUFBQSxRQUNKLElBQUk7QUFBQSxNQUNOO0FBQUEsSUFDRjtBQUFBLEVBQ0Y7QUFHTyxXQUFTLGlCQUFpQixLQUFLO0FBQ3BDLFdBQU87QUFBQSxNQUNMO0FBQUEsUUFDRSxJQUFJO0FBQUEsUUFDSixJQUFJO0FBQUEsUUFDSixJQUFJO0FBQUEsUUFDSixJQUFJO0FBQUEsUUFDSixJQUFJO0FBQUEsUUFDSixJQUFJO0FBQUEsUUFDSixJQUFJO0FBQUEsUUFDSixJQUFJO0FBQUEsUUFDSixJQUFJO0FBQUEsUUFDSixJQUFJO0FBQUEsUUFDSixJQUFJO0FBQUEsUUFDSixJQUFJO0FBQUEsUUFDSixJQUFJO0FBQUEsUUFDSixJQUFJO0FBQUEsUUFDSixJQUFJO0FBQUEsUUFDSixJQUFJO0FBQUEsUUFDSixJQUFJO0FBQUEsUUFDSixJQUFJO0FBQUEsUUFDSixJQUFJO0FBQUEsUUFDSixJQUFJO0FBQUEsUUFDSixJQUFJO0FBQUEsUUFD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
