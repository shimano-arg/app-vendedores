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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL3B1cmUvY3N2LXNlcmlhbGl6ZXIuanMiLCAiLi4vc3JjL2RvbWFpbnMvZXhwb3J0cy1hZHZhbmNlZC5qcyJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiLy8gQHRzLWNoZWNrXG4vKipcbiAqIENTViBzZXJpYWxpemVyICsgZGF0YXNldCBzY2hlbWFzICsgcm93IGJ1aWxkZXJzIFx1MjAxNCBwYXJhIGV4cG9ydERhdGFzZXRaaXBcbiAqICh2MzcxKykuIEZ1bmNpb25lcyBwdXJhcywgdGVzdGVhYmxlcyBzaW4gZ2xvYmFscyBkZWwgYnVuZGxlLlxuICpcbiAqIDUgY2Fzb3MgZGUgdXNvIE1MIGRvY3VtZW50YWRvcyBlbiBEQVRBU0VUX1VTRV9DQVNFX01BVFJJWDpcbiAqICAgQSkgQ29udmVyc2lvbiB2aXNpdGEtPnBlZGlkbyAocHJpb3JpZGFkIDEsIGNsYXNpZmljYWNpb24pXG4gKiAgIEIpIFJpZXNnbyBkZSBjaHVybiBkZSBjbGllbnRlcyAocHJpb3JpZGFkIDIsIGFsZXJ0YSlcbiAqICAgQykgRm9yZWNhc3QgZGUgZGVtYW5kYSBwb3IgU0tVIChwcmlvcmlkYWQgMywgc2VyaWVzIHRlbXBvcmFsZXMpXG4gKiAgIEQpIEFub21hbGlhcyBlbiByZW5kaWNpb25lcyAoZXhwbG9yYXRvcmlvKVxuICogICBFKSBFc3RhY2lvbmFsaWRhZCBwb3Igem9uYS9jYW1wYW5hIChleHBsb3JhdG9yaW8pXG4gKlxuICogQ29udmVuY2lvbmVzIChSRkMgNDE4MCArIGFkYXB0YWNpb25lcyBwYXJhIE1MIHBpcGVsaW5lcyk6XG4gKiAgIC0gU2VwYXJhdG9yOiBcIixcIlxuICogICAtIFF1b3RlIGNoYXI6IFwiXFxcIlwiXG4gKiAgIC0gRXNjYXBlIHF1b3RlOiBcIlxcXCJcXFwiXCJcbiAqICAgLSBMaW5lIHRlcm1pbmF0b3I6IFwiXFxyXFxuXCJcbiAqICAgLSBFbmNvZGluZzogVVRGLTggKEJPTSBvcGNpb25hbCBhbCBlc2NyaWJpciBlbCBaSVApXG4gKiAgIC0gRmVjaGFzOiBJU08gODYwMSBVVEMgKGNvbiBcIlpcIiBhbCBmaW5hbClcbiAqICAgLSBEZWNpbWFsZXM6IHB1bnRvIChcIi5cIilcbiAqICAgLSBOdWxsL3VuZGVmaW5lZDogY2FtcG8gdmFjaW8gKE5PIFwiTi9BXCIsIFwiLVwiLCBcIm51bGxcIilcbiAqICAgLSBBcnJheXMgLT4gSlNPTi5zdHJpbmdpZnkgZW50cmUgY29taWxsYXMgZG9ibGVzXG4gKiAgIC0gT2JqZXRvcyAoZXhjZXB0byBUaW1lc3RhbXAgeSBEYXRlKSAtPiBKU09OLnN0cmluZ2lmeVxuICogICAtIEZpcmVzdG9yZSBUaW1lc3RhbXBzIC0+IHRvRGF0ZSgpLnRvSVNPU3RyaW5nKClcbiAqL1xuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIEhlbHBlcnMgQ1NWIHB1cm9zXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuLyoqXG4gKiBFc2NhcGEgdW4gdmFsb3Igc3RyaW5nIHBhcmEgQ1NWIFJGQyA0MTgwLiBXcmFwcGVhIGNvbiBcIi4uLlwiIHNpIGNvbnRpZW5lXG4gKiBcIixcIiwgXCJcXFwiXCIsIFwiXFxyXCIgbyBcIlxcblwiLiBFc2NhcGEgXCJcXFwiXCIgLT4gXCJcXFwiXFxcIlwiLlxuICogQHBhcmFtIHtzdHJpbmd9IHNcbiAqIEByZXR1cm5zIHtzdHJpbmd9XG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjc3ZFc2NhcGUocykge1xuICBpZiAocyA9PT0gbnVsbCB8fCBzID09PSB1bmRlZmluZWQpIHJldHVybiAnJztcbiAgY29uc3Qgc3RyID0gU3RyaW5nKHMpO1xuICBpZiAoc3RyID09PSAnJykgcmV0dXJuICcnO1xuICAvLyBOZWNlc2l0YSBxdW90aW5nIHNpIHRpZW5lIGNvbWEsIHF1b3RlLCBvIGxpbmUtYnJlYWtcbiAgaWYgKC9bXCIsXFxyXFxuXS8udGVzdChzdHIpKSB7XG4gICAgcmV0dXJuICdcIicgKyBzdHIucmVwbGFjZSgvXCIvZywgJ1wiXCInKSArICdcIic7XG4gIH1cbiAgcmV0dXJuIHN0cjtcbn1cblxuLyoqXG4gKiBDb252aWVydGUgdW4gYXJyYXkgZGUgdmFsb3JlcyBlbiB1bmEgbGluZWEgQ1NWIChzaW4gdHJhaWxpbmcgbmV3bGluZSkuXG4gKiBBcGxpY2EgY3N2RXNjYXBlIGEgY2FkYSBjYW1wbyBkZXNwdWVzIGRlIGZpcmVzdG9yZVZhbHVlVG9Dc3YuXG4gKiBAcGFyYW0ge3Vua25vd25bXX0gZmllbGRzXG4gKiBAcmV0dXJucyB7c3RyaW5nfVxuICovXG5leHBvcnQgZnVuY3Rpb24gY3N2Um93KGZpZWxkcykge1xuICByZXR1cm4gZmllbGRzLm1hcCgoZikgPT4gY3N2RXNjYXBlKGZpcmVzdG9yZVZhbHVlVG9Dc3YoZikpKS5qb2luKCcsJyk7XG59XG5cbi8qKlxuICogQ29udmllcnRlIHVuIHZhbG9yIGRlIEZpcmVzdG9yZS9KUyBhIHN0cmluZyBhcHRvIHBhcmEgQ1NWLlxuICogUmVnbGEgcG9yIHRpcG86XG4gKiAgIC0gbnVsbCAvIHVuZGVmaW5lZCAtPiAnJ1xuICogICAtIEZpcmVzdG9yZSBUaW1lc3RhbXAgKHRpZW5lIC50b0RhdGUpIC0+IElTTyA4NjAxIFVUQ1xuICogICAtIERhdGUgLT4gSVNPIDg2MDEgVVRDXG4gKiAgIC0gYm9vbGVhbiAtPiAndHJ1ZScgLyAnZmFsc2UnXG4gKiAgIC0gbnVtYmVyIC0+IFN0cmluZyhuKSBjb24gcHVudG8gZGVjaW1hbFxuICogICAtIHN0cmluZyAtPiB0YWwgY3VhbCAoY3N2RXNjYXBlIHdyYXBwZWEgc2kgaGFjZSBmYWx0YSlcbiAqICAgLSBBcnJheSAtPiBKU09OLnN0cmluZ2lmeVxuICogICAtIE9iamVjdCAtPiBKU09OLnN0cmluZ2lmeVxuICogQHBhcmFtIHt1bmtub3dufSB2XG4gKiBAcmV0dXJucyB7c3RyaW5nfVxuICovXG5leHBvcnQgZnVuY3Rpb24gZmlyZXN0b3JlVmFsdWVUb0Nzdih2KSB7XG4gIGlmICh2ID09PSBudWxsIHx8IHYgPT09IHVuZGVmaW5lZCkgcmV0dXJuICcnO1xuICBpZiAodHlwZW9mIHYgPT09ICdzdHJpbmcnKSByZXR1cm4gdjtcbiAgaWYgKHR5cGVvZiB2ID09PSAnbnVtYmVyJykge1xuICAgIGlmICghTnVtYmVyLmlzRmluaXRlKHYpKSByZXR1cm4gJyc7IC8vIE5hTiwgSW5maW5pdHkgLT4gdmFjaW8gKG5vIGNvbmZ1bmRpciBwaXBlbGluZXMpXG4gICAgcmV0dXJuIFN0cmluZyh2KTtcbiAgfVxuICBpZiAodHlwZW9mIHYgPT09ICdib29sZWFuJykgcmV0dXJuIHYgPyAndHJ1ZScgOiAnZmFsc2UnO1xuICAvLyBGaXJlc3RvcmUgVGltZXN0YW1wXG4gIGlmIChcbiAgICB0eXBlb2YgdiA9PT0gJ29iamVjdCcgJiZcbiAgICB2ICE9PSBudWxsICYmXG4gICAgdHlwZW9mICgvKiogQHR5cGUge2FueX0gKi8gKHYpLnRvRGF0ZSkgPT09ICdmdW5jdGlvbidcbiAgKSB7XG4gICAgdHJ5IHtcbiAgICAgIHJldHVybiAvKiogQHR5cGUge2FueX0gKi8gKHYpLnRvRGF0ZSgpLnRvSVNPU3RyaW5nKCk7XG4gICAgfSBjYXRjaCAoXykge1xuICAgICAgcmV0dXJuICcnO1xuICAgIH1cbiAgfVxuICBpZiAodiBpbnN0YW5jZW9mIERhdGUpIHtcbiAgICBpZiAoTnVtYmVyLmlzTmFOKHYuZ2V0VGltZSgpKSkgcmV0dXJuICcnO1xuICAgIHJldHVybiB2LnRvSVNPU3RyaW5nKCk7XG4gIH1cbiAgaWYgKEFycmF5LmlzQXJyYXkodikpIHtcbiAgICAvLyBKU09OLnN0cmluZ2lmeSBkZSBhcnJheS4gY3N2RXNjYXBlIGx1ZWdvIGxvIHdyYXBwZWEgc2kgaGF5IGNvbWFzLlxuICAgIHRyeSB7XG4gICAgICByZXR1cm4gSlNPTi5zdHJpbmdpZnkodik7XG4gICAgfSBjYXRjaCAoXykge1xuICAgICAgcmV0dXJuICcnO1xuICAgIH1cbiAgfVxuICBpZiAodHlwZW9mIHYgPT09ICdvYmplY3QnKSB7XG4gICAgdHJ5IHtcbiAgICAgIHJldHVybiBKU09OLnN0cmluZ2lmeSh2KTtcbiAgICB9IGNhdGNoIChfKSB7XG4gICAgICByZXR1cm4gJyc7XG4gICAgfVxuICB9XG4gIHJldHVybiBTdHJpbmcodik7XG59XG5cbi8qKlxuICogT2J0aWVuZSBlbCB2YWxvciBkZSB1biBwYXRoIGRvdC1ub3RhdGlvbiBlbiB1biBvYmpldG8gYW5pZGFkby5cbiAqIEVqOiBnZXRQYXRoKHthOiB7Yjoge2M6IDF9fX0sICdhLmIuYycpIC0+IDFcbiAqIGdldFBhdGgoe30sICdhLmInKSAtPiB1bmRlZmluZWRcbiAqIEBwYXJhbSB7b2JqZWN0fSBvYmpcbiAqIEBwYXJhbSB7c3RyaW5nfSBwYXRoXG4gKiBAcmV0dXJucyB7dW5rbm93bn1cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGdldFBhdGgob2JqLCBwYXRoKSB7XG4gIGlmICghb2JqIHx8ICFwYXRoKSByZXR1cm4gdW5kZWZpbmVkO1xuICBjb25zdCBwYXJ0cyA9IHBhdGguc3BsaXQoJy4nKTtcbiAgbGV0IGN1ciA9IC8qKiBAdHlwZSB7YW55fSAqLyAob2JqKTtcbiAgZm9yIChjb25zdCBwIG9mIHBhcnRzKSB7XG4gICAgaWYgKGN1ciA9PT0gbnVsbCB8fCBjdXIgPT09IHVuZGVmaW5lZCkgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICBjdXIgPSBjdXJbcF07XG4gIH1cbiAgcmV0dXJuIGN1cjtcbn1cblxuLyoqXG4gKiBDb25zdHJ1eWUgZWwgQ1NWIGNvbXBsZXRvIChoZWFkZXIgKyBOIHJvd3MpIHBhcmEgdW5hIGNvbGVjY2lvbiBzZWd1blxuICogc3Ugc2NoZW1hLiBDYWRhIGJ1aWxkZXIgZGV2dWVsdmUgdW4gYXJyYXkgZGUgZmlsYXMgKGNhZGEgZmlsYSA9IGFycmF5XG4gKiBkZSB2YWxvcmVzIGVuIGVsIG9yZGVuIGRlbCBzY2hlbWEpLlxuICogQHBhcmFtIHt7Y29sdW1uczoge2NvbDogc3RyaW5nfVtdfX0gc2NoZW1hXG4gKiBAcGFyYW0ge3Vua25vd25bXVtdfSByb3dzXG4gKiBAcmV0dXJucyB7c3RyaW5nfSBDU1YgY29tcGxldG8gY29uIFxcclxcbiBjb21vIGxpbmUgc2VwYXJhdG9yXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBidWlsZENzdihzY2hlbWEsIHJvd3MpIHtcbiAgY29uc3QgaGVhZGVyID0gc2NoZW1hLmNvbHVtbnMubWFwKChjKSA9PiBjc3ZFc2NhcGUoYy5jb2wpKS5qb2luKCcsJyk7XG4gIGNvbnN0IGJvZHkgPSByb3dzLm1hcCgocikgPT4gY3N2Um93KHIpKS5qb2luKCdcXHJcXG4nKTtcbiAgcmV0dXJuIGJvZHkubGVuZ3RoID8gaGVhZGVyICsgJ1xcclxcbicgKyBib2R5ICsgJ1xcclxcbicgOiBoZWFkZXIgKyAnXFxyXFxuJztcbn1cblxuLyoqXG4gKiBDdWVudGEgbnVsbCByYXRlIHBvciBjb2x1bW5hIHJlcXVlcmlkYS4gUmV0b3JuYVxuICoge2NvbE5hbWU6IHJhdGUgMC4uMX0uIFVuIHZhbG9yIGVzIFwibnVsbFwiIHNpIGZpcmVzdG9yZVZhbHVlVG9Dc3YgZGV2dWVsdmUgJycuXG4gKiBAcGFyYW0ge3tjb2x1bW5zOiB7Y29sOiBzdHJpbmd9W119fSBzY2hlbWFcbiAqIEBwYXJhbSB7dW5rbm93bltdW119IHJvd3NcbiAqIEBwYXJhbSB7c3RyaW5nW119IHJlcXVpcmVkQ29sc1xuICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIG51bWJlcj59XG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjb21wdXRlTnVsbFJhdGVzKHNjaGVtYSwgcm93cywgcmVxdWlyZWRDb2xzKSB7XG4gIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgbnVtYmVyPn0gKi9cbiAgY29uc3QgcmVzdWx0ID0ge307XG4gIGlmICghcm93cy5sZW5ndGgpIHtcbiAgICAvLyBzaW4gZGF0b3M6IG51bGwgcmF0ZSA9IDEgKDEwMCUgZmFsdGEpIHBhcmEgY2FkYSBjYW1wbyByZXF1ZXJpZG9cbiAgICBmb3IgKGNvbnN0IGMgb2YgcmVxdWlyZWRDb2xzKSByZXN1bHRbY10gPSAxO1xuICAgIHJldHVybiByZXN1bHQ7XG4gIH1cbiAgY29uc3QgY29sSW5kZXggPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIG51bWJlcj59ICovICh7fSk7XG4gIHNjaGVtYS5jb2x1bW5zLmZvckVhY2goKGMsIGkpID0+IHtcbiAgICBjb2xJbmRleFtjLmNvbF0gPSBpO1xuICB9KTtcbiAgZm9yIChjb25zdCByYyBvZiByZXF1aXJlZENvbHMpIHtcbiAgICBjb25zdCBpZHggPSBjb2xJbmRleFtyY107XG4gICAgaWYgKGlkeCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICByZXN1bHRbcmNdID0gMTsgLy8gY29sdW1uYSBubyBleGlzdGUgZW4gc2NoZW1hIC0+IGNvbnNpZGVyYXIgY29tbyAxMDAlIG51bGxcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBsZXQgbnVsbHMgPSAwO1xuICAgIGZvciAoY29uc3Qgcm93IG9mIHJvd3MpIHtcbiAgICAgIGNvbnN0IHYgPSByb3dbaWR4XTtcbiAgICAgIGlmIChmaXJlc3RvcmVWYWx1ZVRvQ3N2KHYpID09PSAnJykgbnVsbHMrKztcbiAgICB9XG4gICAgcmVzdWx0W3JjXSA9IE1hdGgucm91bmQoKG51bGxzIC8gcm93cy5sZW5ndGgpICogMTAwMDApIC8gMTAwMDA7XG4gIH1cbiAgcmV0dXJuIHJlc3VsdDtcbn1cblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBEQVRBU0VUX1NDSEVNQVMgXHUyMDE0IDExIGNvbGVjY2lvbmVzIGNvbiBjb2x1bW5hcyArIHRpcG9zICsgZGVzY3JpcGNpb25lc1xuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbi8qKiBAdHlwZWRlZiB7e2NvbDogc3RyaW5nLCB0eXBlOiBzdHJpbmcsIGRlc2M6IHN0cmluZ319IFNjaGVtYUNvbHVtbiAqL1xuLyoqIEB0eXBlZGVmIHt7bmFtZTogc3RyaW5nLCBzb3VyY2U6ICdmaXJlc3RvcmUnfCdzdG9ja19qc29uJywgY29sbGVjdGlvbj86IHN0cmluZywgcm93TW9kZTogc3RyaW5nLCBjb2x1bW5zOiBTY2hlbWFDb2x1bW5bXX19IERhdGFzZXRTY2hlbWEgKi9cblxuLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBEYXRhc2V0U2NoZW1hPn0gKi9cbmV4cG9ydCBjb25zdCBEQVRBU0VUX1NDSEVNQVMgPSB7XG4gIHBlZGlkb3M6IHtcbiAgICBuYW1lOiAncGVkaWRvcy5jc3YnLFxuICAgIHNvdXJjZTogJ2ZpcmVzdG9yZScsXG4gICAgY29sbGVjdGlvbjogJ3BlZGlkb3MnLFxuICAgIHJvd01vZGU6ICdmbGF0dGVuX2xpbmVzJywgLy8gMSBmaWxhIHBvciAocGVkaWRvLCBsaW5lYSlcbiAgICBjb2x1bW5zOiBbXG4gICAgICB7IGNvbDogJ3BlZGlkb19pZCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnRmlyZXN0b3JlIGRvYyBJRCcgfSxcbiAgICAgIHsgY29sOiAnb3duZXJfdWlkJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdVSUQgZGVsIHZlbmRlZG9yIGR1ZW5pbyBkZWwgcGVkaWRvJyB9LFxuICAgICAgeyBjb2w6ICdvd25lcl9lbWFpbCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnZW1haWwgZGVsIHZlbmRlZG9yJyB9LFxuICAgICAgeyBjb2w6ICdjcmVhdGVkX2J5X3VpZCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAncXVpZW4gY2FyZ28gKFZESSBwdWVkZSBjYXJnYXIgcG9yIFZERSknIH0sXG4gICAgICB7IGNvbDogJ29uX2JlaGFsZl9vZicsIHR5cGU6ICdib29sZWFuJywgZGVzYzogJ3RydWUgc2kgVkRJIGNhcmdvIHBvciBWREUnIH0sXG4gICAgICB7IGNvbDogJ2tleScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnY2xhdmUgY29tcHVlc3RhIHRpcG98cHJvdnxsb2N8Y2xpZW50ZScgfSxcbiAgICAgIHsgY29sOiAnc3RhZ2UnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ3BlbmRpbmcgfCBjb25maXJtZWQgfCBzYXBfaW1wb3J0ZWQnIH0sXG4gICAgICB7IGNvbDogJ3RpcG8nLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ0M9Y2xpZW50ZSB8IFA9cHJvc3BlY3RvJyB9LFxuICAgICAgeyBjb2w6ICdwcm92aW5jZScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAncHJvdmluY2lhJyB9LFxuICAgICAgeyBjb2w6ICdsb2NfbmFtZScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnbG9jYWxpZGFkJyB9LFxuICAgICAgeyBjb2w6ICdjbGllbnRfbmFtZScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnbm9tYnJlIGNsaWVudGUnIH0sXG4gICAgICB7IGNvbDogJ21vbnRoJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdlaiBcIkp1bGlvIDIwMjZcIicgfSxcbiAgICAgIHsgY29sOiAnbW9udGhfaWR4JywgdHlwZTogJ2ludCcsIGRlc2M6ICcwLTExJyB9LFxuICAgICAgeyBjb2w6ICd5ZWFyJywgdHlwZTogJ2ludCcsIGRlc2M6ICdhbm8nIH0sXG4gICAgICB7IGNvbDogJ2NvbmZpcm1lZF9hdCcsIHR5cGU6ICdpc284NjAxJywgZGVzYzogJ3RpbWVzdGFtcCBVVEMgZGUgY29uZmlybWFjaW9uJyB9LFxuICAgICAgeyBjb2w6ICdjb25kaWNpb25fcGFnbycsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnZWogQ1RBIENURScgfSxcbiAgICAgIHsgY29sOiAnZm9ybWFfZW50cmVnYV90aXBvJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdUUkFOU1BPUlRJU1RBIHwgU1VDVVJTQUwnIH0sXG4gICAgICB7IGNvbDogJ2Zvcm1hX2VudHJlZ2FfdHJhbnNwX25vbWJyZScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJyB9LFxuICAgICAgeyBjb2w6ICdmb3JtYV9lbnRyZWdhX3RyYW5zcF9kaXJlY2Npb24nLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcbiAgICAgIHsgY29sOiAnZm9ybWFfZW50cmVnYV9jbGllbnRlX2RpcmVjY2lvbicsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnZGVzdGlubyBmaW5hbCcgfSxcbiAgICAgIHsgY29sOiAnZm9ybWFfZW50cmVnYV9zdWN1cnNhbF9kaXJlY2Npb24nLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcbiAgICAgIHtcbiAgICAgICAgY29sOiAnZGlzY291bnRfcGN0JyxcbiAgICAgICAgdHlwZTogJ251bWJlcicsXG4gICAgICAgIGRlc2M6ICdkZXNjdWVudG8gdG90YWwgZGVsIHBlZGlkbyAoYXBsaWNhZG8gYSBuaXZlbCBoZWFkZXIsIHByb3JyYXRlYXIgZW4gcGlwZWxpbmUpJyxcbiAgICAgIH0sXG4gICAgICB7IGNvbDogJ3N1YnRvdGFsX2FycycsIHR5cGU6ICdudW1iZXInLCBkZXNjOiAnc3VidG90YWwgYnJ1dG8gQVJTJyB9LFxuICAgICAgeyBjb2w6ICduZXRfYW1vdW50X2FycycsIHR5cGU6ICdudW1iZXInLCBkZXNjOiAnbmV0byBBUlMgcG9zdC1kZXNjdWVudG8nIH0sXG4gICAgICB7IGNvbDogJ3RyYW5zZmVyaWRvX3NhcF92aWEnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ2R0d19tYW51YWwgfCBzZXJ2aWNlX2xheWVyJyB9LFxuICAgICAgeyBjb2w6ICd0cmFuc2Zlcmlkb19zYXBfZG9jX251bScsIHR5cGU6ICdpbnQnLCBkZXNjOiAnbnVtZXJvIGRlIFF1b3RhdGlvbiBTQVAnIH0sXG4gICAgICB7IGNvbDogJ3RyYW5zZmVyaWRvX3NhcF9kb2NfZW50cnknLCB0eXBlOiAnaW50JywgZGVzYzogJ2RvYyBlbnRyeSBpbnRlcm5vIFNBUCcgfSxcbiAgICAgIHsgY29sOiAndHJhbnNmZXJpZG9fc2FwX2F0JywgdHlwZTogJ2lzbzg2MDEnLCBkZXNjOiAndGltZXN0YW1wIFVUQycgfSxcbiAgICAgIHsgY29sOiAnY3JlYXRlZF9hdCcsIHR5cGU6ICdpc284NjAxJywgZGVzYzogJ3RpbWVzdGFtcCBVVEMnIH0sXG4gICAgICB7IGNvbDogJ2xpbmVfaW5kZXgnLCB0eXBlOiAnaW50JywgZGVzYzogJ2luZGljZSBkZSBsaW5lYSAwLWJhc2VkJyB9LFxuICAgICAgeyBjb2w6ICdsaW5lX2NvZGUnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ1NLVScgfSxcbiAgICAgIHsgY29sOiAnbGluZV9kZXNjJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdkZXNjcmlwY2lvbiBwcm9kdWN0bycgfSxcbiAgICAgIHsgY29sOiAnbGluZV9xdHknLCB0eXBlOiAnbnVtYmVyJywgZGVzYzogJ2NhbnRpZGFkJyB9LFxuICAgICAgeyBjb2w6ICdsaW5lX3ByZWNpbycsIHR5cGU6ICdudW1iZXInLCBkZXNjOiAncHJlY2lvIHVuaXRhcmlvIEFSUycgfSxcbiAgICAgIHsgY29sOiAnbGluZV9jYXQnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ2NhdGVnb3JpYScgfSxcbiAgICAgIHsgY29sOiAnbGluZV9mYW0nLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ2ZhbWlsaWEnIH0sXG4gICAgICB7IGNvbDogJ2xpbmVfc3ViJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdzdWJmYW1pbGlhJyB9LFxuICAgIF0sXG4gIH0sXG4gIHZpc2l0YXM6IHtcbiAgICBuYW1lOiAndmlzaXRhcy5jc3YnLFxuICAgIHNvdXJjZTogJ2ZpcmVzdG9yZScsXG4gICAgY29sbGVjdGlvbjogJ3Zpc2l0cycsXG4gICAgcm93TW9kZTogJ29uZV9wZXJfZG9jJyxcbiAgICBjb2x1bW5zOiBbXG4gICAgICB7IGNvbDogJ3Zpc2l0X2lkJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdGaXJlc3RvcmUgZG9jIElEJyB9LFxuICAgICAgeyBjb2w6ICdvd25lcl91aWQnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ1VJRCBkZWwgdmVuZGVkb3InIH0sXG4gICAgICB7IGNvbDogJ293bmVyX2VtYWlsJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdlbWFpbCBkZWwgdmVuZGVkb3InIH0sXG4gICAgICB7IGNvbDogJ2ZlY2hhJywgdHlwZTogJ2lzbzg2MDEnLCBkZXNjOiAnWVlZWS1NTS1ERCAoZmVjaGEgZGUgdmlzaXRhLCBubyBVVEMpJyB9LFxuICAgICAgeyBjb2w6ICdtZXMnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ0pVTklPLCBKVUxJTywgZXRjLicgfSxcbiAgICAgIHsgY29sOiAnYW5pbycsIHR5cGU6ICdpbnQnLCBkZXNjOiAnYW5vJyB9LFxuICAgICAgeyBjb2w6ICd2ZW5kb3InLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ25vbWJyZSBjYW5vbmljbyB2ZW5kZWRvcicgfSxcbiAgICAgIHsgY29sOiAncHJvdmluY2lhJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdwcm92aW5jaWEnIH0sXG4gICAgICB7IGNvbDogJ2xvY2FsaWRhZCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnbG9jYWxpZGFkJyB9LFxuICAgICAgeyBjb2w6ICd0aWVuZGEnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ25vbWJyZSB0aWVuZGEnIH0sXG4gICAgICB7IGNvbDogJ3RpcG8nLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ0MgfCBQJyB9LFxuICAgICAgeyBjb2w6ICdsb2NhbCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnZWogUHJvcGlvLCBBbHF1aWxhZG8nIH0sXG4gICAgICB7IGNvbDogJ3RhbWFubycsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnZWogQ2hpY28sIE1lZGlhbm8sIEdyYW5kZScgfSxcbiAgICAgIHsgY29sOiAnZmlkZWxpZGFkJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdBbHRhLCBNZWRpYSwgQmFqYScgfSxcbiAgICAgIHsgY29sOiAncmVsZXZhbmNpYScsIHR5cGU6ICdpbnQnLCBkZXNjOiAnMC01JyB9LFxuICAgICAgeyBjb2w6ICdwb3AnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ2VqIFN0aWNrZXJzIFNoaW1hbm8nIH0sXG4gICAgICB7IGNvbDogJ25lY2VzaWRhZF9wdW50dWFsJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXG4gICAgICB7IGNvbDogJ3RpcG9fdmVudGEnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ2VqIENhc2EgZGUgcGVzY2EgKyBlY29tbWVyY2UnIH0sXG4gICAgICB7IGNvbDogJ3BvbmRlcmFjaW9uX21vc3RyYWRvJywgdHlwZTogJ2ludCcsIGRlc2M6ICcwLTEwMCcgfSxcbiAgICAgIHsgY29sOiAncG9uZGVyYWNpb25fZWNvbW1lcmNlJywgdHlwZTogJ2ludCcsIGRlc2M6ICcwLTEwMCcgfSxcbiAgICAgIHsgY29sOiAnY29tcGV0ZW5jaWEnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcbiAgICAgIHsgY29sOiAnb3BvcnR1bmlkYWQnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcbiAgICAgIHsgY29sOiAnbWFzX3ZlbmRpZG8nLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcbiAgICAgIHsgY29sOiAnbWFzX3ByZWd1bnRhbicsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJyB9LFxuICAgICAgeyBjb2w6ICdheXVkYV90aWVuZGEnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcbiAgICAgIHsgY29sOiAnZ3BzX3N0YXR1cycsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnb2sgfCBvdXRzaWRlIHwgbm9sb2MnIH0sXG4gICAgICB7IGNvbDogJ2dwc19kaXN0YW5jZV9tJywgdHlwZTogJ251bWJlcicsIGRlc2M6ICdtZXRyb3MnIH0sXG4gICAgICB7IGNvbDogJ2ludGVyYWN0aW9uX3R5cGUnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ3Zpc2l0YSB8IGNvbnRhY3RvJyB9LFxuICAgICAge1xuICAgICAgICBjb2w6ICdmb3JtYV9jb250YWN0bycsXG4gICAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgICBkZXNjOiAnTExBTUFEQSBURUxFRk9OSUNBIHwgTUVOU0FKRSBERSBXSEFUU0FQUCB8IE1FTlNBSkUgU01TIChzaSBjb250YWN0byknLFxuICAgICAgfSxcbiAgICAgIHtcbiAgICAgICAgY29sOiAnY29udGFjdG9fcmVzdWx0YWRvJyxcbiAgICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICAgIGRlc2M6ICdyZXNwb25kaW8gfCBub19yZXNwb25kaW8gfCB2YWNpbyAoc2luIG1hcmNhciwgc29sbyBhcGxpY2EgYSBjb250YWN0byknLFxuICAgICAgfSxcbiAgICAgIHsgY29sOiAnY29udGFjdG9fcmVzdWx0YWRvX2F0JywgdHlwZTogJ2lzbzg2MDEnLCBkZXNjOiAndGltZXN0YW1wIFVUQycgfSxcbiAgICAgIHsgY29sOiAnY29udGFjdG9fcmVzdWx0YWRvX2J5JywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdVSUQgZGUgcXVpZW4gbWFyY28nIH0sXG4gICAgICB7IGNvbDogJ2NyZWF0ZWRfYXQnLCB0eXBlOiAnaXNvODYwMScsIGRlc2M6ICd0aW1lc3RhbXAgVVRDJyB9LFxuICAgIF0sXG4gIH0sXG4gIGNsaWVudGVzOiB7XG4gICAgbmFtZTogJ2NsaWVudGVzLmNzdicsXG4gICAgc291cmNlOiAnZmlyZXN0b3JlJyxcbiAgICBjb2xsZWN0aW9uOiAnY2xpZW50X2FwcGxpY2F0aW9ucycsXG4gICAgcm93TW9kZTogJ29uZV9wZXJfZG9jJyxcbiAgICBjb2x1bW5zOiBbXG4gICAgICB7IGNvbDogJ2FwcF9pZCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnRmlyZXN0b3JlIGRvYyBJRCcgfSxcbiAgICAgIHsgY29sOiAnb3duZXJfdWlkJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXG4gICAgICB7IGNvbDogJ293bmVyX2VtYWlsJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXG4gICAgICB7IGNvbDogJ293bmVyX25hbWUnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcbiAgICAgIHsgY29sOiAnY29tZXJjaW8nLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ3Jhem9uIHNvY2lhbCcgfSxcbiAgICAgIHsgY29sOiAnZmFudGFzaWEnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ25vbWJyZSBjb21lcmNpYWwnIH0sXG4gICAgICB7IGNvbDogJ2N1aXQnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ3NvbG8gZGlnaXRvcyBwb3N0LXYyOTQnIH0sXG4gICAgICB7IGNvbDogJ2NvbmRpY2lvbl9maXNjYWwnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcbiAgICAgIHsgY29sOiAnY2FsbGUnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcbiAgICAgIHsgY29sOiAnbnVtZXJvJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXG4gICAgICB7IGNvbDogJ2xvY2FsaWRhZCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJyB9LFxuICAgICAgeyBjb2w6ICdwcm92aW5jaWEnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcbiAgICAgIHsgY29sOiAnbG9jYWxpZGFkX2ZpbmFsJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdvdmVycmlkZSBkZWwgYXByb2JhZG9yJyB9LFxuICAgICAgeyBjb2w6ICdjYXJkX2NvZGVfc2FwJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdDYXJkQ29kZSBTQVAnIH0sXG4gICAgICB7IGNvbDogJ2Fzc2lnbmVkX3ZlbmRvcicsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAndmVuZGVkb3IgYXNpZ25hZG8gKHNvdXJjZSBvZiB0cnV0aCB2MzExKyknIH0sXG4gICAgICB7IGNvbDogJ3N0YXR1cycsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAncGVuZGluZ19hcHByb3ZhbCB8IGFwcHJvdmVkIHwgcmVqZWN0ZWQnIH0sXG4gICAgICB7XG4gICAgICAgIGNvbDogJ3NvdXJjZScsXG4gICAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgICBkZXNjOiAnbWFudWFsIHwgc2FwX2J1bGtfaW1wb3J0IHwgYWx0YV9yYXBpZGEgfCBzYXBfc3luYyB8IHNhcF9zeW5jX21hbnVhbF9saW5rJyxcbiAgICAgIH0sXG4gICAgICB7XG4gICAgICAgIGNvbDogJ21hbnVhbF9zYXBfcGVuZGluZycsXG4gICAgICAgIHR5cGU6ICdib29sZWFuJyxcbiAgICAgICAgZGVzYzogJ3RydWU9cHJvdmlzb3JpbyAoQWx0YSBSYXBpZGEgc2luIENhcmRDb2RlKScsXG4gICAgICB9LFxuICAgICAgeyBjb2w6ICdwcmVjYXVjaW9uJywgdHlwZTogJ2Jvb2xlYW4nLCBkZXNjOiAndHJ1ZT1jbGllbnRlIG1hcmNhZG8gcG9yIGltcGFnbycgfSxcbiAgICAgIHsgY29sOiAnY2F0ZWdvcmlhX2NsaWVudGUnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ1AvQS9CL0MnIH0sXG4gICAgICB7IGNvbDogJ2NsaV90aXBvJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdDIGRlZmF1bHQgcG9zdC12MzQ5JyB9LFxuICAgICAgeyBjb2w6ICdsYXQnLCB0eXBlOiAnbnVtYmVyJywgZGVzYzogJ2dlb2xhdCcgfSxcbiAgICAgIHsgY29sOiAnbG5nJywgdHlwZTogJ251bWJlcicsIGRlc2M6ICdnZW9sbmcnIH0sXG4gICAgICB7IGNvbDogJ2hhc19nZW8nLCB0eXBlOiAnYm9vbGVhbicsIGRlc2M6ICdsYXQvbG5nIG5vIG51bGwnIH0sXG4gICAgICB7IGNvbDogJ2hhc19hZGRyZXNzJywgdHlwZTogJ2Jvb2xlYW4nLCBkZXNjOiAnY2FsbGUgbm8gdmFjaWEnIH0sXG4gICAgICB7IGNvbDogJ3N1Ym1pdHRlZF9ieV9wdWJsaWNfZm9ybScsIHR5cGU6ICdib29sZWFuJywgZGVzYzogJ3ZpYSBhbHRhLWNsaWVudGUuaHRtbCcgfSxcbiAgICAgIHsgY29sOiAnYXBwcm92ZWRfYXQnLCB0eXBlOiAnaXNvODYwMScsIGRlc2M6ICcnIH0sXG4gICAgICB7IGNvbDogJ2NyZWF0ZWRfYXQnLCB0eXBlOiAnaXNvODYwMScsIGRlc2M6ICcnIH0sXG4gICAgICB7IGNvbDogJ3VwZGF0ZWRfYXQnLCB0eXBlOiAnaXNvODYwMScsIGRlc2M6ICcnIH0sXG4gICAgXSxcbiAgfSxcbiAgY2xpZW50X21hc3Rlcjoge1xuICAgIG5hbWU6ICdjbGllbnRfbWFzdGVyLmNzdicsXG4gICAgc291cmNlOiAnZmlyZXN0b3JlJyxcbiAgICBjb2xsZWN0aW9uOiAnY2xpZW50X21hc3RlcicsXG4gICAgcm93TW9kZTogJ29uZV9wZXJfZG9jJyxcbiAgICBjb2x1bW5zOiBbXG4gICAgICB7IGNvbDogJ21hc3Rlcl9pZCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnRmlyZXN0b3JlIGRvYyBJRCcgfSxcbiAgICAgIHsgY29sOiAnY2xpZW50X25hbWUnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcbiAgICAgIHsgY29sOiAncHJvdmluY2lhJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXG4gICAgICB7IGNvbDogJ2xvY2FsaWRhZCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJyB9LFxuICAgICAgeyBjb2w6ICd2ZW5kb3InLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ3ZlbmRlZG9yIGN1cmFkbyBhZG1pbicgfSxcbiAgICAgIHsgY29sOiAnYWRkcmVzcycsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnZGlyZWNjaW9uIGN1cmFkYSBhZG1pbicgfSxcbiAgICAgIHsgY29sOiAnc2FwX2NhcmRfY29kZScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnQ2FyZENvZGUgU0FQJyB9LFxuICAgICAgeyBjb2w6ICdzYXBfYWRkcmVzcycsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnZGlyZWNjaW9uIHJhdyBTQVAnIH0sXG4gICAgICB7IGNvbDogJ3NhcF9jaXR5JywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXG4gICAgICB7IGNvbDogJ3NhcF9zdGF0ZScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJyB9LFxuICAgICAgeyBjb2w6ICdzYXBfaW1wb3J0ZWRfYXQnLCB0eXBlOiAnaXNvODYwMScsIGRlc2M6ICcnIH0sXG4gICAgICB7IGNvbDogJ3NhcF9pbXBvcnRlZF9ieScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJyB9LFxuICAgICAgeyBjb2w6ICdjbGllbnRfbmFtZV9vcmlnaW5hbCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnYmFja3VwIG5vbWJyZSBwcmUtaW1wb3J0JyB9LFxuICAgICAgeyBjb2w6ICdsb2NhbGlkYWRfb3JpZ2luYWwnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ2JhY2t1cCBsb2NhbGlkYWQgcHJlLWltcG9ydCcgfSxcbiAgICAgIHsgY29sOiAnbWF0Y2hfdHlwZScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnZXhhY3QgfCBmdXp6eScgfSxcbiAgICAgIHsgY29sOiAnbWF0Y2hfc2ltaWxhcml0eScsIHR5cGU6ICdudW1iZXInLCBkZXNjOiAnMC0xJyB9LFxuICAgICAgeyBjb2w6ICd1cGRhdGVkX2F0JywgdHlwZTogJ2lzbzg2MDEnLCBkZXNjOiAnJyB9LFxuICAgICAgeyBjb2w6ICd1cGRhdGVkX2J5JywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXG4gICAgXSxcbiAgfSxcbiAgcmVuZGljaW9uZXM6IHtcbiAgICBuYW1lOiAncmVuZGljaW9uZXMuY3N2JyxcbiAgICBzb3VyY2U6ICdmaXJlc3RvcmUnLFxuICAgIGNvbGxlY3Rpb246ICdyZW5kaWNpb25lcycsXG4gICAgcm93TW9kZTogJ29uZV9wZXJfZG9jJyxcbiAgICBjb2x1bW5zOiBbXG4gICAgICB7IGNvbDogJ3JlbmRpY2lvbl9pZCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnRmlyZXN0b3JlIGRvYyBJRCcgfSxcbiAgICAgIHsgY29sOiAnb3duZXJfdWlkJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXG4gICAgICB7IGNvbDogJ293bmVyX2VtYWlsJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXG4gICAgICB7IGNvbDogJ3ZlbmRvcicsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJyB9LFxuICAgICAgeyBjb2w6ICd0aXBvJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdnYXN0byB8IHNvbGljaXR1ZCcgfSxcbiAgICAgIHsgY29sOiAndGlwb19nYXN0bycsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnZWogUEVBSkVTLCBGQUNUVVJBIEEsIEdBU1RPIENPTiBDT01QUk9CQU5URScgfSxcbiAgICAgIHsgY29sOiAnaW1wb3J0ZV9hcnMnLCB0eXBlOiAnbnVtYmVyJywgZGVzYzogJ21vbnRvIEFSUycgfSxcbiAgICAgIHsgY29sOiAnZmVjaGFfZ2FzdG8nLCB0eXBlOiAnaXNvODYwMScsIGRlc2M6ICdZWVlZLU1NLUREIGRlbCBnYXN0bycgfSxcbiAgICAgIHsgY29sOiAnY29uY2VwdG8nLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ2Rlc2NyaXBjaW9uIGxpYnJlJyB9LFxuICAgICAgeyBjb2w6ICdmb3RvX3RpY2tldF91cmwnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ1VSTCBGaXJlYmFzZSBTdG9yYWdlIHYzMDgrIChudW5jYSBiYXNlNjQpJyB9LFxuICAgICAgeyBjb2w6ICdzdGF0dXMnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ3BlbmRpbmdfYXBwcm92YWwgfCBhcHByb3ZlZCB8IHJlamVjdGVkJyB9LFxuICAgICAgeyBjb2w6ICdhcHByb3ZlZF9ieScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnZW1haWwgZGVsIGFwcm9iYWRvciBvIFwic2VsZlwiJyB9LFxuICAgICAgeyBjb2w6ICdhcHByb3ZlZF9hdCcsIHR5cGU6ICdpc284NjAxJywgZGVzYzogJycgfSxcbiAgICAgIHsgY29sOiAncmVqZWN0ZWRfYnlfZW1haWwnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcbiAgICAgIHsgY29sOiAncmVqZWN0ZWRfcmVhc29uJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXG4gICAgICB7IGNvbDogJ2FwcHJvdmVyX3VpZCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnVUlEIHJlc3BvbnNhYmxlIGFzaWduYWRvJyB9LFxuICAgICAgeyBjb2w6ICdjcmVhdGVkX2F0JywgdHlwZTogJ2lzbzg2MDEnLCBkZXNjOiAnJyB9LFxuICAgIF0sXG4gIH0sXG4gIGNhbXBhbmlhczoge1xuICAgIG5hbWU6ICdjYW1wYW5pYXMuY3N2JyxcbiAgICBzb3VyY2U6ICdmaXJlc3RvcmUnLFxuICAgIGNvbGxlY3Rpb246ICdjYW1wYWlnbnMnLFxuICAgIHJvd01vZGU6ICdvbmVfcGVyX2RvYycsXG4gICAgY29sdW1uczogW1xuICAgICAgeyBjb2w6ICdjYW1wYWlnbl9pZCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnRmlyZXN0b3JlIGRvYyBJRCcgfSxcbiAgICAgIHsgY29sOiAnbmFtZScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnbm9tYnJlIGNhbXBhbmEnIH0sXG4gICAgICB7IGNvbDogJ2ZhbWlsaWEnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ2VqIFJFRUxTJyB9LFxuICAgICAgeyBjb2w6ICdzdWJmYW1pbGlhJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdlaiBNVUxUSVBMSUNBRE9SRVMnIH0sXG4gICAgICB7IGNvbDogJ2ZpbHRlcl90eXBlJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdza3UgKGhveSBoYXJkY29kZWQpJyB9LFxuICAgICAgeyBjb2w6ICdmaWx0ZXJfdmFsdWVzX2pzb24nLCB0eXBlOiAnanNvbl9hcnJheScsIGRlc2M6ICdjb3BpYSBkZSBza3VzJyB9LFxuICAgICAgeyBjb2w6ICdza3VzX2pzb24nLCB0eXBlOiAnanNvbl9hcnJheScsIGRlc2M6ICdJdGVtQ29kZXMgaW5jbHVpZG9zJyB9LFxuICAgICAgeyBjb2w6ICdza3VzX2NvdW50JywgdHlwZTogJ2ludCcsIGRlc2M6ICdjYW50aWRhZCBTS1VzJyB9LFxuICAgICAgeyBjb2w6ICd0YXJnZXRfdHlwZScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAndW5pdHMgfCBtb25leScgfSxcbiAgICAgIHsgY29sOiAndGFyZ2V0X2Ftb3VudCcsIHR5cGU6ICdudW1iZXInLCBkZXNjOiAnb2JqZXRpdm8nIH0sXG4gICAgICB7IGNvbDogJ3N0YXJ0X2RhdGUnLCB0eXBlOiAnaXNvODYwMScsIGRlc2M6ICdZWVlZLU1NLUREJyB9LFxuICAgICAgeyBjb2w6ICdlbmRfZGF0ZScsIHR5cGU6ICdpc284NjAxJywgZGVzYzogJ1lZWVktTU0tREQnIH0sXG4gICAgICB7IGNvbDogJ3Njb3BlJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdhbGwgfCBwcm92aW5jZSB8IHZlbmRvcicgfSxcbiAgICAgIHtcbiAgICAgICAgY29sOiAnc2NvcGVfdmFsdWVzX2pzb24nLFxuICAgICAgICB0eXBlOiAnanNvbl9hcnJheScsXG4gICAgICAgIGRlc2M6ICdwcm92aW5jaWFzIG8gdmVuZG9yIGtleXMgc2kgc2NvcGUgIT0gYWxsJyxcbiAgICAgIH0sXG4gICAgICB7IGNvbDogJ2NyZWF0ZWRfYnknLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ1VJRCBhZG1pbi9nZXJlbnRlJyB9LFxuICAgICAgeyBjb2w6ICdjcmVhdGVkX2J5X2VtYWlsJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXG4gICAgICB7IGNvbDogJ2NyZWF0ZWRfYXQnLCB0eXBlOiAnaXNvODYwMScsIGRlc2M6ICcnIH0sXG4gICAgICB7IGNvbDogJ2FyY2hpdmVkX21hbnVhbGx5JywgdHlwZTogJ2Jvb2xlYW4nLCBkZXNjOiAndHJ1ZT1maW5hbGl6YWRhIGFudGVzIGRlIGVuZERhdGUnIH0sXG4gICAgICB7IGNvbDogJ2FyY2hpdmVkX2F0JywgdHlwZTogJ2lzbzg2MDEnLCBkZXNjOiAnJyB9LFxuICAgICAgeyBjb2w6ICdhcmNoaXZlZF9ieScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJyB9LFxuICAgIF0sXG4gIH0sXG4gIHRhcmdldHM6IHtcbiAgICBuYW1lOiAndGFyZ2V0cy5jc3YnLFxuICAgIHNvdXJjZTogJ2ZpcmVzdG9yZScsXG4gICAgY29sbGVjdGlvbjogJ3RhcmdldHMnLFxuICAgIHJvd01vZGU6ICdvbmVfcGVyX2RvYycsXG4gICAgY29sdW1uczogW1xuICAgICAgeyBjb2w6ICd0YXJnZXRfaWQnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ0ZpcmVzdG9yZSBkb2MgSUQgY2Fub25pY28ge3ZlbmRvcn1fe3llYXJ9X3tNTX0nIH0sXG4gICAgICB7IGNvbDogJ3NlbGxlcl9pZCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAndmVuZG9yS2V5IHVwcGVyY2FzZSBlaiBHT05aQUxPIERFIExBIFJPU0EnIH0sXG4gICAgICB7IGNvbDogJ3llYXInLCB0eXBlOiAnaW50JywgZGVzYzogJ2VqIDIwMjYnIH0sXG4gICAgICB7IGNvbDogJ21vbnRoJywgdHlwZTogJ2ludCcsIGRlc2M6ICcwLTExIChpbmRpY2UgZGVsIGFycmF5IE1FU0VTIDAtaW5kZXhlZCknIH0sXG4gICAgICB7IGNvbDogJ3RhcmdldF9hcnMnLCB0eXBlOiAnbnVtYmVyJywgZGVzYzogJ29iamV0aXZvIG1lcyBBUlMgKHN1bWEgZmFtaWxpYXMpJyB9LFxuICAgICAgeyBjb2w6ICd0YXJnZXRfcmVlbF9hcnMnLCB0eXBlOiAnbnVtYmVyJywgZGVzYzogJ3YzMTErIGRlc2dsb3NlJyB9LFxuICAgICAgeyBjb2w6ICd0YXJnZXRfY2FuYXNfYXJzJywgdHlwZTogJ251bWJlcicsIGRlc2M6ICd2MzExKyBkZXNnbG9zZScgfSxcbiAgICAgIHsgY29sOiAndGFyZ2V0X2xpbmVhc19hcnMnLCB0eXBlOiAnbnVtYmVyJywgZGVzYzogJ3YzMTErIGRlc2dsb3NlJyB9LFxuICAgICAgeyBjb2w6ICd1cGRhdGVkX2F0JywgdHlwZTogJ2lzbzg2MDEnLCBkZXNjOiAnJyB9LFxuICAgICAgeyBjb2w6ICd1cGRhdGVkX2J5JywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdVSUQnIH0sXG4gICAgICB7IGNvbDogJ3VwZGF0ZWRfYnlfZW1haWwnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcbiAgICBdLFxuICB9LFxuICBwcm9kdWN0b3M6IHtcbiAgICBuYW1lOiAncHJvZHVjdG9zLmNzdicsXG4gICAgc291cmNlOiAnc3RvY2tfanNvbicsXG4gICAgcm93TW9kZTogJ2Zyb21fc3RvY2tfanNvbicsXG4gICAgY29sdW1uczogW1xuICAgICAgeyBjb2w6ICdza3UnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ1NLVSAoSXRlbUNvZGUgU0FQKScgfSxcbiAgICAgIHsgY29sOiAnaGFzX3N0b2NrJywgdHlwZTogJ2Jvb2xlYW4nLCBkZXNjOiAndHJ1ZT1oYXkgdW5pZGFkZXMgZW4gYWxndW4gd2hzIHZlbmRpYmxlJyB9LFxuICAgICAgeyBjb2w6ICdjYW50aWRhZF90b3RhbCcsIHR5cGU6ICdpbnQnLCBkZXNjOiAnc3VtYSB0b3RhbCB3aHMgdmVuZGlibGVzIChleGNsdXllIDA1IHkgMDYpJyB9LFxuICAgICAge1xuICAgICAgICBjb2w6ICdkaXNwb25pYmxlX3ZlbnRhX3doczExJyxcbiAgICAgICAgdHlwZTogJ2ludCcsXG4gICAgICAgIGRlc2M6ICd2MzY5KyBNZXJjYWRlcmlhIE5VUiBQRVNDQSAodmVudGEgZGlyZWN0YSknLFxuICAgICAgfSxcbiAgICAgIHsgY29sOiAndHJhbnNpdG9fd2hzMTInLCB0eXBlOiAnaW50JywgZGVzYzogJ3YzNjkrIEVuIHRyYW5zaXRvIFBFU0NBIChiYWNrb3JkZXIgZnV0dXJvKScgfSxcbiAgICAgIHtcbiAgICAgICAgY29sOiAnb3Ryb3Nfd2FyZWhvdXNlc19qc29uJyxcbiAgICAgICAgdHlwZTogJ2pzb25fb2JqZWN0JyxcbiAgICAgICAgZGVzYzogJ290cm9zIGNvZGlnb3MgY29uIGNhbnRpZGFkLCBlaiB7XCI5OFwiOiA1fScsXG4gICAgICB9LFxuICAgICAgeyBjb2w6ICdzb3VyY2UnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ3N0b2NrLmpzb24gc25hcHNob3QnIH0sXG4gICAgICB7IGNvbDogJ3NuYXBzaG90X3VwZGF0ZWRfYXQnLCB0eXBlOiAnaXNvODYwMScsIGRlc2M6ICd0aW1lc3RhbXAgZGVsIHVsdGltbyBzeW5jIFNBUCcgfSxcbiAgICBdLFxuICB9LFxuICB2ZW5kb3Jfb3ZlcnJpZGVzOiB7XG4gICAgbmFtZTogJ3ZlbmRvcl9vdmVycmlkZXMuY3N2JyxcbiAgICBzb3VyY2U6ICdmaXJlc3RvcmUnLFxuICAgIGNvbGxlY3Rpb246ICd2ZW5kb3Jfb3ZlcnJpZGVzJyxcbiAgICByb3dNb2RlOiAnb25lX3Blcl9kb2MnLFxuICAgIGNvbHVtbnM6IFtcbiAgICAgIHsgY29sOiAnb3ZlcnJpZGVfaWQnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ0ZpcmVzdG9yZSBkb2MgSUQnIH0sXG4gICAgICB7IGNvbDogJ3Njb3BlJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdzaG9wIHwgbG9jJyB9LFxuICAgICAgeyBjb2w6ICdwcm92aW5jZScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJyB9LFxuICAgICAgeyBjb2w6ICdsb2NhbGl0eV9uYW1lJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXG4gICAgICB7IGNvbDogJ2NsaWVudF9uYW1lJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdzb2xvIHNpIHNjb3BlPXNob3AnIH0sXG4gICAgICB7IGNvbDogJ29yaWdpbmFsX3ZlbmRvcicsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJyB9LFxuICAgICAgeyBjb2w6ICduZXdfdmVuZG9yJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXG4gICAgICB7IGNvbDogJ25ld190eXBlJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdWREUgfCBWREkgfCBESVNUUklCVUlET1IgfCBPVFJPJyB9LFxuICAgICAgeyBjb2w6ICd1cGRhdGVkX2F0JywgdHlwZTogJ2lzbzg2MDEnLCBkZXNjOiAnJyB9LFxuICAgICAgeyBjb2w6ICd1cGRhdGVkX2J5X3VpZCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJyB9LFxuICAgICAgeyBjb2w6ICd1cGRhdGVkX2J5X2VtYWlsJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXG4gICAgICB7IGNvbDogJ3VwZGF0ZWRfYnlfZGlzcGxheV9uYW1lJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXG4gICAgXSxcbiAgfSxcbiAgY3VzdG9tX3JvdXRlczoge1xuICAgIG5hbWU6ICdjdXN0b21fcm91dGVzLmNzdicsXG4gICAgc291cmNlOiAnZmlyZXN0b3JlJyxcbiAgICBjb2xsZWN0aW9uOiAnY3VzdG9tX3JvdXRlcycsXG4gICAgcm93TW9kZTogJ2ZsYXR0ZW5fc3RvcHMnLCAvLyAxIGZpbGEgcG9yIChydXRhLCBzdG9wKVxuICAgIGNvbHVtbnM6IFtcbiAgICAgIHsgY29sOiAncm91dGVfaWQnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ0ZpcmVzdG9yZSBkb2MgSUQnIH0sXG4gICAgICB7IGNvbDogJ293bmVyX3VpZCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnZHVlbmlvIGRlIGxhIHJ1dGEnIH0sXG4gICAgICB7IGNvbDogJ293bmVyX2VtYWlsJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXG4gICAgICB7IGNvbDogJ25hbWUnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ25vbWJyZSBkZSBsYSBydXRhJyB9LFxuICAgICAgeyBjb2w6ICdwbGFubmVkX2RhdGUnLCB0eXBlOiAnaXNvODYwMScsIGRlc2M6ICdZWVlZLU1NLUREJyB9LFxuICAgICAgeyBjb2w6ICdub3RlcycsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnbm90YXMgbGlicmVzJyB9LFxuICAgICAgeyBjb2w6ICdjcmVhdGVkX2F0JywgdHlwZTogJ2lzbzg2MDEnLCBkZXNjOiAnJyB9LFxuICAgICAgeyBjb2w6ICd1cGRhdGVkX2F0JywgdHlwZTogJ2lzbzg2MDEnLCBkZXNjOiAnJyB9LFxuICAgICAgeyBjb2w6ICdzdG9wX29yZGVyJywgdHlwZTogJ2ludCcsIGRlc2M6ICdvcmRlbiAwLWJhc2VkJyB9LFxuICAgICAgeyBjb2w6ICdzdG9wX2tleScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnY2xhdmUgY29tcHVlc3RhIHRpcG98cHJvdnxsb2N8Y2xpZW50ZScgfSxcbiAgICAgIHsgY29sOiAnc3RvcF90aXBvJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdDIHwgUCcgfSxcbiAgICAgIHsgY29sOiAnc3RvcF9wcm92aW5jaWEnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcbiAgICAgIHsgY29sOiAnc3RvcF9sb2NhbGlkYWQnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcbiAgICAgIHsgY29sOiAnc3RvcF9jbGllbnRfbmFtZScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJyB9LFxuICAgICAgeyBjb2w6ICdzdG9wX2lzX3Byb3Zpc29yaW8nLCB0eXBlOiAnYm9vbGVhbicsIGRlc2M6ICd0cnVlPWFsdGEgcmFwaWRhIHNpbiBDYXJkQ29kZScgfSxcbiAgICAgIHsgY29sOiAnc3RvcF9zYXBfYWx0YV9pZCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnSUQgZGVsIGNsaWVudF9hcHBsaWNhdGlvbnMgc2kgYXBsaWNhJyB9LFxuICAgIF0sXG4gIH0sXG4gIHNlZ3VpbWllbnRvX25vdGVzOiB7XG4gICAgbmFtZTogJ3NlZ3VpbWllbnRvX25vdGVzLmNzdicsXG4gICAgc291cmNlOiAnZmlyZXN0b3JlJyxcbiAgICBjb2xsZWN0aW9uOiAnc2VndWltaWVudG9fbm90ZXMnLFxuICAgIHJvd01vZGU6ICdvbmVfcGVyX2RvYycsXG4gICAgY29sdW1uczogW1xuICAgICAgeyBjb2w6ICdub3RlX2lkJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdGaXJlc3RvcmUgZG9jIElEJyB9LFxuICAgICAgeyBjb2w6ICd2ZW5kb3JfZXh0JywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdWREUgYWwgcXVlIGFwbGljYSBsYSBub3RhJyB9LFxuICAgICAgeyBjb2w6ICdjbGllbnRfa2V5JywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdjbGF2ZSBjb21wdWVzdGEgY2xpZW50ZScgfSxcbiAgICAgIHsgY29sOiAnY2xpZW50X25hbWUnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcbiAgICAgIHsgY29sOiAncHJvdmluY2UnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcbiAgICAgIHsgY29sOiAnbG9jYWxpdHknLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcbiAgICAgIHsgY29sOiAndGV4dCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAndGV4dG8gbGlicmUgZGUgbGEgbm90YScgfSxcbiAgICAgIHsgY29sOiAnYXV0aG9yX3VpZCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJyB9LFxuICAgICAgeyBjb2w6ICdhdXRob3JfZW1haWwnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcbiAgICAgIHsgY29sOiAnYXV0aG9yX25hbWUnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcbiAgICAgIHsgY29sOiAnYXV0aG9yX3JvbGUnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ2FkbWluIHwgZ2VyZW50ZSB8IGludGVybm8nIH0sXG4gICAgICB7IGNvbDogJ2NyZWF0ZWRfYXQnLCB0eXBlOiAnaXNvODYwMScsIGRlc2M6ICcnIH0sXG4gICAgXSxcbiAgfSxcbn07XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gREFUQVNFVF9VU0VfQ0FTRV9NQVRSSVggXHUyMDE0IGNhc29zIGRlIHVzbyBNTCBjb24gY2FtcG9zIHJlcXVlcmlkb3Ncbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4vKiogQHR5cGVkZWYge3twcmlvcml0eTogbnVtYmVyfHN0cmluZywgZGVzY3JpcHRpb246IHN0cmluZywgcmVxdWlyZWRGaWVsZHM6IFJlY29yZDxzdHJpbmcsIHN0cmluZ1tdPiwgam9pbk5vdGVzPzogc3RyaW5nfX0gVXNlQ2FzZSAqL1xuXG4vKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFVzZUNhc2U+fSAqL1xuZXhwb3J0IGNvbnN0IERBVEFTRVRfVVNFX0NBU0VfTUFUUklYID0ge1xuICBBX2NvbnZlcnNpb25fdmlzaXRhX3BlZGlkbzoge1xuICAgIHByaW9yaXR5OiAxLFxuICAgIGRlc2NyaXB0aW9uOiAnUHJlZGVjaXIgcXVlIHZpc2l0YXMgdGVybWluYW4gZW4gcGVkaWRvIHBhcmEgcHJpb3JpemFyIGxhIHJ1dGEgZGVsIHZlbmRlZG9yLicsXG4gICAgcmVxdWlyZWRGaWVsZHM6IHtcbiAgICAgICd2aXNpdGFzLmNzdic6IFsnZmVjaGEnLCAnb3duZXJfdWlkJywgJ3Byb3ZpbmNpYScsICdsb2NhbGlkYWQnLCAndGllbmRhJ10sXG4gICAgICAncGVkaWRvcy5jc3YnOiBbJ2NvbmZpcm1lZF9hdCcsICdvd25lcl91aWQnLCAncHJvdmluY2UnLCAnbG9jX25hbWUnLCAnY2xpZW50X25hbWUnXSxcbiAgICB9LFxuICAgIGpvaW5Ob3RlczpcbiAgICAgICdKT0lOIHBvciAocHJvdmluY2lhLCBsb2NhbGlkYWQsIHRpZW5kYX5jbGllbnRfbmFtZSkgZW4gdmVudGFuYSB0ZW1wb3JhbCBmZWNoYV92aXNpdGEuLmNvbmZpcm1lZF9hdC4gTm8gaGF5IGNhcmRDb2RlU2FwIGNvbXVuIGVudHJlIHZpc2l0cyB5IHBlZGlkb3MuJyxcbiAgfSxcbiAgQl9jaHVybl9jbGllbnRlczoge1xuICAgIHByaW9yaXR5OiAyLFxuICAgIGRlc2NyaXB0aW9uOiAnRGV0ZWN0YXIgY2xpZW50ZXMgcXVlIHNlIGVuZnJpYW4gYW50ZXMgZGUgcGVyZGVybG9zLicsXG4gICAgcmVxdWlyZWRGaWVsZHM6IHtcbiAgICAgICdjbGllbnRlcy5jc3YnOiBbJ2NyZWF0ZWRfYXQnLCAnYXNzaWduZWRfdmVuZG9yJywgJ3Byb3ZpbmNpYScsICdzdGF0dXMnLCAnY2FyZF9jb2RlX3NhcCddLFxuICAgICAgJ3BlZGlkb3MuY3N2JzogWydjb25maXJtZWRfYXQnLCAnY2xpZW50X25hbWUnLCAncHJvdmluY2UnLCAnbG9jX25hbWUnXSxcbiAgICB9LFxuICAgIGpvaW5Ob3RlczpcbiAgICAgICdKT0lOIHZpYSBjbGllbnRfYXBwbGljYXRpb25zLmNhcmRfY29kZV9zYXAgdnMgcGVkaWRvcy5rZXkgKHBhcnNlYWRvKS4gRnJhZ2lsIC0gY29uc2lkZXJhciBmdXp6eSBtYXRjaCBwb3Igbm9tYnJlLicsXG4gIH0sXG4gIENfZm9yZWNhc3Rfc2t1OiB7XG4gICAgcHJpb3JpdHk6IDMsXG4gICAgZGVzY3JpcHRpb246ICdBbnRpY2lwYXIgcXVlIHByb2R1Y3RvcyBzZSB2YW4gYSBwZWRpciBwb3IgcGVyaW9kby4nLFxuICAgIHJlcXVpcmVkRmllbGRzOiB7XG4gICAgICAncGVkaWRvcy5jc3YnOiBbJ2xpbmVfY29kZScsICdsaW5lX3F0eScsICdsaW5lX3ByZWNpbycsICdjb25maXJtZWRfYXQnLCAncHJvdmluY2UnXSxcbiAgICAgICdwcm9kdWN0b3MuY3N2JzogWydza3UnXSxcbiAgICB9LFxuICAgIGpvaW5Ob3RlczpcbiAgICAgICdEZXNjdWVudG8gYXBsaWNhZG8gYSBuaXZlbCBoZWFkZXIgKGRpc2NvdW50X3BjdCkgLSBwcm9ycmF0ZWFyIGVuIGVsIHBpcGVsaW5lIGRvd25zdHJlYW0gcHJvcG9yY2lvbmFsIGEgc3VidG90YWxfYnJ1dG8gZGUgY2FkYSBsaW5lYS4gRW5yaXF1ZWNlciBjb24gY2F0YWxvZ28gQlEgKHNhcF9pdGVtc19yYXcpIHNpIGhhY2UgZmFsdGEgY2F0L2ZhbS9zdWIgYWRpY2lvbmFsLicsXG4gIH0sXG4gIERfYW5vbWFsaWFzX3JlbmRpY2lvbmVzOiB7XG4gICAgcHJpb3JpdHk6ICdleHBsb3JhdG9yaW8nLFxuICAgIGRlc2NyaXB0aW9uOiAnRGV0ZWN0YXIgb3V0bGllcnMgZGUgZ2FzdG9zLicsXG4gICAgcmVxdWlyZWRGaWVsZHM6IHtcbiAgICAgICdyZW5kaWNpb25lcy5jc3YnOiBbJ2ltcG9ydGVfYXJzJywgJ3RpcG9fZ2FzdG8nLCAnb3duZXJfdWlkJywgJ2ZlY2hhX2dhc3RvJywgJ3N0YXR1cyddLFxuICAgIH0sXG4gIH0sXG4gIEVfZXN0YWNpb25hbGlkYWRfem9uYV9jYXRlZ29yaWE6IHtcbiAgICBwcmlvcml0eTogJ2V4cGxvcmF0b3JpbycsXG4gICAgZGVzY3JpcHRpb246ICdJbnN1bW8gcGFyYSBhcm1hZG8gZGUgY2FtcGFuaWFzIGVzdGFjaW9uYWxlcy4nLFxuICAgIHJlcXVpcmVkRmllbGRzOiB7XG4gICAgICAncGVkaWRvcy5jc3YnOiBbJ2NvbmZpcm1lZF9hdCcsICdwcm92aW5jZScsICdsaW5lX2NvZGUnLCAnbGluZV9mYW0nLCAnbGluZV9xdHknXSxcbiAgICAgICdjbGllbnRlcy5jc3YnOiBbJ3Byb3ZpbmNpYScsICdhc3NpZ25lZF92ZW5kb3InXSxcbiAgICAgICdjYW1wYW5pYXMuY3N2JzogWydzdGFydF9kYXRlJywgJ2VuZF9kYXRlJywgJ3NrdXNfanNvbicsICdzY29wZSddLFxuICAgICAgJ3RhcmdldHMuY3N2JzogWyd5ZWFyJywgJ21vbnRoJywgJ3RhcmdldF9hcnMnXSxcbiAgICB9LFxuICB9LFxufTtcblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBSb3cgYnVpbGRlcnMgXHUyMDE0IGZ1bmNpb25lcyBwdXJhcyAoZG9jIC0+IGFycmF5IGRlIHJvd3MpXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuLyoqXG4gKiBFeHRyYWUgdmFsb3IgRmlyZXN0b3JlIGRlIGRvYyBjb24gcGF0aCBhbmlkYWRvLiBEZXZ1ZWx2ZSByYXcgKG5vIENTVikuXG4gKiBFajogZ2V0RmllbGQoZG9jLCAndHJhbnNmZXJpZG9TQVAuZG9jTnVtJylcbiAqIEBwYXJhbSB7b2JqZWN0fSBkb2NcbiAqIEBwYXJhbSB7c3RyaW5nfSBwYXRoXG4gKi9cbmZ1bmN0aW9uIGYoZG9jLCBwYXRoKSB7XG4gIHJldHVybiBnZXRQYXRoKGRvYywgcGF0aCk7XG59XG5cbi8qKlxuICogUm93IGJ1aWxkZXIgZ2VuZXJpY286IG1hcGVhIHVuIGRvYyBhIGFycmF5IGRlIHZhbG9yZXMgc2VndW4gdW4gYXJyYXkgZGUgcGF0aHMuXG4gKiBAcGFyYW0ge29iamVjdH0gZG9jXG4gKiBAcGFyYW0ge3N0cmluZ1tdfSBwYXRoc1xuICogQHJldHVybnMge3Vua25vd25bXX1cbiAqL1xuZnVuY3Rpb24gX2J1aWxkUm93KGRvYywgcGF0aHMpIHtcbiAgcmV0dXJuIHBhdGhzLm1hcCgocCkgPT4gKHAgPT09ICdfX2lkX18nID8gLyoqIEB0eXBlIHthbnl9ICovIChkb2MpLl9pZCA6IGYoZG9jLCBwKSkpO1xufVxuXG4vKipcbiAqIFBlZGlkb3M6IGZsYXR0ZW4gMSBmaWxhIHBvciBsaW5lYS4gSGVhZGVyIHBlZGlkbyByZXBsaWNhZG8gZW4gY2FkYS5cbiAqIGRvYy5faWQgZXMgZWwgSUQ7IHNlIGVzcGVyYSBxdWUgZWwgY2FsbGVyIGxvIGFncmVndWUgYW50ZXMgZGUgcGFzYXIuXG4gKiBAcGFyYW0ge2FueX0gZG9jXG4gKiBAcmV0dXJucyB7dW5rbm93bltdW119XG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBidWlsZFBlZGlkb1Jvd3MoZG9jKSB7XG4gIGNvbnN0IGhlYWRlciA9IFtcbiAgICBkb2MuX2lkLFxuICAgIGRvYy5vd25lclVpZCxcbiAgICBkb2Mub3duZXJFbWFpbCxcbiAgICBkb2MuY3JlYXRlZEJ5VWlkLFxuICAgIGRvYy5vbkJlaGFsZk9mLFxuICAgIGRvYy5rZXksXG4gICAgZG9jLnN0YWdlLFxuICAgIGRvYy50aXBvLFxuICAgIGRvYy5wcm92aW5jZSxcbiAgICBkb2MubG9jTmFtZSxcbiAgICBkb2MuY2xpZW50TmFtZSxcbiAgICBkb2MubW9udGgsXG4gICAgZG9jLm1vbnRoSWR4LFxuICAgIGRvYy55ZWFyLFxuICAgIGRvYy5jb25maXJtZWRBdCxcbiAgICBkb2MuY29uZGljaW9uUGFnbyxcbiAgICBkb2MuZm9ybWFFbnRyZWdhID8gZG9jLmZvcm1hRW50cmVnYS50aXBvIDogbnVsbCxcbiAgICBkb2MuZm9ybWFFbnRyZWdhID8gZG9jLmZvcm1hRW50cmVnYS50cmFuc3BOb21icmUgOiBudWxsLFxuICAgIGRvYy5mb3JtYUVudHJlZ2EgPyBkb2MuZm9ybWFFbnRyZWdhLnRyYW5zcERpcmVjY2lvbiA6IG51bGwsXG4gICAgZG9jLmZvcm1hRW50cmVnYSA/IGRvYy5mb3JtYUVudHJlZ2EuY2xpZW50ZURpcmVjY2lvbiA6IG51bGwsXG4gICAgZG9jLmZvcm1hRW50cmVnYSA/IGRvYy5mb3JtYUVudHJlZ2Euc3VjdXJzYWxEaXJlY2Npb24gOiBudWxsLFxuICAgIGRvYy5kaXNjb3VudFBjdCxcbiAgICBkb2Muc3VidG90YWxBcnMsXG4gICAgZG9jLm5ldEFtb3VudEFycyxcbiAgICBkb2MudHJhbnNmZXJpZG9TQVAgPyBkb2MudHJhbnNmZXJpZG9TQVAudmlhIDogbnVsbCxcbiAgICBkb2MudHJhbnNmZXJpZG9TQVAgPyBkb2MudHJhbnNmZXJpZG9TQVAuZG9jTnVtIDogbnVsbCxcbiAgICBkb2MudHJhbnNmZXJpZG9TQVAgPyBkb2MudHJhbnNmZXJpZG9TQVAuZG9jRW50cnkgOiBudWxsLFxuICAgIGRvYy50cmFuc2Zlcmlkb1NBUCA/IGRvYy50cmFuc2Zlcmlkb1NBUC5hdCA6IG51bGwsXG4gICAgZG9jLmNyZWF0ZWRBdCxcbiAgXTtcbiAgY29uc3QgbGluZXMgPSBBcnJheS5pc0FycmF5KGRvYy5saW5lcykgPyBkb2MubGluZXMgOiBbXTtcbiAgaWYgKCFsaW5lcy5sZW5ndGgpIHtcbiAgICAvLyBQZWRpZG8gc2luIGxpbmVhcyAtPiAxIGZpbGEgY29uIGxpbmVfKiB2YWNpb3NcbiAgICByZXR1cm4gW2hlYWRlci5jb25jYXQoW251bGwsIG51bGwsIG51bGwsIG51bGwsIG51bGwsIG51bGwsIG51bGwsIG51bGxdKV07XG4gIH1cbiAgcmV0dXJuIGxpbmVzLm1hcCgoLyoqIEB0eXBlIHthbnl9ICovIGwsIC8qKiBAdHlwZSB7bnVtYmVyfSAqLyBpZHgpID0+XG4gICAgaGVhZGVyLmNvbmNhdChbXG4gICAgICBpZHgsXG4gICAgICBsID8gbC5jb2RlIDogbnVsbCxcbiAgICAgIGwgPyBsLmRlc2MgOiBudWxsLFxuICAgICAgbCA/IGwucXR5IDogbnVsbCxcbiAgICAgIGwgPyBsLnByZWNpbyA6IG51bGwsXG4gICAgICBsID8gbC5jYXQgOiBudWxsLFxuICAgICAgbCA/IGwuZmFtIDogbnVsbCxcbiAgICAgIGwgPyBsLnN1YiA6IG51bGwsXG4gICAgXSlcbiAgKTtcbn1cblxuLyoqIEBwYXJhbSB7YW55fSBkb2MgQHJldHVybnMge3Vua25vd25bXVtdfSAqL1xuZXhwb3J0IGZ1bmN0aW9uIGJ1aWxkVmlzaXRhUm93cyhkb2MpIHtcbiAgcmV0dXJuIFtcbiAgICBbXG4gICAgICBkb2MuX2lkLFxuICAgICAgZG9jLm93bmVyVWlkLFxuICAgICAgZG9jLm93bmVyRW1haWwsXG4gICAgICBkb2MuZmVjaGEsXG4gICAgICBkb2MubWVzLFxuICAgICAgZG9jLmFuaW8sXG4gICAgICBkb2MudmVuZG9yLFxuICAgICAgZG9jLnByb3ZpbmNpYSxcbiAgICAgIGRvYy5sb2NhbGlkYWQsXG4gICAgICBkb2MudGllbmRhLFxuICAgICAgZG9jLnRpcG8sXG4gICAgICBkb2MubG9jYWwsXG4gICAgICBkb2MudGFtYW5vLFxuICAgICAgZG9jLmZpZGVsaWRhZCxcbiAgICAgIGRvYy5yZWxldmFuY2lhLFxuICAgICAgZG9jLnBvcCxcbiAgICAgIGRvYy5uZWNlc2lkYWRQdW50dWFsLFxuICAgICAgZG9jLnRpcG9WZW50YSxcbiAgICAgIGRvYy5wb25kZXJhY2lvbk1vc3RyYWRvLFxuICAgICAgZG9jLnBvbmRlcmFjaW9uRWNvbW1lcmNlLFxuICAgICAgZG9jLmNvbXBldGVuY2lhLFxuICAgICAgZG9jLm9wb3J0dW5pZGFkLFxuICAgICAgZG9jLm1hc1ZlbmRpZG8sXG4gICAgICBkb2MubWFzUHJlZ3VudGFuLFxuICAgICAgZG9jLmF5dWRhVGllbmRhLFxuICAgICAgZG9jLmdwc1N0YXR1cyxcbiAgICAgIGRvYy5ncHNEaXN0YW5jZU0sXG4gICAgICBkb2MuaW50ZXJhY3Rpb25UeXBlLFxuICAgICAgZG9jLmZvcm1hQ29udGFjdG8sXG4gICAgICBkb2MuY29udGFjdG9SZXN1bHRhZG8sXG4gICAgICBkb2MuY29udGFjdG9SZXN1bHRhZG9BdCxcbiAgICAgIGRvYy5jb250YWN0b1Jlc3VsdGFkb0J5LFxuICAgICAgZG9jLmNyZWF0ZWRBdCxcbiAgICBdLFxuICBdO1xufVxuXG4vKiogQHBhcmFtIHthbnl9IGRvYyBAcmV0dXJucyB7dW5rbm93bltdW119ICovXG5leHBvcnQgZnVuY3Rpb24gYnVpbGRDbGllbnRlUm93cyhkb2MpIHtcbiAgcmV0dXJuIFtcbiAgICBbXG4gICAgICBkb2MuX2lkLFxuICAgICAgZG9jLm93bmVyVWlkLFxuICAgICAgZG9jLm93bmVyRW1haWwsXG4gICAgICBkb2Mub3duZXJOYW1lLFxuICAgICAgZG9jLmNvbWVyY2lvLFxuICAgICAgZG9jLmZhbnRhc2lhLFxuICAgICAgZG9jLmN1aXQsXG4gICAgICBkb2MuY29uZGljaW9uRmlzY2FsLFxuICAgICAgZG9jLmNhbGxlLFxuICAgICAgZG9jLm51bWVybyxcbiAgICAgIGRvYy5sb2NhbGlkYWQsXG4gICAgICBkb2MucHJvdmluY2lhLFxuICAgICAgZG9jLmxvY2FsaWRhZEZpbmFsLFxuICAgICAgZG9jLmNhcmRDb2RlU2FwLFxuICAgICAgZG9jLmFzc2lnbmVkVmVuZG9yLFxuICAgICAgZG9jLnN0YXR1cyxcbiAgICAgIGRvYy5zb3VyY2UsXG4gICAgICBkb2MubWFudWFsU2FwUGVuZGluZyxcbiAgICAgIGRvYy5wcmVjYXVjaW9uLFxuICAgICAgZG9jLmNhdGVnb3JpYUNsaWVudGUsXG4gICAgICBkb2MuY2xpVGlwbyxcbiAgICAgIGRvYy5sYXQsXG4gICAgICBkb2MubG5nLFxuICAgICAgZG9jLmxhdCAhPSBudWxsICYmIGRvYy5sbmcgIT0gbnVsbCxcbiAgICAgICEhKGRvYy5jYWxsZSB8fCBkb2MuYWRkcmVzcyksXG4gICAgICBkb2Muc3VibWl0dGVkQnlQdWJsaWNGb3JtLFxuICAgICAgZG9jLmFwcHJvdmVkQXQsXG4gICAgICBkb2MuY3JlYXRlZEF0LFxuICAgICAgZG9jLnVwZGF0ZWRBdCxcbiAgICBdLFxuICBdO1xufVxuXG4vKiogQHBhcmFtIHthbnl9IGRvYyBAcmV0dXJucyB7dW5rbm93bltdW119ICovXG5leHBvcnQgZnVuY3Rpb24gYnVpbGRDbGllbnRNYXN0ZXJSb3dzKGRvYykge1xuICByZXR1cm4gW1xuICAgIFtcbiAgICAgIGRvYy5faWQsXG4gICAgICBkb2MuY2xpZW50TmFtZSxcbiAgICAgIGRvYy5wcm92aW5jaWEsXG4gICAgICBkb2MubG9jYWxpZGFkLFxuICAgICAgZG9jLnZlbmRvcixcbiAgICAgIGRvYy5hZGRyZXNzLFxuICAgICAgZG9jLnNhcENhcmRDb2RlLFxuICAgICAgZG9jLnNhcEFkZHJlc3MsXG4gICAgICBkb2Muc2FwQ2l0eSxcbiAgICAgIGRvYy5zYXBTdGF0ZSxcbiAgICAgIGRvYy5zYXBJbXBvcnRlZEF0LFxuICAgICAgZG9jLnNhcEltcG9ydGVkQnksXG4gICAgICBkb2MuY2xpZW50TmFtZU9yaWdpbmFsLFxuICAgICAgZG9jLmxvY2FsaWRhZE9yaWdpbmFsLFxuICAgICAgZG9jLm1hdGNoVHlwZSxcbiAgICAgIGRvYy5tYXRjaFNpbWlsYXJpdHksXG4gICAgICBkb2MudXBkYXRlZEF0LFxuICAgICAgZG9jLnVwZGF0ZWRCeSxcbiAgICBdLFxuICBdO1xufVxuXG4vKiogQHBhcmFtIHthbnl9IGRvYyBAcmV0dXJucyB7dW5rbm93bltdW119ICovXG5leHBvcnQgZnVuY3Rpb24gYnVpbGRSZW5kaWNpb25Sb3dzKGRvYykge1xuICByZXR1cm4gW1xuICAgIFtcbiAgICAgIGRvYy5faWQsXG4gICAgICBkb2Mub3duZXJVaWQsXG4gICAgICBkb2Mub3duZXJFbWFpbCxcbiAgICAgIGRvYy52ZW5kb3IsXG4gICAgICBkb2MudGlwbyxcbiAgICAgIGRvYy50aXBvR2FzdG8sXG4gICAgICBkb2MuaW1wb3J0ZUFycyAhPSBudWxsID8gZG9jLmltcG9ydGVBcnMgOiBkb2MuaW1wb3J0ZSxcbiAgICAgIGRvYy5mZWNoYUdhc3RvLFxuICAgICAgZG9jLmNvbmNlcHRvLFxuICAgICAgLy8gZm90b1RpY2tldFVybCAodjMwOCspIHByaW9yaWRhZDsgTlVOQ0EgZXhwb3J0YXIgYmFzZTY0IGZvdG9UaWNrZXQgbGVnYWN5XG4gICAgICBkb2MuZm90b1RpY2tldFVybCB8fCBudWxsLFxuICAgICAgZG9jLnN0YXR1cyxcbiAgICAgIGRvYy5hcHByb3ZlZEJ5LFxuICAgICAgZG9jLmFwcHJvdmVkQXQsXG4gICAgICBkb2MucmVqZWN0ZWRCeUVtYWlsLFxuICAgICAgZG9jLnJlamVjdGVkUmVhc29uLFxuICAgICAgZG9jLmFwcHJvdmVyVWlkLFxuICAgICAgZG9jLmNyZWF0ZWRBdCxcbiAgICBdLFxuICBdO1xufVxuXG4vKiogQHBhcmFtIHthbnl9IGRvYyBAcmV0dXJucyB7dW5rbm93bltdW119ICovXG5leHBvcnQgZnVuY3Rpb24gYnVpbGRDYW1wYW5pYVJvd3MoZG9jKSB7XG4gIHJldHVybiBbXG4gICAgW1xuICAgICAgZG9jLl9pZCxcbiAgICAgIGRvYy5uYW1lLFxuICAgICAgZG9jLmZhbWlsaWEsXG4gICAgICBkb2Muc3ViZmFtaWxpYSxcbiAgICAgIGRvYy5maWx0ZXJUeXBlLFxuICAgICAgZG9jLmZpbHRlclZhbHVlcyxcbiAgICAgIGRvYy5za3VzLFxuICAgICAgQXJyYXkuaXNBcnJheShkb2Muc2t1cykgPyBkb2Muc2t1cy5sZW5ndGggOiAwLFxuICAgICAgZG9jLnRhcmdldFR5cGUsXG4gICAgICBkb2MudGFyZ2V0QW1vdW50LFxuICAgICAgZG9jLnN0YXJ0RGF0ZSxcbiAgICAgIGRvYy5lbmREYXRlLFxuICAgICAgZG9jLnNjb3BlLFxuICAgICAgZG9jLnNjb3BlVmFsdWVzLFxuICAgICAgZG9jLmNyZWF0ZWRCeSxcbiAgICAgIGRvYy5jcmVhdGVkQnlFbWFpbCxcbiAgICAgIGRvYy5jcmVhdGVkQXQsXG4gICAgICBkb2MuYXJjaGl2ZWRNYW51YWxseSxcbiAgICAgIGRvYy5hcmNoaXZlZEF0LFxuICAgICAgZG9jLmFyY2hpdmVkQnksXG4gICAgXSxcbiAgXTtcbn1cblxuLyoqIEBwYXJhbSB7YW55fSBkb2MgQHJldHVybnMge3Vua25vd25bXVtdfSAqL1xuZXhwb3J0IGZ1bmN0aW9uIGJ1aWxkVGFyZ2V0Um93cyhkb2MpIHtcbiAgcmV0dXJuIFtcbiAgICBbXG4gICAgICBkb2MuX2lkLFxuICAgICAgZG9jLnNlbGxlcklkLFxuICAgICAgZG9jLnllYXIsXG4gICAgICBkb2MubW9udGgsXG4gICAgICBkb2MudGFyZ2V0QXJzLFxuICAgICAgZG9jLnRhcmdldEJ5RmFtaWx5ID8gZG9jLnRhcmdldEJ5RmFtaWx5LlJFRUwgOiBudWxsLFxuICAgICAgZG9jLnRhcmdldEJ5RmFtaWx5ID8gZG9jLnRhcmdldEJ5RmFtaWx5LkNBTkFTIDogbnVsbCxcbiAgICAgIGRvYy50YXJnZXRCeUZhbWlseSA/IGRvYy50YXJnZXRCeUZhbWlseS5MSU5FQVMgOiBudWxsLFxuICAgICAgZG9jLnVwZGF0ZWRBdCxcbiAgICAgIGRvYy51cGRhdGVkQnksXG4gICAgICBkb2MudXBkYXRlZEJ5RW1haWwsXG4gICAgXSxcbiAgXTtcbn1cblxuLyoqIEBwYXJhbSB7YW55fSBkb2MgQHJldHVybnMge3Vua25vd25bXVtdfSAqL1xuZXhwb3J0IGZ1bmN0aW9uIGJ1aWxkVmVuZG9yT3ZlcnJpZGVSb3dzKGRvYykge1xuICByZXR1cm4gW1xuICAgIFtcbiAgICAgIGRvYy5faWQsXG4gICAgICBkb2Muc2NvcGUsXG4gICAgICBkb2MucHJvdmluY2UsXG4gICAgICBkb2MubG9jYWxpdHlOYW1lLFxuICAgICAgZG9jLmNsaWVudE5hbWUsXG4gICAgICBkb2Mub3JpZ2luYWxWZW5kb3IsXG4gICAgICBkb2MubmV3VmVuZG9yLFxuICAgICAgZG9jLm5ld1R5cGUsXG4gICAgICBkb2MudXBkYXRlZEF0LFxuICAgICAgZG9jLnVwZGF0ZWRCeVVpZCxcbiAgICAgIGRvYy51cGRhdGVkQnlFbWFpbCxcbiAgICAgIGRvYy51cGRhdGVkQnlEaXNwbGF5TmFtZSxcbiAgICBdLFxuICBdO1xufVxuXG4vKiogQHBhcmFtIHthbnl9IGRvYyBAcmV0dXJucyB7dW5rbm93bltdW119ICovXG5leHBvcnQgZnVuY3Rpb24gYnVpbGRDdXN0b21Sb3V0ZVJvd3MoZG9jKSB7XG4gIGNvbnN0IGhlYWRlciA9IFtcbiAgICBkb2MuX2lkLFxuICAgIGRvYy5vd25lclVpZCxcbiAgICBkb2Mub3duZXJFbWFpbCxcbiAgICBkb2MubmFtZSxcbiAgICBkb2MucGxhbm5lZERhdGUsXG4gICAgZG9jLm5vdGVzLFxuICAgIGRvYy5jcmVhdGVkQXQsXG4gICAgZG9jLnVwZGF0ZWRBdCxcbiAgXTtcbiAgY29uc3Qgc3RvcHMgPSBBcnJheS5pc0FycmF5KGRvYy5zdG9wcykgPyBkb2Muc3RvcHMgOiBbXTtcbiAgaWYgKCFzdG9wcy5sZW5ndGgpIHtcbiAgICByZXR1cm4gW2hlYWRlci5jb25jYXQoW251bGwsIG51bGwsIG51bGwsIG51bGwsIG51bGwsIG51bGwsIG51bGwsIG51bGxdKV07XG4gIH1cbiAgcmV0dXJuIHN0b3BzLm1hcCgoLyoqIEB0eXBlIHthbnl9ICovIHMpID0+XG4gICAgaGVhZGVyLmNvbmNhdChbXG4gICAgICBzID8gcy5vcmRlciA6IG51bGwsXG4gICAgICBzID8gcy5rZXkgOiBudWxsLFxuICAgICAgcyA/IHMudGlwbyA6IG51bGwsXG4gICAgICBzID8gcy5wcm92aW5jaWEgOiBudWxsLFxuICAgICAgcyA/IHMubG9jYWxpZGFkIDogbnVsbCxcbiAgICAgIHMgPyBzLmNsaWVudE5hbWUgOiBudWxsLFxuICAgICAgcyA/IHMuaXNQcm92aXNvcmlvIDogbnVsbCxcbiAgICAgIHMgPyBzLnNhcEFsdGFJZCA6IG51bGwsXG4gICAgXSlcbiAgKTtcbn1cblxuLyoqIEBwYXJhbSB7YW55fSBkb2MgQHJldHVybnMge3Vua25vd25bXVtdfSAqL1xuZXhwb3J0IGZ1bmN0aW9uIGJ1aWxkU2VndWltaWVudG9Ob3RlUm93cyhkb2MpIHtcbiAgcmV0dXJuIFtcbiAgICBbXG4gICAgICBkb2MuX2lkLFxuICAgICAgZG9jLnZlbmRvckV4dCxcbiAgICAgIGRvYy5jbGllbnRLZXksXG4gICAgICBkb2MuY2xpZW50TmFtZSxcbiAgICAgIGRvYy5wcm92aW5jZSxcbiAgICAgIGRvYy5sb2NhbGl0eSxcbiAgICAgIGRvYy50ZXh0LFxuICAgICAgZG9jLmF1dGhvclVpZCxcbiAgICAgIGRvYy5hdXRob3JFbWFpbCxcbiAgICAgIGRvYy5hdXRob3JOYW1lLFxuICAgICAgZG9jLmF1dGhvclJvbGUsXG4gICAgICBkb2MuY3JlYXRlZEF0LFxuICAgIF0sXG4gIF07XG59XG5cbi8qKlxuICogUHJvZHVjdG9zIGRlc2RlIHN0b2NrLmpzb24gKGZvcm1hdG8gU2hpbWFubzoge3N0b2NrOiB7U0tVOiBib29sLCAuLi59LFxuICogcXVhbnRpdGllczogSlNPTiBzdHJpbmcsIHdhcmVob3VzZUJyZWFrZG93bjogSlNPTiBzdHJpbmcsIHVwZGF0ZWRBdDogLi4ufSkuXG4gKiBAcGFyYW0ge29iamVjdH0gc3RvY2tKc29uXG4gKiBAcmV0dXJucyB7dW5rbm93bltdW119XG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBidWlsZFByb2R1Y3RvUm93c0Zyb21TdG9ja0pzb24oc3RvY2tKc29uKSB7XG4gIGNvbnN0IHNqID0gLyoqIEB0eXBlIHthbnl9ICovIChzdG9ja0pzb24pIHx8IHt9O1xuICBjb25zdCBzdG9ja01hcCA9IHNqLnN0b2NrIHx8IHt9O1xuICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIG51bWJlcj59ICovXG4gIGxldCBxdWFudGl0aWVzID0ge307XG4gIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmVjb3JkPHN0cmluZywgbnVtYmVyPj59ICovXG4gIGxldCBicmVha2Rvd24gPSB7fTtcbiAgdHJ5IHtcbiAgICBxdWFudGl0aWVzID0gc2oucXVhbnRpdGllcyA/IEpTT04ucGFyc2Uoc2oucXVhbnRpdGllcykgOiBzai5xdWFudGl0aWVzX21hcCB8fCB7fTtcbiAgfSBjYXRjaCAoXykge31cbiAgdHJ5IHtcbiAgICBicmVha2Rvd24gPSBzai53YXJlaG91c2VCcmVha2Rvd25cbiAgICAgID8gSlNPTi5wYXJzZShzai53YXJlaG91c2VCcmVha2Rvd24pXG4gICAgICA6IHNqLndhcmVob3VzZUJyZWFrZG93bl9tYXAgfHwge307XG4gIH0gY2F0Y2ggKF8pIHt9XG4gIGNvbnN0IHJvd3MgPSAvKiogQHR5cGUge3Vua25vd25bXVtdfSAqLyAoW10pO1xuICBjb25zdCBzb3VyY2UgPSAnc3RvY2suanNvbiBzbmFwc2hvdCc7XG4gIGNvbnN0IHVwZGF0ZWRBdCA9IHNqLnVwZGF0ZWRBdCB8fCBzai5zbmFwc2hvdEF0IHx8IG51bGw7XG4gIGZvciAoY29uc3Qgc2t1IG9mIE9iamVjdC5rZXlzKHN0b2NrTWFwKSkge1xuICAgIGNvbnN0IGhhc19zdG9jayA9ICEhc3RvY2tNYXBbc2t1XTtcbiAgICBjb25zdCB0b3RhbCA9IE51bWJlcihxdWFudGl0aWVzW3NrdV0gfHwgMCk7XG4gICAgY29uc3Qgd2JzID0gYnJlYWtkb3duW3NrdV0gfHwge307XG4gICAgY29uc3QgdzExID0gTnVtYmVyKHdic1snMTEnXSB8fCAwKTtcbiAgICBjb25zdCB3MTIgPSBOdW1iZXIod2JzWycxMiddIHx8IDApO1xuICAgIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgbnVtYmVyPn0gKi9cbiAgICBjb25zdCBvdHJvcyA9IHt9O1xuICAgIGZvciAoY29uc3QgayBvZiBPYmplY3Qua2V5cyh3YnMpKSB7XG4gICAgICBpZiAoayAhPT0gJzExJyAmJiBrICE9PSAnMTInKSBvdHJvc1trXSA9IE51bWJlcih3YnNba10gfHwgMCk7XG4gICAgfVxuICAgIHJvd3MucHVzaChbXG4gICAgICBza3UsXG4gICAgICBoYXNfc3RvY2ssXG4gICAgICB0b3RhbCxcbiAgICAgIHcxMSxcbiAgICAgIHcxMixcbiAgICAgIE9iamVjdC5rZXlzKG90cm9zKS5sZW5ndGggPyBvdHJvcyA6IG51bGwsXG4gICAgICBzb3VyY2UsXG4gICAgICB1cGRhdGVkQXQsXG4gICAgXSk7XG4gIH1cbiAgcmV0dXJuIHJvd3M7XG59XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gRGlzcGF0Y2hlcjogbWFwYSBjb2xsZWN0aW9uIC0+IHJvdyBidWlsZGVyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCAoZG9jOiBhbnkpID0+IHVua25vd25bXVtdPn0gKi9cbmV4cG9ydCBjb25zdCBST1dfQlVJTERFUlMgPSB7XG4gIHBlZGlkb3M6IGJ1aWxkUGVkaWRvUm93cyxcbiAgdmlzaXRhczogYnVpbGRWaXNpdGFSb3dzLFxuICBjbGllbnRlczogYnVpbGRDbGllbnRlUm93cyxcbiAgY2xpZW50X21hc3RlcjogYnVpbGRDbGllbnRNYXN0ZXJSb3dzLFxuICByZW5kaWNpb25lczogYnVpbGRSZW5kaWNpb25Sb3dzLFxuICBjYW1wYW5pYXM6IGJ1aWxkQ2FtcGFuaWFSb3dzLFxuICB0YXJnZXRzOiBidWlsZFRhcmdldFJvd3MsXG4gIHZlbmRvcl9vdmVycmlkZXM6IGJ1aWxkVmVuZG9yT3ZlcnJpZGVSb3dzLFxuICBjdXN0b21fcm91dGVzOiBidWlsZEN1c3RvbVJvdXRlUm93cyxcbiAgc2VndWltaWVudG9fbm90ZXM6IGJ1aWxkU2VndWltaWVudG9Ob3RlUm93cyxcbn07XG4iLCAiLy8gQHRzLW5vY2hlY2tcclxuLy8gRVhQT1JUUy1BRFZBTkNFRDogcGhvdG8gWklQcywgYXVkaXQgWExTWCwgZXhlY3V0aXZlIHN1bW1hcnksIHZpc2l0cyBYTFNYLFxyXG4vLyBQb3dlckJJIGRhdGFzZXQsIE1MIGRhdGFzZXQuIEV4dHJhXHUwMEVEZG8gdmVyYmF0aW0gZGUgaW5kZXguaHRtbCAoNCBmcmFnbWVudG9zXHJcbi8vIGRpc2NvbnRpbnVvcyBzZXBhcmFkb3MgcG9yIEJhY2t1cCArIEF1ZGl0ICsgX2V4cG9ydExlZ2FjeUZ1bGwgcXVlIHF1ZWRhblxyXG4vLyBlbiBlbCBpbmxpbmUpIGNvbW8gcGFydGUgZGUgRTIubi4yIChlMmItcGVyZiAyMDI2LTA3LTI4KS5cclxuLy9cclxuLy8gdjM3MSs6IGV4cG9ydERhdGFzZXRaaXAoKSBudWV2byBcdTIwMTQgWklQIGNvbiBDU1ZzIHBvciBlbnRpZGFkIHBhcmEgcGlwZWxpbmVzXHJcbi8vIE1MIGV4dGVybm9zIChNaWNyb3NvZnQgRmFicmljKS4gSW1wb3J0YSBsb3MgaGVscGVycyBwdXJvcyB5IHNjaGVtYXMgZGVsXHJcbi8vIG1vZHVsbyBzcmMvcHVyZS9jc3Ytc2VyaWFsaXplci5qcy4gVmVyIHBsYW4gY29zbWljLXBvbmRlcmluZy1zdGVhcm5zLm1kLlxyXG5cclxuaW1wb3J0IHtcclxuICBidWlsZENzdixcclxuICBidWlsZFByb2R1Y3RvUm93c0Zyb21TdG9ja0pzb24sXHJcbiAgY29tcHV0ZU51bGxSYXRlcyxcclxuICBEQVRBU0VUX1NDSEVNQVMsXHJcbiAgREFUQVNFVF9VU0VfQ0FTRV9NQVRSSVgsXHJcbiAgUk9XX0JVSUxERVJTLFxyXG59IGZyb20gJy4uL3B1cmUvY3N2LXNlcmlhbGl6ZXIuanMnO1xyXG5cclxuLy9cclxuLy8gRGVwcyBkZWwgaW5saW5lOiBKU1ppcCAoQ0ROIGxhenkpLCBFeGNlbEpTIChDRE4gbGF6eSB2aWEgbG9hZEV4Y2VsSlMpLFxyXG4vLyBYTFNYIChkZWZlciBlbiBoZWFkKSwgdmlzaXRzQ2FjaGUsIGNhbXBhaWduc0NhY2hlLCBvcHNMb2dDYWNoZSAoYXVkaXRcclxuLy8gaW5saW5lKSwgYXVkaXRMb2dDYWNoZSAoYXVkaXQgaW5saW5lKSwgY29udGFjdGVkIChnbG9iYWwgU2V0KSwgUE9JTlRTLFxyXG4vLyBQUk9EVUNUUywgVkVORE9SUywgTUVTRVMsIHZlbmRvckxvb2t1cCwgZXNjYXBlSHRtbCwgZXNjYXBlQXR0ciwgdGl0bGVDYXNlLFxyXG4vLyBzaG93U3luY1RhZywgY3VycmVudFVzZXIsIHVzZXJSb2xlLCBvcmRlcnMsIGNvbmZpcm1lZCwgcGVuZGluZy5cclxuLy9cclxuLy8gQ3Jvc3Mtc2NvcGUgc3RhdGU6IE5PTkUgKHRvZG9zIGxvcyBoZWxwZXJzIHkgY29uc3RzIGxvY2FsZXMgYWwgYmxvcXVlKS5cclxuLy8gU2luIGxpc3RlbmVycyBvblNuYXBzaG90LlxyXG4vL1xyXG4vLyBOT1RBOiBsb3MgaGVscGVycyB0b2RheVN0ci9kYXRhVXJsVG9CbG9iL3Nhbml0aXplRm9yUGF0aCB2aXZlbiBlbiBlc3RlXHJcbi8vIG1cdTAwRjNkdWxvIFx1MjAxNCBlbCBpbmxpbmUgcHVlZGUgbGxhbWFybG9zIHZpYSBmcmVlIHJlZmVyZW5jZSBhbCBHbG9iYWwgRW52aXJvbm1lbnRcclxuLy8gUmVjb3JkIHBlcm8gcHJlZmVyaW1vcyBleHBvc2ljaVx1MDBGM24gd2luZG93LiogZXhwbFx1MDBFRGNpdGEgYWwgZmluYWwuXHJcblxyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XHJcbi8vIFNFQ0NJXHUwMEQzTjogaGVscGVycyArIHBob3RvcyB6aXAgKyB2aXNpdHMgZW1iZWRkZWQgKGlubGluZSBMOTI1Ni05NDQ1KVxyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxuXHJcbmZ1bmN0aW9uIHRvZGF5U3RyKCkge1xyXG4gIHJldHVybiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwgMTApO1xyXG59XHJcblxyXG4vLyBIZWxwZXI6IGNvbnZlcnRpciBkYXRhVVJMIGJhc2U2NCBhIEJsb2IgcGFyYSBpbmNsdWlyIGVuIFpJUFxyXG5mdW5jdGlvbiBkYXRhVXJsVG9CbG9iKGRhdGFVcmwpIHtcclxuICBpZiAoIWRhdGFVcmwpIHJldHVybiBudWxsO1xyXG4gIGNvbnN0IHBhcnRzID0gZGF0YVVybC5zcGxpdCgnLCcpO1xyXG4gIGlmIChwYXJ0cy5sZW5ndGggPCAyKSByZXR1cm4gbnVsbDtcclxuICBjb25zdCBtaW1lTWF0Y2ggPSBwYXJ0c1swXS5tYXRjaCgvOiguKj8pOy8pO1xyXG4gIGNvbnN0IG1pbWUgPSBtaW1lTWF0Y2ggPyBtaW1lTWF0Y2hbMV0gOiAnaW1hZ2UvanBlZyc7XHJcbiAgY29uc3QgYnl0ZXMgPSBhdG9iKHBhcnRzWzFdKTtcclxuICBjb25zdCBhcnIgPSBuZXcgVWludDhBcnJheShieXRlcy5sZW5ndGgpO1xyXG4gIGZvciAobGV0IGkgPSAwOyBpIDwgYnl0ZXMubGVuZ3RoOyBpKyspIGFycltpXSA9IGJ5dGVzLmNoYXJDb2RlQXQoaSk7XHJcbiAgcmV0dXJuIG5ldyBCbG9iKFthcnJdLCB7IHR5cGU6IG1pbWUgfSk7XHJcbn1cclxuXHJcbi8vIFNhbmVhciBub21icmVzIHBhcmEgcXVlIHNpcnZhbiBjb21vIHJ1dGEgZGUgYXJjaGl2b1xyXG5mdW5jdGlvbiBzYW5pdGl6ZUZvclBhdGgocykge1xyXG4gIHJldHVybiBTdHJpbmcocyB8fCAnJylcclxuICAgIC5yZXBsYWNlKC9bXFxcXC8qP1tcXF06fFwiPD5dL2csICdfJylcclxuICAgIC5yZXBsYWNlKC9cXHMrL2csICcgJylcclxuICAgIC50cmltKClcclxuICAgIC5zbGljZSgwLCA2MCk7XHJcbn1cclxuXHJcbi8vIERlc2NhcmdhciB0b2RhcyBsYXMgZm90b3MgZGUgdmlzaXRhcyBlbiB1biBaSVAgb3JnYW5pemFkbyBwb3IgdmVuZGVkb3IgLyB0aWVuZGEgLyBmZWNoYVxyXG53aW5kb3cuZXhwb3J0UGhvdG9zWmlwID0gYXN5bmMgZnVuY3Rpb24gKCkge1xyXG4gIGlmICh0eXBlb2YgSlNaaXAgPT09ICd1bmRlZmluZWQnKSB7XHJcbiAgICBhbGVydCgnQ2FyZ2FuZG8gbGlicmVyaWEgWklQLCBpbnRlbnRhIGRlIG51ZXZvIGVuIDUgc2VndW5kb3MuJyk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIGlmICghdmlzaXRzQ2FjaGUgfHwgIXZpc2l0c0NhY2hlLmxlbmd0aCkge1xyXG4gICAgYWxlcnQoJ05vIGhheSB2aXNpdGFzIHJlZ2lzdHJhZGFzLicpO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuICBsZXQgcGhvdG9Db3VudCA9IDA7XHJcbiAgY29uc3QgemlwID0gbmV3IEpTWmlwKCk7XHJcbiAgdmlzaXRzQ2FjaGUuZm9yRWFjaCgodikgPT4ge1xyXG4gICAgY29uc3QgdmVuZG9yID0gc2FuaXRpemVGb3JQYXRoKHRpdGxlQ2FzZSh2LnZlbmRvciB8fCAnU0lOX1ZFTkRFRE9SJykpO1xyXG4gICAgY29uc3QgdGllbmRhID0gc2FuaXRpemVGb3JQYXRoKHYudGllbmRhIHx8ICdzaW5fdGllbmRhJyk7XHJcbiAgICBjb25zdCBmZWNoYSA9ICh2LmZlY2hhIHx8ICcnKS5yZXBsYWNlKC8tL2csICcnKTtcclxuICAgIGNvbnN0IGZvbGRlck5hbWUgPSB2ZW5kb3IgKyAnLycgKyB0aWVuZGEgKyAnXycgKyBmZWNoYTtcclxuICAgIGNvbnN0IGZvbGRlciA9IHppcC5mb2xkZXIoZm9sZGVyTmFtZSk7XHJcbiAgICBpZiAodi5mcmVudGVMb2NhbCkge1xyXG4gICAgICBjb25zdCBiID0gZGF0YVVybFRvQmxvYih2LmZyZW50ZUxvY2FsKTtcclxuICAgICAgaWYgKGIpIHtcclxuICAgICAgICBmb2xkZXIuZmlsZSgnZnJlbnRlLmpwZycsIGIpO1xyXG4gICAgICAgIHBob3RvQ291bnQrKztcclxuICAgICAgfVxyXG4gICAgfVxyXG4gICAgKHYuZXNwYWNpbyB8fCBbXSkuZm9yRWFjaCgoYjY0LCBpKSA9PiB7XHJcbiAgICAgIGNvbnN0IGIgPSBkYXRhVXJsVG9CbG9iKGI2NCk7XHJcbiAgICAgIGlmIChiKSB7XHJcbiAgICAgICAgZm9sZGVyLmZpbGUoJ2VzcGFjaW9fJyArIChpICsgMSkgKyAnLmpwZycsIGIpO1xyXG4gICAgICAgIHBob3RvQ291bnQrKztcclxuICAgICAgfVxyXG4gICAgfSk7XHJcbiAgfSk7XHJcbiAgaWYgKCFwaG90b0NvdW50KSB7XHJcbiAgICBhbGVydCgnTm8gaGF5IGZvdG9zIGNhcmdhZGFzIGVuIGxhcyB2aXNpdGFzLicpO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuICBzaG93U3luY1RhZygnR2VuZXJhbmRvIFpJUCBkZSAnICsgcGhvdG9Db3VudCArICcgZm90b3MuLi4nLCAzMDAwMCk7XHJcbiAgdHJ5IHtcclxuICAgIGNvbnN0IGJsb2IgPSBhd2FpdCB6aXAuZ2VuZXJhdGVBc3luYyh7IHR5cGU6ICdibG9iJywgY29tcHJlc3Npb246ICdERUZMQVRFJyB9KTtcclxuICAgIGNvbnN0IHVybCA9IFVSTC5jcmVhdGVPYmplY3RVUkwoYmxvYik7XHJcbiAgICBjb25zdCBhID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnYScpO1xyXG4gICAgYS5ocmVmID0gdXJsO1xyXG4gICAgYS5kb3dubG9hZCA9ICdTaGltYW5vX0ZvdG9zX1Zpc2l0YXNfJyArIHRvZGF5U3RyKCkgKyAnLnppcCc7XHJcbiAgICBhLmNsaWNrKCk7XHJcbiAgICBzZXRUaW1lb3V0KCgpID0+IFVSTC5yZXZva2VPYmplY3RVUkwodXJsKSwgNTAwMCk7XHJcbiAgICBzaG93U3luY1RhZyhwaG90b0NvdW50ICsgJyBmb3RvcyBkZXNjYXJnYWRhcycsIDMwMDApO1xyXG4gIH0gY2F0Y2ggKGUpIHtcclxuICAgIGNvbnNvbGUuZXJyb3IoJ3ppcCcsIGUpO1xyXG4gICAgYWxlcnQoJ0Vycm9yIGdlbmVyYW5kbyBaSVA6ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcclxuICB9XHJcbn07XHJcblxyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxuLy8gRXhjZWwgY29uIGZvdG9zIGRlbCBmcmVudGUgZW1iZWJpZGFzIGVuIGNhZGEgY2VsZGEgKEV4Y2VsSlMpXHJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG4vLyBFeGNlbEpTIHNlIGNhcmdhIGxhenkgKHNvbG8gY3VhbmRvIHNlIHRvY2EgZWwgYm90b24pIHBhcmEgbm8gaW5mbGFyIGVsIGJ1bmRsZS5cclxuZnVuY3Rpb24gbG9hZEV4Y2VsSlMoKSB7XHJcbiAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcclxuICAgIGlmICh0eXBlb2YgRXhjZWxKUyAhPT0gJ3VuZGVmaW5lZCcpIHJldHVybiByZXNvbHZlKCk7XHJcbiAgICBjb25zdCBzID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnc2NyaXB0Jyk7XHJcbiAgICBzLnNyYyA9ICdodHRwczovL2Nkbi5qc2RlbGl2ci5uZXQvbnBtL2V4Y2VsanNANC40LjAvZGlzdC9leGNlbGpzLm1pbi5qcyc7XHJcbiAgICBzLm9ubG9hZCA9ICgpID0+IHJlc29sdmUoKTtcclxuICAgIHMub25lcnJvciA9ICgpID0+XHJcbiAgICAgIHJlamVjdChuZXcgRXJyb3IoJ05vIHNlIHB1ZG8gY2FyZ2FyIGxhIGxpYnJlcmlhIEV4Y2VsSlMuIFJldmlzYSB0dSBjb25leGlvbiBhIGludGVybmV0LicpKTtcclxuICAgIGRvY3VtZW50LmhlYWQuYXBwZW5kQ2hpbGQocyk7XHJcbiAgfSk7XHJcbn1cclxuXHJcbndpbmRvdy5leHBvcnRWaXNpdHNXaXRoRW1iZWRkZWRQaG90b3MgPSBhc3luYyBmdW5jdGlvbiAoKSB7XHJcbiAgaWYgKCF2aXNpdHNDYWNoZSB8fCAhdmlzaXRzQ2FjaGUubGVuZ3RoKSB7XHJcbiAgICBhbGVydCgnTm8gaGF5IHZpc2l0YXMgcmVnaXN0cmFkYXMuJyk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIGNvbnN0IG4gPSB2aXNpdHNDYWNoZS5sZW5ndGg7XHJcbiAgaWYgKG4gPiAzMDApIHtcclxuICAgIGlmIChcclxuICAgICAgIWNvbmZpcm0oXHJcbiAgICAgICAgJ0hheSAnICtcclxuICAgICAgICAgIG4gK1xyXG4gICAgICAgICAgJyB2aXNpdGFzLiBFbCBFeGNlbCBjb24gdG9kYXMgbGFzIGZvdG9zIGVtYmViaWRhcyBwdWVkZSBwZXNhciA1MC0xNTAgTUIgeSB0YXJkYXIgdmFyaW9zIG1pbnV0b3MuIFx1MDBCRkNvbnRpbnVhcj8nXHJcbiAgICAgIClcclxuICAgIClcclxuICAgICAgcmV0dXJuO1xyXG4gIH0gZWxzZSBpZiAobiA+IDEwMCkge1xyXG4gICAgaWYgKFxyXG4gICAgICAhY29uZmlybShcclxuICAgICAgICAnVmFzIGEgZ2VuZXJhciB1biBFeGNlbCBjb24gJyArXHJcbiAgICAgICAgICBuICtcclxuICAgICAgICAgICcgdmlzaXRhcyB5IHN1cyBmb3RvcyBlbWJlYmlkYXMuIFB1ZWRlIHRhcmRhciAzMC02MCBzZWd1bmRvcy4gXHUwMEJGQ29udGludWFyPydcclxuICAgICAgKVxyXG4gICAgKVxyXG4gICAgICByZXR1cm47XHJcbiAgfVxyXG4gIHNob3dTeW5jVGFnKCdDYXJnYW5kbyBFeGNlbEpTLi4uJywgMjAwMCk7XHJcbiAgdHJ5IHtcclxuICAgIGF3YWl0IGxvYWRFeGNlbEpTKCk7XHJcbiAgfSBjYXRjaCAoZSkge1xyXG4gICAgYWxlcnQoZS5tZXNzYWdlIHx8IGUpO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuXHJcbiAgc2hvd1N5bmNUYWcoJ0dlbmVyYW5kbyBFeGNlbCBjb24gJyArIG4gKyAnIHZpc2l0YXMuLi4nLCAzMDAwKTtcclxuXHJcbiAgY29uc3Qgd2IgPSBuZXcgRXhjZWxKUy5Xb3JrYm9vaygpO1xyXG4gIHdiLmNyZWF0b3IgPSAnQXBwIFZlbmRlZG9yZXMgU2hpbWFubyc7XHJcbiAgd2IuY3JlYXRlZCA9IG5ldyBEYXRlKCk7XHJcbiAgY29uc3Qgd3MgPSB3Yi5hZGRXb3Jrc2hlZXQoJ1Zpc2l0YXMnLCB7IHZpZXdzOiBbeyBzdGF0ZTogJ2Zyb3plbicsIHlTcGxpdDogMSB9XSB9KTtcclxuXHJcbiAgLy8gRGVmaW5pY2lvbiBkZSBjb2x1bW5hcy4gTGEgY29sdW1uYSBkZSBmb3RvIHZhIGEgdGVuZXIgYW5jaG8gZXh0cmEgcGFyYSBxdWUgc2UgdmVhLlxyXG4gIHdzLmNvbHVtbnMgPSBbXHJcbiAgICB7IGhlYWRlcjogJ0ZlY2hhJywga2V5OiAnZmVjaGEnLCB3aWR0aDogMTIgfSxcclxuICAgIHsgaGVhZGVyOiAnTWVzJywga2V5OiAnbWVzJywgd2lkdGg6IDEwIH0sXHJcbiAgICB7IGhlYWRlcjogJ1ZlbmRlZG9yJywga2V5OiAndmVuZGVkb3InLCB3aWR0aDogMjIgfSxcclxuICAgIHsgaGVhZGVyOiAnVGlwbyBjb250YWN0bycsIGtleTogJ3RpcG9DdCcsIHdpZHRoOiAxMiB9LFxyXG4gICAgeyBoZWFkZXI6ICdDb21lbnRhcmlvJywga2V5OiAnY29tZW50Jywgd2lkdGg6IDMyIH0sXHJcbiAgICB7IGhlYWRlcjogJ1Byb3ZpbmNpYScsIGtleTogJ3Byb3ZpbmNpYScsIHdpZHRoOiAxNiB9LFxyXG4gICAgeyBoZWFkZXI6ICdMb2NhbGlkYWQnLCBrZXk6ICdsb2NhbGlkYWQnLCB3aWR0aDogMTggfSxcclxuICAgIHsgaGVhZGVyOiAnVGllbmRhJywga2V5OiAndGllbmRhJywgd2lkdGg6IDMwIH0sXHJcbiAgICB7IGhlYWRlcjogJ1RpcG8nLCBrZXk6ICd0aXBvJywgd2lkdGg6IDEyIH0sXHJcbiAgICB7IGhlYWRlcjogJ0xvY2FsJywga2V5OiAnbG9jYWwnLCB3aWR0aDogMTIgfSxcclxuICAgIHsgaGVhZGVyOiAnVGFtYW5vJywga2V5OiAndGFtYW5vJywgd2lkdGg6IDEwIH0sXHJcbiAgICB7IGhlYWRlcjogJ0ZpZGVsaWRhZCcsIGtleTogJ2ZpZGVsaWRhZCcsIHdpZHRoOiAxMCB9LFxyXG4gICAgeyBoZWFkZXI6ICdSZWxldmFuY2lhJywga2V5OiAncmVsZXYnLCB3aWR0aDogMTAgfSxcclxuICAgIHsgaGVhZGVyOiAnUE9QJywga2V5OiAncG9wJywgd2lkdGg6IDggfSxcclxuICAgIHsgaGVhZGVyOiAnVGlwbyB2ZW50YScsIGtleTogJ3RpcG9WZW50YScsIHdpZHRoOiAxMiB9LFxyXG4gICAgeyBoZWFkZXI6ICdDb21wZXRlbmNpYScsIGtleTogJ2NvbXBlJywgd2lkdGg6IDE2IH0sXHJcbiAgICB7IGhlYWRlcjogJ09wb3J0dW5pZGFkJywga2V5OiAnb3BvcnR1Jywgd2lkdGg6IDMwIH0sXHJcbiAgICB7IGhlYWRlcjogJ0xvIG1hcyB2ZW5kaWRvJywga2V5OiAnbWFzVmUnLCB3aWR0aDogMjggfSxcclxuICAgIHsgaGVhZGVyOiAnR1BTIGRpc3QgKG0pJywga2V5OiAnZ3BzRGlzdCcsIHdpZHRoOiAxMiB9LFxyXG4gICAgeyBoZWFkZXI6ICdGb3RvIGZyZW50ZScsIGtleTogJ2ZvdG8nLCB3aWR0aDogMjIgfSwgLy8gPC0gbGEgaW1hZ2VuIHZhIGFjYVxyXG4gICAgeyBoZWFkZXI6ICdFbWFpbCB2ZW5kZWRvcicsIGtleTogJ2VtYWlsJywgd2lkdGg6IDI4IH0sXHJcbiAgXTtcclxuXHJcbiAgLy8gRXN0aWxvIGhlYWRlclxyXG4gIHdzLmdldFJvdygxKS5mb250ID0geyBib2xkOiB0cnVlLCBjb2xvcjogeyBhcmdiOiAnRkZGRkZGRkYnIH0gfTtcclxuICB3cy5nZXRSb3coMSkuZmlsbCA9IHsgdHlwZTogJ3BhdHRlcm4nLCBwYXR0ZXJuOiAnc29saWQnLCBmZ0NvbG9yOiB7IGFyZ2I6ICdGRjBDNEE2RScgfSB9O1xyXG4gIHdzLmdldFJvdygxKS5hbGlnbm1lbnQgPSB7IHZlcnRpY2FsOiAnbWlkZGxlJywgaG9yaXpvbnRhbDogJ2NlbnRlcicgfTtcclxuICB3cy5nZXRSb3coMSkuaGVpZ2h0ID0gMjI7XHJcblxyXG4gIGNvbnN0IEZPVE9fQ09MX0lEWCA9IHdzLmdldENvbHVtbignZm90bycpLm51bWJlciAtIDE7IC8vIDAtaW5kZXhlZCBwYXJhIGFkZEltYWdlXHJcbiAgY29uc3QgUk9XX0ggPSAxMDA7XHJcbiAgY29uc3QgSU1HX1cgPSAxMzA7XHJcbiAgY29uc3QgSU1HX0ggPSA5MDtcclxuXHJcbiAgLy8gT3JkZW5hciB2aXNpdGFzIHBvciBmZWNoYSBkZXNjIChtYXMgcmVjaWVudGVzIHByaW1lcm8pXHJcbiAgY29uc3Qgc29ydGVkID0gdmlzaXRzQ2FjaGUuc2xpY2UoKS5zb3J0KChhLCBiKSA9PiAoYi5mZWNoYSB8fCAnJykubG9jYWxlQ29tcGFyZShhLmZlY2hhIHx8ICcnKSk7XHJcblxyXG4gIGZvciAoY29uc3QgdiBvZiBzb3J0ZWQpIHtcclxuICAgIGNvbnN0IHRpcG9Db250YWN0b0xibCA9IHYudGlwb0NvbnRhY3RvID09PSAndGVsZWZvbm8nID8gJ1RlbGVmb25vJyA6ICdQcmVzZW5jaWFsJztcclxuICAgIGNvbnN0IHIgPSB3cy5hZGRSb3coe1xyXG4gICAgICBmZWNoYTogdi5mZWNoYSB8fCAnJyxcclxuICAgICAgbWVzOiB2Lm1lcyB8fCAnJyxcclxuICAgICAgdmVuZGVkb3I6IHRpdGxlQ2FzZSh2LnZlbmRvciB8fCAnJyksXHJcbiAgICAgIHRpcG9DdDogdGlwb0NvbnRhY3RvTGJsLFxyXG4gICAgICBjb21lbnQ6IHYuY29tZW50YXJpbyB8fCAnJyxcclxuICAgICAgcHJvdmluY2lhOiB0aXRsZUNhc2Uodi5wcm92aW5jaWEgfHwgJycpLFxyXG4gICAgICBsb2NhbGlkYWQ6IHYubG9jYWxpZGFkIHx8ICcnLFxyXG4gICAgICB0aWVuZGE6IHYudGllbmRhIHx8ICcnLFxyXG4gICAgICB0aXBvOiB2LnRpcG8gfHwgJycsXHJcbiAgICAgIGxvY2FsOiB2LmxvY2FsIHx8ICcnLFxyXG4gICAgICB0YW1hbm86IHYudGFtYW5vIHx8ICcnLFxyXG4gICAgICBmaWRlbGlkYWQ6IHYuZmlkZWxpZGFkIHx8ICcnLFxyXG4gICAgICByZWxldjogdi5yZWxldmFuY2lhIHx8ICcnLFxyXG4gICAgICBwb3A6IHYucG9wIHx8ICcnLFxyXG4gICAgICB0aXBvVmVudGE6IHYudGlwb1ZlbnRhID09PSAnTU9TVFJBRE8nID8gJ01PU1RSQURPUicgOiB2LnRpcG9WZW50YSB8fCAnJyxcclxuICAgICAgY29tcGU6IHYuY29tcGV0ZW5jaWEgfHwgJycsXHJcbiAgICAgIG9wb3J0dTogdi5vcG9ydHVuaWRhZCB8fCAnJyxcclxuICAgICAgbWFzVmU6IHYubWFzVmVuZGlkbyB8fCAnJyxcclxuICAgICAgZ3BzRGlzdDogdHlwZW9mIHYuZ3BzRGlzdGFuY2VNID09PSAnbnVtYmVyJyA/IHYuZ3BzRGlzdGFuY2VNIDogJycsXHJcbiAgICAgIGZvdG86ICcnLCAvLyBsYSBjZWxkYSBxdWVkYSB2YWNpYTsgZW5jaW1hIHZhIGxhIGltYWdlblxyXG4gICAgICBlbWFpbDogdi5vd25lckVtYWlsIHx8ICcnLFxyXG4gICAgfSk7XHJcbiAgICByLmhlaWdodCA9IFJPV19IO1xyXG4gICAgci5hbGlnbm1lbnQgPSB7IHZlcnRpY2FsOiAnbWlkZGxlJywgd3JhcFRleHQ6IHRydWUgfTtcclxuICAgIGlmICh2LmZyZW50ZUxvY2FsICYmIHR5cGVvZiB2LmZyZW50ZUxvY2FsID09PSAnc3RyaW5nJykge1xyXG4gICAgICB0cnkge1xyXG4gICAgICAgIC8vIEVsIGNhbXBvIGVzIHVuIGRhdGFVUkw6ICdkYXRhOmltYWdlL2pwZWc7YmFzZTY0LC85ai80QUFRLi4uJ1xyXG4gICAgICAgIGxldCBiNjQgPSB2LmZyZW50ZUxvY2FsO1xyXG4gICAgICAgIGxldCBleHQgPSAnanBlZyc7XHJcbiAgICAgICAgY29uc3QgbSA9IC9eZGF0YTppbWFnZVxcLyhcXHcrKTtiYXNlNjQsKC4rKSQvaS5leGVjKGI2NCk7XHJcbiAgICAgICAgaWYgKG0pIHtcclxuICAgICAgICAgIGV4dCA9IG1bMV0udG9Mb3dlckNhc2UoKTtcclxuICAgICAgICAgIGI2NCA9IG1bMl07XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGlmIChleHQgPT09ICdqcGcnKSBleHQgPSAnanBlZyc7XHJcbiAgICAgICAgY29uc3QgaW1hZ2VJZCA9IHdiLmFkZEltYWdlKHsgYmFzZTY0OiBiNjQsIGV4dGVuc2lvbjogZXh0IH0pO1xyXG4gICAgICAgIHdzLmFkZEltYWdlKGltYWdlSWQsIHtcclxuICAgICAgICAgIHRsOiB7IGNvbDogRk9UT19DT0xfSURYICsgMC4xLCByb3c6IHIubnVtYmVyIC0gMSArIDAuMSB9LFxyXG4gICAgICAgICAgZXh0OiB7IHdpZHRoOiBJTUdfVywgaGVpZ2h0OiBJTUdfSCB9LFxyXG4gICAgICAgICAgZWRpdEFzOiAnb25lQ2VsbCcsXHJcbiAgICAgICAgfSk7XHJcbiAgICAgIH0gY2F0Y2ggKGUpIHtcclxuICAgICAgICBjb25zb2xlLndhcm4oJ2VtYmViaWVuZG8gZm90byBmaWxhJywgci5udW1iZXIsIGUpO1xyXG4gICAgICB9XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICAvLyBHZW5lcmFyIHkgZGVzY2FyZ2FyXHJcbiAgdHJ5IHtcclxuICAgIGNvbnN0IGJ1ZmZlciA9IGF3YWl0IHdiLnhsc3gud3JpdGVCdWZmZXIoKTtcclxuICAgIGNvbnN0IGJsb2IgPSBuZXcgQmxvYihbYnVmZmVyXSwge1xyXG4gICAgICB0eXBlOiAnYXBwbGljYXRpb24vdm5kLm9wZW54bWxmb3JtYXRzLW9mZmljZWRvY3VtZW50LnNwcmVhZHNoZWV0bWwuc2hlZXQnLFxyXG4gICAgfSk7XHJcbiAgICBjb25zdCB1cmwgPSBVUkwuY3JlYXRlT2JqZWN0VVJMKGJsb2IpO1xyXG4gICAgY29uc3QgYSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2EnKTtcclxuICAgIGEuaHJlZiA9IHVybDtcclxuICAgIGEuZG93bmxvYWQgPSAnU2hpbWFub19WaXNpdGFzX2Nvbl9mb3Rvc18nICsgdG9kYXlTdHIoKSArICcueGxzeCc7XHJcbiAgICBkb2N1bWVudC5ib2R5LmFwcGVuZENoaWxkKGEpO1xyXG4gICAgYS5jbGljaygpO1xyXG4gICAgZG9jdW1lbnQuYm9keS5yZW1vdmVDaGlsZChhKTtcclxuICAgIHNldFRpbWVvdXQoKCkgPT4gVVJMLnJldm9rZU9iamVjdFVSTCh1cmwpLCA1MDAwKTtcclxuICAgIHNob3dTeW5jVGFnKCdFeGNlbCBkZXNjYXJnYWRvOiAnICsgc29ydGVkLmxlbmd0aCArICcgdmlzaXRhcycsIDMwMDApO1xyXG4gIH0gY2F0Y2ggKGUpIHtcclxuICAgIGNvbnNvbGUuZXJyb3IoJ2V4cG9ydFZpc2l0c1dpdGhFbWJlZGRlZFBob3RvcycsIGUpO1xyXG4gICAgYWxlcnQoJ0Vycm9yIGdlbmVyYW5kbyBlbCBFeGNlbDogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xyXG4gIH1cclxufTtcclxuXHJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxuLy8gU0VDQ0lcdTAwRDNOOiBleHBvcnRBdWRpdEV4Y2VsIChpbmxpbmUgTDEwMDQwLTEwMDY3KVxyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxuXHJcbndpbmRvdy5leHBvcnRBdWRpdEV4Y2VsID0gZnVuY3Rpb24gKCkge1xyXG4gIGlmICh0eXBlb2YgWExTWCA9PT0gJ3VuZGVmaW5lZCcpIHtcclxuICAgIGFsZXJ0KCdMYSBsaWJyZXJpYSBkZSBFeGNlbCBubyBzZSBjYXJnby4nKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgY29uc3QgaXRlbXMgPSBnZXRGaWx0ZXJlZEF1ZGl0RW50cmllcygpO1xyXG4gIGlmICghaXRlbXMubGVuZ3RoKSB7XHJcbiAgICBhbGVydCgnTm8gaGF5IGV2ZW50b3MgcGFyYSBleHBvcnRhciBjb24gbG9zIGZpbHRyb3MgYXBsaWNhZG9zLicpO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuICBjb25zdCByb3dzID0gaXRlbXMubWFwKChlKSA9PiB7XHJcbiAgICBjb25zdCB0cyA9IGUudGltZXN0YW1wICYmIGUudGltZXN0YW1wLnRvRGF0ZSA/IGUudGltZXN0YW1wLnRvRGF0ZSgpIDogbnVsbDtcclxuICAgIHJldHVybiB7XHJcbiAgICAgIEZlY2hhX0hvcmE6IHRzID8gdHMudG9JU09TdHJpbmcoKS5yZXBsYWNlKCdUJywgJyAnKS5zbGljZSgwLCAxOSkgOiAnJyxcclxuICAgICAgVXN1YXJpb19FbWFpbDogZS51c2VyRW1haWwgfHwgJycsXHJcbiAgICAgIFVzdWFyaW9fVUlEOiBlLnVzZXJVaWQgfHwgJycsXHJcbiAgICAgIFJvbDogZS51c2VyUm9sZSB8fCAnJyxcclxuICAgICAgQWNjaW9uOiBBVURJVF9BQ1RJT05fTEFCRUxTW2UuYWN0aW9uXSB8fCBlLmFjdGlvbiB8fCAnJyxcclxuICAgICAgQWNjaW9uX1JhdzogZS5hY3Rpb24gfHwgJycsXHJcbiAgICAgIFRpcG9fRW50aWRhZDogZS5lbnRpdHlUeXBlIHx8ICcnLFxyXG4gICAgICBFbnRpZGFkOiBlLmVudGl0eU5hbWUgfHwgJycsXHJcbiAgICAgIERldGFsbGVzX0pTT046IGUuZGV0YWlscyA/IEpTT04uc3RyaW5naWZ5KGUuZGV0YWlscykgOiAnJyxcclxuICAgIH07XHJcbiAgfSk7XHJcbiAgY29uc3Qgd2IgPSBYTFNYLnV0aWxzLmJvb2tfbmV3KCk7XHJcbiAgY29uc3Qgd3MgPSBYTFNYLnV0aWxzLmpzb25fdG9fc2hlZXQocm93cyk7XHJcbiAgd3NbJyFjb2xzJ10gPSBbXHJcbiAgICB7IHdjaDogMjAgfSxcclxuICAgIHsgd2NoOiAzMCB9LFxyXG4gICAgeyB3Y2g6IDMwIH0sXHJcbiAgICB7IHdjaDogMTAgfSxcclxuICAgIHsgd2NoOiAyNCB9LFxyXG4gICAgeyB3Y2g6IDIwIH0sXHJcbiAgICB7IHdjaDogMTQgfSxcclxuICAgIHsgd2NoOiA0MCB9LFxyXG4gICAgeyB3Y2g6IDYwIH0sXHJcbiAgXTtcclxuICBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KHdiLCB3cywgJ0F1ZGl0b3JpYScpO1xyXG4gIGNvbnN0IHN0YW1wID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpLnNsaWNlKDAsIDEwKTtcclxuICBYTFNYLndyaXRlRmlsZSh3YiwgJ1NoaW1hbm9fQXVkaXRvcmlhXycgKyBzdGFtcCArICcueGxzeCcpO1xyXG59O1xyXG5cclxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XHJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG4vLyBTRUNDSVx1MDBEM046IGJ1aWxkQ29udGFjdGFkb3NSb3dzL09wc0xvZy9WaXNpdCAoaW5saW5lIEwxMDA4MS0xMDE1NSlcclxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XHJcblxyXG4vLyBMaXN0YSBjb21wbGV0YSBkZSBjb250YWN0YWRvcyAoY2xpZW50ZXMvcHJvc3BlY3RvcyBtYXJjYWRvcyBjb24gY2hlY2spXHJcbmZ1bmN0aW9uIGJ1aWxkQ29udGFjdGFkb3NSb3dzKCkge1xyXG4gIGNvbnN0IHJvd3MgPSBbXTtcclxuICBjb250YWN0ZWQuZm9yRWFjaCgoa2V5KSA9PiB7XHJcbiAgICBjb25zdCBwYXJ0cyA9IGtleS5zcGxpdCgnfCcpO1xyXG4gICAgY29uc3QgdGlwbyA9IHBhcnRzWzBdLFxyXG4gICAgICBwcm92aW5jZSA9IHBhcnRzWzFdLFxyXG4gICAgICBsb2NOYW1lID0gcGFydHNbMl0sXHJcbiAgICAgIGNsaWVudE5hbWUgPSBwYXJ0c1szXTtcclxuICAgIGNvbnN0IHB0ID0gUE9JTlRTLmZpbmQoKHApID0+IHAucHJvdmluY2UgPT09IHByb3ZpbmNlICYmIHAubmFtZSA9PT0gbG9jTmFtZSk7XHJcbiAgICBjb25zdCB2ZW5kb3IgPSBwdCA/IHB0LnZlbmRvciA6ICcnO1xyXG4gICAgY29uc3Qgdm0gPSB2ZW5kb3JMb29rdXBbdmVuZG9yXTtcclxuICAgIHJvd3MucHVzaCh7XHJcbiAgICAgIFRpcG86IHRpcG8gPT09ICdDJyA/ICdDbGllbnRlIGFjdHVhbCcgOiAnUHJvc3BlY3RvJyxcclxuICAgICAgQ2xpZW50ZTogY2xpZW50TmFtZSxcclxuICAgICAgUHJvdmluY2lhOiB0aXRsZUNhc2UocHJvdmluY2UpLFxyXG4gICAgICBMb2NhbGlkYWQ6IGxvY05hbWUsXHJcbiAgICAgIERlcGFydGFtZW50bzogcHQgPyBwdC5kZXB0IHx8ICcnIDogJycsXHJcbiAgICAgIFZlbmRlZG9yOiB0aXRsZUNhc2UodmVuZG9yIHx8ICcnKSxcclxuICAgICAgWm9uYTogdm0gPyB2bS56b25lIDogJycsXHJcbiAgICAgIENvbnRhY3RhZG86ICdTaScsXHJcbiAgICB9KTtcclxuICB9KTtcclxuICByb3dzLnNvcnQoXHJcbiAgICAoYSwgYikgPT5cclxuICAgICAgYS5WZW5kZWRvci5sb2NhbGVDb21wYXJlKGIuVmVuZGVkb3IpIHx8XHJcbiAgICAgIGEuUHJvdmluY2lhLmxvY2FsZUNvbXBhcmUoYi5Qcm92aW5jaWEpIHx8XHJcbiAgICAgIGEuQ2xpZW50ZS5sb2NhbGVDb21wYXJlKGIuQ2xpZW50ZSlcclxuICApO1xyXG4gIHJldHVybiByb3dzO1xyXG59XHJcblxyXG4vLyBMb2cgZGUgb3BlcmFjaW9uZXMgKGNhbmNlbGFjaW9uZXMsIGVsaW1pbmFjaW9uZXMsIHZ1ZWx2ZS1hLWJvcnJhZG9yLCBldGMuKVxyXG5mdW5jdGlvbiBidWlsZE9wc0xvZ1Jvd3MoKSB7XHJcbiAgcmV0dXJuIChvcHNMb2dDYWNoZSB8fCBbXSkubWFwKChvKSA9PiAoe1xyXG4gICAgRmVjaGE6IG8udGltZXN0YW1wXHJcbiAgICAgID8gby50aW1lc3RhbXAudG9EYXRlXHJcbiAgICAgICAgPyBvLnRpbWVzdGFtcC50b0RhdGUoKS50b0xvY2FsZVN0cmluZygpXHJcbiAgICAgICAgOiBuZXcgRGF0ZShvLnRpbWVzdGFtcCkudG9Mb2NhbGVTdHJpbmcoKVxyXG4gICAgICA6ICcnLFxyXG4gICAgVXN1YXJpbzogby51c2VyRW1haWwgfHwgJycsXHJcbiAgICBSb2w6IG8udXNlclJvbGUgfHwgJycsXHJcbiAgICBBY2Npb246IG8uYWN0aW9uIHx8ICcnLFxyXG4gICAgJ1RpcG8gZW50aWRhZCc6IG8uZW50aXR5VHlwZSB8fCAnJyxcclxuICAgIEVudGlkYWQ6IG8uZW50aXR5TmFtZSB8fCAnJyxcclxuICAgIERldGFsbGVzOiB0eXBlb2Ygby5kZXRhaWxzID09PSAnb2JqZWN0JyA/IEpTT04uc3RyaW5naWZ5KG8uZGV0YWlscykgOiBvLmRldGFpbHMgfHwgJycsXHJcbiAgfSkpO1xyXG59XHJcblxyXG5mdW5jdGlvbiBidWlsZFZpc2l0Um93cygpIHtcclxuICByZXR1cm4gdmlzaXRzQ2FjaGUubWFwKCh2KSA9PiAoe1xyXG4gICAgRmVjaGE6IHYuZmVjaGEgfHwgJycsXHJcbiAgICBNZXM6IHYubWVzIHx8ICcnLFxyXG4gICAgQW5vOiB2LmFuaW8gfHwgJycsXHJcbiAgICBWZW5kZWRvcjogdGl0bGVDYXNlKHYudmVuZG9yIHx8ICcnKSxcclxuICAgICdUaXBvIGNvbnRhY3RvJzogdi50aXBvQ29udGFjdG8gPT09ICd0ZWxlZm9ubycgPyAnVGVsZWZvbm8nIDogJ1ByZXNlbmNpYWwnLFxyXG4gICAgQ29tZW50YXJpbzogdi5jb21lbnRhcmlvIHx8ICcnLFxyXG4gICAgUHJvdmluY2lhOiB0aXRsZUNhc2Uodi5wcm92aW5jaWEgfHwgJycpLFxyXG4gICAgTG9jYWxpZGFkOiB2LmxvY2FsaWRhZCB8fCAnJyxcclxuICAgIFRpZW5kYTogdi50aWVuZGEgfHwgJycsXHJcbiAgICAnVGlwbyB0aWVuZGEnOiB2LnRpcG8gfHwgJycsXHJcbiAgICBMb2NhbDogdi5sb2NhbCB8fCAnJyxcclxuICAgIFRhbWFubzogdi50YW1hbm8gfHwgJycsXHJcbiAgICBGaWRlbGlkYWQ6IHYuZmlkZWxpZGFkIHx8ICcnLFxyXG4gICAgJ1JlbGV2YW5jaWEgKDEtNSknOiB2LnJlbGV2YW5jaWEgfHwgJycsXHJcbiAgICBQT1A6IHYucG9wIHx8ICcnLFxyXG4gICAgJ05lY2VzaWRhZCBwdW50dWFsJzogdi5uZWNlc2lkYWRQdW50dWFsID09PSAnTU9TVFJBRE8nID8gJ01PU1RSQURPUicgOiB2Lm5lY2VzaWRhZFB1bnR1YWwgfHwgJycsXHJcbiAgICAnVGlwbyB2ZW50YSc6IHYudGlwb1ZlbnRhID09PSAnTU9TVFJBRE8nID8gJ01PU1RSQURPUicgOiB2LnRpcG9WZW50YSB8fCAnJyxcclxuICAgICclIE1vc3RyYWRvcic6IHYucG9uZGVyYWNpb25Nb3N0cmFkbyAhPSBudWxsID8gdi5wb25kZXJhY2lvbk1vc3RyYWRvIDogJycsXHJcbiAgICAnJSBFY29tbWVyY2UnOiB2LnBvbmRlcmFjaW9uRWNvbW1lcmNlICE9IG51bGwgPyB2LnBvbmRlcmFjaW9uRWNvbW1lcmNlIDogJycsXHJcbiAgICBDb21wZXRlbmNpYTogdi5jb21wZXRlbmNpYSB8fCAnJyxcclxuICAgICdDYXRlZ29yaWEgY2xpZW50ZSc6IHYuY2F0ZWdvcmlhQ2xpZW50ZSB8fCAnJyxcclxuICAgIE9wb3J0dW5pZGFkOiB2Lm9wb3J0dW5pZGFkIHx8ICcnLFxyXG4gICAgJ0xvIG1hcyB2ZW5kaWRvIFNoaW1hbm8nOiB2Lm1hc1ZlbmRpZG8gfHwgJycsXHJcbiAgICAnTG8gcXVlIG1hcyBwcmVndW50YW4nOiB2Lm1hc1ByZWd1bnRhbiB8fCAnJyxcclxuICAgICdBeXVkYSBhIHRpZW5kYSc6IHYuYXl1ZGFUaWVuZGEgfHwgJycsXHJcbiAgICAnRm90b3MgZXNwYWNpbyAoY2FudCknOiAodi5lc3BhY2lvIHx8IFtdKS5sZW5ndGgsXHJcbiAgICAnRm90byBmcmVudGUnOiB2LmZyZW50ZUxvY2FsID8gJ1NpJyA6ICdObycsXHJcbiAgICAnR1BTIGVzdGFkbyc6IHYuZ3BzU3RhdHVzIHx8ICcnLFxyXG4gICAgJ0dQUyBkaXN0YW5jaWEgKG0pJzogdHlwZW9mIHYuZ3BzRGlzdGFuY2VNID09PSAnbnVtYmVyJyA/IHYuZ3BzRGlzdGFuY2VNIDogJycsXHJcbiAgICAnR1BTIGxhdCc6IHYuZ3BzTGF0ICE9IG51bGwgPyB2Lmdwc0xhdCA6ICcnLFxyXG4gICAgJ0dQUyBsb24nOiB2Lmdwc0xvbiAhPSBudWxsID8gdi5ncHNMb24gOiAnJyxcclxuICAgICdHUFMgcHJlY2lzaW9uIChtKSc6IHYuZ3BzQWNjdXJhY3kgIT0gbnVsbCA/IHYuZ3BzQWNjdXJhY3kgOiAnJyxcclxuICAgICdHUFMgY2FwdHVyYWRvJzogdi5ncHNDYXB0dXJlZEF0IHx8ICcnLFxyXG4gICAgRW1haWw6IHYub3duZXJFbWFpbCB8fCAnJyxcclxuICB9KSk7XHJcbn1cclxuXHJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxuLy8gU0VDQ0lcdTAwRDNOOiBleHBvcnRFeGVjdXRpdmUvVmlzaXRzL1Bvd2VyQkkvTUwgKGlubGluZSBMMTAxNTgtMTA0MjYpXHJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG5cclxud2luZG93LmV4cG9ydEV4ZWN1dGl2ZSA9IGZ1bmN0aW9uICgpIHtcclxuICBjb25zdCB3YiA9IFhMU1gudXRpbHMuYm9va19uZXcoKTtcclxuICBjb25zdCByb3dzID0gYnVpbGRQZWRpZG9EZXRhaWxSb3dzKCk7XHJcbiAgY29uc3QgY29uZlJvd3MgPSByb3dzLmZpbHRlcigocikgPT4gci5lc3RhZG8gPT09ICdDb25maXJtYWRvJyk7XHJcblxyXG4gIC8vIENvbnNvbGlkYWRvOiB1bmEgZmlsYSBwb3IgdmVuZGVkb3IgY29uIEtQSXNcclxuICBjb25zdCBwZXJWZW5kb3IgPSB7fTtcclxuICBjb25mUm93cy5mb3JFYWNoKChyKSA9PiB7XHJcbiAgICBjb25zdCBrID0gci52ZW5kZWRvciB8fCAnU2luIGFzaWduYXInO1xyXG4gICAgaWYgKCFwZXJWZW5kb3Jba10pXHJcbiAgICAgIHBlclZlbmRvcltrXSA9IHtcclxuICAgICAgICB6b25hOiByLnpvbmEsXHJcbiAgICAgICAgdW5pZDogMCxcclxuICAgICAgICBhcnM6IDAsXHJcbiAgICAgICAgdXNkOiAwLFxyXG4gICAgICAgIGNsaWVudGVzOiBuZXcgU2V0KCksXHJcbiAgICAgICAgcHJvZHM6IG5ldyBTZXQoKSxcclxuICAgICAgICBwcm92czogbmV3IFNldCgpLFxyXG4gICAgICB9O1xyXG4gICAgcGVyVmVuZG9yW2tdLnVuaWQgKz0gci5jYW50aWRhZDtcclxuICAgIHBlclZlbmRvcltrXS5hcnMgKz0gci5zdWJ0b3RhbF9hcnM7XHJcbiAgICBwZXJWZW5kb3Jba10udXNkICs9IHIuc3VidG90YWxfdXNkO1xyXG4gICAgcGVyVmVuZG9yW2tdLmNsaWVudGVzLmFkZChyLmNsaWVudGUpO1xyXG4gICAgcGVyVmVuZG9yW2tdLnByb2RzLmFkZChyLmNvZGlnbyk7XHJcbiAgICBwZXJWZW5kb3Jba10ucHJvdnMuYWRkKHIucHJvdmluY2lhKTtcclxuICB9KTtcclxuICBjb25zdCBjb25zb2wgPSBbXTtcclxuICBWRU5ET1JTLmZvckVhY2goKHYpID0+IHtcclxuICAgIGNvbnN0IHRpdGxlViA9IHRpdGxlQ2FzZSh2LmtleSk7XHJcbiAgICBjb25zdCBkID0gcGVyVmVuZG9yW3RpdGxlVl0gfHwge1xyXG4gICAgICB6b25hOiB2LnpvbmUsXHJcbiAgICAgIHVuaWQ6IDAsXHJcbiAgICAgIGFyczogMCxcclxuICAgICAgdXNkOiAwLFxyXG4gICAgICBjbGllbnRlczogbmV3IFNldCgpLFxyXG4gICAgICBwcm9kczogbmV3IFNldCgpLFxyXG4gICAgICBwcm92czogbmV3IFNldCgpLFxyXG4gICAgfTtcclxuICAgIGNvbnN0IHQgPSBUQVJHRVRTX0JZX1ZFTkRPUlt2LmtleV0gfHwgeyBqdWwyMDI2X3VzZDogMCwganVsRGljMjAyNl91c2Q6IDAsIGFudWFsMjAyN191c2Q6IDAgfTtcclxuICAgIGNvbnNvbC5wdXNoKHtcclxuICAgICAgWm9uYTogdi56b25lLFxyXG4gICAgICBWZW5kZWRvcjogdGl0bGVWLFxyXG4gICAgICBQcm92aW5jaWFzOiBkLnByb3ZzLnNpemUsXHJcbiAgICAgICdDbGllbnRlcyBhY3Rpdm9zJzogZC5jbGllbnRlcy5zaXplLFxyXG4gICAgICAnUHJvZHVjdG9zIGRpc3RpbnRvcyc6IGQucHJvZHMuc2l6ZSxcclxuICAgICAgVW5pZGFkZXM6IGQudW5pZCxcclxuICAgICAgJ0ZhY3R1cmFkbyBBUlMnOiBNYXRoLnJvdW5kKGQuYXJzKSxcclxuICAgICAgJ0ZhY3R1cmFkbyBVU0QnOiBNYXRoLnJvdW5kKGQudXNkKSxcclxuICAgICAgJ1RhcmdldCBKdWwgMjAyNiBVU0QnOiB0Lmp1bDIwMjZfdXNkLFxyXG4gICAgICAnVGFyZ2V0IEp1bC1EaWMgMjAyNiBVU0QnOiB0Lmp1bERpYzIwMjZfdXNkLFxyXG4gICAgICAnVGFyZ2V0IDIwMjcgVVNEJzogdC5hbnVhbDIwMjdfdXNkLFxyXG4gICAgfSk7XHJcbiAgfSk7XHJcbiAgY29uc3Qgd3NDID0gWExTWC51dGlscy5qc29uX3RvX3NoZWV0KGNvbnNvbCk7XHJcbiAgd3NDWychY29scyddID0gW1xyXG4gICAgeyB3Y2g6IDYgfSxcclxuICAgIHsgd2NoOiAyNCB9LFxyXG4gICAgeyB3Y2g6IDExIH0sXHJcbiAgICB7IHdjaDogMTQgfSxcclxuICAgIHsgd2NoOiAxNiB9LFxyXG4gICAgeyB3Y2g6IDExIH0sXHJcbiAgICB7IHdjaDogMTYgfSxcclxuICAgIHsgd2NoOiAxNiB9LFxyXG4gICAgeyB3Y2g6IDE4IH0sXHJcbiAgICB7IHdjaDogMjAgfSxcclxuICAgIHsgd2NoOiAxOCB9LFxyXG4gIF07XHJcbiAgWExTWC51dGlscy5ib29rX2FwcGVuZF9zaGVldCh3Yiwgd3NDLCAnQ29uc29saWRhZG8nKTtcclxuXHJcbiAgLy8gVW5hIGhvamEgcG9yIHZlbmRlZG9yIGNvbiBzdSBkZXRhbGxlIGRlIHBlZGlkb3MgY29uZmlybWFkb3NcclxuICBWRU5ET1JTLmZvckVhY2goKHYpID0+IHtcclxuICAgIGNvbnN0IHRpdGxlViA9IHRpdGxlQ2FzZSh2LmtleSk7XHJcbiAgICBjb25zdCB2cm93cyA9IGNvbmZSb3dzXHJcbiAgICAgIC5maWx0ZXIoKHIpID0+IHIudmVuZGVkb3IgPT09IHRpdGxlVilcclxuICAgICAgLm1hcCgocikgPT4gKHtcclxuICAgICAgICBGZWNoYTogci5mZWNoYSxcclxuICAgICAgICBNZXM6IHIubWVzX3BlZGlkbyxcclxuICAgICAgICBQcm92aW5jaWE6IHIucHJvdmluY2lhLFxyXG4gICAgICAgIExvY2FsaWRhZDogci5sb2NhbGlkYWQsXHJcbiAgICAgICAgQ2xpZW50ZTogci5jbGllbnRlLFxyXG4gICAgICAgIFRpcG86IHIudGlwb19jbGllbnRlLFxyXG4gICAgICAgIENvZGlnbzogci5jb2RpZ28sXHJcbiAgICAgICAgUHJvZHVjdG86IHIucHJvZHVjdG8sXHJcbiAgICAgICAgQ2F0ZWdvcmlhOiByLmNhdGVnb3JpYSxcclxuICAgICAgICBGYW1pbGlhOiByLmZhbWlsaWEsXHJcbiAgICAgICAgU3ViZmFtaWxpYTogci5zdWJmYW1pbGlhLFxyXG4gICAgICAgIENhbnRpZGFkOiByLmNhbnRpZGFkLFxyXG4gICAgICAgICdQcmVjaW8gQVJTJzogci5wcmVjaW9fdW5pdF9hcnMsXHJcbiAgICAgICAgJ1N1YnRvdGFsIEFSUyc6IHIuc3VidG90YWxfYXJzLFxyXG4gICAgICAgICdTdWJ0b3RhbCBVU0QnOiByLnN1YnRvdGFsX3VzZCxcclxuICAgICAgfSkpO1xyXG4gICAgdnJvd3Muc29ydChcclxuICAgICAgKGEsIGIpID0+IChhLkZlY2hhIHx8ICcnKS5sb2NhbGVDb21wYXJlKGIuRmVjaGEgfHwgJycpIHx8IGEuQ2xpZW50ZS5sb2NhbGVDb21wYXJlKGIuQ2xpZW50ZSlcclxuICAgICk7XHJcbiAgICBpZiAoIXZyb3dzLmxlbmd0aClcclxuICAgICAgdnJvd3MucHVzaCh7XHJcbiAgICAgICAgRmVjaGE6ICcnLFxyXG4gICAgICAgIE1lczogJycsXHJcbiAgICAgICAgUHJvdmluY2lhOiAnJyxcclxuICAgICAgICBMb2NhbGlkYWQ6ICcnLFxyXG4gICAgICAgIENsaWVudGU6ICcoc2luIHBlZGlkb3MgY29uZmlybWFkb3MpJyxcclxuICAgICAgICBUaXBvOiAnJyxcclxuICAgICAgICBDb2RpZ286ICcnLFxyXG4gICAgICAgIFByb2R1Y3RvOiAnJyxcclxuICAgICAgICBDYXRlZ29yaWE6ICcnLFxyXG4gICAgICAgIEZhbWlsaWE6ICcnLFxyXG4gICAgICAgIFN1YmZhbWlsaWE6ICcnLFxyXG4gICAgICAgIENhbnRpZGFkOiAwLFxyXG4gICAgICAgICdQcmVjaW8gQVJTJzogMCxcclxuICAgICAgICAnU3VidG90YWwgQVJTJzogMCxcclxuICAgICAgICAnU3VidG90YWwgVVNEJzogMCxcclxuICAgICAgfSk7XHJcbiAgICBjb25zdCB3cyA9IFhMU1gudXRpbHMuanNvbl90b19zaGVldCh2cm93cyk7XHJcbiAgICB3c1snIWNvbHMnXSA9IFtcclxuICAgICAgeyB3Y2g6IDExIH0sXHJcbiAgICAgIHsgd2NoOiAxNCB9LFxyXG4gICAgICB7IHdjaDogMTggfSxcclxuICAgICAgeyB3Y2g6IDIyIH0sXHJcbiAgICAgIHsgd2NoOiAzMCB9LFxyXG4gICAgICB7IHdjaDogMTEgfSxcclxuICAgICAgeyB3Y2g6IDE0IH0sXHJcbiAgICAgIHsgd2NoOiAzOCB9LFxyXG4gICAgICB7IHdjaDogMTQgfSxcclxuICAgICAgeyB3Y2g6IDE4IH0sXHJcbiAgICAgIHsgd2NoOiAxOCB9LFxyXG4gICAgICB7IHdjaDogMTAgfSxcclxuICAgICAgeyB3Y2g6IDEyIH0sXHJcbiAgICAgIHsgd2NoOiAxNCB9LFxyXG4gICAgICB7IHdjaDogMTQgfSxcclxuICAgIF07XHJcbiAgICBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KFxyXG4gICAgICB3YixcclxuICAgICAgd3MsXHJcbiAgICAgICh2LnpvbmUgKyAnICcgKyB0aXRsZVYpLnN1YnN0cmluZygwLCAzMSkucmVwbGFjZSgvW1xcXFwvKj9bXFxdOl0vZywgJycpXHJcbiAgICApO1xyXG4gIH0pO1xyXG5cclxuICAvLyBWaXNpdGFzXHJcbiAgY29uc3QgdmlzaXRSb3dzID0gYnVpbGRWaXNpdFJvd3MoKTtcclxuICBpZiAodmlzaXRSb3dzLmxlbmd0aCkge1xyXG4gICAgY29uc3Qgd3NWID0gWExTWC51dGlscy5qc29uX3RvX3NoZWV0KHZpc2l0Um93cyk7XHJcbiAgICBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KHdiLCB3c1YsICdWaXNpdGFzJyk7XHJcbiAgfVxyXG4gIC8vIENvbnRhY3RhZG9zICh0b2RvcyBsb3MgY2xpZW50ZXMvcHJvc3BlY3RvcyBtYXJjYWRvcyBjb24gY2hlY2spXHJcbiAgY29uc3QgY29udGFjdFJvd3MgPSBidWlsZENvbnRhY3RhZG9zUm93cygpO1xyXG4gIGlmIChjb250YWN0Um93cy5sZW5ndGgpIHtcclxuICAgIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQod2IsIFhMU1gudXRpbHMuanNvbl90b19zaGVldChjb250YWN0Um93cyksICdDb250YWN0YWRvcycpO1xyXG4gIH1cclxuICAvLyBMb2cgZGUgb3BlcmFjaW9uZXMgKGNhbmNlbGFjaW9uZXMsIGVsaW1pbmFjaW9uZXMsIGV0Yy4pXHJcbiAgY29uc3Qgb3BzUm93cyA9IGJ1aWxkT3BzTG9nUm93cygpO1xyXG4gIGlmIChvcHNSb3dzLmxlbmd0aCkge1xyXG4gICAgWExTWC51dGlscy5ib29rX2FwcGVuZF9zaGVldCh3YiwgWExTWC51dGlscy5qc29uX3RvX3NoZWV0KG9wc1Jvd3MpLCAnTG9nIE9wZXJhY2lvbmVzJyk7XHJcbiAgfVxyXG5cclxuICBYTFNYLndyaXRlRmlsZSh3YiwgJ1NoaW1hbm9fRWplY3V0aXZvXycgKyB0b2RheVN0cigpICsgJy54bHN4Jyk7XHJcbn07XHJcblxyXG4vLyAtLS0tLS0tLS0tIEV4Y2VsIGRlIFZpc2l0YXMgKGZvcm1hdG8gc3RhbmRhbG9uZSkgLS0tLS0tLS0tLVxyXG53aW5kb3cuZXhwb3J0VmlzaXRzRXhjZWwgPSBmdW5jdGlvbiAoKSB7XHJcbiAgaWYgKHR5cGVvZiBYTFNYID09PSAndW5kZWZpbmVkJykge1xyXG4gICAgYWxlcnQoJ0xhIGxpYnJlcmlhIGRlIEV4Y2VsIG5vIHNlIGNhcmdvLiBWZXJpZmlxdWUgc3UgY29uZXhpb24gYSBpbnRlcm5ldCB5IHJlaW50ZW50ZS4nKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgY29uc3QgdmlzaXRSb3dzID0gYnVpbGRWaXNpdFJvd3MoKTtcclxuICBpZiAoIXZpc2l0Um93cy5sZW5ndGgpIHtcclxuICAgIGFsZXJ0KFxyXG4gICAgICAnTm8gaGF5IHZpc2l0YXMgcmVnaXN0cmFkYXMgdG9kYXZpYS4gQ3VhbmRvIHNlIGNhcmd1ZSBhbCBtZW5vcyB1bmEsIHZhcyBhIHBvZGVyIGV4cG9ydGFybGEuJ1xyXG4gICAgKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgY29uc3Qgd2IgPSBYTFNYLnV0aWxzLmJvb2tfbmV3KCk7XHJcblxyXG4gIC8vIEhvamEgcHJpbmNpcGFsOiBWaXNpdGFzICh0b2RhcyBsYXMgZmlsYXMpXHJcbiAgY29uc3Qgd3MgPSBYTFNYLnV0aWxzLmpzb25fdG9fc2hlZXQodmlzaXRSb3dzKTtcclxuICB3c1snIWNvbHMnXSA9IFtcclxuICAgIHsgd2NoOiAxMiB9LFxyXG4gICAgeyB3Y2g6IDE0IH0sXHJcbiAgICB7IHdjaDogOCB9LFxyXG4gICAgeyB3Y2g6IDI0IH0sXHJcbiAgICB7IHdjaDogMTggfSxcclxuICAgIHsgd2NoOiAyMiB9LFxyXG4gICAgeyB3Y2g6IDMwIH0sXHJcbiAgICB7IHdjaDogMTggfSxcclxuICAgIHsgd2NoOiAxNCB9LFxyXG4gICAgeyB3Y2g6IDE0IH0sXHJcbiAgICB7IHdjaDogMTQgfSxcclxuICAgIHsgd2NoOiAxNiB9LFxyXG4gICAgeyB3Y2g6IDggfSxcclxuICAgIHsgd2NoOiAyMiB9LFxyXG4gICAgeyB3Y2g6IDE0IH0sXHJcbiAgICB7IHdjaDogMTQgfSxcclxuICAgIHsgd2NoOiAxNCB9LFxyXG4gICAgeyB3Y2g6IDE4IH0sXHJcbiAgICB7IHdjaDogMTggfSxcclxuICAgIHsgd2NoOiAzMiB9LFxyXG4gICAgeyB3Y2g6IDMyIH0sXHJcbiAgICB7IHdjaDogMzIgfSxcclxuICAgIHsgd2NoOiAzMiB9LFxyXG4gICAgeyB3Y2g6IDE4IH0sXHJcbiAgICB7IHdjaDogMTQgfSxcclxuICAgIHsgd2NoOiAyNCB9LFxyXG4gIF07XHJcbiAgWExTWC51dGlscy5ib29rX2FwcGVuZF9zaGVldCh3Yiwgd3MsICdWaXNpdGFzJyk7XHJcblxyXG4gIC8vIEhvamEgcmVzdW1lbiBwb3IgdmVuZGVkb3I6IGNhbnRpZGFkIGRlIHZpc2l0YXMgeSB0aWVuZGFzIHVuaWNhc1xyXG4gIGNvbnN0IHBlclZlbmRvciA9IHt9O1xyXG4gIHZpc2l0c0NhY2hlLmZvckVhY2goKHYpID0+IHtcclxuICAgIGNvbnN0IGsgPSB0aXRsZUNhc2Uodi52ZW5kb3IgfHwgJ1NpbiBhc2lnbmFyJyk7XHJcbiAgICBpZiAoIXBlclZlbmRvcltrXSlcclxuICAgICAgcGVyVmVuZG9yW2tdID0ge1xyXG4gICAgICAgIHZpc2l0YXM6IDAsXHJcbiAgICAgICAgdGllbmRhczogbmV3IFNldCgpLFxyXG4gICAgICAgIGxvY2FsaWRhZGVzOiBuZXcgU2V0KCksXHJcbiAgICAgICAgcHJvdmluY2lhczogbmV3IFNldCgpLFxyXG4gICAgICB9O1xyXG4gICAgcGVyVmVuZG9yW2tdLnZpc2l0YXMrKztcclxuICAgIGlmICh2LnRpZW5kYSkgcGVyVmVuZG9yW2tdLnRpZW5kYXMuYWRkKHYudGllbmRhKTtcclxuICAgIGlmICh2LmxvY2FsaWRhZCkgcGVyVmVuZG9yW2tdLmxvY2FsaWRhZGVzLmFkZCh2LmxvY2FsaWRhZCk7XHJcbiAgICBpZiAodi5wcm92aW5jaWEpIHBlclZlbmRvcltrXS5wcm92aW5jaWFzLmFkZCh2LnByb3ZpbmNpYSk7XHJcbiAgfSk7XHJcbiAgY29uc3QgcmVzdW1lbiA9IE9iamVjdC5lbnRyaWVzKHBlclZlbmRvcilcclxuICAgIC5tYXAoKFt2ZW5kZWRvciwgZF0pID0+ICh7XHJcbiAgICAgIFZlbmRlZG9yOiB2ZW5kZWRvcixcclxuICAgICAgJ1Zpc2l0YXMgdG90YWxlcyc6IGQudmlzaXRhcyxcclxuICAgICAgJ1RpZW5kYXMgZGlzdGludGFzJzogZC50aWVuZGFzLnNpemUsXHJcbiAgICAgICdMb2NhbGlkYWRlcyBkaXN0aW50YXMnOiBkLmxvY2FsaWRhZGVzLnNpemUsXHJcbiAgICAgICdQcm92aW5jaWFzIGRpc3RpbnRhcyc6IGQucHJvdmluY2lhcy5zaXplLFxyXG4gICAgfSkpXHJcbiAgICAuc29ydCgoYSwgYikgPT4gYlsnVmlzaXRhcyB0b3RhbGVzJ10gLSBhWydWaXNpdGFzIHRvdGFsZXMnXSk7XHJcbiAgaWYgKHJlc3VtZW4ubGVuZ3RoKSB7XHJcbiAgICBjb25zdCB3c1IgPSBYTFNYLnV0aWxzLmpzb25fdG9fc2hlZXQocmVzdW1lbik7XHJcbiAgICB3c1JbJyFjb2xzJ10gPSBbeyB3Y2g6IDI0IH0sIHsgd2NoOiAxNiB9LCB7IHdjaDogMTggfSwgeyB3Y2g6IDIyIH0sIHsgd2NoOiAyMiB9XTtcclxuICAgIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQod2IsIHdzUiwgJ1Jlc3VtZW4gcG9yIHZlbmRlZG9yJyk7XHJcbiAgfVxyXG5cclxuICBYTFNYLndyaXRlRmlsZSh3YiwgJ1NoaW1hbm9fVmlzaXRhc18nICsgdG9kYXlTdHIoKSArICcueGxzeCcpO1xyXG59O1xyXG5cclxuLy8gLS0tLS0tLS0tLSBPUENJT04gQjogUG93ZXIgQkkgKEZhY3QgKyBEaW0pIC0tLS0tLS0tLS1cclxud2luZG93LmV4cG9ydFBvd2VyQkkgPSBmdW5jdGlvbiAoKSB7XHJcbiAgY29uc3Qgd2IgPSBYTFNYLnV0aWxzLmJvb2tfbmV3KCk7XHJcbiAgY29uc3Qgcm93cyA9IGJ1aWxkUGVkaWRvRGV0YWlsUm93cygpO1xyXG5cclxuICAvLyBGYWN0X1BlZGlkb3NcclxuICBjb25zdCBmYWN0Um93cyA9IHJvd3MuZmlsdGVyKChyKSA9PiByLmVzdGFkbyAhPT0gJ0JvcnJhZG9yJyk7XHJcbiAgY29uc3Qgd3NGID0gWExTWC51dGlscy5qc29uX3RvX3NoZWV0KFxyXG4gICAgZmFjdFJvd3MubWFwKChyKSA9PiAoe1xyXG4gICAgICBsaW5lX2lkOiByLmxpbmVfaWQsXHJcbiAgICAgIGZlY2hhOiByLmZlY2hhLFxyXG4gICAgICBlc3RhZG86IHIuZXN0YWRvLFxyXG4gICAgICB2ZW5kZWRvcl9rZXk6IHIudmVuZGVkb3Jfa2V5LFxyXG4gICAgICB6b25hOiByLnpvbmEsXHJcbiAgICAgIHByb3ZpbmNpYTogci5wcm92aW5jaWEsXHJcbiAgICAgIGxvY2FsaWRhZDogci5sb2NhbGlkYWQsXHJcbiAgICAgIGNsaWVudGU6IHIuY2xpZW50ZSxcclxuICAgICAgdGlwb19jbGllbnRlOiByLnRpcG9fY2xpZW50ZSxcclxuICAgICAgc2t1OiByLmNvZGlnbyxcclxuICAgICAgY2FudGlkYWQ6IHIuY2FudGlkYWQsXHJcbiAgICAgIHByZWNpb191bml0X2Fyczogci5wcmVjaW9fdW5pdF9hcnMsXHJcbiAgICAgIHN1YnRvdGFsX2Fyczogci5zdWJ0b3RhbF9hcnMsXHJcbiAgICAgIHN1YnRvdGFsX3VzZDogci5zdWJ0b3RhbF91c2QsXHJcbiAgICB9KSlcclxuICApO1xyXG4gIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQod2IsIHdzRiwgJ0ZhY3RfUGVkaWRvcycpO1xyXG5cclxuICAvLyBEaW1fVmVuZGVkb3JcclxuICBjb25zdCBkaW1WID0gVkVORE9SUy5tYXAoKHYpID0+IHtcclxuICAgIGNvbnN0IHQgPSBUQVJHRVRTX0JZX1ZFTkRPUlt2LmtleV0gfHwge307XHJcbiAgICByZXR1cm4ge1xyXG4gICAgICB2ZW5kZWRvcl9rZXk6IHYua2V5LFxyXG4gICAgICB2ZW5kZWRvcl9ub21icmU6IHRpdGxlQ2FzZSh2LmtleSksXHJcbiAgICAgIHpvbmE6IHYuem9uZSxcclxuICAgICAgem9uYV9kZXNjcmlwY2lvbjogdi5sYWJlbCxcclxuICAgICAgY29sb3I6IHYuY29sb3IsXHJcbiAgICAgIHRhcmdldF9qdWwyMDI2X3VzZDogdC5qdWwyMDI2X3VzZCB8fCAwLFxyXG4gICAgICB0YXJnZXRfanVsRGljMjAyNl91c2Q6IHQuanVsRGljMjAyNl91c2QgfHwgMCxcclxuICAgICAgdGFyZ2V0XzIwMjdfdXNkOiB0LmFudWFsMjAyN191c2QgfHwgMCxcclxuICAgIH07XHJcbiAgfSk7XHJcbiAgWExTWC51dGlscy5ib29rX2FwcGVuZF9zaGVldCh3YiwgWExTWC51dGlscy5qc29uX3RvX3NoZWV0KGRpbVYpLCAnRGltX1ZlbmRlZG9yJyk7XHJcblxyXG4gIC8vIERpbV9Qcm9kdWN0b1xyXG4gIGNvbnN0IGRpbVAgPSBQUk9EVUNUUy5tYXAoKHApID0+ICh7XHJcbiAgICBza3U6IHAuY29kZSxcclxuICAgIGRlc2NyaXBjaW9uOiBwLmRlc2MsXHJcbiAgICBjYXRlZ29yaWE6IHAuY2F0LFxyXG4gICAgZmFtaWxpYTogcC5mYW0sXHJcbiAgICBzdWJmYW1pbGlhOiBwLnN1YixcclxuICB9KSk7XHJcbiAgWExTWC51dGlscy5ib29rX2FwcGVuZF9zaGVldCh3YiwgWExTWC51dGlscy5qc29uX3RvX3NoZWV0KGRpbVApLCAnRGltX1Byb2R1Y3RvJyk7XHJcblxyXG4gIC8vIERpbV9DbGllbnRlICh1bml2ZXJzbylcclxuICBjb25zdCBkaW1DID0gW107XHJcbiAgUE9JTlRTLmZvckVhY2goKHApID0+IHtcclxuICAgIGNvbnN0IHZtID0gdmVuZG9yTG9va3VwW3AudmVuZG9yXTtcclxuICAgIHAuY2xpZW50cy5mb3JFYWNoKChuKSA9PlxyXG4gICAgICBkaW1DLnB1c2goe1xyXG4gICAgICAgIGNsaWVudGU6IG4sXHJcbiAgICAgICAgdGlwbzogJ0NsaWVudGUgYWN0dWFsJyxcclxuICAgICAgICBwcm92aW5jaWE6IHRpdGxlQ2FzZShwLnByb3ZpbmNlKSxcclxuICAgICAgICBsb2NhbGlkYWQ6IHAubmFtZSxcclxuICAgICAgICBkZXBhcnRhbWVudG86IHAuZGVwdCB8fCAnJyxcclxuICAgICAgICB2ZW5kZWRvcl9rZXk6IHAudmVuZG9yIHx8ICcnLFxyXG4gICAgICAgIHpvbmE6IHZtID8gdm0uem9uZSA6ICcnLFxyXG4gICAgICB9KVxyXG4gICAgKTtcclxuICAgIHAucHJvc3BlY3RzLmZvckVhY2goKG4pID0+XHJcbiAgICAgIGRpbUMucHVzaCh7XHJcbiAgICAgICAgY2xpZW50ZTogbixcclxuICAgICAgICB0aXBvOiAnUHJvc3BlY3RvJyxcclxuICAgICAgICBwcm92aW5jaWE6IHRpdGxlQ2FzZShwLnByb3ZpbmNlKSxcclxuICAgICAgICBsb2NhbGlkYWQ6IHAubmFtZSxcclxuICAgICAgICBkZXBhcnRhbWVudG86IHAuZGVwdCB8fCAnJyxcclxuICAgICAgICB2ZW5kZWRvcl9rZXk6IHAudmVuZG9yIHx8ICcnLFxyXG4gICAgICAgIHpvbmE6IHZtID8gdm0uem9uZSA6ICcnLFxyXG4gICAgICB9KVxyXG4gICAgKTtcclxuICB9KTtcclxuICBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KHdiLCBYTFNYLnV0aWxzLmpzb25fdG9fc2hlZXQoZGltQyksICdEaW1fQ2xpZW50ZScpO1xyXG5cclxuICAvLyBEaW1fQ2FsZW5kYXJpbyAoZmVjaGFzIGRpc3RpbnRhcyBlbiBsb3MgcGVkaWRvcyArIHNlcmllIGNvbnRpbnVhIGRlbCBhXHUwMEYxbyBhY3R1YWwpXHJcbiAgY29uc3QgY2FsU2V0ID0gbmV3IFNldCgpO1xyXG4gIGZhY3RSb3dzLmZvckVhY2goKHIpID0+IHtcclxuICAgIGlmIChyLmZlY2hhKSBjYWxTZXQuYWRkKHIuZmVjaGEpO1xyXG4gIH0pO1xyXG4gIC8vIENvbXBsZXRhciBkZXNkZSAyMDI2LTAxLTAxIGhhc3RhIGhveSArIDM2NVxyXG4gIGNvbnN0IHN0YXJ0ID0gbmV3IERhdGUoJzIwMjYtMDEtMDEnKTtcclxuICBjb25zdCBlbmQgPSBuZXcgRGF0ZSgpO1xyXG4gIGVuZC5zZXREYXRlKGVuZC5nZXREYXRlKCkgKyAzNjUpO1xyXG4gIGZvciAobGV0IGQgPSBuZXcgRGF0ZShzdGFydCk7IGQgPD0gZW5kOyBkLnNldERhdGUoZC5nZXREYXRlKCkgKyAxKSlcclxuICAgIGNhbFNldC5hZGQoZC50b0lTT1N0cmluZygpLnNsaWNlKDAsIDEwKSk7XHJcbiAgY29uc3QgZGltQ2FsID0gWy4uLmNhbFNldF0uc29ydCgpLm1hcCgoZHQpID0+IHtcclxuICAgIGNvbnN0IFt5LCBtLCBkYV0gPSBkdC5zcGxpdCgnLScpLm1hcCgoeCkgPT4gcGFyc2VJbnQoeCwgMTApKTtcclxuICAgIGNvbnN0IGRhdGVPYmogPSBuZXcgRGF0ZSh5LCBtIC0gMSwgZGEpO1xyXG4gICAgcmV0dXJuIHtcclxuICAgICAgZmVjaGE6IGR0LFxyXG4gICAgICB5ZWFyOiB5LFxyXG4gICAgICBtb250aDogbSxcclxuICAgICAgZGF5OiBkYSxcclxuICAgICAgcXVhcnRlcjogJ1EnICsgKE1hdGguZmxvb3IoKG0gLSAxKSAvIDMpICsgMSksXHJcbiAgICAgIG1vbnRoX25hbWU6IE1FU0VTW20gLSAxXSxcclxuICAgICAgeWVhcl9tb250aDogeSArICctJyArIFN0cmluZyhtKS5wYWRTdGFydCgyLCAnMCcpLFxyXG4gICAgICBkYXlfb2Zfd2VlazogWydEb20nLCAnTHVuJywgJ01hcicsICdNaWUnLCAnSnVlJywgJ1ZpZScsICdTYWInXVtkYXRlT2JqLmdldERheSgpXSxcclxuICAgIH07XHJcbiAgfSk7XHJcbiAgWExTWC51dGlscy5ib29rX2FwcGVuZF9zaGVldCh3YiwgWExTWC51dGlscy5qc29uX3RvX3NoZWV0KGRpbUNhbCksICdEaW1fQ2FsZW5kYXJpbycpO1xyXG5cclxuICAvLyBEaW1fQ2FtcGFuaWFcclxuICBjb25zdCBkaW1DbXAgPSBjYW1wYWlnbnNDYWNoZS5tYXAoKGMpID0+ICh7XHJcbiAgICBjYW1wYW5pYV9pZDogYy5pZCxcclxuICAgIG5vbWJyZTogYy5uYW1lLFxyXG4gICAgZmlsdGVyX3R5cGU6IGMuZmlsdGVyVHlwZSxcclxuICAgIGZpbHRlcl92YWx1ZXM6IChjLmZpbHRlclZhbHVlcyB8fCBbXSkuam9pbignLCAnKSxcclxuICAgIHRhcmdldF90eXBlOiBjLnRhcmdldFR5cGUsXHJcbiAgICB0YXJnZXRfYW1vdW50OiBjLnRhcmdldEFtb3VudCxcclxuICAgIGRlc2RlOiBjLnN0YXJ0RGF0ZSxcclxuICAgIGhhc3RhOiBjLmVuZERhdGUsXHJcbiAgfSkpO1xyXG4gIGlmIChkaW1DbXAubGVuZ3RoKVxyXG4gICAgWExTWC51dGlscy5ib29rX2FwcGVuZF9zaGVldCh3YiwgWExTWC51dGlscy5qc29uX3RvX3NoZWV0KGRpbUNtcCksICdEaW1fQ2FtcGFuaWEnKTtcclxuXHJcbiAgLy8gUGFyYW1zICh0aXBvIGRlIGNhbWJpbywgZmVjaGEgZXhwb3J0LCB2ZXJzaW9uKVxyXG4gIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQoXHJcbiAgICB3YixcclxuICAgIFhMU1gudXRpbHMuanNvbl90b19zaGVldChbXHJcbiAgICAgIHsgcGFyYW1ldHJvOiAnZXhjaGFuZ2VfcmF0ZV9hcnNfdXNkJywgdmFsb3I6IEVYQ0hBTkdFX1JBVEUgfSxcclxuICAgICAgeyBwYXJhbWV0cm86ICdmZWNoYV9leHBvcnQnLCB2YWxvcjogdG9kYXlTdHIoKSB9LFxyXG4gICAgICB7IHBhcmFtZXRybzogJ3RvdGFsX2ZpbGFzX2ZhY3QnLCB2YWxvcjogZmFjdFJvd3MubGVuZ3RoIH0sXHJcbiAgICBdKSxcclxuICAgICdQYXJhbWV0cm9zJ1xyXG4gICk7XHJcblxyXG4gIC8vIEZhY3RfVmlzaXRhc1xyXG4gIGNvbnN0IHZpc2l0Um93c0IgPSBidWlsZFZpc2l0Um93cygpO1xyXG4gIGlmICh2aXNpdFJvd3NCLmxlbmd0aClcclxuICAgIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQod2IsIFhMU1gudXRpbHMuanNvbl90b19zaGVldCh2aXNpdFJvd3NCKSwgJ0ZhY3RfVmlzaXRhcycpO1xyXG4gIC8vIENvbnRhY3RhZG9zXHJcbiAgY29uc3QgY29udGFjdFJvd3NCID0gYnVpbGRDb250YWN0YWRvc1Jvd3MoKTtcclxuICBpZiAoY29udGFjdFJvd3NCLmxlbmd0aClcclxuICAgIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQod2IsIFhMU1gudXRpbHMuanNvbl90b19zaGVldChjb250YWN0Um93c0IpLCAnQ29udGFjdGFkb3MnKTtcclxuICAvLyBMb2cgZGUgb3BlcmFjaW9uZXNcclxuICBjb25zdCBvcHNSb3dzQiA9IGJ1aWxkT3BzTG9nUm93cygpO1xyXG4gIGlmIChvcHNSb3dzQi5sZW5ndGgpXHJcbiAgICBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KHdiLCBYTFNYLnV0aWxzLmpzb25fdG9fc2hlZXQob3BzUm93c0IpLCAnTG9nX09wZXJhY2lvbmVzJyk7XHJcblxyXG4gIFhMU1gud3JpdGVGaWxlKHdiLCAnU2hpbWFub19Qb3dlckJJXycgKyB0b2RheVN0cigpICsgJy54bHN4Jyk7XHJcbn07XHJcblxyXG4vLyAtLS0tLS0tLS0tIE9QQ0lPTiBDOiBQeXRob24gLyBJQSAvIE1MIChzaW5nbGUgbG9uZy1mb3JtYXQgdGFibGUpIC0tLS0tLS0tLS1cclxud2luZG93LmV4cG9ydE1MID0gZnVuY3Rpb24gKCkge1xyXG4gIGNvbnN0IHdiID0gWExTWC51dGlscy5ib29rX25ldygpO1xyXG4gIGNvbnN0IHJvd3MgPSBidWlsZFBlZGlkb0RldGFpbFJvd3MoKTtcclxuICAvLyBtYXN0ZXJfbWw6IHVuYSBmaWxhIHBvciBsaW5lYSBjb24gVE9EQVMgbGFzIGZlYXR1cmVzXHJcbiAgY29uc3Qgd3MgPSBYTFNYLnV0aWxzLmpzb25fdG9fc2hlZXQocm93cyk7XHJcbiAgd3NbJyFjb2xzJ10gPSBPYmplY3Qua2V5cyhyb3dzWzBdIHx8IHsgZmVjaGE6ICcnIH0pLm1hcCgoKSA9PiAoeyB3Y2g6IDE0IH0pKTtcclxuICBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KHdiLCB3cywgJ21hc3Rlcl9tbCcpO1xyXG5cclxuICAvLyBjYXRhbG9nbyB5IHVuaXZlcnNvIGRlIGNsaWVudGVzIGNvbW8gcmVmZXJlbmNpYXMgcGFyYSBlbnJpcXVlY2VyIGVuIHBhbmRhc1xyXG4gIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQoXHJcbiAgICB3YixcclxuICAgIFhMU1gudXRpbHMuanNvbl90b19zaGVldChcclxuICAgICAgUFJPRFVDVFMubWFwKChwKSA9PiAoeyBjb2RlOiBwLmNvZGUsIGRlc2M6IHAuZGVzYywgY2F0OiBwLmNhdCwgZmFtOiBwLmZhbSwgc3ViOiBwLnN1YiB9KSlcclxuICAgICksXHJcbiAgICAncHJvZHVjdG9zX2NhdGFsb2dvJ1xyXG4gICk7XHJcblxyXG4gIGNvbnN0IHVuaXZlcnNlID0gW107XHJcbiAgUE9JTlRTLmZvckVhY2goKHApID0+IHtcclxuICAgIGNvbnN0IHZtID0gdmVuZG9yTG9va3VwW3AudmVuZG9yXTtcclxuICAgIHAuY2xpZW50cy5mb3JFYWNoKChuKSA9PlxyXG4gICAgICB1bml2ZXJzZS5wdXNoKHtcclxuICAgICAgICBjbGllbnRlOiBuLFxyXG4gICAgICAgIHRpcG86ICdjbGllbnRlX2FjdHVhbCcsXHJcbiAgICAgICAgcHJvdmluY2lhOiB0aXRsZUNhc2UocC5wcm92aW5jZSksXHJcbiAgICAgICAgbG9jYWxpZGFkOiBwLm5hbWUsXHJcbiAgICAgICAgZGVwYXJ0YW1lbnRvOiBwLmRlcHQgfHwgJycsXHJcbiAgICAgICAgdmVuZGVkb3I6IHRpdGxlQ2FzZShwLnZlbmRvciB8fCAnJyksXHJcbiAgICAgICAgem9uYTogdm0gPyB2bS56b25lIDogJycsXHJcbiAgICAgICAgbGF0OiBwLmxhdCxcclxuICAgICAgICBsb246IHAubG9uLFxyXG4gICAgICB9KVxyXG4gICAgKTtcclxuICAgIHAucHJvc3BlY3RzLmZvckVhY2goKG4pID0+XHJcbiAgICAgIHVuaXZlcnNlLnB1c2goe1xyXG4gICAgICAgIGNsaWVudGU6IG4sXHJcbiAgICAgICAgdGlwbzogJ3Byb3NwZWN0bycsXHJcbiAgICAgICAgcHJvdmluY2lhOiB0aXRsZUNhc2UocC5wcm92aW5jZSksXHJcbiAgICAgICAgbG9jYWxpZGFkOiBwLm5hbWUsXHJcbiAgICAgICAgZGVwYXJ0YW1lbnRvOiBwLmRlcHQgfHwgJycsXHJcbiAgICAgICAgdmVuZGVkb3I6IHRpdGxlQ2FzZShwLnZlbmRvciB8fCAnJyksXHJcbiAgICAgICAgem9uYTogdm0gPyB2bS56b25lIDogJycsXHJcbiAgICAgICAgbGF0OiBwLmxhdCxcclxuICAgICAgICBsb246IHAubG9uLFxyXG4gICAgICB9KVxyXG4gICAgKTtcclxuICB9KTtcclxuICBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KHdiLCBYTFNYLnV0aWxzLmpzb25fdG9fc2hlZXQodW5pdmVyc2UpLCAndW5pdmVyc29fY2xpZW50ZXMnKTtcclxuXHJcbiAgLy8gdGFyZ2V0cyBjb21vIHRhYmxhIGxvbmdcclxuICBjb25zdCB0YXJnZXRzTG9uZyA9IFtdO1xyXG4gIE9iamVjdC5lbnRyaWVzKFRBUkdFVFNfQllfVkVORE9SKS5mb3JFYWNoKChbdmVuZG9yLCB0XSkgPT4ge1xyXG4gICAgdGFyZ2V0c0xvbmcucHVzaCh7XHJcbiAgICAgIHZlbmRlZG9yOiBkaXNwbGF5VmVuZG9yTmFtZSh2ZW5kb3IpLFxyXG4gICAgICBwZXJpb2RvOiAnSnVsIDIwMjYnLFxyXG4gICAgICBzdGFydF9kYXRlOiAnMjAyNi0wNy0wMScsXHJcbiAgICAgIGVuZF9kYXRlOiAnMjAyNi0wNy0zMScsXHJcbiAgICAgIHRhcmdldF91c2Q6IHQuanVsMjAyNl91c2QgfHwgMCxcclxuICAgIH0pO1xyXG4gICAgdGFyZ2V0c0xvbmcucHVzaCh7XHJcbiAgICAgIHZlbmRlZG9yOiBkaXNwbGF5VmVuZG9yTmFtZSh2ZW5kb3IpLFxyXG4gICAgICBwZXJpb2RvOiAnSnVsLURpYyAyMDI2JyxcclxuICAgICAgc3RhcnRfZGF0ZTogJzIwMjYtMDctMDEnLFxyXG4gICAgICBlbmRfZGF0ZTogJzIwMjYtMTItMzEnLFxyXG4gICAgICB0YXJnZXRfdXNkOiB0Lmp1bERpYzIwMjZfdXNkIHx8IDAsXHJcbiAgICB9KTtcclxuICAgIHRhcmdldHNMb25nLnB1c2goe1xyXG4gICAgICB2ZW5kZWRvcjogZGlzcGxheVZlbmRvck5hbWUodmVuZG9yKSxcclxuICAgICAgcGVyaW9kbzogJzIwMjcnLFxyXG4gICAgICBzdGFydF9kYXRlOiAnMjAyNy0wMS0wMScsXHJcbiAgICAgIGVuZF9kYXRlOiAnMjAyNy0xMi0zMScsXHJcbiAgICAgIHRhcmdldF91c2Q6IHQuYW51YWwyMDI3X3VzZCB8fCAwLFxyXG4gICAgfSk7XHJcbiAgfSk7XHJcbiAgWExTWC51dGlscy5ib29rX2FwcGVuZF9zaGVldCh3YiwgWExTWC51dGlscy5qc29uX3RvX3NoZWV0KHRhcmdldHNMb25nKSwgJ3RhcmdldHNfbG9uZycpO1xyXG5cclxuICAvLyBjYW1wYVx1MDBGMWFzXHJcbiAgaWYgKGNhbXBhaWduc0NhY2hlLmxlbmd0aCkge1xyXG4gICAgWExTWC51dGlscy5ib29rX2FwcGVuZF9zaGVldChcclxuICAgICAgd2IsXHJcbiAgICAgIFhMU1gudXRpbHMuanNvbl90b19zaGVldChcclxuICAgICAgICBjYW1wYWlnbnNDYWNoZS5tYXAoKGMpID0+ICh7XHJcbiAgICAgICAgICBpZDogYy5pZCxcclxuICAgICAgICAgIG5vbWJyZTogYy5uYW1lLFxyXG4gICAgICAgICAgZmlsdGVyX3R5cGU6IGMuZmlsdGVyVHlwZSxcclxuICAgICAgICAgIGZpbHRlcl92YWx1ZXM6IChjLmZpbHRlclZhbHVlcyB8fCBbXSkuam9pbignLCcpLFxyXG4gICAgICAgICAgdGFyZ2V0X3R5cGU6IGMudGFyZ2V0VHlwZSxcclxuICAgICAgICAgIHRhcmdldF9hbW91bnQ6IGMudGFyZ2V0QW1vdW50LFxyXG4gICAgICAgICAgc3RhcnRfZGF0ZTogYy5zdGFydERhdGUsXHJcbiAgICAgICAgICBlbmRfZGF0ZTogYy5lbmREYXRlLFxyXG4gICAgICAgIH0pKVxyXG4gICAgICApLFxyXG4gICAgICAnY2FtcGFuaWFzJ1xyXG4gICAgKTtcclxuICB9XHJcblxyXG4gIC8vIHBhcmFtZXRyb3NcclxuICBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KFxyXG4gICAgd2IsXHJcbiAgICBYTFNYLnV0aWxzLmpzb25fdG9fc2hlZXQoW1xyXG4gICAgICB7IHBhcmFtZXRybzogJ2V4Y2hhbmdlX3JhdGVfYXJzX3VzZCcsIHZhbG9yOiBFWENIQU5HRV9SQVRFIH0sXHJcbiAgICAgIHsgcGFyYW1ldHJvOiAnZmVjaGFfZXhwb3J0JywgdmFsb3I6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSB9LFxyXG4gICAgXSksXHJcbiAgICAncGFyYW1ldHJvcydcclxuICApO1xyXG5cclxuICAvLyB2aXNpdGFzXHJcbiAgY29uc3QgdmlzaXRSb3dzQyA9IGJ1aWxkVmlzaXRSb3dzKCk7XHJcbiAgaWYgKHZpc2l0Um93c0MubGVuZ3RoKVxyXG4gICAgWExTWC51dGlscy5ib29rX2FwcGVuZF9zaGVldCh3YiwgWExTWC51dGlscy5qc29uX3RvX3NoZWV0KHZpc2l0Um93c0MpLCAndmlzaXRhcycpO1xyXG4gIC8vIGNvbnRhY3RhZG9zXHJcbiAgY29uc3QgY29udGFjdFJvd3NDID0gYnVpbGRDb250YWN0YWRvc1Jvd3MoKTtcclxuICBpZiAoY29udGFjdFJvd3NDLmxlbmd0aClcclxuICAgIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQod2IsIFhMU1gudXRpbHMuanNvbl90b19zaGVldChjb250YWN0Um93c0MpLCAnY29udGFjdGFkb3MnKTtcclxuICAvLyBsb2cgZGUgb3BlcmFjaW9uZXNcclxuICBjb25zdCBvcHNSb3dzQyA9IGJ1aWxkT3BzTG9nUm93cygpO1xyXG4gIGlmIChvcHNSb3dzQy5sZW5ndGgpXHJcbiAgICBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KHdiLCBYTFNYLnV0aWxzLmpzb25fdG9fc2hlZXQob3BzUm93c0MpLCAnbG9nX29wZXJhY2lvbmVzJyk7XHJcblxyXG4gIFhMU1gud3JpdGVGaWxlKHdiLCAnU2hpbWFub19NTF8nICsgdG9kYXlTdHIoKSArICcueGxzeCcpO1xyXG59O1xyXG5cclxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XHJcbi8vIHYzNzErOiBFeHBvcnQgZGF0YXNldCBwYXJhIGFuXHUwMEUxbGlzaXMgKFpJUCBkZSBDU1ZzIHBhcmEgTUwgcGlwZWxpbmVzKVxyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxuXHJcbi8qKlxyXG4gKiBBYnJlIGVsIG1vZGFsIGNoaWNvIGRpc3BhdGNoZXIgZGVsIGJvdG9uIFwiRXhwb3J0YXIgYSBFeGNlbFwiLiBNdWVzdHJhXHJcbiAqIDIgdGFyamV0YXM6IFJlcG9ydGVzIEV4Y2VsICh0b2RvcykgdnMgRGF0YXNldCBaSVAgKHNvbG8gYWRtaW4vZ2VyZW50ZSkuXHJcbiAqL1xyXG53aW5kb3cub3BlbkV4cG9ydEZvcm1hdE1vZGFsID0gZnVuY3Rpb24gKCkge1xyXG4gIC8vIE9jdWx0YXIvbW9zdHJhciB0YXJqZXRhIERhdGFzZXQgc2VndW4gcm9sLlxyXG4gIGNvbnN0IGRzT3B0ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2V4cC1vcHQtZGF0YXNldC16aXAnKTtcclxuICBpZiAoZHNPcHQpIHtcclxuICAgIGNvbnN0IGlzQWRtaW5PckdlcmVudGUgPSB1c2VyUm9sZSA9PT0gJ2FkbWluJyB8fCB1c2VyUm9sZSA9PT0gJ2dlcmVudGUnO1xyXG4gICAgZHNPcHQuc3R5bGUuZGlzcGxheSA9IGlzQWRtaW5PckdlcmVudGUgPyAnJyA6ICdub25lJztcclxuICB9XHJcbiAgLy8gT2N1bHRhciBwcm9ncmVzcyBiYXIgKHBvciBzaSBxdWVkbyBhYmllcnRvIGRlIHVuYSBlamVjdWNpb24gYW50ZXJpb3IpXHJcbiAgY29uc3QgcHJvZyA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdleHBvcnQtZGF0YXNldC1wcm9ncmVzcycpO1xyXG4gIGlmIChwcm9nKSBwcm9nLnN0eWxlLmRpc3BsYXkgPSAnbm9uZSc7XHJcbiAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2V4cG9ydC1mb3JtYXQtbW9kYWwnKS5jbGFzc0xpc3QuYWRkKCdvcGVuJyk7XHJcbn07XHJcblxyXG53aW5kb3cuY2xvc2VFeHBvcnRGb3JtYXRNb2RhbCA9IGZ1bmN0aW9uICgpIHtcclxuICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZXhwb3J0LWZvcm1hdC1tb2RhbCcpLmNsYXNzTGlzdC5yZW1vdmUoJ29wZW4nKTtcclxufTtcclxuXHJcbi8qKlxyXG4gKiBBY3R1YWxpemEgZWwgc3RhdHVzICsgYmFycmEgZGVsIG1vZGFsLiBzdGF0dXMgZXMgdGV4dG8gbGlicmU7IHBlcmNlbnQgMC4uMTAwLlxyXG4gKi9cclxuZnVuY3Rpb24gX3VwZGF0ZUV4cG9ydFByb2dyZXNzKHN0YXR1cywgcGVyY2VudCkge1xyXG4gIGNvbnN0IHMgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZXhwb3J0LWRhdGFzZXQtc3RhdHVzJyk7XHJcbiAgY29uc3QgYiA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdleHBvcnQtZGF0YXNldC1iYXInKTtcclxuICBjb25zdCB3cmFwID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2V4cG9ydC1kYXRhc2V0LXByb2dyZXNzJyk7XHJcbiAgaWYgKHdyYXApIHdyYXAuc3R5bGUuZGlzcGxheSA9ICcnO1xyXG4gIGlmIChzKSBzLnRleHRDb250ZW50ID0gc3RhdHVzO1xyXG4gIGlmIChiKSBiLnN0eWxlLndpZHRoID0gTWF0aC5tYXgoMCwgTWF0aC5taW4oMTAwLCBwZXJjZW50KSkgKyAnJSc7XHJcbn1cclxuXHJcbi8qKlxyXG4gKiBGZXRjaCBzdG9jay5qc29uIGRlbCByb290IGRlbCBzaXRpbyAodjM2OSsgdGllbmUgd2FyZWhvdXNlQnJlYWtkb3duKS5cclxuICogQ2FjaGUtYnVzdGluZyBjb24gP3Q9IHBhcmEgZXZpdGFyIFNXLlxyXG4gKi9cclxuYXN5bmMgZnVuY3Rpb24gX2ZldGNoU3RvY2tKc29uKCkge1xyXG4gIHRyeSB7XHJcbiAgICBjb25zdCByID0gYXdhaXQgZmV0Y2goJy4vc3RvY2suanNvbj90PScgKyBEYXRlLm5vdygpLCB7IGNhY2hlOiAnbm8tc3RvcmUnIH0pO1xyXG4gICAgaWYgKCFyLm9rKSB0aHJvdyBuZXcgRXJyb3IoJ0hUVFAgJyArIHIuc3RhdHVzKTtcclxuICAgIHJldHVybiBhd2FpdCByLmpzb24oKTtcclxuICB9IGNhdGNoIChlKSB7XHJcbiAgICBjb25zb2xlLndhcm4oJ1tleHBvcnREYXRhc2V0WmlwXSBzdG9jay5qc29uIGZhbGxvOicsIGUgJiYgZS5tZXNzYWdlKTtcclxuICAgIHJldHVybiBudWxsOyAvLyBubyBibG9xdWVhbnRlIFx1MjAxNCBwcm9kdWN0b3MuY3N2IHF1ZWRhIHZhY2lvXHJcbiAgfVxyXG59XHJcblxyXG4vKipcclxuICogTGF6eSBsb2FkIEpTWmlwIChwYXRyb24geWEgdXNhZG8gZW4gZXhwb3J0UGhvdG9zWmlwIGxpbmVhIH40NykuXHJcbiAqL1xyXG5hc3luYyBmdW5jdGlvbiBfZW5zdXJlSlNaaXBMb2FkZWQoKSB7XHJcbiAgaWYgKHR5cGVvZiBKU1ppcCAhPT0gJ3VuZGVmaW5lZCcpIHJldHVybjtcclxuICBhd2FpdCBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XHJcbiAgICBjb25zdCBzID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnc2NyaXB0Jyk7XHJcbiAgICBzLnNyYyA9ICdodHRwczovL2NkbmpzLmNsb3VkZmxhcmUuY29tL2FqYXgvbGlicy9qc3ppcC8zLjEwLjEvanN6aXAubWluLmpzJztcclxuICAgIHMub25sb2FkID0gcmVzb2x2ZTtcclxuICAgIHMub25lcnJvciA9ICgpID0+IHJlamVjdChuZXcgRXJyb3IoJ05vIHNlIHB1ZG8gY2FyZ2FyIEpTWmlwJykpO1xyXG4gICAgZG9jdW1lbnQuaGVhZC5hcHBlbmRDaGlsZChzKTtcclxuICB9KTtcclxufVxyXG5cclxuLyoqXHJcbiAqIERlc2NhcmdhIHVuIEJsb2IgY29tbyBhcmNoaXZvLiBSZXVzYSBlbCBwYXRyb24gZGUgZXhwb3J0UGhvdG9zWmlwLlxyXG4gKi9cclxuZnVuY3Rpb24gX2Rvd25sb2FkQmxvYihibG9iLCBmaWxlbmFtZSkge1xyXG4gIGNvbnN0IHVybCA9IFVSTC5jcmVhdGVPYmplY3RVUkwoYmxvYik7XHJcbiAgY29uc3QgYSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2EnKTtcclxuICBhLmhyZWYgPSB1cmw7XHJcbiAgYS5kb3dubG9hZCA9IGZpbGVuYW1lO1xyXG4gIGRvY3VtZW50LmJvZHkuYXBwZW5kQ2hpbGQoYSk7XHJcbiAgYS5jbGljaygpO1xyXG4gIHNldFRpbWVvdXQoKCkgPT4ge1xyXG4gICAgZG9jdW1lbnQuYm9keS5yZW1vdmVDaGlsZChhKTtcclxuICAgIFVSTC5yZXZva2VPYmplY3RVUkwodXJsKTtcclxuICB9LCAxMDApO1xyXG59XHJcblxyXG4vKipcclxuICogRVhQT1JUIFBSSU5DSVBBTC4gU29sbyBhZG1pbi9nZXJlbnRlLiBHZW5lcmEgWklQIGNvbjpcclxuICogIC0gcGVkaWRvcy5jc3YsIHZpc2l0YXMuY3N2LCBjbGllbnRlcy5jc3YsIGNsaWVudF9tYXN0ZXIuY3N2LCByZW5kaWNpb25lcy5jc3YsXHJcbiAqICAgIGNhbXBhbmlhcy5jc3YsIHRhcmdldHMuY3N2LCBwcm9kdWN0b3MuY3N2LCB2ZW5kb3Jfb3ZlcnJpZGVzLmNzdixcclxuICogICAgY3VzdG9tX3JvdXRlcy5jc3YsIHNlZ3VpbWllbnRvX25vdGVzLmNzdlxyXG4gKiAgLSBtYW5pZmVzdC5qc29uIChzY2hlbWEgKyB1c2VDYXNlTWF0cml4ICsgcm93Q291bnRzICsgbnVsbFJhdGVCeUZpZWxkICsgbGltaXRhdGlvbnMpXHJcbiAqXHJcbiAqIENhc29zIGJvcmRlIG1hbmVqYWRvczpcclxuICogIC0gU2kgYWxndW5hIC5nZXQoKSBmYWxsYSAtPiBhbGVydCArIG5vIGRlc2NhcmdhciAobm8gZ2VuZXJhIFpJUCBwYXJjaWFsIHNpbGVuY2lvc28pLlxyXG4gKiAgLSBTaSBzdG9jay5qc29uIG5vIHJlc3BvbmRlIC0+IHByb2R1Y3Rvcy5jc3YgcXVlZGEgdmFjaW8gY29uIHdhcm5pbmcgZW4gbWFuaWZlc3QuXHJcbiAqICAtIFByb2dyZXNzIGJhciBlbiBlbCBtb2RhbCBwYXJhIGZlZWRiYWNrICh+MTAtMzAgc2VnKS5cclxuICovXHJcbndpbmRvdy5leHBvcnREYXRhc2V0WmlwID0gYXN5bmMgZnVuY3Rpb24gKCkge1xyXG4gIGlmICh1c2VyUm9sZSAhPT0gJ2FkbWluJyAmJiB1c2VyUm9sZSAhPT0gJ2dlcmVudGUnKSB7XHJcbiAgICBhbGVydCgnU29sbyBhZG1pbiBvIGdlcmVudGUgcHVlZGVuIGV4cG9ydGFyIGVsIGRhdGFzZXQuJyk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIGlmICghZmJEYikge1xyXG4gICAgYWxlcnQoJ0ZpcmVzdG9yZSBubyBpbmljaWFsaXphZG8uIFJlY2FyZ2EgbGEgYXBwLicpO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuXHJcbiAgLy8gUmUtYWJyaXIgbW9kYWwgc2kgZWwgdXN1YXJpbyBjZXJybyB5IG5hdmVnYW1vcyBwb3Igb3RybyBmbHVqby5cclxuICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZXhwb3J0LWZvcm1hdC1tb2RhbCcpLmNsYXNzTGlzdC5hZGQoJ29wZW4nKTtcclxuICBfdXBkYXRlRXhwb3J0UHJvZ3Jlc3MoJ1ByZXBhcmFuZG8uLi4nLCA1KTtcclxuXHJcbiAgdHJ5IHtcclxuICAgIF91cGRhdGVFeHBvcnRQcm9ncmVzcygnQ2FyZ2FuZG8gSlNaaXAuLi4nLCAxMCk7XHJcbiAgICBhd2FpdCBfZW5zdXJlSlNaaXBMb2FkZWQoKTtcclxuXHJcbiAgICAvLyAxKSBGZXRjaCAxMCBjb2xlY2Npb25lcyBGaXJlc3RvcmUgZW4gcGFyYWxlbG8gKyBzdG9jay5qc29uXHJcbiAgICBfdXBkYXRlRXhwb3J0UHJvZ3Jlc3MoJ0xleWVuZG8gRmlyZXN0b3JlICgxMCBjb2xlY2Npb25lcykuLi4nLCAyMCk7XHJcbiAgICBjb25zdCBmaXJlc3RvcmVFbnRyaWVzID0gW1xyXG4gICAgICBbJ3BlZGlkb3MnLCBmYkRiLmNvbGxlY3Rpb24oJ3BlZGlkb3MnKS5nZXQoKV0sXHJcbiAgICAgIFsndmlzaXRhcycsIGZiRGIuY29sbGVjdGlvbigndmlzaXRzJykuZ2V0KCldLFxyXG4gICAgICBbJ2NsaWVudGVzJywgZmJEYi5jb2xsZWN0aW9uKCdjbGllbnRfYXBwbGljYXRpb25zJykuZ2V0KCldLFxyXG4gICAgICBbJ2NsaWVudF9tYXN0ZXInLCBmYkRiLmNvbGxlY3Rpb24oJ2NsaWVudF9tYXN0ZXInKS5nZXQoKV0sXHJcbiAgICAgIFsncmVuZGljaW9uZXMnLCBmYkRiLmNvbGxlY3Rpb24oJ3JlbmRpY2lvbmVzJykuZ2V0KCldLFxyXG4gICAgICBbJ2NhbXBhbmlhcycsIGZiRGIuY29sbGVjdGlvbignY2FtcGFpZ25zJykuZ2V0KCldLFxyXG4gICAgICBbJ3RhcmdldHMnLCBmYkRiLmNvbGxlY3Rpb24oJ3RhcmdldHMnKS5nZXQoKV0sXHJcbiAgICAgIFsndmVuZG9yX292ZXJyaWRlcycsIGZiRGIuY29sbGVjdGlvbigndmVuZG9yX292ZXJyaWRlcycpLmdldCgpXSxcclxuICAgICAgWydjdXN0b21fcm91dGVzJywgZmJEYi5jb2xsZWN0aW9uKCdjdXN0b21fcm91dGVzJykuZ2V0KCldLFxyXG4gICAgICBbJ3NlZ3VpbWllbnRvX25vdGVzJywgZmJEYi5jb2xsZWN0aW9uKCdzZWd1aW1pZW50b19ub3RlcycpLmdldCgpXSxcclxuICAgIF07XHJcbiAgICBjb25zdCBwcm9taXNlcyA9IGZpcmVzdG9yZUVudHJpZXMubWFwKChbLCBwXSkgPT4gcCk7XHJcbiAgICBwcm9taXNlcy5wdXNoKF9mZXRjaFN0b2NrSnNvbigpKTtcclxuXHJcbiAgICBjb25zdCBzZXR0bGVkID0gYXdhaXQgUHJvbWlzZS5hbGxTZXR0bGVkKHByb21pc2VzKTtcclxuICAgIC8vIFNpIENVQUxRVUlFUiBnZXQoKSBkZSBGaXJlc3RvcmUgcmVjaGF6bywgYWJvcnRhbW9zIChubyBleHBvcnQgcGFyY2lhbCBzaWxlbmNpb3NvKS5cclxuICAgIGNvbnN0IGZhaWxlZEZpcmVzdG9yZSA9IFtdO1xyXG4gICAgc2V0dGxlZC5zbGljZSgwLCBmaXJlc3RvcmVFbnRyaWVzLmxlbmd0aCkuZm9yRWFjaCgociwgaSkgPT4ge1xyXG4gICAgICBpZiAoci5zdGF0dXMgPT09ICdyZWplY3RlZCcpXHJcbiAgICAgICAgZmFpbGVkRmlyZXN0b3JlLnB1c2goXHJcbiAgICAgICAgICBmaXJlc3RvcmVFbnRyaWVzW2ldWzBdICsgJzogJyArICgoci5yZWFzb24gJiYgci5yZWFzb24ubWVzc2FnZSkgfHwgci5yZWFzb24pXHJcbiAgICAgICAgKTtcclxuICAgIH0pO1xyXG4gICAgaWYgKGZhaWxlZEZpcmVzdG9yZS5sZW5ndGgpIHtcclxuICAgICAgdGhyb3cgbmV3IEVycm9yKFxyXG4gICAgICAgICdGaXJlc3RvcmUgZmV0Y2ggZmFsbG8gZW4gJyArXHJcbiAgICAgICAgICBmYWlsZWRGaXJlc3RvcmUubGVuZ3RoICtcclxuICAgICAgICAgICcgY29sZWNjaW9uZXM6XFxuJyArXHJcbiAgICAgICAgICBmYWlsZWRGaXJlc3RvcmUuam9pbignXFxuJylcclxuICAgICAgKTtcclxuICAgIH1cclxuXHJcbiAgICAvLyAyKSBFeHRyYWVyIHNuYXBzaG90cyArIGRvY3MgY29uIF9pZFxyXG4gICAgY29uc3Qgc25hcHNob3RzID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBhbnlbXT59ICovICh7fSk7XHJcbiAgICBmaXJlc3RvcmVFbnRyaWVzLmZvckVhY2goKFtuYW1lXSwgaSkgPT4ge1xyXG4gICAgICBjb25zdCBzbmFwID0gLyoqIEB0eXBlIHthbnl9ICovIChzZXR0bGVkW2ldKS52YWx1ZTtcclxuICAgICAgY29uc3QgZG9jcyA9IFtdO1xyXG4gICAgICBzbmFwLmZvckVhY2goKGQpID0+IHtcclxuICAgICAgICBjb25zdCBkYXRhID0gZC5kYXRhKCkgfHwge307XHJcbiAgICAgICAgZGF0YS5faWQgPSBkLmlkO1xyXG4gICAgICAgIGRvY3MucHVzaChkYXRhKTtcclxuICAgICAgfSk7XHJcbiAgICAgIHNuYXBzaG90c1tuYW1lXSA9IGRvY3M7XHJcbiAgICB9KTtcclxuICAgIGNvbnN0IHN0b2NrSnNvbiA9IC8qKiBAdHlwZSB7YW55fSAqLyAoc2V0dGxlZFtzZXR0bGVkLmxlbmd0aCAtIDFdKS52YWx1ZTsgLy8gcHVlZGUgc2VyIG51bGxcclxuXHJcbiAgICAvLyAzKSBDb25zdHJ1aXIgQ1NWcyBjb24gcm93IGJ1aWxkZXJzICsgc2NoZW1hc1xyXG4gICAgX3VwZGF0ZUV4cG9ydFByb2dyZXNzKCdTZXJpYWxpemFuZG8gQ1NWcy4uLicsIDU1KTtcclxuICAgIGNvbnN0IGNzdnMgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIHN0cmluZz59ICovICh7fSk7XHJcbiAgICBjb25zdCByb3dDb3VudHMgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIG51bWJlcj59ICovICh7fSk7XHJcbiAgICBjb25zdCBhbGxSb3dzQnlDc3YgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIGFueVtdW10+fSAqLyAoe30pO1xyXG5cclxuICAgIGZvciAoY29uc3QgY29sbE5hbWUgb2YgT2JqZWN0LmtleXMoc25hcHNob3RzKSkge1xyXG4gICAgICBjb25zdCBzY2hlbWEgPSBEQVRBU0VUX1NDSEVNQVNbY29sbE5hbWVdO1xyXG4gICAgICBpZiAoIXNjaGVtYSkgY29udGludWU7XHJcbiAgICAgIGNvbnN0IGJ1aWxkZXIgPSBST1dfQlVJTERFUlNbY29sbE5hbWVdO1xyXG4gICAgICBpZiAoIWJ1aWxkZXIpIGNvbnRpbnVlO1xyXG4gICAgICBjb25zdCBhbGxSb3dzID0gLyoqIEB0eXBlIHthbnlbXVtdfSAqLyAoW10pO1xyXG4gICAgICBmb3IgKGNvbnN0IGRvYyBvZiBzbmFwc2hvdHNbY29sbE5hbWVdKSB7XHJcbiAgICAgICAgY29uc3Qgcm93c0ZvckRvYyA9IGJ1aWxkZXIoZG9jKTtcclxuICAgICAgICBmb3IgKGNvbnN0IHIgb2Ygcm93c0ZvckRvYykgYWxsUm93cy5wdXNoKHIpO1xyXG4gICAgICB9XHJcbiAgICAgIGFsbFJvd3NCeUNzdltzY2hlbWEubmFtZV0gPSBhbGxSb3dzO1xyXG4gICAgICBjc3ZzW3NjaGVtYS5uYW1lXSA9IGJ1aWxkQ3N2KHNjaGVtYSwgYWxsUm93cyk7XHJcbiAgICAgIHJvd0NvdW50c1tzY2hlbWEubmFtZV0gPSBhbGxSb3dzLmxlbmd0aDtcclxuICAgIH1cclxuXHJcbiAgICAvLyBwcm9kdWN0b3MuY3N2IChkZXNkZSBzdG9jay5qc29uLCBubyBGaXJlc3RvcmUpXHJcbiAgICBjb25zdCBwcm9kdWN0b3NTY2hlbWEgPSBEQVRBU0VUX1NDSEVNQVMucHJvZHVjdG9zO1xyXG4gICAgY29uc3QgcHJvZHVjdG9zUm93cyA9IHN0b2NrSnNvbiA/IGJ1aWxkUHJvZHVjdG9Sb3dzRnJvbVN0b2NrSnNvbihzdG9ja0pzb24pIDogW107XHJcbiAgICBhbGxSb3dzQnlDc3ZbcHJvZHVjdG9zU2NoZW1hLm5hbWVdID0gcHJvZHVjdG9zUm93cztcclxuICAgIGNzdnNbcHJvZHVjdG9zU2NoZW1hLm5hbWVdID0gYnVpbGRDc3YocHJvZHVjdG9zU2NoZW1hLCBwcm9kdWN0b3NSb3dzKTtcclxuICAgIHJvd0NvdW50c1twcm9kdWN0b3NTY2hlbWEubmFtZV0gPSBwcm9kdWN0b3NSb3dzLmxlbmd0aDtcclxuXHJcbiAgICAvLyA0KSBDb21wdXRhciBudWxsUmF0ZUJ5RmllbGQgcGFyYSBjYWRhIGNhc28gQS1FXHJcbiAgICBfdXBkYXRlRXhwb3J0UHJvZ3Jlc3MoJ0NhbGN1bGFuZG8gY2FsaWRhZCBkZWwgZGF0YXNldC4uLicsIDc1KTtcclxuICAgIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgYW55Pn0gKi9cclxuICAgIGNvbnN0IHVzZUNhc2VXaXRoU3RhdHMgPSB7fTtcclxuICAgIGZvciAoY29uc3QgW2Nhc2VLZXksIHVjXSBvZiBPYmplY3QuZW50cmllcyhEQVRBU0VUX1VTRV9DQVNFX01BVFJJWCkpIHtcclxuICAgICAgY29uc3Qgc3RhdHMgPSAvKiogQHR5cGUge2FueX0gKi8gKHtcclxuICAgICAgICBwcmlvcml0eTogdWMucHJpb3JpdHksXHJcbiAgICAgICAgZGVzY3JpcHRpb246IHVjLmRlc2NyaXB0aW9uLFxyXG4gICAgICAgIHJlcXVpcmVkRmllbGRzOiB1Yy5yZXF1aXJlZEZpZWxkcyxcclxuICAgICAgICBqb2luTm90ZXM6IHVjLmpvaW5Ob3RlcyxcclxuICAgICAgICBudWxsUmF0ZUJ5RmllbGQ6IHt9LFxyXG4gICAgICAgIGxpbWl0YXRpb25zOiBbXSxcclxuICAgICAgfSk7XHJcbiAgICAgIGxldCBoYXNIaWdoTnVsbFJhdGUgPSBmYWxzZTtcclxuICAgICAgbGV0IGhhc0VtcHR5UmVxdWlyZWQgPSBmYWxzZTtcclxuICAgICAgZm9yIChjb25zdCBbY3N2TmFtZSwgZmllbGRzXSBvZiBPYmplY3QuZW50cmllcyh1Yy5yZXF1aXJlZEZpZWxkcykpIHtcclxuICAgICAgICBjb25zdCBzY2hlbWFGb3JDc3YgPSBPYmplY3QudmFsdWVzKERBVEFTRVRfU0NIRU1BUykuZmluZCgocykgPT4gcy5uYW1lID09PSBjc3ZOYW1lKTtcclxuICAgICAgICBpZiAoIXNjaGVtYUZvckNzdikge1xyXG4gICAgICAgICAgc3RhdHMubGltaXRhdGlvbnMucHVzaCgnU2NoZW1hIG5vIGVuY29udHJhZG8gcGFyYSAnICsgY3N2TmFtZSk7XHJcbiAgICAgICAgICBjb250aW51ZTtcclxuICAgICAgICB9XHJcbiAgICAgICAgY29uc3Qgcm93cyA9IGFsbFJvd3NCeUNzdltjc3ZOYW1lXSB8fCBbXTtcclxuICAgICAgICBjb25zdCByYXRlcyA9IGNvbXB1dGVOdWxsUmF0ZXMoc2NoZW1hRm9yQ3N2LCByb3dzLCBmaWVsZHMpO1xyXG4gICAgICAgIGZvciAoY29uc3QgW2YsIHJhdGVdIG9mIE9iamVjdC5lbnRyaWVzKHJhdGVzKSkge1xyXG4gICAgICAgICAgc3RhdHMubnVsbFJhdGVCeUZpZWxkW2Nzdk5hbWUgKyAnLicgKyBmXSA9IHJhdGU7XHJcbiAgICAgICAgICBpZiAocm93cy5sZW5ndGggPT09IDApIGhhc0VtcHR5UmVxdWlyZWQgPSB0cnVlO1xyXG4gICAgICAgICAgZWxzZSBpZiAocmF0ZSA+IDAuNSkgaGFzSGlnaE51bGxSYXRlID0gdHJ1ZTtcclxuICAgICAgICB9XHJcbiAgICAgIH1cclxuICAgICAgaWYgKGhhc0VtcHR5UmVxdWlyZWQpIHtcclxuICAgICAgICBzdGF0cy5zdGF0dXMgPSAnRU1QVFknO1xyXG4gICAgICAgIHN0YXRzLmxpbWl0YXRpb25zLnB1c2goXHJcbiAgICAgICAgICAnQWxndW5hIGNvbGVjY2lvbiByZXF1ZXJpZGEgZXN0YSB2YWNpYSBcdTIwMTQgZWwgY2FzbyBubyBzZSBwdWVkZSBlbnRyZW5hciBob3kgcGVybyBlbCBzY2hlbWEgZXN0YSBsaXN0by4nXHJcbiAgICAgICAgKTtcclxuICAgICAgfSBlbHNlIGlmIChoYXNIaWdoTnVsbFJhdGUpIHtcclxuICAgICAgICBzdGF0cy5zdGF0dXMgPSAnUEFSVElBTCc7XHJcbiAgICAgICAgc3RhdHMubGltaXRhdGlvbnMucHVzaChcclxuICAgICAgICAgICdBbCBtZW5vcyAxIGNhbXBvIHJlcXVlcmlkbyB0aWVuZSA+NTAlIGRlIG51bGxzIFx1MjAxNCByZXZpc2FyIHRhc2FzIGFudGVzIGRlIHVzYXIuJ1xyXG4gICAgICAgICk7XHJcbiAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgc3RhdHMuc3RhdHVzID0gJ09LJztcclxuICAgICAgfVxyXG4gICAgICB1c2VDYXNlV2l0aFN0YXRzW2Nhc2VLZXldID0gc3RhdHM7XHJcbiAgICB9XHJcblxyXG4gICAgLy8gNSkgTWFuaWZlc3QuanNvblxyXG4gICAgY29uc3QgZXhwb3J0ZWRBdCA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKTtcclxuICAgIGNvbnN0IG1hbmlmZXN0ID0ge1xyXG4gICAgICBleHBvcnRlZEF0LFxyXG4gICAgICBhcHBWZXJzaW9uOiB0eXBlb2YgQVBQX1ZFUlNJT04gIT09ICd1bmRlZmluZWQnID8gQVBQX1ZFUlNJT04gOiAndW5rbm93bicsXHJcbiAgICAgIHNvdXJjZVByb2plY3Q6ICdhcHAtdmVuZGVkb3Jlcy1zaGltYW5vJyxcclxuICAgICAgZXhwb3J0ZWRCeUVtYWlsOiAoY3VycmVudFVzZXIgJiYgY3VycmVudFVzZXIuZW1haWwpIHx8ICd1bmtub3duJyxcclxuICAgICAgZXhwb3J0ZWRCeVVpZDogKGN1cnJlbnRVc2VyICYmIGN1cnJlbnRVc2VyLnVpZCkgfHwgJ3Vua25vd24nLFxyXG4gICAgICBjc3ZDb252ZW50aW9uczoge1xyXG4gICAgICAgIGVuY29kaW5nOiAnVVRGLTgnLFxyXG4gICAgICAgIHNlcGFyYXRvcjogJywnLFxyXG4gICAgICAgIHF1b3RlQ2hhcjogJ1wiJyxcclxuICAgICAgICBlc2NhcGVRdW90ZTogJ1wiXCInLFxyXG4gICAgICAgIGxpbmVUZXJtaW5hdG9yOiAnXFxcXHJcXFxcbicsXHJcbiAgICAgICAgZGF0ZUZvcm1hdDogJ0lTTyA4NjAxIFVUQyAod2l0aCBaKScsXHJcbiAgICAgICAgZGVjaW1hbFNlcGFyYXRvcjogJy4nLFxyXG4gICAgICAgIG51bGxSZXByZXNlbnRhdGlvbjogJyhlbXB0eSBmaWVsZCknLFxyXG4gICAgICAgIGFycmF5Rm9ybWF0OiAnSlNPTiBzdHJpbmdpZmllZCcsXHJcbiAgICAgICAgb2JqZWN0Rm9ybWF0OiAnSlNPTiBzdHJpbmdpZmllZCcsXHJcbiAgICAgIH0sXHJcbiAgICAgIHJvd0NvdW50cyxcclxuICAgICAgc2NoZW1hOiB7fSxcclxuICAgICAgdXNlQ2FzZU1hdHJpeDogdXNlQ2FzZVdpdGhTdGF0cyxcclxuICAgICAgZXhjbHVzaW9uczoge1xyXG4gICAgICAgIG5vdGU6ICdEYXRvcyBzZW5zaWJsZXMgeSBiaW5hcmlvcyBleGNsdWlkb3MgZGVsIGV4cG9ydC4nLFxyXG4gICAgICAgIGV4Y2x1ZGVkQ29sbGVjdGlvbnM6IFtcclxuICAgICAgICAgICdyb2xlcycsXHJcbiAgICAgICAgICAnYXBwX2NvbmZpZycsXHJcbiAgICAgICAgICAnc2FwX3NuYXBzaG90JyxcclxuICAgICAgICAgICdub3RpZmljYXRpb25zJyxcclxuICAgICAgICAgICdvcGVyYXRpb25zX2xvZycsXHJcbiAgICAgICAgXSxcclxuICAgICAgICBleGNsdWRlZEZpZWxkczogW1xyXG4gICAgICAgICAgJ3Zpc2l0cy5mcmVudGVMb2NhbCAoZm90b3MgYmFzZTY0KScsXHJcbiAgICAgICAgICAndmlzaXRzLmVzcGFjaW9bXSAoZm90b3MgYmFzZTY0KScsXHJcbiAgICAgICAgICAnY2xpZW50X2FwcGxpY2F0aW9ucy5jb25zdGFuY2lhQXJjYSAoYmFzZTY0KScsXHJcbiAgICAgICAgICAnY2xpZW50X2FwcGxpY2F0aW9ucy5jb25zdGFuY2lhSUlCQiAoYmFzZTY0KScsXHJcbiAgICAgICAgICAnY2xpZW50X2FwcGxpY2F0aW9ucy5mb3Rvc0xvY2FsW10gKGJhc2U2NCknLFxyXG4gICAgICAgICAgJ3JlbmRpY2lvbmVzLmZvdG9UaWNrZXQgKGJhc2U2NCBsZWdhY3kgcHJlLXYzMDg7IHNlIGV4cG9ydGEgc29sbyBmb3RvVGlja2V0VXJsKScsXHJcbiAgICAgICAgXSxcclxuICAgICAgICBzdG9ja0pzb25Mb2FkZWQ6IHN0b2NrSnNvbiAhPT0gbnVsbCxcclxuICAgICAgfSxcclxuICAgIH07XHJcbiAgICBmb3IgKGNvbnN0IFtfY29sbE5hbWUsIHNjaGVtYV0gb2YgT2JqZWN0LmVudHJpZXMoREFUQVNFVF9TQ0hFTUFTKSkge1xyXG4gICAgICBtYW5pZmVzdC5zY2hlbWFbc2NoZW1hLm5hbWVdID0gc2NoZW1hLmNvbHVtbnMubWFwKChjKSA9PiAoe1xyXG4gICAgICAgIGNvbDogYy5jb2wsXHJcbiAgICAgICAgdHlwZTogYy50eXBlLFxyXG4gICAgICAgIGRlc2M6IGMuZGVzYyxcclxuICAgICAgfSkpO1xyXG4gICAgfVxyXG5cclxuICAgIC8vIDYpIEVtcGFxdWV0YXIgWklQXHJcbiAgICBfdXBkYXRlRXhwb3J0UHJvZ3Jlc3MoJ0VtcGFxdWV0YW5kbyBaSVAuLi4nLCA5MCk7XHJcbiAgICBjb25zdCB6aXAgPSBuZXcgSlNaaXAoKTtcclxuICAgIGZvciAoY29uc3QgW25hbWUsIGNvbnRlbnRdIG9mIE9iamVjdC5lbnRyaWVzKGNzdnMpKSB7XHJcbiAgICAgIHppcC5maWxlKG5hbWUsIGNvbnRlbnQpO1xyXG4gICAgfVxyXG4gICAgemlwLmZpbGUoJ21hbmlmZXN0Lmpzb24nLCBKU09OLnN0cmluZ2lmeShtYW5pZmVzdCwgbnVsbCwgMikpO1xyXG5cclxuICAgIGNvbnN0IGJsb2IgPSBhd2FpdCB6aXAuZ2VuZXJhdGVBc3luYyh7XHJcbiAgICAgIHR5cGU6ICdibG9iJyxcclxuICAgICAgY29tcHJlc3Npb246ICdERUZMQVRFJyxcclxuICAgICAgY29tcHJlc3Npb25PcHRpb25zOiB7IGxldmVsOiA2IH0sXHJcbiAgICB9KTtcclxuICAgIGNvbnN0IGZpbGVuYW1lID0gJ3NoaW1hbm8tZGF0YXNldC0nICsgZXhwb3J0ZWRBdC5yZXBsYWNlKC9bOi5dL2csICctJykgKyAnLnppcCc7XHJcbiAgICBfZG93bmxvYWRCbG9iKGJsb2IsIGZpbGVuYW1lKTtcclxuXHJcbiAgICBfdXBkYXRlRXhwb3J0UHJvZ3Jlc3MoXHJcbiAgICAgICdEYXRhc2V0IGRlc2NhcmdhZG86ICcgK1xyXG4gICAgICAgIGZpbGVuYW1lICtcclxuICAgICAgICAnICgnICtcclxuICAgICAgICBPYmplY3Qua2V5cyhjc3ZzKS5sZW5ndGggK1xyXG4gICAgICAgICcgQ1NWcyArIG1hbmlmZXN0Lmpzb24pJyxcclxuICAgICAgMTAwXHJcbiAgICApO1xyXG4gICAgaWYgKHR5cGVvZiBzaG93U3luY1RhZyA9PT0gJ2Z1bmN0aW9uJykge1xyXG4gICAgICBjb25zdCB0b3RhbFJvd3MgPSBPYmplY3QudmFsdWVzKHJvd0NvdW50cykucmVkdWNlKChhLCBiKSA9PiBhICsgYiwgMCk7XHJcbiAgICAgIHNob3dTeW5jVGFnKFxyXG4gICAgICAgICdEYXRhc2V0IGV4cG9ydGFkbzogJyArIHRvdGFsUm93cyArICcgZmlsYXMgZW4gJyArIE9iamVjdC5rZXlzKGNzdnMpLmxlbmd0aCArICcgQ1NWcydcclxuICAgICAgKTtcclxuICAgIH1cclxuICAgIHNldFRpbWVvdXQoKCkgPT4gd2luZG93LmNsb3NlRXhwb3J0Rm9ybWF0TW9kYWwoKSwgMzAwMCk7XHJcbiAgfSBjYXRjaCAoZSkge1xyXG4gICAgY29uc29sZS5lcnJvcignW2V4cG9ydERhdGFzZXRaaXBdIGZhdGFsOicsIGUpO1xyXG4gICAgX3VwZGF0ZUV4cG9ydFByb2dyZXNzKCdFcnJvcjogJyArICgoZSAmJiBlLm1lc3NhZ2UpIHx8IGUpLCAwKTtcclxuICAgIGFsZXJ0KFxyXG4gICAgICAnRXJyb3IgYWwgZXhwb3J0YXIgZWwgZGF0YXNldDpcXG5cXG4nICtcclxuICAgICAgICAoKGUgJiYgZS5tZXNzYWdlKSB8fCBlKSArXHJcbiAgICAgICAgJ1xcblxcbkVsIFpJUCBOTyBzZSBkZXNjYXJnbyAoZXZpdGFtb3MgZ2VuZXJhciB1biBhcmNoaXZvIHBhcmNpYWwpLiBSZXZpc2EgbGEgY29uc29sYSBwYXJhIG1hcyBkZXRhbGxlcy4nXHJcbiAgICApO1xyXG4gIH1cclxufTtcclxuXHJcbi8vID09PSBFeHBvcnRzIGEgd2luZG93ID09PVxyXG4vLyBUb2RhcyBsYXMgZnVuY2lvbmVzIHdpbmRvdy5mb28gPSBmdW5jdGlvbi4uLiB5YSBlc3RcdTAwRTFuIHZlcmJhdGltLlxyXG5pZiAodHlwZW9mIHdpbmRvdy50b2RheVN0ciA9PT0gJ3VuZGVmaW5lZCcpIHdpbmRvdy50b2RheVN0ciA9IHRvZGF5U3RyO1xyXG4vLyBFNiBob3RmaXggMjogZGF0YVVybFRvQmxvYiArIHNhbml0aXplRm9yUGF0aCB1c2Fkb3MgcG9yIGlubGluZSBydW5GdWxsQmFja3VwIChMNzI3OC03Mjg4KS5cclxuaWYgKHR5cGVvZiB3aW5kb3cuZGF0YVVybFRvQmxvYiA9PT0gJ3VuZGVmaW5lZCcpIHdpbmRvdy5kYXRhVXJsVG9CbG9iID0gZGF0YVVybFRvQmxvYjtcclxuaWYgKHR5cGVvZiB3aW5kb3cuc2FuaXRpemVGb3JQYXRoID09PSAndW5kZWZpbmVkJykgd2luZG93LnNhbml0aXplRm9yUGF0aCA9IHNhbml0aXplRm9yUGF0aDtcclxuLy8gRTYgaG90Zml4IDM6IGNyb3NzLW1vZHVsZSBidWcgKGF1ZGl0IGNyb3NzYnVuZGxlKSBcdTIwMTQgZXhwb3J0cy1jb3JlIGxsYW1hIGxvYWRFeGNlbEpTLlxyXG53aW5kb3cubG9hZEV4Y2VsSlMgPSBsb2FkRXhjZWxKUztcclxuIl0sCiAgIm1hcHBpbmdzIjogIjs7O0FBb0NPLFdBQVMsVUFBVSxHQUFHO0FBQzNCLFFBQUksTUFBTSxRQUFRLE1BQU0sT0FBVyxRQUFPO0FBQzFDLFVBQU0sTUFBTSxPQUFPLENBQUM7QUFDcEIsUUFBSSxRQUFRLEdBQUksUUFBTztBQUV2QixRQUFJLFdBQVcsS0FBSyxHQUFHLEdBQUc7QUFDeEIsYUFBTyxNQUFNLElBQUksUUFBUSxNQUFNLElBQUksSUFBSTtBQUFBLElBQ3pDO0FBQ0EsV0FBTztBQUFBLEVBQ1Q7QUFRTyxXQUFTLE9BQU8sUUFBUTtBQUM3QixXQUFPLE9BQU8sSUFBSSxDQUFDLE1BQU0sVUFBVSxvQkFBb0IsQ0FB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O0FBQUEsUUFDSixJQUFJO0FBQUEsUUFDSixJQUFJO0FBQUEsUUFDSixJQUFJO0FBQUEsUUFDSixJQUFJO0FBQUEsUUFDSixJQUFJO0FBQUEsUUFDSixJQUFJO0FBQUEsUUFDSixJQUFJO0FBQUEsUUFDSixJQUFJO0FBQUEsUUFDSixJQUFJO0FBQUEsUUFDSixJQUFJO0FBQUEsUUFDSixJQUFJO0FBQUEsUUFDSixJQUFJO0FBQUEsUUFDSixJQUFJO0FBQUEsUUFDSixJQUFJO0FBQUEsUUFDSixJQUFJO0FBQUEsUUFDSixJQUFJO0FBQUEsUUFDSixJQUFJO0FBQUEsUUFDSixJQUFJO0FBQUEsUUFDSixJQUFJO0FBQUEsUUFDSixJQUFJO0FBQUEsUUFDSixJQUFJO0FBQUEsUUFDSixJQUFJO0FBQUEsUUFDSixJQUFJO0FBQUEsUUFDSixJQUFJO0FBQUEsUUFDSixJQUFJO0FBQUEsUUFDSixJQUFJO0FBQUEsUUFDSixJQUFJO0FBQUEsUUFDSixJQUFJO0FBQUEsUUFDSixJQUFJO0FBQUEsTUFDTjtBQUFBLElBQ0Y7QUFBQSxFQUNGO0FBR08sV0FBUyxpQkFBaUIsS0FBSztBQUNwQyxXQUFPO0FBQUEsTUFDTDtBQUFBLFFBQ0UsSUFBSTtBQUFBLFFBQ0osSUFBSTtBQUFBLFFBQ0osSUFBSTtBQUFBLFFBQ0osSUFBSTtBQUFBLFFBQ0osSUFBSTtBQUFBLFFBQ0osSUFBSTtBQUFBLFFBQ0osSUFBSTtBQUFBLFFBQ0osSUFBSTtBQUFBLFFBQ0osSUFBSTtBQUFBLFFBQ0osSUFBSTtBQUFBLFFBQ0osSUFBSTtBQUFBLFFBQ0osSUFBSTtBQUFBLFFBQ0osSUFBSTtBQUFBLFFBQ0osSUFBSTtBQUFBLFFBQ0osSUFBSTtBQUFBLFFBQ0osSUFBSTtBQUFBLFFBQ0osSUFBSTtBQUFBLFFBQ0osSUFBSTtBQUFBLFFBQ0osSUFBSTtBQUFBLFFBQ0osSUFBSTtBQUFBLFFBQ0osSUFBSTtBQUFBLFFBQ0osSUFBSTtBQUFBLFFBQ0osSUFBSTtBQUFBLFFBQ0osSUFBSSxPQUFPLFFBQVEsSUFBSSxPQUFPO0FBQUEsUUFDOUIsQ0FBQyxFQUFFLElBQUksU0FBUyxJQUFJO0FBQUEsUUFDcEIsSUFBSTtBQUFBLFFBQ0osSUFBSTtBQUFBLFFBQ0osSUFBSTtBQUFBLFFBQ0osSUFBSTtBQUFBLE1BQ047QUFBQSxJQUNGO0FBQUEsRUFDRjtBQUdPLFdBQVMsc0JBQXNCLEtBQUs7QUFDekMsV0FBTztBQUFBLE1BQ0w7QUFBQSxRQUNFLElBQUk7QUFBQSxRQUNKLElBQUk7QUFBQSxRQUNKLElBQUk7QUFBQSxRQUNKLElBQUk7QUFBQSxRQUNKLElBQUk7QUFBQSxRQUNKLElBQUk7QUFBQSxRQUNKLElBQUk7QUFBQSxRQUNKLElBQUk7QUFBQSxRQUNKLElBQUk7QUFBQSxRQUNKLElBQUk7QUFBQSxRQUNKLElBQUk7QUFBQSxRQUNKLElBQUk7QUFBQSxRQUNKLElBQUk7QUFBQSxRQUNKLElBQUk7QUFBQSxRQUNKLElBQUk7QUFBQSxRQUNKLElBQUk7QUFBQSxRQUNKLElBQUk7QUFBQSxRQUNKLElBQUk7QUFBQSxNQUNOO0FBQUEsSUFDRjtBQUFBLEVBQ0Y7QUFHTyxXQUFTLG1CQUFtQixLQUFLO0FBQ3RDLFdBQU87QUFBQSxNQUNMO0FBQUEsUUFDRSxJQUFJO0FBQUEsUUFDSixJQUFJO0FBQUEsUUFDSixJQUFJO0FBQUEsUUFDSixJQUFJO0FBQUEsUUFDSixJQUFJO0FBQUEsUUFDSixJQUFJO0FBQUEsUUFDSixJQUFJLGNBQWMsT0FBTyxJQUFJLGFBQWEsSUFBSTtBQUFBLFFBQzlDLElBQUk7QUFBQSxRQUNKLElBQUk7QUFBQTtBQUFBLFFBRUosSUFBSSxpQkFBaUI7QUFBQSxRQUNyQixJQUFJO0FBQUEsUUFDSixJQUFJO0FBQUEsUUFDSixJQUFJO0FBQUEsUUFDSixJQUFJO0FBQUEsUUFDSixJQUFJO0FBQUEsUUFDSixJQUFJO0FBQUEsUUFDSixJQUFJO0FBQUEsTUFDTjtBQUFBLElBQ0Y7QUFBQSxFQUNGO0FBR08sV0FBUyxrQkFBa0IsS0FBSztBQUNyQyxXQUFPO0FBQUEsTUFDTDtBQUFBLFFBQ0UsSUFBSTtBQUFBLFFBQ0osSUFBSTtBQUFBLFFBQ0osSUFBSTtBQUFBLFFBQ0osSUFBSTtBQUFBLFFBQ0osSUFBSTtBQUFBLFFBQ0osSUFBSTtBQUFBLFFBQ0osSUFBSTtBQUFBLFFBQ0osTUFBTSxRQUFRLElBQUksSUFBSSxJQUFJLElBQUksS0FBSyxTQUFTO0FBQUEsUUFDNUMsSUFBSTtBQUFBLFFBQ0osSUFBSTtBQUFBLFFBQ0osSUFBSTtBQUFBLFFBQ0osSUFBSTtBQUFBLFFBQ0osSUFBSTtBQUFBLFFBQ0osSUFBSTtBQUFBLFFBQ0osSUFBSTtBQUFBLFFBQ0osSUFBSTtBQUFBLFFBQ0osSUFBSTtBQUFBLFFBQ0osSUFBSTtBQUFBLFFBQ0osSUFBSTtBQUFBLFFBQ0osSUFBSTtBQUFBLE1BQ047QUFBQSxJQUNGO0FBQUEsRUFDRjtBQUdPLFdBQVMsZ0JBQWdCLEtBQUs7QUFDbkMsV0FBTztBQUFBLE1BQ0w7QUFBQSxRQUNFLElBQUk7QUFBQSxRQUNKLElBQUk7QUFBQSxRQUNKLElBQUk7QUFBQSxRQUNKLElBQUk7QUFBQSxRQUNKLElBQUk7QUFBQSxRQUNKLElBQUksaUJBQWlCLElBQUksZUFBZSxPQUFPO0FBQUEsUUFDL0MsSUFBSSxpQkFBaUIsSUFBSSxlQUFlLFFBQVE7QUFBQSxRQUNoRCxJQUFJLGlCQUFpQixJQUFJLGVBQWUsU0FBUztBQUFBLFFBQ2pELElBQUk7QUFBQSxRQUNKLElBQUk7QUFBQSxRQUNKLElBQUk7QUFBQSxNQUNOO0FBQUEsSUFDRjtBQUFBLEVBQ0Y7QUFHTyxXQUFTLHdCQUF3QixLQUFLO0FBQzNDLFdBQU87QUFBQSxNQUNMO0FBQUEsUUFDRSxJQUFJO0FBQUEsUUFDSixJQUFJO0FBQUEsUUFDSixJQUFJO0FBQUEsUUFDSixJQUFJO0FBQUEsUUFDSixJQUFJO0FBQUEsUUFDSixJQUFJO0FBQUEsUUFDSixJQUFJO0FBQUEsUUFDSixJQUFJO0FBQUEsUUFDSixJQUFJO0FBQUEsUUFDSixJQUFJO0FBQUEsUUFDSixJQUFJO0FBQUEsUUFDSixJQUFJO0FBQUEsTUFDTjtBQUFBLElBQ0Y7QUFBQSxFQUNGO0FBR08sV0FBUyxxQkFBcUIsS0FBSztBQUN4QyxVQUFNLFNBQVM7QUFBQSxNQUNiLElBQUk7QUFBQSxNQUNKLElBQUk7QUFBQSxNQUNKLElBQUk7QUFBQSxNQUNKLElBQUk7QUFBQSxNQUNKLElBQUk7QUFBQSxNQUNKLElBQUk7QUFBQSxNQUNKLElBQUk7QUFBQSxNQUNKLElBQUk7QUFBQSxJQUNOO0FBQ0EsVUFBTSxRQUFRLE1BQU0sUUFBUSxJQUFJLEtBQUssSUFBSSxJQUFJLFFBQVEsQ0FBQztBQUN0RCxRQUFJLENBQUMsTUFBTSxRQUFRO0FBQ2pCLGFBQU8sQ0FBQyxPQUFPLE9BQU8sQ0FBQyxNQUFNLE1BQU0sTUFBTSxNQUFNLE1BQU0sTUFBTSxNQUFNLElBQUksQ0FBQyxDQUFDO0FBQUEsSUFDekU7QUFDQSxXQUFPLE1BQU07QUFBQSxNQUFJLENBQW9CLE1BQ25DLE9BQU8sT0FBTztBQUFBLFFBQ1osSUFBSSxFQUFFLFFBQVE7QUFBQSxRQUNkLElBQUksRUFBRSxNQUFNO0FBQUEsUUFDWixJQUFJLEVBQUUsT0FBTztBQUFBLFFBQ2IsSUFBSSxFQUFFLFlBQVk7QUFBQSxRQUNsQixJQUFJLEVBQUUsWUFBWTtBQUFBLFFBQ2xCLElBQUksRUFBRSxhQUFhO0FBQUEsUUFDbkIsSUFBSSxFQUFFLGVBQWU7QUFBQSxRQUNyQixJQUFJLEVBQUUsWUFBWTtBQUFBLE1BQ3BCLENBQUM7QUFBQSxJQUNIO0FBQUEsRUFDRjtBQUdPLFdBQVMseUJBQXlCLEtBQUs7QUFDNUMsV0FBTztBQUFBLE1BQ0w7QUFBQSxRQUNFLElBQUk7QUFBQSxRQUNKLElBQUk7QUFBQSxRQUNKLElBQUk7QUFBQSxRQUNKLElBQUk7QUFBQSxRQUNKLElBQUk7QUFBQSxRQUNKLElBQUk7QUFBQSxRQUNKLElBQUk7QUFBQSxRQUNKLElBQUk7QUFBQSxRQUNKLElBQUk7QUFBQSxRQUNKLElBQUk7QUFBQSxRQUNKLElBQUk7QUFBQSxRQUNKLElBQUk7QUFBQSxNQUNOO0FBQUEsSUFDRjtBQUFBLEVBQ0Y7QUFRTyxXQUFTLCtCQUErQixXQUFXO0FBQ3hELFVBQU07QUFBQTtBQUFBLE1BQXlCLGFBQWMsQ0FBQztBQUFBO0FBQzlDLFVBQU0sV0FBVyxHQUFHLFNBQVMsQ0FBQztBQUU5QixRQUFJLGFBQWEsQ0FBQztBQUVsQixRQUFJLFlBQVksQ0FBQztBQUNqQixRQUFJO0FBQ0YsbUJBQWEsR0FBRyxhQUFhLEtBQUssTUFBTSxHQUFHLFVBQVUsSUFBSSxHQUFHLGtCQUFrQixDQUFDO0FBQUEsSUFDakYsU0FBUyxHQUFHO0FBQUEsSUFBQztBQUNiLFFBQUk7QUFDRixrQkFBWSxHQUFHLHFCQUNYLEtBQUssTUFBTSxHQUFHLGtCQUFrQixJQUNoQyxHQUFHLDBCQUEwQixDQUFDO0FBQUEsSUFDcEMsU0FBUyxHQUFHO0FBQUEsSUFBQztBQUNiLFVBQU07QUFBQTtBQUFBLE1BQW1DLENBQUM7QUFBQTtBQUMxQyxVQUFNLFNBQVM7QUFDZixVQUFNLFlBQVksR0FBRyxhQUFhLEdBQUcsY0FBYztBQUNuRCxlQUFXLE9BQU8sT0FBTyxLQUFLLFFBQVEsR0FBRztBQUN2QyxZQUFNLFlBQVksQ0FBQyxDQUFDLFNBQVMsR0FBRztBQUNoQyxZQUFNLFFBQVEsT0FBTyxXQUFXLEdBQUcsS0FBSyxDQUFDO0FBQ3pDLFlBQU0sTUFBTSxVQUFVLEdBQUcsS0FBSyxDQUFDO0FBQy9CLFlBQU0sTUFBTSxPQUFPLElBQUksSUFBSSxLQUFLLENBQUM7QUFDakMsWUFBTSxNQUFNLE9BQU8sSUFBSSxJQUFJLEtBQUssQ0FBQztBQUVqQyxZQUFNLFFBQVEsQ0FBQztBQUNmLGlCQUFXLEtBQUssT0FBTyxLQUFLLEdBQUcsR0FBRztBQUNoQyxZQUFJLE1BQU0sUUFBUSxNQUFNLEtBQU0sT0FBTSxDQUFDLElBQUksT0FBTyxJQUFJLENBQUMsS0FBSyxDQUFDO0FBQUEsTUFDN0Q7QUFDQSxXQUFLLEtBQUs7QUFBQSxRQUNSO0FBQUEsUUFDQTtBQUFBLFFBQ0E7QUFBQSxRQUNBO0FBQUEsUUFDQTtBQUFBLFFBQ0EsT0FBTyxLQUFLLEtBQUssRUFBRSxTQUFTLFFBQVE7QUFBQSxRQUNwQztBQUFBLFFBQ0E7QUFBQSxNQUNGLENBQUM7QUFBQSxJQUNIO0FBQ0EsV0FBTztBQUFBLEVBQ1Q7QUFPTyxNQUFNLGVBQWU7QUFBQSxJQUMxQixTQUFTO0FBQUEsSUFDVCxTQUFTO0FBQUEsSUFDVCxVQUFVO0FBQUEsSUFDVixlQUFlO0FBQUEsSUFDZixhQUFhO0FBQUEsSUFDYixXQUFXO0FBQUEsSUFDWCxTQUFTO0FBQUEsSUFDVCxrQkFBa0I7QUFBQSxJQUNsQixlQUFlO0FBQUEsSUFDZixtQkFBbUI7QUFBQSxFQUNyQjs7O0FDejZCQSxXQUFTLFdBQVc7QUFDbEIsWUFBTyxvQkFBSSxLQUFLLEdBQUUsWUFBWSxFQUFFLE1BQU0sR0FBRyxFQUFFO0FBQUEsRUFDN0M7QUFHQSxXQUFTLGNBQWMsU0FBUztBQUM5QixRQUFJLENBQUMsUUFBUyxRQUFPO0FBQ3JCLFVBQU0sUUFBUSxRQUFRLE1BQU0sR0FBRztBQUMvQixRQUFJLE1BQU0sU0FBUyxFQUFHLFFBQU87QUFDN0IsVUFBTSxZQUFZLE1BQU0sQ0FBQyxFQUFFLE1BQU0sU0FBUztBQUMxQyxVQUFNLE9BQU8sWUFBWSxVQUFVLENBQUMsSUFBSTtBQUN4QyxVQUFNLFFBQVEsS0FBSyxNQUFNLENBQUMsQ0FBQztBQUMzQixVQUFNLE1BQU0sSUFBSSxXQUFXLE1BQU0sTUFBTTtBQUN2QyxhQUFTLElBQUksR0FBRyxJQUFJLE1BQU0sUUFBUSxJQUFLLEtBQUksQ0FBQyxJQUFJLE1BQU0sV0FBVyxDQUFDO0FBQ2xFLFdBQU8sSUFBSSxLQUFLLENBQUMsR0FBRyxHQUFHLEVBQUUsTUFBTSxLQUFLLENBQUM7QUFBQSxFQUN2QztBQUdBLFdBQVMsZ0JBQWdCLEdBQUc7QUFDMUIsV0FBTyxPQUFPLEtBQUssRUFBRSxFQUNsQixRQUFRLG9CQUFvQixHQUFHLEVBQy9CLFFBQVEsUUFBUSxHQUFHLEVBQ25CLEtBQUssRUFDTCxNQUFNLEdBQUcsRUFBRTtBQUFBLEVBQ2hCO0FBR0EsU0FBTyxrQkFBa0IsaUJBQWtCO0FBQ3pDLFFBQUksT0FBTyxVQUFVLGFBQWE7QUFDaEMsWUFBTSx3REFBd0Q7QUFDOUQ7QUFBQSxJQUNGO0FBQ0EsUUFBSSxDQUFDLGVBQWUsQ0FBQyxZQUFZLFFBQVE7QUFDdkMsWUFBTSw2QkFBNkI7QUFDbkM7QUFBQSxJQUNGO0FBQ0EsUUFBSSxhQUFhO0FBQ2pCLFVBQU0sTUFBTSxJQUFJLE1BQU07QUFDdEIsZ0JBQVksUUFBUSxDQUFDLE1BQU07QUFDekIsWUFBTSxTQUFTLGdCQUFnQixVQUFVLEVBQUUsVUFBVSxjQUFjLENBQUM7QUFDcEUsWUFBTSxTQUFTLGdCQUFnQixFQUFFLFVBQVUsWUFBWTtBQUN2RCxZQUFNLFNBQVMsRUFBRSxTQUFTLElBQUksUUFBUSxNQUFNLEVBQUU7QUFDOUMsWUFBTSxhQUFhLFNBQVMsTUFBTSxTQUFTLE1BQU07QUFDakQsWUFBTSxTQUFTLElBQUksT0FBTyxVQUFVO0FBQ3BDLFVBQUksRUFBRSxhQUFhO0FBQ2pCLGNBQU0sSUFBSSxjQUFjLEVBQUUsV0FBVztBQUNyQyxZQUFJLEdBQUc7QUFDTCxpQkFBTyxLQUFLLGNBQWMsQ0FBQztBQUMzQjtBQUFBLFFBQ0Y7QUFBQSxNQUNGO0FBQ0EsT0FBQyxFQUFFLFdBQVcsQ0FBQyxHQUFHLFFBQVEsQ0FBQyxLQUFLLE1BQU07QUFDcEMsY0FBTSxJQUFJLGNBQWMsR0FBRztBQUMzQixZQUFJLEdBQUc7QUFDTCxpQkFBTyxLQUFLLGNBQWMsSUFBSSxLQUFLLFFBQVEsQ0FBQztBQUM1QztBQUFBLFFBQ0Y7QUFBQSxNQUNGLENBQUM7QUFBQSxJQUNILENBQUM7QUFDRCxRQUFJLENBQUMsWUFBWTtBQUNmLFlBQU0sdUNBQXVDO0FBQzdDO0FBQUEsSUFDRjtBQUNBLGdCQUFZLHNCQUFzQixhQUFhLGFBQWEsR0FBSztBQUNqRSxRQUFJO0FBQ0YsWUFBTSxPQUFPLE1BQU0sSUFBSSxjQUFjLEVBQUUsTUFBTSxRQUFRLGFBQWEsVUFBVSxDQUFDO0FBQzdFLFlBQU0sTUFBTSxJQUFJLGdCQUFnQixJQUFJO0FBQ3BDLFlBQU0sSUFBSSxTQUFTLGNBQWMsR0FBRztBQUNwQyxRQUFFLE9BQU87QUFDVCxRQUFFLFdBQVcsMkJBQTJCLFNBQVMsSUFBSTtBQUNyRCxRQUFFLE1BQU07QUFDUixpQkFBVyxNQUFNLElBQUksZ0JBQWdCLEdBQUcsR0FBRyxHQUFJO0FBQy9DLGtCQUFZLGFBQWEsc0JBQXNCLEdBQUk7QUFBQSxJQUNyRCxTQUFTLEdBQUc7QUFDVixjQUFRLE1BQU0sT0FBTyxDQUFDO0FBQ3RCLFlBQU0sMkJBQTJCLEVBQUUsV0FBVyxFQUFFO0FBQUEsSUFDbEQ7QUFBQSxFQUNGO0FBTUEsV0FBUyxjQUFjO0FBQ3JCLFdBQU8sSUFBSSxRQUFRLENBQUMsU0FBUyxXQUFXO0FBQ3RDLFVBQUksT0FBTyxZQUFZLFlBQWEsUUFBTyxRQUFRO0FBQ25ELFlBQU0sSUFBSSxTQUFTLGNBQWMsUUFBUTtBQUN6QyxRQUFFLE1BQU07QUFDUixRQUFFLFNBQVMsTUFBTSxRQUFRO0FBQ3pCLFFBQUUsVUFBVSxNQUNWLE9BQU8sSUFBSSxNQUFNLHVFQUF1RSxDQUFDO0FBQzNGLGVBQVMsS0FBSyxZQUFZLENBQUM7QUFBQSxJQUM3QixDQUFDO0FBQUEsRUFDSDtBQUVBLFNBQU8saUNBQWlDLGlCQUFrQjtBQUN4RCxRQUFJLENBQUMsZUFBZSxDQUFDLFlBQVksUUFBUTtBQUN2QyxZQUFNLDZCQUE2QjtBQUNuQztBQUFBLElBQ0Y7QUFDQSxVQUFNLElBQUksWUFBWTtBQUN0QixRQUFJLElBQUksS0FBSztBQUNYLFVBQ0UsQ0FBQztBQUFBLFFBQ0MsU0FDRSxJQUNBO0FBQUEsTUFDSjtBQUVBO0FBQUEsSUFDSixXQUFXLElBQUksS0FBSztBQUNsQixVQUNFLENBQUM7QUFBQSxRQUNDLGdDQUNFLElBQ0E7QUFBQSxNQUNKO0FBRUE7QUFBQSxJQUNKO0FBQ0EsZ0JBQVksdUJBQXVCLEdBQUk7QUFDdkMsUUFBSTtBQUNGLFlBQU0sWUFBWTtBQUFBLElBQ3BCLFNBQVMsR0FBRztBQUNWLFlBQU0sRUFBRSxXQUFXLENBQUM7QUFDcEI7QUFBQSxJQUNGO0FBRUEsZ0JBQVkseUJBQXlCLElBQUksZUFBZSxHQUFJO0FBRTVELFVBQU0sS0FBSyxJQUFJLFFBQVEsU0FBUztBQUNoQyxPQUFHLFVBQVU7QUFDYixPQUFHLFVBQVUsb0JBQUksS0FBSztBQUN0QixVQUFNLEtBQUssR0FBRyxhQUFhLFdBQVcsRUFBRSxPQUFPLENBQUMsRUFBRSxPQUFPLFVBQVUsUUFBUSxFQUFFLENBQUMsRUFBRSxDQUFDO0FBR2pGLE9BQUcsVUFBVTtBQUFBLE1BQ1gsRUFBRSxRQUFRLFNBQVMsS0FBSyxTQUFTLE9BQU8sR0FBRztBQUFBLE1BQzNDLEVBQUUsUUFBUSxPQUFPLEtBQUssT0FBTyxPQUFPLEdBQUc7QUFBQSxNQUN2QyxFQUFFLFFBQVEsWUFBWSxLQUFLLFlBQVksT0FBTyxHQUFHO0FBQUEsTUFDakQsRUFBRSxRQUFRLGlCQUFpQixLQUFLLFVBQVUsT0FBTyxHQUFHO0FBQUEsTUFDcEQsRUFBRSxRQUFRLGNBQWMsS0FBSyxVQUFVLE9BQU8sR0FBRztBQUFBLE1BQ2pELEVBQUUsUUFBUSxhQUFhLEtBQUssYUFBYSxPQUFPLEdBQUc7QUFBQSxNQUNuRCxFQUFFLFFBQVEsYUFBYSxLQUFLLGFBQWEsT0FBTyxHQUFHO0FBQUEsTUFDbkQsRUFBRSxRQUFRLFVBQVUsS0FBSyxVQUFVLE9BQU8sR0FBRztBQUFBLE1BQzdDLEVBQUUsUUFBUSxRQUFRLEtBQUssUUFBUSxPQUFPLEdBQUc7QUFBQSxNQUN6QyxFQUFFLFFBQVEsU0FBUyxLQUFLLFNBQVMsT0FBTyxHQUFHO0FBQUEsTUFDM0MsRUFBRSxRQUFRLFVBQVUsS0FBSyxVQUFVLE9BQU8sR0FBRztBQUFBLE1BQzdDLEVBQUUsUUFBUSxhQUFhLEtBQUssYUFBYSxPQUFPLEdBQUc7QUFBQSxNQUNuRCxFQUFFLFFBQVEsY0FBYyxLQUFLLFNBQVMsT0FBTyxHQUFHO0FBQUEsTUFDaEQsRUFBRSxRQUFRLE9BQU8sS0FBSyxPQUFPLE9BQU8sRUFBRTtBQUFBLE1BQ3RDLEVBQUUsUUFBUSxjQUFjLEtBQUssYUFBYSxPQUFPLEdBQUc7QUFBQSxNQUNwRCxFQUFFLFFBQVEsZUFBZSxLQUFLLFNBQVMsT0FBTyxHQUFHO0FBQUEsTUFDakQsRUFBRSxRQUFRLGVBQWUsS0FBSyxVQUFVLE9BQU8sR0FBRztBQUFBLE1BQ2xELEVBQUUsUUFBUSxrQkFBa0IsS0FBSyxTQUFTLE9BQU8sR0FBRztBQUFBLE1BQ3BELEVBQUUsUUFBUSxnQkFBZ0IsS0FBSyxXQUFXLE9BQU8sR0FBRztBQUFBLE1BQ3BELEVBQUUsUUFBUSxlQUFlLEtBQUssUUFBUSxPQUFPLEdBQUc7QUFBQTtBQUFBLE1BQ2hELEVBQUUsUUFBUSxrQkFBa0IsS0FBSyxTQUFTLE9BQU8sR0FBRztBQUFBLElBQ3REO0FBR0EsT0FBRyxPQUFPLENBQUMsRUFBRSxPQUFPLEVBQUUsTUFBTSxNQUFNLE9BQU8sRUFBRSxNQUFNLFdBQVcsRUFBRTtBQUM5RCxPQUFHLE9BQU8sQ0FBQyxFQUFFLE9BQU8sRUFBRSxNQUFNLFdBQVcsU0FBUyxTQUFTLFNBQVMsRUFBRSxNQUFNLFdBQVcsRUFBRTtBQUN2RixPQUFHLE9BQU8sQ0FBQyxFQUFFLFlBQVksRUFBRSxVQUFVLFVBQVUsWUFBWSxTQUFTO0FBQ3BFLE9BQUcsT0FBTyxDQUFDLEVBQUUsU0FBUztBQUV0QixVQUFNLGVBQWUsR0FBRyxVQUFVLE1BQU0sRUFBRSxTQUFTO0FBQ25ELFVBQU0sUUFBUTtBQUNkLFVBQU0sUUFBUTtBQUNkLFVBQU0sUUFBUTtBQUdkLFVBQU0sU0FBUyxZQUFZLE1BQU0sRUFBRSxLQUFLLENBQUMsR0FBRyxPQUFPLEVBQUUsU0FBUyxJQUFJLGNBQWMsRUFBRSxTQUFTLEVBQUUsQ0FBQztBQUU5RixlQUFXLEtBQUssUUFBUTtBQUN0QixZQUFNLGtCQUFrQixFQUFFLGlCQUFpQixhQUFhLGFBQWE7QUFDckUsWUFBTSxJQUFJLEdBQUcsT0FBTztBQUFBLFFBQ2xCLE9BQU8sRUFBRSxTQUFTO0FBQUEsUUFDbEIsS0FBSyxFQUFFLE9BQU87QUFBQSxRQUNkLFVBQVUsVUFBVSxFQUFFLFVBQVUsRUFBRTtBQUFBLFFBQ2xDLFFBQVE7QUFBQSxRQUNSLFFBQVEsRUFBRSxjQUFjO0FBQUEsUUFDeEIsV0FBVyxVQUFVLEVBQUUsYUFBYSxFQUFFO0FBQUEsUUFDdEMsV0FBVyxFQUFFLGFBQWE7QUFBQSxRQUMxQixRQUFRLEVBQUUsVUFBVTtBQUFBLFFBQ3BCLE1BQU0sRUFBRSxRQUFRO0FBQUEsUUFDaEIsT0FBTyxFQUFFLFNBQVM7QUFBQSxRQUNsQixRQUFRLEVBQUUsVUFBVTtBQUFBLFFBQ3BCLFdBQVcsRUFBRSxhQUFhO0FBQUEsUUFDMUIsT0FBTyxFQUFFLGNBQWM7QUFBQSxRQUN2QixLQUFLLEVBQUUsT0FBTztBQUFBLFFBQ2QsV0FBVyxFQUFFLGNBQWMsYUFBYSxjQUFjLEVBQUUsYUFBYTtBQUFBLFFBQ3JFLE9BQU8sRUFBRSxlQUFlO0FBQUEsUUFDeEIsUUFBUSxFQUFFLGVBQWU7QUFBQSxRQUN6QixPQUFPLEVBQUUsY0FBYztBQUFBLFFBQ3ZCLFNBQVMsT0FBTyxFQUFFLGlCQUFpQixXQUFXLEVBQUUsZUFBZTtBQUFBLFFBQy9ELE1BQU07QUFBQTtBQUFBLFFBQ04sT0FBTyxFQUFFLGNBQWM7QUFBQSxNQUN6QixDQUFDO0FBQ0QsUUFBRSxTQUFTO0FBQ1gsUUFBRSxZQUFZLEVBQUUsVUFBVSxVQUFVLFVBQVUsS0FBSztBQUNuRCxVQUFJLEVBQUUsZUFBZSxPQUFPLEVBQUUsZ0JBQWdCLFVBQVU7QUFDdEQsWUFBSTtBQUVGLGNBQUksTUFBTSxFQUFFO0FBQ1osY0FBSSxNQUFNO0FBQ1YsZ0JBQU0sSUFBSSxtQ0FBbUMsS0FBSyxHQUFHO0FBQ3JELGNBQUksR0FBRztBQUNMLGtCQUFNLEVBQUUsQ0FBQyxFQUFFLFlBQVk7QUFDdkIsa0JBQU0sRUFBRSxDQUFDO0FBQUEsVUFDWDtBQUNBLGNBQUksUUFBUSxNQUFPLE9BQU07QUFDekIsZ0JBQU0sVUFBVSxHQUFHLFNBQVMsRUFBRSxRQUFRLEtBQUssV0FBVyxJQUFJLENBQUM7QUFDM0QsYUFBRyxTQUFTLFNBQVM7QUFBQSxZQUNuQixJQUFJLEVBQUUsS0FBSyxlQUFlLEtBQUssS0FBSyxFQUFFLFNBQVMsSUFBSSxJQUFJO0FBQUEsWUFDdkQsS0FBSyxFQUFFLE9BQU8sT0FBTyxRQUFRLE1BQU07QUFBQSxZQUNuQyxRQUFRO0FBQUEsVUFDVixDQUFDO0FBQUEsUUFDSCxTQUFTLEdBQUc7QUFDVixrQkFBUSxLQUFLLHdCQUF3QixFQUFFLFFBQVEsQ0FBQztBQUFBLFFBQ2xEO0FBQUEsTUFDRjtBQUFBLElBQ0Y7QUFHQSxRQUFJO0FBQ0YsWUFBTSxTQUFTLE1BQU0sR0FBRyxLQUFLLFlBQVk7QUFDekMsWUFBTSxPQUFPLElBQUksS0FBSyxDQUFDLE1BQU0sR0FBRztBQUFBLFFBQzlCLE1BQU07QUFBQSxNQUNSLENBQUM7QUFDRCxZQUFNLE1BQU0sSUFBSSxnQkFBZ0IsSUFBSTtBQUNwQyxZQUFNLElBQUksU0FBUyxjQUFjLEdBQUc7QUFDcEMsUUFBRSxPQUFPO0FBQ1QsUUFBRSxXQUFXLCtCQUErQixTQUFTLElBQUk7QUFDekQsZUFBUyxLQUFLLFlBQVksQ0FBQztBQUMzQixRQUFFLE1BQU07QUFDUixlQUFTLEtBQUssWUFBWSxDQUFDO0FBQzNCLGlCQUFXLE1BQU0sSUFBSSxnQkFBZ0IsR0FBRyxHQUFHLEdBQUk7QUFDL0Msa0JBQVksdUJBQXVCLE9BQU8sU0FBUyxZQUFZLEdBQUk7QUFBQSxJQUNyRSxTQUFTLEdBQUc7QUFDVixjQUFRLE1BQU0sa0NBQWtDLENBQUM7QUFDakQsWUFBTSxnQ0FBZ0MsRUFBRSxXQUFXLEVBQUU7QUFBQSxJQUN2RDtBQUFBLEVBQ0Y7QUFPQSxTQUFPLG1CQUFtQixXQUFZO0FBQ3BDLFFBQUksT0FBTyxTQUFTLGFBQWE7QUFDL0IsWUFBTSxtQ0FBbUM7QUFDekM7QUFBQSxJQUNGO0FBQ0EsVUFBTSxRQUFRLHdCQUF3QjtBQUN0QyxRQUFJLENBQUMsTUFBTSxRQUFRO0FBQ2pCLFlBQU0seURBQXlEO0FBQy9EO0FBQUEsSUFDRjtBQUNBLFVBQU0sT0FBTyxNQUFNLElBQUksQ0FBQyxNQUFNO0FBQzVCLFlBQU0sS0FBSyxFQUFFLGFBQWEsRUFBRSxVQUFVLFNBQVMsRUFBRSxVQUFVLE9BQU8sSUFBSTtBQUN0RSxhQUFPO0FBQUEsUUFDTCxZQUFZLEtBQUssR0FBRyxZQUFZLEVBQUUsUUFBUSxLQUFLLEdBQUcsRUFBRSxNQUFNLEdBQUcsRUFBRSxJQUFJO0FBQUEsUUFDbkUsZUFBZSxFQUFFLGFBQWE7QUFBQSxRQUM5QixhQUFhLEVBQUUsV0FBVztBQUFBLFFBQzFCLEtBQUssRUFBRSxZQUFZO0FBQUEsUUFDbkIsUUFBUSxvQkFBb0IsRUFBRSxNQUFNLEtBQUssRUFBRSxVQUFVO0FBQUEsUUFDckQsWUFBWSxFQUFFLFVBQVU7QUFBQSxRQUN4QixjQUFjLEVBQUUsY0FBYztBQUFBLFFBQzlCLFNBQVMsRUFBRSxjQUFjO0FBQUEsUUFDekIsZUFBZSxFQUFFLFVBQVUsS0FBSyxVQUFVLEVBQUUsT0FBTyxJQUFJO0FBQUEsTUFDekQ7QUFBQSxJQUNGLENBQUM7QUFDRCxVQUFNLEtBQUssS0FBSyxNQUFNLFNBQVM7QUFDL0IsVUFBTSxLQUFLLEtBQUssTUFBTSxjQUFjLElBQUk7QUFDeEMsT0FBRyxPQUFPLElBQUk7QUFBQSxNQUNaLEVBQUUsS0FBSyxHQUFHO0FBQUEsTUFDVixFQUFFLEtBQUssR0FBRztBQUFBLE1BQ1YsRUFBRSxLQUFLLEdBQUc7QUFBQSxNQUNWLEVBQUUsS0FBSyxHQUFHO0FBQUEsTUFDVixFQUFFLEtBQUssR0FBRztBQUFBLE1BQ1YsRUFBRSxLQUFLLEdBQUc7QUFBQSxNQUNWLEVBQUUsS0FBSyxHQUFHO0FBQUEsTUFDVixFQUFFLEtBQUssR0FBRztBQUFBLE1BQ1YsRUFBRSxLQUFLLEdBQUc7QUFBQSxJQUNaO0FBQ0EsU0FBSyxNQUFNLGtCQUFrQixJQUFJLElBQUksV0FBVztBQUNoRCxVQUFNLFNBQVEsb0JBQUksS0FBSyxHQUFFLFlBQVksRUFBRSxNQUFNLEdBQUcsRUFBRTtBQUNsRCxTQUFLLFVBQVUsSUFBSSx1QkFBdUIsUUFBUSxPQUFPO0FBQUEsRUFDM0Q7QUFRQSxXQUFTLHVCQUF1QjtBQUM5QixVQUFNLE9BQU8sQ0FBQztBQUNkLGNBQVUsUUFBUSxDQUFDLFFBQVE7QUFDekIsWUFBTSxRQUFRLElBQUksTUFBTSxHQUFHO0FBQzNCLFlBQU0sT0FBTyxNQUFNLENBQUMsR0FDbEIsV0FBVyxNQUFNLENBQUMsR0FDbEIsVUFBVSxNQUFNLENBQUMsR0FDakIsYUFBYSxNQUFNLENBQUM7QUFDdEIsWUFBTSxLQUFLLE9BQU8sS0FBSyxDQUFDLE1BQU0sRUFBRSxhQUFhLFlBQVksRUFBRSxTQUFTLE9BQU87QUFDM0UsWUFBTSxTQUFTLEtBQUssR0FBRyxTQUFTO0FBQ2hDLFlBQU0sS0FBSyxhQUFhLE1BQU07QUFDOUIsV0FBSyxLQUFLO0FBQUEsUUFDUixNQUFNLFNBQVMsTUFBTSxtQkFBbUI7QUFBQSxRQUN4QyxTQUFTO0FBQUEsUUFDVCxXQUFXLFVBQVUsUUFBUTtBQUFBLFFBQzdCLFdBQVc7QUFBQSxRQUNYLGNBQWMsS0FBSyxHQUFHLFFBQVEsS0FBSztBQUFBLFFBQ25DLFVBQVUsVUFBVSxVQUFVLEVBQUU7QUFBQSxRQUNoQyxNQUFNLEtBQUssR0FBRyxPQUFPO0FBQUEsUUFDckIsWUFBWTtBQUFBLE1BQ2QsQ0FBQztBQUFBLElBQ0gsQ0FBQztBQUNELFNBQUs7QUFBQSxNQUNILENBQUMsR0FBRyxNQUNGLEVBQUUsU0FBUyxjQUFjLEVBQUUsUUFBUSxLQUNuQyxFQUFFLFVBQVUsY0FBYyxFQUFFLFNBQVMsS0FDckMsRUFBRSxRQUFRLGNBQWMsRUFBRSxPQUFPO0FBQUEsSUFDckM7QUFDQSxXQUFPO0FBQUEsRUFDVDtBQUdBLFdBQVMsa0JBQWtCO0FBQ3pCLFlBQVEsZUFBZSxDQUFDLEdBQUcsSUFBSSxDQUFDLE9BQU87QUFBQSxNQUNyQyxPQUFPLEVBQUUsWUFDTCxFQUFFLFVBQVUsU0FDVixFQUFFLFVBQVUsT0FBTyxFQUFFLGVBQWUsSUFDcEMsSUFBSSxLQUFLLEVBQUUsU0FBUyxFQUFFLGVBQWUsSUFDdkM7QUFBQSxNQUNKLFNBQVMsRUFBRSxhQUFhO0FBQUEsTUFDeEIsS0FBSyxFQUFFLFlBQVk7QUFBQSxNQUNuQixRQUFRLEVBQUUsVUFBVTtBQUFBLE1BQ3BCLGdCQUFnQixFQUFFLGNBQWM7QUFBQSxNQUNoQyxTQUFTLEVBQUUsY0FBYztBQUFBLE1BQ3pCLFVBQVUsT0FBTyxFQUFFLFlBQVksV0FBVyxLQUFLLFVBQVUsRUFBRSxPQUFPLElBQUksRUFBRSxXQUFXO0FBQUEsSUFDckYsRUFBRTtBQUFBLEVBQ0o7QUFFQSxXQUFTLGlCQUFpQjtBQUN4QixXQUFPLFlBQVksSUFBSSxDQUFDLE9BQU87QUFBQSxNQUM3QixPQUFPLEVBQUUsU0FBUztBQUFBLE1BQ2xCLEtBQUssRUFBRSxPQUFPO0FBQUEsTUFDZCxLQUFLLEVBQUUsUUFBUTtBQUFBLE1BQ2YsVUFBVSxVQUFVLEVBQUUsVUFBVSxFQUFFO0FBQUEsTUFDbEMsaUJBQWlCLEVBQUUsaUJBQWlCLGFBQWEsYUFBYTtBQUFBLE1BQzlELFlBQVksRUFBRSxjQUFjO0FBQUEsTUFDNUIsV0FBVyxVQUFVLEVBQUUsYUFBYSxFQUFFO0FBQUEsTUFDdEMsV0FBVyxFQUFFLGFBQWE7QUFBQSxNQUMxQixRQUFRLEVBQUUsVUFBVTtBQUFBLE1BQ3BCLGVBQWUsRUFBRSxRQUFRO0FBQUEsTUFDekIsT0FBTyxFQUFFLFNBQVM7QUFBQSxNQUNsQixRQUFRLEVBQUUsVUFBVTtBQUFBLE1BQ3BCLFdBQVcsRUFBRSxhQUFhO0FBQUEsTUFDMUIsb0JBQW9CLEVBQUUsY0FBYztBQUFBLE1BQ3BDLEtBQUssRUFBRSxPQUFPO0FBQUEsTUFDZCxxQkFBcUIsRUFBRSxxQkFBcUIsYUFBYSxjQUFjLEVBQUUsb0JBQW9CO0FBQUEsTUFDN0YsY0FBYyxFQUFFLGNBQWMsYUFBYSxjQUFjLEVBQUUsYUFBYTtBQUFBLE1BQ3hFLGVBQWUsRUFBRSx1QkFBdUIsT0FBTyxFQUFFLHNCQUFzQjtBQUFBLE1BQ3ZFLGVBQWUsRUFBRSx3QkFBd0IsT0FBTyxFQUFFLHVCQUF1QjtBQUFBLE1BQ3pFLGFBQWEsRUFBRSxlQUFlO0FBQUEsTUFDOUIscUJBQXFCLEVBQUUsb0JBQW9CO0FBQUEsTUFDM0MsYUFBYSxFQUFFLGVBQWU7QUFBQSxNQUM5QiwwQkFBMEIsRUFBRSxjQUFjO0FBQUEsTUFDMUMsd0JBQXdCLEVBQUUsZ0JBQWdCO0FBQUEsTUFDMUMsa0JBQWtCLEVBQUUsZUFBZTtBQUFBLE1BQ25DLHlCQUF5QixFQUFFLFdBQVcsQ0FBQyxHQUFHO0FBQUEsTUFDMUMsZUFBZSxFQUFFLGNBQWMsT0FBTztBQUFBLE1BQ3RDLGNBQWMsRUFBRSxhQUFhO0FBQUEsTUFDN0IscUJBQXFCLE9BQU8sRUFBRSxpQkFBaUIsV0FBVyxFQUFFLGVBQWU7QUFBQSxNQUMzRSxXQUFXLEVBQUUsVUFBVSxPQUFPLEVBQUUsU0FBUztBQUFBLE1BQ3pDLFdBQVcsRUFBRSxVQUFVLE9BQU8sRUFBRSxTQUFTO0FBQUEsTUFDekMscUJBQXFCLEVBQUUsZUFBZSxPQUFPLEVBQUUsY0FBYztBQUFBLE1BQzdELGlCQUFpQixFQUFFLGlCQUFpQjtBQUFBLE1BQ3BDLE9BQU8sRUFBRSxjQUFjO0FBQUEsSUFDekIsRUFBRTtBQUFBLEVBQ0o7QUFPQSxTQUFPLGtCQUFrQixXQUFZO0FBQ25DLFVBQU0sS0FBSyxLQUFLLE1BQU0sU0FBUztBQUMvQixVQUFNLE9BQU8sc0JBQXNCO0FBQ25DLFVBQU0sV0FBVyxLQUFLLE9BQU8sQ0FBQyxNQUFNLEVBQUUsV0FBVyxZQUFZO0FBRzdELFVBQU0sWUFBWSxDQUFDO0FBQ25CLGFBQVMsUUFBUSxDQUFDLE1BQU07QUFDdEIsWUFBTSxJQUFJLEVBQUUsWUFBWTtBQUN4QixVQUFJLENBQUMsVUFBVSxDQUFDO0FBQ2Qsa0JBQVUsQ0FBQyxJQUFJO0FBQUEsVUFDYixNQUFNLEVBQUU7QUFBQSxVQUNSLE1BQU07QUFBQSxVQUNOLEtBQUs7QUFBQSxVQUNMLEtBQUs7QUFBQSxVQUNMLFVBQVUsb0JBQUksSUFBSTtBQUFBLFVBQ2xCLE9BQU8sb0JBQUksSUFBSTtBQUFBLFVBQ2YsT0FBTyxvQkFBSSxJQUFJO0FBQUEsUUFDakI7QUFDRixnQkFBVSxDQUFDLEVBQUUsUUFBUSxFQUFFO0FBQ3ZCLGdCQUFVLENBQUMsRUFBRSxPQUFPLEVBQUU7QUFDdEIsZ0JBQVUsQ0FBQyxFQUFFLE9BQU8sRUFBRTtBQUN0QixnQkFBVSxDQUFDLEVBQUUsU0FBUyxJQUFJLEVBQUUsT0FBTztBQUNuQyxnQkFBVSxDQUFDLEVBQUUsTUFBTSxJQUFJLEVBQUUsTUFBTTtBQUMvQixnQkFBVSxDQUFDLEVBQUUsTUFBTSxJQUFJLEVBQUUsU0FBUztBQUFBLElBQ3BDLENBQUM7QUFDRCxVQUFNLFNBQVMsQ0FBQztBQUNoQixZQUFRLFFBQVEsQ0FBQyxNQUFNO0FBQ3JCLFlBQU0sU0FBUyxVQUFVLEVBQUUsR0FBRztBQUM5QixZQUFNLElBQUksVUFBVSxNQUFNLEtBQUs7QUFBQSxRQUM3QixNQUFNLEVBQUU7QUFBQSxRQUNSLE1BQU07QUFBQSxRQUNOLEtBQUs7QUFBQSxRQUNMLEtBQUs7QUFBQSxRQUNMLFVBQVUsb0JBQUksSUFBSTtBQUFBLFFBQ2xCLE9BQU8sb0JBQUksSUFBSTtBQUFBLFFBQ2YsT0FBTyxvQkFBSSxJQUFJO0FBQUEsTUFDakI7QUFDQSxZQUFNLElBQUksa0JBQWtCLEVBQUUsR0FBRyxLQUFLLEVBQUUsYUFBYSxHQUFHLGdCQUFnQixHQUFHLGVBQWUsRUFBRTtBQUM1RixhQUFPLEtBQUs7QUFBQSxRQUNWLE1BQU0sRUFBRTtBQUFBLFFBQ1IsVUFBVTtBQUFBLFFBQ1YsWUFBWSxFQUFFLE1BQU07QUFBQSxRQUNwQixvQkFBb0IsRUFBRSxTQUFTO0FBQUEsUUFDL0IsdUJBQXVCLEVBQUUsTUFBTTtBQUFBLFFBQy9CLFVBQVUsRUFBRTtBQUFBLFFBQ1osaUJBQWlCLEtBQUssTUFBTSxFQUFFLEdBQUc7QUFBQSxRQUNqQyxpQkFBaUIsS0FBSyxNQUFNLEVBQUUsR0FBRztBQUFBLFFBQ2pDLHVCQUF1QixFQUFFO0FBQUEsUUFDekIsMkJBQTJCLEVBQUU7QUFBQSxRQUM3QixtQkFBbUIsRUFBRTtBQUFBLE1BQ3ZCLENBQUM7QUFBQSxJQUNILENBQUM7QUFDRCxVQUFNLE1BQU0sS0FBSyxNQUFNLGNBQWMsTUFBTTtBQUMzQyxRQUFJLE9BQU8sSUFBSTtBQUFBLE1BQ2IsRUFBRSxLQUFLLEVBQUU7QUFBQSxNQUNULEVBQUUsS0FBSyxHQUFHO0FBQUEsTUFDVixFQUFFLEtBQUssR0FBRztBQUFBLE1BQ1YsRUFBRSxLQUFLLEdBQUc7QUFBQSxNQUNWLEVBQUUsS0FBSyxHQUFHO0FBQUEsTUFDVixFQUFFLEtBQUssR0FBRztBQUFBLE1BQ1YsRUFBRSxLQUFLLEdBQUc7QUFBQSxNQUNWLEVBQUUsS0FBSyxHQUFHO0FBQUEsTUFDVixFQUFFLEtBQUssR0FBRztBQUFBLE1BQ1YsRUFBRSxLQUFLLEdBQUc7QUFBQSxNQUNWLEVBQUUsS0FBSyxHQUFHO0FBQUEsSUFDWjtBQUNBLFNBQUssTUFBTSxrQkFBa0IsSUFBSSxLQUFLLGFBQWE7QUFHbkQsWUFBUSxRQUFRLENBQUMsTUFBTTtBQUNyQixZQUFNLFNBQVMsVUFBVSxFQUFFLEdBQUc7QUFDOUIsWUFBTSxRQUFRLFNBQ1gsT0FBTyxDQUFDLE1BQU0sRUFBRSxhQUFhLE1BQU0sRUFDbkMsSUFBSSxDQUFDLE9BQU87QUFBQSxRQUNYLE9BQU8sRUFBRTtBQUFBLFFBQ1QsS0FBSyxFQUFFO0FBQUEsUUFDUCxXQUFXLEVBQUU7QUFBQSxRQUNiLFdBQVcsRUFBRTtBQUFBLFFBQ2IsU0FBUyxFQUFFO0FBQUEsUUFDWCxNQUFNLEVBQUU7QUFBQSxRQUNSLFFBQVEsRUFBRTtBQUFBLFFBQ1YsVUFBVSxFQUFFO0FBQUEsUUFDWixXQUFXLEVBQUU7QUFBQSxRQUNiLFNBQVMsRUFBRTtBQUFBLFFBQ1gsWUFBWSxFQUFFO0FBQUEsUUFDZCxVQUFVLEVBQUU7QUFBQSxRQUNaLGNBQWMsRUFBRTtBQUFBLFFBQ2hCLGdCQUFnQixFQUFFO0FBQUEsUUFDbEIsZ0JBQWdCLEVBQUU7QUFBQSxNQUNwQixFQUFFO0FBQ0osWUFBTTtBQUFBLFFBQ0osQ0FBQyxHQUFHLE9BQU8sRUFBRSxTQUFTLElBQUksY0FBYyxFQUFFLFNBQVMsRUFBRSxLQUFLLEVBQUUsUUFBUSxjQUFjLEVBQUUsT0FBTztBQUFBLE1BQzdGO0FBQ0EsVUFBSSxDQUFDLE1BQU07QUFDVCxjQUFNLEtBQUs7QUFBQSxVQUNULE9BQU87QUFBQSxVQUNQLEtBQUs7QUFBQSxVQUNMLFdBQVc7QUFBQSxVQUNYLFdBQVc7QUFBQSxVQUNYLFNBQVM7QUFBQSxVQUNULE1BQU07QUFBQSxVQUNOLFFBQVE7QUFBQSxVQUNSLFVBQVU7QUFBQSxVQUNWLFdBQVc7QUFBQSxVQUNYLFNBQVM7QUFBQSxVQUNULFlBQVk7QUFBQSxVQUNaLFVBQVU7QUFBQSxVQUNWLGNBQWM7QUFBQSxVQUNkLGdCQUFnQjtBQUFBLFVBQ2hCLGdCQUFnQjtBQUFBLFFBQ2xCLENBQUM7QUFDSCxZQUFNLEtBQUssS0FBSyxNQUFNLGNBQWMsS0FBSztBQUN6QyxTQUFHLE9BQU8sSUFBSTtBQUFBLFFBQ1osRUFBRSxLQUFLLEdBQUc7QUFBQSxRQUNWLEVBQUUsS0FBSyxHQUFHO0FBQUEsUUFDVixFQUFFLEtBQUssR0FBRztBQUFBLFFBQ1YsRUFBRSxLQUFLLEdBQUc7QUFBQSxRQUNWLEVBQUUsS0FBSyxHQUFHO0FBQUEsUUFDVixFQUFFLEtBQUssR0FBRztBQUFBLFFBQ1YsRUFBRSxLQUFLLEdBQUc7QUFBQSxRQUNWLEVBQUUsS0FBSyxHQUFHO0FBQUEsUUFDVixFQUFFLEtBQUssR0FBRztBQUFBLFFBQ1YsRUFBRSxLQUFLLEdBQUc7QUFBQSxRQUNWLEVBQUUsS0FBSyxHQUFHO0FBQUEsUUFDVixFQUFFLEtBQUssR0FBRztBQUFBLFFBQ1YsRUFBRSxLQUFLLEdBQUc7QUFBQSxRQUNWLEVBQUUsS0FBSyxHQUFHO0FBQUEsUUFDVixFQUFFLEtBQUssR0FBRztBQUFBLE1BQ1o7QUFDQSxXQUFLLE1BQU07QUFBQSxRQUNUO0FBQUEsUUFDQTtBQUFBLFNBQ0MsRUFBRSxPQUFPLE1BQU0sUUFBUSxVQUFVLEdBQUcsRUFBRSxFQUFFLFFBQVEsZ0JBQWdCLEVBQUU7QUFBQSxNQUNyRTtBQUFBLElBQ0YsQ0FBQztBQUdELFVBQU0sWUFBWSxlQUFlO0FBQ2pDLFFBQUksVUFBVSxRQUFRO0FBQ3BCLFlBQU0sTUFBTSxLQUFLLE1BQU0sY0FBYyxTQUFTO0FBQzlDLFdBQUssTUFBTSxrQkFBa0IsSUFBSSxLQUFLLFNBQVM7QUFBQSxJQUNqRDtBQUVBLFVBQU0sY0FBYyxxQkFBcUI7QUFDekMsUUFBSSxZQUFZLFFBQVE7QUFDdEIsV0FBSyxNQUFNLGtCQUFrQixJQUFJLEtBQUssTUFBTSxjQUFjLFdBQVcsR0FBRyxhQUFhO0FBQUEsSUFDdkY7QUFFQSxVQUFNLFVBQVUsZ0JBQWdCO0FBQ2hDLFFBQUksUUFBUSxRQUFRO0FBQ2xCLFdBQUssTUFBTSxrQkFBa0IsSUFBSSxLQUFLLE1BQU0sY0FBYyxPQUFPLEdBQUcsaUJBQWlCO0FBQUEsSUFDdkY7QUFFQSxTQUFLLFVBQVUsSUFBSSx1QkFBdUIsU0FBUyxJQUFJLE9BQU87QUFBQSxFQUNoRTtBQUdBLFNBQU8sb0JBQW9CLFdBQVk7QUFDckMsUUFBSSxPQUFPLFNBQVMsYUFBYTtBQUMvQixZQUFNLGlGQUFpRjtBQUN2RjtBQUFBLElBQ0Y7QUFDQSxVQUFNLFlBQVksZUFBZTtBQUNqQyxRQUFJLENBQUMsVUFBVSxRQUFRO0FBQ3JCO0FBQUEsUUFDRTtBQUFBLE1BQ0Y7QUFDQTtBQUFBLElBQ0Y7QUFDQSxVQUFNLEtBQUssS0FBSyxNQUFNLFNBQVM7QUFHL0IsVUFBTSxLQUFLLEtBQUssTUFBTSxjQUFjLFNBQVM7QUFDN0MsT0FBRyxPQUFPLElBQUk7QUFBQSxNQUNaLEVBQUUsS0FBSyxHQUFHO0FBQUEsTUFDVixFQUFFLEtBQUssR0FBRztBQUFBLE1BQ1YsRUFBRSxLQUFLLEVBQUU7QUFBQSxNQUNULEVBQUUsS0FBSyxHQUFHO0FBQUEsTUFDVixFQUFFLEtBQUssR0FBRztBQUFBLE1BQ1YsRUFBRSxLQUFLLEdBQUc7QUFBQSxNQUNWLEVBQUUsS0FBSyxHQUFHO0FBQUEsTUFDVixFQUFFLEtBQUssR0FBRztBQUFBLE1BQ1YsRUFBRSxLQUFLLEdBQUc7QUFBQSxNQUNWLEVBQUUsS0FBSyxHQUFHO0FBQUEsTUFDVixFQUFFLEtBQUssR0FBRztBQUFBLE1BQ1YsRUFBRSxLQUFLLEdBQUc7QUFBQSxNQUNWLEVBQUUsS0FBSyxFQUFFO0FBQUEsTUFDVCxFQUFFLEtBQUssR0FBRztBQUFBLE1BQ1YsRUFBRSxLQUFLLEdBQUc7QUFBQSxNQUNWLEVBQUUsS0FBSyxHQUFHO0FBQUEsTUFDVixFQUFFLEtBQUssR0FBRztBQUFBLE1BQ1YsRUFBRSxLQUFLLEdBQUc7QUFBQSxNQUNWLEVBQUUsS0FBSyxHQUFHO0FBQUEsTUFDVixFQUFFLEtBQUssR0FBRztBQUFBLE1BQ1YsRUFBRSxLQUFLLEdBQUc7QUFBQSxNQUNWLEVBQUUsS0FBSyxHQUFHO0FBQUEsTUFDVixFQUFFLEtBQUssR0FBRztBQUFBLE1BQ1YsRUFBRSxLQUFLLEdBQUc7QUFBQSxNQUNWLEVBQUUsS0FBSyxHQUFHO0FBQUEsTUFDVixFQUFFLEtBQUssR0FBRztBQUFBLElBQ1o7QUFDQSxTQUFLLE1BQU0sa0JBQWtCLElBQUksSUFBSSxTQUFTO0FBRzlDLFVBQU0sWUFBWSxDQUFDO0FBQ25CLGdCQUFZLFFBQVEsQ0FBQyxNQUFNO0FBQ3pCLFlBQU0sSUFBSSxVQUFVLEVBQUUsVUFBVSxhQUFhO0FBQzdDLFVBQUksQ0FBQyxVQUFVLENBQUM7QUFDZCxrQkFBVSxDQUFDLElBQUk7QUFBQSxVQUNiLFNBQVM7QUFBQSxVQUNULFNBQVMsb0JBQUksSUFBSTtBQUFBLFVBQ2pCLGFBQWEsb0JBQUksSUFBSTtBQUFBLFVBQ3JCLFlBQVksb0JBQUksSUFBSTtBQUFBLFFBQ3RCO0FBQ0YsZ0JBQVUsQ0FBQyxFQUFFO0FBQ2IsVUFBSSxFQUFFLE9BQVEsV0FBVSxDQUFDLEVBQUUsUUFBUSxJQUFJLEVBQUUsTUFBTTtBQUMvQyxVQUFJLEVBQUUsVUFBVyxXQUFVLENBQUMsRUFBRSxZQUFZLElBQUksRUFBRSxTQUFTO0FBQ3pELFVBQUksRUFBRSxVQUFXLFdBQVUsQ0FBQyxFQUFFLFdBQVcsSUFBSSxFQUFFLFNBQVM7QUFBQSxJQUMxRCxDQUFDO0FBQ0QsVUFBTSxVQUFVLE9BQU8sUUFBUSxTQUFTLEVBQ3JDLElBQUksQ0FBQyxDQUFDLFVBQVUsQ0FBQyxPQUFPO0FBQUEsTUFDdkIsVUFBVTtBQUFBLE1BQ1YsbUJBQW1CLEVBQUU7QUFBQSxNQUNyQixxQkFBcUIsRUFBRSxRQUFRO0FBQUEsTUFDL0IseUJBQXlCLEVBQUUsWUFBWTtBQUFBLE1BQ3ZDLHdCQUF3QixFQUFFLFdBQVc7QUFBQSxJQUN2QyxFQUFFLEVBQ0QsS0FBSyxDQUFDLEdBQUcsTUFBTSxFQUFFLGlCQUFpQixJQUFJLEVBQUUsaUJBQWlCLENBQUM7QUFDN0QsUUFBSSxRQUFRLFFBQVE7QUFDbEIsWUFBTSxNQUFNLEtBQUssTUFBTSxjQUFjLE9BQU87QUFDNUMsVUFBSSxPQUFPLElBQUksQ0FBQyxFQUFFLEtBQUssR0FBRyxHQUFHLEVBQUUsS0FBSyxHQUFHLEdBQUcsRUFBRSxLQUFLLEdBQUcsR0FBRyxFQUFFLEtBQUssR0FBRyxHQUFHLEVBQUUsS0FBSyxHQUFHLENBQUM7QUFDL0UsV0FBSyxNQUFNLGtCQUFrQixJQUFJLEtBQUssc0JBQXNCO0FBQUEsSUFDOUQ7QUFFQSxTQUFLLFVBQVUsSUFBSSxxQkFBcUIsU0FBUyxJQUFJLE9BQU87QUFBQSxFQUM5RDtBQUdBLFNBQU8sZ0JBQWdCLFdBQVk7QUFDakMsVUFBTSxLQUFLLEtBQUssTUFBTSxTQUFTO0FBQy9CLFVBQU0sT0FBTyxzQkFBc0I7QUFHbkMsVUFBTSxXQUFXLEtBQUssT0FBTyxDQUFDLE1BQU0sRUFBRSxXQUFXLFVBQVU7QUFDM0QsVUFBTSxNQUFNLEtBQUssTUFBTTtBQUFBLE1BQ3JCLFNBQVMsSUFBSSxDQUFDLE9BQU87QUFBQSxRQUNuQixTQUFTLEVBQUU7QUFBQSxRQUNYLE9BQU8sRUFBRTtBQUFBLFFBQ1QsUUFBUSxFQUFFO0FBQUEsUUFDVixjQUFjLEVBQUU7QUFBQSxRQUNoQixNQUFNLEVBQUU7QUFBQSxRQUNSLFdBQVcsRUFBRTtBQUFBLFFBQ2IsV0FBVyxFQUFFO0FBQUEsUUFDYixTQUFTLEVBQUU7QUFBQSxRQUNYLGNBQWMsRUFBRTtBQUFBLFFBQ2hCLEtBQUssRUFBRTtBQUFBLFFBQ1AsVUFBVSxFQUFFO0FBQUEsUUFDWixpQkFBaUIsRUFBRTtBQUFBLFFBQ25CLGNBQWMsRUFBRTtBQUFBLFFBQ2hCLGNBQWMsRUFBRTtBQUFBLE1BQ2xCLEVBQUU7QUFBQSxJQUNKO0FBQ0EsU0FBSyxNQUFNLGtCQUFrQixJQUFJLEtBQUssY0FBYztBQUdwRCxVQUFNLE9BQU8sUUFBUSxJQUFJLENBQUMsTUFBTTtBQUM5QixZQUFNLElBQUksa0JBQWtCLEVBQUUsR0FBRyxLQUFLLENBQUM7QUFDdkMsYUFBTztBQUFBLFFBQ0wsY0FBYyxFQUFFO0FBQUEsUUFDaEIsaUJBQWlCLFVBQVUsRUFBRSxHQUFHO0FBQUEsUUFDaEMsTUFBTSxFQUFFO0FBQUEsUUFDUixrQkFBa0IsRUFBRTtBQUFBLFFBQ3BCLE9BQU8sRUFBRTtBQUFBLFFBQ1Qsb0JBQW9CLEVBQUUsZUFBZTtBQUFBLFFBQ3JDLHVCQUF1QixFQUFFLGtCQUFrQjtBQUFBLFFBQzNDLGlCQUFpQixFQUFFLGlCQUFpQjtBQUFBLE1BQ3RDO0FBQUEsSUFDRixDQUFDO0FBQ0QsU0FBSyxNQUFNLGtCQUFrQixJQUFJLEtBQUssTUFBTSxjQUFjLElBQUksR0FBRyxjQUFjO0FBRy9FLFVBQU0sT0FBTyxTQUFTLElBQUksQ0FBQyxPQUFPO0FBQUEsTUFDaEMsS0FBSyxFQUFFO0FBQUEsTUFDUCxhQUFhLEVBQUU7QUFBQSxNQUNmLFdBQVcsRUFBRTtBQUFBLE1BQ2IsU0FBUyxFQUFFO0FBQUEsTUFDWCxZQUFZLEVBQUU7QUFBQSxJQUNoQixFQUFFO0FBQ0YsU0FBSyxNQUFNLGtCQUFrQixJQUFJLEtBQUssTUFBTSxjQUFjLElBQUksR0FBRyxjQUFjO0FBRy9FLFVBQU0sT0FBTyxDQUFDO0FBQ2QsV0FBTyxRQUFRLENBQUMsTUFBTTtBQUNwQixZQUFNLEtBQUssYUFBYSxFQUFFLE1BQU07QUFDaEMsUUFBRSxRQUFRO0FBQUEsUUFBUSxDQUFDLE1BQ2pCLEtBQUssS0FBSztBQUFBLFVBQ1IsU0FBUztBQUFBLFVBQ1QsTUFBTTtBQUFBLFVBQ04sV0FBVyxVQUFVLEVBQUUsUUFBUTtBQUFBLFVBQy9CLFdBQVcsRUFBRTtBQUFBLFVBQ2IsY0FBYyxFQUFFLFFBQVE7QUFBQSxVQUN4QixjQUFjLEVBQUUsVUFBVTtBQUFBLFVBQzFCLE1BQU0sS0FBSyxHQUFHLE9BQU87QUFBQSxRQUN2QixDQUFDO0FBQUEsTUFDSDtBQUNBLFFBQUUsVUFBVTtBQUFBLFFBQVEsQ0FBQyxNQUNuQixLQUFLLEtBQUs7QUFBQSxVQUNSLFNBQVM7QUFBQSxVQUNULE1BQU07QUFBQSxVQUNOLFdBQVcsVUFBVSxFQUFFLFFBQVE7QUFBQSxVQUMvQixXQUFXLEVBQUU7QUFBQSxVQUNiLGNBQWMsRUFBRSxRQUFRO0FBQUEsVUFDeEIsY0FBYyxFQUFFLFVBQVU7QUFBQSxVQUMxQixNQUFNLEtBQUssR0FBRyxPQUFPO0FBQUEsUUFDdkIsQ0FBQztBQUFBLE1BQ0g7QUFBQSxJQUNGLENBQUM7QUFDRCxTQUFLLE1BQU0sa0JBQWtCLElBQUksS0FBSyxNQUFNLGNBQWMsSUFBSSxHQUFHLGFBQWE7QUFHOUUsVUFBTSxTQUFTLG9CQUFJLElBQUk7QUFDdkIsYUFBUyxRQUFRLENBQUMsTUFBTTtBQUN0QixVQUFJLEVBQUUsTUFBTyxRQUFPLElBQUksRUFBRSxLQUFLO0FBQUEsSUFDakMsQ0FBQztBQUVELFVBQU0sUUFBUSxvQkFBSSxLQUFLLFlBQVk7QUFDbkMsVUFBTSxNQUFNLG9CQUFJLEtBQUs7QUFDckIsUUFBSSxRQUFRLElBQUksUUFBUSxJQUFJLEdBQUc7QUFDL0IsYUFBUyxJQUFJLElBQUksS0FBSyxLQUFLLEdBQUcsS0FBSyxLQUFLLEVBQUUsUUFBUSxFQUFFLFFBQVEsSUFBSSxDQUFDO0FBQy9ELGFBQU8sSUFBSSxFQUFFLFlBQVksRUFBRSxNQUFNLEdBQUcsRUFBRSxDQUFDO0FBQ3pDLFVBQU0sU0FBUyxDQUFDLEdBQUcsTUFBTSxFQUFFLEtBQUssRUFBRSxJQUFJLENBQUMsT0FBTztBQUM1QyxZQUFNLENBQUMsR0FBRyxHQUFHLEVBQUUsSUFBSSxHQUFHLE1BQU0sR0FBRyxFQUFFLElBQUksQ0FBQyxNQUFNLFNBQVMsR0FBRyxFQUFFLENBQUM7QUFDM0QsWUFBTSxVQUFVLElBQUksS0FBSyxHQUFHLElBQUksR0FBRyxFQUFFO0FBQ3JDLGFBQU87QUFBQSxRQUNMLE9BQU87QUFBQSxRQUNQLE1BQU07QUFBQSxRQUNOLE9BQU87QUFBQSxRQUNQLEtBQUs7QUFBQSxRQUNMLFNBQVMsT0FBTyxLQUFLLE9BQU8sSUFBSSxLQUFLLENBQUMsSUFBSTtBQUFBLFFBQzFDLFlBQVksTUFBTSxJQUFJLENBQUM7QUFBQSxRQUN2QixZQUFZLElBQUksTUFBTSxPQUFPLENBQUMsRUFBRSxTQUFTLEdBQUcsR0FBRztBQUFBLFFBQy9DLGFBQWEsQ0FBQyxPQUFPLE9BQU8sT0FBTyxPQUFPLE9BQU8sT0FBTyxLQUFLLEVBQUUsUUFBUSxPQUFPLENBQUM7QUFBQSxNQUNqRjtBQUFBLElBQ0YsQ0FBQztBQUNELFNBQUssTUFBTSxrQkFBa0IsSUFBSSxLQUFLLE1BQU0sY0FBYyxNQUFNLEdBQUcsZ0JBQWdCO0FBR25GLFVBQU0sU0FBUyxlQUFlLElBQUksQ0FBQyxPQUFPO0FBQUEsTUFDeEMsYUFBYSxFQUFFO0FBQUEsTUFDZixRQUFRLEVBQUU7QUFBQSxNQUNWLGFBQWEsRUFBRTtBQUFBLE1BQ2YsZ0JBQWdCLEVBQUUsZ0JBQWdCLENBQUMsR0FBRyxLQUFLLElBQUk7QUFBQSxNQUMvQyxhQUFhLEVBQUU7QUFBQSxNQUNmLGVBQWUsRUFBRTtBQUFBLE1BQ2pCLE9BQU8sRUFBRTtBQUFBLE1BQ1QsT0FBTyxFQUFFO0FBQUEsSUFDWCxFQUFFO0FBQ0YsUUFBSSxPQUFPO0FBQ1QsV0FBSyxNQUFNLGtCQUFrQixJQUFJLEtBQUssTUFBTSxjQUFjLE1BQU0sR0FBRyxjQUFjO0FBR25GLFNBQUssTUFBTTtBQUFBLE1BQ1Q7QUFBQSxNQUNBLEtBQUssTUFBTSxjQUFjO0FBQUEsUUFDdkIsRUFBRSxXQUFXLHlCQUF5QixPQUFPLGNBQWM7QUFBQSxRQUMzRCxFQUFFLFdBQVcsZ0JBQWdCLE9BQU8sU0FBUyxFQUFFO0FBQUEsUUFDL0MsRUFBRSxXQUFXLG9CQUFvQixPQUFPLFNBQVMsT0FBTztBQUFBLE1BQzFELENBQUM7QUFBQSxNQUNEO0FBQUEsSUFDRjtBQUdBLFVBQU0sYUFBYSxlQUFlO0FBQ2xDLFFBQUksV0FBVztBQUNiLFdBQUssTUFBTSxrQkFBa0IsSUFBSSxLQUFLLE1BQU0sY0FBYyxVQUFVLEdBQUcsY0FBYztBQUV2RixVQUFNLGVBQWUscUJBQXFCO0FBQzFDLFFBQUksYUFBYTtBQUNmLFdBQUssTUFBTSxrQkFBa0IsSUFBSSxLQUFLLE1BQU0sY0FBYyxZQUFZLEdBQUcsYUFBYTtBQUV4RixVQUFNLFdBQVcsZ0JBQWdCO0FBQ2pDLFFBQUksU0FBUztBQUNYLFdBQUssTUFBTSxrQkFBa0IsSUFBSSxLQUFLLE1BQU0sY0FBYyxRQUFRLEdBQUcsaUJBQWlCO0FBRXhGLFNBQUssVUFBVSxJQUFJLHFCQUFxQixTQUFTLElBQUksT0FBTztBQUFBLEVBQzlEO0FBR0EsU0FBTyxXQUFXLFdBQVk7QUFDNUIsVUFBTSxLQUFLLEtBQUssTUFBTSxTQUFTO0FBQy9CLFVBQU0sT0FBTyxzQkFBc0I7QUFFbkMsVUFBTSxLQUFLLEtBQUssTUFBTSxjQUFjLElBQUk7QUFDeEMsT0FBRyxPQUFPLElBQUksT0FBTyxLQUFLLEtBQUssQ0FBQyxLQUFLLEVBQUUsT0FBTyxHQUFHLENBQUMsRUFBRSxJQUFJLE9BQU8sRUFBRSxLQUFLLEdBQUcsRUFBRTtBQUMzRSxTQUFLLE1BQU0sa0JBQWtCLElBQUksSUFBSSxXQUFXO0FBR2hELFNBQUssTUFBTTtBQUFBLE1BQ1Q7QUFBQSxNQUNBLEtBQUssTUFBTTtBQUFBLFFBQ1QsU0FBUyxJQUFJLENBQUMsT0FBTyxFQUFFLE1BQU0sRUFBRSxNQUFNLE1BQU0sRUFBRSxNQUFNLEtBQUssRUFBRSxLQUFLLEtBQUssRUFBRSxLQUFLLEtBQUssRUFBRSxJQUFJLEVBQUU7QUFBQSxNQUMxRjtBQUFBLE1BQ0E7QUFBQSxJQUNGO0FBRUEsVUFBTSxXQUFXLENBQUM7QUFDbEIsV0FBTyxRQUFRLENBQUMsTUFBTTtBQUNwQixZQUFNLEtBQUssYUFBYSxFQUFFLE1BQU07QUFDaEMsUUFBRSxRQUFRO0FBQUEsUUFBUSxDQUFDLE1BQ2pCLFNBQVMsS0FBSztBQUFBLFVBQ1osU0FBUztBQUFBLFVBQ1QsTUFBTTtBQUFBLFVBQ04sV0FBVyxVQUFVLEVBQUUsUUFBUTtBQUFBLFVBQy9CLFdBQVcsRUFBRTtBQUFBLFVBQ2IsY0FBYyxFQUFFLFFBQVE7QUFBQSxVQUN4QixVQUFVLFVBQVUsRUFBRSxVQUFVLEVBQUU7QUFBQSxVQUNsQyxNQUFNLEtBQUssR0FBRyxPQUFPO0FBQUEsVUFDckIsS0FBSyxFQUFFO0FBQUEsVUFDUCxLQUFLLEVBQUU7QUFBQSxRQUNULENBQUM7QUFBQSxNQUNIO0FBQ0EsUUFBRSxVQUFVO0FBQUEsUUFBUSxDQUFDLE1BQ25CLFNBQVMsS0FBSztBQUFBLFVBQ1osU0FBUztBQUFBLFVBQ1QsTUFBTTtBQUFBLFVBQ04sV0FBVyxVQUFVLEVBQUUsUUFBUTtBQUFBLFVBQy9CLFdBQVcsRUFBRTtBQUFBLFVBQ2IsY0FBYyxFQUFFLFFBQVE7QUFBQSxVQUN4QixVQUFVLFVBQVUsRUFBRSxVQUFVLEVBQUU7QUFBQSxVQUNsQyxNQUFNLEtBQUssR0FBRyxPQUFPO0FBQUEsVUFDckIsS0FBSyxFQUFFO0FBQUEsVUFDUCxLQUFLLEVBQUU7QUFBQSxRQUNULENBQUM7QUFBQSxNQUNIO0FBQUEsSUFDRixDQUFDO0FBQ0QsU0FBSyxNQUFNLGtCQUFrQixJQUFJLEtBQUssTUFBTSxjQUFjLFFBQVEsR0FBRyxtQkFBbUI7QUFHeEYsVUFBTSxjQUFjLENBQUM7QUFDckIsV0FBTyxRQUFRLGlCQUFpQixFQUFFLFFBQVEsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxNQUFNO0FBQ3pELGtCQUFZLEtBQUs7QUFBQSxRQUNmLFVBQVUsa0JBQWtCLE1BQU07QUFBQSxRQUNsQyxTQUFTO0FBQUEsUUFDVCxZQUFZO0FBQUEsUUFDWixVQUFVO0FBQUEsUUFDVixZQUFZLEVBQUUsZUFBZTtBQUFBLE1BQy9CLENBQUM7QUFDRCxrQkFBWSxLQUFLO0FBQUEsUUFDZixVQUFVLGtCQUFrQixNQUFNO0FBQUEsUUFDbEMsU0FBUztBQUFBLFFBQ1QsWUFBWTtBQUFBLFFBQ1osVUFBVTtBQUFBLFFBQ1YsWUFBWSxFQUFFLGtCQUFrQjtBQUFBLE1BQ2xDLENBQUM7QUFDRCxrQkFBWSxLQUFLO0FBQUEsUUFDZixVQUFVLGtCQUFrQixNQUFNO0FBQUEsUUFDbEMsU0FBUztBQUFBLFFBQ1QsWUFBWTtBQUFBLFFBQ1osVUFBVTtBQUFBLFFBQ1YsWUFBWSxFQUFFLGlCQUFpQjtBQUFBLE1BQ2pDLENBQUM7QUFBQSxJQUNILENBQUM7QUFDRCxTQUFLLE1BQU0sa0JBQWtCLElBQUksS0FBSyxNQUFNLGNBQWMsV0FBVyxHQUFHLGNBQWM7QUFHdEYsUUFBSSxlQUFlLFFBQVE7QUFDekIsV0FBSyxNQUFNO0FBQUEsUUFDVDtBQUFBLFFBQ0EsS0FBSyxNQUFNO0FBQUEsVUFDVCxlQUFlLElBQUksQ0FBQyxPQUFPO0FBQUEsWUFDekIsSUFBSSxFQUFFO0FBQUEsWUFDTixRQUFRLEVBQUU7QUFBQSxZQUNWLGFBQWEsRUFBRTtBQUFBLFlBQ2YsZ0JBQWdCLEVBQUUsZ0JBQWdCLENBQUMsR0FBRyxLQUFLLEdBQUc7QUFBQSxZQUM5QyxhQUFhLEVBQUU7QUFBQSxZQUNmLGVBQWUsRUFBRTtBQUFBLFlBQ2pCLFlBQVksRUFBRTtBQUFBLFlBQ2QsVUFBVSxFQUFFO0FBQUEsVUFDZCxFQUFFO0FBQUEsUUFDSjtBQUFBLFFBQ0E7QUFBQSxNQUNGO0FBQUEsSUFDRjtBQUdBLFNBQUssTUFBTTtBQUFBLE1BQ1Q7QUFBQSxNQUNBLEtBQUssTUFBTSxjQUFjO0FBQUEsUUFDdkIsRUFBRSxXQUFXLHlCQUF5QixPQUFPLGNBQWM7QUFBQSxRQUMzRCxFQUFFLFdBQVcsZ0JBQWdCLFFBQU8sb0JBQUksS0FBSyxHQUFFLFlBQVksRUFBRTtBQUFBLE1BQy9ELENBQUM7QUFBQSxNQUNEO0FBQUEsSUFDRjtBQUdBLFVBQU0sYUFBYSxlQUFlO0FBQ2xDLFFBQUksV0FBVztBQUNiLFdBQUssTUFBTSxrQkFBa0IsSUFBSSxLQUFLLE1BQU0sY0FBYyxVQUFVLEdBQUcsU0FBUztBQUVsRixVQUFNLGVBQWUscUJBQXFCO0FBQzFDLFFBQUksYUFBYTtBQUNmLFdBQUssTUFBTSxrQkFBa0IsSUFBSSxLQUFLLE1BQU0sY0FBYyxZQUFZLEdBQUcsYUFBYTtBQUV4RixVQUFNLFdBQVcsZ0JBQWdCO0FBQ2pDLFFBQUksU0FBUztBQUNYLFdBQUssTUFBTSxrQkFBa0IsSUFBSSxLQUFLLE1BQU0sY0FBYyxRQUFRLEdBQUcsaUJBQWlCO0FBRXhGLFNBQUssVUFBVSxJQUFJLGdCQUFnQixTQUFTLElBQUksT0FBTztBQUFBLEVBQ3pEO0FBVUEsU0FBTyx3QkFBd0IsV0FBWTtBQUV6QyxVQUFNLFFBQVEsU0FBUyxlQUFlLHFCQUFxQjtBQUMzRCxRQUFJLE9BQU87QUFDVCxZQUFNLG1CQUFtQixhQUFhLFdBQVcsYUFBYTtBQUM5RCxZQUFNLE1BQU0sVUFBVSxtQkFBbUIsS0FBSztBQUFBLElBQ2hEO0FBRUEsVUFBTSxPQUFPLFNBQVMsZUFBZSx5QkFBeUI7QUFDOUQsUUFBSSxLQUFNLE1BQUssTUFBTSxVQUFVO0FBQy9CLGFBQVMsZUFBZSxxQkFBcUIsRUFBRSxVQUFVLElBQUksTUFBTTtBQUFBLEVBQ3JFO0FBRUEsU0FBTyx5QkFBeUIsV0FBWTtBQUMxQyxhQUFTLGVBQWUscUJBQXFCLEVBQUUsVUFBVSxPQUFPLE1BQU07QUFBQSxFQUN4RTtBQUtBLFdBQVMsc0JBQXNCLFFBQVEsU0FBUztBQUM5QyxVQUFNLElBQUksU0FBUyxlQUFlLHVCQUF1QjtBQUN6RCxVQUFNLElBQUksU0FBUyxlQUFlLG9CQUFvQjtBQUN0RCxVQUFNLE9BQU8sU0FBUyxlQUFlLHlCQUF5QjtBQUM5RCxRQUFJLEtBQU0sTUFBSyxNQUFNLFVBQVU7QUFDL0IsUUFBSSxFQUFHLEdBQUUsY0FBYztBQUN2QixRQUFJLEVBQUcsR0FBRSxNQUFNLFFBQVEsS0FBSyxJQUFJLEdBQUcsS0FBSyxJQUFJLEtBQUssT0FBTyxDQUFDLElBQUk7QUFBQSxFQUMvRDtBQU1BLGlCQUFlLGtCQUFrQjtBQUMvQixRQUFJO0FBQ0YsWUFBTSxJQUFJLE1BQU0sTUFBTSxvQkFBb0IsS0FBSyxJQUFJLEdBQUcsRUFBRSxPQUFPLFdBQVcsQ0FBQztBQUMzRSxVQUFJLENBQUMsRUFBRSxHQUFJLE9BQU0sSUFBSSxNQUFNLFVBQVUsRUFBRSxNQUFNO0FBQzdDLGFBQU8sTUFBTSxFQUFFLEtBQUs7QUFBQSxJQUN0QixTQUFTLEdBQUc7QUFDVixjQUFRLEtBQUssd0NBQXdDLEtBQUssRUFBRSxPQUFPO0FBQ25FLGFBQU87QUFBQSxJQUNUO0FBQUEsRUFDRjtBQUtBLGlCQUFlLHFCQUFxQjtBQUNsQyxRQUFJLE9BQU8sVUFBVSxZQUFhO0FBQ2xDLFVBQU0sSUFBSSxRQUFRLENBQUMsU0FBUyxXQUFXO0FBQ3JDLFlBQU0sSUFBSSxTQUFTLGNBQWMsUUFBUTtBQUN6QyxRQUFFLE1BQU07QUFDUixRQUFFLFNBQVM7QUFDWCxRQUFFLFVBQVUsTUFBTSxPQUFPLElBQUksTUFBTSx5QkFBeUIsQ0FBQztBQUM3RCxlQUFTLEtBQUssWUFBWSxDQUFDO0FBQUEsSUFDN0IsQ0FBQztBQUFBLEVBQ0g7QUFLQSxXQUFTLGNBQWMsTUFBTSxVQUFVO0FBQ3JDLFVBQU0sTUFBTSxJQUFJLGdCQUFnQixJQUFJO0FBQ3BDLFVBQU0sSUFBSSxTQUFTLGNBQWMsR0FBRztBQUNwQyxNQUFFLE9BQU87QUFDVCxNQUFFLFdBQVc7QUFDYixhQUFTLEtBQUssWUFBWSxDQUFDO0FBQzNCLE1BQUUsTUFBTTtBQUNSLGVBQVcsTUFBTTtBQUNmLGVBQVMsS0FBSyxZQUFZLENBQUM7QUFDM0IsVUFBSSxnQkFBZ0IsR0FBRztBQUFBLElBQ3pCLEdBQUcsR0FBRztBQUFBLEVBQ1I7QUFjQSxTQUFPLG1CQUFtQixpQkFBa0I7QUFDMUMsUUFBSSxhQUFhLFdBQVcsYUFBYSxXQUFXO0FBQ2xELFlBQU0sa0RBQWtEO0FBQ3hEO0FBQUEsSUFDRjtBQUNBLFFBQUksQ0FBQyxNQUFNO0FBQ1QsWUFBTSw0Q0FBNEM7QUFDbEQ7QUFBQSxJQUNGO0FBR0EsYUFBUyxlQUFlLHFCQUFxQixFQUFFLFVBQVUsSUFBSSxNQUFNO0FBQ25FLDBCQUFzQixpQkFBaUIsQ0FBQztBQUV4QyxRQUFJO0FBQ0YsNEJBQXNCLHFCQUFxQixFQUFFO0FBQzdDLFlBQU0sbUJBQW1CO0FBR3pCLDRCQUFzQix5Q0FBeUMsRUFBRTtBQUNqRSxZQUFNLG1CQUFtQjtBQUFBLFFBQ3ZCLENBQUMsV0FBVyxLQUFLLFdBQVcsU0FBUyxFQUFFLElBQUksQ0FBQztBQUFBLFFBQzVDLENBQUMsV0FBVyxLQUFLLFdBQVcsUUFBUSxFQUFFLElBQUksQ0FBQztBQUFBLFFBQzNDLENBQUMsWUFBWSxLQUFLLFdBQVcscUJBQXFCLEVBQUUsSUFBSSxDQUFDO0FBQUEsUUFDekQsQ0FBQyxpQkFBaUIsS0FBSyxXQUFXLGVBQWUsRUFBRSxJQUFJLENBQUM7QUFBQSxRQUN4RCxDQUFDLGVBQWUsS0FBSyxXQUFXLGFBQWEsRUFBRSxJQUFJLENBQUM7QUFBQSxRQUNwRCxDQUFDLGFBQWEsS0FBSyxXQUFXLFdBQVcsRUFBRSxJQUFJLENBQUM7QUFBQSxRQUNoRCxDQUFDLFdBQVcsS0FBSyxXQUFXLFNBQVMsRUFBRSxJQUFJLENBQUM7QUFBQSxRQUM1QyxDQUFDLG9CQUFvQixLQUFLLFdBQVcsa0JBQWtCLEVBQUUsSUFBSSxDQUFDO0FBQUEsUUFDOUQsQ0FBQyxpQkFBaUIsS0FBSyxXQUFXLGVBQWUsRUFBRSxJQUFJLENBQUM7QUFBQSxRQUN4RCxDQUFDLHFCQUFxQixLQUFLLFdBQVcsbUJBQW1CLEVBQUUsSUFBSSxDQUFDO0FBQUEsTUFDbEU7QUFDQSxZQUFNLFdBQVcsaUJBQWlCLElBQUksQ0FBQyxDQUFDLEVBQUUsQ0FBQyxNQUFNLENBQUM7QUFDbEQsZUFBUyxLQUFLLGdCQUFnQixDQUFDO0FBRS9CLFlBQU0sVUFBVSxNQUFNLFFBQVEsV0FBVyxRQUFRO0FBRWpELFlBQU0sa0JBQWtCLENBQUM7QUFDekIsY0FBUSxNQUFNLEdBQUcsaUJBQWlCLE1BQU0sRUFBRSxRQUFRLENBQUMsR0FBRyxNQUFNO0FBQzFELFlBQUksRUFBRSxXQUFXO0FBQ2YsMEJBQWdCO0FBQUEsWUFDZCxpQkFBaUIsQ0FBQyxFQUFFLENBQUMsSUFBSSxRQUFTLEVBQUUsVUFBVSxFQUFFLE9BQU8sV0FBWSxFQUFFO0FBQUEsVUFDdkU7QUFBQSxNQUNKLENBQUM7QUFDRCxVQUFJLGdCQUFnQixRQUFRO0FBQzFCLGNBQU0sSUFBSTtBQUFBLFVBQ1IsOEJBQ0UsZ0JBQWdCLFNBQ2hCLG9CQUNBLGdCQUFnQixLQUFLLElBQUk7QUFBQSxRQUM3QjtBQUFBLE1BQ0Y7QUFHQSxZQUFNO0FBQUE7QUFBQSxRQUFrRCxDQUFDO0FBQUE7QUFDekQsdUJBQWlCLFFBQVEsQ0FBQyxDQUFDLElBQUksR0FBRyxNQUFNO0FBQ3RDLGNBQU07QUFBQTtBQUFBLFVBQTJCLFFBQVEsQ0FBQyxFQUFHO0FBQUE7QUFDN0MsY0FBTSxPQUFPLENBQUM7QUFDZCxhQUFLLFFBQVEsQ0FBQyxNQUFNO0FBQ2xCLGdCQUFNLE9BQU8sRUFBRSxLQUFLLEtBQUssQ0FBQztBQUMxQixlQUFLLE1BQU0sRUFBRTtBQUNiLGVBQUssS0FBSyxJQUFJO0FBQUEsUUFDaEIsQ0FBQztBQUNELGtCQUFVLElBQUksSUFBSTtBQUFBLE1BQ3BCLENBQUM7QUFDRCxZQUFNO0FBQUE7QUFBQSxRQUFnQyxRQUFRLFFBQVEsU0FBUyxDQUFDLEVBQUc7QUFBQTtBQUduRSw0QkFBc0Isd0JBQXdCLEVBQUU7QUFDaEQsWUFBTTtBQUFBO0FBQUEsUUFBOEMsQ0FBQztBQUFBO0FBQ3JELFlBQU07QUFBQTtBQUFBLFFBQW1ELENBQUM7QUFBQTtBQUMxRCxZQUFNO0FBQUE7QUFBQSxRQUF1RCxDQUFDO0FBQUE7QUFFOUQsaUJBQVcsWUFBWSxPQUFPLEtBQUssU0FBUyxHQUFHO0FBQzdDLGNBQU0sU0FBUyxnQkFBZ0IsUUFBUTtBQUN2QyxZQUFJLENBQUMsT0FBUTtBQUNiLGNBQU0sVUFBVSxhQUFhLFFBQVE7QUFDckMsWUFBSSxDQUFDLFFBQVM7QUFDZCxjQUFNO0FBQUE7QUFBQSxVQUFrQyxDQUFDO0FBQUE7QUFDekMsbUJBQVcsT0FBTyxVQUFVLFFBQVEsR0FBRztBQUNyQyxnQkFBTSxhQUFhLFFBQVEsR0FBRztBQUM5QixxQkFBVyxLQUFLLFdBQVksU0FBUSxLQUFLLENBQUM7QUFBQSxRQUM1QztBQUNBLHFCQUFhLE9BQU8sSUFBSSxJQUFJO0FBQzVCLGFBQUssT0FBTyxJQUFJLElBQUksU0FBUyxRQUFRLE9BQU87QUFDNUMsa0JBQVUsT0FBTyxJQUFJLElBQUksUUFBUTtBQUFBLE1BQ25DO0FBR0EsWUFBTSxrQkFBa0IsZ0JBQWdCO0FBQ3hDLFlBQU0sZ0JBQWdCLFlBQVksK0JBQStCLFNBQVMsSUFBSSxDQUFDO0FBQy9FLG1CQUFhLGdCQUFnQixJQUFJLElBQUk7QUFDckMsV0FBSyxnQkFBZ0IsSUFBSSxJQUFJLFNBQVMsaUJBQWlCLGFBQWE7QUFDcEUsZ0JBQVUsZ0JBQWdCLElBQUksSUFBSSxjQUFjO0FBR2hELDRCQUFzQixxQ0FBcUMsRUFBRTtBQUU3RCxZQUFNLG1CQUFtQixDQUFDO0FBQzFCLGlCQUFXLENBQUMsU0FBUyxFQUFFLEtBQUssT0FBTyxRQUFRLHVCQUF1QixHQUFHO0FBQ25FLGNBQU07QUFBQTtBQUFBLFVBQTRCO0FBQUEsWUFDaEMsVUFBVSxHQUFHO0FBQUEsWUFDYixhQUFhLEdBQUc7QUFBQSxZQUNoQixnQkFBZ0IsR0FBRztBQUFBLFlBQ25CLFdBQVcsR0FBRztBQUFBLFlBQ2QsaUJBQWlCLENBQUM7QUFBQSxZQUNsQixhQUFhLENBQUM7QUFBQSxVQUNoQjtBQUFBO0FBQ0EsWUFBSSxrQkFBa0I7QUFDdEIsWUFBSSxtQkFBbUI7QUFDdkIsbUJBQVcsQ0FBQyxTQUFTLE1BQU0sS0FBSyxPQUFPLFFBQVEsR0FBRyxjQUFjLEdBQUc7QUFDakUsZ0JBQU0sZUFBZSxPQUFPLE9BQU8sZUFBZSxFQUFFLEtBQUssQ0FBQyxNQUFNLEVBQUUsU0FBUyxPQUFPO0FBQ2xGLGNBQUksQ0FBQyxjQUFjO0FBQ2pCLGtCQUFNLFlBQVksS0FBSywrQkFBK0IsT0FBTztBQUM3RDtBQUFBLFVBQ0Y7QUFDQSxnQkFBTSxPQUFPLGFBQWEsT0FBTyxLQUFLLENBQUM7QUFDdkMsZ0JBQU0sUUFBUSxpQkFBaUIsY0FBYyxNQUFNLE1BQU07QUFDekQscUJBQVcsQ0FBQyxHQUFHLElBQUksS0FBSyxPQUFPLFFBQVEsS0FBSyxHQUFHO0FBQzdDLGtCQUFNLGdCQUFnQixVQUFVLE1BQU0sQ0FBQyxJQUFJO0FBQzNDLGdCQUFJLEtBQUssV0FBVyxFQUFHLG9CQUFtQjtBQUFBLHFCQUNqQyxPQUFPLElBQUssbUJBQWtCO0FBQUEsVUFDekM7QUFBQSxRQUNGO0FBQ0EsWUFBSSxrQkFBa0I7QUFDcEIsZ0JBQU0sU0FBUztBQUNmLGdCQUFNLFlBQVk7QUFBQSxZQUNoQjtBQUFBLFVBQ0Y7QUFBQSxRQUNGLFdBQVcsaUJBQWlCO0FBQzFCLGdCQUFNLFNBQVM7QUFDZixnQkFBTSxZQUFZO0FBQUEsWUFDaEI7QUFBQSxVQUNGO0FBQUEsUUFDRixPQUFPO0FBQ0wsZ0JBQU0sU0FBUztBQUFBLFFBQ2pCO0FBQ0EseUJBQWlCLE9BQU8sSUFBSTtBQUFBLE1BQzlCO0FBR0EsWUFBTSxjQUFhLG9CQUFJLEtBQUssR0FBRSxZQUFZO0FBQzFDLFlBQU0sV0FBVztBQUFBLFFBQ2Y7QUFBQSxRQUNBLFlBQVksT0FBTyxnQkFBZ0IsY0FBYyxjQUFjO0FBQUEsUUFDL0QsZUFBZTtBQUFBLFFBQ2YsaUJBQWtCLGVBQWUsWUFBWSxTQUFVO0FBQUEsUUFDdkQsZUFBZ0IsZUFBZSxZQUFZLE9BQVE7QUFBQSxRQUNuRCxnQkFBZ0I7QUFBQSxVQUNkLFVBQVU7QUFBQSxVQUNWLFdBQVc7QUFBQSxVQUNYLFdBQVc7QUFBQSxVQUNYLGFBQWE7QUFBQSxVQUNiLGdCQUFnQjtBQUFBLFVBQ2hCLFlBQVk7QUFBQSxVQUNaLGtCQUFrQjtBQUFBLFVBQ2xCLG9CQUFvQjtBQUFBLFVBQ3BCLGFBQWE7QUFBQSxVQUNiLGNBQWM7QUFBQSxRQUNoQjtBQUFBLFFBQ0E7QUFBQSxRQUNBLFFBQVEsQ0FBQztBQUFBLFFBQ1QsZUFBZTtBQUFBLFFBQ2YsWUFBWTtBQUFBLFVBQ1YsTUFBTTtBQUFBLFVBQ04scUJBQXFCO0FBQUEsWUFDbkI7QUFBQSxZQUNBO0FBQUEsWUFDQTtBQUFBLFlBQ0E7QUFBQSxZQUNBO0FBQUEsVUFDRjtBQUFBLFVBQ0EsZ0JBQWdCO0FBQUEsWUFDZDtBQUFBLFlBQ0E7QUFBQSxZQUNBO0FBQUEsWUFDQTtBQUFBLFlBQ0E7QUFBQSxZQUNBO0FBQUEsVUFDRjtBQUFBLFVBQ0EsaUJBQWlCLGNBQWM7QUFBQSxRQUNqQztBQUFBLE1BQ0Y7QUFDQSxpQkFBVyxDQUFDLFdBQVcsTUFBTSxLQUFLLE9BQU8sUUFBUSxlQUFlLEdBQUc7QUFDakUsaUJBQVMsT0FBTyxPQUFPLElBQUksSUFBSSxPQUFPLFFBQVEsSUFBSSxDQUFDLE9BQU87QUFBQSxVQUN4RCxLQUFLLEVBQUU7QUFBQSxVQUNQLE1BQU0sRUFBRTtBQUFBLFVBQ1IsTUFBTSxFQUFFO0FBQUEsUUFDVixFQUFFO0FBQUEsTUFDSjtBQUdBLDRCQUFzQix1QkFBdUIsRUFBRTtBQUMvQyxZQUFNLE1BQU0sSUFBSSxNQUFNO0FBQ3RCLGlCQUFXLENBQUMsTUFBTSxPQUFPLEtBQUssT0FBTyxRQUFRLElBQUksR0FBRztBQUNsRCxZQUFJLEtBQUssTUFBTSxPQUFPO0FBQUEsTUFDeEI7QUFDQSxVQUFJLEtBQUssaUJBQWlCLEtBQUssVUFBVSxVQUFVLE1BQU0sQ0FBQyxDQUFDO0FBRTNELFlBQU0sT0FBTyxNQUFNLElBQUksY0FBYztBQUFBLFFBQ25DLE1BQU07QUFBQSxRQUNOLGFBQWE7QUFBQSxRQUNiLG9CQUFvQixFQUFFLE9BQU8sRUFBRTtBQUFBLE1BQ2pDLENBQUM7QUFDRCxZQUFNLFdBQVcscUJBQXFCLFdBQVcsUUFBUSxTQUFTLEdBQUcsSUFBSTtBQUN6RSxvQkFBYyxNQUFNLFFBQVE7QUFFNUI7QUFBQSxRQUNFLHlCQUNFLFdBQ0EsT0FDQSxPQUFPLEtBQUssSUFBSSxFQUFFLFNBQ2xCO0FBQUEsUUFDRjtBQUFBLE1BQ0Y7QUFDQSxVQUFJLE9BQU8sZ0JBQWdCLFlBQVk7QUFDckMsY0FBTSxZQUFZLE9BQU8sT0FBTyxTQUFTLEVBQUUsT0FBTyxDQUFDLEdBQUcsTUFBTSxJQUFJLEdBQUcsQ0FBQztBQUNwRTtBQUFBLFVBQ0Usd0JBQXdCLFlBQVksZUFBZSxPQUFPLEtBQUssSUFBSSxFQUFFLFNBQVM7QUFBQSxRQUNoRjtBQUFBLE1BQ0Y7QUFDQSxpQkFBVyxNQUFNLE9BQU8sdUJBQXVCLEdBQUcsR0FBSTtBQUFBLElBQ3hELFNBQVMsR0FBRztBQUNWLGNBQVEsTUFBTSw2QkFBNkIsQ0FBQztBQUM1Qyw0QkFBc0IsYUFBYyxLQUFLLEVBQUUsV0FBWSxJQUFJLENBQUM7QUFDNUQ7QUFBQSxRQUNFLHVDQUNJLEtBQUssRUFBRSxXQUFZLEtBQ3JCO0FBQUEsTUFDSjtBQUFBLElBQ0Y7QUFBQSxFQUNGO0FBSUEsTUFBSSxPQUFPLE9BQU8sYUFBYSxZQUFhLFFBQU8sV0FBVztBQUU5RCxNQUFJLE9BQU8sT0FBTyxrQkFBa0IsWUFBYSxRQUFPLGdCQUFnQjtBQUN4RSxNQUFJLE9BQU8sT0FBTyxvQkFBb0IsWUFBYSxRQUFPLGtCQUFrQjtBQUU1RSxTQUFPLGNBQWM7IiwKICAibmFtZXMiOiBbXQp9Cg==
