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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL3B1cmUvY3N2LXNlcmlhbGl6ZXIuanMiLCAiLi4vc3JjL2RvbWFpbnMvZXhwb3J0cy1hZHZhbmNlZC5qcyJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiLy8gQHRzLWNoZWNrXG4vKipcbiAqIENTViBzZXJpYWxpemVyICsgZGF0YXNldCBzY2hlbWFzICsgcm93IGJ1aWxkZXJzIFx1MjAxNCBwYXJhIGV4cG9ydERhdGFzZXRaaXBcbiAqICh2MzcxKykuIEZ1bmNpb25lcyBwdXJhcywgdGVzdGVhYmxlcyBzaW4gZ2xvYmFscyBkZWwgYnVuZGxlLlxuICpcbiAqIDUgY2Fzb3MgZGUgdXNvIE1MIGRvY3VtZW50YWRvcyBlbiBEQVRBU0VUX1VTRV9DQVNFX01BVFJJWDpcbiAqICAgQSkgQ29udmVyc2lvbiB2aXNpdGEtPnBlZGlkbyAocHJpb3JpZGFkIDEsIGNsYXNpZmljYWNpb24pXG4gKiAgIEIpIFJpZXNnbyBkZSBjaHVybiBkZSBjbGllbnRlcyAocHJpb3JpZGFkIDIsIGFsZXJ0YSlcbiAqICAgQykgRm9yZWNhc3QgZGUgZGVtYW5kYSBwb3IgU0tVIChwcmlvcmlkYWQgMywgc2VyaWVzIHRlbXBvcmFsZXMpXG4gKiAgIEQpIEFub21hbGlhcyBlbiByZW5kaWNpb25lcyAoZXhwbG9yYXRvcmlvKVxuICogICBFKSBFc3RhY2lvbmFsaWRhZCBwb3Igem9uYS9jYW1wYW5hIChleHBsb3JhdG9yaW8pXG4gKlxuICogQ29udmVuY2lvbmVzIChSRkMgNDE4MCArIGFkYXB0YWNpb25lcyBwYXJhIE1MIHBpcGVsaW5lcyk6XG4gKiAgIC0gU2VwYXJhdG9yOiBcIixcIlxuICogICAtIFF1b3RlIGNoYXI6IFwiXFxcIlwiXG4gKiAgIC0gRXNjYXBlIHF1b3RlOiBcIlxcXCJcXFwiXCJcbiAqICAgLSBMaW5lIHRlcm1pbmF0b3I6IFwiXFxyXFxuXCJcbiAqICAgLSBFbmNvZGluZzogVVRGLTggKEJPTSBvcGNpb25hbCBhbCBlc2NyaWJpciBlbCBaSVApXG4gKiAgIC0gRmVjaGFzOiBJU08gODYwMSBVVEMgKGNvbiBcIlpcIiBhbCBmaW5hbClcbiAqICAgLSBEZWNpbWFsZXM6IHB1bnRvIChcIi5cIilcbiAqICAgLSBOdWxsL3VuZGVmaW5lZDogY2FtcG8gdmFjaW8gKE5PIFwiTi9BXCIsIFwiLVwiLCBcIm51bGxcIilcbiAqICAgLSBBcnJheXMgLT4gSlNPTi5zdHJpbmdpZnkgZW50cmUgY29taWxsYXMgZG9ibGVzXG4gKiAgIC0gT2JqZXRvcyAoZXhjZXB0byBUaW1lc3RhbXAgeSBEYXRlKSAtPiBKU09OLnN0cmluZ2lmeVxuICogICAtIEZpcmVzdG9yZSBUaW1lc3RhbXBzIC0+IHRvRGF0ZSgpLnRvSVNPU3RyaW5nKClcbiAqL1xuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIEhlbHBlcnMgQ1NWIHB1cm9zXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuLyoqXG4gKiBFc2NhcGEgdW4gdmFsb3Igc3RyaW5nIHBhcmEgQ1NWIFJGQyA0MTgwLiBXcmFwcGVhIGNvbiBcIi4uLlwiIHNpIGNvbnRpZW5lXG4gKiBcIixcIiwgXCJcXFwiXCIsIFwiXFxyXCIgbyBcIlxcblwiLiBFc2NhcGEgXCJcXFwiXCIgLT4gXCJcXFwiXFxcIlwiLlxuICogQHBhcmFtIHtzdHJpbmd9IHNcbiAqIEByZXR1cm5zIHtzdHJpbmd9XG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjc3ZFc2NhcGUocykge1xuICBpZiAocyA9PT0gbnVsbCB8fCBzID09PSB1bmRlZmluZWQpIHJldHVybiAnJztcbiAgY29uc3Qgc3RyID0gU3RyaW5nKHMpO1xuICBpZiAoc3RyID09PSAnJykgcmV0dXJuICcnO1xuICAvLyBOZWNlc2l0YSBxdW90aW5nIHNpIHRpZW5lIGNvbWEsIHF1b3RlLCBvIGxpbmUtYnJlYWtcbiAgaWYgKC9bXCIsXFxyXFxuXS8udGVzdChzdHIpKSB7XG4gICAgcmV0dXJuICdcIicgKyBzdHIucmVwbGFjZSgvXCIvZywgJ1wiXCInKSArICdcIic7XG4gIH1cbiAgcmV0dXJuIHN0cjtcbn1cblxuLyoqXG4gKiBDb252aWVydGUgdW4gYXJyYXkgZGUgdmFsb3JlcyBlbiB1bmEgbGluZWEgQ1NWIChzaW4gdHJhaWxpbmcgbmV3bGluZSkuXG4gKiBBcGxpY2EgY3N2RXNjYXBlIGEgY2FkYSBjYW1wbyBkZXNwdWVzIGRlIGZpcmVzdG9yZVZhbHVlVG9Dc3YuXG4gKiBAcGFyYW0ge3Vua25vd25bXX0gZmllbGRzXG4gKiBAcmV0dXJucyB7c3RyaW5nfVxuICovXG5leHBvcnQgZnVuY3Rpb24gY3N2Um93KGZpZWxkcykge1xuICByZXR1cm4gZmllbGRzLm1hcCgoZikgPT4gY3N2RXNjYXBlKGZpcmVzdG9yZVZhbHVlVG9Dc3YoZikpKS5qb2luKCcsJyk7XG59XG5cbi8qKlxuICogQ29udmllcnRlIHVuIHZhbG9yIGRlIEZpcmVzdG9yZS9KUyBhIHN0cmluZyBhcHRvIHBhcmEgQ1NWLlxuICogUmVnbGEgcG9yIHRpcG86XG4gKiAgIC0gbnVsbCAvIHVuZGVmaW5lZCAtPiAnJ1xuICogICAtIEZpcmVzdG9yZSBUaW1lc3RhbXAgKHRpZW5lIC50b0RhdGUpIC0+IElTTyA4NjAxIFVUQ1xuICogICAtIERhdGUgLT4gSVNPIDg2MDEgVVRDXG4gKiAgIC0gYm9vbGVhbiAtPiAndHJ1ZScgLyAnZmFsc2UnXG4gKiAgIC0gbnVtYmVyIC0+IFN0cmluZyhuKSBjb24gcHVudG8gZGVjaW1hbFxuICogICAtIHN0cmluZyAtPiB0YWwgY3VhbCAoY3N2RXNjYXBlIHdyYXBwZWEgc2kgaGFjZSBmYWx0YSlcbiAqICAgLSBBcnJheSAtPiBKU09OLnN0cmluZ2lmeVxuICogICAtIE9iamVjdCAtPiBKU09OLnN0cmluZ2lmeVxuICogQHBhcmFtIHt1bmtub3dufSB2XG4gKiBAcmV0dXJucyB7c3RyaW5nfVxuICovXG5leHBvcnQgZnVuY3Rpb24gZmlyZXN0b3JlVmFsdWVUb0Nzdih2KSB7XG4gIGlmICh2ID09PSBudWxsIHx8IHYgPT09IHVuZGVmaW5lZCkgcmV0dXJuICcnO1xuICBpZiAodHlwZW9mIHYgPT09ICdzdHJpbmcnKSByZXR1cm4gdjtcbiAgaWYgKHR5cGVvZiB2ID09PSAnbnVtYmVyJykge1xuICAgIGlmICghTnVtYmVyLmlzRmluaXRlKHYpKSByZXR1cm4gJyc7IC8vIE5hTiwgSW5maW5pdHkgLT4gdmFjaW8gKG5vIGNvbmZ1bmRpciBwaXBlbGluZXMpXG4gICAgcmV0dXJuIFN0cmluZyh2KTtcbiAgfVxuICBpZiAodHlwZW9mIHYgPT09ICdib29sZWFuJykgcmV0dXJuIHYgPyAndHJ1ZScgOiAnZmFsc2UnO1xuICAvLyBGaXJlc3RvcmUgVGltZXN0YW1wXG4gIGlmIChcbiAgICB0eXBlb2YgdiA9PT0gJ29iamVjdCcgJiZcbiAgICB2ICE9PSBudWxsICYmXG4gICAgdHlwZW9mICgvKiogQHR5cGUge2FueX0gKi8gKHYpLnRvRGF0ZSkgPT09ICdmdW5jdGlvbidcbiAgKSB7XG4gICAgdHJ5IHtcbiAgICAgIHJldHVybiAvKiogQHR5cGUge2FueX0gKi8gKHYpLnRvRGF0ZSgpLnRvSVNPU3RyaW5nKCk7XG4gICAgfSBjYXRjaCAoXykge1xuICAgICAgcmV0dXJuICcnO1xuICAgIH1cbiAgfVxuICBpZiAodiBpbnN0YW5jZW9mIERhdGUpIHtcbiAgICBpZiAoTnVtYmVyLmlzTmFOKHYuZ2V0VGltZSgpKSkgcmV0dXJuICcnO1xuICAgIHJldHVybiB2LnRvSVNPU3RyaW5nKCk7XG4gIH1cbiAgaWYgKEFycmF5LmlzQXJyYXkodikpIHtcbiAgICAvLyBKU09OLnN0cmluZ2lmeSBkZSBhcnJheS4gY3N2RXNjYXBlIGx1ZWdvIGxvIHdyYXBwZWEgc2kgaGF5IGNvbWFzLlxuICAgIHRyeSB7XG4gICAgICByZXR1cm4gSlNPTi5zdHJpbmdpZnkodik7XG4gICAgfSBjYXRjaCAoXykge1xuICAgICAgcmV0dXJuICcnO1xuICAgIH1cbiAgfVxuICBpZiAodHlwZW9mIHYgPT09ICdvYmplY3QnKSB7XG4gICAgdHJ5IHtcbiAgICAgIHJldHVybiBKU09OLnN0cmluZ2lmeSh2KTtcbiAgICB9IGNhdGNoIChfKSB7XG4gICAgICByZXR1cm4gJyc7XG4gICAgfVxuICB9XG4gIHJldHVybiBTdHJpbmcodik7XG59XG5cbi8qKlxuICogT2J0aWVuZSBlbCB2YWxvciBkZSB1biBwYXRoIGRvdC1ub3RhdGlvbiBlbiB1biBvYmpldG8gYW5pZGFkby5cbiAqIEVqOiBnZXRQYXRoKHthOiB7Yjoge2M6IDF9fX0sICdhLmIuYycpIC0+IDFcbiAqIGdldFBhdGgoe30sICdhLmInKSAtPiB1bmRlZmluZWRcbiAqIEBwYXJhbSB7b2JqZWN0fSBvYmpcbiAqIEBwYXJhbSB7c3RyaW5nfSBwYXRoXG4gKiBAcmV0dXJucyB7dW5rbm93bn1cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGdldFBhdGgob2JqLCBwYXRoKSB7XG4gIGlmICghb2JqIHx8ICFwYXRoKSByZXR1cm4gdW5kZWZpbmVkO1xuICBjb25zdCBwYXJ0cyA9IHBhdGguc3BsaXQoJy4nKTtcbiAgbGV0IGN1ciA9IC8qKiBAdHlwZSB7YW55fSAqLyAob2JqKTtcbiAgZm9yIChjb25zdCBwIG9mIHBhcnRzKSB7XG4gICAgaWYgKGN1ciA9PT0gbnVsbCB8fCBjdXIgPT09IHVuZGVmaW5lZCkgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICBjdXIgPSBjdXJbcF07XG4gIH1cbiAgcmV0dXJuIGN1cjtcbn1cblxuLyoqXG4gKiBDb25zdHJ1eWUgZWwgQ1NWIGNvbXBsZXRvIChoZWFkZXIgKyBOIHJvd3MpIHBhcmEgdW5hIGNvbGVjY2lvbiBzZWd1blxuICogc3Ugc2NoZW1hLiBDYWRhIGJ1aWxkZXIgZGV2dWVsdmUgdW4gYXJyYXkgZGUgZmlsYXMgKGNhZGEgZmlsYSA9IGFycmF5XG4gKiBkZSB2YWxvcmVzIGVuIGVsIG9yZGVuIGRlbCBzY2hlbWEpLlxuICogQHBhcmFtIHt7Y29sdW1uczoge2NvbDogc3RyaW5nfVtdfX0gc2NoZW1hXG4gKiBAcGFyYW0ge3Vua25vd25bXVtdfSByb3dzXG4gKiBAcmV0dXJucyB7c3RyaW5nfSBDU1YgY29tcGxldG8gY29uIFxcclxcbiBjb21vIGxpbmUgc2VwYXJhdG9yXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBidWlsZENzdihzY2hlbWEsIHJvd3MpIHtcbiAgY29uc3QgaGVhZGVyID0gc2NoZW1hLmNvbHVtbnMubWFwKChjKSA9PiBjc3ZFc2NhcGUoYy5jb2wpKS5qb2luKCcsJyk7XG4gIGNvbnN0IGJvZHkgPSByb3dzLm1hcCgocikgPT4gY3N2Um93KHIpKS5qb2luKCdcXHJcXG4nKTtcbiAgcmV0dXJuIGJvZHkubGVuZ3RoID8gaGVhZGVyICsgJ1xcclxcbicgKyBib2R5ICsgJ1xcclxcbicgOiBoZWFkZXIgKyAnXFxyXFxuJztcbn1cblxuLyoqXG4gKiBDdWVudGEgbnVsbCByYXRlIHBvciBjb2x1bW5hIHJlcXVlcmlkYS4gUmV0b3JuYVxuICoge2NvbE5hbWU6IHJhdGUgMC4uMX0uIFVuIHZhbG9yIGVzIFwibnVsbFwiIHNpIGZpcmVzdG9yZVZhbHVlVG9Dc3YgZGV2dWVsdmUgJycuXG4gKiBAcGFyYW0ge3tjb2x1bW5zOiB7Y29sOiBzdHJpbmd9W119fSBzY2hlbWFcbiAqIEBwYXJhbSB7dW5rbm93bltdW119IHJvd3NcbiAqIEBwYXJhbSB7c3RyaW5nW119IHJlcXVpcmVkQ29sc1xuICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIG51bWJlcj59XG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjb21wdXRlTnVsbFJhdGVzKHNjaGVtYSwgcm93cywgcmVxdWlyZWRDb2xzKSB7XG4gIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgbnVtYmVyPn0gKi9cbiAgY29uc3QgcmVzdWx0ID0ge307XG4gIGlmICghcm93cy5sZW5ndGgpIHtcbiAgICAvLyBzaW4gZGF0b3M6IG51bGwgcmF0ZSA9IDEgKDEwMCUgZmFsdGEpIHBhcmEgY2FkYSBjYW1wbyByZXF1ZXJpZG9cbiAgICBmb3IgKGNvbnN0IGMgb2YgcmVxdWlyZWRDb2xzKSByZXN1bHRbY10gPSAxO1xuICAgIHJldHVybiByZXN1bHQ7XG4gIH1cbiAgY29uc3QgY29sSW5kZXggPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIG51bWJlcj59ICovICh7fSk7XG4gIHNjaGVtYS5jb2x1bW5zLmZvckVhY2goKGMsIGkpID0+IHtcbiAgICBjb2xJbmRleFtjLmNvbF0gPSBpO1xuICB9KTtcbiAgZm9yIChjb25zdCByYyBvZiByZXF1aXJlZENvbHMpIHtcbiAgICBjb25zdCBpZHggPSBjb2xJbmRleFtyY107XG4gICAgaWYgKGlkeCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICByZXN1bHRbcmNdID0gMTsgLy8gY29sdW1uYSBubyBleGlzdGUgZW4gc2NoZW1hIC0+IGNvbnNpZGVyYXIgY29tbyAxMDAlIG51bGxcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBsZXQgbnVsbHMgPSAwO1xuICAgIGZvciAoY29uc3Qgcm93IG9mIHJvd3MpIHtcbiAgICAgIGNvbnN0IHYgPSByb3dbaWR4XTtcbiAgICAgIGlmIChmaXJlc3RvcmVWYWx1ZVRvQ3N2KHYpID09PSAnJykgbnVsbHMrKztcbiAgICB9XG4gICAgcmVzdWx0W3JjXSA9IE1hdGgucm91bmQoKG51bGxzIC8gcm93cy5sZW5ndGgpICogMTAwMDApIC8gMTAwMDA7XG4gIH1cbiAgcmV0dXJuIHJlc3VsdDtcbn1cblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBEQVRBU0VUX1NDSEVNQVMgXHUyMDE0IDExIGNvbGVjY2lvbmVzIGNvbiBjb2x1bW5hcyArIHRpcG9zICsgZGVzY3JpcGNpb25lc1xuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbi8qKiBAdHlwZWRlZiB7e2NvbDogc3RyaW5nLCB0eXBlOiBzdHJpbmcsIGRlc2M6IHN0cmluZ319IFNjaGVtYUNvbHVtbiAqL1xuLyoqIEB0eXBlZGVmIHt7bmFtZTogc3RyaW5nLCBzb3VyY2U6ICdmaXJlc3RvcmUnfCdzdG9ja19qc29uJywgY29sbGVjdGlvbj86IHN0cmluZywgcm93TW9kZTogc3RyaW5nLCBjb2x1bW5zOiBTY2hlbWFDb2x1bW5bXX19IERhdGFzZXRTY2hlbWEgKi9cblxuLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBEYXRhc2V0U2NoZW1hPn0gKi9cbmV4cG9ydCBjb25zdCBEQVRBU0VUX1NDSEVNQVMgPSB7XG4gIHBlZGlkb3M6IHtcbiAgICBuYW1lOiAncGVkaWRvcy5jc3YnLFxuICAgIHNvdXJjZTogJ2ZpcmVzdG9yZScsXG4gICAgY29sbGVjdGlvbjogJ3BlZGlkb3MnLFxuICAgIHJvd01vZGU6ICdmbGF0dGVuX2xpbmVzJywgLy8gMSBmaWxhIHBvciAocGVkaWRvLCBsaW5lYSlcbiAgICBjb2x1bW5zOiBbXG4gICAgICB7IGNvbDogJ3BlZGlkb19pZCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnRmlyZXN0b3JlIGRvYyBJRCcgfSxcbiAgICAgIHsgY29sOiAnb3duZXJfdWlkJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdVSUQgZGVsIHZlbmRlZG9yIGR1ZW5pbyBkZWwgcGVkaWRvJyB9LFxuICAgICAgeyBjb2w6ICdvd25lcl9lbWFpbCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnZW1haWwgZGVsIHZlbmRlZG9yJyB9LFxuICAgICAgeyBjb2w6ICdjcmVhdGVkX2J5X3VpZCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAncXVpZW4gY2FyZ28gKFZESSBwdWVkZSBjYXJnYXIgcG9yIFZERSknIH0sXG4gICAgICB7IGNvbDogJ29uX2JlaGFsZl9vZicsIHR5cGU6ICdib29sZWFuJywgZGVzYzogJ3RydWUgc2kgVkRJIGNhcmdvIHBvciBWREUnIH0sXG4gICAgICB7IGNvbDogJ2tleScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnY2xhdmUgY29tcHVlc3RhIHRpcG98cHJvdnxsb2N8Y2xpZW50ZScgfSxcbiAgICAgIHsgY29sOiAnc3RhZ2UnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ3BlbmRpbmcgfCBjb25maXJtZWQgfCBzYXBfaW1wb3J0ZWQnIH0sXG4gICAgICB7IGNvbDogJ3RpcG8nLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ0M9Y2xpZW50ZSB8IFA9cHJvc3BlY3RvJyB9LFxuICAgICAgeyBjb2w6ICdwcm92aW5jZScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAncHJvdmluY2lhJyB9LFxuICAgICAgeyBjb2w6ICdsb2NfbmFtZScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnbG9jYWxpZGFkJyB9LFxuICAgICAgeyBjb2w6ICdjbGllbnRfbmFtZScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnbm9tYnJlIGNsaWVudGUnIH0sXG4gICAgICB7IGNvbDogJ21vbnRoJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdlaiBcIkp1bGlvIDIwMjZcIicgfSxcbiAgICAgIHsgY29sOiAnbW9udGhfaWR4JywgdHlwZTogJ2ludCcsIGRlc2M6ICcwLTExJyB9LFxuICAgICAgeyBjb2w6ICd5ZWFyJywgdHlwZTogJ2ludCcsIGRlc2M6ICdhbm8nIH0sXG4gICAgICB7IGNvbDogJ2NvbmZpcm1lZF9hdCcsIHR5cGU6ICdpc284NjAxJywgZGVzYzogJ3RpbWVzdGFtcCBVVEMgZGUgY29uZmlybWFjaW9uJyB9LFxuICAgICAgeyBjb2w6ICdjb25kaWNpb25fcGFnbycsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnZWogQ1RBIENURScgfSxcbiAgICAgIHsgY29sOiAnZm9ybWFfZW50cmVnYV90aXBvJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdUUkFOU1BPUlRJU1RBIHwgU1VDVVJTQUwnIH0sXG4gICAgICB7IGNvbDogJ2Zvcm1hX2VudHJlZ2FfdHJhbnNwX25vbWJyZScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJyB9LFxuICAgICAgeyBjb2w6ICdmb3JtYV9lbnRyZWdhX3RyYW5zcF9kaXJlY2Npb24nLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcbiAgICAgIHsgY29sOiAnZm9ybWFfZW50cmVnYV9jbGllbnRlX2RpcmVjY2lvbicsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnZGVzdGlubyBmaW5hbCcgfSxcbiAgICAgIHsgY29sOiAnZm9ybWFfZW50cmVnYV9zdWN1cnNhbF9kaXJlY2Npb24nLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcbiAgICAgIHtcbiAgICAgICAgY29sOiAnZGlzY291bnRfcGN0JyxcbiAgICAgICAgdHlwZTogJ251bWJlcicsXG4gICAgICAgIGRlc2M6ICdkZXNjdWVudG8gdG90YWwgZGVsIHBlZGlkbyAoYXBsaWNhZG8gYSBuaXZlbCBoZWFkZXIsIHByb3JyYXRlYXIgZW4gcGlwZWxpbmUpJyxcbiAgICAgIH0sXG4gICAgICB7IGNvbDogJ3N1YnRvdGFsX2FycycsIHR5cGU6ICdudW1iZXInLCBkZXNjOiAnc3VidG90YWwgYnJ1dG8gQVJTJyB9LFxuICAgICAgeyBjb2w6ICduZXRfYW1vdW50X2FycycsIHR5cGU6ICdudW1iZXInLCBkZXNjOiAnbmV0byBBUlMgcG9zdC1kZXNjdWVudG8nIH0sXG4gICAgICB7IGNvbDogJ3RyYW5zZmVyaWRvX3NhcF92aWEnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ2R0d19tYW51YWwgfCBzZXJ2aWNlX2xheWVyJyB9LFxuICAgICAgeyBjb2w6ICd0cmFuc2Zlcmlkb19zYXBfZG9jX251bScsIHR5cGU6ICdpbnQnLCBkZXNjOiAnbnVtZXJvIGRlIFF1b3RhdGlvbiBTQVAnIH0sXG4gICAgICB7IGNvbDogJ3RyYW5zZmVyaWRvX3NhcF9kb2NfZW50cnknLCB0eXBlOiAnaW50JywgZGVzYzogJ2RvYyBlbnRyeSBpbnRlcm5vIFNBUCcgfSxcbiAgICAgIHsgY29sOiAndHJhbnNmZXJpZG9fc2FwX2F0JywgdHlwZTogJ2lzbzg2MDEnLCBkZXNjOiAndGltZXN0YW1wIFVUQycgfSxcbiAgICAgIHsgY29sOiAnY3JlYXRlZF9hdCcsIHR5cGU6ICdpc284NjAxJywgZGVzYzogJ3RpbWVzdGFtcCBVVEMnIH0sXG4gICAgICB7IGNvbDogJ2xpbmVfaW5kZXgnLCB0eXBlOiAnaW50JywgZGVzYzogJ2luZGljZSBkZSBsaW5lYSAwLWJhc2VkJyB9LFxuICAgICAgeyBjb2w6ICdsaW5lX2NvZGUnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ1NLVScgfSxcbiAgICAgIHsgY29sOiAnbGluZV9kZXNjJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdkZXNjcmlwY2lvbiBwcm9kdWN0bycgfSxcbiAgICAgIHsgY29sOiAnbGluZV9xdHknLCB0eXBlOiAnbnVtYmVyJywgZGVzYzogJ2NhbnRpZGFkJyB9LFxuICAgICAgeyBjb2w6ICdsaW5lX3ByZWNpbycsIHR5cGU6ICdudW1iZXInLCBkZXNjOiAncHJlY2lvIHVuaXRhcmlvIEFSUycgfSxcbiAgICAgIHsgY29sOiAnbGluZV9jYXQnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ2NhdGVnb3JpYScgfSxcbiAgICAgIHsgY29sOiAnbGluZV9mYW0nLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ2ZhbWlsaWEnIH0sXG4gICAgICB7IGNvbDogJ2xpbmVfc3ViJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdzdWJmYW1pbGlhJyB9LFxuICAgIF0sXG4gIH0sXG4gIHZpc2l0YXM6IHtcbiAgICBuYW1lOiAndmlzaXRhcy5jc3YnLFxuICAgIHNvdXJjZTogJ2ZpcmVzdG9yZScsXG4gICAgY29sbGVjdGlvbjogJ3Zpc2l0cycsXG4gICAgcm93TW9kZTogJ29uZV9wZXJfZG9jJyxcbiAgICBjb2x1bW5zOiBbXG4gICAgICB7IGNvbDogJ3Zpc2l0X2lkJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdGaXJlc3RvcmUgZG9jIElEJyB9LFxuICAgICAgeyBjb2w6ICdvd25lcl91aWQnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ1VJRCBkZWwgdmVuZGVkb3InIH0sXG4gICAgICB7IGNvbDogJ293bmVyX2VtYWlsJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdlbWFpbCBkZWwgdmVuZGVkb3InIH0sXG4gICAgICB7IGNvbDogJ2ZlY2hhJywgdHlwZTogJ2lzbzg2MDEnLCBkZXNjOiAnWVlZWS1NTS1ERCAoZmVjaGEgZGUgdmlzaXRhLCBubyBVVEMpJyB9LFxuICAgICAgeyBjb2w6ICdtZXMnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ0pVTklPLCBKVUxJTywgZXRjLicgfSxcbiAgICAgIHsgY29sOiAnYW5pbycsIHR5cGU6ICdpbnQnLCBkZXNjOiAnYW5vJyB9LFxuICAgICAgeyBjb2w6ICd2ZW5kb3InLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ25vbWJyZSBjYW5vbmljbyB2ZW5kZWRvcicgfSxcbiAgICAgIHsgY29sOiAncHJvdmluY2lhJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdwcm92aW5jaWEnIH0sXG4gICAgICB7IGNvbDogJ2xvY2FsaWRhZCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnbG9jYWxpZGFkJyB9LFxuICAgICAgeyBjb2w6ICd0aWVuZGEnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ25vbWJyZSB0aWVuZGEnIH0sXG4gICAgICB7IGNvbDogJ3RpcG8nLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ0MgfCBQJyB9LFxuICAgICAgeyBjb2w6ICdsb2NhbCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnZWogUHJvcGlvLCBBbHF1aWxhZG8nIH0sXG4gICAgICB7IGNvbDogJ3RhbWFubycsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnZWogQ2hpY28sIE1lZGlhbm8sIEdyYW5kZScgfSxcbiAgICAgIHsgY29sOiAnZmlkZWxpZGFkJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdBbHRhLCBNZWRpYSwgQmFqYScgfSxcbiAgICAgIHsgY29sOiAncmVsZXZhbmNpYScsIHR5cGU6ICdpbnQnLCBkZXNjOiAnMC01JyB9LFxuICAgICAgeyBjb2w6ICdwb3AnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ2VqIFN0aWNrZXJzIFNoaW1hbm8nIH0sXG4gICAgICB7IGNvbDogJ25lY2VzaWRhZF9wdW50dWFsJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXG4gICAgICB7IGNvbDogJ3RpcG9fdmVudGEnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ2VqIENhc2EgZGUgcGVzY2EgKyBlY29tbWVyY2UnIH0sXG4gICAgICB7IGNvbDogJ3BvbmRlcmFjaW9uX21vc3RyYWRvJywgdHlwZTogJ2ludCcsIGRlc2M6ICcwLTEwMCcgfSxcbiAgICAgIHsgY29sOiAncG9uZGVyYWNpb25fZWNvbW1lcmNlJywgdHlwZTogJ2ludCcsIGRlc2M6ICcwLTEwMCcgfSxcbiAgICAgIHsgY29sOiAnY29tcGV0ZW5jaWEnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcbiAgICAgIHsgY29sOiAnb3BvcnR1bmlkYWQnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcbiAgICAgIHsgY29sOiAnbWFzX3ZlbmRpZG8nLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcbiAgICAgIHsgY29sOiAnbWFzX3ByZWd1bnRhbicsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJyB9LFxuICAgICAgeyBjb2w6ICdheXVkYV90aWVuZGEnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcbiAgICAgIHsgY29sOiAnZ3BzX3N0YXR1cycsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnb2sgfCBvdXRzaWRlIHwgbm9sb2MnIH0sXG4gICAgICB7IGNvbDogJ2dwc19kaXN0YW5jZV9tJywgdHlwZTogJ251bWJlcicsIGRlc2M6ICdtZXRyb3MnIH0sXG4gICAgICB7IGNvbDogJ2ludGVyYWN0aW9uX3R5cGUnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ3Zpc2l0YSB8IGNvbnRhY3RvJyB9LFxuICAgICAge1xuICAgICAgICBjb2w6ICdmb3JtYV9jb250YWN0bycsXG4gICAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgICBkZXNjOiAnTExBTUFEQSBURUxFRk9OSUNBIHwgTUVOU0FKRSBERSBXSEFUU0FQUCB8IE1FTlNBSkUgU01TIChzaSBjb250YWN0byknLFxuICAgICAgfSxcbiAgICAgIHtcbiAgICAgICAgY29sOiAnY29udGFjdG9fcmVzdWx0YWRvJyxcbiAgICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICAgIGRlc2M6ICdyZXNwb25kaW8gfCBub19yZXNwb25kaW8gfCB2YWNpbyAoc2luIG1hcmNhciwgc29sbyBhcGxpY2EgYSBjb250YWN0byknLFxuICAgICAgfSxcbiAgICAgIHsgY29sOiAnY29udGFjdG9fcmVzdWx0YWRvX2F0JywgdHlwZTogJ2lzbzg2MDEnLCBkZXNjOiAndGltZXN0YW1wIFVUQycgfSxcbiAgICAgIHsgY29sOiAnY29udGFjdG9fcmVzdWx0YWRvX2J5JywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdVSUQgZGUgcXVpZW4gbWFyY28nIH0sXG4gICAgICB7IGNvbDogJ2NyZWF0ZWRfYXQnLCB0eXBlOiAnaXNvODYwMScsIGRlc2M6ICd0aW1lc3RhbXAgVVRDJyB9LFxuICAgIF0sXG4gIH0sXG4gIGNsaWVudGVzOiB7XG4gICAgbmFtZTogJ2NsaWVudGVzLmNzdicsXG4gICAgc291cmNlOiAnZmlyZXN0b3JlJyxcbiAgICBjb2xsZWN0aW9uOiAnY2xpZW50X2FwcGxpY2F0aW9ucycsXG4gICAgcm93TW9kZTogJ29uZV9wZXJfZG9jJyxcbiAgICBjb2x1bW5zOiBbXG4gICAgICB7IGNvbDogJ2FwcF9pZCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnRmlyZXN0b3JlIGRvYyBJRCcgfSxcbiAgICAgIHsgY29sOiAnb3duZXJfdWlkJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXG4gICAgICB7IGNvbDogJ293bmVyX2VtYWlsJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXG4gICAgICB7IGNvbDogJ293bmVyX25hbWUnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcbiAgICAgIHsgY29sOiAnY29tZXJjaW8nLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ3Jhem9uIHNvY2lhbCcgfSxcbiAgICAgIHsgY29sOiAnZmFudGFzaWEnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ25vbWJyZSBjb21lcmNpYWwnIH0sXG4gICAgICB7IGNvbDogJ2N1aXQnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ3NvbG8gZGlnaXRvcyBwb3N0LXYyOTQnIH0sXG4gICAgICB7IGNvbDogJ2NvbmRpY2lvbl9maXNjYWwnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcbiAgICAgIHsgY29sOiAnY2FsbGUnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcbiAgICAgIHsgY29sOiAnbnVtZXJvJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXG4gICAgICB7IGNvbDogJ2xvY2FsaWRhZCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJyB9LFxuICAgICAgeyBjb2w6ICdwcm92aW5jaWEnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcbiAgICAgIHsgY29sOiAnbG9jYWxpZGFkX2ZpbmFsJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdvdmVycmlkZSBkZWwgYXByb2JhZG9yJyB9LFxuICAgICAgeyBjb2w6ICdjYXJkX2NvZGVfc2FwJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdDYXJkQ29kZSBTQVAnIH0sXG4gICAgICB7IGNvbDogJ2Fzc2lnbmVkX3ZlbmRvcicsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAndmVuZGVkb3IgYXNpZ25hZG8gKHNvdXJjZSBvZiB0cnV0aCB2MzExKyknIH0sXG4gICAgICB7IGNvbDogJ3N0YXR1cycsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAncGVuZGluZ19hcHByb3ZhbCB8IGFwcHJvdmVkIHwgcmVqZWN0ZWQnIH0sXG4gICAgICB7XG4gICAgICAgIGNvbDogJ3NvdXJjZScsXG4gICAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgICBkZXNjOiAnbWFudWFsIHwgc2FwX2J1bGtfaW1wb3J0IHwgYWx0YV9yYXBpZGEgfCBzYXBfc3luYyB8IHNhcF9zeW5jX21hbnVhbF9saW5rJyxcbiAgICAgIH0sXG4gICAgICB7XG4gICAgICAgIGNvbDogJ21hbnVhbF9zYXBfcGVuZGluZycsXG4gICAgICAgIHR5cGU6ICdib29sZWFuJyxcbiAgICAgICAgZGVzYzogJ3RydWU9cHJvdmlzb3JpbyAoQWx0YSBSYXBpZGEgc2luIENhcmRDb2RlKScsXG4gICAgICB9LFxuICAgICAgeyBjb2w6ICdwcmVjYXVjaW9uJywgdHlwZTogJ2Jvb2xlYW4nLCBkZXNjOiAndHJ1ZT1jbGllbnRlIG1hcmNhZG8gcG9yIGltcGFnbycgfSxcbiAgICAgIHsgY29sOiAnY2F0ZWdvcmlhX2NsaWVudGUnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ1AvQS9CL0MnIH0sXG4gICAgICB7IGNvbDogJ2NsaV90aXBvJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdDIGRlZmF1bHQgcG9zdC12MzQ5JyB9LFxuICAgICAgeyBjb2w6ICdsYXQnLCB0eXBlOiAnbnVtYmVyJywgZGVzYzogJ2dlb2xhdCcgfSxcbiAgICAgIHsgY29sOiAnbG5nJywgdHlwZTogJ251bWJlcicsIGRlc2M6ICdnZW9sbmcnIH0sXG4gICAgICB7IGNvbDogJ2hhc19nZW8nLCB0eXBlOiAnYm9vbGVhbicsIGRlc2M6ICdsYXQvbG5nIG5vIG51bGwnIH0sXG4gICAgICB7IGNvbDogJ2hhc19hZGRyZXNzJywgdHlwZTogJ2Jvb2xlYW4nLCBkZXNjOiAnY2FsbGUgbm8gdmFjaWEnIH0sXG4gICAgICB7IGNvbDogJ3N1Ym1pdHRlZF9ieV9wdWJsaWNfZm9ybScsIHR5cGU6ICdib29sZWFuJywgZGVzYzogJ3ZpYSBhbHRhLWNsaWVudGUuaHRtbCcgfSxcbiAgICAgIHsgY29sOiAnYXBwcm92ZWRfYXQnLCB0eXBlOiAnaXNvODYwMScsIGRlc2M6ICcnIH0sXG4gICAgICB7IGNvbDogJ2NyZWF0ZWRfYXQnLCB0eXBlOiAnaXNvODYwMScsIGRlc2M6ICcnIH0sXG4gICAgICB7IGNvbDogJ3VwZGF0ZWRfYXQnLCB0eXBlOiAnaXNvODYwMScsIGRlc2M6ICcnIH0sXG4gICAgXSxcbiAgfSxcbiAgY2xpZW50X21hc3Rlcjoge1xuICAgIG5hbWU6ICdjbGllbnRfbWFzdGVyLmNzdicsXG4gICAgc291cmNlOiAnZmlyZXN0b3JlJyxcbiAgICBjb2xsZWN0aW9uOiAnY2xpZW50X21hc3RlcicsXG4gICAgcm93TW9kZTogJ29uZV9wZXJfZG9jJyxcbiAgICBjb2x1bW5zOiBbXG4gICAgICB7IGNvbDogJ21hc3Rlcl9pZCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnRmlyZXN0b3JlIGRvYyBJRCcgfSxcbiAgICAgIHsgY29sOiAnY2xpZW50X25hbWUnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcbiAgICAgIHsgY29sOiAncHJvdmluY2lhJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXG4gICAgICB7IGNvbDogJ2xvY2FsaWRhZCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJyB9LFxuICAgICAgeyBjb2w6ICd2ZW5kb3InLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ3ZlbmRlZG9yIGN1cmFkbyBhZG1pbicgfSxcbiAgICAgIHsgY29sOiAnYWRkcmVzcycsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnZGlyZWNjaW9uIGN1cmFkYSBhZG1pbicgfSxcbiAgICAgIHsgY29sOiAnc2FwX2NhcmRfY29kZScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnQ2FyZENvZGUgU0FQJyB9LFxuICAgICAgeyBjb2w6ICdzYXBfYWRkcmVzcycsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnZGlyZWNjaW9uIHJhdyBTQVAnIH0sXG4gICAgICB7IGNvbDogJ3NhcF9jaXR5JywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXG4gICAgICB7IGNvbDogJ3NhcF9zdGF0ZScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJyB9LFxuICAgICAgeyBjb2w6ICdzYXBfaW1wb3J0ZWRfYXQnLCB0eXBlOiAnaXNvODYwMScsIGRlc2M6ICcnIH0sXG4gICAgICB7IGNvbDogJ3NhcF9pbXBvcnRlZF9ieScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJyB9LFxuICAgICAgeyBjb2w6ICdjbGllbnRfbmFtZV9vcmlnaW5hbCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnYmFja3VwIG5vbWJyZSBwcmUtaW1wb3J0JyB9LFxuICAgICAgeyBjb2w6ICdsb2NhbGlkYWRfb3JpZ2luYWwnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ2JhY2t1cCBsb2NhbGlkYWQgcHJlLWltcG9ydCcgfSxcbiAgICAgIHsgY29sOiAnbWF0Y2hfdHlwZScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnZXhhY3QgfCBmdXp6eScgfSxcbiAgICAgIHsgY29sOiAnbWF0Y2hfc2ltaWxhcml0eScsIHR5cGU6ICdudW1iZXInLCBkZXNjOiAnMC0xJyB9LFxuICAgICAgeyBjb2w6ICd1cGRhdGVkX2F0JywgdHlwZTogJ2lzbzg2MDEnLCBkZXNjOiAnJyB9LFxuICAgICAgeyBjb2w6ICd1cGRhdGVkX2J5JywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXG4gICAgXSxcbiAgfSxcbiAgcmVuZGljaW9uZXM6IHtcbiAgICBuYW1lOiAncmVuZGljaW9uZXMuY3N2JyxcbiAgICBzb3VyY2U6ICdmaXJlc3RvcmUnLFxuICAgIGNvbGxlY3Rpb246ICdyZW5kaWNpb25lcycsXG4gICAgcm93TW9kZTogJ29uZV9wZXJfZG9jJyxcbiAgICBjb2x1bW5zOiBbXG4gICAgICB7IGNvbDogJ3JlbmRpY2lvbl9pZCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnRmlyZXN0b3JlIGRvYyBJRCcgfSxcbiAgICAgIHsgY29sOiAnb3duZXJfdWlkJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXG4gICAgICB7IGNvbDogJ293bmVyX2VtYWlsJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXG4gICAgICB7IGNvbDogJ3ZlbmRvcicsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJyB9LFxuICAgICAgeyBjb2w6ICd0aXBvJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdnYXN0byB8IHNvbGljaXR1ZCcgfSxcbiAgICAgIHsgY29sOiAndGlwb19nYXN0bycsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnZWogUEVBSkVTLCBGQUNUVVJBIEEsIEdBU1RPIENPTiBDT01QUk9CQU5URScgfSxcbiAgICAgIHsgY29sOiAnaW1wb3J0ZV9hcnMnLCB0eXBlOiAnbnVtYmVyJywgZGVzYzogJ21vbnRvIEFSUycgfSxcbiAgICAgIHsgY29sOiAnZmVjaGFfZ2FzdG8nLCB0eXBlOiAnaXNvODYwMScsIGRlc2M6ICdZWVlZLU1NLUREIGRlbCBnYXN0bycgfSxcbiAgICAgIHsgY29sOiAnY29uY2VwdG8nLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ2Rlc2NyaXBjaW9uIGxpYnJlJyB9LFxuICAgICAgeyBjb2w6ICdmb3RvX3RpY2tldF91cmwnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ1VSTCBGaXJlYmFzZSBTdG9yYWdlIHYzMDgrIChudW5jYSBiYXNlNjQpJyB9LFxuICAgICAgeyBjb2w6ICdzdGF0dXMnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ3BlbmRpbmdfYXBwcm92YWwgfCBhcHByb3ZlZCB8IHJlamVjdGVkJyB9LFxuICAgICAgeyBjb2w6ICdhcHByb3ZlZF9ieScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnZW1haWwgZGVsIGFwcm9iYWRvciBvIFwic2VsZlwiJyB9LFxuICAgICAgeyBjb2w6ICdhcHByb3ZlZF9hdCcsIHR5cGU6ICdpc284NjAxJywgZGVzYzogJycgfSxcbiAgICAgIHsgY29sOiAncmVqZWN0ZWRfYnlfZW1haWwnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcbiAgICAgIHsgY29sOiAncmVqZWN0ZWRfcmVhc29uJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXG4gICAgICB7IGNvbDogJ2FwcHJvdmVyX3VpZCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnVUlEIHJlc3BvbnNhYmxlIGFzaWduYWRvJyB9LFxuICAgICAgeyBjb2w6ICdjcmVhdGVkX2F0JywgdHlwZTogJ2lzbzg2MDEnLCBkZXNjOiAnJyB9LFxuICAgIF0sXG4gIH0sXG4gIGNhbXBhbmlhczoge1xuICAgIG5hbWU6ICdjYW1wYW5pYXMuY3N2JyxcbiAgICBzb3VyY2U6ICdmaXJlc3RvcmUnLFxuICAgIGNvbGxlY3Rpb246ICdjYW1wYWlnbnMnLFxuICAgIHJvd01vZGU6ICdvbmVfcGVyX2RvYycsXG4gICAgY29sdW1uczogW1xuICAgICAgeyBjb2w6ICdjYW1wYWlnbl9pZCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnRmlyZXN0b3JlIGRvYyBJRCcgfSxcbiAgICAgIHsgY29sOiAnbmFtZScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnbm9tYnJlIGNhbXBhbmEnIH0sXG4gICAgICB7IGNvbDogJ2ZhbWlsaWEnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ2VqIFJFRUxTJyB9LFxuICAgICAgeyBjb2w6ICdzdWJmYW1pbGlhJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdlaiBNVUxUSVBMSUNBRE9SRVMnIH0sXG4gICAgICB7IGNvbDogJ2ZpbHRlcl90eXBlJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdza3UgKGhveSBoYXJkY29kZWQpJyB9LFxuICAgICAgeyBjb2w6ICdmaWx0ZXJfdmFsdWVzX2pzb24nLCB0eXBlOiAnanNvbl9hcnJheScsIGRlc2M6ICdjb3BpYSBkZSBza3VzJyB9LFxuICAgICAgeyBjb2w6ICdza3VzX2pzb24nLCB0eXBlOiAnanNvbl9hcnJheScsIGRlc2M6ICdJdGVtQ29kZXMgaW5jbHVpZG9zJyB9LFxuICAgICAgeyBjb2w6ICdza3VzX2NvdW50JywgdHlwZTogJ2ludCcsIGRlc2M6ICdjYW50aWRhZCBTS1VzJyB9LFxuICAgICAgeyBjb2w6ICd0YXJnZXRfdHlwZScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAndW5pdHMgfCBtb25leScgfSxcbiAgICAgIHsgY29sOiAndGFyZ2V0X2Ftb3VudCcsIHR5cGU6ICdudW1iZXInLCBkZXNjOiAnb2JqZXRpdm8nIH0sXG4gICAgICB7IGNvbDogJ3N0YXJ0X2RhdGUnLCB0eXBlOiAnaXNvODYwMScsIGRlc2M6ICdZWVlZLU1NLUREJyB9LFxuICAgICAgeyBjb2w6ICdlbmRfZGF0ZScsIHR5cGU6ICdpc284NjAxJywgZGVzYzogJ1lZWVktTU0tREQnIH0sXG4gICAgICB7IGNvbDogJ3Njb3BlJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdhbGwgfCBwcm92aW5jZSB8IHZlbmRvcicgfSxcbiAgICAgIHtcbiAgICAgICAgY29sOiAnc2NvcGVfdmFsdWVzX2pzb24nLFxuICAgICAgICB0eXBlOiAnanNvbl9hcnJheScsXG4gICAgICAgIGRlc2M6ICdwcm92aW5jaWFzIG8gdmVuZG9yIGtleXMgc2kgc2NvcGUgIT0gYWxsJyxcbiAgICAgIH0sXG4gICAgICB7IGNvbDogJ2NyZWF0ZWRfYnknLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ1VJRCBhZG1pbi9nZXJlbnRlJyB9LFxuICAgICAgeyBjb2w6ICdjcmVhdGVkX2J5X2VtYWlsJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXG4gICAgICB7IGNvbDogJ2NyZWF0ZWRfYXQnLCB0eXBlOiAnaXNvODYwMScsIGRlc2M6ICcnIH0sXG4gICAgICB7IGNvbDogJ2FyY2hpdmVkX21hbnVhbGx5JywgdHlwZTogJ2Jvb2xlYW4nLCBkZXNjOiAndHJ1ZT1maW5hbGl6YWRhIGFudGVzIGRlIGVuZERhdGUnIH0sXG4gICAgICB7IGNvbDogJ2FyY2hpdmVkX2F0JywgdHlwZTogJ2lzbzg2MDEnLCBkZXNjOiAnJyB9LFxuICAgICAgeyBjb2w6ICdhcmNoaXZlZF9ieScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJyB9LFxuICAgIF0sXG4gIH0sXG4gIHRhcmdldHM6IHtcbiAgICBuYW1lOiAndGFyZ2V0cy5jc3YnLFxuICAgIHNvdXJjZTogJ2ZpcmVzdG9yZScsXG4gICAgY29sbGVjdGlvbjogJ3RhcmdldHMnLFxuICAgIHJvd01vZGU6ICdvbmVfcGVyX2RvYycsXG4gICAgY29sdW1uczogW1xuICAgICAgeyBjb2w6ICd0YXJnZXRfaWQnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ0ZpcmVzdG9yZSBkb2MgSUQgY2Fub25pY28ge3ZlbmRvcn1fe3llYXJ9X3tNTX0nIH0sXG4gICAgICB7IGNvbDogJ3NlbGxlcl9pZCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAndmVuZG9yS2V5IHVwcGVyY2FzZSBlaiBHT05aQUxPIERFIExBIFJPU0EnIH0sXG4gICAgICB7IGNvbDogJ3llYXInLCB0eXBlOiAnaW50JywgZGVzYzogJ2VqIDIwMjYnIH0sXG4gICAgICB7IGNvbDogJ21vbnRoJywgdHlwZTogJ2ludCcsIGRlc2M6ICcwLTExIChpbmRpY2UgZGVsIGFycmF5IE1FU0VTIDAtaW5kZXhlZCknIH0sXG4gICAgICB7IGNvbDogJ3RhcmdldF9hcnMnLCB0eXBlOiAnbnVtYmVyJywgZGVzYzogJ29iamV0aXZvIG1lcyBBUlMgKHN1bWEgZmFtaWxpYXMpJyB9LFxuICAgICAgeyBjb2w6ICd0YXJnZXRfcmVlbF9hcnMnLCB0eXBlOiAnbnVtYmVyJywgZGVzYzogJ3YzMTErIGRlc2dsb3NlJyB9LFxuICAgICAgeyBjb2w6ICd0YXJnZXRfY2FuYXNfYXJzJywgdHlwZTogJ251bWJlcicsIGRlc2M6ICd2MzExKyBkZXNnbG9zZScgfSxcbiAgICAgIHsgY29sOiAndGFyZ2V0X2xpbmVhc19hcnMnLCB0eXBlOiAnbnVtYmVyJywgZGVzYzogJ3YzMTErIGRlc2dsb3NlJyB9LFxuICAgICAgeyBjb2w6ICd1cGRhdGVkX2F0JywgdHlwZTogJ2lzbzg2MDEnLCBkZXNjOiAnJyB9LFxuICAgICAgeyBjb2w6ICd1cGRhdGVkX2J5JywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdVSUQnIH0sXG4gICAgICB7IGNvbDogJ3VwZGF0ZWRfYnlfZW1haWwnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcbiAgICBdLFxuICB9LFxuICBwcm9kdWN0b3M6IHtcbiAgICBuYW1lOiAncHJvZHVjdG9zLmNzdicsXG4gICAgc291cmNlOiAnc3RvY2tfanNvbicsXG4gICAgcm93TW9kZTogJ2Zyb21fc3RvY2tfanNvbicsXG4gICAgY29sdW1uczogW1xuICAgICAgeyBjb2w6ICdza3UnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ1NLVSAoSXRlbUNvZGUgU0FQKScgfSxcbiAgICAgIHsgY29sOiAnaGFzX3N0b2NrJywgdHlwZTogJ2Jvb2xlYW4nLCBkZXNjOiAndHJ1ZT1oYXkgdW5pZGFkZXMgZW4gYWxndW4gd2hzIHZlbmRpYmxlJyB9LFxuICAgICAgeyBjb2w6ICdjYW50aWRhZF90b3RhbCcsIHR5cGU6ICdpbnQnLCBkZXNjOiAnc3VtYSB0b3RhbCB3aHMgdmVuZGlibGVzIChleGNsdXllIDA1IHkgMDYpJyB9LFxuICAgICAge1xuICAgICAgICBjb2w6ICdkaXNwb25pYmxlX3ZlbnRhX3doczExJyxcbiAgICAgICAgdHlwZTogJ2ludCcsXG4gICAgICAgIGRlc2M6ICd2MzY5KyBNZXJjYWRlcmlhIE5VUiBQRVNDQSAodmVudGEgZGlyZWN0YSknLFxuICAgICAgfSxcbiAgICAgIHsgY29sOiAndHJhbnNpdG9fd2hzMTInLCB0eXBlOiAnaW50JywgZGVzYzogJ3YzNjkrIEVuIHRyYW5zaXRvIFBFU0NBIChiYWNrb3JkZXIgZnV0dXJvKScgfSxcbiAgICAgIHtcbiAgICAgICAgY29sOiAnb3Ryb3Nfd2FyZWhvdXNlc19qc29uJyxcbiAgICAgICAgdHlwZTogJ2pzb25fb2JqZWN0JyxcbiAgICAgICAgZGVzYzogJ290cm9zIGNvZGlnb3MgY29uIGNhbnRpZGFkLCBlaiB7XCI5OFwiOiA1fScsXG4gICAgICB9LFxuICAgICAgeyBjb2w6ICdzb3VyY2UnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ3N0b2NrLmpzb24gc25hcHNob3QnIH0sXG4gICAgICB7IGNvbDogJ3NuYXBzaG90X3VwZGF0ZWRfYXQnLCB0eXBlOiAnaXNvODYwMScsIGRlc2M6ICd0aW1lc3RhbXAgZGVsIHVsdGltbyBzeW5jIFNBUCcgfSxcbiAgICBdLFxuICB9LFxuICB2ZW5kb3Jfb3ZlcnJpZGVzOiB7XG4gICAgbmFtZTogJ3ZlbmRvcl9vdmVycmlkZXMuY3N2JyxcbiAgICBzb3VyY2U6ICdmaXJlc3RvcmUnLFxuICAgIGNvbGxlY3Rpb246ICd2ZW5kb3Jfb3ZlcnJpZGVzJyxcbiAgICByb3dNb2RlOiAnb25lX3Blcl9kb2MnLFxuICAgIGNvbHVtbnM6IFtcbiAgICAgIHsgY29sOiAnb3ZlcnJpZGVfaWQnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ0ZpcmVzdG9yZSBkb2MgSUQnIH0sXG4gICAgICB7IGNvbDogJ3Njb3BlJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdzaG9wIHwgbG9jJyB9LFxuICAgICAgeyBjb2w6ICdwcm92aW5jZScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJyB9LFxuICAgICAgeyBjb2w6ICdsb2NhbGl0eV9uYW1lJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXG4gICAgICB7IGNvbDogJ2NsaWVudF9uYW1lJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdzb2xvIHNpIHNjb3BlPXNob3AnIH0sXG4gICAgICB7IGNvbDogJ29yaWdpbmFsX3ZlbmRvcicsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJyB9LFxuICAgICAgeyBjb2w6ICduZXdfdmVuZG9yJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXG4gICAgICB7IGNvbDogJ25ld190eXBlJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdWREUgfCBWREkgfCBESVNUUklCVUlET1IgfCBPVFJPJyB9LFxuICAgICAgeyBjb2w6ICd1cGRhdGVkX2F0JywgdHlwZTogJ2lzbzg2MDEnLCBkZXNjOiAnJyB9LFxuICAgICAgeyBjb2w6ICd1cGRhdGVkX2J5X3VpZCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJyB9LFxuICAgICAgeyBjb2w6ICd1cGRhdGVkX2J5X2VtYWlsJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXG4gICAgICB7IGNvbDogJ3VwZGF0ZWRfYnlfZGlzcGxheV9uYW1lJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXG4gICAgXSxcbiAgfSxcbiAgY3VzdG9tX3JvdXRlczoge1xuICAgIG5hbWU6ICdjdXN0b21fcm91dGVzLmNzdicsXG4gICAgc291cmNlOiAnZmlyZXN0b3JlJyxcbiAgICBjb2xsZWN0aW9uOiAnY3VzdG9tX3JvdXRlcycsXG4gICAgcm93TW9kZTogJ2ZsYXR0ZW5fc3RvcHMnLCAvLyAxIGZpbGEgcG9yIChydXRhLCBzdG9wKVxuICAgIGNvbHVtbnM6IFtcbiAgICAgIHsgY29sOiAncm91dGVfaWQnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ0ZpcmVzdG9yZSBkb2MgSUQnIH0sXG4gICAgICB7IGNvbDogJ293bmVyX3VpZCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnZHVlbmlvIGRlIGxhIHJ1dGEnIH0sXG4gICAgICB7IGNvbDogJ293bmVyX2VtYWlsJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXG4gICAgICB7IGNvbDogJ25hbWUnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ25vbWJyZSBkZSBsYSBydXRhJyB9LFxuICAgICAgeyBjb2w6ICdwbGFubmVkX2RhdGUnLCB0eXBlOiAnaXNvODYwMScsIGRlc2M6ICdZWVlZLU1NLUREJyB9LFxuICAgICAgeyBjb2w6ICdub3RlcycsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnbm90YXMgbGlicmVzJyB9LFxuICAgICAgeyBjb2w6ICdjcmVhdGVkX2F0JywgdHlwZTogJ2lzbzg2MDEnLCBkZXNjOiAnJyB9LFxuICAgICAgeyBjb2w6ICd1cGRhdGVkX2F0JywgdHlwZTogJ2lzbzg2MDEnLCBkZXNjOiAnJyB9LFxuICAgICAgeyBjb2w6ICdzdG9wX29yZGVyJywgdHlwZTogJ2ludCcsIGRlc2M6ICdvcmRlbiAwLWJhc2VkJyB9LFxuICAgICAgeyBjb2w6ICdzdG9wX2tleScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnY2xhdmUgY29tcHVlc3RhIHRpcG98cHJvdnxsb2N8Y2xpZW50ZScgfSxcbiAgICAgIHsgY29sOiAnc3RvcF90aXBvJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdDIHwgUCcgfSxcbiAgICAgIHsgY29sOiAnc3RvcF9wcm92aW5jaWEnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcbiAgICAgIHsgY29sOiAnc3RvcF9sb2NhbGlkYWQnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcbiAgICAgIHsgY29sOiAnc3RvcF9jbGllbnRfbmFtZScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJyB9LFxuICAgICAgeyBjb2w6ICdzdG9wX2lzX3Byb3Zpc29yaW8nLCB0eXBlOiAnYm9vbGVhbicsIGRlc2M6ICd0cnVlPWFsdGEgcmFwaWRhIHNpbiBDYXJkQ29kZScgfSxcbiAgICAgIHsgY29sOiAnc3RvcF9zYXBfYWx0YV9pZCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnSUQgZGVsIGNsaWVudF9hcHBsaWNhdGlvbnMgc2kgYXBsaWNhJyB9LFxuICAgIF0sXG4gIH0sXG4gIHNlZ3VpbWllbnRvX25vdGVzOiB7XG4gICAgbmFtZTogJ3NlZ3VpbWllbnRvX25vdGVzLmNzdicsXG4gICAgc291cmNlOiAnZmlyZXN0b3JlJyxcbiAgICBjb2xsZWN0aW9uOiAnc2VndWltaWVudG9fbm90ZXMnLFxuICAgIHJvd01vZGU6ICdvbmVfcGVyX2RvYycsXG4gICAgY29sdW1uczogW1xuICAgICAgeyBjb2w6ICdub3RlX2lkJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdGaXJlc3RvcmUgZG9jIElEJyB9LFxuICAgICAgeyBjb2w6ICd2ZW5kb3JfZXh0JywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdWREUgYWwgcXVlIGFwbGljYSBsYSBub3RhJyB9LFxuICAgICAgeyBjb2w6ICdjbGllbnRfa2V5JywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdjbGF2ZSBjb21wdWVzdGEgY2xpZW50ZScgfSxcbiAgICAgIHsgY29sOiAnY2xpZW50X25hbWUnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcbiAgICAgIHsgY29sOiAncHJvdmluY2UnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcbiAgICAgIHsgY29sOiAnbG9jYWxpdHknLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcbiAgICAgIHsgY29sOiAndGV4dCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAndGV4dG8gbGlicmUgZGUgbGEgbm90YScgfSxcbiAgICAgIHsgY29sOiAnYXV0aG9yX3VpZCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJyB9LFxuICAgICAgeyBjb2w6ICdhdXRob3JfZW1haWwnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcbiAgICAgIHsgY29sOiAnYXV0aG9yX25hbWUnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcbiAgICAgIHsgY29sOiAnYXV0aG9yX3JvbGUnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ2FkbWluIHwgZ2VyZW50ZSB8IGludGVybm8nIH0sXG4gICAgICB7IGNvbDogJ2NyZWF0ZWRfYXQnLCB0eXBlOiAnaXNvODYwMScsIGRlc2M6ICcnIH0sXG4gICAgXSxcbiAgfSxcbn07XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gREFUQVNFVF9VU0VfQ0FTRV9NQVRSSVggXHUyMDE0IGNhc29zIGRlIHVzbyBNTCBjb24gY2FtcG9zIHJlcXVlcmlkb3Ncbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4vKiogQHR5cGVkZWYge3twcmlvcml0eTogbnVtYmVyfHN0cmluZywgZGVzY3JpcHRpb246IHN0cmluZywgcmVxdWlyZWRGaWVsZHM6IFJlY29yZDxzdHJpbmcsIHN0cmluZ1tdPiwgam9pbk5vdGVzPzogc3RyaW5nfX0gVXNlQ2FzZSAqL1xuXG4vKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFVzZUNhc2U+fSAqL1xuZXhwb3J0IGNvbnN0IERBVEFTRVRfVVNFX0NBU0VfTUFUUklYID0ge1xuICBBX2NvbnZlcnNpb25fdmlzaXRhX3BlZGlkbzoge1xuICAgIHByaW9yaXR5OiAxLFxuICAgIGRlc2NyaXB0aW9uOiAnUHJlZGVjaXIgcXVlIHZpc2l0YXMgdGVybWluYW4gZW4gcGVkaWRvIHBhcmEgcHJpb3JpemFyIGxhIHJ1dGEgZGVsIHZlbmRlZG9yLicsXG4gICAgcmVxdWlyZWRGaWVsZHM6IHtcbiAgICAgICd2aXNpdGFzLmNzdic6IFsnZmVjaGEnLCAnb3duZXJfdWlkJywgJ3Byb3ZpbmNpYScsICdsb2NhbGlkYWQnLCAndGllbmRhJ10sXG4gICAgICAncGVkaWRvcy5jc3YnOiBbJ2NvbmZpcm1lZF9hdCcsICdvd25lcl91aWQnLCAncHJvdmluY2UnLCAnbG9jX25hbWUnLCAnY2xpZW50X25hbWUnXSxcbiAgICB9LFxuICAgIGpvaW5Ob3RlczpcbiAgICAgICdKT0lOIHBvciAocHJvdmluY2lhLCBsb2NhbGlkYWQsIHRpZW5kYX5jbGllbnRfbmFtZSkgZW4gdmVudGFuYSB0ZW1wb3JhbCBmZWNoYV92aXNpdGEuLmNvbmZpcm1lZF9hdC4gTm8gaGF5IGNhcmRDb2RlU2FwIGNvbXVuIGVudHJlIHZpc2l0cyB5IHBlZGlkb3MuJyxcbiAgfSxcbiAgQl9jaHVybl9jbGllbnRlczoge1xuICAgIHByaW9yaXR5OiAyLFxuICAgIGRlc2NyaXB0aW9uOiAnRGV0ZWN0YXIgY2xpZW50ZXMgcXVlIHNlIGVuZnJpYW4gYW50ZXMgZGUgcGVyZGVybG9zLicsXG4gICAgcmVxdWlyZWRGaWVsZHM6IHtcbiAgICAgICdjbGllbnRlcy5jc3YnOiBbJ2NyZWF0ZWRfYXQnLCAnYXNzaWduZWRfdmVuZG9yJywgJ3Byb3ZpbmNpYScsICdzdGF0dXMnLCAnY2FyZF9jb2RlX3NhcCddLFxuICAgICAgJ3BlZGlkb3MuY3N2JzogWydjb25maXJtZWRfYXQnLCAnY2xpZW50X25hbWUnLCAncHJvdmluY2UnLCAnbG9jX25hbWUnXSxcbiAgICB9LFxuICAgIGpvaW5Ob3RlczpcbiAgICAgICdKT0lOIHZpYSBjbGllbnRfYXBwbGljYXRpb25zLmNhcmRfY29kZV9zYXAgdnMgcGVkaWRvcy5rZXkgKHBhcnNlYWRvKS4gRnJhZ2lsIC0gY29uc2lkZXJhciBmdXp6eSBtYXRjaCBwb3Igbm9tYnJlLicsXG4gIH0sXG4gIENfZm9yZWNhc3Rfc2t1OiB7XG4gICAgcHJpb3JpdHk6IDMsXG4gICAgZGVzY3JpcHRpb246ICdBbnRpY2lwYXIgcXVlIHByb2R1Y3RvcyBzZSB2YW4gYSBwZWRpciBwb3IgcGVyaW9kby4nLFxuICAgIHJlcXVpcmVkRmllbGRzOiB7XG4gICAgICAncGVkaWRvcy5jc3YnOiBbJ2xpbmVfY29kZScsICdsaW5lX3F0eScsICdsaW5lX3ByZWNpbycsICdjb25maXJtZWRfYXQnLCAncHJvdmluY2UnXSxcbiAgICAgICdwcm9kdWN0b3MuY3N2JzogWydza3UnXSxcbiAgICB9LFxuICAgIGpvaW5Ob3RlczpcbiAgICAgICdEZXNjdWVudG8gYXBsaWNhZG8gYSBuaXZlbCBoZWFkZXIgKGRpc2NvdW50X3BjdCkgLSBwcm9ycmF0ZWFyIGVuIGVsIHBpcGVsaW5lIGRvd25zdHJlYW0gcHJvcG9yY2lvbmFsIGEgc3VidG90YWxfYnJ1dG8gZGUgY2FkYSBsaW5lYS4gRW5yaXF1ZWNlciBjb24gY2F0YWxvZ28gQlEgKHNhcF9pdGVtc19yYXcpIHNpIGhhY2UgZmFsdGEgY2F0L2ZhbS9zdWIgYWRpY2lvbmFsLicsXG4gIH0sXG4gIERfYW5vbWFsaWFzX3JlbmRpY2lvbmVzOiB7XG4gICAgcHJpb3JpdHk6ICdleHBsb3JhdG9yaW8nLFxuICAgIGRlc2NyaXB0aW9uOiAnRGV0ZWN0YXIgb3V0bGllcnMgZGUgZ2FzdG9zLicsXG4gICAgcmVxdWlyZWRGaWVsZHM6IHtcbiAgICAgICdyZW5kaWNpb25lcy5jc3YnOiBbJ2ltcG9ydGVfYXJzJywgJ3RpcG9fZ2FzdG8nLCAnb3duZXJfdWlkJywgJ2ZlY2hhX2dhc3RvJywgJ3N0YXR1cyddLFxuICAgIH0sXG4gIH0sXG4gIEVfZXN0YWNpb25hbGlkYWRfem9uYV9jYXRlZ29yaWE6IHtcbiAgICBwcmlvcml0eTogJ2V4cGxvcmF0b3JpbycsXG4gICAgZGVzY3JpcHRpb246ICdJbnN1bW8gcGFyYSBhcm1hZG8gZGUgY2FtcGFuaWFzIGVzdGFjaW9uYWxlcy4nLFxuICAgIHJlcXVpcmVkRmllbGRzOiB7XG4gICAgICAncGVkaWRvcy5jc3YnOiBbJ2NvbmZpcm1lZF9hdCcsICdwcm92aW5jZScsICdsaW5lX2NvZGUnLCAnbGluZV9mYW0nLCAnbGluZV9xdHknXSxcbiAgICAgICdjbGllbnRlcy5jc3YnOiBbJ3Byb3ZpbmNpYScsICdhc3NpZ25lZF92ZW5kb3InXSxcbiAgICAgICdjYW1wYW5pYXMuY3N2JzogWydzdGFydF9kYXRlJywgJ2VuZF9kYXRlJywgJ3NrdXNfanNvbicsICdzY29wZSddLFxuICAgICAgJ3RhcmdldHMuY3N2JzogWyd5ZWFyJywgJ21vbnRoJywgJ3RhcmdldF9hcnMnXSxcbiAgICB9LFxuICB9LFxufTtcblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBSb3cgYnVpbGRlcnMgXHUyMDE0IGZ1bmNpb25lcyBwdXJhcyAoZG9jIC0+IGFycmF5IGRlIHJvd3MpXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuLyoqXG4gKiBFeHRyYWUgdmFsb3IgRmlyZXN0b3JlIGRlIGRvYyBjb24gcGF0aCBhbmlkYWRvLiBEZXZ1ZWx2ZSByYXcgKG5vIENTVikuXG4gKiBFajogZ2V0RmllbGQoZG9jLCAndHJhbnNmZXJpZG9TQVAuZG9jTnVtJylcbiAqIEBwYXJhbSB7b2JqZWN0fSBkb2NcbiAqIEBwYXJhbSB7c3RyaW5nfSBwYXRoXG4gKi9cbmZ1bmN0aW9uIGYoZG9jLCBwYXRoKSB7XG4gIHJldHVybiBnZXRQYXRoKGRvYywgcGF0aCk7XG59XG5cbi8qKlxuICogUm93IGJ1aWxkZXIgZ2VuZXJpY286IG1hcGVhIHVuIGRvYyBhIGFycmF5IGRlIHZhbG9yZXMgc2VndW4gdW4gYXJyYXkgZGUgcGF0aHMuXG4gKiBAcGFyYW0ge29iamVjdH0gZG9jXG4gKiBAcGFyYW0ge3N0cmluZ1tdfSBwYXRoc1xuICogQHJldHVybnMge3Vua25vd25bXX1cbiAqL1xuZnVuY3Rpb24gX2J1aWxkUm93KGRvYywgcGF0aHMpIHtcbiAgcmV0dXJuIHBhdGhzLm1hcCgocCkgPT4gKHAgPT09ICdfX2lkX18nID8gLyoqIEB0eXBlIHthbnl9ICovIChkb2MpLl9pZCA6IGYoZG9jLCBwKSkpO1xufVxuXG4vKipcbiAqIFBlZGlkb3M6IGZsYXR0ZW4gMSBmaWxhIHBvciBsaW5lYS4gSGVhZGVyIHBlZGlkbyByZXBsaWNhZG8gZW4gY2FkYS5cbiAqIGRvYy5faWQgZXMgZWwgSUQ7IHNlIGVzcGVyYSBxdWUgZWwgY2FsbGVyIGxvIGFncmVndWUgYW50ZXMgZGUgcGFzYXIuXG4gKiBAcGFyYW0ge2FueX0gZG9jXG4gKiBAcmV0dXJucyB7dW5rbm93bltdW119XG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBidWlsZFBlZGlkb1Jvd3MoZG9jKSB7XG4gIGNvbnN0IGhlYWRlciA9IFtcbiAgICBkb2MuX2lkLFxuICAgIGRvYy5vd25lclVpZCxcbiAgICBkb2Mub3duZXJFbWFpbCxcbiAgICBkb2MuY3JlYXRlZEJ5VWlkLFxuICAgIGRvYy5vbkJlaGFsZk9mLFxuICAgIGRvYy5rZXksXG4gICAgZG9jLnN0YWdlLFxuICAgIGRvYy50aXBvLFxuICAgIGRvYy5wcm92aW5jZSxcbiAgICBkb2MubG9jTmFtZSxcbiAgICBkb2MuY2xpZW50TmFtZSxcbiAgICBkb2MubW9udGgsXG4gICAgZG9jLm1vbnRoSWR4LFxuICAgIGRvYy55ZWFyLFxuICAgIGRvYy5jb25maXJtZWRBdCxcbiAgICBkb2MuY29uZGljaW9uUGFnbyxcbiAgICBkb2MuZm9ybWFFbnRyZWdhID8gZG9jLmZvcm1hRW50cmVnYS50aXBvIDogbnVsbCxcbiAgICBkb2MuZm9ybWFFbnRyZWdhID8gZG9jLmZvcm1hRW50cmVnYS50cmFuc3BOb21icmUgOiBudWxsLFxuICAgIGRvYy5mb3JtYUVudHJlZ2EgPyBkb2MuZm9ybWFFbnRyZWdhLnRyYW5zcERpcmVjY2lvbiA6IG51bGwsXG4gICAgZG9jLmZvcm1hRW50cmVnYSA/IGRvYy5mb3JtYUVudHJlZ2EuY2xpZW50ZURpcmVjY2lvbiA6IG51bGwsXG4gICAgZG9jLmZvcm1hRW50cmVnYSA/IGRvYy5mb3JtYUVudHJlZ2Euc3VjdXJzYWxEaXJlY2Npb24gOiBudWxsLFxuICAgIGRvYy5kaXNjb3VudFBjdCxcbiAgICBkb2Muc3VidG90YWxBcnMsXG4gICAgZG9jLm5ldEFtb3VudEFycyxcbiAgICBkb2MudHJhbnNmZXJpZG9TQVAgPyBkb2MudHJhbnNmZXJpZG9TQVAudmlhIDogbnVsbCxcbiAgICBkb2MudHJhbnNmZXJpZG9TQVAgPyBkb2MudHJhbnNmZXJpZG9TQVAuZG9jTnVtIDogbnVsbCxcbiAgICBkb2MudHJhbnNmZXJpZG9TQVAgPyBkb2MudHJhbnNmZXJpZG9TQVAuZG9jRW50cnkgOiBudWxsLFxuICAgIGRvYy50cmFuc2Zlcmlkb1NBUCA/IGRvYy50cmFuc2Zlcmlkb1NBUC5hdCA6IG51bGwsXG4gICAgZG9jLmNyZWF0ZWRBdCxcbiAgXTtcbiAgY29uc3QgbGluZXMgPSBBcnJheS5pc0FycmF5KGRvYy5saW5lcykgPyBkb2MubGluZXMgOiBbXTtcbiAgaWYgKCFsaW5lcy5sZW5ndGgpIHtcbiAgICAvLyBQZWRpZG8gc2luIGxpbmVhcyAtPiAxIGZpbGEgY29uIGxpbmVfKiB2YWNpb3NcbiAgICByZXR1cm4gW2hlYWRlci5jb25jYXQoW251bGwsIG51bGwsIG51bGwsIG51bGwsIG51bGwsIG51bGwsIG51bGwsIG51bGxdKV07XG4gIH1cbiAgcmV0dXJuIGxpbmVzLm1hcCgoLyoqIEB0eXBlIHthbnl9ICovIGwsIC8qKiBAdHlwZSB7bnVtYmVyfSAqLyBpZHgpID0+XG4gICAgaGVhZGVyLmNvbmNhdChbXG4gICAgICBpZHgsXG4gICAgICBsID8gbC5jb2RlIDogbnVsbCxcbiAgICAgIGwgPyBsLmRlc2MgOiBudWxsLFxuICAgICAgbCA/IGwucXR5IDogbnVsbCxcbiAgICAgIGwgPyBsLnByZWNpbyA6IG51bGwsXG4gICAgICBsID8gbC5jYXQgOiBudWxsLFxuICAgICAgbCA/IGwuZmFtIDogbnVsbCxcbiAgICAgIGwgPyBsLnN1YiA6IG51bGwsXG4gICAgXSlcbiAgKTtcbn1cblxuLyoqIEBwYXJhbSB7YW55fSBkb2MgQHJldHVybnMge3Vua25vd25bXVtdfSAqL1xuZXhwb3J0IGZ1bmN0aW9uIGJ1aWxkVmlzaXRhUm93cyhkb2MpIHtcbiAgcmV0dXJuIFtcbiAgICBbXG4gICAgICBkb2MuX2lkLFxuICAgICAgZG9jLm93bmVyVWlkLFxuICAgICAgZG9jLm93bmVyRW1haWwsXG4gICAgICBkb2MuZmVjaGEsXG4gICAgICBkb2MubWVzLFxuICAgICAgZG9jLmFuaW8sXG4gICAgICBkb2MudmVuZG9yLFxuICAgICAgZG9jLnByb3ZpbmNpYSxcbiAgICAgIGRvYy5sb2NhbGlkYWQsXG4gICAgICBkb2MudGllbmRhLFxuICAgICAgZG9jLnRpcG8sXG4gICAgICBkb2MubG9jYWwsXG4gICAgICBkb2MudGFtYW5vLFxuICAgICAgZG9jLmZpZGVsaWRhZCxcbiAgICAgIGRvYy5yZWxldmFuY2lhLFxuICAgICAgZG9jLnBvcCxcbiAgICAgIGRvYy5uZWNlc2lkYWRQdW50dWFsLFxuICAgICAgZG9jLnRpcG9WZW50YSxcbiAgICAgIGRvYy5wb25kZXJhY2lvbk1vc3RyYWRvLFxuICAgICAgZG9jLnBvbmRlcmFjaW9uRWNvbW1lcmNlLFxuICAgICAgZG9jLmNvbXBldGVuY2lhLFxuICAgICAgZG9jLm9wb3J0dW5pZGFkLFxuICAgICAgZG9jLm1hc1ZlbmRpZG8sXG4gICAgICBkb2MubWFzUHJlZ3VudGFuLFxuICAgICAgZG9jLmF5dWRhVGllbmRhLFxuICAgICAgZG9jLmdwc1N0YXR1cyxcbiAgICAgIGRvYy5ncHNEaXN0YW5jZU0sXG4gICAgICBkb2MuaW50ZXJhY3Rpb25UeXBlLFxuICAgICAgZG9jLmZvcm1hQ29udGFjdG8sXG4gICAgICBkb2MuY29udGFjdG9SZXN1bHRhZG8sXG4gICAgICBkb2MuY29udGFjdG9SZXN1bHRhZG9BdCxcbiAgICAgIGRvYy5jb250YWN0b1Jlc3VsdGFkb0J5LFxuICAgICAgZG9jLmNyZWF0ZWRBdCxcbiAgICBdLFxuICBdO1xufVxuXG4vKiogQHBhcmFtIHthbnl9IGRvYyBAcmV0dXJucyB7dW5rbm93bltdW119ICovXG5leHBvcnQgZnVuY3Rpb24gYnVpbGRDbGllbnRlUm93cyhkb2MpIHtcbiAgcmV0dXJuIFtcbiAgICBbXG4gICAgICBkb2MuX2lkLFxuICAgICAgZG9jLm93bmVyVWlkLFxuICAgICAgZG9jLm93bmVyRW1haWwsXG4gICAgICBkb2Mub3duZXJOYW1lLFxuICAgICAgZG9jLmNvbWVyY2lvLFxuICAgICAgZG9jLmZhbnRhc2lhLFxuICAgICAgZG9jLmN1aXQsXG4gICAgICBkb2MuY29uZGljaW9uRmlzY2FsLFxuICAgICAgZG9jLmNhbGxlLFxuICAgICAgZG9jLm51bWVybyxcbiAgICAgIGRvYy5sb2NhbGlkYWQsXG4gICAgICBkb2MucHJvdmluY2lhLFxuICAgICAgZG9jLmxvY2FsaWRhZEZpbmFsLFxuICAgICAgZG9jLmNhcmRDb2RlU2FwLFxuICAgICAgZG9jLmFzc2lnbmVkVmVuZG9yLFxuICAgICAgZG9jLnN0YXR1cyxcbiAgICAgIGRvYy5zb3VyY2UsXG4gICAgICBkb2MubWFudWFsU2FwUGVuZGluZyxcbiAgICAgIGRvYy5wcmVjYXVjaW9uLFxuICAgICAgZG9jLmNhdGVnb3JpYUNsaWVudGUsXG4gICAgICBkb2MuY2xpVGlwbyxcbiAgICAgIGRvYy5sYXQsXG4gICAgICBkb2MubG5nLFxuICAgICAgZG9jLmxhdCAhPSBudWxsICYmIGRvYy5sbmcgIT0gbnVsbCxcbiAgICAgICEhKGRvYy5jYWxsZSB8fCBkb2MuYWRkcmVzcyksXG4gICAgICBkb2Muc3VibWl0dGVkQnlQdWJsaWNGb3JtLFxuICAgICAgZG9jLmFwcHJvdmVkQXQsXG4gICAgICBkb2MuY3JlYXRlZEF0LFxuICAgICAgZG9jLnVwZGF0ZWRBdCxcbiAgICBdLFxuICBdO1xufVxuXG4vKiogQHBhcmFtIHthbnl9IGRvYyBAcmV0dXJucyB7dW5rbm93bltdW119ICovXG5leHBvcnQgZnVuY3Rpb24gYnVpbGRDbGllbnRNYXN0ZXJSb3dzKGRvYykge1xuICByZXR1cm4gW1xuICAgIFtcbiAgICAgIGRvYy5faWQsXG4gICAgICBkb2MuY2xpZW50TmFtZSxcbiAgICAgIGRvYy5wcm92aW5jaWEsXG4gICAgICBkb2MubG9jYWxpZGFkLFxuICAgICAgZG9jLnZlbmRvcixcbiAgICAgIGRvYy5hZGRyZXNzLFxuICAgICAgZG9jLnNhcENhcmRDb2RlLFxuICAgICAgZG9jLnNhcEFkZHJlc3MsXG4gICAgICBkb2Muc2FwQ2l0eSxcbiAgICAgIGRvYy5zYXBTdGF0ZSxcbiAgICAgIGRvYy5zYXBJbXBvcnRlZEF0LFxuICAgICAgZG9jLnNhcEltcG9ydGVkQnksXG4gICAgICBkb2MuY2xpZW50TmFtZU9yaWdpbmFsLFxuICAgICAgZG9jLmxvY2FsaWRhZE9yaWdpbmFsLFxuICAgICAgZG9jLm1hdGNoVHlwZSxcbiAgICAgIGRvYy5tYXRjaFNpbWlsYXJpdHksXG4gICAgICBkb2MudXBkYXRlZEF0LFxuICAgICAgZG9jLnVwZGF0ZWRCeSxcbiAgICBdLFxuICBdO1xufVxuXG4vKiogQHBhcmFtIHthbnl9IGRvYyBAcmV0dXJucyB7dW5rbm93bltdW119ICovXG5leHBvcnQgZnVuY3Rpb24gYnVpbGRSZW5kaWNpb25Sb3dzKGRvYykge1xuICByZXR1cm4gW1xuICAgIFtcbiAgICAgIGRvYy5faWQsXG4gICAgICBkb2Mub3duZXJVaWQsXG4gICAgICBkb2Mub3duZXJFbWFpbCxcbiAgICAgIGRvYy52ZW5kb3IsXG4gICAgICBkb2MudGlwbyxcbiAgICAgIGRvYy50aXBvR2FzdG8sXG4gICAgICBkb2MuaW1wb3J0ZUFycyAhPSBudWxsID8gZG9jLmltcG9ydGVBcnMgOiBkb2MuaW1wb3J0ZSxcbiAgICAgIGRvYy5mZWNoYUdhc3RvLFxuICAgICAgZG9jLmNvbmNlcHRvLFxuICAgICAgLy8gZm90b1RpY2tldFVybCAodjMwOCspIHByaW9yaWRhZDsgTlVOQ0EgZXhwb3J0YXIgYmFzZTY0IGZvdG9UaWNrZXQgbGVnYWN5XG4gICAgICBkb2MuZm90b1RpY2tldFVybCB8fCBudWxsLFxuICAgICAgZG9jLnN0YXR1cyxcbiAgICAgIGRvYy5hcHByb3ZlZEJ5LFxuICAgICAgZG9jLmFwcHJvdmVkQXQsXG4gICAgICBkb2MucmVqZWN0ZWRCeUVtYWlsLFxuICAgICAgZG9jLnJlamVjdGVkUmVhc29uLFxuICAgICAgZG9jLmFwcHJvdmVyVWlkLFxuICAgICAgZG9jLmNyZWF0ZWRBdCxcbiAgICBdLFxuICBdO1xufVxuXG4vKiogQHBhcmFtIHthbnl9IGRvYyBAcmV0dXJucyB7dW5rbm93bltdW119ICovXG5leHBvcnQgZnVuY3Rpb24gYnVpbGRDYW1wYW5pYVJvd3MoZG9jKSB7XG4gIHJldHVybiBbXG4gICAgW1xuICAgICAgZG9jLl9pZCxcbiAgICAgIGRvYy5uYW1lLFxuICAgICAgZG9jLmZhbWlsaWEsXG4gICAgICBkb2Muc3ViZmFtaWxpYSxcbiAgICAgIGRvYy5maWx0ZXJUeXBlLFxuICAgICAgZG9jLmZpbHRlclZhbHVlcyxcbiAgICAgIGRvYy5za3VzLFxuICAgICAgQXJyYXkuaXNBcnJheShkb2Muc2t1cykgPyBkb2Muc2t1cy5sZW5ndGggOiAwLFxuICAgICAgZG9jLnRhcmdldFR5cGUsXG4gICAgICBkb2MudGFyZ2V0QW1vdW50LFxuICAgICAgZG9jLnN0YXJ0RGF0ZSxcbiAgICAgIGRvYy5lbmREYXRlLFxuICAgICAgZG9jLnNjb3BlLFxuICAgICAgZG9jLnNjb3BlVmFsdWVzLFxuICAgICAgZG9jLmNyZWF0ZWRCeSxcbiAgICAgIGRvYy5jcmVhdGVkQnlFbWFpbCxcbiAgICAgIGRvYy5jcmVhdGVkQXQsXG4gICAgICBkb2MuYXJjaGl2ZWRNYW51YWxseSxcbiAgICAgIGRvYy5hcmNoaXZlZEF0LFxuICAgICAgZG9jLmFyY2hpdmVkQnksXG4gICAgXSxcbiAgXTtcbn1cblxuLyoqIEBwYXJhbSB7YW55fSBkb2MgQHJldHVybnMge3Vua25vd25bXVtdfSAqL1xuZXhwb3J0IGZ1bmN0aW9uIGJ1aWxkVGFyZ2V0Um93cyhkb2MpIHtcbiAgcmV0dXJuIFtcbiAgICBbXG4gICAgICBkb2MuX2lkLFxuICAgICAgZG9jLnNlbGxlcklkLFxuICAgICAgZG9jLnllYXIsXG4gICAgICBkb2MubW9udGgsXG4gICAgICBkb2MudGFyZ2V0QXJzLFxuICAgICAgZG9jLnRhcmdldEJ5RmFtaWx5ID8gZG9jLnRhcmdldEJ5RmFtaWx5LlJFRUwgOiBudWxsLFxuICAgICAgZG9jLnRhcmdldEJ5RmFtaWx5ID8gZG9jLnRhcmdldEJ5RmFtaWx5LkNBTkFTIDogbnVsbCxcbiAgICAgIGRvYy50YXJnZXRCeUZhbWlseSA/IGRvYy50YXJnZXRCeUZhbWlseS5MSU5FQVMgOiBudWxsLFxuICAgICAgZG9jLnVwZGF0ZWRBdCxcbiAgICAgIGRvYy51cGRhdGVkQnksXG4gICAgICBkb2MudXBkYXRlZEJ5RW1haWwsXG4gICAgXSxcbiAgXTtcbn1cblxuLyoqIEBwYXJhbSB7YW55fSBkb2MgQHJldHVybnMge3Vua25vd25bXVtdfSAqL1xuZXhwb3J0IGZ1bmN0aW9uIGJ1aWxkVmVuZG9yT3ZlcnJpZGVSb3dzKGRvYykge1xuICByZXR1cm4gW1xuICAgIFtcbiAgICAgIGRvYy5faWQsXG4gICAgICBkb2Muc2NvcGUsXG4gICAgICBkb2MucHJvdmluY2UsXG4gICAgICBkb2MubG9jYWxpdHlOYW1lLFxuICAgICAgZG9jLmNsaWVudE5hbWUsXG4gICAgICBkb2Mub3JpZ2luYWxWZW5kb3IsXG4gICAgICBkb2MubmV3VmVuZG9yLFxuICAgICAgZG9jLm5ld1R5cGUsXG4gICAgICBkb2MudXBkYXRlZEF0LFxuICAgICAgZG9jLnVwZGF0ZWRCeVVpZCxcbiAgICAgIGRvYy51cGRhdGVkQnlFbWFpbCxcbiAgICAgIGRvYy51cGRhdGVkQnlEaXNwbGF5TmFtZSxcbiAgICBdLFxuICBdO1xufVxuXG4vKiogQHBhcmFtIHthbnl9IGRvYyBAcmV0dXJucyB7dW5rbm93bltdW119ICovXG5leHBvcnQgZnVuY3Rpb24gYnVpbGRDdXN0b21Sb3V0ZVJvd3MoZG9jKSB7XG4gIGNvbnN0IGhlYWRlciA9IFtcbiAgICBkb2MuX2lkLFxuICAgIGRvYy5vd25lclVpZCxcbiAgICBkb2Mub3duZXJFbWFpbCxcbiAgICBkb2MubmFtZSxcbiAgICBkb2MucGxhbm5lZERhdGUsXG4gICAgZG9jLm5vdGVzLFxuICAgIGRvYy5jcmVhdGVkQXQsXG4gICAgZG9jLnVwZGF0ZWRBdCxcbiAgXTtcbiAgY29uc3Qgc3RvcHMgPSBBcnJheS5pc0FycmF5KGRvYy5zdG9wcykgPyBkb2Muc3RvcHMgOiBbXTtcbiAgaWYgKCFzdG9wcy5sZW5ndGgpIHtcbiAgICByZXR1cm4gW2hlYWRlci5jb25jYXQoW251bGwsIG51bGwsIG51bGwsIG51bGwsIG51bGwsIG51bGwsIG51bGwsIG51bGxdKV07XG4gIH1cbiAgcmV0dXJuIHN0b3BzLm1hcCgoLyoqIEB0eXBlIHthbnl9ICovIHMpID0+XG4gICAgaGVhZGVyLmNvbmNhdChbXG4gICAgICBzID8gcy5vcmRlciA6IG51bGwsXG4gICAgICBzID8gcy5rZXkgOiBudWxsLFxuICAgICAgcyA/IHMudGlwbyA6IG51bGwsXG4gICAgICBzID8gcy5wcm92aW5jaWEgOiBudWxsLFxuICAgICAgcyA/IHMubG9jYWxpZGFkIDogbnVsbCxcbiAgICAgIHMgPyBzLmNsaWVudE5hbWUgOiBudWxsLFxuICAgICAgcyA/IHMuaXNQcm92aXNvcmlvIDogbnVsbCxcbiAgICAgIHMgPyBzLnNhcEFsdGFJZCA6IG51bGwsXG4gICAgXSlcbiAgKTtcbn1cblxuLyoqIEBwYXJhbSB7YW55fSBkb2MgQHJldHVybnMge3Vua25vd25bXVtdfSAqL1xuZXhwb3J0IGZ1bmN0aW9uIGJ1aWxkU2VndWltaWVudG9Ob3RlUm93cyhkb2MpIHtcbiAgcmV0dXJuIFtcbiAgICBbXG4gICAgICBkb2MuX2lkLFxuICAgICAgZG9jLnZlbmRvckV4dCxcbiAgICAgIGRvYy5jbGllbnRLZXksXG4gICAgICBkb2MuY2xpZW50TmFtZSxcbiAgICAgIGRvYy5wcm92aW5jZSxcbiAgICAgIGRvYy5sb2NhbGl0eSxcbiAgICAgIGRvYy50ZXh0LFxuICAgICAgZG9jLmF1dGhvclVpZCxcbiAgICAgIGRvYy5hdXRob3JFbWFpbCxcbiAgICAgIGRvYy5hdXRob3JOYW1lLFxuICAgICAgZG9jLmF1dGhvclJvbGUsXG4gICAgICBkb2MuY3JlYXRlZEF0LFxuICAgIF0sXG4gIF07XG59XG5cbi8qKlxuICogUHJvZHVjdG9zIGRlc2RlIHN0b2NrLmpzb24gKGZvcm1hdG8gU2hpbWFubzoge3N0b2NrOiB7U0tVOiBib29sLCAuLi59LFxuICogcXVhbnRpdGllczogSlNPTiBzdHJpbmcsIHdhcmVob3VzZUJyZWFrZG93bjogSlNPTiBzdHJpbmcsIHVwZGF0ZWRBdDogLi4ufSkuXG4gKiBAcGFyYW0ge29iamVjdH0gc3RvY2tKc29uXG4gKiBAcmV0dXJucyB7dW5rbm93bltdW119XG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBidWlsZFByb2R1Y3RvUm93c0Zyb21TdG9ja0pzb24oc3RvY2tKc29uKSB7XG4gIGNvbnN0IHNqID0gLyoqIEB0eXBlIHthbnl9ICovIChzdG9ja0pzb24pIHx8IHt9O1xuICBjb25zdCBzdG9ja01hcCA9IHNqLnN0b2NrIHx8IHt9O1xuICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIG51bWJlcj59ICovXG4gIGxldCBxdWFudGl0aWVzID0ge307XG4gIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmVjb3JkPHN0cmluZywgbnVtYmVyPj59ICovXG4gIGxldCBicmVha2Rvd24gPSB7fTtcbiAgdHJ5IHtcbiAgICBxdWFudGl0aWVzID0gc2oucXVhbnRpdGllcyA/IEpTT04ucGFyc2Uoc2oucXVhbnRpdGllcykgOiBzai5xdWFudGl0aWVzX21hcCB8fCB7fTtcbiAgfSBjYXRjaCAoXykge31cbiAgdHJ5IHtcbiAgICBicmVha2Rvd24gPSBzai53YXJlaG91c2VCcmVha2Rvd25cbiAgICAgID8gSlNPTi5wYXJzZShzai53YXJlaG91c2VCcmVha2Rvd24pXG4gICAgICA6IHNqLndhcmVob3VzZUJyZWFrZG93bl9tYXAgfHwge307XG4gIH0gY2F0Y2ggKF8pIHt9XG4gIGNvbnN0IHJvd3MgPSAvKiogQHR5cGUge3Vua25vd25bXVtdfSAqLyAoW10pO1xuICBjb25zdCBzb3VyY2UgPSAnc3RvY2suanNvbiBzbmFwc2hvdCc7XG4gIGNvbnN0IHVwZGF0ZWRBdCA9IHNqLnVwZGF0ZWRBdCB8fCBzai5zbmFwc2hvdEF0IHx8IG51bGw7XG4gIGZvciAoY29uc3Qgc2t1IG9mIE9iamVjdC5rZXlzKHN0b2NrTWFwKSkge1xuICAgIGNvbnN0IGhhc19zdG9jayA9ICEhc3RvY2tNYXBbc2t1XTtcbiAgICBjb25zdCB0b3RhbCA9IE51bWJlcihxdWFudGl0aWVzW3NrdV0gfHwgMCk7XG4gICAgY29uc3Qgd2JzID0gYnJlYWtkb3duW3NrdV0gfHwge307XG4gICAgY29uc3QgdzExID0gTnVtYmVyKHdic1snMTEnXSB8fCAwKTtcbiAgICBjb25zdCB3MTIgPSBOdW1iZXIod2JzWycxMiddIHx8IDApO1xuICAgIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgbnVtYmVyPn0gKi9cbiAgICBjb25zdCBvdHJvcyA9IHt9O1xuICAgIGZvciAoY29uc3QgayBvZiBPYmplY3Qua2V5cyh3YnMpKSB7XG4gICAgICBpZiAoayAhPT0gJzExJyAmJiBrICE9PSAnMTInKSBvdHJvc1trXSA9IE51bWJlcih3YnNba10gfHwgMCk7XG4gICAgfVxuICAgIHJvd3MucHVzaChbXG4gICAgICBza3UsXG4gICAgICBoYXNfc3RvY2ssXG4gICAgICB0b3RhbCxcbiAgICAgIHcxMSxcbiAgICAgIHcxMixcbiAgICAgIE9iamVjdC5rZXlzKG90cm9zKS5sZW5ndGggPyBvdHJvcyA6IG51bGwsXG4gICAgICBzb3VyY2UsXG4gICAgICB1cGRhdGVkQXQsXG4gICAgXSk7XG4gIH1cbiAgcmV0dXJuIHJvd3M7XG59XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gRGlzcGF0Y2hlcjogbWFwYSBjb2xsZWN0aW9uIC0+IHJvdyBidWlsZGVyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCAoZG9jOiBhbnkpID0+IHVua25vd25bXVtdPn0gKi9cbmV4cG9ydCBjb25zdCBST1dfQlVJTERFUlMgPSB7XG4gIHBlZGlkb3M6IGJ1aWxkUGVkaWRvUm93cyxcbiAgdmlzaXRhczogYnVpbGRWaXNpdGFSb3dzLFxuICBjbGllbnRlczogYnVpbGRDbGllbnRlUm93cyxcbiAgY2xpZW50X21hc3RlcjogYnVpbGRDbGllbnRNYXN0ZXJSb3dzLFxuICByZW5kaWNpb25lczogYnVpbGRSZW5kaWNpb25Sb3dzLFxuICBjYW1wYW5pYXM6IGJ1aWxkQ2FtcGFuaWFSb3dzLFxuICB0YXJnZXRzOiBidWlsZFRhcmdldFJvd3MsXG4gIHZlbmRvcl9vdmVycmlkZXM6IGJ1aWxkVmVuZG9yT3ZlcnJpZGVSb3dzLFxuICBjdXN0b21fcm91dGVzOiBidWlsZEN1c3RvbVJvdXRlUm93cyxcbiAgc2VndWltaWVudG9fbm90ZXM6IGJ1aWxkU2VndWltaWVudG9Ob3RlUm93cyxcbn07XG4iLCAiLy8gQHRzLW5vY2hlY2tcbi8vIEVYUE9SVFMtQURWQU5DRUQ6IHBob3RvIFpJUHMsIGF1ZGl0IFhMU1gsIGV4ZWN1dGl2ZSBzdW1tYXJ5LCB2aXNpdHMgWExTWCxcbi8vIFBvd2VyQkkgZGF0YXNldCwgTUwgZGF0YXNldC4gRXh0cmFcdTAwRURkbyB2ZXJiYXRpbSBkZSBpbmRleC5odG1sICg0IGZyYWdtZW50b3Ncbi8vIGRpc2NvbnRpbnVvcyBzZXBhcmFkb3MgcG9yIEJhY2t1cCArIEF1ZGl0ICsgX2V4cG9ydExlZ2FjeUZ1bGwgcXVlIHF1ZWRhblxuLy8gZW4gZWwgaW5saW5lKSBjb21vIHBhcnRlIGRlIEUyLm4uMiAoZTJiLXBlcmYgMjAyNi0wNy0yOCkuXG4vL1xuLy8gdjM3MSs6IGV4cG9ydERhdGFzZXRaaXAoKSBudWV2byBcdTIwMTQgWklQIGNvbiBDU1ZzIHBvciBlbnRpZGFkIHBhcmEgcGlwZWxpbmVzXG4vLyBNTCBleHRlcm5vcyAoTWljcm9zb2Z0IEZhYnJpYykuIEltcG9ydGEgbG9zIGhlbHBlcnMgcHVyb3MgeSBzY2hlbWFzIGRlbFxuLy8gbW9kdWxvIHNyYy9wdXJlL2Nzdi1zZXJpYWxpemVyLmpzLiBWZXIgcGxhbiBjb3NtaWMtcG9uZGVyaW5nLXN0ZWFybnMubWQuXG5cbmltcG9ydCB7XG4gIGJ1aWxkQ3N2LFxuICBidWlsZFByb2R1Y3RvUm93c0Zyb21TdG9ja0pzb24sXG4gIGNvbXB1dGVOdWxsUmF0ZXMsXG4gIERBVEFTRVRfU0NIRU1BUyxcbiAgREFUQVNFVF9VU0VfQ0FTRV9NQVRSSVgsXG4gIFJPV19CVUlMREVSUyxcbn0gZnJvbSAnLi4vcHVyZS9jc3Ytc2VyaWFsaXplci5qcyc7XG5cbi8vXG4vLyBEZXBzIGRlbCBpbmxpbmU6IEpTWmlwIChDRE4gbGF6eSksIEV4Y2VsSlMgKENETiBsYXp5IHZpYSBsb2FkRXhjZWxKUyksXG4vLyBYTFNYIChkZWZlciBlbiBoZWFkKSwgdmlzaXRzQ2FjaGUsIGNhbXBhaWduc0NhY2hlLCBvcHNMb2dDYWNoZSAoYXVkaXRcbi8vIGlubGluZSksIGF1ZGl0TG9nQ2FjaGUgKGF1ZGl0IGlubGluZSksIGNvbnRhY3RlZCAoZ2xvYmFsIFNldCksIFBPSU5UUyxcbi8vIFBST0RVQ1RTLCBWRU5ET1JTLCBNRVNFUywgdmVuZG9yTG9va3VwLCBlc2NhcGVIdG1sLCBlc2NhcGVBdHRyLCB0aXRsZUNhc2UsXG4vLyBzaG93U3luY1RhZywgY3VycmVudFVzZXIsIHVzZXJSb2xlLCBvcmRlcnMsIGNvbmZpcm1lZCwgcGVuZGluZy5cbi8vXG4vLyBDcm9zcy1zY29wZSBzdGF0ZTogTk9ORSAodG9kb3MgbG9zIGhlbHBlcnMgeSBjb25zdHMgbG9jYWxlcyBhbCBibG9xdWUpLlxuLy8gU2luIGxpc3RlbmVycyBvblNuYXBzaG90LlxuLy9cbi8vIE5PVEE6IGxvcyBoZWxwZXJzIHRvZGF5U3RyL2RhdGFVcmxUb0Jsb2Ivc2FuaXRpemVGb3JQYXRoIHZpdmVuIGVuIGVzdGVcbi8vIG1cdTAwRjNkdWxvIFx1MjAxNCBlbCBpbmxpbmUgcHVlZGUgbGxhbWFybG9zIHZpYSBmcmVlIHJlZmVyZW5jZSBhbCBHbG9iYWwgRW52aXJvbm1lbnRcbi8vIFJlY29yZCBwZXJvIHByZWZlcmltb3MgZXhwb3NpY2lcdTAwRjNuIHdpbmRvdy4qIGV4cGxcdTAwRURjaXRhIGFsIGZpbmFsLlxuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gU0VDQ0lcdTAwRDNOOiBoZWxwZXJzICsgcGhvdG9zIHppcCArIHZpc2l0cyBlbWJlZGRlZCAoaW5saW5lIEw5MjU2LTk0NDUpXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuZnVuY3Rpb24gdG9kYXlTdHIoKSB7XG4gIHJldHVybiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwgMTApO1xufVxuXG4vLyBIZWxwZXI6IGNvbnZlcnRpciBkYXRhVVJMIGJhc2U2NCBhIEJsb2IgcGFyYSBpbmNsdWlyIGVuIFpJUFxuZnVuY3Rpb24gZGF0YVVybFRvQmxvYihkYXRhVXJsKSB7XG4gIGlmICghZGF0YVVybCkgcmV0dXJuIG51bGw7XG4gIGNvbnN0IHBhcnRzID0gZGF0YVVybC5zcGxpdCgnLCcpO1xuICBpZiAocGFydHMubGVuZ3RoIDwgMikgcmV0dXJuIG51bGw7XG4gIGNvbnN0IG1pbWVNYXRjaCA9IHBhcnRzWzBdLm1hdGNoKC86KC4qPyk7Lyk7XG4gIGNvbnN0IG1pbWUgPSBtaW1lTWF0Y2ggPyBtaW1lTWF0Y2hbMV0gOiAnaW1hZ2UvanBlZyc7XG4gIGNvbnN0IGJ5dGVzID0gYXRvYihwYXJ0c1sxXSk7XG4gIGNvbnN0IGFyciA9IG5ldyBVaW50OEFycmF5KGJ5dGVzLmxlbmd0aCk7XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgYnl0ZXMubGVuZ3RoOyBpKyspIGFycltpXSA9IGJ5dGVzLmNoYXJDb2RlQXQoaSk7XG4gIHJldHVybiBuZXcgQmxvYihbYXJyXSwgeyB0eXBlOiBtaW1lIH0pO1xufVxuXG4vLyBTYW5lYXIgbm9tYnJlcyBwYXJhIHF1ZSBzaXJ2YW4gY29tbyBydXRhIGRlIGFyY2hpdm9cbmZ1bmN0aW9uIHNhbml0aXplRm9yUGF0aChzKSB7XG4gIHJldHVybiBTdHJpbmcocyB8fCAnJylcbiAgICAucmVwbGFjZSgvW1xcXFwvKj9bXFxdOnxcIjw+XS9nLCAnXycpXG4gICAgLnJlcGxhY2UoL1xccysvZywgJyAnKVxuICAgIC50cmltKClcbiAgICAuc2xpY2UoMCwgNjApO1xufVxuXG4vLyBEZXNjYXJnYXIgdG9kYXMgbGFzIGZvdG9zIGRlIHZpc2l0YXMgZW4gdW4gWklQIG9yZ2FuaXphZG8gcG9yIHZlbmRlZG9yIC8gdGllbmRhIC8gZmVjaGFcbndpbmRvdy5leHBvcnRQaG90b3NaaXAgPSBhc3luYyBmdW5jdGlvbiAoKSB7XG4gIC8vIHY2NzkgUEVSRiBGYXNlIDM6IEpTWmlwIGxhenkgb24tZGVtYW5kXG4gIHRyeSB7XG4gICAgYXdhaXQgd2luZG93LmxvYWRKU1ppcCgpO1xuICB9IGNhdGNoIChlKSB7XG4gICAgYWxlcnQoJ05vIHNlIHB1ZG8gY2FyZ2FyIEpTWmlwOiAnICsgZS5tZXNzYWdlKTtcbiAgICByZXR1cm47XG4gIH1cbiAgaWYgKCF2aXNpdHNDYWNoZSB8fCAhdmlzaXRzQ2FjaGUubGVuZ3RoKSB7XG4gICAgYWxlcnQoJ05vIGhheSB2aXNpdGFzIHJlZ2lzdHJhZGFzLicpO1xuICAgIHJldHVybjtcbiAgfVxuICBsZXQgcGhvdG9Db3VudCA9IDA7XG4gIGNvbnN0IHppcCA9IG5ldyBKU1ppcCgpO1xuICB2aXNpdHNDYWNoZS5mb3JFYWNoKCh2KSA9PiB7XG4gICAgY29uc3QgdmVuZG9yID0gc2FuaXRpemVGb3JQYXRoKHRpdGxlQ2FzZSh2LnZlbmRvciB8fCAnU0lOX1ZFTkRFRE9SJykpO1xuICAgIGNvbnN0IHRpZW5kYSA9IHNhbml0aXplRm9yUGF0aCh2LnRpZW5kYSB8fCAnc2luX3RpZW5kYScpO1xuICAgIGNvbnN0IGZlY2hhID0gKHYuZmVjaGEgfHwgJycpLnJlcGxhY2UoLy0vZywgJycpO1xuICAgIGNvbnN0IGZvbGRlck5hbWUgPSB2ZW5kb3IgKyAnLycgKyB0aWVuZGEgKyAnXycgKyBmZWNoYTtcbiAgICBjb25zdCBmb2xkZXIgPSB6aXAuZm9sZGVyKGZvbGRlck5hbWUpO1xuICAgIGlmICh2LmZyZW50ZUxvY2FsKSB7XG4gICAgICBjb25zdCBiID0gZGF0YVVybFRvQmxvYih2LmZyZW50ZUxvY2FsKTtcbiAgICAgIGlmIChiKSB7XG4gICAgICAgIGZvbGRlci5maWxlKCdmcmVudGUuanBnJywgYik7XG4gICAgICAgIHBob3RvQ291bnQrKztcbiAgICAgIH1cbiAgICB9XG4gICAgKHYuZXNwYWNpbyB8fCBbXSkuZm9yRWFjaCgoYjY0LCBpKSA9PiB7XG4gICAgICBjb25zdCBiID0gZGF0YVVybFRvQmxvYihiNjQpO1xuICAgICAgaWYgKGIpIHtcbiAgICAgICAgZm9sZGVyLmZpbGUoJ2VzcGFjaW9fJyArIChpICsgMSkgKyAnLmpwZycsIGIpO1xuICAgICAgICBwaG90b0NvdW50Kys7XG4gICAgICB9XG4gICAgfSk7XG4gIH0pO1xuICBpZiAoIXBob3RvQ291bnQpIHtcbiAgICBhbGVydCgnTm8gaGF5IGZvdG9zIGNhcmdhZGFzIGVuIGxhcyB2aXNpdGFzLicpO1xuICAgIHJldHVybjtcbiAgfVxuICBzaG93U3luY1RhZygnR2VuZXJhbmRvIFpJUCBkZSAnICsgcGhvdG9Db3VudCArICcgZm90b3MuLi4nLCAzMDAwMCk7XG4gIHRyeSB7XG4gICAgY29uc3QgYmxvYiA9IGF3YWl0IHppcC5nZW5lcmF0ZUFzeW5jKHsgdHlwZTogJ2Jsb2InLCBjb21wcmVzc2lvbjogJ0RFRkxBVEUnIH0pO1xuICAgIGNvbnN0IHVybCA9IFVSTC5jcmVhdGVPYmplY3RVUkwoYmxvYik7XG4gICAgY29uc3QgYSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2EnKTtcbiAgICBhLmhyZWYgPSB1cmw7XG4gICAgYS5kb3dubG9hZCA9ICdTaGltYW5vX0ZvdG9zX1Zpc2l0YXNfJyArIHRvZGF5U3RyKCkgKyAnLnppcCc7XG4gICAgYS5jbGljaygpO1xuICAgIHNldFRpbWVvdXQoKCkgPT4gVVJMLnJldm9rZU9iamVjdFVSTCh1cmwpLCA1MDAwKTtcbiAgICBzaG93U3luY1RhZyhwaG90b0NvdW50ICsgJyBmb3RvcyBkZXNjYXJnYWRhcycsIDMwMDApO1xuICB9IGNhdGNoIChlKSB7XG4gICAgY29uc29sZS5lcnJvcignemlwJywgZSk7XG4gICAgYWxlcnQoJ0Vycm9yIGdlbmVyYW5kbyBaSVA6ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcbiAgfVxufTtcblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBFeGNlbCBjb24gZm90b3MgZGVsIGZyZW50ZSBlbWJlYmlkYXMgZW4gY2FkYSBjZWxkYSAoRXhjZWxKUylcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gRXhjZWxKUyBzZSBjYXJnYSBsYXp5IChzb2xvIGN1YW5kbyBzZSB0b2NhIGVsIGJvdG9uKSBwYXJhIG5vIGluZmxhciBlbCBidW5kbGUuXG5mdW5jdGlvbiBsb2FkRXhjZWxKUygpIHtcbiAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICBpZiAodHlwZW9mIEV4Y2VsSlMgIT09ICd1bmRlZmluZWQnKSByZXR1cm4gcmVzb2x2ZSgpO1xuICAgIGNvbnN0IHMgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdzY3JpcHQnKTtcbiAgICBzLnNyYyA9ICdodHRwczovL2Nkbi5qc2RlbGl2ci5uZXQvbnBtL2V4Y2VsanNANC40LjAvZGlzdC9leGNlbGpzLm1pbi5qcyc7XG4gICAgcy5vbmxvYWQgPSAoKSA9PiByZXNvbHZlKCk7XG4gICAgcy5vbmVycm9yID0gKCkgPT5cbiAgICAgIHJlamVjdChuZXcgRXJyb3IoJ05vIHNlIHB1ZG8gY2FyZ2FyIGxhIGxpYnJlcmlhIEV4Y2VsSlMuIFJldmlzYSB0dSBjb25leGlvbiBhIGludGVybmV0LicpKTtcbiAgICBkb2N1bWVudC5oZWFkLmFwcGVuZENoaWxkKHMpO1xuICB9KTtcbn1cblxud2luZG93LmV4cG9ydFZpc2l0c1dpdGhFbWJlZGRlZFBob3RvcyA9IGFzeW5jIGZ1bmN0aW9uICgpIHtcbiAgaWYgKCF2aXNpdHNDYWNoZSB8fCAhdmlzaXRzQ2FjaGUubGVuZ3RoKSB7XG4gICAgYWxlcnQoJ05vIGhheSB2aXNpdGFzIHJlZ2lzdHJhZGFzLicpO1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCBuID0gdmlzaXRzQ2FjaGUubGVuZ3RoO1xuICBpZiAobiA+IDMwMCkge1xuICAgIGlmIChcbiAgICAgICFjb25maXJtKFxuICAgICAgICAnSGF5ICcgK1xuICAgICAgICAgIG4gK1xuICAgICAgICAgICcgdmlzaXRhcy4gRWwgRXhjZWwgY29uIHRvZGFzIGxhcyBmb3RvcyBlbWJlYmlkYXMgcHVlZGUgcGVzYXIgNTAtMTUwIE1CIHkgdGFyZGFyIHZhcmlvcyBtaW51dG9zLiBcdTAwQkZDb250aW51YXI/J1xuICAgICAgKVxuICAgIClcbiAgICAgIHJldHVybjtcbiAgfSBlbHNlIGlmIChuID4gMTAwKSB7XG4gICAgaWYgKFxuICAgICAgIWNvbmZpcm0oXG4gICAgICAgICdWYXMgYSBnZW5lcmFyIHVuIEV4Y2VsIGNvbiAnICtcbiAgICAgICAgICBuICtcbiAgICAgICAgICAnIHZpc2l0YXMgeSBzdXMgZm90b3MgZW1iZWJpZGFzLiBQdWVkZSB0YXJkYXIgMzAtNjAgc2VndW5kb3MuIFx1MDBCRkNvbnRpbnVhcj8nXG4gICAgICApXG4gICAgKVxuICAgICAgcmV0dXJuO1xuICB9XG4gIHNob3dTeW5jVGFnKCdDYXJnYW5kbyBFeGNlbEpTLi4uJywgMjAwMCk7XG4gIHRyeSB7XG4gICAgYXdhaXQgbG9hZEV4Y2VsSlMoKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGFsZXJ0KGUubWVzc2FnZSB8fCBlKTtcbiAgICByZXR1cm47XG4gIH1cblxuICBzaG93U3luY1RhZygnR2VuZXJhbmRvIEV4Y2VsIGNvbiAnICsgbiArICcgdmlzaXRhcy4uLicsIDMwMDApO1xuXG4gIGNvbnN0IHdiID0gbmV3IEV4Y2VsSlMuV29ya2Jvb2soKTtcbiAgd2IuY3JlYXRvciA9ICdBcHAgVmVuZGVkb3JlcyBTaGltYW5vJztcbiAgd2IuY3JlYXRlZCA9IG5ldyBEYXRlKCk7XG4gIGNvbnN0IHdzID0gd2IuYWRkV29ya3NoZWV0KCdWaXNpdGFzJywgeyB2aWV3czogW3sgc3RhdGU6ICdmcm96ZW4nLCB5U3BsaXQ6IDEgfV0gfSk7XG5cbiAgLy8gRGVmaW5pY2lvbiBkZSBjb2x1bW5hcy4gTGEgY29sdW1uYSBkZSBmb3RvIHZhIGEgdGVuZXIgYW5jaG8gZXh0cmEgcGFyYSBxdWUgc2UgdmVhLlxuICB3cy5jb2x1bW5zID0gW1xuICAgIHsgaGVhZGVyOiAnRmVjaGEnLCBrZXk6ICdmZWNoYScsIHdpZHRoOiAxMiB9LFxuICAgIHsgaGVhZGVyOiAnTWVzJywga2V5OiAnbWVzJywgd2lkdGg6IDEwIH0sXG4gICAgeyBoZWFkZXI6ICdWZW5kZWRvcicsIGtleTogJ3ZlbmRlZG9yJywgd2lkdGg6IDIyIH0sXG4gICAgeyBoZWFkZXI6ICdUaXBvIGNvbnRhY3RvJywga2V5OiAndGlwb0N0Jywgd2lkdGg6IDEyIH0sXG4gICAgeyBoZWFkZXI6ICdDb21lbnRhcmlvJywga2V5OiAnY29tZW50Jywgd2lkdGg6IDMyIH0sXG4gICAgeyBoZWFkZXI6ICdQcm92aW5jaWEnLCBrZXk6ICdwcm92aW5jaWEnLCB3aWR0aDogMTYgfSxcbiAgICB7IGhlYWRlcjogJ0xvY2FsaWRhZCcsIGtleTogJ2xvY2FsaWRhZCcsIHdpZHRoOiAxOCB9LFxuICAgIHsgaGVhZGVyOiAnVGllbmRhJywga2V5OiAndGllbmRhJywgd2lkdGg6IDMwIH0sXG4gICAgeyBoZWFkZXI6ICdUaXBvJywga2V5OiAndGlwbycsIHdpZHRoOiAxMiB9LFxuICAgIHsgaGVhZGVyOiAnTG9jYWwnLCBrZXk6ICdsb2NhbCcsIHdpZHRoOiAxMiB9LFxuICAgIHsgaGVhZGVyOiAnVGFtYW5vJywga2V5OiAndGFtYW5vJywgd2lkdGg6IDEwIH0sXG4gICAgeyBoZWFkZXI6ICdGaWRlbGlkYWQnLCBrZXk6ICdmaWRlbGlkYWQnLCB3aWR0aDogMTAgfSxcbiAgICB7IGhlYWRlcjogJ1JlbGV2YW5jaWEnLCBrZXk6ICdyZWxldicsIHdpZHRoOiAxMCB9LFxuICAgIHsgaGVhZGVyOiAnUE9QJywga2V5OiAncG9wJywgd2lkdGg6IDggfSxcbiAgICB7IGhlYWRlcjogJ1RpcG8gdmVudGEnLCBrZXk6ICd0aXBvVmVudGEnLCB3aWR0aDogMTIgfSxcbiAgICB7IGhlYWRlcjogJ0NvbXBldGVuY2lhJywga2V5OiAnY29tcGUnLCB3aWR0aDogMTYgfSxcbiAgICB7IGhlYWRlcjogJ09wb3J0dW5pZGFkJywga2V5OiAnb3BvcnR1Jywgd2lkdGg6IDMwIH0sXG4gICAgeyBoZWFkZXI6ICdMbyBtYXMgdmVuZGlkbycsIGtleTogJ21hc1ZlJywgd2lkdGg6IDI4IH0sXG4gICAgeyBoZWFkZXI6ICdHUFMgZGlzdCAobSknLCBrZXk6ICdncHNEaXN0Jywgd2lkdGg6IDEyIH0sXG4gICAgeyBoZWFkZXI6ICdGb3RvIGZyZW50ZScsIGtleTogJ2ZvdG8nLCB3aWR0aDogMjIgfSwgLy8gPC0gbGEgaW1hZ2VuIHZhIGFjYVxuICAgIHsgaGVhZGVyOiAnRW1haWwgdmVuZGVkb3InLCBrZXk6ICdlbWFpbCcsIHdpZHRoOiAyOCB9LFxuICBdO1xuXG4gIC8vIEVzdGlsbyBoZWFkZXJcbiAgd3MuZ2V0Um93KDEpLmZvbnQgPSB7IGJvbGQ6IHRydWUsIGNvbG9yOiB7IGFyZ2I6ICdGRkZGRkZGRicgfSB9O1xuICB3cy5nZXRSb3coMSkuZmlsbCA9IHsgdHlwZTogJ3BhdHRlcm4nLCBwYXR0ZXJuOiAnc29saWQnLCBmZ0NvbG9yOiB7IGFyZ2I6ICdGRjBDNEE2RScgfSB9O1xuICB3cy5nZXRSb3coMSkuYWxpZ25tZW50ID0geyB2ZXJ0aWNhbDogJ21pZGRsZScsIGhvcml6b250YWw6ICdjZW50ZXInIH07XG4gIHdzLmdldFJvdygxKS5oZWlnaHQgPSAyMjtcblxuICBjb25zdCBGT1RPX0NPTF9JRFggPSB3cy5nZXRDb2x1bW4oJ2ZvdG8nKS5udW1iZXIgLSAxOyAvLyAwLWluZGV4ZWQgcGFyYSBhZGRJbWFnZVxuICBjb25zdCBST1dfSCA9IDEwMDtcbiAgY29uc3QgSU1HX1cgPSAxMzA7XG4gIGNvbnN0IElNR19IID0gOTA7XG5cbiAgLy8gT3JkZW5hciB2aXNpdGFzIHBvciBmZWNoYSBkZXNjIChtYXMgcmVjaWVudGVzIHByaW1lcm8pXG4gIGNvbnN0IHNvcnRlZCA9IHZpc2l0c0NhY2hlLnNsaWNlKCkuc29ydCgoYSwgYikgPT4gKGIuZmVjaGEgfHwgJycpLmxvY2FsZUNvbXBhcmUoYS5mZWNoYSB8fCAnJykpO1xuXG4gIGZvciAoY29uc3QgdiBvZiBzb3J0ZWQpIHtcbiAgICBjb25zdCB0aXBvQ29udGFjdG9MYmwgPSB2LnRpcG9Db250YWN0byA9PT0gJ3RlbGVmb25vJyA/ICdUZWxlZm9ubycgOiAnUHJlc2VuY2lhbCc7XG4gICAgY29uc3QgciA9IHdzLmFkZFJvdyh7XG4gICAgICBmZWNoYTogdi5mZWNoYSB8fCAnJyxcbiAgICAgIG1lczogdi5tZXMgfHwgJycsXG4gICAgICB2ZW5kZWRvcjogdGl0bGVDYXNlKHYudmVuZG9yIHx8ICcnKSxcbiAgICAgIHRpcG9DdDogdGlwb0NvbnRhY3RvTGJsLFxuICAgICAgY29tZW50OiB2LmNvbWVudGFyaW8gfHwgJycsXG4gICAgICBwcm92aW5jaWE6IHRpdGxlQ2FzZSh2LnByb3ZpbmNpYSB8fCAnJyksXG4gICAgICBsb2NhbGlkYWQ6IHYubG9jYWxpZGFkIHx8ICcnLFxuICAgICAgdGllbmRhOiB2LnRpZW5kYSB8fCAnJyxcbiAgICAgIHRpcG86IHYudGlwbyB8fCAnJyxcbiAgICAgIGxvY2FsOiB2LmxvY2FsIHx8ICcnLFxuICAgICAgdGFtYW5vOiB2LnRhbWFubyB8fCAnJyxcbiAgICAgIGZpZGVsaWRhZDogdi5maWRlbGlkYWQgfHwgJycsXG4gICAgICByZWxldjogdi5yZWxldmFuY2lhIHx8ICcnLFxuICAgICAgcG9wOiB2LnBvcCB8fCAnJyxcbiAgICAgIHRpcG9WZW50YTogdi50aXBvVmVudGEgPT09ICdNT1NUUkFETycgPyAnTU9TVFJBRE9SJyA6IHYudGlwb1ZlbnRhIHx8ICcnLFxuICAgICAgY29tcGU6IHYuY29tcGV0ZW5jaWEgfHwgJycsXG4gICAgICBvcG9ydHU6IHYub3BvcnR1bmlkYWQgfHwgJycsXG4gICAgICBtYXNWZTogdi5tYXNWZW5kaWRvIHx8ICcnLFxuICAgICAgZ3BzRGlzdDogdHlwZW9mIHYuZ3BzRGlzdGFuY2VNID09PSAnbnVtYmVyJyA/IHYuZ3BzRGlzdGFuY2VNIDogJycsXG4gICAgICBmb3RvOiAnJywgLy8gbGEgY2VsZGEgcXVlZGEgdmFjaWE7IGVuY2ltYSB2YSBsYSBpbWFnZW5cbiAgICAgIGVtYWlsOiB2Lm93bmVyRW1haWwgfHwgJycsXG4gICAgfSk7XG4gICAgci5oZWlnaHQgPSBST1dfSDtcbiAgICByLmFsaWdubWVudCA9IHsgdmVydGljYWw6ICdtaWRkbGUnLCB3cmFwVGV4dDogdHJ1ZSB9O1xuICAgIGlmICh2LmZyZW50ZUxvY2FsICYmIHR5cGVvZiB2LmZyZW50ZUxvY2FsID09PSAnc3RyaW5nJykge1xuICAgICAgdHJ5IHtcbiAgICAgICAgLy8gRWwgY2FtcG8gZXMgdW4gZGF0YVVSTDogJ2RhdGE6aW1hZ2UvanBlZztiYXNlNjQsLzlqLzRBQVEuLi4nXG4gICAgICAgIGxldCBiNjQgPSB2LmZyZW50ZUxvY2FsO1xuICAgICAgICBsZXQgZXh0ID0gJ2pwZWcnO1xuICAgICAgICBjb25zdCBtID0gL15kYXRhOmltYWdlXFwvKFxcdyspO2Jhc2U2NCwoLispJC9pLmV4ZWMoYjY0KTtcbiAgICAgICAgaWYgKG0pIHtcbiAgICAgICAgICBleHQgPSBtWzFdLnRvTG93ZXJDYXNlKCk7XG4gICAgICAgICAgYjY0ID0gbVsyXTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoZXh0ID09PSAnanBnJykgZXh0ID0gJ2pwZWcnO1xuICAgICAgICBjb25zdCBpbWFnZUlkID0gd2IuYWRkSW1hZ2UoeyBiYXNlNjQ6IGI2NCwgZXh0ZW5zaW9uOiBleHQgfSk7XG4gICAgICAgIHdzLmFkZEltYWdlKGltYWdlSWQsIHtcbiAgICAgICAgICB0bDogeyBjb2w6IEZPVE9fQ09MX0lEWCArIDAuMSwgcm93OiByLm51bWJlciAtIDEgKyAwLjEgfSxcbiAgICAgICAgICBleHQ6IHsgd2lkdGg6IElNR19XLCBoZWlnaHQ6IElNR19IIH0sXG4gICAgICAgICAgZWRpdEFzOiAnb25lQ2VsbCcsXG4gICAgICAgIH0pO1xuICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICBjb25zb2xlLndhcm4oJ2VtYmViaWVuZG8gZm90byBmaWxhJywgci5udW1iZXIsIGUpO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8vIEdlbmVyYXIgeSBkZXNjYXJnYXJcbiAgdHJ5IHtcbiAgICBjb25zdCBidWZmZXIgPSBhd2FpdCB3Yi54bHN4LndyaXRlQnVmZmVyKCk7XG4gICAgY29uc3QgYmxvYiA9IG5ldyBCbG9iKFtidWZmZXJdLCB7XG4gICAgICB0eXBlOiAnYXBwbGljYXRpb24vdm5kLm9wZW54bWxmb3JtYXRzLW9mZmljZWRvY3VtZW50LnNwcmVhZHNoZWV0bWwuc2hlZXQnLFxuICAgIH0pO1xuICAgIGNvbnN0IHVybCA9IFVSTC5jcmVhdGVPYmplY3RVUkwoYmxvYik7XG4gICAgY29uc3QgYSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2EnKTtcbiAgICBhLmhyZWYgPSB1cmw7XG4gICAgYS5kb3dubG9hZCA9ICdTaGltYW5vX1Zpc2l0YXNfY29uX2ZvdG9zXycgKyB0b2RheVN0cigpICsgJy54bHN4JztcbiAgICBkb2N1bWVudC5ib2R5LmFwcGVuZENoaWxkKGEpO1xuICAgIGEuY2xpY2soKTtcbiAgICBkb2N1bWVudC5ib2R5LnJlbW92ZUNoaWxkKGEpO1xuICAgIHNldFRpbWVvdXQoKCkgPT4gVVJMLnJldm9rZU9iamVjdFVSTCh1cmwpLCA1MDAwKTtcbiAgICBzaG93U3luY1RhZygnRXhjZWwgZGVzY2FyZ2FkbzogJyArIHNvcnRlZC5sZW5ndGggKyAnIHZpc2l0YXMnLCAzMDAwKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGNvbnNvbGUuZXJyb3IoJ2V4cG9ydFZpc2l0c1dpdGhFbWJlZGRlZFBob3RvcycsIGUpO1xuICAgIGFsZXJ0KCdFcnJvciBnZW5lcmFuZG8gZWwgRXhjZWw6ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcbiAgfVxufTtcblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIFNFQ0NJXHUwMEQzTjogZXhwb3J0QXVkaXRFeGNlbCAoaW5saW5lIEwxMDA0MC0xMDA2Nylcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG53aW5kb3cuZXhwb3J0QXVkaXRFeGNlbCA9IGZ1bmN0aW9uICgpIHtcbiAgaWYgKHR5cGVvZiBYTFNYID09PSAndW5kZWZpbmVkJykge1xuICAgIGFsZXJ0KCdMYSBsaWJyZXJpYSBkZSBFeGNlbCBubyBzZSBjYXJnby4nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgY29uc3QgaXRlbXMgPSBnZXRGaWx0ZXJlZEF1ZGl0RW50cmllcygpO1xuICBpZiAoIWl0ZW1zLmxlbmd0aCkge1xuICAgIGFsZXJ0KCdObyBoYXkgZXZlbnRvcyBwYXJhIGV4cG9ydGFyIGNvbiBsb3MgZmlsdHJvcyBhcGxpY2Fkb3MuJyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGNvbnN0IHJvd3MgPSBpdGVtcy5tYXAoKGUpID0+IHtcbiAgICBjb25zdCB0cyA9IGUudGltZXN0YW1wICYmIGUudGltZXN0YW1wLnRvRGF0ZSA/IGUudGltZXN0YW1wLnRvRGF0ZSgpIDogbnVsbDtcbiAgICByZXR1cm4ge1xuICAgICAgRmVjaGFfSG9yYTogdHMgPyB0cy50b0lTT1N0cmluZygpLnJlcGxhY2UoJ1QnLCAnICcpLnNsaWNlKDAsIDE5KSA6ICcnLFxuICAgICAgVXN1YXJpb19FbWFpbDogZS51c2VyRW1haWwgfHwgJycsXG4gICAgICBVc3VhcmlvX1VJRDogZS51c2VyVWlkIHx8ICcnLFxuICAgICAgUm9sOiBlLnVzZXJSb2xlIHx8ICcnLFxuICAgICAgQWNjaW9uOiBBVURJVF9BQ1RJT05fTEFCRUxTW2UuYWN0aW9uXSB8fCBlLmFjdGlvbiB8fCAnJyxcbiAgICAgIEFjY2lvbl9SYXc6IGUuYWN0aW9uIHx8ICcnLFxuICAgICAgVGlwb19FbnRpZGFkOiBlLmVudGl0eVR5cGUgfHwgJycsXG4gICAgICBFbnRpZGFkOiBlLmVudGl0eU5hbWUgfHwgJycsXG4gICAgICBEZXRhbGxlc19KU09OOiBlLmRldGFpbHMgPyBKU09OLnN0cmluZ2lmeShlLmRldGFpbHMpIDogJycsXG4gICAgfTtcbiAgfSk7XG4gIGNvbnN0IHdiID0gWExTWC51dGlscy5ib29rX25ldygpO1xuICBjb25zdCB3cyA9IFhMU1gudXRpbHMuanNvbl90b19zaGVldChyb3dzKTtcbiAgd3NbJyFjb2xzJ10gPSBbXG4gICAgeyB3Y2g6IDIwIH0sXG4gICAgeyB3Y2g6IDMwIH0sXG4gICAgeyB3Y2g6IDMwIH0sXG4gICAgeyB3Y2g6IDEwIH0sXG4gICAgeyB3Y2g6IDI0IH0sXG4gICAgeyB3Y2g6IDIwIH0sXG4gICAgeyB3Y2g6IDE0IH0sXG4gICAgeyB3Y2g6IDQwIH0sXG4gICAgeyB3Y2g6IDYwIH0sXG4gIF07XG4gIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQod2IsIHdzLCAnQXVkaXRvcmlhJyk7XG4gIGNvbnN0IHN0YW1wID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpLnNsaWNlKDAsIDEwKTtcbiAgWExTWC53cml0ZUZpbGUod2IsICdTaGltYW5vX0F1ZGl0b3JpYV8nICsgc3RhbXAgKyAnLnhsc3gnKTtcbn07XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBTRUNDSVx1MDBEM046IGJ1aWxkQ29udGFjdGFkb3NSb3dzL09wc0xvZy9WaXNpdCAoaW5saW5lIEwxMDA4MS0xMDE1NSlcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4vLyBMaXN0YSBjb21wbGV0YSBkZSBjb250YWN0YWRvcyAoY2xpZW50ZXMvcHJvc3BlY3RvcyBtYXJjYWRvcyBjb24gY2hlY2spXG5mdW5jdGlvbiBidWlsZENvbnRhY3RhZG9zUm93cygpIHtcbiAgY29uc3Qgcm93cyA9IFtdO1xuICBjb250YWN0ZWQuZm9yRWFjaCgoa2V5KSA9PiB7XG4gICAgY29uc3QgcGFydHMgPSBrZXkuc3BsaXQoJ3wnKTtcbiAgICBjb25zdCB0aXBvID0gcGFydHNbMF0sXG4gICAgICBwcm92aW5jZSA9IHBhcnRzWzFdLFxuICAgICAgbG9jTmFtZSA9IHBhcnRzWzJdLFxuICAgICAgY2xpZW50TmFtZSA9IHBhcnRzWzNdO1xuICAgIGNvbnN0IHB0ID0gUE9JTlRTLmZpbmQoKHApID0+IHAucHJvdmluY2UgPT09IHByb3ZpbmNlICYmIHAubmFtZSA9PT0gbG9jTmFtZSk7XG4gICAgY29uc3QgdmVuZG9yID0gcHQgPyBwdC52ZW5kb3IgOiAnJztcbiAgICBjb25zdCB2bSA9IHZlbmRvckxvb2t1cFt2ZW5kb3JdO1xuICAgIHJvd3MucHVzaCh7XG4gICAgICBUaXBvOiB0aXBvID09PSAnQycgPyAnQ2xpZW50ZSBhY3R1YWwnIDogJ1Byb3NwZWN0bycsXG4gICAgICBDbGllbnRlOiBjbGllbnROYW1lLFxuICAgICAgUHJvdmluY2lhOiB0aXRsZUNhc2UocHJvdmluY2UpLFxuICAgICAgTG9jYWxpZGFkOiBsb2NOYW1lLFxuICAgICAgRGVwYXJ0YW1lbnRvOiBwdCA/IHB0LmRlcHQgfHwgJycgOiAnJyxcbiAgICAgIFZlbmRlZG9yOiB0aXRsZUNhc2UodmVuZG9yIHx8ICcnKSxcbiAgICAgIFpvbmE6IHZtID8gdm0uem9uZSA6ICcnLFxuICAgICAgQ29udGFjdGFkbzogJ1NpJyxcbiAgICB9KTtcbiAgfSk7XG4gIHJvd3Muc29ydChcbiAgICAoYSwgYikgPT5cbiAgICAgIGEuVmVuZGVkb3IubG9jYWxlQ29tcGFyZShiLlZlbmRlZG9yKSB8fFxuICAgICAgYS5Qcm92aW5jaWEubG9jYWxlQ29tcGFyZShiLlByb3ZpbmNpYSkgfHxcbiAgICAgIGEuQ2xpZW50ZS5sb2NhbGVDb21wYXJlKGIuQ2xpZW50ZSlcbiAgKTtcbiAgcmV0dXJuIHJvd3M7XG59XG5cbi8vIExvZyBkZSBvcGVyYWNpb25lcyAoY2FuY2VsYWNpb25lcywgZWxpbWluYWNpb25lcywgdnVlbHZlLWEtYm9ycmFkb3IsIGV0Yy4pXG5mdW5jdGlvbiBidWlsZE9wc0xvZ1Jvd3MoKSB7XG4gIHJldHVybiAob3BzTG9nQ2FjaGUgfHwgW10pLm1hcCgobykgPT4gKHtcbiAgICBGZWNoYTogby50aW1lc3RhbXBcbiAgICAgID8gby50aW1lc3RhbXAudG9EYXRlXG4gICAgICAgID8gby50aW1lc3RhbXAudG9EYXRlKCkudG9Mb2NhbGVTdHJpbmcoKVxuICAgICAgICA6IG5ldyBEYXRlKG8udGltZXN0YW1wKS50b0xvY2FsZVN0cmluZygpXG4gICAgICA6ICcnLFxuICAgIFVzdWFyaW86IG8udXNlckVtYWlsIHx8ICcnLFxuICAgIFJvbDogby51c2VyUm9sZSB8fCAnJyxcbiAgICBBY2Npb246IG8uYWN0aW9uIHx8ICcnLFxuICAgICdUaXBvIGVudGlkYWQnOiBvLmVudGl0eVR5cGUgfHwgJycsXG4gICAgRW50aWRhZDogby5lbnRpdHlOYW1lIHx8ICcnLFxuICAgIERldGFsbGVzOiB0eXBlb2Ygby5kZXRhaWxzID09PSAnb2JqZWN0JyA/IEpTT04uc3RyaW5naWZ5KG8uZGV0YWlscykgOiBvLmRldGFpbHMgfHwgJycsXG4gIH0pKTtcbn1cblxuZnVuY3Rpb24gYnVpbGRWaXNpdFJvd3MoKSB7XG4gIHJldHVybiB2aXNpdHNDYWNoZS5tYXAoKHYpID0+ICh7XG4gICAgRmVjaGE6IHYuZmVjaGEgfHwgJycsXG4gICAgTWVzOiB2Lm1lcyB8fCAnJyxcbiAgICBBbm86IHYuYW5pbyB8fCAnJyxcbiAgICBWZW5kZWRvcjogdGl0bGVDYXNlKHYudmVuZG9yIHx8ICcnKSxcbiAgICAnVGlwbyBjb250YWN0byc6IHYudGlwb0NvbnRhY3RvID09PSAndGVsZWZvbm8nID8gJ1RlbGVmb25vJyA6ICdQcmVzZW5jaWFsJyxcbiAgICBDb21lbnRhcmlvOiB2LmNvbWVudGFyaW8gfHwgJycsXG4gICAgUHJvdmluY2lhOiB0aXRsZUNhc2Uodi5wcm92aW5jaWEgfHwgJycpLFxuICAgIExvY2FsaWRhZDogdi5sb2NhbGlkYWQgfHwgJycsXG4gICAgVGllbmRhOiB2LnRpZW5kYSB8fCAnJyxcbiAgICAnVGlwbyB0aWVuZGEnOiB2LnRpcG8gfHwgJycsXG4gICAgTG9jYWw6IHYubG9jYWwgfHwgJycsXG4gICAgVGFtYW5vOiB2LnRhbWFubyB8fCAnJyxcbiAgICBGaWRlbGlkYWQ6IHYuZmlkZWxpZGFkIHx8ICcnLFxuICAgICdSZWxldmFuY2lhICgxLTUpJzogdi5yZWxldmFuY2lhIHx8ICcnLFxuICAgIFBPUDogdi5wb3AgfHwgJycsXG4gICAgJ05lY2VzaWRhZCBwdW50dWFsJzogdi5uZWNlc2lkYWRQdW50dWFsID09PSAnTU9TVFJBRE8nID8gJ01PU1RSQURPUicgOiB2Lm5lY2VzaWRhZFB1bnR1YWwgfHwgJycsXG4gICAgJ1RpcG8gdmVudGEnOiB2LnRpcG9WZW50YSA9PT0gJ01PU1RSQURPJyA/ICdNT1NUUkFET1InIDogdi50aXBvVmVudGEgfHwgJycsXG4gICAgJyUgTW9zdHJhZG9yJzogdi5wb25kZXJhY2lvbk1vc3RyYWRvICE9IG51bGwgPyB2LnBvbmRlcmFjaW9uTW9zdHJhZG8gOiAnJyxcbiAgICAnJSBFY29tbWVyY2UnOiB2LnBvbmRlcmFjaW9uRWNvbW1lcmNlICE9IG51bGwgPyB2LnBvbmRlcmFjaW9uRWNvbW1lcmNlIDogJycsXG4gICAgQ29tcGV0ZW5jaWE6IHYuY29tcGV0ZW5jaWEgfHwgJycsXG4gICAgJ0NhdGVnb3JpYSBjbGllbnRlJzogdi5jYXRlZ29yaWFDbGllbnRlIHx8ICcnLFxuICAgIE9wb3J0dW5pZGFkOiB2Lm9wb3J0dW5pZGFkIHx8ICcnLFxuICAgICdMbyBtYXMgdmVuZGlkbyBTaGltYW5vJzogdi5tYXNWZW5kaWRvIHx8ICcnLFxuICAgICdMbyBxdWUgbWFzIHByZWd1bnRhbic6IHYubWFzUHJlZ3VudGFuIHx8ICcnLFxuICAgICdBeXVkYSBhIHRpZW5kYSc6IHYuYXl1ZGFUaWVuZGEgfHwgJycsXG4gICAgJ0ZvdG9zIGVzcGFjaW8gKGNhbnQpJzogKHYuZXNwYWNpbyB8fCBbXSkubGVuZ3RoLFxuICAgICdGb3RvIGZyZW50ZSc6IHYuZnJlbnRlTG9jYWwgPyAnU2knIDogJ05vJyxcbiAgICAnR1BTIGVzdGFkbyc6IHYuZ3BzU3RhdHVzIHx8ICcnLFxuICAgICdHUFMgZGlzdGFuY2lhIChtKSc6IHR5cGVvZiB2Lmdwc0Rpc3RhbmNlTSA9PT0gJ251bWJlcicgPyB2Lmdwc0Rpc3RhbmNlTSA6ICcnLFxuICAgICdHUFMgbGF0Jzogdi5ncHNMYXQgIT0gbnVsbCA/IHYuZ3BzTGF0IDogJycsXG4gICAgJ0dQUyBsb24nOiB2Lmdwc0xvbiAhPSBudWxsID8gdi5ncHNMb24gOiAnJyxcbiAgICAnR1BTIHByZWNpc2lvbiAobSknOiB2Lmdwc0FjY3VyYWN5ICE9IG51bGwgPyB2Lmdwc0FjY3VyYWN5IDogJycsXG4gICAgJ0dQUyBjYXB0dXJhZG8nOiB2Lmdwc0NhcHR1cmVkQXQgfHwgJycsXG4gICAgRW1haWw6IHYub3duZXJFbWFpbCB8fCAnJyxcbiAgfSkpO1xufVxuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gU0VDQ0lcdTAwRDNOOiBleHBvcnRFeGVjdXRpdmUvVmlzaXRzL1Bvd2VyQkkvTUwgKGlubGluZSBMMTAxNTgtMTA0MjYpXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxud2luZG93LmV4cG9ydEV4ZWN1dGl2ZSA9IGZ1bmN0aW9uICgpIHtcbiAgY29uc3Qgd2IgPSBYTFNYLnV0aWxzLmJvb2tfbmV3KCk7XG4gIGNvbnN0IHJvd3MgPSBidWlsZFBlZGlkb0RldGFpbFJvd3MoKTtcbiAgY29uc3QgY29uZlJvd3MgPSByb3dzLmZpbHRlcigocikgPT4gci5lc3RhZG8gPT09ICdDb25maXJtYWRvJyk7XG5cbiAgLy8gQ29uc29saWRhZG86IHVuYSBmaWxhIHBvciB2ZW5kZWRvciBjb24gS1BJc1xuICBjb25zdCBwZXJWZW5kb3IgPSB7fTtcbiAgY29uZlJvd3MuZm9yRWFjaCgocikgPT4ge1xuICAgIGNvbnN0IGsgPSByLnZlbmRlZG9yIHx8ICdTaW4gYXNpZ25hcic7XG4gICAgaWYgKCFwZXJWZW5kb3Jba10pXG4gICAgICBwZXJWZW5kb3Jba10gPSB7XG4gICAgICAgIHpvbmE6IHIuem9uYSxcbiAgICAgICAgdW5pZDogMCxcbiAgICAgICAgYXJzOiAwLFxuICAgICAgICB1c2Q6IDAsXG4gICAgICAgIGNsaWVudGVzOiBuZXcgU2V0KCksXG4gICAgICAgIHByb2RzOiBuZXcgU2V0KCksXG4gICAgICAgIHByb3ZzOiBuZXcgU2V0KCksXG4gICAgICB9O1xuICAgIHBlclZlbmRvcltrXS51bmlkICs9IHIuY2FudGlkYWQ7XG4gICAgcGVyVmVuZG9yW2tdLmFycyArPSByLnN1YnRvdGFsX2FycztcbiAgICBwZXJWZW5kb3Jba10udXNkICs9IHIuc3VidG90YWxfdXNkO1xuICAgIHBlclZlbmRvcltrXS5jbGllbnRlcy5hZGQoci5jbGllbnRlKTtcbiAgICBwZXJWZW5kb3Jba10ucHJvZHMuYWRkKHIuY29kaWdvKTtcbiAgICBwZXJWZW5kb3Jba10ucHJvdnMuYWRkKHIucHJvdmluY2lhKTtcbiAgfSk7XG4gIGNvbnN0IGNvbnNvbCA9IFtdO1xuICBWRU5ET1JTLmZvckVhY2goKHYpID0+IHtcbiAgICBjb25zdCB0aXRsZVYgPSB0aXRsZUNhc2Uodi5rZXkpO1xuICAgIGNvbnN0IGQgPSBwZXJWZW5kb3JbdGl0bGVWXSB8fCB7XG4gICAgICB6b25hOiB2LnpvbmUsXG4gICAgICB1bmlkOiAwLFxuICAgICAgYXJzOiAwLFxuICAgICAgdXNkOiAwLFxuICAgICAgY2xpZW50ZXM6IG5ldyBTZXQoKSxcbiAgICAgIHByb2RzOiBuZXcgU2V0KCksXG4gICAgICBwcm92czogbmV3IFNldCgpLFxuICAgIH07XG4gICAgY29uc3QgdCA9IFRBUkdFVFNfQllfVkVORE9SW3Yua2V5XSB8fCB7IGp1bDIwMjZfdXNkOiAwLCBqdWxEaWMyMDI2X3VzZDogMCwgYW51YWwyMDI3X3VzZDogMCB9O1xuICAgIGNvbnNvbC5wdXNoKHtcbiAgICAgIFpvbmE6IHYuem9uZSxcbiAgICAgIFZlbmRlZG9yOiB0aXRsZVYsXG4gICAgICBQcm92aW5jaWFzOiBkLnByb3ZzLnNpemUsXG4gICAgICAnQ2xpZW50ZXMgYWN0aXZvcyc6IGQuY2xpZW50ZXMuc2l6ZSxcbiAgICAgICdQcm9kdWN0b3MgZGlzdGludG9zJzogZC5wcm9kcy5zaXplLFxuICAgICAgVW5pZGFkZXM6IGQudW5pZCxcbiAgICAgICdGYWN0dXJhZG8gQVJTJzogTWF0aC5yb3VuZChkLmFycyksXG4gICAgICAnRmFjdHVyYWRvIFVTRCc6IE1hdGgucm91bmQoZC51c2QpLFxuICAgICAgJ1RhcmdldCBKdWwgMjAyNiBVU0QnOiB0Lmp1bDIwMjZfdXNkLFxuICAgICAgJ1RhcmdldCBKdWwtRGljIDIwMjYgVVNEJzogdC5qdWxEaWMyMDI2X3VzZCxcbiAgICAgICdUYXJnZXQgMjAyNyBVU0QnOiB0LmFudWFsMjAyN191c2QsXG4gICAgfSk7XG4gIH0pO1xuICBjb25zdCB3c0MgPSBYTFNYLnV0aWxzLmpzb25fdG9fc2hlZXQoY29uc29sKTtcbiAgd3NDWychY29scyddID0gW1xuICAgIHsgd2NoOiA2IH0sXG4gICAgeyB3Y2g6IDI0IH0sXG4gICAgeyB3Y2g6IDExIH0sXG4gICAgeyB3Y2g6IDE0IH0sXG4gICAgeyB3Y2g6IDE2IH0sXG4gICAgeyB3Y2g6IDExIH0sXG4gICAgeyB3Y2g6IDE2IH0sXG4gICAgeyB3Y2g6IDE2IH0sXG4gICAgeyB3Y2g6IDE4IH0sXG4gICAgeyB3Y2g6IDIwIH0sXG4gICAgeyB3Y2g6IDE4IH0sXG4gIF07XG4gIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQod2IsIHdzQywgJ0NvbnNvbGlkYWRvJyk7XG5cbiAgLy8gVW5hIGhvamEgcG9yIHZlbmRlZG9yIGNvbiBzdSBkZXRhbGxlIGRlIHBlZGlkb3MgY29uZmlybWFkb3NcbiAgVkVORE9SUy5mb3JFYWNoKCh2KSA9PiB7XG4gICAgY29uc3QgdGl0bGVWID0gdGl0bGVDYXNlKHYua2V5KTtcbiAgICBjb25zdCB2cm93cyA9IGNvbmZSb3dzXG4gICAgICAuZmlsdGVyKChyKSA9PiByLnZlbmRlZG9yID09PSB0aXRsZVYpXG4gICAgICAubWFwKChyKSA9PiAoe1xuICAgICAgICBGZWNoYTogci5mZWNoYSxcbiAgICAgICAgTWVzOiByLm1lc19wZWRpZG8sXG4gICAgICAgIFByb3ZpbmNpYTogci5wcm92aW5jaWEsXG4gICAgICAgIExvY2FsaWRhZDogci5sb2NhbGlkYWQsXG4gICAgICAgIENsaWVudGU6IHIuY2xpZW50ZSxcbiAgICAgICAgVGlwbzogci50aXBvX2NsaWVudGUsXG4gICAgICAgIENvZGlnbzogci5jb2RpZ28sXG4gICAgICAgIFByb2R1Y3RvOiByLnByb2R1Y3RvLFxuICAgICAgICBDYXRlZ29yaWE6IHIuY2F0ZWdvcmlhLFxuICAgICAgICBGYW1pbGlhOiByLmZhbWlsaWEsXG4gICAgICAgIFN1YmZhbWlsaWE6IHIuc3ViZmFtaWxpYSxcbiAgICAgICAgQ2FudGlkYWQ6IHIuY2FudGlkYWQsXG4gICAgICAgICdQcmVjaW8gQVJTJzogci5wcmVjaW9fdW5pdF9hcnMsXG4gICAgICAgICdTdWJ0b3RhbCBBUlMnOiByLnN1YnRvdGFsX2FycyxcbiAgICAgICAgJ1N1YnRvdGFsIFVTRCc6IHIuc3VidG90YWxfdXNkLFxuICAgICAgfSkpO1xuICAgIHZyb3dzLnNvcnQoXG4gICAgICAoYSwgYikgPT4gKGEuRmVjaGEgfHwgJycpLmxvY2FsZUNvbXBhcmUoYi5GZWNoYSB8fCAnJykgfHwgYS5DbGllbnRlLmxvY2FsZUNvbXBhcmUoYi5DbGllbnRlKVxuICAgICk7XG4gICAgaWYgKCF2cm93cy5sZW5ndGgpXG4gICAgICB2cm93cy5wdXNoKHtcbiAgICAgICAgRmVjaGE6ICcnLFxuICAgICAgICBNZXM6ICcnLFxuICAgICAgICBQcm92aW5jaWE6ICcnLFxuICAgICAgICBMb2NhbGlkYWQ6ICcnLFxuICAgICAgICBDbGllbnRlOiAnKHNpbiBwZWRpZG9zIGNvbmZpcm1hZG9zKScsXG4gICAgICAgIFRpcG86ICcnLFxuICAgICAgICBDb2RpZ286ICcnLFxuICAgICAgICBQcm9kdWN0bzogJycsXG4gICAgICAgIENhdGVnb3JpYTogJycsXG4gICAgICAgIEZhbWlsaWE6ICcnLFxuICAgICAgICBTdWJmYW1pbGlhOiAnJyxcbiAgICAgICAgQ2FudGlkYWQ6IDAsXG4gICAgICAgICdQcmVjaW8gQVJTJzogMCxcbiAgICAgICAgJ1N1YnRvdGFsIEFSUyc6IDAsXG4gICAgICAgICdTdWJ0b3RhbCBVU0QnOiAwLFxuICAgICAgfSk7XG4gICAgY29uc3Qgd3MgPSBYTFNYLnV0aWxzLmpzb25fdG9fc2hlZXQodnJvd3MpO1xuICAgIHdzWychY29scyddID0gW1xuICAgICAgeyB3Y2g6IDExIH0sXG4gICAgICB7IHdjaDogMTQgfSxcbiAgICAgIHsgd2NoOiAxOCB9LFxuICAgICAgeyB3Y2g6IDIyIH0sXG4gICAgICB7IHdjaDogMzAgfSxcbiAgICAgIHsgd2NoOiAxMSB9LFxuICAgICAgeyB3Y2g6IDE0IH0sXG4gICAgICB7IHdjaDogMzggfSxcbiAgICAgIHsgd2NoOiAxNCB9LFxuICAgICAgeyB3Y2g6IDE4IH0sXG4gICAgICB7IHdjaDogMTggfSxcbiAgICAgIHsgd2NoOiAxMCB9LFxuICAgICAgeyB3Y2g6IDEyIH0sXG4gICAgICB7IHdjaDogMTQgfSxcbiAgICAgIHsgd2NoOiAxNCB9LFxuICAgIF07XG4gICAgWExTWC51dGlscy5ib29rX2FwcGVuZF9zaGVldChcbiAgICAgIHdiLFxuICAgICAgd3MsXG4gICAgICAodi56b25lICsgJyAnICsgdGl0bGVWKS5zdWJzdHJpbmcoMCwgMzEpLnJlcGxhY2UoL1tcXFxcLyo/W1xcXTpdL2csICcnKVxuICAgICk7XG4gIH0pO1xuXG4gIC8vIFZpc2l0YXNcbiAgY29uc3QgdmlzaXRSb3dzID0gYnVpbGRWaXNpdFJvd3MoKTtcbiAgaWYgKHZpc2l0Um93cy5sZW5ndGgpIHtcbiAgICBjb25zdCB3c1YgPSBYTFNYLnV0aWxzLmpzb25fdG9fc2hlZXQodmlzaXRSb3dzKTtcbiAgICBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KHdiLCB3c1YsICdWaXNpdGFzJyk7XG4gIH1cbiAgLy8gQ29udGFjdGFkb3MgKHRvZG9zIGxvcyBjbGllbnRlcy9wcm9zcGVjdG9zIG1hcmNhZG9zIGNvbiBjaGVjaylcbiAgY29uc3QgY29udGFjdFJvd3MgPSBidWlsZENvbnRhY3RhZG9zUm93cygpO1xuICBpZiAoY29udGFjdFJvd3MubGVuZ3RoKSB7XG4gICAgWExTWC51dGlscy5ib29rX2FwcGVuZF9zaGVldCh3YiwgWExTWC51dGlscy5qc29uX3RvX3NoZWV0KGNvbnRhY3RSb3dzKSwgJ0NvbnRhY3RhZG9zJyk7XG4gIH1cbiAgLy8gTG9nIGRlIG9wZXJhY2lvbmVzIChjYW5jZWxhY2lvbmVzLCBlbGltaW5hY2lvbmVzLCBldGMuKVxuICBjb25zdCBvcHNSb3dzID0gYnVpbGRPcHNMb2dSb3dzKCk7XG4gIGlmIChvcHNSb3dzLmxlbmd0aCkge1xuICAgIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQod2IsIFhMU1gudXRpbHMuanNvbl90b19zaGVldChvcHNSb3dzKSwgJ0xvZyBPcGVyYWNpb25lcycpO1xuICB9XG5cbiAgWExTWC53cml0ZUZpbGUod2IsICdTaGltYW5vX0VqZWN1dGl2b18nICsgdG9kYXlTdHIoKSArICcueGxzeCcpO1xufTtcblxuLy8gLS0tLS0tLS0tLSBFeGNlbCBkZSBWaXNpdGFzIChmb3JtYXRvIHN0YW5kYWxvbmUpIC0tLS0tLS0tLS1cbndpbmRvdy5leHBvcnRWaXNpdHNFeGNlbCA9IGZ1bmN0aW9uICgpIHtcbiAgaWYgKHR5cGVvZiBYTFNYID09PSAndW5kZWZpbmVkJykge1xuICAgIGFsZXJ0KCdMYSBsaWJyZXJpYSBkZSBFeGNlbCBubyBzZSBjYXJnby4gVmVyaWZpcXVlIHN1IGNvbmV4aW9uIGEgaW50ZXJuZXQgeSByZWludGVudGUuJyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGNvbnN0IHZpc2l0Um93cyA9IGJ1aWxkVmlzaXRSb3dzKCk7XG4gIGlmICghdmlzaXRSb3dzLmxlbmd0aCkge1xuICAgIGFsZXJ0KFxuICAgICAgJ05vIGhheSB2aXNpdGFzIHJlZ2lzdHJhZGFzIHRvZGF2aWEuIEN1YW5kbyBzZSBjYXJndWUgYWwgbWVub3MgdW5hLCB2YXMgYSBwb2RlciBleHBvcnRhcmxhLidcbiAgICApO1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCB3YiA9IFhMU1gudXRpbHMuYm9va19uZXcoKTtcblxuICAvLyBIb2phIHByaW5jaXBhbDogVmlzaXRhcyAodG9kYXMgbGFzIGZpbGFzKVxuICBjb25zdCB3cyA9IFhMU1gudXRpbHMuanNvbl90b19zaGVldCh2aXNpdFJvd3MpO1xuICB3c1snIWNvbHMnXSA9IFtcbiAgICB7IHdjaDogMTIgfSxcbiAgICB7IHdjaDogMTQgfSxcbiAgICB7IHdjaDogOCB9LFxuICAgIHsgd2NoOiAyNCB9LFxuICAgIHsgd2NoOiAxOCB9LFxuICAgIHsgd2NoOiAyMiB9LFxuICAgIHsgd2NoOiAzMCB9LFxuICAgIHsgd2NoOiAxOCB9LFxuICAgIHsgd2NoOiAxNCB9LFxuICAgIHsgd2NoOiAxNCB9LFxuICAgIHsgd2NoOiAxNCB9LFxuICAgIHsgd2NoOiAxNiB9LFxuICAgIHsgd2NoOiA4IH0sXG4gICAgeyB3Y2g6IDIyIH0sXG4gICAgeyB3Y2g6IDE0IH0sXG4gICAgeyB3Y2g6IDE0IH0sXG4gICAgeyB3Y2g6IDE0IH0sXG4gICAgeyB3Y2g6IDE4IH0sXG4gICAgeyB3Y2g6IDE4IH0sXG4gICAgeyB3Y2g6IDMyIH0sXG4gICAgeyB3Y2g6IDMyIH0sXG4gICAgeyB3Y2g6IDMyIH0sXG4gICAgeyB3Y2g6IDMyIH0sXG4gICAgeyB3Y2g6IDE4IH0sXG4gICAgeyB3Y2g6IDE0IH0sXG4gICAgeyB3Y2g6IDI0IH0sXG4gIF07XG4gIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQod2IsIHdzLCAnVmlzaXRhcycpO1xuXG4gIC8vIEhvamEgcmVzdW1lbiBwb3IgdmVuZGVkb3I6IGNhbnRpZGFkIGRlIHZpc2l0YXMgeSB0aWVuZGFzIHVuaWNhc1xuICBjb25zdCBwZXJWZW5kb3IgPSB7fTtcbiAgdmlzaXRzQ2FjaGUuZm9yRWFjaCgodikgPT4ge1xuICAgIGNvbnN0IGsgPSB0aXRsZUNhc2Uodi52ZW5kb3IgfHwgJ1NpbiBhc2lnbmFyJyk7XG4gICAgaWYgKCFwZXJWZW5kb3Jba10pXG4gICAgICBwZXJWZW5kb3Jba10gPSB7XG4gICAgICAgIHZpc2l0YXM6IDAsXG4gICAgICAgIHRpZW5kYXM6IG5ldyBTZXQoKSxcbiAgICAgICAgbG9jYWxpZGFkZXM6IG5ldyBTZXQoKSxcbiAgICAgICAgcHJvdmluY2lhczogbmV3IFNldCgpLFxuICAgICAgfTtcbiAgICBwZXJWZW5kb3Jba10udmlzaXRhcysrO1xuICAgIGlmICh2LnRpZW5kYSkgcGVyVmVuZG9yW2tdLnRpZW5kYXMuYWRkKHYudGllbmRhKTtcbiAgICBpZiAodi5sb2NhbGlkYWQpIHBlclZlbmRvcltrXS5sb2NhbGlkYWRlcy5hZGQodi5sb2NhbGlkYWQpO1xuICAgIGlmICh2LnByb3ZpbmNpYSkgcGVyVmVuZG9yW2tdLnByb3ZpbmNpYXMuYWRkKHYucHJvdmluY2lhKTtcbiAgfSk7XG4gIGNvbnN0IHJlc3VtZW4gPSBPYmplY3QuZW50cmllcyhwZXJWZW5kb3IpXG4gICAgLm1hcCgoW3ZlbmRlZG9yLCBkXSkgPT4gKHtcbiAgICAgIFZlbmRlZG9yOiB2ZW5kZWRvcixcbiAgICAgICdWaXNpdGFzIHRvdGFsZXMnOiBkLnZpc2l0YXMsXG4gICAgICAnVGllbmRhcyBkaXN0aW50YXMnOiBkLnRpZW5kYXMuc2l6ZSxcbiAgICAgICdMb2NhbGlkYWRlcyBkaXN0aW50YXMnOiBkLmxvY2FsaWRhZGVzLnNpemUsXG4gICAgICAnUHJvdmluY2lhcyBkaXN0aW50YXMnOiBkLnByb3ZpbmNpYXMuc2l6ZSxcbiAgICB9KSlcbiAgICAuc29ydCgoYSwgYikgPT4gYlsnVmlzaXRhcyB0b3RhbGVzJ10gLSBhWydWaXNpdGFzIHRvdGFsZXMnXSk7XG4gIGlmIChyZXN1bWVuLmxlbmd0aCkge1xuICAgIGNvbnN0IHdzUiA9IFhMU1gudXRpbHMuanNvbl90b19zaGVldChyZXN1bWVuKTtcbiAgICB3c1JbJyFjb2xzJ10gPSBbeyB3Y2g6IDI0IH0sIHsgd2NoOiAxNiB9LCB7IHdjaDogMTggfSwgeyB3Y2g6IDIyIH0sIHsgd2NoOiAyMiB9XTtcbiAgICBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KHdiLCB3c1IsICdSZXN1bWVuIHBvciB2ZW5kZWRvcicpO1xuICB9XG5cbiAgWExTWC53cml0ZUZpbGUod2IsICdTaGltYW5vX1Zpc2l0YXNfJyArIHRvZGF5U3RyKCkgKyAnLnhsc3gnKTtcbn07XG5cbi8vIC0tLS0tLS0tLS0gT1BDSU9OIEI6IFBvd2VyIEJJIChGYWN0ICsgRGltKSAtLS0tLS0tLS0tXG53aW5kb3cuZXhwb3J0UG93ZXJCSSA9IGZ1bmN0aW9uICgpIHtcbiAgY29uc3Qgd2IgPSBYTFNYLnV0aWxzLmJvb2tfbmV3KCk7XG4gIGNvbnN0IHJvd3MgPSBidWlsZFBlZGlkb0RldGFpbFJvd3MoKTtcblxuICAvLyBGYWN0X1BlZGlkb3NcbiAgY29uc3QgZmFjdFJvd3MgPSByb3dzLmZpbHRlcigocikgPT4gci5lc3RhZG8gIT09ICdCb3JyYWRvcicpO1xuICBjb25zdCB3c0YgPSBYTFNYLnV0aWxzLmpzb25fdG9fc2hlZXQoXG4gICAgZmFjdFJvd3MubWFwKChyKSA9PiAoe1xuICAgICAgbGluZV9pZDogci5saW5lX2lkLFxuICAgICAgZmVjaGE6IHIuZmVjaGEsXG4gICAgICBlc3RhZG86IHIuZXN0YWRvLFxuICAgICAgdmVuZGVkb3Jfa2V5OiByLnZlbmRlZG9yX2tleSxcbiAgICAgIHpvbmE6IHIuem9uYSxcbiAgICAgIHByb3ZpbmNpYTogci5wcm92aW5jaWEsXG4gICAgICBsb2NhbGlkYWQ6IHIubG9jYWxpZGFkLFxuICAgICAgY2xpZW50ZTogci5jbGllbnRlLFxuICAgICAgdGlwb19jbGllbnRlOiByLnRpcG9fY2xpZW50ZSxcbiAgICAgIHNrdTogci5jb2RpZ28sXG4gICAgICBjYW50aWRhZDogci5jYW50aWRhZCxcbiAgICAgIHByZWNpb191bml0X2Fyczogci5wcmVjaW9fdW5pdF9hcnMsXG4gICAgICBzdWJ0b3RhbF9hcnM6IHIuc3VidG90YWxfYXJzLFxuICAgICAgc3VidG90YWxfdXNkOiByLnN1YnRvdGFsX3VzZCxcbiAgICB9KSlcbiAgKTtcbiAgWExTWC51dGlscy5ib29rX2FwcGVuZF9zaGVldCh3Yiwgd3NGLCAnRmFjdF9QZWRpZG9zJyk7XG5cbiAgLy8gRGltX1ZlbmRlZG9yXG4gIGNvbnN0IGRpbVYgPSBWRU5ET1JTLm1hcCgodikgPT4ge1xuICAgIGNvbnN0IHQgPSBUQVJHRVRTX0JZX1ZFTkRPUlt2LmtleV0gfHwge307XG4gICAgcmV0dXJuIHtcbiAgICAgIHZlbmRlZG9yX2tleTogdi5rZXksXG4gICAgICB2ZW5kZWRvcl9ub21icmU6IHRpdGxlQ2FzZSh2LmtleSksXG4gICAgICB6b25hOiB2LnpvbmUsXG4gICAgICB6b25hX2Rlc2NyaXBjaW9uOiB2LmxhYmVsLFxuICAgICAgY29sb3I6IHYuY29sb3IsXG4gICAgICB0YXJnZXRfanVsMjAyNl91c2Q6IHQuanVsMjAyNl91c2QgfHwgMCxcbiAgICAgIHRhcmdldF9qdWxEaWMyMDI2X3VzZDogdC5qdWxEaWMyMDI2X3VzZCB8fCAwLFxuICAgICAgdGFyZ2V0XzIwMjdfdXNkOiB0LmFudWFsMjAyN191c2QgfHwgMCxcbiAgICB9O1xuICB9KTtcbiAgWExTWC51dGlscy5ib29rX2FwcGVuZF9zaGVldCh3YiwgWExTWC51dGlscy5qc29uX3RvX3NoZWV0KGRpbVYpLCAnRGltX1ZlbmRlZG9yJyk7XG5cbiAgLy8gRGltX1Byb2R1Y3RvXG4gIGNvbnN0IGRpbVAgPSBQUk9EVUNUUy5tYXAoKHApID0+ICh7XG4gICAgc2t1OiBwLmNvZGUsXG4gICAgZGVzY3JpcGNpb246IHAuZGVzYyxcbiAgICBjYXRlZ29yaWE6IHAuY2F0LFxuICAgIGZhbWlsaWE6IHAuZmFtLFxuICAgIHN1YmZhbWlsaWE6IHAuc3ViLFxuICB9KSk7XG4gIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQod2IsIFhMU1gudXRpbHMuanNvbl90b19zaGVldChkaW1QKSwgJ0RpbV9Qcm9kdWN0bycpO1xuXG4gIC8vIERpbV9DbGllbnRlICh1bml2ZXJzbylcbiAgY29uc3QgZGltQyA9IFtdO1xuICBQT0lOVFMuZm9yRWFjaCgocCkgPT4ge1xuICAgIGNvbnN0IHZtID0gdmVuZG9yTG9va3VwW3AudmVuZG9yXTtcbiAgICBwLmNsaWVudHMuZm9yRWFjaCgobikgPT4ge1xuICAgICAgZGltQy5wdXNoKHtcbiAgICAgICAgY2xpZW50ZTogbixcbiAgICAgICAgdGlwbzogJ0NsaWVudGUgYWN0dWFsJyxcbiAgICAgICAgcHJvdmluY2lhOiB0aXRsZUNhc2UocC5wcm92aW5jZSksXG4gICAgICAgIGxvY2FsaWRhZDogcC5uYW1lLFxuICAgICAgICBkZXBhcnRhbWVudG86IHAuZGVwdCB8fCAnJyxcbiAgICAgICAgdmVuZGVkb3Jfa2V5OiBwLnZlbmRvciB8fCAnJyxcbiAgICAgICAgem9uYTogdm0gPyB2bS56b25lIDogJycsXG4gICAgICB9KTtcbiAgICB9KTtcbiAgICBwLnByb3NwZWN0cy5mb3JFYWNoKChuKSA9PiB7XG4gICAgICBkaW1DLnB1c2goe1xuICAgICAgICBjbGllbnRlOiBuLFxuICAgICAgICB0aXBvOiAnUHJvc3BlY3RvJyxcbiAgICAgICAgcHJvdmluY2lhOiB0aXRsZUNhc2UocC5wcm92aW5jZSksXG4gICAgICAgIGxvY2FsaWRhZDogcC5uYW1lLFxuICAgICAgICBkZXBhcnRhbWVudG86IHAuZGVwdCB8fCAnJyxcbiAgICAgICAgdmVuZGVkb3Jfa2V5OiBwLnZlbmRvciB8fCAnJyxcbiAgICAgICAgem9uYTogdm0gPyB2bS56b25lIDogJycsXG4gICAgICB9KTtcbiAgICB9KTtcbiAgfSk7XG4gIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQod2IsIFhMU1gudXRpbHMuanNvbl90b19zaGVldChkaW1DKSwgJ0RpbV9DbGllbnRlJyk7XG5cbiAgLy8gRGltX0NhbGVuZGFyaW8gKGZlY2hhcyBkaXN0aW50YXMgZW4gbG9zIHBlZGlkb3MgKyBzZXJpZSBjb250aW51YSBkZWwgYVx1MDBGMW8gYWN0dWFsKVxuICBjb25zdCBjYWxTZXQgPSBuZXcgU2V0KCk7XG4gIGZhY3RSb3dzLmZvckVhY2goKHIpID0+IHtcbiAgICBpZiAoci5mZWNoYSkgY2FsU2V0LmFkZChyLmZlY2hhKTtcbiAgfSk7XG4gIC8vIENvbXBsZXRhciBkZXNkZSAyMDI2LTAxLTAxIGhhc3RhIGhveSArIDM2NVxuICBjb25zdCBzdGFydCA9IG5ldyBEYXRlKCcyMDI2LTAxLTAxJyk7XG4gIGNvbnN0IGVuZCA9IG5ldyBEYXRlKCk7XG4gIGVuZC5zZXREYXRlKGVuZC5nZXREYXRlKCkgKyAzNjUpO1xuICBmb3IgKGxldCBkID0gbmV3IERhdGUoc3RhcnQpOyBkIDw9IGVuZDsgZC5zZXREYXRlKGQuZ2V0RGF0ZSgpICsgMSkpXG4gICAgY2FsU2V0LmFkZChkLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwgMTApKTtcbiAgY29uc3QgZGltQ2FsID0gWy4uLmNhbFNldF0uc29ydCgpLm1hcCgoZHQpID0+IHtcbiAgICBjb25zdCBbeSwgbSwgZGFdID0gZHQuc3BsaXQoJy0nKS5tYXAoKHgpID0+IHBhcnNlSW50KHgsIDEwKSk7XG4gICAgY29uc3QgZGF0ZU9iaiA9IG5ldyBEYXRlKHksIG0gLSAxLCBkYSk7XG4gICAgcmV0dXJuIHtcbiAgICAgIGZlY2hhOiBkdCxcbiAgICAgIHllYXI6IHksXG4gICAgICBtb250aDogbSxcbiAgICAgIGRheTogZGEsXG4gICAgICBxdWFydGVyOiAnUScgKyAoTWF0aC5mbG9vcigobSAtIDEpIC8gMykgKyAxKSxcbiAgICAgIG1vbnRoX25hbWU6IE1FU0VTW20gLSAxXSxcbiAgICAgIHllYXJfbW9udGg6IHkgKyAnLScgKyBTdHJpbmcobSkucGFkU3RhcnQoMiwgJzAnKSxcbiAgICAgIGRheV9vZl93ZWVrOiBbJ0RvbScsICdMdW4nLCAnTWFyJywgJ01pZScsICdKdWUnLCAnVmllJywgJ1NhYiddW2RhdGVPYmouZ2V0RGF5KCldLFxuICAgIH07XG4gIH0pO1xuICBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KHdiLCBYTFNYLnV0aWxzLmpzb25fdG9fc2hlZXQoZGltQ2FsKSwgJ0RpbV9DYWxlbmRhcmlvJyk7XG5cbiAgLy8gRGltX0NhbXBhbmlhXG4gIGNvbnN0IGRpbUNtcCA9IGNhbXBhaWduc0NhY2hlLm1hcCgoYykgPT4gKHtcbiAgICBjYW1wYW5pYV9pZDogYy5pZCxcbiAgICBub21icmU6IGMubmFtZSxcbiAgICBmaWx0ZXJfdHlwZTogYy5maWx0ZXJUeXBlLFxuICAgIGZpbHRlcl92YWx1ZXM6IChjLmZpbHRlclZhbHVlcyB8fCBbXSkuam9pbignLCAnKSxcbiAgICB0YXJnZXRfdHlwZTogYy50YXJnZXRUeXBlLFxuICAgIHRhcmdldF9hbW91bnQ6IGMudGFyZ2V0QW1vdW50LFxuICAgIGRlc2RlOiBjLnN0YXJ0RGF0ZSxcbiAgICBoYXN0YTogYy5lbmREYXRlLFxuICB9KSk7XG4gIGlmIChkaW1DbXAubGVuZ3RoKVxuICAgIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQod2IsIFhMU1gudXRpbHMuanNvbl90b19zaGVldChkaW1DbXApLCAnRGltX0NhbXBhbmlhJyk7XG5cbiAgLy8gUGFyYW1zICh0aXBvIGRlIGNhbWJpbywgZmVjaGEgZXhwb3J0LCB2ZXJzaW9uKVxuICBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KFxuICAgIHdiLFxuICAgIFhMU1gudXRpbHMuanNvbl90b19zaGVldChbXG4gICAgICB7IHBhcmFtZXRybzogJ2V4Y2hhbmdlX3JhdGVfYXJzX3VzZCcsIHZhbG9yOiBFWENIQU5HRV9SQVRFIH0sXG4gICAgICB7IHBhcmFtZXRybzogJ2ZlY2hhX2V4cG9ydCcsIHZhbG9yOiB0b2RheVN0cigpIH0sXG4gICAgICB7IHBhcmFtZXRybzogJ3RvdGFsX2ZpbGFzX2ZhY3QnLCB2YWxvcjogZmFjdFJvd3MubGVuZ3RoIH0sXG4gICAgXSksXG4gICAgJ1BhcmFtZXRyb3MnXG4gICk7XG5cbiAgLy8gRmFjdF9WaXNpdGFzXG4gIGNvbnN0IHZpc2l0Um93c0IgPSBidWlsZFZpc2l0Um93cygpO1xuICBpZiAodmlzaXRSb3dzQi5sZW5ndGgpXG4gICAgWExTWC51dGlscy5ib29rX2FwcGVuZF9zaGVldCh3YiwgWExTWC51dGlscy5qc29uX3RvX3NoZWV0KHZpc2l0Um93c0IpLCAnRmFjdF9WaXNpdGFzJyk7XG4gIC8vIENvbnRhY3RhZG9zXG4gIGNvbnN0IGNvbnRhY3RSb3dzQiA9IGJ1aWxkQ29udGFjdGFkb3NSb3dzKCk7XG4gIGlmIChjb250YWN0Um93c0IubGVuZ3RoKVxuICAgIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQod2IsIFhMU1gudXRpbHMuanNvbl90b19zaGVldChjb250YWN0Um93c0IpLCAnQ29udGFjdGFkb3MnKTtcbiAgLy8gTG9nIGRlIG9wZXJhY2lvbmVzXG4gIGNvbnN0IG9wc1Jvd3NCID0gYnVpbGRPcHNMb2dSb3dzKCk7XG4gIGlmIChvcHNSb3dzQi5sZW5ndGgpXG4gICAgWExTWC51dGlscy5ib29rX2FwcGVuZF9zaGVldCh3YiwgWExTWC51dGlscy5qc29uX3RvX3NoZWV0KG9wc1Jvd3NCKSwgJ0xvZ19PcGVyYWNpb25lcycpO1xuXG4gIFhMU1gud3JpdGVGaWxlKHdiLCAnU2hpbWFub19Qb3dlckJJXycgKyB0b2RheVN0cigpICsgJy54bHN4Jyk7XG59O1xuXG4vLyAtLS0tLS0tLS0tIE9QQ0lPTiBDOiBQeXRob24gLyBJQSAvIE1MIChzaW5nbGUgbG9uZy1mb3JtYXQgdGFibGUpIC0tLS0tLS0tLS1cbndpbmRvdy5leHBvcnRNTCA9IGZ1bmN0aW9uICgpIHtcbiAgY29uc3Qgd2IgPSBYTFNYLnV0aWxzLmJvb2tfbmV3KCk7XG4gIGNvbnN0IHJvd3MgPSBidWlsZFBlZGlkb0RldGFpbFJvd3MoKTtcbiAgLy8gbWFzdGVyX21sOiB1bmEgZmlsYSBwb3IgbGluZWEgY29uIFRPREFTIGxhcyBmZWF0dXJlc1xuICBjb25zdCB3cyA9IFhMU1gudXRpbHMuanNvbl90b19zaGVldChyb3dzKTtcbiAgd3NbJyFjb2xzJ10gPSBPYmplY3Qua2V5cyhyb3dzWzBdIHx8IHsgZmVjaGE6ICcnIH0pLm1hcCgoKSA9PiAoeyB3Y2g6IDE0IH0pKTtcbiAgWExTWC51dGlscy5ib29rX2FwcGVuZF9zaGVldCh3Yiwgd3MsICdtYXN0ZXJfbWwnKTtcblxuICAvLyBjYXRhbG9nbyB5IHVuaXZlcnNvIGRlIGNsaWVudGVzIGNvbW8gcmVmZXJlbmNpYXMgcGFyYSBlbnJpcXVlY2VyIGVuIHBhbmRhc1xuICBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KFxuICAgIHdiLFxuICAgIFhMU1gudXRpbHMuanNvbl90b19zaGVldChcbiAgICAgIFBST0RVQ1RTLm1hcCgocCkgPT4gKHsgY29kZTogcC5jb2RlLCBkZXNjOiBwLmRlc2MsIGNhdDogcC5jYXQsIGZhbTogcC5mYW0sIHN1YjogcC5zdWIgfSkpXG4gICAgKSxcbiAgICAncHJvZHVjdG9zX2NhdGFsb2dvJ1xuICApO1xuXG4gIGNvbnN0IHVuaXZlcnNlID0gW107XG4gIFBPSU5UUy5mb3JFYWNoKChwKSA9PiB7XG4gICAgY29uc3Qgdm0gPSB2ZW5kb3JMb29rdXBbcC52ZW5kb3JdO1xuICAgIHAuY2xpZW50cy5mb3JFYWNoKChuKSA9PiB7XG4gICAgICB1bml2ZXJzZS5wdXNoKHtcbiAgICAgICAgY2xpZW50ZTogbixcbiAgICAgICAgdGlwbzogJ2NsaWVudGVfYWN0dWFsJyxcbiAgICAgICAgcHJvdmluY2lhOiB0aXRsZUNhc2UocC5wcm92aW5jZSksXG4gICAgICAgIGxvY2FsaWRhZDogcC5uYW1lLFxuICAgICAgICBkZXBhcnRhbWVudG86IHAuZGVwdCB8fCAnJyxcbiAgICAgICAgdmVuZGVkb3I6IHRpdGxlQ2FzZShwLnZlbmRvciB8fCAnJyksXG4gICAgICAgIHpvbmE6IHZtID8gdm0uem9uZSA6ICcnLFxuICAgICAgICBsYXQ6IHAubGF0LFxuICAgICAgICBsb246IHAubG9uLFxuICAgICAgfSk7XG4gICAgfSk7XG4gICAgcC5wcm9zcGVjdHMuZm9yRWFjaCgobikgPT4ge1xuICAgICAgdW5pdmVyc2UucHVzaCh7XG4gICAgICAgIGNsaWVudGU6IG4sXG4gICAgICAgIHRpcG86ICdwcm9zcGVjdG8nLFxuICAgICAgICBwcm92aW5jaWE6IHRpdGxlQ2FzZShwLnByb3ZpbmNlKSxcbiAgICAgICAgbG9jYWxpZGFkOiBwLm5hbWUsXG4gICAgICAgIGRlcGFydGFtZW50bzogcC5kZXB0IHx8ICcnLFxuICAgICAgICB2ZW5kZWRvcjogdGl0bGVDYXNlKHAudmVuZG9yIHx8ICcnKSxcbiAgICAgICAgem9uYTogdm0gPyB2bS56b25lIDogJycsXG4gICAgICAgIGxhdDogcC5sYXQsXG4gICAgICAgIGxvbjogcC5sb24sXG4gICAgICB9KTtcbiAgICB9KTtcbiAgfSk7XG4gIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQod2IsIFhMU1gudXRpbHMuanNvbl90b19zaGVldCh1bml2ZXJzZSksICd1bml2ZXJzb19jbGllbnRlcycpO1xuXG4gIC8vIHRhcmdldHMgY29tbyB0YWJsYSBsb25nXG4gIGNvbnN0IHRhcmdldHNMb25nID0gW107XG4gIE9iamVjdC5lbnRyaWVzKFRBUkdFVFNfQllfVkVORE9SKS5mb3JFYWNoKChbdmVuZG9yLCB0XSkgPT4ge1xuICAgIHRhcmdldHNMb25nLnB1c2goe1xuICAgICAgdmVuZGVkb3I6IGRpc3BsYXlWZW5kb3JOYW1lKHZlbmRvciksXG4gICAgICBwZXJpb2RvOiAnSnVsIDIwMjYnLFxuICAgICAgc3RhcnRfZGF0ZTogJzIwMjYtMDctMDEnLFxuICAgICAgZW5kX2RhdGU6ICcyMDI2LTA3LTMxJyxcbiAgICAgIHRhcmdldF91c2Q6IHQuanVsMjAyNl91c2QgfHwgMCxcbiAgICB9KTtcbiAgICB0YXJnZXRzTG9uZy5wdXNoKHtcbiAgICAgIHZlbmRlZG9yOiBkaXNwbGF5VmVuZG9yTmFtZSh2ZW5kb3IpLFxuICAgICAgcGVyaW9kbzogJ0p1bC1EaWMgMjAyNicsXG4gICAgICBzdGFydF9kYXRlOiAnMjAyNi0wNy0wMScsXG4gICAgICBlbmRfZGF0ZTogJzIwMjYtMTItMzEnLFxuICAgICAgdGFyZ2V0X3VzZDogdC5qdWxEaWMyMDI2X3VzZCB8fCAwLFxuICAgIH0pO1xuICAgIHRhcmdldHNMb25nLnB1c2goe1xuICAgICAgdmVuZGVkb3I6IGRpc3BsYXlWZW5kb3JOYW1lKHZlbmRvciksXG4gICAgICBwZXJpb2RvOiAnMjAyNycsXG4gICAgICBzdGFydF9kYXRlOiAnMjAyNy0wMS0wMScsXG4gICAgICBlbmRfZGF0ZTogJzIwMjctMTItMzEnLFxuICAgICAgdGFyZ2V0X3VzZDogdC5hbnVhbDIwMjdfdXNkIHx8IDAsXG4gICAgfSk7XG4gIH0pO1xuICBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KHdiLCBYTFNYLnV0aWxzLmpzb25fdG9fc2hlZXQodGFyZ2V0c0xvbmcpLCAndGFyZ2V0c19sb25nJyk7XG5cbiAgLy8gY2FtcGFcdTAwRjFhc1xuICBpZiAoY2FtcGFpZ25zQ2FjaGUubGVuZ3RoKSB7XG4gICAgWExTWC51dGlscy5ib29rX2FwcGVuZF9zaGVldChcbiAgICAgIHdiLFxuICAgICAgWExTWC51dGlscy5qc29uX3RvX3NoZWV0KFxuICAgICAgICBjYW1wYWlnbnNDYWNoZS5tYXAoKGMpID0+ICh7XG4gICAgICAgICAgaWQ6IGMuaWQsXG4gICAgICAgICAgbm9tYnJlOiBjLm5hbWUsXG4gICAgICAgICAgZmlsdGVyX3R5cGU6IGMuZmlsdGVyVHlwZSxcbiAgICAgICAgICBmaWx0ZXJfdmFsdWVzOiAoYy5maWx0ZXJWYWx1ZXMgfHwgW10pLmpvaW4oJywnKSxcbiAgICAgICAgICB0YXJnZXRfdHlwZTogYy50YXJnZXRUeXBlLFxuICAgICAgICAgIHRhcmdldF9hbW91bnQ6IGMudGFyZ2V0QW1vdW50LFxuICAgICAgICAgIHN0YXJ0X2RhdGU6IGMuc3RhcnREYXRlLFxuICAgICAgICAgIGVuZF9kYXRlOiBjLmVuZERhdGUsXG4gICAgICAgIH0pKVxuICAgICAgKSxcbiAgICAgICdjYW1wYW5pYXMnXG4gICAgKTtcbiAgfVxuXG4gIC8vIHBhcmFtZXRyb3NcbiAgWExTWC51dGlscy5ib29rX2FwcGVuZF9zaGVldChcbiAgICB3YixcbiAgICBYTFNYLnV0aWxzLmpzb25fdG9fc2hlZXQoW1xuICAgICAgeyBwYXJhbWV0cm86ICdleGNoYW5nZV9yYXRlX2Fyc191c2QnLCB2YWxvcjogRVhDSEFOR0VfUkFURSB9LFxuICAgICAgeyBwYXJhbWV0cm86ICdmZWNoYV9leHBvcnQnLCB2YWxvcjogbmV3IERhdGUoKS50b0lTT1N0cmluZygpIH0sXG4gICAgXSksXG4gICAgJ3BhcmFtZXRyb3MnXG4gICk7XG5cbiAgLy8gdmlzaXRhc1xuICBjb25zdCB2aXNpdFJvd3NDID0gYnVpbGRWaXNpdFJvd3MoKTtcbiAgaWYgKHZpc2l0Um93c0MubGVuZ3RoKVxuICAgIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQod2IsIFhMU1gudXRpbHMuanNvbl90b19zaGVldCh2aXNpdFJvd3NDKSwgJ3Zpc2l0YXMnKTtcbiAgLy8gY29udGFjdGFkb3NcbiAgY29uc3QgY29udGFjdFJvd3NDID0gYnVpbGRDb250YWN0YWRvc1Jvd3MoKTtcbiAgaWYgKGNvbnRhY3RSb3dzQy5sZW5ndGgpXG4gICAgWExTWC51dGlscy5ib29rX2FwcGVuZF9zaGVldCh3YiwgWExTWC51dGlscy5qc29uX3RvX3NoZWV0KGNvbnRhY3RSb3dzQyksICdjb250YWN0YWRvcycpO1xuICAvLyBsb2cgZGUgb3BlcmFjaW9uZXNcbiAgY29uc3Qgb3BzUm93c0MgPSBidWlsZE9wc0xvZ1Jvd3MoKTtcbiAgaWYgKG9wc1Jvd3NDLmxlbmd0aClcbiAgICBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KHdiLCBYTFNYLnV0aWxzLmpzb25fdG9fc2hlZXQob3BzUm93c0MpLCAnbG9nX29wZXJhY2lvbmVzJyk7XG5cbiAgWExTWC53cml0ZUZpbGUod2IsICdTaGltYW5vX01MXycgKyB0b2RheVN0cigpICsgJy54bHN4Jyk7XG59O1xuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIHYzNzErOiBFeHBvcnQgZGF0YXNldCBwYXJhIGFuXHUwMEUxbGlzaXMgKFpJUCBkZSBDU1ZzIHBhcmEgTUwgcGlwZWxpbmVzKVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbi8qKlxuICogQWJyZSBlbCBtb2RhbCBjaGljbyBkaXNwYXRjaGVyIGRlbCBib3RvbiBcIkV4cG9ydGFyIGEgRXhjZWxcIi4gTXVlc3RyYVxuICogMiB0YXJqZXRhczogUmVwb3J0ZXMgRXhjZWwgKHRvZG9zKSB2cyBEYXRhc2V0IFpJUCAoc29sbyBhZG1pbi9nZXJlbnRlKS5cbiAqL1xud2luZG93Lm9wZW5FeHBvcnRGb3JtYXRNb2RhbCA9IGZ1bmN0aW9uICgpIHtcbiAgLy8gT2N1bHRhci9tb3N0cmFyIHRhcmpldGEgRGF0YXNldCBzZWd1biByb2wuXG4gIGNvbnN0IGRzT3B0ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2V4cC1vcHQtZGF0YXNldC16aXAnKTtcbiAgaWYgKGRzT3B0KSB7XG4gICAgY29uc3QgaXNBZG1pbk9yR2VyZW50ZSA9IHVzZXJSb2xlID09PSAnYWRtaW4nIHx8IHVzZXJSb2xlID09PSAnZ2VyZW50ZSc7XG4gICAgZHNPcHQuc3R5bGUuZGlzcGxheSA9IGlzQWRtaW5PckdlcmVudGUgPyAnJyA6ICdub25lJztcbiAgfVxuICAvLyBPY3VsdGFyIHByb2dyZXNzIGJhciAocG9yIHNpIHF1ZWRvIGFiaWVydG8gZGUgdW5hIGVqZWN1Y2lvbiBhbnRlcmlvcilcbiAgY29uc3QgcHJvZyA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdleHBvcnQtZGF0YXNldC1wcm9ncmVzcycpO1xuICBpZiAocHJvZykgcHJvZy5zdHlsZS5kaXNwbGF5ID0gJ25vbmUnO1xuICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZXhwb3J0LWZvcm1hdC1tb2RhbCcpLmNsYXNzTGlzdC5hZGQoJ29wZW4nKTtcbn07XG5cbndpbmRvdy5jbG9zZUV4cG9ydEZvcm1hdE1vZGFsID0gZnVuY3Rpb24gKCkge1xuICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZXhwb3J0LWZvcm1hdC1tb2RhbCcpLmNsYXNzTGlzdC5yZW1vdmUoJ29wZW4nKTtcbn07XG5cbi8qKlxuICogQWN0dWFsaXphIGVsIHN0YXR1cyArIGJhcnJhIGRlbCBtb2RhbC4gc3RhdHVzIGVzIHRleHRvIGxpYnJlOyBwZXJjZW50IDAuLjEwMC5cbiAqL1xuZnVuY3Rpb24gX3VwZGF0ZUV4cG9ydFByb2dyZXNzKHN0YXR1cywgcGVyY2VudCkge1xuICBjb25zdCBzID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2V4cG9ydC1kYXRhc2V0LXN0YXR1cycpO1xuICBjb25zdCBiID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2V4cG9ydC1kYXRhc2V0LWJhcicpO1xuICBjb25zdCB3cmFwID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2V4cG9ydC1kYXRhc2V0LXByb2dyZXNzJyk7XG4gIGlmICh3cmFwKSB3cmFwLnN0eWxlLmRpc3BsYXkgPSAnJztcbiAgaWYgKHMpIHMudGV4dENvbnRlbnQgPSBzdGF0dXM7XG4gIGlmIChiKSBiLnN0eWxlLndpZHRoID0gTWF0aC5tYXgoMCwgTWF0aC5taW4oMTAwLCBwZXJjZW50KSkgKyAnJSc7XG59XG5cbi8qKlxuICogRmV0Y2ggc3RvY2suanNvbiBkZWwgcm9vdCBkZWwgc2l0aW8gKHYzNjkrIHRpZW5lIHdhcmVob3VzZUJyZWFrZG93bikuXG4gKiBDYWNoZS1idXN0aW5nIGNvbiA/dD0gcGFyYSBldml0YXIgU1cuXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIF9mZXRjaFN0b2NrSnNvbigpIHtcbiAgdHJ5IHtcbiAgICBjb25zdCByID0gYXdhaXQgZmV0Y2goJy4vc3RvY2suanNvbj90PScgKyBEYXRlLm5vdygpLCB7IGNhY2hlOiAnbm8tc3RvcmUnIH0pO1xuICAgIGlmICghci5vaykgdGhyb3cgbmV3IEVycm9yKCdIVFRQICcgKyByLnN0YXR1cyk7XG4gICAgcmV0dXJuIGF3YWl0IHIuanNvbigpO1xuICB9IGNhdGNoIChlKSB7XG4gICAgY29uc29sZS53YXJuKCdbZXhwb3J0RGF0YXNldFppcF0gc3RvY2suanNvbiBmYWxsbzonLCBlICYmIGUubWVzc2FnZSk7XG4gICAgcmV0dXJuIG51bGw7IC8vIG5vIGJsb3F1ZWFudGUgXHUyMDE0IHByb2R1Y3Rvcy5jc3YgcXVlZGEgdmFjaW9cbiAgfVxufVxuXG4vKipcbiAqIExhenkgbG9hZCBKU1ppcCAocGF0cm9uIHlhIHVzYWRvIGVuIGV4cG9ydFBob3Rvc1ppcCBsaW5lYSB+NDcpLlxuICovXG5hc3luYyBmdW5jdGlvbiBfZW5zdXJlSlNaaXBMb2FkZWQoKSB7XG4gIGlmICh0eXBlb2YgSlNaaXAgIT09ICd1bmRlZmluZWQnKSByZXR1cm47XG4gIGF3YWl0IG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICBjb25zdCBzID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnc2NyaXB0Jyk7XG4gICAgcy5zcmMgPSAnaHR0cHM6Ly9jZG5qcy5jbG91ZGZsYXJlLmNvbS9hamF4L2xpYnMvanN6aXAvMy4xMC4xL2pzemlwLm1pbi5qcyc7XG4gICAgcy5vbmxvYWQgPSByZXNvbHZlO1xuICAgIHMub25lcnJvciA9ICgpID0+IHJlamVjdChuZXcgRXJyb3IoJ05vIHNlIHB1ZG8gY2FyZ2FyIEpTWmlwJykpO1xuICAgIGRvY3VtZW50LmhlYWQuYXBwZW5kQ2hpbGQocyk7XG4gIH0pO1xufVxuXG4vKipcbiAqIERlc2NhcmdhIHVuIEJsb2IgY29tbyBhcmNoaXZvLiBSZXVzYSBlbCBwYXRyb24gZGUgZXhwb3J0UGhvdG9zWmlwLlxuICovXG5mdW5jdGlvbiBfZG93bmxvYWRCbG9iKGJsb2IsIGZpbGVuYW1lKSB7XG4gIGNvbnN0IHVybCA9IFVSTC5jcmVhdGVPYmplY3RVUkwoYmxvYik7XG4gIGNvbnN0IGEgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdhJyk7XG4gIGEuaHJlZiA9IHVybDtcbiAgYS5kb3dubG9hZCA9IGZpbGVuYW1lO1xuICBkb2N1bWVudC5ib2R5LmFwcGVuZENoaWxkKGEpO1xuICBhLmNsaWNrKCk7XG4gIHNldFRpbWVvdXQoKCkgPT4ge1xuICAgIGRvY3VtZW50LmJvZHkucmVtb3ZlQ2hpbGQoYSk7XG4gICAgVVJMLnJldm9rZU9iamVjdFVSTCh1cmwpO1xuICB9LCAxMDApO1xufVxuXG4vKipcbiAqIEVYUE9SVCBQUklOQ0lQQUwuIFNvbG8gYWRtaW4vZ2VyZW50ZS4gR2VuZXJhIFpJUCBjb246XG4gKiAgLSBwZWRpZG9zLmNzdiwgdmlzaXRhcy5jc3YsIGNsaWVudGVzLmNzdiwgY2xpZW50X21hc3Rlci5jc3YsIHJlbmRpY2lvbmVzLmNzdixcbiAqICAgIGNhbXBhbmlhcy5jc3YsIHRhcmdldHMuY3N2LCBwcm9kdWN0b3MuY3N2LCB2ZW5kb3Jfb3ZlcnJpZGVzLmNzdixcbiAqICAgIGN1c3RvbV9yb3V0ZXMuY3N2LCBzZWd1aW1pZW50b19ub3Rlcy5jc3ZcbiAqICAtIG1hbmlmZXN0Lmpzb24gKHNjaGVtYSArIHVzZUNhc2VNYXRyaXggKyByb3dDb3VudHMgKyBudWxsUmF0ZUJ5RmllbGQgKyBsaW1pdGF0aW9ucylcbiAqXG4gKiBDYXNvcyBib3JkZSBtYW5lamFkb3M6XG4gKiAgLSBTaSBhbGd1bmEgLmdldCgpIGZhbGxhIC0+IGFsZXJ0ICsgbm8gZGVzY2FyZ2FyIChubyBnZW5lcmEgWklQIHBhcmNpYWwgc2lsZW5jaW9zbykuXG4gKiAgLSBTaSBzdG9jay5qc29uIG5vIHJlc3BvbmRlIC0+IHByb2R1Y3Rvcy5jc3YgcXVlZGEgdmFjaW8gY29uIHdhcm5pbmcgZW4gbWFuaWZlc3QuXG4gKiAgLSBQcm9ncmVzcyBiYXIgZW4gZWwgbW9kYWwgcGFyYSBmZWVkYmFjayAofjEwLTMwIHNlZykuXG4gKi9cbndpbmRvdy5leHBvcnREYXRhc2V0WmlwID0gYXN5bmMgZnVuY3Rpb24gKCkge1xuICBpZiAodXNlclJvbGUgIT09ICdhZG1pbicgJiYgdXNlclJvbGUgIT09ICdnZXJlbnRlJykge1xuICAgIGFsZXJ0KCdTb2xvIGFkbWluIG8gZ2VyZW50ZSBwdWVkZW4gZXhwb3J0YXIgZWwgZGF0YXNldC4nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgaWYgKCFmYkRiKSB7XG4gICAgYWxlcnQoJ0ZpcmVzdG9yZSBubyBpbmljaWFsaXphZG8uIFJlY2FyZ2EgbGEgYXBwLicpO1xuICAgIHJldHVybjtcbiAgfVxuXG4gIC8vIFJlLWFicmlyIG1vZGFsIHNpIGVsIHVzdWFyaW8gY2Vycm8geSBuYXZlZ2Ftb3MgcG9yIG90cm8gZmx1am8uXG4gIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdleHBvcnQtZm9ybWF0LW1vZGFsJykuY2xhc3NMaXN0LmFkZCgnb3BlbicpO1xuICBfdXBkYXRlRXhwb3J0UHJvZ3Jlc3MoJ1ByZXBhcmFuZG8uLi4nLCA1KTtcblxuICB0cnkge1xuICAgIF91cGRhdGVFeHBvcnRQcm9ncmVzcygnQ2FyZ2FuZG8gSlNaaXAuLi4nLCAxMCk7XG4gICAgYXdhaXQgX2Vuc3VyZUpTWmlwTG9hZGVkKCk7XG5cbiAgICAvLyAxKSBGZXRjaCAxMCBjb2xlY2Npb25lcyBGaXJlc3RvcmUgZW4gcGFyYWxlbG8gKyBzdG9jay5qc29uXG4gICAgX3VwZGF0ZUV4cG9ydFByb2dyZXNzKCdMZXllbmRvIEZpcmVzdG9yZSAoMTAgY29sZWNjaW9uZXMpLi4uJywgMjApO1xuICAgIGNvbnN0IGZpcmVzdG9yZUVudHJpZXMgPSBbXG4gICAgICBbJ3BlZGlkb3MnLCBmYkRiLmNvbGxlY3Rpb24oJ3BlZGlkb3MnKS5nZXQoKV0sXG4gICAgICBbJ3Zpc2l0YXMnLCBmYkRiLmNvbGxlY3Rpb24oJ3Zpc2l0cycpLmdldCgpXSxcbiAgICAgIFsnY2xpZW50ZXMnLCBmYkRiLmNvbGxlY3Rpb24oJ2NsaWVudF9hcHBsaWNhdGlvbnMnKS5nZXQoKV0sXG4gICAgICBbJ2NsaWVudF9tYXN0ZXInLCBmYkRiLmNvbGxlY3Rpb24oJ2NsaWVudF9tYXN0ZXInKS5nZXQoKV0sXG4gICAgICBbJ3JlbmRpY2lvbmVzJywgZmJEYi5jb2xsZWN0aW9uKCdyZW5kaWNpb25lcycpLmdldCgpXSxcbiAgICAgIFsnY2FtcGFuaWFzJywgZmJEYi5jb2xsZWN0aW9uKCdjYW1wYWlnbnMnKS5nZXQoKV0sXG4gICAgICBbJ3RhcmdldHMnLCBmYkRiLmNvbGxlY3Rpb24oJ3RhcmdldHMnKS5nZXQoKV0sXG4gICAgICBbJ3ZlbmRvcl9vdmVycmlkZXMnLCBmYkRiLmNvbGxlY3Rpb24oJ3ZlbmRvcl9vdmVycmlkZXMnKS5nZXQoKV0sXG4gICAgICBbJ2N1c3RvbV9yb3V0ZXMnLCBmYkRiLmNvbGxlY3Rpb24oJ2N1c3RvbV9yb3V0ZXMnKS5nZXQoKV0sXG4gICAgICBbJ3NlZ3VpbWllbnRvX25vdGVzJywgZmJEYi5jb2xsZWN0aW9uKCdzZWd1aW1pZW50b19ub3RlcycpLmdldCgpXSxcbiAgICBdO1xuICAgIGNvbnN0IHByb21pc2VzID0gZmlyZXN0b3JlRW50cmllcy5tYXAoKFssIHBdKSA9PiBwKTtcbiAgICBwcm9taXNlcy5wdXNoKF9mZXRjaFN0b2NrSnNvbigpKTtcblxuICAgIGNvbnN0IHNldHRsZWQgPSBhd2FpdCBQcm9taXNlLmFsbFNldHRsZWQocHJvbWlzZXMpO1xuICAgIC8vIFNpIENVQUxRVUlFUiBnZXQoKSBkZSBGaXJlc3RvcmUgcmVjaGF6bywgYWJvcnRhbW9zIChubyBleHBvcnQgcGFyY2lhbCBzaWxlbmNpb3NvKS5cbiAgICBjb25zdCBmYWlsZWRGaXJlc3RvcmUgPSBbXTtcbiAgICBzZXR0bGVkLnNsaWNlKDAsIGZpcmVzdG9yZUVudHJpZXMubGVuZ3RoKS5mb3JFYWNoKChyLCBpKSA9PiB7XG4gICAgICBpZiAoci5zdGF0dXMgPT09ICdyZWplY3RlZCcpXG4gICAgICAgIGZhaWxlZEZpcmVzdG9yZS5wdXNoKFxuICAgICAgICAgIGZpcmVzdG9yZUVudHJpZXNbaV1bMF0gKyAnOiAnICsgKChyLnJlYXNvbiAmJiByLnJlYXNvbi5tZXNzYWdlKSB8fCByLnJlYXNvbilcbiAgICAgICAgKTtcbiAgICB9KTtcbiAgICBpZiAoZmFpbGVkRmlyZXN0b3JlLmxlbmd0aCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgICAnRmlyZXN0b3JlIGZldGNoIGZhbGxvIGVuICcgK1xuICAgICAgICAgIGZhaWxlZEZpcmVzdG9yZS5sZW5ndGggK1xuICAgICAgICAgICcgY29sZWNjaW9uZXM6XFxuJyArXG4gICAgICAgICAgZmFpbGVkRmlyZXN0b3JlLmpvaW4oJ1xcbicpXG4gICAgICApO1xuICAgIH1cblxuICAgIC8vIDIpIEV4dHJhZXIgc25hcHNob3RzICsgZG9jcyBjb24gX2lkXG4gICAgY29uc3Qgc25hcHNob3RzID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBhbnlbXT59ICovICh7fSk7XG4gICAgZmlyZXN0b3JlRW50cmllcy5mb3JFYWNoKChbbmFtZV0sIGkpID0+IHtcbiAgICAgIGNvbnN0IHNuYXAgPSAvKiogQHR5cGUge2FueX0gKi8gKHNldHRsZWRbaV0pLnZhbHVlO1xuICAgICAgY29uc3QgZG9jcyA9IFtdO1xuICAgICAgc25hcC5mb3JFYWNoKChkKSA9PiB7XG4gICAgICAgIGNvbnN0IGRhdGEgPSBkLmRhdGEoKSB8fCB7fTtcbiAgICAgICAgZGF0YS5faWQgPSBkLmlkO1xuICAgICAgICBkb2NzLnB1c2goZGF0YSk7XG4gICAgICB9KTtcbiAgICAgIHNuYXBzaG90c1tuYW1lXSA9IGRvY3M7XG4gICAgfSk7XG4gICAgY29uc3Qgc3RvY2tKc29uID0gLyoqIEB0eXBlIHthbnl9ICovIChzZXR0bGVkW3NldHRsZWQubGVuZ3RoIC0gMV0pLnZhbHVlOyAvLyBwdWVkZSBzZXIgbnVsbFxuXG4gICAgLy8gMykgQ29uc3RydWlyIENTVnMgY29uIHJvdyBidWlsZGVycyArIHNjaGVtYXNcbiAgICBfdXBkYXRlRXhwb3J0UHJvZ3Jlc3MoJ1NlcmlhbGl6YW5kbyBDU1ZzLi4uJywgNTUpO1xuICAgIGNvbnN0IGNzdnMgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIHN0cmluZz59ICovICh7fSk7XG4gICAgY29uc3Qgcm93Q291bnRzID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBudW1iZXI+fSAqLyAoe30pO1xuICAgIGNvbnN0IGFsbFJvd3NCeUNzdiA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgYW55W11bXT59ICovICh7fSk7XG5cbiAgICBmb3IgKGNvbnN0IGNvbGxOYW1lIG9mIE9iamVjdC5rZXlzKHNuYXBzaG90cykpIHtcbiAgICAgIGNvbnN0IHNjaGVtYSA9IERBVEFTRVRfU0NIRU1BU1tjb2xsTmFtZV07XG4gICAgICBpZiAoIXNjaGVtYSkgY29udGludWU7XG4gICAgICBjb25zdCBidWlsZGVyID0gUk9XX0JVSUxERVJTW2NvbGxOYW1lXTtcbiAgICAgIGlmICghYnVpbGRlcikgY29udGludWU7XG4gICAgICBjb25zdCBhbGxSb3dzID0gLyoqIEB0eXBlIHthbnlbXVtdfSAqLyAoW10pO1xuICAgICAgZm9yIChjb25zdCBkb2Mgb2Ygc25hcHNob3RzW2NvbGxOYW1lXSkge1xuICAgICAgICBjb25zdCByb3dzRm9yRG9jID0gYnVpbGRlcihkb2MpO1xuICAgICAgICBmb3IgKGNvbnN0IHIgb2Ygcm93c0ZvckRvYykgYWxsUm93cy5wdXNoKHIpO1xuICAgICAgfVxuICAgICAgYWxsUm93c0J5Q3N2W3NjaGVtYS5uYW1lXSA9IGFsbFJvd3M7XG4gICAgICBjc3ZzW3NjaGVtYS5uYW1lXSA9IGJ1aWxkQ3N2KHNjaGVtYSwgYWxsUm93cyk7XG4gICAgICByb3dDb3VudHNbc2NoZW1hLm5hbWVdID0gYWxsUm93cy5sZW5ndGg7XG4gICAgfVxuXG4gICAgLy8gcHJvZHVjdG9zLmNzdiAoZGVzZGUgc3RvY2suanNvbiwgbm8gRmlyZXN0b3JlKVxuICAgIGNvbnN0IHByb2R1Y3Rvc1NjaGVtYSA9IERBVEFTRVRfU0NIRU1BUy5wcm9kdWN0b3M7XG4gICAgY29uc3QgcHJvZHVjdG9zUm93cyA9IHN0b2NrSnNvbiA/IGJ1aWxkUHJvZHVjdG9Sb3dzRnJvbVN0b2NrSnNvbihzdG9ja0pzb24pIDogW107XG4gICAgYWxsUm93c0J5Q3N2W3Byb2R1Y3Rvc1NjaGVtYS5uYW1lXSA9IHByb2R1Y3Rvc1Jvd3M7XG4gICAgY3N2c1twcm9kdWN0b3NTY2hlbWEubmFtZV0gPSBidWlsZENzdihwcm9kdWN0b3NTY2hlbWEsIHByb2R1Y3Rvc1Jvd3MpO1xuICAgIHJvd0NvdW50c1twcm9kdWN0b3NTY2hlbWEubmFtZV0gPSBwcm9kdWN0b3NSb3dzLmxlbmd0aDtcblxuICAgIC8vIDQpIENvbXB1dGFyIG51bGxSYXRlQnlGaWVsZCBwYXJhIGNhZGEgY2FzbyBBLUVcbiAgICBfdXBkYXRlRXhwb3J0UHJvZ3Jlc3MoJ0NhbGN1bGFuZG8gY2FsaWRhZCBkZWwgZGF0YXNldC4uLicsIDc1KTtcbiAgICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIGFueT59ICovXG4gICAgY29uc3QgdXNlQ2FzZVdpdGhTdGF0cyA9IHt9O1xuICAgIGZvciAoY29uc3QgW2Nhc2VLZXksIHVjXSBvZiBPYmplY3QuZW50cmllcyhEQVRBU0VUX1VTRV9DQVNFX01BVFJJWCkpIHtcbiAgICAgIGNvbnN0IHN0YXRzID0gLyoqIEB0eXBlIHthbnl9ICovICh7XG4gICAgICAgIHByaW9yaXR5OiB1Yy5wcmlvcml0eSxcbiAgICAgICAgZGVzY3JpcHRpb246IHVjLmRlc2NyaXB0aW9uLFxuICAgICAgICByZXF1aXJlZEZpZWxkczogdWMucmVxdWlyZWRGaWVsZHMsXG4gICAgICAgIGpvaW5Ob3RlczogdWMuam9pbk5vdGVzLFxuICAgICAgICBudWxsUmF0ZUJ5RmllbGQ6IHt9LFxuICAgICAgICBsaW1pdGF0aW9uczogW10sXG4gICAgICB9KTtcbiAgICAgIGxldCBoYXNIaWdoTnVsbFJhdGUgPSBmYWxzZTtcbiAgICAgIGxldCBoYXNFbXB0eVJlcXVpcmVkID0gZmFsc2U7XG4gICAgICBmb3IgKGNvbnN0IFtjc3ZOYW1lLCBmaWVsZHNdIG9mIE9iamVjdC5lbnRyaWVzKHVjLnJlcXVpcmVkRmllbGRzKSkge1xuICAgICAgICBjb25zdCBzY2hlbWFGb3JDc3YgPSBPYmplY3QudmFsdWVzKERBVEFTRVRfU0NIRU1BUykuZmluZCgocykgPT4gcy5uYW1lID09PSBjc3ZOYW1lKTtcbiAgICAgICAgaWYgKCFzY2hlbWFGb3JDc3YpIHtcbiAgICAgICAgICBzdGF0cy5saW1pdGF0aW9ucy5wdXNoKCdTY2hlbWEgbm8gZW5jb250cmFkbyBwYXJhICcgKyBjc3ZOYW1lKTtcbiAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuICAgICAgICBjb25zdCByb3dzID0gYWxsUm93c0J5Q3N2W2Nzdk5hbWVdIHx8IFtdO1xuICAgICAgICBjb25zdCByYXRlcyA9IGNvbXB1dGVOdWxsUmF0ZXMoc2NoZW1hRm9yQ3N2LCByb3dzLCBmaWVsZHMpO1xuICAgICAgICBmb3IgKGNvbnN0IFtmLCByYXRlXSBvZiBPYmplY3QuZW50cmllcyhyYXRlcykpIHtcbiAgICAgICAgICBzdGF0cy5udWxsUmF0ZUJ5RmllbGRbY3N2TmFtZSArICcuJyArIGZdID0gcmF0ZTtcbiAgICAgICAgICBpZiAocm93cy5sZW5ndGggPT09IDApIGhhc0VtcHR5UmVxdWlyZWQgPSB0cnVlO1xuICAgICAgICAgIGVsc2UgaWYgKHJhdGUgPiAwLjUpIGhhc0hpZ2hOdWxsUmF0ZSA9IHRydWU7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIGlmIChoYXNFbXB0eVJlcXVpcmVkKSB7XG4gICAgICAgIHN0YXRzLnN0YXR1cyA9ICdFTVBUWSc7XG4gICAgICAgIHN0YXRzLmxpbWl0YXRpb25zLnB1c2goXG4gICAgICAgICAgJ0FsZ3VuYSBjb2xlY2Npb24gcmVxdWVyaWRhIGVzdGEgdmFjaWEgXHUyMDE0IGVsIGNhc28gbm8gc2UgcHVlZGUgZW50cmVuYXIgaG95IHBlcm8gZWwgc2NoZW1hIGVzdGEgbGlzdG8uJ1xuICAgICAgICApO1xuICAgICAgfSBlbHNlIGlmIChoYXNIaWdoTnVsbFJhdGUpIHtcbiAgICAgICAgc3RhdHMuc3RhdHVzID0gJ1BBUlRJQUwnO1xuICAgICAgICBzdGF0cy5saW1pdGF0aW9ucy5wdXNoKFxuICAgICAgICAgICdBbCBtZW5vcyAxIGNhbXBvIHJlcXVlcmlkbyB0aWVuZSA+NTAlIGRlIG51bGxzIFx1MjAxNCByZXZpc2FyIHRhc2FzIGFudGVzIGRlIHVzYXIuJ1xuICAgICAgICApO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgc3RhdHMuc3RhdHVzID0gJ09LJztcbiAgICAgIH1cbiAgICAgIHVzZUNhc2VXaXRoU3RhdHNbY2FzZUtleV0gPSBzdGF0cztcbiAgICB9XG5cbiAgICAvLyA1KSBNYW5pZmVzdC5qc29uXG4gICAgY29uc3QgZXhwb3J0ZWRBdCA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKTtcbiAgICBjb25zdCBtYW5pZmVzdCA9IHtcbiAgICAgIGV4cG9ydGVkQXQsXG4gICAgICBhcHBWZXJzaW9uOiB0eXBlb2YgQVBQX1ZFUlNJT04gIT09ICd1bmRlZmluZWQnID8gQVBQX1ZFUlNJT04gOiAndW5rbm93bicsXG4gICAgICBzb3VyY2VQcm9qZWN0OiAnYXBwLXZlbmRlZG9yZXMtc2hpbWFubycsXG4gICAgICBleHBvcnRlZEJ5RW1haWw6IChjdXJyZW50VXNlciAmJiBjdXJyZW50VXNlci5lbWFpbCkgfHwgJ3Vua25vd24nLFxuICAgICAgZXhwb3J0ZWRCeVVpZDogKGN1cnJlbnRVc2VyICYmIGN1cnJlbnRVc2VyLnVpZCkgfHwgJ3Vua25vd24nLFxuICAgICAgY3N2Q29udmVudGlvbnM6IHtcbiAgICAgICAgZW5jb2Rpbmc6ICdVVEYtOCcsXG4gICAgICAgIHNlcGFyYXRvcjogJywnLFxuICAgICAgICBxdW90ZUNoYXI6ICdcIicsXG4gICAgICAgIGVzY2FwZVF1b3RlOiAnXCJcIicsXG4gICAgICAgIGxpbmVUZXJtaW5hdG9yOiAnXFxcXHJcXFxcbicsXG4gICAgICAgIGRhdGVGb3JtYXQ6ICdJU08gODYwMSBVVEMgKHdpdGggWiknLFxuICAgICAgICBkZWNpbWFsU2VwYXJhdG9yOiAnLicsXG4gICAgICAgIG51bGxSZXByZXNlbnRhdGlvbjogJyhlbXB0eSBmaWVsZCknLFxuICAgICAgICBhcnJheUZvcm1hdDogJ0pTT04gc3RyaW5naWZpZWQnLFxuICAgICAgICBvYmplY3RGb3JtYXQ6ICdKU09OIHN0cmluZ2lmaWVkJyxcbiAgICAgIH0sXG4gICAgICByb3dDb3VudHMsXG4gICAgICBzY2hlbWE6IHt9LFxuICAgICAgdXNlQ2FzZU1hdHJpeDogdXNlQ2FzZVdpdGhTdGF0cyxcbiAgICAgIGV4Y2x1c2lvbnM6IHtcbiAgICAgICAgbm90ZTogJ0RhdG9zIHNlbnNpYmxlcyB5IGJpbmFyaW9zIGV4Y2x1aWRvcyBkZWwgZXhwb3J0LicsXG4gICAgICAgIGV4Y2x1ZGVkQ29sbGVjdGlvbnM6IFtcbiAgICAgICAgICAncm9sZXMnLFxuICAgICAgICAgICdhcHBfY29uZmlnJyxcbiAgICAgICAgICAnc2FwX3NuYXBzaG90JyxcbiAgICAgICAgICAnbm90aWZpY2F0aW9ucycsXG4gICAgICAgICAgJ29wZXJhdGlvbnNfbG9nJyxcbiAgICAgICAgXSxcbiAgICAgICAgZXhjbHVkZWRGaWVsZHM6IFtcbiAgICAgICAgICAndmlzaXRzLmZyZW50ZUxvY2FsIChmb3RvcyBiYXNlNjQpJyxcbiAgICAgICAgICAndmlzaXRzLmVzcGFjaW9bXSAoZm90b3MgYmFzZTY0KScsXG4gICAgICAgICAgJ2NsaWVudF9hcHBsaWNhdGlvbnMuY29uc3RhbmNpYUFyY2EgKGJhc2U2NCknLFxuICAgICAgICAgICdjbGllbnRfYXBwbGljYXRpb25zLmNvbnN0YW5jaWFJSUJCIChiYXNlNjQpJyxcbiAgICAgICAgICAnY2xpZW50X2FwcGxpY2F0aW9ucy5mb3Rvc0xvY2FsW10gKGJhc2U2NCknLFxuICAgICAgICAgICdyZW5kaWNpb25lcy5mb3RvVGlja2V0IChiYXNlNjQgbGVnYWN5IHByZS12MzA4OyBzZSBleHBvcnRhIHNvbG8gZm90b1RpY2tldFVybCknLFxuICAgICAgICBdLFxuICAgICAgICBzdG9ja0pzb25Mb2FkZWQ6IHN0b2NrSnNvbiAhPT0gbnVsbCxcbiAgICAgIH0sXG4gICAgfTtcbiAgICBmb3IgKGNvbnN0IFtfY29sbE5hbWUsIHNjaGVtYV0gb2YgT2JqZWN0LmVudHJpZXMoREFUQVNFVF9TQ0hFTUFTKSkge1xuICAgICAgbWFuaWZlc3Quc2NoZW1hW3NjaGVtYS5uYW1lXSA9IHNjaGVtYS5jb2x1bW5zLm1hcCgoYykgPT4gKHtcbiAgICAgICAgY29sOiBjLmNvbCxcbiAgICAgICAgdHlwZTogYy50eXBlLFxuICAgICAgICBkZXNjOiBjLmRlc2MsXG4gICAgICB9KSk7XG4gICAgfVxuXG4gICAgLy8gNikgRW1wYXF1ZXRhciBaSVBcbiAgICBfdXBkYXRlRXhwb3J0UHJvZ3Jlc3MoJ0VtcGFxdWV0YW5kbyBaSVAuLi4nLCA5MCk7XG4gICAgY29uc3QgemlwID0gbmV3IEpTWmlwKCk7XG4gICAgZm9yIChjb25zdCBbbmFtZSwgY29udGVudF0gb2YgT2JqZWN0LmVudHJpZXMoY3N2cykpIHtcbiAgICAgIHppcC5maWxlKG5hbWUsIGNvbnRlbnQpO1xuICAgIH1cbiAgICB6aXAuZmlsZSgnbWFuaWZlc3QuanNvbicsIEpTT04uc3RyaW5naWZ5KG1hbmlmZXN0LCBudWxsLCAyKSk7XG5cbiAgICBjb25zdCBibG9iID0gYXdhaXQgemlwLmdlbmVyYXRlQXN5bmMoe1xuICAgICAgdHlwZTogJ2Jsb2InLFxuICAgICAgY29tcHJlc3Npb246ICdERUZMQVRFJyxcbiAgICAgIGNvbXByZXNzaW9uT3B0aW9uczogeyBsZXZlbDogNiB9LFxuICAgIH0pO1xuICAgIGNvbnN0IGZpbGVuYW1lID0gJ3NoaW1hbm8tZGF0YXNldC0nICsgZXhwb3J0ZWRBdC5yZXBsYWNlKC9bOi5dL2csICctJykgKyAnLnppcCc7XG4gICAgX2Rvd25sb2FkQmxvYihibG9iLCBmaWxlbmFtZSk7XG5cbiAgICBfdXBkYXRlRXhwb3J0UHJvZ3Jlc3MoXG4gICAgICAnRGF0YXNldCBkZXNjYXJnYWRvOiAnICtcbiAgICAgICAgZmlsZW5hbWUgK1xuICAgICAgICAnICgnICtcbiAgICAgICAgT2JqZWN0LmtleXMoY3N2cykubGVuZ3RoICtcbiAgICAgICAgJyBDU1ZzICsgbWFuaWZlc3QuanNvbiknLFxuICAgICAgMTAwXG4gICAgKTtcbiAgICBpZiAodHlwZW9mIHNob3dTeW5jVGFnID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICBjb25zdCB0b3RhbFJvd3MgPSBPYmplY3QudmFsdWVzKHJvd0NvdW50cykucmVkdWNlKChhLCBiKSA9PiBhICsgYiwgMCk7XG4gICAgICBzaG93U3luY1RhZyhcbiAgICAgICAgJ0RhdGFzZXQgZXhwb3J0YWRvOiAnICsgdG90YWxSb3dzICsgJyBmaWxhcyBlbiAnICsgT2JqZWN0LmtleXMoY3N2cykubGVuZ3RoICsgJyBDU1ZzJ1xuICAgICAgKTtcbiAgICB9XG4gICAgc2V0VGltZW91dCgoKSA9PiB3aW5kb3cuY2xvc2VFeHBvcnRGb3JtYXRNb2RhbCgpLCAzMDAwKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGNvbnNvbGUuZXJyb3IoJ1tleHBvcnREYXRhc2V0WmlwXSBmYXRhbDonLCBlKTtcbiAgICBfdXBkYXRlRXhwb3J0UHJvZ3Jlc3MoJ0Vycm9yOiAnICsgKChlICYmIGUubWVzc2FnZSkgfHwgZSksIDApO1xuICAgIGFsZXJ0KFxuICAgICAgJ0Vycm9yIGFsIGV4cG9ydGFyIGVsIGRhdGFzZXQ6XFxuXFxuJyArXG4gICAgICAgICgoZSAmJiBlLm1lc3NhZ2UpIHx8IGUpICtcbiAgICAgICAgJ1xcblxcbkVsIFpJUCBOTyBzZSBkZXNjYXJnbyAoZXZpdGFtb3MgZ2VuZXJhciB1biBhcmNoaXZvIHBhcmNpYWwpLiBSZXZpc2EgbGEgY29uc29sYSBwYXJhIG1hcyBkZXRhbGxlcy4nXG4gICAgKTtcbiAgfVxufTtcblxuLy8gPT09IEV4cG9ydHMgYSB3aW5kb3cgPT09XG4vLyBUb2RhcyBsYXMgZnVuY2lvbmVzIHdpbmRvdy5mb28gPSBmdW5jdGlvbi4uLiB5YSBlc3RcdTAwRTFuIHZlcmJhdGltLlxuaWYgKHR5cGVvZiB3aW5kb3cudG9kYXlTdHIgPT09ICd1bmRlZmluZWQnKSB3aW5kb3cudG9kYXlTdHIgPSB0b2RheVN0cjtcbi8vIEU2IGhvdGZpeCAyOiBkYXRhVXJsVG9CbG9iICsgc2FuaXRpemVGb3JQYXRoIHVzYWRvcyBwb3IgaW5saW5lIHJ1bkZ1bGxCYWNrdXAgKEw3Mjc4LTcyODgpLlxuaWYgKHR5cGVvZiB3aW5kb3cuZGF0YVVybFRvQmxvYiA9PT0gJ3VuZGVmaW5lZCcpIHdpbmRvdy5kYXRhVXJsVG9CbG9iID0gZGF0YVVybFRvQmxvYjtcbmlmICh0eXBlb2Ygd2luZG93LnNhbml0aXplRm9yUGF0aCA9PT0gJ3VuZGVmaW5lZCcpIHdpbmRvdy5zYW5pdGl6ZUZvclBhdGggPSBzYW5pdGl6ZUZvclBhdGg7XG4vLyBFNiBob3RmaXggMzogY3Jvc3MtbW9kdWxlIGJ1ZyAoYXVkaXQgY3Jvc3NidW5kbGUpIFx1MjAxNCBleHBvcnRzLWNvcmUgbGxhbWEgbG9hZEV4Y2VsSlMuXG53aW5kb3cubG9hZEV4Y2VsSlMgPSBsb2FkRXhjZWxKUztcbiJdLAogICJtYXBwaW5ncyI6ICI7OztBQW9DTyxXQUFTLFVBQVUsR0FBRztBQUMzQixRQUFJLE1BQU0sUUFBUSxNQUFNLE9BQVcsUUFBTztBQUMxQyxV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
