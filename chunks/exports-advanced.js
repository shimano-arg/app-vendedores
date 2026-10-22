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
    },
    // v732 (2026-08-29): 3 snapshots BQ->Firestore ahora incluidos en el dataset ML.
    // Antes estaban en excludedCollections del manifest. Racional: son fuente de
    // verdad de facturacion REAL SAP (neto NCs), demand-supression (backorders)
    // y agregados diarios listos-para-benchmark.
    sap_snapshot: {
      name: "sap_snapshot.csv",
      source: "firestore",
      collection: "sap_snapshot",
      rowMode: "one_per_doc",
      columns: [
        { col: "doc_id", type: "string", desc: "Firestore doc ID (VENDOR_NORM_YYYY_MM)" },
        {
          col: "vendor_key",
          type: "string",
          desc: "nombre del vendedor tal cual viene de SAP (sin normalizar)"
        },
        { col: "anio", type: "integer", desc: "anio calendario" },
        { col: "mes", type: "integer", desc: "1-12" },
        {
          col: "facturado_ars_neto",
          type: "number",
          desc: "facturas - NCs ARS (con IVA cargado en el importe)"
        },
        { col: "facturado_ars_bruto", type: "number", desc: "facturas + NCs sumadas ARS bruto" },
        { col: "ncs_ars", type: "number", desc: "monto de notas de credito ARS" },
        { col: "facturas_count", type: "integer", desc: "" },
        { col: "ncs_count", type: "integer", desc: "" },
        { col: "unidades_neto", type: "number", desc: "sum(qty) facturas - sum(qty) NCs" },
        {
          col: "importe_lineas_ars_neto",
          type: "number",
          desc: "sum importes de linea (sin IVA); usar este campo para modelos de negocio - facturado_ars_neto incluye IVA y sobreestima"
        },
        { col: "updated_at", type: "iso8601", desc: "timestamp del sync BQ->Firestore" }
      ]
    },
    facturacion_snapshot: {
      name: "facturacion_snapshot.csv",
      source: "firestore",
      collection: "facturacion_snapshot",
      rowMode: "one_per_doc",
      columns: [
        { col: "doc_id", type: "string", desc: "Firestore doc ID (VENDOR_NORM o TOTAL_NACIONAL)" },
        {
          col: "vendor_key",
          type: "string",
          desc: "nombre canonico del vendedor - TOTAL_NACIONAL para el rollup nacional"
        },
        { col: "hoy_ars", type: "number", desc: "facturacion del dia actual ARS" },
        { col: "mes_ars", type: "number", desc: "facturacion MTD del mes actual ARS" },
        { col: "ano_ars", type: "number", desc: "facturacion YTD del anio actual ARS" },
        { col: "updated_at", type: "iso8601", desc: "timestamp del ultimo sync" }
      ]
    },
    backorder_snapshot: {
      name: "backorder_snapshot.csv",
      source: "firestore",
      collection: "backorder_snapshot",
      rowMode: "one_per_line",
      columns: [
        {
          col: "doc_id",
          type: "string",
          desc: "Firestore doc ID (VENDOR_NORM); un doc = un vendedor, replicado en cada linea"
        },
        { col: "vendor_key", type: "string", desc: "nombre del vendedor sin normalizar" },
        {
          col: "lines_count",
          type: "integer",
          desc: "cantidad total de lineas en el snapshot del vendedor (replicado en cada row para joins)"
        },
        { col: "updated_at", type: "iso8601", desc: "" },
        { col: "sku", type: "string", desc: "SKU del producto en backorder (solo PESCA)" },
        { col: "producto", type: "string", desc: "nombre del producto" },
        { col: "familia", type: "string", desc: "" },
        { col: "subfamilia", type: "string", desc: "" },
        { col: "pendiente", type: "number", desc: "unidades pendientes de despacho (backorder)" },
        { col: "pedido", type: "number", desc: "unidades pedidas originalmente en la SQ" },
        {
          col: "stock_actual",
          type: "integer",
          desc: "stock disponible del SKU al momento del snapshot"
        },
        { col: "precio_unitario", type: "number", desc: "precio unitario ARS" },
        { col: "cliente_code", type: "string", desc: "cardCode SAP del cliente" },
        { col: "cliente_nombre", type: "string", desc: "" },
        { col: "cliente_ciudad", type: "string", desc: "" },
        { col: "sq_doc_num", type: "integer", desc: "numero de Sales Quotation SAP" },
        { col: "sq_doc_date", type: "iso8601", desc: "fecha de la SQ" },
        { col: "estado", type: "string", desc: "estado del backorder segun SAP" }
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
  function buildSapSnapshotRows(doc) {
    return [
      [
        doc._id,
        doc.vendorKey,
        doc.anio,
        doc.mes,
        doc.facturadoArsNeto,
        doc.facturadoArsBruto,
        doc.ncsArs,
        doc.facturasCount,
        doc.ncsCount,
        doc.unidadesNeto,
        doc.importeLineasArsNeto,
        doc.updatedAt
      ]
    ];
  }
  function buildFacturacionSnapshotRows(doc) {
    return [[doc._id, doc.vendorKey, doc.hoyArs, doc.mesArs, doc.anoArs, doc.updatedAt]];
  }
  function buildBackorderSnapshotRows(doc) {
    const header = [doc._id, doc.vendorKey, doc.linesCount, doc.updatedAt];
    const lines = Array.isArray(doc.lines) ? doc.lines : [];
    if (!lines.length) {
      return [
        header.concat([
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null
        ])
      ];
    }
    return lines.map(
      (l) => header.concat([
        l ? l.sku : null,
        l ? l.producto : null,
        l ? l.familia : null,
        l ? l.subfamilia : null,
        l ? l.pendiente : null,
        l ? l.pedido : null,
        l ? l.stockActual : null,
        l ? l.precioUnitario : null,
        l ? l.clienteCode : null,
        l ? l.clienteNombre : null,
        l ? l.clienteCiudad : null,
        l ? l.sqDocNum : null,
        l ? l.sqDocDate : null,
        l ? l.estado : null
      ])
    );
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
    seguimiento_notes: buildSeguimientoNoteRows,
    // v732: 3 snapshots BQ->Firestore.
    sap_snapshot: buildSapSnapshotRows,
    facturacion_snapshot: buildFacturacionSnapshotRows,
    backorder_snapshot: buildBackorderSnapshotRows
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
      _updateExportProgress("Leyendo Firestore (13 colecciones)...", 20);
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
        ["seguimiento_notes", fbDb.collection("seguimiento_notes").get()],
        ["sap_snapshot", fbDb.collection("sap_snapshot").get()],
        ["facturacion_snapshot", fbDb.collection("facturacion_snapshot").get()],
        ["backorder_snapshot", fbDb.collection("backorder_snapshot").get()]
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
          // v732 (2026-08-29): sap_snapshot ya NO se excluye (agregado como fuente
          // de verdad de facturacion real). facturacion_snapshot y backorder_snapshot
          // tampoco eran parte de esta lista pero ahora son incluidas explicitamente.
          excludedCollections: ["roles", "app_config", "notifications", "operations_log"],
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
  window.exportInfraccionesMeli = async function() {
    if (!fbDb) {
      alert("Firestore no disponible.");
      return;
    }
    try {
      const docRef = fbDb.collection("meli_infracciones_resumen").doc("current");
      const snap = await docRef.get();
      if (!snap.exists) {
        alert(
          'No hay datos de infracciones MELI a\xFAn.\n\nEl pipeline MI corre todos los d\xEDas a las 16:00 ART y publica el snapshot a Firestore. Si no corre nunca o falta el secret APP_VENDEDORES_SA_KEY en GitHub Actions, el doc nunca se genera.\n\nTrigger manual: GitHub Actions > "MAP Monitor daily" > Run workflow.'
        );
        return;
      }
      const data = snap.data() || {};
      const rows = Array.isArray(data.rows) ? data.rows : [];
      if (rows.length === 0) {
        alert("El doc existe pero no tiene filas de infracciones.");
        return;
      }
      try {
        await loadExcelJS();
      } catch (e) {
        alert("No se pudo cargar ExcelJS: " + (e && e.message ? e.message : e));
        return;
      }
      const workbook = new ExcelJS.Workbook();
      const ws = workbook.addWorksheet("Infracciones", {
        views: [{ state: "frozen", ySplit: 1, showGridLines: false }]
      });
      const headers = [
        "Cliente",
        "SKU",
        "Diferencia %",
        "Precio publicado",
        "Precio Sugerido",
        "Cant. Historicas  de Infracciones",
        "\xBFCliente?"
      ];
      const widths = [38, 20, 15.66, 18, 16, 14.55, 8.89];
      const moneyFmt2 = '_-"$"\\ * #,##0.00_-;\\-"$"\\ * #,##0.00_-;_-"$"\\ * "-"??_-;_-@_-';
      const moneyFmt0 = '_-"$"\\ * #,##0_-;\\-"$"\\ * #,##0_-;_-"$"\\ * "-"??_-;_-@_-';
      ws.addRow(headers);
      const header = ws.getRow(1);
      header.height = 28.8;
      header.eachCell((cell) => {
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { theme: 8, tint: -0.499984740745262 }
        };
        cell.font = {
          name: "Calibri",
          size: 11,
          bold: true,
          color: { argb: "FFFFFFFF" }
        };
        cell.alignment = { horizontal: "center", vertical: "center", wrapText: true };
      });
      const sorted = rows.slice().sort((a, b) => {
        const ca = String(a.cliente || "").toUpperCase();
        const cb = String(b.cliente || "").toUpperCase();
        if (ca !== cb) return ca < cb ? -1 : 1;
        const sa = String(a.sku || "");
        const sb = String(b.sku || "");
        return sa < sb ? -1 : sa > sb ? 1 : 0;
      });
      for (const r of sorted) {
        const row = ws.addRow([
          r.cliente || "",
          r.sku || "",
          typeof r.diferenciaPct === "number" ? r.diferenciaPct : 0,
          typeof r.precioPublicado === "number" ? r.precioPublicado : 0,
          typeof r.precioSugerido === "number" ? r.precioSugerido : 0,
          typeof r.cantHistoricas === "number" ? r.cantHistoricas : 0,
          r.esCliente === "SI" ? "SI" : "NO"
        ]);
        const isCliente = r.esCliente === "SI";
        const fill = isCliente ? {
          type: "pattern",
          pattern: "solid",
          fgColor: { theme: 8, tint: 0.5999938962981048 }
        } : {
          type: "pattern",
          pattern: "solid",
          fgColor: { theme: 5, tint: -0.499984740745262 }
        };
        const font = isCliente ? {
          name: "Calibri",
          size: 11,
          bold: true,
          color: { theme: 8, tint: -0.499984740745262 }
        } : {
          name: "Calibri",
          size: 11,
          bold: true,
          color: { theme: 0 }
        };
        row.eachCell((cell) => {
          cell.fill = fill;
          cell.font = font;
          cell.alignment = { horizontal: "center" };
        });
        row.getCell(4).numFmt = moneyFmt2;
        row.getCell(5).numFmt = moneyFmt0;
      }
      for (let i = 0; i < widths.length; i++) {
        ws.getColumn(i + 1).width = widths[i];
      }
      ws.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: ws.rowCount, column: headers.length }
      };
      const buf = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buf], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      });
      _downloadBlob(blob, "INFRACCIONES-MELI.xlsx");
      if (typeof showSyncTag === "function") {
        const si = sorted.filter((r) => r.esCliente === "SI").length;
        const no = sorted.length - si;
        showSyncTag("INFRACCIONES-MELI: " + sorted.length + " filas (" + si + " SI + " + no + " NO)");
      }
    } catch (e) {
      console.error("[exportInfraccionesMeli]", e);
      alert("Error al bajar el reporte: " + (e && e.message ? e.message : e));
    }
  };
  if (typeof window.todayStr === "undefined") window.todayStr = todayStr;
  if (typeof window.dataUrlToBlob === "undefined") window.dataUrlToBlob = dataUrlToBlob;
  if (typeof window.sanitizeForPath === "undefined") window.sanitizeForPath = sanitizeForPath;
  window.loadExcelJS = loadExcelJS;
})();
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL3B1cmUvY3N2LXNlcmlhbGl6ZXIuanMiLCAiLi4vc3JjL2RvbWFpbnMvZXhwb3J0cy1hZHZhbmNlZC5qcyJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiLy8gQHRzLWNoZWNrXG4vKipcbiAqIENTViBzZXJpYWxpemVyICsgZGF0YXNldCBzY2hlbWFzICsgcm93IGJ1aWxkZXJzIFx1MjAxNCBwYXJhIGV4cG9ydERhdGFzZXRaaXBcbiAqICh2MzcxKykuIEZ1bmNpb25lcyBwdXJhcywgdGVzdGVhYmxlcyBzaW4gZ2xvYmFscyBkZWwgYnVuZGxlLlxuICpcbiAqIDUgY2Fzb3MgZGUgdXNvIE1MIGRvY3VtZW50YWRvcyBlbiBEQVRBU0VUX1VTRV9DQVNFX01BVFJJWDpcbiAqICAgQSkgQ29udmVyc2lvbiB2aXNpdGEtPnBlZGlkbyAocHJpb3JpZGFkIDEsIGNsYXNpZmljYWNpb24pXG4gKiAgIEIpIFJpZXNnbyBkZSBjaHVybiBkZSBjbGllbnRlcyAocHJpb3JpZGFkIDIsIGFsZXJ0YSlcbiAqICAgQykgRm9yZWNhc3QgZGUgZGVtYW5kYSBwb3IgU0tVIChwcmlvcmlkYWQgMywgc2VyaWVzIHRlbXBvcmFsZXMpXG4gKiAgIEQpIEFub21hbGlhcyBlbiByZW5kaWNpb25lcyAoZXhwbG9yYXRvcmlvKVxuICogICBFKSBFc3RhY2lvbmFsaWRhZCBwb3Igem9uYS9jYW1wYW5hIChleHBsb3JhdG9yaW8pXG4gKlxuICogQ29udmVuY2lvbmVzIChSRkMgNDE4MCArIGFkYXB0YWNpb25lcyBwYXJhIE1MIHBpcGVsaW5lcyk6XG4gKiAgIC0gU2VwYXJhdG9yOiBcIixcIlxuICogICAtIFF1b3RlIGNoYXI6IFwiXFxcIlwiXG4gKiAgIC0gRXNjYXBlIHF1b3RlOiBcIlxcXCJcXFwiXCJcbiAqICAgLSBMaW5lIHRlcm1pbmF0b3I6IFwiXFxyXFxuXCJcbiAqICAgLSBFbmNvZGluZzogVVRGLTggKEJPTSBvcGNpb25hbCBhbCBlc2NyaWJpciBlbCBaSVApXG4gKiAgIC0gRmVjaGFzOiBJU08gODYwMSBVVEMgKGNvbiBcIlpcIiBhbCBmaW5hbClcbiAqICAgLSBEZWNpbWFsZXM6IHB1bnRvIChcIi5cIilcbiAqICAgLSBOdWxsL3VuZGVmaW5lZDogY2FtcG8gdmFjaW8gKE5PIFwiTi9BXCIsIFwiLVwiLCBcIm51bGxcIilcbiAqICAgLSBBcnJheXMgLT4gSlNPTi5zdHJpbmdpZnkgZW50cmUgY29taWxsYXMgZG9ibGVzXG4gKiAgIC0gT2JqZXRvcyAoZXhjZXB0byBUaW1lc3RhbXAgeSBEYXRlKSAtPiBKU09OLnN0cmluZ2lmeVxuICogICAtIEZpcmVzdG9yZSBUaW1lc3RhbXBzIC0+IHRvRGF0ZSgpLnRvSVNPU3RyaW5nKClcbiAqL1xuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIEhlbHBlcnMgQ1NWIHB1cm9zXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuLyoqXG4gKiBFc2NhcGEgdW4gdmFsb3Igc3RyaW5nIHBhcmEgQ1NWIFJGQyA0MTgwLiBXcmFwcGVhIGNvbiBcIi4uLlwiIHNpIGNvbnRpZW5lXG4gKiBcIixcIiwgXCJcXFwiXCIsIFwiXFxyXCIgbyBcIlxcblwiLiBFc2NhcGEgXCJcXFwiXCIgLT4gXCJcXFwiXFxcIlwiLlxuICogQHBhcmFtIHtzdHJpbmd9IHNcbiAqIEByZXR1cm5zIHtzdHJpbmd9XG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjc3ZFc2NhcGUocykge1xuICBpZiAocyA9PT0gbnVsbCB8fCBzID09PSB1bmRlZmluZWQpIHJldHVybiAnJztcbiAgY29uc3Qgc3RyID0gU3RyaW5nKHMpO1xuICBpZiAoc3RyID09PSAnJykgcmV0dXJuICcnO1xuICAvLyBOZWNlc2l0YSBxdW90aW5nIHNpIHRpZW5lIGNvbWEsIHF1b3RlLCBvIGxpbmUtYnJlYWtcbiAgaWYgKC9bXCIsXFxyXFxuXS8udGVzdChzdHIpKSB7XG4gICAgcmV0dXJuICdcIicgKyBzdHIucmVwbGFjZSgvXCIvZywgJ1wiXCInKSArICdcIic7XG4gIH1cbiAgcmV0dXJuIHN0cjtcbn1cblxuLyoqXG4gKiBDb252aWVydGUgdW4gYXJyYXkgZGUgdmFsb3JlcyBlbiB1bmEgbGluZWEgQ1NWIChzaW4gdHJhaWxpbmcgbmV3bGluZSkuXG4gKiBBcGxpY2EgY3N2RXNjYXBlIGEgY2FkYSBjYW1wbyBkZXNwdWVzIGRlIGZpcmVzdG9yZVZhbHVlVG9Dc3YuXG4gKiBAcGFyYW0ge3Vua25vd25bXX0gZmllbGRzXG4gKiBAcmV0dXJucyB7c3RyaW5nfVxuICovXG5leHBvcnQgZnVuY3Rpb24gY3N2Um93KGZpZWxkcykge1xuICByZXR1cm4gZmllbGRzLm1hcCgoZikgPT4gY3N2RXNjYXBlKGZpcmVzdG9yZVZhbHVlVG9Dc3YoZikpKS5qb2luKCcsJyk7XG59XG5cbi8qKlxuICogQ29udmllcnRlIHVuIHZhbG9yIGRlIEZpcmVzdG9yZS9KUyBhIHN0cmluZyBhcHRvIHBhcmEgQ1NWLlxuICogUmVnbGEgcG9yIHRpcG86XG4gKiAgIC0gbnVsbCAvIHVuZGVmaW5lZCAtPiAnJ1xuICogICAtIEZpcmVzdG9yZSBUaW1lc3RhbXAgKHRpZW5lIC50b0RhdGUpIC0+IElTTyA4NjAxIFVUQ1xuICogICAtIERhdGUgLT4gSVNPIDg2MDEgVVRDXG4gKiAgIC0gYm9vbGVhbiAtPiAndHJ1ZScgLyAnZmFsc2UnXG4gKiAgIC0gbnVtYmVyIC0+IFN0cmluZyhuKSBjb24gcHVudG8gZGVjaW1hbFxuICogICAtIHN0cmluZyAtPiB0YWwgY3VhbCAoY3N2RXNjYXBlIHdyYXBwZWEgc2kgaGFjZSBmYWx0YSlcbiAqICAgLSBBcnJheSAtPiBKU09OLnN0cmluZ2lmeVxuICogICAtIE9iamVjdCAtPiBKU09OLnN0cmluZ2lmeVxuICogQHBhcmFtIHt1bmtub3dufSB2XG4gKiBAcmV0dXJucyB7c3RyaW5nfVxuICovXG5leHBvcnQgZnVuY3Rpb24gZmlyZXN0b3JlVmFsdWVUb0Nzdih2KSB7XG4gIGlmICh2ID09PSBudWxsIHx8IHYgPT09IHVuZGVmaW5lZCkgcmV0dXJuICcnO1xuICBpZiAodHlwZW9mIHYgPT09ICdzdHJpbmcnKSByZXR1cm4gdjtcbiAgaWYgKHR5cGVvZiB2ID09PSAnbnVtYmVyJykge1xuICAgIGlmICghTnVtYmVyLmlzRmluaXRlKHYpKSByZXR1cm4gJyc7IC8vIE5hTiwgSW5maW5pdHkgLT4gdmFjaW8gKG5vIGNvbmZ1bmRpciBwaXBlbGluZXMpXG4gICAgcmV0dXJuIFN0cmluZyh2KTtcbiAgfVxuICBpZiAodHlwZW9mIHYgPT09ICdib29sZWFuJykgcmV0dXJuIHYgPyAndHJ1ZScgOiAnZmFsc2UnO1xuICAvLyBGaXJlc3RvcmUgVGltZXN0YW1wXG4gIGlmIChcbiAgICB0eXBlb2YgdiA9PT0gJ29iamVjdCcgJiZcbiAgICB2ICE9PSBudWxsICYmXG4gICAgdHlwZW9mICgvKiogQHR5cGUge2FueX0gKi8gKHYpLnRvRGF0ZSkgPT09ICdmdW5jdGlvbidcbiAgKSB7XG4gICAgdHJ5IHtcbiAgICAgIHJldHVybiAvKiogQHR5cGUge2FueX0gKi8gKHYpLnRvRGF0ZSgpLnRvSVNPU3RyaW5nKCk7XG4gICAgfSBjYXRjaCAoXykge1xuICAgICAgcmV0dXJuICcnO1xuICAgIH1cbiAgfVxuICBpZiAodiBpbnN0YW5jZW9mIERhdGUpIHtcbiAgICBpZiAoTnVtYmVyLmlzTmFOKHYuZ2V0VGltZSgpKSkgcmV0dXJuICcnO1xuICAgIHJldHVybiB2LnRvSVNPU3RyaW5nKCk7XG4gIH1cbiAgaWYgKEFycmF5LmlzQXJyYXkodikpIHtcbiAgICAvLyBKU09OLnN0cmluZ2lmeSBkZSBhcnJheS4gY3N2RXNjYXBlIGx1ZWdvIGxvIHdyYXBwZWEgc2kgaGF5IGNvbWFzLlxuICAgIHRyeSB7XG4gICAgICByZXR1cm4gSlNPTi5zdHJpbmdpZnkodik7XG4gICAgfSBjYXRjaCAoXykge1xuICAgICAgcmV0dXJuICcnO1xuICAgIH1cbiAgfVxuICBpZiAodHlwZW9mIHYgPT09ICdvYmplY3QnKSB7XG4gICAgdHJ5IHtcbiAgICAgIHJldHVybiBKU09OLnN0cmluZ2lmeSh2KTtcbiAgICB9IGNhdGNoIChfKSB7XG4gICAgICByZXR1cm4gJyc7XG4gICAgfVxuICB9XG4gIHJldHVybiBTdHJpbmcodik7XG59XG5cbi8qKlxuICogT2J0aWVuZSBlbCB2YWxvciBkZSB1biBwYXRoIGRvdC1ub3RhdGlvbiBlbiB1biBvYmpldG8gYW5pZGFkby5cbiAqIEVqOiBnZXRQYXRoKHthOiB7Yjoge2M6IDF9fX0sICdhLmIuYycpIC0+IDFcbiAqIGdldFBhdGgoe30sICdhLmInKSAtPiB1bmRlZmluZWRcbiAqIEBwYXJhbSB7b2JqZWN0fSBvYmpcbiAqIEBwYXJhbSB7c3RyaW5nfSBwYXRoXG4gKiBAcmV0dXJucyB7dW5rbm93bn1cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGdldFBhdGgob2JqLCBwYXRoKSB7XG4gIGlmICghb2JqIHx8ICFwYXRoKSByZXR1cm4gdW5kZWZpbmVkO1xuICBjb25zdCBwYXJ0cyA9IHBhdGguc3BsaXQoJy4nKTtcbiAgbGV0IGN1ciA9IC8qKiBAdHlwZSB7YW55fSAqLyAob2JqKTtcbiAgZm9yIChjb25zdCBwIG9mIHBhcnRzKSB7XG4gICAgaWYgKGN1ciA9PT0gbnVsbCB8fCBjdXIgPT09IHVuZGVmaW5lZCkgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICBjdXIgPSBjdXJbcF07XG4gIH1cbiAgcmV0dXJuIGN1cjtcbn1cblxuLyoqXG4gKiBDb25zdHJ1eWUgZWwgQ1NWIGNvbXBsZXRvIChoZWFkZXIgKyBOIHJvd3MpIHBhcmEgdW5hIGNvbGVjY2lvbiBzZWd1blxuICogc3Ugc2NoZW1hLiBDYWRhIGJ1aWxkZXIgZGV2dWVsdmUgdW4gYXJyYXkgZGUgZmlsYXMgKGNhZGEgZmlsYSA9IGFycmF5XG4gKiBkZSB2YWxvcmVzIGVuIGVsIG9yZGVuIGRlbCBzY2hlbWEpLlxuICogQHBhcmFtIHt7Y29sdW1uczoge2NvbDogc3RyaW5nfVtdfX0gc2NoZW1hXG4gKiBAcGFyYW0ge3Vua25vd25bXVtdfSByb3dzXG4gKiBAcmV0dXJucyB7c3RyaW5nfSBDU1YgY29tcGxldG8gY29uIFxcclxcbiBjb21vIGxpbmUgc2VwYXJhdG9yXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBidWlsZENzdihzY2hlbWEsIHJvd3MpIHtcbiAgY29uc3QgaGVhZGVyID0gc2NoZW1hLmNvbHVtbnMubWFwKChjKSA9PiBjc3ZFc2NhcGUoYy5jb2wpKS5qb2luKCcsJyk7XG4gIGNvbnN0IGJvZHkgPSByb3dzLm1hcCgocikgPT4gY3N2Um93KHIpKS5qb2luKCdcXHJcXG4nKTtcbiAgcmV0dXJuIGJvZHkubGVuZ3RoID8gaGVhZGVyICsgJ1xcclxcbicgKyBib2R5ICsgJ1xcclxcbicgOiBoZWFkZXIgKyAnXFxyXFxuJztcbn1cblxuLyoqXG4gKiBDdWVudGEgbnVsbCByYXRlIHBvciBjb2x1bW5hIHJlcXVlcmlkYS4gUmV0b3JuYVxuICoge2NvbE5hbWU6IHJhdGUgMC4uMX0uIFVuIHZhbG9yIGVzIFwibnVsbFwiIHNpIGZpcmVzdG9yZVZhbHVlVG9Dc3YgZGV2dWVsdmUgJycuXG4gKiBAcGFyYW0ge3tjb2x1bW5zOiB7Y29sOiBzdHJpbmd9W119fSBzY2hlbWFcbiAqIEBwYXJhbSB7dW5rbm93bltdW119IHJvd3NcbiAqIEBwYXJhbSB7c3RyaW5nW119IHJlcXVpcmVkQ29sc1xuICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIG51bWJlcj59XG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjb21wdXRlTnVsbFJhdGVzKHNjaGVtYSwgcm93cywgcmVxdWlyZWRDb2xzKSB7XG4gIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgbnVtYmVyPn0gKi9cbiAgY29uc3QgcmVzdWx0ID0ge307XG4gIGlmICghcm93cy5sZW5ndGgpIHtcbiAgICAvLyBzaW4gZGF0b3M6IG51bGwgcmF0ZSA9IDEgKDEwMCUgZmFsdGEpIHBhcmEgY2FkYSBjYW1wbyByZXF1ZXJpZG9cbiAgICBmb3IgKGNvbnN0IGMgb2YgcmVxdWlyZWRDb2xzKSByZXN1bHRbY10gPSAxO1xuICAgIHJldHVybiByZXN1bHQ7XG4gIH1cbiAgY29uc3QgY29sSW5kZXggPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIG51bWJlcj59ICovICh7fSk7XG4gIHNjaGVtYS5jb2x1bW5zLmZvckVhY2goKGMsIGkpID0+IHtcbiAgICBjb2xJbmRleFtjLmNvbF0gPSBpO1xuICB9KTtcbiAgZm9yIChjb25zdCByYyBvZiByZXF1aXJlZENvbHMpIHtcbiAgICBjb25zdCBpZHggPSBjb2xJbmRleFtyY107XG4gICAgaWYgKGlkeCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICByZXN1bHRbcmNdID0gMTsgLy8gY29sdW1uYSBubyBleGlzdGUgZW4gc2NoZW1hIC0+IGNvbnNpZGVyYXIgY29tbyAxMDAlIG51bGxcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBsZXQgbnVsbHMgPSAwO1xuICAgIGZvciAoY29uc3Qgcm93IG9mIHJvd3MpIHtcbiAgICAgIGNvbnN0IHYgPSByb3dbaWR4XTtcbiAgICAgIGlmIChmaXJlc3RvcmVWYWx1ZVRvQ3N2KHYpID09PSAnJykgbnVsbHMrKztcbiAgICB9XG4gICAgcmVzdWx0W3JjXSA9IE1hdGgucm91bmQoKG51bGxzIC8gcm93cy5sZW5ndGgpICogMTAwMDApIC8gMTAwMDA7XG4gIH1cbiAgcmV0dXJuIHJlc3VsdDtcbn1cblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBEQVRBU0VUX1NDSEVNQVMgXHUyMDE0IDExIGNvbGVjY2lvbmVzIGNvbiBjb2x1bW5hcyArIHRpcG9zICsgZGVzY3JpcGNpb25lc1xuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbi8qKiBAdHlwZWRlZiB7e2NvbDogc3RyaW5nLCB0eXBlOiBzdHJpbmcsIGRlc2M6IHN0cmluZ319IFNjaGVtYUNvbHVtbiAqL1xuLyoqIEB0eXBlZGVmIHt7bmFtZTogc3RyaW5nLCBzb3VyY2U6ICdmaXJlc3RvcmUnfCdzdG9ja19qc29uJywgY29sbGVjdGlvbj86IHN0cmluZywgcm93TW9kZTogc3RyaW5nLCBjb2x1bW5zOiBTY2hlbWFDb2x1bW5bXX19IERhdGFzZXRTY2hlbWEgKi9cblxuLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBEYXRhc2V0U2NoZW1hPn0gKi9cbmV4cG9ydCBjb25zdCBEQVRBU0VUX1NDSEVNQVMgPSB7XG4gIHBlZGlkb3M6IHtcbiAgICBuYW1lOiAncGVkaWRvcy5jc3YnLFxuICAgIHNvdXJjZTogJ2ZpcmVzdG9yZScsXG4gICAgY29sbGVjdGlvbjogJ3BlZGlkb3MnLFxuICAgIHJvd01vZGU6ICdmbGF0dGVuX2xpbmVzJywgLy8gMSBmaWxhIHBvciAocGVkaWRvLCBsaW5lYSlcbiAgICBjb2x1bW5zOiBbXG4gICAgICB7IGNvbDogJ3BlZGlkb19pZCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnRmlyZXN0b3JlIGRvYyBJRCcgfSxcbiAgICAgIHsgY29sOiAnb3duZXJfdWlkJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdVSUQgZGVsIHZlbmRlZG9yIGR1ZW5pbyBkZWwgcGVkaWRvJyB9LFxuICAgICAgeyBjb2w6ICdvd25lcl9lbWFpbCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnZW1haWwgZGVsIHZlbmRlZG9yJyB9LFxuICAgICAgeyBjb2w6ICdjcmVhdGVkX2J5X3VpZCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAncXVpZW4gY2FyZ28gKFZESSBwdWVkZSBjYXJnYXIgcG9yIFZERSknIH0sXG4gICAgICB7IGNvbDogJ29uX2JlaGFsZl9vZicsIHR5cGU6ICdib29sZWFuJywgZGVzYzogJ3RydWUgc2kgVkRJIGNhcmdvIHBvciBWREUnIH0sXG4gICAgICB7IGNvbDogJ2tleScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnY2xhdmUgY29tcHVlc3RhIHRpcG98cHJvdnxsb2N8Y2xpZW50ZScgfSxcbiAgICAgIHsgY29sOiAnc3RhZ2UnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ3BlbmRpbmcgfCBjb25maXJtZWQgfCBzYXBfaW1wb3J0ZWQnIH0sXG4gICAgICB7IGNvbDogJ3RpcG8nLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ0M9Y2xpZW50ZSB8IFA9cHJvc3BlY3RvJyB9LFxuICAgICAgeyBjb2w6ICdwcm92aW5jZScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAncHJvdmluY2lhJyB9LFxuICAgICAgeyBjb2w6ICdsb2NfbmFtZScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnbG9jYWxpZGFkJyB9LFxuICAgICAgeyBjb2w6ICdjbGllbnRfbmFtZScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnbm9tYnJlIGNsaWVudGUnIH0sXG4gICAgICB7IGNvbDogJ21vbnRoJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdlaiBcIkp1bGlvIDIwMjZcIicgfSxcbiAgICAgIHsgY29sOiAnbW9udGhfaWR4JywgdHlwZTogJ2ludCcsIGRlc2M6ICcwLTExJyB9LFxuICAgICAgeyBjb2w6ICd5ZWFyJywgdHlwZTogJ2ludCcsIGRlc2M6ICdhbm8nIH0sXG4gICAgICB7IGNvbDogJ2NvbmZpcm1lZF9hdCcsIHR5cGU6ICdpc284NjAxJywgZGVzYzogJ3RpbWVzdGFtcCBVVEMgZGUgY29uZmlybWFjaW9uJyB9LFxuICAgICAgeyBjb2w6ICdjb25kaWNpb25fcGFnbycsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnZWogQ1RBIENURScgfSxcbiAgICAgIHsgY29sOiAnZm9ybWFfZW50cmVnYV90aXBvJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdUUkFOU1BPUlRJU1RBIHwgU1VDVVJTQUwnIH0sXG4gICAgICB7IGNvbDogJ2Zvcm1hX2VudHJlZ2FfdHJhbnNwX25vbWJyZScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJyB9LFxuICAgICAgeyBjb2w6ICdmb3JtYV9lbnRyZWdhX3RyYW5zcF9kaXJlY2Npb24nLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcbiAgICAgIHsgY29sOiAnZm9ybWFfZW50cmVnYV9jbGllbnRlX2RpcmVjY2lvbicsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnZGVzdGlubyBmaW5hbCcgfSxcbiAgICAgIHsgY29sOiAnZm9ybWFfZW50cmVnYV9zdWN1cnNhbF9kaXJlY2Npb24nLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcbiAgICAgIHtcbiAgICAgICAgY29sOiAnZGlzY291bnRfcGN0JyxcbiAgICAgICAgdHlwZTogJ251bWJlcicsXG4gICAgICAgIGRlc2M6ICdkZXNjdWVudG8gdG90YWwgZGVsIHBlZGlkbyAoYXBsaWNhZG8gYSBuaXZlbCBoZWFkZXIsIHByb3JyYXRlYXIgZW4gcGlwZWxpbmUpJyxcbiAgICAgIH0sXG4gICAgICB7IGNvbDogJ3N1YnRvdGFsX2FycycsIHR5cGU6ICdudW1iZXInLCBkZXNjOiAnc3VidG90YWwgYnJ1dG8gQVJTJyB9LFxuICAgICAgeyBjb2w6ICduZXRfYW1vdW50X2FycycsIHR5cGU6ICdudW1iZXInLCBkZXNjOiAnbmV0byBBUlMgcG9zdC1kZXNjdWVudG8nIH0sXG4gICAgICB7IGNvbDogJ3RyYW5zZmVyaWRvX3NhcF92aWEnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ2R0d19tYW51YWwgfCBzZXJ2aWNlX2xheWVyJyB9LFxuICAgICAgeyBjb2w6ICd0cmFuc2Zlcmlkb19zYXBfZG9jX251bScsIHR5cGU6ICdpbnQnLCBkZXNjOiAnbnVtZXJvIGRlIFF1b3RhdGlvbiBTQVAnIH0sXG4gICAgICB7IGNvbDogJ3RyYW5zZmVyaWRvX3NhcF9kb2NfZW50cnknLCB0eXBlOiAnaW50JywgZGVzYzogJ2RvYyBlbnRyeSBpbnRlcm5vIFNBUCcgfSxcbiAgICAgIHsgY29sOiAndHJhbnNmZXJpZG9fc2FwX2F0JywgdHlwZTogJ2lzbzg2MDEnLCBkZXNjOiAndGltZXN0YW1wIFVUQycgfSxcbiAgICAgIHsgY29sOiAnY3JlYXRlZF9hdCcsIHR5cGU6ICdpc284NjAxJywgZGVzYzogJ3RpbWVzdGFtcCBVVEMnIH0sXG4gICAgICB7IGNvbDogJ2xpbmVfaW5kZXgnLCB0eXBlOiAnaW50JywgZGVzYzogJ2luZGljZSBkZSBsaW5lYSAwLWJhc2VkJyB9LFxuICAgICAgeyBjb2w6ICdsaW5lX2NvZGUnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ1NLVScgfSxcbiAgICAgIHsgY29sOiAnbGluZV9kZXNjJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdkZXNjcmlwY2lvbiBwcm9kdWN0bycgfSxcbiAgICAgIHsgY29sOiAnbGluZV9xdHknLCB0eXBlOiAnbnVtYmVyJywgZGVzYzogJ2NhbnRpZGFkJyB9LFxuICAgICAgeyBjb2w6ICdsaW5lX3ByZWNpbycsIHR5cGU6ICdudW1iZXInLCBkZXNjOiAncHJlY2lvIHVuaXRhcmlvIEFSUycgfSxcbiAgICAgIHsgY29sOiAnbGluZV9jYXQnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ2NhdGVnb3JpYScgfSxcbiAgICAgIHsgY29sOiAnbGluZV9mYW0nLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ2ZhbWlsaWEnIH0sXG4gICAgICB7IGNvbDogJ2xpbmVfc3ViJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdzdWJmYW1pbGlhJyB9LFxuICAgIF0sXG4gIH0sXG4gIHZpc2l0YXM6IHtcbiAgICBuYW1lOiAndmlzaXRhcy5jc3YnLFxuICAgIHNvdXJjZTogJ2ZpcmVzdG9yZScsXG4gICAgY29sbGVjdGlvbjogJ3Zpc2l0cycsXG4gICAgcm93TW9kZTogJ29uZV9wZXJfZG9jJyxcbiAgICBjb2x1bW5zOiBbXG4gICAgICB7IGNvbDogJ3Zpc2l0X2lkJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdGaXJlc3RvcmUgZG9jIElEJyB9LFxuICAgICAgeyBjb2w6ICdvd25lcl91aWQnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ1VJRCBkZWwgdmVuZGVkb3InIH0sXG4gICAgICB7IGNvbDogJ293bmVyX2VtYWlsJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdlbWFpbCBkZWwgdmVuZGVkb3InIH0sXG4gICAgICB7IGNvbDogJ2ZlY2hhJywgdHlwZTogJ2lzbzg2MDEnLCBkZXNjOiAnWVlZWS1NTS1ERCAoZmVjaGEgZGUgdmlzaXRhLCBubyBVVEMpJyB9LFxuICAgICAgeyBjb2w6ICdtZXMnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ0pVTklPLCBKVUxJTywgZXRjLicgfSxcbiAgICAgIHsgY29sOiAnYW5pbycsIHR5cGU6ICdpbnQnLCBkZXNjOiAnYW5vJyB9LFxuICAgICAgeyBjb2w6ICd2ZW5kb3InLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ25vbWJyZSBjYW5vbmljbyB2ZW5kZWRvcicgfSxcbiAgICAgIHsgY29sOiAncHJvdmluY2lhJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdwcm92aW5jaWEnIH0sXG4gICAgICB7IGNvbDogJ2xvY2FsaWRhZCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnbG9jYWxpZGFkJyB9LFxuICAgICAgeyBjb2w6ICd0aWVuZGEnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ25vbWJyZSB0aWVuZGEnIH0sXG4gICAgICB7IGNvbDogJ3RpcG8nLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ0MgfCBQJyB9LFxuICAgICAgeyBjb2w6ICdsb2NhbCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnZWogUHJvcGlvLCBBbHF1aWxhZG8nIH0sXG4gICAgICB7IGNvbDogJ3RhbWFubycsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnZWogQ2hpY28sIE1lZGlhbm8sIEdyYW5kZScgfSxcbiAgICAgIHsgY29sOiAnZmlkZWxpZGFkJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdBbHRhLCBNZWRpYSwgQmFqYScgfSxcbiAgICAgIHsgY29sOiAncmVsZXZhbmNpYScsIHR5cGU6ICdpbnQnLCBkZXNjOiAnMC01JyB9LFxuICAgICAgeyBjb2w6ICdwb3AnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ2VqIFN0aWNrZXJzIFNoaW1hbm8nIH0sXG4gICAgICB7IGNvbDogJ25lY2VzaWRhZF9wdW50dWFsJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXG4gICAgICB7IGNvbDogJ3RpcG9fdmVudGEnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ2VqIENhc2EgZGUgcGVzY2EgKyBlY29tbWVyY2UnIH0sXG4gICAgICB7IGNvbDogJ3BvbmRlcmFjaW9uX21vc3RyYWRvJywgdHlwZTogJ2ludCcsIGRlc2M6ICcwLTEwMCcgfSxcbiAgICAgIHsgY29sOiAncG9uZGVyYWNpb25fZWNvbW1lcmNlJywgdHlwZTogJ2ludCcsIGRlc2M6ICcwLTEwMCcgfSxcbiAgICAgIHsgY29sOiAnY29tcGV0ZW5jaWEnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcbiAgICAgIHsgY29sOiAnb3BvcnR1bmlkYWQnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcbiAgICAgIHsgY29sOiAnbWFzX3ZlbmRpZG8nLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcbiAgICAgIHsgY29sOiAnbWFzX3ByZWd1bnRhbicsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJyB9LFxuICAgICAgeyBjb2w6ICdheXVkYV90aWVuZGEnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcbiAgICAgIHsgY29sOiAnZ3BzX3N0YXR1cycsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnb2sgfCBvdXRzaWRlIHwgbm9sb2MnIH0sXG4gICAgICB7IGNvbDogJ2dwc19kaXN0YW5jZV9tJywgdHlwZTogJ251bWJlcicsIGRlc2M6ICdtZXRyb3MnIH0sXG4gICAgICB7IGNvbDogJ2ludGVyYWN0aW9uX3R5cGUnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ3Zpc2l0YSB8IGNvbnRhY3RvJyB9LFxuICAgICAge1xuICAgICAgICBjb2w6ICdmb3JtYV9jb250YWN0bycsXG4gICAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgICBkZXNjOiAnTExBTUFEQSBURUxFRk9OSUNBIHwgTUVOU0FKRSBERSBXSEFUU0FQUCB8IE1FTlNBSkUgU01TIChzaSBjb250YWN0byknLFxuICAgICAgfSxcbiAgICAgIHtcbiAgICAgICAgY29sOiAnY29udGFjdG9fcmVzdWx0YWRvJyxcbiAgICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICAgIGRlc2M6ICdyZXNwb25kaW8gfCBub19yZXNwb25kaW8gfCB2YWNpbyAoc2luIG1hcmNhciwgc29sbyBhcGxpY2EgYSBjb250YWN0byknLFxuICAgICAgfSxcbiAgICAgIHsgY29sOiAnY29udGFjdG9fcmVzdWx0YWRvX2F0JywgdHlwZTogJ2lzbzg2MDEnLCBkZXNjOiAndGltZXN0YW1wIFVUQycgfSxcbiAgICAgIHsgY29sOiAnY29udGFjdG9fcmVzdWx0YWRvX2J5JywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdVSUQgZGUgcXVpZW4gbWFyY28nIH0sXG4gICAgICB7IGNvbDogJ2NyZWF0ZWRfYXQnLCB0eXBlOiAnaXNvODYwMScsIGRlc2M6ICd0aW1lc3RhbXAgVVRDJyB9LFxuICAgIF0sXG4gIH0sXG4gIGNsaWVudGVzOiB7XG4gICAgbmFtZTogJ2NsaWVudGVzLmNzdicsXG4gICAgc291cmNlOiAnZmlyZXN0b3JlJyxcbiAgICBjb2xsZWN0aW9uOiAnY2xpZW50X2FwcGxpY2F0aW9ucycsXG4gICAgcm93TW9kZTogJ29uZV9wZXJfZG9jJyxcbiAgICBjb2x1bW5zOiBbXG4gICAgICB7IGNvbDogJ2FwcF9pZCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnRmlyZXN0b3JlIGRvYyBJRCcgfSxcbiAgICAgIHsgY29sOiAnb3duZXJfdWlkJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXG4gICAgICB7IGNvbDogJ293bmVyX2VtYWlsJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXG4gICAgICB7IGNvbDogJ293bmVyX25hbWUnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcbiAgICAgIHsgY29sOiAnY29tZXJjaW8nLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ3Jhem9uIHNvY2lhbCcgfSxcbiAgICAgIHsgY29sOiAnZmFudGFzaWEnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ25vbWJyZSBjb21lcmNpYWwnIH0sXG4gICAgICB7IGNvbDogJ2N1aXQnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ3NvbG8gZGlnaXRvcyBwb3N0LXYyOTQnIH0sXG4gICAgICB7IGNvbDogJ2NvbmRpY2lvbl9maXNjYWwnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcbiAgICAgIHsgY29sOiAnY2FsbGUnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcbiAgICAgIHsgY29sOiAnbnVtZXJvJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXG4gICAgICB7IGNvbDogJ2xvY2FsaWRhZCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJyB9LFxuICAgICAgeyBjb2w6ICdwcm92aW5jaWEnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcbiAgICAgIHsgY29sOiAnbG9jYWxpZGFkX2ZpbmFsJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdvdmVycmlkZSBkZWwgYXByb2JhZG9yJyB9LFxuICAgICAgeyBjb2w6ICdjYXJkX2NvZGVfc2FwJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdDYXJkQ29kZSBTQVAnIH0sXG4gICAgICB7IGNvbDogJ2Fzc2lnbmVkX3ZlbmRvcicsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAndmVuZGVkb3IgYXNpZ25hZG8gKHNvdXJjZSBvZiB0cnV0aCB2MzExKyknIH0sXG4gICAgICB7IGNvbDogJ3N0YXR1cycsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAncGVuZGluZ19hcHByb3ZhbCB8IGFwcHJvdmVkIHwgcmVqZWN0ZWQnIH0sXG4gICAgICB7XG4gICAgICAgIGNvbDogJ3NvdXJjZScsXG4gICAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgICBkZXNjOiAnbWFudWFsIHwgc2FwX2J1bGtfaW1wb3J0IHwgYWx0YV9yYXBpZGEgfCBzYXBfc3luYyB8IHNhcF9zeW5jX21hbnVhbF9saW5rJyxcbiAgICAgIH0sXG4gICAgICB7XG4gICAgICAgIGNvbDogJ21hbnVhbF9zYXBfcGVuZGluZycsXG4gICAgICAgIHR5cGU6ICdib29sZWFuJyxcbiAgICAgICAgZGVzYzogJ3RydWU9cHJvdmlzb3JpbyAoQWx0YSBSYXBpZGEgc2luIENhcmRDb2RlKScsXG4gICAgICB9LFxuICAgICAgeyBjb2w6ICdwcmVjYXVjaW9uJywgdHlwZTogJ2Jvb2xlYW4nLCBkZXNjOiAndHJ1ZT1jbGllbnRlIG1hcmNhZG8gcG9yIGltcGFnbycgfSxcbiAgICAgIHsgY29sOiAnY2F0ZWdvcmlhX2NsaWVudGUnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ1AvQS9CL0MnIH0sXG4gICAgICB7IGNvbDogJ2NsaV90aXBvJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdDIGRlZmF1bHQgcG9zdC12MzQ5JyB9LFxuICAgICAgeyBjb2w6ICdsYXQnLCB0eXBlOiAnbnVtYmVyJywgZGVzYzogJ2dlb2xhdCcgfSxcbiAgICAgIHsgY29sOiAnbG5nJywgdHlwZTogJ251bWJlcicsIGRlc2M6ICdnZW9sbmcnIH0sXG4gICAgICB7IGNvbDogJ2hhc19nZW8nLCB0eXBlOiAnYm9vbGVhbicsIGRlc2M6ICdsYXQvbG5nIG5vIG51bGwnIH0sXG4gICAgICB7IGNvbDogJ2hhc19hZGRyZXNzJywgdHlwZTogJ2Jvb2xlYW4nLCBkZXNjOiAnY2FsbGUgbm8gdmFjaWEnIH0sXG4gICAgICB7IGNvbDogJ3N1Ym1pdHRlZF9ieV9wdWJsaWNfZm9ybScsIHR5cGU6ICdib29sZWFuJywgZGVzYzogJ3ZpYSBhbHRhLWNsaWVudGUuaHRtbCcgfSxcbiAgICAgIHsgY29sOiAnYXBwcm92ZWRfYXQnLCB0eXBlOiAnaXNvODYwMScsIGRlc2M6ICcnIH0sXG4gICAgICB7IGNvbDogJ2NyZWF0ZWRfYXQnLCB0eXBlOiAnaXNvODYwMScsIGRlc2M6ICcnIH0sXG4gICAgICB7IGNvbDogJ3VwZGF0ZWRfYXQnLCB0eXBlOiAnaXNvODYwMScsIGRlc2M6ICcnIH0sXG4gICAgXSxcbiAgfSxcbiAgY2xpZW50X21hc3Rlcjoge1xuICAgIG5hbWU6ICdjbGllbnRfbWFzdGVyLmNzdicsXG4gICAgc291cmNlOiAnZmlyZXN0b3JlJyxcbiAgICBjb2xsZWN0aW9uOiAnY2xpZW50X21hc3RlcicsXG4gICAgcm93TW9kZTogJ29uZV9wZXJfZG9jJyxcbiAgICBjb2x1bW5zOiBbXG4gICAgICB7IGNvbDogJ21hc3Rlcl9pZCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnRmlyZXN0b3JlIGRvYyBJRCcgfSxcbiAgICAgIHsgY29sOiAnY2xpZW50X25hbWUnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcbiAgICAgIHsgY29sOiAncHJvdmluY2lhJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXG4gICAgICB7IGNvbDogJ2xvY2FsaWRhZCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJyB9LFxuICAgICAgeyBjb2w6ICd2ZW5kb3InLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ3ZlbmRlZG9yIGN1cmFkbyBhZG1pbicgfSxcbiAgICAgIHsgY29sOiAnYWRkcmVzcycsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnZGlyZWNjaW9uIGN1cmFkYSBhZG1pbicgfSxcbiAgICAgIHsgY29sOiAnc2FwX2NhcmRfY29kZScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnQ2FyZENvZGUgU0FQJyB9LFxuICAgICAgeyBjb2w6ICdzYXBfYWRkcmVzcycsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnZGlyZWNjaW9uIHJhdyBTQVAnIH0sXG4gICAgICB7IGNvbDogJ3NhcF9jaXR5JywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXG4gICAgICB7IGNvbDogJ3NhcF9zdGF0ZScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJyB9LFxuICAgICAgeyBjb2w6ICdzYXBfaW1wb3J0ZWRfYXQnLCB0eXBlOiAnaXNvODYwMScsIGRlc2M6ICcnIH0sXG4gICAgICB7IGNvbDogJ3NhcF9pbXBvcnRlZF9ieScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJyB9LFxuICAgICAgeyBjb2w6ICdjbGllbnRfbmFtZV9vcmlnaW5hbCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnYmFja3VwIG5vbWJyZSBwcmUtaW1wb3J0JyB9LFxuICAgICAgeyBjb2w6ICdsb2NhbGlkYWRfb3JpZ2luYWwnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ2JhY2t1cCBsb2NhbGlkYWQgcHJlLWltcG9ydCcgfSxcbiAgICAgIHsgY29sOiAnbWF0Y2hfdHlwZScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnZXhhY3QgfCBmdXp6eScgfSxcbiAgICAgIHsgY29sOiAnbWF0Y2hfc2ltaWxhcml0eScsIHR5cGU6ICdudW1iZXInLCBkZXNjOiAnMC0xJyB9LFxuICAgICAgeyBjb2w6ICd1cGRhdGVkX2F0JywgdHlwZTogJ2lzbzg2MDEnLCBkZXNjOiAnJyB9LFxuICAgICAgeyBjb2w6ICd1cGRhdGVkX2J5JywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXG4gICAgXSxcbiAgfSxcbiAgcmVuZGljaW9uZXM6IHtcbiAgICBuYW1lOiAncmVuZGljaW9uZXMuY3N2JyxcbiAgICBzb3VyY2U6ICdmaXJlc3RvcmUnLFxuICAgIGNvbGxlY3Rpb246ICdyZW5kaWNpb25lcycsXG4gICAgcm93TW9kZTogJ29uZV9wZXJfZG9jJyxcbiAgICBjb2x1bW5zOiBbXG4gICAgICB7IGNvbDogJ3JlbmRpY2lvbl9pZCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnRmlyZXN0b3JlIGRvYyBJRCcgfSxcbiAgICAgIHsgY29sOiAnb3duZXJfdWlkJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXG4gICAgICB7IGNvbDogJ293bmVyX2VtYWlsJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXG4gICAgICB7IGNvbDogJ3ZlbmRvcicsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJyB9LFxuICAgICAgeyBjb2w6ICd0aXBvJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdnYXN0byB8IHNvbGljaXR1ZCcgfSxcbiAgICAgIHsgY29sOiAndGlwb19nYXN0bycsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnZWogUEVBSkVTLCBGQUNUVVJBIEEsIEdBU1RPIENPTiBDT01QUk9CQU5URScgfSxcbiAgICAgIHsgY29sOiAnaW1wb3J0ZV9hcnMnLCB0eXBlOiAnbnVtYmVyJywgZGVzYzogJ21vbnRvIEFSUycgfSxcbiAgICAgIHsgY29sOiAnZmVjaGFfZ2FzdG8nLCB0eXBlOiAnaXNvODYwMScsIGRlc2M6ICdZWVlZLU1NLUREIGRlbCBnYXN0bycgfSxcbiAgICAgIHsgY29sOiAnY29uY2VwdG8nLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ2Rlc2NyaXBjaW9uIGxpYnJlJyB9LFxuICAgICAgeyBjb2w6ICdmb3RvX3RpY2tldF91cmwnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ1VSTCBGaXJlYmFzZSBTdG9yYWdlIHYzMDgrIChudW5jYSBiYXNlNjQpJyB9LFxuICAgICAgeyBjb2w6ICdzdGF0dXMnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ3BlbmRpbmdfYXBwcm92YWwgfCBhcHByb3ZlZCB8IHJlamVjdGVkJyB9LFxuICAgICAgeyBjb2w6ICdhcHByb3ZlZF9ieScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnZW1haWwgZGVsIGFwcm9iYWRvciBvIFwic2VsZlwiJyB9LFxuICAgICAgeyBjb2w6ICdhcHByb3ZlZF9hdCcsIHR5cGU6ICdpc284NjAxJywgZGVzYzogJycgfSxcbiAgICAgIHsgY29sOiAncmVqZWN0ZWRfYnlfZW1haWwnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcbiAgICAgIHsgY29sOiAncmVqZWN0ZWRfcmVhc29uJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXG4gICAgICB7IGNvbDogJ2FwcHJvdmVyX3VpZCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnVUlEIHJlc3BvbnNhYmxlIGFzaWduYWRvJyB9LFxuICAgICAgeyBjb2w6ICdjcmVhdGVkX2F0JywgdHlwZTogJ2lzbzg2MDEnLCBkZXNjOiAnJyB9LFxuICAgIF0sXG4gIH0sXG4gIGNhbXBhbmlhczoge1xuICAgIG5hbWU6ICdjYW1wYW5pYXMuY3N2JyxcbiAgICBzb3VyY2U6ICdmaXJlc3RvcmUnLFxuICAgIGNvbGxlY3Rpb246ICdjYW1wYWlnbnMnLFxuICAgIHJvd01vZGU6ICdvbmVfcGVyX2RvYycsXG4gICAgY29sdW1uczogW1xuICAgICAgeyBjb2w6ICdjYW1wYWlnbl9pZCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnRmlyZXN0b3JlIGRvYyBJRCcgfSxcbiAgICAgIHsgY29sOiAnbmFtZScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnbm9tYnJlIGNhbXBhbmEnIH0sXG4gICAgICB7IGNvbDogJ2ZhbWlsaWEnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ2VqIFJFRUxTJyB9LFxuICAgICAgeyBjb2w6ICdzdWJmYW1pbGlhJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdlaiBNVUxUSVBMSUNBRE9SRVMnIH0sXG4gICAgICB7IGNvbDogJ2ZpbHRlcl90eXBlJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdza3UgKGhveSBoYXJkY29kZWQpJyB9LFxuICAgICAgeyBjb2w6ICdmaWx0ZXJfdmFsdWVzX2pzb24nLCB0eXBlOiAnanNvbl9hcnJheScsIGRlc2M6ICdjb3BpYSBkZSBza3VzJyB9LFxuICAgICAgeyBjb2w6ICdza3VzX2pzb24nLCB0eXBlOiAnanNvbl9hcnJheScsIGRlc2M6ICdJdGVtQ29kZXMgaW5jbHVpZG9zJyB9LFxuICAgICAgeyBjb2w6ICdza3VzX2NvdW50JywgdHlwZTogJ2ludCcsIGRlc2M6ICdjYW50aWRhZCBTS1VzJyB9LFxuICAgICAgeyBjb2w6ICd0YXJnZXRfdHlwZScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAndW5pdHMgfCBtb25leScgfSxcbiAgICAgIHsgY29sOiAndGFyZ2V0X2Ftb3VudCcsIHR5cGU6ICdudW1iZXInLCBkZXNjOiAnb2JqZXRpdm8nIH0sXG4gICAgICB7IGNvbDogJ3N0YXJ0X2RhdGUnLCB0eXBlOiAnaXNvODYwMScsIGRlc2M6ICdZWVlZLU1NLUREJyB9LFxuICAgICAgeyBjb2w6ICdlbmRfZGF0ZScsIHR5cGU6ICdpc284NjAxJywgZGVzYzogJ1lZWVktTU0tREQnIH0sXG4gICAgICB7IGNvbDogJ3Njb3BlJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdhbGwgfCBwcm92aW5jZSB8IHZlbmRvcicgfSxcbiAgICAgIHtcbiAgICAgICAgY29sOiAnc2NvcGVfdmFsdWVzX2pzb24nLFxuICAgICAgICB0eXBlOiAnanNvbl9hcnJheScsXG4gICAgICAgIGRlc2M6ICdwcm92aW5jaWFzIG8gdmVuZG9yIGtleXMgc2kgc2NvcGUgIT0gYWxsJyxcbiAgICAgIH0sXG4gICAgICB7IGNvbDogJ2NyZWF0ZWRfYnknLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ1VJRCBhZG1pbi9nZXJlbnRlJyB9LFxuICAgICAgeyBjb2w6ICdjcmVhdGVkX2J5X2VtYWlsJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXG4gICAgICB7IGNvbDogJ2NyZWF0ZWRfYXQnLCB0eXBlOiAnaXNvODYwMScsIGRlc2M6ICcnIH0sXG4gICAgICB7IGNvbDogJ2FyY2hpdmVkX21hbnVhbGx5JywgdHlwZTogJ2Jvb2xlYW4nLCBkZXNjOiAndHJ1ZT1maW5hbGl6YWRhIGFudGVzIGRlIGVuZERhdGUnIH0sXG4gICAgICB7IGNvbDogJ2FyY2hpdmVkX2F0JywgdHlwZTogJ2lzbzg2MDEnLCBkZXNjOiAnJyB9LFxuICAgICAgeyBjb2w6ICdhcmNoaXZlZF9ieScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJyB9LFxuICAgIF0sXG4gIH0sXG4gIHRhcmdldHM6IHtcbiAgICBuYW1lOiAndGFyZ2V0cy5jc3YnLFxuICAgIHNvdXJjZTogJ2ZpcmVzdG9yZScsXG4gICAgY29sbGVjdGlvbjogJ3RhcmdldHMnLFxuICAgIHJvd01vZGU6ICdvbmVfcGVyX2RvYycsXG4gICAgY29sdW1uczogW1xuICAgICAgeyBjb2w6ICd0YXJnZXRfaWQnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ0ZpcmVzdG9yZSBkb2MgSUQgY2Fub25pY28ge3ZlbmRvcn1fe3llYXJ9X3tNTX0nIH0sXG4gICAgICB7IGNvbDogJ3NlbGxlcl9pZCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAndmVuZG9yS2V5IHVwcGVyY2FzZSBlaiBHT05aQUxPIERFIExBIFJPU0EnIH0sXG4gICAgICB7IGNvbDogJ3llYXInLCB0eXBlOiAnaW50JywgZGVzYzogJ2VqIDIwMjYnIH0sXG4gICAgICB7IGNvbDogJ21vbnRoJywgdHlwZTogJ2ludCcsIGRlc2M6ICcwLTExIChpbmRpY2UgZGVsIGFycmF5IE1FU0VTIDAtaW5kZXhlZCknIH0sXG4gICAgICB7IGNvbDogJ3RhcmdldF9hcnMnLCB0eXBlOiAnbnVtYmVyJywgZGVzYzogJ29iamV0aXZvIG1lcyBBUlMgKHN1bWEgZmFtaWxpYXMpJyB9LFxuICAgICAgeyBjb2w6ICd0YXJnZXRfcmVlbF9hcnMnLCB0eXBlOiAnbnVtYmVyJywgZGVzYzogJ3YzMTErIGRlc2dsb3NlJyB9LFxuICAgICAgeyBjb2w6ICd0YXJnZXRfY2FuYXNfYXJzJywgdHlwZTogJ251bWJlcicsIGRlc2M6ICd2MzExKyBkZXNnbG9zZScgfSxcbiAgICAgIHsgY29sOiAndGFyZ2V0X2xpbmVhc19hcnMnLCB0eXBlOiAnbnVtYmVyJywgZGVzYzogJ3YzMTErIGRlc2dsb3NlJyB9LFxuICAgICAgeyBjb2w6ICd1cGRhdGVkX2F0JywgdHlwZTogJ2lzbzg2MDEnLCBkZXNjOiAnJyB9LFxuICAgICAgeyBjb2w6ICd1cGRhdGVkX2J5JywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdVSUQnIH0sXG4gICAgICB7IGNvbDogJ3VwZGF0ZWRfYnlfZW1haWwnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcbiAgICBdLFxuICB9LFxuICBwcm9kdWN0b3M6IHtcbiAgICBuYW1lOiAncHJvZHVjdG9zLmNzdicsXG4gICAgc291cmNlOiAnc3RvY2tfanNvbicsXG4gICAgcm93TW9kZTogJ2Zyb21fc3RvY2tfanNvbicsXG4gICAgY29sdW1uczogW1xuICAgICAgeyBjb2w6ICdza3UnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ1NLVSAoSXRlbUNvZGUgU0FQKScgfSxcbiAgICAgIHsgY29sOiAnaGFzX3N0b2NrJywgdHlwZTogJ2Jvb2xlYW4nLCBkZXNjOiAndHJ1ZT1oYXkgdW5pZGFkZXMgZW4gYWxndW4gd2hzIHZlbmRpYmxlJyB9LFxuICAgICAgeyBjb2w6ICdjYW50aWRhZF90b3RhbCcsIHR5cGU6ICdpbnQnLCBkZXNjOiAnc3VtYSB0b3RhbCB3aHMgdmVuZGlibGVzIChleGNsdXllIDA1IHkgMDYpJyB9LFxuICAgICAge1xuICAgICAgICBjb2w6ICdkaXNwb25pYmxlX3ZlbnRhX3doczExJyxcbiAgICAgICAgdHlwZTogJ2ludCcsXG4gICAgICAgIGRlc2M6ICd2MzY5KyBNZXJjYWRlcmlhIE5VUiBQRVNDQSAodmVudGEgZGlyZWN0YSknLFxuICAgICAgfSxcbiAgICAgIHsgY29sOiAndHJhbnNpdG9fd2hzMTInLCB0eXBlOiAnaW50JywgZGVzYzogJ3YzNjkrIEVuIHRyYW5zaXRvIFBFU0NBIChiYWNrb3JkZXIgZnV0dXJvKScgfSxcbiAgICAgIHtcbiAgICAgICAgY29sOiAnb3Ryb3Nfd2FyZWhvdXNlc19qc29uJyxcbiAgICAgICAgdHlwZTogJ2pzb25fb2JqZWN0JyxcbiAgICAgICAgZGVzYzogJ290cm9zIGNvZGlnb3MgY29uIGNhbnRpZGFkLCBlaiB7XCI5OFwiOiA1fScsXG4gICAgICB9LFxuICAgICAgeyBjb2w6ICdzb3VyY2UnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ3N0b2NrLmpzb24gc25hcHNob3QnIH0sXG4gICAgICB7IGNvbDogJ3NuYXBzaG90X3VwZGF0ZWRfYXQnLCB0eXBlOiAnaXNvODYwMScsIGRlc2M6ICd0aW1lc3RhbXAgZGVsIHVsdGltbyBzeW5jIFNBUCcgfSxcbiAgICBdLFxuICB9LFxuICB2ZW5kb3Jfb3ZlcnJpZGVzOiB7XG4gICAgbmFtZTogJ3ZlbmRvcl9vdmVycmlkZXMuY3N2JyxcbiAgICBzb3VyY2U6ICdmaXJlc3RvcmUnLFxuICAgIGNvbGxlY3Rpb246ICd2ZW5kb3Jfb3ZlcnJpZGVzJyxcbiAgICByb3dNb2RlOiAnb25lX3Blcl9kb2MnLFxuICAgIGNvbHVtbnM6IFtcbiAgICAgIHsgY29sOiAnb3ZlcnJpZGVfaWQnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ0ZpcmVzdG9yZSBkb2MgSUQnIH0sXG4gICAgICB7IGNvbDogJ3Njb3BlJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdzaG9wIHwgbG9jJyB9LFxuICAgICAgeyBjb2w6ICdwcm92aW5jZScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJyB9LFxuICAgICAgeyBjb2w6ICdsb2NhbGl0eV9uYW1lJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXG4gICAgICB7IGNvbDogJ2NsaWVudF9uYW1lJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdzb2xvIHNpIHNjb3BlPXNob3AnIH0sXG4gICAgICB7IGNvbDogJ29yaWdpbmFsX3ZlbmRvcicsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJyB9LFxuICAgICAgeyBjb2w6ICduZXdfdmVuZG9yJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXG4gICAgICB7IGNvbDogJ25ld190eXBlJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdWREUgfCBWREkgfCBESVNUUklCVUlET1IgfCBPVFJPJyB9LFxuICAgICAgeyBjb2w6ICd1cGRhdGVkX2F0JywgdHlwZTogJ2lzbzg2MDEnLCBkZXNjOiAnJyB9LFxuICAgICAgeyBjb2w6ICd1cGRhdGVkX2J5X3VpZCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJyB9LFxuICAgICAgeyBjb2w6ICd1cGRhdGVkX2J5X2VtYWlsJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXG4gICAgICB7IGNvbDogJ3VwZGF0ZWRfYnlfZGlzcGxheV9uYW1lJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXG4gICAgXSxcbiAgfSxcbiAgY3VzdG9tX3JvdXRlczoge1xuICAgIG5hbWU6ICdjdXN0b21fcm91dGVzLmNzdicsXG4gICAgc291cmNlOiAnZmlyZXN0b3JlJyxcbiAgICBjb2xsZWN0aW9uOiAnY3VzdG9tX3JvdXRlcycsXG4gICAgcm93TW9kZTogJ2ZsYXR0ZW5fc3RvcHMnLCAvLyAxIGZpbGEgcG9yIChydXRhLCBzdG9wKVxuICAgIGNvbHVtbnM6IFtcbiAgICAgIHsgY29sOiAncm91dGVfaWQnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ0ZpcmVzdG9yZSBkb2MgSUQnIH0sXG4gICAgICB7IGNvbDogJ293bmVyX3VpZCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnZHVlbmlvIGRlIGxhIHJ1dGEnIH0sXG4gICAgICB7IGNvbDogJ293bmVyX2VtYWlsJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICcnIH0sXG4gICAgICB7IGNvbDogJ25hbWUnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ25vbWJyZSBkZSBsYSBydXRhJyB9LFxuICAgICAgeyBjb2w6ICdwbGFubmVkX2RhdGUnLCB0eXBlOiAnaXNvODYwMScsIGRlc2M6ICdZWVlZLU1NLUREJyB9LFxuICAgICAgeyBjb2w6ICdub3RlcycsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnbm90YXMgbGlicmVzJyB9LFxuICAgICAgeyBjb2w6ICdjcmVhdGVkX2F0JywgdHlwZTogJ2lzbzg2MDEnLCBkZXNjOiAnJyB9LFxuICAgICAgeyBjb2w6ICd1cGRhdGVkX2F0JywgdHlwZTogJ2lzbzg2MDEnLCBkZXNjOiAnJyB9LFxuICAgICAgeyBjb2w6ICdzdG9wX29yZGVyJywgdHlwZTogJ2ludCcsIGRlc2M6ICdvcmRlbiAwLWJhc2VkJyB9LFxuICAgICAgeyBjb2w6ICdzdG9wX2tleScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnY2xhdmUgY29tcHVlc3RhIHRpcG98cHJvdnxsb2N8Y2xpZW50ZScgfSxcbiAgICAgIHsgY29sOiAnc3RvcF90aXBvJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdDIHwgUCcgfSxcbiAgICAgIHsgY29sOiAnc3RvcF9wcm92aW5jaWEnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcbiAgICAgIHsgY29sOiAnc3RvcF9sb2NhbGlkYWQnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcbiAgICAgIHsgY29sOiAnc3RvcF9jbGllbnRfbmFtZScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJyB9LFxuICAgICAgeyBjb2w6ICdzdG9wX2lzX3Byb3Zpc29yaW8nLCB0eXBlOiAnYm9vbGVhbicsIGRlc2M6ICd0cnVlPWFsdGEgcmFwaWRhIHNpbiBDYXJkQ29kZScgfSxcbiAgICAgIHsgY29sOiAnc3RvcF9zYXBfYWx0YV9pZCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnSUQgZGVsIGNsaWVudF9hcHBsaWNhdGlvbnMgc2kgYXBsaWNhJyB9LFxuICAgIF0sXG4gIH0sXG4gIHNlZ3VpbWllbnRvX25vdGVzOiB7XG4gICAgbmFtZTogJ3NlZ3VpbWllbnRvX25vdGVzLmNzdicsXG4gICAgc291cmNlOiAnZmlyZXN0b3JlJyxcbiAgICBjb2xsZWN0aW9uOiAnc2VndWltaWVudG9fbm90ZXMnLFxuICAgIHJvd01vZGU6ICdvbmVfcGVyX2RvYycsXG4gICAgY29sdW1uczogW1xuICAgICAgeyBjb2w6ICdub3RlX2lkJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdGaXJlc3RvcmUgZG9jIElEJyB9LFxuICAgICAgeyBjb2w6ICd2ZW5kb3JfZXh0JywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdWREUgYWwgcXVlIGFwbGljYSBsYSBub3RhJyB9LFxuICAgICAgeyBjb2w6ICdjbGllbnRfa2V5JywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdjbGF2ZSBjb21wdWVzdGEgY2xpZW50ZScgfSxcbiAgICAgIHsgY29sOiAnY2xpZW50X25hbWUnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcbiAgICAgIHsgY29sOiAncHJvdmluY2UnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcbiAgICAgIHsgY29sOiAnbG9jYWxpdHknLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcbiAgICAgIHsgY29sOiAndGV4dCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAndGV4dG8gbGlicmUgZGUgbGEgbm90YScgfSxcbiAgICAgIHsgY29sOiAnYXV0aG9yX3VpZCcsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJyB9LFxuICAgICAgeyBjb2w6ICdhdXRob3JfZW1haWwnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcbiAgICAgIHsgY29sOiAnYXV0aG9yX25hbWUnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcbiAgICAgIHsgY29sOiAnYXV0aG9yX3JvbGUnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ2FkbWluIHwgZ2VyZW50ZSB8IGludGVybm8nIH0sXG4gICAgICB7IGNvbDogJ2NyZWF0ZWRfYXQnLCB0eXBlOiAnaXNvODYwMScsIGRlc2M6ICcnIH0sXG4gICAgXSxcbiAgfSxcbiAgLy8gdjczMiAoMjAyNi0wOC0yOSk6IDMgc25hcHNob3RzIEJRLT5GaXJlc3RvcmUgYWhvcmEgaW5jbHVpZG9zIGVuIGVsIGRhdGFzZXQgTUwuXG4gIC8vIEFudGVzIGVzdGFiYW4gZW4gZXhjbHVkZWRDb2xsZWN0aW9ucyBkZWwgbWFuaWZlc3QuIFJhY2lvbmFsOiBzb24gZnVlbnRlIGRlXG4gIC8vIHZlcmRhZCBkZSBmYWN0dXJhY2lvbiBSRUFMIFNBUCAobmV0byBOQ3MpLCBkZW1hbmQtc3VwcmVzc2lvbiAoYmFja29yZGVycylcbiAgLy8geSBhZ3JlZ2Fkb3MgZGlhcmlvcyBsaXN0b3MtcGFyYS1iZW5jaG1hcmsuXG4gIHNhcF9zbmFwc2hvdDoge1xuICAgIG5hbWU6ICdzYXBfc25hcHNob3QuY3N2JyxcbiAgICBzb3VyY2U6ICdmaXJlc3RvcmUnLFxuICAgIGNvbGxlY3Rpb246ICdzYXBfc25hcHNob3QnLFxuICAgIHJvd01vZGU6ICdvbmVfcGVyX2RvYycsXG4gICAgY29sdW1uczogW1xuICAgICAgeyBjb2w6ICdkb2NfaWQnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ0ZpcmVzdG9yZSBkb2MgSUQgKFZFTkRPUl9OT1JNX1lZWVlfTU0pJyB9LFxuICAgICAge1xuICAgICAgICBjb2w6ICd2ZW5kb3Jfa2V5JyxcbiAgICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICAgIGRlc2M6ICdub21icmUgZGVsIHZlbmRlZG9yIHRhbCBjdWFsIHZpZW5lIGRlIFNBUCAoc2luIG5vcm1hbGl6YXIpJyxcbiAgICAgIH0sXG4gICAgICB7IGNvbDogJ2FuaW8nLCB0eXBlOiAnaW50ZWdlcicsIGRlc2M6ICdhbmlvIGNhbGVuZGFyaW8nIH0sXG4gICAgICB7IGNvbDogJ21lcycsIHR5cGU6ICdpbnRlZ2VyJywgZGVzYzogJzEtMTInIH0sXG4gICAgICB7XG4gICAgICAgIGNvbDogJ2ZhY3R1cmFkb19hcnNfbmV0bycsXG4gICAgICAgIHR5cGU6ICdudW1iZXInLFxuICAgICAgICBkZXNjOiAnZmFjdHVyYXMgLSBOQ3MgQVJTIChjb24gSVZBIGNhcmdhZG8gZW4gZWwgaW1wb3J0ZSknLFxuICAgICAgfSxcbiAgICAgIHsgY29sOiAnZmFjdHVyYWRvX2Fyc19icnV0bycsIHR5cGU6ICdudW1iZXInLCBkZXNjOiAnZmFjdHVyYXMgKyBOQ3Mgc3VtYWRhcyBBUlMgYnJ1dG8nIH0sXG4gICAgICB7IGNvbDogJ25jc19hcnMnLCB0eXBlOiAnbnVtYmVyJywgZGVzYzogJ21vbnRvIGRlIG5vdGFzIGRlIGNyZWRpdG8gQVJTJyB9LFxuICAgICAgeyBjb2w6ICdmYWN0dXJhc19jb3VudCcsIHR5cGU6ICdpbnRlZ2VyJywgZGVzYzogJycgfSxcbiAgICAgIHsgY29sOiAnbmNzX2NvdW50JywgdHlwZTogJ2ludGVnZXInLCBkZXNjOiAnJyB9LFxuICAgICAgeyBjb2w6ICd1bmlkYWRlc19uZXRvJywgdHlwZTogJ251bWJlcicsIGRlc2M6ICdzdW0ocXR5KSBmYWN0dXJhcyAtIHN1bShxdHkpIE5DcycgfSxcbiAgICAgIHtcbiAgICAgICAgY29sOiAnaW1wb3J0ZV9saW5lYXNfYXJzX25ldG8nLFxuICAgICAgICB0eXBlOiAnbnVtYmVyJyxcbiAgICAgICAgZGVzYzogJ3N1bSBpbXBvcnRlcyBkZSBsaW5lYSAoc2luIElWQSk7IHVzYXIgZXN0ZSBjYW1wbyBwYXJhIG1vZGVsb3MgZGUgbmVnb2NpbyAtIGZhY3R1cmFkb19hcnNfbmV0byBpbmNsdXllIElWQSB5IHNvYnJlZXN0aW1hJyxcbiAgICAgIH0sXG4gICAgICB7IGNvbDogJ3VwZGF0ZWRfYXQnLCB0eXBlOiAnaXNvODYwMScsIGRlc2M6ICd0aW1lc3RhbXAgZGVsIHN5bmMgQlEtPkZpcmVzdG9yZScgfSxcbiAgICBdLFxuICB9LFxuICBmYWN0dXJhY2lvbl9zbmFwc2hvdDoge1xuICAgIG5hbWU6ICdmYWN0dXJhY2lvbl9zbmFwc2hvdC5jc3YnLFxuICAgIHNvdXJjZTogJ2ZpcmVzdG9yZScsXG4gICAgY29sbGVjdGlvbjogJ2ZhY3R1cmFjaW9uX3NuYXBzaG90JyxcbiAgICByb3dNb2RlOiAnb25lX3Blcl9kb2MnLFxuICAgIGNvbHVtbnM6IFtcbiAgICAgIHsgY29sOiAnZG9jX2lkJywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdGaXJlc3RvcmUgZG9jIElEIChWRU5ET1JfTk9STSBvIFRPVEFMX05BQ0lPTkFMKScgfSxcbiAgICAgIHtcbiAgICAgICAgY29sOiAndmVuZG9yX2tleScsXG4gICAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgICBkZXNjOiAnbm9tYnJlIGNhbm9uaWNvIGRlbCB2ZW5kZWRvciAtIFRPVEFMX05BQ0lPTkFMIHBhcmEgZWwgcm9sbHVwIG5hY2lvbmFsJyxcbiAgICAgIH0sXG4gICAgICB7IGNvbDogJ2hveV9hcnMnLCB0eXBlOiAnbnVtYmVyJywgZGVzYzogJ2ZhY3R1cmFjaW9uIGRlbCBkaWEgYWN0dWFsIEFSUycgfSxcbiAgICAgIHsgY29sOiAnbWVzX2FycycsIHR5cGU6ICdudW1iZXInLCBkZXNjOiAnZmFjdHVyYWNpb24gTVREIGRlbCBtZXMgYWN0dWFsIEFSUycgfSxcbiAgICAgIHsgY29sOiAnYW5vX2FycycsIHR5cGU6ICdudW1iZXInLCBkZXNjOiAnZmFjdHVyYWNpb24gWVREIGRlbCBhbmlvIGFjdHVhbCBBUlMnIH0sXG4gICAgICB7IGNvbDogJ3VwZGF0ZWRfYXQnLCB0eXBlOiAnaXNvODYwMScsIGRlc2M6ICd0aW1lc3RhbXAgZGVsIHVsdGltbyBzeW5jJyB9LFxuICAgIF0sXG4gIH0sXG4gIGJhY2tvcmRlcl9zbmFwc2hvdDoge1xuICAgIG5hbWU6ICdiYWNrb3JkZXJfc25hcHNob3QuY3N2JyxcbiAgICBzb3VyY2U6ICdmaXJlc3RvcmUnLFxuICAgIGNvbGxlY3Rpb246ICdiYWNrb3JkZXJfc25hcHNob3QnLFxuICAgIHJvd01vZGU6ICdvbmVfcGVyX2xpbmUnLFxuICAgIGNvbHVtbnM6IFtcbiAgICAgIHtcbiAgICAgICAgY29sOiAnZG9jX2lkJyxcbiAgICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICAgIGRlc2M6ICdGaXJlc3RvcmUgZG9jIElEIChWRU5ET1JfTk9STSk7IHVuIGRvYyA9IHVuIHZlbmRlZG9yLCByZXBsaWNhZG8gZW4gY2FkYSBsaW5lYScsXG4gICAgICB9LFxuICAgICAgeyBjb2w6ICd2ZW5kb3Jfa2V5JywgdHlwZTogJ3N0cmluZycsIGRlc2M6ICdub21icmUgZGVsIHZlbmRlZG9yIHNpbiBub3JtYWxpemFyJyB9LFxuICAgICAge1xuICAgICAgICBjb2w6ICdsaW5lc19jb3VudCcsXG4gICAgICAgIHR5cGU6ICdpbnRlZ2VyJyxcbiAgICAgICAgZGVzYzogJ2NhbnRpZGFkIHRvdGFsIGRlIGxpbmVhcyBlbiBlbCBzbmFwc2hvdCBkZWwgdmVuZGVkb3IgKHJlcGxpY2FkbyBlbiBjYWRhIHJvdyBwYXJhIGpvaW5zKScsXG4gICAgICB9LFxuICAgICAgeyBjb2w6ICd1cGRhdGVkX2F0JywgdHlwZTogJ2lzbzg2MDEnLCBkZXNjOiAnJyB9LFxuICAgICAgeyBjb2w6ICdza3UnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ1NLVSBkZWwgcHJvZHVjdG8gZW4gYmFja29yZGVyIChzb2xvIFBFU0NBKScgfSxcbiAgICAgIHsgY29sOiAncHJvZHVjdG8nLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ25vbWJyZSBkZWwgcHJvZHVjdG8nIH0sXG4gICAgICB7IGNvbDogJ2ZhbWlsaWEnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcbiAgICAgIHsgY29sOiAnc3ViZmFtaWxpYScsIHR5cGU6ICdzdHJpbmcnLCBkZXNjOiAnJyB9LFxuICAgICAgeyBjb2w6ICdwZW5kaWVudGUnLCB0eXBlOiAnbnVtYmVyJywgZGVzYzogJ3VuaWRhZGVzIHBlbmRpZW50ZXMgZGUgZGVzcGFjaG8gKGJhY2tvcmRlciknIH0sXG4gICAgICB7IGNvbDogJ3BlZGlkbycsIHR5cGU6ICdudW1iZXInLCBkZXNjOiAndW5pZGFkZXMgcGVkaWRhcyBvcmlnaW5hbG1lbnRlIGVuIGxhIFNRJyB9LFxuICAgICAge1xuICAgICAgICBjb2w6ICdzdG9ja19hY3R1YWwnLFxuICAgICAgICB0eXBlOiAnaW50ZWdlcicsXG4gICAgICAgIGRlc2M6ICdzdG9jayBkaXNwb25pYmxlIGRlbCBTS1UgYWwgbW9tZW50byBkZWwgc25hcHNob3QnLFxuICAgICAgfSxcbiAgICAgIHsgY29sOiAncHJlY2lvX3VuaXRhcmlvJywgdHlwZTogJ251bWJlcicsIGRlc2M6ICdwcmVjaW8gdW5pdGFyaW8gQVJTJyB9LFxuICAgICAgeyBjb2w6ICdjbGllbnRlX2NvZGUnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ2NhcmRDb2RlIFNBUCBkZWwgY2xpZW50ZScgfSxcbiAgICAgIHsgY29sOiAnY2xpZW50ZV9ub21icmUnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcbiAgICAgIHsgY29sOiAnY2xpZW50ZV9jaXVkYWQnLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJycgfSxcbiAgICAgIHsgY29sOiAnc3FfZG9jX251bScsIHR5cGU6ICdpbnRlZ2VyJywgZGVzYzogJ251bWVybyBkZSBTYWxlcyBRdW90YXRpb24gU0FQJyB9LFxuICAgICAgeyBjb2w6ICdzcV9kb2NfZGF0ZScsIHR5cGU6ICdpc284NjAxJywgZGVzYzogJ2ZlY2hhIGRlIGxhIFNRJyB9LFxuICAgICAgeyBjb2w6ICdlc3RhZG8nLCB0eXBlOiAnc3RyaW5nJywgZGVzYzogJ2VzdGFkbyBkZWwgYmFja29yZGVyIHNlZ3VuIFNBUCcgfSxcbiAgICBdLFxuICB9LFxufTtcblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBEQVRBU0VUX1VTRV9DQVNFX01BVFJJWCBcdTIwMTQgY2Fzb3MgZGUgdXNvIE1MIGNvbiBjYW1wb3MgcmVxdWVyaWRvc1xuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbi8qKiBAdHlwZWRlZiB7e3ByaW9yaXR5OiBudW1iZXJ8c3RyaW5nLCBkZXNjcmlwdGlvbjogc3RyaW5nLCByZXF1aXJlZEZpZWxkczogUmVjb3JkPHN0cmluZywgc3RyaW5nW10+LCBqb2luTm90ZXM/OiBzdHJpbmd9fSBVc2VDYXNlICovXG5cbi8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgVXNlQ2FzZT59ICovXG5leHBvcnQgY29uc3QgREFUQVNFVF9VU0VfQ0FTRV9NQVRSSVggPSB7XG4gIEFfY29udmVyc2lvbl92aXNpdGFfcGVkaWRvOiB7XG4gICAgcHJpb3JpdHk6IDEsXG4gICAgZGVzY3JpcHRpb246ICdQcmVkZWNpciBxdWUgdmlzaXRhcyB0ZXJtaW5hbiBlbiBwZWRpZG8gcGFyYSBwcmlvcml6YXIgbGEgcnV0YSBkZWwgdmVuZGVkb3IuJyxcbiAgICByZXF1aXJlZEZpZWxkczoge1xuICAgICAgJ3Zpc2l0YXMuY3N2JzogWydmZWNoYScsICdvd25lcl91aWQnLCAncHJvdmluY2lhJywgJ2xvY2FsaWRhZCcsICd0aWVuZGEnXSxcbiAgICAgICdwZWRpZG9zLmNzdic6IFsnY29uZmlybWVkX2F0JywgJ293bmVyX3VpZCcsICdwcm92aW5jZScsICdsb2NfbmFtZScsICdjbGllbnRfbmFtZSddLFxuICAgIH0sXG4gICAgam9pbk5vdGVzOlxuICAgICAgJ0pPSU4gcG9yIChwcm92aW5jaWEsIGxvY2FsaWRhZCwgdGllbmRhfmNsaWVudF9uYW1lKSBlbiB2ZW50YW5hIHRlbXBvcmFsIGZlY2hhX3Zpc2l0YS4uY29uZmlybWVkX2F0LiBObyBoYXkgY2FyZENvZGVTYXAgY29tdW4gZW50cmUgdmlzaXRzIHkgcGVkaWRvcy4nLFxuICB9LFxuICBCX2NodXJuX2NsaWVudGVzOiB7XG4gICAgcHJpb3JpdHk6IDIsXG4gICAgZGVzY3JpcHRpb246ICdEZXRlY3RhciBjbGllbnRlcyBxdWUgc2UgZW5mcmlhbiBhbnRlcyBkZSBwZXJkZXJsb3MuJyxcbiAgICByZXF1aXJlZEZpZWxkczoge1xuICAgICAgJ2NsaWVudGVzLmNzdic6IFsnY3JlYXRlZF9hdCcsICdhc3NpZ25lZF92ZW5kb3InLCAncHJvdmluY2lhJywgJ3N0YXR1cycsICdjYXJkX2NvZGVfc2FwJ10sXG4gICAgICAncGVkaWRvcy5jc3YnOiBbJ2NvbmZpcm1lZF9hdCcsICdjbGllbnRfbmFtZScsICdwcm92aW5jZScsICdsb2NfbmFtZSddLFxuICAgIH0sXG4gICAgam9pbk5vdGVzOlxuICAgICAgJ0pPSU4gdmlhIGNsaWVudF9hcHBsaWNhdGlvbnMuY2FyZF9jb2RlX3NhcCB2cyBwZWRpZG9zLmtleSAocGFyc2VhZG8pLiBGcmFnaWwgLSBjb25zaWRlcmFyIGZ1enp5IG1hdGNoIHBvciBub21icmUuJyxcbiAgfSxcbiAgQ19mb3JlY2FzdF9za3U6IHtcbiAgICBwcmlvcml0eTogMyxcbiAgICBkZXNjcmlwdGlvbjogJ0FudGljaXBhciBxdWUgcHJvZHVjdG9zIHNlIHZhbiBhIHBlZGlyIHBvciBwZXJpb2RvLicsXG4gICAgcmVxdWlyZWRGaWVsZHM6IHtcbiAgICAgICdwZWRpZG9zLmNzdic6IFsnbGluZV9jb2RlJywgJ2xpbmVfcXR5JywgJ2xpbmVfcHJlY2lvJywgJ2NvbmZpcm1lZF9hdCcsICdwcm92aW5jZSddLFxuICAgICAgJ3Byb2R1Y3Rvcy5jc3YnOiBbJ3NrdSddLFxuICAgIH0sXG4gICAgam9pbk5vdGVzOlxuICAgICAgJ0Rlc2N1ZW50byBhcGxpY2FkbyBhIG5pdmVsIGhlYWRlciAoZGlzY291bnRfcGN0KSAtIHByb3JyYXRlYXIgZW4gZWwgcGlwZWxpbmUgZG93bnN0cmVhbSBwcm9wb3JjaW9uYWwgYSBzdWJ0b3RhbF9icnV0byBkZSBjYWRhIGxpbmVhLiBFbnJpcXVlY2VyIGNvbiBjYXRhbG9nbyBCUSAoc2FwX2l0ZW1zX3Jhdykgc2kgaGFjZSBmYWx0YSBjYXQvZmFtL3N1YiBhZGljaW9uYWwuJyxcbiAgfSxcbiAgRF9hbm9tYWxpYXNfcmVuZGljaW9uZXM6IHtcbiAgICBwcmlvcml0eTogJ2V4cGxvcmF0b3JpbycsXG4gICAgZGVzY3JpcHRpb246ICdEZXRlY3RhciBvdXRsaWVycyBkZSBnYXN0b3MuJyxcbiAgICByZXF1aXJlZEZpZWxkczoge1xuICAgICAgJ3JlbmRpY2lvbmVzLmNzdic6IFsnaW1wb3J0ZV9hcnMnLCAndGlwb19nYXN0bycsICdvd25lcl91aWQnLCAnZmVjaGFfZ2FzdG8nLCAnc3RhdHVzJ10sXG4gICAgfSxcbiAgfSxcbiAgRV9lc3RhY2lvbmFsaWRhZF96b25hX2NhdGVnb3JpYToge1xuICAgIHByaW9yaXR5OiAnZXhwbG9yYXRvcmlvJyxcbiAgICBkZXNjcmlwdGlvbjogJ0luc3VtbyBwYXJhIGFybWFkbyBkZSBjYW1wYW5pYXMgZXN0YWNpb25hbGVzLicsXG4gICAgcmVxdWlyZWRGaWVsZHM6IHtcbiAgICAgICdwZWRpZG9zLmNzdic6IFsnY29uZmlybWVkX2F0JywgJ3Byb3ZpbmNlJywgJ2xpbmVfY29kZScsICdsaW5lX2ZhbScsICdsaW5lX3F0eSddLFxuICAgICAgJ2NsaWVudGVzLmNzdic6IFsncHJvdmluY2lhJywgJ2Fzc2lnbmVkX3ZlbmRvciddLFxuICAgICAgJ2NhbXBhbmlhcy5jc3YnOiBbJ3N0YXJ0X2RhdGUnLCAnZW5kX2RhdGUnLCAnc2t1c19qc29uJywgJ3Njb3BlJ10sXG4gICAgICAndGFyZ2V0cy5jc3YnOiBbJ3llYXInLCAnbW9udGgnLCAndGFyZ2V0X2FycyddLFxuICAgIH0sXG4gIH0sXG59O1xuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIFJvdyBidWlsZGVycyBcdTIwMTQgZnVuY2lvbmVzIHB1cmFzIChkb2MgLT4gYXJyYXkgZGUgcm93cylcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4vKipcbiAqIEV4dHJhZSB2YWxvciBGaXJlc3RvcmUgZGUgZG9jIGNvbiBwYXRoIGFuaWRhZG8uIERldnVlbHZlIHJhdyAobm8gQ1NWKS5cbiAqIEVqOiBnZXRGaWVsZChkb2MsICd0cmFuc2Zlcmlkb1NBUC5kb2NOdW0nKVxuICogQHBhcmFtIHtvYmplY3R9IGRvY1xuICogQHBhcmFtIHtzdHJpbmd9IHBhdGhcbiAqL1xuZnVuY3Rpb24gZihkb2MsIHBhdGgpIHtcbiAgcmV0dXJuIGdldFBhdGgoZG9jLCBwYXRoKTtcbn1cblxuLyoqXG4gKiBSb3cgYnVpbGRlciBnZW5lcmljbzogbWFwZWEgdW4gZG9jIGEgYXJyYXkgZGUgdmFsb3JlcyBzZWd1biB1biBhcnJheSBkZSBwYXRocy5cbiAqIEBwYXJhbSB7b2JqZWN0fSBkb2NcbiAqIEBwYXJhbSB7c3RyaW5nW119IHBhdGhzXG4gKiBAcmV0dXJucyB7dW5rbm93bltdfVxuICovXG5mdW5jdGlvbiBfYnVpbGRSb3coZG9jLCBwYXRocykge1xuICByZXR1cm4gcGF0aHMubWFwKChwKSA9PiAocCA9PT0gJ19faWRfXycgPyAvKiogQHR5cGUge2FueX0gKi8gKGRvYykuX2lkIDogZihkb2MsIHApKSk7XG59XG5cbi8qKlxuICogUGVkaWRvczogZmxhdHRlbiAxIGZpbGEgcG9yIGxpbmVhLiBIZWFkZXIgcGVkaWRvIHJlcGxpY2FkbyBlbiBjYWRhLlxuICogZG9jLl9pZCBlcyBlbCBJRDsgc2UgZXNwZXJhIHF1ZSBlbCBjYWxsZXIgbG8gYWdyZWd1ZSBhbnRlcyBkZSBwYXNhci5cbiAqIEBwYXJhbSB7YW55fSBkb2NcbiAqIEByZXR1cm5zIHt1bmtub3duW11bXX1cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGJ1aWxkUGVkaWRvUm93cyhkb2MpIHtcbiAgY29uc3QgaGVhZGVyID0gW1xuICAgIGRvYy5faWQsXG4gICAgZG9jLm93bmVyVWlkLFxuICAgIGRvYy5vd25lckVtYWlsLFxuICAgIGRvYy5jcmVhdGVkQnlVaWQsXG4gICAgZG9jLm9uQmVoYWxmT2YsXG4gICAgZG9jLmtleSxcbiAgICBkb2Muc3RhZ2UsXG4gICAgZG9jLnRpcG8sXG4gICAgZG9jLnByb3ZpbmNlLFxuICAgIGRvYy5sb2NOYW1lLFxuICAgIGRvYy5jbGllbnROYW1lLFxuICAgIGRvYy5tb250aCxcbiAgICBkb2MubW9udGhJZHgsXG4gICAgZG9jLnllYXIsXG4gICAgZG9jLmNvbmZpcm1lZEF0LFxuICAgIGRvYy5jb25kaWNpb25QYWdvLFxuICAgIGRvYy5mb3JtYUVudHJlZ2EgPyBkb2MuZm9ybWFFbnRyZWdhLnRpcG8gOiBudWxsLFxuICAgIGRvYy5mb3JtYUVudHJlZ2EgPyBkb2MuZm9ybWFFbnRyZWdhLnRyYW5zcE5vbWJyZSA6IG51bGwsXG4gICAgZG9jLmZvcm1hRW50cmVnYSA/IGRvYy5mb3JtYUVudHJlZ2EudHJhbnNwRGlyZWNjaW9uIDogbnVsbCxcbiAgICBkb2MuZm9ybWFFbnRyZWdhID8gZG9jLmZvcm1hRW50cmVnYS5jbGllbnRlRGlyZWNjaW9uIDogbnVsbCxcbiAgICBkb2MuZm9ybWFFbnRyZWdhID8gZG9jLmZvcm1hRW50cmVnYS5zdWN1cnNhbERpcmVjY2lvbiA6IG51bGwsXG4gICAgZG9jLmRpc2NvdW50UGN0LFxuICAgIGRvYy5zdWJ0b3RhbEFycyxcbiAgICBkb2MubmV0QW1vdW50QXJzLFxuICAgIGRvYy50cmFuc2Zlcmlkb1NBUCA/IGRvYy50cmFuc2Zlcmlkb1NBUC52aWEgOiBudWxsLFxuICAgIGRvYy50cmFuc2Zlcmlkb1NBUCA/IGRvYy50cmFuc2Zlcmlkb1NBUC5kb2NOdW0gOiBudWxsLFxuICAgIGRvYy50cmFuc2Zlcmlkb1NBUCA/IGRvYy50cmFuc2Zlcmlkb1NBUC5kb2NFbnRyeSA6IG51bGwsXG4gICAgZG9jLnRyYW5zZmVyaWRvU0FQID8gZG9jLnRyYW5zZmVyaWRvU0FQLmF0IDogbnVsbCxcbiAgICBkb2MuY3JlYXRlZEF0LFxuICBdO1xuICBjb25zdCBsaW5lcyA9IEFycmF5LmlzQXJyYXkoZG9jLmxpbmVzKSA/IGRvYy5saW5lcyA6IFtdO1xuICBpZiAoIWxpbmVzLmxlbmd0aCkge1xuICAgIC8vIFBlZGlkbyBzaW4gbGluZWFzIC0+IDEgZmlsYSBjb24gbGluZV8qIHZhY2lvc1xuICAgIHJldHVybiBbaGVhZGVyLmNvbmNhdChbbnVsbCwgbnVsbCwgbnVsbCwgbnVsbCwgbnVsbCwgbnVsbCwgbnVsbCwgbnVsbF0pXTtcbiAgfVxuICByZXR1cm4gbGluZXMubWFwKCgvKiogQHR5cGUge2FueX0gKi8gbCwgLyoqIEB0eXBlIHtudW1iZXJ9ICovIGlkeCkgPT5cbiAgICBoZWFkZXIuY29uY2F0KFtcbiAgICAgIGlkeCxcbiAgICAgIGwgPyBsLmNvZGUgOiBudWxsLFxuICAgICAgbCA/IGwuZGVzYyA6IG51bGwsXG4gICAgICBsID8gbC5xdHkgOiBudWxsLFxuICAgICAgbCA/IGwucHJlY2lvIDogbnVsbCxcbiAgICAgIGwgPyBsLmNhdCA6IG51bGwsXG4gICAgICBsID8gbC5mYW0gOiBudWxsLFxuICAgICAgbCA/IGwuc3ViIDogbnVsbCxcbiAgICBdKVxuICApO1xufVxuXG4vKiogQHBhcmFtIHthbnl9IGRvYyBAcmV0dXJucyB7dW5rbm93bltdW119ICovXG5leHBvcnQgZnVuY3Rpb24gYnVpbGRWaXNpdGFSb3dzKGRvYykge1xuICByZXR1cm4gW1xuICAgIFtcbiAgICAgIGRvYy5faWQsXG4gICAgICBkb2Mub3duZXJVaWQsXG4gICAgICBkb2Mub3duZXJFbWFpbCxcbiAgICAgIGRvYy5mZWNoYSxcbiAgICAgIGRvYy5tZXMsXG4gICAgICBkb2MuYW5pbyxcbiAgICAgIGRvYy52ZW5kb3IsXG4gICAgICBkb2MucHJvdmluY2lhLFxuICAgICAgZG9jLmxvY2FsaWRhZCxcbiAgICAgIGRvYy50aWVuZGEsXG4gICAgICBkb2MudGlwbyxcbiAgICAgIGRvYy5sb2NhbCxcbiAgICAgIGRvYy50YW1hbm8sXG4gICAgICBkb2MuZmlkZWxpZGFkLFxuICAgICAgZG9jLnJlbGV2YW5jaWEsXG4gICAgICBkb2MucG9wLFxuICAgICAgZG9jLm5lY2VzaWRhZFB1bnR1YWwsXG4gICAgICBkb2MudGlwb1ZlbnRhLFxuICAgICAgZG9jLnBvbmRlcmFjaW9uTW9zdHJhZG8sXG4gICAgICBkb2MucG9uZGVyYWNpb25FY29tbWVyY2UsXG4gICAgICBkb2MuY29tcGV0ZW5jaWEsXG4gICAgICBkb2Mub3BvcnR1bmlkYWQsXG4gICAgICBkb2MubWFzVmVuZGlkbyxcbiAgICAgIGRvYy5tYXNQcmVndW50YW4sXG4gICAgICBkb2MuYXl1ZGFUaWVuZGEsXG4gICAgICBkb2MuZ3BzU3RhdHVzLFxuICAgICAgZG9jLmdwc0Rpc3RhbmNlTSxcbiAgICAgIGRvYy5pbnRlcmFjdGlvblR5cGUsXG4gICAgICBkb2MuZm9ybWFDb250YWN0byxcbiAgICAgIGRvYy5jb250YWN0b1Jlc3VsdGFkbyxcbiAgICAgIGRvYy5jb250YWN0b1Jlc3VsdGFkb0F0LFxuICAgICAgZG9jLmNvbnRhY3RvUmVzdWx0YWRvQnksXG4gICAgICBkb2MuY3JlYXRlZEF0LFxuICAgIF0sXG4gIF07XG59XG5cbi8qKiBAcGFyYW0ge2FueX0gZG9jIEByZXR1cm5zIHt1bmtub3duW11bXX0gKi9cbmV4cG9ydCBmdW5jdGlvbiBidWlsZENsaWVudGVSb3dzKGRvYykge1xuICByZXR1cm4gW1xuICAgIFtcbiAgICAgIGRvYy5faWQsXG4gICAgICBkb2Mub3duZXJVaWQsXG4gICAgICBkb2Mub3duZXJFbWFpbCxcbiAgICAgIGRvYy5vd25lck5hbWUsXG4gICAgICBkb2MuY29tZXJjaW8sXG4gICAgICBkb2MuZmFudGFzaWEsXG4gICAgICBkb2MuY3VpdCxcbiAgICAgIGRvYy5jb25kaWNpb25GaXNjYWwsXG4gICAgICBkb2MuY2FsbGUsXG4gICAgICBkb2MubnVtZXJvLFxuICAgICAgZG9jLmxvY2FsaWRhZCxcbiAgICAgIGRvYy5wcm92aW5jaWEsXG4gICAgICBkb2MubG9jYWxpZGFkRmluYWwsXG4gICAgICBkb2MuY2FyZENvZGVTYXAsXG4gICAgICBkb2MuYXNzaWduZWRWZW5kb3IsXG4gICAgICBkb2Muc3RhdHVzLFxuICAgICAgZG9jLnNvdXJjZSxcbiAgICAgIGRvYy5tYW51YWxTYXBQZW5kaW5nLFxuICAgICAgZG9jLnByZWNhdWNpb24sXG4gICAgICBkb2MuY2F0ZWdvcmlhQ2xpZW50ZSxcbiAgICAgIGRvYy5jbGlUaXBvLFxuICAgICAgZG9jLmxhdCxcbiAgICAgIGRvYy5sbmcsXG4gICAgICBkb2MubGF0ICE9IG51bGwgJiYgZG9jLmxuZyAhPSBudWxsLFxuICAgICAgISEoZG9jLmNhbGxlIHx8IGRvYy5hZGRyZXNzKSxcbiAgICAgIGRvYy5zdWJtaXR0ZWRCeVB1YmxpY0Zvcm0sXG4gICAgICBkb2MuYXBwcm92ZWRBdCxcbiAgICAgIGRvYy5jcmVhdGVkQXQsXG4gICAgICBkb2MudXBkYXRlZEF0LFxuICAgIF0sXG4gIF07XG59XG5cbi8qKiBAcGFyYW0ge2FueX0gZG9jIEByZXR1cm5zIHt1bmtub3duW11bXX0gKi9cbmV4cG9ydCBmdW5jdGlvbiBidWlsZENsaWVudE1hc3RlclJvd3MoZG9jKSB7XG4gIHJldHVybiBbXG4gICAgW1xuICAgICAgZG9jLl9pZCxcbiAgICAgIGRvYy5jbGllbnROYW1lLFxuICAgICAgZG9jLnByb3ZpbmNpYSxcbiAgICAgIGRvYy5sb2NhbGlkYWQsXG4gICAgICBkb2MudmVuZG9yLFxuICAgICAgZG9jLmFkZHJlc3MsXG4gICAgICBkb2Muc2FwQ2FyZENvZGUsXG4gICAgICBkb2Muc2FwQWRkcmVzcyxcbiAgICAgIGRvYy5zYXBDaXR5LFxuICAgICAgZG9jLnNhcFN0YXRlLFxuICAgICAgZG9jLnNhcEltcG9ydGVkQXQsXG4gICAgICBkb2Muc2FwSW1wb3J0ZWRCeSxcbiAgICAgIGRvYy5jbGllbnROYW1lT3JpZ2luYWwsXG4gICAgICBkb2MubG9jYWxpZGFkT3JpZ2luYWwsXG4gICAgICBkb2MubWF0Y2hUeXBlLFxuICAgICAgZG9jLm1hdGNoU2ltaWxhcml0eSxcbiAgICAgIGRvYy51cGRhdGVkQXQsXG4gICAgICBkb2MudXBkYXRlZEJ5LFxuICAgIF0sXG4gIF07XG59XG5cbi8qKiBAcGFyYW0ge2FueX0gZG9jIEByZXR1cm5zIHt1bmtub3duW11bXX0gKi9cbmV4cG9ydCBmdW5jdGlvbiBidWlsZFJlbmRpY2lvblJvd3MoZG9jKSB7XG4gIHJldHVybiBbXG4gICAgW1xuICAgICAgZG9jLl9pZCxcbiAgICAgIGRvYy5vd25lclVpZCxcbiAgICAgIGRvYy5vd25lckVtYWlsLFxuICAgICAgZG9jLnZlbmRvcixcbiAgICAgIGRvYy50aXBvLFxuICAgICAgZG9jLnRpcG9HYXN0byxcbiAgICAgIGRvYy5pbXBvcnRlQXJzICE9IG51bGwgPyBkb2MuaW1wb3J0ZUFycyA6IGRvYy5pbXBvcnRlLFxuICAgICAgZG9jLmZlY2hhR2FzdG8sXG4gICAgICBkb2MuY29uY2VwdG8sXG4gICAgICAvLyBmb3RvVGlja2V0VXJsICh2MzA4KykgcHJpb3JpZGFkOyBOVU5DQSBleHBvcnRhciBiYXNlNjQgZm90b1RpY2tldCBsZWdhY3lcbiAgICAgIGRvYy5mb3RvVGlja2V0VXJsIHx8IG51bGwsXG4gICAgICBkb2Muc3RhdHVzLFxuICAgICAgZG9jLmFwcHJvdmVkQnksXG4gICAgICBkb2MuYXBwcm92ZWRBdCxcbiAgICAgIGRvYy5yZWplY3RlZEJ5RW1haWwsXG4gICAgICBkb2MucmVqZWN0ZWRSZWFzb24sXG4gICAgICBkb2MuYXBwcm92ZXJVaWQsXG4gICAgICBkb2MuY3JlYXRlZEF0LFxuICAgIF0sXG4gIF07XG59XG5cbi8qKiBAcGFyYW0ge2FueX0gZG9jIEByZXR1cm5zIHt1bmtub3duW11bXX0gKi9cbmV4cG9ydCBmdW5jdGlvbiBidWlsZENhbXBhbmlhUm93cyhkb2MpIHtcbiAgcmV0dXJuIFtcbiAgICBbXG4gICAgICBkb2MuX2lkLFxuICAgICAgZG9jLm5hbWUsXG4gICAgICBkb2MuZmFtaWxpYSxcbiAgICAgIGRvYy5zdWJmYW1pbGlhLFxuICAgICAgZG9jLmZpbHRlclR5cGUsXG4gICAgICBkb2MuZmlsdGVyVmFsdWVzLFxuICAgICAgZG9jLnNrdXMsXG4gICAgICBBcnJheS5pc0FycmF5KGRvYy5za3VzKSA/IGRvYy5za3VzLmxlbmd0aCA6IDAsXG4gICAgICBkb2MudGFyZ2V0VHlwZSxcbiAgICAgIGRvYy50YXJnZXRBbW91bnQsXG4gICAgICBkb2Muc3RhcnREYXRlLFxuICAgICAgZG9jLmVuZERhdGUsXG4gICAgICBkb2Muc2NvcGUsXG4gICAgICBkb2Muc2NvcGVWYWx1ZXMsXG4gICAgICBkb2MuY3JlYXRlZEJ5LFxuICAgICAgZG9jLmNyZWF0ZWRCeUVtYWlsLFxuICAgICAgZG9jLmNyZWF0ZWRBdCxcbiAgICAgIGRvYy5hcmNoaXZlZE1hbnVhbGx5LFxuICAgICAgZG9jLmFyY2hpdmVkQXQsXG4gICAgICBkb2MuYXJjaGl2ZWRCeSxcbiAgICBdLFxuICBdO1xufVxuXG4vKiogQHBhcmFtIHthbnl9IGRvYyBAcmV0dXJucyB7dW5rbm93bltdW119ICovXG5leHBvcnQgZnVuY3Rpb24gYnVpbGRUYXJnZXRSb3dzKGRvYykge1xuICByZXR1cm4gW1xuICAgIFtcbiAgICAgIGRvYy5faWQsXG4gICAgICBkb2Muc2VsbGVySWQsXG4gICAgICBkb2MueWVhcixcbiAgICAgIGRvYy5tb250aCxcbiAgICAgIGRvYy50YXJnZXRBcnMsXG4gICAgICBkb2MudGFyZ2V0QnlGYW1pbHkgPyBkb2MudGFyZ2V0QnlGYW1pbHkuUkVFTCA6IG51bGwsXG4gICAgICBkb2MudGFyZ2V0QnlGYW1pbHkgPyBkb2MudGFyZ2V0QnlGYW1pbHkuQ0FOQVMgOiBudWxsLFxuICAgICAgZG9jLnRhcmdldEJ5RmFtaWx5ID8gZG9jLnRhcmdldEJ5RmFtaWx5LkxJTkVBUyA6IG51bGwsXG4gICAgICBkb2MudXBkYXRlZEF0LFxuICAgICAgZG9jLnVwZGF0ZWRCeSxcbiAgICAgIGRvYy51cGRhdGVkQnlFbWFpbCxcbiAgICBdLFxuICBdO1xufVxuXG4vKiogQHBhcmFtIHthbnl9IGRvYyBAcmV0dXJucyB7dW5rbm93bltdW119ICovXG5leHBvcnQgZnVuY3Rpb24gYnVpbGRWZW5kb3JPdmVycmlkZVJvd3MoZG9jKSB7XG4gIHJldHVybiBbXG4gICAgW1xuICAgICAgZG9jLl9pZCxcbiAgICAgIGRvYy5zY29wZSxcbiAgICAgIGRvYy5wcm92aW5jZSxcbiAgICAgIGRvYy5sb2NhbGl0eU5hbWUsXG4gICAgICBkb2MuY2xpZW50TmFtZSxcbiAgICAgIGRvYy5vcmlnaW5hbFZlbmRvcixcbiAgICAgIGRvYy5uZXdWZW5kb3IsXG4gICAgICBkb2MubmV3VHlwZSxcbiAgICAgIGRvYy51cGRhdGVkQXQsXG4gICAgICBkb2MudXBkYXRlZEJ5VWlkLFxuICAgICAgZG9jLnVwZGF0ZWRCeUVtYWlsLFxuICAgICAgZG9jLnVwZGF0ZWRCeURpc3BsYXlOYW1lLFxuICAgIF0sXG4gIF07XG59XG5cbi8qKiBAcGFyYW0ge2FueX0gZG9jIEByZXR1cm5zIHt1bmtub3duW11bXX0gKi9cbmV4cG9ydCBmdW5jdGlvbiBidWlsZEN1c3RvbVJvdXRlUm93cyhkb2MpIHtcbiAgY29uc3QgaGVhZGVyID0gW1xuICAgIGRvYy5faWQsXG4gICAgZG9jLm93bmVyVWlkLFxuICAgIGRvYy5vd25lckVtYWlsLFxuICAgIGRvYy5uYW1lLFxuICAgIGRvYy5wbGFubmVkRGF0ZSxcbiAgICBkb2Mubm90ZXMsXG4gICAgZG9jLmNyZWF0ZWRBdCxcbiAgICBkb2MudXBkYXRlZEF0LFxuICBdO1xuICBjb25zdCBzdG9wcyA9IEFycmF5LmlzQXJyYXkoZG9jLnN0b3BzKSA/IGRvYy5zdG9wcyA6IFtdO1xuICBpZiAoIXN0b3BzLmxlbmd0aCkge1xuICAgIHJldHVybiBbaGVhZGVyLmNvbmNhdChbbnVsbCwgbnVsbCwgbnVsbCwgbnVsbCwgbnVsbCwgbnVsbCwgbnVsbCwgbnVsbF0pXTtcbiAgfVxuICByZXR1cm4gc3RvcHMubWFwKCgvKiogQHR5cGUge2FueX0gKi8gcykgPT5cbiAgICBoZWFkZXIuY29uY2F0KFtcbiAgICAgIHMgPyBzLm9yZGVyIDogbnVsbCxcbiAgICAgIHMgPyBzLmtleSA6IG51bGwsXG4gICAgICBzID8gcy50aXBvIDogbnVsbCxcbiAgICAgIHMgPyBzLnByb3ZpbmNpYSA6IG51bGwsXG4gICAgICBzID8gcy5sb2NhbGlkYWQgOiBudWxsLFxuICAgICAgcyA/IHMuY2xpZW50TmFtZSA6IG51bGwsXG4gICAgICBzID8gcy5pc1Byb3Zpc29yaW8gOiBudWxsLFxuICAgICAgcyA/IHMuc2FwQWx0YUlkIDogbnVsbCxcbiAgICBdKVxuICApO1xufVxuXG4vKiogQHBhcmFtIHthbnl9IGRvYyBAcmV0dXJucyB7dW5rbm93bltdW119ICovXG5leHBvcnQgZnVuY3Rpb24gYnVpbGRTZWd1aW1pZW50b05vdGVSb3dzKGRvYykge1xuICByZXR1cm4gW1xuICAgIFtcbiAgICAgIGRvYy5faWQsXG4gICAgICBkb2MudmVuZG9yRXh0LFxuICAgICAgZG9jLmNsaWVudEtleSxcbiAgICAgIGRvYy5jbGllbnROYW1lLFxuICAgICAgZG9jLnByb3ZpbmNlLFxuICAgICAgZG9jLmxvY2FsaXR5LFxuICAgICAgZG9jLnRleHQsXG4gICAgICBkb2MuYXV0aG9yVWlkLFxuICAgICAgZG9jLmF1dGhvckVtYWlsLFxuICAgICAgZG9jLmF1dGhvck5hbWUsXG4gICAgICBkb2MuYXV0aG9yUm9sZSxcbiAgICAgIGRvYy5jcmVhdGVkQXQsXG4gICAgXSxcbiAgXTtcbn1cblxuLyoqXG4gKiBQcm9kdWN0b3MgZGVzZGUgc3RvY2suanNvbiAoZm9ybWF0byBTaGltYW5vOiB7c3RvY2s6IHtTS1U6IGJvb2wsIC4uLn0sXG4gKiBxdWFudGl0aWVzOiBKU09OIHN0cmluZywgd2FyZWhvdXNlQnJlYWtkb3duOiBKU09OIHN0cmluZywgdXBkYXRlZEF0OiAuLi59KS5cbiAqIEBwYXJhbSB7b2JqZWN0fSBzdG9ja0pzb25cbiAqIEByZXR1cm5zIHt1bmtub3duW11bXX1cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGJ1aWxkUHJvZHVjdG9Sb3dzRnJvbVN0b2NrSnNvbihzdG9ja0pzb24pIHtcbiAgY29uc3Qgc2ogPSAvKiogQHR5cGUge2FueX0gKi8gKHN0b2NrSnNvbikgfHwge307XG4gIGNvbnN0IHN0b2NrTWFwID0gc2ouc3RvY2sgfHwge307XG4gIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgbnVtYmVyPn0gKi9cbiAgbGV0IHF1YW50aXRpZXMgPSB7fTtcbiAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZWNvcmQ8c3RyaW5nLCBudW1iZXI+Pn0gKi9cbiAgbGV0IGJyZWFrZG93biA9IHt9O1xuICB0cnkge1xuICAgIHF1YW50aXRpZXMgPSBzai5xdWFudGl0aWVzID8gSlNPTi5wYXJzZShzai5xdWFudGl0aWVzKSA6IHNqLnF1YW50aXRpZXNfbWFwIHx8IHt9O1xuICB9IGNhdGNoIChfKSB7fVxuICB0cnkge1xuICAgIGJyZWFrZG93biA9IHNqLndhcmVob3VzZUJyZWFrZG93blxuICAgICAgPyBKU09OLnBhcnNlKHNqLndhcmVob3VzZUJyZWFrZG93bilcbiAgICAgIDogc2oud2FyZWhvdXNlQnJlYWtkb3duX21hcCB8fCB7fTtcbiAgfSBjYXRjaCAoXykge31cbiAgY29uc3Qgcm93cyA9IC8qKiBAdHlwZSB7dW5rbm93bltdW119ICovIChbXSk7XG4gIGNvbnN0IHNvdXJjZSA9ICdzdG9jay5qc29uIHNuYXBzaG90JztcbiAgY29uc3QgdXBkYXRlZEF0ID0gc2oudXBkYXRlZEF0IHx8IHNqLnNuYXBzaG90QXQgfHwgbnVsbDtcbiAgZm9yIChjb25zdCBza3Ugb2YgT2JqZWN0LmtleXMoc3RvY2tNYXApKSB7XG4gICAgY29uc3QgaGFzX3N0b2NrID0gISFzdG9ja01hcFtza3VdO1xuICAgIGNvbnN0IHRvdGFsID0gTnVtYmVyKHF1YW50aXRpZXNbc2t1XSB8fCAwKTtcbiAgICBjb25zdCB3YnMgPSBicmVha2Rvd25bc2t1XSB8fCB7fTtcbiAgICBjb25zdCB3MTEgPSBOdW1iZXIod2JzWycxMSddIHx8IDApO1xuICAgIGNvbnN0IHcxMiA9IE51bWJlcih3YnNbJzEyJ10gfHwgMCk7XG4gICAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBudW1iZXI+fSAqL1xuICAgIGNvbnN0IG90cm9zID0ge307XG4gICAgZm9yIChjb25zdCBrIG9mIE9iamVjdC5rZXlzKHdicykpIHtcbiAgICAgIGlmIChrICE9PSAnMTEnICYmIGsgIT09ICcxMicpIG90cm9zW2tdID0gTnVtYmVyKHdic1trXSB8fCAwKTtcbiAgICB9XG4gICAgcm93cy5wdXNoKFtcbiAgICAgIHNrdSxcbiAgICAgIGhhc19zdG9jayxcbiAgICAgIHRvdGFsLFxuICAgICAgdzExLFxuICAgICAgdzEyLFxuICAgICAgT2JqZWN0LmtleXMob3Ryb3MpLmxlbmd0aCA/IG90cm9zIDogbnVsbCxcbiAgICAgIHNvdXJjZSxcbiAgICAgIHVwZGF0ZWRBdCxcbiAgICBdKTtcbiAgfVxuICByZXR1cm4gcm93cztcbn1cblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBEaXNwYXRjaGVyOiBtYXBhIGNvbGxlY3Rpb24gLT4gcm93IGJ1aWxkZXJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4vLyB2NzMyOiBidWlsZGVycyBwYXJhIGxvcyAzIHNuYXBzaG90cyBCUS0+RmlyZXN0b3JlLlxuXG4vKiogQHBhcmFtIHthbnl9IGRvYyBAcmV0dXJucyB7dW5rbm93bltdW119ICovXG5leHBvcnQgZnVuY3Rpb24gYnVpbGRTYXBTbmFwc2hvdFJvd3MoZG9jKSB7XG4gIHJldHVybiBbXG4gICAgW1xuICAgICAgZG9jLl9pZCxcbiAgICAgIGRvYy52ZW5kb3JLZXksXG4gICAgICBkb2MuYW5pbyxcbiAgICAgIGRvYy5tZXMsXG4gICAgICBkb2MuZmFjdHVyYWRvQXJzTmV0byxcbiAgICAgIGRvYy5mYWN0dXJhZG9BcnNCcnV0byxcbiAgICAgIGRvYy5uY3NBcnMsXG4gICAgICBkb2MuZmFjdHVyYXNDb3VudCxcbiAgICAgIGRvYy5uY3NDb3VudCxcbiAgICAgIGRvYy51bmlkYWRlc05ldG8sXG4gICAgICBkb2MuaW1wb3J0ZUxpbmVhc0Fyc05ldG8sXG4gICAgICBkb2MudXBkYXRlZEF0LFxuICAgIF0sXG4gIF07XG59XG5cbi8qKiBAcGFyYW0ge2FueX0gZG9jIEByZXR1cm5zIHt1bmtub3duW11bXX0gKi9cbmV4cG9ydCBmdW5jdGlvbiBidWlsZEZhY3R1cmFjaW9uU25hcHNob3RSb3dzKGRvYykge1xuICByZXR1cm4gW1tkb2MuX2lkLCBkb2MudmVuZG9yS2V5LCBkb2MuaG95QXJzLCBkb2MubWVzQXJzLCBkb2MuYW5vQXJzLCBkb2MudXBkYXRlZEF0XV07XG59XG5cbi8qKiBAcGFyYW0ge2FueX0gZG9jIEByZXR1cm5zIHt1bmtub3duW11bXX0gKi9cbmV4cG9ydCBmdW5jdGlvbiBidWlsZEJhY2tvcmRlclNuYXBzaG90Um93cyhkb2MpIHtcbiAgY29uc3QgaGVhZGVyID0gW2RvYy5faWQsIGRvYy52ZW5kb3JLZXksIGRvYy5saW5lc0NvdW50LCBkb2MudXBkYXRlZEF0XTtcbiAgY29uc3QgbGluZXMgPSBBcnJheS5pc0FycmF5KGRvYy5saW5lcykgPyBkb2MubGluZXMgOiBbXTtcbiAgaWYgKCFsaW5lcy5sZW5ndGgpIHtcbiAgICByZXR1cm4gW1xuICAgICAgaGVhZGVyLmNvbmNhdChbXG4gICAgICAgIG51bGwsXG4gICAgICAgIG51bGwsXG4gICAgICAgIG51bGwsXG4gICAgICAgIG51bGwsXG4gICAgICAgIG51bGwsXG4gICAgICAgIG51bGwsXG4gICAgICAgIG51bGwsXG4gICAgICAgIG51bGwsXG4gICAgICAgIG51bGwsXG4gICAgICAgIG51bGwsXG4gICAgICAgIG51bGwsXG4gICAgICAgIG51bGwsXG4gICAgICAgIG51bGwsXG4gICAgICAgIG51bGwsXG4gICAgICBdKSxcbiAgICBdO1xuICB9XG4gIHJldHVybiBsaW5lcy5tYXAoKC8qKiBAdHlwZSB7YW55fSAqLyBsKSA9PlxuICAgIGhlYWRlci5jb25jYXQoW1xuICAgICAgbCA/IGwuc2t1IDogbnVsbCxcbiAgICAgIGwgPyBsLnByb2R1Y3RvIDogbnVsbCxcbiAgICAgIGwgPyBsLmZhbWlsaWEgOiBudWxsLFxuICAgICAgbCA/IGwuc3ViZmFtaWxpYSA6IG51bGwsXG4gICAgICBsID8gbC5wZW5kaWVudGUgOiBudWxsLFxuICAgICAgbCA/IGwucGVkaWRvIDogbnVsbCxcbiAgICAgIGwgPyBsLnN0b2NrQWN0dWFsIDogbnVsbCxcbiAgICAgIGwgPyBsLnByZWNpb1VuaXRhcmlvIDogbnVsbCxcbiAgICAgIGwgPyBsLmNsaWVudGVDb2RlIDogbnVsbCxcbiAgICAgIGwgPyBsLmNsaWVudGVOb21icmUgOiBudWxsLFxuICAgICAgbCA/IGwuY2xpZW50ZUNpdWRhZCA6IG51bGwsXG4gICAgICBsID8gbC5zcURvY051bSA6IG51bGwsXG4gICAgICBsID8gbC5zcURvY0RhdGUgOiBudWxsLFxuICAgICAgbCA/IGwuZXN0YWRvIDogbnVsbCxcbiAgICBdKVxuICApO1xufVxuXG4vKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIChkb2M6IGFueSkgPT4gdW5rbm93bltdW10+fSAqL1xuZXhwb3J0IGNvbnN0IFJPV19CVUlMREVSUyA9IHtcbiAgcGVkaWRvczogYnVpbGRQZWRpZG9Sb3dzLFxuICB2aXNpdGFzOiBidWlsZFZpc2l0YVJvd3MsXG4gIGNsaWVudGVzOiBidWlsZENsaWVudGVSb3dzLFxuICBjbGllbnRfbWFzdGVyOiBidWlsZENsaWVudE1hc3RlclJvd3MsXG4gIHJlbmRpY2lvbmVzOiBidWlsZFJlbmRpY2lvblJvd3MsXG4gIGNhbXBhbmlhczogYnVpbGRDYW1wYW5pYVJvd3MsXG4gIHRhcmdldHM6IGJ1aWxkVGFyZ2V0Um93cyxcbiAgdmVuZG9yX292ZXJyaWRlczogYnVpbGRWZW5kb3JPdmVycmlkZVJvd3MsXG4gIGN1c3RvbV9yb3V0ZXM6IGJ1aWxkQ3VzdG9tUm91dGVSb3dzLFxuICBzZWd1aW1pZW50b19ub3RlczogYnVpbGRTZWd1aW1pZW50b05vdGVSb3dzLFxuICAvLyB2NzMyOiAzIHNuYXBzaG90cyBCUS0+RmlyZXN0b3JlLlxuICBzYXBfc25hcHNob3Q6IGJ1aWxkU2FwU25hcHNob3RSb3dzLFxuICBmYWN0dXJhY2lvbl9zbmFwc2hvdDogYnVpbGRGYWN0dXJhY2lvblNuYXBzaG90Um93cyxcbiAgYmFja29yZGVyX3NuYXBzaG90OiBidWlsZEJhY2tvcmRlclNuYXBzaG90Um93cyxcbn07XG4iLCAiLy8gQHRzLW5vY2hlY2tcbi8vIEVYUE9SVFMtQURWQU5DRUQ6IHBob3RvIFpJUHMsIGF1ZGl0IFhMU1gsIGV4ZWN1dGl2ZSBzdW1tYXJ5LCB2aXNpdHMgWExTWCxcbi8vIFBvd2VyQkkgZGF0YXNldCwgTUwgZGF0YXNldC4gRXh0cmFcdTAwRURkbyB2ZXJiYXRpbSBkZSBpbmRleC5odG1sICg0IGZyYWdtZW50b3Ncbi8vIGRpc2NvbnRpbnVvcyBzZXBhcmFkb3MgcG9yIEJhY2t1cCArIEF1ZGl0ICsgX2V4cG9ydExlZ2FjeUZ1bGwgcXVlIHF1ZWRhblxuLy8gZW4gZWwgaW5saW5lKSBjb21vIHBhcnRlIGRlIEUyLm4uMiAoZTJiLXBlcmYgMjAyNi0wNy0yOCkuXG4vL1xuLy8gdjM3MSs6IGV4cG9ydERhdGFzZXRaaXAoKSBudWV2byBcdTIwMTQgWklQIGNvbiBDU1ZzIHBvciBlbnRpZGFkIHBhcmEgcGlwZWxpbmVzXG4vLyBNTCBleHRlcm5vcyAoTWljcm9zb2Z0IEZhYnJpYykuIEltcG9ydGEgbG9zIGhlbHBlcnMgcHVyb3MgeSBzY2hlbWFzIGRlbFxuLy8gbW9kdWxvIHNyYy9wdXJlL2Nzdi1zZXJpYWxpemVyLmpzLiBWZXIgcGxhbiBjb3NtaWMtcG9uZGVyaW5nLXN0ZWFybnMubWQuXG5cbmltcG9ydCB7XG4gIGJ1aWxkQ3N2LFxuICBidWlsZFByb2R1Y3RvUm93c0Zyb21TdG9ja0pzb24sXG4gIGNvbXB1dGVOdWxsUmF0ZXMsXG4gIERBVEFTRVRfU0NIRU1BUyxcbiAgREFUQVNFVF9VU0VfQ0FTRV9NQVRSSVgsXG4gIFJPV19CVUlMREVSUyxcbn0gZnJvbSAnLi4vcHVyZS9jc3Ytc2VyaWFsaXplci5qcyc7XG5cbi8vXG4vLyBEZXBzIGRlbCBpbmxpbmU6IEpTWmlwIChDRE4gbGF6eSksIEV4Y2VsSlMgKENETiBsYXp5IHZpYSBsb2FkRXhjZWxKUyksXG4vLyBYTFNYIChkZWZlciBlbiBoZWFkKSwgdmlzaXRzQ2FjaGUsIGNhbXBhaWduc0NhY2hlLCBvcHNMb2dDYWNoZSAoYXVkaXRcbi8vIGlubGluZSksIGF1ZGl0TG9nQ2FjaGUgKGF1ZGl0IGlubGluZSksIGNvbnRhY3RlZCAoZ2xvYmFsIFNldCksIFBPSU5UUyxcbi8vIFBST0RVQ1RTLCBWRU5ET1JTLCBNRVNFUywgdmVuZG9yTG9va3VwLCBlc2NhcGVIdG1sLCBlc2NhcGVBdHRyLCB0aXRsZUNhc2UsXG4vLyBzaG93U3luY1RhZywgY3VycmVudFVzZXIsIHVzZXJSb2xlLCBvcmRlcnMsIGNvbmZpcm1lZCwgcGVuZGluZy5cbi8vXG4vLyBDcm9zcy1zY29wZSBzdGF0ZTogTk9ORSAodG9kb3MgbG9zIGhlbHBlcnMgeSBjb25zdHMgbG9jYWxlcyBhbCBibG9xdWUpLlxuLy8gU2luIGxpc3RlbmVycyBvblNuYXBzaG90LlxuLy9cbi8vIE5PVEE6IGxvcyBoZWxwZXJzIHRvZGF5U3RyL2RhdGFVcmxUb0Jsb2Ivc2FuaXRpemVGb3JQYXRoIHZpdmVuIGVuIGVzdGVcbi8vIG1cdTAwRjNkdWxvIFx1MjAxNCBlbCBpbmxpbmUgcHVlZGUgbGxhbWFybG9zIHZpYSBmcmVlIHJlZmVyZW5jZSBhbCBHbG9iYWwgRW52aXJvbm1lbnRcbi8vIFJlY29yZCBwZXJvIHByZWZlcmltb3MgZXhwb3NpY2lcdTAwRjNuIHdpbmRvdy4qIGV4cGxcdTAwRURjaXRhIGFsIGZpbmFsLlxuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gU0VDQ0lcdTAwRDNOOiBoZWxwZXJzICsgcGhvdG9zIHppcCArIHZpc2l0cyBlbWJlZGRlZCAoaW5saW5lIEw5MjU2LTk0NDUpXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuZnVuY3Rpb24gdG9kYXlTdHIoKSB7XG4gIHJldHVybiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwgMTApO1xufVxuXG4vLyBIZWxwZXI6IGNvbnZlcnRpciBkYXRhVVJMIGJhc2U2NCBhIEJsb2IgcGFyYSBpbmNsdWlyIGVuIFpJUFxuZnVuY3Rpb24gZGF0YVVybFRvQmxvYihkYXRhVXJsKSB7XG4gIGlmICghZGF0YVVybCkgcmV0dXJuIG51bGw7XG4gIGNvbnN0IHBhcnRzID0gZGF0YVVybC5zcGxpdCgnLCcpO1xuICBpZiAocGFydHMubGVuZ3RoIDwgMikgcmV0dXJuIG51bGw7XG4gIGNvbnN0IG1pbWVNYXRjaCA9IHBhcnRzWzBdLm1hdGNoKC86KC4qPyk7Lyk7XG4gIGNvbnN0IG1pbWUgPSBtaW1lTWF0Y2ggPyBtaW1lTWF0Y2hbMV0gOiAnaW1hZ2UvanBlZyc7XG4gIGNvbnN0IGJ5dGVzID0gYXRvYihwYXJ0c1sxXSk7XG4gIGNvbnN0IGFyciA9IG5ldyBVaW50OEFycmF5KGJ5dGVzLmxlbmd0aCk7XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgYnl0ZXMubGVuZ3RoOyBpKyspIGFycltpXSA9IGJ5dGVzLmNoYXJDb2RlQXQoaSk7XG4gIHJldHVybiBuZXcgQmxvYihbYXJyXSwgeyB0eXBlOiBtaW1lIH0pO1xufVxuXG4vLyBTYW5lYXIgbm9tYnJlcyBwYXJhIHF1ZSBzaXJ2YW4gY29tbyBydXRhIGRlIGFyY2hpdm9cbmZ1bmN0aW9uIHNhbml0aXplRm9yUGF0aChzKSB7XG4gIHJldHVybiBTdHJpbmcocyB8fCAnJylcbiAgICAucmVwbGFjZSgvW1xcXFwvKj9bXFxdOnxcIjw+XS9nLCAnXycpXG4gICAgLnJlcGxhY2UoL1xccysvZywgJyAnKVxuICAgIC50cmltKClcbiAgICAuc2xpY2UoMCwgNjApO1xufVxuXG4vLyBEZXNjYXJnYXIgdG9kYXMgbGFzIGZvdG9zIGRlIHZpc2l0YXMgZW4gdW4gWklQIG9yZ2FuaXphZG8gcG9yIHZlbmRlZG9yIC8gdGllbmRhIC8gZmVjaGFcbndpbmRvdy5leHBvcnRQaG90b3NaaXAgPSBhc3luYyBmdW5jdGlvbiAoKSB7XG4gIC8vIHY2NzkgUEVSRiBGYXNlIDM6IEpTWmlwIGxhenkgb24tZGVtYW5kXG4gIHRyeSB7XG4gICAgYXdhaXQgd2luZG93LmxvYWRKU1ppcCgpO1xuICB9IGNhdGNoIChlKSB7XG4gICAgYWxlcnQoJ05vIHNlIHB1ZG8gY2FyZ2FyIEpTWmlwOiAnICsgZS5tZXNzYWdlKTtcbiAgICByZXR1cm47XG4gIH1cbiAgaWYgKCF2aXNpdHNDYWNoZSB8fCAhdmlzaXRzQ2FjaGUubGVuZ3RoKSB7XG4gICAgYWxlcnQoJ05vIGhheSB2aXNpdGFzIHJlZ2lzdHJhZGFzLicpO1xuICAgIHJldHVybjtcbiAgfVxuICBsZXQgcGhvdG9Db3VudCA9IDA7XG4gIGNvbnN0IHppcCA9IG5ldyBKU1ppcCgpO1xuICB2aXNpdHNDYWNoZS5mb3JFYWNoKCh2KSA9PiB7XG4gICAgY29uc3QgdmVuZG9yID0gc2FuaXRpemVGb3JQYXRoKHRpdGxlQ2FzZSh2LnZlbmRvciB8fCAnU0lOX1ZFTkRFRE9SJykpO1xuICAgIGNvbnN0IHRpZW5kYSA9IHNhbml0aXplRm9yUGF0aCh2LnRpZW5kYSB8fCAnc2luX3RpZW5kYScpO1xuICAgIGNvbnN0IGZlY2hhID0gKHYuZmVjaGEgfHwgJycpLnJlcGxhY2UoLy0vZywgJycpO1xuICAgIGNvbnN0IGZvbGRlck5hbWUgPSB2ZW5kb3IgKyAnLycgKyB0aWVuZGEgKyAnXycgKyBmZWNoYTtcbiAgICBjb25zdCBmb2xkZXIgPSB6aXAuZm9sZGVyKGZvbGRlck5hbWUpO1xuICAgIGlmICh2LmZyZW50ZUxvY2FsKSB7XG4gICAgICBjb25zdCBiID0gZGF0YVVybFRvQmxvYih2LmZyZW50ZUxvY2FsKTtcbiAgICAgIGlmIChiKSB7XG4gICAgICAgIGZvbGRlci5maWxlKCdmcmVudGUuanBnJywgYik7XG4gICAgICAgIHBob3RvQ291bnQrKztcbiAgICAgIH1cbiAgICB9XG4gICAgKHYuZXNwYWNpbyB8fCBbXSkuZm9yRWFjaCgoYjY0LCBpKSA9PiB7XG4gICAgICBjb25zdCBiID0gZGF0YVVybFRvQmxvYihiNjQpO1xuICAgICAgaWYgKGIpIHtcbiAgICAgICAgZm9sZGVyLmZpbGUoJ2VzcGFjaW9fJyArIChpICsgMSkgKyAnLmpwZycsIGIpO1xuICAgICAgICBwaG90b0NvdW50Kys7XG4gICAgICB9XG4gICAgfSk7XG4gIH0pO1xuICBpZiAoIXBob3RvQ291bnQpIHtcbiAgICBhbGVydCgnTm8gaGF5IGZvdG9zIGNhcmdhZGFzIGVuIGxhcyB2aXNpdGFzLicpO1xuICAgIHJldHVybjtcbiAgfVxuICBzaG93U3luY1RhZygnR2VuZXJhbmRvIFpJUCBkZSAnICsgcGhvdG9Db3VudCArICcgZm90b3MuLi4nLCAzMDAwMCk7XG4gIHRyeSB7XG4gICAgY29uc3QgYmxvYiA9IGF3YWl0IHppcC5nZW5lcmF0ZUFzeW5jKHsgdHlwZTogJ2Jsb2InLCBjb21wcmVzc2lvbjogJ0RFRkxBVEUnIH0pO1xuICAgIGNvbnN0IHVybCA9IFVSTC5jcmVhdGVPYmplY3RVUkwoYmxvYik7XG4gICAgY29uc3QgYSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2EnKTtcbiAgICBhLmhyZWYgPSB1cmw7XG4gICAgYS5kb3dubG9hZCA9ICdTaGltYW5vX0ZvdG9zX1Zpc2l0YXNfJyArIHRvZGF5U3RyKCkgKyAnLnppcCc7XG4gICAgYS5jbGljaygpO1xuICAgIHNldFRpbWVvdXQoKCkgPT4gVVJMLnJldm9rZU9iamVjdFVSTCh1cmwpLCA1MDAwKTtcbiAgICBzaG93U3luY1RhZyhwaG90b0NvdW50ICsgJyBmb3RvcyBkZXNjYXJnYWRhcycsIDMwMDApO1xuICB9IGNhdGNoIChlKSB7XG4gICAgY29uc29sZS5lcnJvcignemlwJywgZSk7XG4gICAgYWxlcnQoJ0Vycm9yIGdlbmVyYW5kbyBaSVA6ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcbiAgfVxufTtcblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBFeGNlbCBjb24gZm90b3MgZGVsIGZyZW50ZSBlbWJlYmlkYXMgZW4gY2FkYSBjZWxkYSAoRXhjZWxKUylcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gRXhjZWxKUyBzZSBjYXJnYSBsYXp5IChzb2xvIGN1YW5kbyBzZSB0b2NhIGVsIGJvdG9uKSBwYXJhIG5vIGluZmxhciBlbCBidW5kbGUuXG5mdW5jdGlvbiBsb2FkRXhjZWxKUygpIHtcbiAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICBpZiAodHlwZW9mIEV4Y2VsSlMgIT09ICd1bmRlZmluZWQnKSByZXR1cm4gcmVzb2x2ZSgpO1xuICAgIGNvbnN0IHMgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdzY3JpcHQnKTtcbiAgICBzLnNyYyA9ICdodHRwczovL2Nkbi5qc2RlbGl2ci5uZXQvbnBtL2V4Y2VsanNANC40LjAvZGlzdC9leGNlbGpzLm1pbi5qcyc7XG4gICAgcy5vbmxvYWQgPSAoKSA9PiByZXNvbHZlKCk7XG4gICAgcy5vbmVycm9yID0gKCkgPT5cbiAgICAgIHJlamVjdChuZXcgRXJyb3IoJ05vIHNlIHB1ZG8gY2FyZ2FyIGxhIGxpYnJlcmlhIEV4Y2VsSlMuIFJldmlzYSB0dSBjb25leGlvbiBhIGludGVybmV0LicpKTtcbiAgICBkb2N1bWVudC5oZWFkLmFwcGVuZENoaWxkKHMpO1xuICB9KTtcbn1cblxud2luZG93LmV4cG9ydFZpc2l0c1dpdGhFbWJlZGRlZFBob3RvcyA9IGFzeW5jIGZ1bmN0aW9uICgpIHtcbiAgaWYgKCF2aXNpdHNDYWNoZSB8fCAhdmlzaXRzQ2FjaGUubGVuZ3RoKSB7XG4gICAgYWxlcnQoJ05vIGhheSB2aXNpdGFzIHJlZ2lzdHJhZGFzLicpO1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCBuID0gdmlzaXRzQ2FjaGUubGVuZ3RoO1xuICBpZiAobiA+IDMwMCkge1xuICAgIGlmIChcbiAgICAgICFjb25maXJtKFxuICAgICAgICAnSGF5ICcgK1xuICAgICAgICAgIG4gK1xuICAgICAgICAgICcgdmlzaXRhcy4gRWwgRXhjZWwgY29uIHRvZGFzIGxhcyBmb3RvcyBlbWJlYmlkYXMgcHVlZGUgcGVzYXIgNTAtMTUwIE1CIHkgdGFyZGFyIHZhcmlvcyBtaW51dG9zLiBcdTAwQkZDb250aW51YXI/J1xuICAgICAgKVxuICAgIClcbiAgICAgIHJldHVybjtcbiAgfSBlbHNlIGlmIChuID4gMTAwKSB7XG4gICAgaWYgKFxuICAgICAgIWNvbmZpcm0oXG4gICAgICAgICdWYXMgYSBnZW5lcmFyIHVuIEV4Y2VsIGNvbiAnICtcbiAgICAgICAgICBuICtcbiAgICAgICAgICAnIHZpc2l0YXMgeSBzdXMgZm90b3MgZW1iZWJpZGFzLiBQdWVkZSB0YXJkYXIgMzAtNjAgc2VndW5kb3MuIFx1MDBCRkNvbnRpbnVhcj8nXG4gICAgICApXG4gICAgKVxuICAgICAgcmV0dXJuO1xuICB9XG4gIHNob3dTeW5jVGFnKCdDYXJnYW5kbyBFeGNlbEpTLi4uJywgMjAwMCk7XG4gIHRyeSB7XG4gICAgYXdhaXQgbG9hZEV4Y2VsSlMoKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGFsZXJ0KGUubWVzc2FnZSB8fCBlKTtcbiAgICByZXR1cm47XG4gIH1cblxuICBzaG93U3luY1RhZygnR2VuZXJhbmRvIEV4Y2VsIGNvbiAnICsgbiArICcgdmlzaXRhcy4uLicsIDMwMDApO1xuXG4gIGNvbnN0IHdiID0gbmV3IEV4Y2VsSlMuV29ya2Jvb2soKTtcbiAgd2IuY3JlYXRvciA9ICdBcHAgVmVuZGVkb3JlcyBTaGltYW5vJztcbiAgd2IuY3JlYXRlZCA9IG5ldyBEYXRlKCk7XG4gIGNvbnN0IHdzID0gd2IuYWRkV29ya3NoZWV0KCdWaXNpdGFzJywgeyB2aWV3czogW3sgc3RhdGU6ICdmcm96ZW4nLCB5U3BsaXQ6IDEgfV0gfSk7XG5cbiAgLy8gRGVmaW5pY2lvbiBkZSBjb2x1bW5hcy4gTGEgY29sdW1uYSBkZSBmb3RvIHZhIGEgdGVuZXIgYW5jaG8gZXh0cmEgcGFyYSBxdWUgc2UgdmVhLlxuICB3cy5jb2x1bW5zID0gW1xuICAgIHsgaGVhZGVyOiAnRmVjaGEnLCBrZXk6ICdmZWNoYScsIHdpZHRoOiAxMiB9LFxuICAgIHsgaGVhZGVyOiAnTWVzJywga2V5OiAnbWVzJywgd2lkdGg6IDEwIH0sXG4gICAgeyBoZWFkZXI6ICdWZW5kZWRvcicsIGtleTogJ3ZlbmRlZG9yJywgd2lkdGg6IDIyIH0sXG4gICAgeyBoZWFkZXI6ICdUaXBvIGNvbnRhY3RvJywga2V5OiAndGlwb0N0Jywgd2lkdGg6IDEyIH0sXG4gICAgeyBoZWFkZXI6ICdDb21lbnRhcmlvJywga2V5OiAnY29tZW50Jywgd2lkdGg6IDMyIH0sXG4gICAgeyBoZWFkZXI6ICdQcm92aW5jaWEnLCBrZXk6ICdwcm92aW5jaWEnLCB3aWR0aDogMTYgfSxcbiAgICB7IGhlYWRlcjogJ0xvY2FsaWRhZCcsIGtleTogJ2xvY2FsaWRhZCcsIHdpZHRoOiAxOCB9LFxuICAgIHsgaGVhZGVyOiAnVGllbmRhJywga2V5OiAndGllbmRhJywgd2lkdGg6IDMwIH0sXG4gICAgeyBoZWFkZXI6ICdUaXBvJywga2V5OiAndGlwbycsIHdpZHRoOiAxMiB9LFxuICAgIHsgaGVhZGVyOiAnTG9jYWwnLCBrZXk6ICdsb2NhbCcsIHdpZHRoOiAxMiB9LFxuICAgIHsgaGVhZGVyOiAnVGFtYW5vJywga2V5OiAndGFtYW5vJywgd2lkdGg6IDEwIH0sXG4gICAgeyBoZWFkZXI6ICdGaWRlbGlkYWQnLCBrZXk6ICdmaWRlbGlkYWQnLCB3aWR0aDogMTAgfSxcbiAgICB7IGhlYWRlcjogJ1JlbGV2YW5jaWEnLCBrZXk6ICdyZWxldicsIHdpZHRoOiAxMCB9LFxuICAgIHsgaGVhZGVyOiAnUE9QJywga2V5OiAncG9wJywgd2lkdGg6IDggfSxcbiAgICB7IGhlYWRlcjogJ1RpcG8gdmVudGEnLCBrZXk6ICd0aXBvVmVudGEnLCB3aWR0aDogMTIgfSxcbiAgICB7IGhlYWRlcjogJ0NvbXBldGVuY2lhJywga2V5OiAnY29tcGUnLCB3aWR0aDogMTYgfSxcbiAgICB7IGhlYWRlcjogJ09wb3J0dW5pZGFkJywga2V5OiAnb3BvcnR1Jywgd2lkdGg6IDMwIH0sXG4gICAgeyBoZWFkZXI6ICdMbyBtYXMgdmVuZGlkbycsIGtleTogJ21hc1ZlJywgd2lkdGg6IDI4IH0sXG4gICAgeyBoZWFkZXI6ICdHUFMgZGlzdCAobSknLCBrZXk6ICdncHNEaXN0Jywgd2lkdGg6IDEyIH0sXG4gICAgeyBoZWFkZXI6ICdGb3RvIGZyZW50ZScsIGtleTogJ2ZvdG8nLCB3aWR0aDogMjIgfSwgLy8gPC0gbGEgaW1hZ2VuIHZhIGFjYVxuICAgIHsgaGVhZGVyOiAnRW1haWwgdmVuZGVkb3InLCBrZXk6ICdlbWFpbCcsIHdpZHRoOiAyOCB9LFxuICBdO1xuXG4gIC8vIEVzdGlsbyBoZWFkZXJcbiAgd3MuZ2V0Um93KDEpLmZvbnQgPSB7IGJvbGQ6IHRydWUsIGNvbG9yOiB7IGFyZ2I6ICdGRkZGRkZGRicgfSB9O1xuICB3cy5nZXRSb3coMSkuZmlsbCA9IHsgdHlwZTogJ3BhdHRlcm4nLCBwYXR0ZXJuOiAnc29saWQnLCBmZ0NvbG9yOiB7IGFyZ2I6ICdGRjBDNEE2RScgfSB9O1xuICB3cy5nZXRSb3coMSkuYWxpZ25tZW50ID0geyB2ZXJ0aWNhbDogJ21pZGRsZScsIGhvcml6b250YWw6ICdjZW50ZXInIH07XG4gIHdzLmdldFJvdygxKS5oZWlnaHQgPSAyMjtcblxuICBjb25zdCBGT1RPX0NPTF9JRFggPSB3cy5nZXRDb2x1bW4oJ2ZvdG8nKS5udW1iZXIgLSAxOyAvLyAwLWluZGV4ZWQgcGFyYSBhZGRJbWFnZVxuICBjb25zdCBST1dfSCA9IDEwMDtcbiAgY29uc3QgSU1HX1cgPSAxMzA7XG4gIGNvbnN0IElNR19IID0gOTA7XG5cbiAgLy8gT3JkZW5hciB2aXNpdGFzIHBvciBmZWNoYSBkZXNjIChtYXMgcmVjaWVudGVzIHByaW1lcm8pXG4gIGNvbnN0IHNvcnRlZCA9IHZpc2l0c0NhY2hlLnNsaWNlKCkuc29ydCgoYSwgYikgPT4gKGIuZmVjaGEgfHwgJycpLmxvY2FsZUNvbXBhcmUoYS5mZWNoYSB8fCAnJykpO1xuXG4gIGZvciAoY29uc3QgdiBvZiBzb3J0ZWQpIHtcbiAgICBjb25zdCB0aXBvQ29udGFjdG9MYmwgPSB2LnRpcG9Db250YWN0byA9PT0gJ3RlbGVmb25vJyA/ICdUZWxlZm9ubycgOiAnUHJlc2VuY2lhbCc7XG4gICAgY29uc3QgciA9IHdzLmFkZFJvdyh7XG4gICAgICBmZWNoYTogdi5mZWNoYSB8fCAnJyxcbiAgICAgIG1lczogdi5tZXMgfHwgJycsXG4gICAgICB2ZW5kZWRvcjogdGl0bGVDYXNlKHYudmVuZG9yIHx8ICcnKSxcbiAgICAgIHRpcG9DdDogdGlwb0NvbnRhY3RvTGJsLFxuICAgICAgY29tZW50OiB2LmNvbWVudGFyaW8gfHwgJycsXG4gICAgICBwcm92aW5jaWE6IHRpdGxlQ2FzZSh2LnByb3ZpbmNpYSB8fCAnJyksXG4gICAgICBsb2NhbGlkYWQ6IHYubG9jYWxpZGFkIHx8ICcnLFxuICAgICAgdGllbmRhOiB2LnRpZW5kYSB8fCAnJyxcbiAgICAgIHRpcG86IHYudGlwbyB8fCAnJyxcbiAgICAgIGxvY2FsOiB2LmxvY2FsIHx8ICcnLFxuICAgICAgdGFtYW5vOiB2LnRhbWFubyB8fCAnJyxcbiAgICAgIGZpZGVsaWRhZDogdi5maWRlbGlkYWQgfHwgJycsXG4gICAgICByZWxldjogdi5yZWxldmFuY2lhIHx8ICcnLFxuICAgICAgcG9wOiB2LnBvcCB8fCAnJyxcbiAgICAgIHRpcG9WZW50YTogdi50aXBvVmVudGEgPT09ICdNT1NUUkFETycgPyAnTU9TVFJBRE9SJyA6IHYudGlwb1ZlbnRhIHx8ICcnLFxuICAgICAgY29tcGU6IHYuY29tcGV0ZW5jaWEgfHwgJycsXG4gICAgICBvcG9ydHU6IHYub3BvcnR1bmlkYWQgfHwgJycsXG4gICAgICBtYXNWZTogdi5tYXNWZW5kaWRvIHx8ICcnLFxuICAgICAgZ3BzRGlzdDogdHlwZW9mIHYuZ3BzRGlzdGFuY2VNID09PSAnbnVtYmVyJyA/IHYuZ3BzRGlzdGFuY2VNIDogJycsXG4gICAgICBmb3RvOiAnJywgLy8gbGEgY2VsZGEgcXVlZGEgdmFjaWE7IGVuY2ltYSB2YSBsYSBpbWFnZW5cbiAgICAgIGVtYWlsOiB2Lm93bmVyRW1haWwgfHwgJycsXG4gICAgfSk7XG4gICAgci5oZWlnaHQgPSBST1dfSDtcbiAgICByLmFsaWdubWVudCA9IHsgdmVydGljYWw6ICdtaWRkbGUnLCB3cmFwVGV4dDogdHJ1ZSB9O1xuICAgIGlmICh2LmZyZW50ZUxvY2FsICYmIHR5cGVvZiB2LmZyZW50ZUxvY2FsID09PSAnc3RyaW5nJykge1xuICAgICAgdHJ5IHtcbiAgICAgICAgLy8gRWwgY2FtcG8gZXMgdW4gZGF0YVVSTDogJ2RhdGE6aW1hZ2UvanBlZztiYXNlNjQsLzlqLzRBQVEuLi4nXG4gICAgICAgIGxldCBiNjQgPSB2LmZyZW50ZUxvY2FsO1xuICAgICAgICBsZXQgZXh0ID0gJ2pwZWcnO1xuICAgICAgICBjb25zdCBtID0gL15kYXRhOmltYWdlXFwvKFxcdyspO2Jhc2U2NCwoLispJC9pLmV4ZWMoYjY0KTtcbiAgICAgICAgaWYgKG0pIHtcbiAgICAgICAgICBleHQgPSBtWzFdLnRvTG93ZXJDYXNlKCk7XG4gICAgICAgICAgYjY0ID0gbVsyXTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoZXh0ID09PSAnanBnJykgZXh0ID0gJ2pwZWcnO1xuICAgICAgICBjb25zdCBpbWFnZUlkID0gd2IuYWRkSW1hZ2UoeyBiYXNlNjQ6IGI2NCwgZXh0ZW5zaW9uOiBleHQgfSk7XG4gICAgICAgIHdzLmFkZEltYWdlKGltYWdlSWQsIHtcbiAgICAgICAgICB0bDogeyBjb2w6IEZPVE9fQ09MX0lEWCArIDAuMSwgcm93OiByLm51bWJlciAtIDEgKyAwLjEgfSxcbiAgICAgICAgICBleHQ6IHsgd2lkdGg6IElNR19XLCBoZWlnaHQ6IElNR19IIH0sXG4gICAgICAgICAgZWRpdEFzOiAnb25lQ2VsbCcsXG4gICAgICAgIH0pO1xuICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICBjb25zb2xlLndhcm4oJ2VtYmViaWVuZG8gZm90byBmaWxhJywgci5udW1iZXIsIGUpO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8vIEdlbmVyYXIgeSBkZXNjYXJnYXJcbiAgdHJ5IHtcbiAgICBjb25zdCBidWZmZXIgPSBhd2FpdCB3Yi54bHN4LndyaXRlQnVmZmVyKCk7XG4gICAgY29uc3QgYmxvYiA9IG5ldyBCbG9iKFtidWZmZXJdLCB7XG4gICAgICB0eXBlOiAnYXBwbGljYXRpb24vdm5kLm9wZW54bWxmb3JtYXRzLW9mZmljZWRvY3VtZW50LnNwcmVhZHNoZWV0bWwuc2hlZXQnLFxuICAgIH0pO1xuICAgIGNvbnN0IHVybCA9IFVSTC5jcmVhdGVPYmplY3RVUkwoYmxvYik7XG4gICAgY29uc3QgYSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2EnKTtcbiAgICBhLmhyZWYgPSB1cmw7XG4gICAgYS5kb3dubG9hZCA9ICdTaGltYW5vX1Zpc2l0YXNfY29uX2ZvdG9zXycgKyB0b2RheVN0cigpICsgJy54bHN4JztcbiAgICBkb2N1bWVudC5ib2R5LmFwcGVuZENoaWxkKGEpO1xuICAgIGEuY2xpY2soKTtcbiAgICBkb2N1bWVudC5ib2R5LnJlbW92ZUNoaWxkKGEpO1xuICAgIHNldFRpbWVvdXQoKCkgPT4gVVJMLnJldm9rZU9iamVjdFVSTCh1cmwpLCA1MDAwKTtcbiAgICBzaG93U3luY1RhZygnRXhjZWwgZGVzY2FyZ2FkbzogJyArIHNvcnRlZC5sZW5ndGggKyAnIHZpc2l0YXMnLCAzMDAwKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGNvbnNvbGUuZXJyb3IoJ2V4cG9ydFZpc2l0c1dpdGhFbWJlZGRlZFBob3RvcycsIGUpO1xuICAgIGFsZXJ0KCdFcnJvciBnZW5lcmFuZG8gZWwgRXhjZWw6ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcbiAgfVxufTtcblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIFNFQ0NJXHUwMEQzTjogZXhwb3J0QXVkaXRFeGNlbCAoaW5saW5lIEwxMDA0MC0xMDA2Nylcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG53aW5kb3cuZXhwb3J0QXVkaXRFeGNlbCA9IGZ1bmN0aW9uICgpIHtcbiAgaWYgKHR5cGVvZiBYTFNYID09PSAndW5kZWZpbmVkJykge1xuICAgIGFsZXJ0KCdMYSBsaWJyZXJpYSBkZSBFeGNlbCBubyBzZSBjYXJnby4nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgY29uc3QgaXRlbXMgPSBnZXRGaWx0ZXJlZEF1ZGl0RW50cmllcygpO1xuICBpZiAoIWl0ZW1zLmxlbmd0aCkge1xuICAgIGFsZXJ0KCdObyBoYXkgZXZlbnRvcyBwYXJhIGV4cG9ydGFyIGNvbiBsb3MgZmlsdHJvcyBhcGxpY2Fkb3MuJyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGNvbnN0IHJvd3MgPSBpdGVtcy5tYXAoKGUpID0+IHtcbiAgICBjb25zdCB0cyA9IGUudGltZXN0YW1wICYmIGUudGltZXN0YW1wLnRvRGF0ZSA/IGUudGltZXN0YW1wLnRvRGF0ZSgpIDogbnVsbDtcbiAgICByZXR1cm4ge1xuICAgICAgRmVjaGFfSG9yYTogdHMgPyB0cy50b0lTT1N0cmluZygpLnJlcGxhY2UoJ1QnLCAnICcpLnNsaWNlKDAsIDE5KSA6ICcnLFxuICAgICAgVXN1YXJpb19FbWFpbDogZS51c2VyRW1haWwgfHwgJycsXG4gICAgICBVc3VhcmlvX1VJRDogZS51c2VyVWlkIHx8ICcnLFxuICAgICAgUm9sOiBlLnVzZXJSb2xlIHx8ICcnLFxuICAgICAgQWNjaW9uOiBBVURJVF9BQ1RJT05fTEFCRUxTW2UuYWN0aW9uXSB8fCBlLmFjdGlvbiB8fCAnJyxcbiAgICAgIEFjY2lvbl9SYXc6IGUuYWN0aW9uIHx8ICcnLFxuICAgICAgVGlwb19FbnRpZGFkOiBlLmVudGl0eVR5cGUgfHwgJycsXG4gICAgICBFbnRpZGFkOiBlLmVudGl0eU5hbWUgfHwgJycsXG4gICAgICBEZXRhbGxlc19KU09OOiBlLmRldGFpbHMgPyBKU09OLnN0cmluZ2lmeShlLmRldGFpbHMpIDogJycsXG4gICAgfTtcbiAgfSk7XG4gIGNvbnN0IHdiID0gWExTWC51dGlscy5ib29rX25ldygpO1xuICBjb25zdCB3cyA9IFhMU1gudXRpbHMuanNvbl90b19zaGVldChyb3dzKTtcbiAgd3NbJyFjb2xzJ10gPSBbXG4gICAgeyB3Y2g6IDIwIH0sXG4gICAgeyB3Y2g6IDMwIH0sXG4gICAgeyB3Y2g6IDMwIH0sXG4gICAgeyB3Y2g6IDEwIH0sXG4gICAgeyB3Y2g6IDI0IH0sXG4gICAgeyB3Y2g6IDIwIH0sXG4gICAgeyB3Y2g6IDE0IH0sXG4gICAgeyB3Y2g6IDQwIH0sXG4gICAgeyB3Y2g6IDYwIH0sXG4gIF07XG4gIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQod2IsIHdzLCAnQXVkaXRvcmlhJyk7XG4gIGNvbnN0IHN0YW1wID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpLnNsaWNlKDAsIDEwKTtcbiAgWExTWC53cml0ZUZpbGUod2IsICdTaGltYW5vX0F1ZGl0b3JpYV8nICsgc3RhbXAgKyAnLnhsc3gnKTtcbn07XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBTRUNDSVx1MDBEM046IGJ1aWxkQ29udGFjdGFkb3NSb3dzL09wc0xvZy9WaXNpdCAoaW5saW5lIEwxMDA4MS0xMDE1NSlcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4vLyBMaXN0YSBjb21wbGV0YSBkZSBjb250YWN0YWRvcyAoY2xpZW50ZXMvcHJvc3BlY3RvcyBtYXJjYWRvcyBjb24gY2hlY2spXG5mdW5jdGlvbiBidWlsZENvbnRhY3RhZG9zUm93cygpIHtcbiAgY29uc3Qgcm93cyA9IFtdO1xuICBjb250YWN0ZWQuZm9yRWFjaCgoa2V5KSA9PiB7XG4gICAgY29uc3QgcGFydHMgPSBrZXkuc3BsaXQoJ3wnKTtcbiAgICBjb25zdCB0aXBvID0gcGFydHNbMF0sXG4gICAgICBwcm92aW5jZSA9IHBhcnRzWzFdLFxuICAgICAgbG9jTmFtZSA9IHBhcnRzWzJdLFxuICAgICAgY2xpZW50TmFtZSA9IHBhcnRzWzNdO1xuICAgIGNvbnN0IHB0ID0gUE9JTlRTLmZpbmQoKHApID0+IHAucHJvdmluY2UgPT09IHByb3ZpbmNlICYmIHAubmFtZSA9PT0gbG9jTmFtZSk7XG4gICAgY29uc3QgdmVuZG9yID0gcHQgPyBwdC52ZW5kb3IgOiAnJztcbiAgICBjb25zdCB2bSA9IHZlbmRvckxvb2t1cFt2ZW5kb3JdO1xuICAgIHJvd3MucHVzaCh7XG4gICAgICBUaXBvOiB0aXBvID09PSAnQycgPyAnQ2xpZW50ZSBhY3R1YWwnIDogJ1Byb3NwZWN0bycsXG4gICAgICBDbGllbnRlOiBjbGllbnROYW1lLFxuICAgICAgUHJvdmluY2lhOiB0aXRsZUNhc2UocHJvdmluY2UpLFxuICAgICAgTG9jYWxpZGFkOiBsb2NOYW1lLFxuICAgICAgRGVwYXJ0YW1lbnRvOiBwdCA/IHB0LmRlcHQgfHwgJycgOiAnJyxcbiAgICAgIFZlbmRlZG9yOiB0aXRsZUNhc2UodmVuZG9yIHx8ICcnKSxcbiAgICAgIFpvbmE6IHZtID8gdm0uem9uZSA6ICcnLFxuICAgICAgQ29udGFjdGFkbzogJ1NpJyxcbiAgICB9KTtcbiAgfSk7XG4gIHJvd3Muc29ydChcbiAgICAoYSwgYikgPT5cbiAgICAgIGEuVmVuZGVkb3IubG9jYWxlQ29tcGFyZShiLlZlbmRlZG9yKSB8fFxuICAgICAgYS5Qcm92aW5jaWEubG9jYWxlQ29tcGFyZShiLlByb3ZpbmNpYSkgfHxcbiAgICAgIGEuQ2xpZW50ZS5sb2NhbGVDb21wYXJlKGIuQ2xpZW50ZSlcbiAgKTtcbiAgcmV0dXJuIHJvd3M7XG59XG5cbi8vIExvZyBkZSBvcGVyYWNpb25lcyAoY2FuY2VsYWNpb25lcywgZWxpbWluYWNpb25lcywgdnVlbHZlLWEtYm9ycmFkb3IsIGV0Yy4pXG5mdW5jdGlvbiBidWlsZE9wc0xvZ1Jvd3MoKSB7XG4gIHJldHVybiAob3BzTG9nQ2FjaGUgfHwgW10pLm1hcCgobykgPT4gKHtcbiAgICBGZWNoYTogby50aW1lc3RhbXBcbiAgICAgID8gby50aW1lc3RhbXAudG9EYXRlXG4gICAgICAgID8gby50aW1lc3RhbXAudG9EYXRlKCkudG9Mb2NhbGVTdHJpbmcoKVxuICAgICAgICA6IG5ldyBEYXRlKG8udGltZXN0YW1wKS50b0xvY2FsZVN0cmluZygpXG4gICAgICA6ICcnLFxuICAgIFVzdWFyaW86IG8udXNlckVtYWlsIHx8ICcnLFxuICAgIFJvbDogby51c2VyUm9sZSB8fCAnJyxcbiAgICBBY2Npb246IG8uYWN0aW9uIHx8ICcnLFxuICAgICdUaXBvIGVudGlkYWQnOiBvLmVudGl0eVR5cGUgfHwgJycsXG4gICAgRW50aWRhZDogby5lbnRpdHlOYW1lIHx8ICcnLFxuICAgIERldGFsbGVzOiB0eXBlb2Ygby5kZXRhaWxzID09PSAnb2JqZWN0JyA/IEpTT04uc3RyaW5naWZ5KG8uZGV0YWlscykgOiBvLmRldGFpbHMgfHwgJycsXG4gIH0pKTtcbn1cblxuZnVuY3Rpb24gYnVpbGRWaXNpdFJvd3MoKSB7XG4gIHJldHVybiB2aXNpdHNDYWNoZS5tYXAoKHYpID0+ICh7XG4gICAgRmVjaGE6IHYuZmVjaGEgfHwgJycsXG4gICAgTWVzOiB2Lm1lcyB8fCAnJyxcbiAgICBBbm86IHYuYW5pbyB8fCAnJyxcbiAgICBWZW5kZWRvcjogdGl0bGVDYXNlKHYudmVuZG9yIHx8ICcnKSxcbiAgICAnVGlwbyBjb250YWN0byc6IHYudGlwb0NvbnRhY3RvID09PSAndGVsZWZvbm8nID8gJ1RlbGVmb25vJyA6ICdQcmVzZW5jaWFsJyxcbiAgICBDb21lbnRhcmlvOiB2LmNvbWVudGFyaW8gfHwgJycsXG4gICAgUHJvdmluY2lhOiB0aXRsZUNhc2Uodi5wcm92aW5jaWEgfHwgJycpLFxuICAgIExvY2FsaWRhZDogdi5sb2NhbGlkYWQgfHwgJycsXG4gICAgVGllbmRhOiB2LnRpZW5kYSB8fCAnJyxcbiAgICAnVGlwbyB0aWVuZGEnOiB2LnRpcG8gfHwgJycsXG4gICAgTG9jYWw6IHYubG9jYWwgfHwgJycsXG4gICAgVGFtYW5vOiB2LnRhbWFubyB8fCAnJyxcbiAgICBGaWRlbGlkYWQ6IHYuZmlkZWxpZGFkIHx8ICcnLFxuICAgICdSZWxldmFuY2lhICgxLTUpJzogdi5yZWxldmFuY2lhIHx8ICcnLFxuICAgIFBPUDogdi5wb3AgfHwgJycsXG4gICAgJ05lY2VzaWRhZCBwdW50dWFsJzogdi5uZWNlc2lkYWRQdW50dWFsID09PSAnTU9TVFJBRE8nID8gJ01PU1RSQURPUicgOiB2Lm5lY2VzaWRhZFB1bnR1YWwgfHwgJycsXG4gICAgJ1RpcG8gdmVudGEnOiB2LnRpcG9WZW50YSA9PT0gJ01PU1RSQURPJyA/ICdNT1NUUkFET1InIDogdi50aXBvVmVudGEgfHwgJycsXG4gICAgJyUgTW9zdHJhZG9yJzogdi5wb25kZXJhY2lvbk1vc3RyYWRvICE9IG51bGwgPyB2LnBvbmRlcmFjaW9uTW9zdHJhZG8gOiAnJyxcbiAgICAnJSBFY29tbWVyY2UnOiB2LnBvbmRlcmFjaW9uRWNvbW1lcmNlICE9IG51bGwgPyB2LnBvbmRlcmFjaW9uRWNvbW1lcmNlIDogJycsXG4gICAgQ29tcGV0ZW5jaWE6IHYuY29tcGV0ZW5jaWEgfHwgJycsXG4gICAgJ0NhdGVnb3JpYSBjbGllbnRlJzogdi5jYXRlZ29yaWFDbGllbnRlIHx8ICcnLFxuICAgIE9wb3J0dW5pZGFkOiB2Lm9wb3J0dW5pZGFkIHx8ICcnLFxuICAgICdMbyBtYXMgdmVuZGlkbyBTaGltYW5vJzogdi5tYXNWZW5kaWRvIHx8ICcnLFxuICAgICdMbyBxdWUgbWFzIHByZWd1bnRhbic6IHYubWFzUHJlZ3VudGFuIHx8ICcnLFxuICAgICdBeXVkYSBhIHRpZW5kYSc6IHYuYXl1ZGFUaWVuZGEgfHwgJycsXG4gICAgJ0ZvdG9zIGVzcGFjaW8gKGNhbnQpJzogKHYuZXNwYWNpbyB8fCBbXSkubGVuZ3RoLFxuICAgICdGb3RvIGZyZW50ZSc6IHYuZnJlbnRlTG9jYWwgPyAnU2knIDogJ05vJyxcbiAgICAnR1BTIGVzdGFkbyc6IHYuZ3BzU3RhdHVzIHx8ICcnLFxuICAgICdHUFMgZGlzdGFuY2lhIChtKSc6IHR5cGVvZiB2Lmdwc0Rpc3RhbmNlTSA9PT0gJ251bWJlcicgPyB2Lmdwc0Rpc3RhbmNlTSA6ICcnLFxuICAgICdHUFMgbGF0Jzogdi5ncHNMYXQgIT0gbnVsbCA/IHYuZ3BzTGF0IDogJycsXG4gICAgJ0dQUyBsb24nOiB2Lmdwc0xvbiAhPSBudWxsID8gdi5ncHNMb24gOiAnJyxcbiAgICAnR1BTIHByZWNpc2lvbiAobSknOiB2Lmdwc0FjY3VyYWN5ICE9IG51bGwgPyB2Lmdwc0FjY3VyYWN5IDogJycsXG4gICAgJ0dQUyBjYXB0dXJhZG8nOiB2Lmdwc0NhcHR1cmVkQXQgfHwgJycsXG4gICAgRW1haWw6IHYub3duZXJFbWFpbCB8fCAnJyxcbiAgfSkpO1xufVxuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gU0VDQ0lcdTAwRDNOOiBleHBvcnRFeGVjdXRpdmUvVmlzaXRzL1Bvd2VyQkkvTUwgKGlubGluZSBMMTAxNTgtMTA0MjYpXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxud2luZG93LmV4cG9ydEV4ZWN1dGl2ZSA9IGZ1bmN0aW9uICgpIHtcbiAgY29uc3Qgd2IgPSBYTFNYLnV0aWxzLmJvb2tfbmV3KCk7XG4gIGNvbnN0IHJvd3MgPSBidWlsZFBlZGlkb0RldGFpbFJvd3MoKTtcbiAgY29uc3QgY29uZlJvd3MgPSByb3dzLmZpbHRlcigocikgPT4gci5lc3RhZG8gPT09ICdDb25maXJtYWRvJyk7XG5cbiAgLy8gQ29uc29saWRhZG86IHVuYSBmaWxhIHBvciB2ZW5kZWRvciBjb24gS1BJc1xuICBjb25zdCBwZXJWZW5kb3IgPSB7fTtcbiAgY29uZlJvd3MuZm9yRWFjaCgocikgPT4ge1xuICAgIGNvbnN0IGsgPSByLnZlbmRlZG9yIHx8ICdTaW4gYXNpZ25hcic7XG4gICAgaWYgKCFwZXJWZW5kb3Jba10pXG4gICAgICBwZXJWZW5kb3Jba10gPSB7XG4gICAgICAgIHpvbmE6IHIuem9uYSxcbiAgICAgICAgdW5pZDogMCxcbiAgICAgICAgYXJzOiAwLFxuICAgICAgICB1c2Q6IDAsXG4gICAgICAgIGNsaWVudGVzOiBuZXcgU2V0KCksXG4gICAgICAgIHByb2RzOiBuZXcgU2V0KCksXG4gICAgICAgIHByb3ZzOiBuZXcgU2V0KCksXG4gICAgICB9O1xuICAgIHBlclZlbmRvcltrXS51bmlkICs9IHIuY2FudGlkYWQ7XG4gICAgcGVyVmVuZG9yW2tdLmFycyArPSByLnN1YnRvdGFsX2FycztcbiAgICBwZXJWZW5kb3Jba10udXNkICs9IHIuc3VidG90YWxfdXNkO1xuICAgIHBlclZlbmRvcltrXS5jbGllbnRlcy5hZGQoci5jbGllbnRlKTtcbiAgICBwZXJWZW5kb3Jba10ucHJvZHMuYWRkKHIuY29kaWdvKTtcbiAgICBwZXJWZW5kb3Jba10ucHJvdnMuYWRkKHIucHJvdmluY2lhKTtcbiAgfSk7XG4gIGNvbnN0IGNvbnNvbCA9IFtdO1xuICBWRU5ET1JTLmZvckVhY2goKHYpID0+IHtcbiAgICBjb25zdCB0aXRsZVYgPSB0aXRsZUNhc2Uodi5rZXkpO1xuICAgIGNvbnN0IGQgPSBwZXJWZW5kb3JbdGl0bGVWXSB8fCB7XG4gICAgICB6b25hOiB2LnpvbmUsXG4gICAgICB1bmlkOiAwLFxuICAgICAgYXJzOiAwLFxuICAgICAgdXNkOiAwLFxuICAgICAgY2xpZW50ZXM6IG5ldyBTZXQoKSxcbiAgICAgIHByb2RzOiBuZXcgU2V0KCksXG4gICAgICBwcm92czogbmV3IFNldCgpLFxuICAgIH07XG4gICAgY29uc3QgdCA9IFRBUkdFVFNfQllfVkVORE9SW3Yua2V5XSB8fCB7IGp1bDIwMjZfdXNkOiAwLCBqdWxEaWMyMDI2X3VzZDogMCwgYW51YWwyMDI3X3VzZDogMCB9O1xuICAgIGNvbnNvbC5wdXNoKHtcbiAgICAgIFpvbmE6IHYuem9uZSxcbiAgICAgIFZlbmRlZG9yOiB0aXRsZVYsXG4gICAgICBQcm92aW5jaWFzOiBkLnByb3ZzLnNpemUsXG4gICAgICAnQ2xpZW50ZXMgYWN0aXZvcyc6IGQuY2xpZW50ZXMuc2l6ZSxcbiAgICAgICdQcm9kdWN0b3MgZGlzdGludG9zJzogZC5wcm9kcy5zaXplLFxuICAgICAgVW5pZGFkZXM6IGQudW5pZCxcbiAgICAgICdGYWN0dXJhZG8gQVJTJzogTWF0aC5yb3VuZChkLmFycyksXG4gICAgICAnRmFjdHVyYWRvIFVTRCc6IE1hdGgucm91bmQoZC51c2QpLFxuICAgICAgJ1RhcmdldCBKdWwgMjAyNiBVU0QnOiB0Lmp1bDIwMjZfdXNkLFxuICAgICAgJ1RhcmdldCBKdWwtRGljIDIwMjYgVVNEJzogdC5qdWxEaWMyMDI2X3VzZCxcbiAgICAgICdUYXJnZXQgMjAyNyBVU0QnOiB0LmFudWFsMjAyN191c2QsXG4gICAgfSk7XG4gIH0pO1xuICBjb25zdCB3c0MgPSBYTFNYLnV0aWxzLmpzb25fdG9fc2hlZXQoY29uc29sKTtcbiAgd3NDWychY29scyddID0gW1xuICAgIHsgd2NoOiA2IH0sXG4gICAgeyB3Y2g6IDI0IH0sXG4gICAgeyB3Y2g6IDExIH0sXG4gICAgeyB3Y2g6IDE0IH0sXG4gICAgeyB3Y2g6IDE2IH0sXG4gICAgeyB3Y2g6IDExIH0sXG4gICAgeyB3Y2g6IDE2IH0sXG4gICAgeyB3Y2g6IDE2IH0sXG4gICAgeyB3Y2g6IDE4IH0sXG4gICAgeyB3Y2g6IDIwIH0sXG4gICAgeyB3Y2g6IDE4IH0sXG4gIF07XG4gIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQod2IsIHdzQywgJ0NvbnNvbGlkYWRvJyk7XG5cbiAgLy8gVW5hIGhvamEgcG9yIHZlbmRlZG9yIGNvbiBzdSBkZXRhbGxlIGRlIHBlZGlkb3MgY29uZmlybWFkb3NcbiAgVkVORE9SUy5mb3JFYWNoKCh2KSA9PiB7XG4gICAgY29uc3QgdGl0bGVWID0gdGl0bGVDYXNlKHYua2V5KTtcbiAgICBjb25zdCB2cm93cyA9IGNvbmZSb3dzXG4gICAgICAuZmlsdGVyKChyKSA9PiByLnZlbmRlZG9yID09PSB0aXRsZVYpXG4gICAgICAubWFwKChyKSA9PiAoe1xuICAgICAgICBGZWNoYTogci5mZWNoYSxcbiAgICAgICAgTWVzOiByLm1lc19wZWRpZG8sXG4gICAgICAgIFByb3ZpbmNpYTogci5wcm92aW5jaWEsXG4gICAgICAgIExvY2FsaWRhZDogci5sb2NhbGlkYWQsXG4gICAgICAgIENsaWVudGU6IHIuY2xpZW50ZSxcbiAgICAgICAgVGlwbzogci50aXBvX2NsaWVudGUsXG4gICAgICAgIENvZGlnbzogci5jb2RpZ28sXG4gICAgICAgIFByb2R1Y3RvOiByLnByb2R1Y3RvLFxuICAgICAgICBDYXRlZ29yaWE6IHIuY2F0ZWdvcmlhLFxuICAgICAgICBGYW1pbGlhOiByLmZhbWlsaWEsXG4gICAgICAgIFN1YmZhbWlsaWE6IHIuc3ViZmFtaWxpYSxcbiAgICAgICAgQ2FudGlkYWQ6IHIuY2FudGlkYWQsXG4gICAgICAgICdQcmVjaW8gQVJTJzogci5wcmVjaW9fdW5pdF9hcnMsXG4gICAgICAgICdTdWJ0b3RhbCBBUlMnOiByLnN1YnRvdGFsX2FycyxcbiAgICAgICAgJ1N1YnRvdGFsIFVTRCc6IHIuc3VidG90YWxfdXNkLFxuICAgICAgfSkpO1xuICAgIHZyb3dzLnNvcnQoXG4gICAgICAoYSwgYikgPT4gKGEuRmVjaGEgfHwgJycpLmxvY2FsZUNvbXBhcmUoYi5GZWNoYSB8fCAnJykgfHwgYS5DbGllbnRlLmxvY2FsZUNvbXBhcmUoYi5DbGllbnRlKVxuICAgICk7XG4gICAgaWYgKCF2cm93cy5sZW5ndGgpXG4gICAgICB2cm93cy5wdXNoKHtcbiAgICAgICAgRmVjaGE6ICcnLFxuICAgICAgICBNZXM6ICcnLFxuICAgICAgICBQcm92aW5jaWE6ICcnLFxuICAgICAgICBMb2NhbGlkYWQ6ICcnLFxuICAgICAgICBDbGllbnRlOiAnKHNpbiBwZWRpZG9zIGNvbmZpcm1hZG9zKScsXG4gICAgICAgIFRpcG86ICcnLFxuICAgICAgICBDb2RpZ286ICcnLFxuICAgICAgICBQcm9kdWN0bzogJycsXG4gICAgICAgIENhdGVnb3JpYTogJycsXG4gICAgICAgIEZhbWlsaWE6ICcnLFxuICAgICAgICBTdWJmYW1pbGlhOiAnJyxcbiAgICAgICAgQ2FudGlkYWQ6IDAsXG4gICAgICAgICdQcmVjaW8gQVJTJzogMCxcbiAgICAgICAgJ1N1YnRvdGFsIEFSUyc6IDAsXG4gICAgICAgICdTdWJ0b3RhbCBVU0QnOiAwLFxuICAgICAgfSk7XG4gICAgY29uc3Qgd3MgPSBYTFNYLnV0aWxzLmpzb25fdG9fc2hlZXQodnJvd3MpO1xuICAgIHdzWychY29scyddID0gW1xuICAgICAgeyB3Y2g6IDExIH0sXG4gICAgICB7IHdjaDogMTQgfSxcbiAgICAgIHsgd2NoOiAxOCB9LFxuICAgICAgeyB3Y2g6IDIyIH0sXG4gICAgICB7IHdjaDogMzAgfSxcbiAgICAgIHsgd2NoOiAxMSB9LFxuICAgICAgeyB3Y2g6IDE0IH0sXG4gICAgICB7IHdjaDogMzggfSxcbiAgICAgIHsgd2NoOiAxNCB9LFxuICAgICAgeyB3Y2g6IDE4IH0sXG4gICAgICB7IHdjaDogMTggfSxcbiAgICAgIHsgd2NoOiAxMCB9LFxuICAgICAgeyB3Y2g6IDEyIH0sXG4gICAgICB7IHdjaDogMTQgfSxcbiAgICAgIHsgd2NoOiAxNCB9LFxuICAgIF07XG4gICAgWExTWC51dGlscy5ib29rX2FwcGVuZF9zaGVldChcbiAgICAgIHdiLFxuICAgICAgd3MsXG4gICAgICAodi56b25lICsgJyAnICsgdGl0bGVWKS5zdWJzdHJpbmcoMCwgMzEpLnJlcGxhY2UoL1tcXFxcLyo/W1xcXTpdL2csICcnKVxuICAgICk7XG4gIH0pO1xuXG4gIC8vIFZpc2l0YXNcbiAgY29uc3QgdmlzaXRSb3dzID0gYnVpbGRWaXNpdFJvd3MoKTtcbiAgaWYgKHZpc2l0Um93cy5sZW5ndGgpIHtcbiAgICBjb25zdCB3c1YgPSBYTFNYLnV0aWxzLmpzb25fdG9fc2hlZXQodmlzaXRSb3dzKTtcbiAgICBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KHdiLCB3c1YsICdWaXNpdGFzJyk7XG4gIH1cbiAgLy8gQ29udGFjdGFkb3MgKHRvZG9zIGxvcyBjbGllbnRlcy9wcm9zcGVjdG9zIG1hcmNhZG9zIGNvbiBjaGVjaylcbiAgY29uc3QgY29udGFjdFJvd3MgPSBidWlsZENvbnRhY3RhZG9zUm93cygpO1xuICBpZiAoY29udGFjdFJvd3MubGVuZ3RoKSB7XG4gICAgWExTWC51dGlscy5ib29rX2FwcGVuZF9zaGVldCh3YiwgWExTWC51dGlscy5qc29uX3RvX3NoZWV0KGNvbnRhY3RSb3dzKSwgJ0NvbnRhY3RhZG9zJyk7XG4gIH1cbiAgLy8gTG9nIGRlIG9wZXJhY2lvbmVzIChjYW5jZWxhY2lvbmVzLCBlbGltaW5hY2lvbmVzLCBldGMuKVxuICBjb25zdCBvcHNSb3dzID0gYnVpbGRPcHNMb2dSb3dzKCk7XG4gIGlmIChvcHNSb3dzLmxlbmd0aCkge1xuICAgIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQod2IsIFhMU1gudXRpbHMuanNvbl90b19zaGVldChvcHNSb3dzKSwgJ0xvZyBPcGVyYWNpb25lcycpO1xuICB9XG5cbiAgWExTWC53cml0ZUZpbGUod2IsICdTaGltYW5vX0VqZWN1dGl2b18nICsgdG9kYXlTdHIoKSArICcueGxzeCcpO1xufTtcblxuLy8gLS0tLS0tLS0tLSBFeGNlbCBkZSBWaXNpdGFzIChmb3JtYXRvIHN0YW5kYWxvbmUpIC0tLS0tLS0tLS1cbndpbmRvdy5leHBvcnRWaXNpdHNFeGNlbCA9IGZ1bmN0aW9uICgpIHtcbiAgaWYgKHR5cGVvZiBYTFNYID09PSAndW5kZWZpbmVkJykge1xuICAgIGFsZXJ0KCdMYSBsaWJyZXJpYSBkZSBFeGNlbCBubyBzZSBjYXJnby4gVmVyaWZpcXVlIHN1IGNvbmV4aW9uIGEgaW50ZXJuZXQgeSByZWludGVudGUuJyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGNvbnN0IHZpc2l0Um93cyA9IGJ1aWxkVmlzaXRSb3dzKCk7XG4gIGlmICghdmlzaXRSb3dzLmxlbmd0aCkge1xuICAgIGFsZXJ0KFxuICAgICAgJ05vIGhheSB2aXNpdGFzIHJlZ2lzdHJhZGFzIHRvZGF2aWEuIEN1YW5kbyBzZSBjYXJndWUgYWwgbWVub3MgdW5hLCB2YXMgYSBwb2RlciBleHBvcnRhcmxhLidcbiAgICApO1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCB3YiA9IFhMU1gudXRpbHMuYm9va19uZXcoKTtcblxuICAvLyBIb2phIHByaW5jaXBhbDogVmlzaXRhcyAodG9kYXMgbGFzIGZpbGFzKVxuICBjb25zdCB3cyA9IFhMU1gudXRpbHMuanNvbl90b19zaGVldCh2aXNpdFJvd3MpO1xuICB3c1snIWNvbHMnXSA9IFtcbiAgICB7IHdjaDogMTIgfSxcbiAgICB7IHdjaDogMTQgfSxcbiAgICB7IHdjaDogOCB9LFxuICAgIHsgd2NoOiAyNCB9LFxuICAgIHsgd2NoOiAxOCB9LFxuICAgIHsgd2NoOiAyMiB9LFxuICAgIHsgd2NoOiAzMCB9LFxuICAgIHsgd2NoOiAxOCB9LFxuICAgIHsgd2NoOiAxNCB9LFxuICAgIHsgd2NoOiAxNCB9LFxuICAgIHsgd2NoOiAxNCB9LFxuICAgIHsgd2NoOiAxNiB9LFxuICAgIHsgd2NoOiA4IH0sXG4gICAgeyB3Y2g6IDIyIH0sXG4gICAgeyB3Y2g6IDE0IH0sXG4gICAgeyB3Y2g6IDE0IH0sXG4gICAgeyB3Y2g6IDE0IH0sXG4gICAgeyB3Y2g6IDE4IH0sXG4gICAgeyB3Y2g6IDE4IH0sXG4gICAgeyB3Y2g6IDMyIH0sXG4gICAgeyB3Y2g6IDMyIH0sXG4gICAgeyB3Y2g6IDMyIH0sXG4gICAgeyB3Y2g6IDMyIH0sXG4gICAgeyB3Y2g6IDE4IH0sXG4gICAgeyB3Y2g6IDE0IH0sXG4gICAgeyB3Y2g6IDI0IH0sXG4gIF07XG4gIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQod2IsIHdzLCAnVmlzaXRhcycpO1xuXG4gIC8vIEhvamEgcmVzdW1lbiBwb3IgdmVuZGVkb3I6IGNhbnRpZGFkIGRlIHZpc2l0YXMgeSB0aWVuZGFzIHVuaWNhc1xuICBjb25zdCBwZXJWZW5kb3IgPSB7fTtcbiAgdmlzaXRzQ2FjaGUuZm9yRWFjaCgodikgPT4ge1xuICAgIGNvbnN0IGsgPSB0aXRsZUNhc2Uodi52ZW5kb3IgfHwgJ1NpbiBhc2lnbmFyJyk7XG4gICAgaWYgKCFwZXJWZW5kb3Jba10pXG4gICAgICBwZXJWZW5kb3Jba10gPSB7XG4gICAgICAgIHZpc2l0YXM6IDAsXG4gICAgICAgIHRpZW5kYXM6IG5ldyBTZXQoKSxcbiAgICAgICAgbG9jYWxpZGFkZXM6IG5ldyBTZXQoKSxcbiAgICAgICAgcHJvdmluY2lhczogbmV3IFNldCgpLFxuICAgICAgfTtcbiAgICBwZXJWZW5kb3Jba10udmlzaXRhcysrO1xuICAgIGlmICh2LnRpZW5kYSkgcGVyVmVuZG9yW2tdLnRpZW5kYXMuYWRkKHYudGllbmRhKTtcbiAgICBpZiAodi5sb2NhbGlkYWQpIHBlclZlbmRvcltrXS5sb2NhbGlkYWRlcy5hZGQodi5sb2NhbGlkYWQpO1xuICAgIGlmICh2LnByb3ZpbmNpYSkgcGVyVmVuZG9yW2tdLnByb3ZpbmNpYXMuYWRkKHYucHJvdmluY2lhKTtcbiAgfSk7XG4gIGNvbnN0IHJlc3VtZW4gPSBPYmplY3QuZW50cmllcyhwZXJWZW5kb3IpXG4gICAgLm1hcCgoW3ZlbmRlZG9yLCBkXSkgPT4gKHtcbiAgICAgIFZlbmRlZG9yOiB2ZW5kZWRvcixcbiAgICAgICdWaXNpdGFzIHRvdGFsZXMnOiBkLnZpc2l0YXMsXG4gICAgICAnVGllbmRhcyBkaXN0aW50YXMnOiBkLnRpZW5kYXMuc2l6ZSxcbiAgICAgICdMb2NhbGlkYWRlcyBkaXN0aW50YXMnOiBkLmxvY2FsaWRhZGVzLnNpemUsXG4gICAgICAnUHJvdmluY2lhcyBkaXN0aW50YXMnOiBkLnByb3ZpbmNpYXMuc2l6ZSxcbiAgICB9KSlcbiAgICAuc29ydCgoYSwgYikgPT4gYlsnVmlzaXRhcyB0b3RhbGVzJ10gLSBhWydWaXNpdGFzIHRvdGFsZXMnXSk7XG4gIGlmIChyZXN1bWVuLmxlbmd0aCkge1xuICAgIGNvbnN0IHdzUiA9IFhMU1gudXRpbHMuanNvbl90b19zaGVldChyZXN1bWVuKTtcbiAgICB3c1JbJyFjb2xzJ10gPSBbeyB3Y2g6IDI0IH0sIHsgd2NoOiAxNiB9LCB7IHdjaDogMTggfSwgeyB3Y2g6IDIyIH0sIHsgd2NoOiAyMiB9XTtcbiAgICBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KHdiLCB3c1IsICdSZXN1bWVuIHBvciB2ZW5kZWRvcicpO1xuICB9XG5cbiAgWExTWC53cml0ZUZpbGUod2IsICdTaGltYW5vX1Zpc2l0YXNfJyArIHRvZGF5U3RyKCkgKyAnLnhsc3gnKTtcbn07XG5cbi8vIC0tLS0tLS0tLS0gT1BDSU9OIEI6IFBvd2VyIEJJIChGYWN0ICsgRGltKSAtLS0tLS0tLS0tXG53aW5kb3cuZXhwb3J0UG93ZXJCSSA9IGZ1bmN0aW9uICgpIHtcbiAgY29uc3Qgd2IgPSBYTFNYLnV0aWxzLmJvb2tfbmV3KCk7XG4gIGNvbnN0IHJvd3MgPSBidWlsZFBlZGlkb0RldGFpbFJvd3MoKTtcblxuICAvLyBGYWN0X1BlZGlkb3NcbiAgY29uc3QgZmFjdFJvd3MgPSByb3dzLmZpbHRlcigocikgPT4gci5lc3RhZG8gIT09ICdCb3JyYWRvcicpO1xuICBjb25zdCB3c0YgPSBYTFNYLnV0aWxzLmpzb25fdG9fc2hlZXQoXG4gICAgZmFjdFJvd3MubWFwKChyKSA9PiAoe1xuICAgICAgbGluZV9pZDogci5saW5lX2lkLFxuICAgICAgZmVjaGE6IHIuZmVjaGEsXG4gICAgICBlc3RhZG86IHIuZXN0YWRvLFxuICAgICAgdmVuZGVkb3Jfa2V5OiByLnZlbmRlZG9yX2tleSxcbiAgICAgIHpvbmE6IHIuem9uYSxcbiAgICAgIHByb3ZpbmNpYTogci5wcm92aW5jaWEsXG4gICAgICBsb2NhbGlkYWQ6IHIubG9jYWxpZGFkLFxuICAgICAgY2xpZW50ZTogci5jbGllbnRlLFxuICAgICAgdGlwb19jbGllbnRlOiByLnRpcG9fY2xpZW50ZSxcbiAgICAgIHNrdTogci5jb2RpZ28sXG4gICAgICBjYW50aWRhZDogci5jYW50aWRhZCxcbiAgICAgIHByZWNpb191bml0X2Fyczogci5wcmVjaW9fdW5pdF9hcnMsXG4gICAgICBzdWJ0b3RhbF9hcnM6IHIuc3VidG90YWxfYXJzLFxuICAgICAgc3VidG90YWxfdXNkOiByLnN1YnRvdGFsX3VzZCxcbiAgICB9KSlcbiAgKTtcbiAgWExTWC51dGlscy5ib29rX2FwcGVuZF9zaGVldCh3Yiwgd3NGLCAnRmFjdF9QZWRpZG9zJyk7XG5cbiAgLy8gRGltX1ZlbmRlZG9yXG4gIGNvbnN0IGRpbVYgPSBWRU5ET1JTLm1hcCgodikgPT4ge1xuICAgIGNvbnN0IHQgPSBUQVJHRVRTX0JZX1ZFTkRPUlt2LmtleV0gfHwge307XG4gICAgcmV0dXJuIHtcbiAgICAgIHZlbmRlZG9yX2tleTogdi5rZXksXG4gICAgICB2ZW5kZWRvcl9ub21icmU6IHRpdGxlQ2FzZSh2LmtleSksXG4gICAgICB6b25hOiB2LnpvbmUsXG4gICAgICB6b25hX2Rlc2NyaXBjaW9uOiB2LmxhYmVsLFxuICAgICAgY29sb3I6IHYuY29sb3IsXG4gICAgICB0YXJnZXRfanVsMjAyNl91c2Q6IHQuanVsMjAyNl91c2QgfHwgMCxcbiAgICAgIHRhcmdldF9qdWxEaWMyMDI2X3VzZDogdC5qdWxEaWMyMDI2X3VzZCB8fCAwLFxuICAgICAgdGFyZ2V0XzIwMjdfdXNkOiB0LmFudWFsMjAyN191c2QgfHwgMCxcbiAgICB9O1xuICB9KTtcbiAgWExTWC51dGlscy5ib29rX2FwcGVuZF9zaGVldCh3YiwgWExTWC51dGlscy5qc29uX3RvX3NoZWV0KGRpbVYpLCAnRGltX1ZlbmRlZG9yJyk7XG5cbiAgLy8gRGltX1Byb2R1Y3RvXG4gIGNvbnN0IGRpbVAgPSBQUk9EVUNUUy5tYXAoKHApID0+ICh7XG4gICAgc2t1OiBwLmNvZGUsXG4gICAgZGVzY3JpcGNpb246IHAuZGVzYyxcbiAgICBjYXRlZ29yaWE6IHAuY2F0LFxuICAgIGZhbWlsaWE6IHAuZmFtLFxuICAgIHN1YmZhbWlsaWE6IHAuc3ViLFxuICB9KSk7XG4gIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQod2IsIFhMU1gudXRpbHMuanNvbl90b19zaGVldChkaW1QKSwgJ0RpbV9Qcm9kdWN0bycpO1xuXG4gIC8vIERpbV9DbGllbnRlICh1bml2ZXJzbylcbiAgY29uc3QgZGltQyA9IFtdO1xuICBQT0lOVFMuZm9yRWFjaCgocCkgPT4ge1xuICAgIGNvbnN0IHZtID0gdmVuZG9yTG9va3VwW3AudmVuZG9yXTtcbiAgICBwLmNsaWVudHMuZm9yRWFjaCgobikgPT4ge1xuICAgICAgZGltQy5wdXNoKHtcbiAgICAgICAgY2xpZW50ZTogbixcbiAgICAgICAgdGlwbzogJ0NsaWVudGUgYWN0dWFsJyxcbiAgICAgICAgcHJvdmluY2lhOiB0aXRsZUNhc2UocC5wcm92aW5jZSksXG4gICAgICAgIGxvY2FsaWRhZDogcC5uYW1lLFxuICAgICAgICBkZXBhcnRhbWVudG86IHAuZGVwdCB8fCAnJyxcbiAgICAgICAgdmVuZGVkb3Jfa2V5OiBwLnZlbmRvciB8fCAnJyxcbiAgICAgICAgem9uYTogdm0gPyB2bS56b25lIDogJycsXG4gICAgICB9KTtcbiAgICB9KTtcbiAgICBwLnByb3NwZWN0cy5mb3JFYWNoKChuKSA9PiB7XG4gICAgICBkaW1DLnB1c2goe1xuICAgICAgICBjbGllbnRlOiBuLFxuICAgICAgICB0aXBvOiAnUHJvc3BlY3RvJyxcbiAgICAgICAgcHJvdmluY2lhOiB0aXRsZUNhc2UocC5wcm92aW5jZSksXG4gICAgICAgIGxvY2FsaWRhZDogcC5uYW1lLFxuICAgICAgICBkZXBhcnRhbWVudG86IHAuZGVwdCB8fCAnJyxcbiAgICAgICAgdmVuZGVkb3Jfa2V5OiBwLnZlbmRvciB8fCAnJyxcbiAgICAgICAgem9uYTogdm0gPyB2bS56b25lIDogJycsXG4gICAgICB9KTtcbiAgICB9KTtcbiAgfSk7XG4gIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQod2IsIFhMU1gudXRpbHMuanNvbl90b19zaGVldChkaW1DKSwgJ0RpbV9DbGllbnRlJyk7XG5cbiAgLy8gRGltX0NhbGVuZGFyaW8gKGZlY2hhcyBkaXN0aW50YXMgZW4gbG9zIHBlZGlkb3MgKyBzZXJpZSBjb250aW51YSBkZWwgYVx1MDBGMW8gYWN0dWFsKVxuICBjb25zdCBjYWxTZXQgPSBuZXcgU2V0KCk7XG4gIGZhY3RSb3dzLmZvckVhY2goKHIpID0+IHtcbiAgICBpZiAoci5mZWNoYSkgY2FsU2V0LmFkZChyLmZlY2hhKTtcbiAgfSk7XG4gIC8vIENvbXBsZXRhciBkZXNkZSAyMDI2LTAxLTAxIGhhc3RhIGhveSArIDM2NVxuICBjb25zdCBzdGFydCA9IG5ldyBEYXRlKCcyMDI2LTAxLTAxJyk7XG4gIGNvbnN0IGVuZCA9IG5ldyBEYXRlKCk7XG4gIGVuZC5zZXREYXRlKGVuZC5nZXREYXRlKCkgKyAzNjUpO1xuICBmb3IgKGxldCBkID0gbmV3IERhdGUoc3RhcnQpOyBkIDw9IGVuZDsgZC5zZXREYXRlKGQuZ2V0RGF0ZSgpICsgMSkpXG4gICAgY2FsU2V0LmFkZChkLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwgMTApKTtcbiAgY29uc3QgZGltQ2FsID0gWy4uLmNhbFNldF0uc29ydCgpLm1hcCgoZHQpID0+IHtcbiAgICBjb25zdCBbeSwgbSwgZGFdID0gZHQuc3BsaXQoJy0nKS5tYXAoKHgpID0+IHBhcnNlSW50KHgsIDEwKSk7XG4gICAgY29uc3QgZGF0ZU9iaiA9IG5ldyBEYXRlKHksIG0gLSAxLCBkYSk7XG4gICAgcmV0dXJuIHtcbiAgICAgIGZlY2hhOiBkdCxcbiAgICAgIHllYXI6IHksXG4gICAgICBtb250aDogbSxcbiAgICAgIGRheTogZGEsXG4gICAgICBxdWFydGVyOiAnUScgKyAoTWF0aC5mbG9vcigobSAtIDEpIC8gMykgKyAxKSxcbiAgICAgIG1vbnRoX25hbWU6IE1FU0VTW20gLSAxXSxcbiAgICAgIHllYXJfbW9udGg6IHkgKyAnLScgKyBTdHJpbmcobSkucGFkU3RhcnQoMiwgJzAnKSxcbiAgICAgIGRheV9vZl93ZWVrOiBbJ0RvbScsICdMdW4nLCAnTWFyJywgJ01pZScsICdKdWUnLCAnVmllJywgJ1NhYiddW2RhdGVPYmouZ2V0RGF5KCldLFxuICAgIH07XG4gIH0pO1xuICBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KHdiLCBYTFNYLnV0aWxzLmpzb25fdG9fc2hlZXQoZGltQ2FsKSwgJ0RpbV9DYWxlbmRhcmlvJyk7XG5cbiAgLy8gRGltX0NhbXBhbmlhXG4gIGNvbnN0IGRpbUNtcCA9IGNhbXBhaWduc0NhY2hlLm1hcCgoYykgPT4gKHtcbiAgICBjYW1wYW5pYV9pZDogYy5pZCxcbiAgICBub21icmU6IGMubmFtZSxcbiAgICBmaWx0ZXJfdHlwZTogYy5maWx0ZXJUeXBlLFxuICAgIGZpbHRlcl92YWx1ZXM6IChjLmZpbHRlclZhbHVlcyB8fCBbXSkuam9pbignLCAnKSxcbiAgICB0YXJnZXRfdHlwZTogYy50YXJnZXRUeXBlLFxuICAgIHRhcmdldF9hbW91bnQ6IGMudGFyZ2V0QW1vdW50LFxuICAgIGRlc2RlOiBjLnN0YXJ0RGF0ZSxcbiAgICBoYXN0YTogYy5lbmREYXRlLFxuICB9KSk7XG4gIGlmIChkaW1DbXAubGVuZ3RoKVxuICAgIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQod2IsIFhMU1gudXRpbHMuanNvbl90b19zaGVldChkaW1DbXApLCAnRGltX0NhbXBhbmlhJyk7XG5cbiAgLy8gUGFyYW1zICh0aXBvIGRlIGNhbWJpbywgZmVjaGEgZXhwb3J0LCB2ZXJzaW9uKVxuICBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KFxuICAgIHdiLFxuICAgIFhMU1gudXRpbHMuanNvbl90b19zaGVldChbXG4gICAgICB7IHBhcmFtZXRybzogJ2V4Y2hhbmdlX3JhdGVfYXJzX3VzZCcsIHZhbG9yOiBFWENIQU5HRV9SQVRFIH0sXG4gICAgICB7IHBhcmFtZXRybzogJ2ZlY2hhX2V4cG9ydCcsIHZhbG9yOiB0b2RheVN0cigpIH0sXG4gICAgICB7IHBhcmFtZXRybzogJ3RvdGFsX2ZpbGFzX2ZhY3QnLCB2YWxvcjogZmFjdFJvd3MubGVuZ3RoIH0sXG4gICAgXSksXG4gICAgJ1BhcmFtZXRyb3MnXG4gICk7XG5cbiAgLy8gRmFjdF9WaXNpdGFzXG4gIGNvbnN0IHZpc2l0Um93c0IgPSBidWlsZFZpc2l0Um93cygpO1xuICBpZiAodmlzaXRSb3dzQi5sZW5ndGgpXG4gICAgWExTWC51dGlscy5ib29rX2FwcGVuZF9zaGVldCh3YiwgWExTWC51dGlscy5qc29uX3RvX3NoZWV0KHZpc2l0Um93c0IpLCAnRmFjdF9WaXNpdGFzJyk7XG4gIC8vIENvbnRhY3RhZG9zXG4gIGNvbnN0IGNvbnRhY3RSb3dzQiA9IGJ1aWxkQ29udGFjdGFkb3NSb3dzKCk7XG4gIGlmIChjb250YWN0Um93c0IubGVuZ3RoKVxuICAgIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQod2IsIFhMU1gudXRpbHMuanNvbl90b19zaGVldChjb250YWN0Um93c0IpLCAnQ29udGFjdGFkb3MnKTtcbiAgLy8gTG9nIGRlIG9wZXJhY2lvbmVzXG4gIGNvbnN0IG9wc1Jvd3NCID0gYnVpbGRPcHNMb2dSb3dzKCk7XG4gIGlmIChvcHNSb3dzQi5sZW5ndGgpXG4gICAgWExTWC51dGlscy5ib29rX2FwcGVuZF9zaGVldCh3YiwgWExTWC51dGlscy5qc29uX3RvX3NoZWV0KG9wc1Jvd3NCKSwgJ0xvZ19PcGVyYWNpb25lcycpO1xuXG4gIFhMU1gud3JpdGVGaWxlKHdiLCAnU2hpbWFub19Qb3dlckJJXycgKyB0b2RheVN0cigpICsgJy54bHN4Jyk7XG59O1xuXG4vLyAtLS0tLS0tLS0tIE9QQ0lPTiBDOiBQeXRob24gLyBJQSAvIE1MIChzaW5nbGUgbG9uZy1mb3JtYXQgdGFibGUpIC0tLS0tLS0tLS1cbndpbmRvdy5leHBvcnRNTCA9IGZ1bmN0aW9uICgpIHtcbiAgY29uc3Qgd2IgPSBYTFNYLnV0aWxzLmJvb2tfbmV3KCk7XG4gIGNvbnN0IHJvd3MgPSBidWlsZFBlZGlkb0RldGFpbFJvd3MoKTtcbiAgLy8gbWFzdGVyX21sOiB1bmEgZmlsYSBwb3IgbGluZWEgY29uIFRPREFTIGxhcyBmZWF0dXJlc1xuICBjb25zdCB3cyA9IFhMU1gudXRpbHMuanNvbl90b19zaGVldChyb3dzKTtcbiAgd3NbJyFjb2xzJ10gPSBPYmplY3Qua2V5cyhyb3dzWzBdIHx8IHsgZmVjaGE6ICcnIH0pLm1hcCgoKSA9PiAoeyB3Y2g6IDE0IH0pKTtcbiAgWExTWC51dGlscy5ib29rX2FwcGVuZF9zaGVldCh3Yiwgd3MsICdtYXN0ZXJfbWwnKTtcblxuICAvLyBjYXRhbG9nbyB5IHVuaXZlcnNvIGRlIGNsaWVudGVzIGNvbW8gcmVmZXJlbmNpYXMgcGFyYSBlbnJpcXVlY2VyIGVuIHBhbmRhc1xuICBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KFxuICAgIHdiLFxuICAgIFhMU1gudXRpbHMuanNvbl90b19zaGVldChcbiAgICAgIFBST0RVQ1RTLm1hcCgocCkgPT4gKHsgY29kZTogcC5jb2RlLCBkZXNjOiBwLmRlc2MsIGNhdDogcC5jYXQsIGZhbTogcC5mYW0sIHN1YjogcC5zdWIgfSkpXG4gICAgKSxcbiAgICAncHJvZHVjdG9zX2NhdGFsb2dvJ1xuICApO1xuXG4gIGNvbnN0IHVuaXZlcnNlID0gW107XG4gIFBPSU5UUy5mb3JFYWNoKChwKSA9PiB7XG4gICAgY29uc3Qgdm0gPSB2ZW5kb3JMb29rdXBbcC52ZW5kb3JdO1xuICAgIHAuY2xpZW50cy5mb3JFYWNoKChuKSA9PiB7XG4gICAgICB1bml2ZXJzZS5wdXNoKHtcbiAgICAgICAgY2xpZW50ZTogbixcbiAgICAgICAgdGlwbzogJ2NsaWVudGVfYWN0dWFsJyxcbiAgICAgICAgcHJvdmluY2lhOiB0aXRsZUNhc2UocC5wcm92aW5jZSksXG4gICAgICAgIGxvY2FsaWRhZDogcC5uYW1lLFxuICAgICAgICBkZXBhcnRhbWVudG86IHAuZGVwdCB8fCAnJyxcbiAgICAgICAgdmVuZGVkb3I6IHRpdGxlQ2FzZShwLnZlbmRvciB8fCAnJyksXG4gICAgICAgIHpvbmE6IHZtID8gdm0uem9uZSA6ICcnLFxuICAgICAgICBsYXQ6IHAubGF0LFxuICAgICAgICBsb246IHAubG9uLFxuICAgICAgfSk7XG4gICAgfSk7XG4gICAgcC5wcm9zcGVjdHMuZm9yRWFjaCgobikgPT4ge1xuICAgICAgdW5pdmVyc2UucHVzaCh7XG4gICAgICAgIGNsaWVudGU6IG4sXG4gICAgICAgIHRpcG86ICdwcm9zcGVjdG8nLFxuICAgICAgICBwcm92aW5jaWE6IHRpdGxlQ2FzZShwLnByb3ZpbmNlKSxcbiAgICAgICAgbG9jYWxpZGFkOiBwLm5hbWUsXG4gICAgICAgIGRlcGFydGFtZW50bzogcC5kZXB0IHx8ICcnLFxuICAgICAgICB2ZW5kZWRvcjogdGl0bGVDYXNlKHAudmVuZG9yIHx8ICcnKSxcbiAgICAgICAgem9uYTogdm0gPyB2bS56b25lIDogJycsXG4gICAgICAgIGxhdDogcC5sYXQsXG4gICAgICAgIGxvbjogcC5sb24sXG4gICAgICB9KTtcbiAgICB9KTtcbiAgfSk7XG4gIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQod2IsIFhMU1gudXRpbHMuanNvbl90b19zaGVldCh1bml2ZXJzZSksICd1bml2ZXJzb19jbGllbnRlcycpO1xuXG4gIC8vIHRhcmdldHMgY29tbyB0YWJsYSBsb25nXG4gIGNvbnN0IHRhcmdldHNMb25nID0gW107XG4gIE9iamVjdC5lbnRyaWVzKFRBUkdFVFNfQllfVkVORE9SKS5mb3JFYWNoKChbdmVuZG9yLCB0XSkgPT4ge1xuICAgIHRhcmdldHNMb25nLnB1c2goe1xuICAgICAgdmVuZGVkb3I6IGRpc3BsYXlWZW5kb3JOYW1lKHZlbmRvciksXG4gICAgICBwZXJpb2RvOiAnSnVsIDIwMjYnLFxuICAgICAgc3RhcnRfZGF0ZTogJzIwMjYtMDctMDEnLFxuICAgICAgZW5kX2RhdGU6ICcyMDI2LTA3LTMxJyxcbiAgICAgIHRhcmdldF91c2Q6IHQuanVsMjAyNl91c2QgfHwgMCxcbiAgICB9KTtcbiAgICB0YXJnZXRzTG9uZy5wdXNoKHtcbiAgICAgIHZlbmRlZG9yOiBkaXNwbGF5VmVuZG9yTmFtZSh2ZW5kb3IpLFxuICAgICAgcGVyaW9kbzogJ0p1bC1EaWMgMjAyNicsXG4gICAgICBzdGFydF9kYXRlOiAnMjAyNi0wNy0wMScsXG4gICAgICBlbmRfZGF0ZTogJzIwMjYtMTItMzEnLFxuICAgICAgdGFyZ2V0X3VzZDogdC5qdWxEaWMyMDI2X3VzZCB8fCAwLFxuICAgIH0pO1xuICAgIHRhcmdldHNMb25nLnB1c2goe1xuICAgICAgdmVuZGVkb3I6IGRpc3BsYXlWZW5kb3JOYW1lKHZlbmRvciksXG4gICAgICBwZXJpb2RvOiAnMjAyNycsXG4gICAgICBzdGFydF9kYXRlOiAnMjAyNy0wMS0wMScsXG4gICAgICBlbmRfZGF0ZTogJzIwMjctMTItMzEnLFxuICAgICAgdGFyZ2V0X3VzZDogdC5hbnVhbDIwMjdfdXNkIHx8IDAsXG4gICAgfSk7XG4gIH0pO1xuICBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KHdiLCBYTFNYLnV0aWxzLmpzb25fdG9fc2hlZXQodGFyZ2V0c0xvbmcpLCAndGFyZ2V0c19sb25nJyk7XG5cbiAgLy8gY2FtcGFcdTAwRjFhc1xuICBpZiAoY2FtcGFpZ25zQ2FjaGUubGVuZ3RoKSB7XG4gICAgWExTWC51dGlscy5ib29rX2FwcGVuZF9zaGVldChcbiAgICAgIHdiLFxuICAgICAgWExTWC51dGlscy5qc29uX3RvX3NoZWV0KFxuICAgICAgICBjYW1wYWlnbnNDYWNoZS5tYXAoKGMpID0+ICh7XG4gICAgICAgICAgaWQ6IGMuaWQsXG4gICAgICAgICAgbm9tYnJlOiBjLm5hbWUsXG4gICAgICAgICAgZmlsdGVyX3R5cGU6IGMuZmlsdGVyVHlwZSxcbiAgICAgICAgICBmaWx0ZXJfdmFsdWVzOiAoYy5maWx0ZXJWYWx1ZXMgfHwgW10pLmpvaW4oJywnKSxcbiAgICAgICAgICB0YXJnZXRfdHlwZTogYy50YXJnZXRUeXBlLFxuICAgICAgICAgIHRhcmdldF9hbW91bnQ6IGMudGFyZ2V0QW1vdW50LFxuICAgICAgICAgIHN0YXJ0X2RhdGU6IGMuc3RhcnREYXRlLFxuICAgICAgICAgIGVuZF9kYXRlOiBjLmVuZERhdGUsXG4gICAgICAgIH0pKVxuICAgICAgKSxcbiAgICAgICdjYW1wYW5pYXMnXG4gICAgKTtcbiAgfVxuXG4gIC8vIHBhcmFtZXRyb3NcbiAgWExTWC51dGlscy5ib29rX2FwcGVuZF9zaGVldChcbiAgICB3YixcbiAgICBYTFNYLnV0aWxzLmpzb25fdG9fc2hlZXQoW1xuICAgICAgeyBwYXJhbWV0cm86ICdleGNoYW5nZV9yYXRlX2Fyc191c2QnLCB2YWxvcjogRVhDSEFOR0VfUkFURSB9LFxuICAgICAgeyBwYXJhbWV0cm86ICdmZWNoYV9leHBvcnQnLCB2YWxvcjogbmV3IERhdGUoKS50b0lTT1N0cmluZygpIH0sXG4gICAgXSksXG4gICAgJ3BhcmFtZXRyb3MnXG4gICk7XG5cbiAgLy8gdmlzaXRhc1xuICBjb25zdCB2aXNpdFJvd3NDID0gYnVpbGRWaXNpdFJvd3MoKTtcbiAgaWYgKHZpc2l0Um93c0MubGVuZ3RoKVxuICAgIFhMU1gudXRpbHMuYm9va19hcHBlbmRfc2hlZXQod2IsIFhMU1gudXRpbHMuanNvbl90b19zaGVldCh2aXNpdFJvd3NDKSwgJ3Zpc2l0YXMnKTtcbiAgLy8gY29udGFjdGFkb3NcbiAgY29uc3QgY29udGFjdFJvd3NDID0gYnVpbGRDb250YWN0YWRvc1Jvd3MoKTtcbiAgaWYgKGNvbnRhY3RSb3dzQy5sZW5ndGgpXG4gICAgWExTWC51dGlscy5ib29rX2FwcGVuZF9zaGVldCh3YiwgWExTWC51dGlscy5qc29uX3RvX3NoZWV0KGNvbnRhY3RSb3dzQyksICdjb250YWN0YWRvcycpO1xuICAvLyBsb2cgZGUgb3BlcmFjaW9uZXNcbiAgY29uc3Qgb3BzUm93c0MgPSBidWlsZE9wc0xvZ1Jvd3MoKTtcbiAgaWYgKG9wc1Jvd3NDLmxlbmd0aClcbiAgICBYTFNYLnV0aWxzLmJvb2tfYXBwZW5kX3NoZWV0KHdiLCBYTFNYLnV0aWxzLmpzb25fdG9fc2hlZXQob3BzUm93c0MpLCAnbG9nX29wZXJhY2lvbmVzJyk7XG5cbiAgWExTWC53cml0ZUZpbGUod2IsICdTaGltYW5vX01MXycgKyB0b2RheVN0cigpICsgJy54bHN4Jyk7XG59O1xuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIHYzNzErOiBFeHBvcnQgZGF0YXNldCBwYXJhIGFuXHUwMEUxbGlzaXMgKFpJUCBkZSBDU1ZzIHBhcmEgTUwgcGlwZWxpbmVzKVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbi8qKlxuICogQWJyZSBlbCBtb2RhbCBjaGljbyBkaXNwYXRjaGVyIGRlbCBib3RvbiBcIkV4cG9ydGFyIGEgRXhjZWxcIi4gTXVlc3RyYVxuICogMiB0YXJqZXRhczogUmVwb3J0ZXMgRXhjZWwgKHRvZG9zKSB2cyBEYXRhc2V0IFpJUCAoc29sbyBhZG1pbi9nZXJlbnRlKS5cbiAqL1xud2luZG93Lm9wZW5FeHBvcnRGb3JtYXRNb2RhbCA9IGZ1bmN0aW9uICgpIHtcbiAgLy8gT2N1bHRhci9tb3N0cmFyIHRhcmpldGEgRGF0YXNldCBzZWd1biByb2wuXG4gIGNvbnN0IGRzT3B0ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2V4cC1vcHQtZGF0YXNldC16aXAnKTtcbiAgaWYgKGRzT3B0KSB7XG4gICAgY29uc3QgaXNBZG1pbk9yR2VyZW50ZSA9IHVzZXJSb2xlID09PSAnYWRtaW4nIHx8IHVzZXJSb2xlID09PSAnZ2VyZW50ZSc7XG4gICAgZHNPcHQuc3R5bGUuZGlzcGxheSA9IGlzQWRtaW5PckdlcmVudGUgPyAnJyA6ICdub25lJztcbiAgfVxuICAvLyBPY3VsdGFyIHByb2dyZXNzIGJhciAocG9yIHNpIHF1ZWRvIGFiaWVydG8gZGUgdW5hIGVqZWN1Y2lvbiBhbnRlcmlvcilcbiAgY29uc3QgcHJvZyA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdleHBvcnQtZGF0YXNldC1wcm9ncmVzcycpO1xuICBpZiAocHJvZykgcHJvZy5zdHlsZS5kaXNwbGF5ID0gJ25vbmUnO1xuICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZXhwb3J0LWZvcm1hdC1tb2RhbCcpLmNsYXNzTGlzdC5hZGQoJ29wZW4nKTtcbn07XG5cbndpbmRvdy5jbG9zZUV4cG9ydEZvcm1hdE1vZGFsID0gZnVuY3Rpb24gKCkge1xuICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZXhwb3J0LWZvcm1hdC1tb2RhbCcpLmNsYXNzTGlzdC5yZW1vdmUoJ29wZW4nKTtcbn07XG5cbi8qKlxuICogQWN0dWFsaXphIGVsIHN0YXR1cyArIGJhcnJhIGRlbCBtb2RhbC4gc3RhdHVzIGVzIHRleHRvIGxpYnJlOyBwZXJjZW50IDAuLjEwMC5cbiAqL1xuZnVuY3Rpb24gX3VwZGF0ZUV4cG9ydFByb2dyZXNzKHN0YXR1cywgcGVyY2VudCkge1xuICBjb25zdCBzID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2V4cG9ydC1kYXRhc2V0LXN0YXR1cycpO1xuICBjb25zdCBiID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2V4cG9ydC1kYXRhc2V0LWJhcicpO1xuICBjb25zdCB3cmFwID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2V4cG9ydC1kYXRhc2V0LXByb2dyZXNzJyk7XG4gIGlmICh3cmFwKSB3cmFwLnN0eWxlLmRpc3BsYXkgPSAnJztcbiAgaWYgKHMpIHMudGV4dENvbnRlbnQgPSBzdGF0dXM7XG4gIGlmIChiKSBiLnN0eWxlLndpZHRoID0gTWF0aC5tYXgoMCwgTWF0aC5taW4oMTAwLCBwZXJjZW50KSkgKyAnJSc7XG59XG5cbi8qKlxuICogRmV0Y2ggc3RvY2suanNvbiBkZWwgcm9vdCBkZWwgc2l0aW8gKHYzNjkrIHRpZW5lIHdhcmVob3VzZUJyZWFrZG93bikuXG4gKiBDYWNoZS1idXN0aW5nIGNvbiA/dD0gcGFyYSBldml0YXIgU1cuXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIF9mZXRjaFN0b2NrSnNvbigpIHtcbiAgdHJ5IHtcbiAgICBjb25zdCByID0gYXdhaXQgZmV0Y2goJy4vc3RvY2suanNvbj90PScgKyBEYXRlLm5vdygpLCB7IGNhY2hlOiAnbm8tc3RvcmUnIH0pO1xuICAgIGlmICghci5vaykgdGhyb3cgbmV3IEVycm9yKCdIVFRQICcgKyByLnN0YXR1cyk7XG4gICAgcmV0dXJuIGF3YWl0IHIuanNvbigpO1xuICB9IGNhdGNoIChlKSB7XG4gICAgY29uc29sZS53YXJuKCdbZXhwb3J0RGF0YXNldFppcF0gc3RvY2suanNvbiBmYWxsbzonLCBlICYmIGUubWVzc2FnZSk7XG4gICAgcmV0dXJuIG51bGw7IC8vIG5vIGJsb3F1ZWFudGUgXHUyMDE0IHByb2R1Y3Rvcy5jc3YgcXVlZGEgdmFjaW9cbiAgfVxufVxuXG4vKipcbiAqIExhenkgbG9hZCBKU1ppcCAocGF0cm9uIHlhIHVzYWRvIGVuIGV4cG9ydFBob3Rvc1ppcCBsaW5lYSB+NDcpLlxuICovXG5hc3luYyBmdW5jdGlvbiBfZW5zdXJlSlNaaXBMb2FkZWQoKSB7XG4gIGlmICh0eXBlb2YgSlNaaXAgIT09ICd1bmRlZmluZWQnKSByZXR1cm47XG4gIGF3YWl0IG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICBjb25zdCBzID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnc2NyaXB0Jyk7XG4gICAgcy5zcmMgPSAnaHR0cHM6Ly9jZG5qcy5jbG91ZGZsYXJlLmNvbS9hamF4L2xpYnMvanN6aXAvMy4xMC4xL2pzemlwLm1pbi5qcyc7XG4gICAgcy5vbmxvYWQgPSByZXNvbHZlO1xuICAgIHMub25lcnJvciA9ICgpID0+IHJlamVjdChuZXcgRXJyb3IoJ05vIHNlIHB1ZG8gY2FyZ2FyIEpTWmlwJykpO1xuICAgIGRvY3VtZW50LmhlYWQuYXBwZW5kQ2hpbGQocyk7XG4gIH0pO1xufVxuXG4vKipcbiAqIERlc2NhcmdhIHVuIEJsb2IgY29tbyBhcmNoaXZvLiBSZXVzYSBlbCBwYXRyb24gZGUgZXhwb3J0UGhvdG9zWmlwLlxuICovXG5mdW5jdGlvbiBfZG93bmxvYWRCbG9iKGJsb2IsIGZpbGVuYW1lKSB7XG4gIGNvbnN0IHVybCA9IFVSTC5jcmVhdGVPYmplY3RVUkwoYmxvYik7XG4gIGNvbnN0IGEgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdhJyk7XG4gIGEuaHJlZiA9IHVybDtcbiAgYS5kb3dubG9hZCA9IGZpbGVuYW1lO1xuICBkb2N1bWVudC5ib2R5LmFwcGVuZENoaWxkKGEpO1xuICBhLmNsaWNrKCk7XG4gIHNldFRpbWVvdXQoKCkgPT4ge1xuICAgIGRvY3VtZW50LmJvZHkucmVtb3ZlQ2hpbGQoYSk7XG4gICAgVVJMLnJldm9rZU9iamVjdFVSTCh1cmwpO1xuICB9LCAxMDApO1xufVxuXG4vKipcbiAqIEVYUE9SVCBQUklOQ0lQQUwuIFNvbG8gYWRtaW4vZ2VyZW50ZS4gR2VuZXJhIFpJUCBjb246XG4gKiAgLSBwZWRpZG9zLmNzdiwgdmlzaXRhcy5jc3YsIGNsaWVudGVzLmNzdiwgY2xpZW50X21hc3Rlci5jc3YsIHJlbmRpY2lvbmVzLmNzdixcbiAqICAgIGNhbXBhbmlhcy5jc3YsIHRhcmdldHMuY3N2LCBwcm9kdWN0b3MuY3N2LCB2ZW5kb3Jfb3ZlcnJpZGVzLmNzdixcbiAqICAgIGN1c3RvbV9yb3V0ZXMuY3N2LCBzZWd1aW1pZW50b19ub3Rlcy5jc3ZcbiAqICAtIG1hbmlmZXN0Lmpzb24gKHNjaGVtYSArIHVzZUNhc2VNYXRyaXggKyByb3dDb3VudHMgKyBudWxsUmF0ZUJ5RmllbGQgKyBsaW1pdGF0aW9ucylcbiAqXG4gKiBDYXNvcyBib3JkZSBtYW5lamFkb3M6XG4gKiAgLSBTaSBhbGd1bmEgLmdldCgpIGZhbGxhIC0+IGFsZXJ0ICsgbm8gZGVzY2FyZ2FyIChubyBnZW5lcmEgWklQIHBhcmNpYWwgc2lsZW5jaW9zbykuXG4gKiAgLSBTaSBzdG9jay5qc29uIG5vIHJlc3BvbmRlIC0+IHByb2R1Y3Rvcy5jc3YgcXVlZGEgdmFjaW8gY29uIHdhcm5pbmcgZW4gbWFuaWZlc3QuXG4gKiAgLSBQcm9ncmVzcyBiYXIgZW4gZWwgbW9kYWwgcGFyYSBmZWVkYmFjayAofjEwLTMwIHNlZykuXG4gKi9cbndpbmRvdy5leHBvcnREYXRhc2V0WmlwID0gYXN5bmMgZnVuY3Rpb24gKCkge1xuICBpZiAodXNlclJvbGUgIT09ICdhZG1pbicgJiYgdXNlclJvbGUgIT09ICdnZXJlbnRlJykge1xuICAgIGFsZXJ0KCdTb2xvIGFkbWluIG8gZ2VyZW50ZSBwdWVkZW4gZXhwb3J0YXIgZWwgZGF0YXNldC4nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgaWYgKCFmYkRiKSB7XG4gICAgYWxlcnQoJ0ZpcmVzdG9yZSBubyBpbmljaWFsaXphZG8uIFJlY2FyZ2EgbGEgYXBwLicpO1xuICAgIHJldHVybjtcbiAgfVxuXG4gIC8vIFJlLWFicmlyIG1vZGFsIHNpIGVsIHVzdWFyaW8gY2Vycm8geSBuYXZlZ2Ftb3MgcG9yIG90cm8gZmx1am8uXG4gIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdleHBvcnQtZm9ybWF0LW1vZGFsJykuY2xhc3NMaXN0LmFkZCgnb3BlbicpO1xuICBfdXBkYXRlRXhwb3J0UHJvZ3Jlc3MoJ1ByZXBhcmFuZG8uLi4nLCA1KTtcblxuICB0cnkge1xuICAgIF91cGRhdGVFeHBvcnRQcm9ncmVzcygnQ2FyZ2FuZG8gSlNaaXAuLi4nLCAxMCk7XG4gICAgYXdhaXQgX2Vuc3VyZUpTWmlwTG9hZGVkKCk7XG5cbiAgICAvLyAxKSBGZXRjaCAxMyBjb2xlY2Npb25lcyBGaXJlc3RvcmUgZW4gcGFyYWxlbG8gKyBzdG9jay5qc29uLlxuICAgIC8vIHY3MzIgKDIwMjYtMDgtMjkpOiArIHNhcF9zbmFwc2hvdCwgZmFjdHVyYWNpb25fc25hcHNob3QsIGJhY2tvcmRlcl9zbmFwc2hvdFxuICAgIC8vIChhbnRlcyBleGNsdWlkb3M7IGFob3JhIGZ1ZW50ZSBkZSB2ZXJkYWQgZGUgZmFjdHVyYWNpb24gcmVhbCBTQVAgKyBkZW1hbmRcbiAgICAvLyBzdXByZXNzaW9uICsgYWdyZWdhZG9zIGRpYXJpb3MgbGlzdG9zLXBhcmEtYmVuY2htYXJrKS5cbiAgICBfdXBkYXRlRXhwb3J0UHJvZ3Jlc3MoJ0xleWVuZG8gRmlyZXN0b3JlICgxMyBjb2xlY2Npb25lcykuLi4nLCAyMCk7XG4gICAgY29uc3QgZmlyZXN0b3JlRW50cmllcyA9IFtcbiAgICAgIFsncGVkaWRvcycsIGZiRGIuY29sbGVjdGlvbigncGVkaWRvcycpLmdldCgpXSxcbiAgICAgIFsndmlzaXRhcycsIGZiRGIuY29sbGVjdGlvbigndmlzaXRzJykuZ2V0KCldLFxuICAgICAgWydjbGllbnRlcycsIGZiRGIuY29sbGVjdGlvbignY2xpZW50X2FwcGxpY2F0aW9ucycpLmdldCgpXSxcbiAgICAgIFsnY2xpZW50X21hc3RlcicsIGZiRGIuY29sbGVjdGlvbignY2xpZW50X21hc3RlcicpLmdldCgpXSxcbiAgICAgIFsncmVuZGljaW9uZXMnLCBmYkRiLmNvbGxlY3Rpb24oJ3JlbmRpY2lvbmVzJykuZ2V0KCldLFxuICAgICAgWydjYW1wYW5pYXMnLCBmYkRiLmNvbGxlY3Rpb24oJ2NhbXBhaWducycpLmdldCgpXSxcbiAgICAgIFsndGFyZ2V0cycsIGZiRGIuY29sbGVjdGlvbigndGFyZ2V0cycpLmdldCgpXSxcbiAgICAgIFsndmVuZG9yX292ZXJyaWRlcycsIGZiRGIuY29sbGVjdGlvbigndmVuZG9yX292ZXJyaWRlcycpLmdldCgpXSxcbiAgICAgIFsnY3VzdG9tX3JvdXRlcycsIGZiRGIuY29sbGVjdGlvbignY3VzdG9tX3JvdXRlcycpLmdldCgpXSxcbiAgICAgIFsnc2VndWltaWVudG9fbm90ZXMnLCBmYkRiLmNvbGxlY3Rpb24oJ3NlZ3VpbWllbnRvX25vdGVzJykuZ2V0KCldLFxuICAgICAgWydzYXBfc25hcHNob3QnLCBmYkRiLmNvbGxlY3Rpb24oJ3NhcF9zbmFwc2hvdCcpLmdldCgpXSxcbiAgICAgIFsnZmFjdHVyYWNpb25fc25hcHNob3QnLCBmYkRiLmNvbGxlY3Rpb24oJ2ZhY3R1cmFjaW9uX3NuYXBzaG90JykuZ2V0KCldLFxuICAgICAgWydiYWNrb3JkZXJfc25hcHNob3QnLCBmYkRiLmNvbGxlY3Rpb24oJ2JhY2tvcmRlcl9zbmFwc2hvdCcpLmdldCgpXSxcbiAgICBdO1xuICAgIGNvbnN0IHByb21pc2VzID0gZmlyZXN0b3JlRW50cmllcy5tYXAoKFssIHBdKSA9PiBwKTtcbiAgICBwcm9taXNlcy5wdXNoKF9mZXRjaFN0b2NrSnNvbigpKTtcblxuICAgIGNvbnN0IHNldHRsZWQgPSBhd2FpdCBQcm9taXNlLmFsbFNldHRsZWQocHJvbWlzZXMpO1xuICAgIC8vIFNpIENVQUxRVUlFUiBnZXQoKSBkZSBGaXJlc3RvcmUgcmVjaGF6bywgYWJvcnRhbW9zIChubyBleHBvcnQgcGFyY2lhbCBzaWxlbmNpb3NvKS5cbiAgICBjb25zdCBmYWlsZWRGaXJlc3RvcmUgPSBbXTtcbiAgICBzZXR0bGVkLnNsaWNlKDAsIGZpcmVzdG9yZUVudHJpZXMubGVuZ3RoKS5mb3JFYWNoKChyLCBpKSA9PiB7XG4gICAgICBpZiAoci5zdGF0dXMgPT09ICdyZWplY3RlZCcpXG4gICAgICAgIGZhaWxlZEZpcmVzdG9yZS5wdXNoKFxuICAgICAgICAgIGZpcmVzdG9yZUVudHJpZXNbaV1bMF0gKyAnOiAnICsgKChyLnJlYXNvbiAmJiByLnJlYXNvbi5tZXNzYWdlKSB8fCByLnJlYXNvbilcbiAgICAgICAgKTtcbiAgICB9KTtcbiAgICBpZiAoZmFpbGVkRmlyZXN0b3JlLmxlbmd0aCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgICAnRmlyZXN0b3JlIGZldGNoIGZhbGxvIGVuICcgK1xuICAgICAgICAgIGZhaWxlZEZpcmVzdG9yZS5sZW5ndGggK1xuICAgICAgICAgICcgY29sZWNjaW9uZXM6XFxuJyArXG4gICAgICAgICAgZmFpbGVkRmlyZXN0b3JlLmpvaW4oJ1xcbicpXG4gICAgICApO1xuICAgIH1cblxuICAgIC8vIDIpIEV4dHJhZXIgc25hcHNob3RzICsgZG9jcyBjb24gX2lkXG4gICAgY29uc3Qgc25hcHNob3RzID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBhbnlbXT59ICovICh7fSk7XG4gICAgZmlyZXN0b3JlRW50cmllcy5mb3JFYWNoKChbbmFtZV0sIGkpID0+IHtcbiAgICAgIGNvbnN0IHNuYXAgPSAvKiogQHR5cGUge2FueX0gKi8gKHNldHRsZWRbaV0pLnZhbHVlO1xuICAgICAgY29uc3QgZG9jcyA9IFtdO1xuICAgICAgc25hcC5mb3JFYWNoKChkKSA9PiB7XG4gICAgICAgIGNvbnN0IGRhdGEgPSBkLmRhdGEoKSB8fCB7fTtcbiAgICAgICAgZGF0YS5faWQgPSBkLmlkO1xuICAgICAgICBkb2NzLnB1c2goZGF0YSk7XG4gICAgICB9KTtcbiAgICAgIHNuYXBzaG90c1tuYW1lXSA9IGRvY3M7XG4gICAgfSk7XG4gICAgY29uc3Qgc3RvY2tKc29uID0gLyoqIEB0eXBlIHthbnl9ICovIChzZXR0bGVkW3NldHRsZWQubGVuZ3RoIC0gMV0pLnZhbHVlOyAvLyBwdWVkZSBzZXIgbnVsbFxuXG4gICAgLy8gMykgQ29uc3RydWlyIENTVnMgY29uIHJvdyBidWlsZGVycyArIHNjaGVtYXNcbiAgICBfdXBkYXRlRXhwb3J0UHJvZ3Jlc3MoJ1NlcmlhbGl6YW5kbyBDU1ZzLi4uJywgNTUpO1xuICAgIGNvbnN0IGNzdnMgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIHN0cmluZz59ICovICh7fSk7XG4gICAgY29uc3Qgcm93Q291bnRzID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBudW1iZXI+fSAqLyAoe30pO1xuICAgIGNvbnN0IGFsbFJvd3NCeUNzdiA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgYW55W11bXT59ICovICh7fSk7XG5cbiAgICBmb3IgKGNvbnN0IGNvbGxOYW1lIG9mIE9iamVjdC5rZXlzKHNuYXBzaG90cykpIHtcbiAgICAgIGNvbnN0IHNjaGVtYSA9IERBVEFTRVRfU0NIRU1BU1tjb2xsTmFtZV07XG4gICAgICBpZiAoIXNjaGVtYSkgY29udGludWU7XG4gICAgICBjb25zdCBidWlsZGVyID0gUk9XX0JVSUxERVJTW2NvbGxOYW1lXTtcbiAgICAgIGlmICghYnVpbGRlcikgY29udGludWU7XG4gICAgICBjb25zdCBhbGxSb3dzID0gLyoqIEB0eXBlIHthbnlbXVtdfSAqLyAoW10pO1xuICAgICAgZm9yIChjb25zdCBkb2Mgb2Ygc25hcHNob3RzW2NvbGxOYW1lXSkge1xuICAgICAgICBjb25zdCByb3dzRm9yRG9jID0gYnVpbGRlcihkb2MpO1xuICAgICAgICBmb3IgKGNvbnN0IHIgb2Ygcm93c0ZvckRvYykgYWxsUm93cy5wdXNoKHIpO1xuICAgICAgfVxuICAgICAgYWxsUm93c0J5Q3N2W3NjaGVtYS5uYW1lXSA9IGFsbFJvd3M7XG4gICAgICBjc3ZzW3NjaGVtYS5uYW1lXSA9IGJ1aWxkQ3N2KHNjaGVtYSwgYWxsUm93cyk7XG4gICAgICByb3dDb3VudHNbc2NoZW1hLm5hbWVdID0gYWxsUm93cy5sZW5ndGg7XG4gICAgfVxuXG4gICAgLy8gcHJvZHVjdG9zLmNzdiAoZGVzZGUgc3RvY2suanNvbiwgbm8gRmlyZXN0b3JlKVxuICAgIGNvbnN0IHByb2R1Y3Rvc1NjaGVtYSA9IERBVEFTRVRfU0NIRU1BUy5wcm9kdWN0b3M7XG4gICAgY29uc3QgcHJvZHVjdG9zUm93cyA9IHN0b2NrSnNvbiA/IGJ1aWxkUHJvZHVjdG9Sb3dzRnJvbVN0b2NrSnNvbihzdG9ja0pzb24pIDogW107XG4gICAgYWxsUm93c0J5Q3N2W3Byb2R1Y3Rvc1NjaGVtYS5uYW1lXSA9IHByb2R1Y3Rvc1Jvd3M7XG4gICAgY3N2c1twcm9kdWN0b3NTY2hlbWEubmFtZV0gPSBidWlsZENzdihwcm9kdWN0b3NTY2hlbWEsIHByb2R1Y3Rvc1Jvd3MpO1xuICAgIHJvd0NvdW50c1twcm9kdWN0b3NTY2hlbWEubmFtZV0gPSBwcm9kdWN0b3NSb3dzLmxlbmd0aDtcblxuICAgIC8vIDQpIENvbXB1dGFyIG51bGxSYXRlQnlGaWVsZCBwYXJhIGNhZGEgY2FzbyBBLUVcbiAgICBfdXBkYXRlRXhwb3J0UHJvZ3Jlc3MoJ0NhbGN1bGFuZG8gY2FsaWRhZCBkZWwgZGF0YXNldC4uLicsIDc1KTtcbiAgICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIGFueT59ICovXG4gICAgY29uc3QgdXNlQ2FzZVdpdGhTdGF0cyA9IHt9O1xuICAgIGZvciAoY29uc3QgW2Nhc2VLZXksIHVjXSBvZiBPYmplY3QuZW50cmllcyhEQVRBU0VUX1VTRV9DQVNFX01BVFJJWCkpIHtcbiAgICAgIGNvbnN0IHN0YXRzID0gLyoqIEB0eXBlIHthbnl9ICovICh7XG4gICAgICAgIHByaW9yaXR5OiB1Yy5wcmlvcml0eSxcbiAgICAgICAgZGVzY3JpcHRpb246IHVjLmRlc2NyaXB0aW9uLFxuICAgICAgICByZXF1aXJlZEZpZWxkczogdWMucmVxdWlyZWRGaWVsZHMsXG4gICAgICAgIGpvaW5Ob3RlczogdWMuam9pbk5vdGVzLFxuICAgICAgICBudWxsUmF0ZUJ5RmllbGQ6IHt9LFxuICAgICAgICBsaW1pdGF0aW9uczogW10sXG4gICAgICB9KTtcbiAgICAgIGxldCBoYXNIaWdoTnVsbFJhdGUgPSBmYWxzZTtcbiAgICAgIGxldCBoYXNFbXB0eVJlcXVpcmVkID0gZmFsc2U7XG4gICAgICBmb3IgKGNvbnN0IFtjc3ZOYW1lLCBmaWVsZHNdIG9mIE9iamVjdC5lbnRyaWVzKHVjLnJlcXVpcmVkRmllbGRzKSkge1xuICAgICAgICBjb25zdCBzY2hlbWFGb3JDc3YgPSBPYmplY3QudmFsdWVzKERBVEFTRVRfU0NIRU1BUykuZmluZCgocykgPT4gcy5uYW1lID09PSBjc3ZOYW1lKTtcbiAgICAgICAgaWYgKCFzY2hlbWFGb3JDc3YpIHtcbiAgICAgICAgICBzdGF0cy5saW1pdGF0aW9ucy5wdXNoKCdTY2hlbWEgbm8gZW5jb250cmFkbyBwYXJhICcgKyBjc3ZOYW1lKTtcbiAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuICAgICAgICBjb25zdCByb3dzID0gYWxsUm93c0J5Q3N2W2Nzdk5hbWVdIHx8IFtdO1xuICAgICAgICBjb25zdCByYXRlcyA9IGNvbXB1dGVOdWxsUmF0ZXMoc2NoZW1hRm9yQ3N2LCByb3dzLCBmaWVsZHMpO1xuICAgICAgICBmb3IgKGNvbnN0IFtmLCByYXRlXSBvZiBPYmplY3QuZW50cmllcyhyYXRlcykpIHtcbiAgICAgICAgICBzdGF0cy5udWxsUmF0ZUJ5RmllbGRbY3N2TmFtZSArICcuJyArIGZdID0gcmF0ZTtcbiAgICAgICAgICBpZiAocm93cy5sZW5ndGggPT09IDApIGhhc0VtcHR5UmVxdWlyZWQgPSB0cnVlO1xuICAgICAgICAgIGVsc2UgaWYgKHJhdGUgPiAwLjUpIGhhc0hpZ2hOdWxsUmF0ZSA9IHRydWU7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIGlmIChoYXNFbXB0eVJlcXVpcmVkKSB7XG4gICAgICAgIHN0YXRzLnN0YXR1cyA9ICdFTVBUWSc7XG4gICAgICAgIHN0YXRzLmxpbWl0YXRpb25zLnB1c2goXG4gICAgICAgICAgJ0FsZ3VuYSBjb2xlY2Npb24gcmVxdWVyaWRhIGVzdGEgdmFjaWEgXHUyMDE0IGVsIGNhc28gbm8gc2UgcHVlZGUgZW50cmVuYXIgaG95IHBlcm8gZWwgc2NoZW1hIGVzdGEgbGlzdG8uJ1xuICAgICAgICApO1xuICAgICAgfSBlbHNlIGlmIChoYXNIaWdoTnVsbFJhdGUpIHtcbiAgICAgICAgc3RhdHMuc3RhdHVzID0gJ1BBUlRJQUwnO1xuICAgICAgICBzdGF0cy5saW1pdGF0aW9ucy5wdXNoKFxuICAgICAgICAgICdBbCBtZW5vcyAxIGNhbXBvIHJlcXVlcmlkbyB0aWVuZSA+NTAlIGRlIG51bGxzIFx1MjAxNCByZXZpc2FyIHRhc2FzIGFudGVzIGRlIHVzYXIuJ1xuICAgICAgICApO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgc3RhdHMuc3RhdHVzID0gJ09LJztcbiAgICAgIH1cbiAgICAgIHVzZUNhc2VXaXRoU3RhdHNbY2FzZUtleV0gPSBzdGF0cztcbiAgICB9XG5cbiAgICAvLyA1KSBNYW5pZmVzdC5qc29uXG4gICAgY29uc3QgZXhwb3J0ZWRBdCA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKTtcbiAgICBjb25zdCBtYW5pZmVzdCA9IHtcbiAgICAgIGV4cG9ydGVkQXQsXG4gICAgICBhcHBWZXJzaW9uOiB0eXBlb2YgQVBQX1ZFUlNJT04gIT09ICd1bmRlZmluZWQnID8gQVBQX1ZFUlNJT04gOiAndW5rbm93bicsXG4gICAgICBzb3VyY2VQcm9qZWN0OiAnYXBwLXZlbmRlZG9yZXMtc2hpbWFubycsXG4gICAgICBleHBvcnRlZEJ5RW1haWw6IChjdXJyZW50VXNlciAmJiBjdXJyZW50VXNlci5lbWFpbCkgfHwgJ3Vua25vd24nLFxuICAgICAgZXhwb3J0ZWRCeVVpZDogKGN1cnJlbnRVc2VyICYmIGN1cnJlbnRVc2VyLnVpZCkgfHwgJ3Vua25vd24nLFxuICAgICAgY3N2Q29udmVudGlvbnM6IHtcbiAgICAgICAgZW5jb2Rpbmc6ICdVVEYtOCcsXG4gICAgICAgIHNlcGFyYXRvcjogJywnLFxuICAgICAgICBxdW90ZUNoYXI6ICdcIicsXG4gICAgICAgIGVzY2FwZVF1b3RlOiAnXCJcIicsXG4gICAgICAgIGxpbmVUZXJtaW5hdG9yOiAnXFxcXHJcXFxcbicsXG4gICAgICAgIGRhdGVGb3JtYXQ6ICdJU08gODYwMSBVVEMgKHdpdGggWiknLFxuICAgICAgICBkZWNpbWFsU2VwYXJhdG9yOiAnLicsXG4gICAgICAgIG51bGxSZXByZXNlbnRhdGlvbjogJyhlbXB0eSBmaWVsZCknLFxuICAgICAgICBhcnJheUZvcm1hdDogJ0pTT04gc3RyaW5naWZpZWQnLFxuICAgICAgICBvYmplY3RGb3JtYXQ6ICdKU09OIHN0cmluZ2lmaWVkJyxcbiAgICAgIH0sXG4gICAgICByb3dDb3VudHMsXG4gICAgICBzY2hlbWE6IHt9LFxuICAgICAgdXNlQ2FzZU1hdHJpeDogdXNlQ2FzZVdpdGhTdGF0cyxcbiAgICAgIGV4Y2x1c2lvbnM6IHtcbiAgICAgICAgbm90ZTogJ0RhdG9zIHNlbnNpYmxlcyB5IGJpbmFyaW9zIGV4Y2x1aWRvcyBkZWwgZXhwb3J0LicsXG4gICAgICAgIC8vIHY3MzIgKDIwMjYtMDgtMjkpOiBzYXBfc25hcHNob3QgeWEgTk8gc2UgZXhjbHV5ZSAoYWdyZWdhZG8gY29tbyBmdWVudGVcbiAgICAgICAgLy8gZGUgdmVyZGFkIGRlIGZhY3R1cmFjaW9uIHJlYWwpLiBmYWN0dXJhY2lvbl9zbmFwc2hvdCB5IGJhY2tvcmRlcl9zbmFwc2hvdFxuICAgICAgICAvLyB0YW1wb2NvIGVyYW4gcGFydGUgZGUgZXN0YSBsaXN0YSBwZXJvIGFob3JhIHNvbiBpbmNsdWlkYXMgZXhwbGljaXRhbWVudGUuXG4gICAgICAgIGV4Y2x1ZGVkQ29sbGVjdGlvbnM6IFsncm9sZXMnLCAnYXBwX2NvbmZpZycsICdub3RpZmljYXRpb25zJywgJ29wZXJhdGlvbnNfbG9nJ10sXG4gICAgICAgIGV4Y2x1ZGVkRmllbGRzOiBbXG4gICAgICAgICAgJ3Zpc2l0cy5mcmVudGVMb2NhbCAoZm90b3MgYmFzZTY0KScsXG4gICAgICAgICAgJ3Zpc2l0cy5lc3BhY2lvW10gKGZvdG9zIGJhc2U2NCknLFxuICAgICAgICAgICdjbGllbnRfYXBwbGljYXRpb25zLmNvbnN0YW5jaWFBcmNhIChiYXNlNjQpJyxcbiAgICAgICAgICAnY2xpZW50X2FwcGxpY2F0aW9ucy5jb25zdGFuY2lhSUlCQiAoYmFzZTY0KScsXG4gICAgICAgICAgJ2NsaWVudF9hcHBsaWNhdGlvbnMuZm90b3NMb2NhbFtdIChiYXNlNjQpJyxcbiAgICAgICAgICAncmVuZGljaW9uZXMuZm90b1RpY2tldCAoYmFzZTY0IGxlZ2FjeSBwcmUtdjMwODsgc2UgZXhwb3J0YSBzb2xvIGZvdG9UaWNrZXRVcmwpJyxcbiAgICAgICAgXSxcbiAgICAgICAgc3RvY2tKc29uTG9hZGVkOiBzdG9ja0pzb24gIT09IG51bGwsXG4gICAgICB9LFxuICAgIH07XG4gICAgZm9yIChjb25zdCBbX2NvbGxOYW1lLCBzY2hlbWFdIG9mIE9iamVjdC5lbnRyaWVzKERBVEFTRVRfU0NIRU1BUykpIHtcbiAgICAgIG1hbmlmZXN0LnNjaGVtYVtzY2hlbWEubmFtZV0gPSBzY2hlbWEuY29sdW1ucy5tYXAoKGMpID0+ICh7XG4gICAgICAgIGNvbDogYy5jb2wsXG4gICAgICAgIHR5cGU6IGMudHlwZSxcbiAgICAgICAgZGVzYzogYy5kZXNjLFxuICAgICAgfSkpO1xuICAgIH1cblxuICAgIC8vIDYpIEVtcGFxdWV0YXIgWklQXG4gICAgX3VwZGF0ZUV4cG9ydFByb2dyZXNzKCdFbXBhcXVldGFuZG8gWklQLi4uJywgOTApO1xuICAgIGNvbnN0IHppcCA9IG5ldyBKU1ppcCgpO1xuICAgIGZvciAoY29uc3QgW25hbWUsIGNvbnRlbnRdIG9mIE9iamVjdC5lbnRyaWVzKGNzdnMpKSB7XG4gICAgICB6aXAuZmlsZShuYW1lLCBjb250ZW50KTtcbiAgICB9XG4gICAgemlwLmZpbGUoJ21hbmlmZXN0Lmpzb24nLCBKU09OLnN0cmluZ2lmeShtYW5pZmVzdCwgbnVsbCwgMikpO1xuXG4gICAgY29uc3QgYmxvYiA9IGF3YWl0IHppcC5nZW5lcmF0ZUFzeW5jKHtcbiAgICAgIHR5cGU6ICdibG9iJyxcbiAgICAgIGNvbXByZXNzaW9uOiAnREVGTEFURScsXG4gICAgICBjb21wcmVzc2lvbk9wdGlvbnM6IHsgbGV2ZWw6IDYgfSxcbiAgICB9KTtcbiAgICBjb25zdCBmaWxlbmFtZSA9ICdzaGltYW5vLWRhdGFzZXQtJyArIGV4cG9ydGVkQXQucmVwbGFjZSgvWzouXS9nLCAnLScpICsgJy56aXAnO1xuICAgIF9kb3dubG9hZEJsb2IoYmxvYiwgZmlsZW5hbWUpO1xuXG4gICAgX3VwZGF0ZUV4cG9ydFByb2dyZXNzKFxuICAgICAgJ0RhdGFzZXQgZGVzY2FyZ2FkbzogJyArXG4gICAgICAgIGZpbGVuYW1lICtcbiAgICAgICAgJyAoJyArXG4gICAgICAgIE9iamVjdC5rZXlzKGNzdnMpLmxlbmd0aCArXG4gICAgICAgICcgQ1NWcyArIG1hbmlmZXN0Lmpzb24pJyxcbiAgICAgIDEwMFxuICAgICk7XG4gICAgaWYgKHR5cGVvZiBzaG93U3luY1RhZyA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgY29uc3QgdG90YWxSb3dzID0gT2JqZWN0LnZhbHVlcyhyb3dDb3VudHMpLnJlZHVjZSgoYSwgYikgPT4gYSArIGIsIDApO1xuICAgICAgc2hvd1N5bmNUYWcoXG4gICAgICAgICdEYXRhc2V0IGV4cG9ydGFkbzogJyArIHRvdGFsUm93cyArICcgZmlsYXMgZW4gJyArIE9iamVjdC5rZXlzKGNzdnMpLmxlbmd0aCArICcgQ1NWcydcbiAgICAgICk7XG4gICAgfVxuICAgIHNldFRpbWVvdXQoKCkgPT4gd2luZG93LmNsb3NlRXhwb3J0Rm9ybWF0TW9kYWwoKSwgMzAwMCk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBjb25zb2xlLmVycm9yKCdbZXhwb3J0RGF0YXNldFppcF0gZmF0YWw6JywgZSk7XG4gICAgX3VwZGF0ZUV4cG9ydFByb2dyZXNzKCdFcnJvcjogJyArICgoZSAmJiBlLm1lc3NhZ2UpIHx8IGUpLCAwKTtcbiAgICBhbGVydChcbiAgICAgICdFcnJvciBhbCBleHBvcnRhciBlbCBkYXRhc2V0OlxcblxcbicgK1xuICAgICAgICAoKGUgJiYgZS5tZXNzYWdlKSB8fCBlKSArXG4gICAgICAgICdcXG5cXG5FbCBaSVAgTk8gc2UgZGVzY2FyZ28gKGV2aXRhbW9zIGdlbmVyYXIgdW4gYXJjaGl2byBwYXJjaWFsKS4gUmV2aXNhIGxhIGNvbnNvbGEgcGFyYSBtYXMgZGV0YWxsZXMuJ1xuICAgICk7XG4gIH1cbn07XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gdjE0MTMgXHUwMEE3NTEgKDIwMjYtMTAtMjIpOiBleHBvcnRJbmZyYWNjaW9uZXNNZWxpIFx1MjAxNCBNYXJpYW5vLW9ubHkuXG4vLyBMZWUgZG9jIEZpcmVzdG9yZSBgbWVsaV9pbmZyYWNjaW9uZXNfcmVzdW1lbi9jdXJyZW50YCAocHVibGljYWRvIHBvciBlbFxuLy8gcGlwZWxpbmUgTUkgbWFwLWRhaWx5LnltbCkgeSBnZW5lcmEgeGxzeCBjbGllbnQtc2lkZSBjb24gZWwgZm9ybWF0byBxdWVcbi8vIE1hcmlhbm8gZGVqXHUwMEYzIGFybWFkbzpcbi8vICAgLSBIb2phIFwiSW5mcmFjY2lvbmVzXCIgY29uIDcgY29sdW1uYXM6IENsaWVudGUsIFNLVSwgRGlmZXJlbmNpYSAlLFxuLy8gICAgIFByZWNpbyBwdWJsaWNhZG8sIFByZWNpbyBTdWdlcmlkbywgQ2FudC4gSGlzdG9yaWNhcyBkZSBJbmZyYWNjaW9uZXMsXG4vLyAgICAgXHUwMEJGQ2xpZW50ZT9cbi8vICAgLSBIZWFkZXIgZm9uZG8gdGhlbWU9OCAoYXp1bCBwZXRyb2xldW0gb3NjdXJvKSB0aW50IC0wLjUgKyBmb250IGJsYW5jb1xuLy8gICAgIGJvbGQgQ2FsaWJyaSAxMSwgYWxpZ24gY2VudGVyL2NlbnRlciwgcm93IGhlaWdodCAyOC44LlxuLy8gICAtIEZpbGFzIFNJOiBmb25kbyB0aGVtZT04IHRpbnQgKzAuNiAoYXp1bCBjbGFybykgKyBmb250IHRoZW1lPTggdGludFxuLy8gICAgIC0wLjUgKGF6dWwgb3NjdXJvKSArIGJvbGQgY2VudGVyLlxuLy8gICAtIEZpbGFzIE5POiBmb25kbyB0aGVtZT01IHRpbnQgLTAuNSAocm9qbyBvc2N1cm8pICsgZm9udCB0aGVtZT0wXG4vLyAgICAgKGJsYW5jbykgKyBib2xkIGNlbnRlci5cbi8vICAgLSBGcmVlemUgQTIsIGF1dG9maWx0ZXIgQTE6R3tufSwgbm8gZ3JpZGxpbmVzLlxuLy8gICAtIEZvcm1hdG8gbW9uZWRhIEQgKDIgZGVjKSB5IEUgKHNpbiBkZWMpLlxuLy8gICAtIENvbHVtbiB3aWR0aHM6IEE9MzgsIEI9MjAsIEM9MTUuNjYsIEQ9MTgsIEU9MTYsIEY9MTQuNTUsIEc9OC44OS5cbi8vIE1hdGNoIDE6MSBjb24gbWVyY2Fkby1pbnRlbGxpZ2VuY2Uvc2NyaXB0cy9leHBvcnRfaW5mcmFjY2lvbmVzX21lbGlfZm9ybWF0by5weVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG53aW5kb3cuZXhwb3J0SW5mcmFjY2lvbmVzTWVsaSA9IGFzeW5jIGZ1bmN0aW9uICgpIHtcbiAgaWYgKCFmYkRiKSB7XG4gICAgYWxlcnQoJ0ZpcmVzdG9yZSBubyBkaXNwb25pYmxlLicpO1xuICAgIHJldHVybjtcbiAgfVxuICB0cnkge1xuICAgIGNvbnN0IGRvY1JlZiA9IGZiRGIuY29sbGVjdGlvbignbWVsaV9pbmZyYWNjaW9uZXNfcmVzdW1lbicpLmRvYygnY3VycmVudCcpO1xuICAgIGNvbnN0IHNuYXAgPSBhd2FpdCBkb2NSZWYuZ2V0KCk7XG4gICAgaWYgKCFzbmFwLmV4aXN0cykge1xuICAgICAgYWxlcnQoXG4gICAgICAgICdObyBoYXkgZGF0b3MgZGUgaW5mcmFjY2lvbmVzIE1FTEkgYVx1MDBGQW4uXFxuXFxuJyArXG4gICAgICAgICAgJ0VsIHBpcGVsaW5lIE1JIGNvcnJlIHRvZG9zIGxvcyBkXHUwMEVEYXMgYSBsYXMgMTY6MDAgQVJUIHkgcHVibGljYSBlbCAnICtcbiAgICAgICAgICAnc25hcHNob3QgYSBGaXJlc3RvcmUuIFNpIG5vIGNvcnJlIG51bmNhIG8gZmFsdGEgZWwgc2VjcmV0ICcgK1xuICAgICAgICAgICdBUFBfVkVOREVET1JFU19TQV9LRVkgZW4gR2l0SHViIEFjdGlvbnMsIGVsIGRvYyBudW5jYSBzZSBnZW5lcmEuXFxuXFxuJyArXG4gICAgICAgICAgJ1RyaWdnZXIgbWFudWFsOiBHaXRIdWIgQWN0aW9ucyA+IFwiTUFQIE1vbml0b3IgZGFpbHlcIiA+IFJ1biB3b3JrZmxvdy4nXG4gICAgICApO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBjb25zdCBkYXRhID0gc25hcC5kYXRhKCkgfHwge307XG4gICAgY29uc3Qgcm93cyA9IEFycmF5LmlzQXJyYXkoZGF0YS5yb3dzKSA/IGRhdGEucm93cyA6IFtdO1xuICAgIGlmIChyb3dzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgYWxlcnQoJ0VsIGRvYyBleGlzdGUgcGVybyBubyB0aWVuZSBmaWxhcyBkZSBpbmZyYWNjaW9uZXMuJyk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IGxvYWRFeGNlbEpTKCk7XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgYWxlcnQoJ05vIHNlIHB1ZG8gY2FyZ2FyIEV4Y2VsSlM6ICcgKyAoZSAmJiBlLm1lc3NhZ2UgPyBlLm1lc3NhZ2UgOiBlKSk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGNvbnN0IHdvcmtib29rID0gbmV3IEV4Y2VsSlMuV29ya2Jvb2soKTtcbiAgICBjb25zdCB3cyA9IHdvcmtib29rLmFkZFdvcmtzaGVldCgnSW5mcmFjY2lvbmVzJywge1xuICAgICAgdmlld3M6IFt7IHN0YXRlOiAnZnJvemVuJywgeVNwbGl0OiAxLCBzaG93R3JpZExpbmVzOiBmYWxzZSB9XSxcbiAgICB9KTtcbiAgICBjb25zdCBoZWFkZXJzID0gW1xuICAgICAgJ0NsaWVudGUnLFxuICAgICAgJ1NLVScsXG4gICAgICAnRGlmZXJlbmNpYSAlJyxcbiAgICAgICdQcmVjaW8gcHVibGljYWRvJyxcbiAgICAgICdQcmVjaW8gU3VnZXJpZG8nLFxuICAgICAgJ0NhbnQuIEhpc3RvcmljYXMgIGRlIEluZnJhY2Npb25lcycsXG4gICAgICAnXHUwMEJGQ2xpZW50ZT8nLFxuICAgIF07XG4gICAgY29uc3Qgd2lkdGhzID0gWzM4LCAyMCwgMTUuNjYsIDE4LCAxNiwgMTQuNTUsIDguODldO1xuICAgIGNvbnN0IG1vbmV5Rm10MiA9ICdfLVwiJFwiXFxcXCAqICMsIyMwLjAwXy07XFxcXC1cIiRcIlxcXFwgKiAjLCMjMC4wMF8tO18tXCIkXCJcXFxcICogXCItXCI/P18tO18tQF8tJztcbiAgICBjb25zdCBtb25leUZtdDAgPSAnXy1cIiRcIlxcXFwgKiAjLCMjMF8tO1xcXFwtXCIkXCJcXFxcICogIywjIzBfLTtfLVwiJFwiXFxcXCAqIFwiLVwiPz9fLTtfLUBfLSc7XG5cbiAgICAvLyBIZWFkZXIgcm93LlxuICAgIHdzLmFkZFJvdyhoZWFkZXJzKTtcbiAgICBjb25zdCBoZWFkZXIgPSB3cy5nZXRSb3coMSk7XG4gICAgaGVhZGVyLmhlaWdodCA9IDI4Ljg7XG4gICAgaGVhZGVyLmVhY2hDZWxsKChjZWxsKSA9PiB7XG4gICAgICBjZWxsLmZpbGwgPSB7XG4gICAgICAgIHR5cGU6ICdwYXR0ZXJuJyxcbiAgICAgICAgcGF0dGVybjogJ3NvbGlkJyxcbiAgICAgICAgZmdDb2xvcjogeyB0aGVtZTogOCwgdGludDogLTAuNDk5OTg0NzQwNzQ1MjYyIH0sXG4gICAgICB9O1xuICAgICAgY2VsbC5mb250ID0ge1xuICAgICAgICBuYW1lOiAnQ2FsaWJyaScsXG4gICAgICAgIHNpemU6IDExLFxuICAgICAgICBib2xkOiB0cnVlLFxuICAgICAgICBjb2xvcjogeyBhcmdiOiAnRkZGRkZGRkYnIH0sXG4gICAgICB9O1xuICAgICAgY2VsbC5hbGlnbm1lbnQgPSB7IGhvcml6b250YWw6ICdjZW50ZXInLCB2ZXJ0aWNhbDogJ2NlbnRlcicsIHdyYXBUZXh0OiB0cnVlIH07XG4gICAgfSk7XG5cbiAgICAvLyBEYXRhIHJvd3Mgb3JkZW5hZGFzIHBvciBjbGllbnRlLCBza3UuXG4gICAgY29uc3Qgc29ydGVkID0gcm93cy5zbGljZSgpLnNvcnQoKGEsIGIpID0+IHtcbiAgICAgIGNvbnN0IGNhID0gU3RyaW5nKGEuY2xpZW50ZSB8fCAnJykudG9VcHBlckNhc2UoKTtcbiAgICAgIGNvbnN0IGNiID0gU3RyaW5nKGIuY2xpZW50ZSB8fCAnJykudG9VcHBlckNhc2UoKTtcbiAgICAgIGlmIChjYSAhPT0gY2IpIHJldHVybiBjYSA8IGNiID8gLTEgOiAxO1xuICAgICAgY29uc3Qgc2EgPSBTdHJpbmcoYS5za3UgfHwgJycpO1xuICAgICAgY29uc3Qgc2IgPSBTdHJpbmcoYi5za3UgfHwgJycpO1xuICAgICAgcmV0dXJuIHNhIDwgc2IgPyAtMSA6IHNhID4gc2IgPyAxIDogMDtcbiAgICB9KTtcbiAgICBmb3IgKGNvbnN0IHIgb2Ygc29ydGVkKSB7XG4gICAgICBjb25zdCByb3cgPSB3cy5hZGRSb3coW1xuICAgICAgICByLmNsaWVudGUgfHwgJycsXG4gICAgICAgIHIuc2t1IHx8ICcnLFxuICAgICAgICB0eXBlb2Ygci5kaWZlcmVuY2lhUGN0ID09PSAnbnVtYmVyJyA/IHIuZGlmZXJlbmNpYVBjdCA6IDAsXG4gICAgICAgIHR5cGVvZiByLnByZWNpb1B1YmxpY2FkbyA9PT0gJ251bWJlcicgPyByLnByZWNpb1B1YmxpY2FkbyA6IDAsXG4gICAgICAgIHR5cGVvZiByLnByZWNpb1N1Z2VyaWRvID09PSAnbnVtYmVyJyA/IHIucHJlY2lvU3VnZXJpZG8gOiAwLFxuICAgICAgICB0eXBlb2Ygci5jYW50SGlzdG9yaWNhcyA9PT0gJ251bWJlcicgPyByLmNhbnRIaXN0b3JpY2FzIDogMCxcbiAgICAgICAgci5lc0NsaWVudGUgPT09ICdTSScgPyAnU0knIDogJ05PJyxcbiAgICAgIF0pO1xuICAgICAgY29uc3QgaXNDbGllbnRlID0gci5lc0NsaWVudGUgPT09ICdTSSc7XG4gICAgICBjb25zdCBmaWxsID0gaXNDbGllbnRlXG4gICAgICAgID8ge1xuICAgICAgICAgICAgdHlwZTogJ3BhdHRlcm4nLFxuICAgICAgICAgICAgcGF0dGVybjogJ3NvbGlkJyxcbiAgICAgICAgICAgIGZnQ29sb3I6IHsgdGhlbWU6IDgsIHRpbnQ6IDAuNTk5OTkzODk2Mjk4MTA0OCB9LFxuICAgICAgICAgIH1cbiAgICAgICAgOiB7XG4gICAgICAgICAgICB0eXBlOiAncGF0dGVybicsXG4gICAgICAgICAgICBwYXR0ZXJuOiAnc29saWQnLFxuICAgICAgICAgICAgZmdDb2xvcjogeyB0aGVtZTogNSwgdGludDogLTAuNDk5OTg0NzQwNzQ1MjYyIH0sXG4gICAgICAgICAgfTtcbiAgICAgIGNvbnN0IGZvbnQgPSBpc0NsaWVudGVcbiAgICAgICAgPyB7XG4gICAgICAgICAgICBuYW1lOiAnQ2FsaWJyaScsXG4gICAgICAgICAgICBzaXplOiAxMSxcbiAgICAgICAgICAgIGJvbGQ6IHRydWUsXG4gICAgICAgICAgICBjb2xvcjogeyB0aGVtZTogOCwgdGludDogLTAuNDk5OTg0NzQwNzQ1MjYyIH0sXG4gICAgICAgICAgfVxuICAgICAgICA6IHtcbiAgICAgICAgICAgIG5hbWU6ICdDYWxpYnJpJyxcbiAgICAgICAgICAgIHNpemU6IDExLFxuICAgICAgICAgICAgYm9sZDogdHJ1ZSxcbiAgICAgICAgICAgIGNvbG9yOiB7IHRoZW1lOiAwIH0sXG4gICAgICAgICAgfTtcbiAgICAgIHJvdy5lYWNoQ2VsbCgoY2VsbCkgPT4ge1xuICAgICAgICBjZWxsLmZpbGwgPSBmaWxsO1xuICAgICAgICBjZWxsLmZvbnQgPSBmb250O1xuICAgICAgICBjZWxsLmFsaWdubWVudCA9IHsgaG9yaXpvbnRhbDogJ2NlbnRlcicgfTtcbiAgICAgIH0pO1xuICAgICAgcm93LmdldENlbGwoNCkubnVtRm10ID0gbW9uZXlGbXQyOyAvLyBQcmVjaW8gcHVibGljYWRvXG4gICAgICByb3cuZ2V0Q2VsbCg1KS5udW1GbXQgPSBtb25leUZtdDA7IC8vIFByZWNpbyBTdWdlcmlkb1xuICAgIH1cblxuICAgIC8vIFdpZHRocy5cbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IHdpZHRocy5sZW5ndGg7IGkrKykge1xuICAgICAgd3MuZ2V0Q29sdW1uKGkgKyAxKS53aWR0aCA9IHdpZHRoc1tpXTtcbiAgICB9XG4gICAgLy8gQXV0b2ZpbHRlci5cbiAgICB3cy5hdXRvRmlsdGVyID0ge1xuICAgICAgZnJvbTogeyByb3c6IDEsIGNvbHVtbjogMSB9LFxuICAgICAgdG86IHsgcm93OiB3cy5yb3dDb3VudCwgY29sdW1uOiBoZWFkZXJzLmxlbmd0aCB9LFxuICAgIH07XG5cbiAgICBjb25zdCBidWYgPSBhd2FpdCB3b3JrYm9vay54bHN4LndyaXRlQnVmZmVyKCk7XG4gICAgY29uc3QgYmxvYiA9IG5ldyBCbG9iKFtidWZdLCB7XG4gICAgICB0eXBlOiAnYXBwbGljYXRpb24vdm5kLm9wZW54bWxmb3JtYXRzLW9mZmljZWRvY3VtZW50LnNwcmVhZHNoZWV0bWwuc2hlZXQnLFxuICAgIH0pO1xuICAgIF9kb3dubG9hZEJsb2IoYmxvYiwgJ0lORlJBQ0NJT05FUy1NRUxJLnhsc3gnKTtcblxuICAgIGlmICh0eXBlb2Ygc2hvd1N5bmNUYWcgPT09ICdmdW5jdGlvbicpIHtcbiAgICAgIGNvbnN0IHNpID0gc29ydGVkLmZpbHRlcigocikgPT4gci5lc0NsaWVudGUgPT09ICdTSScpLmxlbmd0aDtcbiAgICAgIGNvbnN0IG5vID0gc29ydGVkLmxlbmd0aCAtIHNpO1xuICAgICAgc2hvd1N5bmNUYWcoJ0lORlJBQ0NJT05FUy1NRUxJOiAnICsgc29ydGVkLmxlbmd0aCArICcgZmlsYXMgKCcgKyBzaSArICcgU0kgKyAnICsgbm8gKyAnIE5PKScpO1xuICAgIH1cbiAgfSBjYXRjaCAoZSkge1xuICAgIGNvbnNvbGUuZXJyb3IoJ1tleHBvcnRJbmZyYWNjaW9uZXNNZWxpXScsIGUpO1xuICAgIGFsZXJ0KCdFcnJvciBhbCBiYWphciBlbCByZXBvcnRlOiAnICsgKGUgJiYgZS5tZXNzYWdlID8gZS5tZXNzYWdlIDogZSkpO1xuICB9XG59O1xuXG4vLyA9PT0gRXhwb3J0cyBhIHdpbmRvdyA9PT1cbi8vIFRvZGFzIGxhcyBmdW5jaW9uZXMgd2luZG93LmZvbyA9IGZ1bmN0aW9uLi4uIHlhIGVzdFx1MDBFMW4gdmVyYmF0aW0uXG5pZiAodHlwZW9mIHdpbmRvdy50b2RheVN0ciA9PT0gJ3VuZGVmaW5lZCcpIHdpbmRvdy50b2RheVN0ciA9IHRvZGF5U3RyO1xuLy8gRTYgaG90Zml4IDI6IGRhdGFVcmxUb0Jsb2IgKyBzYW5pdGl6ZUZvclBhdGggdXNhZG9zIHBvciBpbmxpbmUgcnVuRnVsbEJhY2t1cCAoTDcyNzgtNzI4OCkuXG5pZiAodHlwZW9mIHdpbmRvdy5kYXRhVXJsVG9CbG9iID09PSAndW5kZWZpbmVkJykgd2luZG93LmRhdGFVcmxUb0Jsb2IgPSBkYXRhVXJsVG9CbG9iO1xuaWYgKHR5cGVvZiB3aW5kb3cuc2FuaXRpemVGb3JQYXRoID09PSAndW5kZWZpbmVkJykgd2luZG93LnNhbml0aXplRm9yUGF0aCA9IHNhbml0aXplRm9yUGF0aDtcbi8vIEU2IGhvdGZpeCAzOiBjcm9zcy1tb2R1bGUgYnVnIChhdWRpdCBjcm9zc2J1bmRsZSkgXHUyMDE0IGV4cG9ydHMtY29yZSBsbGFtYSBsb2FkRXhjZWxKUy5cbndpbmRvdy5sb2FkRXhjZWxKUyA9IGxvYWRFeGNlbEpTO1xuIl0sCiAgIm1hcHBpbmdzIjogIjs7O0FBb0NPLFdBQVMsVUFBVSxHQUFHO0FBQzNCLFFBQUksTUFBTSxRQUFRLE1BQU0sT0FBVyxRQUFPO0FBQzFDLFVBQU0sTUFBTSxPQUFPLENBQUM7QUFDcEIsUUFBSSxRQUFRLEdBQUksUUFBTztBQUV2QixRQUFJLFdBQVcsS0FBSyxHQUFHLEdBQUc7QUFDeEIsYUFBTyxNQUFNLElBQUksUUFBUSxNQUFNLElBQUksSUFBSTtBQUFBLElBQ3pDO0FBQ0EsV0FBTztBQUFBLEVBQ1Q7QUFRTyxXQUFTLE9BQU8sUUFBUTtBQUM3QixXQUFPLE9BQU8sSUFBSSxDQUFDLE1BQU0sVUFBVSxvQkFBb0IsQ0FBQyxDQUFDLENBQUMsRUFBRSxLQUFLLEdBQUc7QUFBQSxFQUN0RTtBQWdCTyxXQUFTLG9CQUFvQixHQUFHO0FBQ3JDLFFBQUksTUFBTSxRQUFRLE1BQU0sT0FBVyxRQUFPO0FBQzFDLFFBQUksT0FBTyxNQUFNLFNBQVUsUUFBTztBQUNsQyxRQUFJLE9BQU8sTUFBTSxVQUFVO0FBQ3pCLFVBQUksQ0FBQyxPQUFPLFNBQVMsQ0FBQyxFQUFHLFFBQU87QUFDaEMsYUFBTyxPQUFPLENBQUM7QUFBQSxJQUNqQjtBQUNBLFFBQUksT0FBTyxNQUFNLFVBQVcsUUFBTyxJQUFJLFNBQVM7QUFFaEQsUUFDRSxPQUFPLE1BQU0sWUFDYixN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
